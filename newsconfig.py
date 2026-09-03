#!/usr/bin/env python3
"""Prime Arena - news feed config (the single source of truth for #mma-news).

`newsconfig.json` decides HOW news is delivered (mode: realtime / hybrid /
digest), WHICH sources and categories are on, what counts as breaking, what is
excluded, and how duplicates/volume are handled. It holds ONLY words, numbers
and public URLs - never a secret - so it is safe in the public repo and passes
deploy_bots.scan_for_secrets().

Imported by news_bot.py (the poster), the local GUI (mod_panel.py "News" tab)
and mirrored by the Worker's /news commands. Std-lib only (+ common, modconfig).

Delivery modes:
  realtime - every kept article posts LOUD (no role ping). The old behaviour.
  hybrid   - every kept article posts SILENT (no push notification, unread badge
             only); BREAKING items post loud and ping the 📰 News Pings role;
             one daily digest posts loud and pings the 🗞️ Digest Ping role.
  digest   - routine articles are only queued; nothing posts except breaking
             items and the digest.
"""
import re
import common
import promofilter                 # the no-gambling rule, enforced in code
import topicgate                   # the positive "is this actually MMA" gate
from modconfig import deep_merge   # generic dict merge - reuse, don't duplicate

NEWSCONFIG_FILE = "newsconfig.json"
MODES = ["realtime", "hybrid", "digest"]

# The AI scoring providers the owner may name in scoring.provider. ONE source
# of truth: scorer.py owns the table (endpoint + default model + env var), and
# this module only validates against its names. Never re-type the list here -
# a second copy is how the social links drifted (see CLAUDE.md 0d). The import
# is guarded because newsconfig is also read in checkouts where scorer is not
# present; an empty tuple just means "skip the provider check", never a crash.
try:
    from scorer import PROVIDER_NAMES as SCORING_PROVIDERS
except Exception:                                  # pragma: no cover
    SCORING_PROVIDERS = ()

# How the staged poster emphasises its hot words (postcard.render_news):
#   color      the hot words are filled in the brand accent (the owner's
#              default - "I prefer text a different color because underline
#              doesn't really highlight")
#   underline  the hot words stay white over a purple bar
#   auto       postcard rotates the two deterministically per story, so the
#              feed alternates on its own. Two thirds color, one third
#              underline: variety, with color still the house look.
EMPHASIS_MODES = ["color", "underline", "auto"]

