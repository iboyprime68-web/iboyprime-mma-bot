#!/usr/bin/env python3
"""Fight Pick'em League - scores the fight-week prediction polls and keeps the
Fight IQ leaderboard.

Every 6 hours it:
  * finds fight-week hub polls (state_fightweek.json, READ-ONLY) whose event has
    finished - past events come from ESPN `scoreboard?dates=YYYYMMDD` (the bare
    scoreboard drops them),
  * awards +1 pick'em point to every member who voted for the main-event winner
    (poll-voters API, paginated 100/page),
  * edits the "Fight IQ Leaderboard" message in 🎯-predictions in place
    (pick'em + quiz-night points combined; quiz points are read from
    state_quiz.json, which quiz_bot owns),
  * on the first run of a new month, crowns last month's top combined scorer:
    the 🏆 Fight Prophet role moves from the previous holder (uid kept in
    state - no privileged member intent needed).

Skips-with-log when a card's main event changed (poll answers no longer match
the ESPN result) - it never guesses. Std-lib only; state_predictions.json is
the ONLY file this bot writes.
"""
import datetime, common

STATE_FILE      = "state_predictions.json"
FIGHTWEEK_STATE = "state_fightweek.json"
QUIZ_STATE      = "state_quiz.json"
GIVE_UP_DAYS    = 7      # stop retrying an event this long after its start
LEADER_TITLE    = "🏆 Fight IQ Leaderboard"
LEADER_MONTH_N  = 15
LEADER_ALL_N    = 10


def espn(path):
    _, d = common.get_json("https://site.api.espn.com/apis/site/v2/sports/mma/" + path)
    return d or {}


def month_key(dt):
    return dt.strftime("%Y-%m")


def month_name(mk):
    try:
        return datetime.datetime.strptime(mk, "%Y-%m").strftime("%B %Y")
    except Exception:
        return mk


def _norm(s):
    return (s or "").strip().casefold()


def find_event(league, eid, start_iso):
    """Look up a (possibly past) event by id via scoreboard?dates=YYYYMMDD."""
    d = common.parse_iso(start_iso)
    if not d:
        return None
    for delta in (0, 1, -1):
        day = (d + datetime.timedelta(days=delta)).strftime("%Y%m%d")
        sb = espn(league + "/scoreboard?dates=" + day)
        for ev in sb.get("events", []):
            if str(ev.get("id")) == str(eid):
                return ev
    return None


def main_event_result(ev):
    """(completed, winner_name_or_None, [names]) for the main event.
    Main event = LAST competition in raw ESPN order (fightweek reverses the
    list for display, so its top line == raw last)."""
    comps = ev.get("competitions") or []
    if not comps:
        return False, None, []
    main = comps[-1]
    names, winner = [], None
    for c in main.get("competitors", []):
        n = (c.get("athlete") or {}).get("displayName", "")
        if n:
            names.append(n)
        if c.get("winner") is True and n:
            winner = n
    st = (main.get("status") or {}).get("type") or {}
    return bool(st.get("completed")), winner, names


def poll_answers(channel_id, message_id):
    """Read the LIVE poll message -> {answer_id_str: answer_text}. The state's
    stored keys are not trusted - Discord assigns the real answer_ids."""
    code, msg = common.discord("GET", "/channels/%s/messages/%s" % (channel_id, message_id))
    if code != 200 or not isinstance(msg, dict) or not msg.get("poll"):
        return None
    out = {}
    for a in (msg["poll"].get("answers") or []):
        aid = a.get("answer_id")
        text = ((a.get("poll_media") or {}).get("text")) or ""
        if aid is not None:
            out[str(aid)] = text
    return out


def answer_voters(channel_id, message_id, answer_id):
    """Every voter id for one poll answer (paginated; works after expiry)."""
    users, after = [], None
    while True:
        path = "/channels/%s/polls/%s/answers/%s?limit=100" % (channel_id, message_id, answer_id)
        if after:
            path += "&after=" + after
        code, resp = common.discord("GET", path)
        if code != 200:
            break
        page = resp.get("users") if isinstance(resp, dict) else resp
        if not isinstance(page, list) or not page:
            break
        ids = [u.get("id") for u in page if isinstance(u, dict) and u.get("id")]
        users.extend(ids)
        if len(page) < 100 or not ids:
            break
        after = ids[-1]
    return users


