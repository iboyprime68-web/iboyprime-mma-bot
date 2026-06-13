#!/usr/bin/env python3
"""iBoyPrime HQ - Moderation setup (run once / re-runnable).

Two jobs, both via the Discord REST API (no bot needs to stay online):
  1. RULES - clears the rules channel (fixes duplicate rule posts) and posts one
     clean, conduct-focused ruleset.
  2. AUTOMOD - creates Discord's native Auto Moderation rules. These run
     server-side in REAL TIME (spam, mention-spam, slurs/adult presets, server
     invites, scam links) and keep working even with no bot connected - this is
     the real-time layer that replaces most of Sapphire.

Reads bots_config.json. Std-lib only. Idempotent.
"""
import common

RULES_TEXT = (
    "# 📜 iBoyPrime HQ — Server Rules\n\n"
    "We keep this a place people actually want to hang out. Banter and trash talk are "
    "welcome — crossing the lines below isn't.\n\n"
    "**1. Respect everyone.** No harassment, hate, bullying, or personal attacks. "
    "Disagree without making it personal.\n"
    "**2. No backbiting or rumour-spreading.** Don't run people down behind their backs "
    "or air others' private business. Got an issue with someone? Sort it directly or bring it to staff.\n"
    "**3. Don't mock or belittle.** No ridiculing anyone's appearance, beliefs, background, "
    "or struggles. Jokes land *with* people, not *at* them.\n"
    "**4. Stay humble.** This isn't the place to brag, flex, or talk down to people. Hype others up.\n"
    "**5. Be honest.** No lying, scamming, baiting, or deceiving members.\n"
    "**6. Keep it clean.** No slurs and no NSFW/explicit content. Light swearing in banter is fine — "
    "a foul mouth isn't.\n"
    "**7. No gambling or betting.** No wagers, betting promos, or gambling links.\n"
    "**8. No spam or unsolicited self-promo.** No mass pings, ad-DMs, or links to other servers.\n"
    "**9. Respect privacy.** Don't share anyone's personal info, DMs, or screenshots without their okay.\n"
    "**10. Keep it legal, use the right channels, and listen to staff.** We're one fam — "
    "represent iBoyPrime well.\n\n"
    "_Breaking these can mean a warning, timeout, or removal depending on severity. "
    "See something off? Ping staff._"
)


def me_id():
    code, me = common.discord("GET", "/users/@me")
    return me.get("id") if isinstance(me, dict) else None


def reset_rules(rules_ch):
    """Delete existing messages in the rules channel, then post the fresh ruleset."""
    code, msgs = common.discord("GET", "/channels/%s/messages?limit=50" % rules_ch)
    deleted = 0
    if isinstance(msgs, list):
        for m in msgs:
            mid = m.get("id")
            if not mid:
                continue
            c, _ = common.discord("DELETE", "/channels/%s/messages/%s" % (rules_ch, mid))
            if c in (200, 204):
                deleted += 1
    code, _ = common.post_message(rules_ch, RULES_TEXT)
    print("  rules: cleared %d old message(s), posted fresh ruleset (HTTP %s)" % (deleted, code))


# ---- AutoMod ---------------------------------------------------------------
def block(msg):
    return {"type": 1, "metadata": {"custom_message": msg[:150]}}


def alert(ch):
    return {"type": 2, "metadata": {"channel_id": str(ch)}}


def automod_rules(guild, mod_log, exempt):
    a_alert = [alert(mod_log)] if mod_log else []
    rules = [
        {"name": "iBP · Spam", "event_type": 1, "trigger_type": 3,
         "trigger_metadata": {}, "actions": [block("That looked like spam and was blocked.")] + a_alert},
        {"name": "iBP · Mention spam", "event_type": 1, "trigger_type": 5,
         "trigger_metadata": {"mention_total_limit": 6},
         "actions": [block("Too many mentions in one message.")] + a_alert},
        {"name": "iBP · Hate & adult filter", "event_type": 1, "trigger_type": 4,
         "trigger_metadata": {"presets": [2, 3]},   # SEXUAL_CONTENT, SLURS
         "actions": [block("That content isn't allowed here.")] + a_alert},
        {"name": "iBP · No server ads/invites", "event_type": 1, "trigger_type": 1,
         "trigger_metadata": {"regex_patterns": [
             r"discord\.gg/[A-Za-z0-9]+", r"discord(app)?\.com/invite/[A-Za-z0-9]+",
             r"\.gg/[A-Za-z0-9]{2,}"]},
         "actions": [block("Server invites/ads aren't allowed here.")] + a_alert},
        {"name": "iBP · Scam filter", "event_type": 1, "trigger_type": 1,
         "trigger_metadata": {"keyword_filter": [
             "free nitro", "nitro for free", "*steamcommunity*", "*free-nitro*",
             "crypto giveaway", "claim your prize", "*t.me/*", "*airdrop*", "*-gift.*"]},
         "actions": [block("That looked like a scam and was blocked.")] + a_alert},
    ]
    code, existing = common.discord("GET", "/guilds/%s/auto-moderation/rules" % guild)
    by_name = {r.get("name"): r for r in existing} if isinstance(existing, list) else {}
    made = updated = 0
    for rule in rules:
        rule["enabled"] = True
        rule["exempt_roles"] = [str(r) for r in exempt]
        cur = by_name.get(rule["name"])
        if cur:
            patch = {k: rule[k] for k in ("trigger_metadata", "actions", "enabled", "exempt_roles")}
            c, _ = common.discord("PATCH", "/guilds/%s/auto-moderation/rules/%s" % (guild, cur["id"]), patch)
            if c in (200, 201):
                updated += 1; print("  automod ~ updated:", rule["name"])
            else:
                print("  automod ! patch failed:", rule["name"], c)
        else:
            c, resp = common.discord("POST", "/guilds/%s/auto-moderation/rules" % guild, rule)
            if c in (200, 201):
                made += 1; print("  automod + created:", rule["name"])
            else:
                print("  automod ! create failed:", rule["name"], c, str(resp)[:160])
    print("  automod: created=%d updated=%d" % (made, updated))


def main():
    cfg = common.load_config()
    guild = cfg["guild_id"]
    ch = cfg.get("channels", {})
    roles = cfg.get("roles", {})
    rules_ch = ch.get("rules")
    mod_log = ch.get("mod_log")
    exempt = [roles[k] for k in ("owner", "admin", "mod") if roles.get(k)]

    print("Moderation setup for guild", guild)
    if rules_ch:
        reset_rules(rules_ch)
    else:
        print("  ! no rules channel in config - skipped rules post")
    automod_rules(guild, mod_log, exempt)
    print("DONE. Real-time AutoMod active; rules posted.")


if __name__ == "__main__":
    main()