_DEFAULT_SOURCES = {
    "mma_fighting":  {"label": "MMA Fighting", "url": "https://www.mmafighting.com/rss/current.xml", "enabled": True,
                      "trusted": True},
    "bloody_elbow":  {"label": "Bloody Elbow", "url": "https://www.bloodyelbow.com/feed/",           "enabled": True,
                      "trusted": True},
    # MMA Mania (SBNation, same feed shape as MMA Fighting) replaced MMA Junkie in
    # July 2026 - the Junkie publication left Gannett and archived its site, so
    # mmajunkie.usatoday.com now 404s and mmajunkie.com 307-redirects everything
    # to archive.mmajunkie.com. Verified live: mmamania /rss/current.xml = 200.
    # Measured Aug 13 2026: this feed's CDN served a 5.9-HOUR-old snapshot (Age
    # header 21117s), so tight polling buys nothing - min_poll keeps it cheap and
    # Google News surfaces Mania stories hours before Mania's own feed does.
    "mma_mania":     {"label": "MMA Mania",    "url": "https://www.mmamania.com/rss/current.xml",    "enabled": True, "trusted": True,
                      "min_poll": 300},
    # THE SPEED LAYER (Aug 2026, all verified live with the bot's own client):
    # Google News indexes every MMA outlet at once and had a story 0.9 MINUTES
    # after publish; when:1h keeps the result set small and freshness-sorted.
    # Its <link> is a news.google.com redirect that only resolves in a browser -
    # embed it as-is, never try to resolve it server-side. The real outlet comes
    # from each item's <source> tag (news_bot strips the " - Publisher" title
    # suffix and credits that outlet). min_poll 60: it is a search endpoint, do
    # not hammer it at the 20s cycle cadence.
    "google_news_ufc": {"label": "Google News",
                        "url": "https://news.google.com/rss/search?q=UFC+when:1h&hl=en-US&gl=US&ceid=US:en",
                        "enabled": True, "flavor": "google_news", "min_poll": 60},
    # Yahoo aggregates Yahoo/Uncrowned plus syndicated outlets ~10 min after
    # publish with clean direct links. pubDate can be the syndication time, so
    # dedupe relies on GUID + the Jaccard collapse like everything else.
    "yahoo_mma":     {"label": "Yahoo Sports", "url": "https://sports.yahoo.com/mma/rss.xml",
                      "enabled": True, "min_poll": 60},
    # Sherdog's CDN 403-blocked bots July 2026-era; re-verified Aug 13 2026: 200
    # even with a plain urllib UA. Enabled tolerantly - if Actions IPs are still
    # blocked the fetch skips silently and the failure backoff keeps it cheap.
    "sherdog":       {"label": "Sherdog",      "url": "https://www.sherdog.com/rss/news.xml",
                      "enabled": True, "trusted": True, "min_poll": 300},
    # X insiders via nitter.net RSS - the ONLY tweet-time-speed path that exists
    # keyless in 2026, and the layer the big YouTube news channels actually read.
    # FRAGILE BY NATURE: public Nitter has died before and can again, so these
    # DISABLED Sept 2026: nitter.net still serves its home page (HTTP 200) but
    # every /<account>/rss endpoint now returns 410 Gone - a deliberate shutdown
    # of the RSS surface, not an outage. Verified on all four accounts. Leaving
    # them enabled costs a failed fetch plus a 300s backoff every cycle and makes
    # the health report look broken. There is no free replacement: the X API is
    # paid, and scraping with cookies violates the ToS with the channel as the
    # collateral. Re-enable only if the endpoints come back.
    # They ship with flavor "nitter" (1 try, short timeout, retweets dropped) and MUST
    # only ever fail silent - never alert, never email. Do not build anything
    # that depends on them.
    "x_helwani":     {"label": "Ariel Helwani", "url": "https://nitter.net/arielhelwani/rss",
                      "enabled": False, "flavor": "nitter", "trusted": True,
                      "min_poll": 90},
    "x_mmafighting": {"label": "MMA Fighting on X", "url": "https://nitter.net/MMAFighting/rss",
                      "enabled": False, "flavor": "nitter", "trusted": True,
                      "min_poll": 90},
    "x_mmajunkie":   {"label": "MMA Junkie on X", "url": "https://nitter.net/mmajunkie/rss",
                      "enabled": False, "flavor": "nitter", "trusted": True,
                      "min_poll": 90},
    "x_ufc":         {"label": "UFC on X",      "url": "https://nitter.net/ufc/rss",
                      "enabled": False, "flavor": "nitter", "trusted": True,
                      "min_poll": 90},
    # Boxing feeds ship DISABLED (owner is UFC-focused). Bad Left Hook is a Vox
    # feed (same shape as MMA Fighting). Verify boxingscene's feed shape before
    # ever enabling it.
    "bad_left_hook": {"label": "Bad Left Hook", "url": "https://www.badlefthook.com/rss/current.xml", "enabled": False},
    "boxing_scene":  {"label": "BoxingScene",   "url": "https://www.boxingscene.com/rss/news.xml",    "enabled": False},
}

# Source "flavor" values news_bot understands. Empty string = plain RSS/Atom.
SOURCE_FLAVORS = ("", "google_news", "nitter")

