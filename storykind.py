"""What KIND of story a headline is, and which poster templates suit it.

WHY THIS EXISTS (Sept 30 2026)
------------------------------
The owner has twenty code-rendered poster templates (commands_worker/
poster_page.js, /studio/templates) and none of them was ever used on a real
story: every staged post arrived as the one news card. He asked for the latest
news to arrive already applied to the templates. That needs two facts about a
story before anything is rendered: what happened (a booking wants the fight
announcement, a withdrawal wants the two faces with OUT and IN, a quote wants
the quote templates) and who and which event it is about.

This module is the first fact. It is PURE (no network, no clock), std-lib only,
and deterministic, so the news job, the tests and the studio all agree.

HOW IT DECIDES
--------------
Each kind has a list of weighted regex signals. The headline counts in full and
the summary's first sentence counts at a third, because the headline states the
story while the summary wanders into background ("... who last fought at UFC
331 where he knocked out ..."). The highest score wins; a tie goes to the kind
listed EARLIER in PRIORITY, which ranks the kinds by how much a wrong call costs
(calling a title change a mere result loses the belt poster; calling a quote
about a title fight a booking only costs a template choice).

Measured on real headlines from the public state_news.json history (the labels
and numbers are in the [story kind] selftest suite and CLAUDE.md 0r).

WHAT IT RETURNS
---------------
classify() -> {"kind": one of KINDS, "why": the signal that decided it,
               "event": the event reference as written ("UFC 334", "UFC Qatar",
               "" when none), "quote": a quoted phrase lifted from the headline
               or ""}
templates_for(kind) -> the ranked template ids for that kind. The renderer
               filters the list by what data it could load (two fighters, an
               event card, a photo), so a kind's list is a preference, not a
               promise.
"""

import re

KINDS = ("title", "retirement", "injury", "withdrawal", "result", "booking",
         "event", "rankings", "signing", "callout", "other")

# Tie-break order: earlier wins. Also the order KINDS is listed in.
PRIORITY = KINDS

# Template ids live in commands_worker/poster_page.js (TPLS). A selftest pins
# that every id named here exists there, so a renamed template fails CI instead
# of silently rendering nothing.
TEMPLATES = {
    "event":      ["mainevent", "card", "cards", "official", "countdown"],
    "booking":    ["mainevent", "official", "titlecards", "whowins", "gtape", "faceoff"],
    "withdrawal": ["headline", "pop", "titlecards", "photocard"],
    "result":     ["headline", "andnew", "form", "bigstat", "pop"],
    "title":      ["andnew", "headline", "pop", "spotlight"],
    "callout":    ["cutq", "spotlight", "splitq", "photocard", "headline"],
    "retirement": ["resume", "headline", "form", "bigstat"],
    "injury":     ["headline", "pop", "photocard"],
    "rankings":   ["gpotm", "headline", "bigstat", "photocard"],
    "signing":    ["headline", "pop", "resume"],
    "other":      ["photocard", "headline", "spotlight"],
}

SUMMARY_WEIGHT = 1.0 / 3.0

_Q = "\"'‘’“”"


def _rx(p):
    return re.compile(p, re.I)


