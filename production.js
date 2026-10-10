/* production.js — the scheduling engine behind the Production panel. Pure functions, no DOM:
   the same code runs in the browser (window.CampProduction) and in the tests (node).

   The production plan stored per project (projects/<pid>/production):
     { v:1, scriptId, settings:{ start, days, perWeek, maxEighths, call }, days:[{ id, scenes:[sceneId], call, note }], updatedAt, by }
   Scenes are referenced by their permanent id (the scene heading's line id), never by number,
   so renumbering or moving scenes in the script never breaks the schedule. */
(function (root) {
"use strict";

const DEFAULTS = { start: "", days: 5, perWeek: 5, maxEighths: 40, call: "07:00" };
const MAX_DAYS = 120;

// ---------- small helpers ----------
const clampInt = (v, lo, hi, d) => { v = Math.round(Number(v)); return Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d; };
function uid(){ return "d" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

// Page lengths are whole eighths everywhere (no floating point): 35 -> "4 3/8"
function fmtEighths(n){
  n = Math.max(0, Math.round(Number(n) || 0));
  const p = Math.floor(n / 8), r = n % 8;
  if(!r) return String(p);
  const g = r % 2 ? 1 : r % 4 ? 2 : 4, frac = (r / g) + "/" + (8 / g);
  return p ? p + " " + frac : frac;
}

// ---------- dates ----------
// ISO date "YYYY-MM-DD" handled in UTC so no timezone or daylight-saving shift can move a day.
function parseISO(s){ const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || "")); if(!m) return null; const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])); return isNaN(d) ? null : d; }
function toISO(d){ return d.toISOString().slice(0, 10); }
// Shooting weeks: 5 = Mon–Fri, 6 = Mon–Sat, 7 = every day. Returns `count` dates from `start` (the start
// date itself is moved forward to the first working day if it falls on a day off).
function shootDates(start, count, perWeek){
  const d0 = parseISO(start); count = clampInt(count, 0, MAX_DAYS, 0); perWeek = clampInt(perWeek, 5, 7, 5);
  if(!d0 || !count) return new Array(count).fill("");
  const off = (dow) => perWeek === 7 ? false : perWeek === 6 ? dow === 0 : (dow === 0 || dow === 6);
  const out = [], d = new Date(d0.getTime());
  while(out.length < count){ if(!off(d.getUTCDay())) out.push(toISO(d)); d.setUTCDate(d.getUTCDate() + 1); }
  return out;
}

// The real date of every shoot day. Days run in order from the start date on working days
// (perWeek), skipping the days off in settings.off. A day with its own date (pinned) uses it, and
// the days after it carry on from there, so a break in the middle of a shoot is just a later pin.
// Mirrored in Code.gs (bgPlanDates_): keep the two the same.
function planDates(plan){
  const st = plan.settings, off = new Set(st.off || []);
  const work = (dow) => st.perWeek === 7 ? true : st.perWeek === 6 ? dow !== 0 : (dow !== 0 && dow !== 6);
  const out = []; let cur = parseISO(st.start);
  plan.days.forEach((d) => {
    const pin = parseISO(d.date);
    if(pin){ out.push(toISO(pin)); cur = new Date(pin.getTime() + 864e5); return; }
    if(!cur){ out.push(""); return; }
    let guard = 0;
    while((!work(cur.getUTCDay()) || off.has(toISO(cur))) && guard++ < 400) cur.setUTCDate(cur.getUTCDate() + 1);
    out.push(toISO(cur)); cur = new Date(cur.getTime() + 864e5);
  });
  return out;
}

