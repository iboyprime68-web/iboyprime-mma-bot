#!/usr/bin/env python3
"""iBoyPrime HQ - shared helpers for all cron bots (standard library only).

Every bot in this repo imports this module. It centralises:
  * resilient HTTP (text + JSON) with 429 rate-limit handling,
  * Discord REST calls using the DISCORD_BOT_TOKEN secret,
  * tiny JSON state load/save (state is committed back to the repo),
  * config loading (bots_config.json, written by bots_setup.py),
  * Discord timestamp + text helpers.

No third-party packages: this runs on a bare GitHub Actions runner.
"""
import os, re, json, time, datetime, subprocess, urllib.request, urllib.error

HERE     = os.path.dirname(os.path.abspath(__file__))
DISCORD  = "https://discord.com/api/v10"
BROWSER_UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
              "AppleWebKit/537.36 (KHTML, like Gecko) iBoyPrimeHQ/1.0")
DISCORD_UA = "iBoyPrimeHQ-bots (https://iboyprime, 1.0)"


def token():
    t = os.environ.get("DISCORD_BOT_TOKEN", "")
    if not t:
        raise SystemExit("ERROR: DISCORD_BOT_TOKEN is not set (add it as a GitHub secret).")
    return t


def http(url, headers=None, method="GET", body=None, raw_body=None, tries=4, timeout=30):
    """Low-level request. Returns (status_int, text). status 0 == transport failure.
    body -> JSON-encoded; raw_body -> sent as-is (bytes)."""
    h = {"User-Agent": BROWSER_UA, "Accept": "*/*"}
    if headers:
        h.update(headers)
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        h.setdefault("Content-Type", "application/json")
    else:
        data = raw_body
    last = (0, "")
    for attempt in range(tries):
        try:
            req = urllib.request.Request(url, data=data, headers=h, method=method)
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.status, r.read().decode("utf-8", "replace")
        except urllib.error.HTTPError as e:
            text = e.read().decode("utf-8", "replace")
            if e.code == 429:                      # rate limited - honour retry_after
                wait = 2.0
                try:
                    wait = float(json.loads(text).get("retry_after", 2))
                except Exception:
                    pass
                time.sleep(min(wait, 30) + 0.3)
                last = (429, text)
                continue
            return e.code, text                    # real HTTP error - hand back to caller
        except Exception as e:                     # DNS / timeout / reset - back off & retry
            last = (0, str(e))
            time.sleep(1.5 * (attempt + 1))
    return last


def get_text(url, headers=None, tries=4):
    return http(url, headers=headers, method="GET", tries=tries)


def get_json(url, headers=None, tries=4):
    code, text = http(url, headers=headers, method="GET", tries=tries)
    try:
        return code, (json.loads(text) if text else None)
    except Exception:
        return code, None


def discord(method, path, body=None):
    """Call the Discord REST API. Returns (status, parsed_json_or_text)."""
    h = {"Authorization": "Bot " + token(), "User-Agent": DISCORD_UA}
    code, text = http(DISCORD + path, headers=h, method=method, body=body)
    try:
        return code, (json.loads(text) if text else {})
    except Exception:
        return code, {"_raw": text}


# ---- posting helpers -------------------------------------------------------
NO_PINGS = {"parse": []}  # allowed_mentions that suppresses every ping


def post_message(channel_id, content, allowed_mentions=None, embeds=None):
    body = {"content": content[:1990],
            "allowed_mentions": allowed_mentions if allowed_mentions is not None else NO_PINGS}
    if embeds:
        body["embeds"] = embeds
    return discord("POST", "/channels/%s/messages" % channel_id, body)


def create_forum_thread(forum_id, title, content, allowed_mentions=None, applied_tags=None):
    body = {"name": title[:95], "auto_archive_duration": 10080,
            "message": {"content": content[:1990],
                        "allowed_mentions": allowed_mentions if allowed_mentions is not None else NO_PINGS}}
    if applied_tags:
        body["applied_tags"] = applied_tags
    return discord("POST", "/channels/%s/threads" % forum_id, body)


# ---- state / config --------------------------------------------------------
def load_json(path, default):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return default


def save_json(path, obj):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f, indent=2, ensure_ascii=False)


def state_path(name):
    return os.path.join(HERE, name)


