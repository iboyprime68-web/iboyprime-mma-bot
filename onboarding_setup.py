#!/usr/bin/env python3
"""iBoyPrime HQ - onboarding + opt-in channel visibility (run once / re-runnable).

WHY: members should fully control what they see and get pinged for, with one hard
rule from the owner: if you turn a notification OFF, the channel disappears too -
nobody should be pinged for a channel they can't even see.

WHAT this does (idempotent, safe to re-run; the bot is Admin so it is NEVER locked
out, and the owner is Admin so they are unaffected):

  1. Ensures the view-only roles exist (👁️ Live Viewer, 👁️ Videos Viewer).

  2. OPT-IN-TO-REVEAL visibility - a channel is hidden from @everyone and shown only
     to the roles that opted in. Crucially the PING role itself grants VIEW, so
     "you got pinged" ALWAYS implies "you can see it":
       Gated CATEGORIES:
         🎮 GAMING               -> 🎮 Gamer
         🥊 MMA & COMBAT SPORTS  -> 🥊 MMA Fan
       Gated CHANNELS (notifications + visibility, the new bit):
         🔴-live-now        -> 🔴 Live Pings (ping+see)  +  👁️ Live Viewer (see only)
         📹-youtube-uploads -> 📹 YouTube Pings (ping+see) + 👁️ Videos Viewer (see only)
       Always visible (baseline, never gated): 🌟 START HERE, 💬 COMMUNITY, the rest
         of 📺 CONTENT & STREAMS (✂️ clips, 🔔 notify-setup), 🔊 VOICE. STAFF stays hidden.

  3. Enables Onboarding (PUT /guilds/{id}/onboarding, mode=ADVANCED) with a VALID
     default-channel set (>=7 channels, >=5 writable) and 4 prompts. The LIVE and
     VIDEOS prompts are single-select: "🔔 ping + show" / "👁️ just show" / skip
     (=stays hidden). It CHECKS the response and prints a manual fallback on failure.

Onboarding shows on JOIN / REJOIN. Members already in the server can change picks
anytime via Channels & Roles (see 🎭-get-roles). Std-lib only (imports common.py).
"""
import sys, time
import common

# This script runs locally (Windows) during deploy and prints emoji channel/role
# names; force UTF-8 so a legacy console codepage can't crash it. Harmless on Linux.
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

VIEW = 1 << 10                       # VIEW_CHANNEL permission bit

# View-only roles this script creates (name -> color). They grant channel VISIBILITY
# without ever being a ping target, so a member can "see but not be pinged".
VIEWER_ROLES = {
    "👁️ Live Viewer":   0x99AAB5,
    "👁️ Videos Viewer": 0x99AAB5,
}

# Whole categories revealed only when the member opts in (category name -> opt-in role).
GATED_CATEGORIES = {
    "🎮 GAMING":              "🎮 Gamer",
    "🥊 MMA & COMBAT SPORTS": "🥊 MMA Fan",
}

# Individual channels revealed only when opted in (channel name -> roles that can see it).
# The PING role is FIRST in each list - that is what guarantees "pinged => can see it".
GATED_CHANNELS = {
    "🔴-live-now":        ["🔴 Live Pings",   "👁️ Live Viewer"],
    "📹-youtube-uploads": ["📹 YouTube Pings", "👁️ Videos Viewer"],
}

# Roles that must keep VIEW on every gated thing: staff moderate everything and bots
# post there. (Owner/Admin usually bypass via Administrator; granting VIEW explicitly
# is harmless and covers staff roles that are NOT administrators.)
ALWAYS_VIEW_ROLES = ["👑 Owner", "🛡️ Admin", "🔨 Moderator", "🤖 Bots"]

# The onboarding "default channels" - what EVERY member lands in regardless of choices.
# Discord needs >=7 of these with >=5 writable by @everyone (the COMMUNITY block gives
# 6 writable + clips = 7). The gated live/video channels are intentionally NOT here
# (default channels must be @everyone-viewable). Missing names are skipped.
DEFAULT_CHANNELS = [
    "👋-welcome", "📜-rules", "📣-announcements", "🎉-server-updates", "🎭-get-roles",
    "💬-general", "👋-introductions", "🖼️-media", "😂-memes", "🎲-off-topic", "🤖-bot-commands",
    "✂️-clips-n-highlights", "🔔-notify-setup",
]


def ensure_role(gid, name, color, role_by_name):
    """Create a hidden, non-mentionable, no-permission role if it's missing. Idempotent."""
    if name in role_by_name:
        return role_by_name[name]
    code, r = common.discord("POST", "/guilds/%s/roles" % gid,
                             {"name": name, "color": color, "hoist": False,
                              "mentionable": False, "permissions": "0"})
    if code in (200, 201) and isinstance(r, dict) and r.get("id"):
        role_by_name[name] = r["id"]
        print("  + role:", name)
        time.sleep(0.3)
        return r["id"]
    print("  ! could not create role %s (HTTP %s)" % (name, code))
    return None


