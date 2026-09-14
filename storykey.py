"""storykey.py - one story, one post.

The news wire polls ten sources.  When Tom Aspinall vacated the UFC heavyweight
title, ELEVEN near-identical posts landed in 45 minutes from Yahoo, Bloody
Elbow, MMA Fighting, NDTV, LowKickMMA, talkSPORT, the Times of India and
others.  The owner's rule: post each STORY once, the first outlet to break it
wins, the rewrites are dropped.

WHAT THIS REPLACES
------------------
`newsconfig.similar()`: token-Jaccard over lowercased title words at 0.6,
against a 48-hour list.  Measured on two posts about the identical story:

    "Tom Aspinall vacates UFC heavyweight title in bombshell statement as eye
     issues continue"
    "Why Did Tom Aspinall Vacate UFC Heavyweight Title? 33-Year-Old Reveals
     Absolute Nightmare"
    -> 0.22.  And "vacates" vs "vacate" do not even match: no stemming.

That function stays where it is (it is cheap, and the digest path uses it);
this module is the story-level filter news_bot consults first.

PUBLIC API
----------
    story_key(title, cfg)                          -> a comparable signature
    is_duplicate(title, source, when, recent, cfg) -> (bool, reason)
    remember(recent, title, source, when, cluster=None, cfg=None)
    validate_dedupe_cfg(cfg)                       -> list of complaints

Standard library only.  Pure and deterministic: "now" is the `when` argument,
nothing reads the clock, nothing touches the network, `recent` is only mutated
by `remember()`.  Every threshold lives in DEFAULTS and is overridable from
newsconfig under the "dedupe" key, so tuning needs no code change.

HOW IT DECIDES - a cascade of cheap tests, then four weak signals that vote
---------------------------------------------------------------------------
  0. time window        nothing older than max_age_hours is even a candidate
                        (plus a much longer memory for a byte-identical repost)
  1. vetoes             a different card, a different date, a different KIND of
                        news, a proposal vs the event it proposes, a reaction
                        vs the event it reacts to, a rolling live-blog or a
                        how-to-watch page vs an actual story, or a changed
                        headline subject.  Any one of these refuses the merge
                        no matter how high the similarity climbs.
  2. evidence gates     a shared rare token, and enough absolute shared IDF
                        mass to be worth measuring at all
  3. four scored signals  IDF-weighted rare-token overlap, shared people,
                        character 4-grams, shared event class
  4. vote + weighted score against a bar that RISES with the time gap
  5. cluster anchor     the candidate must also resemble the story's FIRST
                        post, not merely the last thing that joined it

LOAD-BEARING DESIGN RULES - do not undo these by accident
---------------------------------------------------------
* The FIRST post of a story always survives.  This is an online filter: it
  refuses the copy in hand, it never retracts what is already in Discord.
* A DROPPED DISTINCT STORY is the failure the owner notices; a missed duplicate
  is an annoyance.  Thresholds are tuned for precision and the vetoes outrank
  the score.
* WHO a story is about is kept strictly out of WHAT happened.  Names are
  excluded from the IDF bag and from the n-gram text, so the four signals
  measure four different things instead of four echoes of the name overlap.
  Measured: with names left in, "Ryan Garcia vs. Conor Benn weigh-in video" and
  "Ryan Garcia blocks Conor Benn from using larger gloves if he misses weight"
  scored rare 0.62 / chars 0.59 purely because four of seven tokens were the
  two men's names.  Decontaminated they score near zero and stay two stories.
* Nothing depends on the roster being complete.  `bots_github/mma_roster.json`
  holds 241 names and is measurably missing Hokit, Van, Ruffy and Prates, so it
  is one hint among several: names are LEARNED from the rolling window itself
  (a token seen capitalised and never seen lowercase is a name, whoever it is).
  Measured on the 600-post corpus, turning the roster off changes the drop
  count by two posts and costs no distinct story.

THE THREE FAILURES OF THE ORIGINAL PROTOTYPE (signature = roster surnames +
stemmed event verb, grouped by EXACT tuple equality, unbounded window)
--------------------------------------------------------------------------
(a) EXACT TUPLE EQUALITY SPLIT ONE STORY INTO THREE, because (aspinall,vacate),
    (aspinall,injury+vacate) and (aspinall,announce+vacate) are different
    tuples.  Fixed: matching is OVERLAP - shared people, shared class, weighted
    token overlap - and never tuple equality.  `story_key()` exists for logging
    and bucketing; the DECISION never compares two keys for equality.
(b) NO TIME WINDOW merged "UFC could urge Aspinall to vacate" (Sept 13 09:48)
    with "Aspinall vacates" (Sept 14 12:16) - 27 hours apart, two different
    events - and ran a Poirier cluster 45 hours from "new bodycam footage" to
    "sobriety update".  Fixed: max_age_hours bounds every comparison, the score
    bar RISES with the gap, and a candidate must still resemble the cluster's
    FIRST post (anchor_ratio) so a chain of small steps cannot walk a cluster
    onto a different story.
(c) THE ROSTER WAS TOO THIN to carry the name signal alone.  Fixed by the
    self-taught lexicon above.

MEASURED ON THE 600-POST REPLAY (2026-09-10 18:15 .. 2026-09-14 13:00)
----------------------------------------------------------------------
600 posts in, 534 kept, 66 dropped, 43 stories absorbed at least one copy.
The existing `newsconfig.similar()` at 0.6 over 48h drops 5 of the same 600.
Largest collapse: the TWELVE Aspinall vacating posts of Sept 14 12:16-12:45
become ONE - Bloody Elbow, the outlet that broke it - and eight outlets
(MMA Fighting, Yahoo x5, the Times of India, the Daily Mail, LowKickMMA, the
New York Times, NDTV) are refused.  The distinct Aspinall stories of the same
45 minutes all survive: the "unluckiest fighter" sidebar, the Dana White
title-reign piece, the Lente Desportiva stripping rehash and the Josh Hokit
reaction.  Cost: 11.0 ms per story over the whole replay, no network, no I/O
beyond one optional roster read.

Zero of the drops the blind judges called WRONG on the previous revision
survive.  Each is refused by a NAMED veto and pinned by a selftest: the
Moreno presser quote (modal-vs-event), the Martinez/Ige result eaten by
"UFC Fight Night 288 Results (Live)" (container-vs-story), the Forbes
how-to-watch listing (service-vs-story), the Bloody Elbow archive piece on
what Aspinall said months earlier (archive-vs-story), the Garcia/Benn glove
ruling and crybaby quote and the three "What AI Predicted and What Happened"
recaps (all now kept), and the Tsarukyan/Ruffy Countdown video (event-number).

Recall moved with it.  Families the judges listed as MISSED on the previous
revision and that this module now collapses: Ngannou "bad guy" and "take that
loss" (4 copies), Fiorot/Grasso title-eliminator, the Gantt/Klose triangle
(2), Bahamondes/Salikhov, Grasso/Fiorot result (2), the McMillen bonus, the
De La Hoya denial, both Poirier bodycam copies, Bilal Hasan, Gaethje/
Tsarukyan, Aljamain Sterling, Cejudo/Aspinall, the Silva main-event result
(3), "biggest winners, losers", the Makhachev/Jones streak, both lboro.ac.uk
pirate-stream spams, and the Chimaev break (2).  Independent residual check:
kept-vs-kept pairs inside 12 hours at token-Jaccard >= 0.45 fall from 49 on
the previous revision to 29 here, and on inspection most of the 29 are
correct keeps - per-fight template pages for DIFFERENT fights on one card.

The roster is a hint, not a dependency: turning it off gives 533 kept / 67
dropped, and the one extra drop is a distinct story ("Waldo Cortes-Acosta Vs.
Curtis Blaydes: What AI Predicted and What Happened"), so it ships ON.

JUDGEMENT CALLS, MADE ON THE CORPUS AND APPLIED CONSISTENTLY
------------------------------------------------------------
1. A REACTION OR FOLLOW-UP QUOTE IS ITS OWN STORY.  "Josh Hokit demands title
   fight as he reacts to Tom Aspinall's relinquishing his heavyweight belt"
   shares a name, a verb and a time slot with the vacating story and is NOT a
   copy of it: three outlets covered Hokit's callout inside twelve minutes,
   which is what a story looks like.  The same rule protects "Brandon Moreno
   surprised by split decision scoring in Noche UFC win: 'What the f*ck?'" from
   being eaten by the plain result report - a fighter attacking the scorecards
   is new information.  Enforced by MODAL_CLASSES (callout, reaction) as a
   VETO, not a soft signal, and applied both ways so the rewrites OF a reaction
   are still collapsed into it.
2. THE FIRST OUTLET WINS, EVEN WHEN IT IS AN AGGREGATOR.  Preferring a
   "better" byline means holding the first copy back to see whether a better
   one arrives, and delay is the complaint this wire already has (measured
   63-79 percent dead air on the GitHub-Actions transport).  `source` is used
   for two things only: a small same-source bonus, and the log line.
3. A ROLLING LIVE PAGE IS NOT A STORY.  "UFC Fight Night 288 Results (Live)",
   "Noche UFC Staff Picks" and "Noche UFC Weigh-In Results: Date, Time and How
   to Watch" carry no names and nothing but a card label plus a class word, and
   they were measured swallowing a real fight result.  A container or service
   headline can only ever merge with another container or service headline.
4. TWO OUTLETS' RECURRING COLUMNS ON ONE CARD ARE ACCEPTED AS ONE STORY.
   "Noche UFC Staff Picks" (The Lufkin Daily News) and "Noche UFC Staff Picks:
   Featherweight Bruisers Collide" (MMA Sucka) are the same column about the
   same card on the same day, both nameless, and collapsing them is what the
   owner asked for.  Recorded here because it is a deliberate choice: one blind
   judge called it a loss, the other independently checked it and called it a
   fair merge.
5. KNOWN AND ACCEPTED LIMIT: two posts more than max_age_hours apart can never
   merge, so the identical Tsarukyan quote posted 23 hours apart by LowKickMMA
   and MMA Fighting is only caught by the exact-text memory, not by the fuzzy
   path.  Widening the window re-opens prototype failure (b), which is the
   worse failure; the exact-text test at exact_hours is the compromise.
6. ONE ACCEPTED BORDERLINE DROP in the whole replay: Yardbarker's "Tim Elliott
   Vs. Edgar Chairez: Noche UFC AI Prediction, Results and Highlights" is
   folded into ATS.io's "Tim Elliott vs Edgar Chairez Prediction & Preview"
   from nine hours earlier.  Both are per-fight template pages for one fight,
   and the fight's actual result still reached the channel twice (Cageside
   Press 21:43, LowKickMMA 21:50), so the consequence is nil.  The obvious fix
   - making `preview` and `result` incompatible - was tried and REJECTED: the
   word "upset" is preview vocabulary as often as result vocabulary ("Can Jose
   Delgado actually upset Jean Silva"), so the rule costs more correct drops
   than it buys.
7. RESIDUAL RECALL GAPS, measured and left alone: the Cejudo-urges-Aspinall
   family still posts four times, because one outlet writes "Former UFC champ"
   and another writes it in French; and the Sept 13 Dana White stripping
   thread still posts four times out of six.  Both are boilerplate-only
   stories whose every non-name word is damped MMA vocabulary.  Pushing the
   floors low enough to catch them measurably cost distinct stories, and a
   missed duplicate is the cheaper failure.
"""

