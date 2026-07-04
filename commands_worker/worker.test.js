// Offline unit tests for the Worker's pure /mod helpers. Run: node worker.test.js
import { _test } from "./worker.js";

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

console.log(`\n==== worker: ${pass} passed, ${fail} failed ====`);
process.exit(fail ? 1 : 0);
