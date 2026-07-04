#!/usr/bin/env python3
"""Prime Arena - Moderation patrol (cron second layer behind native AutoMod).

Runs ~once a minute (common.run_loop) and sweeps the configured channels for what
AutoMod's real-time rules don't catch, using each channel's profile from
modconfig.json:
  * FLOOD  - one user firing many messages in a few seconds (per-channel threshold),
  * DUPES  - the same message posted over and over (per-channel threshold),
  * MEDIA / LINK POLICY - images, attachments or links that the channel's policy
    forbids (allow / no_links / no_attachments / sfw_only / text_only).
It deletes the offending messages, calls it out in the mod-log, tracks a warning
count per user, and escalates to a timeout on repeat offenders.

Staff and bots are always skipped. Std-lib only.
"""
import datetime, re, common, modconfig

# Fallback thresholds (used only if a channel resolves to no profile values).
FLOOD_COUNT  = 6      # messages...
FLOOD_WINDOW = 12     # ...within this many seconds = flood
DUP_COUNT    = 4      # same message repeated this many times = spam
RECENT_MIN   = 12     # only look at messages from the last N minutes
TIMEOUT_AT   = 3      # warnings before a timeout
TIMEOUT_MIN  = 10     # timeout length (minutes)
STATE_FILE   = "state_mod.json"

IMG_EXT = (".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".tiff", ".heic", ".heif", ".avif")


def norm(s):
    return " ".join((s or "").lower().split())


def is_staff(msg, staff):
    if (msg.get("author") or {}).get("bot"):
        return True
    member = msg.get("member") or {}
    return any(r in staff for r in member.get("roles", []))


def is_url(text):
    return bool(re.search(r"https?://|www\.", text or "", re.I))


def is_image_att(att):
    ct = (att.get("content_type") or "").lower()
    if ct.startswith("image/"):
        return True
    return (att.get("filename") or "").lower().endswith(IMG_EXT)


def media_reason(msg, policy):
    """Return a reason string if this message breaks the channel's media/link policy."""
    if policy in (None, "allow"):
        return None
    atts = msg.get("attachments") or []
    has_link = is_url(msg.get("content"))
    has_img = any(is_image_att(a) for a in atts)
    has_att = len(atts) > 0
    if policy == "no_links" and has_link:
        return "link not allowed here"
    if policy == "no_attachments" and has_att:
        return "attachment not allowed here"
    if policy == "sfw_only" and has_img:
        return "image not allowed here"
    if policy == "text_only" and (has_att or has_link):
        return "text-only channel"
    return None


def scan_channel(ch, staff, seen, now, policy):
    """Return {uid: {"name":.., "ids":set, "reasons":set}} of offenders in this
    channel, using the channel's resolved per-profile thresholds + media policy."""
    code, data = common.discord("GET", "/channels/%s/messages?limit=80" % ch)
    if not isinstance(data, list):
        return {}
    fc = policy.get("flood_count", FLOOD_COUNT)
    fw = policy.get("flood_window", FLOOD_WINDOW)
    dc = policy.get("dup_count", DUP_COUNT)
    media_policy = policy.get("media_policy", "allow")

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
        # flood: sliding window of fc messages within fw seconds
        times = [t for t, _ in items]
        for i in range(len(times)):
            j = i + fc - 1
            if j < len(times) and (times[j] - times[i]).total_seconds() <= fw:
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
            if len(mids) >= dc:
                ids.update(mids); reasons.add("repeat spam")
        # media / link policy (per message)
        for t, m in items:
            mr = media_reason(m, media_policy)
            if mr:
                ids.add(m["id"]); reasons.add(mr)
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


def poll_once():
    cfg = common.load_config()
    guild = cfg["guild_id"]
    mod_log = cfg.get("channels", {}).get("mod_log")
    roles = cfg.get("roles", {})
    staff = {roles[k] for k in ("owner", "admin", "mod") if roles.get(k)}
    modcfg = modconfig.load()
    # patrol the union of bots_config patrol_channels and any channel given a profile.
    channels = list({*(cfg.get("patrol_channels") or []), *modconfig.configured_channels(modcfg)})
    if not channels:
        print("No channels to patrol."); return

    state = common.load_json(common.state_path(STATE_FILE), {})
    users = state.get("users", {})
    seen = set(state.get("seen", []))
    now = common.now_utc()
    actions = 0

    for ch in channels:
        policy = modconfig.resolve_channel(modcfg, ch)
        offenders = scan_channel(ch, staff, seen, now, policy)
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
            print("acted:", info["name"], uid, sorted(info["reasons"]), "removed", removed)

    state["users"] = users
    state["seen"] = sorted(seen)[-2000:]
    common.save_json(common.state_path(STATE_FILE), state)
    if actions:                          # commit mid-loop so a crash can't re-act
        common.persist_state(STATE_FILE)
    print("Patrol cycle done. offenders acted on=%d" % actions)


def main():
    common.run_loop(poll_once)


if __name__ == "__main__":
    main()
