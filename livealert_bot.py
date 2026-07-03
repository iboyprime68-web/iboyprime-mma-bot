#!/usr/bin/env python3
"""iBoyPrime HQ - Bots #8 + #7: Live alert+ and Stream recap (one poller).

On GitHub Actions it checks every ~1 min (common.run_loop polls inside one job)
instead of waiting for the 5-min cron floor, so the go-live alert lands close to
when the stream actually starts. Each alert/recap is posted exactly once (state is
committed the moment it posts, so a mid-run crash can't double-ping). It checks
whether iBoyPrime is live, and:
  GO-LIVE  -> posts a go-live alert to #live-now (pings the 🔴 Live Pings role),
              opens a discussion thread, and starts tracking the session.
  WHILE LIVE -> keeps the peak viewer count up to date.
  STREAM END -> posts a recap (duration streamed, peak viewers, VOD link).

Sources:
  * Twitch - app token (TWITCH_CLIENT_ID + TWITCH_CLIENT_SECRET); streams + VOD
             read fine with an app token (no creator OAuth needed here).
  * Kick   - OFFICIAL public API app token (KICK_CLIENT_ID + KICK_CLIENT_SECRET);
             reliable, unlike the old unofficial endpoint that cloud IPs got blocked
             from. Stays idle if the Kick keys aren't set.
These two behaviours share one live-session state file, so they live in one bot
to avoid races. Std-lib only.
"""
import os, datetime, common

STATE_FILE = "state_live.json"


def fmt_duration(secs):
    secs = max(0, int(secs))
    h, m = secs // 3600, (secs % 3600) // 60
    return ("%dh %dm" % (h, m)) if h else ("%dm" % m)


# ---- Twitch ----------------------------------------------------------------
def twitch_token():
    cid = os.environ.get("TWITCH_CLIENT_ID", "")
    sec = os.environ.get("TWITCH_CLIENT_SECRET", "")
    if not (cid and sec):
        return None, None
    url = ("https://id.twitch.tv/oauth2/token?client_id=%s&client_secret=%s"
           "&grant_type=client_credentials" % (cid, sec))
    code, data = common.http(url, method="POST")
    try:
        import json
        return cid, json.loads(data)["access_token"]
    except Exception:
        return None, None


def twitch_status(cfg):
    login = (cfg.get("creator", {}).get("twitch_login") or "").strip()
    cid, tok = twitch_token()
    if not (login and cid and tok):
        return None
    h = {"Client-Id": cid, "Authorization": "Bearer " + tok}
    code, data = common.get_json("https://api.twitch.tv/helix/streams?user_login=" + login, headers=h)
    if code != 200 or not isinstance(data, dict):
        return None
    arr = data.get("data", [])
    if not arr:
        return {"live": False, "_h": h, "login": login}
    s = arr[0]
    return {"live": True, "id": str(s.get("id")), "title": s.get("title", ""),
            "game": s.get("game_name", ""), "viewers": int(s.get("viewer_count", 0) or 0),
            "started": s.get("started_at", ""), "user_id": str(s.get("user_id", "")),
            "url": "https://twitch.tv/" + login, "_h": h, "login": login}


def twitch_vod(info):
    try:
        h = info.get("_h"); uid = info.get("user_id")
        if not (h and uid):
            return ""
        code, data = common.get_json(
            "https://api.twitch.tv/helix/videos?user_id=%s&type=archive&first=1" % uid, headers=h)
        vids = data.get("data", []) if isinstance(data, dict) else []
        return vids[0].get("url", "") if vids else ""
    except Exception:
        return ""


# ---- Kick (official public API) --------------------------------------------
def kick_token():
    """App access token via OAuth2 client_credentials (no user login). None if no keys."""
    cid = os.environ.get("KICK_CLIENT_ID", "")
    sec = os.environ.get("KICK_CLIENT_SECRET", "")
    if not (cid and sec):
        return None
    body = ("grant_type=client_credentials&client_id=%s&client_secret=%s" % (cid, sec)).encode()
    code, data = common.http("https://id.kick.com/oauth/token", method="POST", raw_body=body,
                             headers={"Content-Type": "application/x-www-form-urlencoded"})
    try:
        import json
        return json.loads(data).get("access_token")
    except Exception:
        return None


def kick_status(cfg):
    slug = (cfg.get("creator", {}).get("kick_slug") or "").strip()
    tok = kick_token()
    if not (slug and tok):
        return None                                # Kick disabled / no keys -> skipped
    h = {"Authorization": "Bearer " + tok}
    code, data = common.get_json("https://api.kick.com/public/v1/channels?slug=" + slug, headers=h)
    if code != 200 or not isinstance(data, dict):
        return None
    arr = data.get("data") or []
    if not arr:
        return {"live": False, "login": slug}
    ch = arr[0]
    st = ch.get("stream") or {}
    if not st.get("is_live"):
        return {"live": False, "login": slug}
    # the public API exposes no stream id; start_time is unique per session, so use it as the key
    sid = str(st.get("start_time") or slug)
    return {"live": True, "id": sid, "title": ch.get("stream_title", ""),
            "game": "", "viewers": int(st.get("viewer_count", 0) or 0),
            "started": st.get("start_time", ""), "url": "https://kick.com/" + slug, "login": slug}


