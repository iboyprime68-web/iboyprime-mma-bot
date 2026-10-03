#!/usr/bin/env python3
"""Prime Arena - Meme bot: MMA memes in 😂┊memes, at most two a day.

THE OWNER'S RULES (Oct 3 2026, after the first two memes it ever posted)
----------------------------------------------------------------------
  * MMA memes ONLY. The r/MMAmemes post was "really funny"; the general meme
    beside it (r/memes' top post, a JK Rowling / Malfoy in-joke with 27,808
    upvotes) "didn't make any sense". Popularity on a general subreddit is not
    a reason to post here, so no general source is read at all.
  * The bot says nothing. A post used to read "😂 <the Reddit title>", which
    sounds like the bot itself talking ("I don't like that at all"). A post is
    now the meme alone, with its source credit in small print under it.

WHY IT WAS REWRITTEN (Oct 3 2026)
---------------------------------
It had never posted a meme. It read Reddit's unauthenticated JSON
(r/<sub>/top.json), which Reddit has answered with 403 since late May 2026.
Every run logged "r/<sub>: HTTP 403" and exited 0, so the workflow stayed green
and state_memes.json was never even created. Measured from a GitHub runner:

  reddit.com .../top.json            403
  reddit.com .../top/.rss            200 once, then 429 thirty seconds later.
                                     No NSFW flag in the feed, and Reddit
                                     switches RSS off on Nov 13 2026.
  Reddit OAuth (an app of our own)   closed: new apps need Reddit's approval
                                     since Nov 2025, requests close Oct 31 2026
                                     and the public Data API ends March 2027.
  meme-api.com (a Reddit relay)      200, with Reddit's nsfw + spoiler flags

So it reads r/MMAmemes through meme-api.com, a public relay of a subreddit's
hot image posts. No key, no account. The relay lives on its owner's Reddit
access, which Reddit's own timeline ends by March 2027 at the latest; when it
goes, the run warns (below) and the channel goes quiet rather than off-topic.
Other MMA sources were measured the same day and left out: r/MMA's images are
fight clips and news screenshots, r/ufc's top images were a podcast thumbnail
and a news graphic, r/BJJmemes is gym humour, r/MMAcirclejerk is tiny, and no
Lemmy MMA community has posts.

WHAT IT POSTS
-------------
The best fresh r/MMAmemes posts by upvotes, at most MEMES_PER_DAY per UTC day
however many runs there are (the daily cron, a manual dispatch, a re-run). The
image is downloaded and UPLOADED: a meme never depends on its host staying up
or on Discord's proxy reaching it, and the bytes are checked to be a real image
under the upload limit. Silent, and it can ping nobody.

Content guardrails (the server rules), checked on the post's title:
  * posts Reddit flags NSFW or spoiler are skipped,
  * BLOCK_TERMS: religion-bashing, slurs and other off-limits topics,
  * SEXUAL_WORDS: the modesty rule,
  * promofilter: the same no-gambling floor every news story passes.
Memory is keyed by post, image url and image bytes and pruned newest-first, so
the same meme never repeats, crossposted or not. If the source fails, or
nothing posts for QUIET_DAYS, the run prints a ::warning:: annotation (shown in
the Actions UI) and still exits 0: a red run every day would email the owner.
Standard library only.
"""
import hashlib, os, re, tempfile, urllib.error, urllib.request

import common
import promofilter

STATE_FILE    = "state_memes.json"
STATE_V       = 2
MEMES_PER_DAY = 2
MAX_SEEN      = 3000              # keys, three per posted meme: ~16 months at 2 a day
MAX_BYTES     = 8 * 1024 * 1024   # an unboosted server takes 10 MB uploads
MAX_TRIES     = 8                 # image downloads per run, so a bad day cannot drag on
QUIET_DAYS    = 3                 # the source answers but nothing posts for this long: warn
UA = "iboyprime-memes/2.0 (+https://github.com/iboyprime68-web/iboyprime-mma-bot)"
HEADERS = {"User-Agent": UA, "Accept": "application/json"}
IMG_EXT = (".jpg", ".jpeg", ".png", ".gif", ".webp")

MEME_API = "https://meme-api.com/gimme/%s/50"

# (subreddit, minimum upvotes). MMA meme sources ONLY - the owner's rule above.
# The floor keeps a weak day quiet instead of filling it with a meme nobody voted for.
SOURCES = [
    ("MMAmemes", 150),
]

