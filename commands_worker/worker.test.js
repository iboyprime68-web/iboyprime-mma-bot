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
// The LAST breaking keyword is a floor too, for a different reason: a breaking
// hit is 30 of the heuristic's 100 points, and both the phone alerts and the
// studio's priority lane are keyed off that score. Measured on 700 real
// stories, an empty list takes the heuristic-80 tier from 3.6 a day to 0.3 -
// so emptying the list silently ends both. newsconfig.validate_newsconfig
// blocks it for MOD_PANEL, but nothing here calls the validator.
const nb1 = applyNewsChange({ breaking_keywords: ["withdraws", "retires"] },
  "keyword", "remove", { list: "breaking", word: "retires" });
check("a breaking word is removable while others remain",
  !nb1._refused && nb1.breaking_keywords.join() === "withdraws");
const nb2 = applyNewsChange({ breaking_keywords: ["withdraws"] },
  "keyword", "remove", { list: "breaking", word: "withdraws" });
check("the LAST breaking word is refused, and the list survives intact",
  nb2._refused === "last-breaking" && nb2.breaking_keywords.join() === "withdraws");
const nb3 = applyNewsChange({ breaking_keywords: ["withdraws", "  "] },
  "keyword", "remove", { list: "breaking", word: "withdraws" });
check("a list left holding only blanks counts as empty, not as one word",
  nb3._refused === "last-breaking");
const nb4 = applyNewsChange({ breaking_keywords: ["withdraws"] },
  "keyword", "add", { list: "breaking", word: "dies" });
check("adding is never refused - he may tune the list, he may not empty it",
  !nb4._refused && nb4.breaking_keywords.length === 2);
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
    gateBody.replace(/\/studio\/login/g, "")));
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
// Sept 25 2026: the templates page grades in Web Workers built from a blob of its own source.
// The CSP gained exactly that (worker-src blob:) and nothing else: same directives, same values.
check("the studio CSP gained ONLY worker-src blob: (default-src still 'none' and first, scripts still self + inline)",
  JSON.stringify(STUDIO_CSP.split("; ").map(d => d.split(" ")[0])) === JSON.stringify(["default-src", "img-src", "style-src",
    "font-src", "script-src", "worker-src", "connect-src", "form-action", "base-uri", "frame-ancestors"])
  && cspDir("worker-src") === "worker-src blob:" && cspDir("script-src") === "script-src 'self' 'unsafe-inline'"
  && STUDIO_CSP.indexOf("default-src 'none'; ") === 0 && !/child-src|unsafe-eval|wasm/.test(STUDIO_CSP));
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
// Sept 24 2026: faces, grade and alts joined the contract (photopick's framing,
// look and the article's other good photos) - seventeen became TWENTY.
const STAGED_FIELDS = ["about", "alts", "bg", "caption", "colorway", "faces", "grade", "hot", "id",
                       "image_url", "line", "photo_kind", "photo_url", "score", "source", "speaker",
                       "spec", "template", "timestamp", "why"];
