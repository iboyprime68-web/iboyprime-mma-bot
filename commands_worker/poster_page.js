// poster_page.js - the poster TEMPLATES page, served by the Worker on GET /studio/templates
// behind the same session gate as /studio (worker.js imports POSTER_HTML).
//
// Everything is drawn client-side on a 1080-wide canvas: no AI, no server render. A
// template is a declarative list of slots (photo, cut-out, circle, tiles), text fields
// and lists, plus a draw() that composes them with a shared toolkit: cover framing with
// pan/zoom, an ADAPTIVE colour grade that measures every image and grades it into the
// scene (see "the grade"), a painted edge light on cut-outs computed from the template's
// light positions (inside the silhouette only, on the side facing a light - never an
// outline halo), directional modelling, a ground fade, a defringe for studio mattes,
// torn tape, gradient display type with tap-to-highlight words, grain and vignette. The owner drags images onto the poster (they snap to the slot under the
// pointer), types a name to pull the UFC.com cut-out, record, bio and fight history, or
// picks an event and a bout to fill every fight-week template at once.
//
// API contracts (all same-origin, all behind the session gate):
//   GET /studio/api/ufcevents            -> [{slug, title, headline, ts}]
//   GET /studio/api/ufcevent/<slug>      -> {title, headline, ts, venue, fights: [{cls, card,
//                                            red: {first, last, slug, img, face, rank}, blue}]}
//   GET /studio/api/ufc/<slug>?n=<0-15>  -> {name, nickname, division, record, tags, body,
//                                            face, head, bio, method, stats, rates, fights}
//   GET /studio/api/ufcimg?p=&k=         -> a cut-out PNG
//   GET /studio/bg/<arena|spotlight|cage|smoke>, /studio/tpl/<name>.jpg|png -> plates
//
// Source rules (the studio_page.js rules): this whole page is ONE template literal, so the
// page code carries NO backslash, NO backtick and no dollar-brace at all. Special glyphs
// come from String.fromCharCode or HTML entities, regex classes are spelled [0-9] and
// [ ], and newlines are NL. ASCII only. No logo and no channel name on any poster.
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
.slot .ops{display:flex;gap:5px}
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
  .stage{padding:12px 10px 16px}
  .cwrap{max-width:100%}
  .top{flex-wrap:wrap;gap:8px}
  .acts{width:100%}
  .acts .btn.pri{margin-left:auto}
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
    <p class="tip" id="tip">Drop photos or cut-outs onto the poster: each one snaps into the slot under the pointer.
      Drag to move, scroll or pinch to zoom, double-click to reset. Tap a word under a text box to color it.</p>
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
  toastT = setTimeout(function () { t.classList.remove("on"); }, 2600);
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

// Themes. Ember (orange into yellow) is the default: the owner chose it over the brand
// purple after seeing both (Sept 25 2026). hi/a/lo are the three stops of accent type,
// glow is the light color the scene and the painted edge light use, ink is text on an
// accent plate, tint is the dark the background leans toward.
// NEVER a red-versus-blue scheme anywhere (owner law, Sept 25 2026).
var THEMES = [
  { id: "ember",   name: "Ember",   a: "#FF8A1F", hi: "#FFC24D", lo: "#F0560C", glow: "#FF9A45", ink: "#1C0B02", tint: "#140B06" },
  { id: "gold",    name: "Gold",    a: "#F7B530", hi: "#FFE08A", lo: "#D98A00", glow: "#FFC45A", ink: "#1C1302", tint: "#141006" },
  { id: "crimson", name: "Crimson", a: "#F2303F", hi: "#FF8A7A", lo: "#B80C20", glow: "#FF5A48", ink: "#1C0306", tint: "#150607" },
  { id: "violet",  name: "Violet",  a: "#8C5CFF", hi: "#C9B2FF", lo: "#5B2BE8", glow: "#A57BFF", ink: "#0E0620", tint: "#100A1C" },
  { id: "ice",     name: "Ice",     a: "#3AA8FF", hi: "#A9DCFF", lo: "#1A58F0", glow: "#6CC0FF", ink: "#03101E", tint: "#070D16" },
  { id: "toxic",   name: "Toxic",   a: "#3DF07E", hi: "#B4FFCB", lo: "#0DA84A", glow: "#7CFFA6", ink: "#03160A", tint: "#07110A" },
  { id: "mono",    name: "Mono",    a: "#EDEDF3", hi: "#FFFFFF", lo: "#B4B4C2", glow: "#FFF1E0", ink: "#0B0B0F", tint: "#0D0D10" }
];
function themeById(id) { for (var i = 0; i < THEMES.length; i++) if (THEMES[i].id === id) return THEMES[i]; return THEMES[0]; }

// ---------- the grade ----------
// Every photo and cut-out is graded INTO the poster's scene by one adaptive recipe, so a
// bright flat UFC studio shot and a dark arena photo land at the same place:
//   1. measure the subject (luminance percentiles and mean chroma over opaque pixels)
//   2. levels + gamma so its median sits at the look's target, then an S-curve and a
//      small black crush - on LUMINANCE only, rgb scaled by the ratio, so a contrast push
//      never inflates saturation (the per-channel version turned skin orange)
//   3. saturation set from the measured chroma, so every fighter ends equally colorful
//   4. split tone: shadows toward a dark complement of the scene light, highlights a
//      touch toward the light itself
// Designed by eye on real cut-outs (scratchpad gradelab.py) before it was written here.
// Placement adds the rest per poster: directional shading, the painted edge light and
// the ground fade (drawCut).
var LOOKS = [
  { id: "scene",   name: "Scene",   target: 0.35, con: 0.34, chroma: 0.17, keyA: 0.06, shadeA: 0.28, crush: 0.04 },
  { id: "punch",   name: "Punchy",  target: 0.36, con: 0.42, chroma: 0.19, keyA: 0.05, shadeA: 0.22, crush: 0.05 },
  { id: "natural", name: "Natural", target: 0.40, con: 0.18, chroma: 0.21, keyA: 0.03, shadeA: 0.12, crush: 0.02 },
  { id: "dark",    name: "Dark",    target: 0.27, con: 0.44, chroma: 0.11, keyA: 0.07, shadeA: 0.34, crush: 0.06 },
  { id: "noir",    name: "Noir",    target: 0.32, con: 0.46, chroma: 0.0,  keyA: 0.0,  shadeA: 0.0,  crush: 0.05, mono: 1 }
];
function lookById(id) { for (var i = 0; i < LOOKS.length; i++) if (LOOKS[i].id === id) return LOOKS[i]; return LOOKS[0]; }
var NOIR = lookById("noir");
// head-and-shoulders tiles sit on a bright accent plate, so they are graded lighter and flatter
var TILE_LOOK = { id: "tile", name: "Tile", target: 0.5, con: 0.14, chroma: 0.2, keyA: 0.03, shadeA: 0.05, crush: 0.02 };
// the scene light (highlight tint) and its dark complement (shadow tint) for a theme
function gradeTones(th) {
  var c = hexRgb(th.glow), key = hexRgb(mix(th.glow, "#FFFFFF", 0.55));
  var comp = [255 - c[0], 255 - c[1], 255 - c[2]], shade = [comp[0] * 0.1 + 6, comp[1] * 0.1 + 8, comp[2] * 0.1 + 12];
  return { key: key, shade: shade };
}

