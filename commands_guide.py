#!/usr/bin/env python3
"""Prime Arena - post/refresh the #bot-commands menu (idempotent edit-in-place).
Std-lib only (uses common.py)."""
import common

GUIDE = (
    "# 🤖 Bot Commands\n\n"
    "Type **/** in any channel and pick one — here's what's on offer:\n\n"
    "**🥊 MMA**\n"
    "`/rankings` UFC division rankings · `/nextevent` next card + countdown\n"
    "`/event` the next card's lineup · `/fighter` a fighter's profile & record\n"
    "`/onthisday` MMA history · `/trivia` test yourself\n\n"
    "**🎮 Fun & utility**\n"
    "`/poll` · `/8ball` · `/roll` dice · `/flip` coin\n"
    "`/avatar` · `/userinfo` · `/serverinfo` · `/help`\n\n"
    "**📰 News**\n"
    "`/news status` how the wire is tuned · `/news follow breaking` or `digest` to opt into pings\n"
    "`/news unfollow …` to opt back out — that's all it takes\n\n"
    "**🏆 Community games** (no commands needed — just show up)\n"
    "**Pick'em**: vote on the fight-week poll in <#%(fight_week)s> — correct main-event picks score\n"
    "**Quiz night**: Fridays in <#%(mma_chat)s> — 5 timed questions, points for right answers\n"
    "Both feed ONE **Fight IQ leaderboard** in <#%(predictions)s>; top score each month wins the "
    "🏆 **Fight Prophet** role\n"
    "**Debate Monday** + **Fighter Spotlight Wednesday** in <#%(mma_chat)s>\n"
    "**Clip War**: weekly thread in <#%(plays_n_clips)s> — most reactions takes 🎬 **Clip Champ**\n\n"
    "**🔗 Links**\n"
    "`/youtube` search · `/links` all of iBoyPrime's channels\n\n"
    "**🎵 Music** — powered by **Jockie Music**:\n"
    "`/play <song or link>` · `/queue` · `/skip` · `/pause` · `/loop` · `/nowplaying`\n\n"
    "_Clean, minimal, no ads. Suggest a command? Drop it in chat._"
)


def me_id():
    _, me = common.discord("GET", "/users/@me")
    return me.get("id") if isinstance(me, dict) else None


def render_guide(cfg):
    """Fill the channel links; unknown keys fall back to a readable '#0' link."""
    chans = cfg.get("channels", {}) or {}
    ids = {k: chans.get(k) or "0"
           for k in ("fight_week", "mma_chat", "predictions", "plays_n_clips")}
    return GUIDE % ids


def main():
    cfg = common.load_config()
    chan = cfg.get("channels", {}).get("bot_commands")
    if not chan:
        print("No bot_commands channel in config."); return
    guide = render_guide(cfg)
    bot_id = me_id()
    _, msgs = common.discord("GET", "/channels/%s/messages?limit=50" % chan)
    mine = [m for m in (msgs if isinstance(msgs, list) else []) if (m.get("author") or {}).get("id") == bot_id]
    if mine:
        keep = mine[0]
        if keep.get("content") != guide:
            common.discord("PATCH", "/channels/%s/messages/%s" % (chan, keep["id"]), {"content": guide})
            print("bot-commands guide: edited in place")
        else:
            print("bot-commands guide: already current")
        for m in mine[1:]:
            common.discord("DELETE", "/channels/%s/messages/%s" % (chan, m["id"]))
    else:
        code, _ = common.post_message(chan, guide)
        print("bot-commands guide: posted (HTTP %s)" % code)


if __name__ == "__main__":
    main()