check("parseStaged returns exactly the twenty agreed fields, nothing else",
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

// The fit/line caches held exactly ONE entry each, so any frame fitting more
// than one string (panels, versus, poll tiles) had a 0% hit rate and re-ran the
// size sweep plus the combinatorial balancer on every drag frame.
check("the canvas fit caches hold more than one entry",
  /var fitCache = lru\(\d+\), lineCache = lru\(\d+\)/.test(_spScript)
  && /function lru\(limit\)/.test(_spScript));
check("the LRU evicts, so a long session cannot grow it without bound",
  /if \(order\.length > limit\) \{ var old = order\.shift\(\); lruFree\(m\[old\]\); delete m\[old\]; \}/.test(_spScript));
check("invalidation clears BOTH caches (the old code nulled a single key)",
  (_spScript.match(/fitCache\.clear\(\); lineCache\.clear\(\);/g) || []).length >= 2);

// The staged rail used to have NO automatic refresh at all: loadStaged() ran at
// boot, on the Refresh button, and on a deep-link miss. A post staged while the
// app was open never appeared until the owner reloaded, which reads as "the
// studio is slow" or "my post isn't in there".
check("the rail refreshes when the tab comes back to the foreground",
  /addEventListener\("visibilitychange"/.test(_spScript)
  && /refreshStagedIfStale/.test(_spScript));
check("the rail also polls gently while the tab is visible",
  /setInterval\([\s\S]{0,80}?refreshStagedIfStale/.test(_spScript)
  && /STAGED_POLL_MS\s*=\s*\d+/.test(_spScript));
check("neither refresh path runs while the tab is hidden (a phone left open "
  + "must not burn Worker requests)",
  /if \(document\.hidden\) return;/.test(_spScript));
check("boot does NOT call loadUsage - it costs four outbound Worker calls for "
  + "a hidden tab that showTab already lazy-loads",
  !/^loadUsage\(\);/m.test(_spScript)
  && /if \(id === "tab-set" && !usageLoaded\) loadUsage\(\);/.test(_spScript));

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
  /hashchange[\s\S]{0,900}pickStaged\(staged\[i\]\)/.test(_spScript));

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
  /<div class="card" data-step="1"(?: id="cardQueue")?>[\s\S]{0,220}Staged by the bot/.test(STUDIO_HTML));
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


// ===== Sept 24 2026: framing, grade, alternates, polls, library, generation ====
// The owner: the pictures "not the best... not even properly positioned", only
// the name ever highlighted, the Fill/Underline chip spilling out, empty space
// either side of the poster, and polls he builds by hand from Googled images.
// Every new surface below is either pure (pinned to the Python twin by shared
// vectors) or a route locked the same way as the staged proxy.

// ----- the staged contract's three new fields -----
const S24_MSG = {
  id: "1552754821935792188", timestamp: "2026-09-24T18:53:00.000Z", author: AUTHOR,
  content: "Staged post - score 70 (heuristic)\n```\nRosas.\n\nvia MMA Sucka\n#UFC\n```\n```json\n"
    + JSON.stringify({ line: "ROSAS TARGETS TITLES", hot: ["ROSAS", "TITLES"], source: "MMA Sucka",
      template: "news", colorway: "purple", photo: "photo",
      faces: [[0.508, 0.341, 0.083, 0.15], ["x", 0, 0, 0], [0.2, 0.2, 2, 0.1], [0.1, 0.1, 0.1, 0.1]],
      grade: { look: "fight", gamma: 0.72 },
      alts: [{ u: "https://platform.mmafighting.com/a.jpg?w=2400", f: [[0.4, 0.1, 0.2, 0.3]] },
             { u: "http://insecure.example/b.jpg" },
             "https://cdn.example.com/c.jpg"] }) + "\n```",
  attachments: [{ url: "https://cdn.discordapp.com/attachments/1/2/post.png" },
                { url: "https://cdn.discordapp.com/attachments/1/2/photo.jpg" }],
};
const s24 = parseStaged([S24_MSG], BOT_ID)[0];
check("faces ride as clean fraction boxes; a junk box is dropped, never zero-filled",
  JSON.stringify(s24.faces) === JSON.stringify([[0.508, 0.341, 0.083, 0.15]]));
check("grade is a known look plus a clamped gamma",
  s24.grade && s24.grade.look === "fight" && s24.grade.gamma === 0.72);
check("alts become same-origin proxy paths at their SPEC index (a skipped bad url "
  + "cannot shift the rest), each with its own faces",
  s24.alts.length === 2 && s24.alts[0].src === "/studio/api/alt/1552754821935792188/0"
  && s24.alts[1].src === "/studio/api/alt/1552754821935792188/2"
  && JSON.stringify(s24.alts[0].faces) === JSON.stringify([[0.4, 0.1, 0.2, 0.3]]));
check("the page never sees an alternate's real url",
  !JSON.stringify(s24).includes("mmafighting.com") && !JSON.stringify(s24).includes("cdn.example.com"));
const cutMsg = JSON.parse(JSON.stringify(S24_MSG));
cutMsg.content = cutMsg.content.replace('"photo":"photo"', '"photo":"cutout"');
const spCut = parseStaged([cutMsg], BOT_ID)[0];
check("a cut-out or wash post carries no faces, grade or alts",
  spCut.photo_kind === "cutout" && spCut.faces.length === 0 && spCut.grade === null && spCut.alts.length === 0);
const evilGrade = JSON.parse(JSON.stringify(S24_MSG));
evilGrade.content = evilGrade.content.replace('"look":"fight"', '"look":"__proto__"').replace('"gamma":0.72', '"gamma":99');
check("an unknown look is refused outright (it names a code path in the page)",
  parseStaged([evilGrade], BOT_ID)[0].grade === null);

check("altUrl: https public hosts only - no http, IP literal, localhost, credentials or giant url",
  _test.altUrl("https://cdn.example.com/x.jpg") === "https://cdn.example.com/x.jpg"
  && _test.altUrl("http://cdn.example.com/x.jpg") === null
  && _test.altUrl("https://127.0.0.1/x.jpg") === null
  && _test.altUrl("https://localhost/x.jpg") === null
  && _test.altUrl("https://user:pw@cdn.example.com/x.jpg") === null
  && _test.altUrl("https://" + "a".repeat(420) + ".com/x.jpg") === null
  && _test.altUrl({ toString() { return "https://cdn.example.com/x.jpg"; } }) === null);

// ----- the alt proxy: only a url the bot listed, only raster bytes -----
await (async () => {
  const realFetch = globalThis.fetch;
  const seen = [];
  _test.resetStudioCaches();
  globalThis.fetch = async (u, init) => {
    const url = String(u && u.url ? u.url : u);
    seen.push(url);
    if (url.startsWith("https://raw.githubusercontent.com/") && url.endsWith("/bots_config.json")) {
      return new Response(JSON.stringify({ channels: { studio: "1537451117363990599", ideas: "1549127181798477865" } }), { status: 200 });
    }
    if (url === "https://discord.com/api/v10/users/@me") return new Response(JSON.stringify({ id: BOT_ID }), { status: 200 });
    if (url.startsWith("https://discord.com/api/v10/channels/1537451117363990599/messages/1552754821935792188")) {
      return new Response(JSON.stringify(S24_MSG), { status: 200 });
    }
    if (url === "https://platform.mmafighting.com/a.jpg?w=2400") {
      return new Response("JPEGBYTES", { status: 200, headers: { "content-type": "image/jpeg" } });
    }
    if (url === "https://cdn.example.com/c.jpg") {
      return new Response("<svg/>", { status: 200, headers: { "content-type": "image/svg+xml" } });
    }
    return new Response("{}", { status: 404 });
  };
  try {
    const ok = await worker.fetch(cookieReq("/studio/api/alt/1552754821935792188/0", SID), STUDIO_ENV, {});
    check("alt proxy relays the bot-listed photo as a sandboxed raster image",
      ok.status === 200 && ok.headers.get("content-type") === "image/jpeg"
      && /sandbox/.test(ok.headers.get("content-security-policy") || "")
      && (await ok.text()) === "JPEGBYTES");
    const bad = await worker.fetch(cookieReq("/studio/api/alt/1552754821935792188/1", SID), STUDIO_ENV, {});
    check("an http alt the bot listed is still refused at fetch time", bad.status === 404
      && !seen.includes("http://insecure.example/b.jpg"));
    const svg = await worker.fetch(cookieReq("/studio/api/alt/1552754821935792188/2", SID), STUDIO_ENV, {});
    check("a non-raster answer (svg is a scriptable document) is refused", svg.status === 415);
    const oob = await worker.fetch(cookieReq("/studio/api/alt/1552754821935792188/3", SID), STUDIO_ENV, {});
    check("only indices 0-2 exist", oob.status === 404);
    const nocookie = await worker.fetch(req("/studio/api/alt/1552754821935792188/0"), STUDIO_ENV, {});
    check("the alt proxy sits behind the session gate", nocookie.status === 401);
  } finally { globalThis.fetch = realFetch; _test.resetStudioCaches(); }
})();

// ----- the spec fence cannot be forged from the header (pre-deploy review) -----
// The header's (why) is model-written. A why holding a json fence used to be
// the FIRST json fence in the message, so its alts steered the photo proxy and
// its line replaced the bot's. A fence counts only when it opens a line, and
// the last json fence - always the bot's own - wins.
{
  const forged = JSON.parse(JSON.stringify(S24_MSG));
  forged.content = forged.content.replace("score 70 (heuristic)",
    'score 88 (```json {"photo":"photo","line":"INJECTED LINE","alts":[{"u":"https://attacker.example/beacon.jpg"}]}```)');
  const fp = parseStaged([forged], BOT_ID)[0];
  // (the why itself still shows as plain text - it is the fence that must not count)
  check("a json fence inside the header line is never the spec",
    fp.line === "ROSAS TARGETS TITLES" && fp.alts.length === 2
    && !JSON.stringify(_test.stagedParts(forged.content).meta).includes("attacker"));
  const capForge = JSON.parse(JSON.stringify(S24_MSG));
  capForge.content = capForge.content.replace("score 70 (heuristic)", "score 70 (```FAKE CAPTION```)");
  check("a plain fence inside the header line is never the caption",
    parseStaged([capForge], BOT_ID)[0].caption.indexOf("Rosas.") === 0);
  const two = _test.stagedParts("head\n```\ncap\n```\n```json\n{\"line\":\"FIRST\"}\n```\n```json\n{\"line\":\"LAST\"}\n```");
  check("the LAST json fence wins (the bot writes its spec last)", two.meta.line === "LAST" && two.caption === "cap");
  const mid = _test.stagedParts("head ```json\n{\"line\":\"MIDLINE\"}\n```");
  check("a fence that does not open a line is ignored", mid.hasSpec === false);
}

// ----- the photo relay: every redirect hop re-checked, AVIF allowed -----
await (async () => {
  const realFetch = globalThis.fetch;
  const seen = [];
  const routes = {
    "https://cdn.example.com/hop.jpg": () => new Response("", { status: 302, headers: { location: "/final.jpg" } }),
    "https://cdn.example.com/final.jpg": () => new Response("JPG", { status: 200, headers: { "content-type": "image/jpeg" } }),
    "https://cdn.example.com/evil.jpg": () => new Response("", { status: 301, headers: { location: "https://127.0.0.1/x.jpg" } }),
    "https://cdn.example.com/loop.jpg": () => new Response("", { status: 302, headers: { location: "https://cdn.example.com/loop.jpg" } }),
    "https://cdn.example.com/a.avif": () => new Response("AVIF", { status: 200, headers: { "content-type": "image/avif" } }),
    "https://dmxg5wxfqgb4u.cloudfront.net/p.png": () => new Response("", { status: 302, headers: { location: "https://evil.example/p.png" } }),
  };
  globalThis.fetch = async (u, init) => {
    const url = String(u && u.url ? u.url : u);
    seen.push({ url, redirect: init && init.redirect });
    return (routes[url] || (() => new Response("", { status: 404 })))();
  };
  try {
    const hop = await _test.relayPhoto("https://cdn.example.com/hop.jpg", _test.altUrl);
    check("a redirect to an allowed host is followed by hand (redirect: manual)",
      hop.status === 200 && (await hop.text()) === "JPG" && seen.every(s => s.redirect === "manual"));
    seen.length = 0;
    const evil = await _test.relayPhoto("https://cdn.example.com/evil.jpg", _test.altUrl);
    check("a redirect to a host the validator refuses is never fetched",
      evil.status === 502 && !seen.some(s => s.url.indexOf("127.0.0.1") !== -1));
    seen.length = 0;
    const loop = await _test.relayPhoto("https://cdn.example.com/loop.jpg", _test.altUrl);
    check("a redirect loop stops after the hop limit", loop.status === 502 && seen.length === _test.RELAY_HOPS + 1);
    const av = await _test.relayPhoto("https://cdn.example.com/a.avif", _test.altUrl);
    check("an AVIF answer is relayed (raster, not scriptable) instead of a 415",
      av.status === 200 && av.headers.get("content-type") === "image/avif" && _test.RASTER.includes("image/avif")
      && !_test.RASTER.includes("image/svg+xml"));
    seen.length = 0;
    const ufc = await _test.relayPhoto("https://dmxg5wxfqgb4u.cloudfront.net/p.png", _test.fighterPhotoUrl);
    check("the fighter photo stays pinned to UFC's hosts across a redirect",
      ufc.status === 502 && !seen.some(s => s.url.indexOf("evil.example") !== -1));
    check("fighterPhotoUrl: https on UFC's hosts only",
      _test.fighterPhotoUrl("https://www.ufc.com/x.png") === "https://www.ufc.com/x.png"
      && _test.fighterPhotoUrl("http://www.ufc.com/x.png") === null
      && _test.fighterPhotoUrl("https://ufc.com.evil.example/x.png") === null
      && _test.fighterPhotoUrl(null) === null);
  } finally { globalThis.fetch = realFetch; }
})();

// ----- polls from the ideas channel -----
const POLL_SPEC = { id: "1552684886224011285", timestamp: "2026-09-24T14:15:00.000Z", author: AUTHOR,
  content: "Staged YouTube poll - written fresh for this slot\n\nWhat is the worst accusation?\n"
    + "\u{1F9E4} Loaded gloves\n\u{1F4AC} Other (comment below)\n\nPaste into the YouTube poll composer:\n"
    + "```\nWhat is the worst accusation?\n\u{1F9E4} Loaded gloves\n\u{1F4AC} Other (comment below)\n```\n"
    + "Swap or trim options freely. The question is the engine.\n```json\n"
    + JSON.stringify({ q: "What is the worst accusation?", options: [
        { label: "Loaded gloves", emoji: "\u{1F9E4}", art: "a glove with a hidden lead weight" },
        { label: "Other (comment below)", emoji: "\u{1F4AC}", art: "" }], gag: "a pigeon referee" }) + "\n```" };
const POLL_OLD = { id: "1552322883928330321", timestamp: "2026-09-23T14:16:00.000Z", author: AUTHOR,
  content: "Staged YouTube poll - question 18 of 60\n\nWho?\n\nPaste into the YouTube poll composer:\n"
    + "```\nWhose title reign aged the worst?\n\u{1F4C9} Sean Strickland\n\u{1F9CA} Leon Edwards\n```\nSwap." };
const s24polls = _test.parsePolls([POLL_SPEC, POLL_OLD,
  { id: "9", author: { id: "123" }, content: "Staged YouTube poll - fake\n```\nQ\n```" },
  { id: "8", author: AUTHOR, content: "chat that mentions Staged YouTube poll late" }], BOT_ID);
check("polls: only this bot's messages that START with the poll header", s24polls.length === 2);
check("polls: the json fence gives question, options, picture ideas and the gag",
  s24polls[0].question === "What is the worst accusation?" && s24polls[0].options.length === 2
  && s24polls[0].options[0].art === "a glove with a hidden lead weight" && s24polls[0].gag === "a pigeon referee"
  && s24polls[0].spec === true && s24polls[0].type === "poll");
check("polls: an older poll without the fence still parses from its paste block",
  s24polls[1].question === "Whose title reign aged the worst?" && s24polls[1].options.length === 2
  && s24polls[1].options[0].label === "Sean Strickland" && s24polls[1].options[0].emoji === "\u{1F4C9}");
check("polls: the emoji/label split keeps plain ASCII labels whole",
  _test.pollOptionLine("Ban them").label === "Ban them" && _test.pollOptionLine("Ban them").emoji === "");

// ----- the library: static assets, only through the gate -----
await (async () => {
  const assets = { fetch: async (r) => new Response(/index\.json$/.test(String(r.url)) ? "[]" : "JPG", { status: 200 }) };
  const env = Object.assign({}, STUDIO_ENV, { ASSETS: assets });
  const ok = await worker.fetch(cookieReq("/studio/lib/jon-jones.jpg", SID), env, {});
  check("a library tile is served same-origin as a jpeg behind the gate",
    ok.status === 200 && ok.headers.get("content-type") === "image/jpeg");
  check("library file names are a strict slug allowlist",
    (await worker.fetch(cookieReq("/studio/lib/..%2Fworker.js", SID), env, {})).status === 404
    && (await worker.fetch(cookieReq("/studio/lib/Jon.JPG", SID), env, {})).status === 404
    && !_test.LIB_FILE.test("../x.jpg") && !_test.LIB_FILE.test("x.svg") && _test.LIB_FILE.test("index.json"));
  check("no ASSETS binding is a 503, never a crash",
    (await worker.fetch(cookieReq("/studio/lib/jon-jones.jpg", SID), STUDIO_ENV, {})).status === 503);
  check("the library needs the session cookie",
    (await worker.fetch(req("/studio/lib/jon-jones.jpg"), env, {})).status === 401);
})();
check("fighter photo slugs are strict and the photo host is pinned to UFC's CDNs",
  _test.FIGHTER_SLUG.test("tom-aspinall") && !_test.FIGHTER_SLUG.test("../x")
  && !_test.FIGHTER_SLUG.test("Tom") && _test.FIGHTER_HOSTS.includes("dmxg5wxfqgb4u.cloudfront.net")
  && _test.FIGHTER_HOSTS.length === 3);

// ----- the pre-deploy review of the page (Sept 24 2026) -----
{
  // pull named top-level functions out of the page script and run them in node
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
  const make = (names, tail) => {
    try { return new Function(names.map(grab).join("\n") + "\n" + tail)(); }
    catch (e) { console.log("extract failed:", e.message); return null; }
  };

  // 1. the wrong-photo export: drafts come back under FRESH keys, and the grade
  //    cache is keyed by the image itself
  const rm = make(["remapAssetKeys"], "return remapAssetKeys;");
  const doc = { photo: { id: "a1", zoom: 1 }, inset: { id: "a2" }, left: { id: "a9" }, panels: { rows: [{ l: { id: "a1" }, r: { id: null } }] },
                template: "news", line: "a1 stays text" };
  const out = rm ? rm(doc, { a1: "a7", a2: "a8" }) : null;
  check("a draft's photo references are rewritten to the fresh keys; an unloaded one becomes empty",
    !!out && out.photo.id === "a7" && out.inset.id === "a8" && out.left.id === null
    && out.panels.rows[0].l.id === "a7" && out.panels.rows[0].r.id === null
    && out.line === "a1 stays text" && out.template === "news" && doc.photo.id === "a1");
  check("hydrate never writes a draft's pixels over a live key (putAt is gone)",
    !/function putAt\(/.test(_spScript) && /remap\[k\] = put\(im, rec, src\)/.test(_spScript)
    && /gradeCache\.clear\(\); lastCrop = \{\}; photoPicks = \[\];/.test(_spScript));
  check("the grade cache key carries the image's own serial and the grade size",
    /var key = \[k, imgSerial\(img\), look, amt, gm, gradeMax\(\)\]\.join\("\|"\)/.test(_spScript));
  check("new facts drop only that photo's grades, never the whole cache",
    /gradeCache\.drop\(k \+ "\|"\)/.test(_spScript));

  // the LRU: evicts, frees evicted canvases, drops one photo's entries
  const L = make(["lruFree", "lru"], "return lru;");
  let freed = 0;
  const fakeCanvas = () => { const c = { getContext() { return {}; } }; Object.defineProperty(c, "width", { set(v) { if (v === 0) freed++; }, get() { return 1; } }); return c; };
  const c3 = L ? L(3) : null;
  if (c3) {
    ["a1|x", "a1|y", "a2|x", "a3|x"].forEach(k => c3.set(k, fakeCanvas()));
    check("the LRU evicts past its limit and shrinks the evicted canvas (iOS canvas memory)",
      c3.get("a1|x") === undefined && !!c3.get("a3|x") && freed === 1);
    c3.drop("a1|");
    check("the LRU drops one photo's entries by prefix and leaves the rest",
      c3.get("a1|y") === undefined && !!c3.get("a2|x") && !!c3.get("a3|x") && freed === 2);
  } else check("the LRU extracts", false);

  // clarity = photopick.clarity (Pillow's subtract/overlay/blend), per channel
  const cp = make(["clarityPx"], "return clarityPx;");
  const PIL02 = [[0,0,0],[10,200,8],[40,90,36],[90,40,97],[127,127,127],[128,60,141],[128,200,113],[200,128,206],[230,40,235],[255,255,255],[255,0,255],[64,64,64],[180,250,171],[3,250,2]];
  const PIL013 = [[40,90,37],[90,40,94],[128,60,136],[128,200,118],[180,250,174]];
  check("the page's clarity matches Pillow's overlay high-pass exactly (vectors computed by Pillow)",
    !!cp && PIL02.every(([a, b, w]) => cp(a, b, 0.2) === w) && PIL013.every(([a, b, w]) => cp(a, b, 0.13) === w));

  // 2. money: generation is keyed by a stable option id
  check("generation is tracked by the option's uid, never its position",
    /genBusy\[o\.uid\]/.test(_spScript) && !/genBusy\[i\]/.test(_spScript) && /function optByUid\(uid\)/.test(_spScript)
    && /uid: newUid\(\)/.test(_spScript));
  check("a tile that finishes after its option left the screen is kept and handed back once",
    /genDone\[uid\] = k;/.test(_spScript) && /delete genDone\[o\.uid\]/.test(_spScript));
  check("a busy tile's Generate button is disabled (no second paid request)",
    /g\.disabled = !!genBusy\[o\.uid\]/.test(_spScript) && /function paintGenButtons\(\)/.test(_spScript));
  check("Generate every missing tile resolves each option when its timer fires and never pays for a blank one",
    /var i = optByUid\(uid\);\s*if \(i !== -1 && !poll\.options\[i\]\.id && !genBusy\[uid\]\) genTile\(i\);/.test(_spScript)
    && /if \(!hasIdea\(o\)\) \{ toast\("Type the option first, then generate\."\); return; \}/.test(_spScript));
  check("undo, redo and saving keep an option's uid",
    /if \(typeof o\.uid === "string" && \/\^o\[a-z0-9\]\{3,40\}\$\/\.test\(o\.uid\)\) d\.uid = o\.uid;/.test(_spScript));

  // 3. deep links are consumed once and never wipe work
  check("a poll link for the poll already open never re-picks it, and the hash is removed after use",
    /if \(poll\.pid === id\) \{ clearHash\(\); return; \}/.test(_spScript)
    && /history\.replaceState\(null, "", location\.pathname \+ location\.search\)/.test(_spScript));
  check("a poll staged after the list loaded is fetched once more before giving up",
    /if \(pollHashTried !== id\) \{ pollHashTried = id; loadPolls\(\); return; \}/.test(_spScript));
  check("a news link shows the Post view (it used to load behind the Polls tab)",
    /pickedHash = m\[1\];\s*showTab\("tab-post"\);/.test(_spScript));

  // 5-7. slider, strip, stage
  check("the Look strength slider grades a small working copy while it moves; exports use the full grade",
    /set: function \(v\) \{ state\.lookAmt = v; draftGrade\(\); \}/.test(_spScript)
    && /function withBlob\(cb\) \{\s*finalGrade\(\);/.test(_spScript)
    && /finalGrade\(\);\s*drawNow\(\);\s*var item = new ClipboardItem/.test(_spScript));
  check("a failed strip photo stops retrying until tapped",
    /if \(!pk\.key && !pk\.loading && !pk\.failed\) preloadPick\(pk\);/.test(_spScript)
    && /\.pickbtn \.ph\.failed\{/.test(STUDIO_HTML));
  check("a photo that arrives after the owner picked another post is dropped",
    /if \(stagedPick !== mine\) return;/.test(_spScript) && /if \(stagedPick !== owner\)/.test(_spScript));
  check("the poster is never measured while the Post view is hidden",
    /if \(\$\("view-post"\) && \$\("view-post"\)\.hidden\) return;/.test(_spScript)
    && /if \(id === "tab-post"\) \{ sizeStage\(\); drawNow\(\); \}/.test(_spScript));

  // 9. library and fighters
  check("an ambiguous library name matches nobody instead of the first of four Silvas",
    /an ambiguous name matches nobody \*\/\s*return null;/.test(_spScript) && /function libMatches\(label\)/.test(_spScript));
  const fs = make(["foldText", "fighterSlug"], "return fighterSlug;");
  check("a fighter the library lacks gets octagon-api's slug for the UFC photo",
    !!fs && fs("Sean O'Malley") === "sean-omalley" && fs("Jiri Procházka") === "jiri-prochazka"
    && fs("Merab  Dvalishvili ") === "merab-dvalishvili" && /\/studio\/api\/fighter\/" \+ slug/.test(_spScript));

  // highlights: the page matches hot words the way postcard._hot_norm does
  const bw = make(["bareWord"], "return bareWord;");
  check("staged hot words land through possessives, edge quotes and a typographic apostrophe",
    !!bw && bw("PAGE'S") === "PAGE" && bw("'VENOM'") === "VENOM" && bw("O'MALLEY'S") === "O'MALLEY"
    && bw("PAGE" + String.fromCharCode(8217) + "S") === "PAGE" && bw("GARRY,") === "GARRY" && bw("HE'LL") === "HE'LL");
  check("the staged spec's hot words are applied with bareWord, not the raw key",
    /var t = bareWord\(h\);/.test(_spScript));

  // AI help: honest refusals and picture ideas for a poll he types himself
  check("AI help reads the Worker's refusal (the daily limit) instead of a generic shrug",
    /function aiReply\(r\)/.test(_spScript) && /function aiFail\(e, what\)/.test(_spScript)
    && !/The deploy sets it from config\.txt/.test(_spScript));
  check("Suggest pictures asks the Worker for ideas and never touches fighters or finished tiles",
    /id="pollIdeas"/.test(STUDIO_HTML) && /mode: "art", question: poll\.q \|\| "", options: opts/.test(_spScript)
    && /if \(!o \|\| o\.kind === "fighter" \|\| o\.id\) return;/.test(_spScript));
  check("the generation note shows how much of today's budget is used",
    /bu\.used \+ " of " \+ bu\.cap \+ " used today\."/.test(_spScript));
}

// ----- Nano Banana generation through the Worker -----
await (async () => {
  const realFetch = globalThis.fetch;
  let sent = null, calls = 0;
  let reply = () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: "AAAA" } }] } }] }),
    { status: 200, headers: { "content-type": "application/json" } });
  globalThis.fetch = async (u, init) => {
    sent = { url: String(u), init };
    calls++;
    return reply();
  };
  try {
    const off = await worker.fetch(new Request("https://w.example/studio/api/gen?aspect=1:1", {
      method: "POST", headers: { cookie: "sid=" + SID }, body: "[]" }), STUDIO_ENV, {});
    const offJ = await off.json();
    check("generation is a 503 that says how to switch it on until the key exists",
      off.status === 503 && /SETUP_STUDIO_IMAGES/.test(offJ.setup || ""));
    check("the setup note no longer sends the owner to DEPLOY.bat (it never touches Worker secrets)",
      !/DEPLOY\.bat/.test(_test.GEN_SETUP) && /stores the key on the Worker/.test(_test.GEN_SETUP));
    const env = Object.assign({}, STUDIO_ENV, { VERTEX_API_KEY: "AIzaTESTKEYVALUE123", VERTEX_PROJECT: "project-0367d456-c2da-4722-99f" });
    const genReq = (q, body) => new Request("https://w.example/studio/api/gen" + q, {
      method: "POST", headers: { cookie: "sid=" + SID, "content-type": "application/json" }, body });
    const bodyOf = () => JSON.parse(typeof sent.init.body === "string" ? sent.init.body : new TextDecoder().decode(sent.init.body));
    _test.resetFuse();
    check("a bad aspect, size or thinking level is refused before any spend",
      (await worker.fetch(genReq("?aspect=7:1", "[]"), env, {})).status === 400
      && (await worker.fetch(genReq("?size=4K", "[]"), env, {})).status === 400
      && (await worker.fetch(genReq("?think=max", "[]"), env, {})).status === 400);
    check("a body that is not a JSON array of parts is refused",
      (await worker.fetch(genReq("?aspect=1:1", '{"contents":[]}'), env, {})).status === 400);
    const parts = JSON.stringify([{ text: "a glove" }]);
    const r = await worker.fetch(genReq("?aspect=1:1&size=1K&think=high", parts), env, {});
    const body = bodyOf();
    check("the request is REBUILT from validated parts, with the config from the SERVER",
      r.status === 200 && body.contents[0].parts[0].text === "a glove"
      && body.contents[0].parts.length === 1 && body.contents[0].role === "user"
      && body.generationConfig.imageConfig.aspectRatio === "1:1"
      && body.generationConfig.imageConfig.imageSize === "1K"
      && body.generationConfig.responseModalities.includes("IMAGE")
      && Array.isArray(body.safetySettings) && body.safetySettings.length === 4
      && JSON.stringify(Object.keys(body).sort()) === JSON.stringify(["contents", "generationConfig", "safetySettings"]));
    check("the endpoint is Vertex on the configured project and model; the key rides "
      + "a header, never the url",
      sent.url === "https://aiplatform.googleapis.com/v1/projects/project-0367d456-c2da-4722-99f/locations/global/publishers/google/models/gemini-3.1-flash-image:generateContent"
      && !sent.url.includes("AIza") && sent.init.headers["x-goog-api-key"] === "AIzaTESTKEYVALUE123");
    // the pre-deploy review's two smuggles: a body that closes the parts array
    // early and adds its own top-level keys (a billed Google Search `tools`
    // block; second copies of the config). Neither is valid JSON as an array,
    // so neither reaches Google at all.
    const before = calls;
    const smug1 = await worker.fetch(genReq("?aspect=1:1&size=1K", '[{"text":"x"}],"generationConfig":{"imageConfig":{"imageSize":"4K"}},"z":[1]'), env, {});
    const smug2 = await worker.fetch(genReq("?aspect=1:1", '[{"text":"a cat"}]}],"tools":[{"googleSearch":{},"functionDeclarations":[]'), env, {});
    check("a body that smuggles its own config or tools is refused and never sent",
      smug1.status === 400 && smug2.status === 400 && calls === before);
    check("genParts keeps ONLY {text} and {inlineData:{mimeType,data}} parts",
      JSON.stringify(_test.genParts('[{"text":"a"},{"inlineData":{"mimeType":"image/jpeg","data":"QUJD"}}]'))
        === JSON.stringify([{ text: "a" }, { inlineData: { mimeType: "image/jpeg", data: "QUJD" } }])
      && _test.genParts('[{"text":"a","tools":[]}]') === null
      && _test.genParts('[{"inlineData":{"mimeType":"image/jpeg","data":"QUJD","extra":1}}]') === null
      && _test.genParts('[{"inlineData":{"mimeType":"image/svg+xml","data":"QUJD"}},{"text":"a"}]') === null
      && _test.genParts('[{"inlineData":{"mimeType":"image/png","data":"QUJD"}}]') === null
      && _test.genParts('[{"text":"   "}]') === null
      && _test.genParts("[" + Array(_test.GEN_PARTS_MAX + 1).fill('{"text":"a"}').join(",") + "]") === null
      && _test.genParts('[{"text":"' + "x".repeat(_test.GEN_TEXT_MAX + 1) + '"}]') === null
      && _test.genParts("not json") === null && _test.genParts('{"text":"a"}') === null);
    const big = await worker.fetch(genReq("?aspect=1:1", '[{"text":"' + "x".repeat(_test.GEN_BODY_MAX) + '"}]'), env, {});
    check("an oversized body is refused before any spend", big.status === 413);
    // Google's 401 (a key the API refuses) must not look like an expired studio session
    reply = () => new Response(JSON.stringify({ error: { code: 401, message: "API keys are not supported by this API." } }),
      { status: 401, headers: { "content-type": "application/json" } });
    _test.resetFuse();
    const g401 = await worker.fetch(genReq("?aspect=1:1", parts), env, {});
    const g401j = await g401.json();
    check("Vertex's 401 reaches the page as a 502 carrying Google's message (a 401 reloads the page)",
      g401.status === 502 && /API keys are not supported/.test(((g401j || {}).error || {}).message || ""));
    reply = () => new Response(JSON.stringify({ candidates: [] }), { status: 200, headers: { "content-type": "application/json" } });
    // no BUDGET binding (this test env): the per-isolate rolling hour still stops a runaway loop
    _test.resetFuse();
    let tripped = false;
    const hourCap = _test.BUDGET_CAPS.gen.hour;
    for (let i = 0; i < hourCap + 1; i++) {
      const rr = await worker.fetch(genReq("?aspect=1:1", parts), env, {});
      if (rr.status === 429) { tripped = i === hourCap; break; }
    }
    check("without the budget object, a per-isolate rolling hour stops a runaway page", tripped);
    _test.resetFuse();
    const st = await (await worker.fetch(cookieReq("/studio/api/gen", SID), env, {})).json();
    check("the status route says configured and prices per size, and never echoes the key",
      st.configured === true && st.costs["1K"] > 0 && !JSON.stringify(st).includes("AIza") && st.budget === null);

    // ----- the ONE spend counter (Durable Object) -----
    const mkStore = () => { const m = new Map(); return { get: async k => m.get(k), put: async (k, v) => { m.set(k, v); }, _m: m }; };
    const store = mkStore();
    const obj = new _test.StudioBudget({ storage: store });
    const binding = { idFromName: n => "id:" + n, get: () => ({ fetch: (u) => obj.fetch(new Request(String(u))) }) };
    const envB = Object.assign({}, env, { BUDGET: binding, STUDIO_GEN_DAILY_CAP: "3", STUDIO_GEN_HOURLY_CAP: "10" });
    calls = 0;
    reply = () => new Response(JSON.stringify({ candidates: [] }), { status: 200, headers: { "content-type": "application/json" } });
    const codes = [];
    for (let i = 0; i < 4; i++) codes.push((await worker.fetch(genReq("?aspect=1:1", parts), envB, {})).status);
    check("the shared budget counts every spend and refuses past the daily cap, before Google is called",
      JSON.stringify(codes) === JSON.stringify([200, 200, 200, 429]) && calls === 3
      && store._m.get("gen").n === 3);
    const stB = await (await worker.fetch(cookieReq("/studio/api/gen", SID), envB, {})).json();
    check("the status route reports today's usage from the shared counter (peeking spends nothing)",
      stB.budget && stB.budget.used === 3 && stB.budget.cap === 3 && store._m.get("gen").n === 3);
    const refused = await (await worker.fetch(genReq("?aspect=1:1", parts), envB, {})).json();
    check("the refusal says which limit and when it resets", /Today's image limit \(3\)/.test(refused.error || "")
      && /midnight UTC/.test(refused.error || ""));
    const broken = { idFromName: () => "x", get: () => ({ fetch: async () => { throw new Error("down"); } }) };
    calls = 0;
    const down = await worker.fetch(genReq("?aspect=1:1", parts), Object.assign({}, env, { BUDGET: broken }), {});
    check("a budget object that cannot answer REFUSES the spend (fail closed) and calls nobody",
      down.status === 503 && calls === 0);
  } finally { globalThis.fetch = realFetch; _test.resetFuse(); }
})();

