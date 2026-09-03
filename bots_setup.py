#!/usr/bin/env python3
"""Prime Arena - server structure setup. Idempotent, safe to re-run, std-lib only.

Drives the whole channel/category layout from layout.py (the single source of
truth) and writes bots_config.json + mma_config.json for every bot to read.

ORDER MATTERS and is encoded below - each step exists because doing it later
breaks something on a LIVE server:

  [0] disable Onboarding      - Discord's onboarding hid non-default channels behind
                                "Browse Channels"; that is the bug this whole
                                restructure exists to fix, so it goes first and stays
                                fixed even if a later step fails.
  [1] categories              - rename old -> new, create anything missing.
  [2] channels                - resolve each spec by NEW name, else by an OLD name
                                (then PATCH name+topic+parent in ONE request), else
                                create. Never creates a duplicate of a renamed channel.
  [3] guild pointers          - rules / public-updates / system channel are repointed
                                BEFORE any delete: Community mode requires them to be
                                live channels, and 🎉-server-updates is being deleted.
  [4] welcome screen          - rewritten BEFORE the deletes for the same reason (it
                                featured three channels that are going away).
  [5] delete channels + categories.
  [6] positions               - make the sidebar match layout order.
  [7] modconfig re-key        - drop entries for deleted channels and add the new
                                ones. Orphans here are NOT harmless: image_scan gates
                                its whole workflow on them, so stale ids mean it
                                installs ~100MB of ML deps every 5 min and scans
                                nothing, silently disabling the NSFW + gore watch.
  [8] invite link             - reuse-or-create ONE permanent invite for the welcome
                                message.
  [9] write configs.

`python bots_setup.py --dry-run` prints every intended change and sends no writes.
"""
import os, sys, json, time, urllib.request, urllib.error

import layout

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

TOKEN = os.environ.get("DISCORD_BOT_TOKEN", "")
if not TOKEN:
    raise SystemExit("ERROR: set the DISCORD_BOT_TOKEN secret/env var.")
GUILD_ID = os.environ.get("DISCORD_GUILD_ID", "1502831752702464113")
HERE = os.path.dirname(os.path.abspath(__file__))
API = "https://discord.com/api/v10"
H = {"Authorization": "Bot " + TOKEN, "Content-Type": "application/json",
     "User-Agent": "iBoyPrimeHQ-setup (https://iboyprime, 1.0)"}

DRY = "--dry-run" in sys.argv or "--dry" in sys.argv

P = {n: 1 << b for n, b in {
    "ADD_REACTIONS": 6, "VIEW_CHANNEL": 10, "SEND_MESSAGES": 11, "EMBED_LINKS": 14,
    "ATTACH_FILES": 15, "READ_HISTORY": 16, "CONNECT": 20, "SPEAK": 21,
    "CREATE_PUB_THREAD": 35, "CREATE_PRIV_THREAD": 36, "SEND_IN_THREADS": 38,
}.items()}
READ = P["VIEW_CHANNEL"] | P["READ_HISTORY"] | P["ADD_REACTIONS"] | P["SEND_IN_THREADS"]
NO_NEW = P["CREATE_PUB_THREAD"] | P["CREATE_PRIV_THREAD"]
NO_SEND = P["SEND_MESSAGES"] | NO_NEW

CHANGES = []          # human-readable log, printed as the dry-run plan


def api(method, path, body=None, tries=6):
    if DRY and method != "GET":
        CHANGES.append("%s %s %s" % (method, path, json.dumps(body, ensure_ascii=False)[:160] if body else ""))
        name = body.get("name", "") if isinstance(body, dict) else ""   # reorder sends a list
        return 200, {"id": "DRYRUN", "name": name}
    data = json.dumps(body).encode() if body is not None else None
    for _ in range(tries):
        try:
            req = urllib.request.Request(API + path, data=data, headers=H, method=method)
            with urllib.request.urlopen(req, timeout=30) as r:
                raw = r.read().decode()
                return r.status, (json.loads(raw) if raw else {})
        except urllib.error.HTTPError as e:
            raw = e.read().decode()
            if e.code == 429:
                try:
                    w = float(json.loads(raw).get("retry_after", 2))
                except Exception:
                    w = 2
                time.sleep(w + 0.3)
                continue
            raise RuntimeError("%s %s -> %s: %s" % (method, path, e.code, raw[:200]))
        except urllib.error.URLError:
            time.sleep(2)
    raise RuntimeError("request failed: " + path)