# (pattern, weight). Weights are on a scale where 3 is "this alone decides it"
# and 1 is "a hint that needs company". Every match is also weighted by WHERE it
# sits: a headline states its main verb early ("Zabit calls Song's KO a lucky
# punch" is about what Zabit said, not the KO), so a signal at the start counts
# up to 1.5x and one at the end 0.6x. Quoted words are taken out before matching
# (a KO inside a quote is somebody talking), and the quote itself is a callout
# signal.
SIGNALS = {
    "title": [
        (_rx(r"\bvacat(e|es|ed|ing)\b"), 4),
        (_rx(r"\bstripped\b|\bstrips\b"), 4),
        (_rx(r"\bnew (undisputed |interim )?champion\b|\bcrowned\b"), 4),
        (_rx(r"\b(become|becomes|became) (the )?(new |undisputed |interim |two-division |double )?champ(ion)?\b"), 4),
        (_rx(r"\b(win|wins|won|claims?|captures?|takes?|seizes?|lifts?) (the )?(vacant |interim |undisputed )?([a-z'-]+ ){0,2}(title|belt|championship|crown)\b"), 3),
        (_rx(r"\binterim (title|belt|champion)\b.*\b(created|awarded|elevated|promoted|set|introduced)\b"), 3),
        (_rx(r"\b(elevated|promoted) to (undisputed|full) champion\b"), 4),
        (_rx(r"\bunif(y|ies|ied|ication)\b"), 2),
        (_rx(r"\band new\b"), 3),
        (_rx(r"\bdethron(e|es|ed)\b"), 3),
        (_rx(r"\b(title|belt) defen[cs]e\b|\bdefends? (the |his |her )?(title|belt)\b|\bretains?\b"), 2),
        (_rx(r"\bsteps? down as (\w+ )?champion\b|\brelinquish(es|ed)?\b|\binaugural title\b|\bnew belt\b"), 4),
    ],
    "retirement": [
        (_rx(r"\bretir(e|es|ed|ing|ement)\b"), 3),
        (_rx(r"\bhangs? up (the |his |her )?gloves\b|\bcalls? it a career\b|\bwalks? away from (the sport|mma|fighting)\b"), 4),
        (_rx(r"\bunretir|\bcomes? out of retirement\b|\bout of retirement\b"), 2),
        (_rx(r"\blast fight\b|\bfinal fight\b|\bfarewell\b"), 1),
    ],
    "injury": [
        (_rx(r"\binjur(y|ies|ed)\b"), 3),
        (_rx(r"\bsurgery\b|\bhospital(ised|ized)?\b|\bmedical (emergency|scare|suspension)\b"), 3),
        (_rx(r"\b(torn|tears?|broken|breaks?|fractured?|ruptured?)\b.{0,20}\b(acl|mcl|knee|hand|foot|leg|arm|orbital|jaw|nose|rib|ribs|shoulder|elbow|ankle|bicep|tendon|meniscus|eye)\b"), 3),
        (_rx(r"\bcollaps(e|es|ed)\b|\bconcussion\b|\bstretcher\b|\bin (the )?icu\b"), 3),
        (_rx(r"\bhealth (update|scare)\b|\brecover(y|ing|s)\b|\brehab\b|\bable to walk\b|\bwalking again\b|\breleased from hospital\b"), 2),
    ],
    "withdrawal": [
        (_rx(r"\bwithdr(aw|aws|awn|ew|awal)\b"), 4),
        (_rx(r"\bpull(s|ed)? out\b|\bforced out\b|\bout of (his |her |their |the )?(ufc )?\d*\s?(fight|bout|clash|contest|matchup|event|main event|co-main|title fight|card)\b"), 4),
        (_rx(r"\boff (the )?(ufc )?\d*\s?(card|event)\b|\bremoved from\b|\bpulled from\b"), 3),
        (_rx(r"\b(scrapped|cancel(l)?ed|called off|falls? (through|apart|off)|postponed|nixed)\b"), 3),
        (_rx(r"\breplac(e|es|ed|ement)\b|\bsteps? in\b|\bstepping in\b|\bnew opponent\b|\bshort[- ]notice\b|\bbackup\b"), 3),
        (_rx(r"\bmiss(es|ed)? weight\b|\bweight miss\b"), 2),
        (_rx(r"\bin jeopardy\b|\bin doubt\b"), 2),
    ],
    "result": [
        (_rx(r"\b(def\.|defeats?|defeated|beats?|beat|bests?|topples?|outpoints?|outlasts?|edges?|edged|dominates?|dominated|upsets?|destroys?|demolish(es)?|toys? with|tears? through|mauls?|batters?|smashes?|stuns?|shocked by)\b"), 3),
        (_rx(r"\b(knocks?|knocked) (out|down)\b|\bkos?\b|\bko'?s\b|\bko'd\b|\btkos?\b|\bknockout\b|\bstops?\b|\bstopped\b|\bfinish(es|ed)?\b|\bflatten(s|ed)?\b|\bsparks?\b|\bslept\b|\bsleeps\b"), 3),
        (_rx(r"\bsubmi(ts|tted|ssion win)\b|\bsubmission of\b|\bchokes? out\b|\bchoked out\b|\btaps? out\b|\btaps\b|\btapped\b|\barmbar(s|red)?\b|\bguillotin(e|es|ed)\b|\bchoke finish\b"), 3),
        (_rx(r"\b(split|unanimous|majority) decision\b|\bdecision win\b|\bwins? (by|via)\b|\bdraw\b|\bno contest\b"), 3),
        (_rx(r"\b(wins|won|victory|victorious|triumphs?|prevails?|remains unbeaten|stays unbeaten|improves to|win column|win streak|drought|comeback)\b"), 2),
        (_rx(r"\bbonus(es)?\b|\bperformance of the night\b|\bfight of the night\b|\bpayouts?\b"), 3),
        (_rx(r"\bresults?\b|\bhighlights?\b|\bscorecards?\b|\bfull fight\b|\bfree fight\b|\blive blog\b|\bmorning after\b|\bpost show\b|\babout last night\b|\brecap\b"), 3),
        (_rx(r"\b(loses|lost|suffers|suffered) (to|a|an|his|her|another|first|third)\b|\blosing streak\b|\bsnaps?\b|\bperfect record ends\b|\bupset\b"), 2),
    ],
    "booking": [
        (_rx(r"\b(booked|books|targeted for|finalized for|confirmed for|official for|agreed|agree to|in the works|in talks|being targeted|lined up|verbally agreed)\b"), 3),
        (_rx(r"\bset (for|to) (face|fight|meet|headline|clash|rematch|collide|battle|square off)\b|\bset for (a )?(rematch|showdown|clash|title fight|bout|fight)\b"), 3),
        (_rx(r"\bset for (ufc|the|a|bkfc|pfl) .{0,40}\b(main event|co-main|card)\b"), 3),
        (_rx(r"\b(to|will) (face|fight|meet|take on|battle|clash with|square off|rematch|headline)\b"), 3),
        (_rx(r"\b(faces?|meets?|takes on|battles?|rematch(es)?|tests? (himself|herself) against) [A-Z]"), 2),
        (_rx(r"\bvs\.?\b|\bversus\b"), 1),
        (_rx(r"\bheadlin(e|es|ing)\b|\bco-main\b"), 2),
        (_rx(r"\breturns? (against|to face|vs\.?)\b|\bnew fight\b|\bnext fight (set|booked|confirmed)\b"), 2),
        (_rx(r"\badded to\b|\bjoins (the )?(ufc )?\d*\s?card\b|\bbout (announced|added|set)\b|\bfight (announced|added|set|made|official)\b|\bset for (ufc )?(debut|return)\b"), 3),
    ],
    "event": [
        (_rx(r"\b(card|lineup|line-up) (announced|revealed|set|finalized|finalised|official|complete|takes shape|confirmed|update)\b|\bupdates? to\b"), 4),
        (_rx(r"\b(full|entire|complete) (fight )?card\b|\bfight card\b|\bmain card\b|\bprelims?\b|\bstart time\b|\bhow to watch\b|\bwhere to watch\b"), 3),
        (_rx(r"\b(announces?|announced|confirms?|confirmed|unveils?|reveals?|revealed|schedules?|scheduled) (date|venue|location|return|event|card|events|schedule)\b"), 3),
        (_rx(r"\bfight week\b|\bmedia day\b|\bpress conference\b|\bweigh-?ins?\b|\bweighs in\b|\bmake weight\b|\bmakes weight\b|\bfaceoffs?\b|\bstaredowns?\b|\bembedded\b|\bcountdown\b|\bpreview\b"), 3),
        (_rx(r"\b(attendance|gate|sold out|sellout|tickets?|broadcast|paramount|ppv|pay-per-view|viewership|mega event)\b"), 2),
        (_rx(r"\bevent (announced|set|confirmed|official|moved|relocated)\b|\bofficially announced\b|\b(heads?|heading|returns?|going) to (abu dhabi|qatar|doha|paris|london|perth|sydney|toronto|mexico|brazil|rio|madison square garden|new york|las vegas|saudi|riyadh|macau|shanghai|singapore|tokyo|australia|canada|the white house|baku|manchester|dublin|prague|belgrade)\b"), 3),
    ],
    "rankings": [
        (_rx(r"\branking(s)?\b"), 4),
        (_rx(r"\bp4p\b|\bpound[- ]for[- ]pound\b"), 3),
        (_rx(r"\b(moves?|climbs?|jumps?|drops?|falls?|rises?) (up |down )?(to )?(no\.|#|number) ?\d+\b"), 3),
    ],
    "signing": [
        (_rx(r"\b(signs?|signed|re-signs?|re-signed|inks?|inked)\b"), 3),
        (_rx(r"\b(contract|extension|free agen(t|cy)|multi-fight|exclusive deal)\b"), 2),
        (_rx(r"\b(released|cut) (by|from)\b|\bparts ways\b|\bleaves? the ufc\b|\bdeparts?\b"), 3),
        (_rx(r"\b(joins|debut with) (the )?(ufc|pfl|one|bellator|rizin|bkfc|gfl)\b"), 2),
    ],
    "callout": [
        (_rx(r"\b(says?|said|reveals?|explains?|claims?|admits?|insists?|believes?|thinks?|feels?|predicts?|responds?|reacts?|reaction|weighs in|opens up|speaks out|sounds off|warns?|vows?|promises?|guarantees?|doubts?|questions?|dismisses?|shuts down|denies|laughs off|jokes?|teases?|hints?|hopes?|wants?|demands?|urges?|asks?|tells?|praises?|defends?|criticizes?|criticises?|slams?|outlines?|details|comments?|breaks silence|sends? (a |an )?(\w+ )?message|dreads?|touted|eager|rejects?|refuses?|apologi[sz]es?|thanks?|changes tone|provides|offers|shares|trade jabs|disagrees?|agrees?|confirms he|confirms she|is sure|is confident|expects?|plans?|considering|considers?|open to|not interested|mocks?|brushes off|fires? shots?|takes (a )?(brutal )?dig|dig at|pick for|picks?|prediction|calls|labels|dubs|brands)\b"), 2),
        (_rx(r"\bcalls? (out|for)\b|\bfires? back\b|\b(blasts?|rips?|trolls?|taunts?|disses?|torches?|goes off on|takes aim at|lashes out|hits back|claps back|trash[- ]talk|reignites?|feud|beef|war of words|spat)\b"), 3),
        (_rx(r"\b(interview|podcast|q&a|exclusive|statement|message|theory)\b"), 1),
        (_rx(r"^[A-Z][^:]{2,50} on (why|how|what|his|her|training|the|fighting|being|facing|life|a|an)\b|^[A-Z][A-Za-z'. -]{2,40}\bon [A-Z]"), 2),
        (_rx(r"^(?!(watch|video|report|breaking|exclusive|highlights|results|photos|poll|opinion|update|live|just in)\b)[A-Z][A-Za-z'. -]{2,40}:\s+[A-Z]"), 3),
        (_rx(r"\beyes?\b|\bwants? [A-Z]\b|\bnext\b"), 1),
    ],
    "other": [
        (_rx(r"\bodds\b|\bbetting\b|\bpromos?\b|\bfights to make\b|\bby the numbers\b|\bnumbers behind\b|\bstats\b|\bopen thread\b|\btrivia\b|\bin-5\b|\bstream of\b|\bnewsletter\b|\bauction\b|\bthings to know\b|\bwho is\b|\bthrowback\b"), 4),
        (_rx(r"\b(suspend(ed|s)?|suspension|usada|drug test|failed test|tested positive|banned|arrest(ed)?|charged|lawsuit|court|sentenced|prison|jail|bankruptcy|debt)\b"), 3),
        (_rx(r"\b(nfl|nba|mlb|nhl|ncaa|premier league|la liga|serie a|champions league|golf|wwe|aew|formula 1|f1|grand prix|football league|basketball|baseball|soccer|chelsea|real madrid)\b"), 5),
        (_rx(r"\b(tribute|mourns?|dies|died|passes away|passed away|funeral|robot|simulation|video game|ea sports)\b"), 3),
    ],
}

