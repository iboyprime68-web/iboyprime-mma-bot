"""Positive MMA topic gate for the news wire.

WHAT WENT WRONG
---------------
`newsconfig.classify()` ended with `return cfg.get("default_category", "ufc")`,
so any story that did not match the (disabled) boxing or mma_other keyword lists
was labelled UFC and sailed through the UFC-only filter. That was harmless while
the wire polled three MMA-only feeds. It stopped being harmless when Google News
search RSS and Yahoo Sports MMA were added: both carry general-sports output.

Measured in the live channel over 36 hours (Sept 2026): MLB ("Highlights: Mets at
Rays"), college football ("No. 14 BYU begins Big 12 title chase"), NFL ("Biggest
Question for the Broncos"), soccer ("Carabao Cup live streams") and a Paramount+
advert. The owner asked for UFC and all MMA. None of that is MMA.

THE MODEL: TRUST THE SOURCE, THEN REQUIRE A SIGNAL
--------------------------------------------------
Sources split cleanly in two, and the split does the heavy lifting:

  TRUSTED   MMA-only publications (MMA Fighting, Bloody Elbow, MMA Mania,
            Sherdog, the X insider accounts). Everything they publish is MMA.
            They are kept unless a hard other-sport marker fires.

  UNTRUSTED Search and aggregator feeds (Google News, Yahoo Sports). These
            require a POSITIVE MMA signal: a promotion, MMA vocabulary, or a
            full fighter name.

Marked per source as `trusted` in newsconfig; a source with no flag is treated
as UNTRUSTED, because the failure of guessing wrong in that direction is a
baseball score in the MMA channel, while the other direction merely asks a real
MMA story to contain one MMA word - which essentially all of them do.

BIAS, STATED ON PURPOSE
-----------------------
The gate is biased towards DROPPING an ambiguous story from an untrusted
aggregator, and towards KEEPING an ambiguous story from a dedicated MMA outlet.
Dropping real MMA news is also a failure, so every drop is printed with the
signal that decided it - read the job log for a week before trusting the list.

NAME MATCHING IS FULL-NAME ONLY
-------------------------------
A bare surname is not a signal. The ranked roster contains Hill, Allen, Smith,
Jones, Harrison, Green, Walker, Lewis and Turner; matching on surnames alone
would keep "Tyreek Hill wants out of Miami". Two adjacent capitalised words must
both belong to one roster entry. This deliberately does NOT go through
`ytposts.name_tokens`, which by its own docstring collapses a two-token run to
the surname and therefore can never produce the strong signal.
"""

import json
import os
import re

# Adjacent capitalised words, Latin-1 + Extended-A so Prochazka and Blachowicz
# are visible. Same shape as scorer.NAME_RE, which is the tested precedent.
NAME_RE = re.compile("\\b[A-Z\u00c0-\u00de\u0100-\u017f]"
                     "[a-z\u00df-\u00ff\u0100-\u017f'-]{2,}\\b")

PROMOTIONS = (
    "ufc", "dana white", "contender series", "dwcs", "tuf", "ultimate fighter",
    "bellator", "pfl", "professional fighters league", "one championship",
    "one fc", "bkfc", "bare knuckle", "bareknuckle", "rizin", "cage warriors",
    "invicta", "ksw", "lfa", "legacy fighting", "oktagon", "ares fc", "brave cf",
    "m-1 global", "road fc", "shooto", "pancrase", "gamebred", "misfits boxing",
    "pride fc", "strikeforce", "wec", "eagle fc",
)

# Vocabulary that essentially only appears in combat-sports coverage. "knockout"
# and "submission" are here; "fight", "fighter" and "champion" are NOT, because
# every sport uses them.
MMA_TERMS = (
    "mma", "mixed martial arts", "octagon", "the cage", "inside the cage",
    "cage side", "cageside", "submission", "submissions", "guillotine", "armbar",
    "rear-naked choke", "rear naked choke", "kimura", "heel hook", "triangle choke",
    "d'arce", "anaconda choke", "ground and pound", "takedown", "takedowns",
    "grappling", "jiu-jitsu", "jiu jitsu", "bjj", "muay thai", "kickboxing",
    "sprawl", "clinch work", "knockout", "knockouts", "ko win", "tko", "split decision",
    "unanimous decision", "majority decision", "doctor stoppage", "walkout",
    "weigh-in", "weigh-ins", "weigh in", "made weight", "missed weight",
    "catchweight", "flyweight", "bantamweight", "featherweight", "lightweight",
    "welterweight", "middleweight", "light heavyweight", "heavyweight",
    "strawweight", "pound-for-pound", "pound for pound", "usada", "cage fighter",
    "fight card", "main card", "prelims", "co-main event", "title defense",
    "title defence", "interim title", "title eliminator", "octagon interview",
    "fight week", "fight night", "matchmaker", "cornerman", "corner stoppage",
)

