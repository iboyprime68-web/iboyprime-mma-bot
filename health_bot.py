#!/usr/bin/env python3
"""Weekly ops health report - one silent embed in 📋-staff-chat.

Covers: every workflow's latest run status (GitHub API, the workflow-provided
token - no PAT), news-feed freshness, AutoMod rule count, state-file sizes and
the 7-day member trend (from snapshot_bot's daily history). Stateless - it
owns no state file and never commits.

Status honesty (July 2026 rewrite): the report used to count EVERY non-"success"
row as a red ❌ - so run-once setup workflows ("never ran"), brand-new cron bots
awaiting their first slot, and the 55-min watch-window bots that are legitimately
mid-run all showed up as failures. Now each workflow is classified:
  ok       latest completed run succeeded
  running  a run is in progress and the last completed run was fine (or it's the
           very first run) - normal for news/livealert/youtube watch windows
  awaiting a scheduled bot that simply hasn't hit its first cron slot yet
  manual   a run-once / deploy-time workflow (setup, register, polish) - never
           expected to run on Actions
  issue    the only bucket that is actually wrong (a real failure or a stale bot)
Only `issue` rows are red and only they count toward "things worth a look".
"""
import os, re, glob, json, urllib.request, common
import newsconfig

# Run-once / deploy-time workflows. These are driven locally by the deploy or by
# a one-off "run this after X" click - never having an Actions run is CORRECT.
MANUAL_WORKFLOWS = {
    "bots_setup.yml", "mod_setup.yml", "onboarding_setup.yml",
    "server_polish.yml", "setup.yml", "commands.yml",
}
# Fallback feed list if newsconfig can't be imported for any reason.
_FALLBACK_FEEDS = [
    ("MMA Fighting", "https://www.mmafighting.com/rss/current.xml"),
    ("Bloody Elbow", "https://bloodyelbow.com/feed/"),
]
_STALE_HOURS = 8 * 24        # a "healthy" cron bot silent for >8 days is suspect
_FAIL_CONCLUSIONS = {"failure", "timed_out", "startup_failure", "action_required"}


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


def _age_hours(run):
    ts = common.parse_iso((run or {}).get("updated_at"))
    return (common.now_utc() - ts).total_seconds() / 3600 if ts else None


def _latest_run(wf_id, completed_only=False):
    q = "?status=completed&per_page=1" if completed_only else "?per_page=1"
    runs = gh_api("/actions/workflows/%s/runs%s" % (wf_id, q))
    got = (runs or {}).get("workflow_runs") or []
    return got[0] if got else None


def classify_workflow(wf):
    """Return (name, cls, detail, age_hours) for one workflow. cls is one of
    ok / running / awaiting / manual / issue."""
    name = wf.get("name", "?")
    is_manual = os.path.basename(wf.get("path", "")) in MANUAL_WORKFLOWS
    run = _latest_run(wf["id"])
    if not run:
        if is_manual:
            return (name, "manual", "manual-only — deploy runs this locally", None)
        return (name, "awaiting", "awaiting first scheduled run", None)

    age = _age_hours(run)
    status = run.get("status")
    concl = run.get("conclusion")

    if status != "completed":                       # in-progress / queued right now
        done = _latest_run(wf["id"], completed_only=True)
        if not done:
            return (name, "running", "first run in progress", age)
        dc = done.get("conclusion")
        if dc == "success":
            return (name, "running", "running now · last completed ✅", _age_hours(done))
        if dc in _FAIL_CONCLUSIONS:
            return (name, "issue", "running now, but last completed run: %s" % dc, _age_hours(done))
        return (name, "running", "running now", _age_hours(done))

    # latest run is completed
    if concl == "success":
        if not is_manual and age is not None and age > _STALE_HOURS:
            return (name, "issue", "stale — last success %.0fd ago" % (age / 24), age)
        return (name, "ok", "", age)
    if concl in _FAIL_CONCLUSIONS:
        detail = concl if age is None else "%s (%.0fh ago)" % (concl, age)
        return (name, "issue", detail, age)
    # cancelled / skipped / neutral - not a failure (e.g. cancel-in-progress on selftest)
    return (name, "ok", concl or "", age)


