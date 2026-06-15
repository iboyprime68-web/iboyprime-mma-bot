#!/usr/bin/env python3
"""iBoyPrime HQ - Moderation setup (run once / re-runnable).

Two jobs, both via the Discord REST API (no bot needs to stay online):
  1. RULES - keeps ONE clean, conduct-focused ruleset in the rules channel.
  2. AUTOMOD - creates Discord's native Auto Moderation rules, now driven by
     modconfig.json so each filter CATEGORY is its own rule, scoped PER CHANNEL via
     `exempt_channels`. A rule is "on" everywhere except the channels whose profile
     doesn't include that category - so one channel can be "anything goes" while
     another is "SFW-only, no slurs/links". These run server-side in REAL TIME and
     keep working with no bot connected - the real-time layer that replaces Sapphire.

Reads bots_config.json + modconfig.json (materialises sensible defaults on first
run; deep-merges so owner edits are never clobbered). Std-lib only. Idempotent.
"""
import common
import modconfig

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
IBP_PREFIX = "iBP · "      # all our AutoMod rule names start with this (used to prune stale ones)
EXEMPT_CAP = 50            # Discord hard limit: <=50 exempt channels per rule


def me_id():
    code, me = common.discord("GET", "/users/@me")
    return me.get("id") if isinstance(me, dict) else None


def reset_rules(rules_ch):
    """Keep exactly ONE rules message: edit the bot's existing one in place (so it
    isn't re-posted/re-pinged every deploy), delete any duplicate rule posts from
    earlier deploys, or post fresh if none exists."""
    bot_id = me_id()
    code, msgs = common.discord("GET", "/channels/%s/messages?limit=50" % rules_ch)
    bot_msgs = [m for m in (msgs if isinstance(msgs, list) else [])
                if (m.get("author") or {}).get("id") == bot_id]
    if bot_msgs:
        keep = bot_msgs[0]                       # API returns newest first
        if keep.get("content") != RULES_TEXT:
            common.discord("PATCH", "/channels/%s/messages/%s" % (rules_ch, keep["id"]),
                           {"content": RULES_TEXT})
            print("  rules: edited the existing message in place")
        else:
            print("  rules: already current (no change)")
        dupes = 0
        for m in bot_msgs[1:]:                    # remove leftover duplicate rule posts
            c, _ = common.discord("DELETE", "/channels/%s/messages/%s" % (rules_ch, m["id"]))
            if c in (200, 204):
                dupes += 1
        if dupes:
            print("  rules: removed %d duplicate rule post(s)" % dupes)
    else:
        code, _ = common.post_message(rules_ch, RULES_TEXT)
        print("  rules: posted fresh ruleset (HTTP %s)" % code)


# ---- AutoMod actions -------------------------------------------------------
def block(msg):
    return {"type": 1, "metadata": {"custom_message": msg[:150]}}


def alert(ch):
    return {"type": 2, "metadata": {"channel_id": str(ch)}}


# ---- AutoMod rule building (driven by modconfig) ---------------------------
def all_text_channels(guild):
    """Every text/announcement channel id in the guild - the universe a rule
    applies to before exemptions. New channels (created after deploy) aren't here,
    so they're never exempt -> moderated by default = secure."""
    code, chans = common.discord("GET", "/guilds/%s/channels" % guild)
    if not isinstance(chans, list):
        return []
    return [str(c["id"]) for c in chans if c.get("type") in (0, 5)]


def _truncate_exempt(ids, name):
    ids = sorted(set(str(i) for i in ids))
    if len(ids) > EXEMPT_CAP:
        print("  ! '%s' wants %d exempt channels (>%d cap) - keeping the first %d; "
              "the patrol covers the rest." % (name, len(ids), EXEMPT_CAP, EXEMPT_CAP))
        ids = ids[:EXEMPT_CAP]
    return ids


