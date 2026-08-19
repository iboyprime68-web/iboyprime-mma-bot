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
//                                hot: [..], image_url, photo_url, photo_kind, template,
//                                colorway, bg, spec, timestamp}]  (seventeen fields;
//                                image_url/photo_url are same-origin /studio/api/img
//                                proxy paths or null - legacy embed images may still be
//                                a Discord CDN url)
//   GET  /studio/api/img/<message id>/<0|1> -> the attachment bytes, same-origin
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
/* On a phone the stage box would end at the canvas, and a sticky bar cannot
   outlive its own parent. Dropping the box lets the toolbar stay pinned for the
   whole post view, so it is still there while he edits the line underneath. */
@media(max-width:959px){ .stage{display:contents} }

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

/* ---- the toolbar that sits ON the stage, so nothing needs scrolling ---- */
.tbar{
  position:sticky;top:var(--tbtop,58px);z-index:30;
  background:rgba(13,13,20,.95);backdrop-filter:blur(12px);
  border:1px solid var(--line);border-radius:13px;padding:7px;
  display:grid;gap:6px;margin-bottom:10px;
}
.trow{display:flex;align-items:center;gap:6px;overflow-x:auto;scrollbar-width:none;-webkit-overflow-scrolling:touch}
.trow::-webkit-scrollbar{display:none}
.tsep{width:1px;height:24px;background:var(--line2);flex:none;margin:0 1px}
.tlab{font-size:9px;font-weight:800;letter-spacing:1.1px;text-transform:uppercase;color:var(--faint);flex:none}
.ibtn{
  flex:none;width:36px;height:36px;border:1px solid var(--line);background:var(--card2);
  border-radius:9px;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;padding:0;color:var(--dim);
}
.ibtn:hover{border-color:var(--accent);color:var(--text)}
.ibtn[aria-pressed=true]{background:linear-gradient(140deg,var(--accent),var(--deep));border-color:transparent;color:#fff}
.ibtn svg{width:19px;height:19px;display:block}
.ibtn[disabled]{opacity:.4;cursor:not-allowed}
.tchip{
  flex:none;border:1px solid var(--line);background:var(--card2);border-radius:9px;color:var(--dim);
  height:36px;padding:0 11px;font-size:12px;font-weight:700;cursor:pointer;white-space:nowrap;
}
.tchip:hover{border-color:var(--accent)}
.tchip[aria-pressed=true]{background:linear-gradient(140deg,var(--accent),var(--deep));color:#fff;border-color:transparent}
.tbar select{
  height:36px;border:1px solid var(--line);background:var(--card2);border-radius:9px;
  font-size:12px;font-weight:700;padding:0 7px;flex:none;cursor:pointer;
}
.tbar .seg{padding:2px;flex:none}
.tbar .seg button{min-height:32px;font-size:11px;padding:0 9px}
.tsw{width:28px;height:28px;border-radius:8px;border:2px solid var(--line);cursor:pointer;padding:0;flex:none}
.tsw[aria-pressed=true]{border-color:#fff;box-shadow:0 0 0 2px rgba(255,255,255,.18)}

/* ---- one row per movable element ---- */
.lrow{display:flex;align-items:center;gap:5px;background:var(--sunk);border:1px solid var(--line);border-radius:11px;padding:6px;overflow-x:auto;scrollbar-width:none}
.lrow::-webkit-scrollbar{display:none}
.lrow + .lrow{margin-top:8px}
.lrow.on{border-color:var(--accent);box-shadow:0 0 0 1px var(--accent) inset}
.lrow .nm{
  flex:none;min-width:62px;text-align:left;background:transparent;border:0;cursor:pointer;
  font-size:12.5px;font-weight:700;color:var(--dim);min-height:34px;padding:0 4px;
}
.lrow.on .nm{color:var(--text)}

/* ---- usage meters + provider badges ---- */
.meter{margin-bottom:13px}
.meter:last-child{margin-bottom:0}
.meter .mtop{display:flex;gap:8px;align-items:baseline;font-size:12.5px;font-weight:700}
.meter .mtop i{margin-left:auto;font-style:normal;color:var(--dim);font-variant-numeric:tabular-nums;font-size:12px}
.bar{height:9px;border-radius:5px;background:var(--sunk);border:1px solid var(--line);overflow:hidden;margin-top:6px}
.bar span{display:block;height:100%;background:linear-gradient(90deg,var(--accent),var(--hot))}
.bar.hi span{background:linear-gradient(90deg,#FF8A1F,#FF3B30)}
.kv{display:flex;gap:10px;font-size:12.5px;padding:7px 0;border-top:1px solid var(--line)}
.kv b{font-weight:600;color:var(--dim)}
.kv i{margin-left:auto;font-style:normal;font-weight:700;font-variant-numeric:tabular-nums}
.verdict{background:var(--sunk);border:1px solid var(--line);border-radius:11px;padding:11px;font-size:13px;font-weight:600;line-height:1.5}
.verdict.hi{border-color:#FF8A1F;color:#FFD2A6}
.badges{display:grid;grid-template-columns:repeat(auto-fit,minmax(136px,1fr));gap:7px;margin-top:11px}
.pb{display:flex;align-items:center;gap:8px;background:var(--sunk);border:1px solid var(--line);border-radius:10px;padding:9px 10px;font-size:12px;font-weight:700}
.pb u{width:8px;height:8px;border-radius:50%;background:var(--faint);text-decoration:none;flex:none}
.pb em{font-style:normal;margin-left:auto;color:var(--faint);font-size:10px;font-weight:700;letter-spacing:.5px;text-transform:uppercase}
.pb.on{border-color:rgba(99,227,174,.42)}
.pb.on u{background:var(--ok);box-shadow:0 0 9px rgba(99,227,174,.8)}
.pb.on em{color:var(--ok)}

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

  <div class="split">
    <div class="stage">

      <!-- everything he reaches for while looking at the poster lives here, above
           the canvas, sticky, so it never scrolls out of reach on a phone. -->
      <div class="tbar" id="tbar">
        <div class="trow">
          <select id="tplQuick" aria-label="Template"></select>
          <div class="seg sm" role="group" aria-label="Poster shape" id="aspSeg">
            <button data-asp="4:5" type="button" aria-pressed="true">4:5</button>
            <button data-asp="1:1" type="button" aria-pressed="false">1:1</button>
            <button data-asp="9:16" type="button" aria-pressed="false">9:16</button>
          </div>
          <span class="tsep"></span>
          <button class="ibtn" id="gridBtn" type="button" aria-pressed="false" aria-label="Show the grid" title="Grid"></button>
          <select id="gridSize" aria-label="Grid size" title="Grid size">
            <option value="45">45</option>
            <option value="60">60</option>
            <option value="90" selected>90</option>
            <option value="135">135</option>
            <option value="180">180</option>
          </select>
          <button class="ibtn" id="snapBtn" type="button" aria-pressed="true" aria-label="Snap to guides" title="Snap"></button>
          <span class="tsep"></span>
          <button class="ibtn" id="tbUndo" type="button" aria-label="Undo" title="Undo"></button>
          <button class="ibtn" id="tbRedo" type="button" aria-label="Redo" title="Redo"></button>
        </div>
        <div class="trow">
          <div class="seg sm" role="group" aria-label="Layer to move" id="layerSeg">
            <button data-layer="text" type="button" aria-pressed="true">Text</button>
            <button data-layer="photo" type="button" aria-pressed="false" id="layPhoto">Photo</button>
            <button data-layer="right" type="button" aria-pressed="false" id="layRight" hidden>Right</button>
            <button data-layer="inset" type="button" aria-pressed="false" id="layInset">Inset</button>
          </div>
          <span class="tsep"></span>
          <div class="trow" id="alignBar" role="group" aria-label="Align the selected layer" style="gap:5px"></div>
          <span class="tsep"></span>
          <div class="trow" id="nudgeBar" role="group" aria-label="Nudge the selected layer" style="gap:5px"></div>
          <span class="tsep"></span>
          <button class="ibtn" id="tbReset" type="button" aria-label="Reset the selected layer" title="Reset this layer"></button>
        </div>
        <div class="trow">
          <span class="tlab">Hot</span>
          <div class="seg sm" role="group" aria-label="Highlight style">
            <button id="hlColor" type="button" aria-pressed="true">Fill</button>
            <button id="hlUnder" type="button" aria-pressed="false">Underline</button>
          </div>
          <div class="trow" id="hlSwatch" role="group" aria-label="Highlight color" style="gap:5px"></div>
        </div>
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

      <div class="card" id="cardWash">
        <div class="chead"><h2>Background and color</h2></div>
        <div class="field swrow">
          <label class="lbl">Colorway</label>
          <div class="swatches" id="cwRow"></div>
        </div>
        <div class="field">
          <label class="lbl">Background texture</label>
          <div class="chips" id="bgRow"></div>
          <p class="note" id="bgNote" hidden>The colored scene shows on photoless posters. Remove the photo to see it.</p>
        </div>
        <div class="field">
          <label class="lbl">Photo tint</label>
          <div class="seg sm" role="group" aria-label="Wash photos toward the colorway" id="tintSeg">
            <button data-tint="0" type="button" aria-pressed="true">Off</button>
            <button data-tint="55" type="button" aria-pressed="false">On</button>
          </div>
        </div>
        <p class="note">The wash carries photoless posters and announcement panels: a bold color with the texture hidden inside it. Tint washes your photos toward the colorway so they sit in the same scene.</p>
      </div>

      <div class="card" id="cardPanels" hidden>
        <div class="chead">
          <h2>Panels</h2>
          <span class="grow"></span>
          <div class="seg sm" role="group" aria-label="How many panels" id="panelSeg">
            <button data-n="1" type="button" aria-pressed="false">1</button>
            <button data-n="2" type="button" aria-pressed="true">2</button>
            <button data-n="3" type="button" aria-pressed="false">3</button>
          </div>
        </div>
        <div id="panelRows"></div>
        <p class="note" style="margin-top:8px">Each panel takes its own color, a big line (SEPT 12, or NAME VS NAME), a small event label and two photos. One panel makes the classic fight poster and can carry a bottom chip.</p>
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
        <p class="note">Highlight style and color sit in the bar above the poster.</p>
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

      <div class="card" id="cardTn" hidden>
        <div class="chead"><h2>Then and now</h2></div>
        <div class="field"><label class="lbl" for="tnTitle">Title strip</label><input id="tnTitle" type="text" autocomplete="off" placeholder="THE SAME MAN"></div>
        <div class="two">
          <div class="field"><label class="lbl" for="tnT1">Top label</label><input id="tnT1" type="text" autocomplete="off" placeholder="THEN"></div>
          <div class="field"><label class="lbl" for="tnS1">Top caption</label><input id="tnS1" type="text" autocomplete="off" placeholder="2016, debut night"></div>
        </div>
        <div class="two">
          <div class="field"><label class="lbl" for="tnT2">Bottom label</label><input id="tnT2" type="text" autocomplete="off" placeholder="NOW"></div>
          <div class="field"><label class="lbl" for="tnS2">Bottom caption</label><input id="tnS2" type="text" autocomplete="off" placeholder="2026, champion"></div>
        </div>
        <p class="note">The top photo is the Left slot, the bottom one is the Right slot.</p>
      </div>

      <div class="card" id="cardList" hidden>
        <div class="chead">
          <h2>Ranked list</h2>
          <span class="grow"></span>
          <button class="mini" id="listAdd" type="button">Add row</button>
        </div>
        <div class="field"><label class="lbl" for="lTitle">Title</label><input id="lTitle" type="text" autocomplete="off" placeholder="LONGEST WIN STREAKS"></div>
        <div id="listRows"></div>
        <p class="note" style="margin-top:8px">Numbers are drawn for you. Six rows is the ceiling.</p>
      </div>

      <div class="card" id="cardCal" hidden>
        <div class="chead">
          <h2>Event calendar</h2>
          <span class="grow"></span>
          <button class="mini" id="calAdd" type="button">Add event</button>
        </div>
        <div class="field"><label class="lbl" for="cTitle">Title</label><input id="cTitle" type="text" autocomplete="off" placeholder="WHAT IS COMING"></div>
        <div id="calRows"></div>
        <p class="note" style="margin-top:8px">Date on the left, the matchup on the right. Five bands is the ceiling.</p>
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
          <label class="lbl">Layers, each with its own align and reset</label>
          <div id="layerRows"></div>
        </div>
        <div id="sliders"></div>
        <div class="grid2" style="margin-top:11px">
          <button class="btn" id="recenterBtn" type="button">Re-center everything</button>
          <button class="btn ghost warn" id="clearBtn" type="button">Clear all</button>
        </div>
      </div>

      <div class="card">
        <div class="chead"><h2>Caption</h2></div>
        <textarea id="caption" rows="5" placeholder="The caption you paste under the image"></textarea>
      </div>

    </div>
  </div>

  <div class="card" style="margin-top:14px">
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
        <label class="lbl" for="provSel">Provider</label>
        <select id="provSel" style="width:100%;height:46px;background:var(--sunk);border:1px solid var(--line);border-radius:11px;padding:0 12px;font-size:15px;font-weight:600"></select>
      </div>
      <div class="field">
        <label class="lbl" for="aikey">Key</label>
        <input id="aikey" type="password" autocomplete="off" placeholder="Paste the key">
      </div>
      <button class="btn pri" id="keySave" type="button" style="width:100%">Save key</button>
      <p class="note" id="provHint" style="margin-top:10px"></p>
      <div class="badges" id="provBadges"></div>
    </div>

    <div class="card">
      <div class="chead">
        <h2>Usage</h2>
        <span class="grow"></span>
        <button class="mini" id="usageReload" type="button">Refresh</button>
      </div>
      <div id="usageBody"><p class="note">Checking what you have used.</p></div>
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
/* Colorway washes - mirrors postcard.COLORWAYS. The background of a photoless
   poster or an announcement panel is a bold single-hue duotone with an arena
   texture hidden inside it (the owner's att-8 law: never a flat gradient). */
var CW = [
  { id: "purple", label: "Purple", deep: "#0E0720", mid: "#5B3DF5", hot: "#8B70FF" },
  { id: "red",    label: "Red",    deep: "#1A0404", mid: "#C81A10", hot: "#FF4438" },
  { id: "blue",   label: "Blue",   deep: "#040A1C", mid: "#1E52D0", hot: "#3D7BFF" },
  { id: "green",  label: "Green",  deep: "#03140A", mid: "#0FA050", hot: "#2BD973" },
  { id: "gold",   label: "Gold",   deep: "#1C0F03", mid: "#D0740F", hot: "#FFA032" }
];
function cwOf(id) {
  for (var i = 0; i < CW.length; i++) if (CW[i].id === id) return CW[i];
  return CW[0];
}
/* The texture plates the Worker serves same-origin from /studio/bg/<name>.jpg
   ("none" keeps the flat wash). Grayscale JPEGs, so the duotone needs no
   filter support - just multiply plus lighter. */
var BGS = [
  { id: "arena",     label: "Arena" },
  { id: "spotlight", label: "Spotlight" },
  { id: "cage",      label: "Cage" },
  { id: "smoke",     label: "Smoke" },
  { id: "none",      label: "Flat" }
];
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
/* Every template declares what it owns, so the panel, the layer list and the
   photo slots are derived instead of being re-listed in five if-statements.
   photos: single | pair.  card: the extra input card this template needs. */
var TEMPLATES = [
  { id: "quote",   name: "Quote",         art: "quote",   photos: "single", line: 1, attr: 1 },
  { id: "inset",   name: "Quote + inset", art: "inset",   photos: "single", line: 1, attr: 1, inset: 1 },
  { id: "duo",     name: "Quote, 2 shots",art: "duo",     photos: "pair",   line: 1, attr: 1 },
  { id: "state",   name: "Statement",     art: "state",   photos: "single", line: 1, attr: 1 },
  { id: "panels",  name: "Announcement",  art: "panels",  photos: "panels", card: "Panels" },
  { id: "stat",    name: "Stat compare",  art: "stat",    photos: "pair",   card: "Stat" },
  { id: "versus",  name: "Versus",        art: "versus",  photos: "pair",   card: "Versus" },
  { id: "thennow", name: "Then and now",  art: "thennow", photos: "pair",   card: "Tn", axis: "y" },
  { id: "list",    name: "Ranked list",   art: "list",    photos: "single", card: "List" },
  { id: "cal",     name: "Calendar",      art: "cal",     photos: "single", card: "Cal" }
];
var CARDS = ["Versus", "Stat", "Tn", "List", "Cal", "Panels"];
function tplDef(id) {
  id = id || state.template;
  for (var i = 0; i < TEMPLATES.length; i++) if (TEMPLATES[i].id === id) return TEMPLATES[i];
  return TEMPLATES[0];
}
/* the highlight palette. The references use red and orange, the brand is purple,
   and white pairs with a dimmed rest-of-line so it still reads as a highlight. */
var HL = [
  { id: "purple", label: "Brand", hex: "#A45CFF" },
  { id: "red",    label: "Red",   hex: "#FF3B30" },
  { id: "orange", label: "Orange",hex: "#FF8A1F" },
  { id: "blue",   label: "Blue",  hex: "#3D7BFF" },
  { id: "green",  label: "Green", hex: "#2BD973" },
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
function blankSlot() { return { id: null, zoom: 1, panX: 0, panY: 0 }; }
function blankPanelRow(cwId) {
  return { big: "", small: "", chip: "", cw: cwId || "purple",
           l: blankSlot(), r: blankSlot() };
}
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
    colorway: "purple", bg: "arena", tint: 0,
    photo: { id: null, zoom: 1, panX: 0, panY: 0 },
    inset: { id: null, dx: S.insetDx, dy: 0, scale: 1, shape: "square" },
    left: { id: null, zoom: 1, panX: 0, panY: 0 },
    right: { id: null, zoom: 1, panX: 0, panY: 0 },
    panels: { n: 2, rows: [blankPanelRow("red"), blankPanelRow("blue"), blankPanelRow("green")] },
    textDX: 0, textDY: 0, textScale: 1, grad: 1,
    tpl: {},
    versus: { left: "MAKHACHEV", right: "DELLA MADDALENA", event: "Welterweight title", date: "Nov 15 - Philadelphia" },
    stat: { title: "LAST 10 WINS", l1: "8 FINISHES", l2: "2 DECISIONS", r1: "3 FINISHES", r2: "7 DECISIONS" },
    tn: { title: "THE SAME MAN", t1: "THEN", s1: "2016, debut night", t2: "NOW", s2: "2026, champion" },
    list: { title: "LONGEST WIN STREAKS", rows: ["ISLAM MAKHACHEV, 15", "JON JONES, 12", "KHABIB NURMAGOMEDOV, 13", "ANDERSON SILVA, 16"] },
    cal: { title: "WHAT IS COMING", rows: [
      { d: "NOV 15", m: "MAKHACHEV VS DELLA MADDALENA" },
      { d: "NOV 22", m: "GARRY VS PRATES" },
      { d: "DEC 06", m: "PEREIRA VS ANKALAEV 3" }
    ] }
  };
}
/* view preferences, deliberately OUTSIDE state: undo moves the poster, it must
   never flip the grid or the snap toggle back on the owner. */
var ui = { grid: false, gridSize: 90, snap: true, nudgeStep: 8 };
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
      Object.keys(b[k]).forEach(function (k2) {
        var d = b[k][k2], got = v[k2];
        // a number that is not a number (a NaN serialised to null, a string)
        // must not reach a draw, so the default wins that argument
        if (got === undefined || (typeof d === "number" && (typeof got !== "number" || !isFinite(got)))) got = d;
        o[k2] = got;
      });
      b[k] = o;
    } else if (typeof v === typeof b[k]) b[k] = v;
  });
  if (!ASPECTS[b.aspect]) b.aspect = "4:5";
  if (!tplDef(b.template) || tplDef(b.template).id !== b.template) b.template = "quote";
  b.list.rows = cleanRows(b.list.rows, 6, function (r) { return String(r || ""); });
  b.cal.rows = cleanRows(b.cal.rows, 5, function (r) {
    if (r && typeof r === "object") return { d: String(r.d || ""), m: String(r.m || "") };
    return { d: "", m: String(r || "") };
  });
  // wash + panels: junk from an old or hand-edited document must never reach
  // a draw. Colorway and plate names fall back rather than erroring.
  var cwOk = false, bgOk = false, i;
  for (i = 0; i < CW.length; i++) if (CW[i].id === b.colorway) cwOk = true;
  for (i = 0; i < BGS.length; i++) if (BGS[i].id === b.bg) bgOk = true;
  if (!cwOk) b.colorway = "purple";
  if (!bgOk) b.bg = "arena";
  b.tint = clamp(Math.round(Number(b.tint) || 0), 0, 100);
  var pIn = (b.panels && typeof b.panels === "object") ? b.panels : {};
  var defCw = ["red", "blue", "green"];
  var rowsIn = Array.isArray(pIn.rows) ? pIn.rows : [];
  var rows = [];
  for (i = 0; i < 3; i++) {
    var d0 = blankPanelRow(defCw[i]), r0 = rowsIn[i] || {};
    d0.big = String(r0.big || ""); d0.small = String(r0.small || "");
    d0.chip = String(r0.chip || "");
    d0.cw = (function (id) {
      for (var j = 0; j < CW.length; j++) if (CW[j].id === id) return id;
      return d0.cw;
    })(r0.cw);
    ["l", "r"].forEach(function (sk) {
      var s = (r0[sk] && typeof r0[sk] === "object") ? r0[sk] : {};
      d0[sk].id = s.id || null;
      d0[sk].zoom = typeof s.zoom === "number" ? s.zoom : 1;
      d0[sk].panX = typeof s.panX === "number" ? s.panX : 0;
      d0[sk].panY = typeof s.panY === "number" ? s.panY : 0;
    });
    rows.push(d0);
  }
  b.panels = { n: clamp(Math.round(Number(pIn.n) || 2), 1, 3), rows: rows };
  return b;
}
/* an array key that arrives as junk from an old document must not reach a draw */
function cleanRows(v, cap, coerce) {
  if (!Array.isArray(v)) return [];
  return v.slice(0, cap).map(coerce);
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
  var no = hist.length === 0, noR = redoStack.length === 0;
  $("undoBtn").disabled = no;
  $("redoBtn").disabled = noR;
  $("tbUndo").disabled = no;
  $("tbRedo").disabled = noR;
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
/* Accepts "#rrggbb", "#rgb" AND "rgb(r,g,b)" strings. mixHex hands back an
   rgb() string, and glow feeds whatever it is given straight through here into
   addColorStop, so a hex-only parser turned every photoless draw into a thrown
   SyntaxError and a blank canvas. Junk parses to 0,0,0 instead of NaN. */
function rgbOf(c) {
  c = String(c || "");
  var r, g, b;
  if (c.indexOf("rgb") === 0) {
    var i0 = c.indexOf("("), i1 = c.indexOf(")");
    var parts = (i0 >= 0 && i1 > i0 ? c.slice(i0 + 1, i1) : "").split(",");
    r = Math.round(parseFloat(parts[0]));
    g = Math.round(parseFloat(parts[1]));
    b = Math.round(parseFloat(parts[2]));
  } else {
    var h = c.replace("#", "");
    if (h.length === 3) h = h.charAt(0) + h.charAt(0) + h.charAt(1) + h.charAt(1) + h.charAt(2) + h.charAt(2);
    r = parseInt(h.slice(0, 2), 16);
    g = parseInt(h.slice(2, 4), 16);
    b = parseInt(h.slice(4, 6), 16);
  }
  if (!isFinite(r)) r = 0;
  if (!isFinite(g)) g = 0;
  if (!isFinite(b)) b = 0;
  return [clamp(r, 0, 255), clamp(g, 0, 255), clamp(b, 0, 255)].join(",");
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

function seamTint3() {
  // the seam's color follows the colorway: ink warmed toward the wash's mid
  // (for purple this is byte-identical to the old fixed "24,19,51")
  var i3 = [11, 11, 14], m3;
  try { m3 = rgb3(cwOf(state.colorway).mid); } catch (e) { m3 = [91, 61, 245]; }
  return [0, 1, 2].map(function (i) {
    return Math.round(i3[i] + (m3[i] - i3[i]) * 0.16);
  }).join(",");
}
function seamGrad(ctx, top, maxA) {
  top = clamp(top, 0, H - 2);
  var tintStr = seamTint3();
  var g = ctx.createLinearGradient(0, top, 0, H);
  for (var i = 0; i <= 12; i++) {
    var t = i / 12, s = t * t * (3 - 2 * t);
    g.addColorStop(t, "rgba(" + tintStr + "," + (maxA * s).toFixed(4) + ")");
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
    tintPass(ctx, dx, dy, dw, dh);
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
  tintPass(ctx, dx, dy, dw, dh);
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

/* ================= the colorway wash (mirrors postcard.wash_field) =================
   Texture plates arrive same-origin from /studio/bg/<name>.jpg, already
   grayscale, so the duotone is pure compositing: gray * (bright - deep) via
   multiply, then + deep via lighter. No ctx.filter needed anywhere. */
/* same contract as rgbOf but as numbers: takes "#hex" OR "rgb(r,g,b)", so a
   mixHex result can feed it without minting NaN color stops */
function rgb3(c) {
  c = String(c || "");
  var r, g, b;
  if (c.indexOf("rgb") === 0) {
    var i0 = c.indexOf("("), i1 = c.indexOf(")");
    var parts = (i0 >= 0 && i1 > i0 ? c.slice(i0 + 1, i1) : "").split(",");
    r = Math.round(parseFloat(parts[0]));
    g = Math.round(parseFloat(parts[1]));
    b = Math.round(parseFloat(parts[2]));
  } else {
    var h = c.replace("#", "");
    if (h.length === 3) h = h.charAt(0) + h.charAt(0) + h.charAt(1) + h.charAt(1) + h.charAt(2) + h.charAt(2);
    r = parseInt(h.slice(0, 2), 16);
    g = parseInt(h.slice(2, 4), 16);
    b = parseInt(h.slice(4, 6), 16);
  }
  if (!isFinite(r)) r = 0;
  if (!isFinite(g)) g = 0;
  if (!isFinite(b)) b = 0;
  return [clamp(r, 0, 255), clamp(g, 0, 255), clamp(b, 0, 255)];
}
function mixHex(a, b, t) {
  // returns a HEX string: several consumers (glow, rgbOf) parse #RRGGBB
  var A = rgb3(a), B = rgb3(b), out = "#";
  for (var i = 0; i < 3; i++) {
    var v = Math.max(0, Math.min(255, Math.round(A[i] + (B[i] - A[i]) * t)));
    out += (v < 16 ? "0" : "") + v.toString(16).toUpperCase();
  }
  return out;
}
var bgImgs = {}, bgReq = {};
function bgImg(name) {
  if (!name || name === "none") return null;
  if (bgImgs[name]) return bgImgs[name];
  if (!bgReq[name]) {
    bgReq[name] = 1;
    var im = new Image();
    im.onload = function () { bgImgs[name] = im; requestDraw(); };
    im.onerror = function () { /* flat wash carries it */ };
    im.src = "/studio/bg/" + name + ".jpg";
  }
  return null;
}
function washField(g, x, y, w, h, cw, bgName) {
  var deep = cw.deep, mid = cw.mid, hot = cw.hot;
  g.save();
  g.beginPath(); g.rect(x, y, w, h); g.clip();
  var tex = bgImg(bgName);
  if (tex && tex.width) {
    var off = document.createElement("canvas");
    off.width = Math.max(1, Math.round(w)); off.height = Math.max(1, Math.round(h));
    var og = off.getContext("2d");
    var s = Math.max(off.width / tex.width, off.height / tex.height);
    var dw = tex.width * s, dh = tex.height * s;
    og.drawImage(tex, (off.width - dw) / 2, (off.height - dh) * 0.45, dw, dh);
    // crush + duotone: the arena must stay HIDDEN - a modulation of the hue,
    // never a photo. multiply by (bright - deep), then add deep.
    // highlight ceiling: arena lights read as LIGHTS, but the field stays
    // DARKER than skin (round-4 blind: a bright mid-value wash competed with
    // the fighters' faces) - deep wash, natural subjects is the formula
    var d3 = rgb3(deep), h3 = rgb3(hot);
    var bright = rgb3(mid).map(function (v, i) {
      var lifted = v + (h3[i] - v) * 0.40;
      return Math.round(lifted + (245 - lifted) * 0.10);
    });
    og.globalCompositeOperation = "multiply";
    og.fillStyle = "rgb(" + Math.max(0, bright[0] - d3[0]) + "," +
      Math.max(0, bright[1] - d3[1]) + "," + Math.max(0, bright[2] - d3[2]) + ")";
    og.fillRect(0, 0, off.width, off.height);
    og.globalCompositeOperation = "lighter";
    og.fillStyle = deep;
    og.fillRect(0, 0, off.width, off.height);
    g.drawImage(off, x, y);
  } else {
    var lg = g.createLinearGradient(0, y, 0, y + h);
    lg.addColorStop(0, mixHex(deep, mid, 0.60));
    lg.addColorStop(1, deep);
    g.fillStyle = lg; g.fillRect(x, y, w, h);
  }
  glow(g, x + w / 2, y + h * 0.40, w * 0.72, mixHex(mid, hot, 0.55), 0.55);
  // edge deepening toward the colorway's OWN deep - never toward ink: the
  // reference washes stay saturated to the very edge
  var d = rgb3(deep);
  var rg = g.createRadialGradient(x + w / 2, y + h / 2, 0, x + w / 2, y + h / 2, Math.max(w, h) * 0.74);
  rg.addColorStop(0, "rgba(" + d.join(",") + ",0)");
  rg.addColorStop(0.62, "rgba(" + d.join(",") + ",0)");
  rg.addColorStop(1, "rgba(" + d.join(",") + ",0.38)");
  g.fillStyle = rg; g.fillRect(x, y, w, h);
  g.restore();
}
/* the toggleable colorway tint over a drawn photo (the att-8 fighters): the
   "color" blend re-hues while luminosity survives, the light multiply seats
   the shadows. Clipped to the photo's own frame. */
function tintPass(g, x, y, w, h) {
  var t = clamp(state.tint || 0, 0, 100) / 100;
  if (t <= 0) return;
  var cw = cwOf(state.colorway);
  g.save();
  g.beginPath(); g.rect(x, y, w, h); g.clip();
  g.globalCompositeOperation = "color";
  g.globalAlpha = t;
  g.fillStyle = cw.mid;
  g.fillRect(x, y, w, h);
  g.globalCompositeOperation = "multiply";
  g.globalAlpha = t * 0.22;
  g.fillStyle = cw.mid;
  g.fillRect(x, y, w, h);
  g.restore();
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
/* The real INK box of one drawn line, not the em box. Poppins caps start about
   a third of an em under the em top, so centring on the em box parks a
   statement line visibly low. Engines without ink metrics get a cap
   approximation. Call with the font already set. */
function inkMetrics(ctx2, text, size) {
  try {
    var mt = ctx2.measureText(text);
    if (mt && typeof mt.actualBoundingBoxAscent === "number" && isFinite(mt.actualBoundingBoxAscent)) {
      return { a: mt.actualBoundingBoxAscent, d: Math.max(0, mt.actualBoundingBoxDescent || 0) };
    }
  } catch (e) { /* an engine without ink metrics */ }
  return { a: size * 0.72, d: size * 0.05 };
}
/* ================= drawn-ink accumulator =================
   Every template unions the boxes it ACTUALLY draws into this, so align, drag
   and the selection box read the real lockup instead of a hand-declared
   rectangle that drifts from the pixels. */
var inkAcc = null;
function inkReset() { inkAcc = null; }
function inkAdd(x, y, w, h) {
  if (!(w > 0) || !(h > 0) || !isFinite(x) || !isFinite(y)) return;
  if (!inkAcc) inkAcc = { x0: x, y0: y, x1: x + w, y1: y + h };
  else {
    if (x < inkAcc.x0) inkAcc.x0 = x;
    if (y < inkAcc.y0) inkAcc.y0 = y;
    if (x + w > inkAcc.x1) inkAcc.x1 = x + w;
    if (y + h > inkAcc.y1) inkAcc.y1 = y + h;
  }
}
function inkAddRect(r) { if (r) inkAdd(r.x, r.y, r.w, r.h); }
function inkRect(fallback) {
  if (!inkAcc) return fallback;
  return { x: Math.round(inkAcc.x0), y: Math.round(inkAcc.y0),
           w: Math.max(1, Math.round(inkAcc.x1 - inkAcc.x0)),
           h: Math.max(1, Math.round(inkAcc.y1 - inkAcc.y0)) };
}
/* the ink box of a centred or measured single line, from its baseline */
function lineBox(ctx2, text, cx2, baseY, wpx, size) {
  var mtr = inkMetrics(ctx2, text, size);
  return { x: cx2 - wpx / 2, y: baseY - mtr.a, w: wpx, h: mtr.a + mtr.d };
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
  var wi = 0, yy = top, minX = 1e9, maxX = -1e9, inkTop = null, inkBot = null;
  for (var li = 0; li < lines.length; li++) {
    var ws = lines[li].split(" ");
    var lw = trackedW(ctx, lines[li], tr);
    var x = cx / sq - lw / 2;
    minX = Math.min(minX, x * sq); maxX = Math.max(maxX, (x + lw) * sq);
    var base0 = yy + size * S.ascent;
    var mtr = inkMetrics(ctx, lines[li], size);
    var lt = base0 - mtr.a, lb = base0 + mtr.d;
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
          lb = Math.max(lb, base0 + barGap + barH);
        }
      }
      if (k < ws.length - 1) x += adv(ctx, " ", tr);
    }
    inkTop = inkTop === null ? lt : Math.min(inkTop, lt);
    inkBot = inkBot === null ? lb : Math.max(inkBot, lb);
    yy += lh;
  }
  ctx.restore();
  // the returned box is the drawn INK, so centring it centres what the eye sees
  if (!lines.length || inkTop === null) return { x: cx - 1, y: top, w: 2, h: Math.max(1, lh) };
  return { x: minX, y: inkTop, w: Math.max(1, maxX - minX), h: Math.max(1, inkBot - inkTop) };
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
  var ph;
  if (tplDef().photos === "pair") {
    // the two-shot quote: subject and speaker side by side, one quote lockup
    pairBackground(ctx);
    ph = !!(get(state.left.id) || get(state.right.id));
  } else {
    ph = get(state.photo.id);
    layout.photo = { x: 0, y: 0, w: W, h: H };
    layout.left = null; layout.right = null;
    if (ph) {
      drawPhoto(ctx, ph, state.photo, 0, 0, W, H, mainMode());
      if (!state.clean) photoDressing(ctx);
    } else washField(ctx, 0, 0, W, H, cwOf(state.colorway), state.bg);
  }

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
  // photoless WASH: the colorway glyph on its own hue's field needs a floor
  // (the purple-on-purple trap) - the band grounds the type zone toward ink
  if (!ph && !state.clean) bandScrim(ctx, hy - 12, blockBottom + 14, S.band * clamp(state.grad, 0, 1.4), 170);

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
  inkReset();
  var dy = state.textDY, dx = state.textDX, ink = rgbOf(PAL.ink);
  var gb = ctx.createLinearGradient(0, H * 0.42, 0, H);
  gb.addColorStop(0, "rgba(" + ink + ",0)");
  gb.addColorStop(1, "rgba(" + seamTint3() + "," + (0.90 * clamp(state.grad, 0, 1.3)).toFixed(3) + ")");
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
      inkAddRect(drawBlock(ctx, [txt], size, cols[c], topRowY + r2 * lh, tr, lh,
        (function (row) { return function () { return row === 0; }; })(r2),
        "color", hlHex(), "#FFFFFF"));
    }
  }
  var title = (state.stat.title || "").toUpperCase().replace(/\\s+/g, " ").trim();
  var bandCy = topRowY - Math.round(H * 0.08);
  if (title) {
    var t = fitSingle(ctx, title, 900, 720, 118, 46, 0.02);
    setFont(ctx, 900, t.size);
    var tw = trackedW(ctx, title, t.tr) * S.squeeze;
    var bandH = t.size * 1.42, bandW = Math.min(W - 90, tw + 130);
    tapeBand(ctx, W / 2 + dx, bandCy, bandH, bandW);
    inkAdd(W / 2 + dx - bandW / 2, bandCy - bandH / 2, bandW, bandH);
    ctx.save();
    ctx.scale(S.squeeze, 1);
    ctx.textBaseline = "alphabetic";
    drawTracked(ctx, (W / 2 + dx) / S.squeeze - (tw / S.squeeze) / 2, bandCy + t.size * 0.36, title, t.tr, "#0B0B0E");
    ctx.restore();
  }
  // the union of what was ACTUALLY drawn, so align moves it by the true amount
  layout.text = inkRect({ x: 60 + dx, y: bandCy - 80, w: W - 120, h: (bottom - bandCy) + 90 });
  layout.inset = null;
}

/* ================= versus ================= */
function drawVersus(ctx) {
  pairBackground(ctx);
  inkReset();
  var dy = state.textDY, dx = state.textDX, ink = rgbOf(PAL.ink);
  var gb = ctx.createLinearGradient(0, H * 0.34, 0, H);
  gb.addColorStop(0, "rgba(" + ink + ",0)");
  gb.addColorStop(1, "rgba(" + seamTint3() + "," + (0.94 * clamp(state.grad, 0, 1.3)).toFixed(3) + ")");
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
  inkAddRect(drawBlock(ctx, [left], size, cx, top1, tr, lh, function () { return false; }, "color", hlHex(), "#FFFFFF"));
  setFont(ctx, 800, 30);
  var vw = trackedW(ctx, "VERSUS", 12);
  ctx.save();
  ctx.textBaseline = "alphabetic";
  ctx.shadowColor = "rgba(0,0,0,0.55)"; ctx.shadowBlur = 12; ctx.shadowOffsetY = 3;
  drawTracked(ctx, cx - vw / 2, vsBase, "VERSUS", 12, "#C9BBFF");
  ctx.restore();
  inkAddRect(lineBox(ctx, "VERSUS", cx, vsBase, vw, 30));
  inkAddRect(drawBlock(ctx, [right], size, cx, top2, tr, lh, function () { return false; }, "color", hlHex(), "#FFFFFF"));

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
    inkAddRect(lineBox(ctx, ev, cx, y3 + 56, ew, 30));
    y3 += 56;
  }
  var dt = (state.versus.date || "").toUpperCase().replace(/\\s+/g, " ").trim();
  if (dt) {
    var parts = dt.split(" - ");
    var df = fitSingle(ctx, parts[0], 900, 900, 58, 32, 0.01);
    var dTop = y3 + 34 - df.size * 0.35;
    inkAddRect(drawBlock(ctx, [parts[0]], df.size, cx, dTop, df.tr, Math.round(df.size * 1.1),
      function () { return false; }, "color", hlHex(), "#FFFFFF"));
    if (parts[1]) {
      setFont(ctx, 500, 26);
      var cw = trackedW(ctx, parts[1], 6);
      ctx.save();
      ctx.textBaseline = "alphabetic";
      drawTracked(ctx, cx - cw / 2, dTop + df.size * S.ascent + 34, parts[1], 6, PAL.dim);
      ctx.restore();
      inkAddRect(lineBox(ctx, parts[1], cx, dTop + df.size * S.ascent + 34, cw, 26));
      y3 = dTop + df.size * S.ascent + 34;
    } else y3 = dTop + df.size * S.ascent;
  }
  layout.text = inkRect({ x: 70 + dx, y: top1 + size * 0.30, w: W - 140, h: Math.max(120, y3 - top1) });
  layout.inset = null;
}

