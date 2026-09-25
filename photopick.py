#!/usr/bin/env python3
"""My Cool Server - photo selection, face framing and grading for staged posters.

Sept 24 2026. The owner: "the background picture you chose was not the best...
come up with a better system which gets the best-looking pictures possible",
plus "some of these pictures are not even properly positioned". Measured on the
15 photos staged Sept 22-24 before anything changed:

  * FRAMING WAS FACE-BLIND. Every photo was cover-cropped at a fixed focal
    point (0.5, 0.30) and punched in 1.32x. "Volkov blasts Gane" shipped a
    close-up of a GLOVE with both faces cropped away, Fury's head was cut off
    at the top, and the referee took the Rosas poster. YuNet (OpenCV's own
    face detector, 232KB, MIT) found the faces in all 15 photos in ~15ms each.
  * THE PHOTO WAS A THUMBNAIL. MMA Fighting and MMA Mania serve og:image as a
    1200x628 SOCIAL-CARD CROP (`&crop=0,0,100,78.5&w=1200`) while the page's
    own JSON names the 7789x5193 original. A portrait poster cut out of a wide
    thumbnail is exactly where the chopped heads came from. Yahoo's og:image is
    a resize-fill of an original whose url is embedded in the path.
  * ONE CANDIDATE. Only og:image was ever considered, even when the article
    carries better photos.

So: candidates_from_html() collects every plausible photo on the page,
upgrade_urls() recovers the full-size original behind a CDN crop, analyze()
finds faces and measures sharpness/exposure/flatness, photo_score() ranks them,
smart_crop() frames the winner around its faces, and grade_* colour-grades it.

smart_crop and the grade maths are MIRRORED in commands_worker/studio_page.js
(smartCrop / gradePixel): the studio re-renders staged posts from the raw photo,
so the two must frame and grade the same picture the same way. The selftest pins
shared vectors in both suites - change one side, change both.

Every network and vision step is fail-silent. No OpenCV means no faces (the old
framing), no numpy means the Pillow grade, a dead download means the next
candidate - a staged post is never lost to this module.
"""
import html as _html
import io
import json
import math
import os
import re
import urllib.parse

HERE = os.path.dirname(os.path.abspath(__file__))
MODEL_PATH = os.path.join(HERE, "models", "face_detection_yunet_2023mar.onnx")

# ---- candidates --------------------------------------------------------------
CAND_CAP = 8            # distinct photos considered per article
FETCH_CAP = 4           # of which at most this many are downloaded + analysed
MIN_SIDE = 420          # a photo whose short side is under this is not a poster...
MIN_SIDE_LEAD = 300     # ...unless it is the article's OWN lead photo: a small right
                        # photo beats a big wrong one (see _relevant)
HTML_CAP = 1_500_000    # chars of the article page parsed (the head holds og:image)

# url fragments that are never the story photo
JUNK_URL = ("logo", "avatar", "icon", "sprite", "placeholder", "pixel", "1x1",
            "blank.", "spinner", "gravatar", "emoji", "badge", "/ads/",
            "doubleclick", "author", "headshot-author", "favicon", "loading",
            "transparent", "share-", "social-", "newsletter")
JUNK_EXT = (".svg", ".gif", ".ico")

# Every pattern here is LINEAR on hostile input (Sept 24 2026 pre-deploy
# review): a tag is capped at 4096 characters, so an unclosed "<meta" cannot
# make each occurrence scan the rest of a 1.5 MB page, and an attribute name
# may only START after a non-name character (the lookbehind), so a long run of
# letters inside a tag is tried once instead of from every position - 50 KB of
# it used to take 23 s and the page cap would have taken hours.
_META_RE = re.compile(r"<meta\b[^>]{0,4096}>", re.I)
_IMG_RE = re.compile(r"<img\b[^>]{0,4096}>", re.I)
_LINK_RE = re.compile(r"<link\b[^>]{0,4096}>", re.I)
_ATTR_RE = re.compile(r"""(?<![a-zA-Z_:.-])([a-zA-Z_:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))""")
_LD_RE = re.compile(r"<script[^>]{0,512}application/ld\+json[^>]{0,512}>(.{0,200000}?)</script>", re.I | re.S)
# Vox/WordPress-VIP pages embed the original upload in their page JSON
_ORIGINAL_RE = re.compile(r'"originalUrl"\s*:\s*"(https?:[^"]{8,600})"')
_WP_SIZE_RE = re.compile(r"-(\d{2,5})x(\d{2,5})(?=\.(?:jpe?g|png|webp)$)", re.I)
_EMBED_RE = re.compile(r"/(https?:/{1,2}[^?#\s]+)")


def _attrs(tag):
    """Attribute dict of one HTML tag, keys lowercased, values unescaped."""
    out = {}
    for k, v1, v2, v3 in _ATTR_RE.findall(tag or ""):
        out[k.lower()] = _html.unescape(v1 or v2 or v3 or "")
    return out


def _json_unescape(s):
    """A url lifted out of raw page JSON (\\u0026, \\/) made real. Pure."""
    try:
        return json.loads('"%s"' % s)
    except Exception:
        return s.replace("\\u0026", "&").replace("\\/", "/")


JUNK_HOSTS = ("google-analytics.", "googletagmanager.", "doubleclick.", "facebook.com",
              "scorecardresearch.", "quantserve.", "pixel.", "adsystem.", "adservice.",
              "amazon-adsystem.", "taboola.", "outbrain.", "chartbeat.", "gravatar.")
# a CDN crop box named in the path ("/image_crop/72/72/", "/w_150,h_150/")
_TINY_BOX_RE = re.compile(r"(?:image_crop|resize|crop|thumb)[/_=]*(\d{2,4})[/x,_hw=]+(\d{2,4})", re.I)


