/* calendar.js — the hub's Calendar tab: a quiet month grid with shoot days marked, small events, and meeting minutes.
   Stored in Firebase at projects/<pid>/calendar/<eid> = { d:"YYYY-MM-DD", title, time:"HH:MM", k:"meeting|recce|casting|other", note,
   att (attendees, comma separated), mn (minutes text), acts (action items, one per line: "[ ] text" or "[x] text"), by, at }.
   ⚠ needs the calendar rule (projects/$pid/calendar). If the database refuses, events are kept on this device and a toast says so. */
(function () {
"use strict";
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]));
const lsGet = (k) => { try{ return localStorage.getItem(k); }catch(_e){ return null; } };
const lsSet = (k, v) => { try{ localStorage.setItem(k, v); }catch(_e){} };
const H = () => window.__CampHub;
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const LOCAL = (pid) => "Camp_CALENDAR_LOCAL_" + pid;
const KINDS = { meeting:["Meeting", "#5aa9ff"], recce:["Recce", "#6bd68f"], casting:["Casting", "#b18cff"], other:["Other", "#ffb02e"] };
const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const DOWS = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];
const pad = (n) => (n < 10 ? "0" : "") + n;
const iso = (y, m, d) => y + "-" + pad(m + 1) + "-" + pad(d);
const todayISO = () => { const t = new Date(); return iso(t.getFullYear(), t.getMonth(), t.getDate()); };
const S = { pid:null, ym:null, sel:null, open:null, side:"day", q:"", denied:{}, local:{}, mounted:null };
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
const hasMinutes = (e) => !!(e.mn || e.att || (e.acts || "").trim());
const actsOf = (s) => String(s || "").split("\n").filter((l) => l.trim()).map((l) => ({ done:/^\[x\]/i.test(l), t:l.replace(/^\[[ xX]\]\s?/, "") }));
const actsStr = (a) => a.map((x) => (x.done ? "[x] " : "[ ] ") + x.t).join("\n");
const fmtLong = (d) => { const [y, m, dd] = d.split("-").map(Number); const t = new Date(y, m - 1, dd); return ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][t.getDay()] + " " + dd + " " + MONTHS[m - 1].slice(0, 3); };