def ow(rid, allow=0, deny=0):
    return {"id": str(rid), "type": 0, "allow": str(allow), "deny": str(deny)}


def note(msg):
    CHANGES.append(msg)
    print("  " + msg)


def pause(sec=0.35):
    if not DRY:
        time.sleep(sec)


# ---------------------------------------------------------------------------
# [0] Onboarding OFF - the visibility fix, applied first so it survives a later failure
# ---------------------------------------------------------------------------
def disable_onboarding():
    """Discord opts members into `default_channel_ids` ONLY; everything else hides
    behind Browse Channels. Clearing the lists as well as flipping `enabled` also
    releases the 'onboarding channels must be readable by everyone' pin (err 350003),
    which otherwise outlives a plain disable. onboarding_setup re-asserts this at the
    end of the deploy - both calls are idempotent."""
    code, _ = api("PUT", "/guilds/%s/onboarding" % GUILD_ID,
                  {"prompts": [], "default_channel_ids": [], "enabled": False, "mode": 0})
    if code in (200, 204):
        note("onboarding DISABLED (every channel is visible with zero clicks)")
    else:
        print("  ! onboarding disable returned HTTP %s - re-checked in onboarding_setup" % code)


# ---------------------------------------------------------------------------
# [1]+[2] categories and channels
# ---------------------------------------------------------------------------
def sync_categories(cats_by_name, staff_ids, bots_role, everyone):
    """name -> id for every category in the layout (renaming or creating as needed)."""
    out = {}
    for cat in layout.all_categories():
        live = cats_by_name.get(cat.name)
        if not live:
            for old in cat.old_names:
                if old in cats_by_name:
                    live = cats_by_name[old]
                    api("PATCH", "/channels/%s" % live["id"], {"name": cat.name})
                    note("renamed category: %s -> %s" % (old, cat.name))
                    pause()
                    break
        if live:
            out[cat.name] = live["id"]
            continue
        body = {"name": cat.name, "type": layout.CATEGORY}
        if cat.name == layout.STAFF_CATEGORY:
            perms = [ow(everyone, deny=P["VIEW_CHANNEL"])]
            perms += [ow(s, allow=READ | P["SEND_MESSAGES"] | P["CONNECT"] | P["SPEAK"])
                      for s in staff_ids]
            if bots_role:
                perms.append(ow(bots_role, allow=READ | P["SEND_MESSAGES"]))
            body["permission_overwrites"] = perms
        _, c = api("POST", "/guilds/%s/channels" % GUILD_ID, body)
        out[cat.name] = c["id"]
        note("created category: " + cat.name)
        pause(0.4)
    return out


