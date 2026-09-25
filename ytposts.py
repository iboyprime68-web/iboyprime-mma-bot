#!/usr/bin/env python3
"""My Cool Server - YouTube Community post staging (the posts machine).

Called by news_bot for every genuinely new kept story. scorer.py rates the
story 0-100; at scoring.stage_threshold the story is rendered into a branded
graphic (postcard.py, imported lazily because Pillow is not stdlib) and posted
to the hidden staff studio channel with a copy-ready caption. At
scoring.ping_threshold the staged message also mentions the owner - the one
loud ping this pipeline makes; every other staged post is silent.

YouTube has no API for Community posts (verified Aug 2026: no official
endpoint, no third-party scheduler, no share intent reaches the composer), so
the handoff is deliberately manual-but-instant: open the staged message, save
the image, copy the caption, paste into the YouTube app and use its native
Schedule Post. This module must NEVER break news delivery - stage_story
catches everything and returns a status string instead of raising.

Aug 19 2026 rework (the owner: "the studio keeps giving me the same old news
over and over", five Makhachev posts with the same promo cutout in 26 hours,
pings at 4:21am): staging now has a MEMORY. state_news.json carries a
staged_hist window and stage_gate() refuses rehash junk, stale stories, and
anything that shares a subject or story with a recent staged post; the promo
cutout for a given fighter rests for days between uses (cutout_blocked);
photoless posters rotate their texture plate per story (pick_plate); Google
News links resolve to the REAL article first (gnews.decode) so the story's
own photo wins over the eternal mugshot; and the owner ping respects quiet
hours (quiet_now).

Std-lib only at import time. Pillow is required only at render time; when it
is missing the story stages as text-only (caption, no graphic).
"""
import hashlib, json, os, re, tempfile, time, urllib.request

import common, gnews, newsconfig, notify, scorer

# Hosts whose article links cannot be resolved server-side (Google News links
# only resolve in a real browser; nitter pages are not the story itself).
NO_FETCH_HOSTS = ("news.google.com", "nitter.net")

OG_RE = re.compile(
    r'<meta[^>]+(?:property|name)=["\'](?:og:image|twitter:image)(?::src)?["\']'
    r'[^>]+content=["\']([^"\'>]+)["\']', re.I)
OG_RE_FLIP = re.compile(
    r'<meta[^>]+content=["\']([^"\'>]+)["\'][^>]+'
    r'(?:property|name)=["\'](?:og:image|twitter:image)(?::src)?["\']', re.I)

CAPTION_MAX_DESC = 300

# Photoless fallback: when a story has no usable og:image, try to resolve a
# fighter named in the poster line/title against octagon-api and hand the
# promo cutout to the renderer (render_news "cutout_path"). Every step is
# fail-silent - no match or a dead fetch just means the glow-field fallback.
RANKINGS_API = "https://api.octagon-api.com/rankings"
FIGHTER_API = "https://api.octagon-api.com/fighter/%s"


def build_name_map(rankings):
    """Lowercased fighter name -> octagon id from the /rankings payload
    (divisions with champion {id, championName} + fighters [{id, name}]).
    Full names always; bare surnames only while unambiguous - two fighters
    sharing one surname drop it, because a wrong cutout is worse than none.
    Pure."""
    if not isinstance(rankings, list):
        return {}
    full, last, clash = {}, {}, set()
    for div in rankings:
        if not isinstance(div, dict):
            continue
        entries = list(div.get("fighters") or [])
        champ = div.get("champion") or {}
        if isinstance(champ, dict) and champ.get("id") and champ.get("championName"):
            entries.append({"id": champ["id"], "name": champ["championName"]})
        for f in entries:
            fid = str((f or {}).get("id") or "")
            name = " ".join(str((f or {}).get("name") or "").lower()
                            .replace(chr(0x2019), "'").split())
            if not fid or not name:
                continue
            full[name] = fid
            parts = name.split()
            if len(parts) >= 2 and len(parts[-1]) >= 3:
                ln = parts[-1]
                if last.get(ln, fid) != fid:
                    clash.add(ln)
                last.setdefault(ln, fid)
    for ln in clash:
        last.pop(ln, None)
    for ln, fid in last.items():
        full.setdefault(ln, fid)
    return full


def match_fighters(text, name_map):
    """Every octagon id whose name occurs in `text` as whole words, ordered by
    position (earliest first - the SUBJECT of a headline is the fighter named
    FIRST: "Garry eyes ... before Makhachev title fight" is a Garry story).
    At one position the longer name wins the tie. Case-insensitive,
    apostrophe-normalized, de-duplicated. Pure."""
    t = " ".join((text or "").lower().replace(chr(0x2019), "'").split())
    if not t or not name_map:
        return []
    found = []
    for name, fid in (name_map or {}).items():
        m = re.search(r"(?<![a-z0-9])" + re.escape(name) + r"(?![a-z0-9])", t)
        if m:
            found.append((m.start(), -len(name), fid))
    out = []
    for _pos, _neg, fid in sorted(found):
        if fid not in out:
            out.append(fid)
    return out


def match_fighter(text, name_map):
    """The single best match from match_fighters, or "". Pure."""
    ids = match_fighters(text, name_map)
    return ids[0] if ids else ""


def cutout_blocked(fid, hist, now, days=7):
    """True while `fid`'s promo cutout is resting: it fronted a staged post
    within the last `days` days (staged_hist entries carry img="cutout:<id>").
    The rest is what stops one champion's mugshot fronting every story about
    him for a week straight. Pure."""
    if not fid or days <= 0:
        return False
    tag = "cutout:" + str(fid)
    for h in hist or []:
        if (h or {}).get("img") != tag:
            continue
        ts = common.parse_iso(h.get("ts"))
        if ts is not None and (now - ts).total_seconds() <= days * 86400:
            return True
    return False


