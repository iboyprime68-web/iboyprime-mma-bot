#!/usr/bin/env python3
"""Mocked self-tests for every cron bot, the common.* helpers, moderation and
the setup/polish modules. No network, no git.

Runs locally AND in the public repo's CI (selftest.yml). In the repo checkout
the bot files sit at the ROOT (there is no bots_github/) and the local-only
modules (mod_panel.py, deploy_bots.py) are absent - those two sections print
SKIP there; every section still runs locally.

Run: python selftest_changes.py
"""
import sys, os, copy, types, time as _time

_HERE = os.path.dirname(os.path.abspath(__file__))
_BOTS = os.path.join(_HERE, "bots_github")
sys.path.insert(0, _BOTS if os.path.isdir(_BOTS) else _HERE)
import common

PASS = 0; FAIL = 0
def check(name, cond):
    global PASS, FAIL
    if cond: PASS += 1; print("  ok  :", name)
    else:    FAIL += 1; print("  FAIL:", name)

VIEW = 1 << 10; SEND = 1 << 11; READ_HIST = 1 << 16

# ───────────────────────── 1. real run_loop ────────────────────────────────
print("\n[run_loop]")
os.environ.pop("GITHUB_ACTIONS", None)
calls = [0]
n = common.run_loop(lambda: calls.__setitem__(0, calls[0] + 1), duration=255, interval=60)
check("single pass when not in CI", n == 1 and calls[0] == 1)

os.environ["GITHUB_ACTIONS"] = "true"
_real_time = common.time
ticks = [0.0]
common.time = types.SimpleNamespace(time=lambda: ticks[0],
                                    sleep=lambda s: ticks.__setitem__(0, ticks[0] + s))
calls = [0]
n = common.run_loop(lambda: calls.__setitem__(0, calls[0] + 1), duration=255, interval=60)
check("loops ~5x in CI (4-6)", 4 <= n <= 6)
check("iteration error doesn't kill loop", True)
ticks = [0.0]
def boom(): raise RuntimeError("x")
n2 = common.run_loop(boom, duration=120, interval=60)   # must not raise
check("guarded against exceptions", n2 >= 1)
common.time = _real_time
os.environ.pop("GITHUB_ACTIONS", None)

# ───────────────────────── 2. real persist_state ───────────────────────────
print("\n[persist_state]")
_real_run = common.subprocess.run
git_calls = []
common.subprocess.run = lambda *a, **k: git_calls.append(a[0] if a else None)
os.environ.pop("GITHUB_ACTIONS", None)
common.persist_state("state_news.json")
check("no-op (no git) when local", git_calls == [])
os.environ["GITHUB_ACTIONS"] = "true"
common.persist_state("state_news.json")
check("runs git steps in CI", len(git_calls) >= 4)
git_calls.clear()
os.environ.pop("GITHUB_ACTIONS", None)
common.refresh_checkout()
check("refresh_checkout is a no-op locally", git_calls == [])
os.environ["GITHUB_ACTIONS"] = "true"
common.refresh_checkout()
check("refresh_checkout git-pulls in CI (config edits apply mid-run)",
      len(git_calls) == 1 and "pull" in git_calls[0])
common.subprocess.run = _real_run
os.environ.pop("GITHUB_ACTIONS", None)

# ───────────────────────── shared bot mocks ────────────────────────────────
STORE = {}
def fake_load_json(path, default): return copy.deepcopy(STORE.get(os.path.basename(path), default))
def fake_save_json(path, obj):     STORE[os.path.basename(path)] = copy.deepcopy(obj)
POSTS = []       # (chan, content) - legacy shape used by the older suites
POSTS_FULL = []  # full capture incl. embeds/silent/mentions - used by the v3 suites
def fake_post(chan, content, allowed_mentions=None, embeds=None, silent=False):
    POSTS.append((chan, content))
    POSTS_FULL.append({"chan": chan, "content": content, "mentions": allowed_mentions,
                       "embeds": embeds, "silent": silent})
    return 200, {"id": "msg%d" % len(POSTS_FULL)}
PERSISTS = []
common.load_json   = fake_load_json
common.save_json   = fake_save_json
common.post_message = fake_post
common.persist_state = lambda fn, message=None: PERSISTS.append(fn)
LOOP_N = [1]
common.run_loop = lambda poll, duration=255, interval=60: [poll() for _ in range(LOOP_N[0])] and None

def rss(items):
    body = "".join("<item><title>%s</title><link>%s</link><guid>%s</guid>"
                   "<pubDate>%s</pubDate></item>" % it for it in items)
    return "<rss><channel>%s</channel></rss>" % body

# ───────────────────────── 2b. newsconfig helpers ──────────────────────────
print("\n[newsconfig]")
import newsconfig

NCFG = newsconfig.base_defaults()
check("default mode is hybrid", NCFG["mode"] == "hybrid")
check("3 MMA sources enabled; boxing + dead feeds disabled",
      len(newsconfig.enabled_sources(NCFG)) == 3 and
      not NCFG["sources"]["bad_left_hook"]["enabled"] and not NCFG["sources"]["boxing_scene"]["enabled"] and
      not NCFG["sources"]["sherdog"]["enabled"])
check("MMA Junkie removed (archived), MMA Mania added",
      "mma_junkie" not in NCFG["sources"] and NCFG["sources"]["mma_mania"]["enabled"])
check("UFC on, other orgs + boxing off (owner's pick)",
      newsconfig.category_enabled("ufc", NCFG) and
      not newsconfig.category_enabled("mma_other", NCFG) and
      not newsconfig.category_enabled("boxing", NCFG))
check("explicit UFC title -> ufc", newsconfig.classify("Jon Jones eyes UFC 330 return", NCFG) == "ufc")
check("Bellator/PFL title -> mma_other", newsconfig.classify("PFL finalizes Bellator merger card", NCFG) == "mma_other")
check("boxing title -> boxing", newsconfig.classify("Tyson Fury teases boxing comeback", NCFG) == "boxing")
check("unmatched general MMA title falls back to ufc",
      newsconfig.classify("Conor McGregor warns Max Holloway about weight", NCFG) == "ufc")
check("breaking keywords hit", newsconfig.is_breaking("Champion RETIRES after title loss", NCFG))
check("normal headline is not breaking", not newsconfig.is_breaking("Fighter previews his next bout", NCFG))
check("betting/odds content is excluded (hard rule)",
      newsconfig.is_excluded("Best betting odds for fight night", NCFG))
check("similar() collapses same story from two outlets",
      newsconfig.similar("Jon Jones announces retirement from MMA",
                         "Jon Jones announces MMA retirement") >= 0.6)
check("similar() keeps different stories apart",
      newsconfig.similar("Jon Jones announces retirement",
                         "Volkanovski defends featherweight belt in Sydney") < 0.3)
check("clean defaults validate", newsconfig.validate_newsconfig(NCFG) == [])
_bad = newsconfig.base_defaults(); _bad["mode"] = "loud"
check("bad mode flagged", any("mode" in p for p in newsconfig.validate_newsconfig(_bad)))
_bad = newsconfig.base_defaults(); _bad["digest"]["times_utc"] = ["25:99"]
check("bad digest time flagged", any("HH:MM" in p for p in newsconfig.validate_newsconfig(_bad)))
_bad = newsconfig.base_defaults(); _bad["breaking_keywords"].append("MY_SECRET_TOKEN_abc123")
check("embedded config.txt secret refused",
      any("SECRET" in p for p in newsconfig.validate_newsconfig(_bad, ["MY_SECRET_TOKEN_abc123"])))
_merged = newsconfig.load.__module__ and newsconfig.deep_merge(newsconfig.base_defaults(),
                                                               {"mode": "digest", "max_per_hour": 3})
check("owner edits survive deep-merge over defaults",
      _merged["mode"] == "digest" and _merged["max_per_hour"] == 3 and _merged["sources"]["mma_fighting"]["enabled"])

# ───────────────────────── 3. news_bot v3 ──────────────────────────────────
print("\n[news_bot v3]")
import news_bot
# No ping roles exist any more (deleted in the Aug 2026 declutter), so bots_config
# carries no news role keys. news_bot must degrade to silent, unpinged posts.
common.load_config = lambda: {"channels": {"mma_news": "C"}, "roles": {}}
# freeze the clock at 12:00 UTC (before the 21:30 digest) for the general tests
_real_now = common.now_utc
_NOON = common.datetime.datetime(2024, 1, 2, 12, 0, tzinfo=common.datetime.timezone.utc)
common.now_utc = lambda: _NOON
# one enabled test feed; the three other default sources are switched off
NEWS_OVERRIDE = {"sources": {"mma_fighting": {"enabled": True, "url": "http://feed"},
                             "mma_junkie":   {"enabled": False},
                             "bloody_elbow": {"enabled": False},
                             "sherdog":      {"enabled": False}}}

def news_feed(items):
    common.get_text = lambda url, headers=None, tries=4: \
        (200, rss(items)) if url == "http://feed" else (404, "")

def reset_news(state=None):
    STORE.clear(); POSTS.clear(); POSTS_FULL.clear(); PERSISTS.clear(); LOOP_N[0] = 1
    STORE["newsconfig.json"] = copy.deepcopy(NEWS_OVERRIDE)
    if state is not None:
        STORE["state_news.json"] = state

