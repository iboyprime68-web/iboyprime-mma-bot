#!/usr/bin/env python3
"""iBoyPrime - branded post graphics renderer (Pillow-only).

Renders the Community-post graphics for the channel: news cards, fight
announcements, "last 5 opponents" comparisons and square poll option tiles.
Every template returns a PIL Image; callers decide where the bytes go.

This module is the ONE file in bots_github/ allowed to import PIL (the cron
bots stay standard-library only). It never talks to the network and never
reads secrets. All tuning knobs live in STYLE / PALETTE at the top so the
aesthetics can be iterated without touching layout code.

Usage:
    python postcard.py --demo [--out DIR]   renders one of each template with
                                            synthetic placeholder photos
"""
import os, sys

try:
    from PIL import Image, ImageDraw, ImageFilter, ImageFont, ImageOps
except ImportError:
    raise SystemExit("ERROR: Pillow is required for postcard.py (pip install pillow).")

HERE      = os.path.dirname(os.path.abspath(__file__))
FONT_DIR  = os.path.join(HERE, "fonts")
BRAND_DIR = os.path.join(HERE, "brand")
RESAMPLE  = Image.Resampling.LANCZOS

# Demo output goes to the local scratchpad on the dev box; override with
# POSTCARD_DEMO_DIR (CI, other machines) or --out.
DEMO_DIR = os.environ.get("POSTCARD_DEMO_DIR") or os.path.join(
    "C:\\", "Users", "OSAMAA~1", "AppData", "Local", "Temp", "claude",
    "C--Users-Osama-Asif-Claude-Projects-discordServer",
    "7e0db7e5-9cd8-4fe5-987a-cba92c3cc7a3", "scratchpad", "demo_renders")

PALETTE = {
    "accent":      "#8B70FF",   # 7C5CFF-family purple, lifted so it reads on near-black
    "accent_deep": "#5B3DF5",   # darker sibling for fills that sit under text
    "ink":         "#0B0B0E",   # near-black canvas
    "ink_soft":    "#17141F",   # slightly purple-warmed black for gradients / tiles
    "paper":       "#F5F4F6",   # headline white
    "paper_dim":   "#B9B5C4",   # secondary text on dark
}

WEIGHTS = {
    "black":     "Black",
    "extrabold": "ExtraBold",
    "bold":      "Bold",
    "semibold":  "SemiBold",
    "medium":    "Medium",
    "regular":   "Regular",
}

LOGO_FILES = {
    "purple": "flame_purple.png",
    "pink":   "flame_pink.png",
    "green":  "flame_green.png",
    "fire":   "flame_fire.png",
}

KICKER_DEFAULT = "IBOYPRIME NEWS"
LAST5_TITLE_DEFAULT = "LAST 5 OPPONENTS"