def fighter_cutout(text, hist=None, now=None, days=7):
    """Resolve a fighter named in `text` to a downloaded promo-cutout temp
    file, skipping fighters whose cutout is resting (cutout_blocked). Returns
    (path, fighter_id) or ("", ""). One rankings GET per call; never raises."""
    try:
        code, data = common.get_json(RANKINGS_API, tries=2, timeout=10)
        if code != 200:
            return "", ""
        for fid in match_fighters(text, build_name_map(data)):
            if (hist is not None and now is not None
                    and cutout_blocked(fid, hist, now, days)):
                continue
            code, f = common.get_json(FIGHTER_API % fid, tries=2, timeout=10)
            if code != 200 or not isinstance(f, dict):
                continue
            url = str(f.get("imgUrl") or "")
            if not url.startswith("http"):
                continue
            raw = fetch_bytes(url)
            if not raw:
                continue
            fd, path = tempfile.mkstemp(suffix=".png")
            with os.fdopen(fd, "wb") as fh:
                fh.write(raw)
            return path, fid
        return "", ""
    except Exception:
        return "", ""


# ---- staging memory (the "same old news over and over" fix) ----------------
# state_news.json carries staged_hist: the last STAGED_HIST_CAP staged posts as
# {ts, t (title), names (lowercased name tokens), img (photo|cutout:<id>|wash|
# none)}. stage_gate reads it, remember_staged writes it, news_bot caps it in
# save(). Measured against the live studio channel on Aug 19 2026, these gates
# turn the 5 Makhachev posts staged in 26h into 2, and kill both duplicated
# Magny/Barboza pairs - exactly the owner's complaint.
# Sized from the LONGEST cooldown that reads this list times the daily ceiling,
# never a bare round number. cutout_blocked rests a fighter's promo mugshot for
# cutout_cooldown_days (7) but can only see fighters still inside this window,
# and news_bot.save() prunes by COUNT. At the old ceiling of 6 staged posts a
# day, 40 entries covered 6.7 days - already short of 7. The priority lane
# raises the ceiling to max_staged_per_day + max_priority_staged_per_day = 9,
# which would have cut the window to 4.4 days and quietly let one champion's
# cutout front two posters inside a week again. 7 * (6 + 5) = 77, so 80 with
# slack; the entries are small and fixed-shape, so the file stays a bounded
# ~22KB. A selftest derives the requirement from the live config, so raising a
# cap without raising this fails CI rather than silently shrinking the window.
STAGED_HIST_CAP = 80

GATE_DEFAULTS = {
    "stage_max_age_hours": 36,      # older stories never stage (rehash net #1)
    "subject_cooldown_hours": 12,   # 1+ shared name: same person, wait
    "story_cooldown_hours": 72,     # 2+ shared names / similar title: same story
    "staged_similar": 0.5,          # token-Jaccard vs staged titles (lower than
                                    # the channel's 0.6 - staging must be pickier)
    "cutout_cooldown_days": 7,      # a fighter's promo mugshot rests this long
    "quiet_hours_utc": [21, 8],     # owner pings sleep 21:00-07:59 UTC
}


def _gate(scfg, key):
    """One gate setting from the scoring config, falling back to
    GATE_DEFAULTS. Junk -> default."""
    try:
        v = (scfg or {}).get(key, GATE_DEFAULTS[key])
        return float(v)
    except (TypeError, ValueError):
        return float(GATE_DEFAULTS[key])


_ROSTER_CACHE = []
# Words that are NEVER a fighter's name in a Title-Case headline. The base set
# is the vocabulary those headlines actually use (measured on the Sept 2026
# recent window); learn_lexicon() adds every word the live window has printed
# in lowercase, which is storykey's rule for telling a name from a word.
_BASE_WORDS = scorer.HEADLINE_WORDS   # one list: what a name is NOT
_LEXICON = set()
# ...and what a name IS, learned the same way: a word the window's SENTENCE-case
# headlines capitalise mid-sentence and never print in lowercase ("Edson
# Barboza's retirement came down to..." teaches barboza). This is how a fighter
# the roster lacks still counts in a Title-Case headline.
_NAMES = set()


def learn_lexicon(titles):
    """Teach name_tokens which capitalised words are just words (every token
    the recent window has printed in lowercase) and which are names (see
    _NAMES). news_bot feeds it the `recent` titles once per staging drain.
    Bounded (the window is)."""
    words, caps = set(), set()
    for t in titles or []:
        t = str(t or "")
        sentence = not _title_case(t)
        for i, w in enumerate(re.findall(r"[A-Za-z\u00c0-\u017f']+", t)):
            if len(w) < 3:
                continue
            if w[0].islower():
                words.add(_bare(w))
            elif sentence and i > 0 and not w.isupper():
                caps.add(_bare(w))
    _LEXICON.clear()
    _LEXICON.update(words)
    _NAMES.clear()
    _NAMES.update(c for c in caps if c not in words and c not in _BASE_WORDS)


def _plain_word(b):
    """A bare token that is headline vocabulary, never a name - including a
    hyphenated one made only of such words ("ex-champion" was stored as a
    fighter's name for a Pantoja story, Sept 25 2026). Pure."""
    if b in _BASE_WORDS:
        return True
    parts = [p for p in b.split("-") if p]
    return len(parts) > 1 and all(p in _BASE_WORDS for p in parts)


def _namey(word, roster):
    """In a Title-Case headline: is this capitalised token plausibly a name?
    A roster name always is; a word the window has seen in lowercase (or a
    base headline word) never is. Pure over the two sets."""
    b = _bare(word)
    if b in roster:
        return True
    return not _plain_word(b) and b not in _LEXICON


