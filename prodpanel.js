/* prodpanel.js — the Production control panel in the hub's Production tab.
   One place for everything that drives the production docs: which script, how many shoot days,
   start date, shooting week, page limit per day, call times, and which scenes shoot on which day.
   The script is the source of truth: the panel re-reads it (breakdown.js) and keeps the plan in step
   (production.js), then saves the plan to projects/<pid>/production for the whole team, live.
   Needs: breakdown.js, production.js and window.__CampHub (set up by index.html). */
(function(){
"use strict";
const P = window.CampProduction, B = window.CampBreakdown;
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;" }[c]));
const OPEN_KEY = "Camp_PROD_PANEL_OPEN_V1", DOOD_KEY = "Camp_PROD_DOOD_OPEN_V1", SHOTS_KEY = "Camp_PROD_SHOTS_OPEN_V1";
const lsGet = (k) => { try{ return localStorage.getItem(k); }catch(_e){ return null; } };
const lsSet = (k, v) => { try{ localStorage.setItem(k, v); }catch(_e){} };

const S = {
  popout: new URLSearchParams(location.search).get("popout") === "1",
  mode: new URLSearchParams(location.search).get("popout") === "1" ? "plan" : "off",   // "plan" | "cs" | "off" (a sheet is showing)
  warnOpen: false,       // the "to check" list
  menu: false,           // the ⋯ menu
  csErr: {},
  busy: {},             // pid -> what's being built right now ("cs" | "sync")             // pid -> last call-sheet error
  doodOpen: lsGet(DOOD_KEY) === "1",
  scripts: {},           // scriptId -> { state:"loading"|"ok"|"error", bd, err, modified }
  shots: {},             // scriptId -> { state:"loading"|"ok"|"error", map:{ sceneId:[shot] } } from the storyboard
  notice: {},            // pid -> { added:[], removed:[], moved:[] } shown until dismissed
  dayTab: {},            // pid -> day shown on a phone (-1 = Unscheduled)
  setOpen: false,        // phone: the settings block
  pick: null,            // scene id chosen for "move to…" (click / touch)
  landed: null,          // { id, day } just moved: flashes once
  drag: null,            // scene id being dragged
  pid: null
};

/* ---------- styles ---------- */
const css = `
#ctl{ background:#171717; display:flex; flex-direction:column; min-height:0; flex:1; }
#ctl.off, #ctl:empty{ display:none; }
.ctlBody{ flex:1; overflow:auto; padding:0 12px 16px; min-height:0; overscroll-behavior:contain; }
.ctlTitle{ font-weight:700; font-size:14px; padding:0 4px; white-space:nowrap; }
.ctlChip.btnChip{ cursor:pointer; background:none; font:inherit; font-size:11.5px; }
.ctlChip.btnChip:hover{ border-color:rgba(241,199,107,.8); }
.ctlMore{ position:relative; }
.ctlUR{ display:inline-flex; gap:2px; }
.ctlUR .btn{ min-width:32px; padding:0 8px; font-size:15px; }
.ctlUR .btn:disabled{ opacity:.35; }
.ctlMenu{ position:absolute; right:0; top:calc(100% + 6px); z-index:20; min-width:230px; padding:4px; border-radius:10px; background:#1d1e22; border:1px solid rgba(255,255,255,.17); box-shadow:0 14px 40px rgba(0,0,0,.5); display:flex; flex-direction:column; }
.ctlMenu button{ text-align:left; border:0; background:none; padding:8px 10px; border-radius:7px; cursor:pointer; font-size:13px; }
.ctlMenu button small{ display:block; color:var(--uiMuted); font-size:11.5px; margin-top:2px; }
.ctlMenu button:hover{ background:rgba(255,255,255,.08); }
.ctlMenu button:disabled{ opacity:.45; cursor:default; }
.ctlDocs{ display:flex; gap:10px; align-items:center; flex-wrap:wrap; margin-top:10px; padding:10px 12px; border-radius:10px; border:1px dashed rgba(255,255,255,.2); font-size:12.5px; color:var(--uiMuted); }
.csWrap{ max-width:760px; padding:14px 2px; display:flex; flex-direction:column; gap:12px; }
.csWrap h3{ margin:0; font-size:15px; }
.csWrap p{ margin:0; color:var(--uiMuted); font-size:12.5px; line-height:1.5; }
.csList{ display:grid; grid-template-columns:repeat(auto-fill, minmax(190px, 1fr)); gap:8px; }
.csDay{ display:flex; flex-direction:column; gap:3px; padding:10px 12px; border-radius:10px; border:1px solid var(--uiBorder); background:rgba(255,255,255,.03); text-decoration:none; }
.csDay:hover{ border-color:rgba(255,255,255,.35); background:rgba(255,255,255,.06); }
.csDay b{ font-size:13.5px; } .csDay span{ font-size:12px; color:var(--uiMuted); }
.csDay.stale{ border-style:dashed; opacity:.7; }
.csErr{ padding:10px 12px; border-radius:10px; background:rgba(255,139,131,.08); border:1px solid rgba(255,139,131,.35); font-size:12.5px; line-height:1.55; }
.csErr ol{ margin:6px 0 0; padding-left:20px; }
.csErr code{ background:rgba(255,255,255,.08); padding:1px 5px; border-radius:4px; }
.ctlHead{ display:flex; align-items:center; gap:10px; padding:8px 12px; min-height:48px; flex-wrap:wrap; border-bottom:1px solid var(--uiBorder); }
.ctlTitle{ display:flex; align-items:center; gap:8px; background:none; border:0; padding:4px 6px; border-radius:8px; cursor:pointer; font-weight:700; font-size:13.5px; }
.ctlTitle:hover{ background:rgba(255,255,255,.06); }
.ctlTitle svg{ width:15px; height:15px; transition:transform .15s; }
#ctl:not(.open) .ctlTitle svg.car{ transform:rotate(-90deg); }
.ctlChips{ display:flex; gap:6px; flex-wrap:wrap; flex:1; min-width:0; }
.ctlChip{ font-size:11.5px; color:var(--uiMuted); border:1px solid var(--uiBorder); border-radius:999px; padding:2px 9px; white-space:nowrap; }
.ctlChip.warn{ color:#f1c76b; border-color:rgba(241,199,107,.4); }
.ctlChip.ok{ color:#8fe3a6; border-color:rgba(143,227,166,.35); }
.ctlSet{ display:flex; flex-wrap:wrap; gap:10px 14px; align-items:flex-end; padding:6px 0 12px; border-bottom:1px solid var(--uiBorder); }
.ctlSet label{ display:flex; flex-direction:column; gap:4px; font-size:11px; color:var(--uiMuted); text-transform:uppercase; letter-spacing:.05em; }
.ctlSet input, .ctlSet select{ height:32px; border-radius:9px; border:1px solid var(--uiBorder); background:#111; padding:0 9px; font-size:13px; text-transform:none; letter-spacing:0; }
.ctlSet input[type=date]{ min-width:140px; }
.ctlStep{ display:inline-flex; border:1px solid var(--uiBorder); border-radius:9px; overflow:hidden; height:32px; }
.ctlStep button{ width:30px; border:0; background:rgba(255,255,255,.05); cursor:pointer; font-size:15px; }
.ctlStep button:hover{ background:rgba(255,255,255,.12); }
.ctlStep input{ width:46px; border:0 !important; border-radius:0 !important; text-align:center; background:#111; }
.ctlActs{ margin-left:auto; display:flex; gap:8px; flex-wrap:wrap; }
.ctlCs{ display:flex; flex-wrap:wrap; align-items:center; gap:6px; margin-top:10px; font-size:12.5px; }
.ctlCs b{ margin-right:4px; }
.ctlCs a{ text-decoration:none; border:1px solid var(--uiBorder); border-radius:8px; padding:3px 9px; background:rgba(255,255,255,.04); }
.ctlCs a:hover{ border-color:rgba(255,255,255,.3); }
.ctlCs a.fold{ color:var(--uiMuted); }
.ctlCs span{ color:var(--uiMuted); font-size:11.5px; margin-left:4px; }
.ctlNote{ margin:10px 0 0; padding:9px 12px; border-radius:10px; background:rgba(91,140,255,.1); border:1px solid rgba(91,140,255,.3); font-size:12.5px; display:flex; gap:10px; align-items:flex-start; }
.ctlNote ul{ margin:4px 0 0; padding-left:18px; }
.ctlNote .x{ margin-left:auto; }
.ctlWarn{ margin:10px 0 0; display:flex; flex-direction:column; gap:4px; font-size:12.5px; }
.ctlWarn div{ color:#f1c76b; } .ctlWarn div.info{ color:var(--uiMuted); }
.board{ display:flex; gap:10px; overflow-x:auto; padding:12px 0 6px; align-items:flex-start; }
.col{ flex:0 0 228px; background:#1d1d1d; border:1px solid var(--uiBorder); border-radius:12px; display:flex; flex-direction:column; max-height:none; }
.col[data-day="-1"]{ max-height:72vh; }
.col.none{ flex-basis:150px; }
.col.over{ border-color:rgba(255,139,131,.55); }
.col.drop{ border-color:var(--focus); box-shadow:0 0 0 2px rgba(91,140,255,.35); }
.colHead{ padding:9px 10px 7px; border-bottom:1px solid var(--uiBorder); }
.colHead b{ font-size:13px; } .colHead .dt{ font-size:11.5px; color:var(--uiMuted); margin-left:6px; }
.colMeta{ display:flex; justify-content:space-between; gap:6px; font-size:11.5px; color:var(--uiMuted); margin-top:4px; }
.cap{ height:4px; border-radius:3px; background:rgba(255,255,255,.08); margin-top:6px; overflow:hidden; }
.cap i{ display:block; height:100%; background:#8fe3a6; }
.col.over .cap i{ background:#ff8b83; }
.colNeeds{ display:flex; flex-wrap:wrap; gap:3px; margin-top:6px; }
.colNeeds i{ font-style:normal; font-size:10px; line-height:1; padding:3px 5px; border-radius:8px; color:#fff; background:var(--c,#666); opacity:.9; white-space:nowrap; }
.colCall{ display:flex; align-items:center; gap:6px; margin-top:6px; font-size:11.5px; color:var(--uiMuted); }
.ctlTime{ display:flex; gap:6px; align-items:center; }
.ctlTime select{ flex:1; }
.h24{ height:32px; text-transform:none; letter-spacing:0; }
.h24.on{ background:#ececf0; color:#111; border-color:#ececf0; }
.colCall select{ height:24px; border-radius:6px; border:1px solid var(--uiBorder); background:#111; padding:0 4px; font-size:12px; color:inherit; }
.colCall input{ height:24px; border-radius:6px; border:1px solid var(--uiBorder); background:#111; padding:0 5px; font-size:12px; }
.strips{ padding:7px; display:flex; flex-direction:column; gap:6px; overflow-y:auto; min-height:46px; }
.strip{ text-align:left; width:100%; border:1px solid rgba(255,255,255,.08); border-left:5px solid var(--sc, #ddd); border-radius:8px; padding:6px 8px; background:color-mix(in srgb, var(--sc, #ddd) 9%, #202020); cursor:grab; font-size:12px; line-height:1.35; }
.strip:hover{ border-color:rgba(255,255,255,.22); border-left-color:var(--sc, #ddd); }
.strip.pick{ outline:2px solid var(--focus); }
.strip.new{ box-shadow:0 0 0 1px #8fe3a6 inset; }
.strip.rev{ box-shadow:0 0 0 1px #f1c76b inset; }
.strip .revTag{ color:#f1c76b; font-size:10.5px; font-weight:700; }
.ctlNote.rev{ background:rgba(241,199,107,.08); border-color:rgba(241,199,107,.35); }
.ctlNote.rev li{ margin:3px 0; }
.ctlNote.rev .btn{ margin-left:6px; padding:1px 8px; }
.strip.dragging{ opacity:.35; transform:scale(.97); }
@keyframes stripLand{ 0%{ transform:scale(1.06); box-shadow:0 0 0 2px #fff, 0 0 22px rgba(255,255,255,.5); } 100%{ transform:scale(1); box-shadow:0 0 0 0 transparent; } }
.strip.landed{ animation:stripLand .7s cubic-bezier(.2,.9,.3,1); position:relative; z-index:1; }
@keyframes colBump{ 0%{ background:rgba(91,140,255,.28); } 100%{ background:transparent; } }
.col.bump .colHead{ animation:colBump .9s ease-out; }
.dropLine{ height:4px; border-radius:3px; background:#fff; box-shadow:0 0 0 2px rgba(91,140,255,.6), 0 0 14px rgba(255,255,255,.6); margin:-1px 2px; flex:0 0 auto; }
.strip .t{ display:flex; justify-content:space-between; gap:6px; font-weight:700; }
.strip .t span{ color:var(--uiMuted); font-weight:600; white-space:nowrap; }
.strip .l{ color:#ddd; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.strip .c{ color:var(--uiMuted); font-size:11px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.strip .tm{ display:flex; justify-content:space-between; gap:6px; margin-top:4px; font-size:10.5px; color:#ddd; font-variant-numeric:tabular-nums; }
.strip .tm span{ color:var(--uiMuted); }
.brk{ font-size:10.5px; color:var(--uiMuted); padding:3px 8px; margin:2px 0; border-radius:6px; border:1px dashed rgba(255,255,255,.18); text-align:center; }
.brk.meal{ background:rgba(127,182,255,.07); }
.brk.late{ color:#f1c76b; border-color:rgba(241,199,107,.45); }
.brk.move{ background:rgba(241,199,107,.06); }
.colCall{ flex-wrap:wrap; }
.colCall .wrapT{ white-space:nowrap; margin-left:auto; color:var(--uiText); font-weight:600; font-variant-numeric:tabular-nums; }
.strip .nd{ display:flex; flex-wrap:wrap; gap:3px; margin-top:4px; }
.strip .nd i{ display:block; width:7px; height:7px; border-radius:50%; background:var(--c,#666); }
.dtPick{ position:relative; display:inline-flex; align-items:center; gap:5px; margin-left:6px; font-size:11.5px; color:var(--uiText); cursor:pointer; border-radius:7px; padding:2px 7px; border:1px solid var(--uiBorder); background:rgba(255,255,255,.04); }
.dtPick:hover{ border-color:rgba(255,255,255,.4); }
.offRow{ display:flex; gap:6px; align-items:center; flex-wrap:wrap; margin-top:10px; font-size:12px; color:var(--uiMuted); }
.offRow b{ color:var(--uiText); margin-right:4px; }
.offChip{ border:1px solid rgba(255,139,131,.4); background:rgba(255,139,131,.08); color:#ffb4ae; border-radius:7px; padding:2px 8px; font-size:11.5px; cursor:pointer; }
.dtPick.pinned{ color:#a9c1ff; }
.dtPick input{ position:absolute; inset:0; opacity:0; cursor:pointer; width:100%; }
.colHead .unpin{ border:0; background:none; color:var(--uiMuted); cursor:pointer; font-size:11px; padding:0 3px; }
.colHead .unpin:hover{ color:#fff; }
.colEmpty{ color:var(--uiMuted); font-size:12px; padding:8px 4px; text-align:center; }
.moveBar{ position:sticky; left:0; display:flex; gap:8px; align-items:center; flex-wrap:wrap; margin-top:10px; padding:8px 10px; border-radius:10px; background:#202634; border:1px solid rgba(91,140,255,.35); font-size:12.5px; }
.moveBar select{ height:30px; border-radius:8px; border:1px solid var(--uiBorder); background:#111; padding:0 8px; }
.dood{ margin-top:12px; border:1px solid var(--uiBorder); border-radius:12px; overflow:hidden; }
.fx .fxNote{ padding:0 12px 10px; font-size:12px; color:var(--uiMuted); line-height:1.5; display:flex; gap:10px; align-items:center; flex-wrap:wrap; }
.fxRow{ display:flex; align-items:center; gap:12px; padding:8px 12px; border-top:1px solid var(--uiBorder); flex-wrap:wrap; }
.fxRow.ign .fxName b{ text-decoration:line-through; opacity:.6; }
.fxRow.wat .fxName b::after{ content:" · watching"; color:#f1c76b; font-weight:600; font-size:11.5px; }
.fxName{ flex:1 1 240px; min-width:0; display:flex; flex-direction:column; gap:2px; font-size:12.5px; }
.fxName span{ color:var(--uiMuted); font-size:11.5px; }
.fxScenes{ display:flex; gap:4px; flex-wrap:wrap; flex:1 1 200px; }
.fxSc{ border:1px solid var(--uiBorder); background:rgba(255,255,255,.05); border-radius:7px; padding:2px 7px; font-size:11.5px; cursor:pointer; }
.fxSc:hover:not(:disabled){ border-color:rgba(255,255,255,.4); }
.fxSc.off{ text-decoration:line-through; opacity:.5; }
.fxSeg{ display:inline-flex; gap:2px; padding:2px; border-radius:9px; background:rgba(255,255,255,.06); border:1px solid rgba(255,255,255,.1); }
.fxSeg button{ border:0; background:none; border-radius:7px; padding:4px 10px; font-size:12px; font-weight:600; color:rgba(255,255,255,.6); cursor:pointer; }
.fxSeg button.on{ background:rgba(255,255,255,.14); color:#fff; }
.fxRow.ign .fxSeg button.on{ background:rgba(255,139,131,.25); color:#ffb4ae; }
.fxRow.wat .fxSeg button.on{ background:rgba(241,199,107,.22); color:#f1c76b; }
.lcAreas{ display:flex; flex-wrap:wrap; gap:5px; margin-top:4px; }
.lcChip{ display:inline-flex; align-items:center; gap:4px; border:1px solid var(--uiBorder); border-radius:999px; padding:1px 4px 1px 9px; font-size:11.5px; color:var(--uiText); background:rgba(255,255,255,.04); }
.lcChip.main{ padding-right:9px; border-style:dashed; color:var(--uiMuted); }
.lcChip button{ border:0; background:none; color:var(--uiMuted); cursor:pointer; font-size:11px; width:18px; height:18px; border-radius:50%; padding:0; }
.lcChip button:hover{ color:var(--uiText); background:rgba(255,255,255,.1); }
.lcActs{ display:flex; gap:6px; flex-wrap:wrap; }
.lcForm{ margin:0 12px 10px; padding:10px 12px; border:1px solid var(--uiBorder); border-radius:10px; background:rgba(255,255,255,.03); display:grid; gap:8px; font-size:12.5px; }
.lcName{ display:flex; gap:8px; align-items:center; color:var(--uiMuted); }
.lcName input{ height:30px; border-radius:8px; border:1px solid var(--uiBorder); background:rgba(255,255,255,.04); color:var(--uiText); padding:0 8px; text-transform:uppercase; flex:1; max-width:260px; }
.lcPick{ display:grid; grid-template-columns:repeat(auto-fill,minmax(200px,1fr)); gap:4px 12px; max-height:240px; overflow:auto; }
.lcPick label{ display:flex; gap:6px; align-items:center; cursor:pointer; }
.lcPick i{ font-style:normal; color:var(--uiMuted); font-size:11px; }
.lcBtns{ display:flex; gap:6px; }
.fxIn{ display:flex; gap:8px; align-items:center; font-size:12px; color:var(--uiMuted); }
.fxIn select{ height:30px; border-radius:8px; border:1px solid var(--uiBorder); background:#111; padding:0 8px; }
.dood summary{ cursor:pointer; padding:9px 12px; font-weight:700; font-size:13px; }
.doodWrap{ overflow-x:auto; }
.dood table{ border-collapse:collapse; font-size:12px; min-width:100%; }
.dood th, .dood td{ border-top:1px solid var(--uiBorder); padding:5px 8px; text-align:center; white-space:nowrap; }
.shotDay{ text-align:left !important; background:#202020; font-weight:700; }
.shotDay span{ font-weight:400; color:var(--uiMuted); margin-left:8px; }
.dood td.desc{ text-align:left; white-space:normal; min-width:220px; }
.dood td.st.shot{ color:#5ccf8a; } .dood td.st.reshoot{ color:#f1c76b; }
.shotNone{ padding:9px 12px; color:var(--uiMuted); font-size:12px; }
.dood .kid{ font-size:10.5px; color:#f1c76b; margin-left:6px; white-space:nowrap; }
.dood th:first-child, .dood td:first-child{ text-align:left; position:sticky; left:0; background:#1b1b1b; }
.dood td.W, .dood td.SW, .dood td.WF, .dood td.SWF{ background:rgba(143,227,166,.16); color:#bff0cc; font-weight:700; }
.dood td.H{ background:rgba(241,199,107,.12); color:#f1c76b; }
.ctlLoad{ flex:1; min-height:min(62vh,560px); display:flex; flex-direction:column; align-items:center; justify-content:center; gap:10px; text-align:center; color:var(--uiMuted); font-size:13px; padding:40px 16px; }
.ctlLoad .spin{ width:30px; height:30px; margin-bottom:4px; }
.ctlLoad b{ color:var(--uiText); font-weight:600; font-size:14px; }
.ctlEmpty{ padding:18px 6px; color:var(--uiMuted); display:flex; gap:10px; align-items:center; flex-wrap:wrap; }
.ctlRO{ font-size:11.5px; color:var(--uiMuted); }
/* settings: always open on a computer; a tap-to-open row on a phone */
.setWrap > summary{ display:none; }
.dayTabs{ display:none; }
@media (max-width:760px){
  .ctlHead{ padding:8px 10px; gap:6px; }
  .ctlChip.hideSm{ display:none; }
  .ctlActs{ margin-left:0; width:100%; display:flex; gap:6px; } .ctlActs .btn.primary{ flex:1; }
  .ctlBody{ padding:0 10px 90px; }
  .setWrap{ border-bottom:1px solid var(--uiBorder); }
  .setWrap > summary{ display:flex; align-items:center; gap:10px; list-style:none; padding:10px 2px; font-size:13px; font-weight:600; cursor:pointer; min-height:44px; }
  .setWrap > summary::-webkit-details-marker{ display:none; }
  .setWrap > summary::before{ content:"▸"; font-size:11px; opacity:.6; } .setWrap[open] > summary::before{ content:"▾"; }
  .setWrap > summary span{ margin-left:auto; font-weight:400; font-size:12px; color:var(--uiMuted); }
  .ctlSet{ display:grid; grid-template-columns:1fr 1fr; gap:10px; padding:2px 0 12px; border-bottom:0; }
  .ctlSet label:first-child:nth-last-child(5), .ctlSet label:has(input[type=date]){ grid-column:auto; }
  .ctlSet input[type=date]{ min-width:0; width:100%; }
  .ctlSet input, .ctlSet select{ height:40px; width:100%; font-size:16px; }
  .dayTabs{ display:flex; gap:6px; overflow-x:auto; padding:10px 0 6px; margin:0 -10px; padding-left:10px; padding-right:10px; scrollbar-width:none; position:sticky; top:0; z-index:4; background:#171717; }
  .dayTabs::-webkit-scrollbar{ display:none; }
  .dayTabs button{ flex:0 0 auto; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:1px; min-width:64px; height:46px; padding:0 12px; border-radius:11px; border:1px solid var(--uiBorder); background:rgba(255,255,255,.04); color:var(--uiText); font:600 13px Inter,system-ui,sans-serif; cursor:pointer; }
  .dayTabs button small{ font:400 10.5px Inter,sans-serif; color:var(--uiMuted); }
  .dayTabs button i{ font-style:normal; font-size:11px; margin-left:4px; color:var(--uiMuted); }
  .dayTabs button.on{ background:#ececf0; color:#111; border-color:#ececf0; } .dayTabs button.on small, .dayTabs button.on i{ color:#444; }
  .dayTabs button.warn:not(.on){ border-color:rgba(241,199,107,.6); } .dayTabs button.over:not(.on){ border-color:rgba(255,139,131,.7); }
  .board{ display:block; overflow:visible; padding:6px 0; }
  .board .col{ display:none; flex-basis:auto; max-height:none; width:100%; }
  .board .col.sel{ display:flex; }
  .col.none{ flex-basis:auto; }
  .col .strips{ max-height:none; overflow:visible; }
  .strip{ min-height:58px; padding:10px 12px; }
  .strip.pick{ outline:3px solid var(--focus); outline-offset:1px; background:rgba(91,140,255,.16); }
  .moveBar{ position:fixed; left:8px; right:8px; bottom:max(8px, env(safe-area-inset-bottom)); z-index:30; margin:0; padding:10px; box-shadow:0 10px 30px rgba(0,0,0,.55); background:#202634; }
  .moveBar select{ flex:1 1 140px; height:40px; font-size:16px; } .moveBar .btn{ height:40px; }
  .colHead .dtPick{ padding:6px 10px; font-size:13px; }
  .fxRow{ flex-direction:column; align-items:stretch; }
  .btn.sm{ min-height:36px; }
  .doodWrap{ -webkit-overflow-scrolling:touch; }
}`;
const style = document.createElement("style"); style.textContent = css; document.head.appendChild(style);

/* ---------- helpers ---------- */
// Stripboard colours: INT day white, EXT day yellow, INT night blue, EXT night green, dawn/dusk orange
function stripColor(s){
  const ext = /EXT/.test(s.ie || "") && !/INT/.test(s.ie || ""), both = /INT/.test(s.ie || "") && /EXT/.test(s.ie || "");
  if(s.dn === "M") return "#f2994a";
  if(s.dn === "N") return ext ? "#5ccf8a" : both ? "#7fb6ff" : "#5b8cff";
  return ext ? "#f2c94c" : both ? "#f5dc8a" : "#e8e8e8";
}
const DN = { D: "Day", N: "Night", M: "Dawn/Dusk" };
// One line saying how a revised scene changed: "length 2 → 3 pg; cast +CAL −BEN; location HOUSE → BARN; Day → Night"
function revText(c){
  const out = [], f = c.from, t = c.to;
  if(f.e !== t.e) out.push("length " + P.fmtEighths(f.e) + " → " + P.fmtEighths(t.e) + " pg");
  if(f.c !== t.c){
    const a = f.c ? f.c.split("|") : [], b = t.c ? t.c.split("|") : [];
    const plus = b.filter((n) => a.indexOf(n) < 0).map((n) => "+" + n), minus = a.filter((n) => b.indexOf(n) < 0).map((n) => "−" + n);
    out.push("cast " + plus.concat(minus).join(" "));
  }
  if(f.l !== t.l) out.push("location " + (f.l || "?") + " → " + (t.l || "?"));
  if(f.dn !== t.dn) out.push((DN[f.dn] || f.dn || "?") + " → " + (DN[t.dn] || t.dn || "?"));
  return out.join("; ");
}
function fmtDate(iso){
  const d = P.parseISO(iso); if(!d) return "";
  return d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
}
const H = () => window.__CampHub;
// Call times: a dropdown in 15-minute steps, shown in 12- or 24-hour time (a per-device choice)
const H24_KEY = "Camp_PROD_24H_V1";
const is24 = () => lsGet(H24_KEY) === "1";
const fmtMins = (m) => { m = Math.round(Number(m) || 0); return m >= 60 ? Math.floor(m / 60) + "h" + (m % 60 ? " " + String(m % 60).padStart(2, "0") : "") : m + "m"; };
function fmtTime(hm){
  const m = /^(\d{2}):(\d{2})$/.exec(hm || ""); if(!m) return hm || "";
  if(is24()) return hm;
  const h = +m[1]; return (h % 12 || 12) + ":" + m[2] + (h < 12 ? " am" : " pm");
}
function timeSelect(val, attr, dis){
  const opts = []; for(let i = 0; i < 96; i++){ const h = Math.floor(i / 4), mm = (i % 4) * 15; opts.push(String(h).padStart(2, "0") + ":" + String(mm).padStart(2, "0")); }
  if(val && opts.indexOf(val) < 0){ opts.push(val); opts.sort(); }
  return `<select class="tSel" ${attr}${dis}>${opts.map((t) => `<option value="${t}"${t === val ? " selected" : ""}>${fmtTime(t)}</option>`).join("")}</select>`;
}

/* ---------- script loading (the source of truth) ---------- */
async function loadScript(id, force){
  const hub = H(), cur = S.scripts[id], mod = hub.scriptModified(id);
  if(cur && !force && (cur.state === "loading" || (cur.state === "ok" && cur.modified === mod))) return;
  S.scripts[id] = { state: "loading", bd: cur && cur.bd, doc: cur && cur.doc, akey: cur && cur.akey, modified: mod };
  rerender();
  try{
    const res = await hub.ripGet({ action: "load", fileId: id });
    if(!res || res.ok === false || !res.doc) throw new Error((res && res.error) || "Couldn't read the script.");
    S.scripts[id] = { state: "ok", doc: res.doc, bd: B.analyze(res.doc), akey: null, modified: mod, at: Date.now() };
  }catch(err){
    S.scripts[id] = { state: "error", err: (err && err.message) || String(err), bd: cur && cur.bd, modified: mod };
  }
  rerender();
}

// The storyboard's shot list for the same script (optional: the plan works without it)
async function loadShots(id, force){
  const cur = S.shots[id];
  if(cur && !force && cur.state !== "error") return;
  S.shots[id] = { state: "loading", map: cur && cur.map };
  try{
    const res = await H().ripGet({ action: "shotlistdata", fileId: id });
    if(!res || res.ok === false || !Array.isArray(res.shots)) throw new Error((res && res.error) || "Couldn't read the shot list.");
    S.shots[id] = { state: "ok", map: P.shotsBySceneId(res) };
  }catch(err){
    S.shots[id] = { state: "error", map: cur && cur.map, err: (err && err.message) || String(err) };
  }
  rerender();
}

/* ---------- saving (whole plan; the team sees it live) ---------- */
let saveT = 0, pending = null;
// Undo / redo for the plan (this device's own changes). Quick runs of edits (typing a time) count as one.
const HIST = {};   // pid -> { undo:[json], redo:[json], at }
function remember(pid){ P.histRemember(HIST[pid] = HIST[pid] || P.histNew(), planOf(pid), Date.now()); }
function stepHist(pid, back){
  const h = HIST[pid]; if(!h) return;
  const next = P.histStep(h, planOf(pid), back);   // links to made docs aren't part of undo
  if(!next){ H().toast(back ? "Nothing to undo." : "Nothing to redo.", "ok", 1400); return; }
  save(pid, next, true); rerender();
  H().toast(back ? "Undone." : "Redone.", "ok", 1200);
}
function save(pid, plan, noHist){
  if(pending && pending.pid !== pid) flush();   // another project's edit is still waiting: save it first, don't drop it
  if(!noHist) remember(pid);
  pending = { pid, plan };
  clearTimeout(saveT);
  saveT = setTimeout(flush, 250);
}
async function flush(){
  if(!pending) return;
  const { pid, plan } = pending; pending = null;
  try{ await H().writeProduction(pid, plan); }
  catch(err){ H().toast("Couldn't save the production plan: " + ((err && err.message) || err)); }
}
// The plan as everyone sees it right now (including an edit still waiting to save)
function planOf(pid){
  if(pending && pending.pid === pid) return P.normalize(pending.plan);
  const p = H().project(pid);
  return P.normalize(p && p.production);
}

/* ---------- rendering ---------- */
let rafId = 0;
function rerender(){ cancelAnimationFrame(rafId); rafId = requestAnimationFrame(() => { if(S.pid) render(S.pid); }); }

// Re-drawing replaces the panel's HTML: keep where you were scrolled (page and board), so a click doesn't jump
function render(pid){
  const box = document.getElementById("ctl"), body = box && box.querySelector(".ctlBody"), board = box && box.querySelector(".board");
  const top = body ? body.scrollTop : 0, left = board ? board.scrollLeft : 0;
  draw(pid);
  const b2 = box && box.querySelector(".ctlBody"), bd2 = box && box.querySelector(".board");
  if(b2 && top) b2.scrollTop = top;
  if(bd2 && left) bd2.scrollLeft = left;
}
// What a day needs, from the breakdown's element sheets: every category with something in it (cast has its own count),
// in breakdown order. Found and hand-tagged elements both count. Hover a chip for the names.
function needCats(){ const E = window.CampElements; return E ? E.CATS.map((c) => c.id).filter((c) => c !== "cast") : []; }
function needsRow(needs){
  const E = window.CampElements; if(!E || !needs) return "";
  const chips = needCats().filter((c) => (needs[c] || []).length).map((c) => `<i style="--c:${E.CAT[c].color}" title="${esc(E.CAT[c].label + ": " + needs[c].join(", "))}">${esc(E.CAT[c].short)} ${needs[c].length}</i>`);
  return chips.length ? `<div class="colNeeds">${chips.join("")}</div>` : "";
}
// One dot per category a scene needs, on its strip
function needDots(needs){
  const E = window.CampElements; if(!E || !needs) return "";
  const cs = needCats().filter((c) => (needs[c] || []).length);
  return cs.length ? `<div class="nd">${cs.map((c) => `<i style="--c:${E.CAT[c].color}" title="${esc(E.CAT[c].label + ": " + needs[c].join(", "))}"></i>`).join("")}</div>` : "";
}
function draw(pid){
  S.pid = pid;
  try{ const h = H(); if(h && h.syncState) h.syncState(); }catch(_e){}
  const hub = H(), box = document.getElementById("ctl"); if(!box || !hub) return;
  const p = hub.project(pid); if(!p){ box.innerHTML = ""; return; }
  if(S.drag) return;                                   // don't rebuild the board under a drag
  const canEdit = hub.canEdit(p), ids = hub.scriptIds(p);
  const raw = p.production, plan = planOf(pid);
  const scriptId = (plan.scriptId && ids.indexOf(plan.scriptId) >= 0) ? plan.scriptId : ids[0] || "";
  box.className = S.mode;
  if(S.mode === "off"){ return; }
  S.open = true;
  const head = (chips, acts) => `<div class="ctlHead">
      <span class="ctlTitle">${S.mode === "cs" ? "Call sheets" : "Shoot plan"}</span>
      <div class="ctlChips">${chips || ""}</div>${acts || ""}</div>`;

  if(!ids.length){ box.innerHTML = head(`<span class="ctlChip">Add a script to this project to plan the shoot</span>`); wire(box, pid); return; }
  const sc = S.scripts[scriptId];
  if(!sc || (sc.state === "loading" && !sc.bd)){
    if(!sc) loadScript(scriptId);
    box.innerHTML = head("") + `<div class="ctlLoad"><span class="spin"></span><b>${S.mode === "cs" ? "Loading call sheets…" : "Loading the plan…"}</b><span>Reading scenes, pages and cast from the script</span></div>`;
    wire(box, pid); return;
  }
  if(sc.state === "error" && !sc.bd){
    box.innerHTML = head(`<span class="ctlChip warn">Couldn't read the script</span>`) + (S.open ? `<div class="ctlEmpty">${esc(sc.err)} <button class="btn sm" type="button" data-a="reload">Try again</button></div>` : "");
    wire(box, pid); return;
  }
  // keep up with script edits made since the panel last read it
  const modNow = hub.scriptModified(scriptId);
  if(sc.state === "ok" && modNow && sc.modified && sc.modified !== modNow) loadScript(scriptId);
  else if(sc.state === "ok" && modNow && !sc.modified) sc.modified = modNow;   // library details arrived after we read the script
  // the plan's flag and location choices shape the breakdown everywhere (re-read when they change)
  const aopts = P.analyzeOpts(plan), akey = JSON.stringify(aopts);
  if(sc.doc && sc.akey !== akey){ sc.bd = B.analyze(sc.doc, aopts); sc.akey = akey; }
  // the Breakdown tab's element sheets shape each scene's cast and needs (see CampElements.enrich)
  const bd = window.CampBdPanel && window.CampBdPanel.enriched ? window.CampBdPanel.enriched(pid, scriptId, p, sc.doc, sc.bd, sc.modified, aopts) : sc.bd;
  const byId = P.sceneMap(bd); S.lastBd = bd; S.lastBdPid = pid;
  S.lastScriptId = scriptId;
  if(!S.shots[scriptId]) loadShots(scriptId);
  const shotMap = (S.shots[scriptId] && S.shots[scriptId].map) || {};

  // No plan yet: one click starts it from the script
  if(!raw){
    box.innerHTML = head(`<span class="ctlChip">${bd.scenes.length} scenes</span><span class="ctlChip">${P.fmtEighths(bd.totals.eighths)} pages</span><span class="ctlChip">${bd.cast.length} cast</span>`) + (S.open ? `<div class="ctlEmpty">
        ${canEdit ? `Camp lays out a first schedule from the script. Rearrange it, and the budget, schedule and call sheets follow.
        <button class="btn primary sm" type="button" data-a="start">Start the production plan</button>` : `The owner hasn't started the production plan yet.`}</div>` : "");
    wire(box, pid, { bd, scriptId }); return;
  }

  // The script is the truth: take deleted scenes off their days, list new ones
  const rec = P.syncWithScript(plan, raw.known, bd, scriptId), added = rec.added;
  const revOf = {}; rec.changed.forEach((c) => { revOf[c.id] = c; });
  if(canEdit && rec.save){
    if(rec.removed.length || added.length) S.notice[pid] = { added, removed: rec.removed };
    save(pid, rec.plan, true);
  }
  const pl = rec.plan, st = pl.settings, dates = P.planDates(pl);
  const badOrder = dates.some((d, i) => i && d && dates[i - 1] && d <= dates[i - 1]);
  const stats = pl.days.map((d) => P.dayStats(d, byId, st.maxEighths));
  const times = pl.days.map((d) => P.dayTimes(d, byId, pl.settings));
  const warns = P.validate(pl, bd);
  const scheduled = bd.scenes.filter((s) => s.id).length - rec.unscheduled.length;
  const nWarn = warns.filter((w) => w.level === "warn").length;
  const chips = `<span class="ctlChip hideSm">${st.days} shoot day${st.days === 1 ? "" : "s"}${st.start ? " · from " + esc(fmtDate(dates[0])) : ""}</span>
    <span class="ctlChip hideSm">${bd.scenes.length} scenes · ${P.fmtEighths(bd.totals.eighths)} pages</span>
    <span class="ctlChip ${rec.unscheduled.length ? "warn" : "ok"}">${scheduled}/${bd.scenes.filter((s) => s.id).length} scheduled</span>
    ${warns.length ? `<button type="button" class="ctlChip btnChip${nWarn ? " warn" : ""}" data-a="warns" aria-expanded="${S.warnOpen}">${nWarn ? "⚠ " + nWarn + " to check" : warns.length + " note" + (warns.length === 1 ? "" : "s")} ${S.warnOpen ? "▴" : "▾"}</button>` : ""}
    ${bd.cast.some((c) => c.minor) ? `<span class="ctlChip warn" title="${esc(bd.cast.filter((c) => c.minor).map((c) => c.name + (c.age != null ? " (" + c.age + ")" : " (age?)")).join(", "))}">${bd.cast.filter((c) => c.minor).length} under 18</span>` : ""}
    ${rec.changed.length ? `<span class="ctlChip warn" title="Scenes on shoot days that changed in the script">⚠ ${rec.changed.length} revised</span>` : ""}
    ${badOrder ? `<span class="ctlChip warn" title="A pinned date is on or before the day ahead of it">⚠ Days out of date order</span>` : ""}
    ${sc.state === "loading" ? `<span class="ctlChip">Updating from script…</span>` : ""}
    ${!canEdit ? `<span class="ctlChip">View only</span>` : ""}
    ${P.callsheetsStale(raw) ? `<span class="ctlChip warn" title="The plan changed since the last Sync">⟳ Sheets behind the plan${hub.isOwner(p) ? ": Sync" : " (owner Syncs)"}</span>` : ""}`;
  const hh = HIST[pid] || { undo: [], redo: [] };
  const acts = `<div class="ctlActs">
      ${canEdit ? `<span class="ctlUR"><button class="btn sm" type="button" data-a="undo" title="Undo (Ctrl+Z)"${hh.undo.length ? "" : " disabled"}>↶</button><button class="btn sm" type="button" data-a="redo" title="Redo (Ctrl+Shift+Z)"${hh.redo.length ? "" : " disabled"}>↷</button></span>` : ""}
      <span class="ctlMore"><button class="btn sm" type="button" data-a="menu" aria-haspopup="menu" aria-expanded="${S.menu}" title="More">⋯</button>${S.menu ? `<div class="ctlMenu" role="menu">
        <button type="button" data-a="auto"${canEdit ? "" : " disabled"}>Auto-schedule<small>Put unscheduled scenes on days with room</small></button>
        <button type="button" data-a="reauto"${canEdit ? "" : " disabled"}>Re-plan all<small>Lay out every scene again from scratch</small></button>
        <button type="button" data-a="reload">Refresh script<small>Read the latest script and storyboard shots</small></button>
        ${S.popout ? "" : `<button type="button" data-a="pop">Pop out<small>Open the plan in its own window</small></button>`}
      </div>` : ""}</span></div>`;
  if(S.mode === "cs"){ box.innerHTML = head("", "") + `<div class="ctlBody">${csView(pid, p, raw, pl, dates, scriptId)}</div>`; wire(box, pid, { bd, scriptId }); return; }

  const dis = canEdit ? "" : " disabled";
  const scriptSel = ids.length > 1 ? `<label>Script<select data-s="script"${dis}>${ids.map((id) => `<option value="${esc(id)}"${id === scriptId ? " selected" : ""}>${esc(hub.scriptTitle(id))}</option>`).join("")}</select></label>` : "";
  const pageOpts = []; for(let e = 16; e <= 80; e += 4) pageOpts.push(e);
  if(pageOpts.indexOf(st.maxEighths) < 0) pageOpts.push(st.maxEighths), pageOpts.sort((a, b) => a - b);
  const phone = matchMedia("(max-width:760px)").matches;
  const settings = `<details class="setWrap"${!phone || S.setOpen ? " open" : ""}><summary>Settings<span>${st.days} day${st.days === 1 ? "" : "s"} · ${st.perWeek}/wk · ${P.fmtEighths(st.maxEighths)} pg/day</span></summary><div class="ctlSet">
      ${scriptSel}
      <label>Shoot days<span class="ctlStep"><button type="button" data-a="days-" aria-label="One fewer day"${dis}>−</button><input type="number" min="1" max="${P.MAX_DAYS}" value="${st.days}" data-s="days"${dis}><button type="button" data-a="days+" aria-label="One more day"${dis}>+</button></span></label>
      <label>First shoot day<input type="date" value="${esc(st.start)}" data-s="start"${dis}></label>
      <label>Shooting week<select data-s="perWeek"${dis}>${[[5, "5 days (Mon–Fri)"], [6, "6 days (Mon–Sat)"], [7, "7 days"]].map(([v, n]) => `<option value="${v}"${v === st.perWeek ? " selected" : ""}>${n}</option>`).join("")}</select></label>
      <label>Pages per day (limit)<select data-s="maxEighths"${dis}>${pageOpts.map((e) => `<option value="${e}"${e === st.maxEighths ? " selected" : ""}>${P.fmtEighths(e)}</option>`).join("")}</select></label>
      <label>Default call<span class="ctlTime">${timeSelect(st.call, 'data-s="call"', dis)}<button type="button" class="btn sm h24${is24() ? " on" : ""}" data-a="h24" aria-pressed="${is24()}" title="Show times as 24-hour (this device)">24h</button></span></label>
    </div></details>`;

  const hasDocs = hub.hasSheets(pid);
  const docsNudge = hasDocs === false ? `<div class="ctlDocs">No production docs yet.${hub.isOwner(p) ? ` <button class="btn sm" type="button" data-a="create">Create production docs…</button>` : " The owner can create them."}</div>` : "";
  const n = S.notice[pid];
  const sceneName = (id) => { const s = byId[id]; return s ? "Sc " + s.n : "a deleted scene"; };
  const notice = n ? `<div class="ctlNote"><div><b>The script changed</b><ul>
      ${n.added.length ? `<li>${n.added.length} new scene${n.added.length === 1 ? "" : "s"} (${n.added.map(sceneName).join(", ")}) ${n.added.length === 1 ? "is" : "are"} in Unscheduled.${canEdit ? ` <button class="btn sm" type="button" data-a="placeNew">Place on suggested days</button>` : ""}</li>` : ""}
      ${n.removed.length ? `<li>${n.removed.length} deleted scene${n.removed.length === 1 ? " was" : "s were"} taken off ${Array.from(new Set(n.removed.map((r) => "Day " + r.day))).join(", ")}.</li>` : ""}
      ${(n.moved || []).length ? `<li>${n.moved.length} scene${n.moved.length === 1 ? "" : "s"} from removed days ${n.moved.length === 1 ? "is" : "are"} back in Unscheduled.</li>` : ""}
    </ul></div><button class="iconBtn x" type="button" data-a="dismiss" aria-label="Dismiss">✕</button></div>` : "";
  const revBox = rec.changed.length ? `<div class="ctlNote rev"><div><b>Script revisions on scheduled days</b>${canEdit && rec.changed.length > 1 ? `<button class="btn sm" type="button" data-a="acceptAll">Accept all</button>` : ""}<ul>
      ${rec.changed.map((c) => `<li>Sc ${byId[c.id] ? byId[c.id].n : "?"} (Day ${c.day}): ${esc(revText(c))}${canEdit ? `<button class="btn sm" type="button" data-a="accept" data-id="${esc(c.id)}">Accept</button>` : ""}</li>`).join("")}
    </ul><div style="color:var(--uiMuted);margin-top:4px">Check each day still works, then accept. Call sheets update on the next Sync.</div></div></div>` : "";
  const warnBox = warns.length && S.warnOpen ? `<div class="ctlWarn">${warns.map((w) => `<div class="${w.level}">${w.level === "warn" ? "⚠ " : "• "}${esc(w.text)}</div>`).join("")}</div>` : "";

  const strip = (id, tr) => {
    const s = byId[id]; if(!s) return "";
    const isNew = n && n.added.indexOf(id) >= 0;
    const rv = revOf[id];
    return `<button class="strip${S.pick === id ? " pick" : ""}${isNew ? " new" : ""}${rv ? " rev" : ""}${S.landed && S.landed.id === id ? " landed" : ""}" type="button" data-sid="${esc(id)}" draggable="${canEdit}" style="--sc:${stripColor(s)}" title="${esc(s.heading)}">
      <div class="t">Sc ${s.n} · ${esc(s.ie || "")} ${esc(DN[s.dn] || "")}<span>${shotMap[id] ? shotMap[id].length + " sh · " : ""}${P.fmtEighths(s.eighths)} pg</span></div>
      <div class="l">${esc(s.set || s.loc || "")}</div>
      <div class="c">${s.cast && s.cast.length ? esc(s.cast.join(", ")) : "No cast"}</div>${needDots(s.needs)}${tr ? `<div class="tm" title="Call ${esc(fmtTime(tr.call))} · shoot ${esc(fmtTime(tr.shoot))} · wrap ${esc(fmtTime(tr.wrap))} (${fmtMins(tr.est)} of shooting)">${esc(fmtTime(tr.shoot))} – ${esc(fmtTime(tr.wrap))}<span>${fmtMins(tr.est)}</span></div>` : ""}${rv ? `<div class="revTag" title="${esc(revText(rv))}">⚠ Revised: ${esc(rv.what.join(", "))}</div>` : ""}</button>`;
  };
  const shotsOn = Object.keys(shotMap).length > 0;
  const unsched = rec.unscheduled.slice().sort((a, b) => byId[a].n - byId[b].n);
  let tabDay = S.dayTab[pid]; if(tabDay == null || tabDay < -1 || tabDay >= pl.days.length) tabDay = pl.days.length ? 0 : -1;
  // a day's strips in order, with the meal and any company move between them (these aren't strips, so drag and drop ignore them)
  const dayRows = (tt) => tt.rows.map((r) => r.type === "scene" ? strip(r.id, r)
    : r.type === "meal" ? `<div class="brk meal${r.late ? " late" : ""}" title="${r.late ? "Past six hours from call: a meal penalty may apply" : "Meal break"}">Meal · ${esc(fmtTime(r.start))} – ${esc(fmtTime(r.end))}</div>`
    : `<div class="brk move" title="Company move: ${esc(r.from)} → ${esc(r.to)}">Move to ${esc(r.to)} · ${r.min} min</div>`).join("");
  const cols = [`<div class="col${unsched.length ? "" : " none"}${tabDay === -1 ? " sel" : ""}" data-day="-1"><div class="colHead"><b>Unscheduled</b><span class="dt">${unsched.length}</span>
      <div class="colMeta"><span>${P.fmtEighths(unsched.reduce((a, id) => a + byId[id].eighths, 0))} pages</span></div></div>
      <div class="strips">${unsched.length ? unsched.map((id) => strip(id)).join("") : `<div class="colEmpty">Every scene has a day ✓</div>`}</div></div>`]
    .concat(pl.days.map((d, i) => {
      const x = stats[i], pct = Math.min(100, Math.round(x.eighths / st.maxEighths * 100));
      return `<div class="col${x.over ? " over" : ""}${S.landed && S.landed.day === i ? " bump" : ""}${tabDay === i ? " sel" : ""}" data-day="${i}">
        <div class="colHead"><b>Day ${i + 1}</b><label class="dtPick${d.date ? " pinned" : ""}" title="${d.date ? "Set to this date. Click to change it" : "Click to choose this day's date. The days after it follow on"}"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg><span>${esc(fmtDate(dates[i]) || "Set date")}</span><input type="date" value="${esc(dates[i] || "")}" data-date="${i}"${dis}></label>${d.date && canEdit ? `<button type="button" class="unpin" data-a="unpin" data-day="${i}" title="Unpin: follow on from the day before">✕</button>` : ""}
          <div class="colMeta"><span>${P.fmtEighths(x.eighths)} / ${P.fmtEighths(st.maxEighths)} pg</span><span>${x.scenes} sc${shotsOn ? " · " + P.dayShots(d, shotMap).total + " shots" : ""} · ${x.cast.length} cast</span></div>
          <div class="cap"><i style="width:${pct}%"></i></div>
          ${needsRow(x.needs)}
          <div class="colCall">Call ${timeSelect(d.call || st.call, 'data-call="' + i + '"', dis)}${times[i].wrap ? `<span class="wrapT" title="Estimated wrap: ${fmtMins(times[i].est)} of shooting plus setups${times[i].rows.some((r) => r.type === "meal") ? ", the meal" : ""}${times[i].rows.some((r) => r.type === "move") ? " and company moves" : ""}">Wrap ${esc(fmtTime(times[i].wrap))}</span>` : ""}${x.locs.length ? `<span title="${esc(x.locs.join(", "))}">${x.locs.length} location${x.locs.length === 1 ? "" : "s"}</span>` : ""}</div></div>
        <div class="strips">${d.scenes.length ? dayRows(times[i]) : `<div class="colEmpty">${canEdit ? "Drag scenes here" : "No scenes"}</div>`}</div></div>`;
    })).join("");
  const dayTabs = `<div class="dayTabs" role="tablist" aria-label="Shoot days">
      <button type="button" role="tab" class="${tabDay === -1 ? "on" : ""}${unsched.length ? " warn" : ""}" data-a="dtab" data-i="-1" aria-selected="${tabDay === -1}">Unscheduled<i>${unsched.length}</i></button>
      ${pl.days.map((d, i) => `<button type="button" role="tab" class="${tabDay === i ? "on" : ""}${stats[i].over ? " over" : ""}" data-a="dtab" data-i="${i}" aria-selected="${tabDay === i}">Day ${i + 1}<small>${esc(fmtDate(dates[i]).replace(/^\w+,? /, "")) || "no date"}</small></button>`).join("")}
    </div>`;
  const moveBar = S.pick && byId[S.pick] && canEdit ? (() => {
    const cur = pl.days.findIndex((d) => d.scenes.indexOf(S.pick) >= 0), sug = cur < 0 ? P.suggestDay(S.pick, pl, bd) : -1;
    return `<div class="moveBar"><b>Sc ${byId[S.pick].n}</b> ${esc(byId[S.pick].heading)} → <select data-move="${esc(S.pick)}">
      <option value="-1"${cur < 0 ? " selected" : ""}>Unscheduled</option>
      ${pl.days.map((d, i) => `<option value="${i}"${i === cur ? " selected" : ""}>Day ${i + 1}${dates[i] ? " · " + esc(fmtDate(dates[i])) : ""} (${P.fmtEighths(stats[i].eighths)} pg)${i === sug ? " ★ suggested" : ""}</option>`).join("")}
      </select><button class="btn sm" type="button" data-a="unpick">Done</button></div>`;
  })() : "";

  const kidOf = {}; bd.cast.forEach((c) => { if(c.minor) kidOf[c.name] = c; });
  const rows = P.dood(pl, bd).filter((r) => r.workDays);
  const dood = `<details class="dood"${S.doodOpen ? " open" : ""}><summary>Day Out of Days · ${rows.length} cast</summary><div class="doodWrap"><table>
      <tr><th>Cast</th>${pl.days.map((d, i) => `<th>D${i + 1}</th>`).join("")}<th>Work</th><th>Hold</th><th>Total</th></tr>
      ${rows.map((r) => `<tr><td>${esc(r.name)}${kidOf[r.name] ? ` <span class="kid" title="Under 18${kidOf[r.name].age != null ? " (age " + kidOf[r.name].age + ")" : ": confirm age"}. Limited work hours, permit and chaperone.">⚠ under 18</span>` : ""}</td>${r.marks.map((m) => `<td class="${m}">${m}</td>`).join("")}<td>${r.workDays}</td><td>${r.holdDays}</td><td><b>${r.total}</b></td></tr>`).join("")}
    </table></div></details>`;

  // Shot list by shoot day: the storyboard's shots, in the order the scenes are shot
  const shSt = S.shots[scriptId] || {};
  const shotRows = pl.days.map((d, i) => {
    const ds = P.dayShots(d, shotMap); if(!ds.scenes.length) return "";
    return `<tr><td class="shotDay" colspan="7">Day ${i + 1}<span>${esc(fmtDate(dates[i]) || "no date")} · ${ds.total} shot${ds.total === 1 ? "" : "s"}</span></td></tr>` +
      ds.scenes.map((x) => x.shots.length ? x.shots.map((sh) => `<tr><td>${byId[x.id] ? byId[x.id].n : ""}</td><td>${esc(sh.shot)}</td><td>${esc(sh.size)}</td><td>${esc(sh.angle)}</td><td>${esc(sh.move)}</td><td class="desc">${esc(sh.desc)}</td><td class="st${sh.status === "Shot" ? " shot" : sh.status === "Needs reshoot" ? " reshoot" : ""}">${esc(sh.status || "Not shot")}</td></tr>`).join("")
        : `<tr><td>${byId[x.id] ? byId[x.id].n : ""}</td><td colspan="6" class="desc" style="color:var(--uiMuted)">No shots on the storyboard yet</td></tr>`).join("");
  }).join("");
  const nShots = Object.keys(shotMap).reduce((a, k) => a + shotMap[k].length, 0);
  const shots = `<details class="dood fx" data-sec="shots"${lsGet(SHOTS_KEY) === "1" ? " open" : ""}><summary>Shot list by day · ${shSt.state === "loading" && !shotsOn ? "loading…" : nShots + " shot" + (nShots === 1 ? "" : "s")}${shSt.state === "error" ? " · couldn't refresh" : ""}</summary>
    ${shotsOn ? `<div class="doodWrap"><table><tr><th>Sc</th><th>Shot</th><th>Size</th><th>Angle</th><th>Move</th><th>Description</th><th>Status</th></tr>${shotRows}</table></div>`
      : `<div class="shotNone">${shSt.state === "error" ? esc(shSt.err) : shSt.state === "loading" ? "Reading the storyboard…" : "No shots yet. Add them on the Storyboard tab and they appear here under their shoot day."}</div>`}
  </details>`;

  // days off set earlier (the old calendar): listed so they can be cleared
  const offs = (st.off || []);
  const cal = offs.length ? `<div class="offRow"><b>Days off</b>${offs.map((iso) => `<button type="button" class="offChip" data-a="cal" data-iso="${esc(iso)}" title="Shoot on this date again"${canEdit ? "" : " disabled"}>${esc(fmtDate(iso))} ✕</button>`).join("")}</div>` : "";
  const flagSec = flagsView(pl, bd, canEdit), locSec = locsView(pl, bd, canEdit), castSec = castView(pl, bd, canEdit);
  box.innerHTML = head(chips, acts) + `<div class="ctlBody">${settings}${cal}${docsNudge}${notice}${revBox}${warnBox}${moveBar}${dayTabs}<div class="board">${cols}</div>${dood}${shots}${flagSec}${castSec}${locSec}</div>`;
  wire(box, pid, { bd, scriptId, plan: pl, dates });
}

/* ---------- script flags: keep / watch / ignore, for a flag everywhere or one scene ---------- */
const FLAGS_KEY = "Camp_PROD_FLAGS_OPEN_V1", LOCS_KEY = "Camp_PROD_LOCS_OPEN_V1", CAST_KEY = "Camp_PROD_CAST_OPEN_V1";
function flagsView(pl, bd, canEdit){
  const list = bd.flags.filter((f) => f.scenes.length || (f.ignored || []).length);
  if(!list.length) return "";
  const glob = {}; (pl.flagStatus || []).forEach((x) => { if(!x.scene) glob[x.id] = x.s; });
  const sid = (n) => { const s = bd.scenes[n - 1]; return s ? (s.id || "n" + n) : ""; };
  const nIgn = list.filter((f) => glob[f.id] === "ignore").length, nWatch = list.filter((f) => glob[f.id] === "watch").length;
  return `<details class="dood fx" data-sec="flags"${lsGet(FLAGS_KEY) === "1" ? " open" : ""}><summary>Script flags · ${list.length}${nWatch ? " · " + nWatch + " watching" : ""}${nIgn ? " · " + nIgn + " ignored" : ""}</summary>
    <div class="fxNote">Ignore a wrong flag everywhere, or click a scene to ignore it there.</div>
    ${list.map((f) => {
      const g = glob[f.id] || "keep", all = f.scenes.concat(f.ignored || []).sort((a, b) => a - b);
      return `<div class="fxRow${g === "ignore" ? " ign" : g === "watch" ? " wat" : ""}">
        <div class="fxName"><b>${esc(f.label)}</b><span>${esc(f.use || "")}${f.words && f.words.length ? " · found: " + esc(f.words.slice(0, 4).join(", ")) : ""}</span></div>
        <div class="fxScenes">${all.map((n) => { const off = (f.ignored || []).indexOf(n) >= 0; return `<button type="button" class="fxSc${off ? " off" : ""}" data-a="fxsc" data-f="${esc(f.id)}" data-s="${esc(sid(n))}" data-on="${off ? 0 : 1}" title="${off ? "Ignored here: click to keep" : "Click to ignore in this scene"}"${canEdit ? "" : " disabled"}>Sc ${n}</button>`; }).join("")}</div>
        <div class="seg fxSeg">${["keep", "watch", "ignore"].map((v) => `<button type="button" class="${g === v ? "on" : ""}" data-a="fx" data-f="${esc(f.id)}" data-v="${v}"${canEdit ? "" : " disabled"}>${v[0].toUpperCase() + v.slice(1)}</button>`).join("")}</div>
      </div>`;
    }).join("")}</details>`;
}
/* ---------- cast: Lead / Supporting / … as the script suggests, or as you choose ---------- */
const TYPE_LABEL = { "Featured (non-speaking)": "Featured (non-speaking)" };
function castView(pl, bd, canEdit){
  if(!bd.cast.length) return "";
  const chosen = {}; (pl.castType || []).forEach((c) => { chosen[c.name] = c.t; });
  const n = Object.keys(chosen).filter((k) => bd.cast.some((c) => c.name === k)).length;
  return `<details class="dood fx" data-sec="cast"${lsGet(CAST_KEY) === "1" ? " open" : ""}><summary>Cast · ${bd.cast.length} character${bd.cast.length === 1 ? "" : "s"}${n ? " (" + n + " set by hand)" : ""}</summary>
    <div class="fxNote">Set by how much each character is in the script. Change any type here.</div>
    ${bd.cast.map((c) => `<div class="fxRow"><div class="fxName"><b>${esc(c.name)}</b><span>${c.onCamCount || c.scenes.length} scene${(c.onCamCount || c.scenes.length) === 1 ? "" : "s"}${chosen[c.name] && c.autoType !== c.type ? " · script suggests " + esc(c.autoType) : ""}</span></div>
      <label class="fxIn">Type <select data-ctype="${esc(c.name)}"${canEdit ? "" : " disabled"}>${P.CAST_TYPES.map((t) => `<option value="${esc(t)}"${c.type === t ? " selected" : ""}>${esc(TYPE_LABEL[t] || t)}${t === c.autoType ? " (auto)" : ""}</option>`).join("")}</select></label></div>`).join("")}
  </details>`;
}
// Set (or clear, when it's the automatic one) a character's type. Used by the Plan tab and the Board.
function setCastType(pid, name, t, auto){
  const plan = planOf(pid);
  if(auto === undefined && S.lastBd && S.lastScriptId === plan.scriptId){ const c = S.lastBd.cast.find((x) => x.name === name); if(c) auto = c.autoType; }
  plan.castType = (plan.castType || []).filter((c) => c.name !== name);
  if(t && t !== auto && P.CAST_TYPES.indexOf(t) >= 0) plan.castType.push({ name, t });
  save(pid, plan); rerender();
}

/* ---------- locations: rooms that are really one place ---------- */
const ROOM_RE = /^(KITCHEN|LOUNGE|LOUNGE ROOM|LIVING ROOM|SITTING ROOM|DINING ROOM|FAMILY ROOM|BEDROOM|MASTER BEDROOM|.*'S BEDROOM|.*'S ROOM|BATHROOM|ENSUITE|TOILET|LAUNDRY|HALLWAY|HALL|CORRIDOR|STAIRS|STAIRCASE|LANDING|ATTIC|BASEMENT|CELLAR|GARAGE|STUDY|OFFICE|NURSERY|PANTRY|FRONT DOOR|BACK DOOR|PORCH|VERANDAH|VERANDA|BALCONY|BACKYARD|BACK YARD|FRONT YARD|YARD|GARDEN|DRIVEWAY|SHED|ROOFTOP)$/;
function locsView(pl, bd, canEdit){
  const orig = {}; bd.scenes.forEach((s) => { const o = s.oloc || s.loc; if(!o) return; (orig[o] = orig[o] || { n: 0, e: 0 }).n++; orig[o].e += s.eighths; });
  const names = Object.keys(orig); if(names.length < 2 && !(pl.locMerge || []).length) return "";
  const map = {}; (pl.locMerge || []).forEach((m) => { map[m.from] = m.to; });
  // place -> the script locations in it
  const places = {};
  names.forEach((n) => { const r = P.locRoot(map, n); (places[r] = places[r] || { name: r, areas: [], n: 0, e: 0 }).areas.push(n); places[r].n += orig[n].n; places[r].e += orig[n].e; });
  const list = Object.values(places).sort((a, b) => b.e - a.e);
  const rooms = names.filter((n) => ROOM_RE.test(n) && P.locRoot(map, n) === n && places[n] && places[n].areas.length === 1);
  const f = S.locForm, inForm = f && canEdit;
  const pickable = inForm ? list.filter((x) => x.name !== f.place) : [];
  const form = inForm ? `<div class="lcForm">
      ${f.place ? `<b>Add areas to ${esc(f.place)}</b>` : `<label class="lcName">New place <input id="lcName" type="text" maxlength="60" placeholder="e.g. HOUSE" value="${esc(f.name || "")}"></label>`}
      <div class="lcPick">${pickable.map((x) => `<label><input type="checkbox" value="${esc(x.name)}"${f.picked && f.picked[x.name] ? " checked" : ""}> ${esc(x.name)}${x.areas.length > 1 || x.areas[0] !== x.name ? ` <i>+ ${x.areas.length} area${x.areas.length === 1 ? "" : "s"}</i>` : ""} <i>${x.n} sc</i></label>`).join("") || `<span>No other locations to add.</span>`}</div>
      <div class="lcBtns"><button type="button" class="btn sm primary" data-a="lcok">${f.place ? "Add" : "Make place"}</button><button type="button" class="btn sm" data-a="lccancel">Cancel</button></div></div>` : "";
  const grouped = list.filter((x) => x.areas.length > 1 || x.areas[0] !== x.name).length;
  return `<details class="dood fx" data-sec="locs"${lsGet(LOCS_KEY) === "1" || inForm ? " open" : ""}><summary>Locations · ${list.length} place${list.length === 1 ? "" : "s"}${names.length !== list.length ? " (" + names.length + " in the script)" : ""}</summary>
    <div class="fxNote">Group areas (kitchen, yard…) into the one real place you shoot at.
      ${canEdit ? `<button type="button" class="btn sm" data-a="lcnew">New place…</button>` : ""}
      ${rooms.length > 1 && canEdit ? `<button type="button" class="btn sm" data-a="rooms" data-rooms="${esc(rooms.join("|"))}">Put ${rooms.length} rooms in one place…</button>` : ""}</div>
    ${form}
    ${list.map((x) => {
      const areas = x.areas.filter((a) => a !== x.name), own = !!orig[x.name];
      return `<div class="fxRow"><div class="fxName"><b>${esc(x.name)}</b><span>${x.n} scene${x.n === 1 ? "" : "s"} · ${P.fmtEighths(x.e)} pg${areas.length ? " · " + (areas.length + (own ? 1 : 0)) + " areas" : ""}</span>
        ${areas.length ? `<div class="lcAreas">${own ? `<span class="lcChip main" title="Scenes written as ${esc(x.name)} itself">${esc(x.name)}</span>` : ""}${areas.map((a) => `<span class="lcChip">${esc(a)}${canEdit ? `<button type="button" data-a="lcout" data-loc="${esc(a)}" aria-label="Take ${esc(a)} out of ${esc(x.name)}" title="Take out: its own location again">✕</button>` : ""}</span>`).join("")}</div>` : ""}</div>
        ${canEdit ? `<div class="lcActs"><button type="button" class="btn sm" data-a="lcadd" data-place="${esc(x.name)}">Add areas…</button>${areas.length ? `<button type="button" class="btn sm" data-a="lcren" data-place="${esc(x.name)}" data-own="${own ? 1 : 0}">Rename…</button><button type="button" class="btn sm" data-a="lcsplit" data-place="${esc(x.name)}" title="Every area becomes its own location again">Split</button>` : ""}</div>` : ""}</div>`;
    }).join("")}
  </details>`;
}

/* ---------- call sheets ---------- */
function csView(pid, p, raw, pl, dates, scriptId){
  const hub = H(), owner = hub.isOwner(p), cs = raw && raw.callsheets;
  const days = cs ? (Array.isArray(cs.days) ? cs.days : Object.values(cs.days || {})) : [];
  const err = S.csErr[pid];
  const when = cs && cs.at ? new Date(cs.at).toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "";
  const stale = P.callsheetsStale(raw);
  const auth = err && /permission|authori[sz]|scope|Google needs your OK/i.test(err);
  const errBox = err ? `<div class="csErr"><b>${auth ? "Google hasn't allowed Camp to make Docs yet" : "The call sheets didn't build"}</b>
      ${auth ? `<ol><li>Open your Camp script in Apps Script (script.google.com).</li><li>Pick <code>authorizeCallSheets</code> in the function list and press Run. Allow the permissions Google asks for.</li><li>Deploy › Manage deployments › edit › New version › Deploy.</li><li>Come back and press <b>Make call sheets</b>.</li></ol>` : `<div>${esc(err)}</div>`}</div>` : "";
  if(S.busy[pid]) return `<div class="ctlLoad"><span class="spin"></span><b>${S.busy[pid] === "sync" ? "Syncing to Sheets…" : "Making call sheets…"}</b><span>One Google Doc per shoot day. This can take a minute.</span></div>`;
  if(!raw) return `<div class="csWrap"><h3>No shoot plan yet</h3><p>Start it in Schedule › Shoot plan first.</p></div>`;
  const list = days.length ? `<div class="csList">${days.map((d) => { const i = Number(d.day) - 1; return `<a class="csDay${stale ? " stale" : ""}" href="${esc(d.url)}" target="_blank" rel="noopener"><b>Day ${esc(d.day)} ↗</b><span>${esc(fmtDate(dates[i]) || "")}${pl.days[i] ? " · " + pl.days[i].scenes.length + " scene" + (pl.days[i].scenes.length === 1 ? "" : "s") : ""}</span></a>`; }).join("")}</div>` : "";
  return `<div class="csWrap">
    <p>One Google Doc per shoot day. ${days.length ? `Last made ${esc(when)}.` : ""}${stale ? " <b style=\"color:#f1c76b\">The plan changed since then.</b>" : ""}</p>
    ${errBox}
    ${list || (err ? "" : `<p>None made yet.</p>`)}
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      ${owner ? `<button class="btn sm primary" type="button" data-a="cs">${days.length ? "Update call sheets" : "Make call sheets"}</button>` : `<span class="ctlRO">Only the owner can make call sheets.</span>`}
      ${cs && cs.folderUrl ? `<a class="btn sm" href="${esc(cs.folderUrl)}" target="_blank" rel="noopener">Open folder in Drive ↗</a>` : ""}
    </div></div>`;
}

/* ---------- interaction ---------- */
function wire(box, pid, ctx){
  ctx = ctx || {};
  const hub = H(), p = hub.project(pid), canEdit = p && hub.canEdit(p);
  const update = (fn) => { const plan = planOf(pid); fn(plan); save(pid, plan); rerender(); };
  box.onclick = (e) => {
    // The date chip hides its date input; open the calendar on any click (browsers only open it from the icon otherwise)
    const dp = e.target.closest(".dtPick");
    if(dp){ const inp = dp.querySelector("input[type=date]"); if(inp && !inp.disabled){ e.preventDefault(); try{ inp.showPicker(); }catch(_e){ inp.focus(); inp.click(); } } return; }
    const a = e.target.closest("[data-a]"), sEl = e.target.closest(".strip");
    if(a){
      const k = a.dataset.a;
      if(k !== "menu") S.menu = false;
      if(k === "menu"){ S.menu = !S.menu; render(pid); return; }
      if(k === "dtab"){ S.dayTab[pid] = Number(a.dataset.i); render(pid); return; }
      if(k === "undo" || k === "redo"){ stepHist(pid, k === "undo"); return; }
      if(k === "h24"){ lsSet(H24_KEY, is24() ? "0" : "1"); render(pid); return; }
      if(k === "warns"){ S.warnOpen = !S.warnOpen; render(pid); return; }
      if(k === "create"){ hub.createDocs(a); return; }
      if(k === "fx" && canEdit){
        const id = a.dataset.f, v = a.dataset.v;
        update((plan) => { plan.flagStatus = (plan.flagStatus || []).filter((x) => x.scene || x.id !== id); if(v !== "keep") plan.flagStatus.push({ id, scene: "", s: v }); if(v === "keep") plan.flagStatus = plan.flagStatus.filter((x) => x.id !== id); });
        H().toast(v === "ignore" ? "Flag ignored." : v === "watch" ? "Watching this flag." : "Flag kept.", "ok", 1600); return;
      }
      if(k === "fxsc" && canEdit){
        const id = a.dataset.f, sc = a.dataset.s, on = a.dataset.on === "1";
        update((plan) => {
          const glob = (plan.flagStatus || []).find((x) => x.id === id && !x.scene);
          plan.flagStatus = (plan.flagStatus || []).filter((x) => !(x.id === id && x.scene === sc));
          // on → ignore here; off → back on (an explicit keep when the flag is ignored everywhere)
          if(on) plan.flagStatus.push({ id, scene: sc, s: "ignore" });
          else if(glob && glob.s === "ignore") plan.flagStatus.push({ id, scene: sc, s: "keep" });
        });
        return;
      }
      if(k === "rooms" && canEdit){
        const rooms = (a.dataset.rooms || "").split("|").filter(Boolean);
        H().prompt("One location for " + rooms.length + " rooms", "Location name (" + rooms.join(", ") + " become its sets)", "HOUSE").then((v) => {
          const name = String(v || "").trim().toUpperCase(); if(!name) return;
          update((plan) => { P.groupLocs(plan, rooms, name); });
          H().toast(rooms.length + " rooms are now sets of " + name + ".", "ok", 2200);
        });
        return;
      }
      // locations: places and their areas
      if(k === "lcnew" && canEdit){ S.locForm = { place: "", picked: {} }; rerender(); return; }
      if(k === "lcadd" && canEdit){ S.locForm = { place: a.dataset.place, picked: {} }; rerender(); return; }
      if(k === "lccancel"){ S.locForm = null; rerender(); return; }
      if(k === "lcok" && canEdit){
        const f = S.locForm; if(!f) return;
        const picked = Array.from(box.querySelectorAll(".lcPick input:checked")).map((i) => i.value);
        const nameIn = box.querySelector("#lcName"), name = f.place || String(nameIn ? nameIn.value : "").trim().toUpperCase();
        if(!name){ H().toast("Give the place a name.", "err", 2000); if(nameIn) nameIn.focus(); return; }
        if(!picked.length && (f.place || !name)){ H().toast("Tick at least one location.", "err", 2000); return; }
        S.locForm = null;
        update((plan) => { P.groupLocs(plan, picked, name); });
        H().toast(picked.length + " location" + (picked.length === 1 ? "" : "s") + " now part of " + name + ".", "ok", 2200);
        return;
      }
      if(k === "lcout" && canEdit){ update((plan) => { P.ungroupLoc(plan, a.dataset.loc); }); return; }
      if(k === "lcsplit" && canEdit){
        const pl2 = a.dataset.place;
        H().confirm("Split " + pl2 + "?", "Every area becomes its own location again. Undo puts it back.", "Split", false).then((ok) => { if(ok) update((plan) => { P.splitPlace(plan, pl2); }); });
        return;
      }
      if(k === "lcren" && canEdit){
        const from = a.dataset.place, own = a.dataset.own === "1";
        H().prompt("Rename " + from, "Place name", from).then((v) => {
          const n = String(v || "").trim().toUpperCase(); if(!n || n === from) return;
          update((plan) => { P.renamePlace(plan, from, n, own); });
          H().toast(own ? "Renamed. Scenes written as " + from + " are now an area of " + n + "." : "Renamed to " + n + ".", "ok", 2600);
        });
        return;
      }
      if(k === "unpin" && canEdit){ update((plan) => { const d = plan.days[Number(a.dataset.day)]; if(d) d.date = ""; }); return; }
      if(k === "cal" && canEdit){
        const iso = a.dataset.iso;
        update((plan) => { const off = new Set(plan.settings.off || []); off.has(iso) ? off.delete(iso) : off.add(iso); plan.settings.off = Array.from(off).sort(); });
        H().toast("Day off removed.", "ok", 1500);
        return;
      }
      if(k === "cs" || k === "sync"){
        flush(); S.busy[pid] = k; render(pid);
        Promise.resolve(k === "cs" ? hub.makeCallsheets(pid, ctx.scriptId, a) : hub.syncSheets(pid, ctx.scriptId, a)).finally(() => { delete S.busy[pid]; rerender(); });
        return;
      }
      if(k === "pop"){ window.open(location.pathname + "?pid=" + encodeURIComponent(pid) + "&tab=schedule&popout=1", "campProdPop", "popup=yes,width=1280,height=900"); return; }
      if(k === "reload"){ const id = ctx.scriptId || hub.scriptIds(p)[0]; loadScript(id, true); loadShots(id, true); return; }
      if(k === "dismiss"){ delete S.notice[pid]; render(pid); return; }
      if(k === "unpick"){ S.pick = null; render(pid); return; }
      if(!canEdit) return;
      if(k === "start"){
        const today = new Date(), d = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate() + 14));
        const days = Math.max(1, Math.ceil(ctx.bd.totals.eighths / P.DEFAULTS.maxEighths));
        const base = P.normalize({ scriptId: ctx.scriptId, settings: { days, start: d.toISOString().slice(0, 10) } });
        const r = P.autoSchedule(base, ctx.bd);
        r.plan.known = ctx.bd.scenes.filter((s) => s.id).map((s) => s.id);
        save(pid, r.plan); flush(); rerender(); return;
      }
      if(k === "days-" || k === "days+"){ const plan = planOf(pid), r = P.resizeDays(plan, plan.settings.days + (k === "days+" ? 1 : -1)); confirmShrink(pid, r); return; }
      if(k === "reauto"){ H().confirm("Re-plan every scene?", "Every scene is laid out again from scratch. Scenes you've placed by hand will move. Undo puts them back.", "Re-plan all", false).then((ok) => { if(ok) autoPlan(pid, ctx, true); }); return; }
      if(k === "auto"){ autoPlan(pid, ctx, false); return; }
      if(k === "accept" || k === "acceptAll"){
        update((plan) => { P.acceptChanges(plan, ctx.bd, k === "accept" ? [a.dataset.id] : []); });
        H().toast(k === "accept" ? "Revision accepted." : "All revisions accepted.", "ok", 1500);
        return;
      }
      if(k === "placeNew"){
        const n = S.notice[pid]; if(!n) return;
        update((plan) => { P.placeScenes(plan, n.added, ctx.bd); });
        n.added = []; if(!n.removed.length) delete S.notice[pid];
        return;
      }
    }
    if(S.menu && !e.target.closest(".ctlMenu")){ S.menu = false; render(pid); return; }
    if(sEl && canEdit){ S.pick = S.pick === sEl.dataset.sid ? null : sEl.dataset.sid; render(pid); }
  };
  box.querySelectorAll("details.setWrap").forEach((d) => { d.ontoggle = () => { if(matchMedia("(max-width:760px)").matches) S.setOpen = d.open; }; });
  box.onchange = (e) => {
    const t = e.target; if(!canEdit) return;
    if(t.dataset.move){ moveScene(pid, t.dataset.move, Number(t.value), -1); S.pick = null; return; }
    if(S.locForm && t.closest(".lcPick")){ (S.locForm.picked = S.locForm.picked || {})[t.value] = t.checked; return; }
    if(t.dataset.ctype != null){
      const c = (ctx.bd && ctx.bd.cast || []).find((x) => x.name === t.dataset.ctype);
      setCastType(pid, t.dataset.ctype, t.value, c && c.autoType);
      H().toast(t.dataset.ctype + ": " + t.value, "ok", 1600);
      return;
    }
    if(t.dataset.date != null){ update((plan) => { const d = plan.days[Number(t.dataset.date)]; if(d) d.date = t.value || ""; }); return; }
    if(t.dataset.call != null){ update((plan) => { const d = plan.days[Number(t.dataset.call)]; if(d) d.call = t.value === plan.settings.call ? "" : t.value; }); return; }
    const k = t.dataset.s; if(!k) return;
    if(k === "days"){ const r = P.resizeDays(planOf(pid), Number(t.value)); confirmShrink(pid, r); return; }
    if(k === "script"){ update((plan) => { plan.scriptId = t.value; }); return; }
    update((plan) => { plan.settings[k] = (k === "start" || k === "call") ? t.value : Number(t.value); });
  };
  const lcName = box.querySelector("#lcName"); if(lcName){ lcName.oninput = () => { if(S.locForm) S.locForm.name = lcName.value; }; lcName.onkeydown = (e) => { e.stopPropagation(); if(e.key === "Enter"){ e.preventDefault(); const ok = box.querySelector("[data-a=lcok]"); if(ok) ok.click(); } }; if(!lcName.value) lcName.focus({ preventScroll: true }); }
  const det = box.querySelector("details.dood:not(.fx)"); if(det) det.ontoggle = () => { S.doodOpen = det.open; lsSet(DOOD_KEY, det.open ? "1" : "0"); };
  box.querySelectorAll("details.fx").forEach((d) => { d.ontoggle = () => lsSet(d.dataset.sec === "flags" ? FLAGS_KEY : d.dataset.sec === "shots" ? SHOTS_KEY : d.dataset.sec === "cast" ? CAST_KEY : LOCS_KEY, d.open ? "1" : "0"); });
  if(!canEdit) return;
  // drag and drop between columns
  const line = document.createElement("div"); line.className = "dropLine";
  box.ondragstart = (e) => { const s = e.target.closest(".strip"); if(!s) return; S.drag = s.dataset.sid; setTimeout(() => s.classList.add("dragging"), 0); try{ e.dataTransfer.setData("text/plain", S.drag); e.dataTransfer.effectAllowed = "move"; }catch(_e){} };
  box.ondragend = () => { S.drag = null; line.remove(); box.querySelectorAll(".col.drop").forEach((c) => c.classList.remove("drop")); rerender(); };
  box.ondragover = (e) => {
    const c = e.target.closest(".col"); if(!c || !S.drag) return; e.preventDefault();
    box.querySelectorAll(".col.drop").forEach((x) => x !== c && x.classList.remove("drop")); c.classList.add("drop");
    // a bright line where the scene will land
    const list = c.querySelector(".strips"); if(!list || c.dataset.day === "-1"){ line.remove(); return; }
    const strips = Array.from(list.querySelectorAll(".strip:not(.dragging)"));
    const before = strips.find((x) => { const r = x.getBoundingClientRect(); return e.clientY < r.top + r.height / 2; });
    if(before){ if(line.nextSibling !== before) list.insertBefore(line, before); } else if(list.lastElementChild !== line) list.appendChild(line);
  };
  box.ondrop = (e) => {
    const c = e.target.closest(".col"); if(!c || !S.drag) return; e.preventDefault();
    const id = S.drag; S.drag = null;
    // land where the line is
    let at = -1;
    if(line.parentNode){ const kids = Array.from(line.parentNode.children).filter((x) => x === line || (x.classList.contains("strip") && x.dataset.sid !== id)); at = kids.indexOf(line); }
    line.remove();
    moveScene(pid, id, Number(c.dataset.day), at);
  };
}
// For the Stripboard: move a scene to a day (or -1 = Unscheduled), in front of another scene or at the end.
// Goes through moveScene, so it saves, joins undo and says what happened exactly like a drag on the Plan.
function moveSceneBefore(pid, id, toDay, beforeId){
  const hub = H(), p = hub && hub.project(pid);
  if(!p || !hub.canEdit(p) || !id) return false;
  const plan = planOf(pid);
  if(toDay >= 0 && !plan.days[toDay]) return false;
  let at = -1;
  if(toDay >= 0 && beforeId && beforeId !== id){ const list = plan.days[toDay].scenes.filter((x) => x !== id); at = list.indexOf(beforeId); }
  moveScene(pid, id, toDay, at);
  return true;
}
function moveScene(pid, id, toDay, at){
  const { plan, from } = P.moveSceneIn(planOf(pid), id, toDay, at);
  save(pid, plan);
  // feedback: the strip flashes where it landed, the day lights up, and a line says what happened
  S.landed = { id, day: toDay }; clearTimeout(moveScene.t); moveScene.t = setTimeout(() => { S.landed = null; }, 900);
  const sc = S.lastBd ? P.sceneMap(S.lastBd)[id] : null, name = sc ? "Sc " + sc.n : "Scene";
  if(toDay < 0) H().toast(name + " moved to Unscheduled", "ok", 1800);
  else if(from === toDay) H().toast(name + " reordered on Day " + (toDay + 1), "ok", 1800);
  else if(S.lastBd){ const st = P.dayStats(plan.days[toDay], P.sceneMap(S.lastBd), plan.settings.maxEighths); H().toast(name + " → Day " + (toDay + 1) + " · " + P.fmtEighths(st.eighths) + " / " + P.fmtEighths(plan.settings.maxEighths) + " pg" + (st.over ? " (over the limit)" : ""), "ok", 1800); }
  else H().toast(name + " → Day " + (toDay + 1), "ok", 1800);
  rerender();
}
function autoPlan(pid, ctx, all){
  const r = P.autoSchedule(planOf(pid), ctx.bd, { all });
  save(pid, r.plan); rerender();
  if(r.unplaced.length) H().toast(r.unplaced.length + " scene" + (r.unplaced.length === 1 ? " doesn't" : "s don't") + " fit in " + r.plan.settings.days + " days at this page limit. Add days or raise the limit.");
}
function confirmShrink(pid, r){
  const go = () => { if(r.moved.length) S.notice[pid] = Object.assign({ added: [], removed: [] }, S.notice[pid] || {}, { moved: r.moved }); save(pid, r.plan); rerender(); };
  if(!r.moved.length){ go(); return; }
  H().confirm("Remove shoot days?", r.moved.length + " scene" + (r.moved.length === 1 ? " goes" : "s go") + " back to Unscheduled.", "Remove days", true).then((ok) => { if(ok) go(); else rerender(); });
}

function setMode(m){
  if(S.popout) m = "plan"; if(m === S.mode) return; S.mode = m; S.menu = false;
  if(m === "plan" && S.lastScriptId) loadShots(S.lastScriptId, true);   // pick up shots added on the Storyboard tab
  rerender();
}
function csError(pid, msg){ if(msg) S.csErr[pid] = msg; else delete S.csErr[pid]; rerender(); }
document.addEventListener("keydown", (e) => {
  if(e.key === "Escape" && S.menu){ S.menu = false; rerender(); return; }
  // Ctrl/Cmd+Z, Ctrl+Shift+Z / Ctrl+Y while the plan is showing (not while typing in a field)
  if(S.mode !== "plan" || !S.pid || !(e.ctrlKey || e.metaKey)) return;
  if(e.target.closest && e.target.closest("input, select, textarea, [contenteditable=true]")) return;
  if(document.querySelector(".shade")) return;
  const k = e.key.toLowerCase();
  if(k === "z" || k === "y"){ e.preventDefault(); stepHist(S.pid, k === "z" && !e.shiftKey); }
});
// The Board reads and sets cast types through these (the plan is the one place they live)
function castTypes(pid, scriptId){
  const p = H().project(pid); if(!p || !p.production) return null;          // no plan yet: nothing to set
  if(scriptId && planOf(pid).scriptId && planOf(pid).scriptId !== scriptId) return null;   // the plan is for another script
  const out = {}; (planOf(pid).castType || []).forEach((c) => { out[c.name] = c.t; });
  return out;
}
// Sync to Sheets, from the hub's bar (next to + Docs)
function syncNow(pid, btn){
  const hub = H(), p = hub.project(pid); if(!p || S.busy[pid]) return;
  const ids = hub.scriptIds(p), plan = planOf(pid), scriptId = (plan.scriptId && ids.indexOf(plan.scriptId) >= 0) ? plan.scriptId : ids[0];
  if(!scriptId){ hub.toast("Add a script to this project first.", "err"); return; }
  flush(); S.busy[pid] = "sync"; rerender();
  Promise.resolve(hub.syncSheets(pid, scriptId, btn)).finally(() => { delete S.busy[pid]; rerender(); });
}
const isStale = (pid) => { const p = H().project(pid); return !!(p && P.callsheetsStale(p.production)); };
// Each day's call / shoot / wrap times for Sync (null until the plan has been drawn for this project in this tab)
function timetable(pid){ try{ if(!S.lastBd || S.lastBdPid !== pid) return null; return P.timetable(planOf(pid), P.sceneMap(S.lastBd)); }catch(_e){ return null; } }
window.CampProdPanel = { syncNow, isStale, render, setMode, csError, moveSceneBefore, planOf, timetable, undo: (pid) => stepHist(pid, true), reloadScript: (id) => loadScript(id, true), castTypes, setCastType: (pid, name, t, auto) => setCastType(pid, name, t, auto), CAST_TYPES: P.CAST_TYPES };
})();