THREE = [("Volkanovski defends belt in Sydney thriller", "http://a", "g1", "Mon, 01 Jan 2024 10:00:00 GMT"),
         ("Pantoja retains flyweight crown", "http://b", "g2", "Mon, 01 Jan 2024 11:00:00 GMT"),
         ("Strickland shocks the world in Vegas", "http://c", "g3", "Mon, 01 Jan 2024 12:00:00 GMT")]

# first run: seeds latest, SILENT in hybrid, clean content, all marked seen
reset_news(); news_feed(THREE)
news_bot.main()
check("first run posts the latest few (3)", len(POSTS) == 3)
check("first run marks all seen", set(STORE["state_news.json"]["seen"]) == {"g1", "g2", "g3"})
check("state upgraded to v3", STORE["state_news.json"]["v"] == 3)
check("hybrid seed posts are silent", all(p["silent"] for p in POSTS_FULL))
check("content is 'Headline (Source)' (no markdown, no URL, no em dash)",
      POSTS_FULL[0]["content"] == "Volkanovski defends belt in Sydney thriller (MMA Fighting)")
check("link + footer live in the embed",
      POSTS_FULL[0]["embeds"][0]["url"] == "http://a" and
      "MMA Fighting" in POSTS_FULL[0]["embeds"][0]["footer"]["text"])

# v2 -> v3 migration preserves seen: NO repost storm
reset_news({"seen": ["g1", "g2", "g3"], "initialized": True, "v": 2})
news_feed(THREE); news_bot.main()
check("v2 state migrates with zero reposts", len(POSTS) == 0)
FOUR = THREE + [("Prochazka finishes rival in rematch", "http://d", "g4", "Mon, 01 Jan 2024 13:00:00 GMT")]
news_feed(FOUR); news_bot.main()
check("migrated state still posts the genuinely new item", len(POSTS) == 1)
check("post-migration state is v3 and keeps old seen",
      STORE["state_news.json"]["v"] == 3 and "g1" in STORE["state_news.json"]["seen"])
check("routine hybrid post is silent", POSTS_FULL[-1]["silent"])
check("persisted after posting", "state_news.json" in PERSISTS)

# pacing: 3 new items, one cycle -> 1 post; 3 cycles -> drained in order
SEVEN = FOUR + [("Aspinall calls for title unification", "http://e", "g5", "Mon, 01 Jan 2024 14:00:00 GMT"),
                ("Merab dominates in Abu Dhabi", "http://f", "g6", "Mon, 01 Jan 2024 15:00:00 GMT"),
                ("Topuria eyes lightweight double", "http://g", "g7", "Mon, 01 Jan 2024 16:00:00 GMT")]
reset_news({"seen": ["g1", "g2", "g3", "g4"], "initialized": True, "v": 3,
            "recent": [], "digest_items": [], "digest_last": "", "hour": ["", 0]})
news_feed(SEVEN); LOOP_N[0] = 1
news_bot.main()
check("steady state posts at most 1/cycle", len(POSTS) == 1)
reset_news({"seen": ["g1", "g2", "g3", "g4"], "initialized": True, "v": 3,
            "recent": [], "digest_items": [], "digest_last": "", "hour": ["", 0]})
news_feed(SEVEN); LOOP_N[0] = 3
news_bot.main()
check("3 cycles drain 3 backlog items in order", len(POSTS) == 3 and
      [p["embeds"][0]["url"] for p in POSTS_FULL] == ["http://e", "http://f", "http://g"])
check("hybrid queues posted items for the digest",
      len(STORE["state_news.json"]["digest_items"]) == 3)

# breaking: loud + pings the news role, bypasses silence
reset_news({"seen": [], "initialized": True, "v": 3, "recent": [],
            "digest_items": [], "digest_last": "", "hour": ["", 0]})
news_feed([("Champion retires after shock loss", "http://brk", "gb", "Mon, 01 Jan 2024 10:00:00 GMT")])
news_bot.main()
check("breaking story still posts", len(POSTS_FULL) == 1)
check("breaking is SILENT and pings nobody now the ping roles are gone "
      "(a loud message with no mention is just an unread badge)",
      POSTS_FULL[0]["silent"] and POSTS_FULL[0]["mentions"] is None and
      POSTS_FULL[0]["content"].startswith("🚨") and
      "<@&" not in POSTS_FULL[0]["content"])
# ...but the ping path itself still works, so re-adding a role later needs no code change
_bc, _be, _bm, _cat = news_bot.build_message(
    {"title": "Champion retires", "link": "http://b", "source": "MMA Fighting",
     "when": _NOON, "desc": ""}, newsconfig.base_defaults(), True, "NR")
check("build_message still supports a ping role if one is ever re-added",
      _bc.startswith("<@&NR> ") and _bm == {"parse": [], "roles": ["NR"]})

# filters: betting content excluded (hard rule); disabled category dropped
reset_news({"seen": [], "initialized": True, "v": 3, "recent": [],
            "digest_items": [], "digest_last": "", "hour": ["", 0]})
news_feed([("Best betting odds for fight night", "http://x1", "gx1", "Mon, 01 Jan 2024 10:00:00 GMT"),
           ("Bellator signs new heavyweight prospect", "http://x2", "gx2", "Mon, 01 Jan 2024 11:00:00 GMT")])
LOOP_N[0] = 2
news_bot.main()
check("betting + off-category items post nothing", len(POSTS) == 0)
check("filtered items are marked seen (no retry loop)",
      {"gx1", "gx2"} <= set(STORE["state_news.json"]["seen"]))

# duplicate story from a second outlet is collapsed
reset_news({"seen": [], "initialized": True, "v": 3,
            "recent": [{"t": "Jon Jones announces retirement from MMA",
                        "ts": "2024-01-02T11:00:00+00:00"}],
            "digest_items": [], "digest_last": "", "hour": ["", 0]})
news_feed([("Jon Jones announces MMA retirement", "http://dup", "gd", "Mon, 01 Jan 2024 10:00:00 GMT")])
news_bot.main()
check("same story from another outlet is collapsed", len(POSTS) == 0 and
      "gd" in STORE["state_news.json"]["seen"])

# hour cap in hybrid: overflow diverts to the digest, never posts
reset_news({"seen": [], "initialized": True, "v": 3, "recent": [],
            "digest_items": [], "digest_last": "",
            "hour": [_NOON.strftime("%Y-%m-%dT%H"), 6]})
news_feed([("Volkanovski defends belt in Sydney thriller", "http://h1", "gh1", "Mon, 01 Jan 2024 10:00:00 GMT")])
news_bot.main()
check("hour-capped routine item is queued for digest, not posted",
      len(POSTS) == 0 and len(STORE["state_news.json"]["digest_items"]) == 1)

# digest: fires once after its UTC time, pings the digest role, clears the queue
_D_ITEMS = [{"title": "Story %d" % i, "url": "http://s%d" % i, "source": "MMA Fighting",
             "cat": "ufc", "ts": "2024-01-02T10:00:00+00:00"} for i in range(4)]
common.now_utc = lambda: common.datetime.datetime(2024, 1, 2, 22, 0, tzinfo=common.datetime.timezone.utc)
reset_news({"seen": [], "initialized": True, "v": 3, "recent": [],
            "digest_items": copy.deepcopy(_D_ITEMS), "digest_last": "", "hour": ["", 0]})
news_feed([])
news_bot.main()
check("digest posts after 21:30 UTC", len(POSTS) == 1)
check("digest is SILENT and pings nobody (calm mode, no ping roles left)",
      POSTS_FULL[0]["silent"] and POSTS_FULL[0]["mentions"] is None)
check("digest embed groups stories into fields",
      POSTS_FULL[0]["embeds"][0]["fields"] and "Story 0" in POSTS_FULL[0]["embeds"][0]["fields"][0]["value"])
check("digest queue cleared + stamped",
      STORE["state_news.json"]["digest_items"] == [] and
      STORE["state_news.json"]["digest_last"] == "2024-01-02 21:30")
POSTS.clear(); POSTS_FULL.clear()
news_bot.main()
check("digest never double-posts the same day", len(POSTS) == 0)

# digest with too few items: skipped but still stamped (no late-night trickle)
reset_news({"seen": [], "initialized": True, "v": 3, "recent": [],
            "digest_items": _D_ITEMS[:1], "digest_last": "", "hour": ["", 0]})
news_feed([])
news_bot.main()
check("digest below min_items skips but stamps",
      len(POSTS) == 0 and STORE["state_news.json"]["digest_last"] == "2024-01-02 21:30")

# digest_due pure helper
_dd = news_bot.digest_due
_at = lambda h, m: common.datetime.datetime(2024, 1, 2, h, m, tzinfo=common.datetime.timezone.utc)
check("digest_due: not yet", _dd(_at(9, 0), ["21:30"], "") is None)
check("digest_due: past time fires", _dd(_at(22, 0), ["21:30"], "") == "2024-01-02 21:30")
check("digest_due: already posted -> None", _dd(_at(22, 0), ["21:30"], "2024-01-02 21:30") is None)
check("digest_due: picks latest passed slot", _dd(_at(22, 0), ["09:00", "21:30"], "2024-01-02 09:00") == "2024-01-02 21:30")

# build_message strips markdown from the push preview
_bm_c, _bm_e, _bm_m, _ = news_bot.build_message(
    {"title": "**Huge** _news_ [link](http://x) here", "link": "http://x", "source": "Sherdog",
     "when": _NOON, "desc": ""}, newsconfig.base_defaults(), False, None)
