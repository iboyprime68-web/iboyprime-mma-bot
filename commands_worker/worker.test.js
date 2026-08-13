// Offline unit tests for the Worker's pure /mod helpers. Run: node worker.test.js
import worker, { _test } from "./worker.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

let pass = 0, fail = 0;
function check(name, cond) { if (cond) { pass++; console.log("  ok  :", name); } else { fail++; console.log("  FAIL:", name); } }

const { subPath, isStaffFromRoles, applyModChange, applyNewsChange, resolveCats, MOD_CATEGORIES } = _test;

// ----- subPath -----
const i1 = { data: { options: [ { type: 2, name: "channel", options: [ { type: 1, name: "set-profile",
  options: [ { name: "channel", value: "C1" }, { name: "profile", value: "sfw_strict" } ] } ] } ] } };
const sp = subPath(i1);
check("subPath reads group + sub + opts", sp.group === "channel" && sp.sub === "set-profile" &&
  sp.opts.channel === "C1" && sp.opts.profile === "sfw_strict");
const sp2 = subPath({ data: { options: [ { type: 1, name: "status" } ] } });
check("subPath handles a top-level subcommand (status)", sp2.group === null && sp2.sub === "status");

// ----- isStaffFromRoles -----
const cfg = { roles: { owner: "RO", admin: "RA", mod: "RM" } };
check("staff role grants access", isStaffFromRoles({ roles: ["RA"], permissions: "0" }, cfg) === true);
check("non-staff is denied", isStaffFromRoles({ roles: ["X"], permissions: "0" }, cfg) === false);
check("administrator permission bit grants access", isStaffFromRoles({ roles: [], permissions: "8" }, cfg) === true);

// ----- applyModChange (pure) -----
const mc = { defaults: { profile: "standard" },
  profiles: { standard: { categories: ["slurs"], media_policy: "allow" },
              sfw_strict: { categories: MOD_CATEGORIES.slice(), media_policy: "no_links" } },
  channels: {}, categories: {} };

const r1 = applyModChange(mc, "channel", "set-profile", { channel: "C1", profile: "sfw_strict" });
check("set-profile writes the channel", r1.channels.C1 === "sfw_strict");
check("set-profile does not mutate the input", mc.channels.C1 === undefined);

const r2 = applyModChange(mc, "category", "enable", { channel: "C2", category: "nsfw_text" });
check("category enable -> inline override keeps base + adds new",
  typeof r2.channels.C2 === "object" && r2.channels.C2.categories.includes("nsfw_text") && r2.channels.C2.categories.includes("slurs"));
const r3 = applyModChange(r2, "category", "disable", { channel: "C2", category: "slurs" });
check("category disable removes it", !r3.channels.C2.categories.includes("slurs"));

const r4 = applyModChange(mc, "media", "policy", { channel: "C3", policy: "no_links" });
check("media policy set as inline override", r4.channels.C3.media_policy === "no_links");

const r5 = applyModChange(mc, "word", "add", { category: "scam", word: "freevbucks" });
check("word add appends to the category list", r5.categories.scam.words.includes("freevbucks"));
const r6 = applyModChange(r5, "word", "remove", { category: "scam", word: "freevbucks" });
check("word remove drops it", !r6.categories.scam.words.includes("freevbucks"));

check("raid on", applyModChange(mc, "raid", "on", {}).raid.enabled === true);
check("raid off", applyModChange(mc, "raid", "off", {}).raid.enabled === false);

// ----- resolveCats -----
check("resolveCats reflects the profile's categories",
  [...resolveCats(r1, "C1").cats].sort().join(",") === MOD_CATEGORIES.slice().sort().join(","));
check("resolveCats reads media from the profile", resolveCats(r1, "C1").media === "no_links");

