/* bdtag.js — tag script text for the breakdown, from the editor.
   Select words (SHOTGUN, a red dress, the old ute…), press Ctrl/Cmd+Alt+B or the Tag button, pick a category.
   The element is added to that scene's breakdown sheet (the Breakdown tab shows it), and the words are
   coloured in the script by category. Nothing is written into the script itself: tags go into this device's
   copy of the breakdown plus a queue the hub uploads to the team (bdpanel.js), and the colours are drawn with the browser's
   highlight layer, so printing, exports and the saved script are untouched.
   View › Show Breakdown Tags (Ctrl/Cmd+Alt+T) colours every active tag, suggestions included, with a key.
   Needs: breakdown.js, elements.js. Works on editor.html. */
(function(){
"use strict";
const E = window.CampElements;
const fileId = new URLSearchParams(location.search).get("fileId") || "";
if(!E || !fileId) return;
const STORE_KEY = "Camp_BD_V1_" + fileId, LAST_KEY = "Camp_BD_LASTCAT_V1", SHOW_KEY = "Camp_BD_SHOW_V1";
const lsGet = (k) => { try{ return localStorage.getItem(k); }catch(_e){ return null; } };
const lsSet = (k, v) => { try{ localStorage.setItem(k, v); }catch(_e){} };
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;" }[c]));
const editor = () => document.getElementById("scriptEditor");
const say = (m) => { try{ if(typeof window.setStatus === "function") window.setStatus(m); }catch(_e){} };
const canHighlight = typeof CSS !== "undefined" && CSS.highlights && typeof Highlight === "function";

function load(){ try{ const v = JSON.parse(lsGet(STORE_KEY) || "{}"); return v && typeof v === "object" ? v : {}; }catch(_e){ return {}; } }
function save(st){ lsSet(STORE_KEY, JSON.stringify(st || {})); }
// The hub uploads these to the team's copy (Breakdown tab) the next time it's open, or straight away if it is
const PEND_KEY = "Camp_BD_PENDING_V1_" + fileId;
function queue(op){ try{ const l = JSON.parse(lsGet(PEND_KEY) || "[]"); (Array.isArray(l) ? l : []).push(op); lsSet(PEND_KEY, JSON.stringify(l.slice(-500))); }catch(_e){ lsSet(PEND_KEY, JSON.stringify([op])); } }
const showColours = () => lsGet(SHOW_KEY) === "1";

/* ---------- styles ---------- */
const css = `
.bdtBtn{ position:fixed; z-index:99999; display:inline-flex; align-items:center; gap:6px; height:32px; padding:0 12px; border-radius:16px; background:#ececf0; color:#111; border:0; font:600 13px Inter,system-ui,sans-serif; cursor:pointer; box-shadow:0 8px 24px rgba(0,0,0,.45); }
.bdtBtn[hidden], .bdtPop[hidden]{ display:none; }
.bdtPop{ position:fixed; z-index:100000; width:340px; max-width:calc(100vw - 20px); background:#1c1d21; color:rgba(255,255,255,.92); border:1px solid rgba(255,255,255,.16); border-radius:12px; box-shadow:0 18px 44px rgba(0,0,0,.55); font:13.5px/1.45 Inter,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif; padding:12px; }
.bdtPop .hd{ display:flex; align-items:center; font-weight:600; margin-bottom:8px; }
.bdtPop .hd small{ margin-left:8px; font-weight:400; opacity:.6; font-size:12px; }
.bdtPop .hd button{ margin-left:auto; background:transparent; border:0; color:inherit; opacity:.6; cursor:pointer; font-size:14px; }
.bdtPop label{ display:block; font-size:10.5px; text-transform:uppercase; letter-spacing:.05em; opacity:.6; margin:8px 0 4px; }
.bdtPop input[type=text]{ width:100%; box-sizing:border-box; height:32px; padding:0 10px; border-radius:9px; border:1px solid rgba(255,255,255,.18); background:rgba(0,0,0,.28); color:inherit; font:inherit; }
.bdtPop .cats{ display:flex; flex-wrap:wrap; gap:5px; }
.bdtPop .cats button{ display:inline-flex; align-items:center; gap:6px; height:26px; padding:0 9px; font:inherit; font-size:12px; color:inherit; background:rgba(255,255,255,.07); border:1px solid rgba(255,255,255,.12); border-radius:8px; cursor:pointer; }
.bdtPop .cats button i{ width:9px; height:9px; border-radius:50%; background:var(--cc); display:block; }
.bdtPop .cats button.on{ background:var(--cc); border-color:var(--cc); color:#111; font-weight:700; }
.bdtPop .cats button.on i{ background:#111; }
.bdtPop .acts{ display:flex; gap:6px; margin-top:10px; align-items:center; }
.bdtPop .acts button{ font:inherit; font-size:12.5px; color:inherit; background:rgba(255,255,255,.07); border:1px solid rgba(255,255,255,.12); border-radius:8px; height:28px; padding:0 11px; cursor:pointer; }
.bdtPop .acts .primary{ background:#ececf0; color:#111; border-color:#ececf0; font-weight:600; }
.bdtPop .acts label{ margin:0 0 0 auto; text-transform:none; letter-spacing:0; font-size:12px; opacity:.8; display:flex; gap:5px; align-items:center; cursor:pointer; }
.bdtPop .have{ display:flex; flex-wrap:wrap; gap:5px; }
.bdtPop .have span{ display:inline-flex; align-items:center; gap:3px; border:1px solid var(--cc); background:color-mix(in srgb, var(--cc) 16%, #1c1d21); border-radius:7px; padding:1px 3px 1px 7px; font-size:12px; }
.bdtPop .have button{ border:0; background:none; color:inherit; opacity:.65; cursor:pointer; padding:0 3px; }
.bdtPop .have button:hover{ opacity:1; }
.bdtPop .none{ opacity:.5; font-size:12px; }
${E.CATS.map((c) => `::highlight(bd-${c.id}){ background-color:${c.color}4d; color:inherit; text-decoration:underline 2px ${c.color}; text-underline-offset:3px; text-decoration-skip-ink:none; }`).join("\n")}
@media print{ ${E.CATS.map((c) => `::highlight(bd-${c.id}){ background-color:transparent; text-decoration:none; }`).join(" ")} }`;
const style = document.createElement("style"); style.textContent = css; document.head.appendChild(style);

/* ---------- where in the script are we? ---------- */
// The scene a line belongs to: the heading line's id (the same key the Breakdown tab uses), or "n1" before the first heading
function sceneKeyOf(lineEl){
  let el = lineEl;
  while(el){ if(el.classList && el.classList.contains("line") && el.dataset.type === "scene") return el.dataset.id || "n1"; el = el.previousElementSibling; }
  return "n1";
}
function lineOf(node){ const el = node && (node.nodeType === 1 ? node : node.parentElement); return el && el.closest ? el.closest(".line") : null; }
function sceneTitle(sk){
  const ed = editor(); if(!ed) return "";
  const el = ed.querySelector(`.line[data-id="${CSS.escape(sk)}"]`);
  return el ? String(el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 40) : "Before the first scene";
}
function readSelection(){
  const sel = window.getSelection(), ed = editor();
  if(!sel || !sel.rangeCount || !ed) return null;
  const r = sel.getRangeAt(0);
  if(!ed.contains(r.startContainer)) return null;
  const line = lineOf(r.startContainer); if(!line) return null;
  let text = r.collapsed ? "" : String(sel.toString()).replace(/\s+/g, " ").trim();
  // a selection across lines: tag the first line's part (a tag belongs to one place)
  if(!r.collapsed && lineOf(r.endContainer) !== line){
    const part = document.createRange(); part.setStart(r.startContainer, r.startOffset); part.setEnd(line, line.childNodes.length);
    text = String(part.toString()).replace(/\s+/g, " ").trim();
  }
  return { text: text.slice(0, 80), sk: sceneKeyOf(line), line: line };
}

/* ---------- the popover ---------- */
const btn = document.createElement("button"); btn.type = "button"; btn.className = "bdtBtn"; btn.hidden = true;
btn.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.6 13.4l-7.2 7.2a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z"/><circle cx="8" cy="8" r="1.5"/></svg>Tag`;
btn.title = "Tag for the breakdown (Ctrl/Cmd+Alt+B)";
const pop = document.createElement("div"); pop.className = "bdtPop"; pop.hidden = true;
document.body.appendChild(btn); document.body.appendChild(pop);
let cur = null, cat = lsGet(LAST_KEY) && E.CAT[lsGet(LAST_KEY)] ? lsGet(LAST_KEY) : "props";

function canTag(){ const ed = editor(); return !!ed && ed.isContentEditable && !document.body.classList.contains("notesMode"); }
function haveInScene(sk){
  const st = load(), out = [];
  (st.tags && st.tags[sk] || []).forEach((t) => {
    const k = E.resolve(st.alias || {}, E.key(t.c, t.n)), c = k.split("|")[0];
    if(E.CAT[c]) out.push({ k0: E.key(t.c, t.n), c: c, n: (st.names && st.names[k]) || t.n });
  });
  return out;
}
function drawPop(){
  const sk = cur.sk, have = haveInScene(sk);
  pop.style.setProperty("--ct", E.CAT[cat].color);
  pop.innerHTML = `<div class="hd">Tag for breakdown<small>${esc(sceneTitle(sk))}</small><button type="button" data-a="close" aria-label="Close">✕</button></div>
    <label for="bdtName">Element</label><input type="text" id="bdtName" maxlength="60" value="${esc(cur.name)}" placeholder="What is it? (e.g. Shotgun)" autocomplete="off">
    <label>Category</label><div class="cats">${E.CATS.map((c) => `<button type="button" data-c="${c.id}" class="${c.id === cat ? "on" : ""}" style="--cc:${c.color}"><i></i>${esc(c.short)}</button>`).join("")}</div>
    <div class="acts"><button type="button" class="primary" data-a="add">Add to scene</button><button type="button" data-a="close">Done</button>${canHighlight ? `<label><input type="checkbox" data-a="show"${showColours() ? " checked" : ""}> Show tags</label>` : ""}</div>
    <label>Tagged in this scene</label>${have.length ? `<div class="have">${have.map((h) => `<span style="--cc:${E.CAT[h.c].color}" title="${esc(E.CAT[h.c].label)}">${esc(h.n)}<button type="button" data-a="rm" data-k="${esc(h.k0)}" aria-label="Remove ${esc(h.n)}">✕</button></span>`).join("")}</div>` : `<div class="none">Nothing tagged by hand yet. The sheet also fills in suggestions on its own.</div>`}`;
}
function place(){
  const sel = window.getSelection();
  let r = null;
  if(sel && sel.rangeCount){ const rg = sel.getRangeAt(0); const rects = rg.getClientRects(); r = rects[rects.length - 1] || rg.getBoundingClientRect(); }
  const w = pop.offsetWidth || 340, h = pop.offsetHeight || 300, vw = window.innerWidth, vh = window.innerHeight;
  const seen = r && (r.width + r.height) > 0 && r.bottom > 0 && r.top < vh;   // the selection is on screen
  let x = seen ? r.left : vw / 2 - w / 2, y = seen ? r.bottom + 10 : 90;
  if(seen && y + h > vh - 10) y = r.top - h - 10;           // no room below: above it
  y = Math.min(y, vh - h - 10);                              // always fully on screen
  pop.style.left = Math.min(vw - w - 10, Math.max(10, x)) + "px"; pop.style.top = Math.max(10, y) + "px";
}
function open(){
  if(!canTag()){ say("This script is view-only, so it can't be tagged."); return; }
  const s = readSelection();
  if(!s){ say("Click in the script (or highlight some words) to tag them."); return; }
  const name = s.text.length > 60 ? s.text.slice(0, 60).replace(/\s+\S*$/, "") : s.text;
  cur = { sk: s.sk, quote: s.text, name: name };
  btn.hidden = true; pop.hidden = false; drawPop(); place();
  setTimeout(() => { const i = pop.querySelector("#bdtName"); if(i){ i.focus(); i.select(); } }, 10);
}
function close(){ pop.hidden = true; cur = null; }
function add(){
  const i = pop.querySelector("#bdtName"), name = i ? i.value.trim() : "";
  if(!name){ if(i) i.focus(); return; }
  save(E.tag(load(), cur.sk, cat, name, cur.quote));
  queue({ t: "tag", sk: cur.sk, c: cat, n: name, q: cur.quote || "" });
  lsSet(LAST_KEY, cat);
  if(!showColours()) lsSet(SHOW_KEY, "1");   // show what you just tagged
  say("Tagged " + name + " as " + E.CAT[cat].label.toLowerCase() + ".");
  cur.name = ""; cur.quote = ""; drawPop(); place(); paint();
  const j = pop.querySelector("#bdtName"); if(j) j.focus();
}
pop.addEventListener("mousedown", (e) => { if(!e.target.closest("input")) e.preventDefault(); });   // keep the script selection while clicking the card
pop.addEventListener("click", (e) => {
  const c = e.target.closest("[data-c]");
  if(c){ cat = c.dataset.c; lsSet(LAST_KEY, cat); drawPop(); const i = pop.querySelector("#bdtName"); if(i){ i.focus(); } return; }
  const a = e.target.closest("[data-a]"); if(!a) return;
  if(a.dataset.a === "close") close();
  else if(a.dataset.a === "add") add();
  else if(a.dataset.a === "rm"){ save(E.untag(load(), cur.sk, a.dataset.k)); queue({ t: "untag", sk: cur.sk, k: a.dataset.k }); drawPop(); paint(); }
});
pop.addEventListener("change", (e) => { if(e.target.dataset && e.target.dataset.a === "show") setShow(e.target.checked); });
pop.addEventListener("keydown", (e) => {
  e.stopPropagation();
  if(e.key === "Enter" && e.target.id === "bdtName"){ e.preventDefault(); add(); }
  else if(e.key === "Escape"){ e.preventDefault(); close(); const ed = editor(); if(ed) ed.focus(); }
});
document.addEventListener("mousedown", (e) => { if(!pop.hidden && !pop.contains(e.target) && !btn.contains(e.target)) close(); }, true);

/* ---------- the floating Tag button next to a selection ---------- */
function maybeShowBtn(){
  if(!pop.hidden || !canTag()) { btn.hidden = true; return; }
  const sel = window.getSelection(), ed = editor();
  if(!sel || !sel.rangeCount || sel.isCollapsed || !ed || !ed.contains(sel.getRangeAt(0).commonAncestorContainer) || !String(sel).trim()){ btn.hidden = true; return; }
  const rects = sel.getRangeAt(0).getClientRects(), last = rects[rects.length - 1] || sel.getRangeAt(0).getBoundingClientRect();
  btn.hidden = false;
  const w = btn.offsetWidth;
  // sits beside the Comment button (which is centred on the end of the selection)
  btn.style.left = Math.min(window.innerWidth - w - 10, Math.max(10, last.right + 60)) + "px";
  btn.style.top = Math.max(64, last.top - 40) + "px";
}
btn.addEventListener("mousedown", (e) => e.preventDefault());
btn.addEventListener("click", open);
document.addEventListener("selectionchange", () => { const s = window.getSelection(); if(!s || s.isCollapsed) btn.hidden = true; });
document.addEventListener("mouseup", (e) => { if(editor() && editor().contains(e.target)) setTimeout(maybeShowBtn, 0); });
document.addEventListener("keyup", (e) => { const ed = editor(); if(ed && ed.contains(e.target)){ if(e.shiftKey || e.key.indexOf("Arrow") === 0) setTimeout(maybeShowBtn, 0); else btn.hidden = true; } });
window.addEventListener("scroll", () => { btn.hidden = true; if(!pop.hidden) place(); }, { passive: true });
document.addEventListener("keydown", (e) => {
  if((e.ctrlKey || e.metaKey) && e.altKey && (e.code === "KeyB" || e.key.toLowerCase() === "b")){ e.preventDefault(); e.stopPropagation(); open(); }
}, true);
const menuItem = document.getElementById("mTagBreakdown");
if(menuItem) menuItem.addEventListener("click", () => { setTimeout(open, 30); });

/* ---------- colour the tagged words in the script ---------- */
const WORD = /[A-Za-z0-9]/;
function occurrences(hay, needle){
  const out = []; if(!needle) return out;
  const h = hay.toLowerCase(), n = needle.toLowerCase();
  let i = 0;
  while((i = h.indexOf(n, i)) >= 0){
    const a = i, b = i + n.length;
    // whole words only: "cat" isn't in "locate"
    if((!WORD.test(hay.charAt(a - 1) || " ") || !WORD.test(n.charAt(0))) && (!WORD.test(hay.charAt(b) || " ") || !WORD.test(n.charAt(n.length - 1)))) out.push([a, b]);
    i = b;
  }
  return out;
}
function rangeIn(nodes, a, b){
  let sn = null, so = 0, en = null, eo = 0;
  for(let i = 0; i < nodes.length; i++){
    const n = nodes[i], len = n.node.nodeValue.length;
    if(!sn && a < n.start + len){ sn = n.node; so = a - n.start; }
    if(b <= n.start + len){ en = n.node; eo = b - n.start; break; }
  }
  if(!sn || !en) return null;
  const r = document.createRange(); try{ r.setStart(sn, Math.max(0, so)); r.setEnd(en, Math.max(0, eo)); }catch(_e){ return null; }
  return r;
}
/* ---------- show every active tag (View > Show Breakdown Tags) ----------
   The script is read the same way the Breakdown tab reads it (breakdown.js + elements.js), so what's coloured
   here is exactly what's on the sheets: suggestions (light fill) and hand tags (strong fill), less anything
   taken out or ignored. Click a category in the key to hide it. */
const SUG_KEY = "Camp_BD_SHOWSUG_V1", HIDE_KEY = "Camp_BD_HIDECAT_V1";
const showSug = () => lsGet(SUG_KEY) !== "0";
const hiddenCats = () => { try{ const v = JSON.parse(lsGet(HIDE_KEY) || "[]"); return Array.isArray(v) ? v : []; }catch(_e){ return []; } };
const B = window.CampBreakdown;
const key = document.createElement("div"); key.className = "bdtKey"; key.hidden = true; document.body.appendChild(key);
style.textContent += `
.bdtKey{ position:fixed; right:14px; bottom:14px; z-index:9990; width:260px; max-width:calc(100vw - 28px); max-height:46vh; overflow:auto; background:#1c1d21; color:rgba(255,255,255,.92); border:1px solid rgba(255,255,255,.16); border-radius:12px; box-shadow:0 14px 36px rgba(0,0,0,.5); font:12.5px/1.4 Inter,system-ui,sans-serif; padding:10px; }
.bdtKey[hidden]{ display:none; }
.bdtKey.inPanel{ position:static; width:auto; max-width:none; max-height:none; overflow:visible; background:transparent; border:0; border-radius:0; box-shadow:none; padding:0; color:inherit; }
.bdtKey.inPanel .bdtHd{ display:none; }
.bdtKey .bdtSc{ margin-top:10px; padding-top:8px; border-top:1px solid rgba(255,255,255,.12); }
.bdtKey .bdtScH{ font-size:11px; opacity:.6; margin-bottom:5px; }
.bdtKey .bdtRow{ display:flex; align-items:center; gap:6px; padding:2px 0; font-size:12px; }
.bdtKey .bdtRow i{ width:8px; height:8px; border-radius:50%; background:var(--cc); flex:none; }
.bdtKey .bdtRow .nm{ flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.bdtKey .bdtRow small{ opacity:.55; font-size:10.5px; }
.bdtKey .bdtRow button{ background:none; border:0; color:inherit; opacity:.55; cursor:pointer; font-size:13px; padding:0 3px; }
.bdtKey .bdtRow button:hover{ opacity:1; }
.bdtKey .bdtGrp{ margin:2px 0; }
.bdtKey .bdtGrp summary{ display:flex; align-items:center; gap:6px; cursor:pointer; font-size:12px; padding:3px 0; list-style:none; }
.bdtKey .bdtGrp summary::-webkit-details-marker{ display:none; }
.bdtKey .bdtGrp summary::before{ content:"▸"; opacity:.6; font-size:10px; width:8px; }
.bdtKey .bdtGrp[open] summary::before{ content:"▾"; }
.bdtKey .bdtGrp summary i{ width:8px; height:8px; border-radius:50%; background:var(--cc); }
.bdtKey .bdtGrp summary small{ margin-left:auto; opacity:.6; }
.bdtKey .bdtGrp .bdtRow{ padding-left:20px; }
.bdtKey .bdtHd{ display:flex; align-items:center; gap:6px; font-weight:600; margin-bottom:6px; }
.bdtKey .bdtHd button{ margin-left:auto; background:none; border:0; color:inherit; opacity:.6; cursor:pointer; font-size:13px; }
.bdtKey label{ display:flex; gap:6px; align-items:center; font-size:12px; opacity:.85; margin-bottom:6px; cursor:pointer; }
.bdtKey .bdtCs{ display:flex; flex-wrap:wrap; gap:4px; }
.bdtKey .bdtCs button{ display:inline-flex; align-items:center; gap:5px; border:1px solid rgba(255,255,255,.14); background:rgba(255,255,255,.06); color:inherit; border-radius:7px; padding:1px 7px; font:inherit; font-size:11.5px; cursor:pointer; }
.bdtKey .bdtCs button i{ width:8px; height:8px; border-radius:50%; background:var(--cc); display:block; }
.bdtKey .bdtCs button small{ opacity:.6; }
.bdtKey .bdtCs button.off{ opacity:.4; text-decoration:line-through; }
.bdtKey .bdtNote{ display:block; width:auto; font-size:11px; opacity:.55; margin-top:6px; font-style:normal; }
${E.CATS.map((c) => `::highlight(bds-${c.id}){ background-color:${c.color}2e; text-decoration:underline 1px dashed ${c.color}; text-underline-offset:3px; }`).join("\n")}
@media print{ .bdtKey{ display:none !important; } ${E.CATS.map((c) => `::highlight(bds-${c.id}){ background-color:transparent; text-decoration:none; }`).join(" ")} }
/* While tags are showing, comments step back to a coloured underline so the two don't look alike */
body.bdTagsOn #scriptEditor .cmt[data-color]{ background:transparent !important; box-shadow:inset 0 -2px 0 0 var(--cmtLine, #e0ad2b) !important; }
body.bdTagsOn #scriptEditor .cmt[data-color="pink"]{ --cmtLine:#ff5f95; } body.bdTagsOn #scriptEditor .cmt[data-color="blue"]{ --cmtLine:#4d8fff; }
body.bdTagsOn #scriptEditor .cmt[data-color="green"]{ --cmtLine:#35b86b; } body.bdTagsOn #scriptEditor .cmt[data-color="purple"]{ --cmtLine:#9a6cff; }
body.bdTagsOn #scriptEditor .cmt[data-color="custom"]{ --cmtLine:var(--cmt-hex, #e0ad2b); }
@media print{ body.bdTagsOn #scriptEditor .cmt[data-color]{ box-shadow:none !important; } }`;

// The script as the Breakdown reads it, straight from the page (so unsaved typing is included)
function docFromPage(){
  const ed = editor(); if(!ed) return { lines: [] };
  const t = (el) => el ? [{ t: el.textContent || "" }] : [];
  const lines = Array.from(ed.querySelectorAll(".line")).map((l) => {
    const type = l.dataset.type || "action";
    if(type === "dual"){
      const f = (p) => l.querySelector(`.dualField[data-part="${p}"]`);
      return { id: l.dataset.id || "", type, dual: { left: { characterRuns: t(f("L_CHAR")), dialogueRuns: t(f("L_DLG")) }, right: { characterRuns: t(f("R_CHAR")), dialogueRuns: t(f("R_DLG")) } } };
    }
    return { id: l.dataset.id || "", type, runs: t(l) };
  });
  return { lines };
}
let paintT = 0, lastKeyHtml = "";
function paint(){
  clearTimeout(paintT);
  syncMenu();
  paintT = setTimeout(doPaint, showColours() ? 500 : 30);
}
function clearAll(){ if(canHighlight) E.CATS.forEach((c) => { CSS.highlights.delete("bd-" + c.id); CSS.highlights.delete("bds-" + c.id); }); }
function doPaint(){
  try{
    clearAll();
    const ed = editor();
    document.body.classList.toggle("bdTagsOn", !!(ed && showColours()));
    if(!ed || !showColours()){ key.hidden = true; const f = document.getElementById("bdtField"); if(f) f.hidden = true; return; }
    const doc = docFromPage(), bd = B ? B.analyze(doc) : { scenes: [], cast: [] }, m = E.build(doc, bd, load());
    const hide = {}; hiddenCats().forEach((c) => { hide[c] = 1; });
    const sug = showSug();
    // lines grouped by scene key, in script order (the same keys the model uses)
    const bySc = {}; let sk = "n1";
    ed.querySelectorAll(".line").forEach((l) => { if(l.dataset.type === "scene") sk = l.dataset.id || "n1"; (bySc[sk] = bySc[sk] || []).push(l); });
    const hand = {}, auto = {}, count = {};
    m.scenes.forEach((s) => {
      const lines = bySc[s.key]; if(!lines) return;
      let idx = null;
      const index = () => idx || (idx = lines.map((l) => {
        const nodes = []; let acc = ""; const w = document.createTreeWalker(l, NodeFilter.SHOW_TEXT);
        while(w.nextNode()){ nodes.push({ node: w.currentNode, start: acc.length }); acc += w.currentNode.nodeValue; }
        return { nodes: nodes, text: acc };
      }));
      Object.keys(s.els).forEach((c) => s.els[c].forEach((k) => {
        count[c] = (count[c] || 0) + 1;
        if(hide[c] || !canHighlight) return;
        const how = s.src[k] === "auto" ? "auto" : "hand";
        const into = hand;   // what's found is already a tag: take a few out rather than confirming each one
        (s.hits[k] || []).forEach((q) => index().forEach((ix) => occurrences(ix.text, q).forEach((mm) => {
          const r = rangeIn(ix.nodes, mm[0], mm[1]); if(r) (into[c] = into[c] || []).push(r);
        })));
      }));
    });
    if(canHighlight){
      Object.keys(hand).forEach((c) => CSS.highlights.set("bd-" + c, new Highlight(...hand[c])));
      Object.keys(auto).forEach((c) => CSS.highlights.set("bds-" + c, new Highlight(...auto[c])));
    }
    lastModel = m; lastCount = count; lastHide = hide; lastSugOn = sug;
    renderKey();
  }catch(_e){ try{ console.error(_e); }catch(_x){} }
}

// The key (and this scene's tags) live in the right-hand panel under Font; they float over the page when that panel is closed
let lastModel = null, lastCount = {}, lastHide = {}, lastSugOn = true, curScene = "n1";
const OPEN_KEY = "Camp_BD_OPENCATS_V1";
const openCats = () => { try{ const v = JSON.parse(lsGet(OPEN_KEY) || "[]"); return Array.isArray(v) ? v : []; }catch(_e){ return []; } };
function sceneRows(m, sk){
  const sc = m && m.scenes.find((x) => x.key === sk); if(!sc) return "";
  const open = openCats(), groups = [];
  E.CATS.forEach((c) => {
    const list = sc.els[c.id] || []; if(!list.length) return;
    const rows = list.map((k) => `<div class="bdtRow" style="--cc:${c.color}"><i></i><span class="nm">${esc(m.elements[k].name)}</span><button type="button" data-k="rm" data-e="${esc(k)}" title="Take out of this scene">✕</button></div>`).join("");
    groups.push(`<details class="bdtGrp" data-g="${c.id}" style="--cc:${c.color}"${open.indexOf(c.id) >= 0 ? " open" : ""}><summary><i></i>${esc(c.label)}<small>${list.length}</small></summary>${rows}</details>`);
  });
  return `<div class="bdtSc"><div class="bdtScH">This scene · ${esc(sceneTitle(sk))}</div>${groups.join("") || `<div class="bdtNote">Nothing found yet.</div>`}</div>`;
}
function renderKey(){
  const field = document.getElementById("bdtField");
  if(!lastModel || !showColours()){ key.hidden = true; if(field) field.hidden = true; return; }
  const m = lastModel, count = lastCount, hide = lastHide, sug = lastSugOn;
  const r = readSelection(); if(r) curScene = r.sk;
  if(!m.scenes.some((x) => x.key === curScene) && m.scenes.length) curScene = m.scenes[0].key;   // nothing clicked yet: the first scene
  const html = `<div class="bdtHd">Breakdown tags<button type="button" data-k="off" title="Hide tags (View › Show Breakdown Tags)">✕</button></div>
      <div class="bdtCs">${E.CATS.filter((c) => count[c.id]).map((c) => `<button type="button" data-c="${c.id}" class="${hide[c.id] ? "off" : ""}" style="--cc:${c.color}" title="${hide[c.id] ? "Show" : "Hide"} ${esc(c.label.toLowerCase())}"><i></i>${esc(c.short)}<small>${count[c.id]}</small></button>`).join("") || `<span class="bdtNote">Nothing found yet.</span>`}</div>
      ${canHighlight ? `<div class="bdtNote">Everything found in the script is tagged. Open a category below to take things out, or select words and press Tag to add. Comments show as underlines while tags are on.</div>` : `<div class="bdtNote">This browser can't colour text. Update it to see tags in the script.</div>`}${sceneRows(m, curScene)}`;
  const host = document.getElementById("bdtPanel"), side = host && host.closest("#panel");
  const docked = !!(host && side && side.offsetParent !== null);
  if(docked){ if(key.parentNode !== host) host.appendChild(key); field.hidden = false; }
  else { if(key.parentNode !== document.body) document.body.appendChild(key); if(field) field.hidden = true; }
  key.classList.toggle("inPanel", docked);
  if(html !== lastKeyHtml){ key.innerHTML = html; lastKeyHtml = html; }
  key.hidden = false;
}
key.addEventListener("mousedown", (e) => { if(!e.target.closest("input")) e.preventDefault(); });
key.addEventListener("click", (e) => {
  const c = e.target.closest("[data-c]");
  if(c){ const h = hiddenCats(), i = h.indexOf(c.dataset.c); if(i >= 0) h.splice(i, 1); else h.push(c.dataset.c); lsSet(HIDE_KEY, JSON.stringify(h)); lastKeyHtml = ""; paint(); return; }
  const k = e.target.closest("[data-k=off]"); if(k){ setShow(false); return; }
  const act = e.target.closest("[data-k=rm]"); if(!act || !lastModel) return;
  const sc = lastModel.scenes.find((x) => x.key === curScene), ek = act.dataset.e, el = lastModel.elements[ek]; if(!sc || !el) return;
  if(act.dataset.k === "rm"){ save(E.untag(load(), curScene, ek)); queue({ t: "untag", sk: curScene, k: ek }); say("Took " + el.name + " out of this scene."); }
  lastKeyHtml = ""; paint();
});
key.addEventListener("toggle", (e) => { const d = e.target; if(!d || !d.classList || !d.classList.contains("bdtGrp")) return; const h = openCats(), i = h.indexOf(d.dataset.g); if(d.open && i < 0) h.push(d.dataset.g); else if(!d.open && i >= 0) h.splice(i, 1); lsSet(OPEN_KEY, JSON.stringify(h)); lastKeyHtml = ""; }, true);
key.addEventListener("change", (e) => { if(e.target.dataset.k === "sug"){ lsSet(SUG_KEY, e.target.checked ? "1" : "0"); lastKeyHtml = ""; paint(); } });
document.addEventListener("selectionchange", () => { if(showColours() && lastModel) renderKey(); });
function setShow(on){ lsSet(SHOW_KEY, on ? "1" : "0"); lastKeyHtml = ""; paint(); }
// View › Show Breakdown Tags
const viewItem = document.getElementById("mToggleTags");
function syncMenu(){
  if(!viewItem) return;
  const on = showColours(); viewItem.setAttribute("aria-checked", on ? "true" : "false");
  const t = viewItem.querySelector(".tick"); if(t) t.textContent = on ? "✓" : "";
}
if(viewItem) viewItem.addEventListener("click", () => setShow(!showColours()));
document.addEventListener("keydown", (e) => {
  if((e.ctrlKey || e.metaKey) && e.altKey && (e.code === "KeyT" || e.key.toLowerCase() === "t")){ e.preventDefault(); e.stopPropagation(); setShow(!showColours()); }
}, true);

// Redraw when the script loads or changes, and when tags change in another tab
function watch(){
  const ed = editor(); if(!ed){ setTimeout(watch, 400); return; }
  try{ new MutationObserver(() => { if(showColours()) paint(); }).observe(ed, { childList: true, subtree: true, characterData: true }); }catch(_e){}
  paint();
}
window.addEventListener("storage", (e) => { if(e.key === STORE_KEY || e.key === SHOW_KEY || e.key === SUG_KEY || e.key === HIDE_KEY){ lastKeyHtml = ""; paint(); } });
if(document.readyState === "loading") document.addEventListener("DOMContentLoaded", watch); else watch();

window.CampBdTag = { open: open, paint: paint, store: load, show: setShow };
})();