# Every magic number lives here so a critic pass can retune without code edits.
STYLE = {
    # canvases
    "post_w": 1080, "post_h": 1350,
    "poll_w": 640,  "poll_h": 640,
    "margin": 72,

    # type
    "line_spacing": 1.06,        # line height as a multiple of font size
    "headline_max": 124,         # fit_text auto-size ceiling
    "headline_min": 44,          # fit_text auto-size floor
    "kicker_size": 30,
    "credit_size": 26,
    "tracking_kicker": 6,        # extra px between kicker glyphs
    "tracking_credit": 4,
    "tracking_meta": 6,

    # photo treatment
    "crop_focus_y": 0.38,        # cover-crop focal point (slightly above center)
    "scrim_strength": 0.92,      # bottom scrim under headlines
    "scrim_gamma": 1.6,          # scrim falloff curve (higher = tighter to the edge)
    "top_scrim_strength": 0.35,  # light top scrim so the badge always reads
    "tint_strength": 0.55,       # duotone grade amount in tint()
    "tint_black": 0.14,          # shadow end: ink mixed this far toward the accent
    "tint_white": 0.90,          # highlight end: accent mixed this far toward paper

    # brand marks
    "badge_size": 112,
    "badge_margin": 48,
    "watermark_scale": 0.62,     # watermark logo side vs the short canvas edge
    "watermark_alpha": 0.07,
    "logo_key_scale": 3.5,       # background keying: alpha = distance-from-bg * scale

    # news template
    "news_block_h": 470,         # vertical budget for the headline block
    "news_lines": 4,
    "news_kicker_gap": 26,       # gap between kicker and headline
    "news_credit_gap": 18,       # gap between headline block and credit line
    "kicker_bar_w": 12,          # accent bar left of the kicker
    "kicker_bar_pad": 18,

    # announce template
    "announce_band_w": 360,      # readable center band over the photo seam
    "announce_band_alpha": 150,  # 0-255
    "announce_band_blur": 60,
    "announce_bottom_scrim": 0.55,
    "announce_center_y": 0.42,   # vertical anchor of the name stack
    "announce_name_w": 900,
    "announce_name_max": 92,
    "announce_name_min": 40,
    "announce_name_lines": 2,
    "announce_gap": 26,          # gap between a name block and the VS row
    "announce_vs_size": 46,
    "announce_vs_rule_w": 64,    # thin rules either side of VS
    "announce_vs_rule_gap": 18,
    "announce_meta_size": 34,    # event line
    "announce_date_size": 28,    # date line
    "announce_meta_gap": 14,
    "announce_meta_lift": 24,    # gap between date line and the badge below it

    # last5 template
    "last5_top_h": 210,          # title band height
    "last5_title_max": 72,
    "last5_title_min": 40,
    "last5_underline_w": 64,
    "last5_underline_h": 6,
    "last5_underline_gap": 16,
    "last5_col_w": 240,          # main-fighter side columns
    "last5_col_tint": 0.30,
    "last5_col_scrim": 0.45,     # inner-edge scrim so the grid pops
    "last5_grid_pad": 40,        # gap between title band and the grid
    "last5_bottom_pad": 48,
    "last5_cell": 140,           # headshot square
    "last5_cell_gap": 90,        # center gap holding the row number
    "last5_label_gap": 10,
    "last5_label_max": 24,
    "last5_label_min": 14,
    "last5_num_size": 30,
    "last5_tile_mark": 0.5,      # mini watermark scale inside an empty headshot tile
    "last5_tile_alpha": 0.15,

    # poll option template
    "vignette_strength": 0.55,
    "vignette_gamma": 1.8,
    "chip_margin": 32,
    "chip_pad_x": 22,
    "chip_pad_y": 12,
    "chip_text_size": 26,
    "chip_alpha": 200,           # chip fill opacity, 0-255
    "chip_dot": 10,              # accent dot diameter
    "chip_dot_gap": 12,
}

# demo placeholder look
DEMO_NOISE_SIGMA = 48
DEMO_NOISE_BLEND = 0.14


# ---- tiny color / font helpers --------------------------------------------
def _rgb(hex_color):
    h = hex_color.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def _mix(c1, c2, t):
    """Blend rgb tuple c1 toward c2 by t (0..1)."""
    return tuple(int(round(a + (b - a) * t)) for a, b in zip(c1, c2))


def font_path(weight):
    return os.path.join(FONT_DIR, "Poppins-%s.ttf" % WEIGHTS.get(weight, "Regular"))


def _font_file(path, size):
    """truetype with a graceful fallback so a missing TTF degrades, not crashes."""
    try:
        return ImageFont.truetype(path, size)
    except Exception:
        try:
            return ImageFont.load_default(size)
        except Exception:
            return ImageFont.load_default()


def _font(weight, size):
    return _font_file(font_path(weight), size)


def _line_h(f):
    return int(round(getattr(f, "size", STYLE["headline_min"]) * STYLE["line_spacing"]))


def _key_background(img):
    """The shipped logo PNGs have a baked-in dark background instead of real
    transparency. Derive alpha from each pixel's distance to the corner color
    so the mark composites cleanly on photos; the glow fades out naturally."""
    from PIL import ImageChops
    rgb = img.convert("RGB")
    bg = Image.new("RGB", img.size, rgb.getpixel((0, 0)))
    dist = ImageChops.difference(rgb, bg).convert("L")
    k = STYLE["logo_key_scale"]
    alpha = dist.point([min(255, int(v * k)) for v in range(256)])
    out = rgb.convert("RGBA")
    out.putalpha(alpha)
    return out