PLATFORMS = {
    "twitch": ("Twitch", 0x9146FF, twitch_status, twitch_vod),
    "kick":   ("Kick",   0x53FC18, kick_status,   lambda info: info.get("url", "") + "/videos"),
}


def process(pkey, cfg, state, chan, role_id):
    label, color, fetch, vodfn = PLATFORMS[pkey]
    info = fetch(cfg)
    if info is None:
        print("  %s: disabled/unavailable" % pkey); return 0
    sess = state.get(pkey)
    acted = 0

    if info.get("live"):
        if sess and sess.get("id") == info["id"]:
            # same session - just bump peak
            if info["viewers"] > sess.get("peak", 0):
                sess["peak"] = info["viewers"]
                print("  %s: live, new peak %d" % (pkey, sess["peak"]))
        else:
            # new go-live: content = the push preview (plain text, no markdown/URL),
            # link + details live in the embed
            ping = ("<@&%s> " % role_id) if role_id else ""
            title = common.truncate(common.strip_markdown(info.get("title", "Live now")), 180)
            msg = "%s🔴 iBoyPrime is LIVE on %s — %s" % (ping, label, title)
            desc = []
            if info.get("game"):
                desc.append("🎮 %s" % info["game"])
            desc.append("👀 %d watching" % info["viewers"])
            embed = {"title": common.truncate(info.get("title", "Live now"), 256),
                     "url": info["url"], "color": color,
                     "description": "\n".join(desc),
                     "footer": {"text": "%s · live now" % label}}
            am = {"parse": [], "roles": [str(role_id)] if role_id else []}
            code, resp = common.post_message(chan, msg, allowed_mentions=am, embeds=[embed])
            thread_id = ""
            if code in (200, 201) and isinstance(resp, dict) and resp.get("id"):
                mid = resp["id"]
                tcode, tresp = common.discord(
                    "POST", "/channels/%s/messages/%s/threads" % (chan, mid),
                    {"name": ("🔴 Live: %s" % info.get("title", "Stream"))[:95],
                     "auto_archive_duration": 1440})
                if tcode in (200, 201) and isinstance(tresp, dict):
                    thread_id = tresp.get("id", "")
            state[pkey] = {"id": info["id"], "started": info.get("started", ""),
                           "peak": info["viewers"], "title": info.get("title", ""),
                           "thread_id": thread_id, "url": info["url"]}
            acted = 1
            print("  %s: GO-LIVE posted" % pkey)
    else:
        if sess:
            # transition to offline -> recap
            started = common.parse_iso(sess.get("started"))
            dur = (common.now_utc() - started).total_seconds() if started else 0
            vod = ""
            try:
                vod = vodfn(info) if pkey == "twitch" else (sess.get("url", "") + "/videos")
            except Exception:
                vod = sess.get("url", "")
            # recap is a quiet wrap-up: SILENT post (no push), details in an embed
            recap = "📊 Stream recap — %s: %s" % (
                label, common.truncate(common.strip_markdown(sess.get("title", "")), 150))
            fields = [{"name": "⏱️ Streamed", "value": fmt_duration(dur), "inline": True},
                      {"name": "👀 Peak viewers", "value": str(sess.get("peak", 0)), "inline": True}]
            if vod:
                fields.append({"name": "📺 VOD", "value": vod, "inline": False})
            embed = {"title": common.truncate(sess.get("title", "Stream recap"), 256),
                     "color": color, "fields": fields,
                     "footer": {"text": "%s · stream ended" % label}}
            target = sess.get("thread_id") or chan
            common.post_message(target, recap, embeds=[embed], silent=True)
            state.pop(pkey, None)
            acted = 1
            print("  %s: recap posted, session closed" % pkey)
        else:
            print("  %s: offline" % pkey)
    return acted


def main():
    cfg = common.load_config()
    chan = cfg.get("channels", {}).get("live_now")
    if not chan:
        print("No live_now channel in config."); return
    role_id = cfg.get("roles", {}).get("live_pings")
    state = common.load_json(common.state_path(STATE_FILE), {})

    def poll_once():
        acted = 0
        for pkey in PLATFORMS:
            try:
                acted += process(pkey, cfg, state, chan, role_id)
            except Exception as e:
                print("  %s error: %s" % (pkey, e))
        common.save_json(common.state_path(STATE_FILE), state)
        if acted:                              # a go-live/recap fired: commit now so we never re-ping
            common.persist_state(STATE_FILE)
        print("cycle done. actions=%d" % acted)

    common.run_loop(poll_once)


if __name__ == "__main__":
    main()
