#!/usr/bin/env python3
"""Prime Arena - THE server layout. Single source of truth. Std-lib only, no I/O.

WHY THIS FILE EXISTS
--------------------
The layout used to be duplicated across build_iboyprime.py, bots_setup.py,
onboarding_setup.py, server_polish.py and the selftest fixtures, with nothing
enforcing agreement. Two silent failure modes came out of that:

  * bots_setup.ensure() CREATES a channel when the exact name is missing, so a
    rename in one file and not another duplicated the channel instead of erroring.
  * a name miss in the lookup table just printed "! existing channel not found"
    and dropped the key from bots_config.json - after which the bot that owns
    that key silently no-ops forever, while its workflow still reports success.

Everything now derives from CATEGORIES below. A selftest asserts that every
name list in every consumer is a subset of `all_names()`, so drift fails CI
instead of quietly breaking the server.

NAMING (owner's rule, Aug 2026): channels are `<emoji>┊<word>` using U+250A.
No dashes; one word wherever possible. Category names stay plain caps.
Discord lowercases text/forum names and preserves ┊ and leading emoji; voice
names keep their case.

RENAMES ARE SAFE because every spec carries `old_names`: the setup does
find-by-new-name -> find-by-any-old-name-and-PATCH -> create, in that order.
A name may appear in `old_names` OR in DELETE_CHANNELS, never both.
"""

TEXT, VOICE, CATEGORY, NEWS, FORUM = 0, 2, 4, 5, 15

SEPARATOR = "┊"        # ┊  BOX DRAWINGS LIGHT QUADRUPLE DASH VERTICAL


class Ch(object):
    """One channel. `key` is its bots_config.json key; `aliases` are extra keys
    that must point at the same id (e.g. the merged welcome channel is still the
    `rules` channel as far as mod_setup and Discord's Community mode care)."""

    __slots__ = ("key", "name", "ctype", "read_only", "topic", "old_names", "aliases")

    def __init__(self, key, name, ctype=TEXT, read_only=False, topic="",
                 old_names=(), aliases=()):
        self.key = key
        self.name = name
        self.ctype = ctype
        self.read_only = read_only
        self.topic = topic
        self.old_names = tuple(old_names)
        self.aliases = tuple(aliases)

    @property
    def is_voice(self):
        return self.ctype == VOICE

    @property
    def keys(self):
        return (self.key,) + self.aliases

    def __repr__(self):
        return "Ch(%s, %r)" % (self.key, self.name)


class Cat(object):
    __slots__ = ("name", "old_names", "channels")

    def __init__(self, name, channels, old_names=()):
        self.name = name
        self.channels = list(channels)
        self.old_names = tuple(old_names)

    def __repr__(self):
        return "Cat(%r, %d channels)" % (self.name, len(self.channels))


# The guild's display name, as it actually is on Discord. Owner's call, Aug 2026:
# the July "Prime Arena" rename never stuck and they chose to keep this. Every
# user-facing string reads it from here so it can never drift again. (Internal
# docstrings still say "Prime Arena" - harmless history, nobody sees them.)
SERVER_NAME = "My Cool Server"

STAFF_CATEGORY = "\U0001F6E0️ STAFF"          # 🛠️ STAFF - the ONLY hidden category

