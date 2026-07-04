#!/usr/bin/env python3
"""Prime Arena - free NSFW image scan (isolated from the std-lib-only bots).

AutoMod can only read TEXT, never image pixels - so this is the free way to catch
NSFW *images*. It runs in its own GitHub Actions job (public repo = unlimited free
minutes) using an open-source ONNX classifier - NO API key, NO signup, nothing for
the owner to set up:
  * "nudenet" (default)  -> NudeNet v3: per-part detection; we score the EXPOSED
                            classes.
  * "opennsfw"           -> opennsfw-standalone: one NSFW probability per image
                            (opt-in; abandoned upstream, not installed by default).
For every channel whose profile has `nsfw_images: true`, it checks new image
attachments and, over the configured threshold, deletes + logs them.

Honest trade-off (documented in BOTS_GUIDE): this is NEAR-real-time (cron floor +
download + inference ~= 1-6 min), not instant. For zero-latency safety set a
channel's media policy to block images outright (sfw_only / text_only).

The third-party deps are imported LAZILY inside the scorer, so this file still
`py_compile`s on a bare machine and the other bots stay std-lib only.
"""
import urllib.request
import common, modconfig

STATE_FILE = "state_image.json"
RECENT_MIN = 15                      # only judge images from the last N minutes
MAX_BYTES = 8 * 1024 * 1024          # don't download more than 8 MB per image
IMG_EXT = (".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".tiff", ".heic", ".heif", ".avif")

# NudeNet classes that mean explicit nudity (the ones we actually want to block).
NUDENET_EXPLICIT = {
    "FEMALE_GENITALIA_EXPOSED", "MALE_GENITALIA_EXPOSED", "FEMALE_BREAST_EXPOSED",
    "BUTTOCKS_EXPOSED", "ANUS_EXPOSED",
}

_SCORER = None                       # cached callable(bytes)->float; tests inject a stub here
_GORE = None                         # cached gore scorer, False = unavailable; tests inject

# ── gore watch (ALERT-ONLY, forever) ────────────────────────────────────────
# CLIP zero-shot with competing labels: MMA/boxing photos land on the sport
# labels, so bloody fight pics score ~0 gore (calibrated: 0/27 MMA+benign false
# positives at 0.85; blatant casualty imagery scores 0.93+). There is NO delete
# call anywhere in the gore flow - it only posts a review alert to mod-log.
GORE_MODEL_URL = ("https://huggingface.co/Xenova/clip-vit-base-patch32/"
                  "resolve/main/onnx/vision_model_quantized.onnx")
GORE_LABELS_FILE = "gore_labels.json"
CLIP_MEAN = (0.48145466, 0.4578275, 0.40821073)
CLIP_STD = (0.26862954, 0.26130258, 0.27577711)


def _load_gore():
    """Build the CLIP gore scorer (deps shared with nudenet: onnxruntime/PIL/
    numpy). Returns bytes -> gore-probability float, or None when unavailable
    (missing labels file, download failure) - the scan then just runs NSFW-only."""
    import io, os
    try:
        import numpy as np
        import onnxruntime as ort
        from PIL import Image
    except Exception as e:
        print("  gore scorer deps unavailable (%s) - gore watch off" % e)
        return None
    labels = common.load_json(common.state_path(GORE_LABELS_FILE), None)
    if not labels or not labels.get("embeds"):
        print("  gore_labels.json missing - gore watch off")
        return None
    cache = os.path.join(os.path.expanduser("~"), ".cache", "prime_gore")
    os.makedirs(cache, exist_ok=True)
    mp = os.path.join(cache, "clip_vision_q.onnx")
    if not os.path.exists(mp) or os.path.getsize(mp) < 1_000_000:
        print("  downloading the CLIP vision model (~88 MB, cached across runs)...")
        try:
            req = urllib.request.Request(GORE_MODEL_URL, headers={"User-Agent": common.BROWSER_UA})
            with urllib.request.urlopen(req, timeout=600) as r:
                data = r.read()
            with open(mp, "wb") as f:
                f.write(data)
        except Exception as e:
            print("  gore model download failed (%s) - gore watch off" % e)
            return None
    try:
        sess = ort.InferenceSession(mp, providers=["CPUExecutionProvider"])
    except Exception as e:
        print("  gore model load failed (%s) - gore watch off" % e)
        return None
    T = np.asarray(labels["embeds"], dtype=np.float32)
    T = T / np.linalg.norm(T, axis=-1, keepdims=True)
    owners = labels.get("owners") or []
    mean = np.asarray(CLIP_MEAN, dtype=np.float32)
    std = np.asarray(CLIP_STD, dtype=np.float32)
    iname = sess.get_inputs()[0].name

    def score(b):
        try:
            img = Image.open(io.BytesIO(b)).convert("RGB")
            w, h = img.size
            s = 224.0 / min(w, h)
            img = img.resize((max(1, round(w * s)), max(1, round(h * s))), Image.BICUBIC)
            w, h = img.size
            left, top = (w - 224) // 2, (h - 224) // 2
            img = img.crop((left, top, left + 224, top + 224))
            x = (np.asarray(img, dtype=np.float32) / 255.0 - mean) / std
            x = x.transpose(2, 0, 1)[None, ...]
            v = sess.run(None, {iname: x})[0][0]
            v = v / (np.linalg.norm(v) or 1.0)
            logits = 100.0 * (T @ v)
            e = np.exp(logits - logits.max())
            p = e / e.sum()
            return float(sum(pi for pi, g in zip(p, owners) if g == "gore"))
        except Exception as e:
            print("  gore scoring error:", e)
            return 0.0
    return score


def get_gore_scorer():
    """Load-and-cache the gore scorer; None when it can't run (never fatal)."""
    global _GORE
    if _GORE is None:
        _GORE = _load_gore() or False
    return _GORE or None


def _load_scorer(name):
    """Build the real classifier (deps imported lazily). Returns bytes -> float[0,1].
    nudenet is the default; opennsfw is opt-in and falls back to nudenet if its
    (abandoned, Py-3.12-incompatible) package isn't installed."""
    if name == "opennsfw":
        try:
            from opennsfw_standalone import OpenNSFWInferenceRunner
            runner = OpenNSFWInferenceRunner.load()

            def score(b):
                try:
                    return float(runner.infer(b))
                except Exception as e:
                    print("  opennsfw error:", e); return 0.0
            return score
        except Exception as e:
            print("  opennsfw unavailable (%s) - falling back to nudenet" % e)

    from nudenet import NudeDetector          # default: nudenet
    det = NudeDetector()

    def score(b):
        try:
            dets = det.detect(b) or []
        except Exception as e:
            print("  nudenet error:", e); return 0.0
        best = 0.0
        for d in dets:
            if d.get("class") in NUDENET_EXPLICIT:
                best = max(best, float(d.get("score", 0) or 0))
        return best
    return score


def get_scorer(name):
    """Load (and cache, so the model loads once per job) the NSFW scorer."""
    global _SCORER
    if _SCORER is None:
        _SCORER = _load_scorer(name)
    return _SCORER


def fetch_bytes(url, timeout=20):
    """Download an image as raw bytes (Discord CDN URLs need no auth). common.http
    decodes to text and would corrupt binary, so we read bytes directly here."""
    if not url:
        return None
    try:
        req = urllib.request.Request(url, headers={"User-Agent": common.BROWSER_UA})
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.read(MAX_BYTES)
    except Exception as e:
        print("  image download failed:", e); return None


def is_staff(msg, staff):
    if (msg.get("author") or {}).get("bot"):
        return True
    return any(r in staff for r in (msg.get("member") or {}).get("roles", []))


def image_attachments(msg):
    out = []
    for a in (msg.get("attachments") or []):
        ct = (a.get("content_type") or "").lower()
        fn = (a.get("filename") or "").lower()
        if ct.startswith("image/") or fn.endswith(IMG_EXT):
            out.append(a)
    return out


def needs_scan():
    """True iff at least one configured channel resolves to nsfw_images=True.
    Offline (no Discord token, no network) so the workflow can gate the heavy ONNX
    install/scan on it cheaply - if nothing needs scanning the job is a no-op."""
    modcfg = modconfig.load()
    return any(modconfig.resolve_channel(modcfg, c).get("nsfw_images")
               for c in modconfig.configured_channels(modcfg))


def poll_once():
    cfg = common.load_config()
    mod_log = cfg.get("channels", {}).get("mod_log")
    roles = cfg.get("roles", {})
    staff = {roles[k] for k in ("owner", "admin", "mod") if roles.get(k)}
    modcfg = modconfig.load()
    img = modcfg.get("image_scan", {}) or {}
    threshold = float(img.get("threshold", 0.85))
    max_per_run = int(img.get("max_per_run", 40))
    do_delete = img.get("delete", True)
    do_warn = img.get("warn", True)
    classifier = img.get("classifier", "nudenet")
    gore_on = bool(img.get("gore_enabled", False))
    gore_threshold = float(img.get("gore_threshold", 0.85))

    channels = [c for c in modconfig.configured_channels(modcfg)
                if modconfig.resolve_channel(modcfg, c)["nsfw_images"]]
    if not channels:
        print("No channels have nsfw_images enabled - nothing to scan."); return

    state = common.load_json(common.state_path(STATE_FILE), {})
    seen = set(state.get("seen", []))
    now = common.now_utc()
    checked = removed = 0
    scorer = None

    for ch in channels:
        if checked >= max_per_run:
            break
        code, data = common.discord("GET", "/channels/%s/messages?limit=50" % ch)
        if not isinstance(data, list):
            continue
        for m in data:
            if checked >= max_per_run:
                break
            mid = m.get("id")
            if not mid or mid in seen:
                continue
            ts = common.parse_iso(m.get("timestamp"))
            if not ts or (now - ts).total_seconds() > RECENT_MIN * 60:
                continue
            if is_staff(m, staff):
                continue
            atts = image_attachments(m)
            if not atts:
                continue
            if scorer is None:                       # load model only once, only when needed
                scorer = get_scorer(classifier)
            worst, blobs = 0.0, []
            for a in atts:
                b = fetch_bytes(a.get("url") or a.get("proxy_url"))
                if not b:
                    continue
                checked += 1
                blobs.append(b)
                worst = max(worst, scorer(b))
            seen.add(mid)
            uid = (m.get("author") or {}).get("id")
            deleted = False
            if worst >= threshold:
                if do_delete:
                    c, _ = common.discord("DELETE", "/channels/%s/messages/%s" % (ch, mid))
                    if c in (200, 204):
                        removed += 1
                        deleted = True
                if do_warn and mod_log:
                    common.post_message(
                        mod_log,
                        "🔞 Removed a likely-NSFW image from <@%s> in <#%s> (confidence %.0f%%)."
                        % (uid, ch, worst * 100), allowed_mentions={"parse": []})
                print("nsfw image removed:", mid, "score", round(worst, 3))
            # gore watch: ALERT-ONLY. Never deletes, never touches the message -
            # bloody MMA photos are wanted content; a human decides, always.
            if gore_on and blobs and not deleted and mod_log:
                gscore = get_gore_scorer()
                if gscore:
                    gworst = max((gscore(b) for b in blobs), default=0.0)
                    if gworst >= gore_threshold:
                        link = "https://discord.com/channels/%s/%s/%s" % (
                            cfg.get("guild_id"), ch, mid)
                        common.post_message(
                            mod_log,
                            "🚨 Possible graphic-gore image in <#%s> from <@%s> — needs a "
                            "human look: %s (confidence %.0f%%). Nothing was auto-deleted."
                            % (ch, uid, link, gworst * 100),
                            allowed_mentions={"parse": []})
                        print("gore alert:", mid, "score", round(gworst, 3))

    state["seen"] = sorted(seen)[-3000:]
    common.save_json(common.state_path(STATE_FILE), state)
    if removed:
        common.persist_state(STATE_FILE)
    print("Image scan cycle done. checked=%d removed=%d" % (checked, removed))


def main():
    common.run_loop(poll_once)


if __name__ == "__main__":
    main()