def _is_junk(url):
    low = (url or "").lower()
    if not low.startswith(("http://", "https://")):
        return True
    # a src lifted out of a script string ("\"https:/i.imgur.com/..\"")
    if any(ch in low for ch in ('"', "'", "\\", " ", "<", ">")):
        return True
    host = urllib.parse.urlsplit(low).netloc
    if any(h in host for h in JUNK_HOSTS):
        return True
    path = low.split("?", 1)[0]
    if path.endswith(JUNK_EXT) or path.endswith("/collect"):
        return True
    m = _TINY_BOX_RE.search(path)
    if m and int(m.group(1)) < 400 and int(m.group(2)) < 400:
        return True
    m = _WP_SIZE_RE.search(path)
    if m and int(m.group(1)) < 400 and int(m.group(2)) < 400:
        return True
    return any(j in low for j in JUNK_URL)


def _embedded(path):
    """An absolute url embedded in a CDN path ("/api/res/1.2/.../https://
    media.zenfs.com/en/x.jpg"), repaired when the CDN collapsed its double
    slash, or "". Pure."""
    m = _EMBED_RE.search(path or "")
    if not m:
        return ""
    emb = m.group(1)
    if not re.match(r"https?://", emb):
        emb = re.sub(r"^(https?):/", r"\1://", emb)
    return emb


def canon(url):
    """The identity of a photo regardless of which size or crop a url asks for:
    host + path, no query, no WordPress size suffix, no "-scaled". An embedded
    original (Yahoo) is its own identity. Pure."""
    u = (url or "").strip()
    u = _embedded(urllib.parse.urlsplit(u).path) or u
    p = urllib.parse.urlsplit(u)
    path = _WP_SIZE_RE.sub("", p.path or "")
    path = re.sub(r"-scaled(?=\.\w+$)", "", path, flags=re.I)
    return ((p.netloc or "").lower() + path.lower())


def upgrade_urls(url):
    """The same photo at the best size the CDN will give, best first, the
    original url always last as the fallback. Pure.

    * an original embedded in the path (Yahoo's resize service) is tried first;
    * WordPress/VIP CDNs that crop through the query (crop=, resize=, fit=, h=)
      get the crop stripped and a generous width asked for instead;
    * a WordPress "-1140x796" size suffix is dropped for the full upload."""
    u = (url or "").strip()
    if not u.startswith("http"):
        return []
    out = []
    parts = urllib.parse.urlsplit(u)
    emb = _embedded(parts.path)
    if emb:
        out.append(emb)
    q = urllib.parse.parse_qsl(parts.query, keep_blank_values=True)
    keys = {k.lower() for k, _ in q}
    if keys & {"crop", "resize", "fit", "h", "w", "width", "height"}:
        kept = [(k, v) for k, v in q
                if k.lower() not in ("crop", "resize", "fit", "h", "w", "width", "height")]
        big = kept + [("w", "2400")]
        out.append(urllib.parse.urlunsplit((parts.scheme, parts.netloc, parts.path,
                                            urllib.parse.urlencode(big), "")))
        if kept:
            out.append(urllib.parse.urlunsplit((parts.scheme, parts.netloc, parts.path,
                                                urllib.parse.urlencode(kept), "")))
    if _WP_SIZE_RE.search(parts.path or ""):
        out.append(urllib.parse.urlunsplit((parts.scheme, parts.netloc,
                                            _WP_SIZE_RE.sub("", parts.path),
                                            parts.query, "")))
    out.append(u)
    seen, uniq = set(), []
    for x in out:
        if x not in seen and x.startswith("http"):
            seen.add(x)
            uniq.append(x)
    return uniq


def _srcset_best(srcset):
    """(url, width) of the widest entry in a srcset, or ("", 0). Pure."""
    best, bw = "", 0
    for part in (srcset or "").split(","):
        bits = part.strip().split()
        if not bits:
            continue
        w = 0
        if len(bits) > 1 and bits[1].lower().endswith("w"):
            try:
                w = int(bits[1][:-1])
            except ValueError:
                w = 0
        if w >= bw:
            best, bw = bits[0], w
    return best, bw


# JSON-LD nodes that describe PEOPLE and BRANDS, never the story: their
# "image" is an author's avatar or a publisher's logo. Measured Sept 24 2026: a
# Bloody Elbow story fronted its writer's profile photo (a Person node in the
# page's @graph) over the article's own Getty picture.
LD_SKIP_TYPES = frozenset(("Person", "Organization", "NewsMediaOrganization", "ProfilePage",
                           "Brand", "WPHeader", "WPFooter", "SiteNavigationElement"))
LD_SKIP_KEYS = ("author", "publisher", "creator", "logo", "brand", "sourceOrganization")


def _walk_ld(obj, out, depth=0):
    """Image urls (with any size hints) inside one parsed JSON-LD blob,
    skipping every person and brand node (LD_SKIP_TYPES / LD_SKIP_KEYS)."""
    if depth > 6:
        return
    if isinstance(obj, list):
        for x in obj[:30]:
            _walk_ld(x, out, depth + 1)
        return
    if not isinstance(obj, dict):
        return
    typ = obj.get("@type")
    types = typ if isinstance(typ, list) else [typ]
    if any(t in LD_SKIP_TYPES for t in types if isinstance(t, str)):
        return
    if typ == "ImageObject" or (isinstance(typ, list) and "ImageObject" in typ):
        u = obj.get("contentUrl") or obj.get("url")
        if isinstance(u, str):
            out.append((u, _int(obj.get("width")), _int(obj.get("height"))))
    for key in ("image", "thumbnailUrl", "primaryImageOfPage"):
        v = obj.get(key)
        if isinstance(v, str):
            out.append((v, 0, 0))
        elif isinstance(v, (list, dict)):
            if isinstance(v, list) and all(isinstance(x, str) for x in v):
                out.extend((x, 0, 0) for x in v[:6])
            else:
                _walk_ld(v, out, depth + 1)
    for key in ("@graph", "mainEntity", "associatedMedia"):
        if key in obj:
            _walk_ld(obj.get(key), out, depth + 1)


