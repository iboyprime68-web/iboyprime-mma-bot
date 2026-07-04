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
            worst = 0.0
            for a in atts:
                b = fetch_bytes(a.get("url") or a.get("proxy_url"))
                if not b:
                    continue
                checked += 1
                worst = max(worst, scorer(b))
            seen.add(mid)
            if worst >= threshold:
                uid = (m.get("author") or {}).get("id")
                if do_delete:
                    c, _ = common.discord("DELETE", "/channels/%s/messages/%s" % (ch, mid))
                    if c in (200, 204):
                        removed += 1
                if do_warn and mod_log:
                    common.post_message(
                        mod_log,
                        "🔞 Removed a likely-NSFW image from <@%s> in <#%s> (confidence %.0f%%)."
                        % (uid, ch, worst * 100), allowed_mentions={"parse": []})
                print("nsfw image removed:", mid, "score", round(worst, 3))

    state["seen"] = sorted(seen)[-3000:]
    common.save_json(common.state_path(STATE_FILE), state)
    if removed:
        common.persist_state(STATE_FILE)
    print("Image scan cycle done. checked=%d removed=%d" % (checked, removed))


def main():
    common.run_loop(poll_once)


if __name__ == "__main__":
    main()
