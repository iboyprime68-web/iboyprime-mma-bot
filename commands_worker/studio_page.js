// studio_page.js - the owner's poster + poll editor, served by the Worker on GET /studio.
//
// This module exports ONE string. worker.js imports STUDIO_HTML and serves it behind the
// login gate; nothing here reads env, holds a secret or knows a token. Every pixel is
// drawn client-side on a 1080-wide canvas that mirrors bots_github/postcard.py's
// render_news (cover-crop + top-anchored punch-in, transparent purple seam gradient,
// localized text band, centered uppercase Poppins Black with negative tracking and a
// 0.90 fake-condense, rule-flanked quote glyph or a docked inset card, the
// "SPEAKER, VIA SOURCE" footer, and the accent bar across the very bottom edge).
//
// API contracts this page codes against, each degraded gracefully when a field is absent:
//   GET  /studio/api/staged -> [{id, score, why, caption, line, speaker, source, about,
//                                hot: [..], image_url, timestamp}]
//   GET  /studio/api/aikey  -> {providers: {deepseek: bool, openrouter: bool}}
//   POST /studio/api/aikey  <- {provider: "deepseek"|"openrouter", key}
//   GET  /studio/api/poll   -> {question, options: [{label, emoji, img}]}
//   GET  /studio/api/limits -> {youtube_api_supports_community_posts, note}
//
// Source rules: ASCII only (glyphs go in as \u escapes, which the template literal
// resolves), no em dash, no exclamation marks in anything the owner reads, purple +
// Poppins, no logo and no channel name on a poster, and every backslash meant for the
// PAGE is doubled so it survives the template literal.
export const STUDIO_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#08080C">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="Studio">
<title>Studio</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;800;900&display=swap" rel="stylesheet">
<style>
:root{
  --bg:#08080C; --card:#12121B; --card2:#181823; --sunk:#0D0D14;
  --line:#242433; --line2:#38384f;
  --text:#F3F2F7; --dim:#9997AC; --faint:#6E6C80;
  --accent:#8B70FF; --hot:#A45CFF; --deep:#5B3DF5; --ok:#63E3AE;
  --r:16px; --rs:11px; --ar:.8;
  --shadow:0 14px 40px rgba(0,0,0,.5);
}
*{box-sizing:border-box;margin:0;padding:0;min-width:0}
html{-webkit-text-size-adjust:100%}
body{
  background:var(--bg); color:var(--text);
  font-family:Poppins,system-ui,-apple-system,Segoe UI,sans-serif;
  font-size:15px; line-height:1.45; min-height:100vh; overflow-x:hidden;
  background-image:
    radial-gradient(760px 420px at 12% -8%, rgba(139,112,255,.16), transparent 68%),
    radial-gradient(620px 380px at 92% 2%, rgba(91,61,245,.13), transparent 70%);
  background-attachment:fixed;
}
button,input,textarea,select{font-family:inherit;color:inherit;max-width:100%}
:focus-visible{outline:2px solid var(--hot);outline-offset:2px;border-radius:8px}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}

