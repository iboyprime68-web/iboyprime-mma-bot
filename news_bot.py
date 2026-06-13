#!/usr/bin/env python3
"""iBoyPrime HQ - Bot #2: MMA news wire.

Polls the major MMA outlets' RSS/Atom feeds and posts brand-new articles to the
read-only #mma-news channel (Discord auto-embeds the link). De-dupes by GUID in
committed state. First run seeds silently (no back-dump). Any dead/changed feed
is skipped without breaking the others. Std-lib only.
"""
import datetime, email.utils, xml.etree.ElementTree as ET
import common

FEEDS = [
    ("MMA Fighting", "https://www.mmafighting.com/rss/current.xml"),
    ("MMA Junkie",   "https://mmajunkie.usatoday.com/feed"),
    ("Bloody Elbow", "https://www.bloodyelbow.com/feed/"),
    ("Sherdog",      "https://www.sherdog.com/rss/news.xml"),
]
MAX_PER_RUN  = 8       # cap bursts; leftovers post next run (every ~15 min)
SEED_POST    = 5       # on the very first run, post this many latest (not silent)
MAX_SEEN     = 1200    # cap state size
STATE_FILE   = "state_news.json"


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


def main():
    cfg = common.load_config()
    chan = cfg.get("channels", {}).get("mma_news")
    if not chan:
        print("No mma_news channel in config - run bots_setup.py."); return
    state = common.load_json(common.state_path(STATE_FILE), {})
    seen = set(state.get("seen", []))
    first_run = (not state.get("initialized")) or state.get("v") != 2

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

    # de-dupe within this batch by guid, oldest first
    uniq = {}
    for it in fresh:
        uniq.setdefault(it["guid"], it)
    fresh = sorted(uniq.values(), key=lambda x: x["when"])

    if first_run:
        newest = sorted(fresh, key=lambda x: x["when"], reverse=True)[:SEED_POST]
        for it in sorted(newest, key=lambda x: x["when"]):
            msg = "**%s** · %s\n%s" % (it["source"], common.truncate(it["title"], 230), it["link"])
            common.post_message(chan, msg)
        for it in fresh:                       # mark the rest seen so we don't back-dump later
            seen.add(it["guid"])
        state["seen"] = sorted(seen)[-MAX_SEEN:]
        state["initialized"] = True
        state["v"] = 2
        common.save_json(common.state_path(STATE_FILE), state)
        print("First run: posted %d latest article(s), seeded %d." % (len(newest), len(fresh)))
        return

    posted = 0
    for it in fresh:
        if posted >= MAX_PER_RUN:
            break
        msg = "**%s** · %s\n%s" % (it["source"], common.truncate(it["title"], 230), it["link"])
        code, _ = common.post_message(chan, msg)
        if code in (200, 201):
            seen.add(it["guid"]); posted += 1
            print("posted:", it["source"], "-", it["title"][:70])
        else:
            print("post failed (%s): %s" % (code, it["title"][:60]))

    # mark anything left this run as seen too? no - leave unseen so it posts next run.
    if posted:
        for it in fresh[:posted]:
            seen.add(it["guid"])
    state["seen"] = sorted(seen)[-MAX_SEEN:]
    state["initialized"] = True
    state["v"] = 2
    common.save_json(common.state_path(STATE_FILE), state)
    print("Done. posted=%d (cap %d)" % (posted, MAX_PER_RUN))


if __name__ == "__main__":
    main()