# Titles are classified by FIRST category whose keyword hits (check order below).
# Anything unmatched falls back to default_category.
#
# That fallback used to be the contamination hole: nothing checked a story was
# combat sports at all, so MLB, college football, soccer and adverts were all
# labelled "ufc" and passed the UFC-only filter (measured live, Sept 2026).
# It is safe again ONLY because topicgate.is_mma() now runs BEFORE classify() in
# news_bot.keep(). A story reaching the fallback has already proved it is MMA;
# the fallback only decides which colour and label it gets. Do not remove the
# topic gate and leave the fallback, and do not reorder them.
_DEFAULT_CATEGORIES = {
    "boxing":    {"label": "Boxing", "enabled": False, "color": 0xFFD700,
                  "keywords": ["boxing", "boxer", "wbc ", "wba ", " ibf", " wbo",
                               "canelo", "tyson fury", "usyk", "anthony joshua"]},
    "mma_other": {"label": "MMA", "enabled": True, "color": 0xE67E22,
                  "keywords": ["bellator", "pfl", "one championship", "one fc",
                               "bkfc", "rizin", "cage warriors", "invicta",
                               "karate combat", "glory kickboxing"]},
    "ufc":       {"label": "UFC", "enabled": True, "color": 0xD20A0A,
                  "keywords": ["ufc", "dana white", "contender series", "tuf ",
                               "octagon"]},
}
_CLASSIFY_ORDER = ["boxing", "mma_other", "ufc"]   # specific orgs first, UFC last

_DEFAULT_BREAKING = [
    "breaking", "dies", "dead at", "passes away", "retires", "retirement",
    "arrested", "stripped of", "pulls out", "withdraws", "out of ufc",
    "off the card", "officially announced", "signs with the ufc", "new champion",
]
# Hard server rule (no betting/gambling content) - these always ship on.
# The generic words are not enough: a live check on Aug 13 2026 caught
# "UFC 330 Picks: Top DraftKings DFS Fantasy MMA Targets" only because "dfs"
# happened to be in the title, while "FanDuel fantasy preview" and a
# "PrizePicks board" sailed through. Operator BRANDS are how this content is
# actually named, so they are listed explicitly.
# Deliberately NOT excluded: "picks" and "predictions" on their own - fight
# picks are analysis, not gambling, and the server's own prediction polls use
# that language.
_DEFAULT_EXCLUDE = ["betting", "odds", "parlay", "dfs", "sportsbook", "gambling",
                    "draftkings", "fanduel", "prizepicks", "betmgm", "bet365",
                    "bovada", "daily fantasy", "moneyline", "prop bet",
                    "point spread", "wager"]


