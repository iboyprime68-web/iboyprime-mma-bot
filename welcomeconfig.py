#!/usr/bin/env python3
"""Prime Arena - welcome message config (the single source of truth for 👋┊welcome).

`welcomeconfig.json` holds the words of the pinned welcome+rules message AND the
creator's social links. It is the OWNER's file: the Control Panel's "👋 Welcome"
tab writes it, mod_setup.py renders the posted message from it, and the Worker's
/links command reads the same `links` list so the two can never drift apart again.
(They did: the TikTok URL was hard-coded in two places and both were wrong.)

It holds ONLY prose and public URLs - never a secret - so it is safe in the public
repo and passes deploy_bots.scan_for_secrets(). Std-lib only (+ common, modconfig).

Division of labour, and the reason this file is shaped the way it is:

  STRUCTURE IS OURS. The "# Welcome to <name>" heading, the "## Rules" / "## Links"
  headings, the "**N.**" rule numbering and the <> wrappers that stop Discord
  unfurling every link are emitted by render() below. The owner cannot delete or
  mistype them, and an empty section takes its own heading with it.

  PROSE IS THE OWNER'S. intro / rules_lead / rules / outro / links. prose_warnings()
  reports no-ai-slop style issues but NEVER blocks a save - those rules exist to keep
  the developer's writing honest, not to grade the owner's own words. Only
  validate_welcomeconfig() blocks, and only on things that genuinely break the
  message (length, bad URLs, mass pings, unknown placeholders, leaked secrets).
"""
import re
import common
from modconfig import deep_merge   # generic dict merge - reuse, don't duplicate

WELCOMECONFIG_FILE = "welcomeconfig.json"

# common.post_message truncates at 1990, so that is the real ceiling for the whole
# rendered message. Discord's own limit is 2000; the 10 is the margin common keeps.
MAX_LEN = 1990
MIN_LEN = 120                       # anything shorter means the owner emptied it by accident

# Placeholders the owner may type. Anything else is a blocking error, so a literal
# "{foo}" can never reach members.
TOKENS = ("server", "general", "tickets")

# Renderer-owned structure. Never owner-editable.
RULES_HEADING = "## Rules"
LINKS_HEADING = "## Links"

# Worst-case ids for a preview/estimate: a real <#id> chip is 22 chars, the plain-text
# fallback ("the chat") is 8. Estimating with the SHORT one would let the owner sail
# past 1990 and only find out at deploy time.
PREVIEW_TOKENS = {"server": "My Cool Server",
                  "general": "<#%s>" % ("0" * 19),
                  "tickets": "<#%s>" % ("0" * 19)}

# ---- developer defaults (lifted verbatim from the shipped message) -----------
DEFAULT_INTRO = ("Gaming, MMA, and iBoyPrime's streams. Every channel is open to you "
                 "the moment you join. There are no roles to pick and nothing to "
                 "unlock. Say hi in {general}.")
DEFAULT_RULES_LEAD = "Banter and trash talk are fine. These ten are not."
DEFAULT_RULES = [
    "Respect everyone. No harassment, hate, bullying or personal attacks. Argue "
    "about the fight, not the person.",
    "No backbiting. Don't run someone down behind their back or repeat their private "
    "business. If you have a problem with someone, say it to them or bring it to staff.",
    "No mocking. Nothing aimed at anyone's looks, beliefs, background or personal "
    "struggles.",
    "Stay humble. Nobody came here to watch you brag, flex or talk down to them.",
    "Be honest. No lying, scamming, baiting or setting people up.",
    "Keep it clean. No slurs and no NSFW. Swearing in banter passes; a foul mouth "
    "does not.",
    "No gambling or betting. That covers wagers between members, betting promos, and "
    "links to bookmakers.",
    "No spam or self-promo. No mass pings, no advertising in DMs, no invites to other "
    "servers.",
    "Respect privacy. Nobody's personal details, DMs or screenshots get posted "
    "without their say-so.",
    "Keep it legal, post in the right channel, and do what staff ask.",
]
DEFAULT_OUTRO = ("Breaking one of these gets a warning, a timeout, or a ban, depending "
                 "on what you did. Bring anything that needs staff to {tickets}.")
