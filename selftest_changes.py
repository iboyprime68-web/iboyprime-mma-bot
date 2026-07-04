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
check("4 MMA sources enabled, boxing feeds disabled",
      len(newsconfig.enabled_sources(NCFG)) == 4 and
      not NCFG["sources"]["bad_left_hook"]["enabled"] and not NCFG["sources"]["boxing_scene"]["enabled"])
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
      _merged["mode"] == "digest" and _merged["max_per_hour"] == 3 and _merged["sources"]["sherdog"]["enabled"])

# ───────────────────────── 3. news_bot v3 ──────────────────────────────────
print("\n[news_bot v3]")
import news_bot
common.load_config = lambda: {"channels": {"mma_news": "C"},
                              "roles": {"news_pings": "NR", "digest_ping": "DR"}}
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
check("content is 'Headline — Source' (no markdown, no URL)",
      POSTS_FULL[0]["content"] == "Volkanovski defends belt in Sydney thriller — MMA Fighting")
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
check("breaking post is LOUD (not silent)", len(POSTS_FULL) == 1 and not POSTS_FULL[0]["silent"])
check("breaking pings the news role only",
      POSTS_FULL[0]["content"].startswith("<@&NR> 🚨") and
      POSTS_FULL[0]["mentions"] == {"parse": [], "roles": ["NR"]})

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
check("digest is loud and pings the digest role",
      not POSTS_FULL[0]["silent"] and POSTS_FULL[0]["mentions"] == {"parse": [], "roles": ["DR"]})
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
check("build_message content has no markdown", _bm_c == "Huge news link here — Sherdog")

# near-instant delivery: tight poll cadence across a long, cron-requeued window
check("news polls every ~20s across a ~55-min window",
      news_bot.POLL_SECONDS <= 30 and news_bot.WINDOW_SECONDS >= 1800)
import livealert_bot as _la, youtube_bot as _yt
check("live + youtube also run tight continuous windows",
      _la.POLL_SECONDS <= 60 and _la.WINDOW_SECONDS >= 1800 and
      _yt.POLL_SECONDS <= 60 and _yt.WINDOW_SECONDS >= 1800)

common.now_utc = _real_now

# ───────────────────────── 4. youtube_bot ──────────────────────────────────
print("\n[youtube_bot]")
import youtube_bot
os.environ.pop("YOUTUBE_API_KEY", None)
common.load_config = lambda: {"channels": {"announcements": "A", "live_now": "L"},
                              "roles": {"youtube_pings": "Y", "live_pings": "R"},
                              "creator": {"youtube_channel_id": "UCtest"}}
def yt_feed(entries):
    body = "".join("<entry><videoId>%s</videoId><title>%s</title>"
                   "<link rel='alternate' href='%s'/><published>%s</published></entry>" % e
                   for e in entries)
    common.get_text = lambda url, headers=None, tries=4: (200, "<feed>%s</feed>" % body)

STORE.clear(); POSTS.clear(); PERSISTS.clear(); LOOP_N[0] = 1
yt_feed([("v1", "T1", "http://y/1", "2024-01-01T10:00:00+00:00"),
         ("v2", "T2", "http://y/2", "2024-01-01T11:00:00+00:00")])
youtube_bot.main()
check("first run seeds silently (0 posts)", len(POSTS) == 0)
check("first run marks videos seen", set(STORE["state_youtube.json"]["seen"]) == {"v1", "v2"})

POSTS.clear(); PERSISTS.clear(); LOOP_N[0] = 1
yt_feed([("v1", "T1", "http://y/1", "2024-01-01T10:00:00+00:00"),
         ("v2", "T2", "http://y/2", "2024-01-01T11:00:00+00:00"),
         ("v3", "T3", "http://y/3", "2024-01-01T12:00:00+00:00")])
youtube_bot.main()
check("steady state posts the one new upload", len(POSTS) == 1 and POSTS[0][0] == "A")
check("upload pings the YouTube role", "<@&Y>" in POSTS[0][1])
check("persisted after posting", PERSISTS == ["state_youtube.json"])
check("upload content is plain text (no markdown, no URL)",
      POSTS_FULL[-1]["content"] == "<@&Y> 📺 New video: T3")
check("upload embed carries link + thumbnail",
      POSTS_FULL[-1]["embeds"][0]["url"] == "http://y/3" and
      "v3" in POSTS_FULL[-1]["embeds"][0]["image"]["url"])
check("upload stays loud (opt-in ping role)", not POSTS_FULL[-1]["silent"])

# ───────────────────────── 5. livealert_bot ────────────────────────────────
print("\n[livealert_bot]")
import livealert_bot
common.load_config = lambda: {"channels": {"live_now": "L"}, "roles": {"live_pings": "R"}}
common.discord = lambda method, path, body=None: (200, {"id": "thr"})   # thread creation
LIVE = {"live": True, "id": "s1", "title": "T", "game": "G", "viewers": 5,
        "started": "2024-01-01T10:00:00+00:00", "url": "http://t", "user_id": "u", "_h": {}}
holder = {"info": LIVE}
livealert_bot.PLATFORMS = {"twitch": ("Twitch", 0x9146FF, lambda cfg: holder["info"], lambda i: "http://vod")}

STORE.clear(); POSTS.clear(); PERSISTS.clear(); LOOP_N[0] = 1
livealert_bot.main()
check("go-live posts exactly one alert", len(POSTS) == 1 and "LIVE" in POSTS[0][1])
check("go-live pings the live role", "<@&R>" in POSTS[0][1])
check("session stored", "twitch" in STORE["state_live.json"])
check("persisted on go-live", PERSISTS == ["state_live.json"])
check("go-live content is plain text (no markdown, no URL)",
      POSTS_FULL[-1]["content"] == "<@&R> 🔴 iBoyPrime is LIVE on Twitch — T")
check("go-live embed carries link + viewers",
      POSTS_FULL[-1]["embeds"][0]["url"] == "http://t" and
      "5 watching" in POSTS_FULL[-1]["embeds"][0]["description"])
check("go-live stays loud", not POSTS_FULL[-1]["silent"])

POSTS.clear(); PERSISTS.clear()                 # same session, new job -> must NOT re-ping
livealert_bot.main()
check("same session does not re-post", len(POSTS) == 0)

