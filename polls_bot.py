#!/usr/bin/env python3
"""My Cool Server - YouTube community poll staging (twice a day).

Stages high-engagement community-post material into the hidden staff studio
channel so the owner can paste it into YouTube's composer. Two slots a day
(the cron fires morning and late afternoon UTC; the owner asked for two after
his polls pulled 1.3K votes and 30+ comments in two days, Aug 19 2026).

Each slot the bot FIRST asks the AI (pollgen.py - DeepSeek et al via scorer's
provider table) to write a fresh poll in the owner's formula, fed the last
two days of headlines and the recently used questions. On any failure it
falls back to the curated 60-question bank in polls_data.json, rotating by
cursor, so a dead API never costs a slot. The evening slot may instead yield
a short DISCUSSION post when the model judges the news hands it a real
argument (the owner: "it doesn't have to be polls").

The formula (decoded from the biggest MMA poll channels, 91K-175K votes per
poll, and confirmed by the owner's own numbers): a superlative question fans
already argue about, named fighters or fights as options so each can carry a
one emoji per option, and an "Other (comment below)" final option on
open-ended questions - the comments are where the channel grows.

State (cursor, slot stamp, used questions) is saved AND committed BEFORE
anything posts - a crash mid-stage must skip one question, never repeat one
(the quiz bot hit exactly this trap; its fix is the law here). The same-SLOT
guard means a re-run or a manual dispatch can never stage twice in one slot.

No images. The per-option fighter tiles were removed in Sept 2026 at the
owner's request - he writes his own thumbnails and the tiles were noise, one
extra Discord message per option. That took the octagon-api lookup, the photo
download and the Pillow render out of this bot, so it is stdlib-only again.
Routine failures print and exit 0 - a red cron run emails the owner.

Everything stages into the OWNER-ONLY ideas channel, which nothing cleans up,
so the questions accumulate as a bank rather than expiring after two days.

Std-lib only at import time.
"""
import common, newsconfig, pollgen

STATE_FILE   = "state_polls.json"
DATA_FILE    = "polls_data.json"
STATE_V      = 2      # v1 -> v2 migrates in place (keeps the cursor - the
                      # v != N reseed trap is the law, see CLAUDE.md 4)
OPTION_COUNT = 4
# Sept 2026: the per-option fighter tiles are GONE at the owner's request ("I
# know you tried to give me images, you don't need to do that... you can get rid
# of that as for the polls"). That removed the octagon-api lookup, the photo
# download and the Pillow render from this bot entirely, so it is stdlib-only
# again and polls.yml no longer installs anything.


MAX_PER_DAY = 2            # the owner's ask: two staged polls a day
MIN_GAP_S   = 3 * 3600     # and never two within three hours (re-runs,
                           # dispatches and a DELAYED morning tick all land
                           # safely: GitHub's scheduler routinely fires late,
                           # and a slot-name guard would let a 13:05-delayed
                           # morning tick eat the evening slot)
STAMP_CAP   = 4            # staged_at history kept (yesterday + today)


def _int(v, default=0):
    """int() that treats junk as the default - a committed state file must
    never be able to crash a cron run (a red run emails the owner). Pure."""
    try:
        return int(v)
    except (TypeError, ValueError):
        return default


def migrate_state(state):
    """v1 -> v2 keeps the cursor (the v != N reseed trap is the law) and maps
    a v1 day stamp to that day's 16:23 cron slot, so an upgrade never doubles
    up on the day of the deploy. EVERY field is normalized defensively -
    junk types in the committed file start that field clean instead of
    raising. Pure."""
    if not isinstance(state, dict):
        state = {}
    if state.get("v") == 1:
        last_day = str(state.get("last_day") or "")
        state = {"v": STATE_V, "cursor": state.get("cursor"),
                 "staged_at": ([last_day + "T16:23:00+00:00"]
                               if last_day else [])}
    elif state.get("v") != STATE_V:
        state = {"v": STATE_V}
    state["v"] = STATE_V
    state["cursor"] = _int(state.get("cursor"), 0)
    state["asked"] = ([str(x) for x in state["asked"] if isinstance(x, str)]
                      if isinstance(state.get("asked"), list) else [])
    state["staged_at"] = ([str(x) for x in state["staged_at"]
                           if isinstance(x, str)]
                          if isinstance(state.get("staged_at"), list) else [])
    if not isinstance(state.get("last_entry"), dict):
        state["last_entry"] = {}
    return state


def _ascii(s):
    """Console-safe text for prints (Windows pipes default to cp1252)."""
    return (s or "").encode("ascii", "replace").decode("ascii")


def option_line(opt):
    """One 'emoji label' line, exactly as it goes into the YouTube composer."""
    emoji = (opt.get("emoji") or "").strip()
    label = (opt.get("label") or "").strip()
    return ("%s %s" % (emoji, label)).strip()


def build_spec(entry, origin):
    """The staged studio message: the poll at a glance plus a paste-ready
    block for the YouTube poll composer. `origin` says where the question
    came from ("question 3 of 60" / "written fresh for this slot"). Pure.

    NOTE the header must never read "Staged post" - that exact phrase is the
    Worker's staged-NEWS filter (parseStaged), and polls must not enter the
    studio app's news rail."""
    q = " ".join((entry.get("q") or "").split())
    lines = [option_line(o) for o in entry.get("options", [])[:OPTION_COUNT]]
    block = "\n".join([q] + lines)
    return ("Staged YouTube poll - %s\n\n"
            "%s\n%s\n\n"
            "Paste into the YouTube poll composer:\n"
            "```\n%s\n```\n"
            "Swap or trim options freely. The question is the engine."
            % (origin, q, "\n".join(lines), block))


