#!/usr/bin/env python3
"""iBoyPrime HQ - Bot #3: UFC rankings (board + movement alerts).

Source: free octagon-api (no key). IMPORTANT: that API gives fighters in ranked
order with NO rank field - rank = list position (index 0 = #1).

Two outputs in #rankings, both idempotent (re-running never duplicates):
  * BOARD - one message per division showing the current Top 15 (+ champion).
            Edited in place each run; posted on the very first run so the channel
            is populated immediately on deploy.
  * ALERTS - when something changes: 👑 new champion, 🆕 new entrant,
             ❌ dropped out, 📈/📉 moved >= 2 places (single-spot cascade noise
             is suppressed).
Std-lib only.
"""
import common

SOURCE     = "https://api.octagon-api.com/rankings"
MOVE_MIN   = 2
MAX_RANK   = 15
STATE_FILE = "state_rankings.json"


def is_p4p(div_id, name):
    s = (div_id or "") + " " + (name or "")
    return "pound-for-pound" in s.lower()


def normalize(raw):
    """list -> {division: {p4p, champion|None, ranks{int:name}}}, preserving order."""
    out = {}
    order = []
    if not isinstance(raw, list):
        return out, order
    for d in raw:
        if not isinstance(d, dict):
            continue
        div = d.get("categoryName") or d.get("id")
        if not div:
            continue
        p4p = is_p4p(d.get("id"), div)
        champ = None
        if not p4p:
            co = d.get("champion")
            if isinstance(co, dict):
                champ = co.get("championName") or co.get("name") or co.get("fighterName")
            elif isinstance(co, str):
                champ = co or None
        ranks = {}
        for i, f in enumerate(d.get("fighters", []) or []):
            nm = f.get("name") or f.get("fighterName") if isinstance(f, dict) else None
            if nm:
                ranks[i + 1] = nm
        if champ or ranks:
            out[div] = {"p4p": p4p, "champion": champ, "ranks": ranks}
            order.append(div)
    return out, order


def board_text(div, data):
    head = ("**🥇 %s**" % div) if data["p4p"] else (
        "**🥊 %s**%s" % (div, ("  ·  👑 %s" % data["champion"]) if data["champion"] else ""))
    lines = ["%d. %s" % (r, data["ranks"][r]) for r in sorted(data["ranks"])]
    return (head + "\n" + "\n".join(lines))[:1990]


def division_state(data):
    return {"p4p": data["p4p"], "champion": data["champion"],
            "ranks": {str(k): v for k, v in data["ranks"].items()}}


def diff_division(div, old, new):
    lines = []
    if not new["p4p"] and new["champion"] and new["champion"] != old.get("champion"):
        lines.append("👑 **%s** — new champion: **%s**" % (div, new["champion"]))
    old_ranks = {int(k): v for k, v in old.get("ranks", {}).items()}
    new_ranks = new["ranks"]
    old_by_name = {n: r for r, n in old_ranks.items()}
    new_names = set(new_ranks.values())
    for rank in sorted(new_ranks):
        name = new_ranks[rank]
        if name in old_by_name:
            delta = old_by_name[name] - rank
            if delta >= MOVE_MIN:
                lines.append("📈 **%s** climbed to #%d in %s (from #%d)" % (name, rank, div, old_by_name[name]))
            elif delta <= -MOVE_MIN:
                lines.append("📉 **%s** slipped to #%d in %s (from #%d)" % (name, rank, div, old_by_name[name]))
        elif name != old.get("champion") and rank <= MAX_RANK:
            lines.append("🆕 **%s** entered the %s rankings at #%d" % (name, div, rank))
    for name in old_by_name:
        if name not in new_names and name != new["champion"]:
            lines.append("❌ **%s** dropped out of the %s top 15" % (name, div))
    return lines


def post_or_edit(chan, msg_id, text):
    """Edit if msg_id exists; else post. Returns the (maybe new) message id."""
    if msg_id:
        code, _ = common.discord("PATCH", "/channels/%s/messages/%s" % (chan, msg_id), {"content": text})
        if code in (200, 201):
            return msg_id
    code, resp = common.post_message(chan, text)
    return resp.get("id") if (code in (200, 201) and isinstance(resp, dict)) else msg_id


def alert_post(chan, lines):
    """Movement alerts as ONE silent embed: no push noise (unread badge only),
    plain-text content for the preview, the detail lines inside the embed."""
    desc = "\n".join(lines)
    if len(desc) > 3900:                        # embed description cap is 4096
        kept = desc[:3900]
        cut = kept.rfind("\n")
        dropped = desc[cut:].count("\n")
        desc = kept[:cut] + "\n*…and %d more change(s)*" % dropped
    embed = {"title": "📊 UFC Rankings Update", "description": desc, "color": 0x3498DB}
    content = "UFC Rankings Update — %d change(s)" % len(lines)
    common.post_message(chan, content, embeds=[embed], silent=True)


def main():
    cfg = common.load_config()
    chan = cfg.get("channels", {}).get("rankings")
    if not chan:
        print("No rankings channel in config."); return
    code, raw = common.get_json(SOURCE)
    new, order = normalize(raw)
    if code != 200 or not new:
        print("Rankings fetch failed/empty (HTTP %s) - skipping." % code); return

    state = common.load_json(common.state_path(STATE_FILE), {})
    old_snap = state.get("snapshot") or {}
    board = state.get("board") or {}
    first = (not old_snap) or state.get("v") != 2   # re-seed cleanly if old/broken state

    # change alerts (only when we have a prior snapshot)
    alerts = []
    if not first:
        for div in order:
            if div in old_snap:
                alerts.append(("__%s__" % div, diff_division(div, old_snap[div], new[div])))
    flat = []
    for _h, lines in alerts:
        flat.extend(lines)
    if flat:
        alert_post(chan, flat)
        print("posted %d ranking changes" % len(flat))

    # board reconcile (edit in place; post on first run / when changed)
    new_snap = {}
    edits = posts = 0
    for div in order:
        new_snap[div] = division_state(new[div])
        changed = (old_snap.get(div) != new_snap[div])
        if div in board and not changed:
            continue
        text = board_text(div, new[div])
        mid = post_or_edit(chan, board.get(div), text)
        if mid:
            if board.get(div):
                edits += 1
            else:
                posts += 1
            board[div] = mid

    state["snapshot"] = new_snap
    state["board"] = board
    state["v"] = 2
    common.save_json(common.state_path(STATE_FILE), state)
    if first:
        print("First run: posted rankings board (%d divisions)." % posts)
    else:
        print("Done. board posts=%d edits=%d alerts=%d" % (posts, edits, len(flat)))


if __name__ == "__main__":
    main()
