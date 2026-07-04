#!/usr/bin/env python3
"""Friday MMA Quiz Night - 5 timed poll questions in 🥊-mma-chat.

One cron run (Fri 19:00 UTC) does the whole night:
  * intro post (silent), then 5 questions from quiz_data.json as native polls
    (each expired early after ~7 minutes via POST /polls/{id}/expire),
  * +1 quiz point per member who voted the correct answer (voters API),
  * a silent results recap, then the shared Fight IQ leaderboard is refreshed
    (points combine with pick'em - see predictions_bot).

The question bank rotates via a cursor (no repeats until the bank cycles).
A same-day guard makes accidental double runs a no-op, and the cursor is
persisted BEFORE the first question so a crash can't repeat questions.
Std-lib only; state_quiz.json is the ONLY file this bot writes.
"""
import time, common
import predictions_bot

STATE_FILE       = "state_quiz.json"
DATA_FILE        = "quiz_data.json"
QUESTIONS        = 5
QUESTION_SECONDS = 420        # ~7 min voting per question
BETWEEN_SECONDS  = 15


def tally_correct(channel, message_id, resp_poll, correct_idx):
    """Voter ids for the correct answer of one expired quiz poll."""
    answers = (resp_poll or {}).get("answers") or []
    aid = None
    if 0 <= correct_idx < len(answers):
        aid = answers[correct_idx].get("answer_id")
    if aid is None:
        aid = correct_idx + 1          # Discord assigns 1-based ids in practice
    return predictions_bot.answer_voters(channel, message_id, str(aid))


def main():
    cfg = common.load_config()
    channel = (cfg.get("channels") or {}).get("mma_chat")
    if not channel:
        print("No mma_chat channel in config.")
        return
    state = common.load_json(common.state_path(STATE_FILE), {})
    if state.get("v") != 1:
        state = {"v": 1, "cursor": 0, "last_run": "", "months": {}, "alltime": {}}
    today = common.now_utc().strftime("%Y-%m-%d")
    if state.get("last_run") == today:
        print("Quiz already ran today - nothing to do.")
        return
    bank = common.load_json(common.state_path(DATA_FILE), [])
    if not bank:
        print("No quiz_data.json bank - nothing to do.")
        return

    picks = [bank[(state["cursor"] + i) % len(bank)] for i in range(QUESTIONS)]
    state["cursor"] = (state["cursor"] + QUESTIONS) % len(bank)
    state["last_run"] = today
    common.save_json(common.state_path(STATE_FILE), state)
    common.persist_state(STATE_FILE)   # crash after this can never repeat questions

    common.post_message(
        channel,
        "🧠 MMA Quiz Night is LIVE — %d questions, about %d minutes each. "
        "Correct answers score Fight IQ points!" % (QUESTIONS, QUESTION_SECONDS // 60),
        silent=True)

    scores, recap = {}, []
    for i, q in enumerate(picks, 1):
        body = {"content": "",
                "flags": common.SILENT_FLAG,
                "poll": {"question": {"text": ("Q%d/%d · %s" % (i, QUESTIONS, q["q"]))[:300]},
                         "answers": [{"poll_media": {"text": a[:55]}} for a in q["answers"][:10]],
                         "duration": 1, "allow_multiselect": False}}
        code, resp = common.discord("POST", "/channels/%s/messages" % channel, body)
        if code not in (200, 201) or not isinstance(resp, dict) or not resp.get("id"):
            print("  question %d failed to post (%s) - skipped" % (i, code))
            continue
        mid = resp["id"]
        time.sleep(QUESTION_SECONDS)
        common.discord("POST", "/channels/%s/polls/%s/expire" % (channel, mid))
        voters = tally_correct(channel, mid, resp.get("poll"), int(q.get("correct", 0)))
        for uid in voters:
            scores[uid] = scores.get(uid, 0) + 1
        recap.append("Q%d: **%s** — %d got it" % (i, q["answers"][int(q.get("correct", 0))], len(voters)))
        print("  Q%d done: %d correct" % (i, len(voters)))
        if i < QUESTIONS:
            time.sleep(BETWEEN_SECONDS)

    mk = common.now_utc().strftime("%Y-%m")
    month = state["months"].setdefault(mk, {})
    for uid, pts in scores.items():
        month[uid] = month.get(uid, 0) + pts
        state["alltime"][uid] = state["alltime"].get(uid, 0) + pts
    common.save_json(common.state_path(STATE_FILE), state)
    common.persist_state(STATE_FILE)

    top = sorted(scores.items(), key=lambda kv: (-kv[1], kv[0]))[:5]
    desc = "\n".join(recap) or "No questions could be posted."
    if top:
        desc += "\n\n**Tonight's sharpest:**\n" + "\n".join(
            "%d. <@%s> — %d/%d" % (n, uid, pts, QUESTIONS) for n, (uid, pts) in enumerate(top, 1))
    common.post_message(channel, "Quiz night results — thanks for playing!",
                        embeds=[{"title": "🧠 Quiz Night results",
                                 "description": desc[:4000], "color": 0x9B59B6}],
                        silent=True)

    # refresh the shared Fight IQ board (predictions_bot owns the message; we only edit)
    common.refresh_checkout()
    pred = common.load_json(common.state_path("state_predictions.json"), {})
    predictions_bot.update_leaderboard(cfg, pred, state, can_create=False)
    print("Done. players=%d" % len(scores))


if __name__ == "__main__":
    main()
