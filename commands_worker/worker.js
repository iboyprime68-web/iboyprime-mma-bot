/**
 * Prime Arena — custom slash-command bot (Cloudflare Worker).
 * Always-on, free, ad-free. Handles Discord HTTP interactions.
 *
 * Secrets (set via `wrangler secret put` or the dashboard):
 *   DISCORD_PUBLIC_KEY   (required) — app Public Key from the Dev Portal.
 *   YOUTUBE_API_KEY      (optional) — enables real /youtube search.
 *   DISCORD_BOT_TOKEN    (optional) — enables /serverinfo member counts.
 */
const ORANGE = 0xE67E22;
const T = { PONG: 1, MESSAGE: 4, DEFER: 5 };
const EPHEMERAL = 64;

// FALLBACK ONLY. The live list is `links` in welcomeconfig.json — the same file the
// pinned welcome message renders from — so /links and that message cannot drift apart.
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
  return (name || "").normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/['’.]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}
function snowflakeDate(id) { try { return new Date(Number((BigInt(id) >> 22n) + 1420070400000n)); } catch (e) { return null; } }
function optMap(interaction) {
  const m = {};
  for (const o of (interaction.data.options || [])) m[o.name] = o.value;
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
    const cache = {}; events.forEach(e => cache[e.id] = e);
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
    return (i === 0 ? "🏆 " : "• ") + `**${nm(a)}** vs **${nm(b)}**`;
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
  return embed({ title: "🧠 MMA Trivia", description: `${t.q}\n\nAnswer: ||${t.a}||` });
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
  if (o.user && res[o.user]) return res[o.user];
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
  const m = {}; for (const o of opts) m[o.name] = o.value;
  return { group, sub, opts: m };
}
// The bot is ADMINISTRATOR, so anything it does on a member's behalf runs at the bot's
// permission level, not theirs. That means this gate - not Discord - decides what each
// staff tier can do, and a single flat check silently GRANTS powers the guild withholds:
// 🔨 Moderator is configured with kick but NOT ban, yet /ban went through this same
// check. Pass `keys` to require a tier; the default keeps the old behaviour.
function isStaffFromRoles(member, cfg, keys) {
  if (!member) return false;
  const roleIds = new Set(member.roles || []);
  const staff = (keys || ["owner", "admin", "mod"]).map(k => (cfg.roles || {})[k]).filter(Boolean);
  if (staff.some(id => roleIds.has(id))) return true;
  // Administrator can do all of this natively anyway, so this is not an escalation.
  try { if ((BigInt(member.permissions || "0") & (1n << 3n)) !== 0n) return true; } catch (e) {}
  return false;
}
function profileCats(modcfg, name) { return new Set((((modcfg.profiles || {})[name]) || {}).categories || []); }
function resolveCats(modcfg, channel) {
  const e = (modcfg.channels || {})[channel];
  let name = ((modcfg.defaults || {}).profile) || "standard", inline = {};
  if (typeof e === "string") name = e;
  else if (e && typeof e === "object") { name = e.profile || name; inline = e; }
  let cats = profileCats(modcfg, name);
  for (const c of (inline.categories_add || [])) cats.add(c);
  for (const c of (inline.categories_remove || [])) cats.delete(c);
  if (inline.categories) cats = new Set(inline.categories);
  const media = inline.media_policy || (((modcfg.profiles || {})[name]) || {}).media_policy || "allow";
  return { profile: name, cats, media };
}
function ensureInline(modcfg, channel) {
  const c = (modcfg.channels = modcfg.channels || {});
  let e = c[channel];
  if (typeof e === "string") e = { profile: e };
  else if (!e || typeof e !== "object") e = { profile: ((modcfg.defaults || {}).profile) || "standard" };
  c[channel] = e; return e;
}
// Pure: apply one /mod edit to a modconfig object and return the new one.
function applyModChange(modcfg, group, sub, a) {
  modcfg = JSON.parse(JSON.stringify(modcfg));
  if (group === "channel" && sub === "set-profile") {
    (modcfg.channels = modcfg.channels || {})[a.channel] = a.profile;
  } else if (group === "category") {
    const e = ensureInline(modcfg, a.channel);
    const cats = new Set(resolveCats(modcfg, a.channel).cats);
    if (sub === "enable") cats.add(a.category); else cats.delete(a.category);
    e.categories = Array.from(cats);
  } else if (group === "media" && sub === "policy") {
    ensureInline(modcfg, a.channel).media_policy = a.policy;
  } else if (group === "word") {
    const cc = ((modcfg.categories = modcfg.categories || {})[a.category] = (modcfg.categories[a.category] || {}));
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
function applyNewsChange(newscfg, group, sub, a) {
  newscfg = JSON.parse(JSON.stringify(newscfg));
  if (group === null && sub === "mode") {
    if (["realtime", "hybrid", "digest"].includes(a.value)) newscfg.mode = a.value;
  } else if (group === null && sub === "source") {
    const s = ((newscfg.sources = newscfg.sources || {})[a.name] = newscfg.sources[a.name] || {});
    s.enabled = (a.state === "on");
  } else if (group === null && sub === "category") {
    const c = ((newscfg.categories = newscfg.categories || {})[a.name] = newscfg.categories[a.name] || {});
    c.enabled = (a.state === "on");
  } else if (group === "keyword") {
    const key = a.list === "breaking" ? "breaking_keywords" : "exclude_keywords";
    const w = (a.word || "").toLowerCase().trim();
    const arr = (newscfg[key] = newscfg[key] || []);
    if (sub === "add") { if (w && !arr.includes(w)) arr.push(w); }
    else newscfg[key] = arr.filter(x => x !== w);
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
  return s.users[await uidKey(env, uid)] || null;
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
// Ban and unban only. Mirrors the guild's own roles: 🔨 Moderator has kick, not ban.
const ADMIN_UP = ["owner", "admin"];

// ---------- command table ----------
const COMMANDS = {
  help: () => ({ data: embed({
    title: "🤖 Commands",
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
      "`/youtube` search YouTube · `/links` every platform iBoyPrime posts on",
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
  "8ball": (i) => { const o = optMap(i); return { data: embed({ title: "🎱 Magic 8-Ball", description: `**Q:** ${o.question || "..."}\n**A:** ${EIGHTBALL[Math.floor(Math.random() * EIGHTBALL.length)]}` }) }; },
  roll: (i) => { const r = rollDice(optMap(i).dice); return { data: msg(`🎲 Rolled **${r.n}d${r.sides}**: ${r.rolls.join(", ")} → **${r.total}**`) }; },
  flip: () => ({ data: msg(`🪙 **${Math.random() < 0.5 ? "Heads" : "Tails"}**`) }),
  poll: (i) => ({ data: { ...buildPoll(optMap(i)), allowed_mentions: { parse: [] } } }),
  onthisday: () => ({ data: onThisDayEmbed(new Date()) }),
  trivia: () => ({ data: triviaResponse() }),
  avatar: (i) => { const u = resolveUser(i, optMap(i)); return { data: embed({ title: `${u.username || "Avatar"}`, image: { url: avatarUrl(u) } }) }; },
  userinfo: (i) => {
    const u = resolveUser(i, optMap(i)); const created = snowflakeDate(u.id);
    return { data: embed({ title: `👤 ${u.global_name || u.username}`, thumbnail: { url: avatarUrl(u) },
      fields: [{ name: "Username", value: u.username || "?", inline: true }, { name: "ID", value: u.id, inline: true },
        { name: "Account created", value: created ? `<t:${Math.floor(created.getTime() / 1000)}:D>` : "?", inline: true }] }) };
  },
  // /rankings was removed in the Aug 2026 declutter along with the 📊-rankings board:
  // the owner's verdict on that data source was "not accurate and really poorly done",
  // and this command hit the same octagon-api endpoint the board did.
  nextevent: () => ({ defer: async () => {
    const e = await soonestEvent();
    if (!e) return embed({ title: "Next event", description: "No upcoming card found right now." });
    const ts = Math.floor(e.t / 1000);
    return embed({ title: `🥊 Next up: ${e.label}`, description: `${e.league}\n<t:${ts}:F>\n**<t:${ts}:R>**` });
  } }),
  event: () => ({ defer: async () => {
    const e = await soonestEvent();
    if (!e) return embed({ title: "Event", description: "No upcoming card found." });
    const ts = Math.floor(e.t / 1000);
    return embed({ title: `🗓️ ${e.label}`, description: `<t:${ts}:F> (<t:${ts}:R>)\n\n${fmtBouts(e.ev) || "Card TBA."}` });
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
    return embed({ title: `📊 ${g ? g.name : "Server info"}`, fields });
  } }),
  youtube: (i, env) => ({ defer: async () => {
    const q = optMap(i).query || "";
    if (env && env.YOUTUBE_API_KEY) {
      const r = await getJSON(`https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=1&q=${encodeURIComponent(q)}&key=${env.YOUTUBE_API_KEY}`);
      const it = r && r.items && r.items[0];
      if (it) return msg(`🔎 **${it.snippet.title}**\nhttps://youtube.com/watch?v=${it.id.videoId}`);
    }
    return msg(`🔎 Search: https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`);
  } }),

  // ----- news feed: public status + staff config -----
  // `status` is public; every other /news path is a staff config write, so it is private.
  news: (i, env) => ({ ephemeral: subPath(i).sub !== "status", defer: async () => {
    const { group, sub, opts } = subPath(i);
    // /news follow|unfollow is gone: the 📰 News Pings and 🗞️ Digest Ping roles were
    // deleted in the Aug 2026 declutter. The wire posts silently and pings nobody, so
    // there is nothing left to opt into.
    if (group === null && sub === "status") {
      const nc = (await getJSON(rawBase(env) + "/newsconfig.json")) || {};
      const cats = Object.entries(nc.categories || {}).map(([k, c]) => `${c.enabled ? "🟢" : "⚫"} ${c.label || k}`).join("  ");
      const srcs = Object.entries(nc.sources || {}).map(([k, s]) => `${s.enabled ? "🟢" : "⚫"} ${s.label || k}`).join("  ");
      return embed({ title: "🗞️ News feed", description: [
        `Mode: **${nc.mode || "?"}**. Every story posts silently and pings nobody.`,
        `Topics: ${cats || "_?_"}`,
        `Sources: ${srcs || "_?_"}`,
        `Digest: ${((nc.digest || {}).times_utc || []).join(", ") || "none"} UTC`,
      ].join("\n") });
    }
    const { ok } = await requireStaff(i, env);
    if (!ok) return msg("⛔ Staff only (everyone can use `/news status`).", true);
    if (!env.GITHUB_TOKEN) return msg("/news config needs the GITHUB_TOKEN secret on the Worker. See COMMANDS_SETUP.md.", true);
    const { obj: newscfg, sha } = await loadRepoJson(env, "newsconfig.json");
    if (!newscfg) return msg("newsconfig.json isn't in the repo yet — run a deploy first.", true);
    const updated = applyNewsChange(newscfg, group, sub, opts);
    const saved = await saveRepoJson(env, "newsconfig.json", updated, sha, `news: ${group ? group + "/" : ""}${sub}`);
    return msg(saved ? "✅ Saved — the news bot picks it up within ~5 minutes (no restart needed)."
                     : "Couldn't save the config (GitHub write failed — check the GITHUB_TOKEN repo scope).", true);
  } }),

  // ----- moderation (staff only) -----
  mod: (i, env) => ({ ephemeral: true, defer: async () => {
    const { ok } = await requireStaff(i, env);
    if (!ok) return msg("⛔ You don't have permission to use /mod.", true);
    if (!env.GITHUB_TOKEN) return msg("⚠️ /mod isn't wired up yet — set the GITHUB_TOKEN secret on the Worker (see COMMANDS_SETUP.md).", true);
    const { group, sub, opts } = subPath(i);
    const { modcfg, sha } = await loadModconfig(env);
    if (group === null && sub === "status") {
      const chans = Object.keys(modcfg.channels || {}).length;
      const raidOn = (modcfg.raid || {}).enabled ? "on" : "off";
      return embed({ title: "🛡️ Moderation status", description:
        `Channels configured: **${chans}**\nProfiles: ${MOD_PROFILES.join(", ")}\nFilters: ${MOD_CATEGORIES.join(", ")}\nRaid protection: **${raidOn}**` });
    }
    if (group === null && sub === "view") {
      const r = resolveCats(modcfg, opts.channel);
      return embed({ title: "🔎 Channel rules", description:
        `<#${opts.channel}>\nProfile: **${r.profile}**\nFilters: ${Array.from(r.cats).join(", ") || "_none_"}\nMedia policy: **${r.media}**` });
    }
    const updated = applyModChange(modcfg, group, sub, opts);
    const saved = await saveModconfig(env, updated, sha, `mod: ${group}/${sub}`);
    if (!saved) return msg("Couldn't save the config (GitHub write failed — check the GITHUB_TOKEN repo scope).", true);
    await dispatchWorkflow(env, "mod_setup.yml");
    return msg("✅ Saved. Your change applies within ~1 minute.", true);
  } }),
  warn: (i, env) => ({ ephemeral: true, defer: async () => {
    const { cfg, ok } = await requireStaff(i, env); if (!ok) return msg("⛔ No permission.", true);
    const o = optMap(i);
    await postLog(env, cfg, `⚠️ <@${o.user}> was **warned** by <@${i.member.user.id}>${o.reason ? " — " + o.reason : ""}.`);
    return msg(`⚠️ Warned <@${o.user}>.`, true);
  } }),
  timeout: (i, env) => ({ ephemeral: true, defer: async () => {
    const { cfg, ok } = await requireStaff(i, env); if (!ok) return msg("⛔ No permission.", true);
    if (!env.DISCORD_BOT_TOKEN) return msg("⚠️ Needs the DISCORD_BOT_TOKEN secret on the Worker.", true);
    const o = optMap(i); const mins = Math.min(Math.max(parseInt(o.minutes) || 10, 1), 40320);
    const until = new Date(Date.now() + mins * 60000).toISOString();
    const r = await dapi(env, "PATCH", `/guilds/${i.guild_id}/members/${o.user}`, { communication_disabled_until: until });
    if (r.ok) await postLog(env, cfg, `⏳ <@${o.user}> timed out **${mins}m** by <@${i.member.user.id}>${o.reason ? " — " + o.reason : ""}.`);
    return msg(r.ok ? `⏳ Timed out <@${o.user}> for ${mins}m.` : "Couldn't time them out (check the bot's role position/permissions).", true);
  } }),
  ban: (i, env) => ({ ephemeral: true, defer: async () => {
    const { cfg, ok } = await requireRank(i, env, ADMIN_UP);
    if (!ok) return msg("⛔ Banning is Admin and Owner only.", true);
    if (!env.DISCORD_BOT_TOKEN) return msg("⚠️ Needs the DISCORD_BOT_TOKEN secret on the Worker.", true);
    const o = optMap(i);
    const r = await dapi(env, "PUT", `/guilds/${i.guild_id}/bans/${o.user}`, { delete_message_seconds: 0 });
    if (r.ok) await postLog(env, cfg, `🔨 <@${o.user}> **banned** by <@${i.member.user.id}>${o.reason ? " — " + o.reason : ""}.`);
    return msg(r.ok ? `🔨 Banned <@${o.user}>.` : "Couldn't ban (check the bot's permissions / role order).", true);
  } }),
  unban: (i, env) => ({ ephemeral: true, defer: async () => {
    const { cfg, ok } = await requireRank(i, env, ADMIN_UP);
    if (!ok) return msg("⛔ Unbanning is Admin and Owner only.", true);
    if (!env.DISCORD_BOT_TOKEN) return msg("⚠️ Needs the DISCORD_BOT_TOKEN secret on the Worker.", true);
    // user_id is a free-text STRING option (Discord validates USER options, not these),
    // and it lands straight in the API path - so it must be a bare snowflake.
    const id = (optMap(i).user_id || "").trim();
    if (!isSnowflake(id)) return msg("That isn't a valid user ID. Use the 17-19 digit number.", true);
    const r = await dapi(env, "DELETE", `/guilds/${i.guild_id}/bans/${id}`);
    if (r.ok) await postLog(env, cfg, `♻️ \`${id}\` **unbanned** by <@${i.member.user.id}>.`);
    return msg(r.ok ? `♻️ Unbanned \`${id}\`.` : "Couldn't unban (is that ID actually banned?).", true);
  } }),
  clear: (i, env) => ({ ephemeral: true, defer: async () => {
    const { ok } = await requireStaff(i, env); if (!ok) return msg("⛔ No permission.", true);
    if (!env.DISCORD_BOT_TOKEN) return msg("⚠️ Needs the DISCORD_BOT_TOKEN secret on the Worker.", true);
    const n = Math.min(Math.max(parseInt(optMap(i).count) || 0, 1), 100);
    const ch = i.channel_id;
    const r = await dapi(env, "GET", `/channels/${ch}/messages?limit=${n}`);
    const ms = r.ok ? await r.json() : [];
    const ids = ms.map(m => m.id);
    if (ids.length >= 2) await dapi(env, "POST", `/channels/${ch}/messages/bulk-delete`, { messages: ids });
    else if (ids.length === 1) await dapi(env, "DELETE", `/channels/${ch}/messages/${ids[0]}`);
    return msg(`🧹 Cleared ${ids.length} message(s).`, true);
  } }),
  modlogs: (i, env) => ({ ephemeral: true, defer: async () => {
    const { ok } = await requireStaff(i, env); if (!ok) return msg("⛔ No permission.", true);
    const uid = optMap(i).user; const w = await userWarns(env, uid);
    // undefined = we could not unlock the pseudonymous ledger. Saying "no warnings"
    // there would be a lie that hides a real record.
    if (w === undefined) return msg("Can't read the mod ledger: the Worker needs the DISCORD_BOT_TOKEN secret.", true);
    return embed({ title: "📋 Mod record", description: w
      ? `<@${uid}>\nWarnings: **${w.warns || 0}**\nLast action: ${w.last || "—"}`
      : `<@${uid}> has no recorded warnings.` });
  } }),
};

// ----- right-click context-menu commands (USER type 2 / MESSAGE type 3) -----
const CONTEXT = {
  "Timeout 10m": (i, env) => ({ ephemeral: true, defer: async () => {
    const { cfg, ok } = await requireStaff(i, env); if (!ok) return msg("⛔ No permission.", true);
    if (!env.DISCORD_BOT_TOKEN) return msg("⚠️ Needs the DISCORD_BOT_TOKEN secret.", true);
    const uid = i.data.target_id; const until = new Date(Date.now() + 10 * 60000).toISOString();
    const r = await dapi(env, "PATCH", `/guilds/${i.guild_id}/members/${uid}`, { communication_disabled_until: until });
    if (r.ok) await postLog(env, cfg, `⏳ <@${uid}> timed out **10m** by <@${i.member.user.id}> (right-click).`);
    return msg(r.ok ? `⏳ Timed out <@${uid}> for 10m.` : "Couldn't time them out.", true);
  } }),
  "Warn": (i, env) => ({ ephemeral: true, defer: async () => {
    const { cfg, ok } = await requireStaff(i, env); if (!ok) return msg("⛔ No permission.", true);
    const uid = i.data.target_id;
    await postLog(env, cfg, `⚠️ <@${uid}> was **warned** by <@${i.member.user.id}> (right-click).`);
    return msg(`⚠️ Warned <@${uid}>.`, true);
  } }),
  "Mod record": (i, env) => ({ ephemeral: true, defer: async () => {
    const { ok } = await requireStaff(i, env); if (!ok) return msg("⛔ No permission.", true);
    const uid = i.data.target_id; const w = await userWarns(env, uid);
    // undefined = we could not unlock the pseudonymous ledger. Saying "no warnings"
    // there would be a lie that hides a real record.
    if (w === undefined) return msg("Can't read the mod ledger: the Worker needs the DISCORD_BOT_TOKEN secret.", true);
    return embed({ title: "📋 Mod record", description: w
      ? `<@${uid}>\nWarnings: **${w.warns || 0}**\nLast action: ${w.last || "—"}`
      : `<@${uid}> has no recorded warnings.` });
  } }),
  "Delete & warn author": (i, env) => ({ ephemeral: true, defer: async () => {
    const { cfg, ok } = await requireStaff(i, env); if (!ok) return msg("⛔ No permission.", true);
    if (!env.DISCORD_BOT_TOKEN) return msg("⚠️ Needs the DISCORD_BOT_TOKEN secret.", true);
    const mid = i.data.target_id;
    const m = ((i.data.resolved || {}).messages || {})[mid] || {};
    const author = (m.author || {}).id;
    await dapi(env, "DELETE", `/channels/${i.channel_id}/messages/${mid}`);
    if (author) await postLog(env, cfg, `🗑️ A message from <@${author}> was deleted by <@${i.member.user.id}> (right-click).`);
    return msg("🗑️ Deleted.", true);
  } }),
};

// ---------- /studio: the owner's poster composer page ----------
// A static page, served on GET /studio only. It reads no env, holds no secret and
// makes no network call besides the Poppins font. All rendering is client-side on a
// 1080x1350 canvas that follows the owner's poster rules: cover-filled photo, bottom
// crushed to near-black, centered uppercase Poppins line with purple highlight words,
// optional quote chip and inset portrait, tiny "VIA <SOURCE>" credit. No logo and no
// channel name anywhere - the owner banned both.
const STUDIO_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#0b0b11">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="Studio">
<title>Studio</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Poppins:wght@600;800;900&display=swap" rel="stylesheet">
<style>
:root{--bg:#0b0b11;--card:#14141d;--line:#23232f;--text:#f2f2f7;--dim:#9b9ba8;--accent:#8B70FF;--soft:rgba(139,112,255,.14)}
*{box-sizing:border-box;margin:0;padding:0}
html{-webkit-text-size-adjust:100%}
body{background:var(--bg);color:var(--text);font-family:Poppins,system-ui,sans-serif;min-height:100vh;padding-bottom:44px}
header{padding:calc(14px + env(safe-area-inset-top)) 18px 12px;display:flex;align-items:baseline;gap:10px}
header h1{font-size:22px;font-weight:800;letter-spacing:.5px}
header span{color:var(--dim);font-size:12px;font-weight:600}
main{display:grid;gap:16px;padding:0 14px;max-width:560px;margin:0 auto}
@media(min-width:960px){main{max-width:1080px;grid-template-columns:minmax(0,1fr) 420px;align-items:start}.preview{position:sticky;top:14px}}
.preview canvas{width:100%;height:auto;display:block;border-radius:14px;border:1px solid var(--line);background:#000}
.panel{display:grid;gap:14px}
label{font-size:12px;font-weight:600;letter-spacing:1.2px;text-transform:uppercase;color:var(--dim);display:block;margin-bottom:6px}
input[type=text],textarea{width:100%;background:var(--card);border:1px solid var(--line);border-radius:12px;color:var(--text);font:500 16px Poppins,sans-serif;padding:14px;min-height:52px;outline:none}
input[type=text]:focus,textarea:focus{border-color:var(--accent)}
#line{text-transform:uppercase;font-weight:800}
textarea{resize:vertical}
.chips{display:flex;flex-wrap:wrap;gap:8px}
.chips:empty{display:none}
.chip{border:1px solid var(--line);background:var(--card);color:var(--text);font:800 14px Poppins,sans-serif;text-transform:uppercase;padding:10px 14px;border-radius:999px;min-height:44px;cursor:pointer}
.chip.on{background:var(--accent);border-color:var(--accent);color:#0b0b11}
.hint{color:var(--dim);font-size:12px;margin-top:-8px}
.drop{border:2px dashed var(--line);border-radius:14px;background:var(--card);min-height:96px;display:flex;align-items:center;justify-content:center;text-align:center;color:var(--dim);font-size:14px;padding:16px;cursor:pointer}
.drop.over{border-color:var(--accent);color:var(--text);background:var(--soft)}
.drop.set{border-style:solid;color:var(--text)}
.row{display:flex;gap:10px;flex-wrap:wrap}
button{font:600 15px Poppins,sans-serif;border-radius:12px;border:1px solid var(--line);background:var(--card);color:var(--text);padding:14px 18px;min-height:52px;cursor:pointer;flex:1}
button.primary{background:var(--accent);border-color:var(--accent);color:#0b0b11;font-weight:800}
button.ghost{background:transparent}
.hidden{display:none}
.switch{display:flex;align-items:center;gap:12px;background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px;min-height:52px;cursor:pointer;text-transform:none;letter-spacing:0;font:600 15px Poppins,sans-serif;color:var(--text);margin-bottom:0}
.switch input{width:22px;height:22px;accent-color:var(--accent)}
</style>
</head>
<body>
<header><h1>Studio</h1><span>poster composer</span></header>
<main>
<section class="preview"><canvas id="cv" width="1080" height="1350"></canvas></section>
<section class="panel">
  <div>
    <label for="line">Poster line</label>
    <input id="line" type="text" autocomplete="off" autocapitalize="characters" placeholder="TYPE THE POSTER LINE" value="THE RETURN NOBODY SAW COMING">
  </div>
  <div id="chips" class="chips"></div>
  <p class="hint">Tap a word to turn it purple.</p>
  <div>
    <label>Main photo</label>
    <div id="drop" class="drop" role="button" tabindex="0"><span id="dropLabel">Drop a photo here or tap to choose</span></div>
    <input id="file" type="file" accept="image/*" class="hidden">
  </div>
  <button id="photoClear" type="button" class="ghost hidden">Remove photo</button>
  <div class="row">
    <button id="insetBtn" type="button" class="ghost">Add inset photo</button>
    <button id="insetClear" type="button" class="ghost hidden">Remove inset</button>
  </div>
  <input id="insetFile" type="file" accept="image/*" class="hidden">
  <label class="switch"><input id="quote" type="checkbox"><span>Quote chip above the line</span></label>
  <div>
    <label for="via">Via source</label>
    <input id="via" type="text" autocomplete="off" autocapitalize="characters" placeholder="ESPN MMA">
  </div>
  <div>
    <label for="caption">Caption</label>
    <textarea id="caption" rows="5" placeholder="Write the caption to post with it"></textarea>
  </div>
  <div class="row">
    <button id="copyBtn" type="button">Copy caption</button>
    <button id="dl" type="button" class="primary">Download PNG</button>
  </div>
</section>
</main>
<script>
(function () {
  "use strict";
  var ACCENT = "#8B70FF";
  var W = 1080, H = 1350;
  var cv = document.getElementById("cv");
  var ctx = cv.getContext("2d");
  var lineEl = document.getElementById("line");
  var chipsEl = document.getElementById("chips");
  var viaEl = document.getElementById("via");
  var quoteEl = document.getElementById("quote");
  var capEl = document.getElementById("caption");
  var drop = document.getElementById("drop");
  var dropLabel = document.getElementById("dropLabel");
  var fileEl = document.getElementById("file");
  var photoClear = document.getElementById("photoClear");
  var insetBtn = document.getElementById("insetBtn");
  var insetClear = document.getElementById("insetClear");
  var insetFile = document.getElementById("insetFile");
  var copyBtn = document.getElementById("copyBtn");
  var dl = document.getElementById("dl");
  var photo = null, inset = null, hl = {};

  function words() {
    var t = (lineEl.value || "").trim();
    return t ? t.split(/\\s+/) : [];
  }

  function renderChips() {
    chipsEl.innerHTML = "";
    var ws = words();
    for (var i = 0; i < ws.length; i++) {
      (function (idx, w) {
        var b = document.createElement("button");
        b.type = "button";
        b.className = "chip" + (hl[idx] ? " on" : "");
        b.textContent = w.toUpperCase();
        b.addEventListener("click", function () { hl[idx] = !hl[idx]; renderChips(); draw(); });
        chipsEl.appendChild(b);
      })(i, ws[i]);
    }
  }

  function cover(img, x, y, w, h) {
    var s = Math.max(w / img.width, h / img.height);
    var dw = img.width * s, dh = img.height * s;
    ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // Balanced greedy split of the words into n lines by character count.
  function splitLines(ws, n) {
    if (n <= 1 || ws.length <= 1) return [ws];
    var total = 0, i;
    for (i = 0; i < ws.length; i++) total += ws[i].t.length + 1;
    var target = total / n;
    var lines = [], cur = [], acc = 0;
    for (i = 0; i < ws.length; i++) {
      var add = ws[i].t.length + 1;
      if (cur.length && lines.length < n - 1 && acc + add > target * (lines.length + 1)) {
        lines.push(cur); cur = [];
      }
      cur.push(ws[i]); acc += add;
    }
    if (cur.length) lines.push(cur);
    return lines;
  }

  function measureLine(lineWords, size) {
    ctx.font = "900 " + size + "px Poppins, sans-serif";
    var sp = ctx.measureText(" ").width;
    var total = 0;
    for (var i = 0; i < lineWords.length; i++) {
      total += ctx.measureText(lineWords[i].t).width;
      if (i) total += sp;
    }
    return total;
  }

  // 2 or 3 lines, auto-sized to fit. Prefers fewer lines while the type stays big.
  function layoutText() {
    var ws = words().map(function (w, i) { return { t: w.toUpperCase(), i: i }; });
    if (!ws.length) return null;
    var maxW = 940, cap = 116, floor = 40, bigEnough = 72;
    var options = ws.length <= 3 ? [1, 2] : [2, 3];
    var best = null;
    for (var k = 0; k < options.length; k++) {
      var lines = splitLines(ws, options[k]);
      var widest = 0;
      for (var m = 0; m < lines.length; m++) widest = Math.max(widest, measureLine(lines[m], 100));
      var size = widest > 0 ? Math.min(cap, Math.floor(100 * maxW / widest)) : cap;
      size = Math.max(size, floor);
      var opt = { lines: lines, size: size };
      if (size >= bigEnough) return opt;
      if (!best || size > best.size) best = opt;
    }
    return best;
  }

  function drawWords(lineWords, baseY, size) {
    ctx.font = "900 " + size + "px Poppins, sans-serif";
    var sp = ctx.measureText(" ").width;
    var widths = [], total = 0, i;
    for (i = 0; i < lineWords.length; i++) {
      widths[i] = ctx.measureText(lineWords[i].t).width;
      total += widths[i];
      if (i) total += sp;
    }
    var x = (W - total) / 2;
    for (i = 0; i < lineWords.length; i++) {
      ctx.fillStyle = hl[lineWords[i].i] ? ACCENT : "#ffffff";
      ctx.fillText(lineWords[i].t, x, baseY);
      x += widths[i] + sp;
    }
  }

  function drawTracked(text, baseY, size, tracking, color, weight) {
    ctx.font = weight + " " + size + "px Poppins, sans-serif";
    ctx.fillStyle = color;
    var total = 0, i;
    for (i = 0; i < text.length; i++) {
      total += ctx.measureText(text[i]).width;
      if (i < text.length - 1) total += tracking;
    }
    var x = (W - total) / 2;
    for (i = 0; i < text.length; i++) {
      ctx.fillText(text[i], x, baseY);
      x += ctx.measureText(text[i]).width + tracking;
    }
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    if (photo) {
      cover(photo, 0, 0, W, H);
    } else {
      ctx.fillStyle = "#0a0a0f";
      ctx.fillRect(0, 0, W, H);
      var glow = ctx.createRadialGradient(W / 2, H * 0.34, 60, W / 2, H * 0.34, 640);
      glow.addColorStop(0, "rgba(139,112,255,0.22)");
      glow.addColorStop(1, "rgba(139,112,255,0)");
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, W, H);
    }
    // Crush the bottom ~40 percent to near-black so the type always reads.
    var g = ctx.createLinearGradient(0, H * 0.40, 0, H);
    g.addColorStop(0, "rgba(7,7,11,0)");
    g.addColorStop(0.45, "rgba(7,7,11,0.62)");
    g.addColorStop(1, "rgba(7,7,11,0.96)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    var t = layoutText();
    var via = (viaEl.value || "").trim().toUpperCase();
    var y = H - 92;
    if (via) {
      drawTracked("VIA " + via, y, 26, 7, "rgba(197,197,210,0.85)", "600");
      y -= 64;
    } else {
      y -= 8;
    }
    if (t) {
      var lh = Math.round(t.size * 1.04);
      var topBase = y - lh * (t.lines.length - 1);
      for (var li = 0; li < t.lines.length; li++) drawWords(t.lines[li], topBase + li * lh, t.size);
      y = topBase - t.size;
    }
    var gap = 40;
    if (quoteEl.checked) {
      var qw = 118, qh = 84, qy = y - gap - qh;
      ctx.fillStyle = ACCENT;
      roundRect((W - qw) / 2, qy, qw, qh, 20);
      ctx.fill();
      ctx.fillStyle = "#0b0b11";
      ctx.font = "900 150px Poppins, sans-serif";
      ctx.textAlign = "center";
      var qm = ctx.measureText("\\u201D");
      var asc = qm.actualBoundingBoxAscent || 105;
      var desc = qm.actualBoundingBoxDescent || 0;
      ctx.fillText("\\u201D", W / 2, qy + qh / 2 + (asc - desc) / 2);
      ctx.textAlign = "left";
      y = qy;
    }
    if (inset) {
      var side = 216, iy = y - gap - side, ix = (W - side) / 2;
      ctx.save();
      roundRect(ix, iy, side, side, 14);
      ctx.clip();
      var s = Math.max(side / inset.width, side / inset.height);
      ctx.drawImage(inset, ix + (side - inset.width * s) / 2, iy + (side - inset.height * s) / 2,
        inset.width * s, inset.height * s);
      ctx.restore();
      ctx.strokeStyle = "rgba(255,255,255,0.92)";
      ctx.lineWidth = 5;
      roundRect(ix + 2.5, iy + 2.5, side - 5, side - 5, 12);
      ctx.stroke();
    }
  }

  function loadInto(file, cb) {
    if (!file || String(file.type).indexOf("image") !== 0) return;
    var url = URL.createObjectURL(file);
    var img = new Image();
    img.onload = function () { URL.revokeObjectURL(url); cb(img); draw(); };
    img.src = url;
  }

  function setPhoto(img) {
    photo = img;
    drop.classList.add("set");
    dropLabel.textContent = "Photo added, tap to replace";
    photoClear.classList.remove("hidden");
  }
  function setInset(img) {
    inset = img;
    insetClear.classList.remove("hidden");
    insetBtn.textContent = "Replace inset photo";
  }

  drop.addEventListener("click", function () { fileEl.click(); });
  drop.addEventListener("keydown", function (e) {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fileEl.click(); }
  });
  ["dragenter", "dragover"].forEach(function (n) {
    drop.addEventListener(n, function (e) { e.preventDefault(); drop.classList.add("over"); });
  });
  drop.addEventListener("dragleave", function () { drop.classList.remove("over"); });
  drop.addEventListener("drop", function (e) {
    e.preventDefault();
    drop.classList.remove("over");
    var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    loadInto(f, setPhoto);
  });
  document.addEventListener("dragover", function (e) { e.preventDefault(); });
  document.addEventListener("drop", function (e) { e.preventDefault(); });

  fileEl.addEventListener("change", function () { loadInto(fileEl.files[0], setPhoto); fileEl.value = ""; });
  photoClear.addEventListener("click", function () {
    photo = null;
    drop.classList.remove("set");
    dropLabel.textContent = "Drop a photo here or tap to choose";
    photoClear.classList.add("hidden");
    draw();
  });
  insetBtn.addEventListener("click", function () { insetFile.click(); });
  insetFile.addEventListener("change", function () { loadInto(insetFile.files[0], setInset); insetFile.value = ""; });
  insetClear.addEventListener("click", function () {
    inset = null;
    insetClear.classList.add("hidden");
    insetBtn.textContent = "Add inset photo";
    draw();
  });

  lineEl.addEventListener("input", function () { renderChips(); draw(); });
  viaEl.addEventListener("input", draw);
  quoteEl.addEventListener("change", draw);

  copyBtn.addEventListener("click", function () {
    var text = capEl.value || "";
    function done() {
      copyBtn.textContent = "Copied";
      setTimeout(function () { copyBtn.textContent = "Copy caption"; }, 1400);
    }
    function fallback() {
      capEl.select();
      try { document.execCommand("copy"); } catch (e) {}
      if (window.getSelection) window.getSelection().removeAllRanges();
      capEl.blur();
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, function () { fallback(); done(); });
    } else { fallback(); done(); }
  });

  dl.addEventListener("click", function () {
    cv.toBlob(function (b) {
      if (!b) return;
      var a = document.createElement("a");
      a.href = URL.createObjectURL(b);
      a.download = "post.png";
      document.body.appendChild(a);
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 800);
    }, "image/png");
  });

  // First paint right away, then again once the Poppins weights are really loaded.
  renderChips();
  draw();
  if (document.fonts && document.fonts.load) {
    Promise.all([
      document.fonts.load("900 40px Poppins"),
      document.fonts.load("800 40px Poppins"),
      document.fonts.load("600 40px Poppins")
    ]).then(draw, draw);
    if (document.fonts.ready && document.fonts.ready.then) document.fonts.ready.then(draw);
  }
})();
</script>
</body>
</html>
`;

export default {
  async fetch(request, env, ctx) {
    if (request.method === "GET" && new URL(request.url).pathname === "/studio") {
      return new Response(STUDIO_HTML, { headers: { "content-type": "text/html; charset=utf-8" } });
    }
    if (request.method !== "POST") return new Response("Slash commands — online.");
    const body = await request.text();
    if (!await verify(request, body, env.DISCORD_PUBLIC_KEY)) return new Response("bad signature", { status: 401 });
    const interaction = JSON.parse(body);
    if (interaction.type === 1) return json({ type: T.PONG });
    if (interaction.type === 2) {
      const d = interaction.data || {};
      const handler = (d.type === 2 || d.type === 3) ? CONTEXT[d.name] : COMMANDS[d.name];
      if (!handler) return json({ type: T.MESSAGE, data: msg("Unknown command.", true) });
      let res;
      try { res = await handler(interaction, env); } catch (e) { return json({ type: T.MESSAGE, data: msg("Something went wrong.", true) }); }
      if (res.defer) {
        ctx.waitUntil((async () => {
          let data; try { data = await res.defer(); } catch (e) { data = msg("Couldn't fetch that right now."); }
          await followup(interaction, data);
        })());
        // Ephemerality is fixed HERE, at defer time, and cannot be changed by the later
        // followup PATCH. Without `flags` on this response every staff reply posted
        // PUBLICLY - including /modlogs warning histories and "⛔ No permission" - even
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
  subPath, isStaffFromRoles, applyModChange, applyNewsChange, resolveCats, MOD_CATEGORIES, MEDIA_POLICIES,
  socialLines, SOCIALS_FALLBACK, COMMANDS, CONTEXT, isSnowflake, safeApiPath, uidKey, userWarns, ADMIN_UP };