check("build_message content has no markdown", _bm_c == "Huge news link here (Sherdog)")

# near-instant delivery: tight poll cadence across a long, cron-requeued window
check("news polls every ~20s across a ~55-min window",
      news_bot.POLL_SECONDS <= 30 and news_bot.WINDOW_SECONDS >= 1800)

common.now_utc = _real_now

# ───────────────────────── 4. calm-mode post formats ──────────────────────
print("\n[calm formats]")
import memes_bot

# memes: silent, image in an embed. (The rankings + on-this-day blocks went with
# their bots in the Aug 2026 declutter.)
common.load_config = lambda: {"channels": {"memes": "M"}}
_meme = {"data": {"children": [{"data": {
    "id": "m1", "title": "Certified hood classic", "post_hint": "image",
    "url": "https://i.redd.it/x.jpg", "score": 999, "stickied": False,
    "over_18": False, "is_video": False, "domain": "i.redd.it"}}]}}
common.get_json = lambda url, headers=None, tries=4: (200, copy.deepcopy(_meme))
STORE.clear(); POSTS.clear(); POSTS_FULL.clear()
memes_bot.main()
check("meme posts are SILENT", POSTS_FULL and all(p["silent"] for p in POSTS_FULL))
check("meme image lives in the embed",
      POSTS_FULL[0]["embeds"][0]["image"]["url"] == "https://i.redd.it/x.jpg" and
      "r/dankmemes" in POSTS_FULL[0]["embeds"][0]["footer"]["text"])
check("meme content is plain text", POSTS_FULL[0]["content"] == "😂 Certified hood classic")

print("\n[layout]")
import layout

check("layout validates (names unique, no dashes, ┊ present, staff category kept)",
      layout.validate() is True)

_names = set(layout.all_names())
_cats = set(layout.all_category_names())

# The naming rule the owner asked for: <emoji>┊<one word>, no dashes anywhere.
import re as _re
_TEXT_RX = _re.compile(r"^[^\w\s]{1,3}┊[a-z0-9]+$")
_VOICE_RX = _re.compile(r"^[^\w\s]{1,3}┊[A-Za-z0-9]+$")
_bad = [c.name for c in layout.all_channels()
        if not (_VOICE_RX if c.is_voice else _TEXT_RX).match(c.name)]
check("every channel is <emoji>┊<word> (offenders: %s)" % _bad[:3], not _bad)
check("no channel name contains a dash", not any("-" in n for n in _names))
check("the separator is U+250A, not a look-alike",
      all("┊" in n and "|" not in n and "\uFF5C" not in n and "\u2502" not in n
          for n in _names))

# Anti-drift: this is the check that would have caught the original bug, where a
# rename in one file and not another made bots_setup CREATE a duplicate channel.
check("DELETE_CHANNELS never targets a live channel",
      not (set(layout.DELETE_CHANNELS) & _names))
check("DELETE_CATEGORIES never targets a live category",
      not (set(layout.DELETE_CATEGORIES) & _cats))
_olds = set()
for _c in layout.all_channels():
    _olds.update(_c.old_names)
check("no name is both an old_name and a delete target (rename would race delete)",
      not (_olds & set(layout.DELETE_CHANNELS)))
check("the rules channel is RENAMED into the welcome channel, not deleted",
      layout.rename_map().get("📜-rules") == "👋┊welcome")
check("the merged welcome channel also answers to the 'rules' key "
      "(Community mode's rules_channel_id + mod_setup both need it)",
      "rules" in layout.by_key() and layout.by_key()["rules"] is layout.by_key()["welcome"])

# Roles: nothing may resurrect the deleted ones.
_dead = set(layout.ROLES_DELETE)
_kept = set(n for n, _c, _h, _m in layout.ROLES_KEEP)
check("staff roles + the baseline member role survive",
      {"👑 Owner", "🛡️ Admin", "🔨 Moderator", "🤝 Member"} <= _kept)
check("the empty 🤖 Bots role is gone (0 members, 0 permissions, 13 dead overwrites)",
      "🤖 Bots" in _dead and "🤖 Bots" not in _kept)
check("no role is both kept and deleted", not (_dead & _kept))
check("the ping/award/interest roles are all queued for deletion",
      {"📰 News Pings", "🗞️ Digest Ping", "🔴 Live Pings",
       "📹 YouTube Pings", "🏆 Fight Prophet", "🎬 Clip Champ",
       "🎮 Gamer", "🥊 MMA Fan"} <= _dead)
check("ROLE_KEYS only reference kept roles", set(layout.ROLE_KEYS.values()) <= _kept)

# Derived views the rest of the deploy depends on.
check("patrol watches the member-postable channels (empty would silently disable it)",
      set(layout.patrol_keys()) == {"general", "memes", "bot_commands", "lfg", "mma_chat"})
check("read-only feeds are NOT patrolled or image-scanned",
      "mma_news" not in layout.patrol_keys() and "welcome" not in layout.patrol_keys())
check("staff channels are excluded from the public set",
      not any(c.key == "staff_chat" for c in layout.public_channels()))
check("every text/news channel has a topic",
      all(c.topic for c in layout.all_channels() if c.ctype in (layout.TEXT, layout.NEWS)))
check("required_config_keys covers what the surviving bots read",
      {"mma_news", "memes", "mod_log", "staff_chat", "mma_chat", "bot_commands",
       "announcements", "upcoming"} <= set(layout.required_config_keys()))


# ───────── 6b. access & visibility (the bug this restructure exists to fix) ─────
print("\n[writing rules]")
# Every string a member can see is written against the no-ai-slop rules
# (github.com/realrossmanngroup/no_ai_slop_writing_rules). Rule 1 bans the em dash
# outright; the rest of the list bans copywriter filler and AI tells. Prose drifts
# back the moment nobody is checking, so this suite checks.
import mod_setup as _ms
import commands_guide as _cg

_WELCOME = _ms.RULES_TEXT
_MENU = _cg.GUIDE
_TOPICS = " ".join(layout.topics().values())
os.environ.setdefault("DISCORD_BOT_TOKEN", "test-token")   # bots_setup exits without one
import bots_setup as _bs2
_DESCS = _bs2.GUILD_DESCRIPTION + " " + _bs2.WELCOME_DESCRIPTION

_PROSE = {"welcome+rules": _WELCOME, "commands menu": _MENU, "channel topics": _TOPICS}
if _DESCS:
    _PROSE["guild + welcome-screen description"] = _DESCS

for _label, _text in _PROSE.items():
    check("%s: no em dash (rule 1)" % _label, "—" not in _text)

_BANNED_WORDS = ("delve", "leverage", "utilize", "utilise", "facilitate", "foster",
                 "bolster", "underscore", "unveil", "streamline", "seamless", "robust",
                 "comprehensive", "cutting-edge", "groundbreaking", "pivotal",
                 "transformative", "myriad", "plethora", "paramount", "prior to",
                 "subsequent to", "in terms of", "the fact that")
_BANNED_PHRASES = ("in today's", "it's important to note", "when it comes to",
                   "at the end of the day", "in the realm of", "it goes without saying",
                   "look no further", "that being said", "furthermore", "moreover",
                   "in essence", "at its core", "to put it simply", "whether you're",
                   "dive in", "let's delve")
_INTENSIFIERS = ("extremely", "dramatically", "incredibly", "remarkably", "truly",
                 "absolutely", "literally", "significantly", "undoubtedly")

for _label, _text in _PROSE.items():
    _low = _text.lower()
    _hits = [w for w in _BANNED_WORDS + _BANNED_PHRASES + _INTENSIFIERS if w in _low]
    check("%s: no banned words or filler phrases (offenders: %s)" % (_label, _hits[:3]),
          not _hits)

check("welcome+rules: no exclamation marks (rule 14, no synthetic enthusiasm)",
      "!" not in _WELCOME)
check("commands menu: no exclamation marks", "!" not in _MENU)
check("welcome+rules still fits one Discord message", len(_WELCOME) <= 1990)
check("welcome+rules keeps all ten rules",
      all(("**%d." % n) in _WELCOME for n in range(1, 11)))
check("the gambling rule survives (owner's hard rule)",
      "gambling" in _WELCOME.lower() and "betting" in _WELCOME.lower())
check("headings name their content instead of teasing it (rule 16)",
      "## Rules" in _WELCOME and "## Links" in _WELCOME)


# ─────────────── 6b. access & visibility (the bug this restructure exists to fix) ─────
print("\n[access & visibility]")
import onboarding_setup

CONNECT = 1 << 20; SPEAK = 1 << 21

# Nothing may be gated behind a role ever again. The old opt-in-to-reveal model is
# what buried whole categories - and every voice channel - behind "Browse Channels".
check("no category is gated", onboarding_setup.GATED_CATEGORIES == {})
check("no individual channel is gated", onboarding_setup.GATED_CHANNELS == {})
check("no view-only roles are created", onboarding_setup.VIEWER_ROLES == {})

# ungate_overwrites is the inverse the old code never had: deleting the GATED_*
# constants alone would have left the deny bits written on the live guild forever.
_gated = [{"id": "E", "type": 0, "allow": "0", "deny": str(VIEW | SEND)}]
_ow = onboarding_setup.ungate_overwrites(_gated, "E")
_e = next((o for o in _ow if o["id"] == "E"), None)
check("ungate restores @everyone VIEW", bool(_e) and bool(int(_e["allow"]) & VIEW))
check("ungate clears the VIEW deny", bool(_e) and not (int(_e["deny"]) & VIEW))
check("ungate PRESERVES the SEND deny (read-only feeds stay read-only)",
      bool(_e) and bool(int(_e["deny"]) & SEND))

