/* docscards.js — Docs on phones: a project's Google Sheet shown as readable cards instead of a zoomed-in grid.
   Read only. The values come from the main script's "sheetview" (one tab at a time, as the Sheet shows them).
   The layout logic (layout) is pure, so the tests run it in node; the drawing part only runs in the browser.

   Every doc (Budget, Schedule, Shot List, Crew & Contacts, shortlists…) uses the same card, driven by the column titles:
   - header row: the busiest bold/shaded row near the top; rows above it are the title block
   - a styled row with one value is a section heading (CREW, PRODUCTION…); two in a row = a group and its sub-group
   - a styled row with just a code, a name and a figure (2300 ART DEPARTMENT $4,200) is a group heading with its subtotal
   - each other row is a card:
       badges  the codes (#, NO., SC., ACCT, SHOT, STRIP)
       title   the name-like column (NAME, CHARACTER, ROLE, ITEM, SET…); an empty NAME shows the role and "No name yet"
       figure  the number that matters, on the right (TOTAL, then PAGES)
       chips   short tags (I/E, D/N, STATUS, TYPE, SIZE, ANGLE, LENS…)
       rows    everything else as label / value
       notes   long text (DESCRIPTION, NOTES, ONE-LINER, WHY…) as a paragraph
     empty cells are left out, so a card only shows what's filled in */
(function (root) {
"use strict";

const clean = (v) => String(v == null ? "" : v).replace(/\s+/g, " ").trim();
const HIDE_COL = /^(scripty key|_)/i;
const isCode = (v) => v.length <= 6 && /^[A-Za-z]{0,2}\d{1,4}[A-Za-z]{0,2}$|^\d+(\.\d+)?$/.test(v);
const norm = (h) => clean(h).toUpperCase().replace(/\.$/, "");
const BADGE = ["#", "NO", "SC", "ACCT", "SHOT", "STRIP"];
const TITLE = ["NAME", "CHARACTER", "ROLE", "ITEM", "CATEGORY", "SET / LOCATION", "SET", "SCRIPT LOCATION", "LOCATION", "ACTOR NAME", "DESCRIPTION OF ACTION", "ONE-LINER", "DESCRIPTION"];
const FIGURE = ["TOTAL", "PAGES", "PGS"];
const CHIP = ["%", "I/E", "D/N", "TYPE", "STATUS", "SHOT SIZE", "SIZE", "ANGLE", "MOVEMENT", "MOVE", "LENS", "UNIT", "DEPARTMENT", "SCRIPT DAY", "DAY"];
const LONG = /^(DESCRIPTION|NOTES|ONE-LINER|WHY|BRIEF|SPECIAL REQ|SCENE NUMBERS|SC\. NUMBERS|CHARACTERS|EQUIPMENT|ADDRESS)/;

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
    const score = cells.length + (f.b || f.h ? 0.5 : 0);
    if(score > bestN + (best < 0 ? 0 : 0.01)){ best = r; bestN = score; }
  }
  return best;
}
// Which job each column does, from its title
function rolesOf(header, hidden){
  const H = header.map(norm), pick = (list) => { for(const n of list){ const i = H.indexOf(n); if(i >= 0 && !hidden[i]) return i; } return -1; };
  const badges = H.map((n, i) => (BADGE.indexOf(n) >= 0 && !hidden[i] ? i : -1)).filter((i) => i >= 0);
  return { H, badges, title: pick(TITLE), name: H.indexOf("NAME"), figure: pick(FIGURE),
    chip: (i) => CHIP.indexOf(H[i]) >= 0, long: (i) => LONG.test(H[i]) };
}

