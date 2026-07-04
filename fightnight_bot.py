#!/usr/bin/env python3
"""Fight-night mode - card-day hype plus readable live chat.

Every 15 minutes it checks the UFC/PFL/Bellator calendars and, on card day:
  * inside the final 75 minutes before the card: posts ONE loud reminder in
    🔥-fight-night pinging the opt-in 🥊 Fight Alerts role (localized start
    time via <t:..>) and opens a discussion thread on that reminder,
  * while the card runs: raises slowmode on 🔥-fight-night once (the channel's
    real previous value is stored) and restores it when ESPN marks the main
    event completed - or at start+8h as a backstop.

One slowmode guard covers multi-event days: first card up raises it, and it is
restored only when THAT card ends. Std-lib only; state_fightnight.json.
"""
import re, datetime, common

LEAGUES          = ["ufc", "pfl", "bellator"]
STATE_FILE       = "state_fightnight.json"
REMIND_MINUTES   = 75      # remind inside this window before the first bell
SLOWMODE_SECONDS = 10
CARD_MAX_HOURS   = 8       # restore slowmode by start+this even if ESPN lags
KEEP_DAYS        = 10      # prune per-event records this long after start


def espn(path):
    _, d = common.get_json("https://site.api.espn.com/apis/site/v2/sports/mma/" + path)
    return d or {}


def event_id(ref):
    m = re.search(r"/events/(\d+)", ref or "")
    return m.group(1) if m else None


def event_completed(league, eid, start_iso):
    """True once ESPN marks the MAIN event (last competition) completed."""
    d = common.parse_iso(start_iso)
    if not d:
        return False
    for delta in (0, 1, -1):
        day = (d + datetime.timedelta(days=delta)).strftime("%Y%m%d")
        sb = espn(league + "/scoreboard?dates=" + day)
        for ev in sb.get("events", []):
            if str(ev.get("id")) != str(eid):
                continue
            comps = ev.get("competitions") or []
            if not comps:
                return False
            st = (comps[-1].get("status") or {}).get("type") or {}
            return bool(st.get("completed"))
    return False


def remind(cfg, channel, label, start, rec):
    """The one loud message of the night: opt-in role ping + localized time,
    with a discussion thread hung off it."""
    rid = (cfg.get("roles") or {}).get("fight_alerts")
    ts = int(start.timestamp())
    line = "🥊 Fight night! %s starts %s (%s) — discussion thread below." % (
        label, common.dts(ts, "F"), common.dts(ts, "R"))
    if rid:
        code, resp = common.post_message(channel, "<@&%s> %s" % (rid, line),
                                         allowed_mentions={"roles": [str(rid)]})
    else:
        code, resp = common.post_message(channel, line)
    if code in (200, 201) and isinstance(resp, dict) and resp.get("id"):
        tcode, tresp = common.discord(
            "POST", "/channels/%s/messages/%s/threads" % (channel, resp["id"]),
            {"name": ("💬 %s — live talk" % label)[:95], "auto_archive_duration": 1440})
        if tcode in (200, 201) and isinstance(tresp, dict):
            rec["thread_id"] = tresp.get("id")
        print("  reminder posted:", label)
        return True
    print("  reminder failed:", label, code, str(resp)[:120])
    return False


def raise_slowmode(state, channel, eid):
    code, chan = common.discord("GET", "/channels/%s" % channel)
    prev = int(chan.get("rate_limit_per_user") or 0) if (code == 200 and isinstance(chan, dict)) else 0
    if prev < SLOWMODE_SECONDS:
        common.discord("PATCH", "/channels/%s" % channel,
                       {"rate_limit_per_user": SLOWMODE_SECONDS})
    state["slowmode"] = {"active_eid": eid, "channel_id": channel, "prev": prev}
    print("  slowmode raised to %ds (was %ds)" % (SLOWMODE_SECONDS, prev))


def restore_slowmode(state):
    sm = state.get("slowmode") or {}
    if sm.get("channel_id") is not None:
        common.discord("PATCH", "/channels/%s" % sm["channel_id"],
                       {"rate_limit_per_user": int(sm.get("prev") or 0)})
        print("  slowmode restored to %ds" % int(sm.get("prev") or 0))
    state["slowmode"] = {}


def main():
    cfg = common.load_config()
    channel = (cfg.get("channels") or {}).get("fight_night")
    if not channel:
        print("No fight_night channel in config.")
        return
    state = common.load_json(common.state_path(STATE_FILE), {})
    if state.get("v") != 1:
        state = {"v": 1, "events": {}, "slowmode": {}}
    now = common.now_utc()
    changed = False

    for league in LEAGUES:
        sb = espn(league + "/scoreboard")
        lg = sb.get("leagues") or []
        if not lg:
            continue
        for c in lg[0].get("calendar", []):
            eid = event_id((c.get("event") or {}).get("$ref"))
            start = common.parse_iso(c.get("startDate"))
            if not eid or not start:
                continue
            mins = (start - now).total_seconds() / 60.0
            # only care from the reminder window until the backstop
            if mins > REMIND_MINUTES or mins < -CARD_MAX_HOURS * 60:
                continue
            rec = state["events"].setdefault(eid, {})
            rec.setdefault("league", league)
            rec.setdefault("start", start.isoformat())
            rec.setdefault("label", c.get("label") or (league.upper() + " event"))
            if 0 < mins <= REMIND_MINUTES and not rec.get("reminded"):
                if remind(cfg, channel, rec["label"], start, rec):
                    rec["reminded"] = True
                    changed = True
            if mins <= 0 and not rec.get("done") and not (state.get("slowmode") or {}):
                raise_slowmode(state, channel, eid)
                changed = True

    # restore check for the active card
    sm = state.get("slowmode") or {}
    if sm.get("active_eid"):
        eid = sm["active_eid"]
        rec = state["events"].get(eid, {})
        start = common.parse_iso(rec.get("start") or "")
        over_backstop = bool(start) and now > start + datetime.timedelta(hours=CARD_MAX_HOURS)
        if not start:
            over_backstop = True          # unknown start: never strand slowmode
        if over_backstop or event_completed(rec.get("league", "ufc"), eid, rec.get("start")):
            restore_slowmode(state)
            rec["done"] = True
            changed = True

    # prune old per-event records
    for eid in list(state["events"]):
        start = common.parse_iso(state["events"][eid].get("start") or "")
        if not start or now > start + datetime.timedelta(days=KEEP_DAYS):
            del state["events"][eid]
            changed = True

    common.save_json(common.state_path(STATE_FILE), state)
    if changed:
        common.persist_state(STATE_FILE)
    print("Done. tracked=%d slowmode=%s" % (len(state["events"]),
                                            bool((state.get("slowmode") or {}).get("active_eid"))))


if __name__ == "__main__":
    main()