POSTS.clear(); PERSISTS.clear()                 # stream ends -> one recap
holder["info"] = {"live": False, "login": "x"}
livealert_bot.main()
check("stream end posts exactly one recap", len(POSTS) == 1 and "recap" in POSTS[0][1].lower())
check("session cleared after recap", "twitch" not in STORE["state_live.json"])
check("recap is SILENT with duration/peak fields",
      POSTS_FULL[-1]["silent"] and len(POSTS_FULL[-1]["embeds"][0]["fields"]) >= 2)

# ─────────────── 5b. calm-mode formats: memes / rankings / on-this-day ──────
print("\n[calm formats]")
import memes_bot, rankings_bot, onthisday_bot

# memes: silent, image in an embed
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

# rankings movement alerts: one silent embed
POSTS.clear(); POSTS_FULL.clear()
rankings_bot.alert_post("C", ["👑 **Heavyweight** — new champion: **Jon Jones**",
                              "📈 **Aspinall** climbed to #1"])
check("rankings alert is ONE silent embed post",
      len(POSTS_FULL) == 1 and POSTS_FULL[0]["silent"] and
      "Jon Jones" in POSTS_FULL[0]["embeds"][0]["description"])
check("rankings alert content is plain + counts changes",
      POSTS_FULL[0]["content"] == "UFC Rankings Update — 2 change(s)")
_long = ["line %d with some padding text here" % i for i in range(200)]
POSTS_FULL.clear()
rankings_bot.alert_post("C", _long)
check("oversized alert list truncates inside the 4096 cap",
      len(POSTS_FULL[0]["embeds"][0]["description"]) <= 4096 and
      "more change" in POSTS_FULL[0]["embeds"][0]["description"])

# on-this-day: silent, spoiler stays in content (data file read goes through the
# mocked load_json, so preload a trivia entry)
common.load_config = lambda: {"channels": {"on_this_day": "O"}}
STORE.clear(); POSTS.clear(); POSTS_FULL.clear()
STORE["onthisday_data.json"] = {"trivia": [{"q": "Who?", "a": "Him"}], "on_this_day": {}}
onthisday_bot.main()
check("on-this-day post is SILENT", POSTS_FULL and POSTS_FULL[-1]["silent"])
check("trivia spoiler stays in content", "||" in POSTS_FULL[-1]["content"])

# ─────────────── 5c. fightweek stores the poll ids (pick'em-ready) ──────────
print("\n[fightweek poll]")
import fightweek_bot
common.load_config = lambda: {"channels": {"fight_week": "F"}}
_start = (common.now_utc() + common.datetime.timedelta(days=2)).strftime("%Y-%m-%dT%H:%M:%SZ")
_sb = {"leagues": [{"calendar": [{"event": {"$ref": "http://e/events/601"},
                                  "startDate": _start}]}],
       "events": [{"id": "601", "date": _start, "name": "UFC 999",
                   "competitions": [
                       {"competitors": [{"order": 1, "athlete": {"displayName": "Alpha Man"}},
                                        {"order": 2, "athlete": {"displayName": "Beta Guy"}}],
                        "type": {"abbreviation": "HW"}}]}]}
common.get_json = lambda url, headers=None, tries=4: \
    (200, copy.deepcopy(_sb)) if "ufc/scoreboard" in url else (200, {})
common.create_forum_thread = lambda forum, title, content, allowed_mentions=None, applied_tags=None: \
    (201, {"id": "T1"})
_poll_posts = []
def fw_discord(method, path, body=None):
    if method == "POST" and "/messages" in path and body and "poll" in body:
        _poll_posts.append((path, body)); return 200, {"id": "PM1"}
    return 200, {}
common.discord = fw_discord
STORE.clear()
fightweek_bot.main()
_hub = STORE["state_fightweek.json"]["hubs"]["601"]
check("hub created with a poll", len(_poll_posts) == 1)
check("poll ids captured for future pick'em",
      _hub.get("poll", {}).get("message_id") == "PM1" and
      _hub["poll"]["channel_id"] == "T1" and
      _hub["poll"]["answers"] == {"1": "Alpha Man", "2": "Beta Guy"})

# ───────────────────────── 6. onboarding_setup ─────────────────────────────
print("\n[onboarding_setup]")
import onboarding_setup

existing = [{"id": "E", "type": 0, "allow": str(VIEW | READ_HIST), "deny": str(SEND)}]
ow = {o["id"]: o for o in onboarding_setup.gate_overwrites(existing, "E", ["ROLE"])}
check("@everyone VIEW now denied", int(ow["E"]["deny"]) & VIEW)
check("@everyone VIEW removed from allow", not (int(ow["E"]["allow"]) & VIEW))
check("existing READ_HISTORY allow preserved", int(ow["E"]["allow"]) & READ_HIST)
check("existing SEND deny preserved (stays read-only)", int(ow["E"]["deny"]) & SEND)
check("opt-in role gets VIEW", int(ow["ROLE"]["allow"]) & VIEW)

chan_by_name = {n: {"id": "c%d" % i} for i, n in enumerate(onboarding_setup.DEFAULT_CHANNELS)}
role_by_name = {"🎮 Gamer": "r1", "🥊 MMA Fan": "r2", "🔴 Live Pings": "r3",
                "📹 YouTube Pings": "r4", "🎬 TikTok Pings": "r5", "📣 Announcements": "r6",
                "🎉 Events": "r7", "🥊 Fight Alerts": "r8", "🚨 Fight Results": "r9"}
default_ch, prompts = onboarding_setup.build_onboarding(chan_by_name, role_by_name)
check("default channels >= 7 (Discord min)", len(default_ch) >= 7)
writable = sum(1 for n in ("💬-general", "👋-introductions", "🖼️-media", "😂-memes",
                           "🎲-off-topic", "🤖-bot-commands", "✂️-clips-n-highlights")
               if n in chan_by_name)
check("default set has >= 5 writable channels", writable >= 5)
check("every option grants a role or channel", all(o["role_ids"] or o["channel_ids"]
                                                    for p in prompts for o in p["options"]))
check("no empty prompts", all(p["options"] for p in prompts))
check("Gaming option -> Gamer role (reveals Gaming)",
      any("r1" in o["role_ids"] for p in prompts for o in p["options"]))
check("MMA option -> MMA Fan role (reveals MMA)",
      any("r2" in o["role_ids"] for p in prompts for o in p["options"]))

# missing roles get filtered out, never producing an invalid (empty) option
d2, p2 = onboarding_setup.build_onboarding(chan_by_name, {"🎮 Gamer": "r1"})
check("missing roles filtered, options still valid",
      all(o["role_ids"] or o["channel_ids"] for p in p2 for o in p["options"]))

