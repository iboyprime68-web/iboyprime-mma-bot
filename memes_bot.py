#!/usr/bin/env python3
"""Prime Arena - Meme bot: a couple of funny memes a day in #memes.

Pulls top image memes of the day from a curated set of funny/dark-internet-humor
subreddits and posts a few to the memes channel. Fully automated.

Content guardrails (to respect the server rules):
  * NSFW posts are skipped (over_18),
  * a title blocklist filters out religion-bashing, slurs and other off-limits
    topics - "dark humour" here means internet-funny, not bigoted.
De-dupes by post id so the same meme never repeats. Std-lib only.
If you ever want it off, just say so and the workflow gets disabled.
"""
import common

SUBREDDITS    = ["dankmemes", "memes", "MMAmemes", "meirl", "funny"]
MEMES_PER_RUN = 2
MAX_SEEN      = 1500
STATE_FILE    = "state_memes.json"
REDDIT_UA     = "web:iboyprime-hq-memes:1.0 (by /u/iboyprime)"
IMG_EXT       = (".jpg", ".jpeg", ".png", ".gif")
# keep it within the server's rules - no religion-bashing, no slurs, no vile stuff
BLOCK_TERMS = [
    "islam", "muslim", "allah", "quran", "koran", "prophet", "mosque", "jihad",
    "jesus", "christ", "christian", "bible", "church", "hindu", "buddh", "rabbi",
    "jew", "jewish", "judaism", "religion", "religious", "atheist",
    "9/11", "holocaust", "hitler", "nazi", "rape", "pedo", "slur", "retard",
    "suicide", "kys",
]


def looks_blocked(title):
    t = " " + title.lower() + " "
    return any(term in t for term in BLOCK_TERMS)


def is_image(d):
    if d.get("post_hint") == "image":
        return True
    url = (d.get("url") or d.get("url_overridden_by_dest") or "").lower()
    if d.get("domain", "") == "i.redd.it":
        return True
    return url.endswith(IMG_EXT)


def fetch_sub(sub):
    url = "https://www.reddit.com/r/%s/top.json?t=day&limit=40" % sub
    code, data = common.get_json(url, headers={"User-Agent": REDDIT_UA})
    if code != 200 or not isinstance(data, dict):
        print("  r/%s: HTTP %s" % (sub, code)); return []
    out = []
    for ch in data.get("data", {}).get("children", []):
        d = ch.get("data", {})
        if d.get("stickied") or d.get("over_18") or d.get("is_video"):
            continue
        title = common.clean(d.get("title", ""))
        if not title or looks_blocked(title) or not is_image(d):
            continue
        url = d.get("url_overridden_by_dest") or d.get("url") or ""
        if not url:
            continue
        out.append({"id": d.get("id"), "title": title, "url": url,
                    "score": int(d.get("score", 0)), "sub": sub})
    return out


def main():
    cfg = common.load_config()
    chan = cfg.get("channels", {}).get("memes")
    if not chan:
        print("No memes channel in config."); return
    state = common.load_json(common.state_path(STATE_FILE), {})
    seen = set(state.get("seen", []))

    pool = []
    for sub in SUBREDDITS:
        pool.extend(fetch_sub(sub))
    # de-dupe by id, drop seen, best first
    uniq = {}
    for m in pool:
        if m["id"] and m["id"] not in seen:
            uniq.setdefault(m["id"], m)
    fresh = sorted(uniq.values(), key=lambda x: -x["score"])

    if not fresh:
        print("No fresh memes this run (fetch blocked or all seen)."); return

    posted = 0
    for m in fresh:
        if posted >= MEMES_PER_RUN:
            break
        # SILENT post (memes never buzz anyone) with the image in a proper embed;
        # plain-text fallback if the URL somehow can't be embedded.
        title = common.truncate(common.strip_markdown(m["title"]), 200)
        if (m["url"] or "").lower().startswith("http"):
            embed = {"title": common.truncate(m["title"], 256),
                     "image": {"url": m["url"]}, "color": 0xF1C40F,
                     "footer": {"text": "via r/%s" % m["sub"]}}
            code, _ = common.post_message(chan, "😂 %s" % title, embeds=[embed], silent=True)
        else:
            msg = "😂 %s\n%s\nvia r/%s" % (title, m["url"], m["sub"])
            code, _ = common.post_message(chan, msg, silent=True)
        if code in (200, 201):
            seen.add(m["id"]); posted += 1
            print("posted meme:", m["sub"], "-", m["title"][:60])

    state["seen"] = sorted(seen)[-MAX_SEEN:]
    common.save_json(common.state_path(STATE_FILE), state)
    print("Done. memes posted=%d" % posted)


if __name__ == "__main__":
    main()