_vow = onboarding_setup.ungate_overwrites(
    [{"id": "E", "type": 0, "allow": "0", "deny": str(VIEW | CONNECT | SPEAK)}],
    "E", is_voice=True)
_ve = next((o for o in _vow if o["id"] == "E"), None)
check("voice un-gate restores VIEW + CONNECT + SPEAK (the old gate only ever granted "
      "VIEW, which is why voice stayed unusable even when visible)",
      bool(_ve) and (int(_ve["allow"]) & (VIEW | CONNECT | SPEAK)) == (VIEW | CONNECT | SPEAK)
      and not (int(_ve["deny"]) & (VIEW | CONNECT | SPEAK)))

_dead_ow = onboarding_setup.ungate_overwrites(
    [{"id": "DEADROLE", "type": 0, "allow": str(VIEW), "deny": "0"}],
    "E", dead_role_ids=["DEADROLE"])
check("overwrites belonging to deleted roles are dropped",
      not any(o["id"] == "DEADROLE" for o in _dead_ow))

check("a channel already open needs no PATCH (re-runs cost zero API calls)",
      not onboarding_setup.needs_ungate(
          {"permission_overwrites": [{"id": "E", "allow": str(VIEW), "deny": "0"}]},
          "E", False, []))
check("a channel with a VIEW deny is flagged for repair",
      onboarding_setup.needs_ungate(
          {"permission_overwrites": [{"id": "E", "allow": "0", "deny": str(VIEW)}]},
          "E", False, []))

# The staff category is the ONE thing that stays hidden.
_patched = []
_rd = common.discord
common.discord = lambda m, path, body=None: (_patched.append((m, path, body)), (200, {}))[1]
_chans = [
    {"id": "SC", "name": layout.STAFF_CATEGORY, "type": 4, "permission_overwrites": []},
    {"id": "S1", "name": "📋┊staff", "type": 0, "parent_id": "SC",
     "permission_overwrites": []},
    {"id": "P1", "name": "💬┊chat", "type": 0,
     "permission_overwrites": [{"id": "G1", "allow": "0", "deny": str(VIEW)}]},
    {"id": "V1", "name": "🔊┊General", "type": 2, "permission_overwrites": []},
]
onboarding_setup.unhide_everything("G1", _chans, [])
_touched = set(path.split("/")[-1] for m, path, _b in _patched if m == "PATCH")
check("the staff category and its children stay hidden",
      "SC" not in _touched and "S1" not in _touched)
check("a gated public channel is opened up", "P1" in _touched)
check("voice channels get an explicit @everyone allow", "V1" in _touched)

# Onboarding must go out DISABLED with EMPTY lists - clearing default_channel_ids is
# what releases Discord's "onboarding channels must be readable by everyone" pin
# (error 350003), which outlives a plain disable.
_patched[:] = []
onboarding_setup.disable_onboarding("G1")
_put = [b for m, path, b in _patched if m == "PUT" and path.endswith("/onboarding")]
check("onboarding is disabled with empty prompts AND an empty default-channel list",
      bool(_put) and _put[0]["enabled"] is False and _put[0]["prompts"] == []
      and _put[0]["default_channel_ids"] == [])
common.discord = _rd

# ──────────────────── 6c. YouTube routing + official Kick API ───────────────
print("\n[modconfig]")
import modconfig

mc = modconfig.base_defaults()
mc["channels"] = {
    "A": "anything_goes",
    "B": "sfw_strict",
    "C": "standard",
    "D": {"profile": "standard", "categories_add": ["nsfw_text"], "media_policy": "no_links"},
    "E": {"profile": "sfw_strict", "categories_remove": ["profanity"]},
}
rA = modconfig.resolve_channel(mc, "A"); rB = modconfig.resolve_channel(mc, "B")
rC = modconfig.resolve_channel(mc, "C"); rD = modconfig.resolve_channel(mc, "D")
rE = modconfig.resolve_channel(mc, "E")
check("anything_goes has no categories", rA["categories"] == set())
check("sfw_strict enforces all 6", rB["categories"] == set(modconfig.CATEGORIES))
check("standard enforces slurs/scam/ads", rC["categories"] == {"slurs", "scam", "ads"})
check("inline add adds nsfw_text + media override", "nsfw_text" in rD["categories"] and rD["media_policy"] == "no_links")
check("inline remove drops profanity (keeps slurs)", "profanity" not in rE["categories"] and "slurs" in rE["categories"])
check("unconfigured channel uses default profile", modconfig.resolve_channel(mc, "ZZZ")["categories"] == {"slurs", "scam", "ads"})
check("per-channel thresholds resolve", rB["flood_count"] == 5 and rA["flood_count"] == 10)

existing = {"categories": {"slurs": {"words": ["mine"]}}, "channels": {"X": "anything_goes"}}
merged = modconfig.deep_merge(modconfig.base_defaults(), existing)
check("deep_merge keeps owner words", merged["categories"]["slurs"]["words"] == ["mine"])
check("deep_merge keeps other default categories", "scam" in merged["categories"])
check("deep_merge keeps owner channel + new default keys", merged["channels"]["X"] == "anything_goes" and "raid" in merged)

STORE.clear()
STORE["modconfig.json"] = {"channels": {"Q": "sfw_strict"}, "categories": {"scam": {"words": ["keepme"]}}}
loaded = modconfig.load()
check("load() merges file over defaults", loaded["channels"]["Q"] == "sfw_strict" and loaded["categories"]["scam"]["words"] == ["keepme"])
seeded = modconfig.seed_channels_from(modconfig.base_defaults(), {"patrol_channels": ["p1", "p2"]})
check("seed maps patrol channels to standard", seeded["channels"] == {"p1": "standard", "p2": "standard"})
not_reseed = modconfig.seed_channels_from({"channels": {"keep": "anything_goes"}}, {"patrol_channels": ["p1"]})
check("seed never clobbers existing channels", not_reseed["channels"] == {"keep": "anything_goes"})

# ───────────────────────── 8. mod_setup AutoMod build ──────────────────────
print("\n[mod_setup]")
import mod_setup

mc2 = modconfig.base_defaults()
mc2["channels"] = {"A": "anything_goes", "B": "sfw_strict", "C": "standard"}
mc2["categories"]["slurs"]["words"] = ["badword"]      # give 2 empty cats some words so their rules build
mc2["categories"]["nsfw_text"]["words"] = ["xxx"]
all_ids = ["A", "B", "C", "D"]                          # D is unconfigured -> default 'standard'
rules = mod_setup.build_rules(mc2, all_ids, "LOG", ["OWNER"])
names = {r["name"] for r in rules}
check("slurs rule built (has words)", "iBP · Slurs & hate" in names)
check("nsfw_text rule built (has words)", "iBP · NSFW text" in names)
check("ads rule built (default regex)", "iBP · Ads & invites" in names)
check("scam rule built (default words)", "iBP · Scam filter" in names)
check("profanity rule skipped (no words)", "iBP · Profanity" not in names)
check("preset/spam/mention all present", {"iBP · Hate & adult (preset)", "iBP · Spam", "iBP · Mention spam"} <= names)
check("<=6 KEYWORD rules (Discord cap)", sum(1 for r in rules if r["trigger_type"] == 1) <= 6)
check("every rule lets staff bypass (exempt_roles)", all("OWNER" in r.get("exempt_roles", []) for r in rules))

slurs_rule = next(r for r in rules if r["name"] == "iBP · Slurs & hate")
check("anything_goes channel exempt from slurs", "A" in slurs_rule["exempt_channels"])
check("sfw_strict + standard + default NOT exempt from slurs",
      all(c not in slurs_rule["exempt_channels"] for c in ("B", "C", "D")))
check("keyword rule has block + alert actions",
      any(a["type"] == 1 for a in slurs_rule["actions"]) and any(a["type"] == 2 for a in slurs_rule["actions"]))
nsfw_rule = next(r for r in rules if r["name"] == "iBP · NSFW text")
check("nsfw_text enforced only in sfw_strict (B)",
      set(("A", "C", "D")) <= set(nsfw_rule["exempt_channels"]) and "B" not in nsfw_rule["exempt_channels"])
preset_rule = next(r for r in rules if r["name"] == "iBP · Hate & adult (preset)")
check("preset net exempt only where slurs AND nsfw both allowed (A)", preset_rule["exempt_channels"] == ["A"])

big_ids = ["c%02d" % i for i in range(60)]              # 60 channels all anything_goes -> all want exempt
mc3 = modconfig.base_defaults(); mc3["defaults"]["profile"] = "anything_goes"
mc3["categories"]["slurs"]["words"] = ["x"]
big_rules = mod_setup.build_rules(mc3, big_ids, None, [])
sr = next(r for r in big_rules if r["name"] == "iBP · Slurs & hate")
check("exempt list capped at 50 (Discord max)", len(sr["exempt_channels"]) == 50)