from __future__ import annotations

import hashlib
import json
import math
import os
import re
import unicodedata
from datetime import datetime, timezone
from functools import lru_cache

__all__ = [
    "DEFAULTS", "story_key", "is_duplicate", "judge", "remember",
    "validate_dedupe_cfg", "load_roster", "reset_clusters",
]

# --------------------------------------------------------------------------
# tunables.  Everything a human might want to move lives here; newsconfig's
# "dedupe" block is merged over it by _merge_cfg().
# --------------------------------------------------------------------------

DEFAULTS = {
    # Master switch.  False = post everything, exactly as before this module.
    "enabled": True,

    # --- window -----------------------------------------------------------
    # Nothing older than this can absorb a new story.  The prototype's
    # unbounded window merged posts 27 hours apart; 20h covers the slow
    # aggregator tail measured in the corpus (the Ngannou "bad guy" family ran
    # 9h, the Poirier arrest-footage family 9.4h) and stops short of the 26.5h
    # that separates "UFC could urge Aspinall to vacate" from "Aspinall
    # vacates".
    "max_age_hours": 20.0,
    # Inside this many hours the score bar sits at its lowest.  This is the
    # owner's actual complaint: eleven copies of one story in 45 minutes.
    "near_hours": 4.0,
    # A BYTE-IDENTICAL normalised headline is a re-poll artefact, never a
    # second story, so it is refused on a much longer memory than the fuzzy
    # window.  Measured: "Islam Makhachev fires Back at Shavkat Rakhmonov over
    # UFC title snub" (Sherdog) appears twice in the corpus, 19.3h apart.
    "exact_hours": 72.0,
    # How many kept posts to scan, newest first.  ~400 is 2.5 days of this wire.
    "max_candidates": 400,
    # How many rows remember() keeps.  Must comfortably exceed what
    # exact_hours needs; the list is persisted inside state_news.json.
    "recent_cap": 500,

    # --- signal fire thresholds (each signal is individually weak) ---------
    "fire_rare": 0.20,        # IDF-weighted content overlap
    "fire_name": 0.50,        # shared people (Jaccard)
    "fire_ngram": 0.30,       # character 4-gram containment
    "fire_class": 1,          # at least one shared event class

    # --- voting -----------------------------------------------------------
    "min_votes": 3,           # of 4, before the weighted score is looked at
    "weights": {
        "rare": 0.40,
        "name": 0.22,
        "ngram": 0.26,
        "class": 0.12,
    },
    # Required weighted score, ramped by the gap: near_hours -> score_near,
    # max_age_hours -> score_far.  Time is a BAR, never a bonus.
    "score_near": 0.44,
    "score_far": 0.74,
    # One outlet re-publishing its own feed item is the cheapest duplicate
    # there is, so shave the bar slightly.  It can never cross a container
    # headline: the Martinez/Ige false drop was MMA Insight absorbing MMA
    # Insight, and the container veto now runs first.
    "same_source_bonus": 0.03,
    # Multiplier applied INSTEAD of the subject-switch veto when the two casts
    # are compatible (one name set contains the other).  Measured: a hard veto
    # there let four copies of "Cejudo urges Aspinall to vacate" through,
    # because one outlet wrote "Former UFC champ" instead of the name.
    "subject_penalty": 0.86,

    # --- cluster anchoring ------------------------------------------------
    # A candidate must also reach this fraction of the bar against the story's
    # FIRST post, not merely against the last thing that joined it.
    "anchor_ratio": 0.62,

    # --- vetoes -----------------------------------------------------------
    "veto_class_conflict": True,   # weigh-in vs result, preview vs result
    "veto_event_number": True,     # UFC 320 is not UFC 333, Noche is not Paris
    # "either"   : veto when either headline's subject is missing from the other
    # "incoming" : only when the NEW headline's subject is missing
    # "off"      : no subject test at all
    "veto_subject_switch": "either",
    # The subject test only runs once a headline names this many people; below
    # it, a one-name rewrite of a one-name story is not second-guessed.
    "subject_switch_needs_names": 2,
    # "X urges Y to vacate" vs "Y vacates", and "Z reacts to Y vacating" vs
    # "Y vacates".  A proposal, a reaction and the event are three stories.
    "veto_modal": True,
    # A rolling live page / staff-picks column / how-to-watch guide may only
    # merge with another one.  Measured: "UFC Fight Night 288 Results (Live)"
    # ate "David Martinez Defeats Dan Ige By Decision At UFC Fight Night 288".
    "veto_container": True,

    # --- IDF --------------------------------------------------------------
    "idf_min_docs": 20,       # below this the window is too small to trust
    "idf_ceiling": 5.0,
    "domain_damp": 0.45,      # damping applied to built-in MMA boilerplate
    "rare_floor": 2.2,        # idf at or above this counts as a "rare" token
    "min_shared_rare": 1,     # cheap prefilter
    # An ABSOLUTE floor on shared evidence, in summed IDF, on top of the
    # relative overlap.  Two headlines whose only common ground is "win ufc
    # noche" score a relative overlap of 0.73 when both residuals are four
    # words long, and that mass is about 2.8 - it proves nothing.  Sharing
    # "vacates ufc heavyweight title" is a mass of about 7.6.
    "min_shared_mass": 5.0,
    # ...relaxed to this when the two headlines name EXACTLY the same people.
    # Measured: the eight-post "Dana White will discuss stripping Aspinall"
    # cluster of Sept 13 died on the absolute floor, because once the names are
    # removed every remaining word (title, strip, champion, heavyweight, urge)
    # is IDF-damped MMA boilerplate.  An identical cast is itself evidence.
    "min_shared_mass_named": 3.2,
    # ...but the relaxed floor needs corroboration, or an identical cast plus
    # ONE shared word merges anything.  Measured: "Matchmaking Jean Silva After
    # Big Win at UFC Noche" and "Jean Silva comforted by Noche UFC win after
    # memory loss from last year" share exactly the token "win" and score a
    # character overlap of 0.00; the eight-post Aspinall stripping cluster
    # shares "strip" and scores 0.24.  Anything at 0.00 is one coincidence.
    "named_relax_ngram": 0.12,
    # Each headline must carry this many specific (idf >= rare_floor, not MMA
    # boilerplate) content words of its own before the scored path will judge
    # it.  Kept at 1 deliberately: "UFC news: Tom Aspinall officially vacates
    # Heavyweight Championship" has exactly one and is a perfectly clear
    # headline.  Thinner ones fall to the terse path below.
    "min_specific_tokens": 1,
    # How far the overlap denominator is relaxed from min() towards max().
    # 0.0 is the pure overlap coefficient (tolerant of a 25-word Daily Mail
    # headline beside a 7-word MMA Fighting one, but it REWARDS being short);
    # 1.0 is effectively Jaccard.  See _soft_denom.
    "soft_denom": 0.30,

    # --- the terse path ---------------------------------------------------
    # A headline with almost no content words left once the names are removed
    # ("Jean Silva taps Jose Delgado") can never clear the scored path, so it
    # gets its own strict route: identical cast, a shared hard class, and a
    # high character n-gram score over the FULL text.
    "terse_ngram": 0.62,
    "min_content_tokens": 2,

    # --- misc -------------------------------------------------------------
    "ngram_n": 4,
    # Below this many characters of non-name text the character signal has
    # nothing to measure and reports 0 rather than a loud accident.
    "ngram_min_chars": 14,
    # Optional explicit path to mma_roster.json.  Empty = look next to this
    # file; a missing file is a fully supported state.
    "roster_path": "",
    "use_roster": True,
}


# --------------------------------------------------------------------------
# text normalisation
# --------------------------------------------------------------------------

