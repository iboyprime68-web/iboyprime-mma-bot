#!/usr/bin/env python3
"""My Cool Server - YouTube community poll staging (every 2 days).

Stages ONE high-engagement poll into the hidden staff studio channel so the
owner can paste it into YouTube's poll composer. The formula is decoded from
the biggest MMA poll channels on YouTube (91K-175K votes per poll): a
superlative question ("Who is the [best or worst] [thing] in the UFC?") that
alternates positive and negative superlatives, exactly 4 short options each
carrying one emoji, and raw iconic photos as the option images rather than
designed graphics.

The 60-question bank lives in polls_data.json and rotates by cursor. The
cursor and the day stamp are saved AND committed BEFORE anything posts - a
crash mid-stage must skip one question, never repeat one (the quiz bot hit
exactly this trap; its fix is the law here). The same-day guard means a
re-run or a manual dispatch can never stage two polls in one day.

Option images: when an option is a current UFC fighter the bank carries an
octagon-api fighter id. The bot reads that fighter's imgUrl, downloads the
photo and renders a 640x640 tile through postcard.render("poll_option", ...).
postcard is imported lazily because Pillow is not stdlib, and EVERY image
step degrades to a text-only stage on failure. Routine failures print and
exit 0 - a red cron run emails the owner.

Std-lib only at import time.
"""
import os, tempfile, urllib.request

import common

STATE_FILE   = "state_polls.json"
DATA_FILE    = "polls_data.json"
STATE_V      = 1
FIGHTER_API  = "https://api.octagon-api.com/fighter/%s"
FETCH_CAP    = 8 * 1024 * 1024
OPTION_COUNT = 4


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


def build_spec(entry, n, total):
    """The staged studio message: the poll at a glance plus a paste-ready
    block for the YouTube poll composer. Pure."""
    q = " ".join((entry.get("q") or "").split())
    lines = [option_line(o) for o in entry.get("options", [])[:OPTION_COUNT]]
    block = "\n".join([q] + lines)
    return ("Staged YouTube poll - question %d of %d\n\n"
            "%s\n%s\n\n"
            "Paste into the YouTube poll composer:\n"
            "```\n%s\n```\n"
            "Option tiles follow where a fighter image exists. Raw iconic "
            "photos out-pull designed graphics on these polls."
            % (n, total, q, "\n".join(lines), block))


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

    state = common.load_json(common.state_path(STATE_FILE), {})
    if state.get("v") != STATE_V:
        state = {"v": STATE_V, "cursor": 0, "last_day": ""}
    today = common.now_utc().strftime("%Y-%m-%d")
    if state.get("last_day") == today:
        print("Already staged a poll today (%s) - same-day guard." % today)
        return

    cursor = int(state.get("cursor", 0)) % len(bank)
    entry = bank[cursor]

    # The cursor and day stamp are saved AND committed BEFORE anything posts:
    # a crash between here and the post skips one question instead of
    # repeating one (the quiz bot's crash-can-repeat trap, encoded as law).
    state["cursor"] = (cursor + 1) % len(bank)
    state["last_day"] = today
    common.save_json(common.state_path(STATE_FILE), state)
    common.persist_state(STATE_FILE)

    body = build_spec(entry, cursor + 1, len(bank))
    code, _ = common.post_message(chan, body, silent=True)
    if code not in (200, 201):
        print("stage failed: HTTP %s (cursor already advanced; the next run "
              "stages the next question)" % code)
        return
    print("staged poll %d/%d: %s" % (cursor + 1, len(bank),
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
