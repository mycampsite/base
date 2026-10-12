/* bdpanel.js — the Breakdown tab in the hub's Production section.
   Scene-by-scene breakdown sheets (the elements each scene needs, by industry category), an Elements manager
   (rename, merge, recategorise, ignore, notes) and per-category reports with a CSV export.
   It reads the script with breakdown.js, builds elements with elements.js, and shows them.
   Needs: breakdown.js, production.js, elements.js and window.__CampHub (set up by index.html).
   Edits are shared with the team at projects/<pid>/breakdown/<scriptId> (Firebase), one small entry at a time,
   and this device keeps a copy so the editor can colour tags (see `local` and `sync` below). */
(function(){
"use strict";
const B = window.CampBreakdown, P = window.CampProduction, E = window.CampElements;
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;" }[c]));
const lsGet = (k) => { try{ return localStorage.getItem(k); }catch(_e){ return null; } };
const lsSet = (k, v) => { try{ localStorage.setItem(k, v); }catch(_e){} };
const H = () => window.__CampHub;
const VIEW_KEY = "Camp_BD_VIEW_V1", NOTE_KEY = "Camp_BD_NOTE_V1";

/* ---------- where edits live ----------
   The team's copy: projects/<pid>/breakdown/<scriptId> in Firebase. The hub already listens to the whole
   project, so it arrives live as project.breakdown. This device keeps:
     Camp_BD_V1_<sid>          a copy of the store (the editor reads it to colour tags)
     Camp_BD_PENDING_V1_<sid>  tags made in the editor, waiting for the hub to upload them
     Camp_BD_UNSYNCED_V1_<sid> "1" when this device has edits the team doesn't (made offline, before sync
                               existed, or while the database refused them); they're merged in, never dropped */
const local = {
  key: (sid) => "Camp_BD_V1_" + sid,
  load(pid, sid){
    try{
      let raw = lsGet(this.key(sid));
      if(raw == null){ raw = lsGet("Camp_BD_V1_" + pid + "_" + sid); if(raw != null){ lsSet(this.key(sid), raw); this.dirty(sid, true); } }   // device-only edits from before
      const v = JSON.parse(raw || "{}"); return v && typeof v === "object" ? v : {};
    }catch(_e){ return {}; }
  },
  save(sid, st){ lsSet(this.key(sid), JSON.stringify(st || {})); },
  pending(sid){ try{ const v = JSON.parse(lsGet("Camp_BD_PENDING_V1_" + sid) || "[]"); return Array.isArray(v) ? v : []; }catch(_e){ return []; } },
  clearPending(sid, n){ const rest = this.pending(sid).slice(n); if(rest.length) lsSet("Camp_BD_PENDING_V1_" + sid, JSON.stringify(rest)); else { try{ localStorage.removeItem("Camp_BD_PENDING_V1_" + sid); }catch(_e){} } },
  // never synced from this device and there's something here: treat it as unshared
  isDirty(sid){ const d = lsGet("Camp_BD_UNSYNCED_V1_" + sid); if(d != null) return d === "1"; const raw = lsGet(this.key(sid)); return !!(raw && raw !== "{}"); },
  dirty(sid, on){ lsSet("Camp_BD_UNSYNCED_V1_" + sid, on ? "1" : "0"); }
};

const S = {
  on: false, pid: null,
  view: lsGet(VIEW_KEY) || "sheets",   // sheets | elements | reports
  scripts: {},                          // scriptId -> { state, doc, bd, err, modified }
  stores: {},                           // pid|scriptId -> store
  model: null, modelKey: "",
  sel: 1,                               // scene number open on the Sheets view
  cat: "all", q: "", rpBy: "cat",                    // Elements view filter
  adding: null,                         // { sk, cat } adding an element by hand
  edit: null,                           // element key being edited
  share: {},                            // pid|scriptId -> "ok" | "denied" | "error" | "off" (no database)
  seen: {},                             // pid|scriptId -> the team copy last taken in (JSON)
  inflight: {},                         // pid|scriptId -> changes sent and not yet confirmed
  scriptPick: {},                       // pid -> script chosen here (this device only; the shared plan isn't touched)
  hist: {}                              // pid|scriptId -> { undo:[json], redo:[json] }
};

const css = `
#bdctl{ display:none; flex-direction:column; flex:1; min-height:0; background:#171717; }
#bdctl.on{ display:flex; }
#bdctl .bdTop{ display:flex; align-items:center; gap:10px; flex-wrap:wrap; padding:8px 12px; min-height:48px; border-bottom:1px solid var(--uiBorder); }
#bdctl .bdTitle{ font-weight:700; font-size:14px; padding:0 4px; }
#bdctl .bdChips{ display:flex; gap:6px; flex-wrap:wrap; flex:1; min-width:0; }
#bdctl .bdChip{ font-size:11.5px; color:var(--uiMuted); border:1px solid var(--uiBorder); border-radius:999px; padding:2px 9px; white-space:nowrap; }
#bdctl .bdChip.warn{ color:#f1c76b; border-color:rgba(241,199,107,.4); }
#bdctl .bdActs{ margin-left:auto; display:flex; gap:8px; align-items:center; flex-wrap:wrap; }
#bdctl .seg{ display:inline-flex; gap:2px; padding:3px; border-radius:10px; background:rgba(255,255,255,.06); border:1px solid rgba(255,255,255,.1); }
#bdctl .seg button{ border:0; background:transparent; padding:5px 12px; height:auto; border-radius:7px; font-size:12.5px; font-weight:600; cursor:pointer; color:rgba(255,255,255,.6); white-space:nowrap; }
#bdctl .seg button.on{ background:rgba(255,255,255,.14); color:#fff; }
#bdctl .bdBody{ flex:1; min-height:0; overflow:auto; padding:0 12px 24px; overscroll-behavior:contain; }
#bdctl .bdLoad{ flex:1; min-height:min(60vh,520px); display:flex; flex-direction:column; align-items:center; justify-content:center; gap:10px; text-align:center; color:var(--uiMuted); font-size:12.5px; }
#bdctl .bdLoad b{ color:var(--uiText); font-size:14px; font-weight:600; }
#bdctl .bdEmpty{ padding:22px 6px; color:var(--uiMuted); font-size:13px; line-height:1.55; }
#bdctl .bdNote{ margin:10px 0 0; padding:8px 12px; border-radius:10px; background:rgba(241,199,107,.08); border:1px solid rgba(241,199,107,.3); font-size:12px; color:#e6d3a0; line-height:1.5; }
/* sheets view */
#bdctl .bdBody.split{ overflow:hidden; display:flex; flex-direction:column; }
#bdctl .bdSplit{ display:grid; grid-template-columns:250px minmax(0,1fr); grid-template-rows:minmax(0,1fr); gap:14px; padding-top:12px; flex:1; min-height:0; }
#bdctl .bdSheet{ overflow:auto; min-height:0; overscroll-behavior:contain; padding-bottom:20px; }
#bdctl .shMeta label{ display:flex; flex-direction:column; gap:3px; }
#bdctl .bdList{ display:flex; flex-direction:column; gap:5px; height:100%; min-height:0; overflow:auto; padding:2px 4px 14px 0; overscroll-behavior:contain; }
#bdctl .bdSc{ text-align:left; width:100%; border:1px solid rgba(255,255,255,.08); border-left:5px solid var(--sc,#ddd); border-radius:8px; padding:6px 8px; background:color-mix(in srgb, var(--sc,#ddd) 8%, #1b1b1b); cursor:pointer; font:inherit; font-size:12px; color:inherit; }
#bdctl .bdSc:hover{ border-color:rgba(255,255,255,.25); border-left-color:var(--sc,#ddd); }
#bdctl .bdSc.on{ border-left-color:#fff; border-left-width:6px; background:color-mix(in srgb, var(--sc,#ddd) 16%, #262626); border-color:rgba(255,255,255,.35); border-left-color:#fff; }
#bdctl .bdSc .t{ display:flex; justify-content:space-between; gap:6px; font-weight:700; }
#bdctl .bdSc .t span{ color:var(--uiMuted); font-weight:600; white-space:nowrap; }
#bdctl .bdSc .l{ color:#ddd; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
#bdctl .bdSc .dots{ display:flex; gap:2px; margin-top:4px; flex-wrap:wrap; }
#bdctl .bdSc .dots i{ width:7px; height:7px; border-radius:50%; display:block; }
#bdctl .bdSheet{ border:1px solid var(--uiBorder); border-radius:12px; background:#1b1b1b; min-width:0; }
#bdctl .shHead{ display:flex; gap:10px; align-items:center; padding:10px 14px; border-bottom:1px solid var(--uiBorder); border-left:6px solid var(--sc,#ddd); border-radius:12px 12px 0 0; flex-wrap:wrap; }
#bdctl .shHead h3{ margin:0; font-size:15px; flex:1; min-width:180px; }
#bdctl .shHead .nav{ display:flex; gap:6px; }
#bdctl .shMeta{ display:flex; flex-wrap:wrap; gap:10px 16px; padding:10px 14px; border-bottom:1px solid var(--uiBorder); font-size:12px; color:var(--uiMuted); align-items:flex-end; }
#bdctl .shMeta label{ display:flex; flex-direction:column; gap:3px; font-size:10.5px; text-transform:uppercase; letter-spacing:.05em; }
#bdctl .shMeta b{ color:var(--uiText); font-size:13px; text-transform:none; letter-spacing:0; }
#bdctl input[type=text], #bdctl input[type=number], #bdctl select, #bdctl textarea{ border-radius:8px; border:1px solid var(--uiBorder); background:#111; color:inherit; font:inherit; font-size:13px; padding:0 8px; height:30px; text-transform:none; letter-spacing:0; }
#bdctl textarea{ height:auto; padding:7px 9px; width:100%; resize:vertical; line-height:1.45; }
#bdctl .shSyn{ padding:10px 14px; border-bottom:1px solid var(--uiBorder); }
#bdctl .shSyn label{ display:block; font-size:10.5px; text-transform:uppercase; letter-spacing:.05em; color:var(--uiMuted); margin-bottom:4px; }
#bdctl .shCats{ display:grid; grid-template-columns:repeat(auto-fill,minmax(270px,1fr)); gap:10px; padding:12px 14px 14px; }
#bdctl .cat{ border:1px solid color-mix(in srgb, var(--cc) 55%, #222); border-radius:10px; background:color-mix(in srgb, var(--cc) 7%, #181818); overflow:hidden; }
#bdctl .cat > .ch{ display:flex; align-items:center; gap:6px; padding:5px 9px; background:color-mix(in srgb, var(--cc) 22%, #181818); font-size:11.5px; font-weight:700; letter-spacing:.03em; }
#bdctl .cat > .ch i{ width:9px; height:9px; border-radius:50%; background:var(--cc); display:block; }
#bdctl .cat > .ch .add{ margin-left:auto; border:0; background:none; color:inherit; cursor:pointer; font-size:15px; line-height:1; padding:0 4px; opacity:.75; }
#bdctl .cat > .ch .add:hover{ opacity:1; }
#bdctl .cat .items{ display:flex; flex-wrap:wrap; gap:5px; padding:7px 8px; min-height:34px; }
#bdctl .el{ display:inline-flex; align-items:center; gap:4px; border:1px solid color-mix(in srgb, var(--cc) 55%, #222); background:color-mix(in srgb, var(--cc) 14%, #151515); border-radius:7px; padding:2px 4px 2px 8px; font-size:12px; max-width:100%; }
#bdctl .el.man{ border-style:dashed; }
#bdctl .el b{ font-weight:600; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; cursor:pointer; }
#bdctl .el .qty{ color:var(--uiMuted); font-weight:400; font-size:11px; }
#bdctl .el .hero{ color:#f1c76b; font-size:11px; }
#bdctl .el small{ color:var(--uiMuted); font-size:10.5px; }
#bdctl .el button{ border:0; background:none; color:var(--uiMuted); cursor:pointer; font-size:12px; padding:0 4px; line-height:1; }
#bdctl .el button:hover{ color:#fff; }
#bdctl .addRow{ display:flex; gap:5px; padding:0 8px 8px; }
#bdctl .addRow input{ flex:1; min-width:0; }
#bdctl .shMore{ display:flex; flex-wrap:wrap; gap:5px; align-items:center; padding:0 14px 14px; font-size:11px; text-transform:uppercase; letter-spacing:.05em; color:var(--uiMuted); }
#bdctl .shNote{ padding:0 14px 14px; }
/* elements view */
#bdctl .bdTools{ display:flex; gap:8px; flex-wrap:wrap; align-items:center; padding:12px 0 8px; }
#bdctl .catChips{ display:flex; gap:5px; flex-wrap:wrap; }
#bdctl .catChip{ border:1px solid color-mix(in srgb, var(--cc, #888) 55%, #222); background:color-mix(in srgb, var(--cc, #888) 10%, #1a1a1a); border-radius:999px; padding:2px 10px; font-size:11.5px; cursor:pointer; color:inherit; font-family:inherit; }
#bdctl .catChip.on{ background:var(--cc, #ececf0); color:#111; font-weight:700; }
#bdctl .catChip small{ opacity:.7; margin-left:3px; }
#bdctl table.bdT{ border-collapse:collapse; width:100%; font-size:12.5px; }
#bdctl table.bdT th{ text-align:left; font-size:10.5px; text-transform:uppercase; letter-spacing:.05em; color:var(--uiMuted); padding:6px 8px; border-bottom:1px solid var(--uiBorder); position:sticky; top:0; background:#171717; }
#bdctl table.bdT td{ padding:6px 8px; border-top:1px solid var(--uiBorder); vertical-align:top; }
#bdctl .dot{ display:inline-block; width:9px; height:9px; border-radius:50%; margin-right:7px; vertical-align:baseline; }
#bdctl .scBtns{ display:flex; flex-wrap:wrap; gap:3px; }
#bdctl .scBtn{ border:1px solid var(--uiBorder); background:rgba(255,255,255,.04); color:inherit; border-radius:6px; padding:0 6px; font-size:11.5px; cursor:pointer; font-family:inherit; }
#bdctl .scBtn:hover{ border-color:rgba(255,255,255,.4); }
#bdctl .edForm{ display:flex; flex-wrap:wrap; gap:8px; align-items:flex-end; padding:8px 10px; background:#202020; border-radius:9px; }
#bdctl .edForm label{ display:flex; flex-direction:column; gap:3px; font-size:10.5px; text-transform:uppercase; letter-spacing:.05em; color:var(--uiMuted); }
#bdctl .tag{ font-size:10px; color:var(--uiMuted); border:1px solid var(--uiBorder); border-radius:5px; padding:0 4px; margin-left:6px; }
#bdctl .nt{ color:var(--uiMuted); font-size:11.5px; display:block; margin-top:2px; white-space:pre-wrap; }
/* reports */
/* stripboard */
#bdctl .stpHead, #bdctl .stp{ display:grid; grid-template-columns:44px 58px minmax(140px,1fr) 78px 54px 50px minmax(70px,140px) 92px; gap:8px; align-items:center; }
#bdctl .stpHead{ font-size:10.5px; text-transform:uppercase; letter-spacing:.05em; color:var(--uiMuted); padding:12px 10px 6px 15px; }
#bdctl .stpWrap{ display:flex; flex-direction:column; gap:2px; }
#bdctl .stp{ text-align:left; width:100%; border:0; border-left:5px solid var(--sc,#ddd); border-radius:4px; padding:5px 10px; background:color-mix(in srgb, var(--sc,#ddd) 16%, #191919); color:inherit; font:inherit; font-size:12.5px; cursor:pointer; }
#bdctl .stp:hover{ background:color-mix(in srgb, var(--sc,#ddd) 26%, #191919); }
#bdctl .stp .n{ font-weight:700; }
#bdctl .stp .set{ overflow:hidden; white-space:nowrap; text-overflow:ellipsis; font-weight:600; }
#bdctl .stp .set small{ font-weight:400; color:var(--uiMuted); margin-left:8px; }
#bdctl .stp .cast{ color:#ddd; overflow:hidden; white-space:nowrap; text-overflow:ellipsis; }
#bdctl .stp .mk{ display:flex; gap:3px; flex-wrap:wrap; }
#bdctl .stp .mk i{ width:9px; height:9px; border-radius:2px; display:block; }
#bdctl .stpDay{ display:flex; gap:10px; align-items:center; background:#000; border:1px solid #333; border-radius:4px; padding:6px 12px; margin:2px 0 8px; font-size:12px; }
#bdctl .stpDay span{ margin-left:auto; color:var(--uiMuted); }
#bdctl .stpDay.un{ background:rgba(241,199,107,.08); border-color:rgba(241,199,107,.35); margin-top:10px; }
#bdctl .stpLegend{ display:flex; flex-wrap:wrap; gap:6px 14px; margin-top:12px; font-size:12px; color:var(--uiMuted); }
#bdctl .stpLegend b{ color:var(--uiText); margin-right:3px; }
@media (max-width:760px){
  #bdctl .stpHead{ display:none; }
  #bdctl .stp{ grid-template-columns:36px 1fr 46px; }
  #bdctl .stp .ie, #bdctl .stp .dn, #bdctl .stp .sd, #bdctl .stp .mk{ display:none; }
  #bdctl .stp .cast{ grid-column:2 / 4; font-size:11.5px; }
}
#bdctl .rpGrid{ display:grid; grid-template-columns:repeat(auto-fill,minmax(330px,1fr)); gap:12px; padding-top:12px; }
#bdctl .rp{ border:1px solid color-mix(in srgb, var(--cc) 50%, #222); border-radius:12px; overflow:hidden; background:#1b1b1b; }
#bdctl .rp h4{ margin:0; padding:7px 12px; font-size:12.5px; background:color-mix(in srgb, var(--cc) 22%, #181818); display:flex; justify-content:space-between; }
#bdctl .rp table{ width:100%; border-collapse:collapse; font-size:12px; }
#bdctl .rp td{ padding:4px 12px; border-top:1px solid var(--uiBorder); vertical-align:top; }
#bdctl .rp td:last-child{ color:var(--uiMuted); text-align:right; white-space:nowrap; }
@media (max-width:760px){
  #bdctl .bdBody{ padding:0 10px 90px; }
  #bdctl .bdSplit{ grid-template-columns:1fr; }
  #bdctl .bdList{ flex-direction:row; max-height:none; overflow-x:auto; position:static; padding-bottom:6px; }
  #bdctl .bdSc{ flex:0 0 150px; }
  #bdctl .shCats{ grid-template-columns:1fr; }
  #bdctl input, #bdctl select, #bdctl textarea{ font-size:16px; }
  #bdctl .bdChip.hideSm{ display:none; }
}`;
const style = document.createElement("style"); style.textContent = css; document.head.appendChild(style);

/* ---------- helpers ---------- */
function stripColor(s){
  const ext = /EXT/.test(s.ie || "") && !/INT/.test(s.ie || ""), both = /INT/.test(s.ie || "") && /EXT/.test(s.ie || "");
  if(s.dn === "M") return "#f2994a";
  if(s.dn === "N") return ext ? "#5ccf8a" : both ? "#7fb6ff" : "#5b8cff";
  return ext ? "#f2c94c" : both ? "#f5dc8a" : "#e8e8e8";
}
const DN = { D: "Day", N: "Night", M: "Dawn/Dusk" };
const fmtMin = (m) => m >= 60 ? Math.floor(m / 60) + "h" + (m % 60 ? " " + String(m % 60).padStart(2, "0") : "") : m + "m";
const SKEY = (pid, sid) => pid + "|" + sid;
let rafId = 0;
function rerender(){ S.forceDraw = true; cancelAnimationFrame(rafId); rafId = requestAnimationFrame(() => { if(S.pid && S.on) render(S.pid); }); }

/* ---------- script ---------- */
async function loadScript(id, force){
  const hub = H(), cur = S.scripts[id], mod = hub.scriptModified(id);
  if(cur && !force && (cur.state === "loading" || (cur.state === "ok" && cur.modified === mod))) return;
  S.scripts[id] = { state: "loading", doc: cur && cur.doc, bd: cur && cur.bd, akey: cur && cur.akey, modified: mod };
  rerender();
  try{
    const res = await hub.ripGet({ action: "load", fileId: id });
    if(!res || res.ok === false || !res.doc) throw new Error((res && res.error) || "Couldn't read the script.");
    S.scripts[id] = { state: "ok", doc: res.doc, bd: null, akey: null, modified: mod };
  }catch(err){
    S.scripts[id] = { state: "error", err: (err && err.message) || String(err), doc: cur && cur.doc, bd: cur && cur.bd, akey: cur && cur.akey, modified: mod };
  }
  S.model = null; rerender();
}
// The plan's flag and location choices shape the breakdown everywhere, so use the same ones here
function planOpts(p){ try{ return P.analyzeOpts(P.normalize(p && p.production)); }catch(_e){ return {}; } }
function storeOf(pid, sid){ const k = SKEY(pid, sid); return S.stores[k] || (S.stores[k] = local.load(pid, sid)); }

/* ---------- team sync ---------- */
// Send only the entries that changed. A refusal (no database rule yet, or no permission) keeps the edit
// on this device, marked unshared, so it's merged in once sharing works.
function push(pid, sid, paths){
  const hub = H(), k = SKEY(pid, sid);
  if(!Object.keys(paths).length) return;
  if(!hub.writeBreakdown || S.share[k] === "denied" || S.share[k] === "off"){ local.dirty(sid, true); return; }
  S.inflight[k] = (S.inflight[k] || 0) + 1;
  const done = () => { S.inflight[k]--; S.seen[k] = undefined; rerender(); };   // look at the team copy again once it's settled
  Promise.resolve().then(() => hub.writeBreakdown(pid, sid, paths)).then(() => {
    S.share[k] = "ok"; done();
  }).catch((err) => {
    const m = String((err && (err.code || err.message)) || err);
    S.share[k] = /permission|denied/i.test(m) ? "denied" : "error";
    local.dirty(sid, true);
    hub.toast(S.share[k] === "denied" ? "The breakdown isn't shared yet: the database refused it. Your changes are kept on this device." : "Couldn't share that change. It's kept on this device: " + m, "err", 5000);
    done();
  });
}
// Each draw: take in the team's copy, add anything this device hasn't shared yet, upload the difference
function sync(pid, sid, p, can){
  const hub = H(), k = SKEY(pid, sid);
  if(!hub.writeBreakdown){ S.share[k] = "off"; return; }
  if(S.share[k] === "denied") return;                                   // keep working on this device's copy
  // While a change is on its way, the database may briefly show the copy without it (or take it back if
  // refused): don't take that in, or the change would vanish from this device too. Look again once it settles.
  if(S.inflight[k] > 0) return;
  const raw = (p && p.breakdown && p.breakdown[sid]) || null, rj = JSON.stringify(raw);
  const pend = can ? local.pending(sid) : [], dirty = can && local.isDirty(sid);
  if(rj === S.seen[k] && !pend.length && !dirty) return;
  S.seen[k] = rj;
  const team = E.fromRemote(raw);
  let next = team;
  if(dirty) next = E.mergeStores(team, local.load(pid, sid));          // keep both: nothing is dropped
  if(pend.length) next = E.applyOps(next, pend);
  if(can){
    if(pend.length) local.clearPending(sid, pend.length);
    if(dirty) local.dirty(sid, false);
    push(pid, sid, E.diff(team, next));                                 // a refusal marks it unshared again
  }
  if(!dirty && can) local.dirty(sid, false);                            // this device is now in step with the team
  if(JSON.stringify(next) !== JSON.stringify(S.stores[k])){ S.stores[k] = next; S.model = null; }
  local.save(sid, next);
}

/* ---------- the model: script + edits -> scenes with elements ---------- */
function modelFor(pid, sid, sc, p){
  const opts = planOpts(p), akey = JSON.stringify(opts);
  if(sc.doc && (!sc.bd || sc.akey !== akey)){ sc.bd = B.analyze(sc.doc, opts); sc.akey = akey; S.model = null; }
  const st = storeOf(pid, sid), mk = SKEY(pid, sid) + "|" + sc.akey + "|" + (sc.modified || "");
  if(!S.model || S.modelKey !== mk){ S.model = E.build(sc.doc, sc.bd, st); S.modelKey = mk; }
  return S.model;
}
// Every edit goes through here: apply it, remember it for undo, save it, rebuild
function edit(pid, sid, fn, quiet){
  const k = SKEY(pid, sid), cur = storeOf(pid, sid), next = fn(cur);
  if(JSON.stringify(next) === JSON.stringify(cur)) return;
  const h = S.hist[k] = S.hist[k] || { undo: [], redo: [] };
  h.undo.push(JSON.stringify(cur)); if(h.undo.length > 60) h.undo.shift(); h.redo = [];
  S.stores[k] = next; local.save(sid, next); S.model = null;
  push(pid, sid, E.diff(cur, next));
  if(!quiet) rerender();
}
function stepHist(pid, sid, back){
  const k = SKEY(pid, sid), h = S.hist[k]; if(!h) return;
  const from = back ? h.undo : h.redo, to = back ? h.redo : h.undo;
  if(!from.length) return;
  to.push(JSON.stringify(storeOf(pid, sid)));
  const cur = storeOf(pid, sid), next = JSON.parse(from.pop());
  S.stores[k] = next; local.save(sid, next); S.model = null;
  push(pid, sid, E.diff(cur, next)); rerender();
}

/* ---------- the breakdown as the plan's source of truth ---------- */
// The Plan tab asks for the script analysis with the element sheets applied (cast, flags and needs per scene),
// so Auto-schedule, warnings, Day Out of Days and day cards all follow what's in the breakdown.
const EN = {};
function enriched(pid, sid, p, doc, bd, modified, opts){
  try{
    if(!doc || !bd || !p || !sid) return bd;
    sync(pid, sid, p, H().canEdit(p));
    const st = storeOf(pid, sid), sj = JSON.stringify(st), c = EN[sid];
    if(c && c.bd === bd && c.sj === sj && c.mod === modified) return c.out;
    const model = E.build(doc, bd, st), out = E.enrich(bd, model, st, opts);
    EN[sid] = { bd, sj, mod: modified, out };
    return out;
  }catch(_e){ return bd; }
}

// The finished breakdown for a script, for Sync / Export (the Schedule sheet and call sheets read it)
async function payload(pid, sid){
  const hub = H(), p = hub.project(pid); if(!p || !sid) return null;
  let sc = S.scripts[sid];
  let doc = sc && sc.doc;
  if(!doc){
    const res = await hub.ripGet({ action: "load", fileId: sid });
    if(!res || res.ok === false || !res.doc) return null;
    doc = res.doc;
  }
  const bd = B.analyze(doc, planOpts(p));
  sync(pid, sid, p, hub.canEdit(p));
  return E.sheetPayload(E.build(doc, bd, storeOf(pid, sid)));
}

/* ---------- rendering ---------- */
function render(pid){
  const box = document.getElementById("bdctl"); if(!box) return;
  const ae = document.activeElement;
  if(ae && box.contains(ae) && /^(INPUT|TEXTAREA)$/.test(ae.tagName) && ae.type !== "checkbox" && !S.forceDraw){
    if(!S.waitBlur){ S.waitBlur = true; ae.addEventListener("blur", () => { S.waitBlur = false; setTimeout(() => { if(S.on && S.pid) render(S.pid); }, 0); }, { once: true }); }
    return;
  }
  S.forceDraw = false; S.waitBlur = false;
  const body = box.querySelector(".bdBody"), list = box.querySelector(".bdList");
  const top = body ? body.scrollTop : 0, ltop = list ? list.scrollTop : 0, lleft = list ? list.scrollLeft : 0;
  draw(pid);
  const b2 = box.querySelector(".bdBody"), l2 = box.querySelector(".bdList");
  if(b2 && top) b2.scrollTop = top;
  if(l2){ if(ltop) l2.scrollTop = ltop; if(lleft) l2.scrollLeft = lleft; }
  // keep the open scene showing in the list
  const on = l2 && l2.querySelector(".bdSc.on");
  if(on){ const a = on.offsetTop - l2.offsetTop, z = a + on.offsetHeight; if(a < l2.scrollTop) l2.scrollTop = a - 6; else if(z > l2.scrollTop + l2.clientHeight) l2.scrollTop = z - l2.clientHeight + 6; }
}
function head(chips, acts){ return `<div class="bdTop"><span class="bdTitle">Breakdown</span><div class="bdChips">${chips || ""}</div>${acts || ""}</div>`; }

function draw(pid){
  S.pid = pid;
  const hub = H(), box = document.getElementById("bdctl"); if(!box || !hub) return;
  box.className = S.on ? "on" : "";
  if(!S.on) return;
  const p = hub.project(pid); if(!p){ box.innerHTML = ""; return; }
  const ids = hub.scriptIds(p), plan = P.normalize(p.production);
  const pick = S.scriptPick[pid];
  const sid = (pick && ids.indexOf(pick) >= 0) ? pick : (plan.scriptId && ids.indexOf(plan.scriptId) >= 0) ? plan.scriptId : ids[0] || "";
  S.sid = sid;
  if(!ids.length){ box.innerHTML = head(`<span class="bdChip">Add a script to this project to break it down</span>`); wire(box, pid); return; }
  const sc = S.scripts[sid];
  if(!sc || (sc.state === "loading" && !sc.doc)){
    if(!sc) loadScript(sid);
    box.innerHTML = head("") + `<div class="bdLoad"><span class="spin"></span><b>Loading the breakdown…</b><span>Reading the script and finding every element</span></div>`;
    wire(box, pid); return;
  }
  if(sc.state === "error" && !sc.doc){
    box.innerHTML = head(`<span class="bdChip warn">Couldn't read the script</span>`) + `<div class="bdEmpty">${esc(sc.err)} <button class="btn sm" type="button" data-a="reload">Try again</button></div>`;
    wire(box, pid); return;
  }
  const modNow = hub.scriptModified(sid);
  if(sc.state === "ok" && modNow && sc.modified && sc.modified !== modNow) loadScript(sid);
  else if(sc.state === "ok" && modNow && !sc.modified) sc.modified = modNow;

  const can = hub.canEdit(p);
  sync(pid, sid, p, can);
  const b = modelFor(pid, sid, sc, p);
  if(!b.scenes.length){ box.innerHTML = head(`<span class="bdChip">No scenes yet</span>`) + `<div class="bdEmpty">Write a scene heading in the script (INT. HOUSE - DAY) and the breakdown fills in.</div>`; wire(box, pid); return; }
  if(S.sel < 1 || S.sel > b.scenes.length) S.sel = 1;
  const hh = S.hist[SKEY(pid, sid)] || { undo: [], redo: [] };
  const scriptSel = ids.length > 1 ? `<select data-a="script" aria-label="Script">${ids.map((id) => `<option value="${esc(id)}"${id === sid ? " selected" : ""}>${esc(hub.scriptTitle(id))}</option>`).join("")}</select>` : "";
  const chips = `<span class="bdChip">${b.totals.scenes} scenes · ${E.fmtEighths(b.totals.eighths)} pages</span>
    <span class="bdChip hideSm">${b.totals.elements} elements</span>
    <span class="bdChip hideSm" title="Estimated shooting time, about an hour a page plus allowances for heavy scenes">~${fmtMin(b.totals.est)} to shoot</span>
    ${sc.state === "loading" ? `<span class="bdChip">Updating from script…</span>` : ""}${!can ? `<span class="bdChip">View only</span>` : ""}
    ${shareChip(S.share[SKEY(pid, sid)], can)}`;
  const acts = `<div class="bdActs">${scriptSel}
    <div class="seg" role="tablist">${[["sheets", "Sheets"], ["strips", "Stripboard"], ["elements", "Elements"], ["reports", "Reports"]].map(([v, n]) => `<button type="button" role="tab" class="${S.view === v ? "on" : ""}" data-a="view" data-v="${v}" aria-selected="${S.view === v}">${n}</button>`).join("")}</div>
    ${can ? `<span class="seg"><button type="button" data-a="undo" title="Undo"${hh.undo.length ? "" : " disabled"}>↶</button><button type="button" data-a="redo" title="Redo"${hh.redo.length ? "" : " disabled"}>↷</button></span>` : ""}
    </div>`;
  const note = `<div class="bdNote">Suggestions come from the script. Remove what's wrong, add what's missing. Changes are shared with everyone on the project. <button class="btn sm" type="button" data-a="dismissnote" style="margin-left:8px">Got it</button></div>`;
  const view = S.view === "elements" ? elementsView(b, can) : S.view === "reports" ? reportsView(b, p) : S.view === "strips" ? stripsView(b, p) : sheetsView(b, can);
  box.innerHTML = head(chips, acts) + `<div class="bdBody${S.view === "sheets" ? " split" : ""}">${can && !lsGet(NOTE_KEY) ? note : ""}${view}</div>`;
  wire(box, pid);
}

function shareChip(st, can){
  if(!can) return "";
  if(st === "denied") return `<span class="bdChip warn" title="Firebase refused the breakdown (the database rule for projects/…/breakdown is missing, or your role can't edit). Changes stay on this device and are merged in once sharing works.">⚠ Not shared · this device only</span>`;
  if(st === "error") return `<span class="bdChip warn" title="The last change didn't reach the team. It's kept on this device and is sent again on the next change.">⚠ Not sent</span>`;
  if(st === "off") return `<span class="bdChip">This device only</span>`;
  return "";
}

/* ---------- sheets ---------- */
function sheetsView(b, can){
  const s = b.scenes[S.sel - 1];
  const list = b.scenes.map((x) => {
    const cats = E.CATS.filter((c) => (x.els[c.id] || []).length);
    return `<button type="button" class="bdSc${x.n === S.sel ? " on" : ""}" data-a="pick" data-n="${x.n}" style="--sc:${stripColor(x)}">
      <div class="t">Sc ${x.n} · ${esc(x.ie || "")} ${esc(DN[x.dn] || "")}<span>${E.fmtEighths(x.eighths)} pg</span></div>
      <div class="l">${esc(x.set || x.loc || x.heading)}</div>
      <div class="dots" title="${x.count} elements">${cats.map((c) => `<i style="background:${c.color}"></i>`).join("")}</div></button>`;
  }).join("");
  const adding = S.adding && S.adding.sk === s.key ? S.adding.cat : "";
  const catBox = (c) => {
    const keys = s.els[c.id] || [];
    if(!keys.length && adding !== c.id) return "";   // empty categories hide behind the "+ Add" row
    const items = keys.map((k) => {
      const e = b.elements[k], tip = (e.auto ? e.why.join(", ") : "added by hand") + (e.note ? " — " + e.note : "") + (e.scenes.length > 1 ? " · in scenes " + e.scenes.join(", ") : "");
      return `<span class="el${e.manual && !e.auto ? " man" : ""}" title="${esc(tip)}"><b data-a="edit" data-k="${esc(k)}">${e.no && c.id === "cast" ? e.no + ". " : ""}${esc(e.name)}${s.qty && s.qty[k] ? ` <span class="qty" title="How many the script mentions">×${s.qty[k]}</span>` : ""}${e.hero ? ` <span class="hero" title="Hero prop: in CAPS or handled in several scenes. Plan doubles and continuity.">★</span>` : ""}</b>${e.scenes.length > 1 ? `<small>${e.scenes.length}</small>` : ""}${can ? `<button type="button" data-a="rm" data-sk="${esc(s.key)}" data-k="${esc(k)}" aria-label="Take ${esc(e.name)} out of this scene" title="Take out of this scene">✕</button>` : ""}</span>`;
    }).join("");
    const names = (b.byCat[c.id] || []).map((k) => b.elements[k].name);
    const addRow = adding === c.id ? `<div class="addRow"><input type="text" id="bdAdd" list="bdDL" maxlength="60" placeholder="${esc(c.short)} name" autocomplete="off"><datalist id="bdDL">${names.map((n) => `<option value="${esc(n)}">`).join("")}</datalist><button class="btn sm primary" type="button" data-a="addok" data-c="${c.id}" data-sk="${esc(s.key)}">Add</button><button class="btn sm" type="button" data-a="addcancel">✕</button></div>` : "";
    return `<div class="cat" style="--cc:${c.color}"><div class="ch"><i></i>${esc(c.label)}${keys.length ? ` · ${keys.length}` : ""}${can ? `<button class="add" type="button" data-a="add" data-c="${c.id}" data-sk="${esc(s.key)}" aria-label="Add ${esc(c.label)}" title="Add ${esc(c.label.toLowerCase())}">+</button>` : ""}</div>
      <div class="items">${items || `<span style="color:var(--uiMuted);font-size:11.5px">None</span>`}</div>${addRow}</div>`;
  };
  const dis = can ? "" : " disabled";
  const prev = s.n > 1 ? `<button class="btn sm" type="button" data-a="pick" data-n="${s.n - 1}" aria-label="Previous scene">←</button>` : "", next = s.n < b.scenes.length ? `<button class="btn sm" type="button" data-a="pick" data-n="${s.n + 1}" aria-label="Next scene">→</button>` : "";
  return `<div class="bdSplit"><div class="bdList" role="list">${list}</div>
    <div class="bdSheet"><div class="shHead" style="--sc:${stripColor(s)}"><h3>Sc ${s.n} · ${esc(s.heading || "(no scene heading)")}</h3><div class="nav">${prev}${next}</div></div>
      <div class="shMeta">
        <label title="Length of the scene in script pages (a page is 8 eighths, so 3 7/8 is almost four pages)">Length<b>${E.fmtEighths(s.eighths)} pg</b></label>
        <label>I/E · D/N<b>${esc(s.ie || "—")} · ${esc(DN[s.dn] || "—")}</b></label>
        <label>Set<b>${esc(s.set || s.loc || "—")}</b></label>
        <label>Story day<input type="text" id="shDay" maxlength="40" value="${esc(s.dayAuto ? "" : s.day)}" placeholder="${esc(s.day)}" style="width:90px"${dis}></label>
        <label>Est. minutes<input type="number" id="shEst" min="5" max="1440" step="5" value="${s.estAuto ? "" : s.est}" placeholder="${s.est}" style="width:84px"${dis}></label>
        <label>Unit<select id="shUnit"${dis}>${["Main", "2nd unit", "Splinter", "Pick-up"].map((u) => `<option${u === s.unit ? " selected" : ""}>${u}</option>`).join("")}</select></label>
      </div>
      <div class="shSyn"><label for="shSyn">Synopsis</label><textarea id="shSyn" rows="2" maxlength="2000"${dis}>${esc(s.synAuto ? "" : s.syn)}</textarea>${s.synAuto && s.syn ? `<div style="font-size:11.5px;color:var(--uiMuted);margin-top:3px">Automatic: ${esc(s.syn)}</div>` : ""}</div>
      <div class="shCats">${E.CATS.map(catBox).join("") || `<div class="bdEmpty" style="grid-column:1/-1;padding:6px 0">Nothing found in this scene yet.</div>`}</div>
      ${can ? `<div class="shMore"><span>Add</span>${E.CATS.filter((c) => !(s.els[c.id] || []).length && adding !== c.id).map((c) => `<button type="button" class="catChip" style="--cc:${c.color}" data-a="add" data-c="${c.id}" data-sk="${esc(s.key)}">+ ${esc(c.short)}</button>`).join("")}</div>` : ""}
      <div class="shNote"><label style="display:block;font-size:10.5px;text-transform:uppercase;letter-spacing:.05em;color:var(--uiMuted);margin-bottom:4px" for="shNote">Scene notes</label><textarea id="shNote" rows="2" maxlength="2000"${dis}>${esc(s.note)}</textarea></div>
    </div></div>`;
}

/* ---------- elements manager ---------- */
function elementsView(b, can){
  const q = S.q.trim().toLowerCase();
  const keys = Object.keys(b.elements).filter((k) => { const e = b.elements[k]; return (S.cat === "all" || e.cat === S.cat) && (!q || e.name.toLowerCase().indexOf(q) >= 0 || e.note.toLowerCase().indexOf(q) >= 0); });
  const counts = {}; Object.keys(b.elements).forEach((k) => { const c = b.elements[k].cat; counts[c] = (counts[c] || 0) + 1; });
  const chips = [`<button type="button" class="catChip${S.cat === "all" ? " on" : ""}" data-a="cat" data-c="all">All<small>${b.totals.elements}</small></button>`]
    .concat(E.CATS.filter((c) => counts[c.id]).map((c) => `<button type="button" class="catChip${S.cat === c.id ? " on" : ""}" style="--cc:${c.color}" data-a="cat" data-c="${c.id}">${esc(c.short)}<small>${counts[c.id]}</small></button>`)).join("");
  keys.sort((a, c) => { const A = b.elements[a], C = b.elements[c], ia = E.CATS.findIndex((x) => x.id === A.cat), ic = E.CATS.findIndex((x) => x.id === C.cat); return (ia - ic) || b.byCat[A.cat].indexOf(a) - b.byCat[A.cat].indexOf(c); });
  const rows = keys.map((k) => {
    const e = b.elements[k], c = E.CAT[e.cat];
    const form = S.edit === k && can ? `<tr><td colspan="5"><div class="edForm">
        <label>Name<input type="text" id="edName" maxlength="60" value="${esc(e.name)}"></label>
        <label>Category<select id="edCat">${E.CATS.map((x) => `<option value="${x.id}"${x.id === e.cat ? " selected" : ""}>${esc(x.label)}</option>`).join("")}</select></label>
        <label>Note (shows on every sheet)<input type="text" id="edNote" maxlength="2000" value="${esc(e.note)}" style="min-width:220px"></label>
        <button class="btn sm primary" type="button" data-a="edsave" data-k="${esc(k)}">Save</button>
        <label>Merge into<select id="edMerge"><option value="">Choose…</option>${Object.keys(b.elements).filter((x) => x !== k).sort((x, y) => b.elements[x].name.localeCompare(b.elements[y].name)).map((x) => `<option value="${esc(x)}">${esc(b.elements[x].name)} (${esc(E.CAT[b.elements[x].cat].short)})</option>`).join("")}</select></label>
        <button class="btn sm" type="button" data-a="edmerge" data-k="${esc(k)}">Merge</button>
        <button class="btn sm" type="button" data-a="eddrop" data-k="${esc(k)}" title="Remove this element from every scene">Ignore everywhere</button>
        <button class="btn sm" type="button" data-a="edcancel">Cancel</button></div></td></tr>` : "";
    return `<tr><td><span class="dot" style="background:${c.color}"></span><b>${e.no && e.cat === "cast" ? e.no + ". " : ""}${esc(e.name)}</b>${e.hero ? `<span class="tag" style="color:#f1c76b;border-color:rgba(241,199,107,.45)">★ hero</span>` : ""}${e.manual && !e.auto ? `<span class="tag">by hand</span>` : ""}${e.note ? `<span class="nt">${esc(e.note)}</span>` : ""}</td>
      <td style="color:var(--uiMuted)">${esc(c.short)}</td>
      <td><div class="scBtns">${e.scenes.map((n) => `<button type="button" class="scBtn" data-a="goto" data-n="${n}" title="Open scene ${n}">${n}</button>`).join("")}</div></td>
      <td style="white-space:nowrap">${E.fmtEighths(e.eighths)}</td>
      <td>${can ? `<button class="btn sm" type="button" data-a="edit" data-k="${esc(k)}">Edit</button>` : ""}</td></tr>${form}`;
  }).join("");
  const dropped = (storeOf(S.pid, S.sid).drop || []);
  const ignored = dropped.length ? `<div style="margin-top:14px;font-size:12px;color:var(--uiMuted)"><b style="color:var(--uiText)">Ignored</b> ${dropped.map((k) => `<button type="button" class="scBtn" style="margin:2px" data-a="undrop" data-k="${esc(k)}" title="Bring back"${can ? "" : " disabled"}>${esc(k.split("|").slice(1).join("|"))} ✕</button>`).join("")}</div>` : "";
  return `<div class="bdTools"><input type="text" id="bdQ" placeholder="Search elements" value="${esc(S.q)}" style="width:200px" autocomplete="off"><div class="catChips">${chips}</div></div>
    ${rows ? `<table class="bdT"><thead><tr><th>Element</th><th>Category</th><th>Scenes</th><th>Pages</th><th></th></tr></thead><tbody>${rows}</tbody></table>` : `<div class="bdEmpty">Nothing matches.</div>`}${ignored}`;
}

/* ---------- reports ---------- */
// The shoot plan's days as scene lists (only scenes that are still in the script), plus the leftovers
function planDays(b, p){
  if(!p || !p.production) return null;
  const pl = P.normalize(p.production), dates = P.planDates(pl), byId = {};
  b.scenes.forEach((s) => { if(s.id) byId[s.id] = s; });
  const seen = {};
  const days = pl.days.map((d, i) => ({ n: i + 1, date: dates[i] || "", scenes: d.scenes.map((id) => { seen[id] = 1; return byId[id]; }).filter(Boolean) }));
  return { days, unsched: b.scenes.filter((s) => !s.id || !seen[s.id]) };
}
function fmtDate(iso){ const d = P.parseISO(iso); return d ? d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }) : ""; }
const HEAVY_CATS = ["stunts", "vehicles", "weapons", "animals", "sfx", "vfx", "makeup", "music", "equipment", "labor"];

