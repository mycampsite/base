/* calendar.js — the little calendar in the hub's top-right corner: a small month, shoot days marked, quick events, one free-text note each
   (that's where meeting minutes go). Stored in Firebase at projects/<pid>/calendar/<eid> = { d:"YYYY-MM-DD", title, time:"HH:MM", note, by, at }.
   ⚠ needs the calendar rule (projects/$pid/calendar). If the database refuses, events are kept on this device and a toast says so. */
(function () {
"use strict";
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]));
const lsGet = (k) => { try{ return localStorage.getItem(k); }catch(_e){ return null; } };
const lsSet = (k, v) => { try{ localStorage.setItem(k, v); }catch(_e){} };
const H = () => window.__CampHub;
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const LOCAL = (pid) => "Camp_CALENDAR_LOCAL_" + pid;
const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const DOWS = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];
const pad = (n) => (n < 10 ? "0" : "") + n;
const iso = (y, m, d) => y + "-" + pad(m + 1) + "-" + pad(d);
const todayISO = () => { const t = new Date(); return iso(t.getFullYear(), t.getMonth(), t.getDate()); };
const S = { pid:null, ym:null, sel:null, open:null, on:false, denied:{}, local:{} };
let EL = null;

// ---------- data ----------
function eventsOf(pid){
  if(S.denied[pid]){ if(!S.local[pid]){ try{ S.local[pid] = JSON.parse(lsGet(LOCAL(pid)) || "{}"); }catch(_e){ S.local[pid] = {}; } } return S.local[pid]; }
  const p = H() && H().project(pid); return (p && p.calendar) || {};
}
const canEdit = () => { const p = H() && H().project(S.pid); return !!(p && H().canEdit(p)); };
function applyLocal(pid, paths){
  const ev = S.local[pid] = S.local[pid] || {};
  Object.keys(paths).forEach((k) => { const [id, f] = k.split("/"); if(!f){ if(paths[k] == null) delete ev[id]; else ev[id] = paths[k]; } else { ev[id] = ev[id] || {}; if(paths[k] == null) delete ev[id][f]; else ev[id][f] = paths[k]; } });
  lsSet(LOCAL(pid), JSON.stringify(ev));
}
function write(paths){
  const pid = S.pid, hub = H();
  const optimistic = () => { // show it straight away
    const p = hub && hub.project(pid); if(!p) return; const ev = p.calendar = p.calendar || {};
    Object.keys(paths).forEach((k) => { const [id, f] = k.split("/"); if(!f){ if(paths[k] == null) delete ev[id]; else ev[id] = JSON.parse(JSON.stringify(paths[k])); } else { ev[id] = ev[id] || {}; if(paths[k] == null) delete ev[id][f]; else ev[id][f] = paths[k]; } });
  };
  if(S.denied[pid]){ applyLocal(pid, paths); draw(true); return; }
  if(!hub || !hub.writeCalendar){ S.denied[pid] = true; applyLocal(pid, paths); draw(true); return; }
  optimistic(); draw(true);
  Promise.resolve().then(() => hub.writeCalendar(pid, paths)).catch((err) => {
    const m = String((err && (err.code || err.message)) || err);
    if(/permission|denied/i.test(m)){
      S.local[pid] = JSON.parse(JSON.stringify((hub.project(pid) || {}).calendar || {}));
      S.denied[pid] = true; applyLocal(pid, paths);
      hub.toast("The calendar isn't shared yet: the database needs the calendar rule. It's kept on this device for now.", "err", 6000);
      draw(true);
    } else hub.toast("Couldn't save that: " + m, "err", 4000);
  });
}
function shootDays(pid){
  const out = {};
  try{
    const P = window.CampProduction, PP = window.CampProdPanel; if(!P || !PP || !PP.planOf) return out;
    const pl = PP.planOf(pid), dates = P.planDates(pl);
    dates.forEach((d, i) => { if(d) out[d] = i + 1; });
  }catch(_e){}
  return out;
}
const sortEv = (a, b) => (a.time || "99").localeCompare(b.time || "99") || (a.at || 0) - (b.at || 0);
function byDay(pid){
  const m = {}; const ev = eventsOf(pid);
  Object.keys(ev).forEach((id) => { const e = ev[id]; if(e && e.d && e.title != null) (m[e.d] = m[e.d] || []).push(Object.assign({ id }, e)); });
  Object.keys(m).forEach((d) => m[d].sort(sortEv));
  return m;
}
const fmtLong = (d) => { const [y, m, dd] = d.split("-").map(Number); const t = new Date(y, m - 1, dd); return ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][t.getDay()] + " " + dd + " " + MONTHS[m - 1].slice(0, 3); };