# --------------------------------------------------------------------------
# THE LAYOUT
# --------------------------------------------------------------------------
CATEGORIES = [
    Cat("🌟 START HERE", [
        # The rules channel is RENAMED into the welcome channel - not deleted - so
        # its message history survives AND the guild's rules_channel_id (Community
        # mode) stays valid. mod_setup posts the merged welcome+rules message here.
        Ch("welcome", "👋┊welcome", TEXT, True,
           "The rules, the links, and what this server is for.",
           old_names=["📜-rules"], aliases=["rules"]),
        Ch("announcements", "📣┊announcements", NEWS, True,
           "Announcements from iBoyPrime. Read-only.",
           old_names=["📣-announcements"]),
    ]),

    Cat("💬 COMMUNITY", [
        Ch("general", "💬┊chat", TEXT, False,
           "General chat. Anything that fits the rules.",
           old_names=["💬-general"]),
        Ch("memes", "😂┊memes", TEXT, False,
           "A bot posts a meme here every day. Post your own too.",
           old_names=["😂-memes"]),
        Ch("bot_commands", "🤖┊commands", TEXT, False,
           "Bot commands. Type / to see the list.",
           old_names=["🤖-bot-commands"]),
    ]),

    Cat("🎮 GAMING", [
        Ch("lfg", "🎮┊lfg", TEXT, False,
           "Post the game and platform you are on to find people to play with.",
           old_names=["🔎-looking-for-group"]),
        # moved in from the old VOICE CHANNELS category
        Ch(None, "🔊┊Gaming", VOICE, False, "", old_names=["🎮 Gaming"]),
    ]),

    Cat("🥊 MMA", [
        Ch("mma_chat", "🥊┊mma", TEXT, False,
           "Fight talk: debates, takes and predictions.",
           old_names=["🥊-mma-chat"]),
        Ch("mma_news", "📰┊news", TEXT, True,
           "MMA headlines, posted automatically. This channel never pings anyone.",
           old_names=["🥊-mma-news"]),
        Ch("upcoming", "📅┊upcoming", FORUM, False,
           "Upcoming UFC, PFL and Bellator cards. One thread per event.",
           old_names=["🥊-upcoming-fights"]),
    ], old_names=["🥊 MMA & COMBAT SPORTS"]),

    Cat("🔊 VOICE", [
        Ch(None, "🔊┊General", VOICE, False, "", old_names=["🔊 General"]),
        Ch(None, "💤┊AFK", VOICE, False, "", old_names=["💤 AFK"]),
    ], old_names=["🔊 VOICE CHANNELS"]),

    Cat(STAFF_CATEGORY, [
        Ch("staff_chat", "📋┊staff", TEXT, False, "Staff coordination.",
           old_names=["📋-staff-chat"]),
        Ch("mod_log", "🗒️┊modlog", TEXT, False,
           "AutoMod blocks and patrol reports, posted automatically.",
           old_names=["🗒️-mod-log"]),
        Ch("tickets", "🎟️┊tickets", TEXT, False,
           "Member reports and the staff follow-up on each one.",
           old_names=["🎟️-tickets"]),
        Ch("studio", "🎬┊studio", TEXT, False,
           "Staged YouTube posts. Each message has the graphic and a "
           "copy-ready caption. Post or schedule it in the YouTube app."),
        Ch(None, "🔒┊Staff", VOICE, False, "", old_names=["🔒 Staff VC"]),
    ]),
]

# Channels removed in the Aug 2026 declutter, plus the older retirements kept so a
# re-run can never leave one behind. NOTHING here may appear in an `old_names`.
DELETE_CHANNELS = [
    # START HERE
    "👋-welcome", "🎉-server-updates", "🎭-get-roles",
    # CONTENT & STREAMS (whole category goes)
    "🔴-live-now", "📹-youtube-uploads", "✂️-clips-n-highlights",
    # COMMUNITY
    "👋-introductions", "🖼️-media", "🎲-off-topic",
    # GAMING
    "🎮-gaming-chat", "🏆-plays-n-clips", "📅-game-nights",
    # MMA
    "🎯-predictions", "🔥-fight-night", "📊-rankings", "📅-on-this-day",
    "🗓️-fight-week", "🏆-fight-results",
    # VOICE
    "🥊 Fight Night", "🎵 Music", "🎥 Stream Room",
    # retired before Aug 2026 - harmless if already gone
    "👽-reddit-mma", "📈-odds-movers", "📅-fight-schedule", "🎬-tiktok-posts",
    "🔔-notify-setup",
]

DELETE_CATEGORIES = ["📺 CONTENT & STREAMS", "📰 MMA FEEDS"]

# --------------------------------------------------------------------------
# ROLES
# --------------------------------------------------------------------------
# (name, colour, hoist, mentionable) - listed top-to-bottom in the hierarchy.
ROLES_KEEP = [
    ("👑 Owner",     0xF1C40F, True, False),
    ("🛡️ Admin",     0xE74C3C, True, True),
    ("🔨 Moderator", 0x3498DB, True, True),
    # The baseline role every human gets. Hoisted so the member list finally shows
    # sections instead of one flat block. Discord has NO native auto-role, so
    # member_bot.py backfills it on a 5-minute cron - which needs the SERVER MEMBERS
    # INTENT enabled on the application (Developer Portal -> Bot -> Privileged
    # Gateway Intents). Without it GET /guilds/{id}/members returns 403 and the bot
    # logs why and exits cleanly.
    ("🤝 Member",    0x95A5A6, True, False),
    # The owner's own news alert role (Sept 2026). He asked for a role rather than
    # a direct user mention so members are never dragged into it: only he holds it,
    # so only his phone buzzes.
    #
    # NOT hoisted (it would add a one-person section to the member list) and NOT
    # mentionable (nobody but the bot should be able to fire it - the bot has
    # Administrator, so allowed_mentions is enough).
    #
    # Do NOT rename this to "📰 News Pings": that name is in ROLES_DELETE and the
    # deploy actively deletes it on every run.
    ("🔔 News Alerts", 0x9B59B6, False, False),
]

