#!/usr/bin/env python3
"""iBoyPrime HQ - server polish (run at every deploy / manual dispatch; idempotent).

Small quality touches that make the server feel finished, all compare-before-PATCH
so re-runs are no-ops and rate limits are never hammered:

  1. Guild settings: a public description + the system channel (native "X joined"
     messages land in 👋-welcome instead of nowhere).
  2. Welcome screen (the "before you join" preview): a short pitch + up to 5
     featured channels.
  3. A topic/description on EVERY channel that lacks a curated one (topic PATCHes
     are rate-limited 2/10min per channel - compare-first means at most ONE patch
     per channel per run, and only when the text actually changed).
  4. The 🎭-get-roles "Roles & Pings" guide message (posted once, then edited in
     place - same pattern as the #bot-commands menu).

Std-lib only (uses common.py). Safe to re-run forever.
"""
import sys, time
import common

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

GUILD_DESCRIPTION = "Gaming, MMA fight nights and live streams with iBoyPrime — pick your vibe and jump in."

WELCOME_DESCRIPTION = "Gaming, MMA fight nights and live streams with iBoyPrime. Pick your vibe and jump in. 👊"
# channel name -> (short blurb <=50 chars, emoji). ONLY @everyone-visible channels are
# allowed here - Discord 400s on gated ones (MMA/Gaming/live are opt-in-to-reveal).
WELCOME_CHANNELS = [
    ("👋-welcome",           "Start here",                  "👋"),
    ("💬-general",           "Hang out with the Prime fam", "💬"),
    ("👋-introductions",     "Introduce yourself",          "🤝"),
    ("😂-memes",             "Fresh memes daily",           "😂"),
    ("✂️-clips-n-highlights", "Best clips & highlights",     "🎬"),
]

# Channel topics. The four bot feed channels (mma-news / rankings / on-this-day /
# fight-week) already get topics from bots_setup.py and are not repeated here.
TOPICS = {
    "👋-welcome":           "Start here — what this server is and where to go first.",
    "📜-rules":             "The server rules. Read once, vibe forever.",
    "📣-announcements":     "Official announcements from iBoyPrime and the team.",
    "🎉-server-updates":    "New features, creator milestones and server news.",
    "🎭-get-roles":         "Pick your roles & pings — control what you see and what pings you.",
    "🔴-live-now":          "iBoyPrime is LIVE — alerts land here the second a stream starts.",
    "📹-youtube-uploads":   "Every new iBoyPrime video, hot off the upload.",
    "✂️-clips-n-highlights": "Drop your best clips and stream highlights.",
    "💬-general":           "The main hangout — talk about anything.",
    "👋-introductions":     "New here? Introduce yourself and say what you're into.",
    "🖼️-media":             "Photos, art, wallpapers, screenshots — show us something cool.",
    "😂-memes":             "Fresh memes daily, auto-delivered. Post your own too.",
    "🎲-off-topic":         "Everything that doesn't fit anywhere else.",
    "🤖-bot-commands":      "Talk to the bots here — type / to see every command.",
    "🎮-gaming-chat":       "Gaming talk — what are you playing right now?",
    "🔎-looking-for-group": "Find a squad — post your game + platform + vibe.",
    "🏆-plays-n-clips":     "Your best plays. Clip it or it didn't happen.",
    "📅-game-nights":       "Community game nights — schedules and sign-ups.",
    "🥊-mma-chat":          "Fight talk — debates, takes and predictions welcome.",
    "🔥-fight-night":       "LIVE fight-night reactions — spoilers guaranteed in here.",
    "🎯-predictions":       "Call your shots before the cage door closes.",
    "📋-staff-chat":        "Staff coordination.",
    "🗒️-mod-log":           "AutoMod + patrol reports land here automatically.",
    "🎟️-tickets":           "Member reports and staff follow-ups.",
}