def gate_overwrites(existing, everyone_id, allow_role_ids):
    """Hide a channel from @everyone, show it to allow_role_ids, and PRESERVE every
    other allow/deny bit already on the channel (so read-only feeds stay read-only)."""
    by_id = {}
    for o in existing or []:
        by_id[str(o["id"])] = {"id": str(o["id"]), "type": o.get("type", 0),
                               "allow": int(o.get("allow", 0)), "deny": int(o.get("deny", 0))}
    e = by_id.setdefault(str(everyone_id), {"id": str(everyone_id), "type": 0, "allow": 0, "deny": 0})
    e["allow"] &= ~VIEW                   # @everyone can no longer see it...
    e["deny"]  |= VIEW
    for rid in allow_role_ids:            # ...but the opt-in role(s) (and staff/bots) can
        r = by_id.setdefault(str(rid), {"id": str(rid), "type": 0, "allow": 0, "deny": 0})
        r["allow"] |= VIEW
        r["deny"]  &= ~VIEW
    return [{"id": o["id"], "type": o["type"], "allow": str(o["allow"]), "deny": str(o["deny"])}
            for o in by_id.values()]


def apply_visibility(gid, cat_by_name, chan_by_name, children, role_by_name):
    always_view = [role_by_name[n] for n in ALWAYS_VIEW_ROLES if n in role_by_name]

    def gate(ch, role_names, label):
        allow_ids = [role_by_name[n] for n in role_names if n in role_by_name] + always_view
        ow = gate_overwrites(ch.get("permission_overwrites"), gid, allow_ids)
        code, resp = common.discord("PATCH", "/channels/%s" % ch["id"], {"permission_overwrites": ow})
        if code in (200, 204):
            print("  gated (%s): %s" % (label, ch.get("name", ch["id"])))
        else:
            print("  ! gate failed (HTTP %s) for %s: %s" % (code, ch.get("name"), str(resp)[:120]))
        time.sleep(0.3)

    # 1. Gated CATEGORIES (category + every child channel)
    for cat_name, role_name in GATED_CATEGORIES.items():
        cat = cat_by_name.get(cat_name)
        if not cat:
            print("  ! category not found, skipped:", cat_name); continue
        if role_name not in role_by_name:
            print("  ! opt-in role '%s' not found - leaving '%s' visible." % (role_name, cat_name)); continue
        for ch in [cat] + children.get(str(cat["id"]), []):
            gate(ch, [role_name], role_name)

    # 2. Gated individual CHANNELS (live-now, youtube-uploads): ping role + viewer role
    for chan_name, role_names in GATED_CHANNELS.items():
        ch = chan_by_name.get(chan_name)
        if not ch:
            print("  ! channel not found, skipped:", chan_name); continue
        present = [n for n in role_names if n in role_by_name]
        if not present:
            print("  ! no opt-in roles found for %s - leaving it visible." % chan_name); continue
        gate(ch, role_names, " / ".join(present))