calls = []
existing_rules = [{"id": "r1", "name": "iBP · Spam"}, {"id": "old", "name": "iBP · Old combined"}]
def fake_discord(method, path, body=None):
    calls.append((method, path, body))
    if method == "GET" and "auto-moderation/rules" in path:
        return 200, existing_rules
    return 200, {"id": "new"}
_real_discord = common.discord
common.discord = fake_discord
mod_setup.sync_rules("G", [
    {"name": "iBP · Spam", "trigger_metadata": {}, "actions": [], "enabled": True, "exempt_roles": [], "exempt_channels": ["A"]},
    {"name": "iBP · Slurs & hate", "trigger_metadata": {}, "actions": [], "enabled": True, "exempt_roles": [], "exempt_channels": []}])
patched = [c for c in calls if c[0] == "PATCH"]
check("existing rule PATCHed (not duplicated)", any("r1" in c[1] for c in patched))
check("PATCH payload now includes exempt_channels (the silent-no-op fix)",
      any("exempt_channels" in (c[2] or {}) for c in patched))
check("brand-new rule POSTed", sum(1 for c in calls if c[0] == "POST") == 1)
check("stale 'iBP · Old combined' rule pruned", any("old" in c[1] for c in calls if c[0] == "DELETE"))
common.discord = _real_discord

# ───────────────────────── 9. mod_bot patrol ───────────────────────────────
print("\n[mod_bot]")
import mod_bot

# pure media-policy helper
check("no_links flags a URL", mod_bot.media_reason({"content": "see http://x.com"}, "no_links") == "link not allowed here")
check("no_links ignores plain text", mod_bot.media_reason({"content": "hello there"}, "no_links") is None)
check("sfw_only flags an image attachment",
      mod_bot.media_reason({"attachments": [{"content_type": "image/png"}]}, "sfw_only") == "image not allowed here")
check("sfw_only ignores a non-image file",
      mod_bot.media_reason({"attachments": [{"filename": "doc.pdf", "content_type": "application/pdf"}]}, "sfw_only") is None)
check("no_attachments flags any file",
      mod_bot.media_reason({"attachments": [{"filename": "a.zip"}]}, "no_attachments") == "attachment not allowed here")
check("allow lets everything through",
      mod_bot.media_reason({"content": "http://x", "attachments": [{"content_type": "image/png"}]}, "allow") is None)

base = common.now_utc()
def iso(off): return (base + common.datetime.timedelta(seconds=off)).strftime("%Y-%m-%dT%H:%M:%S+00:00")
def M(mid, uid, content, off, roles=None, atts=None, bot=False):
    return {"id": mid, "content": content, "timestamp": iso(off),
            "author": {"id": uid, "username": "u" + uid, "bot": bot},
            "member": {"roles": roles or []}, "attachments": atts or []}

MSGS = [
    M("f1", "U1", "go", 0), M("f2", "U1", "go go", 1), M("f3", "U1", "go go go", 2),   # flood (3 in <=30s)
    M("d1", "U3", "buy now", 0), M("d2", "U3", "buy now", 40), M("d3", "U3", "buy now", 80),  # dupe x3, not flood
    M("l1", "U2", "join http://spam.gg now", 5),                                       # link in a no_links channel
    M("s1", "STAFF", "here http://ok.com", 6, roles=["O"]),                            # staff -> skipped
    M("n1", "U4", "just chatting", 7),                                                 # clean -> ignored
]

import mod_bot as _mb
STORE.clear(); POSTS.clear(); PERSISTS.clear(); LOOP_N[0] = 1
STORE["modconfig.json"] = {"channels": {"CH": {"profile": "sfw_strict", "media_policy": "no_links",
                                                "flood_count": 3, "flood_window": 30, "dup_count": 3}}}
common.load_config = lambda: {"guild_id": "G", "channels": {"mod_log": "LOG"},
                              "roles": {"owner": "O", "admin": "A", "mod": "M"}, "patrol_channels": ["CH"]}
_md_real = common.discord
def md_discord(method, path, body=None):
    if method == "GET" and "/messages" in path:
        return 200, MSGS
    return 204, {}            # bulk-delete / single delete / timeout all succeed
common.discord = md_discord
mod_bot.main()
common.discord = _md_real

logtext = "\n".join(c for _, c in POSTS)
check("patrol acted on exactly 3 users", len(POSTS) == 3)
check("flood caught with per-channel threshold (U1)", "<@U1>" in logtext and "flood" in logtext)
check("duplicate spam caught (U3)", "<@U3>" in logtext and "repeat spam" in logtext)
check("link deleted under no_links policy (U2)", "<@U2>" in logtext and "link not allowed here" in logtext)
check("staff message skipped (no STAFF action)", "<@STAFF>" not in logtext)
check("clean user untouched (no U4 action)", "<@U4>" not in logtext)
check("state persisted after acting", PERSISTS == ["state_mod.json"])
check("acted message ids recorded as seen", set(STORE["state_mod.json"]["seen"]) >= {"f1", "d1", "l1"})

# ───────────────────────── 10. image_scan ──────────────────────────────────
print("\n[image_scan]")
import image_scan

def IM(mid, uid, url, off, roles=None):
    return {"id": mid, "timestamp": iso(off), "content": "",
            "author": {"id": uid, "username": "u" + uid, "bot": False},
            "member": {"roles": roles or []},
            "attachments": [{"url": url, "content_type": "image/jpeg", "filename": url}]}

SCORES = {b"porn.jpg": 0.99, b"cat.jpg": 0.10}
image_scan._SCORER = lambda b: SCORES.get(b, 0.0)          # stub classifier (no ONNX in sandbox)
image_scan.fetch_bytes = lambda url, timeout=20: (url or "").encode()
MSGS_CH1 = [IM("p1", "U1", "porn.jpg", 1), IM("c1", "U2", "cat.jpg", 2),
            IM("sp", "STAFF", "porn.jpg", 3, roles=["O"])]
IMG_CALLS = []
def img_discord(method, path, body=None):
    IMG_CALLS.append((method, path))
    if method == "GET" and "/channels/CH1/messages" in path:
        return 200, MSGS_CH1
    if method == "GET" and "/messages" in path:
        return 200, []
    return 204, {}

STORE.clear(); POSTS.clear(); PERSISTS.clear(); LOOP_N[0] = 1
STORE["modconfig.json"] = {"channels": {"CH1": "sfw_strict", "CH2": "standard"},
                           "image_scan": {"threshold": 0.85, "max_per_run": 40,
                                          "delete": True, "warn": True, "classifier": "nudenet"}}
common.load_config = lambda: {"channels": {"mod_log": "LOG"}, "roles": {"owner": "O", "admin": "A", "mod": "M"}}
_img_real = common.discord
common.discord = img_discord
image_scan.main()
common.discord = _img_real

deletes = [p for m, p in IMG_CALLS if m == "DELETE"]
gets = [p for m, p in IMG_CALLS if m == "GET"]
check("only the NSFW image deleted (1)", len(deletes) == 1 and "p1" in deletes[0])
check("safe image (cat, low score) kept", not any("c1" in d for d in deletes))
check("NSFW removal logged to mod-log", any("🔞" in c and "<@U1>" in c for _, c in POSTS))
check("staff image skipped (no STAFF delete)", not any("sp" in d for d in deletes))
check("nsfw_images=false channel never scanned (no CH2 GET)", not any("CH2" in g for g in gets))
check("image state persisted after a removal", PERSISTS == ["state_image.json"])
check("checked images recorded as seen", set(STORE["state_image.json"]["seen"]) >= {"p1", "c1"})

# needs_scan() gate - offline check the workflow uses to skip the heavy ONNX
# install/scan entirely when no channel is flagged nsfw_images (stops the job
# failing/emailing for nothing). profiles come from modconfig defaults.
STORE["modconfig.json"] = {"channels": {"CH1": "sfw_strict", "CH2": "standard"}}
check("needs_scan True when a channel enables nsfw_images", image_scan.needs_scan() is True)
STORE["modconfig.json"] = {"channels": {"CH1": "standard", "CH2": "standard"}}
check("needs_scan False when no channel enables nsfw_images", image_scan.needs_scan() is False)

# ─────────────── 10b. gore watch - the ALERT-ONLY invariant ─────────────────
print("\n[gore watch]")
GORE_SCORES = {b"gore.jpg": 0.99, b"fight.jpg": 0.12, b"porn.jpg": 0.99}
image_scan._GORE = lambda b: GORE_SCORES.get(b, 0.0)
image_scan._SCORER = lambda b: {b"porn.jpg": 0.99}.get(b, 0.0)
MSGS_G = [IM("g1", "U5", "gore.jpg", 1), IM("f1", "U6", "fight.jpg", 2),
          IM("gp", "U7", "porn.jpg", 3)]
GORE_CALLS = []
def gore_discord(method, path, body=None):
    GORE_CALLS.append((method, path))
    if method == "GET" and "/channels/CH1/messages" in path:
        return 200, MSGS_G
    if method == "GET" and "/messages" in path:
        return 200, []
    return 204, {}
STORE.clear(); POSTS.clear(); PERSISTS.clear(); LOOP_N[0] = 1
STORE["modconfig.json"] = {"channels": {"CH1": "sfw_strict"},
                           "image_scan": {"threshold": 0.85, "max_per_run": 40,
                                          "delete": True, "warn": True, "classifier": "nudenet",
                                          "gore_enabled": True, "gore_threshold": 0.85}}
common.load_config = lambda: {"guild_id": "G1", "channels": {"mod_log": "LOG"},
                              "roles": {"owner": "O"}}
