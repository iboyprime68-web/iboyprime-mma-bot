#!/usr/bin/env python3
"""iBoyPrime HQ - MMA bot (recurring poller).
Polls ESPN's free MMA API (no key) and posts to Discord forums:
  UPCOMING cards -> upcoming-fights forum (pings Fight Alerts)
  RESULTS        -> fight-results forum (pings Fight Results, spoiler-tagged,
                    in a channel only opted-in members can see)
Run mma_setup.py first. Scheduled every ~15 min by MMA_SETUP.bat. Std-lib only.
"""
import os, re, json, time, datetime, urllib.request, urllib.error

TOKEN    = os.environ.get("DISCORD_BOT_TOKEN", "")
if not TOKEN:
    raise SystemExit("ERROR: set the DISCORD_BOT_TOKEN GitHub secret.")
HERE     = os.path.dirname(os.path.abspath(__file__))
CONFIG   = os.path.join(HERE, "mma_config.json")
STATE    = os.path.join(HERE, "mma_state.json")
LEAGUES  = ["ufc", "pfl", "bellator"]
UPCOMING_DAYS    = 21
RESULTS_LOOKBACK = 3

DISCORD = "https://discord.com/api/v10"
DHEAD = {"Authorization": "Bot " + TOKEN, "Content-Type": "application/json",
         "User-Agent": "iBoyPrimeMMA (https://iboyprime, 1.0)"}
ESPN_UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) iBoyPrimeMMA/1.0"}
METHOD_MAP = {"kotko": "KO/TKO", "ko/tko": "KO/TKO", "submission": "Submission",
              "decision": "Decision", "dq": "DQ", "draw": "Draw", "no contest": "No Contest"}

def _req(url, headers, method="GET", body=None, tries=5):
    data = json.dumps(body).encode() if body is not None else None
    for _ in range(tries):
        try:
            r = urllib.request.Request(url, data=data, headers=headers, method=method)
            with urllib.request.urlopen(r, timeout=30) as resp:
                raw = resp.read().decode()
                return resp.status, (json.loads(raw) if raw else {})
        except urllib.error.HTTPError as e:
            raw = e.read().decode()
            if e.code == 429:
                try: wait = float(json.loads(raw).get("retry_after", 2))
                except Exception: wait = 2
                time.sleep(wait + 0.3); continue
            return e.code, {"_error": raw[:300]}
        except Exception:
            time.sleep(2)
    return 0, {"_error": "request failed"}

def espn(path):
    return _req("https://site.api.espn.com/apis/site/v2/sports/mma/" + path, ESPN_UA)[1]

def discord(method, path, body=None):
    return _req(DISCORD + path, DHEAD, method, body)

def parse_dt(iso):
    return datetime.datetime.strptime(iso.replace("Z", "+0000"), "%Y-%m-%dT%H:%M%z")

def event_id(ref):
    m = re.search(r"/events/(\d+)", ref or "")
    return m.group(1) if m else None

def competitors(comp):
    cs = comp.get("competitors", [])
    a = next((c for c in cs if c.get("order") == 1), cs[0] if cs else {})
    b = next((c for c in cs if c.get("order") == 2), cs[1] if len(cs) > 1 else {})
    return a, b

def name(c):
    return (c.get("athlete") or {}).get("displayName", "TBD")

def weightclass(comp):
    return (comp.get("type") or {}).get("abbreviation", "")

def is_completed(comp):
    return ((comp.get("status") or {}).get("type") or {}).get("completed") is True

def method_of(comp):
    for d in comp.get("details", []):
        t = ((d.get("type") or {}).get("text") or "")
        if t.lower().startswith("unofficial winner"):
            raw = t[len("Unofficial Winner"):].strip()
            return METHOD_MAP.get(raw.lower(), raw or "Decision")
    return None

def matchup_line(comp):
    a, b = competitors(comp)
    five = (comp.get("format", {}).get("regulation", {}).get("periods") == 5)
    star = " ⭐" if five else ""
    rec = lambda c: (c.get("records", [{}])[0].get("summary", "") if c.get("records") else "")
    ra, rb = rec(a), rec(b)
    ra = " (" + ra + ")" if ra else ""
    rb = " (" + rb + ")" if rb else ""
    return "**" + name(a) + "**" + ra + "  vs  **" + name(b) + "**" + rb + "  · " + weightclass(comp) + star

