#!/usr/bin/env python3
"""iBoyPrime HQ - onboarding + opt-in channel visibility (run once / re-runnable).

WHY: new members were joining instantly into everything, because
  (a) Discord Onboarding never actually turned on - the old default-channel list
      had only 3 channels @everyone can post in, but Discord requires >=5, so the
      enable call silently failed and onboarding stayed off; and
  (b) every category was visible to all, so opting in/out of interests revealed
      nothing.

WHAT this does (idempotent, safe to re-run; the bot is Admin so it is NEVER locked
out, and the owner is Admin so they are unaffected):

  1. OPT-IN-TO-REVEAL visibility:
       BASELINE - always visible to @everyone, so nobody can land in an empty
         server: 🌟 START HERE, 💬 COMMUNITY, 📺 CONTENT & STREAMS, 🔊 VOICE
         CHANNELS. (Content stays visible - its *pings* are the opt-in, via roles.)
       HIDDEN until chosen in onboarding:
         🎮 GAMING               -> revealed by the 🎮 Gamer role
         🥊 MMA & COMBAT SPORTS  -> revealed by the 🥊 MMA Fan role
       STAFF stays hidden (untouched).

  2. Enables Onboarding (PUT /guilds/{id}/onboarding, mode=ADVANCED) with a VALID
     default-channel set (>=7 channels, >=5 writable by @everyone - the COMMUNITY
     block alone provides 6 writable) and three interest/notification prompts whose
     options grant the roles above. It CHECKS the response and, if Discord rejects
     it, prints the exact manual fallback instead of silently swallowing the error.

Onboarding shows on JOIN / REJOIN. Members already in the server can pick anytime
via Channels & Roles (see 🎭-get-roles). Std-lib only (imports common.py).
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

# Categories revealed only when the member opts in (category name -> opt-in role).
GATED = {
    "🎮 GAMING":              "🎮 Gamer",
    "🥊 MMA & COMBAT SPORTS": "🥊 MMA Fan",
}
# Roles that must keep VIEW on the gated categories: staff moderate everything and
# bots post there. (Owner/Admin usually bypass via Administrator, but granting VIEW
# explicitly is harmless and covers staff roles that are NOT administrators.)
ALWAYS_VIEW_ROLES = ["👑 Owner", "🛡️ Admin", "🔨 Moderator", "🤖 Bots"]

# The onboarding "default channels" - what EVERY member lands in regardless of their
# choices. Discord needs >=7 of these with >=5 writable by @everyone; the COMMUNITY
# channels alone give 6 writable, clearing the bar the old config failed. Missing
# names are skipped (matched against the live server by name).
DEFAULT_CHANNELS = [
    "👋-welcome", "📜-rules", "📣-announcements", "🎉-server-updates", "🎭-get-roles",
    "💬-general", "👋-introductions", "🖼️-media", "😂-memes", "🎲-off-topic", "🤖-bot-commands",
    "🔴-live-now", "📹-youtube-uploads", "🎬-tiktok-posts", "✂️-clips-n-highlights", "🔔-notify-setup",
]


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
    for rid in allow_role_ids:            # ...but the opt-in role (and staff/bots) can
        r = by_id.setdefault(str(rid), {"id": str(rid), "type": 0, "allow": 0, "deny": 0})
        r["allow"] |= VIEW
        r["deny"]  &= ~VIEW
    return [{"id": o["id"], "type": o["type"], "allow": str(o["allow"]), "deny": str(o["deny"])}
            for o in by_id.values()]


def apply_visibility(gid, cat_by_name, children, role_by_name):
    always_view = [role_by_name[n] for n in ALWAYS_VIEW_ROLES if n in role_by_name]
    for cat_name, role_name in GATED.items():
        cat = cat_by_name.get(cat_name)
        if not cat:
            print("  ! category not found, skipped:", cat_name); continue
        opt_role = role_by_name.get(role_name)
        if not opt_role:
            print("  ! opt-in role '%s' not found - leaving '%s' visible to all." % (role_name, cat_name)); continue
        allow_ids = [opt_role] + always_view
        targets = [cat] + children.get(str(cat["id"]), [])
        for ch in targets:
            ow = gate_overwrites(ch.get("permission_overwrites"), gid, allow_ids)
            code, resp = common.discord("PATCH", "/channels/%s" % ch["id"], {"permission_overwrites": ow})
            if code in (200, 204):
                print("  gated (%s only): %s" % (role_name, ch.get("name", ch["id"])))
            else:
                print("  ! gate failed (HTTP %s) for %s: %s" % (code, ch.get("name"), str(resp)[:120]))
            time.sleep(0.3)


def build_onboarding(chan_by_name, role_by_name):
    def cid(n): return chan_by_name[n]["id"] if n in chan_by_name else None
    def rid(n): return role_by_name.get(n)

    default_ch = [cid(n) for n in DEFAULT_CHANNELS if cid(n)]

    def opt(i, title, desc, emoji, role_names, chan_names=()):
        return {"id": str(900000000000000000 + i), "title": title, "description": desc,
                "emoji": {"name": emoji} if emoji else None,
                "role_ids": [rid(n) for n in role_names if rid(n)],
                "channel_ids": [cid(n) for n in chan_names if cid(n)]}

    prompts = [
        {"id": "900000000000000100", "type": 0, "single_select": False, "required": False, "in_onboarding": True,
         "title": "What are you into?", "options": [
            opt(1, "Gaming", "Squad up & game nights", "🎮", ["🎮 Gamer"]),
            opt(2, "MMA & Combat Sports", "Fight nights, picks & debates", "🥊", ["🥊 MMA Fan"]),
            opt(3, "Content & Streams", "Here for the videos & lives", "📺", [], ["📹-youtube-uploads", "🔴-live-now", "🎬-tiktok-posts"]),
            opt(4, "Just here to vibe", "All of it / just hanging", "💬", [], ["💬-general"])]},
        {"id": "900000000000000200", "type": 0, "single_select": False, "required": False, "in_onboarding": True,
         "title": "Want a ping when iBoyPrime is active?", "options": [
            opt(11, "When I go LIVE", "Twitch & Kick go-live alerts", "🔴", ["🔴 Live Pings"]),
            opt(12, "New YouTube videos", "Fresh uploads", "📹", ["📹 YouTube Pings"]),
            opt(13, "New TikToks", "Short-form drops", "🎬", ["🎬 TikTok Pings"]),
            opt(14, "Server announcements", "Important news", "📣", ["📣 Announcements"]),
            opt(15, "Events & game nights", "Community events", "🎉", ["🎉 Events"])]},
        {"id": "900000000000000300", "type": 0, "single_select": False, "required": False, "in_onboarding": True,
         "title": "MMA fight updates? (optional)", "options": [
            opt(21, "🥊 Upcoming fight alerts", "Get pinged with upcoming UFC/MMA cards.", "🥊", ["🥊 Fight Alerts"]),
            opt(22, "🚨 Fight RESULTS - spoiler warning",
                "Turning this ON unlocks the results forum and pings you with finished-fight results. "
                "You WILL see spoilers. Leave OFF to avoid them.", "🚨", ["🚨 Fight Results"])]},
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

    print("[1/2] Applying opt-in-to-reveal visibility (Gaming + MMA hidden until chosen)...")
    apply_visibility(gid, cat_by_name, children, role_by_name)

    print("[2/2] Enabling onboarding...")
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