def load_logo(color="purple"):
    """Load a flame-cat brand mark as RGBA, or None if the asset is missing.
    A mark with no real transparency gets its background keyed out."""
    p = os.path.join(BRAND_DIR, LOGO_FILES.get(color, LOGO_FILES["purple"]))
    try:
        img = Image.open(p).convert("RGBA")
    except Exception:
        return None
    hist = img.getchannel("A").histogram()
    if hist[255] == img.width * img.height:      # fully opaque = baked background
        img = _key_background(img)
    return img


def _load_photo(source):
    """Accept a file path OR an in-memory PIL image; None/unreadable -> None."""
    if source is None:
        return None
    if isinstance(source, Image.Image):
        return source.convert("RGB")
    try:
        return Image.open(source).convert("RGB")
    except Exception:
        return None


# ---- core primitives -------------------------------------------------------
def cover_crop(img, w, h):
    """Scale-to-cover then crop, keeping the focal point a touch above center."""
    return ImageOps.fit(img.convert("RGB"), (w, h), method=RESAMPLE,
                        centering=(0.5, STYLE["crop_focus_y"]))


def scrim(img, direction="up", strength=None):
    """Dark gradient overlay. direction = which way the shadow FADES:
    "up" is dark at the bottom fading upward (the headline scrim)."""
    if strength is None:
        strength = STYLE["scrim_strength"]
    grad = Image.linear_gradient("L")            # 0 at top -> 255 at bottom
    if direction == "down":
        grad = ImageOps.flip(grad)
    elif direction == "left":
        grad = grad.rotate(-90)
    elif direction == "right":
        grad = grad.rotate(90)
    g = STYLE["scrim_gamma"]
    lut = [int(255 * ((v / 255.0) ** g) * strength) for v in range(256)]
    mask = grad.point(lut).resize(img.size)
    dark = Image.new("RGB", img.size, _rgb(PALETTE["ink"]))
    return Image.composite(dark, img.convert("RGB"), mask)


def tint(img, hex_color=None, strength=None):
    """Color-grade a photo toward an accent: duotone (ink shadow -> pale accent
    highlight) blended over the original by `strength`."""
    hex_color = hex_color or PALETTE["accent"]
    if strength is None:
        strength = STYLE["tint_strength"]
    gray = ImageOps.autocontrast(ImageOps.grayscale(img))
    shadow = _mix(_rgb(PALETTE["ink"]), _rgb(hex_color), STYLE["tint_black"])
    light = _mix(_rgb(hex_color), _rgb(PALETTE["paper"]), STYLE["tint_white"])
    duo = ImageOps.colorize(gray, black=shadow, white=light)
    return Image.blend(img.convert("RGB"), duo, strength)


def _wrap(draw, text, f, max_w):
    """Greedy word wrap by measured pixel width."""
    lines, cur = [], ""
    for word in text.split():
        cand = (cur + " " + word).strip()
        if cur and draw.textlength(cand, font=f) > max_w:
            lines.append(cur)
            cur = word
        else:
            cur = cand
    if cur:
        lines.append(cur)
    return lines


