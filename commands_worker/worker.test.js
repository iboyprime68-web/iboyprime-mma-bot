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
const ENV = { STUDIO_PASSWORD: PW, GITHUB_OWNER: "o", GITHUB_REPO: "r" };
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
  await studioTokenValid(ENV, await studioToken({ STUDIO_PASSWORD: "other" }, Date.now())) === false);
check("rotating STUDIO_PASSWORD invalidates every outstanding cookie",
  await studioTokenValid({ STUDIO_PASSWORD: PW + "2" }, SID) === false);
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
const STAGED_MSGS = [
  { id: "111", timestamp: "2026-08-13T10:00:00.000Z",
    content: "Staged post - score 82 (clean head kick, sharp crop)\n```\nThe finish nobody called.\nTwo lines of caption.\n```",
    attachments: [{ url: "https://cdn.discordapp.com/attachments/1/2/post.png" }] },
  { id: "222", timestamp: "2026-08-13T09:00:00.000Z", content: "Staged post - score 7\n```md\nlow scorer\n```",
    attachments: [], embeds: [{ image: { url: "https://cdn.discordapp.com/x.jpg" } }] },
  { id: "333", timestamp: "2026-08-13T08:00:00.000Z", content: "just some chat in the channel", attachments: [] },
  { id: "444", timestamp: "2026-08-13T07:00:00.000Z", content: "Staged post - score 50 (odd one)",
    attachments: [{ url: "javascript:alert(1)" }] },
];
const staged = parseStaged(STAGED_MSGS);
check("parseStaged keeps only staged posts", staged.length === 3 && !staged.some(s => s.id === "333"));
check("parseStaged reads the score", staged[0].score === 82 && staged[1].score === 7);
check("parseStaged reads the reason out of the brackets",
  staged[0].why === "clean head kick, sharp crop" && staged[1].why === "");
check("parseStaged reads the caption out of the fenced block",
  staged[0].caption === "The finish nobody called.\nTwo lines of caption." && staged[1].caption === "low scorer");
check("parseStaged takes the first attachment as the image",
  staged[0].image_url === "https://cdn.discordapp.com/attachments/1/2/post.png");
check("parseStaged falls back to an embed image", staged[1].image_url === "https://cdn.discordapp.com/x.jpg");
check("parseStaged refuses a non-https image url (it lands in an img src)",
  staged[2].image_url === null);
check("parseStaged returns exactly the six agreed fields, nothing else",
  staged.every(s => JSON.stringify(Object.keys(s).sort()) ===
    JSON.stringify(["caption", "id", "image_url", "score", "timestamp", "why"])));
check("parseStaged survives junk", parseStaged(null).length === 0 && parseStaged([{}, null]).length === 0);

const STUDIO_ENV = Object.assign({ DISCORD_BOT_TOKEN: "BOT.TOKEN.secret", GITHUB_TOKEN: "gh_secret_token" }, ENV);
resetStudioCaches();
const noChannel = await withFetch(async (u) => {
  if (u.includes("bots_config.json")) return jsonRes({ channels: { chat: "1515436353091801199" } });
  return new Response("nope", { status: 404 });
}, async () => await worker.fetch(cookieReq("/studio/api/staged", SID), STUDIO_ENV, {}));
check("staged hard-fails when channels.studio is missing (no fallback channel)",
  noChannel.status === 503 && /channels\.studio/.test(await noChannel.text()));

resetStudioCaches();
const okStaged = await withFetch(async (u) => {
  if (u.includes("bots_config.json")) return jsonRes({ channels: { studio: "1515436353091801199", chat: "999" } });
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

// ----- the AI key writer -----
check("only two provider names exist, and each maps to a fixed secret name",
  AI_PROVIDERS.deepseek === "DEEPSEEK_API_KEY" && AI_PROVIDERS.openrouter === "OPENROUTER_API_KEY" &&
  Object.keys(AI_PROVIDERS).length === 2);
const keyStatus = await withFetch(async (u) => {
  if (u.includes("/actions/secrets")) return jsonRes({ total_count: 2, secrets: [
    { name: "DEEPSEEK_API_KEY", created_at: "2026-08-01" }, { name: "DISCORD_BOT_TOKEN", created_at: "2026-01-01" }] });
  return new Response("nope", { status: 404 });
}, async () => await worker.fetch(cookieReq("/studio/api/aikey", SID), STUDIO_ENV, {}));
const keyStatusBody = await keyStatus.text();
check("aikey GET reports presence only, as two booleans",
  keyStatusBody === JSON.stringify({ deepseek: true, openrouter: false }));
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
check("aikey POST rejects an unknown provider", (await postKey({ provider: "openai", key: "sk-abcdefgh" })).status === 400);
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

// ----- source-level guarantees -----
check("the editor page is imported, never inlined here",
  /import \{ STUDIO_HTML \} from "\.\/studio_page\.js"/.test(workerSrc) &&
  !/const STUDIO_HTML = /.test(code));
check("the cookie scheme is documented in source",
  /WHY THIS COOKIE SCHEME IS SAFE/.test(workerSrc));
check("no studio response is ever built out of an env value",
  !/studioJson\(env/.test(code) && !/studioText\(env/.test(code) && !/studioHtml\(env/.test(code) &&
  !/JSON\.stringify\(env/.test(code));
check("STUDIO_PASSWORD never appears in anything the worker sends back",
  !LOGIN_HTML.includes("STUDIO_PASSWORD") && !STUDIO_HTML.includes("STUDIO_PASSWORD") &&
  !JSON.stringify(STUDIO_LIMITS).includes("STUDIO_PASSWORD"));
check("the password is only ever an HMAC key or a constant-time compare",
  (code.match(/env\.STUDIO_PASSWORD/g) || []).length === 5 &&
  !/JSON\.stringify\([^)]*STUDIO_PASSWORD/.test(code));

console.log(`\n==== worker: ${pass} passed, ${fail} failed ====`);
process.exit(fail ? 1 : 0);