def _int(v):
    try:
        return int(float(v))
    except (TypeError, ValueError):
        return 0


_WORD_RE = re.compile(r"[a-z]{4,}")
_TITLE_STOP = frozenset("""
with from that this they their have been will would after before over into about
says said just more most than when what which while where your youre ufc mma news
fight fights fighter title titles champion card event night main bout time back
""".split())


def title_tokens(title):
    """The NAMES in a headline, as they would appear in an image's alt text or
    file name: capitalised words of 4+ letters that are not headline
    vocabulary, lowercased with accents folded. A headline with no name gives
    an empty set, and then no body image qualifies at all - only the page's
    own lead photos (og, JSON-LD, the page JSON original). Pure."""
    import unicodedata
    t = "".join(c for c in unicodedata.normalize("NFKD", str(title or ""))
                if not unicodedata.combining(c))
    try:
        import scorer
        common_words = scorer.HEADLINE_WORDS
    except Exception:
        common_words = frozenset()
    out = set()
    for w in re.findall(r"[A-Za-z']{4,}", t):
        lw = w.lower().strip("'")
        if lw.endswith("'s"):
            lw = lw[:-2]
        if w[0].isupper() and len(lw) >= 4 and lw not in _TITLE_STOP and lw not in common_words:
            out.add(lw)
    return out


def _relevant(url, alt, tokens):
    """True when a body image names someone in the headline in its alt text or
    its file name. Measured Sept 24 2026: all three Sherdog stories that day
    fell through to the SAME sidebar photo of an unrelated fighter, because the
    story's own header image was small. A wrong face on a story is worse than
    a small right one, so a body image has to earn its place. Pure."""
    if not tokens:
        return False                      # nobody named: nothing to match on
    hay = (str(alt or "") + " " + urllib.parse.unquote(urllib.parse.urlsplit(url).path)).lower()
    return any(t in hay for t in tokens)


def _article_spans(page):
    """(start, end) of every <article>...</article> block, found with str.find -
    a lazy regex re-scanned the rest of the page from every unclosed "<article"
    (quadratic). An unclosed one ends the search. Pure."""
    low = page.lower()
    spans, i = [], 0
    while len(spans) < 50:
        s = low.find("<article", i)
        if s == -1:
            break
        nxt = low[s + 8:s + 9]
        if nxt and (nxt.isalnum() or nxt in "-_"):
            i = s + 8                        # "<articles", "<article-x": not the tag
            continue
        e = low.find("</article>", s)
        if e == -1:
            break
        spans.append((s, e + len("</article>")))
        i = e + len("</article>")
    return spans


def candidates_from_html(page, base_url="", cap=CAND_CAP, title=""):
    """Every plausible story photo on an article page, best-first:
    [{"key", "urls": [best size first ...], "how": "og"|"ld"|"orig"|"img",
      "w": hint, "h": hint}]. The og:image is the editor's pick and leads;
    photos that are the same upload at different sizes collapse into one
    candidate whose urls run largest first. With a `title`, an image from the
    page BODY counts only when it sits inside the <article> (when the page has
    one) and names someone in the headline (_relevant) - sidebars and "more
    stories" rails carry other people's photos. Pure."""
    page = (page or "")[:HTML_CAP]
    tokens = title_tokens(title) if title else set()
    spans = _article_spans(page)
    found = []                                   # (url, how, w, h) in priority order
    og_w = og_h = 0
    for tag in _META_RE.findall(page):
        a = _attrs(tag)
        key = (a.get("property") or a.get("name") or a.get("itemprop") or "").lower()
        val = a.get("content") or ""
        if key in ("og:image:width",):
            og_w = _int(val)
        elif key in ("og:image:height",):
            og_h = _int(val)
    for tag in _META_RE.findall(page):
        a = _attrs(tag)
        key = (a.get("property") or a.get("name") or a.get("itemprop") or "").lower()
        val = (a.get("content") or "").strip()
        if not val:
            continue                  # content="" would resolve to the page itself
        if key in ("og:image", "og:image:url", "og:image:secure_url"):
            found.append((val, "og", og_w, og_h))
        elif key in ("twitter:image", "twitter:image:src", "image"):
            found.append((val, "og", 0, 0))
    for m in _ORIGINAL_RE.finditer(page):
        found.append((_json_unescape(m.group(1)), "orig", 0, 0))
        if len([f for f in found if f[1] == "orig"]) >= 4:
            break
    for blob in _LD_RE.findall(page)[:8]:
        try:
            data = json.loads(blob.strip())
        except Exception:
            continue
        tmp = []
        _walk_ld(data, tmp)
        for u, w, h in tmp[:10]:
            found.append((u, "ld", w, h))
    for tag in _LINK_RE.findall(page):
        a = _attrs(tag)
        if (a.get("rel") or "").lower() == "image_src" and a.get("href"):
            found.append((a["href"], "og", 0, 0))
    for im in list(_IMG_RE.finditer(page))[:400]:
        tag = im.group(0)
        if spans and not any(s <= im.start() < e for s, e in spans):
            continue                      # outside the article: a sidebar or a rail
        a = _attrs(tag)
        url, w = _srcset_best(a.get("data-srcset") or a.get("srcset") or "")
        if not url:
            url = a.get("data-src") or a.get("data-lazy-src") or a.get("data-original") or a.get("src") or ""
            w = _int(a.get("width"))
        if not url or url.startswith("data:"):
            continue
        meta = " ".join((a.get("alt") or "", a.get("class") or "")).lower()
        if any(j in meta for j in ("logo", "avatar", "author", "icon")):
            continue
        if w and w < 480:
            continue
        if title and not _relevant(url, a.get("alt"), tokens):
            continue
        found.append((url, "img", w, _int(a.get("height"))))
    cands, by_key = [], {}
    for url, how, w, h in found:
        url = urllib.parse.urljoin(base_url or "", _html.unescape(url.strip()))
        if _is_junk(url):
            continue
        k = canon(url)
        if not k:
            continue
        if k in by_key:
            c = by_key[k]
            # a hinted-larger variant of the same upload goes to the front; an
            # untouched original rides BEHIND the CDN's own large resize (the
            # 2400px variant is a fraction of an 8 MB original's download)
            if url in c["urls"]:
                continue
            if w and w > c["w"]:
                c["urls"].insert(0, url)
                c["w"], c["h"] = w, h or c["h"]
            else:
                c["urls"].append(url)
            continue
        c = {"key": k, "urls": [url], "how": how, "w": w, "h": h}
        by_key[k] = c
        cands.append(c)
        if len(cands) >= cap:
            break
    # expand every candidate's url list with the CDN upgrades, best first
    for c in cands:
        urls = []
        for u in c["urls"]:
            for v in upgrade_urls(u):
                if v not in urls:
                    urls.append(v)
        c["urls"] = urls[:5]
    return cands


