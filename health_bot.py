#!/usr/bin/env python3
"""Weekly ops health report - one silent embed in 📋-staff-chat.

Covers: every workflow's latest run status (GitHub API, the workflow-provided
token - no PAT), news-feed freshness, AutoMod rule count, state-file sizes and
the 7-day member trend (from snapshot_bot's daily history). Stateless - it
owns no state file and never commits.
"""
import os, re, glob, json, urllib.request, common

FEEDS = [
    ("MMA Fighting", "https://www.mmafighting.com/rss/current.xml"),
    ("MMA Junkie",   "https://mmajunkie.usatoday.com/feed"),
    ("Bloody Elbow", "https://bloodyelbow.com/feed/"),
    ("Sherdog",      "https://www.sherdog.com/rss/news.xml"),
]


def gh_api(path):
    tok = os.environ.get("GH_API_TOKEN", "")
    repo = os.environ.get("GITHUB_REPOSITORY", "")
    if not tok or not repo:
        return None
    try:
        req = urllib.request.Request(
            "https://api.github.com/repos/%s%s" % (repo, path),
            headers={"Authorization": "Bearer " + tok,
                     "Accept": "application/vnd.github+json",
                     "User-Agent": "prime-arena-health"})
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.loads(r.read().decode())
    except Exception as e:
        print("  gh_api failed:", path, e)
        return None


def workflow_statuses():
    """[(name, conclusion, age_hours)] for every active workflow's latest run."""
    wfs = gh_api("/actions/workflows?per_page=100")
    if not wfs:
        return None
    out = []
    for wf in wfs.get("workflows", []):
        if wf.get("state") != "active":
            continue
        runs = gh_api("/actions/workflows/%s/runs?per_page=1" % wf["id"])
        run = (runs or {}).get("workflow_runs") or []
        if not run:
            out.append((wf["name"], "never ran", None))
            continue
        run = run[0]
        ts = common.parse_iso(run.get("updated_at"))
        age = (common.now_utc() - ts).total_seconds() / 3600 if ts else None
        concl = run.get("conclusion") or run.get("status") or "?"
        out.append((wf["name"], concl, age))
    return out


def feed_ages():
    """[(name, age_hours_or_None)] using each feed's newest pubDate."""
    out = []
    for name, url in FEEDS:
        age = None
        code, text = common.get_text(url, headers={"User-Agent": common.BROWSER_UA}, tries=2)
        if code == 200 and text:
            m = re.search(r"<pubDate>([^<]+)</pubDate>", text)
            if m:
                try:
                    import email.utils
                    dt = email.utils.parsedate_to_datetime(m.group(1).strip())
                    age = (common.now_utc() - dt).total_seconds() / 3600
                except Exception:
                    pass
        out.append((name, age))
    return out


def state_sizes():
    files = sorted(glob.glob(os.path.join(common.HERE, "state_*.json")))
    return [(os.path.basename(p), os.path.getsize(p)) for p in files]


def member_trend():
    hist = (common.load_json(common.state_path("state_snapshot.json"), {}) or {}).get("history") or {}
    if not hist:
        return None
    days = sorted(hist)
    latest = hist[days[-1]]
    week_ago = next((hist[d] for d in reversed(days)
                     if (common.now_utc() - common.parse_iso(d + "T00:00:00Z")).days >= 7), None)
    return latest, (latest - week_ago) if isinstance(week_ago, int) else None


def render(wf, feeds, rules_n, sizes, trend):
    fields, issues = [], 0
    if wf is None:
        fields.append({"name": "⚙️ Workflows", "value": "GitHub API unavailable", "inline": False})
    else:
        bad = [(n, c) for n, c, _ in wf if c not in ("success",)]
        issues += len(bad)
        val = "%d workflows · %d green" % (len(wf), len(wf) - len(bad))
        for n, c in bad[:8]:
            val += "\n❌ %s — %s" % (n, c)
        fields.append({"name": "⚙️ Workflows", "value": val[:1000], "inline": False})
    fv = []
    for name, age in feeds:
        if age is None:
            fv.append("❓ %s — unreachable" % name); issues += 1
        else:
            mark = "✅" if age < 72 else "⚠️"
            issues += (age >= 72)
            fv.append("%s %s — newest %.0fh ago" % (mark, name, age))
    fields.append({"name": "📰 Feeds", "value": "\n".join(fv)[:1000], "inline": False})
    fields.append({"name": "🛡️ AutoMod", "value": "%s active rules" % (rules_n if rules_n is not None else "?"),
                   "inline": True})
    total = sum(s for _, s in sizes)
    big = max(sizes, key=lambda x: x[1]) if sizes else ("-", 0)
    fields.append({"name": "💾 State files",
                   "value": "%d files · %.1f KB (largest: %s)" % (len(sizes), total / 1024, big[0]),
                   "inline": True})
    if trend:
        latest, delta = trend
        fields.append({"name": "👥 Members",
                       "value": "%d%s" % (latest, (" (%+d this week)" % delta) if delta is not None else ""),
                       "inline": True})
    else:
        fields.append({"name": "👥 Members", "value": "no trend data yet (snapshot bot builds it nightly)",
                       "inline": True})
    title = "🩺 Weekly health report"
    content = ("Weekly health report — all systems nominal." if issues == 0
               else "Weekly health report — %d thing(s) worth a look." % issues)
    embed = {"title": title, "fields": fields,
             "color": 0x2ECC71 if issues == 0 else 0xE67E22,
             "footer": {"text": "Runs Mondays · silent · stateless"}}
    return content, embed


def main():
    cfg = common.load_config()
    channel = (cfg.get("channels") or {}).get("staff_chat")
    if not channel:
        print("No staff_chat channel in config.")
        return
    wf = workflow_statuses()
    feeds = feed_ages()
    code, rules = common.discord("GET", "/guilds/%s/auto-moderation/rules" % cfg["guild_id"])
    rules_n = len(rules) if code == 200 and isinstance(rules, list) else None
    content, embed = render(wf, feeds, rules_n, state_sizes(), member_trend())
    ccode, _ = common.post_message(channel, content, embeds=[embed], silent=True)
    print("health report posted (HTTP %s)" % ccode)


if __name__ == "__main__":
    main()