// rows: [[cell, …], …] as shown in the Sheet; fmt (optional): [{ b: bold?, h: shade colour or "" }, …] per row
function layout(rows, fmt){
  rows = (Array.isArray(rows) ? rows : []).map((r) => (Array.isArray(r) ? r : []).map(clean));
  const h = headerRowOf(rows, fmt);
  const header = h >= 0 ? rows[h] : [];
  const hidden = header.map((x) => HIDE_COL.test(x));
  const R = rolesOf(header, hidden);
  const title = [];
  for(let r = 0; r < (h >= 0 ? h : 0); r++){ const t = rows[r].filter(Boolean).join(" · "); if(t) title.push(t); }
  const off = h >= 0 ? h + 1 : 0;
  const body = rows.slice(off).map((r, k) => ({ cells: r.map((v, i) => (hidden[i] ? "" : v)), f: (fmt && fmt[k + off]) || null }));
  const filled = (r) => r.cells.map((v, i) => ({ i, v })).filter((c) => c.v);
  const nonEmpty = body.filter((r) => filled(r).length);
  // A heading: one value in the first columns, shown bold or shaded (without formatting info: first column or in capitals).
  // A lone value that isn't styled (an unfilled crew slot: just its role) stays a card.
  const isSection = (r) => {
    const c = filled(r); if(c.length !== 1 || c[0].i > 1) return false;
    return r.f ? !!(r.f.b || r.f.h) : (c[0].i === 0 || (/[A-Z]/.test(c[0].v) && c[0].v === c[0].v.toUpperCase()));
  };
  const items = [];
  nonEmpty.forEach((r, k) => {
    const cells = filled(r), at = (i) => (i >= 0 ? r.cells[i] || "" : "");
    if(isSection(r)){
      const next = nonEmpty[k + 1];
      items.push({ type: "section", text: cells[0].v, level: next && isSection(next) ? 1 : 2 });
      return;
    }
    const used = {};
    const take = (i) => { used[i] = 1; return r.cells[i]; };
    // badges: the code columns; with no code columns, a short code in the first cell
    let badges = R.badges.filter((i) => at(i)).map((i) => ({ label: header[i], value: take(i) }));
    let ti = R.title >= 0 && at(R.title) ? R.title : -1, missing = "";
    if(R.name >= 0 && !at(R.name) && R.title === R.name){                  // an unfilled crew slot: show its role instead
      const role = R.H.indexOf("ROLE"); if(role >= 0 && at(role)){ ti = role; missing = header[R.name]; }
    }
    if(ti < 0){
      const first = cells.find((c) => !used[c.i]);
      if(first && !badges.length && isCode(first.v) && cells.filter((c) => !used[c.i]).length > 1){ badges = [{ label: header[first.i] || "", value: take(first.i) }]; }
      const nxt = cells.find((c) => !used[c.i]); ti = nxt ? nxt.i : -1;
    }
    const t = ti >= 0 ? take(ti) : (badges[0] ? badges[0].value : "");
    // a short line under the title: the role under a name, the actor under a character
    const subI = ["ROLE", "ACTOR NAME", "ACTOR"].map((n) => R.H.indexOf(n)).find((i) => i >= 0 && !used[i] && at(i) && at(i).length <= 40);
    const subtitle = subI != null && subI >= 0 ? take(subI) : "";
    if(ti < 0 && badges.length === 1) badges = [];
    const figure = R.figure >= 0 && at(R.figure) && !used[R.figure] ? { label: header[R.figure], value: take(R.figure) } : null;
    const chips = [], rowsOut = [], notes = [];
    // Budget lines: "5 days × $450" on one line instead of three
    { const q = R.H.indexOf("QTY"), u = R.H.indexOf("UNIT"), rt = R.H.indexOf("RATE");
      if(q >= 0 && rt >= 0 && at(q) && at(rt) && !used[q] && !used[rt]){ rowsOut.push({ label: "Qty × rate", value: take(q) + (u >= 0 && at(u) && !used[u] ? " " + take(u) : "") + " × " + take(rt), kind: "text" }); } }
    cells.forEach((c) => {
      if(used[c.i]) return;
      const label = header[c.i] || "", v = c.v, kind = kindOf(v);
      if(R.chip(c.i) && v.length <= 16) chips.push({ label, value: v });
      else if(R.long(c.i) || v.length > 40) notes.push({ label, value: v, kind });
      else rowsOut.push({ label, value: v, kind });
    });
    const total = /\btotal\b/i.test(t) || badges.some((b) => /\btotal\b/i.test(b.value));
    // a bold row with only a code/name and a figure is a group heading with its subtotal (Budget accounts)
    const group = !!(r.f && r.f.b) && !chips.length && !rowsOut.length && !notes.length && !!figure && !missing;
    items.push({ type: group ? "group" : "card", badges, title: t, subtitle, missing, figure, chips, rows: rowsOut, notes, total });
  });
  return { title, header: header.filter((x, i) => x && !hidden[i]), items };
}
function matches(item, q){
  if(!q) return true;
  q = q.toLowerCase();
  if(item.type === "section") return false;
  const vals = [item.title, item.subtitle].concat(item.badges.map((b) => b.value), item.figure ? [item.figure.value] : [], item.chips.map((x) => x.value), item.rows.map((x) => x.value), item.notes.map((x) => x.value));
  return vals.some((v) => String(v || "").toLowerCase().indexOf(q) >= 0);
}
const telHref = (v) => "tel:" + v.replace(/[^\d+]/g, "");

