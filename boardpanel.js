/* boardpanel.js — the hub's Board tab: casting and location options as photo cards.
   It reads the script's Production Docs Sheet (Casting Shortlist / Locations Shortlist) through Code.gs
   "boarddata" and shows each role / location with its options side by side, so the director can look
   them over. The Sheet stays the one source of truth: nothing is stored anywhere else.
   The logic (links, grouping, filters) is in board.js and is tested; this file is the screen. */
(function () {
"use strict";
const L = window.CampBoard && window.CampBoard.logic;
if(!L) return;

const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]));
const lsGet = (k) => { try{ return localStorage.getItem(k); }catch(_e){ return null; } };
const lsSet = (k, v) => { try{ localStorage.setItem(k, v); }catch(_e){} };
const H = () => window.__CampHub;
const KEY = "Camp_BOARD_V1";
const STALE_MS = 60000;

const S = {
  tab: lsGet(KEY) === "loc" ? "loc" : "cast",
  status: { cast: "All", loc: "All" },
  q: "",
  script: {},          // pid -> script id chosen here
  data: {},            // script id -> { state:"loading"|"ok"|"none"|"error", d, err, at }
  closed: {},          // "kind|group" -> true while collapsed
  bad: {},             // card id -> true when its photo didn't load
  open: null,          // card id shown in the detail view
  pid: null, fileId: ""
};