# Headline openers that name what the piece IS before the story starts
# ("UFC Paris video:", "Highlights!", "UFC 331 results:"). They decide on their own.
LEAD_KIND = [
    (_rx(r"^(highlights|bonuses)\b|^[^:]{0,40}\b(results|video|full fight|free fight|live blog|scorecards|highlights|post show|the morning after)\s*[:!|-]"), "result"),
    (_rx(r"^[^:]{0,40}\b(preview|embedded|fight card|start time|weigh[- ]?ins?|press conference|faceoffs)\s*[:!|-]"), "event"),
    (_rx(r"^[^:]{0,40}\brankings?\s*[:!|-]"), "rankings"),
    (_rx(r"^(prediction|picks?)\b"), "callout"),
    (_rx(r"^open thread\b|^in-5\b|^(watch|video): (human|robot)"), "other"),
]
POSITION_SPAN = (1.5, 0.6)     # the weight at the first and at the last character


def _first_sentence(desc):
    s = " ".join(str(desc or "").split())
    m = re.search(r"[.!?](\s|$)", s)
    return s[: m.start() + 1] if m else s[:240]


def _unquote(t):
    """t with every quoted span blanked to spaces (same length, so positions hold),
    and whether a real quote (two words or more) was there."""
    out, had = list(t), False
    for a, b in _quote_spans(t):
        if len(t[a + 1:b].split()) >= 2:
            had = True
        for i in range(a, b + 1):
            out[i] = " "
    return "".join(out), had


