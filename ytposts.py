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

# Photoless fallback: when a story has no usable og:image, try to resolve a
# fighter named in the poster line/title against octagon-api and hand the
# promo cutout to the renderer (render_news "cutout_path"). Every step is
# fail-silent - no match or a dead fetch just means the glow-field fallback.
RANKINGS_API = "https://api.octagon-api.com/rankings"
FIGHTER_API = "https://api.octagon-api.com/fighter/%s"


def build_name_map(rankings):
    """Lowercased fighter name -> octagon id from the /rankings payload
    (divisions with champion {id, championName} + fighters [{id, name}]).
    Full names always; bare surnames only while unambiguous - two fighters
    sharing one surname drop it, because a wrong cutout is worse than none.
    Pure."""
    if not isinstance(rankings, list):
        return {}
    full, last, clash = {}, {}, set()
    for div in rankings:
        if not isinstance(div, dict):
            continue
        entries = list(div.get("fighters") or [])
        champ = div.get("champion") or {}
        if isinstance(champ, dict) and champ.get("id") and champ.get("championName"):
            entries.append({"id": champ["id"], "name": champ["championName"]})
        for f in entries:
            fid = str((f or {}).get("id") or "")
            name = " ".join(str((f or {}).get("name") or "").lower()
                            .replace(chr(0x2019), "'").split())
            if not fid or not name:
                continue
            full[name] = fid
            parts = name.split()
            if len(parts) >= 2 and len(parts[-1]) >= 3:
                ln = parts[-1]
                if last.get(ln, fid) != fid:
                    clash.add(ln)
                last.setdefault(ln, fid)
    for ln in clash:
        last.pop(ln, None)
    for ln, fid in last.items():
        full.setdefault(ln, fid)
    return full


def match_fighter(text, name_map):
    """The octagon id whose name occurs in `text` as whole words, preferring
    the LONGEST matched name; "" when nothing matches. Case-insensitive,
    apostrophe-normalized. Pure."""
    t = " ".join((text or "").lower().replace(chr(0x2019), "'").split())
    if not t or not name_map:
        return ""
    best_id, best_name = "", ""
    for name, fid in (name_map or {}).items():
        if len(name) <= len(best_name):
            continue
        if re.search(r"(?<![a-z0-9])" + re.escape(name) + r"(?![a-z0-9])", t):
            best_id, best_name = fid, name
    return best_id


def fighter_cutout(text):
    """Resolve a fighter named in `text` to a downloaded promo-cutout temp
    file path, or "". One rankings GET per call; never raises."""
    try:
        code, data = common.get_json(RANKINGS_API, tries=2, timeout=10)
        if code != 200:
            return ""
        fid = match_fighter(text, build_name_map(data))
        if not fid:
            return ""
        code, f = common.get_json(FIGHTER_API % fid, tries=2, timeout=10)
        if code != 200 or not isinstance(f, dict):
            return ""
        url = str(f.get("imgUrl") or "")
        if not url.startswith("http"):
            return ""
        raw = fetch_bytes(url)
        if not raw:
            return ""
        fd, path = tempfile.mkstemp(suffix=".png")
        with os.fdopen(fd, "wb") as fh:
            fh.write(raw)
        return path
    except Exception:
        return ""


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
            cutout_path = ""
            if not photo_path:
                cutout_path = fighter_cutout(
                    "%s %s" % (it.get("line") or "", it.get("title") or ""))
            import postcard                     # lazy: needs Pillow
            # line/hot come from the scorer via news_bot; speaker/inset stay
            # out for now - speaker inference lands with the composer app.
            img = postcard.render("news", {
                "headline": it.get("title", ""),
                "line": it.get("line", ""),
                "hot": it.get("hot") or [],
                # hot-word emphasis: news_bot passes the newsconfig setting
                # ("color" / "underline" / "auto"); the guid is what postcard
                # hashes when it is "auto", so one story always renders the
                # same way while the feed still alternates
                "emphasis": it.get("emphasis", ""),
                "guid": it.get("guid", ""),
                "source": it.get("source", ""),
                "photo_path": photo_path or None,
                "cutout_path": cutout_path or None,
            })
            fd, img_path = tempfile.mkstemp(suffix=".png")
            os.close(fd)
            img.save(img_path, "PNG")
            for tmp in (photo_path, cutout_path):
                if tmp:
                    try: os.remove(tmp)
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
