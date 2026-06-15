#!/usr/bin/env python3
"""iBoyPrime HQ - per-channel moderation config (the single source of truth).

`modconfig.json` decides, for every channel, WHICH of the 6 filter categories
apply, the media/link policy, the spam thresholds, plus the raid + image-scan
settings. It holds ONLY channel/role IDs + words + numbers - never a secret -
so it is safe in the public repo and passes deploy_bots.scan_for_secrets().

This module is imported by mod_setup.py (builds AutoMod rules from it), mod_bot.py
(patrol enforcement), image_scan.py, raid_bot.py and the local GUI (mod_panel.py).
Std-lib only (+ common.py for load/save). The matching JS lives in the Worker.
"""
import copy
import common

# The closed set of filter categories. Exactly 6 so they map 1:1 onto Discord's
# hard limit of 6 KEYWORD AutoMod rules. Do NOT add a 7th without dropping one.
CATEGORIES = ["slurs", "nsfw_text", "profanity", "sensitive", "ads", "scam"]
MEDIA_POLICIES = ["allow", "no_links", "no_attachments", "sfw_only", "text_only"]
MODCONFIG_FILE = "modconfig.json"

# Named bundles of categories + policy + thresholds. A channel points at one of
# these (easy) or carries an inline override object (power-user).
DEFAULT_PROFILES = {
    "anything_goes": {"label": "Anything goes", "categories": [],
                      "media_policy": "allow", "nsfw_images": False,
                      "flood_count": 10, "flood_window": 8, "dup_count": 6},
    "standard":      {"label": "Standard chat", "categories": ["slurs", "scam", "ads"],
                      "media_policy": "allow", "nsfw_images": False,
                      "flood_count": 6, "flood_window": 12, "dup_count": 4},
    "sfw_strict":    {"label": "SFW-only · no slurs/links",
                      "categories": ["slurs", "nsfw_text", "profanity", "sensitive", "scam", "ads"],
                      "media_policy": "no_links", "nsfw_images": True,
                      "flood_count": 5, "flood_window": 12, "dup_count": 3},
}

# Each category -> the AutoMod rule it drives + the owner's extra words/regex.
# slurs/nsfw_text/profanity/sensitive ship with EMPTY word lists on purpose:
# Discord's maintained SLURS+SEXUAL presets (the "preset_safety" net below) cover
# the obvious cases, so we don't enumerate slurs in a public repo. The owner adds
# their own terms via the GUI / commands when they want finer control.
DEFAULT_CATEGORIES = {
    "slurs":     {"rule_name": "iBP · Slurs & hate", "block_msg": "That word isn't allowed here.",
                  "words": [], "regex": []},
    "nsfw_text": {"rule_name": "iBP · NSFW text", "block_msg": "Keep it clean in this channel.",
                  "words": [], "regex": []},
    "profanity": {"rule_name": "iBP · Profanity", "block_msg": "Mind the language in this channel.",
                  "words": [], "regex": []},
    "sensitive": {"rule_name": "iBP · Sensitive topics", "block_msg": "Let's not go there in this channel.",
                  "words": [], "regex": []},
    "ads":       {"rule_name": "iBP · Ads & invites", "block_msg": "Server invites/ads aren't allowed here.",
                  "words": [], "regex": [r"discord\.gg/[A-Za-z0-9]+",
                                         r"discord(app)?\.com/invite/[A-Za-z0-9]+",
                                         r"\.gg/[A-Za-z0-9]{2,}"]},
    "scam":      {"rule_name": "iBP · Scam filter", "block_msg": "That looked like a scam and was blocked.",
                  "words": ["free nitro", "nitro for free", "*steamcommunity*", "*free-nitro*",
                            "crypto giveaway", "claim your prize", "*t.me/*", "*airdrop*", "*-gift.*"],
                  "regex": []},
}

# The 1-per-guild AutoMod rules (always on unless disabled).
DEFAULT_GLOBAL = {
    "preset_safety": {"enabled": True, "presets": [2, 3]},   # KEYWORD_PRESET: SEXUAL_CONTENT + SLURS
    "spam":          {"enabled": True},                       # trigger_type 3
    "mention_spam":  {"enabled": True, "limit": 6},           # trigger_type 5
    "member_profile": {"enabled": False, "words": []},        # trigger_type 6 (nicknames; off by default)
}
DEFAULT_RAID = {"enabled": True, "join_burst": 8, "join_window_sec": 120,
                "action": "alert", "auto_clear_min": 15}
