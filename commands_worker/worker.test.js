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

// The no-gambling rule used to live ONLY in this deletable list, and
// /news keyword remove betting would quietly empty it (deep_merge replaces a list
// wholesale, so nothing ever put it back). The rule now runs in code
// (bots_github/promofilter.py); this guard stops the UI reporting a removal that
// did not and must not happen.
const n7 = applyNewsChange(nc, "keyword", "remove", { list: "exclude", word: "betting" });
check("a protected betting term cannot be removed, and the refusal is reported",
  n7._refused === "protected" && n7.exclude_keywords.includes("betting"));
const n8 = applyNewsChange(n6, "keyword", "remove", { list: "exclude", word: "parlay" });
check("a protected term is refused even when the owner added it himself",
  n8._refused === "protected" && n8.exclude_keywords.includes("parlay"));
const n9 = applyNewsChange({ exclude_keywords: ["kittens"] }, "keyword", "remove",
  { list: "exclude", word: "kittens" });
check("the owner's OWN non-protected words are still removable",
  !n9._refused && !n9.exclude_keywords.includes("kittens"));
check("PROTECTED_EXCLUDES holds the full seventeen-word floor",
  _test.PROTECTED_EXCLUDES.length === 17 && _test.PROTECTED_EXCLUDES.includes("polymarket") === false
  && _test.PROTECTED_EXCLUDES.includes("betting"));

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
// them posted publicly - including /modlogs warning histories and " No permission".
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
// Moderator is configured in the live guild with kick but NOT ban, yet /ban used the
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

// ===== /studio: the password gate =====
// The studio is the owner's poster queue plus a writer for the AI provider key, on a
// PUBLIC workers.dev hostname. Everything below the gate therefore has to be reachable
// only with the password: the editor page, the staged posts (member-visible Discord
// content), the secret writer and even the capability facts.
const {
  ctEq, studioToken, studioTokenValid, cookieValue, requireStudio, parseStaged,
  loginTooMany, noteLoginFail, clearLoginFails, LOGIN_MAX_FAILS, sealBox, bytesToB64,
  AI_PROVIDERS, STUDIO_LIMITS, STUDIO_COOKIE, STUDIO_TTL_MS, LOGIN_HTML, STUDIO_HTML,
  STUDIO_CSP, resetStudioCaches,
} = _test;

const PW = "correct horse battery staple";
const SIGNK = "test-signing-key-abcdefghijklmnop";
const ENV = { STUDIO_PASSWORD: PW, STUDIO_SIGNING_KEY: SIGNK,
              GITHUB_OWNER: "o", GITHUB_REPO: "r" };
const NOENV = { DISCORD_PUBLIC_KEY: "ab" };            // studio deliberately unconfigured
function req(path, init) { return new Request("https://w.test" + path, init); }
function cookieReq(path, value, init) {
  const h = Object.assign({ cookie: STUDIO_COOKIE + "=" + value }, (init && init.headers) || {});
  return new Request("https://w.test" + path, Object.assign({}, init, { headers: h }));
}
function jsonRes(o, status) {
  return new Response(JSON.stringify(o), { status: status || 200, headers: { "content-type": "application/json" } });
}
// Swap globalThis.fetch for one call so the network paths can be exercised offline.
async function withFetch(handler, fn) {
  const real = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (u, init) => { seen.push({ url: String(u && u.url ? u.url : u), init }); return await handler(String(u && u.url ? u.url : u), init); };
  try { return await fn(seen); } finally { globalThis.fetch = real; }
}

// ----- never open by default -----
const unconfigured = await worker.fetch(req("/studio"), NOENV, {});
check("with STUDIO_PASSWORD unset, GET /studio is 503 and not a page",
  unconfigured.status === 503 && (await unconfigured.text()) === "studio not configured");
for (const p of ["/studio/api/staged", "/studio/api/aikey", "/studio/api/limits"])
  check(`with STUDIO_PASSWORD unset, ${p} is closed too (503, never open access)`,
    (await worker.fetch(req(p), NOENV, {})).status === 503);

// ----- the login page -----
const gate = await worker.fetch(req("/studio"), ENV, {});
const gateBody = await gate.text();
check("GET /studio returns 200", gate.status === 200);
check("GET /studio serves HTML with a utf-8 charset",
  (gate.headers.get("content-type") || "") === "text/html; charset=utf-8");
check("an unauthenticated GET /studio serves the login page, NOT the editor",
  gateBody === LOGIN_HTML && gateBody !== STUDIO_HTML);
check("the login page is a single password field", /type="password"/.test(gateBody) &&
  (gateBody.match(/<input/g) || []).length === 1);
check("the login page hints at nothing behind it",
  !/studio|poster|caption|discord|instagram|youtube|queue|editor/i.test(
    gateBody.replace(/\/studio\/login/g, "").replace(/location\.replace\("\/studio"\)/g, "")));
check("the login page is dark with the purple accent and Poppins",
  gateBody.includes("#0b0b11") && gateBody.includes("#8B70FF") && gateBody.includes("Poppins"));
check("the login page names no secret",
  !/DISCORD_BOT_TOKEN|DISCORD_PUBLIC_KEY|GITHUB_TOKEN|YOUTUBE_API_KEY|STUDIO_PASSWORD|CLOUDFLARE/.test(gateBody));
check("the login page reads no env binding", !/\benv\./.test(gateBody));
check("no logo and no channel name on the page (the owner banned both)", !/iboyprime/i.test(gateBody));
const EMDASH2 = String.fromCharCode(8212);
check("no em dash on the login page", !gateBody.includes(EMDASH2));
check("no exclamation mark on the login page", !gateBody.replace(/<!/g, "<").includes("!"));
check("the login page carries the mobile + noindex metas",
  gateBody.includes('name="viewport"') && gateBody.includes('name="theme-color"') &&
  gateBody.includes('name="robots"'));
check("the login page stays lean (no framework, under 8 KB)", gateBody.length < 8192);
check("studio pages ship a CSP that blocks framing and cross-origin exfiltration",
  (gate.headers.get("content-security-policy") || "") === STUDIO_CSP &&
  STUDIO_CSP.includes("frame-ancestors 'none'") && STUDIO_CSP.includes("connect-src 'self'"));
// The page has to FETCH the staged poster (drawing it into a canvas taints the canvas
// unless the bytes arrive by fetch), and connect-src 'self' turned every one of those
// loads into a blocked request plus a console violation.
const cspDir = d => (STUDIO_CSP.split("; ").find(x => x.indexOf(d + " ") === 0) || "");
check("connect-src allows the two Discord CDN hosts the page actually fetches",
  cspDir("connect-src").includes("https://cdn.discordapp.com") &&
  cspDir("connect-src").includes("https://media.discordapp.net"));
check("img-src allows the same two hosts",
  cspDir("img-src").includes("https://cdn.discordapp.com") &&
  cspDir("img-src").includes("https://media.discordapp.net"));
check("neither directive is a blanket https: (an open img-src is its own exfil channel)",
  !/\bhttps:(\s|$)/.test(cspDir("img-src")) && !/\bhttps:(\s|$)/.test(cspDir("connect-src")) &&
  !cspDir("connect-src").includes("*"));
check("the page can still draw what it builds itself (data: and blob: images)",
  cspDir("img-src").includes("data:") && cspDir("img-src").includes("blob:"));
check("default-src is still 'none', so nothing else loads by accident",
  STUDIO_CSP.indexOf("default-src 'none'") === 0);
check("studio responses are never cached", gate.headers.get("cache-control") === "no-store");

// ----- sign in -----
const badLogin = await worker.fetch(req("/studio/login", { method: "POST",
  headers: { "content-type": "application/json" }, body: JSON.stringify({ password: "wrong" }) }), ENV, {});
check("a wrong password returns 401", badLogin.status === 401);
check("a wrong password sets no cookie", !badLogin.headers.get("set-cookie"));
const badBody = await badLogin.text();
check("the failure message is generic (no hint, no echo of the attempt)",
  /sign in failed/i.test(badBody) && !badBody.includes("wrong") && !badBody.includes(PW));
check("an empty password is still a failure",
  (await worker.fetch(req("/studio/login", { method: "POST",
    headers: { "content-type": "application/json" }, body: JSON.stringify({ password: "" }) }), ENV, {})).status === 401);
check("GET /studio/login is not a route (POST only)",
  (await worker.fetch(req("/studio/login"), ENV, {})).status === 405);

const okLogin = await worker.fetch(req("/studio/login", { method: "POST",
  headers: { "content-type": "application/json" }, body: JSON.stringify({ password: PW }) }), ENV, {});
const setCookie = okLogin.headers.get("set-cookie") || "";
check("the right password returns 200", okLogin.status === 200);
check("login sets an HttpOnly, Secure, SameSite=Lax cookie scoped to /studio",
  /^sid=/.test(setCookie) && /HttpOnly/.test(setCookie) && /Secure/.test(setCookie) &&
  /SameSite=Lax/.test(setCookie) && /Path=\/studio/.test(setCookie));
check("the cookie lasts 30 days",
  setCookie.includes("Max-Age=" + Math.floor(STUDIO_TTL_MS / 1000)) && STUDIO_TTL_MS === 2592000000);
check("the login response body never contains the password",
  !(await okLogin.text()).includes(PW) && !setCookie.includes(PW));
const SID = /sid=([^;]+)/.exec(setCookie)[1];

// ----- weak-password visibility -----
// A STUDIO_PASSWORD under 16 chars undermines the fast-hash design, but refusing it
// would lock the owner out. So it still signs in, and the SUCCESS response carries
// X-Studio-Note: weak-password to make the misconfiguration visible in devtools.
// Failures never carry it: that header on a 401 would tell a guesser the password
// is short, which is a hint the gate must not hand out.
const WEAK_ENV = { STUDIO_PASSWORD: "short", STUDIO_SIGNING_KEY: SIGNK };
const weakOk = await worker.fetch(req("/studio/login", { method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ password: "short" }) }), WEAK_ENV, {});
check("a password under 16 chars still signs in (the owner is never locked out)",
  weakOk.status === 200 && /^sid=/.test(weakOk.headers.get("set-cookie") || ""));
check("the successful login flags the weak configuration in a header",
  weakOk.headers.get("x-studio-note") === "weak-password");
const weakBad = await worker.fetch(req("/studio/login", { method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ password: "wrong-guess" }) }), WEAK_ENV, {});
check("a FAILED login never carries the weak-password hint (guessers learn nothing)",
  weakBad.status === 401 && weakBad.headers.get("x-studio-note") === null);
check("a 16+ char password gets no note", okLogin.headers.get("x-studio-note") === null);
clearLoginFails("?");                         // the deliberate failure above, cleaned up

// ----- the session cookie -----
check("a valid signed cookie passes", await requireStudio(cookieReq("/studio", SID), ENV) === true);
check("a valid cookie serves the editor page, byte for byte",
  await (await worker.fetch(cookieReq("/studio", SID), ENV, {})).text() === STUDIO_HTML);
check("no cookie at all is rejected", await requireStudio(req("/studio"), ENV) === false);
check("a forged cookie (payload kept, signature swapped) is rejected",
  await studioTokenValid(ENV, SID.split(".")[0] + ".AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA") === false);
const tampered = btoa(JSON.stringify({ exp: Date.now() + 9e11 })).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
check("a cookie whose payload was edited to extend the expiry is rejected",
  await studioTokenValid(ENV, tampered + "." + SID.split(".")[1]) === false);
const expired = await studioToken(ENV, Date.now() - STUDIO_TTL_MS - 60000);
check("an expired cookie is rejected even though the signature is valid",
  await studioTokenValid(ENV, expired) === false);
check("the same cookie was valid before it expired",
  await studioTokenValid(ENV, expired, Date.now() - STUDIO_TTL_MS - 120000) === true);
check("a cookie signed with a different password is rejected",
  await studioTokenValid(ENV, await studioToken(
    { STUDIO_PASSWORD: "other", STUDIO_SIGNING_KEY: "another-signing-key-xyz" },
    Date.now())) === false);
check("rotating the SIGNING KEY invalidates every outstanding cookie",
  await studioTokenValid({ STUDIO_PASSWORD: PW, STUDIO_SIGNING_KEY: SIGNK + "2" }, SID) === false);
check("a cookie signed with the raw PASSWORD is rejected (no cracking oracle)",
  await studioTokenValid({ STUDIO_PASSWORD: PW, STUDIO_SIGNING_KEY: PW }, SID) === false);
for (const junk of ["", ".", "a.b", "a.b.c", "....", null, undefined, 12345, SID.split(".")[0]])
  check(`a malformed cookie is rejected: ${JSON.stringify(junk)}`,
    await studioTokenValid(ENV, junk) === false);
check("an expired cookie does not serve the editor page",
  await (await worker.fetch(cookieReq("/studio", expired), ENV, {})).text() === LOGIN_HTML);
check("cookieValue reads its own name out of a crowded jar",
  cookieValue(new Request("https://w.test/studio", { headers: { cookie: "a=1; sid=xyz; b=2" } }), "sid") === "xyz");
check("cookieValue does not match a cookie whose name merely ends with sid",
  cookieValue(new Request("https://w.test/studio", { headers: { cookie: "nosid=1" } }), "sid") === null);