# ---- analysis ------------------------------------------------------------------
_DETECTOR = {"det": None, "size": None, "tried": False}


def _cv2():
    try:
        import cv2                              # noqa: F401 - optional
        import numpy                            # noqa: F401
        return cv2
    except Exception:
        return None


def _quiet(cv2):
    """OpenCV 5's dnn engine prints a WARN line per detector for every call;
    in an hourly job log that is noise hiding the lines that matter."""
    for fn in (lambda: cv2.utils.logging.setLogLevel(cv2.utils.logging.LOG_LEVEL_ERROR),
               lambda: cv2.setLogLevel(2)):
        try:
            fn()
            return
        except Exception:
            continue


def detect_faces(img, model_path=MODEL_PATH):
    """Faces in a Pillow image as [[x, y, w, h, score], ...], every value a
    fraction of the image (0-1), strongest first. [] whenever OpenCV, numpy
    or the model file is missing - the caller keeps the old framing. Never
    raises."""
    cv2 = _cv2()
    if cv2 is None or not os.path.exists(model_path):
        return []
    try:
        import numpy as np
        _quiet(cv2)
        im = img.convert("RGB")
        W, H = im.size
        s = min(1.0, 900.0 / max(W, H))
        if s < 1.0:
            im = im.resize((max(1, int(W * s)), max(1, int(H * s))))
        w, h = im.size
        arr = cv2.cvtColor(np.asarray(im), cv2.COLOR_RGB2BGR)
        det = _DETECTOR["det"]
        if det is None:
            det = cv2.FaceDetectorYN.create(model_path, "", (w, h), 0.62, 0.3, 50)
            _DETECTOR["det"] = det
        det.setInputSize((w, h))
        _ok, faces = det.detect(arr)
        out = []
        if faces is not None:
            for f in faces:
                fx, fy, fw, fh, sc = float(f[0]), float(f[1]), float(f[2]), float(f[3]), float(f[14])
                # clip into the frame; YuNet boxes run past the edge on cut-off heads
                x0, y0 = max(0.0, fx), max(0.0, fy)
                x1, y1 = min(float(w), fx + fw), min(float(h), fy + fh)
                if x1 - x0 < 4 or y1 - y0 < 4:
                    continue
                out.append([round(x0 / w, 4), round(y0 / h, 4), round((x1 - x0) / w, 4),
                            round((y1 - y0) / h, 4), round(sc, 3)])
        return rank_faces(out)
    except Exception:
        return []


def face_weight(f):
    """How much one face should steer the frame: area x confidence, nudged
    toward faces near the middle (the subject is rarely a spectator at the
    edge). Pure."""
    x, y, w, h = f[0], f[1], f[2], f[3]
    sc = f[4] if len(f) > 4 else 1.0
    cx = x + w / 2.0
    return w * h * max(0.05, sc) * (1.15 - 0.3 * abs(cx - 0.5))


def rank_faces(faces, min_h=0.035, keep=4):
    """Strongest faces first, crowd-sized ones dropped, at most `keep`. Pure."""
    good = [list(f) for f in (faces or []) if len(f) >= 4 and f[3] >= min_h and f[2] > 0]
    good.sort(key=face_weight, reverse=True)
    return good[:keep]


def _gray_small(img, side=512):
    g = img.convert("L")
    W, H = g.size
    s = min(1.0, float(side) / max(W, H))
    if s < 1.0:
        g = g.resize((max(1, int(W * s)), max(1, int(H * s))))
    return g


def sharpness(img, box=None):
    """Variance of the Laplacian on a 512px grayscale copy (on `box`, a
    fractional region, when given). Higher is sharper; a soft upscale or a
    motion-blurred frame lands low. Pillow-only."""
    from PIL import ImageFilter, ImageStat
    g = _gray_small(img)
    if box:
        W, H = g.size
        x, y, w, h = box[:4]
        g = g.crop((int(x * W), int(y * H), max(int(x * W) + 2, int((x + w) * W)),
                    max(int(y * H) + 2, int((y + h) * H))))
    lap = g.filter(ImageFilter.Kernel((3, 3), [0, 1, 0, 1, -4, 1, 0, 1, 0], scale=1, offset=128))
    return float(ImageStat.Stat(lap).var[0])


TEXT_EDGE = 90          # a horizontal luminance step this hard is a glyph edge
GRAPHIC_EDGES = 0.014   # share of such steps above which a frame reads as a graphic