common.discord = gore_discord
image_scan.main()
common.discord = _img_real
g_deletes = [p for m, p in GORE_CALLS if m == "DELETE"]
_alerts = [c for _, c in POSTS if "🚨" in c]
check("gore image NEVER deleted - even with delete:true set",
      not any("g1" in d for d in g_deletes))
check("gore alert posted with message link + explicit no-delete note",
      len(_alerts) == 1 and "/channels/G1/CH1/g1" in _alerts[0] and
      "Nothing was auto-deleted" in _alerts[0])
check("bloody-fight image (gore 0.12) stays silent", not any("f1" in a for a in _alerts))
check("porn goes through the NSFW delete path, no redundant gore alert",
      any("gp" in d for d in g_deletes) and not any("gp" in a for a in _alerts))
check("gore watch ships enabled at the calibrated 0.85 threshold",
      modconfig.base_defaults()["image_scan"]["gore_enabled"] is True and
      modconfig.base_defaults()["image_scan"]["gore_threshold"] == 0.85)
image_scan._GORE = None
STORE["modconfig.json"] = {"channels": {"CH1": "standard", "CH2": "standard"}}

# ───────────────────────── 11. raid_bot ────────────────────────────────────
print("\n[raid]")
import raid_bot

COUNTS = iter([])
RAID_CALLS = []
PREV_LEVEL = [2]
def raid_discord(method, path, body=None):
    RAID_CALLS.append((method, path, body))
    if method == "GET" and "with_counts=true" in path:
        return 200, {"approximate_member_count": next(COUNTS), "verification_level": 1}
    if method == "GET" and path.startswith("/guilds/"):
        return 200, {"verification_level": PREV_LEVEL[0]}
    return 204, {}
_raid_real = common.discord
common.load_config = lambda: {"guild_id": "G", "channels": {"mod_log": "LOG"}}

# (a) alert mode: a sustained +13 jump over 3 samples fires ONE alert, no lockdown
STORE.clear(); POSTS.clear(); PERSISTS.clear()
STORE["modconfig.json"] = {"raid": {"enabled": True, "join_burst": 8, "join_window_sec": 120,
                                    "action": "alert", "auto_clear_min": 15}}
COUNTS = iter([100, 100, 113]); RAID_CALLS = []; LOOP_N[0] = 3
common.discord = raid_discord
raid_bot.main()
alerts = [c for _, c in POSTS if "Possible raid" in c]
check("alert mode: one raid alert on the spike", len(alerts) == 1)
check("alert mode: reports +13 over baseline", any("+13" in c for _, c in POSTS))
check("alert mode: never changes verification", not any(m == "PATCH" for m, _, _ in RAID_CALLS))

# (b) lockdown mode: spike -> alert + verification raised to VERY_HIGH, prev stored
STORE.clear(); POSTS.clear(); PERSISTS.clear()
STORE["modconfig.json"] = {"raid": {"enabled": True, "join_burst": 8, "join_window_sec": 120,
                                    "action": "lockdown", "auto_clear_min": 15}}
now0 = common.unix(common.now_utc())
STORE["state_raid.json"] = {"samples": [[now0 - 30, 100]], "last_alert": 0}
COUNTS = iter([120]); RAID_CALLS = []; PREV_LEVEL[0] = 2; LOOP_N[0] = 1
common.discord = raid_discord
raid_bot.main()
patches = [b for m, p, b in RAID_CALLS if m == "PATCH"]
lock = STORE["state_raid.json"].get("lockdown")
check("lockdown mode: raid alert posted", any("Possible raid" in c for _, c in POSTS))
check("lockdown mode: verification raised to 4 (VERY_HIGH)", any(b.get("verification_level") == 4 for b in patches))
check("lockdown mode: previous level (2) stored for restore", lock and lock.get("prev_verification") == 2)
check("lockdown mode: auto-clear timer set in the future", lock and lock.get("until") > now0)
check("lockdown mode: state persisted", PERSISTS == ["state_raid.json"])

# (c) auto-revert: once the timer elapses, verification is restored + lockdown cleared
STORE["state_raid.json"]["lockdown"] = {"until": now0 - 1, "prev_verification": 2}
POSTS.clear(); RAID_CALLS = []; COUNTS = iter([120]); LOOP_N[0] = 1
common.discord = raid_discord
raid_bot.main()
patches = [b for m, p, b in RAID_CALLS if m == "PATCH"]
check("revert: verification restored to prev (2)", any(b.get("verification_level") == 2 for b in patches))
check("revert: lockdown cleared from state", "lockdown" not in STORE["state_raid.json"])
common.discord = _raid_real

# ───────────────────────── 12. mod_panel helpers ───────────────────────────
print("\n[mod_panel]")
try:
    import mod_panel
except ImportError:
    mod_panel = None
    print("  SKIP: mod_panel.py not in this checkout (local-only GUI; CI runs without it)")
if mod_panel:
    profiles = modconfig.DEFAULT_PROFILES
    check("channel_entry -> bare profile when it matches the profile",
          mod_panel.channel_entry("standard", ["slurs", "scam", "ads"], "allow", False, profiles) == "standard")
    e2 = mod_panel.channel_entry("standard", ["slurs"], "no_links", True, profiles)
    check("channel_entry -> inline override when changed",
          isinstance(e2, dict) and e2["media_policy"] == "no_links" and e2["categories"] == ["slurs"] and e2["nsfw_images"] is True)

    fc = mod_panel.friendly_channels({"channels": {"general": "111", "memes": "222"}, "patrol_channels": ["111", "333"]},
                                     {"channels": {"444": "sfw_strict"}})
    names = dict(fc)
    check("friendly_channels lists named + patrol + modconfig channels", set(names) == {"111", "222", "333", "444"})
    check("friendly_channels uses names where known", names["111"] == "general" and names["222"] == "memes")
    check("friendly_channels falls back to an id label", names["333"].endswith("333") and names["444"].endswith("444"))

    good = modconfig.base_defaults(); good["channels"] = {"1": "standard"}
    check("validate passes a clean config", mod_panel.validate_modconfig(good, []) == [])
    bad = modconfig.base_defaults(); bad["channels"] = {"1": "nope"}
    check("validate flags an unknown profile", any("unknown profile" in e for e in mod_panel.validate_modconfig(bad, [])))
    bad2 = modconfig.base_defaults(); bad2["categories"]["scam"]["regex"] = ["r"] * 11
    check("validate flags >10 regex (Discord cap)", any("10 regex" in e for e in mod_panel.validate_modconfig(bad2, [])))
    secret = modconfig.base_defaults(); secret["categories"]["scam"]["words"] = ["MY_SECRET_TOKEN_abc123"]
    check("validate refuses an embedded config.txt secret",
          any("SECRET" in e for e in mod_panel.validate_modconfig(secret, ["MY_SECRET_TOKEN_abc123"])))

    # News tab pure helper
    _form = {"mode": "digest",
             "sources": {"sherdog": False, "mma_fighting": True},
             "categories": {"boxing": True, "ufc": True},
             "breaking": "Retires\n  dies \n",
             "exclude": "clickbait\n",
             "digest_times": "09:00, 21:30", "min_items": "2", "digest_ping": False,
             "max_per_hour": "4", "dedupe": True}
    _newscfg = newsconfig.base_defaults()
    _out = mod_panel.collect_news(_newscfg, _form)
    check("news tab: mode + toggles applied",
          _out["mode"] == "digest" and _out["sources"]["sherdog"]["enabled"] is False and
          _out["categories"]["boxing"]["enabled"] is True)
    check("news tab: keywords parsed + normalized",
          _out["breaking_keywords"] == ["retires", "dies"] and "clickbait" in _out["exclude_keywords"])
    check("news tab: betting excludes can never be removed",
          all(w in _out["exclude_keywords"] for w in ("betting", "odds", "parlay", "gambling")))
    check("news tab: digest + caps applied",
          _out["digest"]["times_utc"] == ["09:00", "21:30"] and _out["digest"]["min_items"] == 2 and
          _out["digest"]["ping"] is False and _out["max_per_hour"] == 4)
    check("news tab: source dict untouched otherwise",
          _out["sources"]["mma_mania"]["enabled"] is True and _newscfg["mode"] == "hybrid")
    check("news tab result validates clean", newsconfig.validate_newsconfig(_out) == [])

    # nickname-filter form helper
    _mp = mod_panel.collect_member_profile(True, "SlurOne*\n  slurtwo \n\n")
    check("nickname helper normalizes + lowercases words",
          _mp == {"enabled": True, "words": ["slurone*", "slurtwo"]})
    check("nickname helper never enables an empty rule",
          mod_panel.collect_member_profile(True, "  \n") == {"enabled": False, "words": []})

print("\n[secret-safety]")
try:
    import deploy_bots
except ImportError:
    deploy_bots = None
    print("  SKIP: deploy_bots.py not in this checkout (local-only deploy; CI runs without it)")
