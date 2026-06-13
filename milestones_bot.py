#!/usr/bin/env python3
"""iBoyPrime HQ - Bot #5: Creator milestone bot.

Polls iBoyPrime's follower/subscriber counts and celebrates when a round
milestone is crossed (1K, 5K, 10K, 25K, 100K...), posting to #server-updates.

Sources (each optional, enabled by the secret it needs):
  * YouTube  - YouTube Data API (YOUTUBE_API_KEY) - reliable.
  * Twitch   - follower TOTAL now needs the creator's own OAuth token
               (TWITCH_CLIENT_ID + TWITCH_USER_TOKEN, scope moderator:read:followers).
  * Kick     - unofficial endpoint, best-effort (often blocked from cloud IPs).
  * TikTok   - no free/official count API -> intentionally omitted.

First run seeds silently. Std-lib only.
"""
import os, json, common

STATE_FILE = "state_milestones.json"
LADDER = sorted(set(
    [100, 250, 500, 750] +
    [i * 1000 for i in (1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 15, 20, 25, 30, 40, 50, 75)] +
    [i * 100000 for i in range(1, 101)]))   # ... up to 10,000,000


def milestones_between(old, new):
    return [m for m in LADDER if old < m <= new]


def humanize(n):
    if n >= 1_000_000:
        return ("%.1f" % (n / 1_000_000)).rstrip("0").rstrip(".") + "M"
    if n >= 1_000:
        return ("%.1f" % (n / 1_000)).rstrip("0").rstrip(".") + "K"
    return str(n)


# ---- sources ---------------------------------------------------------------
def youtube_subs(cfg):
    key = os.environ.get("YOUTUBE_API_KEY", "")
    if not key:
        return None
    cid = (cfg.get("creator", {}).get("youtube_channel_id") or "").strip()
    handle = (cfg.get("creator", {}).get("youtube_handle") or "").strip()
    if cid:
        url = "https://www.googleapis.com/youtube/v3/channels?part=statistics&id=%s&key=%s" % (cid, key)
    elif handle:
        url = "https://www.googleapis.com/youtube/v3/channels?part=statistics&forHandle=%s&key=%s" % (handle, key)
    else:
        return None
    code, data = common.get_json(url)
    try:
        items = data.get("items", [])
        if not items:
            return None
        s = items[0]["statistics"]
        if s.get("hiddenSubscriberCount"):
            return None
        return int(s["subscriberCount"])
    except Exception:
        return None


def twitch_followers(cfg):
    cid = os.environ.get("TWITCH_CLIENT_ID", "")
    utok = os.environ.get("TWITCH_USER_TOKEN", "")
    login = (cfg.get("creator", {}).get("twitch_login") or "").strip()
    if not (cid and utok and login):
        return None
    h = {"Client-Id": cid, "Authorization": "Bearer " + utok}
    code, u = common.get_json("https://api.twitch.tv/helix/users?login=" + login, headers=h)
    try:
        bid = u["data"][0]["id"]
    except Exception:
        return None
    code, f = common.get_json(
        "https://api.twitch.tv/helix/channels/followers?broadcaster_id=%s&first=1" % bid, headers=h)
    try:
        return int(f["total"])
    except Exception:
        return None


def kick_followers(cfg):
    slug = (cfg.get("creator", {}).get("kick_slug") or "").strip()
    if not slug:
        return None
    code, data = common.get_json("https://kick.com/api/v2/channels/" + slug)
    if code != 200 or not isinstance(data, dict):
        return None
    for k in ("followers_count", "followersCount", "followers"):
        if isinstance(data.get(k), int):
            return data[k]
    return None


PLATFORMS = [
    ("youtube", "📹", "YouTube subscribers", youtube_subs),
    ("twitch",  "🟣", "Twitch followers",    twitch_followers),
    ("kick",    "🟢", "Kick followers",      kick_followers),
]


def main():
    cfg = common.load_config()
    chan = cfg.get("channels", {}).get("server_updates") or cfg.get("channels", {}).get("announcements")
    if not chan:
        print("No server_updates/announcements channel in config."); return
    state = common.load_json(common.state_path(STATE_FILE), {})
    counts = state.get("counts", {})
    first = not state.get("initialized")
    announced = 0

    for key, emoji, label, fetch in PLATFORMS:
        try:
            n = fetch(cfg)
        except Exception as e:
            n = None; print("  %s fetch error: %s" % (key, e))
        if n is None:
            print("  %s: unavailable/disabled" % key); continue
        old = counts.get(key)
        counts[key] = n
        print("  %s: %s" % (key, n))
        if first or old is None:
            continue
        crossed = milestones_between(old, n)
        if crossed:
            top = crossed[-1]
            msg = ("🎉 **iBoyPrime just hit %s %s!** %s\n"
                   "Huge milestone, Prime fam — let's keep it rolling. 🔥"
                   % (humanize(top), label, emoji))
            code, _ = common.post_message(chan, msg)
            if code in (200, 201):
                announced += 1
                print("  >>> milestone:", key, top)

    state["counts"] = counts
    state["initialized"] = True
    common.save_json(common.state_path(STATE_FILE), state)
    if first:
        print("First run: seeded counts silently (%s)." % ", ".join("%s=%s" % (k, v) for k, v in counts.items()))
    else:
        print("Done. milestones announced=%d" % announced)


if __name__ == "__main__":
    main()
