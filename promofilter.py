"""Gambling, betting and advertising filter for the news wire.

WHY THIS IS A MODULE AND NOT A KEYWORD LIST
-------------------------------------------
"No betting/gambling/odds content anywhere" is a rule the owner set at the start
of the project (CLAUDE.md section 13). It was implemented as `exclude_keywords`
in newsconfig.json - an owner-editable JSON list - and it failed twice in one
36-hour window (measured Sept 2026):

    "Polymarket Invite Code SBWIRE: $50 Bonus for NFL Week 1, College Football"
    "Will No. 3 Georgia Cover -47.5 vs. Tennessee St?"

Neither headline contains any of the seventeen words in that list. The list was
also *deletable*: `/news keyword remove betting` drops a term and `deep_merge`
replaces a list wholesale, so nothing ever put it back.

So the rule now lives in code. `newsconfig.is_excluded()` calls `is_promo()`
unconditionally and `exclude_keywords` became purely additive - the owner can
add terms, never remove the floor.

MATCHING CONTRACT (stated once, obeyed everywhere in this file)
---------------------------------------------------------------
Callers pass raw text. Every function lowercases exactly once, at the top, and
every pattern below is written in lowercase. Do NOT add an uppercase pattern or
an re.IGNORECASE flag to a pattern that is already lowercase-only - one of the
two would be dead, and a dead detector is invisible in production because its
neighbour still blocks the headline.

Word matching is boundary-safe (`_has_term`, the same three lines as
`scorer._has_term`). A plain substring test would make the deny term "nfl" match
"i-nfl-ict" and "co-nfl-ict", which are ordinary MMA words.

THE NEVER-BLOCK FLOOR
---------------------
An MMA headline may legitimately say "underdog", "stake", "bet", "picks" or
"predictions" - "Underdog stuns champion at UFC 320" is normal fight coverage,
and the project already keeps free prediction polls (they are not gambling).
None of those bare words appears in any pattern here, and SAFE_HEADLINES is a
regression corpus asserting so. Multi-word phrases built on them ("prop bet",
"best bet", "betting odds") still block, which is the point.
"""

import re

# ---------------------------------------------------------------------------
# 1. Brands. Sportsbooks, prediction markets, casinos and affiliate networks.
#    A brand name is the single strongest signal - nobody writes "DraftKings"
#    in an MMA story for a non-gambling reason.
# ---------------------------------------------------------------------------
BRANDS = (
    # prediction markets - Polymarket is what actually got through
    "polymarket", "kalshi", "manifold markets", "predictit",
    # sportsbooks
    "draftkings", "fanduel", "betmgm", "bet365", "caesars sportsbook", "bovada",
    "betrivers", "pointsbet", "unibet", "betway", "bwin", "888sport", "betfair",
    "paddy power", "william hill", "ladbrokes", "sky bet", "betfred",
    "hard rock bet", "espn bet", "fanatics sportsbook", "thescore bet",
    "stake.com", "bc.game", "rollbit", "duelbits", "roobet",
    # daily fantasy / pick-em apps that pay out
    "prizepicks", "underdog fantasy", "sleeper picks", "boom fantasy",
    "monkey knife fight", "parlayplay",
    # affiliate wire tags seen on the junk that reached the channel
    "sbwire", "sportsgrid", "oddschecker", "vegasinsider", "covers.com",
    "action network", "odds shark", "oddsshark",
)

# ---------------------------------------------------------------------------
# 2. Gambling vocabulary. Multi-word wherever a bare word would be ambiguous.
#    Deliberately absent: bet, bets, stake, stakes, underdog, picks, predictions.
# ---------------------------------------------------------------------------
GAMBLING_TERMS = (
    "betting", "bettor", "bettors", "sportsbook", "sportsbooks", "gambling",
    "gambler", "wager", "wagers", "wagering", "parlay", "parlays",
    "same game parlay", "moneyline", "money line", "point spread",
    "against the spread", "cover the spread", "beat the spread", "over/under",
    "over under", "prop bet", "prop bets", "player props", "best bet",
    "best bets", "betting odds", "betting line", "betting lines",
    "betting preview", "betting guide", "betting tips", "odds boost",
    "free bet", "free bets", "risk-free bet", "no sweat bet", "first bet",
    "deposit match", "welcome bonus", "sign-up bonus", "signup bonus",
    "bonus bet", "bonus bets", "promo code", "bonus code", "invite code",
    "referral code", "casino", "slots bonus", "daily fantasy", "dfs",
    "handicapper", "handicapping", "futures odds", "title odds",
    "opening odds", "closing line", "vigorish", "bookmaker", "bookmakers",
    "accumulator", "each-way", "punters",
)

