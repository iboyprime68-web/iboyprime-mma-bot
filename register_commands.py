#!/usr/bin/env python3
"""iBoyPrime HQ - register the slash commands with Discord (run once / on change).

Derives the application id from the bot token, then BULK-overwrites the guild's
command set (idempotent - re-running just syncs the exact list, never duplicates).
Run via the 'Register Commands' workflow after the Cloudflare Worker is live.
Std-lib only (uses common.py).
"""
import common

SUB, SUB_GROUP, STRING, INTEGER, USER, CHANNEL = 1, 2, 3, 4, 6, 7
USER_CTX, MSG_CTX = 2, 3                      # context-menu command types
DIVISIONS = ["Flyweight", "Bantamweight", "Featherweight", "Lightweight", "Welterweight",
             "Middleweight", "Light Heavyweight", "Heavyweight", "Men's Pound-for-Pound",
             "Women's Strawweight", "Women's Flyweight", "Women's Bantamweight",
             "Women's Pound-for-Pound"]
MOD_CATS = ["slurs", "nsfw_text", "profanity", "sensitive", "ads", "scam"]
MEDIA = ["allow", "no_links", "no_attachments", "sfw_only", "text_only"]
PROFILES = ["anything_goes", "standard", "sfw_strict"]
NEWS_MODES = ["realtime", "hybrid", "digest"]
NEWS_SOURCES = ["mma_fighting", "mma_junkie", "bloody_elbow", "sherdog", "bad_left_hook", "boxing_scene"]
NEWS_CATS = ["ufc", "mma_other", "boxing"]
NEWS_PINGS = ["breaking", "digest"]


def cmd(name, desc, options=None):
    c = {"name": name, "description": desc, "type": 1}
    if options:
        c["options"] = options
    return c


def ctx(name, ctype):
    return {"name": name, "type": ctype}      # context menu: no description / options


def choices(values):
    return [{"name": v, "value": v} for v in values]