// ---------- drawing ----------
function draw(force){
  if(!EL) return;
  const ae = document.activeElement;
  if(!force && ae && EL.pane.contains(ae) && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName)) return;   // don't pull the page from under typing
  const ed = canEdit(), days = byDay(S.pid), shoots = shootDays(S.pid), today = todayISO();
  const [y, m] = S.ym, first = new Date(y, m, 1), lead = (first.getDay() + 6) % 7, nd = new Date(y, m + 1, 0).getDate();
  const cells = []; const total = Math.ceil((lead + nd) / 7) * 7;
  for(let i = 0; i < total; i++){
    const d = i - lead + 1, inM = d >= 1 && d <= nd, dt = new Date(y, m, d), id = iso(dt.getFullYear(), dt.getMonth(), dt.getDate());
    const evs = days[id] || [], sh = shoots[id];
    cells.push(`<button type="button" class="caCell${inM ? "" : " out"}${id === today ? " today" : ""}${id === S.sel ? " sel" : ""}" data-d="${id}">
      <span class="caNum">${dt.getDate()}</span>${sh ? `<span class="caShoot" title="Shoot day ${sh}">D${sh}</span>` : ""}
      <span class="caEvs">${evs.slice(0, 3).map((e) => `<i style="--k:${(KINDS[e.k] || KINDS.other)[1]}">${esc(e.time ? e.time + " " : "")}${esc(e.title)}</i>`).join("")}${evs.length > 3 ? `<em>+${evs.length - 3}</em>` : ""}</span></button>`);
  }
  EL.grid.innerHTML = `<div class="caHd"><button type="button" data-n="-1" aria-label="Previous month">‹</button><b>${MONTHS[m]} ${y}</b><button type="button" data-n="1" aria-label="Next month">›</button><button type="button" data-n="0" class="caToday">Today</button></div>
    <div class="caDow">${DOWS.map((d) => `<span>${d}</span>`).join("")}</div><div class="caCells">${cells.join("")}</div>`;
  EL.side.innerHTML = `<div class="caTabs"><button type="button" data-s="day"${S.side === "day" ? ' class="on"' : ""}>${S.sel ? esc(fmtLong(S.sel)) : "Day"}</button><button type="button" data-s="min"${S.side === "min" ? ' class="on"' : ""}>Minutes</button></div>
    <div class="caBody">${S.side === "min" ? minutesList(days) : dayPanel(days, shoots, ed)}</div>`;
  if(!ed) EL.pane.classList.add("ro"); else EL.pane.classList.remove("ro");
}
function dayPanel(days, shoots, ed){
  if(!S.sel) return `<p class="caMute">Pick a day.</p>`;
  const evs = days[S.sel] || [], sh = shoots[S.sel];
  const rows = evs.map((e) => S.open === e.id ? editor(e, ed) : `<button type="button" class="caEv" data-e="${e.id}" style="--k:${(KINDS[e.k] || KINDS.other)[1]}"><i></i><span>${esc(e.time || "")}</span><b>${esc(e.title)}</b>${hasMinutes(e) ? `<small>minutes</small>` : ""}</button>`).join("");
  return `${sh ? `<p class="caMute">Shoot day ${sh}</p>` : ""}${rows || (sh ? "" : `<p class="caMute">Nothing on this day.</p>`)}
    ${ed ? `<form class="caAdd" data-f="add"><input name="t" placeholder="Add an event…" maxlength="120" autocomplete="off"><input name="h" type="time" aria-label="Time"><select name="k" aria-label="Type">${Object.keys(KINDS).map((k) => `<option value="${k}">${KINDS[k][0]}</option>`).join("")}</select><button type="submit">Add</button></form>` : ""}`;
}
function editor(e, ed){
  const dis = ed ? "" : " disabled", acts = actsOf(e.acts);
  return `<div class="caEd" data-id="${e.id}" style="--k:${(KINDS[e.k] || KINDS.other)[1]}">
    <div class="caEdTop"><input data-f="title" value="${esc(e.title)}" maxlength="120"${dis}><input data-f="time" type="time" value="${esc(e.time || "")}"${dis}><button type="button" data-a="close" aria-label="Close">✕</button></div>
    <div class="caEdRow"><select data-f="k"${dis}>${Object.keys(KINDS).map((k) => `<option value="${k}"${e.k === k ? " selected" : ""}>${KINDS[k][0]}</option>`).join("")}</select><input data-f="d" type="date" value="${esc(e.d)}"${dis}></div>
    <textarea data-f="note" rows="2" placeholder="Note (where, who's bringing what…)"${dis}>${esc(e.note || "")}</textarea>
    <details class="caMin"${hasMinutes(e) || e.k === "meeting" ? " open" : ""}><summary>Minutes</summary>
      <input data-f="att" placeholder="Attendees (comma separated)" value="${esc(e.att || "")}" maxlength="400"${dis}>
      <textarea data-f="mn" rows="5" placeholder="What was discussed and decided…"${dis}>${esc(e.mn || "")}</textarea>
      <div class="caActs">${acts.map((a, i) => `<label class="${a.done ? "done" : ""}"><input type="checkbox" data-a="act" data-i="${i}"${a.done ? " checked" : ""}${dis}><span>${esc(a.t)}</span><button type="button" data-a="actdel" data-i="${i}" aria-label="Remove">✕</button></label>`).join("")}</div>
      ${ed ? `<form class="caAct" data-f="act"><input name="a" placeholder="Action item… (Enter)" maxlength="200" autocomplete="off"></form>` : ""}
    </details>
    ${ed ? `<button type="button" class="caDel" data-a="del">Delete event</button>` : ""}</div>`;
}
function minutesList(days){
  const all = []; Object.keys(days).forEach((d) => days[d].forEach((e) => { if(hasMinutes(e)) all.push(e); }));
  const q = S.q.trim().toLowerCase();
  const list = all.filter((e) => !q || [e.title, e.att, e.mn, e.acts].join(" ").toLowerCase().indexOf(q) >= 0).sort((a, b) => b.d.localeCompare(a.d) || sortEv(b, a));
  const open = all.reduce((n, e) => n + actsOf(e.acts).filter((a) => !a.done).length, 0);
  return `<input class="caSearch" data-f="q" placeholder="Search minutes…" value="${esc(S.q)}">${open ? `<p class="caMute">${open} open action item${open === 1 ? "" : "s"}</p>` : ""}
    ${list.map((e) => { const o = actsOf(e.acts).filter((a) => !a.done).length; return `<button type="button" class="caEv" data-go="${e.id}" data-d="${e.d}" style="--k:${(KINDS[e.k] || KINDS.other)[1]}"><i></i><span>${esc(fmtLong(e.d))}</span><b>${esc(e.title)}</b>${o ? `<small>${o} open</small>` : ""}</button>`; }).join("") || `<p class="caMute">${all.length ? "No match." : "Minutes you write on an event show up here."}</p>`}`;
}