def base_defaults():
    """A complete default newsconfig."""
    import copy
    return {
        "version": 1,
        "mode": "hybrid",
        "sources": copy.deepcopy(_DEFAULT_SOURCES),
        "categories": copy.deepcopy(_DEFAULT_CATEGORIES),
        "default_category": "ufc",
        "breaking_keywords": list(_DEFAULT_BREAKING),
        "breaking_ignores_filters": True,   # a major story alerts even if its category is off
        "exclude_keywords": list(_DEFAULT_EXCLUDE),
        # Who gets pinged for a story, and how often. See notify.py.
        # Turning `enabled` off returns the wire to silent-for-everything without
        # a redeploy - it is the rollback for the whole notification phase.
        "notify": {
            "enabled": True,
            "alert_threshold": 85,      # deterministic heuristic score, not the AI one
            "alert_on_breaking": True,  # the keyword net is an OR, not a bonus
            "max_alerts_per_day": 12,   # hard ceiling; overflow posts silently
            "dedupe_hours": 6,          # one buzz per story across news AND studio
        },
        # Extra full names the topic gate should always accept. mma_roster.json
        # is seeded from the rankings at deploy time and DECAYS between deploys,
        # so a fighter who debuts afterwards is unknown to it. Add them here.
        "always_allow": [],
        # OFF since Sept 2026. The digest existed to surface stories the
        # hourly cap had diverted away from the channel; that cap is gone, so
        # every story posts live and a nightly recap would just repeat the day.
        # Put a time back to re-enable - nothing else has to change.
        "digest": {"times_utc": [], "min_items": 3, "ping": True},
        # Hot-word emphasis on the staged poster (see EMPHASIS_MODES).
        "emphasis": "color",
        # AI story scoring for the YouTube staging pipeline (scorer.py). Works
        # without any key (deterministic heuristic); any provider key in the
        # environment upgrades it - DeepSeek, OpenRouter, Z.ai (GLM), Groq,
        # Together, Mistral or OpenAI. "provider" picks one by name; empty
        # means auto, which takes the first of those with a key set (DeepSeek
        # first). "model" overrides that provider's default model.
        # Thresholds are 0-100: at
        # stage_threshold the story is rendered + staged in the studio channel,
        # at ping_threshold the staged message also pings the owner.
        #
        # The two per-day caps are the cost and volume control (owner, Aug
        # 2026: seven staged posts in one evening was a lot, and the AI bill
        # should sit nearer 2 pounds than 20 a month). Both are counted per
        # UTC date in state_news.json:
        #   max_ai_calls_per_day  paid scoring calls. Over the cap the scorer
        #                         falls back to the free heuristic, so nothing
        #                         stops, it just stops costing.
        #   max_staged_per_day    studio posts. Over the cap the story is
        #                         skipped with a printed note.
        #
        # The staging-memory gates (ytposts.stage_gate / GATE_DEFAULTS - the
        # Aug 19 2026 "same old news over and over" fix):
        #   stage_max_age_hours     a story older than this never stages
        #   subject_cooldown_hours  a story sharing 1+ name with a recent
        #                           staged post waits (breaking/ping-tier
        #                           stories break through)
        #   story_cooldown_hours    2+ shared names or a similar title = the
        #                           same story; never re-staged inside this
        #   staged_similar          token-Jaccard vs recently staged titles
        #   cutout_cooldown_days    one fighter's promo mugshot rests this long
        #   quiet_hours_utc         [start, end) UTC hours with NO owner ping
        #                           (the post still stages, silently)
        "scoring": {"enabled": True, "stage_threshold": 70, "ping_threshold": 85,
                    "provider": "", "model": "", "max_tokens": 220, "timeout": 20,
                    "max_ai_calls_per_day": 120, "max_staged_per_day": 6,
                    "stage_max_age_hours": 36, "subject_cooldown_hours": 12,
                    "story_cooldown_hours": 72, "staged_similar": 0.5,
                    "cutout_cooldown_days": 7, "quiet_hours_utc": [21, 8]},
        # Where the composer app lives - each staged Discord message links
        # straight to itself in the app (#s=<message id>). Public by nature
        # (the app is password-gated); empty disables the link line.
        "studio_url": "https://iboyprime-commands.root90014.workers.dev/studio",
        # How long a staged post lives in the hidden studio channel before
        # studio_clean.py deletes it (owner: keep that channel tidy). Counted
        # from the message timestamp, so no state file is needed, and only the
        # bot's OWN messages are ever removed.
        "studio_retention_days": 2,
        "max_per_hour": 6,
        "dedupe_similar": True,
        "similar_threshold": 0.6,
        "recent_hours": 48,
        "_note": ("Words, numbers and public URLs only. NEVER paste a bot token, "
                  "GitHub token, or any config.txt value here - it's uploaded to "
                  "the public repo."),
    }


def load(path=None):
    """newsconfig.json merged OVER defaults (existing values win, new default keys
    are added). Pure defaults if the file is absent."""
    p = path or common.state_path(NEWSCONFIG_FILE)
    existing = common.load_json(p, None)
    base = base_defaults()
    return deep_merge(base, existing) if isinstance(existing, dict) else base


def save(cfg, path=None):
    common.save_json(path or common.state_path(NEWSCONFIG_FILE), cfg)


# ---- classification helpers (pure, tested) ---------------------------------
_STOPWORDS = {"the", "a", "an", "to", "of", "in", "on", "for", "vs", "and",
              "at", "is", "with", "after", "his", "her", "as", "by", "over"}


def tokens(title):
    """Lowercased, punctuation-free, stopword-free token set of a headline."""
    words = re.sub(r"[^a-z0-9 ]+", " ", (title or "").lower()).split()
    return {w for w in words if w not in _STOPWORDS and len(w) > 1}