def sync_channels(chans_by_name, cat_ids, staff_ids, everyone):
    """Resolve every ChannelSpec to a live channel id. Returns {spec_name: id}.

    Lookup order is what makes the ┊ rename safe:
      new name -> any old name (rename in place) -> create.
    A spec is NEVER created while a channel matching one of its old_names exists,
    so the old bug (rename in one file, duplicate channel on the next deploy) is
    structurally impossible."""
    read_only_ow = ([ow(everyone, allow=READ, deny=NO_SEND)]
                    + [ow(s, allow=READ | P["SEND_MESSAGES"]) for s in staff_ids])
    forum_ow = [ow(everyone, allow=READ, deny=NO_NEW)]
    out = {}

    for spec in layout.all_channels():
        cat = layout.category_of(spec)
        parent = cat_ids.get(cat.name) if cat else None
        live = chans_by_name.get(spec.name)
        matched_old = None
        if not live:
            for old in spec.old_names:
                if old in chans_by_name:
                    live, matched_old = chans_by_name[old], old
                    break

        if live:
            # ONE PATCH carrying every field that differs. name+topic share Discord's
            # 2-per-10-min per-channel bucket, so they must not be sent separately -
            # server_polish.patch_topics() is compare-first and then no-ops.
            want = {}
            if live.get("name") != spec.name:
                want["name"] = spec.name
            if spec.topic and spec.ctype in (layout.TEXT, layout.NEWS, layout.FORUM):
                if (live.get("topic") or "").strip() != spec.topic:
                    want["topic"] = spec.topic
            if parent and str(live.get("parent_id") or "") != str(parent):
                want["parent_id"] = parent
            if want:
                api("PATCH", "/channels/%s" % live["id"], want)
                note("%s: %s" % (matched_old or spec.name,
                                 ", ".join("%s=%s" % (k, str(v)[:40]) for k, v in want.items())))
                pause()
            out[spec.name] = live["id"]
            continue

        body = {"name": spec.name, "type": spec.ctype, "parent_id": parent}
        if spec.ctype in (layout.TEXT, layout.NEWS, layout.FORUM) and spec.topic:
            body["topic"] = spec.topic
        if spec.ctype == layout.FORUM:
            body["permission_overwrites"] = forum_ow
        elif spec.read_only and not layout.is_staff_channel(spec):
            body["permission_overwrites"] = read_only_ow
        _, c = api("POST", "/guilds/%s/channels" % GUILD_ID, body)
        out[spec.name] = c["id"]
        note("created channel: " + spec.name)
        pause(0.45)
    return out


# ---------------------------------------------------------------------------
# [3] guild pointers - repointed BEFORE anything is deleted
# ---------------------------------------------------------------------------
GUILD_DESCRIPTION = ("Gaming, MMA and iBoyPrime's live streams. Every channel is open "
                     "from the moment you join.")


def repoint_guild_pointers(guild, ids_by_key):
    """Community mode requires rules_channel_id and public_updates_channel_id to be
    real channels. 🎉-server-updates (the old public-updates target) is being deleted,
    so this MUST run before the delete pass.

    Also carries the guild description - the last thing server_polish.py still did
    that nothing else did. That file is gone: topics, the welcome screen and the
    system channel are all set here now, in one place, from one layout."""
    want = {}
    if (guild.get("description") or "") != GUILD_DESCRIPTION:
        want["description"] = GUILD_DESCRIPTION
    rules = ids_by_key.get("rules")
    if rules and str(guild.get("rules_channel_id")) != str(rules):
        want["rules_channel_id"] = rules
    pub = ids_by_key.get(layout.PUBLIC_UPDATES_KEY)
    if pub and str(guild.get("public_updates_channel_id")) != str(pub):
        want["public_updates_channel_id"] = pub
    sysch = ids_by_key.get(layout.SYSTEM_CHANNEL_KEY)
    if sysch and str(guild.get("system_channel_id")) != str(sysch):
        want["system_channel_id"] = sysch
    if not want:
        print("  guild pointers: already current")
        return
    # The two Community pointers are only honoured when `features` rides along in the
    # same PATCH. Sent on their own Discord answers 200 and silently ignores them -
    # which then makes the old public-updates channel undeletable (error 50074,
    # "Cannot delete a channel required for community servers").
    if "rules_channel_id" in want or "public_updates_channel_id" in want:
        want["features"] = sorted(set((guild.get("features") or []) + ["COMMUNITY"]))
    code, resp = api("PATCH", "/guilds/%s" % GUILD_ID, want)
    if code in (200, 201):
        note("guild pointers: " + ", ".join(want))
    else:
        print("  ! guild pointer PATCH failed (HTTP %s): %s" % (code, str(resp)[:150]))


# ---------------------------------------------------------------------------
# [4] welcome screen - rewritten before the deletes
# ---------------------------------------------------------------------------
WELCOME_DESCRIPTION = ("Gaming, MMA and iBoyPrime's live streams. Every channel is open "
                       "from the moment you join.")