// ----- applyNewsChange (pure) -----
const nc = { mode: "hybrid",
  sources: { sherdog: { label: "Sherdog", enabled: true } },
  categories: { ufc: { label: "UFC", enabled: true }, boxing: { label: "Boxing", enabled: false } },
  breaking_keywords: ["retires"], exclude_keywords: ["betting"] };

const n1 = applyNewsChange(nc, null, "mode", { value: "digest" });
check("news mode change", n1.mode === "digest");
check("news mode rejects an unknown value", applyNewsChange(nc, null, "mode", { value: "loud" }).mode === "hybrid");
check("news change does not mutate the input", nc.mode === "hybrid");

const n2 = applyNewsChange(nc, null, "source", { name: "sherdog", state: "off" });
check("news source off", n2.sources.sherdog.enabled === false);
const n3 = applyNewsChange(nc, null, "category", { name: "boxing", state: "on" });
check("news category on", n3.categories.boxing.enabled === true);

const n4 = applyNewsChange(nc, "keyword", "add", { list: "breaking", word: "  Stripped OF " });
check("news keyword add normalizes + appends", n4.breaking_keywords.includes("stripped of"));
const n5 = applyNewsChange(n4, "keyword", "remove", { list: "breaking", word: "stripped of" });
check("news keyword remove drops it", !n5.breaking_keywords.includes("stripped of"));
const n6 = applyNewsChange(nc, "keyword", "add", { list: "exclude", word: "parlay" });
check("news exclude list is separate", n6.exclude_keywords.includes("parlay") && !n6.breaking_keywords.includes("parlay"));

const spn = subPath({ data: { options: [ { type: 2, name: "keyword", options: [ { type: 1, name: "add",
  options: [ { name: "list", value: "breaking" }, { name: "word", value: "dies" } ] } ] } ] } });
check("subPath handles /news keyword add", spn.group === "keyword" && spn.sub === "add" &&
  spn.opts.list === "breaking" && spn.opts.word === "dies");