def _roster_names():
    """(first names, surnames) from mma_roster.json, lowercased, via
    storykey's own loader (one read per process). Two empty sets when the
    roster is missing."""
    if not _ROSTER_CACHE:
        try:
            import storykey
            storykey._autoload_roster({})
            _ROSTER_CACHE.append((set(storykey.ROSTER_FIRST), set(storykey.ROSTER_SURNAMES)))
        except Exception:
            _ROSTER_CACHE.append((set(), set()))
    return _ROSTER_CACHE[0]


def _roster_tokens():
    """Every roster first name and surname, lowercased."""
    first, last = _roster_names()
    return first | last


def _bare(word):
    """A name token lowercased, apostrophe-normalised, possessive dropped. Pure."""
    lw = str(word or "").lower().replace(chr(0x2019), "'")
    if lw.endswith("'s"):
        lw = lw[:-2]
    return lw.strip("'-")


def _title_case(text):
    """True when most long words are capitalised - a Headline Styled Title,
    where a capital letter no longer marks a name. Pure."""
    words = [w for w in re.findall(r"[A-Za-z\u00c0-\u017f'-]+", text or "") if len(w) >= 4]
    # four, not five: "Max Holloway Returns To The Octagon In Style" has four
    # long words, and read as sentence case it made fighters of Octagon and Style
    if len(words) < 4:
        return False
    caps = sum(1 for w in words if w[0].isupper())
    return caps >= 0.7 * len(words)


def name_tokens(text):
    """Lowercased name-like tokens (fighter surnames, mostly) from a title or
    poster line, possessives stripped, stop-words out. This is what two
    stories about the same people share even when every other word differs
    ("Magny dismisses retirement talk" / "Magny wins record 25th").

    A run of exactly TWO adjacent name tokens is one PERSON ("Islam
    Makhachev", "Ian Garry") and collapses to the surname - otherwise the
    first+last pair counts as 2 shared names and trips stage_gate's
    same-STORY rule (which no breaking follow-up may override) when the truth
    is merely the same SUBJECT (which one may). Longer runs are kept whole:
    they are almost always Title-Case Headline Words, not names, and
    collapsing them would throw away the very tokens two rewrites of one
    story share. Pure."""
    runs, run = [], []
    last_end = None
    for m in scorer.NAME_RE.finditer(text or ""):
        w = m.group(0)
        if w in scorer.NAME_STOP:
            if run:
                runs.append(run)
                run = []
            last_end = None
            continue
        adjacent = (last_end is not None
                    and (text[last_end:m.start()] or "").strip() == ""
                    and m.start() - last_end <= 2)
        if run and not adjacent:
            runs.append(run)
            run = []
        run.append(w)
        last_end = m.end()
    if run:
        runs.append(run)
    # TITLE CASE (Sept 24 2026). "Raul Rosas Jr. Targets Multi-Division UFC
    # Titles Before Planned Retirement at Age 25" produced the names rosas,
    # targets, multi, division, titles, retirement and age - so for the next 12
    # hours every story containing the word "retirement" was refused as "same
    # subject". In a Title-Case headline capitals say nothing about names, so
    # the fighter roster decides there (_title_case_names). Sentence-case text
    # is unchanged.
    if _title_case(text):
        return _title_case_names(runs)
    roster = _roster_tokens()
    out = []
    for run in runs:
        # a sentence's first word ("Retirement talk swirls...") and an event
        # city ("UFC Abu Dhabi") are capitalised but are not people: they split
        # the run, so "Max Holloway Returns" is the pair "Max Holloway"
        subs, cur = [], []
        for w in run:
            if _plain_word(_bare(w)) and _bare(w) not in roster:
                if cur:
                    subs.append(cur)
                cur = []
            else:
                cur.append(w)
        if cur:
            subs.append(cur)
        for r in subs:
            # "Islam Makhachev" is one person -> surname. "Magny's Corner" is
            # a name plus the thing it owns -> keep both, or the name is lost.
            two_name = (len(r) == 2
                        and not r[0].endswith(("'s", chr(0x2019) + "s")))
            for w in ([r[-1]] if two_name else r):
                lw = _bare(w)
                if len(lw) >= 3 and lw not in out:
                    out.append(lw)
    return out[:8]


def _title_case_names(runs):
    """name_tokens for a Title-Case headline, where a capital letter says
    nothing. The first version filtered the words and then looked for "a first
    name before a surname" among the survivors, which lost Petr Yan, Kamaru
    Usman and a lone "Merab" and kept "Dhabi" and "Amid" - so an unrelated
    Pereira story was refused as the same subject as a Strickland story (the
    pre-deploy review, Sept 24 2026). Now, on the ORIGINAL word order:
      * a word is a NAME when the roster or the live window (_NAMES) knows it,
        when it owns something ("Barboza's"), or when it follows a roster
        first name ("Josh Hokit"); a roster first name that is also an
        ordinary word ("Will", "Max") is not a name on its own;
      * in a run of names only the LAST one counts - that is the surname
        ("Islam Makhachev", "Petr Yan", "Usman Nurmagomedov" whose first name
        is also a surname);
      * a clean two-word run is one person even off every list ("Raul Rosas
        Jr." stops at the "Jr.");
      * anything else - headline vocabulary, event cities, "Amid" - is not.
    Pure over the roster and the learned sets."""
    firsts, lasts = _roster_names()
    known = firsts | lasts | _NAMES
    out = []
    for r in runs:
        toks = [_bare(w) for w in r]
        plain = [not _namey(w, set()) for w in r]          # an ordinary word
        poss = [w.lower().replace(chr(0x2019), "'").endswith("'s") for w in r]
        isname = []
        for i, b in enumerate(toks):
            nm = b in known and not (plain[i] and b not in lasts)
            if not nm and not plain[i]:
                nm = poss[i] or (i > 0 and toks[i - 1] in firsts and not plain[i - 1])
            isname.append(bool(nm))
        if len(r) == 2 and not plain[0] and not plain[1] and not poss[0]:
            isname = [True, True]
        for i, b in enumerate(toks):
            if not isname[i]:
                continue
            if i + 1 < len(toks) and isname[i + 1] and not poss[i]:
                continue                                    # a first name: the surname follows
            if len(b) >= 3 and b not in out:
                out.append(b)
    return out[:8]