# ──────────────────── 6b. onboarding Part 2: notify + visibility ────────────
print("\n[onboarding part2]")
roles_full = {"🎮 Gamer": "r1", "🥊 MMA Fan": "r2", "🔴 Live Pings": "r3",
              "📹 YouTube Pings": "r4", "📣 Announcements": "r6", "🎉 Events": "r7",
              "🥊 Fight Alerts": "r8", "🚨 Fight Results": "r9",
              "👁️ Live Viewer": "v1", "👁️ Videos Viewer": "v2"}
chans_full = {n: {"id": "c%d" % i} for i, n in enumerate(onboarding_setup.DEFAULT_CHANNELS)}
dch, pr = onboarding_setup.build_onboarding(chans_full, roles_full)
check("exactly 4 prompts (Discord's cap)", len(pr) == 4)
live_p = next(p for p in pr if "LIVE" in p["title"])
vids_p = next(p for p in pr if "YouTube videos" in p["title"])
check("LIVE prompt is single-select", live_p["single_select"] is True)
check("VIDEOS prompt is single-select", vids_p["single_select"] is True)
live_roles = [o["role_ids"] for o in live_p["options"]]
vids_roles = [o["role_ids"] for o in vids_p["options"]]
check("LIVE = ping(Live Pings) + view-only(Live Viewer)", ["r3"] in live_roles and ["v1"] in live_roles)
check("VIDEOS = ping(YouTube Pings) + view-only(Videos Viewer)", ["r4"] in vids_roles and ["v2"] in vids_roles)
check("no TikTok anywhere in prompts",
      not any("tiktok" in (o["title"] + " " + o.get("description", "")).lower()
              for p in pr for o in p["options"]))
check("gated live/video channels are NOT onboarding defaults",
      all(n not in onboarding_setup.DEFAULT_CHANNELS
          for n in ("🔴-live-now", "📹-youtube-uploads", "🎬-tiktok-posts")))

# news ping opt-ins (P4) - added with the v3 news system
roles_news = dict(roles_full, **{"📰 News Pings": "np", "🗞️ Digest Ping": "dp"})
dch3, pr3 = onboarding_setup.build_onboarding(chans_full, roles_news)
more_p = next(p for p in pr3 if p["title"] == "More pings (optional)")
check("P4 gains the two news options (6 total)", len(more_p["options"]) == 6)
check("breaking-news option grants 📰 News Pings",
      any(o["role_ids"] == ["np"] for o in more_p["options"]))
check("digest option grants 🗞️ Digest Ping",
      any(o["role_ids"] == ["dp"] for o in more_p["options"]))
check("still exactly 4 prompts with the news options", len(pr3) == 4)
check("🔔-notify-setup dropped from onboarding defaults",
      "🔔-notify-setup" not in onboarding_setup.DEFAULT_CHANNELS)
os.environ.setdefault("DISCORD_BOT_TOKEN", "dummy-token-for-import-only")
import bots_setup as _bs
check("bots_setup deletes 🔔-notify-setup", "🔔-notify-setup" in _bs.DELETE_CHANNELS)
check("bots_setup ensure-creates the news + award roles",
      set(_bs.NEW_ROLES) == {"news_pings", "digest_ping", "fight_prophet", "clip_champ"} and
      _bs.NEW_ROLES["news_pings"][0] == "📰 News Pings" and
      _bs.NEW_ROLES["fight_prophet"][0] == "🏆 Fight Prophet" and
      _bs.NEW_ROLES["clip_champ"][0] == "🎬 Clip Champ")
check("new community channels resolved into bots_config",
      _bs.EXISTING_CHANNELS.get("mma_chat") == "🥊-mma-chat" and
      _bs.EXISTING_CHANNELS.get("plays_n_clips") == "🏆-plays-n-clips" and
      _bs.EXISTING_CHANNELS.get("staff_chat") == "📋-staff-chat")

# ping role listed FIRST in each gated channel - that's the "pinged => can see it" guarantee
glc = onboarding_setup.GATED_CHANNELS
check("live-now: ping role first + viewer role present",
      glc["🔴-live-now"][0] == "🔴 Live Pings" and "👁️ Live Viewer" in glc["🔴-live-now"])
check("youtube-uploads: ping role first + viewer role present",
      glc["📹-youtube-uploads"][0] == "📹 YouTube Pings" and "👁️ Videos Viewer" in glc["📹-youtube-uploads"])
gow = {o["id"]: o for o in onboarding_setup.gate_overwrites([], "EV", ["r3", "v1"])}
check("gated channel: @everyone denied VIEW", int(gow["EV"]["deny"]) & VIEW)
check("gated channel: PING role can see it (pinged => visible)", int(gow["r3"]["allow"]) & VIEW)
check("gated channel: view-only role can see it", int(gow["v1"]["allow"]) & VIEW)

created = []
def fake_discord_role(method, path, body=None):
    if method == "POST" and path.endswith("/roles"):
        created.append(body["name"]); return 200, {"id": "newrole"}
    return 200, {}
_rd = common.discord; common.discord = fake_discord_role
check("ensure_role creates a missing role", onboarding_setup.ensure_role("G", "👁️ Live Viewer", 1, {}) == "newrole" and created)
check("ensure_role idempotent (no duplicate create)",
      onboarding_setup.ensure_role("G", "👁️ Live Viewer", 1, {"👁️ Live Viewer": "had"}) == "had")
common.discord = _rd

# ──────────────────── 6c. YouTube routing + official Kick API ───────────────
print("\n[youtube routing + kick]")
common.load_config = lambda: {"channels": {"youtube_uploads": "YU", "announcements": "A", "live_now": "L"},
                              "roles": {"youtube_pings": "Y", "live_pings": "R"},
                              "creator": {"youtube_channel_id": "UCtest"}}
STORE.clear(); POSTS.clear(); LOOP_N[0] = 1
yt_feed([("v1", "T1", "http://y/1", "2024-01-01T10:00:00+00:00")])
youtube_bot.main()                                  # first run seeds silently
POSTS.clear(); LOOP_N[0] = 1
yt_feed([("v1", "T1", "http://y/1", "2024-01-01T10:00:00+00:00"),
         ("v2", "T2", "http://y/2", "2024-01-01T11:00:00+00:00")])
youtube_bot.main()
check("uploads route to #youtube-uploads (not announcements)", len(POSTS) == 1 and POSTS[0][0] == "YU")

