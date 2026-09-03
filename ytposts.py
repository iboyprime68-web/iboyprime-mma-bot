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

Aug 19 2026 rework (the owner: "the studio keeps giving me the same old news
over and over", five Makhachev posts with the same promo cutout in 26 hours,
pings at 4:21am): staging now has a MEMORY. state_news.json carries a
staged_hist window and stage_gate() refuses rehash junk, stale stories, and
anything that shares a subject or story with a recent staged post; the promo
cutout for a given fighter rests for days between uses (cutout_blocked);
photoless posters rotate their texture plate per story (pick_plate); Google
News links resolve to the REAL article first (gnews.decode) so the story's
own photo wins over the eternal mugshot; and the owner ping respects quiet
hours (quiet_now).

Std-lib only at import time. Pillow is required only at render time; when it
is missing the story stages as text-only (caption, no graphic).
"""
import hashlib, json, os, re, tempfile, time, urllib.request

import common, gnews, newsconfig, notify, scorer

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


def match_fighters(text, name_map):
    """Every octagon id whose name occurs in `text` as whole words, ordered by
    position (earliest first - the SUBJECT of a headline is the fighter named
    FIRST: "Garry eyes ... before Makhachev title fight" is a Garry story).
    At one position the longer name wins the tie. Case-insensitive,
    apostrophe-normalized, de-duplicated. Pure."""
    t = " ".join((text or "").lower().replace(chr(0x2019), "'").split())
    if not t or not name_map:
        return []
    found = []
    for name, fid in (name_map or {}).items():
        m = re.search(r"(?<![a-z0-9])" + re.escape(name) + r"(?![a-z0-9])", t)
        if m:
            found.append((m.start(), -len(name), fid))
    out = []
    for _pos, _neg, fid in sorted(found):
        if fid not in out:
            out.append(fid)
    return out


def match_fighter(text, name_map):
    """The single best match from match_fighters, or "". Pure."""
    ids = match_fighters(text, name_map)
    return ids[0] if ids else ""


def cutout_blocked(fid, hist, now, days=7):
    """True while `fid`'s promo cutout is resting: it fronted a staged post
    within the last `days` days (staged_hist entries carry img="cutout:<id>").
    The rest is what stops one champion's mugshot fronting every story about
    him for a week straight. Pure."""
    if not fid or days <= 0:
        return False
    tag = "cutout:" + str(fid)
    for h in hist or []:
        if (h or {}).get("img") != tag:
            continue
        ts = common.parse_iso(h.get("ts"))
        if ts is not None and (now - ts).total_seconds() <= days * 86400:
            return True
    return False


def fighter_cutout(text, hist=None, now=None, days=7):
    """Resolve a fighter named in `text` to a downloaded promo-cutout temp
    file, skipping fighters whose cutout is resting (cutout_blocked). Returns
    (path, fighter_id) or ("", ""). One rankings GET per call; never raises."""
    try:
        code, data = common.get_json(RANKINGS_API, tries=2, timeout=10)
        if code != 200:
            return "", ""
        for fid in match_fighters(text, build_name_map(data)):
            if (hist is not None and now is not None
                    and cutout_blocked(fid, hist, now, days)):
                continue
            code, f = common.get_json(FIGHTER_API % fid, tries=2, timeout=10)
            if code != 200 or not isinstance(f, dict):
                continue
            url = str(f.get("imgUrl") or "")
            if not url.startswith("http"):
                continue
            raw = fetch_bytes(url)
            if not raw:
                continue
            fd, path = tempfile.mkstemp(suffix=".png")
            with os.fdopen(fd, "wb") as fh:
                fh.write(raw)
            return path, fid
        return "", ""
    except Exception:
        return "", ""


# ---- staging memory (the "same old news over and over" fix) ----------------
# state_news.json carries staged_hist: the last STAGED_HIST_CAP staged posts as
# {ts, t (title), names (lowercased name tokens), img (photo|cutout:<id>|wash|
# none)}. stage_gate reads it, remember_staged writes it, news_bot caps it in
# save(). Measured against the live studio channel on Aug 19 2026, these gates
# turn the 5 Makhachev posts staged in 26h into 2, and kill both duplicated
# Magny/Barboza pairs - exactly the owner's complaint.
STAGED_HIST_CAP = 40

GATE_DEFAULTS = {
    "stage_max_age_hours": 36,      # older stories never stage (rehash net #1)
    "subject_cooldown_hours": 12,   # 1+ shared name: same person, wait
    "story_cooldown_hours": 72,     # 2+ shared names / similar title: same story
    "staged_similar": 0.5,          # token-Jaccard vs staged titles (lower than
                                    # the channel's 0.6 - staging must be pickier)
    "cutout_cooldown_days": 7,      # a fighter's promo mugshot rests this long
    "quiet_hours_utc": [21, 8],     # owner pings sleep 21:00-07:59 UTC
}


def _gate(scfg, key):
    """One gate setting from the scoring config, falling back to
    GATE_DEFAULTS. Junk -> default."""
    try:
        v = (scfg or {}).get(key, GATE_DEFAULTS[key])
        return float(v)
    except (TypeError, ValueError):
        return float(GATE_DEFAULTS[key])


def name_tokens(text):
    """Lowercased name-like tokens (fighter surnames, mostly) from a title or
    poster line, possessives stripped, stop-words out. This is what two
    stories about the same people share even when every other word differs
    ("Magny dismisses retirement talk" / "Magny wins record 25th").

    A run of exactly TWO adjacent name tokens is one PERSON ("Islam
    Makhachev", "Ian Garry") and collapses to the surname - otherwise the
    first+last pair counts as 2 shared names and trips stage_gate's
    same-STORY rule (which no breaking follow-up may override) when the truth
    is merely the same SUBJECT (which one may). Longer runs are kept whole:
    they are almost always Title-Case Headline Words, not names, and
    collapsing them would throw away the very tokens two rewrites of one
    story share. Pure."""
    runs, run = [], []
    last_end = None
    for m in scorer.NAME_RE.finditer(text or ""):
        w = m.group(0)
        if w in scorer.NAME_STOP:
            if run:
                runs.append(run)
                run = []
            last_end = None
            continue
        adjacent = (last_end is not None
                    and (text[last_end:m.start()] or "").strip() == ""
                    and m.start() - last_end <= 2)
        if run and not adjacent:
            runs.append(run)
            run = []
        run.append(w)
        last_end = m.end()
    if run:
        runs.append(run)
    out = []
    for r in runs:
        # "Islam Makhachev" is one person -> surname. "Magny's Corner" is a
        # name plus the thing it owns -> keep both, or the name itself is lost.
        two_name = (len(r) == 2
                    and not r[0].endswith(("'s", chr(0x2019) + "s")))
        keep = [r[-1]] if two_name else r
        for w in keep:
            lw = w.lower().replace(chr(0x2019), "'")
            if lw.endswith("'s"):
                lw = lw[:-2]
            lw = lw.strip("'-")
            if len(lw) >= 3 and lw not in out:
                out.append(lw)
    return out[:8]


def stage_gate(it, score, breaking, hist, now, scfg):
    """(ok, reason) - may this scored story stage? Applied AFTER scoring (the
    breaking/ping exception needs the score) and BEFORE any rendering.

    Refuses, in order: service-journalism rehash (watch guides, results
    roundups - the news channel still posts them, the studio never does),
    stale stories (Google's search feed surfaces re-hashes of days-old events
    with fresh pubdates), a REWRITE of a recently staged story (title
    similarity within story_cooldown_hours - never overridden, a rehash is a
    rehash even when its subject is big news), the same PEOPLE again within
    story_cooldown_hours (2+ shared name tokens), and the same SUBJECT again
    within subject_cooldown_hours (1+ shared name token).

    The BREAKING keyword net overrides the name-based rules (and the junk
    gate) but never the similarity rule: "Gaethje pulls out of Tsarukyan
    fight" names the same two people as the booking staged yesterday and MUST
    reach the studio, while "Makhachev retains title" reworded by a fifth
    outlet must not. The AI score deliberately cannot override anything:
    measured live, the model hands 85+ to event-adjacent rehash, which is
    exactly the drip these cooldowns exist to stop; the breaking keyword net
    is deterministic and names real developments only. Pure."""
    title = str(it.get("title") or "")
    big = bool(breaking)
    if not big and scorer.is_junk(title):
        return False, "junk (watch guide / results rehash)"
    when = it.get("when")
    max_age = _gate(scfg, "stage_max_age_hours")
    if when is not None and max_age > 0:
        try:
            age_h = (now - when).total_seconds() / 3600.0
        except Exception:
            age_h = 0.0
        if age_h > max_age:
            return False, "stale (%dh old)" % int(age_h)
    names = set(name_tokens("%s %s" % (title, it.get("line") or "")))
    sim_thr = _gate(scfg, "staged_similar")
    subject_h = _gate(scfg, "subject_cooldown_hours")
    story_h = _gate(scfg, "story_cooldown_hours")
    # For a BREAKING story only a near-verbatim rewrite counts as the same
    # story: two short titles about the same pair share most of their tokens
    # anyway ("Gaethje pulls out of Tsarukyan fight" scores 0.6 against the
    # booking it follows up), so the normal bar would eat exactly the
    # follow-ups the breaking net exists to let through. A true rewrite of
    # one headline sits at 0.8+.
    thr_eff = max(sim_thr, 0.75) if big else sim_thr
    for h in reversed(list(hist or [])):
        ts = common.parse_iso((h or {}).get("ts"))
        if ts is None:
            continue
        age = (now - ts).total_seconds() / 3600.0
        if age > max(story_h, subject_h):
            continue
        if (age <= story_h
                and newsconfig.similar(title, h.get("t", "")) >= thr_eff):
            return False, "same story staged %dh ago" % int(age)
        if big:
            continue                 # breaking overrides every name-based rule
        shared = len(names & set(h.get("names") or []))
        if shared >= 2 and age <= story_h:
            return False, "same people staged %dh ago" % int(age)
        if shared >= 1 and age <= subject_h:
            return False, "same subject staged %dh ago" % int(age)
    return True, ""


def remember_staged(state, it, img, now):
    """Append one staged post to state["staged_hist"] (capped). Called by
    news_bot right after stage_story; the state file rides the normal
    save()/persist_state path."""
    hist = state.setdefault("staged_hist", [])
    hist.append({
        "ts": now.isoformat(),
        "t": str(it.get("title") or "")[:200],
        "names": name_tokens("%s %s" % (it.get("title") or "",
                                        it.get("line") or "")),
        "img": str(img or "none")[:80],
    })
    state["staged_hist"] = hist[-STAGED_HIST_CAP:]


# Texture plates for photoless/cutout posters - MUST mirror
# postcard.BACKGROUNDS (a selftest pins the two lists together; postcard is
# not imported here because it needs Pillow at import time and ytposts must
# stay importable without it). Purple stays the only colorway (owner law:
# purple IS the brand) - the PLATE is what varies, so two wash posters in a
# row stop being pixel-identical scenes.
PLATES = ("arena", "spotlight", "cage", "smoke")


def pick_plate(guid):
    """Deterministic texture plate for one story: same story -> same plate,
    the feed as a whole rotates. Pure."""
    h = hashlib.sha256(str(guid or "").encode("utf-8")).hexdigest()
    return PLATES[int(h[:8], 16) % len(PLATES)]


def quiet_now(scfg, now):
    """True while the owner ping is asleep. quiet_hours_utc is [start, end)
    in UTC hours; a window may wrap midnight ([21, 8] = 21:00-07:59). The
    POST still happens - silently - so the post is waiting in the studio in
    the morning; only the 4am mention dies. Junk config -> never quiet. Pure."""
    qh = (scfg or {}).get("quiet_hours_utc", GATE_DEFAULTS["quiet_hours_utc"])
    if not isinstance(qh, (list, tuple)) or len(qh) != 2:
        return False
    try:
        a, b = int(qh[0]) % 24, int(qh[1]) % 24
    except (TypeError, ValueError):
        return False
    if a == b:
        return False
    h = now.hour
    return (a <= h < b) if a < b else (h >= a or h < b)


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


def studio_spec(it, kind, bg=""):
    """The ```json spec fence the Worker parses back out for the studio's
    staged rail (worker.js stagedParts). This is what makes a staged post
    ROUND-TRIP: the studio re-renders the text live from these fields instead
    of showing the rendered card's baked-in pixels. `kind` says what the
    SECOND attachment is ("photo" = the raw story photo, "cutout" = the
    octagon promo cutout, "" = card only); `bg` is the texture plate a
    photoless render sat on, so the studio reopens the same scene. Pure."""
    spec = {
        "line": " ".join(str(it.get("line") or "").split())[:200],
        "hot": [str(h)[:60] for h in (it.get("hot") or []) if str(h or "").strip()][:8],
        "source": " ".join(str(it.get("source") or "").split())[:80],
        "emphasis": str(it.get("emphasis") or "")[:20],
        "guid": str(it.get("guid") or "")[:200],
        "template": "news",
        "colorway": "purple",
        "photo": kind,
        "bg": str(bg or "")[:20],
    }
    return json.dumps({k: v for k, v in spec.items() if v}, ensure_ascii=True)


def _studio_body(score, why, caption, ping_uid, note="", spec_json=""):
    head = "<@%s> " % ping_uid if ping_uid else ""
    spec = ("\n```json\n%s\n```" % spec_json) if spec_json else ""
    return ("%sStaged post - score %d (%s)\n"
            "Copy the caption, save the image, then post or schedule it in "
            "the YouTube app.\n%s```\n%s\n```%s"
            % (head, score, why, note, caption, spec))


def _deep_link(chan, resp, body, newscfg):
    """PATCH a just-staged message to append its own open-in-the-studio link
    (the message id only exists after the POST). Fail-silent: a missing url,
    a non-dict response or an over-long body just leaves the message as-is."""
    try:
        mid = str((resp or {}).get("id") or "") if isinstance(resp, dict) else ""
        surl = str(newscfg.get("studio_url") or "").strip()
        # same character rules the validator enforces: the url is <>-wrapped
        # and gains its own #fragment, so whitespace/<>/# would corrupt it
        if (not mid or not surl.startswith("https://")
                or re.search(r"[\s<>#]", surl)):
            return
        extra = "\nOpen in the studio: <%s#s=%s>" % (surl, mid)
        if len(body) + len(extra) <= 1990:
            common.edit_message(chan, mid, body + extra)
    except Exception:
        pass


def stage_story(it, score, why, cfg_bots, newscfg, hist=None, state=None):
    """Render + post one staged story to the studio channel. Returns
    {"status": short ASCII string, "img": what fronted the card - "photo",
    "cutout:<octagon id>", "wash", or "none" (text-only stage)}; NEVER raises
    (news delivery must not notice us). The caller records "img" into
    staged_hist so cutout_blocked can rest a fighter's mugshot."""
    try:
        chan = (cfg_bots.get("channels", {}) or {}).get("studio")
        if not chan:
            return {"status": "no studio channel - run a deploy", "img": "none",
                    "ok": False}
        scoring = (newscfg.get("scoring", {}) or {})
        now = common.now_utc()
        ping_uid = ""
        # quiet hours kill the MENTION, never the post: the story still lands
        # in the studio silently and is waiting in the morning (the owner was
        # pinged at 4:21am, which is what this exists to stop)
        if score >= int(scoring.get("ping_threshold", 85)) and not quiet_now(scoring, now):
            # ONE BUZZ PER STORY. The news wire alerts on the same story from its
            # own (heuristic) tier, so without this shared ledger a story scoring
            # 92 produced a news mention AND a studio mention - two notifications
            # for one piece of news. The news post drains first and claims it, so
            # the fast alert is the one that fires. `state` is optional so the
            # existing test callers and any direct use keep working unchanged.
            if state is None or notify.claim(state, it.get("guid", ""),
                                             time.time(), newscfg):
                ping_uid = str(cfg_bots.get("owner_id", "") or "")

        caption = build_caption(it.get("title"), it.get("desc"), it.get("source"))
        mentions = ({"parse": [], "users": [ping_uid]} if ping_uid else None)
        silent = not ping_uid    # a ping must never ride a silent message

        img_path = ""
        photo_path = ""
        cutout_path = ""
        cut_fid = ""
        plate = pick_plate(it.get("guid"))
        try:
            # Google News links only resolve in a browser; decode() turns one
            # into the REAL article URL so the story's own og:image wins over
            # the promo-cutout fallback. Fail-silent: "" keeps the old path.
            link = gnews.decode(it.get("link")) or it.get("link")
            photo_url = og_image(link)
            if photo_url:
                raw = fetch_bytes(photo_url)
                if raw:
                    fd, photo_path = tempfile.mkstemp(suffix=".img")
                    with os.fdopen(fd, "wb") as f:
                        f.write(raw)
            if not photo_path:
                cutout_path, cut_fid = fighter_cutout(
                    "%s %s" % (it.get("line") or "", it.get("title") or ""),
                    hist=hist, now=now,
                    days=int(_gate(scoring, "cutout_cooldown_days")))
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
                # photoless/cutout posters rotate their texture plate per
                # story - purple stays the only hue (owner law), the SCENE is
                # what varies
                "background": plate,
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
        img_kind = ("none" if not img_path else
                    "photo" if photo_path else
                    ("cutout:" + cut_fid) if cutout_path else "wash")
        body = _studio_body(score, why, caption, ping_uid,
                            retention_note(newscfg),
                            spec_json=studio_spec(it, raw_kind if img_path else "",
                                                  bg="" if photo_path else plate))
        if img_path:
            files = [(img_path, "post.png")]
            if photo_path:
                files.append((photo_path, "photo.jpg"))
            elif cutout_path:
                files.append((cutout_path, "cutout.png"))
            code, resp = common.post_file(chan, body, files,
                                          allowed_mentions=mentions, silent=silent)
        else:
            code, resp = common.post_message(chan, body,
                                             allowed_mentions=mentions, silent=silent)
        if code in (200, 201):
            _deep_link(chan, resp, body, newscfg)
        for tmp in (img_path, photo_path, cutout_path):
            if tmp:
                try: os.remove(tmp)
                except OSError: pass
        return {"status": "staged (HTTP %s)%s" % (code, " with ping" if ping_uid else ""),
                "img": img_kind, "ok": code in (200, 201)}
    except Exception as e:
        return {"status": "stage failed (%s)" % type(e).__name__, "img": "none",
                "ok": False}