# Hard other-sport markers. On an untrusted source these are irrelevant (the
# story has to earn its place anyway); on a TRUSTED source they are the only
# thing that can throw a story out, which is why the list is short, specific and
# contains no word an MMA story would use.
OTHER_SPORTS = (
    "nfl", "nba", "mlb", "nhl", "wnba", "ncaa", "college football",
    "college basketball", "big ten", "big 12", "sec football", "acc football",
    "premier league", "la liga", "serie a", "bundesliga", "ligue 1",
    "champions league", "europa league", "carabao cup", "fa cup", "world cup",
    "major league baseball", "major league soccer", "national football league",
    "formula 1", "formula one", "nascar", "indycar", "motogp",
    "pga tour", "the masters", "wimbledon", "us open tennis", "grand slam tennis",
    "cricket", "test match", "ipl 20", "rugby union", "rugby league",
    "super bowl", "world series", "stanley cup", "march madness",
    "transfer window", "quarterback", "touchdown", "home run", "free throw",
    "power play goal", "wicket", "birdie", "bogey",
)


# A professional fight record sitting next to fighter vocabulary: "9-1 fighter",
# "the 12-3 prospect", "improves his record to 26-5". Baseball scores match the
# number shape, which is why the vocabulary word is required within 24 characters.
RECORD_RE = re.compile(
    r"(?<![\w-])\d{1,2}-\d{1,2}(?:-\d{1,2})?(?![\w-])[^.?!]{0,24}?"
    r"(?<![a-z])(?:fighter|prospect|record|undefeated|debutant|signee)(?![a-z])"
    r"|(?<![a-z])(?:fighter|prospect|record|undefeated|debutant|signee)(?![a-z])"
    r"[^.?!]{0,24}?(?<![\w-])\d{1,2}-\d{1,2}(?:-\d{1,2})?(?![\w-])"
)


def _roster_path():
    return os.path.join(os.path.dirname(os.path.abspath(__file__)), "mma_roster.json")


_ROSTER = None


def roster(extra=()):
    """Lowercased full names. Cached; `extra` is the owner's always_allow list
    from newsconfig, merged on every call so a panel edit applies immediately."""
    global _ROSTER
    if _ROSTER is None:
        try:
            with open(_roster_path(), encoding="utf-8") as fh:
                _ROSTER = {n.lower() for n in (json.load(fh).get("fighters") or [])}
        except Exception:
            _ROSTER = set()          # a missing roster weakens the gate, never breaks it
    return _ROSTER | {str(n).lower() for n in (extra or ()) if n}


def _has_term(text, term):
    """Boundary-safe match on already-lowercased text. A padded substring test
    (newsconfig._hit) would make the marker 'nfl' hit 'inflict' and 'conflict'."""
    return re.search(r"(?<![a-z0-9])%s(?![a-z0-9])" % re.escape(term), text) is not None


# Surnames that are also ordinary English words. A headline may use these with
# no fighter in sight, so they never count towards the two-surname signal.
AMBIGUOUS_SURNAMES = frozenset((
    "green", "hill", "walker", "young", "price", "cross", "stone", "king",
    "moore", "brown", "white", "black", "wood", "fields", "rich", "gray",
    "grey", "may", "bell", "cook", "hall", "ward", "page", "read", "reed",
    "day", "long", "short", "wolf", "fox", "bird", "storm", "rush",
))


def surnames(extra=()):
    """Last token of every roster entry, minus the ordinary-English ones."""
    out = set()
    for full in roster(extra):
        last = full.rsplit(" ", 1)[-1]
        if len(last) > 3 and last not in AMBIGUOUS_SURNAMES:
            out.add(last)
    return out


def has_name(title, extra=()):
    """True when two adjacent capitalised words form a known full name."""
    words = NAME_RE.findall(title or "")
    if len(words) < 2:
        return False
    known = roster(extra)
    for i in range(len(words) - 1):
        if ("%s %s" % (words[i], words[i + 1])).lower() in known:
            return True
    return False


def has_surname_pair(title, extra=()):
    """True when TWO DIFFERENT roster surnames appear. Headline writers drop first
    names once a fighter is famous ("Till Roasts Cormier Over Nurmagomedov
    Defense" - a real story this gate dropped before this signal existed).

    One surname is deliberately not enough: the roster holds Hill, Allen, Smith,
    Jones and Harrison, so a single match would keep "Tyreek Hill wants out of
    Miami". Two distinct ones in a single headline is a fight story. It stays a
    WEAK signal, so an other-sport marker still beats it."""
    known = surnames(extra)
    found = {w.lower() for w in NAME_RE.findall(title or "") if w.lower() in known}
    return len(found) >= 2