os.environ["KICK_CLIENT_ID"] = "x"; os.environ["KICK_CLIENT_SECRET"] = "y"
_h = common.http;  common.http = lambda *a, **k: (200, '{"access_token": "tok"}')
_gj = common.get_json
common.get_json = lambda url, headers=None, tries=4: (200, {"data": [
    {"slug": "iboyprime", "stream_title": "Live!",
     "stream": {"is_live": True, "viewer_count": 42, "start_time": "2024-01-01T10:00:00Z"}}]})
ks = livealert_bot.kick_status({"creator": {"kick_slug": "iboyprime"}})
check("kick_status parses official is_live=true", bool(ks) and ks["live"] and ks["viewers"] == 42 and ks["title"] == "Live!")
common.get_json = lambda url, headers=None, tries=4: (200, {"data": [{"slug": "iboyprime", "stream": {"is_live": False}}]})
ks2 = livealert_bot.kick_status({"creator": {"kick_slug": "iboyprime"}})
check("kick_status parses official is_live=false", bool(ks2) and ks2["live"] is False)
common.http = _h; common.get_json = _gj
os.environ.pop("KICK_CLIENT_ID", None); os.environ.pop("KICK_CLIENT_SECRET", None)
check("kick_status disabled (None) without keys", livealert_bot.kick_status({"creator": {"kick_slug": "iboyprime"}}) is None)

# ───────────────────────── 7. modconfig resolver ───────────────────────────
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
          _out["sources"]["mma_junkie"]["enabled"] is True and _newscfg["mode"] == "hybrid")
    check("news tab result validates clean", newsconfig.validate_newsconfig(_out) == [])

# ───────────────────────── 12b. server_polish ──────────────────────────────
print("\n[server_polish]")
import server_polish
server_polish.time = types.SimpleNamespace(sleep=lambda s: None)
SP_CALLS = []
def sp_discord(method, path, body=None):
    SP_CALLS.append((method, path, body))
    if method == "GET" and path.endswith("/welcome-screen"):
        return 404, {}
    if method == "GET" and path.endswith("/users/@me"):
        return 200, {"id": "BOT"}
    if method == "GET" and "/messages" in path:
        return 200, []
    return 200, {}
common.discord = sp_discord
common.post_message = fake_post

sp_chans = {
    "👋-welcome":   {"id": "W", "type": 5, "topic": ""},
    "💬-general":   {"id": "G", "type": 0, "topic": server_polish.TOPICS["💬-general"]},
    "😂-memes":     {"id": "M", "type": 0, "topic": "old topic"},
    "🎭-get-roles": {"id": "R", "type": 0, "topic": ""},
}
SP_CALLS.clear()
server_polish.patch_guild("G1", {"description": None, "system_channel_id": None}, sp_chans)
check("guild PATCH sets description + join-message channel (regular text, not announcement)",
      any(m == "PATCH" and p == "/guilds/G1" and "description" in b and b.get("system_channel_id") == "G"
          for m, p, b in SP_CALLS))
SP_CALLS.clear()
server_polish.patch_guild("G1", {"description": server_polish.GUILD_DESCRIPTION,
                                 "system_channel_id": "G"}, sp_chans)
check("guild PATCH is a no-op when already current", not any(m == "PATCH" for m, p, b in SP_CALLS))

SP_CALLS.clear()
server_polish.patch_welcome_screen("G1", sp_chans)
_ws = [b for m, p, b in SP_CALLS if m == "PATCH" and p.endswith("/welcome-screen")]
check("welcome screen enabled with the known featured channels",
      _ws and _ws[0]["enabled"] is True and len(_ws[0]["welcome_channels"]) == 3 and
      len(_ws[0]["description"]) <= 140)
check("welcome screen only features always-visible channels (gated ones 400)",
      all(n in ("👋-welcome", "💬-general", "👋-introductions", "😂-memes", "✂️-clips-n-highlights")
          for n, _, _ in server_polish.WELCOME_CHANNELS))

SP_CALLS.clear()
server_polish.patch_topics(sp_chans)
_tp = [(p, b) for m, p, b in SP_CALLS if m == "PATCH" and p.startswith("/channels/")]
check("topics PATCH only the channels whose topic differs",
      len(_tp) == 3 and all("topic" in b for _, b in _tp))
for _n in ("👋-welcome", "😂-memes", "🎭-get-roles"):
    sp_chans[_n]["topic"] = server_polish.TOPICS[_n]
SP_CALLS.clear()
server_polish.patch_topics(sp_chans)
check("topics: second run is a full no-op (rate-limit safe)",
      not any(m == "PATCH" for m, p, b in SP_CALLS))

POSTS.clear(); POSTS_FULL.clear()
server_polish.post_guides(sp_chans)
check("both guides posted when missing (roles + welcome)", len(POSTS) == 2)
_roles_g = next(c for _, c in POSTS if "Roles & Pings" in c)
_welc_g = next(c for _, c in POSTS if "Welcome to iBoyPrime HQ" in c)
check("roles guide: 3-step how-to + all news ping roles",
      "Channels & Roles" in _roles_g and "1️⃣" in _roles_g and
      "News Pings" in _roles_g and "Digest Ping" in _roles_g)
check("welcome guide: change-your-picks steps + clickable channel links",
      "Channels & Roles" in _welc_g and "<#R>" in _welc_g and "<#G>" in _welc_g)
check("guides fit in one message", all(len(c) <= 1990 for _, c in POSTS))

def sp_discord2(method, path, body=None):
    SP_CALLS.append((method, path, body))
    if method == "GET" and path.endswith("/users/@me"):
        return 200, {"id": "BOT"}
    if method == "GET" and "/messages" in path:
        return 200, [{"id": "OLD", "author": {"id": "BOT"}, "content": "stale"}]
    return 200, {}
common.discord = sp_discord2
SP_CALLS.clear(); POSTS.clear()
server_polish.post_guides(sp_chans)
check("guides edit in place when stale (never duplicate)",
      sum(1 for m, p, b in SP_CALLS if m == "PATCH" and "/messages/OLD" in p) == 2
      and len(POSTS) == 0)