// The tab as a table that mirrors the Sheet: its columns (minus hidden and empty ones), section bands, bold rows,
// numbers on the right. band: "dark" for the Sheet's dark header colours, "light" for its pale group shading.
const NUM = /^[-+]?[$€£]?\s?\(?[-+]?[\d,]*\.?\d+\)?\s?%?$|^\d+\s\d\/\d$|^\d\/\d$/;
function lum(hex){ const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || "")); if(!m) return 1; const n = parseInt(m[1], 16); return (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255; }
function table(rows, fmt){
  rows = (Array.isArray(rows) ? rows : []).map((r) => (Array.isArray(r) ? r : []).map(clean));
  const h = headerRowOf(rows, fmt);
  const header = h >= 0 ? rows[h] : [];
  const title = [];
  for(let r = 0; r < (h >= 0 ? h : 0); r++){ const t = rows[r].filter(Boolean).join(" · "); if(t) title.push(t); }
  const off = h >= 0 ? h + 1 : 0, body = rows.slice(off);
  const width = Math.max(header.length, ...body.map((r) => r.length), 0);
  const keep = [];
  for(let c = 0; c < width; c++){
    if(HIDE_COL.test(header[c] || "")) continue;
    if(!(header[c] || "") && !body.some((r) => r[c])) continue;            // an empty spacer column
    keep.push(c);
  }
  const out = [];
  body.forEach((r, k) => {
    const cells = keep.map((c) => r[c] || "");
    if(!cells.some(Boolean)) return;
    const f = (fmt && fmt[k + off]) || {};
    const filled = cells.filter(Boolean).length;
    const band = f.h ? (lum(f.h) < 0.45 ? "dark" : "light") : "";
    const section = filled === 1 && (cells[0] || cells[1]) && (f.b || f.h || !fmt);
    out.push({ type: section ? "section" : "row", cells, text: section ? cells.find(Boolean) : "", bold: !!f.b || /\btotal\b/i.test(cells.join(" ")), band });
  });
  // a column is numeric when most of its filled cells are numbers
  const num = keep.map((c, i) => { const v = out.filter((x) => x.type === "row" && x.cells[i]).map((x) => x.cells[i]); return v.length > 0 && v.filter((x) => NUM.test(x)).length / v.length >= 0.7; });
  // widths: wide enough for the longest word (so words never break), long-text columns get a reading width
  const cols = keep.map((c, i) => {
    const vals = out.filter((x) => x.type === "row" && x.cells[i]).map((x) => x.cells[i]);
    const word = Math.max(String(header[c] || "").length * 0.8, ...vals.map((v) => Math.max(...v.split(/\s+/).map((w) => w.length))), 4);
    const avg = vals.length ? vals.reduce((a, v) => a + v.length, 0) / vals.length : 0;
    const one = vals.every((v) => kindOf(v) !== "text" || NUM.test(v) || v.length <= 18);   // short values stay on one line
    return { label: header[c] || "", num: num[i], ch: Math.min(22, Math.ceil(word) + 1), long: avg > 28, one };
  });
  return { title, columns: cols, rows: out };
}