def fit_text(draw, text, font_file, max_w, max_h, max_lines, size_hi=None, size_lo=None):
    """Auto-sizing uppercase display block. Shrinks from size_hi until the
    wrapped text fits max_w / max_h / max_lines; at the floor it truncates the
    last line with "..." instead. Returns (lines, font). Never exceeds max_lines."""
    size_hi = size_hi or STYLE["headline_max"]
    size_lo = size_lo or STYLE["headline_min"]
    text = " ".join((text or "").upper().split())
    if not text:
        return [], _font_file(font_file, size_lo)
    for size in range(size_hi, size_lo - 1, -4):
        f = _font_file(font_file, size)
        lines = _wrap(draw, text, f, max_w)
        if (lines and len(lines) <= max_lines
                and len(lines) * _line_h(f) <= max_h
                and all(draw.textlength(ln, font=f) <= max_w for ln in lines)):
            return lines, f
    f = _font_file(font_file, size_lo)
    lines = _wrap(draw, text, f, max_w)
    if len(lines) > max_lines:
        lines = lines[:max_lines]
        last = lines[-1]
        while last and draw.textlength(last + "...", font=f) > max_w:
            parts = last.rsplit(" ", 1)
            last = parts[0] if len(parts) > 1 else last[:-1]
        lines[-1] = (last + "...") if last else "..."
    return lines, f


def badge(img, logo, pos):
    """Small brand mark pasted at pos (top-left corner of the badge)."""
    if logo is None:
        return img
    b = logo.resize((STYLE["badge_size"], STYLE["badge_size"]), RESAMPLE)
    img.paste(b, (int(pos[0]), int(pos[1])), b)
    return img


def credit_line(draw, text, xy=None, color=None):
    """Tiny uppercase attribution line (letter-spaced Poppins Medium)."""
    f = _font("medium", STYLE["credit_size"])
    if xy is None:
        try:
            w, h = draw.im.size
        except Exception:
            w, h = STYLE["post_w"], STYLE["post_h"]
        xy = (STYLE["margin"], h - STYLE["margin"] - STYLE["credit_size"])
    fill = color or _rgb(PALETTE["paper_dim"])
    _tracked(draw, xy, (text or "").upper(), f, fill, STYLE["tracking_credit"])
    return xy


def _tracked(draw, xy, text, f, fill, tracking):
    """Draw text with manual letter-spacing. Returns the end x."""
    x, y = xy
    for ch in text:
        draw.text((x, y), ch, font=f, fill=fill)
        x += draw.textlength(ch, font=f) + tracking
    return x


def _tracked_w(draw, text, f, tracking):
    if not text:
        return 0
    return sum(draw.textlength(ch, font=f) for ch in text) + tracking * (len(text) - 1)


def _ink_canvas(w, h):
    """Near-black canvas with a subtle top-lit vertical grade."""
    grad = Image.linear_gradient("L").resize((w, h))
    return ImageOps.colorize(grad, black=_rgb(PALETTE["ink_soft"]),
                             white=_rgb(PALETTE["ink"]))