/* ================= then and now =================
   The only template that splits the canvas HORIZONTALLY: top half is the Left
   slot, bottom half the Right slot, and the label pair meets at the divider. */
function pairBackgroundY(ctx) {
  var a = get(state.left.id), b = get(state.right.id);
  layout.left = { x: 0, y: 0, w: W, h: H / 2 };
  layout.right = { x: 0, y: H / 2, w: W, h: H / 2 };
  layout.photo = layout.left;
  ctx.fillStyle = PAL.ink; ctx.fillRect(0, 0, W, H);
  if (a) drawPhoto(ctx, a, state.left, 0, 0, W, H / 2, halfMode());
  else { ctx.fillStyle = PAL.inkSoft; ctx.fillRect(0, 0, W, H / 2); }
  if (b) drawPhoto(ctx, b, state.right, 0, H / 2, W, H / 2, halfMode());
  else { ctx.fillStyle = PAL.inkSoft; ctx.fillRect(0, H / 2, W, H / 2); }
  if (!a && !b) glowField(ctx);
  var ink = rgbOf(PAL.ink), reach = Math.round(H * 0.11);
  var g = ctx.createLinearGradient(0, H / 2 - reach, 0, H / 2 + reach);
  g.addColorStop(0, "rgba(" + ink + ",0)");
  g.addColorStop(0.5, "rgba(" + ink + ",0.88)");
  g.addColorStop(1, "rgba(" + ink + ",0)");
  ctx.fillStyle = g; ctx.fillRect(0, H / 2 - reach, W, reach * 2);
}
function lineAt(ctx, text, weight, size, tr, cx, baseY, color, shadow) {
  setFont(ctx, weight, size);
  var w = trackedW(ctx, text, tr);
  ctx.save();
  ctx.textBaseline = "alphabetic";
  if (shadow !== false) { ctx.shadowColor = "rgba(0,0,0,0.62)"; ctx.shadowBlur = 14; ctx.shadowOffsetY = 4; }
  drawTracked(ctx, cx - w / 2, baseY, text, tr, color);
  ctx.restore();
  return w;
}
function up(s) { return String(s || "").toUpperCase().replace(/\\s+/g, " ").trim(); }
function drawThenNow(ctx) {
  pairBackgroundY(ctx);
  inkReset();
  if (!state.clean) vignette(ctx, 0.24, 2.3);
  var dx = state.textDX, dy = state.textDY, cx = W / 2 + dx, mid = H / 2 + dy;
  var g = ctx.createLinearGradient(0, 0, W, 0);
  g.addColorStop(0, PAL.deep); g.addColorStop(1, hlHex());
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.65)"; ctx.shadowBlur = 20;
  ctx.fillStyle = g; ctx.fillRect(0, mid - 3, W, 6);
  ctx.restore();

  var m = S.margin, maxW = (W - 2 * m) / S.squeeze;
  var t1 = up(state.tn.t1), t2 = up(state.tn.t2);
  var s1 = up(state.tn.s1), s2 = up(state.tn.s2);
  var a = fitSingle(ctx, t1 || "A", 900, maxW, 132, 46, S.track);
  var b = fitSingle(ctx, t2 || "B", 900, maxW, 132, 46, S.track);
  var size = Math.max(26, Math.round(Math.min(a.size, b.size) * state.textScale));
  var tr = -Math.round(size * S.track), lh = Math.round(size * S.spacing);
  var capSize = Math.max(18, Math.round(size * 0.24)), capTr = 5;
  var gap = 30, capGap = 20;
  var top = mid, bot = mid;

  if (s1) {
    var w1 = lineAt(ctx, s1, 600, capSize, capTr, cx, mid - gap, PAL.dim);
    inkAddRect(lineBox(ctx, s1, cx, mid - gap, w1, capSize));
  }
  if (t1) {
    var y1 = mid - gap - (s1 ? capSize + capGap : 0) - lh;
    // the past reads plain, the payoff carries the color
    inkAddRect(drawBlock(ctx, [t1], size, cx, y1, tr, lh, function () { return false; }, "color", hlHex(), "#FFFFFF"));
    top = y1;
  } else top = mid - gap - (s1 ? capSize + capGap : 0);
  if (t2) {
    var y2 = mid + gap;
    inkAddRect(drawBlock(ctx, [t2], size, cx, y2, tr, lh, function () { return true; }, "color", hlHex(), "#FFFFFF"));
    bot = y2 + lh;
    if (s2) {
      var w2b = lineAt(ctx, s2, 600, capSize, capTr, cx, bot + capGap + capSize * 0.8, PAL.dim);
      inkAddRect(lineBox(ctx, s2, cx, bot + capGap + capSize * 0.8, w2b, capSize));
      bot += capGap + capSize;
    }
  } else if (s2) {
    var w2c = lineAt(ctx, s2, 600, capSize, capTr, cx, mid + gap + capSize * 0.8, PAL.dim);
    inkAddRect(lineBox(ctx, s2, cx, mid + gap + capSize * 0.8, w2c, capSize));
    bot = mid + gap + capSize;
  }

  var title = up(state.tn.title);
  if (title) {
    // a wide-tracked strip, so the pill has to be measured and laid down first.
    // The pill rides dy WITH the labels: one rigid lockup is what lets a
    // measure-move-measure align land in a single correction instead of
    // chasing a box whose top does not move when the labels do.
    var f = fitSingle(ctx, title, 800, W - 2 * m - 80, 42, 20, -0.18);
    setFont(ctx, 800, f.size);
    var tw = trackedW(ctx, title, f.tr);
    var ty = m + f.size + dy, px = W / 2 + dx, ph2 = f.size + 30;
    roundRect(ctx, px - tw / 2 - 28, ty - f.size - 15, tw + 56, ph2, ph2 / 2);
    ctx.fillStyle = "rgba(" + rgbOf(PAL.ink) + ",0.68)"; ctx.fill();
    lineAt(ctx, title, 800, f.size, f.tr, px, ty, "#FFFFFF");
    inkAdd(px - tw / 2 - 28, ty - f.size - 15, tw + 56, ph2);
    top = Math.min(top, ty - f.size - 15);
  }
  layout.text = inkRect({ x: m + dx, y: top, w: W - 2 * m, h: Math.max(60, bot - top) });
  layout.inset = null;
}

