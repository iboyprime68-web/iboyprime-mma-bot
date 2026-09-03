/**
 * Prime Arena - custom slash-command bot (Cloudflare Worker).
 * Always-on, free, ad-free. Handles Discord HTTP interactions, and serves the
 * password-gated /studio surface on the same Worker.
 *
 * Secrets (set via `wrangler secret put` or the dashboard):
 *   DISCORD_PUBLIC_KEY   (required) - app Public Key from the Dev Portal.
 *   YOUTUBE_API_KEY      (optional) - enables real /youtube search.
 *   DISCORD_BOT_TOKEN    (optional) - enables /serverinfo member counts, /studio staging.
 *   STUDIO_PASSWORD      (required for /studio) - with it unset /studio is 503, never open.
 *   STUDIO_SIGNING_KEY   (required for /studio) - random secret that signs session cookies.
 *   GITHUB_TOKEN         (required for /mod, /news and the /studio AI key writer).
 */
// The editor page lives in its own module so this file stays about routing and auth.
// It is served ONLY to an authenticated session (see studioRouter).
import { STUDIO_HTML } from "./studio_page.js";

const ORANGE = 0xE67E22;
const T = { PONG: 1, MESSAGE: 4, DEFER: 5 };
const EPHEMERAL = 64;

// FALLBACK ONLY. The live list is `links` in welcomeconfig.json - the same file the
// pinned welcome message renders from - so /links and that message cannot drift apart.
// They did drift: this list used to be the second hard-coded copy and carried a wrong
// TikTok URL with no Instagram. A selftest now asserts this matches
// welcomeconfig.DEFAULT_LINKS byte for byte, so even the offline path stays correct.
const SOCIALS_FALLBACK = [
  { label: "YouTube",   url: "https://youtube.com/@iboyprime_official" },
  { label: "Twitch",    url: "https://twitch.tv/iboyprime" },
  { label: "Kick",      url: "https://kick.com/iboyprime" },
  { label: "TikTok",    url: "https://www.tiktok.com/@iboyprime_official" },
  { label: "Instagram", url: "https://www.instagram.com/iboyprime_official/" },
];
const OTD = {"on_this_day":{"01-18":[{"year":2020,"text":"**UFC 246**: Conor McGregor returned and TKO'd Donald Cerrone in just 40 seconds."}],"02-02":[{"year":2008,"text":"**UFC 81: Breaking Point**: Brock Lesnar made his UFC debut (losing to Frank Mir), and Antonio Rodrigo Nogueira beat Tim Sylvia for the interim heavyweight title."}],"02-23":[{"year":2013,"text":"**UFC 157**: Ronda Rousey vs Liz Carmouche became the first-ever women's fight in the UFC; Rousey won by armbar."}],"03-05":[{"year":2016,"text":"**UFC 196**: Nate Diaz shocked Conor McGregor by submission, and Miesha Tate submitted Holly Holm for the bantamweight title."}],"03-19":[{"year":2011,"text":"**UFC 128**: Jon Jones beat Mauricio 'Shogun' Rua to become, at 23, the youngest champion in UFC history."}],"04-09":[{"year":2005,"text":"**The Ultimate Fighter 1 Finale**: Forrest Griffin vs Stephan Bonnar, the slugfest widely credited with saving the UFC and launching it on cable TV."}],"07-03":[{"year":2010,"text":"**UFC 116**: Brock Lesnar survived a brutal first round to submit Shane Carwin and unify the heavyweight title."}],"07-06":[{"year":2013,"text":"**UFC 162**: Chris Weidman knocked out Anderson Silva, ending Silva's record 16-fight UFC win streak and 2,457-day title reign."}],"07-07":[{"year":2012,"text":"**UFC 148**: Anderson Silva beat Chael Sonnen in their grudge-match rematch."},{"year":2018,"text":"**UFC 226**: Daniel Cormier KO'd Stipe Miocic to become a simultaneous two-division champion."}],"07-09":[{"year":2016,"text":"**UFC 200**: Amanda Nunes submitted Miesha Tate for the title; Brock Lesnar beat Mark Hunt; Daniel Cormier beat Anderson Silva."}],"07-10":[{"year":2021,"text":"**UFC 264**: Dustin Poirier beat Conor McGregor after McGregor suffered a broken leg in their trilogy bout."}],"07-11":[{"year":2009,"text":"**UFC 100**: Brock Lesnar beat Frank Mir, Georges St-Pierre dominated Thiago Alves, and Dan Henderson flattened Michael Bisping."},{"year":2015,"text":"**UFC 189**: Conor McGregor stopped Chad Mendes to win the interim featherweight title in front of a roaring Las Vegas crowd."}],"08-20":[{"year":2016,"text":"**UFC 202**: Conor McGregor edged Nate Diaz in their rematch by majority decision."},{"year":2022,"text":"**UFC 278**: Leon Edwards knocked out Kamaru Usman with a 5th-round head kick to win the welterweight title."}],"10-06":[{"year":2018,"text":"**UFC 229**: Khabib Nurmagomedov submitted Conor McGregor in the biggest PPV in UFC history."}],"10-24":[{"year":2020,"text":"**UFC 254**: Khabib Nurmagomedov submitted Justin Gaethje, then retired 29-0."}],"11-04":[{"year":2017,"text":"**UFC 217** at Madison Square Garden: GSP returned to submit Michael Bisping; Rose Namajunas KO'd Joanna Jedrzejczyk; TJ Dillashaw KO'd Cody Garbrandt. Three title changes in one night."}],"11-12":[{"year":1993,"text":"**UFC 1**: the very first UFC event in Denver, Colorado. Royce Gracie won the eight-man tournament and introduced the world to Brazilian jiu-jitsu."},{"year":2016,"text":"**UFC 205** at Madison Square Garden: Conor McGregor KO'd Eddie Alvarez to become the first fighter to hold two UFC titles at once."},{"year":2022,"text":"**UFC 281**: Alex Pereira TKO'd Israel Adesanya in the 5th round to win the middleweight title."}],"11-15":[{"year":2015,"text":"**UFC 193**: Holly Holm head-kick KO'd Ronda Rousey in one of the biggest upsets in MMA history."}],"12-12":[{"year":2015,"text":"**UFC 194**: Conor McGregor knocked out Jose Aldo in 13 seconds, the fastest title-fight finish in UFC history."}],"12-28":[{"year":2013,"text":"**UFC 168**: Chris Weidman beat Anderson Silva again after Silva broke his leg on a checked kick; Ronda Rousey armbarred Miesha Tate."}],"12-29":[{"year":2012,"text":"**UFC 155**: Cain Velasquez dominated Junior dos Santos to reclaim the heavyweight title."},{"year":2018,"text":"**UFC 232**: Jon Jones beat Alexander Gustafsson, and Amanda Nunes KO'd Cris Cyborg in 51 seconds."}],"12-30":[{"year":2006,"text":"**UFC 66**: Chuck Liddell TKO'd Tito Ortiz in their rematch on a landmark million-buy PPV."},{"year":2016,"text":"**UFC 207**: Amanda Nunes KO'd Ronda Rousey in 48 seconds in Rousey's final fight."}]},"trivia":[{"q":"Who won the first-ever UFC tournament at UFC 1 in 1993?","a":"Royce Gracie"},{"q":"How long did Conor McGregor need to knock out Jose Aldo at UFC 194?","a":"13 seconds"},{"q":"Who was part of the first women's fight in UFC history at UFC 157?","a":"Ronda Rousey (vs Liz Carmouche)"},{"q":"Which fighter ended Anderson Silva's record 16-fight UFC win streak?","a":"Chris Weidman (UFC 162, 2013)"},{"q":"Who became the first fighter to hold two UFC titles simultaneously?","a":"Conor McGregor (UFC 205, 2016)"},{"q":"At which arena did the UFC hold its first New York event, UFC 205?","a":"Madison Square Garden"},{"q":"Who handed Ronda Rousey her first pro MMA loss?","a":"Holly Holm (UFC 193, 2015)"},{"q":"Who defeated Conor McGregor at UFC 229?","a":"Khabib Nurmagomedov"},{"q":"Who knocked out Israel Adesanya to win the middleweight title at UFC 281?","a":"Alex Pereira"},{"q":"What was Khabib Nurmagomedov's pro record when he retired?","a":"29-0"},{"q":"Who won the legendary TUF 1 Finale fight that helped save the UFC?","a":"Forrest Griffin (def. Stephan Bonnar)"},{"q":"Which heavyweight made his UFC debut at UFC 81 in 2008?","a":"Brock Lesnar"},{"q":"Who is nicknamed 'The Last Stylebender'?","a":"Israel Adesanya"},{"q":"Who is the UFC fighter known as 'The Notorious'?","a":"Conor McGregor"},{"q":"Which UFC star is nicknamed 'Bones'?","a":"Jon Jones"},{"q":"Who is the first woman to become a two-division UFC champion?","a":"Amanda Nunes"},{"q":"Who did Leon Edwards head-kick KO at UFC 278 to win the title?","a":"Kamaru Usman"},{"q":"What does 'MMA' stand for?","a":"Mixed Martial Arts"},{"q":"How many rounds are non-main-event UFC fights?","a":"3 rounds (title fights and main events are 5)"},{"q":"What is the UFC lightweight division weight limit?","a":"155 lbs"},{"q":"How many sides does the UFC's 'Octagon' have?","a":"8"},{"q":"Which Japanese promotion did the UFC's parent company buy in 2007?","a":"PRIDE Fighting Championships"},{"q":"Conor McGregor won UFC titles in which two divisions?","a":"Featherweight and Lightweight"},{"q":"Who KO'd Ronda Rousey in 48 seconds at UFC 207?","a":"Amanda Nunes"},{"q":"At 23, who became the youngest champion in UFC history?","a":"Jon Jones (UFC 128, 2011)"},{"q":"Daniel Cormier became a two-division champ by KO'ing whom at UFC 226?","a":"Stipe Miocic"}]};

// ---------- helpers ----------
function json(obj) { return new Response(JSON.stringify(obj), { headers: { "content-type": "application/json" } }); }
function msg(content, ephemeral) { return { content, flags: ephemeral ? EPHEMERAL : 0, allowed_mentions: { parse: [] } }; }
function embed(e) { return { embeds: [{ color: ORANGE, ...e }], allowed_mentions: { parse: [] } }; }

// ---------- prototype-safe lookups ----------
// `obj[key]` with a caller-controlled key is NOT a membership test: every plain object
// answers for "__proto__" (Object.prototype), "constructor" (the Object function) and
// "toString" (a function), all of them truthy. That turned the AI provider allowlist
// into a bypass: AI_PROVIDERS["__proto__"] was truthy, so the "unknown provider" check
// passed and the secret NAME it produced stringified to "[object Object]", which then
// went out as PUT /repos/o/r/actions/secrets/[object Object]. Same shape as the /unban
// path-injection bug: a string the caller controls reaching an API path.
// `own` answers only for real OWN properties, so nothing on the prototype chain can be
// mistaken for an allowlist entry. Every lookup keyed by user input in this file goes
// through it, or through an explicit includes() on a frozen list.
function own(obj, key) {
  if (obj === null || obj === undefined) return undefined;
  const k = String(key === null || key === undefined ? "" : key);
  return Object.prototype.hasOwnProperty.call(obj, k) ? obj[k] : undefined;
}
// Keys that must never be WRITTEN from caller input: assigning to "__proto__" reparents
// the object instead of adding a field, which is how a config edit becomes prototype
// pollution in the JSON we commit back to the repo.
const UNSAFE_KEYS = Object.freeze(["__proto__", "constructor", "prototype"]);
function safeKey(k) {
  const s = String(k === null || k === undefined ? "" : k);
  return s.length > 0 && s.length <= 100 && UNSAFE_KEYS.indexOf(s) === -1;
}