/* ---------- stripboard: the shoot in order, one strip per scene, a banner at the end of each day ---------- */
function stripsView(b, p){
  const pd = planDays(b, p);
  if(!pd) return `<div class="bdEmpty">No shoot plan yet. Start it on the Plan tab and the stripboard appears here in shoot order.</div>`;
  const castNo = (k) => b.elements[k].no || "";
  const strip = (s) => {
    const cast = (s.els.cast || []).map(castNo).filter(Boolean).sort((x, y) => x - y);
    const marks = HEAVY_CATS.filter((c) => (s.els[c] || []).length);
    return `<button type="button" class="stp" data-a="goto" data-n="${s.n}" style="--sc:${stripColor(s)}" title="${esc(s.heading)}${s.syn ? " — " + esc(s.syn) : ""}">
      <span class="n">${s.n}</span><span class="ie">${esc(s.ie || "")}</span><span class="set">${esc(s.set || s.loc || "")}<small>${esc(s.syn || "")}</small></span>
      <span class="dn">${esc(DN[s.dn] || "")}</span><span class="pg">${E.fmtEighths(s.eighths)}</span><span class="sd">${esc(s.day || "")}</span>
      <span class="cast">${cast.join(", ")}</span><span class="mk">${marks.map((c) => `<i title="${esc(E.CAT[c].label)}" style="background:${E.CAT[c].color}"></i>`).join("")}</span></button>`;
  };
  const banner = (d) => {
    const e = d.scenes.reduce((a, s) => a + s.eighths, 0), m = d.scenes.reduce((a, s) => a + s.est, 0);
    return `<div class="stpDay"><b>End of Day ${d.n}</b>${d.date ? " · " + esc(fmtDate(d.date)) : ""}<span>${d.scenes.length} sc · ${E.fmtEighths(e)} pg · ~${fmtMin(m)}</span></div>`;
  };
  const legend = (b.byCat.cast || []).filter((k) => b.elements[k].no).map((k) => `<span><b>${b.elements[k].no}</b> ${esc(b.elements[k].name)}</span>`).join("");
  return `<div class="stpHead"><span class="n">Sc</span><span class="ie">I/E</span><span class="set">Set · synopsis</span><span class="dn">D/N</span><span class="pg">Pages</span><span class="sd">Story</span><span class="cast">Cast</span><span class="mk">Needs</span></div>
    <div class="stpWrap">${pd.days.map((d) => d.scenes.map(strip).join("") + banner(d)).join("")}
    ${pd.unsched.length ? `<div class="stpDay un"><b>Unscheduled</b><span>${pd.unsched.length} sc · ${E.fmtEighths(pd.unsched.reduce((a, s) => a + s.eighths, 0))} pg</span></div>${pd.unsched.map(strip).join("")}` : ""}</div>
    ${legend ? `<div class="stpLegend"><b>Cast</b>${legend}</div>` : ""}
    <div class="bdEmpty" style="padding:8px 0">Move scenes between days on the Plan tab. Click a strip to open its sheet.</div>`;
}