const css = `
#boardPane{ flex:1; min-height:0; display:flex; flex-direction:column; }
#boardPane .bdTools{ display:flex; flex-wrap:wrap; align-items:center; gap:8px 12px; padding:10px 14px 0; }
.bdSearch{ position:relative; flex:0 1 240px; min-width:150px; }
.bdSearch svg{ position:absolute; left:10px; top:50%; width:15px; height:15px; margin-top:-7.5px; color:var(--uiMuted); pointer-events:none; }
.bdSearch input{ width:100%; height:32px; padding:0 10px 0 32px; border-radius:9px; border:1px solid var(--uiBorder); background:rgba(255,255,255,.04); color:var(--uiText); outline:none; }
.bdSearch input:focus{ border-color:rgba(255,255,255,.35); }
.bdChips{ display:flex; gap:6px; flex-wrap:wrap; flex:1 1 auto; }
.bdChip{ border:1px solid var(--uiBorder); background:transparent; color:var(--uiMuted); border-radius:999px; height:28px; padding:0 11px; font-size:12px; font-weight:600; cursor:pointer; display:inline-flex; align-items:center; gap:6px; }
.bdChip:hover{ color:var(--uiText); border-color:rgba(255,255,255,.25); }
.bdChip[aria-pressed=true]{ background:#ececf0; color:#111; border-color:#ececf0; }
.bdChip i{ font-style:normal; font-size:11px; opacity:.7; }
.bdProg{ flex:1 1 100%; font-size:12px; color:var(--uiMuted); padding:0 2px; }
.bdProg b{ color:var(--uiText); font-weight:600; }
.bdBody{ flex:1; min-height:0; overflow:auto; padding:6px 14px 28px; -webkit-overflow-scrolling:touch; }
.bdGroup{ margin-top:16px; }
.bdGH{ width:100%; display:flex; align-items:center; gap:10px; padding:6px 2px; background:none; border:0; border-bottom:1px solid var(--uiBorder); color:var(--uiText); cursor:pointer; text-align:left; }
.bdGH:hover .bdGN{ text-decoration:underline; text-underline-offset:3px; }
.bdGH svg{ width:14px; height:14px; color:var(--uiMuted); flex:0 0 auto; transition:transform .12s; }
.bdGroup.shut .bdGH svg{ transform:rotate(-90deg); }
.bdGN{ font-weight:700; font-size:14px; }
.bdGT{ font-size:11.5px; color:var(--uiMuted); }
.bdGS{ margin-left:auto; font-size:12px; color:var(--uiMuted); white-space:nowrap; }
.bdGS.done{ color:var(--ok); }
.bdGrid{ display:grid; grid-template-columns:repeat(auto-fill,minmax(150px,1fr)); gap:12px; margin-top:12px; }
.bdGrid.loc{ grid-template-columns:repeat(auto-fill,minmax(210px,1fr)); }
@media (min-width:760px){ .bdGrid{ grid-template-columns:repeat(auto-fill,minmax(190px,1fr)); } .bdGrid.loc{ grid-template-columns:repeat(auto-fill,minmax(250px,1fr)); } }
.bdGroup.shut .bdGrid, .bdGroup.shut .bdNone{ display:none; }
.bdCard{ background:var(--uiPanel); border:1px solid var(--uiBorder); border-radius:12px; overflow:hidden; display:flex; flex-direction:column; cursor:pointer; min-width:0; }
.bdCard:hover{ border-color:rgba(255,255,255,.22); }
.bdCard.passed{ opacity:.5; }
.bdCard.done{ border-color:rgba(76,217,100,.55); }
.bdPh{ aspect-ratio:3/4; background:#242424; display:grid; place-items:center; font-weight:700; font-size:44px; color:#5d5d5d; overflow:hidden; position:relative; }
.bdGrid.loc .bdPh{ aspect-ratio:4/3; }
.bdPh img{ position:absolute; inset:0; width:100%; height:100%; object-fit:cover; display:block; }
.bdInfo{ padding:10px 11px 11px; display:flex; flex-direction:column; gap:6px; flex:1; min-width:0; }
.bdName{ font-weight:700; font-size:14px; line-height:1.25; overflow-wrap:anywhere; }
.bdNotes{ font-size:12.5px; color:var(--uiMuted); display:-webkit-box; -webkit-line-clamp:3; -webkit-box-orient:vertical; overflow:hidden; overflow-wrap:anywhere; }
.bdLinks{ display:flex; gap:5px; flex-wrap:wrap; margin-top:auto; padding-top:4px; }
.bdBtn{ display:inline-flex; align-items:center; height:24px; padding:0 9px; border-radius:7px; border:1px solid rgba(255,255,255,.22); font-size:11.5px; font-weight:600; color:var(--uiText); text-decoration:none; }
.bdBtn:hover{ background:rgba(255,255,255,.1); }
.bdSt{ align-self:flex-start; height:19px; padding:0 8px; border-radius:999px; font-size:10.5px; font-weight:700; letter-spacing:.04em; text-transform:uppercase; display:inline-flex; align-items:center; border:1px solid var(--uiBorder); color:var(--uiMuted); }
.bdSt.st-callback, .bdSt.st-scouted{ color:#8ab4ff; border-color:rgba(138,180,255,.5); }
.bdSt.st-offered{ color:var(--gold); border-color:rgba(242,201,76,.5); }
.bdSt.st-cast, .bdSt.st-confirmed{ color:#8fe3b0; border-color:rgba(94,211,138,.55); background:rgba(76,217,100,.08); }
.bdSt.st-passed{ color:var(--err); border-color:rgba(255,139,131,.4); }
.bdNone{ margin-top:10px; padding:16px; border:1px dashed rgba(255,255,255,.17); border-radius:12px; color:var(--uiMuted); font-size:12.5px; }
.bdNone a{ color:var(--uiText); }
.bdEmpty{ margin:30px 0; }
.bdShade{ position:fixed; inset:0; z-index:1200; background:rgba(0,0,0,.66); display:flex; align-items:center; justify-content:center; padding:16px; }
.bdDlg{ width:min(760px,100%); max-height:100%; overflow:auto; background:#1a1b1f; border:1px solid rgba(255,255,255,.16); border-radius:14px; box-shadow:0 24px 60px rgba(0,0,0,.6); display:grid; grid-template-columns:minmax(0,300px) 1fr; }
.bdDlg .bdPh{ aspect-ratio:auto; min-height:260px; height:100%; border-radius:0; font-size:72px; }
.bdDlg.loc .bdPh{ min-height:200px; }
.bdDBody{ padding:16px 18px 18px; display:flex; flex-direction:column; gap:10px; min-width:0; }
.bdDHead{ display:flex; align-items:flex-start; gap:10px; }
.bdDHead h2{ margin:0; font-size:18px; line-height:1.25; flex:1; overflow-wrap:anywhere; }
.bdDMeta{ font-size:12px; color:var(--uiMuted); }
.bdRows{ display:grid; grid-template-columns:auto 1fr; gap:6px 14px; font-size:13px; }
.bdRows dt{ color:var(--uiMuted); } .bdRows dd{ margin:0; overflow-wrap:anywhere; } .bdRows a{ color:var(--uiText); }
.bdDNotes{ font-size:13.5px; white-space:pre-wrap; overflow-wrap:anywhere; }
.bdHint{ font-size:12px; color:#f1d39a; background:rgba(224,161,58,.1); border:1px solid rgba(224,161,58,.25); border-radius:9px; padding:7px 10px; }
.bdDFoot{ display:flex; gap:8px; flex-wrap:wrap; align-items:center; margin-top:auto; padding-top:6px; }
.bdDFoot .sp{ flex:1; }
.bdKeys{ font-size:11px; color:var(--uiMuted); }
@media (max-width:640px){
  .bdShade{ align-items:flex-end; padding:0; }
  .bdDlg{ grid-template-columns:1fr; border-radius:14px 14px 0 0; max-height:92%; }
  .bdDlg .bdPh, .bdDlg.loc .bdPh{ min-height:0; height:auto; aspect-ratio:4/3; }
  #boardPane .bdTools{ padding:8px 10px 0; } .bdBody{ padding:4px 10px 24px; }
  .bdSearch{ flex:1 1 100%; }
}
`;
const styleEl = document.createElement("style"); styleEl.textContent = css; document.head.appendChild(styleEl);