function hex2buf(hex) {
  const a = new Uint8Array(hex.length / 2);
  for (let i = 0; i < a.length; i++) a[i] = parseInt(hex.substr(i * 2, 2), 16);
  return a;
}
async function verify(request, body, publicKey) {
  const sig = request.headers.get("x-signature-ed25519");
  const ts = request.headers.get("x-signature-timestamp");
  if (!sig || !ts) return false;
  try {
    const key = await crypto.subtle.importKey("raw", hex2buf(publicKey), { name: "Ed25519" }, false, ["verify"]);
    return await crypto.subtle.verify({ name: "Ed25519" }, key, hex2buf(sig), new TextEncoder().encode(ts + body));
  } catch (e) { return false; }
}
function slugify(name) {
  return (name || "").normalize("NFD").replace(/[\u0300-\u036F]/g, "")
    .toLowerCase().replace(/['\u2019.]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}
function snowflakeDate(id) { try { return new Date(Number((BigInt(id) >> 22n) + 1420070400000n)); } catch (e) { return null; } }
function optMap(interaction) {
  const m = Object.create(null);          // null prototype: an option named __proto__
  for (const o of (interaction.data.options || [])) {   // cannot reparent this map
    if (safeKey(o && o.name)) m[o.name] = o.value;
  }
  return m;
}
async function getJSON(url, headers) {
  const r = await fetch(url, { headers: headers || { "User-Agent": "iBoyPrimeHQ-cmds/1.0" } });
  if (!r.ok) return null;
  try { return await r.json(); } catch (e) { return null; }
}
async function followup(interaction, data) {
  await fetch(`https://discord.com/api/v10/webhooks/${interaction.application_id}/${interaction.token}/messages/@original`,
    { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(data) });
}

// ---------- MMA data ----------
async function espn(path) { return await getJSON("https://site.api.espn.com/apis/site/v2/sports/mma/" + path); }

async function soonestEvent() {
  let best = null;
  for (const lg of ["ufc", "pfl", "bellator"]) {
    const sb = await espn(lg + "/scoreboard");
    const cal = sb && sb.leagues && sb.leagues[0] ? (sb.leagues[0].calendar || []) : [];
    const events = (sb && sb.events) || [];
    const cache = Object.create(null); events.forEach(e => { if (safeKey(e && e.id)) cache[e.id] = e; });
    for (const c of cal) {
      const t = Date.parse(c.startDate);
      if (isFinite(t) && t > Date.now()) {
        const m = /events\/(\d+)/.exec((c.event && c.event.$ref) || "");
        if (!best || t < best.t) best = { t, label: c.label, league: lg.toUpperCase(), ev: m ? cache[m[1]] : null };
      }
    }
  }
  return best;
}
function fmtBouts(ev) {
  if (!ev || !ev.competitions) return "";
  const bouts = ev.competitions.slice().reverse().slice(0, 8);
  return bouts.map((c, i) => {
    const cs = c.competitors || [];
    const a = (cs.find(x => x.order === 1) || cs[0] || {});
    const b = (cs.find(x => x.order === 2) || cs[1] || {});
    const nm = x => (x.athlete || {}).displayName || "TBD";
    return (i === 0 ? "\uD83C\uDFC6 " : "\u2022 ") + `**${nm(a)}** vs **${nm(b)}**`;
  }).join("\n");
}

async function fighterEmbed(name) {
  const f = await getJSON("https://api.octagon-api.com/fighter/" + slugify(name));
  if (!f || !f.name) return embed({ title: "Fighter", description: `Couldn't find **${name}**. Try their full name.` });
  const rec = `${f.wins || 0}-${f.losses || 0}-${f.draws || 0}`;
  const fields = [];
  if (f.category) fields.push({ name: "Division", value: f.category, inline: true });
  fields.push({ name: "Record", value: rec, inline: true });
  if (f.status) fields.push({ name: "Status", value: f.status, inline: true });
  if (f.age) fields.push({ name: "Age", value: String(f.age), inline: true });
  if (f.height) fields.push({ name: "Height", value: `${f.height}"`, inline: true });
  if (f.reach) fields.push({ name: "Reach", value: `${f.reach}"`, inline: true });
  if (f.fightingStyle) fields.push({ name: "Style", value: f.fightingStyle, inline: true });
  if (f.placeOfBirth) fields.push({ name: "From", value: f.placeOfBirth, inline: true });
  return embed({
    title: `${f.name}${f.nickname ? ` "${f.nickname}"` : ""}`,
    thumbnail: f.imgUrl ? { url: f.imgUrl } : undefined,
    fields,
    footer: { text: "octagon-api" },
  });
}

// ---------- fun / utility ----------
const EIGHTBALL = ["It is certain.", "Without a doubt.", "Yes, definitely.", "You may rely on it.",
  "Most likely.", "Outlook good.", "Signs point to yes.", "Reply hazy, try again.", "Ask again later.",
  "Cannot predict now.", "Don't count on it.", "My reply is no.", "Outlook not so good.", "Very doubtful."];
function rollDice(spec) {
  const m = /^(\d{0,2})d(\d{1,3})$/.exec((spec || "1d6").toLowerCase().replace(/\s/g, ""));
  let n = 1, sides = 6;
  if (m) { n = Math.min(parseInt(m[1] || "1") || 1, 20); sides = Math.min(parseInt(m[2]) || 6, 1000); }
  const rolls = []; let total = 0;
  for (let i = 0; i < n; i++) { const r = 1 + Math.floor(Math.random() * sides); rolls.push(r); total += r; }
  return { rolls, total, n, sides };
}
function todayKey(d) { d = d || new Date(); return String(d.getUTCMonth() + 1).padStart(2, "0") + "-" + String(d.getUTCDate()).padStart(2, "0"); }
function onThisDayEmbed(d) {
  const key = todayKey(d);
  const items = (OTD.on_this_day[key] || []).slice().sort((a, b) => a.year - b.year);
  const month = (d || new Date()).toLocaleString("en-US", { month: "long", timeZone: "UTC" });
  const day = (d || new Date()).getUTCDate();
  const body = items.length
    ? items.map(e => `**${e.year}**: ${e.text}`).join("\n\n")
    : "_No marquee MMA event on record for today._";
  return embed({ title: `On This Day in MMA: ${month} ${day}`, description: body });
}
function triviaResponse() {
  const t = OTD.trivia.length ? OTD.trivia[Math.floor(Math.random() * OTD.trivia.length)] : null;
  if (!t) return msg("No trivia available.");
  return embed({ title: "\uD83E\uDDE0 MMA Trivia", description: `${t.q}\n\nAnswer: ||${t.a}||` });
}
function buildPoll(o) {
  const answers = [];
  for (const k of ["option1", "option2", "option3", "option4"]) if (o[k]) answers.push({ poll_media: { text: String(o[k]).slice(0, 55) } });
  if (answers.length < 2) answers.push({ poll_media: { text: "Yes" } }, { poll_media: { text: "No" } });
  return { poll: { question: { text: String(o.question).slice(0, 300) }, answers: answers.slice(0, 4), duration: 24, allow_multiselect: false } };
}
function avatarUrl(user) {
  if (!user) return null;
  if (!user.avatar) return `https://cdn.discordapp.com/embed/avatars/${(Number(user.discriminator || 0) % 5)}.png`;
  const ext = user.avatar.startsWith("a_") ? "gif" : "png";
  return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.${ext}?size=512`;
}
function resolveUser(interaction, o) {
  const res = (interaction.data && interaction.data.resolved && interaction.data.resolved.users) || {};
  const hit = o.user ? own(res, o.user) : undefined;    // own(): "__proto__" is not a user
  if (hit && typeof hit === "object") return hit;
  return (interaction.member && interaction.member.user) || interaction.user;
}

// ---------- moderation: config + permissions ----------
const MOD_CATEGORIES = ["slurs", "nsfw_text", "profanity", "sensitive", "ads", "scam"];
const MEDIA_POLICIES = ["allow", "no_links", "no_attachments", "sfw_only", "text_only"];
const MOD_PROFILES = ["anything_goes", "standard", "sfw_strict"];

function b64encode(str) {
  const bytes = new TextEncoder().encode(str); let bin = "";
  bytes.forEach(b => bin += String.fromCharCode(b)); return btoa(bin);
}
function b64decode(b64) {
  const bin = atob((b64 || "").replace(/\s/g, ""));
  return new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0)));
}
// Walk a /mod interaction's SUB_COMMAND_GROUP(2)/SUB_COMMAND(1) options -> {group, sub, opts}.
function subPath(interaction) {
  let opts = (interaction.data && interaction.data.options) || [];
  let group = null, sub = null;
  if (opts.length && opts[0].type === 2) { group = opts[0].name; opts = opts[0].options || []; }
  if (opts.length && opts[0].type === 1) { sub = opts[0].name; opts = opts[0].options || []; }
  const m = Object.create(null);
  for (const o of opts) { if (safeKey(o && o.name)) m[o.name] = o.value; }
  return { group, sub, opts: m };
}
// The bot is ADMINISTRATOR, so anything it does on a member's behalf runs at the bot's
// permission level, not theirs. That means this gate - not Discord - decides what each
// staff tier can do, and a single flat check silently GRANTS powers the guild withholds:
// Moderator is configured with kick but NOT ban, yet /ban went through this same
// check. Pass `keys` to require a tier; the default keeps the old behaviour.
function isStaffFromRoles(member, cfg, keys) {
  if (!member) return false;
  const roleIds = new Set(member.roles || []);
  const staff = (keys || ["owner", "admin", "mod"]).map(k => own(cfg.roles, k)).filter(Boolean);
  if (staff.some(id => roleIds.has(id))) return true;
  // Administrator can do all of this natively anyway, so this is not an escalation.
  try { if ((BigInt(member.permissions || "0") & (1n << 3n)) !== 0n) return true; } catch (e) {}
  return false;
}
function profileCats(modcfg, name) { return new Set(((own(modcfg.profiles, name)) || {}).categories || []); }
function resolveCats(modcfg, channel) {
  const e = own(modcfg.channels, channel);              // own(): a channel id named
  let name = ((modcfg.defaults || {}).profile) || "standard", inline = {};  // "__proto__"
  if (typeof e === "string") name = e;                  // must resolve to nothing, not
  else if (e && typeof e === "object") { name = e.profile || name; inline = e; }  // to
  let cats = profileCats(modcfg, name);                 // Object.prototype
  for (const c of (inline.categories_add || [])) cats.add(c);
  for (const c of (inline.categories_remove || [])) cats.delete(c);
  if (inline.categories) cats = new Set(inline.categories);
  const media = inline.media_policy || ((own(modcfg.profiles, name)) || {}).media_policy || "allow";
  return { profile: name, cats, media };
}
function ensureInline(modcfg, channel) {
  const c = (modcfg.channels = modcfg.channels || {});
  if (!safeKey(channel)) return {};        // throwaway: the write goes nowhere
  let e = own(c, channel);
  if (typeof e === "string") e = { profile: e };
  else if (!e || typeof e !== "object") e = { profile: ((modcfg.defaults || {}).profile) || "standard" };
  c[channel] = e; return e;
}
// A profile / feed / topic name is written into the config we commit, so it stays a
// plain identifier. NOTE the safeKey half: "__proto__" matches this pattern perfectly
// well, so the shape check alone is not a defence when the name becomes an object KEY.
const IDENT = /^[A-Za-z0-9_-]{1,40}$/;
function safeIdent(k) { return safeKey(k) && IDENT.test(String(k)); }
// Pure: apply one /mod edit to a modconfig object and return the new one.
// Every key that comes from the interaction is checked with safeKey/an allowlist BEFORE
// it is used as an object key: `channels["__proto__"] = {...}` reparents the object
// instead of adding a channel, and that object is JSON we commit back to a public repo.
function applyModChange(modcfg, group, sub, a) {
  modcfg = JSON.parse(JSON.stringify(modcfg));
  if (group === "channel" && sub === "set-profile") {
    if (!safeKey(a.channel) || !safeIdent(a.profile)) return modcfg;
    (modcfg.channels = modcfg.channels || {})[a.channel] = a.profile;
  } else if (group === "category") {
    if (!safeKey(a.channel) || MOD_CATEGORIES.indexOf(String(a.category)) === -1) return modcfg;
    const e = ensureInline(modcfg, a.channel);
    const cats = new Set(resolveCats(modcfg, a.channel).cats);
    if (sub === "enable") cats.add(a.category); else cats.delete(a.category);
    e.categories = Array.from(cats);
  } else if (group === "media" && sub === "policy") {
    if (!safeKey(a.channel) || MEDIA_POLICIES.indexOf(String(a.policy)) === -1) return modcfg;
    ensureInline(modcfg, a.channel).media_policy = a.policy;
  } else if (group === "word") {
    if (MOD_CATEGORIES.indexOf(String(a.category)) === -1) return modcfg;
    const all = (modcfg.categories = modcfg.categories || {});
    const cc = (all[a.category] = own(all, a.category) || {});
    cc.words = cc.words || [];
    if (sub === "add") { if (a.word && !cc.words.includes(a.word)) cc.words.push(a.word); }
    else cc.words = cc.words.filter(w => w !== a.word);
  } else if (group === "raid") {
    (modcfg.raid = modcfg.raid || {}).enabled = (sub === "on");
  }
  return modcfg;
}
// Pure: apply one /news edit to a newsconfig object and return the new one.
// The Python side (newsconfig.py) owns the schema; this only flips the simple
// booleans/lists a staff slash-command can reach.
// The seventeen betting words the owner can edit from /news and the panel. The
// REAL no-gambling rule lives in Python (bots_github/promofilter.py) and runs
// unconditionally, so removing one of these no longer opens a hole - but letting
// the removal appear to succeed would tell the owner something false about what
// his server is filtering. Refuse it here and say why.
//
// Keep this list equal to newsconfig._DEFAULT_EXCLUDE. A selftest pins the two
// byte for byte, the same way SOCIALS_FALLBACK is pinned to welcomeconfig.
const PROTECTED_EXCLUDES = ["betting", "odds", "parlay", "dfs", "sportsbook",
  "gambling", "draftkings", "fanduel", "prizepicks", "betmgm", "bet365",
  "bovada", "daily fantasy", "moneyline", "prop bet", "point spread", "wager"];

function applyNewsChange(newscfg, group, sub, a) {
  newscfg = JSON.parse(JSON.stringify(newscfg));
  if (group === null && sub === "mode") {
    if (["realtime", "hybrid", "digest"].includes(a.value)) newscfg.mode = a.value;
  } else if (group === null && sub === "source") {
    if (!safeIdent(a.name)) return newscfg;
    const all = (newscfg.sources = newscfg.sources || {});
    const s = (all[a.name] = own(all, a.name) || {});
    s.enabled = (a.state === "on");
  } else if (group === null && sub === "category") {
    if (!safeIdent(a.name)) return newscfg;
    const all = (newscfg.categories = newscfg.categories || {});
    const c = (all[a.name] = own(all, a.name) || {});
    c.enabled = (a.state === "on");
  } else if (group === "keyword") {
    const key = a.list === "breaking" ? "breaking_keywords" : "exclude_keywords";
    const w = (a.word || "").toLowerCase().trim();
    const arr = (newscfg[key] = newscfg[key] || []);
    if (sub === "add") { if (w && !arr.includes(w)) arr.push(w); }
    else if (key === "exclude_keywords" && PROTECTED_EXCLUDES.includes(w)) {
      newscfg._refused = "protected";      // read by the caller, never persisted
    } else newscfg[key] = arr.filter(x => x !== w);
  }
  return newscfg;
}

// GitHub + Discord REST from the Worker (secrets via `wrangler secret put`; owner/repo via [vars]).
function ghHeaders(env) {
  return { Authorization: "Bearer " + env.GITHUB_TOKEN, Accept: "application/vnd.github+json",
           "User-Agent": "iboyprime-commands", "X-GitHub-Api-Version": "2022-11-28" };
}
function ghBase(env) { return "https://api.github.com/repos/" + env.GITHUB_OWNER + "/" + env.GITHUB_REPO; }
function rawBase(env) { return "https://raw.githubusercontent.com/" + env.GITHUB_OWNER + "/" + env.GITHUB_REPO + "/main"; }

let _cfgCache = { at: 0, cfg: null };
async function botsConfig(env) {
  const now = Date.now();
  if (_cfgCache.cfg && now - _cfgCache.at < 300000) return _cfgCache.cfg;   // 5-min cache
  const c = await getJSON(rawBase(env) + "/bots_config.json");
  if (c) _cfgCache = { at: now, cfg: c };
  return _cfgCache.cfg || {};
}
// The welcome message's config, read the same cheap way as bots_config: raw CDN, no
// token. /links is a PUBLIC command, so it must not need GITHUB_TOKEN to answer.
let _wcfgCache = { at: 0, cfg: null };
async function welcomeConfig(env) {
  const now = Date.now();
  if (_wcfgCache.cfg && now - _wcfgCache.at < 300000) return _wcfgCache.cfg;   // 5-min cache
  const c = await getJSON(rawBase(env) + "/welcomeconfig.json");
  if (c) _wcfgCache = { at: now, cfg: c };
  return _wcfgCache.cfg;                    // null until a fetch succeeds -> caller falls back
}
// Offline tests only: drop the 5-minute config caches so two cases can use two configs.
function resetStudioCaches() {
  _cfgCache = { at: 0, cfg: null };
  _wcfgCache = { at: 0, cfg: null };
  _pollCache = { at: 0, data: null };
  _meCache = { at: 0, id: null };
  _imgMsgCache = Object.create(null);
  resetUsageCache();
}
// PURE: the links list -> the /links body. https-only, mirroring welcomeconfig.clean_links.
// Returns null (not "") when there is nothing usable, so the caller can fall back.
function socialLines(links) {
  const ok = (links || []).filter(l => l && l.label && typeof l.url === "string"
                                       && l.url.startsWith("https://"));
  return ok.length ? ok.map(l => `**${l.label}:** ${l.url}`).join("\n") : null;
}
// Generic repo-JSON read/write via the GitHub contents API (used by /mod + /news).
async function loadRepoJson(env, path) {
  const info = await getJSON(ghBase(env) + "/contents/" + path, ghHeaders(env));
  if (!info || !info.content) return { obj: null, sha: (info && info.sha) || null };
  try { return { obj: JSON.parse(b64decode(info.content)), sha: info.sha }; }
  catch (e) { return { obj: null, sha: info.sha }; }
}
async function saveRepoJson(env, path, obj, sha, message) {
  const body = { message: message + " [skip ci]", content: b64encode(JSON.stringify(obj, null, 2)) };
  if (sha) body.sha = sha;
  const r = await fetch(ghBase(env) + "/contents/" + path,
    { method: "PUT", headers: ghHeaders(env), body: JSON.stringify(body) });
  return r.ok;
}
async function loadModconfig(env) {
  const { obj, sha } = await loadRepoJson(env, "modconfig.json");
  return { modcfg: obj || { version: 1, defaults: { profile: "standard" }, profiles: {}, channels: {}, categories: {}, raid: {} }, sha };
}
async function saveModconfig(env, modcfg, sha, message) {
  return saveRepoJson(env, "modconfig.json", modcfg, sha, message);
}
async function dispatchWorkflow(env, wf) {
  try {
    await fetch(ghBase(env) + "/actions/workflows/" + wf + "/dispatches",
      { method: "POST", headers: ghHeaders(env), body: JSON.stringify({ ref: "main" }) });
  } catch (e) {}
}
// A Discord snowflake and nothing else. Anything spliced into an API path must pass
// this: fetch() parses with the WHATWG URL parser, which RESOLVES dot-segments before
// the request leaves, so "../../../channels/123" in a path turns
// /api/v10/guilds/G/bans/../../../channels/123 into /api/v10/channels/123 - a DELETE
// there removes the channel, using the bot's ADMINISTRATOR token.
const SNOWFLAKE = /^\d{15,20}$/;
function isSnowflake(v) { return SNOWFLAKE.test(String(v == null ? "" : v).trim()); }
// Defence in depth behind isSnowflake: no caller may ever build a traversing path.
function safeApiPath(path) {
  const p = String(path || "");
  return p.startsWith("/") && !p.includes("..") && !p.includes("//") && !/[\s\\]/.test(p);
}
async function dapi(env, method, path, body) {
  if (!safeApiPath(path)) throw new Error("unsafe API path");
  return await fetch("https://discord.com/api/v10" + path, {
    method, headers: { Authorization: "Bot " + env.DISCORD_BOT_TOKEN, "content-type": "application/json",
                       "User-Agent": "iBoyPrimeHQ-cmds/1.0" },
    body: body != null ? JSON.stringify(body) : undefined });
}
// Must stay byte-identical to mod_bot.hkey(): sha256(token + ":" + id), first 16 hex.
// state_mod.json is in the PUBLIC repo, so it is keyed by this pseudonym rather than by
// raw user ids - otherwise every sanctioned member would have a world-readable
// disciplinary record. The salt is the bot token, which is never committed.
async function uidKey(env, uid) {
  const data = new TextEncoder().encode((env.DISCORD_BOT_TOKEN || "") + ":" + uid);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("").slice(0, 16);
}
async function userWarns(env, uid) {
  if (!env.DISCORD_BOT_TOKEN) return undefined;   // can't unlock the ledger; not "no warnings"
  const s = await getJSON(rawBase(env) + "/state_mod.json");
  if (!s || !s.users) return null;
  return own(s.users, await uidKey(env, uid)) || null;
}
async function postLog(env, cfg, content) {
  const ch = (cfg.channels || {}).mod_log;
  if (!ch || !env.DISCORD_BOT_TOKEN) return;
  await dapi(env, "POST", "/channels/" + ch + "/messages", { content, allowed_mentions: { parse: [] } });
}
async function requireRank(i, env, keys) {
  const cfg = await botsConfig(env);
  return { cfg, ok: isStaffFromRoles(i.member, cfg, keys) };
}
async function requireStaff(i, env) { return requireRank(i, env, null); }   // mod and above
// Ban and unban only. Mirrors the guild's own roles: Moderator has kick, not ban.
const ADMIN_UP = ["owner", "admin"];

// ---------- command table ----------
const COMMANDS = {
  help: () => ({ data: embed({
    title: "\uD83E\uDD16 Commands",
    description: [
      "**MMA**",
      "`/nextevent` the next card and a countdown to it",
      "`/event` the next card's full lineup",
      "`/fighter` a fighter's record and profile",
      "`/onthisday` what happened in MMA on today's date",
      "`/trivia` one MMA question",
      "",
      "**Utility**",
      "`/poll` `/8ball` `/roll` `/flip`",
      "`/avatar` `/userinfo` `/serverinfo` `/help`",
      "",
      "**News**",
      "`/news status` shows how the news wire is tuned. It posts silently and pings nobody.",
      "",
      "**Links**",
      "`/youtube` search YouTube \u00B7 `/links` every platform iBoyPrime posts on",
      "",
      "**Music**, from the Jockie Music bot: `/play`, `/queue`, `/skip`.",
    ].join("\n"),
  }) }),
  // Deferred because it now reads the repo. Falls back to the built-in list if the
  // fetch fails, so /links always answers with correct URLs.
  links: (i, env) => ({ defer: async () => embed({
    title: "Where iBoyPrime posts",
    description: socialLines((await welcomeConfig(env) || {}).links) || socialLines(SOCIALS_FALLBACK),
  }) }),
  "8ball": (i) => { const o = optMap(i); return { data: embed({ title: "\uD83C\uDFB1 Magic 8-Ball", description: `**Q:** ${o.question || "..."}\n**A:** ${EIGHTBALL[Math.floor(Math.random() * EIGHTBALL.length)]}` }) }; },
  roll: (i) => { const r = rollDice(optMap(i).dice); return { data: msg(`\uD83C\uDFB2 Rolled **${r.n}d${r.sides}**: ${r.rolls.join(", ")} \u2192 **${r.total}**`) }; },
  flip: () => ({ data: msg(`\uD83E\uDE99 **${Math.random() < 0.5 ? "Heads" : "Tails"}**`) }),
  poll: (i) => ({ data: { ...buildPoll(optMap(i)), allowed_mentions: { parse: [] } } }),
  onthisday: () => ({ data: onThisDayEmbed(new Date()) }),
  trivia: () => ({ data: triviaResponse() }),
  avatar: (i) => { const u = resolveUser(i, optMap(i)); return { data: embed({ title: `${u.username || "Avatar"}`, image: { url: avatarUrl(u) } }) }; },
  userinfo: (i) => {
    const u = resolveUser(i, optMap(i)); const created = snowflakeDate(u.id);
    return { data: embed({ title: `\uD83D\uDC64 ${u.global_name || u.username}`, thumbnail: { url: avatarUrl(u) },
      fields: [{ name: "Username", value: u.username || "?", inline: true }, { name: "ID", value: u.id, inline: true },
        { name: "Account created", value: created ? `<t:${Math.floor(created.getTime() / 1000)}:D>` : "?", inline: true }] }) };
  },
  // /rankings was removed in the Aug 2026 declutter along with the -rankings board:
  // the owner's verdict on that data source was "not accurate and really poorly done",
  // and this command hit the same octagon-api endpoint the board did.
  nextevent: () => ({ defer: async () => {
    const e = await soonestEvent();
    if (!e) return embed({ title: "Next event", description: "No upcoming card found right now." });
    const ts = Math.floor(e.t / 1000);
    return embed({ title: `\uD83E\uDD4A Next up: ${e.label}`, description: `${e.league}\n<t:${ts}:F>\n**<t:${ts}:R>**` });
  } }),
  event: () => ({ defer: async () => {
    const e = await soonestEvent();
    if (!e) return embed({ title: "Event", description: "No upcoming card found." });
    const ts = Math.floor(e.t / 1000);
    return embed({ title: `\uD83D\uDDD3\uFE0F ${e.label}`, description: `<t:${ts}:F> (<t:${ts}:R>)\n\n${fmtBouts(e.ev) || "Card TBA."}` });
  } }),
  fighter: (i) => ({ defer: async () => fighterEmbed(optMap(i).name || "") }),
  serverinfo: (i, env) => ({ defer: async () => {
    let g = null;
    if (env && env.DISCORD_BOT_TOKEN) g = await getJSON(`https://discord.com/api/v10/guilds/${i.guild_id}?with_counts=true`, { Authorization: "Bot " + env.DISCORD_BOT_TOKEN });
    const created = snowflakeDate(i.guild_id);
    const fields = [{ name: "Server ID", value: i.guild_id, inline: true },
      { name: "Created", value: created ? `<t:${Math.floor(created.getTime() / 1000)}:D>` : "?", inline: true }];
    if (g) { fields.push({ name: "Members", value: String(g.approximate_member_count || "?"), inline: true });
      fields.push({ name: "Online", value: String(g.approximate_presence_count || "?"), inline: true }); }
    return embed({ title: `\uD83D\uDCCA ${g ? g.name : "Server info"}`, fields });
  } }),
  youtube: (i, env) => ({ defer: async () => {
    const q = optMap(i).query || "";
    if (env && env.YOUTUBE_API_KEY) {
      const r = await getJSON(`https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=1&q=${encodeURIComponent(q)}&key=${env.YOUTUBE_API_KEY}`);
      const it = r && r.items && r.items[0];
      if (it) return msg(`\uD83D\uDD0E **${it.snippet.title}**\nhttps://youtube.com/watch?v=${it.id.videoId}`);
    }
    return msg(`\uD83D\uDD0E Search: https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`);
  } }),

  // ----- news feed: public status + staff config -----
  // `status` is public; every other /news path is a staff config write, so it is private.
  news: (i, env) => ({ ephemeral: subPath(i).sub !== "status", defer: async () => {
    const { group, sub, opts } = subPath(i);
    // /news follow|unfollow is gone: the News Pings and Digest Ping roles were
    // deleted in the Aug 2026 declutter. The wire posts silently and pings nobody, so
    // there is nothing left to opt into.
    if (group === null && sub === "status") {
      const nc = (await getJSON(rawBase(env) + "/newsconfig.json")) || {};
      const cats = Object.entries(nc.categories || {}).map(([k, c]) => `${c.enabled ? "\uD83D\uDFE2" : "\u26AB"} ${c.label || k}`).join("  ");
      const srcs = Object.entries(nc.sources || {}).map(([k, s]) => `${s.enabled ? "\uD83D\uDFE2" : "\u26AB"} ${s.label || k}`).join("  ");
      return embed({ title: "\uD83D\uDDDE\uFE0F News feed", description: [
        `Mode: **${nc.mode || "?"}**. Every story posts silently and pings nobody.`,
        `Topics: ${cats || "_?_"}`,
        `Sources: ${srcs || "_?_"}`,
        `Digest: ${((nc.digest || {}).times_utc || []).join(", ") || "none"} UTC`,
      ].join("\n") });
    }
    const { ok } = await requireStaff(i, env);
    if (!ok) return msg("\u26D4 Staff only (everyone can use `/news status`).", true);
    if (!env.GITHUB_TOKEN) return msg("/news config needs the GITHUB_TOKEN secret on the Worker. See COMMANDS_SETUP.md.", true);
    const { obj: newscfg, sha } = await loadRepoJson(env, "newsconfig.json");
    if (!newscfg) return msg("newsconfig.json isn't in the repo yet \u2014 run a deploy first.", true);
    const updated = applyNewsChange(newscfg, group, sub, opts);
    if (updated._refused === "protected") {
      return msg("\u26D4 `" + (opts.word || "").toLowerCase().trim() + "` is part of the no-gambling rule and can't be removed. "
               + "You can still add your own words. The filter also runs in code, so betting content is blocked "
               + "whether or not it's in this list.", true);
    }
    delete updated._refused;
    const saved = await saveRepoJson(env, "newsconfig.json", updated, sha, `news: ${group ? group + "/" : ""}${sub}`);
    return msg(saved ? "\u2705 Saved \u2014 the news bot picks it up within ~5 minutes (no restart needed)."
                     : "Couldn't save the config (GitHub write failed \u2014 check the GITHUB_TOKEN repo scope).", true);
  } }),

  // ----- moderation (staff only) -----
  mod: (i, env) => ({ ephemeral: true, defer: async () => {
    const { ok } = await requireStaff(i, env);
    if (!ok) return msg("\u26D4 You don't have permission to use /mod.", true);
    if (!env.GITHUB_TOKEN) return msg("\u26A0\uFE0F /mod isn't wired up yet \u2014 set the GITHUB_TOKEN secret on the Worker (see COMMANDS_SETUP.md).", true);
    const { group, sub, opts } = subPath(i);
    const { modcfg, sha } = await loadModconfig(env);
    if (group === null && sub === "status") {
      const chans = Object.keys(modcfg.channels || {}).length;
      const raidOn = (modcfg.raid || {}).enabled ? "on" : "off";
      return embed({ title: "\uD83D\uDEE1\uFE0F Moderation status", description:
        `Channels configured: **${chans}**\nProfiles: ${MOD_PROFILES.join(", ")}\nFilters: ${MOD_CATEGORIES.join(", ")}\nRaid protection: **${raidOn}**` });
    }
    if (group === null && sub === "view") {
      const r = resolveCats(modcfg, opts.channel);
      return embed({ title: "\uD83D\uDD0E Channel rules", description:
        `<#${opts.channel}>\nProfile: **${r.profile}**\nFilters: ${Array.from(r.cats).join(", ") || "_none_"}\nMedia policy: **${r.media}**` });
    }
    const updated = applyModChange(modcfg, group, sub, opts);
    const saved = await saveModconfig(env, updated, sha, `mod: ${group}/${sub}`);
    if (!saved) return msg("Couldn't save the config (GitHub write failed \u2014 check the GITHUB_TOKEN repo scope).", true);
    await dispatchWorkflow(env, "mod_setup.yml");
    return msg("\u2705 Saved. Your change applies within ~1 minute.", true);
  } }),
  warn: (i, env) => ({ ephemeral: true, defer: async () => {
    const { cfg, ok } = await requireStaff(i, env); if (!ok) return msg("\u26D4 No permission.", true);
    const o = optMap(i);
    await postLog(env, cfg, `\u26A0\uFE0F <@${o.user}> was **warned** by <@${i.member.user.id}>${o.reason ? " \u2014 " + o.reason : ""}.`);
    return msg(`\u26A0\uFE0F Warned <@${o.user}>.`, true);
  } }),
  timeout: (i, env) => ({ ephemeral: true, defer: async () => {
    const { cfg, ok } = await requireStaff(i, env); if (!ok) return msg("\u26D4 No permission.", true);
    if (!env.DISCORD_BOT_TOKEN) return msg("\u26A0\uFE0F Needs the DISCORD_BOT_TOKEN secret on the Worker.", true);
    const o = optMap(i); const mins = Math.min(Math.max(parseInt(o.minutes) || 10, 1), 40320);
    const until = new Date(Date.now() + mins * 60000).toISOString();
    const r = await dapi(env, "PATCH", `/guilds/${i.guild_id}/members/${o.user}`, { communication_disabled_until: until });
    if (r.ok) await postLog(env, cfg, `\u23F3 <@${o.user}> timed out **${mins}m** by <@${i.member.user.id}>${o.reason ? " \u2014 " + o.reason : ""}.`);
    return msg(r.ok ? `\u23F3 Timed out <@${o.user}> for ${mins}m.` : "Couldn't time them out (check the bot's role position/permissions).", true);
  } }),
  ban: (i, env) => ({ ephemeral: true, defer: async () => {
    const { cfg, ok } = await requireRank(i, env, ADMIN_UP);
    if (!ok) return msg("\u26D4 Banning is Admin and Owner only.", true);
    if (!env.DISCORD_BOT_TOKEN) return msg("\u26A0\uFE0F Needs the DISCORD_BOT_TOKEN secret on the Worker.", true);
    const o = optMap(i);
    const r = await dapi(env, "PUT", `/guilds/${i.guild_id}/bans/${o.user}`, { delete_message_seconds: 0 });
    if (r.ok) await postLog(env, cfg, `\uD83D\uDD28 <@${o.user}> **banned** by <@${i.member.user.id}>${o.reason ? " \u2014 " + o.reason : ""}.`);
    return msg(r.ok ? `\uD83D\uDD28 Banned <@${o.user}>.` : "Couldn't ban (check the bot's permissions / role order).", true);
  } }),
  unban: (i, env) => ({ ephemeral: true, defer: async () => {
    const { cfg, ok } = await requireRank(i, env, ADMIN_UP);
    if (!ok) return msg("\u26D4 Unbanning is Admin and Owner only.", true);
    if (!env.DISCORD_BOT_TOKEN) return msg("\u26A0\uFE0F Needs the DISCORD_BOT_TOKEN secret on the Worker.", true);
    // user_id is a free-text STRING option (Discord validates USER options, not these),
    // and it lands straight in the API path - so it must be a bare snowflake.
    const id = (optMap(i).user_id || "").trim();
    if (!isSnowflake(id)) return msg("That isn't a valid user ID. Use the 17-19 digit number.", true);
    const r = await dapi(env, "DELETE", `/guilds/${i.guild_id}/bans/${id}`);
    if (r.ok) await postLog(env, cfg, `\u267B\uFE0F \`${id}\` **unbanned** by <@${i.member.user.id}>.`);
    return msg(r.ok ? `\u267B\uFE0F Unbanned \`${id}\`.` : "Couldn't unban (is that ID actually banned?).", true);
  } }),
  clear: (i, env) => ({ ephemeral: true, defer: async () => {
    const { ok } = await requireStaff(i, env); if (!ok) return msg("\u26D4 No permission.", true);
    if (!env.DISCORD_BOT_TOKEN) return msg("\u26A0\uFE0F Needs the DISCORD_BOT_TOKEN secret on the Worker.", true);
    const n = Math.min(Math.max(parseInt(optMap(i).count) || 0, 1), 100);
    const ch = i.channel_id;
    const r = await dapi(env, "GET", `/channels/${ch}/messages?limit=${n}`);
    const ms = r.ok ? await r.json() : [];
    const ids = ms.map(m => m.id);
    if (ids.length >= 2) await dapi(env, "POST", `/channels/${ch}/messages/bulk-delete`, { messages: ids });
    else if (ids.length === 1) await dapi(env, "DELETE", `/channels/${ch}/messages/${ids[0]}`);
    return msg(`\uD83E\uDDF9 Cleared ${ids.length} message(s).`, true);
  } }),
  modlogs: (i, env) => ({ ephemeral: true, defer: async () => {
    const { ok } = await requireStaff(i, env); if (!ok) return msg("\u26D4 No permission.", true);
    const uid = optMap(i).user; const w = await userWarns(env, uid);
    // undefined = we could not unlock the pseudonymous ledger. Saying "no warnings"
    // there would be a lie that hides a real record.
    if (w === undefined) return msg("Can't read the mod ledger: the Worker needs the DISCORD_BOT_TOKEN secret.", true);
    return embed({ title: "\uD83D\uDCCB Mod record", description: w
      ? `<@${uid}>\nWarnings: **${w.warns || 0}**\nLast action: ${w.last || "\u2014"}`
      : `<@${uid}> has no recorded warnings.` });
  } }),
};