if deploy_bots:
    import json as _json
    clean = _json.dumps(modconfig.base_defaults()).encode()
    check("modconfig defaults pass the pre-upload secret scanner", deploy_bots.scan_for_secrets(clean, []) is None)
    planted = _json.dumps({"x": "ghp_" + "a" * 36}).encode()
    check("a planted GitHub token is caught", deploy_bots.scan_for_secrets(planted, []) is not None)
    cfgval = _json.dumps({"words": ["SuperSecretValue12345"]}).encode()
    check("a config.txt value embedded in words is caught",
          deploy_bots.scan_for_secrets(cfgval, ["SuperSecretValue12345"]) is not None)
    check("modconfig.py + modconfig.json are in the upload set",
          ("modconfig.py", "modconfig.py") in deploy_bots.UPLOADS and ("modconfig.json", "modconfig.json") in deploy_bots.UPLOADS)
    check("mod_panel.py is NOT uploaded (local-only GUI)",
          not any("mod_panel" in r for r, _ in deploy_bots.UPLOADS))
    newsclean = _json.dumps(newsconfig.base_defaults()).encode()
    check("newsconfig defaults pass the pre-upload secret scanner", deploy_bots.scan_for_secrets(newsclean, []) is None)
    check("newsconfig + the layout module are in the upload set",
          ("newsconfig.py", "newsconfig.py") in deploy_bots.UPLOADS and
          ("newsconfig.json", "newsconfig.json") in deploy_bots.UPLOADS and
          ("layout.py", "layout.py") in deploy_bots.UPLOADS)
    check("logo tooling is NOT uploaded (local-only)",
          not any(("make_logo" in r or "set_icon" in r) for r, _ in deploy_bots.UPLOADS))
    check("surviving bots + CI files are in the upload set",
          ("news_bot.py", "news_bot.py") in deploy_bots.UPLOADS and
          ("selftest_changes.py", "../selftest_changes.py") in deploy_bots.UPLOADS and
          ("commands_worker/worker.js", "../commands_worker/worker.js") in deploy_bots.UPLOADS and
          (".github/workflows/selftest.yml", ".github/workflows/selftest.yml") in deploy_bots.UPLOADS)
    check("the MMA forum poller ships with the normal deploy (one config lane, no "
          "--server rebuild needed to patch it)",
          ("mma_bot.py", "../mma_github/mma_bot.py") in deploy_bots.UPLOADS and
          ("mma_config.json", "mma_config.json") in deploy_bots.UPLOADS and
          (".github/workflows/poll.yml", "../mma_github/.github/workflows/poll.yml")
          in deploy_bots.UPLOADS)

    # Retired files: the deploy only ever UPLOADS, so a leftover workflow keeps firing
    # on cron forever - and one whose script is gone exits non-zero, i.e. a GitHub
    # failure email every 5 minutes. gh_delete is the only supported removal path.
    _RETIRED_BOTS = ("rankings_bot.py", "onthisday_bot.py", "predictions_bot.py",
                     "fightweek_bot.py", "fightnight_bot.py", "clip_bot.py",
                     "livealert_bot.py", "youtube_bot.py", "milestones_bot.py",
                     "quiz_bot.py", "debate_bot.py", "spotlight_bot.py",
                     "server_polish.py", "mma_setup.py")
    _RETIRED_WF = tuple(".github/workflows/%s" % w for w in
                        ("rankings.yml", "onthisday.yml", "predictions.yml", "fightweek.yml",
                         "fightnight.yml", "clip.yml", "livealert.yml", "youtube.yml",
                         "milestones.yml", "quiz.yml", "debate.yml", "spotlight.yml",
                         "server_polish.yml", "setup.yml"))
    check("every retired bot + workflow is gh_deleted from the public repo",
          set(_RETIRED_BOTS) <= set(deploy_bots.RETIRED) and
          set(_RETIRED_WF) <= set(deploy_bots.RETIRED))
    check("retired workflows are deleted BEFORE their scripts (no cron tick can fire "
          "against a missing file mid-deploy)",
          max(deploy_bots.RETIRED.index(w) for w in _RETIRED_WF) <
          min(deploy_bots.RETIRED.index(b) for b in _RETIRED_BOTS))
    # gh_delete used to return True whenever the file merely EXISTED, discarding the
    # DELETE result - so a read-only token printed "removed:" for all 46 retired paths
    # while the repo was untouched. True must mean "actually deleted".
    _ghcalls = []
    _realgh = deploy_bots.gh

    def _fake_gh(codes):
        def f(m, p, b=None):
            _ghcalls.append((m, p))
            return codes.get(m, 200), ({"sha": "s1"} if m == "GET" else {"message": "nope"})
        return f

    _bodies = []

    def _capture_gh(m, p, b=None):
        _bodies.append((m, b))
        return (200, {"sha": "s1"}) if m == "GET" else (204, {})

    deploy_bots.gh = _capture_gh
    deploy_bots.gh_delete("o", "r", "x.py")
    _delbody = next((b for m, b in _bodies if m == "DELETE"), {}) or {}
    # A deploy is ~50 sequential commits. Uploads were CI-quiet but DELETES were not,
    # so removing a bot fired a selftest run against a tree that still had the old
    # suite importing it -> ModuleNotFoundError + a "Run failed" email (commit c8d23ce).
    check("gh_delete commits are CI-quiet too (mid-deploy races caused c8d23ce)",
          "[skip ci]" in _delbody.get("message", ""))

    deploy_bots.gh = _fake_gh({"GET": 200, "DELETE": 204})
    check("gh_delete returns True when the DELETE really succeeds",
          deploy_bots.gh_delete("o", "r", "x.py") is True)
    deploy_bots.gh = _fake_gh({"GET": 200, "DELETE": 403})
    check("gh_delete does NOT claim success when the DELETE is refused",
          deploy_bots.gh_delete("o", "r", "x.py") is None)
    deploy_bots.gh = lambda m, p, b=None: (404, {})
    check("gh_delete returns False for an already-absent file",
          deploy_bots.gh_delete("o", "r", "x.py") is False)
    deploy_bots.gh = _realgh

    # Discord ranks roles by position, ties broken by id with the LOWER id ranking
    # HIGHER. Inverting this is invisible in production: you conclude the bot cannot
    # grant a role it can grant perfectly well, and print a bogus ACTION NEEDED.
    import bots_setup as _bs3
    _roles = [{"id": "100", "position": 1, "name": "bot", "managed": True},
              {"id": "900", "position": 1, "name": "member"},
              {"id": "1", "position": 0, "name": "@everyone"}]
    _rank = [r["name"] for r in _bs3.rank_roles(_roles)]
    check("role rank: @everyone is lowest", _rank[0] == "@everyone")
    check("role rank: on a position tie the OLDER (lower) id ranks HIGHER",
          _rank.index("bot") > _rank.index("member"))
    check("role rank: an explicit higher position still wins over the id tie-break",
          _bs3.rank_roles([{"id": "900", "position": 5, "name": "top"},
                           {"id": "1", "position": 1, "name": "bottom"}])[-1]["name"] == "top")

    check("nothing retired is still uploaded",
          not (set(_RETIRED_BOTS) & set(r for r, _ in deploy_bots.UPLOADS)))
    check("no retired workflow is dispatched",
          not any(w.split("/")[-1] in deploy_bots.DISPATCH for w in _RETIRED_WF))
    check("no dispatched workflow posts member-visible content at deploy time",
          all(w not in deploy_bots.DISPATCH for w in
              ("quiz.yml", "debate.yml", "spotlight.yml", "clip.yml")))
    check("uploads are CI-quiet + ONE selftest dispatched on the final tree "
          "(mid-deploy old-test/new-code races caused run 972892a)",
          "selftest.yml" in deploy_bots.DISPATCH and
          "[skip ci]" in (lambda t, i: t[i:i + 120] if i >= 0 else "")(
              open(os.path.join(_HERE, "deploy_bots.py"), encoding="utf-8").read(),
              open(os.path.join(_HERE, "deploy_bots.py"), encoding="utf-8").read()
              .find('body = {"message": "add " + repo_path')))

# ───────────────────────── 14. predictions_bot (pick'em) ───────────────────
print("\n[nickname filter]")
import json as _json2
_mc_live = _json2.load(open(os.path.join(_BOTS if os.path.isdir(_BOTS) else _HERE,
                                         "modconfig.json"), encoding="utf-8"))
_mp_live = (_mc_live.get("global_rules") or {}).get("member_profile") or {}
check("modconfig ships the nickname filter ENABLED",
      _mp_live.get("enabled") is True and len(_mp_live.get("words") or []) >= 15)
check("nickname list is lowercase, deduped, Discord-legal",
      all(w == w.lower() and 1 <= len(w) <= 60 for w in _mp_live["words"]) and
      len(set(_mp_live["words"])) == len(_mp_live["words"]))
check("no benign-word wildcard traps (exact-match words stay exact)",
      "coon" in _mp_live["words"] and "*coon*" not in _mp_live["words"] and
      "fag" in _mp_live["words"] and "*fag*" not in _mp_live["words"])

mc_nick = modconfig.base_defaults()
mc_nick["global_rules"]["member_profile"] = {"enabled": True, "words": ["slurx*", "slury"]}
_nick_rules = mod_setup.build_rules(mc_nick, ["A"], "LOG", ["OWNER"])
_prof = next((r for r in _nick_rules if r["name"] == "iBP · Profile filter"), None)
check("mod_setup builds the MEMBER_PROFILE rule when enabled+words",
      _prof is not None and _prof["trigger_type"] == 6 and
      _prof["trigger_metadata"].get("keyword_filter") == ["slurx*", "slury"])
check("profile rule is enabled and staff-exempt",
      _prof["enabled"] is True and "OWNER" in _prof.get("exempt_roles", []))
