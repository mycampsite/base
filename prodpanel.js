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
  open: lsGet(OPEN_KEY) !== "0",
  doodOpen: lsGet(DOOD_KEY) === "1",
  scripts: {},           // scriptId -> { state:"loading"|"ok"|"error", bd, err, modified }
  notice: {},            // pid -> { added:[], removed:[], moved:[] } shown until dismissed
  pick: null,            // scene id chosen for "move to…" (click / touch)
  drag: null,            // scene id being dragged
  pid: null
};

/* ---------- styles ---------- */
const css = `
#ctl{ border-bottom:1px solid var(--uiBorder); background:#171717; display:flex; flex-direction:column; min-height:0; }
#ctl.open{ max-height:72%; }
#ctl.full{ max-height:none; flex:1; }
#prodPane:has(#ctl.full) > :not(#ctl){ display:none !important; }
#ctl:empty{ display:none; }
.ctlHead{ display:flex; align-items:center; gap:10px; padding:8px 10px; min-height:48px; flex-wrap:wrap; }
.ctlTitle{ display:flex; align-items:center; gap:8px; background:none; border:0; padding:4px 6px; border-radius:8px; cursor:pointer; font-weight:700; font-size:13.5px; }
.ctlTitle:hover{ background:rgba(255,255,255,.06); }
.ctlTitle svg{ width:15px; height:15px; transition:transform .15s; }
#ctl:not(.open) .ctlTitle svg.car{ transform:rotate(-90deg); }
.ctlChips{ display:flex; gap:6px; flex-wrap:wrap; flex:1; min-width:0; }
.ctlChip{ font-size:11.5px; color:var(--uiMuted); border:1px solid var(--uiBorder); border-radius:999px; padding:2px 9px; white-space:nowrap; }
.ctlChip.warn{ color:#f1c76b; border-color:rgba(241,199,107,.4); }
.ctlChip.ok{ color:#8fe3a6; border-color:rgba(143,227,166,.35); }
.ctlBody{ overflow:auto; padding:0 10px 12px; min-height:0; }
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
.strip .t{ display:flex; justify-content:space-between; gap:6px; font-weight:700; }
.strip .t span{ color:var(--uiMuted); font-weight:600; white-space:nowrap; }
.strip .l{ color:#ddd; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.strip .c{ color:var(--uiMuted); font-size:11px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.colEmpty{ color:var(--uiMuted); font-size:12px; padding:8px 4px; text-align:center; }
.moveBar{ position:sticky; left:0; display:flex; gap:8px; align-items:center; flex-wrap:wrap; margin-top:10px; padding:8px 10px; border-radius:10px; background:#202634; border:1px solid rgba(91,140,255,.35); font-size:12.5px; }
.moveBar select{ height:30px; border-radius:8px; border:1px solid var(--uiBorder); background:#111; padding:0 8px; }
.dood{ margin-top:12px; border:1px solid var(--uiBorder); border-radius:12px; overflow:hidden; }
.dood summary{ cursor:pointer; padding:9px 12px; font-weight:700; font-size:13px; }
.doodWrap{ overflow-x:auto; }
.dood table{ border-collapse:collapse; font-size:12px; min-width:100%; }
.dood th, .dood td{ border-top:1px solid var(--uiBorder); padding:5px 8px; text-align:center; white-space:nowrap; }
.dood th:first-child, .dood td:first-child{ text-align:left; position:sticky; left:0; background:#1b1b1b; }
.dood td.W, .dood td.SW, .dood td.WF, .dood td.SWF{ background:rgba(143,227,166,.16); color:#bff0cc; font-weight:700; }
.dood td.H{ background:rgba(241,199,107,.12); color:#f1c76b; }
.ctlEmpty{ padding:18px 6px; color:var(--uiMuted); display:flex; gap:10px; align-items:center; flex-wrap:wrap; }
.ctlRO{ font-size:11.5px; color:var(--uiMuted); }
@media (max-width:760px){
  #ctl.open{ max-height:none; flex:1; }
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
  S.scripts[id] = { state: "loading", bd: cur && cur.bd, modified: mod };
  rerender();
  try{
    const res = await hub.ripGet({ action: "load", fileId: id });
    if(!res || res.ok === false || !res.doc) throw new Error((res && res.error) || "Couldn't read the script.");
    S.scripts[id] = { state: "ok", bd: B.analyze(res.doc), modified: mod, at: Date.now() };
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
  box.className = S.open ? "open" + (S.full ? " full" : "") : "";

  const head = (chips, acts) => `<div class="ctlHead">
      <button class="ctlTitle" type="button" data-a="toggle" aria-expanded="${S.open}"><svg class="car" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="m6 9 6 6 6-6"/></svg>Production control</button>
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
  const bd = sc.bd, byId = P.sceneMap(bd);

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
  const pl = rec.plan, st = pl.settings, dates = P.shootDates(st.start, st.days, st.perWeek);
  const stats = pl.days.map((d) => P.dayStats(d, byId, st.maxEighths));
  const warns = P.validate(pl, bd);
  const scheduled = bd.scenes.filter((s) => s.id).length - rec.unscheduled.length;
  const nWarn = warns.filter((w) => w.level === "warn").length;
  const chips = `<span class="ctlChip">${st.days} shoot day${st.days === 1 ? "" : "s"}${st.start ? " · from " + esc(fmtDate(dates[0])) : ""}</span>
    <span class="ctlChip">${bd.scenes.length} scenes · ${P.fmtEighths(bd.totals.eighths)} pages</span>
    <span class="ctlChip ${rec.unscheduled.length ? "warn" : "ok"}">${scheduled}/${bd.scenes.filter((s) => s.id).length} scheduled</span>
    ${nWarn ? `<span class="ctlChip warn">${nWarn} to check</span>` : ""}
    ${sc.state === "loading" ? `<span class="ctlChip">Updating from script…</span>` : ""}
    ${!canEdit ? `<span class="ctlChip">View only</span>` : ""}`;
  const acts = S.open ? `<div class="ctlActs">
      <button class="btn sm" type="button" data-a="full" title="${S.full ? "Show the sheets again" : "Use the whole screen"}">${S.full ? "Show sheets" : "Expand"}</button></div>` : "";
  if(!S.open){ box.innerHTML = head(chips); wire(box, pid, { bd, scriptId }); return; }

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
      <div class="ctlActs">
        ${canEdit ? `<button class="btn sm" type="button" data-a="auto" title="Place unscheduled scenes on days with room, keeping locations together">Auto-schedule</button>
        <button class="btn sm" type="button" data-a="reauto" title="Lay out every scene again from scratch">Re-plan all</button>` : ""}
        <button class="btn sm" type="button" data-a="reload" title="Read the latest version of the script">Refresh script</button>
        ${hub.isOwner(p) ? `<button class="btn sm primary" type="button" data-a="sync" title="Rebuild the Schedule (with Day Out of Days) and the Budget from this plan">Sync to Sheets</button>` : ""}
      </div>
    </div>`;

  const cs = raw.callsheets, csDays = cs ? (Array.isArray(cs.days) ? cs.days : Object.values(cs.days || {})) : [];
  const csRow = csDays.length ? `<div class="ctlCs"><b>Call sheets</b>${csDays.map((d) => `<a href="${esc(d.url)}" target="_blank" rel="noopener">Day ${esc(d.day)}</a>`).join("")}${cs.folderUrl ? `<a href="${esc(cs.folderUrl)}" target="_blank" rel="noopener" class="fold">All in Drive ↗</a>` : ""}<span>Synced ${esc(new Date(cs.at || 0).toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }))}</span></div>` : "";
  const n = S.notice[pid];
  const sceneName = (id) => { const s = byId[id]; return s ? "Sc " + s.n : "a deleted scene"; };
  const notice = n ? `<div class="ctlNote"><div><b>The script changed</b><ul>
      ${n.added.length ? `<li>${n.added.length} new scene${n.added.length === 1 ? "" : "s"} (${n.added.map(sceneName).join(", ")}) ${n.added.length === 1 ? "is" : "are"} in Unscheduled.${canEdit ? ` <button class="btn sm" type="button" data-a="placeNew">Place on suggested days</button>` : ""}</li>` : ""}
      ${n.removed.length ? `<li>${n.removed.length} deleted scene${n.removed.length === 1 ? " was" : "s were"} taken off ${Array.from(new Set(n.removed.map((r) => "Day " + r.day))).join(", ")}.</li>` : ""}
      ${(n.moved || []).length ? `<li>${n.moved.length} scene${n.moved.length === 1 ? "" : "s"} from removed days ${n.moved.length === 1 ? "is" : "are"} back in Unscheduled.</li>` : ""}
    </ul></div><button class="iconBtn x" type="button" data-a="dismiss" aria-label="Dismiss">✕</button></div>` : "";
  const warnBox = warns.length ? `<div class="ctlWarn">${warns.map((w) => `<div class="${w.level}">${w.level === "warn" ? "⚠ " : "• "}${esc(w.text)}</div>`).join("")}</div>` : "";

  const strip = (id) => {
    const s = byId[id]; if(!s) return "";
    const isNew = n && n.added.indexOf(id) >= 0;
    return `<button class="strip${S.pick === id ? " pick" : ""}${isNew ? " new" : ""}" type="button" data-sid="${esc(id)}" draggable="${canEdit}" style="--sc:${stripColor(s)}" title="${esc(s.heading)}">
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
      return `<div class="col${x.over ? " over" : ""}" data-day="${i}">
        <div class="colHead"><b>Day ${i + 1}</b><span class="dt">${esc(fmtDate(dates[i]))}</span>
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

  const rows = P.dood(pl, bd).filter((r) => r.workDays);
  const dood = `<details class="dood"${S.doodOpen ? " open" : ""}><summary>Day Out of Days · ${rows.length} cast</summary><div class="doodWrap"><table>
      <tr><th>Cast</th>${pl.days.map((d, i) => `<th>D${i + 1}</th>`).join("")}<th>Work</th><th>Hold</th><th>Total</th></tr>
      ${rows.map((r) => `<tr><td>${esc(r.name)}</td>${r.marks.map((m) => `<td class="${m}">${m}</td>`).join("")}<td>${r.workDays}</td><td>${r.holdDays}</td><td><b>${r.total}</b></td></tr>`).join("")}
    </table></div></details>`;

  box.innerHTML = head(chips, acts) + `<div class="ctlBody">${settings}${csRow}${notice}${warnBox}${moveBar}<div class="board">${cols}</div>${dood}
    <div class="ctlRO">${matchMedia("(hover:none)").matches ? "Tap a scene to move it to another day" : "Drag scenes between days (or click a scene to move it)"}. Changes save for the whole team straight away.</div></div>`;
  wire(box, pid, { bd, scriptId, plan: pl, dates });
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
      if(k === "toggle"){ S.open = !S.open; lsSet(OPEN_KEY, S.open ? "1" : "0"); if(!S.open) S.full = false; render(pid); hub.layoutChanged(); return; }
      if(k === "full"){ S.full = !S.full; render(pid); hub.layoutChanged(); return; }
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
    if(sEl && canEdit){ S.pick = S.pick === sEl.dataset.sid ? null : sEl.dataset.sid; render(pid); }
  };
  box.onchange = (e) => {
    const t = e.target; if(!canEdit) return;
    if(t.dataset.move){ moveScene(pid, t.dataset.move, Number(t.value), -1); S.pick = null; return; }
    if(t.dataset.call != null){ update((plan) => { const d = plan.days[Number(t.dataset.call)]; if(d) d.call = t.value === plan.settings.call ? "" : t.value; }); return; }
    const k = t.dataset.s; if(!k) return;
    if(k === "days"){ const r = P.resizeDays(planOf(pid), Number(t.value)); confirmShrink(pid, r); return; }
    if(k === "script"){ update((plan) => { plan.scriptId = t.value; }); return; }
    update((plan) => { plan.settings[k] = (k === "start" || k === "call") ? t.value : Number(t.value); });
  };
  const det = box.querySelector("details.dood"); if(det) det.ontoggle = () => { S.doodOpen = det.open; lsSet(DOOD_KEY, det.open ? "1" : "0"); };
  if(!canEdit) return;
  // drag and drop between columns
  box.ondragstart = (e) => { const s = e.target.closest(".strip"); if(!s) return; S.drag = s.dataset.sid; try{ e.dataTransfer.setData("text/plain", S.drag); e.dataTransfer.effectAllowed = "move"; }catch(_e){} };
  box.ondragend = () => { S.drag = null; box.querySelectorAll(".col.drop").forEach((c) => c.classList.remove("drop")); rerender(); };
  box.ondragover = (e) => { const c = e.target.closest(".col"); if(!c || !S.drag) return; e.preventDefault(); box.querySelectorAll(".col.drop").forEach((x) => x !== c && x.classList.remove("drop")); c.classList.add("drop"); };
  box.ondrop = (e) => {
    const c = e.target.closest(".col"); if(!c || !S.drag) return; e.preventDefault();
    const id = S.drag, over = e.target.closest(".strip"); S.drag = null;
    let at = -1;
    if(over && over.dataset.sid !== id){ const list = Array.from(c.querySelectorAll(".strip")).map((x) => x.dataset.sid).filter((x) => x !== id); at = list.indexOf(over.dataset.sid); const r = over.getBoundingClientRect(); if(e.clientY > r.top + r.height / 2) at++; }
    moveScene(pid, id, Number(c.dataset.day), at);
  };
}
function moveScene(pid, id, toDay, at){
  const plan = planOf(pid);
  plan.days.forEach((d) => { d.scenes = d.scenes.filter((x) => x !== id); });
  if(toDay >= 0 && plan.days[toDay]){ const list = plan.days[toDay].scenes; if(at < 0 || at > list.length) list.push(id); else list.splice(at, 0, id); }
  save(pid, plan); rerender();
}
function confirmShrink(pid, r){
  if(r.moved.length && !confirm("Removing days puts " + r.moved.length + " scene" + (r.moved.length === 1 ? "" : "s") + " back in Unscheduled. Continue?")){ rerender(); return; }
  if(r.moved.length) S.notice[pid] = Object.assign({ added: [], removed: [] }, S.notice[pid] || {}, { moved: r.moved });
  save(pid, r.plan); rerender();
}

window.CampProdPanel = { render, reloadScript: (id) => loadScript(id, true) };
})();