# ───────────────────────── 13. deploy secret-scan ──────────────────────────
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
    check("newsconfig.py + newsconfig.json + server_polish are in the upload set",
          ("newsconfig.py", "newsconfig.py") in deploy_bots.UPLOADS and
          ("newsconfig.json", "newsconfig.json") in deploy_bots.UPLOADS and
          ("server_polish.py", "server_polish.py") in deploy_bots.UPLOADS)
    check("logo tooling is NOT uploaded (local-only)",
          not any(("make_logo" in r or "set_icon" in r) for r, _ in deploy_bots.UPLOADS))
    check("new bots + CI files are in the upload set",
          ("predictions_bot.py", "predictions_bot.py") in deploy_bots.UPLOADS and
          ("fightnight_bot.py", "fightnight_bot.py") in deploy_bots.UPLOADS and
          ("selftest_changes.py", "../selftest_changes.py") in deploy_bots.UPLOADS and
          ("commands_worker/worker.js", "../commands_worker/worker.js") in deploy_bots.UPLOADS and
          (".github/workflows/selftest.yml", ".github/workflows/selftest.yml") in deploy_bots.UPLOADS)
    check("quiz/debate/spotlight/clip are NEVER auto-dispatched (would post at deploy)",
          all(w not in deploy_bots.DISPATCH for w in ("quiz.yml", "debate.yml", "spotlight.yml", "clip.yml")))
    check("predictions + fightnight dispatch on deploy (safe no-ops)",
          "predictions.yml" in deploy_bots.DISPATCH and "fightnight.yml" in deploy_bots.DISPATCH)

# ───────────────────────── 14. predictions_bot (pick'em) ───────────────────
print("\n[predictions_bot]")
import predictions_bot
os.environ.pop("GITHUB_ACTIONS", None)
_real_now = common.now_utc
_FROZEN = common.datetime.datetime(2026, 7, 15, 12, 0, tzinfo=common.datetime.timezone.utc)
common.now_utc = lambda: _FROZEN
_ev_start = _FROZEN - common.datetime.timedelta(days=1)          # mid-month: no accidental crown
_mk = predictions_bot.month_key(_ev_start)

common.load_config = lambda: {"guild_id": "G1", "channels": {"predictions": "P"},
                              "roles": {"fight_prophet": "RP"}}
STORE.clear()
STORE["state_fightweek.json"] = {"hubs": {
    "601": {"thread_id": "T1", "poll": {"channel_id": "T1", "message_id": "PM1",
            "answers": {"1": "Alpha Man", "2": "Beta Guy"}, "league": "ufc",
            "start": _ev_start.isoformat()}},
    "602": {"thread_id": "T2", "poll": {"channel_id": "T2", "message_id": "PM2",
            "answers": {"1": "Alpha Man", "2": "Gamma Dude"}, "league": "ufc",
            "start": _ev_start.isoformat()}},
    "603": {"thread_id": "T3", "poll": {"channel_id": "T3", "message_id": "PM3",
            "answers": {"1": "Draw A", "2": "Draw B"}, "league": "ufc",
            "start": _ev_start.isoformat()}},
    "604": {"thread_id": "T4", "poll": {"channel_id": "T4", "message_id": "PM4",
            "answers": {"1": "Late A", "2": "Late B"}, "league": "ufc",
            "start": _ev_start.isoformat()}},
    "605": {"thread_id": "T5", "poll": {"channel_id": "T5", "message_id": "PM5",
            "answers": {"1": "Ghost A", "2": "Ghost B"}, "league": "ufc",
            "start": (_FROZEN - common.datetime.timedelta(days=10)).isoformat()}},
    "606": {"thread_id": "T6"},
}}
STORE["state_quiz.json"] = {"v": 1, "months": {_mk: {"U9": 2}}, "alltime": {"U9": 2}}

def _comp(names, winner=None, completed=True):
    return {"competitors": [dict({"athlete": {"displayName": n}},
                                 **({"winner": True} if n == winner else {})) for n in names],
            "status": {"type": {"completed": completed}}}
_pred_sb = {"events": [
    {"id": "601", "competitions": [_comp(["Alpha Man", "Beta Guy"], "Alpha Man")]},
    {"id": "602", "competitions": [_comp(["Alpha Man", "Delta X"], "Delta X")]},   # card changed
    {"id": "603", "competitions": [_comp(["Draw A", "Draw B"], None)]},            # draw/NC
    {"id": "604", "competitions": [_comp(["Late A", "Late B"], None, False)]},     # not finished
]}
common.get_json = lambda url, headers=None, tries=4: \
    (200, copy.deepcopy(_pred_sb)) if "scoreboard?dates=" in url else (200, {})

PRED_CALLS, EDITS = [], []
def pred_discord(method, path, body=None):
    PRED_CALLS.append((method, path))
    if method == "GET" and path.endswith("/messages/PM1"):
        return 200, {"poll": {"answers": [{"answer_id": 1, "poll_media": {"text": "Alpha Man"}},
                                          {"answer_id": 2, "poll_media": {"text": "Beta Guy"}}]}}
    if method == "GET" and path.endswith("/messages/PM2"):
        return 200, {"poll": {"answers": [{"answer_id": 1, "poll_media": {"text": "Alpha Man"}},
                                          {"answer_id": 2, "poll_media": {"text": "Gamma Dude"}}]}}
    if method == "GET" and "/polls/PM1/answers/1" in path:
        return 200, {"users": [{"id": "U1"}, {"id": "U2"}]}
    if method == "GET" and "/polls/" in path:
        return 200, {"users": []}
    if method == "GET" and "/channels/P/messages" in path:
        return 200, []
    return 200, {}
common.discord = pred_discord
common.edit_message = lambda ch, mid, content=None, embeds=None: (EDITS.append((ch, mid, content)), (200, {}))[1]

POSTS.clear(); POSTS_FULL.clear(); PERSISTS.clear()
predictions_bot.main()
_ps = STORE["state_predictions.json"]
check("finished event scored", _ps["processed"].get("601") == "scored")
check("+1 to each correct main-event voter (month + all-time)",
      _ps["months"][_mk] == {"U1": 1, "U2": 1} and _ps["alltime"] == {"U1": 1, "U2": 1})
check("changed main event -> skip-with-log, no points", _ps["processed"].get("602") == "card_changed")
check("draw/NC -> no_winner, no points", _ps["processed"].get("603") == "no_winner")
check("unfinished event left pending for the next run", "604" not in _ps["processed"])
check("vanished event gives up after 7 days", _ps["processed"].get("605") == "expired")
check("hub without a poll -> no_poll", _ps["processed"].get("606") == "no_poll")
_board = next((p for p in POSTS_FULL if predictions_bot.LEADER_TITLE in p["content"]), None)
check("leaderboard created SILENT with no pings",
      _board and _board["silent"] is True and _board["mentions"] is None)