def load_config():
    cfg = load_json(os.path.join(HERE, "bots_config.json"), None)
    if not cfg:
        raise SystemExit("No bots_config.json - run bots_setup.py first.")
    return cfg


# ---- near-real-time loop + durable state ----------------------------------
def in_ci():
    """True when running inside a GitHub Actions job."""
    return os.environ.get("GITHUB_ACTIONS") == "true"


def run_loop(poll_once, duration=255, interval=60):
    """Run poll_once() repeatedly inside ONE job so latency is ~`interval`s
    instead of the 5-min GitHub-cron floor. Fires once now, then every
    `interval`s until ~`duration`s have elapsed (kept under 5 min so the next
    cron tick doesn't pile up - the workflows already serialise via a
    `concurrency` group). Each call is guarded so one failed poll just logs and
    the loop continues. OUTSIDE Actions (local runs / tests) it does a single
    pass, so `python <bot>.py` still behaves like before. Returns the count."""
    single = not in_ci()
    start = time.time()
    n = 0
    while True:
        n += 1
        try:
            poll_once()
        except Exception as e:
            print("  loop iteration error:", e)
        if single or (time.time() - start + interval) >= duration:
            break
        time.sleep(interval)
    return n


def persist_state(filename, message=None):
    """Commit + push ONE state file immediately (mid-loop), so a long-running
    job that posts at minute 1 doesn't re-post if it dies before minute 5.
    No-op unless in Actions (local/test runs never touch git). Every git step is
    guarded - a failure here must never break posting; the workflow's end-of-job
    'Save state' step is the backstop. Mirrors that step (pull --rebase handles
    pushes from other bot workflows)."""
    if not in_ci():
        return
    msg = message or ("%s [skip ci]" % filename)
    for cmd in (
        ["git", "config", "user.name", "iboyprime-bot"],
        ["git", "config", "user.email", "bot@users.noreply.github.com"],
        ["git", "add", filename],
        ["git", "commit", "-m", msg],
        ["git", "pull", "--rebase", "--autostash"],
        ["git", "push"],
    ):
        try:
            subprocess.run(cmd, cwd=HERE, capture_output=True, timeout=90)
        except Exception as e:
            print("  persist_state(%s): %s -> %s" % (filename, " ".join(cmd[:2]), e))


# ---- time / text helpers ---------------------------------------------------
def parse_iso(s):
    """Parse an ISO8601 timestamp (handles a trailing Z) -> aware UTC datetime."""
    if not s:
        return None
    s = s.strip().replace("Z", "+0000")
    for fmt in ("%Y-%m-%dT%H:%M%z", "%Y-%m-%dT%H:%M:%S%z", "%Y-%m-%dT%H:%M:%S.%f%z"):
        try:
            return datetime.datetime.strptime(s, fmt).astimezone(datetime.timezone.utc)
        except Exception:
            pass
    return None


def now_utc():
    return datetime.datetime.now(datetime.timezone.utc)


def unix(dt):
    return int(dt.timestamp())


def dts(ts, style="F"):
    """Discord auto-localised timestamp markup, e.g. <t:1700000000:F>."""
    return "<t:%d:%s>" % (int(ts), style)


def iso_to_unix(s):
    dt = parse_iso(s)
    return unix(dt) if dt else None


def clean(s):
    """Strip HTML tags / collapse whitespace - for RSS titles & summaries."""
    s = re.sub(r"<!\[CDATA\[(.*?)\]\]>", r"\1", s or "", flags=re.S)
    s = re.sub(r"<[^>]+>", "", s)
    s = (s.replace("&amp;", "&").replace("&#39;", "'").replace("&rsquo;", "'")
           .replace("&lsquo;", "'").replace("&quot;", '"').replace("&ldquo;", '"')
           .replace("&rdquo;", '"').replace("&nbsp;", " ").replace("&hellip;", "...")
           .replace("&#8217;", "'").replace("&#8216;", "'").replace("&#8220;", '"')
           .replace("&#8221;", '"').replace("&mdash;", "-").replace("&ndash;", "-"))
    return re.sub(r"\s+", " ", s).strip()


def truncate(s, n):
    s = s or ""
    return s if len(s) <= n else s[:n - 1].rstrip() + "…"