MEMBER_ROLE = "🤝 Member"

# Held by the owner alone. news_bot pings it for a big story; everything else
# stays silent. If the role is missing, news_bot degrades to silent-for-everything
# rather than failing - the same shape as the old news_pings handling.
NEWS_ALERT_ROLE = "🔔 News Alerts"

# bots_config.json role key -> role name
ROLE_KEYS = {
    "owner":  "👑 Owner",
    "admin":  "🛡️ Admin",
    "mod":    "🔨 Moderator",
    "member": MEMBER_ROLE,
    "news_alerts": NEWS_ALERT_ROLE,
}

# Every role the declutter removes. The deploy actively deletes these, and a
# selftest asserts none of them is ever ensure-created again (bots_setup.NEW_ROLES,
# onboarding_setup.VIEWER_ROLES and mma_setup.ensure_role all used to resurrect
# their own subset on the very next deploy).
ROLES_DELETE = [
    # unused since the server was built ("🤝 Member" was deleted here too, then brought
    # back in ROLES_KEEP as the baseline role - it must NOT appear in both lists)
    "⭐ VIP",
    # 🤖 Bots held 0 members and granted 0 permissions, so its 13 channel overwrites
    # applied to nobody. Discord gives every invited bot its own managed role, so a
    # shared "bots" role was never doing anything.
    "🤖 Bots",
    # interest roles - nothing is gated behind a role any more
    "🎮 Gamer", "🥊 MMA Fan",
    # ping roles - all the feeds they pinged for are gone
    "🔴 Live Pings", "📹 YouTube Pings", "📣 Announcements", "🎉 Events",
    "📰 News Pings", "🗞️ Digest Ping", "🥊 Fight Alerts", "🚨 Fight Results",
    # view-only roles from the old opt-in-to-reveal model
    "👁️ Live Viewer", "👁️ Videos Viewer",
    # award roles from the retired leaderboard bots
    "🏆 Fight Prophet", "🎬 Clip Champ",
    # retired earlier
    "🎬 TikTok Pings",
]

# Featured on the "before you join" welcome screen (Discord: max 5, and ONLY
# @everyone-visible channels - it 400s on anything gated).
WELCOME_FEATURED = [
    ("welcome", "Rules and links",             "👋"),
    ("general", "General chat",                "💬"),
    ("memes",   "A new meme every day",        "😂"),
]

# The channel that receives Discord's native "X joined" messages. MUST be a plain
# type-0 text channel - Discord silently drops an announcement channel here.
SYSTEM_CHANNEL_KEY = "general"

# Where public_updates_channel_id points once 🎉-server-updates is gone. Community
# mode requires this to be a live channel, so it is repointed BEFORE any delete.
PUBLIC_UPDATES_KEY = "mod_log"


# --------------------------------------------------------------------------
# DERIVED VIEWS - every consumer uses these instead of its own literal list
# --------------------------------------------------------------------------
def all_categories():
    return list(CATEGORIES)


def all_channels():
    out = []
    for cat in CATEGORIES:
        out.extend(cat.channels)
    return out


def all_names():
    """Every channel name that should exist after a deploy."""
    return [c.name for c in all_channels()]


def all_category_names():
    return [c.name for c in CATEGORIES]


def category_of(spec):
    for cat in CATEGORIES:
        if spec in cat.channels:
            return cat
    return None


def is_staff_channel(spec):
    cat = category_of(spec)
    return bool(cat and cat.name == STAFF_CATEGORY)


def by_key():
    """bots_config key (including aliases) -> Ch. Keyless voice channels excluded."""
    out = {}
    for c in all_channels():
        for k in c.keys:
            if k:
                out[k] = c
    return out