def text_edges(img):
    """Share of horizontal neighbour pairs, on a 256px grayscale copy, whose
    luminance jumps by more than TEXT_EDGE. Calibrated Sept 24 2026 on real
    candidates: 15 staged news photos and 3 honest photos sat at 0.001-0.011;
    the promo cards the pages also carry ("SURPRISED?" with a chevron, the
    MOICANO VS NOLAN fight graphic, the UFC 331 event poster) sat at
    0.019-0.028. A graphic under the poster's own type is two headlines
    fighting, so it ranks last. Pillow-only; never raises."""
    try:
        from PIL import ImageChops
        g = img.convert("L")
        g.thumbnail((256, 256))
        w, h = g.size
        if w < 8 or h < 8:
            return 0.0
        d = ImageChops.difference(g.crop((1, 0, w, h)), g.crop((0, 0, w - 1, h)))
        hist = d.histogram()
        total = float(sum(hist)) or 1.0
        return round(sum(hist[TEXT_EDGE + 1:]) / total, 4)
    except Exception:
        return 0.0


def luma_stats(img, box=None):
    """(mean, std) luminance 0-1 of the image or a fractional `box`. Pillow-only."""
    from PIL import ImageStat
    g = _gray_small(img, 256)
    if box:
        W, H = g.size
        x, y, w, h = box[:4]
        g = g.crop((int(x * W), int(y * H), max(int(x * W) + 2, int((x + w) * W)),
                    max(int(y * H) + 2, int((y + h) * H))))
    st = ImageStat.Stat(g)
    return st.mean[0] / 255.0, st.stddev[0] / 255.0


def analyze(raw, min_side=MIN_SIDE):
    """Everything the ranker and the framer need from one downloaded photo, or
    None when it is not usable (undecodable, animated, too small). Never
    raises. {w, h, faces, sharp, face_sharp, lum, con, text}."""
    try:
        from PIL import Image, ImageOps
        im = Image.open(io.BytesIO(raw))
        if getattr(im, "is_animated", False):
            return None
        im = ImageOps.exif_transpose(im).convert("RGB")
        w, h = im.size
        if min(w, h) < min_side:
            return None
        faces = detect_faces(im)
        lum, con = luma_stats(im, faces[0] if faces else None)
        return {"w": w, "h": h, "faces": faces,
                "sharp": round(sharpness(im), 1),
                "face_sharp": round(sharpness(im, faces[0]), 1) if faces else 0.0,
                "lum": round(lum, 3), "con": round(con, 3),
                "text": text_edges(im)}
    except Exception:
        return None


def photo_score(info, how="og", out_w=1080, out_h=1350):
    """0-100: how good a poster this photo makes. Resolution the crop can
    actually use, a clear face big enough to carry the frame, sharpness,
    sane exposure, and no baked-in type (text_edges). The article's own lead
    photo (og) is the editor's pick and gets a small tiebreak. Pure."""
    if not info:
        return 0.0
    w, h = float(info.get("w") or 0), float(info.get("h") or 0)
    if w <= 0 or h <= 0:
        return 0.0
    a = float(out_w) / float(out_h)
    crop_h = min(h, w / a)
    s = 30.0 * min(1.0, crop_h / 1100.0)
    faces = info.get("faces") or []
    if faces:
        f = faces[0]
        face_px = f[3] * h
        s += 35.0 * max(0.0, min(1.0, (face_px - 50.0) / 230.0))
        s += 5.0 * min(1.0, max(0.0, (f[4] if len(f) > 4 else 0.8) - 0.6) / 0.35)
        big = [g for g in faces if g[3] >= 0.55 * f[3]]
        if len(big) > 3:
            s -= 10.0                               # a crowd, not a subject
        sh = float(info.get("face_sharp") or 0.0)
    else:
        s += 8.0
        sh = float(info.get("sharp") or 0.0)
    s += 15.0 * max(0.0, min(1.0, (sh - 40.0) / 360.0))
    lum = float(info.get("lum") or 0.4)
    s += 7.0 if 0.14 <= lum <= 0.82 else 0.0
    txt = float(info.get("text") or 0.0)
    if txt > GRAPHIC_EDGES:
        s -= 45.0 * min(1.0, (txt - GRAPHIC_EDGES) / 0.008)   # promo graphic / text card
    if how == "og":
        s += 6.0
    return max(0.0, min(100.0, round(s, 1)))


# ---- framing ---------------------------------------------------------------------
# face_frac: the primary face's height as a share of the crop height; face_cy:
# where the face centre sits, as a share of the crop height from the top. The
# text block owns the bottom ~40% of a 4:5 poster, so a face centred at 0.32 and
# a quarter of the frame tall ends around 0.45 - clear of the type, with the
# shoulders running down into it the way the reference posts frame a subject.
CROP_TUNE = {"4:5": (0.25, 0.32), "1:1": (0.23, 0.30), "9:16": (0.18, 0.30)}
MAX_UPSCALE = 1.9       # never punch in so far that the source is stretched more
FACE_MAX = 0.55         # a face may never be more than this share of the frame
HEADROOM = 0.05         # the top of every kept face stays this far below the crop top
PAIR_MIN = 0.7          # a second face at least this big joins the frame...
PAIR_SPAN = 0.8         # ...when both fit inside this share of the crop width
NOFACE_FOCUS_Y = 0.30   # the old cover-crop focal point, kept for faceless photos


def crop_tune(out_w, out_h):
    """(face_frac, face_cy) for the nearest supported aspect. Pure."""
    a = float(out_w) / float(out_h)
    best, bd = CROP_TUNE["4:5"], 9.0
    for key, val in CROP_TUNE.items():
        n, d = key.split(":")
        dd = abs(a - float(n) / float(d))
        if dd < bd:
            best, bd = val, dd
    return best


