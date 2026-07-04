#!/usr/bin/env python3
"""Prime Arena - Bot #2: MMA news wire (v3 - quiet by default).

Polls the outlets configured in newsconfig.json and posts to #mma-news with a
CLEAN, notification-friendly format: the message text is just
    Headline — Source
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

NEAR-INSTANT (July 2026): on Actions the job now polls every ~POLL_SECONDS for a
~55-minute window (the */5 cron just re-queues the next window via the concurrency
group, so coverage is continuous) - a story posts within ~20s of hitting the feed.
The loop also git-pulls the checkout ~once a minute so newsconfig.json edits made
while the job runs (panel Save & Deploy, /news) apply almost immediately. Free
because the repo is public. Run locally it is still a single pass.
"""
import datetime, email.utils, xml.etree.ElementTree as ET
import common, newsconfig

PACE_PER_CYCLE = 1     # at most ONE realtime post per cycle - never a burst
SEED_POST      = 5     # on the very first run, post this many latest
MAX_SEEN       = 1200  # cap state size
MAX_RECENT     = 120   # cap the similarity window size
MAX_DIGEST     = 60    # cap the digest queue
STATE_FILE     = "state_news.json"
POLL_SECONDS   = 20    # feed check cadence inside one job ("pretty much instant")
WINDOW_SECONDS = 3300  # ~55 min per job; cron re-queues so coverage is continuous
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
                      "when": _pubdate(el), "desc": desc})
    return items


# ---- pure builders (unit-tested) --------------------------------------------
def build_message(it, cfg, breaking, ping_role_id):
    """(content, embeds, allowed_mentions, category). Content is the push preview:
    plain 'Headline — Source', no markdown, no URL."""
    cat = newsconfig.classify(it["title"], cfg)
    head = common.truncate(common.strip_markdown(it["title"]), 150)
    content = "%s — %s" % (head, it["source"])
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
    field per category, lines '[Title](url) — Source'. Respects Discord's embed
    limits (field value 1024, total ~6000 -> capped at 5500)."""
    now = common.now_utc()
    content = "🗞️ Today's combat-sports digest — %d stories" % len(items)
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
        name = "%s — %d" % (label, len(group))
        lines, used, more = [], 0, 0
        for it in group:
            line = "[%s](%s) — %s" % (common.truncate(it["title"], 80), it["url"], it["source"])
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
    embed = {"title": "🗞️ Daily Digest — %s" % day,
             "color": 0xD20A0A, "fields": fields,
             "footer": {"text": "Prime Arena news wire"}}
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

    def fetch_fresh(cfg):
        """Pull enabled feeds, drop already-seen, de-dupe by guid, oldest-first."""
        fresh = []
        for key, label, url in newsconfig.enabled_sources(cfg):
            code, text = common.get_text(url)
            if code != 200 or not text:
                print("  feed skipped (%s): HTTP %s" % (label, code)); continue
            items = parse_feed(text)
            print("  %s: %d items" % (label, len(items)))
            for it in items:
                if it["guid"] in seen:
                    continue
                it["source"] = label
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
        common.save_json(common.state_path(STATE_FILE), state)
        common.persist_state(STATE_FILE)       # durable now, so a crash won't re-post

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
            silent = (mode == "hybrid" and not breaking)
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
        if posted or queued or skipped:
            save()

        # ---- daily digest (catch-up: a delayed cron posts late, never twice) ----
        if mode in ("hybrid", "digest"):
            dcfg = cfg.get("digest", {}) or {}
            stamp = digest_due(now, dcfg.get("times_utc"), state.get("digest_last", ""))
            if stamp:
                items = state.get("digest_items", [])
                if len(items) >= int(dcfg.get("min_items", 3)):
                    content, embeds, mentions = build_digest(items, cfg, digest_rid)
                    code, _ = common.post_message(chan, content, allowed_mentions=mentions,
                                                  embeds=embeds)
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
