#!/usr/bin/env python3
"""Prime Arena - Bot #2: MMA news wire (v3 - quiet by default).

Polls the outlets configured in newsconfig.json and posts to #mma-news with a
CLEAN, notification-friendly format: the message text is just
    Headline (Source)
(what a phone lock-screen shows - no markdown junk, no URL) and the link,
summary, category colour and timestamp live in an embed.

Delivery is governed by newsconfig.json ("mode"):
  realtime - every kept article posts loud (no ping).
  hybrid   - routine articles post SILENT (Discord flag 4096: no push/sound,
             unread badge only); BREAKING articles post loud + ping the
             📰 News Pings role; a daily digest posts loud + pings 🗞️ Digest Ping.
  digest   - routine articles are only queued for the digest; breaking still
             posts loud immediately.

Volume control: at most PACE_PER_CYCLE post per ~1-min cycle, an hourly cap
(max_per_hour - in hybrid mode overflow is diverted to the digest instead of
posted), duplicate-story collapsing across outlets (token-Jaccard similarity),
betting/odds content always excluded (server rule), category filtering (owner
is UFC-focused; stories explicitly about other orgs/boxing are dropped unless
re-enabled). De-dupes by GUID in committed state; state is committed right
after each post so a mid-run crash never re-posts. Std-lib only.

NEAR-INSTANT (July 2026): on Actions the job polls every ~POLL_SECONDS so a story
posts within ~20s of hitting the feed, instead of waiting out GitHub's 5-minute
cron floor.

THE CRON MUST NOT FIRE DURING THE WINDOW (Aug 2026 - this is the fix for a real
email flood). The window used to sit on a */5 cron, on the theory that the
concurrency group would queue the extra ticks and run them back to back. It does
not work that way: GitHub keeps at most ONE pending run per group and CANCELS the
previously pending one when a newer tick arrives. Every displaced run mails the
owner "Run failed - All jobs were cancelled" (10 of them from this workflow on
Aug 4, a day when GitHub delivered ticks in catch-up bursts). news.yml is hourly
now, so one tick starts one 55-minute window and the next tick arrives after it
has finished. Nothing ever queues, so nothing is ever cancelled. If you change
WINDOW_SECONDS or the cron, keep that relationship: window + ~1 min of overhead
must stay under the cron period.

Coverage went UP, not down: GitHub was only honouring ~12 of the 288 daily */5
ticks (measured Aug 5), so the old setup actually ran about 46% of the day. One
honoured tick per hour holding a 55-minute window is ~92%.

The loop also git-pulls the checkout ~once a minute so newsconfig.json edits made
while the job runs (panel Save & Deploy, /news) apply almost immediately. Free
because the repo is public. Run locally it is still a single pass.
"""
import datetime, email.utils, time, xml.etree.ElementTree as ET
import common, layout, newsconfig, scorer, ytposts

PACE_PER_CYCLE = 1     # at most ONE realtime post per cycle - never a burst
SEED_POST      = 5     # on the very first run, post this many latest
MAX_SEEN       = 1200  # cap state size
MAX_RECENT     = 120   # cap the similarity window size
MAX_DIGEST     = 60    # cap the digest queue
STATE_FILE     = "state_news.json"
POLL_SECONDS   = 20    # feed check cadence inside one job ("pretty much instant")
WINDOW_SECONDS = 3300  # ~55 min per job. The CRON is what had to change (news.yml is
                       # hourly now, not */5): a window this long on a 5-minute cron
                       # left a run pending on the concurrency group, and GitHub
                       # cancels a pending run the moment a third tick arrives.
REFRESH_EVERY  = 3     # git-pull the checkout every N cycles (~1/min) for config edits


def _local(tag):
    return tag.split("}", 1)[-1].lower() if tag else ""


def _find_text(item, names):
    for ch in item:
        if _local(ch.tag) in names and (ch.text or "").strip():
            return ch.text.strip()
    return ""


def _find_link(item):
    # RSS: <link>url</link>  |  Atom: <link href=".." rel="alternate"/>
    atom = None
    for ch in item:
        if _local(ch.tag) != "link":
            continue
        if (ch.text or "").strip():
            return ch.text.strip()
        href = ch.attrib.get("href")
        if href:
            if ch.attrib.get("rel", "alternate") == "alternate":
                return href
            atom = atom or href
    return atom or ""


def _pubdate(item):
    raw = _find_text(item, {"pubdate", "published", "updated", "date"})
    if not raw:
        return common.now_utc()
    try:
        dt = email.utils.parsedate_to_datetime(raw)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=datetime.timezone.utc)
        return dt.astimezone(datetime.timezone.utc)
    except Exception:
        return common.parse_iso(raw) or common.now_utc()


