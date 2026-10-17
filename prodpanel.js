/* prodpanel.js — the Production control panel in the hub's Production tab.
   One place for everything that drives the production docs: which script, how many shoot days,
   start date, shooting week, page limit per day, call times, and which scenes shoot on which day.
   The script is the source of truth: the panel re-reads it (breakdown.js) and keeps the plan in step
   (production.js), then saves the plan to projects/<pid>/production for the whole team, live.
   Needs: breakdown.js, production.js and window.__CampHub (set up by index.html). */
(function(){
"use strict";
const P = window.CampProduction, B = window.CampBreakdown;
// a scene's number as the script shows it (locked numbers like 12A), else its position
const SN = (s) => s ? (s.sno || s.n) : "";
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
  pid: null,
  view: "strips"   // the Stripboard (the old day columns, "classic", are kept in the code but no longer offered)
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
.ctlUR{ display:inline-flex; align-items:center; gap:2px; }
.ctlUR .btn{ min-width:32px; padding:0 8px; font-size:15px; display:inline-flex; align-items:center; justify-content:center; }
.ctlUR .btn.rf{ margin-right:8px; }
.ctlUR .btn.spin svg{ animation:ctlSpin .8s linear infinite; }
@keyframes ctlSpin{ to{ transform:rotate(360deg); } }
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
.strip.landed{ position:relative; z-index:1; }
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
.colCall{ flex-wrap:wrap; justify-content:space-between; }
.colCall:empty{ display:none; }
.colTimes{ display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:6px; margin-top:8px; }
.colTimes label{ display:flex; flex-direction:column; gap:3px; font-size:10.5px; letter-spacing:.04em; text-transform:uppercase; color:var(--uiMuted); min-width:0; }
.colTimes select{ width:100%; min-width:0; height:26px; border-radius:6px; border:1px solid var(--uiBorder); background:#111; padding:0 3px; font-size:12px; letter-spacing:0; text-transform:none; color:var(--uiText); font-variant-numeric:tabular-nums; }
.colTimes select:disabled{ opacity:.6; }
.colSun{ display:flex; flex-wrap:wrap; align-items:center; gap:4px 8px; margin-top:6px; font-size:11px; color:var(--uiMuted); font-variant-numeric:tabular-nums; }
.colSun .place{ border:1px solid var(--uiBorder); background:rgba(255,255,255,.04); color:var(--uiText); border-radius:7px; padding:1px 7px; font:inherit; font-size:11px; cursor:pointer; max-width:100%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.colSun .place.own{ border-color:rgba(127,182,255,.5); }
.colSun .place:disabled{ cursor:default; }
.colSun .wx{ color:#ddd; }
.strip .stat{ font-style:normal; font-size:9.5px; font-weight:700; text-transform:uppercase; letter-spacing:.04em; padding:1px 5px; border-radius:5px; margin-left:6px; background:rgba(255,255,255,.12); color:#fff; }
.strip .stat.s-shot{ background:#2f9e44; } .strip .stat.s-partshot{ background:#f59f00; color:#111; } .strip .stat.s-pickup{ background:#1c7ed6; } .strip .stat.s-moved{ background:#868e96; } .strip .stat.s-omitted{ background:#e03131; }
.moveBar .stSel{ display:inline-flex; align-items:center; gap:6px; font-size:12px; color:var(--uiMuted); }
.ctlSet label.wide input{ min-width:220px; }
.tmSet{ flex-basis:100%; }
.tmSet summary{ cursor:pointer; font-size:11px; color:var(--uiMuted); text-transform:uppercase; letter-spacing:.05em; }
.tmRow{ display:flex; flex-wrap:wrap; gap:10px 14px; margin-top:8px; }
.tmRow input{ width:90px; }
.colCall .wrapT{ white-space:nowrap; color:var(--uiText); font-weight:600; font-variant-numeric:tabular-nums; }
.colCall .colMeal{ display:inline-flex; align-items:center; gap:4px; font-size:11px; color:var(--uiMuted); flex-wrap:wrap; }
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
.avWrap{ display:flex; flex-wrap:wrap; align-items:center; justify-content:flex-end; gap:5px; flex:0 1 auto; min-width:0; }
.avLbl{ font-size:11px; color:var(--uiMuted); margin-right:2px; }
.lcChip.off{ border-color:rgba(255,139,131,.45); background:rgba(255,139,131,.08); color:#ffb4ae; }
.avAdd{ position:relative; display:inline-flex; align-items:center; height:24px; padding:0 9px; border:1px dashed var(--uiBorder); border-radius:999px; font-size:11.5px; color:var(--uiMuted); cursor:pointer; }
.avAdd:hover{ border-color:rgba(255,255,255,.35); color:var(--uiText); }
.avAdd input{ position:absolute; inset:0; opacity:0; width:100%; cursor:pointer; }
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
/* ---------- places, sunrise / sunset and weather ----------
   A place is looked up once (Open-Meteo geocoding, free, no key) and saved in the plan with its time zone, so every
   device shows the same sunrise and sunset (worked out here, any date). Weather comes from Open-Meteo's forecast,
   which only reaches about 16 days ahead; it's shown and sent with Sync, never saved in the plan. */
async function geocode(q){
  q = String(q || "").trim(); if(!q) return null;
  try{
    const r = await fetch("https://geocoding-api.open-meteo.com/v1/search?count=1&language=en&format=json&name=" + encodeURIComponent(q));
    const j = await r.json(), x = j && j.results && j.results[0]; if(!x) return null;
    return { name: q, label: [x.name, x.admin1, x.country_code].filter(Boolean).join(", "), lat: x.latitude, lng: x.longitude, tz: x.timezone || "" };
  }catch(_e){ return null; }
}
const WX = {}, WX_KEY = "Camp_WX_V1";
try{ const c = JSON.parse(lsGet(WX_KEY) || "{}"); Object.keys(c).forEach((k) => { if(c[k] && Date.now() - c[k].at < 3 * 3600e3) WX[k] = c[k]; }); }catch(_e){}
const WX_WORDS = { 0: "Clear", 1: "Mostly clear", 2: "Partly cloudy", 3: "Overcast", 45: "Fog", 48: "Fog", 51: "Light drizzle", 53: "Drizzle", 55: "Heavy drizzle", 56: "Freezing drizzle", 57: "Freezing drizzle",
  61: "Light rain", 63: "Rain", 65: "Heavy rain", 66: "Freezing rain", 67: "Freezing rain", 71: "Light snow", 73: "Snow", 75: "Heavy snow", 77: "Snow grains", 80: "Showers", 81: "Showers", 82: "Heavy showers",
  85: "Snow showers", 86: "Snow showers", 95: "Thunderstorms", 96: "Thunderstorms, hail", 99: "Thunderstorms, hail" };
// The forecast for a place on a date: { t: "Light rain 18° / 12°" } once known, "" when out of range, null while loading
function weatherFor(w, iso){
  if(!w || w.lat == null || !iso) return "";
  const ahead = (Date.parse(iso + "T00:00:00Z") - Date.now()) / 864e5;
  if(!(ahead > -2 && ahead < 15.5)) return "";
  const k = w.lat + "," + w.lng + "," + iso, c = WX[k];
  if(c) return c.t;
  WX[k] = { t: null, at: Date.now() };
  WX[k].p = fetch("https://api.open-meteo.com/v1/forecast?daily=weather_code,temperature_2m_max,temperature_2m_min&timezone=auto&latitude=" + w.lat + "&longitude=" + w.lng + "&start_date=" + iso + "&end_date=" + iso)
    .then((r) => r.json()).then((j) => {
      const d = j && j.daily; let t = "";
      if(d && d.time && d.time.length){ const hi = d.temperature_2m_max[0], lo = d.temperature_2m_min[0]; t = (WX_WORDS[d.weather_code[0]] || "") + (hi != null ? " " + Math.round(hi) + "° / " + Math.round(lo) + "°" : ""); }
      WX[k] = { t: t.trim(), at: Date.now() };
      try{ const keep = {}; Object.keys(WX).forEach((x) => { if(WX[x].t != null) keep[x] = WX[x]; }); lsSet(WX_KEY, JSON.stringify(keep)); }catch(_e){}
      rerender();
    }).catch(() => { WX[k] = { t: "", at: Date.now() }; });
  return null;
}
// Sunrise / sunset at the day's place, "HH:MM" in that place's time zone
function sunFor(w, iso){ if(!w || w.lat == null || !iso) return null; const s = P.sunTimes(iso, w.lat, w.lng); return s ? { rise: P.hmIn(s.rise, w.tz), set: P.hmIn(s.set, w.tz) } : null; }
// What goes in a scene's "Special req. / equipment": the breakdown's booking categories
const REQ_CATS = ["stunts", "vehicles", "weapons", "sfx", "mfx", "vfx", "animals", "wrangler", "camera", "equipment", "security", "labor"];
const reqOf = (s) => REQ_CATS.filter((c) => s && s.needs && (s.needs[c] || []).length).map((c) => s.needs[c].join(", ")).join(", ");
const fmtMins = (m) => { m = Math.round(Number(m) || 0); return m >= 60 ? Math.floor(m / 60) + "h" + (m % 60 ? " " + String(m % 60).padStart(2, "0") : "") : m + "m"; };
function fmtTime(hm){
  const m = /^(\d{2}):(\d{2})$/.exec(hm || ""); if(!m) return hm || "";
  if(is24()) return hm;
  const h = +m[1]; return (h % 12 || 12) + ":" + m[2] + (h < 12 ? " am" : " pm");
}
// A time that can be left on Auto (lunch and wrap are worked out unless you set them)
function autoTimeSelect(val, attr, dis){
  const opts = []; for(let i = 0; i < 96; i++){ const h = Math.floor(i / 4), mm = (i % 4) * 15; opts.push(String(h).padStart(2, "0") + ":" + String(mm).padStart(2, "0")); }
  if(val && opts.indexOf(val) < 0){ opts.push(val); opts.sort(); }
  return `<select class="tSel" ${attr}${dis}><option value=""${val ? "" : " selected"}>Auto</option>${opts.map((t) => `<option value="${t}"${t === val ? " selected" : ""}>${fmtTime(t)}</option>`).join("")}</select>`;
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
const SHOTS_AT = {};
async function loadShots(id, force){
  const cur = S.shots[id];
  if(cur && !force && cur.state !== "error") return;
  if(cur && cur.state === "loading") return;
  SHOTS_AT[id] = Date.now();
  S.shots[id] = { state: "loading", map: cur && cur.map };
  try{
    const res = await H().ripGet({ action: "shotlistdata", fileId: id });
    if(!res || res.ok === false || !Array.isArray(res.shots)) throw new Error((res && res.error) || "Couldn't read the shot list.");
    const map = P.shotsBySceneId(res);
    S.shots[id] = { state: "ok", map };
    if(cur && cur.map && JSON.stringify(cur.map) !== JSON.stringify(map)) H().toast("Shot list updated. Scene times follow.", "ok", 2000);
  }catch(err){
    S.shots[id] = { state: "error", map: cur && cur.map, err: (err && err.message) || String(err) };
  }
  rerender();
  try{ if(window.CampBdPanel && window.CampBdPanel.refresh) window.CampBdPanel.refresh(); }catch(_e){}
}

// Shot times: a scene with shots in the shot list takes its time from them (shottime.js); an Est. typed on the breakdown
// sheet still wins, and a scene with no shots keeps the breakdown's own Est. ⚠ This feeds every day's times, Sync and the
// call sheets. Worked out each time from the breakdown and the shot list, never stored.
const WST = { bd: null, map: null, ck: "", out: null };
function withShotTimes(bd, shotMap, plan){
  const T = window.CampShotTime; if(!T || !bd || !Array.isArray(bd.scenes)) return bd;
  const ck = JSON.stringify((plan && plan.settings && plan.settings.shotTimes) || null);
  if(WST.bd === bd && WST.map === shotMap && WST.ck === ck) return WST.out;   // same breakdown and shots: same answer
  const kids = {}; (bd.cast || []).forEach((c) => { if(c && c.minor) kids[c.name] = 1; });
  const cfg = T.config(plan && plan.settings && plan.settings.shotTimes);
  const scenes = bd.scenes.map((s) => {
    const shots = (s.id && shotMap && shotMap[s.id]) || [];
    const sc = { id: s.id, ie: s.ie, dn: s.dn, eighths: s.eighths, cast: s.cast || [], est: s.est, estAuto: s.estAuto !== false,
      tags: T.sceneTags({ els: s.catEls || {}, bg: s.bg, minors: (s.cast || []).some((nm) => kids[nm]), env: s.env }) };
    const r = T.sceneMinutes(sc, shots, cfg), res = r.shots || (shots.length ? T.sceneShots(sc, shots, cfg) : null);
    return Object.assign({}, s, { estBd: s.est, est: r.min || s.est, estSrc: r.src, shotN: shots.length, shotTimed: shots.filter((x) => Number(x.min) > 0).length, shotRes: res });
  });
  const out = Object.assign({}, bd, { scenes });
  Object.assign(WST, { bd, map: shotMap, ck, out });
  return out;
}
// Each shot's estimated minutes by its Sheet key, for the shot list's EST. MIN column (sent with Sync). The estimate, not a
// number typed over it (the Sheet keeps those). null if the breakdown isn't ready.
async function shotMinutes(pid){
  try{
    const bd = await planBd(pid); if(!bd) return null;
    const hub = H(), p = hub.project(pid), ids = hub.scriptIds(p), plan = planOf(pid), sid = (plan.scriptId && ids.indexOf(plan.scriptId) >= 0) ? plan.scriptId : ids[0];
    const map = (S.shots[sid] && S.shots[sid].map) || {}, out = {};
    bd.scenes.forEach((s) => { const list = (s.id && map[s.id]) || [], res = s.shotRes; if(!res) return; list.forEach((sh, k) => { if(sh.key && res.shots[k]) out[sh.key] = res.shots[k].auto; }); });
    return out;
  }catch(_e){ return null; }
}
// The shot list for a script (read once, then from memory); the Breakdown tab shows the same shot times
function shotsFor(scriptId){ if(!scriptId) return {}; if(!S.shots[scriptId]) loadShots(scriptId); return (S.shots[scriptId] && S.shots[scriptId].map) || {}; }

// The shot list is edited in its Google Sheet, outside the hub: read it again when you come back to this tab
// (at most every 15 s) and after every Sync, so the stripboard's times follow what you typed there.
function refreshShots(){ const id = S.lastScriptId; if(id && Date.now() - (SHOTS_AT[id] || 0) > 15000) loadShots(id, true); }
document.addEventListener("visibilitychange", () => { if(document.visibilityState === "visible") refreshShots(); });
window.addEventListener("focus", refreshShots);

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
// The stripboard's day header: one "Elements" chip that opens the category chips
function needsChip(needs){
  const E = window.CampElements; if(!E || !needs) return "";
  const cats = needCats().filter((c) => (needs[c] || []).length); if(!cats.length) return "";
  const n = cats.reduce((a, c) => a + needs[c].length, 0);
  return `<details class="sbNeeds"><summary><span class="dots">${cats.slice(0, 6).map((c) => `<i style="--c:${E.CAT[c].color}"></i>`).join("")}</span>${n} element${n === 1 ? "" : "s"}<b>▾</b></summary>${needsRow(needs)}</details>`;
}
const PIN = `<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path fill="currentColor" d="M8 1.5a4.5 4.5 0 0 0-4.5 4.5c0 3.2 4.5 8.5 4.5 8.5s4.5-5.3 4.5-8.5A4.5 4.5 0 0 0 8 1.5zm0 6.3A1.8 1.8 0 1 1 8 4.2a1.8 1.8 0 0 1 0 3.6z"/></svg>`;
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
  const bdE = window.CampBdPanel && window.CampBdPanel.enriched ? window.CampBdPanel.enriched(pid, scriptId, p, sc.doc, sc.bd, sc.modified, aopts) : sc.bd;
  S.lastScriptId = scriptId;
  if(!S.shots[scriptId]) loadShots(scriptId);
  const shotMap = (S.shots[scriptId] && S.shots[scriptId].map) || {};
  const bd = withShotTimes(bdE, shotMap, plan);   // scenes with shots take their time from them
  const byId = P.sceneMap(bd); S.lastBd = bd; S.lastBdPid = pid;

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
      <span class="ctlUR"><button class="btn sm ico rf${sc.state === "loading" ? " spin" : ""}" type="button" data-a="reload" aria-label="Refresh" title="Refresh: re-read the latest script and storyboard shots into this view. Nothing is written to your Sheets (Sync does that)."><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/></svg></button>${canEdit ? `<button class="btn sm" type="button" data-a="undo" title="Undo (Ctrl+Z)"${hh.undo.length ? "" : " disabled"}>↶</button><button class="btn sm" type="button" data-a="redo" title="Redo (Ctrl+Shift+Z)"${hh.redo.length ? "" : " disabled"}>↷</button>` : ""}</span>
      <span class="ctlMore"><button class="btn sm" type="button" data-a="menu" aria-haspopup="menu" aria-expanded="${S.menu}" title="More">⋯</button>${S.menu ? `<div class="ctlMenu" role="menu">
        <button type="button" data-a="auto"${canEdit ? "" : " disabled"}>Auto-schedule<small>Put unscheduled scenes on days with room (pages, hours and days off)</small></button>
        <button type="button" data-a="reauto"${canEdit ? "" : " disabled"}>Re-plan all<small>Lay out every scene again, keeping cast days and company moves down</small></button>
        <button type="button" data-a="reload">Refresh script<small>Read the latest script and storyboard shots</small></button>
        ${S.popout ? "" : `<button type="button" data-a="pop">Pop out<small>Open the plan in its own window</small></button>`}
      </div>` : ""}</span></div>`;
  if(S.mode === "cs"){ box.innerHTML = head("", "") + `<div class="ctlBody">${csView(pid, p, raw, pl, dates, scriptId)}</div>`; wire(box, pid, { bd, scriptId }); return; }

  const dis = canEdit ? "" : " disabled";
  const scriptSel = ids.length > 1 ? `<label>Script<select data-s="script"${dis}>${ids.map((id) => `<option value="${esc(id)}"${id === scriptId ? " selected" : ""}>${esc(hub.scriptTitle(id))}</option>`).join("")}</select></label>` : "";
  const pageOpts = []; for(let e = 16; e <= 80; e += 4) pageOpts.push(e);
  if(pageOpts.indexOf(st.maxEighths) < 0) pageOpts.push(st.maxEighths), pageOpts.sort((a, b) => a - b);
  const phone = matchMedia("(max-width:760px)").matches;
  const settings = `<details class="setWrap"${(S.view === "strips" ? S.setOpen : (!phone || S.setOpen)) ? " open" : ""}><summary>Settings<span>${st.days} day${st.days === 1 ? "" : "s"} · ${st.perWeek}/wk · ${P.fmtEighths(st.maxEighths)} pg · ${st.maxHours}h/day</span></summary><div class="ctlSet">
      ${scriptSel}
      <label>Shoot days<span class="ctlStep"><button type="button" data-a="days-" aria-label="One fewer day"${dis}>−</button><input type="number" min="1" max="${P.MAX_DAYS}" value="${st.days}" data-s="days"${dis}><button type="button" data-a="days+" aria-label="One more day"${dis}>+</button></span></label>
      <label>First shoot day<input type="date" value="${esc(st.start)}" data-s="start"${dis}></label>
      <label>Shooting week<select data-s="perWeek"${dis}>${[[5, "5 days (Mon–Fri)"], [6, "6 days (Mon–Sat)"], [7, "7 days"]].map(([v, n]) => `<option value="${v}"${v === st.perWeek ? " selected" : ""}>${n}</option>`).join("")}</select></label>
      <label>Pages per day (limit)<select data-s="maxEighths"${dis}>${pageOpts.map((e) => `<option value="${e}"${e === st.maxEighths ? " selected" : ""}>${P.fmtEighths(e)}</option>`).join("")}</select></label>
      <label title="Call to wrap. Auto-schedule fills a day only up to this, and a longer day is flagged">Hours per day (limit)<select data-s="maxHours"${dis}>${[8, 9, 10, 11, 12, 13, 14].concat([8, 9, 10, 11, 12, 13, 14].indexOf(st.maxHours) < 0 ? [st.maxHours] : []).sort((a, b) => a - b).map((h) => `<option value="${h}"${h === st.maxHours ? " selected" : ""}>${h} hours</option>`).join("")}</select></label>
      <label>Default call<span class="ctlTime">${timeSelect(st.call, 'data-s="call"', dis)}<button type="button" class="btn sm h24${is24() ? " on" : ""}" data-a="h24" aria-pressed="${is24()}" title="Show times as 24-hour (this device)">24h</button></span></label>
      <label class="wide">Location<input type="text" data-s="where" value="${esc(st.where ? st.where.name : "")}" placeholder="City or address" maxlength="80"${dis} title="${st.where ? esc(st.where.label || st.where.name) + (st.where.lat == null ? " (not found: sunrise and weather need a place that can be found)" : "") : "Where you're shooting: gives each day's sunrise, sunset and forecast. A day can have its own."}"></label>
      ${(() => { const T = P.timeSettings(st); const f = (k, label, tip) => `<label title="${tip}">${label}<input type="number" min="0" max="${k === "mealBy" ? 12 : 600}" step="${k === "mealBy" ? 0.5 : 5}" data-t="${k}" value="${k === "mealBy" ? T[k] / 60 : T[k]}"${dis}></label>`;
        return `<details class="tmSet"${S.tmOpen ? " open" : ""}><summary>Day timing</summary><div class="tmRow">${f("prep", "First shot (min after call)", "Crew call to the first shot: lighting, rehearsal, makeup")}${f("turn", "Between setups (min)", "Reset time between one scene and the next")}${f("meal", "Meal (min)", "Length of the meal break; 0 = none")}${f("mealBy", "Meal within (hours)", "The meal starts no later than this many hours after call")}${f("move", "Company move (min)", "Added when the location changes; 0 = never")}</div></details>`; })()}
    </div></details>`;

  const hasDocs = hub.hasSheets(pid);
  const docsNudge = hasDocs === false ? `<div class="ctlDocs">No production docs yet.${hub.isOwner(p) ? ` <button class="btn sm" type="button" data-a="create">Create production docs…</button>` : " The owner can create them."}</div>` : "";
  const n = S.notice[pid];
  const sceneName = (id) => { const s = byId[id]; return s ? "Sc " + SN(s) : "a deleted scene"; };
  const notice = n ? `<div class="ctlNote"><div><b>The script changed</b><ul>
      ${n.added.length ? `<li>${n.added.length} new scene${n.added.length === 1 ? "" : "s"} (${n.added.map(sceneName).join(", ")}) ${n.added.length === 1 ? "is" : "are"} in Unscheduled.${canEdit ? ` <button class="btn sm" type="button" data-a="placeNew">Place on suggested days</button>` : ""}</li>` : ""}
      ${n.removed.length ? `<li>${n.removed.length} deleted scene${n.removed.length === 1 ? " was" : "s were"} taken off ${Array.from(new Set(n.removed.map((r) => "Day " + r.day))).join(", ")}.</li>` : ""}
      ${(n.moved || []).length ? `<li>${n.moved.length} scene${n.moved.length === 1 ? "" : "s"} from removed days ${n.moved.length === 1 ? "is" : "are"} back in Unscheduled.</li>` : ""}
    </ul></div><button class="iconBtn x" type="button" data-a="dismiss" aria-label="Dismiss">✕</button></div>` : "";
  const revBox = rec.changed.length ? `<div class="ctlNote rev"><div><b>Script revisions on scheduled days</b>${canEdit && rec.changed.length > 1 ? `<button class="btn sm" type="button" data-a="acceptAll">Accept all</button>` : ""}<ul>
      ${rec.changed.map((c) => `<li>Sc ${byId[c.id] ? esc(SN(byId[c.id])) : "?"} (Day ${c.day}): ${esc(revText(c))}${canEdit ? `<button class="btn sm" type="button" data-a="accept" data-id="${esc(c.id)}">Accept</button>` : ""}</li>`).join("")}
    </ul><div style="color:var(--uiMuted);margin-top:4px">Check each day still works, then accept. Call sheets update on the next Sync.</div></div></div>` : "";
  const warnBox = warns.length && S.warnOpen ? `<div class="ctlWarn">${warns.map((w) => `<div class="${w.level}">${w.level === "warn" ? "⚠ " : "• "}${esc(w.text)}</div>`).join("")}</div>` : "";

  const strip = (id, tr) => {
    const s = byId[id]; if(!s) return "";
    const stat = P.statusOf(pl, id);
    const isNew = n && n.added.indexOf(id) >= 0;
    const rv = revOf[id];
    return `<button class="strip${S.pick === id ? " pick" : ""}${isNew ? " new" : ""}${rv ? " rev" : ""}${S.landed && S.landed.id === id ? " landed" : ""}" type="button" data-sid="${esc(id)}" draggable="${canEdit}" style="--sc:${stripColor(s)}" title="${esc(s.heading)}">
      <div class="t">Sc ${esc(SN(s))} · ${esc(s.ie || "")} ${esc(DN[s.dn] || "")}${stat !== "Scheduled" ? `<em class="stat s-${stat.replace(/[^a-z]/gi, "").toLowerCase()}">${esc(stat)}</em>` : ""}<span>${shotMap[id] ? shotMap[id].length + " sh · " : ""}${P.fmtEighths(s.eighths)} pg</span></div>
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
          ${(() => { const w = P.whereOf(pl, i), sun = sunFor(w, dates[i]), wx = weatherFor(w, dates[i]);
            return `<div class="colSun"><button type="button" class="place${d.where ? " own" : ""}" data-a="dwhere" data-i="${i}"${dis} title="${w ? esc((w.label || w.name) + (d.where ? " (this day)" : " (the shoot's location)")) + ". Click to change this day's location" : "Set this day's location for sunrise, sunset and weather"}">${w ? esc(w.name) : "Set location"}</button>${sun ? `<span title="Sunrise · sunset at ${esc(w.name)}">☀ ${esc(fmtTime(sun.rise))} · ${esc(fmtTime(sun.set))}</span>` : w && w.lat != null && !dates[i] ? `<span>Set a date for sunrise</span>` : ""}${wx ? `<span class="wx" title="Forecast (Open-Meteo)">${esc(wx)}</span>` : ""}</div>`; })()}
          <div class="colTimes">
            <label>Call${timeSelect(d.call || st.call, 'data-call="' + i + '"', dis)}</label>
            <label title="Leave on Auto to let Camp place the lunch break">Lunch${autoTimeSelect(d.lunch || "", 'data-lunch="' + i + '"', dis)}</label>
            <label title="Leave on Auto to let Camp work out the wrap time">Wrap${autoTimeSelect(d.wrapAt || "", 'data-wrapat="' + i + '"', dis)}</label>
          </div>
          <div class="colCall">${times[i].wrap && !times[i].wrapManual ? `<span class="wrapT" title="Estimated wrap: ${fmtMins(times[i].est)} of shooting plus setups${times[i].rows.some((r) => r.type === "meal") ? ", the meal" : ""}${times[i].rows.some((r) => r.type === "move") ? " and company moves" : ""}">Est. wrap ${esc(fmtTime(times[i].wrap))}</span>` : ""}${x.locs.length ? `<span title="${esc(x.locs.join(", "))}">${x.locs.length} location${x.locs.length === 1 ? "" : "s"}</span>` : ""}</div></div>
        <div class="strips">${d.scenes.length ? dayRows(times[i]) : `<div class="colEmpty">${canEdit ? "Drag scenes here" : "No scenes"}</div>`}</div></div>`;
    })).join("");
  const dayTabs = `<div class="dayTabs" role="tablist" aria-label="Shoot days">
      <button type="button" role="tab" class="${tabDay === -1 ? "on" : ""}${unsched.length ? " warn" : ""}" data-a="dtab" data-i="-1" aria-selected="${tabDay === -1}">Unscheduled<i>${unsched.length}</i></button>
      ${pl.days.map((d, i) => `<button type="button" role="tab" class="${tabDay === i ? "on" : ""}${stats[i].over ? " over" : ""}" data-a="dtab" data-i="${i}" aria-selected="${tabDay === i}">Day ${i + 1}<small>${esc(fmtDate(dates[i]).replace(/^\w+,? /, "")) || "no date"}</small></button>`).join("")}
    </div>`;
  const moveBar = S.pick && byId[S.pick] && canEdit ? (() => {
    const cur = pl.days.findIndex((d) => d.scenes.indexOf(S.pick) >= 0), sug = cur < 0 ? P.suggestDay(S.pick, pl, bd) : -1;
    return `<div class="moveBar"><b>Sc ${esc(SN(byId[S.pick]))}</b> ${esc(byId[S.pick].heading)} → <select data-move="${esc(S.pick)}">
      <option value="-1"${cur < 0 ? " selected" : ""}>Unscheduled</option>
      ${pl.days.map((d, i) => `<option value="${i}"${i === cur ? " selected" : ""}>Day ${i + 1}${dates[i] ? " · " + esc(fmtDate(dates[i])) : ""} (${P.fmtEighths(stats[i].eighths)} pg)${i === sug ? " ★ suggested" : ""}</option>`).join("")}
      </select>
      <label class="stSel">Status <select data-status="${esc(S.pick)}">${P.STATUSES.map((x) => `<option${x === P.statusOf(pl, S.pick) ? " selected" : ""}>${x}</option>`).join("")}</select></label>
      <button class="btn sm" type="button" data-a="unpick">Done</button></div>`;
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
      ds.scenes.map((x) => x.shots.length ? x.shots.map((sh) => `<tr><td>${byId[x.id] ? esc(SN(byId[x.id])) : ""}</td><td>${esc(sh.shot)}</td><td>${esc(sh.size)}</td><td>${esc(sh.angle)}</td><td>${esc(sh.move)}</td><td class="desc">${esc(sh.desc)}</td><td class="st${sh.status === "Shot" ? " shot" : sh.status === "Needs reshoot" ? " reshoot" : ""}">${esc(sh.status || "Not shot")}</td></tr>`).join("")
        : `<tr><td>${byId[x.id] ? esc(SN(byId[x.id])) : ""}</td><td colspan="6" class="desc" style="color:var(--uiMuted)">No shots on the storyboard yet</td></tr>`).join("");
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
  if(S.view === "strips"){
    if(SB.pid !== pid){ SB.pid = pid; SB.sel = []; SB.anchor = null; }
    const sbHtml = sbView({ pid, pl, bd, byId, st, dates, stats, times, warns, shotMap, canEdit, rec, revOf, n, dood, shots, flagSec, castSec, locSec });
    box.innerHTML = head(chips, acts) + `<div class="ctlBody sbMode">${settings}${cal}${docsNudge}${notice}${revBox}${warnBox}${sbHtml}</div>`;
  }
  else box.innerHTML = head(chips, acts) + `<div class="ctlBody">${settings}${cal}${docsNudge}${notice}${revBox}${warnBox}${moveBar}${dayTabs}<div class="board">${cols}</div>${dood}${shots}${flagSec}${castSec}${locSec}</div>`;
  wire(box, pid, { bd, scriptId, plan: pl, dates });
}

/* ---------- the stripboard: one strip per scene, one place to plan the shoot ----------
   The same plan as before (projects/<pid>/production), so live sync, Sheets Sync and call sheets are unchanged.
   Each day: a header (date, place, call / lunch / wrap, totals), its strips in shoot order, then End of Day.
   Scenes with no day wait in Unscheduled at the bottom. Pick a strip up anywhere and drag it up or down (it stays in
   line with the others); select several (click, Shift, Ctrl/Cmd) to move them together. ⚠ Every move writes the shared plan. */
const SBP_KEY = "Camp_SB_PREFS_V1";
const SB = (() => { let v = {}; try{ v = JSON.parse(lsGet(SBP_KEY) || "{}") || {}; }catch(_e){} return { sec: "strips", q: "", ie: "", dn: "", cast: "", hi: "", bone: v.bone || "n", fold: {}, sel: [], anchor: null, landed: [], pid: null }; })();
{ const st2 = document.createElement("style"); st2.textContent = `.sbSecs{ display:flex; gap:2px; margin:12px 0 10px; border-bottom:1px solid var(--uiBorder); overflow-x:auto; scrollbar-width:none; }
.sbSecs button{ border:0; background:none; color:var(--uiMuted); font:inherit; font-size:13px; font-weight:600; padding:8px 12px; border-bottom:2px solid transparent; margin-bottom:-1px; cursor:pointer; white-space:nowrap; }
.sbSecs button.on{ color:var(--uiText); border-bottom-color:var(--uiText); }
.sbSec > details > summary{ display:none; }
.sbTools{ display:flex; flex-wrap:wrap; gap:6px; align-items:center; margin:0 0 10px; }
.sbTools select, .sbTools .sbQ{ height:32px; border-radius:8px; border:1px solid var(--uiBorder); background:#1d1d1d; color:var(--uiText); font:inherit; font-size:12.5px; padding:0 8px; }
.sbTools .sbQ{ flex:1 1 220px; min-width:160px; max-width:340px; }
.sbSp{ flex:1; }
.sbSelBar{ position:sticky; top:0; z-index:6; display:flex; flex-wrap:wrap; align-items:center; gap:8px 12px; padding:8px 12px; margin:0 0 10px; border-radius:10px; background:#1f2a3d; border:1px solid rgba(127,182,255,.45); font-size:12.5px; box-shadow:0 6px 18px rgba(0,0,0,.35); }
.sbSelBar > span{ color:var(--uiMuted); }
.sbSelBar label{ display:inline-flex; align-items:center; gap:6px; }
.sbSelBar select{ height:30px; border-radius:7px; border:1px solid var(--uiBorder); background:#171717; color:var(--uiText); font:inherit; font-size:12.5px; }
/* one grid for the header and every strip, so the columns line up */
.sbHead, .sbRow{ display:grid; grid-template-columns:16px 28px 34px minmax(0,1fr) 46px 48px 84px 64px; column-gap:12px; align-items:center; }
.sbHead{ padding:0 18px 4px 14px; font-size:10.5px; font-weight:700; letter-spacing:.06em; text-transform:uppercase; color:var(--uiMuted); }
/* words line up on the left, numbers on the right (pages and times by their last digit) */
.sbNo, .sbPg, .sbTm{ text-align:right; } .sbIE, .sbDN, .sbCast{ text-align:left; }
.sbDayWrap{ background:#1d1d1d; border:1px solid var(--uiBorder); border-radius:12px; margin:0 0 10px; }
.sbDayWrap.over{ border-color:rgba(255,139,131,.5); }
.sbDayWrap.sbDrop{ border-color:rgba(127,182,255,.6); }
.sbDay{ display:grid; grid-template-columns:minmax(0,1fr) auto; gap:6px 12px; padding:9px 12px 8px; border-bottom:1px solid var(--uiBorder); font-size:12px; }
.sbDayWrap.folded .sbDay{ border-bottom:0; }
.sbDayL, .sbDayR, .sbDayB{ display:flex; flex-wrap:wrap; align-items:center; gap:6px 10px; min-width:0; }
.sbDayR{ justify-content:flex-end; }
.sbDayB{ grid-column:1 / -1; }
.sbDayL, .sbDayR{ min-height:30px; }
.sbTimes{ display:inline-flex; align-items:center; height:30px; border:1px solid var(--uiBorder); border-radius:8px; background:#171717; }
.sbTimes .sbT{ height:100%; padding:0 2px 0 10px; gap:2px; }
.sbTimes .sbT + .sbT{ border-left:1px solid var(--uiBorder); }
.sbTimes .sbPick, .sbTimes .sbPick.t{ border:0; background:none; min-width:0; height:26px; padding:0 6px; gap:5px; }
.sbDayB .sbAddX, .sbDayB .sbT .sbPick{ height:30px; }
.sbNeeds{ position:relative; margin-left:auto; }
.sbNeeds summary{ list-style:none; display:inline-flex; align-items:center; gap:7px; height:30px; padding:0 10px; border:1px solid var(--uiBorder); border-radius:8px; cursor:pointer; color:var(--uiText); user-select:none; }
.sbNeeds summary::-webkit-details-marker{ display:none; }
.sbNeeds summary:hover{ border-color:rgba(255,255,255,.3); }
.sbNeeds summary b{ font-size:10px; color:var(--uiMuted); font-weight:400; }
.sbNeeds .dots{ display:inline-flex; }
.sbNeeds .dots i{ width:8px; height:8px; border-radius:50%; background:var(--c); border:1.5px solid #1d1d1d; margin-left:-3px; }
.sbNeeds .dots i:first-child{ margin-left:0; }
.sbNeeds[open] summary{ border-color:var(--focus, #7fb6ff); }
.sbNeeds .colNeeds{ position:absolute; right:0; top:calc(100% + 6px); z-index:30; width:max-content; max-width:340px; justify-content:flex-end; gap:5px; padding:8px; background:#232323; border:1px solid var(--uiBorder); border-radius:9px; box-shadow:0 10px 26px rgba(0,0,0,.45); }
.sbDay .place{ display:inline-flex; align-items:center; gap:5px; height:26px; }
.sbDay .place.empty{ width:26px; padding:0; justify-content:center; }
.sbDay .place svg{ flex:none; opacity:.8; }
.sbDay .place span{ overflow:hidden; text-overflow:ellipsis; }
.sbDay .sbDn{ font-size:13.5px; }
.sbDay .dtPick{ position:relative; display:inline-flex; align-items:center; padding:2px 8px; border-radius:6px; border:1px solid var(--uiBorder); cursor:pointer; color:var(--uiText); }
.sbDay .dtPick.pinned{ border-color:rgba(241,199,107,.6); }
.sbDay .dtPick input{ position:absolute; inset:0; opacity:0; width:100%; cursor:pointer; }
.sbDay .unpin{ border:0; background:none; color:var(--uiMuted); cursor:pointer; padding:0 2px; }
.sbTot{ display:inline-flex; align-items:center; gap:7px; color:var(--uiMuted); }
.sbTot .cap{ width:60px; height:5px; border-radius:3px; background:rgba(255,255,255,.12); overflow:hidden; display:inline-block; }
.sbTot .cap i{ display:block; height:100%; background:#8fe3b0; }
.sbDayWrap.over .sbTot .cap i{ background:#ff8b83; }
.sbDW{ padding:2px 8px; border-radius:999px; background:rgba(255,255,255,.08); font-weight:600; }
.sbDW.warn{ background:rgba(241,199,107,.15); color:#f1c76b; }
.sbDay .place{ border:1px solid var(--uiBorder); background:none; color:var(--uiText); font:inherit; font-size:12px; border-radius:6px; padding:2px 8px; cursor:pointer; max-width:220px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.sbDay .place:not(.own){ color:var(--uiMuted); }
.sbSun, .sbWx{ color:var(--uiMuted); }
.sbT{ display:inline-flex; align-items:center; gap:5px; color:var(--uiMuted); }
.sbT select.sbSort{ width:auto; max-width:130px; }
.sbT select{ height:26px; border-radius:6px; border:1px solid var(--uiBorder); background:#171717; color:var(--uiText); font:inherit; font-size:12px; }
.sbDayB .colNeeds{ margin:0; }
.sbFold{ border:1px solid var(--uiBorder); background:rgba(255,255,255,.04); color:var(--uiText); cursor:pointer; width:30px; height:30px; border-radius:7px; font-size:16px; line-height:1; padding:0; display:inline-flex; align-items:center; justify-content:center; flex:none; }
.sbFold:hover{ background:rgba(255,255,255,.1); border-color:rgba(255,255,255,.3); }
.sbRows{ padding:7px 7px 2px; display:flex; flex-direction:column; gap:6px; min-height:12px; }
.sbDayWrap.folded .sbRows{ padding:0; min-height:0; }
.sbRow{ position:relative; height:46px; box-sizing:border-box; padding:0 12px 0 6px; border:1px solid rgba(255,255,255,.08); border-left:5px solid var(--sc, #ddd); border-radius:8px; background:color-mix(in srgb, var(--sc, #ddd) 9%, #202020); color:#e6e6e6; font-size:12px; line-height:1.35; cursor:grab; user-select:none; -webkit-user-select:none; touch-action:pan-y; }
.sbRow:hover{ border-color:rgba(255,255,255,.22); border-left-color:var(--sc, #ddd); }
.sbRow:focus-visible{ outline:2px solid var(--focus, #7fb6ff); outline-offset:1px; }
.sbRow > span{ min-width:0; }
.sbGrip{ color:var(--uiMuted); opacity:.45; font-size:12px; letter-spacing:-2px; text-align:center; cursor:grab; touch-action:none; }
.sbRow:hover .sbGrip{ opacity:.9; }
.sbGrip.off{ visibility:hidden; }
.sbNo{ font-weight:800; font-variant-numeric:tabular-nums; }
.sbIE, .sbDN{ font-size:10.5px; font-weight:700; letter-spacing:.04em; color:#cfcfcf; }
/* every strip is the same height: the place on top, one line of description under it */
.sbMain{ display:flex; flex-direction:column; justify-content:center; gap:1px; overflow:hidden; min-width:0; }
.sbL1{ display:flex; align-items:center; gap:6px; min-width:0; }
.sbPlace{ font-weight:700; text-transform:uppercase; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; min-width:0; }
.sbSyn{ color:var(--uiMuted); font-size:11.5px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.sbSyn.none{ opacity:.45; font-style:italic; }
.sbPg{ font-variant-numeric:tabular-nums; font-weight:600; }
.sbCast{ font-weight:700; font-variant-numeric:tabular-nums; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.sbTm{ color:var(--uiMuted); font-variant-numeric:tabular-nums; white-space:nowrap; }
.sbTag, .sbStat{ flex:none; font-style:normal; font-size:9.5px; font-weight:700; text-transform:uppercase; letter-spacing:.04em; padding:1px 6px; border-radius:5px; background:rgba(255,255,255,.12); color:#fff; white-space:nowrap; }
.sbTag.rev{ background:rgba(241,199,107,.2); color:#f1c76b; } .sbTag.sh{ background:rgba(127,182,255,.16); color:#a9cbff; text-transform:none; } .sbTag.new{ background:rgba(143,227,166,.18); color:#8fe3a6; } .sbTag.warn{ background:rgba(255,139,131,.18); color:#ff8b83; }
.sbStat.s-shot{ background:#2f9e44; } .sbStat.s-partshot{ background:#f59f00; color:#111; } .sbStat.s-pickup{ background:#1c7ed6; } .sbStat.s-moved{ background:#868e96; } .sbStat.s-omitted{ background:#e03131; }
.sbRow.st-shot, .sbRow.st-omitted{ opacity:.55; } .sbRow.st-omitted .sbPlace{ text-decoration:line-through; }
.sbRow.sel{ background:color-mix(in srgb, var(--sc, #ddd) 24%, #262626); border-color:rgba(255,255,255,.4); border-left-color:var(--sc, #ddd); box-shadow:inset 0 0 0 1px rgba(255,255,255,.4); }
.sbRow.landed{ animation:sbLand 1s ease-out; }
@keyframes sbLand{ 0%{ box-shadow:0 0 0 2px #fff, 0 0 18px rgba(255,255,255,.4); } 100%{ box-shadow:none; } }
.sbBoard.hiOn .sbRow.dim{ opacity:.3; }
.sbBoard.hiOn .sbRow.hi{ box-shadow:0 0 0 2px #f1c76b; }
.sbRow.sbHide, .sbRow.sbSrc, .sbBan.sbSrc{ display:none; }
button.sbBan{ font-family:inherit; width:100%; cursor:pointer; color:var(--uiMuted); }
button.sbBan:hover:not(:disabled){ border-color:rgba(255,255,255,.35); color:var(--uiText); }
.sbBan.x-break{ background:rgba(127,182,255,.07); } .sbBan.x-move{ background:rgba(241,199,107,.06); } .sbBan.x-note{ background:rgba(255,255,255,.03); font-style:italic; }
.sbBan{ font-size:10.5px; color:var(--uiMuted); padding:3px 8px; border-radius:6px; border:1px dashed rgba(255,255,255,.18); text-align:center; }
.sbBan.meal{ background:rgba(127,182,255,.07); } .sbBan.move{ background:rgba(241,199,107,.06); } .sbBan.late{ color:#f1c76b; border-color:rgba(241,199,107,.45); }
.sbEnd{ display:flex; flex-wrap:wrap; gap:4px 10px; align-items:center; margin:4px 7px 7px; padding:5px 10px; border-radius:7px; background:rgba(0,0,0,.35); font-size:11px; color:var(--uiMuted); }
.sbEnd b{ color:var(--uiText); text-transform:uppercase; letter-spacing:.06em; font-size:10.5px; }
.sbEnd .over{ color:#ff8b83; font-weight:700; }
.sbDayWrap.folded .sbEnd{ display:none; }
.sbEmpty{ padding:10px; font-size:12px; color:var(--uiMuted); text-align:center; border:1px dashed rgba(255,255,255,.12); border-radius:8px; }
.sbBone{ border-style:dashed; }
/* the strip being moved floats in line with the board; a gap shows where it lands */
.sbGap{ border:2px dashed rgba(127,182,255,.8); border-radius:8px; background:rgba(127,182,255,.1); color:#a9cbff; font-size:11.5px; font-weight:600; display:flex; align-items:center; justify-content:center; }
.sbFloat{ position:fixed; z-index:9999; pointer-events:none; }
.sbFloat .sbRow{ cursor:grabbing; box-shadow:0 14px 34px rgba(0,0,0,.55); border-color:rgba(255,255,255,.35); transform:scale(1.01); outline:none; }
.sbFloat .sbRow + .sbRow{ margin-top:4px; }
.sbFloatMore{ margin-top:4px; padding:4px 10px; border-radius:7px; background:#26272b; color:var(--uiMuted); font-size:11px; box-shadow:0 14px 34px rgba(0,0,0,.55); }
.sbFloatN{ position:absolute; right:-6px; top:-10px; background:#7fb6ff; color:#0b1a30; font-size:11px; font-weight:800; padding:2px 8px; border-radius:999px; }
body.sbDragging, body.sbDragging *{ cursor:grabbing !important; user-select:none !important; }
.sbFiltNote{ margin:8px 0; font-size:12px; color:var(--uiMuted); display:flex; gap:8px; align-items:center; }
.sbOff{ text-align:center; font-size:11px; color:var(--uiMuted); margin:-4px 0 6px; letter-spacing:.03em; }
.sbXForm{ display:grid; grid-template-columns:repeat(4, auto); gap:8px 10px; align-items:end; padding:10px; border:1px solid rgba(127,182,255,.45); border-radius:8px; background:rgba(127,182,255,.06); font-size:12px; }
.sbXForm label{ display:flex; flex-direction:column; gap:4px; color:var(--uiMuted); }
.sbXForm label.wide{ grid-column:span 2; }
.sbXForm input{ height:30px; border-radius:7px; border:1px solid var(--uiBorder); background:#171717; color:var(--uiText); font:inherit; font-size:12.5px; padding:0 8px; }
.sbXForm input[type=number]{ width:80px; }
.sbXBtns{ grid-column:1 / -1; display:flex; gap:8px; }
.sbXHint{ grid-column:span 2; color:var(--uiMuted); font-size:11px; align-self:center; }
button.sbBan[data-bk]{ cursor:grab; position:relative; }
.sbBGrip{ position:absolute; left:6px; top:50%; transform:translateY(-50%); font-size:10px; }
button.sbBan[data-bk]:hover .sbBGrip{ opacity:.9; }
.sbFloat .sbBan{ background:#26272b; border-style:solid; box-shadow:0 14px 34px rgba(0,0,0,.55); }
.sbBan.meal.off{ background:none; border-style:dotted; opacity:.75; }
.sbAddX{ font-size:12px; }
/* the ⋯ menu on each strip (also right-click) */
.sbMore{ position:absolute; right:4px; top:50%; transform:translateY(-50%); width:26px; height:26px; border-radius:6px; border:1px solid rgba(255,255,255,.25); background:#26272b; color:var(--uiText); font:inherit; font-size:15px; line-height:1; cursor:pointer; opacity:0; display:flex; align-items:center; justify-content:center; }
.sbRow:hover .sbMore, .sbRow:focus-within .sbMore, .sbRow.sel .sbMore, .sbMore[aria-expanded="true"]{ opacity:1; }
@media (hover:none){ .sbMore{ opacity:.85; } .sbRow{ padding-right:36px; } }
.sbAddF{ padding:10px; border:1px solid rgba(127,182,255,.45); border-radius:8px; background:rgba(127,182,255,.06); font-size:12px; }
.sbAddL{ max-height:260px; overflow-y:auto; display:flex; flex-direction:column; gap:2px; margin:6px 0 8px; }
.sbAddL label{ display:grid; grid-template-columns:18px 34px minmax(0,1fr) 44px; gap:8px; align-items:center; padding:5px 6px; border-radius:6px; border-left:4px solid var(--sc,#ddd); background:color-mix(in srgb, var(--sc,#ddd) 8%, #1b1b1b); cursor:pointer; }
.sbAddL label:hover{ background:color-mix(in srgb, var(--sc,#ddd) 16%, #1d1d1d); }
.sbAddL b{ text-align:right; font-variant-numeric:tabular-nums; } .sbAddL .pl{ overflow:hidden; white-space:nowrap; text-overflow:ellipsis; text-transform:uppercase; font-weight:600; } .sbAddL .pg{ text-align:right; color:var(--uiMuted); }
.sbAddF .sbXBtns{ display:flex; gap:8px; align-items:center; }
/* the dropdown button (the real <select> stays hidden behind it) and its list, which always opens downwards */
.sbNative{ position:absolute !important; opacity:0 !important; pointer-events:none !important; width:1px !important; height:1px !important; overflow:hidden; }
.sbPick{ display:inline-flex; align-items:center; justify-content:space-between; gap:8px; height:28px; min-width:64px; max-width:220px; padding:0 8px 0 10px; border-radius:7px; border:1px solid var(--uiBorder); background:#171717; color:var(--uiText); font:inherit; font-size:12px; cursor:pointer; text-align:left; }
.sbPick span{ overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.sbPick i{ font-style:normal; font-size:10px; color:var(--uiMuted); }
.sbPick:hover:not(:disabled){ border-color:rgba(255,255,255,.3); }
.sbPick[aria-expanded="true"]{ border-color:var(--focus, #7fb6ff); }
.sbPick:disabled{ opacity:.55; cursor:default; }
.sbTools .sbPick, .sbSelBar .sbPick, .sbXForm .sbPick, .setWrap .sbPick{ height:32px; }
.sbPick.t{ min-width:86px; }
.sbMenu{ position:fixed; z-index:10001; overflow-y:auto; padding:4px; border-radius:10px; background:#1d1e22; border:1px solid rgba(255,255,255,.18); box-shadow:0 14px 34px rgba(0,0,0,.55); font:12.5px/1.2 Inter, system-ui, sans-serif; color:var(--uiText, #f2f2f2); }
.sbOpt{ padding:7px 10px; border-radius:6px; cursor:pointer; white-space:nowrap; }
.sbOpt:hover, .sbOpt.hl{ background:rgba(255,255,255,.09); }
.sbOpt.on{ background:rgba(127,182,255,.18); font-weight:600; }
.sbOpt.dis{ opacity:.4; cursor:default; }
#sbTip{ position:fixed; z-index:10000; max-width:320px; padding:7px 10px; border-radius:8px; background:#1d1e22; border:1px solid rgba(255,255,255,.2); box-shadow:0 8px 22px rgba(0,0,0,.5); color:#f2f0ec; font:12px/1.45 Inter, system-ui, sans-serif; white-space:pre-line; pointer-events:none; display:none; }
#sbTip.show{ display:block; }
#sbPrintCopy{ display:none; }
@media (max-width:760px){
  .sbHead, .sbRow{ grid-template-columns:14px 22px 30px minmax(0,1fr) 40px 40px; column-gap:7px; }
  .sbHead .sbCast, .sbHead .sbTm, .sbRow .sbTm, .sbRow .sbCast{ display:none; }
  .sbRow{ height:50px; }
  .sbXForm{ grid-template-columns:1fr 1fr; } .sbXForm label.wide{ grid-column:1 / -1; }
  .sbDay{ grid-template-columns:1fr; } .sbDayR{ justify-content:flex-start; }
  .sbGrip{ font-size:15px; opacity:.8; }
  .sbTools .sbQ{ max-width:none; }
}
@page{ size:A4 portrait; margin:10mm; }
@media print{
  html, body.sbPrint{ height:auto !important; overflow:visible !important; background:#fff !important; }
  body.sbPrint > *:not(#sbPrintCopy){ display:none !important; }
  body.sbPrint #sbPrintCopy{ display:block; position:static; width:auto; color:#000; font:10.5px/1.3 Inter, Arial, sans-serif; --uiMuted:#444; --uiText:#000; --uiBorder:#999; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
  #sbPrintCopy h1{ font-size:15px; margin:0 0 2px; } #sbPrintCopy .sbPrintDate{ font-size:10px; color:#555; margin-bottom:8px; }
  #sbPrintCopy .sbBoard{ display:block; }
  #sbPrintCopy .sbHead, #sbPrintCopy .sbRow{ grid-template-columns:24px 30px minmax(0,1fr) 28px 40px 64px 52px; column-gap:8px; }
  #sbPrintCopy .sbHead{ padding:0 8px 3px 6px; color:#000; border-bottom:1.5px solid #000; margin-bottom:4px; }
  #sbPrintCopy .sbGrip, #sbPrintCopy .sbDW, #sbPrintCopy .colNeeds, #sbPrintCopy .sbNeeds, #sbPrintCopy .place.empty, #sbPrintCopy .sbFold, #sbPrintCopy .unpin, #sbPrintCopy .sbAddX, #sbPrintCopy .sbMore, #sbPrintCopy .sbTot .cap, #sbPrintCopy .sbBone .sbDayR, #sbPrintCopy .sbBone .sbEmpty{ display:none !important; }
  #sbPrintCopy .sbDayWrap{ background:#fff; border:1px solid #666; border-radius:0; margin:0 0 8px; break-inside:auto; }
  #sbPrintCopy .sbDay{ break-after:avoid; padding:5px 8px; border-bottom:1px solid #666; color:#000; }
  #sbPrintCopy .sbDay .place, #sbPrintCopy .sbDay .dtPick{ border:0; padding:0; color:#000; background:none; height:auto; max-width:none; white-space:normal; }
  #sbPrintCopy .sbDayL, #sbPrintCopy .sbDayR, #sbPrintCopy .sbDayB{ min-height:0; gap:3px 10px; }
  #sbPrintCopy .sbDay .sbDn{ font-size:13px; }
  #sbPrintCopy .sbTimes{ border:0; background:none; height:auto; }
  #sbPrintCopy .sbTimes .sbT, #sbPrintCopy .sbT{ height:auto; padding:0 12px 0 0; color:#000; }
  #sbPrintCopy .sbT, #sbPrintCopy .sbTot, #sbPrintCopy .sbSun, #sbPrintCopy .sbWx, #sbPrintCopy .sbSyn, #sbPrintCopy .sbTm{ color:#000; }
  #sbPrintCopy .sbRows{ display:block; padding:4px 6px 2px; min-height:0; }
  #sbPrintCopy .sbRow{ height:auto; min-height:28px; padding:3px 8px 3px 4px; margin:0 0 3px; background:color-mix(in srgb, var(--sc) 35%, #fff) !important; color:#000; border:1px solid #999; border-left:5px solid var(--sc, #999); border-radius:2px; break-inside:avoid; outline:none !important; box-shadow:none !important; opacity:1 !important; }
  #sbPrintCopy .sbRow .sbMain{ overflow:visible; }
  #sbPrintCopy .sbPlace, #sbPrintCopy .sbSyn{ white-space:normal; overflow:visible; text-overflow:clip; }
  #sbPrintCopy .sbSyn.none{ display:none; }
  #sbPrintCopy .sbCast{ white-space:normal; overflow:visible; }
  #sbPrintCopy .sbIE, #sbPrintCopy .sbDN{ color:#000; }
  #sbPrintCopy .sbTag, #sbPrintCopy .sbStat{ background:#fff !important; color:#000 !important; border:1px solid #555; }
  #sbPrintCopy .sbBan{ border:1px dashed #666; color:#000; background:#f3f3f3 !important; break-inside:avoid; margin:0 0 3px; }
  #sbPrintCopy .sbOff{ color:#000; border:1px dashed #666; text-align:center; margin:0 0 8px; padding:2px; }
  #sbPrintCopy .sbEnd{ break-before:avoid; background:#e6e6e6 !important; color:#000; margin:3px 6px 6px; border-radius:0; }
  #sbPrintCopy .sbEnd b, #sbPrintCopy .sbEnd .over{ color:#000; }
}
`; document.head.appendChild(st2); }
// One tooltip for anything with data-tip on the plan (instant, multi-line; titles were slow and got lost on redraws)
(() => { let tip = null;
  const show = (el) => { const t = el && el.getAttribute("data-tip"); if(!t){ if(tip) tip.classList.remove("show"); return; }
    if(!tip){ tip = document.createElement("div"); tip.id = "sbTip"; tip.setAttribute("role", "tooltip"); document.body.appendChild(tip); }
    tip.textContent = t; tip.classList.add("show");
    const r = el.getBoundingClientRect(), w = tip.offsetWidth, h = tip.offsetHeight;
    let x = Math.min(Math.max(8, r.left + r.width / 2 - w / 2), innerWidth - w - 8), y = r.bottom + 8; if(y + h > innerHeight - 8) y = Math.max(8, r.top - h - 8);
    tip.style.left = x + "px"; tip.style.top = y + "px"; };
  document.addEventListener("mouseover", (e) => { if(SBD && SBD.on) return show(null); const el = e.target.closest && e.target.closest("#ctl [data-tip], .sbFloat [data-tip]"); show(el); });
  document.addEventListener("focusin", (e) => { const el = e.target.closest && e.target.closest("#ctl [data-tip]"); show(el); });
  document.addEventListener("scroll", () => show(null), true);
  document.addEventListener("pointerdown", () => show(null), true);
})();
const sbPrefs = () => lsSet(SBP_KEY, JSON.stringify({ bone: SB.bone }));
const SB_SECS = [["strips", "Stripboard"], ["dood", "Day Out of Days"], ["shots", "Shot list"], ["flags", "Script flags"], ["cast", "Cast"], ["locs", "Locations"]];
const IE_SHORT = (ie) => { const t = String(ie || "").toUpperCase(); return /INT/.test(t) && /EXT/.test(t) ? "I/E" : /EXT/.test(t) ? "EXT" : /INT/.test(t) ? "INT" : ""; };
const DN_SHORT = { D: "DAY", N: "NIGHT", M: "DUSK" };
// "INT. HOUSE - SUBURBAN BACKYARD - DAY" -> "HOUSE - SUBURBAN BACKYARD" (the place as the script writes it)
function placeOf(s){
  let h = String(s.heading || "").trim();
  h = h.replace(/^(?:INT\.?\s*\/\s*EXT\.?|EXT\.?\s*\/\s*INT\.?|I\s*\/\s*E\.?|INT\.?|EXT\.?)\s+/i, "");
  h = h.replace(/\s*[-–—]\s*(?:DAY|NIGHT|DAWN|DUSK|MORNING|EVENING|AFTERNOON|SUNSET|SUNRISE|LATER|CONTINUOUS|CONT'?D|SAME|SAME TIME|MOMENTS LATER|MAGIC HOUR)\b.*$/i, "");
  return h.trim() || s.set || s.loc || "";
}
const openDetails = (h) => String(h || "").replace(/<details([^>]*)>/, (m, a) => "<details" + a.replace(/\sopen\b/g, "") + " open>");
const BGRIP = `<span class="sbGrip sbBGrip" aria-hidden="true">⋮⋮</span>`;
const tipAttr = (t) => t ? ` data-tip="${esc(t)}" aria-label="${esc(t)}"` : "";
function sbView(c){
  const { pid, pl, bd, byId, st, dates, stats, times, warns, shotMap, canEdit, rec, revOf, n, dood, shots, flagSec, castSec, locSec } = c;
  const dis = canEdit ? "" : " disabled";
  const secTabs = `<div class="sbSecs" role="tablist" aria-label="Plan views">${SB_SECS.map(([v, l]) => `<button type="button" role="tab" class="${SB.sec === v ? "on" : ""}" data-sb="sec" data-v="${v}" aria-selected="${SB.sec === v}">${l}</button>`).join("")}</div>`;
  if(SB.sec !== "strips"){
    const body = SB.sec === "dood" ? dood : SB.sec === "shots" ? shots : SB.sec === "flags" ? flagSec : SB.sec === "cast" ? castSec : locSec;
    return secTabs + `<div class="sbSec">${openDetails(body) || `<div class="sbEmpty">Nothing here yet.</div>`}</div>`;
  }
  const kids = {}; (bd.cast || []).forEach((x) => { if(x.minor) kids[x.name] = 1; });
  // cast ID numbers: the breakdown's own (a scene's cast list runs in the same order as its sorted numbers)
  const noOf = {}; bd.scenes.forEach((x) => { if(x.castNo && x.cast && x.castNo.length === x.cast.length) x.cast.forEach((nm, k) => { if(noOf[nm] == null) noOf[nm] = x.castNo[k]; }); });
  const castOpts = (bd.cast || []).map((x, i) => ({ name: x.name, no: noOf[x.name] || i + 1 }));
  const F = { q: SB.q, ie: SB.ie, dn: SB.dn, cast: SB.cast };
  const fold = SB.fold[pid] = SB.fold[pid] || {};
  const sel = new Set(SB.sel), landed = new Set(SB.landed);
  let hidden = 0;
  const strip = (id, tr, day) => {
    const s = byId[id]; if(!s) return "";
    const ok = P.stripMatch(s, F); if(!ok) hidden++;
    const stat = P.statusOf(pl, id), rv = revOf[id], isNew = n && n.added.indexOf(id) >= 0;
    const ids = P.castIds(s, bd.cast), kidNight = s.dn === "N" && (s.cast || []).some((x) => kids[x]);
    const un = day >= 0 ? P.unavailOn(pl, s, dates[day]) : { cast: [], loc: "" }, unList = un.cast.concat(un.loc ? [un.loc] : []);
    const hiOn = SB.hi && (s.cast || []).indexOf(SB.hi) >= 0, nsh = shotMap[id] ? shotMap[id].length : 0;
    const cls = ["sbRow", sel.has(id) ? "sel" : "", landed.has(id) ? "landed" : "", ok ? "" : "sbHide", SB.hi ? (hiOn ? "hi" : "dim") : "", stat !== "Scheduled" ? "st-" + stat.replace(/[^a-z]/gi, "").toLowerCase() : ""].filter(Boolean).join(" ");
    const tags = (stat !== "Scheduled" ? `<em class="sbStat s-${stat.replace(/[^a-z]/gi, "").toLowerCase()}">${esc(stat)}</em>` : "")
      + (rv ? `<em class="sbTag rev"${tipAttr("Changed in the script since it was scheduled: " + revText(rv))}>Revised</em>` : "")
      + (isNew ? `<em class="sbTag new"${tipAttr("New in the script")}>New</em>` : "")
      + (s.estSrc === "shots" ? `<em class="sbTag sh"${tipAttr("Time from the shot list: " + s.shotN + " shot" + (s.shotN === 1 ? "" : "s") + " (" + s.shotTimed + " with EST. MIN typed, the rest suggested)" + (s.shotRes && s.shotRes.prep ? " plus " + s.shotRes.prep + " min prep" : "") + " = " + fmtMins(s.est) + (s.estBd ? ". The breakdown's estimate was " + fmtMins(s.estBd) : ""))}>${s.shotN} shot${s.shotN === 1 ? "" : "s"}</em>` : "")
      + (unList.length ? `<em class="sbTag warn"${tipAttr(unList.join(", ") + (unList.length === 1 ? " isn't" : " aren't") + " available on " + fmtDayShort(dates[day]) + ". Move the scene, or change the days off under Cast or Locations")}>⚠ Unavailable</em>` : "")
      + (kidNight ? `<em class="sbTag warn"${tipAttr("Night scene with a cast member under 18: check work-hour limits, permit and chaperone")}>⚠ Minor</em>` : "");
    return `<div class="${cls}" role="row" tabindex="0" data-sid="${esc(id)}" data-day="${day}" style="--sc:${stripColor(s)}" aria-selected="${sel.has(id)}" aria-label="${esc("Scene " + SN(s) + ", " + s.heading + ". Double-click for its breakdown sheet")}">
      ${canEdit ? `<span class="sbGrip"${tipAttr("Drag to move")} aria-hidden="true">⋮⋮</span>` : `<span class="sbGrip off"></span>`}
      <span class="sbNo">${esc(SN(s))}</span>
      <span class="sbIE">${esc(IE_SHORT(s.ie))}</span>
      <span class="sbMain"><span class="sbL1"><span class="sbPlace">${esc(placeOf(s))}</span>${tags}</span><span class="sbSyn${s.syn ? "" : " none"}">${s.syn ? esc(s.syn) : "No description yet"}</span></span>
      <span class="sbDN">${esc(DN_SHORT[s.dn] || "")}</span>
      <span class="sbPg">${P.fmtEighths(s.eighths)}</span>
      <span class="sbCast"${tipAttr((s.cast || []).length ? (s.cast || []).map((nm) => (noOf[nm] ? noOf[nm] + ". " : "") + nm).join(", ") : "No cast")}>${ids.length ? ids.join(", ") : "—"}</span>
      <span class="sbTm"${tipAttr((tr ? "Shoots about " + fmtTime(tr.shoot) + ", " + fmtMins(tr.est) + " of shooting" : "About " + fmtMins(P.estOf(s)) + " to shoot") + (s.estSrc === "shots" ? " (from " + s.shotN + " shot" + (s.shotN === 1 ? "" : "s") + ")" : s.estSrc === "manual" ? " (Est. typed on the breakdown sheet)" : " (breakdown estimate)"))}>${tr ? esc(fmtTime(tr.shoot)) : fmtMins(P.estOf(s))}</span>
      ${canEdit ? `<button type="button" class="sbMore" data-sb="more" data-sid="${esc(id)}" data-day="${day}" aria-haspopup="listbox" aria-expanded="false" aria-label="Move or unschedule Sc ${esc(SN(s))}">⋯</button>` : ""}
    </div>`;
  };
  const DAYMS = 864e5, fmtShort = (iso) => { try{ return new Date(iso + "T00:00:00Z").toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }); }catch(_e){ return iso; } };
  const offBefore = (i) => { if(!i || !dates[i] || !dates[i - 1]) return ""; const gap = Math.round((Date.parse(dates[i]) - Date.parse(dates[i - 1])) / DAYMS) - 1; if(gap < 1) return "";
    const a = new Date(Date.parse(dates[i - 1]) + DAYMS).toISOString().slice(0, 10), z = new Date(Date.parse(dates[i]) - DAYMS).toISOString().slice(0, 10);
    return `<div class="sbOff">${gap === 1 ? "Day off · " + esc(fmtShort(a)) : gap + " days off · " + esc(fmtShort(a)) + " – " + esc(fmtShort(z))}</div>`; };
  const days = pl.days.map((d, i) => {
    const x = stats[i], tt = times[i], pct = Math.min(100, Math.round(x.eighths / st.maxEighths * 100)), folded = !!fold[i];
    const w = P.whereOf(pl, i), sun = sunFor(w, dates[i]), wx = weatherFor(w, dates[i]), dw = warns.filter((y) => y.day === i + 1), bad = dw.some((y) => y.level === "warn");
    const rows = tt.rows.map((r) => r.type === "scene" ? strip(r.id, r, i)
      : r.type === "extra" ? (SB.xform && SB.xform.day === i && SB.xform.id === r.id ? xForm(i, d, r) : `<button type="button" class="sbBan x-${r.k}" data-sb="xedit"${canEdit ? ` data-bk="x"` : ""} data-day="${i}" data-id="${esc(r.id)}"${canEdit ? "" : " disabled"}${tipAttr((r.k === "note" ? "Note" : r.k === "move" ? "Company move" : "Break") + " added by hand" + (r.min ? ": " + fmtTime(r.start) + " – " + fmtTime(r.end) : "") + (canEdit ? ". Click to change or remove, drag to move" : ""))}>${canEdit ? BGRIP : ""}${r.k === "note" ? "Note · " : r.k === "move" ? "Company move · " : "Break · "}${esc(r.label || (r.k === "move" ? "Travel" : r.k === "break" ? "Break" : ""))}${r.min ? " · " + esc(fmtTime(r.start)) + " – " + esc(fmtTime(r.end)) : ""}</button>`)
      : r.type === "meal" ? (SB.mform === i ? mealForm(i, d, r, st) : `<button type="button" class="sbBan meal${r.late ? " late" : ""}" data-sb="meal"${canEdit ? ` data-bk="meal"` : ""} data-day="${i}"${canEdit ? "" : " disabled"}${tipAttr((r.late ? "More than six hours after call: a meal penalty may apply. " : "") + (r.pinned ? "Meal pinned after Sc " + (byId[d.mealAfter] ? SN(byId[d.mealAfter]) : "") : d.lunch ? "Meal set to " + fmtTime(d.lunch) : "Placed automatically") + (canEdit ? ". Click to change its time or length, or remove it. Drag to put it after another scene" : ""))}>${canEdit ? BGRIP : ""}Meal · ${esc(fmtTime(r.start))} – ${esc(fmtTime(r.end))}${r.pinned ? " · after Sc " + (byId[d.mealAfter] ? SN(byId[d.mealAfter]) : "") : d.lunch ? "" : " · auto"}</button>`)
      : canEdit ? `<button type="button" class="sbBan move" data-bk="amove" data-day="${i}" data-before="${esc(r.before || "")}" data-to="${esc(r.to)}"${tipAttr("Company move: " + r.from + " → " + r.to + ". Added automatically; drag to move it")}>${BGRIP}Company move to ${esc(r.to)} · ${r.min} min</button>`
      : `<div class="sbBan move"${tipAttr("Company move: " + r.from + " → " + r.to)}>Company move to ${esc(r.to)} · ${r.min} min</div>`).join("");
    return offBefore(i) + `<section class="sbDayWrap${x.over ? " over" : ""}${folded ? " folded" : ""}" data-day="${i}">
      <div class="sbDay">
        <div class="sbDayL">
          <button type="button" class="sbFold" data-sb="fold" data-i="${i}" aria-expanded="${!folded}"${tipAttr(folded ? "Show this day's strips" : "Hide this day's strips")}>${folded ? "▸" : "▾"}</button>
          <b class="sbDn">Day ${i + 1}</b>
          <label class="dtPick${d.date ? " pinned" : ""}"${tipAttr(d.date ? "Set to this date. Click to change it" : "Choose this day's date. The days after it follow on")}><span>${esc(fmtDate(dates[i]) || "Set date")}</span><input type="date" value="${esc(dates[i] || "")}" data-date="${i}"${dis}></label>${d.date && canEdit ? `<button type="button" class="unpin" data-a="unpin" data-day="${i}"${tipAttr("Unpin: follow on from the day before")}>✕</button>` : ""}
          <button type="button" class="place${d.where ? " own" : ""}${w ? "" : " empty"}" data-a="dwhere" data-i="${i}"${dis} aria-label="${esc(w ? "Location: " + (w.name || w.label) : "Add location")}"${tipAttr(w ? (w.label || w.name) + (d.where ? " (this day)" : " (the shoot's location)") + ". Click to change" : "Add this day's location for sunrise, sunset and weather")}>${PIN}${w ? `<span>${esc(w.name || w.label)}</span>` : ""}</button>
          ${sun ? `<span class="sbSun"${tipAttr("Sunrise – sunset")}>☀ ${esc(fmtTime(sun.rise))} – ${esc(fmtTime(sun.set))}</span>` : ""}${wx ? `<span class="sbWx">${esc(wx)}</span>` : ""}
        </div>
        <div class="sbDayR">
          <span class="sbTot"><span class="cap"${tipAttr(P.fmtEighths(x.eighths) + " of " + P.fmtEighths(st.maxEighths) + " pages (the daily limit in Settings)")}><i style="width:${pct}%"></i></span>${P.fmtEighths(x.eighths)} / ${P.fmtEighths(st.maxEighths)} pg · ${x.scenes} sc · ${x.cast.length} cast</span>
          ${dw.length ? `<span class="sbDW${bad ? " warn" : ""}"${tipAttr(dw.map((y) => "• " + y.text).join("\n"))} tabindex="0">${bad ? "⚠" : "ⓘ"} ${dw.length} ${bad ? "to check" : "note" + (dw.length === 1 ? "" : "s")}</span>` : ""}
        </div>
        <div class="sbDayB">
          <span class="sbTimes"><label class="sbT">Call${timeSelect(d.call || st.call, 'data-call="' + i + '"', dis)}</label>
          <label class="sbT"${tipAttr("Auto lets Camp place the meal break. No meal takes it off this day")}>Lunch${autoTimeSelect(d.lunch || "", 'data-lunch="' + i + '"', dis).replace('<option value=""', '<option value="none"' + (d.noMeal ? " selected" : "") + '>No meal</option><option value=""').replace(d.noMeal ? '<option value="" selected>' : '\u0000', '<option value="">')}</label>
          <label class="sbT"${tipAttr("Auto lets Camp work out the wrap")}>Wrap${autoTimeSelect(d.wrapAt || "", 'data-wrapat="' + i + '"', dis)}</label></span>
          ${canEdit && rec.unscheduled.length ? `<button type="button" class="btn sm sbAddX" data-sb="addsc" data-day="${i}"${tipAttr("Pick unscheduled scenes to add to the end of this day")}>＋ Add scenes</button>` : ""}
          ${canEdit ? `<button type="button" class="btn sm sbAddX" data-sb="xnew" data-day="${i}"${tipAttr("Add a break, a company move or a note to this day")}>＋ Break / move</button>` : ""}
          ${canEdit && d.scenes.length > 1 ? `<label class="sbT">Sort<select class="sbSort" data-sbsort="${i}" aria-label="Sort Day ${i + 1}"><option value="">…</option><option value="loc">By location</option><option value="dn">Day → night</option><option value="n">Scene number</option></select></label>` : ""}
          ${needsChip(x.needs)}
        </div>
      </div>
      <div class="sbRows" data-day="${i}">${SB.addTo === i && canEdit ? addForm(i, rec.unscheduled, byId) : ""}${!folded && d.noMeal && d.scenes.length ? `<button type="button" class="sbBan meal off" data-sb="mealback" data-day="${i}"${canEdit ? "" : " disabled"}${tipAttr("This day has no meal break. Click to put it back")}>No meal break · put it back</button>` : ""}${folded ? "" : (d.scenes.length || (d.extras || []).length ? rows : `<div class="sbEmpty">${canEdit ? "Drag scenes here" : "No scenes"}</div>`) + (SB.xform && SB.xform.day === i && !SB.xform.id ? xForm(i, d, null) : "")}</div>
      <div class="sbEnd"><b>End of Day ${i + 1}</b>${tt.wrap ? `<span>Wrap ${tt.wrapManual ? "" : "~"}${esc(fmtTime(tt.wrap))}</span>` : ""}${x.over ? `<span class="over">Over the page limit</span>` : ""}</div>
    </section>`;
  }).join("");
  const L2 = { D: 0, M: 1, N: 2 }, boneSort = { n: (a, b) => byId[a].n - byId[b].n, loc: (a, b) => String(placeOf(byId[a])).localeCompare(String(placeOf(byId[b]))) || byId[a].n - byId[b].n,
    dn: (a, b) => (L2[byId[a].dn] || 0) - (L2[byId[b].dn] || 0) || byId[a].n - byId[b].n, pg: (a, b) => byId[b].eighths - byId[a].eighths || byId[a].n - byId[b].n }[SB.bone] || ((a, b) => byId[a].n - byId[b].n);
  const un = rec.unscheduled.filter((id) => byId[id]).sort(boneSort);
  const bone = `<section class="sbDayWrap sbBone" data-day="-1"><div class="sbDay bone"><div class="sbDayL"><b class="sbDn">Unscheduled</b><span class="sbTot">${un.length} scene${un.length === 1 ? "" : "s"} · ${P.fmtEighths(un.reduce((a, id) => a + byId[id].eighths, 0))} pg</span></div>
      <div class="sbDayR"><label class="sbT">Order<select data-sbf="bone">${[["n", "Scene number"], ["loc", "Location"], ["dn", "Day → night"], ["pg", "Longest first"]].map(([v, l]) => `<option value="${v}"${SB.bone === v ? " selected" : ""}>${l}</option>`).join("")}</select></label>
      ${canEdit && un.length ? `<button type="button" class="btn sm" data-a="auto"${tipAttr("Put unscheduled scenes on days with room")}>Auto-schedule</button>` : ""}</div></div>
    <div class="sbRows" data-day="-1">${un.length ? un.map((id) => strip(id, null, -1)).join("") : `<div class="sbEmpty">Every scene has a day ✓${canEdit ? " Drag a strip here to take it off the schedule." : ""}</div>`}</div></section>`;
  const selIds = SB.sel.filter((id) => byId[id]);
  const selBar = canEdit && selIds.length ? `<div class="sbSelBar" role="region" aria-label="Selected scenes"><b>${selIds.length} selected</b><span>Sc ${selIds.slice().sort((a, b) => byId[a].n - byId[b].n).map((id) => esc(SN(byId[id]))).join(", ")} · ${P.fmtEighths(selIds.reduce((a, id) => a + byId[id].eighths, 0))} pg</span>
      <label>Move to<select data-sbmove="1"><option value="">Choose a day…</option><option value="-1">Unscheduled</option>${pl.days.map((d, i) => `<option value="${i}">Day ${i + 1}${dates[i] ? " · " + esc(fmtDate(dates[i])) : ""} (${P.fmtEighths(stats[i].eighths)} pg)</option>`).join("")}</select></label>
      ${selIds.length === 1 ? `<label>Status<select data-status="${esc(selIds[0])}">${P.STATUSES.map((x) => `<option${x === P.statusOf(pl, selIds[0]) ? " selected" : ""}>${x}</option>`).join("")}</select></label><button type="button" class="btn sm" data-sb="openbd" data-n="${byId[selIds[0]].n}">Breakdown sheet</button>` : ""}
      <span class="sbSp"></span><button type="button" class="btn sm" data-sb="clear">Clear</button></div>` : "";
  const tools = `<div class="sbTools">
      <input type="search" class="sbQ" data-sbq placeholder="Find a scene, place, cast or description" value="${esc(SB.q)}" aria-label="Find a scene">
      <select data-sbf="ie" aria-label="Interior or exterior"><option value="">INT + EXT</option><option value="INT"${SB.ie === "INT" ? " selected" : ""}>INT</option><option value="EXT"${SB.ie === "EXT" ? " selected" : ""}>EXT</option></select>
      <select data-sbf="dn" aria-label="Day or night"><option value="">Day + night</option><option value="D"${SB.dn === "D" ? " selected" : ""}>Day</option><option value="M"${SB.dn === "M" ? " selected" : ""}>Dawn / dusk</option><option value="N"${SB.dn === "N" ? " selected" : ""}>Night</option></select>
      <select data-sbf="cast" aria-label="Only scenes with"><option value="">Any cast</option>${castOpts.map((o) => `<option value="${esc(o.name)}"${SB.cast === o.name ? " selected" : ""}>Only ${esc(o.name)}</option>`).join("")}</select>
      <select data-sbf="hi" aria-label="Highlight a cast member"><option value="">Highlight cast…</option>${castOpts.map((o) => `<option value="${esc(o.name)}"${SB.hi === o.name ? " selected" : ""}>${o.no}. ${esc(o.name)}</option>`).join("")}</select>
      <span class="sbSp"></span>
      <button type="button" class="btn sm" data-sb="foldall">${Object.keys(fold).some((k) => fold[k]) ? "Unfold all" : "Fold all"}</button>
      <button type="button" class="btn sm" data-sb="print"${tipAttr("Print the stripboard, or save it as a PDF")}>Print</button>
    </div>`;
  const colHead = `<div class="sbHead" aria-hidden="true"><span class="sbGrip"></span><span class="sbNo">Sc</span><span class="sbIE">I/E</span><span class="sbMain">Location · description</span><span class="sbDN">D/N</span><span class="sbPg">Pgs</span><span class="sbCast">Cast</span><span class="sbTm">Time</span></div>`;
  const filt = SB.q || SB.ie || SB.dn || SB.cast;
  return secTabs + tools + selBar + `<div class="sbBoard${SB.hi ? " hiOn" : ""}" role="grid" aria-label="Stripboard">${colHead}${days}${bone}</div>`
    + (filt ? `<div class="sbFiltNote">${hidden} strip${hidden === 1 ? "" : "s"} hidden by the filters. <button type="button" class="btn sm" data-sb="unfilter">Show all</button></div>` : "");
}
// The meal's own form: when (Auto or a time), how long, or no meal at all this day
function mealForm(i, d, r, st){
  const T = P.timeSettings(st), len = d.mealMin > 0 ? d.mealMin : T.meal;
  return `<div class="sbXForm meal" data-day="${i}">
    <label>Starts${autoTimeSelect(d.lunch || "", 'data-mf="at"', "")}</label>
    <label>Minutes<input type="number" min="5" max="240" step="5" data-mf="min" value="${len}"></label>
    <span class="sbXHint">Auto places it before the scene that would run past ${Math.round(T.mealBy / 60 * 10) / 10} hours from call. Length ${T.meal} min unless set here.</span>
    ${d.mealAfter ? `<span class="sbXHint">Pinned after a scene (dragged there). Choosing a start time replaces the pin.</span>` : ""}
    <span class="sbXBtns"><button type="button" class="btn sm danger" data-sb="mealdel">No meal this day</button>${d.mealAfter ? `<button type="button" class="btn sm" data-sb="mealunpin">Back to auto</button>` : ""}<span class="sbSp"></span><button type="button" class="btn sm" data-sb="mealcancel">Cancel</button><button type="button" class="btn sm primary" data-sb="mealsave">Save</button></span>
  </div>`;
}
function mealSave(pid, mode){
  const i = SB.mform; if(i == null) return;
  const box = document.querySelector('#ctl .sbXForm.meal[data-day="' + i + '"]'), val = (k) => { const el = box && box.querySelector('[data-mf="' + k + '"]'); return el ? el.value : ""; };
  const plan = planOf(pid), d = plan.days[i]; SB.mform = null; if(!d){ rerender(); return; }
  if(mode === "del"){ d.noMeal = true; delete d.lunch; delete d.mealMin; delete d.mealAfter; }
  else if(mode === "unpin"){ delete d.mealAfter; delete d.lunch; }
  else if(mode === "back"){ delete d.noMeal; }
  else{
    delete d.noMeal;
    const at = val("at"); if(at){ d.lunch = at; delete d.mealAfter; } else delete d.lunch;
    const T = P.timeSettings(plan.settings), m = Math.round(Number(val("min")) || 0);
    if(m && m !== T.meal) d.mealMin = Math.max(5, Math.min(240, m)); else delete d.mealMin;
  }
  save(pid, plan); rerender();
  H().toast(mode === "del" ? "Day " + (i + 1) + " has no meal break now. Undo puts it back." : mode === "back" ? "Meal break back on Day " + (i + 1) + "." : mode === "unpin" ? "Meal placed automatically again." : "Meal updated.", "ok", 1800);
}
// The form for a break, company move or note added by hand (new, or editing one)
function xForm(i, d, r){
  const x = r ? ((d.extras || []).find((y) => y.id === r.id) || {}) : { k: "break", min: 15, label: "", after: d.scenes[d.scenes.length - 1] || "" };
  const byId = S.lastBd ? P.sceneMap(S.lastBd) : {};
  const where = [["", "Start of the day"]].concat(d.scenes.filter((id) => byId[id]).map((id) => [id, "After Sc " + SN(byId[id]) + " · " + placeOf(byId[id])]));
  return `<div class="sbXForm" data-day="${i}">
    <label>Type<select data-xf="k"><option value="break"${x.k === "break" ? " selected" : ""}>Break</option><option value="move"${x.k === "move" ? " selected" : ""}>Company move</option><option value="note"${x.k === "note" ? " selected" : ""}>Note (no time)</option></select></label>
    <label>Minutes<input type="number" min="0" max="600" step="5" data-xf="min" value="${x.k === "note" ? 0 : (x.min == null ? 15 : x.min)}"${x.k === "note" ? " disabled" : ""}></label>
    <label class="wide">Label<input type="text" maxlength="60" data-xf="label" value="${esc(x.label || "")}" placeholder="${x.k === "move" ? "e.g. Travel to the farm" : x.k === "note" ? "e.g. Safety meeting" : "e.g. Camera reset"}"></label>
    <label class="wide">Where<select data-xf="after">${where.map(([v, l]) => `<option value="${esc(v)}"${v === (x.after || "") ? " selected" : ""}>${esc(l)}</option>`).join("")}</select></label>
    <span class="sbXBtns">${r ? `<button type="button" class="btn sm danger" data-sb="xdel">Remove</button>` : ""}<span class="sbSp"></span><button type="button" class="btn sm" data-sb="xcancel">Cancel</button><button type="button" class="btn sm primary" data-sb="xsave">${r ? "Save" : "Add"}</button></span>
  </div>`;
}
function xSave(pid, del){
  const f = SB.xform; if(!f) return;
  const box = document.querySelector('#ctl .sbXForm[data-day="' + f.day + '"]'), val = (k) => { const el = box && box.querySelector('[data-xf="' + k + '"]'); return el ? el.value : ""; };
  const plan = planOf(pid), d = plan.days[f.day]; if(!d){ SB.xform = null; rerender(); return; }
  let list = (d.extras || []).slice();
  if(del){ const gone = list.find((y) => y.id === f.id); list = list.filter((y) => y.id !== f.id); if(gone && gone.k === "move") delete d.noMove; }   // automatic moves come back
  else{
    const k = val("k"), item = { id: f.id || ("x" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5)), k, min: k === "note" ? 0 : Math.max(0, Math.min(600, Math.round(Number(val("min")) || 0))), label: val("label").trim().slice(0, 60), after: val("after") };
    if(k === "note" && !item.label){ H().toast("Give the note some words.", "err", 1800); return; }
    const at = list.findIndex((y) => y.id === item.id); if(at >= 0) list[at] = item; else list.push(item);
  }
  d.extras = P.cleanExtras(list); if(!d.extras.length) delete d.extras;
  SB.xform = null; save(pid, plan); rerender();
  H().toast(del ? "Removed. Undo puts it back." : (f.id ? "Saved." : "Added to Day " + (f.day + 1) + "."), "ok", 1600);
}
// "+ Add scenes": tick unscheduled scenes and add them to the end of a day
function addForm(i, un, byId){
  const ids = un.filter((id) => byId[id]).sort((a, b) => byId[a].n - byId[b].n);
  return `<div class="sbAddF" data-day="${i}"><b>Add to the end of Day ${i + 1}</b><div class="sbAddL">${ids.map((id) => { const s = byId[id];
    return `<label style="--sc:${stripColor(s)}"><input type="checkbox" data-af="${esc(id)}"><b>${esc(SN(s))}</b><span class="pl">${esc(IE_SHORT(s.ie))} ${esc(placeOf(s))}</span><span class="pg">${P.fmtEighths(s.eighths)}</span></label>`; }).join("")}</div>
    <span class="sbXBtns"><span class="sbAddN">0 ticked</span><span class="sbSp"></span><button type="button" class="btn sm" data-sb="addcancel">Cancel</button><button type="button" class="btn sm primary" data-sb="addgo">Add</button></span></div>`;
}
// The ⋯ menu (or right-click) on a strip: unschedule, or send it (or the selected strips) to a day.
// It reuses the dropdown list: a select that never joins the page drives it.
function sbActMenu(pid, btn){
  if(SBM.btn === btn){ sbMenuClose(); return; }
  const id = btn.dataset.sid, day = Number(btn.dataset.day), plan = planOf(pid), byId = S.lastBd ? P.sceneMap(S.lastBd) : {};
  const ord = sbOrder(document.getElementById("ctl")), ids = SB.sel.length > 1 && SB.sel.indexOf(id) >= 0 ? ord.filter((x) => SB.sel.indexOf(x) >= 0) : [id];
  const dates = P.planDates(plan), what = ids.length > 1 ? ids.length + " scenes" : "Sc " + (byId[id] ? SN(byId[id]) : "");
  const opts = [["", what, true], ["bd", "Open breakdown sheet", ids.length > 1]];
  if(day >= 0) opts.push(["un", "Unschedule"]);
  plan.days.forEach((d, k) => { if(k !== day) opts.push(["end:" + k, "→ Day " + (k + 1) + (dates[k] ? " · " + fmtDate(dates[k]) : "")]); });
  const sel = document.createElement("select");
  sel.innerHTML = opts.map(([v, l, off]) => `<option value="${esc(v)}"${off ? " disabled" : ""}>${esc(l)}</option>`).join("");
  sel.selectedIndex = 0;
  sel.addEventListener("change", () => {
    const v = sel.value; if(!v) return;
    if(v === "bd"){ const s = byId[id]; if(s && window.CampBdPanel && window.CampBdPanel.openScene) window.CampBdPanel.openScene(s.n, s.id); return; }
    sbSetSel([], null);
    if(v === "un"){ sbMove(pid, ids, -1, null); return; }
    const [k, n] = v.split(":"), to = Number(n), p2 = planOf(pid);
    const first = k === "top" ? ((p2.days[to] && p2.days[to].scenes) || []).find((x) => ids.indexOf(x) < 0) || null : null;
    sbMove(pid, ids, to, first);
  });
  sbMenuOpen(btn, sel);
}
// Visible strips in board order (for Shift-select ranges and drags)
function sbOrder(box){ return Array.from(box.querySelectorAll(".sbRow:not(.sbHide)")).map((r) => r.dataset.sid); }
function sbSetSel(ids, anchor){ SB.sel = ids.filter((x, i, a) => a.indexOf(x) === i); if(anchor !== undefined) SB.anchor = anchor; }
function sbMove(pid, ids, toDay, beforeId){
  if(!ids.length) return;
  const { plan, from } = P.moveManyIn(planOf(pid), ids, toDay, beforeId);
  save(pid, plan);
  SB.landed = ids.slice(); clearTimeout(sbMove.t); sbMove.t = setTimeout(() => { SB.landed = []; rerender(); }, 1100);
  const byId = S.lastBd ? P.sceneMap(S.lastBd) : {}, what = ids.length === 1 ? "Sc " + (byId[ids[0]] ? SN(byId[ids[0]]) : "") : ids.length + " scenes";
  if(toDay < 0) H().toast(what + " moved to Unscheduled", "ok", 1800);
  else{ const stt = S.lastBd ? P.dayStats(plan.days[toDay], byId, plan.settings.maxEighths) : null;
    H().toast(what + (ids.every((id) => from[id] === toDay) ? " reordered on Day " : " → Day ") + (toDay + 1) + (stt ? " · " + P.fmtEighths(stt.eighths) + " / " + P.fmtEighths(plan.settings.maxEighths) + " pg" + (stt.over ? " ⚠ over the limit" : "") : ""), stt && stt.over ? "err" : "ok", 2000); }
  rerender();
}
function sbPrint(){
  const src = document.querySelector("#ctl .sbBoard"); if(!src) return;
  const old = document.getElementById("sbPrintCopy"); if(old) old.remove();
  const c = document.createElement("div"); c.id = "sbPrintCopy";
  const title = (S.lastScriptId && H().scriptTitle(S.lastScriptId)) || "Stripboard";
  c.innerHTML = `<h1>${esc(title)} · Stripboard</h1><div class="sbPrintDate">${esc(new Date().toLocaleDateString())}</div>` + src.outerHTML;
  c.querySelectorAll(".sbAddF, button.sbMore, select, input, button.sbFold, button.unpin").forEach((x) => { if(x.classList.contains("sbSort")){ const l = x.closest("label"); (l || x).remove(); return; } if(x.tagName === "SELECT"){ const t = document.createElement("span"); t.textContent = x.options[x.selectedIndex] ? x.options[x.selectedIndex].text : ""; x.replaceWith(t); } else x.remove(); });
  document.body.appendChild(c); document.body.classList.add("sbPrint");
  const done = () => { document.body.classList.remove("sbPrint"); c.remove(); window.removeEventListener("afterprint", done); };
  window.addEventListener("afterprint", done);
  setTimeout(() => { window.print(); setTimeout(() => { if(document.body.classList.contains("sbPrint")) done(); }, 1500); }, 50);
}
// Clicks on the stripboard. Returns true when it handled the click.
function sbClick(e, pid, canEdit){
  if(SBD.justDropped){ SBD.justDropped = false; return true; }   // the click that ends a drag
  const a = e.target.closest("[data-sb]");
  if(a){
    const k = a.dataset.sb;
    if(k === "sec"){ SB.sec = a.dataset.v; render(pid); return true; }
    if(k === "fold"){ const f = SB.fold[pid] = SB.fold[pid] || {}, i = a.dataset.i; f[i] = !f[i]; render(pid); return true; }
    if(k === "foldall"){ const f = SB.fold[pid] = SB.fold[pid] || {}, any = Object.keys(f).some((x) => f[x]); SB.fold[pid] = {}; if(!any) planOf(pid).days.forEach((d, i) => { SB.fold[pid][i] = true; }); render(pid); return true; }
    if(k === "clear"){ sbSetSel([], null); render(pid); return true; }
    if(k === "unfilter"){ SB.q = ""; SB.ie = ""; SB.dn = ""; SB.cast = ""; render(pid); return true; }
    if(k === "print"){ sbPrint(); return true; }
    if(k === "meal"){ if(!canEdit) return true; SB.mform = Number(a.dataset.day); SB.xform = null; render(pid); return true; }
    if(k === "mealcancel"){ SB.mform = null; render(pid); return true; }
    if(k === "mealsave" || k === "mealdel" || k === "mealunpin"){ if(canEdit) mealSave(pid, k === "mealdel" ? "del" : k === "mealunpin" ? "unpin" : "save"); return true; }
    if(k === "mealback"){ if(canEdit){ SB.mform = Number(a.dataset.day); mealSave(pid, "back"); } return true; }
    if(k === "xnew"){ SB.xform = { day: Number(a.dataset.day), id: "" }; if(SB.fold[pid]) SB.fold[pid][a.dataset.day] = false; render(pid); return true; }
    if(k === "xedit"){ if(!canEdit) return true; SB.xform = { day: Number(a.dataset.day), id: a.dataset.id }; render(pid); return true; }
    if(k === "xcancel"){ SB.xform = null; render(pid); return true; }
    if(k === "xsave" || k === "xdel"){ if(canEdit) xSave(pid, k === "xdel"); return true; }
    if(k === "more"){ if(canEdit) sbActMenu(pid, a); return true; }
    if(k === "addsc"){ SB.addTo = SB.addTo === Number(a.dataset.day) ? null : Number(a.dataset.day); SB.xform = null; if(SB.fold[pid]) SB.fold[pid][a.dataset.day] = false; render(pid); return true; }
    if(k === "addcancel"){ SB.addTo = null; render(pid); return true; }
    if(k === "addgo"){ if(!canEdit) return true; const f = a.closest(".sbAddF"), ids = Array.from(f.querySelectorAll("[data-af]:checked")).map((x) => x.dataset.af);
      if(!ids.length){ H().toast("Tick the scenes to add.", "err", 1600); return true; }
      const i = Number(f.dataset.day); SB.addTo = null; sbMove(pid, ids, i, null); return true; }
    if(k === "openbd"){ try{ if(window.CampBdPanel && window.CampBdPanel.openScene) window.CampBdPanel.openScene(Number(a.dataset.n), SB.sel[0] || null); }catch(_e){} return true; }
    return true;
  }
  const row = e.target.closest(".sbRow");
  if(!row || !canEdit || e.target.closest("[data-a], select, input, label")) return false;
  const id = row.dataset.sid;
  if(e.shiftKey && SB.anchor){ const ord = sbOrder(document.getElementById("ctl")), i = ord.indexOf(SB.anchor), j = ord.indexOf(id); if(i >= 0 && j >= 0){ sbSetSel(SB.sel.concat(ord.slice(Math.min(i, j), Math.max(i, j) + 1))); render(pid); return true; } }
  if(e.ctrlKey || e.metaKey){ sbSetSel(SB.sel.indexOf(id) >= 0 ? SB.sel.filter((x) => x !== id) : SB.sel.concat([id]), id); render(pid); return true; }
  sbSetSel(SB.sel.length === 1 && SB.sel[0] === id ? [] : [id], id); render(pid); return true;
}
function sbChange(e, pid, canEdit){
  const t = e.target;
  if(t.dataset.mf) return true;   // the meal form saves on Save
  if(t.dataset.af != null){ const f = t.closest(".sbAddF"), n = f.querySelectorAll("[data-af]:checked").length, l = f.querySelector(".sbAddN"); if(l) l.textContent = n + " ticked"; return true; }
  if(t.dataset.xf){ if(t.dataset.xf === "k"){ const m = t.closest(".sbXForm").querySelector('[data-xf="min"]'); if(m){ m.disabled = t.value === "note"; if(t.value === "note") m.value = 0; else if(!Number(m.value)) m.value = t.value === "move" ? 30 : 15; } } return true; }
  if(t.dataset.sbf){ const k = t.dataset.sbf; if(k === "bone"){ SB.bone = t.value; sbPrefs(); } else SB[k] = t.value; render(pid); return true; }
  if(!canEdit) return false;
  if(t.dataset.sbmove){ if(t.value === "") return true; const ord = sbOrder(document.getElementById("ctl")), ids = SB.sel.slice().sort((a, b) => { const i = ord.indexOf(a), j = ord.indexOf(b); return (i < 0 ? 1e9 : i) - (j < 0 ? 1e9 : j); }); sbSetSel([], null); sbMove(pid, ids, Number(t.value), null); return true; }
  if(t.dataset.sbsort != null){ const by = t.value; if(!by) return true; const i = Number(t.dataset.sbsort), plan = planOf(pid); P.sortDay(plan, i, by, S.lastBd ? P.sceneMap(S.lastBd) : {}); save(pid, plan); H().toast("Day " + (i + 1) + " sorted " + (by === "loc" ? "by location" : by === "dn" ? "day to night" : "by scene number") + ". Undo puts it back.", "ok", 2200); rerender(); return true; }
  return false;
}
/* ---------- dragging strips: up and down only ----------
   Mouse: press anywhere on a strip and move. Touch: hold the ⋮⋮ grip (the rest of the strip scrolls the page).
   The picked-up strip (or the selected strips) floats in line with the board and a gap opens where it will land.
   Esc cancels. Alt+↑ / Alt+↓ moves the focused strip one place with the keyboard. */
const SBD = { on: false, justDropped: false };
function sbDragStart(box, pid, row, e){
  const ban = row.classList.contains("sbBan") ? { k: row.dataset.bk, day: Number(row.dataset.day), id: row.dataset.id || "", before: row.dataset.before || "", to: row.dataset.to || "" } : null;
  const ord = sbOrder(box), id = row.dataset.sid;
  const ids = ban ? [] : SB.sel.indexOf(id) >= 0 ? ord.filter((x) => SB.sel.indexOf(x) >= 0) : [id];
  const board = box.querySelector(".sbBoard"), scroller = box.querySelector(".ctlBody") || document.scrollingElement;
  const br = board.getBoundingClientRect(), rr = row.getBoundingClientRect();
  const float = document.createElement("div"); float.className = "sbFloat"; float.style.left = rr.left + "px"; float.style.width = rr.width + "px";   // exactly over the strip: it only moves up and down
  const SHOW = 6, rowsHtml = ban || ids.length < 2 ? row.outerHTML : ids.slice(0, SHOW).map((x) => { const el = box.querySelector('.sbRow[data-sid="' + CSS.escape(x) + '"]'); return el ? el.outerHTML : ""; }).join("");
  float.innerHTML = rowsHtml + (ids.length > SHOW ? `<div class="sbFloatMore">+ ${ids.length - SHOW} more</div>` : "") + (ids.length > 1 ? `<span class="sbFloatN">${ids.length} scenes</span>` : "");
  document.body.appendChild(float);
  // keep the strip you grabbed under the pointer, wherever it sits in the stack
  const held = ids.length > 1 ? float.querySelector('.sbRow[data-sid="' + CSS.escape(id) + '"]') : null;
  const lift = held ? held.getBoundingClientRect().top - float.getBoundingClientRect().top : 0;
  const gap = document.createElement("div"); gap.className = "sbGap"; gap.style.height = Math.max(34, rr.height) + "px";
  if(ids.length > 1) gap.textContent = ids.length + " scenes";
  if(ban) gap.style.height = "26px";
  const srcs = ban ? [row] : ids.map((x) => box.querySelector('.sbRow[data-sid="' + CSS.escape(x) + '"]')).filter(Boolean);
  row.after(gap); srcs.forEach((el) => el.classList.add("sbSrc"));
  Object.assign(SBD, { on: true, pid, box, ids, ban, float, gap, srcs, scroller, dy: e.clientY - rr.top + lift, y: e.clientY, raf: 0 });
  S.drag = id || "ban";   // the panel doesn't redraw under a drag
  document.body.classList.add("sbDragging");
  sbDragMove(e.clientY);
  const tick = () => { if(!SBD.on) return; const r = SBD.scroller.getBoundingClientRect ? SBD.scroller.getBoundingClientRect() : { top: 0, bottom: innerHeight }; const top = Math.max(0, r.top), bot = Math.min(innerHeight, r.bottom);
    const v = SBD.y < top + 60 ? -Math.ceil((top + 60 - SBD.y) / 4) : SBD.y > bot - 60 ? Math.ceil((SBD.y - (bot - 60)) / 4) : 0;
    if(v){ SBD.scroller.scrollTop += v; sbDragMove(SBD.y); } SBD.raf = requestAnimationFrame(tick); };
  SBD.raf = requestAnimationFrame(tick);
}
function sbDragMove(y){
  SBD.y = y;
  SBD.float.style.top = (y - SBD.dy) + "px";
  // the day list under the pointer (or the nearest one), then the first strip whose middle is below the pointer
  const lists = Array.from(SBD.box.querySelectorAll(".sbDayWrap"));
  let wrap = null, best = 1e9;
  lists.forEach((w) => { const r = w.getBoundingClientRect(); const d = y < r.top ? r.top - y : y > r.bottom ? y - r.bottom : 0; if(d < best){ best = d; wrap = w; } });
  if(!wrap) return;
  const list = wrap.querySelector(".sbRows"); if(!list) return;
  const head = wrap.querySelector(".sbDay"), hr = head.getBoundingClientRect();
  if(wrap.classList.contains("folded") || y < hr.bottom){
    // over a day's header: the top of that day (or the end, if its strips are hidden)
    const first = Array.from(list.children).find((x) => x.classList.contains("sbRow") && !x.classList.contains("sbSrc"));
    if(first && !wrap.classList.contains("folded")){ if(first.previousElementSibling !== SBD.gap) first.before(SBD.gap); } else if(list.lastElementChild !== SBD.gap) list.appendChild(SBD.gap);
  } else {
    const rows = Array.from(list.children).filter((x) => x.classList.contains("sbRow") && !x.classList.contains("sbSrc") && !x.classList.contains("sbHide"));
    const next = rows.find((x) => { const r = x.getBoundingClientRect(); return y < r.top + r.height / 2; });
    if(next){ if(next.previousElementSibling !== SBD.gap) next.before(SBD.gap); } else if(list.lastElementChild !== SBD.gap) list.appendChild(SBD.gap);
  }
  const empty = list.querySelector(".sbEmpty"); SBD.box.querySelectorAll(".sbEmpty").forEach((x) => { x.style.display = x === empty && SBD.gap.parentNode === list ? "none" : ""; });
  SBD.box.querySelectorAll(".sbDayWrap.sbDrop").forEach((x) => x !== wrap && x.classList.remove("sbDrop")); wrap.classList.add("sbDrop");
}
function sbDragEnd(cancel){
  if(!SBD.on) return;
  cancelAnimationFrame(SBD.raf);
  const { pid, ids, gap, float, ban } = SBD;
  const list = gap.parentNode, day = list ? Number(list.dataset.day) : NaN;
  let prev = gap.previousElementSibling; while(prev && !(prev.classList.contains("sbRow") && !prev.classList.contains("sbSrc"))) prev = prev.previousElementSibling;
  const after = prev ? prev.dataset.sid : "";
  let next = gap.nextElementSibling; while(next && !(next.classList.contains("sbRow") && !next.classList.contains("sbSrc"))) next = next.nextElementSibling;
  float.remove(); gap.remove();
  SBD.on = false; S.drag = null; document.body.classList.remove("sbDragging");
  SBD.box.querySelectorAll(".sbSrc").forEach((x) => x.classList.remove("sbSrc")); SBD.box.querySelectorAll(".sbDrop").forEach((x) => x.classList.remove("sbDrop")); SBD.ban = null;
  if(cancel || !isFinite(day)){ rerender(); return; }
  if(ban){ sbBanDrop(pid, ban, day, after); return; }
  sbMove(pid, ids, day, next ? next.dataset.sid : null);
}
// A break, move, note or the meal dropped in a new place. `after` = the scene it now follows ("" = start of the day).
// ⚠ Writes the shared plan; the times follow (the timetable is worked out from the plan and sent with Sync).
function sbBanDrop(pid, ban, day, after){
  const plan = planOf(pid), byId = S.lastBd ? P.sceneMap(S.lastBd) : {}, nOf = (id) => byId[id] ? SN(byId[id]) : "";
  const no = (msg) => { H().toast(msg, "err", 2200); rerender(); };
  if(day < 0 || !plan.days[day]) return no("Breaks, moves and meals stay on a shoot day.");
  const d = plan.days[day];
  if(ban.k === "meal" || ban.k === "amove"){
    if(day !== ban.day) return no((ban.k === "meal" ? "The meal" : "This company move") + " belongs to Day " + (ban.day + 1) + ". Drag it within that day.");
    if(!after) return no((ban.k === "meal" ? "The meal" : "A company move") + " goes after a scene, not before the first one.");
  }
  if(ban.k === "meal"){ d.mealAfter = after; delete d.lunch; delete d.noMeal; }
  else if(ban.k === "amove"){
    // the automatic move becomes one placed by hand, and the automatic one at that location change is switched off
    const T = P.timeSettings(plan.settings);
    if(ban.before) d.noMove = Array.from(new Set((d.noMove || []).concat([ban.before])));
    d.extras = P.cleanExtras((d.extras || []).concat([{ id: "x" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), k: "move", min: T.move, label: ban.to ? "Travel to " + ban.to : "", after }]));
  } else {
    const src = plan.days[ban.day], x = src && (src.extras || []).find((y) => y.id === ban.id); if(!x) return no("That item has changed. Try again.");
    src.extras = src.extras.filter((y) => y.id !== ban.id); if(!src.extras.length) delete src.extras;
    d.extras = P.cleanExtras((d.extras || []).concat([Object.assign({}, x, { after })]));
  }
  save(pid, plan); rerender();
  H().toast((ban.k === "meal" ? "Meal" : ban.k === "amove" ? "Company move" : "Moved") + (after ? " now after Sc " + nOf(after) : " now at the start of Day " + (day + 1)) + ". Times updated.", "ok", 1800);
}
// Alt+↑/↓: one place up or down, across day boundaries (the first strip of a day goes to the end of the day before)
function sbNudge(pid, id, dir){
  const plan = planOf(pid), di = plan.days.findIndex((d) => d.scenes.indexOf(id) >= 0); if(di < 0) return;
  const list = plan.days[di].scenes, k = list.indexOf(id);
  if(dir < 0){ if(k > 0) sbMove(pid, [id], di, list[k - 1]); else if(di > 0) sbMove(pid, [id], di - 1, null); }
  else { if(k < list.length - 1) sbMove(pid, [id], di, list[k + 2] || null); else if(di < plan.days.length - 1) sbMove(pid, [id], di + 1, plan.days[di + 1].scenes[0] || null); }
  setTimeout(() => { const el = document.querySelector('#ctl .sbRow[data-sid="' + CSS.escape(id) + '"]'); if(el) el.focus(); }, 60);
}
document.addEventListener("pointermove", (e) => {
  const p = SBD.press;
  if(p && !SBD.on && Math.abs(e.clientY - p.y) + Math.abs(e.clientX - p.x) > 5){ SBD.press = null; sbDragStart(p.box, p.pid, p.row, e); }
  if(SBD.on){ e.preventDefault(); sbDragMove(e.clientY); }
}, { passive: false });
document.addEventListener("pointerup", () => { SBD.press = null; if(SBD.on){ SBD.justDropped = true; setTimeout(() => { SBD.justDropped = false; }, 0); sbDragEnd(false); } });
document.addEventListener("pointercancel", () => { SBD.press = null; sbDragEnd(true); });
document.addEventListener("keydown", (e) => { if(e.key === "Escape" && SBD.on){ e.preventDefault(); e.stopPropagation(); sbDragEnd(true); } }, true);
/* ---------- dropdowns that always open downwards ----------
   The page's <select>s stay (their value and change events drive everything); each gets a button that opens a list
   below it. Near the bottom of the screen the panel scrolls up to make room instead of the list flipping upwards. */
const SBM = { el: null, sel: null, btn: null };
function sbMenuClose(){ if(SBM.el){ SBM.el.remove(); SBM.el = null; } if(SBM.btn) SBM.btn.setAttribute("aria-expanded", "false"); SBM.sel = null; SBM.btn = null; }
function sbMenuOpen(btn, sel){
  sbMenuClose();
  const scroller = btn.closest(".ctlBody");
  let r = btn.getBoundingClientRect(); const want = Math.min(300, sel.options.length * 30 + 10);
  if(scroller && innerHeight - r.bottom < want + 12){ scroller.scrollTop += want + 12 - (innerHeight - r.bottom); r = btn.getBoundingClientRect(); }
  const m = document.createElement("div"); m.className = "sbMenu"; m.setAttribute("role", "listbox");
  m.innerHTML = Array.from(sel.options).map((o, k) => `<div class="sbOpt${o.selected ? " on" : ""}${o.disabled ? " dis" : ""}" role="option" data-k="${k}" aria-selected="${o.selected}">${esc(o.text)}</div>`).join("");
  document.body.appendChild(m);
  m.style.left = Math.min(r.left, innerWidth - Math.max(r.width, m.offsetWidth) - 8) + "px"; m.style.top = (r.bottom + 4) + "px"; m.style.minWidth = r.width + "px";
  m.style.maxHeight = Math.max(140, Math.min(300, innerHeight - r.bottom - 12)) + "px";
  let on = m.querySelector(".sbOpt.on");
  // a time left on Auto: open the list around a sensible hour instead of midnight
  if(sel.classList.contains("tSel") && sel.selectedIndex === 0 && sel.options[0].value === ""){ const near = sel.hasAttribute("data-wrapat") ? "18:00" : sel.hasAttribute("data-lunch") ? "12:00" : "07:00"; const k = Array.from(sel.options).findIndex((o) => o.value === near); if(k > 0) on = m.querySelectorAll(".sbOpt")[k]; }
  if(on) m.scrollTop = on.offsetTop - m.clientHeight / 2 + on.offsetHeight / 2;
  const tip = document.getElementById("sbTip"); if(tip) tip.classList.remove("show");
  Object.assign(SBM, { el: m, sel, btn }); btn.setAttribute("aria-expanded", "true");
  m.addEventListener("pointerdown", (e) => e.preventDefault());
  m.addEventListener("click", (e) => { const o = e.target.closest(".sbOpt"); if(!o || o.classList.contains("dis")) return; sbMenuPick(Number(o.dataset.k)); });
}
function sbMenuPick(k){
  const sel = SBM.sel, btn = SBM.btn; if(!sel) return;
  sbMenuClose();
  if(sel.selectedIndex !== k){ sel.selectedIndex = k; if(btn){ const t = btn.querySelector("span"); if(t) t.textContent = sel.options[k].text; } sel.dispatchEvent(new Event("change", { bubbles: true })); }
  if(btn && document.body.contains(btn)) btn.focus();
}
function sbMenuKey(e){
  if(!SBM.el) return false;
  const opts = Array.from(SBM.el.querySelectorAll(".sbOpt")), cur = opts.findIndex((o) => o.classList.contains("hl")), base = cur >= 0 ? cur : opts.findIndex((o) => o.classList.contains("on"));
  const go = (i) => { i = Math.max(0, Math.min(opts.length - 1, i)); opts.forEach((o) => o.classList.remove("hl")); opts[i].classList.add("hl"); opts[i].scrollIntoView({ block: "nearest" }); };
  if(e.key === "ArrowDown"){ go(base + 1); return true; }
  if(e.key === "ArrowUp"){ go(base - 1); return true; }
  if(e.key === "Enter" || e.key === " "){ sbMenuPick(base < 0 ? 0 : base); return true; }
  if(e.key === "Escape" || e.key === "Tab"){ const b = SBM.btn; sbMenuClose(); if(b && e.key === "Escape") b.focus(); return e.key === "Escape"; }
  if(e.key.length === 1){ const k = opts.findIndex((o, i) => i > base && o.textContent.trim().toLowerCase().startsWith(e.key.toLowerCase())); const k2 = k >= 0 ? k : opts.findIndex((o) => o.textContent.trim().toLowerCase().startsWith(e.key.toLowerCase())); if(k2 >= 0) go(k2); return true; }
  return false;
}
document.addEventListener("keydown", (e) => { if(sbMenuKey(e)){ e.preventDefault(); e.stopPropagation(); } }, true);
document.addEventListener("pointerdown", (e) => { if(SBM.el && !SBM.el.contains(e.target) && !(SBM.btn && SBM.btn.contains(e.target))) sbMenuClose(); }, true);
window.addEventListener("resize", sbMenuClose);
document.addEventListener("scroll", (e) => { if(SBM.el && !SBM.el.contains(e.target)) sbMenuClose(); }, true);
function sbEnhanceSelects(box){
  box.querySelectorAll(".ctlBody.sbMode select").forEach((sel) => {
    if(sel.dataset.enh) return; sel.dataset.enh = "1";
    const b = document.createElement("button"); b.type = "button"; b.className = "sbPick" + (sel.classList.contains("tSel") ? " t" : ""); b.disabled = sel.disabled;
    b.setAttribute("aria-haspopup", "listbox"); b.setAttribute("aria-expanded", "false"); if(sel.getAttribute("aria-label")) b.setAttribute("aria-label", sel.getAttribute("aria-label"));
    b.innerHTML = `<span>${esc(sel.options[sel.selectedIndex] ? sel.options[sel.selectedIndex].text : "")}</span><i aria-hidden="true">▾</i>`;
    sel.classList.add("sbNative"); sel.tabIndex = -1; sel.after(b);
    b.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); if(SBM.btn === b) sbMenuClose(); else sbMenuOpen(b, sel); });
    b.addEventListener("keydown", (e) => { if(!SBM.el && (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter" || e.key === " ")){ e.preventDefault(); e.stopPropagation(); sbMenuOpen(b, sel); } });
  });
}
function sbWire(box, pid, canEdit){
  sbMenuClose(); sbEnhanceSelects(box);
  if(SB.focus){ const el = box.querySelector('.sbRow[data-sid="' + CSS.escape(SB.focus) + '"]'); if(el){ SB.focus = null; setTimeout(() => { el.scrollIntoView({ block: "center" }); el.focus({ preventScroll: true }); }, 30); } }
  const q = box.querySelector("[data-sbq]");
  if(q){ q.oninput = () => { SB.q = q.value; const f = { q: SB.q, ie: SB.ie, dn: SB.dn, cast: SB.cast }, by = S.lastBd ? P.sceneMap(S.lastBd) : {};
    box.querySelectorAll(".sbRow").forEach((r) => r.classList.toggle("sbHide", !P.stripMatch(by[r.dataset.sid], f))); };
    q.onkeydown = (e) => { e.stopPropagation(); if(e.key === "Escape"){ q.value = ""; q.oninput(); } };
    q.onblur = () => { if(SB.q !== (q.dataset.was || "")) rerender(); }; q.dataset.was = SB.q; }
  box.ondblclick = (e) => { const row = e.target.closest(".sbRow"); if(!row) return; const s = S.lastBd && P.sceneMap(S.lastBd)[row.dataset.sid]; if(s && window.CampBdPanel && window.CampBdPanel.openScene) window.CampBdPanel.openScene(s.n, s.id); };
  box.ondragstart = (e) => { if(e.target.closest && e.target.closest(".sbRow")) e.preventDefault(); };
  if(!canEdit){ box.onpointerdown = null; return; }
  box.oncontextmenu = (e) => { const row = e.target.closest(".sbRow"); if(!row || e.target.closest("input, select, textarea")) return; const b = row.querySelector(".sbMore"); if(!b) return; e.preventDefault(); if(SBM.btn !== b) sbActMenu(pid, b); };
  box.onpointerdown = (e) => {
    const bn = e.target.closest(".sbBan[data-bk]");
    if(bn && e.button === 0 && !bn.closest(".sbDayWrap.folded")){ if(e.pointerType !== "mouse" && !e.target.closest(".sbGrip")) return; if(e.pointerType === "mouse") e.preventDefault(); SBD.press = { box, pid, row: bn, x: e.clientX, y: e.clientY }; return; }
    const row = e.target.closest(".sbRow"); if(!row || e.button > 0 || e.target.closest("select, input, button, a, label, .sbPick")) return;
    const grip = !!e.target.closest(".sbGrip");
    if(e.pointerType !== "mouse" && !grip) return;     // touch: only the grip picks up, so the page still scrolls
    if(e.pointerType === "mouse") e.preventDefault();  // no text selection
    SBD.press = { box, pid, row, x: e.clientX, y: e.clientY };
  };
  box.onkeydown = (e) => {
    const row = e.target.closest && e.target.closest(".sbRow"); if(!row || e.target !== row) return;
    if(e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")){ e.preventDefault(); sbNudge(pid, row.dataset.sid, e.key === "ArrowUp" ? -1 : 1); return; }
    if(e.key !== " " && e.key !== "Enter") return;
    e.preventDefault(); const id = row.dataset.sid;
    sbClick({ target: row, shiftKey: e.shiftKey, ctrlKey: e.ctrlKey, metaKey: e.metaKey }, pid, canEdit);
    setTimeout(() => { const again = document.querySelector('#ctl .sbRow[data-sid="' + CSS.escape(id) + '"]'); if(again) again.focus(); }, 30);
  };
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
        <div class="fxScenes">${all.map((n) => { const off = (f.ignored || []).indexOf(n) >= 0; return `<button type="button" class="fxSc${off ? " off" : ""}" data-a="fxsc" data-f="${esc(f.id)}" data-s="${esc(sid(n))}" data-on="${off ? 0 : 1}" title="${off ? "Ignored here: click to keep" : "Click to ignore in this scene"}"${canEdit ? "" : " disabled"}>Sc ${esc(SN(bd.scenes[n - 1]) || n)}</button>`; }).join("")}</div>
        <div class="seg fxSeg">${["keep", "watch", "ignore"].map((v) => `<button type="button" class="${g === v ? "on" : ""}" data-a="fx" data-f="${esc(f.id)}" data-v="${v}"${canEdit ? "" : " disabled"}>${v[0].toUpperCase() + v.slice(1)}</button>`).join("")}</div>
      </div>`;
    }).join("")}</details>`;
}
/* ---------- cast: Lead / Supporting / … as the script suggests, or as you choose ---------- */
const TYPE_LABEL = { "Featured (non-speaking)": "Featured (non-speaking)" };
// Days a cast member or place can't be used: runs of dates as chips, and a date picker to add one
const fmtDayShort = (iso) => { const d = P.parseISO(iso); return d ? d.toLocaleDateString(undefined, { day: "numeric", month: "short", timeZone: "UTC" }) : iso; };
function availCtl(pl, k, name, canEdit){
  const off = P.availOff(pl, k, name), runs = P.availRuns(off);
  if(!runs.length && !canEdit) return "";
  const chip = ([a, z]) => `<span class="lcChip off">${esc(a === z ? fmtDayShort(a) : fmtDayShort(a) + " – " + fmtDayShort(z))}${canEdit ? `<button type="button" data-a="avrm" data-avk="${k}" data-avn="${esc(name)}" data-a0="${a}" data-z="${z}" aria-label="${esc(name)} is available again on these days" title="Available again">✕</button>` : ""}</span>`;
  return `<div class="avWrap"><span class="avLbl">${runs.length ? "Unavailable" : ""}</span>${runs.map(chip).join("")}${canEdit ? `<label class="avAdd"${tipAttr("Pick a day " + name + " can't " + (k === "cast" ? "work" : "be used") + ". Auto-schedule won't book it, and a day that does is flagged")}>＋ Day off<input type="date" data-avk="${k}" data-avn="${esc(name)}" aria-label="Add a day ${esc(name)} is unavailable"></label>` : ""}</div>`;
}
function castView(pl, bd, canEdit){
  if(!bd.cast.length) return "";
  const chosen = {}; (pl.castType || []).forEach((c) => { chosen[c.name] = c.t; });
  const n = Object.keys(chosen).filter((k) => bd.cast.some((c) => c.name === k)).length;
  const nOff = bd.cast.filter((c) => P.availOff(pl, "cast", c.name).length).length;
  return `<details class="dood fx" data-sec="cast"${lsGet(CAST_KEY) === "1" ? " open" : ""}><summary>Cast · ${bd.cast.length} character${bd.cast.length === 1 ? "" : "s"}${n ? " (" + n + " set by hand)" : ""}${nOff ? " · " + nOff + " with days off" : ""}</summary>
    <div class="fxNote">Set by how much each character is in the script. Change any type here, and add the days someone can't work.</div>
    ${bd.cast.map((c) => `<div class="fxRow"><div class="fxName"><b>${esc(c.name)}</b><span>${c.onCamCount || c.scenes.length} scene${(c.onCamCount || c.scenes.length) === 1 ? "" : "s"}${chosen[c.name] && c.autoType !== c.type ? " · script suggests " + esc(c.autoType) : ""}</span></div>
      <label class="fxIn">Type <select data-ctype="${esc(c.name)}"${canEdit ? "" : " disabled"}>${P.CAST_TYPES.map((t) => `<option value="${esc(t)}"${c.type === t ? " selected" : ""}>${esc(TYPE_LABEL[t] || t)}${t === c.autoType ? " (auto)" : ""}</option>`).join("")}</select></label>${availCtl(pl, "cast", c.name, canEdit)}</div>`).join("")}
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
  const names = Object.keys(orig); if(!names.length) return "";
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
    <div class="fxNote">Group areas (kitchen, yard…) into the one real place you shoot at, and add the days a place can't be used.
      ${canEdit && names.length > 1 ? `<button type="button" class="btn sm" data-a="lcnew">New place…</button>` : ""}
      ${rooms.length > 1 && canEdit ? `<button type="button" class="btn sm" data-a="rooms" data-rooms="${esc(rooms.join("|"))}">Put ${rooms.length} rooms in one place…</button>` : ""}</div>
    ${form}
    ${list.map((x) => {
      const areas = x.areas.filter((a) => a !== x.name), own = !!orig[x.name];
      return `<div class="fxRow"><div class="fxName"><b>${esc(x.name)}</b><span>${x.n} scene${x.n === 1 ? "" : "s"} · ${P.fmtEighths(x.e)} pg${areas.length ? " · " + (areas.length + (own ? 1 : 0)) + " areas" : ""}</span>
        ${areas.length ? `<div class="lcAreas">${own ? `<span class="lcChip main" title="Scenes written as ${esc(x.name)} itself">${esc(x.name)}</span>` : ""}${areas.map((a) => `<span class="lcChip">${esc(a)}${canEdit ? `<button type="button" data-a="lcout" data-loc="${esc(a)}" aria-label="Take ${esc(a)} out of ${esc(x.name)}" title="Take out: its own location again">✕</button>` : ""}</span>`).join("")}</div>` : ""}</div>
        ${availCtl(pl, "loc", x.name, canEdit)}
        ${canEdit && list.length > 1 ? `<div class="lcActs"><button type="button" class="btn sm" data-a="lcadd" data-place="${esc(x.name)}">Add areas…</button>${areas.length ? `<button type="button" class="btn sm" data-a="lcren" data-place="${esc(x.name)}" data-own="${own ? 1 : 0}">Rename…</button><button type="button" class="btn sm" data-a="lcsplit" data-place="${esc(x.name)}" title="Every area becomes its own location again">Split</button>` : ""}</div>` : ""}</div>`;
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
    if(S.view === "strips" && sbClick(e, pid, canEdit)){ if(S.menu){ S.menu = false; render(pid); } return; }
    const a = e.target.closest("[data-a]"), sEl = e.target.closest(".strip");
    if(a){
      const k = a.dataset.a;
      if(k !== "menu") S.menu = false;
      if(k === "menu"){ S.menu = !S.menu; render(pid); return; }
      if(k === "dtab"){ S.dayTab[pid] = Number(a.dataset.i); render(pid); return; }
      if(k === "pview"){ S.view = a.dataset.v === "classic" ? "classic" : "strips"; lsSet("Camp_PROD_VIEW_V1", S.view); S.pick = null; render(pid); return; }
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
      if(k === "avrm" && canEdit){
        const a0 = P.parseISO(a.dataset.a0), z = P.parseISO(a.dataset.z), list = [];
        for(let t2 = a0 ? a0.getTime() : 0; a0 && z && t2 <= z.getTime() && list.length < 400; t2 += 864e5) list.push(new Date(t2).toISOString().slice(0, 10));
        const nm = a.dataset.avn, kk = a.dataset.avk;
        update((plan) => { P.setAvail(plan, kk, nm, list, false); });
        H().toast(nm + " is available again on " + (list.length === 1 ? fmtDayShort(list[0]) : list.length + " days") + ".", "ok", 1800);
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
      if(k === "dwhere"){ const i = Number(a.dataset.i), cur = planOf(pid).days[i]; const ui = window.CampUI;
        const ask = ui && ui.prompt ? ui.prompt("Day " + (i + 1) + " location\nWhere this day shoots, for its sunrise, sunset and weather. Leave it empty to use the shoot's location.", cur && cur.where ? cur.where.name : "") : Promise.resolve(window.prompt("Day " + (i + 1) + " location", cur && cur.where ? cur.where.name : ""));
        ask.then((v) => { if(v != null) setWhere(pid, i, v); }); return; }
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
  box.querySelectorAll("details.setWrap").forEach((d) => { d.ontoggle = () => { if(S.view === "strips" || matchMedia("(max-width:760px)").matches) S.setOpen = d.open; }; });
  box.onchange = (e) => {
    const t = e.target;
    if(S.view === "strips" && sbChange(e, pid, canEdit)) return;
    if(!canEdit) return;
    if(t.dataset.move){ moveScene(pid, t.dataset.move, Number(t.value), -1); S.pick = null; return; }
    if(S.locForm && t.closest(".lcPick")){ (S.locForm.picked = S.locForm.picked || {})[t.value] = t.checked; return; }
    if(t.dataset.ctype != null){
      const c = (ctx.bd && ctx.bd.cast || []).find((x) => x.name === t.dataset.ctype);
      setCastType(pid, t.dataset.ctype, t.value, c && c.autoType);
      H().toast(t.dataset.ctype + ": " + t.value, "ok", 1600);
      return;
    }
    if(t.dataset.avk != null){
      const v = t.value, nm = t.dataset.avn, kk = t.dataset.avk; if(!P.parseISO(v)) return;
      update((plan) => { P.setAvail(plan, kk, nm, [v], true); });
      H().toast(nm + " unavailable on " + fmtDayShort(v) + ".", "ok", 1800);
      return;
    }
    if(t.dataset.date != null){ update((plan) => { const d = plan.days[Number(t.dataset.date)]; if(d) d.date = t.value || ""; }); return; }
    if(t.dataset.lunch != null){ update((plan) => { const d = plan.days[Number(t.dataset.lunch)]; if(d){ delete d.mealAfter; if(t.value === "none"){ d.noMeal = true; delete d.lunch; } else { delete d.noMeal; if(t.value) d.lunch = t.value; else delete d.lunch; } } }); return; }
    if(t.dataset.wrapat != null){ update((plan) => { const d = plan.days[Number(t.dataset.wrapat)]; if(d){ if(t.value) d.wrapAt = t.value; else delete d.wrapAt; } }); return; }
    if(t.dataset.call != null){ update((plan) => { const d = plan.days[Number(t.dataset.call)]; if(d) d.call = t.value === plan.settings.call ? "" : t.value; }); return; }
    if(t.dataset.status != null){ const id = t.dataset.status, v = t.value; update((plan) => { P.setStatus(plan, id, v); }); H().toast("Sc " + (SN(ctx.bd && P.sceneMap(ctx.bd)[id]) || "") + ": " + v, "ok", 1400); return; }
    if(t.dataset.t != null){ const k = t.dataset.t, v = Number(t.value); update((plan) => { const T = Object.assign({}, plan.settings.times || {}); const val = k === "mealBy" ? Math.round(v * 60) : Math.round(v);
      if(t.value === "" || !isFinite(v) || val === P.TIME_DEFAULTS[k]) delete T[k]; else T[k] = Math.max(0, Math.min(1440, val)); if(Object.keys(T).length) plan.settings.times = T; else delete plan.settings.times; }); return; }
    if(t.dataset.s === "where"){ setWhere(pid, -1, t.value); return; }
    const k = t.dataset.s; if(!k) return;
    if(k === "days"){ const r = P.resizeDays(planOf(pid), Number(t.value)); confirmShrink(pid, r); return; }
    if(k === "script"){ update((plan) => { plan.scriptId = t.value; }); return; }
    update((plan) => { plan.settings[k] = (k === "start" || k === "call") ? t.value : Number(t.value); });
  };
  const lcName = box.querySelector("#lcName"); if(lcName){ lcName.oninput = () => { if(S.locForm) S.locForm.name = lcName.value; }; lcName.onkeydown = (e) => { e.stopPropagation(); if(e.key === "Enter"){ e.preventDefault(); const ok = box.querySelector("[data-a=lcok]"); if(ok) ok.click(); } }; if(!lcName.value) lcName.focus({ preventScroll: true }); }
  const tm = box.querySelector("details.tmSet"); if(tm) tm.ontoggle = () => { S.tmOpen = tm.open; };
  const det = box.querySelector("details.dood:not(.fx)"); if(det) det.ontoggle = () => { S.doodOpen = det.open; lsSet(DOOD_KEY, det.open ? "1" : "0"); };
  box.querySelectorAll("details.fx").forEach((d) => { d.ontoggle = () => lsSet(d.dataset.sec === "flags" ? FLAGS_KEY : d.dataset.sec === "shots" ? SHOTS_KEY : d.dataset.sec === "cast" ? CAST_KEY : LOCS_KEY, d.open ? "1" : "0"); });
  if(S.view === "strips"){ sbWire(box, pid, canEdit); return; }
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
// Save a place for the shoot (day -1) or one day: looked up first, so sunrise and weather work on every device
async function setWhere(pid, day, text){
  text = String(text || "").trim();
  const put = (w) => { const plan = planOf(pid); if(day < 0){ if(w) plan.settings.where = w; else delete plan.settings.where; } else if(plan.days[day]){ if(w) plan.days[day].where = w; else delete plan.days[day].where; } save(pid, plan); rerender(); };
  if(!text){ put(null); return; }
  const g = await geocode(text);
  if(!g) H().toast("Couldn't find “" + text + "”. It's saved as typed, but sunrise and weather need a place that can be found (try adding the city).", "err", 5000);
  else H().toast("Location: " + g.label, "ok", 2200);
  put(g || { name: text });
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
  const sc = S.lastBd ? P.sceneMap(S.lastBd)[id] : null, name = sc ? "Sc " + SN(sc) : "Scene";
  if(toDay < 0) H().toast(name + " moved to Unscheduled", "ok", 1800);
  else if(from === toDay) H().toast(name + " reordered on Day " + (toDay + 1), "ok", 1800);
  else if(S.lastBd){ const st = P.dayStats(plan.days[toDay], P.sceneMap(S.lastBd), plan.settings.maxEighths); H().toast(name + " → Day " + (toDay + 1) + " · " + P.fmtEighths(st.eighths) + " / " + P.fmtEighths(plan.settings.maxEighths) + " pg" + (st.over ? " (over the limit)" : ""), "ok", 1800); }
  else H().toast(name + " → Day " + (toDay + 1), "ok", 1800);
  rerender();
}
function autoPlan(pid, ctx, all){
  const before = planOf(pid), had = before.days.reduce((n, d) => n + d.scenes.length, 0);
  const r = P.autoSchedule(before, ctx.bd, { all });
  const now = r.plan.days.reduce((n, d) => n + d.scenes.length, 0);
  save(pid, r.plan); rerender();
  if(!r.unplaced.length){
    if(!all && now === had) H().toast("Nothing to place: every scene is already on a day. If the script just changed, press Refresh first.", "ok", 3600);
    else H().toast((all ? "Re-planned " : "Placed ") + (all ? now : now - had) + " scene" + ((all ? now : now - had) === 1 ? "" : "s") + ".", "ok", 2200);
  }
  if(r.unplaced.length) H().toast(r.unplaced.length + " scene" + (r.unplaced.length === 1 ? " doesn't" : "s don't") + " fit in " + r.plan.settings.days + " days at these limits (" + P.fmtEighths(r.plan.settings.maxEighths) + " pages, " + r.plan.settings.maxHours + " hours a day, and days off). Add days or raise a limit.");
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
  if(e.key === "Escape" && S.mode === "plan" && S.view === "strips" && SB.sel.length && !/^(input|select|textarea)$/i.test((e.target && e.target.tagName) || "")){ SB.sel = []; SB.anchor = null; rerender(); return; }
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
  Promise.resolve(hub.syncSheets(pid, scriptId, btn)).finally(() => { delete S.busy[pid]; loadShots(scriptId, true); rerender(); });
}
const isStale = (pid) => { const p = H().project(pid); return !!(p && P.callsheetsStale(p.production)); };
// Each day's call / shoot / wrap times for Sync (null until the plan has been drawn for this project in this tab)
// The enriched breakdown for a project's plan, as the Shoot plan draws it (reads the script if this tab hasn't yet)
async function planBd(pid){
  if(S.lastBd && S.lastBdPid === pid) return S.lastBd;
  const hub = H(), p = hub.project(pid); if(!p) return null;
  const ids = hub.scriptIds(p), plan = planOf(pid), scriptId = (plan.scriptId && ids.indexOf(plan.scriptId) >= 0) ? plan.scriptId : ids[0] || "";
  if(!scriptId) return null;
  for(let i = 0; i < 120 && !(S.scripts[scriptId] && S.scripts[scriptId].doc && S.scripts[scriptId].state !== "loading"); i++){
    if(!S.scripts[scriptId] || S.scripts[scriptId].state === "error") await loadScript(scriptId);
    if(S.scripts[scriptId] && S.scripts[scriptId].state === "error") return null;
    await new Promise((r) => setTimeout(r, 250));
  }
  const sc = S.scripts[scriptId]; if(!sc || !sc.doc) return null;
  const aopts = P.analyzeOpts(plan), akey = JSON.stringify(aopts);
  if(sc.akey !== akey){ sc.bd = B.analyze(sc.doc, aopts); sc.akey = akey; }
  const bdE = window.CampBdPanel && window.CampBdPanel.enriched ? window.CampBdPanel.enriched(pid, scriptId, p, sc.doc, sc.bd, sc.modified, aopts) : sc.bd;
  // Sync sends the same times the stripboard shows: wait (a few seconds at most) for the shot list
  if(!S.shots[scriptId]) loadShots(scriptId);
  for(let i = 0; i < 32 && S.shots[scriptId] && S.shots[scriptId].state === "loading"; i++) await new Promise((r) => setTimeout(r, 250));
  return withShotTimes(bdE, (S.shots[scriptId] && S.shots[scriptId].map) || {}, plan);
}
// Each day's timetable plus everything the Schedule sheet lays out, for Sync. Waits (a few seconds at most) for forecasts.
async function timetable(pid){
  try{
    const bd = await planBd(pid); if(!bd) return null;
    const pl = planOf(pid), byId = P.sceneMap(bd);
    const days = P.timetable(pl, byId);
    // start any forecasts not fetched yet, then give them a moment
    days.forEach((d, i) => weatherFor(P.whereOf(pl, i), d.date));
    const pend = Object.keys(WX).map((k) => WX[k].p).filter(Boolean);
    if(pend.length) await Promise.race([Promise.allSettled(pend), new Promise((r) => setTimeout(r, 4000))]);
    return days.map((d, i) => {
      const w = P.whereOf(pl, i), sun = sunFor(w, d.date), wx = weatherFor(w, d.date);
      return Object.assign(d, { where: w ? w.name : "", sunrise: sun ? sun.rise : "", sunset: sun ? sun.set : "", weather: wx || "",
        rows: d.rows.map((r) => { if(r.type !== "scene") return r; const s = byId[r.id] || {};
          return Object.assign({}, r, { status: P.statusOf(pl, r.id), req: reqOf(s), notes: s.note || "", set: s.set || s.loc || "", ie: s.ie || "", dn: s.dn || "", eighths: s.eighths || 0,
            storyDay: s.storyDay || "", syn: s.syn || "", castNo: s.castNo || [], bg: s.bgN || 0 }); }) });
    });
  }catch(_e){ return null; }
}
function focusScene(pid, id){
  if(!id) return;
  const plan = planOf(pid), di = plan.days.findIndex((d) => d.scenes.indexOf(id) >= 0);
  SB.sec = "strips"; SB.q = ""; SB.ie = ""; SB.dn = ""; SB.cast = "";
  if(di >= 0 && SB.fold[pid]) SB.fold[pid][di] = false;
  SB.pid = pid; SB.sel = [id]; SB.anchor = id; SB.focus = id; SB.landed = [id];
  clearTimeout(focusScene.t); focusScene.t = setTimeout(() => { SB.landed = []; rerender(); }, 1400);
  rerender();
}
window.CampProdPanel = { withShotTimes, shotsFor, shotMinutes, focusScene, syncNow, isStale, render, setMode, csError, moveSceneBefore, planOf, timetable, undo: (pid) => stepHist(pid, true), reloadScript: (id) => loadScript(id, true), castTypes, setCastType: (pid, name, t, auto) => setCastType(pid, name, t, auto), CAST_TYPES: P.CAST_TYPES };
})();
