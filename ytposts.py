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
import json, os, re, tempfile, urllib.request

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
    # The SUBJECT of a headline is the fighter named FIRST ("Garry eyes ...
    # before Makhachev title fight" is a Garry story), so earliest position
    # wins and the longer name only breaks a tie at the same position. Picking
    # the longest name outright put Makhachev's cutout on a Garry story.
    best = None
    for name, fid in (name_map or {}).items():
        m = re.search(r"(?<![a-z0-9])" + re.escape(name) + r"(?![a-z0-9])", t)
        if not m:
            continue
        key = (m.start(), -len(name))
        if best is None or key < best[0]:
            best = (key, fid)
    return best[1] if best else ""


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


def _echoes(head, body):
    """True when the summary is just the headline again (optionally with a
    site name or a few words glued on). Pure."""
    def norm(t):
        return " ".join("".join(c for c in (t or "").lower()
                                if c.isalnum() or c.isspace()).split())
    h, b = norm(head), norm(body)
    if not h or not b:
        return False
    return b.startswith(h) or h.startswith(b)


def build_caption(title, desc, source):
    """The text the owner pastes into the YouTube composer. Pure, calm voice:
    headline, one or two context sentences, attribution, one hashtag."""
    head = common.strip_markdown(title or "").strip()
    lines = [head]
    body = _sentence_trim(common.strip_markdown(desc or ""), CAPTION_MAX_DESC)
    # Many feeds set the summary to the headline again, sometimes with the site
    # name glued on ("... against Islam Makhachev BJPenn.com"), which printed
    # the same sentence twice in the staged caption. Exact equality was not
    # enough - compare on normalised prefix.
    if body and _echoes(head, body):
        body = ""
    if body:
        lines += ["", body]
    lines += ["", "via %s" % (source or "the wire"), "#UFC"]
    return "\n".join(lines)


def retention_note(newscfg):
    """One calm line telling the owner this copy is temporary, or "".

    studio_clean.py deletes staged posts on a daily cron, so the message says
    so rather than leaving him to wonder where yesterday's went. The number
    comes from studio_clean.retention_days, which reads the SAME newsconfig
    key the deleter uses - a second copy of that default here is exactly how
    the two would drift apart. A missing module just drops the line.
    """
    try:
        from studio_clean import retention_days
        days = retention_days(newscfg)
    except Exception:
        return ""
    return "This copy is deleted from the channel after %d day%s.\n" % (
        days, "" if days == 1 else "s")


def studio_spec(it, kind):
    """The ```json spec fence the Worker parses back out for the studio's
    staged rail (worker.js stagedParts). This is what makes a staged post
    ROUND-TRIP: the studio re-renders the text live from these fields instead
    of showing the rendered card's baked-in pixels. `kind` says what the
    SECOND attachment is ("photo" = the raw story photo, "cutout" = the
    octagon promo cutout, "" = card only). Pure."""
    spec = {
        "line": " ".join(str(it.get("line") or "").split())[:200],
        "hot": [str(h)[:60] for h in (it.get("hot") or []) if str(h or "").strip()][:8],
        "source": " ".join(str(it.get("source") or "").split())[:80],
        "emphasis": str(it.get("emphasis") or "")[:20],
        "guid": str(it.get("guid") or "")[:200],
        "template": "news",
        "colorway": "purple",
        "photo": kind,
    }
    return json.dumps({k: v for k, v in spec.items() if v}, ensure_ascii=True)


def _studio_body(score, why, caption, ping_uid, note="", spec_json=""):
    head = "<@%s> " % ping_uid if ping_uid else ""
    spec = ("\n```json\n%s\n```" % spec_json) if spec_json else ""
    return ("%sStaged post - score %d (%s)\n"
            "Copy the caption, save the image, then post or schedule it in "
            "the YouTube app.\n%s```\n%s\n```%s"
            % (head, score, why, note, caption, spec))


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
        mentions = ({"parse": [], "users": [ping_uid]} if ping_uid else None)
        silent = not ping_uid    # a ping must never ride a silent message

        img_path = ""
        photo_path = ""
        cutout_path = ""
        try:
            photo_url = og_image(it.get("link"))
            if photo_url:
                raw = fetch_bytes(photo_url)
                if raw:
                    fd, photo_path = tempfile.mkstemp(suffix=".img")
                    with os.fdopen(fd, "wb") as f:
                        f.write(raw)
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
        except SystemExit:
            img_path = ""                       # Pillow missing: text-only stage
        except Exception as e:
            img_path = ""
            print("  stage render failed (%s), staging text-only" % type(e).__name__)

        # the raw subject rides as a SECOND attachment so the studio can
        # re-render the poster with the text still live (the round-trip fix:
        # loading the rendered card back into an editor gives baked-in text)
        raw_kind = "photo" if photo_path else ("cutout" if cutout_path else "")
        body = _studio_body(score, why, caption, ping_uid,
                            retention_note(newscfg),
                            spec_json=studio_spec(it, raw_kind if img_path else ""))
        if img_path:
            files = [(img_path, "post.png")]
            if photo_path:
                files.append((photo_path, "photo.jpg"))
            elif cutout_path:
                files.append((cutout_path, "cutout.png"))
            code, _ = common.post_file(chan, body, files,
                                       allowed_mentions=mentions, silent=silent)
        else:
            code, _ = common.post_message(chan, body,
                                          allowed_mentions=mentions, silent=silent)
        for tmp in (img_path, photo_path, cutout_path):
            if tmp:
                try: os.remove(tmp)
                except OSError: pass
        return "staged (HTTP %s)%s" % (code, " with ping" if ping_uid else "")
    except Exception as e:
        return "stage failed (%s)" % type(e).__name__