// ---------- normalising what comes back from the database ----------
// Realtime Database drops empty arrays and may hand arrays back as objects; make it a clean plan.
function normalize(plan){
  plan = (plan && typeof plan === "object") ? plan : {};
  const s = Object.assign({}, DEFAULTS, plan.settings || {});
  const settings = {
    start: parseISO(s.start) ? s.start : "",
    days: clampInt(s.days, 1, MAX_DAYS, DEFAULTS.days),
    perWeek: clampInt(s.perWeek, 5, 7, DEFAULTS.perWeek),
    maxEighths: clampInt(s.maxEighths, 4, 160, DEFAULTS.maxEighths),
    call: /^\d{2}:\d{2}$/.test(s.call || "") ? s.call : DEFAULTS.call,
    off: (Array.isArray(s.off) ? s.off : (s.off && typeof s.off === "object" ? Object.values(s.off) : [])).filter((x) => parseISO(x)).sort()
  };
  const arr = (v) => Array.isArray(v) ? v : (v && typeof v === "object" ? Object.keys(v).sort((a, b) => a - b).map((k) => v[k]) : []);
  let days = arr(plan.days).map((d) => ({ id: String((d && d.id) || uid()), scenes: arr(d && d.scenes).map(String).filter(Boolean), call: String((d && d.call) || ""), note: String((d && d.note) || ""), date: parseISO(d && d.date) ? d.date : "" }));
  // the day count setting is the truth: pad with empty days. More stored days than the setting
  // (an older save) are kept and the count follows them, so no scheduled scene is ever lost.
  while(days.length < settings.days) days.push({ id: uid(), scenes: [], call: "", note: "", date: "" });
  if(days.length > settings.days) settings.days = days.length;
  // a scene can only be on one day
  const seen = new Set();
  days.forEach((d) => { d.scenes = d.scenes.filter((id) => !seen.has(id) && seen.add(id)); });
  // `known` = every scene id the plan has already seen, so a scene added to the script later is spotted as new
  const out = { v: 1, scriptId: String(plan.scriptId || ""), settings, days, known: arr(plan.known).map(String) };
  // rooms merged into one location, and keep / watch / ignore choices for script flags
  // (lists, not maps: location names can hold characters the database won't take as keys)
  out.locMerge = arr(plan.locMerge).filter((m) => m && m.from && m.to && m.from !== m.to).map((m) => ({ from: String(m.from), to: String(m.to) }));
  out.flagStatus = arr(plan.flagStatus).filter((f) => f && f.id && /^(keep|watch|ignore)$/.test(f.s)).map((f) => ({ id: String(f.id), scene: f.scene ? String(f.scene) : "", s: f.s }));
  // links to the call sheets made by the last Sync (kept as they are)
  if(plan.callsheets && typeof plan.callsheets === "object") out.callsheets = plan.callsheets;
  return out;
}

// The plan's choices in the shape breakdown.js takes: analyze(doc, analyzeOpts(plan))
function analyzeOpts(plan){
  const locs = {}, flags = {};
  (plan && plan.locMerge || []).forEach((m) => { locs[m.from] = m.to; });
  (plan && plan.flagStatus || []).forEach((f) => { flags[f.id + (f.scene ? "@" + f.scene : "")] = f.s; });
  return { locs, flags };
}

// Changing the number of shoot days. Scenes on days that are removed go back to Unscheduled
// (returned so the panel can say which ones moved). Never silently drops a scene.
function resizeDays(plan, n){
  plan = normalize(plan); n = clampInt(n, 1, MAX_DAYS, plan.settings.days);
  const moved = [];
  if(n < plan.days.length){ plan.days.slice(n).forEach((d, i) => d.scenes.forEach((id) => moved.push({ id, fromDay: n + i + 1 }))); plan.days = plan.days.slice(0, n); }
  while(plan.days.length < n) plan.days.push({ id: uid(), scenes: [], call: "", note: "" });
  plan.settings.days = n;
  return { plan, moved };
}

// ---------- the script is the source of truth ----------
// Compare the plan with the latest breakdown: scenes deleted from the script come off their day,
// new scenes are listed as Unscheduled. Returns the cleaned plan plus a "what changed" report.
function reconcile(plan, breakdown){
  plan = normalize(plan);
  const scenes = (breakdown && breakdown.scenes || []).filter((s) => s.id);
  const live = new Set(scenes.map((s) => s.id));
  const removed = [];
  plan.days.forEach((d, i) => { d.scenes = d.scenes.filter((id) => { if(live.has(id)) return true; removed.push({ id, day: i + 1 }); return false; }); });
  const placed = new Set(); plan.days.forEach((d) => d.scenes.forEach((id) => placed.add(id)));
  const unscheduled = scenes.filter((s) => !placed.has(s.id)).map((s) => s.id);
  return { plan, unscheduled, removed };
}

function sceneMap(breakdown){ const m = {}; (breakdown && breakdown.scenes || []).forEach((s) => { if(s.id) m[s.id] = s; }); return m; }

// What one shoot day adds up to (all page lengths in eighths)
function dayStats(day, byId, maxEighths){
  const sc = (day.scenes || []).map((id) => byId[id]).filter(Boolean);
  const eighths = sc.reduce((a, s) => a + (Number(s.eighths) || 0), 0);
  const uniq = (xs) => Array.from(new Set(xs));
  const locs = uniq(sc.map((s) => s.loc || "").filter(Boolean));
  const cast = uniq([].concat(...sc.map((s) => s.cast || [])));
  const dn = uniq(sc.map((s) => s.dn || "D"));
  return { scenes: sc.length, eighths, locs, cast, dn, over: eighths > maxEighths, moves: Math.max(0, locs.length - 1) };
}