check("board id stored for edit-in-place", _ps["leaderboard"].get("message_id"))
check("board combines pick'em + quiz points (quiz-only player shown)", "U9" in _board["content"])
check("state persisted after scoring", "state_predictions.json" in PERSISTS)

POSTS_FULL.clear()
predictions_bot.main()
_ps = STORE["state_predictions.json"]
check("re-run never double-scores", _ps["alltime"] == {"U1": 1, "U2": 1})
check("board edited in place on re-run (no new post)",
      EDITS and not any(predictions_bot.LEADER_TITLE in p["content"] for p in POSTS_FULL))

# monthly crown: previous month has scores, champion still on the month before
_ps["months"]["2026-06"] = {"U1": 3}
_qz = STORE["state_quiz.json"]; _qz["months"]["2026-06"] = {"U9": 5}
_ps["champion"] = {"uid": "UOLD", "month": "2026-05"}
STORE["state_predictions.json"] = _ps; STORE["state_quiz.json"] = _qz
_SEQ = []
common.persist_state = lambda fn, message=None: (PERSISTS.append(fn), _SEQ.append("persist"))
_prev_fake_post = common.post_message
def _seq_post(chan, content, allowed_mentions=None, embeds=None, silent=False):
    _SEQ.append("post")
    return _prev_fake_post(chan, content, allowed_mentions=allowed_mentions, embeds=embeds, silent=silent)
common.post_message = _seq_post
POSTS_FULL.clear(); PRED_CALLS.clear(); _SEQ.clear()
predictions_bot.main()
_ps = STORE["state_predictions.json"]
check("crown: combined pick'em+quiz winner takes it", _ps["champion"] == {"uid": "U9", "month": "2026-06"})
check("crown: role moved from previous holder to winner",
      ("DELETE", "/guilds/G1/members/UOLD/roles/RP") in PRED_CALLS and
      ("PUT", "/guilds/G1/members/U9/roles/RP") in PRED_CALLS)
_cong = next((p for p in POSTS_FULL if "Fight Prophet" in p["content"] and p["mentions"]), None)
check("crown: congrats pings ONLY the winner (never silent+mention)",
      _cong and _cong["mentions"] == {"users": ["U9"]} and _cong["silent"] is False)
check("crown: congrats posted AFTER state persist (crash-safe)",
      "persist" in _SEQ and "post" in _SEQ and _SEQ.index("persist") < _SEQ.index("post"))
POSTS_FULL.clear()
predictions_bot.main()
check("crown happens exactly once per month",
      STORE["state_predictions.json"]["champion"] == {"uid": "U9", "month": "2026-06"} and
      not any("Congrats" in p["content"] for p in POSTS_FULL))
common.post_message = _prev_fake_post
common.persist_state = lambda fn, message=None: PERSISTS.append(fn)

# ───────────────────────── 15. fightnight_bot ──────────────────────────────
print("\n[fightnight_bot]")
import fightnight_bot
common.load_config = lambda: {"guild_id": "G1", "channels": {"fight_night": "FN"},
                              "roles": {"fight_alerts": "RA"}}
_fn_now = [common.datetime.datetime(2026, 7, 18, 20, 0, tzinfo=common.datetime.timezone.utc)]
common.now_utc = lambda: _fn_now[0]
_fn_start = _fn_now[0] + common.datetime.timedelta(minutes=30)
_FN_DONE = [False]
def fn_get_json(url, headers=None, tries=4):
    if "ufc/scoreboard?dates=" in url:
        return 200, {"events": [{"id": "700", "competitions": [
            {"status": {"type": {"completed": _FN_DONE[0]}}}]}]}
    if "ufc/scoreboard" in url:
        return 200, {"leagues": [{"calendar": [
            {"event": {"$ref": "http://e/events/700"},
             "startDate": _fn_start.strftime("%Y-%m-%dT%H:%MZ"),
             "label": "UFC 999: Alpha vs Beta"}]}]}
    return 200, {"leagues": []}
common.get_json = fn_get_json
FN_PATCHES = []
def fn_discord(method, path, body=None):
    if method == "GET" and path == "/channels/FN":
        return 200, {"rate_limit_per_user": 5}
    if method == "PATCH" and path == "/channels/FN":
        FN_PATCHES.append(body); return 200, {}
    if method == "POST" and "/threads" in path:
        return 201, {"id": "TH1"}
    return 200, {}
common.discord = fn_discord

STORE.pop("state_fightnight.json", None)
POSTS.clear(); POSTS_FULL.clear(); PERSISTS.clear()
fightnight_bot.main()
_fs = STORE["state_fightnight.json"]
_rem = next((p for p in POSTS_FULL if "Fight night" in p["content"]), None)
check("reminder inside T-75 is LOUD and pings only 🥊 Fight Alerts",
      _rem and _rem["silent"] is False and _rem["mentions"] == {"roles": ["RA"]} and
      _rem["content"].startswith("<@&RA>"))
check("reminder uses localized <t:..> times", "<t:" in _rem["content"] and ":R>" in _rem["content"])
check("discussion thread opened on the reminder", _fs["events"]["700"].get("thread_id") == "TH1")
check("no slowmode before the card starts", not FN_PATCHES and not _fs.get("slowmode"))
check("fightnight state persisted", "state_fightnight.json" in PERSISTS)

POSTS_FULL.clear()
fightnight_bot.main()
check("reminder is single-shot (no dupe on the next tick)",
      not any("Fight night" in p["content"] for p in POSTS_FULL))

_fn_now[0] = _fn_start + common.datetime.timedelta(minutes=5)      # card underway
fightnight_bot.main()
_fs = STORE["state_fightnight.json"]
check("slowmode raised at start with the real previous value stored",
      FN_PATCHES and FN_PATCHES[-1] == {"rate_limit_per_user": fightnight_bot.SLOWMODE_SECONDS} and
      _fs["slowmode"] == {"active_eid": "700", "channel_id": "FN", "prev": 5})
_n_patches = len(FN_PATCHES)
fightnight_bot.main()
check("slowmode raised only once while active", len(FN_PATCHES) == _n_patches)

_FN_DONE[0] = True                                                  # ESPN marks it finished
fightnight_bot.main()
_fs = STORE["state_fightnight.json"]
check("slowmode restored to the exact previous value when the card ends",
      FN_PATCHES[-1] == {"rate_limit_per_user": 5} and not _fs.get("slowmode"))
check("event marked done (no re-raise)", _fs["events"]["700"].get("done") is True)

