#!/usr/bin/env python3
"""Nightly config snapshot - disaster-recovery record of the server's shape.

Every night it captures channels / roles / permission overwrites / AutoMod
summaries / guild settings into snapshot_config.json (public-safe by
construction: ids, names, bitmasks and COUNTS only - no rule word contents,
no tokens) and appends today's member count to state_snapshot.json (the
long-term series the weekly health report reads).

No-churn guarantee: the snapshot is canonicalized (sorted, volatile fields
stripped) and only written when it actually differs - so the nightly commit
happens only on real config drift.

RESTORE PATH (documented for humans): snapshot_config.json is a readable map,
not an executable restore. To recover from a bad change: find the object by id
or name in the snapshot, then re-apply the old value with the matching Discord
API call (PATCH /channels/{id} for topic/name/parent/overwrites, PATCH
/guilds/{gid}/roles/{id} for role perms/colour, the AutoMod rules API for
rules) - or simply re-run `python deploy_all.py`, which rebuilds everything
the pipeline owns (channels config, AutoMod, rules text, guides, onboarding).
"""
import common

STATE_FILE    = "state_snapshot.json"
SNAPSHOT_FILE = "snapshot_config.json"
HISTORY_CAP   = 400


def canonical_channels(chans):
    out = []
    for c in sorted(chans, key=lambda c: str(c.get("id"))):
        out.append({
            "id": str(c.get("id")),
            "name": c.get("name"),
            "type": c.get("type"),
            "parent_id": str(c.get("parent_id")) if c.get("parent_id") else None,
            "position": c.get("position"),
            "topic": c.get("topic") or None,
            "rate_limit_per_user": c.get("rate_limit_per_user") or 0,
            "nsfw": bool(c.get("nsfw")),
            "overwrites": sorted(
                [{"id": str(o.get("id")), "type": o.get("type"),
                  "allow": str(o.get("allow")), "deny": str(o.get("deny"))}
                 for o in (c.get("permission_overwrites") or [])],
                key=lambda o: o["id"]),
        })
    return out


def canonical_roles(roles):
    out = []
    for r in sorted(roles, key=lambda r: str(r.get("id"))):
        out.append({
            "id": str(r.get("id")),
            "name": r.get("name"),
            "color": r.get("color"),
            "hoist": bool(r.get("hoist")),
            "mentionable": bool(r.get("mentionable")),
            "permissions": str(r.get("permissions")),
            "position": r.get("position"),
        })
    return out


def canonical_automod(rules):
    """Summaries only - counts, never keyword contents (modconfig owns those)."""
    out = []
    for r in sorted(rules, key=lambda r: str(r.get("name"))):
        md = r.get("trigger_metadata") or {}
        out.append({
            "name": r.get("name"),
            "trigger_type": r.get("trigger_type"),
            "event_type": r.get("event_type"),
            "enabled": bool(r.get("enabled")),
            "keyword_count": len(md.get("keyword_filter") or []),
            "regex_count": len(md.get("regex_patterns") or []),
            "allow_count": len(md.get("allow_list") or []),
            "presets": md.get("presets") or [],
            "exempt_role_count": len(r.get("exempt_roles") or []),
            "exempt_channel_count": len(r.get("exempt_channels") or []),
            "action_types": sorted(a.get("type") for a in (r.get("actions") or [])),
        })
    return out


def build_snapshot(guild, chans, roles, automod):
    return {
        "_format": 1,
        "guild": {
            "id": str(guild.get("id")),
            "name": guild.get("name"),
            "description": guild.get("description"),
            "verification_level": guild.get("verification_level"),
            "system_channel_id": str(guild.get("system_channel_id")) if guild.get("system_channel_id") else None,
            "premium_tier": guild.get("premium_tier"),
            "icon": guild.get("icon"),
        },
        "channels": canonical_channels(chans),
        "roles": canonical_roles(roles),
        "automod": canonical_automod(automod),
    }


def main():
    cfg = common.load_config()
    gid = cfg["guild_id"]
    code_g, guild = common.discord("GET", "/guilds/%s?with_counts=true" % gid)
    code_c, chans = common.discord("GET", "/guilds/%s/channels" % gid)
    code_r, roles = common.discord("GET", "/guilds/%s/roles" % gid)
    code_a, automod = common.discord("GET", "/guilds/%s/auto-moderation/rules" % gid)
    if code_g != 200 or code_c != 200 or code_r != 200:
        print("snapshot skipped - API unavailable (%s/%s/%s)" % (code_g, code_c, code_r))
        return
    automod = automod if code_a == 200 and isinstance(automod, list) else []

    snap = build_snapshot(guild, chans, roles, automod)
    import json
    new_blob = json.dumps(snap, sort_keys=True, ensure_ascii=False)
    old = common.load_json(common.state_path(SNAPSHOT_FILE), None)
    old_blob = json.dumps(old, sort_keys=True, ensure_ascii=False) if old else ""
    if new_blob != old_blob:
        common.save_json(common.state_path(SNAPSHOT_FILE), snap)
        common.persist_state(SNAPSHOT_FILE, "config snapshot [skip ci]")
        print("snapshot: config changed - written (%d channels, %d roles, %d automod rules)"
              % (len(snap["channels"]), len(snap["roles"]), len(snap["automod"])))
    else:
        print("snapshot: no config drift - nothing written")

    # daily member-count history (the health report's trend source)
    state = common.load_json(common.state_path(STATE_FILE), {})
    if state.get("v") != 1:
        state = {"v": 1, "history": {}}
    count = guild.get("approximate_member_count")
    if isinstance(count, int):
        day = common.now_utc().strftime("%Y-%m-%d")
        if state["history"].get(day) != count:
            state["history"][day] = count
            if len(state["history"]) > HISTORY_CAP:
                for k in sorted(state["history"])[:-HISTORY_CAP]:
                    del state["history"][k]
            common.save_json(common.state_path(STATE_FILE), state)
            common.persist_state(STATE_FILE)
        print("members today: %d (history: %d days)" % (count, len(state["history"])))


if __name__ == "__main__":
    main()