// ---------- drawing ----------
function draw(force){
  if(!EL || !S.on) return;
  const ae = document.activeElement;
  if(!force && ae && EL.pop.contains(ae) && /^(INPUT|TEXTAREA)$/.test(ae.tagName)) return;   // don't pull the page from under typing
  const ed = canEdit(), days = byDay(S.pid), shoots = shootDays(S.pid), today = todayISO();
  const [y, m] = S.ym, lead = (new Date(y, m, 1).getDay() + 6) % 7, nd = new Date(y, m + 1, 0).getDate(), total = Math.ceil((lead + nd) / 7) * 7, cells = [];
  for(let i = 0; i < total; i++){
    const dt = new Date(y, m, i - lead + 1), id = iso(dt.getFullYear(), dt.getMonth(), dt.getDate()), inM = dt.getMonth() === m;
    cells.push(`<button type="button" class="caC${inM ? "" : " out"}${id === today ? " today" : ""}${id === S.sel ? " sel" : ""}${shoots[id] ? " shoot" : ""}" data-d="${id}" aria-label="${esc(fmtLong(id))}">${dt.getDate()}${days[id] ? "<i></i>" : ""}</button>`);
  }
  const evs = (S.sel && days[S.sel]) || [], sh = S.sel && shoots[S.sel];
  const list = evs.map((e) => S.open === e.id
    ? `<div class="caEd" data-id="${e.id}"><div class="caEdTop"><input data-f="title" value="${esc(e.title)}" maxlength="120"${ed ? "" : " disabled"}><input data-f="time" type="time" value="${esc(e.time || "")}"${ed ? "" : " disabled"}><button type="button" data-a="close" aria-label="Close">✕</button></div>
        <textarea data-f="note" rows="7" placeholder="Notes, minutes, whatever you need…"${ed ? "" : " disabled"}>${esc(e.note || "")}</textarea>${ed ? `<button type="button" class="caDel" data-a="del">Delete</button>` : ""}</div>`
    : `<button type="button" class="caEv" data-e="${e.id}"><span>${esc(e.time || "")}</span><b>${esc(e.title)}</b>${e.note ? "<small>✎</small>" : ""}</button>`).join("");
  EL.pop.innerHTML = `<div class="caHd"><button type="button" data-n="-1" aria-label="Previous month">‹</button><b>${MONTHS[m]} ${y}</b><button type="button" data-n="1" aria-label="Next month">›</button><button type="button" data-n="0" class="caToday">Today</button></div>
    <div class="caDow">${["M","T","W","T","F","S","S"].map((d) => `<span>${d}</span>`).join("")}</div><div class="caCells">${cells.join("")}</div>
    <div class="caDay"><div class="caDayHd">${S.sel ? esc(fmtLong(S.sel)) : ""}${sh ? `<em>Shoot day ${sh}</em>` : ""}</div>${list}
    ${ed && S.sel ? `<form class="caAdd" data-f="add"><input name="t" placeholder="Add something…" maxlength="120" autocomplete="off"></form>` : ""}</div>`;
}

