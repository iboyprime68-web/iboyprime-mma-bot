#!/usr/bin/env python3
"""Prime Arena - ACCESS & VISIBILITY (run at every deploy; idempotent).

This file used to *enable* Discord Onboarding with an opt-in-to-reveal model. That
model is exactly what broke the server: Discord opts a new member into the channels
in `default_channel_ids` and NOTHING else, so every other channel - including all
the voice channels, which had no permission overwrites at all - was hidden behind
"Channels & Roles -> Browse Channels". The owner hit this joining on a second
account and had to tick channels on by hand. Nobody discovers that.

So the model is inverted. This script now GUARANTEES zero-click visibility:

  1. UN-GATE everything except 🛠️ STAFF. The old gate() only ever *added* deny bits
     and had no inverse, so simply deleting the GATED_* constants would have left the
     denies written on the live guild forever. ungate_overwrites() is the mirror: it
     restores @everyone's VIEW (plus CONNECT/SPEAK on voice - the old gate never
     granted those, which is why voice was unusable even when visible) while
     PRESERVING every other bit, so read-only feeds stay read-only.
  2. DELETE the 16 retired roles - after the un-gate, because deleting a role also
     drops the overwrites that referenced it.
  3. DISABLE Onboarding, with empty prompts AND an empty default-channel list.
     Clearing the lists matters: channels named in onboarding stay pinned as
     "must be readable by everyone" (error 350003) even after a plain disable.

Std-lib only (imports common.py + layout.py). Safe to re-run forever.
"""
import sys, time
import common
import layout

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

VIEW = 1 << 10
CONNECT = 1 << 20
SPEAK = 1 << 21
VOICE_BITS = VIEW | CONNECT | SPEAK

# Kept as empty containers on purpose: selftests assert they stay empty so nobody
# reintroduces gating (and with it the invisible-channel bug) by accident.
GATED_CATEGORIES = {}
GATED_CHANNELS = {}
VIEWER_ROLES = {}

# Roles that keep explicit access to the staff category.
ALWAYS_VIEW_ROLES = ["👑 Owner", "🛡️ Admin", "🔨 Moderator"]


def ungate_overwrites(existing, everyone_id, is_voice=False, dead_role_ids=()):
    """Return overwrites with @everyone's visibility restored and everything else
    left alone.

    The bit-preserving read-modify-write is the whole point: 👋┊welcome,
    📣┊announcements and 📰┊news carry a SEND / CREATE_PUB_THREAD deny that keeps them
    read-only, and a naive 'clear the overwrites' would turn them into open chat."""
    by_id = {}
    for o in existing or []:
        if str(o["id"]) in set(str(r) for r in dead_role_ids):
            continue                      # overwrite for a role we're deleting
        by_id[str(o["id"])] = {"id": str(o["id"]), "type": o.get("type", 0),
                               "allow": int(o.get("allow", 0)), "deny": int(o.get("deny", 0))}
    bits = VOICE_BITS if is_voice else VIEW
    e = by_id.setdefault(str(everyone_id),
                         {"id": str(everyone_id), "type": 0, "allow": 0, "deny": 0})
    e["allow"] |= bits
    e["deny"] &= ~bits
    out = []
    for o in by_id.values():
        if not o["allow"] and not o["deny"]:
            continue                      # a no-op overwrite is just clutter
        out.append({"id": o["id"], "type": o["type"],
                    "allow": str(o["allow"]), "deny": str(o["deny"])})
    return out


def needs_ungate(ch, everyone_id, is_voice, dead_role_ids):
    """True when @everyone is missing any visibility bit, or a dead role still has an
    overwrite. Compare-first keeps re-runs to zero API calls."""
    bits = VOICE_BITS if is_voice else VIEW
    dead = set(str(r) for r in dead_role_ids)
    for o in ch.get("permission_overwrites") or []:
        if str(o["id"]) in dead:
            return True
        if str(o["id"]) == str(everyone_id):
            if int(o.get("deny", 0)) & bits:
                return True
            if (int(o.get("allow", 0)) & bits) != bits:
                return True
            return False
    return True                            # no @everyone overwrite -> write an explicit allow