// ---------- assets ----------
// Every image is copied into a canvas capped at MAX_SIDE (a UFC master is 1350x3324), then
// analysed once: is it a cut-out (transparent border), where is its alpha box, and where
// is the HEAD (topmost blob, measured row by row until the span jumps to shoulder width).
// Slots place cut-outs by the head, so any fighter PNG lands at the same size and spot.
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
  a.head = null; a.box = null;
  if (!a.cut) return;
  defringe(a.img);
  var rows = new Array(h), x0 = w, x1 = -1, y0 = h, y1 = -1;
  for (y = 0; y < h; y++) {
    var L = -1, R = -1, o = y * w * 4;
    for (xx = 0; xx < w; xx++) if (d[o + xx * 4 + 3] > 110) { if (L < 0) L = xx; R = xx; }
    if (L >= 0) { rows[y] = [L, R]; if (L < x0) x0 = L; if (R > x1) x1 = R; if (y < y0) y0 = y; y1 = y; }
  }
  if (y1 < 0) { a.cut = false; return; }
  a.box = { x: x0 / sc, y: y0 / sc, w: (x1 - x0 + 1) / sc, h: (y1 - y0 + 1) / sc };
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
}
function defringe(c) {
  var x = c.getContext("2d", { willReadFrequently: true }), id = x.getImageData(0, 0, c.width, c.height), d = id.data;
  for (var i = 3; i < d.length; i += 4) {
    var al = d[i];
    if (al === 255 || al === 0) continue;
    if (al < 24) { d[i] = 0; continue; }
    var t = al / 255, k = 0.45 + 0.55 * t;
    d[i - 3] = d[i - 3] * k; d[i - 2] = d[i - 2] * k; d[i - 1] = d[i - 1] * k;
    d[i] = Math.round(255 * clamp((t - 0.09) / 0.91, 0, 1));
  }
  x.putImageData(id, 0, 0);
}
function makeAsset(im, meta) {
  var iw = im.naturalWidth || im.width, ih = im.naturalHeight || im.height;
  var s = Math.min(1, MAX_SIDE / Math.max(iw, ih));
  var c = mkCanvas(iw * s, ih * s);
  c.getContext("2d").drawImage(im, 0, 0, c.width, c.height);
  var a = { key: (meta && meta.key) || newKey(), img: c, w: c.width, h: c.height, face: (meta && meta.face) || "",
            src: (meta && meta.src) || "", name: (meta && meta.name) || "", graded: {} };
  analyse(a);
  assets[a.key] = a;
  return a;
}
// the grade applied to one image, cached per look + theme + strength (a master is ~60 ms)
function gradedOf(a, look, amt) {
  if (!a) return null;
  var th = themeById(doc.theme), k = look.id + ":" + th.id + ":" + Math.round(amt * 20);
  if (a.graded[k]) return a.graded[k];
  var c = mkCanvas(a.w, a.h), x = c.getContext("2d", { willReadFrequently: true });
  x.drawImage(a.img, 0, 0);
  if (amt > 0.01) {
    var id = x.getImageData(0, 0, c.width, c.height);
    gradePixels(id.data, look, amt, gradeTones(th));
    x.putImageData(id, 0, 0);
  }
  var ks = Object.keys(a.graded);
  if (ks.length > 3) delete a.graded[ks[0]];
  a.graded[k] = c;
  return c;
}
function gradePixels(d, L, amt, tones) {
  var i, n = d.length, hist = new Uint32Array(256), cs = 0, cn = 0;
  for (i = 0; i < n; i += 16) {
    if (d[i + 3] < 128) continue;
    var r0 = d[i], g0 = d[i + 1], b0 = d[i + 2];
    hist[Math.round(0.2126 * r0 + 0.7152 * g0 + 0.0722 * b0)]++;
    cs += Math.max(r0, g0, b0) - Math.min(r0, g0, b0); cn++;
  }
  if (!cn) return;
  function pct(q) { var t = cn * q, acc = 0; for (var v = 0; v < 256; v++) { acc += hist[v]; if (acc >= t) return v / 255; } return 1; }
  var lo = pct(0.02), med = pct(0.5), hi = Math.max(lo + 0.05, pct(0.98));
  var medn = clamp((med - lo) / (hi - lo), 0.05, 0.95), gam = Math.log(L.target) / Math.log(medn);
  var lut = new Float32Array(256);
  for (i = 0; i < 256; i++) {
    var v = Math.pow(clamp((i / 255 - lo) / (hi - lo), 0, 1), gam);
    var sm = v * v * (3 - 2 * v);
    v = v + (sm - v) * L.con * 2;
    lut[i] = clamp((v - L.crush) / (1 - L.crush), 0, 1) * 255;
  }
  var sat = L.mono ? 0 : clamp(L.chroma / Math.max(1, cs / cn / 255), 0.5, 0.95);
  var key = tones.key, sh = tones.shade, kA = L.keyA, sA = L.shadeA;
  for (i = 0; i < n; i += 4) {
    if (d[i + 3] === 0) continue;
    var r = d[i], g = d[i + 1], b = d[i + 2];
    var l = 0.2126 * r + 0.7152 * g + 0.0722 * b, l2 = lut[Math.round(l)], q = l2 / Math.max(1, l);
    var R = r * q, G = g * q, B = b * q;
    var lm = 0.2126 * R + 0.7152 * G + 0.0722 * B;
    R = lm + (R - lm) * sat; G = lm + (G - lm) * sat; B = lm + (B - lm) * sat;
    var ln = clamp(lm / 255, 0, 1), ws = (1 - ln) * (1 - ln) * sA, wh = ln * ln * kA;
    R += (sh[0] - R) * ws; G += (sh[1] - G) * ws; B += (sh[2] - B) * ws;
    R += (key[0] - R) * wh; G += (key[1] - G) * wh; B += (key[2] - B) * wh;
    d[i] = r + (R - r) * amt; d[i + 1] = g + (G - g) * amt; d[i + 2] = b + (B - b) * amt;
  }
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
var plateImg = {};
function plate(name) {
  var v = plateImg[name];
  if (v) return v;
  if (v === undefined && PLATES[name]) {
    plateImg[name] = null;
    fetchBlob(PLATES[name]).then(blobToImage).then(function (im) {
      var c = mkCanvas(im.naturalWidth, im.naturalHeight);
      c.getContext("2d").drawImage(im, 0, 0);
      plateImg[name] = c;
      tintCache = {};
      requestRender(true);
    }).catch(function () { plateImg[name] = false; });
  }
  return null;
}
// a plate cover-fitted to w x h and duotoned black -> color (multiply), cached
var tintCache = {};
function tinted(name, col, w, h, focusY) {
  var im = plate(name);
  if (!im) return null;
  var k = name + "|" + col + "|" + Math.round(w) + "x" + Math.round(h) + "|" + (focusY == null ? 0.5 : focusY);
  if (tintCache[k]) return tintCache[k];
  var c = mkCanvas(w, h), x = c.getContext("2d");
  var s = Math.max(w / im.width, h / im.height), dw = im.width * s, dh = im.height * s;
  x.drawImage(im, (w - dw) / 2, (h - dh) * (focusY == null ? 0.5 : focusY), dw, dh);
  if (col) { x.globalCompositeOperation = "multiply"; x.fillStyle = col; x.fillRect(0, 0, w, h); }
  var ks = Object.keys(tintCache);
  if (ks.length > 40) delete tintCache[ks[0]];
  tintCache[k] = c;
  return c;
}
function drawPlate(name, o) {
  o = o || {};
  var r = o.rect || [0, 0, W, H];
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
function assetOf(id) { var k = doc.slots[id]; return k && assets[k] ? assets[k] : null; }
function frameOf(id) {
  var f = doc.frames[id];
  if (!f) { f = { x: 0, y: 0, s: 1, flip: false }; doc.frames[id] = f; }
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
function drawPhoto(id, rect, o) {
  o = o || {};
  hit(id, "photo", { r: rect }, o.label);
  var a = assetOf(id);
  if (!a) { if (!o.quiet) phPhoto(rect, o.label || "Drop a photo"); return false; }
  var look = o.mono ? NOIR : lookById(doc.look);
  var src = gradedOf(a, look, o.lookAmt == null ? doc.lookAmt : o.lookAmt);
  var f = frameOf(id);
  var sc = Math.max(rect[2] / a.w, rect[3] / a.h) * Math.max(1, f.s);
  var dw = a.w * sc, dh = a.h * sc;
  var bx = rect[0] + (rect[2] - dw) * (o.fx == null ? 0.5 : o.fx), by = rect[1] + (rect[3] - dh) * (o.fy == null ? 0.3 : o.fy);
  var dx = clamp(bx + f.x, rect[0] + rect[2] - dw, rect[0]), dy = clamp(by + f.y, rect[1] + rect[3] - dh, rect[1]);
  R.place[id] = { kind: "photo", rect: rect, bx: bx, by: by, dw: dw, dh: dh };
  g.save();
  g.beginPath(); g.rect(rect[0], rect[1], rect[2], rect[3]); g.clip();
  if (f.flip) { g.translate(dx + dw / 2, 0); g.scale(-1, 1); g.translate(-(dx + dw / 2), 0); }
  g.drawImage(src, dx, dy, dw, dh);
  g.restore();
  if (o.dim) { g.fillStyle = "rgba(0,0,0," + o.dim + ")"; g.fillRect(rect[0], rect[1], rect[2], rect[3]); }
  return true;
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
var cutCache = {};
// o: { lights, rim (0-2), shade (0-2), fade [from, to, depth] or false, expose, clip, look }
function drawCut(id, spec, o) {
  o = o || {};
  var a = assetOf(id);
  if (!a) { phFighter(spec, o.label || "Drop a fighter"); hitFighterGuess(id, spec, o.label); return null; }
  if (!a.cut || !a.head) {
    var hw0 = spec.head[2] * W, bw = hw0 * 3.4, bh = bw * 1.25;
    var rect = spec.box || [spec.head[0] * W - bw / 2, spec.head[1] * H - hw0 * 0.9, bw, bh];
    drawPhoto(id, rect, { label: o.label, fy: 0.25 });
    return null;
  }
  var f = frameOf(id), P = cutPlacement(a, spec, f);
  var lights = o.lights || R.lights, look = o.look ? lookById(o.look) : lookById(doc.look);
  var rimK = 2.3 * (o.rim == null ? 1 : o.rim) * doc.fx.rim;
  var shade = 0.55 * (o.shade == null ? 1 : o.shade) * doc.fx.shade;
  var fade = o.fade === false ? null : (o.fade || [0.55, 0.96, 0.88]), fk = doc.fx.fade == null ? 1 : doc.fx.fade;
  var clip = o.clip || null;
  var key = [a.key, a.w, Math.round(P.dx), Math.round(P.dy), Math.round(P.dw), P.flip ? 1 : 0, doc.look, doc.lookAmt, doc.theme,
             rimK.toFixed(2), shade.toFixed(2), fade ? fade.join(",") + ":" + fk : "-", JSON.stringify(lights), clip ? clip.join(",") : "", W, H,
             o.expose || 0].join("|");
  var cc = cutCache[id + "@" + R.tag];
  if (!cc || cc.key !== key) {
    var L = layerCanvas(R.thumb ? 2 : 0), x = L.getContext("2d");
    if (clip) { x.save(); x.beginPath(); x.rect(clip[0], clip[1], clip[2], clip[3]); x.clip(); }
    var src = gradedOf(a, look, doc.lookAmt);
    if (P.flip) { x.save(); x.translate(P.dx + P.dw, P.dy); x.scale(-1, 1); x.drawImage(src, 0, 0, P.dw, P.dh); x.restore(); }
    else x.drawImage(src, P.dx, P.dy, P.dw, P.dh);
    if (clip) x.restore();
    var ab = a.box, bx0 = P.flip ? P.dx + (a.w - ab.x - ab.w) * P.sc : P.dx + ab.x * P.sc, by0 = P.dy + ab.y * P.sc;
    var vb = [bx0, by0, ab.w * P.sc, ab.h * P.sc];
    var lim = clip || [0, 0, W, H];
    var X0 = Math.max(vb[0], lim[0], 0), Y0 = Math.max(vb[1], lim[1], 0);
    var X1 = Math.min(vb[0] + vb[2], lim[0] + lim[2], W), Y1 = Math.min(vb[1] + vb[3], lim[1] + lim[3], H);
    vb = [X0, Y0, Math.max(0, X1 - X0), Math.max(0, Y1 - Y0)];
    var keep = mkCanvas(W, H);
    keep.getContext("2d").drawImage(L, 0, 0);
    if (o.expose) { x.globalCompositeOperation = "source-atop"; x.fillStyle = o.expose < 0 ? "rgba(0,0,0," + (-o.expose) + ")" : "rgba(255,255,255," + o.expose + ")"; x.fillRect(0, 0, W, H); }
    // modelling: the side away from the light centroid falls off into shadow
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
    // the ground fade: the lower body sinks into the scene
    if (fade && fk > 0.01) {
      var fg = x.createLinearGradient(0, fade[0] * H, 0, fade[1] * H), dp = Math.min(1, fade[2] * fk);
      fg.addColorStop(0, "rgba(0,0,0,0)"); fg.addColorStop(0.5, "rgba(0,0,0," + (dp * 0.5) + ")"); fg.addColorStop(1, "rgba(0,0,0," + dp + ")");
      x.globalCompositeOperation = "source-atop"; x.fillStyle = fg; x.fillRect(0, 0, W, H);
    }
    x.globalCompositeOperation = "source-over";
    var el0 = rimK > 0.01 && vb[2] > 2 && vb[3] > 2 ? edgeLight(L, vb, lights, P.hw, rimK) : null;
    if (el0) {
      x.globalCompositeOperation = "screen"; x.drawImage(el0.c, el0.x, el0.y, el0.w, el0.h);
      x.globalCompositeOperation = "destination-in"; x.drawImage(keep, 0, 0);
      x.globalCompositeOperation = "source-over";
    }
    var fin = mkCanvas(W, H);
    fin.getContext("2d").drawImage(L, 0, 0);
    cc = { key: key, layer: fin, vb: vb, P: P };
    cutCache[id + "@" + R.tag] = cc;
  }
  g.drawImage(cc.layer, 0, 0);
  R.place[id] = { kind: "cut", P: cc.P, spec: spec };
  hit(id, "cut", { r: cc.vb }, o.label);
  return cc;
}
function hitFighterGuess(id, spec, label) {
  var hw = spec.head[2] * W;
  hit(id, "cut", { r: [spec.head[0] * W - hw * 1.7, spec.head[1] * H - hw * 0.8, hw * 3.4, hw * 4.2] }, label);
}

// ---------- circle inset ----------
function drawCircle(id, cx, cy, r, o) {
  o = o || {};
  hit(id, "circle", { c: [cx, cy, r] }, o.label);
  var p = R.pal, a = assetOf(id);
  g.save();
  if (o.glow !== false) {
    var gr = g.createRadialGradient(cx, cy, r * 0.85, cx, cy, r * 1.55);
    gr.addColorStop(0, rgba(lightCol("a"), 0.22 * doc.fx.glow)); gr.addColorStop(1, rgba(lightCol("a"), 0));
    g.globalCompositeOperation = "screen"; g.fillStyle = gr; g.fillRect(cx - r * 1.6, cy - r * 1.6, r * 3.2, r * 3.2);
    g.globalCompositeOperation = "source-over";
  }
  g.shadowColor = "rgba(0,0,0,.6)"; g.shadowBlur = r * 0.3; g.shadowOffsetY = r * 0.06;
  g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fillStyle = "#0B0B10"; g.fill();
  g.restore();
  g.save();
  g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.clip();
  var bg = g.createLinearGradient(0, cy - r, 0, cy + r);
  bg.addColorStop(0, mix(p.tint, p.a, 0.30)); bg.addColorStop(1, mix(p.tint, "#000000", 0.4));
  g.fillStyle = bg; g.fillRect(cx - r, cy - r, 2 * r, 2 * r);
  if (a && a.cut && a.head) {
    // a head-and-shoulders bust fills the circle by its width and sits on the bottom edge;
    // a full-body cut-out is framed on the face
    var f = frameOf(id), flip = !!f.flip, bust = a.box && a.box.h / a.box.w < 1.25, sc, dx, dy;
    var hcx = flip ? a.w - a.head.cx : a.head.cx;
    if (bust) {
      sc = (r * 2 * 1.02 * f.s) / a.box.w;
      dx = cx + f.x - hcx * sc;
      dy = cy + r * 1.02 + f.y - (a.box.y + a.box.h) * sc;
    } else {
      sc = (r * 2 * 0.3 * f.s) / a.head.w;
      dx = cx + f.x - hcx * sc;
      dy = cy - r * 0.08 + f.y - a.head.cy * sc;
    }
    var src = gradedOf(a, lookById(doc.look), doc.lookAmt);
    if (flip) { g.translate(dx + a.w * sc, dy); g.scale(-1, 1); g.drawImage(src, 0, 0, a.w * sc, a.h * sc); }
    else g.drawImage(src, dx, dy, a.w * sc, a.h * sc);
    R.place[id] = { kind: "circle", cut: true };
  } else if (a) {
    g.restore(); g.save();
    g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.clip();
    drawPhoto(id, [cx - r, cy - r, 2 * r, 2 * r], { quiet: true, fy: 0.3 });
    R.hits.pop();
  } else if (R.editor) {
    g.fillStyle = "rgba(255,255,255,.07)";
    g.beginPath(); g.arc(cx, cy - r * 0.18, r * 0.3, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.ellipse(cx, cy + r * 0.72, r * 0.7, r * 0.5, 0, 0, Math.PI * 2); g.fill();
  }
  g.restore();
  var ringW = o.ringW == null ? Math.max(4, r * 0.035) : o.ringW;
  if (ringW > 0) {
    var rg = g.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
    if (o.ring === "white") { rg.addColorStop(0, "#FFFFFF"); rg.addColorStop(1, "#CFCBDA"); }
    else { rg.addColorStop(0, p.hi); rg.addColorStop(0.5, p.a); rg.addColorStop(1, p.lo); }
    g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.lineWidth = ringW; g.strokeStyle = rg; g.stroke();
  }
}

// ---------- tiles (resume grid, card rows) ----------
function tileImage(a, rect, o) {
  o = o || {};
  g.save();
  g.beginPath(); g.rect(rect[0], rect[1], rect[2], rect[3]); g.clip();
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
    var src = gradedOf(a, lookById(doc.look), doc.lookAmt);
    src = gradedOf(a, TILE_LOOK, doc.lookAmt);
    g.shadowColor = "rgba(0,0,0,.35)"; g.shadowBlur = rect[2] * 0.08; g.shadowOffsetY = rect[2] * 0.02;
    if (flip) { g.translate(dx + a.w * sc, dy); g.scale(-1, 1); g.drawImage(src, 0, 0, a.w * sc, a.h * sc); }
    else g.drawImage(src, dx, dy, a.w * sc, a.h * sc);
  } else {
    var s2 = Math.max(rect[2] / a.w, rect[3] / a.h), dw = a.w * s2, dh = a.h * s2;
    g.drawImage(gradedOf(a, lookById(doc.look), doc.lookAmt), rect[0] + (rect[2] - dw) / 2, rect[1] + (rect[3] - dh) * 0.25, dw, dh);
  }
  g.restore();
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
  if (a) tileImage(a, rect, { headW: o.headW || 0.5, headY: o.headY || 0.42 });
  else if (R.editor) {
    g.fillStyle = "rgba(0,0,0,.14)";
    g.beginPath(); g.arc(x + w / 2, y + h * 0.42, w * 0.17, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.ellipse(x + w / 2, y + h * 1.02, w * 0.42, h * 0.36, 0, 0, Math.PI * 2); g.fill();
  }
  var sh = g.createLinearGradient(0, y + h * 0.7, 0, y + h);
  sh.addColorStop(0, "rgba(0,0,0,0)"); sh.addColorStop(1, "rgba(0,0,0,.28)");
  g.fillStyle = sh; g.fillRect(x, y + h * 0.7, w, h * 0.3);
  g.fillStyle = "rgba(255,255,255,.35)"; g.fillRect(x, y, w, Math.max(1, h * 0.012));
  hit("tile:" + idx, "tile", { r: rect }, "Tile " + (idx + 1));
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
var noiseTile = null;
function grainPass() {
  var k = doc.fx.grain;
  if (k <= 0.01) return;
  if (!noiseTile) {
    noiseTile = mkCanvas(220, 220);
    var x = noiseTile.getContext("2d"), id = x.createImageData(220, 220), d = id.data, seed = 7;
    for (var i = 0; i < d.length; i += 4) {
      seed = (seed * 16807) % 2147483647;
      var v = 128 + ((seed % 1000) / 1000 - 0.5) * 150;
      d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255;
    }
    x.putImageData(id, 0, 0);
  }
  g.save();
  g.globalCompositeOperation = "overlay"; g.globalAlpha = 0.16 * k;
  g.fillStyle = g.createPattern(noiseTile, "repeat"); g.fillRect(0, 0, W, H);
  g.restore();
  drawPlate("grunge", { mode: "screen", alpha: 0.5 * k });
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
function fieldDefault(t, f) { return typeof f.def === "function" ? (f.def(D()) || "") : (f.def || ""); }
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
  slots: [{ id: "bg", kind: "photo", label: "Background photo", note: "turns black and white", opt: true },
          { id: "main", kind: "cut", label: "Main fighter", from: "A.body" }],
  fields: [{ id: "title", label: "Title", def: "RESUME" }],
  tiles: { min: 3, max: 12, def: 10, label: "Opponents" },
  lights: [{ x: 0.5, y: 0.1, r: 0.55, k: 0.55, c: "a" }, { x: -0.04, y: 0.36, r: 0.5, k: 0.75, c: "a" }, { x: 1.04, y: 0.36, r: 0.5, k: 0.75, c: "a" }],
  draw: function () {
    var p = R.pal, tall = H > W;
    base();
    if (!drawPhoto("bg", [0, 0, W, H], { mono: true, dim: 0.42, quiet: true, fy: 0.25 })) {
      arena(0.8, 0.3);
      var ga = assetOf("main");
      if (ga && ga.cut && ga.head) {
        var gsrc = gradedOf(ga, NOIR, 1);
        [[0.17, false], [0.83, true]].forEach(function (q) {
          var sc = (W * 0.3) / ga.head.w, hcx = q[1] ? ga.w - ga.head.cx : ga.head.cx;
          var dx = q[0] * W - hcx * sc, dy = H * (tall ? 0.24 : 0.27) - ga.head.cy * sc;
          g.save(); g.globalAlpha = 0.2;
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
  id: "spotlight", name: "Spotlight quote", group: "Quotes", blurb: "Action photo, colored light, glowing inset",
  fighters: ["A", "B"],
  slots: [{ id: "bg", kind: "photo", label: "Action photo", note: "two fighters works best" },
          { id: "inset", kind: "circle", label: "Speaker (circle)", from: "A.head" },
          { id: "left", kind: "cut", label: "Left cut-out", note: "shown when there is no action photo", from: "A.body", opt: true },
          { id: "right", kind: "cut", label: "Right cut-out", note: "shown when there is no action photo", from: "B.body", opt: true }],
  fields: [{ id: "quote", label: "Quote", multi: true, def: "I want the title fight. There's a history there. I was *robbed.*" },
           { id: "attr", label: "Credit line", def: "" }],
  lights: [{ x: -0.03, y: 0.0, r: 0.62, k: 1, c: "a" }, { x: 1.03, y: 0.0, r: 0.62, k: 1, c: "a" },
           { x: -0.06, y: 0.72, r: 0.42, k: 0.6, c: "a" }, { x: 1.06, y: 0.72, r: 0.42, k: 0.6, c: "a" }],
  draw: function () {
    var tall = H > W;
    base("#050507");
    var has = drawPhoto("bg", [0, 0, W, H], { fy: 0.28, label: "Drop an action photo", quiet: !!(assetOf("left") || assetOf("right")) });
    if (!has) drawPlate("crowd", { color: plateCol(), alpha: 0.55, mode: "screen" });
    if (has) lightCatch([0, 0, W, H], R.lights, 0.45);
    // with an action photo the cut-outs stay off unless he dropped one himself
    if (!has || doc.slots.left) drawCut("left", { head: [0.25, tall ? 0.19 : 0.21, 0.15], side: "L" }, { rim: 1.2, label: "Left fighter" });
    if (!has || doc.slots.right) drawCut("right", { head: [0.75, tall ? 0.19 : 0.21, 0.15], side: "R" }, { rim: 1.2, label: "Right fighter" });
    glows(1);
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
    drawCut("left", { head: [0.25, hy, 0.158], side: "L", box: [0, 0, hw, H * 0.72] }, { clip: [0, 0, hw, H], label: "Left fighter" });
    drawCut("right", { head: [0.75, hy, 0.158], side: "R", box: [hw, 0, hw, H * 0.72] }, { clip: [hw, 0, hw, H], label: "Right fighter" });
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
  fields: [{ id: "quote", label: "Quote", multi: true, def: "I believe his streak is *invalid*" },
           { id: "attr", label: "Credit line", def: function (D) { return D.A && D.B ? "- " + upper(D.A.name) + " ON " + upper(D.B.name) : ""; } }],
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
      drawCut("left", { head: [0.25, tall ? 0.23 : 0.26, 0.16], side: "L", box: [0, 0, hw, H * 0.72] }, { clip: [0, 0, hw, H], label: "Left" });
      drawCut("right", { head: [0.75, tall ? 0.23 : 0.26, 0.16], side: "R", box: [hw, 0, hw, H * 0.72] }, { clip: [hw, 0, hw, H], label: "Right" });
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
  slots: [{ id: "main", kind: "cut", label: "Speaker", from: "A.body" },
          { id: "inset", kind: "circle", label: "Circle", note: "who he is talking about", from: "B.head" }],
  fields: [{ id: "quote", label: "Quote", multi: true, def: "If he threw the towel? I would *knock him out.*" },
           { id: "attr", label: "Credit line", def: function (D) { return D.A && D.B ? "- " + upper(D.A.name) + " ON " + upper(D.B.name) : ""; } }],
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
  slots: [{ id: "left", kind: "cut", label: "Left fighter", from: "A.body" },
          { id: "right", kind: "cut", label: "Right fighter", from: "B.body" }],
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
    drawCut("left", { head: [0.17, tall ? 0.22 : 0.25, 0.118], side: "L" }, { rim: 1.2, label: "Left fighter" });
    drawCut("right", { head: [0.83, tall ? 0.22 : 0.25, 0.118], side: "R" }, { rim: 1.2, label: "Right fighter" });
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
  slots: [{ id: "left", kind: "cut", label: "Left fighter", from: "A.body" },
          { id: "right", kind: "cut", label: "Right fighter", from: "B.body" }],
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
    drawCut("left", { head: [0.27, tall ? 0.29 : 0.31, 0.145], side: "L" }, { rim: 1.25, label: "Left fighter" });
    drawCut("right", { head: [0.73, tall ? 0.29 : 0.31, 0.145], side: "R" }, { rim: 1.25, label: "Right fighter" });
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
  slots: [{ id: "left", kind: "cut", label: "Left fighter", from: "A.body" },
          { id: "right", kind: "cut", label: "Right fighter", from: "B.body" }],
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
    drawCut("left", { head: [0.25, tall ? 0.27 : 0.29, 0.145], side: "L" }, { label: "Left fighter" });
    drawCut("right", { head: [0.75, tall ? 0.27 : 0.29, 0.145], side: "R" }, { label: "Right fighter" });
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
  slots: [{ id: "main", kind: "cut", label: "Fighter", from: "A.body" }],
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
      drawTile(lr, b.l, i * 2, { headW: 0.44, headY: 0.44 });
      drawTile(rrc, b.r, i * 2 + 1, { headW: 0.44, headY: 0.44 });
      R.hits[R.hits.length - 2].id = "bout:" + i + ":l"; R.hits[R.hits.length - 1].id = "bout:" + i + ":r";
      R.hits[R.hits.length - 2].kind = "bout"; R.hits[R.hits.length - 1].kind = "bout";
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
  slots: [{ id: "main", kind: "cut", label: "Winner", from: "A.body" }],
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
  slots: [{ id: "main", kind: "cut", label: "Fighter", from: "A.body" }],
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
  slots: [{ id: "main", kind: "cut", label: "Fighter", from: "A.body" }],
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
  slots: [{ id: "left", kind: "cut", label: "Left fighter", from: "A.body" },
          { id: "right", kind: "cut", label: "Right fighter", from: "B.body" }],
  fields: [{ id: "kicker", label: "Top line", def: "FIGHT WEEK" },
           { id: "nameL", label: "Left name", def: function (D) { return lastOf(D.A, "VOLKANOVSKI"); } },
           { id: "nameR", label: "Right name", def: function (D) { return lastOf(D.B, "EVLOEV"); } },
           { id: "event", label: "Event line", def: function (D) { return evLine(D, false); } }],
  lights: [{ x: 0.5, y: 0.42, r: 0.3, k: 1.1, c: "w" }, { x: -0.08, y: 0.4, r: 0.5, k: 0.7, c: "a" }, { x: 1.08, y: 0.4, r: 0.5, k: 0.7, c: "a" }],
  draw: function () {
    var p = R.pal, tall = H > W;
    g.fillStyle = "#040405"; g.fillRect(0, 0, W, H);
    glows(0.7);
    drawCut("left", { head: [0.28, tall ? 0.38 : 0.4, 0.27], side: "L" }, { clip: [0, 0, W / 2, H], rim: 1.3, bloom: 0.3, shade: 0.6, label: "Left fighter" });
    drawCut("right", { head: [0.72, tall ? 0.38 : 0.4, 0.27], side: "R" }, { clip: [W / 2, 0, W / 2, H], rim: 1.3, bloom: 0.3, shade: 0.6, label: "Right fighter" });
    g.save();
    var sg = g.createLinearGradient(0, 0, 0, H);
    sg.addColorStop(0, "rgba(255,255,255,0)"); sg.addColorStop(0.3, rgba(mix("#FFFFFF", p.glow, 0.35), 0.95)); sg.addColorStop(0.75, rgba(p.glow, 0.5)); sg.addColorStop(1, "rgba(255,255,255,0)");
    g.shadowColor = p.glow; g.shadowBlur = 30; g.fillStyle = sg; g.fillRect(W / 2 - 2, 0, 4, H);
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

// ---------- the document ----------
var DOC_KEY = "posters.doc.v2";
function freshDoc() {
  return { v: 1, tpl: "resume", size: "1x1", theme: "ember", look: "scene", lookAmt: 1, hotStyle: "color",
           fx: { glow: 1, rim: 1, shade: 1, fade: 1, grain: 0.6, vig: 1 },
           slots: {}, frames: {}, text: {}, tiles: [], tilesAuto: true, bouts: [], rows: null, form: null,
           people: { A: null, B: null }, ev: null, bout: null, meta: {} };
}
function mergeDoc(d) {
  var f = freshDoc();
  if (!d || typeof d !== "object" || d.v !== 1) return f;
  for (var k in f) if (Object.prototype.hasOwnProperty.call(d, k) && d[k] != null) f[k] = d[k];
  var fx = freshDoc().fx;
  for (var q in fx) if (typeof f.fx[q] !== "number") f.fx[q] = fx[q];
  if (!TPL[f.tpl]) f.tpl = "resume";
  if (!Array.isArray(f.tiles)) f.tiles = [];
  if (!Array.isArray(f.bouts)) f.bouts = [];
  return f;
}
function slotDef(t, id) { var ss = (t && t.slots) || []; for (var i = 0; i < ss.length; i++) if (ss[i].id === id) return ss[i]; return null; }
// explicit drop first, then the template's data source ("A.body" -> fighter A's cut-out)
assetOf = function (id) {
  var k = doc.slots[id];
  if (k && assets[k]) return assets[k];
  var s = slotDef(R ? R.tpl : TPL[doc.tpl], id);
  if (s && s.from) {
    var pr = s.from.split("."), P = doc.people[pr[0]], kk = P && P[pr[1]];
    if (kk && assets[kk]) return assets[kk];
  }
  return null;
};
function txFor(t, id) {
  var o = doc.text[t.id];
  if (o && o[id] != null) return o[id];
  var f = fieldOf(t, id);
  return f ? fieldDefault(t, f) : "";
}

// ---------- rendering ----------
var rafId = 0, thumbDirty = true, lastR = null;
function requestRender(thumbs) {
  if (thumbs) thumbDirty = true;
  if (!rafId) rafId = requestAnimationFrame(renderNow);
}
var mainG = g;
function applySize() {
  var h = doc.size === "4x5" ? 1350 : 1080;
  if (cv.width !== 1080 || cv.height !== h) { cv.width = 1080; cv.height = h; cutCache = {}; }
  document.documentElement.style.setProperty("--ar", String(1080 / h));
}
function lightsFor(t) {
  var ls = (t.lights || []).map(function (L) { return { x: L.x, y: L.y, r: L.r, k: L.k, c: L.c }; });
  return ls;
}
function renderTo(ctx, t, o) {
  var prev = g;
  g = ctx;
  R = { tpl: t, pal: themeById(doc.theme), lights: lightsFor(t), hits: [], place: {}, editor: !!o.editor, thumb: !!o.thumb,
        tag: (o.thumb ? "th:" : "") + t.id };
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = "source-over";
  ctx.shadowColor = "transparent"; ctx.clearRect(0, 0, W, H);
  try { t.draw(); }
  catch (e) {
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = "#300"; ctx.fillRect(0, 0, W, 40); ctx.fillStyle = "#fff"; ctx.font = "16px sans-serif";
    ctx.fillText("render error: " + (e && e.message), 10, 26);
    if (window.console) console.error(e);
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = "source-over"; ctx.shadowColor = "transparent";
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
  if (thumbDirty) scheduleThumbs();
}
// thumbnails render the SAME templates at 1/5 size (every size in a template is a fraction
// of W and H, so shrinking W/H shrinks the design), one per idle slot
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
function pumpThumbs() {
  if (!thumbQ.length || dragging) return;
  var id = thumbQ.shift(), c = document.querySelector('canvas[data-thumb="' + id + '"]');
  if (c) {
    var sw = W, sh = H;
    W = 216; H = Math.round(216 * cv.height / 1080);
    if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
    renderTo(c.getContext("2d"), TPL[id], { editor: false, thumb: true });
    W = sw; H = sh;
  }
  setTimeout(pumpThumbs, 16);
}

// ---------- history + autosave ----------
var hist = [], hix = -1, histT = 0, saveT = 0;
function snap() { return JSON.stringify(doc); }
function commit() {
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
  cutCache = {};
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
  doc.bouts.forEach(function (b) { if (b && b.l && b.l.a) u[b.l.a] = 1; if (b && b.r && b.r.a) u[b.r.a] = 1; });
  ["A", "B"].forEach(function (w) { var P = doc.people[w]; if (P) { if (P.body) u[P.body] = 1; if (P.head) u[P.head] = 1; } });
  return u;
}
function gcAssets() {
  var u = usedKeys(), keys = Object.keys(doc.meta);
  if (keys.length < 30) return;
  hist.forEach(function (s) { var m = s.match(/"a[0-9a-z]{6,14}"/g); if (m) m.forEach(function (x) { u[x.slice(1, -1)] = 1; }); });
  keys.forEach(function (k) { if (!u[k]) { if (doc.meta[k] && doc.meta[k].idb) idbDel(k); delete doc.meta[k]; delete assets[k]; } });
}
function restoreAssets() {
  var jobs = [];
  Object.keys(doc.meta).forEach(function (k) {
    if (assets[k]) return;
    var m = doc.meta[k] || {};
    var p = m.idb ? idbGet(k).then(function (b) { if (!b) throw new Error("gone"); return b; }) : m.src ? fetchBlob(m.src) : Promise.reject(new Error("no source"));
    jobs.push(p.then(blobToImage).then(function (im) {
      makeAsset(im, { key: k, src: m.src, face: m.face, name: m.name });
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
    var a = makeAsset(im, { src: src, face: meta && meta.face, name: meta && meta.name });
    urlAsset[src] = a.key;
    doc.meta[a.key] = { src: src, face: a.face, name: a.name };
    if (big && big !== src) upgradeAsset(a.key, big);
    return a;
  });
}
// swap a quick small copy for the full-resolution master under the SAME key, so every slot,
// tile and frame that points at it upgrades in place
function upgradeAsset(key, big) {
  fetchBlob(big).then(blobToImage).then(function (im) {
    var old = assets[key];
    if (!old) return;
    makeAsset(im, { key: key, src: big, face: old.face, name: old.name });
    urlAsset[big] = key;
    doc.meta[key] = { src: big, face: old.face, name: old.name };
    cutCache = {};
    requestRender(true);
    clearTimeout(saveT); saveT = setTimeout(save, 600);
  }).catch(function () { });
}
function assetFromFile(file) {
  return blobToImage(file).then(function (im) {
    var a = makeAsset(im, { name: file.name || "photo" });
    doc.meta[a.key] = { idb: 1, name: a.name };
    idbPut(a.key, file);
    return a;
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
      if (s.from && s.from.charAt(0) === which) { delete doc.slots[s.id]; delete doc.frames[s.id]; }
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
              rates: j.rates || {}, fights: j.fights || [], face: j.face || "", body: null, head: null };
    var jobs = [];
    if (j.bodySmall || j.body) {
      jobs.push(withBusy(assetFromUrl(j.bodySmall || j.body, { face: j.face, name: j.name }, j.body)).then(function (a) { P.body = a.key; }));
    }
    if (j.head) jobs.push(withBusy(assetFromUrl(j.head, { name: j.name })).then(function (a) { P.head = a.key; }).catch(function () { }));
    return Promise.all(jobs).then(function () {
      doc.people[which] = P;
      clearSlotsFrom(which);
      if (which === "A" && doc.tilesAuto) autoTiles();
      doc.rows = null; doc.form = null;
      cutCache = {};
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
var events = [];
function loadEvents() {
  return api("/studio/api/ufcevents").then(function (list) {
    events = Array.isArray(list) ? list : [];
    fillEventSelect();
    return events;
  }).catch(function () { events = []; fillEventSelect(); return []; });
}
var evCard = null;
function loadEvent(slug, pickMain) {
  return withBusy(api("/studio/api/ufcevent/" + encodeURIComponent(slug))).then(function (ev) {
    evCard = ev;
    doc.ev = { slug: ev.slug, title: ev.title, headline: ev.headline, ts: ev.ts, venue: ev.venue };
    var main = (ev.fights || []).filter(function (f) { return f.card === "main" && f.red.last && f.blue.last; }).slice(0, 6);
    doc.bouts = main.map(function (f) {
      return { l: { name: (f.red.first + " " + f.red.last).trim(), a: null, src: f.red.imgSmall, big: f.red.img, face: f.red.face },
               r: { name: (f.blue.first + " " + f.blue.last).trim(), a: null, src: f.blue.imgSmall, big: f.blue.img, face: f.blue.face },
               cls: String(f.cls || "").split(" Bout").join(""), title: /title/i.test(f.cls || "") };
    });
    doc.bouts.forEach(function (b) {
      ["l", "r"].forEach(function (s) {
        var c = b[s];
        if (!c.src) return;
        assetFromUrl(c.src, { name: c.name, face: c.face }, c.big).then(function (a) { c.a = a.key; commit(); }).catch(function () { });
      });
    });
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
    toast((f.red.last || "?") + " vs " + (f.blue.last || "?") + " loaded into every template");
    commit(); refreshInspector();
  });
}

// ---------- gallery ----------
var GROUPS = ["Fight week", "Quotes", "Stats", "Results", "News"];
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
  var sv = R;
  R = { tpl: t };
  var a = assetOf(id);
  R = sv;
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
        var sa = doc.slots.left; doc.slots.left = doc.slots.right; doc.slots.right = sa;
        cutCache = {}; commit(); refreshInspector();
      }));
      s2.appendChild(sw);
    }
  }
  if (t.slots && t.slots.length) {
    var s3 = sec("Images");
    t.slots.forEach(function (s) { s3.appendChild(slotRow(t, s)); });
    s3.appendChild(el("p", "mini", "Drop an image on the poster or on a row. Cut-out PNGs get the rim light, photos fill their frame. On the poster: drag to move, scroll or pinch to zoom, double-click to reset."));
  }
  if (t.fields && t.fields.length) {
    var s4 = sec("Text");
    t.fields.forEach(function (f) { fieldRow(s4, t, f); });
  }
  if (t.tiles) tilesEditor(t);
  if (t.rows) rowsEditor(t);
  if (t.bouts) boutsEditor(t);
  if (t.form) formEditor(t);
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
    if (!f.red.last || !f.blue.last) return;
    var o = el("option", null, f.red.last + " vs " + f.blue.last + (f.cls ? " (" + f.cls.split(" Bout").join("") + ")" : ""));
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
  if (doc.slots[s.id] && assets[doc.slots[s.id]]) from = a && a.cut ? "Your cut-out" : "Your photo";
  else if (a && s.from) { var P = doc.people[s.from.charAt(0)]; from = "From " + (P ? P.name : "the fighter") + (a.cut ? " (cut-out)" : ""); }
  mid.appendChild(el("small", null, from || s.note || (s.opt ? "Optional" : "Empty: drop an image")));
  var ops = el("div", "ops");
  ops.appendChild(btn("Pick", "ib", function () { pickFor = { id: s.id }; $("file").click(); }));
  ops.appendChild(btn("Flip", "ib", function () { var f = frameOf(s.id); f.flip = !f.flip; cutCache = {}; commit(); }));
  ops.appendChild(btn("Reset", "ib", function () { var f = frameOf(s.id); doc.frames[s.id] = { x: 0, y: 0, s: 1, flip: f.flip }; cutCache = {}; commit(); }));
  ops.appendChild(btn("X", "ib", function () { delete doc.slots[s.id]; delete doc.frames[s.id]; if (s.from) doc.slots[s.id] = ""; cutCache = {}; commit(); refreshInspector(); }));
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
  var cw = el("div", "chips");
  s.appendChild(cw);
  function chips() {
    cw.textContent = "";
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
function rng(parent, label, get, set, min, max, step) {
  var r = el("div", "rng"), l = el("span", null, label), i = el("input"), o = el("output");
  i.type = "range"; i.min = min; i.max = max; i.step = step; i.value = get();
  o.textContent = Math.round(get() * 100) + "";
  i.addEventListener("input", function () { set(Number(i.value)); o.textContent = Math.round(Number(i.value) * 100) + ""; cutCache = {}; commit(); });
  r.appendChild(l); r.appendChild(i); r.appendChild(o);
  parent.appendChild(r);
}
function styleSection(t) {
  var s = sec("Style");
  s.appendChild(el("div", "lbl", "Color theme"));
  var sw = el("div", "swatches");
  THEMES.forEach(function (th) {
    var b = btn("", "sw", function () { doc.theme = th.id; cutCache = {}; tintCache = {}; commit(); refreshInspector(); });
    b.style.background = "linear-gradient(135deg," + th.hi + "," + th.a + " 55%," + th.lo + ")";
    b.title = th.name; b.setAttribute("aria-label", th.name + " theme");
    b.setAttribute("aria-pressed", doc.theme === th.id ? "true" : "false");
    sw.appendChild(b);
  });
  s.appendChild(sw);
  s.appendChild(el("div", "lbl", "Highlighted words"));
  var hc = el("div", "chips");
  [["color", "Color"], ["box", "Box"], ["under", "Underline"]].forEach(function (h) {
    var b = btn(h[1], "chip", function () { doc.hotStyle = h[0]; commit(); refreshInspector(); });
    b.setAttribute("aria-pressed", doc.hotStyle === h[0] ? "true" : "false");
    hc.appendChild(b);
  });
  s.appendChild(hc);
  s.appendChild(el("div", "lbl", "Color grade"));
  var lc = el("div", "chips");
  LOOKS.forEach(function (L) {
    var b = btn(L.name, "chip", function () { doc.look = L.id; cutCache = {}; commit(); refreshInspector(); });
    b.setAttribute("aria-pressed", doc.look === L.id ? "true" : "false");
    lc.appendChild(b);
  });
  s.appendChild(lc);
  var box = el("div");
  box.style.marginTop = "10px";
  s.appendChild(box);
  rng(box, "Grade strength", function () { return doc.lookAmt; }, function (v) { doc.lookAmt = v; }, 0, 1, 0.05);
  rng(box, "Glow", function () { return doc.fx.glow; }, function (v) { doc.fx.glow = v; }, 0, 1.6, 0.05);
  rng(box, "Edge light", function () { return doc.fx.rim; }, function (v) { doc.fx.rim = v; }, 0, 2, 0.05);
  rng(box, "Ground fade", function () { return doc.fx.fade; }, function (v) { doc.fx.fade = v; }, 0, 1.4, 0.05);
  rng(box, "Shading", function () { return doc.fx.shade; }, function (v) { doc.fx.shade = v; }, 0, 1.6, 0.05);
  rng(box, "Grain", function () { return doc.fx.grain; }, function (v) { doc.fx.grain = v; }, 0, 1.6, 0.05);
  rng(box, "Vignette", function () { return doc.fx.vig; }, function (v) { doc.fx.vig = v; }, 0, 1.6, 0.05);
  var r = el("div", "row");
  r.style.marginTop = "12px";
  r.appendChild(btn("Reset style", "btn sm", function () {
    var f = freshDoc();
    doc.fx = f.fx; doc.look = f.look; doc.lookAmt = f.lookAmt; doc.hotStyle = f.hotStyle; doc.theme = f.theme;
    cutCache = {}; tintCache = {}; commit(); refreshInspector();
  }));
  r.appendChild(btn("Start over", "btn sm", function () {
    if (!window.confirm("Clear every image, text and fighter on this page? Downloads you made are kept.")) return;
    doc = freshDoc(); cutCache = {}; save(); hist = [snap()]; hix = 0; updateUndo(); buildInspector(); markGallery(); requestRender(true);
  }));
  s.appendChild(r);
}

// ---------- pointer, drop, paste, keys ----------
var sel = null, hov = null, dropHover = null, dragging = null, pointers = {}, pickFor = null;
var MOVABLE = ["photo", "cut", "circle"], DROPPABLE = ["photo", "cut", "circle", "tile", "bout"];
function toCanvas(e) {
  var r = cv.getBoundingClientRect();
  return { x: (e.clientX - r.left) * W / r.width, y: (e.clientY - r.top) * H / r.height };
}
function inShape(s, x, y) {
  if (s.r) return x >= s.r[0] && y >= s.r[1] && x <= s.r[0] + s.r[2] && y <= s.r[1] + s.r[3];
  if (s.c) { var dx = x - s.c[0], dy = y - s.c[1]; return dx * dx + dy * dy <= s.c[2] * s.c[2]; }
  return false;
}
function hitAt(x, y, kinds) {
  var hs = lastR ? lastR.hits : [];
  for (var i = hs.length - 1; i >= 0; i--) {
    var h = hs[i];
    if (kinds && kinds.indexOf(h.kind) === -1) continue;
    if (inShape(h.shape, x, y)) return h;
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
  withBusy(assetFromFile(files[0])).then(function (a) {
    doc.slots[h.id] = a.key;
    delete doc.frames[h.id];
    sel = h.id;
    cutCache = {};
    commit(); refreshInspector();
    toast(a.cut ? "Cut-out placed: it snaps to the head and takes the light" : "Photo placed: drag to frame it");
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
  var pl = lastR && lastR.place[id], f = doc.frames[id];
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
  if (!h) { sel = null; drawOverlay(); return; }
  if (h.kind === "text") { focusField(h.id.slice(5)); return; }
  if (h.kind === "rows") { var s = insp.querySelector(".list"); if (s) s.scrollIntoView({ block: "center", behavior: "smooth" }); return; }
  sel = h.id;
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
  requestRender();
  commit();
}, { passive: false });
cv.addEventListener("dblclick", function (e) {
  var p = toCanvas(e), h = hitAt(p.x, p.y, MOVABLE);
  if (!h) return;
  var f = frameOf(h.id);
  doc.frames[h.id] = { x: 0, y: 0, s: 1, flip: f.flip };
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
  else if (e.key === "f" || e.key === "F") { f.flip = !f.flip; cutCache = {}; }
  else if (e.key === "Delete" || e.key === "Backspace") { delete doc.slots[sel]; delete doc.frames[sel]; refreshInspector(); }
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
function exportCanvas() {
  var c = mkCanvas(1080, cv.height);
  renderTo(c.getContext("2d"), TPL[doc.tpl], { editor: false });
  return c;
}
function stamp() { var d = new Date(); return d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2) + "-" + ("0" + d.getDate()).slice(-2); }
$("dlBtn").addEventListener("click", function () {
  exportCanvas().toBlob(function (b) {
    if (!b) { toast("Could not make the PNG"); return; }
    var a = document.createElement("a"), u = URL.createObjectURL(b);
    a.href = u; a.download = doc.tpl + "-" + stamp() + ".png";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(u); }, 5000);
    toast("PNG downloaded (1080 x " + cv.height + ")");
  }, "image/png");
});
$("copyBtn").addEventListener("click", function () {
  if (!navigator.clipboard || !window.ClipboardItem) { toast("This browser cannot copy images. Use Download PNG."); return; }
  exportCanvas().toBlob(function (b) {
    navigator.clipboard.write([new ClipboardItem({ "image/png": b })]).then(function () { toast("Copied. Paste it anywhere."); }, function () { toast("Copy was blocked. Use Download PNG."); });
  }, "image/png");
});
$("undoBtn").addEventListener("click", undo);
$("redoBtn").addEventListener("click", redo);
var segs = $("sizeSeg").querySelectorAll("button");
function markSize() { for (var i = 0; i < segs.length; i++) segs[i].setAttribute("aria-pressed", segs[i].getAttribute("data-size") === doc.size ? "true" : "false"); }
for (var si = 0; si < segs.length; si++) {
  segs[si].addEventListener("click", function () { doc.size = this.getAttribute("data-size"); markSize(); cutCache = {}; applySize(); commit(); });
}

// ---------- boot ----------
function fontsReady() {
  if (!document.fonts || !document.fonts.load) return Promise.resolve();
  var fs = ["400 100px Anton", "800 100px 'Barlow Condensed'", "700 100px 'Barlow Condensed'", "600 100px 'Barlow Condensed'", "700 100px Poppins", "800 100px Poppins"];
  return Promise.all(fs.map(function (f) { return document.fonts.load(f).catch(function () { }); }));
}
function boot() {
  var saved = lsGet(DOC_KEY), parsed = null;
  try { parsed = saved ? JSON.parse(saved) : null; } catch (e) { parsed = null; }
  doc = mergeDoc(parsed);
  applySize(); W = 1080; H = cv.height;
  buildGallery(); buildInspector(); markSize();
  hist = [snap()]; hix = 0; updateUndo();
  requestRender(true);
  fontsReady().then(function () { measureCaps(); cutCache = {}; requestRender(true); });
  ["tape1", "grunge", "haze"].forEach(plate);
  idbOpen().then(restoreAssets).then(function () { cutCache = {}; requestRender(true); refreshInspector(); });
  // the bout list needs the card; the doc keeps only the event, so re-read it quietly
  if (doc.ev && doc.ev.slug) {
    api("/studio/api/ufcevent/" + encodeURIComponent(doc.ev.slug)).then(function (ev) { evCard = ev; fillBoutSelect(); }).catch(function () { });
  }
  loadEvents().then(function (list) {
    if (parsed || !list.length) return;
    var pick = list.filter(function (e) { return /^UFC [0-9]/.test(e.title); })[0] || list[0];
    loadEvent(pick.slug, true).catch(toastErr);
  });
}
window.__posters = {
  doc: function () { return doc; }, render: function () { requestRender(true); }, place: placeFiles, tpl: setTpl,
  png: function (id) {
    return new Promise(function (res) {
      var c = mkCanvas(1080, cv.height);
      W = 1080; H = cv.height;
      renderTo(c.getContext("2d"), TPL[id || doc.tpl], { editor: false });
      c.toBlob(res, "image/png");
    });
  },
  ids: function () { return TPLS.map(function (t) { return t.id; }); },
  assets: function () { return assets; }
};
boot();
})();
</script>
</body>
</html>`;