// ----- Aug 2026 declutter: no handler may reference a deleted channel/role key -----
// These keys no longer exist in bots_config.json. A handler that still reads one
// doesn't crash - it silently hits `undefined` and tells the member something
// misleading - so the only way to catch it is to scan the source.
const workerSrc = readFileSync(fileURLToPath(new URL("./worker.js", import.meta.url)), "utf8");
// Comments are stripped first so the notes explaining WHY these were removed don't
// trip their own guard. `on_this_day` also lives in the embedded trivia data, so the
// channel check requires the word to sit next to a `channels` lookup.
const code = workerSrc.replace(/^\s*\/\/.*$/gm, "");
const DEAD_ROLE_KEYS = /\b(news_pings|digest_ping|fight_prophet|clip_champ|live_pings|youtube_pings|fight_alerts|announce_role|events_role)\b/;
const DEAD_CHANNEL_LOOKUP = /channels\b[^;\n]{0,80}\b(live_now|youtube_uploads|plays_n_clips|predictions|fight_week|rankings|on_this_day|fight_night|server_updates)\b/;
check("no handler references a deleted role key", !DEAD_ROLE_KEYS.test(code));
check("no handler looks up a deleted channel key", !DEAD_CHANNEL_LOOKUP.test(code));
check("/rankings is gone (its data source was the retired board's)", !/\brankings:\s*\(/.test(code));
check("/news follow|unfollow is gone (the ping roles were deleted)",
  !/sub === "follow"/.test(code) && !/sub === "unfollow"/.test(code));
check("/help no longer advertises removed commands",
  !/\/news follow/.test(code) && !/`\/rankings`/.test(code));

// ----- /links reads welcomeconfig.json (one source of truth for the socials) -----
// This whole block exists because the link list used to be hard-coded HERE as well as
// in mod_setup.py, both copies carried a wrong TikTok URL, and nothing caught it.
const { socialLines, SOCIALS_FALLBACK } = _test;
check("socialLines renders label + url in order",
  socialLines([{ label: "A", url: "https://a" }, { label: "B", url: "https://b" }])
  === "**A:** https://a\n**B:** https://b");
check("socialLines drops a non-https entry",
  socialLines([{ label: "X", url: "http://x" }]) === null);
check("socialLines drops an entry with no label",
  socialLines([{ url: "https://x" }]) === null);
check("socialLines returns null on empty/absent so the caller falls back",
  socialLines(null) === null && socialLines([]) === null && socialLines(undefined) === null);
check("the built-in fallback still renders when the repo is unreachable",
  (socialLines(SOCIALS_FALLBACK) || "").split("\n").length === 5);
check("the fallback carries the corrected TikTok and the new Instagram",
  SOCIALS_FALLBACK.some(l => l.url === "https://www.tiktok.com/@iboyprime_official") &&
  SOCIALS_FALLBACK.some(l => l.url === "https://www.instagram.com/iboyprime_official/"));
check("every fallback link is https", SOCIALS_FALLBACK.every(l => l.url.startsWith("https://")));
check("the old wrong TikTok URL is gone from the Worker source",
  !/tiktok\.com\/@iboyprime"/.test(workerSrc));
check("/links no longer renders a hard-coded object (it reads welcomeconfig.json)",
  /welcomeConfig\(env\)/.test(code) && !/\bconst SOCIALS =/.test(code));

// ----- staff replies must be PRIVATE (ephemeral) -----
// Discord fixes ephemerality on the DEFER response; a followup PATCH cannot change it.
// Every staff handler passed msg(..., true), but the defer carried no flags, so all of
// them posted publicly - including /modlogs warning histories and "⛔ No permission".
const { COMMANDS, CONTEXT } = _test;
const STAFF_CMDS = ["mod", "warn", "timeout", "ban", "unban", "clear", "modlogs"];
const STAFF_CTX = ["Timeout 10m", "Warn", "Mod record", "Delete & warn author"];
const stub = { data: { options: [] }, member: { user: { id: "U1" }, roles: [] } };

for (const n of STAFF_CMDS)
  check(`/${n} replies privately (staff action, never in public chat)`,
    COMMANDS[n](stub, {}).ephemeral === true);
for (const n of STAFF_CTX)
  check(`context menu "${n}" replies privately`, CONTEXT[n](stub, {}).ephemeral === true);

check("/news status stays public (it is member-facing info)",
  COMMANDS.news({ data: { options: [{ type: 1, name: "status" }] } }, {}).ephemeral === false);
check("/news config writes reply privately (staff only)",
  COMMANDS.news({ data: { options: [{ type: 2, name: "source", options: [
    { type: 1, name: "toggle", options: [] } ] }] } }, {}).ephemeral === true);
for (const n of ["links", "nextevent", "event", "fighter", "serverinfo"])
  check(`/${n} stays public`, !COMMANDS[n](stub, {}).ephemeral);

check("the DEFER response carries the ephemeral flag (the fix, not just the intent)",
  /type:\s*T\.DEFER,\s*data:\s*res\.ephemeral\s*\?\s*\{\s*flags:\s*EPHEMERAL\s*\}/.test(code));
check("every staff handler is marked ephemeral in source",
  STAFF_CMDS.every(n => new RegExp(`\\b${n}:\\s*\\(i, env\\) => \\(\\{ ephemeral: true`).test(code)));

// ----- API path injection (/unban took a free-text string straight into the path) -----
// fetch() uses the WHATWG URL parser, which RESOLVES dot-segments before the request
// goes out, so a crafted "user ID" turned DELETE /guilds/G/bans/<id> into
// DELETE /channels/<id> - channel deletion with the bot's ADMINISTRATOR token, logged
// to the mod-log as a harmless "unbanned".
const { isSnowflake, safeApiPath } = _test;
check("a real snowflake is accepted", isSnowflake("1515436353091801199"));
for (const bad of ["../../../channels/999888777", "123/../../channels/1", "", "  ",
                   "12345", "abc", "1234567890123456789012345", null, undefined])
  check(`isSnowflake rejects ${JSON.stringify(bad)}`, !isSnowflake(bad));

// The exact escalation, proven against the real URL parser rather than by inspection.
const traversal = new URL("https://discord.com/api/v10/guilds/G/bans/../../../channels/999").pathname;
check("traversal really does collapse to a channel-delete path (why this matters)",
  traversal === "/api/v10/channels/999");
check("safeApiPath rejects that path", !safeApiPath("/guilds/G/bans/../../../channels/999"));
check("safeApiPath rejects backslash, whitespace and double slashes",
  !safeApiPath("/guilds/G//bans/1") && !safeApiPath("/guilds/G/bans/1 2") && !safeApiPath("/a\\b"));
check("safeApiPath rejects a relative path", !safeApiPath("guilds/G/bans/1"));
check("safeApiPath allows the paths the bot actually uses",
  safeApiPath("/guilds/123/bans/456") && safeApiPath("/channels/1/messages/2") &&
  safeApiPath("/guilds/1/members/2"));
check("dapi refuses to send an unsafe path at all (defence in depth)",
  /if \(!safeApiPath\(path\)\) throw/.test(code));
check("/unban validates before building the path",
  /isSnowflake\(id\)\) return msg/.test(code));

// ----- the pseudonymous mod ledger -----
// state_mod.json lives in the PUBLIC repo, so it is keyed by sha256(token + ":" + id).
// uidKey here and mod_bot.hkey() in Python must agree exactly or /modlogs silently
// reports "no recorded warnings" for someone who has them. This vector is checked
// against the Python implementation in selftest_changes.py.
const { uidKey, userWarns } = _test;
const FAKE_TOKEN = "FAKE.TOKEN.value-1234567890";
check("uidKey matches the Python hkey vector for a snowflake",
  await uidKey({ DISCORD_BOT_TOKEN: FAKE_TOKEN }, "1515436353091801199") === "9f7daef88ffb8316");
check("uidKey matches the Python hkey vector for a short id",
  await uidKey({ DISCORD_BOT_TOKEN: FAKE_TOKEN }, "42") === "6d136b49247c3611");
check("uidKey is stable and distinguishes ids",
  await uidKey({ DISCORD_BOT_TOKEN: FAKE_TOKEN }, "42")
    !== await uidKey({ DISCORD_BOT_TOKEN: FAKE_TOKEN }, "43"));
check("a different salt yields a different key (the ledger is not readable without it)",
  await uidKey({ DISCORD_BOT_TOKEN: "other" }, "42")
    !== await uidKey({ DISCORD_BOT_TOKEN: FAKE_TOKEN }, "42"));
check("userWarns returns undefined (not 'no warnings') when the token is missing",
  await userWarns({}, "42") === undefined);
check("/modlogs distinguishes 'cannot read' from 'no warnings'",
  /w === undefined\) return msg/.test(code));
