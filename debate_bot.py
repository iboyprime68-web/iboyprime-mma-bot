#!/usr/bin/env python3
"""Weekly MMA debate - one native poll in 🥊-mma-chat every Monday.

Rotates through debates_data.json with a cursor (never repeats until the list
cycles). Silent post (calm-mode): people find it organically, no ping. 3-day
poll so the argument can breathe. Std-lib only; state_debate.json.
"""
import common

STATE_FILE     = "state_debate.json"
DATA_FILE      = "debates_data.json"
DURATION_HOURS = 72


def main():
    cfg = common.load_config()
    channel = (cfg.get("channels") or {}).get("mma_chat")
    if not channel:
        print("No mma_chat channel in config.")
        return
    state = common.load_json(common.state_path(STATE_FILE), {})
    if state.get("v") != 1:
        state = {"v": 1, "cursor": 0, "last_posted": ""}
    today = common.now_utc().strftime("%Y-%m-%d")
    if state.get("last_posted") == today:
        print("Debate already posted today - nothing to do.")
        return
    bank = common.load_json(common.state_path(DATA_FILE), [])
    if not bank:
        print("No debates_data.json bank - nothing to do.")
        return

    debate = bank[state["cursor"] % len(bank)]
    body = {"content": "🗣️ Weekly debate — vote, then defend your pick in the replies.",
            "flags": common.SILENT_FLAG,
            "allowed_mentions": common.NO_PINGS,
            "poll": {"question": {"text": debate["q"][:300]},
                     "answers": [{"poll_media": {"text": a[:55]}} for a in debate["answers"][:10]],
                     "duration": DURATION_HOURS, "allow_multiselect": False}}
    code, resp = common.discord("POST", "/channels/%s/messages" % channel, body)
    if code in (200, 201):
        state["cursor"] = (state["cursor"] + 1) % len(bank)
        state["last_posted"] = today
        common.save_json(common.state_path(STATE_FILE), state)
        common.persist_state(STATE_FILE)
        print("Debate posted:", debate["q"])
    else:
        print("Debate post failed:", code, str(resp)[:150])


if __name__ == "__main__":
    main()