def _score(text):
    out = {k: 0.0 for k in KINDS}
    why = {}
    if not text:
        return out, why
    plain, quoted = _unquote(text)
    n = max(1, len(plain))
    hi, lo = POSITION_SPAN
    for kind, sigs in SIGNALS.items():
        for rx, w in sigs:
            best = 0.0
            for m in rx.finditer(plain):
                f = hi - (hi - lo) * (m.start() / n)
                if w * f > best:
                    best = w * f
                    why.setdefault(kind, m.group(0).strip())
            out[kind] += best
    if quoted:
        out["callout"] += 2.0
        why.setdefault("callout", "a quote")
    for rx, kind in LEAD_KIND:
        m = rx.search(plain)
        if m:
            out[kind] += 4.0
            why[kind] = m.group(0).strip()[:40]
            break
    return out, why


EVENT_RE = re.compile(
    r"\b(UFC(?:\s+Fight\s+Night)?\s*\d{2,4}"
    r"|UFC\s+(?:Vegas|Apex|Fight\s+Night|on\s+(?:ESPN|ABC|Fox|Paramount\+?|CBS))\s*\d*"
    r"|Noche\s+UFC"
    r"|UFC\s+(?!Fight\b|Hall\b|Performance\b|President\b|Champion\b|Rankings?\b|Star\b|Veteran\b|Legend\b|Fighter\b|Record\b|Debut\b|Title\b|Contract\b|Return\b|History\b|Heavyweight\b|Light\b|Lightweight\b|Middleweight\b|Welterweight\b|Featherweight\b|Bantamweight\b|Flyweight\b|Strawweight\b|Women|Men|BJJ\b|Fight\s+Pass\b|Apex\b|Vegas\b|on\b)[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?"
    r"|(?:PFL|Bellator|ONE|RAF|BKFC|Rizin|Cage\s+Warriors|LFA|Oktagon|KSW)\s*[A-Z0-9][A-Za-z0-9]*)")