/* ================= ranked list ================= */
/* measured first, drawn second: the whole lockup has to know its own height
   before it can sit in the middle of the canvas instead of hugging the top */
function titleBox(ctx, title, maxW, hi) {
  if (!title) return { size: 0, tr: 0, h: 0 };
  var f = fitSingle(ctx, title, 900, maxW / S.squeeze, hi, 34, 0.02);
  return { size: f.size, tr: f.tr, h: f.size * S.ascent + 31 };
}
function cardTitle(ctx, title, cx, top, tb) {
  if (!title || !tb.size) return top;
  var base = top + tb.size * S.ascent;
  ctx.save();
  ctx.scale(S.squeeze, 1);
  setFont(ctx, 900, tb.size);
  var w = trackedW(ctx, title, tb.tr);
  var mtr = inkMetrics(ctx, title, tb.size);
  ctx.textBaseline = "alphabetic";
  ctx.shadowColor = "rgba(0,0,0,0.62)"; ctx.shadowBlur = 16; ctx.shadowOffsetY = 4;
  drawTracked(ctx, cx / S.squeeze - w / 2, base, title, tb.tr, "#FFFFFF");
  ctx.restore();
  inkAdd(cx - (w * S.squeeze) / 2, base - mtr.a, w * S.squeeze, mtr.a + mtr.d);
  var rw = 156, rh = 7, ry = base + 24;
  roundRect(ctx, cx - rw / 2, ry, rw, rh, rh / 2);
  ctx.fillStyle = hlHex(); ctx.fill();
  inkAdd(cx - rw / 2, ry, rw, rh);
  return top + tb.h;
}
function scrimAll(ctx, alpha) {
  ctx.fillStyle = "rgba(" + rgbOf(PAL.ink) + "," + alpha.toFixed(3) + ")";
  ctx.fillRect(0, 0, W, H);
}
function soloBackground(ctx, scrim) {
  var ph = get(state.photo.id);
  layout.photo = { x: 0, y: 0, w: W, h: H };
  layout.left = null; layout.right = null;
  if (ph) drawPhoto(ctx, ph, state.photo, 0, 0, W, H, mainMode());
  else washField(ctx, 0, 0, W, H, cwOf(state.colorway), state.bg);
  scrimAll(ctx, (ph ? scrim : scrim * 0.55) * clamp(state.grad, 0, 1.4));
  if (!state.clean) vignette(ctx, 0.24, 2.2);
  return ph;
}
function drawList(ctx) {
  soloBackground(ctx, 0.54);
  inkReset();
  var m = S.margin, dx = state.textDX, dy = state.textDY, cx = W / 2 + dx;
  var rows = (state.list.rows || []).map(up).filter(function (t) { return !!t; }).slice(0, 6);
  var title = up(state.list.title);
  var tb = titleBox(ctx, title, W - 2 * m, 104);
  var titleGap = title ? 54 : 0;
  if (!rows.length) {
    var only = (H - tb.h) / 2 + dy;
    cardTitle(ctx, title, cx, only, tb);
    layout.text = inkRect({ x: m + dx, y: only, w: W - 2 * m, h: Math.max(80, tb.h) });
    layout.inset = null;
    return;
  }
  var box = H - 2 * Math.round(H * 0.07) - tb.h - titleGap;
  var rowH = clamp(box / rows.length, 62, 150) * clamp(state.textScale, 0.6, 1.6);
  var totalH = tb.h + titleGap + rows.length * rowH;
  var top = (H - totalH) / 2 + dy;
  var y = cardTitle(ctx, title, cx, top, tb) + titleGap;
  var numW = Math.round(rowH * 0.92), gap = 26;
  var textX = m + numW + gap, textMax = (W - m - textX) / S.squeeze;
  for (var i = 0; i < rows.length; i++) {
    var ry = y + i * rowH;
    if (i) {
      ctx.fillStyle = "rgba(245,244,246,0.13)";
      ctx.fillRect(m + dx, Math.round(ry), W - 2 * m, 2);
      inkAdd(m + dx, Math.round(ry), W - 2 * m, 2);
    }
    var nSize = Math.round(rowH * 0.62);
    setFont(ctx, 900, nSize);
    var nTxt = String(i + 1);
    var nTr = -Math.round(nSize * 0.03);
    var nw = trackedW(ctx, nTxt, nTr);
    ctx.save();
    ctx.textBaseline = "alphabetic";
    ctx.shadowColor = "rgba(0,0,0,0.6)"; ctx.shadowBlur = 14; ctx.shadowOffsetY = 4;
    drawTracked(ctx, m + dx + (numW - nw) / 2, ry + rowH / 2 + nSize * 0.35, nTxt, nTr, hlHex());
    ctx.restore();
    inkAddRect(lineBox(ctx, nTxt, m + dx + numW / 2, ry + rowH / 2 + nSize * 0.35, nw, nSize));
    var f = fitSingle(ctx, rows[i], 900, textMax, Math.round(rowH * 0.46), 22, 0.02);
    ctx.save();
    ctx.scale(S.squeeze, 1);
    setFont(ctx, 900, f.size);
    var rtw = trackedW(ctx, rows[i], f.tr);
    var rmtr = inkMetrics(ctx, rows[i], f.size);
    ctx.textBaseline = "alphabetic";
    ctx.shadowColor = "rgba(0,0,0,0.6)"; ctx.shadowBlur = 14; ctx.shadowOffsetY = 4;
    drawTracked(ctx, (textX + dx) / S.squeeze, ry + rowH / 2 + f.size * 0.35, rows[i], f.tr, "#FFFFFF");
    ctx.restore();
    inkAdd(textX + dx, ry + rowH / 2 + f.size * 0.35 - rmtr.a, rtw * S.squeeze, rmtr.a + rmtr.d);
  }
  layout.text = inkRect({ x: m + dx, y: top, w: W - 2 * m, h: totalH });
  layout.inset = null;
}