# ---- the priority lane (the "it never reached the studio" fix) ------------
# Sept 3 2026. A Yahoo Sports story the owner called the best headline of the
# day reached the news channel at 17:45 UTC, with a phone alert, and never
# reached the studio. It was not filtered and not a repeat: the six slots of
# max_staged_per_day had been spent between 03:44 and 08:35 by six ordinary
# stories, and scorer.under_cap refused this one BEFORE it was ever scored.
# A daily budget that is first-come-first-served is spent by breakfast.
#
# So the hot tier gets a budget of its own. What counts as hot is the
# DETERMINISTIC heuristic, never the model score, for the same reason
# notify.py gives:
#   * measured on 700 real stories, DeepSeek hands 82-85 to almost everything,
#     so it ranks nothing;
#   * the heuristic separates cleanly - 58% of stories sit at its floor of 35,
#     and only 3.6 a day reach 80. BOTH stories that have ever buzzed the
#     owner's phone scored exactly 80.
#
# TWO THINGS ARE DELIBERATELY NOT THE TRIGGER, and both were measured before
# being rejected:
#
# 1. The bare `breaking` flag. Over those 700 stories the keyword net fired 70
#    times, 47 of them on the word "retirement" alone ("teases retirement",
#    "retirement claim", "what retirement looks like"). Breaking already adds
#    30 points, so a breaking story carrying real news reaches 80 on its own
#    and one carrying only the word does not, which is the correct outcome.
#
# 2. The phone alert itself. "It buzzed his phone so it belongs in the studio"
#    is a tempting invariant and it is wrong, because notify.tier alerts on
#    `breaking` with NO score floor. Simulating notify.claim over the same 700
#    stories: 50 stories claimed a buzz, and the 28 of them scoring under 80
#    are eight copies of "Islam Makhachev teases retirement", a Dolly Parton
#    tribute, The Rock's WWE status, a guillotine on a pickup truck and an
#    Argentina footballer's international retirement. Admitting those to a
#    RESERVED lane would hand the scarce slots to exactly the drip the Aug 19
#    staging memory exists to stop. A buzz is a news interruption; the studio
#    is content selection; they are different jobs. The alert still decides
#    DRAIN ORDER in news_bot, which is the honest use of it.
PRIORITY_THRESHOLD = 80


def is_priority(heur_score, scfg):
    """True when this story takes the priority staging lane: the deterministic
    heuristic reaches scoring.priority_threshold.

    scoring.priority_threshold of 0 turns the lane off entirely; a junk value
    falls back to the default rather than raising. Pure."""
    try:
        thr = int((scfg or {}).get("priority_threshold", PRIORITY_THRESHOLD))
    except (TypeError, ValueError):
        thr = PRIORITY_THRESHOLD
    if thr <= 0:
        return False
    try:
        return int(heur_score or 0) >= thr
    except (TypeError, ValueError):
        return False


def stage_gate(it, score, breaking, hist, now, scfg):
    """(ok, reason) - may this scored story stage? Applied AFTER scoring (the
    breaking/ping exception needs the score) and BEFORE any rendering.

    Refuses, in order: service-journalism rehash (watch guides, results
    roundups - the news channel still posts them, the studio never does),
    stale stories (Google's search feed surfaces re-hashes of days-old events
    with fresh pubdates), a REWRITE of a recently staged story (title
    similarity within story_cooldown_hours - never overridden, a rehash is a
    rehash even when its subject is big news), the same PEOPLE again within
    story_cooldown_hours (2+ shared name tokens), and the same SUBJECT again
    within subject_cooldown_hours (1+ shared name token).

    The BREAKING keyword net overrides the name-based rules (and the junk
    gate) but never the similarity rule: "Gaethje pulls out of Tsarukyan
    fight" names the same two people as the booking staged yesterday and MUST
    reach the studio, while "Makhachev retains title" reworded by a fifth
    outlet must not. The AI score deliberately cannot override anything:
    measured live, the model hands 85+ to event-adjacent rehash, which is
    exactly the drip these cooldowns exist to stop; the breaking keyword net
    is deterministic and names real developments only. Pure."""
    title = str(it.get("title") or "")
    big = bool(breaking)
    if not big and scorer.is_junk(title):
        return False, "junk (watch guide / results rehash)"
    when = it.get("when")
    max_age = _gate(scfg, "stage_max_age_hours")
    if when is not None and max_age > 0:
        try:
            age_h = (now - when).total_seconds() / 3600.0
        except Exception:
            age_h = 0.0
        if age_h > max_age:
            return False, "stale (%dh old)" % int(age_h)
    names = set(name_tokens("%s %s" % (title, it.get("line") or "")))
    sim_thr = _gate(scfg, "staged_similar")
    subject_h = _gate(scfg, "subject_cooldown_hours")
    story_h = _gate(scfg, "story_cooldown_hours")
    # For a BREAKING story only a near-verbatim rewrite counts as the same
    # story: two short titles about the same pair share most of their tokens
    # anyway ("Gaethje pulls out of Tsarukyan fight" scores 0.6 against the
    # booking it follows up), so the normal bar would eat exactly the
    # follow-ups the breaking net exists to let through. A true rewrite of
    # one headline sits at 0.8+.
    thr_eff = max(sim_thr, 0.75) if big else sim_thr
    for h in reversed(list(hist or [])):
        ts = common.parse_iso((h or {}).get("ts"))
        if ts is None:
            continue
        age = (now - ts).total_seconds() / 3600.0
        if age > max(story_h, subject_h):
            continue
        if (age <= story_h
                and newsconfig.similar(title, h.get("t", "")) >= thr_eff):
            return False, "same story staged %dh ago" % int(age)
        if big:
            continue                 # breaking overrides every name-based rule
        shared = len(names & set(h.get("names") or []))
        if shared >= 2 and age <= story_h:
            return False, "same people staged %dh ago" % int(age)
        if shared >= 1 and age <= subject_h:
            return False, "same subject staged %dh ago" % int(age)
    return True, ""