def event_ref(text):
    """The event as written in a headline, or "". 'UFC 334', 'UFC Qatar',
    'UFC Fight Night 260', 'Noche UFC', 'PFL 5'. Pure."""
    m = EVENT_RE.search(str(text or ""))
    return " ".join(m.group(1).split()) if m else ""


def _quote_spans(t):
    """(open, close) index pairs of every quoted span in t. A quote mark OPENS
    only where the character on its left is not a letter or digit, and CLOSES
    only where the character on its right is not a letter, so the apostrophes
    in "We're" and "Makhachev's" are never taken for quote marks. Pure."""
    out, i, n = [], 0, len(t)
    while i < n:
        if t[i] in _Q and (i == 0 or not t[i - 1].isalnum()):
            j = i + 1
            while j < n:
                if t[j] in _Q and (j + 1 >= n or not t[j + 1].isalpha()) and j > i + 1:
                    break
                j += 1
            if j < n:
                out.append((i, j))
                i = j + 1
                continue
        i += 1
    return out


def _quotes(t):
    """Every quoted span's text. Pure."""
    return [t[a + 1:b].strip() for a, b in _quote_spans(t)]


def quote_in(title):
    """The longest quoted phrase (two words or more) in a headline, or "".
    Pure."""
    best = ""
    for q in _quotes(str(title or "")):
        if len(q.split()) >= 2 and 6 <= len(q) <= 160 and len(q) > len(best):
            best = q
    return best


# ---- who the story is about ---------------------------------------------------
# A letter the Unicode NFD split cannot reduce to ASCII (it is its own letter,
# not a letter plus an accent). ufc.com writes these as their plain look-alike:
# Jan Blachowicz is /athlete/jan-blachowicz. poster_page.js slugify carries the
# same table by character code, pinned by shared vectors in both suites.
SLUG_FOLD = {0x0142: "l", 0x0141: "l", 0x00f8: "o", 0x00d8: "o", 0x00df: "ss",
             0x00e6: "ae", 0x00c6: "ae", 0x0111: "d", 0x0110: "d", 0x0131: "i",
             0x00f0: "d", 0x00fe: "th", 0x0153: "oe", 0x0152: "oe"}


def ufc_slug(name):
    """A person's ufc.com athlete slug, the same way poster_page.js slugify
    builds it: lower case, accents dropped, the letters in SLUG_FOLD folded,
    runs of space / hyphen / underscore to one dash, anything else dropped,
    at most 60 characters. Pure."""
    import unicodedata
    s = "".join(SLUG_FOLD.get(ord(c), c) for c in str(name or "").lower())
    s = unicodedata.normalize("NFD", s)
    out, dash = [], False
    for c in s:
        if ("a" <= c <= "z") or ("0" <= c <= "9"):
            out.append(c)
            dash = False
        elif c in " -_":
            if not dash and out:
                out.append("-")
                dash = True
    while out and out[-1] == "-":
        out.pop()
    return "".join(out)[:60]