# NFKD does not decompose these, so map them by hand.  Without this the name
# lexicon goes blind to Blachowicz and half the Brazilian roster.
_FOLD = {
    "ł": "l", "Ł": "L",      # l with stroke   (Blachowicz)
    "ø": "o", "Ø": "O",      # o with stroke
    "đ": "d", "Đ": "D",      # d with stroke
    "ı": "i", "İ": "I",      # dotless / dotted i (Turkish)
    "ß": "ss",
    "æ": "ae", "Æ": "AE",
    "œ": "oe", "Œ": "OE",
    "þ": "th", "Þ": "TH",
    "ð": "d", "Ð": "D",
    "ħ": "h", "Ħ": "H",
}

# Feed junk seen live in the corpus: &8211; &124; &038; &36; and friends, plus
# the replacement character the wire's own mojibake leaves behind.
_ENTITY = re.compile(r"&#?[0-9a-zA-Z]{1,8};?")
_APOS = re.compile("[‘’ʼ´'`\ufffd]")
_DQUOTE = re.compile("[“”«»]")
_NONWORD = re.compile(r"[^0-9A-Za-z]+")
_WORD = re.compile(r"[0-9A-Za-z]+")
_POSSESSIVE = re.compile(r"'s\b")

# A headline that opens with a pull-quote, which this corpus is full of:
#   "Aljo, you're soft": Jean Silva responds to Aljamain Sterling's callout
# The quoted span must not supply the story's SUBJECT (it still contributes to
# the name set).
_LEAD_QUOTE = re.compile(r"""^\s*["'][^"']{0,90}["']\s*[:,-]?\s*""")


def fold(text):
    """Accent-fold to bare ASCII letters, keeping case."""
    out = []
    for ch in text or "":
        out.append(_FOLD.get(ch, ch))
    s = unicodedata.normalize("NFKD", "".join(out))
    return "".join(c for c in s if not unicodedata.combining(c))


@lru_cache(maxsize=20000)
def clean(title):
    """Folded title with feed entities, smart quotes and possessives removed.

    Case is KEPT - it is the whole name signal.  The possessive is stripped
    because `aspinall's` and `aspinall` are one entity; 28 phantom entities
    existed in the corpus before this line.
    """
    s = fold(title or "")
    s = _APOS.sub("'", s)
    s = _DQUOTE.sub('"', s)
    s = _ENTITY.sub(" ", s)
    s = _POSSESSIVE.sub("", s)
    return s


def norm(title):
    """Lowercase alphanumeric-only form, used for character n-grams."""
    return _NONWORD.sub(" ", clean(title).lower()).strip()


@lru_cache(maxsize=20000)
def _words(cleaned):
    return tuple(_WORD.findall(cleaned))


# --------------------------------------------------------------------------
# stemming
# --------------------------------------------------------------------------

_KEEP_WHOLE = {
    "was", "has", "is", "his", "its", "this", "us", "vs", "less", "boss",
    "news", "press", "class", "miss", "cross", "loss", "gas", "bus", "plus",
    "series", "bonus", "status", "focus", "campus", "odds", "ufc", "mma",
}


@lru_cache(maxsize=100000)
def stem(word):
    """A deliberately small Porter-ish stemmer.

    It exists for one reason: "vacates", "vacate", "vacating" and "vacated"
    must collide - that is half of why the old raw-word Jaccard scored the
    owner's own example pair at 0.22.  A full Porter stemmer does more damage
    than good to fighter surnames, so this one stops early.
    """
    w = word
    if len(w) <= 3 or w in _KEEP_WHOLE:
        return w
    if w.endswith("ies") and len(w) > 4:
        w = w[:-3] + "y"
    elif w.endswith("sses"):
        w = w[:-2]
    elif w.endswith("ses") and len(w) > 4:
        w = w[:-2]
    elif w.endswith("s") and not w.endswith(("ss", "us", "is")):
        w = w[:-1]
    if w.endswith("ing") and len(w) > 5:
        w = w[:-3]
    elif w.endswith("edly") and len(w) > 6:
        w = w[:-4]
    elif w.endswith("ed") and len(w) > 4:
        w = w[:-2]
    if len(w) > 4 and w[-1] == w[-2] and w[-1] in "bdfglmnprt":
        w = w[:-1]
    if len(w) > 4 and w.endswith("e"):
        w = w[:-1]
    if len(w) > 5 and w.endswith("ly"):
        w = w[:-2]
    return w


# --------------------------------------------------------------------------
# vocabulary
# --------------------------------------------------------------------------

STOPWORDS = set("""
a an the and or but if then than that this these those there here as at by for
from in into of off on onto out over to up with without within after before
during against about across amid among around behind below beneath beside
between beyond down near since through toward towards under until upon via
while is are was were be been being am do does did doing have has had having
will would shall should can could may might must not no nor so such own same
very just also too only even more most much many few its it he she they we
you i him her them his hers their our your my me us who whom whose which what
when where why how all any both each other another some new next last one two
ahead amid vs versus s t re ve ll d m
""".split())

# Headline boilerplate: real words, but they say nothing about WHICH story.
DOMAIN_COMMON = set("""
ufc mma pfl bellator fight fighter fighting bout card event show night main
co headliner promotion octagon cage star champ champion championship title
belt division weight class news report reports video watch watching photo
photos highlight highlights full live stream results result preview recap
says say said reveal reveals tells tell talk talks speak speaks
statement comment comments react reacts reaction ahead following after
official officially confirm confirms confirmed week weekend today tonight
year years old time start how where what why who latest update updates
big huge top best worst here now first second third pound heavyweight
lightweight welterweight middleweight featherweight bantamweight flyweight
strawweight women womens light former current ex
""".split())

# Capitalised tokens that are never a person.
NAME_STOP = set("""
ufc mma pfl one bellator rizin ksw invicta cage warrior noche apex abu dhabi
vegas arizona glendale sphere espn paramount plus dazn fox tnt bt
january february march april may june july august september october november
december monday tuesday wednesday thursday friday saturday sunday
fight fights fighter fighters night nights card cards event events show shows
main co headliner prelims prelim results result live video videos photo photos
highlights highlight watch news report preview recap odds picks staff
title belt champion champ championship division weight heavyweight lightweight
welterweight middleweight featherweight bantamweight flyweight strawweight
octagon knockout ko tko submission decision round rounds bonus bonuses
the a an and or of for to in on at vs versus with without why what how when
who where which that this is are was were will would could should can may
breaking exclusive full new former ex top best worst first last next
jr sr ii iii iv jnr snr
american british brazilian russian mexican irish english united states
twitter x instagram youtube tiktok reddit facebook google
""".split())


def _class_stems(words):
    return set(stem(w) for w in words.split())


# Event classes.  A "hard" class describes a mutually exclusive KIND of news:
# a weigh-in report and a fight result about the same two men are not the same
# story, however many tokens they share.
EVENT_CLASSES = {
    "vacate": (True, _class_stems(
        "vacate vacates vacated vacating vacancy strip stripped stripping "
        "relinquish relinquishes relinquishing forfeit abdicate surrender")),
    "retire": (True, _class_stems(
        "retire retires retired retiring retirement unretire")),
    # The widest class in the vocabulary, on purpose: five outlets will use
    # five vocabularies for one fight.  defends/retains/starches/outlasts were
    # added after measured misses ("Dvalishvili defends bantamweight title" vs
    # "retains bantamweight belt").
    "result": (True, _class_stems(
        "defeat defeats defeated beat beats beaten submit submits submitted "
        "submission taps tap tapped knockout knocks knocked flatten flattens "
        "outpoint outpoints outclass outclasses outduel outworks survives "
        "survived stoppage stops stopped starches halts outlasts rallies "
        "finish finishes finished chokes choked wins win won loses loss lost "
        "upset edges edged scorecards decision result results defends defend "
        "retains retain smokes demolishes batters drops")),
    "weighin": (True, _class_stems(
        "weigh weighs weighed weighin weighins scale scales missed misses "
        "pounds ceremonial faceoff faceoffs")),
    "bonus": (True, _class_stems(
        "bonus bonuses banks earn earns earned performance 100k")),
    "preview": (True, _class_stems(
        "preview previews prediction predictions predict predicts picks pick "
        "betting howto tune watchalong")),
    "booking": (True, _class_stems(
        "book books booked booking rebook rebooked matchup slated slotted "
        "schedule scheduled replace replaces replacing steps stepping targets "
        "targeted clash meets meet faces face set")),
    "injury": (True, _class_stems(
        "injury injured injuries withdraw withdraws withdrew withdrawal pulls "
        "pulled surgery surgeries damage hurt sidelined")),
    "signing": (True, _class_stems(
        "sign signs signed signing release released releases cut contract "
        "deal deals agent")),
    "legal": (True, _class_stems(
        "arrest arrested charged charges sue sued lawsuit suspend suspended "
        "suspension banned doping usada positive tested")),
    "death": (True, _class_stems("dies died death dead passing obituary")),
    "rankings": (True, _class_stems(
        "rankings ranking ranked rank climbs debuts p4p")),
    # --- soft classes: they colour a story, they never define its kind -----
    "callout": (False, _class_stems(
        "callout calls call challenge challenges demands demand vows vow urges "
        "urge wants want plea pleads dares dare request requests requested "
        "asks asking push pushes pushing")),
    # "surprised/questions/disputes/blasts" earn their place here: a fighter
    # attacking the scorecards after his own win is a follow-up, not the result
    # report.  See judgement call 1 in the module docstring.
    "reaction": (False, _class_stems(
        "reacts react reaction responds respond responded addresses addressed "
        "breaks silence apologises apologizes explains explained surprised "
        "questions disputes blasts slams rips complains fumes")),
    "media": (False, _class_stems(
        "podcast radio episode interview presser conference")),
}

