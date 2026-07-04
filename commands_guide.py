#!/usr/bin/env python3
"""iBoyPrime HQ - post/refresh the #bot-commands menu (idempotent edit-in-place).
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
    "**🔗 Links**\n"
    "`/youtube` search · `/links` all of iBoyPrime's channels\n\n"
    "**🎵 Music** — powered by **Jockie Music**:\n"
    "`/play <song or link>` · `/queue` · `/skip` · `/pause` · `/loop` · `/nowplaying`\n\n"
    "_Clean, minimal, no ads. Suggest a command? Drop it in chat._"
)


def me_id():
    _, me = common.discord("GET", "/users/@me")
    return me.get("id") if isinstance(me, dict) else None


def main():
    cfg = common.load_config()
    chan = cfg.get("channels", {}).get("bot_commands")
    if not chan:
        print("No bot_commands channel in config."); return
    bot_id = me_id()
    _, msgs = common.discord("GET", "/channels/%s/messages?limit=50" % chan)
    mine = [m for m in (msgs if isinstance(msgs, list) else []) if (m.get("author") or {}).get("id") == bot_id]
    if mine:
        keep = mine[0]
        if keep.get("content") != GUIDE:
            common.discord("PATCH", "/channels/%s/messages/%s" % (chan, keep["id"]), {"content": GUIDE})
            print("bot-commands guide: edited in place")
        else:
            print("bot-commands guide: already current")
        for m in mine[1:]:
            common.discord("DELETE", "/channels/%s/messages/%s" % (chan, m["id"]))
    else:
        code, _ = common.post_message(chan, GUIDE)
        print("bot-commands guide: posted (HTTP %s)" % code)


if __name__ == "__main__":
    main()