check("the ledger is never looked up by raw user id",
  !/s\.users\[uid\]/.test(code));

// ----- staff tiers: the bot must not grant powers the guild withholds -----
// The bot is ADMINISTRATOR, so this gate (not Discord) decides what each tier can do.
// 🔨 Moderator is configured in the live guild with kick but NOT ban, yet /ban used the
// same flat check as /warn - so a Moderator could ban through the bot.
const { ADMIN_UP } = _test;
const modMember = { roles: ["RM"], permissions: "0" };
const adminMember = { roles: ["RA"], permissions: "0" };
check("a Moderator is staff for the general commands",
  isStaffFromRoles(modMember, cfg) === true);
check("a Moderator is NOT admin-tier (cannot ban through the bot)",
  isStaffFromRoles(modMember, cfg, ADMIN_UP) === false);
check("an Admin is admin-tier", isStaffFromRoles(adminMember, cfg, ADMIN_UP) === true);
check("an Owner is admin-tier",
  isStaffFromRoles({ roles: ["RO"], permissions: "0" }, cfg, ADMIN_UP) === true);
check("the Administrator bit still passes any tier (they can ban natively anyway)",
  isStaffFromRoles({ roles: [], permissions: "8" }, cfg, ADMIN_UP) === true);
check("a plain member is neither", isStaffFromRoles({ roles: ["X"], permissions: "0" }, cfg, ADMIN_UP) === false);
check("/ban and /unban are gated to admin-tier in source",
  (code.match(/requireRank\(i, env, ADMIN_UP\)/g) || []).length === 2);

