#!/usr/bin/env python3
"""One-off egress probe for the memes bot (Oct 3 2026). Read-only, no secrets.
Answers: which meme sources answer a GitHub-hosted runner? Deleted after one run."""
import json, time, urllib.request, urllib.error

BOT_UA = "web:iboyprime-hq-memes:1.0 (by /u/iboyprime)"
BROWSER_UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
              "AppleWebKit/537.36 (KHTML, like Gecko) iBoyPrimeHQ/1.0")


def get(url, ua=BROWSER_UA, cap=12 * 1024 * 1024):
    req = urllib.request.Request(url, headers={"User-Agent": ua, "Accept": "*/*"})
    t = time.time()
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            b = r.read(cap)
            return r.status, b, time.time() - t, r.headers.get("content-type", "")
    except urllib.error.HTTPError as e:
        return e.code, e.read()[:300], time.time() - t, e.headers.get("content-type", "")
    except Exception as e:
        return 0, str(e).encode(), time.time() - t, ""


def sniff(b):
    if b.startswith(b"\x89PNG"): return "png"
    if b.startswith(b"\xff\xd8\xff"): return "jpg"
    if b.startswith(b"GIF8"): return "gif"
    if b[:4] == b"RIFF" and b[8:12] == b"WEBP": return "webp"
    return "?"


def line(tag, c, b, dt, ct, extra=""):
    print("PROBE %-34s http=%s %.2fs %7d bytes ct=%s %s" % (tag, c, dt, len(b), ct.split(";")[0], extra))
    if c != 200:
        print("      body:", b[:160])


# 1. Reddit unauthenticated JSON - the bot's current path (expected 403)
c, b, dt, ct = get("https://www.reddit.com/r/memes/top.json?t=day&limit=5", BOT_UA)
line("reddit json www (bot UA)", c, b, dt, ct)
time.sleep(30)

# 2. Reddit RSS (Atom) - dies Nov 13 2026 per Reddit, but does it answer a runner today?
for i, (tag, url, ua) in enumerate([
        ("reddit rss r/memes top (bot UA)", "https://www.reddit.com/r/memes/top/.rss?t=day&limit=40", BOT_UA),
        ("reddit rss r/MMAmemes top (browser UA)", "https://www.reddit.com/r/MMAmemes/top/.rss?t=day&limit=40", BROWSER_UA),
        ("reddit rss old r/dankmemes (bot UA)", "https://old.reddit.com/r/dankmemes/top/.rss?t=day", BOT_UA)]):
    c, b, dt, ct = get(url, ua)
    line(tag, c, b, dt, ct, "entries=%d" % b.count(b"<entry>"))
    time.sleep(30)

# 3. meme-api.com (a public Reddit relay: nsfw + spoiler flags, image urls)
img_reddit = None
for sub in ("MMAmemes", "memes"):
    c, b, dt, ct = get("https://meme-api.com/gimme/%s/50" % sub, BOT_UA)
    extra = ""
    if c == 200:
        try:
            ms = json.loads(b).get("memes", [])
            extra = "memes=%d nsfw=%d spoiler=%d" % (len(ms), sum(m.get("nsfw") for m in ms), sum(m.get("spoiler") for m in ms))
            img_reddit = img_reddit or next((m["url"] for m in ms if "i.redd.it" in m.get("url", "")), None)
        except Exception as e:
            extra = "parse error %s" % e
    line("meme-api gimme/%s/50" % sub, c, b, dt, ct, extra)
    time.sleep(2)

# 4. Lemmy (federated, open API, nsfw flags, TopDay)
img_lemmy = None
for comm in ("memes@lemmy.world", "comicstrips@lemmy.world"):
    c, b, dt, ct = get("https://lemmy.world/api/v3/post/list?community_name=%s&sort=TopDay&limit=50" % comm, BOT_UA)
    extra = ""
    if c == 200:
        try:
            ps = json.loads(b).get("posts", [])
            extra = "posts=%d nsfw=%d" % (len(ps), sum(1 for p in ps if p["post"].get("nsfw") or p["community"].get("nsfw")))
            img_lemmy = img_lemmy or next((p["post"]["url"] for p in ps if (p["post"].get("url") or "").split("?")[0].lower().endswith((".jpg", ".jpeg", ".png", ".webp", ".gif"))), None)
        except Exception as e:
            extra = "parse error %s" % e
    line("lemmy %s TopDay" % comm, c, b, dt, ct, extra)
    time.sleep(2)

# 5. 9GAG internal JSON (Cloudflare-fronted)
c, b, dt, ct = get("https://9gag.com/v1/feed-posts/type/hot")
line("9gag hot json", c, b, dt, ct)

# 6. Can the runner download the IMAGES (needed to upload them to Discord)?
for tag, url in (("i.redd.it image", img_reddit), ("lemmy image", img_lemmy)):
    if not url:
        print("PROBE %-34s (no url to test)" % tag); continue
    for ua_tag, ua in (("browser UA", BROWSER_UA), ("bot UA", BOT_UA)):
        c, b, dt, ct = get(url, ua)
        line("%s (%s)" % (tag, ua_tag), c, b, dt, ct, "magic=%s host=%s" % (sniff(b), url.split("/")[2]))
        time.sleep(1)
print("PROBE done")
