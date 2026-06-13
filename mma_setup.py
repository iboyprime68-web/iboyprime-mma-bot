#!/usr/bin/env python3
"""iBoyPrime HQ - MMA setup + security hardening (run once).
Creates fight-alert/results roles + two MMA forums, updates onboarding with a
spoiler-warned results option, audits/locks down roles, writes mma_config.json.
Std-lib only. Safe to re-run.
"""
import os, json, time, urllib.request, urllib.error

TOKEN    = os.environ.get("DISCORD_BOT_TOKEN", "")
if not TOKEN:
    raise SystemExit("ERROR: set the DISCORD_BOT_TOKEN GitHub secret.")
GUILD_ID = os.environ.get("DISCORD_GUILD_ID", "1502831752702464113")
HERE     = os.path.dirname(os.path.abspath(__file__))
API = "https://discord.com/api/v10"
H = {"Authorization": "Bot " + TOKEN, "Content-Type": "application/json",
     "User-Agent": "iBoyPrimeMMA (https://iboyprime, 1.0)"}

P = {n: 1 << b for n, b in {
    "CREATE_INVITE":0,"KICK":1,"BAN":2,"ADMINISTRATOR":3,"MANAGE_CHANNELS":4,"MANAGE_GUILD":5,
    "ADD_REACTIONS":6,"VIEW_AUDIT_LOG":7,"PRIORITY_SPEAKER":8,"STREAM":9,"VIEW_CHANNEL":10,
    "SEND_MESSAGES":11,"SEND_TTS":12,"MANAGE_MESSAGES":13,"EMBED_LINKS":14,"ATTACH_FILES":15,
    "READ_HISTORY":16,"MENTION_EVERYONE":17,"EXT_EMOJIS":18,"VIEW_INSIGHTS":19,"CONNECT":20,
    "SPEAK":21,"MUTE":22,"DEAFEN":23,"MOVE":24,"USE_VAD":25,"CHANGE_NICK":26,"MANAGE_NICKS":27,
    "MANAGE_ROLES":28,"MANAGE_WEBHOOKS":29,"MANAGE_EXPRESSIONS":30,"USE_APP_CMDS":31,
    "REQUEST_SPEAK":32,"MANAGE_EVENTS":33,"MANAGE_THREADS":34,"CREATE_PUB_THREAD":35,
    "CREATE_PRIV_THREAD":36,"EXT_STICKERS":37,"SEND_IN_THREADS":38,"USE_ACTIVITIES":39,
    "MODERATE_MEMBERS":40,
}.items()}

DANGEROUS = (P["ADMINISTRATOR"]|P["MANAGE_GUILD"]|P["MANAGE_ROLES"]|P["MANAGE_CHANNELS"]|P["KICK"]|
             P["BAN"]|P["MANAGE_WEBHOOKS"]|P["MANAGE_EXPRESSIONS"]|P["MANAGE_MESSAGES"]|
             P["MENTION_EVERYONE"]|P["MODERATE_MEMBERS"]|P["MANAGE_NICKS"]|P["VIEW_AUDIT_LOG"]|
             P["MANAGE_EVENTS"]|P["MANAGE_THREADS"]|P["MUTE"]|P["DEAFEN"]|P["MOVE"]|P["PRIORITY_SPEAKER"])
MOD_KIT   = (P["KICK"]|P["MODERATE_MEMBERS"]|P["MANAGE_MESSAGES"]|P["MANAGE_THREADS"]|P["MUTE"]|
             P["DEAFEN"]|P["MOVE"]|P["VIEW_AUDIT_LOG"]|P["MANAGE_NICKS"])
ADMIN_KIT = (MOD_KIT|P["BAN"]|P["MANAGE_CHANNELS"]|P["MANAGE_ROLES"]|P["MANAGE_WEBHOOKS"]|
             P["MANAGE_EXPRESSIONS"]|P["MANAGE_EVENTS"]|P["CREATE_INVITE"])

SELF_ASSIGN = {"🎮 Gamer","🥊 MMA Fan","🔴 Live Pings","📹 YouTube Pings","🎬 TikTok Pings",
               "📣 Announcements","🎉 Events","🥊 Fight Alerts","🚨 Fight Results","🤝 Member","🤖 Bots"}