def score_events(state, hubs):
    """Score every unprocessed finished hub poll. Returns #events scored."""
    now, scored = common.now_utc(), 0
    for eid, hub in hubs.items():
        if eid in state["processed"]:
            continue
        poll = hub.get("poll")
        if not poll or not poll.get("channel_id") or not poll.get("message_id"):
            state["processed"][eid] = "no_poll"
            continue
        start = common.parse_iso(poll.get("start") or "")
        if not start:
            state["processed"][eid] = "no_poll"
            continue
        if now < start:
            continue                                   # card hasn't happened yet
        ev = find_event(poll.get("league", "ufc"), eid, poll.get("start"))
        if not ev:
            if now > start + datetime.timedelta(days=GIVE_UP_DAYS):
                state["processed"][eid] = "expired"
                print("  gave up (no ESPN result):", eid)
            continue
        completed, winner, names = main_event_result(ev)
        if not completed:
            continue                                   # result not in yet - retry next run
        if not winner:
            state["processed"][eid] = "no_winner"
            print("  draw/NC - no points awarded:", eid)
            continue
        answers = poll_answers(poll["channel_id"], poll["message_id"])
        if answers is None:
            state["processed"][eid] = "no_poll"
            print("  poll message missing:", eid)
            continue
        # match after the same [:55] truncation fightweek applied when posting
        card = {_norm(n[:55]) for n in names}
        win_aid = next((aid for aid, txt in answers.items()
                        if _norm(txt) == _norm(winner[:55])), None)
        if win_aid is None or not {_norm(t) for t in answers.values()} <= card:
            state["processed"][eid] = "card_changed"
            print("  main event changed - skipped with no points:", eid)
            continue
        voters = answer_voters(poll["channel_id"], poll["message_id"], win_aid)
        mk = month_key(start)
        month = state["months"].setdefault(mk, {})
        for uid in voters:
            month[uid] = month.get(uid, 0) + 1
            state["alltime"][uid] = state["alltime"].get(uid, 0) + 1
        state["processed"][eid] = "scored"
        scored += 1
        print("  scored %s: %d correct pick(s) - winner %s" % (eid, len(voters), winner))
    return scored


def _top(scores, n):
    return sorted(scores.items(), key=lambda kv: (-kv[1], kv[0]))[:n]


def _medal(i):
    return {1: "🥇", 2: "🥈", 3: "🥉"}.get(i, "`#%d`" % i)


def render_leaderboard(pred, quiz):
    """The full board text, recomputed from BOTH state files every time."""
    mk = month_key(common.now_utc())
    pm = pred.get("months", {}).get(mk, {}) or {}
    qm = (quiz.get("months", {}) or {}).get(mk, {}) or {}
    pa = pred.get("alltime", {}) or {}
    qa = quiz.get("alltime", {}) or {}
    month_c, all_c = {}, {}
    for src, dest in ((pm, month_c), (qm, month_c), (pa, all_c), (qa, all_c)):
        for uid, pts in src.items():
            dest[uid] = dest.get(uid, 0) + pts
    lines = [LEADER_TITLE,
             "*Pick'em (fight-week polls) + Friday quiz night = one Fight IQ score.*", ""]
    lines.append("**This month — %s**" % month_name(mk))
    if month_c:
        for i, (uid, pts) in enumerate(_top(month_c, LEADER_MONTH_N), 1):
            lines.append("%s <@%s> — **%d** (🥊 %d · 🧠 %d)"
                         % (_medal(i), uid, pts, pm.get(uid, 0), qm.get(uid, 0)))
    else:
        lines.append("*No points yet — vote on the fight-week poll and play Friday quiz night!*")
    if all_c:
        lines += ["", "**All-time**"]
        for i, (uid, pts) in enumerate(_top(all_c, LEADER_ALL_N), 1):
            lines.append("%s <@%s> — %d" % (_medal(i), uid, pts))
    champ = pred.get("champion") or {}
    if champ.get("uid"):
        lines += ["", "👑 Reigning **Fight Prophet**: <@%s> (%s)"
                  % (champ["uid"], month_name(champ.get("month", "")))]
    return "\n".join(lines)