// ---------- actions ----------
function patch(id, f, v){ if(!canEdit()) return; write({ [id + "/" + f]: v === "" ? null : v, [id + "/at"]: Date.now() }); }
function wire(){
  const pane = EL.pane;
  pane.addEventListener("click", (ev) => {
    const t = ev.target;
    const nav = t.closest("[data-n]"); if(nav){ const n = +nav.dataset.n; if(!n){ const d = new Date(); S.ym = [d.getFullYear(), d.getMonth()]; S.sel = todayISO(); } else { let [y, m] = S.ym; m += n; if(m < 0){ m = 11; y--; } if(m > 11){ m = 0; y++; } S.ym = [y, m]; } draw(true); return; }
    const sd = t.closest("[data-s]"); if(sd){ S.side = sd.dataset.s; draw(true); return; }
    const cell = t.closest(".caCell"); if(cell){ S.sel = cell.dataset.d; S.open = null; S.side = "day"; draw(true); return; }
    const go = t.closest("[data-go]"); if(go){ S.sel = go.dataset.d; S.open = go.dataset.go; S.side = "day"; const [y, m] = go.dataset.d.split("-").map(Number); S.ym = [y, m - 1]; draw(true); return; }
    const ee = t.closest("[data-e]"); if(ee){ S.open = ee.dataset.e; draw(true); return; }
    const a = t.closest("[data-a]"); if(!a) return;
    const box = a.closest(".caEd"), id = box && box.dataset.id, e = id && eventsOf(S.pid)[id];
    if(a.dataset.a === "close"){ S.open = null; draw(true); }
    else if(a.dataset.a === "del"){ H().confirm("Delete “" + (e && e.title) + "”?", "It's removed for everyone in this project.", "Delete", true).then((ok) => { if(ok){ S.open = null; write({ [id]: null }); } }); }
    else if(a.dataset.a === "act" && e){ const list = actsOf(e.acts), i = +a.dataset.i; if(list[i]){ list[i].done = a.checked; patch(id, "acts", actsStr(list)); } }
    else if(a.dataset.a === "actdel" && e){ const list = actsOf(e.acts); list.splice(+a.dataset.i, 1); ev.preventDefault(); patch(id, "acts", actsStr(list)); }
  });
  pane.addEventListener("change", (ev) => {
    const f = ev.target.dataset && ev.target.dataset.f; if(!f) return;
    const box = ev.target.closest(".caEd"); if(!box) return; const id = box.dataset.id, v = ev.target.value;
    if(f === "title" && !v.trim()) return draw(true);
    if(f === "d"){ if(!/^\d{4}-\d\d-\d\d$/.test(v)) return draw(true); S.sel = v; const [y, m] = v.split("-").map(Number); S.ym = [y, m - 1]; }
    patch(id, f, f === "title" ? v.trim() : v);
  });
  pane.addEventListener("input", (ev) => { if(ev.target.dataset && ev.target.dataset.f === "q"){ S.q = ev.target.value; const pos = ev.target.selectionStart; const body = EL.side.querySelector(".caBody"); body.innerHTML = minutesList(byDay(S.pid)); const q = body.querySelector(".caSearch"); q.focus(); try{ q.setSelectionRange(pos, pos); }catch(_e){} } });
  pane.addEventListener("submit", (ev) => {
    ev.preventDefault(); const f = ev.target;
    if(f.dataset.f === "add"){
      const t = f.t.value.trim(); if(!t || !S.sel || !canEdit()) return; const id = uid();
      const e = { d:S.sel, title:t, k:f.k.value, at:Date.now(), by:(H().me && H().me()) || "" }; if(f.h.value) e.time = f.h.value;
      S.open = f.k.value === "meeting" ? id : null; write({ [id]: e });
    } else if(f.dataset.f === "act"){
      const box = f.closest(".caEd"), id = box.dataset.id, e = eventsOf(S.pid)[id], t = f.a.value.trim(); if(!e || !t) return;
      const list = actsOf(e.acts); list.push({ done:false, t }); patch(id, "acts", actsStr(list));
      setTimeout(() => { const i = EL.pane.querySelector(".caAct input"); if(i) i.focus(); }, 0);
    }
  });
}