def build_onboarding(chan_by_name, role_by_name):
    def cid(n): return chan_by_name[n]["id"] if n in chan_by_name else None
    def rid(n): return role_by_name.get(n)

    default_ch = [cid(n) for n in DEFAULT_CHANNELS if cid(n)]

    def opt(i, title, desc, emoji, role_names, chan_names=()):
        # Discord caps option title at 50 and description at 100 chars; truncate as a
        # backstop so an over-length string can never 400 the whole onboarding PUT.
        return {"id": str(900000000000000000 + i), "title": title[:50], "description": desc[:100],
                "emoji": {"name": emoji} if emoji else None,
                "role_ids": [rid(n) for n in role_names if rid(n)],
                "channel_ids": [cid(n) for n in chan_names if cid(n)]}

    prompts = [
        # P1 - interests gate the Gaming / MMA categories (multi-select).
        {"id": "900000000000000100", "type": 0, "single_select": False, "required": False, "in_onboarding": True,
         "title": "What are you into?", "options": [
            opt(1, "Gaming", "Squad up & game nights - unlocks the Gaming channels", "🎮", ["🎮 Gamer"]),
            opt(2, "MMA & Combat Sports", "Fight nights, picks & debates - unlocks the MMA channels", "🥊", ["🥊 MMA Fan"])]},
        # P2 - LIVE: single-select so picking a ping also reveals the channel (never pinged-but-blind).
        {"id": "900000000000000200", "type": 0, "single_select": True, "required": False, "in_onboarding": True,
         "title": "When iBoyPrime goes LIVE (Twitch · Kick · YouTube)", "options": [
            opt(11, "🔔 Ping me + show #live-now", "A ping every time the stream starts.", "🔔", ["🔴 Live Pings"]),
            opt(12, "👁️ Just show me #live-now (no pings)", "See the channel, never get pinged.", "👁️", ["👁️ Live Viewer"])]},
        # P3 - VIDEOS: same single-select pattern.
        {"id": "900000000000000300", "type": 0, "single_select": True, "required": False, "in_onboarding": True,
         "title": "New YouTube videos", "options": [
            opt(21, "🔔 Ping me + show #youtube-uploads", "A ping on every new upload.", "🔔", ["📹 YouTube Pings"]),
            opt(22, "👁️ Just show me #youtube-uploads (no pings)", "See the channel, never get pinged.", "👁️", ["👁️ Videos Viewer"])]},
        # P4 - the rest of the pings (multi-select). Folds in the old announcements/events + MMA-updates
        # prompts so we stay within Discord's 4-prompt limit.
        {"id": "900000000000000400", "type": 0, "single_select": False, "required": False, "in_onboarding": True,
         "title": "More pings (optional)", "options": [
            opt(31, "Server announcements", "Important server news", "📣", ["📣 Announcements"]),
            opt(32, "Events & game nights", "Community events", "🎉", ["🎉 Events"]),
            opt(33, "🥊 Upcoming fight alerts", "Get pinged with upcoming UFC/MMA cards.", "🥊", ["🥊 Fight Alerts"]),
            opt(34, "🚨 Fight RESULTS - spoiler warning",
                "Unlocks the fight-results forum and pings results. You WILL see spoilers - leave OFF to avoid them.",
                "🚨", ["🚨 Fight Results"])]},
    ]
    # Discord 400s on an option with no role/channel and on a prompt with no options.
    for p in prompts:
        p["options"] = [o for o in p["options"] if o["role_ids"] or o["channel_ids"]]
    prompts = [p for p in prompts if p["options"]]
    return default_ch, prompts


def main():
    cfg = common.load_config()
    gid = str(cfg.get("guild_id") or "").strip()
    if not gid:
        print("No guild_id in bots_config.json - run bots_setup.py first."); return

    code, channels = common.discord("GET", "/guilds/%s/channels" % gid)
    if code != 200 or not isinstance(channels, list):
        print("Could not fetch channels (HTTP %s) - is the bot in the server?" % code); return
    code, roles = common.discord("GET", "/guilds/%s/roles" % gid)
    if code != 200 or not isinstance(roles, list):
        print("Could not fetch roles (HTTP %s)." % code); return

    role_by_name = {r["name"]: r["id"] for r in roles}
    cat_by_name  = {c["name"]: c for c in channels if c.get("type") == 4}
    chan_by_name = {c["name"]: c for c in channels if c.get("type") != 4}
    children = {}
    for c in channels:
        if c.get("parent_id"):
            children.setdefault(str(c["parent_id"]), []).append(c)

    print("Guild:", gid, "| channels:", len(channels), "| roles:", len(roles))

    print("[1/3] Ensuring view-only roles exist...")
    for name, color in VIEWER_ROLES.items():
        ensure_role(gid, name, color, role_by_name)

    print("[2/3] Applying opt-in-to-reveal visibility (Gaming/MMA + live/videos hidden until chosen)...")
    apply_visibility(gid, cat_by_name, chan_by_name, children, role_by_name)

    print("[3/3] Enabling onboarding...")
    default_ch, prompts = build_onboarding(chan_by_name, role_by_name)
    writable_hint = sum(1 for n in ("💬-general", "👋-introductions", "🖼️-media", "😂-memes",
                                    "🎲-off-topic", "🤖-bot-commands", "✂️-clips-n-highlights")
                        if n in chan_by_name)
    print("  default channels: %d (>=7 needed) | writable: %d (>=5 needed) | prompts: %d"
          % (len(default_ch), writable_hint, len(prompts)))
    code, resp = common.discord("PUT", "/guilds/%s/onboarding" % gid,
                                {"prompts": prompts, "default_channel_ids": default_ch,
                                 "enabled": True, "mode": 1})
    if code in (200, 204):
        print("OK onboarding ENABLED - new members now get the pick-your-interests screen.")
    else:
        print("!! onboarding enable FAILED (HTTP %s): %s" % (code, str(resp)[:300]))
        print("   Manual fallback (2 clicks): Discord -> Server Settings -> Onboarding ->")
        print("   toggle it On (Default Channels are already set up correctly by this script).")
        print("   Community mode + a Rules channel must be on first (they are).")

    print("DONE.")


if __name__ == "__main__":
    main()