_ROSTER = []


def roster():
    """Full names from mma_roster.json (one read per process), or []."""
    if not _ROSTER:
        try:
            import json
            import os
            p = os.path.join(os.path.dirname(os.path.abspath(__file__)), "mma_roster.json")
            with open(p, encoding="utf-8") as f:
                _ROSTER.append([str(n) for n in (json.load(f).get("fighters") or []) if n])
        except Exception:
            _ROSTER.append([])
    return _ROSTER[0]


def _fold(s):
    """Lower case with accents and SLUG_FOLD letters reduced, for matching. Pure."""
    import unicodedata
    s = "".join(SLUG_FOLD.get(ord(c), c) for c in str(s or "").lower().replace("’", "'"))
    return "".join(c for c in unicodedata.normalize("NFD", s) if not unicodedata.combining(c))


# Surnames too common to expand from a bare mention (see people(), step 3).
COMMON_SURNAMES = frozenset("""johnson smith jones brown williams hill allen walker lewis turner
green harrison taylor moore martin thompson white clark young king wright scott adams baker nelson
hall rodriguez garcia martinez hernandez lopez gonzalez perez sanchez ramirez torres flores rivera
silva santos oliveira costa souza pereira lima ferreira alves gomes ribeiro almeida carvalho
rocha barbosa lee kim park wang zhang li chen davis miller wilson anderson thomas jackson harris
robinson lewis evans edwards collins stewart morris murphy cook rogers morgan cooper peterson""".split())

# Capitalised tokens that start a two-word run but are never a first name.
_NOT_FIRST = frozenset("""ufc pfl one bkfc rizin bellator lfa ksw raf gfl dwcs tuf noche fight night
the a an this that why how what when where who breaking report watch video exclusive new former
ex interim undisputed champion champ legend star veteran coach teammate rival boss president
dana""".split())
_NAME_TOKEN = re.compile("^[A-ZÀ-ÞĀ-ſ][a-zß-ÿĀ-ſ'’-]+$")
_PARTICLES = frozenset(("de", "da", "dos", "do", "du", "van", "von", "della", "del", "la", "le",
                        "st.", "al", "el", "bin", "ibn", "machado", "saint"))


def _headline_word(w):
    try:
        import scorer
        words = scorer.HEADLINE_WORDS
    except Exception:
        words = frozenset()
    b = _fold(w).strip("'-")
    if b.endswith("'s"):
        b = b[:-2]
    return b in words or b in _NOT_FIRST


def _title_case(t):
    """A Headline Styled Title, where a capital no longer marks a name. Judged on the
    ordinary words (headline vocabulary) when there are enough of them: a headline
    that is mostly NAMES ("Deiveson Figueiredo vs. Payton Talbott set to headline
    UFC 332") is sentence case, and its lowercase "set" and "headline" say so."""
    words = [w for w in re.findall("[A-Za-zÀ-ſ'-]+", t or "") if len(w) >= 3]
    plain = [w for w in words if _headline_word(w)]
    if len(plain) >= 2:
        return sum(1 for w in plain if w[0].isupper()) >= 0.7 * len(plain)
    words = [w for w in words if len(w) >= 4]
    return len(words) >= 4 and sum(1 for w in words if w[0].isupper()) >= 0.7 * len(words)


