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
import itertools, os, sys

try:
    from PIL import (Image, ImageChops, ImageDraw, ImageEnhance, ImageFilter,
                     ImageFont, ImageOps)
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
    "accent_deep": "#5B3DF5",   # darker sibling for glows / gradient bottoms
    "accent_soft": "#C9BBFF",   # pale lavender for meta type on dark purple fields
    "rim":         "#E4CFFF",   # bright lavender rim light on fighter cutouts
    "ink":         "#0B0B0E",   # near-black canvas
    "ink_soft":    "#17141F",   # slightly purple-warmed black for gradients / tiles
    "paper":       "#F5F4F6",   # headline white
    "paper_dim":   "#B9B5C4",   # secondary text on dark
    "chrome_hi":   "#FFFFFF",   # display-type gradient top
    "chrome_lo":   "#D8D4E4",   # display-type gradient bottom (bright: no silvering)
    # the HOT family - scene lighting only, never the brand lockup. Round 5
    # art direction: references win on aggressive red/orange cage light, so
    # scenes may burn hot while purple stays the brand accent (lockup, kicker
    # chips, small accents).
    "fire":        "#FF8A3D",   # hot orange - emblem tops, meta lines
    "fire_deep":   "#C9391B",   # ember red - glows, emblem bottoms
    "fire_soft":   "#FFC78F",   # pale amber - rim light, VERSUS, city lines
    "ember":       "#5A140C",   # near-black red for deep scene pools
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

LAST5_TITLE_DEFAULT = "LAST 5 OPPONENTS"
BRAND_WORD = "IBOYPRIME"