def api(method, path, body=None, tries=6):
    data = json.dumps(body).encode() if body is not None else None
    for _ in range(tries):
        try:
            req = urllib.request.Request(API+path, data=data, headers=H, method=method)
            with urllib.request.urlopen(req, timeout=30) as r:
                raw = r.read().decode(); return json.loads(raw) if raw else {}
        except urllib.error.HTTPError as e:
            raw = e.read().decode()
            if e.code == 429:
                try: w = float(json.loads(raw).get("retry_after",2))
                except Exception: w = 2
                time.sleep(w+0.3); continue
            raise RuntimeError(method+" "+path+" -> "+str(e.code)+": "+raw[:200])
        except urllib.error.URLError:
            time.sleep(2)
    raise RuntimeError("request failed: "+path)

def ow(rid, allow=0, deny=0):
    return {"id": str(rid), "type": 0, "allow": str(allow), "deny": str(deny)}

def main():
    everyone = GUILD_ID
    guild = api("GET", "/guilds/"+GUILD_ID)
    roles = {r["name"]: r for r in guild.get("roles", [])}
    print("Server:", guild.get("name"))

    def ensure_role(nm, color):
        if nm in roles:
            print("  - role exists:", nm); return roles[nm]["id"]
        r = api("POST", "/guilds/"+GUILD_ID+"/roles",
                {"name": nm, "color": color, "hoist": False, "mentionable": False, "permissions": "0"})
        roles[nm] = r; print("  + role:", nm); time.sleep(0.3); return r["id"]
    alerts_id  = ensure_role("🥊 Fight Alerts",  0xE67E22)
    results_id = ensure_role("🚨 Fight Results", 0xC0392B)
    staff_ids = [roles[n]["id"] for n in ("👑 Owner","🛡️ Admin","🔨 Moderator") if n in roles]

    chans = {c["name"]: c for c in api("GET", "/guilds/"+GUILD_ID+"/channels")}
    mma_cat = next((c["id"] for c in chans.values() if c["type"] == 4 and c["name"].startswith("🥊")), None)

    def ensure_forum(nm, overwrites, topic):
        if nm in chans:
            print("  - forum exists:", nm); return chans[nm]["id"]
        body = {"name": nm, "type": 15, "topic": topic, "permission_overwrites": overwrites}
        if mma_cat: body["parent_id"] = mma_cat
        c = api("POST", "/guilds/"+GUILD_ID+"/channels", body)
        chans[nm] = c; print("  + forum:", nm); time.sleep(0.4); return c["id"]

    READ = P["VIEW_CHANNEL"]|P["READ_HISTORY"]|P["ADD_REACTIONS"]|P["SEND_IN_THREADS"]
    NO_NEW = P["CREATE_PUB_THREAD"]|P["CREATE_PRIV_THREAD"]
    up_ow = [ow(everyone, allow=READ, deny=NO_NEW)]
    res_ow = [ow(everyone, deny=P["VIEW_CHANNEL"]), ow(results_id, allow=READ, deny=NO_NEW)]
    res_ow += [ow(s, allow=READ) for s in staff_ids]
    upcoming_id = ensure_forum("🥊-upcoming-fights", up_ow, "Upcoming UFC/MMA cards - auto-posted.")
    results_forum_id = ensure_forum("🏆-fight-results", res_ow, "Fight results - opt in via onboarding. SPOILERS.")

    rid = lambda n: roles[n]["id"] if n in roles else None
    cid = lambda n: chans[n]["id"] if n in chans else None
    default_ch = [cid(n) for n in ("👋-welcome","📜-rules","📣-announcements","🎭-get-roles",
                  "🔔-notify-setup","💬-general","🎮-gaming-chat","🥊-mma-chat","🔴-live-now",
                  "🥊-upcoming-fights") if cid(n)]
    def opt(i, title, desc, emoji, role_names):
        return {"id": str(900000000000000000+i), "title": title, "description": desc,
                "emoji": {"name": emoji} if emoji else None,
                "role_ids": [rid(n) for n in role_names if rid(n)], "channel_ids": []}
    prompts = [
        {"id":"900000000000000100","type":0,"single_select":False,"required":False,"in_onboarding":True,
         "title":"What are you into?","options":[
            opt(1,"Gaming","Squad up & game nights","🎮",["🎮 Gamer"]),
            opt(2,"MMA & Combat Sports","Fight nights, picks & debates","🥊",["🥊 MMA Fan"]),
            opt(3,"Content & Streams","Here for the videos & lives","📺",[]),
            opt(4,"Just here to vibe","All of it / just hanging","💬",[])]},
        {"id":"900000000000000200","type":0,"single_select":False,"required":False,"in_onboarding":True,
         "title":"Want a ping when iBoyPrime is active?","options":[
            opt(11,"When I go LIVE","Twitch & Kick go-live alerts","🔴",["🔴 Live Pings"]),
            opt(12,"New YouTube videos","Fresh uploads","📹",["📹 YouTube Pings"]),
            opt(13,"New TikToks","Short-form drops","🎬",["🎬 TikTok Pings"]),
            opt(14,"Server announcements","Important news","📣",["📣 Announcements"]),
            opt(15,"Events & game nights","Community events","🎉",["🎉 Events"])]},
        {"id":"900000000000000300","type":0,"single_select":False,"required":False,"in_onboarding":True,
         "title":"MMA fight updates? (optional)","options":[
            opt(21,"🥊 Upcoming fight alerts","Get pinged with upcoming UFC/MMA cards.","🥊",["🥊 Fight Alerts"]),
            opt(22,"🚨 Fight RESULTS - spoiler warning",
                "Turning this ON unlocks the results forum and pings you with finished-fight results. "
                "You WILL see spoilers. Leave OFF to avoid them.","🚨",["🚨 Fight Results"])]},
    ]
    try:
        api("PUT", "/guilds/"+GUILD_ID+"/onboarding",
            {"prompts": prompts, "default_channel_ids": default_ch, "enabled": True, "mode": 1})
        print("  + onboarding updated (added MMA prompt with spoiler warning)")
    except Exception as e:
        print("  !! onboarding update failed:", e)

    print("\n================ SECURITY AUDIT ================")
    guild = api("GET", "/guilds/"+GUILD_ID)
    roles = {r["name"]: r for r in guild.get("roles", [])}
    def danger_names(pi):
        return [n for n, b in P.items() if (pi & b) and (b & DANGEROUS)]
    ev = roles.get("@everyone")
    if ev:
        cur = int(ev["permissions"]); safe = cur & ~DANGEROUS
        if safe != cur:
            api("PATCH", "/guilds/"+GUILD_ID+"/roles/"+everyone, {"permissions": str(safe)})
            print("  @everyone: removed dangerous perms", danger_names(cur & DANGEROUS))
        else:
            print("  @everyone: already clean")
    for nm in SELF_ASSIGN:
        r = roles.get(nm)
        if not r: continue
        if (int(r["permissions"]) != 0) or r.get("mentionable"):
            api("PATCH", "/guilds/"+GUILD_ID+"/roles/"+r["id"], {"permissions": "0", "mentionable": False}); time.sleep(0.2)
    print("  self-assignable roles: perms zeroed + non-mentionable")
    for nm, kit in (("🔨 Moderator", MOD_KIT), ("🛡️ Admin", ADMIN_KIT), ("👑 Owner", ADMIN_KIT)):
        r = roles.get(nm)
        if r and int(r["permissions"]) != kit:
            try:
                api("PATCH", "/guilds/"+GUILD_ID+"/roles/"+r["id"], {"permissions": str(kit)}); time.sleep(0.2)
            except Exception as e:
                print("  !! could not set", nm, e)
    print("  staff roles: Moderator/Admin/Owner set to safe powers (NO Administrator)")

    guild = api("GET", "/guilds/"+GUILD_ID)
    print("\n  Role permission summary:")
    for r in sorted(guild.get("roles", []), key=lambda x: -x["position"]):
        if r.get("managed"): tag = "(bot/integration)"
        elif r["name"] in SELF_ASSIGN or r["name"] == "@everyone": tag = "self-assign/everyone"
        else: tag = "STAFF"
        d = danger_names(int(r["permissions"]))
        admin = "  <-- ADMINISTRATOR" if "ADMINISTRATOR" in d else ""
        print("   - {:<22} {:<20} elevated={}{}".format(r["name"], tag, d if d else "none", admin))
    id2name = {r["id"]: r["name"] for r in guild.get("roles", [])}
    grant_ids = {i for p in prompts for o in p["options"] for i in o["role_ids"]}
    grantable = sorted(id2name.get(i, i) for i in grant_ids)
    bad = [g for g in grantable if g in ("👑 Owner", "🛡️ Admin", "🔨 Moderator")]
    print("\n  Onboarding can grant ONLY:", ", ".join(grantable) or "(none)")
    print("  Staff/admin roles grantable on join:", (bad if bad else "NONE"))
    print("================================================\n")

    cfg = {"guild_id": GUILD_ID, "upcoming_forum_id": upcoming_id, "results_forum_id": results_forum_id,
           "alerts_role_id": alerts_id, "results_role_id": results_id}
    with open(os.path.join(HERE, "mma_config.json"), "w", encoding="utf-8") as f:
        json.dump(cfg, f, indent=2)
    print("Wrote mma_config.json")
    print("DONE. Forums + roles + onboarding + security set. mma_bot.py can now post.")

if __name__ == "__main__":
    main()