// The signature compare must not short-circuit: a byte-by-byte early return leaks the
// shared prefix and turns forging a 30-day cookie into a few hundred requests.
check("ctEq matches equal strings", ctEq("abc", "abc") === true);
check("ctEq rejects a differing byte", ctEq("abc", "abd") === false);
check("ctEq rejects a prefix (length is compared too)", ctEq("abc", "abcd") === false);
check("ctEq handles empty and null without throwing",
  ctEq("", "") === true && ctEq(null, "") === true && ctEq(undefined, "x") === false);
check("the signature is compared in constant time, not with ===",
  /if \(!ctEq\(parts\[1\], expected\)\) return false/.test(code));

// ----- the cookie key is an INDEPENDENT secret, not the password -----
// Keying the HMAC with the raw password handed out an offline cracking oracle: the
// plaintext is fully known ({"exp": <ms>}), so one captured cookie let anyone test
// candidate passwords locally, forever, with nothing to rate limit. The cookie is now
// signed with an INDEPENDENT secret (STUDIO_SIGNING_KEY), so it carries no information
// about the password at all - and no slow KDF is needed, which is what kept the login
// inside the Workers free-plan CPU budget.
const { sha256Bytes, studioSignKey, studioPasswordOk, hmacB64url, ctEqBytes,
        LOGIN_FAIL_DELAY_MS } = _test;
const rawSignedPayload = SID.split(".")[0];
const rawSigned = rawSignedPayload + "." + await hmacB64url(PW, rawSignedPayload);
check("a cookie signed with the RAW password is rejected (the old scheme's key)",
  await studioTokenValid(ENV, rawSigned) === false);
check("that forgery is a real, well-formed cookie otherwise (the key is the only change)",
  rawSigned.split(".").length === 2 && rawSigned.split(".")[0] === rawSignedPayload &&
  rawSigned !== SID && await studioTokenValid(ENV, SID) === true);
const signKey = await studioSignKey(ENV);
check("the signing key is the 32-byte SHA-256 of STUDIO_SIGNING_KEY",
  signKey instanceof Uint8Array && signKey.length === 32);
check("the signing key is bound to the SIGNING secret, not the password",
  ctEqBytes(signKey, await sha256Bytes(SIGNK)) === true &&
  ctEqBytes(signKey, await sha256Bytes(PW)) === false);
check("the cookie signature really is the signing key",
  SID.split(".")[1] === await hmacB64url(signKey, rawSignedPayload));
check("the password is compared as fixed-length hashes in constant time",
  await studioPasswordOk(ENV, PW) === true &&
  await studioPasswordOk(ENV, PW + "x") === false &&
  await studioPasswordOk(ENV, "") === false &&
  /const a = await sha256Bytes\(pw\), b = await sha256Bytes\(candidate\)/.test(code));
check("no slow KDF remains (it broke the free plan's CPU budget)",
  !/deriveBits/.test(code) && !/STUDIO_KDF_ITERS/.test(code)
  && !/crypto.subtle.importKey\("raw", enc.encode\(String\(password/.test(code));
check("both secrets are required - either one missing keeps /studio closed",
  await studioToken({ STUDIO_PASSWORD: PW }, Date.now()) === null &&
  await studioTokenValid({ STUDIO_SIGNING_KEY: SIGNK }, SID) === false);
check("the login compares SHA-256 digests in constant time, not the passwords",
  /studioPasswordOk\(env, supplied\)/.test(code)
  && /ctEqBytes\(a, b\)/.test(code)
  && !/ctEq\(supplied, env\.STUDIO_PASSWORD\)/.test(code));
check("ctEqBytes rejects a one-byte difference and a length difference",
  ctEqBytes(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 3])) === true &&
  ctEqBytes(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 4])) === false &&
  ctEqBytes(new Uint8Array([1, 2]), new Uint8Array([1, 2, 0])) === false &&
  ctEqBytes(null, null) === true);
check("a failed login pays a fixed delay before it answers",
  LOGIN_FAIL_DELAY_MS >= 200 && /await sleep\(LOGIN_FAIL_DELAY_MS\)/.test(code));
check("the limiter comment states it is per isolate and claims no distributed limiting",
  /PER ISOLATE/.test(workerSrc) && /NOT distributed rate limiting/.test(workerSrc));
check("the cookie comment states what is actually true about the signing key",
  /WHAT THIS COOKIE SCHEME DOES, AND WHAT IT DOES NOT DO/.test(workerSrc) &&
  /SEPARATE random secret - never the password/.test(workerSrc) &&
  /offline cracking oracle/.test(workerSrc) &&
  /Error 1102/.test(workerSrc) &&
  !/WHY THIS COOKIE SCHEME IS SAFE/.test(workerSrc));

// ----- logout -----
const bye = await worker.fetch(req("/studio/logout", { method: "POST" }), ENV, {});
check("logout returns 200 and expires the cookie",
  bye.status === 200 && /Max-Age=0/.test(bye.headers.get("set-cookie") || "") &&
  /^sid=;/.test(bye.headers.get("set-cookie") || ""));

// ----- rate limiting -----
clearLoginFails("1.2.3.4");
const T0 = 1000000;
check("a fresh IP is not limited", loginTooMany("1.2.3.4", T0) === false);
for (let i = 0; i < LOGIN_MAX_FAILS; i++) noteLoginFail("1.2.3.4", T0);
check(`${LOGIN_MAX_FAILS} failures in the window locks that IP out`, loginTooMany("1.2.3.4", T0) === true);
check("another IP is unaffected", loginTooMany("5.6.7.8", T0) === false);
check("the lockout lifts after the window", loginTooMany("1.2.3.4", T0 + 11 * 60 * 1000) === false);
clearLoginFails("1.2.3.4");
check("a correct password clears the counter", loginTooMany("1.2.3.4", T0) === false);
check("the limiter is keyed on CF-Connecting-IP", /cf-connecting-ip/i.test(code));

// ----- every studio API needs the cookie -----
for (const [m, p] of [["GET", "/studio/api/staged"], ["GET", "/studio/api/aikey"],
                      ["POST", "/studio/api/aikey"], ["GET", "/studio/api/limits"],
                      ["POST", "/studio"], ["GET", "/studio/api/anything"]]) {
  const r = await worker.fetch(req(p, { method: m }), ENV, {});
  check(`${m} ${p} without a session is 401`, r.status === 401);
}
check("an authenticated unknown studio route is a plain 404",
  (await worker.fetch(cookieReq("/studio/api/nope", SID), ENV, {})).status === 404);
check("a trailing slash does not dodge a route check",
  await (await worker.fetch(cookieReq("/studio/", SID), ENV, {})).text() === STUDIO_HTML &&
  (await worker.fetch(req("/studio//api/staged"), ENV, {})).status === 401);

// ----- staged posts -----
// BOT_ID is this application's own bot user. The staging channel is a staff channel,
// and "staff" is not "us": anyone who can post there could otherwise hand-write a
// "Staged post - score 99" and have it appear in the owner's queue as pipeline output.
const BOT_ID = "1500000000000000001";
const AUTHOR = { id: BOT_ID, username: "bot" };
const STAGED_MSGS = [
  { id: "111", timestamp: "2026-08-13T10:00:00.000Z", author: AUTHOR,
    content: "Staged post - score 82 (clean head kick, sharp crop)\n```\nThe finish nobody called.\nTwo lines of caption.\n\nvia MMA Fighting\n#UFC\n```",
    attachments: [{ url: "https://cdn.discordapp.com/attachments/1/2/post.png" }] },
  { id: "222", timestamp: "2026-08-13T09:00:00.000Z", author: AUTHOR, content: "Staged post - score 7\n```md\nlow scorer\n```",
    attachments: [], embeds: [{ image: { url: "https://media.discordapp.net/x.jpg" } }] },
  { id: "333", timestamp: "2026-08-13T08:00:00.000Z", author: AUTHOR, content: "just some chat in the channel", attachments: [] },
  { id: "444", timestamp: "2026-08-13T07:00:00.000Z", author: AUTHOR, content: "Staged post - score 50 (odd one)",
    attachments: [{ url: "javascript:alert(1)" }] },
];
const staged = parseStaged(STAGED_MSGS, BOT_ID);
check("parseStaged keeps only staged posts", staged.length === 3 && !staged.some(s => s.id === "333"));
check("parseStaged reads the score", staged[0].score === 82 && staged[1].score === 7);
check("parseStaged reads the reason out of the brackets",
  staged[0].why === "clean head kick, sharp crop" && staged[1].why === "");
check("parseStaged reads the caption out of the fenced block",
  staged[0].caption.startsWith("The finish nobody called.\nTwo lines of caption.") && staged[1].caption === "low scorer");
check("parseStaged serves the first attachment through the same-origin proxy "
  + "(a raw CDN url expires in ~24h and broke the reopened app)",
  staged[0].image_url === "/studio/api/img/111/0");
check("parseStaged falls back to an embed image", staged[1].image_url === "https://media.discordapp.net/x.jpg");
check("parseStaged refuses a non-https image url (it lands in an img src)",
  staged[2].image_url === null);
const STAGED_FIELDS = ["about", "bg", "caption", "colorway", "hot", "id", "image_url",
                       "line", "photo_kind", "photo_url", "score", "source", "speaker",
                       "spec", "template", "timestamp", "why"];
check("parseStaged returns exactly the seventeen agreed fields, nothing else",
  staged.every(s => JSON.stringify(Object.keys(s).sort()) === JSON.stringify(STAGED_FIELDS)));
check("spec says whether a post round-trips (fence present), bg is its plate",
  staged[0].spec === false && staged[0].bg === ""
  && staged.every(s => typeof s.spec === "boolean" && typeof s.bg === "string"));
check("parseStaged survives junk",
  parseStaged(null, BOT_ID).length === 0 && parseStaged([{}, null], BOT_ID).length === 0);

// ----- staged posts: the ROUND-TRIP payload -----
// The staging bot ships a ```json spec fence plus the RAW subject as the second
// attachment. The studio must get live text fields and the clean photo - never
// only the rendered card, whose text is baked into the pixels (the bug the
// owner reported: "the text is seemingly baked into the images").
const RT_MSG = {
  id: "555", timestamp: "2026-08-13T11:00:00.000Z", author: AUTHOR,
  content: "Staged post - score 91 (title fight fallout)\n"
    + "Copy the caption, save the image, then post or schedule it in the YouTube app.\n"
    + "```\nMakhachev responds.\n\nvia MMA Fighting\n#UFC\n```\n"
    + "```json\n" + JSON.stringify({ line: "HE NEVER DOUBTED", hot: ["NEVER"],
      source: "MMA Fighting", template: "news", colorway: "purple", photo: "photo" }) + "\n```",
  attachments: [
    { url: "https://cdn.discordapp.com/attachments/1/2/post.png" },
    { url: "https://cdn.discordapp.com/attachments/1/2/photo.jpg" },
  ],
};
const rt = parseStaged([RT_MSG], BOT_ID)[0];
check("round-trip: the raw photo rides as photo_url (attachment 1, proxied)",
  rt.photo_url === "/studio/api/img/555/1");
check("round-trip: the rendered card stays the preview (attachment 0, proxied)",
  rt.image_url === "/studio/api/img/555/0");
check("round-trip: a spec post says so", rt.spec === true);
check("round-trip: the spec fence carries live line/hot/colorway",
  rt.line === "HE NEVER DOUBTED" && rt.hot.length === 1 && rt.hot[0] === "NEVER"
  && rt.colorway === "purple" && rt.template === "news" && rt.photo_kind === "photo");
check("round-trip: a card-only stage has NO photo_url (the studio must not "
  + "load baked-text pixels as the photo)",
  staged[0].photo_url === null && staged[0].photo_kind === "");
const RT_EVIL = { ...RT_MSG, id: "556",
  attachments: [{ url: "https://cdn.discordapp.com/attachments/1/2/post.png" },
                { url: "https://evil.example/photo.jpg" }] };
check("round-trip: photo_url passes the same Discord-CDN gate as image_url",
  parseStaged([RT_EVIL], BOT_ID)[0].photo_url === null);

// ----- staged posts: only OUR bot's messages, only Discord CDN images -----
const { discordCdnUrl, parseStagedOne, DISCORD_CDN_HOSTS } = _test;
// The four round-trip fields added to the contract (photo_url, photo_kind, template,
// colorway) are typed on EVERY entry, not just the happy path: the page indexes them
// without guards, so a stray number or object here becomes a rendering bug there.
const typedStaged = staged.concat([rt]);
check("photo_kind is always one of '', 'photo', 'cutout'",
  typedStaged.every(s => typeof s.photo_kind === "string" &&
    ["", "photo", "cutout"].includes(s.photo_kind)));
check("template and colorway are always short strings",
  typedStaged.every(s => typeof s.template === "string" && s.template.length <= 20 &&
    typeof s.colorway === "string" && s.colorway.length <= 20));
check("photo_url is a same-origin proxy path or null, never anything else",
  typedStaged.every(s => s.photo_url === null ||
    (typeof s.photo_url === "string" && /^\/studio\/api\/img\/\d{1,21}\/1$/.test(s.photo_url))) &&
  typedStaged.some(s => s.photo_url !== null) && typedStaged.some(s => s.photo_url === null));