def parse_feed(text):
    """Return list of dicts {guid,title,link,when,desc} from RSS or Atom XML."""
    items = []
    try:
        root = ET.fromstring(text.encode("utf-8") if isinstance(text, str) else text)
    except Exception:
        return items
    for el in root.iter():
        if _local(el.tag) not in ("item", "entry"):
            continue
        title = common.clean(_find_text(el, {"title"}))
        link = _find_link(el)
        guid = _find_text(el, {"guid", "id"}) or link
        if not title or not link:
            continue
        desc = common.truncate(common.clean(_find_text(el, {"description", "summary"})), 220)
        items.append({"guid": guid, "title": title, "link": link,
                      "when": _pubdate(el), "desc": desc,
                      "src_name": common.clean(_find_text(el, {"source"}))})
    return items


def apply_flavor(items, flavor, label):
    """Source-specific cleanup (pure, tested).
    google_news: titles arrive as 'Headline - Publisher' with the publisher also
    in the item's <source> tag - strip the suffix and credit the real outlet, so
    posts read 'via ESPN' instead of 'via Google News'.
    nitter: drop retweets/replies ('RT by @x:' / 'R to @x:'), keep the account
    label as the source, and trim the tweet text into a headline."""
    out = []
    for it in items:
        if flavor == "google_news":
            src = it.get("src_name") or ""
            if src and it["title"].endswith(" - " + src):
                it["title"] = it["title"][: -(len(src) + 3)].rstrip()
            it["display_source"] = src or label
        elif flavor == "nitter":
            t = it["title"]
            if t.startswith("RT by ") or t.startswith("R to "):
                continue
            it["title"] = common.truncate(common.clean(t), 150)
            it["display_source"] = label
        out.append(it)
    return out


# flavor -> (tries, timeout). Fragile sources must never stall the 20s cycle:
# nitter gets ONE try on a short clock, google_news is a search endpoint so it
# gets a modest budget, plain feeds keep the old patient defaults.
FETCH_PROFILES = {"nitter": (1, 8), "google_news": (2, 15)}
FAIL_BACKOFF = 300     # seconds to sit out a source after a failed fetch


# ---- pure builders (unit-tested) --------------------------------------------
def build_message(it, cfg, breaking, ping_role_id):
    """(content, embeds, allowed_mentions, category). Content is the push preview:
    plain 'Headline (Source)', no markdown, no URL."""
    cat = newsconfig.classify(it["title"], cfg)
    head = common.truncate(common.strip_markdown(it["title"]), 150)
    content = "%s (%s)" % (head, it["source"])
    mentions = None                       # None -> common.NO_PINGS default
    if breaking:
        content = "🚨 " + content
        if ping_role_id:
            content = "<@&%s> %s" % (ping_role_id, content)
            mentions = {"parse": [], "roles": [str(ping_role_id)]}
    cat_cfg = (cfg.get("categories", {}) or {}).get(cat, {})
    embed = {"title": common.truncate(it["title"], 256),
             "url": it["link"],
             "color": int(cat_cfg.get("color", 0xD20A0A)),
             "footer": {"text": "%s · %s" % (it["source"], cat_cfg.get("label", cat))}}
    if it.get("desc"):
        embed["description"] = it["desc"]
    when = it.get("when")
    if when:
        embed["timestamp"] = when.isoformat()
    return content, [embed], mentions, cat


def build_digest(items, cfg, ping_role_id):
    """(content, embeds, allowed_mentions) for the daily digest - one embed with a
    field per category, lines '[Title](url), Source'. Respects Discord's embed
    limits (field value 1024, total ~6000 -> capped at 5500)."""
    now = common.now_utc()
    content = "Today's combat sports digest: %d stories" % len(items)
    mentions = None
    if (cfg.get("digest", {}) or {}).get("ping", True) and ping_role_id:
        content = "<@&%s> %s" % (ping_role_id, content)
        mentions = {"parse": [], "roles": [str(ping_role_id)]}
    cats = cfg.get("categories", {}) or {}
    by_cat = {}
    for it in items:
        by_cat.setdefault(it.get("cat", "ufc"), []).append(it)
    fields, total = [], 0
    for key in list(newsconfig._CLASSIFY_ORDER)[::-1] + sorted(k for k in by_cat if k not in newsconfig._CLASSIFY_ORDER):
        group = by_cat.get(key)
        if not group:
            continue
        label = (cats.get(key) or {}).get("label", key)
        name = "%s (%d)" % (label, len(group))
        lines, used, more = [], 0, 0
        for it in group:
            line = "[%s](%s), %s" % (common.truncate(it["title"], 80), it["url"], it["source"])
            if used + len(line) + 1 > 1000 or total + used > 5200:
                more += 1
                continue
            lines.append(line); used += len(line) + 1
        if more:
            lines.append("*…and %d more*" % more)
        value = "\n".join(lines) or "*(none)*"
        total += len(name) + len(value)
        if total > 5500:
            break
        fields.append({"name": name, "value": value})
    day = now.strftime("%B %d").replace(" 0", " ")   # "July 03" -> "July 3" (portable)
    embed = {"title": "Daily Digest: %s" % day,
             "color": 0xD20A0A, "fields": fields,
             "footer": {"text": "%s news wire" % layout.SERVER_NAME}}
    return content, [embed], mentions


