#!/usr/bin/env python3
"""My Cool Server - YouTube Community post staging (the posts machine).

Called by news_bot for every genuinely new kept story. scorer.py rates the
story 0-100; at scoring.stage_threshold the story is rendered into a branded
graphic (postcard.py, imported lazily because Pillow is not stdlib) and posted
to the hidden staff studio channel with a copy-ready caption. At
scoring.ping_threshold the staged message also mentions the owner - the one
loud ping this pipeline makes; every other staged post is silent.

YouTube has no API for Community posts (verified Aug 2026: no official
endpoint, no third-party scheduler, no share intent reaches the composer), so
the handoff is deliberately manual-but-instant: open the staged message, save
the image, copy the caption, paste into the YouTube app and use its native
Schedule Post. This module must NEVER break news delivery - stage_story
catches everything and returns a status string instead of raising.

Std-lib only at import time. Pillow is required only at render time; when it
is missing the story stages as text-only (caption, no graphic).
"""
import os, re, tempfile, urllib.request

import common

# Hosts whose article links cannot be resolved server-side (Google News links
# only resolve in a real browser; nitter pages are not the story itself).
NO_FETCH_HOSTS = ("news.google.com", "nitter.net")

OG_RE = re.compile(
    r'<meta[^>]+(?:property|name)=["\'](?:og:image|twitter:image)(?::src)?["\']'
    r'[^>]+content=["\']([^"\'>]+)["\']', re.I)
OG_RE_FLIP = re.compile(
    r'<meta[^>]+content=["\']([^"\'>]+)["\'][^>]+'
    r'(?:property|name)=["\'](?:og:image|twitter:image)(?::src)?["\']', re.I)

CAPTION_MAX_DESC = 300


def parse_og_image(html):
    """First og:image / twitter:image URL in an HTML blob, or ''. Pure."""
    for rx in (OG_RE, OG_RE_FLIP):
        m = rx.search(html or "")
        if m and m.group(1).startswith("http"):
            return m.group(1)
    return ""


def og_image(link, timeout=8):
    """The story's social-card image URL, or ''. Never raises."""
    try:
        if not link or any(h in link for h in NO_FETCH_HOSTS):
            return ""
        code, text = common.get_text(link, tries=1, timeout=timeout)
        if code != 200 or not text:
            return ""
        return parse_og_image(text)
    except Exception:
        return ""


def fetch_bytes(url, timeout=10, cap=8 * 1024 * 1024):
    """Download binary content (the story photo). Returns bytes or None."""
    try:
        req = urllib.request.Request(url, headers={"User-Agent": common.BROWSER_UA})
        with urllib.request.urlopen(req, timeout=timeout) as r:
            data = r.read(cap + 1)
        if not data or len(data) > cap:
            return None
        return data
    except Exception:
        return None


def _sentence_trim(text, cap):
    """Trim to cap, preferring a sentence boundary. Pure."""
    t = (text or "").strip()
    if len(t) <= cap:
        return t
    cut = t[:cap]
    for mark in (". ", "? "):
        pos = cut.rfind(mark)
        if pos > cap // 2:
            return cut[: pos + 1].strip()
    pos = cut.rfind(" ")
    return (cut[:pos] if pos > 0 else cut).rstrip(",;: ") + "..."


def build_caption(title, desc, source):
    """The text the owner pastes into the YouTube composer. Pure, calm voice:
    headline, one or two context sentences, attribution, one hashtag."""
    lines = [common.strip_markdown(title or "").strip()]
    body = _sentence_trim(common.strip_markdown(desc or ""), CAPTION_MAX_DESC)
    if body and body.lower() != lines[0].lower():
        lines += ["", body]
    lines += ["", "via %s" % (source or "the wire"), "#UFC"]
    return "\n".join(lines)


def _studio_body(score, why, caption, ping_uid):
    head = "<@%s> " % ping_uid if ping_uid else ""
    return ("%sStaged post - score %d (%s)\n"
            "Copy the caption, save the image, then post or schedule it in "
            "the YouTube app.\n```\n%s\n```" % (head, score, why, caption))


def stage_story(it, score, why, cfg_bots, newscfg):
    """Render + post one staged story to the studio channel. Returns a short
    ASCII status string; NEVER raises (news delivery must not notice us)."""
    try:
        chan = (cfg_bots.get("channels", {}) or {}).get("studio")
        if not chan:
            return "no studio channel - run a deploy"
        scoring = (newscfg.get("scoring", {}) or {})
        ping_uid = ""
        if score >= int(scoring.get("ping_threshold", 85)):
            ping_uid = str(cfg_bots.get("owner_id", "") or "")

        caption = build_caption(it.get("title"), it.get("desc"), it.get("source"))
        body = _studio_body(score, why, caption, ping_uid)
        mentions = ({"parse": [], "users": [ping_uid]} if ping_uid else None)
        silent = not ping_uid    # a ping must never ride a silent message

        img_path = ""
        try:
            photo_url = og_image(it.get("link"))
            photo_path = ""
            if photo_url:
                raw = fetch_bytes(photo_url)
                if raw:
                    fd, photo_path = tempfile.mkstemp(suffix=".img")
                    with os.fdopen(fd, "wb") as f:
                        f.write(raw)
            import postcard                     # lazy: needs Pillow
            # line/hot come from the scorer via news_bot; speaker/inset stay
            # out for now - speaker inference lands with the composer app.
            img = postcard.render("news", {
                "headline": it.get("title", ""),
                "line": it.get("line", ""),
                "hot": it.get("hot") or [],
                "source": it.get("source", ""),
                "photo_path": photo_path or None,
            })
            fd, img_path = tempfile.mkstemp(suffix=".png")
            os.close(fd)
            img.save(img_path, "PNG")
            if photo_path:
                try: os.remove(photo_path)
                except OSError: pass
        except SystemExit:
            img_path = ""                       # Pillow missing: text-only stage
        except Exception as e:
            img_path = ""
            print("  stage render failed (%s), staging text-only" % type(e).__name__)

        if img_path:
            code, _ = common.post_file(chan, body, img_path,
                                       filename="post.png",
                                       allowed_mentions=mentions, silent=silent)
            try: os.remove(img_path)
            except OSError: pass
        else:
            code, _ = common.post_message(chan, body,
                                          allowed_mentions=mentions, silent=silent)
        return "staged (HTTP %s)%s" % (code, " with ping" if ping_uid else "")
    except Exception as e:
        return "stage failed (%s)" % type(e).__name__
