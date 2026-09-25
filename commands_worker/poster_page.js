// poster_page.js - the poster TEMPLATES page, served by the Worker on GET /studio/templates
// behind the same session gate as /studio (worker.js imports POSTER_HTML).
//
// Everything is drawn client-side on a 1080-wide canvas: no AI image generation, no server
// render. A template is a declarative list of slots (photo, cut-out, circle, card, tiles),
// text fields and lists, plus a draw() that composes them with a shared toolkit.
//
// THE LOOK (Sept 25 2026, owner-approved): the two approved grade ports are pasted in whole -
// grade_gritty.js (GRIT: the carved / gritty / pop / natural subject grades, the themed
// plates, dark halos, plate clearance, light caps, the circle insets) and grade_vivid.js +
// cards_canvas.js (the Premier-League card look: gradeVivid, gradePhoto, the card grounds,
// cards, plates, pills, titles). The heavy grades (2-4 s and ~350 MB per 1.4 Mpx hero) run in
// Web Workers built from a blob of this page's own library source (the studio CSP allows
// worker-src blob:, nothing more); the fast half-size preview shows first and the exact grade
// replaces it; an EXPORT waits for the exact grades and never ships a preview. Separation is a
// dark halo + plate clearance + light cap, computed on a 1/3-size copy and drawn back as one
// lerp layer; the painted edge light survives as an owner slider that defaults to OFF.
//
// The owner drags images onto the poster (they snap to the slot under the pointer), types a
// name to pull the UFC.com cut-out, record, bio and fight history, or picks an event and a bout
// to fill every template at once. A photo dropped on a fighter slot is cut out automatically
// (POST /studio/api/cutout; the result is cached in IndexedDB by the photo's SHA-256).
//
// API contracts (all same-origin, all behind the session gate):
//   GET /studio/api/ufcevents            -> [{slug, title, headline, ts}]
//   GET /studio/api/ufcevent/<slug>      -> {title, headline, ts, venue, fights: [{cls, card,
//                                            red: {first, last, slug, img, face, rank}, blue}]}
//   GET /studio/api/ufc/<slug>?n=<0-15>  -> {name, nickname, division, record, tags, body,
//                                            face, head, bio, method, stats, rates, fights}
//   GET /studio/api/ufcimg?p=&k=         -> a cut-out PNG
//   POST /studio/api/cutout (raw bytes)  -> image/png (the subject on transparency) or JSON
//                                            {error} with 413 / 415 / 429 / 502 / 503
//   GET /studio/bg/<arena|spotlight|cage|smoke>, /studio/tpl/<name>.jpg|png -> plates
//
// Source rules (the studio_page.js rules): this whole page is ONE template literal, so the
// page code carries NO backslash, NO backtick and no dollar-brace at all. Special glyphs
// come from String.fromCharCode or HTML entities, regex classes are spelled [0-9] and
// [ ], and newlines are NL. ASCII only. No logo and no channel name on any poster.
// The libraries between the "libraries (pasted by the build...)" markers are generated from
// the approved ports (scratchpad grade2/port_g, port_v): re-paste them, never hand-edit.
export const POSTER_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#07070B">
<meta name="robots" content="noindex, nofollow">
<title>Templates</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Anton&family=Barlow+Condensed:wght@500;600;700;800;900&family=Poppins:wght@500;600;700;800;900&display=swap" rel="stylesheet">
<style>
:root{--bg:#07070B;--p1:#0E0E15;--p2:#14141E;--p3:#1B1B28;--line:#22222F;--line2:#33334A;
  --text:#F3F2F8;--dim:#A3A1B7;--faint:#6D6B83;--acc:#8B5CFF;--acc2:#5F2EEA;--ok:#5BE3A8;--bad:#FF5A6B;
  --r:14px;--ar:1}
*{box-sizing:border-box;margin:0;padding:0;min-width:0}
html{-webkit-text-size-adjust:100%}
body{background:var(--bg);color:var(--text);font:14px/1.45 Poppins,system-ui,-apple-system,Segoe UI,sans-serif;
  overflow-x:hidden;min-height:100vh;
  background-image:radial-gradient(900px 500px at 50% -20%,rgba(139,92,255,.10),transparent 70%)}
button,input,textarea,select{font:inherit;color:inherit}
button{cursor:pointer}
:focus-visible{outline:2px solid var(--acc);outline-offset:2px;border-radius:8px}
.top{position:sticky;top:0;z-index:30;display:flex;align-items:center;gap:12px;
  padding:calc(9px + env(safe-area-inset-top)) 16px 9px;background:rgba(7,7,11,.86);
  backdrop-filter:blur(14px);border-bottom:1px solid var(--line)}
.back{color:var(--dim);text-decoration:none;font-weight:600;font-size:13px;padding:8px 11px;
  border-radius:10px;border:1px solid var(--line)}
.back:hover{color:var(--text);border-color:var(--line2)}
.ttl{display:flex;align-items:baseline;gap:10px;margin-right:auto}
.ttl b{font-size:17px;font-weight:800;letter-spacing:.3px}
.ttl span{color:var(--faint);font-size:11.5px;font-weight:700;letter-spacing:1.3px;text-transform:uppercase}
.acts{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.btn{border:1px solid var(--line2);background:var(--p2);padding:9px 14px;border-radius:11px;font-weight:700;
  font-size:13px;transition:border-color .15s,transform .15s}
.btn:hover{border-color:var(--acc)}
.btn:active{transform:translateY(1px)}
.btn.pri{background:linear-gradient(135deg,var(--acc),var(--acc2));border-color:transparent;color:#fff;
  box-shadow:0 8px 24px rgba(0,0,0,.4)}
.btn.sm{padding:6px 10px;font-size:12px;border-radius:9px}
.btn[disabled]{opacity:.45;cursor:default}
.seg{display:flex;background:var(--p1);border:1px solid var(--line);border-radius:11px;padding:3px}
.seg button{border:0;background:transparent;color:var(--dim);font-weight:700;font-size:12px;padding:6px 10px;border-radius:8px}
.seg button[aria-pressed=true]{background:var(--p3);color:var(--text)}
.app{display:grid;grid-template-columns:252px minmax(0,1fr) 404px;min-height:calc(100vh - 58px)}
.gal{border-right:1px solid var(--line);padding:12px 12px 40px;overflow:auto;max-height:calc(100vh - 58px);
  position:sticky;top:58px}
.gal h4{font-size:10.5px;letter-spacing:1.8px;text-transform:uppercase;color:var(--faint);margin:14px 4px 8px;font-weight:700}
.gal h4:first-child{margin-top:2px}
.tcard{display:block;width:100%;border:1px solid var(--line);background:var(--p1);border-radius:12px;padding:5px;
  margin-bottom:8px;text-align:left;transition:border-color .15s}
.tcard:hover{border-color:var(--line2)}
.tcard canvas{display:block;width:100%;height:auto;border-radius:8px;background:#0C0C12}
.tcard span{display:block;font-size:12px;font-weight:700;padding:6px 4px 2px}
.tcard em{display:block;font-style:normal;font-size:10.5px;color:var(--faint);padding:0 4px 3px;font-weight:600}
.tcard[aria-current=true]{border-color:var(--acc);box-shadow:0 0 0 1px var(--acc) inset}
.stage{padding:18px 18px 30px;display:flex;flex-direction:column;align-items:center;gap:10px}
.cwrap{position:relative;width:100%;max-width:calc((100vh - 150px) * var(--ar));touch-action:none}
#cv{display:block;width:100%;height:auto;border-radius:10px;background:#000;
  box-shadow:0 30px 90px rgba(0,0,0,.65),0 0 0 1px rgba(255,255,255,.04)}
#ov{position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none}
.cwrap.drag #cv{box-shadow:0 0 0 2px var(--acc),0 30px 90px rgba(0,0,0,.65)}
.tip{color:var(--faint);font-size:12px;text-align:center;max-width:680px}
.gnote{color:var(--dim);font-size:12px;font-weight:600;text-align:center;min-height:18px}
.insp .seg{display:inline-flex;margin-top:2px}
.insp .seg + .mini{margin-top:6px}
.ib.cutb{padding:0 8px;color:var(--text);border-color:var(--line2)}
.ib[disabled]{opacity:.5;cursor:default}
.insp{border-left:1px solid var(--line);padding:12px 12px 90px;overflow:auto;max-height:calc(100vh - 58px);position:sticky;top:58px}
.sec{background:var(--p1);border:1px solid var(--line);border-radius:var(--r);padding:12px;margin-bottom:12px}
.sec h3{font-size:11px;letter-spacing:1.6px;text-transform:uppercase;color:var(--dim);font-weight:800;margin-bottom:10px;
  display:flex;align-items:center;gap:8px}
.sec h3 .sp{margin-left:auto}
.row{display:flex;gap:8px;align-items:center}
.row + .row{margin-top:8px}
.in{width:100%;background:var(--bg);border:1px solid var(--line);border-radius:10px;padding:9px 11px;font-size:13px}
.in:focus{outline:none;border-color:var(--acc)}
select.in{padding:8px 9px}
textarea.in{resize:vertical;min-height:42px;line-height:1.35}
.lbl{font-size:11.5px;color:var(--dim);font-weight:700;margin:10px 0 5px;display:flex;justify-content:space-between;align-items:center;gap:8px}
.lbl:first-child{margin-top:0}
.lbl button{border:0;background:none;color:var(--faint);font-size:11px;font-weight:700}
.lbl button:hover{color:var(--text)}
.chips{display:flex;flex-wrap:wrap;gap:5px;margin-top:6px}
.chip{border:1px solid var(--line);background:var(--p2);border-radius:999px;padding:4px 9px;font-size:11.5px;font-weight:700;color:var(--dim)}
.chip:hover{color:var(--text)}
.chip[aria-pressed=true]{color:#fff;border-color:transparent;background:linear-gradient(135deg,var(--acc),var(--acc2))}
.slot{display:grid;grid-template-columns:56px 1fr auto;gap:10px;align-items:center;padding:8px;border:1px dashed var(--line2);
  border-radius:12px;background:var(--bg)}
.slot + .slot{margin-top:8px}
.slot.on{border-color:var(--acc);border-style:solid}
.th{width:56px;height:56px;border-radius:9px;background:var(--p3);overflow:hidden;display:flex;align-items:center;justify-content:center}
.th canvas{width:100%;height:100%;display:block}
.slot b{display:block;font-size:12.5px}
.slot small{display:block;font-size:11px;color:var(--faint)}
.slot .ops{display:flex;gap:5px;flex-wrap:wrap;justify-content:flex-end;max-width:176px}
.swatches{display:flex;gap:8px;flex-wrap:wrap}
.sw{width:34px;height:34px;border-radius:50%;border:2px solid transparent;box-shadow:0 0 0 1px rgba(255,255,255,.08) inset}
.sw[aria-pressed=true]{border-color:#fff}
input[type=range]{width:100%;accent-color:var(--acc)}
.rng{display:grid;grid-template-columns:96px 1fr 34px;gap:8px;align-items:center;font-size:11.5px;color:var(--dim);font-weight:600}
.rng + .rng{margin-top:6px}
.rng output{text-align:right;color:var(--faint);font-variant-numeric:tabular-nums}
.list{display:grid;gap:6px}
.it{display:grid;grid-template-columns:40px 1fr auto;gap:8px;align-items:center}
.it .th{width:40px;height:40px;border-radius:8px}
.it .ops{display:flex;gap:4px}
.ib{border:1px solid var(--line);background:var(--p2);border-radius:8px;min-width:30px;height:30px;font-size:12px;font-weight:800;color:var(--dim)}
.ib:hover{color:var(--text);border-color:var(--line2)}
.fx{display:grid;grid-template-columns:1fr 1fr;gap:6px}
.mini{font-size:11px;color:var(--faint);line-height:1.4}
.who{display:flex;gap:8px;align-items:center;margin-top:8px;font-size:12px;color:var(--dim)}
.who .th{width:38px;height:38px;border-radius:8px}
.tg{display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px}
.toast{position:fixed;left:50%;bottom:24px;transform:translate(-50%,30px);opacity:0;background:#1C1C2A;border:1px solid var(--line2);
  color:var(--text);padding:10px 16px;border-radius:12px;font-size:13px;font-weight:600;transition:.25s;z-index:60;pointer-events:none;
  box-shadow:0 12px 40px rgba(0,0,0,.5);max-width:92vw;text-align:center}
.toast.on{opacity:1;transform:translate(-50%,0)}
.busy{opacity:.55;pointer-events:none}
@media(max-width:1200px){
  .app{grid-template-columns:minmax(0,1fr) 370px}
  .gal{grid-column:1/-1;position:static;max-height:none;border-right:0;border-bottom:1px solid var(--line);display:flex;gap:10px;
    overflow-x:auto;padding:10px 14px}
  .gal h4{display:none}
  .tcard{flex:0 0 128px;margin:0}
}
@media(max-width:860px){
  .app{grid-template-columns:1fr}
  .insp{position:static;max-height:none;border-left:0}
  /* the header scrolls away; the poster stays pinned at the top while the editor scrolls under it,
     so every tap on a chip, theme or slider shows its effect */
  .top{position:static;flex-wrap:wrap;gap:6px 8px;padding:calc(6px + env(safe-area-inset-top)) 10px 6px}
  .back{padding:6px 9px;font-size:12px}
  .ttl span{display:none}
  .acts{width:100%;gap:6px}
  .acts .btn{padding:7px 10px;font-size:12px}
  .acts .btn.pri{margin-left:auto}
  .stage{position:sticky;top:0;z-index:25;padding:8px 10px 6px;gap:4px;background:rgba(7,7,11,.97);
    border-bottom:1px solid var(--line);box-shadow:0 10px 24px rgba(0,0,0,.45)}
  .cwrap{max-width:min(100%, calc(38vh * var(--ar)))}
  .tip{display:none}
  .gnote{min-height:0}
}
</style>
</head>
<body>
<header class="top">
  <a class="back" href="/studio">&larr; Studio</a>
  <div class="ttl"><b>Templates</b><span id="tplName"></span></div>
  <div class="acts">
    <div class="seg" id="sizeSeg" role="group" aria-label="Poster size">
      <button type="button" data-size="1x1" aria-pressed="true">1:1</button>
      <button type="button" data-size="4x5" aria-pressed="false">4:5</button>
    </div>
    <button class="btn" type="button" id="undoBtn" title="Undo (Ctrl+Z)">Undo</button>
    <button class="btn" type="button" id="redoBtn" title="Redo (Ctrl+Shift+Z)">Redo</button>
    <button class="btn" type="button" id="copyBtn">Copy image</button>
    <button class="btn pri" type="button" id="dlBtn">Download PNG</button>
  </div>
</header>
<div class="app">
  <aside class="gal" id="gal" aria-label="Templates"></aside>
  <main class="stage">
    <div class="cwrap" id="cwrap">
      <canvas id="cv" width="1080" height="1080" aria-label="Poster preview"></canvas>
      <canvas id="ov" aria-hidden="true"></canvas>
    </div>
    <p class="gnote" id="gradeNote" role="status" aria-live="polite" hidden></p>
    <p class="tip" id="tip">Drop photos or cut-outs onto the poster: each one snaps into the slot under the pointer, and a photo
      dropped on a fighter is cut out for you. Drag to move, scroll or pinch to zoom, double-click to reset. Tap a word under a
      text box to color it.</p>
  </main>
  <aside class="insp" id="insp" aria-label="Edit"></aside>
</div>
<div class="toast" id="toast" role="status" aria-live="polite"></div>
<input type="file" id="file" accept="image/*" multiple hidden>
<script>
(function () {
"use strict";
var NL = String.fromCharCode(10);
var LQ = String.fromCharCode(8220), RQ = String.fromCharCode(8221), DOT = String.fromCharCode(183);
var APOS = String.fromCharCode(8217);
var W = 1080, H = 1080;
var cv = document.getElementById("cv"), g = cv.getContext("2d");
var ov = document.getElementById("ov"), og = ov.getContext("2d");

function $(id) { return document.getElementById(id); }
function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
function lerp(a, b, t) { return a + (b - a) * t; }
function smooth(e0, e1, x) { var t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); }
function el(tag, cls, txt) {
  var e = document.createElement(tag);
  if (cls) e.className = cls;
  if (txt != null) e.textContent = txt;
  return e;
}
function mkCanvas(w, h) {
  var c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h));
  return c;
}
var toastT = 0;
function toast(msg) {
  var t = $("toast");
  t.textContent = msg;
  t.classList.add("on");
  clearTimeout(toastT);
  toastT = setTimeout(function () { t.classList.remove("on"); }, Math.max(2600, String(msg).length * 60));
}
function upper(s) { return String(s || "").toUpperCase(); }
function slugify(name) {
  var s = String(name || "").toLowerCase();
  if (s.normalize) s = s.normalize("NFD");
  var out = "", dash = false;
  for (var i = 0; i < s.length; i++) {
    var c = s.charCodeAt(i);
    var ok = (c >= 97 && c <= 122) || (c >= 48 && c <= 57);
    if (ok) { out += s.charAt(i); dash = false; }
    else if (c === 32 || c === 45 || c === 95) { if (!dash && out) { out += "-"; dash = true; } }
  }
  while (out.charAt(out.length - 1) === "-") out = out.slice(0, -1);
  return out.slice(0, 60);
}
function splitName(full) {
  var p = String(full || "").trim().split(" ").filter(Boolean);
  if (!p.length) return { first: "", last: "" };
  if (p.length === 1) return { first: "", last: p[0] };
  var cut = p.length - 1;
  var parts = ["du", "de", "da", "dos", "van", "von", "della", "st.", "al", "el", "machado", "de la"];
  while (cut > 1 && parts.indexOf(p[cut - 1].toLowerCase()) !== -1) cut--;
  return { first: p.slice(0, cut).join(" "), last: p.slice(cut).join(" ") };
}

// ---------- color ----------
function hexRgb(h) {
  h = String(h || "#000000").replace("#", "");
  if (h.length === 3) h = h.charAt(0) + h.charAt(0) + h.charAt(1) + h.charAt(1) + h.charAt(2) + h.charAt(2);
  var n = parseInt(h, 16) || 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function rgbHex(c) {
  var s = "#";
  for (var i = 0; i < 3; i++) { var v = clamp(Math.round(c[i]), 0, 255); s += (v < 16 ? "0" : "") + v.toString(16); }
  return s;
}
function mix(a, b, t) {
  var x = hexRgb(a), y = hexRgb(b);
  return rgbHex([lerp(x[0], y[0], t), lerp(x[1], y[1], t), lerp(x[2], y[2], t)]);
}
function rgba(h, a) { var c = hexRgb(h); return "rgba(" + c[0] + "," + c[1] + "," + c[2] + "," + a + ")"; }

// ---------- libraries (pasted by the build; the approved ports) ----------
// grade_gritty.js - the approved GRITTY poster look (lab final_g/look.py, Sept 25 2026) in plain
// browser JavaScript. Pure maths: no DOM and no canvas inside. Everything works on
//   plane  = Float32Array of w * h values (w and h are passed alongside)
//   canvas = { w, h, c: [R, G, B] }  three planes, 0..1
//   image  = { w, h, data }  interleaved RGBA Float32Array, 0..1 (a Uint8ClampedArray is accepted
//            as input and divided by 255)
// Port rules kept from look.py: every blur is a running-sum box (3 boxes = a Gaussian, wide ones
// run on an area-downscaled copy), masked blurs are blur(x * w) / blur(w), the guided filter is
// built from box means, curves and gradient maps are 1024-entry LUTs. The box sums are float32
// running sums exactly like numpy's cumsum, the down / up sampling reproduces cv2's INTER_AREA
// and INTER_LINEAR tables, and Python's half-to-even round() is kept wherever look.py rounds, so
// the port lands on the numpy reference (see port_g/compare.py for the measured parity).
// Noise is a seeded mulberry32 + Box-Muller field (deterministic, same as the parity harness).
// Written for poster_page.js: no backslash, no backtick, no dollar-brace, ASCII only, ES5 syntax.
function gritFactory() {
"use strict";

var REF_W = 640;
var F32 = Math.fround;

// ---------- scalar helpers ----------
function nowMs() { return typeof performance !== 'undefined' ? performance.now() : Date.now(); }
function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
function smooth(e0, e1, x) { var t = (x - e0) / (e1 - e0); t = t < 0 ? 0 : t > 1 ? 1 : t; return t * t * (3 - 2 * t); }
function lerp(a, b, t) { return a + (b - a) * t; }
// Python round(): halves go to the even neighbour (round(2.5) = 2)
function roundHE(x) {
  var f = Math.floor(x), d = x - f;
  if (d > 0.5) return f + 1;
  if (d < 0.5) return f;
  return f % 2 === 0 ? f : f + 1;
}
function hex01(h) {
  h = String(h || "#000000").replace("#", "");
  var n = parseInt(h, 16) || 0;
  return [F32(((n >> 16) & 255) / 255), F32(((n >> 8) & 255) / 255), F32((n & 255) / 255)];
}
function lumaOf(c) { return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; }
function hueDist(a, b) { var d = Math.abs(a - b) % 360; return Math.min(d, 360 - d); }

// fast tanh (Eigen's float minimax rational, |error| < 3e-7): far under the float32 noise of the
// numpy reference
function tanhF(x) {
  var c = x > 7.9053111 ? 7.9053111 : x < -7.9053111 ? -7.9053111 : x, x2 = c * c;
  var p = ((((((-2.76076847742355e-16 * x2 + 2.00018790482477e-13) * x2 - 8.60467152213735e-11) * x2 + 5.12229709037114e-08) * x2
    + 1.48572235717979e-05) * x2 + 6.37261928875436e-04) * x2 + 4.89352455891786e-03) * c;
  return p / (((1.19825839466702e-06 * x2 + 1.18534705686654e-04) * x2 + 2.26843463243900e-03) * x2 + 4.89352518554385e-03);
}
// exp2: 2^round(x) from a table times a degree-8 series on [-.5, .5] (relative error < 1e-9)
var POW2 = new Float64Array(160);
(function () { for (var i = 0; i < 160; i++) POW2[i] = Math.pow(2, i - 80); })();
function exp2F(x) {
  if (!(x > -79 && x < 79)) return Math.pow(2, x);
  var i = Math.floor(x + 0.5), f = x - i;
  return POW2[i + 80] * (1 + f * (0.6931471805599453 + f * (0.2402265069591007 + f * (0.05550410866482158 + f * (0.009618129107628477
    + f * (0.0013333558146428443 + f * (0.00015403530393381606 + f * (1.525273380405984e-5 + f * 1.3215486790144307e-6))))))));
}
// tanh for the band clips: an odd series for |u| < .25 (error < 1e-7), the rational above beyond
function tanhS(u) {
  if (u > -0.25 && u < 0.25) { var u2 = u * u; return u * (1 + u2 * (-0.3333333333333333 + u2 * (0.13333333333333333 + u2 * -0.05396825396825397))); }
  return tanhF(u);
}

// ---------- planes ----------
function newF(n) { return new Float32Array(n); }
function copyF(a) { return new Float32Array(a); }
function constF(n, v) { var o = new Float32Array(n); if (v) o.fill(v); return o; }
function maxOf(a) { var m = -Infinity; for (var i = 0; i < a.length; i++) if (a[i] > m) m = a[i]; return m; }
function minOf(a) { var m = Infinity; for (var i = 0; i < a.length; i++) if (a[i] < m) m = a[i]; return m; }
function countOf(mask) { var c = 0; for (var i = 0; i < mask.length; i++) if (mask[i]) c++; return c; }
function toF(mask) { var o = new Float32Array(mask.length); for (var i = 0; i < mask.length; i++) o[i] = mask[i] ? 1 : 0; return o; }
function cropF(src, w, x0, y0, x1, y1) {
  var cw = x1 - x0, ch = y1 - y0, o = new Float32Array(cw * ch), y;
  for (y = 0; y < ch; y++) o.set(src.subarray((y0 + y) * w + x0, (y0 + y) * w + x1), y * cw);
  return o;
}
function cropM(src, w, x0, y0, x1, y1) {
  var cw = x1 - x0, ch = y1 - y0, o = new Uint8Array(cw * ch), y;
  for (y = 0; y < ch; y++) o.set(src.subarray((y0 + y) * w + x0, (y0 + y) * w + x1), y * cw);
  return o;
}
function meanStd(a) {
  var s = 0, i, n = a.length;
  for (i = 0; i < n; i++) s += a[i];
  var mu = s / n, v = 0, d;
  for (i = 0; i < n; i++) { d = a[i] - mu; v += d * d; }
  return [mu, Math.sqrt(v / n)];
}

// ---------- box blur (float32 running sums in numpy's cumsum order: bit-exact with look.box) ----------
// Streamed: the vertical running sum lives in a ring of n + 1 rows, finished rows are collected four
// at a time and their horizontal running sums are interleaved (four independent add chains keep
// the CPU busy; every row still adds in exactly numpy's order), so a pass only touches the source,
// the output and small row buffers.
var RING = null, VB = null, RC = null, SCR_A = null, SCR_B = null, SCR_P = null;
function grow(buf, n) { return buf && buf.length >= n ? buf : new Float32Array(Math.max(n, 16)); }
function copyN(src, n) { return new Float32Array(src.subarray(0, n)); }
function hrow1(v, vo, rc, w, r, n, inv, out, oo) {
  var a = v[vo], p = a, l = v[vo + w - 1], j, x;
  rc[0] = a;
  for (j = 1; j <= r; j++) { a = F32(a + p); rc[j] = a; }
  for (x = 0; x < w; x++, j++) { a = F32(a + v[vo + x]); rc[j] = a; }
  for (; j < w + n; j++) { a = F32(a + l); rc[j] = a; }
  for (x = 0; x < w; x++) out[oo + x] = F32(rc[x + n] - rc[x]) * inv;
}
function hrow4(v, rc, w, r, n, inv, out, oo) {
  var L = w + n, o1 = w, o2 = 2 * w, o3 = 3 * w, c1 = L, c2 = 2 * L, c3 = 3 * L, j, x;
  var a0 = v[0], a1 = v[o1], a2 = v[o2], a3 = v[o3], p0 = a0, p1 = a1, p2 = a2, p3 = a3;
  rc[0] = a0; rc[c1] = a1; rc[c2] = a2; rc[c3] = a3;
  for (j = 1; j <= r; j++) {
    a0 = F32(a0 + p0); a1 = F32(a1 + p1); a2 = F32(a2 + p2); a3 = F32(a3 + p3);
    rc[j] = a0; rc[c1 + j] = a1; rc[c2 + j] = a2; rc[c3 + j] = a3;
  }
  for (x = 0; x < w; x++, j++) {
    a0 = F32(a0 + v[x]); a1 = F32(a1 + v[o1 + x]); a2 = F32(a2 + v[o2 + x]); a3 = F32(a3 + v[o3 + x]);
    rc[j] = a0; rc[c1 + j] = a1; rc[c2 + j] = a2; rc[c3 + j] = a3;
  }
  p0 = v[w - 1]; p1 = v[o1 + w - 1]; p2 = v[o2 + w - 1]; p3 = v[o3 + w - 1];
  for (; j < L; j++) {
    a0 = F32(a0 + p0); a1 = F32(a1 + p1); a2 = F32(a2 + p2); a3 = F32(a3 + p3);
    rc[j] = a0; rc[c1 + j] = a1; rc[c2 + j] = a2; rc[c3 + j] = a3;
  }
  for (x = 0; x < w; x++) {
    out[oo + x] = F32(rc[x + n] - rc[x]) * inv;
    out[oo + w + x] = F32(rc[c1 + x + n] - rc[c1 + x]) * inv;
    out[oo + 2 * w + x] = F32(rc[c2 + x + n] - rc[c2 + x]) * inv;
    out[oo + 3 * w + x] = F32(rc[c3 + x + n] - rc[c3 + x]) * inv;
  }
}
function boxInto(src, w, h, r, out) {
  var n = 2 * r + 1, inv = F32(1 / n), R = n + 1, rows = h + n, x, k, y, sy, so, slot, po, lo, vo, t, nb = 0, yb = 0;
  RING = grow(RING, R * w); VB = grow(VB, 4 * w); RC = grow(RC, 4 * (w + n));
  var ring = RING, v = VB, rc = RC;
  // vertical: padded rows = r + 1 copies of row 0, the rows, r copies of the last row
  for (x = 0; x < w; x++) ring[x] = src[x];
  po = 0;
  for (k = 1; k < n && k < rows; k++) {
    sy = k - r - 1; sy = sy < 0 ? 0 : sy >= h ? h - 1 : sy;
    so = sy * w; slot = (k % R) * w;
    for (x = 0; x < w; x++) ring[slot + x] = ring[po + x] + src[so + x];
    po = slot;
  }
  for (; k < rows; k++) {
    sy = k - r - 1; sy = sy < 0 ? 0 : sy >= h ? h - 1 : sy;
    so = sy * w; slot = (k % R) * w; y = k - n; lo = (y % R) * w; vo = nb * w;
    for (x = 0; x < w; x++) { t = F32(ring[po + x] + src[so + x]); ring[slot + x] = t; v[vo + x] = F32(t - ring[lo + x]) * inv; }
    po = slot;
    if (++nb === 4) { hrow4(v, rc, w, r, n, inv, out, yb * w); nb = 0; yb = y + 1; }
  }
  for (var q = 0; q < nb; q++) hrow1(v, q * w, rc, w, r, n, inv, out, (yb + q) * w);
  return out;
}
function box(src, w, h, r, out) {
  r = Math.floor(r);
  if (r < 1) return copyN(src, w * h);
  return boxInto(src, w, h, r, out || new Float32Array(w * h));
}
// box of integer WIDTH n (look._box_width: even widths use the half-pixel shifted window, float64)
function boxWidth(src, w, h, n) {
  if (n <= 1) return src;
  if (n % 2 === 1) return box(src, w, h, (n - 1) / 2);
  var r = n / 2, rows = h + n + 1, c = new Float64Array(rows * w), tmp = new Float32Array(w * h);
  var out = new Float32Array(w * h), x, y, k, o, s, hi;
  for (x = 0; x < w; x++) c[x] = src[x];
  for (k = 1; k < rows; k++) {
    y = k - r - 1; y = y < 0 ? 0 : y >= h ? h - 1 : y;
    o = k * w; s = y * w;
    for (x = 0; x < w; x++) c[o + x] = c[o - w + x] + src[s + x];
  }
  for (y = 0; y < h; y++) { o = y * w; hi = (y + n) * w; for (x = 0; x < w; x++) tmp[o + x] = (c[hi + x] - c[o + x]) / n; }
  var rc = new Float64Array(w + n + 1);
  for (y = 0; y < h; y++) {
    o = y * w;
    rc[0] = tmp[o];
    for (k = 1; k < w + n + 1; k++) { x = k - r - 1; x = x < 0 ? 0 : x >= w ? w - 1 : x; rc[k] = rc[k - 1] + tmp[o + x]; }
    for (x = 0; x < w; x++) out[o + x] = (rc[x + n] - rc[x]) / n;
  }
  return out;
}

// ---------- down / up sampling (cv2 INTER_AREA / INTER_LINEAR tables, cached per size pair) ----------
var TABS = {}, NTABS = 0;
function tabCache(key, make) {
  var t = TABS[key];
  if (t) return t;
  if (NTABS > 200) { TABS = {}; NTABS = 0; }
  NTABS++;
  return (TABS[key] = make());
}
// per destination index: its source indices and weights, contiguous from start[d] to start[d + 1]
function areaTab(ss, ds) {
  return tabCache("a" + ss + ":" + ds, function () {
    var scale = 1 / (ds / ss), si = [], al = [], st = new Int32Array(ds + 1), dx, sx;
    for (dx = 0; dx < ds; dx++) {
      st[dx] = si.length;
      var f1 = dx * scale, f2 = f1 + scale, cw = Math.min(scale, ss - f1);
      var s1 = Math.ceil(f1), s2 = Math.floor(f2);
      s2 = Math.min(s2, ss - 1); s1 = Math.min(s1, s2);
      if (s1 - f1 > 1e-3) { si.push(s1 - 1); al.push(F32((s1 - f1) / cw)); }
      for (sx = s1; sx < s2; sx++) { si.push(sx); al.push(F32(1 / cw)); }
      if (f2 - s2 > 1e-3) { si.push(s2); al.push(F32(Math.min(Math.min(f2 - s2, 1), cw) / cw)); }
    }
    st[ds] = si.length;
    return { st: st, si: Int32Array.from(si), al: Float64Array.from(al) };
  });
}
var ARow = null, AAcc = null;
function resizeArea(src, w, h, dw, dh) {
  if (dw === w && dh === h) return copyN(src, w * h);
  if (dw > w || dh > h) return resizeLinear(src, w, h, dw, dh);
  return resizeAreaRegion(src, w, h, dw, dh, 0, 0, dw, dh);
}
// cv2 INTER_AREA for the destination pixels [dx0, dx1) x [dy0, dy1) only (same arithmetic per pixel
// as the full resize); returns a (dx1 - dx0) x (dy1 - dy0) plane
// (row helpers: every per-row inner loop lives in its own small function, which V8 optimises after
// a few rows; nested loops in a function that runs only a few times keep falling out of on-stack
// replaced code and ran several times slower)
function areaGatherRow(src, o, row, dx0, dx1, xst, xsi, xal) {
  for (var x = dx0; x < dx1; x++) { var s = 0, e1 = xst[x + 1]; for (var k = xst[x]; k < e1; k++) s += xal[k] * src[o + xsi[k]]; row[x] = s; }
}
function areaAccRow(acc, row, b, dx0, dx1) { for (var x = dx0; x < dx1; x++) acc[x] += b * row[x]; }
function areaBlockRow(src, o, acc0, dx0, dx1, fx) {
  for (var x = dx0; x < dx1; x++) { var s0 = 0, b0 = o + x * fx; for (var xx = 0; xx < fx; xx++) s0 += src[b0 + xx]; acc0[x - dx0] += s0; }
}
function storeRow(res, ob, acc, a0, n, sc) { for (var x = 0; x < n; x++) res[ob + x] = acc[a0 + x] * sc; }
function resizeAreaRegion(src, w, h, dw, dh, dx0, dy0, dx1, dy1) {
  var rw = dx1 - dx0, rh = dy1 - dy0, res = new Float32Array(rw * rh), y, o;
  if (w % dw === 0 && h % dh === 0) {
    // integer ratio: the plain block mean (cv2's fast area path)
    var fx = w / dw, fy = h / dh, sc = 1 / (fx * fy), acc0 = new Float64Array(rw), yy;
    for (y = dy0; y < dy1; y++) {
      acc0.fill(0);
      for (yy = 0; yy < fy; yy++) areaBlockRow(src, (y * fy + yy) * w, acc0, dx0, dx1, fx);
      storeRow(res, (y - dy0) * rw, acc0, 0, rw, sc);
    }
    return res;
  }
  var tx = areaTab(w, dw), ty = areaTab(h, dh), xst = tx.st, xsi = tx.si, xal = tx.al;
  if (!ARow || ARow.length < dw) { ARow = new Float64Array(dw); AAcc = new Float64Array(dw); }
  var row = ARow, acc = AAcc, last = -1, sy;
  for (y = dy0; y < dy1; y++) {
    acc.fill(0, dx0, dx1);
    for (var e = ty.st[y]; e < ty.st[y + 1]; e++) {
      sy = ty.si[e];
      if (sy !== last) { areaGatherRow(src, sy * w, row, dx0, dx1, xst, xsi, xal); last = sy; }
      areaAccRow(acc, row, ty.al[e], dx0, dx1);
    }
    storeRow(res, (y - dy0) * rw, acc, dx0, rw, 1);
  }
  return res;
}
function linTab(ss, ds) {
  return tabCache("l" + ss + ":" + ds, function () {
    var scale = 1 / (ds / ss), ofs = new Int32Array(ds), of1 = new Int32Array(ds), fr = new Float64Array(ds), d, f, s;
    for (d = 0; d < ds; d++) {
      f = F32((d + 0.5) * scale - 0.5); s = Math.floor(f); f = F32(f - s);
      if (s < 0) { f = 0; s = 0; }
      if (s >= ss - 1) { f = 0; s = ss - 1; }
      ofs[d] = s; of1[d] = s + 1 < ss ? s + 1 : s; fr[d] = f;
    }
    return { ofs: ofs, of1: of1, fr: fr };
  });
}
function linHRow(src, o, hb, ob, xo, x1, xf, dw) { for (var x = 0; x < dw; x++) { var f = xf[x]; hb[ob + x] = src[o + xo[x]] * (1 - f) + src[o + x1[x]] * f; } }
function linVRow(out, o, hb, r0, r1, f0, f, dw) { for (var x = 0; x < dw; x++) out[o + x] = hb[r0 + x] * f0 + hb[r1 + x] * f; }
function resizeLinear(src, w, h, dw, dh, out) {
  var tx = linTab(w, dw), ty = linTab(h, dh), hb = new Float32Array(h * dw), y, f;
  out = out || new Float32Array(dw * dh);
  for (y = 0; y < h; y++) linHRow(src, y * w, hb, y * dw, tx.ofs, tx.of1, tx.fr, dw);
  for (y = 0; y < dh; y++) { f = ty.fr[y]; linVRow(out, y * dw, hb, ty.ofs[y] * dw, ty.of1[y] * dw, 1 - f, f, dw); }
  return out;
}
// down / up helpers (look._down / look._up)
function downF(src, w, h, f) {
  var dw = Math.max(2, Math.floor(w / f)), dh = Math.max(2, Math.floor(h / f));
  return { d: resizeArea(src, w, h, dw, dh), w: dw, h: dh };
}
// area-average down to the references' 640 px scale (look.to_ref_scale)
function toRef(src, w, h, px) {
  if (Math.abs(px - 1) < 1e-3) return { d: src, w: w, h: h };
  var dw = Math.max(4, roundHE(w / px)), dh = Math.max(4, roundHE(h / px));
  return { d: resizeArea(src, w, h, dw, dh), w: dw, h: dh };
}
function toRefMask(mask, w, h, px, thr) {
  var r = toRef(toF(mask), w, h, px), o = new Uint8Array(r.d.length);
  for (var i = 0; i < o.length; i++) o[i] = r.d[i] > thr ? 1 : 0;
  return { m: o, w: r.w, h: r.h };
}

// ---------- Gaussian (3 boxes) and masked blurs ----------
function gblur(src, w, h, sigma, out) {
  var n = w * h;
  if (sigma < 0.45) { if (out) { out.set(src.subarray(0, n)); return out; } return copyN(src, n); }
  if (sigma > 6) {
    var f = Math.min(8, Math.floor(sigma / 3)) | 0;
    var s = downF(src, w, h, f);
    return resizeLinear(gblur(s.d, s.w, s.h, sigma / f), s.w, s.h, w, h, out);
  }
  var r = Math.max(1, roundHE((Math.sqrt(4 * sigma * sigma + 1) - 1) / 2));
  SCR_A = grow(SCR_A, n); SCR_B = grow(SCR_B, n);
  boxInto(src, w, h, r, SCR_A);
  boxInto(SCR_A, w, h, r, SCR_B);
  return boxInto(SCR_B, w, h, r, out || new Float32Array(n));
}
// a per-grade cache of masked-blur denominators (the same weight + sigma recurs many times);
// a weight array is never modified once it has been used as a weight
var DEN = [];
function denOf(wt, w, h, sigma, isBox) {
  for (var i = 0; i < DEN.length; i++) if (DEN[i].wt === wt && DEN[i].s === sigma && DEN[i].b === isBox) return DEN[i].d;
  var d = isBox ? box(wt, w, h, sigma) : gblur(wt, w, h, sigma);
  var e = F32(1e-4);
  for (i = 0; i < d.length; i++) if (d[i] < e) d[i] = e;
  DEN.push({ wt: wt, s: sigma, b: isBox, d: d });
  if (DEN.length > 8) DEN.shift();
  return d;
}
function mulF(a, b) { var o = new Float32Array(a.length); for (var i = 0; i < a.length; i++) o[i] = a[i] * b[i]; return o; }
function prodScratch(x, wt, n) { SCR_P = grow(SCR_P, n); var P = SCR_P; for (var i = 0; i < n; i++) P[i] = x[i] * wt[i]; return P; }
function mbox(x, wt, w, h, r) {
  var n = w * h, den = denOf(wt, w, h, r, true), o = box(prodScratch(x, wt, n), w, h, r);
  for (var i = 0; i < n; i++) o[i] = o[i] / den[i];
  return o;
}
function mblur(x, wt, w, h, sigma) {
  var n = w * h, den = denOf(wt, w, h, sigma, false), o = gblur(prodScratch(x, wt, n), w, h, sigma);
  for (var i = 0; i < n; i++) o[i] = o[i] / den[i];
  return o;
}
function mblurN(xs, wt, w, h, sigma) { var o = []; for (var k = 0; k < xs.length; k++) o.push(mblur(xs[k], wt, w, h, sigma)); return o; }
function gblurN(xs, w, h, sigma) { var o = []; for (var k = 0; k < xs.length; k++) o.push(gblur(xs[k], w, h, sigma)); return o; }

// ---------- guided filter from box means (He et al.; wide radii on a subsampled copy) ----------
function guided(I, p, w, h, r, eps, m, sub) {
  r = Math.max(1, Math.floor(r));
  if (sub == null) sub = r >= 24 ? 4 : (r >= 8 ? 2 : 1);
  var n = w * h, i;
  if (!m) m = constF(n, 1);
  var same = p === I;
  function csum(a, wt) { var s = 0, t = 0; for (var j = 0; j < a.length; j++) { s += a[j] * wt[j]; t += wt[j]; } return s / Math.max(t, 1e-6); }
  if (sub > 1) {
    var Is = downF(I, w, h, sub), ps = same ? Is : downF(p, w, h, sub), ms = downF(m, w, h, sub);
    var sw = Is.w, sh = Is.h, ns = sw * sh, rs = Math.max(1, roundHE(r / sub));
    var cI = csum(Is.d, ms.d), cp = csum(ps.d, ms.d);
    var J = newF(ns), Q = newF(ns), JJ = newF(ns), JQ = newF(ns);
    for (i = 0; i < ns; i++) { J[i] = Is.d[i] - cI; Q[i] = ps.d[i] - cp; JJ[i] = J[i] * J[i]; JQ[i] = J[i] * Q[i]; }
    var mI = mbox(J, ms.d, sw, sh, rs), mp = mbox(Q, ms.d, sw, sh, rs);
    var mII = mbox(JJ, ms.d, sw, sh, rs), mIp = mbox(JQ, ms.d, sw, sh, rs);
    var A = newF(ns), B = newF(ns);
    for (i = 0; i < ns; i++) {
      var v = mII[i] - mI[i] * mI[i]; if (v < 0) v = 0;
      A[i] = (mIp[i] - mI[i] * mp[i]) / (v + eps);
      B[i] = mp[i] - A[i] * mI[i];
    }
    var Au = resizeLinear(mbox(A, ms.d, sw, sh, rs), sw, sh, w, h), Bu = resizeLinear(mbox(B, ms.d, sw, sh, rs), sw, sh, w, h);
    var out = newF(n);
    for (i = 0; i < n; i++) out[i] = Au[i] * (I[i] - cI) + Bu[i] + cp;
    return out;
  }
  var cI1 = csum(I, m), cp1 = same ? cI1 : csum(p, m);
  var J1 = newF(n), Q1 = same ? J1 : newF(n), JJ1 = newF(n), JQ1 = same ? JJ1 : newF(n);
  for (i = 0; i < n; i++) {
    J1[i] = I[i] - cI1; JJ1[i] = J1[i] * J1[i];
    if (!same) { Q1[i] = p[i] - cp1; JQ1[i] = J1[i] * Q1[i]; }
  }
  var mI1 = mbox(J1, m, w, h, r), mp1 = same ? mI1 : mbox(Q1, m, w, h, r);
  var mII1 = mbox(JJ1, m, w, h, r), mIp1 = same ? mII1 : mbox(JQ1, m, w, h, r);
  var A1 = newF(n), B1 = newF(n);
  for (i = 0; i < n; i++) {
    var v1 = mII1[i] - mI1[i] * mI1[i]; if (v1 < 0) v1 = 0;
    A1[i] = (mIp1[i] - mI1[i] * mp1[i]) / (v1 + eps);
    B1[i] = mp1[i] - A1[i] * mI1[i];
  }
  var mA = mbox(A1, m, w, h, r), mB = mbox(B1, m, w, h, r), out1 = newF(n);
  for (i = 0; i < n; i++) out1[i] = mA[i] * J1[i] + mB[i] + cp1;
  return out1;
}

// ---------- percentiles (numpy 'linear'; exact order statistics by quickselect) ----------
function selectK(a, lo, hi, k) {
  while (hi > lo) {
    var mid = (lo + hi) >> 1, t;
    if (a[mid] < a[lo]) { t = a[mid]; a[mid] = a[lo]; a[lo] = t; }
    if (a[hi] < a[lo]) { t = a[hi]; a[hi] = a[lo]; a[lo] = t; }
    if (a[hi] < a[mid]) { t = a[hi]; a[hi] = a[mid]; a[mid] = t; }
    var pv = a[mid], i = lo, j = hi;
    while (i <= j) {
      while (a[i] < pv) i++;
      while (a[j] > pv) j--;
      if (i <= j) { t = a[i]; a[i] = a[j]; a[j] = t; i++; j--; }
    }
    if (k <= j) hi = j; else if (k >= i) lo = i; else return a[k];
  }
  return a[k];
}
function npLerp(a, b, t) { return t >= 0.5 ? b - (b - a) * (1 - t) : a + (b - a) * t; }
// quantiles of vals[0..n) (the array is reordered); qs in percent
function quantilesOf(vals, n, qs) {
  if (n <= 0) { var z = []; for (var q0 = 0; q0 < qs.length; q0++) z.push(0); return z; }
  var a = vals.subarray(0, n), need = [], i, out = [];
  for (i = 0; i < qs.length; i++) {
    var vi = qs[i] / 100 * (n - 1), p = Math.floor(vi);
    need.push([vi, p, Math.min(p + 1, n - 1)]);
  }
  var ks = [];
  for (i = 0; i < need.length; i++) { ks.push(need[i][1]); ks.push(need[i][2]); }
  ks.sort(function (x, y) { return x - y; });
  var got = {}, lo = 0;
  for (i = 0; i < ks.length; i++) {
    var k = ks[i];
    if (got[k] === undefined) { got[k] = selectK(a, lo, n - 1, k); lo = k; }
  }
  for (i = 0; i < need.length; i++) {
    var e = need[i], lov = got[e[1]], hiv = got[e[2]];
    out.push(e[2] === e[1] ? lov : npLerp(lov, hiv, e[0] - e[1]));
  }
  return out;
}
function pctMasked(src, mask, qs) {
  var n = 0, i, buf = new Float32Array(src.length);
  if (mask) { for (i = 0; i < src.length; i++) if (mask[i]) buf[n++] = src[i]; }
  else { buf.set(src); n = src.length; }
  return quantilesOf(buf, n, qs);
}
function medianMasked(src, mask) { return pctMasked(src, mask, [50])[0]; }

// ---------- local contrast at the 640 scale (look.lc_values) ----------
function lcValues(Lr, w, h, region, sizes) {
  sizes = sizes || [2, 8, 32];
  var out = [], k, i;
  for (k = 0; k < sizes.length; k++) {
    var b = boxWidth(Lr, w, h, sizes[k]), s = 0, c = 0;
    for (i = 0; i < Lr.length; i++) if (region[i]) { var d = F32(Lr[i] - b[i]); s += d * d; c++; }
    out.push(c ? Math.sqrt(s / c) : 0);
  }
  return out;
}

// ---------- noise: mulberry32 uniforms, Box-Muller (both normals of every pair) ----------
// uniform k = hash(seed + k * 0x6D2B79F5); pair j = (u[2j], u[2j+1]) gives
// n[2j] = sqrt(-2 ln(1 - u0)) cos(2 pi u1) and n[2j+1] = the same radius times sin(2 pi u1)
function gaussPlane(h, w, seed) {
  var n = w * h, out = new Float32Array(n), a = seed >>> 0, i, t, u1, u2, rr, th;
  for (i = 0; i < n; i += 2) {
    a = (a + 0x6D2B79F5) | 0;
    t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    u1 = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    a = (a + 0x6D2B79F5) | 0;
    t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    u2 = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    rr = Math.sqrt(-2 * Math.log(1 - u1)); th = 2 * Math.PI * u2;
    out[i] = rr * Math.cos(th);
    if (i + 1 < n) out[i + 1] = rr * Math.sin(th);
  }
  return out;
}
// unit-std Gaussian noise, optionally clumped by a small blur (look.noise)
function noise(h, w, seed, sigmaPx) {
  var n = gaussPlane(h, w, seed);
  if (sigmaPx > 0.4) {
    n = gblur(n, w, h, sigmaPx);
    var sd = Math.max(meanStd(n)[1], 1e-6);
    for (var i = 0; i < n.length; i++) n[i] = n[i] / sd;
  }
  return n;
}

// ---------- colour maths ----------
function hueDeg(r, g, b) {
  var mx = r > g ? (r > b ? r : b) : (g > b ? g : b), mn = r < g ? (r < b ? r : b) : (g < b ? g : b);
  var d = mx - mn; if (d < 1e-6) d = 1e-6;
  var h;
  if (mx === r) { h = ((g - b) / d) % 6; if (h < 0) h += 6; }
  else if (mx === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return h * 60;
}
function hsvSat(r, g, b) {
  var mx = r > g ? (r > b ? r : b) : (g > b ? g : b), mn = r < g ? (r < b ? r : b) : (g < b ? g : b);
  return mx > 1e-4 ? (mx - mn) / mx : 0;
}
function hueMap(c) { var n = c[0].length, o = newF(n); for (var i = 0; i < n; i++) o[i] = hueDeg(c[0][i], c[1][i], c[2][i]); return o; }
function satMap(c) { var n = c[0].length, o = newF(n); for (var i = 0; i < n; i++) o[i] = hsvSat(c[0][i], c[1][i], c[2][i]); return o; }
function lumaMap(c) {
  var n = c[0].length, o = newF(n), R = c[0], G = c[1], B = c[2];
  for (var i = 0; i < n; i++) o[i] = 0.2126 * R[i] + 0.7152 * G[i] + 0.0722 * B[i];
  return o;
}
// 3x3 hue rotation around the grey axis
function rotMat(deg) {
  var a = deg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a), k = 1 / 3, sq = Math.sqrt(1 / 3);
  return [F32(c + (1 - c) * k), F32(k * (1 - c) - sq * s), F32(k * (1 - c) + sq * s),
          F32(k * (1 - c) + sq * s), F32(c + k * (1 - c)), F32(k * (1 - c) - sq * s),
          F32(k * (1 - c) - sq * s), F32(k * (1 - c) + sq * s), F32(c + k * (1 - c))];
}
// rgb = L + s*C with the largest s <= 1 inside 0..1 (a hue-preserving clip), written into o at i
var GAM = [0, 0, 0];
function gamutPx(L, c0, c1, c2) {
  var s = 1, t;
  if (c0 > 1e-6) { t = (1 - L) / c0; if (t < s) s = t; } else if (c0 < -1e-6) { t = -L / c0; if (t < s) s = t; }
  if (c1 > 1e-6) { t = (1 - L) / c1; if (t < s) s = t; } else if (c1 < -1e-6) { t = -L / c1; if (t < s) s = t; }
  if (c2 > 1e-6) { t = (1 - L) / c2; if (t < s) s = t; } else if (c2 < -1e-6) { t = -L / c2; if (t < s) s = t; }
  s = s < 0 ? 0 : s > 1 ? 1 : s;
  t = L + c0 * s; GAM[0] = t < 0 ? 0 : t > 1 ? 1 : t;
  t = L + c1 * s; GAM[1] = t < 0 ? 0 : t > 1 ? 1 : t;
  t = L + c2 * s; GAM[2] = t < 0 ? 0 : t > 1 ? 1 : t;
  return GAM;
}
function gamutPlanes(L, C) {
  var n = L.length, o = [newF(n), newF(n), newF(n)];
  for (var i = 0; i < n; i++) { var q = gamutPx(L[i], C[0][i], C[1][i], C[2][i]); o[0][i] = q[0]; o[1][i] = q[1]; o[2][i] = q[2]; }
  return o;
}
function softclip(x, a, pos) { var ap = a * pos; return x > 0 ? ap * tanhF(x / ap) : a * tanhF(x / a); }

// ---------- tone curves (Fritsch-Carlson monotone cubic -> 1024-entry LUT) ----------
function pchipLut(xs, ys, lo, hi, N) {
  var n = xs.length, hh = [], dd = [], m = [], k;
  for (k = 0; k < n - 1; k++) { hh.push(xs[k + 1] - xs[k]); dd.push((ys[k + 1] - ys[k]) / hh[k]); }
  for (k = 0; k < n; k++) m.push(0);
  m[0] = dd[0]; m[n - 1] = dd[n - 2];
  for (k = 1; k < n - 1; k++) {
    if (dd[k - 1] * dd[k] <= 0) m[k] = 0;
    else { var w1 = 2 * hh[k] + hh[k - 1], w2 = hh[k] + 2 * hh[k - 1]; m[k] = (w1 + w2) / (w1 / dd[k - 1] + w2 / dd[k]); }
  }
  var lut = new Float32Array(N), step = (hi - lo) / (N - 1);
  for (var i = 0; i < N; i++) {
    var t = i === N - 1 ? hi : lo + i * step, idx = 0;
    while (idx < n && xs[idx] < t) idx++;
    idx = clamp(idx - 1, 0, n - 2);
    var x0 = xs[idx], h0 = xs[idx + 1] - x0, s = clamp((t - x0) / h0, 0, 1), s2 = s * s, s3 = s2 * s;
    var v = (2 * s3 - 3 * s2 + 1) * ys[idx] + (s3 - 2 * s2 + s) * h0 * m[idx] + (-2 * s3 + 3 * s2) * ys[idx + 1] + (s3 - s2) * h0 * m[idx + 1];
    lut[i] = clamp(v, 0, 1);
  }
  return lut;
}
function makeCurve(xs, ys, lo, hi) { return { lo: lo, hi: hi, lut: pchipLut(xs, ys, lo, hi, 1024) }; }
function curveAt(cv, x) {
  var lo = cv.lo, hi = cv.hi, lut = cv.lut, sc = 1023 / (hi - lo);
  var v = x < lo ? lo : x > hi ? hi : x, i = (v - lo) * sc, i0 = Math.floor(i), i1 = i0 + 1 > 1023 ? 1023 : i0 + 1, f = i - i0;
  return lut[i0] * (1 - f) + lut[i1] * f;
}
function applyCurve(cv, src) { var o = newF(src.length); for (var i = 0; i < src.length; i++) o[i] = curveAt(cv, src[i]); return o; }
// control points (lo, black) (p10) (p50) (p90) (p99) [extra] (hi, white), slope-limited
function fitCurve(inP, outP, black, maxSlope, lo, hi, white, extra) {
  var xs = [lo].concat(inP), ys = [black].concat(outP), i;
  if (extra) { xs.push(extra[0]); ys.push(extra[1]); }
  xs.push(hi); ys.push(white);
  for (i = 1; i < xs.length; i++) xs[i] = Math.max(xs[i], xs[i - 1] + 0.015);
  for (i = 1; i < ys.length; i++) ys[i] = Math.min(Math.max(ys[i], ys[i - 1] + 0.004), ys[i - 1] + maxSlope * (xs[i] - xs[i - 1]));
  ys[ys.length - 1] = Math.max(ys[ys.length - 1], ys[ys.length - 2]);
  return makeCurve(xs, ys, xs[0], xs[xs.length - 1]);
}
// np.interp(x, xs, ys) for increasing xs
function interp1(x, xs, ys) {
  var n = xs.length;
  if (x <= xs[0]) return ys[0];
  if (x >= xs[n - 1]) return ys[n - 1];
  var lo = 0, hi = n - 1;
  while (hi - lo > 1) { var mid = (lo + hi) >> 1; if (xs[mid] <= x) lo = mid; else hi = mid; }
  return ys[lo] + (ys[hi] - ys[lo]) * (x - xs[lo]) / (xs[hi] - xs[lo]);
}

// ---------- regions ----------
// ellipse mask in float32 arithmetic (look.ellipse)
function ellipseMask(w, h, cx, cy, rx, ry) {
  var o = new Uint8Array(w * h), cxf = F32(cx), cyf = F32(cy), rxf = F32(rx), ryf = F32(ry), x, y;
  var dxs = new Float32Array(w);
  for (x = 0; x < w; x++) { var dx = F32(F32(x - cxf) / rxf); dxs[x] = F32(dx * dx); }
  for (y = 0; y < h; y++) {
    var dy = F32(F32(y - cyf) / ryf), dy2 = F32(dy * dy), off = y * w;
    for (x = 0; x < w; x++) o[off + x] = F32(dxs[x] + dy2) <= 1 ? 1 : 0;
  }
  return o;
}
function normFace(f) {
  if (!f) return null;
  if (f.length === 4) return [f[0], f[1], f[2], f[3]];
  return [f.x, f.y, f.w, f.h];
}

// =============================================================================================
// grade_subject
// =============================================================================================
var TARGETS = {
  color: { p: [0.23, 0.68, 0.86, 0.93], sat: 0.36, lc: [0.061, 0.083, 0.140] },
  natural: { p: [0.18, 0.56, 0.84, 0.95], sat: 0.40, lc: [0.050, 0.080, 0.125] },
  mono: { p: [0.20, 0.50, 0.84, 0.955], sat: 0.04, lc: [0.072, 0.104, 0.155] },
  pop: { p: [0.21, 0.50, 0.83, 0.96], sat: 0.04, lc: [0.070, 0.100, 0.150] },
  inset: { p: [0.14, 0.40, 0.70, 0.95], sat: 0.05, lc: [0.046, 0.086, 0.135] }
};
var BAND_R = [1.2, 3.5, 10.5, 33.0];
var BAND_EPS = [0.03, 0.06, 0.12, 0.20];
var BAND_K = { color: [0.44, 0.80, 1.20, 1.60], natural: [0.44, 0.80, 1.20, 1.60], mono: [0.60, 1.04, 1.56, 1.80],
               pop: [0.60, 1.04, 1.56, 1.80], inset: [0.52, 0.92, 1.32, 1.60] };
var GUARD_K = 1.5;
var BAND_POS = [0.55, 0.80, 0.85, 0.90];
var GAIN0 = { color: [1.8, 2.0, 1.8], natural: [1.6, 1.8, 1.6], mono: [2.0, 2.2, 2.0], pop: [2.0, 2.2, 2.0], inset: [1.8, 2.0, 1.8] };
var GAIN_LIM = [[1.0, 2.4], [1.0, 2.6], [1.0, 2.6]];
var BASE_C = { color: 0.90, natural: 0.90, mono: 0.82, pop: 0.82, inset: 0.80 };
var GRADE_DEFAULTS = {
  mono_mix: [0.38, 0.52, 0.10], mono_mix_deep: [0.50, 0.42, 0.08],
  mono_tint_shadow: [-0.012, 0.004, 0.010], mono_tint_high: [0.003, 0.002, -0.003],
  skin_hue_target: 7.5, skin_hue_deep: 16.0, skin_rotate_max: 6.0, skin_rotate_deep_max: 3.0,
  sat_deep_keep: 0.93, deep_fine_max: 1.15, deep_mid_max: 1.8, deep_lock: 0.5, deep_shoulder: [0.84, 0.55],
  deep_top: 1.0, deep_mid_lift: 1.03, deep_c_lo: 1.03, chroma_clarity: 0.15, sat_keep: 0.90, blue_guard: 0.9,
  grain: { color: 0.009, natural: 0.008, mono: 0.011, pop: 0.011, inset: 0.012 }, grain_lc2_share: 0.45,
  rim_dark: 0.08, upscale_tex: 0.035, rim_tame: 1.0, desalt: 1.0,
  hair_tone: { mono: 1.0, pop: 1.0, inset: 0.6, color: 0.9, natural: 0.6 },
  tex_target: { color: 0.040, natural: 0.032, mono: 0.040, pop: 0.040, inset: 0.034 },
  tex_max: 0.065, crackle_max: 1.6, sat_target: 0.36,
  // keys look.py reads with o.get(key, default)
  eps_k: 1.0, core_k: 1.0, K_k: 1.0, guard_k: GUARD_K, deep_hp: 0.12, form_share: 0.6, deep_zone: 0.0,
  smooth_hl: 1.0, edge_match: 1.0, p: null
};

function skinWeightHSV(h, s, v) {
  return smooth(2, 12, h) * (1 - smooth(42, 55, h)) * smooth(0.12, 0.22, s) * (1 - smooth(0.72, 0.84, s)) * smooth(0.05, 0.14, v);
}
function skinWeightPx(r, g, b) { return skinWeightHSV(hueDeg(r, g, b), hsvSat(r, g, b), r > g ? (r > b ? r : b) : (g > b ? g : b)); }
// hue and saturation of an rgb triple of planes, computed once and shared (hs = { h, s })
function hueSat(c) { return { h: hueMap(c), s: satMap(c) }; }
function skinWeightMap(c, hs) {
  var n = c[0].length, o = newF(n), i;
  if (!hs) { for (i = 0; i < n; i++) o[i] = skinWeightPx(c[0][i], c[1][i], c[2][i]); return o; }
  for (i = 0; i < n; i++) {
    var r = c[0][i], g = c[1][i], b = c[2][i];
    o[i] = skinWeightHSV(hs.h[i], hs.s[i], r > g ? (r > b ? r : b) : (g > b ? g : b));
  }
  return o;
}

// move each percentile 'pull' of the way to the reference, never lifting by more than lift[i] x
function adaptTargets(inP, tgt, pull, lift) {
  var out = [], i;
  for (i = 0; i < inP.length; i++) {
    var a = inP[i], t = tgt[i], v = a + pull * (t - a);
    if (v > a) v = Math.min(v, Math.max(a, 0.02) * lift[i]);
    else if (i === 1 || i === 2) v = a;
    else v = Math.max(v, a * 0.92);
    out.push(v);
  }
  for (i = 1; i < out.length; i++) out[i] = Math.max(out[i], out[i - 1] + 0.02);
  for (i = 0; i < out.length; i++) out[i] = Math.min(out[i], 0.995);
  return out;
}

// (the stage helpers below keep every pixel loop in a small kernel of its own, for the same V8
// reason as the grade_subject kernels further down)
function kSmoothAdd(src, e0, e1, add) { var n = src.length, o = newF(n); for (var i = 0; i < n; i++) o[i] = smooth(e0, e1, src[i]) + add; return o; }
function kLocalSd(mu, m2) { var n = mu.length, o = newF(n); for (var i = 0; i < n; i++) { var v = m2[i] - mu[i] * mu[i]; o[i] = Math.sqrt(v > 0 ? v : 0); } return o; }
function kDefringeBias(f_, mu, m2) {
  var F0 = f_[0], F1 = f_[1], F2 = f_[2];
  for (var i = 0; i < mu.length; i++) {
    var sd = m2[i] - mu[i] * mu[i]; sd = Math.sqrt(sd > 0 ? sd : 0);
    var lf = 0.2126 * F0[i] + 0.7152 * F1[i] + 0.0722 * F2[i];
    var k = Math.max(lf - 0.6 * sd, 0.5 * lf) / Math.max(lf, 1e-4);
    F0[i] *= k; F1[i] *= k; F2[i] *= k;
  }
}
function kDefringeMix(rgb, fill, fill2, cov, cov2, a, out, aOut) {
  var e02 = F32(0.06), e90 = F32(0.90);
  for (var i = 0; i < a.length; i++) {
    var src = cov[i] > 0.02 ? fill : (cov2[i] > 0.02 ? fill2 : rgb);
    var wv = 1 - smooth(0.45, 0.97, a[i]);
    out[0][i] = rgb[0][i] * (1 - wv) + src[0][i] * wv;
    out[1][i] = rgb[1][i] * (1 - wv) + src[1][i] * wv;
    out[2][i] = rgb[2][i] * (1 - wv) + src[2][i] * wv;
    var av = F32(F32(a[i] - e02) / e90);
    aOut[i] = av < 0 ? 0 : av > 1 ? 1 : av;
  }
}
// the soft edge band's colour -> the (darker-biased) masked mean of the solid interior; choke
function defringe(rgb, a, w, h, px) {
  var n = w * h, inner = kSmoothMap(a, 0.80, 0.98);
  var r = Math.max(2, roundHE(2.5 * px)), r3 = 3 * r;
  var fill = [mbox(rgb[0], inner, w, h, r), mbox(rgb[1], inner, w, h, r), mbox(rgb[2], inner, w, h, r)];
  var fill2 = [mbox(rgb[0], inner, w, h, r3), mbox(rgb[1], inner, w, h, r3), mbox(rgb[2], inner, w, h, r3)];
  var Ls = lumaMap(rgb), Ls2 = mulF(Ls, Ls);
  kDefringeBias(fill, mbox(Ls, inner, w, h, r), mbox(Ls2, inner, w, h, r));
  kDefringeBias(fill2, mbox(Ls, inner, w, h, r3), mbox(Ls2, inner, w, h, r3));
  var out = [newF(n), newF(n), newF(n)], aOut = newF(n);
  kDefringeMix(rgb, fill, fill2, denOf(inner, w, h, r, true), denOf(inner, w, h, r3, true), a, out, aOut);
  return { rgb: out, a: aOut };
}

function kEdgeClampMasks(inner, a, band, deep) {
  for (var i = 0; i < a.length; i++) {
    band[i] = (1 - smooth(0.55, 0.97, inner[i])) * (a[i] > 0.004 ? 1 : 0);
    deep[i] = smooth(0.97, 0.995, inner[i]);
  }
}
function kEdgeClampApply(out, L, ref, band, dark, res) {
  for (var i = 0; i < L.length; i++) {
    var cap = ref[i] * 0.96, Ln = L[i] > cap ? L[i] + (cap - L[i]) * band[i] : L[i];
    Ln = Ln * (1 - dark * band[i]);
    var ratio = Ln / Math.max(L[i], 1e-4), v;
    v = out[0][i] * ratio; res[0][i] = v < 0 ? 0 : v > 1 ? 1 : v;
    v = out[1][i] * ratio; res[1][i] = v < 0 ? 0 : v > 1 ? 1 : v;
    v = out[2][i] * ratio; res[2][i] = v < 0 ? 0 : v > 1 ? 1 : v;
  }
}
// LAST step: nothing in a ~2.5 px band inside the silhouette brighter than the interior + dark rim
function edgeClamp(out, a, w, h, px, dark) {
  var n = w * h, inner = gblur(kAbove01(a, 0.5), w, h, 1.4 * px), band = newF(n), deep = newF(n);
  kEdgeClampMasks(inner, a, band, deep);
  var L = lumaMap(out), res = [newF(n), newF(n), newF(n)];
  kEdgeClampApply(out, L, mblur(L, deep, w, h, 3 * px), band, dark, res);
  return res;
}

function kEdgeMatchMasks(inner, a, band, deep, bandE, deepE) {
  for (var i = 0; i < a.length; i++) {
    band[i] = (1 - smooth(0.70, 0.985, inner[i])) * smooth(0.02, 0.30, a[i]);
    deep[i] = smooth(0.985, 0.998, inner[i]) * (a[i] > 0.5 ? 1 : 0);
    bandE[i] = band[i] + 1e-5; deepE[i] = deep[i] + 1e-5;
  }
}
function kChromaMag(out, Lo) {
  var n = Lo.length, o = newF(n);
  for (var i = 0; i < n; i++) { var c0 = out[0][i] - Lo[i], c1 = out[1][i] - Lo[i], c2 = out[2][i] - Lo[i]; o[i] = Math.sqrt(c0 * c0 + c1 * c1 + c2 * c2); }
  return o;
}
function kEdgeMatchApply(out, Lo, Lb, Li, mb, mi, band, cov, strength, L2, C) {
  for (var i = 0; i < Lo.length; i++) {
    var wv = band[i] * smooth(0.02, 0.10, cov[i]) * strength;
    var k = clamp(Li[i] / Math.max(Lb[i], 1e-3), 0.55, 1.0);
    k = 1 + (k - 1) * wv;
    var sb = mb[i] / Math.max(Lb[i], 0.02), si = mi[i] / Math.max(Li[i], 0.02);
    var kc = clamp(si / Math.max(sb, 1e-4), 1.0, 1.6);
    kc = 1 + (kc - 1) * wv;
    var kk = k * kc;
    L2[i] = Lo[i] * k;
    C[0][i] = (out[0][i] - Lo[i]) * kk; C[1][i] = (out[1][i] - Lo[i]) * kk; C[2][i] = (out[2][i] - Lo[i]) * kk;
  }
}
// the ~0-7 ref px band inside the silhouette, exposure- and chroma-matched to the interior
function edgeMatch(out, a, w, h, px, width, depth, strength) {
  width = width == null ? 2 : width; depth = depth == null ? 4 : depth; strength = strength == null ? 1 : strength;
  if (strength <= 0) return out;
  var n = w * h, inner = gblur(kAbove01(a, 0.5), w, h, width * px), band = newF(n), deep = newF(n), bandE = newF(n), deepE = newF(n);
  kEdgeMatchMasks(inner, a, band, deep, bandE, deepE);
  var Lo = lumaMap(out), Lb = mblur(Lo, bandE, w, h, 1.5 * px), Li = mblur(Lo, deepE, w, h, depth * px);
  var cov = gblur(deep, w, h, depth * px), mag = kChromaMag(out, Lo);
  var mb = mblur(mag, bandE, w, h, 1.5 * px), mi = mblur(mag, deepE, w, h, depth * px), L2 = newF(n), C = [newF(n), newF(n), newF(n)];
  kEdgeMatchApply(out, Lo, Lb, Li, mb, mi, band, cov, strength, L2, C);
  return gamutPlanes(L2, C);
}

// tame_rim's three caps, one kernel each (a pixel follows its local mean Lm down to the cap)
function kCapToRef(Lx, Lm, ref, add, wt) {
  var n = Lx.length, o = newF(n);
  for (var j = 0; j < n; j++) { var k = Math.min(1, Math.min(Lm[j], ref[j] * 1.03 + add) / Math.max(Lm[j], 1e-4)); o[j] = Lx[j] * (1 + (k - 1) * wt[j]); }
  return o;
}
function kCapCeil(Lx, Lm, ceil, slope, wt) {
  var n = Lx.length, o = newF(n);
  for (var j = 0; j < n; j++) {
    var lm = Lm[j], tg = lm > ceil ? ceil + (lm - ceil) * slope : lm, k = Math.min(1, tg / Math.max(lm, 1e-4));
    o[j] = Lx[j] * (1 + (k - 1) * wt[j]);
  }
  return o;
}
function kRimBand1(wide, a, solid, strength, wt1, inner) {
  for (var i = 0; i < a.length; i++) {
    wt1[i] = F32((1 - smooth(0.72, 0.985, wide[i])) * smooth(0.3, 0.8, a[i])) * strength * 0.85;
    inner[i] = solid[i] * smooth(0.90, 0.99, wide[i]) + 1e-4;
  }
}
function kRimBand2(wide2, a, solid, band2, ring, ringE) {
  for (var i = 0; i < a.length; i++) {
    band2[i] = (1 - smooth(0.80, 0.90, wide2[i])) * smooth(0.3, 0.8, a[i]);
    ring[i] = solid[i] * smooth(0.90, 0.93, wide2[i]) * (1 - smooth(0.975, 0.99, wide2[i]));
    ringE[i] = ring[i] + 1e-4;
  }
}
function kRimW2(band2, cov2, strength) { var n = band2.length, o = newF(n); for (var i = 0; i < n; i++) o[i] = band2[i] * strength * 0.85 * smooth(0.02, 0.10, cov2[i]); return o; }
function kRimZone(gz, a, strength) { var n = a.length, o = newF(n); for (var i = 0; i < n; i++) o[i] = (1 - smooth(0.80, 0.97, gz[i])) * (a[i] > 0.02 ? 1 : 0) * strength; return o; }
// studio / arena KICKER along the silhouette: wide bands capped against the interior (local mean)
function tameRim(Lf, a, w, h, px, strength, ceil, zoneR, slope, zoneBlur) {
  if (strength == null) strength = 1;
  if (zoneR == null) zoneR = 5;
  if (slope == null) slope = 0.25;
  if (strength <= 0) return Lf;
  var n = w * h, solid = kAbove01(a, 0.5), mw = kSmoothAdd(a, 0.30, 0.90, 1e-4);
  var wide = gblur(solid, w, h, 4.2 * px), wt1 = newF(n), inner = newF(n);
  kRimBand1(wide, a, solid, strength, wt1, inner);
  var ref = mblur(Lf, inner, w, h, 7 * px);
  Lf = kCapToRef(Lf, mblur(Lf, mw, w, h, 1.5 * px), ref, 0.01, wt1);
  var wide2 = gblur(solid, w, h, 8 * px), band2 = newF(n), ring = newF(n), ringE = newF(n);
  kRimBand2(wide2, a, solid, band2, ring, ringE);
  var ref2 = mblur(Lf, ringE, w, h, 6 * px), wt2 = kRimW2(band2, gblur(ring, w, h, 6 * px), strength);
  Lf = kCapToRef(Lf, mblur(Lf, mw, w, h, 1.5 * px), ref2, 0.005, wt2);
  if (ceil != null) {
    var zone = kRimZone(zoneBlur || gblur(solid, w, h, zoneR * px), a, strength);
    Lf = kCapCeil(Lf, mblur(Lf, mw, w, h, 1.5 * px), ceil, slope, zone);
  }
  return Lf;
}

function kRelSd(mu, m2) { var n = mu.length, o = newF(n); for (var i = 0; i < n; i++) { var v = m2[i] - mu[i] * mu[i]; o[i] = Math.sqrt(v > 0 ? v : 0) / Math.max(mu[i], 0.04); } return o; }
function kHairW(rel, mb6, m, fm) {
  var n = rel.length, o = newF(n);
  for (var i = 0; i < n; i++) o[i] = smooth(0.10, 0.22, rel[i]) * (1 - smooth(0.55 * fm, 0.95 * fm, mb6[i])) * clamp(m[i], 0, 1);
  return o;
}
// hair / beard: TEXTURED and DARK relative to the face
function hairWeight(Ys, m, w, h, px, faceMed) {
  var rel = mblur(kRelSd(mblur(Ys, m, w, h, 1.5 * px), mblur(mulF(Ys, Ys), m, w, h, 1.5 * px)), m, w, h, 4 * px);
  return kHairW(rel, mblur(Ys, m, w, h, 6 * px), m, faceMed);
}
function kHairTone(Lf, Lm, wgt, pos, meanK) {
  var n = Lf.length, o = newF(n);
  for (var i = 0; i < n; i++) {
    var d = Lf[i] - Lm[i], Ln = (Lm[i] + (d > 0 ? d * pos : d)) * meanK;
    if (Ln < 0) Ln = 0;
    o[i] = Lf[i] + (Ln - Lf[i]) * wgt[i];
  }
  return o;
}
function hairTone(Lf, wgt, m, w, h, px, pos, meanK) {
  if (!wgt || maxOf(wgt) <= 0) return Lf;
  return kHairTone(Lf, mblur(Lf, m, w, h, 3 * px), wgt, pos, meanK);
}
function kSmoothW(mu, m2, knee) {
  var n = mu.length, o = newF(n);
  for (var i = 0; i < n; i++) { var v = m2[i] - mu[i] * mu[i], sd = Math.sqrt(v > 0 ? v : 0); o[i] = (1 - smooth(0.035, 0.08, sd)) * smooth(knee - 0.04, knee + 0.06, mu[i]); }
  return o;
}
function kSmoothHl(Lf, mu, wv, knee, slope, strength) {
  var n = Lf.length, o = newF(n);
  for (var i = 0; i < n; i++) {
    var tg = mu[i] > knee ? knee + (mu[i] - knee) * slope : mu[i], k = tg / Math.max(mu[i], 1e-4);
    o[i] = Lf[i] * (1 + (k - 1) * wv[i] * strength);
  }
  return o;
}
// B&W: a large SMOOTH bright plane is compressed above the knee (texture kept)
function smoothHighlights(Lf, m, w, h, px, knee, slope, strength) {
  if (knee == null) knee = 0.74;
  if (slope == null) slope = 0.55;
  if (strength == null) strength = 1;
  if (strength <= 0) return Lf;
  var mu = mblur(Lf, m, w, h, 3 * px), m2 = mblur(mulF(Lf, Lf), m, w, h, 3 * px);
  return kSmoothHl(Lf, mu, gblur(kSmoothW(mu, m2, knee), w, h, 2 * px), knee, slope, strength);
}
function kSpikes(Lf, mloc, m) { var n = Lf.length, o = newF(n); for (var i = 0; i < n; i++) o[i] = smooth(0.06, 0.16, Lf[i] - mloc[i]) * m[i]; return o; }
function kDesalt(Lf, mloc, dens, strength) {
  var n = Lf.length, o = newF(n);
  for (var i = 0; i < n; i++) {
    if (Lf[i] > mloc[i]) {
      var dark = smooth(0.08, 0.20, dens[i]) * strength, allow = 0.03 + 0.35 * mloc[i];
      var ex = Lf[i] - mloc[i], capd = mloc[i] + allow * tanhF(ex / allow);
      o[i] = Lf[i] + (capd - Lf[i]) * dark;
    } else o[i] = Lf[i];
  }
  return o;
}
// white SALT in dark hair / beard: bright spikes knee-limited where they are dense
function desalt(Lf, m, w, h, px, strength) {
  if (strength == null) strength = 1;
  if (strength <= 0) return Lf;
  var mloc = mblur(Lf, m, w, h, 2 * px);
  return kDesalt(Lf, mloc, mblur(kSpikes(Lf, mloc, m), m, w, h, 5 * px), strength);
}
function kFlatSel(F, sd, Y, thr) { var n = F.length, o = new Uint8Array(n); for (var i = 0; i < n; i++) o[i] = F[i] && sd[i] <= thr && Y[i] > 0.06 ? 1 : 0; return o; }
// the FLAT part of the face (low local contrast in the source)
function flatSkin(Y, a, F, w, h, px) {
  var m = kAbove01(a, 0.95), r = Math.max(2, roundHE(3 * px));
  var sd = kLocalSd(mbox(Y, m, w, h, r), mbox(mulF(Y, Y), m, w, h, r));
  if (countOf(F) < 100) return F;
  return kFlatSel(F, sd, Y, pctMasked(sd, F, [50])[0]);
}
function kTexNorm(o, sd, bias) { for (var i = 0; i < o.length; i++) { var v = F32(o[i] / sd); o[i] = v > 0 ? v * bias : v; } }
function kAddConst(o, c) { for (var i = 0; i < o.length; i++) o[i] = o[i] + c; }
// synthetic PORE texture: noise band-passed between a 3x3 box and a ~1.5 ref px Gaussian
function textureField(h, w, px, seed, bias) {
  if (bias == null) bias = 0.42;
  var nz = noise(h, w, seed);
  var o = kSub(box(nz, w, h, Math.max(1, roundHE(0.6 * px))), gblur(nz, w, h, 1.5 * px));
  kTexNorm(o, Math.max(meanStd(o)[1], 1e-6), bias);
  kAddConst(o, -meanStd(o)[0]);
  return o;
}
function crackleBand(Lf, m, w, h, px, off) {
  if (off == null) off = 0.03;
  var lg = kLog2Map(Lf, off);
  return { lg: lg, d: kSub(lg, mblur(lg, m, w, h, 1.1 * px)) };
}
function kSkinZone(nb, Lf, m, fmed) {
  var n = Lf.length, o = newF(n);
  for (var i = 0; i < n; i++) o[i] = smooth(0.45 * fmed, 0.75 * fmed, nb[i]) * (1 - smooth(0.90, 0.99, Lf[i])) * m[i];
  return o;
}
function skinZone(Lf, m, w, h, px, fmed) { return kSkinZone(mblur(Lf, m, w, h, 3 * px), Lf, m, fmed); }
// ref 14's skin: the fine band re-added with a DARK bias, cored and tanh-limited
function crackle(lg, d, k, wz, off, pos, core, lim) {
  if (off == null) off = 0.03;
  if (pos == null) pos = 0.50;
  if (core == null) core = 0.012;
  if (lim == null) lim = 0.45;
  var n = lg.length, o = newF(n), i, c2 = core * core;
  if (k <= 0) { for (i = 0; i < n; i++) o[i] = exp2F(lg[i]) - off; return o; }
  for (i = 0; i < n; i++) {
    var dv = d[i], dc = dv * (dv * dv / (dv * dv + c2)), add = dc < 0 ? dc * k : dc * k * pos;
    add = lim * tanhF(add / lim);
    if (wz) add = add * wz[i];
    o[i] = exp2F(lg[i] + add) - off;
  }
  return o;
}
function skinTexture(Lf, amp, tex, wz) {
  if (amp <= 0) return Lf;
  var o = newF(Lf.length);
  for (var i = 0; i < Lf.length; i++) o[i] = Lf[i] * exp2F(amp * tex[i] * wz[i]);
  return o;
}
// C: exposure metered on the FACE; a brighter studio torso is scaled down below the chin
function kRowScale(Lf, w, h, k, y0, y1) {
  var o = newF(Lf.length), x = 0, y = 0, g = 1 - (1 - k) * smooth(y0, y1, 0);
  for (var i = 0; i < Lf.length; i++) {
    o[i] = Lf[i] * g;
    if (++x === w) { x = 0; y++; g = 1 - (1 - k) * smooth(y0, y1, y); }
  }
  return o;
}
function capTorso(Lf, a, face, w, h, px, margin) {
  if (margin == null) margin = 0.03;
  var fx = face[0], fy = face[1], fw = face[2], fh = face[3];
  var Fm = kAndAbove(ellipseMask(w, h, fx + fw / 2, fy + fh / 2, fw * 0.40, fh * 0.44), a, 0.95);
  var tor = kRowsAbove(a, w, h, Math.floor(Math.min(h, fy + fh * 1.05)), h, 0.95);
  if (countOf(Fm) < 100 || countOf(tor) < 500) return Lf;
  var fp = pctMasked(Lf, Fm, [50, 90]), tp = pctMasked(Lf, tor, [50, 90]);
  var k = Math.min(1, (fp[0] - margin) / Math.max(tp[0], 1e-3), fp[1] / Math.max(tp[1], 1e-3));
  if (k >= 0.999) return Lf;
  return kRowScale(Lf, w, h, k, fy + fh * 0.95, fy + fh * 1.35);
}
function kRidgeZone(w, h, cw, fy, fh, rows) {
  var z = newF(w * h), x = 0, y = 0;
  var rw = smooth(fy + fh * rows[0], fy + fh * (rows[0] + 0.10), 0) * (1 - smooth(fy + fh * (rows[1] - 0.2), fy + fh * rows[1], 0));
  for (var i = 0; i < z.length; i++) {
    z[i] = rw * cw[x];
    if (++x === w) { x = 0; y++; rw = smooth(fy + fh * rows[0], fy + fh * (rows[0] + 0.10), y) * (1 - smooth(fy + fh * (rows[1] - 0.2), fy + fh * rows[1], y)); }
  }
  return z;
}
function kRidgeBase(rw_, Lf, Lm1, t) { var n = Lf.length, o = newF(n); for (var i = 0; i < n; i++) o[i] = rw_[i] * (Lf[i] <= Lm1[i] + t ? 1 : 0) + 1e-4; return o; }
function kRidgeCap(Lf, Lm, zone, m, t, k) {
  var n = Lf.length, o = newF(n);
  for (var i = 0; i < n; i++) {
    var ex = Lf[i] - Lm[i] - t, capd = ex > 0 ? Lm[i] + t + ex * k : Lf[i];
    o[i] = Lf[i] + (capd - Lf[i]) * zone[i] * clamp(m[i], 0, 1);
  }
  return o;
}
// a studio KICKER ridge inside the skin, capped against its NON-ridge neighbours
function tameRidges(Lf, m, face, w, h, px, o) {
  o = o || {};
  var sigma = o.sigma == null ? 10 : o.sigma, t = o.t == null ? 0.05 : o.t, k = o.k == null ? 0.25 : o.k;
  var rows = o.rows || [0.84, 1.45], halfW = o.halfW == null ? 0.62 : o.halfW, zone = o.zone || null, refW = o.refW || null;
  if (!zone) {
    var fx = face[0], fy = face[1], fw = face[2], fh = face[3], cw = newF(w);
    for (var x = 0; x < w; x++) cw[x] = 1 - smooth(fw * (halfW - 0.12), fw * halfW, Math.abs(x - (fx + fw / 2)));
    zone = kRidgeZone(w, h, cw, fy, fh, rows);
  }
  if (maxOf(zone) <= 0) return Lf;
  var rw_ = refW || m, Lm1 = mblur(Lf, rw_, w, h, sigma * px);
  var Lm = mblur(Lf, kRidgeBase(rw_, Lf, Lm1, t), w, h, sigma * px);
  return kRidgeCap(Lf, Lm, zone, m, t, k);
}

// ---------- selective colour (pop) ----------
function popMemberPx(h, s, v, bg, loose) {
  var red, other;
  if (loose) {
    red = smooth(20, 11, hueDist(h, 347)) * smooth(1.02, 1.18, bg);
    other = smooth(62, 75, h) * smooth(170, 158, h) + smooth(283, 295, h) * smooth(338, 328, h);
    return Math.max(red, other) * smooth(0.22, 0.40, s) * smooth(0.05, 0.12, v);
  }
  red = smooth(12, 6, hueDist(h, 349)) * smooth(1.05, 1.30, bg);
  other = smooth(68, 78, h) * smooth(165, 155, h) + smooth(285, 295, h) * smooth(335, 325, h);
  return Math.max(red, other) * smooth(0.50, 0.66, s) * smooth(0.18, 0.30, v);
}
function crossGuided(I, p, w, h, r, eps) {
  var n = w * h, i, Ip = mulF(I, p), II = mulF(I, I);
  var mI = box(I, w, h, r), mp = box(p, w, h, r), bIp = box(Ip, w, h, r), bII = box(II, w, h, r), aa = newF(n), bb = newF(n);
  for (i = 0; i < n; i++) {
    var cv = bIp[i] - mI[i] * mp[i], vr = bII[i] - mI[i] * mI[i];
    aa[i] = cv / (vr + eps); bb[i] = mp[i] - aa[i] * mI[i];
  }
  var A = box(aa, w, h, r), B = box(bb, w, h, r), o = newF(n);
  for (i = 0; i < n; i++) o[i] = A[i] * I[i] + B[i];
  return o;
}
// selective-colour mask that FOLLOWS THE GARMENT (coverage, loose membership, hole fill, snap)
function popMask(rgb, m, w, h, hs) {
  hs = hs || hueSat(rgb);
  var n = w * h, i, strict = newF(n), loose = newF(n);
  for (i = 0; i < n; i++) {
    var r = rgb[0][i], g = rgb[1][i], b = rgb[2][i], v = r > g ? (r > b ? r : b) : (g > b ? g : b), bg = b / Math.max(g, 1e-3);
    strict[i] = popMemberPx(hs.h[i], hs.s[i], v, bg, false) * m[i];
    loose[i] = popMemberPx(hs.h[i], hs.s[i], v, bg, true) * m[i];
  }
  var R = Math.max(4, Math.floor(0.03 * Math.max(h, w)));
  var cov = box(strict, w, h, R), region = newF(n);
  for (i = 0; i < n; i++) region[i] = cov[i] > 0.35 ? 1 : 0;
  var rb = box(region, w, h, R), raw = newF(n);
  for (i = 0; i < n; i++) { region[i] = rb[i] > 0.02 ? 1 : 0; raw[i] = region[i] * loose[i]; }
  var gr = gblur(raw, w, h, 2.0), filled = newF(n), guide = newF(n);
  for (i = 0; i < n; i++) {
    var mx = Math.max(rgb[0][i], rgb[1][i], rgb[2][i]);
    filled[i] = Math.max(raw[i], region[i] * (gr[i] > 0.6 ? 1 : 0) * smooth(0.05, 0.25, mx));
    guide[i] = clamp(rgb[0][i] - Math.max(rgb[1][i], rgb[2][i]) * 0.8, 0, 1) + 0.5 * raw[i];
  }
  var out = crossGuided(guide, filled, w, h, 2, 1e-3);
  for (i = 0; i < n; i++) out[i] = clamp(out[i], 0, 1) * region[i] * m[i];
  return out;
}
// keep the kit in colour on the B&W body, re-hued into the theme if its hue is far from it
function popColour(out, rgb, Lf, a, w, h, px, theme, faceMask, hs) {
  hs = hs || hueSat(rgb);
  var n = w * h, i, mm = newF(n);
  for (i = 0; i < n; i++) mm[i] = smooth(0.35, 0.90, a[i]);
  var pm = popMask(rgb, mm, w, h, hs);
  for (i = 0; i < n; i++) {
    if (faceMask) pm[i] = pm[i] * (1 - faceMask[i]);
    pm[i] = pm[i] * (a[i] > 0.5 ? 1 : 0);
  }
  var Ls = lumaMap(rgb), Lk = newF(n), C = [newF(n), newF(n), newF(n)];
  for (i = 0; i < n; i++) {
    Lk[i] = Math.min(Lf[i], Ls[i] * 1.15 + 0.02);
    var s = clamp(Lk[i] / Math.max(Ls[i], 0.03), 0, 3) * 1.08;
    for (var c = 0; c < 3; c++) C[c][i] = (rgb[c][i] - Ls[i]) * s;
  }
  if (theme) {
    var th = themeOf(theme), sx = 0, sy = 0, kn = 0;
    for (i = 0; i < n; i++) if (pm[i] > 0.5) {
      var hh = hs.h[i] * Math.PI / 180;
      sx += Math.sin(hh); sy += Math.cos(hh); kn++;
    }
    if (kn > 50) {
      var kh = Math.atan2(sx / kn, sy / kn) * 180 / Math.PI;
      kh = ((kh % 360) + 360) % 360;
      if (hueDist(kh, th.hue) > 55) {
        var tc = hex01(th.pop), tl = F32(lumaOf(tc)), tcC = [tc[0] - tl, tc[1] - tl, tc[2] - tl];
        var tn = Math.max(Math.sqrt(tcC[0] * tcC[0] + tcC[1] * tcC[1] + tcC[2] * tcC[2]), 1e-4);
        for (i = 0; i < n; i++) {
          var mg = Math.sqrt(C[0][i] * C[0][i] + C[1][i] * C[1][i] + C[2][i] * C[2][i]) * 1.1 / tn;
          C[0][i] = tcC[0] * mg; C[1][i] = tcC[1] * mg; C[2][i] = tcC[2] * mg;
        }
      }
    }
  }
  var res = [newF(n), newF(n), newF(n)];
  for (i = 0; i < n; i++) {
    var mag = Math.sqrt(C[0][i] * C[0][i] + C[1][i] * C[1][i] + C[2][i] * C[2][i]);
    var sc = (0.34 * tanhF(mag / 0.34)) / Math.max(mag, 1e-5);
    var q = gamutPx(Lk[i], C[0][i] * sc, C[1][i] * sc, C[2][i] * sc), p = pm[i];
    res[0][i] = out[0][i] * (1 - p) + q[0] * p; res[1][i] = out[1][i] * (1 - p) + q[1] * p; res[2][i] = out[2][i] * (1 - p) + q[2] * p;
  }
  return { rgb: res, pm: pm };
}

// ---------- UFC studio kicker stripes inside the skin (D) ----------
// where a kicker may sit: the sides of the face box (temples, cheek edges) and the NECK block
function kickerZone(w, h, face, o) {
  o = o || {};
  var side = o.side || [0.40, 0.04, 0.52], rows = o.rows || [-0.05, 0.60], neck = o.neck || [0.88, 1.15];
  var neckCols = o.neckCols || [-0.05, 0.55], parts = o.parts || ["side", "neck"];
  var fx = face[0], fy = face[1], fw = face[2], fh = face[3], cx = fx + fw / 2, rw = 0.04 * fh;
  var doSide = parts.indexOf("side") >= 0, doNeck = parts.indexOf("neck") >= 0;
  var z = newF(w * h), tc = newF(w), nc = newF(w), x, y;
  for (x = 0; x < w; x++) {
    var ax = Math.abs(x - cx);
    tc[x] = smooth((side[0] - side[1]) * fw, side[0] * fw, ax) * (1 - smooth(side[2] * fw, (side[2] + side[1]) * fw, ax));
    nc[x] = smooth(cx + neckCols[0] * fw - 0.04 * fw, cx + neckCols[0] * fw, x) * (1 - smooth(cx + neckCols[1] * fw, cx + neckCols[1] * fw + 0.04 * fw, x));
  }
  for (y = 0; y < h; y++) {
    var tr = smooth(fy + rows[0] * fh - rw, fy + rows[0] * fh, y) * (1 - smooth(fy + rows[1] * fh, fy + rows[1] * fh + rw, y));
    var nr = smooth(fy + neck[0] * fh - rw, fy + neck[0] * fh, y) * (1 - smooth(fy + neck[1] * fh, fy + neck[1] * fh + rw, y));
    for (x = 0; x < w; x++) {
      var v = 0;
      if (doSide) v = Math.max(v, tr * tc[x]);
      if (doNeck) v = Math.max(v, nr * nc[x]);
      z[y * w + x] = v;
    }
  }
  return z;
}
// BEFORE the grade: a pale bright stripe inside the zone takes the skin's colour ratio, capped level
function healKicker(rgb, a, zone, w, h, px, o) {
  o = o || {};
  var ref = o.ref == null ? 7 : o.ref, mean = o.mean == null ? 1.3 : o.mean, keep = o.keep == null ? 1.03 : o.keep;
  var paleLo = o.paleLo == null ? 0.10 : o.paleLo, paleHi = o.paleHi == null ? 0.32 : o.paleHi, grow = o.grow == null ? 1.4 : o.grow;
  var ys0 = h, ys1 = -1, xs0 = w, xs1 = -1, x, y, i;
  for (y = 0; y < h; y++) for (x = 0; x < w; x++) if (zone[y * w + x] > 0) {
    if (y < ys0) ys0 = y; if (y > ys1) ys1 = y; if (x < xs0) xs0 = x; if (x > xs1) xs1 = x;
  }
  if (ys1 < 0) return rgb;
  var mg = Math.floor(ref * px * 3) + 4;
  var y0 = Math.max(0, ys0 - mg), y1 = Math.min(h, ys1 + mg + 1), x0 = Math.max(0, xs0 - mg), x1 = Math.min(w, xs1 + mg + 1);
  var cw = x1 - x0, ch = y1 - y0, n = cw * ch;
  var c = [cropF(rgb[0], w, x0, y0, x1, y1), cropF(rgb[1], w, x0, y0, x1, y1), cropF(rgb[2], w, x0, y0, x1, y1)];
  var ac = cropF(a, w, x0, y0, x1, y1), zc = cropF(zone, w, x0, y0, x1, y1);
  var L = lumaMap(c), sat = satMap(c), skin = newF(n), mw = newF(n), ratio = [newF(n), newF(n), newF(n)];
  for (i = 0; i < n; i++) {
    skin[i] = skinWeightPx(c[0][i], c[1][i], c[2][i]) * smooth(0.24, 0.32, sat[i]) * (ac[i] > 0.9 ? 1 : 0);
    mw[i] = smooth(0.3, 0.9, ac[i]) + 1e-4;
    var lm = Math.max(L[i], 1e-3);
    ratio[0][i] = c[0][i] / lm; ratio[1][i] = c[1][i] / lm; ratio[2][i] = c[2][i] / lm;
  }
  var sr = ref * px, cov = gblur(skin, cw, ch, sr), Lref = mblur(L, skin, cw, ch, sr), sref = mblur(sat, skin, cw, ch, sr);
  var rref = mblurN(ratio, skin, cw, ch, sr), Lm = mblur(L, mw, cw, ch, mean * px), sm = mblur(sat, mw, cw, ch, mean * px);
  var wv = newF(n);
  for (i = 0; i < n; i++) {
    var pale = smooth(paleLo, paleHi, 1 - sm[i] / Math.max(sref[i], 0.05));
    var bright = smooth(-0.15, -0.04, Lm[i] - Lref[i]);
    wv[i] = zc[i] * pale * bright * smooth(0.02, 0.10, cov[i]) * (ac[i] > 0.5 ? 1 : 0);
  }
  var wg = gblur(wv, cw, ch, 1.0 * px), out = [copyF(rgb[0]), copyF(rgb[1]), copyF(rgb[2])];
  for (y = 0; y < ch; y++) for (x = 0; x < cw; x++) {
    i = y * cw + x;
    var ww = clamp(wg[i] * grow, 0, 1), k = Math.min(1, (Lref[i] * keep + 0.01) / Math.max(Lm[i], 1e-4));
    var Ln = L[i] * (1 + (k - 1) * ww), j = (y0 + y) * w + x0 + x;
    for (var q = 0; q < 3; q++) out[q][j] = clamp((ratio[q][i] + (rref[q][i] - ratio[q][i]) * ww) * Ln, 0, 1);
  }
  return out;
}
// AFTER the grade: tameRidges on the local-mean luminance inside the zone (skin reference only).
// It works on the zone's bounding box plus a margin that covers every blur it takes (~4 sigma);
// outside that box the pixels come back unchanged (look.py's full-frame version also leaves them
// as they are, except that it rescales near-black pixels, L under .001, by a hair).
function tameKickerRgb(img, zone, px, o) {
  o = o || {};
  var sigma = o.sigma == null ? 6 : o.sigma, t = o.t == null ? 0.02 : o.t, k = o.k == null ? 0.15 : o.k, fl = o.floor || [0.25, 0.35];
  var W = img.w, H = img.h, x, y, i, j, zx0 = W, zx1 = -1, zy0 = H, zy1 = -1;
  var res = { w: W, h: H, data: new Float32Array(img.data) };
  for (y = 0; y < H; y++) for (x = 0; x < W; x++) if (zone[y * W + x] > 0) {
    if (x < zx0) zx0 = x; if (x > zx1) zx1 = x; if (y < zy0) zy0 = y; if (y > zy1) zy1 = y;
  }
  if (zx1 < 0) return res;
  var mg = Math.ceil(4 * sigma * px + 4 * 1.3 * px) + 8;
  var x0 = Math.max(0, zx0 - mg), x1 = Math.min(W, zx1 + mg + 1), y0 = Math.max(0, zy0 - mg), y1 = Math.min(H, zy1 + mg + 1);
  var w = x1 - x0, h = y1 - y0, n = w * h, sub = { w: w, h: h, data: new Float32Array(n * 4) };
  for (y = 0; y < h; y++) sub.data.set(img.data.subarray(((y0 + y) * W + x0) * 4, ((y0 + y) * W + x1) * 4), y * w * 4);
  var zc = cropF(zone, W, x0, y0, x1, y1), P = splitRGBA(sub), rgb = P.rgb, a = P.a;
  var m = newF(n), Lf = lumaMap(rgb), rw = newF(n), mE = newF(n);
  for (i = 0; i < n; i++) { m[i] = smooth(0.5, 0.95, a[i]); rw[i] = m[i] * smooth(fl[0], fl[1], Lf[i]); mE[i] = m[i] + 1e-4; }
  var gz = gblur(rw, w, h, sigma * px), z2 = newF(n);
  for (i = 0; i < n; i++) z2[i] = zc[i] * smooth(0.10, 0.30, gz[i]);
  var Lloc = mblur(Lf, mE, w, h, 1.3 * px);
  var Ll2 = tameRidges(Lloc, m, null, w, h, px, { sigma: sigma, t: t, k: k, zone: z2, refW: rw });
  var sat = satMap(rgb), sw = newF(n), swE = newF(n), ratio = [newF(n), newF(n), newF(n)];
  for (i = 0; i < n; i++) {
    sw[i] = rw[i] * smooth(0.20, 0.28, sat[i]); swE[i] = sw[i] + 1e-5;
    var lm = Math.max(Lf[i], 1e-3);
    ratio[0][i] = rgb[0][i] / lm; ratio[1][i] = rgb[1][i] / lm; ratio[2][i] = rgb[2][i] / lm;
  }
  var sref = mblur(sat, swE, w, h, sigma * px), satm = mblur(sat, mE, w, h, 1.3 * px);
  var rref = mblurN(ratio, swE, w, h, sigma * px), gsw = gblur(sw, w, h, sigma * px), out = res.data;
  for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
    i = y * w + x; j = ((y0 + y) * W + x0 + x) * 4;
    var Ln = Lf[i] * (Ll2[i] / Math.max(Lloc[i], 1e-4));
    var wc = z2[i] * smooth(0.10, 0.35, 1 - satm[i] / Math.max(sref[i], 0.05)) * smooth(0.02, 0.10, gsw[i]);
    for (var q = 0; q < 3; q++) out[j + q] = clamp((ratio[q][i] + (rref[q][i] - ratio[q][i]) * wc) * Ln, 0, 1);
  }
  return res;
}

// ---------- image <-> planes ----------
function splitRGBA(img) {
  var n = img.w * img.h, d = img.data, sc = (d instanceof Float32Array || d instanceof Float64Array) ? 1 : 1 / 255;
  var R = newF(n), G = newF(n), B = newF(n), A = newF(n), st = d.length === n * 3 ? 3 : 4;
  for (var i = 0; i < n; i++) {
    R[i] = d[i * st] * sc; G[i] = d[i * st + 1] * sc; B[i] = d[i * st + 2] * sc; A[i] = st === 4 ? d[i * 4 + 3] * sc : 1;
  }
  return { rgb: [R, G, B], a: A };
}
// premultiplied RGBA resize (no dark or light fringes): area average down, bilinear up
function resizeRGBA(img, w2, h2) {
  var P = splitRGBA(img), w = img.w, h = img.h, n = w * h, i, c, pm = [];
  for (c = 0; c < 3; c++) pm.push(mulF(P.rgb[c], P.a));
  var down = w2 <= w && h2 <= h;
  function rs(p) { return down ? resizeArea(p, w, h, w2, h2) : resizeLinear(p, w, h, w2, h2); }
  var A = rs(P.a), R = [rs(pm[0]), rs(pm[1]), rs(pm[2])];
  kUnpremul(R, A);
  return joinRGBA(R, A, w2, h2);
}
function kUnpremul(R, A) {
  for (var i = 0; i < A.length; i++) {
    var av = A[i] < 0 ? 0 : A[i] > 1 ? 1 : A[i], inv = av > 1e-4 ? 1 / av : 0;
    A[i] = av;
    for (var c = 0; c < 3; c++) { var v = R[c][i] * inv; R[c][i] = v < 0 ? 0 : v > 1 ? 1 : v; }
  }
}
function joinRGBA(rgb, a, w, h) {
  var n = w * h, o = new Float32Array(n * 4);
  for (var i = 0; i < n; i++) { o[i * 4] = rgb[0][i]; o[i * 4 + 1] = rgb[1][i]; o[i * 4 + 2] = rgb[2][i]; o[i * 4 + 3] = a ? a[i] : 1; }
  return { w: w, h: h, data: o };
}

// ---------- grade_subject kernels ----------
// Every pixel loop of the grade lives in one of these small functions: V8 optimises a small hot
// function at once, while a loop inside one huge function kept running boxed doubles in the
// interpreter until that whole function had been (re)compiled on the stack, loop after loop.
function kClampPlanes(c) { for (var k = 0; k < 3; k++) { var p = c[k]; for (var i = 0; i < p.length; i++) { var v = p[i]; p[i] = v < 0 ? 0 : v > 1 ? 1 : v; } } }
function kSmoothMap(src, e0, e1) { var n = src.length, o = newF(n); for (var i = 0; i < n; i++) o[i] = smooth(e0, e1, src[i]); return o; }
function kAndAbove(M, a, t) { for (var i = 0; i < M.length; i++) M[i] = M[i] && a[i] > t ? 1 : 0; return M; }
function kAbove(a, t) { var o = new Uint8Array(a.length); for (var i = 0; i < a.length; i++) o[i] = a[i] > t ? 1 : 0; return o; }
function kAbove01(a, t) { var o = newF(a.length); for (var i = 0; i < a.length; i++) o[i] = a[i] > t ? 1 : 0; return o; }
function kFirstRowAbove(a, W, t) { for (var i = 0; i < a.length; i++) if (a[i] > t) return Math.floor(i / W); return -1; }
function kRowsAbove(a, W, H, y0, y1, t) {
  var o = new Uint8Array(W * H);
  for (var i = Math.max(0, y0) * W, e = Math.min(H, y1) * W; i < e; i++) o[i] = a[i] > t ? 1 : 0;
  return o;
}
function kMonoY(rgb, m0, m1, m2) {
  var R = rgb[0], G = rgb[1], B = rgb[2], n = R.length, o = newF(n);
  for (var i = 0; i < n; i++) o[i] = R[i] * m0 + G[i] * m1 + B[i] * m2;
  return o;
}
function kLog2Map(Y, off) { var n = Y.length, o = newF(n); for (var i = 0; i < n; i++) o[i] = Math.log2((Y[i] > 0 ? Y[i] : 0) + off); return o; }
function kSub(a, b) { var n = a.length, o = newF(n); for (var i = 0; i < n; i++) o[i] = a[i] - b[i]; return o; }
function kCore(d0, core2) { for (var i = 0; i < d0.length; i++) { var v = d0[i]; d0[i] = v * (v * v / (v * v + core2)); } }
function kGuard(loc, gkk) { var n = loc.length, o = newF(n); for (var i = 0; i < n; i++) { var lv = Math.sqrt(loc[i] + 1e-8) / gkk; o[i] = 1 / (1 + lv * lv); } return o; }
function kBaseMaps(base, off, hl0, hl1, dk0, dk1, hw0, hw1) {
  var n = base.length, hl = newF(n), dkp = newF(n), hlwS = newF(n);
  for (var i = 0; i < n; i++) {
    var yb = F32(exp2F(base[i]) - off);
    hl[i] = smooth(hl0, hl1, yb); dkp[i] = 1 - smooth(dk0, dk1, yb); hlwS[i] = smooth(hw0, hw1, yb);
  }
  return { hl: hl, dkp: dkp, hlwS: hlwS };
}
function kEase(g, hlw, gE) { for (var i = 0; i < g.length; i++) g[i] = g[i] * (1 - gE * hlw[i]); }
function kTexUp(nn, nb, tk) { var n = nn.length, o = newF(n); for (var i = 0; i < n; i++) o[i] = (nn[i] - nb[i]) * tk; return o; }
function kBBox2(P, F, W) {
  var x0 = W, y0 = 1e9, x1 = -1, y1 = -1, x = 0, y = 0;
  for (var i = 0; i < P.length; i++) {
    if (P[i] || F[i]) { if (y < y0) y0 = y; y1 = y; if (x < x0) x0 = x; if (x > x1) x1 = x; }
    if (++x === W) { x = 0; y++; }
  }
  return [x0, y0, x1, y1];
}
// base compression + the four clipped band gains (+ the upscale micro texture), back to linear, on
// the crop x0..x1 x y0..y1. 'memo' keeps the running sum after bands 0 and 1: a pass whose c, g0
// and g1 equal the previous pass's reuses it (the same numbers added in the same order).
function kCompose(X, g, cc_, x0, y0, x1, y1, fine, memo) {
  var W = X.W, cw = x1 - x0, ch = y1 - y0, out = newF(cw * ch), gs = [g[0], g[1], g[2], 1 + X.formShare * (g[2] - 1)];
  if (!fine) { gs[0] = 1; gs[1] = 1; }
  var G0 = X.guard[0], G1 = X.guard[1], G2 = X.guard[2], G3 = X.guard[3], D0 = X.d[0], D1 = X.d[1], D2 = X.d[2], D3 = X.d[3];
  var K0 = X.K[0], K1 = X.K[1], K2 = X.K[2], K3 = X.K[3], base = X.base, hl = X.hl, dkp = X.dkp, tex = fine ? X.tex : null;
  var medB = X.medB, hp = X.hp, dkK = X.dkK, off = X.off, j, v, xv, gain, ap, p, hpl, dke, u, t, u2, fi, ff, q = 0;
  var BP0 = BAND_POS[0], BP1 = BAND_POS[1], BP2 = BAND_POS[2], BP3 = BAND_POS[3];
  var reuse = !!(memo && memo.sum && memo.c === cc_ && memo.g0 === gs[0] && memo.g1 === gs[1]);
  var keep = !!memo && !reuse;
  if (keep) { if (!memo.sum || memo.sum.length !== cw * ch) memo.sum = new Float64Array(cw * ch); memo.c = cc_; memo.g0 = gs[0]; memo.g1 = gs[1]; }
  var S01 = memo ? memo.sum : null, g0 = gs[0], g1 = gs[1], g2 = gs[2], g3 = gs[3];
  var nq = cw * ch, xx = 0, skip = W - cw;
  for (j = y0 * W + x0; q < nq; q++, j++) {
    if (xx === cw) { xx = 0; j += skip; }
    xx++;
    hpl = 1 - hp * hl[j];
    if (reuse) v = S01[q];
    else {
      v = (base[j] - medB) * cc_ + medB;
      dke = 1 - dkK * dkp[j];
      gain = g0 > 1 ? 1 + (g0 - 1) * G0[j] : g0; xv = D0[j] * gain;
      if (xv > 0) { p = BP0 * hpl; if (p < 0.12) p = 0.12; p = p * dke; if (p < 0.12) p = 0.12; ap = K0 * p; } else ap = K0;
      u = xv / ap; if (u > -0.25 && u < 0.25) { u2 = u * u; t = u * (1 + u2 * (-0.3333333333333333 + u2 * (0.13333333333333333 + u2 * -0.05396825396825397))); } else t = tanhF(u);
      v += ap * t;
      gain = g1 > 1 ? 1 + (g1 - 1) * G1[j] : g1; xv = D1[j] * gain;
      if (xv > 0) { p = BP1 * hpl; if (p < 0.12) p = 0.12; p = p * dke; if (p < 0.12) p = 0.12; ap = K1 * p; } else ap = K1;
      u = xv / ap; if (u > -0.25 && u < 0.25) { u2 = u * u; t = u * (1 + u2 * (-0.3333333333333333 + u2 * (0.13333333333333333 + u2 * -0.05396825396825397))); } else t = tanhF(u);
      v += ap * t;
      if (keep) S01[q] = v;
    }
    gain = g2 > 1 ? 1 + (g2 - 1) * G2[j] : g2; xv = D2[j] * gain;
    if (xv > 0) { p = BP2 * hpl; if (p < 0.12) p = 0.12; ap = K2 * p; } else ap = K2;
    u = xv / ap; if (u > -0.25 && u < 0.25) { u2 = u * u; t = u * (1 + u2 * (-0.3333333333333333 + u2 * (0.13333333333333333 + u2 * -0.05396825396825397))); } else t = tanhF(u);
    v += ap * t;
    gain = g3 > 1 ? 1 + (g3 - 1) * G3[j] : g3; xv = D3[j] * gain;
    if (xv > 0) { p = BP3 * hpl; if (p < 0.12) p = 0.12; ap = K3 * p; } else ap = K3;
    u = xv / ap; if (u > -0.25 && u < 0.25) { u2 = u * u; t = u * (1 + u2 * (-0.3333333333333333 + u2 * (0.13333333333333333 + u2 * -0.05396825396825397))); } else t = tanhF(u);
    v += ap * t;
    if (tex) v += tex[j] * smooth(-4.0, -1.5, v) * (1 - smooth(-0.4, 0.0, v));
    if (v > -79 && v < 79) {
      fi = Math.floor(v + 0.5); ff = v - fi;
      out[q] = POW2[fi + 80] * (1 + ff * (0.6931471805599453 + ff * (0.2402265069591007 + ff * (0.05550410866482158 + ff * (0.009618129107628477
        + ff * (0.0013333558146428443 + ff * (0.00015403530393381606 + ff * (1.525273380405984e-5 + ff * 1.3215486790144307e-6)))))))) - off;
    } else out[q] = Math.pow(2, v) - off;
  }
  return out;
}
// fill a crop-size plane inside a measurement region's source box: mode 0 = src[gi], 1 = crackle
// at gain k on the crop's own fine band, 2 = synthetic pores at amplitude k
function kFillRegion(buf, sw, R, sx0, sy0, W, mode, src, lg, dd, k, zone, tex) {
  var w = R.sx1 - R.sx0, n = w * (R.sy1 - R.sy0), x = 0, ci = R.sy0 * sw + R.sx0, gi = (sy0 + R.sy0) * W + sx0 + R.sx0;
  for (var q = 0; q < n; q++, ci++, gi++) {
    if (x === w) { x = 0; ci += sw - w; gi += W - w; }
    x++;
    if (mode === 0) buf[ci] = src[gi];
    else if (mode === 1) {
      var dv = dd[ci], dc = dv * (dv * dv / (dv * dv + 0.000144)), add = dc < 0 ? dc * k : dc * k * 0.5;
      buf[ci] = exp2F(lg[ci] + 0.45 * tanhF(add / 0.45) * zone[gi]) - 0.03;
    } else buf[ci] = src[gi] * exp2F(k * tex[gi] * zone[gi]);
  }
}
function kCurveRegion(cv, Yl, sw, R) {
  var buf = newF(Yl.length), w = R.sx1 - R.sx0, n = w * (R.sy1 - R.sy0), x = 0, ci = R.sy0 * sw + R.sx0;
  for (var q = 0; q < n; q++, ci++) {
    if (x === w) { x = 0; ci += sw - w; }
    x++;
    buf[ci] = curveAt(cv, Yl[ci]);
  }
  return buf;
}
function kTamed(Lpre, Lf) { var n = Lf.length, o = newF(n); for (var i = 0; i < n; i++) o[i] = clamp(Lpre[i] / Math.max(Lf[i], 0.02), 1.0, 2.5); return o; }
function kRimZ(rzb, a) { var n = a.length, o = newF(n); for (var i = 0; i < n; i++) o[i] = (1 - smooth(0.80, 0.97, rzb[i])) * (a[i] > 0.02 ? 1 : 0); return o; }
function kSkinHue(hs) {
  var H_ = hs.h, S_ = hs.s, n = H_.length, o = newF(n);
  for (var i = 0; i < n; i++) { var h = H_[i], s = S_[i]; o[i] = smooth(1.0, 5.0, h) * (1 - smooth(30.0, 37.0, h)) * smooth(0.12, 0.20, s) * (1 - smooth(0.70, 0.82, s)); }
  return o;
}
function kMulInto(a, b) { for (var i = 0; i < a.length; i++) a[i] = a[i] * b[i]; return a; }
function kScaleInto(a, s) { for (var i = 0; i < a.length; i++) a[i] = a[i] * s; return a; }
function kClampScaled(src, s) { var n = src.length, o = newF(n); for (var i = 0; i < n; i++) o[i] = clamp(src[i] * s, 0, 1); return o; }
function kGreyTint(Lf, tsf, thf) {
  var n = Lf.length, o = [newF(n), newF(n), newF(n)];
  for (var i = 0; i < n; i++) {
    var tv = clamp(Lf[i], 0, 1), wsh = (1 - tv) * 2.0 * clamp(1.3 - tv, 0, 1);
    var q = gamutPx(Lf[i], tsf[0] * wsh + thf[0] * tv, tsf[1] * wsh + thf[1] * tv, tsf[2] * wsh + thf[2] * tv);
    o[0][i] = q[0]; o[1][i] = q[1]; o[2][i] = q[2];
  }
  return o;
}
// chroma rides the final luminance multiplicatively; lifted shadows gain chroma; tamed speculars
function kColourC(Lf, Ys, Yt, tamed, rgb) {
  var n = Lf.length, C = [newF(n), newF(n), newF(n)], R = rgb[0], G = rgb[1], B = rgb[2];
  for (var i = 0; i < n; i++) {
    var ratio = clamp(Lf[i] / Math.max(Ys[i], 0.02), 0.3, 2.0), shw = 1 - smooth(0.15, 0.40, Yt[i]), rc = ratio;
    if (ratio > 1 && shw > 0) rc = rc * Math.pow(Math.min(ratio, 2.0), 0.35 * shw);
    if (tamed[i] !== 1) rc = rc * Math.pow(tamed[i], 0.85);
    C[0][i] = (R[i] - Ys[i]) * rc; C[1][i] = (G[i] - Ys[i]) * rc; C[2][i] = (B[i] - Ys[i]) * rc;
  }
  return C;
}
function kTw(tamed) { var n = tamed.length, o = newF(n), mx = 0; for (var i = 0; i < n; i++) { o[i] = smooth(1.03, 1.30, tamed[i]); if (o[i] > mx) mx = o[i]; } return { w: o, max: mx }; }
function kChromaPerL(rgb, Ys, sw) {
  var n = Ys.length, cpl = [newF(n), newF(n), newF(n)], swE = newF(n);
  for (var i = 0; i < n; i++) {
    var ysm = Math.max(Ys[i], 0.03);
    cpl[0][i] = (rgb[0][i] - Ys[i]) / ysm; cpl[1][i] = (rgb[1][i] - Ys[i]) / ysm; cpl[2][i] = (rgb[2][i] - Ys[i]) / ysm;
    swE[i] = sw[i] + 1e-4;
  }
  return { cpl: cpl, swE: swE };
}
function kSpecChroma(C, cref, Lf, tw, gsw) {
  for (var i = 0; i < Lf.length; i++) {
    if (tw[i] <= 0) continue;
    var cs0 = cref[0][i] * Lf[i], cs1 = cref[1][i] * Lf[i], cs2 = cref[2][i] * Lf[i];
    var more = Math.sqrt(cs0 * cs0 + cs1 * cs1 + cs2 * cs2) > Math.sqrt(C[0][i] * C[0][i] + C[1][i] * C[1][i] + C[2][i] * C[2][i]) ? 1 : 0;
    var wmx = tw[i] * more * smooth(0.02, 0.10, gsw[i]);
    C[0][i] += (cs0 - C[0][i]) * wmx; C[1][i] += (cs1 - C[1][i]) * wmx; C[2][i] += (cs2 - C[2][i]) * wmx;
  }
}
function kSelect2(sw, F, t) { var o = new Uint8Array(sw.length); for (var i = 0; i < sw.length; i++) o[i] = sw[i] > t && F[i] ? 1 : 0; return o; }
// deep skin: the sheen takes the face's own median chroma direction (partly its magnitude), and a
// luminance shoulder above .84
function kDeepSheen(C, Lf, Yt, area, rimz, Cmed, magH0, Lmed, deep, lock, s0_, s1_) {
  for (var i = 0; i < Lf.length; i++) {
    var sc = clamp(Lf[i] / Lmed, 0.9, 1.35), whl = smooth(0.45, 0.72, Yt[i]) * deep * area[i];
    var magC = Math.sqrt(C[0][i] * C[0][i] + C[1][i] * C[1][i] + C[2][i] * C[2][i]), magH = magH0 * sc;
    var lk = Math.max(lock, rimz[i]), magL = magC + (Math.max(magC, 0.85 * magH) - magC) * lk;
    var fk = magL / Math.max(magH, 1e-5);
    for (var c = 0; c < 3; c++) { var cl = Cmed[c] * sc * fk; C[c][i] = C[c][i] + (cl - C[c][i]) * whl; }
    var shv = Lf[i] > s0_ ? s0_ + (Lf[i] - s0_) * s1_ : Lf[i];
    Lf[i] = Lf[i] + (shv - Lf[i]) * deep * area[i];
  }
}
function kRollOff(C, Yt, lightW) {
  for (var i = 0; i < Yt.length; i++) { var ro = 1 - 0.20 * lightW * smooth(0.85, 1.0, Yt[i]); C[0][i] *= ro; C[1][i] *= ro; C[2][i] *= ro; }
}
function kRotate(C, sw, area, lightW, Rm) {
  var deepA = lightW < 0.95;
  for (var i = 0; i < sw.length; i++) {
    var rwv = sw[i];
    if (deepA) rwv = Math.max(sw[i], area[i] * (1 - lightW));
    var a0 = C[0][i], a1 = C[1][i], a2 = C[2][i];
    var r0v = a0 * Rm[0] + a1 * Rm[1] + a2 * Rm[2], r1v = a0 * Rm[3] + a1 * Rm[4] + a2 * Rm[5], r2v = a0 * Rm[6] + a1 * Rm[7] + a2 * Rm[8];
    C[0][i] = a0 + (r0v - a0) * rwv; C[1][i] = a1 + (r1v - a1) * rwv; C[2][i] = a2 + (r2v - a2) * rwv;
  }
}
// local chroma contrast as a magnitude gain, then the blue guard (owner law 1)
function kClarityBlue(C, Cb, hueS, satS, cc, bguard) {
  for (var i = 0; i < hueS.length; i++) {
    var m0 = Math.sqrt(C[0][i] * C[0][i] + C[1][i] * C[1][i] + C[2][i] * C[2][i]);
    var mb = Math.sqrt(Cb[0][i] * Cb[0][i] + Cb[1][i] * Cb[1][i] + Cb[2][i] * Cb[2][i]);
    var gcl = clamp(1 + cc * (m0 - mb) / Math.max(mb, 0.02), 0.8, 1.5);
    var hv = hueS[i], bw = smooth(172, 192, hv) * (1 - smooth(262, 282, hv)) * smooth(0.10, 0.25, satS[i]);
    var gb = gcl * (1 - bguard * bw);
    C[0][i] *= gb; C[1][i] *= gb; C[2][i] *= gb;
  }
}
function kMeanMasked(v, M) { var s = 0, n = 0; for (var i = 0; i < v.length; i++) if (M[i]) { s += v[i]; n++; } return [n ? s / n : 0, n]; }
function kGatherF(F, Lf, C, nF) {
  var o = { L: newF(nF), c0: newF(nF), c1: newF(nF), c2: newF(nF) }, j = 0;
  for (var i = 0; i < F.length; i++) if (F[i]) { o.L[j] = Lf[i]; o.c0[j] = C[0][i]; o.c1[j] = C[1][i]; o.c2[j] = C[2][i]; j++; }
  return o;
}
// mean HSV saturation after the global chroma gain gg and the .32 -> .46 knee
function kSatAt(G_, gg) {
  var n = G_.L.length, s = 0;
  for (var j = 0; j < n; j++) {
    var q0 = G_.c0[j] * gg, q1 = G_.c1[j] * gg, q2 = G_.c2[j] * gg, mg = Math.sqrt(q0 * q0 + q1 * q1 + q2 * q2);
    var kn = mg > 0.32 ? 0.32 + 0.14 * tanhF((mg - 0.32) / 0.14) : mg, f = kn / Math.max(mg, 1e-5);
    var qq = gamutPx(G_.L[j], q0 * f, q1 * f, q2 * f);
    s += hsvSat(qq[0], qq[1], qq[2]);
  }
  return s / Math.max(n, 1);
}
function kChromaOut(Lf, C, gF) {
  var n = Lf.length, o = [newF(n), newF(n), newF(n)];
  for (var i = 0; i < n; i++) {
    var p0 = C[0][i] * gF, p1 = C[1][i] * gF, p2 = C[2][i] * gF, mg = Math.sqrt(p0 * p0 + p1 * p1 + p2 * p2);
    var kn = mg > 0.32 ? 0.32 + 0.14 * tanhF((mg - 0.32) / 0.14) : mg, f = kn / Math.max(mg, 1e-5);
    var q = gamutPx(Lf[i], p0 * f, p1 * f, p2 * f);
    o[0][i] = q[0]; o[1][i] = q[1]; o[2][i] = q[2];
  }
  return o;
}
function kGrain(out, gn, amp) {
  for (var i = 0; i < gn.length; i++) {
    var Lg = 0.2126 * out[0][i] + 0.7152 * out[1][i] + 0.0722 * out[2][i], add = amp * gn[i] * (0.45 + 2.2 * Lg * (1 - Lg));
    for (var c = 0; c < 3; c++) { var v = out[c][i] + add; out[c][i] = v < 0 ? 0 : v > 1 ? 1 : v; }
  }
}
function kMaskRegion(M6, R) {
  var rw = R.dx1 - R.dx0, rh = R.dy1 - R.dy0, sub = new Uint8Array(rw * rh), x = 0, y = 0;
  for (var q = 0; q < rw * rh; q++) {
    sub[q] = M6.m[(R.dy0 + y) * R.w6 + R.dx0 + x];
    if (++x === rw) { x = 0; y++; }
  }
  return sub;
}
function kBBoxMask(M, w) {
  var x0 = w, y0 = 1e9, x1 = -1, y1 = -1, x = 0, y = 0;
  for (var i = 0; i < M.length; i++) {
    if (M[i]) { if (y < y0) y0 = y; y1 = y; if (x < x0) x0 = x; if (x > x1) x1 = x; }
    if (++x === w) { x = 0; y++; }
  }
  return [x0, y0, x1, y1];
}
// a ref-scale mask's measurement region inside a crop (cw x ch): the destination box its pixels
// need (padLo / padHi rows and columns for the widest box: width n reads i - n/2 .. i + n/2 - 1)
// and the source box of the crop that feeds it
function measureRegion(M6, cw, ch, padLo, padHi) {
  var bb = kBBoxMask(M6.m, M6.w);
  if (bb[2] < 0) return null;
  var R = { dx0: Math.max(0, bb[0] - padLo), dy0: Math.max(0, bb[1] - padLo), dx1: Math.min(M6.w, bb[2] + 1 + padHi),
            dy1: Math.min(M6.h, bb[3] + 1 + padHi), w6: M6.w, h6: M6.h, M6: M6 };
  if (cw === M6.w && ch === M6.h) { R.sx0 = R.dx0; R.sx1 = R.dx1; R.sy0 = R.dy0; R.sy1 = R.dy1; }
  else if (cw % M6.w === 0 && ch % M6.h === 0) {
    var fx_ = cw / M6.w, fy_ = ch / M6.h;
    R.sx0 = R.dx0 * fx_; R.sx1 = R.dx1 * fx_; R.sy0 = R.dy0 * fy_; R.sy1 = R.dy1 * fy_;
  } else {
    var tx = areaTab(cw, M6.w), ty = areaTab(ch, M6.h);
    R.sx0 = tx.si[tx.st[R.dx0]]; R.sx1 = tx.si[tx.st[R.dx1] - 1] + 1; R.sy0 = ty.si[ty.st[R.dy0]]; R.sy1 = ty.si[ty.st[R.dy1] - 1] + 1;
  }
  R.sub = kMaskRegion(M6, R);
  return R;
}
// lc at the 640 scale over R's mask, reading only R's source box of a crop-size plane
function lcRegion(buf, cw, ch, R, sizes) {
  var rr = cw === R.w6 && ch === R.h6 ? cropF(buf, cw, R.dx0, R.dy0, R.dx1, R.dy1) : resizeAreaRegion(buf, cw, ch, R.w6, R.h6, R.dx0, R.dy0, R.dx1, R.dy1);
  return lcValues(rr, R.dx1 - R.dx0, R.dy1 - R.dy0, R.sub, sizes);
}

// ---------- grade_subject itself ----------
// img: RGBA image at its FINAL poster size. mode: color | natural | mono | pop | inset.
// opts: face ([x, y, w, h] or {x, y, w, h}), px (poster px per ref px, default w / 640), theme
// (pop re-hue), upscale (how much the source was enlarged), seed, bodyRows, torsoCap, iters
// (closed-loop passes, default 8), fast (thumbnails: 4 passes, fewer bisection steps), look
// (overrides of GRADE_DEFAULTS by their look.py names, e.g. { rim_dark: 0, rim_tame: 0, p: [...] }),
// report (an object that receives the fitted numbers, the stage timings and the pop mask).
function gradeSubject(img, mode, opts) {
  opts = opts || {};
  mode = mode || "color";
  // fast: the grade runs on a copy at workScale (default .5 when the longer side is over 480 px)
  // and the graded image is scaled back up: a preview / thumbnail look (softer grit), 4-6x cheaper
  if (opts.fast && !opts.workDone) {
    var ws = opts.workScale || (Math.max(img.w, img.h) > 480 ? 0.5 : 1);
    if (ws < 1) {
      var w2 = Math.max(16, Math.round(img.w * ws)), h2 = Math.max(16, Math.round(img.h * ws)), sx = w2 / img.w, sy = h2 / img.h;
      var o2 = {}, kk2, f0 = normFace(opts.face);
      for (kk2 in opts) o2[kk2] = opts[kk2];
      o2.workDone = true;
      o2.px = (opts.px || img.w / REF_W) * sx;
      o2.face = f0 ? [f0[0] * sx, f0[1] * sy, f0[2] * sx, f0[3] * sy] : null;
      o2.upscale = Math.max(1, (opts.upscale || 1) * sx);
      return resizeRGBA(gradeSubject(resizeRGBA(img, w2, h2), mode, o2), img.w, img.h);
    }
  }
  var o = {}, key;
  for (key in GRADE_DEFAULTS) o[key] = GRADE_DEFAULTS[key];
  if (opts.look) for (key in opts.look) o[key] = opts.look[key];
  var W = img.w, H = img.h, N = W * H, k;
  var px = opts.px || W / REF_W, face = normFace(opts.face), seed = opts.seed == null ? 7 : opts.seed;
  var upscale = opts.upscale || 1, bodyRows = opts.bodyRows == null ? 1.6 : opts.bodyRows, torsoCap = !!opts.torsoCap;
  var fast = !!opts.fast, iters = opts.iters == null ? (fast ? 4 : 8) : opts.iters;
  var report = opts.report || null, tmk = report ? [] : null;
  function mark(key) { if (tmk) tmk.push([key, nowMs()]); }
  mark("start");
  DEN = [];
  var TT = TARGETS[mode], T = { p: (o.p || TT.p).slice(), sat: TT.sat, lc: TT.lc.slice() };
  var grey = mode === "mono" || mode === "pop" || mode === "inset";
  var P0 = splitRGBA(img), rgb0 = P0.rgb;
  kClampPlanes(rgb0);
  var df = defringe(rgb0, P0.a, W, H, px), rgb = df.rgb, a = df.a, m = kSmoothMap(a, 0.35, 0.90);
  P0 = null; rgb0 = null; df = null;
  var HSc = null;
  function HS() { if (!HSc) HSc = hueSat(rgb); return HSc; }
  mark("defringe");

  // ---- regions: F = face ellipse (texture), P = where the percentiles are fitted
  var F, fx = 0, fy = 0, fw = 0, fh = 0;
  if (face) {
    fx = face[0]; fy = face[1]; fw = face[2]; fh = face[3];
    F = kAndAbove(ellipseMask(W, H, fx + fw / 2, fy + fh / 2, fw * 0.40, fh * 0.44), a, 0.95);
  } else {
    F = kAbove(a, 0.95);
    var r0 = kFirstRowAbove(a, W, 0.5);
    if (r0 >= 0) F.fill(0, Math.floor(r0 + 0.55 * (H - r0)) * W);
  }
  if (countOf(F) < 300) F = kAbove(a, 0.95);
  var P = F;
  if ((mode === "mono" || mode === "pop") && face) {
    P = kRowsAbove(a, W, H, Math.floor(Math.max(0, fy)), Math.floor(Math.min(H, fy + fh * (1 + bodyRows))), 0.95);
    if (countOf(P) < 300) P = F;
  }
  var Q = F;
  function refMask(Mk, w_, h_) {
    var r1 = toRefMask(Mk, w_, h_, px, 0.99);
    if (countOf(r1.m) < 20) r1 = toRefMask(Mk, w_, h_, px, 0.5);
    return r1;
  }
  var P6 = refMask(P, W, H), Q6 = refMask(Q, W, H);

  // ---- 1. luminance; light_w = how pale the face is
  var Lrgb = lumaMap(rgb), LrgbR = toRef(Lrgb, W, H, px);
  var lp = pctMasked(LrgbR.d, mode !== "pop" ? Q6.m : P6.m, [10, 50, 90, 99]);
  var lightW = smooth(0.50, 0.60, lp[1] / Math.max(lp[3], 0.3));
  var Y = Lrgb;
  if (grey) {
    var mm = [];
    for (k = 0; k < 3; k++) mm.push(F32(F32(o.mono_mix[k]) * lightW + F32(o.mono_mix_deep[k]) * (1 - lightW)));
    Y = kMonoY(rgb, mm[0], mm[1], mm[2]);
  }
  var YR = toRef(Y, W, H, px), inP = pctMasked(YR.d, P6.m, [10, 50, 90, 99]);

  // ---- 2. adapted targets
  var lift, pull;
  if (grey) { lift = [1.60, 1.55, 1.35, 1.25]; pull = 0.92; }
  else {
    var dl = o.deep_mid_lift;
    lift = [1.22 + 0.23 * lightW, dl + (1.32 - dl) * lightW, 1.02 + 0.24 * lightW, 1.00 + 0.22 * lightW];
    pull = 0.85;
  }
  var autoEx = clamp(0.80 / Math.max(inP[3], 0.3), 1.0, 1.5);
  for (k = 0; k < 4; k++) lift[k] = k < 3 ? lift[k] * autoEx : lift[k] * Math.min(autoEx, 1.15);
  var tgtP = adaptTargets(inP, T.p, pull, lift);
  if (!grey) {
    var k50 = tgtP[1] / Math.max(inP[1], 1e-3), kk = k50 - 1;
    var own = [inP[0] * k50, tgtP[1], inP[2] * (1 + 0.5 * kk), inP[3] * (1 + 0.2 * kk)];
    for (k = 0; k < 4; k++) tgtP[k] = lerp(own[k], tgtP[k], lightW);
  }
  var white = 1.0;
  if (!grey) {
    var dtop = o.deep_top * (1 - lightW);
    tgtP[3] = Math.min(tgtP[3], 0.88 + 0.05 * lightW + 0.05 * dtop);
    tgtP[2] = Math.min(tgtP[2], tgtP[3] - 0.06);
    white = 0.93 + 0.07 * lightW + 0.05 * dtop;
  }
  var whole = kAbove(toRef(a, W, H, px).d, 0.95);
  var s995 = countOf(whole) > 100 ? pctMasked(YR.d, whole, [99.5])[0] : 1.0;
  var extra = null;
  if (s995 > inP[3] + 0.03) extra = [s995, Math.min(white - 0.02, tgtP[3] + 0.5 * (s995 - inP[3]))];
  mark("targets");

  // ---- 3. log2 guided pyramid
  var off = 0.03, lg = kLog2Map(Y, off);
  var us = clamp(upscale, 1.0, 2.0), radii = [];
  for (k = 0; k < 4; k++) radii.push(Math.max(1, roundHE(BAND_R[k] * px * (k < 2 ? us : 1.0))));
  var bases = [lg];
  for (k = 0; k < 4; k++) bases.push(guided(bases[k], bases[k], W, H, radii[k], BAND_EPS[k] * o.eps_k, m));
  var d = [];
  for (k = 0; k < 4; k++) d.push(kSub(bases[k], bases[k + 1]));
  var base = bases[4];
  bases = null;
  // coring: the fine band's noise floor (the flattest 10 % of the face)
  var e2 = mbox(mulF(d[0], d[0]), m, W, H, Math.max(2, Math.floor(2 * px)));
  var nz = Math.sqrt(Math.max(pctMasked(e2, F, [10])[0], 1e-10));
  var core = Math.max(0.006, o.core_k * nz);
  kCore(d[0], core * core);
  var K = [], guard = [];
  for (k = 0; k < 4; k++) K.push(BAND_K[mode][k] * o.K_k);
  for (k = 0; k < 4; k++) guard.push(kGuard(mbox(mulF(d[k], d[k]), m, W, H, Math.max(2, radii[k])), o.guard_k * K[k]));
  // highlight protection + dark-base easing (the per-band light-side clip is derived per pixel)
  var bm = kBaseMaps(base, off, 0.55 * inP[3], 1.05 * inP[3], 0.25 * inP[1], 0.60 * inP[1], 0.62 * inP[3], 1.0 * inP[3]);
  var hp = grey ? 0.55 : 0.35 + 0.40 * (1 - lightW);
  if (!grey) hp = lerp(hp, o.deep_hp, smooth(0.0, 0.6, 1 - lightW));
  var hlw = gblur(bm.hlwS, W, H, 4 * px), gE = grey ? 0.65 : (0.35 + 0.45 * (1 - lightW));
  for (k = 0; k < 4; k++) kEase(guard[k], hlw, gE);
  lg = null; e2 = null; hlw = null; bm.hlwS = null; LrgbR = null;
  mark("pyramid");
  var medB = medianMasked(base, F), tex = null;
  if (us > 1.15 && (grey || us > 1.4)) {
    var nn = noise(H, W, seed + 101);
    tex = kTexUp(nn, gblur(nn, W, H, 1.3), o.upscale_tex * Math.min(1, (us - 1) / 0.7));
  }
  var X = { W: W, guard: guard, d: d, K: K, base: base, hl: bm.hl, dkp: bm.dkp, tex: tex, medB: medB, hp: hp,
            dkK: grey ? 0.45 : 0.60, off: off, formShare: o.form_share };
  // the loop runs on the box around the measured regions only
  var bb = kBBox2(P, F, W), mg = Math.floor(40 * px);
  var sy0 = Math.max(0, bb[1] - mg), sy1 = Math.min(H, bb[3] + mg), sx0 = Math.max(0, bb[0] - mg), sx1 = Math.min(W, bb[2] + mg);
  var sw_ = sx1 - sx0, sh_ = sy1 - sy0;
  var P6c = refMask(cropM(P, W, sx0, sy0, sx1, sy1), sw_, sh_), Q6c = refMask(cropM(Q, W, sx0, sy0, sx1, sy1), sw_, sh_);
  function tone(Yl, cw, ch, P6x) {
    var rs = toRef(Yl, cw, ch, px), p2 = pctMasked(rs.d, P6x.m, [10, 50, 90, 99]);
    var hiv = Math.max(1.0, pctMasked(Yl, null, [99.95])[0] + 1e-3);
    return fitCurve(p2, tgtP, grey ? 0.004 : 0.008, 3.0, Math.min(0.0, minOf(Yl)), hiv, white, extra);
  }
  var weber = clamp(tgtP[1] / T.p[1], 0.72, 1.0);
  var grainAmp = o.grain[mode] * (px / (1080 / REF_W));
  var tl = [weber * T.lc[0], weber * T.lc[1], Math.max(weber, 0.9) * T.lc[2]];
  var gq = o.grain_lc2_share * grainAmp;
  tl[0] = Math.sqrt(Math.max(tl[0] * tl[0] - gq * gq, (0.6 * tl[0]) * (0.6 * tl[0])));
  var g = GAIN0[mode].slice(), cB = BASE_C[mode];
  var lims = [GAIN_LIM[0].slice(), GAIN_LIM[1].slice(), [grey ? 0.7 : 1.0, GAIN_LIM[2][1]]];
  var cLo = BASE_C[mode] - 0.06;
  if (!grey) {
    var deep_ = smooth(0.0, 0.6, 1 - lightW);
    lims[0] = [1.0, lerp(GAIN_LIM[0][1], o.deep_fine_max, deep_)];
    lims[1] = [1.0, lerp(GAIN_LIM[1][1], o.deep_mid_max, deep_)];
    lims[2] = [1.0, lerp(GAIN_LIM[2][1], 1.8, deep_)];
    g = [Math.min(g[0], lims[0][1]), Math.min(g[1], lims[1][1]), Math.min(g[2], lims[2][1])];
    tl = [tl[0], tl[1] * (1 - 0.15 * deep_), tl[2] * (1 - 0.20 * deep_)];
    cLo = lerp(cLo, o.deep_c_lo, deep_);
    cB = Math.max(cB, cLo);
  }
  var lcm = null, memo = {}, RQ = measureRegion(Q6c, sw_, sh_, 16, 15), passes = 0;
  mark("pre-loop");
  for (var it = 0; it < iters; it++) {
    var gIn = g.slice(), cIn = cB;
    var Ylc = kCompose(X, g, cB, sx0, sy0, sx1, sy1, true, memo), cvl = tone(Ylc, sw_, sh_, P6c);
    if (RQ) lcm = lcRegion(kCurveRegion(cvl, Ylc, sw_, RQ), sw_, sh_, RQ);
    else { var rsl = toRef(applyCurve(cvl, Ylc), sw_, sh_, px); lcm = lcValues(rsl.d, rsl.w, rsl.h, Q6c.m); }
    passes++;
    for (k = 0; k < 3; k++) g[k] = clamp(g[k] * Math.pow(tl[k] / Math.max(lcm[k], 1e-4), 1.3), lims[k][0], lims[k][1]);
    if ((g[2] <= lims[2][0] + 1e-3 && lcm[2] > tl[2]) || (g[2] >= lims[2][1] - 1e-3 && lcm[2] < tl[2]))
      cB = clamp(cB * Math.pow(lcm[2] / tl[2], 1.5), cLo, grey ? 1.15 : 1.05);
    // a fixed point: the next pass would repeat this one exactly, and so would every pass after it
    if (g[0] === gIn[0] && g[1] === gIn[1] && g[2] === gIn[2] && cB === cIn) break;
  }
  memo = null;
  mark("loop");
  var Yl = kCompose(X, g, cB, 0, 0, W, H, true, null), cv = tone(cropF(Yl, W, sx0, sy0, sx1, sy1), sw_, sh_, P6c);
  var Lf = applyCurve(cv, Yl);
  Yl = null; d = null; guard = null; X = null; tex = null; base = null; bm = null; DEN = [];
  mark("compose");

  // ---- 3b. luminance hygiene: kicker stripe, white salt, torso metering
  var ceil = null;
  if (countOf(F) > 100) { var fq = pctMasked(Lf, F, [50, 90]); ceil = fq[0] + 0.6 * (fq[1] - fq[0]); }
  var Lpre = Lf, zr = grey ? 5.0 : 5.0 + o.deep_zone * (1 - lightW);
  var rzb = gblur(kAbove01(a, 0.5), W, H, zr * px);
  Lf = tameRim(Lf, a, W, H, px, o.rim_tame, ceil, zr, 0.25, rzb);
  var tamed = kTamed(Lpre, Lf), rimz = kRimZ(rzb, a);
  Lpre = null; rzb = null;
  mark("tame-rim");
  // ---- 3c. flat-skin micro texture (crackle, then synthetic pores only if needed). Every bisection
  // step only evaluates the source box that feeds the flat-skin measurement (measureRegion)
  var S = flatSkin(grey ? Y : Lrgb, a, F, W, H, px);
  var S6c = refMask(cropM(S, W, sx0, sy0, sx1, sy1), sw_, sh_);
  var texAmp = 0, ck = 0, tt = o.tex_target[mode];
  if (!grey) tt = tt * smooth(0.35, 0.80, lightW);
  var fmed = countOf(F) > 50 ? medianMasked(Lf, F) : 0.6;
  tt = tt * clamp(fmed / 0.62, 0.72, 1.0);
  var lcFlat0 = null;
  if (countOf(S6c.m) > 30 && tt > 0) {
    var RS = measureRegion(S6c, sw_, sh_, 1, 0), cropBuf = newF(sw_ * sh_);
    kFillRegion(cropBuf, sw_, RS, sx0, sy0, W, 0, Lf);
    lcFlat0 = lcRegion(cropBuf, sw_, sh_, RS, [2])[0];
    if (lcFlat0 < tt) {
      var skinT = kClampScaled(mblur(kSkinHue(HS()), m, W, H, 2 * px), 1.4);
      var zone = kMulInto(skinZone(Lf, m, W, H, px, medianMasked(Lf, F)), skinT);
      var cbC = crackleBand(cropF(Lf, W, sx0, sy0, sx1, sy1), cropF(m, W, sx0, sy0, sx1, sy1), sw_, sh_, px);
      var lo_ = 0, hi_ = o.crackle_max, steps = fast ? 6 : 9;
      for (k = 0; k < steps; k++) {
        ck = 0.5 * (lo_ + hi_);
        kFillRegion(cropBuf, sw_, RS, sx0, sy0, W, 1, null, cbC.lg, cbC.d, ck, zone, null);
        if (lcRegion(cropBuf, sw_, sh_, RS, [2])[0] < tt) lo_ = ck; else hi_ = ck;
      }
      ck = 0.5 * (lo_ + hi_);
      var cbF = crackleBand(Lf, m, W, H, px);
      Lf = crackle(cbF.lg, cbF.d, ck, zone);
      kFillRegion(cropBuf, sw_, RS, sx0, sy0, W, 0, Lf);
      if (lcRegion(cropBuf, sw_, sh_, RS, [2])[0] < 0.97 * tt) {
        var texF = textureField(H, W, px, seed + 303);
        lo_ = 0; hi_ = o.tex_max * (grey ? 0.5 : 0.35 + 0.65 * lightW);
        var steps2 = fast ? 5 : 8;
        for (k = 0; k < steps2; k++) {
          var amp = 0.5 * (lo_ + hi_);
          kFillRegion(cropBuf, sw_, RS, sx0, sy0, W, 2, Lf, null, null, amp, zone, texF);
          if (lcRegion(cropBuf, sw_, sh_, RS, [2])[0] < tt) lo_ = amp; else hi_ = amp;
        }
        texAmp = 0.5 * (lo_ + hi_);
        Lf = skinTexture(Lf, texAmp, texF, zone);
      }
    }
  }
  mark("texture");
  Lf = desalt(Lf, m, W, H, px, o.desalt);
  var hs_ = o.hair_tone[mode] || 0;
  if (hs_ > 0) Lf = hairTone(Lf, kScaleInto(hairWeight(Lrgb, m, W, H, px, lp[1]), hs_), m, W, H, px, 0.45, grey ? 0.62 : 0.95);
  if (mode === "mono" || mode === "pop") Lf = smoothHighlights(Lf, m, W, H, px, 0.74, 0.55, o.smooth_hl);
  if (torsoCap && face) {
    Lf = capTorso(Lf, a, face, W, H, px);
    Lf = tameRidges(Lf, m, face, W, H, px);
  }
  mark("hair");

  // ---- 4. colour
  var out, satT, pmOut = null;
  if (grey) {
    var ts = o.mono_tint_shadow, th_ = o.mono_tint_high;
    out = kGreyTint(Lf, [F32(ts[0]), F32(ts[1]), F32(ts[2])], [F32(th_[0]), F32(th_[1]), F32(th_[2])]);
    if (mode === "pop") {
      var fmask = face ? toF(ellipseMask(W, H, fx + fw / 2, fy + fh / 2, fw * 0.64, fh * 0.64)) : null;
      var pc = popColour(out, rgb, Lf, a, W, H, px, opts.theme || null, fmask, HS());
      out = pc.rgb; pmOut = pc.pm;
    }
    satT = T.sat;
  } else {
    var Ys = Lrgb, Yt = gblur(Lf, W, H, 1.0 * px), C = kColourC(Lf, Ys, Yt, tamed, rgb);
    var sw = kMulInto(skinWeightMap(rgb, HS()), m), tw = kTw(tamed);
    if (tw.max > 0) {
      var cp = kChromaPerL(rgb, Ys, sw);
      kSpecChroma(C, mblurN(cp.cpl, cp.swE, W, H, 4 * px), Lf, tw.w, gblur(sw, W, H, 4 * px));
    }
    var area = null;
    if (lightW < 0.95) {
      var deep = 1 - lightW, sel = kSelect2(sw, F, 0.5);
      if (countOf(sel) < 100) sel = F;
      var Cmed = [medianMasked(C[0], sel), medianMasked(C[1], sel), medianMasked(C[2], sel)];
      var Lmed = Math.max(medianMasked(Lf, sel), 0.05);
      area = kClampScaled(mblur(sw, m, W, H, 30 * px), 3.0);
      kDeepSheen(C, Lf, Yt, area, rimz, Cmed, Math.sqrt(Cmed[0] * Cmed[0] + Cmed[1] * Cmed[1] + Cmed[2] * Cmed[2]), Lmed, deep,
                 o.deep_lock, o.deep_shoulder[0], o.deep_shoulder[1]);
    }
    kRollOff(C, Yt, lightW);
    var skinPx = kSelect2(sw, F, 0.5);
    if (countOf(skinPx) > 200) {
      var mh = medianMasked(HS().h, skinPx);
      var rotP = clamp(o.skin_hue_target - mh, -o.skin_rotate_max, 0.0), rotD = clamp(o.skin_hue_deep - mh, 0.0, o.skin_rotate_deep_max);
      var rot = rotP * lightW + rotD * (1 - lightW);
      if (Math.abs(rot) > 0.01) {
        if (lightW < 0.95 && !area) area = kClampScaled(mblur(sw, m, W, H, 30 * px), 3.0);
        kRotate(C, sw, area, lightW, rotMat(rot));
      }
    }
    kClarityBlue(C, mblurN(C, m, W, H, 7 * px), HS().h, HS().s, o.chroma_clarity, o.blue_guard);
    var ms = kMeanMasked(HS().s, F), inSat = ms[0], nF = ms[1];
    if (mode === "color") {
      satT = clamp(o.sat_target + 0.05 * (1 - lightW), 0.75 * inSat, 1.5 * inSat);
      satT = lerp(satT, o.sat_deep_keep * inSat, 1 - lightW);
    } else satT = clamp(0.95 * inSat, 0.30, 0.52);
    // bisection on the global chroma gain (with the .32 -> .46 knee) to the face saturation
    var GF = kGatherF(F, Lf, C, nF), glo = 0, ghi = 3.0, bsteps = fast ? 10 : 14;
    for (k = 0; k < bsteps; k++) {
      var gg = 0.5 * (glo + ghi);
      if (kSatAt(GF, gg) < satT) glo = gg; else ghi = gg;
    }
    out = kChromaOut(Lf, C, 0.5 * (glo + ghi));
  }
  mark("colour");
  // ---- 4b. the edge band matched to the interior
  out = edgeMatch(out, a, W, H, px, 2.0, 4.0, o.edge_match);
  mark("edge-match");
  // ---- 5. grain: fine, luminance only, midtone weighted
  if (grainAmp > 0) kGrain(out, noise(H, W, seed, 0.55 * px / (1080 / REF_W)), grainAmp);
  mark("grain");
  // ---- 6. edge clamp (no light fringe, faint dark inner rim)
  out = edgeClamp(out, a, W, H, px, o.rim_dark);
  mark("edge-clamp");
  if (report) {
    report.timing = [];
    for (k = 1; k < tmk.length; k++) report.timing.push([tmk[k][0], Math.round(tmk[k][1] - tmk[k - 1][1])]);
    report.gains = g.slice(); report.c = cB; report.light_w = lightW; report.target_p = tgtP.slice(); report.in_p = inP.slice();
    report.sat_t = satT; report.lc_target = tl.slice(); report.noise = nz; report.tex_amp = texAmp; report.crackle = ck;
    report.lc_flat_before = lcFlat0; report.lc_last = lcm; report.pop_mask = pmOut; report.passes = passes;
  }
  DEN = [];
  return joinRGBA(out, a, W, H);
}

// =============================================================================================
// themes
// =============================================================================================
var PLATE_SAT = 0.91;
function hsvHex(h, v, s) {
  var c = v * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = v - c, t = Math.floor(h / 60) % 6;
  var tri = [[c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x]][t], out = "#";
  for (var i = 0; i < 3; i++) {
    var n = roundHE((tri[i] + m) * 255), hx = n.toString(16).toUpperCase();
    out += hx.length < 2 ? "0" + hx : hx;
  }
  return out;
}
// plate ramp from (t, hue, value, saturation) stops (look._ramp)
function ramp(spec, sat, val) {
  sat = sat == null ? 1 : sat; val = val == null ? 1 : val;
  var o = [];
  for (var i = 0; i < spec.length; i++) {
    var s = spec[i];
    o.push([s[0], hsvHex(s[1], s[0] > 0 ? Math.min(1, s[2] * val) : s[2], Math.min(1, s[3] * PLATE_SAT * sat))]);
  }
  return o;
}
// a / hi / lo: display type ramp (mix(a, hi, .6) top, a at 55 %, mix(a, lo, .55) bottom)
// plate: the gradient map; hue: the pop re-hue test; pop: the colour a far kit is re-hued to
// shade: the near-black of fades and dark halos; haze: the soft light behind heads
// ink: dark text on an accent plate. cool: an inset's saturated reds are muted (owner law 1)
// Never a blue theme (owner law 1: no red and blue together).
var THEMES = {
  ember: { name: "Ember", a: "#FF8A1F", hi: "#FFC24D", lo: "#F0560C", hue: 28.0, pop: "#FF8A1F", cool: false,
    plate: ramp([[0.00, 12, 0.045, 0.78], [0.20, 15, 0.20, 0.93], [0.42, 19, 0.43, 0.95], [0.64, 23, 0.67, 0.94], [0.84, 28, 0.87, 0.90], [1.00, 34, 1.00, 0.76]]),
    shade: "#0D0603", haze: "#FFC9A0", ink: "#1C0B02" },
  pink: { name: "Pink", a: "#FF4D9A", hi: "#FFB3D2", lo: "#D9166C", hue: 334.0, pop: "#FF4D9A", cool: false,
    plate: ramp([[0.00, 320, 0.045, 0.72], [0.20, 321, 0.21, 0.88], [0.42, 325, 0.45, 0.90], [0.64, 330, 0.69, 0.87], [0.84, 334, 0.88, 0.78], [1.00, 340, 1.00, 0.52]], 1.07, 1.15),
    shade: "#0D0309", haze: "#FFC6DF", ink: "#1C0612" },
  violet: { name: "Violet", a: "#C95CFF", hi: "#ECBFFF", lo: "#9927E6", hue: 280.0, pop: "#C95CFF", cool: true,
    plate: ramp([[0.00, 276, 0.05, 0.70], [0.20, 278, 0.24, 0.84], [0.42, 280, 0.48, 0.86], [0.64, 283, 0.73, 0.80], [0.84, 286, 0.91, 0.62], [1.00, 290, 1.00, 0.40]], 1.12, 1.16),
    shade: "#0A050F", haze: "#E3CBFF", ink: "#12061C" },
  gold: { name: "Gold", a: "#F7B530", hi: "#FFE08A", lo: "#D98A00", hue: 40.0, pop: "#F7B530", cool: false,
    plate: ramp([[0.00, 26, 0.045, 0.75], [0.20, 24, 0.16, 0.93], [0.42, 28, 0.35, 0.95], [0.64, 34, 0.60, 0.93], [0.84, 40, 0.84, 0.86], [1.00, 45, 0.99, 0.66]]),
    shade: "#0D0803", haze: "#FFE3B0", ink: "#1C1302" },
  // crimson: oxblood shadows, blood-red mids, a warm scarlet top (hue 352 -> 8); red carries the
  // least luma per value, so the ramp is lifted x1.22 (measured plate L p50 .17, beside pink / violet)
  crimson: { name: "Crimson", a: "#F2303F", hi: "#FF8A7A", lo: "#B80C20", hue: 355.0, pop: "#F2303F", cool: false,
    plate: ramp([[0.00, 352, 0.045, 0.80], [0.20, 354, 0.21, 0.93], [0.42, 356, 0.45, 0.95], [0.64, 359, 0.69, 0.92], [0.84, 3, 0.88, 0.84], [1.00, 8, 1.00, 0.66]], 1.0, 1.22),
    shade: "#0D0304", haze: "#FFC4BD", ink: "#1C0306" },
  // toxic: forest shadows, emerald mids, a lime top (hue 150 -> 118); green carries the most luma
  // per value, so the ramp is scaled x.84 (measured plate L p50 .21, like ember / gold; never neon)
  toxic: { name: "Toxic", a: "#3DF07E", hi: "#B4FFCB", lo: "#0DA84A", hue: 142.0, pop: "#3DF07E", cool: false,
    plate: ramp([[0.00, 150, 0.045, 0.78], [0.20, 148, 0.15, 0.92], [0.42, 145, 0.33, 0.93], [0.64, 140, 0.57, 0.90], [0.84, 132, 0.81, 0.82], [1.00, 118, 0.98, 0.62]], 1.0, 0.84),
    shade: "#030D06", haze: "#C6FFD8", ink: "#03160A" }
};
var THEME_ORDER = ["ember", "pink", "violet", "gold", "crimson", "toxic"];
function themeOf(t) { if (!t) return THEMES.ember; if (typeof t === "string") return THEMES[t] || THEMES.ember; return t; }
function isCool(t) { var th = themeOf(t); return !!th.cool || (th.hue >= 200 && th.hue <= 300); }

// t 0..1 -> colour through (t, hex) stops via a 1024-entry palette LUT
function gradientLut(stops) {
  if (stops._lut) return stops._lut;
  var n = 1024, ts = [], cols = [], i, c, lut = new Float32Array(n * 3);
  for (i = 0; i < stops.length; i++) { ts.push(F32(stops[i][0])); cols.push(hex01(stops[i][1])); }
  for (i = 0; i < n; i++) {
    var t = i === n - 1 ? 1 : i * (1 / (n - 1));
    for (c = 0; c < 3; c++) {
      var ys = [];
      for (var k = 0; k < cols.length; k++) ys.push(cols[k][c]);
      lut[i * 3 + c] = interp1(t, ts, ys);
    }
  }
  stops._lut = lut;
  return lut;
}
function gradientMap(t, stops) {
  var lut = gradientLut(stops), n = t.length, o = [newF(n), newF(n), newF(n)], c1023 = F32(1023);
  for (var i = 0; i < n; i++) {
    var v = t[i] < 0 ? 0 : t[i] > 1 ? 1 : t[i], j = Math.floor(F32(F32(v * c1023) + 0.5)) * 3;
    o[0][i] = lut[j]; o[1][i] = lut[j + 1]; o[2][i] = lut[j + 2];
  }
  return o;
}
// owner law 1 on a cool poster: saturated reds in a natural inset turn toward a warm skin tone
function coolReds(rgb, amount) {
  if (amount == null) amount = 0.88;
  var n = rgb[0].length, R14 = rotMat(14.0), o = [newF(n), newF(n), newF(n)];
  for (var i = 0; i < n; i++) {
    var r = rgb[0][i], g = rgb[1][i], b = rgb[2][i], h = hueDeg(r, g, b), s = hsvSat(r, g, b);
    var red = smooth(20.0, 10.0, hueDist(h, 358.0)) * smooth(0.42, 0.58, s);
    red = Math.max(red, smooth(24.0, 14.0, hueDist(h, 350.0)) * smooth(0.52, 0.66, s));
    var L = 0.2126 * r + 0.7152 * g + 0.0722 * b, c0 = r - L, c1 = g - L, c2 = b - L, wv = red * amount;
    var w0 = L + (c0 * R14[0] + c1 * R14[1] + c2 * R14[2]) * 0.55, w1 = L + (c0 * R14[3] + c1 * R14[4] + c2 * R14[5]) * 0.55;
    var w2 = L + (c0 * R14[6] + c1 * R14[7] + c2 * R14[8]) * 0.55;
    o[0][i] = clamp(r * (1 - wv) + w0 * wv, 0, 1); o[1][i] = clamp(g * (1 - wv) + w1 * wv, 0, 1); o[2][i] = clamp(b * (1 - wv) + w2 * wv, 0, 1);
  }
  return o;
}
// share of saturated red (hue 344-8, sat > .45): blood, red gloves
function redShare(rgb) {
  var n = rgb[0].length, c = 0;
  for (var i = 0; i < n; i++) {
    var h = hueDeg(rgb[0][i], rgb[1][i], rgb[2][i]);
    if (hueDist(h, 356.0) <= 12.0 && hsvSat(rgb[0][i], rgb[1][i], rgb[2][i]) > 0.45) c++;
  }
  return c / n;
}

// =============================================================================================
// grade_plate: the dark, soft, single-hue action photo
// =============================================================================================
var PLATE_Q = [2, 10, 25, 50, 75, 90, 98];
var PLATE_T = [0.05, 0.16, 0.30, 0.45, 0.58, 0.69, 0.79];
// photo -> value image t (0..1): log2, edge-aware flattened base, detail (depth of field around the
// action), a slope-limited quantile match, the regional sink of flat bright areas, defocus
function plateValue(rgb, w, h, px, o) {
  o = o || {};
  var soft = o.soft || 0, flatten = o.flatten == null ? 0.80 : o.flatten, detail = o.detail == null ? 3.4 : o.detail;
  var maxSlope = o.maxSlope == null ? 0.55 : o.maxSlope, minSlope = o.minSlope == null ? 0.05 : o.minSlope;
  var target = o.target || PLATE_T, sink = o.sink == null ? 0.38 : o.sink, focus = o.focus || null;
  var defocus = o.defocus == null ? 9.0 : o.defocus, fast = !!o.fast;
  var n = w * h, i, x, y;
  var Y = gblur(lumaMap(rgb), w, h, soft * px), lg = newF(n);
  for (i = 0; i < n; i++) lg[i] = Math.log2(Y[i] + 0.02);
  var small = toRef(lg, w, h, px);
  var b = guided(small.d, small.d, small.w, small.h, 14, 0.10, null);
  var base = resizeLinear(b, small.w, small.h, w, h);
  var med = medianMasked(small.d, null), fwv = null, lg2 = newF(n);
  if (focus) {
    fwv = newF(n);
    var ffx = focus[0], ffy = focus[1], fr2 = 2.0 * focus[2] * focus[2];
    for (y = 0; y < h; y++) for (x = 0; x < w; x++) fwv[y * w + x] = Math.exp(-((x - ffx) * (x - ffx) + (y - ffy) * (y - ffy)) / fr2);
  }
  for (i = 0; i < n; i++) {
    var det = fwv ? detail * (0.40 + 0.60 * fwv[i]) : detail;
    lg2[i] = med + (base[i] - med) * flatten + (lg[i] - base[i]) * det;
  }
  var qin = pctMasked(toRef(lg2, w, h, px).d, null, PLATE_Q), xs = [qin[0]], ys = [target[0]], k;
  for (k = 1; k < qin.length; k++) {
    var dx = Math.max(qin[k] - xs[xs.length - 1], 1e-3);
    var dy = clamp(target[k] - ys[ys.length - 1], minSlope * dx, maxSlope * dx);
    xs.push(xs[xs.length - 1] + dx); ys.push(ys[ys.length - 1] + dy);
  }
  var s0 = (ys[1] - ys[0]) / (xs[1] - xs[0]), s1 = (ys[ys.length - 1] - ys[ys.length - 2]) / (xs[xs.length - 1] - xs[xs.length - 2]);
  xs = [xs[0] - 6.0].concat(xs).concat([xs[xs.length - 1] + 6.0]);
  ys = [ys[0] - 6.0 * s0].concat(ys).concat([ys[ys.length - 1] + 6.0 * s1]);
  var t = newF(n);
  for (i = 0; i < n; i++) t[i] = clamp(interp1(lg2[i], xs, ys), 0, 1);
  if (sink > 0) {
    var ts = toRef(t, w, h, px), mu = box(ts.d, ts.w, ts.h, 22), m2 = box(mulF(ts.d, ts.d), ts.w, ts.h, 22), flat = newF(mu.length);
    for (i = 0; i < mu.length; i++) {
      var v = m2[i] - mu[i] * mu[i], sd = Math.sqrt(v > 0 ? v : 0);
      flat[i] = (1 - smooth(0.05, 0.13, sd)) * smooth(0.30, 0.75, mu[i]);
    }
    var fl = resizeLinear(gblur(flat, ts.w, ts.h, 18.0), ts.w, ts.h, w, h);
    for (i = 0; i < n; i++) t[i] = t[i] * (1 - sink * fl[i]);
  }
  if (fwv) {
    var tb = gblur(t, w, h, defocus * px);
    for (i = 0; i < n; i++) t[i] = t[i] + (tb[i] - t[i]) * (1 - fwv[i]) * 0.90;
  }
  return t;
}
// rgb (canvas or image) -> themed plate canvas. opts: px, grain (.030), seed (11), focus [x, y, r]
// plus plateValue's knobs
function gradePlate(img, theme, opts) {
  opts = opts || {};
  var th = themeOf(theme), cvn = asCanvas(img), w = cvn.w, h = cvn.h, n = w * h;
  var px = opts.px || w / REF_W, grain = opts.grain == null ? 0.030 : opts.grain, seed = opts.seed == null ? 11 : opts.seed;
  var t = plateValue(cvn.c, w, h, px, opts);
  if (grain > 0) {
    var nz = noise(h, w, seed, 0.5 * px / (1080 / REF_W));
    for (var i = 0; i < n; i++) t[i] = clamp(t[i] + grain * nz[i] * (0.35 + 2.6 * t[i] * (1 - t[i])), 0, 1);
  }
  if (opts.report) opts.report.t = t;
  return { w: w, h: h, c: gradientMap(t, th.plate) };
}
function asCanvas(img) {
  if (img.c) return img;
  var P = splitRGBA(img);
  return { w: img.w, h: img.h, c: P.rgb };
}

// =============================================================================================
// composition helpers: halos, fades, haze, grain (canvas = { w, h, c: [R, G, B] }, in place)
// =============================================================================================
function blendTo(cv, col, k, i) {
  cv.c[0][i] = cv.c[0][i] * (1 - k) + col[0] * k; cv.c[1][i] = cv.c[1][i] * (1 - k) + col[1] * k; cv.c[2][i] = cv.c[2][i] * (1 - k) + col[2] * k;
}
// a layer's alpha on the full canvas grid (x, y rounded like Python round())
function placeAlpha(W, H, alpha, aw, ah, x, y) {
  var out = newF(W * H);
  x = roundHE(x); y = roundHE(y);
  var x0 = Math.max(0, x), y0 = Math.max(0, y), x1 = Math.min(W, x + aw), y1 = Math.min(H, y + ah);
  for (var yy = y0; yy < y1; yy++) for (var xx = x0; xx < x1; xx++) out[yy * W + xx] = alpha[(yy - y) * aw + (xx - x)];
  return out;
}
function alphaOf(img) { var n = img.w * img.h, a = newF(n); for (var i = 0; i < n; i++) a[i] = img.data[i * 4 + 3]; return a; }
// alpha-composite an RGBA image onto a canvas (or onto another RGBA image) at x, y
function over(dst, src, x, y, opacity) {
  if (opacity == null) opacity = 1;
  var W = dst.w, H = dst.h, w = src.w, h = src.h, s = src.data;
  x = roundHE(x || 0); y = roundHE(y || 0);
  var x0 = Math.max(0, x), y0 = Math.max(0, y), x1 = Math.min(W, x + w), y1 = Math.min(H, y + h), xx, yy;
  for (yy = y0; yy < y1; yy++) for (xx = x0; xx < x1; xx++) {
    var si = ((yy - y) * w + (xx - x)) * 4, di = yy * W + xx, al = s[si + 3] * opacity;
    if (dst.c) {
      dst.c[0][di] = s[si] * al + dst.c[0][di] * (1 - al); dst.c[1][di] = s[si + 1] * al + dst.c[1][di] * (1 - al);
      dst.c[2][di] = s[si + 2] * al + dst.c[2][di] * (1 - al);
    } else {
      var dd = dst.data, q = di * 4;
      dd[q] = s[si] * al + dd[q] * (1 - al); dd[q + 1] = s[si + 1] * al + dd[q + 1] * (1 - al); dd[q + 2] = s[si + 2] * al + dd[q + 2] * (1 - al);
      dd[q + 3] = al + dd[q + 3] * (1 - al);
    }
  }
  return dst;
}
// soft DARK shadow around a cut-out (never a light one). near / far = [sigma ref px, strength, spread]
function darkHalo(cv, alphaFull, px, shade, near, far) {
  near = near || [10.0, 0.55, 0.9]; far = far || [40.0, 0.45, 0.35];
  var W = cv.w, H = cv.h, n = W * H, k = newF(n), sh = hex01(shade), pairs = [near, far], i;
  for (var p = 0; p < 2; p++) {
    var hb = gblur(alphaFull, W, H, pairs[p][0] * px), st = pairs[p][1], sp = pairs[p][2];
    for (i = 0; i < n; i++) { var v = clamp(hb[i] * (1 + sp), 0, 1); k[i] = 1 - (1 - k[i]) * (1 - st * v); }
  }
  for (i = 0; i < n; i++) blendTo(cv, sh, clamp(k[i], 0, 0.93), i);
  return cv;
}
// the PLATE near a cut-out is defocused and sunk toward the shade (o.capReach > 0: + lightCap)
function clearance(cv, alphaFull, px, shade, o) {
  o = o || {};
  var reach = o.reach == null ? 26.0 : o.reach, soft = o.soft == null ? 9.0 : o.soft, dark = o.dark == null ? 0.45 : o.dark;
  var amount = o.amount == null ? 0.85 : o.amount, capReach = o.capReach || 0;
  var W = cv.w, H = cv.h, n = W * H, sh = hex01(shade), i, c;
  var zb = gblur(alphaFull, W, H, reach * px * 0.5), soft3 = gblurN(cv.c, W, H, soft * px);
  for (i = 0; i < n; i++) {
    var z = smooth(0.0, 1.0, clamp(zb[i] * 2.2, 0, 1)) * amount;
    for (c = 0; c < 3; c++) { var sunk = soft3[c][i] * (1 - dark) + sh[c] * dark; cv.c[c][i] = cv.c[c][i] * (1 - z) + sunk * z; }
  }
  if (capReach > 0) lightCap(cv, alphaFull, px, shade, { reach: capReach, keep: o.capKeep == null ? 0.12 : o.capKeep, q: o.capQ == null ? 35.0 : o.capQ });
  return cv;
}
// no LIT plate shape near a cut-out: light above the plate's own floor fades with proximity
function lightCap(cv, alphaFull, px, shade, o) {
  o = o || {};
  var reach = o.reach == null ? 90.0 : o.reach, keep = o.keep == null ? 0.12 : o.keep, q = o.q == null ? 35.0 : o.q, gain = o.gain == null ? 2.6 : o.gain;
  var W = cv.w, H = cv.h, n = W * H, sh = hex01(shade), Lsh = F32(lumaOf(sh)), i, c;
  var pb = gblur(alphaFull, W, H, reach * px * 0.5), prox = newF(n), Lc = lumaMap(cv.c), ring = new Uint8Array(n);
  for (i = 0; i < n; i++) {
    prox[i] = clamp(pb[i] * gain, 0, 1) * (alphaFull[i] < 0.98 ? 1 : 0);
    ring[i] = prox[i] > 0.03 && prox[i] < 0.85 && alphaFull[i] < 0.05 && Lc[i] > Lsh + 0.02 ? 1 : 0;
  }
  if (countOf(ring) < 200) return cv;
  var floor = pctMasked(Lc, ring, [q])[0], Ls = gblur(Lc, W, H, 2.0 * px);
  for (i = 0; i < n; i++) {
    var ex = Math.max(Ls[i] - floor, 0.0), T = Math.min(Ls[i], floor) + ex * (1 - prox[i] * (1 - keep));
    var r = clamp((T - Lsh) / Math.max(Ls[i] - Lsh, 1e-4), 0, 1);
    for (c = 0; c < 3; c++) cv.c[c][i] = sh[c] + (cv.c[c][i] - sh[c]) * r;
  }
  return cv;
}
// the GAP between two cut-outs side by side (left alA, right alB) as a soft mask
function pairGap(alA, alB, W, H, px, o) {
  o = o || {};
  var full = o.full == null ? 155.0 : o.full, none = o.none == null ? 205.0 : o.none, feather = o.feather == null ? 14.0 : o.feather;
  var overlap = o.overlap == null ? 12.0 : o.overlap, m = newF(W * H), ov = overlap * px, x, y;
  for (y = 0; y < H; y++) {
    var xa = -1, xb = -1;
    for (x = W - 1; x >= 0; x--) if (alA[y * W + x] > 0.5) { xa = x; break; }
    for (x = 0; x < W; x++) if (alB[y * W + x] > 0.5) { xb = x; break; }
    if (xa < 0 || xb < 0 || !(xb > xa + 2)) continue;
    var rw = smooth(none * px, full * px, xb - xa);
    for (x = 0; x < W; x++) if (x >= xa - ov && x <= xb + ov) m[y * W + x] = rw;
  }
  var g = gblur(m, W, H, feather * px);
  for (var i = 0; i < g.length; i++) g[i] = clamp(g[i], 0, 1);
  return g;
}
// the plate inside a gap mask becomes one continuous, even, DARK, defocused plate
function gapFill(cv, m, px, shade, o) {
  o = o || {};
  var blur = o.blur == null ? 16.0 : o.blur, q = o.q == null ? 20.0 : o.q, keep = o.keep == null ? 0.15 : o.keep;
  var dark = o.dark == null ? 0.30 : o.dark, strength = o.strength == null ? 0.95 : o.strength;
  var W = cv.w, H = cv.h, n = W * H, sh = hex01(shade), Lsh = F32(lumaOf(sh)), i, c, sel = new Uint8Array(n);
  for (i = 0; i < n; i++) sel[i] = m[i] > 0.5 ? 1 : 0;
  if (countOf(sel) < 200) return cv;
  var soft = gblurN(cv.c, W, H, blur * px), Ls = lumaMap(soft), floor = pctMasked(lumaMap(cv.c), sel, [q])[0];
  for (i = 0; i < n; i++) {
    var T = Math.min(Ls[i], floor) + Math.max(Ls[i] - floor, 0.0) * keep;
    T = T * (1 - dark) + Lsh * dark;
    var r = clamp((T - Lsh) / Math.max(Ls[i] - Lsh, 1e-4), 0, 1), wv = m[i] * strength;
    for (c = 0; c < 3; c++) { var ov = sh[c] + (soft[c][i] - sh[c]) * r; cv.c[c][i] = cv.c[c][i] * (1 - wv) + ov * wv; }
  }
  return cv;
}
// a soft weight: 1 LEFT of a cut-out's silhouette, 0 right of it (for patching a second plate crop)
function leftOf(al, W, H, px, o) {
  o = o || {};
  var lead = o.lead == null ? 12.0 : o.lead, trail = o.trail == null ? 18.0 : o.trail, rows = o.rows == null ? 15.0 : o.rows;
  var fillX = o.fillX == null ? null : o.fillX, x, y, i, out = newF(W * H);
  var xl = new Float64Array(H), has = new Uint8Array(H), idx = [];
  for (y = 0; y < H; y++) {
    for (x = 0; x < W; x++) if (al[y * W + x] > 0.5) { xl[y] = x; has[y] = 1; break; }
    if (has[y]) idx.push(y);
  }
  if (!idx.length) { out.fill(1); return out; }
  for (y = 0; y < H; y++) {
    if (has[y]) continue;
    if (fillX != null) { xl[y] = fillX; continue; }
    var p = 0;
    while (p < idx.length && idx[p] < y) p++;
    if (p >= idx.length) p = idx.length - 1;
    xl[y] = xl[idx[p]];
  }
  var r = Math.max(1, Math.floor(rows * px)), mx = new Float64Array(H), sm = new Float64Array(H), j;
  for (y = 0; y < H; y++) { var v = -Infinity; for (j = y - r; j <= y + r; j++) v = Math.max(v, xl[clamp(j, 0, H - 1)]); mx[y] = F32(v); }
  for (y = 0; y < H; y++) { var s = 0; for (j = y - r; j <= y + r; j++) s += mx[clamp(j, 0, H - 1)]; sm[y] = F32(s / (2 * r + 1)); }
  for (y = 0; y < H; y++) for (x = 0; x < W; x++) out[y * W + x] = 1 - smooth(sm[y] - lead * px, sm[y] + trail * px, x);
  return out;
}
// the split between two plate halves as a soft dark line (gaussian profile)
function softSplit(cv, xc, strength, sigma, y0, y1) {
  strength = strength == null ? 0.42 : strength; sigma = sigma == null ? 2.4 : sigma;
  var W = cv.w, H = cv.h, x, y;
  y0 = y0 || 0; y1 = y1 == null ? H : y1;
  for (x = 0; x < W; x++) {
    var k = 1 - strength * Math.exp(-0.5 * ((x - xc) / sigma) * ((x - xc) / sigma));
    for (y = y0; y < y1; y++) { var i = y * W + x; cv.c[0][i] *= k; cv.c[1][i] *= k; cv.c[2][i] *= k; }
  }
  return cv;
}
function rowFade(cv, kOfRow, shade) {
  var W = cv.w, H = cv.h, sh = hex01(shade);
  for (var y = 0; y < H; y++) { var k = kOfRow(y); if (k <= 0) continue; for (var x = 0; x < W; x++) blendTo(cv, sh, k, y * W + x); }
  return cv;
}
function verticalFade(cv, y0, y1, strength, shade, curve) {
  curve = curve == null ? 1.4 : curve;
  return rowFade(cv, function (y) { return Math.pow(clamp((y - y0) / Math.max(y1 - y0, 1), 0, 1), curve) * strength; }, shade);
}
function topFade(cv, y0, y1, strength, shade, curve) {
  curve = curve == null ? 1.2 : curve;
  return rowFade(cv, function (y) { return Math.pow(clamp((y1 - y) / Math.max(y1 - y0, 1), 0, 1), curve) * strength; }, shade);
}
function poolAt(W, x, y, cx, cy, rx, ry) { var a = (x - cx) / rx, b = (y - cy) / ry; return a * a + b * b; }
// soft dark pool (gaussian) behind display type
function localShade(cv, cx, cy, rx, ry, strength, shade) {
  var W = cv.w, H = cv.h, sh = hex01(shade);
  for (var y = 0; y < H; y++) for (var x = 0; x < W; x++) blendTo(cv, sh, Math.exp(-poolAt(W, x, y, cx, cy, rx, ry)) * strength, y * W + x);
  return cv;
}
// a soft elliptical pool where the plate is DEFOCUSED and sunk toward the shade
function localSink(cv, cx, cy, rx, ry, strength, shade, blur, dark, px) {
  blur = blur == null ? 14.0 : blur; dark = dark == null ? 0.60 : dark; px = px == null ? 1080 / REF_W : px;
  var W = cv.w, H = cv.h, sh = hex01(shade), soft = gblurN(cv.c, W, H, blur * px);
  for (var y = 0; y < H; y++) for (var x = 0; x < W; x++) {
    var i = y * W + x, k = Math.exp(-poolAt(W, x, y, cx, cy, rx, ry)) * strength;
    for (var c = 0; c < 3; c++) { var sunk = soft[c][i] * (1 - dark) + sh[c] * dark; cv.c[c][i] = cv.c[c][i] * (1 - k) + sunk * k; }
  }
  return cv;
}
// plate recession: darker away from (cx, cy)
function radialDark(cv, cx, cy, rx, ry, strength, shade) {
  var W = cv.w, H = cv.h, sh = hex01(shade);
  for (var y = 0; y < H; y++) for (var x = 0; x < W; x++) {
    var dd = Math.sqrt(poolAt(W, x, y, cx, cy, rx, ry));
    blendTo(cv, sh, smooth(0.55, 1.35, dd) * strength, y * W + x);
  }
  return cv;
}
// broad soft light BEHIND a head (a big round screen, never silhouette-shaped)
function lightHaze(cv, cx, cy, rx, ry, color, amount) {
  var W = cv.w, H = cv.h, col = hex01(color);
  for (var y = 0; y < H; y++) for (var x = 0; x < W; x++) {
    var i = y * W + x, k = Math.exp(-poolAt(W, x, y, cx, cy, rx, ry) * 1.8) * amount;
    for (var c = 0; c < 3; c++) cv.c[c][i] = 1 - (1 - cv.c[c][i]) * (1 - col[c] * k);
  }
  return cv;
}
// one fine luminance grain over the picture (before the type)
function finalGrain(cv, seed, amount, px) {
  seed = seed == null ? 5 : seed; amount = amount == null ? 0.010 : amount; px = px == null ? 1080 / REF_W : px;
  var W = cv.w, H = cv.h, nz = noise(H, W, seed, 0.5 * px / (1080 / REF_W)), L = lumaMap(cv.c);
  for (var i = 0; i < W * H; i++) {
    var wv = 0.5 + 0.5 * smooth(0.02, 0.25, L[i]) * (1 - smooth(0.75, 1.0, L[i])), add = nz[i] * amount * wv;
    for (var c = 0; c < 3; c++) cv.c[c][i] = clamp(cv.c[c][i] + add, 0, 1);
  }
  return cv;
}
// a cut-out whose matte touches the image border fades toward every such border (posters.edge_ramp)
function edgeRamp(alpha, w, h, px, width) {
  width = width == null ? 70.0 : width;
  var wd = width * px, r = constF(w * h, 1), x, y, lft = false, rgt = false, bot = false;
  for (y = 0; y < h; y++) { if (alpha[y * w] > 0.5) lft = true; if (alpha[y * w + w - 1] > 0.5) rgt = true; }
  for (x = 0; x < w; x++) if (alpha[(h - 1) * w + x] > 0.5) bot = true;
  for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
    var v = 1;
    if (lft) v *= smooth(0, wd, x);
    if (rgt) v *= smooth(0, wd, w - 1 - x);
    if (bot) v *= smooth(0, wd, h - 1 - y);
    r[y * w + x] = v;
  }
  return r;
}

// =============================================================================================
// circle insets
// =============================================================================================
// anti-aliased disk (4x supersampled coverage)
function diskAlpha(d, inner) {
  inner = inner || 0;
  var ss = 4, D = d * ss, r = F32(D / 2.0), thr = F32(d / 2.0 - inner), cov = newF(D * D), x, y;
  var dx2 = new Float32Array(D);
  for (x = 0; x < D; x++) { var dx = F32(F32(x + 0.5) - r); dx2[x] = F32(dx * dx); }
  for (y = 0; y < D; y++) {
    var dy = F32(F32(y + 0.5) - r), dy2 = F32(dy * dy);
    for (x = 0; x < D; x++) cov[y * D + x] = F32(F32(Math.sqrt(F32(dx2[x] + dy2))) / ss) <= thr ? 1 : 0;
  }
  return resizeArea(cov, D, D, d, d);
}
// neutral studio backdrop for a head inside a circle (light behind the head)
function studioSweep(d, tone, tint, seed) {
  tone = tone == null ? 0.30 : tone; tint = tint || [1.0, 1.0, 1.0]; seed = seed == null ? 11 : seed;
  var n = d * d, nz = gblur(noise(d, d, seed), d, d, 1.0), o = [newF(n), newF(n), newF(n)], x, y, df = F32(d);
  for (y = 0; y < d; y++) for (x = 0; x < d; x++) {
    var xx = F32(x / df), yy = F32(y / df), rr = Math.sqrt((xx - 0.5) * (xx - 0.5) + (yy - 0.32) * (yy - 0.32));
    var v = tone * (1.30 - 1.0 * rr), i = y * d + x;
    for (var c = 0; c < 3; c++) o[c][i] = clamp(clamp(v * tint[c], 0, 1) + nz[i] * 0.010, 0, 1);
  }
  return { w: d, h: d, c: o };
}
// a cut-out (already scaled by the caller, e.g. drawImage) framed on a studio sweep, with a soft dark
// contact shadow under it: posters.ufc_head_on_sweep (shade .35, the head's top-left at hx, hy) and
// posters.cut_on_sweep (shade .30, a d x d crop at 0, 0). Returns the d x d canvas.
function headOnSweep(headScaled, hx, hy, d, tone, tint, seed, shade) {
  shade = shade == null ? 0.35 : shade;
  var bg = studioSweep(d, tone == null ? 0.30 : tone, tint, seed), al = placeAlpha(d, d, alphaOf(headScaled), headScaled.w, headScaled.h, hx, hy);
  var gb = gblur(al, d, d, d * 0.03);
  for (var i = 0; i < d * d; i++) { var k = 1 - shade * clamp(gb[i] * 1.3, 0, 1); bg.c[0][i] *= k; bg.c[1][i] *= k; bg.c[2][i] *= k; }
  over(bg, headScaled, hx, hy);
  return bg;
}
// the circle inset: img = square RGB (canvas or image; resized down to d if larger) -> RGBA image
// (d + 2m) with the graded photo in an anti-aliased circle, a thin ring and a soft DARK shadow.
// opts: mode ('inset' grey | 'natural' colour), face, ring (px), ringColor, shadow (.70), seed (5),
// upscale, theme (a cool theme mutes natural reds; a bloodied face goes to the grey look), report.
// Returns { img, m, graded } (graded = the square grade before the circle, for a canvas redraw).
function circleInset(img, d, px, opts) {
  opts = opts || {};
  var mode = opts.mode || "inset", seed = opts.seed == null ? 5 : opts.seed, upscale = opts.upscale || 1;
  var theme = opts.theme || null, shadow = opts.shadow == null ? 0.70 : opts.shadow, ringColor = opts.ringColor || "#FFFFFF";
  var src = asCanvas(img), c = src.c, i;
  if (src.w !== d || src.h !== d) c = [resizeArea(c[0], src.w, src.h, d, d), resizeArea(c[1], src.w, src.h, d, d), resizeArea(c[2], src.w, src.h, d, d)];
  var sq = joinRGBA(c, null, d, d), face = opts.face || [d * 0.22, d * 0.14, d * 0.56, d * 0.66];
  var gopts = { px: px, face: face, seed: seed, upscale: upscale, look: { rim_dark: 0.0, rim_tame: 0.0 }, report: opts.report, fast: opts.fast };
  var g = gradeSubject(sq, mode, gopts);
  if (mode === "natural" && theme && isCool(theme)) {
    var gp = splitRGBA(g);
    if (redShare(gp.rgb) > 0.04) g = gradeSubject(sq, "inset", gopts);
    else g = joinRGBA(coolReds(gp.rgb), gp.a, d, d);
  }
  var ring = opts.ring == null ? Math.max(2.0, 3.0 * px) : opts.ring, m = roundHE(d * 0.14), D = d + 2 * m, x, y;
  var canvas = { w: D, h: D, data: newF(D * D * 4) }, sh = newF(D * D), disk = diskAlpha(d);
  for (y = 0; y < d; y++) for (x = 0; x < d; x++) sh[(y + m) * D + x + m] = disk[y * d + x];
  var shb = gblur(sh, D, D, d * 0.045), roll = Math.floor(d * 0.02);
  for (y = 0; y < D; y++) for (x = 0; x < D; x++) canvas.data[(((y + roll) % D) * D + x) * 4 + 3] = shb[y * D + x] * shadow;
  var rc = hex01(ringColor), ringImg = { w: d, h: d, data: newF(d * d * 4) };
  for (i = 0; i < d * d; i++) { ringImg.data[i * 4] = rc[0]; ringImg.data[i * 4 + 1] = rc[1]; ringImg.data[i * 4 + 2] = rc[2]; ringImg.data[i * 4 + 3] = disk[i]; }
  over(canvas, ringImg, m, m);
  var inner = diskAlpha(d, ring), ph = { w: d, h: d, data: new Float32Array(g.data) };
  for (i = 0; i < d * d; i++) ph.data[i * 4 + 3] = inner[i];
  over(canvas, ph, m, m);
  return { img: canvas, m: m, graded: g };
}

// =============================================================================================
// face box from the page's cut-out analyser (analyse(): head = { cx, cy, w, h, top } in asset px)
// =============================================================================================
// Calibrated (port_g/calib*.mjs) against the lab's hand face boxes (posters.FACES) on 3 UFC studio
// bodies and 4 news cut-outs, running analyse()'s own head code on each asset's alpha:
//   head only : w = .8746 hw, h = 1.1449 hw, centre x = cx + .0267 hw, top = head top + .324 hw
//               mean IoU .62 (UFC .80 / .57 / .72; tall hair lifts the crown: Evloev sits 21 % high)
//   + neck    : w = 1.0565 nw, h = 1.394 nw, centre x = neck centre + .0243 nw,
//               bottom = neck row + .3206 nw   (nw = the neck's width)
//               mean IoU .76 (UFC .83 / .81 / .79, news cuts .63-.82)
// The neck is the narrowest alpha row between top + .9 hw and top + 1.9 hw (neckFromRows); it is
// used only when its width is a plausible .45-1.45 head widths (an arm or a microphone across the
// neck falls back to the head-only model).
var FACE_CAL = { head: { kw: 0.8746, kh: 1.1449, kx: 0.0267, ky: 0.324 }, neck: { nw: 1.0565, nh: 1.394, nx: 0.0243, nb: 0.3206 },
                 neckRatio: [0.45, 1.45] };
// rows = analyse()'s per-row [left, right] spans (undefined where the row is empty), in the same px
// as head; y0 = the first solid row; hw = the head width. Returns { y, w, cx } or null.
function neckFromRows(rows, y0, hw) {
  var best = 1e9, by = -1, y1 = Math.min(rows.length - 1, Math.round(y0 + 1.9 * hw));
  for (var y = Math.round(y0 + 0.9 * hw); y <= y1; y++) {
    var q = rows[y];
    if (!q) continue;
    var wd = q[1] - q[0] + 1;
    if (wd > 0 && wd < best) { best = wd; by = y; }
  }
  if (by < 0) return null;
  return { y: by, w: best, cx: (rows[by][0] + rows[by][1]) / 2 };
}
// head: [cx, cy, headWidth] or analyse()'s object, optionally carrying neckY / neckW / neckCx (asset
// px, from neckFromRows / sc). Returns [x, y, w, h] in asset px, clamped inside the asset.
function faceFromHead(head, assetW, assetH) {
  if (!head) return null;
  var cx, hw, top, fx, fy, fw, fh, C = FACE_CAL;
  if (head.length) { cx = head[0]; hw = head[2]; top = head[1] - 0.65 * hw; }
  else { cx = head.cx; hw = head.w; top = head.top == null ? head.cy - 0.65 * hw : head.top; }
  var nw = head.neckW, useNeck = !head.length && nw > 0 && nw >= C.neckRatio[0] * hw && nw <= C.neckRatio[1] * hw;
  if (useNeck) {
    fw = C.neck.nw * nw; fh = C.neck.nh * nw;
    fx = (head.neckCx == null ? cx : head.neckCx) + C.neck.nx * nw - fw / 2;
    fy = head.neckY + C.neck.nb * nw - fh;
  } else {
    fw = C.head.kw * hw; fh = C.head.kh * hw;
    fx = cx + C.head.kx * hw - fw / 2;
    fy = top + C.head.ky * hw;
  }
  if (assetW) fx = clamp(fx, 0, Math.max(0, assetW - fw));
  if (assetH) fy = clamp(fy, 0, Math.max(0, assetH - fh));
  return [fx, fy, fw, fh];
}

return {
  version: "gritty-1",
  REF_W: REF_W, THEMES: THEMES, THEME_ORDER: THEME_ORDER, TARGETS: TARGETS, GRADE_DEFAULTS: GRADE_DEFAULTS, FACE_CAL: FACE_CAL,
  // primitives
  clamp: clamp, smooth: smooth, lerp: lerp, roundHE: roundHE, hex01: hex01, tanhF: tanhF, exp2F: exp2F,
  box: box, boxWidth: boxWidth, gblur: gblur, mbox: mbox, mblur: mblur, guided: guided,
  resizeArea: resizeArea, resizeLinear: resizeLinear, downF: downF, toRef: toRef,
  quantiles: pctMasked, median: medianMasked, lcValues: lcValues,
  noise: noise, gaussPlane: gaussPlane, textureField: textureField,
  hueDeg: hueDeg, hsvSat: hsvSat, hueMap: hueMap, satMap: satMap, lumaMap: lumaMap, rotMat: rotMat,
  gamutPx: gamutPx, gamutPlanes: gamutPlanes, softclip: softclip,
  pchipLut: pchipLut, fitCurve: fitCurve, curveAt: curveAt, applyCurve: applyCurve, interp1: interp1,
  gradientLut: gradientLut, gradientMap: gradientMap, hsvHex: hsvHex, ramp: ramp, themeOf: themeOf, isCool: isCool,
  ellipseMask: ellipseMask, splitRGBA: splitRGBA, joinRGBA: joinRGBA, resizeRGBA: resizeRGBA, asCanvas: asCanvas, alphaOf: alphaOf,
  // the subject grade and its parts
  gradeSubject: gradeSubject, defringe: defringe, edgeClamp: edgeClamp, edgeMatch: edgeMatch, tameRim: tameRim,
  hairWeight: hairWeight, hairTone: hairTone, smoothHighlights: smoothHighlights, desalt: desalt,
  capTorso: capTorso, tameRidges: tameRidges, popMask: popMask, popColour: popColour,
  kickerZone: kickerZone, healKicker: healKicker, tameKickerRgb: tameKickerRgb, coolReds: coolReds, redShare: redShare,
  // plates and composition
  plateValue: plateValue, gradePlate: gradePlate, placeAlpha: placeAlpha, over: over, darkHalo: darkHalo,
  clearance: clearance, lightCap: lightCap, pairGap: pairGap, gapFill: gapFill, leftOf: leftOf, softSplit: softSplit,
  verticalFade: verticalFade, topFade: topFade, localShade: localShade, localSink: localSink, radialDark: radialDark,
  lightHaze: lightHaze, finalGrain: finalGrain, edgeRamp: edgeRamp,
  // insets
  diskAlpha: diskAlpha, studioSweep: studioSweep, headOnSweep: headOnSweep, circleInset: circleInset,
  faceFromHead: faceFromHead, neckFromRows: neckFromRows
};
}
var GRIT = gritFactory();

// grade_vivid.js inside a factory: the page and the Web Worker each build one (vividLib.toString())
function vividLib() {
// ---------- the vivid grade (port of scratchpad grade2/final_v/look.py, Sept 25 2026) ----------
// The Premier-League card look the owner approved. Pure math: every function here works on
// float images { w, h, data } with data a Float32Array of RGBA in 0..1 (straight alpha), or on
// single Float32Array planes. No DOM. It needs clamp, smooth and boxBlur from the page (the
// parity harness loads the page's own copies).
//   gradeVivid(img, opts)            the subject grade for UFC and news cut-outs
//   gradePhoto(img, mask, box, p)    a news PHOTO kept a natural colour photograph (V3)
//   photoFoot(img)                   the neutral near-black fade that seats the V3 name plate
//   debeltPixels(img)                mirror the bare shoulder over a belt fragment (V1 tiles)
//   headGeometry / faceBoxOf / framePlacement / chestRect   placement from the alpha
// Rules for code that lives in poster_page.js: no backslash, backtick or dollar-brace, ASCII
// only, ES5 (var + function). Any noise comes from a seeded PRNG so a poster is repeatable.

var VIVID = {
  mid: 0.68, maxGain: 1.30, deepGain: 1.10,
  black: 0.030, white: 0.965, scurve: 0.26, shadowLift: 0.80, guardLo: 1.00, liftCap: 1.60,
  sharpen: 0.55, sharpenSigma: 0.85, clarity: 0.55, clarityHw: 0.020, detailLimit: 0.085,
  chromaNr: 0.9, vibrance: 0.34, sat: 1.08, knee: 0.86, hlLumShare: 0.55,
  rimTame: 0.85, kick: 1.0, kickBand: 0.045, kickInner: 0.6, kickRef: 0.070,
  skinRg: 1.42, skinBg: 0.90, wbStrength: 0.60,
  specLo: 0.80, specHi: 0.93, specKeep: 0.40
};
// V3: a real photograph at display size carries more fine texture than a studio tile
var PHOTO_GRADE = { clarity: 0.38, sharpen: 0.45 };
var PHOTO_BG = {
  defocus: 0.0045, gain: 0.86, contrast: 0.16, coolDesat: 0.60, warmVib: 0.18,
  vignette: 0.28, halo: 0.22, hiKnee: 0.22, hiRoll: 0.45
};
function gvParams(base, over) {
  var P = {}, k;
  for (k in base) if (base.hasOwnProperty(k)) P[k] = base[k];
  if (over) for (k in over) if (over.hasOwnProperty(k)) P[k] = over[k];
  return P;
}

// ---------- primitives ----------
// Python's round(): half to even (the blur radii and the placement rounding depend on it)
function gvRound(x) {
  var f = Math.floor(x), d = x - f;
  if (d > 0.5) return f + 1;
  if (d < 0.5) return f;
  return f % 2 === 0 ? f : f + 1;
}
function gvTrunc(x) { return x < 0 ? Math.ceil(x) : Math.floor(x); }
function gvTanh(x) {
  if (x > 19) return 1;
  if (x < -19) return -1;
  var e = Math.exp(2 * x);
  return (e - 1) / (e + 1);
}
// the three box radii whose passes approximate a Gaussian of this sigma
function gvRadii(sigma) {
  var n = 3, wi = Math.sqrt(12 * sigma * sigma / n + 1), wl = Math.floor(wi);
  if (wl % 2 === 0) wl -= 1;
  var wu = wl + 2;
  var m = gvRound((12 * sigma * sigma - n * wl * wl - 4 * n * wl - 3 * n) / (-4 * wl - 4));
  var out = [];
  for (var i = 0; i < n; i++) out.push(((i < m ? wl : wu) - 1) >> 1);
  return out;
}
// Gaussian = 3 separable box passes with edge clamp (boxBlur is the page's)
function gvGauss(src, w, h, sigma) {
  var n = w * h, out = new Float32Array(n);
  if (sigma < 0.4) { out.set(src); return out; }
  var rs = gvRadii(sigma), tmp = new Float32Array(n), first = true;
  for (var i = 0; i < 3; i++) {
    var r = rs[i];
    if (r < 1) continue;
    boxBlur(first ? src : out, w, h, r, out, tmp);
    first = false;
  }
  if (first) out.set(src);
  return out;
}
function gvMul(a, b) {
  var n = a.length, o = new Float32Array(n);
  for (var i = 0; i < n; i++) o[i] = a[i] * b[i];
  return o;
}
// alpha-weighted blur blur(x*wt)/blur(wt): transparent pixels never enter the average.
// den (optional) is gvGauss(wt) when several planes share one weight.
function gvGaussAW(x, wt, w, h, sigma, den) {
  var num = gvGauss(gvMul(x, wt), w, h, sigma);
  if (!den) den = gvGauss(wt, w, h, sigma);
  for (var i = 0; i < num.length; i++) num[i] = num[i] / Math.max(den[i], 1e-4);
  return num;
}
function gvLum(r, g, b) { return 0.2126 * r + 0.7152 * g + 0.0722 * b; }
// numpy percentile, "linear" method (q in 0..100) over a SORTED typed array
function gvPctSorted(v, q) {
  var n = v.length;
  if (!n) return 0;
  var idx = q / 100 * (n - 1), lo = Math.floor(idx), hi = Math.min(n - 1, lo + 1), t = idx - lo;
  var a = v[lo], b = v[hi], d = b - a;
  return t >= 0.5 ? b - d * (1 - t) : a + d * t;
}
function gvSorted(src, sel) {
  var n = 0, i;
  for (i = 0; i < src.length; i++) if (!sel || sel[i]) n++;
  var v = new Float32Array(n), j = 0;
  for (i = 0; i < src.length; i++) if (!sel || sel[i]) v[j++] = src[i];
  v.sort();
  return v;
}
function gvMedianSorted(v) {
  var n = v.length;
  if (!n) return 0;
  if (n % 2) return v[(n - 1) >> 1];
  return (v[n / 2 - 1] + v[n / 2]) / 2;
}
function gvCount(sel) { var c = 0; for (var i = 0; i < sel.length; i++) if (sel[i]) c++; return c; }
function gvMax(a) { var m = -1e30; for (var i = 0; i < a.length; i++) if (a[i] > m) m = a[i]; return m; }

// seeded noise: mulberry32 uniforms, Box-Muller normals
function mulberry32(seed) {
  var t = seed >>> 0;
  return function () {
    t = (t + 0x6D2B79F5) >>> 0;
    var r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}
function gvNormals(n, seed) {
  var rnd = mulberry32(seed), out = new Float32Array(n);
  for (var i = 0; i < n; i += 2) {
    var u = Math.max(rnd(), 1e-12), v = rnd(), m = Math.sqrt(-2 * Math.log(u));
    out[i] = m * Math.cos(2 * Math.PI * v);
    if (i + 1 < n) out[i + 1] = m * Math.sin(2 * Math.PI * v);
  }
  return out;
}

// ---------- float images <-> bytes ----------
// bytes: an RGBA Uint8ClampedArray (ImageData.data). mask/alpha come along as channel 4.
function floatImage(bytes, w, h) {
  var n = w * h, d = new Float32Array(n * 4);
  for (var i = 0; i < n * 4; i++) d[i] = bytes[i] / 255;
  return { w: w, h: h, data: d };
}
// float -> bytes with the 0.6 LSB triangular dither of look.to_img (gradients never band)
function imageBytes(img, out, seed) {
  var n = img.w * img.h, d = img.data, rnd = seed == null ? null : mulberry32(seed);
  for (var i = 0; i < n; i++) {
    var dn = rnd ? (rnd() - rnd()) * (0.6 / 255) : 0, o = i * 4;
    out[o] = Math.floor(clamp(d[o] + dn, 0, 1) * 255 + 0.5);
    out[o + 1] = Math.floor(clamp(d[o + 1] + dn, 0, 1) * 255 + 0.5);
    out[o + 2] = Math.floor(clamp(d[o + 2] + dn, 0, 1) * 255 + 0.5);
    out[o + 3] = Math.floor(clamp(d[o + 3], 0, 1) * 255 + 0.5);
  }
  return out;
}
function gvPlanes(img) {
  var n = img.w * img.h, d = img.data;
  var R = new Float32Array(n), G = new Float32Array(n), B = new Float32Array(n), A = new Float32Array(n);
  for (var i = 0; i < n; i++) { R[i] = d[i * 4]; G[i] = d[i * 4 + 1]; B[i] = d[i * 4 + 2]; A[i] = d[i * 4 + 3]; }
  return { R: R, G: G, B: B, A: A };
}
function gvJoin(w, h, R, G, B, A) {
  var n = w * h, d = new Float32Array(n * 4);
  for (var i = 0; i < n; i++) { d[i * 4] = R[i]; d[i * 4 + 1] = G[i]; d[i * 4 + 2] = B[i]; d[i * 4 + 3] = A ? A[i] : 1; }
  return { w: w, h: h, data: d };
}

// ---------- geometry from the alpha ----------
// crown row, head centre x, head width: the fixed point of the run widths within one head
// width of the crown (a head is ~1.35 widths tall, so it never reaches the shoulders)
function headGeometry(A, w, h) {
  var top = -1, x, y;
  for (y = 0; y < h && top < 0; y++) {
    var c = 0;
    for (x = 0; x < w; x++) if (A[y * w + x] > 0.5) c++;
    if (c >= 3) top = y;
  }
  if (top < 0) return null;
  var sx = 0, sn = 0;
  for (x = 0; x < w; x++) if (A[top * w + x] > 0.5) { sx += x; sn++; }
  var cx0 = sx / sn, widths = [], centres = [];
  for (y = top; y < h; y++) {
    var o = y * w, best = null, bestK = 0, r0 = -1;
    for (x = 0; x <= w; x++) {
      var on = x < w && A[o + x] > 0.5;
      if (on && r0 < 0) r0 = x;
      if (!on && r0 >= 0) {
        var r1 = x - 1, k = (r0 <= cx0 && cx0 <= r1) ? 0 : Math.min(Math.abs(r0 - cx0), Math.abs(r1 - cx0));
        if (best === null || k < bestK) { best = [r0, r1]; bestK = k; }
        r0 = -1;
      }
    }
    if (!best) { widths.push(0); centres.push(cx0); continue; }
    widths.push(best[1] - best[0] + 1);
    centres.push((best[0] + best[1]) / 2);
    if (widths.length < 20) cx0 = centres[centres.length - 1];
  }
  var hw = Math.max(widths[Math.min(4, widths.length - 1)], 4.0);
  for (var it = 0; it < 60; it++) {
    var band = new Float32Array(widths.slice(0, Math.max(3, gvTrunc(hw))));
    band.sort();
    var nw = gvPctSorted(band, 97);
    if (Math.abs(nw - hw) < 0.5) break;
    hw = nw;
  }
  var n = gvTrunc(hw), a0 = gvTrunc(n * 0.3), a1 = Math.max(a0 + 1, gvTrunc(n * 0.9));
  var cs = new Float64Array(centres.slice(a0, a1));
  cs.sort();
  return { top: top, cx: gvMedianSorted(cs), hw: hw, n: n };
}
// forehead-to-chin box [x0, y0, x1, y1] of a head-and-shoulders cut-out (null: no clear head)
function faceBoxOf(A, w, h) {
  var gm = headGeometry(A, w, h);
  if (!gm || gm.hw < 12) return null;
  return [gvTrunc(gm.cx - 0.30 * gm.hw), gvTrunc(gm.top + 0.32 * gm.hw),
          gvTrunc(gm.cx + 0.30 * gm.hw), gvTrunc(gm.top + 1.05 * gm.hw)];
}
// where a source of srcW x srcH lands in a w x h layer: head width = headFrac * w, crown at
// topFrac * h; a source that ends above fillBottom is scaled up (<= maxScale) so the hard crop
// line of a head tile sits under the card's foot. Draw the source at (ox, oy, nw, nh).
function framePlacement(gm, srcW, srcH, w, h, headFrac, topFrac, fillBottom, maxScale, xFrac) {
  fillBottom = fillBottom == null ? 0.96 : fillBottom;
  maxScale = maxScale == null ? 1.25 : maxScale;
  xFrac = xFrac == null ? 0.5 : xFrac;
  var sHead = headFrac * w / gm.hw, need = (fillBottom * h - topFrac * h) / Math.max(srcH - gm.top, 1);
  var s = Math.max(sHead, Math.min(need, sHead * maxScale));
  var nw = Math.max(1, gvRound(srcW * s)), nh = Math.max(1, gvRound(srcH * s));
  var ox = gvRound(xFrac * w - gm.cx * s), oy = gvRound(topFrac * h - gm.top * s);
  return { s: s, nw: nw, nh: nh, ox: ox, oy: oy, crop: oy + nh };
}
// V2 chest crop of a UFC full-body master: [x0, y0, x1, y1] in source pixels
function chestRect(gm, srcW, srcH, headWidths, below) {
  var half = (headWidths == null ? 3.4 : headWidths) * gm.hw / 2;
  below = below == null ? 3.2 : below;
  return [gvTrunc(Math.max(0, gm.cx - half)), gvTrunc(Math.max(0, gm.top - 0.25 * gm.hw)),
          gvTrunc(Math.min(srcW, gm.cx + half)), gvTrunc(Math.min(srcH, gm.top + below * gm.hw))];
}

// ---------- PIL's LANCZOS resample (Pillow Resample.c), so framing matches look.py ----------
// Separable: a horizontal pass, then a vertical one; support 3 x max(scale, 1); coefficients
// normalised per output pixel. gvResampleF is the float path (mode "F", what look.resize_pm
// uses per premultiplied channel, float32 intermediate); gvResample8 is the 8-bit path (mode
// RGB / L, what posters.photo_layer uses) with PIL's 22-bit fixed-point coefficients.
function gvSinc(x) { if (x === 0) return 1; x = x * Math.PI; return Math.sin(x) / x; }
function gvLanczos3(x) { return (x >= -3 && x < 3) ? gvSinc(x) * gvSinc(x / 3) : 0; }
function gvCoeffs(inSize, outSize) {
  var scale = inSize / outSize, fs = Math.max(scale, 1), support = 3 * fs, ks = Math.ceil(support) * 2 + 1;
  var bounds = new Int32Array(outSize * 2), kk = new Float64Array(outSize * ks);
  for (var xx = 0; xx < outSize; xx++) {
    var center = (xx + 0.5) * scale, ww = 0, ss = 1 / fs, x;
    var xmin = gvTrunc(center - support + 0.5), xmax = gvTrunc(center + support + 0.5);
    if (xmin < 0) xmin = 0;
    if (xmax > inSize) xmax = inSize;
    xmax -= xmin;
    for (x = 0; x < xmax; x++) { var wv = gvLanczos3((x + xmin - center + 0.5) * ss); kk[xx * ks + x] = wv; ww += wv; }
    if (ww !== 0) for (x = 0; x < xmax; x++) kk[xx * ks + x] /= ww;
    bounds[xx * 2] = xmin; bounds[xx * 2 + 1] = xmax;
  }
  return { b: bounds, k: kk, n: ks };
}
// src: Float32Array of w * h * ch values (interleaved). Returns a Float32Array nw * nh * ch.
function gvResampleF(src, w, h, ch, nw, nh) {
  var cur = src, cw = w, x, y, c, i;
  if (nw !== w) {
    var C = gvCoeffs(w, nw), tmp = new Float32Array(nw * h * ch);
    for (y = 0; y < h; y++) for (x = 0; x < nw; x++) {
      var x0 = C.b[x * 2], xn = C.b[x * 2 + 1], ko = x * C.n;
      for (c = 0; c < ch; c++) {
        var ss = 0;
        for (i = 0; i < xn; i++) ss += cur[(y * cw + x0 + i) * ch + c] * C.k[ko + i];
        tmp[(y * nw + x) * ch + c] = ss;
      }
    }
    cur = tmp; cw = nw;
  }
  if (nh !== h) {
    var V = gvCoeffs(h, nh), out = new Float32Array(cw * nh * ch);
    for (y = 0; y < nh; y++) {
      var y0 = V.b[y * 2], yn = V.b[y * 2 + 1], vo = y * V.n;
      for (x = 0; x < cw; x++) for (c = 0; c < ch; c++) {
        var sv = 0;
        for (i = 0; i < yn; i++) sv += cur[((y0 + i) * cw + x) * ch + c] * V.k[vo + i];
        out[(y * cw + x) * ch + c] = sv;
      }
    }
    cur = out;
  }
  return cur === src ? new Float32Array(src) : cur;
}
function gvFixed(C) {
  var one = 1 << 22, k = new Float64Array(C.k.length);
  for (var i = 0; i < k.length; i++) k[i] = C.k[i] < 0 ? gvTrunc(-0.5 + C.k[i] * one) : gvTrunc(0.5 + C.k[i] * one);
  return { b: C.b, k: k, n: C.n };
}
function gvClip8(v) { return v >= 1073741824 ? 255 : v <= 0 ? 0 : Math.floor(v / 4194304); }
// src: a Uint8 / Uint8Clamped array of w * h * ch bytes. Returns a Uint8Array nw * nh * ch.
function gvResample8(src, w, h, ch, nw, nh) {
  var cur = src, cw = w, x, y, c, i, half = 1 << 21;
  if (nw !== w) {
    var C = gvFixed(gvCoeffs(w, nw)), tmp = new Uint8Array(nw * h * ch);
    for (y = 0; y < h; y++) for (x = 0; x < nw; x++) {
      var x0 = C.b[x * 2], xn = C.b[x * 2 + 1], ko = x * C.n;
      for (c = 0; c < ch; c++) {
        var ss = half;
        for (i = 0; i < xn; i++) ss += cur[(y * cw + x0 + i) * ch + c] * C.k[ko + i];
        tmp[(y * nw + x) * ch + c] = gvClip8(ss);
      }
    }
    cur = tmp; cw = nw;
  }
  if (nh !== h) {
    var V = gvFixed(gvCoeffs(h, nh)), out = new Uint8Array(cw * nh * ch);
    for (y = 0; y < nh; y++) {
      var y0 = V.b[y * 2], yn = V.b[y * 2 + 1], vo = y * V.n;
      for (x = 0; x < cw; x++) for (c = 0; c < ch; c++) {
        var sv = half;
        for (i = 0; i < yn; i++) sv += cur[((y0 + i) * cw + x) * ch + c] * V.k[vo + i];
        out[(y * cw + x) * ch + c] = gvClip8(sv);
      }
    }
    cur = out;
  }
  return cur === src ? new Uint8Array(src) : cur;
}
// look.frame_subject: scale a cut-out (premultiplied Lanczos, look.resize_pm) and place it in a
// w x h layer by its head (framePlacement). img: { w, h, data } float RGBA. Returns
// { img: the layer, crop: the source's crop row in layer rows, place: the placement }.
function frameLayer(img, gm, w, h, headFrac, topFrac, fillBottom, maxScale, xFrac) {
  var P = framePlacement(gm, img.w, img.h, w, h, headFrac, topFrac, fillBottom, maxScale, xFrac);
  var n = img.w * img.h, pm = new Float32Array(n * 4), d = img.data, i, x, y;
  for (i = 0; i < n; i++) {
    var a = d[i * 4 + 3];
    pm[i * 4] = d[i * 4] * a; pm[i * 4 + 1] = d[i * 4 + 1] * a; pm[i * 4 + 2] = d[i * 4 + 2] * a; pm[i * 4 + 3] = a;
  }
  var sc = gvResampleF(pm, img.w, img.h, 4, P.nw, P.nh), out = new Float32Array(w * h * 4);
  for (y = Math.max(P.oy, 0); y < Math.min(P.oy + P.nh, h); y++) {
    for (x = Math.max(P.ox, 0); x < Math.min(P.ox + P.nw, w); x++) {
      var so = ((y - P.oy) * P.nw + (x - P.ox)) * 4, o = (y * w + x) * 4, al = clamp(sc[so + 3], 0, 1);
      for (var c = 0; c < 3; c++) out[o + c] = al > 1e-4 ? clamp(sc[so + c] / Math.max(al, 1e-4), 0, 1) : 0;
      out[o + 3] = al;
    }
  }
  return { img: { w: w, h: h, data: out }, crop: P.crop, place: P };
}

// ---------- masks ----------
function gvSkinMask(R, G, B, A, w, h, box, loose) {
  var n = w * h, m = new Uint8Array(n), hmin = loose ? 0.06 : 0.18;
  var bx0 = 0, by0 = 0, bx1 = w, by1 = h;
  if (box) {
    bx0 = Math.max(box[0], 0); by0 = Math.max(box[1], 0);
    bx1 = Math.min(Math.max(box[2], 0), w); by1 = Math.min(Math.max(box[3], 0), h);
  }
  for (var y = by0; y < by1; y++) {
    for (var x = bx0; x < bx1; x++) {
      var i = y * w + x, r = R[i], g = G[i], b = B[i];
      if (!(r > g && g > b && A[i] > 0.9)) continue;
      var L = gvLum(r, g, b), mx = Math.max(r, g, b), sat = (mx - Math.min(r, g, b)) / Math.max(mx, 1e-4);
      if (L <= 0.12 || L >= 0.97 || sat <= 0.12 || sat >= 0.78) continue;
      var hue = (g - b) / Math.max(r - b, 1e-4);
      if (hue > hmin && hue < 0.85) m[i] = 1;
    }
  }
  return m;
}

// ---------- the grade steps ----------
// UFC studio mattes carry a pale rim: pull edge colour from the solid interior (only ever
// darker) and choke the alpha a hair, so no light outline survives on any ground
function gvDefringe(p, w, h, sigma) {
  var n = w * h, solid = new Float32Array(n), i;
  for (i = 0; i < n; i++) solid[i] = p.A[i] > 0.97 ? 1 : 0;
  var den = gvGauss(solid, w, h, sigma);
  var eR = gvGaussAW(p.R, solid, w, h, sigma, den), eG = gvGaussAW(p.G, solid, w, h, sigma, den), eB = gvGaussAW(p.B, solid, w, h, sigma, den);
  for (i = 0; i < n; i++) {
    var k = den[i] > 0.02 ? smooth(0.98, 0.45, p.A[i]) : 0;
    if (k > 0) {
      p.R[i] += (Math.min(p.R[i], eR[i]) - p.R[i]) * k;
      p.G[i] += (Math.min(p.G[i], eG[i]) - p.G[i]) * k;
      p.B[i] += (Math.min(p.B[i], eB[i]) - p.B[i]) * k;
    }
    p.A[i] = clamp((p.A[i] - 0.06) / 0.94, 0, 1);
  }
}
// UFC studio KICKER lights lay a pale grey stripe 5-14 px wide down both temples, shoulders
// and arms, and a brightening grade turns it into a silver line hugging the silhouette (a
// light outline, owner law 2). Inside a band ~0-16 px deep every pixel PALER than the skin
// just inside it takes that skin's colour ratio rgb/L, and its local mean is capped at 1.03x
// the skin level (every pixel scaled by the same factor, so pores and hair survive). Dark hair,
// beards, gloves, belts and already-saturated skin are never touched.
function healKicker(p, w, h, hw, P) {
  if (!(P.kick > 0)) return;
  var n = w * h, i, solid = new Float32Array(n);
  for (i = 0; i < n; i++) solid[i] = p.A[i] > 0.5 ? 1 : 0;
  var ga = gvGauss(solid, w, h, Math.max(2.0, P.kickBand * hw));
  var ga2 = gvGauss(solid, w, h, Math.max(3.0, 1.6 * P.kickBand * hw));
  var band = new Float32Array(n), bmax = 0;
  for (i = 0; i < n; i++) {
    var ea = smooth(0.05, 0.5, p.A[i]);
    var b1 = (1 - smooth(0.95, 0.998, ga[i])) * ea, b2 = (1 - smooth(0.95, 0.998, ga2[i])) * ea;
    band[i] = Math.max(b1, P.kickInner * b2);
    if (band[i] > bmax) bmax = band[i];
  }
  if (bmax < 0.05) return;
  var L = new Float32Array(n), sat = new Float32Array(n), rR = new Float32Array(n), rG = new Float32Array(n), rB = new Float32Array(n);
  var sk = gvSkinMask(p.R, p.G, p.B, p.A, w, h, null, true), skw = new Float32Array(n), mw = new Float32Array(n);
  for (i = 0; i < n; i++) {
    var r = p.R[i], g = p.G[i], b = p.B[i], mx = Math.max(r, g, b);
    L[i] = gvLum(r, g, b);
    sat[i] = (mx - Math.min(r, g, b)) / Math.max(mx, 1e-4);
    var li = Math.max(L[i], 1e-3);
    rR[i] = r / li; rG[i] = g / li; rB[i] = b / li;
    skw[i] = sk[i] * solid[i] * smooth(0.997, 0.9995, ga[i]);
    mw[i] = smooth(0.3, 0.9, p.A[i]) + 1e-4;
  }
  var sr = Math.max(3.0, P.kickRef * hw), cov = gvGauss(skw, w, h, sr);
  var Lref = gvGaussAW(L, skw, w, h, sr, cov), sref = gvGaussAW(sat, skw, w, h, sr, cov);
  var fR = gvGaussAW(rR, skw, w, h, sr, cov), fG = gvGaussAW(rG, skw, w, h, sr, cov), fB = gvGaussAW(rB, skw, w, h, sr, cov);
  var dm = gvGauss(mw, w, h, 1.3), Lm = gvGaussAW(L, mw, w, h, 1.3, dm), sm = gvGaussAW(sat, mw, w, h, 1.3, dm);
  var wk = new Float32Array(n);
  for (i = 0; i < n; i++) {
    var pale = smooth(0.15, 0.50, 1 - sm[i] / Math.max(sref[i], 0.05));
    var bright = smooth(-0.15, -0.04, Lm[i] - Lref[i]);
    wk[i] = band[i] * smooth(0.01, 0.06, cov[i]) * pale * bright * P.kick;
  }
  wk = gvGauss(wk, w, h, 1.0);
  for (i = 0; i < n; i++) {
    var t = clamp(wk[i], 0, 1), k = Math.min(1.0, (Lref[i] * 1.03 + 0.01) / Math.max(Lm[i], 1e-4));
    var Ln = L[i] * (1 + (k - 1) * t);
    p.R[i] = clamp((rR[i] + (fR[i] - rR[i]) * t) * Ln, 0, 1);
    p.G[i] = clamp((rG[i] + (fG[i] - rG[i]) * t) * Ln, 0, 1);
    p.B[i] = clamp((rB[i] + (fB[i] - rB[i]) * t) * Ln, 0, 1);
  }
}
// Clipped skin highlights (a studio or arena sheen on a forehead or scalp) rebuilt from the
// surrounding skin: colour ratio and level from an alpha-weighted blur that excludes the
// sheen, spec_keep of its extra light kept, and band-pass noise at the skin's own fine-detail
// RMS for pores. Above the brows only, only where skin surrounds it.
function healSpecular(p, w, h, hw, P, zoneY1, normals) {
  var n = w * h, i, x, y;
  var sk = gvSkinMask(p.R, p.G, p.B, p.A, w, h, null, true);
  var L = new Float32Array(n), s = new Float32Array(n), skf = new Float32Array(n), op = new Float32Array(n);
  for (i = 0; i < n; i++) {
    var r = p.R[i], g = p.G[i], b = p.B[i];
    L[i] = gvLum(r, g, b);
    s[i] = p.A[i] > 0.9 ? smooth(P.specLo, P.specHi, Math.min(r, g, b)) : 0;
    skf[i] = sk[i];
    op[i] = p.A[i] > 0.5 ? 1 : 0;
  }
  if (zoneY1 != null) {
    for (y = 0; y < h; y++) {
      var zk = 1 - smooth(zoneY1 - 0.04 * hw, zoneY1, y);
      for (x = 0; x < w; x++) s[y * w + x] *= zk;
    }
  }
  var sig = Math.max(2.0, 0.06 * hw), ns = gvGauss(skf, w, h, sig), no = gvGauss(op, w, h, sig);
  for (i = 0; i < n; i++) s[i] *= smooth(0.25, 0.55, ns[i] / Math.max(no[i], 1e-3));
  if (gvMax(s) < 0.05) return false;
  s = gvGauss(s, w, h, 1.0);
  var wgt = new Float32Array(n);
  for (i = 0; i < n; i++) { s[i] = clamp(s[i] * 1.3, 0, 1); wgt[i] = skf[i] * (1 - s[i]); }
  var sf = Math.max(3.0, 0.05 * hw), gw = gvGauss(wgt, w, h, sf);
  var rR = new Float32Array(n), rG = new Float32Array(n), rB = new Float32Array(n);
  for (i = 0; i < n; i++) {
    s[i] *= smooth(0.03, 0.12, gw[i]);
    var li = Math.max(L[i], 1e-3);
    rR[i] = p.R[i] / li; rG[i] = p.G[i] / li; rB[i] = p.B[i] / li;
  }
  var fR = gvGaussAW(rR, wgt, w, h, sf, gw), fG = gvGaussAW(rG, wgt, w, h, sf, gw), fB = gvGaussAW(rB, wgt, w, h, sf, gw);
  var Lsur = gvGaussAW(L, wgt, w, h, sf, gw), gl = gvGauss(L, w, h, 1.0), f2 = new Float32Array(n);
  for (i = 0; i < n; i++) { var fi = L[i] - gl[i]; f2[i] = fi * fi; }
  var amp = gvGaussAW(f2, wgt, w, h, sf, gw);
  var nz = normals || gvNormals(n, 7), n1 = gvGauss(nz, w, h, 0.6), n2 = gvGauss(nz, w, h, 1.6), sum = 0, sq = 0;
  for (i = 0; i < n; i++) { n1[i] -= n2[i]; sum += n1[i]; }
  var mean = sum / n;
  for (i = 0; i < n; i++) { var dd = n1[i] - mean; sq += dd * dd; }
  var sd = Math.max(Math.sqrt(sq / n), 1e-4);
  for (i = 0; i < n; i++) {
    if (s[i] <= 0) continue;
    var Ln = Lsur[i] + P.specKeep * Math.max(L[i] - Lsur[i], 0) + 0.9 * Math.sqrt(Math.max(amp[i], 0)) * n1[i] / sd;
    var t = s[i];
    p.R[i] += (clamp(fR[i] * Ln, 0, 1) - p.R[i]) * t;
    p.G[i] += (clamp(fG[i] * Ln, 0, 1) - p.G[i]) * t;
    p.B[i] += (clamp(fB[i] * Ln, 0, 1) - p.B[i]) * t;
  }
  return true;
}
// the luminance curve after levels: gamma, S-curve, shadow opening, output range
function gvTone(x, gam, P) {
  var y = Math.pow(clamp(x, 0, 1), gam);
  y = y + P.scurve * (y * y * (3 - 2 * y) - y);
  var q = 1 - y;
  y = y + P.shadowLift * y * q * q * q * q;
  return P.black + (P.white - P.black) * clamp(y, 0, 1);
}
function gvSmax(a, b) { var d = a - b; return 0.5 * (a + b + Math.sqrt(d * d + 0.015 * 0.015)); }
function gvSmin(a, b) { var d = a - b; return 0.5 * (a + b - Math.sqrt(d * d + 0.015 * 0.015)); }
// Soft highlight gamut: the max channel rolls toward ceil (tanh) above the knee. lumShare of
// that reduction scales the whole pixel (hue + saturation kept), the rest compresses chroma
// toward luminance, so bright skin goes warm-white with texture, never flat salmon or chalk.
function gamutFit(R, G, B, n, knee, ceil, lumShare) {
  var i, span = ceil - knee;
  for (i = 0; i < n; i++) {
    var r = R[i], g = G[i], b = B[i], mx = Math.max(r, g, b);
    if (knee < 1 && lumShare > 0 && mx > knee) {
      var mt0 = knee + span * gvTanh((mx - knee) / span);
      var sc = Math.pow(clamp(mt0 / Math.max(mx, 1e-4), 1e-4, 1), lumShare);
      r *= sc; g *= sc; b *= sc; mx = Math.max(r, g, b);
    }
    var Ly = clamp(gvLum(r, g, b), 0, 1), mt;
    if (knee < 1) {
      var kk = Math.max(knee, Ly + 1e-3), sp2 = Math.max(ceil - kk, 1e-3);
      mt = mx > kk ? kk + sp2 * gvTanh((mx - kk) / sp2) : mx;
    } else mt = Math.min(mx, 1);
    var k = mx > Ly + 1e-4 ? clamp((mt - Ly) / Math.max(mx - Ly, 1e-4), 0, 1) : 1;
    r = Ly + (r - Ly) * k; g = Ly + (g - Ly) * k; b = Ly + (b - Ly) * k;
    var mn = Math.min(r, g, b);
    var k2 = mn < 0 ? clamp(Ly / Math.max(Ly - mn, 1e-4), 0, 1) : 1;
    R[i] = clamp(Ly + (r - Ly) * k2, 0, 1); G[i] = clamp(Ly + (g - Ly) * k2, 0, 1); B[i] = clamp(Ly + (b - Ly) * k2, 0, 1);
  }
}

// ---------- gradeVivid ----------
// Bright, crisp, clean subject grade, run at DISPLAY size on a straight-alpha RGBA float image.
// Adaptive: it meters the face skin and moves it to fixed targets, so a dark Getty photo and a
// flat UFC studio cut-out land in the same place. Tone is one luminance curve applied as a
// RATIO (hue and saturation survive) that can never darken and never lifts a shadow past
// liftCap. Detail is added equally to R, G and B, so sharpening never amplifies chroma.
// opts: params (overrides of VIVID), faceBox [x0,y0,x1,y1], fringe (false for a photo: no
// defringe, no kicker heal), normals (Float32Array w*h standard normals for the specular
// pores; default mulberry32 seed 7). Returns { w, h, data } RGBA (alpha = the choked alpha).
function gradeVivid(img, opts) {
  opts = opts || {};
  var P = gvParams(VIVID, opts.params), fringe = opts.fringe !== false;
  var w = img.w, h = img.h, n = w * h, i, x, y, c;
  var p = gvPlanes(img), R = p.R, G = p.G, B = p.B, A = p.A;
  if (fringe) gvDefringe(p, w, h, 1.6);
  var y0 = -1, y1 = -1;
  for (y = 0; y < h; y++) for (x = 0; x < w; x++) if (A[y * w + x] > 0.5) { if (y0 < 0) y0 = y; y1 = y; break; }
  var subjH = y0 >= 0 ? y1 - y0 + 1 : h;
  var box = opts.faceBox || faceBoxOf(A, w, h);
  var hw = box ? (box[2] - box[0]) / 0.6 : 0.25 * subjH;

  // 1. adaptive skin white balance (a diagonal 3x3), weighted by warmth and a yellow lean,
  //    so dark brown hair (g ~ b) never turns mauve
  var sk = gvSkinMask(R, G, B, A, w, h, null, true), ns = gvCount(sk);
  if (ns > 200) {
    var mr = 0, mg = 0, mb = 0;
    for (i = 0; i < n; i++) if (sk[i]) { mr += R[i]; mg += G[i]; mb += B[i]; }
    mr /= ns; mg /= ns; mb /= ns;
    var gr = clamp(Math.pow(P.skinRg * mg / Math.max(mr, 1e-4), P.wbStrength), 0.85, 1.12);
    var gb = clamp(Math.pow(P.skinBg * mg / Math.max(mb, 1e-4), P.wbStrength), 0.88, 1.15);
    for (i = 0; i < n; i++) {
      var r0 = Math.max(R[i], 1e-4);
      var warm = clamp((R[i] - B[i]) / r0 / 0.25, 0, 1) * smooth(0.03, 0.12, (G[i] - B[i]) / r0);
      R[i] *= 1 + (gr - 1) * warm; B[i] *= 1 + (gb - 1) * warm;
    }
  }
  // 1b. studio kicker stripes take the colour and exposure of the skin inside them
  if (fringe) healKicker(p, w, h, hw, P);
  // 2. clipped forehead / scalp sheen rebuilt from the skin around it (above the brows)
  healSpecular(p, w, h, hw, P, box ? box[1] + 0.12 * hw : null, opts.normals);

  // 3. exposure metered on FACE skin: the target is never below the skin's own median, and
  //    deep skin is lifted gently (gain eases 1.30 -> 1.10 as the median falls .50 -> .34)
  var L = new Float32Array(n), m = new Uint8Array(n);
  for (i = 0; i < n; i++) { L[i] = gvLum(R[i], G[i], B[i]); m[i] = A[i] > 0.5 ? 1 : 0; }
  var anyM = gvCount(m) > 0, sLm = gvSorted(L, anyM ? m : null);
  var pLo = gvPctSorted(sLm, 0.5), pHi = gvPctSorted(sLm, 99.5);
  var skAll = gvSkinMask(R, G, B, A, w, h, null, false), skFace = box ? gvSkinMask(R, G, B, A, w, h, box, false) : skAll;
  var medAll = gvCount(skAll) > 200 ? gvMedianSorted(gvSorted(L, skAll)) : gvMedianSorted(sLm);
  var medFace = gvCount(skFace) > 200 ? gvMedianSorted(gvSorted(L, skFace)) : medAll;
  var pMid = Math.min(medFace, medAll * 1.35);
  var depth = clamp((0.50 - pMid) / 0.16, 0, 1), gain = P.maxGain + (P.deepGain - P.maxGain) * depth;
  var target = Math.max(pMid, Math.min(pMid * gain, P.mid));
  // the highlights are stretched at most as much as the skin is lifted
  var gEff = target / Math.max(pMid, 1e-3);
  P.white = clamp(pHi * gEff * 1.03, Math.min(pHi, P.white), P.white);

  // 4. levels + a gamma solved by bisection so the skin median lands exactly on the target
  var rng = Math.max(pHi - pLo, 1e-3), xm = clamp((pMid - pLo) / rng, 1e-3, 0.999), g0 = 0.25, g1 = 3.0;
  for (i = 0; i < 40; i++) {
    var gm = Math.sqrt(g0 * g1);
    if (gvTone(xm, gm, P) > target) g0 = gm; else g1 = gm;
  }
  var gam = Math.sqrt(g0 * g1), Y = new Float32Array(n);
  for (i = 0; i < n; i++) {
    var l = L[i], t = gvTone((l - pLo) / rng, gam, P);
    // the guards: never darker than the source, never lifted past liftCap (no ashy shadows)
    t = gvSmax(t, l * (P.guardLo + (1 - P.guardLo) * smooth(0.06, 0.25, l)));
    Y[i] = gvSmin(t, Math.max(l * P.liftCap, l + 0.03));
  }
  // 4b. rim tamer: inside a band ~3% of the head width from the silhouette, luminance above
  //     the interior level is pulled most of the way back (a thin safety net behind 1b)
  if (P.rimTame > 0) {
    var ga = gvGauss(A, w, h, Math.max(1.5, 0.032 * hw)), iw = new Float32Array(n);
    for (i = 0; i < n; i++) iw[i] = A[i] > 0.9 ? smooth(0.85, 0.99, ga[i]) : 0;
    var yin = gvGaussAW(Y, iw, w, h, Math.max(2.0, 0.05 * hw));
    for (i = 0; i < n; i++) {
      var bnd = clamp(A[i], 0, 1) * (1 - smooth(0.60, 0.97, ga[i]));
      Y[i] = Y[i] - P.rimTame * bnd * Math.max(Y[i] - yin[i], 0);
    }
  }
  // 5. recompose: a ratio in the mids and highlights, ADDITIVE in the deep shadows (a ratio of
  //    4 on a near-black coloured pixel is how pupils turn blue)
  for (i = 0; i < n; i++) {
    var l5 = L[i], ratio = clamp(Y[i] / Math.max(l5, 1e-4), 0, 4), add = Y[i] - l5, wr = smooth(0.03, 0.14, l5);
    R[i] = R[i] + add + (R[i] * ratio - R[i] - add) * wr;
    G[i] = G[i] + add + (G[i] * ratio - G[i] - add) * wr;
    B[i] = B[i] + add + (B[i] * ratio - B[i] - add) * wr;
  }
  // 6. detail on LUMINANCE, added equally to R, G and B: a fine sharpen + clarity (pores,
  //    stubble), midtone weighted, soft-limited with tanh, none right at the matte edge
  var wA = new Float32Array(n);
  for (i = 0; i < n; i++) { wA[i] = clamp(A[i], 0, 1); Y[i] = gvLum(R[i], G[i], B[i]); }
  var dA = gvGauss(wA, w, h, P.sharpenSigma), bS = gvGaussAW(Y, wA, w, h, P.sharpenSigma, dA);
  var bC = gvGaussAW(Y, wA, w, h, Math.max(1.2, P.clarityHw * hw)), inner = gvGauss(wA, w, h, 1.2), lim = P.detailLimit;
  for (i = 0; i < n; i++) {
    var yv = Y[i], midw = Math.pow(clamp(4 * yv * (1 - yv), 0, 1), 0.7);
    var d = P.sharpen * (yv - bS[i]) * (0.4 + 0.6 * midw) + P.clarity * (yv - bC[i]) * midw;
    d = lim * gvTanh(d / lim) * smooth(0.55, 0.98, inner[i]);
    R[i] += d; G[i] += d; B[i] += d;
  }
  // 7. vibrance + saturation around luminance; near-neutrals (eye whites, teeth) and deep
  //    shadows (lids, nostrils, beard roots) get no boost
  for (i = 0; i < n; i++) {
    var r7 = R[i], g7 = G[i], b7 = B[i], Ly = gvLum(r7, g7, b7), mx7 = Math.max(r7, g7, b7);
    var sv = (mx7 - Math.min(r7, g7, b7)) / Math.max(mx7, 1e-4);
    var vw = smooth(0.05, 0.16, sv) * (1 - clamp(sv / 0.55, 0, 1));
    var gs = 1 + (P.sat * (1 + P.vibrance * vw) - 1) * smooth(0.04, 0.14, Ly);
    R[i] = Ly + (r7 - Ly) * gs; G[i] = Ly + (g7 - Ly) * gs; B[i] = Ly + (b7 - Ly) * gs;
  }
  // 8. chroma noise reduction: blur only the colour-difference channels (luminance keeps
  //    every pore): no blue specks in pupils, no red lids
  var cR = new Float32Array(n), cG = new Float32Array(n), cB = new Float32Array(n);
  for (i = 0; i < n; i++) { Y[i] = gvLum(R[i], G[i], B[i]); cR[i] = R[i] - Y[i]; cG[i] = G[i] - Y[i]; cB[i] = B[i] - Y[i]; }
  var dN = gvGauss(wA, w, h, P.chromaNr);
  cR = gvGaussAW(cR, wA, w, h, P.chromaNr, dN); cG = gvGaussAW(cG, wA, w, h, P.chromaNr, dN); cB = gvGaussAW(cB, wA, w, h, P.chromaNr, dN);
  for (i = 0; i < n; i++) { R[i] = Y[i] + cR[i]; G[i] = Y[i] + cG[i]; B[i] = Y[i] + cB[i]; }
  // 9. soft highlight gamut above the knee
  gamutFit(R, G, B, n, P.knee, 0.985, P.hlLumShare);
  return gvJoin(w, h, R, G, B, A);
}

// ---------- gradePhoto (V3) ----------
// A news PHOTO in the vivid look, kept a NATURAL colour photograph (PL ref 13).
//   subject (mask): gradeVivid metered on the face box, no defringe (it is not a matte)
//   room          : the same photograph with a mild ALPHA-WEIGHTED defocus (a plain blur
//                   smears the bright head into the backdrop = a light halo), a gentle S and
//                   x gain, press-wall highlights rolled off above hiKnee, cool hues (170-260
//                   deg) lose coolDesat of their chroma (a navy wall becomes charcoal and can
//                   never pair with a warm theme), warm hues get a little vibrance, a natural
//                   vignette and a soft DARK halo behind the subject
// img: { w, h, data } RGBA (alpha ignored), mask: Float32Array w*h subject coverage 0..1,
// box: face box [x0, y0, x1, y1]. Returns an opaque { w, h, data }.
function gradePhoto(img, mask, box, params, bgParams, normals) {
  var Bp = gvParams(PHOTO_BG, bgParams), w = img.w, h = img.h, n = w * h, i, x, y;
  var p = gvPlanes(img), R = p.R, G = p.G, B = p.B;
  var sub = gradeVivid(gvJoin(w, h, R, G, B, mask), { params: params, faceBox: box, fringe: false, normals: normals });
  var mg = gvGauss(mask, w, h, 0.8), wb = new Float32Array(n);
  for (i = 0; i < n; i++) { mg[i] = clamp(mg[i], 0, 1); wb[i] = clamp(1 - mask[i], 0, 1); }
  var sg = Bp.defocus * w, dW = gvGauss(wb, w, h, sg);
  var bR = gvGaussAW(R, wb, w, h, sg, dW), bG = gvGaussAW(G, wb, w, h, sg, dW), bB = gvGaussAW(B, wb, w, h, sg, dW);
  var Lb = new Float32Array(n), bgm = new Uint8Array(n);
  for (i = 0; i < n; i++) {
    var k0 = 1 - mg[i];
    bR[i] = R[i] + (bR[i] - R[i]) * k0; bG[i] = G[i] + (bG[i] - G[i]) * k0; bB[i] = B[i] + (bB[i] - B[i]) * k0;
    Lb[i] = gvLum(bR[i], bG[i], bB[i]);
    bgm[i] = mg[i] < 0.5 ? 1 : 0;
  }
  var lo = 0, hi = 1;
  if (gvCount(bgm)) { var sb = gvSorted(Lb, bgm); lo = gvPctSorted(sb, 1); hi = gvPctSorted(sb, 99.5); }
  var fx = 0.5 * (box[0] + box[2]) / w, fy = 0.5 * (box[1] + box[3]) / h;
  var hal = gvGauss(mask, w, h, 0.035 * w), out = new Float32Array(n * 4), sd = sub.data;
  for (y = 0; y < h; y++) {
    for (x = 0; x < w; x++) {
      i = y * w + x;
      var lb = Lb[i], xx = clamp((lb - lo) / Math.max(hi - lo, 1e-3), 0, 1);
      var yy = xx + Bp.contrast * (xx * xx * (3 - 2 * xx) - xx);
      yy = (lo + (hi - lo) * yy) * Bp.gain;
      yy = yy - Bp.hiRoll * Math.max(yy - Bp.hiKnee, 0);
      var ratio = clamp(yy / Math.max(lb, 1e-4), 0, 3), wr = smooth(0.03, 0.12, lb), ad = yy - lb;
      var r = bR[i] + ad + (bR[i] * ratio - bR[i] - ad) * wr;
      var g = bG[i] + ad + (bG[i] * ratio - bG[i] - ad) * wr;
      var b = bB[i] + ad + (bB[i] * ratio - bB[i] - ad) * wr;
      // colour: hue in degrees from plain RGB maths, chroma scaled around luminance
      var mx = Math.max(r, g, b), mn = Math.min(r, g, b), c = Math.max(mx - mn, 1e-5), hue;
      if (mx === r) { hue = (g - b) / c; hue = hue - 6 * Math.floor(hue / 6); }
      else if (mx === g) hue = (b - r) / c + 2;
      else hue = (r - g) / c + 4;
      hue *= 60;
      var cool = smooth(150, 185, hue) * (1 - smooth(255, 285, hue));
      var warmH = 1 - smooth(55, 80, hue) * (1 - smooth(330, 345, hue));
      var satv = c / Math.max(mx, 1e-4);
      var k = (1 - Bp.coolDesat * cool) * (1 + Bp.warmVib * warmH * (1 - clamp(satv / 0.7, 0, 1)));
      var Ly = gvLum(r, g, b);
      r = Ly + (r - Ly) * k; g = Ly + (g - Ly) * k; b = Ly + (b - Ly) * k;
      // natural vignette around the face and a soft dark halo behind the subject
      var du = x / w - fx, dv = (y / h - fy) * 0.85, rr0 = Math.sqrt(du * du + dv * dv);
      var vk = (1 - Bp.vignette * smooth(0.30, 0.95, rr0)) * (1 - Bp.halo * clamp(hal[i] * 1.6, 0, 1));
      r *= vk; g *= vk; b *= vk;
      var t = mg[i], o = i * 4;
      out[o] = clamp(r + (sd[o] - r) * t, 0, 1);
      out[o + 1] = clamp(g + (sd[o + 1] - g) * t, 0, 1);
      out[o + 2] = clamp(b + (sd[o + 2] - b) * t, 0, 1);
      out[o + 3] = 1;
    }
  }
  return { w: w, h: h, data: out };
}
// the NEUTRAL near-black fade over the bottom of the V3 photo (ref 14's black fade): it seats
// the name plate, never reaches the face and carries no theme colour. In place.
function photoFoot(img, k, from) {
  k = k == null ? 0.78 : k; from = from == null ? 0.78 : from;
  var w = img.w, h = img.h, d = img.data, col = [0.035, 0.033, 0.04];
  for (var y = 0; y < h; y++) {
    var t = k * smooth(from, 1.0, h > 1 ? y / (h - 1) : 0);
    if (t <= 0) continue;
    for (var x = 0; x < w; x++) {
      var o = (y * w + x) * 4;
      for (var c = 0; c < 3; c++) d[o + c] += (col[c] - d[o + c]) * t;
    }
  }
  return img;
}

// ---------- debelt (V1 tiles) ----------
// A championship belt resting on one shoulder shows only as a fragment at card size: gold or
// black-leather pixels below the chin and beside the head column mark it, and the bare
// shoulder is mirrored across the head's centre line from just above the belt's top. The seam
// starts 0.10 head widths off-centre and walks across the sternum lower down (following the
// strap); the blend is premultiplied and feathered; the face is never touched. Returns a new
// image (the same pixels when no belt is found).
function debeltPixels(img) {
  var w = img.w, h = img.h, n = w * h, d = img.data, i, x, y;
  var A = new Float32Array(n);
  for (i = 0; i < n; i++) A[i] = d[i * 4 + 3];
  var gm = headGeometry(A, w, h);
  if (!gm) return img;
  var top = gm.top, cx = gm.cx, hw = gm.hw, cand = new Uint8Array(n), left = 0, right = 0;
  for (y = 0; y < h; y++) {
    if (!(y > top + 0.95 * hw)) continue;
    for (x = 0; x < w; x++) {
      i = y * w + x;
      if (!(A[i] > 0.5)) continue;
      var r = d[i * 4], g = d[i * 4 + 1], b = d[i * 4 + 2], mx = Math.max(r, g, b);
      var sat = (mx - Math.min(r, g, b)) / Math.max(mx, 1e-4), hue = (g - b) / Math.max(r - b, 1e-4);
      var gold = sat > 0.45 && hue > 0.6 && r >= g, leather = gvLum(r, g, b) < 0.12 && sat < 0.35;
      if (!(gold || leather)) continue;
      cand[i] = 1;
      if (x < cx - 0.25 * hw) left++;
      if (x > cx + 0.25 * hw) right++;
    }
  }
  if (Math.max(left, right) < 0.02 * hw * hw) return img;
  var side = left > right ? -1 : 1, rmin = -1;
  for (y = 0; y < h && rmin < 0; y++) {
    var cnt = 0;
    for (x = 0; x < w; x++) if (cand[y * w + x] && (x - cx) * side > 0.25 * hw) cnt++;
    if (cnt > 2) rmin = y;
  }
  // every pixel goes through the premultiplied mix (t = 0 keeps it; a fully transparent pixel
  // comes out black, exactly like the numpy version)
  var yb = rmin - 0.06 * hw, out = new Float32Array(d.length);
  for (y = 0; y < h; y++) {
    var wy = smooth(yb - 0.08 * hw, yb, y);
    var off = clamp(0.10 * hw - 0.45 * Math.max(y - (yb + 0.20 * hw), 0), -0.22 * hw, 0.10 * hw), seam = cx + side * off;
    for (x = 0; x < w; x++) {
      var t = wy * smooth(0.0, 0.08 * hw, (x - seam) * side);
      var xs = clamp(gvRound(2 * cx - x), 0, w - 1), o = (y * w + x) * 4, om = (y * w + xs) * 4;
      var a0 = d[o + 3], a1 = d[om + 3], pa = a0 + (a1 - a0) * t;
      for (var c = 0; c < 3; c++) {
        var pc = d[o + c] * a0 + (d[om + c] * a1 - d[o + c] * a0) * t;
        out[o + c] = pa > 1e-4 ? pc / Math.max(pa, 1e-4) : 0;
      }
      out[o + 3] = pa;
    }
  }
  return { w: w, h: h, data: out };
}

return {
    gvParams: gvParams,
    gvRound: gvRound,
    gvTrunc: gvTrunc,
    gvTanh: gvTanh,
    gvRadii: gvRadii,
    gvGauss: gvGauss,
    gvMul: gvMul,
    gvGaussAW: gvGaussAW,
    gvLum: gvLum,
    gvPctSorted: gvPctSorted,
    gvSorted: gvSorted,
    gvMedianSorted: gvMedianSorted,
    gvCount: gvCount,
    gvMax: gvMax,
    mulberry32: mulberry32,
    gvNormals: gvNormals,
    floatImage: floatImage,
    imageBytes: imageBytes,
    gvPlanes: gvPlanes,
    gvJoin: gvJoin,
    headGeometry: headGeometry,
    faceBoxOf: faceBoxOf,
    framePlacement: framePlacement,
    chestRect: chestRect,
    gvSinc: gvSinc,
    gvLanczos3: gvLanczos3,
    gvCoeffs: gvCoeffs,
    gvResampleF: gvResampleF,
    gvFixed: gvFixed,
    gvClip8: gvClip8,
    gvResample8: gvResample8,
    frameLayer: frameLayer,
    gvSkinMask: gvSkinMask,
    gvDefringe: gvDefringe,
    healKicker: healKicker,
    healSpecular: healSpecular,
    gvTone: gvTone,
    gvSmax: gvSmax,
    gvSmin: gvSmin,
    gamutFit: gamutFit,
    gradeVivid: gradeVivid,
    gradePhoto: gradePhoto,
    photoFoot: photoFoot,
    debeltPixels: debeltPixels,
    VIVID: VIVID,
    PHOTO_GRADE: PHOTO_GRADE,
    PHOTO_BG: PHOTO_BG
  };
}
var GVL = vividLib();
var gvParams = GVL.gvParams;
var gvRound = GVL.gvRound;
var gvTrunc = GVL.gvTrunc;
var gvTanh = GVL.gvTanh;
var gvRadii = GVL.gvRadii;
var gvGauss = GVL.gvGauss;
var gvMul = GVL.gvMul;
var gvGaussAW = GVL.gvGaussAW;
var gvLum = GVL.gvLum;
var gvPctSorted = GVL.gvPctSorted;
var gvSorted = GVL.gvSorted;
var gvMedianSorted = GVL.gvMedianSorted;
var gvCount = GVL.gvCount;
var gvMax = GVL.gvMax;
var mulberry32 = GVL.mulberry32;
var gvNormals = GVL.gvNormals;
var floatImage = GVL.floatImage;
var imageBytes = GVL.imageBytes;
var gvPlanes = GVL.gvPlanes;
var gvJoin = GVL.gvJoin;
var headGeometry = GVL.headGeometry;
var faceBoxOf = GVL.faceBoxOf;
var framePlacement = GVL.framePlacement;
var chestRect = GVL.chestRect;
var gvSinc = GVL.gvSinc;
var gvLanczos3 = GVL.gvLanczos3;
var gvCoeffs = GVL.gvCoeffs;
var gvResampleF = GVL.gvResampleF;
var gvFixed = GVL.gvFixed;
var gvClip8 = GVL.gvClip8;
var gvResample8 = GVL.gvResample8;
var frameLayer = GVL.frameLayer;
var gvSkinMask = GVL.gvSkinMask;
var gvDefringe = GVL.gvDefringe;
var healKicker = GVL.healKicker;
var healSpecular = GVL.healSpecular;
var gvTone = GVL.gvTone;
var gvSmax = GVL.gvSmax;
var gvSmin = GVL.gvSmin;
var gamutFit = GVL.gamutFit;
var gradeVivid = GVL.gradeVivid;
var gradePhoto = GVL.gradePhoto;
var photoFoot = GVL.photoFoot;
var debeltPixels = GVL.debeltPixels;
var VIVID = GVL.VIVID;
var PHOTO_GRADE = GVL.PHOTO_GRADE;
var PHOTO_BG = GVL.PHOTO_BG;

// ---------- the vivid PL card look: grounds, cards, plates, pills, titles (canvas 2D) ----------
// Port of scratchpad grade2/final_v/look.py + posters.py (approved Sept 25 2026). Draws the
// Premier-League-style posters: graph-paper grounds (light and dark) with soft diagonal
// streaks, the two-hue card with light bands, a keyline and a thin NEUTRAL contact darkening,
// the name plate (first name light, SURNAME bold), the gradient pill, the vertical-ramp Anton
// title, the VS badge, V3's accent bars and photo card.
// Needs the page's clamp, lerp, smooth, hexRgb, rgbHex, mix, mkCanvas and grade_vivid.js.
// Every function takes the target ctx and pixel rects; vividGeom() computes the rects as
// fractions of W and H, so thumbnails (W = 216) and 4:5 (1080 x 1350) work. Assumes an
// identity transform: shadows use the page's far-offset trick, which a transform would break.
// Where look.py does per-pixel maths (grounds, card faces, the contact darkening, the subject's
// foot) this does the same maths into ImageData; type, rounded shapes, shadows and glows are
// native canvas.

// ---------- themes ----------
// Two hues each, never red + blue. Card c1 (light, where the face sits) into c2; band = brush
// band hue, glow = light sweep, deep = lower card, floor = the card's dark foot; plate / key =
// the name plate and its keyline (plum on every theme); bg / ink = light paper and the dark
// used for drop shadows on it; p1 -> p2 = the LIGHT pill ramp, ptxt its dark label.
// a / hi / lo = the title ramp on the LIGHT ground; da / dhi / dlo = the owner's bright triple
// on the DARK ground; dbg0 / dbg1 / dglow1 / dglow2 = the dark ground and its light.
// Violet is a TRUE violet: every violet hue sits between 262 and 280 degrees.
// Light-ground title top stop on the paper: ember 3.02:1 (round 3 moved it off red, the WCAG
// large-text bar), pink 3.60, violet 3.74, toxic 3.79, gold 3.57 (titleContrast()).
var VIVID_THEMES = {
  ember: { id: "ember", name: "Ember",
    c1: "#FFE43A", c2: "#FF8A0A", band: "#FF6A00", glow: "#FFFBC8", deep: "#E4480A", floor: "#4A0E05",
    plate: "#2A0B30", key: "#FFB21E", bg: "#F2F1EF", ink: "#4A1606", p1: "#FFD84A", p2: "#FFA21E", ptxt: "#2A0B30",
    a: "#D25806", hi: "#EE6F08", lo: "#862C01", da: "#FF8A1F", dhi: "#FFC24D", dlo: "#F0560C",
    dbg0: "#09080A", dbg1: "#171214", dglow1: "#FF7A00", dglow2: "#FFC21A" },
  pink: { id: "pink", name: "Pink",
    c1: "#FF9ACF", c2: "#C23AE2", band: "#A41FD6", glow: "#FFE8F5", deep: "#8A1CC4", floor: "#2A0735",
    plate: "#33062C", key: "#FF74B4", bg: "#F2F1F2", ink: "#4A0834", p1: "#FFB6DA", p2: "#EA8FF2", ptxt: "#33062C",
    a: "#D81F80", hi: "#EE3E98", lo: "#7C12A8", da: "#FF4FA6", dhi: "#FFB0D6", dlo: "#C22AD8",
    dbg0: "#0A0509", dbg1: "#1A0A16", dglow1: "#FF2A8F", dglow2: "#D86BFF" },
  violet: { id: "violet", name: "Violet",
    c1: "#C095FF", c2: "#9636E6", band: "#7A22D8", glow: "#F3E9FF", deep: "#6A1BC4", floor: "#1C0838",
    plate: "#1E0A3E", key: "#BE8CFF", bg: "#F2F1F3", ink: "#240B4A", p1: "#DCC6FF", p2: "#C39BFF", ptxt: "#1E0A3E",
    a: "#8440E8", hi: "#A06CF2", lo: "#5E1CB8", da: "#9A5CFF", dhi: "#D6BCFF", dlo: "#7430E8",
    dbg0: "#100719", dbg1: "#1C0E2C", dglow1: "#9A52FF", dglow2: "#D070FF" },
  toxic: { id: "toxic", name: "Toxic",
    c1: "#E6FF45", c2: "#25C95C", band: "#0DA84C", glow: "#F7FFD2", deep: "#078F4A", floor: "#032619",
    plate: "#28082E", key: "#B8F23C", bg: "#F1F2EF", ink: "#0B3322", p1: "#E2FF5A", p2: "#7FE890", ptxt: "#28082E",
    a: "#08843A", hi: "#289424", lo: "#044E26", da: "#3DF07E", dhi: "#D8FF7A", dlo: "#0DA84A",
    dbg0: "#060A08", dbg1: "#0E1612", dglow1: "#1FD86A", dglow2: "#D8FF45" },
  // gold is new in the port (not in the approved render set): champagne into gold, plum
  // plates like the rest; the light-ground title is a deep bronze-gold (hue 37-41) because gold
  // at 3.5:1 on near-white is physically that dark; the dark ground keeps the owner's gold
  gold: { id: "gold", name: "Gold",
    c1: "#FFF1A8", c2: "#E9A800", band: "#C98A00", glow: "#FFFBE6", deep: "#B37700", floor: "#3A2602",
    plate: "#260C2C", key: "#FFD54A", bg: "#F2F1EE", ink: "#3D2A04", p1: "#FFEC9A", p2: "#F5C23A", ptxt: "#260C2C",
    a: "#9A6400", hi: "#B2800A", lo: "#5C3600", da: "#F7B530", dhi: "#FFE08A", dlo: "#D98A00",
    dbg0: "#0A0805", dbg1: "#18130A", dglow1: "#FFB21A", dglow2: "#FFE07A" },
  // crimson (added with the page integration, Sept 25 2026; not in the approved render set): a
  // single red, peach into crimson cards, oxblood plates, and the gritty crimson triple on the
  // dark ground. No blue anywhere (owner law 1); the dark-ground second light is orange.
  crimson: { id: "crimson", name: "Crimson",
    c1: "#FFB08A", c2: "#E8202E", band: "#C2102A", glow: "#FFEDE6", deep: "#A80C22", floor: "#3C0508",
    plate: "#2C0710", key: "#FF6F61", bg: "#F2F0EF", ink: "#4A0A10", p1: "#FFC0A8", p2: "#FF6A6A", ptxt: "#2C0710",
    a: "#C8102E", hi: "#E23A3A", lo: "#7A0616", da: "#F2303F", dhi: "#FF8A7A", dlo: "#B80C20",
    dbg0: "#0A0506", dbg1: "#190A0C", dglow1: "#FF2A3A", dglow2: "#FF9A5A" }
};
// ONE theme list for the whole page: the order and the ids come from the page's THEMES (ember
// first, the default), and every page theme has a card theme here (a selftest pins that). An
// unknown id resolves through themeById, so a card and the rest of the page never disagree.
var VIVID_ORDER = ["ember", "pink", "violet", "gold", "crimson", "toxic"];
function vividTheme(id) { return VIVID_THEMES[themeById(id).id] || VIVID_THEMES.ember; }

// ---------- colour helpers ----------
function vc01(hex) { var c = hexRgb(hex); return [c[0] / 255, c[1] / 255, c[2] / 255]; }
function vcMix01(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
function vcCss(c, a) {
  return "rgba(" + Math.round(clamp(c[0], 0, 1) * 255) + "," + Math.round(clamp(c[1], 0, 1) * 255) + "," +
    Math.round(clamp(c[2], 0, 1) * 255) + "," + (a == null ? 1 : a) + ")";
}
var VC_BLACK = [0, 0, 0];
var VC_LIGHT = [0.92, 0.90, 0.94];    // label / quote colour on the dark ground
var VC_NAME1 = [0.90, 0.88, 0.92];    // first name on the plate
function vcLin(c) { return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
function relLum(hex) { var c = vc01(hex); return 0.2126 * vcLin(c[0]) + 0.7152 * vcLin(c[1]) + 0.0722 * vcLin(c[2]); }
function wcagContrast(h1, h2) {
  var a = relLum(h1), b = relLum(h2);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}
// the owner's vertical ramp: mix(a, hi, topK) at the top (0.6), a at 55%, mix(a, lo, .55) at
// the bottom. Light ground uses a / hi / lo, the dark ground the bright da / dhi / dlo.
function titleStops(th, dark, topK) {
  var a = dark ? th.da : th.a, hi = dark ? th.dhi : th.hi, lo = dark ? th.dlo : th.lo;
  return [mix(a, hi, topK == null ? 0.6 : topK), a, mix(a, lo, 0.55)];
}
// contrast of the three light-ground stops on the paper
function titleContrast(th, topK) {
  var s = titleStops(th, false, topK);
  return [wcagContrast(s[0], th.bg), wcagContrast(s[1], th.bg), wcagContrast(s[2], th.bg)];
}
// the largest top-stop mix (<= 0.6, the approved ramp) whose top stop still meets minC on the
// paper. Ember's approved top is 3.02:1; ask for 3.5 and its top deepens toward a (3.62:1).
function titleTopK(th, minC) {
  if (!minC || titleContrast(th, 0.6)[0] >= minC) return 0.6;
  var lo = 0, hi = 0.6;
  for (var i = 0; i < 20; i++) { var m = (lo + hi) / 2; if (titleContrast(th, m)[0] >= minC) lo = m; else hi = m; }
  return lo;
}

// ---------- pixel fields ----------
// Screen-sum of soft diagonal brush bands: crisp lead edge, long soft tail, sine-warped, the
// strength breathing along the length. bands: [centre, width, soft lead, soft tail, k] in px.
// The two sines are advanced by rotation along each row (no per-pixel trig).
function vcBandField(W, H, deg, bands, ox, oy, flip, warp, seed) {
  var t = deg * Math.PI / 180, st = Math.sin(t), ct = Math.cos(t), Lm = Math.max(W, H);
  var f = new Float32Array(W * H), nb = bands.length, i, x, y;
  var cp = [], sn = [], cp2 = [], sn2 = [];
  for (i = 0; i < nb; i++) {
    var ph = 1.7 * i + seed;
    cp.push(Math.cos(ph)); sn.push(Math.sin(ph)); cp2.push(Math.cos(ph * 1.3)); sn2.push(Math.sin(ph * 1.3));
  }
  var k1 = 3.1 / Lm, k2 = 4.3 / Lm, step = flip ? -ct : ct;
  var cd1 = Math.cos(step * k1), sd1 = Math.sin(step * k1), cd2 = Math.cos(step * k2), sd2 = Math.sin(step * k2);
  for (y = 0; y < H; y++) {
    var xs = flip ? W - 1 : 0, al = (xs - ox) * ct - (y - oy) * st;
    var S1 = Math.sin(al * k1), C1 = Math.cos(al * k1), S2 = Math.sin(al * k2), C2 = Math.cos(al * k2);
    for (x = 0; x < W; x++) {
      var xx = flip ? W - 1 - x : x, v = (xx - ox) * st + (y - oy) * ct, acc = 0;
      for (i = 0; i < nb; i++) {
        var b = bands[i], lo0 = b[0] - b[1] / 2 - b[2], hi1 = b[0] + b[1] / 2 + b[3];
        var vv = v + warp * (S1 * cp[i] + C1 * sn[i]);
        if (vv <= lo0 || vv >= hi1) continue;
        var a = smooth(lo0, b[0] - b[1] / 2 + b[2] * 0.25, vv) * (1 - smooth(b[0] + b[1] / 2 - b[3] * 0.25, hi1, vv));
        acc = 1 - (1 - acc) * (1 - a * b[4] * (0.72 + 0.28 * (S2 * cp2[i] + C2 * sn2[i])));
      }
      f[y * W + x] = acc;
      var n1 = S1 * cd1 + C1 * sd1; C1 = C1 * cd1 - S1 * sd1; S1 = n1;
      var n2 = S2 * cd2 + C2 * sd2; C2 = C2 * cd2 - S2 * sd2; S2 = n2;
    }
  }
  return f;
}
// graph-paper lines, 1 where a line is (look._grid_lines; the offset is from W on both axes)
function vcGridLines(W, H, spacing, line) {
  var gl = new Uint8Array(W * H), off = (W - spacing * gvRound(W / spacing)) / 2 + spacing / 2;
  var lo = Math.floor(line / 2), hi = Math.floor((line + 1) / 2), k, x, y, c;
  for (k = 0; off + k * spacing < W; k++) {
    c = gvRound(off + k * spacing);
    for (x = Math.max(c - lo, 0); x < Math.min(c + hi, W); x++) for (y = 0; y < H; y++) gl[y * W + x] = 1;
  }
  for (k = 0; off + k * spacing < H; k++) {
    c = gvRound(off + k * spacing);
    for (y = Math.max(c - lo, 0); y < Math.min(c + hi, H); y++) for (x = 0; x < W; x++) gl[y * W + x] = 1;
  }
  return gl;
}
// anti-aliased coverage of a rounded rect (signed distance, pixel centres) in a W x H field
function vcRRectCover(W, H, rx, ry, rw, rh, r) {
  var out = new Float32Array(W * H), cx = rx + rw / 2, cy = ry + rh / 2, hx = rw / 2 - r, hy = rh / 2 - r;
  for (var y = 0; y < H; y++) {
    var py = Math.abs(y + 0.5 - cy) - hy, oy = Math.max(py, 0);
    for (var x = 0; x < W; x++) {
      var px = Math.abs(x + 0.5 - cx) - hx, ox = Math.max(px, 0);
      var d = Math.sqrt(ox * ox + oy * oy) + Math.min(Math.max(px, py), 0) - r;
      out[y * W + x] = clamp(0.5 - d, 0, 1);
    }
  }
  return out;
}
// float image -> canvas (seed: the 0.6 LSB dither, so big gradients never band)
function vcCanvas(img, seed) {
  var c = mkCanvas(img.w, img.h), x = c.getContext("2d"), id = x.createImageData(img.w, img.h);
  imageBytes(img, id.data, seed);
  x.putImageData(id, 0, 0);
  return c;
}
function vcFloatOf(c) {
  var x = c.getContext("2d", { willReadFrequently: true });
  return floatImage(x.getImageData(0, 0, c.width, c.height).data, c.width, c.height);
}
function vcCrop(img, x0, y0, w, h) {
  var out = new Float32Array(w * h * 4), d = img.data;
  for (var y = 0; y < h; y++) {
    var sy = y + y0;
    if (sy < 0 || sy >= img.h) continue;
    for (var x = 0; x < w; x++) {
      var sx = x + x0;
      if (sx < 0 || sx >= img.w) continue;
      var o = (y * w + x) * 4, so = (sy * img.w + sx) * 4;
      out[o] = d[so]; out[o + 1] = d[so + 1]; out[o + 2] = d[so + 2]; out[o + 3] = d[so + 3];
    }
  }
  return { w: w, h: h, data: out };
}

// ---------- grounds ----------
// LIGHT: PL paper, a light neutral base with a faint diagonal falloff, big soft white diagonal
// streaks at 36 deg, and the graph grid multiplied on top (fading at the sheet edge and under
// the streaks). DARK: theme-tinted near-black, a key light behind the title, soft coloured
// shafts at the same 36 deg, a faint light grid, vignette and seeded grain.
// the ground's theme-free fields (grid lines, light bands, grain) depend only on the size and the
// seed: they are built once per size and shared by every theme, so a theme switch or the Light /
// Dark toggle only runs the final per-pixel mix (page integration; the values are unchanged)
var vcFieldMemo = {}, vcFieldKeys = [];
function vcMemo(k, fn) {
  if (vcFieldMemo[k]) return vcFieldMemo[k];
  var v = fn();
  vcFieldMemo[k] = v; vcFieldKeys.push(k);
  if (vcFieldKeys.length > 8) delete vcFieldMemo[vcFieldKeys.shift()];
  return v;
}
function vividGroundImage(W, H, th, dark, seed) {
  seed = seed == null ? 1 : seed;
  var s = W / 1080, n = W * H, out = new Float32Array(n * 4), x, y, i, c, mk = W + "x" + H + ":" + seed;
  var gl = vcMemo("gl:" + mk, function () { return vcGridLines(W, H, 108 * s, Math.max(1, gvRound(2 * s))); });
  var e0 = 14 * s, e1 = 64 * s;
  if (!dark) {
    var st = vcMemo("st:" + mk, function () { return vcBandField(W, H, 36, [
      [60 * s, 120 * s, 10 * s, 110 * s, 1.0], [330 * s, 70 * s, 8 * s, 70 * s, 0.9], [620 * s, 190 * s, 10 * s, 170 * s, 1.0],
      [980 * s, 120 * s, 10 * s, 120 * s, 1.0], [1240 * s, 170 * s, 10 * s, 150 * s, 0.95], [1500 * s, 110 * s, 10 * s, 110 * s, 0.9],
      [1780 * s, 150 * s, 10 * s, 140 * s, 0.9]], -260 * s, 0, false, 18 * s, seed); });
    var bg = vc01(th.bg);
    for (y = 0; y < H; y++) {
      for (x = 0; x < W; x++) {
        i = y * W + x;
        var fall = 0.5 + 0.5 * Math.cos(clamp((x / W + y / H) * 0.5, 0, 1) * Math.PI), sk = st[i];
        var ga = gl[i] ? smooth(e0, e1, Math.min(Math.min(x, W - 1 - x), Math.min(y, H - 1 - y))) * (1 - 0.6 * sk) * 0.085 : 0;
        for (c = 0; c < 3; c++) {
          var v = bg[c] * (0.982 + 0.022 * fall);
          out[i * 4 + c] = (v + (1 - v) * sk) * (1 - ga);
        }
        out[i * 4 + 3] = 1;
      }
    }
  } else {
    var sh1 = vcMemo("sh1:" + mk, function () { return vcBandField(W, H, 36, [[330 * s, 70 * s, 8 * s, 90 * s, 0.9], [980 * s, 120 * s, 10 * s, 160 * s, 1.0],
      [1500 * s, 110 * s, 10 * s, 140 * s, 0.8]], -260 * s, 0, false, 18 * s, seed); });
    var sh2 = vcMemo("sh2:" + mk, function () { return vcBandField(W, H, 36, [[620 * s, 150 * s, 10 * s, 190 * s, 1.0], [1240 * s, 150 * s, 10 * s, 170 * s, 0.9]],
      -260 * s, 0, false, 18 * s, seed + 3); });
    var b0 = vc01(th.dbg0), b1 = vc01(th.dbg1), g1 = vc01(th.dglow1), g2 = vc01(th.dglow2);
    var gcol = vcMix01([1, 1, 1], g2, 0.35), grn = vcMemo("grn:" + mk, function () { return gvGauss(gvNormals(n, seed), W, H, 0.6); });
    for (y = 0; y < H; y++) {
      var v0 = y / H, tv = smooth(0.0, 1.0, v0);
      for (x = 0; x < W; x++) {
        i = y * W + x;
        var u0 = x / W, du = u0 - 0.5, dv = (v0 - 0.12) * 1.5, key = 0.12 * Math.exp(-(du * du + dv * dv) / (0.42 * 0.42));
        var lt = sh1[i] * 0.6 + sh2[i] * 0.4;
        var gA = gl[i] ? smooth(e0, e1, Math.min(Math.min(x, W - 1 - x), Math.min(y, H - 1 - y))) * (0.045 + 0.08 * lt) : 0;
        var dv2 = v0 - 0.5, vig = 1 - 0.40 * smooth(0.35, 1.05, Math.sqrt(du * du + dv2 * dv2) / 0.7071);
        for (c = 0; c < 3; c++) {
          var q = b1[c] + (b0[c] - b1[c]) * tv + g1[c] * key + g1[c] * 0.14 * sh1[i] + g2[c] * 0.09 * sh2[i];
          q = q + (gcol[c] - q) * gA;
          out[i * 4 + c] = clamp(q * vig + grn[i] * 0.008, 0, 1);
        }
        out[i * 4 + 3] = 1;
      }
    }
  }
  return { w: W, h: H, data: out };
}
var vcGroundCache = {};
function drawVividGround(ctx, W, H, th, dark) {
  var k = th.id + (dark ? ":d:" : ":l:") + W + "x" + H, c = vcGroundCache[k];
  if (!c) {
    var ks = Object.keys(vcGroundCache);
    if (ks.length > 6) delete vcGroundCache[ks[0]];
    c = vcCanvas(vividGroundImage(W, H, th, dark, 1), 11);
    vcGroundCache[k] = c;
  }
  ctx.drawImage(c, 0, 0);
}

// ---------- shadows and light ----------
// Soft shadow of an image's alpha (sigma in px, canvas blur = 2 sigma), drawn with the image
// itself far off-canvas. clipY1 stops it at that canvas row. mode "screen" turns it into the
// coloured light a card throws on the DARK ground (never used around a cut-out: owner law 2).
var VC_FAR = 60000;
function vcShadow(ctx, src, x, y, sigma, dx, dy, col, opacity, clipY1, mode) {
  ctx.save();
  if (clipY1 != null) { ctx.beginPath(); ctx.rect(-4 * VC_FAR, -4 * VC_FAR, 8 * VC_FAR, clipY1 + 4 * VC_FAR); ctx.clip(); }
  ctx.globalCompositeOperation = mode || "source-over";
  ctx.shadowColor = vcCss(col, opacity);
  ctx.shadowBlur = 2 * sigma;
  ctx.shadowOffsetX = VC_FAR + dx; ctx.shadowOffsetY = dy;
  ctx.drawImage(src, x - VC_FAR, y);
  ctx.restore();
}
function glowUnder(ctx, src, x, y, sigma, col, opacity) { vcShadow(ctx, src, x, y, sigma, 0, 0, col, opacity, null, "screen"); }
// a broad round pool of ground light (screen, Gaussian radius r) behind a breaking-out head on
// the dark ground: several head widths wide, never shaped like the cut-out
function lightPool(ctx, cx, cy, r, col, k) {
  var R3 = 3 * r, gr = ctx.createRadialGradient(cx, cy, 0, cx, cy, R3);
  for (var i = 0; i <= 12; i++) { var d = i / 12 * R3; gr.addColorStop(i / 12, vcCss(col, k * Math.exp(-d * d / (2 * r * r)))); }
  ctx.save(); ctx.globalCompositeOperation = "screen"; ctx.fillStyle = gr; ctx.fillRect(cx - R3, cy - R3, 2 * R3, 2 * R3); ctx.restore();
}

// ---------- rounded paths ----------
function vcRRect(ctx, x, y, w, h, r) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y); ctx.arc(x + w - r, y + r, r, -Math.PI / 2, 0);
  ctx.lineTo(x + w, y + h - r); ctx.arc(x + w - r, y + h - r, r, 0, Math.PI / 2);
  ctx.lineTo(x + r, y + h); ctx.arc(x + r, y + h - r, r, Math.PI / 2, Math.PI);
  ctx.lineTo(x, y + r); ctx.arc(x + r, y + r, r, Math.PI, Math.PI * 1.5);
  ctx.closePath();
}
// a keyline t px wide just inside a rounded rect (look.ring_of: outer r, inner r - t)
function vcKeyline(ctx, x, y, w, h, r, t, col) {
  ctx.save();
  vcRRect(ctx, x + t / 2, y + t / 2, w - t, h - t, Math.max(r - t / 2, 1));
  ctx.lineWidth = t; ctx.strokeStyle = col; ctx.stroke();
  ctx.restore();
}

// ---------- type ----------
// Text is rasterised the way look.text_mask does it: glyphs one by one, letter spacing in px,
// NO kerning, each advance rounded to whole pixels (FreeType's hinted advance, which is what PIL
// used: equal to round(unhinted) on every Anton / Barlow glyph checked), then the mask is
// CROPPED TO ITS INK (coverage > 0.02) by scanning the pixels. Layout uses those integer ink
// boxes. (measureText's actualBoundingBox is rounded outward in Chrome, which put titles 1 px
// off, so it is not used.) Fills are painted through the mask (source-in), so a gradient spans
// exactly the ink rows, like look.vertical_fill.
function vcFont(face, size) {
  if (face === "anton") return "400 " + size + "px Anton, Impact, 'Arial Narrow', sans-serif";
  return (face === "bold" ? "700 " : "600 ") + size + "px 'Barlow Condensed', 'Arial Narrow', sans-serif";
}
var vcMaskCache = {}, vcMaskKeys = [];
// ctx is not used (the mask gets its own canvas); it keeps the call shape of the other helpers
function vcInk(ctx, text, face, size, track) {
  var k = face + "|" + size + "|" + track.toFixed(4) + "|" + text;
  if (vcMaskCache[k]) return vcMaskCache[k];
  var m = mkCanvas(4, 4).getContext("2d"), adv = [], tot = 0, i;
  m.font = vcFont(face, size);
  for (i = 0; i < text.length; i++) { adv.push(Math.round(m.measureText(text.charAt(i)).width)); tot += adv[i] + (i ? track : 0); }
  var pad = Math.ceil(size * 0.4) + 4, cw = Math.ceil(tot) + 2 * pad, chh = Math.ceil(size * 1.6) + 2 * pad, base = pad + Math.ceil(size * 1.15);
  var c = mkCanvas(cw, chh), cx = c.getContext("2d", { willReadFrequently: true }), x = pad;
  cx.font = vcFont(face, size); cx.textBaseline = "alphabetic"; cx.textAlign = "left"; cx.fillStyle = "#FFFFFF";
  for (i = 0; i < text.length; i++) { cx.fillText(text.charAt(i), x, base); x += adv[i] + track; }
  var d = cx.getImageData(0, 0, cw, chh).data, x0 = cw, y0 = chh, x1 = -1, y1 = -1, xx, yy;
  for (yy = 0; yy < chh; yy++) for (xx = 0; xx < cw; xx++) if (d[(yy * cw + xx) * 4 + 3] > 5) {
    if (xx < x0) x0 = xx; if (xx > x1) x1 = xx; if (yy < y0) y0 = yy; if (yy > y1) y1 = yy;
  }
  var w = x1 >= x0 ? x1 - x0 + 1 : 0, h = y1 >= y0 ? y1 - y0 + 1 : 0, out = mkCanvas(Math.max(1, w), Math.max(1, h));
  if (w > 0) out.getContext("2d").drawImage(c, -x0, -y0);
  var ink = { c: out, w: w, h: h, base: base - y0, face: face, size: size, track: track };
  vcMaskCache[k] = ink; vcMaskKeys.push(k);
  if (vcMaskKeys.length > 120) delete vcMaskCache[vcMaskKeys.shift()];
  return ink;
}
// the largest size <= size whose ink fits maxW (look.fit_mask steps down 1 px at a time)
function vcFitInk(ctx, text, face, size, trackEm, maxW) {
  var s = Math.floor(size), ink = vcInk(ctx, text, face, s, s * trackEm);
  while (ink.w > maxW && s > 8) { s--; ink = vcInk(ctx, text, face, s, s * trackEm); }
  return ink;
}
// paint the ink mask with fill (a colour or a gradient in MASK coordinates), top-left at (x, y)
function vcDrawInk(ctx, text, ink, inkX, inkY, fill) {
  if (!ink.w || !ink.h) return;
  var c = mkCanvas(ink.w, ink.h), x = c.getContext("2d");
  x.drawImage(ink.c, 0, 0);
  x.globalCompositeOperation = "source-in"; x.fillStyle = fill; x.fillRect(0, 0, ink.w, ink.h);
  ctx.drawImage(c, inkX, inkY);
}

// ---------- the card ----------
// Two-hue PL card: the LIGHT hue owns the top half (where the face sits), the saturated hue
// comes in below, brush bands of the band hue and light sweeps cross it at 27 deg, and the
// lower card deepens into deep then a dark floor (skin never sits on a light fog).
function vcCardFace(w, h, th, flip) {
  var out = new Float32Array(w * h * 3), c1 = vc01(th.c1), c2 = vc01(th.c2), bd = vc01(th.band), gw = vc01(th.glow);
  var dp = vc01(th.deep), fl = vc01(th.floor), x, y, c;
  var db = vcBandField(w, h, 27, [[0.50 * h, 0.12 * h, 0.03 * h, 0.20 * h, 0.62], [0.86 * h, 0.10 * h, 0.03 * h, 0.16 * h, 0.55],
    [0.20 * h, 0.05 * h, 0.02 * h, 0.10 * h, 0.30]], 0, 0, flip, 0.03 * h, 0.4);
  var lb = vcBandField(w, h, 27, [[0.33 * h, 0.10 * h, 0.03 * h, 0.16 * h, 0.42], [0.70 * h, 0.05 * h, 0.02 * h, 0.08 * h, 0.18]],
    0, 0, flip, 0.03 * h, 2.1);
  for (y = 0; y < h; y++) {
    var v = y / h, kd = 0.80 * smooth(0.52, 0.92, v), kf = 0.88 * smooth(0.74, 1.04, v);
    for (x = 0; x < w; x++) {
      var i = y * w + x, u = flip ? 1 - x / w : x / w, t = smooth(0.26, 0.95, clamp(0.85 * v + 0.15 * (1 - u), 0, 1));
      for (c = 0; c < 3; c++) {
        var q = c1[c] + (c2[c] - c1[c]) * t;
        q += (bd[c] - q) * db[i]; q += (gw[c] - q) * lb[i]; q += (dp[c] - q) * kd; q += (fl[c] - q) * kf;
        out[i * 3 + c] = clamp(q, 0, 1);
      }
    }
  }
  return out;
}
// The whole card as a float image (alpha = the rounded card). subj: the graded subject layer,
// the SAME size as the card, straight alpha (or null). Separation is a thin NEUTRAL scalar
// darkening rgb * (1 - k) that keeps the card's own hue (never a brown or olive stain): a
// contact term (sigma 0.7% of the width, nudged down-right, up to 1.8x where the subject's own
// edge is pale) plus a faint wide ambient term. The subject's lower body goes into SHADOW (a
// luminance scalar) before it has to end and only then dissolves, dark into the dark foot:
// no card colour is ever mixed over skin.
// o: radius (16), flip, cropRow (the source's own crop line in card rows), fadeFrom, burnFrom
// (.60), burn (.45), footBurn (.82), footFrom, keyUnder (keyline drawn under the subject, V2),
// key (hex), keyW (3), sepAmb (.10), sepCon (.24), sepMax (.24), s (scale, W / 1080)
function vividCardImage(th, w, h, subj, o) {
  o = o || {};
  var s = o.s == null ? 1 : o.s, rad = (o.radius == null ? 16 : o.radius) * s, t = (o.keyW == null ? 3 : o.keyW) * s;
  var n = w * h, i, x, y, c, face = vcCardFace(w, h, th, !!o.flip);
  var m = vcRRectCover(w, h, 0, 0, w, h, rad), inner = vcRRectCover(w, h, t, t, w - 2 * t, h - 2 * t, Math.max(rad - t, 2 * s));
  var kc = vc01(o.key || th.key), out = new Float32Array(n * 4);
  var keyUnder = !!o.keyUnder;
  for (i = 0; i < n; i++) {
    var ring = clamp(m[i] - inner[i], 0, 1);
    for (c = 0; c < 3; c++) {
      var q = face[i * 3 + c];
      if (keyUnder) q += (kc[c] - q) * ring;
      out[i * 4 + c] = q;
    }
    out[i * 4 + 3] = m[i];
  }
  if (subj) {
    var sd = subj.data, sa = new Float32Array(n), sl = new Float32Array(n), end = null;
    var burnFrom = o.burnFrom == null ? 0.60 : o.burnFrom, burn = o.burn == null ? 0.45 : o.burn;
    var footBurn = o.footBurn == null ? 0.82 : o.footBurn;
    if (o.cropRow != null && o.cropRow < h + 2) end = o.cropRow - 2;
    if (o.fadeFrom != null) end = end != null ? Math.min(end, o.fadeFrom * h + 0.14 * h) : o.fadeFrom * h + 0.14 * h;
    for (y = 0; y < h; y++) {
      var cut = end != null ? 1 - smooth(end - 0.035 * h, end, y) : 1;
      for (x = 0; x < w; x++) {
        i = y * w + x;
        sa[i] = sd[i * 4 + 3] * cut;
        sl[i] = sa[i] * gvLum(sd[i * 4], sd[i * 4 + 1], sd[i * 4 + 2]);
      }
    }
    var amb = gvGauss(sa, w, h, 0.030 * w), con = gvGauss(sa, w, h, 0.007 * w);
    var se = Math.max(1.5, 0.012 * w), eN = gvGauss(sl, w, h, se), eD = gvGauss(sa, w, h, se);
    var dx = gvRound(0.004 * w), dy = gvRound(0.005 * h);
    var sepAmb = o.sepAmb == null ? 0.10 : o.sepAmb, sepCon = o.sepCon == null ? 0.24 : o.sepCon, sepMax = o.sepMax == null ? 0.24 : o.sepMax;
    for (y = 0; y < h; y++) {
      var foot = end != null ? smooth(end - 0.16 * h, end, y) : 0;
      if (o.footFrom != null) foot = Math.max(foot, smooth(o.footFrom * h, 1.0 * h, y));
      var shade = Math.max(burn * smooth(burnFrom, 1.02, y / h), footBurn * foot);
      for (x = 0; x < w; x++) {
        i = y * w + x;
        var sx = x - dx, sy = y - dy, cn = (sx >= 0 && sy >= 0 && sx < w && sy < h) ? con[sy * w + sx] : 0;
        var boost = 1 + 0.8 * smooth(0.55, 0.85, eN[i] / Math.max(eD[i], 1e-3));
        var k = clamp(sepAmb * amb[i] + sepCon * cn * boost, 0, sepMax * (1 + 0.25 * (boost - 1)));
        var al = sa[i];
        for (c = 0; c < 3; c++) {
          var q = out[i * 4 + c] * (1 - k);
          out[i * 4 + c] = q + (sd[i * 4 + c] * (1 - shade) - q) * al;
        }
      }
    }
  }
  if (!keyUnder) {
    for (i = 0; i < n; i++) {
      var rg = clamp(m[i] - inner[i], 0, 1);
      if (rg > 0) for (c = 0; c < 3; c++) out[i * 4 + c] += (kc[c] - out[i * 4 + c]) * rg;
    }
  }
  return { w: w, h: h, data: out };
}
// the card at rect with its ground shadow (light: a soft ink drop shadow; dark: the coloured
// light it throws, screen). o = vividCardImage's options + dark, shadow {sigma, dy, op},
// glow {sigma, op}. Returns the card canvas.
// o.ckey (page): a string naming the subject + everything else that shapes the card; with it the
// card canvas is cached, so a re-render (typing a title) never recomputes the per-pixel card
var vcCardCache = {}, vcCardKeys = [];
function drawVividCard(ctx, rect, th, subj, o) {
  o = o || {};
  var s = o.s == null ? 1 : o.s, ck = o.ckey ? [o.ckey, th.id, rect[2], rect[3], !!o.dark, o.cropRow, !!o.flip, o.radius, o.burnFrom, o.burn, o.footFrom, !!o.keyUnder, s].join("|") : null;
  var cc = ck ? vcCardCache[ck] : null;
  if (!cc) {
    cc = vcCanvas(vividCardImage(th, rect[2], rect[3], subj, o), null);
    if (ck) {
      vcCardCache[ck] = cc; vcCardKeys.push(ck);
      if (vcCardKeys.length > 48) delete vcCardCache[vcCardKeys.shift()];
    }
  }
  if (o.dark) {
    var gl = o.glow || { sigma: 22, op: 0.42 };
    glowUnder(ctx, cc, rect[0], rect[1], gl.sigma * s, vc01(th.c2), gl.op);
  } else {
    var sh = o.shadow || { sigma: 14, dy: 10, op: 0.22 };
    vcShadow(ctx, cc, rect[0], rect[1], sh.sigma * s, 0, sh.dy * s, vc01(th.ink), sh.op);
  }
  ctx.drawImage(cc, rect[0], rect[1]);
  return cc;
}
// V2: the crown that breaks out above the card. rows 0 .. pop+2 of the FULL subject layer are
// drawn at (x, cardTop - pop) over a thin soft dark contact line on the ground, clipped at the
// card's top edge (a pale scalp must not melt into the paper) - never a halo of light.
function drawBreakout(ctx, layer, x, cardTop, pop, th, o) {
  o = o || {};
  var s = o.s == null ? 1 : o.s, rows = Math.min(layer.height, pop + Math.round(2 * s));
  var ab = mkCanvas(layer.width, rows);
  ab.getContext("2d").drawImage(layer, 0, 0, layer.width, rows, 0, 0, layer.width, rows);
  var ink = o.dark ? VC_BLACK : vc01(th.ink), top = cardTop - pop;
  vcShadow(ctx, ab, x, top, 5 * s, 1 * s, 3 * s, ink, o.dark ? 0.45 : 0.30, cardTop);
  vcShadow(ctx, ab, x, top, 12 * s, 0, 4 * s, ink, o.dark ? 0.30 : 0.12, cardTop);
  ctx.drawImage(ab, x, top);
}

// ---------- name plate ----------
// Dark plum plate (a vertical ramp plate x 1.12 + .012 -> plate x .92), the key keyline, FIRST
// name in Barlow Condensed SemiBold (light) over the SURNAME in Anton (white). All solid: small
// type is never a gradient. oneLine (V3): first and last side by side, bottoms aligned.
// o: radius (10), oneLine, dark (shadow colour), s. rect = [x, y, w, h].
function drawNamePlate(ctx, rect, th, first, last, o) {
  o = o || {};
  var s = o.s == null ? 1 : o.s, w = Math.round(rect[2]), h = Math.round(rect[3]), r = (o.radius == null ? 10 : o.radius) * s;
  var c = mkCanvas(w, h), x = c.getContext("2d"), p = vc01(th.plate);
  var gr = x.createLinearGradient(0, 0.5, 0, h - 0.5);
  gr.addColorStop(0, vcCss([p[0] * 1.12 + 0.012, p[1] * 1.12 + 0.012, p[2] * 1.12 + 0.012]));
  gr.addColorStop(1, vcCss([p[0] * 0.92, p[1] * 0.92, p[2] * 0.92]));
  vcRRect(x, 0, 0, w, h, r); x.fillStyle = gr; x.fill();
  vcKeyline(x, 0, 0, w, h, r, 3 * s, th.key);
  var f = upper(first), l = upper(last), i1, i2;
  if (o.oneLine) {
    i1 = vcFitInk(x, f, "semi", Math.floor(h * 0.52), 0.06, w * 0.4);
    i2 = vcFitInk(x, l, "anton", Math.floor(h * 0.56 / 0.86 * 0.86), 0.015, w * 0.5);
    var gap = Math.floor(h * 0.18), tw = Math.ceil(i1.w) + gap + Math.ceil(i2.w), x1 = Math.floor((w - tw) / 2);
    var y2 = Math.floor((h - Math.ceil(i2.h)) / 2), y1 = y2 + Math.ceil(i2.h) - Math.ceil(i1.h);
    vcDrawInk(x, f, i1, x1, y1, vcCss(VC_NAME1));
    vcDrawInk(x, l, i2, x1 + Math.ceil(i1.w) + gap, y2, "#FFFFFF");
  } else {
    i1 = vcFitInk(x, f, "semi", Math.floor(h * 0.36), 0.08, w - 24 * s);
    i2 = vcFitInk(x, l, "anton", Math.floor(h * 0.44), 0.012, w - 24 * s);
    var gp = Math.floor(h * 0.09), tot = Math.ceil(i1.h) + gp + Math.ceil(i2.h), ya = Math.floor((h - tot) / 2);
    vcDrawInk(x, f, i1, Math.floor((w - Math.ceil(i1.w)) / 2), ya, vcCss(VC_NAME1));
    vcDrawInk(x, l, i2, Math.floor((w - Math.ceil(i2.w)) / 2), ya + Math.ceil(i1.h) + gp, "#FFFFFF");
  }
  vcShadow(ctx, c, rect[0], rect[1], 8 * s, 0, 5 * s, o.dark ? VC_BLACK : vc01(th.ink), 0.30);
  ctx.drawImage(c, rect[0], rect[1]);
  return c;
}

// ---------- pill ----------
// LIGHT two-hue pill (p1 -> p2, smoothstep across) with a 14% white lift over the top half and
// a DARK solid Anton label (white on the light end was unreadable). Centred on cx, top at y.
// o: padx (default 0.62 h), dark (shadow becomes a c2 glow), s. Returns [x, y, w, h].
function drawPill(ctx, cx, y, h, text, th, o) {
  o = o || {};
  var s = o.s == null ? 1 : o.s, t = upper(text);
  var ink = vcInk(ctx, t, "anton", gvRound(h * 0.52 / 0.86), h * 0.045);
  var padx = o.padx != null ? o.padx : Math.floor(h * 0.62), w = Math.ceil(ink.w) + 2 * padx, hh = Math.round(h);
  var c = mkCanvas(w, hh), x = c.getContext("2d"), p1 = vc01(th.p1), p2 = vc01(th.p2);
  var gr = x.createLinearGradient(0.5, 0, w - 0.5, 0);
  for (var i = 0; i <= 10; i++) gr.addColorStop(i / 10, vcCss(vcMix01(p1, p2, smooth(0, 1, i / 10))));
  vcRRect(x, 0, 0, w, hh, Math.floor(hh / 2)); x.fillStyle = gr; x.fill();
  var lift = x.createLinearGradient(0, 0.5, 0, 0.5 + (hh - 1) * 0.5);
  lift.addColorStop(0, "rgba(255,255,255,0.14)"); lift.addColorStop(1, "rgba(255,255,255,0)");
  x.save(); x.globalCompositeOperation = "source-atop"; x.fillStyle = lift; x.fillRect(0, 0, w, hh); x.restore();
  vcDrawInk(x, t, ink, padx, Math.floor((hh - Math.ceil(ink.h)) / 2), th.ptxt);
  var px = Math.floor(cx - w / 2);
  if (o.dark) glowUnder(ctx, c, px, y, 14 * s, vc01(th.c2), 0.35);
  else vcShadow(ctx, c, px, y, 8 * s, 0, 5 * s, vc01(th.ink), 0.22);
  ctx.drawImage(c, px, y);
  return [px, y, w, hh];
}

// ---------- title ----------
// Big Anton title with the owner's VERTICAL fill over its ink box (titleStops), a tight and an
// ambient ink shadow on the light ground, one soft black shadow on the dark ground. Centred on
// cx, the INK top at y, cap = cap height in px (size = cap / 0.86).
// o: dark, tracking (em, .01), minContrast (e.g. 3.5: deepens the top stop until it meets that
// on the paper; default = the approved ramp), s. Returns [x, y, w, h] of the ink.
// o.maxW (page integration): a title wider than that is set smaller until its ink fits (a long owner
// title ran off both edges); under a 46 px cap height it is drawn SOLID in the theme accent, the
// small-type rule (gradients only on display type)
function drawVividTitle(ctx, cx, y, cap, text, th, o) {
  o = o || {};
  var s = o.s == null ? 1 : o.s, t = upper(text), size = gvRound(cap / 0.86), trk = o.tracking == null ? 0.01 : o.tracking;
  var ink = vcInk(ctx, t, "anton", size, trk * size);
  if (o.maxW && ink.w > o.maxW) {
    size = Math.max(8, Math.floor(size * o.maxW / ink.w));
    ink = vcInk(ctx, t, "anton", size, trk * size);
    while (ink.w > o.maxW && size > 8) { size--; ink = vcInk(ctx, t, "anton", size, trk * size); }
  }
  var pad = Math.round(30 * s), iw = Math.ceil(ink.w), ih = Math.ceil(ink.h), tw = iw + 2 * pad;
  var c = mkCanvas(tw, ih + 2 * pad), x = c.getContext("2d");
  var st = titleStops(th, !!o.dark, o.dark ? 0.6 : titleTopK(th, o.minContrast)), fill;
  if (size * 0.86 < 46 * s) fill = o.dark ? th.da : th.a;
  else {
    fill = x.createLinearGradient(0, 0.5, 0, ih - 0.5);
    fill.addColorStop(0, st[0]); fill.addColorStop(0.55, st[1]); fill.addColorStop(1, st[2]);
  }
  vcDrawInk(x, t, ink, pad, pad, fill);
  var tx = Math.floor(cx - tw / 2), ty = y - pad;
  if (o.dark) vcShadow(ctx, c, tx, ty, 12 * s, 0, 8 * s, VC_BLACK, 0.55);
  else {
    vcShadow(ctx, c, tx, ty, 10 * s, 0, 7 * s, vc01(th.ink), 0.26);
    vcShadow(ctx, c, tx, ty, 2.5 * s, 0, 3 * s, vc01(th.ink), 0.22);
  }
  ctx.drawImage(c, tx, ty);
  return [tx + pad, y, iw, ih];
}

// ---------- VS badge ----------
// plum disc (plate x 1.18 -> x .90 down), a p1 -> p2 ring 5% of the diameter, white Anton VS
function drawVsBadge(ctx, x, y, d, th, o) {
  o = o || {};
  var s = o.s == null ? 1 : o.s, dd = Math.round(d), c = mkCanvas(dd, dd), cx = c.getContext("2d"), p = vc01(th.plate);
  var r = dd / 2, k = Math.floor(dd * 4 * 0.05) / 4;
  var gv = cx.createLinearGradient(0, 0.5, 0, dd - 0.5);
  gv.addColorStop(0, vcCss([p[0] * 1.18, p[1] * 1.18, p[2] * 1.18])); gv.addColorStop(1, vcCss([p[0] * 0.90, p[1] * 0.90, p[2] * 0.90]));
  cx.beginPath(); cx.arc(r, r, r, 0, Math.PI * 2); cx.fillStyle = gv; cx.fill();
  var gh = cx.createLinearGradient(0.5, 0, dd - 0.5, 0);
  gh.addColorStop(0, th.p1); gh.addColorStop(1, th.p2);
  cx.beginPath(); cx.arc(r, r, r, 0, Math.PI * 2); cx.arc(r, r, r - k, 0, Math.PI * 2, true); cx.fillStyle = gh; cx.fill();
  var ink = vcInk(cx, "VS", "anton", Math.floor(dd * 0.40 / 0.86), dd * 0.01);
  vcDrawInk(cx, "VS", ink, Math.floor((dd - Math.ceil(ink.w)) / 2), Math.floor((dd - Math.ceil(ink.h)) / 2), "#FFFFFF");
  vcShadow(ctx, c, x, y, 10 * s, 0, 8 * s, o.dark ? VC_BLACK : vc01(th.ink), 0.40);
  ctx.drawImage(c, x, y);
}

// ---------- small label ----------
// solid Barlow Condensed (Bold by default), tracking in em, centred on cx, ink top at y
function drawVividLabel(ctx, text, cx, y, size, col, o) {
  o = o || {};
  var t = String(text || ""), face = o.face || "bold";
  var ink = vcInk(ctx, t, face, size, size * (o.tracking == null ? 0.14 : o.tracking));
  vcDrawInk(ctx, t, ink, gvTrunc(cx - ink.w / 2), gvTrunc(y), typeof col === "string" ? col : vcCss(col));
  return ink;
}

// ---------- V3 accent bars and photo card ----------
// PL matchweek bars: a two-hue bar tucked into the top and the bottom edge (bottom one flipped)
function drawAccentBars(ctx, W, H, th, o) {
  o = o || {};
  var s = o.s == null ? 1 : o.s, bw = Math.round(700 * s), bh = Math.round(64 * s), r = 22 * s;
  var pos = [[Math.round(-34 * s), false], [H - Math.round(30 * s), true]];
  for (var i = 0; i < 2; i++) {
    var c = mkCanvas(bw, bh), x = c.getContext("2d"), gr = x.createLinearGradient(0.5, 0, bw - 0.5, 0);
    gr.addColorStop(0, pos[i][1] ? th.c2 : th.c1); gr.addColorStop(1, pos[i][1] ? th.c1 : th.c2);
    vcRRect(x, 0, 0, bw, bh, r); x.fillStyle = gr; x.fill();
    var bx = Math.floor((W - bw) / 2);
    if (o.dark) glowUnder(ctx, c, bx, pos[i][0], 18 * s, vc01(th.c2), 0.35);
    ctx.drawImage(c, bx, pos[i][0]);
  }
}
// the photo in a 6 px two-hue frame (c1 -> c2 across, outer radius 22, inner 17), like ref 13's
// rim. photo: a canvas of (w - 12 s) x (h - 12 s), already graded (gradePhoto) and footed
// (photoFoot). Light: ink drop shadow; dark: c2 glow.
function drawPhotoCard(ctx, rect, th, photo, o) {
  o = o || {};
  var s = o.s == null ? 1 : o.s, w = Math.round(rect[2]), h = Math.round(rect[3]), fr = Math.round(6 * s);
  var c = mkCanvas(w, h), x = c.getContext("2d"), gr = x.createLinearGradient(0.5, 0, w - 0.5, 0);
  gr.addColorStop(0, th.c1); gr.addColorStop(1, th.c2);
  vcRRect(x, 0, 0, w, h, 22 * s); x.fillStyle = gr; x.fill();
  if (photo) {
    x.save(); vcRRect(x, fr, fr, w - 2 * fr, h - 2 * fr, 17 * s); x.clip();
    x.drawImage(photo, fr, fr, w - 2 * fr, h - 2 * fr); x.restore();
  }
  if (o.dark) glowUnder(ctx, c, rect[0], rect[1], 30 * s, vc01(th.c2), 0.38);
  else vcShadow(ctx, c, rect[0], rect[1], 16 * s, 0, 12 * s, vc01(th.ink), 0.24);
  ctx.drawImage(c, rect[0], rect[1]);
  return c;
}

// ---------- layouts ----------
// posters.py's three layouts, every number a 1080-unit value scaled by s = W / 1080. At 4:5 the
// extra height dy (270 units at 1080 x 1350) is shared out: the header moves a little, the
// cards grow taller (more body / more photo), the rest is bottom margin. At 1:1 every rect is
// exactly posters.py's.
// V1 takes n = 4, 6 or 8 cards (page integration): 6 is the approved 3 x 2 grid unchanged; 4 is
// a 2 x 2 grid of wider cards, 8 a 4 x 2 grid of narrower ones. The head keeps about the same
// size on the card in every grid (headFrac follows the card width), and 8 cards keep the 6-card
// name plate (the type stays readable at phone size; the card is 12 units shorter instead).
function vividGeom(kind, W, H, n) {
  var s = W / 1080, dy = Math.max(0, H / s - 1080), R0 = function (v) { return Math.round(v * s); }, G = { s: s, W: W, H: H };
  var i, x, y;
  if (kind === "v1") {
    n = n === 4 || n === 8 ? n : 6;
    var cols = n === 4 ? 2 : n === 8 ? 4 : 3;
    var cw = n === 4 ? 400 : n === 8 ? 226 : 296, gx = n === 8 ? 18 : 22, hf = n === 4 ? 0.46 : n === 8 ? 0.62 : 0.60;
    var ch = (n === 8 ? 304 : 316) + 0.36 * dy, gy = 20 + 0.08 * dy, ph = 76, po = 16, y0 = 262 + 0.10 * dy;
    var x0 = Math.floor((1080 - (cols * cw + (cols - 1) * gx)) / 2), npw = Math.floor(cw * 1.06);
    G.n = n;
    G.title = { y: R0(32 + 0.06 * dy), cap: 120 * s };
    G.pill = { y: R0(172 + 0.06 * dy), h: R0(56), padx: R0(40) };
    G.card = { w: R0(cw), h: R0(ch), headFrac: hf, topFrac: 0.065, burnFrom: 0.72, burn: 0.30, radius: 16 };
    G.slots = [];
    for (i = 0; i < n; i++) {
      var r = Math.floor(i / cols), c = i % cols;
      x = x0 + c * (cw + gx); y = y0 + r * (ch + ph - po + gy);
      G.slots.push({ card: [R0(x), R0(y), R0(cw), R0(ch)],
        plate: [R0(x + Math.floor((cw - npw) / 2)), R0(y + ch - po), R0(npw), R0(ph)] });
    }
  } else if (kind === "v2") {
    var cw2 = 446, ch2 = 560 + 0.66 * dy, gap = 52, pop = 34, y2 = 320 + 0.20 * dy, ph2 = 88, po2 = 26;
    var x02 = Math.floor((1080 - (2 * cw2 + gap)) / 2), npw2 = Math.floor(cw2 * 1.04), d = 118;
    G.pill = { y: R0(30 + 0.10 * dy), h: R0(56), padx: R0(38) };
    G.title = { y: R0(108 + 0.10 * dy), cap: 116 * s };
    G.card = { w: R0(cw2), h: R0(ch2), pop: R0(pop), headFrac: 0.355, topFrac: 2 / (ch2 + pop), burnFrom: 0.66, burn: 0.30,
      footFrom: 0.80, radius: 20, below: 4.0 * (ch2 + pop) / 594 };
    G.slots = [];
    for (i = 0; i < 2; i++) {
      x = x02 + i * (cw2 + gap);
      G.slots.push({ card: [R0(x), R0(y2), R0(cw2), R0(ch2)], pool: [R0(x + cw2 / 2), R0(y2 - 20), 150 * s],
        plate: [R0(x + Math.floor((cw2 - npw2) / 2)), R0(y2 + ch2 - po2), R0(npw2), R0(ph2)] });
    }
    G.vs = { x: R0(Math.floor((1080 - d) / 2)), y: R0(y2 + Math.floor(ch2 * 0.46) - Math.floor(d / 2)), d: R0(d) };
    G.label = { y: R0(y2 + ch2 - po2 + ph2 + 24), size: R0(30) };
  } else {
    var cw3 = 700, ch3 = 604 + 0.70 * dy, cy3 = 298 + 0.12 * dy, npw3 = 360, nph3 = 74;
    G.pill = { y: R0(62 + 0.08 * dy), h: R0(56), padx: R0(36) };
    G.title = { y: R0(140 + 0.08 * dy), cap: 118 * s };
    G.card = [R0(Math.floor((1080 - cw3) / 2)), R0(cy3), R0(cw3), R0(ch3)];
    G.photo = { w: R0(cw3) - 2 * Math.round(6 * s), h: R0(ch3) - 2 * Math.round(6 * s) };
    G.plate = [R0(Math.floor((1080 - npw3) / 2)), R0(cy3 + ch3 - 40), R0(npw3), R0(nph3)];
    G.quote = { y: R0(cy3 + ch3 - 40 + nph3 + 18), size: R0(30) };
  }
  return G;
}
// The light-ground title is held to 3.5:1 on the paper at its TOP stop (the approved ember ramp's
// top stop sits at 3.02:1, under the WCAG large-type bar the page promises); the dark ground keeps
// the owner's bright triple.
var VC_TITLE_MIN = 3.5;
// V1: the card grid. d = { n, title, pill, tiles: [{ subj (float image, card size, graded), crop
// (the source crop row in card rows), first, last, key (cache key of subj) }] }. Returns the geometry.
function drawVividV1(ctx, W, H, th, dark, d) {
  var G = vividGeom("v1", W, H, d.n), s = G.s;
  drawVividGround(ctx, W, H, th, dark);
  G.titleBox = drawVividTitle(ctx, W / 2, G.title.y, G.title.cap, d.title, th, { dark: dark, s: s, minContrast: VC_TITLE_MIN, maxW: W - 96 * s });
  G.pillBox = drawPill(ctx, W / 2, G.pill.y, G.pill.h, d.pill, th, { dark: dark, padx: G.pill.padx, s: s });
  for (var i = 0; i < G.slots.length; i++) {
    var sl = G.slots[i], t = d.tiles[i] || {};
    drawVividCard(ctx, sl.card, th, t.subj || null, { s: s, dark: dark, cropRow: t.crop, burnFrom: G.card.burnFrom,
      burn: G.card.burn, radius: G.card.radius, ckey: t.subj ? t.key : "empty" });
    drawNamePlate(ctx, sl.plate, th, t.first || "", t.last || "", { s: s, dark: dark, radius: 10 });
  }
  return G;
}
// V2: two cards + VS, crowns breaking the card top. d = { pill, title, label, fighters: [{
// layer (float image cw x (ch + pop), graded), layerCanvas (the same as a canvas), crop (crop row
// in LAYER rows), first, last, key }] }. Returns the geometry.
function drawVividV2(ctx, W, H, th, dark, d) {
  var G = vividGeom("v2", W, H), s = G.s, i, cd = G.card;
  drawVividGround(ctx, W, H, th, dark);
  G.pillBox = drawPill(ctx, W / 2, G.pill.y, G.pill.h, d.pill, th, { dark: dark, padx: G.pill.padx, s: s });
  G.titleBox = drawVividTitle(ctx, W / 2, G.title.y, G.title.cap, d.title, th, { dark: dark, s: s, minContrast: VC_TITLE_MIN, maxW: W - 96 * s });
  if (dark) for (i = 0; i < 2; i++) lightPool(ctx, G.slots[i].pool[0], G.slots[i].pool[1], G.slots[i].pool[2], vc01(th.dglow1), 0.26);
  for (i = 0; i < 2; i++) {
    var sl = G.slots[i], f = d.fighters[i] || {}, lay = f.layer || null;
    var inside = lay ? vcCrop(lay, 0, cd.pop, cd.w, cd.h) : null;
    drawVividCard(ctx, sl.card, th, inside, { s: s, dark: dark, radius: cd.radius, flip: i === 1,
      cropRow: f.crop != null ? f.crop - cd.pop : null, keyUnder: true, burnFrom: cd.burnFrom, burn: cd.burn,
      footFrom: cd.footFrom, shadow: { sigma: 16, dy: 12, op: 0.22 }, glow: { sigma: 30, op: 0.40 }, ckey: lay ? f.key : "empty2" });
    if (lay && cd.pop > 0) drawBreakout(ctx, f.layerCanvas || vcCanvas(lay, null), sl.card[0], sl.card[1], cd.pop, th, { s: s, dark: dark });
    drawNamePlate(ctx, sl.plate, th, f.first || "", f.last || "", { s: s, dark: dark, radius: 12 });
  }
  drawVsBadge(ctx, G.vs.x, G.vs.y, G.vs.d, th, { s: s, dark: dark });
  G.labelInk = drawVividLabel(ctx, d.label || "", W / 2, G.label.y, G.label.size, dark ? VC_LIGHT : vc01(th.plate));
  return G;
}
// V3: a single hero news photo card. d = { pill, title, first, last, quote, photo (canvas of
// G.photo.w x G.photo.h, graded + footed) }. Returns the geometry.
function drawVividV3(ctx, W, H, th, dark, d) {
  var G = vividGeom("v3", W, H), s = G.s;
  drawVividGround(ctx, W, H, th, dark);
  drawAccentBars(ctx, W, H, th, { dark: dark, s: s });
  G.pillBox = drawPill(ctx, W / 2, G.pill.y, G.pill.h, d.pill, th, { dark: dark, padx: G.pill.padx, s: s });
  G.titleBox = drawVividTitle(ctx, W / 2, G.title.y, G.title.cap, d.title, th, { dark: dark, s: s, minContrast: VC_TITLE_MIN, maxW: W - 96 * s });
  drawPhotoCard(ctx, G.card, th, d.photo || null, { dark: dark, s: s });
  drawNamePlate(ctx, G.plate, th, d.first || "", d.last || "", { s: s, dark: dark, radius: 12, oneLine: true });
  G.quoteInk = drawVividLabel(ctx, d.quote || "", W / 2, G.quote.y, G.quote.size, dark ? VC_LIGHT : vc01(th.plate), { tracking: 0.10 });
  return G;
}
// ---------- end of the libraries ----------

// ---------- themes: ONE list for the whole page ----------
// Ember (orange into yellow) is the default: the owner chose it over the brand purple after
// seeing both (Sept 25 2026). Each theme is the approved GRITTY one (GRIT.THEMES: the display
// type a / hi / lo, the plate gradient map, shade = the near-black of every fade and dark halo,
// haze = the soft light behind heads) AND its vivid card theme (VIVID_THEMES: the two-hue card
// ramps for the light and the dark ground). glow is the light the old templates' scene lights
// use; ink is text on an accent plate; tint is the dark those scenes lean toward.
// NEVER a red-versus-blue scheme anywhere (owner law, Sept 25 2026): there is no blue theme, and
// an old saved doc naming the retired "ice" or "mono" theme opens in ember.
var THEME_IDS = ["ember", "pink", "violet", "gold", "crimson", "toxic"];
var THEMES = THEME_IDS.map(function (id) {
  var t = GRIT.THEMES[id];
  return { id: id, name: t.name, a: t.a, hi: t.hi, lo: t.lo, glow: mix(t.a, t.hi, 0.35), ink: t.ink,
           tint: mix(t.shade, t.a, 0.06), shade: t.shade, haze: t.haze, cool: !!t.cool };
});
function themeById(id) { for (var i = 0; i < THEMES.length; i++) if (THEMES[i].id === id) return THEMES[i]; return THEMES[0]; }
// owner law 1 (never red and blue, a red pop on violet counts): which guard a subject graded in
// mode needs on the current theme ("" none). A cool theme (violet) mutes a saturated red kit in
// every colour look; a red theme (crimson: hue within 25 degrees of 0) mutes blue in the vivid look
// (the gritty colour grades carry their own blue guard). The theme id rides the job (and its cache
// key) only when a guard applies, so ember and pink keep sharing one grade.
function themeGuardKind(id) {
  var t = GRIT.THEMES[id];
  if (!t) return "";
  if (GRIT.isCool(id)) return "cool";
  return Math.min(t.hue, 360 - t.hue) <= 25 ? "hot" : "";
}
function guardTheme(mode) {
  var id = R && R.pal ? R.pal.id : doc.theme, k = themeGuardKind(id);
  if (!k) return null;
  if (mode === "vivid") return id;
  if (k === "cool" && (mode === "color" || mode === "natural")) return id;
  return null;
}

// ---------- looks: the approved grades ----------
// Grading is NOT darkening (the owner, Sept 25 2026): subjects end BRIGHT and carved, on a dark
// single-hue plate. Every look is one of the two approved grades, run in the grade worker:
//   carved  - the gritty colour grade (GRIT.gradeSubject "color"): bright, textured, natural skin
//   gritty  - the same grade in black and white ("mono")
//   pop     - black and white with the kit kept in colour, re-hued into the theme ("pop")
//   vivid   - the Premier-League card grade (gradeVivid): crisp, saturated, bright
//   natural - a light touch for a photo that should stay a photo ("natural")
// Separation never comes from light: a dark halo, plate clearance and a light cap (GRIT), and
// the painted edge light is OFF unless the owner turns it up (glows looked "blinding").
var LOOKS = [
  { id: "carved",  name: "Carved",    mode: "color" },
  { id: "gritty",  name: "Gritty",    mode: "mono" },
  { id: "pop",     name: "Color pop", mode: "pop" },
  { id: "vivid",   name: "Vivid",     mode: "vivid" },
  { id: "natural", name: "Natural",   mode: "natural" }
];
function lookById(id) { for (var i = 0; i < LOOKS.length; i++) if (LOOKS[i].id === id) return LOOKS[i]; return null; }
// the look a template is showing: the owner's pick for it, else the template's own default
function lookOf(t) {
  t = t || (R && R.tpl) || TPL[doc.tpl];
  var id = doc.lookBy && doc.lookBy[t.id];
  return lookById(id) || lookById(t.look || "carved");
}
// an inset beside a hero: grey beside a carved hero (the approved headline), natural colour otherwise
function insetMode(L) { return L.id === "carved" ? "inset" : L.id === "vivid" ? "vivid" : "natural"; }

// ---------- assets ----------
// Every image keeps its decoded original (a.im, natural size: every grade reads pristine pixels
// from it, never a defringed or resized copy) and a working copy capped at MAX_SIDE (a.img: the
// placement maths, previews and thumbnails). It is analysed once: is it a cut-out (transparent
// border), where is its alpha box, where is the HEAD (topmost blob, three measures voting), the
// NECK under it (GRIT.neckFromRows: the face box meters far better with it), the face box that
// meters the grade (GRIT.faceFromHead) and which image borders the matte touches (a photo edge:
// the hero fades toward it, posters.edge_ramp). Slots place cut-outs by the head, so any fighter
// PNG lands at the same size and spot. a.ver counts replacements under the same key, so a grade
// made for the old pixels is never shown for the new ones.
var MAX_SIDE = 2600;
var assets = {};
var aseq = 0;
function newKey() { return "a" + Date.now().toString(36) + (aseq++).toString(36); }
function blobToImage(blob) {
  return new Promise(function (res, rej) {
    var u = URL.createObjectURL(blob), im = new Image();
    im.onload = function () { res(im); setTimeout(function () { URL.revokeObjectURL(u); }, 2000); };
    im.onerror = function () { URL.revokeObjectURL(u); rej(new Error("not an image")); };
    im.src = u;
  });
}
function fetchBlob(url) {
  return fetch(url, { credentials: "same-origin" }).then(function (r) {
    if (r.status === 401) { location.reload(); throw new Error("signed out"); }
    if (!r.ok) throw new Error("HTTP " + r.status);
    return r.blob();
  });
}
function analyse(a) {
  var c = a.img, sc = Math.min(1, 420 / Math.max(c.width, c.height));
  var w = Math.max(8, Math.round(c.width * sc)), h = Math.max(8, Math.round(c.height * sc));
  var t = mkCanvas(w, h), x = t.getContext("2d", { willReadFrequently: true });
  x.drawImage(c, 0, 0, w, h);
  var d = x.getImageData(0, 0, w, h).data, clear = 0, tot = 0, i, y, xx;
  for (xx = 0; xx < w; xx++) { tot += 2; if (d[(xx) * 4 + 3] < 16) clear++; if (d[((h - 1) * w + xx) * 4 + 3] < 16) clear++; }
  for (y = 0; y < h; y++) { tot += 2; if (d[(y * w) * 4 + 3] < 16) clear++; if (d[(y * w + w - 1) * 4 + 3] < 16) clear++; }
  a.cut = clear / tot > 0.22;
  a.head = null; a.box = null; a.fbox = null; a.touch = { l: false, r: false, b: false };
  var opaque = 0, cov = 0;
  for (i = 3; i < d.length; i += 4) { if (d[i] > 250) opaque++; if (d[i] > 128) cov++; }
  a.alpha = opaque < w * h * 0.995;
  a.cover = cov / (w * h);
  if (!a.cut) return;
  var rows = new Array(h), x0 = w, x1 = -1, y0 = h, y1 = -1;
  for (y = 0; y < h; y++) {
    var L = -1, R = -1, o = y * w * 4;
    for (xx = 0; xx < w; xx++) if (d[o + xx * 4 + 3] > 110) { if (L < 0) L = xx; R = xx; }
    if (L >= 0) { rows[y] = [L, R]; if (L < x0) x0 = L; if (R > x1) x1 = R; if (y < y0) y0 = y; y1 = y; }
  }
  if (y1 < 0) { a.cut = false; return; }
  a.box = { x: x0 / sc, y: y0 / sc, w: (x1 - x0 + 1) / sc, h: (y1 - y0 + 1) / sc };
  // A side counts as a PHOTO EDGE (the hero fades toward it) only when the full-resolution matte
  // runs solid (alpha > 250) down the outermost two columns for at least 3 % of the height: that is
  // what a subject cut at the frame edge produces. UFC crops its masters to the alpha box, so an
  // elbow always grazes the border; on a 420 px copy that elbow smeared into the edge column and
  // both sides were ramped, dissolving the arms into a pale fog.
  a.touch.l = sideRun(a, 0); a.touch.r = sideRun(a, 1);
  for (xx = 0; xx < w; xx++) if (d[((h - 1) * w + xx) * 4 + 3] > 128) a.touch.b = true;
  // The head ends where its height reaches 1.3x its widest row (the chin). A jump test
  // is not enough: shoulders usually widen GRADUALLY from the neck, so a running maximum
  // follows them down and measures the shoulders as the head (fighters came out half size).
  // No single measure survives every fighter, so three vote and the median wins:
  //   chin  - widest row until the height reaches 1.3x it (fails on long hair over the neck)
  //   crown - the top of a head is round: width^2 / (8 x depth) is its radius (fails on a bun)
  //   frame - shoulder width / 2.6 (fails on a belt over the shoulder)
  // Calibrated Sept 25 2026 on bald, curly, short-haired and belted UFC cut-outs.
  function sp(yy) { var q = rows[yy]; return q ? q[1] - q[0] + 1 : 0; }
  var maxW = 0;
  for (y = y0; y <= y1; y++) {
    var sw = sp(y);
    if (!sw) continue;
    if (y - y0 > 4 && sw > maxW * 2.2) break;
    if (sw > maxW) maxW = sw;
    if (y - y0 + 1 >= maxW * 1.3 && y - y0 > 6) break;
  }
  var est = [];
  for (var tt = 2; tt <= 16; tt++) { var s0 = sp(y0 + tt); if (s0) est.push(s0 * s0 / (8 * tt) * 2); }
  est.sort(function (p, q) { return p - q; });
  var crown = est.length ? est[est.length >> 1] : maxW, shoulder = 0;
  for (y = y0; y <= Math.min(y1, y0 + Math.round(crown * 2.4)); y++) shoulder = Math.max(shoulder, sp(y));
  var vote = [maxW, crown, shoulder / 2.6].sort(function (p, q) { return p - q; });
  var hw = Math.max(3, vote[1]), hh = hw * 1.3, sumC = 0, nC = 0;
  for (y = y0; y <= Math.min(y1, y0 + hh); y++) if (rows[y]) { sumC += (rows[y][0] + rows[y][1]) / 2; nC++; }
  a.head = { cx: (sumC / Math.max(1, nC)) / sc, cy: (y0 + hh * 0.5) / sc, w: hw / sc, h: hh / sc, top: y0 / sc };
  // the neck hook (grade_gritty API 5): the face box then meters the face, not the forehead
  var nk = GRIT.neckFromRows(rows, y0, hw);
  if (nk) { a.head.neckY = nk.y / sc; a.head.neckW = nk.w / sc; a.head.neckCx = nk.cx / sc; }
  a.fbox = GRIT.faceFromHead(a.head, a.w, a.h);
  // A UFC full-body master is 3324 px tall and cropped to the fighter, so the face is a steady
  // share of the height (.080 of it wide; measured on 66 masters): when the neck-hook box strays
  // outside .8 - 1.3 of that (long hair falling past the neck made Natalia Silva's box 1.7x wide and
  // her Color pop hero a tiny figure) the head-only or the neck box, whichever sits closer, is used.
  var T = a.ufc && a.box.h / Math.max(1, a.box.w) > 2.2 && a.box.h > 0.85 * a.h ? 0.080 * a.box.h : 0;
  if (T && a.fbox && a.head.neckW) {
    var C = GRIT.FACE_CAL, nwv = a.head.neckW, fwN = C.neck.nw * nwv, fhN = C.neck.nh * nwv;
    var fN = [(a.head.neckCx == null ? a.head.cx : a.head.neckCx) + C.neck.nx * nwv - fwN / 2, a.head.neckY + C.neck.nb * nwv - fhN, fwN, fhN];
    var fH = GRIT.faceFromHead({ cx: a.head.cx, cy: a.head.cy, w: a.head.w, h: a.head.h, top: a.head.top }, a.w, a.h);
    var lr = function (f) { return Math.abs(Math.log(f[2] / T)); };
    var cur = a.fbox[2] / T;
    if (cur < 0.8 || cur > 1.3) {
      var best = lr(fN) < lr(fH) ? fN : fH;
      if (lr(best) < lr(a.fbox)) a.fbox = [clamp(best[0], 0, Math.max(0, a.w - best[2])), clamp(best[1], 0, Math.max(0, a.h - best[3])), best[2], best[3]];
    }
  }
}
// the longest run of rows where BOTH outermost columns of side (0 left, 1 right) are solid, as a
// share of the height, at the original resolution: true at 3 % or more
function sideRun(a, side) {
  var nw = a.nw, nh = a.nh;
  if (nw < 4 || nh < 4) return false;
  var c = mkCanvas(2, nh), x = c.getContext("2d", { willReadFrequently: true });
  x.drawImage(a.im, side ? nw - 2 : 0, 0, 2, nh, 0, 0, 2, nh);
  var d = x.getImageData(0, 0, 2, nh).data, run = 0, best = 0;
  for (var y = 0; y < nh; y++) {
    if (d[y * 8 + 3] > 250 && d[y * 8 + 7] > 250) { run++; if (run > best) best = run; } else run = 0;
  }
  return best >= 0.03 * nh;
}
function makeAsset(im, meta) {
  meta = meta || {};
  var iw = im.naturalWidth || im.width, ih = im.naturalHeight || im.height;
  var s = Math.min(1, MAX_SIDE / Math.max(iw, ih));
  var c = mkCanvas(iw * s, ih * s), cx = c.getContext("2d");
  cx.imageSmoothingEnabled = true; cx.imageSmoothingQuality = "high";
  cx.drawImage(im, 0, 0, c.width, c.height);
  var old = meta.key ? assets[meta.key] : null;
  var a = { key: meta.key || newKey(), im: im, nw: iw, nh: ih, img: c, w: c.width, h: c.height, face: meta.face || "",
            src: meta.src || "", name: meta.name || "", ver: old ? old.ver + 1 : 0,
            ufc: !!meta.ufc || /ufcimg|[/]ufc[/]/.test(meta.src || "") };
  analyse(a);
  c.__tag = "a" + a.key + ":" + a.ver;
  try { im.__tag = "A" + a.key + ":" + a.ver; } catch (e) { }
  assets[a.key] = a;
  fxEpoch++;
  return a;
}
// an asset region (a.w x a.h px) resampled to ow x oh from the decoded ORIGINAL, as RGBA bytes
function assetPixels(a, rx, ry, rw, rh, ow, oh, flip) {
  var c = mkCanvas(ow, oh), x = c.getContext("2d", { willReadFrequently: true }), k = a.nw / a.w;
  x.imageSmoothingEnabled = true; x.imageSmoothingQuality = "high";
  if (flip) { x.translate(ow, 0); x.scale(-1, 1); }
  x.drawImage(a.im, rx * k, ry * k, rw * k, rh * k, 0, 0, ow, oh);
  return x.getImageData(0, 0, ow, oh).data;
}
function canvasOfBytes(bytes, w, h) {
  var c = mkCanvas(w, h), x = c.getContext("2d");
  x.putImageData(new ImageData(bytes instanceof Uint8ClampedArray ? bytes : new Uint8ClampedArray(bytes.buffer), w, h), 0, 0);
  return c;
}

// ---------- the grade worker ----------
// The approved grades are heavy (the exact gritty grade is 2-4 s and ~350 MB per 1.4 Mpx hero),
// so they run in Web Workers built from a blob of the page's OWN library source (gritFactory,
// vividLib and runJob, handed over by Function.prototype.toString), never on the main thread.
// The studio CSP allows exactly that and nothing more (worker-src blob:). A browser that cannot
// start a worker still works: the same runJob runs on the main thread, one job per tick.
// runJob is PURE: it sees only its message and the two libraries.
function runJob(J) {
  var t0 = Date.now(), out = null, i;
  function bytesOf(img) {
    var n = img.w * img.h * 4, b = new Uint8ClampedArray(n), d = img.data;
    for (var q = 0; q < n; q++) b[q] = d[q] * 255 + 0.5;
    return b;
  }
  function bytesOfPlanes(cv) {
    var n = cv.w * cv.h, b = new Uint8ClampedArray(n * 4), c0 = cv.c[0], c1 = cv.c[1], c2 = cv.c[2];
    for (var q = 0; q < n; q++) { b[q * 4] = c0[q] * 255 + 0.5; b[q * 4 + 1] = c1[q] * 255 + 0.5; b[q * 4 + 2] = c2[q] * 255 + 0.5; b[q * 4 + 3] = 255; }
    return b;
  }
  function alphaF(img) { var n = img.w * img.h, A = new Float32Array(n); for (var q = 0; q < n; q++) A[q] = img.data[q * 4 + 3]; return A; }
  function cropF(img, x0, y0, w, h) {
    var o = new Float32Array(w * h * 4), d = img.data;
    for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
      var sx = x + x0, sy = y + y0;
      if (sx < 0 || sy < 0 || sx >= img.w || sy >= img.h) continue;
      var a = (y * w + x) * 4, b = (sy * img.w + sx) * 4;
      o[a] = d[b]; o[a + 1] = d[b + 1]; o[a + 2] = d[b + 2]; o[a + 3] = d[b + 3];
    }
    return { w: w, h: h, data: o };
  }
  // ---- the head geometry, made robust (card jobs) ----
  // GVL.headGeometry seeds its fixed point from the 5th row under the crown: on curly or spiky
  // hair that row is a tuft, the 97th-percentile loop converges on it and the head comes out a few
  // px wide (Payton Talbott: 6.6 px at 1800 tall), so the card scaled the image ~30x and the worker
  // ran out of memory. J.hint (job px) carries the page's own analysed head (three measures vote)
  // or, for a UFC full-body master (always 3324 px tall, so the head is a steady share of it), the
  // body height: a width outside [lo, hi] x the hint is pulled into that band (under half of it,
  // it is the hint itself), and the centre is measured again at that width.
  function geomAt(A, w, h, top, hw) {
    var n = Math.max(3, Math.floor(hw)), cx0, centres = [], x, y, sx = 0, sn = 0;
    for (x = 0; x < w; x++) if (A[top * w + x] > 0.5) { sx += x; sn++; }
    cx0 = sn ? sx / sn : w / 2;
    for (y = top; y < Math.min(h, top + n); y++) {
      var o = y * w, best = null, bestK = 0, r0 = -1;
      for (x = 0; x <= w; x++) {
        var on = x < w && A[o + x] > 0.5;
        if (on && r0 < 0) r0 = x;
        if (!on && r0 >= 0) {
          var r1 = x - 1, k = (r0 <= cx0 && cx0 <= r1) ? 0 : Math.min(Math.abs(r0 - cx0), Math.abs(r1 - cx0));
          if (best === null || k < bestK) { best = [r0, r1]; bestK = k; }
          r0 = -1;
        }
      }
      centres.push(best ? (best[0] + best[1]) / 2 : cx0);
      if (best && centres.length < 20) cx0 = centres[centres.length - 1];
    }
    var a0 = Math.floor(n * 0.3), a1 = Math.max(a0 + 1, Math.floor(n * 0.9));
    var cs = centres.slice(a0, Math.min(a1, centres.length)).sort(function (p, q) { return p - q; });
    var cx = cs.length ? (cs.length % 2 ? cs[cs.length >> 1] : 0.5 * (cs[(cs.length >> 1) - 1] + cs[cs.length >> 1])) : cx0;
    return { top: top, cx: cx, hw: hw, n: n, fixed: true };
  }
  function robustGeom(A, w, h, hint) {
    var gm = GVL.headGeometry(A, w, h);
    if (!gm) return null;
    var ref = hint && hint.hw > 4 ? hint.hw : 0, hw = gm.hw;
    if (!ref) {
      // no hint: floor the width at .08 of the alpha box across the top .15 of the rows
      var x0 = w, x1 = -1, y1 = Math.min(h, gm.top + Math.ceil(0.15 * h));
      for (var yy = gm.top; yy < y1; yy++) for (var xx = 0; xx < w; xx++) if (A[yy * w + xx] > 0.5) { if (xx < x0) x0 = xx; if (xx > x1) x1 = xx; }
      if (x1 >= x0) hw = Math.max(hw, 0.08 * (x1 - x0 + 1));
    } else if (hw < 0.5 * ref) hw = ref;
    else hw = clamp(hw, (hint.lo || 0.5) * ref, (hint.hi || 2.0) * ref);
    return Math.abs(hw - gm.hw) < 0.5 ? gm : geomAt(A, w, h, gm.top, hw);
  }
  // framePlacement has no ceiling: bound the scale at 3x and the scaled source at 12 Mpx (it is
  // at most 1.25 x the head scale, which a head width sets)
  function boundScale(gm, sw, sh) {
    var smax = Math.min(3, Math.sqrt(12e6 / Math.max(1, sw * sh))), hwMin = 1.25 * J.headFrac * J.cw / smax;
    if (gm.hw >= hwMin) return gm;
    return { top: gm.top, cx: gm.cx, hw: hwMin, n: Math.floor(hwMin), fixed: true };
  }
  // the source's own fine texture: lc at size 2 (GRIT.lcValues) on the 640-wide reference scale,
  // inside the face ellipse the grade meters (fw .40 x fh .44), solid alpha only
  function skinLc2(img, face, px) {
    var P = GRIT.splitRGBA(img), Lm = GRIT.lumaMap(P.rgb), w = img.w, h = img.h;
    var Lr = GRIT.toRef(Lm, w, h, px), Ar = GRIT.toRef(P.a, w, h, px), k = Lr.w / w;
    var E = GRIT.ellipseMask(Lr.w, Lr.h, (face[0] + face[2] / 2) * k, (face[1] + face[3] / 2) * k, face[2] * 0.40 * k, face[3] * 0.44 * k);
    var reg = new Uint8Array(Lr.w * Lr.h), cnt = 0;
    for (var q = 0; q < reg.length; q++) if (E[q] > 0.5 && Ar.d[q] > 0.95) { reg[q] = 1; cnt++; }
    return cnt > 50 ? GRIT.lcValues(Lr.d, Lr.w, Lr.h, reg, [2])[0] : -1;
  }
  // ---- owner law 1 on a graded subject (float RGBA 0..1, in place) ----
  // a cool (violet) poster: a saturated red kit is turned toward a muted warm tone (GRIT.coolReds,
  // the natural inset's rule), only when there is real red on the subject (share of opaque pixels
  // of hue 344-8 and saturation > .45 above 2 %), so skin and lips are never touched. A red
  // (crimson) poster: blue is muted like the gritty grade's own blue guard (hue 172-282, x .1).
  // face: [x, y, w, h] of the face (image px) or null. On a cool theme the red share and the re-hue
  // only count the KIT: the face and the neck under it (the box grown by a quarter each side, from
  // a third above it to half a face below) are left out, so warm skin and lips never move.
  function themeGuard(img, id, face) {
    var th = id ? GRIT.THEMES[id] : null;
    if (!th) return img;
    var n = img.w * img.h, d = img.data, q, cool = GRIT.isCool(id), hd = Math.min(th.hue, 360 - th.hue), W0 = img.w;
    if (cool) {
      var op = 0, reds = 0, mk = new Float32Array(n);
      var fx0 = face ? face[0] - 0.25 * face[2] : 0, fx1 = face ? face[0] + 1.25 * face[2] : -1;
      var fy0 = face ? face[1] - 0.33 * face[3] : 0, fy1 = face ? face[1] + 1.5 * face[3] : -1, fe = face ? Math.max(2, 0.15 * face[2]) : 1;
      for (q = 0; q < n; q++) {
        var xq = q % W0, yq = (q - xq) / W0;
        // 0 inside the face zone, 1 outside, feathered over fe px
        var inX = Math.min(xq - fx0, fx1 - xq), inY = Math.min(yq - fy0, fy1 - yq), wq = face ? 1 - smooth(0, fe, Math.min(inX, inY)) : 1;
        mk[q] = wq;
        if (d[q * 4 + 3] < 0.5 || wq < 0.5) continue;
        op++;
        var h0 = GRIT.hueDeg(d[q * 4], d[q * 4 + 1], d[q * 4 + 2]), dh = Math.abs(h0 - 356), dist = Math.min(dh, 360 - dh);
        if (dist <= 12 && GRIT.hsvSat(d[q * 4], d[q * 4 + 1], d[q * 4 + 2]) > 0.45) reds++;
      }
      if (!op || reds / op <= 0.02) return img;
      // the kit's reds (hue within ~28 degrees of 355, so a magenta-red kit counts too) lose most of
      // their chroma about their own luminance: a dark, dusty kit, never a red pop (GRIT.coolReds
      // alone turns a 345-degree kit only a few degrees and leaves it saturated)
      for (q = 0; q < n; q++) {
        var m0 = mk[q];
        if (m0 <= 0 || d[q * 4 + 3] <= 0) continue;
        var rr = d[q * 4], rg = d[q * 4 + 1], rb = d[q * 4 + 2], rh = GRIT.hueDeg(rr, rg, rb), rs = GRIT.hsvSat(rr, rg, rb);
        var rd = Math.abs(rh - 355), rdist = Math.min(rd, 360 - rd), rw = smooth(28, 14, rdist) * smooth(0.30, 0.50, rs) * m0;
        if (rw <= 0) continue;
        var rL = 0.2126 * rr + 0.7152 * rg + 0.0722 * rb, rk = 1 - 0.9 * rw;
        d[q * 4] = clamp(rL + (rr - rL) * rk, 0, 1); d[q * 4 + 1] = clamp(rL + (rg - rL) * rk, 0, 1); d[q * 4 + 2] = clamp(rL + (rb - rL) * rk, 0, 1);
      }
    } else if (hd <= 25) {
      for (q = 0; q < n; q++) {
        var r = d[q * 4], gg = d[q * 4 + 1], b = d[q * 4 + 2], hv = GRIT.hueDeg(r, gg, b), sv = GRIT.hsvSat(r, gg, b);
        var bw = smooth(172, 192, hv) * (1 - smooth(262, 282, hv)) * smooth(0.10, 0.25, sv);
        if (bw <= 0) continue;
        var L = 0.2126 * r + 0.7152 * gg + 0.0722 * b, kk = 1 - 0.9 * bw;
        d[q * 4] = clamp(L + (r - L) * kk, 0, 1); d[q * 4 + 1] = clamp(L + (gg - L) * kk, 0, 1); d[q * 4 + 2] = clamp(L + (b - L) * kk, 0, 1);
      }
    }
    return img;
  }
  if (J.type === "subject") {
    var g;
    if (J.mode === "vivid") {
      var fb = J.face ? [Math.floor(J.face[0]), Math.floor(J.face[1]), Math.floor(J.face[0] + J.face[2]), Math.floor(J.face[1] + J.face[3])] : null;
      g = GVL.gradeVivid(GVL.floatImage(J.rgba, J.w, J.h), { fringe: !J.photo, faceBox: fb });
    } else {
      var img = { w: J.w, h: J.h, data: J.rgba };
      if (J.heal && J.face) {
        var P = GRIT.splitRGBA(img);
        img = GRIT.joinRGBA(GRIT.healKicker(P.rgb, P.a, GRIT.kickerZone(J.w, J.h, J.face), J.w, J.h, J.px), P.a, J.w, J.h);
      }
      var look = J.look, lc2 = -1;
      if (J.adapt && J.face && (J.mode === "color" || J.mode === "natural")) {
        lc2 = skinLc2(img, J.face, J.px);
        if (lc2 >= 0 && lc2 < J.adapt.thr) {
          var lk2 = {}, q2;
          if (look) for (q2 in look) lk2[q2] = look[q2];
          var tt0 = GRIT.GRADE_DEFAULTS.tex_target, gr0 = GRIT.GRADE_DEFAULTS.grain;
          lk2.tex_target = { color: tt0.color * J.adapt.tex, natural: tt0.natural * J.adapt.tex, mono: tt0.mono, pop: tt0.pop, inset: tt0.inset };
          lk2.grain = { color: gr0.color * J.adapt.grain, natural: gr0.natural * J.adapt.grain, mono: gr0.mono, pop: gr0.pop, inset: gr0.inset };
          lk2.upscale_tex = GRIT.GRADE_DEFAULTS.upscale_tex * J.adapt.up;
          if (J.adapt.core != null) lk2.core_k = J.adapt.core;
          if (J.adapt.K != null) lk2.K_k = J.adapt.K;
          look = lk2;
        }
      }
      g = GRIT.gradeSubject(img, J.mode, { px: J.px, face: J.face, upscale: J.upscale, seed: J.seed, theme: J.theme,
        bodyRows: J.bodyRows, torsoCap: J.torsoCap, look: look, fast: J.fast });
      if (J.heal && J.face && !J.fast) g = GRIT.tameKickerRgb(g, GRIT.kickerZone(g.w, g.h, J.face, { parts: ["neck"] }), J.px);
    }
    if (J.guard) themeGuard(g, J.guard, J.face);
    out = { w: g.w, h: g.h, rgba: bytesOf(g), lc2: lc2 };
  } else if (J.type === "card") {
    var raw = GVL.floatImage(J.rgba, J.w, J.h);
    // debeltPixels measures the head itself (unhinted): on a head it measures a few px wide it
    // mirrors half the FACE, so it runs only when that measure is sane
    var gm = robustGeom(alphaF(raw), raw.w, raw.h, J.hint);
    if (J.debelt && gm && !gm.fixed) { raw = GVL.debeltPixels(raw); gm = robustGeom(alphaF(raw), raw.w, raw.h, J.hint); }
    if (gm && J.kind === "body") {
      var r = GVL.chestRect(gm, raw.w, raw.h, 3.4, J.below);
      raw = cropF(raw, r[0], r[1], r[2] - r[0], r[3] - r[1]);
      gm = robustGeom(alphaF(raw), raw.w, raw.h, J.hint ? { hw: J.hint.hw, lo: J.hint.lo, hi: J.hint.hi } : null);
    }
    if (!gm) out = { none: true };
    else {
      gm = boundScale(gm, raw.w, raw.h);
      var f = GVL.frameLayer(raw, gm, J.cw, J.ch, J.headFrac, J.topFrac), sub, fbF = null;
      // a corrected head also meters the grade (faceBoxOf on the framed layer would measure the
      // tuft again): the face box is the corrected head carried into layer px
      if (gm.fixed) {
        var ps = f.place.s, pox = f.place.ox, poy = f.place.oy;
        fbF = [Math.floor(pox + (gm.cx - 0.30 * gm.hw) * ps), Math.floor(poy + (gm.top + 0.32 * gm.hw) * ps),
               Math.floor(pox + (gm.cx + 0.30 * gm.hw) * ps), Math.floor(poy + (gm.top + 1.05 * gm.hw) * ps)];
      }
      if (!J.mode || J.mode === "vivid") sub = fbF ? GVL.gradeVivid(f.img, { faceBox: fbF }) : GVL.gradeVivid(f.img);
      else {
        // another look inside a card: the approved gritty grade on the card-framed subject
        var fb2 = fbF || GVL.faceBoxOf(alphaF(f.img), f.img.w, f.img.h);
        sub = GRIT.gradeSubject(f.img, J.mode, { px: J.px || 1080 / 640, face: fb2 ? [fb2[0], fb2[1], fb2[2] - fb2[0], fb2[3] - fb2[1]] : null,
                                                  seed: 7, theme: J.theme });
      }
      if (J.guard) {
        var gps = f.place.s, gfw = gm.hw * 0.8 * gps;
        themeGuard(sub, J.guard, [f.place.ox + gm.cx * gps - gfw / 2, f.place.oy + (gm.top + 0.3 * gm.hw) * gps, gfw, gm.hw * 1.05 * gps]);
      }
      out = { w: sub.w, h: sub.h, f32: sub.data, crop: f.crop, hw: gm.hw, fixed: !!gm.fixed };
    }
  } else if (J.type === "photo") {
    var n = J.ow * J.oh, pr = GVL.gvResample8(J.rgb, J.w, J.h, 3, J.ow, J.oh), mr = J.mask ? GVL.gvResample8(J.mask, J.w, J.h, 1, J.ow, J.oh) : null;
    var im = { w: J.ow, h: J.oh, data: new Float32Array(n * 4) }, mk = new Float32Array(n);
    for (i = 0; i < n; i++) {
      im.data[i * 4] = pr[i * 3] / 255; im.data[i * 4 + 1] = pr[i * 3 + 1] / 255; im.data[i * 4 + 2] = pr[i * 3 + 2] / 255;
      im.data[i * 4 + 3] = 1; mk[i] = mr ? mr[i] / 255 : 1;
    }
    var gp;
    if (J.mode && J.mode !== "vivid") gp = GRIT.gradeSubject(im, J.mode, { px: 1080 / 640, face: [J.box[0], J.box[1], J.box[2] - J.box[0], J.box[3] - J.box[1]], seed: 7, theme: J.theme });
    else gp = mr ? GVL.gradePhoto(im, mk, J.box, GVL.PHOTO_GRADE) : GVL.gradeVivid(im, { fringe: false, faceBox: J.box, params: GVL.PHOTO_GRADE });
    for (i = 0; i < n; i++) gp.data[i * 4 + 3] = 1;
    if (J.guard) themeGuard(gp, J.guard, [J.box[0], J.box[1], J.box[2] - J.box[0], J.box[3] - J.box[1]]);
    out = { w: J.ow, h: J.oh, rgba: bytesOf(GVL.photoFoot(gp)) };
  } else if (J.type === "plate") {
    var pc = GRIT.gradePlate({ w: J.w, h: J.h, data: J.rgba }, J.theme, { px: J.px, seed: J.seed, focus: J.focus, grain: J.grain });
    out = { w: J.w, h: J.h, rgba: bytesOfPlanes(pc) };
  } else if (J.type === "inset") {
    var d = J.d, sq, face = J.face;
    var src = { w: J.w, h: J.h, data: GVL.floatImage(J.rgba, J.w, J.h).data };
    if (J.src === "head") {
      // posters.ufc_head_on_sweep: t0 = first row with alpha > .5, hc = the centre of the alpha > .5
      // columns in rows t0 .. t0 + .45 (h - t0); the head's top-left lands at d/2 - hc, .07 d - t0
      var t0r = -1, y, x, cL = 1e9, cR = -1;
      for (y = 0; y < src.h && t0r < 0; y++) for (x = 0; x < src.w; x++) if (src.data[(y * src.w + x) * 4 + 3] > 0.5) { t0r = y; break; }
      if (t0r < 0) t0r = 0;
      var yb = Math.floor(t0r + 0.45 * (src.h - t0r));
      for (y = t0r; y < yb; y++) for (x = 0; x < src.w; x++) if (src.data[(y * src.w + x) * 4 + 3] > 0.5) { if (x < cL) cL = x; if (x > cR) cR = x; }
      var hc = cR >= 0 ? (cL + cR) / 2 : src.w / 2;
      sq = GRIT.headOnSweep(src, d / 2 - hc + (J.dx || 0), 0.07 * d - t0r + (J.dy || 0), d, J.tone, null, 11, 0.35);
      face = [d / 2 - 0.15 * d, 0.07 * d + 0.10 * d, 0.30 * d, 0.40 * d];
    } else if (J.src === "cut") sq = GRIT.headOnSweep(src, 0, 0, d, J.tone, null, 11, 0.30);
    else sq = src;
    var ri = GRIT.circleInset(sq, d, J.px, { mode: J.mode, face: face, seed: J.seed, upscale: J.upscale, theme: J.theme, ringColor: J.ring || "#FFFFFF" });
    out = { w: ri.img.w, h: ri.img.h, rgba: bytesOf(ri.img), m: ri.m };
  } else throw new Error("unknown job " + J.type);
  out.ms = Date.now() - t0;
  return out;
}
// the worker's message handler (runs INSIDE the worker)
function workerOnMessage(e) {
  var m = e.data, r, tr = [];
  try {
    r = runJob(m.job);
    if (r.rgba) tr.push(r.rgba.buffer);
    if (r.f32) tr.push(r.f32.buffer);
    self.postMessage({ id: m.id, ok: true, out: r }, tr);
  } catch (err) { self.postMessage({ id: m.id, ok: false, error: String((err && err.message) || err) }); }
}
function workerSource() {
  return ["var GRIT = (" + gritFactory.toString() + ")();", clamp.toString(), lerp.toString(), smooth.toString(), boxBlur.toString(),
          vividLib.toString(), "var GVL = vividLib();", runJob.toString(), "self.onmessage = " + workerOnMessage.toString() + ";"].join(NL);
}
var GW = { pool: [], max: 1, queue: [], seq: 0, url: null, broken: false, busyMain: false };
// LOW_MEM: a device that should grade smaller and one job at a time. Safari (so every iPhone) has no
// navigator.deviceMemory, so a touch-first device without it counts as low memory: the ~250 MB per
// megapixel an exact grade needs is exactly what an iPhone tab runs out of.
var LOW_MEM = (function () {
  var dm = navigator.deviceMemory;
  if (dm) return dm < 4;
  var coarse = false;
  try { coarse = !!(window.matchMedia && window.matchMedia("(pointer: coarse)").matches); } catch (e) { coarse = false; }
  return (navigator.maxTouchPoints || 0) > 1 && coarse;
})();
(function () {
  var hc = navigator.hardwareConcurrency || 2;
  GW.max = hc >= 4 && !LOW_MEM ? 2 : 1;
})();
function gwWorker() {
  if (GW.broken) return null;
  if (GW.pool.length >= GW.max) return null;
  try {
    if (!GW.url) GW.url = URL.createObjectURL(new Blob([workerSource()], { type: "text/javascript" }));
    var w = new Worker(GW.url), slot = { w: w, busy: null };
    w.onmessage = function (e) { var q = slot.busy; slot.busy = null; if (q && q.id === e.data.id) jobFinish(q, e.data); gwPump(); };
    w.onerror = function (e) {
      var q = slot.busy; slot.busy = null;
      try { w.terminate(); } catch (x) { }
      GW.pool.splice(GW.pool.indexOf(slot), 1);
      if (q) jobFinish(q, { ok: false, error: (e && e.message) || "worker failed" });
      if (!GW.pool.length) GW.broken = true;
      gwPump();
    };
    GW.pool.push(slot);
    return slot;
  } catch (err) { GW.broken = true; return null; }
}
function gwNext() {
  var best = -1;
  for (var i = 0; i < GW.queue.length; i++) {
    var q = GW.queue[i];
    if (best < 0 || q.prio < GW.queue[best].prio || (q.prio === GW.queue[best].prio && q.t < GW.queue[best].t)) best = i;
  }
  return best < 0 ? null : GW.queue.splice(best, 1)[0];
}
function gwPump() {
  while (GW.queue.length) {
    var slot = null;
    for (var i = 0; i < GW.pool.length; i++) if (!GW.pool[i].busy) { slot = GW.pool[i]; break; }
    if (!slot) slot = gwWorker();
    if (!slot) break;
    var q = gwNext();
    if (!q) break;
    var m;
    try { m = q.make(); } catch (err) { jobFinish(q, { ok: false, error: String(err && err.message || err) }); continue; }
    if (!m) { jobFinish(q, { ok: false, error: "no source" }); continue; }
    q.post = m.post; q.id = ++GW.seq; q.t0 = Date.now();
    slot.busy = q;
    slot.w.postMessage({ id: q.id, job: m.job }, m.transfer || []);
  }
  // no worker at all: the same runJob on the main thread, one per tick
  if (GW.broken && GW.queue.length && !GW.busyMain) {
    GW.busyMain = true;
    setTimeout(function () {
      GW.busyMain = false;
      var q = gwNext();
      if (!q) return;
      try {
        var m = q.make();
        q.post = m.post; q.t0 = Date.now();
        jobFinish(q, { ok: true, out: runJob(m.job) });
      } catch (err) { jobFinish(q, { ok: false, error: String(err && err.message || err) }); }
      gwPump();
    }, 0);
  }
}

// ---------- the job cache ----------
// job(key, make, prio, tag): the finished output for key, or null while it is being made (it is
// queued once). prio: 0 export, 1 on-screen preview, 2 on-screen exact, 5 gallery thumbnail.
// A newer request with the same tag (one slot of one template) drops the older QUEUED one, so
// dragging a fighter never leaves a queue of stale grades. Finished outputs are kept up to a
// pixel budget, least recently used first out.
var JOBS = {}, useClock = 0, jobStats = { n: 0, ms: 0, byType: {}, log: [] };
var JOB_PIX_MAX = 48e6;
// a failed key remembers how often it failed, so an editor render retries it with a growing pause
// (15 s, 30 s, 60 s, then never on its own) instead of re-running a job that cannot fit every 15 s
var jobFails = {};
function jobPeek(key) { var e = JOBS[key]; if (e && e.st === "done") { e.used = ++useClock; return e.out; } return null; }
function job(key, make, prio, tag) {
  var e = JOBS[key];
  // a failed job may be tried again after a while (a worker that ran out of memory, a blip)
  if (e && e.st === "err") {
    var nf = jobFails[key] || 1;
    if (nf <= 3 && Date.now() - (e.t || 0) > 15000 * Math.pow(2, nf - 1)) { delete JOBS[key]; e = null; }
  }
  if (e) {
    e.used = ++useClock;
    if (e.st === "done") return e.out;
    if (e.st === "pend" && e.q && prio < e.q.prio) e.q.prio = prio;
    return null;
  }
  if (tag) {
    for (var i = GW.queue.length - 1; i >= 0; i--) {
      var o = GW.queue[i];
      if (o.tag === tag && o.key !== key) {
        // a dropped job releases whoever waits on it (an export, the idle hook) instead of hanging them
        GW.queue.splice(i, 1);
        var e0 = JOBS[o.key];
        delete JOBS[o.key];
        if (e0) e0.waiters.forEach(function (f) { f(); });
      }
    }
  }
  e = JOBS[key] = { st: "pend", used: ++useClock, waiters: [] };
  e.q = { key: key, make: make, prio: prio, tag: tag || "", t: ++GW.seq };
  GW.queue.push(e.q);
  gwPump();
  return null;
}
function jobFinish(q, msg) {
  var e = JOBS[q.key];
  if (!e) return;
  e.q = null;
  if (msg.ok && msg.out && !msg.out.none) {
    try { e.out = q.post ? q.post(msg.out) : msg.out; e.st = "done"; }
    catch (err) { e.st = "err"; e.error = String(err && err.message || err); }
    e.pix = (msg.out.w || 0) * (msg.out.h || 0);
    var ty = q.key.split("|")[0], ms = msg.out.ms || (Date.now() - q.t0);
    jobStats.n++; jobStats.ms += ms;
    var b = jobStats.byType[ty] || (jobStats.byType[ty] = { n: 0, ms: 0, max: 0 });
    b.n++; b.ms += ms; b.max = Math.max(b.max, ms);
    jobStats.log.push([ty, /[|]f$/.test(q.key) ? "fast" : "exact", msg.out.w + "x" + msg.out.h, ms, msg.out.lc2 == null ? "" : Math.round(msg.out.lc2 * 10000) / 10000, q.key.split("|")[1]]);
    if (jobStats.log.length > 200) jobStats.log.shift();
  } else {
    e.st = "err"; e.error = msg.error || "empty"; e.t = Date.now();
    jobFails[q.key] = (jobFails[q.key] || 0) + 1;
    if (window.console && msg.error) console.warn("grade job failed", q.key, msg.error);
  }
  var ws = e.waiters; e.waiters = [];
  ws.forEach(function (f) { f(); });
  jobEvict();
  noteJobDone(q.key);
}
function jobEvict() {
  var ks = Object.keys(JOBS), tot = 0, done = [];
  ks.forEach(function (k) { var e = JOBS[k]; if (e.st === "done") { tot += e.pix || 0; done.push(k); } });
  if (tot <= JOB_PIX_MAX) return;
  done.sort(function (p, q) { return JOBS[p].used - JOBS[q].used; });
  for (var i = 0; i < done.length && tot > JOB_PIX_MAX; i++) {
    var e = JOBS[done[i]];
    if (useClock - e.used < 40) continue;
    tot -= e.pix || 0;
    delete JOBS[done[i]];
  }
}
// resolves when every key is finished (done or failed)
function jobsDone(keys) {
  return Promise.all(keys.map(function (k) {
    var e = JOBS[k];
    if (!e || e.st !== "pend") return Promise.resolve();
    return new Promise(function (res) { e.waiters.push(res); });
  }));
}
function jobsPending() { var n = 0; for (var k in JOBS) if (JOBS[k].st === "pend") n++; return n; }
// a render remembers the keys it waited for; a finished job re-renders only what needs it
var thumbDeps = {};
function noteJobDone(key) {
  if (lastR && lastR.deps && lastR.deps.indexOf(key) !== -1) requestRender();
  var again = [];
  for (var id in thumbDeps) if (thumbDeps[id].indexOf(key) !== -1) again.push(id);
  if (again.length) queueThumbs(again);
  updateGradeNote();
}
function needKey(key) { if (R && R.deps.indexOf(key) === -1) R.deps.push(key); }
// an export waits for key; a key that FAILED is listed in R.failed, and exportCanvas retries it once
// and then refuses to export (it never resolves with a preview or an ungraded image in its place).
// label names the slot for the owner ("Fighter", "Card 3").
function pend(key, label) {
  var e = JOBS[key];
  if (e && e.st === "err") { if (R.failed.indexOf(key) === -1) { R.failed.push(key); R.failedLabels.push(label || ""); } return; }
  if (R.pending.indexOf(key) === -1) R.pending.push(key);
}
function postCanvas(out, key) { var c = canvasOfBytes(out.rgba, out.w, out.h); c.__tag = "j" + (key || ("n" + (++utag))); return { c: c, w: out.w, h: out.h, m: out.m || 0 }; }
function gradeTag(id, kind) { return (R.thumb ? "th:" : "") + R.tpl.id + ":" + id + ":" + kind; }

// ---------- exposure: the owner's nudge on a graded subject ----------
// e in -1 .. 1: luminance gain 2^(0.5 e) through a curve that keeps black at black and white at
// white (L' = gL / (1 + (g - 1) L)), applied to rgb by the luminance ratio (no hue shift). Needed
// because a meter can land slightly low (faceFromHead read Makhachev .041 darker than the lab's
// hand box): the grade is right, the face is just a touch dark, and this is the owner's lever.
function expoOf(id) { var f = doc.frames[sk(id)]; return clamp((doc.fx.expo || 0) + (f && f.e ? f.e : 0), -1, 1); }
function expoCurve(e) {
  var gn = Math.pow(2, 0.5 * e), lut = new Float32Array(256);
  for (var i = 0; i < 256; i++) { var L = i / 255; lut[i] = L > 0 ? (gn * L / (1 + (gn - 1) * L)) / L : gn; }
  return lut;
}
function expoBytes(d, e) {
  var lut = expoCurve(e);
  for (var i = 0; i < d.length; i += 4) {
    if (!d[i + 3]) continue;
    var L = Math.round(0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]), k = lut[L];
    d[i] = d[i] * k; d[i + 1] = d[i + 1] * k; d[i + 2] = d[i + 2] * k;
  }
}
var expoCache = {}, expoKeys = [];
function withExpo(res, e, key) {
  if (!res || Math.abs(e) < 0.005) return res.c;
  var k = key + "|e" + e.toFixed(2), c = expoCache[k];
  if (c) return c;
  c = mkCanvas(res.w, res.h);
  var x = c.getContext("2d", { willReadFrequently: true });
  x.drawImage(res.c, 0, 0);
  var id = x.getImageData(0, 0, res.w, res.h);
  expoBytes(id.data, e);
  x.putImageData(id, 0, 0);
  c.__tag = "e" + k;
  expoCache[k] = c; expoKeys.push(k);
  if (expoKeys.length > 16) delete expoCache[expoKeys.shift()];
  return c;
}
function expoFloat(img, e) {
  if (!img || Math.abs(e) < 0.005) return img;
  var lut = expoCurve(e), d = new Float32Array(img.data);
  for (var i = 0; i < d.length; i += 4) {
    var L = clamp(Math.round((0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) * 255), 0, 255), k = lut[L];
    d[i] = Math.min(1, d[i] * k); d[i + 1] = Math.min(1, d[i + 1] * k); d[i + 2] = Math.min(1, d[i + 2] * k);
  }
  return { w: img.w, h: img.h, data: d };
}

// ---------- the low-res compositing engine ----------
// Every separation and plate treatment of the approved look (dark halo, clearance, light cap,
// the gap fill, sinks, radial recession, haze) is a LERP of the picture toward a smooth colour by
// a smooth weight: cv = cv (1 - k) + C k. Both C and k vary slowly (the narrowest is sigma 13 px at
// 1080), so they are computed with GRIT's own maths on a copy of the picture at 1/3 size and
// drawn back up as one RGBA layer (colour C, alpha k), which source-over turns into exactly that
// lerp. A dragging fighter re-composes in a few milliseconds, and nothing waits on the worker.
// The grain is the only full-resolution pass (GRIT.finalGrain's formula on the whole canvas).
// the separation passes run at 1/3 size; while a fighter is being dragged at 1/5 (they are smooth
// fields, and the settle render on release draws them at full quality)
function fxQ() { return Math.min(1, (R && R.fast ? 220 : 360) / W); }
var lowBufs = {};
function lowBuf(tag, w, h) {
  var c = lowBufs[tag];
  if (!c || c.width !== w || c.height !== h) { c = mkCanvas(w, h); lowBufs[tag] = c; }
  return c;
}
function lowDims() { var q = fxQ(); return { q: q, w: Math.max(1, Math.round(W * q)), h: Math.max(1, Math.round(H * q)) }; }
// the picture so far at low resolution: { w, h, q, c: [R, G, B] } (0..1)
function lowPic() {
  var D = lowDims(), c = lowBuf("pic", D.w, D.h), x = c.getContext("2d", { willReadFrequently: true });
  x.setTransform(1, 0, 0, 1, 0, 0); x.globalCompositeOperation = "copy"; x.imageSmoothingEnabled = true; x.imageSmoothingQuality = "high";
  x.drawImage(g.canvas, 0, 0, D.w, D.h);
  x.globalCompositeOperation = "source-over";
  var d = x.getImageData(0, 0, D.w, D.h).data, n = D.w * D.h, P = [new Float32Array(n), new Float32Array(n), new Float32Array(n)];
  for (var i = 0; i < n; i++) { P[0][i] = d[i * 4] / 255; P[1][i] = d[i * 4 + 1] / 255; P[2][i] = d[i * 4 + 2] / 255; }
  return { w: D.w, h: D.h, q: D.q, c: P };
}
// a layer's alpha at low resolution: { w, h, q, a }
function lowAlpha(layer) {
  var D = lowDims(), c = lowBuf("al", D.w, D.h), x = c.getContext("2d", { willReadFrequently: true });
  x.setTransform(1, 0, 0, 1, 0, 0); x.clearRect(0, 0, D.w, D.h); x.imageSmoothingEnabled = true; x.imageSmoothingQuality = "high";
  x.drawImage(layer, 0, 0, D.w, D.h);
  var d = x.getImageData(0, 0, D.w, D.h).data, n = D.w * D.h, A = new Float32Array(n);
  for (var i = 0; i < n; i++) A[i] = d[i * 4 + 3] / 255;
  return { w: D.w, h: D.h, q: D.q, a: A };
}
// draw a low-res layer: col = a hex or [R, G, B] planes (0..1), alpha = a plane (0..1)
function drawLow(col, alpha, w, h, mode) {
  var c = lowBuf("lay", w, h), x = c.getContext("2d"), id = x.createImageData(w, h), d = id.data, n = w * h, i;
  var solid = typeof col === "string" ? GRIT.hex01(col) : null;
  for (i = 0; i < n; i++) {
    var o = i * 4;
    if (solid) { d[o] = solid[0] * 255 + 0.5; d[o + 1] = solid[1] * 255 + 0.5; d[o + 2] = solid[2] * 255 + 0.5; }
    else { d[o] = col[0][i] * 255 + 0.5; d[o + 1] = col[1][i] * 255 + 0.5; d[o + 2] = col[2][i] * 255 + 0.5; }
    d[o + 3] = alpha[i] * 255 + 0.5;
  }
  x.putImageData(id, 0, 0);
  if (R.fxRec) { var cp = mkCanvas(w, h); cp.getContext("2d").drawImage(c, 0, 0); R.fxRec.push({ c: cp, w: w, h: h, mode: mode }); }
  drawLowCanvas(c, w, h, mode);
}
function drawLowCanvas(c, w, h, mode) {
  g.save();
  g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = 1;
  g.globalCompositeOperation = mode || "source-over"; g.imageSmoothingEnabled = true; g.imageSmoothingQuality = "high";
  g.drawImage(c, 0, 0, w, h, 0, 0, W, H);
  g.restore();
}
// ---------- the editor's composition cache ----------
// Every separation pass reads the picture back (lowPic: a canvas flush and a getImageData) and
// blurs it, and every edit re-rendered all of them: a keystroke, a slider step or a drag frame cost
// 60-120 ms of main thread on a fast desktop. In EDITOR renders each pass is cached by what it
// depends on: its own arguments (the matte of the fighter it separates is identified by its grade
// and placement) and, for a pass that reads the picture, a signature of everything drawn so far.
// The signature starts from the document minus its text and frames (those only reach the pixels
// through a drawn image or a drawn word, which are hooked: every drawImage mixes in the image's
// tag, its arguments and the context state; every fillText its words, position and font) plus an
// epoch that moves when an asset, a texture or the fonts arrive. A pass whose inputs did not change
// is replayed from its stored layer. Exports and thumbnails never use it (R.fxc is off there), and
// an image without a tag mixes in a fresh token, so anything unaccounted for can only miss.
var fxCache = {}, fxKeys = [], fxEpoch = 0, fxOn = true, fxStats = { hit: 0, miss: 0 }, utag = 0;
var CTX2D = window.CanvasRenderingContext2D ? CanvasRenderingContext2D.prototype : null;
function sigMix(h, str) {
  str = String(str);
  for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h;
}
function tagOf(o) { return o && o.__tag ? o.__tag : "u" + (++utag); }
function ctxState(x) {
  var m = x.getTransform ? x.getTransform() : { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
  return [m.a, m.b, m.c, m.d, m.e, m.f].map(function (v) { return Math.round(v * 100) / 100; }).join(",") + "|" + x.globalAlpha + "|"
    + x.globalCompositeOperation + "|" + x.filter + "|" + (x.imageSmoothingEnabled ? 1 : 0) + "|" + x.shadowColor + "," + x.shadowBlur + ","
    + x.shadowOffsetX + "," + x.shadowOffsetY;
}
function argsOf(a, from) {
  var out = "";
  for (var i = from; i < a.length; i++) out += "," + (typeof a[i] === "number" ? Math.round(a[i] * 100) / 100 : String(a[i]));
  return out;
}
function hookCtx(x) {
  if (!CTX2D) return;
  x.drawImage = function (img) {
    if (R && R.fxc && !R.inFx) R.sig = sigMix(R.sig, "i" + tagOf(img) + argsOf(arguments, 1) + "|" + ctxState(this));
    return CTX2D.drawImage.apply(this, arguments);
  };
  x.fillText = function (t) {
    if (R && R.fxc && !R.inFx) R.sig = sigMix(R.sig, "t" + t + argsOf(arguments, 1) + "|" + this.font + "|" + (this.letterSpacing || "") + "|" + ctxState(this) + "|" + (typeof this.fillStyle === "string" ? this.fillStyle : "g"));
    return CTX2D.fillText.apply(this, arguments);
  };
  x.strokeText = function (t) {
    if (R && R.fxc && !R.inFx) R.sig = sigMix(R.sig, "s" + t + argsOf(arguments, 1) + "|" + this.font + "|" + ctxState(this) + "|" + this.lineWidth);
    return CTX2D.strokeText.apply(this, arguments);
  };
  x.putImageData = function () {
    if (R && R.fxc && !R.inFx) R.sig = sigMix(R.sig, "p" + (++utag));
    return CTX2D.putImageData.apply(this, arguments);
  };
}
function unhookCtx(x) { delete x.drawImage; delete x.fillText; delete x.strokeText; delete x.putImageData; }
function docSig() {
  return JSON.stringify(doc, function (k, v) {
    if ((k === "text" || k === "frames") && this === doc) return undefined;
    // the exposure nudge reaches the pixels only through drawn images (their tags carry it)
    if (k === "expo" && this === doc.fx) return undefined;
    return v;
  });
}
// run pass fn, or replay it. readsPic: the pass reads the picture (its key carries the signature);
// args: its inputs (mattes by their tag)
function fxCached(name, readsPic, args, fn) {
  if (!R || !R.fxc || R.inFx) { fn(); return; }
  var key = R.tag + "|" + name + "|" + (readsPic ? R.sig : "-") + "|" + (R.clipTag || "") + "|" + W + "x" + H + "|" + fxQ() + "|" + R.pal.id + "|" + JSON.stringify(args);
  var e = fxCache[key];
  R.inFx = true;
  try {
    if (e) {
      fxStats.hit++;
      for (var i = 0; i < e.length; i++) drawLowCanvas(e[i].c, e[i].w, e[i].h, e[i].mode);
    } else {
      fxStats.miss++;
      R.fxRec = [];
      try { fn(); } finally { e = R.fxRec; R.fxRec = null; }
      fxCache[key] = e; fxKeys.push(key);
      while (fxKeys.length > 48) delete fxCache[fxKeys.shift()];
    }
  } finally { R.inFx = false; }
  R.sig = sigMix(R.sig, "f" + key);
}
function fxDrop() { fxCache = {}; fxKeys = []; fxEpoch++; }
function fxShade() { return R.pal.shade; }
function fxPx(q) { return W / 640 * q; }
// GRIT.darkHalo: a soft DARK shadow around a cut-out (never a light one). near / far = [sigma ref
// px, strength, spread]
function fxHalo(al, near, far) {
  if (R && R.fxc) fxCached("fxHalo", false, [tagOf(al), near || null, far || null], function () { fxHalo0(al, near, far); }); else fxHalo0(al, near, far);
}
function fxHalo0(al, near, far) {
  if (!al) return;
  near = near || [10.0, 0.55, 0.9]; far = far || [40.0, 0.45, 0.35];
  var n = al.w * al.h, k = new Float32Array(n), px = fxPx(al.q), pairs = [near, far], i;
  for (var p = 0; p < 2; p++) {
    var hb = GRIT.gblur(al.a, al.w, al.h, pairs[p][0] * px), st = pairs[p][1], sp = pairs[p][2];
    for (i = 0; i < n; i++) { var v = clamp(hb[i] * (1 + sp), 0, 1); k[i] = 1 - (1 - k[i]) * (1 - st * v); }
  }
  for (i = 0; i < n; i++) k[i] = clamp(k[i], 0, 0.93);
  drawLow(fxShade(), k, al.w, al.h);
}
// GRIT.clearance: the PLATE near a cut-out is defocused and sunk toward the shade (capReach: +
// the light cap)
function fxClear(al, o) {
  if (R && R.fxc) fxCached("fxClear", true, [tagOf(al), o || null], function () { fxClear0(al, o); }); else fxClear0(al, o);
}
function fxClear0(al, o) {
  if (!al) return;
  o = o || {};
  var reach = o.reach == null ? 26.0 : o.reach, soft = o.soft == null ? 9.0 : o.soft, dark = o.dark == null ? 0.45 : o.dark;
  var amount = o.amount == null ? 0.85 : o.amount, P = lowPic(), px = fxPx(P.q), n = P.w * P.h, sh = GRIT.hex01(fxShade()), i, c;
  var zb = GRIT.gblur(al.a, al.w, al.h, reach * px * 0.5), cols = [], z = new Float32Array(n);
  for (c = 0; c < 3; c++) {
    var s3 = GRIT.gblur(P.c[c], P.w, P.h, soft * px), o3 = new Float32Array(n);
    for (i = 0; i < n; i++) o3[i] = s3[i] * (1 - dark) + sh[c] * dark;
    cols.push(o3);
  }
  for (i = 0; i < n; i++) z[i] = smooth(0.0, 1.0, clamp(zb[i] * 2.2, 0, 1)) * amount;
  drawLow(cols, z, P.w, P.h);
  if (o.capReach) fxCap(al, { reach: o.capReach });
}
// GRIT.lightCap: no LIT plate shape near a cut-out (light above the plate's own floor fades with
// proximity), as a lerp toward the shade by 1 - r
function fxCap(al, o) {
  if (R && R.fxc) fxCached("fxCap", true, [tagOf(al), o || null], function () { fxCap0(al, o); }); else fxCap0(al, o);
}
function fxCap0(al, o) {
  o = o || {};
  var reach = o.reach == null ? 90.0 : o.reach, keep = o.keep == null ? 0.12 : o.keep, qq = o.q == null ? 35.0 : o.q, gain = o.gain == null ? 2.6 : o.gain;
  var P = lowPic(), px = fxPx(P.q), n = P.w * P.h, sh = GRIT.hex01(fxShade()), Lsh = 0.2126 * sh[0] + 0.7152 * sh[1] + 0.0722 * sh[2], i;
  var Lc = new Float32Array(n), prox = new Float32Array(n), ring = new Uint8Array(n), cnt = 0;
  for (i = 0; i < n; i++) Lc[i] = 0.2126 * P.c[0][i] + 0.7152 * P.c[1][i] + 0.0722 * P.c[2][i];
  var pb = GRIT.gblur(al.a, al.w, al.h, reach * px * 0.5);
  for (i = 0; i < n; i++) {
    prox[i] = clamp(pb[i] * gain, 0, 1) * (al.a[i] < 0.98 ? 1 : 0);
    ring[i] = prox[i] > 0.03 && prox[i] < 0.85 && al.a[i] < 0.05 && Lc[i] > Lsh + 0.02 ? 1 : 0;
    cnt += ring[i];
  }
  if (cnt < 200 * P.q * P.q) return;
  var floor = GRIT.quantiles(Lc, ring, [qq])[0], Ls = GRIT.gblur(Lc, P.w, P.h, 2.0 * px), k = new Float32Array(n);
  for (i = 0; i < n; i++) {
    var ex = Math.max(Ls[i] - floor, 0.0), T = Math.min(Ls[i], floor) + ex * (1 - prox[i] * (1 - keep));
    k[i] = 1 - clamp((T - Lsh) / Math.max(Ls[i] - Lsh, 1e-4), 0, 1);
  }
  drawLow(fxShade(), k, P.w, P.h);
}
function poolAt(x, y, cx, cy, rx, ry) { var a = (x - cx) / rx, b = (y - cy) / ry; return a * a + b * b; }
// a smooth weight field at low res from f(x, y) in canvas px
function lowField(f) {
  var D = lowDims(), n = D.w * D.h, k = new Float32Array(n);
  for (var y = 0; y < D.h; y++) for (var x = 0; x < D.w; x++) k[y * D.w + x] = f((x + 0.5) / D.q, (y + 0.5) / D.q);
  return { w: D.w, h: D.h, k: k };
}
// GRIT.radialDark: plate recession, darker away from (cx, cy)
function fxRadial(cx, cy, rx, ry, st) {
  if (R && R.fxc) fxCached("fxRadial", false, [cx, cy, rx, ry, st], function () { fxRadial0(cx, cy, rx, ry, st); }); else fxRadial0(cx, cy, rx, ry, st);
}
function fxRadial0(cx, cy, rx, ry, st) {
  var F = lowField(function (x, y) { return smooth(0.55, 1.35, Math.sqrt(poolAt(x, y, cx, cy, rx, ry))) * st; });
  drawLow(fxShade(), F.k, F.w, F.h);
}
// GRIT.localSink: a soft pool where the plate is DEFOCUSED and sunk toward the shade
function fxSink(cx, cy, rx, ry, st, blur, dark) {
  if (R && R.fxc) fxCached("fxSink", true, [cx, cy, rx, ry, st, blur, dark], function () { fxSink0(cx, cy, rx, ry, st, blur, dark); }); else fxSink0(cx, cy, rx, ry, st, blur, dark);
}
function fxSink0(cx, cy, rx, ry, st, blur, dark) {
  blur = blur == null ? 14.0 : blur; dark = dark == null ? 0.60 : dark;
  var P = lowPic(), px = fxPx(P.q), n = P.w * P.h, sh = GRIT.hex01(fxShade()), cols = [], i;
  for (var c = 0; c < 3; c++) {
    var s3 = GRIT.gblur(P.c[c], P.w, P.h, blur * px), o3 = new Float32Array(n);
    for (i = 0; i < n; i++) o3[i] = s3[i] * (1 - dark) + sh[c] * dark;
    cols.push(o3);
  }
  var F = lowField(function (x, y) { return Math.exp(-poolAt(x, y, cx, cy, rx, ry)) * st; });
  drawLow(cols, F.k, P.w, P.h);
}
// GRIT.lightHaze: broad soft light BEHIND a head (screen: 1 - (1 - cv)(1 - col k))
function fxHaze(cx, cy, rx, ry, col, amount) {
  if (R && R.fxc) fxCached("fxHaze", false, [cx, cy, rx, ry, col, amount], function () { fxHaze0(cx, cy, rx, ry, col, amount); }); else fxHaze0(cx, cy, rx, ry, col, amount);
}
function fxHaze0(cx, cy, rx, ry, col, amount) {
  var F = lowField(function (x, y) { return Math.exp(-poolAt(x, y, cx, cy, rx, ry) * 1.8) * amount; });
  drawLow(col, F.k, F.w, F.h, "screen");
}
// GRIT.pairGap + gapFill: the plate BETWEEN two cut-outs side by side becomes one continuous,
// even, dark, defocused plate (a lit shape there read as a ghost third figure)
function fxGap(alA, alB, o) {
  if (R && R.fxc) fxCached("fxGap", true, [tagOf(alA), tagOf(alB), o || null], function () { fxGap0(alA, alB, o); }); else fxGap0(alA, alB, o);
}
function fxGap0(alA, alB, o) {
  if (!alA || !alB) return;
  o = o || {};
  var P = lowPic(), px = fxPx(P.q), n = P.w * P.h, sh = GRIT.hex01(fxShade()), Lsh = 0.2126 * sh[0] + 0.7152 * sh[1] + 0.0722 * sh[2], i, c;
  var m = GRIT.pairGap(alA.a, alB.a, P.w, P.h, px, o.gap || {});
  var blur = o.blur == null ? 16.0 : o.blur, qq = o.q == null ? 20.0 : o.q, keep = o.keep == null ? 0.15 : o.keep;
  var dark = o.dark == null ? 0.30 : o.dark, strength = o.strength == null ? 0.95 : o.strength, sel = new Uint8Array(n), cnt = 0;
  for (i = 0; i < n; i++) { sel[i] = m[i] > 0.5 ? 1 : 0; cnt += sel[i]; }
  if (cnt < 200 * P.q * P.q) return;
  var soft = [GRIT.gblur(P.c[0], P.w, P.h, blur * px), GRIT.gblur(P.c[1], P.w, P.h, blur * px), GRIT.gblur(P.c[2], P.w, P.h, blur * px)];
  var L0 = new Float32Array(n), Ls = new Float32Array(n);
  for (i = 0; i < n; i++) {
    L0[i] = 0.2126 * P.c[0][i] + 0.7152 * P.c[1][i] + 0.0722 * P.c[2][i];
    Ls[i] = 0.2126 * soft[0][i] + 0.7152 * soft[1][i] + 0.0722 * soft[2][i];
  }
  var floor = GRIT.quantiles(L0, sel, [qq])[0], cols = [new Float32Array(n), new Float32Array(n), new Float32Array(n)], wv = new Float32Array(n);
  for (i = 0; i < n; i++) {
    var T = Math.min(Ls[i], floor) + Math.max(Ls[i] - floor, 0.0) * keep;
    T = T * (1 - dark) + Lsh * dark;
    var r = clamp((T - Lsh) / Math.max(Ls[i] - Lsh, 1e-4), 0, 1);
    for (c = 0; c < 3; c++) cols[c][i] = sh[c] + (soft[c][i] - sh[c]) * r;
    wv[i] = m[i] * strength;
  }
  drawLow(cols, wv, P.w, P.h);
}
// GRIT.softSplit: the split between two plate halves as a soft dark line (gaussian profile)
function fxSplit(xc, st, sigma) {
  st = st == null ? 0.42 : st; sigma = (sigma == null ? 2.4 : sigma) * W / 1080;
  var c = lowBuf("split", W, 1), x = c.getContext("2d"), id = x.createImageData(W, 1), d = id.data;
  for (var i = 0; i < W; i++) d[i * 4 + 3] = st * Math.exp(-0.5 * ((i - xc) / sigma) * ((i - xc) / sigma)) * 255 + 0.5;
  x.putImageData(id, 0, 0);
  c.__tag = "split|" + xc + "|" + st + "|" + sigma + "|" + W;
  g.save(); g.imageSmoothingEnabled = false; g.drawImage(c, 0, 0, W, 1, 0, 0, W, H); g.restore();
}
// GRIT.verticalFade / topFade: rows sink toward the shade, (t ^ curve) x strength
function fxFade(y0, y1, st, curve, up) {
  curve = curve == null ? (up ? 1.2 : 1.4) : curve;
  var gr = g.createLinearGradient(0, up ? y1 : y0, 0, up ? y0 : y1), sh = fxShade();
  for (var i = 0; i <= 16; i++) { var t = i / 16; gr.addColorStop(t, rgba(sh, Math.pow(t, curve) * st)); }
  g.save(); g.fillStyle = gr;
  if (up) g.fillRect(0, 0, W, Math.max(y1, 0)); else g.fillRect(0, y0, W, H - y0);
  g.restore();
}
// GRIT.finalGrain: one fine luminance grain over the picture (before the type)
var noiseCache = {};
var editT = 0;
function fxGrain(seed, amount) {
  if (R.thumb || R.fast) return;
  if (R.editor && !R.exact && Date.now() - editT < 300) { scheduleSettle(); return; }
  amount = (amount == null ? 0.010 : amount) * (doc.fx.grain == null ? 1 : doc.fx.grain);
  if (amount <= 0.0005) return;
  var nk = W + "x" + H + ":" + seed, nz = noiseCache[nk];
  if (!nz) {
    var ks = Object.keys(noiseCache);
    if (ks.length > 3) delete noiseCache[ks[0]];
    nz = noiseCache[nk] = GRIT.noise(H, W, seed, 0.5 * W / 1080);
  }
  var id = g.getImageData(0, 0, W, H), d = id.data, n = W * H;
  for (var i = 0; i < n; i++) {
    var o = i * 4, L = (0.2126 * d[o] + 0.7152 * d[o + 1] + 0.0722 * d[o + 2]) / 255;
    var wv = 0.5 + 0.5 * smooth(0.02, 0.25, L) * (1 - smooth(0.75, 1.0, L)), add = nz[i] * amount * wv * 255;
    d[o] += add; d[o + 1] += add; d[o + 2] += add;
  }
  var wasIn = R.inFx;
  R.inFx = true;
  g.putImageData(id, 0, 0);
  R.inFx = wasIn;
  if (R.fxc) R.sig = sigMix(R.sig, "grain|" + seed + "|" + amount);
  R.grained = true;
}
function fillShade(k) { g.save(); g.globalAlpha = k == null ? 1 : k; g.fillStyle = fxShade(); g.fillRect(0, 0, W, H); g.restore(); }

// ---------- plates: the themed backgrounds (GRIT.gradePlate) ----------
// A texture (crowd, arena, concrete...) or a dropped background photo becomes the approved
// plate: log-flattened, detail kept around the action and defocused elsewhere, quantile-matched
// and gradient-mapped into the theme (dark, soft, single-hue). Graded in the worker at the
// 1080-wide size it is drawn at (thumbnails draw the same plate scaled down); until it arrives
// the texture is shown tinted, so the poster never flashes empty.
// src: { tex: "crowd" } or { slot: "bg" }; box [x0, y0, x1, y1] (fractions of the source) crops
// it first; flip mirrors it; fx / fy set the cover-fit anchor.
function plateJob(src, w1, h1, o) {
  var th = R.pal.id, a = src.slot ? assetOf(src.slot) : null, tex = src.tex ? plate(src.tex) : null;
  if (!a && !tex) {
    if (src.tex) texNeed(src.tex);
    return { none: true };
  }
  var f = src.slot ? frameOf(src.slot) : { x: 0, y: 0, s: 1, flip: false };
  var flip = !!src.flip !== !!f.flip, box = src.box || [0, 0, 1, 1];
  var focus = o.focus ? [Math.round(o.focus[0]), Math.round(o.focus[1]), Math.round(o.focus[2])] : null;
  var key = ["plate", a ? a.key + ":" + a.ver : "tex:" + src.tex, box.join(","), flip ? 1 : 0, w1, h1, th, o.seed || 11,
             focus ? focus.join(",") : "-", src.fx == null ? 0.5 : src.fx, src.fy == null ? 0.5 : src.fy, src.mirrorPan ? "m" : "",
             Math.round(f.x / (W / 1080)), Math.round(f.y / (W / 1080)), f.s.toFixed(3)].join("|");
  var k1 = W / 1080, res;
  if (R.exact) res = job(key, make, 0);
  else if (src.slot && !R.thumb && interacting()) { res = jobPeek(key); if (!res) scheduleSettle(); }
  else res = job(key, make, R.thumb ? 5 : 1, (R.thumb ? "th:" : "") + R.tpl.id + ":plate:" + (src.slot || src.tex) + ":" + w1 + (src.flip ? "f" : "") + (src.mirrorPan ? "m" : ""));
  if (!res) { needKey(key); if (R.exact) pend(key, src.slot ? slotLabel(src.slot) : "the background texture"); }
  return { key: key, res: res };
  function make() {
    var im = a ? a.im : tex, iw = a ? a.nw : tex.width, ih = a ? a.nh : tex.height;
    var bx = box[0] * iw, by = box[1] * ih, bw = (box[2] - box[0]) * iw, bh = (box[3] - box[1]) * ih;
    var sc = Math.max(w1 / bw, h1 / bh) * Math.max(1, f.s), dw = bw * sc, dh = bh * sc;
    // mirrorPan: the other half of a split plate shows the SAME part of the photo, mirrored
    var ax = src.fx == null ? 0.5 : src.fx, fx1 = f.x;
    if (src.mirrorPan) { ax = 1 - ax; fx1 = -f.x; }
    var ox = (w1 - dw) * ax + fx1 / k1, oy = (h1 - dh) * (src.fy == null ? 0.5 : src.fy) + f.y / k1;
    ox = clamp(ox, w1 - dw, 0); oy = clamp(oy, h1 - dh, 0);
    var c = mkCanvas(w1, h1), x = c.getContext("2d", { willReadFrequently: true });
    x.imageSmoothingEnabled = true; x.imageSmoothingQuality = "high";
    // the pan is in canvas px whatever the flip: a mirrored photo is mirrored inside its own rect
    if (flip) { x.translate(ox + dw, oy); x.scale(-1, 1); x.drawImage(im, bx, by, bw, bh, 0, 0, dw, dh); }
    else x.drawImage(im, bx, by, bw, bh, ox, oy, dw, dh);
    var px = x.getImageData(0, 0, w1, h1).data;
    return { job: { type: "plate", rgba: px, w: w1, h: h1, theme: th, px: 1080 / 640, seed: o.seed || 11, focus: focus, grain: o.grain },
             transfer: [px.buffer], post: function (o2) { return postCanvas(o2, key); } };
  }
}
// draw the themed plate into rect (canvas px); o: { seed, focus [x, y, r] in the RECT's 1080-wide px }
var lastPlate = {};
function drawPlateG(src, rect, o) {
  o = o || {};
  var k = W / 1080, w1 = Math.max(8, Math.round(rect[2] / k)), h1 = Math.max(8, Math.round(rect[3] / k));
  if (src.slot && !assetOf(src.slot)) src = { tex: src.fallback || "crowd", flip: src.flip, box: src.texBox, fx: src.fx, fy: src.fy, mirrorPan: src.mirrorPan };
  var P = plateJob(src, w1, h1, o), lk = R.tag + ":" + (src.slot || src.tex) + ":" + w1 + "x" + h1 + ":" + R.pal.id + ":" + rect[0] + (src.flip ? "f" : "") + (src.mirrorPan ? "m" : "");
  // the last finished plate remembers the frame it was graded at: while a drag or a wheel zoom is
  // in progress it is drawn moved and zoomed by the frame change, so the photo follows the pointer
  // (the grade for the new frame replaces it on release)
  var fr = src.slot ? frameOf(src.slot) : null, fnow = fr ? { x: fr.x, y: fr.y, s: fr.s } : { x: 0, y: 0, s: 1 };
  var last = !R.exact ? lastPlate[lk] : null, use = P.res || (last ? last.res : null), shift = null;
  if (P.res) lastPlate[lk] = { res: P.res, f: fnow };
  else if (last && src.slot) {
    var dx = (fnow.x - last.f.x) * (src.mirrorPan ? -1 : 1) * k, dy = (fnow.y - last.f.y) * k, zs = Math.max(1, fnow.s) / Math.max(1, last.f.s);
    if (Math.abs(dx) > 0.01 || Math.abs(dy) > 0.01 || Math.abs(zs - 1) > 1e-4) shift = { dx: dx, dy: dy, zs: zs };
  }
  g.save();
  g.beginPath(); g.rect(rect[0], rect[1], rect[2], rect[3]); g.clip();
  if (use && shift) {
    // the preview while dragging: the finished plate moved by the frame change; the uncovered edge
    // shows the shade
    g.fillStyle = R.pal.shade; g.fillRect(rect[0], rect[1], rect[2], rect[3]);
    g.imageSmoothingEnabled = true; g.imageSmoothingQuality = "high";
    var cxr = rect[0] + rect[2] / 2, cyr = rect[1] + rect[3] / 2;
    g.translate(cxr + shift.dx, cyr + shift.dy); g.scale(shift.zs, shift.zs);
    g.drawImage(use.c, -rect[2] / 2, -rect[3] / 2, rect[2], rect[3]);
  } else if (use) { g.imageSmoothingEnabled = true; g.imageSmoothingQuality = "high"; g.drawImage(use.c, rect[0], rect[1], rect[2], rect[3]); }
  else {
    // the preview: the source darkened and tinted toward the theme, the same framing
    g.fillStyle = mix(R.pal.shade, R.pal.a, 0.08); g.fillRect(rect[0], rect[1], rect[2], rect[3]);
    var tex = src.tex ? plate(src.tex) : null, a = src.slot ? assetOf(src.slot) : null, im = a ? a.img : tex;
    if (im) {
      var iw = im.width, ih = im.height, s = Math.max(rect[2] / iw, rect[3] / ih);
      g.globalAlpha = 0.5; g.globalCompositeOperation = "luminosity";
      g.drawImage(im, rect[0] + (rect[2] - iw * s) / 2, rect[1] + (rect[3] - ih * s) / 2, iw * s, ih * s);
      g.globalAlpha = 0.55; g.globalCompositeOperation = "source-over"; g.fillStyle = R.pal.shade; g.fillRect(rect[0], rect[1], rect[2], rect[3]);
    }
  }
  g.restore();
  return !!P.res;
}

// ---------- heroes: the graded cut-out as a layer ----------
// heroLayer(id, a, P, o): slot id's cut-out a, placed by P = { sc, dx, dy, flip } (asset px ->
// canvas px at the CURRENT W), graded by the template's look in the worker, as a full-canvas
// layer plus its low-res alpha (for the separation passes that must run BEFORE it is drawn).
// The grade is requested for the hero's region inside the canvas plus a wide margin, in 1080-wide
// px, snapped to a grid in the ASSET's own px, so dragging the fighter reuses the same grade and
// thumbnails share it. The fast preview (the grade at half size) shows first, the exact grade
// replaces it; an export waits for the exact one (never ships a preview: fast softens mattes).
// o: look, mode, clip [x, y, w, h], rowsBelow (face heights kept below the face top), ramp (fade
// the matte toward a photo edge, posters.edge_ramp), melt [y0, y1] (alpha fades out over those
// canvas rows), keepX [x0, x1] (alpha smoothstep across those columns), seed, bodyRows, torsoCap,
// lookOpts (GRADE_DEFAULTS overrides), theme (pop re-hue).
// MAX_GRADE_PX bounds the working size: the exact grade needs ~250 MB per megapixel while it runs
// (measured in Chrome: a 1.5 Mpx hero took the renderer from 420 to 741 MB for ~5 s), so a phone
// (deviceMemory under 4 GB) grades at most 0.9 Mpx and draws it scaled up a little.
// Smooth skin in a colour look: a face whose own fine texture (lc at size 2 on the 640 reference,
// inside the metered face ellipse) is under .02 - an upscaled face, a smooth or freckled one - had
// the grade inject crackle, pores, upscale grain and band clarity up to its targets, and came out
// in dense dark speckles (Wang Cong, Sept 25 2026 review). For those the synthetic texture drops
// to .3, the grade's grain and upscale texture to .5 and 0, the fine-band coring doubles and the
// band amplitude goes to .6. Measured on the heroes of the approved posters: Makhachev .0235,
// Volkanovski .026, Evloev .024, the lab cut 16 .0237 (all untouched); Cong .017 in the headline.
var SKIN_ADAPT = { thr: 0.02, tex: 0.3, grain: 0.5, up: 0, core: 2, K: 0.6 };
var HERO_MARGIN = 0.25, MAX_GRADE_PX = LOW_MEM ? 900000 : 1500000, heroCache = {}, lastRes = {};
function heroLayer(id, a, P, o) {
  o = o || {};
  var k = W / 1080, L = o.look || lookOf(), mode = o.mode || L.mode;
  var sc1 = P.sc / k, dx1 = P.dx / k, dy1 = P.dy / k, H1 = H / k, fb = a.fbox;
  var ymax = a.h;
  if (o.rowsBelow && fb) ymax = Math.min(a.h, fb[1] + fb[3] * (1 + o.rowsBelow));
  var M = 1080 * HERO_MARGIN, cx0 = -M, cy0 = -M, cx1 = 1080 + M, cy1 = H1 + M;
  if (o.clip) { cx0 = Math.max(cx0, o.clip[0] / k - 8); cy0 = Math.max(cy0, o.clip[1] / k - 8); cx1 = Math.min(cx1, (o.clip[0] + o.clip[2]) / k + 8); cy1 = Math.min(cy1, (o.clip[1] + o.clip[3]) / k + 8); }
  var vx0 = Math.max(dx1, cx0), vx1 = Math.min(dx1 + a.w * sc1, cx1), vy0 = Math.max(dy1, cy0), vy1 = Math.min(dy1 + ymax * sc1, cy1);
  if (vx1 - vx0 < 2 || vy1 - vy0 < 2) return null;
  // the region in asset px (flip mirrors x), snapped outward to a 48 canvas-px grid
  var ga = 48 / sc1, ax0, ax1;
  if (P.flip) { ax0 = a.w - (vx1 - dx1) / sc1; ax1 = a.w - (vx0 - dx1) / sc1; } else { ax0 = (vx0 - dx1) / sc1; ax1 = (vx1 - dx1) / sc1; }
  var ay0 = (vy0 - dy1) / sc1, ay1 = (vy1 - dy1) / sc1;
  ax0 = clamp(Math.floor(ax0 / ga) * ga, 0, a.w); ax1 = clamp(Math.ceil(ax1 / ga) * ga, 0, a.w);
  ay0 = clamp(Math.floor(ay0 / ga) * ga, 0, ymax); ay1 = clamp(Math.ceil(ay1 / ga) * ga, 0, ymax);
  ax0 = Math.floor(ax0); ay0 = Math.floor(ay0); ax1 = Math.ceil(ax1); ay1 = Math.ceil(ay1);
  var aw = ax1 - ax0, ah = ay1 - ay0;
  if (aw < 2 || ah < 2) return null;
  var ow = Math.max(8, Math.round(aw * sc1)), oh = Math.max(8, Math.round(ah * sc1)), se = sc1, capPx = MAX_GRADE_PX * (R.capK || 1);
  if (ow * oh > capPx) { var fr = Math.sqrt(capPx / (ow * oh)); ow = Math.round(ow * fr); oh = Math.round(oh * fr); se = ow / aw; }
  var sp = { rx: ax0, ry: ay0, rw: aw, rh: ah, ow: ow, oh: oh, mode: mode, px: (1080 / 640) * (se / sc1),
             face: fb ? [(fb[0] - ax0) * se, (fb[1] - ay0) * se, fb[2] * se, fb[3] * se] : null,
             upscale: Math.max(1, se * a.w / a.nw), seed: o.seed == null ? 7 : o.seed, theme: mode === "pop" ? R.pal.id : null,
             bodyRows: o.bodyRows, torsoCap: !!o.torsoCap, look: o.lookOpts || null,
             heal: !!(a.ufc && fb && (mode === "color" || mode === "natural")), photo: !a.cut, guard: guardTheme(mode),
             adapt: mode === "color" || mode === "natural" ? SKIN_ADAPT : null };
  var res = subjectRes(id, a, sp, o.label);
  var tag = (R.thumb ? "th:" : "") + R.tpl.id + ":" + id, used = null;
  if (res) { used = { res: res, a: a, rx: ax0, ry: ay0, rw: aw, rh: ah }; if (!R.exact) lastRes[tag] = used; }
  else if (!R.exact && lastRes[tag] && lastRes[tag].a === a) used = lastRes[tag];
  // an export draws its own exact grade or nothing: never the editor's preview, never the raw
  // cut-out (the export waits for the key, or refuses when it failed)
  if (!used && R.exact) return null;
  var e = expoOf(id);
  var ck = [used ? used.res.key + (used.res.fast ? "f" : "x") : "raw:" + a.key + ":" + a.ver, W, H, P.sc.toFixed(5), P.dx.toFixed(2), P.dy.toFixed(2),
            P.flip ? 1 : 0, o.clip ? o.clip.join(",") : "", ymax.toFixed(1), o.ramp ? 1 : 0, o.melt ? o.melt.join(",") : "",
            o.keepX ? o.keepX.join(",") : "", fxQ().toFixed(4)].join("|");
  // the matte does not depend on the exposure nudge: its tag leaves it out, so a slider step
  // replays every separation pass instead of recomputing them
  var ckA = ck;
  ck = ckA + "|" + e.toFixed(2);
  var hc = heroCache[R.tag + ":" + id];
  if (hc && hc.ck === ck) return hc;
  var lay = mkCanvas(W, H), x = lay.getContext("2d");
  x.imageSmoothingEnabled = true; x.imageSmoothingQuality = "high";
  x.save();
  if (o.clip) { x.beginPath(); x.rect(o.clip[0], o.clip[1], o.clip[2], o.clip[3]); x.clip(); }
  if (P.flip) { x.translate(P.dx + a.w * P.sc, P.dy); x.scale(-1, 1); } else x.translate(P.dx, P.dy);
  if (used) x.drawImage(withExpo(used.res, e, used.res.key), used.rx * P.sc, used.ry * P.sc, used.rw * P.sc, used.rh * P.sc);
  else x.drawImage(a.img, 0, 0, a.w, ymax, 0, 0, a.w * P.sc, ymax * P.sc);
  x.restore();
  // alpha shaping (destination-in with full-canvas gradients: 1 beyond each band)
  function fadeBand(x0, y0, x1, y1, prof) {
    var gr = x.createLinearGradient(x0, y0, x1, y1);
    for (var i2 = 0; i2 <= 8; i2++) { var t = i2 / 8; gr.addColorStop(t, "rgba(0,0,0," + (prof ? prof(t) : smooth(0, 1, t)) + ")"); }
    x.save(); x.globalCompositeOperation = "destination-in"; x.fillStyle = gr; x.fillRect(0, 0, W, H); x.restore();
  }
  if (o.ramp) {
    var wd = 70 * W / 640, left = P.flip ? P.dx + a.w * P.sc : P.dx, right = P.flip ? P.dx : P.dx + a.w * P.sc;
    if (a.touch.l) fadeBand(left, 0, left + (P.flip ? -wd : wd), 0);
    if (a.touch.r) fadeBand(right, 0, right + (P.flip ? wd : -wd), 0);
    var bot = P.dy + ymax * P.sc;
    if (a.touch.b || ymax < a.h - 1) fadeBand(0, bot, 0, bot - wd);
  }
  if (o.melt) fadeBand(0, o.melt[1], 0, o.melt[0]);
  if (o.keepX) fadeBand(o.keepX[0], 0, o.keepX[1], 0);
  var vb = [Math.max(0, vx0 * k), Math.max(0, vy0 * k), 0, 0];
  vb[2] = Math.min(W, vx1 * k) - vb[0]; vb[3] = Math.min(H, vy1 * k) - vb[1];
  lay.__tag = "h" + R.tag + ":" + id + ":" + ck;
  hc = { ck: ck, c: lay, al: lowAlpha(lay), vb: vb, P: P, graded: !!used, exact: !!(used && !used.res.fast) };
  hc.al.__tag = "m" + R.tag + ":" + id + ":" + ckA;
  heroCache[R.tag + ":" + id] = hc;
  return hc;
}
// the subject grade: exact if ready, else the fast preview (and the exact queued behind it).
// Thumbnails ask only for the fast one (low priority); an export asks only for the exact one.
function subjectKey(a, sp, fast) {
  return ["sub", a.key, a.ver, sp.mode, sp.theme || "", sp.rx, sp.ry, sp.rw, sp.rh, sp.ow, sp.oh, sp.px.toFixed(3),
          sp.face ? sp.face.map(function (v) { return Math.round(v); }).join(",") : "-", sp.upscale.toFixed(2), sp.seed,
          sp.bodyRows == null ? "" : sp.bodyRows, sp.torsoCap ? 1 : 0, sp.look ? JSON.stringify(sp.look) : "", sp.heal ? 1 : 0,
          sp.photo ? 1 : 0, sp.guard || "", sp.adapt ? JSON.stringify(sp.adapt) : "", fast ? "f" : "x"].join("|");
}
function subjectJob(a, sp, fast, prio, tag) {
  var key = subjectKey(a, sp, fast);
  var out = job(key, function () {
    var px = assetPixels(a, sp.rx, sp.ry, sp.rw, sp.rh, sp.ow, sp.oh);
    return { job: { type: "subject", rgba: px, w: sp.ow, h: sp.oh, mode: sp.mode, px: sp.px, face: sp.face, upscale: sp.upscale,
                    seed: sp.seed, theme: sp.theme, bodyRows: sp.bodyRows, torsoCap: sp.torsoCap, look: sp.look, heal: sp.heal,
                    photo: sp.photo, fast: fast, guard: sp.guard || null, adapt: sp.adapt || null },
             transfer: [px.buffer], post: function (o2) { var r = postCanvas(o2, key); r.key = key; r.fast = fast; return r; } };
  }, prio, tag);
  return { key: key, out: out };
}
var interactT = 0;
function interacting() { return !!dragging || Date.now() - interactT < 320; }
function subjectRes(id, a, sp, label) {
  var tag = (R.thumb ? "th:" : "") + R.tpl.id + ":" + id;
  var noFast = sp.mode === "vivid" || sp.ow * sp.oh < 200000;
  if (R.exact) {
    var ex = subjectJob(a, sp, false, 0, null);
    if (!ex.out) { needKey(ex.key); pend(ex.key, label || slotLabel(id)); }
    return ex.out;
  }
  var kx = subjectKey(a, sp, false), done = jobPeek(kx);
  if (done) return done;
  if (R.thumb) {
    if (noFast) { var t1 = subjectJob(a, sp, false, 5, tag + ":x"); if (!t1.out) needKey(t1.key); return t1.out; }
    var tf = subjectJob(a, sp, true, 5, tag + ":f");
    if (!tf.out) needKey(tf.key);
    return tf.out;
  }
  if (interacting()) { scheduleSettle(); var pk = jobPeek(subjectKey(a, sp, true)); return pk; }
  var fastOut = noFast ? null : subjectJob(a, sp, true, 1, tag + ":f").out;
  var exact = subjectJob(a, sp, false, 2, tag + ":x");
  needKey(exact.key);
  if (!noFast && !fastOut) needKey(subjectKey(a, sp, true));
  return exact.out || fastOut;
}
var settleT = 0;
function scheduleSettle() { clearTimeout(settleT); settleT = setTimeout(function () { requestRender(); }, 340); }

// ---------- subject photos (a photo in a subject slot, graded by the look) ----------
// the photo cover-fitted into rect (the slot frame pans / zooms it), graded as an opaque subject
function photoLayerRes(id, a, rect, o) {
  o = o || {};
  var f = frameOf(id), k = W / 1080;
  var sc = Math.max(rect[2] / a.w, rect[3] / a.h) * Math.max(1, f.s), dw = a.w * sc, dh = a.h * sc;
  var bx = rect[0] + (rect[2] - dw) * (o.fx == null ? 0.5 : o.fx), by = rect[1] + (rect[3] - dh) * (o.fy == null ? 0.3 : o.fy);
  var dx = clamp(bx + f.x, rect[0] + rect[2] - dw, rect[0]), dy = clamp(by + f.y, rect[1] + rect[3] - dh, rect[1]);
  R.place[id] = { kind: "photo", rect: rect, bx: bx, by: by, dw: dw, dh: dh };
  var P = { sc: sc, dx: dx, dy: dy, flip: !!f.flip };
  var hl = heroLayer(id, a, P, { clip: rect, look: o.look, mode: o.mode, seed: o.seed, keepX: o.keepX, label: o.label });
  return hl;
}
// ---------- persistence: the doc in localStorage, dropped files in IndexedDB ----------
var idb = null;
function idbOpen() {
  return new Promise(function (res) {
    try {
      var r = indexedDB.open("posters", 1);
      r.onupgradeneeded = function () { r.result.createObjectStore("blobs"); };
      r.onsuccess = function () { idb = r.result; res(idb); };
      r.onerror = function () { res(null); };
    } catch (e) { res(null); }
  });
}
function idbDo(mode, fn) {
  return new Promise(function (res) {
    if (!idb) { res(null); return; }
    try {
      var tx = idb.transaction("blobs", mode), st = tx.objectStore("blobs"), q = fn(st);
      tx.oncomplete = function () { res(q && q.result !== undefined ? q.result : null); };
      tx.onerror = function () { res(null); };
    } catch (e) { res(null); }
  });
}
function idbPut(k, blob) { return idbDo("readwrite", function (st) { return st.put(blob, k); }); }
function idbGet(k) { return idbDo("readonly", function (st) { return st.get(k); }); }
function idbDel(k) { return idbDo("readwrite", function (st) { return st.delete(k); }); }
function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { } }

// ---------- plates: grayscale textures, tinted in code ----------
var PLATES = {
  arena: "/studio/tpl/arena.jpg", haze: "/studio/tpl/haze.jpg", sparks: "/studio/tpl/sparks.jpg",
  concrete: "/studio/tpl/concrete.jpg", crowd: "/studio/tpl/crowd.jpg", rays: "/studio/tpl/rays.jpg",
  grunge: "/studio/tpl/grunge.jpg", tape1: "/studio/tpl/tape1.png", tape2: "/studio/tpl/tape2.png",
  smoke: "/studio/bg/smoke", cage: "/studio/bg/cage", spotlight: "/studio/bg/spotlight"
};
// A texture is fetched once; a failed fetch (a network blip) is retried after 5, 10 and 20 s before
// it gives up for the session. plateWait[name] is the promise of the fetch in flight (settles on
// success or final failure): an export waits on it rather than shipping the poster without it.
var plateImg = {}, plateTries = {}, plateWait = {};
function plate(name) {
  var v = plateImg[name];
  if (v) return v;
  if (v === undefined && PLATES[name]) {
    plateImg[name] = null;
    plateWait[name] = new Promise(function (done) {
      (function attempt() {
        fetchBlob(PLATES[name]).then(blobToImage).then(function (im) {
          var c = mkCanvas(im.naturalWidth, im.naturalHeight);
          c.getContext("2d").drawImage(im, 0, 0);
          c.__tag = "tex:" + name;
          plateImg[name] = c;
          delete plateWait[name];
          fxEpoch++;
          tintCache = {};
          requestRender(true);
          done();
        }).catch(function () {
          plateTries[name] = (plateTries[name] || 0) + 1;
          if (plateTries[name] > 3) { plateImg[name] = false; delete plateWait[name]; done(); return; }
          setTimeout(attempt, 5000 * Math.pow(2, plateTries[name] - 1));
        });
      })();
    });
  }
  return null;
}
// an export that needs texture name while it is not there: wait for the fetch in flight, or list
// it as failed (exportCanvas then fetches it once more, and refuses if it still cannot)
function texNeed(name) {
  if (!R || !R.exact || !PLATES[name]) return;
  var pk = "tex:" + name;
  if (plateImg[name] === false) { if (R.failed.indexOf(pk) === -1) { R.failed.push(pk); R.failedLabels.push("the " + name + " texture"); } }
  else if (R.pending.indexOf(pk) === -1) R.pending.push(pk);
}
// a plate cover-fitted to w x h and duotoned black -> color (multiply), cached
var tintCache = {};
function tinted(name, col, w, h, focusY) {
  var im = plate(name);
  if (!im) { texNeed(name); return null; }
  var k = name + "|" + col + "|" + Math.round(w) + "x" + Math.round(h) + "|" + (focusY == null ? 0.5 : focusY);
  if (tintCache[k]) return tintCache[k];
  var c = mkCanvas(w, h), x = c.getContext("2d");
  var s = Math.max(w / im.width, h / im.height), dw = im.width * s, dh = im.height * s;
  x.drawImage(im, (w - dw) / 2, (h - dh) * (focusY == null ? 0.5 : focusY), dw, dh);
  if (col) { x.globalCompositeOperation = "multiply"; x.fillStyle = col; x.fillRect(0, 0, w, h); }
  var ks = Object.keys(tintCache);
  if (ks.length > 40) delete tintCache[ks[0]];
  c.__tag = "tint:" + k;
  tintCache[k] = c;
  return c;
}
// A BACKGROUND texture becomes the themed plate (drawPlateG: GRIT.gradePlate in the worker),
// drawn over the scene at the old strength; the light overlays (haze, rays, grunge) and the
// tape stay tinted canvas ops.
var BG_TEX = { arena: 1, crowd: 1, concrete: 1, smoke: 1, cage: 1, spotlight: 1, sparks: 1 };
function drawPlate(name, o) {
  o = o || {};
  var r = o.rect || [0, 0, W, H];
  if (BG_TEX[name]) {
    g.save();
    g.globalAlpha = o.alpha == null ? 1 : Math.min(1, o.alpha * 1.6);
    drawPlateG({ tex: name, fy: o.focusY == null ? 0.5 : o.focusY }, r, { seed: 11, focus: [r[2] / (W / 1080) * 0.5, r[3] / (W / 1080) * 0.3, 460] });
    g.restore();
    return true;
  }
  var c = tinted(name, o.color || null, r[2], r[3], o.focusY);
  if (!c) return false;
  g.save();
  g.globalAlpha = o.alpha == null ? 1 : o.alpha;
  g.globalCompositeOperation = o.mode || "source-over";
  g.drawImage(c, r[0], r[1]);
  g.restore();
  return true;
}

// ---------- render state ----------
// R is rebuilt for every render: target context, size, palette, doc, hit regions and the
// placements the pointer code needs to turn a drag into a frame offset.
var R = null;
var doc = null;
function PAL() { return R.pal; }
function lightCol(c) {
  var p = R.pal;
  if (!c || c === "a") return p.glow;
  if (c === "hi") return p.hi;
  if (c === "w") return "#FFF3E8";
  return c;
}
function hit(id, kind, shape, label) { R.hits.push({ id: id, kind: kind, shape: shape, label: label || "" }); }
// the owner-facing name of a slot, card or tile (export messages)
function slotLabel(id) {
  var s = slotDef(R && R.tpl ? R.tpl : TPL[doc.tpl], id);
  if (s) return s.label;
  var m = /^(card|tile):([0-9]+)/.exec(String(id || ""));
  if (m) return (m[1] === "card" ? "Card " : "Tile ") + (Number(m[2]) + 1);
  if (/^tex:/.test(String(id || ""))) return "the background texture";
  return String(id || "an image");
}
// ---------- slots and frames belong to ONE template ----------
// An image the owner drops (doc.slots) and its framing (doc.frames) are kept per template under
// "<template id>:<slot id>". Bare slot ids (hero, left, right) are shared by many templates, and a
// photo dropped on Face-off's left fighter used to land on Tale of the tape under the other
// fighter's name and record. The data sources (A.body, the card...) still fill every template; the
// "Every poster" button on a slot row is the explicit way to change one for all of them.
// The scope is the template being drawn (renderTo, slotAsset), else the one open in the editor.
var scopeId = null;
function scopeTpl() { return scopeId || doc.tpl; }
function sk(id, tid) { return (tid || scopeTpl()) + ":" + id; }
function slotKey(id, tid) { return doc.slots[sk(id, tid)]; }
function setSlot(id, key, tid) { doc.slots[sk(id, tid)] = key; }
function delSlot(id, tid) { delete doc.slots[sk(id, tid)]; delete doc.frames[sk(id, tid)]; }
function assetOf(id) { var k = slotKey(id); return k && assets[k] ? assets[k] : null; }
function frameOf(id) {
  var f = doc.frames[sk(id)];
  if (!f) { f = { x: 0, y: 0, s: 1, flip: false }; doc.frames[sk(id)] = f; }
  return f;
}
function rr(x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  g.beginPath();
  g.moveTo(x + r, y); g.lineTo(x + w - r, y); g.quadraticCurveTo(x + w, y, x + w, y + r);
  g.lineTo(x + w, y + h - r); g.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  g.lineTo(x + r, y + h); g.quadraticCurveTo(x, y + h, x, y + h - r);
  g.lineTo(x, y + r); g.quadraticCurveTo(x, y, x + r, y);
  g.closePath();
}

// ---------- photos ----------
// Cover-fit into rect, framed by the slot's pan/zoom, clamped so the photo always covers.
// o.plate: the photo is a BACKGROUND and becomes the themed plate (GRIT.gradePlate); otherwise it
// is a subject and gets the look's grade (o.look / o.mode override it).
function coverPlace(id, a, rect, o) {
  var f = frameOf(id);
  var sc = Math.max(rect[2] / a.w, rect[3] / a.h) * Math.max(1, f.s), dw = a.w * sc, dh = a.h * sc;
  var bx = rect[0] + (rect[2] - dw) * (o.fx == null ? 0.5 : o.fx), by = rect[1] + (rect[3] - dh) * (o.fy == null ? 0.3 : o.fy);
  R.place[id] = { kind: "photo", rect: rect, bx: bx, by: by, dw: dw, dh: dh, plate: !!o.plate };
}
function drawPhoto(id, rect, o) {
  o = o || {};
  hit(id, "photo", { r: rect }, o.label);
  var a = assetOf(id);
  if (!a) { if (o.plate) R.place[id] = { kind: "photo", plate: true }; if (!o.quiet) phPhoto(rect, o.label || "Drop a photo"); return false; }
  if (o.plate) {
    coverPlace(id, a, rect, { fx: o.fx, fy: o.fy, plate: true });
    drawPlateG({ slot: id, fx: 0.5, fy: o.fy == null ? 0.3 : o.fy, fallback: o.fallback }, rect, { seed: o.seed, focus: o.focus });
  } else {
    var hl = photoLayerRes(id, a, rect, o);
    if (hl) g.drawImage(hl.c, 0, 0);
  }
  if (o.dim) { g.fillStyle = "rgba(0,0,0," + o.dim + ")"; g.fillRect(rect[0], rect[1], rect[2], rect[3]); }
  return true;
}
// a plate slot's hit region (drag pans it, the wheel zooms it) without drawing anything
function plateHit(id, rect, label) {
  hit(id, "photo", { r: rect }, label);
  var a = assetOf(id);
  if (a) coverPlace(id, a, rect, { fy: 0.3, plate: true });
  else R.place[id] = { kind: "photo", plate: true };
}
// colored light landing on a photo: overlay lifts the highlights toward the light color and
// leaves the shadows, which is how skin catches a colored rim in a real arena photo
function lightCatch(rect, lights, k) {
  if (k <= 0) return;
  g.save();
  g.beginPath(); g.rect(rect[0], rect[1], rect[2], rect[3]); g.clip();
  for (var i = 0; i < lights.length; i++) {
    var L = lights[i], x = L.x * W, y = L.y * H, r = L.r * W * 1.25, c = lightCol(L.c);
    var gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, rgba(c, 0.95 * k * L.k)); gr.addColorStop(0.5, rgba(c, 0.35 * k * L.k)); gr.addColorStop(1, rgba(c, 0));
    g.globalCompositeOperation = "overlay"; g.fillStyle = gr; g.fillRect(x - r, y - r, 2 * r, 2 * r);
  }
  g.restore();
}
// ---------- cut-outs: placement, grade, painted edge light ----------
var layers = [];
function layerCanvas(i) {
  var c = layers[i];
  if (!c || c.width !== W || c.height !== H) { c = mkCanvas(W, H); layers[i] = c; }
  var x = c.getContext("2d");
  x.setTransform(1, 0, 0, 1, 0, 0); x.globalCompositeOperation = "source-over"; x.globalAlpha = 1;
  x.clearRect(0, 0, W, H);
  return c;
}
// the subject's placement from its head: head center at spec.head[0..1] (fractions of W/H),
// head width spec.head[2] of W, then the slot frame (pan, zoom around the head, flip)
function cutPlacement(a, spec, f) {
  var hw = spec.head[2] * W * f.s, sc = hw / a.head.w;
  var auto = !!(spec.side && a.face && a.face !== spec.side);
  var flip = f.flip ? !auto : auto;
  var hcx = flip ? a.w - a.head.cx : a.head.cx;
  var hx = spec.head[0] * W + f.x, hy = spec.head[1] * H + f.y;
  return { sc: sc, flip: flip, dx: hx - hcx * sc, dy: hy - a.head.cy * sc, dw: a.w * sc, dh: a.h * sc, hx: hx, hy: hy, hw: hw };
}
function boxBlur(src, w, h, r, out, tmp) {
  var x, y, i, acc, inv = 1 / (2 * r + 1);
  for (y = 0; y < h; y++) {
    var o = y * w;
    acc = 0;
    for (x = -r; x <= r; x++) acc += src[o + clamp(x, 0, w - 1)];
    for (x = 0; x < w; x++) {
      tmp[o + x] = acc * inv;
      acc += src[o + Math.min(w - 1, x + r + 1)] - src[o + Math.max(0, x - r)];
    }
  }
  for (x = 0; x < w; x++) {
    acc = 0;
    for (y = -r; y <= r; y++) acc += tmp[clamp(y, 0, h - 1) * w + x];
    for (y = 0; y < h; y++) {
      out[y * w + x] = acc * inv;
      acc += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x];
    }
  }
}
// The painted edge light. Work at half resolution on the subject's alpha A: blur it (B)
// and near the silhouette the gradient of B is the surface normal. Each light adds its color
// where the normal faces it (lambert), falling off with distance - INSIDE the silhouette only,
// in a wide soft band, and in proportion to how bright the skin already is, the way a real
// rim light catches shoulders and skips dark shorts. There is no outer glow and no bloom:
// the owner rejected the silhouette halo as "AI-generated" (Sept 25 2026).
var RIM_S = 0.5;
var rimBufs = {};
function edgeLight(layer, box, lights, hw, rimK) {
  var s = RIM_S, pad = 4;
  var sw = Math.ceil(W * s), sh = Math.ceil(H * s);
  var rx = clamp(Math.floor(box[0] * s) - pad, 0, sw - 1), ry = clamp(Math.floor(box[1] * s) - pad, 0, sh - 1);
  var rx2 = clamp(Math.ceil((box[0] + box[2]) * s) + pad, 1, sw), ry2 = clamp(Math.ceil((box[1] + box[3]) * s) + pad, 1, sh);
  var w = rx2 - rx, h = ry2 - ry;
  if (w < 4 || h < 4) return null;
  var kb = sw + "x" + sh, buf = rimBufs[kb];
  if (!buf) { buf = mkCanvas(sw, sh); rimBufs[kb] = buf; }
  var bx = buf.getContext("2d", { willReadFrequently: true });
  bx.setTransform(1, 0, 0, 1, 0, 0); bx.clearRect(0, 0, sw, sh);
  bx.drawImage(layer, 0, 0, sw, sh);
  var d = bx.getImageData(rx, ry, w, h).data, n = w * h, i;
  var A = new Float32Array(n), B = new Float32Array(n), T = new Float32Array(n), Lu = new Float32Array(n);
  for (i = 0; i < n; i++) {
    var al = d[i * 4 + 3];
    A[i] = al / 255;
    Lu[i] = al ? (0.2126 * d[i * 4] + 0.7152 * d[i * 4 + 1] + 0.0722 * d[i * 4 + 2]) / 255 : 0;
  }
  var br = clamp(Math.round(hw * s * 0.15), 4, 16);
  boxBlur(A, w, h, br, B, T); boxBlur(B, w, h, br, B, T);
  var LS = [];
  for (i = 0; i < lights.length; i++) {
    var L = lights[i], c = hexRgb(lightCol(L.c));
    LS.push({ x: L.x * W * s - rx, y: L.y * H * s - ry, reach: L.r * W * s * 1.5, k: L.k, r: c[0], g: c[1], b: c[2] });
  }
  var out = bx.createImageData(w, h), od = out.data, y, x, j;
  for (y = 1; y < h - 1; y++) {
    for (x = 1; x < w - 1; x++) {
      i = y * w + x;
      var a = A[i];
      if (a < 0.02) continue;
      var band = clamp((a - B[i]) * 2.4, 0, 1) * a;
      if (band < 0.004) continue;
      var gx = B[i + 1] - B[i - 1], gy = B[i + w] - B[i - w], gl = Math.sqrt(gx * gx + gy * gy);
      if (gl < 1e-5) continue;
      var nx = -gx / gl, ny = -gy / gl, sr = 0, sg = 0, sb = 0, sk = 0;
      for (j = 0; j < LS.length; j++) {
        var Lj = LS[j], lx = Lj.x - x, ly = Lj.y - y, dist = Math.sqrt(lx * lx + ly * ly) + 1;
        var lam = (nx * lx + ny * ly) / dist;
        if (lam <= 0.02) continue;
        var q = dist / Lj.reach, k = Lj.k * lam * Math.sqrt(lam) / (1 + q * q);
        sr += Lj.r * k; sg += Lj.g * k; sb += Lj.b * k; sk += k;
      }
      if (sk <= 0) continue;
      var o4 = i * 4, v = Math.min(1, sk * rimK * band * (0.35 + 0.65 * Math.sqrt(clamp(Lu[i], 0, 1))));
      od[o4] = sr / sk; od[o4 + 1] = sg / sk; od[o4 + 2] = sb / sk; od[o4 + 3] = v * 255;
    }
  }
  var cv2 = mkCanvas(w, h);
  cv2.getContext("2d").putImageData(out, 0, 0);
  return { x: rx / s, y: ry / s, w: w / s, h: h / s, c: cv2 };
}
// the old templates' cut-out extras on top of the graded hero layer, cached: directional
// modelling (the side away from the light centroid falls off), the ground fade (the lower body
// sinks into the scene), an exposure wash and the painted edge light. The edge light defaults to
// OFF (fx.rim = 0): the owner saw the old glow as fighters "being blinded" (Sept 25 2026).
var finishCache = {};
function cutFinish(id, hl, P, o) {
  var lights = o.lights || R.lights;
  var rimK = 2.3 * (o.rim == null ? 1 : o.rim) * (doc.fx.rim || 0);
  var shade = 0.55 * (o.shade == null ? 1 : o.shade) * (doc.fx.shade == null ? 0 : doc.fx.shade);
  var fade = o.fade === false ? null : (o.fade || [0.55, 0.96, 0.88]), fk = doc.fx.fade == null ? 1 : doc.fx.fade;
  var vb = hl.vb;
  if (!(shade > 0.01) && !(fade && fk > 0.01) && !o.expose && !(rimK > 0.01)) return hl.c;
  var key = [hl.ck, rimK.toFixed(2), shade.toFixed(2), fade ? fade.join(",") + ":" + fk : "-", JSON.stringify(lights), o.expose || 0].join("|");
  var fc = finishCache[R.tag + ":" + id];
  if (fc && fc.key === key) return fc.c;
  var L = mkCanvas(W, H), x = L.getContext("2d");
  x.drawImage(hl.c, 0, 0);
  if (o.expose) { x.globalCompositeOperation = "source-atop"; x.fillStyle = o.expose < 0 ? "rgba(0,0,0," + (-o.expose) + ")" : "rgba(255,255,255," + o.expose + ")"; x.fillRect(0, 0, W, H); }
  if (shade > 0.01 && lights.length && vb[2] > 2) {
    var lx = 0, ly = 0, lk = 0;
    for (var i = 0; i < lights.length; i++) { lx += lights[i].x * W * lights[i].k; ly += lights[i].y * H * lights[i].k; lk += lights[i].k; }
    lx /= lk; ly /= lk;
    var cx = vb[0] + vb[2] / 2, cy = vb[1] + vb[3] / 2, vx = lx - cx, vy = ly - cy, vl = Math.sqrt(vx * vx + vy * vy) || 1;
    var span = Math.max(vb[2], vb[3]) * 0.5;
    vx /= vl; vy /= vl;
    var gr = x.createLinearGradient(cx + vx * span * 0.1, cy + vy * span * 0.1, cx - vx * span, cy - vy * span);
    gr.addColorStop(0, "rgba(0,0,0,0)"); gr.addColorStop(0.5, "rgba(0,0,0," + (shade * 0.5) + ")"); gr.addColorStop(1, "rgba(0,0,0," + shade + ")");
    x.globalCompositeOperation = "source-atop"; x.fillStyle = gr; x.fillRect(0, 0, W, H);
  }
  if (fade && fk > 0.01) {
    var fg = x.createLinearGradient(0, fade[0] * H, 0, fade[1] * H), dp = Math.min(1, fade[2] * fk), sh = R.pal.shade;
    fg.addColorStop(0, rgba(sh, 0)); fg.addColorStop(0.5, rgba(sh, dp * 0.5)); fg.addColorStop(1, rgba(sh, dp));
    x.globalCompositeOperation = "source-atop"; x.fillStyle = fg; x.fillRect(0, 0, W, H);
  }
  x.globalCompositeOperation = "source-over";
  var el0 = rimK > 0.01 && vb[2] > 2 && vb[3] > 2 ? edgeLight(L, vb, lights, P.hw, rimK) : null;
  if (el0) {
    x.globalCompositeOperation = "screen"; x.drawImage(el0.c, el0.x, el0.y, el0.w, el0.h);
    x.globalCompositeOperation = "destination-in"; x.drawImage(hl.c, 0, 0);
    x.globalCompositeOperation = "source-over";
  }
  L.__tag = "cf" + R.tag + ":" + id + ":" + key;
  finishCache[R.tag + ":" + id] = { key: key, c: L };
  return L;
}
// a cut-out slot: the graded hero placed by its head. o: { lights, rim (0-2), shade (0-2), fade
// [from, to, depth] or false, expose, clip, look, sep (false: no separation) }. Returns the layer
// info, or null when there is nothing to draw (then the slot shows a placeholder or its photo).
function prepCut(id, spec, o) {
  o = o || {};
  var a = assetOf(id);
  if (!a) { phFighter(spec, o.label || "Drop a fighter"); hitFighterGuess(id, spec, o.label); return null; }
  if (!a.cut || !a.head) {
    var hw0 = spec.head[2] * W, bw = hw0 * 3.4, bh = bw * 1.25;
    var rect = spec.box || [spec.head[0] * W - bw / 2, spec.head[1] * H - hw0 * 0.9, bw, bh];
    if (o.clip) {
      var x0 = Math.max(rect[0], o.clip[0]), x1 = Math.min(rect[0] + rect[2], o.clip[0] + o.clip[2]);
      rect = [x0, rect[1], Math.max(8, x1 - x0), rect[3]];
    }
    drawPhoto(id, rect, { label: o.label, fy: 0.25 });
    return null;
  }
  var f = frameOf(id), P = cutPlacement(a, spec, f);
  var hl = heroLayer(id, a, { sc: P.sc, dx: P.dx, dy: P.dy, flip: P.flip }, { clip: o.clip, ramp: true, seed: o.seed, look: o.look });
  if (!hl) return null;
  return { id: id, hl: hl, P: P, spec: spec, o: o, lay: cutFinish(id, hl, P, o) };
}
// a clipped fighter (one half of a split) keeps his separation inside his own half
function inClip(c, fn) {
  g.save();
  if (c.o.clip) { g.beginPath(); g.rect(c.o.clip[0], c.o.clip[1], c.o.clip[2], c.o.clip[3]); g.clip(); }
  var ct = R.clipTag;
  R.clipTag = c.o.clip ? c.o.clip.join(",") : "";
  try { fn(); } finally { R.clipTag = ct; }
  g.restore();
}
function sepCut(c) {
  if (!c || c.o.sep === false) return;
  inClip(c, function () { fxClear(c.hl.al, { capReach: c.o.cap || 0 }); });
}
function haloCut(c) {
  if (!c || c.o.sep === false) return;
  inClip(c, function () { fxHalo(c.hl.al, [9.0, 0.60, 0.9], [30.0, 0.32, 0.25]); });
}
function showCut(c) {
  if (!c) return;
  g.drawImage(c.lay, 0, 0);
  R.place[c.id] = { kind: "cut", P: c.P, spec: c.spec };
  hit(c.id, "cut", { r: c.hl.vb, al: c.hl.al }, c.o.label);
}
function drawCut(id, spec, o) {
  var c = prepCut(id, spec, o);
  sepCut(c); haloCut(c); showCut(c);
  return c;
}
// several cut-outs that stand near each other: every clearance runs before any halo, and every
// halo before its own hero, so no hero's separation ever darkens the hero beside it
function drawCuts(list) {
  var cs = list.map(function (q) { return prepCut(q[0], q[1], q[2]); });
  cs.forEach(sepCut);
  cs.forEach(function (c) { haloCut(c); showCut(c); });
  return cs;
}
function hitFighterGuess(id, spec, label) {
  var hw = spec.head[2] * W;
  hit(id, "cut", { r: [spec.head[0] * W - hw * 1.7, spec.head[1] * H - hw * 0.8, hw * 3.4, hw * 4.2], empty: true }, label);
}

// ---------- circle insets (GRIT.circleInset) ----------
// The approved inset: the subject on a neutral studio sweep (a UFC head tile is framed by
// posters.ufc_head_on_sweep, a full cut-out by cut_on_sweep, a photo is cropped square), graded
// grey ("inset", beside a carved hero) or in natural colour (cool themes mute saturated reds:
// owner law 1), in an anti-aliased circle with a thin ring and a soft DARK drop shadow - never
// a glow. d is in canvas px; the grade runs at the 1080-wide size, so thumbnails share it.
function insetRes(id, a, d, o) {
  o = o || {};
  var k = W / 1080, d1 = Math.max(24, Math.round(d / k)), f = frameOf(id), mode = o.mode === "inset" ? "inset" : "natural";
  var bust = a.cut && a.box && a.box.h / a.box.w < 1.25, src = !a.cut || !a.head ? "photo" : bust ? "head" : "cut";
  var tone = o.tone == null ? (mode === "inset" ? 0.40 : 0.30) : o.tone, seed = o.seed == null ? 21 : o.seed;
  var theme = mode === "natural" && R.pal.cool ? R.pal.id : null, ring = o.ring || "#FFFFFF";
  var key = ["ins", a.key, a.ver, src, d1, mode, seed, tone, theme || "", ring, Math.round(f.x / k), Math.round(f.y / k), f.s.toFixed(3), f.flip ? 1 : 0].join("|");
  var tag = (R.thumb ? "th:" : "") + R.tpl.id + ":" + id + ":ins";
  var res;
  if (R.exact) { res = job(key, make, 0); if (!res) pend(key, slotLabel(id)); }
  else if (!R.thumb && interacting()) { res = jobPeek(key); if (res) lastInset[tag] = { res: res, f: { x: f.x, y: f.y, s: f.s } }; else scheduleSettle(); }
  else { res = job(key, make, R.thumb ? 5 : 1, tag); if (res && !R.thumb) lastInset[tag] = { res: res, f: { x: f.x, y: f.y, s: f.s } }; }
  if (!res) needKey(key);
  return res;
  function make() {
    var px = 1080 / 640, rgba, w, h, face = null, up = 1, dx = 0, dy = 0;
    if (src === "head") {
      var s = 1.55 * d1 / a.nw * Math.max(0.3, f.s);
      w = Math.max(8, Math.round(a.nw * s)); h = Math.max(8, Math.round(a.nh * s));
      rgba = assetPixels(a, 0, 0, a.w, a.h, w, h, !!f.flip);
      up = Math.max(1, s); dx = f.x / k; dy = f.y / k;
    } else {
      var side, cx, cy;
      if (src === "cut") {
        side = 1.9 * a.head.w / Math.max(0.3, f.s);
        cx = a.head.cx; cy = (a.fbox ? a.fbox[1] + a.fbox[3] / 2 : a.head.cy) + 0.06 * side;
      } else {
        side = Math.min(a.w, a.h) / Math.max(1, f.s);
        cx = a.w / 2; cy = Math.min(a.h - side / 2, Math.max(side / 2, a.h * 0.42));
      }
      cx -= (f.flip ? -1 : 1) * f.x / k * side / d1; cy -= f.y / k * side / d1;
      var x0 = cx - side / 2, y0 = cy - side / 2;
      w = h = d1;
      rgba = assetPixels(a, x0, y0, side, side, d1, d1, !!f.flip);
      if (src === "photo") for (var i = 3; i < rgba.length; i += 4) rgba[i] = 255;
      if (src === "cut" && a.fbox) {
        var sc = d1 / side, fx0 = f.flip ? (x0 + side) - (a.fbox[0] + a.fbox[2]) : a.fbox[0] - x0;
        face = [fx0 * sc, (a.fbox[1] - y0) * sc, a.fbox[2] * sc, a.fbox[3] * sc];
      }
      up = Math.max(1, d1 / (side * a.nw / a.w));
    }
    return { job: { type: "inset", src: src, rgba: rgba, w: w, h: h, d: d1, dx: dx, dy: dy, tone: tone, seed: seed, mode: mode, px: px,
                    face: face, upscale: up, theme: theme, ring: ring },
             transfer: [rgba.buffer], post: function (o2) { var r = postCanvas(o2, key); r.key = key; r.ak = a.key + ":" + a.ver; return r; } };
  }
}
var lastInset = {};
function drawCircle(id, cx, cy, r, o) {
  o = o || {};
  hit(id, "circle", { c: [cx, cy, r] }, o.label);
  var a = assetOf(id), k = W / 1080;
  R.place[id] = { kind: "circle", cut: !!(a && a.cut) };
  if (!a) {
    if (!R.editor) return;
    g.save();
    g.shadowColor = "rgba(0,0,0,.6)"; g.shadowBlur = r * 0.2; g.shadowOffsetY = r * 0.04;
    g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fillStyle = mix(R.pal.shade, "#303038", 0.7); g.fill();
    g.restore();
    g.fillStyle = "rgba(255,255,255,.08)";
    g.beginPath(); g.arc(cx, cy - r * 0.18, r * 0.3, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.ellipse(cx, cy + r * 0.72, r * 0.7, r * 0.5, 0, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.arc(cx, cy, r - 1.5, 0, Math.PI * 2); g.lineWidth = Math.max(2, 3 * W / 640); g.strokeStyle = "rgba(255,255,255,.5)"; g.stroke();
    return;
  }
  var mode = o.mode || insetMode(lookOf());
  var res = insetRes(id, a, 2 * r, { mode: mode, ring: o.ring === "accent" ? R.pal.a : null, seed: o.seed, tone: o.tone });
  var e = expoOf(id);
  if (res) {
    var s = (2 * r) / (res.w - 2 * res.m);
    g.save(); g.imageSmoothingEnabled = true; g.imageSmoothingQuality = "high";
    g.drawImage(withExpo(res, e, res.key || ("ins:" + id + ":" + a.key)), cx - r - res.m * s, cy - r - res.m * s, res.w * s, res.h * s);
    g.restore();
    return;
  }
  // an export never draws the ungraded source in its place: it waits for the grade (or refuses)
  if (R.exact) return;
  var f0 = frameOf(id), li = lastInset[(R.thumb ? "th:" : "") + R.tpl.id + ":" + id + ":ins"];
  if (li && li.res.ak === a.key + ":" + a.ver) {
    // a drag in progress: the last finished inset, moved and zoomed by the frame change, until the
    // new grade lands on release
    var s1 = (2 * r) / (li.res.w - 2 * li.res.m), zs = f0.s / Math.max(0.05, li.f.s);
    g.save();
    g.shadowColor = "rgba(0,0,0,.6)"; g.shadowBlur = r * 0.2; g.shadowOffsetY = r * 0.04;
    g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fillStyle = "#3A3A40"; g.fill();
    g.restore();
    g.save();
    g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.clip();
    g.imageSmoothingEnabled = true; g.imageSmoothingQuality = "high";
    g.translate(cx + (f0.x - li.f.x) * k, cy + (f0.y - li.f.y) * k); g.scale(zs, zs);
    // the finished inset without its own ring (a moved ring would show as a second arc)
    if (!li.inner) {
      var ic = mkCanvas(li.res.w, li.res.h), ix = ic.getContext("2d"), ringPx = Math.max(2, 3 * 1080 / 640) + 1.5;
      ix.drawImage(li.res.c, 0, 0);
      ix.globalCompositeOperation = "destination-in";
      ix.beginPath(); ix.arc(li.res.w / 2, li.res.h / 2, Math.max(1, (li.res.w - 2 * li.res.m) / 2 - ringPx), 0, Math.PI * 2); ix.fill();
      li.inner = ic;
    }
    g.drawImage(li.inner, -r - li.res.m * s1, -r - li.res.m * s1, li.res.w * s1, li.res.h * s1);
    g.restore();
    g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.lineWidth = Math.max(2, 3 * W / 640); g.strokeStyle = o.ring === "accent" ? R.pal.a : "#FFFFFF"; g.stroke();
    return;
  }
  // the preview until the grade lands: the source in the circle (framed by the slot frame), a ring,
  // the dark shadow
  g.save();
  g.shadowColor = "rgba(0,0,0,.6)"; g.shadowBlur = r * 0.2; g.shadowOffsetY = r * 0.04;
  g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fillStyle = "#3A3A40"; g.fill();
  g.restore();
  g.save();
  g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.clip();
  if (mode === "inset") g.filter = "grayscale(1)";
  g.translate(cx + f0.x * k, cy + f0.y * k); g.scale(Math.max(0.3, f0.s), Math.max(0.3, f0.s));
  if (f0.flip) g.scale(-1, 1);
  if (a.cut && a.head) {
    var sc = (r * 2 * 0.36) / a.head.w;
    g.drawImage(a.img, -a.head.cx * sc, -r * 0.12 - a.head.cy * sc, a.w * sc, a.h * sc);
  } else {
    var s2 = Math.max(2 * r / a.w, 2 * r / a.h);
    g.drawImage(a.img, -a.w * s2 / 2, -a.h * s2 / 2, a.w * s2, a.h * s2);
  }
  g.restore();
  g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.lineWidth = Math.max(2, 3 * W / 640); g.strokeStyle = o.ring === "accent" ? R.pal.a : "#FFFFFF"; g.stroke();
}

// ---------- tiles (resume grid, card rows) ----------
// a head-and-shoulders tile is graded ONCE per asset with the vivid card grade (bright, crisp:
// the tiles sit on a bright accent plate) at a moderate size, and drawn scaled wherever needed
function tileRes(a, label) {
  var s = Math.min(1, 640 / Math.max(a.nw, a.nh)), ow = Math.max(8, Math.round(a.nw * s)), oh = Math.max(8, Math.round(a.nh * s)), se = ow / a.w;
  var sp = { rx: 0, ry: 0, rw: a.w, rh: a.h, ow: ow, oh: oh, mode: "vivid", px: 1080 / 640, seed: 7, upscale: 1,
             face: a.fbox ? [a.fbox[0] * se, a.fbox[1] * se, a.fbox[2] * se, a.fbox[3] * se] : null, theme: null, guard: guardTheme("vivid"), photo: !a.cut };
  var r;
  if (R.exact) { r = subjectJob(a, sp, false, 0, null); if (!r.out) pend(r.key, label); }
  else r = subjectJob(a, sp, false, R.thumb ? 5 : 2, null);
  if (!r.out) needKey(r.key);
  return r.out;
}
// o.expoId: the frame id whose exposure nudge applies (a tile, a bout square)
function tileImage(a, rect, o) {
  o = o || {};
  var res = tileRes(a, o.label);
  // an export never draws the ungraded source in a tile: it waits for the grade (or refuses)
  if (!res && R.exact) return 1;
  var e = o.expoId ? expoOf(o.expoId) : clamp(doc.fx.expo || 0, -1, 1);
  var src = res ? withExpo(res, e, res.key) : a.img, sw = src.width / a.w;
  g.save();
  g.beginPath(); g.rect(rect[0], rect[1], rect[2], rect[3]); g.clip();
  g.imageSmoothingEnabled = true; g.imageSmoothingQuality = "high";
  if (a.cut && a.head) {
    var flip = !!o.flip, hcx = flip ? a.w - a.head.cx : a.head.cx, sc, dx, dy;
    if (a.box && a.box.h / a.box.w < 1.25) {
      sc = (rect[2] * 1.5) / a.w;
      dx = rect[0] + rect[2] * (o.cx == null ? 0.5 : o.cx) - hcx * sc;
      dy = rect[1] + rect[3] + rect[3] * 0.02 - (a.box.y + a.box.h) * sc;
    } else {
      sc = (rect[2] * (o.headW || 0.5)) / a.head.w;
      dx = rect[0] + rect[2] * (o.cx == null ? 0.5 : o.cx) - hcx * sc;
      dy = rect[1] + rect[3] * (o.headY || 0.4) - a.head.cy * sc;
    }
    g.shadowColor = "rgba(0,0,0,.35)"; g.shadowBlur = rect[2] * 0.08; g.shadowOffsetY = rect[2] * 0.02;
    if (flip) { g.translate(dx + a.w * sc, dy); g.scale(-1, 1); g.drawImage(src, 0, 0, a.w * sc, a.h * sc); }
    else g.drawImage(src, 0, 0, src.width, src.height, dx, dy, a.w * sc, a.h * sc);
  } else {
    var s2 = Math.max(rect[2] / a.w, rect[3] / a.h), dw = a.w * s2, dh = a.h * s2;
    g.drawImage(src, 0, 0, src.width, src.height, rect[0] + (rect[2] - dw) / 2, rect[1] + (rect[3] - dh) * 0.25, dw, dh);
  }
  g.restore();
  return sw;
}
function drawTile(rect, tile, idx, o) {
  o = o || {};
  var p = R.pal, x = rect[0], y = rect[1], w = rect[2], h = rect[3];
  var gr = g.createLinearGradient(0, y, 0, y + h);
  gr.addColorStop(0, mix(p.a, p.hi, 0.22)); gr.addColorStop(0.55, p.a); gr.addColorStop(1, p.lo);
  g.fillStyle = gr; g.fillRect(x, y, w, h);
  var hl = g.createRadialGradient(x + w / 2, y + h * 0.38, 0, x + w / 2, y + h * 0.38, w * 0.7);
  hl.addColorStop(0, "rgba(255,255,255,.28)"); hl.addColorStop(1, "rgba(255,255,255,0)");
  g.save(); g.globalCompositeOperation = "screen"; g.fillStyle = hl; g.fillRect(x, y, w, h); g.restore();
  var a = tile && tile.a && assets[tile.a] ? assets[tile.a] : null;
  var hid = o.id || "tile:" + idx, hlab = o.label || "Tile " + (idx + 1);
  if (a) tileImage(a, rect, { headW: o.headW || 0.5, headY: o.headY || 0.42, expoId: hid, label: hlab });
  else if (R.editor) {
    g.fillStyle = "rgba(0,0,0,.14)";
    g.beginPath(); g.arc(x + w / 2, y + h * 0.42, w * 0.17, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.ellipse(x + w / 2, y + h * 1.02, w * 0.42, h * 0.36, 0, 0, Math.PI * 2); g.fill();
  }
  var sh = g.createLinearGradient(0, y + h * 0.7, 0, y + h);
  sh.addColorStop(0, "rgba(0,0,0,0)"); sh.addColorStop(1, "rgba(0,0,0,.28)");
  g.fillStyle = sh; g.fillRect(x, y + h * 0.7, w, h * 0.3);
  g.fillStyle = "rgba(255,255,255,.35)"; g.fillRect(x, y, w, Math.max(1, h * 0.012));
  hit(hid, o.kind || "tile", { r: rect }, hlab);
}

// ---------- the vivid cards: subjects framed and graded for a card (V1 heads, V2 bodies) ----------
// kind "head": the whole cut-out, debelted, framed by its head into the card (V1). kind "body":
// the chest crop of a full-body master (V2). Graded by gradeVivid in the worker; the float result
// feeds the card compositor. A master is cropped around the head here first (rows and columns a
// V2 chest crop can never reach are not shipped to the worker).
// a UFC full-body studio master (every one is 3324 px tall and cropped to the fighter, so the head
// is a steady share of the height): the head width it implies, in asset px (0: not such a master)
var UFC_HEAD_OF_HEIGHT = 0.107;
function ufcHeadRef(a) {
  if (!a || !a.ufc || !a.box || !a.cut) return 0;
  return a.box.h / Math.max(1, a.box.w) > 2.2 && a.box.h > 0.85 * a.h ? UFC_HEAD_OF_HEIGHT * a.box.h : 0;
}
// o: { cap (the job's longest side, default 1800), label }
function cardRes(a, kind, cw, ch, headFrac, topFrac, below, idKey, o) {
  o = o || {};
  var mode = lookOf().mode, theme = mode === "pop" ? R.pal.id : null, guard = mode === "pop" || mode === "mono" ? null : guardTheme(mode === "color" || mode === "natural" ? mode : "vivid");
  var capSide = Math.round((o.cap || 1800) * Math.sqrt(R.capK || 1));
  var key = ["card", a.key, a.ver, kind, cw, ch, headFrac.toFixed(4), topFrac.toFixed(4), below ? below.toFixed(3) : "-", mode, theme || "", guard || "", capSide].join("|");
  var tag = (R.thumb ? "th:" : "") + R.tpl.id + ":" + idKey;
  var res;
  if (R.exact) { res = job(key, make, 0); if (!res) pend(key, o.label || slotLabel(idKey)); }
  else res = job(key, make, R.thumb ? 5 : 1, tag);
  if (!res) needKey(key);
  return res;
  function make() {
    var rx = 0, ry = 0, rw = a.w, rh = a.h, T = ufcHeadRef(a), hint = null;
    if (a.head) {
      // a head the analyser measured far too small (under .7 of the body-height head) must not cut
      // the chest crop short; any other head keeps its own crop (the approved V2 framing)
      var hw = Math.max(a.head.w, 0.7 * T), top = a.head.top;
      if (kind === "body") { rx = a.head.cx - 2.4 * hw; rw = 4.8 * hw; ry = Math.max(0, top - 0.5 * hw); rh = 7.5 * hw; }
      else if (T) { rx = a.head.cx - 2.6 * hw; rw = 5.2 * hw; ry = Math.max(0, top - 0.5 * hw); rh = 6 * hw; }
      rx = clamp(Math.floor(rx), 0, a.w - 1); ry = clamp(Math.floor(ry), 0, a.h - 1);
      rw = Math.min(a.w - rx, Math.ceil(rw)); rh = Math.min(a.h - ry, Math.ceil(rh));
    }
    var kN = a.nw / a.w, cap = Math.min(1, capSide / Math.max(rw * kN, rh * kN));
    var ow = Math.max(8, Math.round(rw * kN * cap)), oh = Math.max(8, Math.round(rh * kN * cap)), sJ = ow / rw;
    if (a.head) hint = T ? { hw: T * sJ, lo: 0.85, hi: 1.25 } : { hw: a.head.w * sJ, lo: 0.5, hi: 2.0 };
    var px = assetPixels(a, rx, ry, rw, rh, ow, oh);
    return { job: { type: "card", rgba: px, w: ow, h: oh, kind: kind, cw: cw, ch: ch, headFrac: headFrac, topFrac: topFrac,
                    below: below, debelt: kind === "head", mode: mode, theme: theme, guard: guard, hint: hint, px: 1080 / 640 },
             transfer: [px.buffer],
             post: function (o2) { return { img: { w: o2.w, h: o2.h, data: o2.f32 }, crop: o2.crop, key: key, w: o2.w, h: o2.h }; } };
  }
}
// V3: the photo cropped to the card (the face centred when a cut-out of it exists), graded as a
// photograph (gradePhoto: the subject by the cut-out's alpha, the room defocused and calmed)
function photoCardRes(id, a, cutA, pw, ph) {
  var f = frameOf(id), k = W / 1080, pw1 = Math.round(pw / k), ph1 = Math.round(ph / k), mode = lookOf().mode, theme = mode === "pop" ? R.pal.id : null;
  var guard = mode === "pop" || mode === "mono" ? null : guardTheme(mode === "color" || mode === "natural" ? mode : "vivid");
  var key = ["photo", a.key, a.ver, cutA ? cutA.key + ":" + cutA.ver : "-", pw1, ph1, Math.round(f.x / k), Math.round(f.y / k), f.s.toFixed(3), f.flip ? 1 : 0, mode, theme || "", guard || ""].join("|");
  var tag = (R.thumb ? "th:" : "") + R.tpl.id + ":" + id;
  var res;
  if (R.exact) { res = job(key, make, 0); if (!res) pend(key, slotLabel(id)); }
  else if (!R.thumb && interacting()) { res = jobPeek(key); if (!res) scheduleSettle(); }
  else res = job(key, make, R.thumb ? 5 : 1, tag);
  if (!res) needKey(key);
  // a drag in progress: the last finished card photo, shifted and zoomed by the frame change, so
  // the photo follows the pointer (the new grade replaces it on release)
  var lk = (R.thumb ? "th:" : "") + R.tpl.id + ":" + id;
  if (res && !R.exact) lastPhotoCard[lk] = { res: res, f: { x: f.x, y: f.y, s: f.s }, ak: a.key + ":" + a.ver };
  else if (!res && !R.exact && lastPhotoCard[lk] && lastPhotoCard[lk].ak === a.key + ":" + a.ver) {
    var lp = lastPhotoCard[lk], c = mkCanvas(pw, ph), x = c.getContext("2d"), zs = f.s / Math.max(0.05, lp.f.s);
    x.fillStyle = "#0C0B0E"; x.fillRect(0, 0, pw, ph);
    x.translate(pw / 2 + (f.x - lp.f.x) * k, ph / 2 + (f.y - lp.f.y) * k); x.scale(zs, zs);
    x.drawImage(lp.res.c, -pw / 2, -ph / 2, pw, ph);
    return { c: c, w: pw, h: ph, key: "drag", preview: true };
  }
  return res;
  function make() {
    var asp = pw1 / ph1, ch = Math.min(a.h, a.w / asp) / Math.max(1, f.s), cw = ch * asp;
    var fb = cutA && cutA.fbox ? cutA.fbox : null, sx = a.w / (cutA ? cutA.w : a.w);
    var fcx = fb ? (fb[0] + fb[2] / 2) * sx : a.w / 2;
    var x0 = clamp(fcx - cw / 2 - f.x / k * cw / pw1, 0, a.w - cw), y0 = clamp((fb ? Math.max(0, fb[1] * sx - 0.35 * fb[3] * sx) : 0) - f.y / k * ch / ph1, 0, a.h - ch);
    var kN = a.nw / a.w, nw = Math.max(8, Math.round(cw * kN)), nh = Math.max(8, Math.round(ch * kN));
    var d = assetPixels(a, x0, y0, cw, ch, nw, nh, !!f.flip), rgb = new Uint8Array(nw * nh * 3), m = null, i;
    for (i = 0; i < nw * nh; i++) { rgb[i * 3] = d[i * 4]; rgb[i * 3 + 1] = d[i * 4 + 1]; rgb[i * 3 + 2] = d[i * 4 + 2]; }
    var box;
    if (cutA) {
      var md = assetPixels(cutA, x0 / sx, y0 / sx, cw / sx, ch / sx, nw, nh, !!f.flip);
      m = new Uint8Array(nw * nh);
      for (i = 0; i < nw * nh; i++) m[i] = md[i * 4 + 3];
    }
    if (fb) {
      var s = pw1 / cw, fx0 = fb[0] * sx - x0, fy0 = fb[1] * sx - y0, fw = fb[2] * sx, fh = fb[3] * sx;
      if (f.flip) fx0 = cw - fx0 - fw;
      box = [Math.floor((fx0 + 0.2 * fw) * s), Math.floor((fy0 + 0.25 * fh) * s), Math.floor((fx0 + 0.8 * fw) * s), Math.floor((fy0 + 0.85 * fh) * s)];
    } else box = [Math.floor(pw1 * 0.36), Math.floor(ph1 * 0.14), Math.floor(pw1 * 0.64), Math.floor(ph1 * 0.5)];
    return { job: { type: "photo", rgb: rgb, w: nw, h: nh, mask: m, ow: pw1, oh: ph1, box: box, mode: mode, theme: theme, guard: guard },
             transfer: m ? [rgb.buffer, m.buffer] : [rgb.buffer], post: function (o2) { var r = postCanvas(o2, key); r.key = key; return r; } };
  }
}

var lastPhotoCard = {};
// ---------- display type and marks for the approved layouts ----------
// look.display_text: Anton caps with the house fill (accent: mix(a, hi, .6) at the top, a at 55 %,
// mix(a, lo, .55) at the bottom; white: #FFFFFF, #FCFBFD, #E0DDE5; SOLID under a 46 px cap), a soft
// dark double shadow, fitted to maxW and maxCap; o.fill gives a short word's spare width to
// tracking (at most that many em per gap) so it still runs edge to edge. The cap BOTTOM sits on
// "bottom". Returns [x, capTop, w, cap].
function dispWord(text, cx, bottom, maxW, maxCap, o) {
  o = o || {};
  var t = upper(plain(text)).trim(), face = o.face || "anton", capPer = capOf(face), track = o.track == null ? -0.005 : o.track;
  if (!t) return [cx, bottom, 0, 0];
  setFont(face, 100, 0);
  var n = t.length, w100 = g.measureText(t).width / 100, wid = w100 + track * (n - 1);
  var size = Math.min(maxW / wid, maxCap / capPer);
  if (o.fill && n > 1 && size * wid < maxW) { track += Math.min((maxW / size - wid) / (n - 1), o.fill); wid = w100 + track * (n - 1); }
  var cap = capPer * size, tw = wid * size, x0 = cx - tw / 2, sh = o.shadow == null ? 0.85 : o.shadow;
  setFont(face, size, 0);
  function paint(dx, dy) {
    var xx = x0 + dx;
    for (var i = 0; i < n; i++) { var ch = t.charAt(i); g.fillText(ch, xx, bottom + dy); xx += g.measureText(ch).width + track * size; }
  }
  g.textBaseline = "alphabetic";
  if (sh > 0) {
    [[0.03, 0.05, 0.6, 0.75], [0.06, 0.16, 1.0, 0.55]].forEach(function (s) {
      g.save();
      g.shadowColor = "rgba(0,0,0," + (s[3] * sh) + ")"; g.shadowBlur = 2 * Math.max(s[2], s[1] * cap);
      g.shadowOffsetX = 60000; g.shadowOffsetY = Math.max(1, Math.round(s[0] * cap));
      g.fillStyle = "#000"; g.translate(-60000, 0); paint(0, 0);
      g.restore();
    });
  }
  var fill;
  if (o.color) fill = o.color;
  else if (cap < 46) fill = o.white ? "#FFFFFF" : R.pal.a;
  else {
    fill = g.createLinearGradient(0, bottom - cap, 0, bottom);
    if (o.white) { fill.addColorStop(0, "#FFFFFF"); fill.addColorStop(0.55, "#FCFBFD"); fill.addColorStop(1, "#E0DDE5"); }
    else { fill.addColorStop(0, mix(R.pal.a, R.pal.hi, 0.6)); fill.addColorStop(0.55, R.pal.a); fill.addColorStop(1, mix(R.pal.a, R.pal.lo, 0.55)); }
  }
  g.fillStyle = fill;
  paint(0, 0);
  return [x0, bottom - cap, tw, cap];
}
// posters.kicker: a small SOLID label (Barlow Condensed Bold, cap 31 at 1080, tracking .035)
// centred on cx, its cap bottom "gap" above the word's cap top
function kickerLine(text, cx, capTopOfWord, cap, gap, o) {
  o = o || {};
  var S = W / 1080;
  return dispWord(text, cx, capTopOfWord - gap * S, W * 0.92, cap * S, { face: "cond7", track: 0.035, shadow: 0.95, color: o.color || "#FFFFFF" });
}
// look.hand_arrow: a marker arrow along a quadratic path with a slight wobble, a stroke that
// swells then tapers and an open two-stroke head, in the theme colour over a soft dark shadow
function handArrow(p0, p1, p2, color, width, head) {
  var px = W / 640, M = mkCanvas(W, H), x = M.getContext("2d"), pts = [], i, rnd = 1.37;
  width = width || 6.0; head = head || 30.0;
  for (i = 0; i < 200; i++) {
    var t = i / 199, a0 = (1 - t) * (1 - t), a1 = 2 * (1 - t) * t, a2 = t * t;
    pts.push([a0 * p0[0] + a1 * p1[0] + a2 * p2[0], a0 * p0[1] + a1 * p1[1] + a2 * p2[1]]);
  }
  var out = [];
  for (i = 0; i < 200; i++) {
    var pa = pts[Math.max(0, i - 1)], pb = pts[Math.min(199, i + 1)], tx0 = pb[0] - pa[0], ty0 = pb[1] - pa[1], tl = Math.sqrt(tx0 * tx0 + ty0 * ty0) || 1;
    var t2 = i / 199, wob = Math.sin(t2 * Math.PI * 2.3 + rnd) * 2.0 * px;
    out.push([pts[i][0] - ty0 / tl * wob, pts[i][1] + tx0 / tl * wob, width * px * (0.35 + 0.65 * Math.sin(t2 * Math.PI * 0.92 + 0.12))]);
  }
  x.fillStyle = "#FFFFFF";
  for (i = 0; i < out.length; i++) { x.beginPath(); x.arc(out[i][0], out[i][1], out[i][2] / 2, 0, Math.PI * 2); x.fill(); }
  var tip = out[199], dxv = tip[0] - out[192][0], dyv = tip[1] - out[192][1], dl = Math.sqrt(dxv * dxv + dyv * dyv) || 1;
  dxv /= dl; dyv /= dl;
  [0.55, -0.62].forEach(function (ang) {
    var c = Math.cos(ang), s = Math.sin(ang), bx = -(dxv * c - dyv * s), by = -(dxv * s + dyv * c);
    for (var j = 0; j <= 40; j++) {
      var kk = j / 40, qx = tip[0] + bx * head * px * kk, qy = tip[1] + by * head * px * kk, r = width * px * (0.55 - 0.25 * kk);
      x.beginPath(); x.arc(qx, qy, r, 0, Math.PI * 2); x.fill();
    }
  });
  g.save();
  g.shadowColor = "rgba(0,0,0,.7)"; g.shadowBlur = 6 * px; g.shadowOffsetX = 60000 + 2 * px; g.shadowOffsetY = 3 * px;
  g.drawImage(M, -60000, 0);
  g.restore();
  x.globalCompositeOperation = "source-in"; x.fillStyle = color; x.fillRect(0, 0, W, H);
  g.drawImage(M, 0, 0);
}
// ---------- type ----------
var FONTS = {
  anton: function (s) { return "400 " + s + "px Anton, Impact, 'Arial Narrow', sans-serif"; },
  cond: function (s) { return "800 " + s + "px 'Barlow Condensed', 'Arial Narrow', sans-serif"; },
  cond7: function (s) { return "700 " + s + "px 'Barlow Condensed', 'Arial Narrow', sans-serif"; },
  cond6: function (s) { return "600 " + s + "px 'Barlow Condensed', 'Arial Narrow', sans-serif"; },
  pop: function (s) { return "700 " + s + "px Poppins, sans-serif"; },
  pop8: function (s) { return "800 " + s + "px Poppins, sans-serif"; }
};
var CAPS = { anton: 0.74, cond: 0.70, cond7: 0.70, cond6: 0.70, pop: 0.71, pop8: 0.71 };
var LS_OK = false;
try { LS_OK = "letterSpacing" in g; } catch (e) { LS_OK = false; }
function setFont(face, size, track) {
  g.font = (FONTS[face] || FONTS.anton)(Math.max(1, size));
  if (LS_OK) g.letterSpacing = ((track || 0) * size).toFixed(2) + "px";
}
function measureCaps() {
  var ks = Object.keys(FONTS);
  for (var i = 0; i < ks.length; i++) {
    setFont(ks[i], 100, 0);
    var m = g.measureText("H");
    if (m && m.actualBoundingBoxAscent > 20) CAPS[ks[i]] = m.actualBoundingBoxAscent / 100;
  }
  setFont("anton", 10, 0);
}
function capOf(face) { return CAPS[face] || 0.72; }
// "*word*" (or "*several words*") is a highlighted run; a newline forces a break
function toks(str) {
  var out = [], hot = false, ls = String(str == null ? "" : str).split(NL);
  for (var li = 0; li < ls.length; li++) {
    if (li) out.push({ br: true });
    var ws = ls[li].split(" ");
    for (var wi = 0; wi < ws.length; wi++) {
      var w = ws[wi], t = "", h0 = null;
      for (var c = 0; c < w.length; c++) {
        var ch = w.charAt(c);
        if (ch === "*") hot = !hot;
        else { if (h0 === null) h0 = hot; t += ch; }
      }
      if (t) out.push({ t: t, hot: !!h0 });
    }
  }
  return out;
}
function plain(str) { return String(str == null ? "" : str).split("*").join(""); }
function layout(tk, face, size, track, maxW) {
  setFont(face, size, track);
  var sp = g.measureText(" ").width, lines = [], cur = [], cw = 0;
  for (var i = 0; i < tk.length; i++) {
    var k = tk[i];
    if (k.br) { lines.push({ items: cur, w: cw }); cur = []; cw = 0; continue; }
    var w = g.measureText(k.t).width;
    if (cur.length && cw + sp + w > maxW) { lines.push({ items: cur, w: cw }); cur = []; cw = 0; }
    cw += (cur.length ? sp : 0) + w;
    cur.push({ t: k.t, hot: k.hot, w: w });
  }
  if (cur.length || !lines.length) lines.push({ items: cur, w: cw });
  return { lines: lines, sp: sp };
}
// the largest size whose wrap fits the box and the line cap, then the NARROWEST width that
// keeps that line count, so a three-line quote is three even lines instead of two long
// ones and a stub
function fit(str, face, box, o) {
  o = o || {};
  var track = o.track || 0, lh = o.lh || 1.0, maxL = o.lines || 9;
  if (o.keepLines) maxL = String(str == null ? "" : str).split(NL).length;
  var tk = toks(o.upper === false ? str : upper(str));
  var lo = o.min || 14, hi = o.max || 220, best = null, i, L;
  function ok(L, s) {
    if (L.lines.length > maxL || L.lines.length * s * lh > box[3] + s * 0.08) return false;
    for (var j = 0; j < L.lines.length; j++) if (L.lines[j].w > box[2] + 0.5) return false;
    return true;
  }
  L = layout(tk, face, hi, track, box[2]);
  if (ok(L, hi)) best = { s: hi, L: L };
  for (i = 0; i < 16 && !best; i++) {
    var mid = (lo + hi) / 2;
    L = layout(tk, face, mid, track, box[2]);
    if (ok(L, mid)) lo = mid; else hi = mid;
    if (hi - lo < 0.5) break;
  }
  if (!best) best = { s: lo, L: layout(tk, face, lo, track, box[2]) };
  if (o.balance !== false && best.L.lines.length > 1) {
    var n = best.L.lines.length, a = box[2] * 0.45, b = box[2];
    for (i = 0; i < 10; i++) {
      var m = (a + b) / 2, L2 = layout(tk, face, best.s, track, m);
      if (L2.lines.length <= n) { b = m; best.L = L2; } else a = m;
    }
  }
  return { size: best.s, lines: best.L.lines, sp: best.L.sp, face: face, track: track, lh: lh };
}
function isLight(hex) { var c = hexRgb(hex); return (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255 > 0.62; }
function textFill(kind, y0, y1, pal) {
  var p = pal || R.pal;
  if (kind === "ink") return p.ink;
  if (kind === "dark") return "#111116";
  if (kind === "flat") return "#FFFFFF";
  // small type is SOLID: a gradient across a 25 px letter only makes it look dirty and
  // unreadable (the owner could not read a gradient "IT'S OFFICIAL"); big type gets a
  // gentle top-to-bottom gradient that never strays far from its base color
  var small = Math.abs(y1 - y0) < 46;
  if (kind === "accent") {
    if (small) return p.a;
    var ga = g.createLinearGradient(0, y0, 0, y1);
    ga.addColorStop(0, mix(p.a, p.hi, 0.6)); ga.addColorStop(0.55, p.a); ga.addColorStop(1, mix(p.a, p.lo, 0.55));
    return ga;
  }
  if (small) return "#FFFFFF";
  var gw = g.createLinearGradient(0, y0, 0, y1);
  if (kind === "chrome") { gw.addColorStop(0, "#FFFFFF"); gw.addColorStop(0.5, "#F5F3F7"); gw.addColorStop(1, "#CFCCD6"); }
  else { gw.addColorStop(0, "#FFFFFF"); gw.addColorStop(0.5, "#FCFBFD"); gw.addColorStop(1, "#E0DDE5"); }
  return gw;
}
function shadowText(t, x, y, blur, off, alpha) {
  g.save();
  g.shadowColor = "rgba(0,0,0," + alpha + ")"; g.shadowBlur = blur;
  g.shadowOffsetX = 30000; g.shadowOffsetY = off;
  g.fillStyle = "#000"; g.fillText(t, x - 30000, y);
  g.restore();
}
// Draw a fitted block. y is the TOP of the first line; returns its box. o.color is the base
// fill (white gradient by default), hot words follow the page's highlight style: color
// (accent gradient type), box (accent plate behind the word) or under (accent bar).
function drawText(T, x, y, align, o) {
  o = o || {};
  var s = T.size, lh = T.lh, cap = capOf(T.face) * s, hs = o.hot || doc.hotStyle || "color";
  var p = R.pal, x0 = 1e9, x1 = -1e9;
  setFont(T.face, s, T.track);
  g.textBaseline = "alphabetic";
  var trackPad = LS_OK ? (T.track || 0) * s : 0;
  for (var i = 0; i < T.lines.length; i++) {
    var ln = T.lines[i], base = y + i * s * lh + cap;
    var lw = ln.w - trackPad, lx = align === "center" ? x - lw / 2 : align === "right" ? x - lw : x;
    x0 = Math.min(x0, lx); x1 = Math.max(x1, lx + lw);
    var cx = lx;
    for (var j = 0; j < ln.items.length; j++) {
      var it = ln.items[j], iw = it.w - trackPad;
      if (it.hot && hs === "box") {
        var pad = cap * 0.16;
        rr(cx - pad, base - cap - pad, iw + pad * 2, cap + pad * 2, cap * 0.08);
        g.fillStyle = textFill("accent", base - cap - pad, base + pad); g.fill();
      }
      if (o.shadow !== 0) shadowText(it.t, cx, base, s * 0.3, s * 0.06, 0.5 * (o.shadow == null ? 1 : o.shadow));
      if (o.stroke) {
        g.lineJoin = "round"; g.lineWidth = o.stroke.w; g.strokeStyle = o.stroke.c;
        g.strokeText(it.t, cx, base);
      }
      var kind = o.color || "white";
      if (it.hot) kind = hs === "color" ? (o.hotColor || "accent") : (hs === "box" ? (isLight(p.a) ? "ink" : "flat") : kind);
      if (!(o.stroke && o.stroke.only)) { g.fillStyle = textFill(kind, base - cap, base); g.fillText(it.t, cx, base); }
      if (it.hot && hs === "under") {
        g.fillStyle = textFill("accent", base + cap * 0.1, base + cap * 0.24);
        g.fillRect(cx, base + cap * 0.1, iw, Math.max(3, cap * 0.13));
      }
      cx += it.w + T.sp;
    }
  }
  if (LS_OK) g.letterSpacing = "0px";
  return [x0, y, x1 - x0, T.lines.length * s * lh];
}
// one line, shrunk to fit maxW
function line1(str, face, size, x, base, align, o) {
  o = o || {};
  var t = o.upper === false ? String(str || "") : upper(str);
  var s = size;
  setFont(face, s, o.track);
  if (o.maxW) { var w0 = g.measureText(t).width; if (w0 > o.maxW) { s = s * o.maxW / w0; setFont(face, s, o.track); } }
  var w = g.measureText(t).width - (LS_OK ? (o.track || 0) * s : 0);
  var lx = align === "center" ? x - w / 2 : align === "right" ? x - w : x;
  if (o.shadow) shadowText(t, lx, base, s * 0.3, s * 0.05, o.shadow);
  g.fillStyle = typeof o.fill === "string" && o.fill.charAt(0) === "#" ? o.fill : textFill(o.fill || "white", base - capOf(face) * s, base);
  if (o.alpha != null) g.globalAlpha = o.alpha;
  g.fillText(t, lx, base);
  g.globalAlpha = 1;
  if (LS_OK) g.letterSpacing = "0px";
  return { x: lx, w: w, s: s };
}

// ---------- light and atmosphere ----------
function glowAt(x, y, r, col, k, mode) {
  if (k <= 0.001) return;
  var gr = g.createRadialGradient(x, y, 0, x, y, r);
  gr.addColorStop(0, rgba(col, Math.min(1, 0.5 * k))); gr.addColorStop(0.35, rgba(col, 0.2 * k));
  gr.addColorStop(0.7, rgba(col, 0.05 * k)); gr.addColorStop(1, rgba(col, 0));
  g.save(); g.globalCompositeOperation = mode || "screen"; g.fillStyle = gr; g.fillRect(x - r, y - r, 2 * r, 2 * r); g.restore();
}
function glows(k) {
  var ls = R.lights;
  for (var i = 0; i < ls.length; i++) glowAt(ls[i].x * W, ls[i].y * H, ls[i].r * W, lightCol(ls[i].c), ls[i].k * (k == null ? 1 : k) * doc.fx.glow);
}
function vignette(k) {
  k = (k == null ? 1 : k) * doc.fx.vig;
  if (k <= 0.01) return;
  var gr = g.createRadialGradient(W / 2, H * 0.46, Math.min(W, H) * 0.32, W / 2, H * 0.5, Math.max(W, H) * 0.8);
  gr.addColorStop(0, "rgba(0,0,0,0)"); gr.addColorStop(1, "rgba(0,0,0," + Math.min(0.92, 0.78 * k) + ")");
  g.fillStyle = gr; g.fillRect(0, 0, W, H);
}
// a transparent-to-dark scrim (the owner's rule: never an opaque plate behind type)
function scrim(y0, y1, k, col, up) {
  var gr = g.createLinearGradient(0, up ? y1 : y0, 0, up ? y0 : y1);
  var c = col || "#000000";
  gr.addColorStop(0, rgba(c, 0)); gr.addColorStop(0.55, rgba(c, k * 0.72)); gr.addColorStop(1, rgba(c, k));
  g.fillStyle = gr;
  if (up) g.fillRect(0, 0, W, y1); else g.fillRect(0, y0, W, H - y0);
}
function base(col) {
  var p = R.pal, c = col || p.tint;
  var gr = g.createRadialGradient(W / 2, H * 0.4, 0, W / 2, H * 0.5, Math.max(W, H) * 0.75);
  gr.addColorStop(0, mix(c, "#1C1B20", 0.6)); gr.addColorStop(1, "#050506");
  g.fillStyle = gr; g.fillRect(0, 0, W, H);
}
// the arena behind a fighter: the crowd plate lit by the theme's light, warm and dim
function plateCol() { return mix(R.pal.glow, "#FFFFFF", 0.4); }
function arena(k, focusY, rect) {
  drawPlate("crowd", { color: plateCol(), alpha: 0.55 * (k == null ? 1 : k), mode: "screen", focusY: focusY == null ? 0.3 : focusY, rect: rect });
}
// the finishing grain for templates that do not place their own (GRIT.finalGrain, before any
// template grain pass: the old overlay noise and the grunge screen are retired - the approved
// look carries no dirt layer)
function grainPass() {
  if (R.grained || R.tpl.vivid) return;
  fxGrain(5, 0.010);
}
function haze(k, col) { drawPlate("haze", { mode: "screen", alpha: k, color: col || lightCol("a") }); }

// ---------- pieces ----------
function accentFill(y0, y1) { return textFill("accent", y0, y1); }
function quoteChip(cx, cy, h) {
  var p = R.pal, w = h * 1.72;
  g.save();
  g.shadowColor = "rgba(0,0,0,.45)"; g.shadowBlur = h * 0.4;
  rr(cx - w / 2, cy - h / 2, w, h, h * 0.2);
  g.fillStyle = accentFill(cy - h / 2, cy + h / 2); g.fill();
  g.restore();
  setFont("anton", h * 1.3, 0);
  var t = LQ + RQ, m = g.measureText(t);
  var asc = m.actualBoundingBoxAscent || h * 0.9, desc = m.actualBoundingBoxDescent || 0;
  var left = m.actualBoundingBoxLeft || 0, right = m.actualBoundingBoxRight || m.width;
  g.fillStyle = p.ink;
  g.fillText(t, cx - (right - left) / 2, cy + (asc - desc) / 2);
}
function quoteMark(cx, top, size, kind) {
  setFont("anton", size, 0);
  var m = g.measureText(LQ);
  var asc = m.actualBoundingBoxAscent || size * 0.8;
  shadowText(LQ, cx - m.width / 2, top + asc, size * 0.2, size * 0.04, 0.45);
  g.fillStyle = textFill(kind || "white", top, top + asc * 0.6);
  g.fillText(LQ, cx - m.width / 2, top + asc);
}
function tape(cx, cy, w, ang, str, o) {
  o = o || {};
  var im = plate(o.alt ? "tape2" : "tape1"), h = im ? w * im.height / im.width : w * 0.245;
  if (!im) texNeed(o.alt ? "tape2" : "tape1");
  g.save();
  g.translate(cx, cy); g.rotate(ang || 0);
  g.shadowColor = "rgba(0,0,0,.55)"; g.shadowBlur = h * 0.4; g.shadowOffsetY = h * 0.1;
  if (im) g.drawImage(im, -w / 2, -h / 2, w, h);
  else {
    g.beginPath(); g.moveTo(-w / 2, -h / 2);
    for (var i = 0; i <= 12; i++) g.lineTo(-w / 2 + (i % 2 ? 6 : 0), -h / 2 + h * i / 12);
    g.lineTo(w / 2, h / 2);
    for (i = 12; i >= 0; i--) g.lineTo(w / 2 - (i % 2 ? 6 : 0), -h / 2 + h * i / 12);
    g.closePath(); g.fillStyle = "#EDEBE6"; g.fill();
  }
  g.restore();
  g.save();
  g.translate(cx, cy); g.rotate(ang || 0);
  var T = fit(str, "anton", [0, 0, w * 0.8, h * 0.56], { max: h * 0.56, min: 12, lh: 1, lines: 1, balance: false });
  var cap = capOf("anton") * T.size;
  drawText(T, 0, -cap / 2 - h * 0.01, "center", { color: "dark", shadow: 0 });
  g.restore();
  return h;
}
// editor-only placeholders: the design reads before the images arrive, nothing exports
function phFighter(spec, label) {
  if (!R.editor) return;
  var hw = spec.head[2] * W, cx = spec.head[0] * W, cy = spec.head[1] * H;
  g.save();
  g.fillStyle = "rgba(255,255,255,.07)";
  g.beginPath(); g.ellipse(cx, cy, hw * 0.5, hw * 0.62, 0, 0, Math.PI * 2); g.fill();
  g.beginPath();
  g.moveTo(cx - hw * 0.28, cy + hw * 0.55);
  g.bezierCurveTo(cx - hw * 1.9, cy + hw * 0.9, cx - hw * 1.9, cy + hw * 2.2, cx - hw * 1.8, cy + hw * 4.5);
  g.lineTo(cx + hw * 1.8, cy + hw * 4.5);
  g.bezierCurveTo(cx + hw * 1.9, cy + hw * 2.2, cx + hw * 1.9, cy + hw * 0.9, cx + hw * 0.28, cy + hw * 0.55);
  g.closePath(); g.fill();
  setFont("pop", Math.max(15, hw * 0.13), 0);
  g.fillStyle = "rgba(255,255,255,.42)";
  var t = label || "Drop a fighter", tw = g.measureText(t).width;
  g.fillText(t, cx - tw / 2, cy + hw * 1.55);
  g.restore();
}
function phPhoto(rect, label) {
  if (!R.editor) return;
  g.save();
  g.beginPath(); g.rect(rect[0], rect[1], rect[2], rect[3]); g.clip();
  g.strokeStyle = "rgba(255,255,255,.035)"; g.lineWidth = 14;
  for (var i = -rect[3]; i < rect[2]; i += 44) { g.beginPath(); g.moveTo(rect[0] + i, rect[1]); g.lineTo(rect[0] + i + rect[3], rect[1] + rect[3]); g.stroke(); }
  setFont("pop", Math.max(14, Math.min(rect[2], rect[3]) * 0.045), 0);
  g.fillStyle = "rgba(255,255,255,.35)";
  var tw = g.measureText(label).width;
  g.fillText(label, rect[0] + rect[2] / 2 - tw / 2, rect[1] + Math.min(rect[3] * 0.5, rect[3] - 20));
  g.restore();
}

// ---------- templates ----------
// def() registers a template. slots: photo | cut | circle, each optionally auto-filled
// from loaded fighter data ("A.body", "B.head"). fields: text with a default that may read
// the data (D()). tiles / rows / bouts / form: the list editors a template uses. lights:
// the glow positions, which ALSO drive every cut-out's rim light, so light and rim always
// agree. draw() composes with the toolkit above.
var TPLS = [], TPL = {};
function def(t) { TPLS.push(t); TPL[t.id] = t; }
function D() { return { A: doc.people.A, B: doc.people.B, ev: doc.ev, bout: doc.bout }; }
function fieldOf(t, id) { var fs = t.fields || []; for (var i = 0; i < fs.length; i++) if (fs[i].id === id) return fs[i]; return null; }
function fieldDefault(t, f) { return typeof f.def === "function" ? (f.def(D(), t) || "") : (f.def || ""); }
// a quote template's sample quote is a placeholder, never a line put in a real fighter's mouth: the
// credit line stays empty until the owner has typed the quote, and the export refuses the sample
// (mustEdit on the template)
var QUOTE_PH = "TYPE THE *QUOTE* HERE";
function quoteTyped(t) { var o = doc.text[t.id]; return !!(o && o.quote != null && String(o.quote).trim()); }
function tx(id) {
  var t = R.tpl, o = doc.text[t.id];
  if (o && o[id] != null) return o[id];
  var f = fieldOf(t, id);
  return f ? fieldDefault(t, f) : "";
}
function textHit(id, box) { if (box && box[2] > 0) hit("text:" + id, "text", { r: [box[0] - 12, box[1] - 12, box[2] + 24, box[3] + 24] }, "Text"); }
function lastOf(P, fb) { return P ? upper(P.last || splitName(P.name).last) : (fb || ""); }
function firstOf(P, fb) { return P ? upper(P.first || splitName(P.name).first) : (fb || ""); }
function evDate(ev) {
  if (!ev || !ev.ts) return "";
  try {
    return upper(new Date(ev.ts * 1000).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })).split(",").join("");
  } catch (e) { return ""; }
}
function evPlace(ev) { return ev && ev.venue ? upper(String(ev.venue).split(",")[0]).trim() : ""; }
function evLine(D, withPlace) {
  var ev = D.ev;
  if (!ev) return "UFC 333 " + DOT + " SAT OCT 24";
  var bits = [upper(ev.title)], d = evDate(ev), pl = evPlace(ev);
  if (d) bits.push(d);
  if (withPlace && pl) bits.push(pl);
  return bits.join(" " + DOT + " ");
}
function daysTo(ev) { return ev && ev.ts ? Math.max(0, Math.ceil((ev.ts * 1000 - Date.now()) / 86400000)) : 7; }
function isFinish(m) { return !/^dec/i.test(String(m || "")); }
function winSplit(P, n) {
  var ws = ((P && P.fights) || []).filter(function (f) { return f.result === "win"; }).slice(0, n);
  var fin = ws.filter(function (f) { return isFinish(f.method); }).length;
  return { n: ws.length, fin: fin, dec: ws.length - fin };
}
function lastN(D) {
  var a = winSplit(D.A, 10), b = winSplit(D.B, 10), n = Math.min(10, D.A ? a.n : 10, D.B ? b.n : 10);
  return Math.max(1, n || 10);
}
function statLines(P, n, fb) {
  if (!P || !P.fights || !P.fights.length) return fb;
  var s = winSplit(P, n);
  return "*" + s.fin + (s.fin === 1 ? " FINISH*" : " FINISHES*") + NL + s.dec + (s.dec === 1 ? " DECISION" : " DECISIONS");
}
function tileLabel(tile, rect, size) {
  var name = upper(tile.name || ""), nm = splitName(name), x = rect[0] + rect[2] / 2;
  var y1 = rect[1] + rect[3] + size * 1.28, maxW = rect[2] * 1.12;
  var first = (tile.tag ? tile.tag + " " : "") + nm.first;
  if (nm.first || tile.tag) {
    var r1 = line1(first, "cond", size, x, y1, "center", { maxW: maxW, track: 0.02, shadow: 0.5 });
    if (tile.tag) {
      setFont("cond", r1.s, 0.02);
      g.fillStyle = textFill("accent", y1 - size, y1);
      g.fillText(upper(tile.tag), r1.x, y1);
      if (LS_OK) g.letterSpacing = "0px";
    }
    line1(nm.last, "cond", size, x, y1 + size * 1.02, "center", { maxW: maxW, track: 0.02, shadow: 0.5 });
  } else line1(nm.last, "cond", size, x, y1 + size * 0.5, "center", { maxW: maxW, track: 0.02, shadow: 0.5 });
}
// n tiles in 1-3 centered rows filling the bottom of area (x, y, w, h)
function tileGrid(n, area, ratio, labH) {
  var rows = n <= 5 ? 1 : n <= 12 ? 2 : 3, cols = Math.ceil(n / rows);
  var gap = area[2] * 0.02, tw = (area[2] - gap * (cols - 1)) / cols, th = tw * ratio, lh = tw * labH;
  var total = rows * (th + lh) + (rows - 1) * gap;
  if (total > area[3]) { var s = area[3] / total; tw *= s; th *= s; lh *= s; gap *= s; total = area[3]; }
  var out = [], y0 = area[1] + area[3] - total;
  for (var r = 0, i = 0; r < rows; r++) {
    var cnt = r < rows - 1 ? cols : n - cols * (rows - 1);
    var x0 = area[0] + (area[2] - (cnt * tw + (cnt - 1) * gap)) / 2;
    for (var c = 0; c < cnt; c++, i++) out.push([x0 + c * (tw + gap), y0 + r * (th + lh + gap), tw, th]);
  }
  return { rects: out, lab: tw * 0.135 };
}

def({
  id: "resume", name: "Resume", group: "Fight week", blurb: "Giant title, the fighter, everyone he has faced",
  fighters: ["A"],
  slots: [{ id: "bg", kind: "photo", label: "Background photo", note: "turns into the theme color", opt: true },
          { id: "main", kind: "cut", label: "Main fighter", from: "A.body", need: "cut" }],
  fields: [{ id: "title", label: "Title", def: "RESUME" }],
  tiles: { min: 3, max: 12, def: 10, label: "Opponents" },
  lights: [{ x: 0.5, y: 0.1, r: 0.55, k: 0.55, c: "a" }, { x: -0.04, y: 0.36, r: 0.5, k: 0.75, c: "a" }, { x: 1.04, y: 0.36, r: 0.5, k: 0.75, c: "a" }],
  draw: function () {
    var p = R.pal, tall = H > W;
    base();
    if (!drawPhoto("bg", [0, 0, W, H], { plate: true, quiet: true, fy: 0.25, fallback: "crowd", seed: 21 })) {
      arena(0.8, 0.3);
      var ga = assetOf("main");
      if (ga && ga.cut && ga.head) {
        var gsrc = ga.img;
        [[0.17, false], [0.83, true]].forEach(function (q) {
          var sc = (W * 0.3) / ga.head.w, hcx = q[1] ? ga.w - ga.head.cx : ga.head.cx;
          var dx = q[0] * W - hcx * sc, dy = H * (tall ? 0.24 : 0.27) - ga.head.cy * sc;
          g.save(); g.globalAlpha = 0.16; g.filter = "grayscale(1) brightness(0.8)";
          if (q[1]) { g.translate(dx + ga.w * sc, dy); g.scale(-1, 1); g.drawImage(gsrc, 0, 0, ga.w * sc, ga.h * sc); }
          else g.drawImage(gsrc, dx, dy, ga.w * sc, ga.h * sc);
          g.restore();
        });
      }
    }
    g.save(); g.globalCompositeOperation = "soft-light"; g.fillStyle = rgba(p.glow, 0.18); g.fillRect(0, 0, W, H); g.restore();
    glows(0.9);
    vignette(0.9);
    var T = fit(tx("title"), "anton", [W * 0.05, 0, W * 0.9, H * (tall ? 0.2 : 0.25)], { max: H * 0.36, lines: 1, track: 0.01 });
    var ty = H * (tall ? 0.035 : 0.028);
    g.save(); g.shadowColor = rgba(p.glow, 0.22); g.shadowBlur = T.size * 0.18;
    var tb = drawText(T, W / 2, ty, "center", { color: "accent", shadow: 0 });
    g.restore();
    drawText(T, W / 2, ty, "center", { color: "accent", shadow: 0 });
    textHit("title", tb);
    drawCut("main", { head: [0.5, tall ? 0.2 : 0.235, tall ? 0.2 : 0.215], side: "" }, { rim: 1, bloom: 0.7, label: "Main fighter" });
    scrim(H * (tall ? 0.5 : 0.47), H * (tall ? 0.74 : 0.72), 0.94);
    var tiles = doc.tiles.length ? doc.tiles : [{}, {}, {}, {}, {}, {}, {}, {}, {}, {}];
    var G = tileGrid(tiles.length, [W * 0.075, H * (tall ? 0.55 : 0.54), W * 0.85, H * (tall ? 0.43 : 0.44)], 1.0, 0.42);
    for (var i = 0; i < G.rects.length; i++) {
      drawTile(G.rects[i], tiles[i], i, { headW: 0.42, headY: 0.42 });
      if (tiles[i] && tiles[i].name) tileLabel(tiles[i], G.rects[i], G.lab * 1.02);
    }
  }
});

def({
  id: "spotlight", name: "Spotlight quote", group: "Quotes", blurb: "Action photo in the theme color, a circle, the quote",
  fighters: ["A", "B"],
  slots: [{ id: "bg", kind: "photo", label: "Action photo", note: "two fighters works best; turns into the theme color" },
          { id: "inset", kind: "circle", label: "Speaker (circle)", from: "A.head" },
          { id: "left", kind: "cut", label: "Left cut-out", note: "shown when there is no action photo", from: "A.body", opt: true },
          { id: "right", kind: "cut", label: "Right cut-out", note: "shown when there is no action photo", from: "B.body", opt: true }],
  mustEdit: ["quote"],
  fields: [{ id: "quote", label: "Quote", multi: true, def: QUOTE_PH },
           { id: "attr", label: "Credit line", def: "" }],
  lights: [{ x: -0.03, y: 0.0, r: 0.62, k: 1, c: "a" }, { x: 1.03, y: 0.0, r: 0.62, k: 1, c: "a" },
           { x: -0.06, y: 0.72, r: 0.42, k: 0.6, c: "a" }, { x: 1.06, y: 0.72, r: 0.42, k: 0.6, c: "a" }],
  draw: function () {
    var tall = H > W;
    base("#050507");
    var has = drawPhoto("bg", [0, 0, W, H], { plate: true, fy: 0.28, label: "Drop an action photo", quiet: !!(assetOf("left") || assetOf("right")), seed: 22 });
    if (!has) drawPlate("crowd", { color: plateCol(), alpha: 0.55, mode: "screen" });
    fxRadial(W * 0.5, H * 0.3, W * 0.8, H * 0.7, 0.30);
    glows(1);
    // with an action photo the cut-outs stay off unless he dropped one himself
    var cl = [];
    if (!has || slotKey("left")) cl.push(["left", { head: [0.25, tall ? 0.19 : 0.21, 0.15], side: "L" }, { rim: 1.2, label: "Left fighter" }]);
    if (!has || slotKey("right")) cl.push(["right", { head: [0.75, tall ? 0.19 : 0.21, 0.15], side: "R" }, { rim: 1.2, label: "Right fighter" }]);
    drawCuts(cl);
    vignette(0.85);
    scrim(H * 0.5, H * 0.9, 0.95);
    var cy = H * (tall ? 0.55 : 0.515), r = W * 0.148;
    drawCircle("inset", W / 2, cy, r, { label: "Speaker" });
    quoteMark(W / 2, cy - r - W * 0.075, W * 0.13, "white");
    var attr = tx("attr"), bottom = H * (attr ? 0.925 : 0.955), top = cy + r + H * 0.035;
    var T = fit(tx("quote"), "anton", [W * 0.06, top, W * 0.88, bottom - top], { max: H * 0.085, lines: 3, lh: 1.0 });
    var blockH = T.lines.length * T.size * T.lh, y = top + (bottom - top - blockH) * 0.5;
    textHit("quote", drawText(T, W / 2, y, "center", { shadow: 1 }));
    if (attr) line1(attr, "pop", H * 0.02, W / 2, H * 0.968, "center", { track: 0.14, fill: "#FFFFFF", alpha: 0.82, maxW: W * 0.9 });
  }
});

def({
  id: "clash", name: "Stat clash", group: "Fight week", blurb: "Two fighters, torn tape, the numbers",
  fighters: ["A", "B"],
  slots: [{ id: "left", kind: "cut", label: "Left fighter", note: "cut-out or photo", from: "A.body" },
          { id: "right", kind: "cut", label: "Right fighter", note: "cut-out or photo", from: "B.body" }],
  fields: [{ id: "title", label: "Tape", def: function (D) { return "LAST " + lastN(D) + " WINS"; } },
           { id: "statL", label: "Left stats", multi: true, def: function (D) { return statLines(D.A, lastN(D), "*8 FINISHES*" + NL + "2 DECISIONS"); } },
           { id: "statR", label: "Right stats", multi: true, def: function (D) { return statLines(D.B, lastN(D), "*3 FINISHES*" + NL + "7 DECISIONS"); } }],
  lights: [{ x: -0.05, y: 0.08, r: 0.5, k: 0.85, c: "a" }, { x: 1.05, y: 0.08, r: 0.5, k: 0.85, c: "a" },
           { x: 0.5, y: 0.3, r: 0.3, k: 0.5, c: "a" }],
  draw: function () {
    var p = R.pal, tall = H > W, hw = W / 2;
    base();
    drawPlate("crowd", { color: plateCol(), alpha: 0.55, mode: "screen", rect: [0, 0, hw, H], focusY: 0.2 });
    drawPlate("crowd", { color: plateCol(), alpha: 0.55, mode: "screen", rect: [hw, 0, hw, H], focusY: 0.2 });
    glows(0.9);
    var hy = tall ? 0.25 : 0.28;
    drawCuts([["left", { head: [0.25, hy, 0.158], side: "L", box: [0, 0, hw, H * 0.72] }, { clip: [0, 0, hw, H], label: "Left fighter" }],
              ["right", { head: [0.75, hy, 0.158], side: "R", box: [hw, 0, hw, H * 0.72] }, { clip: [hw, 0, hw, H], label: "Right fighter" }]]);
    var sg = g.createLinearGradient(0, 0, 0, H * 0.6);
    sg.addColorStop(0, "rgba(255,255,255,0)"); sg.addColorStop(0.5, "rgba(255,255,255,.22)"); sg.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = sg; g.fillRect(hw - 1.5, 0, 3, H * 0.6);
    vignette(0.6);
    scrim(H * 0.38, H * 0.68, 0.96);
    var ty = H * (tall ? 0.6 : 0.585);
    tape(W / 2, ty, W * 0.6, -0.018, tx("title"));
    hit("text:title", "text", { r: [W * 0.2, ty - H * 0.07, W * 0.6, H * 0.14] }, "Text");
    var top = H * (tall ? 0.685 : 0.672), boxH = H * 0.96 - top;
    var so = { max: Math.min(H, W) * 0.095, lh: 0.98, balance: false, keepLines: true };
    var TL = fit(tx("statL"), "anton", [0, 0, W * 0.44, boxH], so), TR = fit(tx("statR"), "anton", [0, 0, W * 0.44, boxH], so);
    so.max = Math.min(TL.size, TR.size);
    TL = fit(tx("statL"), "anton", [0, 0, W * 0.44, boxH], so); TR = fit(tx("statR"), "anton", [0, 0, W * 0.44, boxH], so);
    textHit("statL", drawText(TL, W * 0.265, top, "center", {}));
    textHit("statR", drawText(TR, W * 0.735, top, "center", {}));
  }
});

def({
  id: "splitq", name: "Split quote", group: "Quotes", blurb: "Two shots side by side, the quote under",
  fighters: ["A", "B"],
  slots: [{ id: "left", kind: "cut", label: "Left photo", note: "photo or cut-out", from: "A.body" },
          { id: "right", kind: "cut", label: "Right photo", note: "photo or cut-out", from: "B.body" }],
  mustEdit: ["quote"],
  fields: [{ id: "quote", label: "Quote", multi: true, def: QUOTE_PH },
           { id: "attr", label: "Credit line", def: function (D, t) { return D.A && D.B && quoteTyped(t) ? "- " + upper(D.A.name) + " ON " + upper(D.B.name) : ""; } }],
  lights: [{ x: -0.05, y: 0.05, r: 0.55, k: 0.8, c: "a" }, { x: 1.05, y: 0.05, r: 0.55, k: 0.8, c: "a" }, { x: 0.5, y: 0.62, r: 0.35, k: 0.35, c: "a" }],
  draw: function () {
    var p = R.pal, tall = H > W, hw = W / 2, one = assetOf("left") && !assetOf("right") && !assetOf("left").cut;
    base();
    if (!(assetOf("left") && assetOf("left").cut) || !(assetOf("right") && assetOf("right").cut)) {
      drawPlate("concrete", { color: plateCol(), alpha: 0.55, mode: "screen" });
    }
    glows(0.75);
    if (one) drawPhoto("left", [0, 0, W, H * 0.8], { fy: 0.25 });
    else {
      drawCuts([["left", { head: [0.25, tall ? 0.23 : 0.26, 0.16], side: "L", box: [0, 0, hw, H * 0.72] }, { clip: [0, 0, hw, H], label: "Left" }],
                ["right", { head: [0.75, tall ? 0.23 : 0.26, 0.16], side: "R", box: [hw, 0, hw, H * 0.72] }, { clip: [hw, 0, hw, H], label: "Right" }]]);
      g.fillStyle = "rgba(0,0,0,.55)"; g.fillRect(hw - 1, 0, 2, H * 0.62);
    }
    vignette(0.6);
    scrim(H * 0.36, H * 0.66, 0.96);
    var cy = H * (tall ? 0.56 : 0.545);
    quoteChip(W / 2, cy, H * 0.062);
    var attr = tx("attr"), top = cy + H * 0.055, bottom = H * (attr ? 0.925 : 0.96);
    var T = fit(tx("quote"), "anton", [W * 0.05, top, W * 0.9, bottom - top], { max: H * 0.105, lines: 3, lh: 0.97 });
    var y = top + (bottom - top - T.lines.length * T.size * T.lh) * 0.35;
    textHit("quote", drawText(T, W / 2, y, "center", {}));
    if (attr) line1(attr, "pop", H * 0.02, W / 2, H * 0.968, "center", { track: 0.14, fill: "#FFFFFF", alpha: 0.82, maxW: W * 0.9 });
  }
});

def({
  id: "cutq", name: "Cut-out quote", group: "Quotes", blurb: "Speaker cut-out, a circle of who he means",
  fighters: ["A", "B"],
  slots: [{ id: "main", kind: "cut", label: "Speaker", from: "A.body", need: "cut" },
          { id: "inset", kind: "circle", label: "Circle", note: "who he is talking about", from: "B.head" }],
  mustEdit: ["quote"],
  fields: [{ id: "quote", label: "Quote", multi: true, def: QUOTE_PH },
           { id: "attr", label: "Credit line", def: function (D, t) { return D.A && D.B && quoteTyped(t) ? "- " + upper(D.A.name) + " ON " + upper(D.B.name) : ""; } }],
  lights: [{ x: 1.05, y: 0.04, r: 0.62, k: 1, c: "a" }, { x: -0.06, y: 0.5, r: 0.46, k: 0.6, c: "a" }, { x: 0.55, y: 1.02, r: 0.45, k: 0.35, c: "a" }],
  draw: function () {
    var p = R.pal, tall = H > W;
    var gr = g.createRadialGradient(W * 0.6, H * 0.35, 0, W * 0.6, H * 0.4, W * 0.85);
    gr.addColorStop(0, mix(p.tint, "#3A3A45", 0.55)); gr.addColorStop(1, mix(p.tint, "#000000", 0.5));
    g.fillStyle = gr; g.fillRect(0, 0, W, H);
    drawPlate("concrete", { color: plateCol(), alpha: 0.55, mode: "screen" });
    glows(0.85);
    drawCut("main", { head: [0.64, tall ? 0.2 : 0.23, 0.15], side: "R" }, { rim: 1.1, bloom: 0.6, label: "Speaker" });
    drawCircle("inset", W * 0.25, H * (tall ? 0.24 : 0.27), W * 0.18, { ring: "white", label: "Circle" });
    vignette(0.7);
    scrim(H * 0.52, H * 0.8, 0.95);
    var cy = H * (tall ? 0.66 : 0.655);
    quoteChip(W / 2, cy, H * 0.058);
    var attr = tx("attr"), top = cy + H * 0.052, bottom = H * (attr ? 0.925 : 0.96);
    var T = fit(tx("quote"), "anton", [W * 0.05, top, W * 0.9, bottom - top], { max: H * 0.1, lines: 3, lh: 0.98 });
    var y = top + (bottom - top - T.lines.length * T.size * T.lh) * 0.4;
    textHit("quote", drawText(T, W / 2, y, "center", {}));
    if (attr) line1(attr, "pop", H * 0.02, W / 2, H * 0.968, "center", { track: 0.14, fill: "#FFFFFF", alpha: 0.82, maxW: W * 0.9 });
  }
});

function ftIn(v) {
  var n = parseFloat(v);
  if (!n) return "";
  var ft = Math.floor(n / 12), inch = Math.round(n - ft * 12);
  if (inch === 12) { ft++; inch = 0; }
  return ft + "'" + inch + '"';
}
function inches(v) { var n = parseFloat(v); return n ? (Math.round(n * 10) / 10) + '"' : ""; }
function recOf(P) { var r = String((P && P.record) || ""); return r.slice(-2) === "-0" ? r.slice(0, -2) : r; }
function tapeRows(D) {
  var A = D.A, B = D.B;
  if (!A && !B) {
    return [{ label: "RECORD", l: "27-4", r: "20-0" }, { label: "AGE", l: "37", r: "32" }, { label: "HEIGHT", l: "5'6" + '"', r: "*5'7" + '"*' },
            { label: "REACH", l: "*71.5" + '"*', r: '72"' }, { label: "KO/TKO WINS", l: "*13*", r: "3" }, { label: "SUB WINS", l: "3", r: "*6*" }];
  }
  A = A || {}; B = B || {};
  var ab = A.bio || {}, bb = B.bio || {}, am = A.method || {}, bm = B.method || {}, ar = A.rates || {}, br = B.rates || {};
  var raw = [
    ["RECORD", recOf(A), recOf(B)],
    ["AGE", ab.Age || "", bb.Age || ""],
    ["HEIGHT", ftIn(ab.Height), ftIn(bb.Height), parseFloat(ab.Height), parseFloat(bb.Height)],
    ["REACH", inches(ab.Reach), inches(bb.Reach), parseFloat(ab.Reach), parseFloat(bb.Reach)],
    ["LEG REACH", inches(ab["Leg reach"]), inches(bb["Leg reach"]), parseFloat(ab["Leg reach"]), parseFloat(bb["Leg reach"])],
    ["KO/TKO WINS", am["KO/TKO"] == null ? "" : String(am["KO/TKO"]), bm["KO/TKO"] == null ? "" : String(bm["KO/TKO"]), am["KO/TKO"], bm["KO/TKO"]],
    ["SUB WINS", am.SUB == null ? "" : String(am.SUB), bm.SUB == null ? "" : String(bm.SUB), am.SUB, bm.SUB],
    ["STRIKES / MIN", ar["Sig. Str. Landed"] == null ? "" : String(ar["Sig. Str. Landed"]), br["Sig. Str. Landed"] == null ? "" : String(br["Sig. Str. Landed"]),
      ar["Sig. Str. Landed"], br["Sig. Str. Landed"]]
  ];
  var out = [];
  for (var i = 0; i < raw.length && out.length < 7; i++) {
    var r = raw[i];
    if (!r[1] && !r[2]) continue;
    var l = r[1] || "-", rt = r[2] || "-";
    if (r.length > 3 && isFinite(r[3]) && isFinite(r[4]) && r[3] !== r[4] && r[3] != null && r[4] != null) {
      if (Number(r[3]) > Number(r[4])) l = "*" + l + "*"; else rt = "*" + rt + "*";
    }
    out.push({ label: r[0], l: l, r: rt });
  }
  return out;
}
def({
  id: "tape", name: "Tale of the tape", group: "Fight week", blurb: "Both fighters, the numbers down the middle",
  fighters: ["A", "B"],
  slots: [{ id: "left", kind: "cut", label: "Left fighter", from: "A.body", need: "cut" },
          { id: "right", kind: "cut", label: "Right fighter", from: "B.body", need: "cut" }],
  fields: [{ id: "title", label: "Title", def: "TALE OF THE TAPE" },
           { id: "nameL", label: "Left name", def: function (D) { return lastOf(D.A, "VOLKANOVSKI"); } },
           { id: "nameR", label: "Right name", def: function (D) { return lastOf(D.B, "EVLOEV"); } },
           { id: "event", label: "Event line", def: function (D) { return evLine(D, true); } }],
  rows: { label: "Stats", max: 8 },
  lights: [{ x: -0.06, y: 0.3, r: 0.6, k: 1, c: "a" }, { x: 1.06, y: 0.3, r: 0.6, k: 1, c: "a" }, { x: 0.5, y: -0.1, r: 0.45, k: 0.45, c: "w" }],
  draw: function () {
    var p = R.pal, tall = H > W;
    base();
    drawPlate("crowd", { color: plateCol(), alpha: 0.55, mode: "screen", focusY: 0.15 });
    glows(0.95);
    drawCuts([["left", { head: [0.17, tall ? 0.22 : 0.25, 0.118], side: "L" }, { rim: 1.2, label: "Left fighter" }],
              ["right", { head: [0.83, tall ? 0.22 : 0.25, 0.118], side: "R" }, { rim: 1.2, label: "Right fighter" }]]);
    var band = g.createLinearGradient(W * 0.3, 0, W * 0.7, 0);
    band.addColorStop(0, "rgba(0,0,0,0)"); band.addColorStop(0.3, "rgba(4,4,8,.62)"); band.addColorStop(0.7, "rgba(4,4,8,.62)"); band.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = band; g.fillRect(W * 0.3, 0, W * 0.4, H);
    vignette(0.7);
    scrim(H * 0.72, H * 0.92, 0.92);
    var t = line1(tx("title"), "cond", H * 0.032, W / 2, H * 0.085, "center", { track: 0.24, fill: "white", maxW: W * 0.5 });
    g.fillStyle = accentFill(0, H * 0.1);
    g.fillRect(t.x - W * 0.07, H * 0.085 - H * 0.013, W * 0.05, 3); g.fillRect(t.x + t.w + W * 0.02, H * 0.085 - H * 0.013, W * 0.05, 3);
    hit("text:title", "text", { r: [t.x - 20, H * 0.04, t.w + 40, H * 0.07] }, "Text");
    var rows = doc.rows && doc.rows.length ? doc.rows : tapeRows(D());
    var y0 = H * (tall ? 0.15 : 0.145), y1 = H * (tall ? 0.8 : 0.79), n = Math.max(1, rows.length);
    var rh = Math.min(H * 0.1, (y1 - y0) / n), vs = rh * 0.48, ls = rh * 0.18;
    for (var i = 0; i < rows.length; i++) {
      var ry = y0 + i * rh + (y1 - y0 - rh * n) / 2;
      line1(rows[i].label, "cond7", ls, W / 2, ry + ls * 1.05, "center", { track: 0.2, fill: "#A9A7BC", maxW: W * 0.3 });
      var base2 = ry + ls * 1.4 + vs * capOf("anton");
      var Lt = fit(rows[i].l, "anton", [0, 0, W * 0.15, vs * 1.05], { max: vs, lines: 1, balance: false });
      var Rt = fit(rows[i].r, "anton", [0, 0, W * 0.15, vs * 1.05], { max: vs, lines: 1, balance: false });
      drawText(Lt, W / 2 - W * 0.03, base2 - capOf("anton") * Lt.size, "right", { shadow: 0.6 });
      drawText(Rt, W / 2 + W * 0.03, base2 - capOf("anton") * Rt.size, "left", { shadow: 0.6 });
      g.fillStyle = accentFill(base2 - vs * 0.5, base2);
      g.beginPath(); g.arc(W / 2, base2 - vs * capOf("anton") * 0.5, Math.max(2.5, vs * 0.06), 0, Math.PI * 2); g.fill();
      if (i < rows.length - 1) {
        var lg = g.createLinearGradient(W * 0.36, 0, W * 0.64, 0);
        lg.addColorStop(0, "rgba(255,255,255,0)"); lg.addColorStop(0.5, "rgba(255,255,255,.14)"); lg.addColorStop(1, "rgba(255,255,255,0)");
        g.fillStyle = lg; g.fillRect(W * 0.36, ry + rh - 1, W * 0.28, 1.5);
      }
    }
    hit("rows", "rows", { r: [W * 0.33, y0, W * 0.34, y1 - y0] }, "Stats");
    var nb = H * (tall ? 0.915 : 0.905);
    var nl = line1(tx("nameL"), "anton", H * 0.078, W * 0.19, nb, "center", { maxW: W * 0.34, shadow: 0.6 });
    var nr = line1(tx("nameR"), "anton", H * 0.078, W * 0.81, nb, "center", { maxW: W * 0.34, shadow: 0.6 });
    hit("text:nameL", "text", { r: [nl.x - 10, nb - H * 0.07, nl.w + 20, H * 0.08] }, "Text");
    hit("text:nameR", "text", { r: [nr.x - 10, nb - H * 0.07, nr.w + 20, H * 0.08] }, "Text");
    var ev = line1(tx("event"), "cond", H * 0.024, W / 2, H * 0.968, "center", { track: 0.2, fill: "accent", maxW: W * 0.5 });
    hit("text:event", "text", { r: [ev.x - 10, H * 0.94, ev.w + 20, H * 0.05] }, "Text");
  }
});

function boutClass(D) {
  var c = D.bout && D.bout.cls ? upper(D.bout.cls) : "";
  if (!c) return "";
  if (c.indexOf("TITLE") !== -1) return c.split(" BOUT").join("").trim();
  return c.split(" BOUT").join("").trim();
}
def({
  id: "official", name: "Fight announcement", group: "Fight week", blurb: "It's official: both fighters, VS, the date",
  fighters: ["A", "B"],
  slots: [{ id: "left", kind: "cut", label: "Left fighter", from: "A.body", need: "cut" },
          { id: "right", kind: "cut", label: "Right fighter", from: "B.body", need: "cut" }],
  fields: [{ id: "kicker", label: "Top line", def: "IT'S OFFICIAL" },
           { id: "belt", label: "Bout line", def: function (D) { return boutClass(D) || "FEATHERWEIGHT TITLE"; } },
           { id: "nameL", label: "Left name", def: function (D) { return lastOf(D.A, "VOLKANOVSKI"); } },
           { id: "nameR", label: "Right name", def: function (D) { return lastOf(D.B, "EVLOEV"); } },
           { id: "event", label: "Event line", def: function (D) { return evLine(D, true); } }],
  lights: [{ x: -0.06, y: 0.34, r: 0.62, k: 1.05, c: "a" }, { x: 1.06, y: 0.34, r: 0.62, k: 1.05, c: "a" }, { x: 0.5, y: -0.06, r: 0.42, k: 0.5, c: "w" }],
  draw: function () {
    var p = R.pal, tall = H > W, L = R.lights;
    var cl = lightCol(L[0].c), cr = lightCol(L[1].c);
    var bg = g.createLinearGradient(0, 0, W, 0);
    bg.addColorStop(0, mix(cl, "#000000", 0.78)); bg.addColorStop(0.5, "#07070A"); bg.addColorStop(1, mix(cr, "#000000", 0.78));
    g.fillStyle = bg; g.fillRect(0, 0, W, H);
    arena(1, 0.25);
    glows(1);
    drawCuts([["left", { head: [0.27, tall ? 0.29 : 0.31, 0.145], side: "L" }, { rim: 1.25, label: "Left fighter" }],
              ["right", { head: [0.73, tall ? 0.29 : 0.31, 0.145], side: "R" }, { rim: 1.25, label: "Right fighter" }]]);
    vignette(0.75);
    scrim(H * 0.5, H * 0.84, 0.97);
    g.save();
    g.translate(W / 2, H * (tall ? 0.6 : 0.62));
    g.transform(1, 0, -0.14, 1, 0, 0);
    var V = fit("VS", "anton", [0, 0, W * 0.34, H * 0.2], { max: H * 0.22, lines: 1 });
    g.shadowColor = rgba(p.glow, 0.25); g.shadowBlur = V.size * 0.2;
    drawText(V, 0, -V.size * capOf("anton") / 2, "center", { color: "accent", shadow: 0 });
    g.restore();
    var k = line1(tx("kicker"), "cond", H * 0.036, W / 2, H * 0.085, "center", { track: 0.3, fill: "accent", maxW: W * 0.7, shadow: 0.5 });
    hit("text:kicker", "text", { r: [k.x - 10, H * 0.04, k.w + 20, H * 0.06] }, "Text");
    var belt = tx("belt");
    if (belt) {
      setFont("cond7", H * 0.021, 0.22);
      var bw = g.measureText(upper(belt)).width + H * 0.05, bh = H * 0.042, bx = W / 2 - bw / 2, by = H * 0.108;
      rr(bx, by, bw, bh, bh / 2); g.fillStyle = "rgba(0,0,0,.45)"; g.fill();
      g.lineWidth = 2; g.strokeStyle = accentFill(by, by + bh); g.stroke();
      if (LS_OK) g.letterSpacing = "0px";
      line1(belt, "cond7", H * 0.021, W / 2 + H * 0.002, by + bh / 2 + H * 0.0076, "center", { track: 0.22, fill: "#FFFFFF" });
      hit("text:belt", "text", { r: [bx, by, bw, bh] }, "Text");
    }
    var nb = H * (tall ? 0.885 : 0.875);
    var nl = line1(tx("nameL"), "anton", H * 0.098, W * 0.26, nb, "center", { maxW: W * 0.44, shadow: 0.7 });
    var nr = line1(tx("nameR"), "anton", H * 0.098, W * 0.74, nb, "center", { maxW: W * 0.44, shadow: 0.7 });
    hit("text:nameL", "text", { r: [nl.x - 10, nb - H * 0.09, nl.w + 20, H * 0.1] }, "Text");
    hit("text:nameR", "text", { r: [nr.x - 10, nb - H * 0.09, nr.w + 20, H * 0.1] }, "Text");
    var ev = line1(tx("event"), "cond7", H * 0.026, W / 2, H * 0.962, "center", { track: 0.2, fill: "#FFFFFF", alpha: 0.86, maxW: W * 0.86 });
    hit("text:event", "text", { r: [ev.x - 10, H * 0.93, ev.w + 20, H * 0.05] }, "Text");
  }
});

def({
  id: "whowins", name: "Who wins?", group: "Fight week", blurb: "Both fighters, one question, made to start arguments",
  fighters: ["A", "B"],
  slots: [{ id: "left", kind: "cut", label: "Left fighter", from: "A.body", need: "cut" },
          { id: "right", kind: "cut", label: "Right fighter", from: "B.body", need: "cut" }],
  fields: [{ id: "q1", label: "Line 1", def: "WHO" }, { id: "q2", label: "Line 2", def: "WINS?" },
           { id: "nameL", label: "Left name", def: function (D) { return lastOf(D.A, "VOLKANOVSKI"); } },
           { id: "nameR", label: "Right name", def: function (D) { return lastOf(D.B, "EVLOEV"); } },
           { id: "cta", label: "Bottom line", def: "COMMENT BELOW" }],
  lights: [{ x: -0.06, y: 0.18, r: 0.66, k: 1, c: "a" }, { x: 1.06, y: 0.18, r: 0.66, k: 1, c: "a" }, { x: 0.5, y: 1.05, r: 0.4, k: 0.25, c: "a" }],
  draw: function () {
    var p = R.pal, tall = H > W;
    base();
    arena(1, 0.25);
    glows(0.9);
    drawCuts([["left", { head: [0.25, tall ? 0.27 : 0.29, 0.145], side: "L" }, { label: "Left fighter" }],
              ["right", { head: [0.75, tall ? 0.27 : 0.29, 0.145], side: "R" }, { label: "Right fighter" }]]);
    vignette(0.75);
    scrim(H * 0.52, H * 0.86, 0.96);
    var T1 = fit(tx("q1"), "anton", [0, 0, W * 0.5, W * 0.14], { max: W * 0.14, lines: 1 });
    var T2 = fit(tx("q2"), "anton", [0, 0, W * 0.62, W * 0.19], { max: W * 0.19, lines: 1 });
    var y1 = H * (tall ? 0.575 : 0.5);
    textHit("q1", drawText(T1, W / 2, y1, "center", { color: "white", shadow: 1.2 }));
    textHit("q2", drawText(T2, W / 2, y1 + T1.size * 0.98, "center", { color: "accent", shadow: 1.2 }));
    var nb = H * 0.895;
    var nl = line1(tx("nameL"), "anton", Math.min(W, H) * 0.07, W * 0.24, nb, "center", { maxW: W * 0.38, shadow: 0.7 });
    var nr = line1(tx("nameR"), "anton", Math.min(W, H) * 0.07, W * 0.76, nb, "center", { maxW: W * 0.38, shadow: 0.7 });
    hit("text:nameL", "text", { r: [nl.x - 10, nb - H * 0.07, nl.w + 20, H * 0.08] }, "Text");
    hit("text:nameR", "text", { r: [nr.x - 10, nb - H * 0.07, nr.w + 20, H * 0.08] }, "Text");
    var cta = tx("cta");
    if (cta) {
      setFont("cond", H * 0.024, 0.26);
      var cw = g.measureText(upper(cta)).width + H * 0.06, ch = H * 0.048, cx = W / 2 - cw / 2, cyy = H * 0.932;
      if (LS_OK) g.letterSpacing = "0px";
      rr(cx, cyy, cw, ch, ch / 2); g.fillStyle = p.a; g.fill();
      line1(cta, "cond", H * 0.024, W / 2 + H * 0.003, cyy + ch / 2 + H * 0.0085, "center", { track: 0.26, fill: isLight(p.a) ? p.ink : "#FFFFFF" });
      hit("text:cta", "text", { r: [cx, cyy, cw, ch] }, "Text");
    }
  }
});

function boutLine(D) {
  if (D.A && D.B) return lastOf(D.A) + " VS " + lastOf(D.B);
  return D.ev && D.ev.headline ? upper(D.ev.headline) : "VOLKANOVSKI VS EVLOEV";
}
def({
  id: "countdown", name: "Countdown", group: "Fight week", blurb: "Days to go, the number behind the fighter",
  fighters: ["A", "B"],
  slots: [{ id: "main", kind: "cut", label: "Fighter", from: "A.body", need: "cut" }],
  fields: [{ id: "num", label: "Number", def: function (D) { return String(daysTo(D.ev)); } },
           { id: "unit", label: "Under the number", def: function (D) { return daysTo(D.ev) === 1 ? "DAY TO GO" : "DAYS TO GO"; } },
           { id: "event", label: "Event", def: function (D) { return D.ev ? upper(D.ev.title) : "UFC 333"; } },
           { id: "bout", label: "Bottom line", def: function (D) { return boutLine(D); } },
           { id: "date", label: "Date line", def: function (D) { return D.ev ? [evDate(D.ev), evPlace(D.ev)].filter(Boolean).join(" " + DOT + " ") : "SAT OCT 24"; } }],
  lights: [{ x: 0.74, y: 0.16, r: 0.56, k: 0.95, c: "a" }, { x: -0.05, y: 0.82, r: 0.5, k: 0.55, c: "a" }, { x: 1.05, y: 0.9, r: 0.4, k: 0.45, c: "a" }],
  draw: function () {
    var p = R.pal, tall = H > W;
    base();
    drawPlate("crowd", { color: plateCol(), alpha: 0.55, mode: "screen", focusY: 0.1 });
    glows(0.95);
    var ev = line1(tx("event"), "cond", H * 0.036, W * 0.06, H * 0.085, "left", { track: 0.26, fill: "accent", maxW: W * 0.5 });
    hit("text:event", "text", { r: [ev.x - 10, H * 0.04, ev.w + 20, H * 0.06] }, "Text");
    var N = fit(tx("num"), "anton", [0, 0, W * 0.62, H * (tall ? 0.56 : 0.6)], { max: H * 0.7, lines: 1, track: -0.01 });
    var top = H * 0.11;
    g.save(); g.shadowColor = rgba(p.glow, 0.2); g.shadowBlur = N.size * 0.12;
    var nb = drawText(N, W * 0.05, top, "left", { color: "accent", shadow: 0 });
    g.restore();
    textHit("num", nb);
    drawCut("main", { head: [0.73, tall ? 0.21 : 0.24, 0.155], side: "R" }, { rim: 1.15, bloom: 0.7, label: "Fighter" });
    vignette(0.7);
    scrim(H * 0.66, H * 0.9, 0.94);
    var U = fit(tx("unit"), "anton", [0, 0, W * 0.5, H * 0.1], { max: H * 0.1, lines: 1 });
    textHit("unit", drawText(U, W * 0.055, top + N.size * capOf("anton") + H * 0.03, "left", { shadow: 1.2 }));
    var b = line1(tx("bout"), "anton", H * 0.066, W / 2, H * 0.905, "center", { maxW: W * 0.9, shadow: 0.6 });
    hit("text:bout", "text", { r: [b.x - 10, H * 0.84, b.w + 20, H * 0.075] }, "Text");
    var d = line1(tx("date"), "cond7", H * 0.026, W / 2, H * 0.962, "center", { track: 0.22, fill: "#FFFFFF", alpha: 0.85, maxW: W * 0.86 });
    hit("text:date", "text", { r: [d.x - 10, H * 0.935, d.w + 20, H * 0.045] }, "Text");
  }
});

def({
  id: "card", name: "Main card", group: "Fight week", blurb: "Every bout on one poster",
  fighters: [],
  slots: [],
  fields: [{ id: "event", label: "Event", def: function (D) { return D.ev ? upper(D.ev.title) : "UFC 333"; } },
           { id: "sub", label: "Next to it", def: "MAIN CARD" },
           { id: "date", label: "Date line", def: function (D) { return D.ev ? [evDate(D.ev), evPlace(D.ev)].filter(Boolean).join(" " + DOT + " ") : "SAT OCT 24"; } }],
  bouts: { max: 6, label: "Bouts" },
  lights: [{ x: 0.5, y: -0.06, r: 0.7, k: 0.85, c: "a" }, { x: -0.05, y: 0.6, r: 0.4, k: 0.35, c: "a" }, { x: 1.05, y: 0.6, r: 0.4, k: 0.35, c: "a" }],
  draw: function () {
    var p = R.pal, tall = H > W;
    base();
    drawPlate("crowd", { color: plateCol(), alpha: 0.55, mode: "screen", rect: [0, 0, W, H * 0.45], focusY: 0.2 });
    scrim(H * 0.12, H * 0.34, 1, p.tint);
    glows(0.9);
    setFont("anton", H * 0.1, 0);
    var e1 = upper(tx("event")), e2 = upper(tx("sub")), w1 = g.measureText(e1).width, w2 = g.measureText(e2).width, gap = H * 0.028;
    var sc = Math.min(1, (W * 0.9) / (w1 + w2 + gap)), fs = H * 0.1 * sc, hb = H * 0.13;
    var x0 = W / 2 - (w1 + w2 + gap) * sc / 2;
    var r1 = line1(e1, "anton", fs, x0, hb, "left", { fill: "accent", shadow: 0.6 });
    var r2 = line1(e2, "anton", fs, x0 + (w1 + gap) * sc, hb, "left", { shadow: 0.6 });
    hit("text:event", "text", { r: [r1.x - 8, hb - fs, r1.w + 16, fs * 1.1] }, "Text");
    hit("text:sub", "text", { r: [r2.x - 8, hb - fs, r2.w + 16, fs * 1.1] }, "Text");
    var d = line1(tx("date"), "cond7", H * 0.024, W / 2, H * 0.178, "center", { track: 0.22, fill: "#FFFFFF", alpha: 0.8, maxW: W * 0.8 });
    hit("text:date", "text", { r: [d.x - 10, H * 0.15, d.w + 20, H * 0.04] }, "Text");
    var bouts = doc.bouts.length ? doc.bouts : [
      { l: { name: "Alexander Volkanovski" }, r: { name: "Movsar Evloev" }, cls: "Featherweight Title", title: true },
      { l: { name: "Petr Yan" }, r: { name: "Merab Dvalishvili" }, cls: "Bantamweight Title", title: true },
      { l: { name: "Lone'er Kavanagh" }, r: { name: "Ramazan Temirov" }, cls: "Flyweight" },
      { l: { name: "Alexander Volkov" }, r: { name: "Rizvan Kuniev" }, cls: "Heavyweight" },
      { l: { name: "Arnold Allen" }, r: { name: "Aaron Pico" }, cls: "Featherweight" }];
    var n = Math.min(bouts.length, tall ? 6 : 5), y0 = H * 0.215, y1 = H * 0.975, rh = Math.min(H * 0.17, (y1 - y0) / n);
    y0 = y0 + (y1 - y0 - rh * n) / 2;
    for (var i = 0; i < n; i++) {
      var b = bouts[i], ry = y0 + i * rh, ts = rh * 0.82, ty = ry + (rh - ts) / 2;
      var lr = [W * 0.04, ty, ts, ts], rrc = [W * 0.96 - ts, ty, ts, ts];
      drawTile(lr, b.l, i * 2, { headW: 0.44, headY: 0.44, id: "bout:" + i + ":l", kind: "bout", label: (b.l.name || "Left fighter") + " (square)" });
      drawTile(rrc, b.r, i * 2 + 1, { headW: 0.44, headY: 0.44, id: "bout:" + i + ":r", kind: "bout", label: (b.r.name || "Right fighter") + " (square)" });
      // names stop short of the centre column, which holds VS and the weight class
      var nlx = W * 0.04 + ts + W * 0.022, nrx = W * 0.96 - ts - W * 0.022, maxW = Math.max(W * 0.12, W / 2 - W * 0.115 - nlx);
      var ln = splitName(b.l.name || ""), rn = splitName(b.r.name || "");
      var mid = ry + rh * 0.5;
      line1(ln.first, "cond7", rh * 0.16, nlx, mid - rh * 0.1, "left", { track: 0.08, fill: "#FFFFFF", alpha: 0.7, maxW: maxW });
      line1(ln.last, "anton", rh * 0.33, nlx, mid + rh * 0.24, "left", { maxW: maxW, shadow: 0.5 });
      line1(rn.first, "cond7", rh * 0.16, nrx, mid - rh * 0.1, "right", { track: 0.08, fill: "#FFFFFF", alpha: 0.7, maxW: maxW });
      line1(rn.last, "anton", rh * 0.33, nrx, mid + rh * 0.24, "right", { maxW: maxW, shadow: 0.5 });
      line1("VS", "anton", rh * 0.24, W / 2, mid + rh * 0.04, "center", { fill: "accent" });
      if (b.cls) line1(b.cls, "cond", rh * 0.15, W / 2, mid + rh * 0.27, "center", { track: 0.06, fill: "#FFFFFF", alpha: b.title ? 1 : 0.75, maxW: W * 0.2 });
      if (i < n - 1) {
        var lg = g.createLinearGradient(W * 0.1, 0, W * 0.9, 0);
        lg.addColorStop(0, "rgba(255,255,255,0)"); lg.addColorStop(0.5, "rgba(255,255,255,.12)"); lg.addColorStop(1, "rgba(255,255,255,0)");
        g.fillStyle = lg; g.fillRect(W * 0.1, ry + rh - 1, W * 0.8, 1.5);
      }
    }
  }
});

function methodShort(m) {
  var s = upper(m);
  if (!s) return "";
  if (s.indexOf("DECISION") === 0) {
    var t = (s.split("-")[1] || "").trim();
    return t ? t + " DEC" : "DECISION";
  }
  if (s.indexOf("KO") === 0) return "KO/TKO";
  if (s.indexOf("SUB") === 0) return "SUBMISSION";
  if (s.indexOf("DQ") === 0) return "DQ";
  return s.slice(0, 18);
}
function lastWin(P) {
  var f = P && P.fights ? P.fights.filter(function (x) { return x.result === "win"; })[0] : null;
  if (!f) return "";
  return [methodShort(f.method), f.round ? "ROUND " + f.round : "", f.time && f.time !== "5:00" ? f.time : ""].filter(Boolean).join(" " + DOT + " ");
}
def({
  id: "andnew", name: "And new", group: "Results", blurb: "The winner, the belt, the moment",
  fighters: ["A"],
  slots: [{ id: "main", kind: "cut", label: "Winner", from: "A.body", need: "cut" }],
  fields: [{ id: "kick", label: "Small line", def: "AND" }, { id: "big", label: "Big word", def: "NEW" },
           { id: "name", label: "Name", def: function (D) { return D.A ? upper(D.A.name) : "ALEXANDER VOLKANOVSKI"; } },
           { id: "method", label: "How", def: function (D) { return lastWin(D.A) || "KO/TKO " + DOT + " ROUND 2 " + DOT + " 3:14"; } }],
  lights: [{ x: 0.5, y: -0.08, r: 0.75, k: 1, c: "hi" }, { x: -0.05, y: 0.55, r: 0.45, k: 0.55, c: "a" }, { x: 1.05, y: 0.55, r: 0.45, k: 0.55, c: "a" }],
  draw: function () {
    var p = R.pal, tall = H > W;
    base();
    arena(0.7, 0.2);
    drawPlate("rays", { mode: "screen", alpha: 0.4, color: mix(p.glow, "#FFFFFF", 0.35), rect: [0, -H * 0.02, W, H * 0.9], focusY: 0 });
    glows(0.9);
    var k = line1(tx("kick"), "anton", H * 0.09, W / 2, H * (tall ? 0.115 : 0.12), "center", { shadow: 0.6, maxW: W * 0.6 });
    hit("text:kick", "text", { r: [k.x - 10, H * 0.03, k.w + 20, H * 0.1] }, "Text");
    var B = fit(tx("big"), "anton", [0, 0, W * 0.94, H * 0.42], { max: H * 0.46, lines: 1, track: 0.005 });
    var by = H * (tall ? 0.13 : 0.135);
    g.save(); g.shadowColor = rgba(p.glow, 0.22); g.shadowBlur = B.size * 0.15;
    var bb = drawText(B, W / 2, by, "center", { color: "accent", shadow: 0 });
    g.restore();
    textHit("big", bb);
    drawCut("main", { head: [0.5, tall ? 0.3 : 0.33, 0.13], side: "" }, { rim: 1.1, bloom: 0.8, label: "Winner" });
    vignette(0.7);
    scrim(H * 0.6, H * 0.84, 0.96);
    var T = fit(tx("name"), "anton", [W * 0.05, 0, W * 0.9, H * 0.11], { max: H * 0.11, lines: 1 });
    textHit("name", drawText(T, W / 2, H * (tall ? 0.8 : 0.79), "center", { color: "chrome", shadow: 1 }));
    var m = tx("method");
    if (m) {
      setFont("cond", H * 0.028, 0.14);
      var mw = g.measureText(upper(m)).width + H * 0.07, mh = H * 0.055, mx = W / 2 - mw / 2, my = H * 0.9;
      if (LS_OK) g.letterSpacing = "0px";
      g.save(); g.shadowColor = "rgba(0,0,0,.45)"; g.shadowBlur = mh * 0.4;
      rr(mx, my, mw, mh, mh / 2); g.fillStyle = accentFill(my, my + mh); g.fill();
      g.restore();
      line1(m, "cond", H * 0.028, W / 2 + H * 0.004, my + mh / 2 + H * 0.0098, "center", { track: 0.14, fill: isLight(p.a) ? p.ink : "#FFFFFF" });
      hit("text:method", "text", { r: [mx, my, mw, mh] }, "Text");
    }
  }
});

def({
  id: "bigstat", name: "Big number", group: "Stats", blurb: "One fighter, one number that says it all",
  fighters: ["A"],
  slots: [{ id: "main", kind: "cut", label: "Fighter", from: "A.body", need: "cut" }],
  fields: [{ id: "num", label: "Number", def: function (D) { return D.A && D.A.method && D.A.method["KO/TKO"] != null ? String(D.A.method["KO/TKO"]) : "15"; } },
           { id: "label", label: "What it is", multi: true, def: function (D) { return D.A && D.A.method && D.A.method["KO/TKO"] != null ? "KNOCKOUT" + NL + "WINS" : "STRAIGHT" + NL + "WINS"; } },
           { id: "sub", label: "Small print", def: function (D) { return D.A && D.A.record ? "PRO RECORD " + recOf(D.A) : "LONGEST ACTIVE STREAK IN THE DIVISION"; } },
           { id: "name", label: "Name", def: function (D) { return D.A ? upper(D.A.name) : "ALEXANDER VOLKANOVSKI"; } }],
  lights: [{ x: 0.8, y: 0.28, r: 0.55, k: 0.95, c: "a" }, { x: -0.06, y: 0.1, r: 0.5, k: 0.6, c: "a" }, { x: 0.3, y: 1.05, r: 0.4, k: 0.35, c: "a" }],
  draw: function () {
    var p = R.pal, tall = H > W;
    base();
    drawPlate("concrete", { color: plateCol(), alpha: 0.55, mode: "screen" });
    glows(0.95);
    drawCut("main", { head: [0.29, tall ? 0.22 : 0.24, 0.165], side: "L" }, { rim: 1.15, bloom: 0.6, label: "Fighter" });
    var sh = g.createLinearGradient(W * 0.45, 0, W, 0);
    sh.addColorStop(0, "rgba(0,0,0,0)"); sh.addColorStop(0.35, "rgba(0,0,0,.45)"); sh.addColorStop(1, "rgba(0,0,0,.55)");
    g.fillStyle = sh; g.fillRect(W * 0.45, 0, W * 0.55, H);
    vignette(0.7);
    scrim(H * 0.72, H * 0.95, 0.9);
    var cx = W * 0.73;
    var N = fit(tx("num"), "anton", [0, 0, W * 0.5, H * 0.44], { max: H * 0.5, lines: 1, track: -0.01 });
    g.save(); g.shadowColor = rgba(p.glow, 0.2); g.shadowBlur = N.size * 0.12;
    var nb = drawText(N, cx, H * (tall ? 0.14 : 0.1), "center", { color: "accent", shadow: 0 });
    g.restore();
    textHit("num", nb);
    var Lb = fit(tx("label"), "anton", [0, 0, W * 0.48, H * 0.22], { max: H * 0.11, lines: 2, lh: 0.96 });
    var ly = nb[1] + N.size * capOf("anton") + H * 0.04;
    textHit("label", drawText(Lb, cx, ly, "center", {}));
    var S = fit(tx("sub"), "cond7", [0, 0, W * 0.44, H * 0.08], { max: H * 0.03, lines: 2, lh: 1.1, track: 0.12 });
    textHit("sub", drawText(S, cx, ly + Lb.lines.length * Lb.size * Lb.lh + H * 0.03, "center", { color: "flat", shadow: 0.4 }));
    var nm = line1(tx("name"), "cond", H * 0.03, W * 0.3, H * 0.955, "center", { track: 0.22, fill: "#FFFFFF", maxW: W * 0.52, shadow: 0.6 });
    hit("text:name", "text", { r: [nm.x - 10, H * 0.925, nm.w + 20, H * 0.045] }, "Text");
  }
});

function formRows(D) {
  var fs = (D.A && D.A.fights) || [];
  if (!fs.length) {
    return [{ res: "W", opp: "HOLLOWAY", how: "UNANIMOUS DEC", ev: "UFC 314" }, { res: "L", opp: "TOPURIA", how: "KO/TKO " + DOT + " R2", ev: "UFC 298" },
            { res: "L", opp: "MAKHACHEV", how: "KO/TKO " + DOT + " R1", ev: "UFC 294" }, { res: "W", opp: "RODRIGUEZ", how: "KO/TKO " + DOT + " R3", ev: "UFC 290" },
            { res: "W", opp: "HOLLOWAY", how: "UNANIMOUS DEC", ev: "UFC 276" }];
  }
  return fs.slice(0, 5).map(function (f) {
    return { res: f.result === "win" ? "W" : f.result === "loss" ? "L" : f.result === "draw" ? "D" : "NC",
             opp: upper(splitName(f.opp).last), how: methodShort(f.method) + (f.round && isFinish(f.method) ? " " + DOT + " R" + f.round : ""),
             ev: upper(f.event || "") };
  });
}
def({
  id: "form", name: "Last 5 fights", group: "Stats", blurb: "Form guide: result, opponent, how",
  fighters: ["A"],
  slots: [{ id: "main", kind: "cut", label: "Fighter", from: "A.body", need: "cut" }],
  fields: [{ id: "title", label: "Title", def: "LAST *5*" },
           { id: "name", label: "Name", def: function (D) { return D.A ? upper(D.A.name) : "ALEXANDER VOLKANOVSKI"; } }],
  form: { label: "Results" },
  lights: [{ x: -0.06, y: 0.12, r: 0.55, k: 0.9, c: "a" }, { x: 0.62, y: 0.02, r: 0.45, k: 0.5, c: "a" }, { x: 0.2, y: 1.05, r: 0.45, k: 0.4, c: "a" }],
  draw: function () {
    var p = R.pal, tall = H > W;
    base();
    drawPlate("crowd", { color: plateCol(), alpha: 0.55, mode: "screen", focusY: 0.1 });
    glows(0.9);
    drawCut("main", { head: [0.25, tall ? 0.21 : 0.23, 0.155], side: "L" }, { rim: 1.1, label: "Fighter" });
    var sh = g.createLinearGradient(W * 0.38, 0, W, 0);
    sh.addColorStop(0, "rgba(0,0,0,0)"); sh.addColorStop(0.3, "rgba(4,4,8,.6)"); sh.addColorStop(1, "rgba(4,4,8,.72)");
    g.fillStyle = sh; g.fillRect(W * 0.38, 0, W * 0.62, H);
    vignette(0.6);
    scrim(H * 0.8, H, 0.85);
    var T = fit(tx("title"), "anton", [0, 0, W * 0.44, H * 0.12], { max: H * 0.12, lines: 1 });
    textHit("title", drawText(T, W * 0.945, H * 0.06, "right", {}));
    var nm = line1(tx("name"), "cond", H * 0.026, W * 0.945, H * 0.06 + T.size * capOf("anton") + H * 0.045, "right", { track: 0.22, fill: "accent", maxW: W * 0.44 });
    hit("text:name", "text", { r: [nm.x - 10, H * 0.16, nm.w + 20, H * 0.05] }, "Text");
    var rows = doc.form && doc.form.length ? doc.form : formRows(D());
    var x0 = W * 0.5, x1 = W * 0.945, y0 = H * 0.27, y1 = H * 0.95, rh = (y1 - y0) / Math.max(1, rows.length);
    for (var i = 0; i < rows.length; i++) {
      var r0 = rows[i], ry = y0 + i * rh, bs = Math.min(rh * 0.62, W * 0.075), by = ry + (rh - bs) / 2;
      var win = r0.res === "W", loss = r0.res === "L";
      rr(x0, by, bs, bs, bs * 0.14);
      if (win) { g.fillStyle = accentFill(by, by + bs); g.fill(); }
      else { g.fillStyle = loss ? "rgba(255,255,255,.06)" : "rgba(255,255,255,.12)"; g.fill(); g.lineWidth = 2; g.strokeStyle = loss ? "rgba(255,255,255,.55)" : "rgba(255,255,255,.3)"; g.stroke(); }
      line1(r0.res, "anton", bs * 0.62, x0 + bs / 2, by + bs / 2 + bs * 0.62 * capOf("anton") / 2, "center", { fill: win ? (isLight(p.a) ? p.ink : "#FFFFFF") : "#FFFFFF" });
      var tx0 = x0 + bs + W * 0.025, mw = x1 - tx0;
      line1(r0.opp, "anton", rh * 0.36, tx0, ry + rh * 0.5 + rh * 0.02, "left", { maxW: mw, shadow: 0.4, alpha: loss ? 0.8 : 1 });
      line1([r0.how, r0.ev].filter(Boolean).join("  " + DOT + "  "), "cond7", rh * 0.17, tx0, ry + rh * 0.5 + rh * 0.26, "left", { track: 0.1, fill: "#B8B6C8", maxW: mw });
      if (i < rows.length - 1) { g.fillStyle = "rgba(255,255,255,.08)"; g.fillRect(x0, ry + rh - 1, x1 - x0, 1.5); }
    }
    hit("form", "rows", { r: [x0, y0, x1 - x0, y1 - y0] }, "Results");
  }
});

def({
  id: "faceoff", name: "Face-off", group: "Fight week", blurb: "Staredown: two faces, one light between them",
  fighters: ["A", "B"],
  slots: [{ id: "left", kind: "cut", label: "Left fighter", from: "A.body", need: "cut" },
          { id: "right", kind: "cut", label: "Right fighter", from: "B.body", need: "cut" }],
  fields: [{ id: "kicker", label: "Top line", def: "FIGHT WEEK" },
           { id: "nameL", label: "Left name", def: function (D) { return lastOf(D.A, "VOLKANOVSKI"); } },
           { id: "nameR", label: "Right name", def: function (D) { return lastOf(D.B, "EVLOEV"); } },
           { id: "event", label: "Event line", def: function (D) { return evLine(D, false); } }],
  lights: [{ x: 0.5, y: 0.42, r: 0.3, k: 1.1, c: "w" }, { x: -0.08, y: 0.4, r: 0.5, k: 0.7, c: "a" }, { x: 1.08, y: 0.4, r: 0.5, k: 0.7, c: "a" }],
  draw: function () {
    var p = R.pal, tall = H > W;
    g.fillStyle = "#040405"; g.fillRect(0, 0, W, H);
    glows(0.7);
    drawCuts([["left", { head: [0.28, tall ? 0.38 : 0.4, 0.27], side: "L" }, { clip: [0, 0, W / 2, H], rim: 1.3, shade: 0.6, label: "Left fighter" }],
              ["right", { head: [0.72, tall ? 0.38 : 0.4, 0.27], side: "R" }, { clip: [W / 2, 0, W / 2, H], rim: 1.3, shade: 0.6, label: "Right fighter" }]]);
    fxSplit(W / 2, 0.6, 5);
    g.save();
    var sg = g.createLinearGradient(0, 0, 0, H);
    sg.addColorStop(0, "rgba(255,255,255,0)"); sg.addColorStop(0.3, rgba(mix("#FFFFFF", p.glow, 0.35), 0.8)); sg.addColorStop(0.75, rgba(p.glow, 0.4)); sg.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = sg; g.fillRect(W / 2 - 1, 0, 2, H);
    g.restore();
    vignette(0.8);
    scrim(H * 0.66, H * 0.88, 0.97);
    var k = line1(tx("kicker"), "cond", H * 0.032, W / 2, H * 0.075, "center", { track: 0.36, fill: "accent", maxW: W * 0.7, shadow: 0.6 });
    hit("text:kicker", "text", { r: [k.x - 10, H * 0.035, k.w + 20, H * 0.055] }, "Text");
    var nb = H * 0.9;
    var nl = line1(tx("nameL"), "anton", Math.min(H, W) * 0.085, W * 0.25, nb, "center", { maxW: W * 0.36, shadow: 0.7 });
    var nr = line1(tx("nameR"), "anton", Math.min(H, W) * 0.085, W * 0.75, nb, "center", { maxW: W * 0.36, shadow: 0.7 });
    line1("VS", "anton", H * 0.05, W / 2, nb - H * 0.012, "center", { fill: "accent" });
    hit("text:nameL", "text", { r: [nl.x - 10, nb - H * 0.08, nl.w + 20, H * 0.09] }, "Text");
    hit("text:nameR", "text", { r: [nr.x - 10, nb - H * 0.08, nr.w + 20, H * 0.09] }, "Text");
    var ev = line1(tx("event"), "cond7", H * 0.025, W / 2, H * 0.962, "center", { track: 0.22, fill: "#FFFFFF", alpha: 0.8, maxW: W * 0.8 });
    hit("text:event", "text", { r: [ev.x - 10, H * 0.935, ev.w + 20, H * 0.045] }, "Text");
  }
});

// ---------- the approved looks (Sept 25 2026): three gritty layouts, three card layouts ----------
// Built from the lab's recipes (grade_gritty API 6, grade_vivid API 4) in the order that matters:
// plate -> sinks -> clearance -> insets -> the hero's dark halo -> hero -> fades -> grain -> type.
// Every number is a 1080-wide px value scaled by S = W / 1080 (thumbnails), and at the other
// aspect the layout is re-spaced, never squashed. The face places a hero: its face box
// (GRIT.faceFromHead) lands at a fixed width and position, then the owner's frame pans / zooms it.
// faceFromHead's box sits .12 face heights ABOVE the lab's hand box (port_g/API.md section 7, measured
// on Makhachev): the placement lifts the hero by that much so the real face lands where the
// approved posters put it (the headline hero came out ~70 px low and uncovered the plate's logos)
var FACE_BOX_BIAS = 0.12;
function faceHero(id, fw, fcx, ftop) {
  var a = assetOf(id);
  if (!a || !a.cut || !a.fbox) return null;
  var f = frameOf(id), fb = a.fbox, s0 = fw / fb[2], s = s0 * Math.max(0.3, f.s), fcy = ftop + fb[3] * s0 * (0.5 - FACE_BOX_BIAS);
  // the owner's zoom scales about the face CENTRE (the wheel keeps the point under the pointer)
  var P = { sc: s, dx: fcx - (fb[0] + fb[2] / 2) * s + f.x, dy: fcy - (fb[1] + fb[3] / 2) * s + f.y, flip: !!f.flip, hw: a.head.w * s };
  if (P.flip) P.dx = fcx - (a.w - fb[0] - fb[2] / 2) * s + f.x;
  P.hx = fcx + f.x; P.hy = fcy + f.y;
  P.fbc = [fcx + f.x, fcy + f.y - fb[3] * s * 0.5, fb[2] * s, fb[3] * s];
  return { a: a, P: P };
}
// a cut-out is hit by its MATTE (the low-res alpha of its layer), not its rectangle: at the face-
// anchored scale the rectangle covers nearly the whole canvas and swallowed every circle and drop
function heroHit(id, hl, P, label) {
  R.place[id] = { kind: "cut", P: P, spec: null };
  hit(id, "cut", { r: hl.vb, al: hl.al }, label);
}
function missingHero(id, cx, cy, hw, label) {
  var spec = { head: [cx / W, cy / H, hw / W] };
  var a = assetOf(id);
  if (a && !a.cut) { drawPhoto(id, [cx - hw * 1.8, cy - hw * 0.9, hw * 3.6, hw * 4.6], { label: label, fy: 0.25 }); return; }
  phFighter(spec, label); hitFighterGuess(id, spec, label);
}

def({
  id: "headline", name: "Headline", group: "Headlines", blurb: "A huge bright face, his last two rivals, one word",
  look: "carved", fighters: ["A"],
  slots: [{ id: "hero", kind: "cut", label: "Fighter", from: "A.body", need: "cut" },
          { id: "bg", kind: "photo", label: "Background photo", note: "an action photo; it turns into the theme color", opt: true },
          { id: "ins1", kind: "circle", label: "Top circle", note: "his last opponent", from: "A.opp0" },
          { id: "ins2", kind: "circle", label: "Lower circle", note: "the one before", from: "A.opp1" }],
  fields: [{ id: "kicker", label: "Small line", def: function (D) { return D.A ? upper(D.A.name) : "ISLAM MAKHACHEV"; } },
           { id: "word", label: "Big word", def: "LEGACY" }],
  draw: function () {
    var S = W / 1080, tall = H > W * 1.1, Hp = Math.floor(H / S * 0.82) * S;
    fillShade();
    drawPlateG({ slot: "bg", fallback: "arena", fy: 0.3 }, [0, 0, W, Hp], { seed: 1, focus: [120, 300 * (Hp / S) / 1107, 420] });
    plateHit("bg", [0, 0, W, Hp], "Background photo");
    var mg = g.createLinearGradient(0, 0, 0, Hp);
    for (var i = 0; i <= 12; i++) mg.addColorStop(i / 12, rgba(R.pal.shade, smooth(0.66, 1.0, i / 12)));
    g.fillStyle = mg; g.fillRect(0, 0, W, Hp);
    fxRadial(W * 0.24, H * 0.24, W * 0.95, H * 0.62, 0.30);
    var fw = (tall ? 0.41 : 0.35) * W, H0 = faceHero("hero", fw, 0.40 * W, (tall ? 0.215 : 0.16) * H), hl = null;
    if (H0) hl = heroLayer("hero", H0.a, H0.P, { rowsBelow: 4.4, ramp: true, seed: 4, label: "Fighter" });
    // a photo that is not cut out (yet) stays in the hero's column, under the circles, fading out
    // toward them, instead of a rectangle painted over the whole poster
    var hA = assetOf("hero"), photoHero = !!(hA && !hA.cut);
    if (photoHero) drawPhoto("hero", [0, 0, W * 0.66, Hp], { label: "Fighter (photo, not cut out)", fy: 0.2, keepX: [W * 0.66, W * 0.56] });
    // the gap between the head and the circles: dark out-of-focus space (a lit plate figure there
    // read as a ghost second head), then the plate clearance with its light cap
    fxSink(W * 0.667, H * (tall ? 0.348 : 0.36), W * 0.176, H * (tall ? 0.311 : 0.33), 0.92, 20, 0.65);
    if (hl) fxClear(hl.al, { capReach: 90 });
    var d1 = W * (tall ? 0.344 : 0.30), d2 = W * (tall ? 0.278 : 0.24);
    drawCircle("ins1", W * 0.8037, H * (tall ? 0.194 : 0.20), d1 / 2, { label: "Top circle", seed: 31 });
    drawCircle("ins2", W * 0.8444, H * (tall ? 0.456 : 0.47), d2 / 2, { label: "Lower circle", seed: 32 });
    if (hl) { fxHalo(hl.al, [9.0, 0.60, 0.9], [30.0, 0.32, 0.25]); g.drawImage(hl.c, 0, 0); heroHit("hero", hl, H0.P, "Fighter"); }
    else if (!photoHero) missingHero("hero", W * 0.40, H * 0.3, W * 0.3, "Drop a fighter");
    fxFade(H * 0.64, H * 0.90, 0.97, 1.35);
    fxGrain(11);
    var wb = dispWord(tx("word"), W / 2, H - H * 0.035, W - 52 * S, H * (tall ? 0.215 : 0.2), { fill: 0.05 });
    textHit("word", [wb[0], wb[1], wb[2], wb[3]]);
    var kb = kickerLine(tx("kicker"), W / 2, wb[1], 31, 24);
    textHit("kicker", kb);
  }
});

def({
  id: "pop", name: "Color pop", group: "Headlines", blurb: "Black and white fighter, his kit in color, an arrow",
  look: "pop", fighters: ["A", "B"],
  slots: [{ id: "hero", kind: "cut", label: "Fighter", from: "A.body", need: "cut" },
          { id: "bg", kind: "photo", label: "Background photo", note: "an action photo; it turns into the theme color", opt: true },
          { id: "inset", kind: "circle", label: "Circle", note: "who the arrow is about", from: "B.head" }],
  fields: [{ id: "word", label: "Big word", def: "NEXT?" }],
  draw: function () {
    var S = W / 1080, tall = H > W * 1.1, yk = H / W;
    drawPlateG({ slot: "bg", fallback: "crowd", fy: 0.3 }, [0, 0, W, H], { seed: 2, focus: [200, 520 * yk, 420] });
    plateHit("bg", [0, 0, W, H], "Background photo");
    fillShade(0.18);
    fxRadial(W * 0.40, H * 0.36, W * 0.85, H * 0.80, 0.50);
    var H0 = faceHero("hero", 0.15 * W, 0.62 * W, (tall ? 0.07 : 0.066) * H), hl = null;
    if (H0) hl = heroLayer("hero", H0.a, H0.P, { ramp: true, seed: 5, bodyRows: 2.4, melt: [0.76 * H, 0.84 * H] });
    if (hl) {
      fxClear(hl.al, { capReach: 90 });
      fxHalo(hl.al, [9.0, 0.60, 0.9], [36.0, 0.45, 0.35]);
      g.drawImage(hl.c, 0, 0); heroHit("hero", hl, H0.P, "Fighter");
    } else missingHero("hero", W * 0.62, H * 0.2, W * 0.2, "Drop a fighter");
    var d = 400 * S, icx = 245 * S, icy = (tall ? 290 : 250) * S;
    drawCircle("inset", icx, icy, d / 2, { label: "Circle", seed: 41, mode: "natural" });
    fxFade(H * 0.72, H * 0.94, 0.96, 1.2);
    fxGrain(9);
    // the arrow runs from under the circle to the fighter's hands (about 3.4 face heights down)
    var gx = H0 ? H0.P.fbc[0] + 0.02 * W : 0.66 * W, gy = H0 ? Math.min(0.74 * H, H0.P.fbc[1] + 3.4 * H0.P.fbc[3]) : 0.72 * H;
    gy = Math.max(icy + d * 0.9, gy);
    handArrow([icx + d * 0.10, icy + d * 0.55], [icx + d * 0.18, gy + 0.02 * H], [gx - 0.07 * W, gy], R.pal.a, 7.5, 28);
    var wb = dispWord(tx("word"), W / 2, H - H * 0.035, W * 0.80, H * 0.185, {});
    textHit("word", wb);
  }
});

def({
  id: "split", name: "Split", group: "Headlines", blurb: "Two fighters in black and white, a word over each",
  look: "gritty", fighters: ["A", "B"],
  slots: [{ id: "left", kind: "cut", label: "Left fighter", from: "A.body", need: "cut" },
          { id: "right", kind: "cut", label: "Right fighter", from: "B.body", need: "cut" },
          { id: "bg", kind: "photo", label: "Background photo", note: "shown on top, mirrored on the right", opt: true },
          { id: "inset", kind: "circle", label: "Circle", note: "another fighter from the card", from: "card.other" }],
  fields: [{ id: "wordL", label: "Left word", def: "CHAMP" }, { id: "wordR", label: "Right word", def: "NEXT?" },
           { id: "nameL", label: "Left name", def: function (D) { return lastOf(D.A, "VOLKANOVSKI"); } },
           { id: "nameR", label: "Right name", def: function (D) { return lastOf(D.B, "EVLOEV"); } }],
  draw: function () {
    // 4:5 (not in the approved set): the same heads a touch smaller and lower, the words lower
    var S = W / 1080, yk = H / W, tall = yk > 1.1, hwT = (tall ? 0.24 : 0.255) * W;
    fillShade();
    var ph = Math.round(660 * S * yk);
    drawPlateG({ slot: "bg", fallback: "crowd", fy: 0.2 }, [0, 0, W / 2, ph], { seed: 34, focus: [100, 100, 300] });
    drawPlateG({ slot: "bg", fallback: "crowd", flip: true, mirrorPan: true, fy: 0.3 }, [W / 2, 0, W / 2, ph], { seed: 35, focus: [440, 100, 300] });
    plateHit("bg", [0, 0, W, ph], "Background photo");
    fxFade(180 * S * yk, 700 * S * yk, 1.0, 0.9);
    var hs = [["left", 270 * S, "A", [560 * S, 532 * S]], ["right", 810 * S, "B", [520 * S, 548 * S]]], ls = [];
    hs.forEach(function (q) {
      var a = assetOf(q[0]), f = frameOf(q[0]);
      if (!a || !a.cut || !a.head) { ls.push(null); return; }
      var sc = hwT / a.head.w * Math.max(0.3, f.s), hcx = f.flip ? a.w - a.head.cx : a.head.cx;
      var P = { sc: sc, dx: q[1] - hcx * sc + f.x, dy: (tall ? 175 : 118) * S - a.head.top * sc + f.y, flip: !!f.flip, hx: q[1] + f.x, hy: 0, hw: a.head.w * sc };
      P.hy = P.dy + a.head.cy * sc;
      var hl = heroLayer(q[0], a, P, { seed: 44, bodyRows: 0.15, torsoCap: true, lookOpts: { p: [0.18, 0.45, 0.78, 0.92] }, keepX: q[3], ramp: true });
      ls.push(hl ? { hl: hl, P: P, id: q[0] } : null);
    });
    ls.forEach(function (L) { if (L) fxClear(L.hl.al); });
    fxHaze(270 * S, 360 * S * yk, 330 * S, 300 * S, R.pal.haze, 0.20);
    fxHaze(810 * S, 360 * S * yk, 330 * S, 300 * S, R.pal.haze, 0.20);
    if (ls[0] && ls[1]) fxGap(ls[0].hl.al, ls[1].hl.al);
    fxSplit(539.5 * S);
    ls.forEach(function (L, i) {
      if (!L) { missingHero(hs[i][0], hs[i][1], 250 * S * yk, 0.22 * W, i ? "Right fighter" : "Left fighter"); return; }
      fxHalo(L.hl.al, [8.0, 0.50, 0.9], [30.0, 0.40, 0.3]);
      g.drawImage(L.hl.c, 0, 0); heroHit(L.id, L.hl, L.P, i ? "Right fighter" : "Left fighter");
    });
    var wy = (tall ? 985 : 790) * S;
    fxFade(wy - 230 * S, wy + 90 * S, 0.80, 1.2);
    fxFade(wy + 70 * S, H, 0.85, 1.3);
    fxGrain(10);
    [["wordL", "nameL", 270], ["wordR", "nameR", 810]].forEach(function (q) {
      var wb = dispWord(tx(q[0]), q[2] * S, wy, 430 * S, 148 * S, {});
      textHit(q[0], wb);
      var nb = dispWord(tx(q[1]), q[2] * S, wy + 22 * S + 30 * S, 600 * S, 30 * S, { face: "cond7", track: 0.05, shadow: 0.95, color: "#FFFFFF" });
      textHit(q[1], nb);
    });
    drawCircle("inset", W / 2, (tall ? 1180 : 930) * S, 140 * S, { label: "Circle", seed: 51, mode: "natural", tone: 0.30 });
  }
});

// ---------- the vivid cards ----------
function cardList() { return (doc.cards || []).slice(0, 8); }
def({
  id: "cards", name: "Card grid", group: "Cards", blurb: "Four, six or eight fighters on bright cards",
  look: "vivid", vivid: true, fighters: [], cardsEditor: true,
  fields: [{ id: "title", label: "Title", def: "MAIN CARD" },
           { id: "pill", label: "Pill", def: function (D) { return D.ev ? upper(D.ev.title) : "YOU DECIDE"; } }],
  draw: function () {
    var n = doc.cardsN === 4 || doc.cardsN === 8 ? doc.cardsN : 6, th = vividTheme(doc.theme), dark = doc.ground === "dark";
    var G0 = vividGeom("v1", W, H, n), list = cardList(), tiles = [];
    for (var i = 0; i < n; i++) {
      var it = list[i] || {}, a = it.a && assets[it.a] ? assets[it.a] : null, nm = splitName(it.name || "");
      var res = a ? cardRes(a, "head", G0.card.w, G0.card.h, G0.card.headFrac, G0.card.topFrac, null, "card" + i, { label: "Card " + (i + 1) }) : null;
      var e = expoOf("card:" + i);
      tiles.push({ subj: res ? expoFloat(res.img, e) : null, crop: res ? res.crop : null, key: res ? res.key + "|e" + e.toFixed(2) : "",
                   first: nm.first, last: nm.last });
    }
    var G = drawVividV1(g, W, H, th, dark, { n: n, title: plain(tx("title")), pill: plain(tx("pill")), tiles: tiles });
    G.slots.forEach(function (sl, j) {
      hit("card:" + j, "card", { r: [sl.card[0], sl.card[1], sl.card[2], sl.plate[1] + sl.plate[3] - sl.card[1]] }, "Card " + (j + 1));
      if (R.editor && !tiles[j].subj && !(list[j] && list[j].a)) {
        g.save(); g.fillStyle = "rgba(0,0,0,.18)";
        g.beginPath(); g.arc(sl.card[0] + sl.card[2] / 2, sl.card[1] + sl.card[3] * 0.34, sl.card[2] * 0.16, 0, Math.PI * 2); g.fill();
        g.restore();
      }
    });
    if (G.titleBox) textHit("title", G.titleBox);
    if (G.pillBox) textHit("pill", G.pillBox);
  }
});
def({
  id: "titlecards", name: "Title cards", group: "Cards", blurb: "The bout: two cards, heads breaking out, VS",
  look: "vivid", vivid: true, fighters: ["A", "B"],
  slots: [{ id: "left", kind: "card", label: "Left fighter", from: "A.body", need: "cut" },
          { id: "right", kind: "card", label: "Right fighter", from: "B.body", need: "cut" }],
  fields: [{ id: "pill", label: "Pill", def: function (D) { return D.ev ? upper(D.ev.title) : "UFC 333"; } },
           { id: "title", label: "Title", def: function (D) { return D.bout && /title/i.test(D.bout.cls || "") ? "TITLE FIGHT" : D.bout ? "MAIN EVENT" : "TITLE FIGHT"; } },
           { id: "label", label: "Weight class line", def: function (D) { return boutClass(D) || "FEATHERWEIGHT CHAMPIONSHIP"; } },
           { id: "nameL", label: "Left name", def: function (D) { return D.A ? D.A.name : "Alexander Volkanovski"; } },
           { id: "nameR", label: "Right name", def: function (D) { return D.B ? D.B.name : "Movsar Evloev"; } }],
  draw: function () {
    var th = vividTheme(doc.theme), dark = doc.ground === "dark", G0 = vividGeom("v2", W, H), cd = G0.card, fs = [];
    ["left", "right"].forEach(function (id, i) {
      var a = assetOf(id), res = a && a.cut ? cardRes(a, "body", cd.w, cd.h + cd.pop, cd.headFrac, 2 / (cd.h + cd.pop), cd.below, id, { label: i ? "Right fighter" : "Left fighter" }) : null;
      var nm = splitName(tx(i ? "nameR" : "nameL")), e = expoOf(id), img = res ? expoFloat(res.img, e) : null;
      var lc = null;
      if (img) {
        var lk = res.key + "|e" + e.toFixed(2);
        lc = layerCanvasCache[lk] || (layerCanvasCache[lk] = vcCanvas(img, null));
      }
      fs.push({ layer: img, layerCanvas: lc, crop: res ? res.crop : null, key: res ? res.key + "|e" + e.toFixed(2) : "", first: nm.first, last: nm.last });
    });
    var G = drawVividV2(g, W, H, th, dark, { pill: plain(tx("pill")), title: plain(tx("title")), label: upper(plain(tx("label"))), fighters: fs });
    G.slots.forEach(function (sl, j) {
      var id = j ? "right" : "left";
      var a2 = assetOf(id), lab = j ? "Right fighter" : "Left fighter";
      hit(id, "card", { r: [sl.card[0], sl.card[1] - cd.pop, sl.card[2], sl.card[3] + cd.pop] }, a2 && !a2.cut ? lab + " (photo, not cut out)" : lab);
      if (a2 && !a2.cut) {
        // a photo that is not cut out (yet): shown graded inside the card, never invisible; in the
        // editor it says whether the cut-out is running or needs the Cut out button
        // (above the name plate, which overlaps the card's foot)
        tileImage(a2, [sl.card[0], sl.card[1], sl.card[2], Math.max(8, sl.plate[1] - sl.card[1])], { expoId: id, label: lab });
        if (R.editor) {
          var msg = cutBusy[a2.key] ? "CUTTING OUT..." : "NOT CUT OUT: USE CUT OUT", fz = Math.round(sl.card[2] * 0.06);
          g.save(); g.fillStyle = "rgba(0,0,0,.62)"; g.fillRect(sl.card[0], sl.card[1], sl.card[2], fz * 2.4);
          g.fillStyle = "#FFFFFF"; g.font = "700 " + fz + "px Poppins, sans-serif"; g.textAlign = "center"; g.textBaseline = "middle";
          g.fillText(msg, sl.card[0] + sl.card[2] / 2, sl.card[1] + fz * 1.2, sl.card[2] * 0.92);
          g.restore();
        }
      } else if (!fs[j].layer && R.editor) {
        g.save(); g.fillStyle = "rgba(0,0,0,.18)";
        g.beginPath(); g.arc(sl.card[0] + sl.card[2] / 2, sl.card[1] + sl.card[3] * 0.3, sl.card[2] * 0.14, 0, Math.PI * 2); g.fill();
        g.restore();
      }
      textHit(j ? "nameR" : "nameL", sl.plate);
    });
    // an uncut photo is drawn over its card: the VS badge goes back on top of it
    if (["left", "right"].some(function (id) { var a3 = assetOf(id); return a3 && !a3.cut; })) drawVsBadge(g, G.vs.x, G.vs.y, G.vs.d, th, { s: G.s, dark: dark });
    if (G.titleBox) textHit("title", G.titleBox);
    if (G.pillBox) textHit("pill", G.pillBox);
    textHit("label", [W * 0.2, G.label.y, W * 0.6, G.label.size * 1.2]);
  }
});
var layerCanvasCache = {};
setInterval(function () { var ks = Object.keys(layerCanvasCache); if (ks.length > 24) ks.slice(0, ks.length - 24).forEach(function (k) { delete layerCanvasCache[k]; }); }, 5000);
def({
  id: "photocard", name: "Photo card", group: "Cards", blurb: "One news photo in a bright card, a quote under it",
  look: "vivid", vivid: true, fighters: ["A"], mustEdit: ["title", "quote"],
  slots: [{ id: "photo", kind: "photo", label: "Photo", from: "A.body", need: "mask", note: "a news photo; it is cut out once to grade the face" }],
  fields: [{ id: "pill", label: "Pill", def: function (D) { return D.A && D.A.division ? upper(D.A.division.split(" Division").join("")) : "BANTAMWEIGHT"; } },
           { id: "title", label: "Title", plain: true, def: function (D) { return D.A ? "YOUR HEADLINE" : "NOT IMPRESSED"; } },
           { id: "first", label: "First name", def: function (D) { return D.A ? D.A.first : "Petr"; } },
           { id: "last", label: "Surname", def: function (D) { return D.A ? D.A.last : "Yan"; } },
           { id: "quote", label: "Quote line", plain: true, def: function (D) { return LQ + (D.A ? "ADD A QUOTE" : "NOTHING REALLY IMPRESSES ME") + RQ; } }],
  draw: function () {
    var th = vividTheme(doc.theme), dark = doc.ground === "dark", G0 = vividGeom("v3", W, H), a = assetOf("photo"), ph = null;
    if (a) {
      var cutA = a.cut ? null : cutOf(a);
      var res = a.cut ? null : photoCardRes("photo", a, cutA, G0.photo.w, G0.photo.h);
      if (a.cut) {
        // a cut-out dropped here: shown on the card's own dark studio sweep, vivid-graded
        var rect = [G0.card[0] + 6 * G0.s, G0.card[1] + 6 * G0.s, G0.photo.w, G0.photo.h];
        ph = cutOnCard(a, rect);
      } else if (res) {
        var e = expoOf("photo");
        ph = res.preview || Math.abs(e) <= 0.005 ? res.c : withExpo(res, e, res.key);
      }
    }
    var G = drawVividV3(g, W, H, th, dark, { pill: plain(tx("pill")), title: plain(tx("title")), first: plain(tx("first")), last: plain(tx("last")),
                                           quote: upper(plain(tx("quote"))), photo: ph });
    hit("photo", "photo", { r: G.card }, "Photo");
    if (a && !a.cut) coverPlace("photo", a, G.card, { fy: 0.3 });
    if (!a) phPhoto([G.card[0] + 6, G.card[1] + 6, G.card[2] - 12, G.card[3] - 12], "Drop a news photo");
    if (G.titleBox) textHit("title", G.titleBox);
    if (G.pillBox) textHit("pill", G.pillBox);
    textHit("first", G.plate); textHit("quote", [W * 0.1, G.quote.y, W * 0.8, G.quote.size * 1.2]);
  }
});
// a cut-out on the photo card: the vivid grade of the cut on a dark neutral sweep. A full-body master
// is cropped to the chest first (the V2 chest crop) and framed by its head so the head fills about
// 45 % of the card width: the approved V3 is a tight head-and-shoulders portrait, and the whole
// master left a tiny figure in an empty card.
function cutOnCard(a, rect) {
  var k = W / 1080, res = cardRes(a, "body", Math.round(rect[2] / k), Math.round(rect[3] / k), 0.45, 0.07, 2.6, "photo", { cap: 2400, label: "Photo" });
  var c = mkCanvas(rect[2], rect[3]), x = c.getContext("2d"), gr = x.createRadialGradient(rect[2] / 2, rect[3] * 0.32, 0, rect[2] / 2, rect[3] * 0.4, rect[2] * 0.75);
  gr.addColorStop(0, "#3A383E"); gr.addColorStop(1, "#0C0B0E");
  x.fillStyle = gr; x.fillRect(0, 0, rect[2], rect[3]);
  if (res) {
    var e = expoOf("photo"), lk = res.key + "|e" + e.toFixed(2);
    var lc = layerCanvasCache[lk] || (layerCanvasCache[lk] = vcCanvas(expoFloat(res.img, e), null));
    x.drawImage(lc, 0, 0, rect[2], rect[3]);
  }
  return c;
}

// ---------- the document ----------
// v2 (Sept 25 2026, the approved looks): lookBy (the owner's look per template, else the
// template's own), ground (light / dark, the card templates), cardsN + cards (the card grid),
// fx.expo (the exposure nudge) and fx.rim = 0 (the painted edge light is OFF by default). A v1
// doc is migrated: its looks are retired, the edge light switched off, the retired blue "ice"
// and "mono" themes open in ember.
var DOC_KEY = "posters.doc.v2";
function freshDoc() {
  return { v: 2, tpl: "headline", size: "1x1", theme: "ember", lookBy: {}, ground: "light", cardsN: 6, hotStyle: "color",
           fx: { glow: 0.4, rim: 0, shade: 0.35, fade: 1, grain: 1, vig: 1, expo: 0 },
           slots: {}, frames: {}, text: {}, tiles: [], tilesAuto: true, bouts: [], rows: null, form: null,
           cards: [], cardsAuto: true, people: { A: null, B: null }, ev: null, bout: null, meta: {} };
}
function mergeDoc(d) {
  var f = freshDoc();
  if (!d || typeof d !== "object" || (d.v !== 1 && d.v !== 2)) return f;
  for (var k in f) if (k !== "v" && Object.prototype.hasOwnProperty.call(d, k) && d[k] != null) f[k] = d[k];
  var fx = freshDoc().fx;
  if (typeof f.fx !== "object" || !f.fx) f.fx = {};
  for (var q in fx) if (typeof f.fx[q] !== "number") f.fx[q] = fx[q];
  if (d.v === 1) {
    // the v1 looks darkened (retired); its edge light defaulted ON and its glows and shading full
    f.fx.rim = 0;
    if (f.fx.glow === 1) f.fx.glow = fx.glow;
    if (f.fx.shade === 1) f.fx.shade = fx.shade;
    if (f.fx.grain === 0.6) f.fx.grain = fx.grain;
    f.lookBy = {};
  }
  if (THEME_IDS.indexOf(f.theme) === -1) f.theme = "ember";
  if (!TPL[f.tpl]) f.tpl = "headline";
  // slots and frames were kept by bare slot id (shared by every template) until Sept 25 2026: they
  // move to the template that was open, the only one they were placed on by hand
  ["slots", "frames"].forEach(function (nm) {
    var src = f[nm], out = {};
    if (!src || typeof src !== "object" || Array.isArray(src)) { f[nm] = {}; return; }
    Object.keys(src).forEach(function (k) {
      var i = k.indexOf(":"), scoped = i > 0 && !!TPL[k.slice(0, i)];
      out[scoped ? k : f.tpl + ":" + k] = src[k];
    });
    f[nm] = out;
  });
  if (typeof f.lookBy !== "object" || !f.lookBy) f.lookBy = {};
  if (f.ground !== "dark") f.ground = "light";
  if (f.cardsN !== 4 && f.cardsN !== 8) f.cardsN = 6;
  if (!Array.isArray(f.tiles)) f.tiles = [];
  if (!Array.isArray(f.bouts)) f.bouts = [];
  if (!Array.isArray(f.cards)) f.cards = [];
  return f;
}
function slotDef(t, id) { var ss = (t && t.slots) || []; for (var i = 0; i < ss.length; i++) if (ss[i].id === id) return ss[i]; return null; }
// explicit drop first, then the template's data source: "A.body" (fighter A's cut-out), "B.head",
// "A.opp0" / "A.opp1" (his last two opponents' headshots), "card.other" (someone else on the card)
assetOf = function (id) {
  var k = slotKey(id);
  if (k && assets[k]) return assets[k];
  var s = slotDef(TPL[scopeTpl()], id);
  if (s && s.from && k !== "") return sourceAsset(s.from);
  return null;
};
// "Women's Flyweight Title Bout" / "Women's Flyweight Division" -> "women's flyweight"
function weightOf(cls) {
  var w = String(cls || "").toLowerCase().split(" ").filter(function (x) {
    return x && ["title", "bout", "interim", "championship", "division", "ufc"].indexOf(x) === -1;
  }).join(" ").trim();
  return w;
}
function sourceAsset(from) {
  var pr = from.split("."), kk = null;
  if (pr[0] === "card") {
    // someone else on the card from the SAME weight class (the women's flyweight title poster must
    // not get a bantamweight); nobody in that class leaves the circle empty with its placeholder
    var A = doc.people.A, B = doc.people.B, names = [A && A.name, B && B.name].map(function (n) { return slugify(n || ""); });
    var slugs = [A && A.slug, B && B.slug].filter(Boolean);
    var want = weightOf(doc.bout && doc.bout.cls) || weightOf(A && A.division);
    for (var i = 0; i < doc.bouts.length && !kk; i++) {
      if (!want || weightOf(doc.bouts[i].cls) !== want) continue;
      ["l", "r"].forEach(function (sd) {
        var c = doc.bouts[i][sd];
        // the two fighters on the poster are never the circle (by slug: a name may be listed either way round)
        var same = c && ((c.slug && slugs.indexOf(c.slug) !== -1) || names.indexOf(slugify(c.name || "")) !== -1);
        if (!kk && c && c.a && assets[c.a] && !same) kk = c.a;
      });
    }
  } else {
    var P = doc.people[pr[0]];
    if (P && pr[1].indexOf("opp") === 0) kk = P.opps ? P.opps[Number(pr[1].slice(3)) || 0] : null;
    else kk = P && P[pr[1]];
  }
  return kk && assets[kk] ? assets[kk] : null;
}
function txFor(t, id) {
  var o = doc.text[t.id];
  if (o && o[id] != null) return o[id];
  var f = fieldOf(t, id);
  return f ? fieldDefault(t, f) : "";
}
// the cut-out made from a photo (the cut-out button or an automatic one), if it is loaded
function cutOf(a) { var m = doc.meta[a.key], k = m && m.cut; return k && assets[k] ? assets[k] : null; }

// ---------- rendering ----------
var rafId = 0, thumbDirty = true, lastR = null;
function requestRender(thumbs) {
  if (thumbs) thumbDirty = true;
  if (!rafId) rafId = requestAnimationFrame(renderNow);
}
var mainG = g;
function dropCaches() { heroCache = {}; finishCache = {}; fxDrop(); }
function applySize() {
  var h = doc.size === "4x5" ? 1350 : 1080;
  if (cv.width !== 1080 || cv.height !== h) { cv.width = 1080; cv.height = h; dropCaches(); }
  document.documentElement.style.setProperty("--ar", String(1080 / h));
}
function lightsFor(t) {
  var ls = (t.lights || []).map(function (L) { return { x: L.x, y: L.y, r: L.r, k: L.k, c: L.c }; });
  return ls;
}
// o: editor (placeholders + hits), thumb (gallery size: fast grades, low priority), exact (an
// export: exact grades only; whatever is not ready yet is listed in R.pending)
function renderTo(ctx, t, o) {
  var prev = g;
  g = ctx;
  R = { tpl: t, pal: themeById(doc.theme), lights: lightsFor(t), hits: [], place: {}, editor: !!o.editor, thumb: !!o.thumb,
        exact: !!o.exact, fast: !o.exact && !o.thumb && !!dragging, deps: [], pending: [], failed: [], failedLabels: [], grained: false,
        capK: o.capK || 1, error: "",
        tag: (o.thumb ? "th:" : o.exact ? "ex:" : "") + t.id };
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = "source-over";
  ctx.shadowColor = "transparent"; ctx.clearRect(0, 0, W, H); ctx.filter = "none";
  var sc0 = scopeId;
  scopeId = t.id;
  if (o.editor && !o.exact && !o.thumb && fxOn && CTX2D) {
    R.fxc = true;
    R.sig = sigMix(2166136261, docSig() + "|" + W + "x" + H + "|" + fxEpoch + "|" + t.id);
    hookCtx(ctx);
  }
  try { t.draw(); }
  catch (e) {
    R.error = String((e && e.message) || e);
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = "#300"; ctx.fillRect(0, 0, W, 40); ctx.fillStyle = "#fff"; ctx.font = "16px sans-serif";
    ctx.fillText("render error: " + (e && e.message), 10, 26);
    if (window.console) console.error(e);
  }
  scopeId = sc0;
  if (R.fxc) unhookCtx(ctx);
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = "source-over"; ctx.shadowColor = "transparent"; ctx.filter = "none";
  grainPass();
  var out = R;
  g = prev;
  return out;
}
function renderNow() {
  rafId = 0;
  applySize();
  W = 1080; H = cv.height;
  var t = TPL[doc.tpl] || TPLS[0];
  lastR = renderTo(mainG, t, { editor: true });
  drawOverlay();
  updateGradeNote();
  if (thumbDirty) scheduleThumbs();
}
// thumbnails render the SAME templates at 1/5 size (every size in a template is a fraction
// of W and H, so shrinking W/H shrinks the design), one per idle slot. A thumbnail asks for the
// FAST grades at the lowest priority and is redrawn when one of them lands.
var thumbQ = [], thumbT = 0;
function scheduleThumbs() {
  thumbDirty = false;
  clearTimeout(thumbT);
  thumbT = setTimeout(function () {
    thumbQ = TPLS.map(function (t) { return t.id; });
    var cur = thumbQ.indexOf(doc.tpl);
    if (cur > 0) { thumbQ.splice(cur, 1); thumbQ.unshift(doc.tpl); }
    pumpThumbs();
  }, 450);
}
var thumbAgain = {}, thumbAgainT = 0;
function queueThumbs(ids) {
  ids.forEach(function (id) { thumbAgain[id] = 1; });
  clearTimeout(thumbAgainT);
  thumbAgainT = setTimeout(function () {
    var ks = Object.keys(thumbAgain);
    thumbAgain = {};
    ks.forEach(function (id) { if (thumbQ.indexOf(id) === -1) thumbQ.push(id); });
    pumpThumbs();
  }, 250);
}
var pumping = false;
function pumpThumbs() {
  if (pumping) return;
  if (!thumbQ.length || dragging) return;
  var id = thumbQ.shift(), c = document.querySelector('canvas[data-thumb="' + id + '"]');
  if (c) {
    var sw = W, sh = H, sR = R;
    W = 216; H = Math.round(216 * cv.height / 1080);
    if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
    var out = renderTo(c.getContext("2d"), TPL[id], { editor: false, thumb: true });
    thumbDeps[id] = out.deps;
    W = sw; H = sh; R = sR;
  }
  pumping = true;
  setTimeout(function () { pumping = false; pumpThumbs(); }, 16);
}
// the grading status under the poster
function updateGradeNote() {
  var el0 = $("gradeNote");
  if (!el0) return;
  if (exportMsg) { el0.textContent = exportMsg; el0.hidden = false; return; }
  var n = 0, fast = false, parts = [];
  if (lastR) lastR.deps.forEach(function (k) { var e = JOBS[k]; if (e && e.st === "pend") { n++; if (/[|]f$/.test(k)) fast = true; } });
  if (cutN) parts.push(cutN > 1 ? "Cutting out " + cutN + " photos..." : "Cutting out the photo...");
  if (n) parts.push(fast ? "Grading (a quick preview first)..." : "Finishing the full-quality grade...");
  el0.textContent = parts.join(" ");
  el0.hidden = !parts.length;
}
// ---------- history + autosave ----------
var hist = [], hix = -1, histT = 0, saveT = 0;
function snap() { return JSON.stringify(doc); }
// the history snapshot NOW (not after the 280 ms debounce): a photo about to be cut out must be
// its own undo step even when the cut-out comes back from the cache within the debounce
function commitNow() {
  clearTimeout(histT);
  var s = snap();
  if (hist[hix] !== s) {
    hist = hist.slice(0, hix + 1);
    hist.push(s);
    if (hist.length > 60) hist.shift();
    hix = hist.length - 1;
    updateUndo();
  }
  clearTimeout(saveT);
  saveT = setTimeout(save, 600);
}
function commit() {
  editT = Date.now();
  clearTimeout(histT);
  histT = setTimeout(function () {
    var s = snap();
    if (hist[hix] === s) return;
    hist = hist.slice(0, hix + 1);
    hist.push(s);
    if (hist.length > 60) hist.shift();
    hix = hist.length - 1;
    updateUndo();
  }, 280);
  clearTimeout(saveT);
  saveT = setTimeout(save, 600);
  requestRender(true);
}
function save() { gcAssets(); lsSet(DOC_KEY, JSON.stringify(doc)); }
function updateUndo() { $("undoBtn").disabled = hix <= 0; $("redoBtn").disabled = hix >= hist.length - 1; }
function restoreSnap(s) {
  doc = mergeDoc(JSON.parse(s));
  dropCaches();
  restoreAssets().then(function () { requestRender(true); refreshInspector(); });
  buildInspector();
  markGallery();
  requestRender(true);
  clearTimeout(saveT); saveT = setTimeout(save, 600);
  updateUndo();
}
function undo() { if (hix > 0) { hix--; restoreSnap(hist[hix]); } }
function redo() { if (hix < hist.length - 1) { hix++; restoreSnap(hist[hix]); } }
function usedKeys() {
  var u = {}, k;
  for (k in doc.slots) if (doc.slots[k]) u[doc.slots[k]] = 1;
  doc.tiles.forEach(function (t) { if (t && t.a) u[t.a] = 1; });
  doc.cards.forEach(function (t) { if (t && t.a) u[t.a] = 1; });
  doc.bouts.forEach(function (b) { if (b && b.l && b.l.a) u[b.l.a] = 1; if (b && b.r && b.r.a) u[b.r.a] = 1; });
  ["A", "B"].forEach(function (w) {
    var P = doc.people[w];
    if (P) { if (P.body) u[P.body] = 1; if (P.head) u[P.head] = 1; (P.opps || []).forEach(function (o) { if (o) u[o] = 1; }); }
  });
  // a photo in use keeps the cut-out made from it
  Object.keys(u).forEach(function (q) { var m = doc.meta[q]; if (m && m.cut) u[m.cut] = 1; });
  return u;
}
function gcAssets() {
  var u = usedKeys(), keys = Object.keys(doc.meta);
  if (keys.length < 30) return;
  hist.forEach(function (s) { var m = s.match(/"a[0-9a-z]{6,14}"/g); if (m) m.forEach(function (x) { u[x.slice(1, -1)] = 1; }); });
  // a cut-out's bytes live in the shared "cut:<hash>" store (idb is that key): they stay, so the
  // same photo dropped again never spends another cut-out
  keys.forEach(function (k) { if (!u[k]) { if (doc.meta[k] && doc.meta[k].idb === 1) idbDel(k); delete doc.meta[k]; delete assets[k]; } });
}
function restoreAssets() {
  var jobs = [];
  Object.keys(doc.meta).forEach(function (k) {
    if (assets[k]) return;
    var m = doc.meta[k] || {};
    var store = m.idb === 1 ? k : typeof m.idb === "string" ? m.idb : null;
    var p = store ? idbGet(store).then(function (b) { if (!b) throw new Error("gone"); return b; }) : m.src ? fetchBlob(m.src) : Promise.reject(new Error("no source"));
    jobs.push(p.then(blobToImage).then(function (im) {
      makeAsset(im, { key: k, src: m.src, face: m.face, name: m.name, ufc: m.ufc });
      if (m.src) urlAsset[m.src] = k;
    }).catch(function () { }));
  });
  return Promise.all(jobs);
}

// ---------- loading images ----------
var urlAsset = {};
function assetFromUrl(src, meta, big) {
  var k0 = urlAsset[src];
  if (k0 && assets[k0]) return Promise.resolve(assets[k0]);
  return fetchBlob(src).then(blobToImage).then(function (im) {
    var a = makeAsset(im, { src: src, face: meta && meta.face, name: meta && meta.name, ufc: meta && meta.ufc });
    urlAsset[src] = a.key;
    doc.meta[a.key] = { src: src, face: a.face, name: a.name, ufc: a.ufc || undefined };
    if (big && big !== src) upgradeAsset(a.key, big);
    return a;
  });
}
// swap a quick small copy for the full-resolution master under the SAME key, so every slot,
// tile and frame that points at it upgrades in place (a.ver moves on, so its grades are redone)
function upgradeAsset(key, big) {
  if (upgrading[key]) return upgrading[key];
  var p = upgrading[key] = fetchBlob(big).then(blobToImage).then(function (im) {
    var old = assets[key];
    if (!old) return;
    makeAsset(im, { key: key, src: big, face: old.face, name: old.name, ufc: old.ufc });
    urlAsset[big] = key;
    doc.meta[key] = { src: big, face: old.face, name: old.name, ufc: old.ufc || undefined };
    dropCaches();
    requestRender(true);
    clearTimeout(saveT); saveT = setTimeout(save, 600);
  }).catch(function () { }).then(function () { delete upgrading[key]; });
  return p;
}
function assetFromFile(file) {
  return blobToImage(file).then(function (im) {
    var a = makeAsset(im, { name: file.name || "photo" });
    doc.meta[a.key] = { idb: 1, name: a.name };
    idbPut(a.key, file);
    return a;
  });
}

// ---------- cut-outs of the owner's own photos (POST /studio/api/cutout) ----------
// The Worker cuts the subject out with Cloudflare's segmentation (about 3.5 s; 100 a day, 30 an
// hour). A result is kept in IndexedDB under "cut:" + the SHA-256 of the photo's bytes, so the
// same photo - dropped again, reloaded, on any template - never spends a second cut-out. The
// photo stays on the poster while it works; on success the slot swaps to the cut-out (one undo
// step brings the photo back), on failure the photo stays and the toast says why.
var CUT_MAX = 10 * 1024 * 1024;
var cutBusy = {};
function cutMessage(status, j) {
  var m = j && typeof j.error === "string" ? j.error : "";
  if (status === 413) return "That photo is over 10 MB, too big to cut out.";
  if (status === 415) return "Only JPEG, PNG, WebP or AVIF photos can be cut out.";
  if (status === 429) return m || "The cut-out limit is reached for now. Try again later.";
  if (status === 503) return m && m !== "cutout not configured" ? m : "Background removal is not switched on for the studio yet.";
  if (status === 502) return m || "Cloudflare could not cut this photo out. Try another photo.";
  return m || ("The cut-out failed (HTTP " + status + ").");
}
function hexOf(buf) { var b = new Uint8Array(buf), s = ""; for (var i = 0; i < b.length; i++) s += (b[i] < 16 ? "0" : "") + b[i].toString(16); return s; }
function sourceBlobOf(a) {
  var m = doc.meta[a.key] || {};
  if (m.idb === 1) return idbGet(a.key).then(function (b) { if (!b) throw new Error("The photo is gone from this browser. Drop it again."); return b; });
  if (m.src) return fetchBlob(m.src);
  return Promise.reject(new Error("This image cannot be cut out here."));
}
// a photo over the Worker's 10 MB cap, or in a format it refuses, is re-encoded as a JPEG
function cutBytes(blob, a) {
  var ok = /^image[/](jpeg|png|webp|avif)$/.test(blob.type || "");
  if (ok && blob.size <= CUT_MAX) return Promise.resolve(blob);
  var s = Math.min(1, 3000 / Math.max(a.nw, a.nh)), c = mkCanvas(a.nw * s, a.nh * s);
  c.getContext("2d").drawImage(a.im, 0, 0, c.width, c.height);
  return new Promise(function (res) { c.toBlob(res, "image/jpeg", 0.92); }).then(function (b) {
    if (!b) throw new Error("The photo could not be prepared for the cut-out.");
    return b;
  });
}
function cutRequest(blob) {
  return fetch("/studio/api/cutout", { method: "POST", credentials: "same-origin", body: blob,
                                       headers: { "content-type": blob.type || "application/octet-stream" } }).then(function (r) {
    if (r.status === 401) { location.reload(); throw new Error("signed out"); }
    if (r.ok && /^image[/]png/.test(r.headers.get("content-type") || "")) return r.blob();
    return r.json().catch(function () { return {}; }).then(function (j) { throw new Error(cutMessage(r.status, j)); });
  });
}
// The cut-out store keeps an index of its entries with the time each was last used (localStorage):
// past CUT_KEEP entries the oldest ones no photo in the doc still points at are deleted, so the
// store cannot grow until the browser evicts the whole origin (and the dropped photos with it).
var CUT_INDEX_KEY = "posters.cuts.v1", CUT_KEEP = 150;
function cutIndex() {
  try { var v = JSON.parse(lsGet(CUT_INDEX_KEY) || "{}"); return v && typeof v === "object" && !Array.isArray(v) ? v : {}; }
  catch (e) { return {}; }
}
function touchCut(hash) { var ix = cutIndex(); ix[hash] = Date.now(); lsSet(CUT_INDEX_KEY, JSON.stringify(ix)); }
function forgetCut(hash) { idbDel(hash); var ix = cutIndex(); delete ix[hash]; lsSet(CUT_INDEX_KEY, JSON.stringify(ix)); }
// cut-outs cached before the index existed are adopted into it (as the oldest), so they age out too
function adoptCuts() {
  idbDo("readonly", function (st) { return st.getAllKeys ? st.getAllKeys() : null; }).then(function (ks) {
    if (!ks || !ks.length) return;
    var ix = cutIndex(), n = 0;
    ks.forEach(function (k) { if (typeof k === "string" && k.indexOf("cut:") === 0 && !ix[k]) { ix[k] = 1; n++; } });
    if (n) lsSet(CUT_INDEX_KEY, JSON.stringify(ix));
    gcCuts();
  });
}
function gcCuts() {
  var ix = cutIndex(), ks = Object.keys(ix);
  if (ks.length <= CUT_KEEP) return;
  var live = {};
  Object.keys(doc.meta).forEach(function (k) { var m = doc.meta[k]; if (m && typeof m.idb === "string") live[m.idb] = 1; });
  ks.sort(function (p, q) { return ix[p] - ix[q]; });
  for (var i = 0; i < ks.length - CUT_KEEP; i++) if (!live[ks[i]]) { idbDel(ks[i]); delete ix[ks[i]]; }
  lsSet(CUT_INDEX_KEY, JSON.stringify(ix));
}
// a cut-out result is USABLE when it holds a clear subject: a head the analyser can place and an
// alpha coverage between 1 % and 97 % of the image. Only a usable result is cached and linked, so
// an empty matte can never stick to a photo for good.
function cutUsable(c) { return !!(c && c.cut && c.head && c.cover > 0.01 && c.cover < 0.97); }
// cut the asset out; resolves to the cut-out asset (cached, or fresh from the Worker)
function cutAsset(a) {
  var have = cutOf(a);
  if (have) return Promise.resolve(have);
  if (cutBusy[a.key]) return cutBusy[a.key];
  var hash = "";
  function decodeCut(png) {
    return blobToImage(png).then(function (im) {
      var c = makeAsset(im, { name: (a.name || "photo") + " (cut-out)" });
      if (!cutUsable(c)) { delete assets[c.key]; return null; }
      return c;
    });
  }
  var p = sourceBlobOf(a).then(function (b) { return cutBytes(b, a); }).then(function (b) {
    return b.arrayBuffer().then(function (buf) {
      return (window.crypto && crypto.subtle ? crypto.subtle.digest("SHA-256", buf).then(hexOf) : Promise.resolve(a.key)).then(function (h) {
        hash = "cut:" + String(h).slice(0, 40);
        function fresh() {
          return cutRequest(b).then(function (png) {
            return decodeCut(png).then(function (c) {
              if (!c) throw new Error("Cloudflare found no clear subject in this photo.");
              idbPut(hash, png);
              return c;
            });
          });
        }
        return idbGet(hash).then(function (cached) {
          if (!cached) return fresh();
          // a cached result that no longer passes is dropped and cut again
          return decodeCut(cached).then(function (c) { if (c) return c; forgetCut(hash); return fresh(); });
        });
      });
    });
  }).then(function (c) {
    doc.meta[c.key] = { idb: hash, name: c.name };
    doc.meta[a.key] = Object.assign({}, doc.meta[a.key] || {}, { cut: c.key });
    touchCut(hash); gcCuts();
    delete cutBusy[a.key];
    return c;
  }, function (e) { delete cutBusy[a.key]; throw e; });
  cutBusy[a.key] = p;
  return p;
}
// Recut: the photo's cut-out is forgotten (cache and link) and the photo cut out again; the slot
// shows the photo meanwhile. For a result that came out wrong.
function recut(t, s) {
  var a = slotAsset(t, s.id), photoKey = null, cutKey = null;
  if (!a) return;
  if (s.need === "mask") { var c0 = cutOf(a); if (!c0) return; photoKey = a.key; cutKey = c0.key; }
  else {
    cutKey = a.key;
    Object.keys(doc.meta).forEach(function (k) { if (doc.meta[k] && doc.meta[k].cut === cutKey) photoKey = k; });
  }
  if (!photoKey || !assets[photoKey]) { toast("The original photo is gone from this browser. Drop it again to cut it out."); return; }
  var hash = doc.meta[cutKey] && doc.meta[cutKey].idb;
  if (typeof hash === "string") forgetCut(hash);
  var m = Object.assign({}, doc.meta[photoKey] || {});
  delete m.cut; doc.meta[photoKey] = m;
  if (s.need !== "mask") setSlot(s.id, photoKey, t.id);
  dropCaches(); commitNow();
  cutInto({ id: s.id, kind: s.kind, tpl: t.id }, assets[photoKey], s.need);
}
// the slot (or card, tile) target t holds asset a: cut it out and swap it in if t still holds a.
// need "mask" keeps the photo and only remembers the cut-out (the photo card grades by it).
var cutN = 0;
function cutInto(t, a, need) {
  toast("Cutting out the photo (a few seconds)...");
  cutN++; updateGradeNote();
  var fin = false;
  function done() { if (fin) return; fin = true; cutN = Math.max(0, cutN - 1); updateGradeNote(); }
  return cutAsset(a).then(function (c) {
    done();
    if (need !== "mask") {
      if (t.kind === "tile") { var ti = doc.tiles[Number(t.id.split(":")[1])]; if (ti && ti.a === a.key) ti.a = c.key; }
      else if (t.kind === "card" && /^card:/.test(t.id)) { var ci = doc.cards[Number(t.id.split(":")[1])]; if (ci && ci.a === a.key) ci.a = c.key; }
      else if (t.kind === "bout") { var pr = t.id.split(":"), bb = doc.bouts[Number(pr[1])]; if (bb && bb[pr[2]] && bb[pr[2]].a === a.key) bb[pr[2]].a = c.key; }
      else if (slotKey(t.id, t.tpl) === a.key) { setSlot(t.id, c.key, t.tpl); delete doc.frames[sk(t.id, t.tpl)]; }
    }
    dropCaches(); commit(); refreshInspector();
    toast(need === "mask" ? "Cut out: the photo is graded around him now" : "Cut out: it snaps to the head now");
    return c;
  }).catch(function (e) {
    done();
    toast(String((e && e.message) || e) + " The photo stays as it was.");
    refreshInspector();
    return null;
  });
}
// ---------- UFC data ----------
function api(path) {
  return fetch(path, { credentials: "same-origin" }).then(function (r) {
    if (r.status === 401) { location.reload(); throw new Error("signed out"); }
    return r.json().catch(function () { return {}; }).then(function (j) {
      if (!r.ok) throw new Error((j && j.error) || ("HTTP " + r.status));
      return j;
    });
  });
}
var busyN = 0;
function busy(on) {
  busyN = Math.max(0, busyN + (on ? 1 : -1));
  document.body.style.cursor = busyN ? "progress" : "";
  var b = $("busyNote");
  if (b) b.hidden = !busyN;
}
function withBusy(p) { busy(true); return p.then(function (v) { busy(false); return v; }, function (e) { busy(false); throw e; }); }
function clearSlotsFrom(which) {
  TPLS.forEach(function (t) {
    (t.slots || []).forEach(function (s) {
      if (s.from && s.from.charAt(0) === which) delSlot(s.id, t.id);
    });
  });
}
function loadFighter(which, name, quiet) {
  var slug = slugify(name);
  if (!slug) return Promise.reject(new Error("type a name"));
  return withBusy(api("/studio/api/ufc/" + slug + "?n=15")).then(function (j) {
    var nm = splitName(j.name || name);
    var P = { slug: j.slug, name: j.name, first: nm.first, last: nm.last, nick: j.nickname || "", record: j.record || "",
              division: j.division || "", tags: j.tags || [], bio: j.bio || {}, method: j.method || {}, stats: j.stats || {},
              rates: j.rates || {}, fights: j.fights || [], face: j.face || "", body: null, head: null, opps: [] };
    var jobs = [];
    // his last two DIFFERENT opponents' headshots (the headline's two circles)
    var seenOpp = {}, opps = [];
    (j.fights || []).forEach(function (f) {
      var src = f.oppHead || f.oppHeadSmall;
      if (!src || opps.length >= 2 || seenOpp[f.oppSlug || f.opp]) return;
      seenOpp[f.oppSlug || f.opp] = 1; opps.push({ src: src, name: f.opp });
    });
    opps.forEach(function (o, i) {
      jobs.push(withBusy(assetFromUrl(o.src, { name: o.name })).then(function (a) { P.opps[i] = a.key; }).catch(function () { }));
    });
    if (j.bodySmall || j.body) {
      jobs.push(withBusy(assetFromUrl(j.bodySmall || j.body, { face: j.face, name: j.name }, j.body)).then(function (a) { P.body = a.key; }));
    }
    if (j.head) jobs.push(withBusy(assetFromUrl(j.head, { name: j.name })).then(function (a) { P.head = a.key; }).catch(function () { }));
    return Promise.all(jobs).then(function () {
      doc.people[which] = P;
      clearSlotsFrom(which);
      if (which === "A" && doc.tilesAuto) autoTiles();
      doc.rows = null; doc.form = null;
      dropCaches();
      if (!quiet) toast(P.name + " loaded" + (P.record ? " (" + P.record + ")" : ""));
      commit();
      refreshInspector();
      return P;
    });
  });
}
// resume tiles: the last opponents, most recent first, a rematch folded into "2X"
function autoTiles() {
  var P = doc.people.A;
  if (!P || !P.fights || !P.fights.length) return;
  var seen = {}, order = [];
  P.fights.forEach(function (f) {
    if (!f.oppSlug) return;
    if (seen[f.oppSlug]) { seen[f.oppSlug].n++; return; }
    seen[f.oppSlug] = { n: 1, f: f };
    order.push(f.oppSlug);
  });
  var n = Math.min(order.length, 10);
  doc.tiles = order.slice(0, n).map(function (s) {
    var e = seen[s];
    return { a: null, name: e.f.opp, tag: e.n > 1 ? e.n + "X" : "", src: e.f.oppHead || e.f.oppHeadSmall || "" };
  });
  doc.tilesAuto = true;
  doc.tiles.forEach(function (t, i) {
    if (!t.src) return;
    withBusy(assetFromUrl(t.src, { name: t.name })).then(function (a) {
      if (doc.tiles[i] === t) { t.a = a.key; commit(); refreshInspector(); }
    }).catch(function () { });
  });
}
// the card grid: every main-card fighter in bout order (left corner, right corner)
function autoCards() {
  var out = [];
  doc.bouts.forEach(function (b) { ["l", "r"].forEach(function (sd) { var c = b[sd]; if (c && c.name) out.push({ a: c.hd || c.a || null, name: c.name, b: c }); }); });
  doc.cards = out.slice(0, 8).map(function (k) { return { a: k.a, name: k.name }; });
  // keep the live link to the bout corner (its asset lands later) without saving it
  doc.cards.forEach(function (k, i) { Object.defineProperty(k, "b", { value: out[i].b, enumerable: false, writable: true }); });
  doc.cardsAuto = true;
}
var events = [];
function loadEvents() {
  return api("/studio/api/ufcevents").then(function (list) {
    events = Array.isArray(list) ? list : [];
    fillEventSelect();
    return events;
  }).catch(function () { events = []; fillEventSelect(); return []; });
}
var evCard = null;
// a corner's name: ufc.com sometimes writes it as plain link text (no given / family spans), which
// the Worker splits itself; with no name at all the athlete slug still names him, so no bout is
// ever dropped. A name listed family name first (Wang Cong) is turned round when the event's own
// headline ("Silva vs Wang") says which word is the surname.
function cornerName(c) { return ((c.first || "") + " " + (c.last || "")).trim() || ufcSlugTitle(c.slug); }
function ufcSlugTitle(slug) { return String(slug || "").split("-").filter(Boolean).map(function (w) { return w.charAt(0).toUpperCase() + w.slice(1); }).join(" "); }
function normalizeEvent(ev) {
  (ev.fights || []).forEach(function (f) {
    f.red = f.red || {}; f.blue = f.blue || {};
    [f.red, f.blue].forEach(function (c) {
      if (!c.last && !c.first && c.slug) { var nm = splitName(ufcSlugTitle(c.slug)); c.first = nm.first; c.last = nm.last; }
    });
  });
  var f0 = ev.fights && ev.fights[0], hp = String(ev.headline || "").split(" vs ");
  if (f0 && hp.length === 2) {
    [[f0.red, hp[0]], [f0.blue, hp[1]]].forEach(function (q) {
      var c = q[0], word = String(q[1] || "").trim().toLowerCase();
      if (c && word && c.first && c.last && c.first.toLowerCase() === word && c.last.toLowerCase() !== word) {
        var t0 = c.first; c.first = c.last; c.last = t0; c.swapped = true;
      }
    });
  }
  return ev;
}
function loadEvent(slug, pickMain) {
  return withBusy(api("/studio/api/ufcevent/" + encodeURIComponent(slug))).then(function (ev) {
    evCard = normalizeEvent(ev);
    doc.ev = { slug: ev.slug, title: ev.title, headline: ev.headline, ts: ev.ts, venue: ev.venue };
    var main = (ev.fights || []).filter(function (f) { return f.card === "main" && (f.red.last || f.red.slug) && (f.blue.last || f.blue.slug); }).slice(0, 6);
    doc.bouts = main.map(function (f) {
      return { l: { name: cornerName(f.red), slug: f.red.slug || "", a: null, src: f.red.imgSmall, big: f.red.img, face: f.red.face },
               r: { name: cornerName(f.blue), slug: f.blue.slug || "", a: null, src: f.blue.imgSmall, big: f.blue.img, face: f.blue.face },
               cls: String(f.cls || "").split(" Bout").join(""), title: /title/i.test(f.cls || "") };
    });
    var nCard = 0;
    doc.bouts.forEach(function (b) {
      ["l", "r"].forEach(function (s) {
        var c = b[s];
        if (c.src) {
          assetFromUrl(c.src, { name: c.name, face: c.face, ufc: true }, c.big).then(function (a) {
            c.a = a.key;
            if (doc.cardsAuto) doc.cards.forEach(function (k) { if (k.b === c && !c.hd) k.a = a.key; });
            commit();
          }).catch(function () { });
        }
        // the card grid uses the fighter's UFC headshot when he has one (the approved V1 look)
        if (c.slug && nCard++ < 8) {
          api("/studio/api/ufc/" + encodeURIComponent(c.slug) + "?n=0").then(function (j) {
            if (!j || !j.head) return null;
            return assetFromUrl(j.head, { name: c.name, ufc: true }).then(function (a) {
              c.hd = a.key;
              if (doc.cardsAuto) doc.cards.forEach(function (k) { if (k.b === c) k.a = a.key; });
              commit();
            });
          }).catch(function () { });
        }
      });
    });
    if (doc.cardsAuto) autoCards();
    fillBoutSelect();
    commit();
    refreshInspector();
    if (pickMain && ev.fights && ev.fights.length) return useBout(0);
    return ev;
  });
}
function useBout(i) {
  var f = evCard && evCard.fights ? evCard.fights[i] : null;
  if (!f) return Promise.resolve(null);
  doc.bout = { cls: f.cls, red: f.red.slug, blue: f.blue.slug };
  var ps = [];
  if (f.red.slug) ps.push(loadFighter("A", f.red.slug, true));
  if (f.blue.slug) ps.push(loadFighter("B", f.blue.slug, true));
  return Promise.all(ps.map(function (p) { return p.catch(function (e) { toast(String(e.message || e)); }); })).then(function () {
    // a corner the event lists family name first keeps the event's order on every poster
    [["A", f.red], ["B", f.blue]].forEach(function (q) {
      var P = doc.people[q[0]];
      if (P && q[1].swapped && P.slug === q[1].slug) { P.first = q[1].first; P.last = q[1].last; P.name = (q[1].first + " " + q[1].last).trim(); }
    });
    toast((f.red.last || "?") + " vs " + (f.blue.last || "?") + " loaded into every template");
    commit(); refreshInspector();
  });
}

// ---------- gallery ----------
var GROUPS = ["Headlines", "Cards", "Fight week", "Quotes", "Stats", "Results"];
function buildGallery() {
  var gal = $("gal");
  gal.textContent = "";
  GROUPS.forEach(function (gr) {
    var ts = TPLS.filter(function (t) { return t.group === gr; });
    if (!ts.length) return;
    gal.appendChild(el("h4", null, gr));
    ts.forEach(function (t) {
      var b = el("button", "tcard");
      b.type = "button";
      b.setAttribute("data-tpl", t.id);
      var c = mkCanvas(216, 216);
      c.setAttribute("data-thumb", t.id);
      b.appendChild(c);
      b.appendChild(el("span", null, t.name));
      b.appendChild(el("em", null, t.blurb));
      b.addEventListener("click", function () { setTpl(t.id); });
      gal.appendChild(b);
    });
  });
  markGallery();
}
function markGallery() {
  var bs = document.querySelectorAll(".tcard");
  for (var i = 0; i < bs.length; i++) bs[i].setAttribute("aria-current", bs[i].getAttribute("data-tpl") === doc.tpl ? "true" : "false");
  $("tplName").textContent = (TPL[doc.tpl] || {}).name || "";
}
function setTpl(id) {
  if (!TPL[id] || id === doc.tpl) return;
  doc.tpl = id; sel = null; hov = null;
  markGallery(); buildInspector(); commit();
  if (window.innerWidth < 860) window.scrollTo({ top: 0, behavior: "smooth" });
}

// ---------- inspector ----------
var insp = $("insp");
function sec(title, extra) {
  var s = el("section", "sec"), h = el("h3", null, title);
  if (extra) { extra.classList.add("sp"); h.appendChild(extra); }
  s.appendChild(h);
  insp.appendChild(s);
  return s;
}
function btn(label, cls, fn) {
  var b = el("button", cls || "btn sm", label);
  b.type = "button";
  b.addEventListener("click", fn);
  return b;
}
function toastErr(e) { toast(String((e && e.message) || e)); }
function drawThumb(c, a) {
  var x = c.getContext("2d");
  x.clearRect(0, 0, c.width, c.height);
  x.fillStyle = "#1B1B28"; x.fillRect(0, 0, c.width, c.height);
  if (!a) return;
  if (a.cut && a.head) {
    var s = (c.width * 0.42) / a.head.w, dx = c.width / 2 - a.head.cx * s, dy = c.height * 0.38 - a.head.cy * s;
    x.drawImage(a.img, dx, dy, a.w * s, a.h * s);
  } else {
    var s2 = Math.max(c.width / a.w, c.height / a.h);
    x.drawImage(a.img, (c.width - a.w * s2) / 2, (c.height - a.h * s2) / 2, a.w * s2, a.h * s2);
  }
}
function slotAsset(t, id) {
  var sv = R, sc = scopeId;
  R = { tpl: t }; scopeId = t.id;
  var a = assetOf(id);
  R = sv; scopeId = sc;
  return a;
}
var refreshT = 0;
function refreshInspector() {
  clearTimeout(refreshT);
  refreshT = setTimeout(function () {
    var ae = document.activeElement;
    if (ae && insp.contains(ae) && (ae.tagName === "INPUT" || ae.tagName === "TEXTAREA")) {
      ae.addEventListener("blur", refreshInspector, { once: true });
      return;
    }
    var st = insp.scrollTop;
    buildInspector();
    insp.scrollTop = st;
  }, 60);
}
function buildInspector() {
  var t = TPL[doc.tpl];
  insp.textContent = "";
  var th = themeById(doc.theme);
  document.documentElement.style.setProperty("--acc", th.a);
  document.documentElement.style.setProperty("--acc2", th.lo);

  var s1 = sec("Fight week");
  s1.appendChild(el("p", "mini", "Pick an event, then a bout. Both fighters, their cut-outs, records and fight history, and the whole card fill every template at once."));
  var r1 = el("div", "row"), es = el("select", "in");
  es.id = "evSel";
  r1.appendChild(es);
  r1.appendChild(btn("Load", "btn sm", function () { if (es.value) loadEvent(es.value, true).catch(toastErr); }));
  s1.appendChild(r1);
  var r2 = el("div", "row"), bs = el("select", "in");
  bs.id = "boutSel";
  r2.appendChild(bs);
  r2.appendChild(btn("Use bout", "btn sm", function () { if (bs.value !== "") useBout(Number(bs.value)).catch(toastErr); }));
  s1.appendChild(r2);
  var bn = el("p", "mini", "Loading from ufc.com...");
  bn.id = "busyNote"; bn.hidden = !busyN;
  s1.appendChild(bn);
  fillEventSelect(); fillBoutSelect();

  if (t.fighters && t.fighters.length) {
    var s2 = sec("Fighters");
    t.fighters.forEach(function (w) { fighterRow(s2, t, w); });
    if (t.fighters.length === 2) {
      var sw = el("div", "row");
      sw.style.marginTop = "10px";
      sw.appendChild(btn("Swap sides", "btn sm", function () {
        var a = doc.people.A; doc.people.A = doc.people.B; doc.people.B = a;
        var sa = slotKey("left"), sb = slotKey("right");
        if (sb === undefined) delete doc.slots[sk("left")]; else setSlot("left", sb);
        if (sa === undefined) delete doc.slots[sk("right")]; else setSlot("right", sa);
        dropCaches(); commit(); refreshInspector();
      }));
      s2.appendChild(sw);
    }
  }
  if (t.slots && t.slots.length) {
    var s3 = sec("Images");
    t.slots.forEach(function (s) { s3.appendChild(slotRow(t, s)); });
    s3.appendChild(el("p", "mini", TOUCH ? "Tap Pick on a row to add a photo. Cut-outs are graded and placed by the face; a photo without transparency on a fighter is cut out for you, and Cut out does it on any row. On the poster: drag to move, pinch to zoom, double-tap to reset."
      : "Drop an image on the poster or on a row. Cut-outs are graded and placed by the face; a photo without transparency dropped on a fighter is cut out for you, and Cut out does it on any row. On the poster: drag to move, scroll or pinch to zoom, double-click to reset."));
  }
  if (t.fields && t.fields.length) {
    var s4 = sec("Text");
    t.fields.forEach(function (f) { fieldRow(s4, t, f); });
    if (t.vivid) s4.appendChild(el("p", "mini", "Card titles and names use the theme colors as they are; highlighted words do not apply on the card templates."));
    if (t.mustEdit) s4.appendChild(el("p", "mini", "The sample text is a placeholder: type the real words before you export."));
  }
  if (t.tiles) tilesEditor(t);
  if (t.rows) rowsEditor(t);
  if (t.bouts) boutsEditor(t);
  if (t.form) formEditor(t);
  if (t.cardsEditor) cardsEditor(t);
  styleSection(t);
}
function fillEventSelect() {
  var es = $("evSel");
  if (!es) return;
  es.textContent = "";
  if (!events.length) { var o0 = el("option", null, "No upcoming events loaded"); o0.value = ""; es.appendChild(o0); return; }
  events.forEach(function (ev) {
    var o = el("option", null, ev.title + " - " + ev.headline);
    o.value = ev.slug;
    if (doc.ev && doc.ev.slug === ev.slug) o.selected = true;
    es.appendChild(o);
  });
}
function fillBoutSelect() {
  var bs = $("boutSel");
  if (!bs) return;
  bs.textContent = "";
  var fs = evCard && evCard.fights ? evCard.fights : [];
  if (!fs.length) { var o0 = el("option", null, doc.ev ? "Load the event to list its bouts" : "Load an event first"); o0.value = ""; bs.appendChild(o0); return; }
  fs.forEach(function (f, i) {
    if (!(f.red.last || f.red.slug) || !(f.blue.last || f.blue.slug)) return;
    var o = el("option", null, (f.red.last || cornerName(f.red)) + " vs " + (f.blue.last || cornerName(f.blue)) + (f.cls ? " (" + f.cls.split(" Bout").join("") + ")" : ""));
    o.value = String(i);
    if (doc.bout && doc.bout.red === f.red.slug && doc.bout.blue === f.blue.slug) o.selected = true;
    bs.appendChild(o);
  });
}
function fighterRow(s, t, w) {
  var P = doc.people[w];
  var lab = el("div", "lbl");
  lab.appendChild(el("span", null, t.fighters.length > 1 ? (w === "A" ? "Fighter 1 (left, main)" : "Fighter 2 (right)") : "Fighter"));
  s.appendChild(lab);
  var r = el("div", "row"), inp = el("input", "in");
  inp.placeholder = "Name, for example Islam Makhachev";
  inp.value = P ? P.name : "";
  inp.autocomplete = "off";
  function go() { if (inp.value.trim()) loadFighter(w, inp.value).catch(toastErr); }
  inp.addEventListener("keydown", function (e) { if (e.key === "Enter") go(); });
  r.appendChild(inp);
  r.appendChild(btn("Get from UFC", "btn sm", go));
  s.appendChild(r);
  if (P) {
    var who = el("div", "who"), thb = el("div", "th"), c = mkCanvas(76, 76);
    thb.appendChild(c); drawThumb(c, assets[P.body] || assets[P.head]);
    who.appendChild(thb);
    who.appendChild(el("span", null, [P.record, P.division, P.nick ? LQ + P.nick + RQ : ""].filter(Boolean).join("  " + DOT + "  ")));
    s.appendChild(who);
  }
}
function slotRow(t, s) {
  var a = slotAsset(t, s.id), r = el("div", "slot" + (sel === s.id ? " on" : ""));
  r.setAttribute("data-slot", s.id);
  var th = el("div", "th"), c = mkCanvas(112, 112);
  th.appendChild(c); drawThumb(c, a);
  var mid = el("div");
  mid.appendChild(el("b", null, s.label));
  var from = "";
  var own0 = slotKey(s.id, t.id);
  if (own0 && assets[own0]) from = a && a.cut ? "Your cut-out" : a && cutOf(a) ? "Your photo (cut out once for the grade)" : cutBusy[a.key] ? "Your photo (cutting out...)" : "Your photo";
  else if (a && s.from) {
    var P = s.from.charAt(0) === "A" || s.from.charAt(0) === "B" ? doc.people[s.from.charAt(0)] : null;
    var own = /[.](body|head)$/.test(s.from);
    from = "From " + (own && P ? P.name : a.name || "the card") + (a.cut ? " (cut-out)" : "");
  }
  mid.appendChild(el("small", null, from || s.note || (s.opt ? "Optional" : "Empty: drop an image")));
  var ops = el("div", "ops");
  // a photo without transparency can be cut out (Cloudflare; cached, so never twice)
  var bgSlot = s.kind === "photo" && s.need !== "mask";
  if (a && !a.cut && !bgSlot && !(s.need === "mask" && cutOf(a))) {
    var cb = btn(cutBusy[a.key] ? "Cutting..." : "Cut out", "ib cutb", function () { commitNow(); cutInto({ id: s.id, kind: s.kind, tpl: t.id }, a, s.need); refreshInspector(); });
    cb.title = "Remove the background (about 4 seconds)";
    if (cutBusy[a.key]) cb.disabled = true;
    ops.appendChild(cb);
  }
  // an image the owner dropped here can become the fighter's image on EVERY poster (explicitly)
  if (own0 && assets[own0] && assets[own0].cut && s.need === "cut" && /^[AB][.]body$/.test(s.from || "")) {
    var eb = btn("All", "ib", function () {
      var w = s.from.charAt(0), P = doc.people[w] || (doc.people[w] = { name: "", first: "", last: "", record: "", fights: [], opps: [] });
      P.body = own0;
      TPLS.forEach(function (t2) { (t2.slots || []).forEach(function (s2) { if (s2.from === s.from && slotKey(s2.id, t2.id) === own0) delete doc.slots[sk(s2.id, t2.id)]; }); });
      dropCaches(); commit(); refreshInspector();
      toast("Now on every poster that shows Fighter " + (w === "A" ? "1" : "2") + ". Type his name under Fighters to match the text.");
    });
    eb.title = "Use this image for Fighter " + (s.from.charAt(0) === "A" ? "1" : "2") + " on every poster";
    ops.appendChild(eb);
  }
  var cutHere = a && own0 && ((s.need === "mask" && cutOf(a)) || (a.cut && doc.meta[a.key] && typeof doc.meta[a.key].idb === "string"));
  if (cutHere) {
    var rb = btn("Recut", "ib cutb", function () { recut(t, s); refreshInspector(); });
    rb.title = "Cut the photo out again (uses one of today's cut-outs)";
    ops.appendChild(rb);
  }
  ops.appendChild(btn("Pick", "ib", function () { pickFor = { id: s.id }; $("file").click(); }));
  ops.appendChild(btn("Flip", "ib", function () { var f = frameOf(s.id); f.flip = !f.flip; dropCaches(); commit(); }));
  ops.appendChild(btn("Reset", "ib", function () { var f = frameOf(s.id); doc.frames[sk(s.id)] = { x: 0, y: 0, s: 1, flip: f.flip }; dropCaches(); commit(); }));
  ops.appendChild(btn("X", "ib", function () { delSlot(s.id); if (s.from) setSlot(s.id, ""); dropCaches(); commit(); refreshInspector(); }));
  r.appendChild(th); r.appendChild(mid); r.appendChild(ops);
  r.addEventListener("dragover", function (e) { if (hasFiles(e)) { e.preventDefault(); r.classList.add("on"); } });
  r.addEventListener("dragleave", function () { r.classList.remove("on"); });
  r.addEventListener("drop", function (e) {
    e.preventDefault(); r.classList.remove("on");
    placeFiles(imageFiles(e.dataTransfer), { id: s.id, kind: s.kind });
  });
  return r;
}
function untoks(tk) {
  var out = "", open = false, sp = false;
  for (var i = 0; i < tk.length; i++) {
    var k = tk[i];
    if (k.br) { if (open) { out += "*"; open = false; } out += NL; sp = false; continue; }
    if (k.hot && !open) { out += (sp ? " " : "") + "*" + k.t; open = true; }
    else if (!k.hot && open) { out += "* " + k.t; open = false; }
    else out += (sp ? " " : "") + k.t;
    sp = true;
  }
  if (open) out += "*";
  return out;
}
function fieldRow(s, t, f) {
  var lab = el("div", "lbl");
  lab.appendChild(el("span", null, f.label));
  var edited = doc.text[t.id] && doc.text[t.id][f.id] != null;
  var rs = btn(edited ? "Reset" : "Auto", null, function () {
    if (doc.text[t.id]) delete doc.text[t.id][f.id];
    inp.value = txFor(t, f.id); chips(); commit(); rs.textContent = "Auto";
  });
  lab.appendChild(rs);
  s.appendChild(lab);
  var inp = f.multi ? el("textarea", "in") : el("input", "in");
  if (f.multi) inp.rows = 2;
  inp.value = txFor(t, f.id);
  inp.setAttribute("data-field", f.id);
  inp.addEventListener("input", function () {
    (doc.text[t.id] = doc.text[t.id] || {})[f.id] = inp.value;
    rs.textContent = "Reset";
    chips(); commit();
  });
  s.appendChild(inp);
  var cw = el("div", "chips"), noChips = !!(f.plain || t.vivid);
  if (!noChips) s.appendChild(cw);
  function chips() {
    cw.textContent = "";
    if (noChips) return;
    var tk = toks(inp.value);
    tk.forEach(function (k, i) {
      if (k.br) return;
      var c = btn(k.t, "chip", function () {
        var t2 = toks(inp.value);
        t2[i].hot = !t2[i].hot;
        inp.value = untoks(t2);
        (doc.text[t.id] = doc.text[t.id] || {})[f.id] = inp.value;
        rs.textContent = "Reset";
        chips(); commit();
      });
      c.setAttribute("aria-pressed", k.hot ? "true" : "false");
      c.title = "Tap to color this word";
      cw.appendChild(c);
    });
  }
  chips();
}
function focusField(id) {
  var inp = insp.querySelector('[data-field="' + id + '"]');
  if (!inp) return;
  inp.scrollIntoView({ block: "center", behavior: "smooth" });
  setTimeout(function () { inp.focus(); if (inp.select) inp.select(); }, 250);
}
function tilesEditor(t) {
  var s = sec("Opponents");
  s.appendChild(el("p", "mini", "Loading a fighter fills these from his last bouts (a rematch shows as 2X). Drop a cut-out on any tile, on the poster or here."));
  var r = el("div", "row");
  r.appendChild(btn("Refill from record", "btn sm", function () { if (doc.people.A) { autoTiles(); commit(); refreshInspector(); } else toast("Load a fighter first"); }));
  r.appendChild(btn("Add tile", "btn sm", function () { if (doc.tiles.length < 12) { doc.tiles.push({ a: null, name: "", tag: "" }); doc.tilesAuto = false; commit(); refreshInspector(); } }));
  s.appendChild(r);
  var list = el("div", "list");
  list.style.marginTop = "10px";
  doc.tiles.forEach(function (tile, i) {
    var it = el("div", "it"), th = el("div", "th"), c = mkCanvas(80, 80);
    th.appendChild(c); drawThumb(c, assets[tile.a]);
    th.title = "Drop a cut-out";
    th.addEventListener("dragover", function (e) { if (hasFiles(e)) e.preventDefault(); });
    th.addEventListener("drop", function (e) { e.preventDefault(); placeFiles(imageFiles(e.dataTransfer), { id: "tile:" + i, kind: "tile" }); });
    th.addEventListener("click", function () { pickFor = { id: "tile:" + i, kind: "tile" }; $("file").click(); });
    var mid = el("div", "row"), nm = el("input", "in"), tg = el("input", "in");
    nm.value = tile.name || ""; nm.placeholder = "Name";
    tg.value = tile.tag || ""; tg.placeholder = "2X"; tg.style.width = "52px"; tg.style.flex = "none";
    nm.addEventListener("input", function () { tile.name = nm.value; doc.tilesAuto = false; commit(); });
    tg.addEventListener("input", function () { tile.tag = tg.value; doc.tilesAuto = false; commit(); });
    mid.appendChild(nm); mid.appendChild(tg);
    var ops = el("div", "ops");
    ops.appendChild(btn("Up", "ib", function () { if (i > 0) { var x = doc.tiles[i - 1]; doc.tiles[i - 1] = tile; doc.tiles[i] = x; doc.tilesAuto = false; commit(); refreshInspector(); } }));
    ops.appendChild(btn("X", "ib", function () { doc.tiles.splice(i, 1); doc.tilesAuto = false; commit(); refreshInspector(); }));
    it.appendChild(th); it.appendChild(mid); it.appendChild(ops);
    list.appendChild(it);
  });
  s.appendChild(list);
}
function rowsEditor(t) {
  var s = sec("Stats");
  var rows = doc.rows && doc.rows.length ? doc.rows : tapeRows(D());
  s.appendChild(el("p", "mini", "Filled from both fighters' UFC stats; the better number is colored. Wrap a value in *stars* to color it yourself."));
  var list = el("div", "list");
  rows.forEach(function (row, i) {
    var r = el("div", "row"), a = el("input", "in"), b = el("input", "in"), c = el("input", "in");
    a.value = row.l; b.value = row.label; c.value = row.r;
    b.style.textAlign = "center"; a.style.textAlign = "right";
    function upd() {
      if (!doc.rows || !doc.rows.length) doc.rows = rows.map(function (x) { return { label: x.label, l: x.l, r: x.r }; });
      doc.rows[i] = { label: b.value, l: a.value, r: c.value };
      commit();
    }
    [a, b, c].forEach(function (x) { x.addEventListener("input", upd); });
    r.appendChild(a); r.appendChild(b); r.appendChild(c);
    r.appendChild(btn("X", "ib", function () {
      doc.rows = rows.map(function (x) { return { label: x.label, l: x.l, r: x.r }; });
      doc.rows.splice(i, 1); commit(); refreshInspector();
    }));
    list.appendChild(r);
  });
  s.appendChild(list);
  var r2 = el("div", "row");
  r2.style.marginTop = "8px";
  r2.appendChild(btn("Add row", "btn sm", function () {
    doc.rows = rows.map(function (x) { return { label: x.label, l: x.l, r: x.r }; });
    if (doc.rows.length < 8) doc.rows.push({ label: "LABEL", l: "-", r: "-" });
    commit(); refreshInspector();
  }));
  r2.appendChild(btn("Refill from UFC data", "btn sm", function () { doc.rows = null; commit(); refreshInspector(); }));
  s.appendChild(r2);
}
function boutsEditor(t) {
  var s = sec("Bouts");
  s.appendChild(el("p", "mini", "Loading an event fills the main card with every fighter's cut-out. Drop an image on a square to replace it."));
  var list = el("div", "list");
  doc.bouts.forEach(function (b, i) {
    var r = el("div", "row");
    ["l", "r"].forEach(function (side) {
      var th = el("div", "th"), c = mkCanvas(80, 80);
      th.style.width = "40px"; th.style.height = "40px"; th.style.flex = "none";
      th.appendChild(c); drawThumb(c, assets[b[side].a]);
      th.addEventListener("dragover", function (e) { if (hasFiles(e)) e.preventDefault(); });
      th.addEventListener("drop", function (e) { e.preventDefault(); placeFiles(imageFiles(e.dataTransfer), { id: "bout:" + i + ":" + side, kind: "bout" }); });
      th.addEventListener("click", function () { pickFor = { id: "bout:" + i + ":" + side, kind: "bout" }; $("file").click(); });
      var inp = el("input", "in");
      inp.value = b[side].name || "";
      inp.addEventListener("input", function () { b[side].name = inp.value; commit(); });
      if (side === "l") { r.appendChild(th); r.appendChild(inp); } else { r.appendChild(inp); r.appendChild(th); }
    });
    r.appendChild(btn("X", "ib", function () { doc.bouts.splice(i, 1); commit(); refreshInspector(); }));
    list.appendChild(r);
  });
  s.appendChild(list);
  var r2 = el("div", "row");
  r2.style.marginTop = "8px";
  r2.appendChild(btn("Add bout", "btn sm", function () { if (doc.bouts.length < 6) { doc.bouts.push({ l: { name: "" }, r: { name: "" }, cls: "" }); commit(); refreshInspector(); } }));
  if (doc.ev) r2.appendChild(btn("Reload card", "btn sm", function () { loadEvent(doc.ev.slug, false).catch(toastErr); }));
  s.appendChild(r2);
}
function formEditor(t) {
  var s = sec("Results");
  var rows = doc.form && doc.form.length ? doc.form : formRows(D());
  s.appendChild(el("p", "mini", "From the fighter's last five bouts on ufc.com. Edit any line."));
  var list = el("div", "list");
  rows.forEach(function (row, i) {
    var r = el("div", "row"), res = el("select", "in"), opp = el("input", "in"), how = el("input", "in");
    ["W", "L", "D", "NC"].forEach(function (v) { var o = el("option", null, v); o.value = v; if (row.res === v) o.selected = true; res.appendChild(o); });
    res.style.width = "64px"; res.style.flex = "none";
    opp.value = row.opp; how.value = row.how;
    function upd() {
      if (!doc.form || !doc.form.length) doc.form = rows.map(function (x) { return { res: x.res, opp: x.opp, how: x.how, ev: x.ev }; });
      doc.form[i] = { res: res.value, opp: opp.value, how: how.value, ev: doc.form[i].ev };
      commit();
    }
    res.addEventListener("change", upd); opp.addEventListener("input", upd); how.addEventListener("input", upd);
    r.appendChild(res); r.appendChild(opp); r.appendChild(how);
    list.appendChild(r);
  });
  s.appendChild(list);
  var r2 = el("div", "row");
  r2.style.marginTop = "8px";
  r2.appendChild(btn("Refill from UFC data", "btn sm", function () { doc.form = null; commit(); refreshInspector(); }));
  s.appendChild(r2);
}
function rng(parent, label, get, set, min, max, step, fmt) {
  var r = el("div", "rng"), l = el("span", null, label), i = el("input"), o = el("output");
  i.type = "range"; i.min = min; i.max = max; i.step = step; i.value = get();
  i.setAttribute("aria-label", label);
  function show(v) { o.textContent = fmt ? fmt(v) : Math.round(v * 100) + ""; }
  show(get());
  i.addEventListener("input", function () { set(Number(i.value)); show(Number(i.value)); interactT = Date.now(); commit(); });
  r.appendChild(l); r.appendChild(i); r.appendChild(o);
  parent.appendChild(r);
  return i;
}
var LOOK_NOTES = {
  carved: "Bright, textured, natural skin on the dark plate (the headline look).",
  gritty: "Black and white with the grit (the split look).",
  pop: "Black and white, the kit kept in color and turned into the theme.",
  vivid: "Crisp and saturated, the bright card look.",
  natural: "A light touch, for a photo that should stay a photo."
};
// what the Exposure slider acts on: { id } (a fighter, circle, card, tile or square), { id: null }
// (all of them) or { off } (a background photo: it is graded into the theme and has no nudge)
var expoUI = null;
function expoTarget() {
  if (!sel || /^(text|rows|form)/.test(sel)) return { id: null, label: "every fighter, circle, card and tile" };
  var h = findHit(sel), pl = lastR && lastR.place[sel];
  if (!h) return { id: null, label: "every fighter, circle, card and tile" };
  var lab = labelOf(h);
  if (h.kind === "photo" && pl && pl.plate) return { id: sel, off: true, label: lab };
  return { id: sel, label: lab };
}
// the panel follows the selection without a rebuild: the Exposure line and value, the image row
function refreshSelectionUI() {
  var rows = insp.querySelectorAll(".slot");
  for (var i = 0; i < rows.length; i++) rows[i].classList.toggle("on", rows[i].getAttribute("data-slot") === sel);
  if (!expoUI || !document.body.contains(expoUI.input)) return;
  var q = expoTarget(), v = q.off ? 0 : q.id ? ((doc.frames[sk(q.id)] || {}).e || 0) : doc.fx.expo;
  expoUI.input.value = v; expoUI.input.disabled = !!q.off;
  if (expoUI.out) expoUI.out.textContent = (v > 0 ? "+" : "") + Math.round(v * 100);
  expoUI.note.textContent = q.off ? "Exposure works on fighters, circles, cards and tiles; " + q.label.toLowerCase() + " is graded into the theme."
    : q.id ? "Exposure: " + q.label + " only. Click an empty part of the poster (or press Esc) for every image."
    : "Exposure: " + q.label + ". Select an image on the poster to nudge just that one.";
}
function styleSection(t) {
  var s = sec("Style");
  s.appendChild(el("div", "lbl", "Color theme"));
  var sw = el("div", "swatches");
  THEMES.forEach(function (th) {
    var b = btn("", "sw", function () { doc.theme = th.id; dropCaches(); tintCache = {}; commit(); refreshInspector(); });
    b.style.background = "linear-gradient(135deg," + th.hi + "," + th.a + " 55%," + th.lo + ")";
    b.title = th.name; b.setAttribute("aria-label", th.name + " theme"); b.setAttribute("data-theme", th.id);
    b.setAttribute("aria-pressed", doc.theme === th.id ? "true" : "false");
    sw.appendChild(b);
  });
  s.appendChild(sw);
  var cur = lookOf(t);
  s.appendChild(el("div", "lbl", "Look"));
  var lc = el("div", "chips");
  LOOKS.forEach(function (L) {
    var b = btn(L.name, "chip", function () { doc.lookBy[t.id] = L.id; dropCaches(); commit(); refreshInspector(); });
    b.setAttribute("aria-pressed", cur.id === L.id ? "true" : "false");
    b.setAttribute("data-look", L.id);
    b.title = LOOK_NOTES[L.id];
    lc.appendChild(b);
  });
  s.appendChild(lc);
  s.appendChild(el("p", "mini", LOOK_NOTES[cur.id] + (doc.lookBy[t.id] && doc.lookBy[t.id] !== (t.look || "carved") ? "" : " (this template's own look)")));
  if (t.vivid) {
    s.appendChild(el("div", "lbl", "Ground"));
    var gs = el("div", "seg");
    gs.setAttribute("role", "group"); gs.setAttribute("aria-label", "Card ground"); gs.id = "groundSeg";
    [["light", "Light"], ["dark", "Dark"]].forEach(function (q) {
      var b = btn(q[1], "sg", function () { doc.ground = q[0]; commit(); refreshInspector(); });
      b.setAttribute("data-ground", q[0]);
      b.setAttribute("aria-pressed", doc.ground === q[0] ? "true" : "false");
      gs.appendChild(b);
    });
    s.appendChild(gs);
  } else {
    s.appendChild(el("div", "lbl", "Highlighted words"));
    var hc = el("div", "chips");
    [["color", "Color"], ["box", "Box"], ["under", "Underline"]].forEach(function (h) {
      var b = btn(h[1], "chip", function () { doc.hotStyle = h[0]; commit(); refreshInspector(); });
      b.setAttribute("aria-pressed", doc.hotStyle === h[0] ? "true" : "false");
      hc.appendChild(b);
    });
    s.appendChild(hc);
  }
  var box = el("div");
  box.style.marginTop = "10px";
  s.appendChild(box);
  // the exposure nudge: the image selected on the poster RIGHT NOW (read when the slider moves, not
  // when the panel was built), or every fighter, circle, card and tile when nothing is selected
  var ei = rng(box, "Exposure", function () { var q = expoTarget(); return q.off ? 0 : q.id ? ((doc.frames[sk(q.id)] || {}).e || 0) : doc.fx.expo; },
      function (v) { var q = expoTarget(); if (q.off) return; if (q.id) frameOf(q.id).e = v; else doc.fx.expo = v; }, -1, 1, 0.05,
      function (v) { return (v > 0 ? "+" : "") + Math.round(v * 100); });
  var en = el("p", "mini", "");
  box.appendChild(en);
  expoUI = { input: ei, out: ei.parentNode.lastChild, note: en };
  refreshSelectionUI();
  if (!t.vivid) {
    rng(box, "Glow", function () { return doc.fx.glow; }, function (v) { doc.fx.glow = v; }, 0, 1.6, 0.05);
    rng(box, "Edge light", function () { return doc.fx.rim; }, function (v) { doc.fx.rim = v; }, 0, 2, 0.05);
    rng(box, "Ground fade", function () { return doc.fx.fade; }, function (v) { doc.fx.fade = v; }, 0, 1.4, 0.05);
    rng(box, "Shading", function () { return doc.fx.shade; }, function (v) { doc.fx.shade = v; }, 0, 1.6, 0.05);
    rng(box, "Grain", function () { return doc.fx.grain; }, function (v) { doc.fx.grain = v; }, 0, 2, 0.05);
    rng(box, "Vignette", function () { return doc.fx.vig; }, function (v) { doc.fx.vig = v; }, 0, 1.6, 0.05);
  }
  var r = el("div", "row");
  r.style.marginTop = "12px";
  r.appendChild(btn("Reset style", "btn sm", function () {
    var f = freshDoc();
    doc.fx = f.fx; doc.hotStyle = f.hotStyle; doc.theme = f.theme; delete doc.lookBy[t.id]; doc.ground = f.ground;
    dropCaches(); tintCache = {}; commit(); refreshInspector();
  }));
  r.appendChild(btn("Start over", "btn sm", function () {
    if (!window.confirm("Clear every image, text and fighter on this page? Downloads you made are kept.")) return;
    doc = freshDoc(); dropCaches(); save(); hist = [snap()]; hix = 0; updateUndo(); buildInspector(); markGallery(); requestRender(true);
  }));
  s.appendChild(r);
}
// the card grid's list: how many cards, and who is on each (drop a cut-out or a photo on a card;
// a photo without transparency is cut out automatically)
function cardsEditor(t) {
  var s = sec("Cards");
  var cs = el("div", "seg");
  cs.setAttribute("role", "group"); cs.setAttribute("aria-label", "How many cards"); cs.id = "cardsSeg";
  [4, 6, 8].forEach(function (n) {
    var b = btn(n + " cards", "sg", function () { doc.cardsN = n; commit(); refreshInspector(); });
    b.setAttribute("aria-pressed", doc.cardsN === n ? "true" : "false");
    cs.appendChild(b);
  });
  s.appendChild(cs);
  s.appendChild(el("p", "mini", "Loading an event fills the cards with the main card, in bout order. Drop a cut-out or a photo on any card."));
  var list = el("div", "list");
  list.style.marginTop = "10px";
  for (var i = 0; i < doc.cardsN; i++) (function (i) {
    var it = doc.cards[i] || { a: null, name: "" };
    var row = el("div", "it"), th = el("div", "th"), c = mkCanvas(80, 80);
    th.appendChild(c); drawThumb(c, assets[it.a]);
    th.title = "Drop a cut-out or a photo";
    th.addEventListener("dragover", function (e) { if (hasFiles(e)) e.preventDefault(); });
    th.addEventListener("drop", function (e) { e.preventDefault(); placeFiles(imageFiles(e.dataTransfer), { id: "card:" + i, kind: "card" }); });
    th.addEventListener("click", function () { pickFor = { id: "card:" + i, kind: "card" }; $("file").click(); });
    var nm = el("input", "in");
    nm.value = it.name || ""; nm.placeholder = "Name";
    nm.addEventListener("input", function () { setCard(i, null, nm.value); commit(); });
    var ops = el("div", "ops");
    var ca = assets[it.a];
    if (ca && !ca.cut) ops.appendChild(btn("Cut out", "ib cutb", function () { commitNow(); cutInto({ id: "card:" + i, kind: "card" }, ca, "cut"); }));
    ops.appendChild(btn("X", "ib", function () { setCard(i, "", ""); commit(); refreshInspector(); }));
    row.appendChild(th); row.appendChild(nm); row.appendChild(ops);
    list.appendChild(row);
  })(i);
  s.appendChild(list);
  var r2 = el("div", "row");
  r2.style.marginTop = "8px";
  r2.appendChild(btn("Refill from the card", "btn sm", function () { if (doc.bouts.length) { autoCards(); commit(); refreshInspector(); } else toast("Load an event first"); }));
  s.appendChild(r2);
}
function setCard(i, key, name) {
  while (doc.cards.length <= i && doc.cards.length < 8) doc.cards.push({ a: null, name: "" });
  var c = doc.cards[i];
  if (!c) return;
  if (key !== null) c.a = key || null;
  if (name !== null && name !== undefined) c.name = name;
  doc.cardsAuto = false;
}
// ---------- pointer, drop, paste, keys ----------
var sel = null, hov = null, dropHover = null, dragging = null, pointers = {}, pickFor = null;
var MOVABLE = ["photo", "cut", "circle"], DROPPABLE = ["photo", "cut", "circle", "tile", "bout", "card"];
function toCanvas(e) {
  var r = cv.getBoundingClientRect();
  return { x: (e.clientX - r.left) * W / r.width, y: (e.clientY - r.top) * H / r.height };
}
function inShape(s, x, y) {
  if (s.r) {
    if (!(x >= s.r[0] && y >= s.r[1] && x <= s.r[0] + s.r[2] && y <= s.r[1] + s.r[3])) return false;
    if (!s.al) return true;
    // the matte: a few px of slack (the low-res alpha, max over a 3 x 3 neighbourhood)
    var al = s.al, cx = Math.floor(x * al.q), cy = Math.floor(y * al.q), best = 0;
    for (var j = -1; j <= 1; j++) for (var i = -1; i <= 1; i++) {
      var xx = cx + i, yy = cy + j;
      if (xx >= 0 && yy >= 0 && xx < al.w && yy < al.h) best = Math.max(best, al.a[yy * al.w + xx]);
    }
    return best > 0.3;
  }
  if (s.c) { var dx = x - s.c[0], dy = y - s.c[1]; return dx * dx + dy * dy <= s.c[2] * s.c[2]; }
  return false;
}
// what the pointer is over: text and circles first, then cut-outs (by their matte), cards and
// tiles, and background photos last; inside a tier the one drawn last wins. An EMPTY fighter slot
// (its placeholder area) is a drop target like a fighter, but a press or a drag there reaches the
// background photo first (dragging an empty slot moves nothing).
var HIT_TIER = { text: 0, circle: 0, rows: 0, cut: 1, card: 1, tile: 1, bout: 1, photo: 2 };
function hitAt(x, y, kinds) {
  var hs = lastR ? lastR.hits : [], forDrop = kinds === DROPPABLE;
  for (var tier = 0; tier <= 3; tier++) {
    for (var i = hs.length - 1; i >= 0; i--) {
      var h = hs[i], ht = HIT_TIER[h.kind] == null ? 1 : HIT_TIER[h.kind];
      if (h.shape.empty && !forDrop) ht = 3;
      if (ht !== tier) continue;
      if (kinds && kinds.indexOf(h.kind) === -1) continue;
      if (inShape(h.shape, x, y)) return h;
    }
  }
  return null;
}
function findHit(id) { var hs = lastR ? lastR.hits : []; for (var i = hs.length - 1; i >= 0; i--) if (hs[i].id === id) return hs[i]; return null; }
function hasFiles(e) { var t = e.dataTransfer && e.dataTransfer.types; return !!t && Array.prototype.indexOf.call(t, "Files") !== -1; }
function imageFiles(dt) {
  var out = [], fs = (dt && dt.files) || [];
  for (var i = 0; i < fs.length; i++) if (/^image[/]/.test(fs[i].type || "")) out.push(fs[i]);
  return out;
}
function fallbackTarget() {
  if (sel) { var h = findHit(sel); if (h && DROPPABLE.indexOf(h.kind) !== -1) return h; }
  var t = TPL[doc.tpl], ss = t.slots || [];
  for (var i = 0; i < ss.length; i++) if (!ss[i].opt && !slotAsset(t, ss[i].id)) return { id: ss[i].id, kind: ss[i].kind };
  if (t.tiles) { for (var j = 0; j < doc.tiles.length; j++) if (!doc.tiles[j].a) return { id: "tile:" + j, kind: "tile" }; return { id: "tile:" + doc.tiles.length, kind: "tile" }; }
  if (t.cardsEditor) { for (var c = 0; c < doc.cardsN; c++) if (!(doc.cards[c] && doc.cards[c].a)) return { id: "card:" + c, kind: "card" }; return { id: "card:0", kind: "card" }; }
  return ss.length ? { id: ss[0].id, kind: ss[0].kind } : null;
}
function setTile(i, key) {
  while (doc.tiles.length <= i && doc.tiles.length < 12) doc.tiles.push({ a: null, name: "", tag: "" });
  if (doc.tiles[i]) doc.tiles[i].a = key;
  doc.tilesAuto = false;
}
function placeFiles(files, h) {
  if (!files || !files.length) return;
  h = h || fallbackTarget();
  if (!h) { toast("This template has no image slots"); return; }
  if (h.kind === "tile") {
    var i0 = Number(String(h.id).split(":")[1]) || 0;
    files.slice(0, 12).forEach(function (f, j) {
      withBusy(assetFromFile(f)).then(function (a) { setTile(i0 + j, a.key); commit(); refreshInspector(); }).catch(toastErr);
    });
    return;
  }
  if (h.kind === "bout") {
    var pr = String(h.id).split(":"), bi = Number(pr[1]), side = pr[2];
    withBusy(assetFromFile(files[0])).then(function (a) {
      if (doc.bouts[bi] && doc.bouts[bi][side]) { doc.bouts[bi][side].a = a.key; commit(); refreshInspector(); }
    }).catch(toastErr);
    return;
  }
  if (h.kind === "card" && /^card:/.test(String(h.id))) {
    var c0 = Number(String(h.id).split(":")[1]) || 0;
    files.slice(0, 8).forEach(function (f, j) {
      withBusy(assetFromFile(f)).then(function (a) {
        setCard(c0 + j, a.key, null); commit(); refreshInspector();
        if (!a.cut) { commitNow(); cutInto({ id: "card:" + (c0 + j), kind: "card" }, a, "cut"); }
      }).catch(toastErr);
    });
    return;
  }
  var tid0 = doc.tpl;
  withBusy(assetFromFile(files[0])).then(function (a) {
    setSlot(h.id, a.key, tid0);
    delete doc.frames[sk(h.id, tid0)];
    sel = h.id;
    dropCaches();
    commit(); refreshInspector();
    var sd = slotDef(TPL[tid0], h.id), need = sd && sd.need;
    // a fighter slot needs a cut-out: a photo without transparency is cut out automatically
    // (it stays on the poster meanwhile; the result swaps in, one undo brings the photo back)
    if (need && !a.cut) { commitNow(); cutInto({ id: h.id, kind: sd.kind, tpl: tid0 }, a, need); return; }
    toast(a.cut ? "Cut-out placed: it snaps to the head" : "Photo placed: drag to frame it");
  }).catch(toastErr);
}
$("file").addEventListener("change", function () {
  var fs = [], list = this.files || [];
  for (var i = 0; i < list.length; i++) fs.push(list[i]);
  var target = pickFor;
  pickFor = null;
  this.value = "";
  if (target && !target.kind) { var s = slotDef(TPL[doc.tpl], target.id); target.kind = s ? s.kind : "photo"; }
  placeFiles(fs, target);
});
function normalizeFrame(id) {
  var pl = lastR && lastR.place[id], f = doc.frames[sk(id)];
  if (!pl || !f || pl.kind !== "photo") return;
  var r = pl.rect;
  f.x = clamp(pl.bx + f.x, r[0] + r[2] - pl.dw, r[0]) - pl.bx;
  f.y = clamp(pl.by + f.y, r[1] + r[3] - pl.dh, r[1]) - pl.by;
}
cv.addEventListener("pointerdown", function (e) {
  var p = toCanvas(e);
  pointers[e.pointerId] = p;
  var ids = Object.keys(pointers);
  if (ids.length === 2 && dragging) {
    var a = pointers[ids[0]], b = pointers[ids[1]];
    dragging.pinch = { d0: Math.max(10, Math.hypot(a.x - b.x, a.y - b.y)), s0: frameOf(dragging.id).s };
    return;
  }
  var h = hitAt(p.x, p.y);
  if (!h) { sel = null; drawOverlay(); refreshSelectionUI(); return; }
  if (h.kind === "text") { focusField(h.id.slice(5)); return; }
  if (h.kind === "rows") { var s = insp.querySelector(".list"); if (s) s.scrollIntoView({ block: "center", behavior: "smooth" }); return; }
  sel = h.id;
  refreshSelectionUI();
  if (MOVABLE.indexOf(h.kind) === -1) { drawOverlay(); return; }
  var f = frameOf(h.id);
  dragging = { id: h.id, kind: h.kind, x0: p.x, y0: p.y, f0: { x: f.x, y: f.y, s: f.s } };
  try { cv.setPointerCapture(e.pointerId); } catch (x) { }
  e.preventDefault();
  drawOverlay();
});
cv.addEventListener("pointermove", function (e) {
  var p = toCanvas(e);
  if (pointers[e.pointerId]) pointers[e.pointerId] = p;
  if (dragging) {
    var f = frameOf(dragging.id), ids = Object.keys(pointers);
    if (ids.length === 2 && dragging.pinch) {
      var a = pointers[ids[0]], b = pointers[ids[1]];
      f.s = clamp(dragging.pinch.s0 * Math.hypot(a.x - b.x, a.y - b.y) / dragging.pinch.d0, dragging.kind === "photo" ? 1 : 0.3, 5);
    } else {
      f.x = dragging.f0.x + (p.x - dragging.x0);
      f.y = dragging.f0.y + (p.y - dragging.y0);
    }
    editT = Date.now();
    requestRender();
    return;
  }
  var h = hitAt(p.x, p.y);
  if ((h && h.id) !== (hov && hov.id)) { hov = h; drawOverlay(); }
  cv.style.cursor = h ? (MOVABLE.indexOf(h.kind) !== -1 ? "grab" : h.kind === "text" ? "text" : "pointer") : "default";
});
function endPointer(e) {
  delete pointers[e.pointerId];
  if (dragging && !Object.keys(pointers).length) {
    normalizeFrame(dragging.id);
    dragging = null;
    commit();
  }
}
cv.addEventListener("pointerup", endPointer);
cv.addEventListener("pointercancel", endPointer);
cv.addEventListener("pointerleave", function () { if (!dragging && hov) { hov = null; drawOverlay(); } });
cv.addEventListener("wheel", function (e) {
  var p = toCanvas(e), h = hitAt(p.x, p.y, MOVABLE);
  if (!h) return;
  e.preventDefault();
  var f = frameOf(h.id), s1 = clamp(f.s * Math.exp(-e.deltaY * 0.0015), h.kind === "photo" ? 1 : 0.3, 5);
  var pl = lastR && lastR.place[h.id];
  if (h.kind === "cut" && pl && pl.P) {
    var ratio = s1 / f.s;
    f.x += (p.x + (pl.P.hx - p.x) * ratio) - pl.P.hx;
    f.y += (p.y + (pl.P.hy - p.y) * ratio) - pl.P.hy;
  }
  f.s = s1; sel = h.id;
  interactT = Date.now();
  requestRender();
  commit();
}, { passive: false });
cv.addEventListener("dblclick", function (e) {
  var p = toCanvas(e), h = hitAt(p.x, p.y, MOVABLE);
  if (!h) return;
  var f = frameOf(h.id);
  doc.frames[sk(h.id)] = { x: 0, y: 0, s: 1, flip: f.flip };
  commit();
});
var cwrap = $("cwrap");
cwrap.addEventListener("dragover", function (e) {
  if (!hasFiles(e)) return;
  e.preventDefault();
  var p = toCanvas(e), h = hitAt(p.x, p.y, DROPPABLE);
  cwrap.classList.add("drag");
  if ((h && h.id) !== (dropHover && dropHover.id)) { dropHover = h; drawOverlay(); }
});
cwrap.addEventListener("dragleave", function (e) {
  if (e.target === cwrap || e.target === cv) { cwrap.classList.remove("drag"); dropHover = null; drawOverlay(); }
});
cwrap.addEventListener("drop", function (e) {
  e.preventDefault();
  e.stopPropagation();
  cwrap.classList.remove("drag");
  var p = toCanvas(e), h = hitAt(p.x, p.y, DROPPABLE);
  dropHover = null;
  placeFiles(imageFiles(e.dataTransfer), h);
  drawOverlay();
});
window.addEventListener("dragover", function (e) { if (hasFiles(e)) e.preventDefault(); });
window.addEventListener("drop", function (e) { if (hasFiles(e)) { e.preventDefault(); placeFiles(imageFiles(e.dataTransfer), null); } });
window.addEventListener("paste", function (e) {
  var ae = document.activeElement;
  if (ae && (ae.tagName === "INPUT" || ae.tagName === "TEXTAREA")) return;
  var items = (e.clipboardData && e.clipboardData.items) || [], fs = [];
  for (var i = 0; i < items.length; i++) if (items[i].kind === "file" && /^image[/]/.test(items[i].type)) fs.push(items[i].getAsFile());
  if (fs.length) { e.preventDefault(); placeFiles(fs, null); }
});
document.addEventListener("keydown", function (e) {
  var ae = document.activeElement, typing = ae && (ae.tagName === "INPUT" || ae.tagName === "TEXTAREA" || ae.tagName === "SELECT");
  var mod = e.ctrlKey || e.metaKey;
  if (mod && (e.key === "z" || e.key === "Z") && !typing) { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
  if (mod && (e.key === "y" || e.key === "Y") && !typing) { e.preventDefault(); redo(); return; }
  if (!typing && e.key === "Escape" && sel) { sel = null; drawOverlay(); refreshSelectionUI(); return; }
  if (typing || !sel) return;
  var h = findHit(sel);
  if (!h || MOVABLE.indexOf(h.kind) === -1) return;
  var f = frameOf(sel), st = e.shiftKey ? 20 : 4, used = true;
  if (e.key === "ArrowLeft") f.x -= st;
  else if (e.key === "ArrowRight") f.x += st;
  else if (e.key === "ArrowUp") f.y -= st;
  else if (e.key === "ArrowDown") f.y += st;
  else if (e.key === "+" || e.key === "=") f.s = clamp(f.s * 1.05, 0.3, 5);
  else if (e.key === "-") f.s = clamp(f.s / 1.05, h.kind === "photo" ? 1 : 0.3, 5);
  else if (e.key === "f" || e.key === "F") { f.flip = !f.flip; dropCaches(); }
  else if (e.key === "Delete" || e.key === "Backspace") { delSlot(sel); var sdd = slotDef(TPL[doc.tpl], sel); if (sdd && sdd.from) setSlot(sel, ""); dropCaches(); refreshInspector(); }
  else used = false;
  if (used) { e.preventDefault(); normalizeFrame(sel); commit(); }
});
function labelOf(h) {
  if (!h) return "";
  if (h.label) return h.label;
  var s = slotDef(TPL[doc.tpl], h.id);
  return s ? s.label : h.kind;
}
function drawOverlay() {
  var r = cv.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
  var w = Math.max(1, Math.round(r.width * dpr)), h = Math.max(1, Math.round(r.height * dpr));
  if (ov.width !== w || ov.height !== h) { ov.width = w; ov.height = h; }
  og.setTransform(1, 0, 0, 1, 0, 0);
  og.clearRect(0, 0, w, h);
  if (!lastR) return;
  var sx = w / W, sy = h / H, acc = themeById(doc.theme).a;
  function outline(hh, color, dash, label) {
    og.save();
    og.lineWidth = 2 * dpr;
    og.setLineDash(dash ? [7 * dpr, 6 * dpr] : []);
    og.strokeStyle = color;
    og.beginPath();
    var lx, ly;
    if (hh.shape.c) {
      og.arc(hh.shape.c[0] * sx, hh.shape.c[1] * sy, hh.shape.c[2] * sx, 0, Math.PI * 2);
      lx = (hh.shape.c[0] - hh.shape.c[2]) * sx; ly = (hh.shape.c[1] - hh.shape.c[2]) * sy;
    } else {
      var q = hh.shape.r, x0 = Math.max(1, q[0] * sx), y0 = Math.max(1, q[1] * sy);
      var x1 = Math.min(w - 1, (q[0] + q[2]) * sx), y1 = Math.min(h - 1, (q[1] + q[3]) * sy);
      og.rect(x0, y0, x1 - x0, y1 - y0);
      lx = x0; ly = y0;
    }
    og.stroke();
    if (label) {
      og.setLineDash([]);
      og.font = "700 " + Math.round(12 * dpr) + "px Poppins, sans-serif";
      var tw = og.measureText(label).width + 14 * dpr, th = 22 * dpr;
      lx = clamp(lx, 4 * dpr, w - tw - 4 * dpr); ly = clamp(ly - th - 4 * dpr, 4 * dpr, h - th - 4 * dpr);
      og.fillStyle = color; og.beginPath(); og.rect(lx, ly, tw, th); og.fill();
      og.fillStyle = "#0B0B10"; og.fillText(label, lx + 7 * dpr, ly + 15 * dpr);
    }
    og.restore();
  }
  if (dropHover) { outline(dropHover, acc, false, "Drop here: " + labelOf(dropHover)); return; }
  if (hov && hov.id !== sel && hov.kind !== "text" && hov.kind !== "rows") outline(hov, "rgba(255,255,255,.7)", true, labelOf(hov));
  var sh = sel ? findHit(sel) : null;
  if (sh) outline(sh, acc, false, labelOf(sh));
}
window.addEventListener("resize", function () { drawOverlay(); });

// ---------- export ----------
// An export renders with EXACT grades only and waits until every one it needs has landed. The fast
// preview (the grade at half size) is never shipped: it softens the matte edges and the grit. A
// grade that FAILS (a worker out of memory) is run once more, then once more on a smaller working
// size; if it still fails the export is REFUSED with the slot's name - it never resolves with the
// editor's preview, an ungraded image or a render-error banner in its place. Before rendering it
// waits for a cut-out still running (the uncut photo would ship as a rectangle) and for a UFC
// master still downloading (the small preview copy would be graded and shipped), and a quote
// template whose quote is still the sample refuses (a made-up line must never ship under a real
// fighter's name).
var upgrading = {};
function settle(ps, ms) {
  var tm = 0, all = Promise.all(ps.map(function (q) { return q.then(function () { }, function () { }); }));
  return Promise.race([all, new Promise(function (r) { tm = setTimeout(r, ms); })]).then(function () { clearTimeout(tm); });
}
function waitSources() {
  var cuts = Object.keys(cutBusy).map(function (k) { return cutBusy[k]; });
  var ups = Object.keys(upgrading).map(function (k) { return upgrading[k]; });
  var p = Promise.resolve();
  if (cuts.length) { exportNote("Waiting for the cut-out to finish..."); p = settle(cuts, 90000); }
  return p.then(function () {
    ups = Object.keys(upgrading).map(function (k) { return upgrading[k]; });
    if (!ups.length) return null;
    exportNote("Fetching the full-size cut-out...");
    return settle(ups, 120000);
  });
}
function waitKeys(keys) {
  return Promise.all(keys.map(function (k) {
    if (k.indexOf("tex:") === 0) return plateWait[k.slice(4)] || Promise.resolve();
    return jobsDone([k]);
  }));
}
function mustEditMsg(t) {
  var need = t.mustEdit || [], o = doc.text[t.id] || {};
  for (var i = 0; i < need.length; i++) {
    if (o[need[i]] == null) {
      var f = fieldOf(t, need[i]);
      return "Type the real " + (f ? f.label.toLowerCase() : need[i]) + " first: the sample text is not exported.";
    }
  }
  return "";
}
function joinNames(ls) {
  var u = [];
  ls.forEach(function (l) { if (l && u.indexOf(l) === -1) u.push(l); });
  if (!u.length) return "an image";
  return u.length === 1 ? u[0] : u.slice(0, -1).join(", ") + " and " + u[u.length - 1];
}
function exportCanvas(id) {
  var t = TPL[id || doc.tpl], t0 = Date.now(), tries = 0, retried = {}, capK = 1;
  var bad = mustEditMsg(t);
  if (bad) return Promise.reject(new Error(bad));
  return waitSources().then(function () {
    return new Promise(function (res, rej) {
      (function attempt() {
        var sw = W, sh = H, sR = R;
        W = 1080; H = cv.height;
        var c = mkCanvas(1080, cv.height), out;
        try { out = renderTo(c.getContext("2d"), t, { editor: false, exact: true, capK: capK }); }
        finally { W = sw; H = sh; R = sR; }
        if (out.error) { exportNote(""); rej(new Error("The poster could not be drawn (" + out.error + "). Nothing was exported.")); return; }
        if (out.failed.length) {
          var again = out.failed.filter(function (k) { return (retried[k] || 0) < 2; });
          if (!again.length) {
            exportNote("");
            rej(new Error("The full-quality grade failed for " + joinNames(out.failedLabels) + ". Nothing was exported. Try again, or use a smaller photo."));
            return;
          }
          again.forEach(function (k) {
            retried[k] = (retried[k] || 0) + 1;
            // the second retry grades the big subjects on a smaller working size
            if (retried[k] === 2) capK = 0.6;
            if (k.indexOf("tex:") === 0) { var nm = k.slice(4); plateImg[nm] = undefined; plateTries[nm] = 0; plate(nm); }
            else { delete JOBS[k]; delete jobFails[k]; }
          });
          exportNote("A full-quality grade failed; trying it again...");
          setTimeout(attempt, 30);
          return;
        }
        if (!out.pending.length) { exportNote(""); res(c); return; }
        if (Date.now() - t0 > 240000 || ++tries > 40) { exportNote(""); rej(new Error("The full-quality grade did not finish. Nothing was exported. Try again.")); return; }
        exportNote("Finishing the full-quality grade before the export (" + out.pending.length + " left)...");
        waitKeys(out.pending).then(attempt);
      })();
    });
  }).then(function (c) { return c; }, function (e) { exportNote(""); throw e; });
}
function exportBlob(id) {
  return exportCanvas(id).then(function (c) {
    return new Promise(function (res, rej) { c.toBlob(function (b) { if (b) res(b); else rej(new Error("Could not make the PNG")); }, "image/png"); });
  });
}
// the export's own status stays on the note while it waits (the editor's grading status would
// otherwise overwrite it as each job lands)
var exportMsg = "";
function exportNote(msg) {
  exportMsg = msg || "";
  var n = $("gradeNote");
  if (!n) return;
  if (msg) { n.textContent = msg; n.hidden = false; } else updateGradeNote();
}
function stamp() { var d = new Date(); return d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2) + "-" + ("0" + d.getDate()).slice(-2); }
// the template is captured at the CLICK: switching templates while the grade finishes neither
// renames the file nor changes what it shows
$("dlBtn").addEventListener("click", function () {
  var b0 = this, id0 = doc.tpl;
  b0.disabled = true;
  exportBlob(id0).then(function (b) {
    var a = document.createElement("a"), u = URL.createObjectURL(b);
    a.href = u; a.download = id0 + "-" + stamp() + ".png";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(u); }, 5000);
    toast("PNG downloaded (1080 x " + cv.height + ")");
  }).catch(toastErr).then(function () { b0.disabled = false; });
});
$("copyBtn").addEventListener("click", function () {
  if (!navigator.clipboard || !window.ClipboardItem) { toast("This browser cannot copy images. Use Download PNG."); return; }
  var b0 = this, p = exportBlob(doc.tpl);
  b0.disabled = true;
  // the clipboard item takes the PROMISE, so the copy keeps the click's permission while the
  // exact grade finishes
  var done;
  try { done = navigator.clipboard.write([new ClipboardItem({ "image/png": p })]); }
  catch (e) { done = p.then(function (b) { return navigator.clipboard.write([new ClipboardItem({ "image/png": b })]); }); }
  done.then(function () { toast("Copied. Paste it anywhere."); }, function (e) {
    p.catch(function (e2) { return e2; }).then(function (e2) {
      var m = e2 && e2.message ? e2.message : e && e.message ? e.message : "";
      toast(/grade|PNG|exported|first|drawn/.test(m) ? m : "Copy was blocked. Use Download PNG.");
    });
  }).then(function () { b0.disabled = false; });
});
$("undoBtn").addEventListener("click", undo);
$("redoBtn").addEventListener("click", redo);
var segs = $("sizeSeg").querySelectorAll("button");
function markSize() { for (var i = 0; i < segs.length; i++) segs[i].setAttribute("aria-pressed", segs[i].getAttribute("data-size") === doc.size ? "true" : "false"); }
for (var si = 0; si < segs.length; si++) {
  segs[si].addEventListener("click", function () { doc.size = this.getAttribute("data-size"); markSize(); dropCaches(); applySize(); commit(); });
}

// ---------- boot ----------
function fontsReady() {
  if (!document.fonts || !document.fonts.load) return Promise.resolve();
  var fs = ["400 100px Anton", "800 100px 'Barlow Condensed'", "700 100px 'Barlow Condensed'", "600 100px 'Barlow Condensed'", "700 100px Poppins", "800 100px Poppins"];
  return Promise.all(fs.map(function (f) { return document.fonts.load(f).catch(function () { }); }));
}
var TOUCH = (function () { try { return !!(window.matchMedia && window.matchMedia("(pointer: coarse)").matches); } catch (e) { return false; } })();
function boot() {
  try {
    if (TOUCH) {
      $("tip").textContent = "Tap Pick on an image row to add a photo (a photo on a fighter is cut out for you). On the poster: drag to move, pinch to zoom, double-tap to reset. Tap a word under a text box to color it.";
    }
  } catch (e) { }
  var saved = lsGet(DOC_KEY), parsed = null;
  try { parsed = saved ? JSON.parse(saved) : null; } catch (e) { parsed = null; }
  doc = mergeDoc(parsed);
  applySize(); W = 1080; H = cv.height;
  buildGallery(); buildInspector(); markSize();
  hist = [snap()]; hix = 0; updateUndo();
  requestRender(true);
  fontsReady().then(function () { measureCaps(); vcMaskCache = {}; vcMaskKeys = []; dropCaches(); fxEpoch++; requestRender(true); });
  ["tape1", "haze", "crowd", "arena", "concrete"].forEach(plate);
  idbOpen().then(restoreAssets).then(function () { dropCaches(); requestRender(true); refreshInspector(); adoptCuts(); });
  // the bout list needs the card; the doc keeps only the event, so re-read it quietly
  if (doc.ev && doc.ev.slug) {
    api("/studio/api/ufcevent/" + encodeURIComponent(doc.ev.slug)).then(function (ev) { evCard = normalizeEvent(ev); fillBoutSelect(); }).catch(function () { });
  }
  loadEvents().then(function (list) {
    if (parsed || !list.length || window.__postersNoAuto) return;
    var pick = list.filter(function (e) { return /^UFC [0-9]/.test(e.title); })[0] || list[0];
    loadEvent(pick.slug, true).catch(toastErr);
  });
}
// the debug / test hook (the local harness drives the page through it)
window.__posters = {
  doc: function () { return doc; }, render: function () { requestRender(true); }, place: placeFiles, tpl: setTpl,
  // the export itself: exact grades only, waits for them
  png: function (id) { return exportBlob(id); },
  // what the editor shows right now (fast previews included), for timing the preview
  shot: function () { return new Promise(function (res) { cv.toBlob(res, "image/png"); }); },
  ids: function () { return TPLS.map(function (t) { return t.id; }); },
  assets: function () { return assets; },
  // load an image URL into a slot ("hero"), a card ("card:2"), a tile ("tile:0") or a fighter's
  // data source ("A.body", "A.head", "A.opp0"); meta: { name, ufc }
  load: function (target, url, meta) {
    meta = meta || {};
    return assetFromUrl(url, { name: meta.name || url.split("/").pop(), ufc: meta.ufc }).then(function (a) {
      var pr = String(target).split(".");
      if (pr.length === 2 && (pr[0] === "A" || pr[0] === "B")) {
        var P = doc.people[pr[0]] || (doc.people[pr[0]] = { name: meta.person || "", first: "", last: "", fights: [], opps: [] });
        if (meta.person) { var nm = splitName(meta.person); P.name = meta.person; P.first = nm.first; P.last = nm.last; }
        if (pr[1].indexOf("opp") === 0) { P.opps = P.opps || []; P.opps[Number(pr[1].slice(3)) || 0] = a.key; } else P[pr[1]] = a.key;
      } else if (/^card:/.test(target)) setCard(Number(target.split(":")[1]), a.key, meta.name || null);
      else if (/^tile:/.test(target)) setTile(Number(target.split(":")[1]), a.key);
      else { setSlot(target, a.key); delete doc.frames[sk(target)]; }
      dropCaches(); commit(); refreshInspector();
      return a.key;
    });
  },
  set: function (k, v) {
    if (k === "theme") doc.theme = v; else if (k === "look") doc.lookBy[doc.tpl] = v; else if (k === "ground") doc.ground = v;
    else if (k === "size") { doc.size = v; markSize(); applySize(); } else if (k === "cards") doc.cardsN = v;
    else if (k === "text") doc.text[doc.tpl] = Object.assign(doc.text[doc.tpl] || {}, v);
    else if (k === "frame") Object.assign(frameOf(v.id), v.f);
    else if (k === "fx") Object.assign(doc.fx, v);
    dropCaches(); commit(); refreshInspector();
  },
  // remember url as the cut-out of the image in target (what a finished Cut out records)
  link: function (target, url) {
    var a = assetOf(target);
    return assetFromUrl(url, { name: "cut-out" }).then(function (c) { doc.meta[a.key] = Object.assign({}, doc.meta[a.key] || {}, { cut: c.key }); dropCaches(); commit(); return c.key; });
  },
  // the photo card's crop anchor: the face centre x and the crop's top in photo px
  cutbox: function () {
    var a = assetOf("photo"), c = a && cutOf(a);
    if (!c || !c.fbox) return null;
    var sx = a.w / c.w, fb = c.fbox;
    return [(fb[0] + fb[2] / 2) * sx, Math.max(0, fb[1] * sx - 0.35 * fb[3] * sx)];
  },
  cut: function (target) { var a = assetOf(target); return a ? cutInto({ id: target, kind: (slotDef(TPL[doc.tpl], target) || {}).kind || "cut", tpl: doc.tpl }, a, (slotDef(TPL[doc.tpl], target) || {}).need || "cut") : Promise.resolve(null); },
  idle: function () {
    return new Promise(function (res) {
      (function chk() {
        if (!jobsPending() && !rafId) { res(true); return; }
        var ks = Object.keys(JOBS).filter(function (k) { return JOBS[k].st === "pend"; });
        jobsDone(ks).then(function () { setTimeout(chk, 60); });
      })();
    });
  },
  state: function () { return { pending: jobsPending(), queued: GW.queue.length, workers: GW.pool.length, max: GW.max, broken: GW.broken, stats: jobStats, fx: fxStats, lowMem: LOW_MEM }; },
  // the editor's composition cache on / off (the harness compares both renders pixel for pixel)
  fxOn: function (on) { fxOn = !!on; fxDrop(); requestRender(); return fxOn; },
  adapt: function (o) { SKIN_ADAPT = o || null; dropCaches(); requestRender(true); return SKIN_ADAPT; },
  jobs: function () { return Object.keys(JOBS).map(function (k) { return [k, JOBS[k].st]; }); }
};
boot();
})();
</script>
</body>
</html>`;