// ---------- actions ----------
function patch(id, f, v){ if(!canEdit()) return; write({ [id + "/" + f]: v === "" ? null : v, [id + "/at"]: Date.now() }); }
function wire(){
  const pop = EL.pop;
  pop.addEventListener("click", (ev) => {
    const t = ev.target;
    const nav = t.closest("[data-n]"); if(nav){ const n = +nav.dataset.n; if(!n){ const d = new Date(); S.ym = [d.getFullYear(), d.getMonth()]; S.sel = todayISO(); S.open = null; } else { let [y, m] = S.ym; m += n; if(m < 0){ m = 11; y--; } if(m > 11){ m = 0; y++; } S.ym = [y, m]; } draw(true); return; }
    const c = t.closest(".caC"); if(c){ S.sel = c.dataset.d; S.open = null; const [y, m] = S.sel.split("-").map(Number); if(m - 1 !== S.ym[1]) S.ym = [y, m - 1]; draw(true); return; }
    const ee = t.closest("[data-e]"); if(ee){ S.open = ee.dataset.e; draw(true); setTimeout(() => { const n = pop.querySelector("textarea"); if(n) n.focus(); }, 0); return; }
    const a = t.closest("[data-a]"); if(!a) return; const id = a.closest(".caEd") && a.closest(".caEd").dataset.id;
    if(a.dataset.a === "close"){ S.open = null; draw(true); }
    else if(a.dataset.a === "del"){ const e = eventsOf(S.pid)[id]; H().confirm("Delete “" + (e && e.title) + "”?", "It's removed for everyone in this project.", "Delete", true).then((ok) => { if(ok){ S.open = null; write({ [id]: null }); } }); }
  });
  pop.addEventListener("change", (ev) => {
    const f = ev.target.dataset && ev.target.dataset.f, box = ev.target.closest && ev.target.closest(".caEd"); if(!f || !box) return;
    const v = ev.target.value; if(f === "title" && !v.trim()) return draw(true);
    patch(box.dataset.id, f, f === "title" ? v.trim() : v);
  });
  pop.addEventListener("submit", (ev) => {
    ev.preventDefault(); const f = ev.target, t = f.t.value.trim(); if(!t || !S.sel || !canEdit()) return;
    write({ [uid()]: { d:S.sel, title:t, at:Date.now(), by:(H().me && H().me()) || "" } });
    setTimeout(() => { const i = EL.pop.querySelector(".caAdd input"); if(i) i.focus(); }, 0);
  });
  document.addEventListener("pointerdown", (ev) => { if(S.on && !EL.pop.contains(ev.target) && !ev.target.closest("#calBtn") && !ev.target.closest(".modalBg, dialog")) close(); }, true);
  document.addEventListener("keydown", (ev) => { if(S.on && ev.key === "Escape" && !(ev.target && /^(INPUT|TEXTAREA)$/.test(ev.target.tagName) && ev.target.value)) close(); });
}

