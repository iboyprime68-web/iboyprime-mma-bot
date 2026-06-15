#!/usr/bin/env python3
"""iBoyPrime HQ - Bot #9: YouTube notifier (new uploads + go-live).

NEW UPLOAD (free, NO key): polls the channel's public RSS feed and posts brand-new
videos to #announcements, pinging the 📹 YouTube Pings role. The first run seeds
silently (marks existing videos as seen) so it never back-dumps the whole channel.

GO-LIVE (needs YOUTUBE_API_KEY): when a fresh feed entry is actually a live
broadcast, it posts a go-live alert to #live-now pinging 🔴 Live Pings instead of a
normal upload post. Detection is cheap: the free RSS gives candidate video IDs, then
ONE 1-unit videos.list call confirms the live state - tiny against the free
10,000-units/day quota. Without the key, a live stream is just announced as a new
upload (best effort), and scheduled premieres are skipped until they air.

De-dupes by video id, state-versioned, idempotent. Std-lib only (uses common.py).

On GitHub Actions it polls every ~1 min inside one job (common.run_loop) instead of
the 10-min cron floor, posting at most one item per cycle (uploads are opt-in pings,
so this stays prompt without ever bursting), and commits state right after a post so
a crash can't double-post. Run locally, it does a single pass.
"""
import os, xml.etree.ElementTree as ET
import common

STATE_FILE = "state_youtube.json"
# iBoyPrime's public channel id - NOT a secret. Overridden by config if set.
DEFAULT_CHANNEL_ID = "UCPx5FFZkK2N5yQ-jiTcS3mg"
RSS = "https://www.youtube.com/feeds/videos.xml?channel_id=%s"
PACE_PER_CYCLE = 1       # one item per ~1-min cycle: prompt, never a burst
MAX_SEEN = 400
STATE_V = 2


def _local(tag):
    return tag.split("}", 1)[-1].lower() if tag else ""


def channel_id(cfg):
    cid = (cfg.get("creator", {}).get("youtube_channel_id") or "").strip()
    if not cid or "PASTE" in cid.upper():
        cid = DEFAULT_CHANNEL_ID
    return cid


def parse_feed(text):
    """Return [{id,title,link,when}] (feed order = newest first) from the YT Atom feed."""
    out = []
    try:
        root = ET.fromstring(text.encode("utf-8") if isinstance(text, str) else text)
    except Exception:
        return out
    for el in root.iter():
        if _local(el.tag) != "entry":
            continue
        vid = title = link = pub = ""
        for ch in el:
            ln = _local(ch.tag)
            if ln == "videoid":
                vid = (ch.text or "").strip()
            elif ln == "title" and not title:
                title = common.clean(ch.text or "")
            elif ln == "link":
                href = ch.attrib.get("href")
                if href and ch.attrib.get("rel", "alternate") == "alternate":
                    link = href
            elif ln == "published":
                pub = (ch.text or "").strip()
        if vid:
            out.append({"id": vid, "title": title or "New video",
                        "link": link or ("https://youtu.be/" + vid), "when": pub})
    return out


def live_status(video_id):
    """'live' | 'upcoming' | 'none' when a YOUTUBE_API_KEY is set; None without one.
    Costs 1 quota unit (videos.list, part=snippet)."""
    key = os.environ.get("YOUTUBE_API_KEY", "")
    if not key:
        return None
    url = ("https://www.googleapis.com/youtube/v3/videos"
           "?part=snippet&id=%s&key=%s" % (video_id, key))
    code, data = common.get_json(url)
    try:
        items = data.get("items", []) if isinstance(data, dict) else []
        if not items:
            return "none"
        return items[0].get("snippet", {}).get("liveBroadcastContent", "none") or "none"
    except Exception:
        return "none"


def main():
    cfg = common.load_config()
    chans = cfg.get("channels", {})
    roles = cfg.get("roles", {})
    up_chan = chans.get("announcements") or chans.get("server_updates")
    live_chan = chans.get("live_now")
    yt_role = roles.get("youtube_pings")
    live_role = roles.get("live_pings")
    if not up_chan:
        print("No announcements/server_updates channel in config."); return
    cid = channel_id(cfg)
    state = common.load_json(common.state_path(STATE_FILE), {})
    seen = set(state.get("seen", []))

    def save():
        state.update({"seen": sorted(seen)[-MAX_SEEN:], "initialized": True, "v": STATE_V})
        common.save_json(common.state_path(STATE_FILE), state)
        common.persist_state(STATE_FILE)           # durable now, so a crash won't re-post

    def poll_once():
        code, text = common.get_text(RSS % cid)
        if code != 200 or not text:
            print("YouTube feed unavailable (HTTP %s)." % code); return
        entries = parse_feed(text)
        print("Feed: %d entries (channel %s)" % (len(entries), cid))
        if not entries:
            return

        first_run = (not state.get("initialized")) or state.get("v") != STATE_V
        if first_run:
            for e in entries:
                seen.add(e["id"])
            save()
            print("First run: seeded %d video id(s) silently (no back-dump)." % len(entries))
            return

        fresh = [e for e in entries if e["id"] not in seen]
        posted = 0
        for e in reversed(fresh):                  # oldest-first so posts are chronological
            if posted >= PACE_PER_CYCLE:
                break
            st = live_status(e["id"])
            if st == "upcoming":
                print("skip (scheduled/premiere, will catch when it airs):", e["id"])
                continue                           # leave unseen; revisit next cycle
            if st == "live" and live_chan:
                ping = ("<@&%s> " % live_role) if live_role else ""
                msg = ("%s🔴 **iBoyPrime is LIVE on YouTube!**\n**%s**\n%s"
                       % (ping, common.truncate(e["title"], 200), e["link"]))
                am = {"parse": [], "roles": [str(live_role)] if live_role else []}
                c, _ = common.post_message(live_chan, msg, allowed_mentions=am)
            else:
                ping = ("<@&%s> " % yt_role) if yt_role else ""
                head = "📺 **New YouTube video!**" if st == "none" else "📺 **New on YouTube**"
                msg = ("%s%s\n**%s**\n%s"
                       % (ping, head, common.truncate(e["title"], 200), e["link"]))
                am = {"parse": [], "roles": [str(yt_role)] if yt_role else []}
                c, _ = common.post_message(up_chan, msg, allowed_mentions=am)
            if c in (200, 201):
                seen.add(e["id"]); posted += 1
                print("posted (%s):" % (st or "no-key"), e["id"], "-", e["title"][:60])
            else:
                print("post failed (%s): %s" % (c, e["id"]))
        if posted:
            save()
        print("cycle done. posted=%d" % posted)

    common.run_loop(poll_once)


if __name__ == "__main__":
    main()
