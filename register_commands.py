#!/usr/bin/env python3
"""iBoyPrime HQ - register the slash commands with Discord (run once / on change).

Derives the application id from the bot token, then BULK-overwrites the guild's
command set (idempotent - re-running just syncs the exact list, never duplicates).
Run via the 'Register Commands' workflow after the Cloudflare Worker is live.
Std-lib only (uses common.py).
"""
import common

STRING, USER = 3, 6
DIVISIONS = ["Flyweight", "Bantamweight", "Featherweight", "Lightweight", "Welterweight",
             "Middleweight", "Light Heavyweight", "Heavyweight", "Men's Pound-for-Pound",
             "Women's Strawweight", "Women's Flyweight", "Women's Bantamweight",
             "Women's Pound-for-Pound"]


def cmd(name, desc, options=None):
    c = {"name": name, "description": desc, "type": 1}
    if options:
        c["options"] = options
    return c


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
