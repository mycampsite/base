/* layouts.js — the hub's Layouts tab: a whiteboard per idea (sketches, floor plans, lighting plans, reference boards).
   Each project has a list of layouts; each layout is an endless canvas of items:
     pen, rect, ellipse, line, arrow, text, note, img (picture), link (web / video card), kit (lighting & set pieces).
   Stored in Firebase at projects/<pid>/layouts/<lid> = { name, at, by, order, items: { <id>: item } }, one entry per item,
   so two people drawing at once don't overwrite each other. ⚠ needs the layouts rule (projects/$pid/layouts).
   If the database refuses (no rule yet), layouts are kept on this device and a toast says so.
   item = { t, x, y, w, h, r (degrees), z (stacking), c (colour), sw (line width), fs (font size), text, pts ("x,y x,y" from x,y),
            k (kit piece), lbl (label), src (picture), url } */
(function () {
"use strict";
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]));
const lsGet = (k) => { try{ return localStorage.getItem(k); }catch(_e){ return null; } };
const lsSet = (k, v) => { try{ localStorage.setItem(k, v); }catch(_e){} };
const H = () => window.__CampHub;
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const r1 = (v) => Math.round(v * 10) / 10;
const GRID = 20;
const INKS = ["#f2f2f2", "#ff6b61", "#ffb02e", "#ffd84d", "#6bd68f", "#5aa9ff", "#b18cff", "#8a8a8a"];
const NOTES = ["#ffe58a", "#ffb7a8", "#b9f0c4", "#b8dcff", "#e2ccff", "#f2f2f2"];
// Items come from everyone on the project, so check them before they are drawn or opened: colours must look like colours,
// sizes and angles must be numbers, links must be http(s). Anything else falls back to the default.
const safeColor = (v) => (typeof v === "string" && /^(#[0-9a-f]{3,8}|(rgb|hsl)a?\([0-9 ,.%]+\))$/i.test(v.trim())) ? v.trim() : "";
const safeNum = (v, d) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
const safeUrl = (u) => { const t = String(u == null ? "" : u).trim(); return /^https?:\/\//i.test(t) ? t : ""; };
const WIDTHS = [2, 4, 8];
const LOCAL = (pid) => "Camp_LAYOUTS_LOCAL_" + pid;

// ---------- the lighting & set kit (seen from above; the front of each piece points up before rotating) ----------
const KIT = {
  fresnel:   { n:"Fresnel",      g:"Lighting",      w:40,  h:40,  beam:1 },
  led:       { n:"LED panel",    g:"Lighting",      w:64,  h:18,  beam:1 },
  softbox:   { n:"Softbox",      g:"Lighting",      w:72,  h:30,  beam:1 },
  tube:      { n:"Tube light",   g:"Lighting",      w:90,  h:10,  beam:1 },
  practical: { n:"Practical",    g:"Lighting",      w:28,  h:28 },
  sun:       { n:"Sun / window light", g:"Lighting", w:44, h:44 },
  camera:    { n:"Camera",       g:"Camera & grip", w:46,  h:32,  fov:1 },
  dolly:     { n:"Dolly track",  g:"Camera & grip", w:220, h:22 },
  flag:      { n:"Flag",         g:"Camera & grip", w:60,  h:8 },
  reflector: { n:"Reflector",    g:"Camera & grip", w:50,  h:50 },
  cstand:    { n:"C-stand",      g:"Camera & grip", w:26,  h:26 },
  monitor:   { n:"Monitor / video village", g:"Camera & grip", w:50, h:24 },
  wall:      { n:"Wall",         g:"Set",           w:240, h:12 },
  door:      { n:"Door",         g:"Set",           w:64,  h:64 },
  window:    { n:"Window",       g:"Set",           w:90,  h:12 },
  table:     { n:"Table",        g:"Set",           w:100, h:64 },
  chair:     { n:"Chair",        g:"Set",           w:32,  h:32 },
  sofa:      { n:"Sofa",         g:"Set",           w:120, h:46 },
  bed:       { n:"Bed",          g:"Set",           w:110, h:150 },
  car:       { n:"Car",          g:"Set",           w:90,  h:190 },
  actor:     { n:"Actor",        g:"People",        w:38,  h:38 },
  crew:      { n:"Crew",         g:"People",        w:30,  h:30 }
};
const KIT_GROUPS = ["Lighting", "Camera & grip", "Set", "People"];
function kitBody(k, w, h, c){ return kitBody0(k, w, h, c).replace(/fill="none"([^>]*?) fill="/g, '$1 fill="'); }
function kitBody0(k, w, h, c){
  const s = `stroke="${c}" stroke-width="2" fill="none" vector-effect="non-scaling-stroke"`, f = `fill="${c}"`;
  switch(k){
    case "fresnel":   return `<circle cx="${w/2}" cy="${h/2}" r="${Math.min(w,h)/2-2}" ${s} fill="#2a2a2a"/><path d="M${w*.15} 2 L${w*.3} ${-h*.18} M${w*.85} 2 L${w*.7} ${-h*.18}" ${s}/><circle cx="${w/2}" cy="${h/2}" r="${Math.min(w,h)/5}" ${f} opacity=".8"/>`;
    case "led":       return `<rect x="1" y="1" width="${w-2}" height="${h-2}" rx="2" ${s} fill="#2a2a2a"/>${[1,2,3,4,5].map((i) => `<circle cx="${w*i/6}" cy="${h/2}" r="1.8" ${f}/>`).join("")}`;
    case "softbox":   return `<path d="M${w*.25} ${h} L0 0 L${w} 0 L${w*.75} ${h} Z" ${s} fill="#2a2a2a"/><path d="M4 3 L${w-4} 3" stroke="${c}" stroke-width="3" opacity=".6"/>`;
    case "tube":      return `<rect x="0" y="0" width="${w}" height="${h}" rx="${h/2}" ${s} fill="#2a2a2a"/><rect x="4" y="${h/2-1.5}" width="${w-8}" height="3" rx="1.5" ${f} opacity=".85"/>`;
    case "practical": return `<circle cx="${w/2}" cy="${h/2}" r="${w*.3}" ${s} fill="#3a3320"/>${[0,45,90,135,180,225,270,315].map((a) => { const t = a*Math.PI/180, x1 = w/2+Math.cos(t)*w*.38, y1 = h/2+Math.sin(t)*h*.38, x2 = w/2+Math.cos(t)*w*.5, y2 = h/2+Math.sin(t)*h*.5; return `<path d="M${x1} ${y1} L${x2} ${y2}" ${s}/>`; }).join("")}`;
    case "sun":       return `<circle cx="${w/2}" cy="${h/2}" r="${w*.22}" ${f} opacity=".85"/>${[0,30,60,90,120,150,180,210,240,270,300,330].map((a) => { const t = a*Math.PI/180; return `<path d="M${w/2+Math.cos(t)*w*.3} ${h/2+Math.sin(t)*h*.3} L${w/2+Math.cos(t)*w*.48} ${h/2+Math.sin(t)*h*.48}" ${s}/>`; }).join("")}`;
    case "camera":    return `<rect x="${w*.12}" y="${h*.35}" width="${w*.76}" height="${h*.62}" rx="3" ${s} fill="#2a2a2a"/><path d="M${w*.3} ${h*.35} L${w*.22} 0 L${w*.78} 0 L${w*.7} ${h*.35} Z" ${s} fill="#333"/>`;
    case "dolly":     return `<path d="M0 3 L${w} 3 M0 ${h-3} L${w} ${h-3}" ${s}/>${Array.from({ length:Math.max(2, Math.round(w/22)) }, (_, i) => `<path d="M${(i+.5)*w/Math.max(2, Math.round(w/22))} 0 L${(i+.5)*w/Math.max(2, Math.round(w/22))} ${h}" ${s} opacity=".55"/>`).join("")}`;
    case "flag":      return `<rect x="0" y="0" width="${w}" height="${h}" fill="#0c0c0c" stroke="${c}" stroke-width="1.5" vector-effect="non-scaling-stroke"/>`;
    case "reflector": return `<circle cx="${w/2}" cy="${h/2}" r="${Math.min(w,h)/2-1}" ${s} fill="#3b3b3b"/><path d="M${w/2} 1 A${w/2-1} ${h/2-1} 0 0 1 ${w/2} ${h-1} Z" fill="#c9b26a" opacity=".7"/>`;
    case "cstand":    return `<circle cx="${w/2}" cy="${h/2}" r="3" ${f}/>${[90,210,330].map((a) => { const t = a*Math.PI/180; return `<path d="M${w/2} ${h/2} L${w/2+Math.cos(t)*w*.5} ${h/2+Math.sin(t)*h*.5}" ${s}/>`; }).join("")}`;
    case "monitor":   return `<rect x="0" y="0" width="${w}" height="${h*.7}" rx="2" ${s} fill="#1e2a3a"/><path d="M${w/2} ${h*.7} L${w/2} ${h} M${w*.3} ${h} L${w*.7} ${h}" ${s}/>`;
    case "wall":      return `<rect x="0" y="0" width="${w}" height="${h}" fill="#4a4a4a" stroke="${c}" stroke-width="1.5" vector-effect="non-scaling-stroke"/>`;
    case "door":      return `<path d="M0 ${h} L0 0" stroke="${c}" stroke-width="3" vector-effect="non-scaling-stroke"/><path d="M0 0 A${w} ${h} 0 0 1 ${w} ${h}" ${s} stroke-dasharray="4 4"/><path d="M0 ${h} L${w} ${h}" stroke="#4a4a4a" stroke-width="4"/>`;
    case "window":    return `<rect x="0" y="0" width="${w}" height="${h}" fill="#1f3346" stroke="${c}" stroke-width="1.5" vector-effect="non-scaling-stroke"/><path d="M0 ${h/2} L${w} ${h/2}" ${s}/>`;
    case "table":     return `<rect x="0" y="0" width="${w}" height="${h}" rx="4" ${s} fill="#3a2f25"/>`;
    case "chair":     return `<rect x="${w*.1}" y="${h*.25}" width="${w*.8}" height="${h*.7}" rx="3" ${s} fill="#2e2e2e"/><rect x="${w*.1}" y="0" width="${w*.8}" height="${h*.2}" rx="2" ${f} opacity=".7"/>`;
    case "sofa":      return `<rect x="0" y="0" width="${w}" height="${h}" rx="6" ${s} fill="#2e2e2e"/><rect x="0" y="0" width="${w}" height="${h*.3}" rx="5" ${f} opacity=".35"/><path d="M${w/2} ${h*.3} L${w/2} ${h}" ${s} opacity=".5"/>`;
    case "bed":       return `<rect x="0" y="0" width="${w}" height="${h}" rx="5" ${s} fill="#2e2e2e"/><rect x="${w*.1}" y="${h*.05}" width="${w*.35}" height="${h*.16}" rx="4" ${f} opacity=".55"/><rect x="${w*.55}" y="${h*.05}" width="${w*.35}" height="${h*.16}" rx="4" ${f} opacity=".55"/><path d="M0 ${h*.35} L${w} ${h*.35}" ${s} opacity=".5"/>`;
    case "car":       return `<rect x="0" y="0" width="${w}" height="${h}" rx="${w*.3}" ${s} fill="#2a2a2a"/><path d="M${w*.15} ${h*.28} Q${w/2} ${h*.2} ${w*.85} ${h*.28} L${w*.8} ${h*.42} L${w*.2} ${h*.42} Z" ${f} opacity=".35"/><path d="M${w*.2} ${h*.72} L${w*.8} ${h*.72} L${w*.85} ${h*.8} L${w*.15} ${h*.8} Z" ${f} opacity=".25"/>`;
    case "actor":     return `<path d="M${w/2} 0 L${w*.62} ${h*.2} L${w*.38} ${h*.2} Z" ${f}/><circle cx="${w/2}" cy="${h*.58}" r="${Math.min(w,h)*.38}" ${s} fill="#5a2a2a"/>`;
    case "crew":      return `<circle cx="${w/2}" cy="${h/2}" r="${Math.min(w,h)*.4}" ${s} fill="#2a3a5a"/><path d="M${w/2} ${h*.1} L${w/2} ${h*.3}" ${s}/>`;
    default:          return `<rect x="0" y="0" width="${w}" height="${h}" ${s}/>`;
  }
}
// light spill / camera view in front of the piece (not clickable)
function kitFront(k, w, h){
  const K = KIT[k] || {};
  if(K.beam){ const L = Math.max(140, w * 2.2); return `<path d="M${w*.15} 0 L${-L*.35} ${-L} L${w + L*.35} ${-L} L${w*.85} 0 Z" fill="url(#lyBeam)" pointer-events="none"/>`; }
  if(K.fov){ const L = 260; return `<path d="M${w*.3} 0 L${w/2 - L*.45} ${-L} M${w*.7} 0 L${w/2 + L*.45} ${-L}" stroke="#9fb6d6" stroke-width="1.2" stroke-dasharray="6 5" vector-effect="non-scaling-stroke" pointer-events="none"/>`; }
  return "";
}
const KIT_ICON = (k) => { const K = KIT[k], s = 30 / Math.max(K.w, K.h); return `<svg viewBox="${-K.w*.1} ${-K.h*.1} ${K.w*1.2} ${K.h*1.2}" width="30" height="30" aria-hidden="true">${kitBody(k, K.w, K.h, "#e8e8e8")}</svg>`; };

// ---------- points ----------
const ptsOf = (it) => String(it.pts || "").split(" ").filter(Boolean).map((p) => p.split(",").map(Number));
const ptsStr = (a) => a.map((p) => r1(p[0]) + "," + r1(p[1])).join(" ");
function smoothPath(a){
  if(!a.length) return "";
  if(a.length < 3) return "M" + a.map((p) => p[0] + " " + p[1]).join(" L");
  let d = "M" + a[0][0] + " " + a[0][1];
  for(let i = 1; i < a.length - 1; i++){ const mx = (a[i][0] + a[i + 1][0]) / 2, my = (a[i][1] + a[i + 1][1]) / 2; d += " Q" + a[i][0] + " " + a[i][1] + " " + r1(mx) + " " + r1(my); }
  const l = a[a.length - 1]; return d + " L" + l[0] + " " + l[1];
}
// a pen / line item from absolute points: x,y = top-left of the box, points relative to it
function fromAbs(t, abs, base){
  const xs = abs.map((p) => p[0]), ys = abs.map((p) => p[1]), x = Math.min(...xs), y = Math.min(...ys);
  return Object.assign({}, base, { t, x:r1(x), y:r1(y), w:r1(Math.max(1, Math.max(...xs) - x)), h:r1(Math.max(1, Math.max(...ys) - y)), pts:ptsStr(abs.map((p) => [p[0] - x, p[1] - y])) });
}
const hostOf = (u) => { try{ return new URL(u).hostname.replace(/^www\./, ""); }catch(_e){ return u; } };
const isVideo = (u) => /youtube\.com|youtu\.be|vimeo\.com|\.mp4($|\?)|\.mov($|\?)|\.webm($|\?)/i.test(u || "");

// ---------- one item as SVG (exp = for the PNG export: plain SVG text, no HTML) ----------
let MCTX = null;
function wrapText(text, px, maxW, weight){
  MCTX = MCTX || document.createElement("canvas").getContext("2d");
  MCTX.font = (weight || 500) + " " + px + "px Inter, system-ui, sans-serif";
  const out = [];
  String(text || "").split("\n").forEach((para) => {
    const words = para.split(/(\s+)/); let line = "";
    words.forEach((w) => { const t = line + w; if(MCTX.measureText(t).width > maxW && line.trim()){ out.push(line.trimEnd()); line = w.trimStart(); } else line = t; });
    out.push(line);
  });
  return out;
}
function svgLines(text, x, y, px, maxW, fill, weight, maxH){
  const lh = px * 1.25, lines = wrapText(text, px, maxW, weight).slice(0, Math.max(1, Math.floor((maxH || 1e6) / lh)));
  return `<text x="${x}" y="${y + px}" font-family="Inter, system-ui, sans-serif" font-weight="${weight || 500}" font-size="${px}" fill="${fill}">${lines.map((l, i) => `<tspan x="${x}" dy="${i ? lh : 0}">${esc(l)}</tspan>`).join("")}</text>`;
}
function itemSvg(it0, id, exp){
  const it = Object.assign({}, it0, { x: safeNum(it0.x, 0), y: safeNum(it0.y, 0), w: safeNum(it0.w, 1), h: safeNum(it0.h, 1), r: safeNum(it0.r, 0), sw: safeNum(it0.sw, 2), fs: safeNum(it0.fs, 0), c: safeColor(it0.c), url: safeUrl(it0.url) });
  const c = it.c || INKS[0], sw = it.sw || 2, w = Math.max(1, it.w || 1), h = Math.max(1, it.h || 1);
  const rot = it.r ? ` transform="rotate(${it.r} ${it.x + w/2} ${it.y + h/2})"` : "";
  let body = "";
  if(it.t === "pen"){ const d = smoothPath(ptsOf(it)); body = `<g transform="translate(${it.x} ${it.y})"><path d="${d}" stroke="transparent" stroke-width="${Math.max(14, sw + 10)}" fill="none" stroke-linecap="round"/><path d="${d}" stroke="${c}" stroke-width="${sw}" fill="none" stroke-linecap="round" stroke-linejoin="round"/></g>`; }
  else if(it.t === "rect") body = `<rect x="${it.x}" y="${it.y}" width="${w}" height="${h}" rx="4" stroke="${c}" stroke-width="${sw}" fill="${it.f || "rgba(0,0,0,0)"}"/>`;
  else if(it.t === "ellipse") body = `<ellipse cx="${it.x + w/2}" cy="${it.y + h/2}" rx="${w/2}" ry="${h/2}" stroke="${c}" stroke-width="${sw}" fill="${it.f || "rgba(0,0,0,0)"}"/>`;
  else if(it.t === "line" || it.t === "arrow"){
    const p = ptsOf(it); if(p.length < 2) return "";
    const [a, b] = [p[0], p[p.length - 1]], ax = it.x + a[0], ay = it.y + a[1], bx = it.x + b[0], by = it.y + b[1];
    let head = "";
    if(it.t === "arrow"){ const ang = Math.atan2(by - ay, bx - ax), L = 8 + sw * 2.5, sp = 0.45;
      head = `<path d="M${bx} ${by} L${bx - L * Math.cos(ang - sp)} ${by - L * Math.sin(ang - sp)} L${bx - L * Math.cos(ang + sp)} ${by - L * Math.sin(ang + sp)} Z" fill="${c}"/>`; }
    body = `<path d="M${ax} ${ay} L${bx} ${by}" stroke="transparent" stroke-width="${Math.max(14, sw + 10)}"/><path d="M${ax} ${ay} L${bx} ${by}" stroke="${c}" stroke-width="${sw}" stroke-linecap="round"/>${head}`;
  }
  else if(it.t === "text" && exp) body = svgLines(it.text, it.x, it.y, it.fs || 22, w, c, 500);
  else if(it.t === "note" && exp) body = `<rect x="${it.x + 3}" y="${it.y + 4}" width="${w}" height="${h}" rx="3" fill="rgba(0,0,0,.35)"/><rect x="${it.x}" y="${it.y}" width="${w}" height="${h}" rx="3" fill="${it.c || NOTES[0]}"/>` + svgLines(it.text, it.x + 11, it.y + 10, it.fs || 16, w - 22, "#222", 500, h - 20);
  else if(it.t === "text") body = `<foreignObject x="${it.x}" y="${it.y}" width="${w}" height="${h}"><div xmlns="http://www.w3.org/1999/xhtml" class="lyTxt" style="color:${c};font-size:${it.fs || 22}px">${esc(it.text || "")}</div></foreignObject>`;
  else if(it.t === "note") body = `<rect x="${it.x + 3}" y="${it.y + 4}" width="${w}" height="${h}" rx="3" fill="rgba(0,0,0,.35)"/><rect x="${it.x}" y="${it.y}" width="${w}" height="${h}" rx="3" fill="${it.c || NOTES[0]}"/><foreignObject x="${it.x}" y="${it.y}" width="${w}" height="${h}"><div xmlns="http://www.w3.org/1999/xhtml" class="lyTxt note" style="font-size:${it.fs || 16}px">${esc(it.text || "")}</div></foreignObject>`;
  else if(it.t === "img") body = `<rect x="${it.x}" y="${it.y}" width="${w}" height="${h}" fill="#222"/><image href="${esc(it.src || "")}" x="${it.x}" y="${it.y}" width="${w}" height="${h}" preserveAspectRatio="xMidYMid slice"/><rect x="${it.x}" y="${it.y}" width="${w}" height="${h}" fill="none" stroke="rgba(255,255,255,.12)"/>`;
  else if(it.t === "link"){
    const v = isVideo(it.url);
    body = `<rect x="${it.x}" y="${it.y}" width="${w}" height="${h}" rx="8" fill="#232323" stroke="#454545"/>
      <rect x="${it.x + 10}" y="${it.y + 10}" width="${h - 20}" height="${h - 20}" rx="6" fill="${v ? "#5a1f1f" : "#1f3346"}"/>
      <text x="${it.x + h / 2}" y="${it.y + h / 2 + 6}" text-anchor="middle" font-size="18" fill="#fff">${v ? "▶" : "↗"}</text>
      ${exp ? svgLines(it.text || (v ? "Video" : hostOf(it.url)), it.x + h + 8, it.y + h / 2 - 17, 13, w - h - 16, "#eee", 700, 18) + svgLines(hostOf(it.url || ""), it.x + h + 8, it.y + h / 2 + 2, 11, w - h - 16, "#999", 400, 16) : `<foreignObject x="${it.x + h}" y="${it.y + 6}" width="${Math.max(10, w - h - 8)}" height="${h - 12}"><div xmlns="http://www.w3.org/1999/xhtml" class="lyLink"><b>${esc(it.text || (v ? "Video" : hostOf(it.url)))}</b><span>${esc(hostOf(it.url || ""))}</span></div></foreignObject>`}`;
  }
  else if(it.t === "kit") body = `<g transform="translate(${it.x} ${it.y})">${kitFront(it.k, w, h)}<rect width="${w}" height="${h}" fill="transparent"/>${kitBody(it.k, w, h, c)}</g>`;
  const lbl = it.t === "kit" && it.lbl ? `<text class="lyLbl" font-family="Inter, system-ui, sans-serif" font-weight="600" font-size="12" fill="#ddd" stroke="#151515" stroke-width="3" paint-order="stroke" x="${it.x + w/2}" y="${it.y + h + 16}" text-anchor="middle">${esc(it.lbl)}</text>` : "";
  return `<g class="lyIt" data-id="${esc(id)}"><g${rot}>${body}</g>${lbl}</g>`;
}
const DEFS = `<defs><radialGradient id="lyBeam" cx="50%" cy="100%" r="100%"><stop offset="0" stop-color="#ffd27a" stop-opacity=".38"/><stop offset="1" stop-color="#ffd27a" stop-opacity="0"/></radialGradient>
  <pattern id="lyDots" width="${GRID}" height="${GRID}" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="1" fill="rgba(255,255,255,.09)"/></pattern></defs>`;
const sortItems = (items) => Object.keys(items || {}).filter((k) => items[k] && typeof items[k] === "object").sort((a, b) => ((items[a].z || 0) - (items[b].z || 0)) || (a < b ? -1 : 1));
function bboxOf(items, ids){
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  (ids || Object.keys(items || {})).forEach((k) => { const it = items[k]; if(!it) return; x0 = Math.min(x0, it.x); y0 = Math.min(y0, it.y); x1 = Math.max(x1, it.x + (it.w || 1)); y1 = Math.max(y1, it.y + (it.h || 1) + (it.lbl ? 20 : 0)); });
  return x0 > x1 ? null : { x:x0, y:y0, w:x1 - x0, h:y1 - y0 };
}
function thumbSvg(L){
  const items = (L && L.items) || {}, b = bboxOf(items);
  if(!b) return `<svg viewBox="0 0 160 100"><rect width="160" height="100" fill="#1b1b1b"/></svg>`;
  const pad = Math.max(b.w, b.h) * 0.06 + 10;
  return `<svg viewBox="${b.x - pad} ${b.y - pad} ${b.w + pad * 2} ${b.h + pad * 2}" preserveAspectRatio="xMidYMid meet">${DEFS}${sortItems(items).map((k) => itemSvg(items[k], k)).join("")}</svg>`;
}

// ---------- state ----------
const S = {
  pid: null, lid: {}, mounted: null, tool: "select", ink: INKS[0], note: NOTES[0], sw: 2, snap: lsGet("Camp_LAYOUTS_SNAP") === "1",
  view: {}, sel: [], drag: null, undo: [], redo: [], denied: {}, local: {}, editing: null, kitOpen: false, sig: "", listSig: "", space: false, clip: null
};
const viewOf = (lid) => S.view[lid] || (S.view[lid] = { x:-80, y:-60, z:1 });

function layoutsOf(pid){
  if(S.denied[pid]){ if(!S.local[pid]){ try{ S.local[pid] = JSON.parse(lsGet(LOCAL(pid)) || "{}") || {}; }catch(_e){ S.local[pid] = {}; } } return S.local[pid]; }
  const p = H() && H().project(pid);
  return (p && p.layouts && typeof p.layouts === "object") ? p.layouts : {};
}
const orderedIds = (Ls) => Object.keys(Ls).filter((k) => Ls[k] && typeof Ls[k] === "object").sort((a, b) => ((Ls[a].order || 0) - (Ls[b].order || 0)) || (a < b ? -1 : 1));
const canEdit = () => { const p = H() && H().project(S.pid); return !!(p && H().canEdit(p)); };
function curLid(){
  const Ls = layoutsOf(S.pid), ids = orderedIds(Ls);
  let lid = S.lid[S.pid] || lsGet("Camp_LAYOUTS_LAST_" + S.pid);
  if(!lid || !Ls[lid]) lid = ids[0] || null;
  S.lid[S.pid] = lid; return lid;
}
const curItems = () => { const L = layoutsOf(S.pid)[curLid()]; return (L && L.items) || {}; };

// write { "<lid>/items/<id>": item | null, ... } — straight into Firebase, or this device's copy when refused
function write(paths){
  const pid = S.pid;
  if(S.denied[pid]){ applyLocal(pid, paths); return Promise.resolve(); }
  const hub = H();
  if(!hub || !hub.writeLayouts){ S.denied[pid] = true; applyLocal(pid, paths); return Promise.resolve(); }
  return Promise.resolve().then(() => hub.writeLayouts(pid, paths)).catch((err) => {
    const m = String((err && (err.code || err.message)) || err);
    if(/permission|denied/i.test(m)){
      // keep working on this device: start from what the team copy had, add this change
      S.local[pid] = JSON.parse(JSON.stringify((hub.project(pid) || {}).layouts || {}));
      S.denied[pid] = true; applyLocal(pid, paths);
      hub.toast("Layouts aren't shared yet: the database needs the layouts rule. They're kept on this device for now.", "err", 6000);
      draw(true);
    } else hub.toast("Couldn't save that change: " + m, "err", 4000);
  });
}
function applyLocal(pid, paths){
  const root = S.local[pid] || (S.local[pid] = {});
  Object.keys(paths).forEach((p) => {
    const parts = p.split("/"); let o = root;
    for(let i = 0; i < parts.length - 1; i++){ if(!o[parts[i]] || typeof o[parts[i]] !== "object") o[parts[i]] = {}; o = o[parts[i]]; }
    const last = parts[parts.length - 1];
    if(paths[p] == null) delete o[last]; else o[last] = JSON.parse(JSON.stringify(paths[p]));
  });
  lsSet(LOCAL(pid), JSON.stringify(root));
}
// change items on the open layout (null = remove), with undo
function commit(changes, noUndo){
  const lid = curLid(); if(!lid) return;
  const items = curItems(), before = {}, paths = {};
  Object.keys(changes).forEach((id) => { before[id] = items[id] ? JSON.parse(JSON.stringify(items[id])) : null; paths[lid + "/items/" + id] = changes[id]; });
  paths[lid + "/at"] = Date.now();
  if(!noUndo){ S.undo.push({ lid, before, after:JSON.parse(JSON.stringify(changes)) }); if(S.undo.length > 100) S.undo.shift(); S.redo.length = 0; }
  // show it straight away (the database echo follows)
  const L = layoutsOf(S.pid)[lid];
  if(L && !S.denied[S.pid]){ L.at = paths[lid + "/at"]; L.items = L.items || {}; Object.keys(changes).forEach((id) => { if(changes[id] == null) delete L.items[id]; else L.items[id] = JSON.parse(JSON.stringify(changes[id])); }); }
  write(paths); draw(true);
}
function stepUndo(back){
  const from = back ? S.undo : S.redo, to = back ? S.redo : S.undo, e = from.pop(); if(!e) return;
  to.push(e);
  if(e.lid !== curLid()){ S.lid[S.pid] = e.lid; }
  commit(back ? e.before : e.after, true);
}
const nextZ = () => { const it = curItems(); return Object.keys(it).reduce((a, k) => Math.max(a, (it[k] && it[k].z) || 0), 0) + 1; };

// ---------- layout list actions ----------
async function newLayout(){
  const hub = H(), Ls = layoutsOf(S.pid), n = orderedIds(Ls).length + 1;
  const name = await hub.prompt("New layout", "Name", "Layout " + n); if(!name) return;
  const id = uid(), order = Date.now();
  await write({ [id]:{ name:name.slice(0, 60), at:order, by:(hub.me && hub.me()) || "", order } });
  if(!S.denied[S.pid]){ const p = hub.project(S.pid); if(p){ p.layouts = p.layouts || {}; if(!p.layouts[id]) p.layouts[id] = { name, at:order, order }; } }
  S.lid[S.pid] = id; lsSet("Camp_LAYOUTS_LAST_" + S.pid, id); S.sel = []; S.undo = []; S.redo = []; S.sig = ""; S.listSig = ""; draw(true);
}
async function renameLayout(lid){
  const L = layoutsOf(S.pid)[lid]; if(!L) return;
  const name = await H().prompt("Rename layout", "Name", L.name || ""); if(!name) return;
  write({ [lid + "/name"]:name.slice(0, 60) }); L.name = name; S.listSig = ""; draw(true);
}
async function dupLayout(lid){
  const L = layoutsOf(S.pid)[lid]; if(!L) return;
  const id = uid(), items = {}; Object.keys(L.items || {}).forEach((k) => { items[uid()] = L.items[k]; });
  await write({ [id]:{ name:((L.name || "Layout") + " copy").slice(0, 60), at:Date.now(), order:Date.now(), items } });
  S.lid[S.pid] = id; S.listSig = ""; S.sig = ""; draw(true);
}
async function delLayout(lid){
  const L = layoutsOf(S.pid)[lid]; if(!L) return;
  const ok = await H().confirm("Delete “" + (L.name || "Layout") + "”?", "It's removed for everyone in this project. This can't be undone.", "Delete", true); if(!ok) return;
  await write({ [lid]:null });
  const p = H().project(S.pid); if(p && p.layouts && !S.denied[S.pid]) delete p.layouts[lid];
  if(S.lid[S.pid] === lid) S.lid[S.pid] = null;
  S.sel = []; S.listSig = ""; S.sig = ""; draw(true);
}

// ---------- screen ----------
const css = `
#layoutsPane{ flex:1; min-height:0; display:flex; }
.lyWrap{ display:flex; flex:1; min-height:420px; border:1px solid var(--uiBorder); border-radius:12px; overflow:hidden; background:#151515; }
.lyList{ width:200px; flex:none; display:flex; flex-direction:column; border-right:1px solid var(--uiBorder); background:#181818; }
.lyListHd{ display:flex; align-items:center; justify-content:space-between; padding:10px 10px 8px 12px; font-weight:700; font-size:13px; }
.lyListHd button{ height:28px; padding:0 10px; border-radius:8px; border:1px solid var(--uiBorder); background:rgba(255,255,255,.05); color:var(--uiText); cursor:pointer; font:inherit; font-size:12px; font-weight:600; }
.lyItems{ flex:1; overflow:auto; padding:0 8px 10px; display:flex; flex-direction:column; gap:8px; }
.lyCard{ position:relative; border:1px solid var(--uiBorder); border-radius:9px; background:#1d1d1d; cursor:pointer; padding:0; text-align:left; color:var(--uiText); font:inherit; overflow:hidden; }
.lyCard.on{ border-color:#7fb6ff; box-shadow:0 0 0 1px #7fb6ff; }
.lyCard svg{ display:block; width:100%; height:86px; background:#1b1b1b; pointer-events:none; }
.lyCard b{ display:block; padding:6px 30px 7px 9px; font-size:12px; font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.lyCard .lyMore{ position:absolute; right:4px; bottom:3px; width:24px; height:24px; border:0; border-radius:6px; background:none; color:var(--uiMuted); cursor:pointer; font-size:15px; }
.lyCard .lyMore:hover{ background:rgba(255,255,255,.08); color:var(--uiText); }
.lyMain{ flex:1; min-width:0; display:flex; flex-direction:column; position:relative; }
.lyBar{ display:flex; flex-wrap:wrap; align-items:center; gap:6px; padding:7px 8px; border-bottom:1px solid var(--uiBorder); background:#1a1a1a; }
.lyGrp{ display:inline-flex; align-items:center; gap:2px; padding:2px; border:1px solid var(--uiBorder); border-radius:9px; }
.lyBtn{ height:30px; min-width:30px; padding:0 7px; border:0; border-radius:7px; background:none; color:var(--uiMuted); cursor:pointer; font:inherit; font-size:12px; font-weight:600; display:inline-flex; align-items:center; justify-content:center; gap:5px; }
.lyBtn svg{ width:17px; height:17px; }
.lyBtn:hover:not(:disabled){ color:var(--uiText); background:rgba(255,255,255,.07); }
.lyBtn.on{ background:#ececf0; color:#111; }
.lyBtn:disabled{ opacity:.3; cursor:default; }
.lySw{ width:20px; height:20px; border-radius:50%; border:2px solid transparent; cursor:pointer; padding:0; }
.lySw.on{ border-color:#fff; box-shadow:0 0 0 1px #000 inset; }
.lyWd{ width:30px; height:30px; border:0; background:none; border-radius:7px; cursor:pointer; display:inline-flex; align-items:center; justify-content:center; }
.lyWd i{ display:block; width:16px; border-radius:4px; background:var(--uiMuted); }
.lyWd.on{ background:rgba(255,255,255,.12); } .lyWd.on i{ background:#fff; }
.lySp{ flex:1; }
.lyZoom{ font-size:11.5px; color:var(--uiMuted); min-width:42px; text-align:center; font-variant-numeric:tabular-nums; }
.lyStage{ position:relative; flex:1; min-height:0; overflow:hidden; touch-action:none; outline:none; }
.lySvg{ position:absolute; inset:0; width:100%; height:100%; display:block; user-select:none; -webkit-user-select:none; }
.lyStage[data-tool=hand] .lySvg, .lyStage.space .lySvg{ cursor:grab; }
.lyStage.panning .lySvg{ cursor:grabbing; }
.lyStage[data-tool=pen] .lySvg, .lyStage[data-tool=rect] .lySvg, .lyStage[data-tool=ellipse] .lySvg, .lyStage[data-tool=line] .lySvg, .lyStage[data-tool=arrow] .lySvg{ cursor:crosshair; }
.lyStage[data-tool=text] .lySvg, .lyStage[data-tool=note] .lySvg{ cursor:text; }
.lyTxt{ width:100%; height:100%; white-space:pre-wrap; word-wrap:break-word; line-height:1.25; font-family:Inter,system-ui,sans-serif; font-weight:500; overflow:hidden; }
.lyTxt.note{ color:#222; padding:10px 11px; box-sizing:border-box; }
.lyLink{ display:flex; flex-direction:column; justify-content:center; height:100%; padding-left:8px; font-family:Inter,system-ui,sans-serif; color:#eee; overflow:hidden; }
.lyLink b{ font-size:13px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.lyLink span{ font-size:11px; color:#999; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.lyLbl{ font:600 12px Inter,system-ui,sans-serif; fill:#ddd; paint-order:stroke; stroke:#151515; stroke-width:3px; }
.lyEdit{ position:absolute; z-index:5; border:1px dashed #7fb6ff; background:rgba(20,20,20,.6); color:#fff; resize:none; outline:none; padding:0; margin:0; font-family:Inter,system-ui,sans-serif; font-weight:500; line-height:1.25; overflow:hidden; }
.lyEdit.note{ background:transparent; color:#222; padding:10px 11px; box-sizing:border-box; }
.lyKit{ position:absolute; z-index:6; top:48px; right:8px; width:280px; max-height:calc(100% - 60px); overflow:auto; background:#202020; border:1px solid var(--uiBorder); border-radius:11px; box-shadow:0 14px 34px rgba(0,0,0,.5); padding:8px 10px 10px; }
.lyKit h5{ margin:8px 2px 6px; font-size:10.5px; letter-spacing:.06em; text-transform:uppercase; color:var(--uiMuted); }
.lyKitG{ display:grid; grid-template-columns:repeat(4, 1fr); gap:5px; }
.lyKitG button{ display:flex; flex-direction:column; align-items:center; gap:3px; padding:6px 2px; border:1px solid transparent; border-radius:8px; background:rgba(255,255,255,.03); color:var(--uiMuted); font:inherit; font-size:10px; cursor:grab; line-height:1.15; text-align:center; }
.lyKitG button:hover{ border-color:var(--uiBorder); color:var(--uiText); }
.lyProps{ position:absolute; z-index:6; left:8px; bottom:8px; display:flex; flex-wrap:wrap; align-items:center; gap:6px; padding:6px 8px; background:#202020; border:1px solid var(--uiBorder); border-radius:10px; box-shadow:0 10px 26px rgba(0,0,0,.45); font-size:12px; color:var(--uiMuted); }
.lyProps input{ height:28px; width:150px; border-radius:7px; border:1px solid var(--uiBorder); background:#171717; color:var(--uiText); padding:0 8px; font:inherit; }
.lyProps[hidden], .lyKit[hidden]{ display:none; }
.lyEmpty{ position:absolute; inset:0; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:10px; color:var(--uiMuted); text-align:center; padding:20px; }
.lyEmpty b{ color:var(--uiText); font-size:15px; }
.lyHint{ position:absolute; right:10px; bottom:8px; font-size:11px; color:rgba(255,255,255,.3); pointer-events:none; }
@media (max-width:760px){
  .lyWrap{ flex-direction:column; }
  .lyList{ width:auto; border-right:0; border-bottom:1px solid var(--uiBorder); }
  .lyItems{ flex-direction:row; overflow-x:auto; padding-bottom:8px; }
  .lyCard{ flex:0 0 130px; } .lyCard svg{ height:60px; }
  .lyHint{ display:none; }
}`;
const IC = {
  select:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 3l14 8-6 2-3 6z"/></svg>`,
  hand:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 11V5a1.5 1.5 0 0 1 3 0v5M11 10V4a1.5 1.5 0 0 1 3 0v6M14 10V5.5a1.5 1.5 0 0 1 3 0V14a6 6 0 0 1-6 6h-1a6 6 0 0 1-5-2.7L3 14a1.5 1.5 0 0 1 2.4-1.8L8 15"/></svg>`,
  pen:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 21c3-1 5-3 7-6l8-8a2 2 0 0 0-3-3l-8 8c-3 2-5 4-6 7z"/></svg>`,
  rect:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="6" width="16" height="12" rx="1.5"/></svg>`,
  ellipse:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><ellipse cx="12" cy="12" rx="8.5" ry="6.5"/></svg>`,
  line:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 19L19 5"/></svg>`,
  arrow:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 19L19 5M10 5h9v9"/></svg>`,
  text:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 6V4h14v2M12 4v16M9 20h6"/></svg>`,
  note:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 4h14v10l-6 6H5z"/><path d="M13 20v-6h6"/></svg>`,
  img:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="M21 16l-5-5-8 8"/></svg>`,
  link:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/></svg>`,
  kit:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="9" cy="14" r="4"/><path d="M6 10L4 5M12 10l2-5M15 14h6M17 11l4-2M17 17l4 2"/></svg>`,
  undo:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 14L4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-4"/></svg>`,
  redo:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 14l5-5-5-5"/><path d="M20 9H9a5 5 0 0 0 0 10h4"/></svg>`,
  grid:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 9h16M4 15h16M9 4v16M15 4v16"/></svg>`,
  dl:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg>`,
  fit:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>`
};
const TOOLS = [["select", "Select (V)"], ["hand", "Pan (H, or hold Space)"], ["pen", "Pen (P)"], ["rect", "Rectangle (R)"], ["ellipse", "Ellipse (O)"], ["line", "Line (L)"], ["arrow", "Arrow (A)"], ["text", "Text (T)"], ["note", "Sticky note (N)"]];
const KEYS = { v:"select", h:"hand", p:"pen", r:"rect", o:"ellipse", l:"line", a:"arrow", t:"text", n:"note" };

let EL = null;   // { pane, list, bar, stage, svg, world, items, over, kit, props, edit, file }
function mount(){
  const pane = document.getElementById("layoutsPane"); if(!pane) return false;
  if(!document.getElementById("lyCss")){ const st = document.createElement("style"); st.id = "lyCss"; st.textContent = css; document.head.appendChild(st); }
  pane.innerHTML = `<div class="lyWrap">
    <aside class="lyList"><div class="lyListHd"><span>Layouts</span><button type="button" data-ly="new">＋ New</button></div><div class="lyItems"></div></aside>
    <div class="lyMain"><div class="lyBar"></div>
      <div class="lyStage" tabindex="0"><svg class="lySvg" xmlns="http://www.w3.org/2000/svg">${DEFS}<rect class="lyBg" x="-100000" y="-100000" width="200000" height="200000" fill="url(#lyDots)"/><g class="lyWorld"><g class="lyItemsG"></g><g class="lyOver"></g></g></svg>
        <div class="lyHint">Scroll to pan · Ctrl/⌘ + scroll to zoom · Paste images or links</div></div>
      <div class="lyKit" hidden></div><div class="lyProps" hidden></div>
      <input type="file" accept="image/*" multiple hidden class="lyFile"></div></div>`;
  EL = { pane, list:pane.querySelector(".lyItems"), bar:pane.querySelector(".lyBar"), stage:pane.querySelector(".lyStage"), svg:pane.querySelector(".lySvg"),
    world:pane.querySelector(".lyWorld"), items:pane.querySelector(".lyItemsG"), over:pane.querySelector(".lyOver"), kit:pane.querySelector(".lyKit"), props:pane.querySelector(".lyProps"), file:pane.querySelector(".lyFile") };
  wire(); S.mounted = S.pid; S.sig = ""; S.listSig = "";
  fitHeight();
  return true;
}
function fitHeight(){
  if(!EL) return;
  const top = EL.pane.getBoundingClientRect().top;
  EL.pane.querySelector(".lyWrap").style.height = Math.max(420, window.innerHeight - Math.max(0, top) - 16) + "px";
}

// ---------- drawing ----------
function draw(force){
  if(!EL) return;
  const Ls = layoutsOf(S.pid), ids = orderedIds(Ls), lid = curLid(), edit = canEdit();
  // the list
  const lsig = JSON.stringify(ids.map((k) => [k, Ls[k].name, Ls[k].at])) + lid;
  if(force || lsig !== S.listSig){
    S.listSig = lsig;
    EL.list.innerHTML = ids.map((k) => `<div class="lyCard${k === lid ? " on" : ""}" data-lid="${esc(k)}" role="button" tabindex="0">${thumbSvg(Ls[k])}<b>${esc(Ls[k].name || "Layout")}</b>${edit ? `<button type="button" class="lyMore" data-lymore="${esc(k)}" aria-label="More for ${esc(Ls[k].name || "layout")}">⋯</button>` : ""}</div>`).join("")
      || `<div style="font-size:12px;color:var(--uiMuted);padding:4px">No layouts yet.</div>`;
    EL.pane.querySelector("[data-ly=new]").hidden = !edit;
  }
  drawBar();
  EL.stage.dataset.tool = edit ? S.tool : "hand";
  const old = EL.stage.querySelector(".lyEmpty"); if(old) old.remove();
  if(!lid){
    EL.items.innerHTML = ""; EL.over.innerHTML = ""; S.sig = "";
    const e = document.createElement("div"); e.className = "lyEmpty";
    e.innerHTML = `<b>Sketch it out</b><span>Floor plans, lighting plans, mood and reference boards, rough ideas.</span>${edit ? `<button type="button" class="btn primary" data-ly="new">＋ New layout</button>` : `<span>Nobody has made one yet.</span>`}`;
    EL.stage.appendChild(e); return;
  }
  const items = curItems(), sig = JSON.stringify(items);
  if(force || sig !== S.sig){
    S.sig = sig;
    if(!(S.drag && S.drag.live)) EL.items.innerHTML = sortItems(items).map((k) => itemSvg(items[k], k)).join("");
    S.sel = S.sel.filter((k) => items[k]);
  }
  setView(); drawOver(); drawProps();
}
function setView(){ const v = viewOf(curLid()); EL.world.setAttribute("transform", `matrix(${v.z} 0 0 ${v.z} ${-v.x * v.z} ${-v.y * v.z})`); const bg = EL.svg.querySelector(".lyBg"); if(bg) bg.setAttribute("transform", `matrix(${v.z} 0 0 ${v.z} ${-v.x * v.z} ${-v.y * v.z})`); const zl = EL.bar.querySelector(".lyZoom"); if(zl) zl.textContent = Math.round(v.z * 100) + "%"; }
function drawBar(){
  const edit = canEdit(), lid = curLid();
  const tools = edit ? TOOLS : [["hand", "Pan"]];
  const ink = S.tool === "note" ? NOTES : INKS, cur = S.tool === "note" ? S.note : S.ink;
  const bsig = [edit, lid, S.tool, S.ink, S.note, S.sw, S.snap, S.kitOpen, S.undo.length, S.redo.length].join("|");
  if(EL.bar.dataset.sig === bsig) return; EL.bar.dataset.sig = bsig;
  EL.bar.innerHTML = `<div class="lyGrp">${tools.map(([t, n]) => `<button type="button" class="lyBtn${S.tool === t || (!edit && t === "hand") ? " on" : ""}" data-tool="${t}" title="${n}" aria-label="${n}">${IC[t]}</button>`).join("")}</div>`
    + (edit ? `<div class="lyGrp"><button type="button" class="lyBtn${S.kitOpen ? " on" : ""}" data-ly="kit" title="Lighting &amp; set kit">${IC.kit}Kit</button><button type="button" class="lyBtn" data-ly="img" title="Add pictures">${IC.img}</button><button type="button" class="lyBtn" data-ly="link" title="Add a link or video">${IC.link}</button></div>
      <div class="lyGrp" style="padding:2px 6px;gap:5px">${ink.map((c) => `<button type="button" class="lySw${c === cur ? " on" : ""}" data-ink="${c}" style="background:${c}" aria-label="Colour ${c}"></button>`).join("")}</div>
      <div class="lyGrp">${WIDTHS.map((w) => `<button type="button" class="lyWd${S.sw === w ? " on" : ""}" data-sw="${w}" aria-label="Line ${w}"><i style="height:${w}px"></i></button>`).join("")}</div>
      <div class="lyGrp"><button type="button" class="lyBtn" data-ly="undo" title="Undo (Ctrl+Z)"${S.undo.length ? "" : " disabled"}>${IC.undo}</button><button type="button" class="lyBtn" data-ly="redo" title="Redo (Ctrl+Shift+Z)"${S.redo.length ? "" : " disabled"}>${IC.redo}</button></div>` : "")
    + `<span class="lySp"></span><div class="lyGrp">${edit ? `<button type="button" class="lyBtn${S.snap ? " on" : ""}" data-ly="snap" title="Snap to grid">${IC.grid}</button>` : ""}<button type="button" class="lyBtn" data-ly="zout" title="Zoom out">−</button><span class="lyZoom"></span><button type="button" class="lyBtn" data-ly="zin" title="Zoom in">＋</button><button type="button" class="lyBtn" data-ly="fit" title="Fit everything">${IC.fit}</button></div><div class="lyGrp"><button type="button" class="lyBtn" data-ly="png" title="Save as PNG (the selection, or everything)">${IC.dl}PNG</button></div>`;
  if(!lid) EL.bar.querySelectorAll("button").forEach((b) => { b.disabled = true; });
  EL.kit.hidden = !(S.kitOpen && edit && lid);
  if(!EL.kit.hidden && !EL.kit.dataset.built){
    EL.kit.dataset.built = "1";
    EL.kit.innerHTML = KIT_GROUPS.map((g) => `<h5>${g}</h5><div class="lyKitG">${Object.keys(KIT).filter((k) => KIT[k].g === g).map((k) => `<button type="button" draggable="true" data-kit="${k}" title="Click to add, or drag onto the layout">${KIT_ICON(k)}<span>${KIT[k].n}</span></button>`).join("")}</div>`).join("");
  }
  setView();
}
// selection box, handles
function drawOver(){
  const items = curItems(), v = viewOf(curLid()), s = 1 / v.z;
  if(!S.sel.length || !canEdit()){ EL.over.innerHTML = ""; return; }
  if(S.sel.length === 1){
    const it = items[S.sel[0]]; if(!it){ EL.over.innerHTML = ""; return; }
    const w = it.w || 1, h = it.h || 1, cx = it.x + w / 2, cy = it.y + h / 2, hs = 9 * s, line = it.t === "line" || it.t === "arrow";
    let m = `<g transform="rotate(${safeNum(it.r, 0)} ${cx} ${cy})"><rect x="${it.x - 4 * s}" y="${it.y - 4 * s}" width="${w + 8 * s}" height="${h + 8 * s}" fill="none" stroke="#7fb6ff" stroke-width="${1.2 * s}" stroke-dasharray="${5 * s} ${4 * s}" pointer-events="none"/>`;
    if(line){ const p = ptsOf(it); [[0, p[0]], [1, p[p.length - 1]]].forEach(([i, q]) => { m += `<circle data-h="end${i}" cx="${it.x + q[0]}" cy="${it.y + q[1]}" r="${6 * s}" fill="#fff" stroke="#7fb6ff" stroke-width="${1.5 * s}" style="cursor:move"/>`; }); }
    else {
      [["nw", it.x, it.y], ["ne", it.x + w, it.y], ["sw", it.x, it.y + h], ["se", it.x + w, it.y + h]].forEach(([k, x, y]) => { m += `<rect data-h="${k}" x="${x - hs / 2}" y="${y - hs / 2}" width="${hs}" height="${hs}" rx="${2 * s}" fill="#fff" stroke="#7fb6ff" stroke-width="${1.5 * s}" style="cursor:${k === "nw" || k === "se" ? "nwse" : "nesw"}-resize"/>`; });
      m += `<path d="M${cx} ${it.y - 4 * s} L${cx} ${it.y - 26 * s}" stroke="#7fb6ff" stroke-width="${1.2 * s}" pointer-events="none"/><circle data-h="rot" cx="${cx}" cy="${it.y - 30 * s}" r="${6 * s}" fill="#7fb6ff" stroke="#fff" stroke-width="${1.5 * s}" style="cursor:grab"/>`;
    }
    EL.over.innerHTML = m + "</g>";
  } else {
    const b = bboxOf(items, S.sel); if(!b){ EL.over.innerHTML = ""; return; }
    EL.over.innerHTML = `<rect x="${b.x - 5 * s}" y="${b.y - 5 * s}" width="${b.w + 10 * s}" height="${b.h + 10 * s}" fill="none" stroke="#7fb6ff" stroke-width="${1.2 * s}" stroke-dasharray="${5 * s} ${4 * s}" pointer-events="none"/>`;
  }
}
// a small bar for the selected item: label (kit), link, layer order, delete
function drawProps(){
  const items = curItems(), one = S.sel.length === 1 ? items[S.sel[0]] : null;
  if(!S.sel.length || !canEdit() || S.drag){ EL.props.hidden = true; return; }
  const key = S.sel.join(",") + "|" + (one ? one.t + (one.lbl || "") + (one.url || "") : "");
  if(!EL.props.hidden && EL.props.dataset.key === key) return;
  EL.props.dataset.key = key; EL.props.hidden = false;
  EL.props.innerHTML = (one && one.t === "kit" ? `<span>${esc((KIT[one.k] || {}).n || "Piece")}</span><input type="text" data-prop="lbl" maxlength="40" placeholder="Label (e.g. Key, 2K, Cam A)" value="${esc(one.lbl || "")}">` : "")
    + (one && one.t === "link" ? `<input type="text" data-prop="text" maxlength="80" placeholder="Title" value="${esc(one.text || "")}"><button type="button" class="lyBtn" data-ly="open">Open ↗</button>` : "")
    + `<button type="button" class="lyBtn" data-ly="front" title="Bring to front (])">Front</button><button type="button" class="lyBtn" data-ly="back" title="Send to back ([)">Back</button><button type="button" class="lyBtn" data-ly="dup" title="Duplicate (Ctrl+D)">Duplicate</button><button type="button" class="lyBtn" data-ly="del" title="Delete (Del)">Delete</button>`;
}

// ---------- coordinates ----------
function toWorld(e){ const r = EL.svg.getBoundingClientRect(), v = viewOf(curLid()); return [ (e.clientX - r.left) / v.z + v.x, (e.clientY - r.top) / v.z + v.y ]; }
const snapV = (v) => S.snap ? Math.round(v / GRID) * GRID : v;
function zoomAt(f, cx, cy){
  const v = viewOf(curLid()), r = EL.svg.getBoundingClientRect(), px = cx == null ? r.width / 2 : cx - r.left, py = cy == null ? r.height / 2 : cy - r.top;
  const wx = px / v.z + v.x, wy = py / v.z + v.y; v.z = clamp(v.z * f, 0.1, 6); v.x = wx - px / v.z; v.y = wy - py / v.z; setView(); drawOver(); syncEdit();
}
function fitAll(){
  const items = curItems(), b = bboxOf(items), v = viewOf(curLid()), r = EL.svg.getBoundingClientRect();
  if(!b || !r.width){ v.x = -80; v.y = -60; v.z = 1; setView(); drawOver(); return; }
  const pad = 60; v.z = clamp(Math.min((r.width - pad * 2) / Math.max(b.w, 1), (r.height - pad * 2) / Math.max(b.h, 1)), 0.1, 2);
  v.x = b.x + b.w / 2 - r.width / 2 / v.z; v.y = b.y + b.h / 2 - r.height / 2 / v.z; setView(); drawOver();
}
const centre = () => { const r = EL.svg.getBoundingClientRect(), v = viewOf(curLid()); return [v.x + r.width / 2 / v.z, v.y + r.height / 2 / v.z]; };

// ---------- adding things ----------
function addKit(k, at){
  const K = KIT[k]; if(!K) return;
  const [cx, cy] = at || centre(), id = uid();
  commit({ [id]:{ t:"kit", k, x:r1(snapV(cx - K.w / 2)), y:r1(snapV(cy - K.h / 2)), w:K.w, h:K.h, r:0, z:nextZ(), c:"#e8e8e8", lbl:"" } });
  S.sel = [id]; S.tool = "select"; draw();
}
function readImage(file){
  return new Promise((res) => {
    const fr = new FileReader(); fr.onerror = () => res(null);
    fr.onload = () => { const im = new Image(); im.onerror = () => res(null); im.onload = () => {
      const MAX = 1200, k = Math.min(1, MAX / Math.max(im.naturalWidth, im.naturalHeight)), w = Math.max(1, Math.round(im.naturalWidth * k)), h = Math.max(1, Math.round(im.naturalHeight * k));
      const c = document.createElement("canvas"); c.width = w; c.height = h; const x = c.getContext("2d"); x.fillStyle = "#fff"; x.fillRect(0, 0, w, h); x.drawImage(im, 0, 0, w, h);
      let q = 0.82, src = c.toDataURL("image/jpeg", q); while(src.length > 350000 && q > 0.4){ q -= 0.12; src = c.toDataURL("image/jpeg", q); }
      res({ src, w, h }); }; im.src = fr.result; };
    fr.readAsDataURL(file);
  });
}
const driveSrc = (id) => "https://drive.google.com/thumbnail?id=" + id + "&sz=w1200";
async function uploadToDrive(dataUrl, name){
  try{
    const hub = H(); if(!hub || !hub.ripPost) return "";
    const r = await hub.ripPost({ action:"layoutphoto", dataUrl, name:name || "layout" });
    return r && r.ok === true && r.id && r.shared !== false ? String(r.id) : "";
  }catch(_e){ return ""; }
}
const driveCache = {};
async function driveData(id){
  if(driveCache[id]) return driveCache[id];
  const r = await H().ripPost({ action:"layoutimage", imageId:id });
  if(!r || r.ok !== true) throw new Error("no image");
  return (driveCache[id] = "data:" + r.mime + ";base64," + r.dataB64);
}
async function addImages(files, at){
  const list = Array.from(files || []).filter((f) => /^image\//.test(f.type)).slice(0, 8); if(!list.length) return;
  let [cx, cy] = at || centre(); const changes = {}, ids = []; let z = nextZ();
  for(const f of list){
    const got = await readImage(f); if(!got) continue;
    const s = Math.min(1, 420 / Math.max(got.w, got.h)), w = Math.round(got.w * s), h = Math.round(got.h * s), id = uid();
    const up = await uploadToDrive(got.src, f.name);        // in Drive when the script can keep it, else inline as before
    changes[id] = Object.assign({ t:"img", src:up ? driveSrc(up) : got.src, x:r1(cx - w / 2), y:r1(cy - h / 2), w, h, r:0, z:z++ }, up ? { did:up } : {}); ids.push(id); cx += 30; cy += 30;
  }
  if(ids.length){ commit(changes); S.sel = ids; S.tool = "select"; draw(); }
}
function addLink(url, at){
  url = String(url || "").trim(); if(!/^https?:\/\//i.test(url)) url = "https://" + url;
  const [cx, cy] = at || centre(), id = uid();
  commit({ [id]:{ t:"link", url:url.slice(0, 600), text:"", x:r1(cx - 130), y:r1(cy - 32), w:260, h:64, r:0, z:nextZ() } });
  S.sel = [id]; S.tool = "select"; draw();
}

// ---------- text editing (an overlay textarea over the item) ----------
function startEdit(id){
  const it = curItems()[id]; if(!it || !(it.t === "text" || it.t === "note")) return;
  endEdit();
  const ta = document.createElement("textarea"); ta.className = "lyEdit" + (it.t === "note" ? " note" : ""); ta.value = it.text || "";
  S.editing = { id, ta }; EL.stage.appendChild(ta); syncEdit();
  const g = EL.items.querySelector(`[data-id="${CSS.escape(id)}"]`); if(g) g.style.opacity = "0";
  ta.addEventListener("input", () => { if(it.t === "text") autoGrow(); });
  ta.addEventListener("keydown", (e) => { e.stopPropagation(); if(e.key === "Escape" || (e.key === "Enter" && (e.metaKey || e.ctrlKey))){ e.preventDefault(); endEdit(); } });
  ta.addEventListener("blur", () => endEdit());
  ta.focus(); ta.select();
}
function autoGrow(){ const E = S.editing; if(!E) return; E.ta.style.height = "auto"; E.ta.style.height = E.ta.scrollHeight + "px"; }
function syncEdit(){
  const E = S.editing; if(!E) return; const it = curItems()[E.id]; if(!it){ endEdit(); return; }
  const v = viewOf(curLid());
  Object.assign(E.ta.style, { left:((it.x - v.x) * v.z) + "px", top:((it.y - v.y) * v.z) + "px", width:(it.w * v.z) + "px", height:(it.h * v.z) + "px", fontSize:((it.fs || (it.t === "note" ? 16 : 22)) * v.z) + "px", color:it.t === "note" ? "#222" : (it.c || INKS[0]), background:it.t === "note" ? (it.c || NOTES[0]) : "" });
  if(it.t === "note") E.ta.style.padding = (10 * v.z) + "px " + (11 * v.z) + "px";
  if(it.t === "text") autoGrow();
}
function endEdit(){
  const E = S.editing; if(!E) return; S.editing = null;
  const it = curItems()[E.id], text = E.ta.value, v = viewOf(curLid());
  const hh = it && it.t === "text" ? Math.max(30, Math.ceil(E.ta.scrollHeight / v.z) + 4) : null;
  E.ta.remove();
  if(!it) return;
  if(it.t === "text" && !text.trim()){ commit({ [E.id]:null }); S.sel = []; draw(); return; }
  if(text !== (it.text || "") || (hh && Math.abs(hh - it.h) > 2)) commit({ [E.id]:Object.assign({}, it, { text:text.slice(0, 4000) }, hh ? { h:hh } : {}) });
  else draw(true);
}

// ---------- pointer ----------
const ptrs = new Map();
function wire(){
  const st = EL.stage, svg = EL.svg;
  EL.pane.addEventListener("click", (e) => {
    const b = e.target.closest("[data-ly], [data-tool], [data-ink], [data-sw], [data-lid], [data-lymore], [data-kit]"); if(!b) return;
    if(b.dataset.lymore){ e.stopPropagation(); openMore(b.dataset.lymore, b); return; }
    if(b.dataset.kit){ addKit(b.dataset.kit); return; }
    if(b.dataset.lid){ endEdit(); S.lid[S.pid] = b.dataset.lid; lsSet("Camp_LAYOUTS_LAST_" + S.pid, b.dataset.lid); S.sel = []; S.undo = []; S.redo = []; S.sig = ""; draw(true); if(!S.view[b.dataset.lid]) setTimeout(fitAll, 0); return; }
    if(b.dataset.tool){ S.tool = b.dataset.tool; S.sel = S.tool === "select" ? S.sel : []; draw(); st.focus({ preventScroll:true }); return; }
    if(b.dataset.ink){ if(S.tool === "note") S.note = b.dataset.ink; else S.ink = b.dataset.ink; recolour(b.dataset.ink); draw(); return; }
    if(b.dataset.sw){ S.sw = Number(b.dataset.sw); restroke(S.sw); draw(); return; }
    const a = b.dataset.ly;
    if(a === "new") newLayout();
    else if(a === "kit"){ S.kitOpen = !S.kitOpen; draw(); }
    else if(a === "img") EL.file.click();
    else if(a === "link") H().prompt("Add a link", "Web or video link (YouTube, Vimeo, Instagram, a site…)", "").then((u) => { if(u) addLink(u); });
    else if(a === "undo") stepUndo(true);
    else if(a === "redo") stepUndo(false);
    else if(a === "snap"){ S.snap = !S.snap; lsSet("Camp_LAYOUTS_SNAP", S.snap ? "1" : "0"); draw(); }
    else if(a === "zin") zoomAt(1.25);
    else if(a === "zout") zoomAt(0.8);
    else if(a === "fit") fitAll();
    else if(a === "png") exportPng();
    else if(a === "del") delSel();
    else if(a === "dup") dupSel();
    else if(a === "front" || a === "back") restack(a === "front");
    else if(a === "open"){ const it = curItems()[S.sel[0]]; if(it && safeUrl(it.url)) window.open(safeUrl(it.url), "_blank", "noopener"); }
  });
  EL.pane.addEventListener("keydown", (e) => { const c = e.target.closest && e.target.closest(".lyCard"); if(c && (e.key === "Enter" || e.key === " ")){ e.preventDefault(); c.click(); } });
  EL.props.addEventListener("input", (e) => {
    const t = e.target, id = S.sel[0], it = curItems()[id]; if(!it || !t.dataset.prop) return;
    clearTimeout(S.propT); const val = t.value, k = t.dataset.prop;
    S.propT = setTimeout(() => { const cur = curItems()[id]; if(cur) commit({ [id]:Object.assign({}, cur, { [k]:val.slice(0, 80) }) }); }, 450);
  });
  EL.props.addEventListener("keydown", (e) => e.stopPropagation());
  EL.file.addEventListener("change", () => { addImages(EL.file.files); EL.file.value = ""; });
  // kit: drag a piece onto the canvas
  EL.kit.addEventListener("dragstart", (e) => { const b = e.target.closest("[data-kit]"); if(b) try{ e.dataTransfer.setData("text/x-camp-kit", b.dataset.kit); e.dataTransfer.effectAllowed = "copy"; }catch(_e){} });
  st.addEventListener("dragover", (e) => { if(canEdit() && curLid()){ e.preventDefault(); } });
  st.addEventListener("drop", (e) => {
    if(!canEdit() || !curLid()) return; e.preventDefault();
    const at = toWorld(e), k = e.dataTransfer.getData("text/x-camp-kit");
    if(k) return addKit(k, at);
    if(e.dataTransfer.files && e.dataTransfer.files.length) return addImages(e.dataTransfer.files, at);
    const u = e.dataTransfer.getData("text/uri-list") || e.dataTransfer.getData("text/plain"); if(u && /^https?:\/\//i.test(u.trim())) addLink(u.trim(), at);
  });
  svg.addEventListener("dblclick", (e) => {
    const g = e.target.closest("[data-id]"); if(!g || !canEdit()){ if(g){ const it = curItems()[g.dataset.id]; if(it && safeUrl(it.url)) window.open(safeUrl(it.url), "_blank", "noopener"); } return; }
    const it = curItems()[g.dataset.id]; if(!it) return;
    if(it.t === "text" || it.t === "note"){ S.sel = [g.dataset.id]; startEdit(g.dataset.id); }
    else if(it.t === "link" && safeUrl(it.url)) window.open(safeUrl(it.url), "_blank", "noopener");
    else if(it.t === "kit"){ S.sel = [g.dataset.id]; drawProps(); const i = EL.props.querySelector("[data-prop=lbl]"); if(i) i.focus(); }
  });
  svg.addEventListener("pointerdown", down);
  svg.addEventListener("pointermove", move);
  svg.addEventListener("pointerup", up); svg.addEventListener("pointercancel", up);
  svg.addEventListener("wheel", (e) => {
    if(!curLid()) return; e.preventDefault();
    if(e.ctrlKey || e.metaKey) zoomAt(Math.exp(-e.deltaY * (e.ctrlKey && !e.metaKey && Math.abs(e.deltaY) < 50 ? 0.01 : 0.002)), e.clientX, e.clientY);
    else { const v = viewOf(curLid()), k = e.deltaMode === 1 ? 16 : 1; v.x += e.deltaX * k / v.z; v.y += e.deltaY * k / v.z; setView(); syncEdit(); }
  }, { passive:false });
  document.addEventListener("keydown", key);
  document.addEventListener("keyup", (e) => { if(e.code === "Space" && S.space){ S.space = false; if(EL) EL.stage.classList.remove("space"); } });
  document.addEventListener("paste", paste);
  window.addEventListener("resize", () => { if(visible()) fitHeight(); });
}
const visible = () => !!(EL && EL.pane.isConnected && !EL.pane.classList.contains("hidden") && EL.pane.offsetParent);
function down(e){
  if(!curLid()) return;
  if(S.editing && !e.target.closest(".lyEdit")) endEdit();
  try{ EL.svg.setPointerCapture(e.pointerId); }catch(_e){}
  ptrs.set(e.pointerId, [e.clientX, e.clientY]);
  if(ptrs.size === 2){ const [a, b] = [...ptrs.values()]; S.drag = { m:"pinch", d:Math.hypot(a[0] - b[0], a[1] - b[1]) || 1, c:[(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] }; cancelLive(); return; }
  if(ptrs.size > 2) return;
  EL.stage.focus({ preventScroll:true });
  const W = toWorld(e), edit = canEdit(), tool = edit ? S.tool : "hand";
  if(tool === "hand" || S.space || e.button === 1){ S.drag = { m:"pan", sx:e.clientX, sy:e.clientY, v0:Object.assign({}, viewOf(curLid())) }; EL.stage.classList.add("panning"); return; }
  if(e.button > 0) return;
  const items = curItems();
  if(tool === "select"){
    const h = e.target.closest("[data-h]");
    if(h && S.sel.length === 1){ const id = S.sel[0], it = items[id]; S.drag = { m:"handle", h:h.dataset.h, id, it0:JSON.parse(JSON.stringify(it)), W0:W }; return; }
    const g = e.target.closest("[data-id]");
    if(g){
      const id = g.dataset.id;
      if(e.shiftKey){ S.sel = S.sel.includes(id) ? S.sel.filter((x) => x !== id) : S.sel.concat([id]); drawOver(); drawProps(); return; }
      if(!S.sel.includes(id)) S.sel = [id];
      if(e.altKey){ dupSel(true); }
      S.drag = { m:"move", W0:W, ids:S.sel.slice(), moved:false, live:true };
      drawOver(); drawProps(); return;
    }
    S.drag = { m:"marquee", W0:W, add:e.shiftKey ? S.sel.slice() : [] }; if(!e.shiftKey) S.sel = []; drawOver(); drawProps(); return;
  }
  if(tool === "text" || tool === "note"){
    const g = e.target.closest("[data-id]"), hit = g && items[g.dataset.id];
    if(hit && (hit.t === "text" || hit.t === "note")){ S.sel = [g.dataset.id]; e.preventDefault(); setTimeout(() => startEdit(g.dataset.id), 0); return; }
    const id = uid(), it = tool === "note" ? { t:"note", x:r1(snapV(W[0])), y:r1(snapV(W[1])), w:180, h:150, r:0, z:nextZ(), c:S.note, text:"", fs:16 }
      : { t:"text", x:r1(snapV(W[0])), y:r1(snapV(W[1] - 14)), w:280, h:34, r:0, z:nextZ(), c:S.ink, text:"", fs:22 };
    commit({ [id]:it }); S.sel = [id]; e.preventDefault(); setTimeout(() => startEdit(id), 0); return;
  }
  // drawing tools
  const base = { c:S.ink, sw:S.sw, r:0, z:nextZ() };
  const ns = "http://www.w3.org/2000/svg", tmp = document.createElementNS(ns, "path");
  tmp.setAttribute("fill", "none"); tmp.setAttribute("stroke", S.ink); tmp.setAttribute("stroke-width", S.sw); tmp.setAttribute("stroke-linecap", "round"); tmp.setAttribute("stroke-linejoin", "round");
  if(tool === "rect" || tool === "ellipse") tmp.setAttribute("stroke-dasharray", "0");
  EL.over.appendChild(tmp);
  const P0 = tool === "pen" ? W : [snapV(W[0]), snapV(W[1])];
  S.drag = { m:"draw", tool, pts:[P0], tmp, base };
}
function move(e){
  if(!ptrs.has(e.pointerId)) return; ptrs.set(e.pointerId, [e.clientX, e.clientY]);
  const D = S.drag; if(!D) return;
  if(D.m === "pinch"){ if(ptrs.size < 2) return; const [a, b] = [...ptrs.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]) || 1, c = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const v = viewOf(curLid()); v.x -= (c[0] - D.c[0]) / v.z; v.y -= (c[1] - D.c[1]) / v.z; D.c = c; zoomAt(d / D.d, c[0], c[1]); D.d = d; return; }
  if(D.m === "pan"){ const v = viewOf(curLid()); v.x = D.v0.x - (e.clientX - D.sx) / v.z; v.y = D.v0.y - (e.clientY - D.sy) / v.z; setView(); syncEdit(); return; }
  const W = toWorld(e), items = curItems();
  if(D.m === "move"){
    let dx = W[0] - D.W0[0], dy = W[1] - D.W0[1];
    if(!D.moved && Math.hypot(dx, dy) * viewOf(curLid()).z < 3) return;
    D.moved = true; EL.props.hidden = true;
    if(S.snap && D.ids.length){ const a = items[D.ids[0]]; if(a){ dx = snapV(a.x + dx) - a.x; dy = snapV(a.y + dy) - a.y; } }
    D.dx = dx; D.dy = dy;
    D.ids.forEach((id) => { const g = EL.items.querySelector(`[data-id="${CSS.escape(id)}"]`); if(g) g.setAttribute("transform", `translate(${dx} ${dy})`); });
    EL.over.setAttribute("transform", `translate(${dx} ${dy})`);
    return;
  }
  if(D.m === "marquee"){
    const x = Math.min(D.W0[0], W[0]), y = Math.min(D.W0[1], W[1]), w = Math.abs(W[0] - D.W0[0]), h = Math.abs(W[1] - D.W0[1]), s = 1 / viewOf(curLid()).z;
    const hit = Object.keys(items).filter((k) => { const it = items[k]; return it.x < x + w && it.x + (it.w || 1) > x && it.y < y + h && it.y + (it.h || 1) > y; });
    S.sel = Array.from(new Set(D.add.concat(hit))); drawOver();
    EL.over.insertAdjacentHTML("beforeend", `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="rgba(127,182,255,.08)" stroke="#7fb6ff" stroke-width="${s}" pointer-events="none"/>`);
    return;
  }
  if(D.m === "handle"){ handleDrag(D, W, e); return; }
  if(D.m === "draw"){
    const P = D.tool === "pen" ? W : [snapV(W[0]), snapV(W[1])];
    if(D.tool === "pen"){ const l = D.pts[D.pts.length - 1]; if(Math.hypot(P[0] - l[0], P[1] - l[1]) * viewOf(curLid()).z < 2) return; D.pts.push(P); D.tmp.setAttribute("d", smoothPath(D.pts)); return; }
    let [x0, y0] = D.pts[0], [x1, y1] = P;
    if(e.shiftKey && (D.tool === "line" || D.tool === "arrow")){ const ang = Math.round(Math.atan2(y1 - y0, x1 - x0) / (Math.PI / 4)) * Math.PI / 4, L = Math.hypot(x1 - x0, y1 - y0); x1 = x0 + Math.cos(ang) * L; y1 = y0 + Math.sin(ang) * L; }
    if(e.shiftKey && (D.tool === "rect" || D.tool === "ellipse")){ const m = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)); x1 = x0 + Math.sign(x1 - x0 || 1) * m; y1 = y0 + Math.sign(y1 - y0 || 1) * m; }
    D.end = [x1, y1];
    if(D.tool === "line" || D.tool === "arrow") D.tmp.setAttribute("d", `M${x0} ${y0} L${x1} ${y1}`);
    else if(D.tool === "rect") D.tmp.setAttribute("d", `M${x0} ${y0} H${x1} V${y1} H${x0} Z`);
    else { const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, rx = Math.abs(x1 - x0) / 2, ry = Math.abs(y1 - y0) / 2; D.tmp.setAttribute("d", `M${cx - rx} ${cy} a${rx} ${ry} 0 1 0 ${rx * 2} 0 a${rx} ${ry} 0 1 0 ${-rx * 2} 0`); }
  }
}
function handleDrag(D, W, e){
  const it0 = D.it0, it = JSON.parse(JSON.stringify(it0));
  if(D.h === "rot"){ const cx = it0.x + it0.w / 2, cy = it0.y + it0.h / 2; let a = Math.atan2(W[1] - cy, W[0] - cx) * 180 / Math.PI + 90; if(e.shiftKey || S.snap) a = Math.round(a / 15) * 15; it.r = Math.round(((a % 360) + 360) % 360); }
  else if(D.h === "end0" || D.h === "end1"){
    const p = ptsOf(it0).map((q) => [q[0] + it0.x, q[1] + it0.y]); p[D.h === "end0" ? 0 : p.length - 1] = [snapV(W[0]), snapV(W[1])];
    Object.assign(it, fromAbs(it0.t, [p[0], p[p.length - 1]], it0));
  } else {
    // resize in the item's own frame (it may be rotated), keeping the opposite corner still
    const th = (it0.r || 0) * Math.PI / 180, cos = Math.cos(th), sin = Math.sin(th), cx = it0.x + it0.w / 2, cy = it0.y + it0.h / 2;
    const loc = (px, py) => { const dx = px - cx, dy = py - cy; return [dx * cos + dy * sin, -dx * sin + dy * cos]; };
    const [lx, ly] = loc(W[0], W[1]), sx = D.h.includes("e") ? 1 : -1, sy = D.h.includes("s") ? 1 : -1;
    const ox = -sx * it0.w / 2, oy = -sy * it0.h / 2;   // the fixed corner (local)
    let nw = Math.max(8, (lx - ox) * sx), nh = Math.max(8, (ly - oy) * sy);
    if(e.shiftKey || it0.t === "img" || (it0.t === "kit" && !["wall", "dolly", "window", "tube", "flag", "table", "sofa", "bed", "car"].includes(it0.k))){ const k = Math.max(nw / it0.w, nh / it0.h); nw = it0.w * k; nh = it0.h * k; }
    const ncx = ox + sx * nw / 2, ncy = oy + sy * nh / 2;   // new centre (local)
    const wcx = cx + ncx * cos - ncy * sin, wcy = cy + ncx * sin + ncy * cos;
    it.w = r1(nw); it.h = r1(nh); it.x = r1(wcx - nw / 2); it.y = r1(wcy - nh / 2);
    if(it0.t === "pen"){ const fx = nw / it0.w, fy = nh / it0.h; it.pts = ptsStr(ptsOf(it0).map((q) => [q[0] * fx, q[1] * fy])); }
    if(it0.t === "text" || it0.t === "note"){ if(e.shiftKey) it.fs = Math.round((it0.fs || (it0.t === "note" ? 16 : 22)) * nw / it0.w); }
  }
  D.it = it;
  const g = EL.items.querySelector(`[data-id="${CSS.escape(D.id)}"]`);
  if(g){ g.outerHTML = itemSvg(it, D.id); }
  const items = curItems(), save = items[D.id]; items[D.id] = it; drawOver(); items[D.id] = save;
}
function up(e){
  ptrs.delete(e.pointerId);
  const D = S.drag; if(!D) return;
  if(D.m === "pinch"){ if(ptrs.size < 2) S.drag = null; return; }
  if(ptrs.size) return;
  S.drag = null; EL.stage.classList.remove("panning"); EL.over.removeAttribute("transform");
  const items = curItems();
  if(D.m === "move"){
    if(D.moved && (D.dx || D.dy)){ const ch = {}; D.ids.forEach((id) => { const it = items[id]; if(it) ch[id] = Object.assign({}, it, { x:r1(it.x + D.dx), y:r1(it.y + D.dy) }); }); commit(ch); }
    else draw(true);
    return;
  }
  if(D.m === "marquee"){ drawOver(); drawProps(); return; }
  if(D.m === "handle"){ if(D.it) commit({ [D.id]:D.it }); else draw(true); return; }
  if(D.m === "draw"){
    D.tmp.remove();
    const id = uid(); let it = null;
    if(D.tool === "pen"){ if(D.pts.length < 2) D.pts.push([D.pts[0][0] + 0.5, D.pts[0][1] + 0.5]); it = fromAbs("pen", D.pts, D.base); }
    else {
      const [x0, y0] = D.pts[0], [x1, y1] = D.end || [x0, y0];
      if(D.tool === "line" || D.tool === "arrow"){ if(Math.hypot(x1 - x0, y1 - y0) < 4) return; it = fromAbs(D.tool, [[x0, y0], [x1, y1]], D.base); }
      else { let w = Math.abs(x1 - x0), h = Math.abs(y1 - y0); if(w < 4 && h < 4){ w = 120; h = D.tool === "ellipse" ? 120 : 80; } it = Object.assign({}, D.base, { t:D.tool, x:r1(Math.min(x0, x1)), y:r1(Math.min(y0, y1)), w:r1(w), h:r1(h) }); }
    }
    commit({ [id]:it });
    if(D.tool !== "pen"){ S.sel = [id]; S.tool = "select"; draw(); }
  }
}
function cancelLive(){ EL.over.removeAttribute("transform"); const t = EL.over.querySelector("path:not([data-h])"); draw(true); void t; }

// ---------- save as PNG (the whole layout, or just the selection) ----------
async function exportPng(){
  const L = layoutsOf(S.pid)[curLid()], items = curItems(), ids = S.sel.length ? S.sel : Object.keys(items), b = bboxOf(items, ids);
  if(!b){ H().toast("Nothing to save yet.", "err", 1800); return; }
  // room for light spill and labels around the pieces
  const pad = 40 + (ids.some((k) => items[k] && items[k].t === "kit") ? 140 : 0), X = b.x - pad, Y = b.y - pad, W = b.w + pad * 2, Hh = b.h + pad * 2;
  const scale = Math.min(3, Math.max(1, 4000 / Math.max(W, Hh))), cw = Math.round(W * scale), ch = Math.round(Hh * scale);
  const keep = new Set(ids), exp = {};
  for(const k of ids){ const it = items[k]; if(it && it.t === "img" && it.did){ try{ exp[k] = Object.assign({}, it, { src: await driveData(it.did) }); }catch(_e){ /* left as the Drive link */ } } }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${cw}" height="${ch}" viewBox="${X} ${Y} ${W} ${Hh}">${DEFS}<rect x="${X}" y="${Y}" width="${W}" height="${Hh}" fill="#151515"/>${sortItems(items).filter((k) => keep.has(k)).map((k) => itemSvg(exp[k] || items[k], k, true)).join("")}</svg>`;
  const url = URL.createObjectURL(new Blob([svg], { type:"image/svg+xml" }));
  try{
    const im = new Image(); await new Promise((ok, no) => { im.onload = ok; im.onerror = no; im.src = url; });
    const c = document.createElement("canvas"); c.width = cw; c.height = ch; c.getContext("2d").drawImage(im, 0, 0, cw, ch);
    const blob = await new Promise((ok) => c.toBlob(ok, "image/png"));
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = ((L && L.name) || "Layout").replace(/[\\/:*?"<>|]+/g, "-") + ".png";
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
    H().toast(S.sel.length ? "Saved the selection as a PNG." : "Saved as a PNG.", "ok", 1800);
  }catch(_e){ H().toast("Couldn't make the picture. A linked image may be blocking it.", "err", 3500); }
  finally{ URL.revokeObjectURL(url); }
}

// ---------- selection actions ----------
function delSel(){ if(!S.sel.length) return; const ch = {}; S.sel.forEach((id) => { ch[id] = null; }); S.sel = []; commit(ch); }
function dupSel(inPlace){
  const items = curItems(); if(!S.sel.length) return; const ch = {}, ids = []; let z = nextZ();
  S.sel.forEach((id) => { const it = items[id]; if(!it) return; const n = uid(); ch[n] = Object.assign({}, it, { x:r1(it.x + (inPlace ? 0 : 24)), y:r1(it.y + (inPlace ? 0 : 24)), z:z++ }); ids.push(n); });
  commit(ch); if(!inPlace) S.sel = ids; draw();
}
function restack(front){
  const items = curItems(), all = sortItems(items), ch = {};
  let z = front ? nextZ() : Math.min(0, ...all.map((k) => items[k].z || 0)) - S.sel.length;
  sortItems(items).filter((k) => S.sel.includes(k)).forEach((id) => { ch[id] = Object.assign({}, items[id], { z:z++ }); });
  commit(ch);
}
function recolour(c){ if(!S.sel.length) return; const items = curItems(), ch = {}; S.sel.forEach((id) => { const it = items[id]; if(it && it.t !== "img" && it.t !== "link") ch[id] = Object.assign({}, it, { c }); }); if(Object.keys(ch).length) commit(ch); }
function restroke(w){ if(!S.sel.length) return; const items = curItems(), ch = {}; S.sel.forEach((id) => { const it = items[id]; if(it && ["pen", "rect", "ellipse", "line", "arrow"].includes(it.t)) ch[id] = Object.assign({}, it, { sw:w }); }); if(Object.keys(ch).length) commit(ch); }

// ---------- keys & paste ----------
const typing = (e) => /^(input|textarea|select)$/i.test((e.target && e.target.tagName) || "") || (e.target && e.target.isContentEditable);
function key(e){
  if(!visible() || typing(e) || document.querySelector(".shade")) return;
  if(!curLid()) return;
  const k = e.key.toLowerCase(), mod = e.metaKey || e.ctrlKey, edit = canEdit();
  if(e.code === "Space" && !S.space){ S.space = true; EL.stage.classList.add("space"); e.preventDefault(); return; }
  if(mod && k === "z" && edit){ e.preventDefault(); stepUndo(!e.shiftKey); return; }
  if(mod && k === "y" && edit){ e.preventDefault(); stepUndo(false); return; }
  if(mod && k === "d" && edit){ e.preventDefault(); dupSel(); return; }
  if(mod && k === "a"){ e.preventDefault(); S.sel = Object.keys(curItems()); drawOver(); drawProps(); return; }
  if(mod && k === "c" && S.sel.length){ const items = curItems(); S.clip = S.sel.map((id) => items[id]).filter(Boolean).map((x) => JSON.parse(JSON.stringify(x))); return; }
  if(mod && (k === "=" || k === "+")){ e.preventDefault(); zoomAt(1.25); return; }
  if(mod && k === "-"){ e.preventDefault(); zoomAt(0.8); return; }
  if(mod && k === "0"){ e.preventDefault(); fitAll(); return; }
  if(mod) return;
  if((e.key === "Delete" || e.key === "Backspace") && edit && S.sel.length){ e.preventDefault(); delSel(); return; }
  if(e.key === "Escape"){ S.sel = []; S.kitOpen = false; draw(); return; }
  if(e.key === "Enter" && S.sel.length === 1 && edit){ const it = curItems()[S.sel[0]]; if(it && (it.t === "text" || it.t === "note")){ e.preventDefault(); startEdit(S.sel[0]); } return; }
  if(/^Arrow/.test(e.key) && edit && S.sel.length){
    e.preventDefault(); const d = e.shiftKey ? GRID : 1, dx = e.key === "ArrowLeft" ? -d : e.key === "ArrowRight" ? d : 0, dy = e.key === "ArrowUp" ? -d : e.key === "ArrowDown" ? d : 0;
    const items = curItems(), ch = {}; S.sel.forEach((id) => { const it = items[id]; if(it) ch[id] = Object.assign({}, it, { x:r1(it.x + dx), y:r1(it.y + dy) }); }); commit(ch); return;
  }
  if(e.key === "]" && edit && S.sel.length){ restack(true); return; }
  if(e.key === "[" && edit && S.sel.length){ restack(false); return; }
  if(edit && KEYS[k]){ S.tool = KEYS[k]; if(S.tool !== "select") S.sel = []; draw(); return; }
  if(edit && k === "k"){ S.kitOpen = !S.kitOpen; draw(); }
}
function paste(e){
  if(!visible() || typing(e) || !canEdit() || !curLid()) return;
  const dt = e.clipboardData; if(!dt) return;
  const files = Array.from(dt.files || []).filter((f) => /^image\//.test(f.type));
  if(files.length){ e.preventDefault(); addImages(files); return; }
  const txt = (dt.getData("text/plain") || "").trim();
  if(/^https?:\/\/\S+$/i.test(txt)){ e.preventDefault(); addLink(txt); return; }
  if(S.clip && S.clip.length){
    e.preventDefault(); const ch = {}, ids = []; let z = nextZ();
    S.clip.forEach((it) => { const n = uid(); ch[n] = Object.assign({}, it, { x:r1(it.x + 30), y:r1(it.y + 30), z:z++ }); ids.push(n); });
    S.clip = S.clip.map((it) => Object.assign({}, it, { x:it.x + 30, y:it.y + 30 }));
    commit(ch); S.sel = ids; draw(); return;
  }
  if(txt){ e.preventDefault(); const [cx, cy] = centre(), id = uid(); commit({ [id]:{ t:"text", x:r1(cx - 140), y:r1(cy - 17), w:280, h:Math.max(34, 28 * txt.split("\n").length), r:0, z:nextZ(), c:S.ink, text:txt.slice(0, 4000), fs:22 } }); S.sel = [id]; draw(); }
}

// ---------- the ⋯ menu on a layout card ----------
function openMore(lid, btn){
  document.querySelectorAll(".lyMenu").forEach((m) => m.remove());
  const m = document.createElement("div"); m.className = "lyMenu";
  const r = btn.getBoundingClientRect();
  Object.assign(m.style, { position:"fixed", zIndex:9999, left:Math.min(innerWidth - 170, r.left) + "px", top:(r.bottom + 4) + "px", background:"#232323", border:"1px solid var(--uiBorder)", borderRadius:"9px", padding:"4px", boxShadow:"0 12px 30px rgba(0,0,0,.5)", display:"flex", flexDirection:"column", minWidth:"150px" });
  m.innerHTML = [["ren", "Rename"], ["dup", "Duplicate"], ["del", "Delete"]].map(([a, n]) => `<button type="button" data-m="${a}" style="text-align:left;padding:7px 10px;border:0;background:none;color:${a === "del" ? "#ff8b83" : "var(--uiText)"};border-radius:6px;cursor:pointer;font:inherit;font-size:13px">${n}</button>`).join("");
  document.body.appendChild(m);
  const close = () => { m.remove(); document.removeEventListener("pointerdown", out, true); };
  const out = (e) => { if(!m.contains(e.target)) close(); };
  setTimeout(() => document.addEventListener("pointerdown", out, true), 0);
  m.addEventListener("click", (e) => { const b = e.target.closest("[data-m]"); if(!b) return; close(); if(b.dataset.m === "ren") renameLayout(lid); else if(b.dataset.m === "dup") dupLayout(lid); else delLayout(lid); });
}

// ---------- entry ----------
function render(pid){
  if(!pid) return;
  if(S.pid !== pid){ endEdit(); S.pid = pid; S.sel = []; S.undo = []; S.redo = []; S.sig = ""; S.listSig = ""; }
  if(!EL || !EL.pane.isConnected || S.mounted !== pid){ if(!mount()) return; }
  else fitHeight();
  if(S.drag) return;   // a drag in progress: the next change redraws
  const first = !S.view[curLid()];
  draw();
  if(first && curLid()) setTimeout(fitAll, 0);
}
window.CampLayouts = { render, _kit:KIT, _itemSvg:itemSvg };
})();