def sync_welcome_screen(ids_by_key):
    want = []
    for key, blurb, emoji in layout.WELCOME_FEATURED:
        cid = ids_by_key.get(key)
        if cid:
            want.append({"channel_id": str(cid), "description": blurb[:50],
                         "emoji_id": None, "emoji_name": emoji})
    if not want:
        print("  welcome screen: no known channels, skipped")
        return
    code, cur = api("GET", "/guilds/%s/welcome-screen" % GUILD_ID)
    cur = cur if (code == 200 and isinstance(cur, dict)) else {}
    have = [{"channel_id": str(c.get("channel_id")), "description": c.get("description"),
             "emoji_id": c.get("emoji_id"), "emoji_name": c.get("emoji_name")}
            for c in (cur.get("welcome_channels") or [])]
    if cur.get("description") == WELCOME_DESCRIPTION and have == want:
        print("  welcome screen: already current")
        return
    code, resp = api("PATCH", "/guilds/%s/welcome-screen" % GUILD_ID,
                     {"enabled": True, "description": WELCOME_DESCRIPTION[:140],
                      "welcome_channels": want})
    if code in (200, 201):
        note("welcome screen: %d featured channel(s)" % len(want))
    else:
        print("  ! welcome screen PATCH failed (HTTP %s): %s" % (code, str(resp)[:150]))


# ---------------------------------------------------------------------------
# [5] deletions
# ---------------------------------------------------------------------------
def delete_channels(chans_by_name, keep_ids):
    for name in layout.DELETE_CHANNELS:
        c = chans_by_name.get(name)
        if not c:
            continue
        if str(c["id"]) in keep_ids:      # paranoia: never delete a channel we just kept
            print("  ! refusing to delete %s - it resolved to a live spec" % name)
            continue
        try:
            api("DELETE", "/channels/%s" % c["id"])
            note("deleted channel: " + name)
            chans_by_name.pop(name, None)
            pause()
        except Exception as e:
            print("  ! could not delete", name, e)


def delete_categories(cats_by_name, keep_names):
    for name in layout.DELETE_CATEGORIES:
        cat = cats_by_name.get(name)
        if not cat or name in keep_names:
            continue
        code, fresh = api("GET", "/guilds/%s/channels" % GUILD_ID)
        kids = [c for c in (fresh if isinstance(fresh, list) else [])
                if str(c.get("parent_id") or "") == str(cat["id"])]
        if kids and not DRY:
            print("  ! category %s still has %d channel(s), left in place: %s"
                  % (name, len(kids), [k["name"] for k in kids]))
            continue
        try:
            api("DELETE", "/channels/%s" % cat["id"])
            note("deleted category: " + name)
            pause()
        except Exception as e:
            print("  ! could not delete category", name, e)


# Role deletion deliberately lives in onboarding_setup.py, which runs LATER in the
# deploy: deleting a role also drops every permission overwrite that referenced it,
# so the un-gate pass has to restore @everyone's VIEW first. Doing it here would
# leave a category denied to @everyone with no role able to see it.


# ---------------------------------------------------------------------------
# [6] positions
# ---------------------------------------------------------------------------
def reorder(cat_ids, ids_by_name):
    """Make the sidebar match layout order. This endpoint is a bulk PATCH and is NOT
    in the 2-per-10-min name/topic bucket, so it is safe to send every deploy.

    Positions ONLY - Discord rejects the whole payload with 40009 ("Only one channel
    can have a parent_id modified at a time") if more than one entry carries a
    parent_id. Parent moves are done one at a time in sync_channels()."""
    payload, pos = [], 0
    for cat in layout.all_categories():
        cid = cat_ids.get(cat.name)
        if not cid:
            continue
        payload.append({"id": str(cid), "position": pos})
        pos += 1
        for i, spec in enumerate(cat.channels):
            chid = ids_by_name.get(spec.name)
            if chid:
                payload.append({"id": str(chid), "position": i})
    if not payload:
        return
    try:
        code, _ = api("PATCH", "/guilds/%s/channels" % GUILD_ID, payload)
    except RuntimeError as e:
        print("  ! reorder failed (cosmetic only):", str(e)[:150])
        return
    if code in (200, 204):
        note("reordered %d channels/categories to match the layout" % len(payload))
    else:
        print("  ! reorder returned HTTP %s (cosmetic only)" % code)