/* ---------- reports: by category, or what each shoot day needs ---------- */
function reportsView(b, p){
  const by = S.rpBy === "day" ? "day" : "cat";
  const seg = `<div class="bdTools"><button class="btn sm" type="button" data-a="csv" title="Download this as a CSV file">Download CSV</button><div class="seg">${[["cat", "By category"], ["day", "By shoot day"]].map(([v, n]) => `<button type="button" class="${by === v ? "on" : ""}" data-a="rpby" data-v="${v}">${n}</button>`).join("")}</div></div>`;
  if(by === "day"){
    const pd = planDays(b, p);
    if(!pd) return seg + `<div class="bdEmpty">No shoot plan yet. Start it on the Plan tab to see what each day needs.</div>`;
    const cards = pd.days.filter((d) => d.scenes.length).map((d) => {
      const rows = E.CATS.map((c) => {
        const ks = []; d.scenes.forEach((s) => (s.els[c.id] || []).forEach((k) => { if(ks.indexOf(k) < 0) ks.push(k); }));
        if(!ks.length) return "";
        return `<tr><td><span class="dot" style="background:${c.color}"></span>${esc(c.short)}</td><td>${ks.map((k) => esc((b.elements[k].no && c.id === "cast" ? b.elements[k].no + ". " : "") + b.elements[k].name)).join(", ")}</td></tr>`;
      }).join("");
      return `<div class="rp" style="--cc:#8a8f98"><h4><span>Day ${d.n}${d.date ? " · " + esc(fmtDate(d.date)) : ""}</span><span>Sc ${d.scenes.map((s) => s.n).join(", ")}</span></h4><table>${rows}</table></div>`;
    }).join("");
    return seg + `<div class="rpGrid">${cards || `<div class="bdEmpty">No scenes on shoot days yet.</div>`}</div>`;
  }
  const cards = E.CATS.map((c) => {
    const r = E.report(b, c.id); if(!r.length) return "";
    return `<div class="rp" style="--cc:${c.color}"><h4><span>${esc(c.label)}</span><span>${r.length}</span></h4><table>${r.map((x) => `<tr><td><b>${x.no ? x.no + ". " : ""}${esc(x.name)}</b>${b.elements[x.key] && b.elements[x.key].hero ? ` <span style="color:#f1c76b" title="Hero prop">★</span>` : ""}${x.note ? `<span class="nt">${esc(x.note)}</span>` : ""}</td><td>Sc ${x.scenes.length > 8 ? x.scenes.slice(0, 8).join(", ") + " +" + (x.scenes.length - 8) : x.scenes.join(", ")}</td></tr>`).join("")}</table></div>`;
  }).join("");
  return seg + `<div class="rpGrid">${cards || `<div class="bdEmpty">No elements yet.</div>`}</div>`;
}