def build_post_spec(text, origin):
    """The staged studio message for a DISCUSSION post (no options, no
    tiles): a paste-ready block for a plain community post. Pure."""
    t = " ".join((text or "").split())
    return ("Staged YouTube discussion post - %s\n\n"
            "Paste as a plain community post:\n"
            "```\n%s\n```\n"
            "No images needed - the question is the post and the comments "
            "are the engagement." % (origin, t))


def main():
    cfg = common.load_config()
    # The owner-only ideas channel, NOT the studio. Two reasons he gave: the
    # polls were mixed in with the news graphics, and he wants them to build up
    # ("I don't want you to delete anything... they don't disappear"). Nothing
    # cleans this channel - studio_clean only ever touches channels.studio.
    chan = cfg.get("channels", {}).get("ideas")
    if not chan:
        print("No ideas channel in bots_config.json - run DEPLOY.bat so "
              "bots_setup adds it, then re-run.")
        return

    bank = common.load_json(common.state_path(DATA_FILE), [])
    bank = [e for e in bank if isinstance(e, dict) and e.get("q")]
    if not bank:
        print("polls_data.json missing or empty - nothing to stage.")
        return

    state = migrate_state(common.load_json(common.state_path(STATE_FILE), {}))
    now = common.now_utc()
    today = now.strftime("%Y-%m-%d")
    today_stamps = [t for t in state["staged_at"] if t.startswith(today)]
    if len(today_stamps) >= MAX_PER_DAY:
        print("Already staged %d today - daily-pair guard." % MAX_PER_DAY)
        return
    last_ts = common.parse_iso(state["staged_at"][-1]) if state["staged_at"] else None
    if last_ts is not None and 0 <= (now - last_ts).total_seconds() < MIN_GAP_S:
        print("Staged %d min ago - minimum-gap guard (re-runs and delayed "
              "ticks never double up)."
              % int((now - last_ts).total_seconds() // 60))
        return

    # AI first: a fresh question in the owner's formula, written against the
    # last two days of headlines. Any failure falls back to the bank, so a
    # slot is never lost to a dead API. The evening slot may yield a short
    # discussion post instead of a poll.
    asked = state["asked"][-pollgen.ASKED_CAP:]
    scoring = (newsconfig.load().get("scoring") or {})
    gen, why = pollgen.generate(pollgen.recent_titles(), asked,
                                allow_post=(now.hour >= 13), scfg=scoring)
    if gen:
        entry = gen
        origin = ("written fresh for this slot" if gen.get("type") == "poll"
                  else "a hot take from today's news")
    else:
        print("  AI generation unavailable (%s) - using the bank." % _ascii(why))
        cursor = _int(state.get("cursor"), 0) % len(bank)
        # the no-repeat memory covers the bank too: a question the AI already
        # wrote (or a recent bank pick) is skipped, not re-staged verbatim
        asked_norm = {" ".join(a.lower().split()) for a in asked}
        for _ in range(len(bank)):
            q_norm = " ".join((bank[cursor].get("q") or "").lower().split())
            if q_norm not in asked_norm:
                break
            cursor = (cursor + 1) % len(bank)
        entry = bank[cursor]
        origin = "question %d of %d" % (cursor + 1, len(bank))
        # the cursor only advances when the bank was actually used
        state["cursor"] = (cursor + 1) % len(bank)

    # The state (cursor, stamps, used questions, the entry itself for the
    # studio composer's poll tab) is saved AND committed BEFORE anything
    # posts: a crash between here and the post skips one question instead of
    # repeating one (the quiz bot's crash-can-repeat trap, encoded as law).
    state["staged_at"] = (state["staged_at"] + [now.isoformat()])[-STAMP_CAP:]
    state["asked"] = (state["asked"]
                      + [" ".join((entry.get("q") or "").split())])[-pollgen.ASKED_CAP:]
    state["last_entry"] = {
        "q": " ".join((entry.get("q") or "").split()),
        "type": entry.get("type") or "poll",
        "options": [{"label": (o.get("label") or "").strip(),
                     "emoji": (o.get("emoji") or "").strip()}
                    for o in (entry.get("options") or [])[:OPTION_COUNT]],
    }
    common.save_json(common.state_path(STATE_FILE), state)
    common.persist_state(STATE_FILE)

    if entry.get("type") == "post":
        body = build_post_spec(entry.get("q"), origin)
        code, _ = common.post_message(chan, body, silent=True)
        if code not in (200, 201):
            print("stage failed: HTTP %s (slot already stamped; the next "
                  "slot stages fresh)" % code)
        else:
            print("staged discussion post: %s" % _ascii(entry.get("q", ""))[:70])
        return

    body = build_spec(entry, origin)
    code, _ = common.post_message(chan, body, silent=True)
    if code not in (200, 201):
        print("stage failed: HTTP %s (slot already stamped; the next slot "
              "stages fresh)" % code)
        return
    print("staged poll (%s): %s" % (_ascii(origin),
                                    _ascii(entry.get("q", ""))[:70]))

    print("Done.")


if __name__ == "__main__":
    main()
