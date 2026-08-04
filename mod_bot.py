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
import datetime, hashlib, re, common, modconfig

STATE_V = 2           # v2 = pseudonymous ledger (see hkey); v1 stored raw ids


def hkey(value):
    """A stable pseudonym for a Discord id (user or message).

    state_mod.json is committed to the PUBLIC repo, so it must not name anyone. Raw ids
    would publish a permanent, world-readable disciplinary record for every member the
    patrol touches: the id resolves to a live account, the count says how close they are
    to a timeout, and git history keeps it forever even if the file is later cleaned.

    The salt is the bot token - a secret both this bot and the Worker already hold and
    which is never committed - so /modlogs can still look a member up while the
    published file identifies nobody. worker.js uidKey() must stay byte-identical.
    """
    return hashlib.sha256((common.token() + ":" + str(value)).encode("utf-8")).hexdigest()[:16]

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


def is_bot(msg):
    return bool((msg.get("author") or {}).get("bot"))


# uid -> set(role ids), or None when the lookup failed. Cleared every cycle so a role
# change takes effect within a minute.
_ROLE_CACHE = {}


def member_roles(guild, uid):
    """This member's role ids, or None if we could not find out.

    Do NOT read msg["member"]: that field only exists on gateway MESSAGE_CREATE /
    MESSAGE_UPDATE events. Messages here come from GET /channels/{id}/messages, which
    never includes it, so the old check saw an empty role list for EVERYONE and the
    staff exemption silently never fired - the patrol would delete a Moderator's
    messages and time them out on the third strike.
    """
    if uid in _ROLE_CACHE:
        return _ROLE_CACHE[uid]
    code, data = common.discord("GET", "/guilds/%s/members/%s" % (guild, uid))
    roles = set(data.get("roles") or []) if (code == 200 and isinstance(data, dict)) else None
    _ROLE_CACHE[uid] = roles
    return roles


def is_exempt(guild, uid, staff):
    """True if this user must not be actioned.

    Fails CLOSED: an unreadable member lookup counts as exempt. Skipping enforcement
    for one user for one cycle is self-correcting; deleting an admin's messages because
    an API call blipped is not.
    """
    roles = member_roles(guild, uid)
    if roles is None:
        return True
    return bool(roles & set(staff or ()))


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


def scan_channel(ch, seen, now, policy):
    """Return {uid: {"name":.., "ids":set, "reasons":set}} of offenders in this
    channel, using the channel's resolved per-profile thresholds + media policy.

    Staff are NOT filtered here. Role lookups cost an API call each, so the exemption
    is applied in poll_once() to the handful of users who actually tripped a threshold
    rather than to all ~80 messages per channel. A quiet cycle costs zero extra calls.
    """
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
        if hkey(m.get("id")) in seen or is_bot(m):
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
    if state.get("v") != STATE_V:
        # v1 keyed by raw user id and stored raw message ids. Both name people in a
        # public file, so they are dropped rather than migrated - the only cost is that
        # in-flight warning counts reset once, and warnings reset at TIMEOUT_AT anyway.
        state = {"v": STATE_V, "users": {}, "seen": []}
    users = state.get("users", {})
    seen = set(state.get("seen", []))
    now = common.now_utc()
    actions = 0

    _ROLE_CACHE.clear()                  # fresh each cycle so role changes apply fast
    skipped_staff = 0

    for ch in channels:
        policy = modconfig.resolve_channel(modcfg, ch)
        offenders = scan_channel(ch, seen, now, policy)
        for uid, info in offenders.items():
            if is_exempt(guild, uid, staff):
                seen.update(hkey(i) for i in info["ids"])   # don't re-evaluate next cycle
                skipped_staff += 1
                continue
            removed = delete_messages(ch, info["ids"])
            seen.update(hkey(i) for i in info["ids"])
            u = users.setdefault(hkey(uid), {"warns": 0})
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
            # No username and no user id: this repo is PUBLIC, so Actions logs are
            # world-readable and retained for 90 days. The mod-log post above already
            # carries the full detail to the staff channel, where it belongs.
            print("acted: reasons=%s removed=%d" % (sorted(info["reasons"]), removed))

    state["v"] = STATE_V
    state["users"] = users
    state["seen"] = sorted(seen)[-2000:]
    common.save_json(common.state_path(STATE_FILE), state)
    if actions:                          # commit mid-loop so a crash can't re-act
        common.persist_state(STATE_FILE)
    if skipped_staff:
        print("skipped %d exempt (staff) offender(s)" % skipped_staff)
    print("Patrol cycle done. offenders acted on=%d" % actions)


def main():
    common.run_loop(poll_once)


if __name__ == "__main__":
    main()
