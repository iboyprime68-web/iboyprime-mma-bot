#!/usr/bin/env python3
"""iBoyPrime HQ - Bot #2: MMA news wire.

Polls the major MMA outlets' RSS/Atom feeds and posts brand-new articles to the
read-only #mma-news channel (Discord auto-embeds the link). De-dupes by GUID in
committed state. First run seeds silently (no back-dump). Any dead/changed feed
is skipped without breaking the others. Std-lib only.

LATENCY + NO BURST-NOISE: on GitHub Actions the job polls every ~1 min inside one
run (common.run_loop) instead of waiting for the 5-min cron floor, and it posts at
most ONE new article per cycle. So a member gets one quiet ping per article ~1 min
apart - never the old burst of 5-6 notification sounds at once. A backlog just
trickles out one-per-cycle. State is committed right after each post so a mid-run
crash never re-posts. (Run locally, it does a single pass like before.)
"""
import datetime, email.utils, xml.etree.ElementTree as ET
import common

FEEDS = [
    ("MMA Fighting", "https://www.mmafighting.com/rss/current.xml"),
    ("MMA Junkie",   "https://mmajunkie.usatoday.com/feed"),
    ("Bloody Elbow", "https://www.bloodyelbow.com/feed/"),
    ("Sherdog",      "https://www.sherdog.com/rss/news.xml"),
]
PACE_PER_CYCLE = 1     # post at most ONE new article per ~1-min cycle: one quiet
                       # ping each, never a 5-6 burst (a backlog just trickles out)
SEED_POST      = 5     # on the very first run, post this many latest (not silent)
MAX_SEEN       = 1200  # cap state size
STATE_FILE     = "state_news.json"


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
    """Return list of dicts {guid,title,link,when} from RSS or Atom XML."""
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
        items.append({"guid": guid, "title": title, "link": link, "when": _pubdate(el)})
    return items


def _msg(it):
    return "**%s** · %s\n%s" % (it["source"], common.truncate(it["title"], 230), it["link"])


def main():
    cfg = common.load_config()
    chan = cfg.get("channels", {}).get("mma_news")
    if not chan:
        print("No mma_news channel in config - run bots_setup.py."); return
    state = common.load_json(common.state_path(STATE_FILE), {})
    seen = set(state.get("seen", []))

    def fetch_fresh():
        """Pull all feeds, drop already-seen, de-dupe by guid, oldest-first."""
        fresh = []
        for source, url in FEEDS:
            code, text = common.get_text(url)
            if code != 200 or not text:
                print("  feed skipped (%s): HTTP %s" % (source, code)); continue
            items = parse_feed(text)
            print("  %s: %d items" % (source, len(items)))
            for it in items:
                if it["guid"] in seen:
                    continue
                it["source"] = source
                fresh.append(it)
        uniq = {}
        for it in fresh:
            uniq.setdefault(it["guid"], it)
        return sorted(uniq.values(), key=lambda x: x["when"])

    def save():
        state["seen"] = sorted(seen)[-MAX_SEEN:]
        state["initialized"] = True
        state["v"] = 2
        common.save_json(common.state_path(STATE_FILE), state)
        common.persist_state(STATE_FILE)       # durable now, so a crash won't re-post

    def poll_once():
        first_run = (not state.get("initialized")) or state.get("v") != 2
        fresh = fetch_fresh()
        if first_run:
            newest = sorted(fresh, key=lambda x: x["when"], reverse=True)[:SEED_POST]
            for it in sorted(newest, key=lambda x: x["when"]):
                common.post_message(chan, _msg(it))
            for it in fresh:                   # mark the rest seen so we don't back-dump later
                seen.add(it["guid"])
            save()
            print("First run: posted %d latest article(s), seeded %d." % (len(newest), len(fresh)))
            return
        # steady state: at most PACE_PER_CYCLE post(s) per cycle (oldest-first) so a
        # backlog drains as one quiet ping ~each cycle, not a burst.
        posted = 0
        for it in fresh:
            if posted >= PACE_PER_CYCLE:
                break
            code, _ = common.post_message(chan, _msg(it))
            if code in (200, 201):
                seen.add(it["guid"]); posted += 1
                print("posted:", it["source"], "-", it["title"][:70])
            else:
                # leave unseen (retry next cycle); skip on so one bad item can't block the feed
                print("post failed (%s), will retry: %s" % (code, it["title"][:60]))
        if posted:
            save()
        print("cycle done. posted=%d (pace %d), backlog~%d" % (posted, PACE_PER_CYCLE, max(0, len(fresh) - posted)))

    common.run_loop(poll_once)


if __name__ == "__main__":
    main()