const IMPOSTOR = { id: "111", timestamp: "2026-08-13T10:00:00.000Z",
  author: { id: "1500000000000000002", username: "someone else" },
  content: "Staged post - score 99 (trust me)\n```\npost this now\n```",
  attachments: [{ url: "https://cdn.discordapp.com/attachments/9/9/fake.png" }] };
check("a staged post written by anyone but our bot is dropped",
  parseStaged([IMPOSTOR], BOT_ID).length === 0);
// The filter is ANCHORED to the message start: a poll whose model-written
// question happens to contain "staged post" must never enter the news rail,
// while a pinged staged post (owner mention first) must.
check("'staged post' mid-text does NOT pull a message into the rail",
  parseStaged([{ id: "7", author: AUTHOR,
    content: "Staged YouTube poll - written fresh\n\nWhat was the most famous "
      + "staged post-fight brawl?\n```\n...\n```" }], BOT_ID).length === 0);
check("a pinged staged post (mention first) still enters the rail",
  parseStaged([{ id: "8", author: AUTHOR,
    content: "<@278312400061726731> Staged post - score 90 (big)\n```\ncap\n```",
    attachments: [] }], BOT_ID).length === 1);
check("the same message from our bot IS kept (the filter is the author, not the text)",
  parseStaged([Object.assign({}, IMPOSTOR, { author: AUTHOR })], BOT_ID).length === 1);
check("a message with no author at all is dropped",
  parseStaged([Object.assign({}, IMPOSTOR, { author: undefined })], BOT_ID).length === 0);
check("parseStaged fails CLOSED with no bot id (an unfiltered queue is the bug)",
  parseStaged(STAGED_MSGS).length === 0 && parseStaged(STAGED_MSGS, "").length === 0 &&
  parseStaged(STAGED_MSGS, null).length === 0 && parseStaged(STAGED_MSGS, "notasnowflake").length === 0);
check("the bot id is resolved from GET /users/@me, not from config",
  /dapi\(env, "GET", "\/users\/@me"\)/.test(code));
check("studioStaged fails closed when it cannot identify itself",
  /const me = await botUserId\(env\);\s*\n\s*if \(!me\) return studioJson/.test(code));
for (const good of ["https://cdn.discordapp.com/attachments/1/2/p.png",
                    "https://media.discordapp.net/attachments/1/2/p.png?width=100"])
  check(`discordCdnUrl accepts ${good.slice(8, 30)}`, discordCdnUrl(good) === good);
for (const bad of ["http://cdn.discordapp.com/x.png", "https://evil.example/x.png",
                   "https://cdn.discordapp.com.evil.example/x.png",
                   "https://evil.example/cdn.discordapp.com/x.png",
                   "javascript:alert(1)", "data:image/png;base64,AAAA", "", null, undefined, 42])
  check(`discordCdnUrl rejects ${JSON.stringify(bad)}`, discordCdnUrl(bad) === null);
check("an attacker-hosted image never reaches image_url",
  parseStagedOne({ id: "1", content: "Staged post - score 90",
    attachments: [{ url: "https://evil.example/poster.png" }] }).image_url === null);
check("the CDN allowlist is exactly the two Discord hosts",
  DISCORD_CDN_HOSTS.length === 2 && DISCORD_CDN_HOSTS.includes("cdn.discordapp.com") &&
  DISCORD_CDN_HOSTS.includes("media.discordapp.net"));

// ----- the poster-spec fields the studio page renders -----
const SPEC_MSG = { id: "555", timestamp: "2026-08-13T11:00:00.000Z", author: AUTHOR,
  content: "Staged post - score 91 (quote card)\n```\nHe said what nobody would.\n\nvia MMA Fighting\n#UFC\n```\n" +
           '```json\n{"line":"I WILL FINISH HIM","hot":["FINISH"," ",7,"HIM"],' +
           '"speaker":"Tom Aspinall","source":"MMA Fighting","about":"the title fight","extra":"ignored"}\n```' };
const spec = parseStaged([SPEC_MSG], BOT_ID)[0];
check("the spec fence fills line, speaker, source and about",
  spec.line === "I WILL FINISH HIM" && spec.speaker === "Tom Aspinall" &&
  spec.source === "MMA Fighting" && spec.about === "the title fight");
check("hot is always an array of clean strings", Array.isArray(spec.hot) &&
  JSON.stringify(spec.hot) === JSON.stringify(["FINISH", "HIM"]));
check("the spec fence is not mistaken for the caption",
  spec.caption.startsWith("He said what nobody would.") && !spec.caption.includes("json"));
check("no spec fence still yields the contract shape, never undefined",
  staged[1].line === "low scorer" && staged[1].speaker === "" && staged[1].about === "" &&
  Array.isArray(staged[1].hot) && staged[1].hot.length === 0);
check("source falls back to the caption's via line",
  staged[0].source === "MMA Fighting" && staged[1].source === "");
check("a junk spec fence degrades instead of throwing",
  parseStaged([{ id: "6", author: AUTHOR, content: "Staged post - score 5\n```json\n{not json\n```" }],
    BOT_ID)[0].line === "");

const STUDIO_ENV = Object.assign({ DISCORD_BOT_TOKEN: "BOT.TOKEN.secret", GITHUB_TOKEN: "gh_secret_token" }, ENV);
resetStudioCaches();
const noChannel = await withFetch(async (u) => {
  if (u.includes("bots_config.json")) return jsonRes({ channels: { chat: "1515436353091801199" } });
  return new Response("nope", { status: 404 });
}, async () => await worker.fetch(cookieReq("/studio/api/staged", SID), STUDIO_ENV, {}));
check("staged hard-fails when channels.studio is missing (no fallback channel)",
  noChannel.status === 503 && /channels\.studio/.test(await noChannel.text()));

resetStudioCaches();
const noMe = await withFetch(async (u) => {
  if (u.includes("bots_config.json")) return jsonRes({ channels: { studio: "1515436353091801199" } });
  if (u.includes("/channels/1515436353091801199/messages")) return jsonRes(STAGED_MSGS);
  return new Response("nope", { status: 404 });               // /users/@me fails
}, async (seen) => {
  const r = await worker.fetch(cookieReq("/studio/api/staged", SID), STUDIO_ENV, {});
  check("staged is 502 when the bot user cannot be resolved (never an unfiltered queue)",
    r.status === 502);
  check("and it does not fall back to reading the channel unfiltered",
    !seen.some(s => s.url.includes("/messages")));
  return true;
});
check("the bot-identity stub ran", noMe === true);

resetStudioCaches();
const okStaged = await withFetch(async (u) => {
  if (u.includes("bots_config.json")) return jsonRes({ channels: { studio: "1515436353091801199", chat: "999" } });
  if (u.endsWith("/users/@me")) return jsonRes({ id: BOT_ID, username: "bot", bot: true });
  if (u.includes("/channels/1515436353091801199/messages")) return jsonRes(STAGED_MSGS);
  return new Response("nope", { status: 404 });
}, async (seen) => {
  const r = await worker.fetch(cookieReq("/studio/api/staged", SID), STUDIO_ENV, {});
  const body = await r.text();
  check("staged returns the parsed queue", r.status === 200 && JSON.parse(body).length === 3);
  check("staged never leaks the bot token", !body.includes("BOT.TOKEN.secret") && !body.includes("gh_secret_token"));
  check("staged reads only the studio channel",
    seen.filter(s => s.url.includes("/channels/")).every(s => s.url.includes("/channels/1515436353091801199/")));
  check("staged asks for the last 25 messages",
    seen.some(s => s.url.includes("/messages?limit=25")));
  return true;
});
check("the staged fetch stub ran", okStaged === true);
resetStudioCaches();
check("staged needs the bot token", (await worker.fetch(cookieReq("/studio/api/staged", SID), ENV, {})).status === 503);
check("the studio channel id is validated as a snowflake before it hits the API path",
  /isSnowflake\(ch\)/.test(code));
check("the bots_config lookup is cached (one raw read per 5 minutes)", /300000/.test(code));

// ----- the staged-attachment proxy (/studio/api/img/<mid>/<idx>) -----
// The page holds only these paths; the expiring CDN url is re-derived here.
check("stagedImgPath builds the path the contract promises",
  _test.stagedImgPath("555", 0) === "/studio/api/img/555/0");
resetStudioCaches();
check("a non-snowflake message id is a 404 before any lookup",
  (await withFetch(async () => { throw new Error("must not be called"); },
    async () => await worker.fetch(cookieReq("/studio/api/img/notasnowflake/0", SID), STUDIO_ENV, {}))).status === 404);
check("only attachment 0 or 1 is reachable",
  (await withFetch(async () => { throw new Error("must not be called"); },
    async () => await worker.fetch(cookieReq("/studio/api/img/1500000000000000009/2", SID), STUDIO_ENV, {}))).status === 404);
check("a malformed proxy path is a 404, never a fall-through",
  (await withFetch(async () => { throw new Error("must not be called"); },
    async () => await worker.fetch(cookieReq("/studio/api/img/1/2/3", SID), STUDIO_ENV, {}))).status === 404);
check("the proxy sits behind the session gate like every studio route",
  (await worker.fetch(req("/studio/api/img/1500000000000000009/0"), STUDIO_ENV, {})).status === 401);