def remember_staged(state, it, img, now):
    """Append one staged post to state["staged_hist"] (capped). Called by
    news_bot right after stage_story; the state file rides the normal
    save()/persist_state path."""
    hist = state.setdefault("staged_hist", [])
    hist.append({
        "ts": now.isoformat(),
        "t": str(it.get("title") or "")[:200],
        "names": name_tokens("%s %s" % (it.get("title") or "",
                                        it.get("line") or "")),
        "img": str(img or "none")[:80],
    })
    state["staged_hist"] = hist[-STAGED_HIST_CAP:]


# Texture plates for photoless/cutout posters - MUST mirror
# postcard.BACKGROUNDS (a selftest pins the two lists together; postcard is
# not imported here because it needs Pillow at import time and ytposts must
# stay importable without it). Purple stays the only colorway (owner law:
# purple IS the brand) - the PLATE is what varies, so two wash posters in a
# row stop being pixel-identical scenes.
PLATES = ("arena", "spotlight", "cage", "smoke")


def pick_plate(guid):
    """Deterministic texture plate for one story: same story -> same plate,
    the feed as a whole rotates. Pure."""
    h = hashlib.sha256(str(guid or "").encode("utf-8")).hexdigest()
    return PLATES[int(h[:8], 16) % len(PLATES)]


def quiet_now(scfg, now):
    """True while the owner ping is asleep. quiet_hours_utc is [start, end)
    in UTC hours; a window may wrap midnight ([21, 8] = 21:00-07:59). The
    POST still happens - silently - so the post is waiting in the studio in
    the morning; only the 4am mention dies. Junk config -> never quiet. Pure."""
    qh = (scfg or {}).get("quiet_hours_utc", GATE_DEFAULTS["quiet_hours_utc"])
    if not isinstance(qh, (list, tuple)) or len(qh) != 2:
        return False
    try:
        a, b = int(qh[0]) % 24, int(qh[1]) % 24
    except (TypeError, ValueError):
        return False
    if a == b:
        return False
    h = now.hour
    return (a <= h < b) if a < b else (h >= a or h < b)


def parse_og_image(html):
    """First og:image / twitter:image URL in an HTML blob, or ''. Pure."""
    for rx in (OG_RE, OG_RE_FLIP):
        m = rx.search(html or "")
        if m and m.group(1).startswith("http"):
            return m.group(1)
    return ""


def og_image(link, timeout=8):
    """The story's social-card image URL, or ''. Never raises."""
    try:
        if not link or any(h in link for h in NO_FETCH_HOSTS):
            return ""
        code, text = common.get_text(link, tries=1, timeout=timeout)
        if code != 200 or not text:
            return ""
        return parse_og_image(text)
    except Exception:
        return ""


def article_page(link, timeout=8):
    """The article's HTML, or "" - Google News and nitter links are never
    fetched server-side (see NO_FETCH_HOSTS). Never raises."""
    try:
        if not link or any(h in link for h in NO_FETCH_HOSTS):
            return ""
        code, text = common.get_text(link, tries=1, timeout=timeout)
        return text if code == 200 and text else ""
    except Exception:
        return ""


PHOTO_CAP = 12 * 1024 * 1024    # an untouched original upload can run 5-8 MB
PICK_SECONDS = 20.0             # every candidate download for one story, wall clock


def pick_photo(link, title="", seconds=PICK_SECONDS):
    """The best photo on the story's page, framed and graded for a poster:
    {"path", "name", "faces", "grade", "alts", "score", "url"}.

    photopick does the judging (every candidate on the page, the full-size
    original behind a CDN crop, faces found, graphics rejected); this wraps
    it with the network and a temp file. The chosen photo is re-encoded to a
    2400px JPEG for the Discord upload, which is what the studio later loads
    - its face boxes are fractions, so they survive the resize.

    {"skip": True} when the page WAS judged and nothing on it is usable (a
    logo, a thumbnail, a text graphic): the caller must not fall back to the
    raw og:image, which would put the refused picture straight back. None
    when judging never happened (the page is unfetchable, photopick or
    Pillow is missing, every download failed): the caller may fall back.
    Downloads stop after `seconds` (see photopick.choose). Never raises."""
    try:
        import photopick
        page = article_page(link)
        if not page:
            return None
        cands = photopick.candidates_from_html(page, link, title=title)
        if not cands:
            return {"skip": True}
        deadline = time.monotonic() + max(0.0, float(seconds))
        got = [0]

        def _fetch(u):
            left = deadline - time.monotonic()
            if left < 1.5:
                return None
            raw = fetch_bytes(u, timeout=min(8.0, left), cap=PHOTO_CAP)
            if raw:
                got[0] += 1
            return raw
        best = photopick.choose(cands, _fetch, budget=photopick.FETCH_CAP, deadline=deadline)
        if not best:
            return {"skip": True} if got[0] else None
        small, ext = photopick.shrink_for_upload(best["raw"], best["info"])
        if not ext:
            ext, _ = common.sniff_image(small)
        fd, path = tempfile.mkstemp(suffix="." + (ext or "img"))
        with os.fdopen(fd, "wb") as f:
            f.write(small)
        faces = photopick.spec_faces(best["info"].get("faces"))
        grade = {"look": photopick.pick_look(title),
                 "gamma": photopick.auto_gamma(best["info"].get("lum"), bool(faces))}
        return {"path": path, "name": "photo." + (ext or "jpg"), "faces": faces,
                "grade": grade, "score": best.get("score"), "url": best.get("url", ""),
                "alts": [{"u": a["url"], "f": photopick.spec_faces(a.get("faces"))}
                         for a in best.get("alts") or []
                         if isinstance(a.get("url"), str) and len(a["url"]) <= ALT_URL_MAX]}
    except Exception:
        return None