def compute_exempt(modcfg, category, all_ids, name=""):
    """Channels that should NOT have this category enforced = every channel whose
    resolved profile doesn't include the category."""
    exempt = [cid for cid in all_ids
              if category not in modconfig.resolve_channel(modcfg, cid)["categories"]]
    return _truncate_exempt(exempt, name or category)


def compute_preset_exempt(modcfg, all_ids, name=""):
    """The preset net covers slurs + sexual together, so a channel is exempt only
    when it allows BOTH (no slurs AND no nsfw_text category)."""
    exempt = []
    for cid in all_ids:
        cats = modconfig.resolve_channel(modcfg, cid)["categories"]
        if "slurs" not in cats and "nsfw_text" not in cats:
            exempt.append(cid)
    return _truncate_exempt(exempt, name or "preset")


def compute_unmoderated_exempt(modcfg, all_ids, name=""):
    """Channels with no categories at all (anything-goes) are exempt from the
    blanket spam / mention-spam rules too."""
    exempt = [cid for cid in all_ids
              if not modconfig.resolve_channel(modcfg, cid)["categories"]]
    return _truncate_exempt(exempt, name or "unmoderated")


def keyword_rule(catcfg, exempt_channels, exempt_roles, mod_log):
    meta = {}
    words = [w for w in (catcfg.get("words") or []) if w][:1000]
    regex = [r for r in (catcfg.get("regex") or []) if r][:10]
    if words:
        meta["keyword_filter"] = words
    if regex:
        meta["regex_patterns"] = regex
    return {
        "name": catcfg["rule_name"], "event_type": 1, "trigger_type": 1,
        "trigger_metadata": meta,
        "actions": [block(catcfg.get("block_msg", "Not allowed in this channel."))]
                   + ([alert(mod_log)] if mod_log else []),
        "exempt_channels": exempt_channels,
        "exempt_roles": [str(r) for r in exempt_roles],
        "enabled": True,
    }


def build_rules(modcfg, all_ids, mod_log, exempt_roles):
    """Assemble the full AutoMod rule set from modconfig (<=6 KEYWORD + presets/
    spam/mention/profile, all within Discord's per-trigger limits)."""
    rules = []
    cats = modcfg.get("categories", {}) or {}
    for key in modconfig.CATEGORIES:                 # up to 6 KEYWORD rules
        catcfg = cats.get(key)
        if not catcfg:
            continue
        words = [w for w in (catcfg.get("words") or []) if w]
        regex = [r for r in (catcfg.get("regex") or []) if r]
        if not words and not regex:
            continue   # nothing to match -> skip (the preset net / patrol cover it)
        exempt = compute_exempt(modcfg, key, all_ids, catcfg.get("rule_name", key))
        rules.append(keyword_rule(catcfg, exempt, exempt_roles, mod_log))

    g = modcfg.get("global_rules", {}) or {}
    a_alert = [alert(mod_log)] if mod_log else []
    er = [str(r) for r in exempt_roles]

    ps = g.get("preset_safety", {}) or {}
    if ps.get("enabled", True):
        rules.append({
            "name": "iBP · Hate & adult (preset)", "event_type": 1, "trigger_type": 4,
            "trigger_metadata": {"presets": ps.get("presets", [2, 3])},
            "actions": [block("That content isn't allowed in this channel.")] + a_alert,
            "exempt_channels": compute_preset_exempt(modcfg, all_ids, "Hate & adult (preset)"),
            "exempt_roles": er, "enabled": True,
        })

    sp = g.get("spam", {}) or {}
    if sp.get("enabled", True):
        rules.append({
            "name": "iBP · Spam", "event_type": 1, "trigger_type": 3, "trigger_metadata": {},
            "actions": [block("That looked like spam and was blocked.")] + a_alert,
            "exempt_channels": compute_unmoderated_exempt(modcfg, all_ids, "Spam"),
            "exempt_roles": er, "enabled": True,
        })

    ms = g.get("mention_spam", {}) or {}
    if ms.get("enabled", True):
        rules.append({
            "name": "iBP · Mention spam", "event_type": 1, "trigger_type": 5,
            "trigger_metadata": {"mention_total_limit": int(ms.get("limit", 6))},
            "actions": [block("Too many mentions in one message.")] + a_alert,
            "exempt_channels": compute_unmoderated_exempt(modcfg, all_ids, "Mention spam"),
            "exempt_roles": er, "enabled": True,
        })

    mp = g.get("member_profile", {}) or {}
    mp_words = [w for w in (mp.get("words") or []) if w]
    if mp.get("enabled") and mp_words:
        rules.append({
            "name": "iBP · Profile filter", "event_type": 2, "trigger_type": 6,
            "trigger_metadata": {"keyword_filter": mp_words[:1000]},
            "actions": [{"type": 4, "metadata": {}}],   # BLOCK_MEMBER_INTERACTION
            "exempt_roles": er, "enabled": True,
        })
    return rules