// ----- right-click context-menu commands (USER type 2 / MESSAGE type 3) -----
const CONTEXT = {
  "Timeout 10m": (i, env) => ({ ephemeral: true, defer: async () => {
    const { cfg, ok } = await requireStaff(i, env); if (!ok) return msg("\u26D4 No permission.", true);
    if (!env.DISCORD_BOT_TOKEN) return msg("\u26A0\uFE0F Needs the DISCORD_BOT_TOKEN secret.", true);
    const uid = i.data.target_id; const until = new Date(Date.now() + 10 * 60000).toISOString();
    const r = await dapi(env, "PATCH", `/guilds/${i.guild_id}/members/${uid}`, { communication_disabled_until: until });
    if (r.ok) await postLog(env, cfg, `\u23F3 <@${uid}> timed out **10m** by <@${i.member.user.id}> (right-click).`);
    return msg(r.ok ? `\u23F3 Timed out <@${uid}> for 10m.` : "Couldn't time them out.", true);
  } }),
  "Warn": (i, env) => ({ ephemeral: true, defer: async () => {
    const { cfg, ok } = await requireStaff(i, env); if (!ok) return msg("\u26D4 No permission.", true);
    const uid = i.data.target_id;
    await postLog(env, cfg, `\u26A0\uFE0F <@${uid}> was **warned** by <@${i.member.user.id}> (right-click).`);
    return msg(`\u26A0\uFE0F Warned <@${uid}>.`, true);
  } }),
  "Mod record": (i, env) => ({ ephemeral: true, defer: async () => {
    const { ok } = await requireStaff(i, env); if (!ok) return msg("\u26D4 No permission.", true);
    const uid = i.data.target_id; const w = await userWarns(env, uid);
    // undefined = we could not unlock the pseudonymous ledger. Saying "no warnings"
    // there would be a lie that hides a real record.
    if (w === undefined) return msg("Can't read the mod ledger: the Worker needs the DISCORD_BOT_TOKEN secret.", true);
    return embed({ title: "\uD83D\uDCCB Mod record", description: w
      ? `<@${uid}>\nWarnings: **${w.warns || 0}**\nLast action: ${w.last || "\u2014"}`
      : `<@${uid}> has no recorded warnings.` });
  } }),
  "Delete & warn author": (i, env) => ({ ephemeral: true, defer: async () => {
    const { cfg, ok } = await requireStaff(i, env); if (!ok) return msg("\u26D4 No permission.", true);
    if (!env.DISCORD_BOT_TOKEN) return msg("\u26A0\uFE0F Needs the DISCORD_BOT_TOKEN secret.", true);
    const mid = i.data.target_id;
    const m = own((i.data.resolved || {}).messages, mid) || {};
    const author = (m.author || {}).id;
    await dapi(env, "DELETE", `/channels/${i.channel_id}/messages/${mid}`);
    if (author) await postLog(env, cfg, `\uD83D\uDDD1\uFE0F A message from <@${author}> was deleted by <@${i.member.user.id}> (right-click).`);
    return msg("\uD83D\uDDD1\uFE0F Deleted.", true);
  } }),
};