ALT_URL_MAX = 300      # a longer url would eat the Discord message budget


def fetch_bytes(url, timeout=10, cap=8 * 1024 * 1024):
    """Download binary content (the story photo). Returns bytes or None."""
    try:
        req = urllib.request.Request(url, headers={"User-Agent": common.BROWSER_UA})
        with urllib.request.urlopen(req, timeout=timeout) as r:
            data = r.read(cap + 1)
        if not data or len(data) > cap:
            return None
        return data
    except Exception:
        return None


# A sentence end: . ! or ? plus any closing quote/bracket, followed by a space
# or the end of the string. "U.S." style abbreviations are handled by requiring
# whitespace after, which "U.S. Open" satisfies - acceptable, because the cost of
# an early cut is a shorter caption, never a broken one.
_SENT_END = re.compile(r"[.!?][\"'’”\)\]]*(?=\s|$)")

# A period after one of these is an abbreviation, not the end of a sentence.
# Without this the cutter stopped a caption at "he's just clumsy. The No." -
# "No." being "No. 6-ranked featherweight". Single letters cover initials.
_ABBREV = frozenset("""
mr mrs ms dr prof sr jr st no vs v inc ltd co corp dept est approx
jan feb mar apr jun jul aug sep sept oct nov dec
mon tue tues wed thu thur thurs fri sat sun
ariz calif colo conn fla ga ill ind kan ky la mass mich minn miss mo mont
neb nev okla ore pa penn tenn tex va vt wash wis wyo
lbs kg ft alt approx max min etc al
""".split())


def _is_abbrev(t, dot):
    """True when the '.' at index `dot` closes an abbreviation or an initial."""
    i = dot
    while i > 0 and (t[i - 1].isalnum() or t[i - 1] == "."):
        i -= 1
    word = t[i:dot].replace(".", "").lower()
    return bool(word) and (len(word) == 1 or word in _ABBREV)


def _sentence_trim(text, cap):
    """Trim to cap on a COMPLETE sentence boundary. Pure.

    Never emits a partial sentence. The owner reported pasting a caption that
    read "...despite being knocked out at the White House. Former
    light-heavyweight..." into YouTube and having to rewrite it. Two things
    produced that: the publisher's own excerpt marker (common.strip_truncation
    now removes it) and this function, which used to require the sentence
    boundary to land past cap//2 and otherwise cut mid-sentence at a word and
    append "...". For that story the boundary sat at index 132 with cap//2 =
    150, so a perfectly good full sentence was rejected in favour of a fragment.

    Now: keep the last sentence that fits entirely. If not one sentence fits,
    return "" and let build_caption drop the body - a headline with no blurb is
    postable, a headline with half a sentence is not. The one exception is a
    summary containing no sentence punctuation at all, which is a short complete
    clause rather than a fragment, so it is kept whole when it fits."""
    t = " ".join((text or "").split())
    if not t:
        return ""
    ends = [m.end() for m in _SENT_END.finditer(t)
            if not _is_abbrev(t, m.start())]
    if not ends:
        return t if len(t) <= cap else ""
    fits = [e for e in ends if e <= cap]
    if not fits:
        return ""
    return t[:fits[-1]].strip()


def _echoes(head, body):
    """True when the summary is just the headline again (optionally with a
    site name or a few words glued on). Pure."""
    def norm(t):
        return " ".join("".join(c for c in (t or "").lower()
                                if c.isalnum() or c.isspace()).split())
    h, b = norm(head), norm(body)
    if not h or not b:
        return False
    return b.startswith(h) or h.startswith(b)


def build_caption(title, desc, source):
    """The text the owner pastes into the YouTube composer. Pure, calm voice:
    headline, one or two context sentences, attribution, one hashtag."""
    head = common.strip_markdown(title or "").strip()
    lines = [head]
    body = _sentence_trim(
        common.tidy_summary(common.strip_markdown(desc or "")),
        CAPTION_MAX_DESC)
    # Many feeds set the summary to the headline again, sometimes with the site
    # name glued on ("... against Islam Makhachev BJPenn.com"), which printed
    # the same sentence twice in the staged caption. Exact equality was not
    # enough - compare on normalised prefix.
    if body and _echoes(head, body):
        body = ""
    if body:
        lines += ["", body]
    lines += ["", "via %s" % (source or "the wire"), "#UFC"]
    return "\n".join(lines)


def retention_note(newscfg):
    """One calm line telling the owner this copy is temporary, or "".

    studio_clean.py deletes staged posts on a daily cron, so the message says
    so rather than leaving him to wonder where yesterday's went. The number
    comes from studio_clean.retention_days, which reads the SAME newsconfig
    key the deleter uses - a second copy of that default here is exactly how
    the two would drift apart. A missing module just drops the line.
    """
    try:
        from studio_clean import retention_days
        days = retention_days(newscfg)
    except Exception:
        return ""
    return "This copy is deleted from the channel after %d day%s.\n" % (
        days, "" if days == 1 else "s")