def signals(title, desc="", extra=()):
    """Every positive MMA signal that fires, as names. Separate from is_mma() so
    the log can say which one decided, and so a selftest can assert a specific
    signal rather than just the boolean."""
    t = " %s " % ("%s %s" % (title or "", desc or "")).lower()
    out = []
    if any(_has_term(t, p) for p in PROMOTIONS):
        out.append("promotion")
    if any(_has_term(t, m) for m in MMA_TERMS):
        out.append("mma-term")
    if has_name(title, extra):
        out.append("fighter-name")
    if RECORD_RE.search(t):
        out.append("fight-record")
    if has_surname_pair(title, extra):
        out.append("fighter-surnames")
    return out


def other_sport(title, desc=""):
    t = " %s " % ("%s %s" % (title or "", desc or "")).lower()
    for m in OTHER_SPORTS:
        if _has_term(t, m):
            return m
    return ""


def is_mma(title, desc="", trusted=False, extra=()):
    """(keep, reason). `trusted` marks an MMA-only publication.

    Trusted  -> keep unless a hard other-sport marker fires.
    Untrusted-> keep only on a positive MMA signal, and an other-sport marker
                still wins when the only signal is a fighter name (a fighter
                turning up at a football game is not MMA news).
    """
    sig = signals(title, desc, extra)
    marker = other_sport(title, desc)
    if trusted:
        if marker and not sig:
            return False, "other sport (%s)" % marker
        return True, "trusted source"
    if not sig:
        return False, "no MMA signal" + (" (%s)" % marker if marker else "")
    if marker and not (set(sig) - {"fighter-name", "fight-record", "fighter-surnames"}):
        return False, "other sport (%s) with only a weak signal" % marker
    return True, "+".join(sig)


# ---------------------------------------------------------------------------
# Regression corpora, kept beside the lists so a new term and its counter-example
# land in the same diff. Both are verbatim from the live channel.
# ---------------------------------------------------------------------------

# Must be DROPPED when they arrive from an untrusted aggregator.
OFFTOPIC_HEADLINES = (
    "Highlights: Mets at Rays (9/2) Stream of Major League Baseball",
    "What New Ownership Means for Mike Trout and the Angels Stream of Major League Baseball",
    "No. 14 BYU begins Big 12 title chase against Utah Tech",
    "Jimmy Rogers and new-look Iowa State host Southeast Missouri State",
    "Biggest Question for the Broncos This Season Stream of National Football League",
    "Carabao Cup live streams: Watch live soccer games, upcoming schedule",
    "Argentina villain Leandro Paredes hints at international retirement",
    "Singer Jelly Roll cries on Jimmy Kimmel show after Trump-joke backlash",
    "Unranked Teams That Can Crash the CFP: Oklahoma State Stream of NCAA Football",
    "Will No. 3 Georgia Cover -47.5 vs. Tennessee St?",
    "Tyreek Hill wants out of Miami after another sideline outburst",
    "Josh Allen and Micah Parsons headline the NFL season opener",
)

# Must be KEPT even from an untrusted aggregator.
ONTOPIC_HEADLINES = (
    "Khamzat Chimaev calls for fights with Sean Strickland, 3 others for UFC return",
    "Embattled UFC 332 loses main event as Valentina Shevchenko forced out with injury",
    "Bella Mir wants to avoid taking damage like father Frank",
    "Song Yadong breaks silence on Usman Nurmagomedov interaction inside the cage",
    "Anthony Smith's next fight set in Gamebred FC, promotion releases full card",
    "DWCS Season 10, Week 4 results: 5 UFC contracts handed out after night of finishes",
    "Demetrious Johnson breaks down Song Yadong's kill shot on Umar Nurmagomedov",
    "Tom Aspinall facing additional testing ahead of comeback",
    "Meet Liam McCracken: 9-1 fighter hit by a bus 3 years before earning his shot",
    "Dan Hooker admits Salahdine Parnasse would beat him ten times out of ten",
    "Arman Tsarukyan pitches rule change that supports Joe Rogan",
    "OKTAGON co-founder reflects on what went wrong with attempted UK expansion",
    "Chute Boxe pays tribute to late fighter with a walkout tribute",
    "Alex Pereira's 35-year-old sister to fight for a contract on the Contender Series",
    "Till Roasts Cormier Over Nurmagomedov Defense",
)
