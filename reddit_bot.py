#!/usr/bin/env python3
"""iBoyPrime HQ - Bot #10: r/MMA daily digest.

Once a day, pulls the top posts of the day from r/MMA (free Reddit JSON) and
posts a single tidy embed (clickable titles, score + comments) to the
#reddit-mma channel. Skips if already posted today. Std-lib only.
"""
import datetime, common

SUBREDDIT  = "MMA"
TOP_N      = 10
STATE_FILE = "state_reddit.json"
# Reddit wants a descriptive UA; generic ones get throttled.
REDDIT_UA  = "web:iboyprime-hq-digest:1.0 (by /u/iboyprime)"


def fetch_top():
    url = "https://www.reddit.com/r/%s/top.json?t=day&limit=50" % SUBREDDIT
    code, data = common.get_json(url, headers={"User-Agent": REDDIT_UA})
    if code != 200 or not isinstance(data, dict):
        print("  reddit fetch failed: HTTP %s" % code); return []
    out = []
    for ch in data.get("data", {}).get("children", []):
        d = ch.get("data", {})
        if d.get("stickied") or d.get("over_18"):
            continue
        out.append({
            "title": common.clean(d.get("title", "")),
            "permalink": "https://www.reddit.com" + d.get("permalink", ""),
            "score": int(d.get("score", 0)),
            "comments": int(d.get("num_comments", 0)),
            "flair": (d.get("link_flair_text") or "").strip(),
        })
    out.sort(key=lambda x: -x["score"])
    return out[:TOP_N]


def build_embed(posts, day):
    lines = []
    for i, p in enumerate(posts, 1):
        flair = ("`%s` " % p["flair"]) if p["flair"] else ""
        lines.append("**%d.** %s[%s](%s)\n⬆️ %s · 💬 %s"
                     % (i, flair, common.truncate(p["title"], 180), p["permalink"],
                        f"{p['score']:,}", f"{p['comments']:,}"))
    desc = "\n\n".join(lines)[:4000]
    return {
        "title": "🥊 Top of r/MMA — %s" % day,
        "url": "https://www.reddit.com/r/%s/top/?t=day" % SUBREDDIT,
        "description": desc,
        "color": 0xFF4500,
        "footer": {"text": "Top posts of the day · r/%s" % SUBREDDIT},
    }


def main():
    cfg = common.load_config()
    chan = cfg.get("channels", {}).get("reddit_mma")
    if not chan:
        print("No reddit_mma channel in config."); return
    state = common.load_json(common.state_path(STATE_FILE), {})
    today = common.now_utc().strftime("%Y-%m-%d")
    if state.get("last_date") == today:
        print("Already posted today (%s)." % today); return

    posts = fetch_top()
    if not posts:
        print("No posts fetched - leaving for next run (not marking done)."); return

    code, resp = common.post_message(chan, "", embeds=[build_embed(posts, today)])
    if code in (200, 201):
        state["last_date"] = today
        common.save_json(common.state_path(STATE_FILE), state)
        print("Posted r/MMA digest for %s (%d posts)." % (today, len(posts)))
    else:
        print("Post failed: HTTP %s %s" % (code, str(resp)[:160]))


if __name__ == "__main__":
    main()