def studio_spec(it, kind, bg="", extra=None):
    """The ```json spec fence the Worker parses back out for the studio's
    staged rail (worker.js stagedParts). This is what makes a staged post
    ROUND-TRIP: the studio re-renders the text live from these fields instead
    of showing the rendered card's baked-in pixels. `kind` says what the
    SECOND attachment is ("photo" = the raw story photo, "cutout" = the
    octagon promo cutout, "" = card only); `bg` is the texture plate a
    photoless render sat on, so the studio reopens the same scene.

    `extra` (Sept 24 2026, photo posts only) carries what photopick learned
    so the studio frames and grades the SAME way the staged card did:
    faces - [[x, y, w, h], ...] fractions of the raw photo;
    grade - {"look", "gamma"}; alts - other good photos from the article as
    {"u": url, "f": face boxes} (urls the Worker proxies after checking they
    are listed here). Pure."""
    spec = {
        "line": " ".join(str(it.get("line") or "").split())[:200],
        "hot": [str(h)[:60] for h in (it.get("hot") or []) if str(h or "").strip()][:8],
        "source": " ".join(str(it.get("source") or "").split())[:80],
        "emphasis": str(it.get("emphasis") or "")[:20],
        "guid": str(it.get("guid") or "")[:200],
        "template": "news",
        "colorway": "purple",
        "photo": kind,
        "bg": str(bg or "")[:20],
    }
    ex = extra if isinstance(extra, dict) else {}
    if kind == "photo":
        faces = ex.get("faces")
        if isinstance(faces, list) and faces:
            spec["faces"] = [[round(float(v), 3) for v in f[:4]] for f in faces[:3]
                             if isinstance(f, (list, tuple)) and len(f) >= 4]
        g = ex.get("grade")
        if isinstance(g, dict) and g.get("look"):
            spec["grade"] = {"look": str(g["look"])[:12],
                             "gamma": round(float(g.get("gamma", 1.0)), 3)}
        alts = []
        for a in (ex.get("alts") or []):
            u = a.get("u") if isinstance(a, dict) else a
            if not (isinstance(u, str) and u.startswith("https://") and len(u) <= ALT_URL_MAX):
                continue
            f = a.get("f") if isinstance(a, dict) else []
            alts.append({"u": u, "f": [[round(float(v), 3) for v in b[:4]] for b in (f or [])[:2]
                                       if isinstance(b, (list, tuple)) and len(b) >= 4]})
        if alts:
            spec["alts"] = alts[:3]
    # A backtick run inside the fence (an alt url lifted from a third-party
    # page, a model-written line) would close the Discord code block early and
    # cost the post its round-trip. JSON reads the escaped form back as the
    # same character, so nothing else changes.
    return json.dumps({k: v for k, v in spec.items() if v},
                      ensure_ascii=True).replace("`", chr(92) + "u0060")


# The staged message must fit Discord's 2000 characters WITH the deep link
# _deep_link appends afterwards (~110). The alternate-photo urls are the only
# optional bulk, so they are what gets trimmed.
BODY_BUDGET = 1870


def _studio_body(score, why, caption, ping_uid, note="", spec_json=""):
    head = "<@%s> " % ping_uid if ping_uid else ""
    spec = ("\n```json\n%s\n```" % spec_json) if spec_json else ""
    return ("%sStaged post - score %d (%s)\n"
            "Copy the caption, save the image, then post or schedule it in "
            "the YouTube app.\n%s```\n%s\n```%s"
            % (head, score, why, note, caption, spec))


def _deep_link(chan, resp, body, newscfg):
    """PATCH a just-staged message to append its own open-in-the-studio link
    (the message id only exists after the POST). Fail-silent: a missing url,
    a non-dict response or an over-long body just leaves the message as-is."""
    try:
        mid = str((resp or {}).get("id") or "") if isinstance(resp, dict) else ""
        surl = str(newscfg.get("studio_url") or "").strip()
        # same character rules the validator enforces: the url is <>-wrapped
        # and gains its own #fragment, so whitespace/<>/# would corrupt it
        if (not mid or not surl.startswith("https://")
                or re.search(r"[\s<>#]", surl)):
            return
        extra = "\nOpen in the studio: <%s#s=%s>" % (surl, mid)
        if len(body) + len(extra) <= 1990:
            common.edit_message(chan, mid, body + extra)
    except Exception:
        pass


# Below this many seconds before the caller's deadline the slow work - the
# Google News decode (up to ~24 s), the photo judging (8 s page + PICK_SECONDS),
# the octagon cutout (up to ~40 s) - is skipped and the story stages on the
# wash. A job killed mid-stage by timeout-minutes loses the cycle's state
# write, and the next job re-posts the story.
SLOW_WORK_MIN = 120.0


