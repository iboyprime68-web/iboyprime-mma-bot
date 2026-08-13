#!/usr/bin/env python3
"""My Cool Server - keep the hidden studio channel tidy.

news_bot and polls_bot stage YouTube posts into the staff-only studio channel
(graphic + copy-ready caption). Once the owner has posted or skipped one, the
message is dead weight, so this deletes staged posts older than
newsconfig "studio_retention_days" (default 2). Runs daily on its own cron.

NO STATE FILE. The age comes from each message's own timestamp, which Discord
already stores, so there is nothing to persist, nothing to commit, and nothing
that can be corrupted by a bad merge the way state_raid.json was.

THREE SAFETY RULES, all in deletable():
  * only messages authored by THIS bot are ever deleted. The author id comes
    from GET /users/@me at the start of the run; if that call fails the run
    stops without deleting anything, because deleting without an author check
    is not worth any amount of tidiness.
  * a PINNED message is kept forever - that is the owner's own way of saying
    keep this one.
  * the retention boundary KEEPS. A message exactly at the cutoff survives;
    only strictly older ones go.

MAX_DELETES caps a run so the first one cannot hammer the API with a whole
channel's backlog; the rest goes on the next day's tick.

This never exits non-zero on a routine failure. A red cron run emails the
owner every single day, which is the failure mode this project keeps having to
design around, and a tidy-up that could not run is not worth an email.

Std-lib only (HTTP via common.http, which honours Discord's rate limits).
"""
import sys, time, datetime
import common
import newsconfig

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

PAGE = 100          # Discord's max page size for GET /channels/{id}/messages
MAX_PAGES = 10      # 1000 messages, far more than a couple of days of staging
MAX_DELETES = 100   # per run: a first run cannot hammer the API
SLEEP = 0.6         # between deletes (common.http also honours 429 retry_after)
DEFAULT_DAYS = 2


def is_snowflake(value):
    """True when value is shaped like a real Discord id: ASCII digits only,
    15-21 characters.

    bots_config.json is generated, but a corrupted or hand-edited copy could
    hand this bot ANY string, and that string goes straight into the REST path
    of a DELETE call - the exact shape of the /unban path-injection bug the
    Worker already guards against with isSnowflake(). Refusing anything that
    is not id-shaped keeps a bad config from becoming API calls on a path this
    bot never meant to touch. Pure.
    """
    s = str(value or "")
    return 15 <= len(s) <= 21 and all(c in "0123456789" for c in s)


def retention_days(newscfg):
    """Configured retention in whole days, never below 1. Junk -> the default.

    A floor of 1 is deliberate: 0 would delete a post the same day it was
    staged, so the owner would find an empty channel and no way to tell why.
    Pure.
    """
    try:
        return max(1, int((newscfg or {}).get("studio_retention_days",
                                              DEFAULT_DAYS)))
    except (TypeError, ValueError):
        return DEFAULT_DAYS


def bot_user_id():
    """This bot's own user id, or "" when it cannot be read."""
    code, data = common.discord("GET", "/users/@me")
    if code != 200 or not isinstance(data, dict):
        return ""
    return str(data.get("id") or "")


def deletable(msg, mine, cutoff):
    """True when this message is ours, unpinned and strictly older than the
    cutoff. The whole deletion policy lives here, so it is pure and tested."""
    if not mine or not isinstance(msg, dict):
        return False
    if str((msg.get("author") or {}).get("id") or "") != str(mine):
        return False
    if msg.get("pinned"):
        return False
    ts = common.parse_iso(msg.get("timestamp"))
    if ts is None:                 # unreadable timestamp: keep it, never guess
        return False
    return ts < cutoff             # exactly at the cutoff is KEPT


def main():
    cfg = common.load_config()
    chan = (cfg.get("channels") or {}).get("studio")
    if not chan:
        print("No studio channel in bots_config - nothing to clean.")
        return
    if not is_snowflake(chan):
        print("Studio channel id %s is not a Discord snowflake - skipping "
              "the run rather than putting it in an API path."
              % ascii(str(chan)[:64]))
        return

    days = retention_days(newsconfig.load())
    cutoff = common.now_utc() - datetime.timedelta(days=days)
    mine = bot_user_id()
    if not mine:
        print("Could not read this bot's own user id - skipping the run. "
              "Nothing is deleted without an author check.")
        return

    scanned = deleted = failed = 0
    capped = False
    before = None
    for _page in range(MAX_PAGES):
        path = "/channels/%s/messages?limit=%d" % (chan, PAGE)
        if before:
            path += "&before=" + str(before)
        code, batch = common.discord("GET", path)
        if code != 200 or not isinstance(batch, list):
            print("  ! could not read the studio channel (HTTP %s) - "
                  "stopping here" % code)
            break
        if not batch:
            break
        scanned += len(batch)
        for m in batch:
            if deleted >= MAX_DELETES:
                capped = True
                break
            if not deletable(m, mine, cutoff):
                continue
            c, resp = common.discord(
                "DELETE", "/channels/%s/messages/%s" % (chan, m.get("id")))
            if c in (200, 204):
                deleted += 1
            else:
                failed += 1
                if failed == 1:        # report the cause once, not per message
                    print("  ! delete failed (HTTP %s): %s" % (c, str(resp)[:160]))
            time.sleep(SLEEP)
        before = batch[-1].get("id")
        if capped or len(batch) < PAGE:
            break

    print("Studio cleanup: scanned %d message(s), deleted %d older than %d day(s)%s%s."
          % (scanned, deleted, days,
             ", %d delete(s) failed" % failed if failed else "",
             ", capped at %d this run" % MAX_DELETES if capped else ""))


if __name__ == "__main__":
    try:
        main()
    except SystemExit as e:            # how load_config / token() bail out
        print("Studio cleanup skipped: %s" % e)
    except Exception as e:
        print("Studio cleanup hit %s - skipping this run." % type(e).__name__)