// ----- the budget maths (pure) -----
{
  const caps = { day: 3, hour: 2 };
  const t0 = Date.UTC(2026, 8, 24, 23, 30);
  let s = _test.budgetStep(null, t0, caps, true);
  check("budgetStep: a first spend on a clean record is allowed and counted", s.ok && s.used === 1 && s.hourUsed === 1);
  s = _test.budgetStep(s.rec, t0 + 1000, caps, true);
  const s3 = _test.budgetStep(s.rec, t0 + 2000, caps, true);
  check("budgetStep: the rolling hour refuses the third spend inside 60 minutes", !s3.ok && s3.used === 2);
  const later = _test.budgetStep(s.rec, t0 + 3600 * 1000 + 5000, caps, true);
  check("budgetStep: the hour window rolls (the record crossed midnight UTC, so the day restarts too)",
    later.ok && later.used === 1 && later.rec.day === "2026-09-25");
  const peek = _test.budgetStep(s.rec, t0 + 3000, caps, false);
  check("budgetStep: a peek never counts", peek.used === 2 && peek.rec.n === 2 && !peek.ok);
  const junk = _test.budgetStep({ day: "2026-09-24", n: "lots", hits: ["x", -5, 1e20] }, t0, caps, true);
  check("budgetStep: a junk record reads as empty, never as a crash or a free pass", junk.ok && junk.used === 1);
  check("budget caps take integer [vars] overrides and ignore junk",
    _test.budgetCaps({ STUDIO_GEN_DAILY_CAP: "12" }, "gen").day === 12
    && _test.budgetCaps({ STUDIO_GEN_DAILY_CAP: "1e9" }, "gen").day === _test.BUDGET_CAPS.gen.day
    && _test.budgetCaps({ STUDIO_AI_HOURLY_CAP: "-1" }, "ai").hour === _test.BUDGET_CAPS.ai.hour
    && _test.budgetCaps({}, "nope") === null);
}
await (async () => {
  const store = new Map();
  const obj = new _test.StudioBudget({ storage: { get: async k => store.get(k), put: async (k, v) => { store.set(k, v); } } });
  const bad = await obj.fetch(new Request("https://budget/spend?k=__proto__"));
  check("the budget object refuses an unknown kind", bad.status === 400 && store.size === 0);
  const r1 = await (await obj.fetch(new Request("https://budget/spend?k=ai&day=1&hour=5"))).json();
  const r2 = await (await obj.fetch(new Request("https://budget/spend?k=ai&day=1&hour=5"))).json();
  check("the budget object counts ai help on its own line", r1.ok && !r2.ok && store.get("ai").n === 1 && !store.has("gen"));
})();

// ----- AI writing help -----
check("aiClean strips fence breakers, em dashes and exclamation marks",
  _test.aiClean("a `x` <b> big—deal!", 80) === "a x b big-deal");
const s24lines = _test.parseAiLines({ lines: [{ line: "Rosas targets titles before 25", hot: ["Rosas", "titles", "belts"] },
                                           { line: "", hot: [] }, { line: "x".repeat(200), hot: [] }] });
check("line suggestions keep only highlight words the line really contains",
  s24lines.length === 2 && JSON.stringify(s24lines[0].hot) === JSON.stringify(["Rosas", "titles"]) && s24lines[1].line.length <= 90);
check("picture ideas are one per option, clamped",
  JSON.stringify(_test.parseAiArt({ art: ["a", "b"], gag: "g" }, 3)) === JSON.stringify({ art: ["a", "b", ""], gag: "g" }));
check("a picture idea showing gambling is dropped, never cleaned (casino chips, a poker table, roulette)",
  JSON.stringify(_test.parseAiArt({ art: ["a raccoon pushing casino chips across a poker table", "a glove under a spotlight",
    "a pigeon spinning a Roulette wheel"], gag: "a llama rolling dice at ringside" }, 3))
    === JSON.stringify({ art: ["", "a glove under a spotlight", ""], gag: "" })
  && _test.aiSafeIdea("a slot   machine jackpot") === "" && _test.aiSafeIdea("the betting odds board") === ""
  && _test.aiSafeIdea("a sloth on the octagon canvas") === "a sloth on the octagon canvas");
await (async () => {
  const r = await worker.fetch(new Request("https://w.example/studio/api/ai", { method: "POST",
    headers: { cookie: "sid=" + SID, "content-type": "application/json" }, body: JSON.stringify({ mode: "lines" }) }), STUDIO_ENV, {});
  check("AI help is a 503 without a key on the Worker, never a crash", r.status === 503);
})();

await (async () => {
  // AI help spends the SAME DeepSeek balance as the news scorer, so it sits
  // behind the same shared counter as image generation
  const realFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return new Response(JSON.stringify({ choices: [{ message: { content: '{"lines":[{"line":"Rosas targets titles","hot":["Rosas"]}]}' } }] }),
      { status: 200, headers: { "content-type": "application/json" } });
  };
  const store = new Map();
  const obj = new _test.StudioBudget({ storage: { get: async k => store.get(k), put: async (k, v) => { store.set(k, v); } } });
  const binding = { idFromName: n => n, get: () => ({ fetch: (u) => obj.fetch(new Request(String(u))) }) };
  const env = Object.assign({}, STUDIO_ENV, { DEEPSEEK_API_KEY: "sk-test", BUDGET: binding, STUDIO_AI_DAILY_CAP: "2" });
  const ask = () => worker.fetch(new Request("https://w.example/studio/api/ai", { method: "POST",
    headers: { cookie: "sid=" + SID, "content-type": "application/json" },
    body: JSON.stringify({ mode: "lines", headline: "Rosas targets titles" }) }), env, {});
  try {
    const codes = [(await ask()).status, (await ask()).status, (await ask()).status];
    check("AI help is counted on the shared budget and refused past its cap, before the provider is called",
      JSON.stringify(codes) === JSON.stringify([200, 200, 429]) && calls === 2 && store.get("ai").n === 2);
    calls = 0;
    const bad = await worker.fetch(new Request("https://w.example/studio/api/ai", { method: "POST",
      headers: { cookie: "sid=" + SID, "content-type": "application/json" }, body: JSON.stringify({ mode: "nope" }) }), env, {});
    check("an unknown AI mode is refused without spending", bad.status === 400 && calls === 0 && store.get("ai").n === 2);
  } finally { globalThis.fetch = realFetch; }
})();

