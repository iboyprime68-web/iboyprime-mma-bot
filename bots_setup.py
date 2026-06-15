#!/usr/bin/env python3
"""iBoyPrime HQ - setup for the cron bots (std-lib only, safe to re-run).

Consolidates everything into the single '🥊 MMA & COMBAT SPORTS' category:
  * ensures the feed channels (mma-news, rankings, on-this-day) + fight-week
    forum exist INSIDE that category (moving them there if an older deploy put
    them under a separate 'MMA FEEDS' category),
  * deletes the now-obsolete 'MMA FEEDS' category, the reddit-mma channel, the
    odds-movers channel, and the redundant fight-schedule channel,
  * references existing channels/roles the bots reuse (memes, live-now, rules,
    mod-log, staff roles, patrol channels),
  * writes bots_config.json.

The bot has Administrator, so read-only overwrites don't stop it posting.
"""
import os, json, time, urllib.request, urllib.error

TOKEN    = os.environ.get("DISCORD_BOT_TOKEN", "")
if not TOKEN:
    raise SystemExit("ERROR: set the DISCORD_BOT_TOKEN secret/env var.")
GUILD_ID = os.environ.get("DISCORD_GUILD_ID", "1502831752702464113")
HERE     = os.path.dirname(os.path.abspath(__file__))
API = "https://discord.com/api/v10"
H = {"Authorization": "Bot " + TOKEN, "Content-Type": "application/json",
     "User-Agent": "iBoyPrimeHQ-setup (https://iboyprime, 1.0)"}

P = {n: 1 << b for n, b in {
    "ADD_REACTIONS": 6, "VIEW_CHANNEL": 10, "SEND_MESSAGES": 11, "EMBED_LINKS": 14,
    "ATTACH_FILES": 15, "READ_HISTORY": 16, "CREATE_PUB_THREAD": 35,
    "CREATE_PRIV_THREAD": 36, "SEND_IN_THREADS": 38,
}.items()}
READ   = P["VIEW_CHANNEL"] | P["READ_HISTORY"] | P["ADD_REACTIONS"] | P["SEND_IN_THREADS"]
NO_NEW = P["CREATE_PUB_THREAD"] | P["CREATE_PRIV_THREAD"]
NO_SEND = P["SEND_MESSAGES"] | NO_NEW

MMA_CATEGORY = "🥊 MMA & COMBAT SPORTS"      # everything consolidates here
OLD_CATEGORY = "📰 MMA FEEDS"                # to be removed

# feed channels that must live in the MMA category. key -> (name, type, topic)
FEED_CHANNELS = [
    ("mma_news",    "🥊-mma-news",    0, "Latest MMA headlines - auto-posted from the major outlets."),
    ("rankings",    "📊-rankings",    0, "Live UFC rankings board + movement alerts."),
    ("on_this_day", "📅-on-this-day", 0, "On this day in MMA history + daily trivia."),
]
FORUMS = [
    ("fight_week",  "🗓️-fight-week",  "Per-card hubs: full card & a prediction poll. Opens fight week."),
]
# obsolete channels/category to delete if present
DELETE_CHANNELS = ["👽-reddit-mma", "📈-odds-movers", "📅-fight-schedule"]

EXISTING_CHANNELS = {
    "memes":          "😂-memes",
    "live_now":       "🔴-live-now",
    "server_updates": "🎉-server-updates",
    "announcements":  "📣-announcements",
    "predictions":    "🎯-predictions",
    "fight_night":    "🔥-fight-night",
    "rules":          "📜-rules",
    "mod_log":        "🗒️-mod-log",
    "bot_commands":   "🤖-bot-commands",
}
EXISTING_ROLES = {
    "live_pings":    "🔴 Live Pings",
    "youtube_pings": "📹 YouTube Pings",
    "announce_role": "📣 Announcements",
    "events_role":   "🎉 Events",
    "fight_alerts":  "🥊 Fight Alerts",
    "owner":         "👑 Owner",
    "admin":         "🛡️ Admin",
    "mod":           "🔨 Moderator",
}
PATROL_NAMES = ["💬-general", "🎮-gaming-chat", "🥊-mma-chat", "🎲-off-topic", "😂-memes", "👋-introductions"]


def api(method, path, body=None, tries=6):
    data = json.dumps(body).encode() if body is not None else None
    for _ in range(tries):
        try:
            req = urllib.request.Request(API + path, data=data, headers=H, method=method)
            with urllib.request.urlopen(req, timeout=30) as r:
                raw = r.read().decode()
                return r.status, (json.loads(raw) if raw else {})
        except urllib.error.HTTPError as e:
            raw = e.read().decode()
            if e.code == 429:
                try: w = float(json.loads(raw).get("retry_after", 2))
                except Exception: w = 2
                time.sleep(w + 0.3); continue
            raise RuntimeError("%s %s -> %s: %s" % (method, path, e.code, raw[:200]))
        except urllib.error.URLError:
            time.sleep(2)
    raise RuntimeError("request failed: " + path)


def ow(rid, allow=0, deny=0):
    return {"id": str(rid), "type": 0, "allow": str(allow), "deny": str(deny)}