def unhide_everything(gid, channels, dead_role_ids):
    """Restore visibility on every category and channel except the staff category."""
    staff_cat = next((c for c in channels
                      if c.get("type") == layout.CATEGORY and c["name"] == layout.STAFF_CATEGORY),
                     None)
    staff_id = str(staff_cat["id"]) if staff_cat else None

    fixed = skipped = 0
    for ch in channels:
        name = ch.get("name", ch["id"])
        if staff_id and (str(ch["id"]) == staff_id or str(ch.get("parent_id") or "") == staff_id):
            continue                       # 🛠️ STAFF stays hidden - that one is deliberate
        is_voice = ch.get("type") in (2, 13)
        if not needs_ungate(ch, gid, is_voice, dead_role_ids):
            skipped += 1
            continue
        ow = ungate_overwrites(ch.get("permission_overwrites"), gid, is_voice, dead_role_ids)
        code, resp = common.discord("PATCH", "/channels/%s" % ch["id"],
                                    {"permission_overwrites": ow})
        if code in (200, 204):
            print("  visible to everyone:", name)
            fixed += 1
        else:
            print("  ! un-gate failed (HTTP %s) for %s: %s" % (code, name, str(resp)[:120]))
        time.sleep(0.3)
    print("  %d channel(s) opened up, %d already visible" % (fixed, skipped))


def delete_dead_roles(gid, roles_by_name):
    """Remove every retired role. Idempotent: a name that's already gone is skipped."""
    removed = []
    for name in layout.ROLES_DELETE:
        rid = roles_by_name.get(name)
        if not rid:
            continue
        code, resp = common.discord("DELETE", "/guilds/%s/roles/%s" % (gid, rid))
        if code in (200, 204):
            print("  - deleted role:", name)
            removed.append(name)
            roles_by_name.pop(name, None)
        else:
            print("  ! could not delete role %s (HTTP %s): %s" % (name, code, str(resp)[:120]))
        time.sleep(0.3)
    return removed


def disable_onboarding(gid):
    """Turn Onboarding off AND clear its channel list. Both halves matter - see the
    module docstring (error 350003 pins onboarding channels even after a disable)."""
    code, resp = common.discord("PUT", "/guilds/%s/onboarding" % gid,
                                {"prompts": [], "default_channel_ids": [],
                                 "enabled": False, "mode": 0})
    if code in (200, 204):
        print("  onboarding is OFF - members see every channel they have access to")
        return True
    print("  ! onboarding disable FAILED (HTTP %s): %s" % (code, str(resp)[:300]))
    print("    Manual fallback: Server Settings -> Onboarding -> toggle it Off.")
    return False


def main():
    cfg = common.load_config()
    gid = str(cfg.get("guild_id") or "").strip()
    if not gid:
        print("No guild_id in bots_config.json - run bots_setup.py first.")
        return

    code, channels = common.discord("GET", "/guilds/%s/channels" % gid)
    if code != 200 or not isinstance(channels, list):
        print("Could not fetch channels (HTTP %s) - is the bot in the server?" % code)
        return
    code, roles = common.discord("GET", "/guilds/%s/roles" % gid)
    if code != 200 or not isinstance(roles, list):
        print("Could not fetch roles (HTTP %s)." % code)
        return

    roles_by_name = {r["name"]: r["id"] for r in roles}
    dead_role_ids = [roles_by_name[n] for n in layout.ROLES_DELETE if n in roles_by_name]
    print("Guild:", gid, "| channels:", len(channels), "| roles:", len(roles))

    print("[1/3] Opening up every channel (staff category stays hidden)...")
    unhide_everything(gid, channels, dead_role_ids)

    print("[2/3] Removing retired roles...")
    removed = delete_dead_roles(gid, roles_by_name)
    print("  %d role(s) removed, %d role(s) remain" % (len(removed), len(roles) - len(removed)))

    print("[3/3] Confirming Onboarding stays disabled...")
    disable_onboarding(gid)

    print("DONE.")


if __name__ == "__main__":
    main()