const ICON = {
  search: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>`,
  chev: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="m6 9 6 6 6-6"/></svg>`,
  ext: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 4h6v6M20 4l-9 9"/><path d="M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"/></svg>`,
  refresh: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 11a8 8 0 0 0-14.5-4M4 4v4h4"/><path d="M4 13a8 8 0 0 0 14.5 4M20 20v-4h-4"/></svg>`,
  close: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 6l12 12M18 6L6 18"/></svg>`
};

/* ---------- loading ---------- */
async function load(fileId, force){
  const cur = S.data[fileId];
  if(cur && cur.state === "loading") return;
  if(cur && !force && cur.state !== "error" && Date.now() - cur.at < STALE_MS) return;
  S.data[fileId] = { state: "loading", d: cur && cur.d, at: cur ? cur.at : 0 };
  try{
    const res = await H().ripGet({ action: "boarddata", fileId });
    if(res && res.ok === false && (res.reason === "none" || res.reason === "missing" || res.reason === "trashed")) S.data[fileId] = { state: "none", reason: res.reason, at: Date.now() };
    else if(!res || res.ok === false) throw new Error((res && res.error) || "Couldn't read the casting and locations sheet.");
    else S.data[fileId] = { state: "ok", d: res, at: Date.now() };
  }catch(err){
    S.data[fileId] = { state: "error", err: (err && err.message) || String(err), d: cur && cur.d, at: Date.now() };
    if(cur && cur.d) H().toast("Couldn't refresh the board: " + S.data[fileId].err);   // the last copy stays on screen
  }
  if(S.pid) render(S.pid);
  if(S.open && S.fileId === fileId) showDetail(S.open, true);   // the open card may have changed in the Sheet
}