# Classes that report TALK ABOUT an event, or a response TO one, rather than
# the event itself.  Treated as a veto, not a signal.
MODAL_CLASSES = {"callout", "reaction"}

# "results" is genuinely ambiguous: weigh-in results, bonus results, fight
# results.  When a more specific hard class is present it owns the story.
_CLASS_DOMINANCE = (("weighin", "result"), ("bonus", "result"))

_NUM_EVENT = re.compile(r"(?:ufc|pfl|one|bellator|ksw|rizin)\s*(\d{2,4})", re.I)

# An explicit calendar date.  Recurring columns are otherwise near-identical:
# "Open Thread, September 12, 2026: MEXICO!!" scores 0.74 against "Open Thread,
# September 11, 2026: Do you play fantasy sports?" and only the date separates
# them.
_DATE = re.compile(
    r"(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})\b",
    re.I)

# A card is identified by its number OR by the brand/city it is sold under.
EVENT_MARKERS = set("""
noche paris london vegas sphere apex rio sydney perth shanghai macau seattle
denver nashville montreal toronto mexico qatar doha riyadh abudhabi dhabi
manchester glasgow dublin louisville jacksonville phoenix glendale baku
""".split())

# A rolling page an outlet republishes all night, or a recurring column.  It is
# a CONTAINER for stories, not a story, and it must never absorb one.
_CONTAINER_RE = re.compile(
    r"\(live\)|\blive blog\b|\blive results\b|\blive coverage\b"
    r"|\blive updates\b|\blive fight coverage\b|\bopen thread\b"
    r"|\bstaff picks\b|\bplay.by.play\b|\bround.by.round\b"
    r"|\blive!|\blive stream(?:ing)? results\b", re.I)

# A service / listings piece: when to watch, on what channel, at what time.
_SERVICE_RE = re.compile(
    r"\bhow to watch\b|\bwhere to watch\b|\bstart time\b|\bwhat time\b"
    r"|\bdate,? time\b|\btime,? tv\b|\btv channel\b|\bhow to stream\b"
    r"|\bstreaming info\b|\bppv price\b|\bfight time\b|\bring walk", re.I)

# A piece about what somebody said or did BEFORE the story that prompted it -
# archive reporting, not a rewrite of today's news.  Measured: "Tom Aspinall
# said his return was up to the UFC months before Dana White's comments on
# stripping him" (Bloody Elbow) is original reporting of Aspinall's earlier
# position, and it was being eaten by the Dana White quote it contextualises.
_ARCHIVE_RE = re.compile(
    r"\b(?:months?|years?|weeks?|days?)\s+(?:before|ago|earlier|prior)\b"
    r"|\bback in \d{4}\b|\bresurfac\w*\b|\blast year\b(?=.*\bsaid\b)", re.I)


def refine_classes(found):
    for winner, loser in _CLASS_DOMINANCE:
        if winner in found:
            found.discard(loser)
    return found


# --------------------------------------------------------------------------
# time
# --------------------------------------------------------------------------

def to_dt(value):
    """Accept a datetime, an epoch number, or an ISO-8601 string.  None on junk."""
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        try:
            return datetime.fromtimestamp(value, timezone.utc)
        except (ValueError, OSError, OverflowError):
            return None
    if not isinstance(value, str):
        return None
    s = value.strip().replace("Z", "+00:00")
    if not s:
        return None
    try:
        dt = datetime.fromisoformat(s)
    except ValueError:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _ts(entry):
    if not isinstance(entry, dict):
        return None
    for key in ("ts", "when", "time", "posted", "at"):
        val = entry.get(key)
        if val is not None:
            got = to_dt(val)
            if got is not None:
                return got
    return None


def _title_of(entry):
    """A row's headline, or "" - never a KeyError and never a non-string.

    `recent` is persisted inside state_news.json and committed to a PUBLIC repo
    with a documented history of corrupted committed state, so every read of it
    is defensive.
    """
    if not isinstance(entry, dict):
        return ""
    # "t" is the key the committed state has always used, and it is what
    # news_bot's Jaccard net and pollgen.recent_titles read. Accept both so a
    # row written by either side is legible to the other.
    val = entry.get("title")
    if not isinstance(val, str):
        val = entry.get("t")
    return val if isinstance(val, str) else ""


# --------------------------------------------------------------------------
# the roster (a hint, never the source of truth)
# --------------------------------------------------------------------------

_DOMAIN_STEMS = set(stem(w) for w in DOMAIN_COMMON)

ROSTER_SURNAMES = set()
ROSTER_FIRST = set()
_ROSTER_LOADED = [None]


def load_roster(names):
    """Seed the roster prior.  `names` is an iterable of full fighter names."""
    ROSTER_SURNAMES.clear()
    ROSTER_FIRST.clear()
    for full in names or ():
        parts = [p for p in _WORD.findall(fold(str(full))) if len(p) > 1]
        if not parts:
            continue
        last = parts[-1].lower()
        if last not in NAME_STOP and last not in STOPWORDS:
            ROSTER_SURNAMES.add(last)
        for p in parts[:-1]:
            ROSTER_FIRST.add(p.lower())
    _ROSTER_LOADED[0] = "explicit"


def _autoload_roster(cfg):
    """Load mma_roster.json once, if it is there.  Absent is fully supported."""
    if _ROSTER_LOADED[0] is not None:
        return
    if not cfg.get("use_roster", True):
        _ROSTER_LOADED[0] = "off"
        return
    path = cfg.get("roster_path") or os.path.join(
        os.path.dirname(os.path.abspath(__file__)), "mma_roster.json")
    names = []
    try:
        with open(path, "r", encoding="utf-8") as fh:
            blob = json.load(fh)
        if isinstance(blob, dict):
            blob = blob.get("fighters") or blob.get("names") or []
        if isinstance(blob, list):
            names = [n for n in blob if isinstance(n, str)]
    except Exception:
        names = []
    load_roster(names)
    _ROSTER_LOADED[0] = "file:%d" % len(names)


# --------------------------------------------------------------------------
# window model (IDF + the self-taught name lexicon)
# --------------------------------------------------------------------------

@lru_cache(maxsize=20000)
def _content_stems(cleaned):
    out = []
    for w in _WORD.findall(cleaned.lower()):
        if len(w) < 2 or w in STOPWORDS:
            continue
        out.append(stem(w))
    return tuple(out)


def content_stems(cleaned):
    return _content_stems(cleaned)


class Window:
    """Everything derived from the rolling list of kept posts.

    Holds document frequencies (for IDF) and the self-taught name lexicon that
    lets the filter see fighters the roster has never heard of.
    """

    __slots__ = ("df", "n", "cap", "low", "cfg")

    def __init__(self, titles, cfg):
        self.cfg = cfg
        self.df = {}
        self.cap = {}
        self.low = {}
        self.n = 0
        for t in titles:
            self.add(t)

    def add(self, title):
        cleaned = clean(title)
        self.n += 1
        for tok in set(content_stems(cleaned)):
            self.df[tok] = self.df.get(tok, 0) + 1
        # Case evidence: a token seen lowercase mid-headline is a common word,
        # whatever it looks like elsewhere.  This is what makes the filter work
        # on fighters the roster has never heard of - Hokit, Van, Ruffy and
        # Prates are all missing from it and all visible here.
        #
        # Keyed by STEM, not surface form, so "Vacate" in a Title Cased
        # headline is refused on the evidence of every lowercase "vacates"
        # elsewhere in the window.
        for i, w in enumerate(_words(cleaned)):
            if not w[:1].isalpha():
                continue
            key = stem(w.lower())
            if w[0].isupper():
                if i > 0:
                    self.cap[key] = self.cap.get(key, 0) + 1
            else:
                self.low[key] = self.low.get(key, 0) + 1

    @staticmethod
    def title_cased(cleaned):
        """Is this Title Cased Like This One, carrying no case signal at all?

        The giveaway is a capitalised FUNCTION word ("If", "The", "His"): those
        stay lowercase in sentence case whatever the names around them do.  A
        plain capitalisation ratio gets this wrong on short, name-heavy
        headlines - "Jiri Prochazka stops Jan Blachowicz" is three of four long
        words capitalised and is not title cased.
        """
        words = _words(cleaned)
        funcs = [w for w in words[1:] if len(w) > 1 and w.lower() in STOPWORDS]
        if len(funcs) >= 2 and any(w[0].isupper() for w in funcs):
            return True
        longs = [w for w in words if len(w) >= 4 and w[:1].isalpha()]
        if len(longs) >= 6:
            return sum(1 for w in longs if w[0].isupper()) >= 0.9 * len(longs)
        return False

    def idf(self, token):
        cfg = self.cfg
        if self.n < cfg["idf_min_docs"]:
            value = 3.0
        else:
            value = math.log((self.n + 1.0) / (self.df.get(token, 0) + 1.0)) + 1.0
        if token in DOMAIN_COMMON or token in _DOMAIN_STEMS:
            value *= cfg["domain_damp"]
        return min(value, cfg["idf_ceiling"])

    def looks_like_name(self, token_lower, strict=False):
        """Is this capitalised token a person, as far as the window knows?

        `strict` is used for Title Cased Headlines, where capitalisation says
        nothing: "Chimaev May Take Career Break If UFC Fails to Find Opponent
        This Year" otherwise yields {chimaev, break, fails, find}, which both
        pollutes the name signal and strips three real content words out of the
        bag.
        """
        if token_lower in NAME_STOP or token_lower in STOPWORDS:
            return False
        st = stem(token_lower)
        if token_lower in DOMAIN_COMMON or st in _DOMAIN_STEMS:
            return False
        if token_lower in ROSTER_SURNAMES or token_lower in ROSTER_FIRST:
            return True
        low = self.low.get(st, 0)
        cap = self.cap.get(st, 0)
        if strict:
            return low == 0 and cap >= 2
        if low == 0:
            return True
        return cap >= low * 3