def similar(a, b):
    """Jaccard similarity of two headlines' token sets (0..1). Used to collapse
    the same story arriving from multiple outlets."""
    ta, tb = tokens(a), tokens(b)
    if not ta or not tb:
        return 0.0
    return len(ta & tb) / float(len(ta | tb))


def _hit(title, keywords):
    t = " %s " % (title or "").lower()
    return any(k and k.lower() in t for k in (keywords or []))


def classify(title, cfg):
    """First category (specific orgs first) whose keywords hit, else the default."""
    cats = cfg.get("categories", {}) or {}
    for key in _CLASSIFY_ORDER:
        if key in cats and _hit(title, cats[key].get("keywords")):
            return key
    for key in cats:                       # owner-added categories (any order)
        if key not in _CLASSIFY_ORDER and _hit(title, cats[key].get("keywords")):
            return key
    return cfg.get("default_category", "ufc")


def is_breaking(title, cfg):
    return _hit(title, cfg.get("breaking_keywords"))


def is_excluded(title, cfg, desc=""):
    """Owner keyword list OR the hard no-gambling/no-advertising floor.

    promofilter runs UNCONDITIONALLY and is not read from config. exclude_keywords
    is therefore purely ADDITIVE: the owner can add terms from the panel or
    /news, but "no betting/gambling anywhere" cannot be edited away. That matters
    because `/news keyword remove betting` deletes a term and deep_merge replaces
    a list wholesale, so nothing ever put it back - and because the seventeen
    words in that list matched neither of the two gambling promos that reached
    the channel in Sept 2026."""
    blocked, why = promofilter.is_promo(title, desc)
    if blocked:
        return True
    return _hit(title, cfg.get("exclude_keywords"))


def exclude_reason(title, cfg, desc=""):
    """Same decision as is_excluded, but says which rule fired. Used for the job
    log so a wrong drop can be diagnosed without re-running the filter by hand."""
    blocked, why = promofilter.is_promo(title, desc)
    if blocked:
        return "promo/gambling:" + why
    return "keyword" if _hit(title, cfg.get("exclude_keywords")) else ""


def source_trusted(key, cfg):
    """True for MMA-only publications. Untrusted sources (search feeds and
    aggregators) must earn each story through topicgate. Absent flag = untrusted:
    guessing wrong that way puts one extra MMA word in the way of a real story,
    while the other way puts a baseball score in the channel."""
    return bool(((cfg.get("sources", {}) or {}).get(key) or {}).get("trusted"))


def is_on_topic(title, desc, cfg, source_key):
    """(keep, reason) - the positive MMA gate. Single entry point so news_bot and
    any future transport ask the same question the same way."""
    return topicgate.is_mma(title, desc,
                            trusted=source_trusted(source_key, cfg),
                            extra=cfg.get("always_allow") or ())


def category_enabled(cat_key, cfg):
    cat = (cfg.get("categories", {}) or {}).get(cat_key) or {}
    return bool(cat.get("enabled", False))


def enabled_sources(cfg):
    """[(key, label, url)] for every enabled source."""
    out = []
    for key, src in (cfg.get("sources", {}) or {}).items():
        if src.get("enabled") and src.get("url"):
            out.append((key, src.get("label", key), src["url"]))
    return sorted(out)


# ---- validation (GUI + deploy safety) ---------------------------------------
_TIME_RE = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")