def result_line(comp):
    a, b = competitors(comp)
    cs = comp.get("competitors", [])
    win = next((c for c in cs if c.get("winner")), None)
    if not win:
        return name(a) + " vs " + name(b) + " — Draw/No Contest · " + weightclass(comp)
    los = next((c for c in cs if c is not win), {})
    meth = method_of(comp) or "Decision"
    st = comp.get("status", {})
    rnd = st.get("period"); clk = st.get("displayClock"); when = ""
    if meth != "Decision" and rnd:
        when = ", R" + str(rnd) + ((" " + clk) if clk and clk != "-" else "")
    return "**" + name(win) + "** def. " + name(los) + " — " + meth + when + " · " + weightclass(comp)

def ordered_bouts(ev):
    return list(reversed(ev.get("competitions", [])))

def find_detail(league, eid, start_iso, cache):
    if eid in cache:
        return cache[eid]
    d = parse_dt(start_iso).astimezone(datetime.timezone.utc)
    for delta in (0, -1, 1):
        day = (d + datetime.timedelta(days=delta)).strftime("%Y%m%d")
        sb = espn(league + "/scoreboard?dates=" + day)
        for ev in sb.get("events", []):
            cache[ev["id"]] = ev
        if eid in cache:
            return cache[eid]
    return None

def event_done(ev):
    top = ((ev.get("status") or {}).get("type") or {})
    if top.get("completed") or top.get("state") == "post":
        return True
    comps = ev.get("competitions", [])
    return bool(comps) and all(is_completed(c) for c in comps)

def post_forum(forum_id, title, body, role_id):
    content = ("<@&" + str(role_id) + ">\n" + body) if role_id else body
    content = content[:1990]
    code, resp = discord("POST", "/channels/" + str(forum_id) + "/threads", {
        "name": title[:95], "auto_archive_duration": 10080,
        "message": {"content": content,
                    "allowed_mentions": {"roles": [str(role_id)] if role_id else []}}})
    return code in (200, 201), resp

def load_json(path, default):
    try:
        with open(path, encoding="utf-8") as f: return json.load(f)
    except Exception:
        return default

def main():
    cfg = load_json(CONFIG, None)
    if not cfg:
        print("No mma_config.json - run mma_setup.py first."); return
    state = load_json(STATE, {"upcoming": [], "results": []})
    up_done = set(state.get("upcoming", [])); res_done = set(state.get("results", []))
    now = datetime.datetime.now(datetime.timezone.utc); posted = 0
    for league in LEAGUES:
        sb = espn(league + "/scoreboard")
        lg = sb.get("leagues") or []
        if not lg: continue
        calendar = lg[0].get("calendar", [])
        cache = {e["id"]: e for e in sb.get("events", [])}
        for c in calendar:
            eid = event_id((c.get("event") or {}).get("$ref"))
            if not eid: continue
            try: start = parse_dt(c["startDate"])
            except Exception: continue
            label = c.get("label", "MMA Event")
            if now < start <= now + datetime.timedelta(days=UPCOMING_DAYS) and eid not in up_done:
                ev = find_detail(league, eid, c["startDate"], cache)
                if ev:
                    bouts = ordered_bouts(ev)[:12]
                    when = start.strftime("%a %d %b %Y, %H:%M UTC")
                    body = "\U0001F4C5 **" + when + "**\n\n" + "\n".join(matchup_line(b) for b in bouts)
                    ok, _ = post_forum(cfg["upcoming_forum_id"], "\U0001F94A " + label, body, cfg.get("alerts_role_id"))
                    if ok: up_done.add(eid); posted += 1; print("posted upcoming:", label); time.sleep(1)
            if now - datetime.timedelta(days=RESULTS_LOOKBACK) <= start <= now and eid not in res_done:
                ev = find_detail(league, eid, c["startDate"], cache)
                if ev and event_done(ev):
                    lines = [result_line(b) for b in ordered_bouts(ev)[:14] if is_completed(b)]
                    if lines:
                        body = "⚠️ **Results - spoilers inside. Tap to reveal.**\n||" + "\n".join(lines) + "||"
                        ok, _ = post_forum(cfg["results_forum_id"], "\U0001F3C6 " + label + " - Results", body, cfg.get("results_role_id"))
                        if ok: res_done.add(eid); posted += 1; print("posted results:", label); time.sleep(1)
    state["upcoming"] = sorted(up_done); state["results"] = sorted(res_done)
    with open(STATE, "w", encoding="utf-8") as f:
        json.dump(state, f, indent=2)
    print("Done. New posts this run:", posted)

if __name__ == "__main__":
    main()