// ----- GET /studio: the owner's poster composer page -----
// A static page on the same Worker. It must serve without touching any secret, and
// adding it must not change anything about the interaction endpoint: GET on every
// other path keeps the old plain-text line, and an unsigned POST is still a 401.
const studioRes = await worker.fetch(new Request("https://w.test/studio"), {}, {});
const studioBody = await studioRes.text();
check("GET /studio returns 200", studioRes.status === 200);
check("GET /studio serves HTML with a utf-8 charset",
  (studioRes.headers.get("content-type") || "") === "text/html; charset=utf-8");
check("the page has the poster canvas", studioBody.includes("<canvas"));
check("the page is titled Studio", studioBody.includes("<title>Studio</title>"));
check("the poster canvas is 1080x1350",
  studioBody.includes('width="1080"') && studioBody.includes('height="1350"'));
check("the download is named post.png", studioBody.includes("post.png"));
check("the page loads Poppins from Google Fonts and nothing else remote",
  studioBody.includes("fonts.googleapis.com/css2?family=Poppins") &&
  !/src=|fetch\(|XMLHttpRequest|WebSocket/.test(studioBody.replace(/img\.src = url/, "")));
check("the page names no secret", !/DISCORD_BOT_TOKEN|DISCORD_PUBLIC_KEY|GITHUB_TOKEN|YOUTUBE_API_KEY|CLOUDFLARE/.test(studioBody));
check("the page reads no env binding (env( is CSS safe-area, not a lookup)",
  !/\benv\./.test(studioBody));
check("no logo and no channel name on the page (the owner banned both)",
  !/iboyprime/i.test(studioBody));
const EMDASH = String.fromCharCode(8212);
check("no em dash anywhere in the page", !studioBody.includes(EMDASH));
check("the page has the add-to-home-screen metas",
  studioBody.includes('name="viewport"') && studioBody.includes('name="theme-color"') &&
  studioBody.includes('name="apple-mobile-web-app-capable"'));
check("the page stays lean (no framework, under 32 KB)", studioBody.length < 32768);

const rootRes = await worker.fetch(new Request("https://w.test/"), {}, {});
const OLD_LINE = "Slash commands " + EMDASH + " online.";
check("GET / still returns the old plain-text line",
  rootRes.status === 200 && (await rootRes.text()) === OLD_LINE);
const otherRes = await worker.fetch(new Request("https://w.test/anything-else"), {}, {});
check("GET on any other path keeps the old plain-text line",
  (await otherRes.text()) === OLD_LINE);

const unsignedPost = await worker.fetch(
  new Request("https://w.test/", { method: "POST", body: "{}" }), { DISCORD_PUBLIC_KEY: "ab" }, {});
check("a POST without a valid signature still returns 401", unsignedPost.status === 401);
const unsignedStudioPost = await worker.fetch(
  new Request("https://w.test/studio", { method: "POST", body: "{}" }), { DISCORD_PUBLIC_KEY: "ab" }, {});
check("POST /studio is not a page, it still demands a signature", unsignedStudioPost.status === 401);

console.log(`\n==== worker: ${pass} passed, ${fail} failed ====`);
process.exit(fail ? 1 : 0);