# The ONE list of social links. worker.js keeps a byte-identical fallback copy for the
# case where it cannot reach the repo; a selftest asserts the two match.
DEFAULT_LINKS = [
    {"label": "YouTube",   "url": "https://youtube.com/@iboyprime_official"},
    {"label": "Twitch",    "url": "https://twitch.tv/iboyprime"},
    {"label": "Kick",      "url": "https://kick.com/iboyprime"},
    {"label": "TikTok",    "url": "https://www.tiktok.com/@iboyprime_official"},
    {"label": "Instagram", "url": "https://www.instagram.com/iboyprime_official/"},
]
DEFAULT_INVITE_LABEL = "Invite a friend:"

# The owner's hard rule (no betting/gambling content, ever). Re-inserted by load() and
# by the panel's collector if it is ever deleted, the same way mod_panel.collect_news
# always keeps the betting terms in the news exclude list.
BETTING_RULE = ("No gambling or betting. That covers wagers between members, betting "
                "promos, and links to bookmakers.")


def base_defaults():
    """A complete default welcomeconfig."""
    import copy
    return {
        "version": 1,
        "intro": DEFAULT_INTRO,
        "rules_lead": DEFAULT_RULES_LEAD,
        "rules": list(DEFAULT_RULES),
        "outro": DEFAULT_OUTRO,
        "links": copy.deepcopy(DEFAULT_LINKS),
        "invite_label": DEFAULT_INVITE_LABEL,
        "_note": ("Your own words + public links only. NEVER paste a bot token, GitHub "
                  "token, or any config.txt value here - it's uploaded to the PUBLIC "
                  "repo. {server}, {general} and {tickets} are filled in for you, and "
                  "the headings, the rule numbers and the <> around links are added "
                  "automatically."),
    }


def ensure_required_rules(wcfg):
    """Put the gambling/betting rule back if it went missing. Returns wcfg (mutated).

    Not negotiable: the server's owner asked for no betting content anywhere, so the
    rule that says so cannot be edited out by accident. Everything else is fair game.
    """
    rules = wcfg.get("rules")
    if not isinstance(rules, list):
        rules = []
    if not any("gambling" in str(r).lower() and "betting" in str(r).lower() for r in rules):
        rules = list(rules) + [BETTING_RULE]
    wcfg["rules"] = [str(r) for r in rules]
    return wcfg


def load(path=None):
    """welcomeconfig.json merged OVER defaults (existing values win, new default keys
    are added). Pure defaults if the file is absent, so nothing depends on it existing.

    Note `rules` and `links` are LISTS, and deep_merge lets a list override wholesale.
    That is deliberate: as dicts, deleting a link would write a dict without it and the
    next load() would merge the default straight back in - removal would look like it
    worked and silently fail.
    """
    p = path or common.state_path(WELCOMECONFIG_FILE)
    existing = common.load_json(p, None)
    base = base_defaults()
    merged = deep_merge(base, existing) if isinstance(existing, dict) else base
    return ensure_required_rules(merged)


def save(wcfg, path=None):
    common.save_json(path or common.state_path(WELCOMECONFIG_FILE), wcfg)


# ---- rendering (pure, tested) ----------------------------------------------
def discord_len(text):
    """Length the way DISCORD counts it: UTF-16 code units, not Python code points.

    An emoji is 1 to Python and 2 to Discord, so a naive len() can pass 1990 and still
    get the message truncated mid-link by common.post_message. Used by the counter, the
    validator and mod_setup so all three agree on the number.
    """
    return len((text or "").encode("utf-16-le")) // 2