/* ---------- drawing ---------- */
// The letter on a card with no photo: an actor's initial; a place's location name (a street number says little)
function initial(c){ return ((c.kind === "loc" ? c.group : c.title) || "?").replace(/^[^A-Za-z0-9]+/, "").charAt(0).toUpperCase() || "?"; }
function slug(s){ return "st-" + String(s || "").toLowerCase().replace(/[^a-z]+/g, "-"); }
function current(){
  const rec = S.data[S.fileId], d = rec && rec.d;
  const groups = d ? L.groupsOf(d, S.tab, S.fileId) : [];
  return { rec, d, groups, statuses: L.statusList(d, S.tab) };
}
function ensureSkeleton(box){
  if(box.querySelector("#bdBody")) return;
  box.innerHTML = `<div class="bar" id="bdBar"></div>
    <div class="bdTools"><div class="bdSearch">${ICON.search}<input id="bdQ" type="search" placeholder="Search names, notes, status" autocomplete="off" spellcheck="false" aria-label="Search the board"></div><div class="bdChips" id="bdChips"></div><div class="bdProg" id="bdProg"></div></div>
    <div class="bdBody" id="bdBody"></div>`;
  box.querySelector("#bdQ").value = S.q;
}
function render(pid){
  S.pid = pid;
  const hub = H(), box = document.getElementById("boardPane"); if(!hub || !box) return;
  const p = hub.project(pid);
  if(!p){ box.innerHTML = ""; return; }
  const ids = hub.scriptIds(p);
  if(!ids.length){
    box.innerHTML = `<div class="bdBody"><div class="emptyBox bdEmpty"><b>No script in this project yet</b><p>Add a script first. The Board shows the casting and location options kept in its production sheet.</p></div></div>`;
    S.fileId = ""; return;
  }
  const want = S.script[pid], planId = p.production && p.production.scriptId;
  const fileId = ids.indexOf(want) >= 0 ? want : (ids.indexOf(planId) >= 0 ? planId : ids[0]);
  if(fileId !== S.fileId){ S.fileId = fileId; S.open = null; closeDetail(true); }
  // Load now; refresh quietly when it's stale; and once the sheets exist, look again if we found none
  const rec = S.data[fileId];
  if(!rec) load(fileId);
  else if(rec.state === "none" && hub.hasSheets(pid) === true && Date.now() - rec.at > 4000) load(fileId, true);
  else if(rec.state === "ok" && Date.now() - rec.at > STALE_MS) load(fileId);
  ensureSkeleton(box);
  drawBar(pid, p, ids); drawTools(); drawBody(p);
  wire(box, pid, p);
}
function drawBar(pid, p, ids){
  const { rec, d, groups } = current();
  const n = (k) => d ? L.groupsOf(d, k, S.fileId).reduce((a, g) => a + g.cards.length, 0) : "";
  const tab = (k, label) => `<button class="tab${S.tab === k ? " on" : ""}" type="button" role="tab" aria-selected="${S.tab === k}" data-bt="${k}">${label}${d ? ` <span style="opacity:.6;font-weight:600">${n(k)}</span>` : ""}</button>`;
  const sel = ids.length > 1 ? `<select id="bdScript" aria-label="Script" title="Which script's casting and locations to show" style="height:30px;border-radius:9px;max-width:220px">${ids.map((id) => `<option value="${esc(id)}"${id === S.fileId ? " selected" : ""}>${esc(H().scriptTitle(id))}</option>`).join("")}</select>` : "";
  const gid = d && (S.tab === "cast" ? d.castGid : d.locGid);
  const sheet = d && d.url ? `<a class="btn sm" href="${esc(d.url + (gid ? "#gid=" + gid : ""))}" target="_blank" rel="noopener" title="Open this list in Google Sheets">${ICON.ext}<span class="lbl">Open Sheet</span></a>` : "";
  const busy = rec && rec.state === "loading";
  document.getElementById("bdBar").innerHTML = `<div class="tabs" role="tablist" aria-label="Board">${tab("cast", "Cast")}${tab("loc", "Locations")}</div><span style="flex:1"></span>${sel}
    <button class="btn sm" type="button" data-ba="refresh" title="Read the latest from the Sheet"${busy ? " disabled" : ""}>${busy ? `<span class="spin"></span>` : ICON.refresh}<span class="lbl">Refresh</span></button>${sheet}`;
}
function drawTools(){
  const { d, groups, statuses } = current();
  const chips = document.getElementById("bdChips"), prog = document.getElementById("bdProg"), tools = chips.parentNode;
  if(!d){ chips.innerHTML = ""; prog.textContent = ""; tools.style.display = "none"; return; }
  tools.style.display = "";
  const c = L.counts(groups, statuses), cur = S.status[S.tab];
  const chip = (v, label, n) => `<button class="bdChip" type="button" data-bs="${esc(v)}" aria-pressed="${cur === v}">${esc(label)}<i>${n}</i></button>`;
  const extra = Object.keys(c.by).filter((k) => k !== "none" && statuses.indexOf(k) < 0);
  chips.innerHTML = chip("All", "All", c.all) + statuses.concat(extra).filter((s) => c.by[s] || cur === s).map((s) => chip(s, s, c.by[s] || 0)).join("") + (c.unfilled ? chip("Unfilled", "No options yet", c.unfilled) : "");
  const pt = L.progressText(S.tab, c);
  prog.innerHTML = pt ? pt.replace(/^(\d+ of \d+)/, "<b>$1</b>") : "";
}
function cardHtml(c, kind){
  const hasImg = c.photo && !S.bad[c.id];
  const ph = `<div class="bdPh">${esc(initial(c))}${hasImg ? `<img loading="lazy" referrerpolicy="no-referrer" src="${esc(c.photo)}" alt="${esc(c.title)}" data-card="${esc(c.id)}">` : ""}</div>`;
  const links = c.links.map((l) => `<a class="bdBtn" href="${esc(l.url)}"${l.kind === "tel" || l.kind === "mail" ? "" : ` target="_blank" rel="noopener noreferrer"`}>${esc(l.label)}</a>`).join("");
  return `<article class="bdCard${c.passed ? " passed" : ""}${c.done ? " done" : ""}" tabindex="0" data-id="${esc(c.id)}" aria-label="${esc(c.title + ", " + c.group + (c.status ? ", " + c.status : ""))}">${ph}
    <div class="bdInfo"><div class="bdName">${esc(c.title)}</div>${c.status ? `<span class="bdSt ${slug(c.status)}">${esc(c.status)}</span>` : ""}${c.notes ? `<div class="bdNotes">${esc(c.notes)}</div>` : ""}${links ? `<div class="bdLinks">${links}</div>` : ""}</div></article>`;
}
function drawBody(p){
  const box = document.getElementById("bdBody"); if(!box) return;
  const top = box.scrollTop;
  const { rec, d, groups } = current();
  const hub = H();
  if(!d){
    if(!rec || rec.state === "loading"){ box.innerHTML = `<div class="emptyBox bdEmpty" style="display:flex;flex-direction:column;align-items:center;gap:10px"><span class="spin" style="width:28px;height:28px"></span><b>Loading the board…</b><p>Reading the casting and locations sheet</p></div>`; return; }
    if(rec.state === "error"){ box.innerHTML = `<div class="emptyBox bdEmpty"><b>Couldn't load the board</b><p>${esc(rec.err)}</p><button class="btn" type="button" data-ba="refresh">Try again</button></div>`; return; }
    const owner = hub.isOwner(p);
    box.innerHTML = `<div class="emptyBox bdEmpty"><b>No casting or locations sheet yet</b><p>${owner ? "Create the production docs for this script and the Board fills from their Casting Shortlist and Locations Shortlist tabs." : "The owner hasn't created the production docs yet."}</p>${owner ? `<button class="btn primary" type="button" data-ba="create">Create production docs…</button>` : ""}</div>`;
    return;
  }
  const tabMissing = S.tab === "cast" ? d.hasCast === false : d.hasLocations === false;
  if(tabMissing){ box.innerHTML = `<div class="emptyBox bdEmpty"><b>This sheet has no ${S.tab === "cast" ? "Casting" : "Locations"} Shortlist tab</b><p>Update the production docs (Create ▸ Crew, casting and locations) to add it.</p></div>`; return; }
  const status = S.status[S.tab], vis = L.filterGroups(groups, status, S.q);
  if(!groups.length){ box.innerHTML = `<div class="emptyBox bdEmpty"><b>${S.tab === "cast" ? "No speaking characters found in the script" : "No locations found in the script"}</b><p>They appear here as soon as the script has them and the production docs are updated.</p></div>`; return; }
  if(!vis.length){ box.innerHTML = `<div class="emptyBox bdEmpty"><b>Nothing matches</b><p>${S.q ? "No names or notes match “" + esc(S.q) + "”." : "No options have that status."}</p><button class="btn" type="button" data-ba="clear">Clear filters</button></div>`; return; }
  const noun = S.tab === "cast" ? "actor" : "place";
  const sheetLink = d.url ? esc(d.url + ((S.tab === "cast" ? d.castGid : d.locGid) ? "#gid=" + (S.tab === "cast" ? d.castGid : d.locGid) : "")) : "";
  box.innerHTML = vis.map((g) => {
    const key = S.tab + "|" + g.name, shut = !!S.closed[key];
    const done = g.cards.find((c) => c.done);
    const sum = done ? `<span class="bdGS done">✓ ${esc(done.title)}</span>` : `<span class="bdGS">${g.cards.length ? g.cards.length + " option" + (g.cards.length === 1 ? "" : "s") : "no options yet"}</span>`;
    return `<section class="bdGroup${shut ? " shut" : ""}"><button class="bdGH" type="button" data-bg="${esc(key)}" aria-expanded="${!shut}">${ICON.chev}<span class="bdGN">${esc(g.name)}</span>${g.type ? `<span class="bdGT">${esc(g.type)}</span>` : ""}${sum}</button>
      ${g.cards.length ? `<div class="bdGrid ${S.tab}">${g.cards.map((c) => cardHtml(c, S.tab)).join("")}</div>` : `<div class="bdNone">No ${noun} options yet. ${sheetLink ? `Add one in <a href="${sheetLink}" target="_blank" rel="noopener">the Sheet</a>.` : ""}</div>`}</section>`;
  }).join("");
  box.scrollTop = top;
}

