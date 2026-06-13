#!/usr/bin/env python3
"""iBoyPrime HQ - Moderation patrol (cron second layer behind native AutoMod).

Every few minutes it sweeps recent messages in the main chat channels and acts
on what AutoMod's real-time rules don't catch:
  * FLOOD  - one user firing many messages in a few seconds,
  * DUPES  - the same message posted over and over (incl. across the batch).
It deletes the offending messages, calls it out in the mod-log, tracks a warning
count per user, and escalates to a timeout on repeat offenders.

Staff and bots are always skipped. Conservative thresholds to avoid touching
normal chat. Std-lib only.
"""
import datetime, common

FLOOD_COUNT  = 6      # messages...
FLOOD_WINDOW = 12     # ...within this many seconds = flood
DUP_COUNT    = 4      # same message repeated this many times = spam
RECENT_MIN   = 12     # only look at messages from the last N minutes
TIMEOUT_AT   = 3      # warnings before a timeout
TIMEOUT_MIN  = 10     # timeout length (minutes)
STATE_FILE   = "state_mod.json"


def norm(s):
    return " ".join((s or "").lower().split())


def is_staff(msg, staff):
    if (msg.get("author") or {}).get("bot"):
        return True
    member = msg.get("member") or {}
    return any(r in staff for r in member.get("roles", []))


def scan_channel(ch, staff, seen, now):
    """Return {uid: {"name":.., "ids":set(msg_ids)}} of offenders in this channel."""
    code, data = common.discord("GET", "/channels/%s/messages?limit=80" % ch)
    if not isinstance(data, list):
        return {}
    msgs = []
    for m in data:
        ts = common.parse_iso(m.get("timestamp"))
        if not ts or (now - ts).total_seconds() > RECENT_MIN * 60:
            continue
        if m.get("id") in seen or is_staff(m, staff):
            continue
        msgs.append((ts, m))
    msgs.sort(key=lambda x: x[0])

    by_user = {}
    for ts, m in msgs:
        uid = (m.get("author") or {}).get("id")
        if not uid:
            continue
        by_user.setdefault(uid, []).append((ts, m))

    offenders = {}
    for uid, items in by_user.items():
        ids, reasons = set(), set()
        # flood: sliding window of FLOOD_COUNT within FLOOD_WINDOW seconds
        times = [t for t, _ in items]
        for i in range(len(times)):
            j = i + FLOOD_COUNT - 1
            if j < len(times) and (times[j] - times[i]).total_seconds() <= FLOOD_WINDOW:
                for k in range(i, j + 1):
                    ids.add(items[k][1]["id"])
                reasons.add("flood")
        # duplicate content
        buckets = {}
        for t, m in items:
            c = norm(m.get("content"))
            if c:
                buckets.setdefault(c, []).append(m["id"])
        for c, mids in buckets.items():
            if len(mids) >= DUP_COUNT:
                ids.update(mids); reasons.add("repeat spam")
        if ids:
            name = (items[0][1].get("author") or {}).get("username", "user")
            offenders[uid] = {"name": name, "ids": ids, "reasons": reasons}
    return offenders


def delete_messages(ch, ids):
    ids = list(ids)
    done = 0
    if len(ids) >= 2:
        c, _ = common.discord("POST", "/channels/%s/messages/bulk-delete" % ch, {"messages": ids[:100]})
        if c in (200, 204):
            return len(ids[:100])
    for mid in ids:                       # fallback / single
        c, _ = common.discord("DELETE", "/channels/%s/messages/%s" % (ch, mid))
        if c in (200, 204):
            done += 1
    return done


def timeout_member(guild, uid, minutes):
    until = (common.now_utc() + datetime.timedelta(minutes=minutes)).strftime("%Y-%m-%dT%H:%M:%S+00:00")
    c, _ = common.discord("PATCH", "/guilds/%s/members/%s" % (guild, uid),
                          {"communication_disabled_until": until})
    return c in (200, 204)


def main():
    cfg = common.load_config()
    guild = cfg["guild_id"]
    mod_log = cfg.get("channels", {}).get("mod_log")
    patrol = cfg.get("patrol_channels", [])
    roles = cfg.get("roles", {})
    staff = {roles[k] for k in ("owner", "admin", "mod") if roles.get(k)}
    if not patrol:
        print("No patrol_channels in config - nothing to sweep."); return

    state = common.load_json(common.state_path(STATE_FILE), {})
    users = state.get("users", {})
    seen = set(state.get("seen", []))
    now = common.now_utc()
    actions = 0

    for ch in patrol:
        offenders = scan_channel(ch, staff, seen, now)
        for uid, info in offenders.items():
            removed = delete_messages(ch, info["ids"])
            seen.update(info["ids"])
            u = users.setdefault(uid, {"warns": 0})
            u["warns"] += 1
            u["last"] = now.isoformat()
            reason = " + ".join(sorted(info["reasons"]))
            line = ("🚨 Removed **%d** message(s) from <@%s> in <#%s> — %s. Warning **%d/%d**."
                    % (removed, uid, ch, reason, u["warns"], TIMEOUT_AT))
            if u["warns"] >= TIMEOUT_AT:
                if timeout_member(guild, uid, TIMEOUT_MIN):
                    line += "\n⛔ Timed out for %dm (repeat offender)." % TIMEOUT_MIN
                    u["warns"] = 0       # reset after enforcing
            if mod_log:
                common.post_message(mod_log, line, allowed_mentions={"parse": []})
            actions += 1
            print("acted:", info["name"], uid, info["reasons"], "removed", removed)

    state["users"] = users
    state["seen"] = sorted(seen)[-2000:]
    common.save_json(common.state_path(STATE_FILE), state)
    print("Patrol done. offenders acted on=%d" % actions)


if __name__ == "__main__":
    main()
