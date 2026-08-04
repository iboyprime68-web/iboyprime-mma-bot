#!/usr/bin/env python3
"""Give every human the baseline 🤝 Member role. Runs on a 5-minute cron.

WHY A BOT AT ALL: Discord has no native auto-role. The only ways to hand a role out
automatically are a gateway bot (needs an always-on host) or Onboarding (which is
deliberately OFF here - it is what hid every channel behind "Browse Channels"). So
this backfills instead: wake up, list the members, grant the role to anyone missing
it. A new joiner has it within ~5 minutes.

REQUIREMENT: `GET /guilds/{id}/members` is a privileged endpoint. The application
needs SERVER MEMBERS INTENT ticked in the Discord Developer Portal
(Applications -> your app -> Bot -> Privileged Gateway Intents). Without it Discord
returns 403 and this bot prints exactly that and exits 0 - deliberately NOT an error,
because a workflow that exits non-zero every 5 minutes emails the owner every 5
minutes, which is the failure mode this project keeps having to design around.

Skips bots and anyone who already holds the role, so a steady state costs one API
call. Stateless: the guild itself is the state.
"""
import sys, time
import common

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

PAGE = 1000          # Discord's max page size for the members list
MAX_GRANTS = 200     # per run: a sane ceiling so a huge backfill paces itself
SLEEP = 0.4          # between role writes


def all_members(gid):
    """Page through every member. Returns None (not []) if the members intent is off,
    so the caller can tell 'not allowed' apart from 'empty server'."""
    out, after = [], None
    while True:
        path = "/guilds/%s/members?limit=%d" % (gid, PAGE)
        if after:
            path += "&after=" + str(after)
        code, batch = common.discord("GET", path)
        if code == 403:
            return None
        if code != 200 or not isinstance(batch, list):
            print("  ! could not list members (HTTP %s)" % code)
            return None if not out else out
        out.extend(batch)
        if len(batch) < PAGE:
            return out
        after = batch[-1]["user"]["id"]
        time.sleep(0.4)


def needs_role(m, role_id):
    """True for a human who doesn't already hold the role."""
    user = m.get("user") or {}
    if user.get("bot"):
        return False
    return str(role_id) not in [str(r) for r in (m.get("roles") or [])]


def main():
    cfg = common.load_config()
    gid = str(cfg.get("guild_id") or "").strip()
    role_id = (cfg.get("roles") or {}).get("member")
    if not gid or not role_id:
        print("No member role in config - run bots_setup.py first.")
        return

    members = all_members(gid)
    if members is None:
        print("Members list is not accessible (HTTP 403).")
        print("Enable SERVER MEMBERS INTENT: discord.com/developers/applications ->")
        print("  your app -> Bot -> Privileged Gateway Intents -> Server Members Intent.")
        print("Nothing else to do; this run is a no-op, not a failure.")
        return

    todo = [m for m in members if needs_role(m, role_id)]
    if not todo:
        print("All %d member(s) already have the role - nothing to do." % len(members))
        return

    granted = failed = 0
    for m in todo[:MAX_GRANTS]:
        uid = (m.get("user") or {}).get("id")
        if not uid:
            continue
        code, resp = common.discord(
            "PUT", "/guilds/%s/members/%s/roles/%s" % (gid, uid, role_id))
        if code in (200, 204):
            granted += 1
        else:
            failed += 1
            if failed == 1:                      # report the cause once, not per member
                print("  ! grant failed (HTTP %s): %s" % (code, str(resp)[:160]))
                if code == 403:
                    print("    The bot's own role must sit ABOVE 🤝 Member in "
                          "Server Settings -> Roles.")
        time.sleep(SLEEP)

    left = max(0, len(todo) - MAX_GRANTS)
    print("Granted the member role to %d user(s)%s%s."
          % (granted,
             ", %d failed" % failed if failed else "",
             ", %d queued for the next run" % left if left else ""))


if __name__ == "__main__":
    main()