# ---------------------------------------------------------------------------
# [7] modconfig re-key
# ---------------------------------------------------------------------------
def rekey_modconfig(ids_by_key):
    """Point the moderation config at the surviving channels only.

    Orphaned ids are actively harmful, not just untidy: image_scan.needs_scan() reads
    modconfig's channel list, so leftover entries keep the scan workflow installing
    ~100MB of ONNX deps every 5 minutes while 404-ing on every channel - the porn
    auto-delete and the gore watch would go dark with zero error output."""
    try:
        import modconfig
    except Exception as e:
        print("  ! modconfig import failed, skipped:", e)
        return
    cfg = modconfig.load()
    live = {}
    for spec in layout.member_postable():
        cid = ids_by_key.get(spec.key)
        if not cid:
            continue
        prev = (cfg.get("channels") or {}).get(str(cid))
        live[str(cid)] = prev if prev else {"profile": "standard", "nsfw_images": True}
    dropped = sorted(set((cfg.get("channels") or {}).keys()) - set(live))
    cfg["channels"] = live
    if not DRY:
        modconfig.save(cfg)
    note("modconfig: %d channel(s) scanned, %d orphan(s) dropped" % (len(live), len(dropped)))


# ---------------------------------------------------------------------------
# [8] permanent invite for the welcome message
# ---------------------------------------------------------------------------
def ensure_invite(general_id, me_id):
    """Reuse the bot's existing never-expiring invite, else make one. Invite codes are
    public by design, so this is safe in bots_config.json (and in the public repo)."""
    if not general_id:
        return ""
    code, invites = api("GET", "/guilds/%s/invites" % GUILD_ID)
    if code == 200 and isinstance(invites, list):
        for inv in invites:
            if (str((inv.get("channel") or {}).get("id")) == str(general_id)
                    and inv.get("max_age") == 0 and inv.get("max_uses") == 0
                    and (not me_id or str((inv.get("inviter") or {}).get("id")) == str(me_id))):
                return "https://discord.gg/" + inv["code"]
    code, inv = api("POST", "/channels/%s/invites" % general_id,
                    {"max_age": 0, "max_uses": 0, "unique": False})
    if code in (200, 201) and isinstance(inv, dict) and inv.get("code"):
        note("created a permanent invite for the welcome message")
        return "https://discord.gg/" + inv["code"]
    print("  ! could not create an invite (HTTP %s) - welcome message omits the link" % code)
    return ""


def rank_roles(roles):
    """Roles ordered LOWEST first.

    Discord sorts by `position`, and breaks ties by id with the LOWER id ranking
    HIGHER. That second half is easy to get backwards, and getting it backwards is
    invisible: you just conclude the bot can't grant a role that it can. Verified
    against this guild, where every role sits at position 1 and the bot's managed
    role (oldest id) grants 🤝 Member without complaint."""
    return sorted(roles, key=lambda r: (r.get("position", 0), -int(r["id"])))


def check_member_role_rank(roles_by_name):
    """A bot can only hand out roles BELOW its own. Report clearly when it can't,
    because member_bot would otherwise log one 403 and hand out nothing forever."""
    mid = roles_by_name.get(layout.MEMBER_ROLE)
    if not mid:
        return
    code, roles = api("GET", "/guilds/%s/roles" % GUILD_ID)
    if code != 200 or not isinstance(roles, list):
        return
    rank = rank_roles(roles)
    bot_role = next((r for r in roles if r.get("managed")), None)
    member = next((r for r in roles if str(r["id"]) == str(mid)), None)
    if not bot_role or not member:
        return
    if rank.index(bot_role) > rank.index(member):
        print("  role order: OK (the bot outranks %s)" % layout.MEMBER_ROLE)
        return
    # Member already sits at the lowest usable position, so there is nothing the bot
    # can move: it cannot lower a role that outranks it, and it cannot raise its own.
    print("  !! ACTION NEEDED: '%s' sits ABOVE the bot's own role, so the bot cannot"
          % layout.MEMBER_ROLE)
    print("     hand it out and member_bot will log a 403 on every grant.")
    print("     Fix once in Discord: Server Settings -> Roles -> drag '%s' to the TOP."
          % (bot_role.get("name") or "the bot role"))


