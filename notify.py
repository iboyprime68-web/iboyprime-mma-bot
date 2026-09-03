"""Who gets pinged, how loudly, and never twice for the same story.

THE BUG THIS EXISTS TO FIX
--------------------------
Every news post since the August 2026 declutter carried Discord flag 4096
(SUPPRESS_NOTIFICATIONS). The expression was

    silent = (mode == "hybrid" and not (breaking and news_rid))

and `news_rid` came from bots_config["roles"]["news_pings"] - a role the same
declutter DELETED. So `news_rid` was permanently None, `silent` was permanently
True, and the owner's phone never buzzed for a story, including breaking ones.
He read that as "the news is late". Half of it was: the news was late. The other
half was that nothing ever told him it had arrived.

THE CARRIER
-----------
A bot can only make a phone buzz by mentioning something the reader holds. The
owner asked for a ROLE rather than a direct user mention, so that members are
never dragged into his alerts: 'U+1F514 News Alerts' is held by him alone, so
pinging it reaches exactly one person. layout.py creates it and bots_setup grants
it to the guild owner.

Two Discord rules this file obeys, both learned the hard way in this project:
  * NEVER combine the silent flag with a mention. Flag 4096 mutes the mention,
    producing a message that is loud in the code and silent on the device.
  * allowed_mentions must pin the role explicitly. The role is deliberately not
    `mentionable`, so only a bot with Administrator can fire it - which is what
    stops a member from using it.

WHAT THIS CANNOT DO
-------------------
If the owner has MUTED the news channel in his own client, a mention still does
not buzz. No bot can read or change that setting; it is not in any API. The
deploy prints a reminder instead of pretending.
"""

import hashlib

# Tiers. Deliberately only two: a story is either worth interrupting him for or
# it is not. A middle tier would just be a slower way of not deciding.
ALERT = "alert"
QUIET = "quiet"

DEFAULTS = {
    "enabled": True,
    # Reuses the score the staging pipeline already computes (scorer.py, DeepSeek
    # live) and the breaking-keyword net. No new signal is invented here.
    "alert_threshold": 85,
    "alert_on_breaking": True,
    # A hard ceiling, because the model is documented handing 85+ to
    # event-adjacent rehash. Overflow degrades to a silent post - the story still
    # lands in the channel, it just does not interrupt him.
    "max_alerts_per_day": 12,
    # One story, one buzz. The studio staging pings at its own threshold and both
    # read the same ledger, so a big story cannot notify twice.
    "dedupe_hours": 6,
}

LEDGER_KEY = "pinged"        # {sha1(guid)[:16]: epoch} inside state_news.json
LEDGER_CAP = 400


def config(cfg):
    """The notify block merged over DEFAULTS. Same shape as scorer.scoring_config."""
    out = dict(DEFAULTS)
    src = (cfg or {}).get("notify") or {}
    for k, v in src.items():
        if k in out and isinstance(v, type(out[k])):
            out[k] = v
    return out


def _key(guid):
    return hashlib.sha1((guid or "").encode("utf-8")).hexdigest()[:16]


def tier(score, breaking, ncfg):
    """ALERT or QUIET, from the score the pipeline already paid for.

    Breaking is an OR, not a bonus: the keyword net ("stripped of", "pulls out",
    "dies") is a strong signal even when no AI key is configured and the
    heuristic is doing the scoring.
    """
    c = config(ncfg)
    if not c["enabled"]:
        return QUIET
    if breaking and c["alert_on_breaking"]:
        return ALERT
    return ALERT if int(score or 0) >= int(c["alert_threshold"]) else QUIET


def claim(state, guid, now_epoch, ncfg):
    """Reserve the single buzz for this story. True exactly once per story.

    Both news_bot and ytposts call this before pinging. Without it a story
    scoring 92 produces a news mention AND a studio mention - two notifications
    for one piece of news, which is precisely the noise the owner is sensitive
    to. Whoever gets there first wins; the news post is drained first, so the
    fast alert is the one that fires.

    Also enforces the daily ceiling. A day is counted from the ledger itself,
    so nothing extra has to be stored or committed.
    """
    c = config(ncfg)
    if not c["enabled"]:
        return False
    led = state.get(LEDGER_KEY)
    if not isinstance(led, dict):
        led = {}
    k = _key(guid)
    window = float(c["dedupe_hours"]) * 3600.0
    if k in led and (now_epoch - float(led[k] or 0)) < window:
        return False
    day = [1 for v in led.values() if (now_epoch - float(v or 0)) < 86400.0]
    if len(day) >= int(c["max_alerts_per_day"]):
        return False
    led[k] = float(now_epoch)
    if len(led) > LEDGER_CAP:
        led = dict(sorted(led.items(), key=lambda kv: kv[1], reverse=True)[:LEDGER_CAP])
    state[LEDGER_KEY] = led
    return True


def role_mention(role_id):
    """(prefix, allowed_mentions) for a loud post, or ("", None) when there is no
    role to ping. Never returns a mention without a role id: a loud message that
    mentions nobody is just an unread badge, and it costs the calm-mode default
    for nothing."""
    if not role_id:
        return "", None
    return "<@&%s> " % role_id, {"parse": [], "roles": [str(role_id)]}