# Every magic number lives here so a critic pass can retune without code edits.
STYLE = {
    # canvases
    "post_w": 1080, "post_h": 1350,
    "poll_w": 640,  "poll_h": 640,
    "margin": 72,

    # type
    "line_spacing": 1.06,        # line height as a multiple of font size (body)
    "display_spacing": 0.93,     # line height multiple for huge uppercase blocks
    "display_track": 0.030,      # NEGATIVE tracking on display type, fraction of size
    "word_space_mult": 1.28,     # word-gap multiplier: a hair wider than the glyph
                                 # gaps - 2.0 read as GAPPY at feed size (round 3)
    "display_squeeze": 0.90,     # fake-condense on display blocks: Poppins has no
                                 # condensed cut, and condensed density is the pro look
    "headline_max": 150,         # fit_text auto-size ceiling
    "headline_min": 48,          # fit_text auto-size floor
    "credit_size": 25,
    "tracking_tag": 5,           # extra px between context-chip glyphs
    "tracking_credit": 5,
    "tracking_meta": 6,

    # photo treatment
    "crop_focus_y": 0.30,        # cover-crop focal point: bias toward the TOP of the
                                 # source - the bottom third dies under the ink plate
                                 # anyway, and 0.38 amputated raised fists (round 3)
    "scrim_strength": 0.92,      # bottom scrim under headlines
    "scrim_gamma": 1.6,          # scrim falloff curve (higher = tighter to the edge)
    "top_scrim_strength": 0.24,  # light top scrim keeps the frame's lid on
    "tint_strength": 0.55,       # duotone grade amount in tint()
    "tint_black": 0.14,          # shadow end: ink mixed this far toward the accent
    "tint_white": 0.90,          # highlight end: accent mixed this far toward paper
    "photo_contrast": 1.06,      # cinematic grade on news photos
    "photo_color": 0.90,

    # fighter-cutout integration (announce + last5 sides)
    "logo_key_thresh": 26,       # background keying: ignore small color distances
    "cutout_ambient": 0.24,      # accent ambient grade blended into cutouts
    "rim_width": 7,              # rim-light band width in canvas px
    "rim_strength": 0.85,        # rim-light opacity

    # texture
    "grain": 0.028,              # film grain blend over finished canvases - 0.045
                                 # hazed the blacks and read as low contrast
    "grain_sigma": 34,

    # brand marks
    "badge_size": 104,
    "badge_margin": 44,
    "watermark_scale": 0.62,     # watermark logo side vs the short canvas edge
    "watermark_alpha": 0.06,
    "logo_key_scale": 3.5,       # background keying: alpha = distance-from-bg * scale
    "lockup_word_size": 20,      # IBOYPRIME wordmark under the logo
    "lockup_word_track": 7,
    "lockup_word_gap": 10,
    "footer_bar_h": 10,          # accent signature bar on the bottom edge

    # news template - short centered poster line on a crushed-to-dark photo
    "news_block_h": 520,         # vertical budget for the line block
    "news_lines": 3,             # poster lines live at 2-3 centered lines
    "news_line_max": 175,        # line auto-size ceiling - it must DOMINATE
    "news_line_min": 64,         # line auto-size floor
    "news_credit_gap": 30,       # gap between the line block and what follows
    "news_plate_ramp": 300,      # px over which the photo melts into the ink
    "news_plate_pad": 36,        # solid ink starts this far above the line
    "news_vignette": 0.22,
    "news_zoom": 1.32,           # post-crop punch-in: kills sponsor boards,
                                 # crowd and bystanders, doubles the face
    "news_zoom_cy": 0.30,        # zoom window center as a fraction of H
    "news_grade": 0.12,          # accent duotone strength - cinematic grade
    "news_side_scrim": 0.22,     # left/right darkening - buries edge clutter
    "news_speaker_size": 34,     # speaker attribution over the VIA line
    "news_speaker_gap": 30,
    "news_quote_size": 40,       # quote marks inside the seam chip
    "news_quote_gap": 40,        # ink gap between the seam chip and the line
    "news_chip_pad_x": 26,       # quote chip padding around the glyph pair
    "news_chip_pad_y": 15,
    "news_hot_words": 3,         # accent-colored words allowed in the line
    "news_tag_size": 26,         # tiny centered context chip (explicit kicker)
    "news_tag_pad_x": 22,
    "news_tag_pad_y": 12,
    "news_tag_gap": 34,
    "news_inset_side": 300,      # inset speaker portrait square side
    "news_inset_border": 7,      # thin white border width around the inset
    "news_inset_radius": 14,     # corner radius on the inset border
    "news_inset_gap": 30,        # air between the inset and the element below
    "news_nophoto_lift": 0.16,   # photoless: block rises off the bottom edge

    # announce template
    "announce_name_w": 980,
    "announce_name_max": 146,
    "announce_name_min": 54,
    "announce_stack_y": 0.525,   # top of the name stack as a fraction of H
    "announce_vs_size": 28,
    "announce_vs_track": 12,
    "announce_vs_gap": 24,       # EQUAL visual air above and below VERSUS,
                                 # measured cap-edge to cap-edge (round 4 fix)
    "announce_meta_size": 29,    # weight-class line
    "announce_date_size": 58,
    "announce_city_size": 25,
    "announce_fighter_h": 0.70,  # fallback cutout height vs H (no head metrics)
    "announce_fighter_top": 0.10,
    "announce_fighter_cx": (0.27, 0.73),
    "announce_head_h": 0.215,    # target head HEIGHT (crown to neck) vs H.
                                 # Round 5: width-normalising rendered a wide
                                 # bearded head 25% smaller than a narrow one -
                                 # perceived size tracks crown-to-chin, so the
                                 # shared scale target is HEIGHT now
    "announce_eye_y": 0.265,     # shared eye line - heads start under the wordmark
    "announce_eye_frac": 0.44,   # eyes sit this far down the crown-to-neck span
    "announce_crown": 0.32,      # crop margin above the head top, in head heights
    "announce_torso": 2.75,      # crop depth below the head top (waist-up)
    "announce_scale_max": 3.2,   # upscale ceiling so a tiny source cannot mush
    "announce_band_strength": 0.58,  # dark band scrim behind the name stack
    "announce_mark_side": 700,   # glossy flame emblem behind the fighters -
                                 # sized so its EDGES stay visible in the gap
                                 # between the heads; bigger runs off-canvas
                                 # and reads as a shapeless orange wash
    "announce_mark_alpha": 0.88,
    "announce_mark_cy": 0.30,    # emblem center height - crown peeks between heads
    "announce_glow_r": 900,
    "announce_bottom_scrim": 0.94,
    "italic_shear": 0.22,        # fake-italic shear for VERSUS / weight class

    # last5 template
    "last5_title_max": 190,      # big "LAST 5" display line
    "last5_title_min": 72,
    "last5_title_w": 540,        # title width budget between the side fighters
    "last5_tail_size": 52,       # the solid stacked word under the big line
    "last5_tail_track": 8,
    "last5_underline_w": 140,
    "last5_underline_h": 8,
    "last5_underline_gap": 18,
    "last5_col_w": 340,          # main-fighter side sliver width
    "last5_col_top": 88,         # side fighters start here, flanking the title
    "last5_col_fade": 70,        # inner-edge alpha fade on the side fighters
    "last5_head_h": 0.245,       # hero head height (crown to neck) vs H - the
                                 # faceoff must read at 30 percent zoom
    "last5_eye_y": 0.150,        # hero eye line vs H - faces flank the title
    "last5_grid_pad": 28,        # gap between title band and the grid
    "last5_bottom_pad": 66,
    "last5_plate_h": 140,        # row plate height = headshot square side
    "last5_plate_margin": 56,    # plate outer edge inset from the canvas edge
    "last5_center_gap": 12,      # gutter between the two plates
    "last5_plate_radius": 16,
    "last5_head_zoom": 2.05,     # head-crop square side vs the detected face width
    "last5_name_max": 46,        # name size ceiling - ONE size serves all ten
    "last5_name_min": 22,
    "last5_name_squeeze": 0.80,  # fake-condense factor, uniform across the grid:
                                 # condensing buys the width the long names need,
                                 # per-name auto-shrink broke the grid rhythm
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
    so the mark composites cleanly on photos. Distances under the threshold are
    dropped entirely - without that, the background's own soft gradient keeps
    partial alpha and the mark ships inside a visible ghost rectangle."""
    rgb = img.convert("RGB")
    bg = Image.new("RGB", img.size, rgb.getpixel((0, 0)))
    dist = ImageChops.difference(rgb, bg).convert("L")
    k, thr = STYLE["logo_key_scale"], STYLE["logo_key_thresh"]
    alpha = dist.point([min(255, max(0, int((v - thr) * k))) for v in range(256)])
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


def _load_cutout(source):
    """Like _load_photo but keeps REAL transparency; returns None when the
    source has no meaningful alpha (then callers fall back to pane crops)."""
    if source is None:
        return None
    try:
        img = source if isinstance(source, Image.Image) else Image.open(source)
        img = img.convert("RGBA")
    except Exception:
        return None
    lo, _hi = img.getchannel("A").getextrema()
    if lo >= 250:                                # effectively opaque everywhere
        return None
    return img


# ---- core primitives -------------------------------------------------------
def cover_crop(img, w, h):
    """Scale-to-cover then crop, keeping the focal point a touch above center."""
    return ImageOps.fit(img.convert("RGB"), (w, h), method=RESAMPLE,
                        centering=(0.5, STYLE["crop_focus_y"]))


def scrim(img, direction="up", strength=None, gamma=None):
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
    g = STYLE["scrim_gamma"] if gamma is None else gamma
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


def _wrap(draw, text, f, max_w, tracking=0):
    """Greedy word wrap by the width the text will actually be DRAWN at
    (tracked glyphs + widened word gaps), not the naive textlength."""
    lines, cur = [], ""
    for word in text.split():
        cand = (cur + " " + word).strip()
        if cur and _tracked_w(draw, cand, f, tracking) > max_w:
            lines.append(cur)
            cur = word
        else:
            cur = cand
    if cur:
        lines.append(cur)
    return lines


def _rag_ok(draw, lines, f, max_w, tracking=0):
    """A display block reads amateur when one wrapped line is a stub (the lone
    "TO" line). Accept a fit only when every line carries real width."""
    if len(lines) < 2:
        return True
    return all(_tracked_w(draw, ln, f, tracking) >= max_w * 0.30 for ln in lines)


def _balance_lines(draw, words, f, k, max_w, tracking):
    """Repartition words into exactly k lines with near-equal drawn widths
    (least squared deviation), every line still fitting max_w. Greedy wrapping
    front-loads words and strands a half-measure line mid-block - the amateur
    rag on huge display type. Returns None when nothing valid beats greedy."""
    n = len(words)
    if k < 2 or n <= k or n > 24:
        return None
    best, best_cost = None, None
    for cuts in itertools.combinations(range(1, n), k - 1):
        idx = (0,) + cuts + (n,)
        ws = [_tracked_w(draw, " ".join(words[idx[t]:idx[t + 1]]), f, tracking)
              for t in range(k)]
        if max(ws) > max_w:
            continue
        mean = sum(ws) / k
        cost = sum((w - mean) ** 2 for w in ws)
        if best_cost is None or cost < best_cost:
            best, best_cost = idx, cost
    if best is None:
        return None
    return [" ".join(words[best[t]:best[t + 1]]) for t in range(k)]


def fit_text(draw, text, font_file, max_w, max_h, max_lines, size_hi=None,
             size_lo=None, track_frac=0.0):
    """Auto-sizing uppercase display block. Shrinks from size_hi until the
    wrapped text fits max_w / max_h / max_lines (preferring a size with no
    stub lines); at the floor it truncates the last line with "..." instead.
    Measures with the same tracked metric the display renderer draws with, so
    a fitted line can never overflow. Returns (lines, font)."""
    size_hi = size_hi or STYLE["headline_max"]
    size_lo = size_lo or STYLE["headline_min"]
    text = " ".join((text or "").upper().split())
    if not text:
        return [], _font_file(font_file, size_lo)
    first_fit = None
    for size in range(size_hi, size_lo - 1, -4):
        f = _font_file(font_file, size)
        tr = -int(round(size * track_frac))
        lines = _wrap(draw, text, f, max_w, tr)
        if (lines and len(lines) <= max_lines
                and len(lines) * _line_h(f) <= max_h
                and all(_tracked_w(draw, ln, f, tr) <= max_w for ln in lines)):
            bal = _balance_lines(draw, text.split(), f, len(lines), max_w, tr)
            if bal:
                lines = bal
            if _rag_ok(draw, lines, f, max_w, tr):
                return lines, f
            if first_fit is None:
                first_fit = (lines, f)
    if first_fit is not None:
        return first_fit
    f = _font_file(font_file, size_lo)
    tr = -int(round(size_lo * track_frac))
    lines = _wrap(draw, text, f, max_w, tr)
    if len(lines) > max_lines:
        lines = lines[:max_lines]
        last = lines[-1]
        while last and _tracked_w(draw, last + "...", f, tr) > max_w:
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


def _adv(draw, ch, f, tracking):
    """Advance for one glyph: tracked, with word gaps kept WIDE. Negative
    display tracking must never eat the spaces - crushed glyphs with roomy
    word gaps is the pro look; fused words at phone size is the amateur one."""
    w = draw.textlength(ch, font=f)
    if ch == " ":
        return w * STYLE["word_space_mult"]
    return w + tracking


def _tracked(draw, xy, text, f, fill, tracking):
    """Draw text with manual letter-spacing (may be negative). Returns end x."""
    x, y = xy
    for ch in text:
        draw.text((x, y), ch, font=f, fill=fill)
        x += _adv(draw, ch, f, tracking)
    return x


def _tracked_w(draw, text, f, tracking):
    if not text:
        return 0
    return (sum(_adv(draw, ch, f, tracking) for ch in text) - tracking)


def _fit_tracked(draw, text, weight, max_w, size_hi, size_lo, track_frac):
    """Largest single-line size whose negative-tracked width fits max_w.
    Returns (font, tracking)."""
    text = " ".join((text or "").upper().split())
    if not text:
        f = _font(weight, size_lo)
        return f, -int(round(size_lo * track_frac))
    for size in range(size_hi, size_lo - 1, -2):
        f = _font(weight, size)
        tr = -int(round(size * track_frac))
        if _tracked_w(draw, text, f, tr) <= max_w:
            return f, tr
    f = _font(weight, size_lo)
    return f, -int(round(size_lo * track_frac))


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


# ---- craft primitives (texture, glow, shadowed display type) ---------------
def _grain(img, strength=None):
    """Subtle film grain so large dark fields read as texture, not flat fill."""
    s = STYLE["grain"] if strength is None else strength
    if s <= 0:
        return img
    noise = Image.effect_noise(img.size, STYLE["grain_sigma"]).convert("RGB")
    return Image.blend(img.convert("RGB"), noise, s)


def _vignette(img, strength=0.32, gamma=2.2):
    """Corner darkening that pushes the eye to the center."""
    grad = Image.radial_gradient("L").resize(img.size)
    lut = [int(255 * ((v / 255.0) ** gamma) * strength) for v in range(256)]
    mask = grad.point(lut)
    dark = Image.new("RGB", img.size, _rgb(PALETTE["ink"]))
    return Image.composite(dark, img.convert("RGB"), mask)


def _glow(img, center, radius, hex_color, strength):
    """Soft additive light pool (screen blend) - cheap studio lighting.
    The falloff reaches ZERO at the inscribed circle, not at the gradient's
    corners - otherwise the pasted square leaves a visible rectangular seam
    on a near-black field."""
    radius = max(2, int(radius))
    grad = Image.radial_gradient("L").resize((radius * 2, radius * 2))
    # radial_gradient hits 255 at the CORNERS; d/radius = (v/255)*sqrt(2)
    lut = [int(255 * (max(0.0, 1.0 - (v / 255.0) * 1.41421356) ** 1.8) * strength)
           for v in range(256)]
    a = grad.point(lut)
    layer = Image.new("RGB", img.size, (0, 0, 0))
    layer.paste(Image.new("RGB", a.size, _rgb(hex_color)),
                (int(center[0] - radius), int(center[1] - radius)), a)
    return ImageChops.screen(img.convert("RGB"), layer)


def _ghost_mark(img, logo, center, side, alpha=None, colors=None, halo=0.0):
    """Huge gradient silhouette of the flame mark - the poster monogram.
    colors = (top_hex, bottom_hex) fills the silhouette; halo > 0 screens a
    blurred hot copy behind it so the emblem reads glossy-lit, not flat."""
    if logo is None:
        return img
    side = int(side)
    alpha = STYLE["announce_mark_alpha"] if alpha is None else alpha
    colors = colors or (PALETTE["accent"], PALETTE["accent_deep"])
    a = logo.getchannel("A").resize((side, side), RESAMPLE)
    x0 = int(center[0] - side / 2)
    y0 = int(center[1] - side / 2)
    out = img.convert("RGB")
    if halo > 0:
        glow_a = a.filter(ImageFilter.GaussianBlur(side * 0.045))
        glow_a = glow_a.point(lambda v: int(v * halo))
        lay = Image.new("RGB", out.size, (0, 0, 0))
        lay.paste(Image.new("RGB", (side, side), _rgb(PALETTE["fire_deep"])),
                  (x0, y0), glow_a)
        out = ImageChops.screen(out, lay)
    base = out.convert("RGBA")
    if halo > 0:
        # dropped shadow under the silhouette: the emblem's edge SEPARATES
        # from its own halo instead of dissolving into the wash
        sh_a = a.filter(ImageFilter.GaussianBlur(side * 0.012))
        sh_a = sh_a.point(lambda v: int(v * 0.55))
        shadow = Image.new("RGBA", (side, side), (0, 0, 0, 0))
        shadow.paste((5, 2, 1, 255), (0, 0), sh_a)
        base.alpha_composite(shadow, (x0 + int(side * 0.012),
                                      y0 + int(side * 0.022)))
    grad = Image.linear_gradient("L").resize((side, side))
    fill = ImageOps.colorize(grad, black=_rgb(colors[0]), white=_rgb(colors[1]))
    mark = fill.convert("RGBA")
    mark.putalpha(a.point(lambda v: int(v * alpha)))
    base.alpha_composite(mark, (x0, y0))
    if halo > 0:
        # bright rim along the silhouette edge - the glossy-emblem read that
        # keeps the mark a designed SHAPE at 30 percent zoom
        rim = ImageChops.subtract(a, a.filter(ImageFilter.MinFilter(5)))
        rim = rim.filter(ImageFilter.GaussianBlur(1.2))
        rim = rim.point(lambda v: int(min(255, v * 1.5) * 0.75))
        lay = Image.new("RGB", base.size, (0, 0, 0))
        lay.paste(Image.new("RGB", (side, side), _rgb("#FFD9A0")), (x0, y0), rim)
        base = ImageChops.screen(base.convert("RGB"), lay).convert("RGBA")
    return base.convert("RGB")


def _enhance_photo(img):
    """Light cinematic grade for news photos: a hair more contrast, less color."""
    img = ImageEnhance.Contrast(img.convert("RGB")).enhance(STYLE["photo_contrast"])
    return ImageEnhance.Color(img).enhance(STYLE["photo_color"])


def _clean_edges(rgba):
    """Erode the cutout alpha one pixel and soften it - kills the pale fringe
    halo that betrays a pasted PNG on a dark field."""
    a = rgba.getchannel("A").filter(ImageFilter.MinFilter(3))
    a = a.filter(ImageFilter.GaussianBlur(0.6))
    out = rgba.copy()
    out.putalpha(a)
    return out


def _grade_cutout(img, ambient=None, ambient_color=None, sat=0.90,
                  contrast=1.10, brightness=1.0):
    """Sit a fighter cutout INTO the scene instead of on top of it: cleaned
    edges, a contrast pass and an ambient grade toward the scene light.
    Round 5: the old 0.93-brightness 0.82-sat defaults crushed the faces into
    the dark field and the matchup went illegible at phone size - cutouts now
    stay BRIGHT and the scene glow is what marries them to the background."""
    img = _clean_edges(img.convert("RGBA"))
    rgb = ImageEnhance.Color(img.convert("RGB")).enhance(sat)
    rgb = ImageEnhance.Contrast(rgb).enhance(contrast)
    rgb = ImageEnhance.Brightness(rgb).enhance(brightness)
    amb = STYLE["cutout_ambient"] if ambient is None else ambient
    if amb > 0:
        rgb = Image.blend(rgb, tint(rgb, ambient_color or PALETTE["fire"], 1.0), amb)
    out = rgb.convert("RGBA")
    out.putalpha(img.getchannel("A"))
    return out


def _sharpen(rgba, percent=110):
    """Unsharp pass AFTER an upscale - a resampled promo cutout goes soft
    exactly where recognition lives (eyes, beard edges). Alpha is preserved
    untouched so the silhouette edge stays clean."""
    if percent <= 0:
        return rgba
    a = rgba.getchannel("A") if rgba.mode == "RGBA" else None
    rgb = rgba.convert("RGB").filter(
        ImageFilter.UnsharpMask(radius=2.2, percent=int(percent), threshold=2))
    out = rgb.convert("RGBA")
    out.putalpha(a if a is not None else Image.new("L", rgba.size, 255))
    return out


def _shift_mask(a, dx, dy):
    """Shift an L mask by (dx, dy) filling the vacated area with 0 (no wrap)."""
    out = Image.new("L", a.size, 0)
    out.paste(a, (int(dx), int(dy)))
    return out


def _rim_light(cut, dx, dy, color=None, strength=None):
    """Paint a colored rim along the lit edge of a cutout: shift the alpha by
    (dx, dy) and keep the sliver left uncovered. dx=-w rims the RIGHT edge,
    dx=+w the LEFT, dy=+w the TOP. The one move that makes a flat studio
    cutout read as lit by the scene behind it."""
    color = _rgb(color or PALETTE["rim"])
    s = STYLE["rim_strength"] if strength is None else strength
    a = cut.getchannel("A")
    rim = ImageChops.subtract(a, _shift_mask(a, dx, dy))
    rim = rim.filter(ImageFilter.GaussianBlur(1.6))
    rim = rim.point(lambda v: int(min(255, v * 1.7) * s))
    rim = ImageChops.multiply(rim, a)        # stay inside the silhouette
    lay = Image.new("RGBA", cut.size, color + (0,))
    lay.putalpha(rim)
    out = cut.copy()
    out.alpha_composite(lay)
    return out


def _crush_bottom(img, solid_y, ramp, strength=1.0):
    """Melt the photo into solid ink from `solid_y` down, ramping over `ramp`
    px above it - the crushed plate that keeps display type legible at 30%."""
    W, H = img.size
    col = Image.new("L", (1, H), 0)
    px = col.load()
    r = max(1, int(ramp))
    for y in range(H):
        if y >= solid_y:
            t = 1.0
        elif y >= solid_y - r:
            t = ((y - (solid_y - r)) / r) ** 1.5
        else:
            t = 0.0
        px[0, y] = int(255 * t * strength)
    mask = col.resize((W, H))
    dark = Image.new("RGB", (W, H), _rgb(PALETTE["ink"]))
    return Image.composite(dark, img.convert("RGB"), mask)


def _fade_alpha(rgba, axis="bottom", start=0.82, end=0.0, span=None):
    """Multiply a linear falloff into the alpha so a cutout melts into the
    background. axis bottom = fade the lower part; left/right = fade that edge
    across `span` pixels."""
    w, h = rgba.size
    if axis == "bottom":
        ramp = Image.new("L", (1, h), 255)
        px = ramp.load()
        y0 = int(h * start)
        for y in range(y0, h):
            t = (y - y0) / max(1, h - 1 - y0)
            px[0, y] = int(255 * (1 - t * (1 - end)))
        fade = ramp.resize((w, h))
    else:
        span = span or int(w * 0.3)
        ramp = Image.new("L", (w, 1), 255)
        px = ramp.load()
        for x in range(span):
            v = int(255 * (x / max(1, span - 1)))
            if axis == "left":
                px[x, 0] = v
            else:
                px[w - 1 - x, 0] = v
        fade = ramp.resize((w, h))
    out = rgba.copy()
    out.putalpha(ImageChops.multiply(rgba.getchannel("A"), fade))
    return out


def _band_scrim(img, y0, y1, strength=0.55, feather=120):
    """Localized horizontal dark band with soft edges - the scrim that keeps a
    white name stack legible where it crosses bright skin, without crushing
    the whole frame."""
    W, H = img.size
    col = Image.new("L", (1, H), 0)
    px = col.load()
    fe = max(1, int(feather))
    for y in range(H):
        if y0 <= y <= y1:
            t = 1.0
        elif y < y0:
            t = max(0.0, 1.0 - (y0 - y) / fe)
        else:
            t = max(0.0, 1.0 - (y - y1) / fe)
        px[0, y] = int(255 * strength * (t ** 1.3))
    mask = col.resize((W, H))
    dark = Image.new("RGB", (W, H), _rgb(PALETTE["ink"]))
    return Image.composite(dark, img.convert("RGB"), mask)


def _paste_rgba(dest, spr, x, y):
    """alpha_composite that tolerates negative / overflowing offsets - a
    head-scaled fighter sprite is routinely wider than the canvas."""
    x, y = int(x), int(y)
    if x < 0:
        if -x >= spr.width:
            return
        spr = spr.crop((-x, 0, spr.width, spr.height))
        x = 0
    if y < 0:
        if -y >= spr.height:
            return
        spr = spr.crop((0, -y, spr.width, spr.height))
        y = 0
    if x >= dest.width or y >= dest.height:
        return
    if x + spr.width > dest.width or y + spr.height > dest.height:
        spr = spr.crop((0, 0, min(spr.width, dest.width - x),
                        min(spr.height, dest.height - y)))
    dest.alpha_composite(spr, (x, y))


def _squeezed_text(img, cx, top, text, f, fill, tracking, squeeze):
    """Draw letterspaced text horizontally compressed by `squeeze`, centered
    on cx with the em-top at `top`. Fake-condensed display type for slots too
    narrow for a 12-letter surname at real width. Returns the drawn width."""
    meas = ImageDraw.Draw(Image.new("L", (8, 8)))
    tw = max(1, int(_tracked_w(meas, text, f, tracking)))
    h = int(f.size * 1.5) + 6
    spr = Image.new("RGBA", (tw + 8, h), (0, 0, 0, 0))
    sd = ImageDraw.Draw(spr)
    _tracked(sd, (4, 0), text, f, tuple(fill) + (255,), tracking)
    nw = max(1, int(spr.width * min(1.0, squeeze)))
    if nw != spr.width:
        spr = spr.resize((nw, h), RESAMPLE)
    img.paste(spr, (int(cx - nw / 2), int(top)), spr)
    return nw


def _stamp(base, layer, blur=12, dy=5, alpha=150):
    """Composite an RGBA type layer onto base under a soft drop shadow."""
    out = base.convert("RGBA")
    if blur > 0 and alpha > 0:
        shadow = Image.new("RGBA", layer.size, (0, 0, 0, 0))
        shadow.paste((0, 0, 0, alpha), (0, dy), layer)
        shadow = shadow.filter(ImageFilter.GaussianBlur(blur))
        out = Image.alpha_composite(out, shadow)
    return Image.alpha_composite(out, layer).convert("RGB")


def _display_block(img, lines, f, x, y, tracking=0, fill=None, chrome=None,
                   spacing=None, blur=12, dy=5, salpha=150, align="center",
                   squeeze=1.0):
    """Uppercase display block with negative tracking and a soft shadow.
    chrome=(top_hex, bottom_hex) fills the glyphs with a vertical gradient.
    squeeze < 1 fake-condenses the glyphs horizontally (Poppins ships no
    condensed cut; drawn width becomes tracked_width * squeeze around/from x).
    Returns (img, next_y)."""
    if not lines:
        return img, y
    W, H = img.size
    sq = min(1.0, max(0.5, squeeze))
    mw = int(round(W / sq))
    mask = Image.new("L", (mw, H), 0)
    md = ImageDraw.Draw(mask)
    lh = spacing or _line_h(f)
    yy = y
    for ln in lines:
        if align == "center":
            w = _tracked_w(md, ln, f, tracking)
            _tracked(md, (x / sq - w / 2, yy), ln, f, 255, tracking)
        else:
            _tracked(md, (x / sq, yy), ln, f, 255, tracking)
        yy += lh
    if mw != W:
        mask = mask.resize((W, H), RESAMPLE)
    if chrome:
        block_h = max(1, int(yy - y + f.size * 0.35))
        grad = Image.linear_gradient("L").resize((W, block_h))
        color = Image.new("RGB", (W, H), _rgb(chrome[1]))
        color.paste(ImageOps.colorize(grad, black=_rgb(chrome[0]),
                                      white=_rgb(chrome[1])), (0, int(y)))
    else:
        color = Image.new("RGB", (W, H), fill or _rgb(PALETTE["paper"]))
    layer = color.convert("RGBA")
    layer.putalpha(mask)
    return _stamp(img, layer, blur=blur, dy=dy, alpha=salpha), yy


def _italic_line(img, cx, y, text, f, fill, tracking):
    """Small letterspaced fake-italic accent line (sheared sprite), centered."""
    text = " ".join((text or "").upper().split())
    if not text:
        return img
    meas = ImageDraw.Draw(Image.new("L", (8, 8)))
    tw = int(_tracked_w(meas, text, f, tracking))
    h = int(f.size * 1.6)
    sh = STYLE["italic_shear"]
    pad = int(h * sh) + 4
    spr = Image.new("RGBA", (tw + 2 * pad, h), (0, 0, 0, 0))
    sd = ImageDraw.Draw(spr)
    _tracked(sd, (pad, 0), text, f, tuple(fill) + (255,), tracking)
    spr = spr.transform(spr.size, Image.Transform.AFFINE,
                        (1, sh, -sh * h * 0.5, 0, 1, 0),
                        resample=Image.Resampling.BICUBIC)
    base = img.convert("RGBA")
    base.alpha_composite(spr, (int(cx - spr.width / 2), int(y)))
    return base.convert("RGB")


def _lockup(img, logo, cx, top, size=None):
    """Brand lockup: flame mark with the letterspaced wordmark underneath."""
    d = ImageDraw.Draw(img)
    size = size or STYLE["badge_size"]
    wy = top
    if logo is not None:
        b = logo.resize((size, size), RESAMPLE)
        img.paste(b, (int(cx - size / 2), int(top)), b)
        wy = top + size + STYLE["lockup_word_gap"]
    f = _font("semibold", STYLE["lockup_word_size"])
    tr = STYLE["lockup_word_track"]
    w = _tracked_w(d, BRAND_WORD, f, tr)
    _tracked(d, (cx - w / 2, wy), BRAND_WORD, f, _rgb(PALETTE["paper"]), tr)
    return img


def _footer_bar(img):
    """Accent signature bar across the bottom edge - the brand's baseline."""
    h = STYLE["footer_bar_h"]
    if h <= 0:
        return img
    W, H = img.size
    grad = Image.linear_gradient("L").rotate(90, expand=True).resize((W, h))
    bar = ImageOps.colorize(grad, black=_rgb(PALETTE["accent_deep"]),
                            white=_rgb(PALETTE["accent"]))
    img.paste(bar, (0, H - h))
    return img


def _context_chip(img, cx, cy, text):
    """Tiny centered accent chip with ink text - the optional context tag
    ("BREAKING"). Only drawn when a caller passes the text explicitly; the
    channel name is never a kicker. Returns the chip height."""
    d = ImageDraw.Draw(img)
    text = " ".join((text or "").upper().split())
    f = _font("bold", STYLE["news_tag_size"])
    tr = STYLE["tracking_tag"]
    tw = _tracked_w(d, text, f, tr)
    px, py = STYLE["news_tag_pad_x"], STYLE["news_tag_pad_y"]
    w = int(tw + 2 * px)
    h = STYLE["news_tag_size"] + 2 * py
    x0, y0 = int(cx - w / 2), int(cy - h / 2)
    d.rounded_rectangle([x0, y0, x0 + w, y0 + h], radius=h // 2,
                        fill=_rgb(PALETTE["accent"]))
    _tracked(d, (x0 + px + tr // 2, y0 + py - 2), text, f, _rgb(PALETTE["ink"]), tr)
    return h


def _hot_norm(word):
    """Uppercased core of a display token: edge punctuation stripped so a
    token like "GARRY," still matches the hot word "garry". Pure."""
    return "".join(ch for ch in str(word or "")
                   if ch.isalnum() or ch == "'").upper()


def _is_hot(word, hot):
    """True when a display token matches one of the hot words - whole word,
    case-insensitive, punctuation-blind. Pure; junk input is never hot."""
    if not hot:
        return False
    w = _hot_norm(word)
    return bool(w) and w in {_hot_norm(h) for h in hot}


def _hot_block(img, lines, f, cx, y, tracking, spacing, hot,
               squeeze=1.0, blur=8, dy=4, salpha=120):
    """Centered display block with per-word color: hot words render in the
    brand accent, the rest in white - the reference grammar colors the names
    and the verbs. Uses the exact tracked advances _display_block draws with
    (word by word into an RGBA layer, fake-condensed by `squeeze`, stamped
    under a soft shadow) so a fitted line can never overflow.
    Returns (img, next_y)."""
    if not lines:
        return img, y
    W, H = img.size
    sq = min(1.0, max(0.5, squeeze))
    mw = int(round(W / sq))
    layer = Image.new("RGBA", (mw, H), (0, 0, 0, 0))
    ld = ImageDraw.Draw(layer)
    base_col = (255, 255, 255, 255)
    hot_col = _rgb(PALETTE["accent"]) + (255,)
    yy = y
    for ln in lines:
        w = _tracked_w(ld, ln, f, tracking)
        x = cx / sq - w / 2
        words = ln.split(" ")
        for i, word in enumerate(words):
            fill = hot_col if _is_hot(word, hot) else base_col
            x = _tracked(ld, (x, yy), word, f, fill, tracking)
            if i < len(words) - 1:
                x += _adv(ld, " ", f, tracking)
        yy += spacing
    if mw != W:
        layer = layer.resize((W, H), RESAMPLE)
    return _stamp(img, layer, blur=blur, dy=dy, alpha=salpha), yy


def _inset_portrait(img, photo, cx, bottom):
    """Small square portrait in a thin white border, centered - the reference
    treatment for a quote's speaker. Seated with its bottom edge at `bottom`,
    floating on the photo-to-ink seam under a soft shadow.
    Returns (img, top_y_of_the_inset)."""
    side = STYLE["news_inset_side"]
    b = STYLE["news_inset_border"]
    rad = STYLE["news_inset_radius"]
    full = side + 2 * b
    spr = Image.new("RGBA", (full, full), (0, 0, 0, 0))
    sd = ImageDraw.Draw(spr)
    sd.rounded_rectangle([0, 0, full - 1, full - 1], radius=rad,
                         fill=(255, 255, 255, 255))
    ph = cover_crop(photo, side, side)
    mask = Image.new("L", (side, side), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, side - 1, side - 1],
                                           radius=max(2, rad - b), fill=255)
    spr.paste(ph, (b, b), mask)
    x0 = int(cx - full / 2)
    y0 = int(bottom - full)
    layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
    layer.alpha_composite(spr, (x0, y0))
    return _stamp(img, layer, blur=18, dy=10, alpha=170), y0


def _comma(d, cx, cy, r, color, flip=False):
    """One typographic comma: solid ball plus a tapered curved tail drawn as
    a polygon along a quadratic bezier spine. flip=True mirrors vertically
    (ball at the bottom, tail rising) for opening-quote marks. The Poppins
    quote glyph is an angular slash pair and the old ball-plus-triangle
    version read as water droplets at poster size - this is the real shape."""
    s = -1.0 if flip else 1.0
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=color)
    # flip = a true 180-degree rotation (point reflection), not a vertical
    # mirror - a mirrored comma reads as a musical note, not a quote mark
    p0 = (cx + s * r * 0.60, cy + s * r * 0.35)
    p1 = (cx + s * r * 1.05, cy + s * r * 1.75)
    p2 = (cx - s * r * 0.15, cy + s * r * 2.55)
    left, right = [], []
    steps = 9
    for i in range(steps + 1):
        t = i / steps
        mt = 1 - t
        x = mt * mt * p0[0] + 2 * mt * t * p1[0] + t * t * p2[0]
        y = mt * mt * p0[1] + 2 * mt * t * p1[1] + t * t * p2[1]
        dx = 2 * mt * (p1[0] - p0[0]) + 2 * t * (p2[0] - p1[0])
        dy = 2 * mt * (p1[1] - p0[1]) + 2 * t * (p2[1] - p1[1])
        ln = max(1e-6, (dx * dx + dy * dy) ** 0.5)
        wd = r * (0.72 * (1 - t) + 0.10)
        left.append((x - dy / ln * wd, y + dx / ln * wd))
        right.append((x + dy / ln * wd, y - dx / ln * wd))
    d.polygon(left + right[::-1], fill=color)


def _quote_pair(d, x, cy, size, color, opening):
    """A double-quote mark (two commas) with its left edge at x, vertically
    centered on cy. Returns the drawn width."""
    r = max(3, int(size * 0.26))
    step = int(r * 2.6)
    # ball center sits above/below cy so ball plus tail balance around cy
    bcy = cy + (int(r * 0.75) if opening else -int(r * 0.75))
    for i in (0, 1):
        _comma(d, x + r + i * step, bcy, r, color, flip=opening)
    return step + 2 * r


def _quote_chip(img, cx, cy, size):
    """The seam quote badge: accent gradient chip, centered on (cx, cy), with
    a white opening and closing quote pair - the genre element that credits
    the headline to a SPEAKER instead of the channel. Returns the chip h."""
    r = max(3, int(size * 0.26))
    pair_w = int(r * 2.6) + 2 * r
    gap = int(r * 1.5)
    px, py = STYLE["news_chip_pad_x"], STYLE["news_chip_pad_y"]
    cw = pair_w * 2 + gap + 2 * px
    chh = int(size * 0.94) + 2 * py
    x0, y0 = int(cx - cw / 2), int(cy - chh / 2)
    grad = Image.linear_gradient("L").resize((cw, chh))
    chip = ImageOps.colorize(grad, black=_rgb(PALETTE["accent"]),
                             white=_rgb(PALETTE["accent_deep"])).convert("RGBA")
    m = Image.new("L", (cw, chh), 0)
    ImageDraw.Draw(m).rounded_rectangle([0, 0, cw - 1, chh - 1],
                                        radius=int(chh * 0.22), fill=255)
    chip.putalpha(m)
    base = img.convert("RGBA")
    sh = Image.new("RGBA", base.size, (0, 0, 0, 0))
    ImageDraw.Draw(sh).rounded_rectangle(
        [x0, y0 + 6, x0 + cw, y0 + chh + 6], radius=int(chh * 0.22),
        fill=(0, 0, 0, 130))
    base = Image.alpha_composite(base, sh.filter(ImageFilter.GaussianBlur(10)))
    base.alpha_composite(chip, (x0, y0))
    d = ImageDraw.Draw(base)
    white = (255, 255, 255, 255)
    _quote_pair(d, x0 + px, cy, size, white, opening=True)
    _quote_pair(d, x0 + px + pair_w + gap, cy, size, white, opening=False)
    img.paste(base.convert("RGB"), (0, 0))
    return chh


# ---- templates -------------------------------------------------------------
def _news_photo(photo, W, H):
    """News photo prep: cover crop, PUNCH IN so the subject's face carries
    the frame, then a light cinematic grade - contrast up, color down, a
    whisper of the brand accent in the shadows - plus side scrims and a soft
    top scrim to bury cage clutter. The bottom is left for _crush_bottom."""
    base = _enhance_photo(cover_crop(photo, W, H))
    z = STYLE["news_zoom"]
    if z > 1.001:
        w2, h2 = int(W / z), int(H / z)
        cx = W / 2
        cy = max(h2 / 2, min(H - h2 / 2, H * STYLE["news_zoom_cy"]))
        box = (int(cx - w2 / 2), int(cy - h2 / 2))
        base = base.crop((box[0], box[1], box[0] + w2, box[1] + h2))
        base = base.resize((W, H), RESAMPLE)
        base = _sharpen(base, 80).convert("RGB")
    if STYLE["news_grade"] > 0:
        base = tint(base, PALETTE["accent_deep"], STYLE["news_grade"])
        base = ImageEnhance.Contrast(base).enhance(1.10)
        base = ImageEnhance.Color(base).enhance(1.08)
    base = ImageEnhance.Brightness(base).enhance(1.12)
    s = STYLE["news_side_scrim"]
    if s > 0:
        base = scrim(base, "right", s, gamma=2.6)
        base = scrim(base, "left", s, gamma=2.6)
    base = scrim(base, "up", 0.12)
    base = scrim(base, "down", STYLE["top_scrim_strength"])
    return base


def render_news(spec):
    """1080x1350 news poster: the photo fills the WHOLE canvas, cinematically
    graded, melting into near-black across the bottom where a SHORT centered
    poster line in huge condensed Poppins Black carries the story - one to
    three hot words in the brand accent, the rest white. No logo and no
    channel kicker anywhere: the accent color alone is the branding. A named
    speaker turns the card into a quote post - accent quote chip above the
    line, an optional inset portrait (thin white border) above that; the
    speaker line drops out of the art when the inset carries the likeness.
    Attribution is one tiny letterspaced VIA line and nothing else.
    spec: line (falls back to headline), hot (words to color), speaker,
    source, photo_path, inset_path, kicker (tiny centered context chip, drawn
    ONLY when explicitly passed), quote=False forces the plain treatment."""
    W, H, m = STYLE["post_w"], STYLE["post_h"], STYLE["margin"]
    photo = _load_photo(spec.get("photo_path"))
    if photo:
        base = _news_photo(photo, W, H)
    else:
        # photoless fallback: a lit near-black field, still centered and
        # intentional - the accent glow pools where the type will sit
        base = _ink_canvas(W, H)
        base = _glow(base, (W / 2, H * 0.46), 900, PALETTE["accent_deep"], 0.36)
        base = _glow(base, (W * 0.14, H * 0.04), 520, PALETTE["accent_deep"], 0.16)
        base = _glow(base, (W * 0.86, H * 0.04), 520, PALETTE["accent_deep"], 0.16)
    base = _vignette(base, STYLE["news_vignette"], 2.4)
    d = ImageDraw.Draw(base)

    line_text = " ".join((spec.get("line") or spec.get("headline") or "").split())
    hot = [str(h) for h in (spec.get("hot") or []) if str(h or "").strip()]
    hot = hot[:STYLE["news_hot_words"]]
    source = (spec.get("source") or "").strip()
    speaker = " ".join((spec.get("speaker") or "").upper().split())
    quoted = (bool(spec.get("quote", True)) and bool(speaker) and bool(line_text)
              and not any(q in line_text for q in ('"', chr(0x201C))))
    inset = _load_photo(spec.get("inset_path")) if quoted else None

    # bottom-up layout: margin -> VIA -> speaker -> line -> chip -> inset.
    # With no photo the stack rises toward the center so the empty field
    # above it reads as a deliberate stage, not a missing image.
    y = H - m
    if photo is None:
        y -= int(H * STYLE["news_nophoto_lift"])
    via_y = None
    if source:
        y -= STYLE["credit_size"]
        via_y = y
        y -= STYLE["news_credit_gap"]
    spk_y = None
    if quoted and inset is None:
        y -= STYLE["news_speaker_size"]
        spk_y = y
        y -= STYLE["news_speaker_gap"]

    sq = STYLE["display_squeeze"]
    lines, f = fit_text(d, line_text, font_path("black"),
                        (W - 2 * m) / sq, STYLE["news_block_h"],
                        STYLE["news_lines"], size_hi=STYLE["news_line_max"],
                        size_lo=STYLE["news_line_min"],
                        track_frac=STYLE["display_track"])
    tr = -int(round(f.size * STYLE["display_track"]))
    lh = int(round(f.size * STYLE["display_spacing"]))
    hy = y - len(lines) * lh

    # the photo crushes to solid ink under the type; on quote posts the chip
    # straddles the seam (solid from its vertical center down)
    chip_h = int(STYLE["news_quote_size"] * 0.94) + 2 * STYLE["news_chip_pad_y"]
    chip_cy = hy - STYLE["news_quote_gap"] - chip_h // 2
    if quoted:
        base = _crush_bottom(base, chip_cy, STYLE["news_plate_ramp"])
    else:
        base = _crush_bottom(base, hy - STYLE["news_plate_pad"],
                             STYLE["news_plate_ramp"])

    top_y = hy
    if quoted:
        _quote_chip(base, W / 2, chip_cy, STYLE["news_quote_size"])
        top_y = chip_cy - chip_h // 2
    if inset is not None:
        base, top_y = _inset_portrait(base, inset, W / 2,
                                      top_y - STYLE["news_inset_gap"])
    kicker = " ".join((spec.get("kicker") or "").split())
    if kicker:
        kh = STYLE["news_tag_size"] + 2 * STYLE["news_tag_pad_y"]
        _context_chip(base, W / 2, top_y - STYLE["news_tag_gap"] - kh // 2,
                      kicker)

    base, _ = _hot_block(base, lines, f, W / 2, hy, tracking=tr, spacing=lh,
                         hot=hot, squeeze=sq)
    d = ImageDraw.Draw(base)
    if spk_y is not None:
        sf = _font("extrabold", STYLE["news_speaker_size"])
        sw_ = _tracked_w(d, speaker, sf, 3)
        _tracked(d, (W / 2 - sw_ / 2, spk_y), speaker, sf,
                 _rgb(PALETTE["accent"]), 3)
    if via_y is not None:
        cf = _font("medium", STYLE["credit_size"])
        txt = ("VIA " + source).upper()
        cw_ = _tracked_w(d, txt, cf, STYLE["tracking_credit"])
        _tracked(d, (W / 2 - cw_ / 2, via_y), txt, cf,
                 _rgb(PALETTE["paper_dim"]), STYLE["tracking_credit"])
    base = _grain(base)
    return _footer_bar(base)


def render_announce(spec):
    """1080x1350 fight poster: near-black field lit hot, glossy fire-lit
    flame emblem, chest-up fighter cutouts normalized by detected head height
    onto one shared eye line, stacked Black surnames with a sheared VERSUS,
    weight class in warm amber, date + city, purple brand lockup top center.
    spec: left_photo, right_photo, left_name, right_name, event_line,
    date_line, accent (optional hex; overrides the meta line color)."""
    W, H = STYLE["post_w"], STYLE["post_h"]
    accent = spec.get("accent") or PALETTE["accent"]
    logo = load_logo("purple")

    # near-black field lit HOT (round 5): ember pools plus a glossy fire
    # emblem behind the fighters - the scene burns red-orange while purple
    # stays confined to the brand lockup and footer bar
    base = _ink_canvas(W, H)
    base = _glow(base, (W / 2, H * 0.30), 760, PALETTE["fire_deep"], 0.20)
    base = _glow(base, (W * 0.10, H * 0.05), 480, PALETTE["ember"], 0.40)
    base = _glow(base, (W * 0.90, H * 0.05), 480, PALETTE["ember"], 0.40)
    base = _ghost_mark(base, logo, (W / 2, H * STYLE["announce_mark_cy"]),
                       STYLE["announce_mark_side"],
                       colors=("#FFB347", PALETTE["fire_deep"]),
                       halo=0.65)

    # fighters: real cutouts composite over the monogram; plain RGB photos
    # fall back to tinted half panes so the template survives any input.
    cxs = STYLE["announce_fighter_cx"]
    sides = []
    for key, cxf in (("left_photo", cxs[0]), ("right_photo", cxs[1])):
        src = spec.get(key)
        cut = _load_cutout(src)
        if cut is not None:
            sides.append(("cut", cut, cxf, key))
        else:
            ph = _load_photo(src)
            if ph is not None:
                sides.append(("pane", ph, cxf, key))
    for kind, imgp, cxf, key in sides:
        if kind != "pane":
            continue
        x0 = 0 if key == "left_photo" else W // 2
        base.paste(tint(cover_crop(imgp, W // 2, H),
                        spec.get("accent") or PALETTE["fire_deep"]), (x0, 0))
    if any(kind == "pane" for kind, _i, _c, _k in sides):
        seam = Image.new("L", (W, H), 0)
        sd = ImageDraw.Draw(seam)
        sd.rectangle([W // 2 - 130, 0, W // 2 + 130, H], fill=130)
        seam = seam.filter(ImageFilter.GaussianBlur(70))
        base = Image.composite(Image.new("RGB", (W, H), _rgb(PALETTE["ink"])),
                               base, seam)
    # scale each cutout by its DETECTED head HEIGHT to a shared target and
    # seat both faces on one eye line, cropped waist-up - width-normalising
    # rendered a wide bearded head visibly smaller and lower than a narrow
    # tall one (round 5 fix), and a soft upscale gets an unsharp pass so both
    # faces carry the same bite.
    rw = STYLE["rim_width"]
    for kind, imgp, cxf, key in sorted(
            [s for s in sides if s[0] == "cut"],
            key=lambda s: 0 if s[3] == "right_photo" else 1):  # left pastes last
        met = _head_metrics(imgp)
        if met:
            y_top, head_w, hcx, head_h = met
            target = H * STYLE["announce_head_h"]
            scale = min(STYLE["announce_scale_max"], target / max(8.0, head_h))
            y0 = int(max(0, y_top - head_h * STYLE["announce_crown"]))
            y1 = int(min(imgp.height, y_top + head_h * STYLE["announce_torso"]))
            body = imgp.crop((0, y0, imgp.width, max(y0 + 1, y1)))
            spr = _grade_cutout(body, ambient=0.22,
                                ambient_color=PALETTE["fire"],
                                sat=0.98, contrast=1.10, brightness=1.03)
            tw = max(1, int(spr.width * scale))
            th = max(1, int(spr.height * scale))
            spr = spr.resize((tw, th), RESAMPLE)
            if scale > 1.05:
                spr = _sharpen(spr, min(140, int(90 * scale)))
            eye_src = (y_top - y0) + head_h * STYLE["announce_eye_frac"]
            py = int(H * STYLE["announce_eye_y"] - eye_src * scale)
            px_ = int(W * cxf - hcx * scale)
        else:
            spr = _grade_cutout(imgp, ambient=0.22,
                                ambient_color=PALETTE["fire"],
                                sat=0.98, contrast=1.10, brightness=1.03)
            th = int(H * STYLE["announce_fighter_h"])
            tw = max(1, int(spr.width * th / spr.height))
            spr = spr.resize((tw, th), RESAMPLE)
            py = int(H * STYLE["announce_fighter_top"])
            px_ = int(W * cxf - tw / 2)
        # rim the edge facing the fire between the fighters, plus a kiss of
        # top light - re-lights the studio cutout so it belongs to the scene
        spr = _rim_light(spr, -rw if key == "left_photo" else rw, int(rw * 0.7),
                         color=PALETTE["fire_soft"])
        spr = _fade_alpha(spr, "bottom", 0.80, 0.0)
        hold = base.convert("RGBA")
        _paste_rgba(hold, spr, px_, py)
        base = hold.convert("RGB")

    # dark band behind the name stack: white display type crossing a bright
    # torso or a gold glove needs its own scrim, not just the bottom crush
    band_top = int(H * STYLE["announce_stack_y"]) - 46
    base = _band_scrim(base, band_top, band_top + 560,
                       STYLE["announce_band_strength"], 130)
    base = _crush_bottom(base, int(H * 0.93), int(H * 0.42),
                         STYLE["announce_bottom_scrim"])
    base = _vignette(base, 0.44, 2.0)
    d = ImageDraw.Draw(base)

    # name stack - ONE lockup, gaps measured cap-edge to cap-edge so the air
    # above and below VERSUS is EQUAL (the round 3 stack floated apart)
    sq = STYLE["display_squeeze"]
    left = " ".join((spec.get("left_name") or "TBA").upper().split())
    right = " ".join((spec.get("right_name") or "TBA").upper().split())
    fa, _t = _fit_tracked(d, left, "black", STYLE["announce_name_w"] / sq,
                          STYLE["announce_name_max"], STYLE["announce_name_min"],
                          STYLE["display_track"])
    fb, _t = _fit_tracked(d, right, "black", STYLE["announce_name_w"] / sq,
                          STYLE["announce_name_max"], STYLE["announce_name_min"],
                          STYLE["display_track"])
    size = min(fa.size, fb.size)
    nf = _font("black", size)
    tr = -int(round(size * STYLE["display_track"]))
    lh = int(round(size * STYLE["display_spacing"]))
    cx = W / 2
    y = int(H * STYLE["announce_stack_y"])
    # meta type rides the SCENE's hot light (pale amber lifted toward white);
    # the brand purple stays in the lockup, chip and footer only
    meta_col = _mix(_rgb(PALETTE["fire_soft"]), _rgb(PALETTE["paper"]), 0.30)
    if spec.get("accent"):
        meta_col = _mix(_rgb(accent), _rgb(PALETTE["paper"]), 0.52)
    nb = d.textbbox((0, 0), left + right, font=nf)     # shared cap band
    vf = _font("semibold", STYLE["announce_vs_size"])
    vb = d.textbbox((0, 0), "VERSUS", font=vf)
    g = STYLE["announce_vs_gap"]
    base, _ = _display_block(base, [left], nf, cx, y, tracking=tr, spacing=lh,
                             blur=14, dy=10, salpha=235, squeeze=sq)
    vs_y = y + nb[3] + g - vb[1]
    base = _italic_line(base, cx, vs_y, "VERSUS", vf,
                        meta_col, STYLE["announce_vs_track"])
    y2 = vs_y + vb[3] + g - nb[1]
    base, _ = _display_block(base, [right], nf, cx, y2, tracking=tr, spacing=lh,
                             blur=14, dy=10, salpha=235, squeeze=sq)
    y = y2 + nb[3]

    event_line = " ".join((spec.get("event_line") or "").upper().split())
    if event_line:
        ef = _font("bold", STYLE["announce_meta_size"])
        base = _italic_line(base, cx, y + 26, event_line, ef, meta_col, 4)
        y += 26 + int(ef.size * 1.6)
    date_line = " ".join((spec.get("date_line") or "").upper().split())
    if date_line:
        parts = [p.strip() for p in date_line.split(" - ", 1)]
        df = _font("black", STYLE["announce_date_size"])
        base, y = _display_block(base, [parts[0]], df, cx, y + 18,
                                 tracking=-int(df.size * 0.01),
                                 spacing=int(df.size * 1.12),
                                 blur=10, dy=4, salpha=150)
        if len(parts) > 1 and parts[1]:
            d = ImageDraw.Draw(base)
            cf = _font("medium", STYLE["announce_city_size"])
            ctr = STYLE["tracking_meta"]
            w = _tracked_w(d, parts[1], cf, ctr)
            _tracked(d, (cx - w / 2, y + 6), parts[1], cf,
                     _rgb(PALETTE["paper_dim"]), ctr)

    _lockup(base, logo, W / 2, 46, size=92)
    base = _grain(base)
    return _footer_bar(base)


def _head_metrics(img):
    """Alpha-channel head detection on a promo cutout. Returns
    (y_top, head_w, cx, head_h) in source px, or None when there is no usable
    alpha. y_top = first row with real coverage, head_w = median silhouette
    run just under the hairline, cx = alpha centroid of the top band, head_h =
    crown-to-NECK height found by walking the silhouette profile: the run
    widens to the ears, tapers past the jaw, bottoms out at the neck, then
    explodes at the shoulders - the taper minimum is the neck. Height is what
    perceived head size tracks (round 5: width-normalising rendered a wide
    bearded head visibly smaller than a narrow tall one)."""
    a = img.getchannel("A")
    lo, _hi = a.getextrema()
    if lo >= 250:
        return None
    w, h = img.size
    ds = 4                                        # analyse at quarter res
    small = a.resize((max(1, w // ds), max(1, h // ds)))
    sw, sh = small.size
    px = small.load()
    thr = 40
    y_top = None
    for yy in range(sh):
        if sum(1 for xx in range(sw) if px[xx, yy] > thr) >= max(2, sw * 0.05):
            y_top = yy
            break
    if y_top is None:
        return None
    xs = n = 0
    for yy in range(y_top, min(sh, y_top + max(1, int(sh * 0.16)))):
        for xx in range(sw):
            if px[xx, yy] > thr:
                xs += xx
                n += 1
    cx = (xs / max(1, n)) * ds
    fy0 = y_top + max(1, int(sh * 0.06))
    runs = []
    for yy in range(fy0, min(sh, fy0 + max(1, int(sh * 0.10)))):
        row = [xx for xx in range(sw) if px[xx, yy] > thr]
        if row:
            runs.append((row[-1] - row[0]) * ds)
    runs.sort()
    head_w = runs[len(runs) // 2] if runs else w * 0.4
    # crown-to-neck: peak / fall / rise state walk down the run profile
    peak = 0
    neck_y, neck_run = None, None
    falling = False
    for yy in range(y_top, min(sh, y_top + int(sh * 0.8))):
        row = [xx for xx in range(sw) if px[xx, yy] > thr]
        run = (row[-1] - row[0]) if row else 0
        if not falling:
            if run >= peak * 0.9:
                peak = max(peak, run)
            if peak > 0 and run < peak * 0.85:
                falling = True
        if falling:
            if neck_run is None or run < neck_run:
                neck_run, neck_y = run, yy
            elif neck_run and run > neck_run * 1.25:
                break                             # shoulders reached
    head_h = (neck_y - y_top) * ds if neck_y else head_w * 1.25
    head_h = max(head_h, head_w * 0.85)           # guard absurd profiles
    return y_top * ds, head_w, cx, head_h


def _head_crop(source):
    """Locate the head in a promo cutout via its alpha channel and return a
    tight head-and-shoulders RGBA square. At feed size a waist-up promo crop
    turns every face into an anonymous torso, and recognition is the whole
    payload of the format. Returns None when the source is not a cutout."""
    try:
        img = source if isinstance(source, Image.Image) else Image.open(source)
        img = img.convert("RGBA")
    except Exception:
        return None
    met = _head_metrics(img)
    if met is None:
        return None
    y_top, head_w, cx, _head_h = met
    w, h = img.size
    side = int(max(64, min(min(w, h), head_w * STYLE["last5_head_zoom"])))
    x0 = max(0, min(w - side, int(cx - side / 2)))
    y0 = max(0, min(h - side, int(y_top - side * 0.10)))
    return img.crop((x0, y0, x0 + side, y0 + side))


def _headshot_tile(source, cell, logo):
    """Grayscale square headshot cropped TIGHT to the face when the source is
    a cutout; plain photos cover-crop; missing photo -> ink tile + mini mark."""
    crop = _head_crop(source)
    if crop is not None:
        grad = Image.linear_gradient("L").resize(crop.size)
        bg = ImageOps.colorize(grad, black=(58, 56, 68), white=(22, 21, 28))
        bg.paste(crop, (0, 0), crop)
        g = ImageOps.autocontrast(ImageOps.grayscale(bg), cutoff=1)
        t = ImageOps.colorize(g, black=(11, 11, 15), white=(243, 242, 246))
        return t.resize((cell, cell), RESAMPLE)
    p = _load_photo(source)
    if p:
        g = ImageOps.autocontrast(ImageOps.grayscale(cover_crop(p, cell, cell)))
        return ImageOps.colorize(g, black=(13, 13, 16), white=(245, 244, 246))
    tile = Image.new("RGB", (cell, cell), _rgb(PALETTE["ink_soft"]))
    if logo is not None:
        side = int(cell * STYLE["last5_tile_mark"])
        mark = logo.resize((side, side), RESAMPLE)
        alpha = mark.getchannel("A").point(lambda v: int(v * STYLE["last5_tile_alpha"]))
        mark.putalpha(alpha)
        tile.paste(mark, ((cell - side) // 2, (cell - side) // 2), mark)
    return tile


def _side_fighter(base, source, cx, top_h, mirror):
    """Main fighter down one side: BRIGHT, sharp, head-normalized so the
    faceoff reads at 30 percent zoom (round 5: the old mono-crush plus dark
    overlay made the matchup illegible), or a graded pane crop when the
    source has no alpha. Returns the updated base."""
    W, H = base.size
    col_w = STYLE["last5_col_w"]
    cut = _load_cutout(source)
    if cut is not None:
        met = _head_metrics(cut)
        cut = _grade_cutout(cut, ambient=0.10, ambient_color=PALETTE["fire"],
                            sat=0.98, contrast=1.10, brightness=1.04)
        if mirror:
            cut = ImageOps.mirror(cut)
            if met:
                met = (met[0], met[1], cut.width - met[2], met[3])
        if met:
            y_top, _hw, hcx, head_h = met
            scale = min(3.0, (H * STYLE["last5_head_h"]) / max(8.0, head_h))
            eye_src = y_top + head_h * STYLE["announce_eye_frac"]
            py = int(H * STYLE["last5_eye_y"] - eye_src * scale)
            px_ = int(cx - hcx * scale)
        else:
            th = H - top_h + 30
            scale = th / cut.height
            py = H - int(cut.height * scale)
            px_ = int(cx - cut.width * scale / 2)
        spr = cut.resize((max(1, int(cut.width * scale)),
                          max(1, int(cut.height * scale))), RESAMPLE)
        if scale > 1.05:
            spr = _sharpen(spr, min(140, int(90 * scale)))
        rw = STYLE["rim_width"]
        spr = _rim_light(spr, -rw if cx < W / 2 else rw, int(rw * 0.7),
                         color=PALETTE["fire_soft"])
        # keep a column-wide slice around the head center
        c0 = int((cx - px_) - col_w / 2)
        cl = max(0, c0)
        spr = spr.crop((cl, 0, max(cl + 1, min(spr.width, c0 + col_w)),
                        spr.height))
        px_ = px_ + cl
        spr = _fade_alpha(spr, "right" if cx < W / 2 else "left",
                          span=STYLE["last5_col_fade"])
        spr = _fade_alpha(spr, "bottom", 0.86, 0.0)
        base = _glow(base, (cx, top_h + 200), 460, PALETTE["fire_deep"], 0.30)
        hold = base.convert("RGBA")
        _paste_rgba(hold, spr, px_, max(0, py))
        return hold.convert("RGB")
    p = _load_photo(source)
    if p is None:
        return base
    col_h = H - top_h
    col = cover_crop(p, col_w, col_h)
    if mirror:
        col = ImageOps.mirror(col)
    col = tint(col, PALETTE["fire_deep"], 0.30)
    col = scrim(col, "right" if cx < W / 2 else "left", 0.45)
    base.paste(col, (int(cx - col_w / 2), top_h))
    return base


def render_last5(spec):
    """1080x1350 comparison: stacked display title flanked by the two main
    fighters, then five rows of dark plates with tight grayscale head crops on
    the center gutter and two-tier name lockups filling each plate.
    spec: left_photo, right_photo, rows (list of up to 5 dicts with
    left_name, left_photo, right_name, right_photo), title (optional)."""
    W, H = STYLE["post_w"], STYLE["post_h"]
    logo = load_logo("purple")
    top = STYLE["last5_col_top"]

    base = _ink_canvas(W, H)
    # the scene burns hot (round 5): ember light pools behind the title and
    # the grid so the near-black plates SEPARATE from the field - the purple
    # stays in the brand word, underline and footer
    base = _glow(base, (W / 2, 120), 780, PALETTE["fire_deep"], 0.36)
    base = _glow(base, (W / 2, int(H * 0.52)), 880, PALETTE["fire_deep"], 0.16)
    base = _glow(base, (W / 2, int(H * 0.84)), 820, PALETTE["ember"], 0.28)
    base = _watermark(base, logo)
    base = _side_fighter(base, spec.get("left_photo"), STYLE["last5_col_w"] // 2,
                         top, mirror=False)
    base = _side_fighter(base, spec.get("right_photo"),
                         W - STYLE["last5_col_w"] // 2, top, mirror=True)
    base = scrim(base, "up", 0.16, gamma=2.6)
    d = ImageDraw.Draw(base, "RGBA")   # RGBA mode so translucent strokes blend

    # title stack between the faces: kicker, big line, letterspaced tail word
    kf = _font("semibold", 22)
    ktr = 8
    kw = _tracked_w(d, BRAND_WORD, kf, ktr)
    _tracked(d, (W / 2 - kw / 2, 42), BRAND_WORD, kf, _rgb(PALETTE["accent"]), ktr)
    title = " ".join((spec.get("title") or LAST5_TITLE_DEFAULT).upper().split())
    words = title.split()
    head, tail = (title, "") if len(words) < 2 else (" ".join(words[:-1]), words[-1])
    dsq = STYLE["display_squeeze"]
    hf, htr = _fit_tracked(d, head, "black", STYLE["last5_title_w"] / dsq,
                           STYLE["last5_title_max"], STYLE["last5_title_min"], 0.02)
    base, ty = _display_block(base, [head], hf, W / 2, 78, tracking=htr,
                              chrome=(PALETTE["chrome_hi"], PALETTE["chrome_lo"]),
                              spacing=int(hf.size * 1.02), blur=12, dy=6,
                              salpha=180, squeeze=dsq)
    d = ImageDraw.Draw(base, "RGBA")
    if tail:
        # the tail word is a solid slab, not a whisper: thin wide-tracked
        # sublines are exactly the treatment that vanishes at feed size
        tf = _font("black", STYLE["last5_tail_size"])
        ttr = STYLE["last5_tail_track"]
        tw = _tracked_w(d, tail, tf, ttr)
        while tw > STYLE["last5_title_w"] and tf.size > 24:
            tf = _font("black", tf.size - 2)
            tw = _tracked_w(d, tail, tf, ttr)
        _tracked(d, (W / 2 - tw / 2, ty + 2), tail, tf, _rgb(PALETTE["paper"]), ttr)
        ty += 2 + int(tf.size * 1.22)
    uw, uh = STYLE["last5_underline_w"], STYLE["last5_underline_h"]
    uy = int(ty + STYLE["last5_underline_gap"])
    d.rounded_rectangle([W / 2 - uw / 2, uy, W / 2 + uw / 2, uy + uh],
                        radius=uh / 2, fill=_rgb(PALETTE["accent"]))

    # 5 rows x 2 plates; headshots hug the center gutter, names fill outward
    rows = (spec.get("rows") or [])[:5]
    ph = STYLE["last5_plate_h"]
    pm = STYLE["last5_plate_margin"]
    cg = STYLE["last5_center_gap"]
    rad = STYLE["last5_plate_radius"]
    pw = int((W - 2 * pm - cg) / 2)
    grid_top = uy + uh + STYLE["last5_grid_pad"]
    grid_h = H - grid_top - STYLE["last5_bottom_pad"]
    row_block = grid_h / 5.0
    plate_mask = Image.new("L", (pw, ph), 0)
    ImageDraw.Draw(plate_mask).rounded_rectangle([0, 0, pw - 1, ph - 1],
                                                 radius=rad, fill=242)
    # ONE condensed size for all ten names, set by the longest: per-plate
    # auto-shrink rendered NURMAGOMEDOV several steps below MORENO and broke
    # the grid into ten rhythms (round 3). Names stay on ONE line - the tier
    # split stranded a tiny "DU" above PLESSIS.
    sq = STYLE["last5_name_squeeze"]
    zone_w = pw - ph - 38
    names = {}
    for i in range(5):
        row = rows[i] if i < len(rows) else {}
        for side_key in ("left", "right"):
            names[(i, side_key)] = " ".join(
                (row.get(side_key + "_name") or "TBA").upper().split())
    nsize = STYLE["last5_name_max"]
    while nsize > STYLE["last5_name_min"]:
        f_ = _font("extrabold", nsize)
        tr_ = -int(round(nsize * 0.02))
        if all(_tracked_w(d, n, f_, tr_) * sq <= zone_w for n in names.values()):
            break
        nsize -= 1
    lf = _font("extrabold", nsize)
    ltr = -int(round(nsize * 0.02))
    for i in range(5):
        row = rows[i] if i < len(rows) else {}
        ry = int(grid_top + i * row_block + (row_block - ph) / 2)
        for side_key in ("left", "right"):
            x0 = pm if side_key == "left" else pm + pw + cg
            tile = _headshot_tile(row.get(side_key + "_photo"), ph, logo)
            plate = Image.new("RGB", (pw, ph), (11, 11, 15))
            plate.paste(tile, (pw - ph if side_key == "left" else 0, 0))
            base.paste(plate, (x0, ry), plate_mask)
            d.rounded_rectangle([x0, ry, x0 + pw - 1, ry + ph - 1], radius=rad,
                                outline=(255, 255, 255, 44), width=2)
            name = names[(i, side_key)]
            zone_x = x0 + (22 if side_key == "left" else ph + 16)
            ncx = zone_x + zone_w / 2
            # ONE size, ONE squeeze for all ten names - the sizing loop above
            # already fit the longest name, so nothing may shrink per row
            # (round 5: sibling labels at different sizes broke the grid).
            # The min() stays only as an absurd-input guard at the floor.
            sq_eff = sq
            if _tracked_w(d, name, lf, ltr) * sq > zone_w:
                sq_eff = zone_w / max(1.0, _tracked_w(d, name, lf, ltr))
            tb = d.textbbox((0, 0), name, font=lf)
            ny = ry + (ph - (tb[3] - tb[1])) // 2 - tb[1]
            _squeezed_text(base, ncx, ny, name, lf, (255, 255, 255), ltr, sq_eff)
    base = _grain(base)
    base = _vignette(base, 0.16, 2.4)
    return _footer_bar(base)


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
    return _grain(base, 0.035)


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
            "line": "Champion out injured",
            "hot": ["injured"],
            "source": "Bloody Elbow", "kicker": "BREAKING"}),
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