def digest_due(now, times_utc, last_stamp):
    """The stamp of the latest digest time that has passed today and wasn't posted
    yet, else None. Catch-up semantics: a delayed cron posts late rather than never."""
    hhmm = now.strftime("%H:%M")
    due = None
    for t in sorted(str(x) for x in (times_utc or [])):
        if hhmm >= t:
            due = "%s %s" % (now.strftime("%Y-%m-%d"), t)
    return due if (due and due != last_stamp) else None


def migrate_state(state):
    """v2 -> v3 keeps `seen` intact (NO repost storm). Fresh/legacy states fall
    through to the normal first-run seeding path."""
    if state.get("v") == 3:
        return state
    if state.get("v") == 2 and state.get("initialized"):
        state.update({"v": 3, "recent": [], "digest_items": [], "digest_last": "",
                      "hour": ["", 0]})
    return state


def main():
    cfg_bots = common.load_config()
    chan = cfg_bots.get("channels", {}).get("mma_news")
    if not chan:
        print("No mma_news channel in config - run bots_setup.py."); return
    roles = cfg_bots.get("roles", {}) or {}
    news_rid, digest_rid = roles.get("news_pings"), roles.get("digest_ping")
    state = migrate_state(common.load_json(common.state_path(STATE_FILE), {}))
    seen = set(state.get("seen", []))

    next_ok = {}   # source key -> monotonic time before which we skip it

    def fetch_fresh(cfg):
        """Pull enabled feeds, drop already-seen, de-dupe by guid, oldest-first.
        Honors each source's min_poll (search endpoints are not hammered at the
        20s cycle cadence) and backs off failed sources for FAIL_BACKOFF so a
        dead nitter or a blocking CDN can never eat the cycle budget."""
        fresh = []
        now_m = time.monotonic()
        srcs = cfg.get("sources", {}) or {}
        for key, label, url in newsconfig.enabled_sources(cfg):
            if now_m < next_ok.get(key, 0.0):
                continue
            opts = srcs.get(key, {}) or {}
            flavor = opts.get("flavor", "")
            tries, timeout = FETCH_PROFILES.get(flavor, (4, 30))
            code, text = common.get_text(url, tries=tries, timeout=timeout)
            if code != 200 or not text:
                next_ok[key] = now_m + FAIL_BACKOFF
                print("  feed skipped (%s): HTTP %s" % (label, code)); continue
            next_ok[key] = now_m + float(opts.get("min_poll", 0) or 0)
            items = apply_flavor(parse_feed(text), flavor, label)
            print("  %s: %d items" % (label, len(items)))
            for it in items:
                if it["guid"] in seen:
                    continue
                it["source"] = it.get("display_source") or label
                fresh.append(it)
        uniq = {}
        for it in fresh:
            uniq.setdefault(it["guid"], it)
        return sorted(uniq.values(), key=lambda x: x["when"])

    def save():
        state["seen"] = sorted(seen)[-MAX_SEEN:]
        state["initialized"] = True
        state["v"] = 3
        state["recent"] = state.get("recent", [])[-MAX_RECENT:]
        state["digest_items"] = state.get("digest_items", [])[-MAX_DIGEST:]
        state["yt_eval"] = state.get("yt_eval", [])[-MAX_SEEN:]
        state["staged_hist"] = state.get("staged_hist", [])[-ytposts.STAGED_HIST_CAP:]
        common.save_json(common.state_path(STATE_FILE), state)
        common.persist_state(STATE_FILE)       # durable now, so a crash won't re-post

    # Set whenever maybe_stage touched state (yt_eval, budgets, staged_hist);
    # poll_once's save gate reads it. Without it, a cycle whose ONLY event was
    # a staging (e.g. the news post itself failed, or realtime is at the hour
    # cap) ended with posted=queued=skipped=0, save() never ran, and the NEXT
    # job re-scored and re-staged the same story - a duplicate studio post,
    # the exact class the staging memory exists to prevent.
    stage_work = [0]

    def maybe_stage(it, cat, breaking, cfg):
        """Score a new kept story and stage it for YouTube when it clears the
        bar. One evaluation per guid ever (yt_eval); never raises, never blocks
        news delivery. Breaking stories always stage - the keyword net is a
        strong signal even when no AI key is configured."""
        try:
            sc_cfg = cfg.get("scoring", {}) or {}
            if not sc_cfg.get("enabled", True):
                return
            if it["guid"] in state.get("yt_eval", []):
                return
            state.setdefault("yt_eval", []).append(it["guid"])
            stage_work[0] += 1
            scfg = scorer.scoring_config(cfg)
            scfg["breaking_keywords"] = cfg.get("breaking_keywords") or []
            today = common.now_utc().strftime("%Y-%m-%d")
            if not scorer.under_cap(state, scfg, today, "staged"):
                print("  yt: daily staged cap reached, skipping: %s"
                      % it["title"][:60])
                return
            res = scorer.score_story_budgeted(it["title"], it.get("desc", ""),
                                              it["source"], cat, scfg,
                                              state, today)
            score, why = res.get("score", 0), res.get("why", "")
            thr = int(scfg.get("stage_threshold", 70))
            if breaking:
                score = max(score, thr)
            if score < thr:
                print("  yt: below bar (%d): %s" % (score, it["title"][:60]))
                return
            # the scorer's poster line + highlight words ride the item copy
            # into the render spec (ytposts reads it["line"] / it["hot"])
            sit = dict(it)
            sit["line"] = res.get("line", "")
            sit["hot"] = res.get("hot", [])
            sit["emphasis"] = cfg.get("emphasis", "auto")
            # the staging memory: rehash junk, stale stories and repeats of a
            # recently staged story/subject stop HERE (the news channel already
            # posted or skipped this story on its own rules - this gate only
            # protects the studio queue)
            hist = state.get("staged_hist", [])
            now = common.now_utc()
            ok, why_not = ytposts.stage_gate(sit, score, breaking, hist, now, scfg)
            if not ok:
                print("  yt: gate skip (%s): %s" % (why_not, it["title"][:60]))
                return
            res_stage = ytposts.stage_story(sit, score, why, cfg_bots, cfg,
                                            hist=hist)
            status = res_stage.get("status", "")
            # only a post that actually LANDED enters the staging memory or
            # burns a daily slot - a Discord blip or a missing studio channel
            # must not cool down the subject, and six failed posts must not
            # eat the whole max_staged_per_day budget on nothing
            if res_stage.get("ok"):
                ytposts.remember_staged(state, sit, res_stage.get("img", "none"), now)
                scorer.spend(state, today, "staged")
            print("  yt: %s [%d] %s" % (status, score, it["title"][:60]))
        except Exception as e:
            print("  yt: staging error (%s), news unaffected" % type(e).__name__)

    def keep(it, cfg):
        """Apply exclude/category filters. Returns (keep?, breaking?, reason)."""
        title = it["title"]
        if newsconfig.is_excluded(title, cfg):
            return False, False, "excluded"
        breaking = newsconfig.is_breaking(title, cfg)
        cat = newsconfig.classify(title, cfg)
        if not newsconfig.category_enabled(cat, cfg):
            if not (breaking and cfg.get("breaking_ignores_filters", True)):
                return False, breaking, "category off (%s)" % cat
        return True, breaking, ""

    def is_dup(it, cfg):
        if not cfg.get("dedupe_similar", True):
            return False
        thr = float(cfg.get("similar_threshold", 0.6))
        return any(newsconfig.similar(it["title"], r.get("t", "")) >= thr
                   for r in state.get("recent", []))

    def remember(it, cat):
        state.setdefault("recent", []).append(
            {"t": it["title"], "ts": it["when"].isoformat()})
        state.setdefault("digest_items", [])
        return cat

    def queue_digest(it, cat):
        state.setdefault("digest_items", []).append(
            {"title": common.strip_markdown(it["title"]), "url": it["link"],
             "source": it["source"], "cat": cat, "ts": it["when"].isoformat()})

    def prune_recent(cfg, now):
        horizon = now - datetime.timedelta(hours=int(cfg.get("recent_hours", 48)))
        state["recent"] = [r for r in state.get("recent", [])
                           if (common.parse_iso(r.get("ts")) or now) >= horizon]

    cycle = [0]

    def poll_once():
        cycle[0] += 1
        if cycle[0] % REFRESH_EVERY == 1:      # ~1/min: pick up config edits mid-run
            common.refresh_checkout()
        cfg = newsconfig.load()
        mode = cfg.get("mode", "hybrid")
        now = common.now_utc()
        first_run = not state.get("initialized")
        fresh = fetch_fresh(cfg)

        if first_run:
            keepers = [it for it in fresh if keep(it, cfg)[0]]
            newest = sorted(keepers, key=lambda x: x["when"], reverse=True)[:SEED_POST]
            for it in sorted(newest, key=lambda x: x["when"]):
                content, embeds, mentions, cat = build_message(it, cfg, False, None)
                common.post_message(chan, content, allowed_mentions=mentions,
                                    embeds=embeds, silent=(mode != "realtime"))
                remember(it, cat)
            for it in fresh:                   # mark the rest seen so we don't back-dump later
                seen.add(it["guid"])
            save()
            print("First run: posted %d latest article(s), seeded %d." % (len(newest), len(fresh)))
            return

        prune_recent(cfg, now)
        hour_key = now.strftime("%Y-%m-%dT%H")
        hour = state.get("hour") or ["", 0]
        if hour[0] != hour_key:
            hour = [hour_key, 0]
        state["hour"] = hour

        posted = queued = skipped = 0
        for it in fresh:
            if posted >= PACE_PER_CYCLE:
                break                                          # rest stays unseen -> next cycle
            ok, breaking, reason = keep(it, cfg)
            if not ok:
                seen.add(it["guid"]); skipped += 1
                print("  skip (%s): %s" % (reason, it["title"][:60]))
                continue
            if is_dup(it, cfg):
                seen.add(it["guid"]); skipped += 1
                print("  skip (dup story): %s" % it["title"][:60])
                continue
            cat = newsconfig.classify(it["title"], cfg)
            maybe_stage(it, cat, breaking, cfg)
            if mode == "digest" and not breaking:
                seen.add(it["guid"]); remember(it, cat); queue_digest(it, cat); queued += 1
                continue
            if not breaking and hour[1] >= int(cfg.get("max_per_hour", 6)):
                if mode == "hybrid":                           # overflow -> digest, channel stays calm
                    seen.add(it["guid"]); remember(it, cat); queue_digest(it, cat); queued += 1
                    continue
                break                                          # realtime: drain next hour
            content, embeds, mentions, cat = build_message(it, cfg, breaking,
                                                           news_rid if breaking else None)
            # A post is only worth being "loud" if it actually pings someone. The
            # 📰 News Pings / 🗞️ Digest Ping roles were deleted in the Aug 2026
            # declutter, so news_rid is None and even breaking stories post silently -
            # a loud message with no mention is just an unread badge anyway.
            silent = (mode == "hybrid" and not (breaking and news_rid))
            code, _ = common.post_message(chan, content, allowed_mentions=mentions,
                                          embeds=embeds, silent=silent)
            if code in (200, 201):
                seen.add(it["guid"]); remember(it, cat); posted += 1; hour[1] += 1
                if mode == "hybrid" and not breaking:
                    queue_digest(it, cat)
                print("posted%s: %s - %s" % (" BREAKING" if breaking else ("" if not silent else " (silent)"),
                                             it["source"], it["title"][:70]))
            else:
                print("post failed (%s), will retry: %s" % (code, it["title"][:60]))
        if posted or queued or skipped or stage_work[0]:
            save()
            stage_work[0] = 0

        # ---- daily digest (catch-up: a delayed cron posts late, never twice) ----
        if mode in ("hybrid", "digest"):
            dcfg = cfg.get("digest", {}) or {}
            stamp = digest_due(now, dcfg.get("times_utc"), state.get("digest_last", ""))
            if stamp:
                items = state.get("digest_items", [])
                if len(items) >= int(dcfg.get("min_items", 3)):
                    content, embeds, mentions = build_digest(items, cfg, digest_rid)
                    code, _ = common.post_message(chan, content, allowed_mentions=mentions,
                                                  embeds=embeds, silent=not digest_rid)
                    print("digest posted (%d stories): HTTP %s" % (len(items), code))
                else:
                    print("digest window %s: only %d item(s), skipping." % (stamp, len(items)))
                state["digest_last"] = stamp
                state["digest_items"] = []
                save()
        print("cycle done. posted=%d queued=%d skipped=%d backlog~%d"
              % (posted, queued, skipped, max(0, len(fresh) - posted - queued - skipped)))

    common.run_loop(poll_once, duration=WINDOW_SECONDS, interval=POLL_SECONDS)


if __name__ == "__main__":
    main()
