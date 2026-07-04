#!/usr/bin/env python3
"""Clip of the Week - weekly thread in 🏆-plays-n-clips + reaction-crowned champ.

Monday 15:00 UTC: opens a "🎬 Clip War" thread (silent seed message explains
the rules). Sunday 20:00 UTC: counts total reactions on every member message in
the thread, crowns the author with the most (ties -> earliest post), moves the
🎬 Clip Champ role from the previous holder, and announces in the thread
mentioning ONLY the winner. No clips -> the previous champ keeps the role.
Std-lib only; state_clip.json.
"""
import datetime, common

STATE_FILE = "state_clip.json"
MAX_PAGES  = 3          # up to 300 messages counted per week


def week_key(now):
    return now.strftime("%G-W%V")


def open_week(cfg, state, now):
    channel = (cfg.get("channels") or {}).get("plays_n_clips")
    if not channel:
        print("No plays_n_clips channel in config.")
        return False
    wk = week_key(now)
    if state.get("week") == wk and state.get("thread_id"):
        print("This week's Clip War already open.")
        return False
    monday = now - datetime.timedelta(days=now.weekday())
    title = "🎬 Clip War — week of %s" % monday.strftime("%b %d")
    code, resp = common.discord("POST", "/channels/%s/threads" % channel,
                                {"name": title[:95], "type": 11,
                                 "auto_archive_duration": 10080})
    if code not in (200, 201) or not isinstance(resp, dict) or not resp.get("id"):
        print("Thread create failed:", code, str(resp)[:150])
        return False
    tid = resp["id"]
    scode, seed = common.post_message(
        tid,
        "🎬 Drop your best plays and clips this week! Most total reactions by "
        "Sunday evening takes the 🎬 Clip Champ role. One rule: your clip, your "
        "upload.", silent=True)
    state.update({"week": wk, "thread_id": tid,
                  "seed_msg_id": (seed or {}).get("id") if scode in (200, 201) else None})
    print("Clip War opened:", title)
    return True


def count_reactions(thread_id, skip_ids):
    """[(total_reactions, first_seen_order, message_id, author_id)] oldest-first."""
    msgs, before = [], None
    for _ in range(MAX_PAGES):
        path = "/channels/%s/messages?limit=100" % thread_id
        if before:
            path += "&before=" + before
        code, page = common.discord("GET", path)
        if code != 200 or not isinstance(page, list) or not page:
            break
        msgs.extend(page)
        if len(page) < 100:
            break
        before = page[-1]["id"]
    best = {}
    for m in reversed(msgs):                       # oldest first -> ties go to the earliest
        author = m.get("author") or {}
        if author.get("bot") or m.get("id") in skip_ids:
            continue
        total = sum(int(r.get("count") or 0) for r in (m.get("reactions") or []))
        if total <= 0:
            continue
        uid = author.get("id")
        cur = best.get(uid)
        if cur is None or total > cur[0]:
            best[uid] = (total, m["id"])
    if not best:
        return None
    winner = max(best.items(), key=lambda kv: (kv[1][0], -int(kv[1][1])))
    return winner[0], winner[1][0]                 # (uid, reactions)


def close_week(cfg, state, now):
    tid = state.get("thread_id")
    wk = state.get("week")
    if not tid or not wk:
        print("No open Clip War to close.")
        return False
    if state.get("closed_week") == wk:
        print("This week's Clip War already closed.")
        return False
    result = count_reactions(tid, {state.get("seed_msg_id")})
    state["closed_week"] = wk
    if not result:
        common.post_message(tid, "No clips crowned this week — the belt stays put. "
                                 "New Clip War opens Monday!", silent=True)
        print("No winner this week.")
        return True
    uid, reactions = result
    rid = (cfg.get("roles") or {}).get("clip_champ")
    gid = cfg.get("guild_id")
    prev = state.get("prev_champ")
    if rid and gid:
        if prev and prev != uid:
            common.discord("DELETE", "/guilds/%s/members/%s/roles/%s" % (gid, prev, rid))
        common.discord("PUT", "/guilds/%s/members/%s/roles/%s" % (gid, uid, rid))
    state["prev_champ"] = uid
    common.post_message(tid,
                        "🎬 <@%s> takes **Clip Champ** this week with %d reactions! "
                        "New Clip War opens Monday." % (uid, reactions),
                        allowed_mentions={"users": [uid]})
    print("Clip Champ:", uid, reactions)
    return True


def main():
    cfg = common.load_config()
    state = common.load_json(common.state_path(STATE_FILE), {})
    if state.get("v") != 1:
        state = {"v": 1, "week": "", "thread_id": None, "seed_msg_id": None,
                 "closed_week": "", "prev_champ": None}
    now = common.now_utc()
    changed = False
    if now.weekday() == 6:                         # Sunday -> crown first
        changed = close_week(cfg, state, now) or changed
    if now.weekday() == 0:                         # Monday -> open the new week
        changed = open_week(cfg, state, now) or changed
    if now.weekday() not in (0, 6):
        print("Not a Clip War day (opens Mon, crowns Sun).")
    common.save_json(common.state_path(STATE_FILE), state)
    if changed:
        common.persist_state(STATE_FILE)
    print("Done.")


if __name__ == "__main__":
    main()