def sync_rules(guild, rules):
    """Create/patch each rule by name (idempotent) and prune any leftover 'iBP · '
    rules that are no longer wanted (e.g. the old combined 'Hate & adult filter')."""
    code, existing = common.discord("GET", "/guilds/%s/auto-moderation/rules" % guild)
    existing = existing if isinstance(existing, list) else []
    by_name = {r.get("name"): r for r in existing}
    wanted = {r["name"] for r in rules}
    made = updated = pruned = 0
    for rule in rules:
        cur = by_name.get(rule["name"])
        if cur:
            patch = {k: rule[k] for k in ("trigger_metadata", "actions", "enabled",
                                          "exempt_roles", "exempt_channels") if k in rule}
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
    for name, r in by_name.items():
        if name and name.startswith(IBP_PREFIX) and name not in wanted:
            c, _ = common.discord("DELETE", "/guilds/%s/auto-moderation/rules/%s" % (guild, r["id"]))
            if c in (200, 204):
                pruned += 1; print("  automod - pruned stale rule:", name)
    print("  automod: created=%d updated=%d pruned=%d" % (made, updated, pruned))
    return made, updated, pruned


def load_or_seed_modconfig(cfg):
    """Load modconfig.json (merged over defaults); on first run seed channels from
    bots_config + persist so the file materialises for upload. Always re-saves the
    merged result so new default keys land in the repo copy (idempotent)."""
    raw = common.load_json(common.state_path(modconfig.MODCONFIG_FILE), None)
    modcfg = modconfig.load()
    if raw is None:
        modcfg = modconfig.seed_channels_from(modcfg, cfg)
        print("  modconfig.json not found - wrote sensible per-channel defaults "
              "(tweak them in MOD_PANEL.bat or with /mod).")
    modconfig.save(modcfg)
    return modcfg


def main():
    cfg = common.load_config()
    guild = cfg["guild_id"]
    ch = cfg.get("channels", {})
    roles = cfg.get("roles", {})
    rules_ch = ch.get("rules")
    mod_log = ch.get("mod_log")
    exempt_roles = [roles[k] for k in ("owner", "admin", "mod") if roles.get(k)]

    print("Moderation setup for guild", guild)
    modcfg = load_or_seed_modconfig(cfg)

    if rules_ch:
        reset_rules(rules_ch)
    else:
        print("  ! no rules channel in config - skipped rules post")

    all_ids = all_text_channels(guild)
    if not all_ids:
        print("  ! couldn't list channels - AutoMod rules will apply guild-wide (no per-channel scoping)")
    rules = build_rules(modcfg, all_ids, mod_log, exempt_roles)
    sync_rules(guild, rules)
    print("DONE. Per-channel AutoMod active (%d rules over %d channels); rules posted."
          % (len(rules), len(all_ids)))


if __name__ == "__main__":
    main()