/* ---- shell ---- */
.topbar{
  position:sticky;top:0;z-index:40;
  padding:calc(10px + env(safe-area-inset-top)) 14px 10px;
  display:flex;align-items:center;gap:12px;flex-wrap:wrap;
  background:rgba(8,8,12,.82);backdrop-filter:blur(14px);
  border-bottom:1px solid var(--line);
}
.brand{display:flex;align-items:center;gap:9px;margin-right:auto}
.brand .mark{width:26px;height:26px;border-radius:9px;background:linear-gradient(140deg,var(--hot),var(--deep));box-shadow:0 0 22px rgba(164,92,255,.55);flex:none}
.brand h1{font-size:17px;font-weight:800;letter-spacing:.4px}
.brand em{font-style:normal;color:var(--faint);font-size:11px;font-weight:600;letter-spacing:1.4px;text-transform:uppercase}
.tabs{display:flex;gap:4px;background:var(--sunk);border:1px solid var(--line);border-radius:13px;padding:4px}
.tab{
  border:0;background:transparent;color:var(--dim);font-size:13px;font-weight:700;
  padding:9px 16px;min-height:40px;border-radius:9px;cursor:pointer;transition:.16s;
}
.tab:hover{color:var(--text)}
.tab[aria-selected=true]{background:linear-gradient(140deg,var(--accent),var(--deep));color:#fff;box-shadow:0 6px 18px rgba(91,61,245,.42)}
@media(max-width:430px){
  .topbar{padding-left:12px;padding-right:12px;gap:8px}
  .brand em{display:none}
  .brand h1{font-size:16px}
  .tab{padding:9px 11px;font-size:12.5px}
}
main{max-width:1280px;margin:0 auto;padding:16px 14px 60px}
.view[hidden]{display:none}
.stack{display:grid;gap:14px}
.panel{margin-top:14px}
@media(min-width:960px){
  .split{display:grid;grid-template-columns:minmax(0,1fr) 452px;gap:20px;align-items:start}
  .stage{position:sticky;top:76px}
  .panel{margin-top:0}
}

/* ---- cards ---- */
.card{background:var(--card);border:1px solid var(--line);border-radius:var(--r);padding:15px}
.card + .card{margin-top:14px}
.chead{display:flex;align-items:center;gap:10px;margin-bottom:12px;flex-wrap:wrap}
.chead h2{font-size:11px;font-weight:800;letter-spacing:1.7px;text-transform:uppercase;color:var(--dim)}
.chead .grow{margin-left:auto}
.note{color:var(--faint);font-size:12px;line-height:1.5}
.note a{color:var(--accent)}
.field{margin-bottom:12px}
.field:last-child{margin-bottom:0}
label.lbl{display:block;font-size:10.5px;font-weight:700;letter-spacing:1.4px;text-transform:uppercase;color:var(--faint);margin-bottom:6px}
input[type=text],input[type=password],textarea{
  width:100%;background:var(--sunk);border:1px solid var(--line);border-radius:var(--rs);
  padding:12px 13px;font-size:15px;font-weight:500;min-height:46px;outline:none;transition:.15s;
}
textarea{resize:vertical;min-height:92px;line-height:1.5}
input:focus,textarea:focus{border-color:var(--accent);background:#0A0A11;box-shadow:0 0 0 3px rgba(139,112,255,.16)}
input::placeholder,textarea::placeholder{color:#55536a}
#line{text-transform:uppercase;font-weight:800;letter-spacing:.3px;font-size:16px}
.two{display:grid;grid-template-columns:1fr 1fr;gap:10px}

/* ---- template picker ---- */
.tpl{display:grid;grid-template-columns:repeat(auto-fit,minmax(92px,1fr));gap:9px}
.tpl button{
  background:var(--card2);border:1px solid var(--line);border-radius:13px;padding:9px 7px 8px;
  cursor:pointer;display:grid;gap:6px;justify-items:center;transition:.16s;min-height:82px;
}
.tpl button:hover{border-color:var(--line2)}
.tpl button[aria-pressed=true]{border-color:var(--accent);background:rgba(139,112,255,.13);box-shadow:0 0 0 1px var(--accent) inset}
.tpl svg{width:34px;height:42px;display:block}
.tpl span{font-size:10.5px;font-weight:700;letter-spacing:.3px;color:var(--dim);text-align:center;line-height:1.2}
.tpl button[aria-pressed=true] span{color:var(--text)}

/* ---- chips + segmented + swatches ---- */
.chips{display:flex;flex-wrap:wrap;gap:7px}
.chip{
  border:1px solid var(--line);background:var(--sunk);border-radius:999px;
  font-size:13px;font-weight:700;letter-spacing:.4px;padding:0 14px;min-height:40px;
  cursor:pointer;transition:.14s;text-transform:uppercase;max-width:100%;overflow:hidden;text-overflow:ellipsis;
}
.chip:hover{border-color:var(--line2)}
.chip[aria-pressed=true]{background:var(--hotc,var(--hot));border-color:transparent;color:#12121B;box-shadow:0 5px 16px rgba(0,0,0,.34)}
.chip.u[aria-pressed=true]{background:var(--sunk);color:var(--text);border-color:var(--hotc,var(--hot));box-shadow:inset 0 -4px 0 -1px var(--hotc,var(--hot))}
.seg{display:flex;background:var(--sunk);border:1px solid var(--line);border-radius:var(--rs);padding:3px;gap:3px}
.seg button{
  flex:1;border:0;background:transparent;color:var(--dim);font-size:12.5px;font-weight:700;
  min-height:38px;border-radius:8px;cursor:pointer;transition:.15s;padding:0 6px;
}
.seg button[aria-pressed=true]{background:var(--accent);color:#fff}
.seg.sm button{min-height:34px;font-size:11.5px}
.swatches{display:flex;gap:8px;flex-wrap:wrap}
.sw{width:46px;height:40px;border-radius:11px;border:2px solid var(--line);cursor:pointer;padding:0;position:relative}
.sw span{position:absolute;left:0;right:0;bottom:-16px;font-size:9.5px;font-weight:700;color:var(--faint);letter-spacing:.6px;text-transform:uppercase}
.sw[aria-pressed=true]{border-color:#fff;box-shadow:0 0 0 3px rgba(255,255,255,.16)}
.swrow{padding-bottom:18px}

/* ---- drops ---- */
.drop{
  border:1.5px dashed var(--line2);border-radius:13px;background:var(--sunk);
  min-height:78px;display:flex;align-items:center;justify-content:center;gap:10px;
  text-align:center;color:var(--faint);font-size:12.5px;font-weight:600;padding:12px;
  cursor:pointer;transition:.15s;position:relative;overflow:hidden;
}
.drop:hover{border-color:var(--accent);color:var(--dim)}
.drop.over{border-color:var(--hot);background:rgba(164,92,255,.1);color:var(--text)}
.drop.set{border-style:solid;border-color:var(--line);color:var(--text);padding:0;min-height:78px}
.drop img{width:100%;height:78px;object-fit:cover;border-radius:12px;display:block}
.drop .x{
  position:absolute;top:6px;right:6px;width:30px;height:30px;border-radius:9px;border:0;
  background:rgba(8,8,12,.82);color:#fff;font-size:15px;font-weight:800;cursor:pointer;line-height:1;
}
.hidden{display:none}

/* ---- sliders ---- */
.slide{margin-bottom:11px}
.slide:last-child{margin-bottom:0}
.slide .top{display:flex;align-items:center;gap:8px;margin-bottom:3px}
.slide .top b{font-size:11px;font-weight:700;letter-spacing:1.1px;text-transform:uppercase;color:var(--faint)}
.slide .top i{margin-left:auto;font-style:normal;font-size:11.5px;font-weight:700;color:var(--accent);font-variant-numeric:tabular-nums}
.srow{display:flex;align-items:center;gap:8px}
.step{
  width:40px;height:40px;flex:none;border:1px solid var(--line);background:var(--card2);
  border-radius:10px;font-size:17px;font-weight:700;cursor:pointer;line-height:1;
}
.step:hover{border-color:var(--accent)}
input[type=range]{
  flex:1;-webkit-appearance:none;appearance:none;background:transparent;height:40px;cursor:pointer;min-width:0;
}
input[type=range]::-webkit-slider-runnable-track{height:5px;border-radius:3px;background:var(--line)}
input[type=range]::-moz-range-track{height:5px;border-radius:3px;background:var(--line)}
input[type=range]::-webkit-slider-thumb{
  -webkit-appearance:none;width:22px;height:22px;border-radius:50%;margin-top:-8.5px;
  background:linear-gradient(140deg,var(--hot),var(--deep));border:2px solid #0b0b12;box-shadow:0 2px 10px rgba(0,0,0,.6);
}
input[type=range]::-moz-range-thumb{
  width:20px;height:20px;border-radius:50%;border:2px solid #0b0b12;
  background:linear-gradient(140deg,var(--hot),var(--deep));
}

/* ---- buttons ---- */
.btn{
  border:1px solid var(--line);background:var(--card2);border-radius:var(--rs);
  font-size:14px;font-weight:700;min-height:46px;padding:0 16px;cursor:pointer;transition:.15s;
  display:inline-flex;align-items:center;justify-content:center;gap:8px;text-decoration:none;color:var(--text);
}
.btn:hover{border-color:var(--line2);background:#1E1E2C}
.btn.pri{background:linear-gradient(140deg,var(--accent),var(--deep));border-color:transparent;color:#fff;box-shadow:0 8px 22px rgba(91,61,245,.36)}
.btn.pri:hover{filter:brightness(1.08)}
.btn.ghost{background:transparent}
.btn.warn{color:#FF9A9A}
.btn[disabled]{opacity:.45;cursor:not-allowed}
.mini{border:1px solid var(--line);background:transparent;border-radius:9px;font-size:11.5px;font-weight:700;min-height:34px;padding:0 11px;cursor:pointer;color:var(--dim)}
.mini:hover{color:var(--text);border-color:var(--accent)}
.mini[disabled]{opacity:.4;cursor:not-allowed}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:9px}
.grid1{display:grid;gap:9px}

/* ---- stage ---- */
.canvas-wrap{
  width:100%;max-width:min(100%, calc(44vh * var(--ar)));margin:0 auto 10px;position:relative;
  border-radius:14px;overflow:hidden;border:1px solid var(--line);box-shadow:var(--shadow);
  background:#000;touch-action:none;
}
@media(min-width:960px){.canvas-wrap{max-width:min(452px, calc(58vh * var(--ar)))}}
#cv{width:100%;height:auto;display:block;cursor:grab}
#cv:active{cursor:grabbing}
#cv:focus-visible{outline:2px solid var(--hot);outline-offset:-2px}
#sel{position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none;display:block}
.hud{position:absolute;left:8px;top:8px;display:flex;gap:5px;pointer-events:none;flex-wrap:wrap;max-width:calc(100% - 16px)}
.hud span{
  background:rgba(8,8,12,.72);backdrop-filter:blur(6px);border:1px solid var(--line);
  border-radius:8px;font-size:10px;font-weight:700;letter-spacing:.8px;text-transform:uppercase;
  padding:4px 8px;color:var(--dim);
}
.hud span.on{color:#fff;border-color:var(--accent);background:rgba(139,112,255,.35)}
.stagehint{text-align:center;color:var(--faint);font-size:11.5px;margin:-2px 0 10px}

/* ---- staged rail + drafts ---- */
.rail{display:flex;gap:10px;overflow-x:auto;padding:2px 2px 8px;scroll-snap-type:x proximity;-webkit-overflow-scrolling:touch}
.rail::-webkit-scrollbar{height:6px}
.rail::-webkit-scrollbar-thumb{background:var(--line2);border-radius:3px}
.railitem{
  flex:0 0 176px;scroll-snap-align:start;background:var(--card2);border:1px solid var(--line);
  border-radius:13px;overflow:hidden;cursor:pointer;text-align:left;padding:0;transition:.16s;
}
.railitem:hover{border-color:var(--accent)}
.railitem[aria-pressed=true]{border-color:var(--hot);box-shadow:0 0 0 1px var(--hot) inset}
.railitem .ph{width:100%;height:100px;background:#0A0A11 center/cover no-repeat;display:block;position:relative}
.railitem .score{
  position:absolute;top:6px;left:6px;background:rgba(8,8,12,.8);border-radius:7px;padding:2px 7px;
  font-size:10.5px;font-weight:800;color:var(--hot);letter-spacing:.4px;
}
.railitem .when{position:absolute;bottom:6px;right:6px;background:rgba(8,8,12,.78);border-radius:6px;padding:1px 6px;font-size:9.5px;font-weight:700;color:var(--dim)}
.railitem .hl{display:block;padding:8px 10px 2px;font-size:11.5px;line-height:1.3;color:var(--text);font-weight:700;
  display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.railitem .why{display:block;padding:3px 10px 10px;font-size:10.5px;line-height:1.3;color:var(--faint);
  display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;min-height:28px}
.skel{flex:0 0 176px;height:150px;border-radius:13px;background:linear-gradient(100deg,#141420,#1D1D2B,#141420);background-size:220% 100%;animation:sh 1.3s linear infinite}
@keyframes sh{to{background-position:-220% 0}}
@media(prefers-reduced-motion:reduce){.skel{animation:none}*{transition:none !important}}
.drafts{display:grid;gap:7px}
.draftrow{display:flex;gap:8px;align-items:center}
.draftrow button.open{
  flex:1;text-align:left;background:var(--card2);border:1px solid var(--line);border-radius:11px;
  padding:9px 11px;cursor:pointer;min-height:44px;overflow:hidden;
}
.draftrow button.open:hover{border-color:var(--accent)}
.draftrow b{display:block;font-size:12.5px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.draftrow i{display:block;font-style:normal;font-size:10.5px;color:var(--faint);letter-spacing:.4px}
.draftrow .del{width:40px;height:40px;flex:none;border:1px solid var(--line);background:transparent;border-radius:10px;color:var(--faint);cursor:pointer;font-size:15px}
.draftrow .del:hover{color:#FF9A9A;border-color:#FF9A9A}

/* ---- polls ---- */
.opt{background:var(--card2);border:1px solid var(--line);border-radius:13px;padding:11px;display:flex;gap:11px;align-items:flex-start}
.opt + .opt{margin-top:10px}
.opt canvas{width:104px;height:104px;flex:none;border-radius:10px;border:1px solid var(--line);background:#0A0A11;display:block;cursor:grab;touch-action:none}
.opt canvas:active{cursor:grabbing}
.opt .body{flex:1;min-width:0;display:grid;gap:8px}
.opt .rowx{display:grid;grid-template-columns:60px 1fr 40px;gap:8px}
.opt input{min-height:42px}
.opt .rm{border:1px solid var(--line);background:transparent;border-radius:10px;color:var(--faint);cursor:pointer;font-size:15px;min-height:42px}
.opt .rm:hover{color:#FF9A9A;border-color:#FF9A9A}
.opt .rm[disabled]{opacity:.35;cursor:not-allowed}
.badge{display:inline-flex;align-items:center;gap:6px;font-size:11px;font-weight:700;color:var(--ok);letter-spacing:.4px}
.badge.off{color:var(--faint)}
.keyrow{display:flex;gap:10px;flex-wrap:wrap;margin-top:10px}

/* ---- toast ---- */
#toast{
  position:fixed;left:50%;bottom:calc(18px + env(safe-area-inset-bottom));transform:translate(-50%,24px);
  background:#1B1B28;border:1px solid var(--line2);border-radius:12px;padding:11px 18px;
  font-size:13px;font-weight:600;box-shadow:var(--shadow);opacity:0;pointer-events:none;transition:.22s;z-index:90;max-width:88vw;text-align:center;
}
#toast.on{opacity:1;transform:translate(-50%,0)}
</style>
</head>
<body>

<header class="topbar">
  <div class="brand"><span class="mark" aria-hidden="true"></span><h1>Studio</h1><em>iBoyPrime</em></div>
  <nav class="tabs" role="tablist" aria-label="Studio sections">
    <button class="tab" role="tab" id="tab-post" aria-selected="true" aria-controls="view-post">Post</button>
    <button class="tab" role="tab" id="tab-poll" aria-selected="false" aria-controls="view-poll" tabindex="-1">Polls</button>
    <button class="tab" role="tab" id="tab-set" aria-selected="false" aria-controls="view-set" tabindex="-1">Settings</button>
  </nav>
</header>

<main>

<!-- ============================ POST ============================ -->
<section class="view" id="view-post" role="tabpanel" aria-labelledby="tab-post">

  <div class="card">
    <div class="chead">
      <h2>Staged by the bot</h2>
      <span class="grow"></span>
      <button class="mini" id="railReload" type="button">Refresh</button>
    </div>
    <div class="rail" id="rail"></div>
    <p class="note" id="railNote">Loading what the bot staged in Discord.</p>
  </div>

  <div class="card">
    <div class="chead">
      <h2>Drafts</h2>
      <span class="grow"></span>
      <button class="mini" id="saveDraft" type="button">Save a draft</button>
    </div>
    <div class="drafts" id="drafts"></div>
    <p class="note" id="draftNote" style="margin-top:8px">Your work saves itself, so a refresh brings it back.</p>
  </div>

  <div class="split" style="margin-top:14px">
    <div class="stage">
      <div class="seg sm" role="group" aria-label="Poster shape" id="aspSeg" style="margin-bottom:10px">
        <button data-asp="4:5" type="button" aria-pressed="true">4:5 tall</button>
        <button data-asp="1:1" type="button" aria-pressed="false">1:1 square</button>
        <button data-asp="9:16" type="button" aria-pressed="false">9:16 story</button>
      </div>
      <div class="canvas-wrap" id="wrap">
        <canvas id="cv" width="1080" height="1350" tabindex="0" aria-label="Poster preview. Drag to move the selected layer, arrow keys nudge it."></canvas>
        <canvas id="sel" width="1080" height="1350" aria-hidden="true"></canvas>
        <div class="hud" id="hud" aria-hidden="true"></div>
      </div>
      <p class="stagehint">Drag on the poster to move the layer inside the box. Arrow keys nudge.</p>
      <div class="grid2">
        <button class="btn pri" id="dl" type="button">Download PNG</button>
        <button class="btn" id="copyImg" type="button">Copy image</button>
        <button class="btn" id="copyCap" type="button">Copy caption</button>
        <button class="btn" id="shareBtn" type="button">Share</button>
      </div>
      <div class="grid1" style="margin-top:9px">
        <a class="btn ghost" href="https://www.youtube.com/channel/UCPx5FFZkK2N5yQ-jiTcS3mg/community" target="_blank" rel="noopener noreferrer">Open YouTube composer &rarr;</a>
      </div>
      <p class="note" id="limitsNote" style="margin-top:10px"></p>
    </div>

    <div class="panel">

      <div class="card">
        <div class="chead"><h2>Template</h2></div>
        <div class="tpl" id="tpl"></div>
      </div>

      <div class="card" id="cardLine">
        <div class="chead"><h2>The line</h2></div>
        <div class="field">
          <label class="lbl" for="line">Poster line</label>
          <input id="line" type="text" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="TYPE THE LINE">
        </div>
        <div class="field">
          <label class="lbl">Hot words <span style="color:var(--faint);text-transform:none;letter-spacing:0">(tap to toggle)</span></label>
          <div class="chips" id="wordChips"></div>
          <p class="note" id="wordNote" style="margin-top:7px"></p>
        </div>
        <div class="two">
          <div class="field">
            <label class="lbl">Highlight style</label>
            <div class="seg sm" role="group" aria-label="Highlight style">
              <button id="hlColor" type="button" aria-pressed="true">Color fill</button>
              <button id="hlUnder" type="button" aria-pressed="false">Underline</button>
            </div>
          </div>
          <div class="field swrow">
            <label class="lbl">Highlight color</label>
            <div class="swatches" id="hlSwatch" role="group" aria-label="Highlight color"></div>
          </div>
        </div>
      </div>

      <div class="card" id="cardAttr">
        <div class="chead"><h2>Attribution</h2></div>
        <div class="field">
          <label class="lbl" for="speaker">Speaker</label>
          <input id="speaker" type="text" autocomplete="off" placeholder="Daniel Cormier">
        </div>
        <div class="two">
          <div class="field">
            <label class="lbl" for="about">On (optional)</label>
            <input id="about" type="text" autocomplete="off" placeholder="Ian Garry">
          </div>
          <div class="field">
            <label class="lbl" for="source">Via source</label>
            <input id="source" type="text" autocomplete="off" placeholder="ESPN">
          </div>
        </div>
      </div>

      <div class="card" id="cardVersus" hidden>
        <div class="chead"><h2>Matchup</h2></div>
        <div class="two">
          <div class="field"><label class="lbl" for="vLeft">Left name</label><input id="vLeft" type="text" autocomplete="off" placeholder="MAKHACHEV"></div>
          <div class="field"><label class="lbl" for="vRight">Right name</label><input id="vRight" type="text" autocomplete="off" placeholder="DELLA MADDALENA"></div>
        </div>
        <div class="two">
          <div class="field"><label class="lbl" for="vEvent">Event line</label><input id="vEvent" type="text" autocomplete="off" placeholder="Welterweight title"></div>
          <div class="field"><label class="lbl" for="vDate">Date line</label><input id="vDate" type="text" autocomplete="off" placeholder="Nov 15 - Philadelphia"></div>
        </div>
      </div>

      <div class="card" id="cardStat" hidden>
        <div class="chead"><h2>Stat compare</h2></div>
        <div class="field"><label class="lbl" for="sTitle">Title band</label><input id="sTitle" type="text" autocomplete="off" placeholder="LAST 10 WINS"></div>
        <div class="two">
          <div class="field"><label class="lbl" for="sL1">Left, top row</label><input id="sL1" type="text" autocomplete="off" placeholder="8 FINISHES"></div>
          <div class="field"><label class="lbl" for="sR1">Right, top row</label><input id="sR1" type="text" autocomplete="off" placeholder="3 FINISHES"></div>
        </div>
        <div class="two">
          <div class="field"><label class="lbl" for="sL2">Left, second row</label><input id="sL2" type="text" autocomplete="off" placeholder="2 DECISIONS"></div>
          <div class="field"><label class="lbl" for="sR2">Right, second row</label><input id="sR2" type="text" autocomplete="off" placeholder="7 DECISIONS"></div>
        </div>
      </div>

      <div class="card">
        <div class="chead"><h2>Photos</h2></div>
        <div id="photoSingle">
          <div class="field">
            <label class="lbl">Main photo</label>
            <div class="drop" id="dropMain" role="button" tabindex="0" aria-label="Add the main photo">Drop a photo, tap to pick, or paste</div>
            <input id="fileMain" type="file" accept="image/*" class="hidden">
          </div>
        </div>
        <div id="photoPair" hidden>
          <div class="two">
            <div class="field">
              <label class="lbl">Left photo</label>
              <div class="drop" id="dropLeft" role="button" tabindex="0" aria-label="Add the left photo">Left</div>
              <input id="fileLeft" type="file" accept="image/*" class="hidden">
            </div>
            <div class="field">
              <label class="lbl">Right photo</label>
              <div class="drop" id="dropRight" role="button" tabindex="0" aria-label="Add the right photo">Right</div>
              <input id="fileRight" type="file" accept="image/*" class="hidden">
            </div>
          </div>
        </div>
        <div id="photoInset" hidden>
          <div class="field">
            <label class="lbl">Inset portrait</label>
            <div class="drop" id="dropInset" role="button" tabindex="0" aria-label="Add the inset portrait">Drop the speaker's face here</div>
            <input id="fileInset" type="file" accept="image/*" class="hidden">
          </div>
          <div class="field">
            <label class="lbl">Inset shape</label>
            <div class="seg sm" role="group" aria-label="Inset shape">
              <button id="shapeSq" type="button" aria-pressed="true">Square card</button>
              <button id="shapeCi" type="button" aria-pressed="false">Circle</button>
            </div>
          </div>
        </div>
        <div class="two" style="margin-top:12px">
          <div class="field">
            <label class="lbl">Framing</label>
            <div class="seg sm" role="group" aria-label="Photo framing" id="fitSeg">
              <button data-fit="punch" type="button" aria-pressed="true">Punch in</button>
              <button data-fit="fit" type="button" aria-pressed="false">Whole photo</button>
            </div>
          </div>
          <div class="field">
            <label class="lbl">Grade</label>
            <div class="seg sm" role="group" aria-label="Photo grade" id="cleanSeg">
              <button data-clean="0" type="button" aria-pressed="true">Graded</button>
              <button data-clean="1" type="button" aria-pressed="false">Clean</button>
            </div>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="chead">
          <h2>Adjust</h2>
          <span class="grow"></span>
          <button class="mini" id="undoBtn" type="button">Undo</button>
          <button class="mini" id="redoBtn" type="button">Redo</button>
        </div>
        <div class="field">
          <label class="lbl">Layer to move</label>
          <div class="seg sm" role="group" aria-label="Layer to move" id="layerSeg">
            <button data-layer="text" type="button" aria-pressed="true">Text</button>
            <button data-layer="photo" type="button" aria-pressed="false" id="layPhoto">Photo</button>
            <button data-layer="right" type="button" aria-pressed="false" id="layRight" hidden>Right</button>
            <button data-layer="inset" type="button" aria-pressed="false" id="layInset">Inset</button>
          </div>
        </div>
        <div id="sliders"></div>
        <div class="grid2" style="margin-top:11px">
          <button class="btn" id="recenterBtn" type="button">Re-center</button>
          <button class="btn ghost warn" id="clearBtn" type="button">Clear all</button>
        </div>
      </div>

      <div class="card">
        <div class="chead"><h2>Caption</h2></div>
        <textarea id="caption" rows="5" placeholder="The caption you paste under the image"></textarea>
      </div>

    </div>
  </div>
</section>

<!-- ============================ POLLS ============================ -->
<section class="view" id="view-poll" role="tabpanel" aria-labelledby="tab-poll" hidden>
  <div class="stack" style="max-width:760px;margin:0 auto">
    <div class="card">
      <div class="chead">
        <h2>Poll question</h2>
        <span class="grow"></span>
        <button class="mini" id="pollUndo" type="button">Undo</button>
        <button class="mini" id="pollRedo" type="button">Redo</button>
      </div>
      <div class="field">
        <label class="lbl" for="pq">Question</label>
        <input id="pq" type="text" autocomplete="off" placeholder="Who takes the main event">
      </div>
      <p class="note">The question prints across the top of every tile. Each option renders 640 by 640.</p>
    </div>
    <div class="card">
      <div class="chead">
        <h2>Options</h2>
        <span class="grow"></span>
        <button class="mini" id="pollAdd" type="button">Add option</button>
        <button class="mini" id="pollCopy" type="button">Copy poll text</button>
      </div>
      <div id="pollRows"></div>
      <p class="note" style="margin-top:9px">Drag a tile to pan its photo. The zoom slider sits under each one.</p>
    </div>
    <div class="card">
      <div class="grid2">
        <button class="btn pri" id="pollDl" type="button">Download all tiles</button>
        <a class="btn ghost" href="https://www.youtube.com/channel/UCPx5FFZkK2N5yQ-jiTcS3mg/community" target="_blank" rel="noopener noreferrer">Open YouTube composer &rarr;</a>
      </div>
    </div>
  </div>
</section>

<!-- ============================ SETTINGS ============================ -->
<section class="view" id="view-set" role="tabpanel" aria-labelledby="tab-set" hidden>
  <div class="stack" style="max-width:560px;margin:0 auto">
    <div class="card">
      <div class="chead"><h2>AI key</h2></div>
      <p class="note" style="margin-bottom:12px">The bot uses this key when it scores stories. It is stored server side and never shown back to this page. Nothing on this page calls the model.</p>
      <div class="field">
        <label class="lbl">Provider</label>
        <div class="seg sm" role="group" aria-label="AI provider" id="provSeg">
          <button data-prov="deepseek" type="button" aria-pressed="true">DeepSeek</button>
          <button data-prov="openrouter" type="button" aria-pressed="false">OpenRouter</button>
        </div>
      </div>
      <div class="field">
        <label class="lbl" for="aikey">Key</label>
        <input id="aikey" type="password" autocomplete="off" placeholder="Paste the key">
      </div>
      <button class="btn pri" id="keySave" type="button" style="width:100%">Save key</button>
      <div class="keyrow">
        <span class="badge off" id="keyDeep">DeepSeek: checking</span>
        <span class="badge off" id="keyOpen">OpenRouter: checking</span>
      </div>
    </div>
    <div class="card">
      <div class="chead"><h2>Storage</h2></div>
      <p class="note" id="storeNote">Drafts live in this browser only.</p>
      <button class="btn" id="wipeBtn" type="button" style="width:100%;margin-top:10px">Forget saved drafts</button>
    </div>
    <div class="card">
      <div class="chead"><h2>Session</h2></div>
      <button class="btn warn" id="logout" type="button" style="width:100%">Log out</button>
    </div>
  </div>
</section>

</main>
<div id="toast" role="status" aria-live="polite"></div>

<script>
(function () {
"use strict";

/* ================= constants that mirror postcard.py ================= */
var W = 1080, H = 1350;
var ASPECTS = { "4:5": 1350, "1:1": 1080, "9:16": 1920 };
var PAL = {
  accent: "#8B70FF", hot: "#A45CFF", deep: "#5B3DF5",
  ink: "#0B0B0E", inkSoft: "#17141F", paper: "#F5F4F6", dim: "#B9B5C4"
};
var S = {
  margin: 112, lines: 3,
  lineMax: 175, lineMaxSolo: 240, lineMin: 64,
  track: 0.030, wordSpace: 1.28, squeeze: 0.90, spacing: 0.98, ascent: 1.05,
  seamReach: 470, seamMax: 0.92, seamTint: "24,19,51",
  band: 0.30, vignette: 0.14, topScrim: 0.16, sideScrim: 0.20,
  footerSize: 34, footerTrack: 4, creditGap: 30,
  quoteSize: 50, quoteGap: 40, ruleW: 130, ruleGap: 28,
  insetSide: 180, insetBorder: 5, insetRadius: 12, insetGap: 48, insetDx: 0.21, badgeSide: 64,
  barFrac: 0.055, barGap: 0.05,
  zoom: 1.32, zoomCy: 0.30, focusY: 0.30,
  footerBar: 10, nophotoLift: 0.16
};
var TEMPLATES = [
  { id: "quote",  name: "Quote", art: "quote" },
  { id: "inset",  name: "Quote + inset", art: "inset" },
  { id: "state",  name: "Statement", art: "state" },
  { id: "stat",   name: "Stat compare", art: "stat" },
  { id: "versus", name: "Versus", art: "versus" }
];
/* the highlight palette. The references use red and orange, the brand is purple,
   and white pairs with a dimmed rest-of-line so it still reads as a highlight. */
var HL = [
  { id: "purple", label: "Brand", hex: "#A45CFF" },
  { id: "red",    label: "Red",   hex: "#FF3B30" },
  { id: "orange", label: "Orange",hex: "#FF8A1F" },
  { id: "white",  label: "White", hex: "#FFFFFF" }
];
function hlHex() {
  for (var i = 0; i < HL.length; i++) if (HL[i].id === state.hlColor) return HL[i].hex;
  return HL[0].hex;
}
function baseHex() { return state.hlColor === "white" ? "rgba(245,244,246,0.52)" : "#FFFFFF"; }
function blockH() { return Math.round(H * 0.385); }

/* ================= assets =================
   One registry. state holds only asset KEYS, so a history snapshot of state is
   enough to restore which photo sat in which slot, and a saved document only has
   to carry the pixels once. */
var assets = {}, assetMeta = {}, assetURL = {}, assetSeq = 0;
function put(img, meta, url) {
  var k = "a" + (++assetSeq);
  assets[k] = img; assetMeta[k] = meta || null; assetURL[k] = url || null;
  return k;
}
function putAt(k, img, meta, url) {
  assets[k] = img; assetMeta[k] = meta || null; assetURL[k] = url || null;
  var n = parseInt(String(k).replace(/[^0-9]/g, ""), 10);
  if (n && n > assetSeq) assetSeq = n;
}
function get(k) { return k && assets[k] ? assets[k] : null; }
function urlOf(k) { return k && assetURL[k] ? assetURL[k] : null; }
/* a downscaled JPEG copy, which is what gets written to storage. A cross-origin
   photo taints the canvas, so that path stores the URL and refetches on restore. */
function toData(img) {
  try {
    var iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
    if (!iw || !ih) return null;
    var m = Math.min(1, 1400 / Math.max(iw, ih));
    var c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(iw * m));
    c.height = Math.max(1, Math.round(ih * m));
    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", 0.85);
  } catch (e) { return null; }
}

/* ================= state ================= */
function blankState() {
  return {
    v: 2,
    template: "quote", aspect: "4:5",
    line: "GARRY IS A REAL THREAT TO MAKHACHEV",
    hot: { "GARRY#0": true, "THREAT#0": true },
    hlMode: "color", hlColor: "purple",
    speaker: "Daniel Cormier", source: "ESPN", about: "",
    caption: "",
    clean: false, fitMode: "punch",
    photo: { id: null, zoom: 1, panX: 0, panY: 0 },
    inset: { id: null, dx: S.insetDx, dy: 0, scale: 1, shape: "square" },
    left: { id: null, zoom: 1, panX: 0, panY: 0 },
    right: { id: null, zoom: 1, panX: 0, panY: 0 },
    textDX: 0, textDY: 0, textScale: 1, grad: 1,
    tpl: {},
    versus: { left: "MAKHACHEV", right: "DELLA MADDALENA", event: "Welterweight title", date: "Nov 15 - Philadelphia" },
    stat: { title: "LAST 10 WINS", l1: "8 FINISHES", l2: "2 DECISIONS", r1: "3 FINISHES", r2: "7 DECISIONS" }
  };
}
var state = blankState();
var layer = "text";
var layout = { text: null, inset: null, photo: null, left: null, right: null };
var fontsReady = false;
var drawCount = 0, fitCount = 0, wrapCount = 0;

/* keys that are replaced wholesale on merge instead of being filled in from the
   defaults: an empty hot map means the owner cleared every highlight. */
var REPLACE = { hot: 1, tpl: 1 };
function mergeState(s) {
  var b = blankState();
  if (!s || typeof s !== "object") return b;
  Object.keys(b).forEach(function (k) {
    var v = s[k];
    if (v === undefined || v === null) return;
    if (REPLACE[k]) { if (typeof v === "object") b[k] = v; return; }
    if (b[k] && typeof b[k] === "object" && !Array.isArray(b[k]) && typeof v === "object") {
      var o = {};
      Object.keys(b[k]).forEach(function (k2) { o[k2] = (v[k2] === undefined ? b[k][k2] : v[k2]); });
      b[k] = o;
    } else if (typeof v === typeof b[k]) b[k] = v;
  });
  if (!ASPECTS[b.aspect]) b.aspect = "4:5";
  return b;
}

/* ================= history: state carries the photo slots ================= */
var hist = [], redoStack = [], HIST_MAX = 60;
function snap() {
  try { hist.push(JSON.stringify(state)); } catch (e) { return; }
  if (hist.length > HIST_MAX) hist.shift();
  redoStack.length = 0;
  syncHist();
}
function undo() {
  if (!hist.length) { toast("Nothing left to undo"); return; }
  try { redoStack.push(JSON.stringify(state)); state = JSON.parse(hist.pop()); }
  catch (e) { return; }
  afterHist();
}
function redo() {
  if (!redoStack.length) { toast("Nothing to redo"); return; }
  try { hist.push(JSON.stringify(state)); state = JSON.parse(redoStack.pop()); }
  catch (e) { return; }
  afterHist();
}
function afterHist() {
  applyAspect();
  syncHist(); syncInputs(); drawNow(); scheduleSave();
}
function syncHist() {
  $("undoBtn").disabled = hist.length === 0;
  $("redoBtn").disabled = redoStack.length === 0;
}

/* ================= tiny dom helpers ================= */
function $(id) { return document.getElementById(id); }
function el(tag, cls, txt) {
  var n = document.createElement(tag);
  if (cls) n.className = cls;
  if (txt != null) n.textContent = txt;
  return n;
}
var toastT = 0;
function toast(m) {
  var t = $("toast");
  t.textContent = m; t.classList.add("on");
  clearTimeout(toastT);
  toastT = setTimeout(function () { t.classList.remove("on"); }, 2200);
}
function press(node, on) { if (node) node.setAttribute("aria-pressed", on ? "true" : "false"); }

/* ================= color + geometry ================= */
function rgbOf(hex) {
  var h = hex.replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)].join(",");
}
function roundRect(ctx, x, y, w, h, r) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y); ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r); ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h); ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r); ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}
function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

/* ================= canvas texture primitives ================= */
var supportsFilter = (function () {
  try { var c = document.createElement("canvas").getContext("2d"); c.filter = "contrast(1.1)"; return c.filter !== "none"; }
  catch (e) { return false; }
})();

function seamGrad(ctx, top, maxA) {
  top = clamp(top, 0, H - 2);
  var g = ctx.createLinearGradient(0, top, 0, H);
  for (var i = 0; i <= 12; i++) {
    var t = i / 12, s = t * t * (3 - 2 * t);
    g.addColorStop(t, "rgba(" + S.seamTint + "," + (maxA * s).toFixed(4) + ")");
  }
  ctx.fillStyle = g; ctx.fillRect(0, top, W, H - top);
}
function bandScrim(ctx, y0, y1, strength, feather) {
  var ink = rgbOf(PAL.ink);
  ctx.fillStyle = "rgba(" + ink + "," + strength.toFixed(3) + ")";
  ctx.fillRect(0, y0, W, Math.max(0, y1 - y0));
  var gu = ctx.createLinearGradient(0, y0 - feather, 0, y0);
  gu.addColorStop(0, "rgba(" + ink + ",0)"); gu.addColorStop(1, "rgba(" + ink + "," + strength.toFixed(3) + ")");
  ctx.fillStyle = gu; ctx.fillRect(0, y0 - feather, W, feather);
  var gd = ctx.createLinearGradient(0, y1, 0, y1 + feather);
  gd.addColorStop(0, "rgba(" + ink + "," + strength.toFixed(3) + ")"); gd.addColorStop(1, "rgba(" + ink + ",0)");
  ctx.fillStyle = gd; ctx.fillRect(0, y1, W, feather);
}
function vignette(ctx, strength, gamma, w, h) {
  w = w || W; h = h || H;
  ctx.save();
  ctx.translate(w / 2, h / 2); ctx.scale(1, h / w);
  var r = w / 2, g = ctx.createRadialGradient(0, 0, 0, 0, 0, r), ink = rgbOf(PAL.ink);
  for (var i = 0; i <= 8; i++) {
    var t = i / 8;
    g.addColorStop(t, "rgba(" + ink + "," + (Math.pow(t, gamma) * strength).toFixed(4) + ")");
  }
  ctx.fillStyle = g; ctx.fillRect(-w, -h, w * 2, h * 2);
  ctx.restore();
}
function glow(ctx, x, y, r, hex, strength) {
  var g = ctx.createRadialGradient(x, y, 0, x, y, r), c = rgbOf(hex);
  for (var i = 0; i <= 8; i++) {
    var t = i / 8;
    g.addColorStop(t, "rgba(" + c + "," + (Math.pow(1 - t, 1.8) * strength).toFixed(4) + ")");
  }
  ctx.save(); ctx.globalCompositeOperation = "screen";
  ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2); ctx.restore();
}
var grainTile = null;
function grain(ctx, amount, w, h) {
  if (!grainTile) {
    grainTile = document.createElement("canvas");
    grainTile.width = grainTile.height = 168;
    var g = grainTile.getContext("2d"), d = g.createImageData(168, 168);
    for (var i = 0; i < d.data.length; i += 4) {
      var v = 128 + (Math.random() - 0.5) * 104;
      d.data[i] = d.data[i + 1] = d.data[i + 2] = v; d.data[i + 3] = 255;
    }
    g.putImageData(d, 0, 0);
  }
  ctx.save();
  ctx.globalAlpha = amount; ctx.globalCompositeOperation = "overlay";
  ctx.fillStyle = ctx.createPattern(grainTile, "repeat");
  ctx.fillRect(0, 0, w || W, h || H);
  ctx.restore();
}
function footerBar(ctx) {
  var g = ctx.createLinearGradient(0, 0, W, 0);
  g.addColorStop(0, PAL.deep); g.addColorStop(1, PAL.accent);
  ctx.fillStyle = g; ctx.fillRect(0, H - S.footerBar, W, S.footerBar);
}

/* ================= photo drawing =================
   mode "punch" = cover crop plus the postcard punch-in, "cover" = plain cover,
   "fit"   = the whole photo inside the frame, which is the zoom floor. */
function drawPhoto(ctx, img, ps, dx, dy, dw, dh, mode) {
  var iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
  if (!iw || !ih) return;
  var z = ps.zoom || 1;
  var graded = supportsFilter && !state.clean;
  if (mode === "fit") {
    var s = Math.min(dw / iw, dh / ih) * z;
    var w = iw * s, h = ih * s;
    var px = clamp(ps.panX || 0, -dw / 2, dw / 2), py = clamp(ps.panY || 0, -dh / 2, dh / 2);
    ctx.save();
    ctx.beginPath(); ctx.rect(dx, dy, dw, dh); ctx.clip();
    ctx.fillStyle = PAL.ink; ctx.fillRect(dx, dy, dw, dh);
    if (graded) ctx.filter = "contrast(1.06) saturate(0.99)";
    ctx.drawImage(img, dx + (dw - w) / 2 + px, dy + (dh - h) / 2 + py, w, h);
    ctx.restore();
    return;
  }
  var punch = mode === "punch" ? S.zoom : 1;
  var s0 = Math.max(dw / iw, dh / ih);
  var sw0 = dw / s0, sh0 = dh / s0;
  var sx0 = (iw - sw0) * 0.5, sy0 = (ih - sh0) * S.focusY;
  var zz = punch * z;
  var w2 = dw / zz, h2 = dh / zz;
  var cy = clamp(dh * S.zoomCy, h2 / 2, dh - h2 / 2);
  var sx = sx0 + (dw / 2 - w2 / 2) / s0 - (ps.panX || 0) / s0;
  var sy = sy0 + (cy - h2 / 2) / s0 - (ps.panY || 0) / s0;
  var sw = w2 / s0, sh = h2 / s0;
  sx = clamp(sx, 0, Math.max(0, iw - sw));
  sy = clamp(sy, 0, Math.max(0, ih - sh));
  ctx.save();
  if (graded) ctx.filter = "contrast(1.10) saturate(0.98) brightness(1.03)";
  ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh);
  ctx.restore();
}
function mainMode() { return state.fitMode === "fit" ? "fit" : "punch"; }
function halfMode() { return state.fitMode === "fit" ? "fit" : "cover"; }
function photoDressing(ctx) {
  ctx.save();
  ctx.globalCompositeOperation = "soft-light";
  ctx.globalAlpha = 0.22;
  ctx.fillStyle = "#FF8A3D"; ctx.fillRect(0, 0, W, H);
  ctx.restore();
  var ink = rgbOf(PAL.ink);
  var gl = ctx.createLinearGradient(0, 0, W * 0.34, 0);
  gl.addColorStop(0, "rgba(" + ink + "," + S.sideScrim + ")"); gl.addColorStop(1, "rgba(" + ink + ",0)");
  ctx.fillStyle = gl; ctx.fillRect(0, 0, W * 0.34, H);
  var gr = ctx.createLinearGradient(W, 0, W * 0.66, 0);
  gr.addColorStop(0, "rgba(" + ink + "," + S.sideScrim + ")"); gr.addColorStop(1, "rgba(" + ink + ",0)");
  ctx.fillStyle = gr; ctx.fillRect(W * 0.66, 0, W * 0.34, H);
  var gt = ctx.createLinearGradient(0, 0, 0, H * 0.26);
  gt.addColorStop(0, "rgba(" + ink + "," + S.topScrim + ")"); gt.addColorStop(1, "rgba(" + ink + ",0)");
  ctx.fillStyle = gt; ctx.fillRect(0, 0, W, H * 0.26);
}
function glowField(ctx) {
  var g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, PAL.inkSoft); g.addColorStop(1, PAL.ink);
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  glow(ctx, W / 2, H * 0.46, 900, PAL.deep, 0.36);
  glow(ctx, W * 0.14, H * 0.04, 520, PAL.deep, 0.16);
  glow(ctx, W * 0.86, H * 0.04, 520, PAL.deep, 0.16);
}
function coverInto(ctx, img, x, y, w, h, ps) {
  drawPhoto(ctx, img, ps || { zoom: 1, panX: 0, panY: 0 }, x, y, w, h, "cover");
}

/* ================= type engine (mirrors _tracked / _display_block) ================= */
function setFont(ctx, weight, size) { ctx.font = weight + " " + size + "px Poppins, sans-serif"; }
function adv(ctx, ch, tr) {
  if (ch === " ") return ctx.measureText(" ").width * S.wordSpace;
  return ctx.measureText(ch).width + tr;
}
function trackedW(ctx, text, tr) {
  if (!text) return 0;
  var t = 0;
  for (var i = 0; i < text.length; i++) t += adv(ctx, text.charAt(i), tr);
  return t - tr;
}
function drawTracked(ctx, x, y, text, tr, fill) {
  ctx.fillStyle = fill;
  for (var i = 0; i < text.length; i++) {
    var ch = text.charAt(i);
    if (ch !== " ") ctx.fillText(ch, x, y);
    x += adv(ctx, ch, tr);
  }
  return x;
}
function wrap(ctx, text, maxW, tr) {
  var out = [], cur = "", ws = text.split(" ");
  for (var i = 0; i < ws.length; i++) {
    var cand = cur ? cur + " " + ws[i] : ws[i];
    if (cur && trackedW(ctx, cand, tr) > maxW) { out.push(cur); cur = ws[i]; }
    else cur = cand;
  }
  if (cur) out.push(cur);
  return out;
}
function ragOk(ctx, lines, maxW, tr) {
  if (lines.length < 2) return true;
  for (var i = 0; i < lines.length; i++) if (trackedW(ctx, lines[i], tr) < maxW * 0.30) return false;
  return true;
}
function balance(ctx, words, k, maxW, tr) {
  var n = words.length;
  if (k < 2 || n <= k || n > 24) return null;
  var best = null, bestCost = null, idx = [];
  (function rec(start, depth) {
    if (depth === k - 1) {
      var b = [0].concat(idx.slice(0, k - 1), [n]), ws = [], total = 0;
      for (var t = 0; t < k; t++) {
        var w = trackedW(ctx, words.slice(b[t], b[t + 1]).join(" "), tr);
        if (w > maxW) return;
        ws.push(w); total += w;
      }
      var mean = total / k, c = 0;
      for (t = 0; t < k; t++) c += (ws[t] - mean) * (ws[t] - mean);
      if (bestCost === null || c < bestCost) { bestCost = c; best = b; }
      return;
    }
    for (var i = start; i < n; i++) { idx[depth] = i; rec(i + 1, depth + 1); }
  })(1, 0);
  if (!best) return null;
  var out = [];
  for (var t2 = 0; t2 < k; t2++) out.push(words.slice(best[t2], best[t2 + 1]).join(" "));
  return out;
}
function fitLine(ctx, text, maxW, maxH, maxLines, hi, lo) {
  text = (text || "").toUpperCase().replace(/\\s+/g, " ").trim();
  if (!text) return { size: lo, lines: [] };
  var first = null, size, tr, lines, i, ok;
  for (size = hi; size >= lo; size -= 4) {
    setFont(ctx, 900, size);
    tr = -Math.round(size * S.track);
    lines = wrap(ctx, text, maxW, tr);
    ok = lines.length > 0 && lines.length <= maxLines && lines.length * Math.round(size * 1.06) <= maxH;
    if (ok) for (i = 0; i < lines.length; i++) if (trackedW(ctx, lines[i], tr) > maxW) { ok = false; break; }
    if (ok) {
      var bal = balance(ctx, text.split(" "), lines.length, maxW, tr);
      if (bal) lines = bal;
      if (ragOk(ctx, lines, maxW, tr)) return { size: size, lines: lines };
      if (!first) first = { size: size, lines: lines };
    }
  }
  if (first) return first;
  setFont(ctx, 900, lo);
  tr = -Math.round(lo * S.track);
  return { size: lo, lines: wrap(ctx, text, maxW, tr).slice(0, maxLines) };
}
/* Dragging a layer changes position only, so the expensive size search and the
   line balancer are memoised on everything that actually affects them. A drag
   frame reuses both and costs one repaint. */
var fitCache = { k: null, v: null }, lineCache = { k: null, v: null };
function cachedFit(text, maxW, maxH, maxLines, hi, lo) {
  var k = [text, maxW, maxH, maxLines, hi, lo, fontsReady].join("|");
  if (fitCache.k === k) return fitCache.v;
  fitCache.k = k; fitCache.v = fitLine(ctx, text, maxW, maxH, maxLines, hi, lo);
  fitCount++;
  return fitCache.v;
}
function cachedLines(text, size, maxW) {
  var k = [text, size, maxW, fontsReady].join("|");
  if (lineCache.k === k) return lineCache.v;
  setFont(ctx, 900, size);
  var tr = -Math.round(size * S.track);
  var ls = wrap(ctx, text, maxW, tr);
  var bal = balance(ctx, text.split(" "), ls.length, maxW, tr);
  if (bal) ls = bal;
  lineCache.k = k; lineCache.v = { lines: ls, tr: tr };
  wrapCount++;
  return lineCache.v;
}
function fitSingle(ctx, text, weight, maxW, hi, lo, trackFrac) {
  text = (text || "").toUpperCase().replace(/\\s+/g, " ").trim();
  for (var size = hi; size >= lo; size -= 2) {
    setFont(ctx, weight, size);
    var tr = -Math.round(size * trackFrac);
    if (trackedW(ctx, text, tr) <= maxW) return { size: size, tr: tr };
  }
  return { size: lo, tr: -Math.round(lo * trackFrac) };
}
function barCore(word) {
  var c = word;
  while (c.length && !/[A-Za-z0-9']/.test(c.charAt(c.length - 1))) c = c.slice(0, -1);
  return c;
}

/* the display block. Any word can be hot, including one word and every word:
   there is no word-count gate, so a fully highlighted line paints in full. */
function drawBlock(ctx, lines, size, cx, top, tr, lh, isHot, mode, hot, base) {
  var sq = S.squeeze;
  hot = hot || PAL.hot; base = base || "#FFFFFF";
  ctx.save();
  ctx.scale(sq, 1);
  setFont(ctx, 900, size);
  ctx.textBaseline = "alphabetic";
  ctx.shadowColor = "rgba(0,0,0,0.66)"; ctx.shadowBlur = 20; ctx.shadowOffsetY = 5;
  var barH = Math.max(6, Math.round(size * S.barFrac));
  var barGap = Math.max(4, Math.round(size * S.barGap));
  var wi = 0, yy = top, minX = 1e9, maxX = -1e9;
  for (var li = 0; li < lines.length; li++) {
    var ws = lines[li].split(" ");
    var lw = trackedW(ctx, lines[li], tr);
    var x = cx / sq - lw / 2;
    minX = Math.min(minX, x * sq); maxX = Math.max(maxX, (x + lw) * sq);
    var base0 = yy + size * S.ascent;
    for (var k = 0; k < ws.length; k++) {
      var word = ws[k], on = isHot(wi); wi++;
      var col = (on && mode === "color") ? hot : base;
      var x0 = x;
      x = drawTracked(ctx, x, base0, word, tr, col);
      if (on && mode === "underline") {
        var core = barCore(word);
        if (core) {
          roundRect(ctx, x0, base0 + barGap, trackedW(ctx, core, tr), barH, barH / 2);
          ctx.fillStyle = hot; ctx.fill();
        }
      }
      if (k < ws.length - 1) x += adv(ctx, " ", tr);
    }
    yy += lh;
  }
  ctx.restore();
  return { x: minX, y: top, w: Math.max(1, maxX - minX), h: lines.length * lh };
}

/* ================= the quote glyph (mirrors _comma / _quote_pair) ================= */
function comma(ctx, cx, cy, r, color, flip) {
  var s = flip ? -1 : 1;
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
  var p0 = [cx + s * r * 0.60, cy + s * r * 0.35];
  var p1 = [cx + s * r * 1.05, cy + s * r * 1.75];
  var p2 = [cx - s * r * 0.15, cy + s * r * 2.55];
  var left = [], right = [], steps = 9;
  for (var i = 0; i <= steps; i++) {
    var t = i / steps, mt = 1 - t;
    var x = mt * mt * p0[0] + 2 * mt * t * p1[0] + t * t * p2[0];
    var y = mt * mt * p0[1] + 2 * mt * t * p1[1] + t * t * p2[1];
    var dx = 2 * mt * (p1[0] - p0[0]) + 2 * t * (p2[0] - p1[0]);
    var dy = 2 * mt * (p1[1] - p0[1]) + 2 * t * (p2[1] - p1[1]);
    var ln = Math.max(1e-6, Math.sqrt(dx * dx + dy * dy));
    var wd = r * (0.72 * (1 - t) + 0.10);
    left.push([x - dy / ln * wd, y + dx / ln * wd]);
    right.push([x + dy / ln * wd, y - dx / ln * wd]);
  }
  var pts = left.concat(right.reverse());
  ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
  for (i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath(); ctx.fill();
}
function quotePair(ctx, x, cy, size, color, opening) {
  var r = Math.max(3, Math.round(size * 0.26));
  var step = Math.round(r * 2.6);
  var bcy = cy + (opening ? Math.round(r * 0.75) : -Math.round(r * 0.75));
  comma(ctx, x + r, bcy, r, color, opening);
  comma(ctx, x + r + step, bcy, r, color, opening);
  return step + 2 * r;
}
function quoteMarks(ctx, cx, cy, size) {
  var r = Math.max(3, Math.round(size * 0.26));
  var pw = Math.round(r * 2.6) + 2 * r;
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.5)"; ctx.shadowBlur = 14; ctx.shadowOffsetY = 4;
  quotePair(ctx, cx - pw / 2, cy, size, hlHex(), true);
  ctx.fillStyle = "rgba(245,244,246,0.80)";
  roundRect(ctx, cx - pw / 2 - S.ruleGap - S.ruleW, cy - 2, S.ruleW, 5, 2.5); ctx.fill();
  roundRect(ctx, cx + pw / 2 + S.ruleGap, cy - 2, S.ruleW, 5, 2.5); ctx.fill();
  ctx.restore();
  return Math.round(size * 0.94);
}

/* ================= inset card ================= */
function drawInset(ctx, img, cx, bottom, badge, side, shape) {
  var b = S.insetBorder, full = side + 2 * b, rad = shape === "circle" ? full / 2 : S.insetRadius;
  var x0 = cx - full / 2, y0 = bottom - full;
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.67)"; ctx.shadowBlur = 34; ctx.shadowOffsetY = 9;
  roundRect(ctx, x0, y0, full, full, rad);
  ctx.fillStyle = "#FFFFFF"; ctx.fill();
  ctx.restore();
  ctx.save();
  roundRect(ctx, x0 + b, y0 + b, side, side, shape === "circle" ? side / 2 : Math.max(2, rad - b));
  ctx.clip();
  if (img) coverInto(ctx, img, x0 + b, y0 + b, side, side);
  else {
    var g = ctx.createLinearGradient(0, y0, 0, y0 + full);
    g.addColorStop(0, "#2A2242"); g.addColorStop(1, PAL.inkSoft);
    ctx.fillStyle = g; ctx.fillRect(x0 + b, y0 + b, side, side);
  }
  ctx.restore();
  if (badge) {
    var bs = Math.round(side * (S.badgeSide / S.insetSide));
    var bx = x0 + full * 0.20 - bs / 2, by = y0 + full - bs / 2;
    roundRect(ctx, bx, by, bs, bs, bs * 0.22);
    ctx.fillStyle = PAL.accent; ctx.fill();
    var qs = bs * 0.46, qr = Math.max(3, Math.round(qs * 0.26));
    var qw = Math.round(qr * 2.6) + 2 * qr;
    quotePair(ctx, bx + (bs - qw) / 2, by + bs / 2, qs, "#FFFFFF", true);
  }
  return { x: x0, y: y0, w: full, h: full };
}

/* ================= footer ================= */
function footerSegs(spk, src, ab) {
  var segs = [];
  if (spk) {
    if (ab) { segs.push([spk, "accent"]); segs.push([" ON " + ab + (src ? "," : ""), "plain"]); }
    else segs.push([spk + (src ? "," : ""), "accent"]);
    if (src) segs.push([" VIA " + src, "muted"]);
  } else if (src) segs.push(["VIA " + src, "muted"]);
  return segs;
}
function drawFooter(ctx, segs, y, dx) {
  var tr = S.footerTrack, size = S.footerSize, total = 0, i;
  while (true) {
    setFont(ctx, 800, size);
    total = 0;
    for (i = 0; i < segs.length; i++) total += trackedW(ctx, segs[i][0], tr);
    if (total <= W - 2 * S.margin || size <= 18) break;
    size -= 2;
  }
  var cols = { accent: hlHex(), plain: PAL.paper, muted: PAL.dim };
  var x = W / 2 + (dx || 0) - total / 2, base = y + size * S.ascent;
  ctx.save();
  ctx.textBaseline = "alphabetic";
  ctx.shadowColor = "rgba(0,0,0,0.6)"; ctx.shadowBlur = 12; ctx.shadowOffsetY = 3;
  for (i = 0; i < segs.length; i++) x = drawTracked(ctx, x, base, segs[i][0], tr, cols[segs[i][1]] || cols.muted);
  ctx.restore();
}

/* ================= words and the highlight map =================
   Highlights are keyed by the WORD, plus an occurrence index when the same word
   repeats, so editing the line never slides a highlight onto its neighbour. */
function words() {
  var t = (state.line || "").trim();
  return t ? t.toUpperCase().split(/\\s+/) : [];
}
function normWord(w) { return String(w || "").toUpperCase().replace(/[^A-Z0-9']/g, ""); }
function wordKeys(ws) {
  ws = ws || words();
  var seen = {}, out = [];
  for (var i = 0; i < ws.length; i++) {
    var n = normWord(ws[i]);
    seen[n] = (seen[n] === undefined ? 0 : seen[n] + 1);
    out.push(n + "#" + seen[n]);
  }
  return out;
}
function hotCount() {
  var ks = wordKeys(), n = 0;
  for (var i = 0; i < ks.length; i++) if (state.hot[ks[i]]) n++;
  return n;
}
function pruneHot() {
  var ks = wordKeys(), live = {};
  ks.forEach(function (k) { live[k] = 1; });
  Object.keys(state.hot).forEach(function (k) { if (!live[k]) delete state.hot[k]; });
}

/* ================= the news / quote / statement poster ================= */
function drawNews(ctx) {
  var isState = state.template === "state";
  var wantInset = state.template === "inset";
  var ph = get(state.photo.id);
  layout.photo = { x: 0, y: 0, w: W, h: H };
  layout.left = null; layout.right = null;
  if (ph) {
    drawPhoto(ctx, ph, state.photo, 0, 0, W, H, mainMode());
    if (!state.clean) photoDressing(ctx);
  } else glowField(ctx);

  var ws = words(), keys = wordKeys(ws), m = S.margin, sq = S.squeeze;
  var allHot = ws.length > 0 && hotCount() === ws.length;
  var spk = (state.speaker || "").trim().toUpperCase().replace(/\\s+/g, " ");
  var src = (state.source || "").trim().toUpperCase().replace(/\\s+/g, " ");
  var ab = (state.about || "").trim().toUpperCase().replace(/\\s+/g, " ");
  var segs = footerSegs(spk, src, ab);

  var y = H - m;
  if (!ph) y -= H * S.nophotoLift;
  var footY = null;
  if (segs.length) { y -= S.footerSize; footY = y; y -= S.creditGap; }

  var maxW = (W - 2 * m) / sq;
  var maxLines = isState ? 2 : S.lines;
  var hi = (allHot || isState) ? S.lineMaxSolo : S.lineMax;
  var joined = ws.join(" ");
  var fit = cachedFit(joined, maxW, blockH(), maxLines, hi, S.lineMin);
  var size = Math.max(28, Math.round(fit.size * state.textScale));
  var lc = cachedLines(joined, size, maxW);
  var lines = lc.lines, tr = lc.tr;
  setFont(ctx, 900, size);
  var lh = Math.round(size * S.spacing);

  if (state.hlMode === "underline" && lines.length) {
    var last = lines[lines.length - 1].split(" ").length;
    var from = ws.length - last, anyHot = false;
    for (var q = from; q < ws.length; q++) if (state.hot[keys[q]]) anyHot = true;
    if (anyHot) y -= Math.round(size * (S.barFrac + S.barGap));
  }

  var dy = state.textDY, dx = state.textDX;
  var hy = y - lines.length * lh + dy;
  var cx = W / 2 + dx;
  if (footY !== null) footY += dy;
  var blockBottom = y + dy;

  seamGrad(ctx, hy - S.seamReach, S.seamMax * clamp(state.grad, 0, 1.35));
  if (!state.clean) vignette(ctx, S.vignette, 2.4);
  if (ph && !state.clean) bandScrim(ctx, hy - 12, blockBottom + 14, S.band * clamp(state.grad, 0, 1.4), 170);

  var quoted = !isState && (wantInset || !!spk) && lines.length > 0;
  var insetImg = get(state.inset.id);
  layout.inset = null;
  if (wantInset && quoted) {
    var side = Math.round(S.insetSide * clamp(state.inset.scale, 0.6, 2.2));
    var icx = W * (0.5 + state.inset.dx);
    var ibot = hy - S.insetGap + state.inset.dy;
    layout.inset = drawInset(ctx, insetImg, icx, ibot, true, side, state.inset.shape);
  } else if (quoted) {
    var devH = Math.round(S.quoteSize * 0.94);
    quoteMarks(ctx, cx, hy - S.quoteGap - devH / 2, S.quoteSize);
  }

  layout.text = drawBlock(ctx, lines, size, cx, hy, tr, lh,
    function (i) { return !!state.hot[keys[i]]; },
    state.hlMode, hlHex(), baseHex());

  if (footY !== null) drawFooter(ctx, segs, footY, dx);
}

/* ================= stat compare ================= */
function pairBackground(ctx) {
  var l = get(state.left.id), r = get(state.right.id);
  layout.left = { x: 0, y: 0, w: W / 2, h: H };
  layout.right = { x: W / 2, y: 0, w: W / 2, h: H };
  layout.photo = layout.left;
  ctx.fillStyle = PAL.ink; ctx.fillRect(0, 0, W, H);
  if (l) drawPhoto(ctx, l, state.left, 0, 0, W / 2, H, halfMode());
  else { ctx.fillStyle = PAL.inkSoft; ctx.fillRect(0, 0, W / 2, H); }
  if (r) drawPhoto(ctx, r, state.right, W / 2, 0, W / 2, H, halfMode());
  else { ctx.fillStyle = PAL.inkSoft; ctx.fillRect(W / 2, 0, W / 2, H); }
  if (!l && !r) glowField(ctx);
  var ink = rgbOf(PAL.ink);
  var g = ctx.createLinearGradient(W / 2 - 130, 0, W / 2 + 130, 0);
  g.addColorStop(0, "rgba(" + ink + ",0)");
  g.addColorStop(0.5, "rgba(" + ink + ",0.86)");
  g.addColorStop(1, "rgba(" + ink + ",0)");
  ctx.fillStyle = g; ctx.fillRect(W / 2 - 130, 0, 260, H);
  if (!state.clean) {
    var gt = ctx.createLinearGradient(0, 0, 0, H * 0.22);
    gt.addColorStop(0, "rgba(" + ink + ",0.24)"); gt.addColorStop(1, "rgba(" + ink + ",0)");
    ctx.fillStyle = gt; ctx.fillRect(0, 0, W, H * 0.22);
  }
}
function tapeBand(ctx, cx, cy, h, w) {
  var x0 = cx - w / 2, y0 = cy - h / 2;
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.55)"; ctx.shadowBlur = 26; ctx.shadowOffsetY = 8;
  ctx.beginPath();
  ctx.moveTo(x0, y0 + 10);
  ctx.lineTo(x0 + w * 0.36, y0 + 2);
  ctx.lineTo(x0 + w * 0.72, y0 + 9);
  ctx.lineTo(x0 + w, y0);
  ctx.lineTo(x0 + w - 6, y0 + h - 4);
  ctx.lineTo(x0 + w * 0.62, y0 + h + 4);
  ctx.lineTo(x0 + w * 0.28, y0 + h - 6);
  ctx.lineTo(x0 + 4, y0 + h + 2);
  ctx.closePath();
  ctx.fillStyle = "#EDEBF1"; ctx.fill();
  ctx.restore();
}
function drawStat(ctx) {
  pairBackground(ctx);
  var dy = state.textDY, dx = state.textDX, ink = rgbOf(PAL.ink);
  var gb = ctx.createLinearGradient(0, H * 0.42, 0, H);
  gb.addColorStop(0, "rgba(" + ink + ",0)");
  gb.addColorStop(1, "rgba(" + S.seamTint + "," + (0.90 * clamp(state.grad, 0, 1.3)).toFixed(3) + ")");
  ctx.fillStyle = gb; ctx.fillRect(0, H * 0.42, W, H * 0.58);
  if (!state.clean) vignette(ctx, 0.18, 2.4);

  var half = W / 2, pad = 46, colW = half - pad * 1.4;
  var rows = [state.stat.l1, state.stat.r1, state.stat.l2, state.stat.r2];
  var size = Math.round(86 * state.textScale), tr;
  while (size > 30) {
    setFont(ctx, 900, size);
    tr = -Math.round(size * 0.02);
    var fits = true;
    for (var i = 0; i < rows.length; i++) {
      if (trackedW(ctx, (rows[i] || "").toUpperCase(), tr) * S.squeeze > colW) { fits = false; break; }
    }
    if (fits) break;
    size -= 2;
  }
  setFont(ctx, 900, size);
  tr = -Math.round(size * 0.02);
  var lh = Math.round(size * 1.02);
  var bottom = H - S.margin - 8 + dy;
  var topRowY = bottom - lh * 2;
  // both axes: the whole lockup rides textDX as well as textDY.
  var cols = [half / 2 + dx, W - half / 2 + dx];
  var pairs = [[state.stat.l1, state.stat.l2], [state.stat.r1, state.stat.r2]];
  for (var c = 0; c < 2; c++) {
    for (var r2 = 0; r2 < 2; r2++) {
      var txt = (pairs[c][r2] || "").toUpperCase().replace(/\\s+/g, " ").trim();
      if (!txt) continue;
      drawBlock(ctx, [txt], size, cols[c], topRowY + r2 * lh, tr, lh,
        (function (row) { return function () { return row === 0; }; })(r2),
        "color", hlHex(), "#FFFFFF");
    }
  }
  var title = (state.stat.title || "").toUpperCase().replace(/\\s+/g, " ").trim();
  var bandCy = topRowY - Math.round(H * 0.08);
  if (title) {
    var t = fitSingle(ctx, title, 900, 720, 118, 46, 0.02);
    setFont(ctx, 900, t.size);
    var tw = trackedW(ctx, title, t.tr) * S.squeeze;
    tapeBand(ctx, W / 2 + dx, bandCy, t.size * 1.42, Math.min(W - 90, tw + 130));
    ctx.save();
    ctx.scale(S.squeeze, 1);
    ctx.textBaseline = "alphabetic";
    drawTracked(ctx, (W / 2 + dx) / S.squeeze - (tw / S.squeeze) / 2, bandCy + t.size * 0.36, title, t.tr, "#0B0B0E");
    ctx.restore();
  }
  layout.text = { x: 60 + dx, y: bandCy - 80, w: W - 120, h: (bottom - bandCy) + 90 };
  layout.inset = null;
}

/* ================= versus ================= */
function drawVersus(ctx) {
  pairBackground(ctx);
  var dy = state.textDY, dx = state.textDX, ink = rgbOf(PAL.ink);
  var gb = ctx.createLinearGradient(0, H * 0.34, 0, H);
  gb.addColorStop(0, "rgba(" + ink + ",0)");
  gb.addColorStop(1, "rgba(" + S.seamTint + "," + (0.94 * clamp(state.grad, 0, 1.3)).toFixed(3) + ")");
  ctx.fillStyle = gb; ctx.fillRect(0, H * 0.34, W, H * 0.66);
  if (!state.clean) vignette(ctx, 0.32, 2.2);

  var left = (state.versus.left || "").toUpperCase().replace(/\\s+/g, " ").trim();
  var right = (state.versus.right || "").toUpperCase().replace(/\\s+/g, " ").trim();
  var sq = S.squeeze, nameW = 980 / sq;
  var a = fitSingle(ctx, left, 900, nameW, 146, 54, S.track);
  var b = fitSingle(ctx, right, 900, nameW, 146, 54, S.track);
  var size = Math.max(30, Math.round(Math.min(a.size, b.size) * state.textScale));
  var tr = -Math.round(size * S.track), lh = Math.round(size * 0.93);
  var cx = W / 2 + dx;
  // the stack is measured on CAP edges, not em boxes: Poppins caps start 0.35em
  // under the em top and end on the baseline, so equal air above and below
  // VERSUS needs the gaps taken from those two edges (postcard round-4 fix).
  var top1 = Math.round(H * 0.46) + dy;
  var base1 = top1 + size * S.ascent;
  var vsBase = base1 + 46;
  var top2 = base1 + 86 - size * 0.35;
  var base2 = top2 + size * S.ascent;

  bandScrim(ctx, top1 + size * 0.30, base2 + 210, 0.44 * clamp(state.grad, 0, 1.4), 140);
  drawBlock(ctx, [left], size, cx, top1, tr, lh, function () { return false; }, "color", hlHex(), "#FFFFFF");
  setFont(ctx, 800, 30);
  var vw = trackedW(ctx, "VERSUS", 12);
  ctx.save();
  ctx.textBaseline = "alphabetic";
  ctx.shadowColor = "rgba(0,0,0,0.55)"; ctx.shadowBlur = 12; ctx.shadowOffsetY = 3;
  drawTracked(ctx, cx - vw / 2, vsBase, "VERSUS", 12, "#C9BBFF");
  ctx.restore();
  drawBlock(ctx, [right], size, cx, top2, tr, lh, function () { return false; }, "color", hlHex(), "#FFFFFF");

  var y3 = base2;
  var ev = (state.versus.event || "").toUpperCase().replace(/\\s+/g, " ").trim();
  if (ev) {
    setFont(ctx, 800, 30);
    var ew = trackedW(ctx, ev, 5);
    ctx.save();
    ctx.textBaseline = "alphabetic";
    ctx.shadowColor = "rgba(0,0,0,0.5)"; ctx.shadowBlur = 10; ctx.shadowOffsetY = 3;
    drawTracked(ctx, cx - ew / 2, y3 + 56, ev, 5, "#C9BBFF");
    ctx.restore();
    y3 += 56;
  }
  var dt = (state.versus.date || "").toUpperCase().replace(/\\s+/g, " ").trim();
  if (dt) {
    var parts = dt.split(" - ");
    var df = fitSingle(ctx, parts[0], 900, 900, 58, 32, 0.01);
    var dTop = y3 + 34 - df.size * 0.35;
    drawBlock(ctx, [parts[0]], df.size, cx, dTop, df.tr, Math.round(df.size * 1.1),
      function () { return false; }, "color", hlHex(), "#FFFFFF");
    if (parts[1]) {
      setFont(ctx, 500, 26);
      var cw = trackedW(ctx, parts[1], 6);
      ctx.save();
      ctx.textBaseline = "alphabetic";
      drawTracked(ctx, cx - cw / 2, dTop + df.size * S.ascent + 34, parts[1], 6, PAL.dim);
      ctx.restore();
      y3 = dTop + df.size * S.ascent + 34;
    } else y3 = dTop + df.size * S.ascent;
  }
  layout.text = { x: 70 + dx, y: top1 + size * 0.30, w: W - 140, h: Math.max(120, y3 - top1) };
  layout.inset = null;
}

/* ================= draw ================= */
var cv = $("cv"), ctx = cv.getContext("2d");
var sv = $("sel"), sctx = sv.getContext("2d");
var rafId = 0;
function requestDraw() {
  if (rafId) return;
  rafId = requestAnimationFrame(function () { rafId = 0; drawNow(); });
}
function drawNow() {
  if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
  drawCount++;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = PAL.ink; ctx.fillRect(0, 0, W, H);
  if (state.template === "stat") drawStat(ctx);
  else if (state.template === "versus") drawVersus(ctx);
  else drawNews(ctx);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.shadowColor = "transparent"; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
  if (!state.clean) grain(ctx, 0.05);
  footerBar(ctx);
  paintHud();
  paintSel();
  scheduleSave();
}
function paintHud() {
  var hud = $("hud");
  hud.innerHTML = "";
  var names = { text: "Text", photo: isPair() ? "Left" : "Photo", right: "Right", inset: "Inset" };
  ["text", "photo", "right", "inset"].forEach(function (k) {
    if (k === "inset" && state.template !== "inset") return;
    if (k === "right" && !isPair()) return;
    hud.appendChild(el("span", layer === k ? "on" : "", names[k]));
  });
}
/* the selected layer gets a real box with corner handles, drawn on an overlay
   canvas so nothing of it can reach the exported PNG. */
function selRect() {
  var r = null;
  if (layer === "text") r = layout.text;
  else if (layer === "inset") r = layout.inset;
  else if (layer === "right") r = layout.right || layout.photo;
  else r = isPair() ? layout.left : layout.photo;
  if (!r) return null;
  var pad = (layer === "text" || layer === "inset") ? 18 : -16;
  var x = r.x - pad, y = r.y - pad, w = r.w + 2 * pad, h = r.h + 2 * pad;
  x = clamp(x, 12, W - 40); y = clamp(y, 12, H - 40);
  w = clamp(w, 28, W - x - 12); h = clamp(h, 28, H - y - 12);
  return { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) };
}
function paintSel() {
  sctx.setTransform(1, 0, 0, 1, 0, 0);
  sctx.clearRect(0, 0, W, H);
  var r = selRect();
  if (!r) return;
  sctx.save();
  sctx.strokeStyle = "rgba(0,0,0,0.55)"; sctx.lineWidth = 7;
  sctx.strokeRect(r.x, r.y, r.w, r.h);
  sctx.strokeStyle = PAL.accent; sctx.lineWidth = 3;
  sctx.setLineDash([20, 14]);
  sctx.strokeRect(r.x, r.y, r.w, r.h);
  sctx.setLineDash([]);
  var hs = 24;
  [[r.x, r.y], [r.x + r.w, r.y], [r.x, r.y + r.h], [r.x + r.w, r.y + r.h]].forEach(function (p) {
    sctx.fillStyle = "#0B0B0E";
    sctx.fillRect(p[0] - hs / 2 - 2, p[1] - hs / 2 - 2, hs + 4, hs + 4);
    sctx.fillStyle = PAL.accent;
    sctx.fillRect(p[0] - hs / 2, p[1] - hs / 2, hs, hs);
  });
  sctx.restore();
}
function applyAspect() {
  var h = ASPECTS[state.aspect] || 1350;
  if (H !== h || cv.height !== h) {
    H = h;
    cv.width = W; cv.height = H;
    sv.width = W; sv.height = H;
    fitCache.k = null; lineCache.k = null;
  }
  document.documentElement.style.setProperty("--ar", (W / H).toFixed(4));
  var seg = $("aspSeg").querySelectorAll("button");
  for (var i = 0; i < seg.length; i++) press(seg[i], seg[i].dataset.asp === state.aspect);
}

/* ================= template picker ================= */
var ART = {
  quote: '<rect x="2" y="2" width="30" height="38" rx="4" fill="#20202E"/><rect x="2" y="24" width="30" height="16" rx="0" fill="#12121B"/><circle cx="15" cy="20" r="1.6" fill="#A45CFF"/><circle cx="19" cy="20" r="1.6" fill="#A45CFF"/><rect x="6" y="26" width="22" height="4" rx="1.4" fill="#EDEBF1"/><rect x="9" y="32" width="16" height="4" rx="1.4" fill="#A45CFF"/>',
  inset: '<rect x="2" y="2" width="30" height="38" rx="4" fill="#20202E"/><rect x="18" y="14" width="12" height="12" rx="2.5" fill="#EDEBF1"/><rect x="20" y="16" width="8" height="8" rx="1.5" fill="#5B3DF5"/><rect x="6" y="29" width="22" height="4" rx="1.4" fill="#EDEBF1"/><rect x="9" y="35" width="16" height="3" rx="1.4" fill="#A45CFF"/>',
  state: '<rect x="2" y="2" width="30" height="38" rx="4" fill="#20202E"/><rect x="4" y="16" width="26" height="9" rx="2" fill="#EDEBF1"/><rect x="10" y="27" width="14" height="3" rx="1.5" fill="#A45CFF"/>',
  stat: '<rect x="2" y="2" width="14" height="38" rx="4" fill="#20202E"/><rect x="18" y="2" width="14" height="38" rx="4" fill="#20202E"/><rect x="3" y="17" width="28" height="7" rx="2" fill="#EDEBF1"/><rect x="4" y="28" width="10" height="4" rx="1.4" fill="#A45CFF"/><rect x="20" y="28" width="10" height="4" rx="1.4" fill="#A45CFF"/><rect x="4" y="34" width="10" height="3" rx="1.4" fill="#7B7A8C"/><rect x="20" y="34" width="10" height="3" rx="1.4" fill="#7B7A8C"/>',
  versus: '<rect x="2" y="2" width="14" height="38" rx="4" fill="#20202E"/><rect x="18" y="2" width="14" height="38" rx="4" fill="#20202E"/><rect x="5" y="22" width="24" height="5" rx="1.6" fill="#EDEBF1"/><rect x="12" y="29" width="10" height="3" rx="1.4" fill="#A45CFF"/><rect x="5" y="34" width="24" height="4" rx="1.6" fill="#EDEBF1"/>'
};
function buildTpl() {
  var host = $("tpl");
  TEMPLATES.forEach(function (t) {
    var b = el("button");
    b.type = "button";
    b.setAttribute("aria-pressed", state.template === t.id ? "true" : "false");
    b.dataset.id = t.id;
    b.innerHTML = '<svg viewBox="0 0 34 42" aria-hidden="true">' + ART[t.art] + "</svg>";
    b.appendChild(el("span", null, t.name));
    b.addEventListener("click", function () { setTemplate(t.id); });
    host.appendChild(b);
  });
}
/* Offsets belong to the template that was nudged. Switching parks the current
   ones under the old id and loads that template's own, which start centered, so
   a nudge on the tall quote can never push the square stat off canvas. */
function parkLayout() {
  state.tpl[state.template] = { dx: state.textDX, dy: state.textDY, scale: state.textScale };
}
function loadLayout() {
  var t = state.tpl[state.template] || {};
  state.textDX = typeof t.dx === "number" ? t.dx : 0;
  state.textDY = typeof t.dy === "number" ? t.dy : 0;
  state.textScale = typeof t.scale === "number" ? t.scale : 1;
}
function setTemplate(id) {
  if (state.template === id) return;
  snap();
  parkLayout();
  var wasPair = isPair();
  state.template = id;
  // carry the photo across: a single-photo poster becomes the LEFT half of a
  // pair template and back again, so switching never loses what he dropped.
  if (isPair() && !wasPair && !state.left.id && state.photo.id) state.left.id = state.photo.id;
  else if (!isPair() && wasPair && !state.photo.id && state.left.id) state.photo.id = state.left.id;
  loadLayout();
  if (id === "state" && hotCount() === 0) {
    var ks = wordKeys();
    for (var i = 0; i < ks.length; i++) state.hot[ks[i]] = true;
  }
  if (id === "inset") layer = "inset";
  else if (layer === "inset") layer = "text";
  syncInputs(); drawNow();
}
function recenter() {
  snap();
  state.textDX = 0; state.textDY = 0; state.textScale = 1;
  state.tpl[state.template] = { dx: 0, dy: 0, scale: 1 };
  state.photo.panX = 0; state.photo.panY = 0;
  state.left.panX = 0; state.left.panY = 0;
  state.right.panX = 0; state.right.panY = 0;
  state.inset.dx = S.insetDx; state.inset.dy = 0;
  syncInputs(); drawNow();
  toast("Layers back in the middle. Highlights kept.");
}

/* ================= word chips ================= */
function buildChips() {
  var host = $("wordChips");
  host.innerHTML = "";
  var ws = words(), ks = wordKeys(ws);
  document.documentElement.style.setProperty("--hotc", hlHex());
  if (!ws.length) { $("wordNote").textContent = "Type a line to pick the words that carry the color."; return; }
  ws.forEach(function (w, i) {
    var b = el("button", "chip" + (state.hlMode === "underline" ? " u" : ""), w);
    b.type = "button";
    b.setAttribute("aria-pressed", state.hot[ks[i]] ? "true" : "false");
    b.setAttribute("aria-label", "Highlight the word " + w);
    b.dataset.key = ks[i];
    b.addEventListener("click", function () {
      snap();
      if (state.hot[ks[i]]) delete state.hot[ks[i]]; else state.hot[ks[i]] = true;
      buildChips(); drawNow();
    });
    host.appendChild(b);
  });
  var n = hotCount();
  $("wordNote").textContent = n === 0
    ? "No hot words yet. Two or three carry a poster."
    : n + " of " + ws.length + (ws.length === 1 ? " word is colored." : " words are colored.");
}
function buildSwatches() {
  var host = $("hlSwatch");
  host.innerHTML = "";
  HL.forEach(function (c) {
    var b = el("button", "sw");
    b.type = "button";
    b.style.background = c.hex;
    b.setAttribute("aria-pressed", state.hlColor === c.id ? "true" : "false");
    b.setAttribute("aria-label", "Highlight color " + c.label);
    b.dataset.hl = c.id;
    b.appendChild(el("span", null, c.label));
    b.addEventListener("click", function () {
      snap(); state.hlColor = c.id; buildSwatches(); buildChips(); drawNow();
    });
    host.appendChild(b);
  });
}

/* ================= sliders ================= */
var SLIDERS = [
  { id: "sz", label: "Text size", min: function () { return 60; }, max: function () { return 165; }, step: 1,
    get: function () { return Math.round(state.textScale * 100); }, set: function (v) { state.textScale = v / 100; }, fmt: function (v) { return v + "%"; } },
  { id: "tx", label: "Text across", min: function () { return -Math.round(W * 0.42); }, max: function () { return Math.round(W * 0.42); }, step: 4,
    get: function () { return Math.round(state.textDX); }, set: function (v) { state.textDX = v; }, fmt: function (v) { return v + " px"; } },
  { id: "ty", label: "Text up and down", min: function () { return -Math.round(H * 0.34); }, max: function () { return Math.round(H * 0.22); }, step: 4,
    get: function () { return Math.round(state.textDY); }, set: function (v) { state.textDY = v; }, fmt: function (v) { return v + " px"; } },
  { id: "gr", label: "Gradient strength", min: function () { return 0; }, max: function () { return 130; }, step: 2,
    get: function () { return Math.round(state.grad * 100); }, set: function (v) { state.grad = v / 100; }, fmt: function (v) { return v + "%"; } },
  { id: "pz", label: "Photo zoom", min: function () { return 100; }, max: function () { return 260; }, step: 2,
    get: function () { return Math.round(activePhoto().zoom * 100); }, set: function (v) { activePhoto().zoom = v / 100; }, fmt: function (v) { return v + "%"; } },
  { id: "is", label: "Inset size", min: function () { return 60; }, max: function () { return 200; }, step: 2, only: "inset",
    get: function () { return Math.round(state.inset.scale * 100); }, set: function (v) { state.inset.scale = v / 100; }, fmt: function (v) { return v + "%"; } }
];
function isPair() { return state.template === "stat" || state.template === "versus"; }
function activePhoto() {
  if (!isPair()) return state.photo;
  return layer === "right" ? state.right : state.left;
}
function buildSliders() {
  var host = $("sliders");
  host.innerHTML = "";
  SLIDERS.forEach(function (sl) {
    if (sl.only && state.template !== sl.only) return;
    var lo = sl.min(), hi = sl.max();
    var wrapEl = el("div", "slide");
    var top = el("div", "top");
    top.appendChild(el("b", null, sl.label));
    var val = el("i", null, sl.fmt(sl.get()));
    top.appendChild(val);
    wrapEl.appendChild(top);
    var row = el("div", "srow");
    var minus = el("button", "step", "\\u2212");
    minus.type = "button"; minus.setAttribute("aria-label", "Decrease " + sl.label);
    var input = document.createElement("input");
    input.type = "range"; input.min = lo; input.max = hi; input.step = sl.step;
    input.value = clamp(sl.get(), lo, hi); input.id = "sl-" + sl.id;
    input.setAttribute("aria-label", sl.label);
    var plus = el("button", "step", "+");
    plus.type = "button"; plus.setAttribute("aria-label", "Increase " + sl.label);
    var pending = false;
    function apply(v) {
      v = clamp(v, lo, hi);
      input.value = v; val.textContent = sl.fmt(v);
      sl.set(v); requestDraw();
    }
    input.addEventListener("pointerdown", function () { if (!pending) { snap(); pending = true; } });
    input.addEventListener("keydown", function () { if (!pending) { snap(); pending = true; } });
    input.addEventListener("input", function () { apply(parseFloat(input.value)); });
    input.addEventListener("change", function () { pending = false; });
    minus.addEventListener("click", function () { snap(); apply(parseFloat(input.value) - sl.step * 4); });
    plus.addEventListener("click", function () { snap(); apply(parseFloat(input.value) + sl.step * 4); });
    row.appendChild(minus); row.appendChild(input); row.appendChild(plus);
    wrapEl.appendChild(row);
    host.appendChild(wrapEl);
  });
}
function refreshSliders() {
  SLIDERS.forEach(function (sl) {
    var n = $("sl-" + sl.id);
    if (!n) return;
    n.min = sl.min(); n.max = sl.max();
    n.value = sl.get();
    var v = n.parentNode.parentNode.querySelector(".top i");
    if (v) v.textContent = sl.fmt(sl.get());
  });
}

/* ================= drops ================= */
function bindDrop(dropId, fileId, onImg, onClear, snapFn) {
  var d = $(dropId), f = $(fileId);
  if (!d || !f) return;
  function take(file) {
    if (!file || file.type.indexOf("image/") !== 0) return;
    var url = URL.createObjectURL(file), im = new Image();
    im.onload = function () { if (snapFn) snapFn(); onImg(im, url); };
    im.onerror = function () { toast("That image did not load"); };
    im.src = url;
  }
  d.addEventListener("click", function (e) { if (e.target && e.target.classList.contains("x")) return; f.click(); });
  d.addEventListener("keydown", function (e) {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); f.click(); }
  });
  d.addEventListener("dragover", function (e) { e.preventDefault(); d.classList.add("over"); });
  d.addEventListener("dragleave", function () { d.classList.remove("over"); });
  d.addEventListener("drop", function (e) {
    e.preventDefault(); d.classList.remove("over");
    if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]) take(e.dataTransfer.files[0]);
  });
  f.addEventListener("change", function () { if (f.files && f.files[0]) take(f.files[0]); f.value = ""; });
  d.clearHook = onClear;
  d.snapHook = snapFn;
}
function paintDrop(dropId, url, empty) {
  var d = $(dropId);
  if (!d) return;
  d.innerHTML = "";
  if (url) {
    d.classList.add("set");
    var im = el("img"); im.src = url; im.alt = "";
    d.appendChild(im);
    var x = el("button", "x", "\\u00d7");
    x.type = "button"; x.setAttribute("aria-label", "Remove this photo");
    x.addEventListener("click", function (e) {
      e.stopPropagation();
      if (d.snapHook) d.snapHook();
      if (d.clearHook) d.clearHook();
    });
    d.appendChild(x);
  } else {
    d.classList.remove("set");
    d.textContent = empty;
  }
}
function setPhoto(slot, im, url) {
  state[slot].id = im ? put(im, { data: toData(im) }, url) : null;
  syncDrops(); drawNow();
}

/* ================= pointer editing ================= */
function canvasPoint(e) {
  var r = cv.getBoundingClientRect();
  return { x: (e.clientX - r.left) * (W / r.width), y: (e.clientY - r.top) * (H / r.height) };
}
function inside(rect, p, pad) {
  if (!rect) return false;
  pad = pad || 0;
  return p.x >= rect.x - pad && p.x <= rect.x + rect.w + pad && p.y >= rect.y - pad && p.y <= rect.y + rect.h + pad;
}
var dragging = null;
cv.addEventListener("pointerdown", function (e) {
  var p = canvasPoint(e), pick = isPair() && p.x > W / 2 ? "right" : "photo";
  if (state.template === "inset" && inside(layout.inset, p, 10)) pick = "inset";
  else if (inside(layout.text, p, 26)) pick = "text";
  setLayer(pick);
  snap();
  dragging = { x: p.x, y: p.y, layer: pick, moved: false };
  try { cv.setPointerCapture(e.pointerId); } catch (err) { /* pointer already gone */ }
  e.preventDefault();
});
cv.addEventListener("pointermove", function (e) {
  if (!dragging) return;
  var p = canvasPoint(e), dx = p.x - dragging.x, dy = p.y - dragging.y;
  dragging.x = p.x; dragging.y = p.y;
  if (Math.abs(dx) + Math.abs(dy) > 0.4) dragging.moved = true;
  nudge(dragging.layer, dx, dy);
  requestDraw();
});
function endDrag(e) {
  if (!dragging) return;
  if (!dragging.moved) hist.pop();
  syncHist(); refreshSliders(); drawNow();
  dragging = null;
  try {
    if (e && e.pointerId != null && cv.hasPointerCapture && cv.hasPointerCapture(e.pointerId)) cv.releasePointerCapture(e.pointerId);
  } catch (err) { /* nothing to release */ }
}
cv.addEventListener("pointerup", endDrag);
cv.addEventListener("pointercancel", endDrag);
function nudge(which, dx, dy) {
  if (which === "text") {
    state.textDX = clamp(state.textDX + dx, -W * 0.45, W * 0.45);
    state.textDY = clamp(state.textDY + dy, -H * 0.45, H * 0.30);
  } else if (which === "inset") {
    state.inset.dx = clamp(state.inset.dx + dx / W, -0.46, 0.46);
    state.inset.dy = clamp(state.inset.dy + dy, -H * 0.5, H * 0.5);
  } else {
    var ps = isPair() ? (which === "right" ? state.right : state.left) : state.photo;
    ps.panX = clamp(ps.panX + dx, -W, W);
    ps.panY = clamp(ps.panY + dy, -H, H);
  }
}
cv.addEventListener("keydown", function (e) {
  var step = e.shiftKey ? 24 : 8, dx = 0, dy = 0;
  if (e.key === "ArrowLeft") dx = -step;
  else if (e.key === "ArrowRight") dx = step;
  else if (e.key === "ArrowUp") dy = -step;
  else if (e.key === "ArrowDown") dy = step;
  else return;
  e.preventDefault(); snap(); nudge(layer, dx, dy); drawNow(); refreshSliders();
});
function setLayer(k) {
  layer = k;
  var seg = $("layerSeg").querySelectorAll("button");
  for (var i = 0; i < seg.length; i++) press(seg[i], seg[i].dataset.layer === k);
  paintHud(); paintSel(); refreshSliders();
}

/* ================= inputs ================= */
function bindText(id, apply) {
  var n = $(id), t = 0, snapped = false;
  n.addEventListener("input", function () {
    if (!snapped) { snap(); snapped = true; }
    clearTimeout(t);
    t = setTimeout(function () { snapped = false; }, 700);
    apply(n.value);
    requestDraw();
  });
}
function syncInputs() {
  $("line").value = state.line;
  $("speaker").value = state.speaker;
  $("about").value = state.about;
  $("source").value = state.source;
  $("caption").value = state.caption;
  $("vLeft").value = state.versus.left; $("vRight").value = state.versus.right;
  $("vEvent").value = state.versus.event; $("vDate").value = state.versus.date;
  $("sTitle").value = state.stat.title;
  $("sL1").value = state.stat.l1; $("sL2").value = state.stat.l2;
  $("sR1").value = state.stat.r1; $("sR2").value = state.stat.r2;
  press($("hlColor"), state.hlMode === "color");
  press($("hlUnder"), state.hlMode === "underline");
  press($("shapeSq"), state.inset.shape !== "circle");
  press($("shapeCi"), state.inset.shape === "circle");
  var fs = $("fitSeg").querySelectorAll("button"), i;
  for (i = 0; i < fs.length; i++) press(fs[i], fs[i].dataset.fit === state.fitMode);
  var cs = $("cleanSeg").querySelectorAll("button");
  for (i = 0; i < cs.length; i++) press(cs[i], (cs[i].dataset.clean === "1") === !!state.clean);
  var tb = $("tpl").querySelectorAll("button");
  for (i = 0; i < tb.length; i++) press(tb[i], tb[i].dataset.id === state.template);
  var pair = isPair();
  $("photoSingle").hidden = pair;
  $("photoPair").hidden = !pair;
  $("photoInset").hidden = state.template !== "inset";
  $("cardVersus").hidden = state.template !== "versus";
  $("cardStat").hidden = state.template !== "stat";
  $("cardLine").hidden = pair;
  $("cardAttr").hidden = pair;
  $("layInset").hidden = state.template !== "inset";
  $("layRight").hidden = !pair;
  $("layPhoto").textContent = pair ? "Left" : "Photo";
  if (layer === "inset" && state.template !== "inset") layer = "text";
  if (layer === "right" && !pair) layer = "photo";
  applyAspect();
  buildSwatches(); buildChips(); buildSliders(); syncDrops(); setLayer(layer); syncHist();
}
function syncDrops() {
  paintDrop("dropMain", urlOf(state.photo.id), "Drop a photo, tap to pick, or paste");
  paintDrop("dropInset", urlOf(state.inset.id), "Drop the speaker's face here");
  paintDrop("dropLeft", urlOf(state.left.id), "Left");
  paintDrop("dropRight", urlOf(state.right.id), "Right");
}

/* ================= storage: IndexedDB with a localStorage fallback ================= */
var DBP = null, storeKind = "memory";
function db() {
  if (DBP) return DBP;
  DBP = new Promise(function (res, rej) {
    var r;
    try { r = indexedDB.open("studio", 1); } catch (e) { rej(e); return; }
    r.onupgradeneeded = function () {
      var d = r.result;
      if (!d.objectStoreNames.contains("docs")) d.createObjectStore("docs", { keyPath: "id" });
    };
    r.onsuccess = function () { storeKind = "indexeddb"; res(r.result); };
    r.onerror = function () { rej(r.error || new Error("idb")); };
    r.onblocked = function () { rej(new Error("blocked")); };
  });
  return DBP;
}
function dbTx(mode, fn) {
  return db().then(function (d) {
    return new Promise(function (res, rej) {
      var t = d.transaction("docs", mode), s = t.objectStore("docs"), out = null;
      out = fn(s);
      t.oncomplete = function () { res(out && out.result !== undefined ? out.result : true); };
      t.onerror = function () { rej(t.error || new Error("tx")); };
      t.onabort = function () { rej(t.error || new Error("abort")); };
    });
  });
}
var LSK = "studio.doc.";
function lsPut(rec) {
  try { localStorage.setItem(LSK + rec.id, JSON.stringify(rec)); storeKind = "localstorage"; return true; }
  catch (e) {
    try {
      var lite = { id: rec.id, ts: rec.ts, name: rec.name, doc: { v: 2, state: rec.doc.state, poll: rec.doc.poll, images: {} } };
      localStorage.setItem(LSK + rec.id, JSON.stringify(lite));
      storeKind = "localstorage-lite";
      return true;
    } catch (e2) { return false; }
  }
}
function lsGet(id) {
  try { var s = localStorage.getItem(LSK + id); return s ? JSON.parse(s) : null; } catch (e) { return null; }
}
function lsAll() {
  var out = [];
  try {
    for (var i = 0; i < localStorage.length; i++) {
      var k = localStorage.key(i);
      if (k && k.indexOf(LSK) === 0) { var v = lsGet(k.slice(LSK.length)); if (v) out.push(v); }
    }
  } catch (e) { /* storage blocked */ }
  return out;
}
function storePut(rec) {
  return dbTx("readwrite", function (s) { s.put(rec); }).catch(function () { return lsPut(rec); });
}
function storeGet(id) {
  return dbTx("readonly", function (s) { return s.get(id); }).catch(function () { return lsGet(id); });
}
function storeAll() {
  return dbTx("readonly", function (s) { return s.getAll ? s.getAll() : null; })
    .then(function (v) { return Array.isArray(v) ? v : lsAll(); })
    .catch(function () { return lsAll(); });
}
function storeDel(id) {
  return dbTx("readwrite", function (s) { s.delete(id); })
    .catch(function () { try { localStorage.removeItem(LSK + id); } catch (e) { } return true; });
}

/* ================= the document: state + poll + the photos themselves ================= */
function serialize() {
  var imgs = {}, keys = [state.photo.id, state.inset.id, state.left.id, state.right.id];
  poll.options.forEach(function (o) { keys.push(o.id); });
  keys.forEach(function (k) {
    if (!k || imgs[k]) return;
    var m = assetMeta[k];
    if (m && m.data) imgs[k] = { data: m.data };
    else if (m && m.url) imgs[k] = { url: m.url };
  });
  return { v: 2, state: state, poll: poll, images: imgs };
}
function hydrate(doc) {
  if (!doc || !doc.state) return Promise.resolve(false);
  var imgs = doc.images || {}, jobs = [];
  Object.keys(imgs).forEach(function (k) {
    var rec = imgs[k] || {}, src = rec.data || rec.url;
    if (!src) return;
    jobs.push(new Promise(function (res) {
      var im = new Image();
      if (!rec.data) im.crossOrigin = "anonymous";
      im.onload = function () { putAt(k, im, rec, src); res(true); };
      im.onerror = function () { res(false); };
      im.src = src;
    }));
  });
  return Promise.all(jobs).then(function () {
    state = mergeState(doc.state);
    if (doc.poll) poll = mergePoll(doc.poll);
    // Keys for words that are no longer in the line are kept WHILE editing, so
    // retyping a word brings its highlight back. Loading a document is the one
    // safe moment to drop them, which stops them piling up across sessions.
    pruneHot();
    return true;
  });
}
var saveT = 0, restoring = true, lastSaveTs = 0;
function scheduleSave() {
  if (restoring) return;
  clearTimeout(saveT);
  saveT = setTimeout(saveNow, 800);
}
function saveNow() {
  if (restoring) return;
  var rec = { id: "current", ts: Date.now(), name: "current", doc: serialize() };
  return Promise.resolve(storePut(rec)).then(function () { lastSaveTs = rec.ts; }, function () { });
}
var draftList = [];
function draftLabel(d) {
  var s = (d && d.doc && d.doc.state) || {};
  var t = (s.line || s.caption || "Untitled").replace(/\\s+/g, " ").trim();
  return t.slice(0, 46) || "Untitled";
}
function when(ts) {
  var d = new Date(ts || Date.now()), p = function (n) { return (n < 10 ? "0" : "") + n; };
  return p(d.getDate()) + "/" + p(d.getMonth() + 1) + " " + p(d.getHours()) + ":" + p(d.getMinutes());
}
function renderDrafts() {
  var host = $("drafts");
  host.innerHTML = "";
  if (!draftList.length) {
    $("draftNote").textContent = "Your work saves itself, so a refresh brings it back. Save a draft to keep a version.";
    return;
  }
  draftList.slice(0, 6).forEach(function (d) {
    var row = el("div", "draftrow");
    var open = el("button", "open");
    open.type = "button";
    open.appendChild(el("b", null, draftLabel(d)));
    open.appendChild(el("i", null, (d.doc && d.doc.state ? d.doc.state.template : "post") + " \\u00b7 " + when(d.ts)));
    open.addEventListener("click", function () { openDraft(d.id); });
    var del = el("button", "del", "\\u00d7");
    del.type = "button"; del.setAttribute("aria-label", "Delete this draft");
    del.addEventListener("click", function () {
      storeDel(d.id).then(refreshDrafts);
    });
    row.appendChild(open); row.appendChild(del);
    host.appendChild(row);
  });
  $("draftNote").textContent = draftList.length + " saved here in this browser.";
}
function refreshDrafts() {
  return Promise.resolve(storeAll()).then(function (all) {
    draftList = (all || []).filter(function (r) { return r && r.id && r.id.indexOf("draft:") === 0; })
      .sort(function (a, b) { return (b.ts || 0) - (a.ts || 0); });
    renderDrafts();
  }, function () { renderDrafts(); });
}
function saveDraft() {
  var rec = { id: "draft:" + Date.now(), ts: Date.now(), name: draftLabel({ doc: { state: state } }), doc: serialize() };
  return Promise.resolve(storePut(rec)).then(function () {
    toast("Draft saved");
    return refreshDrafts();
  }, function () { toast("This browser would not store the draft"); });
}
function openDraft(id) {
  Promise.resolve(storeGet(id)).then(function (rec) {
    if (!rec || !rec.doc) { toast("That draft is gone"); return; }
    snap();
    return hydrate(rec.doc).then(function () {
      layer = "text";
      applyAspect(); syncInputs(); buildPollRows(); drawNow(); scheduleSave();
      toast("Draft loaded");
    });
  }, function () { toast("That draft would not open"); });
}
function restore() {
  return Promise.resolve(storeGet("current")).then(function (rec) {
    if (!rec || !rec.doc) return false;
    return hydrate(rec.doc).then(function () { return true; });
  }, function () { return false; });
}

/* ================= staged rail ================= */
function api(path, opts) {
  return fetch(path, opts || { credentials: "same-origin" }).then(function (r) {
    if (r.status === 401) { location.reload(); throw new Error("auth"); }
    return r;
  });
}
/* the contract is {id, score, why, caption, line, speaker, source, about, hot[],
   image_url, timestamp}. Older field names still resolve so a lagging worker
   deploy degrades instead of blanking the rail. */
function normalizeStaged(raw) {
  var arr = [];
  if (Array.isArray(raw)) arr = raw;
  else if (raw && typeof raw === "object") arr = raw.posts || raw.staged || raw.items || raw.results || [];
  if (!Array.isArray(arr)) arr = [];
  return arr.map(function (p, i) {
    p = p || {};
    var hot = p.hot || p.hot_words || p.highlight || [];
    if (typeof hot === "string") hot = hot.split(",");
    if (!Array.isArray(hot)) hot = [];
    return {
      id: String(p.id || p.message_id || p.key || ("staged" + i)),
      score: (p.score != null ? p.score : (p.rank != null ? p.rank : null)),
      why: p.why || p.reason || "",
      caption: p.caption || p.text || p.body || p.summary || "",
      line: p.line || p.headline || p.title || "",
      speaker: p.speaker || p.who || "",
      source: p.source || p.via || p.outlet || "",
      about: p.about || "",
      hot: hot,
      image: p.image_url || p.image || p.photo || p.photo_url || p.media || p.thumbnail || p.thumb || "",
      timestamp: p.timestamp || p.ts || p.created_at || ""
    };
  });
}
function loadImage(url) {
  return api(url, { credentials: "same-origin" }).then(function (r) {
    if (!r.ok) throw new Error("bad");
    return r.blob();
  }).then(function (b) {
    return new Promise(function (res, rej) {
      var u = URL.createObjectURL(b), im = new Image();
      im.onload = function () { res({ img: im, url: u, same: true }); };
      im.onerror = function () { rej(new Error("decode")); };
      im.src = u;
    });
  }).catch(function () {
    return new Promise(function (res, rej) {
      var im = new Image();
      im.crossOrigin = "anonymous";
      im.onload = function () { res({ img: im, url: url, same: false }); };
      im.onerror = function () { rej(new Error("cors")); };
      im.src = url;
    });
  });
}
var staged = [], stagedPick = null;
function shortWhen(ts) {
  if (!ts) return "";
  var d = new Date(ts);
  if (isNaN(d.getTime())) return "";
  return when(d.getTime());
}
function renderRail(items) {
  var rail = $("rail");
  rail.innerHTML = "";
  items.forEach(function (p) {
    var b = el("button", "railitem");
    b.type = "button";
    b.setAttribute("aria-pressed", stagedPick === p.id ? "true" : "false");
    var ph = el("span", "ph");
    if (p.image) ph.style.backgroundImage = "url(" + JSON.stringify(p.image) + ")";
    if (p.score != null) ph.appendChild(el("span", "score", String(p.score)));
    var w = shortWhen(p.timestamp);
    if (w) ph.appendChild(el("span", "when", w));
    b.appendChild(ph);
    var head = (p.line || (p.caption || "").split("\\n")[0] || "No line yet");
    b.appendChild(el("span", "hl", head));
    b.appendChild(el("span", "why", p.why || (p.speaker ? p.speaker + (p.source ? ", via " + p.source : "") : "")));
    b.addEventListener("click", function () { pickStaged(p); });
    rail.appendChild(b);
  });
}
function railSkeleton() {
  var rail = $("rail");
  rail.innerHTML = "";
  for (var i = 0; i < 4; i++) rail.appendChild(el("div", "skel"));
}
function loadStaged() {
  railSkeleton();
  $("railNote").textContent = "Loading what the bot staged in Discord.";
  api("/studio/api/staged").then(function (r) {
    if (!r.ok) throw new Error("http " + r.status);
    return r.json();
  }).then(function (j) {
    staged = normalizeStaged(j);
    if (!staged.length) {
      $("rail").innerHTML = "";
      $("railNote").textContent = "Nothing staged right now. Build a post from scratch below.";
      return;
    }
    renderRail(staged);
    $("railNote").textContent = staged.length + " staged. Tap one to load its photo, line, hot words and caption.";
  }).catch(function (e) {
    if (e && e.message === "auth") return;
    $("rail").innerHTML = "";
    $("railNote").textContent = "Could not reach the staged list. Everything else still works.";
  });
}
/* Load a staged post back exactly as the bot proposed it, so the owner can change
   ONE thing and export. Everything the contract carries lands in the document. */
function pickStaged(p) {
  snap();
  stagedPick = p.id;
  if (p.line) state.line = p.line;
  else if (p.caption) state.line = p.caption.split("\\n")[0].slice(0, 90);
  state.speaker = p.speaker || "";
  state.source = p.source || "";
  state.about = p.about || "";
  state.caption = p.caption || state.caption;
  state.hot = {};
  var ks = wordKeys(), ws = words(), used = {};
  (p.hot || []).forEach(function (h) {
    var t = normWord(h);
    if (!t) return;
    for (var i = 0; i < ws.length; i++) {
      if (normWord(ws[i]) === t && !used[ks[i]]) { state.hot[ks[i]] = true; used[ks[i]] = 1; }
    }
  });
  state.textDX = 0; state.textDY = 0; state.textScale = 1;
  state.tpl[state.template] = { dx: 0, dy: 0, scale: 1 };
  state.photo.panX = 0; state.photo.panY = 0; state.photo.zoom = 1;
  renderRail(staged);
  syncInputs(); drawNow();
  if (!p.image) { toast("Loaded the words. Add a photo when you have one."); return; }
  loadImage(p.image).then(function (o) {
    var data = toData(o.img);
    state.photo.id = put(o.img, data ? { data: data } : { url: p.image }, o.url);
    syncDrops(); drawNow(); scheduleSave();
    toast("Loaded. Change one thing and export.");
  }).catch(function () { toast("The photo would not load, so the words came through only."); });
}

/* ================= export ================= */
function withBlob(cb) {
  drawNow();
  try { cv.toBlob(function (b) { if (b) cb(b); else toast("The export failed"); }, "image/png"); }
  catch (e) { toast("The export failed"); }
}
function saveBlob(blob, name) {
  var a = document.createElement("a"), u = URL.createObjectURL(blob);
  a.href = u; a.download = name;
  document.body.appendChild(a); a.click();
  setTimeout(function () { URL.revokeObjectURL(u); a.remove(); }, 1500);
}
function stamp() {
  var d = new Date(), p = function (n) { return (n < 10 ? "0" : "") + n; };
  return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + "-" + p(d.getHours()) + p(d.getMinutes());
}
$("dl").addEventListener("click", function () {
  withBlob(function (b) { saveBlob(b, "post-" + state.template + "-" + stamp() + ".png"); toast("Saved to your downloads"); });
});
$("copyCap").addEventListener("click", function () {
  var t = state.caption || state.line;
  if (!navigator.clipboard) { toast("This browser blocks copy. Select the text instead."); return; }
  navigator.clipboard.writeText(t).then(function () { toast("Caption copied"); },
    function () { toast("Copy was blocked"); });
});
(function () {
  var btn = $("copyImg");
  if (!(window.ClipboardItem && navigator.clipboard && navigator.clipboard.write)) { btn.hidden = true; return; }
  btn.addEventListener("click", function () {
    try {
      drawNow();
      var item = new ClipboardItem({
        "image/png": new Promise(function (res) { cv.toBlob(function (b) { res(b); }, "image/png"); })
      });
      navigator.clipboard.write([item]).then(function () { toast("Image copied. Paste it into the composer."); },
        function () { toast("Copy was blocked. Download instead."); });
    } catch (e) { toast("Copy was blocked. Download instead."); }
  });
})();
(function () {
  var btn = $("shareBtn");
  if (!(navigator.share && navigator.canShare)) { btn.hidden = true; return; }
  btn.addEventListener("click", function () {
    withBlob(function (b) {
      var f = new File([b], "post-" + stamp() + ".png", { type: "image/png" });
      if (!navigator.canShare({ files: [f] })) { toast("Sharing files is not available here"); return; }
      navigator.share({ files: [f], text: state.caption || "" }).catch(function () { });
    });
  });
})();

/* ================= polls =================
   Polls own their own history, so dropping a poll photo can no longer rewind
   the poster you were building in the other tab. */
var POLL_W = 640, POLL_H = 640;
function blankOption() { return { label: "", emoji: "", id: null, zoom: 1, panX: 0, panY: 0 }; }
function blankPoll() {
  return { q: "", options: [blankOption(), blankOption(), blankOption(), blankOption()] };
}
var poll = blankPoll();
var pollMetrics = [];
var pollHist = [], pollRedoStack = [];
function mergePoll(p) {
  var b = blankPoll();
  if (!p || typeof p !== "object") return b;
  b.q = typeof p.q === "string" ? p.q : (typeof p.question === "string" ? p.question : "");
  if (Array.isArray(p.options) && p.options.length) {
    b.options = p.options.slice(0, 6).map(function (o) {
      var d = blankOption();
      if (o && typeof o === "object") {
        d.label = String(o.label || "");
        d.emoji = String(o.emoji || "");
        d.id = o.id || null;
        d.zoom = typeof o.zoom === "number" ? o.zoom : 1;
        d.panX = typeof o.panX === "number" ? o.panX : 0;
        d.panY = typeof o.panY === "number" ? o.panY : 0;
      } else if (typeof o === "string") d.label = o;
      return d;
    });
  }
  while (b.options.length < 2) b.options.push(blankOption());
  return b;
}
function snapPoll() {
  try { pollHist.push(JSON.stringify(poll)); } catch (e) { return; }
  if (pollHist.length > HIST_MAX) pollHist.shift();
  pollRedoStack.length = 0;
  syncPollHist();
}
function pollUndo() {
  if (!pollHist.length) { toast("Nothing left to undo"); return; }
  try { pollRedoStack.push(JSON.stringify(poll)); poll = mergePoll(JSON.parse(pollHist.pop())); }
  catch (e) { return; }
  $("pq").value = poll.q; buildPollRows(); syncPollHist(); scheduleSave();
}
function pollRedo() {
  if (!pollRedoStack.length) { toast("Nothing to redo"); return; }
  try { pollHist.push(JSON.stringify(poll)); poll = mergePoll(JSON.parse(pollRedoStack.pop())); }
  catch (e) { return; }
  $("pq").value = poll.q; buildPollRows(); syncPollHist(); scheduleSave();
}
function syncPollHist() {
  $("pollUndo").disabled = pollHist.length === 0;
  $("pollRedo").disabled = pollRedoStack.length === 0;
  $("pollAdd").disabled = poll.options.length >= 6;
}
function buildPollRows() {
  var host = $("pollRows");
  host.innerHTML = "";
  // the rebuild owns every poll control, the question field included, so a
  // restored or undone document repopulates the input and not just the tiles.
  $("pq").value = poll.q || "";
  pollMetrics.length = poll.options.length;
  poll.options.forEach(function (o, i) {
    var row = el("div", "opt");
    var c = document.createElement("canvas");
    c.width = POLL_W; c.height = POLL_H; c.id = "pc" + i;
    c.setAttribute("role", "img");
    c.setAttribute("aria-label", "Option " + (i + 1) + " tile");
    row.appendChild(c);
    bindTileDrag(c, i);
    var body = el("div", "body");
    var r1 = el("div", "rowx");
    var em = document.createElement("input");
    em.type = "text"; em.value = o.emoji; em.maxLength = 4;
    em.setAttribute("aria-label", "Option " + (i + 1) + " emoji");
    em.placeholder = "\\ud83e\\udd4a";
    var lb = document.createElement("input");
    lb.type = "text"; lb.value = o.label;
    lb.setAttribute("aria-label", "Option " + (i + 1) + " label");
    lb.placeholder = "Option " + (i + 1);
    var rm = el("button", "rm", "\\u00d7");
    rm.type = "button"; rm.setAttribute("aria-label", "Remove option " + (i + 1));
    rm.disabled = poll.options.length <= 2;
    var pending = false;
    function tap() { if (!pending) { snapPoll(); pending = true; setTimeout(function () { pending = false; }, 700); } }
    em.addEventListener("input", function () { tap(); o.emoji = em.value; drawPoll(i); scheduleSave(); });
    lb.addEventListener("input", function () { tap(); o.label = lb.value; drawPoll(i); scheduleSave(); });
    rm.addEventListener("click", function () {
      if (poll.options.length <= 2) return;
      snapPoll();
      poll.options.splice(i, 1);
      buildPollRows(); scheduleSave();
    });
    r1.appendChild(em); r1.appendChild(lb); r1.appendChild(rm);
    body.appendChild(r1);
    var d = el("div", "drop");
    d.id = "pdrop" + i; d.setAttribute("role", "button"); d.tabIndex = 0;
    d.style.minHeight = "44px";
    d.textContent = o.id ? "Photo set. Tap to replace." : "Photo for this option";
    d.setAttribute("aria-label", "Photo for option " + (i + 1));
    var f = document.createElement("input");
    f.type = "file"; f.accept = "image/*"; f.className = "hidden"; f.id = "pfile" + i;
    body.appendChild(d); body.appendChild(f);
    var zr = document.createElement("input");
    zr.type = "range"; zr.min = 100; zr.max = 260; zr.step = 2; zr.value = Math.round((o.zoom || 1) * 100);
    zr.id = "pzoom" + i;
    zr.setAttribute("aria-label", "Option " + (i + 1) + " photo zoom");
    var zpend = false;
    zr.addEventListener("pointerdown", function () { if (!zpend) { snapPoll(); zpend = true; } });
    zr.addEventListener("change", function () { zpend = false; scheduleSave(); });
    zr.addEventListener("input", function () { o.zoom = parseFloat(zr.value) / 100; drawPoll(i); });
    body.appendChild(zr);
    row.appendChild(body);
    host.appendChild(row);
    bindDrop("pdrop" + i, "pfile" + i, function (im, u) {
      poll.options[i].id = put(im, { data: toData(im) }, u);
      $("pdrop" + i).textContent = "Photo set. Tap to replace.";
      drawPoll(i); scheduleSave();
    }, function () {
      poll.options[i].id = null;
      $("pdrop" + i).textContent = "Photo for this option";
      drawPoll(i); scheduleSave();
    }, snapPoll);
  });
  syncPollHist();
  for (var i = 0; i < poll.options.length; i++) drawPoll(i);
}
function bindTileDrag(c, i) {
  var drag = null;
  c.addEventListener("pointerdown", function (e) {
    var r = c.getBoundingClientRect();
    drag = { x: e.clientX, y: e.clientY, s: POLL_W / Math.max(1, r.width), moved: false };
    snapPoll();
    try { c.setPointerCapture(e.pointerId); } catch (err) { /* gone */ }
    e.preventDefault();
  });
  c.addEventListener("pointermove", function (e) {
    if (!drag) return;
    var o = poll.options[i];
    if (!o) return;
    o.panX = clamp(o.panX + (e.clientX - drag.x) * drag.s, -POLL_W, POLL_W);
    o.panY = clamp(o.panY + (e.clientY - drag.y) * drag.s, -POLL_H, POLL_H);
    drag.x = e.clientX; drag.y = e.clientY; drag.moved = true;
    drawPoll(i);
  });
  function up() {
    if (!drag) return;
    if (!drag.moved) pollHist.pop();
    drag = null; syncPollHist(); scheduleSave();
  }
  c.addEventListener("pointerup", up);
  c.addEventListener("pointercancel", up);
}
function pollQuestionBlock(g) {
  var q = (poll.q || "").toUpperCase().replace(/\\s+/g, " ").trim();
  if (!q) return { lines: [], h: 0 };
  var pad = 38, maxW = POLL_W - 2 * pad, f = null;
  for (var size = 36; size >= 16; size -= 2) {
    setFont(g, 800, size);
    var tr = -Math.round(size * 0.02);
    var ls = wrap(g, q, maxW, tr);
    var wide = false;
    for (var i = 0; i < ls.length; i++) if (trackedW(g, ls[i], tr) > maxW) wide = true;
    if (ls.length <= 2 && !wide) { f = { size: size, tr: tr, lines: ls }; break; }
  }
  if (!f) {
    setFont(g, 800, 16);
    f = { size: 16, tr: 0, lines: wrap(g, q, maxW, 0).slice(0, 2) };
  }
  var lh = Math.round(f.size * 1.14), total = f.lines.length * lh;
  var ink = rgbOf(PAL.ink);
  var gr = g.createLinearGradient(0, 0, 0, total + 74);
  gr.addColorStop(0, "rgba(" + ink + ",0.80)");
  gr.addColorStop(1, "rgba(" + ink + ",0)");
  g.fillStyle = gr; g.fillRect(0, 0, POLL_W, total + 74);
  setFont(g, 800, f.size);
  g.save();
  g.textBaseline = "alphabetic";
  g.shadowColor = "rgba(0,0,0,0.6)"; g.shadowBlur = 12; g.shadowOffsetY = 3;
  var yy = 26;
  for (var k = 0; k < f.lines.length; k++) {
    var w = trackedW(g, f.lines[k], f.tr);
    drawTracked(g, POLL_W / 2 - w / 2, yy + f.size * S.ascent, f.lines[k], f.tr, "#FFFFFF");
    yy += lh;
  }
  g.restore();
  return { lines: f.lines, h: total, size: f.size };
}
function drawPoll(i) {
  var c = $("pc" + i), o = poll.options[i];
  if (!c || !o) return;
  var g = c.getContext("2d");
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, POLL_W, POLL_H);
  var img = get(o.id);
  if (img) drawPhoto(g, img, o, 0, 0, POLL_W, POLL_H, "cover");
  else {
    var lg = g.createLinearGradient(0, 0, 0, POLL_H);
    lg.addColorStop(0, PAL.inkSoft); lg.addColorStop(1, PAL.ink);
    g.fillStyle = lg; g.fillRect(0, 0, POLL_W, POLL_H);
    glow(g, POLL_W / 2, POLL_H / 2, 380, PAL.deep, 0.30);
  }
  if (!state.clean) vignette(g, 0.55, 1.8, POLL_W, POLL_H);
  var q = pollQuestionBlock(g);
  // the label pill shrinks, then truncates, so a long option never runs off the tile
  var label = (o.label || "").toUpperCase().replace(/\\s+/g, " ").trim();
  var emoji = (o.emoji || "").trim();
  var shown = ((emoji ? emoji + " " : "") + label).trim();
  var m = { pillW: 0, pillX: 0, qLines: q.lines.length, size: 0, truncated: false };
  if (shown) {
    var side = 32, px = 22, dot = 10, dgap = 12;
    var avail = POLL_W - 2 * side;
    var size = 26;
    setFont(g, 600, size);
    while (size > 13 && g.measureText(shown).width + 2 * px + dot + dgap > avail) {
      size -= 1; setFont(g, 600, size);
    }
    var text = shown;
    if (g.measureText(text).width + 2 * px + dot + dgap > avail) {
      while (text.length > 2 && g.measureText(text + "\\u2026").width + 2 * px + dot + dgap > avail) text = text.slice(0, -1);
      text = text + "\\u2026";
      m.truncated = true;
    }
    var tw = g.measureText(text).width;
    var py = 12, ch = size + 2 * py, cw = tw + 2 * px + dot + dgap;
    var x0 = side, y0 = POLL_H - side - ch;
    g.save();
    g.shadowColor = "rgba(0,0,0,0.5)"; g.shadowBlur = 16; g.shadowOffsetY = 5;
    roundRect(g, x0, y0, cw, ch, ch / 2);
    g.fillStyle = "rgba(" + rgbOf(PAL.ink) + ",0.80)"; g.fill();
    g.restore();
    g.beginPath();
    g.arc(x0 + px + dot / 2, y0 + ch / 2, dot / 2, 0, Math.PI * 2);
    g.fillStyle = hlHex(); g.fill();
    g.textBaseline = "alphabetic";
    g.fillStyle = PAL.paper;
    g.fillText(text, x0 + px + dot + dgap, y0 + ch / 2 + size * 0.35);
    m.pillW = Math.round(cw); m.pillX = x0; m.size = size;
  }
  pollMetrics[i] = m;
  if (!state.clean) grain(g, 0.055, POLL_W, POLL_H);
}
function drawAllPolls() { for (var i = 0; i < poll.options.length; i++) drawPoll(i); }
$("pollAdd").addEventListener("click", function () {
  if (poll.options.length >= 6) { toast("Six options is the ceiling"); return; }
  snapPoll();
  poll.options.push(blankOption());
  buildPollRows(); scheduleSave();
});
$("pollUndo").addEventListener("click", pollUndo);
$("pollRedo").addEventListener("click", pollRedo);
$("pollDl").addEventListener("click", function () {
  var n = 0;
  poll.options.forEach(function (o, i) {
    var c = $("pc" + i);
    if (!c) return;
    setTimeout(function () {
      c.toBlob(function (b) { if (b) saveBlob(b, "poll-option-" + (i + 1) + "-" + stamp() + ".png"); }, "image/png");
    }, i * 260);
    n++;
  });
  toast(n + " tiles are downloading");
});
$("pollCopy").addEventListener("click", function () {
  var lines = [poll.q || ""];
  poll.options.forEach(function (o, i) {
    var t = ((o.emoji || "") + " " + (o.label || "")).trim();
    lines.push(t || ("Option " + (i + 1)));
  });
  var txt = lines.join("\\n");
  if (!navigator.clipboard) { toast("This browser blocks copy"); return; }
  navigator.clipboard.writeText(txt).then(function () { toast("Poll text copied"); },
    function () { toast("Copy was blocked"); });
});
function loadPoll() {
  api("/studio/api/poll").then(function (r) {
    if (!r.ok) throw new Error("http");
    return r.json();
  }).then(function (j) {
    if (!j || typeof j !== "object") return;
    var q = j.question || j.q || j.title || "";
    var opts = j.options || j.answers || j.choices || [];
    if (!q && !(Array.isArray(opts) && opts.length)) return;
    // never stamp on top of work in progress
    var touched = (poll.q || "").trim() !== "";
    poll.options.forEach(function (o) { if (o.label || o.emoji || o.id) touched = true; });
    if (touched) return;
    snapPoll();
    poll.q = q;
    if (Array.isArray(opts) && opts.length) {
      poll.options = opts.slice(0, 6).map(function (o) {
        var d = blankOption();
        if (typeof o === "string") d.label = o;
        else if (o && typeof o === "object") {
          d.label = o.label || o.text || o.name || "";
          d.emoji = o.emoji || "";
          if (o.img) d.pending = String(o.img);
        }
        return d;
      });
      while (poll.options.length < 2) poll.options.push(blankOption());
    }
    $("pq").value = poll.q;
    buildPollRows();
    poll.options.forEach(function (o, i) {
      if (!o.pending) return;
      var src = o.pending; delete o.pending;
      loadImage(src).then(function (res) {
        var data = toData(res.img);
        poll.options[i].id = put(res.img, data ? { data: data } : { url: src }, res.url);
        var d = $("pdrop" + i);
        if (d) d.textContent = "Photo set. Tap to replace.";
        drawPoll(i);
      }).catch(function () { });
    });
  }).catch(function () { });
}

/* ================= settings ================= */
var provider = "deepseek";
var providers = { deepseek: false, openrouter: false };
var PROV_LABEL = { deepseek: "DeepSeek", openrouter: "OpenRouter" };
$("provSeg").addEventListener("click", function (e) {
  var b = e.target.closest ? e.target.closest("button[data-prov]") : null;
  if (!b) return;
  provider = b.dataset.prov;
  var all = $("provSeg").querySelectorAll("button");
  for (var i = 0; i < all.length; i++) press(all[i], all[i] === b);
});
function paintKeyState() {
  var d = $("keyDeep"), o = $("keyOpen");
  d.textContent = "DeepSeek: " + (providers.deepseek ? "key saved" : "no key");
  d.className = "badge" + (providers.deepseek ? "" : " off");
  o.textContent = "OpenRouter: " + (providers.openrouter ? "key saved" : "no key");
  o.className = "badge" + (providers.openrouter ? "" : " off");
}
$("keySave").addEventListener("click", function () {
  var v = $("aikey").value;
  if (!v) { toast("Paste a key first"); return; }
  api("/studio/api/aikey", {
    method: "POST", credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ provider: provider, key: v })
  }).then(function (r) {
    if (!r.ok) throw new Error("http " + r.status);
    $("aikey").value = "";
    providers[provider] = true;
    paintKeyState();
    toast(PROV_LABEL[provider] + " key saved");
  }).catch(function (e) {
    if (e && e.message === "auth") return;
    toast("Saving the key did not work");
  });
});
$("logout").addEventListener("click", function () {
  fetch("/studio/logout", { method: "POST", credentials: "same-origin" })
    .then(function () { location.reload(); })
    .catch(function () { location.reload(); });
});
$("wipeBtn").addEventListener("click", function () {
  Promise.resolve(storeAll()).then(function (all) {
    var jobs = (all || []).map(function (r) { return storeDel(r.id); });
    return Promise.all(jobs);
  }).then(function () {
    draftList = []; renderDrafts();
    toast("Saved drafts cleared from this browser");
  }, function () { toast("Nothing to clear"); });
});
function loadKeyState() {
  api("/studio/api/aikey").then(function (r) {
    if (!r.ok) throw new Error("http");
    return r.json();
  }).then(function (j) {
    var p = (j && j.providers) || {};
    providers.deepseek = !!p.deepseek;
    providers.openrouter = !!p.openrouter;
    paintKeyState();
  }).catch(function () {
    providers.deepseek = false; providers.openrouter = false;
    paintKeyState();
  });
}
function loadLimits() {
  var fallback = "YouTube has no public API for community posts, so the last step is a paste. "
    + "Download or copy the image, copy the caption, then drop both into the composer.";
  $("limitsNote").textContent = fallback;
  api("/studio/api/limits").then(function (r) {
    if (!r.ok) throw new Error("http");
    return r.json();
  }).then(function (j) {
    var t = "";
    if (typeof j === "string") t = j;
    else if (j) t = j.note || j.message || j.text || "";
    if (t) $("limitsNote").textContent = t;
  }).catch(function () { });
}

/* ================= tabs ================= */
var TABS = [["tab-post", "view-post"], ["tab-poll", "view-poll"], ["tab-set", "view-set"]];
var activeTab = "tab-post";
function showTab(id) {
  activeTab = id;
  TABS.forEach(function (t) {
    var on = t[0] === id, tab = $(t[0]);
    tab.setAttribute("aria-selected", on ? "true" : "false");
    tab.tabIndex = on ? 0 : -1;
    $(t[1]).hidden = !on;
  });
  if (id === "tab-poll") drawAllPolls();
  if (id === "tab-post") drawNow();
}
TABS.forEach(function (t, i) {
  $(t[0]).addEventListener("click", function () { showTab(t[0]); });
  $(t[0]).addEventListener("keydown", function (e) {
    var d = e.key === "ArrowRight" ? 1 : (e.key === "ArrowLeft" ? -1 : 0);
    if (!d) return;
    e.preventDefault();
    var n = TABS[(i + d + TABS.length) % TABS.length];
    showTab(n[0]); $(n[0]).focus();
  });
});

/* ================= wiring ================= */
buildTpl();
bindText("line", function (v) { state.line = v; buildChips(); });
bindText("speaker", function (v) { state.speaker = v; });
bindText("about", function (v) { state.about = v; });
bindText("source", function (v) { state.source = v; });
bindText("caption", function (v) { state.caption = v; });
bindText("vLeft", function (v) { state.versus.left = v; });
bindText("vRight", function (v) { state.versus.right = v; });
bindText("vEvent", function (v) { state.versus.event = v; });
bindText("vDate", function (v) { state.versus.date = v; });
bindText("sTitle", function (v) { state.stat.title = v; });
bindText("sL1", function (v) { state.stat.l1 = v; });
bindText("sL2", function (v) { state.stat.l2 = v; });
bindText("sR1", function (v) { state.stat.r1 = v; });
bindText("sR2", function (v) { state.stat.r2 = v; });
(function () {
  var pending = false, t = 0;
  $("pq").addEventListener("input", function () {
    if (!pending) { snapPoll(); pending = true; }
    clearTimeout(t);
    t = setTimeout(function () { pending = false; }, 700);
    poll.q = $("pq").value;
    drawAllPolls();
    scheduleSave();
  });
})();

$("hlColor").addEventListener("click", function () { snap(); state.hlMode = "color"; syncInputs(); drawNow(); });
$("hlUnder").addEventListener("click", function () { snap(); state.hlMode = "underline"; syncInputs(); drawNow(); });
$("shapeSq").addEventListener("click", function () { snap(); state.inset.shape = "square"; syncInputs(); drawNow(); });
$("shapeCi").addEventListener("click", function () { snap(); state.inset.shape = "circle"; syncInputs(); drawNow(); });
$("fitSeg").addEventListener("click", function (e) {
  var b = e.target.closest ? e.target.closest("button[data-fit]") : null;
  if (!b) return;
  snap(); state.fitMode = b.dataset.fit;
  if (state.fitMode === "fit") {
    state.photo.zoom = 1; state.left.zoom = 1; state.right.zoom = 1;
  }
  syncInputs(); drawNow();
});
$("cleanSeg").addEventListener("click", function (e) {
  var b = e.target.closest ? e.target.closest("button[data-clean]") : null;
  if (!b) return;
  snap(); state.clean = b.dataset.clean === "1";
  syncInputs(); drawNow(); drawAllPolls();
});
$("aspSeg").addEventListener("click", function (e) {
  var b = e.target.closest ? e.target.closest("button[data-asp]") : null;
  if (!b || !ASPECTS[b.dataset.asp]) return;
  snap();
  state.aspect = b.dataset.asp;
  applyAspect(); syncInputs(); drawNow();
});
$("layerSeg").addEventListener("click", function (e) {
  var b = e.target.closest ? e.target.closest("button[data-layer]") : null;
  if (b) setLayer(b.dataset.layer);
});
$("undoBtn").addEventListener("click", undo);
$("redoBtn").addEventListener("click", redo);
$("recenterBtn").addEventListener("click", recenter);
$("clearBtn").addEventListener("click", function () {
  snap();
  var tpl = state.template, asp = state.aspect;
  state = blankState();
  state.template = tpl; state.aspect = asp;
  state.line = ""; state.caption = ""; state.speaker = ""; state.source = ""; state.about = "";
  state.hot = {};
  layer = "text";
  applyAspect(); syncInputs(); drawNow();
  toast("Cleared. Undo brings it back.");
});
$("saveDraft").addEventListener("click", saveDraft);
$("railReload").addEventListener("click", loadStaged);

bindDrop("dropMain", "fileMain", function (im, u) { setPhoto("photo", im, u); }, function () { setPhoto("photo", null, null); }, snap);
bindDrop("dropInset", "fileInset", function (im, u) { setPhoto("inset", im, u); }, function () { setPhoto("inset", null, null); }, snap);
bindDrop("dropLeft", "fileLeft", function (im, u) { setPhoto("left", im, u); }, function () { setPhoto("left", null, null); }, snap);
bindDrop("dropRight", "fileRight", function (im, u) { setPhoto("right", im, u); }, function () { setPhoto("right", null, null); }, snap);

document.addEventListener("paste", function (e) {
  if (!e.clipboardData || !e.clipboardData.items) return;
  if (activeTab !== "tab-post") return;
  var items = e.clipboardData.items;
  for (var i = 0; i < items.length; i++) {
    if (items[i].type && items[i].type.indexOf("image/") === 0) {
      var f = items[i].getAsFile();
      if (!f) continue;
      var u = URL.createObjectURL(f), im = new Image();
      im.onload = function () { snap(); setPhoto(isPair() ? "left" : "photo", im, u); toast("Pasted photo added"); };
      im.src = u;
      e.preventDefault();
      return;
    }
  }
});
document.addEventListener("keydown", function (e) {
  if (!(e.ctrlKey || e.metaKey)) return;
  var k = String(e.key || "").toLowerCase();
  var t = e.target && e.target.tagName;
  if (t === "INPUT" || t === "TEXTAREA") return;
  var isPoll = activeTab === "tab-poll";
  if (k === "z" && !e.shiftKey) { e.preventDefault(); if (isPoll) pollUndo(); else undo(); }
  else if ((k === "z" && e.shiftKey) || k === "y") { e.preventDefault(); if (isPoll) pollRedo(); else redo(); }
  else if (k === "s") { e.preventDefault(); saveDraft(); }
});

/* ================= boot ================= */
applyAspect();
syncInputs();
buildPollRows();
drawNow();
restore().then(function (ok) {
  restoring = false;
  if (ok) {
    layer = "text";
    applyAspect(); syncInputs(); buildPollRows(); drawNow();
  }
  $("storeNote").textContent = "Drafts live in this browser only, in " + storeKind + ".";
  loadPoll();
  refreshDrafts();
}, function () {
  restoring = false;
  loadPoll();
  refreshDrafts();
});
loadStaged();
loadLimits();
loadKeyState();

if (document.fonts && document.fonts.ready) {
  Promise.all([
    document.fonts.load("900 120px Poppins"),
    document.fonts.load("800 40px Poppins"),
    document.fonts.load("600 30px Poppins"),
    document.fonts.load("500 26px Poppins")
  ]).catch(function () { }).then(function () {
    return document.fonts.ready;
  }).then(function () {
    fontsReady = true;
    fitCache.k = null; lineCache.k = null;
    drawNow();
    drawAllPolls();
  }).catch(function () { });
}
window.addEventListener("resize", function () { paintHud(); });
window.addEventListener("beforeunload", function () { if (!restoring) saveNow(); });

/* a tiny hook so an automated check can read what the page thinks it drew */
window.studioProbe = function () {
  var ws = words(), ks = wordKeys(ws), out = [];
  for (var i = 0; i < ws.length; i++) out.push({ w: ws[i], key: ks[i], hot: !!state.hot[ks[i]] });
  return {
    template: state.template, aspect: state.aspect, W: W, H: H, cw: cv.width, chh: cv.height,
    hlMode: state.hlMode, hlColor: state.hlColor, hlHex: hlHex(),
    layer: layer, words: out, hotCount: hotCount(), hotKeys: Object.keys(state.hot),
    textDX: Math.round(state.textDX), textDY: Math.round(state.textDY), textScale: state.textScale,
    fitMode: state.fitMode, clean: state.clean,
    photo: { id: state.photo.id, zoom: state.photo.zoom, panX: Math.round(state.photo.panX), panY: Math.round(state.photo.panY) },
    inset: { id: state.inset.id, dx: state.inset.dx },
    left: { id: state.left.id }, right: { id: state.right.id },
    hist: hist.length, redo: redoStack.length,
    pollHist: pollHist.length, pollRedo: pollRedoStack.length,
    layout: layout, sel: selRect(),
    draws: drawCount, fits: fitCount, wraps: wrapCount,
    poll: { q: poll.q, n: poll.options.length, metrics: pollMetrics },
    store: storeKind, saved: lastSaveTs, drafts: draftList.length, fonts: fontsReady
  };
};
})();
</script>
</body>
</html>`;