def smart_crop(iw, ih, faces, out_w, out_h):
    """The source rectangle (x, y, w, h) in pixels that frames a photo for an
    out_w x out_h poster around its faces. Faceless photos keep the old
    cover crop (full size, centred, focal y 0.30). Pure.

    MIRRORED by smartCrop() in commands_worker/studio_page.js; the selftest
    pins shared vectors in both suites."""
    iw, ih = float(iw), float(ih)
    A = float(out_w) / float(out_h)
    ch_max = min(ih, iw / A)
    if not faces:
        ch = ch_max
        cw = ch * A
        return ((iw - cw) / 2.0, (ih - ch) * NOFACE_FOCUS_Y, cw, ch)
    frac, cy_t = crop_tune(out_w, out_h)
    f0 = faces[0]
    fx, fy, fw, fh = f0[0] * iw, f0[1] * ih, f0[2] * iw, f0[3] * ih
    ch_floor = min(ch_max, max(float(out_h) / MAX_UPSCALE, fh / FACE_MAX))
    ch = min(ch_max, max(fh / frac, ch_floor))
    cw = ch * A
    cx, cy = fx + fw / 2.0, fy + fh / 2.0
    top = fy
    if len(faces) > 1:
        f1 = faces[1]
        gx, gy, gw, gh = f1[0] * iw, f1[1] * ih, f1[2] * iw, f1[3] * ih
        if gh >= PAIR_MIN * fh:
            ux0, ux1 = min(fx, gx), max(fx + fw, gx + gw)
            # Zoom OUT, never past the whole photo, until the pair fits. Two
            # faces of a similar size are both the story, or one of them is:
            # a size tiebreak framed Amanda Nunes's coach and cut her out of
            # her own title photo (Sept 25 2026, a 10% taller face box).
            need = (ux1 - ux0) / PAIR_SPAN
            if need > cw and need / A <= ch_max:
                ch = need / A
                cw = ch * A
            if ux1 - ux0 <= PAIR_SPAN * cw:
                cx = (ux0 + ux1) / 2.0
                cy = (cy + gy + gh / 2.0) / 2.0
                top = min(fy, gy)
    x0 = max(0.0, min(iw - cw, cx - cw / 2.0))
    y0 = max(0.0, min(ih - ch, cy - cy_t * ch))
    if top - y0 < HEADROOM * ch:
        y0 = max(0.0, top - HEADROOM * ch)
    return (x0, y0, cw, ch)


# ---- grading ---------------------------------------------------------------------
# One look is a handful of numbers, so Python and the studio can apply the SAME
# grade per pixel (studio_page.js gradePixel mirrors grade_pixel exactly):
#   con   S-curve strength (0 = none), a sigmoid blended over the identity
#   sat   saturation multiplier, applied around the pixel's own luminance
#   vib   vibrance: extra saturation for MUTED colours only
#   sh    shadow colour + strength, SCREENED in (lifts the blacks toward it)
#   hi    highlight colour + strength, mixed in by highlight weight
#   mono  1 = black and white before the tones
# Laws from the Aug blind rounds hold: the scene is graded, the subject stays a
# natural colour photograph - no look touches midtone skin hue by more than a
# few percent, and the tints ride the SHADOWS and the brightest highlights.
LOOKS = {
    "natural": {"con": 0.30, "sat": 1.04, "vib": 0.16, "sh": "#000000", "sh_a": 0.0,
                "hi": "#FFFFFF", "hi_a": 0.0, "mono": 0},
    "fight":   {"con": 0.50, "sat": 0.95, "vib": 0.10, "sh": "#241C4E", "sh_a": 0.30,
                "hi": "#FFD2A8", "hi_a": 0.10, "mono": 0},
    "cinema":  {"con": 0.42, "sat": 0.90, "vib": 0.06, "sh": "#0F3440", "sh_a": 0.32,
                "hi": "#FFB877", "hi_a": 0.14, "mono": 0},
    "mono":    {"con": 0.58, "sat": 0.00, "vib": 0.00, "sh": "#161B2C", "sh_a": 0.20,
                "hi": "#FFFFFF", "hi_a": 0.0, "mono": 1},
    "clean":   {"con": 0.0, "sat": 1.0, "vib": 0.0, "sh": "#000000", "sh_a": 0.0,
                "hi": "#FFFFFF", "hi_a": 0.0, "mono": 0},
}
DEFAULT_LOOK = "fight"
SOMBER = ("dies", "dead at", "passes away", "passed away", "killed", "death",
          "tragedy", "funeral", "tribute", "rest in peace", "mourn")
TARGET_FACE_LUM = 0.50  # sRGB mean the face region is lifted/eased toward
TARGET_LUM = 0.42       # ...or the whole frame, with no face
# asymmetric on purpose: a dark face is the common failure (arena lighting,
# backlit cage) and is lifted hard; a bright face is only eased a little,
# because a poster subject that reads light and lit is the reference look
GAMMA_LO, GAMMA_HI = 0.72, 1.18


def _hex3(h):
    h = str(h or "#000000").lstrip("#")
    if len(h) == 3:
        h = "".join(c * 2 for c in h)
    try:
        return (int(h[0:2], 16) / 255.0, int(h[2:4], 16) / 255.0, int(h[4:6], 16) / 255.0)
    except ValueError:
        return (0.0, 0.0, 0.0)


_SOMBER_RE = re.compile(r"\b(?:%s)\b" % "|".join(re.escape(k) for k in SOMBER))


def pick_look(title):
    """The house look for a story: the respectful monochrome for a death or a
    tragedy, the purple-shadow fight look for everything else. Whole words
    only: "Highly skilled", "Buddies no more", "UFC studies" and "deathmatch"
    all used to get the mourning look (Sept 24 2026 pre-deploy review). Pure."""
    return "mono" if _SOMBER_RE.search((title or "").lower()) else DEFAULT_LOOK