/* ---------- the detail view ---------- */
let lastFocus = null;
function findCard(id){
  const { groups } = current();
  for(const g of groups) for(const c of g.cards) if(c.id === id) return c;
  return null;
}
function closeDetail(quiet){
  const el = document.getElementById("bdShade"); if(el) el.remove();
  document.removeEventListener("keydown", detailKeys, true);
  if(!quiet && lastFocus && document.body.contains(lastFocus)) lastFocus.focus();
  S.open = null;
}
function detailKeys(e){
  if(e.key === "Escape"){ e.preventDefault(); e.stopPropagation(); closeDetail(); return; }
  if((e.key === "ArrowRight" || e.key === "ArrowLeft") && !/^(input|select|textarea)$/i.test(e.target.tagName || "")){
    const { groups } = current(), vis = L.filterGroups(groups, S.status[S.tab], S.q);
    const nx = L.neighbour(vis, S.open, e.key === "ArrowRight" ? 1 : -1);
    if(nx){ e.preventDefault(); showDetail(nx); }
  }
}
function showDetail(id, keep){
  const c = findCard(id);
  if(!c){ closeDetail(true); return; }
  const rec = S.data[S.fileId], d = rec && rec.d, gid = d && (c.kind === "cast" ? d.castGid : d.locGid);
  if(!keep && !document.getElementById("bdShade")) lastFocus = document.activeElement;
  S.open = id;
  const { groups } = current(), vis = L.filterGroups(groups, S.status[S.tab], S.q);
  const prev = L.neighbour(vis, id, -1), next = L.neighbour(vis, id, 1);
  const bad = S.bad[id];
  const rows = [];
  if(c.kind === "loc" && c.main) rows.push(["Address", esc(c.main)]);
  if(c.phone) rows.push(["Phone", `<a href="${esc(L.telUrl(c.phone) || "#")}">${esc(c.phone)}</a>`]);
  if(c.email) rows.push(["Email", L.mailUrl(c.email) ? `<a href="${esc(L.mailUrl(c.email))}">${esc(c.email)}</a>` : esc(c.email)]);
  const hint = c.photoLink && !c.photo ? `This photo link can't be shown here. Use the Photo button to open it.` : (c.photo && bad ? `The photo didn't load. If it's a Drive file, set sharing to “Anyone with the link”.` : "");
  const links = c.links.map((l) => `<a class="bdBtn" href="${esc(l.url)}"${l.kind === "tel" || l.kind === "mail" ? "" : ` target="_blank" rel="noopener noreferrer"`}>${esc(l.label)}</a>`).join("");
  const rowLink = d && d.url ? esc(d.url + (gid ? "#gid=" + gid + "&range=A" + c.row : "")) : "";
  const html = `<div class="bdShade" id="bdShade"><div class="bdDlg ${c.kind}" role="dialog" aria-modal="true" aria-label="${esc(c.title)}">
    <div class="bdPh">${esc(initial(c))}${c.photo && !bad ? `<img referrerpolicy="no-referrer" src="${esc(c.photo)}" alt="${esc(c.title)}" data-card="${esc(c.id)}">` : ""}</div>
    <div class="bdDBody"><div class="bdDHead"><h2>${esc(c.title)}</h2><button class="iconBtn" type="button" data-bd="close" aria-label="Close" title="Close (Esc)">${ICON.close}</button></div>
      <div class="bdDMeta">${esc(c.group)}${c.groupType ? " · " + esc(c.groupType) : ""}</div>
      ${c.status ? `<span class="bdSt ${slug(c.status)}">${esc(c.status)}</span>` : ""}
      ${rows.length ? `<dl class="bdRows">${rows.map((r) => `<dt>${r[0]}</dt><dd>${r[1]}</dd>`).join("")}</dl>` : ""}
      ${c.notes ? `<div class="bdDNotes">${esc(c.notes)}</div>` : ""}
      ${hint ? `<div class="bdHint">${esc(hint)}</div>` : ""}
      ${links ? `<div class="bdLinks">${links}</div>` : ""}
      <div class="bdDFoot"><button class="btn sm" type="button" data-bd="prev"${prev ? "" : " disabled"} aria-label="Previous option" title="Previous (←)">←</button><button class="btn sm" type="button" data-bd="next"${next ? "" : " disabled"} aria-label="Next option" title="Next (→)">→</button><span class="sp"></span>${rowLink ? `<a class="btn sm" href="${rowLink}" target="_blank" rel="noopener" title="Open this row in Google Sheets">${ICON.ext}<span class="lbl">Edit in Sheet</span></a>` : ""}</div>
    </div></div></div>`;
  const old = document.getElementById("bdShade");
  if(old) old.remove();
  document.body.insertAdjacentHTML("beforeend", html);
  const shade = document.getElementById("bdShade");
  shade.addEventListener("click", (e) => {
    if(e.target === shade){ closeDetail(); return; }
    const b = e.target.closest("[data-bd]"); if(!b) return;
    if(b.dataset.bd === "close") closeDetail();
    else if(b.dataset.bd === "prev" && prev) showDetail(prev);
    else if(b.dataset.bd === "next" && next) showDetail(next);
  });
  shade.addEventListener("error", onImgError, true);
  document.removeEventListener("keydown", detailKeys, true);
  document.addEventListener("keydown", detailKeys, true);
  if(!keep){ const x = shade.querySelector("[data-bd=close]"); if(x) x.focus(); }
}