# --------------------------------------------------------------------------
# per-title features
# --------------------------------------------------------------------------

def ngrams(text, n):
    s = " " + " ".join(text.split()) + " "
    if len(s) <= n:
        return {s}
    return {s[i:i + n] for i in range(len(s) - n + 1)}


def event_classes(bag):
    found = set()
    for name, (_hard, vocab) in EVENT_CLASSES.items():
        if bag & vocab:
            found.add(name)
    return refine_classes(found)


def hard_classes(classes):
    return {c for c in classes if EVENT_CLASSES[c][0]}


def _name_order(cleaned, win, strict=False):
    """Ordered unique person keys in one span of text.

    A run of consecutive capitalised name-ish tokens is ONE person, keyed by
    the last token, so "Islam Makhachev" and "Makhachev" collide and
    "Raul Rosas Jr" keys on rosas rather than the generational suffix.
    """
    keys, run = [], []
    for w in _words(cleaned):
        low = w.lower()
        if w[:1].isupper() and len(w) > 2 and win.looks_like_name(low, strict):
            run.append(low)
            continue
        if run:
            keys.append(run[-1])
            run = []
    if run:
        keys.append(run[-1])
    seen = []
    for k in keys:
        if k not in seen:
            seen.append(k)
    return seen


def names_in(cleaned, win):
    """(ordered unique person keys, principal).

    The principal is the first person named; in a headline that is almost
    always the story's subject, which is the test that keeps reaction pieces
    alive.  The systematic exception is the pull-quote opener: in '"Aljo,
    you're soft": Jean Silva responds to Aljamain Sterling's callout' the
    subject is Silva, not the nickname inside the quote.  The quoted span still
    contributes to the name SET; it just cannot supply the subject.
    """
    strict = win.title_cased(cleaned) and win.n >= win.cfg["idf_min_docs"]
    seen = _name_order(cleaned, win, strict)
    principal = seen[0] if seen else None
    body = _LEAD_QUOTE.sub("", cleaned, count=1)
    if principal and body != cleaned:
        inner = _name_order(body, win, strict)
        if inner:
            principal = inner[0]
    return seen, principal


class Story:
    """The feature bundle one headline is reduced to."""

    __slots__ = ("title", "source", "when", "cleaned", "normed", "bag",
                 "rare_text", "grams", "full_grams", "classes", "hard",
                 "names", "principal", "numbers", "dates", "markers", "weight",
                 "specific", "container", "service", "archive", "thin")

    def __init__(self, title, source, when, win, cfg):
        self.title = title or ""
        self.source = (source or "").strip()
        self.when = when
        self.cleaned = clean(self.title)
        self.normed = norm(self.title)
        self.names, self.principal = names_in(self.cleaned, win)
        name_set = set(self.names)
        self.markers = {m for m in EVENT_MARKERS if m in self.normed.split()}

        # Content = WHAT happened, with the people and the card taken out.  The
        # card is context shared by every story on it: leaving "noche" in the
        # bag made "Matchmaking Jean Silva After Big Win at UFC Noche" and
        # "Jean Silva comforted by Noche UFC win after memory loss" score an
        # overlap of 0.73 on the words "win ufc noche" alone.
        words = []
        for w in _words(self.cleaned):
            low = w.lower()
            if low in STOPWORDS or len(low) < 2:
                continue
            if low in name_set or low in self.markers:
                continue
            if w[:1].isupper() and len(w) > 2 and win.looks_like_name(low):
                continue          # a first name whose run was keyed elsewhere
            words.append(low)
        self.bag = set(stem(w) for w in words)
        self.rare_text = " ".join(words)
        n = cfg["ngram_n"]
        self.grams = (ngrams(self.rare_text, n)
                      if len(self.rare_text) >= cfg["ngram_min_chars"] else set())
        self.full_grams = ngrams(self.normed, n) if self.normed else set()

        self.classes = event_classes(self.bag)
        self.hard = hard_classes(self.classes)
        self.numbers = set(_NUM_EVENT.findall(self.cleaned))
        self.dates = set(_DATE.findall(self.cleaned))
        self.weight = {t: win.idf(t) for t in self.bag}
        self.specific = sum(1 for t, v in self.weight.items()
                            if v >= cfg["rare_floor"]
                            and t not in DOMAIN_COMMON
                            and t not in _DOMAIN_STEMS)
        # A rolling live page, a recurring column, or a headline that is
        # nothing but a card label plus a class word.  Never a story.
        self.container = bool(_CONTAINER_RE.search(self.cleaned)) or (
            not self.names and self.specific == 0)
        self.service = bool(_SERVICE_RE.search(self.cleaned))
        self.archive = bool(_ARCHIVE_RE.search(self.cleaned))
        self.thin = (len(self.bag) < cfg["min_content_tokens"]
                     or self.specific < cfg["min_specific_tokens"])


# --------------------------------------------------------------------------
# the signals
# --------------------------------------------------------------------------

def _soft_denom(x, y, soft):
    """min(x, y) relaxed a fraction of the way towards max(x, y).

    A pure min() denominator is what makes the overlap coefficient tolerant of
    length - the reason it beats Jaccard on a 25-word Daily Mail headline next
    to a 7-word MMA Fighting one.  But it also REWARDS being short: "Axel Sola
    Plans Recurring U.S. Camps After UFC Paris Knockout" reduces to three
    content words, so sharing "ufc knockout" with an unrelated Phil Baroni
    story scored 0.56.  Relaxing keeps the tolerance and removes the reward.
    """
    lo, hi = (x, y) if x <= y else (y, x)
    return lo + soft * (hi - lo)


def sig_rare(a, b, floor, soft):
    """IDF-weighted overlap over a softened denominator.  (ratio, hits, mass)."""
    shared = a.bag & b.bag
    if not shared:
        return 0.0, 0, 0.0
    mass = sum(max(a.weight.get(t, 0.0), b.weight.get(t, 0.0)) for t in shared)
    denom = _soft_denom(sum(a.weight.values()), sum(b.weight.values()), soft)
    if denom <= 0:
        return 0.0, 0, 0.0
    hits = sum(1 for t in shared
               if max(a.weight.get(t, 0.0), b.weight.get(t, 0.0)) >= floor)
    return min(mass / denom, 1.0), hits, mass


def sig_name(a, b):
    """Jaccard, NOT the overlap coefficient.

    A rewrite of a story names the same people; it does not name a superset.
    Under min(), "Ryan Garcia eases to victory over Conor Benn" scored a perfect
    1.0 against "Garcia vs. Benn video: Da'Mazion Vanhouter ... flatten Raphael
    Akpejiori", because {garcia, benn} sits inside the four-name cast of an
    undercard clip filed under the same card label.  Jaccard scores that 0.5
    and the main event survives.
    """
    if not a.names or not b.names:
        return 0.0
    sa, sb = set(a.names), set(b.names)
    return len(sa & sb) / float(len(sa | sb))


def sig_ngram(a, b, soft):
    """Character 4-gram containment over the name-free text, same denominator.

    Catches morphology the small stemmer misses (relinquish / relinquishing)
    and the feed-entity noise that peppers these titles.
    """
    if not a.grams or not b.grams:
        return 0.0
    denom = _soft_denom(len(a.grams), len(b.grams), soft)
    if denom <= 0:
        return 0.0
    return min(len(a.grams & b.grams) / denom, 1.0)


def _full_ngram(a, b, soft):
    """The same measure over the FULL normalised text, names included.

    Only the terse path uses it, where the name-free text is too short to carry
    any signal at all.
    """
    if not a.full_grams or not b.full_grams:
        return 0.0
    denom = _soft_denom(len(a.full_grams), len(b.full_grams), soft)
    if denom <= 0:
        return 0.0
    return min(len(a.full_grams & b.full_grams) / denom, 1.0)


def sig_class(a, b):
    return len(a.classes & b.classes)


def time_bar(a, b, cfg):
    """Required weighted score, ramped by how far apart the two posts are."""
    gap = abs((a.when - b.when).total_seconds()) / 3600.0
    near, far = cfg["near_hours"], cfg["max_age_hours"]
    if gap <= near:
        return cfg["score_near"], gap
    span = max(far - near, 0.001)
    frac = min((gap - near) / span, 1.0)
    return cfg["score_near"] + frac * (cfg["score_far"] - cfg["score_near"]), gap


# --------------------------------------------------------------------------
# pairwise verdict
# --------------------------------------------------------------------------