def render_tokens(text, tokens):
    """Substitute {server} / {general} / {tickets}.

    str.replace ONLY. Owner text will contain a % or a { sooner or later, and both
    %-formatting and str.format would raise on it - inside mod_setup, mid-deploy.
    """
    out = text or ""
    for key, val in (tokens or {}).items():
        out = out.replace("{%s}" % key, str(val))
    return out


_FIRST_SENTENCE = re.compile(r"^\s*(.+?\.)(\s+)(.*)$", re.S)


def render_rule(n, text):
    """One numbered rule line: the first sentence becomes the bold title.

    'Be honest. No lying.' -> '**5. Be honest.** No lying.'
    A rule with no sentence break is bolded whole, which is how rule 10 already reads.
    """
    text = (text or "").strip()
    if not text:
        return ""
    m = _FIRST_SENTENCE.match(text)
    if m:
        return "**%d. %s** %s\n" % (n, m.group(1).strip(), m.group(3).strip())
    return "**%d. %s**\n" % (n, text)


def clean_links(wcfg):
    """The links that are safe to render: a label plus an https:// address.

    One filter, consulted by the renderer AND the validator, so what you preview is
    exactly what posts.
    """
    out = []
    for entry in (wcfg.get("links") or []):
        if not isinstance(entry, dict):
            continue
        label, url = str(entry.get("label") or "").strip(), str(entry.get("url") or "").strip()
        if label and url.startswith("https://"):
            out.append({"label": label, "url": url})
    return out


def render(wcfg, tokens=None, invite_url=""):
    """The complete welcome+rules+links message. Pure: no config read, no network.

    Sections that are empty are skipped along with their heading, so the owner can
    never end up with a bare '## Links' and nothing under it.
    """
    tokens = tokens if tokens is not None else PREVIEW_TOKENS
    parts = ["# Welcome to %s\n" % tokens.get("server", "")]

    intro = render_tokens(wcfg.get("intro"), tokens).strip()
    if intro:
        parts.append(intro + "\n\n")

    rules = [r for r in (wcfg.get("rules") or []) if str(r).strip()]
    if rules:
        parts.append(RULES_HEADING + "\n")
        lead = render_tokens(wcfg.get("rules_lead"), tokens).strip()
        if lead:
            parts.append(lead + "\n\n")
        for i, rule in enumerate(rules, 1):
            parts.append(render_rule(i, render_tokens(rule, tokens)))
        parts.append("\n")

    outro = render_tokens(wcfg.get("outro"), tokens).strip()
    if outro:
        parts.append(outro + "\n\n")

    links = clean_links(wcfg)
    if links:
        parts.append(LINKS_HEADING + "\n")
        for link in links:
            parts.append("%s: <%s>\n" % (link["label"], link["url"]))

    invite = (invite_url or "").strip()
    if invite:
        label = (wcfg.get("invite_label") or DEFAULT_INVITE_LABEL).strip()
        parts.append("%s <%s>\n" % (label, invite))

    return "".join(parts).rstrip()


# ---- no-ai-slop style rules (advisory) --------------------------------------
# Source: github.com/realrossmanngroup/no_ai_slop_writing_rules. These live here rather
# than in the selftest because three callers need them: the CI lint (strict, on OUR
# defaults), the Control Panel (a grey hint while the owner types), and any future
# checker. One list, one place.
BANNED_WORDS = ("delve", "leverage", "utilize", "utilise", "facilitate", "foster",
                "bolster", "underscore", "unveil", "streamline", "seamless", "robust",
                "comprehensive", "cutting-edge", "groundbreaking", "pivotal",
                "transformative", "myriad", "plethora", "paramount", "prior to",
                "subsequent to", "in terms of", "the fact that")
BANNED_PHRASES = ("in today's", "it's important to note", "when it comes to",
                  "at the end of the day", "in the realm of", "it goes without saying",
                  "look no further", "that being said", "furthermore", "moreover",
                  "in essence", "at its core", "to put it simply", "whether you're",
                  "dive in", "let's delve")