def people(title, desc="", names=None, limit=4):
    """Who the story is about, first-named first: [{"name", "slug"}], where
    slug is present only for a FULL name (a first name and a surname). A bare
    surname the roster knows exactly once is expanded to that full name; any
    other bare surname is kept without a slug, and the renderer resolves it
    against the event card it loads. `names` overrides the roster (tests).
    Pure given `names`."""
    t = " ".join(str(title or "").split())
    ft = _fold(t)
    found = []            # (position, full name or surname, has_full)
    taken = []            # spans already claimed in ft

    def claim(a, b):
        if any(a < y and x < b for x, y in taken):
            return False
        taken.append((a, b))
        return True

    # the event reference is never a person ("UFC Qatar", "UFC Prague")
    em = EVENT_RE.search(t)
    if em:
        claim(em.start(), em.end())
    full = list(names if names is not None else roster())
    by_last = {}
    for n in full:
        parts = n.split()
        if len(parts) >= 2:
            by_last.setdefault(_fold(parts[-1]), set()).add(n)
    # 1. roster full names, longest first so "Ian Machado Garry" beats "Ian Garry"
    for n in sorted(full, key=len, reverse=True):
        fn = _fold(n)
        m = re.search(r"(?<![a-z0-9])" + re.escape(fn) + r"(?![a-z0-9])", ft)
        if m and claim(m.start(), m.end()):
            found.append((m.start(), n, True))
    # 2. capitalised two- or three-word runs outside Title Case headlines
    if not _title_case(t):
        toks = [(m.start(), m.end(), m.group(0)) for m in re.finditer(r"[^\s,;:!?()\[\]\"“”]+", t)]
        i = 0
        while i < len(toks):
            run = []
            j = i
            while j < len(toks):
                w = toks[j][2].rstrip(".")
                bare = w[:-2] if w.lower().endswith(("'s", "’s")) else w
                if _NAME_TOKEN.match(bare) and not (len(run) == 0 and _headline_word(bare)):
                    run.append((toks[j][0], toks[j][1], bare))
                    j += 1
                    if bare != w:
                        break
                elif run and w.lower() in _PARTICLES and j + 1 < len(toks):
                    run.append((toks[j][0], toks[j][1], w))
                    j += 1
                else:
                    break
            while run and (_headline_word(run[-1][2]) or run[-1][2].lower() in _PARTICLES):
                run.pop()
            if len(run) >= 2 and not _headline_word(run[0][2]):
                run = run[:3]
                a, b = run[0][0], run[-1][1]
                name = " ".join(r[2] for r in run)
                if claim(a, b):
                    found.append((a, name, True))
                i = j if j > i else i + 1
            else:
                i += 1
    # 3. bare surnames the roster knows. A surname shared by many people
    # (Johnson, Silva, Hill) is never expanded: "Johnson gets new opponent" was
    # read as Demetrious Johnson, the only Johnson in the roster, about a
    # different Johnson. It stays bare and the renderer matches it against the
    # event card, which knows who is actually on it.
    for last, ns in by_last.items():
        for m in re.finditer(r"(?<![a-z0-9])" + re.escape(last) + r"(?:'s)?(?![a-z0-9])", ft):
            if not claim(m.start(), m.end()):
                continue
            if len(ns) == 1 and last not in COMMON_SURNAMES:
                found.append((m.start(), next(iter(ns)), True))
            else:
                found.append((m.start(), t[m.start():m.start() + len(last)], False))
    # 4. any other capitalised word that is not headline vocabulary: a surname
    # the roster does not know yet ("Susurkaev withdraws"). Bare, no slug.
    if not _title_case(t):
        for m in re.finditer(r"[A-ZÀ-ÞĀ-ſ][a-zß-ÿĀ-ſ'’-]{3,}", t):
            w = m.group(0)
            bare = re.sub("['’]s$", "", w)
            if len(bare) < 4 or _headline_word(bare) or not claim(m.start(), m.start() + len(bare)):
                continue
            found.append((m.start(), bare, False))
    found.sort()
    out, seen = [], set()
    for _pos, name, has_full in found:
        key = _fold(name.split()[-1])
        if key in seen:
            continue
        seen.add(key)
        item = {"name": name}
        if has_full and len(name.split()) >= 2:
            item["slug"] = ufc_slug(name)
        out.append(item)
        if len(out) >= limit:
            break
    return out


def classify(title, desc=""):
    """Pure. See the module docstring."""
    t = " ".join(str(title or "").split())
    s = _first_sentence(desc)
    head, why = _score(t)
    body, why_b = _score(s) if s else ({k: 0.0 for k in KINDS}, {})
    total = {k: head[k] + SUMMARY_WEIGHT * body[k] for k in KINDS}
    # an injury that takes a fighter off a card is a WITHDRAWAL story: the bout is what
    # changed, and the withdrawal templates show both sides of it
    if total["withdrawal"] >= 2.5 and total["injury"] > 0:
        total["withdrawal"] += 2.0
    best = max(total.values())
    if best < 1.5:
        kind = "other"
    else:
        kind = next(k for k in PRIORITY if total[k] == best)
    return {"kind": kind,
            "why": why.get(kind) or why_b.get(kind) or "",
            "event": event_ref(t) or event_ref(s),
            "quote": quote_in(t)}


def templates_for(kind):
    """Ranked template ids for a kind (a copy, safe to edit). Pure."""
    return list(TEMPLATES.get(kind) or TEMPLATES["other"])