def compare(new, old, cfg):
    """Score one pair.  Returns (score, votes, veto_or_None, detail)."""
    # --- veto 1: two different events -------------------------------------
    if cfg["veto_event_number"]:
        if new.numbers and old.numbers and not (new.numbers & old.numbers):
            return 0.0, 0, "event-number", {}
        if new.markers and old.markers and not (new.markers & old.markers):
            return 0.0, 0, "event-marker", {}
        if new.dates and old.dates and not (new.dates & old.dates):
            return 0.0, 0, "different-date", {}

    # --- veto 2: a container is not a story -------------------------------
    # "UFC Fight Night 288 Results (Live)" is a page an outlet republishes all
    # night; it measurably swallowed "David Martinez Defeats Dan Ige By
    # Decision At UFC Fight Night 288" from the same outlet.  A how-to-watch
    # guide has the same shape.  Either may merge only with its own kind.
    if cfg["veto_container"]:
        if new.container != old.container:
            return 0.0, 0, "container-vs-story", {}
        if new.service != old.service:
            return 0.0, 0, "service-vs-story", {}
        if new.archive != old.archive:
            return 0.0, 0, "archive-vs-story", {}

    # --- veto 3: incompatible kinds of news -------------------------------
    if cfg["veto_class_conflict"] and new.hard and old.hard:
        if not (new.hard & old.hard):
            return 0.0, 0, "class-conflict", {}

    # --- veto 4: a proposal, and a reaction, are not the event -------------
    # "Dana White urges Tom Aspinall to vacate UFC title" (05:57) scored 0.69
    # against "Tom Aspinall vacates UFC heavyweight title" (12:16) and would
    # have swallowed the biggest story of the week.  Same shape: "Brandon
    # Moreno surprised by split decision scoring" vs the plain result report.
    if cfg["veto_modal"] and (new.hard & old.hard):
        if bool(new.classes & MODAL_CLASSES) != bool(old.classes & MODAL_CLASSES):
            return 0.0, 0, "modal-vs-event", {}

    soft = cfg["soft_denom"]
    name = sig_name(new, old)

    # --- the terse path ---------------------------------------------------
    # "Jean Silva taps Jose Delgado" has one content word left once the names
    # are stripped, so the scored path can never judge it.  Identical cast, a
    # shared hard class and near-identical full text is enough on its own.
    if new.thin or old.thin:
        if (new.names and name >= 0.999 and (new.hard & old.hard)
                and not new.container and not old.container):
            full = _full_ngram(new, old, soft)
            if full >= cfg["terse_ngram"]:
                detail = {"rare": 0.0, "mass": 0.0, "name": 1.0,
                          "ngram": round(full, 3), "class": sig_class(new, old),
                          "votes": 4, "score": 1.0, "path": "terse"}
                return 1.0, 4, None, detail
        return 0.0, 0, "thin-headline", {}

    rare, rare_hits, mass = sig_rare(new, old, cfg["rare_floor"], soft)
    if rare_hits < cfg["min_shared_rare"]:
        return 0.0, 0, "no-rare-token", {}
    gram = sig_ngram(new, old, soft)
    # An identical cast is itself evidence, so the absolute mass floor drops -
    # without it the eight-post "Dana White will discuss stripping Aspinall"
    # cluster survives intact, because strip away the names and every remaining
    # word is damped MMA boilerplate.  The relaxed floor still needs SOME
    # shared wording: at 0.00 characters in common the single shared token is a
    # coincidence, which is how "Matchmaking Jean Silva After Big Win" was
    # eaten by "Jean Silva comforted by Noche UFC win after memory loss".
    relaxed = (name >= 0.999 and new.names and gram >= cfg["named_relax_ngram"])
    mass_floor = (cfg["min_shared_mass_named"] if relaxed
                  else cfg["min_shared_mass"])
    if mass < mass_floor:
        return 0.0, 0, "thin-evidence", {}

    cls = sig_class(new, old)

    # --- veto 5 / penalty: the headline changed its subject ----------------
    # A headline's first named person is its subject.  When the two casts are
    # INCOMPATIBLE (neither contains the other) a changed subject is a hard
    # veto - that is what keeps "Francis Ngannou issues response after Dana
    # White admitted he wanted him to lose" out of the Dana White story it
    # answers.  When one cast contains the other the evidence is weaker: four
    # copies of "Cejudo urges Aspinall to vacate" survived a hard veto here
    # only because one outlet wrote "Former UFC champ" instead of the name.
    # There it is a score penalty instead.
    penalty = 1.0
    mode = cfg["veto_subject_switch"]
    if mode and mode != "off" and new.names and old.names:
        need_names = cfg["subject_switch_needs_names"]
        if len(new.names) >= need_names or len(old.names) >= need_names:
            sa, sb = set(new.names), set(old.names)
            compatible = sa <= sb or sb <= sa
            switched = (new.principal != old.principal if mode == "either"
                        else new.principal not in old.names)
            if switched:
                if compatible:
                    penalty = cfg["subject_penalty"]
                else:
                    return 0.0, 0, "subject-switch", {}

    votes = 0
    if rare >= cfg["fire_rare"]:
        votes += 1
    if name >= cfg["fire_name"]:
        votes += 1
    if gram >= cfg["fire_ngram"]:
        votes += 1
    if cls >= cfg["fire_class"]:
        votes += 1

    w = cfg["weights"]
    score = (w["rare"] * rare
             + w["name"] * name
             + w["ngram"] * gram
             + w["class"] * (1.0 if cls else 0.0)) * penalty
    if new.source and new.source == old.source:
        score += cfg["same_source_bonus"]

    detail = {"rare": round(rare, 3), "mass": round(mass, 2),
              "name": round(name, 3), "ngram": round(gram, 3), "class": cls,
              "votes": votes, "score": round(score, 3), "path": "scored"}
    return score, votes, None, detail


# --------------------------------------------------------------------------
# config
# --------------------------------------------------------------------------

def _num_ok(default, val):
    """A JSON `true` is an int in Python, and this project has been bitten by
    that twice (quiet_hours_utc, the staging caps).  Booleans are never
    thresholds."""
    if isinstance(val, bool):
        return False
    if isinstance(default, float):
        return isinstance(val, (int, float)) and val >= 0
    if isinstance(default, int):
        return isinstance(val, int) and val >= 0
    return False


_BOOL_KEYS = ("enabled", "veto_class_conflict", "veto_event_number",
              "veto_modal", "veto_container", "use_roster")
_STR_KEYS = ("veto_subject_switch", "roster_path")


def _merge_cfg(cfg):
    """DEFAULTS with the caller's overrides on top.

    Accepts the whole newsconfig dict (tunables under its "dedupe" key) or the
    dedupe block on its own.  Anything of the wrong type is IGNORED, so a bad
    panel edit degrades to the shipped default instead of silently disabling
    the filter.
    """
    if isinstance(cfg, dict) and cfg.get("_storykey_merged") is True:
        return cfg
    block = cfg
    if isinstance(cfg, dict) and isinstance(cfg.get("dedupe"), dict):
        block = cfg["dedupe"]
    out = dict(DEFAULTS)
    out["weights"] = dict(DEFAULTS["weights"])
    for k, v in (block or {}).items():
        if k not in DEFAULTS or v is None:
            continue
        if k == "weights":
            if isinstance(v, dict):
                for wk, wv in v.items():
                    if wk in out["weights"] and _num_ok(0.0, wv):
                        out["weights"][wk] = float(wv)
        elif k in _BOOL_KEYS:
            out[k] = bool(v)
        elif k in _STR_KEYS:
            if isinstance(v, str):
                out[k] = v
        elif _num_ok(DEFAULTS[k], v):
            out[k] = type(DEFAULTS[k])(v)
    out["_storykey_merged"] = True
    return out


def validate_dedupe_cfg(cfg):
    """Return a list of human-readable complaints; empty means fine.

    Mirrors validate_newsconfig: MOD_PANEL and the Worker both write this
    block, so a wrong type must be refused at the door rather than discovered
    later as a silently disabled filter.
    """
    bad = []
    block = cfg
    if isinstance(cfg, dict) and isinstance(cfg.get("dedupe"), dict):
        block = cfg["dedupe"]
    if block is None:
        return bad
    if not isinstance(block, dict):
        return ["dedupe must be an object"]
    for k, v in block.items():
        if k == "_storykey_merged":
            continue
        if k not in DEFAULTS:
            bad.append("unknown key %r" % k)
        elif k in _BOOL_KEYS:
            if not isinstance(v, bool):
                bad.append("%s must be true/false" % k)
        elif k == "weights":
            if not isinstance(v, dict):
                bad.append("weights must be an object")
            else:
                for wk, wv in v.items():
                    if wk not in DEFAULTS["weights"]:
                        bad.append("unknown weight %r" % wk)
                    elif not _num_ok(0.0, wv):
                        bad.append("weight %s must be a number >= 0" % wk)
        elif k == "veto_subject_switch":
            if v not in ("either", "incoming", "off"):
                bad.append("veto_subject_switch must be either/incoming/off")
        elif k == "roster_path":
            if not isinstance(v, str):
                bad.append("roster_path must be a string")
        elif not _num_ok(DEFAULTS[k], v):
            bad.append("%s must be a number >= 0 (a JSON true reads as 1)" % k)
    merged = _merge_cfg(cfg)
    if merged["near_hours"] > merged["max_age_hours"]:
        bad.append("near_hours must not exceed max_age_hours")
    if merged["score_far"] < merged["score_near"]:
        bad.append("score_far must not be below score_near")
    if merged["max_candidates"] < 1 or merged["recent_cap"] < 1:
        bad.append("max_candidates and recent_cap must be at least 1")
    return bad


# --------------------------------------------------------------------------
# public API
# --------------------------------------------------------------------------

def story_key(title, cfg=None):
    """A comparable signature for one headline.

    Returns a 5-tuple of frozensets:

        (people, hard event classes, soft classes, card markers, topic stems)

    Use it for logging, grouping and eyeballing WHY two posts were or were not
    merged.  It is deliberately NOT how the decision is made: grouping by exact
    signature equality is prototype failure (a) - it split one Aspinall story
    into three clusters, because (aspinall, vacate), (aspinall, injury+vacate)
    and (aspinall, callout+vacate) are different tuples.  The decision is
    overlap-based; see judge().

    Computed against an EMPTY window, so it is a pure function of the headline
    (plus the optional roster).  Names therefore come from capitalisation and
    the roster alone; inside a live window judge() sees more.
    """
    cfg = _merge_cfg(cfg)
    _autoload_roster(cfg)
    win = Window([], cfg)
    st = Story(title, "", datetime(1970, 1, 1, tzinfo=timezone.utc), win, cfg)
    topic = frozenset(t for t, v in st.weight.items() if v >= cfg["rare_floor"])
    return (frozenset(st.names), frozenset(st.hard),
            frozenset(st.classes - st.hard),
            frozenset(st.markers | st.numbers), topic)