def _watermark(img, logo):
    """Large very-low-alpha brand mark, centered - the no-photo treatment."""
    if logo is None:
        return img
    side = int(min(img.size) * STYLE["watermark_scale"])
    mark = logo.resize((side, side), RESAMPLE)
    alpha = mark.getchannel("A").point(lambda v: int(v * STYLE["watermark_alpha"]))
    mark.putalpha(alpha)
    img.paste(mark, ((img.width - side) // 2, (img.height - side) // 2), mark)
    return img


def _draw_center(draw, lines, f, cx, y, fill):
    """Draw wrapped lines centered on cx starting at y; returns the y below."""
    for ln in lines:
        w = draw.textlength(ln, font=f)
        draw.text((cx - w / 2, y), ln, font=f, fill=fill)
        y += _line_h(f)
    return y


# ---- templates -------------------------------------------------------------
def render_news(spec):
    """1080x1350 news card: photo, bottom scrim, auto-fit headline, kicker,
    source credit, badge. spec: headline, source, photo_path, kicker (optional)."""
    W, H, m = STYLE["post_w"], STYLE["post_h"], STYLE["margin"]
    logo = load_logo("purple")
    photo = _load_photo(spec.get("photo_path"))
    if photo:
        base = scrim(cover_crop(photo, W, H), "up", STYLE["scrim_strength"])
        base = scrim(base, "down", STYLE["top_scrim_strength"])
    else:
        base = _watermark(_ink_canvas(W, H), logo)
    d = ImageDraw.Draw(base)

    y = H - m
    source = (spec.get("source") or "").strip()
    if source:
        credit_line(d, "VIA " + source, (m, y - STYLE["credit_size"]))
        y -= STYLE["credit_size"] + STYLE["news_credit_gap"]

    lines, f = fit_text(d, spec.get("headline") or "", font_path("extrabold"),
                        W - 2 * m, STYLE["news_block_h"], STYLE["news_lines"])
    y -= len(lines) * _line_h(f)
    yy = y
    for ln in lines:
        d.text((m, yy), ln, font=f, fill=_rgb(PALETTE["paper"]))
        yy += _line_h(f)

    kicker = " ".join((spec.get("kicker") or KICKER_DEFAULT).upper().split())
    kf = _font("semibold", STYLE["kicker_size"])
    ky = y - STYLE["news_kicker_gap"] - STYLE["kicker_size"]
    d.rectangle([m, ky + 2, m + STYLE["kicker_bar_w"], ky + STYLE["kicker_size"]],
                fill=_rgb(PALETTE["accent"]))
    _tracked(d, (m + STYLE["kicker_bar_w"] + STYLE["kicker_bar_pad"], ky),
             kicker, kf, _rgb(PALETTE["accent"]), STYLE["tracking_kicker"])

    badge(base, logo, (W - STYLE["badge_margin"] - STYLE["badge_size"],
                       STYLE["badge_margin"]))
    return base


def _fit_name_pair(draw, a, b, max_w, max_h, max_lines):
    """Fit two fighter names at the SAME size (the smaller of the two fits)."""
    hi, lo = STYLE["announce_name_max"], STYLE["announce_name_min"]
    fp = font_path("black")
    la, fa = fit_text(draw, a, fp, max_w, max_h, max_lines, hi, lo)
    lb, fb = fit_text(draw, b, fp, max_w, max_h, max_lines, hi, lo)
    size = min(fa.size, fb.size)
    if fa.size != size:
        la, fa = fit_text(draw, a, fp, max_w, max_h, max_lines, size, lo)
    if fb.size != size:
        lb, fb = fit_text(draw, b, fp, max_w, max_h, max_lines, size, lo)
    return la, lb, fa


def render_announce(spec):
    """1080x1350 fight announcement: split photos tinted to the accent, center
    NAME / VS / NAME stack, event + date lines, badge bottom-center.
    spec: left_photo, right_photo, left_name, right_name, event_line,
    date_line, accent (optional hex)."""
    W, H = STYLE["post_w"], STYLE["post_h"]
    accent = spec.get("accent") or PALETTE["accent"]
    logo = load_logo("purple")
    half = W // 2

    canvas = Image.new("RGB", (W, H), _rgb(PALETTE["ink"]))
    for x0, key in ((0, "left_photo"), (half, "right_photo")):
        p = _load_photo(spec.get(key))
        if p:
            pane = tint(cover_crop(p, half, H), accent)
        else:
            pane = _watermark(_ink_canvas(half, H), logo)
        canvas.paste(pane, (x0, 0))

    band = Image.new("L", (W, H), 0)
    bd = ImageDraw.Draw(band)
    bw = STYLE["announce_band_w"]
    bd.rectangle([W // 2 - bw // 2, 0, W // 2 + bw // 2, H],
                 fill=STYLE["announce_band_alpha"])
    band = band.filter(ImageFilter.GaussianBlur(STYLE["announce_band_blur"]))
    canvas = Image.composite(Image.new("RGB", (W, H), _rgb(PALETTE["ink"])),
                             canvas, band)
    canvas = scrim(canvas, "up", STYLE["announce_bottom_scrim"])
    d = ImageDraw.Draw(canvas)

    left = spec.get("left_name") or "TBA"
    right = spec.get("right_name") or "TBA"
    la, lb, nf = _fit_name_pair(d, left, right, STYLE["announce_name_w"],
                                H, STYLE["announce_name_lines"])
    gap, vs_h = STYLE["announce_gap"], STYLE["announce_vs_size"]
    total = (len(la) + len(lb)) * _line_h(nf) + vs_h + 2 * gap
    cx, y = W / 2, H * STYLE["announce_center_y"] - total / 2
    y = _draw_center(d, la, nf, cx, y, _rgb(PALETTE["paper"])) + gap

    vf = _font("black", STYLE["announce_vs_size"])
    vw = d.textlength("VS", font=vf)
    d.text((cx - vw / 2, y), "VS", font=vf, fill=_rgb(accent))
    ry = y + vs_h // 2
    rl, rg = STYLE["announce_vs_rule_w"], STYLE["announce_vs_rule_gap"]
    d.rectangle([cx - vw / 2 - rg - rl, ry - 1, cx - vw / 2 - rg, ry + 1],
                fill=_rgb(PALETTE["paper_dim"]))
    d.rectangle([cx + vw / 2 + rg, ry - 1, cx + vw / 2 + rg + rl, ry + 1],
                fill=_rgb(PALETTE["paper_dim"]))
    _draw_center(d, lb, nf, cx, y + vs_h + gap, _rgb(PALETTE["paper"]))

    badge_top = H - STYLE["badge_margin"] - STYLE["badge_size"]
    date_line = " ".join((spec.get("date_line") or "").upper().split())
    event_line = " ".join((spec.get("event_line") or "").upper().split())
    y = badge_top - STYLE["announce_meta_lift"]
    if date_line:
        df = _font("medium", STYLE["announce_date_size"])
        y -= STYLE["announce_date_size"] + STYLE["announce_meta_gap"]
        _tracked(d, (cx - _tracked_w(d, date_line, df, STYLE["tracking_meta"]) / 2, y),
                 date_line, df, _rgb(PALETTE["paper_dim"]), STYLE["tracking_meta"])
    if event_line:
        ef = _font("semibold", STYLE["announce_meta_size"])
        y -= STYLE["announce_meta_size"] + STYLE["announce_meta_gap"]
        _tracked(d, (cx - _tracked_w(d, event_line, ef, STYLE["tracking_meta"]) / 2, y),
                 event_line, ef, _rgb(PALETTE["paper"]), STYLE["tracking_meta"])

    badge(canvas, logo, (W // 2 - STYLE["badge_size"] // 2, badge_top))
    return canvas


def _headshot_tile(source, cell, logo):
    """Grayscale square headshot; missing photo -> soft ink tile + mini mark."""
    p = _load_photo(source)
    if p:
        g = ImageOps.autocontrast(ImageOps.grayscale(cover_crop(p, cell, cell)))
        return g.convert("RGB")
    tile = Image.new("RGB", (cell, cell), _rgb(PALETTE["ink_soft"]))
    if logo is not None:
        side = int(cell * STYLE["last5_tile_mark"])
        mark = logo.resize((side, side), RESAMPLE)
        alpha = mark.getchannel("A").point(lambda v: int(v * STYLE["last5_tile_alpha"]))
        mark.putalpha(alpha)
        tile.paste(mark, ((cell - side) // 2, (cell - side) // 2), mark)
    return tile


def render_last5(spec):
    """1080x1350 comparison: main fighters as tall side columns facing in,
    a 2x5 grayscale headshot grid with names in the middle, title on top.
    spec: left_photo, right_photo, rows (list of up to 5 dicts with
    left_name, left_photo, right_name, right_photo), title (optional)."""
    W, H, m = STYLE["post_w"], STYLE["post_h"], STYLE["margin"]
    logo = load_logo("purple")
    canvas = _ink_canvas(W, H)
    d = ImageDraw.Draw(canvas)

    top_h = STYLE["last5_top_h"]
    title = spec.get("title") or LAST5_TITLE_DEFAULT
    tl, tf = fit_text(d, title, font_path("black"), W - 2 * m, top_h, 1,
                      STYLE["last5_title_max"], STYLE["last5_title_min"])
    ty = (top_h - len(tl) * _line_h(tf)) / 2
    _draw_center(d, tl, tf, W / 2, ty, _rgb(PALETTE["paper"]))
    uw, uh = STYLE["last5_underline_w"], STYLE["last5_underline_h"]
    uy = ty + len(tl) * _line_h(tf) + STYLE["last5_underline_gap"]
    d.rectangle([W / 2 - uw / 2, uy, W / 2 + uw / 2, uy + uh],
                fill=_rgb(PALETTE["accent"]))

    col_w, col_h = STYLE["last5_col_w"], H - top_h
    for x0, key, inner in ((0, "left_photo", "right"),
                           (W - STYLE["last5_col_w"], "right_photo", "left")):
        p = _load_photo(spec.get(key))
        if p:
            col = cover_crop(p, col_w, col_h)
            if key == "right_photo":
                col = ImageOps.mirror(col)       # face inward
            col = tint(col, PALETTE["accent"], STYLE["last5_col_tint"])
            col = scrim(col, inner, STYLE["last5_col_scrim"])
        else:
            col = _watermark(_ink_canvas(col_w, col_h), logo)
        canvas.paste(col, (x0, top_h))
    d = ImageDraw.Draw(canvas)

    rows = (spec.get("rows") or [])[:5]
    cell, cgap = STYLE["last5_cell"], STYLE["last5_cell_gap"]
    grid_top = top_h + STYLE["last5_grid_pad"]
    grid_h = H - grid_top - STYLE["last5_bottom_pad"]
    row_block = grid_h / 5.0
    lx = W / 2 - cgap / 2 - cell
    rx = W / 2 + cgap / 2
    nf = _font("black", STYLE["last5_num_size"])
    for i in range(5):
        row = rows[i] if i < len(rows) else {}
        ry = int(grid_top + i * row_block)
        for x0, pk, nk in ((lx, "left_photo", "left_name"),
                           (rx, "right_photo", "right_name")):
            canvas.paste(_headshot_tile(row.get(pk), cell, logo), (int(x0), ry))
            name = row.get(nk) or "TBA"
            nl, lf = fit_text(d, name, font_path("semibold"), cell + 36,
                              STYLE["last5_label_max"] * 2, 1,
                              STYLE["last5_label_max"], STYLE["last5_label_min"])
            _draw_center(d, nl, lf, x0 + cell / 2,
                         ry + cell + STYLE["last5_label_gap"],
                         _rgb(PALETTE["paper_dim"]))
        num = str(i + 1)
        nw = d.textlength(num, font=nf)
        d.text((W / 2 - nw / 2, ry + cell / 2 - STYLE["last5_num_size"] / 2),
               num, font=nf, fill=_rgb(PALETTE["accent"]))
    return canvas


def render_poll_option(spec):
    """640x640 poll option tile: cover-cropped photo, subtle vignette and an
    optional small label chip. spec: photo_path, label (optional)."""
    W, H = STYLE["poll_w"], STYLE["poll_h"]
    logo = load_logo("purple")
    photo = _load_photo(spec.get("photo_path"))
    if photo:
        base = cover_crop(photo, W, H)
    else:
        base = _watermark(_ink_canvas(W, H), logo)

    grad = Image.radial_gradient("L")            # 0 center -> 255 at the edge
    g, s = STYLE["vignette_gamma"], STYLE["vignette_strength"]
    lut = [int(255 * ((v / 255.0) ** g) * s) for v in range(256)]
    mask = grad.point(lut).resize((W, H))
    base = Image.composite(Image.new("RGB", (W, H), _rgb(PALETTE["ink"])),
                           base, mask)

    label = " ".join((spec.get("label") or "").upper().split())
    if label:
        over = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        od = ImageDraw.Draw(over)
        cf = _font("semibold", STYLE["chip_text_size"])
        tw = od.textlength(label, font=cf)
        px, py = STYLE["chip_pad_x"], STYLE["chip_pad_y"]
        dot, dgap = STYLE["chip_dot"], STYLE["chip_dot_gap"]
        ch = STYLE["chip_text_size"] + 2 * py
        cw = tw + 2 * px + dot + dgap
        x0 = STYLE["chip_margin"]
        y0 = H - STYLE["chip_margin"] - ch
        od.rounded_rectangle([x0, y0, x0 + cw, y0 + ch], radius=ch / 2,
                             fill=_rgb(PALETTE["ink"]) + (STYLE["chip_alpha"],))
        dy = y0 + ch / 2 - dot / 2
        od.ellipse([x0 + px, dy, x0 + px + dot, dy + dot],
                   fill=_rgb(PALETTE["accent"]) + (255,))
        od.text((x0 + px + dot + dgap, y0 + py - 2), label, font=cf,
                fill=_rgb(PALETTE["paper"]) + (255,))
        base = Image.alpha_composite(base.convert("RGBA"), over).convert("RGB")
    return base


TEMPLATES = {
    "news": render_news,
    "announce": render_announce,
    "last5": render_last5,
    "poll_option": render_poll_option,
}


def render(kind, spec):
    """Dispatch to a template renderer. Returns a PIL Image."""
    fn = TEMPLATES.get(kind)
    if fn is None:
        raise ValueError("unknown template kind: %s" % kind)
    return fn(spec or {})


# ---- demo ------------------------------------------------------------------
def _placeholder(w, h, c1, c2, angle=0.0):
    """Synthetic stand-in photo: rotated gradient plus gaussian noise."""
    grad = Image.linear_gradient("L")
    if angle:
        grad = grad.rotate(angle, resample=Image.Resampling.BILINEAR)
    img = ImageOps.colorize(grad.resize((w, h)), black=c1, white=c2)
    noise = Image.effect_noise((w, h), DEMO_NOISE_SIGMA).convert("RGB")
    return Image.blend(img, noise, DEMO_NOISE_BLEND)


def demo(out_dir=None):
    """Render one of each template with placeholder photos; print the paths."""
    out = out_dir or DEMO_DIR
    os.makedirs(out, exist_ok=True)
    left = _placeholder(900, 1200, (36, 24, 72), (124, 92, 255), 18)
    right = _placeholder(900, 1200, (14, 40, 30), (42, 200, 130), -18)
    wide = _placeholder(1400, 1000, (28, 20, 52), (150, 120, 255), 90)
    heads_l = [_placeholder(300, 300, (30, 26, 44), (150 + 18 * i, 130, 230), 30 * i)
               for i in range(5)]
    heads_r = [_placeholder(300, 300, (24, 34, 30), (90, 170 + 14 * i, 130), -30 * i)
               for i in range(5)]
    l_names = ["ADESANYA", "PROCHAZKA", "HILL", "BLACHOWICZ", "TEIXEIRA"]
    r_names = ["RAKIC", "WALKER", "SMITH", "SANTOS", "CUTELABA"]
    rows = [{"left_name": l_names[i], "left_photo": heads_l[i],
             "right_name": r_names[i], "right_photo": heads_r[i]}
            for i in range(5)]

    jobs = [
        ("news", "news", {
            "headline": "Makhachev defends the lightweight title in a five round classic",
            "source": "MMA Fighting", "photo_path": wide}),
        ("news_dark", "news", {
            "headline": "Champion out injured, the interim belt is on the line",
            "source": "Bloody Elbow", "kicker": "IBOYPRIME BREAKING"}),
        ("announce", "announce", {
            "left_photo": left, "right_photo": right,
            "left_name": "PEREIRA", "right_name": "ANKALAEV",
            "event_line": "UFC 320 LAS VEGAS", "date_line": "SAT OCT 04"}),
        ("last5", "last5", {
            "left_photo": left, "right_photo": right, "rows": rows}),
        ("poll_option", "poll_option", {
            "photo_path": left, "label": "PEREIRA"}),
    ]
    for name, kind, spec in jobs:
        img = render(kind, spec)
        path = os.path.join(out, name + ".png")
        img.save(path)
        print("wrote: %s (%d bytes)" % (path, os.path.getsize(path)))


def main(argv):
    if "--demo" in argv:
        out = None
        if "--out" in argv:
            i = argv.index("--out")
            if i + 1 < len(argv):
                out = argv[i + 1]
        demo(out)
        return 0
    print("usage: python postcard.py --demo [--out DIR]")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