// ---------- /studio: password gate ----------
// WHAT THIS COOKIE SCHEME DOES, AND WHAT IT DOES NOT DO
//   The cookie is `sid = base64url({"exp": <ms>}) . base64url(HMAC-SHA256(payload))`.
//   The HMAC key is STUDIO_SIGNING_KEY, a SEPARATE random secret - never the password.
//   * What the first two designs got wrong. Keying the HMAC with the raw password
//     handed out an offline cracking oracle: the plaintext is fully known
//     ({"exp": <ms>}), so anyone who saw one cookie could grind guesses locally with
//     nothing to rate limit. Deriving the key with PBKDF2 only slowed that down, and
//     cost ~60ms CPU per request - over the Workers free-plan budget, so every login
//     failed with Error 1102. Signing with an INDEPENDENT secret removes the oracle
//     outright: a cookie carries no information about the password at any speed.
//   * Why a fast hash is fine for the password compare. STUDIO_PASSWORD is a generated
//     32+ character random string, not a human-chosen one, so it has token-grade
//     entropy; a slow KDF buys nothing against guessing something unguessable. Both
//     sides are SHA-256'd and compared in constant time over fixed-length bytes.
//   * Both secrets are required. With either unset every /studio route answers 503;
//     the gate never opens by default.
//   * Unforgeable without the password. The payload is public and tamper-EVIDENT, not
//     secret: editing `exp` changes the signed string, the HMAC no longer matches, and
//     the cookie is rejected. Nothing an attacker controls is ever parsed before the
//     signature check passes.
//   * The signature compare is constant time (ctEq), as is the login compare over the
//     SHA-256 digests (ctEqBytes). A byte-by-byte early return would leak the shared
//     prefix and turn forgery into a few hundred requests.
//   * The password itself never leaves the Worker and is never in the cookie, so the
//     cookie cannot be replayed anywhere else (it is not a credential for GitHub,
//     Discord or Cloudflare).
//   * Expiry is inside the SIGNED payload, so a stale cookie cannot be extended by the
//     client. Rotating STUDIO_PASSWORD invalidates every outstanding cookie at once,
//     which is the whole logout-everywhere story.
//   * HttpOnly keeps it away from page script, Secure keeps it off plain HTTP,
//     SameSite=Lax blocks cross-site POSTs (so no CSRF against the write endpoints),
//     and Path=/studio keeps it off the Discord interaction endpoint entirely.
//   Known limits, stated plainly rather than papered over:
//   * No server-side revocation list. Rotate the password to sign everyone out.
//   * It is a bearer token, so anyone who can read the cookie jar is signed in.
//   * The strength of all of this is still the password. It must be a long GENERATED
//     random string: the compare is a plain SHA-256, safe only because the password has
//     token-grade entropy. One under 16 chars still signs in (locking the owner out is
//     worse), but the success response carries X-Studio-Note: weak-password.
//   * There is NO slow KDF anywhere in this gate. Both compares are SHA-256 plus a
//     constant-time byte compare; the only per-attempt cost is the fixed
//     LOGIN_FAIL_DELAY_MS on failure (see loginTooMany).
const STUDIO_COOKIE = "sid";
const STUDIO_TTL_MS = 30 * 24 * 60 * 60 * 1000;      // 30 days
const LOGIN_MAX_FAILS = 8;
const LOGIN_WINDOW_MS = 10 * 60 * 1000;              // per IP, per 10 minutes
const LOGIN_FAIL_DELAY_MS = 250;                     // fixed, added to every failure
const STAGED_LIMIT = 25;