# keep it within the server's rules - no religion-bashing, no slurs, no vile stuff
BLOCK_TERMS = [
    "islam", "muslim", "allah", "quran", "koran", "prophet", "mosque", "jihad",
    "jesus", "christ", "christian", "bible", "church", "hindu", "buddh", "rabbi",
    "jew", "jewish", "judaism", "religion", "religious", "atheist",
    "9/11", "holocaust", "hitler", "nazi", "rape", "pedo", "slur", "retard",
    "suicide", "kys",
]
# The modesty rule. Whole words only, so "Essex", "cocky" and "document" stay postable.
SEXUAL_WORDS = (
    "sex", "sexy", "sexual", "sexually", "porn", "porno", "pornhub", "nude", "nudes",
    "naked", "nsfw", "horny", "onlyfans", "boob", "boobs", "tits", "titty", "titties",
    "dick", "dicks", "penis", "vagina", "pussy", "cock", "cocks", "cum", "orgasm",
    "fetish", "kinky", "milf", "rule 34", "thirst trap", "stripper", "strippers",
    "hooker", "hookers", "erection", "boner", "condom", "condoms", "viagra",
)
_SEXUAL_RE = re.compile(r"(?<![a-z0-9])(?:%s)(?![a-z0-9])"
                        % "|".join(re.escape(w) for w in SEXUAL_WORDS))


def looks_blocked(title):
    t = " " + title.lower() + " "
    return any(term in t for term in BLOCK_TERMS)


def blocked_reason(title):
    """Why a meme's title keeps it out, or "" when it does not. Pure."""
    title = title or ""
    if looks_blocked(title):
        return "blocklist"
    if _SEXUAL_RE.search(title.lower()):
        return "modesty"
    if promofilter.is_promo(title)[0]:
        return "gambling"
    return ""


def _int(v):
    try:
        return int(v)
    except (TypeError, ValueError):
        return 0


def _k(s):
    """A short stable key. The state file is public, and short keys keep it small."""
    return hashlib.sha1(s.encode("utf-8")).hexdigest()[:16]


def is_image_url(url):
    u = (url or "").strip().lower()
    if not u.startswith(("https://", "http://")):
        return False
    return u.split("#", 1)[0].split("?", 1)[0].endswith(IMG_EXT)


# ---- the source: (candidates, "ok") or (None, why it failed) ------------------
def from_meme_api(sub, floor):
    code, data = common.get_json(MEME_API % sub, headers=HEADERS, tries=2, timeout=20)
    if code != 200 or not isinstance(data, dict) or not isinstance(data.get("memes"), list):
        return None, "HTTP %s" % code
    out = []
    for m in data["memes"]:
        if not isinstance(m, dict):
            continue
        link = str(m.get("postLink") or "").rstrip("/")
        pid = link.rsplit("/", 1)[-1] or str(m.get("url") or "")
        out.append({"key": "reddit:" + pid, "floor": floor,
                    "title": common.clean(str(m.get("title") or "")),
                    "url": str(m.get("url") or "").strip(), "score": _int(m.get("ups")),
                    "nsfw": bool(m.get("nsfw")), "spoiler": bool(m.get("spoiler")),
                    "credit": "r/" + sub})
    return out, "ok"


def gather():
    """Every candidate from every source, plus one status line per source."""
    pool, status = [], {}
    for sub, floor in SOURCES:
        label = "r/" + sub
        try:
            got, why = from_meme_api(sub, floor)
        except Exception as e:            # a malformed reply must never end the run
            got, why = None, "error %s" % type(e).__name__
        status[label] = ("%d candidates" % len(got)) if got is not None else why
        print("  %s: %s" % (label, status[label]))
        pool.extend(got or [])
    return pool, status


# ---- choosing ------------------------------------------------------------------
def posted_before(c, seen):
    return _k(c["key"]) in seen or _k("url:" + c["url"]) in seen


def skip_reason(c, seen):
    """Why candidate c may not post, or "" when it may. Pure."""
    if c["nsfw"] or c["spoiler"]:
        return "nsfw/spoiler"
    if not c["title"]:
        return "no title"
    if not is_image_url(c["url"]):
        return "not an image"
    if c["score"] < c["floor"]:
        return "below the bar"
    if posted_before(c, seen):
        return "already posted"
    return blocked_reason(c["title"])


def rank(pool, seen):
    """(postable candidates best first, {skip reason: count}). Pure."""
    keep, skipped = [], {}
    for c in pool:
        why = skip_reason(c, seen)
        if why:
            skipped[why] = skipped.get(why, 0) + 1
        else:
            keep.append(c)
    keep.sort(key=lambda c: -c["score"])
    return keep, skipped