def _story_for(entry, ets, win, cfg):
    """Story for a window row, cached on the row under a private key.

    The cache key includes the window's size, so a rebuilt window (different
    IDF, different name lexicon) never hands back a stale feature bundle.  The
    key starts with "_" and is stripped before the row is persisted.
    """
    key = (win.n, cfg["ngram_n"])
    hit = entry.get("_sk") if isinstance(entry, dict) else None
    if isinstance(hit, tuple) and hit[0] == key:
        return hit[1]
    st = Story(_title_of(entry), entry.get("source"), ets, win, cfg)
    if isinstance(entry, dict):
        entry["_sk"] = (key, st)
    return st


def judge(title, source, when, recent, cfg=None):
    """Full verdict.

    Returns {"duplicate": bool, "reason": str, "cluster": id or None,
             "match": matched title or None, "detail": {...}}.
    """
    cfg = _merge_cfg(cfg)
    if not cfg["enabled"]:
        return {"duplicate": False, "reason": "dedupe disabled", "cluster": None,
                "match": None, "detail": {}}
    _autoload_roster(cfg)
    if not isinstance(title, str) or not title.strip():
        return {"duplicate": False, "reason": "no title", "cluster": None,
                "match": None, "detail": {}}
    now = to_dt(when)
    if now is None:
        # An unusable timestamp must fail towards POSTING: it is exactly when
        # we know least, so it must not be when we act most aggressively.
        return {"duplicate": False, "reason": "no usable timestamp, keeping",
                "cluster": None, "match": None, "detail": {}}

    # 1. cheapest cascade step: walk the window newest-first.  The exact-text
    #    test gets a longer memory than the fuzzy one.
    me = norm(title)
    live = []
    for e in reversed(list(recent or ())):
        et = _title_of(e)
        if not et:
            continue
        ets = _ts(e)
        if ets is None:
            continue
        gap = (now - ets).total_seconds() / 3600.0
        if gap < 0:
            continue                      # a future-dated row is not history
        if gap > cfg["exact_hours"]:
            break
        if me and norm(et) == me:
            return {"duplicate": True,
                    "reason": "exact repeat of %r (%s, %.1fh earlier)"
                              % (et[:70], e.get("source") or "?", gap),
                    "cluster": e.get("cluster"), "match": et,
                    "detail": {"path": "exact"}}
        if gap > cfg["max_age_hours"]:
            continue
        live.append((e, ets))
        if len(live) >= cfg["max_candidates"]:
            break
    live.reverse()

    if not live:
        return {"duplicate": False, "reason": "nothing recent to compare",
                "cluster": None, "match": None, "detail": {}}

    win = Window([_title_of(e) for e, _ in live], cfg)
    new = Story(title, source, now, win, cfg)

    # 2. score every survivor of the window, keep the best.
    best = None
    for e, ets in live:
        old = _story_for(e, ets, win, cfg)
        score, votes, veto, detail = compare(new, old, cfg)
        bar, gap = time_bar(new, old, cfg)
        if veto:
            continue
        if votes < cfg["min_votes"] or score < bar:
            if best is None or (not best["pass"] and score > best["score"]):
                best = {"entry": e, "score": score, "votes": votes, "bar": bar,
                        "gap": gap, "detail": detail, "pass": False}
            continue
        margin = score - bar
        if best is None or not best["pass"] or margin > best.get("margin", -9):
            best = {"entry": e, "score": score, "votes": votes, "bar": bar,
                    "gap": gap, "detail": detail, "pass": True,
                    "margin": margin}

    if best is None:
        return {"duplicate": False, "reason": "distinct (every candidate vetoed)",
                "cluster": None, "match": None, "detail": {}}
    if not best["pass"]:
        return {"duplicate": False,
                "reason": "distinct (best %d/4 signals, %.2f < %.2f)"
                          % (best["votes"], best["score"], best["bar"]),
                "cluster": None, "match": None, "detail": best["detail"]}

    # 3. anchor check.  The candidate must also resemble the story's FIRST
    #    post, not only whatever joined the cluster most recently, or a chain
    #    of small steps walks a cluster onto a different story - prototype
    #    failure (b), which ran a Poirier cluster 45 hours.
    entry = best["entry"]
    cid = entry.get("cluster")
    anchor = None
    if cid is not None:
        for e, ets in live:
            if e.get("cluster") == cid:
                anchor = (e, ets)
                break
    if anchor is not None and anchor[0] is not entry:
        aold = _story_for(anchor[0], anchor[1], win, cfg)
        ascore, _votes, aveto, _ad = compare(new, aold, cfg)
        abar, _ = time_bar(new, aold, cfg)
        if aveto or ascore < abar * cfg["anchor_ratio"]:
            return {"duplicate": False,
                    "reason": "distinct (drifted from cluster anchor %r: %s)"
                              % (_title_of(anchor[0])[:50],
                                 aveto or "%.2f" % ascore),
                    "cluster": None, "match": None, "detail": best["detail"]}

    d = best["detail"]
    if d.get("path") == "terse":
        reason = ("duplicate of %r (%s, %.1fh earlier): identical cast, same "
                  "event, %.2f character overlap"
                  % (_title_of(entry)[:70], entry.get("source") or "?",
                     best["gap"], d["ngram"]))
    else:
        reason = ("duplicate of %r (%s, %.1fh earlier): rare %.2f, names %.2f, "
                  "chars %.2f, %d shared class, %d/4 signals, score %.2f >= %.2f"
                  % (_title_of(entry)[:70], entry.get("source") or "?",
                     best["gap"], d["rare"], d["name"], d["ngram"], d["class"],
                     d["votes"], d["score"], best["bar"]))
    return {"duplicate": True, "reason": reason, "cluster": cid,
            "match": _title_of(entry), "detail": d}


def is_duplicate(title, source, when, recent, cfg=None):
    """(bool, reason).  True means: do not post this, it is a rewrite.

    `recent` is the rolling list of posts that were KEPT, oldest first.  Each
    row is a plain JSON dict with at least "title" and a timestamp under one of
    ts/when/time/posted/at, plus optionally "source" and "cluster".  Rows are
    never mutated except for a private "_sk" feature cache, which remember()
    and any JSON writer must skip (see strip_cache).
    """
    v = judge(title, source, when, recent, cfg)
    return v["duplicate"], v["reason"]


def strip_cache(recent):
    """Drop the private feature cache before persisting `recent`.

    news_bot commits state_news.json to a public repo; a Story object is not
    JSON-serialisable, so this runs before the write.  Cheap and idempotent.
    """
    for e in recent or ():
        if isinstance(e, dict):
            e.pop("_sk", None)
    return recent


def _cluster_id(title, when):
    """A cluster id derived from the story's FIRST post.

    Deliberately not a counter: news_bot is a fresh process per hourly window,
    so a module-global sequence mints "c1" again every run and collides with a
    persisted "c1" still inside the window, which then resolves the anchor
    check against an unrelated story.
    """
    raw = "%s|%s" % (norm(title), when.isoformat() if when else "")
    return "c" + hashlib.sha1(raw.encode("utf-8")).hexdigest()[:10]


def reset_clusters():
    """Kept for API compatibility with the prototype.  Ids are content-derived
    now, so there is no counter to reset."""
    return None


def remember(recent, title, source, when, cluster=None, cfg=None):
    """Append a KEPT post to the rolling window and prune what aged out.

    Rows are plain JSON - {ts, title, source, cluster} with an ISO-8601 STRING
    timestamp - because this list is persisted inside state_news.json and
    committed to a PUBLIC repo.  A datetime object here raises TypeError out of
    json.dumps, which would silently reduce the dedupe memory to a single
    window; there is a round-trip selftest for exactly that.
    """
    cfg = _merge_cfg(cfg)
    dt = to_dt(when)
    entry = {"t": title,
             "source": source,
             "ts": dt.isoformat() if dt else "",
             "cluster": cluster if cluster is not None else _cluster_id(title, dt)}
    recent.append(entry)
    if dt is not None:
        horizon = max(cfg["max_age_hours"], cfg["exact_hours"])
        keep = []
        for e in recent:
            ets = _ts(e)
            if ets is None:
                continue
            if (dt - ets).total_seconds() / 3600.0 <= horizon:
                keep.append(e)
        recent[:] = keep[-cfg["recent_cap"]:]
    return entry


# --------------------------------------------------------------------------
# self-test: python storykey.py
# --------------------------------------------------------------------------