def stage_story(it, score, why, cfg_bots, newscfg, hist=None, state=None, deadline=None):
    """Render + post one staged story to the studio channel. Returns
    {"status": short ASCII string, "img": what fronted the card - "photo",
    "cutout:<octagon id>", "wash", or "none" (text-only stage)}; NEVER raises
    (news delivery must not notice us). The caller records "img" into
    staged_hist so cutout_blocked can rest a fighter's mugshot. `deadline`
    (epoch seconds) is when the caller's job must be done - see SLOW_WORK_MIN."""
    try:
        chan = (cfg_bots.get("channels", {}) or {}).get("studio")
        if not chan:
            return {"status": "no studio channel - run a deploy", "img": "none",
                    "ok": False}
        scoring = (newscfg.get("scoring", {}) or {})
        now = common.now_utc()
        ping_uid = ""
        # quiet hours kill the MENTION, never the post: the story still lands
        # in the studio silently and is waiting in the morning (the owner was
        # pinged at 4:21am, which is what this exists to stop)
        if score >= int(scoring.get("ping_threshold", 85)) and not quiet_now(scoring, now):
            # ONE BUZZ PER STORY. The news wire alerts on the same story from its
            # own (heuristic) tier, so without this shared ledger a story scoring
            # 92 produced a news mention AND a studio mention - two notifications
            # for one piece of news. The news post drains first and claims it, so
            # the fast alert is the one that fires. `state` is optional so the
            # existing test callers and any direct use keep working unchanged.
            if state is None or notify.claim(state, it.get("guid", ""),
                                             time.time(), newscfg,
                                             title=it.get("title", ""),
                                             similar=newsconfig.similar,
                                             subject=name_tokens(it.get("title", ""))):
                ping_uid = str(cfg_bots.get("owner_id", "") or "")

        caption = build_caption(it.get("title"), it.get("desc"), it.get("source"))
        mentions = ({"parse": [], "users": [ping_uid]} if ping_uid else None)
        silent = not ping_uid    # a ping must never ride a silent message

        img_path = ""
        photo_path = ""
        cutout_path = ""
        cut_fid = ""
        photo_name = "photo.jpg"
        plate = pick_plate(it.get("guid"))
        extra = {}
        left = (float(deadline) - time.time()) if deadline else 9999.0
        slow_ok = left > SLOW_WORK_MIN
        try:
            # Google News links only resolve in a browser; decode() turns one
            # into the REAL article URL so the story's own og:image wins over
            # the promo-cutout fallback. Fail-silent: "" keeps the old path.
            link = (gnews.decode(it.get("link")) if slow_ok else "") or it.get("link")
            # Sept 24 2026: every photo on the page is judged (photopick), the
            # full-size original replaces a CDN thumbnail, and the winner comes
            # back framed on its faces and graded. The old og:image download
            # below is the fallback ONLY when judging never happened: a page
            # photopick judged and refused ({"skip"}) must not have its refused
            # og:image put straight back on the poster.
            pick = (pick_photo(link, it.get("title", ""), seconds=PICK_SECONDS)
                    if slow_ok else {"skip": True})
            if pick and pick.get("path"):
                photo_path, photo_name = pick["path"], pick["name"]
                extra = {"faces": pick.get("faces") or [],
                         "grade": pick.get("grade") or {},
                         "alts": pick.get("alts") or []}
            photo_url = "" if (photo_path or (pick and pick.get("skip"))) else og_image(link)
            if photo_url:
                raw = fetch_bytes(photo_url)
                if raw:
                    # Name it by its real magic number, not by the URL and not
                    # by a hard-coded ".jpg". common.post_file derives the
                    # multipart content type from this extension, Discord
                    # records that, and the studio trusts Discord - so a WebP
                    # mislabelled image/jpeg simply fails to decode in the app.
                    _ext, _ = common.sniff_image(raw)
                    fd, photo_path = tempfile.mkstemp(suffix="." + (_ext or "img"))
                    photo_name = "photo." + (_ext or "jpg")
                    with os.fdopen(fd, "wb") as f:
                        f.write(raw)
            if not photo_path and slow_ok:
                cutout_path, cut_fid = fighter_cutout(
                    "%s %s" % (it.get("line") or "", it.get("title") or ""),
                    hist=hist, now=now,
                    days=int(_gate(scoring, "cutout_cooldown_days")))
            import postcard                     # lazy: needs Pillow
            # line/hot come from the scorer via news_bot; speaker/inset stay
            # out for now - speaker inference lands with the composer app.
            img = postcard.render("news", {
                "headline": it.get("title", ""),
                "line": it.get("line", ""),
                "hot": it.get("hot") or [],
                # hot-word emphasis: news_bot passes the newsconfig setting
                # ("color" / "underline" / "auto"); the guid is what postcard
                # hashes when it is "auto", so one story always renders the
                # same way while the feed still alternates
                "emphasis": it.get("emphasis", ""),
                "guid": it.get("guid", ""),
                "source": it.get("source", ""),
                "photo_path": photo_path or None,
                "cutout_path": cutout_path or None,
                # photopick's framing + grade (empty on the fallback path, so
                # postcard keeps its old framing there)
                "faces": extra.get("faces") or [],
                "grade": extra.get("grade") or None,
                # photoless/cutout posters rotate their texture plate per
                # story - purple stays the only hue (owner law), the SCENE is
                # what varies
                "background": plate,
            })
            fd, img_path = tempfile.mkstemp(suffix=".png")
            os.close(fd)
            img.save(img_path, "PNG")
        except SystemExit:
            img_path = ""                       # Pillow missing: text-only stage
        except Exception as e:
            img_path = ""
            print("  stage render failed (%s), staging text-only" % type(e).__name__)
        # A failed render used to discard an already-downloaded subject too,
        # because the upload sat behind `if img_path:`. The owner then got a
        # text-only post with no round-trip payload even though the photo was
        # in hand. Ship whatever we have.

        # the raw subject rides as a SECOND attachment so the studio can
        # re-render the poster with the text still live (the round-trip fix:
        # loading the rendered card back into an editor gives baked-in text)
        raw_kind = "photo" if photo_path else ("cutout" if cutout_path else "")
        img_kind = ("none" if not img_path else
                    "photo" if photo_path else
                    ("cutout:" + cut_fid) if cutout_path else "wash")
        def _body():
            return _studio_body(score, why, caption, ping_uid,
                                retention_note(newscfg),
                                spec_json=studio_spec(it, raw_kind if img_path else "",
                                                      bg="" if photo_path else plate,
                                                      extra=extra))
        body = _body()
        while len(body) > BODY_BUDGET and extra.get("alts"):
            extra["alts"] = extra["alts"][:-1]
            body = _body()
        files = []
        if img_path:
            files.append((img_path, "post.png"))
        if photo_path:
            files.append((photo_path, photo_name))
        elif cutout_path:
            files.append((cutout_path, "cutout.png"))
        if files:
            code, resp = common.post_file(chan, body, files,
                                          allowed_mentions=mentions, silent=silent)
        else:
            code, resp = common.post_message(chan, body,
                                             allowed_mentions=mentions, silent=silent)
        if code in (200, 201):
            _deep_link(chan, resp, body, newscfg)
        for tmp in (img_path, photo_path, cutout_path):
            if tmp:
                try: os.remove(tmp)
                except OSError: pass
        return {"status": "staged (HTTP %s)%s" % (code, " with ping" if ping_uid else ""),
                "img": img_kind, "ok": code in (200, 201)}
    except Exception as e:
        return {"status": "stage failed (%s)" % type(e).__name__, "img": "none",
                "ok": False}