# ---- posting ---------------------------------------------------------------------
def fetch_image(url, cap=MAX_BYTES, timeout=20):
    """(bytes, "") or (None, why). Reads at most cap+1 bytes, so an oversized GIF
    costs one bounded read, and the bytes must really be a raster image."""
    try:
        req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "image/*"})
        with urllib.request.urlopen(req, timeout=timeout) as r:
            data = r.read(cap + 1)
    except urllib.error.HTTPError as e:
        return None, "HTTP %s" % e.code
    except Exception as e:
        return None, type(e).__name__
    if len(data) > cap:
        return None, "over %d MB" % (cap // (1024 * 1024))
    if not common.sniff_image(data)[0]:
        return None, "not an image"
    return data, ""


def remember(state, keys, epoch):
    for key in keys:
        state["seen"][_k(key)] = epoch


def post_meme(chan, c, state, epoch):
    """Download, upload, remember. True only when Discord took the post."""
    data, why = fetch_image(c["url"])
    if data is None:
        print("  skip (%s): %s" % (why, c["url"][:90]))
        return False
    img_key = "img:" + hashlib.sha1(data).hexdigest()
    if _k(img_key) in state["seen"]:
        print("  skip (the same image already posted): %s" % c["url"][:90])
        remember(state, (c["key"], "url:" + c["url"]), epoch)
        return False
    ext = common.sniff_image(data)[0]
    fname = "meme." + ext
    fd, tmp = tempfile.mkstemp(suffix="." + ext)
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(data)
        # The meme alone: no text, so the bot never sounds like it is talking
        # (the owner's rule). SILENT, and post_file's NO_PINGS default holds.
        embed = {"image": {"url": "attachment://" + fname}, "color": 0xF1C40F,
                 "footer": {"text": "via " + c["credit"]}}
        code, _ = common.post_file(chan, "", tmp, filename=fname,
                                   embeds=[embed], silent=True)
    finally:
        try:
            os.remove(tmp)
        except OSError:
            pass
    if code not in (200, 201):
        print("  Discord refused the post (HTTP %s); it stays eligible." % code)
        return False
    remember(state, (c["key"], "url:" + c["url"], img_key), epoch)
    print("posted meme:", c["credit"], "-", c["title"][:60])
    return True


# ---- state -----------------------------------------------------------------------
def load_state(raw):
    """The v2 state from whatever is on disk. A missing or corrupt file starts
    fresh and never crashes the run; a v1 list of Reddit ids is carried over."""
    st = raw if isinstance(raw, dict) else {}
    seen = st.get("seen")
    if isinstance(seen, list):
        seen = {_k("reddit:" + str(i)): 0 for i in seen if i}
    elif isinstance(seen, dict):
        seen = {str(k): _int(v) for k, v in seen.items()}
    else:
        seen = {}
    day = st.get("day") if isinstance(st.get("day"), dict) else {}
    return {"v": STATE_V, "seen": seen,
            "day": {"d": str(day.get("d") or ""), "n": max(0, _int(day.get("n")))},
            "last_post": _int(st.get("last_post")),
            # the first run this state saw: "nothing posted for days" must also
            # cover a bot that has never posted, which is how the old one failed
            "since": _int(st.get("since")),
            "sources": st.get("sources") if isinstance(st.get("sources"), dict) else {}}


def save_state(path, state):
    """Prune NEWEST-FIRST, never alphabetically: the news wire's sorted() prune
    once kept the memory of only 2 of its 10 sources (CLAUDE.md 0k)."""
    if len(state["seen"]) > MAX_SEEN:
        newest = sorted(state["seen"].items(), key=lambda kv: kv[1], reverse=True)
        state["seen"] = dict(newest[:MAX_SEEN])
    common.save_json(path, state)


def main():
    cfg = common.load_config()
    chan = (cfg.get("channels") or {}).get("memes")
    if not chan:
        print("No memes channel in config."); return
    path = common.state_path(STATE_FILE)
    state = load_state(common.load_json(path, {}))
    now = common.now_utc()
    today, epoch = now.strftime("%Y-%m-%d"), int(now.timestamp())
    state["since"] = state["since"] or epoch
    if state["day"]["d"] != today:
        state["day"] = {"d": today, "n": 0}
    room = MEMES_PER_DAY - state["day"]["n"]
    if room <= 0:
        print("Already posted %d memes today (%s UTC); the next ones go out tomorrow."
              % (state["day"]["n"], today))
        return

    pool, status = gather()
    state["sources"] = status
    if not any(v.endswith(" candidates") for v in status.values()):
        print("::warning::memes: every source failed this run (%s)"
              % "; ".join("%s %s" % kv for kv in sorted(status.items())))
        save_state(path, state)
        return
    ranked, skipped = rank(pool, state["seen"])
    print("  eligible: %d | skipped: %s" % (
        len(ranked), ", ".join("%s %d" % kv for kv in sorted(skipped.items())) or "none"))

    posted = tries = 0
    for c in ranked:
        if posted >= room or tries >= MAX_TRIES:
            break
        if posted_before(c, state["seen"]):
            continue                      # a crosspost of something posted this run
        tries += 1
        if post_meme(chan, c, state, epoch):
            posted += 1
            state["day"]["n"] += 1
            state["last_post"] = epoch
            save_state(path, state)

    if not posted:
        print("No meme posted this run.")
        quiet = epoch - max(state["last_post"], state["since"])
        if quiet > QUIET_DAYS * 86400:
            print("::warning::memes: the source answers but nothing has posted for %d days "
                  "(filters or the upvote floor too strict?)" % (quiet // 86400))
    save_state(path, state)
    print("Done. memes posted=%d (today %d/%d)" % (posted, state["day"]["n"], MEMES_PER_DAY))


if __name__ == "__main__":
    main()