# ---------------------------------------------------------------------------
# 3. Commercial advertising that is not gambling but is still an advert. The
#    Paramount+ subscription push and the FitExpo press release both reached the
#    channel through Google News and Yahoo.
# ---------------------------------------------------------------------------
AD_TERMS = (
    "subscription for", "months of the", "ad-free subscription", "deal of the day",
    "discount code", "coupon code", "limited-time offer", "shop now",
    "buy now", "on sale now", "black friday", "cyber monday", "sponsored content",
    "sponsored by", "advertorial", "press release", "brings its expanding",
    "affiliate link",
)

# ---------------------------------------------------------------------------
# 4. Numeric odds and spreads. This is the class that caught nothing before.
#
#    An American odds price or a point spread is a SIGNED number standing alone:
#    "-47.5", "+3.5", "-110", "+250". Fight records ("12-3"), event numbers
#    ("UFC 332") and weight classes ("125 pounds") do not match, because the sign
#    must start its own token and a weight is guarded by its unit.
#
#    Two independent detectors so neither class rests on a single pattern:
#      SPREAD_RE  - a signed decimal, or a signed 3-4 digit price
#      COVER_RE   - "cover"/"favourite"/"odds" sitting next to a signed number
# ---------------------------------------------------------------------------
SPREAD_RE = re.compile(
    r"(?<![\w.\-])"                      # token start: not mid-word, not "12-3"
    r"[-+]"                              # an explicit sign
    r"(?:\d{1,3}\.\d|\d{3,4})"           # -47.5 / +3.5  or  -110 / +250
    r"(?![\w.])"                         # token end
    r"(?!\s*(?:lb|lbs|pound|pounds|kg|kilo|kilos|%))"   # not a weight cut / percentage
)

COVER_RE = re.compile(
    r"(?<![a-z0-9])"
    r"(?:cover|covers|favorite|favourite|odds|spread|payout|payouts)"
    r"(?![a-z0-9])"
    r"[^.?!]{0,40}?"
    r"(?<![\w.\-])[-+]\d"                # ... followed closely by a signed number
)

# Money-bonus offers: "$50 bonus", "get $200", "up to $1,000", "30 free"
BONUS_RE = re.compile(
    r"(?<![a-z0-9])"
    r"(?:[$£€]\s?\d[\d,]*(?:\.\d+)?\s*(?:bonus|free|credit|credits|back|off)"
    r"|(?:bonus|win|get|claim|score|grab|unlock)\s+(?:up\s+to\s+)?[$£€]\s?\d)"
)

# A promo/invite/referral code offer. Written lowercase because the caller has
# already lowercased. The trailing "code" noun-phrase guard keeps it off
# ordinary prose like "code of conduct".
CODE_RE = re.compile(
    r"(?<![a-z0-9])"
    r"(?:promo|bonus|invite|referral|sign-?up|welcome|discount|coupon)\s+code"
    r"(?![a-z0-9])"
)


def _has_term(text, term):
    """Boundary-safe, case-blind term match on already-lowercased text
    ('dfs' must not hit 'dfsomething'; multi-word terms match as phrases).
    Same three lines as scorer._has_term - copied rather than imported because
    scorer.py deliberately does not import newsconfig (import cycle), and this
    module is a leaf that newsconfig imports."""
    return re.search(r"(?<![a-z0-9])%s(?![a-z0-9])" % re.escape(term), text) is not None