COMMANDS = [
    cmd("help", "List all iBoyPrime HQ commands"),
    cmd("links", "All of iBoyPrime's channels"),
    cmd("rankings", "Current UFC rankings for a division", [
        {"type": STRING, "name": "division", "description": "Weight class", "required": True,
         "choices": [{"name": d, "value": d} for d in DIVISIONS]}]),
    cmd("nextevent", "The next UFC/PFL/Bellator card + a countdown"),
    cmd("event", "The next card's full lineup"),
    cmd("fighter", "Look up a fighter's profile & record", [
        {"type": STRING, "name": "name", "description": "Fighter's full name", "required": True}]),
    cmd("onthisday", "What happened on this day in MMA history"),
    cmd("trivia", "A random MMA trivia question"),
    cmd("poll", "Start a quick poll", [
        {"type": STRING, "name": "question", "description": "The poll question", "required": True},
        {"type": STRING, "name": "option1", "description": "Option 1", "required": False},
        {"type": STRING, "name": "option2", "description": "Option 2", "required": False},
        {"type": STRING, "name": "option3", "description": "Option 3", "required": False},
        {"type": STRING, "name": "option4", "description": "Option 4", "required": False}]),
    cmd("8ball", "Ask the magic 8-ball", [
        {"type": STRING, "name": "question", "description": "Your question", "required": True}]),
    cmd("roll", "Roll dice (e.g. 2d6)", [
        {"type": STRING, "name": "dice", "description": "Dice spec like 1d20 (default 1d6)", "required": False}]),
    cmd("flip", "Flip a coin"),
    cmd("avatar", "Show a user's avatar", [
        {"type": USER, "name": "user", "description": "Who (default you)", "required": False}]),
    cmd("userinfo", "Info about a user", [
        {"type": USER, "name": "user", "description": "Who (default you)", "required": False}]),
    cmd("serverinfo", "Info about this server"),
    cmd("youtube", "Search YouTube", [
        {"type": STRING, "name": "query", "description": "What to search", "required": True}]),

    # ----- news feed -----
    {"name": "news", "description": "News wire: follow pings, or tune it (staff)", "type": 1, "options": [
        {"type": SUB, "name": "status", "description": "How the news wire is tuned + your ping subscriptions"},
        {"type": SUB, "name": "follow", "description": "Opt INTO news pings (breaking or the daily digest)", "options": [
            {"type": STRING, "name": "what", "description": "Which pings", "required": True, "choices": choices(NEWS_PINGS)}]},
        {"type": SUB, "name": "unfollow", "description": "Opt OUT of news pings", "options": [
            {"type": STRING, "name": "what", "description": "Which pings", "required": True, "choices": choices(NEWS_PINGS)}]},
        {"type": SUB, "name": "mode", "description": "Delivery mode (staff)", "options": [
            {"type": STRING, "name": "value", "description": "realtime = every story loud · hybrid = silent + breaking/digest · digest = digest only",
             "required": True, "choices": choices(NEWS_MODES)}]},
        {"type": SUB, "name": "source", "description": "Turn a news outlet on/off (staff)", "options": [
            {"type": STRING, "name": "name", "description": "Outlet", "required": True, "choices": choices(NEWS_SOURCES)},
            {"type": STRING, "name": "state", "description": "on / off", "required": True, "choices": choices(["on", "off"])}]},
        {"type": SUB, "name": "category", "description": "Turn a news topic on/off (staff)", "options": [
            {"type": STRING, "name": "name", "description": "Topic", "required": True, "choices": choices(NEWS_CATS)},
            {"type": STRING, "name": "state", "description": "on / off", "required": True, "choices": choices(["on", "off"])}]},
        {"type": SUB_GROUP, "name": "keyword", "description": "Edit the breaking/exclude keyword lists (staff)", "options": [
            {"type": SUB, "name": "add", "description": "Add a keyword", "options": [
                {"type": STRING, "name": "list", "description": "Which list", "required": True, "choices": choices(["breaking", "exclude"])},
                {"type": STRING, "name": "word", "description": "Keyword or phrase", "required": True}]},
            {"type": SUB, "name": "remove", "description": "Remove a keyword", "options": [
                {"type": STRING, "name": "list", "description": "Which list", "required": True, "choices": choices(["breaking", "exclude"])},
                {"type": STRING, "name": "word", "description": "Keyword or phrase", "required": True}]}]},
    ]},

    # ----- moderation (staff) -----
    {"name": "mod", "description": "Per-channel moderation config (staff)", "type": 1, "options": [
        {"type": SUB_GROUP, "name": "channel", "description": "Channel profile", "options": [
            {"type": SUB, "name": "set-profile", "description": "Point a channel at a profile", "options": [
                {"type": CHANNEL, "name": "channel", "description": "Channel", "required": True},
                {"type": STRING, "name": "profile", "description": "Profile", "required": True, "choices": choices(PROFILES)}]}]},
        {"type": SUB_GROUP, "name": "category", "description": "Toggle a filter in a channel", "options": [
            {"type": SUB, "name": "enable", "description": "Enable a filter in a channel", "options": [
                {"type": CHANNEL, "name": "channel", "description": "Channel", "required": True},
                {"type": STRING, "name": "category", "description": "Filter", "required": True, "choices": choices(MOD_CATS)}]},
            {"type": SUB, "name": "disable", "description": "Disable a filter in a channel", "options": [
                {"type": CHANNEL, "name": "channel", "description": "Channel", "required": True},
                {"type": STRING, "name": "category", "description": "Filter", "required": True, "choices": choices(MOD_CATS)}]}]},
        {"type": SUB_GROUP, "name": "media", "description": "Channel media/link policy", "options": [
            {"type": SUB, "name": "policy", "description": "Set the media/link policy", "options": [
                {"type": CHANNEL, "name": "channel", "description": "Channel", "required": True},
                {"type": STRING, "name": "policy", "description": "Policy", "required": True, "choices": choices(MEDIA)}]}]},
        {"type": SUB_GROUP, "name": "word", "description": "Edit a filter's word list", "options": [
            {"type": SUB, "name": "add", "description": "Add a banned word/phrase", "options": [
                {"type": STRING, "name": "category", "description": "Filter", "required": True, "choices": choices(MOD_CATS)},
                {"type": STRING, "name": "word", "description": "Word or phrase (wildcards ok)", "required": True}]},
            {"type": SUB, "name": "remove", "description": "Remove a banned word/phrase", "options": [
                {"type": STRING, "name": "category", "description": "Filter", "required": True, "choices": choices(MOD_CATS)},
                {"type": STRING, "name": "word", "description": "Word or phrase", "required": True}]}]},
        {"type": SUB_GROUP, "name": "raid", "description": "Raid protection", "options": [
            {"type": SUB, "name": "on", "description": "Enable raid protection"},
            {"type": SUB, "name": "off", "description": "Disable raid protection"}]},
        {"type": SUB, "name": "status", "description": "Show the current moderation setup"},
        {"type": SUB, "name": "view", "description": "Show a channel's effective rules", "options": [
            {"type": CHANNEL, "name": "channel", "description": "Channel", "required": True}]},
    ]},
    cmd("warn", "Warn a member (staff)", [
        {"type": USER, "name": "user", "description": "Member", "required": True},
        {"type": STRING, "name": "reason", "description": "Reason", "required": False}]),
    cmd("timeout", "Timeout a member (staff)", [
        {"type": USER, "name": "user", "description": "Member", "required": True},
        {"type": INTEGER, "name": "minutes", "description": "Minutes (default 10)", "required": False},
        {"type": STRING, "name": "reason", "description": "Reason", "required": False}]),
    cmd("ban", "Ban a member (staff)", [
        {"type": USER, "name": "user", "description": "Member", "required": True},
        {"type": STRING, "name": "reason", "description": "Reason", "required": False}]),
    cmd("unban", "Unban a user by ID (staff)", [
        {"type": STRING, "name": "user_id", "description": "User ID", "required": True}]),
    cmd("clear", "Bulk-delete recent messages in this channel (staff)", [
        {"type": INTEGER, "name": "count", "description": "How many (1-100)", "required": True}]),
    cmd("modlogs", "Show a member's warnings (staff)", [
        {"type": USER, "name": "user", "description": "Member", "required": True}]),

    # ----- right-click context menus -----
    ctx("Timeout 10m", USER_CTX),
    ctx("Warn", USER_CTX),
    ctx("Mod record", USER_CTX),
    ctx("Delete & warn author", MSG_CTX),
]


def main():
    cfg = common.load_config()
    guild = cfg["guild_id"]
    code, app = common.discord("GET", "/oauth2/applications/@me")
    app_id = app.get("id") if isinstance(app, dict) else None
    if not app_id:
        print("Could not resolve application id (HTTP %s)." % code); return
    code, resp = common.discord("PUT", "/applications/%s/guilds/%s/commands" % (app_id, guild), COMMANDS)
    if code in (200, 201):
        print("Registered %d guild commands for %s." % (len(resp) if isinstance(resp, list) else len(COMMANDS), guild))
    else:
        print("Registration failed: HTTP %s %s" % (code, str(resp)[:200]))


if __name__ == "__main__":
    main()