function bytesToB64(bytes) {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}
function b64ToBytes(b64) {
  const bin = atob(String(b64 == null ? "" : b64).replace(/\s/g, ""));
  return Uint8Array.from(bin, c => c.charCodeAt(0));
}
function b64url(bytes) {
  return bytesToB64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlToBytes(s) {
  let t = String(s == null ? "" : s).replace(/-/g, "+").replace(/_/g, "/");
  while (t.length % 4) t += "=";
  return b64ToBytes(t);
}
// Constant-time compare. Length is not treated as secret (both sides are fixed-shape
// base64), but the CONTENT is.
function ctEq(a, b) {
  const enc = new TextEncoder();
  const A = enc.encode(String(a == null ? "" : a));
  const B = enc.encode(String(b == null ? "" : b));
  let diff = A.length ^ B.length;
  const n = Math.max(A.length, B.length, 1);
  for (let i = 0; i < n; i++) diff |= (A[i] || 0) ^ (B[i] || 0);
  return diff === 0;
}
// Constant-time compare over raw bytes, for SHA-256 digests (the password check and
// the signing key). No KDF output exists in this design; SHA-256 is the only hash here.
function ctEqBytes(a, b) {
  const A = a || new Uint8Array(0), B = b || new Uint8Array(0);
  let diff = A.length ^ B.length;
  const n = Math.max(A.length, B.length, 1);
  for (let i = 0; i < n; i++) diff |= (A[i] || 0) ^ (B[i] || 0);
  return diff === 0;
}
// SHA-256 of a secret -> 32 bytes. Fast on purpose, and that is CORRECT here:
// a slow KDF exists to protect a LOW-ENTROPY human password from offline
// guessing. STUDIO_PASSWORD is a generated 32+ character random string, so
// guessing it is infeasible regardless of hash speed, exactly like an API
// token. PBKDF2 at a real work factor costs ~60ms of CPU per request, which
// exceeds the Workers free plan's 10ms budget and would fail every login with
// Error 1102. Weakening the iteration count would have been the worst of both
// worlds, so the design changed instead: see studioSignKey below.
async function sha256Bytes(value) {
  const enc = new TextEncoder();
  const d = await crypto.subtle.digest("SHA-256",
    enc.encode(String(value === null || value === undefined ? "" : value)));
  return new Uint8Array(d);
}
// THE SESSION SIGNING KEY IS A SEPARATE SECRET, NOT THE PASSWORD.
// That is what closes the offline-cracking oracle the review found: a cookie
// is {"exp":...} plus an HMAC, i.e. a known plaintext with its tag. When the
// HMAC key was the password itself, one stolen cookie let an attacker grind
// password guesses offline with no rate limit. Signing with an independent
// random secret means a cookie reveals nothing about the password, and a
// stolen cookie only ever proves it was minted here.
// STUDIO_SIGNING_KEY is required; with it unset /studio is 503, never open.
const _signKeyCache = new Map();
async function studioSignKey(env) {
  const raw = String((env && env.STUDIO_SIGNING_KEY) || "");
  if (!raw) return null;
  let p = _signKeyCache.get(raw);
  if (!p) {
    p = sha256Bytes(raw);                      // normalise any length to 32 bytes
    p.catch(function () { _signKeyCache.delete(raw); });
    if (_signKeyCache.size > 4) _signKeyCache.clear();
    _signKeyCache.set(raw, p);
  }
  return await p;
}
// Constant-time password check. Both sides are hashed first so the comparison
// is over fixed-length bytes and cannot leak the length or a shared prefix.
async function studioPasswordOk(env, candidate) {
  const pw = String((env && env.STUDIO_PASSWORD) || "");
  if (!pw || typeof candidate !== "string" || !candidate) return false;
  const a = await sha256Bytes(pw), b = await sha256Bytes(candidate);
  return ctEqBytes(a, b);
}
// `key` is the 32-byte SHA-256 of STUDIO_SIGNING_KEY (Uint8Array). A string is accepted
// only so a test can prove that a cookie signed with the RAW password is rejected.
async function hmacB64url(key, message) {
  const raw = (key instanceof Uint8Array) ? key : new TextEncoder().encode(String(key));
  const k = await crypto.subtle.importKey("raw", raw,
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(String(message)));
  return b64url(new Uint8Array(sig));
}
// Mint a session token. `now` is injectable so the tests can mint an expired one.
async function studioToken(env, now) {
  const t = typeof now === "number" ? now : Date.now();
  const key = await studioSignKey(env);
  if (!key) return null;
  const payload = b64url(new TextEncoder().encode(JSON.stringify({ exp: t + STUDIO_TTL_MS })));
  return payload + "." + await hmacB64url(key, payload);
}
async function studioTokenValid(env, token, now) {
  if (!env || !env.STUDIO_PASSWORD || !env.STUDIO_SIGNING_KEY
      || typeof token !== "string") return false;
  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return false;
  let expected;
  try { expected = await hmacB64url(await studioSignKey(env), parts[0]); } catch (e) { return false; }
  // Signature FIRST: nothing attacker-controlled is parsed until the MAC checks out.
  if (!ctEq(parts[1], expected)) return false;
  let obj;
  try { obj = JSON.parse(new TextDecoder().decode(b64urlToBytes(parts[0]))); }
  catch (e) { return false; }
  const exp = obj && Number(obj.exp);
  return Number.isFinite(exp) && exp > (typeof now === "number" ? now : Date.now());
}
function cookieValue(request, name) {
  const raw = (request && request.headers && request.headers.get("cookie")) || "";
  for (const part of raw.split(";")) {
    const p = part.trim();
    const eq = p.indexOf("=");
    if (eq > 0 && p.slice(0, eq) === name) return p.slice(eq + 1);
  }
  return null;
}
// The one gate every /studio route goes through.
async function requireStudio(request, env) {
  return await studioTokenValid(env, cookieValue(request, STUDIO_COOKIE), Date.now());
}
// PER ISOLATE, and that is a real limit, not a formality. Cloudflare runs many isolates
// per colo and many colos worldwide; each one keeps its own Map, so the true ceiling is
// LOGIN_MAX_FAILS times however many isolates an attacker's traffic happens to land on,
// and a restart empties the count entirely. This is NOT distributed rate limiting and
// nothing here should be read as claiming it is. What actually slows online guessing:
//   1. every failed attempt pays the fixed LOGIN_FAIL_DELAY_MS before it answers, and
//   2. the compare itself is a fast SHA-256, which is safe only because the password is
//      a generated high-entropy string that guessing cannot reach at any request rate.
// Real distributed limiting would need Durable Objects or KV; that is a deliberate
// not-yet, and the honest boundary remains a long random password.
// Degrading to "no limit" on restart is also deliberate; the alternative (fail closed on
// an empty map) would lock the owner out every time Cloudflare recycles the isolate.
const _loginFails = new Map();
function loginTooMany(ip, now) {
  const t = typeof now === "number" ? now : Date.now();
  const e = _loginFails.get(ip || "?");
  return !!(e && e.until > t && e.n >= LOGIN_MAX_FAILS);
}
function noteLoginFail(ip, now) {
  const t = typeof now === "number" ? now : Date.now();
  const key = ip || "?";
  const e = _loginFails.get(key);
  if (!e || e.until <= t) _loginFails.set(key, { n: 1, until: t + LOGIN_WINDOW_MS });
  else e.n += 1;
  if (_loginFails.size > 5000) {                       // bounded: never a memory leak
    for (const [k, v] of _loginFails) if (v.until <= t) _loginFails.delete(k);
  }
}
function clearLoginFails(ip) { _loginFails.delete(ip || "?"); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ---------- /studio: responses ----------
const STUDIO_HEADERS = {
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
};
// default-src 'none' plus exactly what the pages use. frame-ancestors stops clickjacking
// of the write endpoints; connect-src is 'self' plus the two Discord CDN hosts and
// NOTHING else, so a caption pulled out of Discord still cannot be turned into an
// exfiltration channel by the page that renders it.
// The CDN hosts are here because the page has to fetch the staged poster to work with
// it (drawing it into a canvas taints the canvas unless the bytes arrive by fetch), and
// with connect-src 'self' every one of those loads was a blocked request plus a console
// violation. img-src names the same two hosts instead of a blanket `https:`: a wide-open
// img-src is itself a quiet exfiltration channel, since an <img> URL carries whatever
// the page appends to it. Anything the page draws itself goes through data:/blob:.
const DISCORD_CDN_HOSTS = Object.freeze(["cdn.discordapp.com", "media.discordapp.net"]);
const DISCORD_CDN_SRC = DISCORD_CDN_HOSTS.map(h => "https://" + h).join(" ");
const STUDIO_CSP = [
  "default-src 'none'",
  "img-src 'self' data: blob: " + DISCORD_CDN_SRC,
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src https://fonts.gstatic.com data:",
  "script-src 'self' 'unsafe-inline'",
  "connect-src 'self' " + DISCORD_CDN_SRC,
  "form-action 'self'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
].join("; ");
function studioJson(obj, status, extra) {
  return new Response(JSON.stringify(obj), { status: status || 200,
    headers: { "content-type": "application/json; charset=utf-8", ...STUDIO_HEADERS,
               ...(extra || {}) } });
}
function studioText(text, status) {
  return new Response(text, { status: status || 200,
    headers: { "content-type": "text/plain; charset=utf-8", ...STUDIO_HEADERS } });
}
function studioHtml(html) {
  return new Response(html, { status: 200,
    headers: { "content-type": "text/html; charset=utf-8",
               "content-security-policy": STUDIO_CSP, ...STUDIO_HEADERS } });
}
function cookieHeader(value, maxAge) {
  return STUDIO_COOKIE + "=" + value + "; HttpOnly; Secure; SameSite=Lax; Path=/studio; Max-Age=" + maxAge;
}

// The gate page. Dark, purple, Poppins, one password field and nothing else: it names
// no product, no owner and no capability, so an unauthenticated visitor learns only
// that something here wants a password.
const LOGIN_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#0b0b11">
<meta name="robots" content="noindex, nofollow">
<title>Sign in</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Poppins:wght@600;800&display=swap" rel="stylesheet">
<style>
:root{--bg:#0b0b11;--card:#14141d;--line:#23232f;--text:#f2f2f7;--dim:#9b9ba8;--accent:#8B70FF}
*{box-sizing:border-box;margin:0;padding:0}
html{-webkit-text-size-adjust:100%}
body{background:var(--bg);color:var(--text);font-family:Poppins,system-ui,sans-serif;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px}
form{width:100%;max-width:340px;display:grid;gap:14px}
h1{font-size:20px;font-weight:800;letter-spacing:.4px;text-align:center}
label{display:block;margin-bottom:6px;font-size:12px;font-weight:600;letter-spacing:1.2px;text-transform:uppercase;color:var(--dim)}
input{width:100%;background:var(--card);border:1px solid var(--line);border-radius:12px;color:var(--text);font:500 16px Poppins,sans-serif;padding:14px;min-height:52px;outline:none}
input:focus{border-color:var(--accent)}
button{width:100%;font:800 15px Poppins,sans-serif;border-radius:12px;border:1px solid var(--accent);background:var(--accent);color:#0b0b11;padding:14px 18px;min-height:52px;cursor:pointer}
p{min-height:18px;text-align:center;font-size:13px;font-weight:600;color:#ff9a9a}
</style>
</head>
<body>
<form id="f">
<h1>Sign in</h1>
<div><label for="p">Password</label><input id="p" name="password" type="password" autocomplete="current-password" required autofocus></div>
<button type="submit">Continue</button>
<p id="e" role="alert"></p>
</form>
<script>
(function () {
  "use strict";
  var f = document.getElementById("f"), p = document.getElementById("p"), e = document.getElementById("e");
  f.addEventListener("submit", function (ev) {
    ev.preventDefault();
    e.textContent = "";
    fetch("/studio/login", { method: "POST", headers: { "content-type": "application/json" },
                             body: JSON.stringify({ password: p.value }) })
      .then(function (r) {
        if (r.ok) { location.replace("/studio"); return; }
        e.textContent = r.status === 429 ? "Too many attempts. Wait a few minutes." : "Sign in failed.";
        p.value = "";
      })
      .catch(function () { e.textContent = "Sign in failed."; });
  });
})();
</script>
</body>
</html>
`;

async function studioLogin(request, env) {
  const ip = request.headers.get("cf-connecting-ip") || "?";
  const now = Date.now();
  if (loginTooMany(ip, now)) return studioJson({ error: "too many attempts" }, 429);
  let supplied = "";
  try {
    const ctype = String(request.headers.get("content-type") || "");
    if (ctype.indexOf("application/json") !== -1) {
      const b = await request.json();
      supplied = String((b && b.password) || "");
    } else {
      const f = await request.formData();
      supplied = String(f.get("password") || "");
    }
  } catch (e) { supplied = ""; }
  // Constant-time compare of SHA-256(candidate) against SHA-256(configured).
  // Fixed-length bytes, so neither the length nor a shared prefix leaks.
  let ok = false;
  try { ok = await studioPasswordOk(env, supplied); } catch (e) { ok = false; }
  if (!ok) {
    noteLoginFail(ip, now);
    await sleep(LOGIN_FAIL_DELAY_MS);       // fixed, not a function of the guess
    // Deliberately generic. No "wrong password" against "no session", no hint about
    // what is behind the gate, and the same shape for every failure.
    return studioJson({ error: "sign in failed" }, 401);
  }
  clearLoginFails(ip);
  let token = null;
  try { token = await studioToken(env, now); } catch (e) { token = null; }
  // Only reachable if WebCrypto itself failed. Better a plain 503 than a cookie built
  // out of "null", which would look like a session and authenticate nothing.
  if (!token) return studioJson({ error: "could not start a session" }, 503);
  const headers = { "content-type": "application/json; charset=utf-8",
                    "set-cookie": cookieHeader(token, Math.floor(STUDIO_TTL_MS / 1000)),
                    ...STUDIO_HEADERS };
  // A password under 16 chars undermines the fast-hash design documented above. It
  // still signs in (locking the owner out is worse than the weakness), but the SUCCESS
  // response says so in a header the owner can see in devtools. Never on a failure: a
  // 401 goes to whoever is guessing, and "the password is short" is a hint this gate
  // does not hand out.
  if (String((env && env.STUDIO_PASSWORD) || "").length < 16) {
    headers["x-studio-note"] = "weak-password";
  }
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
}

// ---------- /studio: staged posts ----------
// A URL is usable as a poster only if it is https AND lives on a Discord CDN host.
// Anyone who can post in the staging channel could otherwise point the page at a host
// they control: the fetch/<img> then carries the studio's referer and load timing to a
// third party, and the "poster" the owner reviews is not the one the bot rendered.
// Parsed with the real URL parser, so "https://cdn.discordapp.com@evil.example/x" (host
// evil.example) and "https://evil.example/cdn.discordapp.com" both fail.
function discordCdnUrl(u) {
  const s = (typeof u === "string" ? u : "").trim();
  if (s.indexOf("https://") !== 0) return null;
  let host = "";
  try { host = new URL(s).hostname.toLowerCase(); } catch (e) { return null; }
  return DISCORD_CDN_HOSTS.indexOf(host) === -1 ? null : s;
}
// Split a staged message body into the caption and, when the staging bot ships one, the
// poster spec. The FIRST plain fence is the caption; a ```json fence is metadata.
function stagedParts(content) {
  const re = /```([a-zA-Z0-9_+-]*)\n?([\s\S]*?)```/g;
  let caption = "", meta = null, m;
  while ((m = re.exec(String(content || ""))) !== null) {
    const info = (m[1] || "").toLowerCase();
    const body = (m[2] || "").trim();
    if (info === "json") {
      if (meta === null) {
        try {
          const o = JSON.parse(body);
          if (o && typeof o === "object" && !Array.isArray(o)) meta = o;
        } catch (e) { /* a bad spec is just no spec */ }
      }
      continue;
    }
    if (!caption) caption = body;
  }
  // hasSpec tells the page whether this post ROUND-TRIPS (the staging bot
  // shipped a spec fence) - a spec post with no photo is a deliberate wash
  // design, while a spec-LESS photoless post predates the round-trip and its
  // only image has the text baked in. The page words its toasts off this.
  return { caption, meta: meta || {}, hasSpec: meta !== null };
}
function metaStr(meta, key, cap) {
  const v = own(meta, key);
  return typeof v === "string" ? v.trim().slice(0, cap || 200) : "";
}
// First non-empty caption line: build_caption() puts the headline there.
function captionHeadline(caption) {
  for (const l of String(caption || "").split("\n")) {
    const t = l.trim();
    if (t) return t.slice(0, 200);
  }
  return "";
}
// build_caption() signs off with "via <source>"; that is the attribution the poster
// footer renders, so the page gets it even before the bot ships a spec block.
function captionSource(caption) {
  const m = /^\s*via\s+(.{1,80}?)\s*$/mi.exec(String(caption || ""));
  return m ? m[1].trim() : "";
}
// Same-origin proxy path for one staged attachment (served by studioImg).
// Discord CDN attachment urls are SIGNED with a ~24h expiry (ex/is/hm query
// params): handing them to the page worked in a fresh tab but broke in the
// installed app reopened a day later - the rail thumbnails 404'd and the
// round-trip photo "would not load" (the owner's exact report). The proxy
// re-reads the message with the bot token at fetch time, so the url the page
// holds never goes stale, and the bytes arrive same-origin so the canvas
// never taints.
function stagedImgPath(mid, idx) {
  return "/studio/api/img/" + mid + "/" + idx;
}
// PURE: Discord messages -> the studio queue. Exactly the SEVENTEEN contract fields
// ever leave the Worker. No author, no member ids, no bot token, nothing from any other
// channel, and nothing from any other author (see parseStaged).
// Message shape written by the staging bot: "Staged post - score NN (why)" followed by
// the caption in a fenced block, with the poster as the first attachment. line/speaker/
// source/about/hot/bg come from an optional ```json spec fence and degrade to empty.
function parseStagedOne(m) {
  const content = String((m && m.content) || "");
  const head = /score\s+(\d{1,3})\s*(?:\(([^)]*)\))?/i.exec(content);
  const { caption, meta, hasSpec } = stagedParts(content);
  const mid = String((m && m.id) || "");
  const atts = (m && m.attachments) || [];
  const att = atts[0] || {};
  const att2 = atts[1] || {};
  const emb = (((m && m.embeds) || [])[0]) || {};
  const attUrl = typeof att.url === "string" ? att.url : "";
  const att2Url = typeof att2.url === "string" ? att2.url : "";
  const embUrl = (emb.image && typeof emb.image.url === "string") ? emb.image.url : "";
  const hotRaw = own(meta, "hot");
  const photoKind = metaStr(meta, "photo", 12);
  return {
    id: mid,
    score: head ? Number(head[1]) : null,
    why: head && head[2] ? head[2].trim() : "",
    caption,
    line: metaStr(meta, "line", 200) || captionHeadline(caption),
    speaker: metaStr(meta, "speaker", 80),
    source: metaStr(meta, "source", 80) || captionSource(caption),
    about: metaStr(meta, "about", 120),
    hot: (Array.isArray(hotRaw) ? hotRaw : [])
      .filter(w => typeof w === "string" && w.trim())
      .slice(0, 8).map(w => w.trim().slice(0, 60)),
    // The Discord-CDN gate still decides whether an image EXISTS (a
    // javascript:, data: or attacker-hosted value must never survive the
    // trip) - but what ships to the page is the same-origin PROXY path, never
    // the expiring CDN url itself. The embed fallback (legacy posts only) has
    // no attachment index to proxy, so it stays a gated direct url.
    image_url: attUrl ? (discordCdnUrl(attUrl) ? stagedImgPath(mid, 0) : null)
                      : discordCdnUrl(embUrl),
    // The ROUND-TRIP payload: attachment 1 is the RAW subject the staging bot
    // rendered from (photo or promo cutout, named by the spec's "photo" key).
    // The studio loads THIS into its editor - never the rendered card, whose
    // text is baked into the pixels. Same CDN gate, same proxy.
    photo_url: discordCdnUrl(att2Url) ? stagedImgPath(mid, 1) : null,
    photo_kind: photoKind === "cutout" ? "cutout" : (photoKind === "photo" ? "photo" : ""),
    template: metaStr(meta, "template", 20),
    colorway: metaStr(meta, "colorway", 20),
    // the texture plate a photoless render sat on, so the editor reopens the
    // same scene; and whether the post round-trips at all (see stagedParts)
    bg: metaStr(meta, "bg", 20),
    spec: hasSpec,
    timestamp: (m && m.timestamp) || null,
  };
}
// `botId` is REQUIRED and the filter fails closed without it. The staging channel is a
// staff channel, but "staff" is not "us": anyone who can post there could write
// "Staged post - score 99" with their own caption and image and it would appear in the
// owner's queue as if the pipeline had produced it. Only messages authored by this
// application's own bot user are staged posts.
function parseStaged(messages, botId) {
  const bot = isSnowflake(botId) ? String(botId).trim() : null;
  if (!bot) return [];
  // ANCHORED to the message start (after an optional owner ping): the phrase
  // "staged post" appearing anywhere in model-written poll text must not pull
  // a poll message into the news rail. Only ytposts' own header shape passes.
  return (Array.isArray(messages) ? messages : [])
    .filter(m => m && m.author && String(m.author.id) === bot)
    .filter(m => /^(?:<@\d{15,21}>\s*)?staged\s+post/i.test(String(m.content || "")))
    .map(parseStagedOne);
}
// Who are we. GET /users/@me with the bot token answers with this application's bot
// user; cached per isolate because it never changes for a given token.
let _meCache = { at: 0, id: null };
async function botUserId(env) {
  const now = Date.now();
  if (_meCache.id && now - _meCache.at < 3600000) return _meCache.id;   // 1-hour cache
  if (!env || !env.DISCORD_BOT_TOKEN) return null;
  let me = null;
  try {
    const r = await dapi(env, "GET", "/users/@me");
    if (r && r.ok) me = await r.json();
  } catch (e) { me = null; }
  const id = me && me.id;
  if (!isSnowflake(id)) return null;
  _meCache = { at: now, id: String(id) };
  return _meCache.id;
}
async function studioStaged(env) {
  if (!env.DISCORD_BOT_TOKEN) return studioJson({ error: "the worker needs the DISCORD_BOT_TOKEN secret" }, 503);
  const cfg = await botsConfig(env);                    // raw CDN read, cached 5 minutes
  const ch = ((cfg || {}).channels || {}).studio;
  // Hard fail. With no configured studio channel there is no safe default: falling back
  // to "some" channel would publish member chat through an API meant for one queue.
  if (!isSnowflake(ch)) return studioJson({ error: "channels.studio is missing from bots_config.json" }, 503);
  // Fail closed: without our own user id there is no way to tell our posts from anyone
  // else's, and an unfiltered queue is the bug this check exists to prevent.
  const me = await botUserId(env);
  if (!me) return studioJson({ error: "could not identify the bot user" }, 502);
  const r = await dapi(env, "GET", "/channels/" + ch + "/messages?limit=" + STAGED_LIMIT);
  if (!r || !r.ok) return studioJson({ error: "could not read the staging channel" }, 502);
  let list = [];
  try { list = await r.json(); } catch (e) { list = []; }
  return studioJson(parseStaged(list, me), 200);
}

// ---------- /studio: staged-attachment proxy ----------
// Serves ONE attachment of ONE staged message, same-origin, behind the session
// gate. The page holds only /studio/api/img/<message id>/<0|1> paths, which
// never expire; the CDN's signed url is re-derived here at fetch time. Scope
// is locked the same three ways as the staged list: only the configured studio
// channel, only messages authored by this bot, and only attachment 0 or 1 -
// no other channel, author or file is reachable through this route.
const STAGED_IMG_IDX = Object.freeze(["0", "1"]);
let _imgMsgCache = Object.create(null);   // message id -> {at, atts} per isolate
const IMG_MSG_CACHE_CAP = 64;
async function studioImg(env, mid, idx) {
  if (!isSnowflake(mid) || STAGED_IMG_IDX.indexOf(idx) === -1) {
    return studioJson({ error: "not found" }, 404);
  }
  if (!env.DISCORD_BOT_TOKEN) return studioJson({ error: "the worker needs the DISCORD_BOT_TOKEN secret" }, 503);
  const cfg = await botsConfig(env);
  const ch = ((cfg || {}).channels || {}).studio;
  if (!isSnowflake(ch)) return studioJson({ error: "channels.studio is missing from bots_config.json" }, 503);
  const me = await botUserId(env);
  if (!me) return studioJson({ error: "could not identify the bot user" }, 502);
  const now = Date.now();
  let hit = _imgMsgCache[String(mid)];
  if (!hit || now - hit.at > 3600000) {                // 1 h: the CDN url is
                                                      // re-derived on every hit,
                                                      // so a longer cache costs
                                                      // nothing and removes a
                                                      // Discord call per tile
    const r = await dapi(env, "GET", "/channels/" + ch + "/messages/" + mid);
    // A THROTTLED REQUEST IS NOT A MISSING IMAGE. This returned 404 for ANY
    // non-ok response, so one Discord 429 turned a real thumbnail into a
    // permanent blank tile: the page has no reason to retry a 404, and the tile
    // stayed empty until a manual Refresh. A cold rail fires up to 25 of these at
    // once, so 429s are the normal case, not the exception. 503 + Retry-After
    // tells the page to come back.
    if (r && r.status === 429) {
      let wait = 2;
      try {
        const b = await r.clone().json();
        if (b && typeof b.retry_after === "number") wait = Math.min(30, Math.max(1, Math.ceil(b.retry_after)));
      } catch (e) { /* header fallback below */ }
      const hdr = r.headers && r.headers.get("retry-after");
      if (hdr && !isNaN(Number(hdr))) wait = Math.min(30, Math.max(1, Math.ceil(Number(hdr))));
      return studioJson({ error: "rate limited, retry" }, 503, { "retry-after": String(wait) });
    }
    if (!r || !r.ok) return studioJson({ error: "not found" }, 404);
    let msg = null;
    try { msg = await r.json(); } catch (e) { msg = null; }
    // fail closed, exactly like parseStaged: a message someone else posted in
    // the staging channel must not become fetchable through the bot's token
    if (!msg || !msg.author || String(msg.author.id) !== me) {
      return studioJson({ error: "not found" }, 404);
    }
    hit = {
      at: now,
      atts: (Array.isArray(msg.attachments) ? msg.attachments : []).map(a => ({
        url: (a && typeof a.url === "string") ? a.url : "",
        ct: (a && typeof a.content_type === "string") ? a.content_type : "",
      })),
    };
    const keys = Object.keys(_imgMsgCache);
    if (keys.length >= IMG_MSG_CACHE_CAP) {
      // evict the OLDEST, not whichever key insertion order puts first - the
      // latter can drop an entry that was just fetched
      let oldK = keys[0], oldT = Infinity;
      for (const kk of keys) {
        const at = (_imgMsgCache[kk] || {}).at || 0;
        if (at < oldT) { oldT = at; oldK = kk; }
      }
      delete _imgMsgCache[oldK];
    }
    _imgMsgCache[String(mid)] = hit;
  }
  const att = hit.atts[Number(idx)];
  const u = att ? discordCdnUrl(att.url) : null;
  if (!u) return studioJson({ error: "not found" }, 404);
  let up = null;
  try { up = await fetch(u); } catch (e) { up = null; }
  if (up && up.status === 429) {
    return studioJson({ error: "rate limited, retry" }, 503, { "retry-after": "3" });
  }
  if (!up || !up.ok) return studioJson({ error: "image unavailable" }, 502);
  const raw = (att.ct && /^image\//.test(att.ct)) ? att.ct
            : String(up.headers.get("content-type") || "");
  // RASTER types only, never image/* - image/svg+xml is a scriptable
  // document, and this route serves bot-relayed bytes same-origin. The
  // sandbox CSP is belt-and-braces for the same reason: even a mislabeled
  // body can never execute in the studio origin.
  const RASTER = ["image/png", "image/jpeg", "image/webp", "image/gif"];
  const ct = RASTER.indexOf(raw.split(";")[0].trim().toLowerCase()) === -1
    ? "image/png" : raw.split(";")[0].trim().toLowerCase();
  return new Response(up.body, { status: 200, headers: {
    "content-type": ct,
    "content-security-policy": "default-src 'none'; sandbox",
    "cache-control": "private, max-age=3600",
    "x-content-type-options": "nosniff",
  } });
}

// ---------- /studio: background texture plates ----------
// The wash textures (backgrounds/*.jpg in the public repo) served SAME-ORIGIN so
// the editor canvas never taints: a raw-CDN <img> needs CORS luck to survive
// toBlob, and routing through the session gate keeps the fetch pattern identical
// to every other studio asset. Frozen allowlist + pinned extension - the path
// segment can never name any other repo file.
const STUDIO_BGS = Object.freeze(["arena", "spotlight", "cage", "smoke"]);
const _bgCache = Object.create(null);   // name -> {at, buf} per isolate
async function studioBg(env, name) {
  if (STUDIO_BGS.indexOf(name) === -1) return studioJson({ error: "not found" }, 404);
  const now = Date.now();
  const hit = _bgCache[name];
  const headers = { "content-type": "image/jpeg",
                    "cache-control": "private, max-age=86400" };
  if (hit && now - hit.at < 3600000) return new Response(hit.buf, { status: 200, headers });
  let r = null;
  try { r = await fetch(rawBase(env) + "/backgrounds/" + name + ".jpg"); } catch (e) { r = null; }
  if (!r || !r.ok) return studioJson({ error: "plate unavailable" }, 502);
  const buf = await r.arrayBuffer();
  _bgCache[name] = { at: now, buf };
  return new Response(buf, { status: 200, headers });
}

// ---------- /studio: AI key ----------
// Allowlist, not a caller-built name: the provider string never reaches the API path.
// This USED to be a bypass. `AI_PROVIDERS[provider]` is a prototype-chain lookup, so
// provider="__proto__" returned Object.prototype (truthy), the "unknown provider" check
// passed, and the secret name concatenated into the URL as "[object Object]":
//   PUT https://api.github.com/repos/o/r/actions/secrets/[object Object]
// "constructor" and "toString" did the same with different garbage. The gate is now an
// includes() on a frozen list plus an own-property read, and the resolved name has to
// match the shape GitHub accepts before it can reach a path.
// Adding a provider means adding it in BOTH places below. The list is the gate and the
// map is the lookup; a name that appears in only one of them resolves to null and is
// simply rejected, which is the safe direction for a typo to fail in.
const AI_PROVIDER_NAMES = Object.freeze([
  "deepseek", "openrouter", "zai", "groq", "together", "mistral", "openai",
]);
const AI_PROVIDERS = Object.freeze({
  deepseek:   "DEEPSEEK_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
  zai:        "ZAI_API_KEY",
  groq:       "GROQ_API_KEY",
  together:   "TOGETHER_API_KEY",
  mistral:    "MISTRAL_API_KEY",
  openai:     "OPENAI_API_KEY",
});
// All seven speak the SAME OpenAI chat-completions request shape, so a provider is
// fully described by three strings: where to POST, what to call the model, and which
// secret holds the key. Nothing here is a secret; these are public endpoint facts.
// Each URL and default model was checked against the provider's own docs in Aug 2026:
//   zai        Z.ai (Zhipu) publishes https://api.z.ai/api/paas/v4/ as its
//              OpenAI-compatible base, and glm-4.5-flash is still on the free tier.
//   openrouter deepseek/deepseek-chat is NO LONGER a slug OpenRouter lists; the model
//              index was renamed, so the default is a slug that currently exists.
//              Sending the retired one would have failed every call with a 404.
//   groq       a third-party page claimed llama-3.3-70b-versatile was retired in June
//              2026; Groq's own model page still lists it as active production, so the
//              first-party source wins. openai/gpt-oss-120b is the migration target if
//              that ever changes.
// The model is a DEFAULT, not a constraint: the caller may send any model the provider
// accepts, so a rename costs one string here and never a code change.
const AI_ENDPOINTS = Object.freeze({
  deepseek: Object.freeze({ label: "DeepSeek",
    url: "https://api.deepseek.com/chat/completions", model: "deepseek-chat" }),
  openrouter: Object.freeze({ label: "OpenRouter",
    url: "https://openrouter.ai/api/v1/chat/completions", model: "deepseek/deepseek-v3.2" }),
  zai: Object.freeze({ label: "Z.ai GLM",
    url: "https://api.z.ai/api/paas/v4/chat/completions", model: "glm-4.5-flash" }),
  groq: Object.freeze({ label: "Groq",
    url: "https://api.groq.com/openai/v1/chat/completions", model: "llama-3.3-70b-versatile" }),
  together: Object.freeze({ label: "Together",
    url: "https://api.together.xyz/v1/chat/completions", model: "meta-llama/Llama-3.3-70B-Instruct-Turbo" }),
  mistral: Object.freeze({ label: "Mistral",
    url: "https://api.mistral.ai/v1/chat/completions", model: "mistral-small-latest" }),
  openai: Object.freeze({ label: "OpenAI",
    url: "https://api.openai.com/v1/chat/completions", model: "gpt-4o-mini" }),
});
const SECRET_NAME = /^[A-Z][A-Z0-9_]{2,99}$/;
function aiSecretName(provider) {
  const p = String(provider === null || provider === undefined ? "" : provider).toLowerCase();
  if (AI_PROVIDER_NAMES.indexOf(p) === -1) return null;
  const name = own(AI_PROVIDERS, p);
  return (typeof name === "string" && SECRET_NAME.test(name)) ? name : null;
}
// Same gate shape as aiSecretName: the frozen list decides, then an own-property read.
// Returns null for anything off the list, so "__proto__" cannot produce an endpoint.
function aiEndpoint(provider) {
  const p = String(provider === null || provider === undefined ? "" : provider).toLowerCase();
  if (AI_PROVIDER_NAMES.indexOf(p) === -1) return null;
  const meta = own(AI_ENDPOINTS, p);
  return (meta && typeof meta.url === "string") ? meta : null;
}
// libsodium's crypto_box_seal, which is the only format GitHub's Actions secrets API
// accepts: ephemeral X25519 keypair, nonce = blake2b(epk || recipient_pk, 24 bytes),
// output = epk || crypto_box_easy(secret, nonce, recipient_pk, esk).
// tweetnacl gives crypto_box_easy; blakejs gives the generichash. Both are pure JS and
// wrangler bundles them. If either is missing the caller returns 501 rather than
// shipping a payload GitHub would store as garbage.
async function sealBox(messageBytes, recipientKeyB64) {
  let nacl, blake;
  try {
    nacl = (await import("tweetnacl")).default;
    blake = await import("blakejs");
  } catch (e) { return null; }
  const b2b = (blake && (blake.blake2b || (blake.default && blake.default.blake2b))) || null;
  if (!nacl || !nacl.box || !nacl.box.keyPair || !b2b) return null;
  let rpk;
  try { rpk = b64ToBytes(recipientKeyB64); } catch (e) { return null; }
  if (rpk.length !== 32) return null;
  const eph = nacl.box.keyPair();
  const nonceInput = new Uint8Array(64);
  nonceInput.set(eph.publicKey, 0);
  nonceInput.set(rpk, 32);
  const nonce = b2b(nonceInput, null, 24);
  const boxed = nacl.box(messageBytes, nonce, rpk, eph.secretKey);
  if (!boxed) return null;
  const out = new Uint8Array(32 + boxed.length);
  out.set(eph.publicKey, 0);
  out.set(boxed, 32);
  return bytesToB64(out);
}
async function putRepoSecret(env, name, value) {
  const pk = await getJSON(ghBase(env) + "/actions/secrets/public-key", ghHeaders(env));
  if (!pk || !pk.key || !pk.key_id) {
    return { ok: false, status: 502, error: "could not read the repository public key (check the GITHUB_TOKEN repo scope)" };
  }
  const sealed = await sealBox(new TextEncoder().encode(value), pk.key);
  if (!sealed) {
    return { ok: false, status: 501,
             error: "sealed box encryption is not available in this build: run npm install in commands_worker, then redeploy the worker" };
  }
  const r = await fetch(ghBase(env) + "/actions/secrets/" + name, { method: "PUT",
    headers: ghHeaders(env), body: JSON.stringify({ encrypted_value: sealed, key_id: pk.key_id }) });
  if (r.ok) return { ok: true, status: r.status };
  return { ok: false, status: 502, error: "github refused the write (HTTP " + r.status + ")" };
}
// The list endpoint returns NAMES and timestamps. Actions secret VALUES cannot be read
// back out at all, by GitHub's design, so there is no key material on this path.
// null (not an empty set) when the list could not be read, so a caller can tell
// "no keys stored" apart from "could not ask", and report the difference honestly.
async function ghSecretNames(env) {
  const r = await getJSON(ghBase(env) + "/actions/secrets?per_page=100", ghHeaders(env));
  if (!r || !Array.isArray(r.secrets)) return null;
  return new Set(r.secrets.map(s => String((s && s.name) || "").toUpperCase()));
}
async function studioAiKeyStatus(env) {
  if (!env.GITHUB_TOKEN) return studioJson({ error: "the worker needs the GITHUB_TOKEN secret" }, 503);
  const names = (await ghSecretNames(env)) || new Set();
  // Null prototype and keys drawn from the frozen list only: the response can never
  // carry a provider name a caller invented, nor an inherited one.
  const providers = Object.create(null);
  for (const p of AI_PROVIDER_NAMES) providers[p] = names.has(aiSecretName(p));
  return studioJson({ providers }, 200);
}
async function studioAiKeySave(request, env) {
  if (!env.GITHUB_TOKEN) return studioJson({ error: "the worker needs the GITHUB_TOKEN secret" }, 503);
  let body = {};
  try { body = await request.json(); } catch (e) { body = {}; }
  const provider = String((body && body.provider) || "").toLowerCase();
  // Ownership test, never a prototype-chain lookup. Nothing reaches the network until
  // the provider matched the frozen list, so "__proto__" costs an attacker one 400.
  const name = aiSecretName(provider);
  if (!name) return studioJson({ error: "unknown provider" }, 400);
  const key = String((body && body.key) || "").trim();
  // Shape check only, and the value is never echoed back, never logged and never put in
  // an error string.
  if (key.length < 8 || key.length > 512 || /[^!-~]/.test(key)) {
    return studioJson({ error: "that does not look like an API key" }, 400);
  }
  const res = await putRepoSecret(env, name, key);
  if (res.ok) return studioJson({ ok: true, provider: provider, stored: true }, 200);
  return studioJson({ ok: false, error: res.error }, res.status);
}

// ---------- /studio: usage ----------
// THE RULE FOR THIS ROUTE: never invent a number. Every figure is either a documented
// platform limit, a value an API just told us, or null with a `source` saying why it is
// null. A dashboard that guesses is worse than one that admits it does not know, because
// the owner would plan against the guess.
//
// Cloudflare's free-plan ceilings, from the Workers pricing page (checked Aug 2026):
// 100,000 requests a day and 10 ms of CPU per request. They are constants, not estimates.
const CF_FREE_REQUESTS_PER_DAY = 100000;
const CF_FREE_CPU_MS = 10;
// A per-isolate tally. Cloudflare runs many isolates across many colos and recycles them
// freely, so this counts a SLICE of the traffic, never the account total, and it resets
// to zero whenever the isolate does. That is exactly why `source` says so in words: the
// number is real, its scope is not the whole day. The GraphQL path below is the honest
// total when the owner supplies a read token.
let _reqCount = 0;
let _reqSince = Date.now();
function noteRequest() { _reqCount++; }
function resetUsageCounter() { _reqCount = 0; _reqSince = Date.now(); }
// UTC midnight today, which is the boundary Cloudflare's daily request limit resets on.
function startOfUtcDay(now) {
  const d = new Date(typeof now === "number" ? now : Date.now());
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())).toISOString();
}
// The real number, when CLOUDFLARE_ANALYTICS_TOKEN + CLOUDFLARE_ACCOUNT_ID are set.
// Account-scoped GraphQL: viewer.accounts.workersInvocationsAdaptive, summed over the
// buckets returned for today. Returns a number or null; never throws, never reports a
// partial read as a total. The token is used as a bearer header and nowhere else, so it
// cannot reach the response even on a failure path (the caller only ever sees a status).
async function cloudflareRequestsToday(env, now) {
  const token = (env && env.CLOUDFLARE_ANALYTICS_TOKEN) || "";
  const account = (env && env.CLOUDFLARE_ACCOUNT_ID) || "";
  if (!token || !account) return { count: null, status: 0 };
  const script = (env && env.WORKER_NAME) || "iboyprime-commands";
  // The variable types are `string`, lowercase, including the two datetimes. That is
  // Cloudflare's own schema, not a typo: declaring them as the `Time` scalar fails
  // validation, and a validation failure comes back as HTTP 200 with an `errors` array,
  // so the feature would have looked configured while never once returning a number.
  const query = "query($a: string, $s: string, $since: string, $until: string) {" +
    " viewer { accounts(filter: {accountTag: $a}) {" +
    " workersInvocationsAdaptive(limit: 1000, filter: {scriptName: $s, datetime_geq: $since, datetime_leq: $until})" +
    " { sum { requests } } } } }";
  const variables = { a: String(account), s: String(script),
                      since: startOfUtcDay(now),
                      until: new Date(typeof now === "number" ? now : Date.now()).toISOString() };
  let body = null;
  try {
    const r = await fetch("https://api.cloudflare.com/client/v4/graphql", {
      method: "POST",
      headers: { Authorization: "Bearer " + token, "content-type": "application/json",
                 "User-Agent": "iboyprime-commands" },
      body: JSON.stringify({ query, variables }) });
    if (!r || !r.ok) return { count: null, status: (r && r.status) || 0 };
    body = await r.json();
  } catch (e) { return { count: null, status: 0 }; }
  // A GraphQL error arrives with HTTP 200, so the shape has to be checked, not the code.
  if (!body || (Array.isArray(body.errors) && body.errors.length)) return { count: null, status: 200 };
  const accounts = ((body.data || {}).viewer || {}).accounts;
  if (!Array.isArray(accounts)) return { count: null, status: 200 };
  let total = 0, saw = false;
  for (const a of accounts) {
    for (const row of ((a && a.workersInvocationsAdaptive) || [])) {
      const n = Number(((row || {}).sum || {}).requests);
      if (Number.isFinite(n)) { total += n; saw = true; }
    }
  }
  return saw ? { count: total, status: 200 } : { count: null, status: 200 };
}
// Balance endpoints that answer for the ordinary inference key. Only these two exist:
//   deepseek   GET /user/balance -> { is_available, balance_infos: [{ currency,
//              total_balance, granted_balance, topped_up_balance }] }. Documented, and
//              it authenticates with the same Bearer key the chat endpoint takes.
//   openrouter GET /api/v1/credits -> { data: { total_credits, total_usage } }, balance
//              being the difference. It wants a MANAGEMENT key though, so an inference
//              key gets a 403; that is reported as the 403 it is, not as "no balance".
// The other five publish no balance endpoint an inference key can call, so they report
// null with a source that says exactly that rather than a plausible-looking zero.
const AI_BALANCE = Object.freeze({
  deepseek: "https://api.deepseek.com/user/balance",
  openrouter: "https://openrouter.ai/api/v1/credits",
});
function aiBalanceUrl(provider) {
  const p = String(provider === null || provider === undefined ? "" : provider).toLowerCase();
  if (AI_PROVIDER_NAMES.indexOf(p) === -1) return null;
  const u = own(AI_BALANCE, p);
  return typeof u === "string" ? u : null;
}
// PURE: a provider's balance response -> { balance, currency } or null. Split out so the
// parsing is testable without a network, and so nothing but numbers and a currency code
// can ever come back out of a provider's JSON.
function parseBalance(provider, body) {
  if (!body || typeof body !== "object") return null;
  if (provider === "deepseek") {
    const infos = Array.isArray(body.balance_infos) ? body.balance_infos : [];
    const info = infos.length ? infos[0] : null;
    const n = info ? Number(info.total_balance) : NaN;
    if (!Number.isFinite(n)) return null;
    const cur = String((info && info.currency) || "").toUpperCase().slice(0, 8);
    return { balance: n, currency: /^[A-Z]{0,8}$/.test(cur) ? cur : "" };
  }
  if (provider === "openrouter") {
    const d = body.data && typeof body.data === "object" ? body.data : {};
    const credits = Number(d.total_credits), used = Number(d.total_usage);
    if (!Number.isFinite(credits) || !Number.isFinite(used)) return null;
    return { balance: Number((credits - used).toFixed(6)), currency: "USD" };
  }
  return null;
}
// WHY THE ANSWER IS USUALLY null, AND WHY THAT IS THE HONEST ANSWER.
// The AI keys are GitHub Actions secrets so the cron jobs can use them. GitHub does not
// let anyone read an Actions secret value back, by design, so this Worker holds the key
// NAME and never the key. Reporting a balance would therefore mean inventing one. The
// only case where a real lookup is possible is when the owner has ALSO put the key on
// the Worker as its own secret; then env[NAME] exists and the provider can be asked.
// The name is resolved through the frozen allowlist first, so no caller-supplied string
// ever indexes env.
async function aiUsage(env) {
  const out = { provider: "", balance: null, currency: "", source: "" };
  if (!env || !env.GITHUB_TOKEN) {
    out.source = "no GITHUB_TOKEN on the worker, so the list of stored provider keys cannot be read";
    return out;
  }
  const names = await ghSecretNames(env);
  if (names === null) {
    out.source = "github did not return the Actions secret list, so the configured provider is unknown";
    return out;
  }
  // "Configured" means a key is stored for it. With several stored, the first name in
  // the frozen list wins, which makes the answer deterministic rather than dependent on
  // whatever order GitHub happened to list the secrets in.
  const provider = AI_PROVIDER_NAMES.find(p => names.has(aiSecretName(p))) || "";
  out.provider = provider;
  if (!provider) {
    out.source = "no AI provider key is stored as a GitHub Actions secret yet";
    return out;
  }
  const url = aiBalanceUrl(provider);
  if (!url) {
    out.source = provider + " publishes no balance endpoint that an inference key can call";
    return out;
  }
  // own(): the name came from the frozen allowlist, and this is an ownership test on the
  // env bindings, never a prototype-chain read.
  const held = own(env, aiSecretName(provider));
  const key = typeof held === "string" ? held.trim() : "";
  if (!key) {
    out.source = "the " + provider + " key is stored as a GitHub Actions secret, and Actions secret "
               + "values cannot be read back, so no balance lookup is possible from here";
    return out;
  }
  let status = 0, body = null;
  try {
    const r = await fetch(url, { headers: { Authorization: "Bearer " + key, Accept: "application/json",
                                            "User-Agent": "iboyprime-commands" } });
    status = (r && r.status) || 0;
    if (r && r.ok) body = await r.json();
  } catch (e) { status = 0; }
  // Nothing below this line touches `key`. Only the status code describes a failure.
  if (status === 403 && provider === "openrouter") {
    out.source = "openrouter answered HTTP 403: its credits endpoint needs a management key, not an inference key";
    return out;
  }
  if (!body) {
    out.source = provider + " balance lookup failed" + (status ? " (HTTP " + status + ")" : "");
    return out;
  }
  const parsed = parseBalance(provider, body);
  if (!parsed) {
    out.source = provider + " answered in a shape this worker does not recognise, so no number is reported";
    return out;
  }
  out.balance = parsed.balance;
  out.currency = parsed.currency;
  out.source = provider + " balance endpoint, read live";
  return out;
}
// GitHub Actions minutes are unlimited ONLY while the repo is public, so that claim is
// checked, never asserted: GET /repos/{owner}/{repo} answers with `private`. When the
// lookup cannot run, public_repo is null with a `source` saying why, per this route's
// rule against invented facts. Cached along with the whole payload below.
async function repoVisibility(env) {
  if (!env || !env.GITHUB_TOKEN || !env.GITHUB_OWNER || !env.GITHUB_REPO) {
    return { public_repo: null, source: "not checked: the worker has no GITHUB_TOKEN to ask github with" };
  }
  let status = 0, body = null;
  try {
    const r = await fetch(ghBase(env), { headers: ghHeaders(env) });
    status = (r && r.status) || 0;
    if (r && r.ok) body = await r.json();
  } catch (e) { body = null; }
  if (!body || typeof body.private !== "boolean") {
    return { public_repo: null,
             source: "not checked: github did not answer" + (status ? " (HTTP " + status + ")" : "") };
  }
  return { public_repo: body.private === false, source: "github api, read live" };
}
// The assembled payload is cached per isolate for five minutes, like every other read
// on this surface (bots_config, welcomeconfig, the poll bank, the background plates).
// Uncached, every authenticated hit paid up to four outbound calls: analytics, the
// Actions secret list, a balance endpoint and the repo lookup. The payload carries
// generated_at plus a note saying figures can be five minutes old, so a cached serve
// stays inside the route's honesty rule.
const USAGE_CACHE_MS = 5 * 60 * 1000;
let _usageCache = { at: 0, data: null };
function resetUsageCache() { _usageCache = { at: 0, data: null }; }
async function studioUsage(env) {
  const now = Date.now();
  if (_usageCache.data && now - _usageCache.at < USAGE_CACHE_MS) {
    return studioJson(_usageCache.data, 200);
  }
  const cf = await cloudflareRequestsToday(env, now);
  let requestsToday = cf.count, source;
  if (requestsToday !== null) {
    source = "cloudflare analytics";
  } else {
    requestsToday = _reqCount;
    // The instant is part of the honesty: "since it started" is a claim the owner can
    // only check against a time, and a fresh isolate is exactly when the tally is most
    // misleading.
    source = "approximation: counted in this worker instance since it started at "
           + new Date(_reqSince).toISOString();
    if (env && env.CLOUDFLARE_ANALYTICS_TOKEN && env.CLOUDFLARE_ACCOUNT_ID) {
      source += " (the cloudflare analytics query did not return a total"
              + (cf.status ? ", HTTP " + cf.status : "") + ")";
    } else {
      source += " (set CLOUDFLARE_ANALYTICS_TOKEN and CLOUDFLARE_ACCOUNT_ID for the account-wide total)";
    }
  }
  const ai = await aiUsage(env);
  const repo = await repoVisibility(env);
  const notes = [
    "The Cloudflare free plan allows " + CF_FREE_REQUESTS_PER_DAY + " requests a day and "
      + CF_FREE_CPU_MS + " ms of CPU per request.",
  ];
  if (repo.public_repo === true) {
    notes.push("GitHub Actions minutes are unlimited because the bots repo is public.");
  } else if (repo.public_repo === false) {
    notes.push("The bots repo is private, so GitHub Actions minutes are NOT unlimited.");
  } else {
    notes.push("Repo visibility was " + repo.source + ", so no claim is made about GitHub Actions minutes.");
  }
  if (source === "cloudflare analytics") {
    notes.push("The request count is the account-wide total for today, read from Cloudflare analytics.");
  } else {
    notes.push("The request count covers only this worker instance, so the real daily total is higher.");
  }
  notes.push(ai.balance === null
    ? "No AI balance is shown: " + (ai.source || "no provider key is readable from here") + "."
    : "AI balance comes straight from the provider, not from a stored figure.");
  notes.push("This payload is assembled at most once every five minutes per worker instance, "
    + "so figures can be up to five minutes old.");
  const payload = {
    generated_at: new Date(now).toISOString(),
    cloudflare: {
      plan: "free",
      requests_per_day_limit: CF_FREE_REQUESTS_PER_DAY,
      cpu_ms_per_request_limit: CF_FREE_CPU_MS,
      requests_today: requestsToday,
      source,
    },
    github_actions: {
      public_repo: repo.public_repo,
      minutes_limit: repo.public_repo === true ? "unlimited" : null,
      source: repo.source,
    },
    ai,
    notes,
  };
  _usageCache = { at: now, data: payload };
  return studioJson(payload, 200);
}

// ---------- /studio: the poll question bank ----------
// The real bank, not a sample: bots_github/polls_data.json ships to the repo root, so it
// reads the same cheap way as bots_config (raw CDN, no token, 5-minute cache).
// PURE: one bank entry -> the contract shape. Strings only, so nothing structural from
// the JSON can reach the page.
function pollShape(entry) {
  const e = (entry && typeof entry === "object") ? entry : {};
  const opts = Array.isArray(e.options) ? e.options : [];
  return {
    question: String(e.q || e.question || "").slice(0, 300),
    options: opts.slice(0, 8).map(o => ({
      label: String((o && o.label) || "").slice(0, 80),
      emoji: String((o && o.emoji) || "").slice(0, 16),
      img: String((o && o.img) || "").slice(0, 120),
    })).filter(o => o.label),
  };
}
const POLL_EMPTY = { question: "", options: [] };
let _pollCache = { at: 0, data: null };
async function studioPoll(env) {
  const now = Date.now();
  if (_pollCache.data && now - _pollCache.at < 300000) return studioJson(_pollCache.data, 200);
  const st = await getJSON(rawBase(env) + "/state_polls.json");
  // Since Aug 19 2026 the bot is AI-first: the bank cursor barely moves while
  // a provider key is live, so "the next bank entry" stopped describing what
  // actually stages. polls_bot commits the entry it just staged as
  // state.last_entry (question + options, no ids) BEFORE posting - that is
  // what the composer should pre-fill. The bank cursor is the fallback for a
  // pre-upgrade state file.
  const le = st && st.last_entry;
  if (le && typeof le === "object" && String(le.type || "poll") !== "post"
      && String(le.q || "").trim()) {
    const data = pollShape(le);
    _pollCache = { at: now, data };
    return studioJson(data, 200);
  }
  const bank = await getJSON(rawBase(env) + "/polls_data.json");
  // Degrade to the empty shape rather than an error: the page renders the same either
  // way and a missing bank is a deploy state, not a fault the owner can act on here.
  if (!Array.isArray(bank) || !bank.length) return studioJson(POLL_EMPTY, 200);
  let cursor = 0;
  const c = st ? Number(st.cursor) : NaN;
  if (Number.isFinite(c) && c >= 0) cursor = Math.floor(c) % bank.length;
  const data = pollShape(bank[cursor]);
  _pollCache = { at: now, data };
  return studioJson(data, 200);
}

// ---------- /studio: capability facts ----------
// One source of truth for what the platforms actually allow, so the page never implies
// a capability that does not exist. Checked against the YouTube Data API v3 reference:
// there is no community post resource, in either direction.
const STUDIO_LIMITS = {
  youtube_api_supports_community_posts: false,
  note: "The YouTube Data API has no community post resource, so nothing can create, edit or read a community post through it. The handoff ends with a caption and an image you paste into YouTube Studio by hand.",
};

// ---------- /studio: router ----------
// ===========================================================================
// THE /studio API CONTRACT. studio_page.js is written against exactly these
// shapes; this comment and that file must agree. Change one, change both.
//
//   GET  /studio/api/staged
//        -> [{ id, score, why, caption, line, speaker, source, about,
//               hot: [string], image_url, photo_url, photo_kind, template,
//               colorway, bg, spec, timestamp }]
//        Newest first (Discord order). score is a number or null. hot is always
//        an array. image_url/photo_url are same-origin /studio/api/img/<id>/<n>
//        proxy paths or null (legacy embed images may still be a Discord CDN
//        https URL), never anything else. line/speaker/source/about/bg are
//        always strings, "" when unknown. spec is a bool: whether the staging
//        bot shipped a round-trip spec fence.
//        503 without DISCORD_BOT_TOKEN or channels.studio; 502 if Discord or the
//        bot-identity lookup fails.
//
//   GET  /studio/api/img/<message id>/<0|1>
//        -> the raw bytes of that staged message's attachment, same-origin,
//        content-type image/*. Only messages in the studio channel authored by
//        this bot resolve; anything else is 404. 502 when the CDN fetch fails.
//
//   GET  /studio/api/aikey
//        -> { providers: { deepseek, openrouter, zai, groq, together, mistral,
//                          openai } }, every value a bool, in that order.
//        Presence only, by listing secret NAMES. Actions secret values cannot be
//        read back from GitHub at all, so no key material exists on this path.
//
//   POST /studio/api/aikey   <- { provider: <one of the seven names>, key }
//        -> 200 { ok: true, provider, stored: true } | 400 { error } |
//           501/502/503 { ok: false, error }. Any other provider is a 400 and
//           nothing leaves the Worker.
//
//   GET  /studio/api/usage
//        -> { generated_at,
//             cloudflare: { plan, requests_per_day_limit, cpu_ms_per_request_limit,
//                           requests_today, source },
//             github_actions: { public_repo, minutes_limit, source },
//             ai: { provider, balance, currency, source },
//             notes: [string] }
//        requests_today and balance are a number or null, NEVER a guess;
//        public_repo is true/false only after GitHub confirmed it, else null; and
//        `source` always says where the value came from or why there is none.
//        The assembled payload is cached per isolate for five minutes.
//
//   GET  /studio/api/poll
//        -> { question: "", options: [{ label, emoji, img }] }
//        The real bank (polls_data.json), positioned at the entry the bot posts
//        next. Empty shape when the bank is unreachable, never an error.
//
//   GET  /studio/api/limits
//        -> { youtube_api_supports_community_posts: false, note }
//
// Every route above needs the session cookie: no cookie is 401 with
// { error: "unauthorized" }, and with STUDIO_PASSWORD unset the whole surface is
// 503 text. Errors are always JSON { error } except that one 503.
// ===========================================================================
// Every /studio path is answered here and returns. The Discord interaction endpoint is
// below this in fetch(), so no request to a /studio route can reach a command handler,
// signed or not.
async function studioRouter(request, env, url) {
  // Normalise before matching so "/studio/" and "/studio//api/staged" cannot slip past
  // a route check and land on the catch-all with a different answer.
  const path = url.pathname.replace(/\/{2,}/g, "/").replace(/(.)\/+$/, "$1");
  // Never open by default. With no password configured the whole surface is closed,
  // APIs included, rather than falling back to a public page.
  if (!env || !env.STUDIO_PASSWORD) return studioText("studio not configured", 503);

  if (path === "/studio/login") {
    if (request.method !== "POST") return studioJson({ error: "method not allowed" }, 405);
    return await studioLogin(request, env);
  }
  if (path === "/studio/logout") {
    if (request.method !== "POST") return studioJson({ error: "method not allowed" }, 405);
    return new Response(JSON.stringify({ ok: true }), { status: 200,
      headers: { "content-type": "application/json; charset=utf-8",
                 "set-cookie": cookieHeader("", 0), ...STUDIO_HEADERS } });
  }

  const authed = await requireStudio(request, env);
  // The only unauthenticated page: the gate itself. The editor is never sent to a
  // request that has not proven it knows the password.
  if (path === "/studio" && request.method === "GET") {
    return studioHtml(authed ? STUDIO_HTML : LOGIN_HTML);
  }
  if (!authed) return studioJson({ error: "unauthorized" }, 401);

  if (path === "/studio/api/staged" && request.method === "GET") return await studioStaged(env);
  if (path.indexOf("/studio/api/img/") === 0 && request.method === "GET") {
    const segs = path.slice("/studio/api/img/".length).split("/");
    if (segs.length === 2) return await studioImg(env, segs[0], segs[1]);
    return studioJson({ error: "not found" }, 404);
  }
  if (path.indexOf("/studio/bg/") === 0 && request.method === "GET") {
    return await studioBg(env, path.slice("/studio/bg/".length));
  }
  if (path === "/studio/api/aikey" && request.method === "GET") return await studioAiKeyStatus(env);
  if (path === "/studio/api/aikey" && request.method === "POST") return await studioAiKeySave(request, env);
  if (path === "/studio/api/poll" && request.method === "GET") return await studioPoll(env);
  if (path === "/studio/api/usage" && request.method === "GET") return await studioUsage(env);
  if (path === "/studio/api/limits" && request.method === "GET") return studioJson(STUDIO_LIMITS, 200);
  return studioJson({ error: "not found" }, 404);
}

export default {
  async fetch(request, env, ctx) {
    noteRequest();          // per-isolate tally behind /studio/api/usage; see noteRequest
    const url = new URL(request.url);
    // The studio surface is answered in full here and RETURNS, so the Discord
    // interaction endpoint below is unreachable from any /studio path: a POST to
    // /studio, signed or not, can never run a command handler.
    if (url.pathname === "/studio" || url.pathname.startsWith("/studio/")) {
      return await studioRouter(request, env, url);
    }
    if (request.method !== "POST") return new Response("Slash commands \u2014 online.");
    const body = await request.text();
    if (!await verify(request, body, env.DISCORD_PUBLIC_KEY)) return new Response("bad signature", { status: 401 });
    const interaction = JSON.parse(body);
    if (interaction.type === 1) return json({ type: T.PONG });
    if (interaction.type === 2) {
      const d = interaction.data || {};
      // own() + a typeof check: COMMANDS["constructor"] is the Object function and
      // COMMANDS["toString"] is a function too, so a plain `[]` lookup would happily
      // "dispatch" to either one.
      const handler = (d.type === 2 || d.type === 3) ? own(CONTEXT, d.name) : own(COMMANDS, d.name);
      if (typeof handler !== "function") return json({ type: T.MESSAGE, data: msg("Unknown command.", true) });
      let res;
      try { res = await handler(interaction, env); } catch (e) { return json({ type: T.MESSAGE, data: msg("Something went wrong.", true) }); }
      if (res.defer) {
        ctx.waitUntil((async () => {
          let data; try { data = await res.defer(); } catch (e) { data = msg("Couldn't fetch that right now."); }
          await followup(interaction, data);
        })());
        // Ephemerality is fixed HERE, at defer time, and cannot be changed by the later
        // followup PATCH. Without `flags` on this response every staff reply posted
        // PUBLICLY - including /modlogs warning histories and " No permission" - even
        // though each handler passed msg(..., true). The flag has to ride on the defer.
        return json({ type: T.DEFER, data: res.ephemeral ? { flags: EPHEMERAL } : undefined });
      }
      return json({ type: T.MESSAGE, data: res.data });
    }
    return json({ type: T.MESSAGE, data: msg("Unsupported interaction.", true) });
  },
};

// exported for offline tests (harmless in the Worker runtime)
export const _test = { rollDice, slugify, onThisDayEmbed, triviaResponse, buildPoll, fighterEmbed, avatarUrl, snowflakeDate, fmtBouts, EIGHTBALL,
  subPath, isStaffFromRoles, applyModChange, applyNewsChange, PROTECTED_EXCLUDES, resolveCats, MOD_CATEGORIES, MEDIA_POLICIES,
  socialLines, SOCIALS_FALLBACK, COMMANDS, CONTEXT, isSnowflake, safeApiPath, uidKey, userWarns, ADMIN_UP,
  own, safeKey, optMap,
  // /studio
  ctEq, ctEqBytes, studioToken, studioTokenValid, cookieValue, requireStudio, parseStaged, parseStagedOne,
  stagedParts, stagedImgPath, studioImg,
  loginTooMany, noteLoginFail, clearLoginFails, LOGIN_MAX_FAILS, sealBox, b64ToBytes, bytesToB64,
  AI_PROVIDERS, AI_PROVIDER_NAMES, aiSecretName, STUDIO_LIMITS, STUDIO_COOKIE, STUDIO_TTL_MS,
  AI_ENDPOINTS, aiEndpoint, AI_BALANCE, aiBalanceUrl, parseBalance, ghSecretNames,
  cloudflareRequestsToday, startOfUtcDay, resetUsageCounter, resetUsageCache, repoVisibility,
  CF_FREE_REQUESTS_PER_DAY, CF_FREE_CPU_MS,
  LOGIN_HTML, STUDIO_HTML, STUDIO_CSP, DISCORD_CDN_HOSTS, discordCdnUrl, pollShape, POLL_EMPTY,
  sha256Bytes, studioSignKey, studioPasswordOk, hmacB64url, LOGIN_FAIL_DELAY_MS,
  resetStudioCaches };
