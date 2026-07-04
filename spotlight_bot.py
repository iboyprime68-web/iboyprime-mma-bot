#!/usr/bin/env python3
"""Weekly Fighter Spotlight - a ranked fighter's story in 🥊-mma-chat.

Every Wednesday: picks the next fighter by rotating divisions (and walking down
the rankings one spot per full cycle), pulls their record/stats from the free
octagon-api (/rankings + /fighter/<slug>), and posts a silent embed with a
discussion prompt. Std-lib only; state_spotlight.json.
"""
import common

STATE_FILE = "state_spotlight.json"
RANKINGS   = "https://api.octagon-api.com/rankings"
FIGHTER    = "https://api.octagon-api.com/fighter/%s"


def slugify(name):
    s = (name or "").strip().lower()
    for ch in ("'", "’", "."):
        s = s.replace(ch, "")
    return "-".join(s.split())


def pick(divisions, state):
    """Rotate divisions each week; walk one rank deeper per full cycle."""
    usable = [d for d in divisions
              if not (d.get("categoryName") or "").lower().startswith("pound")
              and (d.get("fighters") or [])]
    if not usable:
        return None, None, None
    i = state.get("div_cursor", 0) % len(usable)
    div = usable[i]
    name = div.get("categoryName") or div.get("id") or "?"
    fighters = div.get("fighters") or []
    rank_idx = state.setdefault("per_div_rank", {}).get(name, 0) % min(len(fighters), 10)
    f = fighters[rank_idx]
    state["per_div_rank"].setdefault(name, 0)
    state["div_cursor"] = (i + 1) % len(usable)
    if state["div_cursor"] == 0:       # full lap done -> next spot in every division
        for k in list(state["per_div_rank"]):
            state["per_div_rank"][k] = state["per_div_rank"].get(k, 0) + 1
    return f, name, rank_idx + 1


def main():
    cfg = common.load_config()
    channel = (cfg.get("channels") or {}).get("mma_chat")
    if not channel:
        print("No mma_chat channel in config.")
        return
    state = common.load_json(common.state_path(STATE_FILE), {})
    if state.get("v") != 1:
        state = {"v": 1, "div_cursor": 0, "per_div_rank": {}, "last_posted": ""}
    today = common.now_utc().strftime("%Y-%m-%d")
    if state.get("last_posted") == today:
        print("Spotlight already posted today - nothing to do.")
        return

    code, divisions = common.get_json(RANKINGS)
    if code != 200 or not isinstance(divisions, list):
        print("octagon-api rankings unavailable (%s) - skipped." % code)
        return
    fighter, division, rank = pick(divisions, state)
    if not fighter:
        print("No ranked fighters found - skipped.")
        return
    name = fighter.get("name") or "?"
    slug = fighter.get("id") or slugify(name)
    _, detail = common.get_json(FIGHTER % slug)
    detail = detail if isinstance(detail, dict) else {}

    wins, losses, draws = (detail.get("wins") or "?"), (detail.get("losses") or "?"), (detail.get("draws") or "0")
    fields = []
    for label, key in (("Hometown", "placeOfBirth"), ("Trains at", "trainsAt"),
                       ("Age", "age"), ("Height", "height"), ("Reach", "reach")):
        val = detail.get(key)
        if val:
            fields.append({"name": label, "value": str(val)[:120], "inline": True})
    nickname = detail.get("nickname")
    title = "🔦 Fighter Spotlight: %s%s" % (name, (' "%s"' % nickname) if nickname else "")
    embed = {"title": title[:250],
             "description": "**#%d at %s** · record **%s-%s-%s**\n\nWhere does %s rank all-time in the division? Hot takes below 👇"
                            % (rank, division, wins, losses, draws, name.split()[0]),
             "color": 0xE67E22,
             "fields": fields[:6],
             "footer": {"text": "Weekly spotlight · data: octagon-api"}}
    code, _ = common.post_message(channel, "Fighter Spotlight: %s — #%d at %s" % (name, rank, division),
                                  embeds=[embed], silent=True)
    if code in (200, 201):
        state["last_posted"] = today
        common.save_json(common.state_path(STATE_FILE), state)
        common.persist_state(STATE_FILE)
        print("Spotlight posted:", name)
    else:
        print("Spotlight failed:", code)


if __name__ == "__main__":
    main()