// ---------- automatic scheduling ----------
// Places scenes into days the way an AD would start a stripboard: keep each location together,
// shoot its day scenes before its night scenes, then fill days in order without going over the
// page limit. Scenes already on a day stay where they are unless `all` is true.
function autoSchedule(plan, breakdown, opts){
  opts = opts || {};
  plan = normalize(plan);
  const byId = sceneMap(breakdown), max = plan.settings.maxEighths;
  if(opts.all) plan.days.forEach((d) => { d.scenes = []; });
  const placed = new Set(); plan.days.forEach((d) => d.scenes.forEach((id) => placed.add(id)));
  const todo = (breakdown && breakdown.scenes || []).filter((s) => s.id && !placed.has(s.id));
  // group by location, biggest locations first (fewest company moves); D/M before N within a location
  const groups = {};
  todo.forEach((s) => { const k = s.loc || "?"; (groups[k] = groups[k] || []).push(s); });
  const dnRank = { D: 0, M: 1, N: 2 };
  const order = Object.keys(groups).sort((a, b) => sum(groups[b]) - sum(groups[a]) || a.localeCompare(b));
  function sum(list){ return list.reduce((t, s) => t + (s.eighths || 0), 0); }
  const used = plan.days.map((d) => dayStats(d, byId, max).eighths);
  const left = [];
  order.forEach((k) => {
    groups[k].sort((a, b) => (dnRank[a.dn] || 0) - (dnRank[b.dn] || 0) || a.n - b.n).forEach((s) => {
      // prefer a day already at this location, then the earliest day with room
      let best = -1;
      for(let i = 0; i < plan.days.length; i++){
        if(used[i] + s.eighths > max) continue;
        const atLoc = plan.days[i].scenes.some((id) => byId[id] && byId[id].loc === s.loc);
        if(atLoc){ best = i; break; }
        if(best < 0) best = i;
      }
      // a single scene longer than a whole day still goes on an empty day (it'll be flagged)
      if(best < 0) best = used.findIndex((u) => u === 0);
      if(best < 0){ left.push(s.id); return; }
      plan.days[best].scenes.push(s.id); used[best] += s.eighths;
    });
  });
  return { plan, unplaced: left };
}

// Best day for one new scene: same location with room, else the lightest day with room
function suggestDay(sceneId, plan, breakdown){
  plan = normalize(plan);
  const byId = sceneMap(breakdown), s = byId[sceneId]; if(!s) return -1;
  const max = plan.settings.maxEighths, st = plan.days.map((d) => dayStats(d, byId, max));
  let best = -1;
  st.forEach((x, i) => { if(x.eighths + s.eighths <= max && x.locs.indexOf(s.loc) >= 0 && best < 0) best = i; });
  if(best >= 0) return best;
  st.forEach((x, i) => { if(x.eighths + s.eighths <= max && (best < 0 || x.eighths < st[best].eighths)) best = i; });
  return best;
}

// ---------- Day Out of Days ----------
// For each cast member: which shoot days they work. W = work, SW = start work (first day),
// WF = work finish (last day), SWF = only day, H = hold (paid days between work days).
function dood(plan, breakdown){
  plan = normalize(plan);
  const byId = sceneMap(breakdown);
  const names = (breakdown && breakdown.cast || []).map((c) => c.name);
  const rows = names.map((name) => {
    const work = plan.days.map((d) => d.scenes.some((id) => byId[id] && (byId[id].cast || []).indexOf(name) >= 0));
    const first = work.indexOf(true), last = work.lastIndexOf(true);
    const marks = work.map((w, i) => {
      if(first < 0 || i < first || i > last) return "";
      if(!w) return "H";
      if(first === last) return "SWF";
      return i === first ? "SW" : i === last ? "WF" : "W";
    });
    const workDays = work.filter(Boolean).length, holdDays = marks.filter((m) => m === "H").length;
    return { name, marks, workDays, holdDays, total: workDays + holdDays, first: first + 1, last: last + 1 };
  });
  return rows;
}

// ---------- checks ----------
function validate(plan, breakdown){
  plan = normalize(plan);
  const byId = sceneMap(breakdown), max = plan.settings.maxEighths, out = [];
  const rec = reconcile(plan, breakdown);
  if(rec.unscheduled.length) out.push({ level: "warn", code: "UNSCHEDULED", text: rec.unscheduled.length + " scene" + (rec.unscheduled.length === 1 ? " isn't" : "s aren't") + " on a shoot day yet", scenes: rec.unscheduled });
  plan.days.forEach((d, i) => {
    const st = dayStats(d, byId, max);
    if(st.over) out.push({ level: "warn", code: "OVER", day: i + 1, text: "Day " + (i + 1) + " has " + fmtEighths(st.eighths) + " pages (limit " + fmtEighths(max) + ")" });
    if(st.moves >= 2) out.push({ level: "info", code: "MOVES", day: i + 1, text: "Day " + (i + 1) + " has " + st.moves + " company moves (" + st.locs.join(", ") + ")" });
  });
  // Children (under 18, or described as a child) have their own work-hour, permit and chaperone rules
  const kids = {}; (breakdown && breakdown.cast || []).forEach((c) => { if(c.minor) kids[c.name] = c; });
  if(Object.keys(kids).length) plan.days.forEach((d, i) => {
    const sc = (d.scenes || []).map((id) => byId[id]).filter(Boolean);
    const who = Array.from(new Set([].concat(...sc.map((s) => (s.cast || []).filter((n) => kids[n])))));
    if(!who.length) return;
    const night = sc.filter((s) => s.dn === "N" && (s.cast || []).some((n) => kids[n])).map((s) => s.n);
    const label = who.map((n) => n + (kids[n].age != null ? " (" + kids[n].age + ")" : " (age?)")).join(", ");
    out.push({ level: night.length ? "warn" : "info", code: "MINOR", day: i + 1, text: "Day " + (i + 1) + ": " + label + " under 18. Check permit, chaperone and work-hour limits" + (night.length ? ". Night scene" + (night.length > 1 ? "s " : " ") + night.join(", ") + " with a minor" : "") });
  });
  return out;
}