def public_channels():
    """Everything outside the staff category - i.e. everything @everyone sees."""
    return [c for c in all_channels() if not is_staff_channel(c)]


def member_postable():
    """Public, writable, plain-text channels: what the patrol watches and what the
    NSFW image scan covers. Read-only feeds and forums are excluded on purpose -
    only the bot posts in the feeds, and image_scan reads plain channel messages."""
    return [c for c in public_channels()
            if c.ctype == TEXT and not c.read_only]


def patrol_keys():
    return [c.key for c in member_postable() if c.key]


def topics():
    """name -> topic, for the text/announcement channels that have one."""
    return dict((c.name, c.topic) for c in all_channels()
                if c.topic and c.ctype in (TEXT, NEWS))


def rename_map():
    """old name -> new name, for every channel being renamed rather than created."""
    out = {}
    for c in all_channels():
        for old in c.old_names:
            out[old] = c.name
    for cat in CATEGORIES:
        for old in cat.old_names:
            out[old] = cat.name
    return out


def required_config_keys():
    """Keys that MUST be present in bots_config.json after a deploy, or a surviving
    bot silently does nothing. deploy_bots asserts on this list."""
    return sorted(k for c in all_channels() for k in c.keys if k)


def validate():
    """Structural self-check. Raises AssertionError - called by the selftest and at
    the top of bots_setup so a bad edit fails loudly instead of at 3am."""
    names = all_names()
    assert len(names) == len(set(names)), "duplicate channel name in CATEGORIES"

    cat_names = all_category_names()
    assert len(cat_names) == len(set(cat_names)), "duplicate category name"

    keys = [k for c in all_channels() for k in c.keys if k]
    assert len(keys) == len(set(keys)), "duplicate bots_config key"

    # A name can be an old_name OR a deletion target, never both - otherwise the
    # deploy would race between renaming and deleting the same channel.
    olds = set()
    for c in all_channels():
        olds.update(c.old_names)
    for cat in CATEGORIES:
        olds.update(cat.old_names)
    clash = olds & set(DELETE_CHANNELS) | olds & set(DELETE_CATEGORIES)
    assert not clash, "name is both an old_name and a delete target: %s" % sorted(clash)

    # Renaming into a name that is also queued for deletion would delete the
    # channel we just renamed.
    assert not (set(names) & set(DELETE_CHANNELS)), "a live channel is in DELETE_CHANNELS"
    assert not (set(cat_names) & set(DELETE_CATEGORIES)), "a live category is in DELETE_CATEGORIES"

    # The naming rule the owner asked for.
    for c in all_channels():
        assert SEPARATOR in c.name, "channel %r is missing the ┊ separator" % c.name
        assert "-" not in c.name, "channel %r still contains a dash" % c.name
        if c.ctype in (TEXT, NEWS, FORUM):
            tail = c.name.split(SEPARATOR, 1)[1]
            assert tail and tail == tail.lower(), (
                "text/forum channel %r must be lowercase after ┊ (Discord lowercases "
                "it server-side, which would break every name lookup)" % c.name)

    assert STAFF_CATEGORY in cat_names, "the staff category vanished from CATEGORIES"
    assert patrol_keys(), "no member-postable channels - the patrol would watch nothing"
    assert SYSTEM_CHANNEL_KEY in by_key(), "system channel key is not in the layout"
    assert PUBLIC_UPDATES_KEY in by_key(), "public-updates key is not in the layout"

    dead = set(ROLES_DELETE)
    assert not (dead & set(n for n, _c, _h, _m in ROLES_KEEP)), \
        "a role is both kept and deleted"
    assert set(ROLE_KEYS.values()) <= set(n for n, _c, _h, _m in ROLES_KEEP), \
        "ROLE_KEYS references a role that isn't kept"
    return True


if __name__ == "__main__":
    validate()
    print("layout OK: %d categories, %d channels, %d roles kept, %d roles deleted"
          % (len(CATEGORIES), len(all_channels()), len(ROLES_KEEP), len(ROLES_DELETE)))
    for cat in CATEGORIES:
        print("\n" + cat.name)
        for c in cat.channels:
            kind = {TEXT: "text", VOICE: "voice", NEWS: "news", FORUM: "forum"}[c.ctype]
            print("   %-22s %-6s %-14s %s" % (
                c.name, kind, c.key or "-", "(read-only)" if c.read_only else ""))
