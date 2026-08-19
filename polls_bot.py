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
photo, one emoji per option, and an "Other (comment below)" final option on
open-ended questions - the comments are where the channel grows.

State (cursor, slot stamp, used questions) is saved AND committed BEFORE
anything posts - a crash mid-stage must skip one question, never repeat one
(the quiz bot hit exactly this trap; its fix is the law here). The same-SLOT
guard means a re-run or a manual dispatch can never stage twice in one slot.

Option images: each option carries (or, when AI-written, guesses) an
octagon-api fighter slug. The bot reads that fighter's imgUrl, downloads the
photo and renders a 640x640 tile through postcard.render("poll_option", ...).
postcard is imported lazily because Pillow is not stdlib, and EVERY image
step degrades to a text-only stage on failure. Routine failures print and
exit 0 - a red cron run emails the owner.

Std-lib only at import time.
"""
import os, tempfile, urllib.request

import common, newsconfig, pollgen

STATE_FILE   = "state_polls.json"
DATA_FILE    = "polls_data.json"
STATE_V      = 2      # v1 -> v2 migrates in place (keeps the cursor - the
                      # v != N reseed trap is the law, see CLAUDE.md 4)
FIGHTER_API  = "https://api.octagon-api.com/fighter/%s"
FETCH_CAP    = 8 * 1024 * 1024
OPTION_COUNT = 4


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


def fighter_image_url(fid):
    """octagon-api imgUrl for a fighter id, or ''. Never raises - a retired
    or renamed fighter 404s and the option simply stages without a tile."""
    try:
        code, data = common.get_json(FIGHTER_API % fid)
        if code != 200 or not isinstance(data, dict):
            print("  fighter %s: HTTP %s - no tile" % (fid, code))
            return ""
        url = data.get("imgUrl") or ""
        return url if url.startswith("http") else ""
    except Exception as e:
        print("  fighter %s lookup failed (%s) - no tile" % (fid, type(e).__name__))
        return ""


def fetch_bytes(url, timeout=10, cap=FETCH_CAP):
    """Download binary content (the fighter photo). Returns bytes or None.
    Same shape as ytposts.fetch_bytes: stdlib urllib, hard timeout, size cap."""
    try:
        req = urllib.request.Request(url, headers={"User-Agent": common.BROWSER_UA})
        with urllib.request.urlopen(req, timeout=timeout) as r:
            data = r.read(cap + 1)
        if not data or len(data) > cap:
            return None
        return data
    except Exception:
        return None


def render_tile(photo, label):
    """Render one 640x640 option tile from raw photo bytes -> temp png path,
    or '' on ANY failure, missing Pillow included. postcard is imported
    lazily: the cron bots stay stdlib-only and this one must stage text-only
    whenever the workflow's non-fatal pip step failed."""
    photo_path = img_path = ""
    try:
        fd, photo_path = tempfile.mkstemp(suffix=".img")
        with os.fdopen(fd, "wb") as f:
            f.write(photo)
        import postcard                          # lazy: needs Pillow
        if postcard._load_photo(photo_path) is None:
            # Unreadable bytes would render postcard's dark placeholder tile,
            # and the whole formula is RAW photos - stage without one instead.
            print("  photo bytes unreadable - staging without this tile")
            return ""
        img = postcard.render("poll_option", {"photo_path": photo_path,
                                              "label": label})
        fd, img_path = tempfile.mkstemp(suffix=".png")
        os.close(fd)
        img.save(img_path, "PNG")
        return img_path
    except SystemExit:                           # postcard raises it sans Pillow
        print("  Pillow missing - staging without tiles")
        return ""
    except Exception as e:
        if img_path:
            try:
                os.remove(img_path)
            except OSError:
                pass
        print("  tile render failed (%s) - staging without this tile" % type(e).__name__)
        return ""
    finally:
        if photo_path:
            try:
                os.remove(photo_path)
            except OSError:
                pass


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
            "Swap or trim options freely - the question is the engine. "
            "Option tiles follow where a fighter image exists; raw iconic "
            "photos out-pull designed graphics on these polls."
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
    chan = cfg.get("channels", {}).get("studio")
    if not chan:
        print("No studio channel in bots_config.json - run DEPLOY.bat so "
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

    tiles = 0
    for i, opt in enumerate(entry.get("options", [])[:OPTION_COUNT]):
        fid = (opt.get("img") or "").strip()
        if not fid:
            continue
        label = (opt.get("label") or "").strip()
        url = fighter_image_url(fid)
        if not url:
            continue
        raw = fetch_bytes(url)
        if raw is None:
            print("  photo download failed for %s - no tile" % fid)
            continue
        path = render_tile(raw, label)
        if not path:
            continue
        code, _ = common.post_file(chan, "Option %d tile - %s" % (i + 1, _ascii(label)),
                                   path, filename="option%d.png" % (i + 1), silent=True)
        try:
            os.remove(path)
        except OSError:
            pass
        if code in (200, 201):
            tiles += 1
        else:
            print("  tile upload failed for option %d: HTTP %s" % (i + 1, code))
    print("Done. tiles=%d" % tiles)


if __name__ == "__main__":
    main()