def auto_gamma(lum, has_face):
    """The exposure step as a gamma exponent that moves the measured mean
    toward the target: <1 lifts a dark photo, >1 eases a bright one. Pure."""
    target = TARGET_FACE_LUM if has_face else TARGET_LUM
    lum = min(0.95, max(0.03, float(lum or target)))
    g = math.log(target) / math.log(lum)
    # a gamma is an EXPONENT: x**g with g<1 lifts. log(t)/log(l) maps l->t.
    return round(max(GAMMA_LO, min(GAMMA_HI, g)), 3)


def grade_params(look, gamma=1.0, strength=1.0):
    """One look scaled by `strength` (0-1) plus the exposure gamma, as the flat
    dict grade_pixel and the studio both consume. Pure."""
    base = LOOKS.get(look) or LOOKS[DEFAULT_LOOK]
    s = max(0.0, min(1.0, float(strength)))
    p = {
        "gamma": 1.0 + (float(gamma) - 1.0) * s if look != "clean" else 1.0,
        "con": base["con"] * s,
        "sat": 1.0 + (base["sat"] - 1.0) * s,
        "vib": base["vib"] * s,
        "sh": _hex3(base["sh"]), "sh_a": base["sh_a"] * s,
        "hi": _hex3(base["hi"]), "hi_a": base["hi_a"] * s,
        "mono": base["mono"] if s > 0 else 0,
    }
    return p


def _sig(x, g=6.0):
    return 1.0 / (1.0 + math.exp(-g * (x - 0.5)))


_S0, _S1 = _sig(0.0), _sig(1.0)


def _smooth(a, b, x):
    t = max(0.0, min(1.0, (x - a) / (b - a)))
    return t * t * (3.0 - 2.0 * t)


def grade_pixel(r, g, b, p):
    """One sRGB pixel (0-1 floats) through a grade. The reference
    implementation: grade_array vectorises exactly this, and studio_page.js
    gradePixel is a line-for-line mirror. Pure."""
    gm = p["gamma"]
    if gm != 1.0:
        r, g, b = r ** gm, g ** gm, b ** gm
    lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
    if p["mono"]:
        r = g = b = lum
    c = p["con"]
    if c > 0:
        def curve(v):
            return v + c * ((_sig(v) - _S0) / (_S1 - _S0) - v)
        r, g, b = curve(r), curve(g), curve(b)
        lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
    mx, mn = max(r, g, b), min(r, g, b)
    satv = (mx - mn) / (mx + 1e-6)
    k = p["sat"] * (1.0 + p["vib"] * (1.0 - min(1.0, satv * 1.6)))
    r, g, b = lum + (r - lum) * k, lum + (g - lum) * k, lum + (b - lum) * k
    sa = p["sh_a"]
    if sa > 0:
        w = sa * (1.0 - _smooth(0.0, 0.62, lum)) ** 1.5
        sr, sg, sb = p["sh"]
        r = r + w * (sr + r * (1 - sr) - r)    # screen, weighted into the shadows
        g = g + w * (sg + g * (1 - sg) - g)
        b = b + w * (sb + b * (1 - sb) - b)
    ha = p["hi_a"]
    if ha > 0:
        w = ha * _smooth(0.55, 1.0, lum)
        hr, hg, hb = p["hi"]
        r, g, b = r + w * (r * hr - r), g + w * (g * hg - g), b + w * (b * hb - b)
    return (max(0.0, min(1.0, r)), max(0.0, min(1.0, g)), max(0.0, min(1.0, b)))


def grade_array(arr, p):
    """grade_pixel over a float32 HxWx3 numpy array (0-1), vectorised."""
    import numpy as np
    x = np.clip(arr.astype(np.float32), 0.0, 1.0)
    if p["gamma"] != 1.0:
        x = np.power(x, np.float32(p["gamma"]))
    lum = x[..., 0] * 0.2126 + x[..., 1] * 0.7152 + x[..., 2] * 0.0722
    if p["mono"]:
        x = np.repeat(lum[..., None], 3, axis=2)
    c = p["con"]
    if c > 0:
        s = 1.0 / (1.0 + np.exp(-6.0 * (x - 0.5)))
        x = x + np.float32(c) * ((s - _S0) / (_S1 - _S0) - x)
        lum = x[..., 0] * 0.2126 + x[..., 1] * 0.7152 + x[..., 2] * 0.0722
    mx, mn = x.max(axis=2), x.min(axis=2)
    satv = (mx - mn) / (mx + 1e-6)
    k = p["sat"] * (1.0 + p["vib"] * (1.0 - np.minimum(1.0, satv * 1.6)))
    x = lum[..., None] + (x - lum[..., None]) * k[..., None]
    if p["sh_a"] > 0:
        t = np.clip(lum / 0.62, 0.0, 1.0)
        w = p["sh_a"] * (1.0 - t * t * (3.0 - 2.0 * t)) ** 1.5
        col = np.array(p["sh"], dtype=np.float32)
        x = x + w[..., None] * (col + x * (1.0 - col) - x)
    if p["hi_a"] > 0:
        t = np.clip((lum - 0.55) / 0.45, 0.0, 1.0)
        w = p["hi_a"] * (t * t * (3.0 - 2.0 * t))
        col = np.array(p["hi"], dtype=np.float32)
        x = x + w[..., None] * (x * col - x)
    return np.clip(x, 0.0, 1.0)