/* ---------- interaction ---------- */
function download(name, text){
  try{
    const blob = new Blob(["﻿" + text], { type: "text/csv;charset=utf-8" }), a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 800);
  }catch(_e){ H().toast("Couldn't make the file.", "err", 2200); }
}
function wire(box, pid){
  const hub = H(), p = hub.project(pid), can = !!(p && hub.canEdit(p)), sid = S.sid;
  const model = () => S.model;
  const ed = (fn) => edit(pid, sid, fn);
  box.onclick = (ev) => {
    const a = ev.target.closest("[data-a]"); if(!a || a.tagName === "SELECT" || a.tagName === "INPUT") return;
    const k = a.dataset.a;
    if(k === "view"){ S.view = a.dataset.v; lsSet(VIEW_KEY, S.view); S.edit = null; S.adding = null; rerender(); return; }
    if(k === "pick" || k === "goto"){ S.sel = Number(a.dataset.n) || 1; S.view = "sheets"; lsSet(VIEW_KEY, S.view); S.adding = null; rerender(); return; }
    if(k === "reload"){ loadScript(sid || hub.scriptIds(p)[0], true); return; }
    if(k === "csv"){ const m = model(); if(m) download(((hub.scriptTitle(sid) || "breakdown") + " - breakdown.csv").replace(/[\\/:*?"<>|]/g, "-"), E.csv(m)); return; }
    if(k === "rpby"){ S.rpBy = a.dataset.v; rerender(); return; }
    if(k === "dismissnote"){ lsSet(NOTE_KEY, "1"); rerender(); return; }
    if(k === "cat"){ S.cat = a.dataset.c; rerender(); return; }
    if(k === "undo" || k === "redo"){ stepHist(pid, sid, k === "undo"); return; }
    if(!can) return;
    if(k === "add"){ S.adding = { sk: a.dataset.sk, cat: a.dataset.c }; rerender(); setTimeout(() => { const i = box.querySelector("#bdAdd"); if(i) i.focus(); }, 30); return; }
    if(k === "addcancel"){ S.adding = null; rerender(); return; }
    if(k === "addok"){ commitAdd(box, a.dataset.sk, a.dataset.c, ed); return; }
    if(k === "rm"){ const sk = a.dataset.sk, key = a.dataset.k; ed((st) => E.untag(st, sk, key)); return; }
    if(k === "edit"){ S.edit = a.dataset.k; S.view = "elements"; lsSet(VIEW_KEY, S.view); S.cat = "all"; rerender(); setTimeout(() => { const i = box.querySelector("#edName"); if(i){ i.focus(); i.select(); i.scrollIntoView({ block: "nearest" }); } }, 30); return; }
    if(k === "edcancel"){ S.edit = null; rerender(); return; }
    if(k === "edsave"){
      const key = a.dataset.k, name = (box.querySelector("#edName") || {}).value, cat = (box.querySelector("#edCat") || {}).value, note = (box.querySelector("#edNote") || {}).value;
      if(!String(name || "").trim()){ hub.toast("Give it a name.", "err", 1800); return; }
      let nk = key;
      ed((st) => { let s2 = E.rename(st, key, cat, name); nk = E.key(cat, name); s2 = E.setNote(s2, nk, note); return s2; });
      S.edit = null; return;
    }
    if(k === "edmerge"){
      const key = a.dataset.k, into = (box.querySelector("#edMerge") || {}).value;
      if(!into){ hub.toast("Choose what to merge it into.", "err", 1800); return; }
      ed((st) => E.merge(st, [key], into)); S.edit = null;
      hub.toast("Merged.", "ok", 1500); return;
    }
    if(k === "eddrop"){
      const key = a.dataset.k, m = model(), e = m && m.elements[key];
      hub.confirm("Ignore " + (e ? e.name : "this element") + "?", "It comes out of every scene. You can bring it back from the Ignored list.", "Ignore", false).then((ok) => { if(ok){ ed((st) => E.drop(st, key)); S.edit = null; } });
      return;
    }
    if(k === "undrop"){ const key = a.dataset.k; ed((st) => E.undrop(st, key)); return; }
  };
  box.onchange = (ev) => {
    const t = ev.target;
    if(t.dataset && t.dataset.a === "script"){ S.scriptPick[pid] = t.value; S.model = null; loadScript(t.value); rerender(); return; }
    if(!can) return;
    const sk = (model() && model().scenes[S.sel - 1] || {}).key; if(!sk) return;
    if(t.id === "shSyn") edit(pid, sid, (st) => E.setScene(st, sk, "syn", t.value), true);
    else if(t.id === "shNote") edit(pid, sid, (st) => E.setScene(st, sk, "note", t.value), true);
    else if(t.id === "shDay"){ edit(pid, sid, (st) => E.setScene(st, sk, "day", t.value.trim())); }
    else if(t.id === "shEst"){ edit(pid, sid, (st) => E.setScene(st, sk, "est", t.value)); }
    else if(t.id === "shUnit"){ edit(pid, sid, (st) => E.setScene(st, sk, "unit", t.value === "Main" ? "" : t.value)); }
  };
  box.oninput = (ev) => { if(ev.target.id === "bdQ"){ S.q = ev.target.value; const pos = ev.target.selectionStart; rerender(); setTimeout(() => { const i = box.querySelector("#bdQ"); if(i){ i.focus(); try{ i.setSelectionRange(pos, pos); }catch(_e){} } }, 40); } };
  box.onkeydown = (ev) => {
    if(ev.key === "Enter" && ev.target.id === "bdAdd" && S.adding){ ev.preventDefault(); commitAdd(box, S.adding.sk, S.adding.cat, ed); }
    else if(ev.key === "Escape" && (S.adding || S.edit)){ S.adding = null; S.edit = null; rerender(); }
    else if(ev.key === "Enter" && ev.target.id === "edName"){ const b = box.querySelector("[data-a=edsave]"); if(b) b.click(); }
  };
}
function commitAdd(box, sk, cat, ed){
  const i = box.querySelector("#bdAdd"), name = i ? i.value.trim() : "";
  if(!name){ H().toast("Type a name first.", "err", 1600); return; }
  S.adding = null; ed((st) => E.tag(st, sk, cat, name));
}

// Ctrl/Cmd+Z while the breakdown is showing
document.addEventListener("keydown", (e) => {
  if(!S.on || !S.pid || !(e.ctrlKey || e.metaKey)) return;
  if(e.target.closest && e.target.closest("input, select, textarea, [contenteditable=true]")) return;
  if(document.querySelector(".shade")) return;
  const k = e.key.toLowerCase();
  if(k === "z" || k === "y"){ e.preventDefault(); stepHist(S.pid, S.sid, k === "z" && !e.shiftKey); }
});

// Tags made in the editor (another tab) arrive through localStorage
window.addEventListener("storage", (e) => {
  if(!e.key || !/^Camp_BD_(V1|PENDING_V1|UNSYNCED_V1)_/.test(e.key)) return;
  S.seen = {};                                                         // look again (and upload the editor's tags)
  Object.keys(S.share).forEach((k) => { if(S.share[k] === "off" || S.share[k] === "denied") delete S.stores[k]; });   // no team copy: read this device's again
  S.model = null; rerender();
});
function setMode(on){ on = !!on; if(on === S.on) return; S.on = on; if(on){ S.edit = null; S.adding = null; S.seen = {}; S.model = null; } rerender(); const box = document.getElementById("bdctl"); if(box) box.className = on ? "on" : ""; }
window.CampBdPanel = { enriched, payload, render: (pid) => { S.pid = pid; if(S.on) render(pid); }, setMode, reloadScript: (id) => loadScript(id, true) };
})();
