/* docscards.js — Docs on phones: a project's Google Sheet shown as readable cards instead of a zoomed-in grid.
   Read only. The values come from the main script's "sheetview" (one tab at a time, as the Sheet shows them).
   The layout logic (layout) is pure, so the tests run it in node; the drawing part only runs in the browser.

   How a tab becomes cards:
   - the header row is the busiest bold/shaded row near the top (NAME, ROLE, PHONE…); rows above it are the title
   - a row with a single value is a section heading (CREW, PRODUCTION…); two headings in a row = a group and its sub-group
   - every other row is a card: a short code (scene 12A, account 2300, shot 3B) becomes a badge beside the next value,
     the rest are "label: value" pairs using the header; empty cells are left out, so a card only shows what's filled in */
(function (root) {
"use strict";

const clean = (v) => String(v == null ? "" : v).replace(/\s+/g, " ").trim();
const HIDE_COL = /^(scripty key|_)/i;
const isCode = (v) => v.length <= 6 && /^[A-Za-z]{0,2}\d{1,4}[A-Za-z]{0,2}$|^\d+(\.\d+)?$/.test(v);

function kindOf(v){
  if(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return "email";
  if(/^https?:\/\/\S+$/i.test(v)) return "url";
  if(/^\+?[\d][\d\s().-]{6,}$/.test(v) && (v.match(/\d/g) || []).length >= 8) return "phone";
  return "text";
}
function headerRowOf(rows, fmt){
  let best = -1, bestN = 1;
  const lim = Math.min(rows.length, 14);
  for(let r = 0; r < lim; r++){
    const cells = rows[r].map(clean).filter(Boolean);
    if(cells.length < 2 || cells.some((c) => c.length > 32)) continue;
    const f = (fmt && fmt[r]) || {};
    const styled = !!(f.b || f.h);
    const score = cells.length + (styled ? 0.5 : 0);
    if(score > bestN + (best < 0 ? 0 : 0.01)){ best = r; bestN = score; }
  }
  return best;
}

// rows: [[cell, …], …] as shown in the Sheet; fmt (optional): [{ b: bold?, h: shade colour or "" }, …] per row
function layout(rows, fmt){
  rows = (Array.isArray(rows) ? rows : []).map((r) => (Array.isArray(r) ? r : []).map(clean));
  const h = headerRowOf(rows, fmt);
  const header = h >= 0 ? rows[h] : [];
  const hidden = header.map((x) => HIDE_COL.test(x));
  const title = [];
  for(let r = 0; r < (h >= 0 ? h : 0); r++){ const t = rows[r].filter(Boolean).join(" · "); if(t) title.push(t); }
  const body = rows.slice(h >= 0 ? h + 1 : 0).map((r) => r.map((v, i) => (hidden[i] ? "" : v)));
  const items = [];
  const filled = (r) => r.map((v, i) => ({ i, v })).filter((c) => c.v);
  const nonEmpty = body.filter((r) => filled(r).length);
  // A heading: one value in the first columns, shown bold or shaded (without formatting info: first column or in capitals).
  // A lone value that isn't styled (an unfilled crew slot: just its role) stays a card.
  const fmtOf = (r) => (fmt && fmt[body.indexOf(r) + (h >= 0 ? h + 1 : 0)]) || null;
  const isSection = (r) => {
    const c = filled(r); if(c.length !== 1 || c[0].i > 1) return false;
    const f = fmtOf(r);
    return f ? !!(f.b || f.h) : (c[0].i === 0 || (/[A-Z]/.test(c[0].v) && c[0].v === c[0].v.toUpperCase()));
  };
  nonEmpty.forEach((r, k) => {
    const cells = filled(r);
    if(isSection(r)){
      const next = nonEmpty[k + 1], nextIsSection = !!next && isSection(next);
      items.push({ type: "section", text: cells[0].v, level: nextIsSection ? 1 : 2 });
      return;
    }
    let badge = "", head = cells[0], rest = cells.slice(1);
    if(isCode(head.v) && rest.length){ badge = head.v; head = rest[0]; rest = rest.slice(1); }
    const total = /\btotal\b/i.test(head.v) || /\btotal\b/i.test(badge);
    const missing = !r[0] && header[0] && !hidden[0] && cells[0].i > 0 ? header[0] : "";
    items.push({
      type: "card", badge, title: head.v, total, missing,
      fields: rest.map((c) => ({ label: header[c.i] || "", value: c.v, kind: kindOf(c.v), long: c.v.length > 48 }))
    });
  });
  return { title, header: header.filter((x, i) => x && !hidden[i]), items };
}
function matches(item, q){
  if(!q) return true;
  q = q.toLowerCase();
  if(item.type === "section") return false;
  return [item.badge, item.title].concat(item.fields.map((f) => f.value)).some((v) => String(v || "").toLowerCase().indexOf(q) >= 0);
}
const telHref = (v) => "tel:" + v.replace(/[^\d+]/g, "");

const api = { layout, matches, kindOf, isCode, telHref };
if(typeof module !== "undefined" && module.exports){ module.exports = api; return; }

/* ---------------- browser ---------------- */
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const STALE_MS = 5 * 60 * 1000, MAX_CARDS = 300;
const S = { cache: {}, cur: null, q: "", more: 0 };   // cache: sheetId|tab -> { at, d, state, err }

const css = `
#docCards{ display:none; padding:0 10px 90px; }
#prodPane.cards #docCards{ display:block; }
#prodPane.cards #frames, #prodPane.cards #banner{ display:none !important; }
.dcTop{ padding:10px 0 8px; display:flex; flex-direction:column; gap:8px; }
.dcTabs{ display:flex; gap:6px; overflow-x:auto; scrollbar-width:none; -webkit-overflow-scrolling:touch; }
.dcTabs::-webkit-scrollbar{ display:none; }
.dcTabs button{ flex:0 0 auto; height:36px; padding:0 14px; border-radius:999px; border:1px solid var(--uiBorder, #333); background:rgba(255,255,255,.04); color:var(--uiText, #eee); font:600 13px Inter, system-ui, sans-serif; cursor:pointer; }
.dcTabs button.on{ background:#ececf0; color:#111; border-color:#ececf0; }
.dcFind{ display:flex; gap:8px; }
.dcFind input{ flex:1; min-width:0; height:40px; border-radius:10px; border:1px solid var(--uiBorder, #333); background:rgba(0,0,0,.25); color:var(--uiText, #eee); padding:0 12px; font-size:16px; }
.dcFind button{ flex:0 0 auto; width:40px; height:40px; border-radius:10px; border:1px solid var(--uiBorder, #333); background:rgba(255,255,255,.05); color:var(--uiText, #eee); cursor:pointer; display:inline-flex; align-items:center; justify-content:center; }
.dcFind button svg{ width:17px; height:17px; }
.dcTitle{ margin:6px 2px 10px; }
.dcTitle b{ display:block; font-size:17px; }
.dcTitle span{ display:block; color:var(--uiMuted, #999); font-size:12.5px; margin-top:3px; line-height:1.4; }
.dcSec{ margin:18px 2px 8px; font:800 12px Inter, system-ui, sans-serif; letter-spacing:.08em; text-transform:uppercase; color:var(--uiText, #eee); }
.dcSec.l2{ margin-top:12px; font-weight:700; color:var(--uiMuted, #999); }
.dcCard{ border:1px solid var(--uiBorder, #333); border-radius:12px; background:#1f1f1f; padding:11px 13px; margin-bottom:8px; }
.dcCard.total{ background:#262a33; border-color:#3b4a63; }
.dcHead{ display:flex; align-items:baseline; gap:8px; }
.dcBadge{ flex:0 0 auto; font:700 12px Inter, system-ui, sans-serif; padding:2px 7px; border-radius:6px; background:rgba(255,255,255,.1); color:var(--uiText, #eee); font-variant-numeric:tabular-nums; }
.dcName{ font-weight:700; font-size:15px; line-height:1.3; overflow-wrap:anywhere; }
.dcMiss{ margin-top:2px; font-size:12px; color:var(--uiMuted, #999); font-style:italic; }
.dcF{ display:grid; grid-template-columns:repeat(2, minmax(0,1fr)); gap:8px 12px; margin-top:9px; }
.dcF div{ min-width:0; }
.dcF div.w{ grid-column:1 / -1; }
.dcF small{ display:block; font-size:10.5px; letter-spacing:.05em; text-transform:uppercase; color:var(--uiMuted, #999); margin-bottom:1px; }
.dcF span, .dcF a{ display:block; font-size:14px; line-height:1.4; overflow-wrap:anywhere; color:var(--uiText, #eee); }
.dcF a{ color:#8fb4ff; text-decoration:none; }
.dcMsg{ padding:40px 16px; text-align:center; color:var(--uiMuted, #999); display:flex; flex-direction:column; align-items:center; gap:12px; font-size:13.5px; }
.dcMsg b{ color:var(--uiText, #eee); font-size:15px; }
.dcMsg .row{ display:flex; gap:8px; flex-wrap:wrap; justify-content:center; }
.dcMore{ display:block; width:100%; height:44px; margin-top:6px; border-radius:10px; border:1px solid var(--uiBorder, #333); background:rgba(255,255,255,.05); color:var(--uiText, #eee); font:600 14px Inter, system-ui, sans-serif; }
`;
let styled = false;
function style(){ if(styled) return; styled = true; const s = document.createElement("style"); s.textContent = css; document.head.appendChild(s); }

const ICON_REFRESH = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/></svg>`;

function fieldHtml(f){
  const lab = f.label ? `<small>${esc(f.label)}</small>` : "";
  const val = f.kind === "email" ? `<a href="mailto:${esc(f.value)}">${esc(f.value)}</a>`
    : f.kind === "phone" ? `<a href="${esc(telHref(f.value))}">${esc(f.value)}</a>`
    : f.kind === "url" ? `<a href="${esc(f.value)}" target="_blank" rel="noopener">${esc(f.value.replace(/^https?:\/\//i, "").slice(0, 60))}</a>`
    : `<span>${esc(f.value)}</span>`;
  return `<div class="${f.long ? "w" : ""}">${lab}${val}</div>`;
}
function cardHtml(it){
  if(it.type === "section") return `<div class="dcSec${it.level === 2 ? " l2" : ""}">${esc(it.title || it.text)}</div>`;
  return `<div class="dcCard${it.total ? " total" : ""}"><div class="dcHead">${it.badge ? `<span class="dcBadge">${esc(it.badge)}</span>` : ""}<span class="dcName">${esc(it.title)}</span></div>`
    + (it.missing ? `<div class="dcMiss">No ${esc(it.missing.toLowerCase())} yet</div>` : "")
    + (it.fields.length ? `<div class="dcF">${it.fields.map(fieldHtml).join("")}</div>` : "") + `</div>`;
}

function show(host, o){
  style();
  const key = o.sheet.id + "|" + (o.tab || "");
  const changed = !S.cur || S.cur.sheet.id !== o.sheet.id;
  S.cur = Object.assign({}, o, { tab: o.tab || (S.cur && !changed ? S.cur.tab : "") });
  if(changed){ S.q = ""; S.more = 0; }
  draw(host);
  const c = S.cache[o.sheet.id + "|" + S.cur.tab];
  if(!c || (c.state !== "loading" && Date.now() - c.at > STALE_MS)) load(host, S.cur.tab);
  void key;
}
async function load(host, tab, force){
  const o = S.cur, k = o.sheet.id + "|" + (tab || "");
  const old = S.cache[k];
  if(old && old.state === "loading" && !force) return;
  S.cache[k] = { state: "loading", d: old && old.d, at: old ? old.at : 0 };
  draw(host);
  try{
    const res = await o.ripGet({ action: "sheetview", pid: o.pid, sheetId: o.sheet.id, tab: tab || "" });
    if(!res || res.ok === false){
      const e = new Error((res && res.error) || "Couldn't read the Sheet.");
      e.reason = res && (res.reason || (/unknown action/i.test(res.error || "") ? "old" : ""));
      throw e;
    }
    const d = { name: res.name || o.sheet.name, tabs: res.tabs || [], tab: res.tab || "", rows: res.rows || [], fmt: res.fmt || [] };
    S.cache[k] = { state: "ok", d, at: Date.now() };
    if(!tab && d.tab){ S.cache[o.sheet.id + "|" + d.tab] = S.cache[k]; if(S.cur === o) S.cur.tab = d.tab; }
  }catch(err){
    S.cache[k] = { state: "error", err: (err && err.message) || String(err), reason: err && err.reason, d: old && old.d, at: Date.now() };
  }
  if(S.cur === o && host.isConnected) draw(host);
}
function draw(host){
  const o = S.cur; if(!o) return;
  const c = S.cache[o.sheet.id + "|" + (o.tab || "")] || { state: "loading" };
  const d = c.d;
  if(!d && c.state === "error"){
    const old = c.reason === "old";
    host.innerHTML = `<div class="dcMsg"><b>${old ? "Cards need the updated main script" : "Couldn't show this Sheet as cards"}</b><span>${esc(old ? "Paste the new Code.gs and deploy a New version. Until then, the grid works as before." : c.err)}</span>
      <div class="row"><button class="btn sm" type="button" data-dc="grid">Show the grid</button><button class="btn sm" type="button" data-dc="retry">Try again</button></div></div>`;
    wire(host); return;
  }
  if(!d){ host.innerHTML = `<div class="dcMsg"><span class="spin"></span><span>Reading ${esc(o.sheet.name || "the Sheet")}…</span></div>`; return; }
  const L = layout(d.rows, d.fmt);
  const items = L.items.filter((it) => !S.q || matches(it, S.q));
  const lim = MAX_CARDS + S.more;
  const shown = items.slice(0, lim);
  const tabs = d.tabs.length > 1 ? `<div class="dcTabs" role="tablist">${d.tabs.map((t) => `<button type="button" role="tab" data-dct="${esc(t)}" class="${t === d.tab ? "on" : ""}" aria-selected="${t === d.tab}">${esc(t)}</button>`).join("")}</div>` : "";
  const keepFocus = document.activeElement && document.activeElement.id === "dcQ";
  const selStart = keepFocus ? document.activeElement.selectionStart : 0;
  host.innerHTML = `<div class="dcTop">${tabs}<div class="dcFind"><input type="search" id="dcQ" placeholder="Find in ${esc(d.tab || "this tab")}" value="${esc(S.q)}" autocomplete="off" aria-label="Find">
      <button type="button" data-dc="refresh" aria-label="Refresh" title="Read the Sheet again">${c.state === "loading" ? `<span class="spin"></span>` : ICON_REFRESH}</button></div></div>
    ${L.title.length && !S.q ? `<div class="dcTitle"><b>${esc(L.title[0])}</b>${L.title.slice(1, 3).map((t) => `<span>${esc(t)}</span>`).join("")}</div>` : ""}
    ${shown.length ? shown.map(cardHtml).join("") : `<div class="dcMsg"><span>${S.q ? "Nothing matches." : "This tab is empty."}</span></div>`}
    ${items.length > lim ? `<button type="button" class="dcMore" data-dc="more">Show more (${items.length - lim} left)</button>` : ""}`;
  if(keepFocus){ const q = host.querySelector("#dcQ"); if(q){ q.focus({ preventScroll: true }); try{ q.setSelectionRange(selStart, selStart); }catch(_e){} } }
  wire(host);
}
function wire(host){
  if(host._dcWired) return; host._dcWired = true;
  host.addEventListener("click", (e) => {
    const t = e.target.closest("[data-dct]");
    if(t){ S.cur.tab = t.dataset.dct; S.q = ""; S.more = 0; const c = S.cache[S.cur.sheet.id + "|" + S.cur.tab]; draw(host); if(!c || Date.now() - c.at > STALE_MS) load(host, S.cur.tab); window.scrollTo && host.scrollIntoView && host.scrollIntoView({ block: "start" }); return; }
    const b = e.target.closest("[data-dc]"); if(!b) return;
    const a = b.dataset.dc;
    if(a === "refresh" || a === "retry") load(host, S.cur.tab, true);
    else if(a === "more"){ S.more += MAX_CARDS; draw(host); }
    else if(a === "grid" && S.cur.onGrid) S.cur.onGrid();
  });
  let qt = 0;
  host.addEventListener("input", (e) => { if(e.target.id !== "dcQ") return; S.q = e.target.value; S.more = 0; clearTimeout(qt); qt = setTimeout(() => draw(host), 150); });
}
function clear(sheetId){ Object.keys(S.cache).forEach((k) => { if(!sheetId || k.indexOf(sheetId + "|") === 0) delete S.cache[k]; }); }

root.CampDocCards = Object.assign({ show, clear }, api);
})(typeof window !== "undefined" ? window : this);