def apply_grade(img, p):
    """Grade a Pillow RGB image. numpy when present (exact); without it the
    exposure + curve + saturation steps still run through Pillow LUTs, which
    is the old grade's quality floor. Never raises - worst case the photo
    comes back untouched."""
    try:
        import numpy as np
        from PIL import Image
        arr = np.asarray(img.convert("RGB"), dtype=np.float32) / 255.0
        out = grade_array(arr, p)
        return Image.fromarray((out * 255.0 + 0.5).astype(np.uint8), "RGB")
    except Exception:
        pass
    try:
        from PIL import ImageEnhance
        lut = []
        for i in range(256):
            v = (i / 255.0) ** p["gamma"]
            c = p["con"]
            if c > 0:
                v = v + c * ((_sig(v) - _S0) / (_S1 - _S0) - v)
            lut.append(int(max(0, min(255, round(v * 255)))))
        out = img.convert("RGB").point(lut * 3)
        out = ImageEnhance.Color(out).enhance(p["sat"] * (1.0 + p["vib"] * 0.5))
        return out.convert("L").convert("RGB") if p["mono"] else out
    except Exception:
        return img


def clarity(img, amount=0.22, radius=18):
    """Local contrast: the photo minus a wide blur, added back. Makes faces and
    muscle read at thumbnail size without the crunchy halo of a small-radius
    sharpen. Pillow-only; never raises."""
    if amount <= 0:
        return img
    try:
        from PIL import ImageChops, ImageFilter
        base = img.convert("RGB")
        blur = base.filter(ImageFilter.GaussianBlur(radius))
        hi = ImageChops.subtract(base, blur, scale=1.0, offset=128)
        return ImageChops.blend(base, ImageChops.overlay(base, hi), max(0.0, min(1.0, amount)))
    except Exception:
        return img


# ---- the whole decision ----------------------------------------------------------
URLS_PER_CAND = 2       # the best size the CDN offers, then the page's own - never five
SLOW_FETCH = 6.0        # a failed download slower than this marks its host slow


def choose(cands, fetch, budget=4, good_enough=78.0, deadline=None):
    """Download, analyse and rank candidates. Returns
    {"raw", "info", "url", "score", "alts": [{"url", "score"}]} for the
    winner, or None. `fetch(url) -> bytes|None` is injected (tests, timeouts).
    Stops early once a photo scores `good_enough`. Never raises.

    `deadline` is a time.monotonic() value after which no new download starts.
    The pre-deploy review (Sept 24 2026) held pick_photo for 192 s on a host
    that accepted connections and never answered: 4 candidates x 5 url
    variants x a 12 s timeout, one after another, on the news loop's only
    thread. Now at most URLS_PER_CAND variants per candidate, a host that
    stalls once is skipped for the rest, and the whole pass has a clock."""
    import time as _time
    scored = []
    tried = 0
    slow = set()
    for c in cands or []:
        if tried >= budget:
            break
        if deadline is not None and _time.monotonic() >= deadline:
            break
        raw = None
        used = ""
        for u in (c.get("urls") or [])[:URLS_PER_CAND]:
            host = urllib.parse.urlsplit(u).netloc.lower()
            if host in slow or (deadline is not None and _time.monotonic() >= deadline):
                continue
            t0 = _time.monotonic()
            try:
                raw = fetch(u)
            except Exception:
                raw = None
            if raw:
                used = u
                break
            if _time.monotonic() - t0 > SLOW_FETCH:
                slow.add(host)
        tried += 1
        if not raw:
            continue
        lead = c.get("how") in ("og", "orig", "ld")
        info = analyze(raw, MIN_SIDE_LEAD if lead else MIN_SIDE)
        if not info:
            continue
        sc = photo_score(info, c.get("how", "img"))
        scored.append({"raw": raw, "info": info, "url": used, "score": sc,
                       "how": c.get("how")})
        if sc >= good_enough:
            break
    if not scored:
        return None
    scored.sort(key=lambda d: d["score"], reverse=True)
    best = scored[0]
    best["alts"] = [{"url": d["url"], "score": d["score"],
                     "faces": (d.get("info") or {}).get("faces") or []}
                    for d in scored[1:] if d["score"] >= 35.0][:3]
    return best


def shrink_for_upload(raw, info, max_edge=2400, quality=90):
    """(bytes, ext) of the chosen photo re-encoded for the Discord upload: at
    most `max_edge` on the long side, JPEG. An 8 MB 7789px original is useless
    to the studio on a phone; face boxes are fractions, so they survive the
    resize unchanged. Falls back to the original bytes. Never raises."""
    try:
        from PIL import Image, ImageOps
        im = ImageOps.exif_transpose(Image.open(io.BytesIO(raw))).convert("RGB")
        w, h = im.size
        s = min(1.0, float(max_edge) / max(w, h))
        if s < 1.0:
            im = im.resize((max(1, int(w * s)), max(1, int(h * s))), Image.Resampling.LANCZOS)
        buf = io.BytesIO()
        im.save(buf, "JPEG", quality=quality, optimize=True, progressive=True)
        return buf.getvalue(), "jpg"
    except Exception:
        return raw, ""


PAIR_CONF = 0.85        # a secondary face must be at least this sure to ship


def spec_faces(faces):
    """Face boxes as the compact list the spec fence carries: at most 3,
    [x, y, w, h] rounded to 3 places. The strongest face always ships; a
    secondary one only when YuNet is PAIR_CONF sure of it - a half-turned
    referee (0.78 on the Rosas photo) must not be framed in as the second
    half of a two-shot. The spec drops scores, so this is where confidence
    decides; smart_crop then reasons on size alone, in both languages. Pure."""
    out = []
    kept = [f for i, f in enumerate(faces or [])
            if i == 0 or len(f) < 5 or float(f[4]) >= PAIR_CONF]
    for f in kept[:3]:
        try:
            out.append([round(float(f[0]), 3), round(float(f[1]), 3),
                        round(float(f[2]), 3), round(float(f[3]), 3)])
        except (TypeError, ValueError, IndexError):
            continue
    return out