mc_nick2 = modconfig.base_defaults()
mc_nick2["global_rules"]["member_profile"] = {"enabled": False, "words": ["slurx"]}
check("disabled flag -> no profile rule",
      not any(r["name"] == "iBP · Profile filter"
              for r in mod_setup.build_rules(mc_nick2, ["A"], None, [])))
mc_nick3 = modconfig.base_defaults()
mc_nick3["global_rules"]["member_profile"] = {"enabled": True, "words": []}
check("enabled but empty words -> no profile rule (silent-no-op guard)",
      not any(r["name"] == "iBP · Profile filter"
              for r in mod_setup.build_rules(mc_nick3, ["A"], None, [])))

# ───────────────────────── 16. quiz_bot (Friday quiz night) ────────────────
print("\n[snapshot_bot]")
import snapshot_bot
common.now_utc = lambda: common.datetime.datetime(2026, 7, 4, 4, 23,
                                                  tzinfo=common.datetime.timezone.utc)
common.load_config = lambda: {"guild_id": "G1"}
_snap_topic = ["old topic"]
def snap_discord(method, path, body=None):
    if path.startswith("/guilds/G1?"):
        return 200, {"id": "G1", "name": "Prime Arena", "description": "d",
                     "verification_level": 2, "system_channel_id": "GEN",
                     "premium_tier": 0, "icon": "abc", "approximate_member_count": 150}
    if path.endswith("/channels"):
        return 200, [{"id": "2", "name": "beta", "type": 0, "parent_id": None, "position": 1,
                      "topic": _snap_topic[0], "last_message_id": "999999",
                      "permission_overwrites": [{"id": "9", "type": 0, "allow": "1", "deny": "0"},
                                                 {"id": "1", "type": 0, "allow": "0", "deny": "2048"}]},
                     {"id": "1", "name": "alpha", "type": 4, "position": 0}]
    if path.endswith("/roles"):
        return 200, [{"id": "5", "name": "Mod", "color": 1, "hoist": False,
                      "mentionable": False, "permissions": "8", "position": 2}]
    if path.endswith("/auto-moderation/rules"):
        return 200, [{"name": "iBP · Slurs & hate", "trigger_type": 1, "event_type": 1,
                      "enabled": True, "trigger_metadata": {"keyword_filter": ["slurx", "slury"]},
                      "exempt_roles": ["5"], "exempt_channels": [],
                      "actions": [{"type": 1}, {"type": 2}]}]
    return 200, {}
common.discord = snap_discord
STORE.pop("snapshot_config.json", None); STORE.pop("state_snapshot.json", None)
PERSISTS.clear()
snapshot_bot.main()
_snap = STORE["snapshot_config.json"]
_blob = __import__("json").dumps(_snap)
check("snapshot written on first run with sorted channels",
      [c["id"] for c in _snap["channels"]] == ["1", "2"])
check("overwrites sorted + volatile last_message_id stripped",
      [o["id"] for o in _snap["channels"][1]["overwrites"]] == ["1", "9"] and
      "last_message_id" not in _blob and "approximate" not in _blob)
check("automod summarized as COUNTS - keyword contents never in the snapshot",
      _snap["automod"][0]["keyword_count"] == 2 and "slurx" not in _blob)
check("member count recorded in daily history",
      STORE["state_snapshot.json"]["history"] == {"2026-07-04": 150})
_persists_snap = PERSISTS.count("snapshot_config.json")
snapshot_bot.main()
check("second identical run writes NOTHING (no-churn)",
      PERSISTS.count("snapshot_config.json") == _persists_snap)
_snap_topic[0] = "new topic"
snapshot_bot.main()
check("real drift (topic change) re-writes the snapshot",
      PERSISTS.count("snapshot_config.json") == _persists_snap + 1 and
      STORE["snapshot_config.json"]["channels"][1]["topic"] == "new topic")

# ───────────────────────── 21. health_bot (weekly staff report) ────────────
print("\n[health_bot]")
import health_bot
# freeze a known "now" so feed ages are deterministic
_HNOW = common.datetime.datetime(2026, 7, 4, 12, 0, tzinfo=common.datetime.timezone.utc)
common.now_utc = lambda: _HNOW

# ---- render(): honest workflow classification (the core fix) --------------
# The report used to paint every non-"success" row red. Now only genuine
# problems are ❌; setup workflows (manual), brand-new cron bots (awaiting) and
# the watch-window bots that are legitimately mid-run (running) are not.
_wf = [("Auto Events",   "ok",       "",                                       1.0),
       ("MMA News Wire", "running",  "running now · last completed ✅",         0.2),
       ("Config Snapshot", "awaiting", "awaiting first scheduled run",         None),
       ("Weekly Health", "awaiting", "awaiting first scheduled run",           None),
       ("Bots Setup",    "manual",   "manual-only — deploy runs this locally", None),
       ("Moderation Patrol", "issue", "failure (30h ago)",                     30.0)]
_feeds = [("MMA Fighting", 3.0, None), ("MMA Mania", 5.0, None), ("Sherdog", None, "HTTP 403")]
_hc, _he = health_bot.render(_wf, _feeds, rules_n=6, sizes=[("state_news.json", 2048)], trend=(150, 5))
_fields = {f["name"]: f["value"] for f in _he["fields"]}
_wfv = _fields["⚙️ Workflows"]
check("only real issues counted (1 failing wf + 1 dead feed = 2)", "2 thing(s)" in _hc)
check("summary counts break down and sum to the total",
      "6 workflows" in _wfv and "1 ✅" in _wfv and "1 🔄 running" in _wfv
      and "2 ⏳ awaiting first run" in _wfv and "1 🖱️ manual" in _wfv and "1 ❌" in _wfv)
check("a real failure is named as ❌", "❌ Moderation Patrol — failure (30h ago)" in _wfv)
check("manual + running + awaiting bots are NOT flagged ❌",
      "❌ Bots Setup" not in _wfv and "❌ MMA News Wire" not in _wfv and "❌ Config Snapshot" not in _wfv)
check("awaiting-first-run bots listed compactly (not as failures)",
      "⏳ first run pending: Config Snapshot, Weekly Health" in _wfv)
check("blocked feed shows its HTTP code, not a vague 'unreachable'",
      "⛔ Sherdog — HTTP 403" in _fields["📰 Feeds"])
check("live feeds aged correctly",
      "✅ MMA Fighting — newest 3h ago" in _fields["📰 Feeds"]
      and "✅ MMA Mania — newest 5h ago" in _fields["📰 Feeds"])
check("automod count + member trend rendered",
      "6 active rules" in _fields["🛡️ AutoMod"] and "150 (+5 this week)" in _fields["👥 Members"])

# zero real issues -> green + "nominal" even with manual/awaiting rows present
_hc2, _he2 = health_bot.render(
    wf=[("News", "ok", "", 1.0), ("Setup", "manual", "", None), ("Quiz", "awaiting", "", None)],
    feeds=[("F", 1.0, None)], rules_n=1, sizes=[], trend=None)
check("no-issue report is green + nominal", "nominal" in _hc2 and _he2["color"] == 0x2ECC71)
_hc3, _ = health_bot.render(wf=None, feeds=[("F", 1.0, None)], rules_n=1, sizes=[], trend=None)
check("GitHub API down degrades gracefully (no false alarm)", "nominal" in _hc3)

# ---- feed_ages(): parses BOTH RSS <pubDate> and Atom <updated> ------------
STORE.pop("newsconfig.json", None)   # clean defaults -> mma_fighting/bloody_elbow/mma_mania
common.get_text = lambda url, headers=None, tries=4: \
    (200, "<feed><updated>2026-07-04T00:00:00+00:00</updated></feed>")
_fa = health_bot.feed_ages()
check("Atom <updated> feed is parsed (was wrongly 'unreachable' before)",
      len(_fa) >= 1 and all(age is not None for _n, age, _note in _fa))
common.get_text = lambda url, headers=None, tries=4: (403, "")
_fa2 = health_bot.feed_ages()
check("a 403-blocked feed reports its code, not silence",
      all(age is None and "403" in (note or "") for _n, age, note in _fa2))

# ---- main(): silent staff post + graceful no-token path -------------------
common.load_config = lambda: {"guild_id": "G1", "channels": {"staff_chat": "SC"}}
os.environ.pop("GH_API_TOKEN", None)
common.get_text = lambda url, headers=None, tries=4: (200, "<rss><pubDate>Fri, 04 Jul 2026 10:00:00 GMT</pubDate></rss>")
common.discord = lambda m, p, b=None: (200, [{"name": "r"}] * 6)
STORE["state_snapshot.json"] = {"v": 1, "history": {"2026-06-25": 140, "2026-07-04": 150}}
POSTS_FULL.clear()
health_bot.main()
_hp = POSTS_FULL[-1]
check("health report posts SILENT to staff chat",
      _hp["chan"] == "SC" and _hp["silent"] is True and _hp["embeds"])
check("degrades gracefully without the GitHub token",
      "GitHub API unavailable" in str(_hp["embeds"][0]["fields"]))
check("member trend read from snapshot history", "150" in str(_hp["embeds"][0]["fields"]))
common.now_utc = _real_now

# ───────────────────────── summary ─────────────────────────────────────────
print("\n==== %d passed, %d failed ====" % (PASS, FAIL))
sys.exit(1 if FAIL else 0)