def story(title, desc="", kind=""):
    """Everything the staged spec fence carries about a story for the templates:
    {"kind", "templates", "people", "event", "quote"}. `kind` is the AI scorer's
    answer when it gave one (scorer._parse_kind): it wins, because the model
    reads the story; classify() is the fallback when there is no model, no
    budget left or no valid answer. Pure given the roster."""
    c = classify(title, desc)
    if kind in KINDS:
        c["kind"] = kind
    return {"kind": c["kind"], "templates": templates_for(c["kind"]),
            "people": people(title, desc), "event": c["event"], "quote": c["quote"]}


# ---- the editor's concept (Oct 3 2026) ----------------------------------------
# The AI desk (scorer.parse_desk) designs the graphic: a concept, the person it is
# about and the people beside him with a role each. A concept picks its templates
# first; the kind's list follows as the fallback. Every id here must exist in
# commands_worker/poster_page.js (a selftest pins it).
CONCEPT_TEMPLATES = {
    "crossout": ["crossout", "gcross", "cutq", "headline"],
    "rank":     ["gpotm", "headline", "photocard"],
    "versus":   ["official", "faceoff", "whowins", "gtape", "titlecards", "mainevent"],
    "quote":    ["cutq", "spotlight", "splitq", "photocard", "headline"],
    "title":    ["andnew", "gpotm", "titlecards", "headline"],
    "result":   ["andnew", "gpotm", "headline", "form"],
    "photo":    ["photocard", "headline", "spotlight"],
}
# which people a concept shows beside the subject, in this order (a crossout
# crosses out only the ruled-out; nobody "mentioned" ever takes a circle)
CONCEPT_ROLES = {
    "crossout": ("ruled_out",),
    "rank": ("ranked_below", "target", "opponent"),
    "versus": ("opponent", "target"),
    "quote": ("target", "opponent", "ruled_out"),
    "title": ("opponent",),
    "result": ("opponent",),
    "photo": ("opponent", "target"),
}


def resolve_person(name, names=None):
    """The AI's name for somebody -> {"name", "slug"} (slug only for a full
    name). The roster's spelling wins, and of two roster names with the same
    first and last name the LONGER one, which is ufc.com's ("Ian Garry" is the
    athlete page ian-machado-garry). A bare surname the roster knows once is
    expanded; any other bare surname keeps no slug. Pure given `names`."""
    nm = " ".join(str(name or "").split())
    if not nm:
        return None
    full = list(names if names is not None else roster())
    parts = _fold(nm).split()
    if len(parts) >= 2:
        hits = [n for n in full if _fold(n).split()[:1] == parts[:1] and _fold(n).split()[-1:] == parts[-1:]]
        if hits:
            best = sorted(hits, key=len)[-1]
            return {"name": best, "slug": ufc_slug(best)}
        return {"name": nm, "slug": ufc_slug(nm)}
    hits = [n for n in full if _fold(n).split()[-1:] == parts and _fold(nm) not in COMMON_SURNAMES]
    if len(set(hits)) == 1:
        return {"name": hits[0], "slug": ufc_slug(hits[0])}
    return {"name": nm}


def concept_story(title, desc="", kind="", concept="", main="", others=None,
                  big="", label="", quote="", names=None):
    """story() shaped by the editor's concept: the concept's templates first,
    the people in poster order - the subject, then the people the concept shows
    beside him (each with its role) - and the concept, big word and banner label
    for the templates page. With no usable concept or subject this is story()
    itself plus empty concept fields. Pure given `names`."""
    base = story(title, desc, kind=kind)
    base.update({"concept": "", "big": "", "label": ""})
    if concept not in CONCEPT_TEMPLATES or not str(main or "").strip():
        return base
    lead = resolve_person(main, names)
    if not lead:
        return base
    ppl = [dict(lead, role="main")]
    want = CONCEPT_ROLES.get(concept, ())
    for role in want:
        for o in (others or []):
            if not isinstance(o, dict) or o.get("role") != role:
                continue
            p = resolve_person(o.get("name"), names)
            if not p or any(_fold(q["name"]) == _fold(p["name"]) for q in ppl):
                continue
            ppl.append(dict(p, role=role))
    tpls = list(CONCEPT_TEMPLATES[concept])
    tpls += [t for t in base["templates"] if t not in tpls]
    base.update({"templates": tpls[:8], "people": ppl[:4], "concept": concept,
                 "big": str(big or "")[:18], "label": str(label or "")[:30]})
    if quote:
        base["quote"] = str(quote)[:200]
    return base