/* ---------- interaction ---------- */
function onImgError(e){
  const img = e.target; if(!img || img.tagName !== "IMG" || !img.dataset.card) return;
  S.bad[img.dataset.card] = true; img.remove();
  if(S.open === img.dataset.card) showDetail(S.open, true);
}
function wire(box, pid, p){
  box.onclick = (e) => {
    const t = e.target;
    const bt = t.closest("[data-bt]");
    if(bt){ S.tab = bt.dataset.bt === "loc" ? "loc" : "cast"; lsSet(KEY, S.tab); render(pid); return; }
    const bs = t.closest("[data-bs]");
    if(bs){ S.status[S.tab] = bs.dataset.bs; drawTools(); drawBody(p); return; }
    const ba = t.closest("[data-ba]");
    if(ba){
      const k = ba.dataset.ba;
      if(k === "refresh") load(S.fileId, true);
      else if(k === "clear"){ S.q = ""; S.status[S.tab] = "All"; const q = box.querySelector("#bdQ"); if(q) q.value = ""; drawTools(); drawBody(p); }
      else if(k === "create") H().createDocs(ba);
      return;
    }
    const bg = t.closest("[data-bg]");
    if(bg){ const k = bg.dataset.bg; S.closed[k] = !S.closed[k]; drawBody(p); return; }
    const card = t.closest(".bdCard");
    if(card && !t.closest("a,button")) showDetail(card.dataset.id);
  };
  box.onkeydown = (e) => {
    const card = e.target.closest && e.target.closest(".bdCard");
    if(card && e.target === card && (e.key === "Enter" || e.key === " ")){ e.preventDefault(); showDetail(card.dataset.id); }
  };
  box.onchange = (e) => {
    if(e.target.id === "bdScript"){ S.script[pid] = e.target.value; render(pid); }
  };
  const q = box.querySelector("#bdQ");
  if(q) q.oninput = () => { S.q = q.value; drawBody(p); };
  box.addEventListener("error", onImgError, true);
}
// Coming back to the hub after editing the Sheet: pick up the changes
document.addEventListener("visibilitychange", () => {
  if(document.visibilityState !== "visible" || !S.pid || !S.fileId) return;
  const box = document.getElementById("boardPane"); if(!box || box.classList.contains("hidden")) return;
  const rec = S.data[S.fileId]; if(rec && rec.state === "ok" && Date.now() - rec.at > 20000) load(S.fileId, true);
});
window.CampBoard = Object.assign(window.CampBoard || {}, { render, reload: () => S.fileId && load(S.fileId, true) });
})();