INTENSIFIERS = ("extremely", "dramatically", "incredibly", "remarkably", "truly",
                "absolutely", "literally", "significantly", "undoubtedly")


def prose_warnings(text, allow_exclamations=False):
    """Style notes for a member-facing string. NEVER blocks anything.

    Returns readable strings like 'em dash (rule 1)' or 'banned word: delve'.
    """
    notes = []
    low = (text or "").lower()
    if "—" in (text or ""):
        notes.append("em dash (rule 1)")
    for word in BANNED_WORDS + BANNED_PHRASES + INTENSIFIERS:
        if word in low:
            notes.append("banned word or filler: %s" % word)
    if not allow_exclamations and "!" in (text or ""):
        notes.append("exclamation mark (rule 14, no synthetic enthusiasm)")
    return notes


# ---- validation (GUI + deploy safety) ---------------------------------------
_PLACEHOLDER = re.compile(r"\{([a-zA-Z_]+)\}")
_BAD_IN_URL = re.compile(r"[\s<>\"']")
_OWNER_TEXT_KEYS = ("intro", "rules_lead", "outro", "invite_label")


def owner_text(wcfg):
    """Every string the owner typed, joined - what the placeholder/ping checks scan."""
    parts = [str(wcfg.get(k) or "") for k in _OWNER_TEXT_KEYS]
    parts += [str(r) for r in (wcfg.get("rules") or [])]
    parts += [str(l.get("label") or "") for l in (wcfg.get("links") or []) if isinstance(l, dict)]
    return "\n".join(parts)


def validate_welcomeconfig(wcfg, secret_values=(), tokens=None):
    """Return a list of BLOCKING problems (empty = safe to save). Mirrors
    validate_newsconfig: shape checks, then the same config.txt secret sweep.

    Style is not in here on purpose - see prose_warnings().
    """
    problems = []
    rendered = render(wcfg, tokens or PREVIEW_TOKENS)
    size = discord_len(rendered)
    if size > MAX_LEN:
        problems.append("The welcome message is %d characters. Discord's limit is %d, "
                        "so trim about %d." % (size, MAX_LEN, size - MAX_LEN))
    elif size < MIN_LEN:
        problems.append("The welcome message is almost empty (%d characters)." % size)

    if not [r for r in (wcfg.get("rules") or []) if str(r).strip()]:
        problems.append("There are no rules left. Add at least one.")

    for entry in (wcfg.get("links") or []):
        if not isinstance(entry, dict):
            problems.append("A link entry is malformed. Use 'Label = https://address'.")
            continue
        label = str(entry.get("label") or "").strip()
        url = str(entry.get("url") or "").strip()
        if not label:
            problems.append("A link has no name: %s" % (url or "(blank)"))
        if not url.startswith("https://"):
            problems.append("Link '%s': the address must start with https:// ." % (label or url))
        elif _BAD_IN_URL.search(url):
            # The renderer wraps every URL in <> to stop Discord unfurling it; a stray
            # space or > breaks straight out of that wrapper.
            problems.append("Link '%s': the address cannot contain spaces or < > quotes." % label)

    blob = owner_text(wcfg)
    for ping in ("@everyone", "@here"):
        if ping in blob:
            problems.append("Remove %s from the welcome text - it would ping the whole "
                            "server on every edit." % ping)
    for name in sorted(set(_PLACEHOLDER.findall(blob))):
        if name not in TOKENS:
            problems.append("Unknown placeholder {%s}. Use {%s}." % (name, "}, {".join(TOKENS)))

    import json as _json
    full = _json.dumps(wcfg)
    for val in secret_values:
        if val and len(val) >= 12 and val in full:
            problems.append("A SECRET from config.txt appears in the welcome config - "
                            "remove it. This file is uploaded to the PUBLIC repo.")
            break
    return problems