# ---------------------------------------------------------------------------
def main():
    layout.validate()

    _, guild = api("GET", "/guilds/%s" % GUILD_ID)
    roles_by_name = {r["name"]: r["id"] for r in guild.get("roles", [])}
    everyone = GUILD_ID
    staff_ids = [roles_by_name[n] for n in ("👑 Owner", "🛡️ Admin", "🔨 Moderator")
                 if n in roles_by_name]
    bots_role = roles_by_name.get("🤖 Bots")
    print("Server: %s%s" % (guild.get("name"), "   [DRY RUN - no writes]" if DRY else ""))

    _, chan_list = api("GET", "/guilds/%s/channels" % GUILD_ID)
    chans_by_name = {c["name"]: c for c in chan_list if c.get("type") != layout.CATEGORY}
    cats_by_name = {c["name"]: c for c in chan_list if c.get("type") == layout.CATEGORY}

    print("[0] Disabling Discord Onboarding (the invisible-channel fix)...")
    disable_onboarding()

    print("[1] Categories...")
    cat_ids = sync_categories(cats_by_name, staff_ids, bots_role, everyone)

    print("[2] Channels (rename in place, create only what's missing)...")
    ids_by_name = sync_channels(chans_by_name, cat_ids, staff_ids, everyone)

    ids_by_key = {}
    for spec in layout.all_channels():
        cid = ids_by_name.get(spec.name)
        for k in spec.keys:
            if k and cid:
                ids_by_key[k] = cid

    print("[3] Guild pointers (rules / public-updates / join messages)...")
    repoint_guild_pointers(guild, ids_by_key)

    print("[4] Welcome screen...")
    sync_welcome_screen(ids_by_key)

    print("[5] Deleting retired channels + categories...")
    keep_ids = set(str(v) for v in ids_by_name.values())
    delete_channels(chans_by_name, keep_ids)
    delete_categories(cats_by_name, set(cat_ids))

    print("[6] Ordering the sidebar...")
    reorder(cat_ids, ids_by_name)

    print("[7] Re-keying modconfig to the surviving channels...")
    rekey_modconfig(ids_by_key)

    print("[8] Permanent invite...")
    _, me = api("GET", "/users/@me")
    invite = ensure_invite(ids_by_key.get(layout.SYSTEM_CHANNEL_KEY),
                           me.get("id") if isinstance(me, dict) else None)

    # ---- configs -----------------------------------------------------------
    # The baseline member role is the only one this script CREATES. Everything else in
    # ROLES_KEEP predates the restructure; a missing one means something is wrong and
    # should be visible, not silently papered over.
    for _auto in (layout.MEMBER_ROLE, layout.NEWS_ALERT_ROLE):
        if _auto in roles_by_name:
            continue
        spec = next((r for r in layout.ROLES_KEEP if r[0] == _auto), None)
        if not spec:
            continue
        name, color, hoist, mentionable = spec
        _, r = api("POST", "/guilds/%s/roles" % GUILD_ID,
                   {"name": name, "color": color, "hoist": hoist,
                    "mentionable": mentionable, "permissions": "0"})
        if isinstance(r, dict) and r.get("id"):
            roles_by_name[name] = r["id"]
            note("created role: %s (no extra permissions)" % name)
            pause(0.3)

    check_member_role_rank(roles_by_name)

    # The alert role exists so ONE person gets pinged. Grant it to the owner here
    # rather than asking him to click: member_bot only backfills the baseline role,
    # and a ping role nobody holds is a silent no-op that looks like it works.
    _alert_rid = roles_by_name.get(layout.NEWS_ALERT_ROLE)
    _owner_uid = str((guild or {}).get("owner_id") or "")
    if _alert_rid and _owner_uid and not DRY:
        code, _ = api("PUT", "/guilds/%s/members/%s/roles/%s"
                      % (GUILD_ID, _owner_uid, _alert_rid))
        if code in (200, 201, 204):
            note("granted %s to the server owner (nobody else holds it, so nobody "
                 "else is pinged)" % layout.NEWS_ALERT_ROLE)
        else:
            note("could not grant %s to the owner (HTTP %s) - news alerts will stay "
                 "silent until it is granted by hand" % (layout.NEWS_ALERT_ROLE, code))

    out_roles = {}
    for key, name in layout.ROLE_KEYS.items():
        if name in roles_by_name:
            out_roles[key] = roles_by_name[name]
        else:
            print("  ! role not found (skipped):", name)

    patrol = [ids_by_key[k] for k in layout.patrol_keys() if k in ids_by_key]
    if not patrol and not DRY:
        # mod_bot unions patrol_channels with the modconfig keys; an empty list here
        # used to mean "patrol every channel successfully, moderating nothing".
        raise SystemExit("ERROR: no patrol channels resolved - refusing to write a "
                         "bots_config.json that would silently disable the patrol.")

    missing = [k for k in layout.required_config_keys() if k not in ids_by_key]
    if missing and not DRY:
        raise SystemExit("ERROR: these layout keys did not resolve to a channel: %s"
                         % ", ".join(missing))

    upcoming = ids_by_key.get("upcoming")
    cfg = {
        "guild_id": GUILD_ID,
        # The guild owner's user id, captured from the guild GET main() already
        # does (never a second request). Discord always returns it, but a missing
        # or null value degrades to "" so consumers see a string either way.
        "owner_id": str(guild.get("owner_id") or ""),
        "channels": ids_by_key,
        "roles": out_roles,
        "patrol_channels": patrol,
        "invite_url": invite,
        # the MMA forum poller's ids, kept here so there is ONE config lane now
        "mma": {"upcoming_forum_id": upcoming},
        "creator": {
            "twitch_login": os.environ.get("TWITCH_LOGIN", "iboyprime"),
            "kick_slug": os.environ.get("KICK_SLUG", "iboyprime"),
            "youtube_handle": os.environ.get("YOUTUBE_HANDLE", "iboyprime_official"),
            "youtube_channel_id": ("" if "PASTE" in os.environ.get("YOUTUBE_CHANNEL_ID", "").upper()
                                   else os.environ.get("YOUTUBE_CHANNEL_ID", "")),
        },
    }
    if DRY:
        print("\n---- DRY RUN PLAN (%d change%s) ----" % (len(CHANGES), "" if len(CHANGES) == 1 else "s"))
        for line in CHANGES:
            print("   " + line)
        print("\nbots_config would hold %d channel keys, %d role keys, %d patrol channels."
              % (len(ids_by_key), len(out_roles), len(patrol)))
        print("NO CHANGES WERE MADE.")
        return

    with open(os.path.join(HERE, "bots_config.json"), "w", encoding="utf-8") as f:
        json.dump(cfg, f, indent=2, ensure_ascii=False)
    print("\nWrote bots_config.json (%d channels, %d roles)" % (len(ids_by_key), len(out_roles)))

    # mma_bot.py reads its own config file; regenerate it WITHOUT the retired
    # results forum / ping roles so it can never post to a dead channel.
    if upcoming:
        with open(os.path.join(HERE, "mma_config.json"), "w", encoding="utf-8") as f:
            json.dump({"guild_id": GUILD_ID, "upcoming_forum_id": upcoming}, f, indent=2)
        print("Wrote mma_config.json (upcoming forum only)")

    try:
        import newsconfig
        newsconfig.save(newsconfig.load())
        print("Wrote newsconfig.json")
    except Exception as e:
        print("  ! newsconfig materialize failed:", e)

    # The owner's welcome text. load() merges his file over the defaults (adding any new
    # default keys), save() writes the merged result back, so the file always exists by
    # the time mod_setup renders from it at step [3b] and the upload runs at step [4].
    try:
        import welcomeconfig
        welcomeconfig.save(welcomeconfig.load())
        print("Wrote welcomeconfig.json")
    except Exception as e:
        print("  ! welcomeconfig materialize failed:", e)

    print("DONE.")


if __name__ == "__main__":
    main()
