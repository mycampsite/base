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
const OPEN_KEY = "Camp_PROD_PANEL_OPEN_V1", DOOD_KEY = "Camp_PROD_DOOD_OPEN_V1";
const lsGet = (k) => { try{ return localStorage.getItem(k); }catch(_e){ return null; } };
const lsSet = (k, v) => { try{ localStorage.setItem(k, v); }catch(_e){} };

const S = {
  popout: new URLSearchParams(location.search).get("popout") === "1",
  mode: new URLSearchParams(location.search).get("popout") === "1" ? "plan" : "off",   // "plan" | "cs" | "off" (a sheet is showing)
  warnOpen: false,       // the "to check" list
  menu: false,           // the ⋯ menu
  csErr: {},             // pid -> last call-sheet error
  doodOpen: lsGet(DOOD_KEY) === "1",
  scripts: {},           // scriptId -> { state:"loading"|"ok"|"error", bd, err, modified }
  notice: {},            // pid -> { added:[], removed:[], moved:[] } shown until dismissed
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
.col{ flex:0 0 228px; background:#1d1d1d; border:1px solid var(--uiBorder); border-radius:12px; display:flex; flex-direction:column; max-height:440px; }
.col.none{ flex-basis:150px; }
.col.over{ border-color:rgba(255,139,131,.55); }
.col.drop{ border-color:var(--focus); box-shadow:0 0 0 2px rgba(91,140,255,.35); }
.colHead{ padding:9px 10px 7px; border-bottom:1px solid var(--uiBorder); }
.colHead b{ font-size:13px; } .colHead .dt{ font-size:11.5px; color:var(--uiMuted); margin-left:6px; }
.colMeta{ display:flex; justify-content:space-between; gap:6px; font-size:11.5px; color:var(--uiMuted); margin-top:4px; }
.cap{ height:4px; border-radius:3px; background:rgba(255,255,255,.08); margin-top:6px; overflow:hidden; }
.cap i{ display:block; height:100%; background:#8fe3a6; }
.col.over .cap i{ background:#ff8b83; }
.colCall{ display:flex; align-items:center; gap:6px; margin-top:6px; font-size:11.5px; color:var(--uiMuted); }
.colCall input{ height:24px; border-radius:6px; border:1px solid var(--uiBorder); background:#111; padding:0 5px; font-size:12px; }
.strips{ padding:7px; display:flex; flex-direction:column; gap:6px; overflow-y:auto; min-height:46px; }
.strip{ text-align:left; width:100%; border:1px solid rgba(255,255,255,.08); border-left:5px solid var(--sc, #ddd); border-radius:8px; padding:6px 8px; background:color-mix(in srgb, var(--sc, #ddd) 9%, #202020); cursor:grab; font-size:12px; line-height:1.35; }
.strip:hover{ border-color:rgba(255,255,255,.22); border-left-color:var(--sc, #ddd); }
.strip.pick{ outline:2px solid var(--focus); }
.strip.new{ box-shadow:0 0 0 1px #8fe3a6 inset; }
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
.dtPick{ position:relative; display:inline-flex; margin-left:6px; font-size:11.5px; color:var(--uiMuted); cursor:pointer; border-radius:6px; padding:1px 5px; }
.dtPick:hover{ background:rgba(255,255,255,.08); color:var(--uiText); }
.dtPick.pinned{ color:#a9c1ff; }
.dtPick input{ position:absolute; inset:0; opacity:0; cursor:pointer; width:100%; }
.colHead .unpin{ border:0; background:none; color:var(--uiMuted); cursor:pointer; font-size:11px; padding:0 3px; }
.colHead .unpin:hover{ color:#fff; }
.cal{ margin-top:12px; }
.calHead{ display:flex; gap:10px; align-items:baseline; flex-wrap:wrap; font-size:12px; color:var(--uiMuted); margin-bottom:6px; }
.calHead b{ color:var(--uiText); font-size:13px; }
.calGrid{ display:grid; grid-template-columns:repeat(7, minmax(0, 64px)); gap:4px; }
.calGrid > i{ font-style:normal; font-size:10.5px; color:var(--uiMuted); text-transform:uppercase; letter-spacing:.06em; padding-left:4px; }
.cd{ height:38px; border-radius:8px; border:1px solid var(--uiBorder); background:rgba(255,255,255,.02); color:var(--uiMuted); font-size:11px; display:flex; flex-direction:column; align-items:flex-start; justify-content:space-between; padding:3px 6px; cursor:default; }
.cd b{ font-size:11px; }
.cd.rest{ opacity:.35; }
.cd.shoot{ background:rgba(143,227,166,.13); border-color:rgba(143,227,166,.4); color:#bff0cc; cursor:pointer; }
.cd.shoot.pin{ background:rgba(91,140,255,.15); border-color:rgba(91,140,255,.5); color:#cbd8ff; cursor:default; }
.cd.off{ background:repeating-linear-gradient(135deg, rgba(255,139,131,.12) 0 6px, transparent 6px 12px); border-color:rgba(255,139,131,.45); color:#ffb4ae; cursor:pointer; }
.cd:not(:disabled):hover{ border-color:#fff; }
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
.fxIn{ display:flex; gap:8px; align-items:center; font-size:12px; color:var(--uiMuted); }
.fxIn select{ height:30px; border-radius:8px; border:1px solid var(--uiBorder); background:#111; padding:0 8px; }
.dood summary{ cursor:pointer; padding:9px 12px; font-weight:700; font-size:13px; }
.doodWrap{ overflow-x:auto; }
.dood table{ border-collapse:collapse; font-size:12px; min-width:100%; }
.dood th, .dood td{ border-top:1px solid var(--uiBorder); padding:5px 8px; text-align:center; white-space:nowrap; }
.dood .kid{ font-size:10.5px; color:#f1c76b; margin-left:6px; white-space:nowrap; }
.dood th:first-child, .dood td:first-child{ text-align:left; position:sticky; left:0; background:#1b1b1b; }
.dood td.W, .dood td.SW, .dood td.WF, .dood td.SWF{ background:rgba(143,227,166,.16); color:#bff0cc; font-weight:700; }
.dood td.H{ background:rgba(241,199,107,.12); color:#f1c76b; }
.ctlEmpty{ padding:18px 6px; color:var(--uiMuted); display:flex; gap:10px; align-items:center; flex-wrap:wrap; }
.ctlRO{ font-size:11.5px; color:var(--uiMuted); }
@media (max-width:760px){
  .col{ flex-basis:78vw; scroll-snap-align:start; }
  .col.none{ flex-basis:36vw; }
  .board{ scroll-snap-type:x proximity; scroll-padding-left:2px; -webkit-overflow-scrolling:touch; }
  .ctlActs{ margin-left:0; width:100%; }
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
function fmtDate(iso){
  const d = P.parseISO(iso); if(!d) return "";
  return d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
}
const H = () => window.__CampHub;

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

/* ---------- saving (whole plan; the team sees it live) ---------- */
let saveT = 0, pending = null;
function save(pid, plan){
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

function render(pid){
  S.pid = pid;
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
    box.innerHTML = head(`<span class="ctlChip">Reading the script…</span>`) + (S.open ? `<div class="ctlEmpty"><span class="spin"></span>Reading the script for scenes, pages and cast…</div>` : "");
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
  const bd = sc.bd, byId = P.sceneMap(bd); S.lastBd = bd;

  // No plan yet: one click starts it from the script
  if(!raw){
    box.innerHTML = head(`<span class="ctlChip">${bd.scenes.length} scenes</span><span class="ctlChip">${P.fmtEighths(bd.totals.eighths)} pages</span><span class="ctlChip">${bd.cast.length} cast</span>`) + (S.open ? `<div class="ctlEmpty">
        ${canEdit ? `Plan the shoot: set the number of shoot days and a start date, and Camp lays out a first schedule from the script that you can then rearrange. Budget, schedule and call sheets follow it.
        <button class="btn primary sm" type="button" data-a="start">Start the production plan</button>` : `The owner hasn't started the production plan yet.`}</div>` : "");
    wire(box, pid, { bd, scriptId }); return;
  }

  // The script is the truth: take deleted scenes off their days, list new ones
  const rec = P.reconcile(plan, bd);
  const known = new Set(Array.isArray(raw.known) ? raw.known : []);
  const added = known.size ? bd.scenes.filter((s) => s.id && !known.has(s.id)).map((s) => s.id) : [];
  if(canEdit && (rec.removed.length || added.length || !known.size || plan.scriptId !== scriptId)){
    if(rec.removed.length || added.length) S.notice[pid] = { added, removed: rec.removed };
    rec.plan.scriptId = scriptId;
    rec.plan.known = bd.scenes.filter((s) => s.id).map((s) => s.id);
    save(pid, rec.plan);
  }
  const pl = rec.plan, st = pl.settings, dates = P.planDates(pl);
  const badOrder = dates.some((d, i) => i && d && dates[i - 1] && d <= dates[i - 1]);
  const stats = pl.days.map((d) => P.dayStats(d, byId, st.maxEighths));
  const warns = P.validate(pl, bd);
  const scheduled = bd.scenes.filter((s) => s.id).length - rec.unscheduled.length;
  const nWarn = warns.filter((w) => w.level === "warn").length;
  const chips = `<span class="ctlChip">${st.days} shoot day${st.days === 1 ? "" : "s"}${st.start ? " · from " + esc(fmtDate(dates[0])) : ""}</span>
    <span class="ctlChip">${bd.scenes.length} scenes · ${P.fmtEighths(bd.totals.eighths)} pages</span>
    <span class="ctlChip ${rec.unscheduled.length ? "warn" : "ok"}">${scheduled}/${bd.scenes.filter((s) => s.id).length} scheduled</span>
    ${warns.length ? `<button type="button" class="ctlChip btnChip${nWarn ? " warn" : ""}" data-a="warns" aria-expanded="${S.warnOpen}">${nWarn ? "⚠ " + nWarn + " to check" : warns.length + " note" + (warns.length === 1 ? "" : "s")} ${S.warnOpen ? "▴" : "▾"}</button>` : ""}
    ${bd.cast.some((c) => c.minor) ? `<span class="ctlChip warn" title="${esc(bd.cast.filter((c) => c.minor).map((c) => c.name + (c.age != null ? " (" + c.age + ")" : " (age?)")).join(", "))}">${bd.cast.filter((c) => c.minor).length} under 18</span>` : ""}
    ${badOrder ? `<span class="ctlChip warn" title="A pinned date is on or before the day ahead of it">⚠ Days out of date order</span>` : ""}
    ${sc.state === "loading" ? `<span class="ctlChip">Updating from script…</span>` : ""}
    ${!canEdit ? `<span class="ctlChip">View only</span>` : ""}`;
  const acts = `<div class="ctlActs">
      ${hub.isOwner(p) ? `<button class="btn sm primary" type="button" data-a="sync" title="Rebuild the Schedule (with Day Out of Days), the Budget and the call sheets from this plan">Sync to Sheets</button>` : ""}
      <span class="ctlMore"><button class="btn sm" type="button" data-a="menu" aria-haspopup="menu" aria-expanded="${S.menu}" title="More">⋯</button>${S.menu ? `<div class="ctlMenu" role="menu">
        <button type="button" data-a="auto"${canEdit ? "" : " disabled"}>Auto-schedule<small>Put unscheduled scenes on days with room</small></button>
        <button type="button" data-a="reauto"${canEdit ? "" : " disabled"}>Re-plan all<small>Lay out every scene again from scratch</small></button>
        <button type="button" data-a="reload">Refresh script<small>Read the latest version of the script</small></button>
        ${S.popout ? "" : `<button type="button" data-a="pop">Pop out<small>Open the plan in its own window</small></button>`}
      </div>` : ""}</span></div>`;
  if(S.mode === "cs"){ box.innerHTML = head("", "") + `<div class="ctlBody">${csView(pid, p, raw, pl, dates, scriptId)}</div>`; wire(box, pid, { bd, scriptId }); return; }

  const dis = canEdit ? "" : " disabled";
  const scriptSel = ids.length > 1 ? `<label>Script<select data-s="script"${dis}>${ids.map((id) => `<option value="${esc(id)}"${id === scriptId ? " selected" : ""}>${esc(hub.scriptTitle(id))}</option>`).join("")}</select></label>` : "";
  const pageOpts = []; for(let e = 16; e <= 80; e += 4) pageOpts.push(e);
  if(pageOpts.indexOf(st.maxEighths) < 0) pageOpts.push(st.maxEighths), pageOpts.sort((a, b) => a - b);
  const settings = `<div class="ctlSet">
      ${scriptSel}
      <label>Shoot days<span class="ctlStep"><button type="button" data-a="days-" aria-label="One fewer day"${dis}>−</button><input type="number" min="1" max="${P.MAX_DAYS}" value="${st.days}" data-s="days"${dis}><button type="button" data-a="days+" aria-label="One more day"${dis}>+</button></span></label>
      <label>First shoot day<input type="date" value="${esc(st.start)}" data-s="start"${dis}></label>
      <label>Shooting week<select data-s="perWeek"${dis}>${[[5, "5 days (Mon–Fri)"], [6, "6 days (Mon–Sat)"], [7, "7 days"]].map(([v, n]) => `<option value="${v}"${v === st.perWeek ? " selected" : ""}>${n}</option>`).join("")}</select></label>
      <label>Pages per day (limit)<select data-s="maxEighths"${dis}>${pageOpts.map((e) => `<option value="${e}"${e === st.maxEighths ? " selected" : ""}>${P.fmtEighths(e)}</option>`).join("")}</select></label>
      <label>Default call<input type="time" value="${esc(st.call)}" data-s="call"${dis}></label>
    </div>`;

  const hasDocs = hub.hasSheets(pid);
  const docsNudge = hasDocs === false ? `<div class="ctlDocs">No budget or schedule sheets yet.${hub.isOwner(p) ? ` <button class="btn sm" type="button" data-a="create">Create production docs…</button>` : " The owner can create them."}</div>` : "";
  const n = S.notice[pid];
  const sceneName = (id) => { const s = byId[id]; return s ? "Sc " + s.n : "a deleted scene"; };
  const notice = n ? `<div class="ctlNote"><div><b>The script changed</b><ul>
      ${n.added.length ? `<li>${n.added.length} new scene${n.added.length === 1 ? "" : "s"} (${n.added.map(sceneName).join(", ")}) ${n.added.length === 1 ? "is" : "are"} in Unscheduled.${canEdit ? ` <button class="btn sm" type="button" data-a="placeNew">Place on suggested days</button>` : ""}</li>` : ""}
      ${n.removed.length ? `<li>${n.removed.length} deleted scene${n.removed.length === 1 ? " was" : "s were"} taken off ${Array.from(new Set(n.removed.map((r) => "Day " + r.day))).join(", ")}.</li>` : ""}
      ${(n.moved || []).length ? `<li>${n.moved.length} scene${n.moved.length === 1 ? "" : "s"} from removed days ${n.moved.length === 1 ? "is" : "are"} back in Unscheduled.</li>` : ""}
    </ul></div><button class="iconBtn x" type="button" data-a="dismiss" aria-label="Dismiss">✕</button></div>` : "";
  const warnBox = warns.length && S.warnOpen ? `<div class="ctlWarn">${warns.map((w) => `<div class="${w.level}">${w.level === "warn" ? "⚠ " : "• "}${esc(w.text)}</div>`).join("")}</div>` : "";

  const strip = (id) => {
    const s = byId[id]; if(!s) return "";
    const isNew = n && n.added.indexOf(id) >= 0;
    return `<button class="strip${S.pick === id ? " pick" : ""}${isNew ? " new" : ""}${S.landed && S.landed.id === id ? " landed" : ""}" type="button" data-sid="${esc(id)}" draggable="${canEdit}" style="--sc:${stripColor(s)}" title="${esc(s.heading)}">
      <div class="t">Sc ${s.n} · ${esc(s.ie || "")} ${esc(DN[s.dn] || "")}<span>${P.fmtEighths(s.eighths)} pg</span></div>
      <div class="l">${esc(s.set || s.loc || "")}</div>
      <div class="c">${s.cast && s.cast.length ? esc(s.cast.join(", ")) : "No cast"}</div></button>`;
  };
  const unsched = rec.unscheduled.slice().sort((a, b) => byId[a].n - byId[b].n);
  const cols = [`<div class="col${unsched.length ? "" : " none"}" data-day="-1"><div class="colHead"><b>Unscheduled</b><span class="dt">${unsched.length}</span>
      <div class="colMeta"><span>${P.fmtEighths(unsched.reduce((a, id) => a + byId[id].eighths, 0))} pages</span></div></div>
      <div class="strips">${unsched.length ? unsched.map(strip).join("") : `<div class="colEmpty">Every scene has a day ✓</div>`}</div></div>`]
    .concat(pl.days.map((d, i) => {
      const x = stats[i], pct = Math.min(100, Math.round(x.eighths / st.maxEighths * 100));
      return `<div class="col${x.over ? " over" : ""}${S.landed && S.landed.day === i ? " bump" : ""}" data-day="${i}">
        <div class="colHead"><b>Day ${i + 1}</b><label class="dtPick${d.date ? " pinned" : ""}" title="${d.date ? "Pinned to this date. Click to change" : "Click to pin this day to a date"}"><span>${esc(fmtDate(dates[i]) || "Set date")}${d.date ? " 📌" : ""}</span><input type="date" value="${esc(dates[i] || "")}" data-date="${i}"${dis}></label>${d.date && canEdit ? `<button type="button" class="unpin" data-a="unpin" data-day="${i}" title="Unpin: follow on from the day before">✕</button>` : ""}
          <div class="colMeta"><span>${P.fmtEighths(x.eighths)} / ${P.fmtEighths(st.maxEighths)} pg</span><span>${x.scenes} sc · ${x.cast.length} cast</span></div>
          <div class="cap"><i style="width:${pct}%"></i></div>
          <div class="colCall">Call <input type="time" value="${esc(d.call || st.call)}" data-call="${i}"${dis}>${x.locs.length ? `<span title="${esc(x.locs.join(", "))}">${x.locs.length} location${x.locs.length === 1 ? "" : "s"}</span>` : ""}</div></div>
        <div class="strips">${d.scenes.length ? d.scenes.map(strip).join("") : `<div class="colEmpty">${canEdit ? "Drag scenes here" : "No scenes"}</div>`}</div></div>`;
    })).join("");
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

  const cal = calendar(pl, dates, canEdit);
  const flagSec = flagsView(pl, bd, canEdit), locSec = locsView(pl, bd, canEdit);
  box.innerHTML = head(chips, acts) + `<div class="ctlBody">${settings}${cal}${docsNudge}${notice}${warnBox}${moveBar}<div class="board">${cols}</div>${dood}${flagSec}${locSec}
    <div class="ctlRO">${matchMedia("(hover:none)").matches ? "Tap a scene to move it to another day" : "Drag scenes between days (or click a scene to move it)"}. Changes save for the whole team straight away.</div></div>`;
  wire(box, pid, { bd, scriptId, plan: pl, dates });
}

/* ---------- script flags: keep / watch / ignore, for a flag everywhere or one scene ---------- */
const FLAGS_KEY = "Camp_PROD_FLAGS_OPEN_V1", LOCS_KEY = "Camp_PROD_LOCS_OPEN_V1";
function flagsView(pl, bd, canEdit){
  const list = bd.flags.filter((f) => f.scenes.length || (f.ignored || []).length);
  if(!list.length) return "";
  const glob = {}; (pl.flagStatus || []).forEach((x) => { if(!x.scene) glob[x.id] = x.s; });
  const sid = (n) => { const s = bd.scenes[n - 1]; return s ? (s.id || "n" + n) : ""; };
  const nIgn = list.filter((f) => glob[f.id] === "ignore").length, nWatch = list.filter((f) => glob[f.id] === "watch").length;
  return `<details class="dood fx" data-sec="flags"${lsGet(FLAGS_KEY) === "1" ? " open" : ""}><summary>Script flags · ${list.length}${nWatch ? " · " + nWatch + " watching" : ""}${nIgn ? " · " + nIgn + " ignored" : ""}</summary>
    <div class="fxNote">Wrong flag? Ignore it and it drops out of the warnings, budget and call sheets on the next Sync. Click a scene to ignore it just there. Watch keeps it, marked to check.</div>
    ${list.map((f) => {
      const g = glob[f.id] || "keep", all = f.scenes.concat(f.ignored || []).sort((a, b) => a - b);
      return `<div class="fxRow${g === "ignore" ? " ign" : g === "watch" ? " wat" : ""}">
        <div class="fxName"><b>${esc(f.label)}</b><span>${esc(f.use || "")}${f.words && f.words.length ? " · found: " + esc(f.words.slice(0, 4).join(", ")) : ""}</span></div>
        <div class="fxScenes">${all.map((n) => { const off = (f.ignored || []).indexOf(n) >= 0; return `<button type="button" class="fxSc${off ? " off" : ""}" data-a="fxsc" data-f="${esc(f.id)}" data-s="${esc(sid(n))}" data-on="${off ? 0 : 1}" title="${off ? "Ignored here: click to keep" : "Click to ignore in this scene"}"${canEdit ? "" : " disabled"}>Sc ${n}</button>`; }).join("")}</div>
        <div class="seg fxSeg">${["keep", "watch", "ignore"].map((v) => `<button type="button" class="${g === v ? "on" : ""}" data-a="fx" data-f="${esc(f.id)}" data-v="${v}"${canEdit ? "" : " disabled"}>${v[0].toUpperCase() + v.slice(1)}</button>`).join("")}</div>
      </div>`;
    }).join("")}</details>`;
}
/* ---------- locations: rooms that are really one place ---------- */
const ROOM_RE = /^(KITCHEN|LOUNGE|LOUNGE ROOM|LIVING ROOM|SITTING ROOM|DINING ROOM|FAMILY ROOM|BEDROOM|MASTER BEDROOM|.*'S BEDROOM|.*'S ROOM|BATHROOM|ENSUITE|TOILET|LAUNDRY|HALLWAY|HALL|CORRIDOR|STAIRS|STAIRCASE|LANDING|ATTIC|BASEMENT|CELLAR|GARAGE|STUDY|OFFICE|NURSERY|PANTRY|FRONT DOOR|BACK DOOR|PORCH|VERANDAH|VERANDA|BALCONY|BACKYARD|BACK YARD|FRONT YARD|YARD|GARDEN|DRIVEWAY|SHED|ROOFTOP)$/;
function locsView(pl, bd, canEdit){
  const orig = {}; bd.scenes.forEach((s) => { const o = s.oloc || s.loc; if(!o) return; (orig[o] = orig[o] || { n: 0, e: 0 }).n++; orig[o].e += s.eighths; });
  const names = Object.keys(orig); if(names.length < 2 && !(pl.locMerge || []).length) return "";
  const to = {}; (pl.locMerge || []).forEach((m) => { to[m.from] = m.to; });
  const groups = Array.from(new Set(names.map((n) => to[n] || n)));
  const rooms = names.filter((n) => ROOM_RE.test(n) && !to[n]);
  return `<details class="dood fx" data-sec="locs"${lsGet(LOCS_KEY) === "1" ? " open" : ""}><summary>Locations · ${groups.length} place${groups.length === 1 ? "" : "s"}${names.length !== groups.length ? " (" + names.length + " in the script)" : ""}</summary>
    <div class="fxNote">Rooms written as their own location (INT. KITCHEN, INT. LOUNGE) count as separate places, with company moves between them. If they're all one house, put them in one place: the schedule, budget and call sheets then treat them as sets of it.
      ${rooms.length > 1 && canEdit ? `<button type="button" class="btn sm" data-a="rooms" data-rooms="${esc(rooms.join("|"))}">Put ${rooms.length} rooms in one place…</button>` : ""}</div>
    ${names.sort((a, b) => orig[b].e - orig[a].e).map((n) => `<div class="fxRow"><div class="fxName"><b>${esc(n)}</b><span>${orig[n].n} scene${orig[n].n === 1 ? "" : "s"} · ${P.fmtEighths(orig[n].e)} pg</span></div>
      <label class="fxIn">Part of <select data-loc="${esc(n)}"${canEdit ? "" : " disabled"}><option value="">Its own location</option>${groups.filter((g) => g !== n).map((g) => `<option value="${esc(g)}"${to[n] === g ? " selected" : ""}>${esc(g)}</option>`).join("")}<option value="__new">New place…</option></select></label></div>`).join("")}
  </details>`;
}

/* ---------- calendar: the shoot at a glance; click a date to make it a day off (or a shoot day again) ---------- */
function calendar(pl, dates, canEdit){
  const st = pl.settings, set = dates.filter(Boolean);
  if(!set.length) return "";
  const dayOf = {}; dates.forEach((d, i) => { if(d) dayOf[d] = i; });
  const off = new Set(st.off || []);
  const first = P.parseISO(set.reduce((a, b) => a < b ? a : b)), last = P.parseISO(set.reduce((a, b) => a > b ? a : b));
  const d = new Date(first.getTime()); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));          // back to Monday
  const end = new Date(last.getTime()); end.setUTCDate(end.getUTCDate() + (6 - (end.getUTCDay() + 6) % 7)); // on to Sunday
  const work = (dow) => st.perWeek === 7 ? true : st.perWeek === 6 ? dow !== 0 : (dow !== 0 && dow !== 6);
  const cells = []; let n = 0;
  while(d <= end && n++ < 7 * 16){
    const iso = d.toISOString().slice(0, 10), i = dayOf[iso], dow = d.getUTCDay();
    const cls = i != null ? "shoot" + (pl.days[i].date ? " pin" : "") : off.has(iso) ? "off" : work(dow) ? "free" : "rest";
    const label = d.getUTCDate() === 1 || !cells.length ? d.toLocaleDateString(undefined, { day: "numeric", month: "short", timeZone: "UTC" }) : String(d.getUTCDate());
    const tip = i != null ? "Day " + (i + 1) + (pl.days[i].date ? " (pinned)" : "") + (canEdit && !pl.days[i].date ? ": click to make this a day off" : "") : off.has(iso) ? "Day off: click to shoot again" : work(dow) ? "Not needed" : "Weekend (Shooting week setting)";
    cells.push(`<button type="button" class="cd ${cls}" data-a="cal" data-iso="${iso}" title="${esc(tip)}"${canEdit && (cls === "off" || (cls.indexOf("shoot") === 0 && !pl.days[i].date)) ? "" : " disabled"}><span>${esc(label)}</span>${i != null ? `<b>D${i + 1}</b>` : off.has(iso) ? "<b>off</b>" : ""}</button>`);
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return `<div class="cal"><div class="calHead"><b>Calendar</b><span>Click a shoot day to make it a day off; the days after it move along. Pin a day to a date in its column.${(st.off || []).length ? " " + st.off.length + " day" + (st.off.length === 1 ? "" : "s") + " off." : ""}</span></div>
    <div class="calGrid">${["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((w) => `<i>${w}</i>`).join("")}${cells.join("")}</div></div>`;
}

/* ---------- call sheets ---------- */
function csView(pid, p, raw, pl, dates, scriptId){
  const hub = H(), owner = hub.isOwner(p), cs = raw && raw.callsheets;
  const days = cs ? (Array.isArray(cs.days) ? cs.days : Object.values(cs.days || {})) : [];
  const err = S.csErr[pid];
  const when = cs && cs.at ? new Date(cs.at).toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "";
  const stale = cs && raw.updatedAt && cs.at && raw.updatedAt > cs.at + 5000;
  const auth = err && /permission|authori[sz]|scope|Google needs your OK/i.test(err);
  const errBox = err ? `<div class="csErr"><b>${auth ? "Google hasn't allowed Camp to make Docs yet" : "The call sheets didn't build"}</b>
      ${auth ? `<ol><li>Open your Camp script in Apps Script (script.google.com).</li><li>Pick <code>authorizeCallSheets</code> in the function list and press Run. Allow the permissions Google asks for.</li><li>Deploy › Manage deployments › edit › New version › Deploy.</li><li>Come back and press <b>Make call sheets</b>.</li></ol>` : `<div>${esc(err)}</div>`}</div>` : "";
  if(!raw) return `<div class="csWrap"><h3>No shoot plan yet</h3><p>Call sheets follow the plan. Start it on the Plan tab first.</p></div>`;
  const list = days.length ? `<div class="csList">${days.map((d) => { const i = Number(d.day) - 1; return `<a class="csDay${stale ? " stale" : ""}" href="${esc(d.url)}" target="_blank" rel="noopener"><b>Day ${esc(d.day)} ↗</b><span>${esc(fmtDate(dates[i]) || "")}${pl.days[i] ? " · " + pl.days[i].scenes.length + " scene" + (pl.days[i].scenes.length === 1 ? "" : "s") : ""}</span></a>`; }).join("")}</div>` : "";
  return `<div class="csWrap">
    <p>One Google Doc per shoot day: call times, scenes, cast, crew, weather, sunrise and safety checks from your master sheet. ${days.length ? `Last made ${esc(when)}.` : ""}${stale ? " <b style=\"color:#f1c76b\">The plan changed since then.</b>" : ""}</p>
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
    const a = e.target.closest("[data-a]"), sEl = e.target.closest(".strip");
    if(a){
      const k = a.dataset.a;
      if(k !== "menu") S.menu = false;
      if(k === "menu"){ S.menu = !S.menu; render(pid); return; }
      if(k === "warns"){ S.warnOpen = !S.warnOpen; render(pid); return; }
      if(k === "create"){ hub.createDocs(a); return; }
      if(k === "fx" && canEdit){
        const id = a.dataset.f, v = a.dataset.v;
        update((plan) => { plan.flagStatus = (plan.flagStatus || []).filter((x) => x.scene || x.id !== id); if(v !== "keep") plan.flagStatus.push({ id, scene: "", s: v }); if(v === "keep") plan.flagStatus = plan.flagStatus.filter((x) => x.id !== id); });
        H().toast(v === "ignore" ? "Flag ignored. It drops out of the docs on the next Sync." : v === "watch" ? "Flag kept and marked to watch." : "Flag kept.", "ok", 2200); return;
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
        const name = (prompt("What's the location called? (e.g. HOUSE)\n\nThese rooms become sets of it: " + rooms.join(", "), "HOUSE") || "").trim().toUpperCase();
        if(!name) return;
        update((plan) => { plan.locMerge = (plan.locMerge || []).filter((m) => rooms.indexOf(m.from) < 0).concat(rooms.filter((r) => r !== name).map((r) => ({ from: r, to: name }))); });
        H().toast(rooms.length + " rooms are now sets of " + name + ".", "ok", 2200); return;
      }
      if(k === "unpin" && canEdit){ update((plan) => { const d = plan.days[Number(a.dataset.day)]; if(d) d.date = ""; }); return; }
      if(k === "cal" && canEdit){
        const iso = a.dataset.iso;
        update((plan) => { const off = new Set(plan.settings.off || []); off.has(iso) ? off.delete(iso) : off.add(iso); plan.settings.off = Array.from(off).sort(); });
        H().toast(new Set(planOf(pid).settings.off).has(iso) ? "Day off. The shoot days after it move along." : "Shoot day again.", "ok", 1800);
        return;
      }
      if(k === "cs"){ flush(); hub.makeCallsheets(pid, ctx.scriptId, a); return; }
      if(k === "pop"){ window.open(location.pathname + "?pid=" + encodeURIComponent(pid) + "&tab=production&popout=1", "campProdPop", "popup=yes,width=1280,height=900"); return; }
      if(k === "reload"){ loadScript(ctx.scriptId || hub.scriptIds(p)[0], true); return; }
      if(k === "dismiss"){ delete S.notice[pid]; render(pid); return; }
      if(k === "sync"){ flush(); hub.syncSheets(pid, ctx.scriptId, a); return; }
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
      if(k === "auto" || k === "reauto"){
        if(k === "reauto" && !confirm("Lay out every scene again from scratch? Scenes you've arranged by hand will move.")) return;
        const r = P.autoSchedule(planOf(pid), ctx.bd, { all: k === "reauto" });
        save(pid, r.plan); rerender();
        if(r.unplaced.length) hub.toast(r.unplaced.length + " scene" + (r.unplaced.length === 1 ? " doesn't" : "s don't") + " fit in " + r.plan.settings.days + " days at this page limit. Add days or raise the limit.");
        return;
      }
      if(k === "placeNew"){
        const n = S.notice[pid]; if(!n) return;
        update((plan) => { n.added.forEach((id) => { const i = P.suggestDay(id, plan, ctx.bd); if(i >= 0 && !plan.days.some((d) => d.scenes.indexOf(id) >= 0)) plan.days[i].scenes.push(id); }); });
        n.added = []; if(!n.removed.length) delete S.notice[pid];
        return;
      }
    }
    if(S.menu && !e.target.closest(".ctlMenu")){ S.menu = false; render(pid); return; }
    if(sEl && canEdit){ S.pick = S.pick === sEl.dataset.sid ? null : sEl.dataset.sid; render(pid); }
  };
  box.onchange = (e) => {
    const t = e.target; if(!canEdit) return;
    if(t.dataset.move){ moveScene(pid, t.dataset.move, Number(t.value), -1); S.pick = null; return; }
    if(t.dataset.loc != null){
      const from = t.dataset.loc; let to = t.value;
      if(to === "__new"){ to = (prompt("Name of the place " + from + " is part of (e.g. HOUSE):", "") || "").trim().toUpperCase(); if(!to){ rerender(); return; } }
      update((plan) => { plan.locMerge = (plan.locMerge || []).filter((m) => m.from !== from); if(to && to !== from) plan.locMerge.push({ from, to }); });
      return;
    }
    if(t.dataset.date != null){ update((plan) => { const d = plan.days[Number(t.dataset.date)]; if(d) d.date = t.value || ""; }); return; }
    if(t.dataset.call != null){ update((plan) => { const d = plan.days[Number(t.dataset.call)]; if(d) d.call = t.value === plan.settings.call ? "" : t.value; }); return; }
    const k = t.dataset.s; if(!k) return;
    if(k === "days"){ const r = P.resizeDays(planOf(pid), Number(t.value)); confirmShrink(pid, r); return; }
    if(k === "script"){ update((plan) => { plan.scriptId = t.value; }); return; }
    update((plan) => { plan.settings[k] = (k === "start" || k === "call") ? t.value : Number(t.value); });
  };
  const det = box.querySelector("details.dood:not(.fx)"); if(det) det.ontoggle = () => { S.doodOpen = det.open; lsSet(DOOD_KEY, det.open ? "1" : "0"); };
  box.querySelectorAll("details.fx").forEach((d) => { d.ontoggle = () => lsSet(d.dataset.sec === "flags" ? FLAGS_KEY : LOCS_KEY, d.open ? "1" : "0"); });
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
function moveScene(pid, id, toDay, at){
  const plan = planOf(pid);
  const from = plan.days.findIndex((d) => d.scenes.indexOf(id) >= 0);
  plan.days.forEach((d) => { d.scenes = d.scenes.filter((x) => x !== id); });
  if(toDay >= 0 && plan.days[toDay]){ const list = plan.days[toDay].scenes; if(at < 0 || at > list.length) list.push(id); else list.splice(at, 0, id); }
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
function confirmShrink(pid, r){
  if(r.moved.length && !confirm("Removing days puts " + r.moved.length + " scene" + (r.moved.length === 1 ? "" : "s") + " back in Unscheduled. Continue?")){ rerender(); return; }
  if(r.moved.length) S.notice[pid] = Object.assign({ added: [], removed: [] }, S.notice[pid] || {}, { moved: r.moved });
  save(pid, r.plan); rerender();
}

function setMode(m){ if(S.popout) m = "plan"; if(m === S.mode) return; S.mode = m; S.menu = false; rerender(); }
function csError(pid, msg){ if(msg) S.csErr[pid] = msg; else delete S.csErr[pid]; rerender(); }
document.addEventListener("keydown", (e) => { if(e.key === "Escape" && S.menu){ S.menu = false; rerender(); } });
window.CampProdPanel = { render, setMode, csError, reloadScript: (id) => loadScript(id, true) };
})();