const css = `
#calPop{ position:fixed; top:calc(var(--topBarH, 48px) + 6px); right:12px; z-index:60; width:340px; max-width:calc(100vw - 24px); max-height:calc(100vh - 70px); overflow:auto; background:#1b1b1b; border:1px solid var(--uiBorder); border-radius:14px; box-shadow:0 14px 40px rgba(0,0,0,.5); padding:12px; box-sizing:border-box; color:var(--uiText); font-size:13px; }
#calPop[hidden]{ display:none; }
.caHd{ display:flex; align-items:center; gap:4px; padding-bottom:8px; }
.caHd b{ flex:1; text-align:center; font-size:14px; }
.caHd button{ height:26px; min-width:26px; border-radius:8px; border:0; background:none; color:var(--uiMuted); cursor:pointer; font:inherit; font-size:15px; }
.caHd button:hover{ background:rgba(255,255,255,.07); color:var(--uiText); }
.caHd .caToday{ font-size:11.5px; padding:0 8px; }
.caDow, .caCells{ display:grid; grid-template-columns:repeat(7, 1fr); gap:2px; }
.caDow span{ text-align:center; font-size:10.5px; color:var(--uiMuted); padding-bottom:3px; }
.caC{ position:relative; height:34px; border:0; border-radius:9px; background:none; color:var(--uiText); cursor:pointer; font:inherit; font-size:12.5px; }
.caC:hover{ background:rgba(255,255,255,.07); }
.caC.out{ opacity:.3; }
.caC.shoot{ background:rgba(255,216,77,.13); color:#ffe27a; }
.caC.today{ box-shadow:inset 0 0 0 1.5px #ff6b61; }
.caC.sel{ background:rgba(90,169,255,.28); color:#fff; }
.caC i{ position:absolute; left:50%; bottom:4px; width:4px; height:4px; margin-left:-2px; border-radius:50%; background:#5aa9ff; }
.caDay{ margin-top:10px; padding-top:10px; border-top:1px solid var(--uiBorder); display:flex; flex-direction:column; gap:6px; }
.caDayHd{ font-weight:700; font-size:13px; display:flex; justify-content:space-between; align-items:baseline; }
.caDayHd em{ font-style:normal; font-weight:600; font-size:11.5px; color:#ffd84d; }
.caEv{ display:flex; align-items:baseline; gap:8px; width:100%; text-align:left; padding:7px 8px; border:0; border-radius:8px; background:rgba(255,255,255,.04); color:var(--uiText); cursor:pointer; font:inherit; }
.caEv:hover{ background:rgba(255,255,255,.09); }
.caEv span{ font-size:11.5px; color:var(--uiMuted); } .caEv span:empty{ display:none; }
.caEv b{ flex:1; font-weight:500; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.caEv small{ color:var(--uiMuted); }
.caAdd input, .caEd input, .caEd textarea{ width:100%; box-sizing:border-box; background:#111; color:var(--uiText); border:1px solid var(--uiBorder); border-radius:8px; padding:8px 10px; font:inherit; }
.caAdd input:focus, .caEd input:focus, .caEd textarea:focus{ outline:none; border-color:#5aa9ff; }
.caEd{ display:flex; flex-direction:column; gap:6px; }
.caEdTop{ display:flex; gap:6px; align-items:center; }
.caEdTop input[data-f=title]{ flex:1; font-weight:600; } .caEdTop input[type=time]{ width:100px; flex:none; }
.caEdTop button{ border:0; background:none; color:var(--uiMuted); cursor:pointer; padding:0 4px; }
.caEd textarea{ resize:vertical; line-height:1.45; }
.caDel{ align-self:flex-start; border:0; background:none; color:#ff6b61; cursor:pointer; font:inherit; font-size:12px; padding:2px 0; }
`;

function mount(){
  if(EL && EL.pop.isConnected) return true;
  if(!document.getElementById("caCss")){ const st = document.createElement("style"); st.id = "caCss"; st.textContent = css; document.head.appendChild(st); }
  const pop = document.createElement("div"); pop.id = "calPop"; pop.hidden = true; pop.setAttribute("role", "dialog"); pop.setAttribute("aria-label", "Calendar"); document.body.appendChild(pop);
  EL = { pop }; wire(); return true;
}
function setPid(pid){
  if(S.pid !== pid){ S.pid = pid; S.open = null; const d = new Date(); S.ym = [d.getFullYear(), d.getMonth()]; S.sel = todayISO(); }
}
function close(){ S.on = false; if(EL) EL.pop.hidden = true; const b = document.getElementById("calBtn"); if(b) b.classList.remove("on"); }
function toggle(pid){
  if(!pid) return; mount(); setPid(pid);
  if(S.on){ close(); return; }
  S.on = true; EL.pop.hidden = false; const b = document.getElementById("calBtn"); if(b) b.classList.add("on"); draw(true);
}
function refresh(pid){ if(!S.on) return; if(pid !== S.pid){ setPid(pid); } draw(); }
window.CampCalendar = { toggle, refresh, close };
})();