def update_leaderboard(cfg, pred, quiz, can_create=True):
    """Edit the board in place; adopt an existing board message before ever
    creating a new one (no duplicates if the stored id is lost). Only
    predictions_bot may create (quiz_bot passes can_create=False).
    Returns (channel_id, message_id) or None."""
    ch = (cfg.get("channels") or {}).get("predictions")
    if not ch:
        return None
    text = render_leaderboard(pred, quiz)[:1990]
    mid = (pred.get("leaderboard") or {}).get("message_id")
    if mid:
        code, _ = common.edit_message(ch, mid, content=text)
        if code in (200, 201):
            return ch, mid
    code, msgs = common.discord("GET", "/channels/%s/messages?limit=50" % ch)
    if code == 200 and isinstance(msgs, list):
        for m in msgs:
            if LEADER_TITLE in (m.get("content") or "") and (m.get("author") or {}).get("bot"):
                common.edit_message(ch, m["id"], content=text)
                return ch, m["id"]
    if not can_create:
        return None
    code, resp = common.post_message(ch, text, silent=True)
    if code in (200, 201) and isinstance(resp, dict) and resp.get("id"):
        return ch, resp["id"]
    return None


def crown_champion(state, quiz, cfg):
    """First run in a new month: move 🏆 Fight Prophet to last month's top
    COMBINED scorer. Returns (uid, month_key, points) when a crown happened."""
    now = common.now_utc()
    prev = month_key(now.replace(day=1) - datetime.timedelta(days=1))
    if (state.get("champion") or {}).get("month") == prev:
        return None
    combined = {}
    for src in (state.get("months", {}).get(prev, {}) or {},
                (quiz.get("months", {}) or {}).get(prev, {}) or {}):
        for uid, pts in src.items():
            combined[uid] = combined.get(uid, 0) + pts
    if not combined:
        return None                       # nothing played last month
    rid = (cfg.get("roles") or {}).get("fight_prophet")
    if not rid:
        print("  no fight_prophet role in config - crown skipped")
        return None
    winner, pts = _top(combined, 1)[0]
    gid = cfg["guild_id"]
    old = (state.get("champion") or {}).get("uid")
    if old and old != winner:
        common.discord("DELETE", "/guilds/%s/members/%s/roles/%s" % (gid, old, rid))
    common.discord("PUT", "/guilds/%s/members/%s/roles/%s" % (gid, winner, rid))
    state["champion"] = {"uid": winner, "month": prev}
    return winner, prev, pts


def main():
    cfg = common.load_config()
    common.refresh_checkout()             # freshest state_quiz/state_fightweek
    state = common.load_json(common.state_path(STATE_FILE), {})
    if state.get("v") != 1:
        state = {"v": 1, "processed": {}, "months": {}, "alltime": {},
                 "leaderboard": {}, "champion": {}}
    hubs = (common.load_json(common.state_path(FIGHTWEEK_STATE), {}) or {}).get("hubs", {})
    quiz = common.load_json(common.state_path(QUIZ_STATE), {}) or {}

    scored = score_events(state, hubs)
    crowned = crown_champion(state, quiz, cfg)
    ids = update_leaderboard(cfg, state, quiz, can_create=True)
    if ids:
        state["leaderboard"] = {"channel_id": ids[0], "message_id": ids[1]}

    common.save_json(common.state_path(STATE_FILE), state)
    common.persist_state(STATE_FILE)
    # congrats AFTER the state is persisted: a crash can drop the post, never double-crown
    if crowned:
        uid, prev, pts = crowned
        ch = (cfg.get("channels") or {}).get("predictions")
        if ch:
            common.post_message(
                ch,
                "🏆 Congrats <@%s> — Fight Prophet for %s with %d Fight IQ points! "
                "New month, new race." % (uid, month_name(prev), pts),
                allowed_mentions={"users": [uid]})
    print("Done. scored=%d crowned=%s hubs=%d" % (scored, bool(crowned), len(hubs)))


if __name__ == "__main__":
    main()