// ---------- panel logic (pure, so the plan's save/undo/sync paths are tested) ----------
// Move one scene to a day (-1 = Unscheduled) at a position (-1 = the end). Mutates and returns the plan.
function moveSceneIn(plan, id, toDay, at){
  const from = plan.days.findIndex((d) => d.scenes.indexOf(id) >= 0);
  plan.days.forEach((d) => { d.scenes = d.scenes.filter((x) => x !== id); });
  if(toDay >= 0 && plan.days[toDay]){ const list = plan.days[toDay].scenes; if(at < 0 || at > list.length) list.push(id); else list.splice(at, 0, id); }
  return { plan, from };
}
// Put new scenes on their suggested days (skips any already placed or with no room)
function placeScenes(plan, ids, breakdown){
  (ids || []).forEach((id) => { const i = suggestDay(id, plan, breakdown); if(i >= 0 && !plan.days.some((d) => d.scenes.indexOf(id) >= 0)) plan.days[i].scenes.push(id); });
  return plan;
}

// Undo history: snapshots exclude call-sheet links and save stamps, which aren't edits.
// Quick runs of edits (within 700 ms) count as one step; at most 80 steps.
const HIST_GAP = 700, HIST_MAX = 80;
function histKey(plan){ const c = Object.assign({}, plan); delete c.callsheets; delete c.updatedAt; delete c.by; return JSON.stringify(c); }
function histNew(){ return { undo: [], redo: [], at: 0 }; }
function histRemember(h, plan, now){
  const cur = histKey(plan);
  if(now - h.at > HIST_GAP && h.undo[h.undo.length - 1] !== cur){ h.undo.push(cur); if(h.undo.length > HIST_MAX) h.undo.shift(); }
  h.at = now; h.redo.length = 0;
  return h;
}
// Returns the plan to save, or null when there's nothing to step to. Call-sheet links always stay current.
function histStep(h, plan, back){
  const from = back ? h.undo : h.redo, to = back ? h.redo : h.undo;
  if(!from.length) return null;
  to.push(histKey(plan));
  const next = JSON.parse(from.pop());
  if(plan.callsheets) next.callsheets = plan.callsheets;
  h.at = 0;
  return next;
}

// What the panel does each time it draws: bring the stored plan in line with the script.
// Returns the reconciled plan, what changed, and whether it needs saving.
// `known` comes from the stored plan (not an edit still waiting to save).
function syncWithScript(plan, knownList, breakdown, scriptId){
  const rec = reconcile(plan, breakdown);
  const scenes = (breakdown && breakdown.scenes || []).filter((s) => s.id);
  const known = new Set(Array.isArray(knownList) ? knownList : []);
  const added = known.size ? scenes.filter((s) => !known.has(s.id)).map((s) => s.id) : [];
  const save = !!(rec.removed.length || added.length || !known.size || rec.plan.scriptId !== scriptId);
  if(save){ rec.plan.scriptId = scriptId; rec.plan.known = scenes.map((s) => s.id); }
  return { plan: rec.plan, unscheduled: rec.unscheduled, removed: rec.removed, added, save };
}

// Call sheets are out of date when the plan was saved more than 5 s after they were made
function callsheetsStale(raw){
  const cs = raw && raw.callsheets;
  return !!(cs && raw.updatedAt && cs.at && raw.updatedAt > cs.at + 5000);
}

const api = { DEFAULTS, MAX_DAYS, fmtEighths, parseISO, shootDates, planDates, analyzeOpts, normalize, resizeDays, reconcile, sceneMap, dayStats, autoSchedule, suggestDay, dood, validate,
  moveSceneIn, placeScenes, histKey, histNew, histRemember, histStep, syncWithScript, callsheetsStale };
if(typeof module !== "undefined" && module.exports) module.exports = api; else root.CampProduction = api;
})(typeof window !== "undefined" ? window : this);