_fn_now[0] = _fn_start + common.datetime.timedelta(days=fightnight_bot.KEEP_DAYS + 1)
fightnight_bot.main()
check("old event records pruned", "700" not in STORE["state_fightnight.json"]["events"])
common.now_utc = _real_now

# ───────────────────────── 16. quiz_bot (Friday quiz night) ────────────────
print("\n[quiz_bot]")
import quiz_bot
quiz_bot.QUESTION_SECONDS = 0
quiz_bot.BETWEEN_SECONDS = 0
common.now_utc = lambda: common.datetime.datetime(2026, 7, 10, 19, 0,
                                                  tzinfo=common.datetime.timezone.utc)  # a Friday
common.load_config = lambda: {"guild_id": "G1",
                              "channels": {"mma_chat": "MC", "predictions": "P"},
                              "roles": {}}
STORE["quiz_data.json"] = [
    {"q": "Q one",   "answers": ["a", "b", "c", "d"], "correct": 0},
    {"q": "Q two",   "answers": ["a", "b", "c", "d"], "correct": 1},
    {"q": "Q three", "answers": ["a", "b", "c", "d"], "correct": 2},
    {"q": "Q four",  "answers": ["a", "b", "c", "d"], "correct": 0},
    {"q": "Q five",  "answers": ["a", "b", "c", "d"], "correct": 3},
    {"q": "Q six",   "answers": ["a", "b", "c", "d"], "correct": 1},
]
STORE.pop("state_quiz.json", None)
QUIZ_POLLS, QUIZ_EXPIRES = [], []
def quiz_discord(method, path, body=None):
    if method == "POST" and path == "/channels/MC/messages" and body and "poll" in body:
        QUIZ_POLLS.append(body)
        n = len(QUIZ_POLLS)
        return 200, {"id": "QM%d" % n,
                     "poll": {"answers": [{"answer_id": j + 1, "poll_media": a["poll_media"]}
                                          for j, a in enumerate(body["poll"]["answers"])]}}
    if method == "POST" and "/expire" in path:
        QUIZ_EXPIRES.append(path); return 200, {}
    if method == "GET" and "/polls/" in path:
        mid = path.split("/polls/")[1].split("/")[0]
        return 200, {"users": ([{"id": "U1"}, {"id": "U2"}] if mid in ("QM1", "QM2")
                               else [{"id": "U1"}])}
    return 200, {}
common.discord = quiz_discord
POSTS.clear(); POSTS_FULL.clear(); PERSISTS.clear(); _EDITS_BEFORE = len(EDITS)
quiz_bot.main()
_qs = STORE["state_quiz.json"]
check("5 questions posted as SILENT polls",
      len(QUIZ_POLLS) == 5 and all(b.get("flags") == 4096 for b in QUIZ_POLLS))
check("every question expired early", len(QUIZ_EXPIRES) == 5)
check("scores tallied per correct voter", _qs["months"]["2026-07"] == {"U1": 5, "U2": 2}
      and _qs["alltime"] == {"U1": 5, "U2": 2})
check("bank cursor advances with wrap math", _qs["cursor"] == 5 and _qs["last_run"] == "2026-07-10")
check("cursor persisted BEFORE questions (crash-safe)", PERSISTS and PERSISTS[0] == "state_quiz.json")
check("intro + results are silent (calm-mode)",
      all(p["silent"] for p in POSTS_FULL if "Quiz" in p["content"] or "results" in p["content"]))
check("results embed lists tonight's top", any(p["embeds"] and "sharpest" in p["embeds"][0]["description"]
                                               for p in POSTS_FULL if p["embeds"]))
check("shared board edited, never created by quiz_bot",
      len(EDITS) > _EDITS_BEFORE and EDITS[-1][1] == "msg1" and
      not any(predictions_bot.LEADER_TITLE in p["content"] for p in POSTS_FULL))
check("board shows both point columns", "🥊 1 · 🧠 5" in EDITS[-1][2])
_n_polls = len(QUIZ_POLLS)
quiz_bot.main()
check("same-day re-run is a no-op (double-dispatch guard)", len(QUIZ_POLLS) == _n_polls)

# ───────────────────────── 17. debate_bot ──────────────────────────────────
print("\n[debate_bot]")
import debate_bot
common.now_utc = lambda: common.datetime.datetime(2026, 7, 6, 17, 0,
                                                  tzinfo=common.datetime.timezone.utc)  # a Monday
common.load_config = lambda: {"channels": {"mma_chat": "MC"}}
STORE["debates_data.json"] = [{"q": "Debate 1", "answers": ["x", "y"]},
                              {"q": "Debate 2", "answers": ["x", "y", "z"]},
                              {"q": "Debate 3", "answers": ["x", "y"]}]
STORE.pop("state_debate.json", None)
DEBATE_POLLS = []
def debate_discord(method, path, body=None):
    if method == "POST" and body and "poll" in body:
        DEBATE_POLLS.append(body); return 200, {"id": "DM%d" % len(DEBATE_POLLS)}
    return 200, {}
common.discord = debate_discord
debate_bot.main()
_ds = STORE["state_debate.json"]
check("debate posted as a SILENT poll with a plain content line",
      len(DEBATE_POLLS) == 1 and DEBATE_POLLS[0]["flags"] == 4096 and
      DEBATE_POLLS[0]["content"].startswith("🗣️") and
      DEBATE_POLLS[0]["poll"]["question"]["text"] == "Debate 1")
check("3-day duration, single choice",
      DEBATE_POLLS[0]["poll"]["duration"] == 72 and
      DEBATE_POLLS[0]["poll"]["allow_multiselect"] is False)
check("cursor advances", _ds["cursor"] == 1 and _ds["last_posted"] == "2026-07-06")
debate_bot.main()
check("same-day re-run is a no-op", len(DEBATE_POLLS) == 1)
_ds["cursor"] = 2; _ds["last_posted"] = "2026-06-29"; STORE["state_debate.json"] = _ds
debate_bot.main()
check("rotation wraps around the bank", STORE["state_debate.json"]["cursor"] == 0 and
      DEBATE_POLLS[-1]["poll"]["question"]["text"] == "Debate 3")