def _selftest():
    from datetime import timedelta
    t0 = datetime(2026, 9, 14, 12, 16, tzinfo=timezone.utc)
    ok = [0]
    bad = []

    def feed(rows, cfg=None):
        recent, out = [], []
        for mins, title, src in rows:
            when = t0 + timedelta(minutes=mins)
            v = judge(title, src, when, recent, cfg)
            out.append((v["duplicate"], v["reason"]))
            if not v["duplicate"]:
                remember(recent, title, src, when, cfg=cfg)
        return out

    def check(label, cond):
        if cond:
            ok[0] += 1
        else:
            bad.append(label)

    # 1. The burst the owner complained about: one story, one post.
    burst = feed([
        (0, "Tom Aspinall vacates UFC heavyweight title after suffering "
            "'further damage' to his eye in training", "Bloody Elbow"),
        (1, "Tom Aspinall vacates UFC heavyweight title: 'Absolute nightmare'",
            "MMA Fighting"),
        (9, "Tom Aspinall vacates UFC heavyweight title in bombshell statement "
            "as eye issues continue", "Yahoo Sports"),
        (19, "Why Did Tom Aspinall Vacate UFC Heavyweight Title? 33-Year-Old "
             "Reveals \u201cAbsolute Nightmare\u201d Condition", "NDTV Sports"),
        (22, "UFC news: Tom Aspinall officially vacates Heavyweight "
             "Championship", "Yahoo Sports"),
    ])
    check("first post always survives", burst[0][0] is False)
    check("rewrites 2-5 all dropped", all(d for d, _ in burst[1:]))
    check("the 0.22-Jaccard pair from the prompt is caught", burst[3][0] is True)

    # 2. A proposal is not the event.
    urge = feed([
        (-380, "Dana White urges Tom Aspinall to vacate UFC title", "Yahoo Sports"),
        (0, "Tom Aspinall vacates UFC heavyweight title after suffering "
            "'further damage' to his eye in training", "Bloody Elbow"),
    ])
    check("'urges X to vacate' does not swallow 'X vacates'", urge[1][0] is False)

    # 3. A reaction piece with its own subject is its own story, and its OWN
    #    rewrites still collapse into it.
    react = feed([
        (0, "Tom Aspinall vacates UFC heavyweight title after suffering "
            "'further damage' to his eye in training", "Bloody Elbow"),
        (32, "Josh Hokit demands title fight as he reacts to Tom Aspinall's "
             "relinquishing his heavyweight belt", "Bloody Elbow"),
        (44, "Josh Hokit demands heavyweight title shot against Ciryl Gane "
             "after Tom Aspinall vacates UFC belt", "The Times of India"),
    ])
    check("reaction piece survives", react[1][0] is False)
    check("the reaction's own rewrite is dropped", react[2][0] is True)

    # 4. A post-fight quote story is not the result report (the Moreno case).
    quote = feed([
        (0, "Noche UFC results: Brandon Moreno snaps skid with split decision "
            "vs. Joseph Morales", "MMA Fighting"),
        (60, "Brandon Moreno surprised by split decision scoring in Noche UFC "
             "win: 'What the f*ck?'", "MMA Junkie"),
    ])
    check("a presser-quote follow-up survives the result", quote[1][0] is False)

    # 5. A rolling live page never absorbs a real result (the Martinez case).
    cont = feed([
        (0, "UFC Fight Night 288 Results (Live)", "MMA Insight"),
        (77, "David Martinez Defeats Dan Ige By Decision At UFC Fight "
             "Night 288", "MMA Insight"),
    ])
    check("a live-results container does not eat a fight result",
          cont[1][0] is False)

    # 6. A how-to-watch guide is not a weigh-in report.
    serv = feed([
        (0, "Noche UFC 4 weigh-in results: All fighters make weight",
            "MMA Fighting"),
        (30, "Noche UFC Weigh-In Results: Date, Time and How to Watch", "Forbes"),
    ])
    check("a service listing survives a weigh-in report", serv[1][0] is False)

    # 6b. An archive piece is not a rewrite of the news that prompted it.
    arch = feed([
        (0, "Dana White reveals UFC 'will be talking about' stripping Tom "
            "Aspinall of heavyweight title", "Bloody Elbow"),
        (283, "Tom Aspinall said his return was up to the UFC months before "
              "Dana White's comments on stripping him", "Bloody Elbow"),
    ])
    check("archive reporting survives the quote it contextualises",
          arch[1][0] is False)

    # 6c. An identical cast relaxes the evidence floor, but not to nothing:
    #     one shared word and zero shared characters is a coincidence.
    coin = feed([
        (0, "Jean Silva comforted by Noche UFC win after memory loss from "
            "last year", "Yahoo Sports"),
        (12, "Matchmaking Jean Silva After Big Win at UFC Noche", "MMA Sucka"),
    ])
    check("one shared word on an identical cast is not a merge",
          coin[1][0] is False)

    # 7. Different kinds of news about the same two men never merge.
    kinds = feed([
        (0, "Noche UFC weigh-in results: Conor Benn beats Ryan Garcia to the "
            "scale for title fight", "MMA Fighting"),
        (30, "Ryan Garcia eases to victory over Conor Benn, secures round 2 "
             "knockout", "Yahoo Sports"),
    ])
    check("weigh-in report vs fight result", kinds[1][0] is False)

    # 8. Different cards never merge, even under one outlet's template.
    cards = feed([
        (0, "Video: UFC 331 'Countdown' for Joshua Van vs. Alexandre Pantoja 2",
            "MMA Junkie"),
        (7, "Video: UFC 331 'Countdown' for Arman Tsarukyan vs. Mauricio Ruffy",
            "MMA Junkie"),
    ])
    check("a prefix template does not merge two different fights",
          cards[1][0] is False)

    # 9. A terse headline pair still merges on an identical cast.
    terse = feed([
        (0, "Jean Silva taps Jose Delgado", "MMA Fighting"),
        (12, "Jean Silva submits Jose Delgado", "Sherdog"),
    ])
    check("terse path catches taps/submits", terse[1][0] is True)

    # 10. Accents, strokes, and the roster being wrong about nobody.
    w = Window([], _merge_cfg(None))
    a = names_in(clean("Jiri Prochazka stops Jan Blachowicz"), w)[0]
    b = names_in(clean("Ji\u0159\u00ed Proch\u00e1zka stops Jan B\u0142achowicz"), w)[0]
    check("accented and bare spellings give the same names",
          a == b == ["prochazka", "blachowicz"])
    check("stemmer collides vacate/vacates/vacating",
          stem("vacates") == stem("vacate") == stem("vacating"))
    check("unrostered fighters are still seen",
          "hokit" in names_in(clean("Josh Hokit demands a title shot"), w)[0])
    check("possessives do not make a phantom entity",
          names_in(clean("Tom Aspinall's belt"), w)[0] == ["aspinall"])

    # 11. An exact repost is refused long after the fuzzy window closes.
    ex = feed([
        (0, "Islam Makhachev fires Back at Shavkat Rakhmonov over UFC title "
            "snub", "Sherdog"),
        (19 * 60 + 19, "Islam Makhachev fires Back at Shavkat Rakhmonov over "
                       "UFC title snub", "Sherdog"),
    ])
    check("a byte-identical repost 19.3h later is refused", ex[1][0] is True)

    # 12. Purity, JSON-safety, junk tolerance, cold start, kill switch.
    recent = []
    remember(recent, "Islam Makhachev defends title", "Sherdog", t0)
    before = json.dumps(recent, sort_keys=True)
    is_duplicate("Something else entirely happens", "X", t0, recent)
    after = json.dumps(strip_cache(recent), sort_keys=True)
    check("remember() rows are JSON-serialisable", before == after)
    check("cluster ids are content-derived",
          recent[0]["cluster"] == _cluster_id("Islam Makhachev defends title", t0))
    check("empty history never drops",
          is_duplicate("Anything at all", "X", t0, [])[0] is False)
    check("junk rows tolerated",
          is_duplicate("Anything at all", "X", t0,
                       [{}, {"title": None}, {"title": 7, "ts": "x"},
                        "not a dict", {"title": "ok", "ts": "nonsense"}])[0]
          is False)
    check("kill switch",
          is_duplicate("Tom Aspinall vacates UFC heavyweight title", "Y", t0,
                       [{"title": "Tom Aspinall vacates UFC heavyweight title",
                         "ts": t0.isoformat()}],
                       {"dedupe": {"enabled": False}})[0] is False)
    check("a JSON true is never a threshold",
          _merge_cfg({"dedupe": {"max_age_hours": True}})["max_age_hours"]
          == DEFAULTS["max_age_hours"])
    check("validate_dedupe_cfg flags a boolean threshold",
          any("max_age_hours" in m
              for m in validate_dedupe_cfg({"dedupe": {"max_age_hours": True}})))
    check("validate_dedupe_cfg passes the shipped defaults",
          validate_dedupe_cfg({"dedupe": DEFAULTS}) == [])
    check("a future-dated row is not history",
          is_duplicate("Tom Aspinall vacates UFC heavyweight title", "Y", t0,
                       [{"title": "Tom Aspinall vacates UFC heavyweight title",
                         "ts": (t0 + timedelta(hours=2)).isoformat()}])[0]
          is False)
    check("an unusable timestamp keeps the story",
          is_duplicate("Tom Aspinall vacates UFC heavyweight title", "Y",
                       "not a date",
                       [{"title": "Tom Aspinall vacates UFC heavyweight title",
                         "ts": t0.isoformat()}])[0] is False)

    # 13. story_key is a signature, not the decision.
    k1 = story_key("Tom Aspinall vacates UFC heavyweight title")
    k2 = story_key("Tom Aspinall announces he is vacating the title after an "
                   "eye injury")
    check("story_key agrees on people and event",
          k1[0] == k2[0] and bool(k1[1] & k2[1]))
    check("story_key is not used as equality", k1 != k2)
    check("story_key is deterministic",
          story_key("Tom Aspinall vacates UFC heavyweight title") == k1)

    print("%d/%d checks passed" % (ok[0], ok[0] + len(bad)))
    for b_ in bad:
        print("  FAIL:", b_)
    return not bad


if __name__ == "__main__":
    raise SystemExit(0 if _selftest() else 1)
