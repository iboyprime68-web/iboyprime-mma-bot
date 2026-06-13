#!/usr/bin/env python3
"""iBoyPrime HQ - Bot #4: Fight-week hub.

A few days before each UFC/PFL/Bellator card it opens a thread in the
🗓️-fight-week forum with:
  * the full main card (localized start time via <t:..:F>), and
  * a native Discord prediction poll on the main event.
Creates each hub once (state-tracked). Std-lib only.
"""
import re, datetime, common

LEAGUES = ["ufc", "pfl", "bellator"]
LEAGUE_LABEL = {"ufc": "UFC", "pfl": "PFL", "bellator": "Bellator"}
FIGHT_WEEK_DAYS = 5
MAX_BOUTS = 8
STATE_FILE = "state_fightweek.json"


def espn(path):
    _, d = common.get_json("https://site.api.espn.com/apis/site/v2/sports/mma/" + path)
    return d or {}


def event_id(ref):
    m = re.search(r"/events/(\d+)", ref or "")
    return m.group(1) if m else None


def competitors(comp):
    cs = comp.get("competitors", [])
    a = next((c for c in cs if c.get("order") == 1), cs[0] if cs else {})
    b = next((c for c in cs if c.get("order") == 2), cs[1] if len(cs) > 1 else {})
    return a, b


def fname(c):
    return (c.get("athlete") or {}).get("displayName", "TBD")


def weightclass(comp):
    return (comp.get("type") or {}).get("abbreviation", "")


def find_detail(league, eid, start_iso, cache):
    if eid in cache:
        return cache[eid]
    d = common.parse_iso(start_iso)
    if not d:
        return None
    for delta in (0, -1, 1):
        day = (d + datetime.timedelta(days=delta)).strftime("%Y%m%d")
        sb = espn(league + "/scoreboard?dates=" + day)
        for ev in sb.get("events", []):
            cache[ev["id"]] = ev
        if eid in cache:
            return cache[eid]
    return None


def matchup_line(comp):
    a, b = competitors(comp)
    na, nb = fname(a), fname(b)
    line = "**%s** vs **%s**" % (na, nb)
    wc = weightclass(comp)
    if wc:
        line += " · " + wc
    return line, na, nb


def main():
    cfg = common.load_config()
    forum = cfg.get("channels", {}).get("fight_week")
    if not forum:
        print("No fight_week forum in config."); return
    state = common.load_json(common.state_path(STATE_FILE), {})
    done = state.get("hubs", {})
    now = common.now_utc()
    made = 0

    for league in LEAGUES:
        sb = espn(league + "/scoreboard")
        lg = sb.get("leagues") or []
        if not lg:
            continue
        cache = {e["id"]: e for e in sb.get("events", [])}
        for c in lg[0].get("calendar", []):
            eid = event_id((c.get("event") or {}).get("$ref"))
            if not eid:
                continue
            start = common.parse_iso(c.get("startDate"))
            if not start or not (now < start <= now + datetime.timedelta(days=FIGHT_WEEK_DAYS)):
                continue
            ev = find_detail(league, eid, c.get("startDate"), cache)
            if not ev:
                continue
            bouts = list(reversed(ev.get("competitions", [])))[:MAX_BOUTS]
            if not bouts:
                continue
            label = c.get("label") or (LEAGUE_LABEL[league] + " Event")
            ts = int(start.timestamp())
            lines, main_a, main_b = [], None, None
            for i, comp in enumerate(bouts):
                ln, na, nb = matchup_line(comp)
                if i == 0:
                    main_a, main_b = na, nb
                lines.append(("🏆 " if i == 0 else "• ") + ln)
            body = ("🗓️ **Fight Week: %s**\n%s  (%s)\n\n**Main card**\n%s\n\nWho you got? Vote below \U0001F447"
                    % (label, common.dts(ts, "F"), common.dts(ts, "R"), "\n".join(lines)))

            rec = done.get(eid)
            if rec:                                  # already hubbed -> self-heal if the card changed
                if rec.get("body") != body and rec.get("thread_id"):
                    tid = rec["thread_id"]
                    c2, _ = common.discord("PATCH", "/channels/%s/messages/%s" % (tid, tid), {"content": body[:1990]})
                    if c2 in (200, 201):
                        rec["body"] = body; made += 1; print("hub updated:", label)
                continue

            code, resp = common.create_forum_thread(forum, "🗓️ " + label + " — Fight Week", body)
            if code in (200, 201) and isinstance(resp, dict) and resp.get("id"):
                tid = resp["id"]
                if main_a and main_b:
                    hours = max(1, min(168, int((start - now).total_seconds() // 3600) + 1))
                    common.discord("POST", "/channels/%s/messages" % tid, {
                        "poll": {"question": {"text": "Main event: who wins? %s vs %s" % (main_a, main_b)},
                                 "answers": [{"poll_media": {"text": main_a[:55]}},
                                             {"poll_media": {"text": main_b[:55]}}],
                                 "duration": hours, "allow_multiselect": False}})
                done[eid] = {"thread_id": tid, "body": body, "created": common.now_utc().isoformat()}
                made += 1
                print("hub created:", label)
            else:
                print("hub failed:", label, code, str(resp)[:150])

    state["hubs"] = done
    common.save_json(common.state_path(STATE_FILE), state)
    print("Done. new hubs=%d tracked=%d" % (made, len(done)))


if __name__ == "__main__":
    main()
