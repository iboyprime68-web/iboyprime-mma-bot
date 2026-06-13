#!/usr/bin/env python3
"""iBoyPrime HQ - Bot #3: UFC rankings tracker.

Polls the free octagon-api UFC rankings (no key), diffs against the committed
snapshot, and posts movement to #rankings:
  * 👑 new champion
  * 🆕 new entrant to a division's top 15
  * 📈/📉 climbs or drops of >= 2 places (single-spot shifts are cascade noise
    from someone else moving, so they're suppressed)
First run seeds silently. Defensive parsing - if the source shape changes or is
down, it skips without false posts. Std-lib only.
"""
import common

SOURCE       = "https://api.octagon-api.com/rankings"
MOVE_MIN     = 2          # report moves of >= this many places
MAX_RANK     = 15
STATE_FILE   = "state_rankings.json"


def normalize(raw):
    """raw (dict keyed by division) -> {division: {'champion': name|None, 'ranks': {int: name}}}"""
    out = {}
    if not isinstance(raw, dict):
        return out
    for key, val in raw.items():
        if not isinstance(val, dict):
            continue
        div = val.get("categoryName") or key
        champ = None
        co = val.get("champion")
        if isinstance(co, dict):
            champ = co.get("fighterName") or co.get("championName") or co.get("name")
        elif isinstance(co, str):
            champ = co or None
        ranks = {}
        for f in val.get("fighters", []) or []:
            if not isinstance(f, dict):
                continue
            name = f.get("fighterName") or f.get("name")
            r = str(f.get("rank", "")).strip()
            if not name:
                continue
            if r.isdigit():
                ranks[int(r)] = name
            elif r.lower() in ("c", "champ", "champion") and not champ:
                champ = name
        if champ or ranks:
            out[div] = {"champion": champ, "ranks": ranks}
    return out


def snapshot_for_state(norm):
    return {d: {"champion": v["champion"],
                "ranks": {str(k): n for k, n in v["ranks"].items()}}
            for d, v in norm.items()}


def diff_division(div, old, new):
    lines = []
    old_champ = old.get("champion")
    new_champ = new.get("champion")
    if new_champ and new_champ != old_champ:
        lines.append("👑 **New champion — %s!**" % new_champ)
    old_ranks = {int(k): v for k, v in old.get("ranks", {}).items()}
    new_ranks = new.get("ranks", {})
    old_by_name = {n: r for r, n in old_ranks.items()}
    for rank in sorted(new_ranks):
        name = new_ranks[rank]
        if name in old_by_name:
            delta = old_by_name[name] - rank      # +ve = climbed
            if delta >= MOVE_MIN:
                lines.append("📈 **%s** climbed to #%d (from #%d)" % (name, rank, old_by_name[name]))
            elif delta <= -MOVE_MIN:
                lines.append("📉 **%s** slipped to #%d (from #%d)" % (name, rank, old_by_name[name]))
        elif name != old_champ and rank <= MAX_RANK:
            lines.append("🆕 **%s** entered the rankings at #%d" % (name, rank))
    return lines


def chunk_and_post(chan, header, blocks):
    msg = header
    for block in blocks:
        add = "\n\n" + block
        if len(msg) + len(add) > 1900:
            common.post_message(chan, msg)
            msg = block
        else:
            msg += add
    if msg.strip():
        common.post_message(chan, msg)


def main():
    cfg = common.load_config()
    chan = cfg.get("channels", {}).get("rankings")
    if not chan:
        print("No rankings channel in config."); return
    code, raw = common.get_json(SOURCE)
    norm = normalize(raw)
    if code != 200 or not norm:
        print("Rankings fetch failed/empty (HTTP %s) - skipping." % code); return

    state = common.load_json(common.state_path(STATE_FILE), {})
    old = state.get("snapshot")
    new_state = snapshot_for_state(norm)

    if not old:
        state["snapshot"] = new_state
        common.save_json(common.state_path(STATE_FILE), state)
        print("First run: seeded %d divisions silently." % len(new_state)); return

    blocks = []
    for div in norm:
        if div not in old:           # newly-tracked division -> seed, don't dump
            continue
        lines = diff_division(div, old[div], norm[div])
        if lines:
            blocks.append("__%s__\n%s" % (div, "\n".join(lines)))

    if blocks:
        chunk_and_post(chan, "📊 **UFC Rankings Update**", blocks)
        print("Posted %d division updates." % len(blocks))
    else:
        print("No notable movement.")

    state["snapshot"] = new_state
    common.save_json(common.state_path(STATE_FILE), state)


if __name__ == "__main__":
    main()