def main():
    everyone = GUILD_ID
    _, guild = api("GET", "/guilds/" + GUILD_ID)
    roles = {r["name"]: r["id"] for r in guild.get("roles", [])}
    print("Server:", guild.get("name"))
    staff_ids = [roles[n] for n in ("👑 Owner", "🛡️ Admin", "🔨 Moderator") if n in roles]

    _, chan_list = api("GET", "/guilds/" + GUILD_ID + "/channels")
    chans = {c["name"]: c for c in chan_list}

    mma_cat = next((c["id"] for c in chan_list if c["type"] == 4 and c["name"] == MMA_CATEGORY), None)
    if not mma_cat:
        _, c = api("POST", "/guilds/" + GUILD_ID + "/channels", {"name": MMA_CATEGORY, "type": 4})
        mma_cat = c["id"]; print("  + category:", MMA_CATEGORY); time.sleep(0.4)

    read_only_ow = [ow(everyone, allow=READ, deny=NO_SEND)] + [ow(s, allow=READ | P["SEND_MESSAGES"]) for s in staff_ids]
    forum_ow     = [ow(everyone, allow=READ, deny=NO_NEW)]
    out_channels = {}

    def ensure(name, ctype, topic, overwrites):
        c = chans.get(name)
        if c:
            if str(c.get("parent_id")) != str(mma_cat):
                api("PATCH", "/channels/" + c["id"], {"parent_id": mma_cat})
                print("  ~ moved into MMA category:", name); time.sleep(0.35)
            return c["id"]
        body = {"name": name, "type": ctype, "topic": topic,
                "parent_id": mma_cat, "permission_overwrites": overwrites}
        _, c = api("POST", "/guilds/" + GUILD_ID + "/channels", body)
        chans[name] = c; print("  + channel:", name); time.sleep(0.45)
        return c["id"]

    for key, name, ctype, topic in FEED_CHANNELS:
        out_channels[key] = ensure(name, ctype, topic, read_only_ow)
    for key, name, topic in FORUMS:
        out_channels[key] = ensure(name, 15, topic, forum_ow)

    # delete obsolete channels
    for name in DELETE_CHANNELS:
        c = chans.get(name)
        if c:
            try:
                api("DELETE", "/channels/" + c["id"]); print("  - deleted channel:", name); time.sleep(0.35)
                chans.pop(name, None)
            except Exception as e:
                print("  ! could not delete", name, e)

    # delete the obsolete MMA FEEDS category (children already moved out)
    old_cat = next((c for c in chan_list if c["type"] == 4 and c["name"] == OLD_CATEGORY), None)
    if old_cat:
        _, fresh = api("GET", "/guilds/" + GUILD_ID + "/channels")
        kids = [c for c in fresh if str(c.get("parent_id")) == str(old_cat["id"])]
        if not kids:
            try:
                api("DELETE", "/channels/" + old_cat["id"]); print("  - deleted category:", OLD_CATEGORY)
            except Exception as e:
                print("  ! could not delete category", e)
        else:
            print("  ! MMA FEEDS still has channels, left in place:", [k["name"] for k in kids])

    for key, name in EXISTING_CHANNELS.items():
        if name in chans:
            out_channels[key] = chans[name]["id"]
        else:
            print("  ! existing channel not found (skipped):", name)

    out_roles = {}
    for key, name in EXISTING_ROLES.items():
        if name in roles:
            out_roles[key] = roles[name]
        else:
            print("  ! role not found (skipped):", name)

    patrol = [chans[n]["id"] for n in PATROL_NAMES if n in chans]

    mma = {}
    for mp in (os.path.join(HERE, "mma_config.json"),
               os.path.join(os.path.dirname(HERE), "mma_config.json")):
        if os.path.exists(mp):
            try:
                mma = json.load(open(mp, encoding="utf-8")); break
            except Exception:
                pass

    cfg = {
        "guild_id": GUILD_ID,
        "channels": out_channels,
        "roles": out_roles,
        "patrol_channels": patrol,
        "mma": {
            "upcoming_forum_id": mma.get("upcoming_forum_id"),
            "results_forum_id":  mma.get("results_forum_id"),
            "alerts_role_id":    mma.get("alerts_role_id"),
            "results_role_id":   mma.get("results_role_id"),
        },
        "creator": {
            "twitch_login": os.environ.get("TWITCH_LOGIN", "iboyprime"),
            "kick_slug":    os.environ.get("KICK_SLUG", "iboyprime"),
            "youtube_handle": os.environ.get("YOUTUBE_HANDLE", "iboyprime_official"),
            "youtube_channel_id": ("" if "PASTE" in os.environ.get("YOUTUBE_CHANNEL_ID", "").upper()
                                   else os.environ.get("YOUTUBE_CHANNEL_ID", "")),
            "tiktok_handle": os.environ.get("TIKTOK_HANDLE", "iboyprime"),
        },
    }
    with open(os.path.join(HERE, "bots_config.json"), "w", encoding="utf-8") as f:
        json.dump(cfg, f, indent=2, ensure_ascii=False)
    print("\nWrote bots_config.json")
    print("MMA category now holds:", ", ".join(sorted(out_channels)))
    print("DONE.")


if __name__ == "__main__":
    main()