DEFAULT_IMAGE = {"classifier": "opennsfw", "threshold": 0.85, "max_per_run": 40,
                 "delete": True, "warn": True}


def base_defaults():
    """A complete default modconfig (no channels mapped yet)."""
    return {
        "version": 1,
        "defaults": {"profile": "standard"},   # any channel with no explicit entry uses this
        "profiles": copy.deepcopy(DEFAULT_PROFILES),
        "channels": {},                         # channel_id -> profile name OR inline override
        "categories": copy.deepcopy(DEFAULT_CATEGORIES),
        "global_rules": copy.deepcopy(DEFAULT_GLOBAL),
        "raid": copy.deepcopy(DEFAULT_RAID),
        "image_scan": copy.deepcopy(DEFAULT_IMAGE),
        "_note": ("IDs + words only. NEVER paste a bot token, GitHub token, or any "
                  "config.txt value here - it's uploaded to the public repo."),
    }


def deep_merge(base, override):
    """Return base with override applied. Dicts merge recursively; for everything
    else (lists, scalars) override wins. Used as deep_merge(defaults, existing) so a
    redeploy adds any NEW default keys WITHOUT clobbering the owner's saved edits."""
    out = copy.deepcopy(base)
    for k, v in (override or {}).items():
        if isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k] = deep_merge(out[k], v)
        else:
            out[k] = copy.deepcopy(v)
    return out


def load(path=None):
    """Load modconfig.json merged OVER the built-in defaults (existing values win,
    new default keys are added). Returns pure defaults if the file is absent."""
    p = path or common.state_path(MODCONFIG_FILE)
    existing = common.load_json(p, None)
    base = base_defaults()
    return deep_merge(base, existing) if isinstance(existing, dict) else base


def save(modcfg, path=None):
    common.save_json(path or common.state_path(MODCONFIG_FILE), modcfg)


def seed_channels_from(modcfg, bots_cfg):
    """First-run only: map each known chat channel to the 'standard' profile so the
    system works out of the box. Never runs if channels{} already has entries (so
    owner edits are preserved)."""
    if modcfg.get("channels"):
        return modcfg
    seed = {}
    for cid in (bots_cfg.get("patrol_channels") or []):
        seed[str(cid)] = "standard"
    modcfg["channels"] = seed
    return modcfg


def configured_channels(modcfg):
    return [str(c) for c in (modcfg.get("channels", {}) or {}).keys()]


def resolve_channel(modcfg, ch_id):
    """Normalize a channel's config - a bare profile name OR an inline override - into
    one concrete policy dict the enforcers can use directly."""
    profiles = modcfg.get("profiles", {}) or {}
    default_profile = (modcfg.get("defaults", {}) or {}).get("profile", "standard")
    entry = (modcfg.get("channels", {}) or {}).get(str(ch_id))

    if isinstance(entry, str):
        prof_name, inline = entry, {}
    elif isinstance(entry, dict):
        prof_name, inline = entry.get("profile", default_profile), entry
    else:                                   # not configured -> server default
        prof_name, inline = default_profile, {}

    prof = dict(profiles.get(prof_name) or profiles.get("standard") or {})
    cats = set(prof.get("categories", []) or [])
    for c in (inline.get("categories_add") or []):
        if c in CATEGORIES:
            cats.add(c)
    for c in (inline.get("categories_remove") or []):
        cats.discard(c)
    if "categories" in inline:              # full inline override wins
        cats = set(c for c in (inline["categories"] or []) if c in CATEGORIES)

    return {
        "profile": prof_name,
        "categories": cats,
        "media_policy": inline.get("media_policy", prof.get("media_policy", "allow")),
        "nsfw_images": bool(inline.get("nsfw_images", prof.get("nsfw_images", False))),
        "flood_count": int(inline.get("flood_count", prof.get("flood_count", 6))),
        "flood_window": int(inline.get("flood_window", prof.get("flood_window", 12))),
        "dup_count": int(inline.get("dup_count", prof.get("dup_count", 4))),
    }