const css = `
#calPane{ flex:1; min-height:0; display:flex; }
.caWrap{ display:flex; flex:1; min-height:480px; border:1px solid var(--uiBorder); border-radius:12px; overflow:hidden; background:#151515; }
.caGrid{ flex:1; min-width:0; display:flex; flex-direction:column; padding:10px 12px 12px; }
.caHd{ display:flex; align-items:center; gap:6px; padding:2px 0 10px; }
.caHd b{ font-size:15px; min-width:130px; text-align:center; }
.caHd button{ height:28px; min-width:28px; border-radius:8px; border:1px solid var(--uiBorder); background:rgba(255,255,255,.04); color:var(--uiText); cursor:pointer; font:inherit; font-size:14px; }
.caHd .caToday{ margin-left:auto; font-size:12px; padding:0 10px; }
.caDow, .caCells{ display:grid; grid-template-columns:repeat(7, minmax(0,1fr)); }
.caDow span{ font-size:11px; color:var(--uiMuted); padding:0 6px 6px; }
.caCells{ flex:1; grid-auto-rows:minmax(74px, 1fr); border-top:1px solid var(--uiBorder); border-left:1px solid var(--uiBorder); }
.caCell{ position:relative; text-align:left; border:0; border-right:1px solid var(--uiBorder); border-bottom:1px solid var(--uiBorder); background:none; color:var(--uiText); padding:5px 6px; cursor:pointer; font:inherit; overflow:hidden; display:flex; flex-direction:column; gap:3px; min-width:0; }
.caCell:hover{ background:rgba(255,255,255,.04); }
.caCell.out{ opacity:.35; }
.caCell.sel{ background:rgba(90,169,255,.10); box-shadow:inset 0 0 0 1px rgba(90,169,255,.55); }
.caNum{ font-size:12px; color:var(--uiMuted); }
.caCell.today .caNum{ color:#fff; background:#d33; border-radius:10px; padding:0 6px; align-self:flex-start; font-weight:700; }
.caShoot{ position:absolute; top:5px; right:6px; font-size:10px; font-weight:700; color:#ffd84d; letter-spacing:.3px; }
.caEvs{ display:flex; flex-direction:column; gap:2px; min-width:0; }
.caEvs i{ font-style:normal; font-size:11px; line-height:1.25; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; padding-left:7px; position:relative; color:#ddd; }
.caEvs i::before{ content:""; position:absolute; left:0; top:4px; width:4px; height:4px; border-radius:50%; background:var(--k); }
.caEvs em{ font-size:10px; color:var(--uiMuted); font-style:normal; }
.caSide{ width:320px; flex:none; border-left:1px solid var(--uiBorder); background:#181818; display:flex; flex-direction:column; min-width:0; }
.caTabs{ display:flex; border-bottom:1px solid var(--uiBorder); }
.caTabs button{ flex:1; padding:10px 8px; border:0; background:none; color:var(--uiMuted); cursor:pointer; font:inherit; font-size:12.5px; font-weight:600; border-bottom:2px solid transparent; }
.caTabs button.on{ color:var(--uiText); border-bottom-color:var(--uiText); }
.caBody{ flex:1; overflow:auto; padding:10px; display:flex; flex-direction:column; gap:6px; }
.caMute{ margin:2px 2px 4px; font-size:12px; color:var(--uiMuted); }
.caEv{ display:flex; align-items:center; gap:8px; width:100%; text-align:left; padding:8px 9px; border:1px solid var(--uiBorder); border-radius:9px; background:rgba(255,255,255,.03); color:var(--uiText); cursor:pointer; font:inherit; font-size:13px; }
.caEv:hover{ background:rgba(255,255,255,.07); }
.caEv i{ width:7px; height:7px; border-radius:50%; background:var(--k); flex:none; }
.caEv span{ font-size:11.5px; color:var(--uiMuted); flex:none; }
.caEv b{ font-weight:600; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; flex:1; }
.caEv small{ font-size:10.5px; color:var(--uiMuted); flex:none; }
.caAdd{ display:flex; gap:5px; flex-wrap:wrap; margin-top:4px; }
.caAdd input[name=t]{ flex:1 1 100%; }
.caAdd input, .caAdd select, .caEd input, .caEd select, .caEd textarea, .caSearch{ background:#111; color:var(--uiText); border:1px solid var(--uiBorder); border-radius:8px; padding:7px 9px; font:inherit; font-size:13px; min-width:0; }
.caAdd select{ flex:1; } .caAdd input[type=time]{ width:96px; }
.caAdd button{ border:1px solid var(--uiBorder); background:rgba(255,255,255,.07); color:var(--uiText); border-radius:8px; padding:0 14px; cursor:pointer; font:inherit; font-size:12.5px; font-weight:600; }
.caEd{ border:1px solid var(--uiBorder); border-left:3px solid var(--k); border-radius:9px; padding:9px; display:flex; flex-direction:column; gap:7px; background:rgba(255,255,255,.03); }
.caEdTop, .caEdRow{ display:flex; gap:6px; }
.caEdTop input[data-f=title]{ flex:1; font-weight:600; } .caEdTop input[type=time]{ width:96px; }
.caEdTop button{ border:0; background:none; color:var(--uiMuted); cursor:pointer; padding:0 4px; }
.caEdRow select, .caEdRow input{ flex:1; }
.caEd textarea{ resize:vertical; width:100%; box-sizing:border-box; }
.caMin summary{ cursor:pointer; font-size:12px; font-weight:700; color:var(--uiMuted); padding:2px 0 6px; }
.caMin[open] summary{ color:var(--uiText); }
.caMin input[data-f=att]{ width:100%; box-sizing:border-box; margin-bottom:6px; }
.caActs{ display:flex; flex-direction:column; gap:3px; margin:6px 0; }
.caActs label{ display:flex; align-items:center; gap:7px; font-size:13px; padding:2px 0; }
.caActs label span{ flex:1; min-width:0; overflow-wrap:anywhere; }
.caActs label.done span{ text-decoration:line-through; color:var(--uiMuted); }
.caActs label button{ border:0; background:none; color:var(--uiMuted); cursor:pointer; opacity:0; }
.caActs label:hover button{ opacity:1; }
.caAct input{ width:100%; box-sizing:border-box; }
.caDel{ align-self:flex-start; border:0; background:none; color:#ff6b61; cursor:pointer; font:inherit; font-size:12px; padding:2px 0; }
.caSearch{ width:100%; box-sizing:border-box; }
.ro .caAdd, .ro .caDel{ display:none; }
@media (max-width:760px){ .caWrap{ flex-direction:column; } .caSide{ width:auto; border-left:0; border-top:1px solid var(--uiBorder); max-height:none; } .caCells{ grid-auto-rows:minmax(54px, 1fr); } .caEvs i{ font-size:10px; } }
`;

function mount(){
  const pane = document.getElementById("calPane"); if(!pane) return false;
  if(!document.getElementById("caCss")){ const st = document.createElement("style"); st.id = "caCss"; st.textContent = css; document.head.appendChild(st); }
  pane.innerHTML = `<div class="caWrap"><div class="caGrid"></div><aside class="caSide"></aside></div>`;
  EL = { pane, grid:pane.querySelector(".caGrid"), side:pane.querySelector(".caSide") };
  wire(); S.mounted = S.pid;
  return true;
}
function render(pid){
  if(!pid) return;
  if(S.pid !== pid){ S.pid = pid; S.open = null; S.q = ""; S.sel = todayISO(); const d = new Date(); S.ym = [d.getFullYear(), d.getMonth()]; }
  if(!EL || !EL.pane.isConnected || S.mounted !== pid){ if(!mount()) return; }
  if(!S.ym){ const d = new Date(); S.ym = [d.getFullYear(), d.getMonth()]; S.sel = S.sel || todayISO(); }
  draw();
}
window.CampCalendar = { render };
})();
