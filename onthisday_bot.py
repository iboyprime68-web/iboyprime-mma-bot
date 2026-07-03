#!/usr/bin/env python3
"""iBoyPrime HQ - Bot #6: On This Day in MMA + Trivia of the Day.

Daily post to #on-this-day:
  * every iconic MMA event that happened on today's calendar date, and
  * a rotating trivia question with a spoiler-tagged answer.
Reads the curated onthisday_data.json. Posts once per day (state guard).
Std-lib only.
"""
import os, datetime, common

DATA_FILE  = os.path.join(common.HERE, "onthisday_data.json")
STATE_FILE = "state_onthisday.json"


def main():
    cfg = common.load_config()
    chan = cfg.get("channels", {}).get("on_this_day")
    if not chan:
        print("No on_this_day channel in config."); return
    data = common.load_json(DATA_FILE, {})
    trivia = data.get("trivia", [])
    otd = data.get("on_this_day", {})

    now = common.now_utc()
    today = now.strftime("%Y-%m-%d")
    state = common.load_json(common.state_path(STATE_FILE), {})
    if state.get("last_date") == today:
        print("Already posted today."); return

    key = now.strftime("%m-%d")
    month = now.strftime("%B")
    day = str(int(now.strftime("%d")))
    header = "📅 **On This Day in MMA — %s %s**" % (month, day)

    entries = sorted(otd.get(key, []), key=lambda e: e.get("year", 0))
    if entries:
        body = "\n\n".join("**%s** — %s" % (e.get("year", "?"), e.get("text", "")) for e in entries[:4])
    else:
        body = "_No marquee event on record for today. Know one we're missing? Drop it in chat and we'll add it._"

    msg = header + "\n\n" + body
    if trivia:
        idx = (now.toordinal()) % len(trivia)
        t = trivia[idx]
        msg += "\n\n🧠 **Trivia of the Day**\n%s\nAnswer: ||%s||" % (t.get("q", ""), t.get("a", ""))

    # SILENT: the daily history post never buzzes anyone (spoilered trivia answer
    # must stay in the CONTENT - spoiler tags don't render inside embeds).
    code, resp = common.post_message(chan, msg, silent=True)
    if code in (200, 201):
        state["last_date"] = today
        common.save_json(common.state_path(STATE_FILE), state)
        print("Posted On This Day for %s (%d events)." % (today, len(entries)))
    else:
        print("Post failed: HTTP %s %s" % (code, str(resp)[:160]))


if __name__ == "__main__":
    main()