ROLES_GUIDE = (
    "# 🎭 Roles & Pings — you control everything\n\n"
    "**Change anything, anytime — it takes 10 seconds:**\n"
    "> 1️⃣ Tap the server name **iBoyPrime HQ** at the very top of the channel list\n"
    "> 2️⃣ Tap **Channels & Roles**\n"
    "> 3️⃣ Tick or untick whatever you want — it applies instantly\n"
    "*(Same steps on phone and PC. New members get asked these when they join; "
    "everyone can change their answers here whenever.)*\n\n"
    "**What the picks do:**\n\n"
    "**🧭 Interests** — unlock whole sections:\n"
    "🎮 **Gamer** reveals the GAMING channels · 🥊 **MMA Fan** reveals the MMA channels\n\n"
    "**🔔 Ping roles** — you're only ever pinged for what you opt into:\n"
    "🔴 **Live Pings** — the moment iBoyPrime goes live (also shows the channel)\n"
    "📹 **YouTube Pings** — every new video (also shows the channel)\n"
    "📣 **Announcements** — big server news\n"
    "🎉 **Events** — game nights & community events\n"
    "🥊 **Fight Alerts** — upcoming UFC/MMA cards\n"
    "🚨 **Fight Results** — instant results (⚠️ spoilers!)\n"
    "📰 **News Pings** — major BREAKING MMA news only (rare)\n"
    "🗞️ **Digest Ping** — one daily roundup of the day's headlines\n\n"
    "**👁️ Viewer roles** — see the live/video channels without ever being pinged.\n\n"
    "_The news feed is quiet by design: stories post silently in the news channel so you "
    "catch up when YOU want — only breaking news and the daily digest ever ping, and only "
    "the people who opted in._"
)


def welcome_guide(chan_by_name):
    """The 30-second orientation message for 👋-welcome (edit-in-place)."""
    def ref(name):
        ch = chan_by_name.get(name)
        return "<#%s>" % ch["id"] if ch else name
    return (
        "# 👋 Welcome to iBoyPrime HQ\n"
        "Gaming · MMA fight nights · live streams. The 30-second tour:\n\n"
        "🧭 **Pick your vibe** — the 🎮 Gaming and 🥊 MMA sections only appear once you "
        "choose them (new members get asked on the way in).\n"
        "🔔 **Pings are 100%% opt-in** — live streams, new videos, fight alerts, breaking "
        "news, the daily digest… you only get pinged for what you tick.\n"
        "📰 **News is quiet by design** — stories post silently, so you check them when "
        "you want, not when your phone decides.\n\n"
        "**Want to change what you see or what pings you?**\n"
        "> Tap the server name **iBoyPrime HQ** at the top → **Channels & Roles** → "
        "update your picks. Done.\n\n"
        "Full breakdown of every role: %s · Say hi: %s · Bot commands: %s"
        % (ref("🎭-get-roles"), ref("💬-general"), ref("🤖-bot-commands"))
    )


def patch_guild(gid, guild, chan_by_name):
    want = {}
    if (guild.get("description") or "") != GUILD_DESCRIPTION:
        want["description"] = GUILD_DESCRIPTION
    # join messages need a REGULAR text channel (Discord silently drops an
    # announcement channel like 👋-welcome) -> use 💬-general
    sysch = chan_by_name.get("💬-general")
    if sysch and sysch.get("type") == 0 and str(guild.get("system_channel_id")) != str(sysch["id"]):
        want["system_channel_id"] = sysch["id"]
    if not want:
        print("  guild settings: already current"); return
    code, resp = common.discord("PATCH", "/guilds/%s" % gid, want)
    if code in (200, 201):
        print("  guild settings updated:", ", ".join(want))
    else:
        print("  ! guild PATCH failed (HTTP %s): %s" % (code, str(resp)[:120]))