def validate_newsconfig(cfg, secret_values=()):
    """Return a list of problems (empty = safe to save). Mirrors validate_modconfig:
    shape checks + refuses to save if any config.txt secret value appears anywhere."""
    problems = []
    if cfg.get("mode") not in MODES:
        problems.append("mode must be one of %s" % "/".join(MODES))
    if cfg.get("emphasis", "auto") not in EMPHASIS_MODES:
        problems.append("emphasis must be one of %s" % "/".join(EMPHASIS_MODES))
    sc = cfg.get("scoring", {}) or {}
    prov = str(sc.get("provider", "") or "").strip()
    if prov and SCORING_PROVIDERS and prov not in SCORING_PROVIDERS:
        problems.append("scoring provider %r must be empty (auto) or one of %s"
                        % (prov, "/".join(SCORING_PROVIDERS)))
    try:
        if int(cfg.get("studio_retention_days", 2)) < 1:
            problems.append("studio_retention_days must be >= 1")
    except (TypeError, ValueError):
        problems.append("studio_retention_days must be a whole number")
    for key in ("max_ai_calls_per_day", "max_staged_per_day",
                "stage_max_age_hours", "subject_cooldown_hours",
                "story_cooldown_hours", "cutout_cooldown_days"):
        if key not in sc:
            continue
        try:
            if int(sc[key]) < 0:
                problems.append("scoring %s must be >= 0" % key)
        except (TypeError, ValueError):
            problems.append("scoring %s must be a whole number" % key)
    if "staged_similar" in sc:
        try:
            if not (0.0 < float(sc["staged_similar"]) <= 1.0):
                problems.append("scoring staged_similar must be between 0 and 1")
        except (TypeError, ValueError):
            problems.append("scoring staged_similar must be a number")
    qh = sc.get("quiet_hours_utc")
    if qh is not None:
        # bool is an int subclass, so [true, false] would pass a plain
        # isinstance(int) check and then read as [1, 0] downstream
        ok_qh = (isinstance(qh, list) and len(qh) == 2
                 and all(isinstance(h, int) and not isinstance(h, bool)
                         and 0 <= h <= 23 for h in qh))
        if not ok_qh:
            problems.append("scoring quiet_hours_utc must be [start, end] with "
                            "UTC hours 0-23 (equal hours = never quiet)")
    surl = str(cfg.get("studio_url", "") or "")
    # no whitespace of any kind, no <>#: the url is wrapped in <...> in the
    # staged message and gains its own #s=<id> fragment, so any of those
    # characters corrupts the deep link
    if surl and (not surl.startswith("https://")
                 or re.search(r"[\s<>#]", surl)):
        problems.append("studio_url must be an https:// URL with no spaces, "
                        "angle brackets or #fragment (or empty to drop the "
                        "link line)")
    cats = cfg.get("categories", {}) or {}
    if not isinstance(cats, dict) or not cats:
        problems.append("categories must be a non-empty object")
    if cfg.get("default_category") not in cats:
        problems.append("default_category %r is not a defined category" % cfg.get("default_category"))
    for key, src in (cfg.get("sources", {}) or {}).items():
        url = src.get("url", "")
        if not url.startswith("https://"):
            problems.append("source %s: url must start with https://" % key)
        if src.get("flavor", "") not in SOURCE_FLAVORS:
            problems.append("source %s: unknown flavor %r" % (key, src.get("flavor")))
        try:
            if float(src.get("min_poll", 0) or 0) < 0:
                problems.append("source %s: min_poll must be >= 0" % key)
        except (TypeError, ValueError):
            problems.append("source %s: min_poll must be a number" % key)
    dg = cfg.get("digest", {}) or {}
    for t in (dg.get("times_utc") or []):
        if not _TIME_RE.match(str(t)):
            problems.append("digest time %r is not HH:MM (24h UTC)" % t)
    if not (1 <= int(cfg.get("max_per_hour", 6)) <= 30):
        problems.append("max_per_hour must be 1-30")
    thr = float(cfg.get("similar_threshold", 0.6))
    if not (0.0 < thr <= 1.0):
        problems.append("similar_threshold must be between 0 and 1")
    if int(cfg.get("recent_hours", 48)) < 1:
        problems.append("recent_hours must be >= 1")

    import json as _json
    blob = _json.dumps(cfg)
    for v in secret_values:
        if v and len(v) >= 12 and v in blob:
            problems.append("A SECRET from config.txt appears in the news config - remove it. "
                            "This file is uploaded to the PUBLIC repo.")
            break
    return problems
