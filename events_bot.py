#!/usr/bin/env python3
"""Prime Arena - Bot #1: Auto Discord Scheduled Events.

For every upcoming UFC / PFL / Bellator card (ESPN free API) this creates a
native Discord Scheduled Event so members get built-in reminders + can RSVP.
  * entity_type 3 (EXTERNAL), privacy GUILD_ONLY,
  * start = card time, end = +5h, location = league + tune-in note,
  * dedup + self-heal: if a card's start time shifts, the event is PATCHed.

State (event id -> discord event id + start) is committed back to the repo.
Std-lib only; reads the DISCORD_BOT_TOKEN secret via common.py.
"""
import re, datetime, common

LEAGUES       = ["ufc", "pfl", "bellator"]
LEAGUE_LABEL  = {"ufc": "UFC", "pfl": "PFL", "bellator": "Bellator"}
UPCOMING_DAYS = 45
EVENT_HOURS   = 5
STATE_FILE    = "state_events.json"


def espn(path):
    _, data = common.get_json("https://site.api.espn.com/apis/site/v2/sports/mma/" + path)
    return data or {}


def event_id(ref):
    m = re.search(r"/events/(\d+)", ref or "")
    return m.group(1) if m else None


def iso_z(dt):
    return dt.astimezone(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%S+00:00")


def venue_of(ev):
    try:
        v = (ev.get("competitions") or [{}])[0].get("venue") or ev.get("venue") or {}
        addr = v.get("address") or {}
        bits = [v.get("fullName"), addr.get("city"), addr.get("country")]
        s = ", ".join(b for b in bits if b)
        return s
    except Exception:
        return ""


def existing_events(guild):
    code, data = common.discord("GET", "/guilds/%s/scheduled-events" % guild)
    out = []
    if isinstance(data, list):
        for e in data:
            out.append(e)
    return out


def main():
    cfg = common.load_config()
    guild = cfg["guild_id"]
    state = common.load_json(common.state_path(STATE_FILE), {})   # eid -> {discord_id, start, name}
    now = common.now_utc()
    horizon = now + datetime.timedelta(days=UPCOMING_DAYS)

    existing = existing_events(guild)
    by_name = {}
    for e in existing:
        by_name.setdefault(e.get("name", ""), []).append(e)

    created = patched = 0
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
            if not start or not (now + datetime.timedelta(minutes=20) < start <= horizon):
                continue
            label = (c.get("label") or (LEAGUE_LABEL[league] + " Event"))
            name = label[:100]
            loc = venue_of(cache.get(eid, {})) or (LEAGUE_LABEL[league] + " - live event")
            loc = loc[:100]
            end = start + datetime.timedelta(hours=EVENT_HOURS)
            desc = ("Full card & localized start times in the upcoming-fights forum. "
                    "RSVP here and Discord will remind you when it's about to start. "
                    "(%s)" % LEAGUE_LABEL[league])[:1000]

            rec = state.get(eid)
            # adopt an already-existing guild event if we lost state
            if not rec:
                for e in by_name.get(name, []):
                    if e.get("entity_type") == 3 and e.get("status") in (1, 2):
                        rec = {"discord_id": e["id"], "start": e.get("scheduled_start_time", "")}
                        state[eid] = rec
                        break

            if rec:
                old = common.parse_iso(rec.get("start"))
                if not old or abs((old - start).total_seconds()) > 600:   # moved >10 min -> heal
                    code, resp = common.discord(
                        "PATCH", "/guilds/%s/scheduled-events/%s" % (guild, rec["discord_id"]),
                        {"scheduled_start_time": iso_z(start), "scheduled_end_time": iso_z(end)})
                    if code in (200, 201):
                        rec["start"] = iso_z(start); patched += 1
                        print("patched:", name)
                continue

            code, resp = common.discord("POST", "/guilds/%s/scheduled-events" % guild, {
                "name": name, "privacy_level": 2,
                "scheduled_start_time": iso_z(start), "scheduled_end_time": iso_z(end),
                "entity_type": 3, "entity_metadata": {"location": loc},
                "description": desc})
            if code in (200, 201) and isinstance(resp, dict) and resp.get("id"):
                state[eid] = {"discord_id": resp["id"], "start": iso_z(start), "name": name}
                created += 1
                print("created event:", name, start.isoformat())
            else:
                print("create failed:", name, code, str(resp)[:160])

    common.save_json(common.state_path(STATE_FILE), state)
    print("Done. created=%d patched=%d total_tracked=%d" % (created, patched, len(state)))


if __name__ == "__main__":
    main()