def detectors(text):
    """Return the list of detector names that fire on `text`.

    Exposed separately from is_promo() so the regression suite can assert a
    per-headline detector COUNT. Without that, a detector that silently stops
    matching is invisible: its neighbour still blocks the headline and the test
    still passes. Both real-world offenders must keep tripping at least two.
    """
    t = " %s " % (text or "").lower()
    hits = []
    if any(_has_term(t, b) for b in BRANDS):
        hits.append("brand")
    if any(_has_term(t, g) for g in GAMBLING_TERMS):
        hits.append("gambling-term")
    if any(_has_term(t, a) for a in AD_TERMS):
        hits.append("ad-term")
    if SPREAD_RE.search(t):
        hits.append("spread-number")
    if COVER_RE.search(t):
        hits.append("cover-number")
    if BONUS_RE.search(t):
        hits.append("money-bonus")
    if CODE_RE.search(t):
        hits.append("promo-code")
    return hits


def is_promo(title, desc=""):
    """(blocked, reason). Checks the description too: the 220-char summary ships
    verbatim inside the embed, so a clean headline over betting copy would still
    put gambling text in front of the owner."""
    hits = detectors(title)
    if hits:
        return True, "+".join(hits)
    # The description is checked with the high-confidence detectors only. A bare
    # signed number in body copy is far likelier to be innocent (a fighter's
    # reach, a missed weight) than the same number in a headline.
    d = " %s " % (desc or "").lower()
    for name, hit in (("brand", any(_has_term(d, b) for b in BRANDS)),
                      ("gambling-term", any(_has_term(d, g) for g in GAMBLING_TERMS)),
                      ("promo-code", bool(CODE_RE.search(d))),
                      ("money-bonus", bool(BONUS_RE.search(d)))):
        if hit:
            return True, "desc:" + name
    return False, ""


# ---------------------------------------------------------------------------
# Regression corpora. Consumed by selftest_changes.py; kept beside the patterns
# so a new pattern and its counter-example land in the same diff.
# ---------------------------------------------------------------------------

# Must ALL be blocked. The first three are verbatim from the live channel.
PROMO_HEADLINES = (
    "Polymarket Invite Code SBWIRE: $50 Bonus for NFL Week 1, College Football",
    "Will No. 3 Georgia Cover -47.5 vs. Tennessee St?",
    "Get Two Months of the Paramount+ Premium (Ad-Free) Subscription for $2.99",
    "UFC 332 betting odds: Pereira opens as -250 favorite",
    "Best bets for UFC Paris: three props we like",
    "DraftKings promo code: bet $5, get $200 in bonus bets",
    "PrizePicks promo: how to play UFC 332 player props",
    "Dana White reacts to the closing line movement on the main event",
)

# The two real offenders must each keep tripping at least this many detectors,
# so one pattern silently dying cannot hide behind another.
MIN_DETECTORS = {
    "Polymarket Invite Code SBWIRE: $50 Bonus for NFL Week 1, College Football": 3,
    "Will No. 3 Georgia Cover -47.5 vs. Tennessee St?": 2,
}

# Must ALL survive. Ordinary MMA coverage that brushes the vocabulary.
SAFE_HEADLINES = (
    "Underdog stuns champion at UFC 320",
    "Fans make their picks for the UFC 332 main event",
    "Our staff predictions for UFC Paris",
    "Makhachev puts his legacy at stake in Abu Dhabi",
    "Volkanovski: I would bet on myself every time",
    "Pereira knocks out Ankalaev at UFC 320 to reclaim the belt",
    "Tom Aspinall cleared after additional testing, targets December return",
    "Song Yadong beats Umar Nurmagomedov by split decision",
    "Shevchenko withdraws from UFC 332 with injury",
    "Islam Makhachev misses weight by 1.5 pounds",
    "Jon Jones weighs in at 248 pounds for heavyweight return",
    "Gaethje improves to 26-5 with win over Tsarukyan",
    "Khamzat Chimaev calls out four middleweights for his return",
)

# Bare words that must never, on their own, block a story. Asserted by the
# selftest against every pattern list in this module.
NEVER_BLOCK = ("bet", "bets", "stake", "stakes", "underdog", "pick", "picks",
               "prediction", "predictions", "favorite", "favourite")