/* ================= multi event calendar ================= */
function drawCal(ctx) {
  soloBackground(ctx, 0.60);
  inkReset();
  var m = S.margin, dx = state.textDX, dy = state.textDY, cx = W / 2 + dx;
  var rows = (state.cal.rows || []).filter(function (r) { return r && (up(r.d) || up(r.m)); }).slice(0, 5);
  var title = up(state.cal.title);
  var tb = titleBox(ctx, title, W - 2 * m, 92);
  var titleGap = title ? 48 : 0;
  if (!rows.length) {
    var only = (H - tb.h) / 2 + dy;
    cardTitle(ctx, title, cx, only, tb);
    layout.text = inkRect({ x: m + dx, y: only, w: W - 2 * m, h: Math.max(80, tb.h) });
    layout.inset = null;
    return;
  }
  var gap = 18;
  var box = H - 2 * Math.round(H * 0.075) - tb.h - titleGap - gap * (rows.length - 1);
  var bandH = clamp(box / rows.length, 74, 190) * clamp(state.textScale, 0.7, 1.4);
  var totalH = tb.h + titleGap + rows.length * bandH + gap * (rows.length - 1);
  var top = (H - totalH) / 2 + dy;
  var y = cardTitle(ctx, title, cx, top, tb) + titleGap;
  var bw = W - 2 * m, hl = rgbOf(hlHex()), ink = rgbOf(PAL.ink);
  var dateW = Math.round(bw * 0.30);
  for (var i = 0; i < rows.length; i++) {
    var by = y + i * (bandH + gap), bx = m + dx;
    var fade = 0.88 - (0.62 * i) / Math.max(1, rows.length - 1);
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.5)"; ctx.shadowBlur = 22; ctx.shadowOffsetY = 7;
    roundRect(ctx, bx, by, bw, bandH, 18);
    ctx.fillStyle = "rgba(" + ink + ",0.72)";
    ctx.fill();
    ctx.restore();
    roundRect(ctx, bx, by, bw, bandH, 18);
    var wash = ctx.createLinearGradient(bx, 0, bx + bw, 0);
    wash.addColorStop(0, "rgba(" + hl + "," + fade.toFixed(3) + ")");
    wash.addColorStop(1, "rgba(" + hl + ",0.06)");
    ctx.fillStyle = wash; ctx.fill();
    inkAdd(bx, by, bw, bandH);
    var d = up(rows[i].d);
    if (d) {
      var df = fitSingle(ctx, d, 900, (dateW - 44) / S.squeeze, Math.round(bandH * 0.40), 20, 0.02);
      ctx.save();
      ctx.scale(S.squeeze, 1);
      setFont(ctx, 900, df.size);
      ctx.textBaseline = "alphabetic";
      var dw = trackedW(ctx, d, df.tr);
      drawTracked(ctx, (bx + dateW / 2) / S.squeeze - dw / 2, by + bandH / 2 + df.size * 0.35, d, df.tr, "#FFFFFF");
      ctx.restore();
      ctx.fillStyle = "rgba(255,255,255,0.34)";
      ctx.fillRect(bx + dateW, by + bandH * 0.22, 3, bandH * 0.56);
    }
    var mm = up(rows[i].m);
    if (mm) {
      var mf = fitSingle(ctx, mm, 900, (bw - dateW - 60) / S.squeeze, Math.round(bandH * 0.30), 18, 0.02);
      ctx.save();
      ctx.scale(S.squeeze, 1);
      setFont(ctx, 900, mf.size);
      ctx.textBaseline = "alphabetic";
      drawTracked(ctx, (bx + dateW + 30) / S.squeeze, by + bandH / 2 + mf.size * 0.35, mm, mf.tr, "#FFFFFF");
      ctx.restore();
    }
  }
  layout.text = inkRect({ x: m + dx, y: top, w: bw, h: totalH });
  layout.inset = null;
}

/* ================= announcement panels (the att-8 template) =================
   1-3 stacked panels, each its own colorway wash with the texture hidden in
   it, fighters flanking a huge centered line. One panel = the classic fight
   poster (stacked names + VS + bottom chip); two or three = the schedule
   stack, red/blue/green like the reference. */
function panelCount() { return clamp((state.panels && state.panels.n) || 1, 1, 3); }
function panelGeom() {
  var n = panelCount(), gap = n > 1 ? 5 : 0, out = [], y = 0;
  for (var i = 0; i < n; i++) {
    var ph = i < n - 1 ? Math.floor((H - gap * (n - 1)) / n) : H - y;
    out.push({ y: y, h: ph });
    y += ph + gap;
  }
  return out;
}
function panelColW() { return Math.round(W * 0.40); }
function drawPanelSide(ctx, row, sideKey, x, y, w, h, cw) {
  var slot = row[sideKey], img = get(slot.id);
  if (!img) return;
  var off = document.createElement("canvas");
  off.width = Math.max(1, Math.round(w)); off.height = Math.max(1, Math.round(h));
  var og = off.getContext("2d");
  drawPhoto(og, img, slot, 0, 0, off.width, off.height, "cover");
  // the panel's OWN wash over its subject (att 8: the fighters take the
  // panel hue) - independent of the global tint toggle
  og.globalCompositeOperation = "color";
  og.globalAlpha = 0.40; og.fillStyle = cw.mid;
  og.fillRect(0, 0, off.width, off.height);
  og.globalCompositeOperation = "multiply";
  og.globalAlpha = 0.12; og.fillStyle = cw.mid;
  og.fillRect(0, 0, off.width, off.height);
  // inner-edge fade so the center stays clear for type
  og.globalAlpha = 1;
  og.globalCompositeOperation = "destination-out";
  var fx0 = sideKey === "l" ? off.width * 0.58 : off.width * 0.42;
  var fx1 = sideKey === "l" ? off.width : 0;
  var fg = og.createLinearGradient(fx0, 0, fx1, 0);
  fg.addColorStop(0, "rgba(0,0,0,0)");
  fg.addColorStop(1, "rgba(0,0,0,0.94)");
  og.fillStyle = fg;
  og.fillRect(0, 0, off.width, off.height);
  ctx.drawImage(off, x, y);
}
function drawPanelChip(ctx, cx, cy, text, cw) {
  // near-black plate with a colorway keyline: a colorway FILL vanished into
  // its own wash in the round-1 blind ("red-on-red kicker vanishes")
  text = up(text);
  if (!text) return;
  setFont(ctx, 700, 30);
  var tr = 5, tw = trackedW(ctx, text, tr);
  var px = 26, py = 13, w = tw + 2 * px, h = 30 + 2 * py;
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.5)"; ctx.shadowBlur = 18; ctx.shadowOffsetY = 6;
  ctx.fillStyle = mixHex(PAL.ink, cw.deep, 0.5);
  ctx.fillRect(cx - w / 2, cy - h / 2, w, h);
  ctx.restore();
  ctx.fillStyle = cw.hot;
  ctx.fillRect(cx - w / 2, cy - h / 2, w, 4);
  ctx.save();
  ctx.textBaseline = "alphabetic";
  drawTracked(ctx, cx - tw / 2, cy + 30 * 0.36, text, tr, "#FFFFFF");
  ctx.restore();
  inkAdd(cx - w / 2, cy - h / 2, w, h);
}
function drawPanelText(ctx, row, g, cw, single) {
  var dx = state.textDX, dy = state.textDY;
  var cx = W / 2 + dx, sq = S.squeeze;
  var big = up(row.big), small = up(row.small), chip = up(row.chip);
  var top = 1e9, bot = -1e9;
  if (single && big.indexOf(" VS ") > 0) {
    var names = big.split(" VS ");
    var a = fitSingle(ctx, names[0], 900, 980 / sq, 146, 54, S.track);
    var b = fitSingle(ctx, names[1] || "TBA", 900, 980 / sq, 146, 54, S.track);
    var size = Math.max(30, Math.round(Math.min(a.size, b.size) * state.textScale));
    var tr = -Math.round(size * S.track), lh = Math.round(size * 0.93);
    var top1 = Math.round(g.y + g.h * 0.52) + dy;
    var base1 = top1 + size * S.ascent;
    var vsBase = base1 + 44;
    var top2 = base1 + 82 - size * 0.35;
    // the reference treatment: names sit on a real ink floor (round-1 blind:
    // white names melted into belts and washed torsos)
    var crush = ctx.createLinearGradient(0, g.y + g.h * 0.44, 0, g.y + g.h);
    crush.addColorStop(0, "rgba(11,11,14,0)");
    crush.addColorStop(1, "rgba(11,11,14," + (0.62 * clamp(state.grad, 0, 1.3)).toFixed(3) + ")");
    ctx.fillStyle = crush; ctx.fillRect(0, g.y + g.h * 0.44, W, g.h * 0.56);
    bandScrim(ctx, top1 + size * 0.30, top2 + size * S.ascent + 40,
              0.55 * clamp(state.grad, 0, 1.4), 150);
    var labelCol = mixHex(cw.hot, "#F5F4F6", 0.62);
    if (small) {
      setFont(ctx, 600, 30);
      var sw = trackedW(ctx, small, 8);
      ctx.save();
      ctx.textBaseline = "alphabetic";
      ctx.shadowColor = "rgba(0,0,0,0.55)"; ctx.shadowBlur = 12; ctx.shadowOffsetY = 3;
      drawTracked(ctx, cx - sw / 2, top1 - 26, small, 8, labelCol);
      ctx.restore();
      inkAddRect(lineBox(ctx, small, cx, top1 - 26, sw, 30));
      top = Math.min(top, top1 - 26 - 30);
    }
    inkAddRect(drawBlock(ctx, [names[0]], size, cx, top1, tr, lh, function () { return false; }, "color", cw.hot, "#FFFFFF"));
    setFont(ctx, 800, 34);
    var vw = trackedW(ctx, "VS", 12);
    ctx.save();
    ctx.textBaseline = "alphabetic";
    ctx.shadowColor = "rgba(0,0,0,0.55)"; ctx.shadowBlur = 12; ctx.shadowOffsetY = 3;
    drawTracked(ctx, cx - vw / 2, vsBase, "VS", 12, labelCol);
    ctx.restore();
    inkAddRect(lineBox(ctx, "VS", cx, vsBase, vw, 34));
    inkAddRect(drawBlock(ctx, [names[1] || "TBA"], size, cx, top2, tr, lh, function () { return false; }, "color", cw.hot, "#FFFFFF"));
    if (chip) drawPanelChip(ctx, cx, g.y + g.h - Math.round(g.h * 0.075), chip, cw);
    top = Math.min(top, top1);
    bot = top2 + size * S.ascent + (chip ? 90 : 30);
    return { top: top, bot: bot };
  }
  var f = fitSingle(ctx, big || "TBA", 900, (W * 0.62) / sq,
                    Math.round(g.h * (single ? 0.24 : 0.42)), 28, S.track);
  var size2 = Math.max(24, Math.round(f.size * state.textScale));
  var labelH = small ? 48 : 0;
  var cy = g.y + Math.round(g.h * 0.52) + (single ? dy : Math.round(dy / 3));
  var capTop = cy - Math.round((size2 * 0.72 - labelH) / 2);
  bandScrim(ctx, capTop - labelH - 22, capTop + size2 * 0.85 + 24,
            0.55 * clamp(state.grad, 0, 1.4), 110);
  if (small) {
    // near-white, hue-warmed: a pure colorway label sank into its own wash
    // in the round-1 blind ("red-on-red kicker vanishes")
    setFont(ctx, 600, 30);
    var sw2 = trackedW(ctx, small, 8);
    ctx.save();
    ctx.textBaseline = "alphabetic";
    ctx.shadowColor = "rgba(0,0,0,0.55)"; ctx.shadowBlur = 12; ctx.shadowOffsetY = 3;
    drawTracked(ctx, cx - sw2 / 2, capTop - 18, small, 8, mixHex(cw.hot, "#F5F4F6", 0.62));
    ctx.restore();
    inkAddRect(lineBox(ctx, small, cx, capTop - 18, sw2, 30));
  }
  var blockTop = capTop - size2 * 0.72;
  inkAddRect(drawBlock(ctx, [big || "TBA"], size2, cx, blockTop, -Math.round(size2 * S.track),
            Math.round(size2 * 1.02), function () { return false; }, "color", cw.hot, "#FFFFFF"));
  if (chip) drawPanelChip(ctx, cx, g.y + g.h - Math.round(g.h * 0.11), chip, cw);
  return { top: Math.min(blockTop, capTop - labelH - 22),
           bot: capTop + size2 * 0.85 + (chip ? 70 : 24) };
}
function drawPanels(ctx) {
  var geo = panelGeom(), n = panelCount();
  layout.left = null; layout.right = null; layout.inset = null;
  inkReset();
  ctx.fillStyle = PAL.ink; ctx.fillRect(0, 0, W, H);
  var colW = panelColW();
  var tTop = 1e9, tBot = -1e9;
  for (var i = 0; i < n; i++) {
    var row = state.panels.rows[i] || blankPanelRow("purple");
    var cw = cwOf(row.cw), g = geo[i];
    washField(ctx, 0, g.y, W, g.h, cw, state.bg);
    // neutral-dark pools behind the fighter seats: figure/ground separation
    // (round-3/4 blind: "fighters melt into the tinted arena")
    var poolCol = rgb3(mixHex(cw.deep, PAL.ink, 0.55));
    [0.175, 0.825].forEach(function (cxf) {
      var pr = W * 0.31;
      var pg = ctx.createRadialGradient(W * cxf, g.y + g.h * 0.42, 0, W * cxf, g.y + g.h * 0.42, pr);
      pg.addColorStop(0, "rgba(" + poolCol.join(",") + ",0.50)");
      pg.addColorStop(1, "rgba(" + poolCol.join(",") + ",0)");
      ctx.save();
      ctx.beginPath(); ctx.rect(0, g.y, W, g.h); ctx.clip();
      ctx.fillStyle = pg;
      ctx.fillRect(W * cxf - pr, g.y, pr * 2, g.h);
      ctx.restore();
    });
    drawPanelSide(ctx, row, "l", 0, g.y, colW, g.h, cw);
    drawPanelSide(ctx, row, "r", W - colW, g.y, colW, g.h, cw);
    var z = drawPanelText(ctx, row, g, cw, n === 1);
    if (z) { tTop = Math.min(tTop, z.top); tBot = Math.max(tBot, z.bot); }
  }
  layout.photo = { x: 0, y: 0, w: colW, h: geo[0].h };
  // the union of every panel's drawn type, so align reads the real lockup
  layout.text = inkRect({ x: Math.round(W * 0.22) + state.textDX,
                  y: tTop === 1e9 ? Math.round(H * 0.4) : Math.round(tTop),
                  w: Math.round(W * 0.56),
                  h: tBot === -1e9 ? Math.round(H * 0.2) : Math.round(tBot - tTop) });
}

/* ================= draw ================= */
var cv = $("cv"), ctx = cv.getContext("2d");
var sv = $("sel"), sctx = sv.getContext("2d");
var rafId = 0;
function requestDraw() {
  if (rafId) return;
  rafId = requestAnimationFrame(function () { rafId = 0; drawNow(); });
}
var drawErrors = 0, lastDrawError = "";
function drawNow() {
  if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
  drawCount++;
  try {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = PAL.ink; ctx.fillRect(0, 0, W, H);
    if (state.template === "stat") drawStat(ctx);
    else if (state.template === "versus") drawVersus(ctx);
    else if (state.template === "thennow") drawThenNow(ctx);
    else if (state.template === "list") drawList(ctx);
    else if (state.template === "cal") drawCal(ctx);
    else if (state.template === "panels") drawPanels(ctx);
    else drawNews(ctx);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.shadowColor = "transparent"; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
    if (!state.clean) grain(ctx, 0.05);
    footerBar(ctx);
    paintHud();
    paintSel();
  } catch (err) {
    // a draw bug must DEGRADE, never blank the whole app: log it, then paint
    // a plain floor so the canvas keeps its pixels and the controls keep
    // working. Re-setting the width resets clips and transforms a mid-draw
    // throw may have left behind.
    drawErrors++;
    lastDrawError = String((err && err.message) || err);
    try { if (window.console && console.error) console.error("studio draw failed:", err); } catch (e2) { /* no console */ }
    try {
      cv.width = W; cv.height = H;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = PAL.ink; ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = PAL.paper;
      ctx.font = "600 34px Poppins, sans-serif";
      ctx.textBaseline = "alphabetic";
      ctx.fillText("The preview hit a drawing bug. The controls still work.", 60, Math.round(H / 2));
      footerBar(ctx);
    } catch (e3) { /* even the floor failed, keep the app alive */ }
  }
  scheduleSave();
}
/* One derived list of what can be moved on THIS template. The hud, the toolbar
   chips and the per-element rows all read it, so they can never disagree. */
