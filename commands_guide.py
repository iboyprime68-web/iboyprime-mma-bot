#!/usr/bin/env python3
"""Prime Arena - post/refresh the #bot-commands menu (idempotent edit-in-place).
Std-lib only (uses common.py)."""
import common

GUIDE = (
    "# 🤖 Bot Commands\n\n"
    "Type **/** in any channel and pick one — here's what's on offer:\n\n"
    "**🥊 MMA**\n"
    "`/nextevent` next card + countdown · `/event` the next card's lineup\n"
    "`/fighter` a fighter's profile & record\n"
    "`/onthisday` MMA history · `/trivia` test yourself\n\n"
    "**🎮 Fun & utility**\n"
    "`/poll` · `/8ball` · `/roll` dice · `/flip` coin\n"
    "`/avatar` · `/userinfo` · `/serverinfo` · `/help`\n\n"
    "**🔗 Links**\n"
    "`/youtube` search · `/links` all of iBoyPrime's channels\n\n"
    "**🎵 Music** — powered by **Jockie Music**:\n"
    "`/play <song or link>` · `/queue` · `/skip` · `/pause` · `/loop` · `/nowplaying`\n\n"
    "**📰 Fight news** posts itself, quietly, in %(mma_news)s — no pings, ever. "
    "Catch up when you feel like it.\n"
    "**📅 Upcoming cards** get their own thread in %(upcoming)s.\n\n"
    "_Clean, minimal, no ads. Suggest a command? Drop it in chat._"
)


def me_id():
    _, me = common.discord("GET", "/users/@me")
    return me.get("id") if isinstance(me, dict) else None


def render_guide(cfg):
    """Fill the channel links. A missing key degrades to a readable plain-text name
    instead of a dead grey <#0> chip (which is what the old '0' fallback rendered)."""
    chans = cfg.get("channels", {}) or {}
    fallback = {"mma_news": "the news channel", "upcoming": "the upcoming-fights forum"}
    ids = {k: ("<#%s>" % chans[k]) if chans.get(k) else fallback[k] for k in fallback}
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