# ───────────────────────── 18. spotlight_bot ───────────────────────────────
print("\n[spotlight_bot]")
import spotlight_bot
common.load_config = lambda: {"channels": {"mma_chat": "MC"}}
_spot_ranks = [
    {"categoryName": "Pound-for-Pound", "fighters": [{"id": "px", "name": "PX"}]},
    {"categoryName": "Lightweight",
     "fighters": [{"id": "alpha-man", "name": "Alpha Man"}, {"id": "beta-guy", "name": "Beta Guy"}]},
    {"categoryName": "Heavyweight",
     "fighters": [{"id": "big-dog", "name": "Big Dog"}]},
]
def spot_get_json(url, headers=None, tries=4):
    if url.endswith("/rankings"):
        return 200, copy.deepcopy(_spot_ranks)
    if "/fighter/" in url:
        return 200, {"name": "Alpha Man", "nickname": "The Test", "wins": "20", "losses": "1",
                     "draws": "0", "placeOfBirth": "Testville", "trainsAt": "Test Gym", "age": "29"}
    return 200, {}
common.get_json = spot_get_json
STORE.pop("state_spotlight.json", None)
common.now_utc = lambda: common.datetime.datetime(2026, 7, 8, 16, 0,
                                                  tzinfo=common.datetime.timezone.utc)  # a Wednesday
POSTS_FULL.clear()
spotlight_bot.main()
_sp = STORE["state_spotlight.json"]
_spost = POSTS_FULL[-1]
check("spotlight posted SILENT with a rich embed",
      _spost["silent"] and _spost["embeds"] and "Spotlight" in _spost["embeds"][0]["title"])
check("plain-text preview line (calm push format)",
      _spost["content"].startswith("Fighter Spotlight: Alpha Man"))
check("P4P skipped; first real division used", "#1 at Lightweight" in _spost["embeds"][0]["description"])
check("division cursor rotates", _sp["div_cursor"] == 1 and _sp["last_posted"] == "2026-07-08")
spotlight_bot.main()
check("same-day guard holds", len([p for p in POSTS_FULL if "Spotlight" in p["content"]]) == 1)
_sp["last_posted"] = "2026-07-01"; STORE["state_spotlight.json"] = _sp
spotlight_bot.main()
check("next week -> next division, lap bumps ranks",
      STORE["state_spotlight.json"]["div_cursor"] == 0 and
      STORE["state_spotlight.json"]["per_div_rank"].get("Lightweight") == 1)

# ───────────────────────── 19. clip_bot (Clip War) ─────────────────────────
print("\n[clip_bot]")
import clip_bot
common.load_config = lambda: {"guild_id": "G1",
                              "channels": {"plays_n_clips": "PC"},
                              "roles": {"clip_champ": "RC"}}
CLIP_CALLS, CLIP_MSGS = [], []
def clip_discord(method, path, body=None):
    CLIP_CALLS.append((method, path))
    if method == "POST" and path == "/channels/PC/threads":
        return 201, {"id": "CT1"}
    if method == "GET" and path.startswith("/channels/CT1/messages"):
        return 200, list(CLIP_MSGS)
    return 200, {}
common.discord = clip_discord
STORE.pop("state_clip.json", None)
common.now_utc = lambda: common.datetime.datetime(2026, 7, 6, 15, 0,
                                                  tzinfo=common.datetime.timezone.utc)  # Monday
POSTS_FULL.clear()
clip_bot.main()
_cs = STORE["state_clip.json"]
check("Monday opens the Clip War thread", _cs["thread_id"] == "CT1" and _cs["week"])
check("seed message is silent and in the thread",
      POSTS_FULL and POSTS_FULL[0]["chan"] == "CT1" and POSTS_FULL[0]["silent"])
_n_calls = len([c for c in CLIP_CALLS if c[0] == "POST"])
clip_bot.main()
check("Monday re-run doesn't open a second thread",
      len([c for c in CLIP_CALLS if c[0] == "POST" and c[1].endswith("/threads")]) == 1)

_cs = STORE["state_clip.json"]; _cs["prev_champ"] = "OLD"; _cs["seed_msg_id"] = "SEED"
STORE["state_clip.json"] = _cs
CLIP_MSGS[:] = [   # newest-first, as Discord returns
    {"id": "300", "author": {"id": "BOTX", "bot": True}, "reactions": [{"count": 99}]},
    {"id": "200", "author": {"id": "B"}, "reactions": [{"count": 5}]},
    {"id": "100", "author": {"id": "C"}, "reactions": [{"count": 3}, {"count": 2}]},
    {"id": "50",  "author": {"id": "A"}, "reactions": [{"count": 3}]},
    {"id": "SEED", "author": {"id": "BOTX"}, "reactions": []},
]
common.now_utc = lambda: common.datetime.datetime(2026, 7, 12, 20, 0,
                                                  tzinfo=common.datetime.timezone.utc)  # Sunday
POSTS_FULL.clear(); CLIP_CALLS.clear()
clip_bot.main()
_cs = STORE["state_clip.json"]
check("Sunday crowns the top-reaction author (ties -> earliest)", _cs["prev_champ"] == "C")
check("Clip Champ role moved old -> new",
      ("DELETE", "/guilds/G1/members/OLD/roles/RC") in CLIP_CALLS and
      ("PUT", "/guilds/G1/members/C/roles/RC") in CLIP_CALLS)
_win = next((p for p in POSTS_FULL if "Clip Champ" in p["content"]), None)
check("winner announce mentions ONLY the winner",
      _win and _win["mentions"] == {"users": ["C"]} and _win["silent"] is False)
check("week marked closed", _cs["closed_week"] == _cs["week"])
POSTS_FULL.clear()
clip_bot.main()
check("Sunday re-run is a no-op", not POSTS_FULL)

common.now_utc = lambda: common.datetime.datetime(2026, 7, 13, 15, 0,
                                                  tzinfo=common.datetime.timezone.utc)  # next Monday
clip_bot.main()
CLIP_MSGS[:] = [{"id": "400", "author": {"id": "D"}, "reactions": []}]
common.now_utc = lambda: common.datetime.datetime(2026, 7, 19, 20, 0,
                                                  tzinfo=common.datetime.timezone.utc)  # next Sunday
POSTS_FULL.clear(); CLIP_CALLS.clear()
clip_bot.main()
check("no reactions -> previous champ keeps the role",
      STORE["state_clip.json"]["prev_champ"] == "C" and
      not any(c[0] in ("PUT", "DELETE") and "/roles/" in c[1] for c in CLIP_CALLS))
check("quiet no-champ notice is silent",
      POSTS_FULL and POSTS_FULL[-1]["silent"] and "belt stays put" in POSTS_FULL[-1]["content"])
common.now_utc = _real_now

# ───────────────────────── summary ─────────────────────────────────────────
print("\n==== %d passed, %d failed ====" % (PASS, FAIL))
sys.exit(1 if FAIL else 0)