const api = { layout, table, matches, kindOf, isCode, telHref };
if(typeof module !== "undefined" && module.exports){ module.exports = api; return; }

/* ---------------- browser ---------------- */
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const STALE_MS = 5 * 60 * 1000, MAX_CARDS = 300;
const S = { cache: {}, cur: null, q: "", more: 0, mode: (() => { try{ return localStorage.getItem("Camp_DOCS_MODE_V1") || "table"; }catch(_e){ return "table"; } })() };   // cache: sheetId|tab -> { at, d, state, err }

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
/* One card design for every doc: sections, group headings with subtotals, and cards (badges · title · figure, chips, rows, notes) */
.dcSec{ margin:22px 2px 8px; padding-bottom:6px; border-bottom:1px solid var(--uiBorder, #333); font:800 11.5px Inter, system-ui, sans-serif; letter-spacing:.09em; text-transform:uppercase; color:var(--uiText, #eee); }
.dcSec.l2{ margin-top:14px; border-bottom:0; padding-bottom:0; font-weight:700; color:var(--uiMuted, #999); }
.dcGroup{ display:flex; align-items:center; gap:8px; margin:18px 2px 8px; font:700 13px Inter, system-ui, sans-serif; color:var(--uiText, #eee); }
.dcGroup .dcName{ font-size:13.5px; text-transform:uppercase; letter-spacing:.03em; }
.dcCard{ border:1px solid var(--uiBorder, #2e2e2e); border-radius:12px; background:#1e1f22; padding:12px 14px; margin-bottom:8px; }
.dcCard.total{ background:#232a36; border-color:#3b4a63; }
.dcHead{ display:flex; align-items:flex-start; gap:8px; }
.dcBadges{ display:flex; gap:4px; flex:0 0 auto; padding-top:1px; }
.dcBadge{ font:700 11.5px/18px Inter, system-ui, sans-serif; padding:0 6px; border-radius:5px; background:rgba(255,255,255,.1); color:var(--uiText, #eee); font-variant-numeric:tabular-nums; white-space:nowrap; }
.dcName{ flex:1 1 auto; min-width:0; font-weight:650; font-size:15px; line-height:20px; overflow-wrap:anywhere; color:var(--uiText, #eee); }
.dcFig{ flex:0 0 auto; font:700 15px/20px Inter, system-ui, sans-serif; font-variant-numeric:tabular-nums; color:var(--uiText, #eee); white-space:nowrap; }
.dcFig small{ display:block; text-align:right; font:600 9.5px/12px Inter, system-ui, sans-serif; letter-spacing:.06em; text-transform:uppercase; color:var(--uiMuted, #999); }
.dcSub{ margin-top:2px; font-size:13.5px; color:#c9c9ce; }
.dcMiss{ margin-top:3px; font-size:12.5px; color:var(--uiMuted, #999); font-style:italic; }
.dcChips{ display:flex; flex-wrap:wrap; gap:5px; margin-top:9px; }
.dcChip{ font:600 11.5px/22px Inter, system-ui, sans-serif; padding:0 8px; border-radius:6px; background:rgba(255,255,255,.07); color:#d6d6da; white-space:nowrap; }
.dcRows{ margin-top:9px; border-top:1px solid rgba(255,255,255,.07); }
.dcRow{ display:flex; justify-content:space-between; align-items:baseline; gap:14px; padding:7px 0; border-bottom:1px solid rgba(255,255,255,.07); }
.dcRow:last-child{ border-bottom:0; padding-bottom:0; }
.dcRow small, .dcNote small{ flex:0 0 auto; max-width:45%; font:600 10.5px/16px Inter, system-ui, sans-serif; letter-spacing:.05em; text-transform:uppercase; color:var(--uiMuted, #999); }
.dcRow span, .dcRow a{ min-width:0; text-align:right; font-size:14px; line-height:1.35; overflow-wrap:anywhere; font-variant-numeric:tabular-nums; color:var(--uiText, #eee); }
.dcNote{ margin-top:9px; }
.dcNote small{ display:block; max-width:none; margin-bottom:2px; }
.dcNote p{ margin:0; font-size:14px; line-height:1.45; color:#d6d6da; overflow-wrap:anywhere; white-space:pre-wrap; }
.dcCard a{ color:#8fb4ff; text-decoration:none; }
/* Table view: mirrors the Sheet — same columns, sticky titles and first column, section bands, bold totals */
.dcMode{ display:flex; gap:2px; padding:3px; border-radius:10px; background:rgba(255,255,255,.06); border:1px solid rgba(255,255,255,.1); flex:0 0 auto; }
.dcMode button{ width:36px; height:32px; border:0; border-radius:7px; background:none; color:rgba(255,255,255,.6); display:inline-flex; align-items:center; justify-content:center; cursor:pointer; }
.dcMode button svg{ width:17px; height:17px; }
.dcMode button.on{ background:#ececf0; color:#111; }
.dcSheet{ max-height:calc(100dvh - 210px); overflow:auto; -webkit-overflow-scrolling:touch; overscroll-behavior:contain; border:1px solid var(--uiBorder, #2e2e2e); border-radius:10px; background:#1a1b1e; }
.dcSheet table{ border-collapse:separate; border-spacing:0; min-width:100%; font:13.5px/1.35 Inter, system-ui, sans-serif; color:var(--uiText, #eee); }
.dcSheet th, .dcSheet td{ padding:9px 12px; border-bottom:1px solid rgba(255,255,255,.07); border-right:1px solid rgba(255,255,255,.05); text-align:left; vertical-align:top; max-width:260px; overflow-wrap:normal; word-break:normal; hyphens:none; background:#1a1b1e; }
.dcSheet td.one, .dcSheet td.n{ white-space:nowrap; }
.dcSheet td.c0.n{ text-align:left; }
.dcSheet th{ position:sticky; top:0; z-index:2; background:#24272d; font:700 10.5px/1.3 Inter, system-ui, sans-serif; letter-spacing:.06em; text-transform:uppercase; color:#b8bcc6; white-space:nowrap; max-width:none; }
.dcSheet .c0{ position:sticky; left:0; z-index:1; max-width:42vw; box-shadow:1px 0 0 rgba(255,255,255,.08); }
.dcSheet th.c0{ z-index:3; }
.dcSheet .n{ text-align:right; font-variant-numeric:tabular-nums; white-space:nowrap; }
.dcSheet tr.b td{ font-weight:700; }
.dcSheet tr.sec td{ font:800 11.5px/1.3 Inter, system-ui, sans-serif; letter-spacing:.07em; text-transform:uppercase; white-space:nowrap; }
.dcSheet tr.sec.dark td{ background:#2a3346; color:#e8edf7; }
.dcSheet tr.sec.light td, .dcSheet tr.bd-light td{ background:#22252b; }
.dcSheet tr.bd-dark td{ background:#2a3346; }
.dcSheet a{ color:#8fb4ff; text-decoration:none; }
.dcMsg{ padding:40px 16px; text-align:center; color:var(--uiMuted, #999); display:flex; flex-direction:column; align-items:center; gap:12px; font-size:13.5px; }
.dcMsg b{ color:var(--uiText, #eee); font-size:15px; }
.dcMsg .row{ display:flex; gap:8px; flex-wrap:wrap; justify-content:center; }
.dcMore{ display:block; width:100%; height:44px; margin-top:6px; border-radius:10px; border:1px solid var(--uiBorder, #333); background:rgba(255,255,255,.05); color:var(--uiText, #eee); font:600 14px Inter, system-ui, sans-serif; }
`;
let styled = false;
function style(){ if(styled) return; styled = true; const s = document.createElement("style"); s.textContent = css; document.head.appendChild(s); }

const ICON_TABLE = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="16" rx="1.5"/><path d="M3 10h18M3 15h18M9 4v16"/></svg>`;
const ICON_CARDS = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="4" width="16" height="7" rx="2"/><rect x="4" y="13" width="16" height="7" rx="2"/></svg>`;
const ICON_REFRESH = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/></svg>`;

function valHtml(f){
  return f.kind === "email" ? `<a href="mailto:${esc(f.value)}">${esc(f.value)}</a>`
    : f.kind === "phone" ? `<a href="${esc(telHref(f.value))}">${esc(f.value)}</a>`
    : f.kind === "url" ? `<a href="${esc(f.value)}" target="_blank" rel="noopener">${esc(f.value.replace(/^https?:\/\//i, "").slice(0, 48))}</a>`
    : `<span>${esc(f.value)}</span>`;
}
const badgesHtml = (it) => it.badges.length ? `<span class="dcBadges">${it.badges.map((b) => `<span class="dcBadge" title="${esc(b.label)}">${esc(b.value)}</span>`).join("")}</span>` : "";
const figHtml = (it) => it.figure ? `<span class="dcFig">${esc(it.figure.value)}<small>${esc(it.figure.label)}</small></span>` : "";
function cardHtml(it){
  if(it.type === "section") return `<div class="dcSec${it.level === 2 ? " l2" : ""}">${esc(it.text)}</div>`;
  if(it.type === "group") return `<div class="dcGroup">${badgesHtml(it)}<span class="dcName">${esc(it.title)}</span>${figHtml(it)}</div>`;
  return `<div class="dcCard${it.total ? " total" : ""}"><div class="dcHead">${badgesHtml(it)}<span class="dcName">${esc(it.title)}</span>${figHtml(it)}</div>`
    + (it.subtitle ? `<div class="dcSub">${esc(it.subtitle)}</div>` : "")
    + (it.missing ? `<div class="dcMiss">No ${esc(it.missing.toLowerCase())} yet</div>` : "")
    + (it.chips.length ? `<div class="dcChips">${it.chips.map((c) => `<span class="dcChip" title="${esc(c.label)}">${esc(c.value)}</span>`).join("")}</div>` : "")
    + (it.rows.length ? `<div class="dcRows">${it.rows.map((f) => `<div class="dcRow"><small>${esc(f.label)}</small>${valHtml(f)}</div>`).join("")}</div>` : "")
    + it.notes.map((f) => `<div class="dcNote">${f.label ? `<small>${esc(f.label)}</small>` : ""}${f.kind === "text" ? `<p>${esc(f.value)}</p>` : valHtml(f)}</div>`).join("")
    + `</div>`;
}

function cellHtml(v){
  if(!v) return "";
  const k = kindOf(v);
  return k === "email" ? `<a href="mailto:${esc(v)}">${esc(v)}</a>` : k === "phone" ? `<a href="${esc(telHref(v))}">${esc(v)}</a>`
    : k === "url" ? `<a href="${esc(v)}" target="_blank" rel="noopener">${esc(v.replace(/^https?:\/\//i, "").slice(0, 32))}${v.length > 40 ? "…" : ""}</a>` : esc(v);
}
function tableHtml(T, q){
  const n = T.columns.length;
  const ql = (q || "").toLowerCase();
  let rows = T.rows;
  if(ql){ rows = rows.filter((r) => r.type === "row" && r.cells.some((c) => c.toLowerCase().indexOf(ql) >= 0)); }
  if(!rows.length) return `<div class="dcMsg"><span>${q ? "Nothing matches." : "This tab is empty."}</span></div>`;
  const sty = (c) => c.long ? "min-width:220px;max-width:260px" : `min-width:${c.ch}ch`;
  const cls = (c, i) => (c.num ? "n" : "") + (c.one && !c.long ? " one" : "") + (i === 0 ? " c0" : "");
  const head = `<thead><tr>${T.columns.map((c, i) => `<th class="${cls(c, i)}" style="${sty(c)}">${esc(c.label)}</th>`).join("")}</tr></thead>`;
  const body = rows.slice(0, 600).map((r) => r.type === "section"
    ? `<tr class="sec ${r.band || "light"}"><td class="c0" colspan="1">${esc(r.text)}</td><td colspan="${Math.max(1, n - 1)}"></td></tr>`
    : `<tr class="${r.bold ? "b " : ""}${r.band ? "bd-" + r.band : ""}">${r.cells.map((v, i) => `<td class="${cls(T.columns[i] || {}, i)}">${cellHtml(v)}</td>`).join("")}</tr>`).join("");
  return `<div class="dcSheet"><table>${head}<tbody>${body}</tbody></table></div>`;
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
    if(!tab && d.tab){ S.cache[o.sheet.id + "|" + d.tab] = S.cache[k]; if(S.cur && S.cur.sheet.id === o.sheet.id && !S.cur.tab) S.cur.tab = d.tab; }
  }catch(err){
    S.cache[k] = { state: "error", err: (err && err.message) || String(err), reason: err && err.reason, d: old && old.d, at: Date.now() };
  }
  // the hub redraws while this loads (new S.cur object), so match by Sheet, not by object
  if(S.cur && S.cur.sheet.id === o.sheet.id && host.isConnected) draw(host);
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
  const asTable = S.mode !== "cards";
  const items = asTable ? [] : L.items.filter((it) => !S.q || matches(it, S.q));
  const lim = MAX_CARDS + S.more;
  const shown = items.slice(0, lim);
  const tabs = d.tabs.length > 1 ? `<div class="dcTabs" role="tablist">${d.tabs.map((t) => `<button type="button" role="tab" data-dct="${esc(t)}" class="${t === d.tab ? "on" : ""}" aria-selected="${t === d.tab}">${esc(t)}</button>`).join("")}</div>` : "";
  const keepFocus = document.activeElement && document.activeElement.id === "dcQ";
  const selStart = keepFocus ? document.activeElement.selectionStart : 0;
  host.innerHTML = `<div class="dcTop">${tabs}<div class="dcFind"><input type="search" id="dcQ" placeholder="Find in ${esc(d.tab || "this tab")}" value="${esc(S.q)}" autocomplete="off" aria-label="Find">
      <div class="dcMode" role="tablist" aria-label="View"><button type="button" data-dcm="table" class="${asTable ? "on" : ""}" aria-label="Table" title="Table, like the Sheet">${ICON_TABLE}</button><button type="button" data-dcm="cards" class="${asTable ? "" : "on"}" aria-label="Cards" title="Cards">${ICON_CARDS}</button></div>
      <button type="button" data-dc="refresh" aria-label="Refresh" title="Read the Sheet again">${c.state === "loading" ? `<span class="spin"></span>` : ICON_REFRESH}</button></div></div>
    ${L.title.length && !S.q ? `<div class="dcTitle"><b>${esc(L.title[0])}</b>${L.title.slice(1, 3).map((t) => `<span>${esc(t)}</span>`).join("")}</div>` : ""}
    ${asTable ? tableHtml(table(d.rows, d.fmt), S.q) : (shown.length ? shown.map(cardHtml).join("") : `<div class="dcMsg"><span>${S.q ? "Nothing matches." : "This tab is empty."}</span></div>`)}
    ${!asTable && items.length > lim ? `<button type="button" class="dcMore" data-dc="more">Show more (${items.length - lim} left)</button>` : ""}`;
  if(keepFocus){ const q = host.querySelector("#dcQ"); if(q){ q.focus({ preventScroll: true }); try{ q.setSelectionRange(selStart, selStart); }catch(_e){} } }
  wire(host);
}
function wire(host){
  if(host._dcWired) return; host._dcWired = true;
  host.addEventListener("click", (e) => {
    const t = e.target.closest("[data-dct]");
    if(t){ S.cur.tab = t.dataset.dct; S.q = ""; S.more = 0; const c = S.cache[S.cur.sheet.id + "|" + S.cur.tab]; draw(host); if(!c || Date.now() - c.at > STALE_MS) load(host, S.cur.tab); window.scrollTo && host.scrollIntoView && host.scrollIntoView({ block: "start" }); return; }
    const m = e.target.closest("[data-dcm]");
    if(m){ S.mode = m.dataset.dcm; try{ localStorage.setItem("Camp_DOCS_MODE_V1", S.mode); }catch(_e){} draw(host); return; }
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