function layerList() {
  var d = tplDef(), out = [{ k: "text", n: "Text" }];
  if (d.photos === "panels") {
    for (var i = 0; i < panelCount(); i++) {
      out.push({ k: "p" + i + "l", n: (i + 1) + "L" });
      out.push({ k: "p" + i + "r", n: (i + 1) + "R" });
    }
    return out;
  }
  if (d.photos === "pair") {
    out.push({ k: "photo", n: d.axis === "y" ? "Top" : "Left" });
    out.push({ k: "right", n: d.axis === "y" ? "Bottom" : "Right" });
  } else out.push({ k: "photo", n: "Photo" });
  if (d.inset) out.push({ k: "inset", n: "Inset" });
  return out;
}
function panelKey(k) {
  var m = /^p([0-2])(l|r)$/.exec(String(k || ""));
  if (!m) return null;
  return { i: Number(m[1]), side: m[2] };
}
function layerName(k) {
  var ls = layerList();
  for (var i = 0; i < ls.length; i++) if (ls[i].k === k) return ls[i].n;
  return "Layer";
}
function paintHud() {
  var hud = $("hud");
  hud.innerHTML = "";
  layerList().forEach(function (l) {
    hud.appendChild(el("span", layer === l.k ? "on" : "", l.n));
  });
}
/* the selected layer gets a real box with corner handles, drawn on an overlay
   canvas so nothing of it can reach the exported PNG. */
function selRect() {
  var r = layerRect(layer);
  if (!r) return null;
  var pad = (layer === "text" || layer === "inset") ? 18 : -16;
  var x = r.x - pad, y = r.y - pad, w = r.w + 2 * pad, h = r.h + 2 * pad;
  x = clamp(x, 12, W - 40); y = clamp(y, 12, H - 40);
  w = clamp(w, 28, W - x - 12); h = clamp(h, 28, H - y - 12);
  return { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) };
}
/* ================= grid, smart guides, snapping =================
   The owner's words: "there's no grid, there's no alignment features, I just have
   to eyeball it." So: a grid he can size, guides that appear the moment a box
   lines up with the canvas centre, a margin or another layer, and a snap that
   lands it exactly there. Alt turns the snap off and shows the references. */
var SNAP_PX = 12;
var guides = { v: [], h: [] };
var altHeld = false, gridCount = 0;

function layerRect(k) {
  if (k === "text") return layout.text;
  if (k === "inset") return layout.inset;
  var pk = panelKey(k);
  if (pk) {
    var geo = panelGeom(), g = geo[Math.min(pk.i, geo.length - 1)];
    var colW = panelColW();
    return { x: pk.side === "l" ? 0 : W - colW, y: g.y, w: colW, h: g.h };
  }
  if (k === "right") return layout.right || layout.photo;
  return isPair() ? (layout.left || layout.photo) : layout.photo;
}
function photoSlot(k) {
  var pk = panelKey(k);
  if (pk) return state.panels.rows[pk.i][pk.side];
  if (!isPair()) return state.photo;
  return k === "right" ? state.right : state.left;
}
/* the position of a layer expressed in canvas pixels, whatever it is stored as */
function layerPos(k) {
  if (k === "text") return { x: state.textDX, y: state.textDY };
  if (k === "inset") return { x: state.inset.dx * W, y: state.inset.dy };
  var ps = photoSlot(k);
  return { x: ps.panX, y: ps.panY };
}
function setLayerPos(k, x, y) {
  if (k === "text") {
    state.textDX = clamp(x, -W * 0.5, W * 0.5);
    state.textDY = clamp(y, -H * 0.8, H * 0.8);
  } else if (k === "inset") {
    state.inset.dx = clamp(x / W, -0.48, 0.48);
    state.inset.dy = clamp(y, -H * 0.8, H * 0.8);
  } else {
    var ps = photoSlot(k);
    ps.panX = clamp(x, -3 * W, 3 * W);
    ps.panY = clamp(y, -3 * H, 3 * H);
  }
}
function anchorsX(r) { return [r.x, r.x + r.w / 2, r.x + r.w]; }
function anchorsY(r) { return [r.y, r.y + r.h / 2, r.y + r.h]; }
function targetsFor(skip) {
  var m = S.margin;
  var vx = [0, W / 2, W, m, W - m], hy = [0, H / 2, H, m, H - m];
  layerList().forEach(function (l) {
    if (l.k === skip) return;
    var q = layerRect(l.k);
    if (!q) return;
    vx = vx.concat(anchorsX(q));
    hy = hy.concat(anchorsY(q));
  });
  return { vx: vx, hy: hy };
}
/* Nearest wins, except the canvas centre, which wins ties and near ties. A block
   as wide as the text one sits 1.5px from the right margin when it is centered,
   so without this bias the margin would steal every attempt to center by hand. */
