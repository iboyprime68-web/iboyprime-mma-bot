#!/usr/bin/env python3
"""Prime Arena - raid watch (zero-setup, no privileged gateway needed).

Samples the guild's member count (GET /guilds/{id}?with_counts=true) ~once a minute
via common.run_loop and, if it jumps by `join_burst` within `join_window_sec`, treats
it as a possible raid:
  * action "alert"    -> pings the mod-log so staff can react,
  * action "lockdown" -> ALSO raises the server verification level (blocking fresh /
    throwaway accounts) and auto-reverts after `auto_clear_min`.

HONEST trade-off (documented in BOTS_GUIDE): without a gateway + the Server Members
intent we can't see WHO joined or auto-kick them, and approximate_member_count is
cache-laggy - so this catches a *sustained* join flood, not a 5-second burst. The
gateway-based version would need an always-on host (breaks the free/PC-off model).

Std-lib only (imports common + modconfig). Settings live in modconfig.json -> "raid".
"""
import common, modconfig

STATE_FILE = "state_raid.json"
LOCKDOWN_LEVEL = 4        # VERY_HIGH (verified phone) - blocks throwaway accounts during a raid


def guild_count(guild):
    code, g = common.discord("GET", "/guilds/%s?with_counts=true" % guild)
    if isinstance(g, dict):
        return g.get("approximate_member_count")
    return None


def engage_lockdown(guild, mod_log):
    """Raise verification level; return the previous level so we can restore it."""
    code, g = common.discord("GET", "/guilds/%s" % guild)
    prev = g.get("verification_level", 1) if isinstance(g, dict) else 1
    common.discord("PATCH", "/guilds/%s" % guild, {"verification_level": LOCKDOWN_LEVEL})
    if mod_log:
        common.post_message(mod_log,
                            "🔒 **Raid lockdown ON** — verification level raised to block new/throwaway "
                            "accounts. It auto-clears shortly.", allowed_mentions={"parse": []})
    print("  lockdown engaged (prev verification_level=%s)" % prev)
    return prev


def revert_lockdown(guild, lock, mod_log):
    common.discord("PATCH", "/guilds/%s" % guild,
                   {"verification_level": lock.get("prev_verification", 1)})
    if mod_log:
        common.post_message(mod_log, "🔓 **Raid lockdown cleared** — verification level restored.",
                            allowed_mentions={"parse": []})
    print("  lockdown reverted")


def poll_once():
    cfg = common.load_config()
    guild = cfg["guild_id"]
    mod_log = cfg.get("channels", {}).get("mod_log")
    modcfg = modconfig.load()
    raid = modcfg.get("raid", {}) or {}
    if not raid.get("enabled", True):
        print("Raid watch disabled in modconfig."); return
    burst = int(raid.get("join_burst", 8))
    window = int(raid.get("join_window_sec", 120))
    action = raid.get("action", "alert")
    clear_min = int(raid.get("auto_clear_min", 15))

    state = common.load_json(common.state_path(STATE_FILE), {})
    now = common.unix(common.now_utc())
    changed = False

    # auto-revert a prior lockdown whose timer has elapsed
    lock = state.get("lockdown")
    if lock and now >= lock.get("until", 0):
        revert_lockdown(guild, lock, mod_log)
        state.pop("lockdown", None)
        changed = True

    count = guild_count(guild)
    if count is None:
        common.save_json(common.state_path(STATE_FILE), state)
        if changed:
            common.persist_state(STATE_FILE)
        print("Raid watch: couldn't read member count."); return

    samples = state.get("samples", [])
    samples.append([now, count])
    cutoff = now - max(window * 2, 600)            # keep a little history beyond the window
    samples = [s for s in samples if s[0] >= cutoff]
    state["samples"] = samples

    in_window = [s for s in samples if s[0] >= now - window]
    baseline = min((s[1] for s in in_window), default=count)
    delta = count - baseline

    if delta >= burst and not state.get("lockdown") and (now - state.get("last_alert", 0) >= window):
        if mod_log:
            common.post_message(
                mod_log,
                "⚠️ **Possible raid** — +%d members in the last ~%dm (total now %d). Staff, eyes up."
                % (delta, max(1, window // 60), count), allowed_mentions={"parse": []})
        state["last_alert"] = now
        changed = True
        print("  RAID alert: +%d in ~%ds" % (delta, window))
        if action == "lockdown":
            prev = engage_lockdown(guild, mod_log)
            state["lockdown"] = {"until": now + clear_min * 60, "prev_verification": prev}

    common.save_json(common.state_path(STATE_FILE), state)
    if changed:
        common.persist_state(STATE_FILE)
    print("Raid watch: count=%s baseline=%s delta=%s" % (count, baseline, delta))


def main():
    common.run_loop(poll_once)


if __name__ == "__main__":
    main()
