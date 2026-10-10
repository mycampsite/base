/* boardpanel.js — the hub's Board tab: casting and location options as photo cards.
   It reads the script's Production Docs Sheet (Casting Shortlist / Locations Shortlist) through Code.gs
   "boarddata" and shows each role / location with its options side by side, so the director can look
   them over. The Sheet stays the one source of truth: nothing is stored anywhere else.
   Editors can also change an option, set its status, add one or remove one right here; each change is written
   straight into the Sheet through "boardsave" (and a change made in the Sheet shows up here on the next refresh).
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
  viewer: null,        // { id, i } while the photo viewer is open
  briefDraft: null,
  briefEdit: "",       // "kind|group" while its brief is being typed
  edit: null,          // the form being filled in: { kind, id, key, group, base, vals, busy, err, conflict }
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
.bdShade{ position:fixed; inset:0; z-index:99; background:rgba(0,0,0,.66); display:flex; align-items:center; justify-content:center; padding:16px; }
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
.bdAdd{ min-height:64px; border:1px dashed rgba(255,255,255,.22); background:transparent; color:var(--uiMuted); border-radius:12px; font-size:13px; font-weight:600; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:6px; }
.bdAdd:hover{ color:var(--uiText); border-color:rgba(255,255,255,.45); background:rgba(255,255,255,.04); }
.bdNone .bdAdd{ display:inline-flex; min-height:30px; padding:0 12px; margin-left:6px; border-radius:8px; }
.bdDlg.add{ grid-template-columns:1fr; width:min(520px,100%); }
.bdForm{ display:grid; gap:10px; }
.bdForm label{ display:grid; gap:4px; font-size:12px; color:var(--uiMuted); font-weight:600; }
.bdForm input, .bdForm select, .bdForm textarea{ width:100%; padding:7px 10px; border-radius:9px; border:1px solid var(--uiBorder); background:rgba(255,255,255,.04); color:var(--uiText); font:inherit; font-size:13.5px; font-weight:400; outline:none; box-sizing:border-box; }
.bdForm input, .bdForm select{ height:34px; padding-top:0; padding-bottom:0; }
.bdForm textarea{ min-height:84px; resize:vertical; }
.bdForm input:focus, .bdForm select:focus, .bdForm textarea:focus{ border-color:rgba(255,255,255,.4); }
.bdForm .two{ display:grid; grid-template-columns:1fr 1fr; gap:10px; }
.bdErr{ font-size:12.5px; color:var(--err); background:rgba(255,139,131,.08); border:1px solid rgba(255,139,131,.3); border-radius:9px; padding:7px 10px; }
.bdConf{ font-size:12.5px; color:#f1d39a; background:rgba(224,161,58,.1); border:1px solid rgba(224,161,58,.3); border-radius:9px; padding:8px 10px; display:grid; gap:8px; }
.bdConf div{ display:flex; gap:8px; flex-wrap:wrap; }
.bdQuick{ height:30px; border-radius:9px; max-width:150px; }
.bdStar{ position:absolute; top:6px; right:6px; z-index:2; width:28px; height:28px; border-radius:50%; border:0; background:rgba(0,0,0,.5); color:#fff; font-size:15px; line-height:28px; text-align:center; padding:0; cursor:pointer; opacity:.75; }
.bdStar:hover{ opacity:1; background:rgba(0,0,0,.7); }
.bdStar.on{ color:var(--gold); opacity:1; }
span.bdStar{ cursor:default; }
.bdGrp{ font-size:11px; color:var(--uiMuted); letter-spacing:.03em; text-transform:uppercase; }
.bdCard.dragging{ opacity:.35; }
.bdCard.over{ outline:2px dashed var(--gold); outline-offset:-2px; }
.bdFav .bdGN{ color:var(--gold); }
.bdBrief{ margin:8px 2px 0; font-size:12.5px; color:var(--uiMuted); font-style:italic; white-space:pre-wrap; overflow-wrap:anywhere; max-width:80ch; }
.bdBrief button, .bdBriefAdd{ background:none; border:0; color:var(--uiMuted); font-size:11.5px; cursor:pointer; padding:0 4px; text-decoration:underline; text-underline-offset:3px; font-style:normal; opacity:.7; }
.bdBriefAdd{ margin:6px 2px 0; padding:0; }
.bdBrief button:hover, .bdBriefAdd:hover{ color:var(--uiText); opacity:1; }
.bdBriefForm{ margin:8px 2px 0; display:grid; gap:6px; max-width:620px; }
.bdBriefForm textarea{ width:100%; min-height:64px; padding:7px 10px; border-radius:9px; border:1px solid var(--uiBorder); background:rgba(255,255,255,.04); color:var(--uiText); font:inherit; font-size:13px; box-sizing:border-box; resize:vertical; outline:none; }
.bdBriefForm div{ display:flex; gap:8px; }
.bdGroup.shut .bdBrief, .bdGroup.shut .bdBriefAdd, .bdGroup.shut .bdBriefForm{ display:none; }
.bdCount{ position:absolute; left:6px; bottom:6px; z-index:2; height:20px; padding:0 7px; border-radius:999px; background:rgba(0,0,0,.55); color:#fff; font-size:11px; font-weight:700; display:inline-flex; align-items:center; gap:4px; }
.bdPh[data-bd=view]{ cursor:zoom-in; }
.bdPhotos{ display:grid; gap:8px; }
.bdPhLabel{ font-size:12px; color:var(--uiMuted); font-weight:600; } .bdPhLabel span{ font-weight:400; opacity:.8; }
.bdThumbs{ display:flex; gap:8px; flex-wrap:wrap; }
.bdThumb{ position:relative; width:72px; height:72px; border-radius:9px; overflow:hidden; background:#242424; border:2px solid transparent; display:grid; place-items:center; font-size:10px; color:var(--uiMuted); text-align:center; }
.bdThumb.main{ border-color:var(--gold); }
.bdThumb img{ position:absolute; inset:0; width:100%; height:100%; object-fit:cover; }
.bdThumb button{ position:absolute; z-index:2; width:22px; height:22px; border:0; border-radius:50%; background:rgba(0,0,0,.7); color:#fff; font-size:12px; line-height:22px; padding:0; cursor:pointer; }
.bdThumb .rm{ top:3px; right:3px; } .bdThumb .mk{ bottom:3px; left:3px; }
.bdThumb .mk:hover{ color:var(--gold); }
.bdThumb.up .spin{ width:18px; height:18px; }
.bdDrop{ border:1.5px dashed rgba(255,255,255,.25); border-radius:10px; padding:12px; text-align:center; font-size:12.5px; color:var(--uiMuted); }
.bdDrop.over{ border-color:var(--gold); background:rgba(242,201,76,.07); color:var(--uiText); }
.bdDrop button, .bdLinkAdd button{ background:none; border:0; color:var(--uiText); text-decoration:underline; text-underline-offset:3px; cursor:pointer; font:inherit; padding:0; }
.bdLinkAdd{ display:flex; gap:8px; align-items:center; } .bdLinkAdd input{ flex:1; }
.bdLinkAdd button{ height:34px; padding:0 12px; border:1px solid var(--uiBorder); border-radius:9px; text-decoration:none; }
.bdView{ z-index:101; background:rgba(0,0,0,.9); flex-direction:column; gap:10px; }
.bdView figure{ margin:0; flex:1; min-height:0; width:100%; display:grid; place-items:center; }
.bdView img{ max-width:100%; max-height:100%; object-fit:contain; border-radius:6px; }
.bdView .nav{ position:absolute; top:50%; margin-top:-22px; width:44px; height:44px; border-radius:50%; border:0; background:rgba(255,255,255,.14); color:#fff; font-size:20px; cursor:pointer; }
.bdView .nav:hover{ background:rgba(255,255,255,.28); } .bdView .nav.l{ left:14px; } .bdView .nav.r{ right:14px; }
.bdView .x{ position:absolute; top:12px; right:14px; }
.bdVBar{ display:flex; gap:12px; align-items:center; flex-wrap:wrap; justify-content:center; font-size:13px; color:#d6d6dc; }
.bdVBar a{ color:#fff; }
@media (max-width:640px){ .bdForm .two{ grid-template-columns:1fr; } }
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
  if(S.open && S.fileId === fileId && !S.edit) showDetail(S.open, true);   // the open card may have changed in the Sheet
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
  const p = hub.project(pid); S.hubP = p;
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
function cardHtml(c, kind, o){
  o = o || {};
  const hasImg = c.photo && !S.bad[c.id];
  const star = o.can ? `<button class="bdStar${c.fav ? " on" : ""}" type="button" data-fav="${esc(c.id)}" aria-pressed="${c.fav}" aria-label="${c.fav ? "Remove from favorites" : "Add to favorites"}" title="${c.fav ? "Remove from favorites" : "Favorite"}">★</button>` : (c.fav ? `<span class="bdStar on" title="Favorite" aria-label="Favorite">★</span>` : "");
  const ph = `<div class="bdPh">${esc(initial(c))}${hasImg ? `<img loading="lazy" referrerpolicy="no-referrer" src="${esc(c.photo)}" alt="${esc(c.title)}" data-card="${esc(c.id)}">` : ""}${c.photos.length > 1 ? `<span class="bdCount" title="${c.photos.length} photos">▣ ${c.photos.length}</span>` : ""}${star}</div>`;
  const links = c.links.map((l) => `<a class="bdBtn" href="${esc(l.url)}" target="_blank" rel="noopener noreferrer">${esc(l.label)}</a>`).join("");
  const drag = o.can && !o.showGroup ? ` draggable="true"` : "";
  return `<article class="bdCard${c.passed ? " passed" : ""}${c.done ? " done" : ""}" tabindex="0" data-id="${esc(c.id)}" data-key="${esc(c.key)}" data-group="${esc(c.group)}"${drag} aria-label="${esc(c.title + ", " + c.group + (c.status ? ", " + c.status : ""))}">${ph}
    <div class="bdInfo">${o.showGroup ? `<div class="bdGrp">${esc(c.group)}</div>` : ""}<div class="bdName">${esc(c.title)}</div>${c.status ? `<span class="bdSt ${slug(c.status)}">${esc(c.status)}</span>` : ""}${c.notes ? `<div class="bdNotes">${esc(c.notes)}</div>` : ""}${links ? `<div class="bdLinks">${links}</div>` : ""}</div></article>`;
}
function drawBody(p){
  const box = document.getElementById("bdBody"); if(!box) return;
  const top = box.scrollTop;
  const ta0 = document.getElementById("bdBriefTa"); if(ta0) S.briefDraft = ta0.value;   // typing survives a redraw
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
  const can = canWrite(p), max = d.maxOptions || 12;
  const addBtn = (g, big) => can && g.cards.length < max ? `<button class="bdAdd" type="button" data-badd="${esc(g.name)}" aria-label="Add an option to ${esc(g.name)}">+ ${big ? "Add " + noun : "Add"}</button>` : "";
  const sheetLink = d.url ? esc(d.url + ((S.tab === "cast" ? d.castGid : d.locGid) ? "#gid=" + (S.tab === "cast" ? d.castGid : d.locGid) : "")) : "";
  const favs = L.favoritesOf(vis);
  const favHtml = favs.length ? (() => {
    const key = S.tab + "|__fav", shut = !!S.closed[key];
    return `<section class="bdGroup bdFav${shut ? " shut" : ""}"><button class="bdGH" type="button" data-bg="${esc(key)}" aria-expanded="${!shut}">${ICON.chev}<span class="bdGN">★ Favorites</span><span class="bdGS">${favs.length}</span></button>
      <div class="bdGrid ${S.tab}">${favs.map((c) => cardHtml(c, S.tab, { can, showGroup: true })).join("")}</div></section>`;
  })() : "";
  const briefHtml = (g) => {
    const key = S.tab + "|" + g.name;
    if(S.briefEdit === key) return `<div class="bdBriefForm"><textarea id="bdBriefTa" aria-label="Brief for ${esc(g.name)}" placeholder="${S.tab === "cast" ? "Who is this character? Age, look, what they need from the actor." : "What the place needs: look, feel, access, constraints."}">${esc(S.briefDraft != null ? S.briefDraft : g.brief)}</textarea><div><button class="btn sm primary" type="button" data-brsave="${esc(g.name)}">Save</button><button class="btn sm" type="button" data-brcancel="1">Cancel</button></div></div>`;
    if(g.brief) return `<div class="bdBrief">${esc(g.brief)}${can ? ` <button type="button" data-brief="${esc(g.name)}">edit</button>` : ""}</div>`;
    return can ? `<button class="bdBriefAdd" type="button" data-brief="${esc(g.name)}">+ brief</button>` : "";
  };
  box.innerHTML = favHtml + vis.map((g) => {
    const key = S.tab + "|" + g.name, shut = !!S.closed[key];
    const done = g.cards.find((c) => c.done);
    const sum = done ? `<span class="bdGS done">✓ ${esc(done.title)}</span>` : `<span class="bdGS">${g.cards.length ? g.cards.length + " option" + (g.cards.length === 1 ? "" : "s") : "no options yet"}</span>`;
    return `<section class="bdGroup${shut ? " shut" : ""}"><button class="bdGH" type="button" data-bg="${esc(key)}" aria-expanded="${!shut}">${ICON.chev}<span class="bdGN">${esc(g.name)}</span>${g.type ? `<span class="bdGT">${esc(g.type)}</span>` : ""}${sum}</button>
      ${briefHtml(g)}
      ${g.cards.length ? `<div class="bdGrid ${S.tab}">${g.cards.map((c) => cardHtml(c, S.tab, { can })).join("")}${addBtn(g, false)}</div>` : `<div class="bdNone">No ${noun} options yet.${can ? addBtn(g, true) : ""}${sheetLink ? ` ${can ? "Or add" : "Add"} one in <a href="${sheetLink}" target="_blank" rel="noopener">the Sheet</a>.` : ""}</div>`}</section>`;
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
  closeViewer();
  const el = document.getElementById("bdShade"); if(el) el.remove();
  document.removeEventListener("keydown", detailKeys, true);
  if(!quiet && lastFocus && document.body.contains(lastFocus)) lastFocus.focus();
  S.open = null; S.edit = null;
}
function detailKeys(e){
  if(S.viewer){
    if(e.key === "Escape"){ e.preventDefault(); e.stopPropagation(); closeViewer(); }
    else if(e.key === "ArrowRight" || e.key === "ArrowLeft"){ e.preventDefault(); stepViewer(e.key === "ArrowRight" ? 1 : -1); }
    return;
  }
  if(S.edit){
    if(e.key === "Escape"){ e.preventDefault(); e.stopPropagation(); cancelEdit(); }
    else if(e.key === "Enter" && (e.ctrlKey || e.metaKey)){ e.preventDefault(); saveEdit(false); }
    return;
  }
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
  const links = c.links.concat(c.contact).map((l) => `<a class="bdBtn" href="${esc(l.url)}"${l.kind === "tel" || l.kind === "mail" ? "" : ` target="_blank" rel="noopener noreferrer"`}>${esc(l.label)}</a>`).join("");
  const can = canWrite(S.hubP);
  const mv = can ? `<button class="btn sm" type="button" data-bd="earlier" title="Move this option earlier in its list">Earlier</button><button class="btn sm" type="button" data-bd="later" title="Move this option later in its list">Later</button>` : "";
  const favBtn = can ? `<button class="btn sm" type="button" data-bd="fav" aria-pressed="${c.fav}">${c.fav ? "★ Favorite" : "☆ Favorite"}</button>` : "";
  const quick = can ? `<select class="bdQuick" data-bd="status" aria-label="Set the status" title="Set the status (saved to the Sheet)"><option value="">No status</option>${statusOptions(L.statusList(d, c.kind), c.raw.status)}</select>` : "";
  const rowLink = d && d.url ? esc(d.url + (gid ? "#gid=" + gid + "&range=A" + c.row : "")) : "";
  const html = `<div class="bdShade" id="bdShade"><div class="bdDlg ${c.kind}" role="dialog" aria-modal="true" aria-label="${esc(c.title)}">
    <div class="bdPh"${c.photos.length ? ` data-bd="view" title="View ${c.photos.length > 1 ? "all " + c.photos.length + " photos" : "the photo"}"` : ""}>${esc(initial(c))}${c.photos.length > 1 ? `<span class="bdCount">▣ ${c.photos.length}</span>` : ""}${c.photo && !bad ? `<img referrerpolicy="no-referrer" src="${esc(c.photo)}" alt="${esc(c.title)}" data-card="${esc(c.id)}">` : ""}</div>
    <div class="bdDBody"><div class="bdDHead"><h2>${esc(c.title)}</h2><button class="iconBtn" type="button" data-bd="close" aria-label="Close" title="Close (Esc)">${ICON.close}</button></div>
      <div class="bdDMeta">${esc(c.group)}${c.groupType ? " · " + esc(c.groupType) : ""}</div>
      ${c.status ? `<span class="bdSt ${slug(c.status)}">${esc(c.status)}</span>` : ""}
      ${rows.length ? `<dl class="bdRows">${rows.map((r) => `<dt>${r[0]}</dt><dd>${r[1]}</dd>`).join("")}</dl>` : ""}
      ${c.notes ? `<div class="bdDNotes">${esc(c.notes)}</div>` : ""}
      ${hint ? `<div class="bdHint">${esc(hint)}</div>` : ""}
      ${links ? `<div class="bdLinks">${links}</div>` : ""}
      <div class="bdDFoot"><button class="btn sm" type="button" data-bd="prev"${prev ? "" : " disabled"} aria-label="Previous option" title="Previous (←)">←</button><button class="btn sm" type="button" data-bd="next"${next ? "" : " disabled"} aria-label="Next option" title="Next (→)">→</button>${quick}${favBtn}${mv}<span class="sp"></span>${can ? `<button class="btn sm danger" type="button" data-bd="delete" title="Delete this option">Delete</button><button class="btn sm" type="button" data-bd="edit" title="Change this option and save it to the Sheet">Edit</button>` : ""}${rowLink ? `<a class="btn sm" href="${rowLink}" target="_blank" rel="noopener" title="Open this row in Google Sheets">${ICON.ext}<span class="lbl">Edit in Sheet</span></a>` : ""}</div>
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
    else if(b.dataset.bd === "edit") openEditor(c);
    else if(b.dataset.bd === "view") openViewer(c.id, 0);
    else if(b.dataset.bd === "fav") toggleFav(c);
    else if(b.dataset.bd === "earlier") moveCard(c, -1);
    else if(b.dataset.bd === "later") moveCard(c, 1);
    else if(b.dataset.bd === "delete") deleteCard(c);
  });
  shade.addEventListener("change", (e) => {
    if(e.target.dataset && e.target.dataset.bd === "status") quickStatus(c, e.target.value);
  });
  shade.addEventListener("error", onImgError, true);
  document.removeEventListener("keydown", detailKeys, true);
  document.addEventListener("keydown", detailKeys, true);
  const qs = shade.querySelector("[data-bd=status]"); if(qs) qs.value = c.raw.status;
  if(!keep){ const x = shade.querySelector("[data-bd=close]"); if(x) x.focus(); }
}

/* ---------- editing: writes to the Sheet ---------- */
function canWrite(p){ const h = H(); return !!(p && h && h.canEdit && h.canEdit(p) && h.ripPost); }
function statusOptions(list, cur){
  const all = cur && list.indexOf(cur) < 0 ? list.concat([cur]) : list;
  return all.map((s) => `<option value="${esc(s)}">${esc(s)}</option>`).join("");
}
function setData(fn){
  const rec = S.data[S.fileId]; if(!rec || !rec.d) return;
  S.data[S.fileId] = Object.assign({}, rec, { state: "ok", d: fn(rec.d), at: Date.now() });
}
async function post(body){
  const res = await H().ripPost(Object.assign({ action: "boardsave", fileId: S.fileId }, body));
  if(res && res.ok === false){
    const e = new Error(res.error || "The Sheet didn't accept that change."); e.gone = !!res.gone; throw e;
  }
  return res;
}
function afterSheetMoved(){ load(S.fileId, true); }   // rows moved (added / removed): read the true row numbers again
// The status dropdown in the detail view: one field, saved at once
async function quickStatus(c, status){
  status = String(status || "");
  if(status === c.raw.status) return;
  try{
    const res = await post({ kind: c.kind, op: "set", rowKey: c.key, fields: { status }, base: { status: c.raw.status } });
    if(res.conflict){ H().toast("The status was changed in the Sheet meanwhile. Showing the Sheet's version.", "err"); setData((d) => L.withCandidate(d, c.kind, res.candidate)); }
    else setData((d) => L.withCandidate(d, c.kind, res.candidate));
  }catch(err){ H().toast("Couldn't save: " + ((err && err.message) || err), "err"); if(err && err.gone) afterSheetMoved(); }
  if(S.pid) render(S.pid);
  if(S.open) showDetail(S.open, true);
}
async function toggleFav(c){
  try{
    const res = await post({ kind: c.kind, op: "set", rowKey: c.key, fields: { favorite: c.fav ? "" : "1" } });
    setData((d) => L.withCandidate(d, c.kind, res.candidate));
  }catch(err){ H().toast("Couldn't save: " + ((err && err.message) || err), "err"); if(err && err.gone) afterSheetMoved(); }
  if(S.pid) render(S.pid);
  if(S.open && findCard(S.open)) showDetail(S.open, true);
}
// Put a card earlier / later in its list, or (drag) before another; the order is written to the Sheet
async function moveCard(c, to, silent){
  const g = current().groups.find((x) => x.name === c.group); if(!g) return;
  const keys = L.reorder(g.cards.map((x) => x.key), c.key, to);
  if(keys.join("|") === g.cards.map((x) => x.key).join("|")) return;
  const before = S.data[S.fileId] && S.data[S.fileId].d;
  setData((d) => L.withOrder(d, c.kind, keys));
  if(S.pid) render(S.pid);
  if(S.open && !silent && findCard(S.open)) showDetail(S.open, true);
  try{ await post({ kind: c.kind, op: "order", keys }); }
  catch(err){
    H().toast("Couldn't save the order: " + ((err && err.message) || err), "err");
    if(before) setData(() => before);
    if(S.pid) render(S.pid);
  }
}
async function deleteCard(c){
  if(!(await H().confirm("Delete " + c.title + "?", "It's removed from the Sheet too. This can't be undone from here.", "Delete", true))) return;
  try{
    const res = await post({ kind: c.kind, op: "clear", rowKey: c.key });
    setData((dd) => L.withoutCandidate(dd, c.kind, c.key, !!res.removedRow));
    if(res.removedRow) afterSheetMoved();
    H().toast("Deleted.", "ok");
    closeDetail(true);
  }catch(err){ H().toast("Couldn't delete: " + ((err && err.message) || err), "err"); if(err && err.gone) afterSheetMoved(); }
  if(S.pid) render(S.pid);
}
/* ---------- the photo viewer ---------- */
function closeViewer(){ const v = document.getElementById("bdView"); if(v) v.remove(); S.viewer = null; }
function openViewer(id, i){
  const c = findCard(id); if(!c || !c.photos.length) return;
  S.viewer = { id, i: Math.max(0, Math.min(i || 0, c.photos.length - 1)) }; drawViewer();
}
function stepViewer(d){
  const v = S.viewer, c = v && findCard(v.id); if(!c) return;
  v.i = (v.i + d + c.photos.length) % c.photos.length; drawViewer();
}
function drawViewer(){
  const v = S.viewer, c = v && findCard(v.id); if(!c){ closeViewer(); return; }
  const n = c.photos.length, u = c.photos[v.i], src = L.viewSrc(u, true), can = canWrite(S.hubP);
  const old = document.getElementById("bdView"); if(old) old.remove();
  const nav = n > 1 ? `<button class="nav l" type="button" data-vw="prev" aria-label="Previous photo">‹</button><button class="nav r" type="button" data-vw="next" aria-label="Next photo">›</button>` : "";
  const fig = src ? `<img referrerpolicy="no-referrer" src="${esc(src)}" alt="${esc(c.title)}">` : `<div class="bdHint">This link can't be shown here. <a href="${esc(u)}" target="_blank" rel="noopener noreferrer">Open it</a></div>`;
  document.body.insertAdjacentHTML("beforeend", `<div class="bdShade bdView" id="bdView" role="dialog" aria-modal="true" aria-label="Photos of ${esc(c.title)}">
    <button class="iconBtn x" type="button" data-vw="close" aria-label="Close photos" title="Close (Esc)">${ICON.close}</button>${nav}<figure>${fig}</figure>
    <div class="bdVBar"><span>${esc(c.title)} · ${v.i + 1} / ${n}</span>${v.i === 0 ? `<span>★ Display photo</span>` : (can ? `<button class="btn sm" type="button" data-vw="main">Make display photo</button>` : "")}<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">Open original</a></div></div>`);
  const el = document.getElementById("bdView"); let x0 = null;
  el.addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-vw]");
    if(!b){ if(ev.target === el || ev.target.tagName === "FIGURE") closeViewer(); return; }
    const k = b.dataset.vw;
    if(k === "close") closeViewer(); else if(k === "prev") stepViewer(-1); else if(k === "next") stepViewer(1); else if(k === "main") makeDisplayPhoto(c, u);
  });
  el.addEventListener("touchstart", (ev) => { x0 = ev.touches[0].clientX; }, { passive: true });
  el.addEventListener("touchend", (ev) => { if(x0 == null) return; const dx = ev.changedTouches[0].clientX - x0; x0 = null; if(Math.abs(dx) > 50) stepViewer(dx < 0 ? 1 : -1); }, { passive: true });
  el.addEventListener("error", (ev) => { if(ev.target.tagName === "IMG"){ const f = ev.target.parentNode; f.innerHTML = `<div class="bdHint">The photo didn't load. If it's on Drive, set sharing to “Anyone with the link”.</div>`; } }, true);
  const close = el.querySelector("[data-vw=close]"); if(close) close.focus();
  if(!S.edit){ document.removeEventListener("keydown", detailKeys, true); document.addEventListener("keydown", detailKeys, true); }
}
// Choose which photo is the card's display photo
async function makeDisplayPhoto(c, url){
  const list = L.makeDisplay(c.photos, url), pf = L.photoFields(list);
  try{
    const res = await post({ kind: c.kind, op: "set", rowKey: c.key, fields: { photo: pf.photo, photos: pf.photos }, base: { photo: c.raw.photo, photos: L.photoFields(c.photos).photos.join("\n") } });
    if(res.conflict) H().toast("The photos changed in the Sheet meanwhile. Showing the Sheet's version.", "err");
    setData((d) => L.withCandidate(d, c.kind, res.candidate));
  }catch(err){ H().toast("Couldn't save: " + ((err && err.message) || err), "err"); }
  if(S.pid) render(S.pid);
  if(S.open && findCard(S.open)) showDetail(S.open, true);
  if(S.viewer){ S.viewer.i = 0; drawViewer(); }
}
async function saveBrief(group){
  const ta = document.getElementById("bdBriefTa"); if(!ta) return;
  const text = ta.value.trim(), kind = S.tab;
  S.briefEdit = ""; S.briefDraft = null;
  setData((d) => L.withBrief(d, kind, group, text));
  if(S.pid) render(S.pid);
  try{ await post({ kind, op: "brief", group, text }); }
  catch(err){ H().toast("Couldn't save the brief: " + ((err && err.message) || err), "err"); afterSheetMoved(); }
}
function openEditor(c, groupName){
  const kind = S.tab;
  const base = c ? Object.assign({}, c.raw) : {};
  L.fieldsOf(kind).forEach((f) => { if(!(f in base)) base[f] = ""; });
  S.edit = { kind, id: c ? c.id : "", key: c ? c.key : "", group: c ? c.group : groupName, base, vals: Object.assign({}, base), busy: false, err: "", conflict: null,
    photos: c ? c.photos.slice() : [], basePhotos: c ? c.photos.slice() : [], uploading: 0, linkDraft: "" };
  if(!document.getElementById("bdShade")) lastFocus = document.activeElement;
  showEditor();
}
function dirty(){ const e = S.edit; return !!e && (!L.samePhotos(e.photos, e.basePhotos) || L.fieldsOf(e.kind).some((f) => f !== "photo" && String(e.vals[f] || "").trim() !== String(e.base[f] || "").trim())); }
async function cancelEdit(){
  const e = S.edit; if(!e || e.busy) return;
  if(dirty() && !(await H().confirm("Discard your changes?", "What you typed here hasn't been saved to the Sheet.", "Discard", true))) return;
  const id = e.id; S.edit = null;
  if(id && findCard(id)) showDetail(id, true); else closeDetail();
}
function showEditor(){
  const e = S.edit; if(!e) return;
  const kind = e.kind, isAdd = !e.key, f1 = L.fieldsOf(kind)[0], d = (S.data[S.fileId] || {}).d;
  const statuses = L.statusList(d, kind), v = e.vals;
  const inp = (name, label, extra) => `<label>${label}<input data-f="${name}" value="${esc(v[name] || "")}" autocomplete="off" ${extra || ""}></label>`;
  const conf = e.conflict ? `<div class="bdConf"><b>Changed in the Sheet since you opened this</b>${e.conflict.fields.map((f) => `${esc(f)}: now “${esc(e.conflict.candidate[f])}”`).join(" · ")}<div><button class="btn sm" type="button" data-be="mine">Keep my version</button><button class="btn sm" type="button" data-be="theirs">Use the Sheet's version</button></div></div>` : "";
  const html = `<div class="bdShade" id="bdShade"><div class="bdDlg add ${kind}" role="dialog" aria-modal="true" aria-label="${isAdd ? "Add an option" : "Edit option"}">
    <div class="bdDBody"><div class="bdDHead"><h2>${isAdd ? "Add " + (kind === "cast" ? "an actor" : "a place") + " to " + esc(e.group) : "Edit " + esc(e.base[f1] || e.group)}</h2><button class="iconBtn" type="button" data-be="cancel" aria-label="Close" title="Close (Esc)">${ICON.close}</button></div>
    <form class="bdForm" id="bdForm" novalidate>
      ${inp(f1, kind === "cast" ? "Actor name" : "Address", `placeholder="${kind === "cast" ? "Who is it?" : "Street, suburb"}"`)}
      <label>Status<select data-f="status"><option value="">No status</option>${statusOptions(statuses, e.base.status)}</select></label>
      <div class="two">${inp("phone", "Phone", `inputmode="tel"`)}${inp("email", "Email", `inputmode="email"`)}</div>
      ${kind === "cast" ? `<div class="two">${inp("showreel", "Showreel link", `inputmode="url" placeholder="YouTube, Vimeo…"`)}${inp("audition", "Audition tape link", `inputmode="url" placeholder="Self-tape or audition"`)}</div>` : ""}
      ${photosBlock(e)}
      <label>Notes<textarea data-f="notes" placeholder="Links to a reel, IMDb or listing become buttons">${esc(v.notes || "")}</textarea></label>
      ${conf}${e.err ? `<div class="bdErr" role="alert">${esc(e.err)}</div>` : ""}
      <div class="bdDFoot">${isAdd ? "" : `<button class="btn sm danger" type="button" data-be="remove"${e.busy ? " disabled" : ""}>Remove</button>`}<span class="sp"></span><button class="btn sm" type="button" data-be="cancel"${e.busy ? " disabled" : ""}>Cancel</button><button class="btn sm primary" type="submit"${e.busy || e.uploading ? " disabled" : ""}>${e.busy ? `<span class="spin"></span>` : ""}${isAdd ? "Add" : "Save"}</button></div>
      <div class="bdKeys">Saved straight to the Sheet · Ctrl+Enter to save</div>
    </form></div></div></div>`;
  const old = document.getElementById("bdShade"); if(old) old.remove();
  document.body.insertAdjacentHTML("beforeend", html);
  const shade = document.getElementById("bdShade"), form = shade.querySelector("#bdForm");
  form.querySelector("[data-f=status]").value = v.status || "";
  form.addEventListener("input", (ev) => { const n = ev.target.dataset && ev.target.dataset.f; if(n) e.vals[n] = ev.target.value; if(ev.target.dataset && "pl" in ev.target.dataset) e.linkDraft = ev.target.value; });
  form.addEventListener("keydown", (ev) => { if(ev.key === "Enter" && ev.target.dataset && "pl" in ev.target.dataset){ ev.preventDefault(); ev.stopPropagation(); addLinkFromInput(); } });
  const drop = shade.querySelector("#bdDrop"), file = shade.querySelector("#bdFile");
  const hasFiles = (ev) => ev.dataTransfer && Array.from(ev.dataTransfer.types || []).indexOf("Files") >= 0;
  shade.addEventListener("dragover", (ev) => { if(hasFiles(ev)){ ev.preventDefault(); if(drop) drop.classList.toggle("over", !!ev.target.closest("#bdDrop")); } });
  shade.addEventListener("dragleave", (ev) => { if(drop && !shade.contains(ev.relatedTarget)) drop.classList.remove("over"); });
  shade.addEventListener("drop", (ev) => { if(!hasFiles(ev)) return; ev.preventDefault(); if(drop) drop.classList.remove("over"); addFiles(ev.dataTransfer.files); });
  if(file) file.addEventListener("change", () => { const fl = Array.from(file.files || []); file.value = ""; addFiles(fl); });
  form.addEventListener("change", (ev) => { const n = ev.target.dataset && ev.target.dataset.f; if(n) e.vals[n] = ev.target.value; });
  form.addEventListener("submit", (ev) => { ev.preventDefault(); saveEdit(false); });
  shade.addEventListener("click", (ev) => {
    if(ev.target === shade){ cancelEdit(); return; }
    const b = ev.target.closest("[data-be]"); if(!b) return;
    const k = b.dataset.be;
    if(k === "cancel") cancelEdit();
    else if(k === "remove") removeOption();
    else if(k === "mine") saveEdit(true);
    else if(k === "theirs") useSheetVersion();
    else if(k === "pick"){ const f = shade.querySelector("#bdFile"); if(f) f.click(); }
    else if(k === "addlink") addLinkFromInput();
    else if(k === "rmphoto"){ e.photos = L.removePhoto(e.photos, b.dataset.u); syncPhotoVal(e); showEditor(); }
    else if(k === "mkmain"){ e.photos = L.makeDisplay(e.photos, b.dataset.u); syncPhotoVal(e); showEditor(); }
  });
  document.removeEventListener("keydown", detailKeys, true);
  document.addEventListener("keydown", detailKeys, true);
  const first = form.querySelector(e.err ? "[data-f]" : "[data-f=" + f1 + "]"); if(first && !e.conflict) first.focus();
}
/* ---------- photos in the editor: upload, drag in, paste a link, choose the display photo ---------- */
function photosBlock(e){
  const tiles = e.photos.map((u, i) => {
    const src = L.viewSrc(u, false);
    return `<div class="bdThumb${i === 0 ? " main" : ""}" title="${i === 0 ? "Display photo" : ""}">${src ? `<img referrerpolicy="no-referrer" src="${esc(src)}" alt="">` : esc(L.hostOf(u) || "link")}${i > 0 ? `<button class="mk" type="button" data-be="mkmain" data-u="${esc(u)}" title="Make this the display photo" aria-label="Make this the display photo">★</button>` : ""}<button class="rm" type="button" data-be="rmphoto" data-u="${esc(u)}" title="Remove this photo" aria-label="Remove this photo">✕</button></div>`;
  }).join("") + Array.from({ length: e.uploading || 0 }, () => `<div class="bdThumb up"><span class="spin"></span></div>`).join("");
  const full = e.photos.length + (e.uploading || 0) >= L.MAX_PHOTOS;
  return `<div class="bdPhotos"><div class="bdPhLabel">Photos <span>· the starred one is the display photo</span></div>
    ${tiles ? `<div class="bdThumbs">${tiles}</div>` : ""}
    ${full ? "" : `<div class="bdDrop" id="bdDrop">Drop photos here or <button type="button" data-be="pick">choose from your device</button><input type="file" id="bdFile" accept="image/*" multiple hidden></div>
    <div class="bdLinkAdd"><input data-pl value="${esc(e.linkDraft || "")}" inputmode="url" placeholder="…or paste a photo link" autocomplete="off" aria-label="Photo link"><button type="button" data-be="addlink">Add</button></div>`}</div>`;
}
function syncPhotoVal(e){ const f = L.photoFields(e.photos); e.vals.photo = f.photo; }
function addLinkFromInput(){
  const e = S.edit, inp = e && document.querySelector("#bdForm [data-pl]"); if(!e || !inp) return;
  const raw = inp.value.trim(); if(!raw) return;
  if(!L.safeUrl(raw)){ e.err = "That doesn't look like a web link."; e.linkDraft = raw; showEditor(); return; }
  e.photos = L.addPhotos(e.photos, [raw]); e.linkDraft = ""; e.err = ""; syncPhotoVal(e); showEditor();
}
// Shrink a photo before it goes up (a phone photo can be 10MB); returns a JPEG data address
function shrink(file){
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file), img = new Image();
    img.onload = () => {
      try{
        const max = 1600, k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
        const cv = document.createElement("canvas"); cv.width = Math.max(1, Math.round(img.naturalWidth * k)); cv.height = Math.max(1, Math.round(img.naturalHeight * k));
        const cx = cv.getContext("2d"); cx.fillStyle = "#fff"; cx.fillRect(0, 0, cv.width, cv.height); cx.drawImage(img, 0, 0, cv.width, cv.height);
        resolve(cv.toDataURL("image/jpeg", 0.85));
      }catch(err){ reject(err); } finally { URL.revokeObjectURL(url); }
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("unreadable")); };
    img.src = url;
  });
}
function readRaw(file){ return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = () => rej(new Error("unreadable")); r.readAsDataURL(file); }); }
async function addFiles(files){
  const e = S.edit; if(!e) return;
  const list = Array.from(files || []);
  for(const f of list){
    if(!L.imageOk(f.type, f.size)){ H().toast("“" + f.name + "” isn't a photo I can use.", "err"); continue; }
    if(e.photos.length + (e.uploading || 0) >= L.MAX_PHOTOS){ H().toast("That's the most photos one option can hold (" + L.MAX_PHOTOS + ").", "err"); break; }
    e.uploading = (e.uploading || 0) + 1; showEditor();
    try{
      let dataUrl;
      try{ dataUrl = await shrink(f); }
      catch(_e){ if(f.size < 6 * 1024 * 1024 && /^image\/(jpeg|png|webp|gif)$/i.test(f.type)) dataUrl = await readRaw(f); else throw new Error("couldn't read that picture (HEIC? try JPEG)"); }
      const res = await H().ripPost({ action: "boardphoto", fileId: S.fileId, dataUrl, name: f.name });
      if(!res || res.ok === false) throw new Error((res && res.error) || "upload failed");
      if(S.edit !== e) return;                 // the form was closed meanwhile; the file stays in Drive
      e.photos = L.addPhotos(e.photos, [res.url]);
      if(res.shared === false) H().toast("The photo is in Drive, but Drive wouldn't let anyone view it by link. Share it as “Anyone with the link” to see it here.", "err", 9000);
    }catch(err){ H().toast("“" + f.name + "”: " + ((err && err.message) || err), "err"); }
    if(S.edit !== e) return;
    e.uploading = Math.max(0, (e.uploading || 0) - 1); syncPhotoVal(e); showEditor();
  }
}
function useSheetVersion(){
  const e = S.edit; if(!e || !e.conflict) return;
  const cand = e.conflict.candidate;
  setData((d) => L.withCandidate(d, e.kind, cand));
  const id = e.id; S.edit = null;
  if(S.pid) render(S.pid);
  if(id && findCard(id)) showDetail(id, true); else closeDetail();
}
async function saveEdit(force){
  const e = S.edit; if(!e || e.busy) return;
  const d = (S.data[S.fileId] || {}).d, isAdd = !e.key;
  if(e.uploading) return;
  const photosChanged = !L.samePhotos(e.photos, e.basePhotos), pf = L.photoFields(e.photos);
  if(photosChanged) e.vals.photo = pf.photo; else e.vals.photo = e.base.photo;   // an unchanged photo is never rewritten
  const bad = L.checkEdit(e.kind, e.vals, L.statusList(d, e.kind), isAdd);
  if(bad){ e.err = bad; showEditor(); return; }
  let body;
  if(isAdd){
    const fields = L.tidyValues(e.kind, e.vals); Object.keys(fields).forEach((k) => { if(!fields[k]) delete fields[k]; });
    if(pf.photos.length) fields.photos = pf.photos;
    body = { kind: e.kind, op: "add", group: e.group, fields };
  }else{
    const fields = L.changes(e.kind, e.base, e.vals);
    const base = {};
    if(photosChanged){ fields.photo = pf.photo; fields.photos = pf.photos; base.photo = e.base.photo; base.photos = L.photoFields(e.basePhotos).photos.join("\n"); }
    else delete fields.photo;
    if(!Object.keys(fields).length){ const id = e.id; S.edit = null; showDetail(id, true); return; }
    Object.keys(fields).forEach((k) => { if(!(k in base)) base[k] = e.base[k]; });
    body = { kind: e.kind, op: "set", rowKey: e.key, fields, base, force: !!force };
  }
  e.busy = true; e.err = ""; showEditor();
  try{
    const res = await post(body);
    if(res.conflict){ e.busy = false; e.conflict = res; showEditor(); return; }
    setData((dd) => L.withCandidate(dd, e.kind, res.candidate));
    const id = S.fileId + "|" + res.candidate.key;
    S.edit = null;
    if(res.inserted) afterSheetMoved();
    H().toast(isAdd ? "Added to the Sheet." : "Saved to the Sheet.", "ok");
    if(S.pid) render(S.pid);
    if(findCard(id)) showDetail(id, true); else closeDetail();
  }catch(err){
    e.busy = false; e.err = (err && err.message) || String(err);
    if(err && err.gone) afterSheetMoved();
    showEditor();
  }
}
async function removeOption(){
  const e = S.edit; if(!e || e.busy || !e.key) return;
  if(!(await H().confirm("Remove this option?", "It's emptied in the Sheet too. This can't be undone from here.", "Remove", true))) return;
  e.busy = true; showEditor();
  try{
    const res = await post({ kind: e.kind, op: "clear", rowKey: e.key });
    setData((dd) => L.withoutCandidate(dd, e.kind, e.key, !!res.removedRow));
    S.edit = null;
    if(res.removedRow) afterSheetMoved();
    H().toast("Removed from the Sheet.", "ok");
    closeDetail(true);
    if(S.pid) render(S.pid);
  }catch(err){
    e.busy = false; e.err = (err && err.message) || String(err);
    if(err && err.gone) afterSheetMoved();
    showEditor();
  }
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
    const fv = t.closest("[data-fav]");
    if(fv){ const c = findCard(fv.dataset.fav); if(c) toggleFav(c); return; }
    const br = t.closest("[data-brief]");
    if(br){ S.briefEdit = S.tab + "|" + br.dataset.brief; S.briefDraft = null; drawBody(p); const ta = document.getElementById("bdBriefTa"); if(ta){ ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); } return; }
    const bs2 = t.closest("[data-brsave]");
    if(bs2){ saveBrief(bs2.dataset.brsave); return; }
    if(t.closest("[data-brcancel]")){ S.briefEdit = ""; S.briefDraft = null; drawBody(p); return; }
    const ad = t.closest("[data-badd]");
    if(ad){ openEditor(null, ad.dataset.badd); return; }
    const card = t.closest(".bdCard");
    if(card && !t.closest("a,button")) showDetail(card.dataset.id);
  };
  box.onkeydown = (e) => {
    const card = e.target.closest && e.target.closest(".bdCard");
    if(card && e.target === card && (e.key === "Enter" || e.key === " ")){ e.preventDefault(); showDetail(card.dataset.id); }
  };
  // drag a card onto another in the same list to reorder
  box.ondragstart = (e) => {
    const card = e.target.closest && e.target.closest(".bdCard[draggable=true]"); if(!card) return;
    S.drag = { key: card.dataset.key, group: card.dataset.group };
    card.classList.add("dragging");
    try{ e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", card.dataset.key); }catch(_e){}
  };
  box.ondragover = (e) => {
    const card = e.target.closest && e.target.closest(".bdCard"); if(!card || !S.drag) return;
    if(card.dataset.group !== S.drag.group || card.dataset.key === S.drag.key || card.closest(".bdFav")) return;
    e.preventDefault(); box.querySelectorAll(".bdCard.over").forEach((x) => { if(x !== card) x.classList.remove("over"); }); card.classList.add("over");
  };
  box.ondragend = () => { S.drag = null; box.querySelectorAll(".dragging,.over").forEach((x) => x.classList.remove("dragging", "over")); };
  box.ondrop = (e) => {
    const card = e.target.closest && e.target.closest(".bdCard"), d = S.drag; S.drag = null;
    box.querySelectorAll(".dragging,.over").forEach((x) => x.classList.remove("dragging", "over"));
    if(!card || !d || card.dataset.group !== d.group || card.closest(".bdFav")) return;
    e.preventDefault();
    const moving = current().groups.reduce((a, g) => a || g.cards.find((c) => c.key === d.key), null);
    if(moving && card.dataset.key !== d.key) moveCard(moving, card.dataset.key, true);
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
// Keep the Board close to the Sheet while it's on screen and nobody is typing
setInterval(() => {
  if(document.visibilityState !== "visible" || !S.pid || !S.fileId || S.edit) return;
  const box = document.getElementById("boardPane"); if(!box || box.classList.contains("hidden")) return;
  const rec = S.data[S.fileId]; if(rec && rec.state === "ok" && Date.now() - rec.at > 45000) load(S.fileId, true);
}, 15000);
window.CampBoard = Object.assign(window.CampBoard || {}, { render, reload: () => S.fileId && load(S.fileId, true) });
})();