resetStudioCaches();
const IMG_CH = "1515436353091801199";
// a live message id IS a snowflake, and studioImg validates that before any
// lookup - so the proxy fixtures carry one (the parse fixtures above use
// short ids on purpose; parseStagedOne never validates, the route does)
const IMG_MID = "1500000000000000555";
const RT_SNOW = Object.assign({}, RT_MSG, { id: IMG_MID });
const imgHandler = (msg) => async (u) => {
  if (u.includes("bots_config.json")) return jsonRes({ channels: { studio: IMG_CH } });
  if (u.endsWith("/users/@me")) return jsonRes({ id: BOT_ID, username: "bot", bot: true });
  if (u.includes("/channels/" + IMG_CH + "/messages/" + IMG_MID)) return jsonRes(msg);
  if (u.includes("cdn.discordapp.com")) {
    return new Response(new Uint8Array([137, 80, 78, 71]), {
      status: 200, headers: { "content-type": "image/png" } });
  }
  return new Response("nope", { status: 404 });
};
const okImg = await withFetch(imgHandler(RT_SNOW), async (seen) => {
  const r = await worker.fetch(cookieReq("/studio/api/img/" + IMG_MID + "/1", SID), STUDIO_ENV, {});
  const buf = new Uint8Array(await r.arrayBuffer());
  check("the proxy streams the attachment bytes same-origin",
    r.status === 200 && buf.length === 4 && buf[0] === 137
    && /^image\//.test(r.headers.get("content-type") || ""));
  check("the proxy serves RASTER types only, sandboxed (an SVG is a "
    + "scriptable document and must never execute in the studio origin)",
    ["image/png", "image/jpeg", "image/webp", "image/gif"]
      .includes(r.headers.get("content-type"))
    && (r.headers.get("content-security-policy") || "").includes("sandbox")
    && r.headers.get("x-content-type-options") === "nosniff");
  check("the proxy fetched the SIGNED url Discord returned, fresh",
    seen.some(s => s.url.includes("cdn.discordapp.com") && s.url.includes("photo.jpg")));
  const r2 = await worker.fetch(cookieReq("/studio/api/img/" + IMG_MID + "/0", SID), STUDIO_ENV, {});
  check("the second attachment resolves from the message CACHE (one Discord read)",
    r2.status === 200
    && seen.filter(s => s.url.includes("/messages/" + IMG_MID)).length === 1);
  return true;
});
check("the proxy stub ran", okImg === true);
resetStudioCaches();
const IMPOSTOR_MSG = Object.assign({}, RT_SNOW,
  { author: { id: "1500000000000000002", username: "someone else" } });
check("a message by anyone but our bot is 404 - the proxy fails closed",
  (await withFetch(imgHandler(IMPOSTOR_MSG),
    async () => await worker.fetch(cookieReq("/studio/api/img/" + IMG_MID + "/1", SID), STUDIO_ENV, {}))).status === 404);
resetStudioCaches();
const EVIL_ATT = Object.assign({}, RT_SNOW,
  { attachments: [{ url: "https://evil.example/x.png" }] });
check("an off-CDN attachment url never gets fetched (same gate as the list)",
  (await withFetch(imgHandler(EVIL_ATT),
    async (seen) => {
      const r = await worker.fetch(cookieReq("/studio/api/img/" + IMG_MID + "/0", SID), STUDIO_ENV, {});
      return r.status === 404 && !seen.some(s => s.url.includes("evil.example"));
    })) === true);
resetStudioCaches();

// ----- the AI key writer -----
const PROVIDERS7 = ["deepseek", "openrouter", "zai", "groq", "together", "mistral", "openai"];
check("all seven provider names exist, and each maps to a fixed secret name",
  AI_PROVIDERS.deepseek === "DEEPSEEK_API_KEY" && AI_PROVIDERS.openrouter === "OPENROUTER_API_KEY" &&
  AI_PROVIDERS.zai === "ZAI_API_KEY" && AI_PROVIDERS.groq === "GROQ_API_KEY" &&
  AI_PROVIDERS.together === "TOGETHER_API_KEY" && AI_PROVIDERS.mistral === "MISTRAL_API_KEY" &&
  AI_PROVIDERS.openai === "OPENAI_API_KEY" && Object.keys(AI_PROVIDERS).length === 7);
check("the name list and the secret map describe the same seven providers",
  JSON.stringify(_test.AI_PROVIDER_NAMES.slice()) === JSON.stringify(PROVIDERS7) &&
  JSON.stringify(Object.keys(AI_PROVIDERS)) === JSON.stringify(PROVIDERS7));
// A provider present in only one of the two structures resolves to null and is rejected,
// which is the safe direction for a half-finished addition to fail in.
check("every listed provider resolves to a secret name of the shape GitHub accepts",
  _test.AI_PROVIDER_NAMES.every(p => /^[A-Z][A-Z0-9_]{2,99}$/.test(_test.aiSecretName(p) || "")));
check("no two providers share a secret name",
  new Set(_test.AI_PROVIDER_NAMES.map(p => _test.aiSecretName(p))).size === _test.AI_PROVIDER_NAMES.length);
const keyStatus = await withFetch(async (u) => {
  if (u.includes("/actions/secrets")) return jsonRes({ total_count: 3, secrets: [
    { name: "DEEPSEEK_API_KEY", created_at: "2026-08-01" }, { name: "GROQ_API_KEY", created_at: "2026-08-10" },
    { name: "DISCORD_BOT_TOKEN", created_at: "2026-01-01" }] });
  return new Response("nope", { status: 404 });
}, async () => await worker.fetch(cookieReq("/studio/api/aikey", SID), STUDIO_ENV, {}));
const keyStatusBody = await keyStatus.text();
check("aikey GET reports presence only, as seven booleans in the contract order",
  keyStatusBody === JSON.stringify({ providers: { deepseek: true, openrouter: false, zai: false,
    groq: true, together: false, mistral: false, openai: false } }));
check("aikey GET reports a stored key for exactly the providers GitHub listed",
  Object.entries(JSON.parse(keyStatusBody).providers)
    .every(([p, v]) => v === (p === "deepseek" || p === "groq")));
check("aikey GET never returns key material or any other secret name",
  !/sk-|DISCORD_BOT_TOKEN|gh_secret_token|BOT\.TOKEN/.test(keyStatusBody));
check("aikey GET lists secret NAMES only (values cannot be read back from GitHub at all)",
  /actions\/secrets\?per_page/.test(code) && !/encrypted_value.*response/i.test(code));
check("aikey GET needs the GITHUB_TOKEN secret",
  (await worker.fetch(cookieReq("/studio/api/aikey", SID), ENV, {})).status === 503);

async function postKey(body, env) {
  return await worker.fetch(cookieReq("/studio/api/aikey", SID, { method: "POST",
    headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), env || STUDIO_ENV, {});
}
// "openai" is a REAL provider now, so the unknown-provider case needs a name that is
// genuinely off the list. A stale test here would have quietly stopped testing anything.
check("aikey POST rejects an unknown provider", (await postKey({ provider: "notaprovider", key: "sk-abcdefgh" })).status === 400);
check("aikey POST rejects a provider that only looks close", (await postKey({ provider: "open-ai", key: "sk-abcdefgh" })).status === 400);
check("aikey POST rejects a missing provider", (await postKey({ key: "sk-abcdefgh" })).status === 400);
check("aikey POST rejects a key that is too short", (await postKey({ provider: "deepseek", key: "abc" })).status === 400);
check("aikey POST rejects a key with whitespace in it",
  (await postKey({ provider: "deepseek", key: "sk-abc def" })).status === 400);
const REALKEY = "sk-or-v1-0123456789abcdef0123456789abcdef";
const wrote = await withFetch(async (u, init) => {
  if (u.endsWith("/actions/secrets/public-key"))
    return jsonRes({ key_id: "568250167242549743", key: bytesToB64(new Uint8Array(32).fill(7)) });
  if (u.endsWith("/actions/secrets/OPENROUTER_API_KEY")) return new Response(null, { status: 204 });
  return new Response("nope", { status: 404 });
}, async (seen) => {
  const r = await postKey({ provider: "openrouter", key: REALKEY });
  const body = await r.text();
  const put = seen.find(s => s.url.endsWith("/actions/secrets/OPENROUTER_API_KEY")) || { init: {} };
  check("aikey POST stores the key as a GitHub Actions secret", r.status === 200 && /"stored":true/.test(body));
  check("aikey POST never echoes the key back", !body.includes(REALKEY));
  check("aikey POST writes to the allowlisted secret name only",
    put.init && put.init.method === "PUT");
  check("the key is sealed, never sent in the clear",
    !!put.init && !String(put.init.body || "").includes(REALKEY) &&
    /"encrypted_value"/.test(String((put.init || {}).body || "")));
  return true;
});
check("the aikey write stub ran", wrote === true);
check("aikey POST needs the GITHUB_TOKEN secret",
  (await postKey({ provider: "deepseek", key: "sk-abcdefgh" }, ENV)).status === 503);

// ----- the provider allowlist was bypassable through the prototype chain -----
// AI_PROVIDERS["__proto__"] is Object.prototype: truthy, so the "unknown provider"
// check passed, and the secret NAME it produced stringified into the API path as
// PUT /repos/o/r/actions/secrets/[object Object]. "constructor" and "toString" are the
// same trick with different garbage. The gate is now an ownership test.
const { own, aiSecretName, AI_PROVIDER_NAMES, safeKey } = _test;
for (const evil of ["__proto__", "constructor", "toString", "valueOf", "hasOwnProperty",
                    "notaprovider", "", "prototype", "zai ", "deepseek/../../x", "anthropic"]) {
  const fired = [];
  const r = await withFetch(async (u) => { fired.push(u); return new Response("nope", { status: 404 }); },
    async () => await postKey({ provider: evil, key: "sk-abcdefghijklmnop" }));
  const body = await r.text();
  check(`aikey POST rejects provider ${JSON.stringify(evil)} with 400`, r.status === 400);
  check(`provider ${JSON.stringify(evil)} fires no outbound request at all`, fired.length === 0);
  check(`provider ${JSON.stringify(evil)} never produces a secret name`,
    aiSecretName(evil) === null && !body.includes("object Object"));
}
check("the real providers still resolve to their fixed secret names",
  aiSecretName("deepseek") === "DEEPSEEK_API_KEY" && aiSecretName("OpenRouter") === "OPENROUTER_API_KEY" &&
  aiSecretName("zai") === "ZAI_API_KEY" && aiSecretName("GROQ") === "GROQ_API_KEY" &&
  aiSecretName("together") === "TOGETHER_API_KEY" && aiSecretName("mistral") === "MISTRAL_API_KEY" &&
  aiSecretName("openai") === "OPENAI_API_KEY");
check("the allowlist is frozen, so no request can extend it at runtime",
  Object.isFrozen(AI_PROVIDERS) && Object.isFrozen(AI_PROVIDER_NAMES));

// ----- the provider endpoint table -----
// Every entry was checked against the provider's own docs. These assertions are not
// "does the string exist" busywork: a wrong host is an outbound request to somewhere the
// owner did not choose, and a wrong path is a silent 404 on every scoring call.
const { AI_ENDPOINTS, aiEndpoint } = _test;
const EXPECTED_ENDPOINTS = {
  deepseek:   ["https://api.deepseek.com/chat/completions", "deepseek-chat"],
  openrouter: ["https://openrouter.ai/api/v1/chat/completions", "deepseek/deepseek-v3.2"],
  zai:        ["https://api.z.ai/api/paas/v4/chat/completions", "glm-4.5-flash"],
  groq:       ["https://api.groq.com/openai/v1/chat/completions", "llama-3.3-70b-versatile"],
  together:   ["https://api.together.xyz/v1/chat/completions", "meta-llama/Llama-3.3-70B-Instruct-Turbo"],
  mistral:    ["https://api.mistral.ai/v1/chat/completions", "mistral-small-latest"],
  openai:     ["https://api.openai.com/v1/chat/completions", "gpt-4o-mini"],
};
for (const p of PROVIDERS7) {
  const meta = aiEndpoint(p);
  check(`${p} carries the verified endpoint and default model`,
    !!meta && meta.url === EXPECTED_ENDPOINTS[p][0] && meta.model === EXPECTED_ENDPOINTS[p][1] &&
    typeof meta.label === "string" && meta.label.length > 0);
}
check("every provider name in the allowlist has an endpoint entry",
  _test.AI_PROVIDER_NAMES.every(p => !!aiEndpoint(p)) &&
  Object.keys(AI_ENDPOINTS).length === _test.AI_PROVIDER_NAMES.length);
check("every endpoint is https and a chat-completions path",
  Object.values(AI_ENDPOINTS).every(m => m.url.startsWith("https://") && /\/chat\/completions$/.test(m.url)));
check("no two providers point at the same URL",
  new Set(Object.values(AI_ENDPOINTS).map(m => m.url)).size === PROVIDERS7.length);
// OpenRouter retired the deepseek/deepseek-chat slug; shipping it would 404 every call.
check("the openrouter default is not the retired deepseek/deepseek-chat slug",
  aiEndpoint("openrouter").model !== "deepseek/deepseek-chat");
check("the endpoint table is frozen top and bottom",
  Object.isFrozen(AI_ENDPOINTS) && Object.values(AI_ENDPOINTS).every(m => Object.isFrozen(m)));
check("the endpoint table holds no key material, only public endpoint facts",
  !/API_KEY|Bearer|sk-/.test(JSON.stringify(AI_ENDPOINTS)));
for (const evil of ["__proto__", "constructor", "toString", "notaprovider", ""])
  check(`aiEndpoint(${JSON.stringify(evil)}) is null, never a prototype member`, aiEndpoint(evil) === null);
check("aiEndpoint is an own-property read, not a bare obj[userInput] lookup",
  !/AI_ENDPOINTS\[/.test(code.replace(/own\(AI_ENDPOINTS, [a-z]+\)/g, "")));
check("no allowlist gate in the file is a bare obj[userInput] lookup",
  !/AI_PROVIDERS\[/.test(code.replace(/own\(AI_PROVIDERS, [a-z]+\)/g, "")) &&
  !/CONTEXT\[d\.name\]/.test(code) && !/COMMANDS\[d\.name\]/.test(code));
check("the dispatcher only ever calls a real own handler",
  /own\(CONTEXT, d\.name\) : own\(COMMANDS, d\.name\)/.test(code) &&
  /typeof handler !== "function"/.test(code));

// own(): the primitive the whole audit rests on.
check("own reads a real own property", own({ a: 1 }, "a") === 1);
for (const k of ["__proto__", "constructor", "toString", "valueOf", "missing"])
  check(`own returns undefined for ${JSON.stringify(k)} on a plain object`, own({}, k) === undefined);
check("own survives null and undefined", own(null, "a") === undefined && own(undefined, "a") === undefined);
check("safeKey blocks the three writable-key traps",
  !safeKey("__proto__") && !safeKey("constructor") && !safeKey("prototype") &&
  safeKey("1515436353091801199") && !safeKey(""));

// The same class of bug in the config writers: `channels["__proto__"] = {...}` reparents
// the object instead of adding a channel, and that object is JSON we commit to a public
// repo. Every key from an interaction is checked before it is used as a key.
const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o || {}, k);
const polluted = applyModChange(mc, "channel", "set-profile", { channel: "__proto__", profile: "sfw_strict" });
check("/mod set-profile refuses __proto__ as a channel id",
  !hasOwn(polluted.channels, "__proto__") && Object.getPrototypeOf(polluted.channels) === Object.prototype &&
  ({}).profile === undefined);
const polluted2 = applyModChange(mc, "media", "policy", { channel: "__proto__", policy: "no_links" });
check("/mod media policy refuses __proto__ as a channel id",
  Object.getPrototypeOf(polluted2.channels || {}) === Object.prototype && ({}).media_policy === undefined);
check("/mod word add refuses a category outside the closed set of six",
  !hasOwn(applyModChange(mc, "word", "add", { category: "__proto__", word: "x" }).categories, "__proto__") &&
  !hasOwn(applyModChange(mc, "word", "add", { category: "invented", word: "x" }).categories, "invented"));
check("/mod media policy refuses a policy outside MEDIA_POLICIES",
  applyModChange(mc, "media", "policy", { channel: "C9", policy: "delete_everything" }).channels.C9 === undefined);
// "__proto__" matches an identifier regex perfectly well, so a shape check alone is not
// a defence when the name becomes an object KEY: `sources["__proto__"] = {}` reparents
// the sources object and every later read walks through the attacker's object.
const newsPoll = applyNewsChange(nc, null, "source", { name: "__proto__", state: "on" });
check("/news source refuses __proto__ as a feed name",
  !hasOwn(newsPoll.sources, "__proto__") && ({}).enabled === undefined &&
  Object.getPrototypeOf(newsPoll.sources) === Object.prototype &&
  newsPoll.sources.enabled === undefined);
check("/news category refuses __proto__ too",
  Object.getPrototypeOf(applyNewsChange(nc, null, "category", { name: "__proto__", state: "on" }).categories)
    === Object.prototype);
check("a real feed name still toggles (the guard is not a blanket refusal)",
  applyNewsChange(nc, null, "source", { name: "sherdog", state: "off" }).sources.sherdog.enabled === false);
check("resolveCats does not resolve __proto__ to Object.prototype",
  resolveCats(mc, "__proto__").profile === "standard" &&
  resolveCats(mc, "constructor").profile === "standard");
check("an option named __proto__ cannot reparent the option map",
  subPath({ data: { options: [{ type: 1, name: "x", options: [
    { name: "__proto__", value: { polluted: true } }, { name: "ok", value: "1" }] }] } }).opts.ok === "1" &&
  ({}).polluted === undefined);

// ----- the poll question bank -----
const { pollShape, POLL_EMPTY } = _test;
const BANK = [
  { q: "Who is the greatest UFC fighter of all time?", options: [
    { label: "Jon Jones", emoji: "G", img: "" }, { label: "Georges St-Pierre", emoji: "K", img: "gsp" }] },
  { q: "Second question", options: [{ label: "A", emoji: "", img: "" }] },
  { q: "Third question", options: [{ label: "B", emoji: "", img: "" }] },
];
resetStudioCaches();
const pollRes = await withFetch(async (u) => {
  if (u.endsWith("/polls_data.json")) return jsonRes(BANK);
  if (u.endsWith("/state_polls.json")) return jsonRes({ v: 1, cursor: 2, last_day: "2026-08-13" });
  return new Response("nope", { status: 404 });
}, async () => await worker.fetch(cookieReq("/studio/api/poll", SID), STUDIO_ENV, {}));
const pollBody = JSON.parse(await pollRes.text());
check("poll returns 200 in the contract shape",
  pollRes.status === 200 && typeof pollBody.question === "string" && Array.isArray(pollBody.options));
check("poll serves the entry the bot posts next (the committed cursor)",
  pollBody.question === "Third question");
check("poll options carry label, emoji and img and nothing else",
  pollBody.options.every(o => JSON.stringify(Object.keys(o).sort()) === JSON.stringify(["emoji", "img", "label"])));
resetStudioCaches();
const pollNoState = await withFetch(async (u) => {
  if (u.endsWith("/polls_data.json")) return jsonRes(BANK);
  return new Response("nope", { status: 404 });
}, async () => await worker.fetch(cookieReq("/studio/api/poll", SID), STUDIO_ENV, {}));
check("with no cursor state it serves the first entry",
  JSON.parse(await pollNoState.text()).question === BANK[0].q);
resetStudioCaches();
const pollDead = await withFetch(async () => new Response("nope", { status: 404 }),
  async () => await worker.fetch(cookieReq("/studio/api/poll", SID), STUDIO_ENV, {}));
check("an unreachable bank degrades to the empty shape, never an error",
  pollDead.status === 200 && (await pollDead.text()) === JSON.stringify(POLL_EMPTY));
// AI-first staging (Aug 19 2026): the bot commits what it ACTUALLY staged as
// state.last_entry, and that beats the bank cursor - with a provider key live
// the cursor barely moves, so "the next bank entry" stopped being true.
resetStudioCaches();
const pollLast = await withFetch(async (u) => {
  if (u.endsWith("/polls_data.json")) return jsonRes(BANK);
  if (u.endsWith("/state_polls.json")) return jsonRes({ v: 2, cursor: 1,
    last_entry: { q: "What is the worst judging robbery in UFC history?", type: "poll",
      options: [{ label: "Jones vs Reyes", emoji: "⚖️" },
                { label: "Other (comment below)", emoji: "🤔" }] } });
  return new Response("nope", { status: 404 });
}, async () => await worker.fetch(cookieReq("/studio/api/poll", SID), STUDIO_ENV, {}));
const pollLastBody = JSON.parse(await pollLast.text());
check("the composer pre-fills the LAST STAGED entry when the bot committed one",
  pollLastBody.question === "What is the worst judging robbery in UFC history?" &&
  pollLastBody.options.length === 2 && pollLastBody.options[0].label === "Jones vs Reyes" &&
  pollLastBody.options.every(o => JSON.stringify(Object.keys(o).sort()) === JSON.stringify(["emoji", "img", "label"])));
resetStudioCaches();
const pollLastPost = await withFetch(async (u) => {
  if (u.endsWith("/polls_data.json")) return jsonRes(BANK);
  if (u.endsWith("/state_polls.json")) return jsonRes({ v: 2, cursor: 1,
    last_entry: { q: "A discussion post, not a poll. Comment below.", type: "post", options: [] } });
  return new Response("nope", { status: 404 });
}, async () => await worker.fetch(cookieReq("/studio/api/poll", SID), STUDIO_ENV, {}));
check("a staged DISCUSSION post never pre-fills the poll tab (bank cursor instead)",
  JSON.parse(await pollLastPost.text()).question === "Second question");
check("poll needs the session cookie like every other studio API",
  (await worker.fetch(req("/studio/api/poll"), ENV, {})).status === 401);
check("the poll read is cached for 5 minutes like bots_config",
  /_pollCache\.at < 300000/.test(code));
check("pollShape is total: junk in, contract shape out",
  JSON.stringify(pollShape(null)) === JSON.stringify(POLL_EMPTY) &&
  JSON.stringify(pollShape(undefined)) === JSON.stringify(POLL_EMPTY) &&
  pollShape({ q: 1, options: "not an array" }).options.length === 0 &&
  pollShape({ q: "x", options: [{ label: "" }, { label: "y" }] }).options.length === 1);
check("the poll bank is read from the repo, not embedded here",
  /polls_data\.json/.test(code) && !/greatest UFC fighter/.test(workerSrc));

// libsodium's crypto_box_seal is the ONLY format GitHub accepts, and it is not plain
// crypto_box: the nonce is blake2b(ephemeral_pk || recipient_pk, 24). Getting that wrong
// produces a payload GitHub stores and every workflow then fails to decrypt, silently.
let sealShape = false, sealOpens = false, sealDeps = false;
try {
  const nacl = (await import("tweetnacl")).default;
  const blake = await import("blakejs");
  const b2b = blake.blake2b || (blake.default && blake.default.blake2b);
  sealDeps = !!(nacl && nacl.box && b2b);
  const kp = nacl.box.keyPair();
  const secret = "sk-round-trip-test";
  const sealed = await sealBox(new TextEncoder().encode(secret), bytesToB64(kp.publicKey));
  const raw = Uint8Array.from(atob(sealed), c => c.charCodeAt(0));
  sealShape = raw.length === 32 + 16 + secret.length;
  const epk = raw.slice(0, 32), ct = raw.slice(32);
  const ni = new Uint8Array(64); ni.set(epk, 0); ni.set(kp.publicKey, 32);
  const opened = nacl.box.open(ct, b2b(ni, null, 24), epk, kp.secretKey);
  sealOpens = !!opened && new TextDecoder().decode(opened) === secret;
} catch (e) {}
check("the sealed box dependencies are installed (run npm install in commands_worker)", sealDeps);
check("sealBox output is ephemeral key (32) + Poly1305 tag (16) + ciphertext", sealShape);
check("sealBox produces a real libsodium sealed box that the recipient key opens", sealOpens);
check("the sealed box nonce is blake2b(ephemeral_pk || recipient_pk, 24)",
  /b2b\(nonceInput, null, 24\)/.test(code) && /nonceInput\.set\(rpk, 32\)/.test(code));
check("sealBox refuses a public key that is not 32 bytes",
  await sealBox(new TextEncoder().encode("x"), bytesToB64(new Uint8Array(16))) === null);
check("a missing crypto dependency returns 501, it never ships a broken payload",
  /status: 501/.test(code) && /sealed box encryption is not available/.test(code));

// ----- usage: honest numbers or null, never an invented one -----
// The whole point of this route is that the owner can trust it. A plausible-looking
// number with no provenance is the failure mode being tested against, so every case
// below checks the `source` string as hard as it checks the number.
const { parseBalance, startOfUtcDay, resetUsageCounter, resetUsageCache, repoVisibility,
        CF_FREE_REQUESTS_PER_DAY, CF_FREE_CPU_MS, cloudflareRequestsToday } = _test;
const CF_TOKEN = "cf_analytics_token_secret";
const AI_ENV = Object.assign({ CLOUDFLARE_ANALYTICS_TOKEN: CF_TOKEN,
                               CLOUDFLARE_ACCOUNT_ID: "acc123", WORKER_NAME: "iboyprime-commands" }, STUDIO_ENV);
const SECRETS_LIST = { total_count: 2, secrets: [
  { name: "DEEPSEEK_API_KEY", created_at: "2026-08-01" }, { name: "DISCORD_BOT_TOKEN", created_at: "2026-01-01" }] };
function usageReq(env, handler) {
  resetUsageCache();       // each case below exercises a fresh assembly, never the cache
  return withFetch(handler, async (seen) => {
    const r = await worker.fetch(cookieReq("/studio/api/usage", SID), env, {});
    return { status: r.status, body: await r.text(), seen };
  });
}
check("usage without a session is 401, like every other studio API",
  (await worker.fetch(req("/studio/api/usage"), ENV, {})).status === 401);
check("usage with STUDIO_PASSWORD unset is closed too (503, never open access)",
  (await worker.fetch(req("/studio/api/usage"), NOENV, {})).status === 503);
check("usage is behind requireStudio in source, below the auth gate",
  code.indexOf('if (!authed) return studioJson({ error: "unauthorized" }, 401);') <
  code.indexOf('path === "/studio/api/usage"'));

// --- no analytics token: the per-isolate counter, labelled as the approximation it is ---
resetUsageCounter();
const uCount = await usageReq(STUDIO_ENV, async (u) => {
  if (u.includes("/actions/secrets")) return jsonRes(SECRETS_LIST);
  return new Response("nope", { status: 404 });
});
const uc = JSON.parse(uCount.body);
check("usage returns 200 in the contract shape", uCount.status === 200 &&
  !!uc.cloudflare && !!uc.github_actions && !!uc.ai && Array.isArray(uc.notes));
check("usage names the free plan and its two documented ceilings",
  uc.cloudflare.plan === "free" && uc.cloudflare.requests_per_day_limit === CF_FREE_REQUESTS_PER_DAY &&
  uc.cloudflare.cpu_ms_per_request_limit === CF_FREE_CPU_MS &&
  CF_FREE_REQUESTS_PER_DAY === 100000 && CF_FREE_CPU_MS === 10);
check("with no analytics token the count is the isolate tally, and says so",
  typeof uc.cloudflare.requests_today === "number" && uc.cloudflare.requests_today >= 1 &&
  uc.cloudflare.source.includes("counted in this worker instance since it started") &&
  /approximation/.test(uc.cloudflare.source));
check("it tells the owner how to get the account-wide total instead of guessing it",
  uc.cloudflare.source.includes("CLOUDFLARE_ANALYTICS_TOKEN"));
check("the approximation names the instant it started counting from",
  /started at \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/.test(uc.cloudflare.source));
check("the counter really counts (a second request reports a higher tally)",
  JSON.parse((await usageReq(STUDIO_ENV, async (u) =>
    u.includes("/actions/secrets") ? jsonRes(SECRETS_LIST) : new Response("nope", { status: 404 })
  )).body).cloudflare.requests_today > uc.cloudflare.requests_today);
// --- github actions: visibility is CHECKED, never asserted as fact ---
const REPO_URL = "https://api.github.com/repos/o/r";
check("with no repo answer, public_repo is null with a source, not a confident true",
  uc.github_actions.public_repo === null && uc.github_actions.minutes_limit === null &&
  /not checked/.test(uc.github_actions.source));
check("the null case's note makes no claim about Actions minutes",
  uc.notes.some(n => /no claim is made about GitHub Actions minutes/.test(n)) &&
  !uc.notes.some(n => /unlimited because/.test(n)));
const uPub = await usageReq(STUDIO_ENV, async (u) => {
  if (u === REPO_URL) return jsonRes({ private: false, visibility: "public" });
  if (u.includes("/actions/secrets")) return jsonRes(SECRETS_LIST);
  return new Response("nope", { status: 404 });
});
const up = JSON.parse(uPub.body);
check("public_repo is true only after github confirmed it, and then minutes are unlimited",
  up.github_actions.public_repo === true && up.github_actions.minutes_limit === "unlimited" &&
  /github api/.test(up.github_actions.source));
check("the unlimited-minutes note appears only alongside the verified check",
  up.notes.some(n => /unlimited because the bots repo is public/.test(n)));
const uPriv = await usageReq(STUDIO_ENV, async (u) => {
  if (u === REPO_URL) return jsonRes({ private: true, visibility: "private" });
  if (u.includes("/actions/secrets")) return jsonRes(SECRETS_LIST);
  return new Response("nope", { status: 404 });
});
check("a private repo is reported as NOT unlimited, never papered over",
  JSON.parse(uPriv.body).github_actions.public_repo === false &&
  JSON.parse(uPriv.body).github_actions.minutes_limit === null &&
  JSON.parse(uPriv.body).notes.some(n => /NOT unlimited/.test(n)));
check("repoVisibility asks nobody without a token, and says why",
  await withFetch(async () => { throw new Error("must not be called"); },
    async () => (await repoVisibility({})).public_repo) === null &&
  /GITHUB_TOKEN/.test((await withFetch(async () => { throw new Error("no"); },
    async () => await repoVisibility({}))).source));
check("the notes are plain lines the UI can show as-is",
  uc.notes.length >= 3 && uc.notes.every(n => typeof n === "string" && n.length > 10));
check("no note and no source carries an em dash or an exclamation mark",
  !uc.notes.concat([uc.cloudflare.source, uc.ai.source]).some(s => s.includes(EMDASH2) || s.includes("!")));
check("the whole usage body is ASCII",
  !/[^\x00-\x7F]/.test(uCount.body));

// --- the AI half: the key lives on GitHub, so the honest answer is null with a reason ---
check("usage names the configured provider from the stored secret NAMES",
  uc.ai.provider === "deepseek");
check("balance is null because Actions secret values cannot be read back, and says exactly that",
  uc.ai.balance === null && uc.ai.currency === "" &&
  /cannot be read back/.test(uc.ai.source) && /GitHub Actions secret/i.test(uc.ai.source));
const uNoKeys = await usageReq(STUDIO_ENV, async (u) =>
  u.includes("/actions/secrets") ? jsonRes({ total_count: 0, secrets: [] }) : new Response("nope", { status: 404 }));
check("with no provider key stored, provider is empty and the source says so",
  JSON.parse(uNoKeys.body).ai.provider === "" &&
  /no AI provider key is stored/.test(JSON.parse(uNoKeys.body).ai.source));
const uNoGh = await usageReq(ENV, async () => new Response("nope", { status: 404 }));
check("with no GITHUB_TOKEN the ai block is honest rather than blank",
  JSON.parse(uNoGh.body).ai.provider === "" && JSON.parse(uNoGh.body).ai.balance === null &&
  /GITHUB_TOKEN/.test(JSON.parse(uNoGh.body).ai.source));
const uGhDown = await usageReq(STUDIO_ENV, async () => new Response("nope", { status: 500 }));
check("an unreadable secret list is reported as unknown, not as no keys",
  /did not return/.test(JSON.parse(uGhDown.body).ai.source));

// --- a live balance, only when the key is ALSO a worker secret ---
const DS_KEY = "sk-deepseek-live-key-value";
const uLive = await usageReq(Object.assign({ DEEPSEEK_API_KEY: DS_KEY }, STUDIO_ENV), async (u) => {
  if (u.includes("/actions/secrets")) return jsonRes(SECRETS_LIST);
  if (u === "https://api.deepseek.com/user/balance") return jsonRes({ is_available: true,
    balance_infos: [{ currency: "USD", total_balance: "12.34", granted_balance: "0.00", topped_up_balance: "12.34" }] });
  return new Response("nope", { status: 404 });
});
const ul = JSON.parse(uLive.body);
check("with the key on the worker too, the real balance is fetched and reported",
  ul.ai.provider === "deepseek" && ul.ai.balance === 12.34 && ul.ai.currency === "USD" &&
  /read live/.test(ul.ai.source));
check("the live balance path never echoes the API key back", !uLive.body.includes(DS_KEY));
check("the balance request sends the key as a bearer header, never in the URL",
  uLive.seen.some(s => s.url === "https://api.deepseek.com/user/balance" &&
    ((s.init || {}).headers || {}).Authorization === "Bearer " + DS_KEY) &&
  !uLive.seen.some(s => s.url.includes(DS_KEY)));
const uOr = await usageReq(Object.assign({ OPENROUTER_API_KEY: "sk-or-live" }, STUDIO_ENV), async (u) => {
  if (u.includes("/actions/secrets")) return jsonRes({ total_count: 1, secrets: [{ name: "OPENROUTER_API_KEY" }] });
  if (u.includes("openrouter.ai/api/v1/credits")) return new Response("forbidden", { status: 403 });
  return new Response("nope", { status: 404 });
});
check("an openrouter 403 is reported as the management-key limitation it is, not as zero",
  JSON.parse(uOr.body).ai.balance === null && /403/.test(JSON.parse(uOr.body).ai.source) &&
  /management key/.test(JSON.parse(uOr.body).ai.source));
const uNoBal = await usageReq(Object.assign({ GROQ_API_KEY: "gsk-live" }, STUDIO_ENV), async (u) => {
  if (u.includes("/actions/secrets")) return jsonRes({ total_count: 1, secrets: [{ name: "GROQ_API_KEY" }] });
  return new Response("nope", { status: 404 });
});
check("a provider with no balance endpoint reports null and says why",
  JSON.parse(uNoBal.body).ai.provider === "groq" && JSON.parse(uNoBal.body).ai.balance === null &&
  /no balance endpoint/.test(JSON.parse(uNoBal.body).ai.source));
check("no balance lookup fires for a provider that has no balance endpoint",
  !uNoBal.seen.some(s => /balance|credits/.test(s.url)));

// --- parseBalance is pure, total, and never invents a number ---
check("parseBalance reads deepseek's string amount as a number",
  parseBalance("deepseek", { balance_infos: [{ currency: "CNY", total_balance: "5.5" }] }).balance === 5.5);
check("parseBalance computes openrouter's remaining credit",
  parseBalance("openrouter", { data: { total_credits: 100.5, total_usage: 25.75 } }).balance === 74.75);
check("parseBalance returns null on junk instead of zero",
  parseBalance("deepseek", null) === null && parseBalance("deepseek", {}) === null &&
  parseBalance("deepseek", { balance_infos: [] }) === null &&
  parseBalance("deepseek", { balance_infos: [{ total_balance: "abc" }] }) === null &&
  parseBalance("openrouter", { data: {} }) === null && parseBalance("groq", { balance: 5 }) === null);
check("parseBalance only ever emits a number and a short currency code",
  /^[A-Z]{0,8}$/.test(parseBalance("deepseek",
    { balance_infos: [{ currency: "<script>", total_balance: "1" }] }).currency) === true);

// --- the cloudflare analytics path: the real total, or null, never a stand-in ---
resetUsageCounter();
const uReal = await usageReq(AI_ENV, async (u) => {
  if (u.includes("/actions/secrets")) return jsonRes(SECRETS_LIST);
  if (u === "https://api.cloudflare.com/client/v4/graphql") return jsonRes({ data: { viewer: { accounts: [
    { workersInvocationsAdaptive: [{ sum: { requests: 4000 } }, { sum: { requests: 812 } }] }] } } });
  return new Response("nope", { status: 404 });
});
const ur = JSON.parse(uReal.body);
check("with an analytics token the real account total is reported and labelled",
  ur.cloudflare.requests_today === 4812 && ur.cloudflare.source === "cloudflare analytics");
check("the analytics note tells the owner the count is account-wide",
  ur.notes.some(n => /account-wide/.test(n)));
const gql = uReal.seen.find(s => s.url === "https://api.cloudflare.com/client/v4/graphql") || { init: {} };
check("the analytics query is a POST with the token as a bearer header",
  (gql.init || {}).method === "POST" && ((gql.init || {}).headers || {}).Authorization === "Bearer " + CF_TOKEN);
check("the analytics token never appears in the URL or the response body",
  !uReal.seen.some(s => s.url.includes(CF_TOKEN)) && !uReal.body.includes(CF_TOKEN));
check("the query asks the workersInvocationsAdaptive dataset for today only",
  /workersInvocationsAdaptive/.test(String((gql.init || {}).body || "")) &&
  /datetime_geq/.test(String((gql.init || {}).body || "")) &&
  JSON.parse(String((gql.init || {}).body)).variables.since === startOfUtcDay(Date.now()));
// Cloudflare's schema declares these as lowercase `string`, datetimes included. Getting
// it wrong returns HTTP 200 with an `errors` array, so the route would have looked
// configured while silently never producing a real number.
check("the GraphQL variables are declared with Cloudflare's own lowercase string types",
  /\$a: string/.test(String((gql.init || {}).body || "")) &&
  /\$since: string/.test(String((gql.init || {}).body || "")) &&
  /\$until: string/.test(String((gql.init || {}).body || "")) &&
  !/: Time/.test(String((gql.init || {}).body || "")));
check("the query filters on the configured script name, not every worker on the account",
  JSON.parse(String((gql.init || {}).body)).variables.s === "iboyprime-commands" &&
  JSON.parse(String((gql.init || {}).body)).variables.a === "acc123");
check("startOfUtcDay is midnight UTC of the given day",
  startOfUtcDay(Date.UTC(2026, 7, 13, 17, 45, 3)) === "2026-08-13T00:00:00.000Z");
// A GraphQL error arrives with HTTP 200, so a shape check is the only real check.
const uGqlErr = await usageReq(AI_ENV, async (u) => {
  if (u.includes("/actions/secrets")) return jsonRes(SECRETS_LIST);
  if (u === "https://api.cloudflare.com/client/v4/graphql")
    return jsonRes({ errors: [{ message: "authentication error" }], data: null });
  return new Response("nope", { status: 404 });
});
const ug = JSON.parse(uGqlErr.body);
check("a GraphQL error (which arrives as HTTP 200) falls back rather than reporting null data as zero",
  ug.cloudflare.source !== "cloudflare analytics" &&
  /counted in this worker instance/.test(ug.cloudflare.source) &&
  ug.cloudflare.requests_today !== 0);
check("the fallback admits the analytics query did not answer",
  /did not return a total/.test(ug.cloudflare.source));
check("a failed analytics call surfaces the status, never the token",
  !uGqlErr.body.includes(CF_TOKEN));
check("cloudflareRequestsToday is null with no token, and asks nobody",
  (await withFetch(async () => { throw new Error("must not be called"); },
    async () => (await cloudflareRequestsToday({}, Date.now())).count)) === null);
check("an empty analytics result is null, not a confident zero",
  (await withFetch(async () => jsonRes({ data: { viewer: { accounts: [] } } }),
    async () => await cloudflareRequestsToday({ CLOUDFLARE_ANALYTICS_TOKEN: "t",
      CLOUDFLARE_ACCOUNT_ID: "a" }, Date.now()))).count === null);

// --- the leak sweep: no secret this worker holds may appear anywhere in the answer ---
const LEAKY = await usageReq(Object.assign({ DEEPSEEK_API_KEY: DS_KEY }, AI_ENV), async (u) => {
  if (u.includes("/actions/secrets")) return jsonRes(SECRETS_LIST);
  if (u === "https://api.cloudflare.com/client/v4/graphql") return jsonRes({ data: { viewer: { accounts: [
    { workersInvocationsAdaptive: [{ sum: { requests: 7 } }] }] } } });
  if (u === "https://api.deepseek.com/user/balance")
    return jsonRes({ balance_infos: [{ currency: "USD", total_balance: "1.00" }] });
  return new Response("nope", { status: 404 });
});
for (const secret of [DS_KEY, CF_TOKEN, "gh_secret_token", "BOT.TOKEN.secret", PW, SIGNK])
  check(`usage never leaks ${secret.slice(0, 12)} into the response`, !LEAKY.body.includes(secret));
check("usage reports a value for every contract field, so the UI never renders undefined",
  ["plan", "requests_per_day_limit", "cpu_ms_per_request_limit", "requests_today", "source"]
    .every(k => JSON.parse(LEAKY.body).cloudflare[k] !== undefined) &&
  ["provider", "balance", "currency", "source"].every(k => JSON.parse(LEAKY.body).ai[k] !== undefined) &&
  ["public_repo", "minutes_limit", "source"].every(k => JSON.parse(LEAKY.body).github_actions[k] !== undefined) &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(JSON.parse(LEAKY.body).generated_at));

// --- the five-minute payload cache: one assembly per isolate, honestly labelled ---
// Every other read on this surface caches (bots_config, welcomeconfig, polls, plates);
// uncached, this route made up to four outbound calls per authenticated hit.
resetUsageCache();
const cacheSeen = [];
const cachePair = await withFetch(async (u) => {
  cacheSeen.push(u);
  if (u === REPO_URL) return jsonRes({ private: false });
  if (u.includes("/actions/secrets")) return jsonRes(SECRETS_LIST);
  return new Response("nope", { status: 404 });
}, async () => {
  const a = await worker.fetch(cookieReq("/studio/api/usage", SID), STUDIO_ENV, {});
  const aBody = await a.text(), aCalls = cacheSeen.length;
  const b = await worker.fetch(cookieReq("/studio/api/usage", SID), STUDIO_ENV, {});
  return { aBody, aCalls, bBody: await b.text(), bCalls: cacheSeen.length };
});
check("a second usage read within five minutes makes ZERO outbound calls",
  cachePair.aCalls > 0 && cachePair.bCalls === cachePair.aCalls);
check("the cached serve is the same payload byte for byte",
  cachePair.bBody === cachePair.aBody && cachePair.aBody.length > 0);
check("the payload admits its own staleness window",
  JSON.parse(cachePair.aBody).notes.some(n => /up to five minutes old/.test(n)));
resetUsageCache();
const freshAgain = await withFetch(async (u) => {
  cacheSeen.push(u);
  if (u.includes("/actions/secrets")) return jsonRes(SECRETS_LIST);
  return new Response("nope", { status: 404 });
}, async () => (await worker.fetch(cookieReq("/studio/api/usage", SID), STUDIO_ENV, {})).status);
check("resetUsageCache forces a fresh assembly (and resetStudioCaches clears it too)",
  freshAgain === 200 && cacheSeen.length > cachePair.bCalls &&
  /resetUsageCache\(\);/.test(code.slice(code.indexOf("function resetStudioCaches"),
                                         code.indexOf("function resetStudioCaches") + 400)));
check("the usage route never console-logs (worker logs are readable by anyone with the account)",
  !/console\.(log|error|warn|info)/.test(code));

// ----- capability facts -----
const limits = await worker.fetch(cookieReq("/studio/api/limits", SID), ENV, {});
const limitsBody = JSON.parse(await limits.text());
check("limits says the YouTube API cannot do community posts",
  limits.status === 200 && limitsBody.youtube_api_supports_community_posts === false);
check("limits explains why, so the page never implies a capability that does not exist",
  typeof limitsBody.note === "string" && limitsBody.note.length > 40 &&
  /youtube studio/i.test(limitsBody.note));
check("limits is the single source of truth in source too",
  STUDIO_LIMITS.youtube_api_supports_community_posts === false &&
  (code.match(/youtube_api_supports_community_posts/g) || []).length === 1);

// ----- the interaction endpoint is untouched -----
const rootRes = await worker.fetch(new Request("https://w.test/"), {}, {});
const OLD_LINE = "Slash commands " + EMDASH2 + " online.";
check("GET / still returns the old plain-text line",
  rootRes.status === 200 && (await rootRes.text()) === OLD_LINE);
const otherRes = await worker.fetch(new Request("https://w.test/anything-else"), {}, {});
check("GET on any other path keeps the old plain-text line",
  (await otherRes.text()) === OLD_LINE);
const unsignedPost = await worker.fetch(
  new Request("https://w.test/", { method: "POST", body: "{}" }), { DISCORD_PUBLIC_KEY: "ab" }, {});
check("a POST without a valid signature still returns 401", unsignedPost.status === 401);
check("a POST without a valid signature says so and runs nothing",
  (await unsignedPost.text()) === "bad signature");
// The studio router answers and RETURNS before verify() is ever reached, so no /studio
// path can be used as a second door into the command handlers.
const studioPing = await worker.fetch(new Request("https://w.test/studio", { method: "POST",
  headers: { "content-type": "application/json" }, body: JSON.stringify({ type: 1 }) }),
  Object.assign({ DISCORD_PUBLIC_KEY: "ab" }, ENV), {});
const studioPingBody = await studioPing.text();
check("POST /studio never reaches the interaction handler (no PONG, no command)",
  studioPing.status === 401 && !studioPingBody.includes('"type":1') && studioPingBody.includes("unauthorized"));
check("POST /studio with the studio unconfigured is closed, not a signature check",
  (await worker.fetch(new Request("https://w.test/studio", { method: "POST", body: "{}" }), NOENV, {})).status === 503);
check("the studio router returns before the signature check in source",
  code.indexOf("return await studioRouter(request, env, url)") <
  code.indexOf("if (!await verify(request, body, env.DISCORD_PUBLIC_KEY))"));

// A real signed round trip. The dispatcher stopped using COMMANDS[name] (a bare lookup
// answers for "constructor" with the Object function and "toString" with a function too,
// either of which would have been "dispatched"), so prove the real path still routes.
const kp = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
const pubHex = [...new Uint8Array(await crypto.subtle.exportKey("raw", kp.publicKey))]
  .map(b => b.toString(16).padStart(2, "0")).join("");
async function signedPost(payload) {
  const body = JSON.stringify(payload);
  const ts = String(Math.floor(Date.now() / 1000));
  const sig = new Uint8Array(await crypto.subtle.sign({ name: "Ed25519" }, kp.privateKey,
    new TextEncoder().encode(ts + body)));
  return await worker.fetch(new Request("https://w.test/", { method: "POST", body,
    headers: { "x-signature-ed25519": [...sig].map(b => b.toString(16).padStart(2, "0")).join(""),
               "x-signature-timestamp": ts, "content-type": "application/json" } }),
    { DISCORD_PUBLIC_KEY: pubHex }, { waitUntil() {} });
}
const pong = await signedPost({ type: 1 });
check("a correctly signed PING still gets a PONG", JSON.parse(await pong.text()).type === 1);
const flip = await signedPost({ type: 2, data: { name: "flip", options: [] }, member: { user: { id: "U1" }, roles: [] } });
const flipBody = JSON.parse(await flip.text());
check("a correctly signed command still dispatches and answers",
  flipBody.type === 4 && /Heads|Tails/.test(flipBody.data.content));
for (const name of ["constructor", "toString", "__proto__", "valueOf", "nope"]) {
  const r = JSON.parse(await (await signedPost({ type: 2, data: { name, options: [] },
    member: { user: { id: "U1" }, roles: [] } })).text());
  check(`a command named ${JSON.stringify(name)} is unknown, not a prototype member`,
    r.type === 4 && r.data.content === "Unknown command.");
}
const ctxUnknown = JSON.parse(await (await signedPost({ type: 2,
  data: { type: 2, name: "constructor", target_id: "1", options: [] },
  member: { user: { id: "U1" }, roles: [] } })).text());
check("the same holds for the context-menu table",
  ctxUnknown.data.content === "Unknown command.");
const badSig = await worker.fetch(new Request("https://w.test/", { method: "POST",
  body: JSON.stringify({ type: 1 }),
  headers: { "x-signature-ed25519": "00".repeat(64), "x-signature-timestamp": "1" } }),
  { DISCORD_PUBLIC_KEY: pubHex }, { waitUntil() {} });
check("a wrong signature over a valid body is still 401", badSig.status === 401);

// ----- source-level guarantees -----
check("the editor page is imported, never inlined here",
  /import \{ STUDIO_HTML \} from "\.\/studio_page\.js"/.test(workerSrc) &&
  !/const STUDIO_HTML = /.test(code));
check("the cookie scheme is documented in source",
  /WHAT THIS COOKIE SCHEME DOES, AND WHAT IT DOES NOT DO/.test(workerSrc));
// The deploy config used to describe a PBKDF2-derived cookie key long after the code
// stopped doing that. Documentation that describes a design the code deliberately
// abandoned is how a fixed bug gets reintroduced by the next person reading it.
// wrangler.toml is deliberately NEVER uploaded to the public repo (it names the
// account and worker wiring), so in the CI checkout these doc checks SKIP - an
// unguarded read crashed the whole dispatched selftest run (Aug 13 2026).
let wrangler = null;
try { wrangler = readFileSync(fileURLToPath(new URL("./wrangler.toml", import.meta.url)), "utf8"); }
catch (e) { console.log("  SKIP: wrangler.toml not in this checkout (local-only file)"); }
if (wrangler !== null) {
  check("wrangler.toml no longer claims the cookie key is derived from the password",
    !/PBKDF2-HMAC-SHA256, 200k iterations/.test(wrangler) &&
    !/signed with a key DERIVED from it/.test(wrangler));
  check("wrangler.toml documents the separate signing key as required",
    /STUDIO_SIGNING_KEY/.test(wrangler) && /SEPARATE random secret/.test(wrangler));
  check("wrangler.toml warns the next reader off reintroducing PBKDF2",
    /Do NOT reintroduce PBKDF2/.test(wrangler) && /1102/.test(wrangler));
  check("wrangler.toml documents the optional analytics secrets the usage route reads",
    /CLOUDFLARE_ANALYTICS_TOKEN/.test(wrangler) && /CLOUDFLARE_ACCOUNT_ID/.test(wrangler));
  check("wrangler.toml holds no secret VALUE, only names",
    !/^\s*(STUDIO_PASSWORD|STUDIO_SIGNING_KEY|GITHUB_TOKEN|DISCORD_BOT_TOKEN|CLOUDFLARE_ANALYTICS_TOKEN)\s*=/m.test(wrangler));
  check("the analytics script name matches the deployed worker name",
    /WORKER_NAME\s*=\s*"iboyprime-commands"/.test(wrangler) && /^name = "iboyprime-commands"/m.test(wrangler));
}
check("worker source is ASCII only (non-ASCII bytes travel badly through this toolchain)",
  !/[^\x00-\x7F]/.test(workerSrc) && (wrangler === null || !/[^\x00-\x7F]/.test(wrangler)));
check("no studio response is ever built out of an env value",
  !/studioJson\(env/.test(code) && !/studioText\(env/.test(code) && !/studioHtml\(env/.test(code) &&
  !/JSON\.stringify\(env/.test(code));
check("STUDIO_PASSWORD never appears in anything the worker sends back",
  !LOGIN_HTML.includes("STUDIO_PASSWORD") && !STUDIO_HTML.includes("STUDIO_PASSWORD") &&
  !JSON.stringify(STUDIO_LIMITS).includes("STUDIO_PASSWORD"));
check("the password only ever reaches the SHA-256 compare, a presence check or the weak-length check",
  (code.match(/env\.STUDIO_PASSWORD/g) || []).length <= 4 &&
  !/hmacB64url\(env\.STUDIO_PASSWORD/.test(code) &&
  !/ctEq\(supplied, env\.STUDIO_PASSWORD\)/.test(code) &&
  !/JSON\.stringify\([^)]*STUDIO_PASSWORD/.test(code));


// ===== studio page harness =====================================================
// The studio page had ZERO test coverage: worker.test.js only ever checked the
// auth gate and the JSON contracts, so every DOM, canvas and regex bug in a
// 4900-line file shipped unexamined. These checks are cheap and catch the two
// failure classes this file has actually produced.
const _spSrc = readFileSync(fileURLToPath(new URL("./studio_page.js", import.meta.url)), "utf8");
const _spScript = (STUDIO_HTML.match(/<script>([\s\S]*)<\/script>/) || [])[1] || "";

check("the page carries an inline script", _spScript.length > 10000);

// 1. THE BACKSLASH TRAP. studio_page.js is one big template literal, so every
//    backslash meant for the PAGE must be doubled in the source. A single \d
//    silently becomes a literal "d" and the regex matches nothing - no error, no
//    warning, just a feature that quietly stops working. This shipped twice.
check("the page's inline script actually parses", (() => {
  try { new Function(_spScript); return true; } catch (e) { return false; }
})());

const _lone = [];
const _loneRe = /(^|[^\\])\\([dswbDSWB])/g;
let _lm;
while ((_lm = _loneRe.exec(_spSrc)) !== null) {
  _lone.push(_spSrc.slice(Math.max(0, _lm.index - 40), _lm.index + 40));
}
check("no single-backslash regex class survives in the template literal "
  + "(a lone " + String.fromCharCode(92) + "d becomes a literal d on the page)",
  _lone.length === 0);

// 2. (There was a per-literal regex compile check here. It is redundant -
//     JavaScript parses regex literals at PARSE time, so an invalid one
//     already fails the new Function() check above - and a naive extractor
//     cannot tell a regex literal from a division, so it reported false
//     failures on ordinary arithmetic.)
// 3. The deep link is how the owner opens a staged post from Discord. Both places
//    that read it must use the SAME pattern - one of them lost its backslashes.
const _hashRes = _spScript.match(/\[#&\]s=\([^)]{1,14}\)/g) || [];
check("every deep-link hash regex on the page is identical and matches a snowflake",
  _hashRes.length >= 2 && _hashRes.every(r => r === _hashRes[0])
  && new RegExp(_hashRes[0]).test("#s=1544916839560257617"));

// 4. Duplicate element ids silently break $() lookups.
const _ids = (STUDIO_HTML.match(/\sid="([A-Za-z0-9_-]+)"/g) || []).map(s => s.split('"')[1]);
const _dupIds = _ids.filter((v, i) => _ids.indexOf(v) !== i);
check(`no duplicate element ids in the page (${_ids.length} ids)`, _dupIds.length === 0);

// 5. THUMBNAIL LOADING. A cold rail used to fire up to 25 simultaneous proxy
//    requests, each triggering a live Discord call, with no retry and no
//    placeholder - so a rate-limited tile stayed blank for ever and the owner
//    concluded the app was broken.
check("thumbnails are fetched through a bounded queue, not all at once",
  /IMG_MAX_INFLIGHT\s*=\s*[1-5]\b/.test(_spScript) && /imgInflight/.test(_spScript));
check("thumbnails load lazily, only for tiles on screen",
  /IntersectionObserver/.test(_spScript) && /railObserver/.test(_spScript));
check("a throttled thumbnail is retried with a backoff that honours Retry-After",
  /retry-after/i.test(_spScript) && /loadThumb\(job, attempt \+ 1\)/.test(_spScript));
check("a tile that is still loading looks different from one that failed "
  + "(they used to be the same flat black rectangle)",
  /ph\.loading/.test(STUDIO_HTML) && /ph\.failed/.test(STUDIO_HTML)
  && /preview unavailable/.test(STUDIO_HTML));
check("renderRail reconciles by id instead of wiping innerHTML "
  + "(the wipe aborted every download still in flight, on every pick)",
  /dataset\.sid/.test(_spScript)
  && !/function renderRail\(items\) \{\s*var rail = \$\("rail"\);\s*rail\.innerHTML = "";/.test(_spScript));
check("a hashchange opens an already-loaded post instead of refetching the rail",
  /hashchange[\s\S]{0,400}pickStaged\(staged\[i\]\)/.test(_spScript));

// 6. Server side: a 429 is a "come back", not a "gone".
check("the image proxy answers 503 + Retry-After on a Discord 429, never 404 "
  + "(a 404 is never retried, so the tile stayed blank until a manual refresh)",
  /r\.status === 429/.test(workerSrc) && /"rate limited, retry" \}, 503/.test(workerSrc));
check("the proxy's message cache evicts the OLDEST entry, not an arbitrary one",
  /oldT = Infinity/.test(workerSrc));


// ===== renderer colour parity (JS studio  <->  python postcard) ===============
// The owner reported "the font color is different for the post I get on Discord
// than the one I get on the app". It was: the studio painted #A45CFF, which
// postcard.py records BY NAME as one of three swatches he REJECTED ("too
// magenta") before picking #6A49EC off a rendered sheet.
//
// The values below are pinned against bots_github/postcard.py by the Python
// suite (selftest_changes.py, [renderer parity]); this side pins that the page
// actually carries them and computes the derived ones the same way. Same shape
// as the SOCIALS_FALLBACK <-> welcomeconfig.DEFAULT_LINKS pin, which is the
// precedent for catching exactly this class of drift.
const _pcw = (() => {
  const grab = (name) => {
    const i = _spScript.indexOf("function " + name + "(");
    if (i === -1) return "";
    let depth = 0, started = false;
    for (let j = i; j < _spScript.length; j++) {
      const c = _spScript[j];
      if (c === "{") { depth++; started = true; }
      else if (c === "}") { depth--; if (started && depth === 0) return _spScript.slice(i, j + 1); }
    }
    return "";
  };
  const src = [grab("clamp"), grab("rgb3"), grab("mixHex")].join("\n")
    + "\n" + (_spScript.match(/var PAL = \{[\s\S]*?\};/) || [""])[0]
    + "\n" + (_spScript.match(/var CW = \[[\s\S]*?\];/) || [""])[0]
    + "\nreturn { mixHex: mixHex, CW: CW, PAL: PAL };";
  try { return new Function(src)(); } catch (e) { return null; }
})();

check("the studio's colour helpers are extractable and run", !!_pcw && !!_pcw.mixHex);

if (_pcw) {
  const purple = _pcw.CW.find(c => c.id === "purple");
  check("the hot-word glyph is the owner's chosen #6A49EC, not the rejected #A45CFF",
    purple.glyph === "#6A49EC" && _pcw.PAL.hot === "#6A49EC");
  check("no rejected swatch survives anywhere on the page "
    + "(#A45CFF was 'too magenta', #D2ADFF 'too pale', #8A6FFA 'too light')",
    !/A45CFF/i.test(STUDIO_HTML) && !/D2ADFF/i.test(STUDIO_HTML) && !/8A6FFA/i.test(STUDIO_HTML));
  check("every colorway carries a glyph, like postcard.COLORWAYS",
    _pcw.CW.length === 5 && _pcw.CW.every(c => typeof c.glyph === "string" && /^#[0-9A-F]{6}$/i.test(c.glyph)));
  // Derived values, computed the same way on both sides.
  // Within one level per channel, not byte-equal: python's round() is banker's
  // rounding and JavaScript's Math.round is half-up, so a blend landing on an
  // exact .5 differs by 1/255 (here #DBD3F8 vs #DAD3F8). That is invisible, and
  // forcing either side to match would mean changing a mix helper every gradient
  // on the poster depends on. What matters is that the wash LIFTS the hot word
  // to near-paper instead of leaving it on its own hue's field, which is what
  // the round-4 blind test rejected.
  const _near = (a, b) => {
    const A = a.replace("#", "").match(/../g).map(h => parseInt(h, 16));
    const B = b.replace("#", "").match(/../g).map(h => parseInt(h, 16));
    return A.every((v, i) => Math.abs(v - B[i]) <= 1);
  };
  check("a photoless wash lifts hot words to near-paper #DAD3F8, as python does "
    + "(a colorway accent on its own hue's field vanished in the round-4 blind)",
    _near(_pcw.mixHex(purple.hot, _pcw.PAL.paper, 0.75), "#DAD3F8"));
  check("the solo bar over a wash is #C5B9FA, as python computes it",
    _near(_pcw.mixHex(purple.hot, _pcw.PAL.paper, 0.55), "#C5B9FA"));
}

check("the news family picks its hot colour by ROLE (photo vs wash), not one constant",
  /function newsHotHex\(hasPhoto\)/.test(_spScript)
  && /newsHotHex\(!!ph\)/.test(_spScript));
check("only the BRAND entry is derived - the owner's red/orange/blue/green/white "
  + "picks are returned untouched",
  /if \(state\.hlColor !== "purple"\) return hlHex\(\);/.test(_spScript));
check("an all-hot line flips to white words plus ONE bar, as python does "
  + "(when everything is highlighted, nothing is)",
  /function soloBarHex/.test(_spScript) && /!allHot && !!state\.hot\[keys\[i\]\]/.test(_spScript));
check("lineMaxSolo matches python's 300 (its own comment records 240 as rejected, "
  + "'half the reference's scale')",
  /lineMaxSolo: 300\b/.test(_spScript));


// ===== studio: textures and layer selection ===================================
// Both of these were reported as "it doesn't work" and both were real.

// TEXTURES. A cut-out subject was dropped into the plain photo slot, which takes
// the full-bleed branch and never calls washField - so the scene the Discord
// card clearly shows was simply covered up in the app.
check("a cut-out is remembered as a cut-out, not as a photograph",
  /state\.photo\.kind = \(p\.photoKind === "cutout"\)/.test(_spScript)
  && /kind: "photo"/.test(_spScript));
check("a cut-out draws the wash FIRST and stands the subject on it, "
  + "the postcard order",
  /state\.photo\.kind === "cutout"[\s\S]{0,200}washField\([\s\S]{0,120}drawCutout\(/.test(_spScript));
check("the cut-out painter contains the subject instead of cropping it, "
  + "and adds no rim light (the blind rounds called that a sticker halo)",
  /function drawCutout/.test(_spScript)
  && /Math\.min\(boxW \/ iw, boxH \/ ih\)/.test(_spScript)
  && !/rimLight|shadowColor: *PAL\.rim/.test(_spScript.match(/function drawCutout[\s\S]*?\n}/)[0]));
check("a photo the owner drops himself resets the slot to a photograph",
  /if \(slot === "photo"\) state\.photo\.kind = "photo";/.test(_spScript));
check("the pair templates paint the wash, so the texture chips are no longer "
  + "inert on Quote-2-shots, Stat, Versus and Then-and-now",
  /function pairBackground\(ctx\) \{\s*washField\(/.test(_spScript)
  && !/layout\.photo = layout\.left;\s*ctx\.fillStyle = PAL\.ink; ctx\.fillRect\(0, 0, W, H\);/.test(_spScript));
check("the background note is always visible and says what it actually does",
  /bn\.hidden = false;/.test(_spScript) && /stand in front of it/.test(_spScript));

// LAYER SELECTION. pickLayer defaulted to "photo" and every pointerdown
// overwrote the toolbar chip, with a text target about 10 real pixels wide.
check("a drag moves the ACTIVE layer instead of re-selecting on every press",
  /var pick = layerExists\(layer\) \? layer : pickLayer\(p\);/.test(_spScript)
  && !/var pick = pickLayer\(p\);\s*setLayer\(pick\);/.test(_spScript));
check("a TAP (no movement) is what changes the selection",
  /if \(!dragging\.moved\) \{[\s\S]{0,400}setLayer\(tapPick\)/.test(_spScript));
check("the hit pad is derived from a real screen distance, not a flat canvas number "
  + "(26 canvas px was about 10 real px on the phone)",
  /function hitPad\(screenPx\)/.test(_spScript)
  && /W \/ r\.width/.test(_spScript.match(/function hitPad[\s\S]*?\n}/)[0])
  && !/inside\(layout\.text, p, 26\)/.test(_spScript));
check("an empty line still has a grabbable box (it used to collapse to 2px)",
  /Math\.max\(240, W \* 0\.35\)/.test(_spScript)
  && !/return \{ x: cx - 1, y: top, w: 2, h: Math\.max\(1, lh\) \};/.test(_spScript));
check("a layer that the current template does not have is never made active",
  /function layerExists\(k\)/.test(_spScript));
check("the smaller target wins the hit test (the inset sits ON the photo, "
  + "which is the whole canvas)",
  /d\.inset && inside\(layout\.inset, p, hitPad\(14\)\)/.test(_spScript));


// ===== studio: the 1-2-3-4 workflow ===========================================
// The owner: "why don't you make it like a proper workflow where I could go from
// one two three four... there's so much wasted space". Measured before: the
// panel was thirteen cards in creation order, about 2300px tall; the staged
// queue he needs FIRST started about 2400px down, after the closing .split, and
// the caption about 2200px down. Measured after, at 1440x900: queue at 217px,
// caption at 201px, document 2987px -> 1165px, poster 416px -> 488px wide, and
// the empty gutter beside the poster 412px -> 2px.
check("the page declares four named steps",
  /\{ n: 1, label: "Pick" \}/.test(_spScript) && /\{ n: 4, label: "Export" \}/.test(_spScript));
check("every panel card is assigned to a step",
  (STUDIO_HTML.match(/<div class="card" data-step="\d"/g) || []).length >= 13);
check("the staged queue moved INTO the panel as step 1, and no longer sits after "
  + "the closing .split where it started 2400px down",
  /<div class="card" data-step="1">[\s\S]{0,220}Staged by the bot/.test(STUDIO_HTML));
check("the caption and drafts are step 4, not the last cards of a 2300px column",
  /<div class="card" data-step="4">[\s\S]{0,120}Caption/.test(STUDIO_HTML)
  && /<div class="card" data-step="4">[\s\S]{0,200}Drafts/.test(STUDIO_HTML));

// Visibility is expressed as display:none on the INACTIVE cards and never
// display:block on the active ones: several cards carry [hidden] from the
// template logic, and an author display:block would beat the UA [hidden] rule
// and un-hide Matchup, Stat and Panels on templates that do not have them.
check("[hidden] still wins inside a step (Matchup/Stat/Panels stay hidden)",
  /html\[data-shell=steps\] \.panel > \.card\[data-step\]\[hidden\]\{display:none\}/.test(STUDIO_HTML));

// The escape hatch ships WITH the redesign, not after it.
check("?shell=classic and a Settings toggle restore the old single page",
  /shell=classic/.test(_spScript) && /id="shellToggle"/.test(STUDIO_HTML)
  && /html\[data-shell=classic\] \.steps\{display:none\}/.test(STUDIO_HTML));
check("the shell choice survives a reload, and a private window cannot break boot",
  /localStorage\.setItem\("studio\.shell"/.test(_spScript)
  && /try \{[^}]*localStorage\.getItem\("studio\.shell"\)/.test(_spScript.replace(/\n/g, " ")));

// This one shipped broken for a few minutes and is exactly the class of bug the
// harness exists for: setStep referenced `fit`, a var local to the toolbar
// wiring, so it threw a ReferenceError that aborted the boot BEFORE applyShell
// ran. data-shell was never set, every step rule was inert, and the page looked
// completely unchanged while the step bar sat on top of it working perfectly.
check("no layout helper references a non-global fit()",
  !/requestAnimationFrame\(fit\)/.test(_spScript));
check("the layout nudge cannot abort the boot sequence",
  /function relayout\(\)[\s\S]{0,320}catch \(e\)/.test(_spScript));

// Space.
check("the poster grows into the gutter the panel used to need",
  /html\[data-shell=steps\] \.canvas-wrap\{max-width:min\(600px/.test(STUDIO_HTML));
check("the stage column is capped to the poster so 'auto' cannot re-open the gutter "
  + "(the export buttons have no intrinsic width and stretched the track to 900px)",
  /html\[data-shell=steps\] \.stage\{max-width:min\(600px/.test(STUDIO_HTML)
  && /html\[data-shell=steps\] \.split\{grid-template-columns:auto 452px;justify-content:center\}/.test(STUDIO_HTML));
check("on a phone the step bar is pinned within reach instead of sitting ~950px down",
  /html\[data-shell=steps\] \.steps\{[\s\S]{0,120}position:fixed[\s\S]{0,120}bottom:0/.test(STUDIO_HTML)
  && /html\[data-shell=steps\] main\{padding-bottom:86px\}/.test(STUDIO_HTML));
check("picking a staged post hands the owner on to the words",
  /function stepAfterPick\(\)/.test(_spScript)
  && (_spScript.match(/stepAfterPick\(\);/g) || []).length >= 3);

console.log(`\n==== worker: ${pass} passed, ${fail} failed ====`);
process.exit(fail ? 1 : 0);