def patch_welcome_screen(gid, chan_by_name):
    code, cur = common.discord("GET", "/guilds/%s/welcome-screen" % gid)
    cur = cur if (code == 200 and isinstance(cur, dict)) else {}
    want_channels = []
    for name, blurb, emoji in WELCOME_CHANNELS:
        ch = chan_by_name.get(name)
        if ch:
            want_channels.append({"channel_id": str(ch["id"]), "description": blurb[:50],
                                  "emoji_id": None, "emoji_name": emoji})
    if not want_channels:
        print("  welcome screen: no known channels, skipped"); return
    cur_channels = [{"channel_id": str(c.get("channel_id")), "description": c.get("description"),
                     "emoji_id": c.get("emoji_id"), "emoji_name": c.get("emoji_name")}
                    for c in (cur.get("welcome_channels") or [])]
    if cur.get("description") == WELCOME_DESCRIPTION and cur_channels == want_channels:
        print("  welcome screen: already current"); return
    code, resp = common.discord("PATCH", "/guilds/%s/welcome-screen" % gid,
                                {"enabled": True, "description": WELCOME_DESCRIPTION[:140],
                                 "welcome_channels": want_channels})
    if code in (200, 201):
        print("  welcome screen set (%d featured channels)" % len(want_channels))
    else:
        print("  ! welcome screen PATCH failed (HTTP %s): %s" % (code, str(resp)[:120]))


def patch_topics(chan_by_name):
    changed = skipped = 0
    for name, topic in TOPICS.items():
        ch = chan_by_name.get(name)
        if not ch or ch.get("type") not in (0, 5):     # text/announcement only
            continue
        if (ch.get("topic") or "").strip() == topic:
            skipped += 1; continue
        code, resp = common.discord("PATCH", "/channels/%s" % ch["id"], {"topic": topic})
        if code in (200, 201):
            changed += 1
        elif code == 429:
            print("  ! topic rate-limited for %s - will catch it next run" % name)
        else:
            print("  ! topic failed (HTTP %s) for %s" % (code, name))
        time.sleep(0.35)
    print("  topics: %d set, %d already current" % (changed, skipped))


def upsert_guide(chan_by_name, channel_name, content, label, bot_id):
    """Keep exactly ONE bot-authored guide message in a channel: edit the newest in
    place when stale, delete strays, post if missing. Same pattern as commands_guide."""
    ch = chan_by_name.get(channel_name)
    if not ch:
        print("  ! %s not found, %s skipped" % (channel_name, label)); return
    _, msgs = common.discord("GET", "/channels/%s/messages?limit=50" % ch["id"])
    mine = [m for m in (msgs if isinstance(msgs, list) else [])
            if (m.get("author") or {}).get("id") == bot_id]
    if mine:
        keep = mine[0]
        if keep.get("content") != content:
            common.discord("PATCH", "/channels/%s/messages/%s" % (ch["id"], keep["id"]),
                           {"content": content})
            print("  %s: edited in place" % label)
        else:
            print("  %s: already current" % label)
        for m in mine[1:]:
            common.discord("DELETE", "/channels/%s/messages/%s" % (ch["id"], m["id"]))
    else:
        code, _ = common.post_message(ch["id"], content)
        print("  %s: posted (HTTP %s)" % (label, code))


def post_guides(chan_by_name):
    _, me = common.discord("GET", "/users/@me")
    bot_id = me.get("id") if isinstance(me, dict) else None
    upsert_guide(chan_by_name, "🎭-get-roles", ROLES_GUIDE, "roles guide", bot_id)
    upsert_guide(chan_by_name, "👋-welcome", welcome_guide(chan_by_name), "welcome guide", bot_id)


def main():
    cfg = common.load_config()
    gid = str(cfg.get("guild_id") or "").strip()
    if not gid:
        print("No guild_id in bots_config.json - run bots_setup.py first."); return
    code, guild = common.discord("GET", "/guilds/%s" % gid)
    if code != 200 or not isinstance(guild, dict):
        print("Could not fetch the guild (HTTP %s)." % code); return
    code, channels = common.discord("GET", "/guilds/%s/channels" % gid)
    if code != 200 or not isinstance(channels, list):
        print("Could not fetch channels (HTTP %s)." % code); return
    chan_by_name = {c["name"]: c for c in channels if c.get("type") != 4}

    print("[1/4] Guild description + join-message channel...")
    patch_guild(gid, guild, chan_by_name)
    print("[2/4] Welcome screen...")
    patch_welcome_screen(gid, chan_by_name)
    print("[3/4] Channel topics...")
    patch_topics(chan_by_name)
    print("[4/4] Roles & welcome guides...")
    post_guides(chan_by_name)
    print("DONE.")


if __name__ == "__main__":
    main()