var CENTRE_BIAS = 4;
function nearest(vals, targets, tol, prefer) {
  var best = null;
  for (var i = 0; i < vals.length; i++) {
    for (var j = 0; j < targets.length; j++) {
      var d = targets[j] - vals[i];
      if (Math.abs(d) > tol) continue;
      var s = Math.abs(d) - (targets[j] === prefer ? CENTRE_BIAS : 0);
      if (best === null || s < best.s) best = { d: d, line: targets[j], s: s };
    }
  }
  return best;
}
function snapMove(k, r0, rawX, rawY) {
  var out = { x: rawX, y: rawY };
  if (!r0) return out;
  var t = targetsFor(k);
  var vx = anchorsX({ x: r0.x + rawX, y: 0, w: r0.w, h: 0 });
  var hy = anchorsY({ x: 0, y: r0.y + rawY, w: 0, h: r0.h });
  var sx = nearest(vx, t.vx, SNAP_PX, W / 2), sy = nearest(hy, t.hy, SNAP_PX, H / 2);
  if (sx) { out.x = rawX + sx.d; guides.v.push(sx.line); }
  if (sy) { out.y = rawY + sy.d; guides.h.push(sy.line); }
  return out;
}
function paintGrid() {
  gridCount = 0;
  if (!ui.grid) return;
  var step = clamp(parseInt(ui.gridSize, 10) || 90, 20, 400), x, y;
  sctx.save();
  sctx.strokeStyle = "rgba(255,255,255,0.12)";
  sctx.lineWidth = 2;
  sctx.beginPath();
  for (x = step; x < W - 1; x += step) { sctx.moveTo(x, 0); sctx.lineTo(x, H); gridCount++; }
  for (y = step; y < H - 1; y += step) { sctx.moveTo(0, y); sctx.lineTo(W, y); gridCount++; }
  sctx.stroke();
  sctx.strokeStyle = "rgba(255,255,255,0.24)";
  sctx.lineWidth = 3;
  sctx.beginPath();
  [W / 3, (2 * W) / 3].forEach(function (v) { sctx.moveTo(v, 0); sctx.lineTo(v, H); gridCount++; });
  [H / 3, (2 * H) / 3].forEach(function (v) { sctx.moveTo(0, v); sctx.lineTo(W, v); gridCount++; });
  sctx.stroke();
  sctx.strokeStyle = "rgba(164,92,255,0.42)";
  sctx.lineWidth = 3;
  sctx.setLineDash([16, 13]);
  sctx.strokeRect(S.margin, S.margin, W - 2 * S.margin, H - 2 * S.margin);
  sctx.setLineDash([]);
  gridCount++;
  sctx.restore();
}
function shownGuides() {
  var v = guides.v.slice(), h = guides.h.slice();
  if (altHeld) {
    // held modifier, Photoshop style: the references show even without a drag
    [W / 2, S.margin, W - S.margin].forEach(function (x) { if (v.indexOf(x) < 0) v.push(x); });
    [H / 2, S.margin, H - S.margin].forEach(function (y) { if (h.indexOf(y) < 0) h.push(y); });
  }
  return { v: v, h: h };
}
function paintGuides() {
  var g = shownGuides();
  if (!g.v.length && !g.h.length) return;
  sctx.save();
  sctx.strokeStyle = "#00E5FF";
  sctx.shadowColor = "rgba(0,0,0,0.65)";
  sctx.shadowBlur = 8;
  sctx.lineWidth = 4;
  sctx.beginPath();
  g.v.forEach(function (x) { sctx.moveTo(x, 0); sctx.lineTo(x, H); });
  g.h.forEach(function (y) { sctx.moveTo(0, y); sctx.lineTo(W, y); });
  sctx.stroke();
  sctx.restore();
}
function paintSel() {
  sctx.setTransform(1, 0, 0, 1, 0, 0);
  sctx.clearRect(0, 0, W, H);
  paintGrid();
  paintGuides();
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

/* ================= align and per element reset =================
   "If I want to make something center aligned, I just have to eyeball it." Not
   any more: every align measures the layer's real drawn box and moves it by the
   exact difference, then measures once more and corrects any rounding. */
var ALIGN = [
  { id: "left",   axis: "h", label: "Align left" },
  { id: "center", axis: "h", label: "Center across" },
  { id: "right",  axis: "h", label: "Align right" },
  { id: "top",    axis: "v", label: "Align top" },
  { id: "middle", axis: "v", label: "Center up and down" },
  { id: "bottom", axis: "v", label: "Align bottom" }
];
function alignAxis(mode) { return (mode === "left" || mode === "center" || mode === "right") ? "h" : "v"; }
/* how far a photo can pan before its own edge shows: the inverse of drawPhoto */
function panRange(k) {
  if (panelKey(k)) return null;   // panel slots pan freely; align = recenter
  var ps = photoSlot(k), img = get(ps.id);
  if (!img) return null;
  var fr = layerRect(k) || { w: W, h: H };
  var dw = fr.w, dh = fr.h;
  var iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
  if (!iw || !ih || !dw || !dh) return null;
  var mode = isPair() ? halfMode() : mainMode();
  if (mode === "fit") {
    var s = Math.min(dw / iw, dh / ih) * (ps.zoom || 1);
    var w = iw * s, h = ih * s;
    return { x0: (w - dw) / 2, x1: (dw - w) / 2, y0: (h - dh) / 2, y1: (dh - h) / 2 };
  }
  var punch = mode === "punch" ? S.zoom : 1;
  var s0 = Math.max(dw / iw, dh / ih);
  var sx0 = (iw - dw / s0) * 0.5, sy0 = (ih - dh / s0) * S.focusY;
  var zz = punch * (ps.zoom || 1);
  var w2 = dw / zz, h2 = dh / zz;
  var cy = clamp(dh * S.zoomCy, h2 / 2, dh - h2 / 2);
  var px = function (sx) { return s0 * (sx0 - sx) + (dw / 2 - w2 / 2); };
  var py = function (sy) { return s0 * (sy0 - sy) + (cy - h2 / 2); };
  return {
    x0: px(0), x1: px(Math.max(0, iw - w2 / s0)),
    y0: py(0), y1: py(Math.max(0, ih - h2 / s0))
  };
}
function alignPhoto(k, mode) {
  var ps = photoSlot(k);
  if (!get(ps.id)) { toast("Drop a photo into that slot first"); return false; }
  var r = panRange(k);
  snap();
  if (mode === "center") setLayerPos(k, 0, ps.panY);
  else if (mode === "middle") setLayerPos(k, ps.panX, 0);
  else if (!r) setLayerPos(k, 0, 0);
  else if (mode === "left") setLayerPos(k, r.x0, ps.panY);
  else if (mode === "right") setLayerPos(k, r.x1, ps.panY);
  else if (mode === "top") setLayerPos(k, ps.panX, r.y0);
  else setLayerPos(k, ps.panX, r.y1);
  drawNow(); refreshSliders();
  return true;
}
/* Move a layer so its drawn INK travels by (wantDx, wantDy). Most lockups
   answer a position change one for one, but the multi panel text answers dy
   with dy/3, so each pass measures the response and rescales the next command.
   Converges under half a pixel or stops after eight passes. */
function moveLayerInk(k, wantDx, wantDy) {
  var gx = 1, gy = 1;
  for (var pass = 0; pass < 8; pass++) {
    if (Math.abs(wantDx) < 0.5 && Math.abs(wantDy) < 0.5) return;
    var r = layerRect(k);
    if (!r) return;
    var p = layerPos(k);
    var mx = wantDx * gx, my = wantDy * gy;
    setLayerPos(k, p.x + mx, p.y + my);
    drawNow();
    var r2 = layerRect(k);
    if (!r2) return;
    var ax = r2.x - r.x, ay = r2.y - r.y;
    if (Math.abs(mx) > 0.01 && Math.abs(ax) > 0.01) gx = clamp(mx / ax, 0.25, 6);
    if (Math.abs(my) > 0.01 && Math.abs(ay) > 0.01) gy = clamp(my / ay, 0.25, 6);
    wantDx -= ax; wantDy -= ay;
  }
}
/* nudges and aligns may not push the lockup off the poster: pull the measured
   ink box back inside, and centre anything too big to fit at all */
function clampLayerIntoCanvas(k) {
  if (k !== "text" && k !== "inset") return;
  var r = layerRect(k);
  if (!r) return;
  var mx = 0, my = 0;
  if (r.w <= W) {
    if (r.x < 0) mx = -r.x;
    else if (r.x + r.w > W) mx = W - r.x - r.w;
  } else mx = (W - r.w) / 2 - r.x;
  if (r.h <= H) {
    if (r.y < 0) my = -r.y;
    else if (r.y + r.h > H) my = H - r.y - r.h;
  } else my = (H - r.h) / 2 - r.y;
  if (Math.abs(mx) >= 0.5 || Math.abs(my) >= 0.5) moveLayerInk(k, mx, my);
}
function alignLayer(k, mode) {
  if (k === "photo" || k === "right" || panelKey(k)) {
    if (alignPhoto(k, mode)) toast(layerName(k) + " photo aligned.");
    return;
  }
  if (!layerRect(k)) { toast("That layer is not on the poster right now"); return; }
  var h = alignAxis(mode) === "h";
  snap();
  // measure, move the ink by the exact difference, re-measure: the outer loop
  // only re-runs if the box changed size on the way (a reflow), the inner
  // moveLayerInk handles any lockup that under-answers a position change
  for (var pass = 0; pass < 3; pass++) {
    var r = layerRect(k);
    if (!r) break;
    var want, d;
    if (h) {
      want = mode === "left" ? S.margin : (mode === "right" ? W - S.margin - r.w : (W - r.w) / 2);
      d = want - r.x;
    } else {
      want = mode === "top" ? S.margin : (mode === "bottom" ? H - S.margin - r.h : (H - r.h) / 2);
      d = want - r.y;
    }
    if (Math.abs(d) < 0.5) break;
    moveLayerInk(k, h ? d : 0, h ? 0 : d);
  }
  clampLayerIntoCanvas(k);
  parkLayout();
  refreshSliders();
  toast(layerName(k) + " " + (mode === "center" || mode === "middle" ? "centered" : "aligned " + mode) + ".");
}
function resetLayer(k, quiet) {
  snap();
  if (k === "text") {
    state.textDX = 0; state.textDY = 0; state.textScale = 1;
    state.tpl[state.template] = { dx: 0, dy: 0, scale: 1 };
  } else if (k === "inset") {
    state.inset.dx = S.insetDx; state.inset.dy = 0; state.inset.scale = 1;
  } else {
    var ps = photoSlot(k);
    ps.panX = 0; ps.panY = 0; ps.zoom = 1;
  }
  drawNow(); refreshSliders();
  if (!quiet) toast(layerName(k) + " is back where it started.");
}

/* ================= template picker ================= */
var ART = {
  quote: '<rect x="2" y="2" width="30" height="38" rx="4" fill="#20202E"/><rect x="2" y="24" width="30" height="16" rx="0" fill="#12121B"/><circle cx="15" cy="20" r="1.6" fill="#A45CFF"/><circle cx="19" cy="20" r="1.6" fill="#A45CFF"/><rect x="6" y="26" width="22" height="4" rx="1.4" fill="#EDEBF1"/><rect x="9" y="32" width="16" height="4" rx="1.4" fill="#A45CFF"/>',
  inset: '<rect x="2" y="2" width="30" height="38" rx="4" fill="#20202E"/><rect x="18" y="14" width="12" height="12" rx="2.5" fill="#EDEBF1"/><rect x="20" y="16" width="8" height="8" rx="1.5" fill="#5B3DF5"/><rect x="6" y="29" width="22" height="4" rx="1.4" fill="#EDEBF1"/><rect x="9" y="35" width="16" height="3" rx="1.4" fill="#A45CFF"/>',
  state: '<rect x="2" y="2" width="30" height="38" rx="4" fill="#20202E"/><rect x="4" y="16" width="26" height="9" rx="2" fill="#EDEBF1"/><rect x="10" y="27" width="14" height="3" rx="1.5" fill="#A45CFF"/>',
  stat: '<rect x="2" y="2" width="14" height="38" rx="4" fill="#20202E"/><rect x="18" y="2" width="14" height="38" rx="4" fill="#20202E"/><rect x="3" y="17" width="28" height="7" rx="2" fill="#EDEBF1"/><rect x="4" y="28" width="10" height="4" rx="1.4" fill="#A45CFF"/><rect x="20" y="28" width="10" height="4" rx="1.4" fill="#A45CFF"/><rect x="4" y="34" width="10" height="3" rx="1.4" fill="#7B7A8C"/><rect x="20" y="34" width="10" height="3" rx="1.4" fill="#7B7A8C"/>',
  versus: '<rect x="2" y="2" width="14" height="38" rx="4" fill="#20202E"/><rect x="18" y="2" width="14" height="38" rx="4" fill="#20202E"/><rect x="5" y="22" width="24" height="5" rx="1.6" fill="#EDEBF1"/><rect x="12" y="29" width="10" height="3" rx="1.4" fill="#A45CFF"/><rect x="5" y="34" width="24" height="4" rx="1.6" fill="#EDEBF1"/>',
  duo: '<rect x="2" y="2" width="14" height="24" rx="3" fill="#20202E"/><rect x="18" y="2" width="14" height="24" rx="3" fill="#20202E"/><circle cx="15" cy="29" r="1.5" fill="#A45CFF"/><circle cx="19" cy="29" r="1.5" fill="#A45CFF"/><rect x="4" y="33" width="26" height="4" rx="1.4" fill="#EDEBF1"/><rect x="9" y="38.5" width="16" height="2.4" rx="1.2" fill="#7B7A8C"/>',
  thennow: '<rect x="2" y="2" width="30" height="18" rx="3" fill="#20202E"/><rect x="2" y="22" width="30" height="18" rx="3" fill="#20202E"/><rect x="2" y="20.4" width="30" height="1.6" fill="#A45CFF"/><rect x="9" y="13" width="16" height="4" rx="1.4" fill="#EDEBF1"/><rect x="9" y="25" width="16" height="4" rx="1.4" fill="#EDEBF1"/>',
  list: '<rect x="2" y="2" width="30" height="38" rx="4" fill="#20202E"/><rect x="10" y="6" width="14" height="4" rx="1.4" fill="#EDEBF1"/><rect x="5" y="14" width="4" height="4" rx="1.2" fill="#A45CFF"/><rect x="11" y="14" width="18" height="4" rx="1.4" fill="#EDEBF1"/><rect x="5" y="22" width="4" height="4" rx="1.2" fill="#A45CFF"/><rect x="11" y="22" width="18" height="4" rx="1.4" fill="#EDEBF1"/><rect x="5" y="30" width="4" height="4" rx="1.2" fill="#A45CFF"/><rect x="11" y="30" width="18" height="4" rx="1.4" fill="#EDEBF1"/>',
  cal: '<rect x="2" y="2" width="30" height="38" rx="4" fill="#20202E"/><rect x="5" y="8" width="24" height="8" rx="2.4" fill="#5B3DF5"/><rect x="5" y="19" width="24" height="8" rx="2.4" fill="#8B70FF"/><rect x="5" y="30" width="24" height="8" rx="2.4" fill="#A45CFF" opacity="0.62"/><rect x="8" y="11" width="6" height="2.6" rx="1.2" fill="#FFFFFF"/><rect x="8" y="22" width="6" height="2.6" rx="1.2" fill="#FFFFFF"/><rect x="8" y="33" width="6" height="2.6" rx="1.2" fill="#FFFFFF"/>',
  panels: '<rect x="2" y="2" width="30" height="11.5" rx="2.4" fill="#C81A10"/><rect x="2" y="15.5" width="30" height="11.5" rx="2.4" fill="#1E52D0"/><rect x="2" y="29" width="30" height="11" rx="2.4" fill="#0FA050"/><rect x="10" y="6" width="14" height="3.6" rx="1.4" fill="#FFFFFF"/><rect x="10" y="19.5" width="14" height="3.6" rx="1.4" fill="#FFFFFF"/><rect x="10" y="33" width="14" height="3.6" rx="1.4" fill="#FFFFFF"/>'
};
function buildTpl() {
  var host = $("tpl"), sel = $("tplQuick");
  TEMPLATES.forEach(function (t) {
    var b = el("button");
    b.type = "button";
    b.setAttribute("aria-pressed", state.template === t.id ? "true" : "false");
    b.dataset.id = t.id;
    b.innerHTML = '<svg viewBox="0 0 34 42" aria-hidden="true">' + ART[t.art] + "</svg>";
    b.appendChild(el("span", null, t.name));
    b.addEventListener("click", function () { setTemplate(t.id); });
    host.appendChild(b);
    var o = document.createElement("option");
    o.value = t.id; o.textContent = t.name;
    sel.appendChild(o);
  });
  sel.value = state.template;
  sel.addEventListener("change", function () { setTemplate(sel.value); });
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
function setTemplate(id, noSnap) {
  if (state.template === id) return;
  // noSnap: the caller already snapped this gesture (pickStaged) - a second
  // snapshot here would make the first Undo press a visible no-op
  if (!noSnap) snap();
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
  var ok = false;
  layerList().forEach(function (l) { if (l.k === layer) ok = true; });
  if (!ok) layer = "text";
  syncInputs(); drawNow();
}
/* one definition of "reset": this does to EVERY layer exactly what the row's
   own Reset does to one, zoom and scale included, so the two buttons can
   never disagree by a few pixels */
function recenter() {
  snap();
  state.textDX = 0; state.textDY = 0; state.textScale = 1;
  state.tpl[state.template] = { dx: 0, dy: 0, scale: 1 };
  [state.photo, state.left, state.right].forEach(function (ps) {
    ps.panX = 0; ps.panY = 0; ps.zoom = 1;
  });
  state.panels.rows.forEach(function (r) {
    [r.l, r.r].forEach(function (ps) { ps.panX = 0; ps.panY = 0; ps.zoom = 1; });
  });
  state.inset.dx = S.insetDx; state.inset.dy = 0; state.inset.scale = 1;
  syncInputs(); drawNow();
  toast("Every layer reset, zoom included. Highlights kept.");
}

/* ================= the stage toolbar =================
   "You have to scroll way down." Everything reached often is in here, and this
   bar is sticky right above the poster on every width. */
function ln(d) { return '<path d="' + d + '" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>'; }
function bx(x, y, w, h) { return '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" rx="1.4" fill="currentColor"/>'; }
var ICON = {
  left:   ln("M4 3.5v17") + bx(7.5, 6.2, 12, 4.2) + bx(7.5, 13.6, 7.5, 4.2),
  center: ln("M12 3.5v17") + bx(4, 6.2, 16, 4.2) + bx(7, 13.6, 10, 4.2),
  right:  ln("M20 3.5v17") + bx(4.5, 6.2, 12, 4.2) + bx(9, 13.6, 7.5, 4.2),
  top:    ln("M3.5 4h17") + bx(6.2, 7.5, 4.2, 12) + bx(13.6, 7.5, 4.2, 7.5),
  middle: ln("M3.5 12h17") + bx(6.2, 4, 4.2, 16) + bx(13.6, 7, 4.2, 10),
  bottom: ln("M3.5 20h17") + bx(6.2, 4.5, 4.2, 12) + bx(13.6, 9, 4.2, 7.5),
  grid:   ln("M3 9h18M3 15h18M9 3v18M15 3v18"),
  snapi:  ln("M12 3v18M7.5 8l-4 4 4 4M16.5 8l4 4-4 4"),
  reset:  ln("M20 12a8 8 0 1 1-2.4-5.7M20 3.5V9.2h-5.7"),
  undo:   ln("M10 7L5 12l5 5M5 12h8.5a5 5 0 0 1 0 10H11"),
  redo:   ln("M14 7l5 5-5 5M19 12h-8.5a5 5 0 0 0 0 10H13"),
  nleft:  ln("M14.5 5.5L8 12l6.5 6.5"),
  nright: ln("M9.5 5.5L16 12l-6.5 6.5"),
  nup:    ln("M5.5 14.5L12 8l6.5 6.5"),
  ndown:  ln("M5.5 9.5L12 16l6.5-6.5")
};
function icon(d) { return '<svg viewBox="0 0 24 24" aria-hidden="true">' + d + "</svg>"; }
function alignButton(k, a, label) {
  var b = el("button", "ibtn");
  b.type = "button";
  b.dataset.align = a.id;
  b.dataset.for = k;
  b.setAttribute("aria-label", label);
  b.title = a.label;
  b.innerHTML = icon(ICON[a.id]);
  return b;
}
function buildAlignBar() {
  var host = $("alignBar");
  host.innerHTML = "";
  ALIGN.forEach(function (a, i) {
    if (i === 3) host.appendChild(el("span", "tsep"));
    var b = alignButton("", a, a.label + ", selected layer");
    b.addEventListener("click", function () { alignLayer(layer, a.id); });
    host.appendChild(b);
  });
}
/* one row per movable element: pick it, align it, and reset THAT one alone */
function buildLayerRows() {
  var host = $("layerRows");
  if (!host) return;
  host.innerHTML = "";
  layerList().forEach(function (l) {
    var row = el("div", "lrow" + (layer === l.k ? " on" : ""));
    row.dataset.layer = l.k;
    var nm = el("button", "nm", l.n);
    nm.type = "button";
    nm.setAttribute("aria-label", "Move the " + l.n + " layer");
    nm.addEventListener("click", function () { setLayer(l.k); });
    row.appendChild(nm);
    ALIGN.forEach(function (a) {
      var b = alignButton(l.k, a, a.label + ", " + l.n);
      b.addEventListener("click", function () { setLayer(l.k); alignLayer(l.k, a.id); });
      row.appendChild(b);
    });
    var r = el("button", "ibtn");
    r.type = "button";
    r.setAttribute("aria-label", "Reset " + l.n + " on its own");
    r.title = "Reset " + l.n;
    r.innerHTML = icon(ICON.reset);
    r.addEventListener("click", function () { setLayer(l.k); resetLayer(l.k); });
    row.appendChild(r);
    host.appendChild(row);
  });
}
function syncToolbar() {
  press($("gridBtn"), ui.grid);
  press($("snapBtn"), ui.snap);
  $("gridSize").value = String(ui.gridSize);
  $("gridSize").disabled = !ui.grid;
  $("tplQuick").value = state.template;
  var ns = $("nudgeStepBtn");
  if (ns) ns.textContent = ui.nudgeStep + "px";
}
/* touch nudging: a phone has no arrow keys, so the toolbar carries four
   arrows plus a 1px / 8px step toggle that act on the selected layer */
var NUDGE = [
  { id: "nleft",  dx: -1, dy: 0,  label: "Nudge left" },
  { id: "nup",    dx: 0,  dy: -1, label: "Nudge up" },
  { id: "ndown",  dx: 0,  dy: 1,  label: "Nudge down" },
  { id: "nright", dx: 1,  dy: 0,  label: "Nudge right" }
];
function buildNudgeBar() {
  var host = $("nudgeBar");
  if (!host) return;
  host.innerHTML = "";
  NUDGE.forEach(function (nd) {
    var b = el("button", "ibtn");
    b.type = "button";
    b.setAttribute("aria-label", nd.label + ", selected layer");
    b.title = nd.label;
    b.innerHTML = icon(ICON[nd.id]);
    b.addEventListener("click", function () {
      snap();
      nudge(layer, nd.dx * ui.nudgeStep, nd.dy * ui.nudgeStep);
      drawNow();
      clampLayerIntoCanvas(layer);
      refreshSliders();
    });
    host.appendChild(b);
  });
  var st = el("button", "tchip", ui.nudgeStep + "px");
  st.type = "button";
  st.id = "nudgeStepBtn";
  st.setAttribute("aria-label", "Nudge step, tap to switch between 1 and 8 pixels");
  st.title = "Nudge step";
  st.addEventListener("click", function () {
    ui.nudgeStep = ui.nudgeStep === 1 ? 8 : 1;
    st.textContent = ui.nudgeStep + "px";
    scheduleSave();
  });
  host.appendChild(st);
}
function bootToolbar() {
  $("gridBtn").innerHTML = icon(ICON.grid);
  $("snapBtn").innerHTML = icon(ICON.snapi);
  $("tbUndo").innerHTML = icon(ICON.undo);
  $("tbRedo").innerHTML = icon(ICON.redo);
  $("tbReset").innerHTML = icon(ICON.reset);
  buildAlignBar();
  buildNudgeBar();
  $("gridBtn").addEventListener("click", function () {
    ui.grid = !ui.grid;
    syncToolbar(); paintSel(); scheduleSave();
    toast(ui.grid ? "Grid on, " + ui.gridSize + " px" : "Grid off");
  });
  $("snapBtn").addEventListener("click", function () {
    ui.snap = !ui.snap;
    syncToolbar(); scheduleSave();
    toast(ui.snap ? "Snapping on. Hold Alt to switch it off for one drag." : "Snapping off");
  });
  $("gridSize").addEventListener("change", function () {
    ui.gridSize = clamp(parseInt($("gridSize").value, 10) || 90, 20, 400);
    if (!ui.grid) { ui.grid = true; syncToolbar(); }
    paintSel(); scheduleSave();
  });
  $("tbUndo").addEventListener("click", undo);
  $("tbRedo").addEventListener("click", redo);
  $("tbReset").addEventListener("click", function () { resetLayer(layer); });
  // the bar parks itself under the topbar, whatever height that ends up being
  var fit = function () {
    var tb = document.querySelector(".topbar");
    if (tb) document.documentElement.style.setProperty("--tbtop", Math.round(tb.getBoundingClientRect().height) + "px");
  };
  fit();
  window.addEventListener("resize", fit);
  if (window.ResizeObserver) {
    try { new ResizeObserver(fit).observe(document.querySelector(".topbar")); } catch (e) { /* older engine */ }
  }
}
function setAlt(v) {
  if (altHeld === v) return;
  altHeld = v;
  paintSel();
}
window.addEventListener("keydown", function (e) {
  if (e.key !== "Alt") return;
  setAlt(true);
  if (activeTab === "tab-post") e.preventDefault();
});
window.addEventListener("keyup", function (e) { if (e.key === "Alt" || !e.altKey) setAlt(false); });
window.addEventListener("blur", function () { setAlt(false); });

/* ================= rows for the list and calendar templates ================= */
function rowInput(value, label, place, onInput) {
  var inp = document.createElement("input");
  inp.type = "text"; inp.value = value || "";
  inp.style.flex = "1";
  inp.setAttribute("aria-label", label);
  inp.placeholder = place;
  var t = 0, snapped = false;
  inp.addEventListener("input", function () {
    if (!snapped) { snap(); snapped = true; }
    clearTimeout(t);
    t = setTimeout(function () { snapped = false; }, 700);
    onInput(inp.value);
    requestDraw();
  });
  return inp;
}
function delButton(label, onClick) {
  var b = el("button", "del", "\\u00d7");
  b.type = "button";
  b.setAttribute("aria-label", label);
  b.addEventListener("click", onClick);
  return b;
}
function buildListRows() {
  var host = $("listRows");
  if (!host) return;
  host.innerHTML = "";
  state.list.rows.forEach(function (t, i) {
    var row = el("div", "draftrow");
    row.style.marginBottom = "8px";
    row.appendChild(rowInput(t, "Row " + (i + 1), "Row " + (i + 1), function (v) { state.list.rows[i] = v; }));
    row.appendChild(delButton("Remove row " + (i + 1), function () {
      snap(); state.list.rows.splice(i, 1); buildListRows(); drawNow();
    }));
    host.appendChild(row);
  });
  $("listAdd").disabled = state.list.rows.length >= 6;
}
function buildCalRows() {
  var host = $("calRows");
  if (!host) return;
  host.innerHTML = "";
  state.cal.rows.forEach(function (r, i) {
    var row = el("div", "draftrow");
    row.style.marginBottom = "8px";
    var d = rowInput(r.d, "Date " + (i + 1), "NOV 15", function (v) { state.cal.rows[i].d = v; });
    d.style.flex = "0 0 92px";
    row.appendChild(d);
    row.appendChild(rowInput(r.m, "Matchup " + (i + 1), "NAME VS NAME", function (v) { state.cal.rows[i].m = v; }));
    row.appendChild(delButton("Remove event " + (i + 1), function () {
      snap(); state.cal.rows.splice(i, 1); buildCalRows(); drawNow();
    }));
    host.appendChild(row);
  });
  $("calAdd").disabled = state.cal.rows.length >= 5;
}

/* ================= background + colorway card ================= */
function buildWashCard() {
  var host = $("cwRow");
  if (!host) return;
  host.innerHTML = "";
  CW.forEach(function (c) {
    var b = el("button", "sw");
    b.type = "button";
    b.style.background = "linear-gradient(140deg," + c.hot + "," + c.deep + ")";
    b.setAttribute("aria-pressed", state.colorway === c.id ? "true" : "false");
    b.setAttribute("aria-label", "Colorway " + c.label);
    b.appendChild(el("span", null, c.label));
    b.addEventListener("click", function () {
      snap();
      state.colorway = c.id;
      // the highlight color follows the wash unless the owner picked white -
      // a purple hot word on a red field reads as a mistake, not a choice
      if (state.hlColor !== "white") {
        var map = { purple: "purple", red: "red", blue: "blue", green: "green", gold: "orange" };
        state.hlColor = map[c.id] || "purple";
      }
      syncInputs(); drawNow(); drawAllPolls();
    });
    host.appendChild(b);
  });
  var bg = $("bgRow");
  bg.innerHTML = "";
  BGS.forEach(function (g) {
    var b = el("button", "chip", g.label);
    b.type = "button";
    b.setAttribute("aria-pressed", state.bg === g.id ? "true" : "false");
    b.addEventListener("click", function () {
      snap(); state.bg = g.id;
      buildWashCard(); drawNow(); drawAllPolls();
    });
    bg.appendChild(b);
  });
  // the wash only paints when no photo covers it - without this note, tapping
  // the texture chips with a photo loaded looks like "the background changing
  // does not work" (the owner's exact words). The chips stay live: the pick
  // applies the moment the photo is removed.
  var bn = $("bgNote");
  if (bn) {
    var newsFamily = (state.template === "quote" || state.template === "inset"
                      || state.template === "state");
    bn.hidden = !(newsFamily && !!get(state.photo.id));
  }
  var seg = $("tintSeg").querySelectorAll("button");
  for (var i = 0; i < seg.length; i++) {
    press(seg[i], (seg[i].dataset.tint === "0") === !(state.tint > 0));
  }
}

/* ================= announcement panel rows ================= */
function buildPanelRows() {
  var host = $("panelRows");
  if (!host) return;
  host.innerHTML = "";
  var n = panelCount();
  var seg = $("panelSeg").querySelectorAll("button");
  for (var s = 0; s < seg.length; s++) press(seg[s], Number(seg[s].dataset.n) === n);
  for (var i = 0; i < n; i++) {
    (function (i) {
      var row = state.panels.rows[i];
      var box = el("div");
      box.style.cssText = "border:1px solid var(--line);border-radius:12px;padding:10px;margin-bottom:10px;background:var(--sunk)";
      var head = el("div", "chead");
      head.appendChild(el("h2", null, "Panel " + (i + 1)));
      var sws = el("div");
      sws.style.cssText = "display:flex;gap:6px;margin-left:auto";
      CW.forEach(function (c) {
        var b = el("button", "tsw");
        b.type = "button";
        b.style.background = "linear-gradient(140deg," + c.hot + "," + c.deep + ")";
        b.setAttribute("aria-pressed", row.cw === c.id ? "true" : "false");
        b.setAttribute("aria-label", "Panel " + (i + 1) + " color " + c.label);
        b.title = c.label;
        b.addEventListener("click", function () {
          snap(); row.cw = c.id; buildPanelRows(); drawNow();
        });
        sws.appendChild(b);
      });
      head.appendChild(sws);
      box.appendChild(head);
      var r1 = el("div", "two");
      var f1 = el("div", "field");
      f1.appendChild(rowInput(row.big, "Panel " + (i + 1) + " big line", n === 1 ? "NAME VS NAME" : "SEPT 12", function (v) { row.big = v; }));
      var f2 = el("div", "field");
      f2.appendChild(rowInput(row.small, "Panel " + (i + 1) + " label", "NOCHE UFC", function (v) { row.small = v; }));
      r1.appendChild(f1); r1.appendChild(f2);
      box.appendChild(r1);
      var f3 = el("div", "field");
      f3.appendChild(rowInput(row.chip, "Panel " + (i + 1) + " chip", n === 1 ? "LIGHTWEIGHT BOUT" : "JULY 31", function (v) { row.chip = v; }));
      box.appendChild(f3);
      var drops = el("div", "two");
      ["l", "r"].forEach(function (sideKey) {
        var wrapF = el("div", "field");
        var d = el("div", "drop");
        d.id = "pd" + i + sideKey;
        d.setAttribute("role", "button"); d.tabIndex = 0;
        d.setAttribute("aria-label", "Panel " + (i + 1) + (sideKey === "l" ? " left" : " right") + " photo");
        var f = document.createElement("input");
        f.type = "file"; f.accept = "image/*"; f.className = "hidden";
        f.id = "pf" + i + sideKey;
        wrapF.appendChild(d); wrapF.appendChild(f);
        drops.appendChild(wrapF);
        box.appendChild(drops);
        bindDrop(d.id, f.id, function (im, u) {
          row[sideKey].id = put(im, { data: toData(im) }, u);
          buildPanelRows(); drawNow(); scheduleSave();
        }, function () {
          row[sideKey].id = null;
          buildPanelRows(); drawNow(); scheduleSave();
        }, snap);
        paintDrop(d.id, urlOf(row[sideKey].id), sideKey === "l" ? "Left photo" : "Right photo");
      });
      host.appendChild(box);
    })(i);
  }
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
    var b = el("button", "tsw");
    b.type = "button";
    b.style.background = c.hex;
    b.setAttribute("aria-pressed", state.hlColor === c.id ? "true" : "false");
    b.setAttribute("aria-label", "Highlight color " + c.label);
    b.title = c.label;
    b.dataset.hl = c.id;
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
  { id: "tw", label: "Colorway tint", min: function () { return 0; }, max: function () { return 100; }, step: 5,
    get: function () { return Math.round(state.tint || 0); },
    set: function (v) { state.tint = v; buildWashCard(); },
    fmt: function (v) { return v ? v + "%" : "off"; } },
  { id: "pz", label: "Photo zoom", min: function () { return 100; }, max: function () { return 260; }, step: 2,
    get: function () { return Math.round(activePhoto().zoom * 100); }, set: function (v) { activePhoto().zoom = v / 100; }, fmt: function (v) { return v + "%"; } },
  { id: "is", label: "Inset size", min: function () { return 60; }, max: function () { return 200; }, step: 2, only: "inset",
    get: function () { return Math.round(state.inset.scale * 100); }, set: function (v) { state.inset.scale = v / 100; }, fmt: function (v) { return v + "%"; } }
];
function isPair() { return tplDef().photos === "pair"; }
function activePhoto() {
  var pk = panelKey(layer);
  if (pk) return state.panels.rows[pk.i][pk.side];
  if (tplDef().photos === "panels") return state.panels.rows[0].l;
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
  // buildWashCard keeps the bgNote honest: it shows/hides with the photo,
  // and this is the one choke point every photo add/remove goes through
  syncDrops(); buildWashCard(); drawNow();
}

/* ================= pointer editing ================= */
/* a canvas with no layout yet (a hidden tab, a zero height pane) would divide by
   zero here and write NaN into every offset, so a degenerate box means no point */
function canvasPoint(e) {
  var r = cv.getBoundingClientRect();
  if (!r.width || !r.height) return null;
  return { x: (e.clientX - r.left) * (W / r.width), y: (e.clientY - r.top) * (H / r.height) };
}
function inside(rect, p, pad) {
  if (!rect) return false;
  pad = pad || 0;
  return p.x >= rect.x - pad && p.x <= rect.x + rect.w + pad && p.y >= rect.y - pad && p.y <= rect.y + rect.h + pad;
}
function pickLayer(p) {
  var d = tplDef(), pick = "photo";
  if (d.photos === "panels") {
    if (inside(layout.text, p, 26)) return "text";
    var geo = panelGeom();
    for (var i = 0; i < geo.length; i++) {
      if (p.y >= geo[i].y && p.y <= geo[i].y + geo[i].h) {
        return "p" + i + (p.x > W / 2 ? "r" : "l");
      }
    }
    return "text";
  }
  if (d.photos === "pair") pick = (d.axis === "y" ? p.y > H / 2 : p.x > W / 2) ? "right" : "photo";
  if (d.inset && inside(layout.inset, p, 10)) pick = "inset";
  else if (inside(layout.text, p, 26)) pick = "text";
  return pick;
}
var dragging = null;
/* A drag tracks the UNSNAPPED position and derives the snapped one from it every
   frame. That is what makes a guide sticky: the layer holds the line while the
   finger drifts inside the threshold, then releases cleanly past it. */
cv.addEventListener("pointerdown", function (e) {
  var p = canvasPoint(e);
  if (!p) return;
  // preventDefault below cancels the browser's own click-to-focus, which used
  // to leave the arrow keys dead after a tap on the poster. Focus by hand.
  try { cv.focus({ preventScroll: true }); } catch (err0) { try { cv.focus(); } catch (err1) { /* no focus */ } }
  var pick = pickLayer(p);
  setLayer(pick);
  snap();
  altHeld = !!e.altKey;
  var pos = layerPos(pick), r = layerRect(pick);
  dragging = {
    px: p.x, py: p.y, layer: pick, moved: false,
    baseX: pos.x, baseY: pos.y,
    rect: r ? { x: r.x, y: r.y, w: r.w, h: r.h } : null
  };
  try { cv.setPointerCapture(e.pointerId); } catch (err) { /* pointer already gone */ }
  e.preventDefault();
});
function applyDrag(rawX, rawY) {
  var k = dragging.layer, adj = { x: rawX, y: rawY };
  guides.v = []; guides.h = [];
  // seeing and catching are separate keys now: with snapping on, the smart
  // guides always light up near a target; holding Alt during the drag only
  // suspends the CATCH while it is held, the guides keep showing what would
  // catch. Alt with no drag still shows the static references.
  var catchIt = !altHeld;
  if (ui.snap) {
    if (k === "text" || k === "inset") {
      var snapped = snapMove(k, dragging.rect, rawX, rawY);
      if (catchIt) adj = snapped;
    } else {
      // a photo pans inside a frame that does not move, so the line worth
      // holding is its own centre crop: pan zero, the one exact spot.
      var fr = layerRect(k) || { x: 0, y: 0, w: W, h: H };
      if (Math.abs(dragging.baseX + rawX) <= SNAP_PX) {
        guides.v.push(fr.x + fr.w / 2);
        if (catchIt) adj.x = -dragging.baseX;
      }
      if (Math.abs(dragging.baseY + rawY) <= SNAP_PX) {
        guides.h.push(fr.y + fr.h / 2);
        if (catchIt) adj.y = -dragging.baseY;
      }
    }
  }
  setLayerPos(k, dragging.baseX + adj.x, dragging.baseY + adj.y);
}
cv.addEventListener("pointermove", function (e) {
  if (!dragging) return;
  if (e.altKey !== undefined) altHeld = !!e.altKey;
  var p = canvasPoint(e);
  if (!p) return;
  var rawX = p.x - dragging.px, rawY = p.y - dragging.py;
  if (Math.abs(rawX) + Math.abs(rawY) > 0.4) dragging.moved = true;
  applyDrag(rawX, rawY);
  requestDraw();
});
function endDrag(e) {
  if (!dragging) return;
  if (!dragging.moved) hist.pop();
  if (dragging.layer === "text") parkLayout();
  guides.v = []; guides.h = [];
  dragging = null;
  syncHist(); refreshSliders(); drawNow();
  try {
    if (e && e.pointerId != null && cv.hasPointerCapture && cv.hasPointerCapture(e.pointerId)) cv.releasePointerCapture(e.pointerId);
  } catch (err) { /* nothing to release */ }
}
cv.addEventListener("pointerup", endDrag);
cv.addEventListener("pointercancel", endDrag);
function nudge(which, dx, dy) {
  var p = layerPos(which);
  setLayerPos(which, p.x + dx, p.y + dy);
}
cv.addEventListener("keydown", function (e) {
  var step = e.shiftKey ? 24 : 8, dx = 0, dy = 0;
  if (e.key === "ArrowLeft") dx = -step;
  else if (e.key === "ArrowRight") dx = step;
  else if (e.key === "ArrowUp") dy = -step;
  else if (e.key === "ArrowDown") dy = step;
  else return;
  e.preventDefault(); snap(); nudge(layer, dx, dy); drawNow();
  clampLayerIntoCanvas(layer);
  refreshSliders();
});
function setLayer(k) {
  layer = k;
  var seg = $("layerSeg").querySelectorAll("button"), i;
  for (i = 0; i < seg.length; i++) press(seg[i], seg[i].dataset.layer === k);
  var rows = $("layerRows") ? $("layerRows").querySelectorAll(".lrow") : [];
  for (i = 0; i < rows.length; i++) {
    if (rows[i].dataset.layer === k) rows[i].classList.add("on");
    else rows[i].classList.remove("on");
  }
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
  $("tnTitle").value = state.tn.title;
  $("tnT1").value = state.tn.t1; $("tnS1").value = state.tn.s1;
  $("tnT2").value = state.tn.t2; $("tnS2").value = state.tn.s2;
  $("lTitle").value = state.list.title;
  $("cTitle").value = state.cal.title;
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
  var d = tplDef(), pair = d.photos === "pair", panels = d.photos === "panels";
  $("photoSingle").hidden = pair || panels;
  $("photoPair").hidden = !pair;
  $("photoInset").hidden = !d.inset;
  CARDS.forEach(function (c) { $("card" + c).hidden = d.card !== c; });
  $("cardLine").hidden = !d.line;
  $("cardAttr").hidden = !d.attr;
  $("layInset").hidden = !d.inset;
  $("layRight").hidden = !pair;
  $("layPhoto").hidden = panels;
  $("layPhoto").textContent = pair ? (d.axis === "y" ? "Top" : "Left") : "Photo";
  $("layRight").textContent = d.axis === "y" ? "Bottom" : "Right";
  $("dropLeft").setAttribute("aria-label", "Add the " + (d.axis === "y" ? "top" : "left") + " photo");
  $("dropRight").setAttribute("aria-label", "Add the " + (d.axis === "y" ? "bottom" : "right") + " photo");
  if (layer === "inset" && !d.inset) layer = "text";
  if (layer === "right" && !pair) layer = "photo";
  if (panelKey(layer) && !panels) layer = "text";
  if (panels && layer === "photo") layer = "text";
  applyAspect();
  buildSwatches(); buildChips(); buildSliders();
  buildListRows(); buildCalRows(); buildWashCard(); buildPanelRows(); buildLayerRows();
  syncDrops(); setLayer(layer); syncHist(); syncToolbar();
}
function syncDrops() {
  var stacked = tplDef().axis === "y";
  paintDrop("dropMain", urlOf(state.photo.id), "Drop a photo, tap to pick, or paste");
  paintDrop("dropInset", urlOf(state.inset.id), "Drop the speaker's face here");
  paintDrop("dropLeft", urlOf(state.left.id), stacked ? "Top" : "Left");
  paintDrop("dropRight", urlOf(state.right.id), stacked ? "Bottom" : "Right");
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
  state.panels.rows.forEach(function (r) { keys.push(r.l.id); keys.push(r.r.id); });
  poll.options.forEach(function (o) { keys.push(o.id); });
  keys.forEach(function (k) {
    if (!k || imgs[k]) return;
    var m = assetMeta[k];
    if (m && m.data) imgs[k] = { data: m.data };
    else if (m && m.url) imgs[k] = { url: m.url };
  });
  return { v: 2, state: state, poll: poll, images: imgs, ui: ui };
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
    if (doc.ui && typeof doc.ui === "object") {
      ui.grid = !!doc.ui.grid;
      ui.snap = doc.ui.snap === undefined ? true : !!doc.ui.snap;
      ui.gridSize = clamp(parseInt(doc.ui.gridSize, 10) || 90, 20, 400);
      ui.nudgeStep = doc.ui.nudgeStep === 1 ? 1 : 8;
    }
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
   image_url, photo_url, photo_kind, template, colorway, bg, spec, timestamp}
   (seventeen fields; the image fields are same-origin proxy paths or null).
   Older field names still resolve so a lagging worker deploy degrades instead
   of blanking the rail. */
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
      image: p.image_url || p.image || p.media || p.thumbnail || p.thumb || "",
      // the round-trip payload: the RAW subject (photo or promo cutout) the
      // bot rendered from, so the editor gets live text over a clean photo -
      // never the rendered card with the words baked into its pixels
      photo: p.photo_url || "",
      photoKind: p.photo_kind === "cutout" ? "cutout" : (p.photo_kind === "photo" ? "photo" : ""),
      colorway: p.colorway || "",
      template: p.template || "",
      // bg = the texture plate a photoless render sat on; spec = whether the
      // staging bot shipped a round-trip fence (a spec post with no photo is
      // a DELIBERATE wash design, not a pre-round-trip relic)
      bg: p.bg || "",
      spec: !!p.spec,
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
/* Deep link: every staged Discord message carries
   "Open in the studio: <url>#s=<its own message id>", so the tap that starts
   in Discord lands HERE with that post already open. Consumed once per hash
   value; a hashchange (app already open, second link tapped) re-fetches the
   rail first so a just-staged post is findable. */
var pickedHash = "";
function pickFromHash() {
  if (restoring) { setTimeout(pickFromHash, 300); return; }
  var m = /[#&]s=(\\d{15,21})/.exec(location.hash || "");
  if (!m || m[1] === pickedHash) return;
  for (var i = 0; i < staged.length; i++) {
    if (staged[i].id === m[1]) {
      pickedHash = m[1];
      pickStaged(staged[i]);
      return;
    }
  }
  pickedHash = m[1];
  toast("That staged post is not in the queue any more - staged copies are tidied out after a couple of days.");
}
window.addEventListener("hashchange", function () { loadStaged(); });
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
    pickFromHash();
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
  // a staged NEWS post opens in the news family whatever was active: the
  // photo/cutout treatment maps to Quote, the wash design to Statement.
  // Without this, tapping a staged post while Versus or a panels template was
  // up dropped the words into the wrong layout - half of "the posts open but
  // you can't change the text".
  if (p.template === "news") {
    // a real story photo reads as the Quote treatment; a cutout or a plain
    // wash is the bot's Statement treatment. noSnap: this gesture already
    // snapped at entry.
    var want = (p.photoKind === "photo") ? "quote" : "state";
    if (state.template !== want) setTemplate(want, true);
  }
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
  var cwOk = false;
  for (var ci = 0; ci < CW.length; ci++) if (CW[ci].id === p.colorway) cwOk = true;
  if (cwOk) state.colorway = p.colorway;
  // the plate the bot rendered on rides the spec, so the editor reopens the
  // SAME scene the staged card shows instead of the default arena
  for (var bi = 0; bi < BGS.length; bi++) if (BGS[bi].id === p.bg) state.bg = p.bg;
  // ROUND-TRIP: only the RAW subject may land in the photo slot. The rendered
  // card has the text baked into its pixels - loading it under live text is
  // the "seems baked into the images" bug the owner reported. The slot is
  // cleared UNCONDITIONALLY before any load: keeping the last edit's photo -
  // even for the moment the new one spends in flight, or forever when its
  // fetch fails - quietly renders the new words over the old story's picture.
  var src = p.photo || "";
  state.photo.id = null;
  renderRail(staged);
  syncInputs(); syncDrops(); buildWashCard(); drawNow();
  if (!src) {
    if (p.spec) toast("Loaded. This one is a wash poster - the colored scene IS the design. Drop a photo only if you want one.");
    else if (p.image) toast("Words loaded. This post predates the round-trip, so its image has the text baked in - drop a fresh photo.");
    else toast("Loaded the words. Add a photo when you have one.");
    scheduleSave();
    return;
  }
  loadImage(src).then(function (o) {
    var data = toData(o.img);
    state.photo.id = put(o.img, data ? { data: data } : { url: src }, o.url);
    syncDrops(); buildWashCard(); drawNow(); scheduleSave();
    toast("Loaded with the raw " + (p.photoKind === "cutout" ? "cutout" : "photo") + ". Change one thing and export.");
  }).catch(function () {
    syncDrops(); buildWashCard(); drawNow(); scheduleSave();
    toast("The photo would not load, so the words sit on the wash for now.");
  });
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
  else washField(g, 0, 0, POLL_W, POLL_H, cwOf(state.colorway), state.bg);
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

/* ================= settings =================
   The provider list matches the worker's allowlist. Anything the server reports
   that is not in this list still gets a badge, so the page can never go stale. */
var PROVIDERS = [
  { id: "deepseek",   name: "DeepSeek" },
  { id: "openrouter", name: "OpenRouter" },
  { id: "zai",        name: "Z.ai (GLM)" },
  { id: "groq",       name: "Groq" },
  { id: "together",   name: "Together" },
  { id: "mistral",    name: "Mistral" },
  { id: "openai",     name: "OpenAI" }
];
var provider = PROVIDERS[0].id;
var providers = {};
function provName(id) {
  for (var i = 0; i < PROVIDERS.length; i++) if (PROVIDERS[i].id === id) return PROVIDERS[i].name;
  return String(id);
}
function buildProvSelect() {
  var sel = $("provSel");
  sel.innerHTML = "";
  PROVIDERS.forEach(function (p) {
    var o = document.createElement("option");
    o.value = p.id; o.textContent = p.name;
    sel.appendChild(o);
  });
  sel.value = provider;
  sel.addEventListener("change", function () { provider = sel.value; });
}
function paintKeyState() {
  var host = $("provBadges"), known = {}, list = PROVIDERS.slice();
  host.innerHTML = "";
  PROVIDERS.forEach(function (p) { known[p.id] = 1; });
  Object.keys(providers).forEach(function (k) {
    if (!known[k]) { known[k] = 1; list.push({ id: k, name: k }); }
  });
  var n = 0;
  list.forEach(function (p) {
    var on = !!providers[p.id];
    if (on) n++;
    var b = el("div", "pb" + (on ? " on" : ""));
    b.appendChild(el("u"));
    b.appendChild(el("span", null, p.name));
    b.appendChild(el("em", null, on ? "key saved" : "no key"));
    host.appendChild(b);
  });
  $("provHint").textContent = n
    ? n + (n === 1 ? " provider has a key stored." : " providers have keys stored.")
    : "No key stored yet. The bot scores stories with its own rules until one lands.";
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
    toast(provName(provider) + " key saved");
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
    var p = (j && typeof j.providers === "object" && j.providers) || {};
    providers = {};
    PROVIDERS.forEach(function (d) { providers[d.id] = false; });
    Object.keys(p).forEach(function (k) { providers[k] = !!p[k]; });
    paintKeyState();
  }).catch(function () {
    providers = {};
    PROVIDERS.forEach(function (d) { providers[d.id] = false; });
    paintKeyState();
  });
}

/* ================= usage =================
   The shape of /studio/api/usage is the worker's business, not this page's. Any
   object with a used/limit pair becomes a meter, every other scalar becomes a
   row, and a missing endpoint says so in plain words instead of breaking. */
var USED_KEYS = ["used", "requests", "count", "calls", "spent", "current", "today", "value"];
var LIMIT_KEYS = ["limit", "max", "quota", "included", "cap", "allowed", "free"];
/* The worker answers with names like requests_today and requests_per_day_limit,
   so a meter is found by SHAPE, not by a fixed vocabulary: anything ending in
   _limit is a ceiling, anything counting is a tally, and a pair that shares its
   first word wins over one that does not. cpu_ms_per_request_limit therefore
   never gets paired with a request count. */
var USED_RE = /^(used|requests?|calls?|count|minutes|spend|spent|today|current)(_|$)/i;
var LIMIT_RE = /(^|_)(limit|max|quota|cap|included|allowance)$/i;
var LABEL_FIX = {
  ai: "AI", kv: "KV", api: "API", cpu: "CPU", id: "ID", url: "URL", usd: "USD",
  ms: "ms", github: "GitHub", github_actions: "GitHub Actions", cloudflare: "Cloudflare", youtube: "YouTube"
};
var MONEY = /^(spend|spent|balance|credit|credits|cost|charged|amount|remaining)$/i;
function num(v) { return typeof v === "number" && isFinite(v) ? v : null; }
function fmtN(n) {
  if (n === null) return "";
  var a = Math.abs(n);
  if (a >= 1e6) return (n / 1e6).toFixed(a % 1e6 === 0 ? 0 : 1) + "M";
  if (a >= 1000) return (n / 1000).toFixed(a % 1000 === 0 ? 0 : 1) + "k";
  return String(Math.round(n * 100) / 100);
}
function findKey(o, names) {
  for (var i = 0; i < names.length; i++) {
    if (o && Object.prototype.hasOwnProperty.call(o, names[i]) && num(o[names[i]]) !== null) return names[i];
  }
  return null;
}
function head(k) { return String(k).split("_")[0].toLowerCase(); }
/* returns [usedKey, limitKey] or null: exact names first, then the shape rules */
function meterKeys(o) {
  var u = findKey(o, USED_KEYS), l = findKey(o, LIMIT_KEYS);
  if (u && l) return [u, l];
  var uc = [], lc = [];
  Object.keys(o).forEach(function (k) {
    if (LIMIT_RE.test(k)) { if (num(o[k]) !== null) lc.push(k); return; }
    if (USED_RE.test(k) && num(o[k]) !== null) uc.push(k);
  });
  if (u && uc.indexOf(u) < 0) uc.unshift(u);
  if (l && lc.indexOf(l) < 0) lc.unshift(l);
  if (!uc.length || !lc.length) return null;
  for (var i = 0; i < uc.length; i++) {
    for (var j = 0; j < lc.length; j++) if (head(uc[i]) === head(lc[j])) return [uc[i], lc[j]];
  }
  return [uc[0], lc[0]];
}
function titleOf(k) {
  var s = String(k);
  if (LABEL_FIX[s.toLowerCase()]) return LABEL_FIX[s.toLowerCase()];
  s = s.replace(/[_-]+/g, " ").replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();
  return s.split(" ").map(function (w, i) {
    if (LABEL_FIX[w]) return LABEL_FIX[w];
    return i === 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w;
  }).join(" ");
}
function collectUsage(j) {
  var meters = [], rows = [], notes = [];
  if (!j || typeof j !== "object") return { meters: meters, rows: rows, notes: notes };
  if (typeof j.note === "string") notes.push(j.note);
  if (typeof j.message === "string") notes.push(j.message);
  var mk = meterKeys(j), uk = mk ? mk[0] : null, lk = mk ? mk[1] : null;
  if (mk) {
    meters.push({
      label: typeof j.plan === "string" ? titleOf(j.plan) + " plan" : titleOf(uk),
      used: num(j[uk]), limit: num(j[lk]), unit: typeof j.unit === "string" ? j.unit : ""
    });
  }
  Object.keys(j).forEach(function (k) {
    var v = j[k];
    if (typeof v === "undefined") return;
    if (k === "note" || k === "message" || k === "unit" || k === uk || k === lk) return;
    if (Array.isArray(v)) {
      // notes: [string] is the worker's own explanation, it belongs on the card
      v.forEach(function (s) { if (typeof s === "string" && s) notes.push(s); });
      return;
    }
    if (v !== null && typeof v === "object") {
      var mk2 = meterKeys(v);
      var cur = typeof v.currency === "string" ? v.currency : "";
      if (mk2) {
        meters.push({ label: titleOf(k), used: num(v[mk2[0]]), limit: num(v[mk2[1]]), unit: typeof v.unit === "string" ? v.unit : "" });
      }
      Object.keys(v).forEach(function (k2) {
        var v2 = v[k2];
        if (typeof v2 === "object" && v2 !== null) return;
        if (Array.isArray(v2)) return;
        if (mk2 && (k2 === mk2[0] || k2 === mk2[1])) return;
        if (k2 === "currency" && cur) return;
        var money = cur && MONEY.test(k2);
        rows.push({ k: titleOf(k) + ", " + titleOf(k2), v: (money && v2 !== null ? cur + " " : "") + fmtCell(v2) });
      });
      return;
    }
    rows.push({ k: titleOf(k), v: fmtCell(v) });
  });
  return { meters: meters, rows: rows, notes: notes };
}
/* a null is not a zero: the worker says so on purpose when it will not guess */
function fmtCell(v) {
  if (v === null) return "not reported";
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (typeof v === "number") return fmtN(v);
  return String(v);
}
function verdictText(pct, n) {
  if (!n) return "No limit came back, so there is nothing to run out of here.";
  if (pct < 1) return "Nothing used this period. You are nowhere near the limit.";
  if (pct < 50) return "You are nowhere near the limit. Keep posting.";
  if (pct < 80) return "A little over half used, with room to spare.";
  if (pct < 100) return "Close to the limit now. Worth easing off until it resets.";
  return "At the limit. Calls get refused until this resets.";
}
function renderUsage(j, err) {
  var host = $("usageBody");
  host.innerHTML = "";
  if (err) { host.appendChild(el("p", "note", err)); return; }
  var u = collectUsage(j), worst = 0, counted = 0;
  if (!u.meters.length && !u.rows.length) {
    host.appendChild(el("p", "note", "The server answered, with no numbers in it yet."));
    u.notes.forEach(function (n) { host.appendChild(el("p", "note", n)); });
    return;
  }
  u.meters.forEach(function (mt) {
    var lim = num(mt.limit), used = num(mt.used) || 0;
    var pct = lim && lim > 0 ? clamp((used / lim) * 100, 0, 100) : 0;
    if (lim && lim > 0) { worst = Math.max(worst, (used / lim) * 100); counted++; }
    var w = el("div", "meter"), top = el("div", "mtop");
    top.appendChild(el("b", null, mt.label));
    top.appendChild(el("i", null, fmtN(used) + " of " + fmtN(lim) + (mt.unit ? " " + mt.unit : "")));
    w.appendChild(top);
    var bar = el("div", "bar" + (pct >= 80 ? " hi" : "")), fill = el("span");
    fill.style.width = pct.toFixed(1) + "%";
    bar.appendChild(fill);
    w.appendChild(bar);
    host.appendChild(w);
  });
  if (u.rows.length) {
    var box = el("div");
    box.style.marginTop = u.meters.length ? "4px" : "0";
    u.rows.forEach(function (r) {
      var row = el("div", "kv");
      row.appendChild(el("b", null, r.k));
      row.appendChild(el("i", null, r.v));
      box.appendChild(row);
    });
    host.appendChild(box);
  }
  var v = el("div", "verdict" + (worst >= 80 ? " hi" : ""), verdictText(worst, counted));
  v.style.marginTop = "12px";
  host.appendChild(v);
  u.notes.forEach(function (t) {
    var n = el("p", "note", t);
    n.style.marginTop = "8px";
    host.appendChild(n);
  });
}
var usageLoaded = false;
function loadUsage() {
  var host = $("usageBody");
  host.innerHTML = "";
  host.appendChild(el("p", "note", "Checking what you have used."));
  usageLoaded = true;
  api("/studio/api/usage").then(function (r) {
    if (r.status === 404 || r.status === 501) throw new Error("gone");
    if (!r.ok) throw new Error("http " + r.status);
    return r.json();
  }).then(function (j) { renderUsage(j, null); }).catch(function (e) {
    if (e && e.message === "auth") return;
    renderUsage(null, e && e.message === "gone"
      ? "This worker does not report usage yet. Nothing is broken, the card fills itself in once that endpoint is live."
      : "Could not read the usage numbers just now. Everything else still works.");
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
  if (id === "tab-set" && !usageLoaded) loadUsage();
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
bootToolbar();
buildProvSelect();
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
bindText("tnTitle", function (v) { state.tn.title = v; });
bindText("tnT1", function (v) { state.tn.t1 = v; });
bindText("tnS1", function (v) { state.tn.s1 = v; });
bindText("tnT2", function (v) { state.tn.t2 = v; });
bindText("tnS2", function (v) { state.tn.s2 = v; });
bindText("lTitle", function (v) { state.list.title = v; });
bindText("cTitle", function (v) { state.cal.title = v; });
$("listAdd").addEventListener("click", function () {
  if (state.list.rows.length >= 6) { toast("Six rows is the ceiling"); return; }
  snap();
  state.list.rows.push("");
  buildListRows(); drawNow();
});
$("calAdd").addEventListener("click", function () {
  if (state.cal.rows.length >= 5) { toast("Five bands is the ceiling"); return; }
  snap();
  state.cal.rows.push({ d: "", m: "" });
  buildCalRows(); drawNow();
});
$("usageReload").addEventListener("click", loadUsage);
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
$("tintSeg").addEventListener("click", function (e) {
  var b = e.target.closest ? e.target.closest("button[data-tint]") : null;
  if (!b) return;
  snap(); state.tint = clamp(parseInt(b.dataset.tint, 10) || 0, 0, 100);
  buildWashCard(); refreshSliders(); drawNow(); drawAllPolls();
});
$("panelSeg").addEventListener("click", function (e) {
  var b = e.target.closest ? e.target.closest("button[data-n]") : null;
  if (!b) return;
  snap(); state.panels.n = clamp(parseInt(b.dataset.n, 10) || 2, 1, 3);
  if (panelKey(layer) && panelKey(layer).i >= state.panels.n) layer = "text";
  syncInputs(); drawNow();
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
loadUsage();

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
    colorway: state.colorway, bg: state.bg, tint: state.tint,
    panels: { n: panelCount(), rows: state.panels.rows.map(function (r) {
      return { big: r.big, small: r.small, chip: r.chip, cw: r.cw,
               l: !!r.l.id, r: !!r.r.id };
    }) },
    bgLoaded: Object.keys(bgImgs),
    layer: layer, words: out, hotCount: hotCount(), hotKeys: Object.keys(state.hot),
    textDX: Math.round(state.textDX), textDY: Math.round(state.textDY), textScale: state.textScale,
    fitMode: state.fitMode, clean: state.clean,
    photo: { id: state.photo.id, zoom: state.photo.zoom, panX: Math.round(state.photo.panX), panY: Math.round(state.photo.panY) },
    inset: { id: state.inset.id, dx: state.inset.dx, dy: state.inset.dy, scale: state.inset.scale, shape: state.inset.shape },
    left: { id: state.left.id }, right: { id: state.right.id },
    hist: hist.length, redo: redoStack.length,
    pollHist: pollHist.length, pollRedo: pollRedoStack.length,
    layout: layout, sel: selRect(),
    grid: { on: ui.grid, size: ui.gridSize, lines: gridCount },
    snapOn: ui.snap, alt: altHeld, nudgeStep: ui.nudgeStep,
    drawErrors: drawErrors, lastDrawError: lastDrawError,
    guides: { v: guides.v.slice(), h: guides.h.slice(), shown: shownGuides() },
    dragging: !!dragging,
    layers: layerList().map(function (l) { return l.k; }),
    rect: layerRect(layer),
    pos: layerPos(layer),
    providers: providers, templates: TEMPLATES.map(function (t) { return t.id; }),
    draws: drawCount, fits: fitCount, wraps: wrapCount,
    poll: { q: poll.q, n: poll.options.length, metrics: pollMetrics },
    store: storeKind, saved: lastSaveTs, drafts: draftList.length, fonts: fontsReady
  };
};
})();
</script>
</body>
</html>`;