// ----- the page: face framing + grade mirror photopick exactly -----
const _grab2 = (name) => {
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
const _eng = (() => {
  const src = ["clamp", "rgb3", "cropTune", "smartCrop", "lookDef", "autoGamma", "gradeParams", "gsig",
               "gsmooth", "gradePixel", "gradeImageData"].map(_grab2).join("\n")
    + "\n" + (_spScript.match(/var CROP_TUNE = [^;]*;/) || [""])[0]
    + "\n" + (_spScript.match(/var MAX_UPSCALE = [^;]*;/) || [""])[0]
    + "\n" + (_spScript.match(/var LOOKS = \[[\s\S]*?\];/) || [""])[0]
    + "\n" + (_spScript.match(/var TARGET_FACE_LUM = [^;]*;/) || [""])[0]
    + "\nvar GS0 = gsig(0), GS1 = gsig(1);"
    + "\nreturn { smartCrop, gradePixel, gradeParams, autoGamma, gradeImageData };";
  try { return new Function(src)(); } catch (e) { console.log("engine extract failed:", e.message); return null; }
})();
check("the page's framing and grade engine is extractable and runs", !!_eng);
if (_eng) {
  // vectors computed by bots_github/photopick.py (the Python suite pins the same)
  const CROPS = [[[1500, 1000, [[0.508, 0.341, 0.083, 0.15]], 1080, 1350], [540.0395, 188.6316, 568.4211, 710.5263]],
    [[1200, 675, [[0.195, 0.062, 0.104, 0.221], [0.691, 0.211, 0.09, 0.231]], 1080, 1350], [26.4, 0.0, 540.0, 675.0]],
    [[3619, 2413, [[0.595, 0.115, 0.107, 0.194]], 1080, 1080], [1329.265, 0.0, 2035.313, 2035.313]],
    [[1920, 1280, [[0.41, 0.15, 0.17, 0.31], [0.36, 0.09, 0.14, 0.26]], 1080, 1920], [542.4, 0.0, 720.0, 1280.0]],
    [[1920, 1280, [], 1080, 1350], [448.0, 0.0, 1024.0, 1280.0]],
    [[1920, 1280, [[0.557, 0.119, 0.066, 0.151], [0.293, 0.19, 0.07, 0.136], [0.867, 0.325, 0.039, 0.085]], 1080, 1350],
     [483.36, 0.0, 792.0, 990.0]]];
  check("smartCrop matches photopick.smart_crop on six real framings (Rosas, Volkov/Gane, Fury, a pair, faceless, "
    + "Nunes with her coach)",
    CROPS.every(([a, want]) => _eng.smartCrop(...a).every((v, i) => Math.abs(v - want[i]) < 0.01)));
  const PX = [["fight", 0.72, 1.0, [0.1, 0.2, 0.3], [0.16761, 0.27858, 0.41701]], ["fight", 0.72, 1.0, [0.8, 0.6, 0.5], [0.89247, 0.7337, 0.62894]],
    ["fight", 0.72, 1.0, [0.5, 0.5, 0.5], [0.63936, 0.6382, 0.63712]], ["fight", 0.72, 1.0, [0.95, 0.9, 0.2], [0.97239, 0.93305, 0.28987]],
    ["cinema", 1.1, 0.6, [0.1, 0.2, 0.3], [0.08621, 0.18403, 0.27639]], ["cinema", 1.1, 0.6, [0.8, 0.6, 0.5], [0.80513, 0.59538, 0.48195]],
    ["mono", 1.0, 1.0, [0.1, 0.2, 0.3], [0.14466, 0.14748, 0.15708]], ["mono", 1.0, 1.0, [0.8, 0.6, 0.5], [0.68017, 0.68017, 0.68017]],
    ["natural", 0.9, 1.0, [0.8, 0.6, 0.5], [0.86318, 0.65054, 0.5269]], ["natural", 0.9, 1.0, [0.95, 0.9, 0.2], [0.9671, 0.928, 0.17775]]];
  check("gradePixel matches photopick.grade_pixel to 1e-4 across four looks",
    PX.every(([look, g, s, rgb, want]) => {
      const out = _eng.gradePixel(rgb[0], rgb[1], rgb[2], _eng.gradeParams(look, g, s));
      return out.every((v, i) => Math.abs(v - want[i]) < 1e-4);
    }));
  check("autoGamma matches photopick.auto_gamma (lift a dark face, ease a bright frame, leave a good one)",
    _eng.autoGamma(0.231, true) === 0.72 && _eng.autoGamma(0.7, false) === 1.18 && _eng.autoGamma(0.5, true) === 1);
  const s24d = { data: new Uint8ClampedArray([26, 51, 77, 255, 204, 153, 128, 255]) };
  const pF = _eng.gradeParams("fight", 0.72, 1);
  _eng.gradeImageData(s24d, pF);
  const ref = [[26, 51, 77], [204, 153, 128]].map(c => _eng.gradePixel(c[0] / 255, c[1] / 255, c[2] / 255, pF)
    .map(v => Math.floor(v * 255 + 0.5)));
  check("the bulk grader equals the per-pixel reference byte for byte (the LUT fold is exact)",
    [0, 1, 2].every(i => s24d.data[i] === ref[0][i]) && [0, 1, 2].every(i => s24d.data[4 + i] === ref[1][i]));
}
check("the face-framed mode is the default and staged posts open in it",
  /fitMode: "auto"/.test(_spScript) && /state\.fitMode = "auto";/.test(_spScript));
check("a tap can pick the face when no detector found one, mapped back through the crop",
  /function finishPickFace\(p\)/.test(_spScript) && /if \(pickingFace\) \{ finishPickFace\(p\);/.test(_spScript));

// ----- the page: words, checks, layout -----
check("Highlight the news picks the surname plus the strongest news word",
  /function smartHotIdx\(ws\)/.test(_spScript) && /var DRAMA_TIERS = \[/.test(_spScript));
check("the design check flags a name-only highlight and every check carries a fix",
  /Only the name is highlighted/.test(_spScript) && /function autoDesign\(\)/.test(_spScript)
  && /id="autoBtn"/.test(STUDIO_HTML) && /id="checks"/.test(STUDIO_HTML));
check("checks run after the poster settles, never on every drag frame",
  /function scheduleChecks\(\)/.test(_spScript) && /setTimeout\(runChecks, \d+\)/.test(_spScript));
check("the Fill/Underline buttons size to their text (Underline spilled over the swatches)",
  /\.tbar \.seg button\{[^}]*flex:none;white-space:nowrap\}/.test(STUDIO_HTML));
check("wide screens get three columns and the poster height is measured, not guessed",
  /@media\(min-width:1500px\)\{\s*html\[data-shell=steps\] \.split\{grid-template-columns:300px minmax\(0,1fr\) 460px\}/.test(STUDIO_HTML)
  && /calc\(var\(--stageH, 68vh\) \* var\(--ar\)\)/.test(STUDIO_HTML)
  && /function sizeStage\(\)/.test(_spScript) && /function placeQueue\(\)/.test(_spScript)
  && /id="queueCol"/.test(STUDIO_HTML));

// ----- the page: the poll workshop -----
check("a staged poll opens from its Discord link (#p=)",
  /\[#&\]p=\(\[0-9\]\{15,21\}\)/.test(_spScript) && /function pickPollFromHash\(\)/.test(_spScript));
check("fighter options match the owner's own library by name, nickname or surname",
  /function matchLib\(label\)/.test(_spScript) && /\/studio\/lib\/index\.json/.test(_spScript));
check("library tiles download byte for byte, never re-encoded",
  /\/studio\/lib\/" \+ o\.lib \+ "\.jpg"\)\.then\(function \(r\) \{ if \(!r\.ok\) throw new Error\("x"\); return r\.blob\(\); \}\)/.test(_spScript));
const _styles = (() => {
  const m = _spScript.match(/var POLL_STYLES = \{[\s\S]*?\};/);
  try { return m ? new Function(m[0] + " return POLL_STYLES;")() : null; } catch (e) { return null; }
})();
check("every house style forbids text in the image (the page sets the type, spelled right)",
  !!_styles && ["poster", "photo", "meme"].every(k => /no text/i.test(_styles[k] || "")
    && /\{S\}/.test(_styles[k] || "")));
check("the big word is set in Anton, loaded from Google Fonts like Poppins",
  /family=Anton&family=Poppins/.test(STUDIO_HTML) && /px Anton, Impact/.test(_spScript));
check("generation goes through the Worker and parses the image part without trusting sizes",
  /\/studio\/api\/gen\?aspect=1:1&size=/.test(_spScript) && /function pickImagePart\(j\)/.test(_spScript));
check("with generation off the prompt is copied instead, so the button never dead-ends",
  /if \(!genStatus \|\| !genStatus\.configured\) \{ copyPrompt\(i, true\); return; \}/.test(_spScript));
if (wrangler !== null) {
  check("the spend budget is ONE Durable Object (SQLite-backed, free plan) bound as BUDGET",
    /\[\[durable_objects\.bindings\]\]\s*name = "BUDGET"\s*class_name = "StudioBudget"/.test(wrangler)
    && /\[\[migrations\]\]\s*tag = "v1"\s*new_sqlite_classes = \["StudioBudget"\]/.test(wrangler));
  check("the tile library is private: every request runs the Worker first",
    /\[assets\][\s\S]*directory = "\.\/lib_assets"[\s\S]*run_worker_first = true/.test(wrangler));
}

// ===== Sept 25 2026: the poster TEMPLATES page + the UFC.com data routes =====
{
  const card = (me, meSlug, opp, oppSlug, res, method, round, ev) =>
    '<article class="c-card-event--athlete-results"><div class="c-card-event--athlete-results__image c-card-event--athlete-results__red-image ' + (res === "win" ? "loss" : "win") + '">'
    + '<a href="https://www.ufc.com/athlete/' + oppSlug + '"><div><img src="https://ufc.com/images/styles/event_results_athlete_headshot/s3/2025-05/' + opp.toUpperCase().replace(/ /g, "_") + '_10-26.png?itok=Tih1" width="256" alt="' + opp + '" /></div></a></div>'
    + '<div class="c-card-event--athlete-results__image c-card-event--athlete-results__blue-image ' + res + '"><a href="https://www.ufc.com/athlete/' + meSlug + '"><div><img src="https://ufc.com/images/styles/event_results_athlete_headshot/s3/2024-01/ME_BELT_01-20.png?itok=x6x1" width="256" /></div></a></div>'
    + '<h3 class="c-card-event--athlete-results__headline"><a>X</a></h3><div class="c-card-event--athlete-results__date">May. 10, 2026</div>'
    + '<div class="c-card-event--athlete-results__result-label">Round</div> <div class="c-card-event--athlete-results__result-text">' + round + '</div>'
    + '<div class="c-card-event--athlete-results__result-label">Method</div> <div class="c-card-event--athlete-results__result-text">' + method + '</div>'
    + '<a href="https://www.ufc.com/event/' + ev + '#12722">Fight Card</a></article>';
  const page = '<div class="hero-profile"><p class="hero-profile__tag">Middleweight Division</p><p class="hero-profile__tag">Title Holder</p>'
    + '<p class="hero-profile__nickname">&quot;Tarzan&quot;</p><h1 class="hero-profile__name">Sean Strickland</h1>'
    + '<p class="hero-profile__division-title">Middleweight Division</p><p class="hero-profile__division-body">31-7-0 (W-L-D)</p>'
    + '<p class="hero-profile__stat-numb">12</p> <p class="hero-profile__stat-text">Wins by Knockout</p>'
    + '<img src="https://ufc.com/images/styles/athlete_bio_full_body/s3/2024-01/STRICKLAND_SEAN_L_BELT_01-20.png?itok=4lpT" alt="x" class="hero-profile__image"></div>'
    + '<div class="c-bio__info"><div class="c-bio__label">Age</div> <div class="c-bio__text"> <div class="field">35</div> </div> </div>'
    + '<div class="c-bio__label">Reach</div> <div class="c-bio__text">76.00</div> </div></div>'
    + '<h2>Win by Method</h2><div class="c-stat-3bar__label">KO/TKO </div> <div class="c-stat-3bar__value">12 (39%)</div>'
    + '<div class="c-stat-3bar__label">SUB </div> <div class="c-stat-3bar__value">4 (13%)</div>'
    + '<div class="c-stat-compare c-stat-compare--no-bar"><div class="c-stat-compare__number">5.98 </div> <div class="c-stat-compare__label">Sig. Str. Landed</div></div>'
    + card("Sean Strickland", "sean-strickland", "Khamzat Chimaev", "khamzat-chimaev", "win", "Decision - Split", "5", "ufc-328")
    + card("Sean Strickland", "sean-strickland", "Alex Pereira", "alex-pereira", "loss", "KO/TKO", "1", "ufc-fight-night-july-01-2022");
  const a = _test.parseUfcAthlete(page, "sean-strickland");
  check("ufc: the athlete hero parses (name, nickname, record without W-L-D, tags)",
    a.name === "Sean Strickland" && a.nickname === "Tarzan" && a.record === "31-7-0"
    && a.tags.join("|") === "Middleweight Division|Title Holder" && a.stats["Wins by Knockout"] === 12);
  check("ufc: the full body goes out as the UNSTYLED master (1350x3324), the style as the quick copy",
    a.body === "/studio/api/ufcimg?p=" + encodeURIComponent("/images/2024-01/STRICKLAND_SEAN_L_BELT_01-20.png")
    && /athlete_bio_full_body/.test(decodeURIComponent(a.bodySmall)) && /&k=4lpT$/.test(a.bodySmall) && a.face === "L");
  check("ufc: bio fields, win method and strike rates parse (a nested field div included)",
    a.bio.Age === "35" && a.bio.Reach === "76.00" && a.method["KO/TKO"] === 12 && a.method.SUB === 4
    && a.rates["Sig. Str. Landed"] === 5.98);
  const fs = _test.parseUfcFights(page, "sean-strickland");
  check("ufc: fight cards read from HIS corner: opponent, result, method, round, event",
    fs.length === 2 && fs[0].opp === "Khamzat Chimaev" && fs[0].oppSlug === "khamzat-chimaev" && fs[0].result === "win"
    && fs[0].method === "Decision - Split" && fs[0].round === "5" && fs[0].event === "UFC 328"
    && fs[1].result === "loss" && fs[1].event === "UFC Fight Night");
  check("ufc: an opponent headshot is the unstyled 520x325 master, relayed same-origin",
    fs[0].oppHead === "/studio/api/ufcimg?p=" + encodeURIComponent("/images/2025-05/KHAMZAT_CHIMAEV_10-26.png"));
  check("ufc: a card that does not involve the athlete is skipped",
    _test.parseUfcFights(page, "someone-else").length === 0);
  check("ufc: an opponent's alt text 'Fighter portrait of X' becomes X (never printed on a poster verbatim)",
    _test.ufcAltName("Fighter portrait of Aljamain Sterling", "aljamain-sterling") === "Aljamain Sterling"
    && _test.ufcAltName("Portrait of Petr Yan", "petr-yan") === "Petr Yan" && _test.ufcAltName("Merab Dvalishvili", "x") === "Merab Dvalishvili"
    && _test.ufcAltName("", "sean-o-malley") === "Sean O Malley" && _test.ufcAltName("image of fighter 123", "petr-yan") === "Petr Yan");
  {
    const altPage = card("Petr Yan", "petr-yan", "Aljamain Sterling", "aljamain-sterling", "win", "Decision - Split", "5", "ufc-280")
      .replace(/alt="[^"]*"/g, 'alt="Fighter portrait of Aljamain Sterling"');
    const fa = _test.parseUfcFights(altPage, "petr-yan");
    check("ufc: the fight history reads the cleaned name from a captioned alt text", fa.length === 1 && fa[0].opp === "Aljamain Sterling", JSON.stringify(fa[0] && fa[0].opp));
  }

  const evPage = '<div class="field field--name-node-title field--type-ds"><h1> UFC 333 </h1></div>'
    + '<span class="e-divider__top">Volkanovski</span><span class="e-divider__bottom">Evloev</span>'
    + '<div class="c-hero__headline-suffix tz-change-inner" data-locale="en-uk" data-timestamp="1792864800" data-format="x"> Sat </div>'
    + '<div class="c-hero__text"> <div class="field field--name-venue field--type-entity-reference">Etihad Arena, Yas Island </div></div>';
  const fight = (cls, r, b) => '<div class="c-listing-fight" data-fmid="1"><div class="c-listing-fight__class-text">' + cls + '</div>'
    + '<div class="c-listing-fight__corner-image--red"><a href="https://www.ufc.com/athlete/' + r[2] + '"><img src="https://ufc.com/images/styles/event_fight_card_upper_body_of_standing_athlete/s3/2026-01/' + r[1].toUpperCase() + '_L_01-31.png?itok=3qNx" /></a></div>'
    + '<div class="c-listing-fight__ranks-row"><div class="c-listing-fight__corner-rank"><span>C</span></div><div class="c-listing-fight__corner-rank"><span>#1</span></div></div>'
    + '<div class="c-listing-fight__corner-name c-listing-fight__corner-name--red"><a><span class="c-listing-fight__corner-given-name">' + r[0] + '</span> <span class="c-listing-fight__corner-family-name">' + r[1] + '</span></a></div>'
    + '<div class="c-listing-fight__corner-name c-listing-fight__corner-name--blue"><a><span class="c-listing-fight__corner-given-name">' + b[0] + '</span> <span class="c-listing-fight__corner-family-name">' + b[1] + '</span></a></div>'
    + '<div class="c-listing-fight__corner-image--blue"><a href="https://www.ufc.com/athlete/' + b[2] + '"><img src="https://ufc.com/images/styles/event_fight_card_upper_body_of_standing_athlete/s3/2025-01/5/' + b[1].toUpperCase() + '_R_01-20.png?itok=cpiJ" /></a></div></div>';
  const ev = _test.parseUfcEvent(evPage + fight("Featherweight Title Bout", ["Alexander", "Volkanovski", "alexander-volkanovski"], ["Movsar", "Evloev", "movsar-evloev"])
    + '<div id="prelims-card" class="fight-card-prelims"></div>' + fight("Lightweight Bout", ["Grant", "Dawson", "grant-dawson"], ["Nurullo", "Aliev", "nurullo-aliev"]), "ufc-333");
  check("ufc: an event parses title, headline, date, venue and the whole card",
    ev.title === "UFC 333" && ev.headline === "Volkanovski vs Evloev" && ev.ts === 1792864800 && ev.venue === "Etihad Arena, Yas Island"
    && ev.fights.length === 2);
  check("ufc: each bout carries both corners with slugs, ranks, pose side and the cut-out",
    ev.fights[0].red.last === "Volkanovski" && ev.fights[0].red.slug === "alexander-volkanovski" && ev.fights[0].red.rank === "C"
    && ev.fights[0].blue.rank === "#1" && ev.fights[0].red.face === "L" && ev.fights[0].blue.face === "R"
    && /event_fight_card_upper_body/.test(decodeURIComponent(ev.fights[0].red.imgSmall)) && !/styles/.test(decodeURIComponent(ev.fights[0].red.img)));
  check("ufc: bouts below the prelims marker are labelled prelims, the rest main card",
    ev.fights[0].card === "main" && ev.fights[1].card === "prelims");
  {
    // ufc.com sometimes writes a corner name as plain link text (no given / family spans): UFC 332's
    // Soldic vs Khaos Williams was dropped from the card
    const plain = fight("Welterweight Bout", ["Roberto", "Soldic", "roberto-soldic"], ["Khaos", "Williams", "khaos-williams"])
      .replace('<a><span class="c-listing-fight__corner-given-name">Khaos</span> <span class="c-listing-fight__corner-family-name">Williams</span></a>',
               '<a href="https://www.ufc.com/athlete/khaos-williams">Khaos Williams</a>');
    const ev2 = _test.parseUfcEvent(evPage + plain, "ufc-332");
    check("ufc: a corner written as a plain link still gets its name (split on the last space)",
      ev2.fights.length === 1 && ev2.fights[0].blue.first === "Khaos" && ev2.fights[0].blue.last === "Williams" && ev2.fights[0].red.last === "Soldic",
      JSON.stringify(ev2.fights[0] && ev2.fights[0].blue));
    const bare = fight("Welterweight Bout", ["Roberto", "Soldic", "roberto-soldic"], ["Khaos", "Williams", "khaos-williams"])
      .replace('<a><span class="c-listing-fight__corner-given-name">Khaos</span> <span class="c-listing-fight__corner-family-name">Williams</span></a>', '');
    const ev3 = _test.parseUfcEvent(evPage + bare, "ufc-332");
    check("ufc: a corner with no name at all is named from the athlete slug", ev3.fights[0].blue.last === "Williams" && ev3.fights[0].blue.first === "Khaos");
  }
  const evs = _test.parseUfcEvents('<a href="/events#events-list-upcoming">U</a><details id="events-list-upcoming">'
    + '<h3 class="c-card-event--result__headline"><a href="/event/ufc-333">Volkanovski vs Evloev</a></h3><div data-main-card-timestamp="1792864800"></div>'
    + '<h3 class="c-card-event--result__headline"><a href="/event/ufc-fight-night-october-10-2026">Allen vs Duncan</a></h3><div data-main-card-timestamp="1791676800"></div>'
    + '</details><details id="events-list-past"><h3 class="c-card-event--result__headline"><a href="/event/ufc-330">Old vs Fight</a></h3><div data-main-card-timestamp="1"></div></details>');
  check("ufc: the events list keeps UPCOMING events only, titled from the slug",
    evs.length === 2 && evs[0].title === "UFC 333" && evs[0].headline === "Volkanovski vs Evloev" && evs[1].title === "UFC Fight Night");

  check("ufc image paths are pinned: ufc.com only, /images/ only, png only, no traversal, itok only on styles",
    !!_test.ufcImg("https://ufc.com/images/2024-01/X_L.png") && !!_test.ufcImg("https://www.ufc.com/images/styles/a_b/s3/2025-01/5/X.png?itok=abcd")
    && _test.ufcImg("https://ufc.com/images/styles/a_b/s3/2025-01/5/X.png?itok=abcd").k === "abcd"
    && _test.ufcImg("https://ufc.com/images/2024-01/X.png?itok=abcd").k === ""
    && _test.ufcImg("https://evil.com/images/2024-01/X.png") === null && _test.ufcImg("https://ufc.com/images/2024-01/X.svg") === null
    && _test.ufcImg("https://ufc.com/images/2024-01/../../x.png") === null && _test.ufcImg("https://ufc.com/sites/x.png") === null
    && _test.ufcImg("//ufc.com.evil.com/images/2024-01/X.png") === null);
  await withFetch(async (u) => new Response("PNG", { status: 200, headers: { "content-type": "image/png" } }), async (seen) => {
    const bad = await worker.fetch(cookieReq("/studio/api/ufcimg?p=" + encodeURIComponent("/images/../worker.js"), SID), STUDIO_ENV, {});
    const good = await worker.fetch(cookieReq("/studio/api/ufcimg?p=" + encodeURIComponent("/images/styles/athlete_bio_full_body/s3/2024-01/X_L.png") + "&k=abcd", SID), STUDIO_ENV, {});
    check("the ufc image relay refuses a path outside the pinned shape before any fetch",
      bad.status === 404 && seen.length === 1);
    check("the ufc image relay fetches ONLY https://ufc.com + the checked path and answers a sandboxed raster",
      good.status === 200 && seen[0].url === "https://ufc.com/images/styles/athlete_bio_full_body/s3/2024-01/X_L.png?itok=abcd"
      && /sandbox/.test(good.headers.get("content-security-policy") || ""));
  });
  await withFetch(async (u) => new Response("", { status: 302, headers: { location: "https://evil.example/x.png" } }), async () => {
    const r = await worker.fetch(cookieReq("/studio/api/ufcimg?p=" + encodeURIComponent("/images/2024-01/X_L.png"), SID), STUDIO_ENV, {});
    check("a ufc image that redirects off UFC's hosts is refused", r.status === 502);
  });
  await withFetch(async (u) => new Response(page, { status: 200, headers: { "content-type": "text/html" } }), async (seen) => {
    const r = await worker.fetch(cookieReq("/studio/api/ufc/sean-strickland?n=99", SID), STUDIO_ENV, {});
    const j = await r.json();
    check("the athlete route pages the history three bouts at a time, capped at 15 bouts (5 pages)",
      r.status === 200 && j.name === "Sean Strickland" && seen.length === 5 && seen.every(s => /^https:\/\/www\.ufc\.com\/athlete\/sean-strickland(\?page=[1-4])?$/.test(s.url))
      && j.fights.length === 2 && !!j.head);
    const again = await worker.fetch(cookieReq("/studio/api/ufc/sean-strickland?n=99", SID), STUDIO_ENV, {});
    check("a repeat lookup is served from the isolate cache (no second round of fetches)", again.status === 200 && seen.length === 5);
  });
  check("the athlete route refuses a slug outside the allowlist without fetching",
    (await worker.fetch(cookieReq("/studio/api/ufc/..%2F..%2Fevil", SID), STUDIO_ENV, {})).status === 404
    && (await worker.fetch(cookieReq("/studio/api/ufcevent/UFC_333", SID), STUDIO_ENV, {})).status === 404);
  await withFetch(async (u) => { const r = new Response(page, { status: 200 }); Object.defineProperty(r, "url", { value: "https://evil.example/athlete/x" }); return r; }, async () => {
    const r = await worker.fetch(cookieReq("/studio/api/ufc/jon-jones", SID), STUDIO_ENV, {});
    check("an athlete page that lands off ufc.com after redirects is never parsed", r.status === 502 || r.status === 404);
  });
  check("every UFC route and the texture plates need the session cookie",
    (await worker.fetch(req("/studio/api/ufc/jon-jones"), STUDIO_ENV, {})).status === 401
    && (await worker.fetch(req("/studio/api/ufcevent/ufc-333"), STUDIO_ENV, {})).status === 401
    && (await worker.fetch(req("/studio/api/ufcevents"), STUDIO_ENV, {})).status === 401
    && (await worker.fetch(req("/studio/api/ufcimg?p=%2Fimages%2F2024-01%2FX.png"), STUDIO_ENV, {})).status === 401
    && (await worker.fetch(req("/studio/tpl/arena.jpg"), STUDIO_ENV, {})).status === 401);
  const tplAssets = { fetch: async (r) => new Response("IMG", { status: /\/tpl\/(arena\.jpg|tape1\.png)$/.test(String(r.url)) ? 200 : 404 }) };
  const tenv = Object.assign({}, STUDIO_ENV, { ASSETS: tplAssets });
  const tj = await worker.fetch(cookieReq("/studio/tpl/arena.jpg", SID), tenv, {});
  const tp = await worker.fetch(cookieReq("/studio/tpl/tape1.png", SID), tenv, {});
  check("texture plates are served from the private assets by a strict name allowlist",
    tj.status === 200 && tj.headers.get("content-type") === "image/jpeg" && tp.headers.get("content-type") === "image/png"
    && (await worker.fetch(cookieReq("/studio/tpl/..%2Flib%2Fx.jpg", SID), tenv, {})).status === 404
    && (await worker.fetch(cookieReq("/studio/tpl/x.svg", SID), tenv, {})).status === 404
    && (await worker.fetch(cookieReq("/studio/tpl/arena.jpg", SID), STUDIO_ENV, {})).status === 503);
  const gate = await worker.fetch(req("/studio/templates"), STUDIO_ENV, {});
  const gateHtml = await gate.text();
  const open = await worker.fetch(cookieReq("/studio/templates", SID), STUDIO_ENV, {});
  const openHtml = await open.text();
  check("the templates page is behind the same gate: the login page without a cookie, the page with one",
    gate.status === 200 && gateHtml === _test.LOGIN_HTML && openHtml === _test.POSTER_HTML
    && open.headers.get("content-security-policy") === _test.STUDIO_CSP);
  check("signing in reloads the page it was asked for (/studio or /studio/templates) without naming either",
    /location\.replace\(location\.pathname\)/.test(_test.LOGIN_HTML) && !/templates/.test(_test.LOGIN_HTML));
  check("the studio links to the templates page",
    /<a class="tpl-link" href="\/studio\/templates">Templates<\/a>/.test(STUDIO_HTML));

  const P = _test.POSTER_HTML;
  const psrc = readFileSync(new URL("./poster_page.js", import.meta.url), "utf8");
  const pbody = psrc.slice(psrc.indexOf("export const POSTER_HTML = `") + 28, psrc.lastIndexOf("`;"));
  const pscript = P.slice(P.indexOf("<script>") + 8, P.lastIndexOf("</script>"));
  check("templates page: the inline script parses", (() => { try { new Function(pscript); return true; } catch (e) { return false; } })());
  check("templates page: the template literal holds no backslash, backtick or dollar-brace (the studio_page.js trap)",
    pbody.indexOf(String.fromCharCode(92)) === -1 && pbody.indexOf("`") === -1 && pbody.indexOf("${") === -1);
  check("templates page: ASCII only", /^[\x09\x0A\x0D\x20-\x7E]*$/.test(pbody));
  check("templates page: no channel name or logo on any poster (owner law)", !/iboyprime|watermark|logo\.png/i.test(P));
  check("templates page: no betting language anywhere (owner law)", !/\b(odds|betting|bet|parlay|sportsbook|wager|favou?rite to win)\b/i.test(P));
  check("templates page: it only talks to its own origin (no external fetch or script)",
    !/fetch\("https?:/.test(pscript) && !/<script[^>]+src=/.test(P));
  const ids = (pscript.match(/def\(\{\s*id: "([a-z0-9]+)"/g) || []).map(s => s.replace(/[^]*"([a-z0-9]+)"$/, "$1"));
  const NEW_TPLS = ["headline", "pop", "split", "cards", "titlecards", "photocard"];
  check("templates page: twenty templates (the fourteen plus the six approved looks), unique ids, each with a draw(), and no Breaking template (owner verdict)",
    ids.length === 20 && new Set(ids).size === 20 && (pscript.match(/draw: function \(\)/g) || []).length === 20
    && ids.indexOf("breaking") === -1 && NEW_TPLS.every(id => ids.indexOf(id) !== -1));
  check("templates page: the painted edge light is still inside the silhouette only (no outer glow, no bloom) and it defaults to OFF",
    /var lam = \(nx \* lx \+ ny \* ly\) \/ dist;/.test(pscript) && /x\.globalCompositeOperation = "destination-in"; x\.drawImage\(hl\.c, 0, 0\);/.test(pscript)
    && !/function rimLayers/.test(pscript) && !/bloom = mkCanvas/.test(pscript)
    && /fx: \{ glow: [0-9.]+, rim: 0, /.test(pscript) && /if \(d\.v === 1\) \{[^}]*f\.fx\.rim = 0;/.test(pscript)
    && /var rimK = 2\.3 \* \(o\.rim == null \? 1 : o\.rim\) \* \(doc\.fx\.rim \|\| 0\);/.test(pscript));
  check("templates page: never a red-versus-blue scheme (owner law)",
    !/CORNER|corners|"red"|"blue"|Red corner|Blue corner/.test(pscript));
  check("templates page: ONE theme list - ember (the default) first, pink, violet, gold, crimson, toxic; no blue ice, no mono",
    /var THEME_IDS = \["ember", "pink", "violet", "gold", "crimson", "toxic"\];/.test(pscript)
    && /var VIVID_ORDER = \["ember", "pink", "violet", "gold", "crimson", "toxic"\];/.test(pscript)
    && /tpl: "headline", size: "1x1", theme: "ember",/.test(pscript)
    && !/id: "ice"|"Ice"|id: "mono"/.test(pscript) && /if \(THEME_IDS\.indexOf\(f\.theme\) === -1\) f\.theme = "ember";/.test(pscript)
    && /function vividTheme\(id\) \{ return VIVID_THEMES\[themeById\(id\)\.id\]/.test(pscript));
  check("templates page: the looks are the approved grades (carved, gritty, pop, vivid, natural); the old darkening grade is gone",
    /\{ id: "carved",\s+name: "Carved",\s+mode: "color" \}/.test(pscript) && /\{ id: "gritty",\s+name: "Gritty",\s+mode: "mono" \}/.test(pscript)
    && /\{ id: "pop",\s+name: "Color pop",\s+mode: "pop" \}/.test(pscript) && /\{ id: "vivid",\s+name: "Vivid",\s+mode: "vivid" \}/.test(pscript)
    && /\{ id: "natural",\s+name: "Natural",\s+mode: "natural" \}/.test(pscript)
    && !/function gradePixels|function gradedOf|TILE_LOOK|id: "scene"|id: "noir"/.test(pscript));
  check("templates page: the approved ports are pasted whole (grade_gritty as gritFactory, grade_vivid as vividLib, the card canvas)",
    /function gritFactory\(\) \{/.test(pscript) && /var GRIT = gritFactory\(\);/.test(pscript) && /function vividLib\(\) \{/.test(pscript)
    && /var GVL = vividLib\(\);/.test(pscript) && /function gradeSubject\(img, mode, opts\)/.test(pscript) && /function gradeVivid\(img, opts\)/.test(pscript)
    && /function drawVividV1\(ctx, W, H, th, dark, d\)/.test(pscript) && !/module\.exports/.test(pscript));
  check("templates page: the light-ground card title is held to 3.5:1 (drawVividV1/V2/V3 pass minContrast)",
    /var VC_TITLE_MIN = 3\.5;/.test(pscript) && (pscript.match(/minContrast: VC_TITLE_MIN/g) || []).length === 3);
  check("templates page: small type is solid, only display type gets a gradient",
    /var small = Math\.abs\(y1 - y0\) < 46;/.test(pscript) && /else if \(cap < 46\) fill = o\.white \? "#FFFFFF" : R\.pal\.a;/.test(pscript));
  check("templates page: cut-outs reach the grade PRISTINE (no in-place defringe; the grades defringe themselves) and meter on the neck-hooked face box",
    !/defringe\(a\.img\)/.test(pscript) && /var nk = GRIT\.neckFromRows\(rows, y0, hw\);/.test(pscript) && /a\.fbox = GRIT\.faceFromHead\(a\.head, a\.w, a\.h\);/.test(pscript)
    && /x\.drawImage\(a\.im, rx \* k, ry \* k, rw \* k, rh \* k, 0, 0, ow, oh\);/.test(pscript));
  check("templates page: the heavy grades run in a Web Worker built from a blob of the page's own library source",
    /URL\.createObjectURL\(new Blob\(\[workerSource\(\)\], \{ type: "text\/javascript" \}\)\)/.test(pscript) && /new Worker\(GW\.url\)/.test(pscript)
    && /"var GRIT = \(" \+ gritFactory\.toString\(\) \+ "\)\(\);"/.test(pscript) && /vividLib\.toString\(\)/.test(pscript) && /runJob\.toString\(\)/.test(pscript));
  check("templates page: an export uses EXACT grades only and waits for them (never ships the fast preview)",
    /out = renderTo\(c\.getContext\("2d"\), t, \{ editor: false, exact: true, capK: capK \}\);/.test(pscript)
    && /waitKeys\(out\.pending\)\.then\(attempt\);/.test(pscript)
    && /if \(R\.exact\) \{\s*var ex = subjectJob\(a, sp, false, 0, null\);/.test(pscript)
    && /\$\("dlBtn"\)\.addEventListener\("click", function \(\) \{[^]*?exportBlob\(id0\)/.test(pscript)
    && /var b0 = this, p = exportBlob\(doc\.tpl\);/.test(pscript) && /png: function \(id\) \{ return exportBlob\(id\); \}/.test(pscript));
  check("templates page: the cut-out client posts the raw photo to /studio/api/cutout and caches by the photo's SHA-256",
    /fetch\("\/studio\/api\/cutout", \{ method: "POST", credentials: "same-origin", body: blob,/.test(pscript)
    && /crypto\.subtle\.digest\("SHA-256", buf\)/.test(pscript) && /hash = "cut:" \+ String\(h\)\.slice\(0, 40\);/.test(pscript)
    && /return idbGet\(hash\)\.then\(function \(cached\) \{\s*if \(!cached\) return fresh\(\);/.test(pscript)
    && /function fresh\(\) \{\s*return cutRequest\(b\)/.test(pscript));
  check("templates page: a photo dropped on a fighter slot is cut out automatically; the photo stays until the cut-out swaps in",
    /if \(need && !a\.cut\) \{ commitNow\(\); cutInto\(\{ id: h\.id, kind: sd\.kind, tpl: tid0 \}, a, need\); return; \}/.test(pscript)
    && /else if \(slotKey\(t\.id, t\.tpl\) === a\.key\) \{ setSlot\(t\.id, c\.key, t\.tpl\);/.test(pscript) && / The photo stays as it was\./.test(pscript));
  check("templates page: every new template fills itself from the fight data (fighters, opponents' headshots, the main card)",
    /from: "A\.opp0"/.test(pscript) && /from: "A\.opp1"/.test(pscript) && /from: "card\.other"/.test(pscript)
    && /if \(doc\.cardsAuto\) autoCards\(\);/.test(pscript) && /P\.opps\[i\] = a\.key;/.test(pscript));
  check("templates page: head placement votes three measures (chin, crown, frame) and takes the median",
    /var vote = \[maxW, crown, shoulder \/ 2\.6\]\.sort/.test(pscript));
  // the text helpers, pulled out of the page and run
  const grab = (name) => {
    const i = pscript.indexOf("function " + name + "(");
    let d = 0, j = pscript.indexOf("{", i);
    for (let k = j; k < pscript.length; k++) { if (pscript[k] === "{") d++; else if (pscript[k] === "}") { d--; if (!d) return pscript.slice(i, k + 1); } }
    return "";
  };
  const H = new Function("var NL = String.fromCharCode(10);" + ["toks", "untoks", "slugify", "splitName", "plain"].map(grab).join("\n")
    + " return { toks: toks, untoks: untoks, slugify: slugify, splitName: splitName, plain: plain };")();
  const tk = H.toks("I was *robbed.* Big *two words* here");
  check("templates page: *stars* mark highlighted words, a run can span words, punctuation stays",
    tk.map(t => (t.hot ? "+" : "") + t.t).join(" ") === "I was +robbed. Big +two +words here");
  check("templates page: tap-to-highlight rebuilds the same markup it read",
    ["I was *robbed.*", "*WHO* wins", "a *b c* d", "x" + String.fromCharCode(10) + "*y*"].every(s => H.untoks(H.toks(s)) === s));
  check("templates page: names become UFC slugs (accents and apostrophes dropped)",
    H.slugify("Jiri Prochazka") === "jiri-prochazka" && H.slugify("Lone'er  Kavanagh") === "loneer-kavanagh"
    && H.slugify("J" + String.fromCharCode(237) + "ri Proch" + String.fromCharCode(225) + "zka") === "jiri-prochazka");
  check("templates page: surname particles stay with the surname",
    H.splitName("Dricus Du Plessis").last === "Du Plessis" && H.splitName("Ian Machado Garry").last === "Machado Garry"
    && H.splitName("Alex Pereira").first === "Alex");
  // the grade worker's own source, rebuilt exactly as workerSource() does, and run here (node)
  {
    const wsrc = ["var GRIT = (" + grab("gritFactory") + ")();", ...["clamp", "lerp", "smooth", "boxBlur", "vividLib"].map(grab),
      "var GVL = vividLib();", grab("runJob"), "return runJob;"].join("\n");
    let runJob = null, err = "";
    try { runJob = new Function(wsrc)(); } catch (e) { err = String(e && e.message || e); }
    check("templates page: the worker source is self-contained (the two libraries + runJob + four page helpers)", !!runJob, err);
    if (runJob) {
      // a small synthetic cut-out: a head-and-shoulders ellipse pair on transparency
      const w = 96, h = 120, px = new Uint8ClampedArray(w * h * 4);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const o = (y * w + x) * 4, head = ((x - 48) / 18) ** 2 + ((y - 34) / 22) ** 2 < 1, body = ((x - 48) / 42) ** 2 + ((y - 120) / 58) ** 2 < 1;
        const inside = head || body;
        px[o] = 190 + ((x * 7 + y * 3) % 23); px[o + 1] = 140 + ((x * 5) % 17); px[o + 2] = 120 + ((y * 3) % 13); px[o + 3] = inside ? 255 : 0;
      }
      const sub = runJob({ type: "subject", rgba: new Uint8ClampedArray(px), w, h, mode: "color", px: 1.6875, face: [34, 16, 28, 36], upscale: 1, seed: 7 });
      const mono = runJob({ type: "subject", rgba: new Uint8ClampedArray(px), w, h, mode: "mono", px: 1.6875, face: [34, 16, 28, 36], upscale: 1, seed: 7, fast: true });
      const viv = runJob({ type: "subject", rgba: new Uint8ClampedArray(px), w, h, mode: "vivid", px: 1.6875, face: [34, 16, 28, 36], upscale: 1, seed: 7 });
      const plate = runJob({ type: "plate", rgba: new Uint8ClampedArray(px.map((v, i) => i % 4 === 3 ? 255 : v)), w, h, theme: "violet", px: 1.6875, seed: 11 });
      const ins = runJob({ type: "inset", src: "head", rgba: new Uint8ClampedArray(px), w, h, d: 80, tone: 0.4, seed: 21, mode: "inset", px: 1.6875, upscale: 1 });
      const grey = (b) => { let s = 0, n = 0; for (let i = 0; i < b.length; i += 4) if (b[i + 3] > 200) { s += Math.abs(b[i] - b[i + 1]) + Math.abs(b[i + 1] - b[i + 2]); n++; } return s / Math.max(1, n); };
      check("the worker grades a cut-out (carved colour, gritty mono, vivid): same size, the matte kept, mono is grey",
        sub.w === w && sub.h === h && sub.rgba.length === w * h * 4 && sub.rgba[3] === 0 && sub.rgba[(40 * w + 48) * 4 + 3] > 200
        && mono.rgba.length === w * h * 4 && grey(mono.rgba) < 4 && grey(sub.rgba) > 8 && viv.rgba.length === w * h * 4);
      let hmax = 0; for (let i = 0; i < plate.rgba.length; i += 4) { const r = plate.rgba[i], b = plate.rgba[i + 2]; if (b > r) hmax++; }
      check("the worker grades a plate into the theme (opaque, violet leans blue-red, never grey)", plate.rgba[3] === 255 && hmax > plate.rgba.length / 8);
      check("the worker builds a circle inset (the circle, a ring and a shadow margin)", ins.w === ins.h && ins.w > 80 && ins.m === Math.round(80 * 0.14));
    }
  }
  // the cut-out client's answer to every status the Worker route can give
  {
    const CM = new Function(grab("cutMessage") + " return cutMessage;")();
    const ms = [413, 415, 429, 502, 503].map(st => CM(st, {}));
    check("templates page: the cut-out client has a clear message for 413, 415, 429, 502 and 503 (and keeps the photo)",
      ms.every(m => typeof m === "string" && m.length > 20) && new Set(ms).size === 5
      && /10 MB/.test(ms[0]) && /JPEG, PNG, WebP or AVIF/.test(ms[1]) && /not switched on/.test(ms[4])
      && CM(429, { error: "Today's cut-out limit (100) is reached." }) === "Today's cut-out limit (100) is reached."
      && CM(502, { error: "This month's free Cloudflare background removals (5,000) are used up." }).indexOf("5,000") > 0
      && CM(503, { error: "cutout not configured" }) === ms[4] && /HTTP 500/.test(CM(500, {})));
  }
  // ===== Sept 25 2026 review fixes: the behaviour, run here (node) =====
  // the export: exact grades only, a failed grade retried and then REFUSED, never a preview or an
  // ungraded image in its place; it waits for a cut-out that is still running; a quote template
  // refuses its sample quote
  await (async () => {
    const src = ["settle", "waitSources", "waitKeys", "mustEditMsg", "joinNames", "exportCanvas", "fieldOf"].map(grab).join("\n");
    const mk = new Function(`
      var W = 1080, H = 1080, R = null, cv = { height: 1080 }, JOBS = {}, jobFails = {}, plateImg = {}, plateTries = {}, plateWait = {};
      var cutBusy = {}, upgrading = {}, notes = [], renders = [], script = null;
      var TPL = { t1: { id: "t1" }, q: { id: "q", mustEdit: ["quote"], fields: [{ id: "quote", label: "Quote" }] } };
      var doc = { tpl: "t1", text: {} };
      function mkCanvas() { return { canvas: true, getContext: function () { return {}; } }; }
      function plate() { }
      function exportNote(m) { notes.push(m); }
      function jobsDone(keys) { return Promise.resolve(); }
      function renderTo(ctx, t, o) { renders.push({ t: t.id, capK: o.capK, exact: o.exact, at: Date.now() }); return script(renders.length, o); }
      ${src}
      return { exportCanvas: exportCanvas, set: function (f) { script = f; renders.length = 0; }, renders: renders, JOBS: JOBS, cutBusy: cutBusy, doc: doc, notes: notes };`);
    const X = mk();
    // a key that always fails: two retries (the second on a smaller working size), then refused
    X.set(() => { X.JOBS.k1 = { st: "err" }; return { pending: [], failed: ["k1"], failedLabels: ["Fighter"], error: "" }; });
    let msg = "";
    await X.exportCanvas("t1").then(() => { msg = "RESOLVED"; }, (e) => { msg = e.message; });
    check("export: a grade that keeps failing is retried twice (the second time smaller) and then REFUSED with the slot's name",
      /full-quality grade failed for Fighter[.] Nothing was exported/.test(msg) && X.renders.length === 3
      && X.renders[0].capK === 1 && X.renders[2].capK === 0.6 && X.renders.every((r) => r.exact === true), msg + " / renders " + X.renders.length);
    // a key that fails once and then lands: exported
    X.set((n) => n === 1 ? { pending: [], failed: ["k2"], failedLabels: ["Card 1"], error: "" } : { pending: [], failed: [], failedLabels: [], error: "" });
    const c2 = await X.exportCanvas("t1").catch((e) => e);
    check("export: a grade that fails once and then lands is exported (after one retry)", c2 && c2.canvas === true && X.renders.length === 2);
    // a draw error never becomes a PNG with an error banner
    X.set(() => ({ pending: [], failed: [], failedLabels: [], error: "boom" }));
    msg = ""; await X.exportCanvas("t1").then(() => { msg = "RESOLVED"; }, (e) => { msg = e.message; });
    check("export: a draw error rejects (no render-error banner is ever shipped)", /could not be drawn [(]boom[)]/.test(msg), msg);
    // pending keys are waited for, then the export renders again
    X.set((n) => n === 1 ? { pending: ["k3"], failed: [], failedLabels: [], error: "" } : { pending: [], failed: [], failedLabels: [], error: "" });
    const c3 = await X.exportCanvas("t1").catch((e) => e);
    check("export: it waits for the exact grades still pending and renders again", c3 && c3.canvas === true && X.renders.length === 2);
    // a cut-out still running is waited for BEFORE anything renders
    let release; X.cutBusy.p1 = new Promise((r) => { release = r; });
    X.set(() => ({ pending: [], failed: [], failedLabels: [], error: "" }));
    const tA = Date.now(), pA = X.exportCanvas("t1");
    await new Promise((r) => setTimeout(r, 60));
    const before = X.renders.length;
    release(); delete X.cutBusy.p1;
    await pA;
    check("export: it waits for a cut-out that is still running before it renders (never the uncut photo)",
      before === 0 && X.renders.length === 1 && X.renders[0].at - tA >= 50 && X.notes.some((m) => /cut-out/.test(m || "")));
    // the sample quote is never exported
    X.set(() => ({ pending: [], failed: [], failedLabels: [], error: "" }));
    msg = ""; await X.exportCanvas("q").then(() => { msg = "RESOLVED"; }, (e) => { msg = e.message; });
    X.doc.text.q = { quote: "I WILL KNOCK HIM OUT" };
    const okQ = await X.exportCanvas("q").then(() => true, () => false);
    check("export: a quote template refuses its sample quote, and exports once the owner has typed one",
      /Type the real quote first/.test(msg) && X.renders.length === 1 && okQ, msg);
  })();
  check("export: the drawing paths never put a preview or an ungraded image into an export",
    /if \(!used && R\.exact\) return null;/.test(pscript) && /else if \(!R\.exact && lastRes\[tag\] && lastRes\[tag\]\.a === a\) used = lastRes\[tag\];/.test(pscript)
    && /if \(!res && R\.exact\) return 1;/.test(pscript) && /\/\/ an export never draws the ungraded source in its place[^]{0,120}if \(R\.exact\) return;/.test(pscript)
    && /R\.error = String\(\(e && e\.message\) \|\| e\);/.test(pscript)
    && /exportBlob\(id0\)/.test(pscript) && /a\.download = id0 \+ "-" \+ stamp\(\) \+ "\.png";/.test(pscript));
  check("export: it also waits for a UFC master still downloading and for a texture still loading (or fetches it again)",
    /upgrading\[key\] = fetchBlob\(big\)/.test(pscript) && /exportNote\("Fetching the full-size cut-out\.\.\."\)/.test(pscript)
    && /function texNeed\(name\)/.test(pscript) && /setTimeout\(attempt, 5000 \* Math\.pow\(2, plateTries\[name\] - 1\)\)/.test(pscript));
  check("a failed grade is retried at 15, 30 and 60 s and then left alone (never a multi-GB job every 15 s)",
    /if \(nf <= 3 && Date\.now\(\) - \(e\.t \|\| 0\) > 15000 \* Math\.pow\(2, nf - 1\)\)/.test(pscript));
  check("an iPhone (no navigator.deviceMemory, a coarse pointer) grades small and one job at a time",
    /var LOW_MEM = \(function \(\) \{[^]*?if \(dm\) return dm < 4;[^]*?\(navigator\.maxTouchPoints \|\| 0\) > 1 && coarse;/.test(pscript)
    && /GW\.max = hc >= 4 && !LOW_MEM \? 2 : 1;/.test(pscript) && /MAX_GRADE_PX = LOW_MEM \? 900000 : 1500000/.test(pscript));

  // the card grade's head geometry: a curly or spiky crown made GVL.headGeometry measure a head a
  // few px wide (Payton Talbott: 6.6 px at 1800 px tall) and the card scaled the image ~30x
  {
    const wsrc = ["var GRIT = (" + grab("gritFactory") + ")();", ...["clamp", "lerp", "smooth", "boxBlur", "vividLib"].map(grab),
      "var GVL = vividLib();", grab("runJob"), "return { runJob: runJob, GVL: GVL };"].join("\n");
    const L = new Function(wsrc)();
    const w = 300, h = 900, px = new Uint8ClampedArray(w * h * 4), A = new Float32Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const head = ((x - 150) / 48) ** 2 + ((y - 110) / 62) ** 2 < 1, neck = Math.abs(x - 150) < 26 && y > 160 && y < 200;
      const body = ((x - 150) / 110) ** 2 + ((y - 520) / 330) ** 2 < 1 && y > 190;
      let tuft = false;
      for (const tx of [118, 131, 144, 157, 170, 183]) if (x >= tx && x < tx + 3 && y >= 30 && y < 56) tuft = true;
      const on = head || neck || body || tuft, o = (y * w + x) * 4;
      px[o] = 200; px[o + 1] = 150; px[o + 2] = 125; px[o + 3] = on ? 255 : 0; A[y * w + x] = on ? 1 : 0;
    }
    const gm = L.GVL.headGeometry(A, w, h);
    const job = (hint) => L.runJob({ type: "card", rgba: new Uint8ClampedArray(px), w, h, kind: "head", cw: 296, ch: 316, headFrac: 0.6, topFrac: 0.065,
      below: null, debelt: true, mode: "vivid", px: 1.6875, hint });
    const c1 = job({ hw: 100, lo: 0.85, hi: 1.25 }), c0 = job(null);
    check("card geometry: a spiky crown still fools the ported headGeometry (the case the page must catch)", gm && gm.hw < 10, JSON.stringify(gm));
    check("card geometry: the page's head hint replaces a head under half of it, and the card is framed at a sane scale",
      c1.hw === 100 && c1.fixed === true && c1.w === 296 && c1.h === 316 && c1.f32.length === 296 * 316 * 4, c1.hw);
    check("card geometry: with no hint the scale is still bounded (3x at most, 12 Mpx at most)", c0.hw >= 1.25 * 0.6 * 296 / 3 - 1e-6 && c0.fixed === true, c0.hw);
    // a sane head is left exactly as the ported code measures it (the approved V1 / V2 framing)
    const w2 = 200, h2 = 300, p2 = new Uint8ClampedArray(w2 * h2 * 4);
    for (let y = 0; y < h2; y++) for (let x = 0; x < w2; x++) {
      const on = ((x - 100) / 44) ** 2 + ((y - 70) / 58) ** 2 < 1 || (((x - 100) / 95) ** 2 + ((y - 300) / 150) ** 2 < 1), o = (y * w2 + x) * 4;
      p2[o] = 190; p2[o + 1] = 140; p2[o + 2] = 120; p2[o + 3] = on ? 255 : 0;
    }
    const A2 = new Float32Array(w2 * h2); for (let q = 0; q < A2.length; q++) A2[q] = p2[q * 4 + 3] / 255;
    const g2 = L.GVL.headGeometry(A2, w2, h2);
    const s2 = L.runJob({ type: "card", rgba: p2, w: w2, h: h2, kind: "head", cw: 296, ch: 316, headFrac: 0.6, topFrac: 0.065, below: null,
      debelt: true, mode: "vivid", px: 1.6875, hint: { hw: g2.hw * 1.1, lo: 0.5, hi: 2.0 } });
    check("card geometry: a sane head keeps the ported measure (hint inside the band changes nothing)", s2.hw === g2.hw && !s2.fixed, s2.hw + " vs " + g2.hw);

    // owner law 1 in the vivid grades: a saturated blue kit on crimson, a saturated red kit on violet
    const W3 = 120, H3 = 200, kit = (rgb) => {
      const b = new Uint8ClampedArray(W3 * H3 * 4);
      for (let y = 0; y < H3; y++) for (let x = 0; x < W3; x++) {
        const o = (y * W3 + x) * 4, head = ((x - 60) / 22) ** 2 + ((y - 40) / 28) ** 2 < 1, body = y > 80 && Math.abs(x - 60) < 50;
        if (head) { b[o] = 205; b[o + 1] = 155; b[o + 2] = 130; b[o + 3] = 255; } else if (body) { b[o] = rgb[0]; b[o + 1] = rgb[1]; b[o + 2] = rgb[2]; b[o + 3] = 255; }
      }
      return b;
    };
    const satAt = (bytes, x0, y0, x1, y1, stride) => {
      let s = 0, n = 0;
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
        const o = (y * stride + x) * 4, r = bytes[o], g = bytes[o + 1], b = bytes[o + 2], mx = Math.max(r, g, b), mn = Math.min(r, g, b);
        if (bytes[o + 3] < 128) continue; s += mx ? (mx - mn) / mx : 0; n++;
      }
      return s / Math.max(1, n);
    };
    const face = [38, 12, 44, 56];
    const blue = kit([30, 70, 220]), red = kit([215, 25, 45]);
    const vb0 = L.runJob({ type: "subject", rgba: new Uint8ClampedArray(blue), w: W3, h: H3, mode: "vivid", px: 1.6875, face, upscale: 1, seed: 7 });
    const vb1 = L.runJob({ type: "subject", rgba: new Uint8ClampedArray(blue), w: W3, h: H3, mode: "vivid", px: 1.6875, face, upscale: 1, seed: 7, guard: "crimson" });
    check("law 1: a saturated blue kit keeps its colour in the vivid grade on ember, and is muted under .3 on crimson",
      satAt(vb0.rgba, 20, 120, 100, 190, W3) > 0.5 && satAt(vb1.rgba, 20, 120, 100, 190, W3) < 0.3,
      satAt(vb0.rgba, 20, 120, 100, 190, W3).toFixed(3) + " / " + satAt(vb1.rgba, 20, 120, 100, 190, W3).toFixed(3));
    const vr1 = L.runJob({ type: "subject", rgba: new Uint8ClampedArray(red), w: W3, h: H3, mode: "vivid", px: 1.6875, face, upscale: 1, seed: 7, guard: "violet" });
    const vr0 = L.runJob({ type: "subject", rgba: new Uint8ClampedArray(red), w: W3, h: H3, mode: "vivid", px: 1.6875, face, upscale: 1, seed: 7 });
    let faceSame = true;
    for (let y = 20; y < 55; y++) for (let x = 45; x < 75; x++) { const o = (y * W3 + x) * 4; if (vr0.rgba[o] !== vr1.rgba[o] || vr0.rgba[o + 1] !== vr1.rgba[o + 1]) faceSame = false; }
    check("law 1: a saturated red kit on violet is muted under .3, and the face is left exactly as it was",
      satAt(vr0.rgba, 20, 120, 100, 190, W3) > 0.5 && satAt(vr1.rgba, 20, 120, 100, 190, W3) < 0.3 && faceSame,
      satAt(vr1.rgba, 20, 120, 100, 190, W3).toFixed(3));
    const cc = L.runJob({ type: "card", rgba: new Uint8ClampedArray(blue), w: W3, h: H3, kind: "head", cw: 150, ch: 200, headFrac: 0.5, topFrac: 0.06,
      below: null, debelt: false, mode: "vivid", px: 1.6875, guard: "crimson" });
    const ccb = new Uint8ClampedArray(cc.f32.length); for (let q = 0; q < ccb.length; q++) ccb[q] = cc.f32[q] * 255;
    check("law 1: the card grade mutes a blue kit on crimson too", satAt(ccb, 10, 150, 140, 198, 150) < 0.3, satAt(ccb, 10, 150, 140, 198, 150).toFixed(3));
    const rgbOf = (b) => { const o = new Uint8Array(W3 * H3 * 3); for (let q = 0; q < W3 * H3; q++) { o[q * 3] = b[q * 4]; o[q * 3 + 1] = b[q * 4 + 1]; o[q * 3 + 2] = b[q * 4 + 2]; } return o; };
    const redOpaque = new Uint8ClampedArray(red); for (let q = 3; q < redOpaque.length; q += 4) { if (!redOpaque[q]) { redOpaque[q - 3] = 40; redOpaque[q - 2] = 40; redOpaque[q - 1] = 44; } redOpaque[q] = 255; }
    const ph = L.runJob({ type: "photo", rgb: rgbOf(redOpaque), w: W3, h: H3, mask: null, ow: W3, oh: H3, box: [45, 20, 75, 55], mode: "vivid", guard: "violet" });
    check("law 1: the photo card mutes a red kit on violet", satAt(ph.rgba, 20, 120, 100, 190, W3) < 0.3, satAt(ph.rgba, 20, 120, 100, 190, W3).toFixed(3));
  }
  // the theme list decides which guard a grade needs (and only then carries the theme in its key)
  {
    const G = new Function("var R = null, doc = { theme: 'ember' }; var GRIT = { THEMES: { ember: { hue: 28 }, pink: { hue: 334 }, violet: { hue: 280, cool: true }, gold: { hue: 40 }, crimson: { hue: 355 }, toxic: { hue: 142 } }, isCool: function (id) { return !!this.THEMES[id].cool; } };"
      + grab("themeGuardKind") + grab("guardTheme") + " return { k: themeGuardKind, g: function (th, m) { doc.theme = th; return guardTheme(m); } };")();
    check("law 1: violet guards reds in every colour look, crimson guards blue in the vivid look, ember / pink / gold / toxic need nothing",
      G.k("violet") === "cool" && G.k("crimson") === "hot" && ["ember", "pink", "gold", "toxic"].every((t) => G.k(t) === "")
      && G.g("violet", "vivid") === "violet" && G.g("violet", "color") === "violet" && G.g("violet", "mono") === null
      && G.g("crimson", "vivid") === "crimson" && G.g("crimson", "color") === null && G.g("ember", "vivid") === null);
  }
  // a cut-out is hit by its matte; circles and text win over cut-outs, background photos lose to both
  {
    const Hs = new Function("var lastR = null; var DROPPABLE = ['photo', 'cut', 'circle', 'tile', 'bout', 'card']; var HIT_TIER = { text: 0, circle: 0, rows: 0, cut: 1, card: 1, tile: 1, bout: 1, photo: 2 };"
      + grab("inShape") + grab("hitAt") + " return { inShape: inShape, hitAt: hitAt, set: function (h) { lastR = { hits: h }; }, drop: DROPPABLE };")();
    const al = { w: 10, h: 10, q: 0.01, a: new Float32Array(100) };
    al.a[5 * 10 + 5] = 1;                           // the fighter covers only the middle of the canvas
    const cut = { id: "hero", kind: "cut", shape: { r: [0, 0, 1000, 1000], al } };
    Hs.set([{ id: "bg", kind: "photo", shape: { r: [0, 0, 1000, 1000] } }, { id: "ins1", kind: "circle", shape: { c: [800, 200, 100] } }, cut]);
    check("hit test: a point in the cut-out's rectangle but outside its matte is not the fighter", Hs.inShape(cut.shape, 100, 100) === false && Hs.inShape(cut.shape, 550, 550) === true);
    check("hit test: a circle drawn BEFORE the hero still takes its own clicks and drops; the background plate is reachable",
      Hs.hitAt(800, 200).id === "ins1" && Hs.hitAt(550, 550).id === "hero" && Hs.hitAt(100, 100).id === "bg"
      && Hs.hitAt(800, 200, ["photo", "cut", "circle"]).id === "ins1");
    Hs.set([{ id: "bg", kind: "photo", shape: { r: [0, 0, 1000, 1000] } }, { id: "hero", kind: "cut", shape: { r: [100, 100, 600, 800], empty: true } }]);
    check("hit test: an EMPTY fighter slot takes a dropped photo, but a press there drags the background",
      Hs.hitAt(300, 300, Hs.drop).id === "hero" && Hs.hitAt(300, 300).id === "bg" && Hs.hitAt(300, 300, ["photo", "cut", "circle"]).id === "bg");
  }
  // an owner-dropped image belongs to ONE template; an old doc's bare slots move to the open one
  {
    const M = new Function("var TPL = { headline: {}, pop: {}, faceoff: {} }, THEME_IDS = ['ember', 'pink', 'violet', 'gold', 'crimson', 'toxic'];"
      + grab("freshDoc") + grab("mergeDoc") + " return mergeDoc;")();
    const d = M({ v: 2, tpl: "pop", slots: { hero: "a1", "headline:ins1": "a2", left: "" }, frames: { hero: { x: 3, y: 0, s: 1 }, "card:0": { e: 0.2 } } });
    check("slots: a v2 doc's bare slot ids and frames move to the template that was open; scoped ones stay",
      d.slots["pop:hero"] === "a1" && d.slots["headline:ins1"] === "a2" && d.slots["pop:left"] === "" && !("hero" in d.slots)
      && d.frames["pop:hero"].x === 3 && d.frames["pop:card:0"].e === 0.2, JSON.stringify(d.slots));
    check("slots: every read and write goes through the template scope (Face-off's left fighter is not Tale of the tape's)",
      /function sk\(id, tid\) \{ return \(tid \|\| scopeTpl\(\)\) \+ ":" \+ id; \}/.test(pscript) && !/doc\.slots\[(id|h\.id|s\.id|t\.id|target|sel)\]/.test(pscript)
      && /var tid0 = doc\.tpl;/.test(pscript) && /scopeId = t\.id;/.test(pscript));
  }
  // the editor's composition cache: a stable signature, and only editor renders ever use it
  {
    const Sg = new Function(grab("sigMix") + " return sigMix;")();
    check("editor cache: the signature hash is deterministic and order sensitive",
      Sg(2166136261, "ab") === Sg(2166136261, "ab") && Sg(2166136261, "ab") !== Sg(2166136261, "ba") && Sg(Sg(1, "x"), "y") !== Sg(Sg(1, "y"), "x"));
    const Ds = new Function("var doc = { tpl: 'x', text: { a: 1 }, frames: { b: 2 }, fx: { expo: 0.3, glow: 0.4 }, slots: { 'x:hero': 'k' } };" + grab("docSig") + " return docSig;")();
    check("editor cache: the document signature leaves out only text, frames and the exposure nudge (they reach the pixels through hooked draws)",
      Ds() === JSON.stringify({ tpl: "x", fx: { glow: 0.4 }, slots: { "x:hero": "k" } }));
    check("editor cache: exports and thumbnails never use it, and a drawn image without a tag can only miss",
      /if \(o\.editor && !o\.exact && !o\.thumb && fxOn && CTX2D\) \{/.test(pscript) && /function tagOf\(o\) \{ return o && o\.__tag \? o\.__tag : "u" \+ \(\+\+utag\); \}/.test(pscript)
      && /if \(!R \|\| !R\.fxc \|\| R\.inFx\) \{ fn\(\); return; \}/.test(pscript));
  }
  // UFC event names: a family-name-first corner turned round by the headline; no name at all -> the slug
  {
    const N = new Function(grab("splitName") + grab("ufcSlugTitle") + grab("normalizeEvent") + grab("weightOf") + grab("cornerName")
      + " return { n: normalizeEvent, w: weightOf, c: cornerName };")();
    const ev = N.n({ headline: "Silva vs Wang", fights: [{ red: { first: "Natalia", last: "Silva", slug: "natalia-silva" }, blue: { first: "Wang", last: "Cong", slug: "wang-cong" } },
      { red: { first: "Roberto", last: "Soldic", slug: "roberto-soldic" }, blue: { first: "", last: "", slug: "khaos-williams" } }] });
    check("ufc names: a corner listed family name first follows the event headline (WANG on the posters, not CONG)",
      ev.fights[0].blue.last === "Wang" && ev.fights[0].blue.first === "Cong" && ev.fights[0].blue.swapped === true && ev.fights[0].red.last === "Silva");
    check("ufc names: a corner with no name at all is named from its slug (the bout is never dropped)",
      ev.fights[1].blue.first === "Khaos" && ev.fights[1].blue.last === "Williams" && N.c(ev.fights[1].blue) === "Khaos Williams");
    check("ufc names: the circle's 'another fighter' comes from the same weight class",
      N.w("Women's Flyweight Title Bout") === "women's flyweight" && N.w("Women's Flyweight Division") === "women's flyweight" && N.w("Bantamweight") !== N.w("Women's Flyweight"));
  }
  // a cut-out result is cached and linked only when it holds a clear subject
  {
    const U = new Function(grab("cutUsable") + " return cutUsable;")();
    check("cut-outs: an empty or near-full matte is never cached (a clear subject: a head and 1 - 97 % coverage)",
      U({ cut: true, head: {}, cover: 0.4 }) && !U({ cut: false, head: null, cover: 0 }) && !U({ cut: true, head: {}, cover: 0.005 }) && !U({ cut: true, head: {}, cover: 0.99 })
      && /if \(!c\) throw new Error\("Cloudflare found no clear subject in this photo\."\);\s*idbPut\(hash, png\);/.test(pscript)
      && /function gcCuts\(\)/.test(pscript) && /CUT_KEEP = 150/.test(pscript) && /function recut\(t, s\)/.test(pscript));
  }
  // the vivid card layouts: 8 cards keep the 6-card name plate; card titles fit their width
  {
    const VG = new Function(grab("vividGeom") + " return vividGeom;")();
    const g6 = VG("v1", 1080, 1080, 6), g8 = VG("v1", 1080, 1080, 8);
    check("cards: the 8-card grid keeps the 6-card name plate height (readable type at phone size) and still fits the canvas",
      g8.slots[0].plate[3] === g6.slots[0].plate[3] && g8.slots[7].plate[1] + g8.slots[7].plate[3] < 1080 && g8.card.h === 304);
    check("cards: every card title fits the width, solid under a 46 px cap (a long owner title never runs off the canvas)",
      (pscript.match(/minContrast: VC_TITLE_MIN, maxW: W - 96 \* s/g) || []).length === 3 && /if \(size \* 0\.86 < 46 \* s\) fill = o\.dark \? th\.da : th\.a;/.test(pscript));
  }
  // the photo edge ramp: only a real photo edge (a solid run at full resolution) fades a side
  check("cut-outs: a side counts as a photo edge only for a solid full-resolution run of 3 % of the height (UFC elbows never fade the arms)",
    /a\.touch\.l = sideRun\(a, 0\); a\.touch\.r = sideRun\(a, 1\);/.test(pscript) && /return best >= 0\.03 \* nh;/.test(pscript)
    && /if \(d\[y \* 8 \+ 3\] > 250 && d\[y \* 8 \+ 7\] > 250\)/.test(pscript));
  check("placement: the measured face box is lifted by its measured bias (.12 face heights), and a UFC master's face box is sanity-checked against the body height",
    /var FACE_BOX_BIAS = 0\.12;/.test(pscript) && /fcy = ftop \+ fb\[3\] \* s0 \* \(0\.5 - FACE_BOX_BIAS\)/.test(pscript) && /0\.080 \* a\.box\.h : 0;/.test(pscript));
  check("smooth skin: a colour grade on a face with little own texture drops the injected texture, grain and clarity",
    /var SKIN_ADAPT = \{ thr: 0\.02, tex: 0\.3, grain: 0\.5, up: 0, core: 2, K: 0\.6 \};/.test(pscript) && /if \(lc2 >= 0 && lc2 < J\.adapt\.thr\) \{/.test(pscript));
  check("card templates: no word chips where the words cannot be coloured; the quote templates' samples are placeholders",
    /var cw = el\("div", "chips"\), noChips = !!\(f\.plain \|\| t\.vivid\);/.test(pscript) && /var QUOTE_PH = "TYPE THE \*QUOTE\* HERE";/.test(pscript)
    && (pscript.match(/mustEdit: \["quote"\]/g) || []).length === 3 && /mustEdit: \["title", "quote"\]/.test(pscript));
  check("auto-fill: the card grid uses each fighter's UFC headshot (the approved V1 cards), and the photo card a chest crop framed by the head",
    /api\("\/studio\/api\/ufc\/" \+ encodeURIComponent\(c\.slug\) \+ "\?n=0"\)/.test(pscript) && /out\.push\(\{ a: c\.hd \|\| c\.a \|\| null/.test(pscript)
    && /cardRes\(a, "body", Math\.round\(rect\[2\] \/ k\), Math\.round\(rect\[3\] \/ k\), 0\.45, 0\.07, 2\.6, "photo"/.test(pscript));
  check("phone: the poster stays pinned above the editor, the header scrolls away",
    /\.stage\{position:sticky;top:0;z-index:25;/.test(P) && /\.top\{position:static;/.test(P));
}

// ----- background removal: POST /studio/api/cutout + the key-gated probe -----
// The IMAGES binding and the budget object are mocked; nothing reaches Cloudflare.
await (async () => {
  const zlib = await import("node:zlib");
  const { cutType, readCapped, pngInfo, pngTopRowClear, studioCutout, CUT_BYTES_MAX, CUT_PROBE_URL } = _test;
  const B = (arr) => new Uint8Array(arr);
  const asc = (s) => Array.from(s, c => c.charCodeAt(0));
  const pad = (a, n) => a.concat(new Array(Math.max(0, n - a.length)).fill(0));
  const JPEG = B(pad([0xFF, 0xD8, 0xFF, 0xE0, 0, 16].concat(asc("JFIF")), 64));
  const PNG_SIG = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
  const WEBP = B(pad(asc("RIFF").concat([40, 0, 0, 0]).concat(asc("WEBPVP8 ")), 64));
  const ftyp = (major, compat) => {
    const brands = [major, "\0\0\0\0"].concat(compat).map(asc).flat();
    const size = 8 + brands.length;
    return B(pad([0, 0, 0, size].concat(asc("ftyp")).concat(brands), 64));
  };
  const SVG = B(asc('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>'));
  const HTML = B(asc("<!doctype html><html><script>alert(1)</script></html>"));
  const GIF = B(pad(asc("GIF89a"), 64));

  // a real PNG, built here: RGBA rows, each prefixed with its filter byte, in two IDATs
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    return Buffer.concat([len, Buffer.from(type, "ascii"), Buffer.from(data), Buffer.alloc(4)]);
  };
  const filt = (raw, f, bpp) => {             // encode one row as the FIRST row of an image
    const out = Buffer.alloc(raw.length + 1); out[0] = f;
    for (let i = 0; i < raw.length; i++) {
      const left = i >= bpp ? raw[i - bpp] : 0;
      const pred = f === 1 || f === 4 ? left : f === 3 ? (left >> 1) : 0;
      out[i + 1] = (raw[i] - pred) & 255;
    }
    return out;
  };
  const makePng = (w, rows, opts) => {
    const o = opts || {};
    const ct = o.ct == null ? 6 : o.ct, bpp = ct === 6 ? 4 : ct === 2 ? 3 : 2;
    const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(rows.length, 4);
    ihdr[8] = 8; ihdr[9] = ct; ihdr[12] = o.interlace || 0;
    const raw = Buffer.concat(rows.map((r, i) => i === 0 ? filt(Buffer.from(r), o.f || 0, bpp)
                                                         : Buffer.concat([Buffer.from([0]), Buffer.from(r)])));
    const z = zlib.deflateSync(raw, { level: o.level == null ? 6 : o.level });
    const idats = [];
    if (o.split) { for (let p = 0; p < z.length; p += o.split) idats.push(chunk("IDAT", z.subarray(p, p + o.split))); }
    else { const cut = Math.min(7, z.length); idats.push(chunk("IDAT", z.subarray(0, cut)), chunk("IDAT", z.subarray(cut))); }
    return new Uint8Array(Buffer.concat([Buffer.from(PNG_SIG), chunk("IHDR", ihdr)].concat(idats)
      .concat([chunk("IEND", Buffer.alloc(0))])));
  };
  // top row: two clear pixels, two opaque; second row fully opaque
  const TOP = [10, 20, 30, 0, 40, 50, 60, 255, 70, 80, 90, 0, 100, 110, 120, 255];
  const SOLID = [1, 2, 3, 255, 4, 5, 6, 255, 7, 8, 9, 255, 10, 11, 12, 255];
  const OUT_PNG = makePng(4, [TOP, SOLID]);

  check("cutType names JPEG, PNG, WebP and AVIF by their magic numbers",
    cutType(JPEG) === "image/jpeg" && cutType(OUT_PNG) === "image/png" && cutType(WEBP) === "image/webp"
    && cutType(ftyp("avif", ["mif1", "miaf"])) === "image/avif" && cutType(ftyp("mif1", ["miaf", "avif"])) === "image/avif"
    && cutType(ftyp("avis", ["msf1"])) === "image/avif");
  check("cutType refuses SVG, HTML, GIF, HEIC, a RIFF that is not WebP, and scraps",
    cutType(SVG) === null && cutType(HTML) === null && cutType(GIF) === null
    && cutType(ftyp("heic", ["mif1", "heic"])) === null
    && cutType(B(pad(asc("RIFF").concat([4, 0, 0, 0]).concat(asc("WAVE")), 64))) === null
    && cutType(B([0xFF, 0xD8])) === null && cutType(null) === null && cutType("not bytes") === null);
  check("cutType never reads the ftyp minor-version slot as a brand",
    cutType(ftyp("heic", [])) === null && cutType((() => { const b = ftyp("heic", []); b.set(asc("avif"), 12); return b; })()) === null);

  const pi = pngInfo(OUT_PNG);
  check("pngInfo reads the header and finds every IDAT without inflating",
    pi && pi.width === 4 && pi.height === 2 && pi.colorType === 6 && pi.alpha === true && pi.idat.length === 2);
  const rgb = makePng(2, [[1, 2, 3, 4, 5, 6]], { ct: 2 });
  check("pngInfo: an RGB PNG has no alpha, and a non-PNG is null",
    pngInfo(rgb).alpha === false && pngInfo(JPEG) === null && pngInfo(SVG) === null);
  const clears = [];
  for (const f of [0, 1, 2, 3, 4]) clears.push(await pngTopRowClear(makePng(4, [TOP, SOLID], { f }), pngInfo(makePng(4, [TOP, SOLID], { f }))));
  check("pngTopRowClear undoes every row-0 filter (None, Sub, Up, Average, Paeth) and counts clear pixels",
    JSON.stringify(clears) === JSON.stringify([0.5, 0.5, 0.5, 0.5, 0.5]));
  check("pngTopRowClear: an opaque top row is 0, and RGB or interlaced files are null (not a guess)",
    await pngTopRowClear(makePng(4, [SOLID, TOP]), pngInfo(makePng(4, [SOLID, TOP]))) === 0
    && await pngTopRowClear(rgb, pngInfo(rgb)) === null
    && await pngTopRowClear(makePng(4, [TOP], { interlace: 1 }), pngInfo(makePng(4, [TOP], { interlace: 1 }))) === null);
  // a big incompressible PNG: only the start of the zlib stream is fed, the writer is
  // never closed, and the row still comes back (no hang, no truncation error)
  const noisy = [];
  for (let r = 0; r < 1200; r++) {
    const row = new Array(64 * 4);
    for (let i = 0; i < row.length; i++) row[i] = r === 0 && i % 4 === 3 ? (i < 128 ? 0 : 255) : (Math.random() * 256) | 0;
    noisy.push(row);
  }
  const bigPng = makePng(64, noisy, { level: 0, split: 16384 });
  const bigInfo = pngInfo(bigPng);
  const t0 = Date.now();
  const bigClear = await pngTopRowClear(bigPng, bigInfo);
  check("pngTopRowClear inflates only a prefix of a large PNG (writer never closed) and returns promptly",
    bigPng.length > 262144 && bigInfo.idat.length > 16 && bigClear === 0.5 && Date.now() - t0 < 1500);

  // readCapped counts what ARRIVES and cancels at the cap
  let pulls = 0, cancelled = false;
  const endless = new ReadableStream({
    pull(c) { pulls++; c.enqueue(new Uint8Array(1024 * 1024)); if (pulls > 40) c.close(); },
    cancel() { cancelled = true; },
  });
  const rc = await readCapped(endless, CUT_BYTES_MAX);
  check("readCapped stops at the cap and cancels the stream instead of buffering the rest",
    rc.tooLarge === true && cancelled && pulls <= 12);

  // the mocks
  function mockImages(opts) {
    const o = opts || {};
    const m = { calls: [] };
    m.input = (stream) => {
      const call = { transforms: [], output: null, bytes: null };
      m.calls.push(call);
      const t = {
        transform(x) { call.transforms.push(x); return t; },
        async output(x) {
          call.output = x;
          call.bytes = new Uint8Array(await new Response(stream).arrayBuffer());
          if (o.throws) throw o.throws;
          const png = o.png || OUT_PNG;
          return { contentType: () => o.ct || "image/png", image: () => new Response(png).body,
                   response: () => new Response(png, { headers: { "content-type": o.ct || "image/png" } }) };
        },
      };
      return t;
    };
    return m;
  }
  const mkBudget = () => {
    const m = new Map();
    const obj = new _test.StudioBudget({ storage: { get: async k => m.get(k), put: async (k, v) => { m.set(k, v); } } });
    return { store: m, binding: { idFromName: n => "id:" + n, get: () => ({ fetch: (u) => obj.fetch(new Request(String(u))) }) } };
  };
  const cutReq = (body, cookie, headers) => new Request("https://w.test/studio/api/cutout", {
    method: "POST", body, headers: Object.assign(cookie ? { cookie: STUDIO_COOKIE + "=" + cookie } : {}, headers || {}) });
  const envWith = (extra) => Object.assign({}, ENV, extra);

  // the gate
  let img = mockImages(), bud = mkBudget();
  const noCookie = await worker.fetch(cutReq(JPEG), envWith({ IMAGES: img, BUDGET: bud.binding }), {});
  const badCookie = await worker.fetch(cutReq(JPEG, "forged.value"), envWith({ IMAGES: img, BUDGET: bud.binding }), {});
  check("POST /studio/api/cutout without a valid session is 401 and the model never runs",
    noCookie.status === 401 && badCookie.status === 401 && img.calls.length === 0 && bud.store.size === 0);

  // no binding
  bud = mkBudget();
  const nob = await worker.fetch(cutReq(JPEG, SID), envWith({ BUDGET: bud.binding }), {});
  const nobj = await nob.json();
  check("without the IMAGES binding the route is 503 'cutout not configured' and spends nothing",
    nob.status === 503 && nobj.error === "cutout not configured" && bud.store.size === 0);

  // size cap: a real over-cap body, a declared over-cap length, and exactly the cap
  img = mockImages(); bud = mkBudget();
  const over = new Uint8Array(CUT_BYTES_MAX + 1); over.set(JPEG);
  const big = await worker.fetch(cutReq(over, SID), envWith({ IMAGES: img, BUDGET: bud.binding }), {});
  let declPulls = 0;
  const declared = await studioCutout({ headers: new Headers({ "content-length": String(CUT_BYTES_MAX + 1) }),
    // highWaterMark 0: the stream pulls only when someone READS, so a pull count of 0
    // proves the route never touched the body
    body: new ReadableStream({ pull(c) { declPulls++; c.enqueue(JPEG); c.close(); } }, { highWaterMark: 0 }) },
    envWith({ IMAGES: img, BUDGET: bud.binding }));
  check("a body over 10 MB is 413, an honest over-cap content-length is refused before a byte is read, "
    + "and neither spends or runs the model",
    big.status === 413 && declared.status === 413 && declPulls === 0 && img.calls.length === 0 && bud.store.size === 0);
  let liePulls = 0;
  const lying = await studioCutout({ headers: new Headers({ "content-length": "10" }),
    body: new ReadableStream({ pull(c) { liePulls++; const b = new Uint8Array(1024 * 1024); b.set(JPEG); c.enqueue(b); if (liePulls > 40) c.close(); } }) },
    envWith({ IMAGES: img, BUDGET: bud.binding }));
  check("a content-length that lies low does not lift the cap (counted while reading)",
    lying.status === 413 && liePulls <= 12 && img.calls.length === 0);
  const exact = new Uint8Array(CUT_BYTES_MAX); exact.set(JPEG);
  const atCap = await worker.fetch(cutReq(exact, SID), envWith({ IMAGES: img, BUDGET: bud.binding }), {});
  check("a photo of exactly 10 MB is accepted", atCap.status === 200 && img.calls.length === 1
    && img.calls[0].bytes.length === CUT_BYTES_MAX);

  // the magic-number allowlist
  img = mockImages(); bud = mkBudget();
  const e1 = envWith({ IMAGES: img, BUDGET: bud.binding });
  const svg = await worker.fetch(cutReq(SVG, SID, { "content-type": "image/png" }), e1, {});
  const html = await worker.fetch(cutReq(HTML, SID, { "content-type": "image/jpeg" }), e1, {});
  const gif = await worker.fetch(cutReq(GIF, SID), e1, {});
  const heic = await worker.fetch(cutReq(ftyp("heic", ["mif1"]), SID), e1, {});
  const empty = await worker.fetch(cutReq(new Uint8Array(0), SID), e1, {});
  check("SVG and HTML are refused 415 whatever content-type they claim; GIF and HEIC too; an empty body is 400",
    svg.status === 415 && html.status === 415 && gif.status === 415 && heic.status === 415 && empty.status === 400);
  check("a refused file never reaches the model and never spends", img.calls.length === 0 && bud.store.size === 0);

  // success
  img = mockImages(); bud = mkBudget();
  const ok = await worker.fetch(cutReq(JPEG, SID), envWith({ IMAGES: img, BUDGET: bud.binding }), {});
  const okBytes = new Uint8Array(await ok.arrayBuffer());
  check("a JPEG comes back as the model's PNG", ok.status === 200
    && okBytes.length === OUT_PNG.length && okBytes.every((v, i) => v === OUT_PNG[i]));
  check("the cut-out is image/png, nosniff, sandboxed and private no-store",
    ok.headers.get("content-type") === "image/png" && ok.headers.get("x-content-type-options") === "nosniff"
    && ok.headers.get("content-security-policy") === "default-src 'none'; sandbox"
    && ok.headers.get("cache-control") === "private, no-store");
  check("the binding got the uploaded bytes, ONE segment:foreground transform and a PNG output",
    img.calls.length === 1 && JSON.stringify(img.calls[0].transforms) === JSON.stringify([{ segment: "foreground" }])
    && JSON.stringify(img.calls[0].output) === JSON.stringify({ format: "image/png" })
    && img.calls[0].bytes.length === JPEG.length && img.calls[0].bytes.every((v, i) => v === JPEG[i]));
  check("each cut-out spends one unit on its OWN budget line", bud.store.get("cut").n === 1
    && !bud.store.has("gen") && !bud.store.has("ai"));
  const okW = await worker.fetch(cutReq(WEBP, SID), envWith({ IMAGES: img, BUDGET: bud.binding }), {});
  const okA = await worker.fetch(cutReq(ftyp("avif", ["mif1"]), SID), envWith({ IMAGES: img, BUDGET: bud.binding }), {});
  const okP = await worker.fetch(cutReq(OUT_PNG, SID), envWith({ IMAGES: img, BUDGET: bud.binding }), {});
  check("WebP, AVIF and PNG are accepted too", okW.status === 200 && okA.status === 200 && okP.status === 200);

  // the budget
  img = mockImages(); bud = mkBudget();
  const capEnv = envWith({ IMAGES: img, BUDGET: bud.binding, STUDIO_CUT_DAILY_CAP: "1" });
  const c1 = await worker.fetch(cutReq(JPEG, SID), capEnv, {});
  const c2 = await worker.fetch(cutReq(JPEG, SID), capEnv, {});
  const c2j = await c2.json();
  check("past the daily cut-out cap the route is 429, says which limit, and the model does not run",
    c1.status === 200 && c2.status === 429 && /Today's cut-out limit \(1\)/.test(c2j.error || "")
    && img.calls.length === 1);
  check("STUDIO_CUT_*_CAP tune the cut budget and the defaults are 100 a day, 30 an hour",
    _test.BUDGET_CAPS.cut.day === 100 && _test.BUDGET_CAPS.cut.hour === 30
    && _test.budgetCaps({ STUDIO_CUT_HOURLY_CAP: "7" }, "cut").hour === 7
    && _test.budgetCaps({ STUDIO_GEN_DAILY_CAP: "7" }, "cut").day === 100);
  img = mockImages();
  const brokenB = { idFromName: () => "x", get: () => ({ fetch: async () => { throw new Error("down"); } }) };
  const bdown = await worker.fetch(cutReq(JPEG, SID), envWith({ IMAGES: img, BUDGET: brokenB }), {});
  check("a budget object that cannot answer REFUSES (503) and the model never runs",
    bdown.status === 503 && img.calls.length === 0);

  // binding failures: a short message and the numeric code, never the error's own words
  bud = mkBudget();
  const boom = Object.assign(new Error("internal: segmenter pool /srv/birefnet exploded at 0xdeadbeef"), { code: 9001 });
  boom.stack = "Error: internal\n    at secretFrame (/srv/images/worker.rs:42)";
  const bf = await worker.fetch(cutReq(JPEG, SID), envWith({ IMAGES: mockImages({ throws: boom }), BUDGET: bud.binding }), {});
  const bfText = await bf.text();
  check("a binding error is a 502 with a fixed sentence and the numeric code - no message, no stack",
    bf.status === 502 && JSON.parse(bfText).code === 9001 && !/internal|birefnet|deadbeef|secretFrame|worker\.rs|stack/i.test(bfText)
    && bf.headers.get("content-type").indexOf("application/json") === 0);
  const q = await (await worker.fetch(cutReq(JPEG, SID), envWith({ IMAGES: mockImages({ throws: Object.assign(new Error("x"), { code: 9422 }) }), BUDGET: mkBudget().binding }), {})).json();
  const av = await (await worker.fetch(cutReq(ftyp("avif", ["mif1"]), SID), envWith({ IMAGES: mockImages({ throws: new Error("unsupported") }), BUDGET: mkBudget().binding }), {})).json();
  const odd = await (await worker.fetch(cutReq(JPEG, SID), envWith({ IMAGES: mockImages({ throws: "a bare string" }), BUDGET: mkBudget().binding }), {})).json();
  check("9422 says the free month is used up; an AVIF failure says to resend as JPEG/PNG/WebP; a thrown non-Error still answers",
    /5,000/.test(q.error) && q.code === 9422 && /JPEG, PNG or WebP/.test(av.error) && av.code === null
    && typeof odd.error === "string" && odd.code === null);
  const wrongFmt = await worker.fetch(cutReq(JPEG, SID), envWith({ IMAGES: mockImages({ ct: "image/jpeg" }), BUDGET: mkBudget().binding }), {});
  check("a reply that is not a PNG (no alpha possible) is a 502, never relabelled", wrongFmt.status === 502);

  // the probe
  const KEY = "probe-key-0123456789abcdef";
  const probeReq = (qs, init) => new Request("https://w.test/studio/api/cutout-probe" + (qs || ""), init);
  const srcJpeg = new Uint8Array(4096); srcJpeg.set(JPEG);
  let fetched = [];
  const fakeUfc = (redirect) => async (u) => {
    fetched.push(u);
    if (redirect) return new Response(null, { status: 302, headers: { location: redirect } });
    if (u === CUT_PROBE_URL) return new Response(srcJpeg, { status: 200, headers: { "content-type": "image/jpeg", "content-length": String(srcJpeg.length) } });
    return new Response("no", { status: 404 });
  };
  const realFetch = globalThis.fetch;
  try {
    img = mockImages(); bud = mkBudget();
    globalThis.fetch = fakeUfc(null); fetched = [];
    const pEnvNoKey = envWith({ IMAGES: img, BUDGET: bud.binding });
    const pk0 = await worker.fetch(probeReq("?k=" + KEY), pEnvNoKey, {});
    const pk0b = await worker.fetch(probeReq(""), pEnvNoKey, {});
    const pk1 = await worker.fetch(probeReq("?k=" + KEY + "x"), envWith({ IMAGES: img, BUDGET: bud.binding, NEWS_PROBE_KEY: KEY }), {});
    const pk2 = await worker.fetch(probeReq("?k="), envWith({ IMAGES: img, BUDGET: bud.binding, NEWS_PROBE_KEY: KEY }), {});
    const pk3 = await worker.fetch(probeReq("?k=" + KEY), { NEWS_PROBE_KEY: "" }, {});
    check("the probe is a bare 404 with no NEWS_PROBE_KEY, with a wrong key or an empty one - and does nothing",
      pk0.status === 404 && pk0b.status === 404 && pk1.status === 404 && pk2.status === 404 && pk3.status === 404
      && (await pk1.text()) === "not found" && fetched.length === 0 && img.calls.length === 0 && bud.store.size === 0);
    const pk4 = await worker.fetch(probeReq("?k=" + KEY), { NEWS_PROBE_KEY: KEY }, {});
    check("the probe answers 404/503 on its key alone, even with the studio password unset",
      pk4.status === 503 && (await pk4.json()).error === "cutout not configured" && fetched.length === 0);

    const pEnv = envWith({ IMAGES: img, BUDGET: bud.binding, NEWS_PROBE_KEY: KEY });
    const pr = await worker.fetch(probeReq("?k=" + KEY), pEnv, {});
    const prText = await pr.text();
    const pj = JSON.parse(prText);
    check("the probe cuts the pinned photo and reports JSON: ok, timings, sizes, type, alpha and a clear top row",
      pr.status === 200 && pj.ok === true && typeof pj.ms === "number" && typeof pj.fetchMs === "number"
      && pj.inBytes === srcJpeg.length && pj.inType === "image/jpeg" && pj.outBytes === OUT_PNG.length
      && pj.contentType === "image/png" && pj.alphaPresent === true && pj.topRowClear === 0.5
      && pj.width === 4 && pj.height === 2 && pj.source === CUT_PROBE_URL);
    check("the probe never returns the image and is never cached",
      pr.headers.get("content-type").indexOf("application/json") === 0 && prText.indexOf("PNG") === -1
      && pr.headers.get("cache-control") === "no-store");
    check("the probe fetched ONLY the pinned ufc.com photo, ran ONE transform and spent exactly ONE unit",
      fetched.length === 1 && fetched[0] === CUT_PROBE_URL && img.calls.length === 1
      && bud.store.get("cutprobe").n === 1 && !bud.store.get("cut") && pj.budget && pj.budget.used === 1 && pj.budget.cap === 6
      && JSON.stringify(img.calls[0].transforms) === JSON.stringify([{ segment: "foreground" }]));
    check("the pinned probe photo passes the UFC host pinning", _test.fighterPhotoUrl(CUT_PROBE_URL) === CUT_PROBE_URL);
    // the probe has its OWN cap: hammering it can never spend or block the owner's cut-outs
    img = mockImages(); bud = mkBudget(); globalThis.fetch = fakeUfc(); fetched = [];
    const shareEnv = envWith({ IMAGES: img, BUDGET: bud.binding, NEWS_PROBE_KEY: KEY });
    const probes = [];
    for (let i = 0; i < 8; i++) probes.push((await worker.fetch(probeReq("?k=" + KEY), shareEnv, {})).status);
    const callsBefore = img.calls.length;
    const pOver = await worker.fetch(probeReq("?k=" + KEY), shareEnv, {});
    const pOverJ = await pOver.json();
    const sc = await worker.fetch(cutReq(JPEG, SID), shareEnv, {});
    check("the probe has its own small cap: past it the probe refuses and runs nothing, and the owner's cut-outs still work",
      probes.filter(s => s === 200).length === 3 && pOver.status === 429 && pOverJ.ok === false && pOverJ.stage === "budget"
      && img.calls.length === callsBefore + 1 && sc.status === 200 && bud.store.get("cut").n === 1);
    // a redirect off UFC's hosts is refused hop by hop, before any spend
    img = mockImages(); bud = mkBudget();
    globalThis.fetch = fakeUfc("https://evil.example/steal.jpg"); fetched = [];
    const pRed = await worker.fetch(probeReq("?k=" + KEY), envWith({ IMAGES: img, BUDGET: bud.binding, NEWS_PROBE_KEY: KEY }), {});
    const pRedJ = await pRed.json();
    check("a redirect off UFC's pinned hosts is never followed, and nothing is spent or run",
      pRedJ.ok === false && pRedJ.stage === "fetch" && fetched.every(u => u.indexOf("evil.example") === -1)
      && img.calls.length === 0 && bud.store.size === 0);
    // a binding failure in the probe reports the code, not the message
    globalThis.fetch = fakeUfc(null);
    const pFail = await worker.fetch(probeReq("?k=" + KEY), envWith({ IMAGES: mockImages({ throws: boom }), BUDGET: mkBudget().binding, NEWS_PROBE_KEY: KEY }), {});
    const pFailT = await pFail.text();
    check("a probe transform failure reports stage and code, never the error text",
      pFail.status === 502 && JSON.parse(pFailT).stage === "transform" && JSON.parse(pFailT).code === 9001
      && !/internal|birefnet|secretFrame/i.test(pFailT));

    // path tricks: neither route opens any other way
    img = mockImages(); bud = mkBudget(); fetched = [];
    const tEnv = envWith({ IMAGES: img, BUDGET: bud.binding, NEWS_PROBE_KEY: KEY, DISCORD_PUBLIC_KEY: "ab" });
    const trick = async (p, init) => (await worker.fetch(new Request("https://w.test" + p, init), tEnv, {})).status;
    const post = { method: "POST", body: JPEG };
    const tricks = [
      await trick("/studio/api/cutout-probe?k=" + KEY, post),                       // the probe never takes a body
      await trick("/studio/api/cutout-probe/../cutout?k=" + KEY, post),              // resolves to the gated route
      await trick("/studio/api/%2e%2e/api/cutout?k=" + KEY, post),
      await trick("/studio/api/cutout-probe/.%2e/cutout?k=" + KEY, post),
      await trick("/studio/api/cutout-probe%2F..%2Fcutout?k=" + KEY),                // not the probe path
      await trick("/studio/api/cutout-probe/x?k=" + KEY),
      await trick("/studio/api/Cutout-Probe?k=" + KEY),
      await trick("/studio/api/cutout?k=" + KEY, post),                              // the key is not a session
      await trick("//studio/api/cutout", post),                                      // not /studio at all
    ];
    check("no spelling of either path reaches the model without a session (401 every time)",
      tricks.every(s => s === 401) && img.calls.length === 0 && fetched.length === 0 && bud.store.size === 0);
    const authedGet = await worker.fetch(cookieReq("/studio/api/cutout", SID), tEnv, {});
    const authedExtra = await worker.fetch(cookieReq("/studio/api/cutout/x", SID, { method: "POST", body: JPEG }), tEnv, {});
    const authedProbePost = await worker.fetch(cookieReq("/studio/api/cutout-probe?k=" + KEY, SID, { method: "POST", body: JPEG }), tEnv, {});
    check("with a session: GET, an extra segment, or a POST to the probe path are 404, never a cut-out",
      authedGet.status === 404 && authedExtra.status === 404 && authedProbePost.status === 404 && img.calls.length === 0);
  } finally { globalThis.fetch = realFetch; _test.resetFuse(); }
})();
if (wrangler !== null) {
  check("wrangler.toml binds Cloudflare Images as IMAGES for the cut-out route",
    /^\[images\]\s*\r?\nbinding = "IMAGES"/m.test(wrangler));
  check("wrangler.toml documents the cut-out caps and the probe key",
    /STUDIO_CUT_DAILY_CAP/.test(wrangler) && /STUDIO_CUT_HOURLY_CAP/.test(wrangler) && /NEWS_PROBE_KEY/.test(wrangler));
}

console.log(`\n==== worker: ${pass} passed, ${fail} failed ====`);
process.exit(fail ? 1 : 0);