def workflow_statuses():
    """[(name, cls, detail, age_hours)] for every active workflow, or None if the
    GitHub API is unavailable."""
    wfs = gh_api("/actions/workflows?per_page=100")
    if not wfs:
        return None
    return [classify_workflow(wf) for wf in wfs.get("workflows", [])
            if wf.get("state") == "active"]


def _parse_feed_date(text):
    """Newest publish time from an RSS (<pubDate>, RFC-822) or Atom
    (<updated>/<published>, ISO-8601) feed -> aware UTC datetime, or None."""
    m = re.search(r"<pubDate>([^<]+)<", text)
    if m:
        try:
            import email.utils
            dt = email.utils.parsedate_to_datetime(m.group(1).strip())
            if dt is not None:
                return dt if dt.tzinfo else dt.replace(tzinfo=common.datetime.timezone.utc)
        except Exception:
            pass
    m = re.search(r"<(?:updated|published)>([^<]+)<", text)
    if m:
        raw = m.group(1).strip().replace("Z", "+00:00")
        try:
            dt = common.datetime.datetime.fromisoformat(raw)
            return dt if dt.tzinfo else dt.replace(tzinfo=common.datetime.timezone.utc)
        except Exception:
            pass
    return None


def feed_ages():
    """[(label, age_hours_or_None, note)] for the feeds news_bot actually polls.
    Derived from newsconfig so health and news never drift apart."""
    try:
        feeds = [(label, url) for _k, label, url in newsconfig.enabled_sources(newsconfig.load())]
    except Exception as e:
        print("  newsconfig unavailable, using fallback feeds:", e)
        feeds = list(_FALLBACK_FEEDS)
    out = []
    for name, url in feeds:
        code, text = common.get_text(url, headers={"User-Agent": common.BROWSER_UA}, tries=2)
        if code != 200 or not text:
            out.append((name, None, "HTTP %s" % code if code else "network error"))
            continue
        dt = _parse_feed_date(text)
        if dt is None:
            out.append((name, None, "no date tag"))
            continue
        out.append((name, (common.now_utc() - dt).total_seconds() / 3600, None))
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


def _workflow_field(wf):
    """(field_dict, issue_count) for the ⚙️ Workflows section."""
    if wf is None:
        return {"name": "⚙️ Workflows", "value": "GitHub API unavailable", "inline": False}, 0
    order = ["ok", "running", "awaiting", "manual", "issue"]
    buckets = {k: 0 for k in order}
    issue_rows, awaiting_names = [], []
    for name, cls, detail, _age in wf:
        buckets[cls] = buckets.get(cls, 0) + 1
        if cls == "issue":
            issue_rows.append((name, detail))
        elif cls == "awaiting":
            awaiting_names.append(name)
    parts = ["%d workflows" % len(wf), "%d ✅" % buckets["ok"]]
    if buckets["running"]:
        parts.append("%d 🔄 running" % buckets["running"])
    if buckets["awaiting"]:
        parts.append("%d ⏳ awaiting first run" % buckets["awaiting"])
    if buckets["manual"]:
        parts.append("%d 🖱️ manual" % buckets["manual"])
    parts.append("%d ❌" % buckets["issue"])
    val = " · ".join(parts)
    for name, detail in issue_rows[:12]:
        val += "\n❌ %s — %s" % (name, detail)
    if len(issue_rows) > 12:
        val += "\n(+%d more)" % (len(issue_rows) - 12)
    if awaiting_names:
        val += "\n⏳ first run pending: " + ", ".join(awaiting_names)
    return {"name": "⚙️ Workflows", "value": val[:1000], "inline": False}, buckets["issue"]


def render(wf, feeds, rules_n, sizes, trend):
    issues = 0
    wf_field, wf_issues = _workflow_field(wf)
    issues += wf_issues
    fields = [wf_field]

    fv = []
    for name, age, note in feeds:
        if age is None:
            mark = "❓" if note == "no date tag" else "⛔"
            fv.append("%s %s — %s" % (mark, name, note or "unreachable"))
            issues += 1
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
