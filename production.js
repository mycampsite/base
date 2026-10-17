/* production.js — the scheduling engine behind the Production panel. Pure functions, no DOM:
   the same code runs in the browser (window.CampProduction) and in the tests (node).

   The production plan stored per project (projects/<pid>/production):
     { v:1, scriptId, settings:{ start, days, perWeek, maxEighths, call }, days:[{ id, scenes:[sceneId], call, note }], updatedAt, by }
   Scenes are referenced by their permanent id (the scene heading's line id), never by number,
   so renumbering or moving scenes in the script never breaks the schedule. */
(function (root) {
"use strict";

const DEFAULTS = { start: "", days: 5, perWeek: 7, maxEighths: 40, maxHours: 12, call: "07:00", nightCall: "16:00" };
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
// A place: what someone typed plus where it is (looked up once, then saved so every device agrees)
function cleanWhere(w){
  if(!w || typeof w !== "object") return null;
  const name = String(w.name || "").trim().slice(0, 80), lat = Number(w.lat), lng = Number(w.lng);
  if(!name) return null;
  const o = { name };
  if(isFinite(lat) && isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0)){ o.lat = Math.round(lat * 1e4) / 1e4; o.lng = Math.round(lng * 1e4) / 1e4; }
  if(w.tz && /^[A-Za-z_]+(\/[A-Za-z0-9_+\-]+)*$/.test(String(w.tz))) o.tz = String(w.tz).slice(0, 60);
  if(w.label) o.label = String(w.label).slice(0, 120);
  return o;
}
// Shooting status of a scene. "Scheduled" is the default and isn't stored.
const STATUSES = ["Scheduled", "Shot", "Part shot", "Pick-up", "Moved", "Omitted"];
function statusOf(plan, id){ const x = ((plan && plan.status) || []).find((y) => y.id === id); return x ? x.s : "Scheduled"; }
function setStatus(plan, id, s){ plan.status = (plan.status || []).filter((y) => y.id !== id); if(STATUSES.indexOf(s) > 0) plan.status.push({ id: String(id), s }); return plan; }
// The day's place: its own, else the shoot's base location
function whereOf(plan, i){ const d = plan && plan.days && plan.days[i]; return (d && d.where) || (plan && plan.settings && plan.settings.where) || null; }
// Sunrise and sunset (UTC milliseconds) for a date at a place, by the standard sunrise equation (to about a minute).
// null when the sun doesn't rise or set that day (polar day or night).
function sunTimes(iso, lat, lng){
  const d = parseISO(iso); lat = Number(lat); lng = Number(lng);
  if(!d || !isFinite(lat) || !isFinite(lng)) return null;
  const rad = Math.PI / 180, ms = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 12);
  const n = Math.round(ms / 86400000 + 2440587.5 - 2451545.0 + 0.0008);
  const Js = n - lng / 360;
  const M = ((357.5291 + 0.98560028 * Js) % 360 + 360) % 360;
  const C = 1.9148 * Math.sin(M * rad) + 0.02 * Math.sin(2 * M * rad) + 0.0003 * Math.sin(3 * M * rad);
  const L = ((M + C + 180 + 102.9372) % 360 + 360) % 360;
  const Jt = 2451545.0 + Js + 0.0053 * Math.sin(M * rad) - 0.0069 * Math.sin(2 * L * rad);
  const dec = Math.asin(Math.sin(L * rad) * Math.sin(23.4397 * rad));
  const cw = (Math.sin(-0.833 * rad) - Math.sin(lat * rad) * Math.sin(dec)) / (Math.cos(lat * rad) * Math.cos(dec));
  if(cw < -1 || cw > 1) return null;
  const w = Math.acos(cw) / rad;
  const toMs = (J) => Math.round((J - 2440587.5) * 86400000);
  return { rise: toMs(Jt - w / 360), set: toMs(Jt + w / 360) };
}
// "HH:MM" at that place (its time zone when known, else this device's)
function hmIn(msUtc, tz){
  try{ const f = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: tz || undefined }); const p = f.formatToParts(new Date(msUtc)); const h = p.find((x) => x.type === "hour").value, m = p.find((x) => x.type === "minute").value; return (h === "24" ? "00" : h) + ":" + m; }
  catch(_e){ const dt = new Date(msUtc); return String(dt.getHours()).padStart(2, "0") + ":" + String(dt.getMinutes()).padStart(2, "0"); }
}
// ---------- availability: days a cast member or a place can't be used ----------
function cleanAvail(v){
  const arr = Array.isArray(v) ? v : (v && typeof v === "object" ? Object.keys(v).map((k) => v[k]) : []);
  const out = [];
  arr.forEach((x) => {
    if(!x || (x.k !== "cast" && x.k !== "loc") || !String(x.name || "").trim()) return;
    const offs = (Array.isArray(x.off) ? x.off : (x.off && typeof x.off === "object" ? Object.keys(x.off).map((k) => x.off[k]) : [])).map(String).filter((d) => parseISO(d));
    const off = Array.from(new Set(offs)).sort().slice(0, 366);
    if(!off.length) return;
    const name = String(x.name).trim().slice(0, 80), have = out.find((y) => y.k === x.k && y.name === name);
    if(have) have.off = Array.from(new Set(have.off.concat(off))).sort(); else out.push({ k: x.k, name, off });
  });
  return out;
}
function availOff(plan, k, name){ const x = ((plan && plan.avail) || []).find((y) => y.k === k && y.name === name); return x ? x.off : []; }
// Add or remove days off (a list of dates). Mutates and returns the plan.
function setAvail(plan, k, name, dates, on){
  plan.avail = cleanAvail(plan.avail);
  let x = plan.avail.find((y) => y.k === k && y.name === name);
  if(!x){ if(!on) return plan; x = { k, name, off: [] }; plan.avail.push(x); }
  const set = new Set(x.off); (dates || []).forEach((d) => { if(!parseISO(d)) return; if(on) set.add(d); else set.delete(d); });
  x.off = Array.from(set).sort();
  plan.avail = plan.avail.filter((y) => y.off.length);
  return plan;
}
// Days off grouped into runs of consecutive dates: [["2026-11-03", "2026-11-05"], ["2026-11-09", "2026-11-09"]]
function availRuns(off){
  const out = []; (off || []).slice().sort().forEach((d) => { const last = out[out.length - 1]; if(last && Math.round((parseISO(d) - parseISO(last[1])) / 864e5) === 1) last[1] = d; else out.push([d, d]); });
  return out;
}
// Who or what in a scene can't be used on a date: { cast: [names], loc: name | "" }
function unavailOn(plan, s, iso){
  if(!iso || !s || !(plan && plan.avail && plan.avail.length)) return { cast: [], loc: "" };
  const off = (k, n) => availOff(plan, k, n).indexOf(iso) >= 0;
  return { cast: (s.cast || []).filter((n) => off("cast", n)), loc: s.loc && off("loc", s.loc) ? s.loc : "" };
}
// ---------- versions: named copies of the schedule to try another layout and come back ----------
const VERSION_MAX = 10;
const VERSION_FIELDS = ["settings", "days", "status", "avail"];
function cleanVersions(v){
  const arr = Array.isArray(v) ? v : (v && typeof v === "object" ? Object.keys(v).map((k) => v[k]) : []);
  return arr.filter((x) => x && x.id && x.days).slice(-VERSION_MAX - 1).map((x) => {
    const n = normalize({ settings: x.settings, days: x.days, status: x.status, avail: x.avail });
    const o = { id: String(x.id).slice(0, 40), name: String(x.name || "Version").trim().slice(0, 60) || "Version", at: Number(x.at) || 0, by: String(x.by || "").slice(0, 80) };
    if(x.auto) o.auto = true;
    VERSION_FIELDS.forEach((f) => { o[f] = n[f]; });
    return o;
  });
}
// Save the schedule as it is now. `auto` versions (made before a restore) replace the last auto one. Mutates and returns the plan.
function saveVersion(plan, name, by, now, auto){
  const snap = { id: "v" + (now || Date.now()).toString(36) + Math.random().toString(36).slice(2, 5), name, at: now || Date.now(), by: by || "" };
  if(auto) snap.auto = true;
  VERSION_FIELDS.forEach((f) => { snap[f] = JSON.parse(JSON.stringify(plan[f] == null ? [] : plan[f])); });
  let list = cleanVersions(plan.versions);
  if(auto) list = list.filter((x) => !x.auto);
  list.push(snap);
  while(list.length > VERSION_MAX){ const i = list.findIndex((x) => x.auto); list.splice(i >= 0 && list.length - 1 !== i ? i : 0, 1); }
  plan.versions = cleanVersions(list);
  return plan;
}
// Put a saved version back. Everything else (script, groupings, cast types, call sheet links, the versions) stays.
function restoreVersion(plan, id){
  const v = cleanVersions(plan.versions).find((x) => x.id === id); if(!v) return null;
  VERSION_FIELDS.forEach((f) => { plan[f] = JSON.parse(JSON.stringify(v[f])); });
  return plan;
}
function deleteVersion(plan, id){ plan.versions = cleanVersions(plan.versions).filter((x) => x.id !== id); return plan; }
// The numbers that matter for comparing two layouts
function scheduleFacts(plan, breakdown){
  const pl = normalize(plan), byId = sceneMap(breakdown), st = pl.days.map((d) => dayStats(d, byId, pl.settings.maxEighths));
  const castDays = dood(pl, breakdown).reduce((a, r) => a + r.total, 0);
  const used = st.filter((x) => x.scenes).length, last = st.map((x) => x.scenes > 0).lastIndexOf(true) + 1;
  return { days: last, used, scenes: st.reduce((a, x) => a + x.scenes, 0), castDays, moves: st.reduce((a, x) => a + x.moves, 0),
    warns: validate(pl, breakdown).filter((w) => w.level === "warn").length, dayOf: (() => { const m = {}; pl.days.forEach((d, i) => d.scenes.forEach((id) => { m[id] = i; })); return m; })() };
}
function compareVersion(plan, version, breakdown){
  const a = scheduleFacts(plan, breakdown), b = scheduleFacts(Object.assign({}, plan, { settings: version.settings, days: version.days, status: version.status, avail: version.avail }), breakdown);
  const ids = new Set(Object.keys(a.dayOf).concat(Object.keys(b.dayOf)));
  let moved = 0; ids.forEach((id) => { if(a.dayOf[id] !== b.dayOf[id]) moved++; });
  delete a.dayOf; delete b.dayOf;
  return { now: a, then: b, moved };
}
function normalize(plan){
  plan = (plan && typeof plan === "object") ? plan : {};
  const s = Object.assign({}, DEFAULTS, plan.settings || {});
  const settings = {
    start: parseISO(s.start) ? s.start : "",
    days: clampInt(s.days, 1, MAX_DAYS, DEFAULTS.days),
    perWeek: clampInt(s.perWeek, 5, 7, DEFAULTS.perWeek),
    maxEighths: clampInt(s.maxEighths, 4, 160, DEFAULTS.maxEighths),
    maxHours: clampInt(s.maxHours, 4, 24, DEFAULTS.maxHours),   // call to wrap; auto-schedule fills a day only up to this
    call: /^\d{2}:\d{2}$/.test(s.call || "") ? s.call : DEFAULTS.call,
    nightCall: /^\d{2}:\d{2}$/.test(s.nightCall || "") ? s.nightCall : DEFAULTS.nightCall,   // a day of night scenes
    off: (Array.isArray(s.off) ? s.off : (s.off && typeof s.off === "object" ? Object.values(s.off) : [])).filter((x) => parseISO(x)).sort()
  };
  // day timing someone changed (see TIME_DEFAULTS), and the shoot's base location (sunrise, sunset and weather come from it)
  if(s.times && typeof s.times === "object"){ const t = {}; Object.keys(TIME_DEFAULTS).forEach((k) => { const v = Number(s.times[k]); if(s.times[k] !== "" && s.times[k] != null && isFinite(v) && v >= 0 && v <= 1440) t[k] = Math.round(v); }); if(Object.keys(t).length) settings.times = t; }
  const w = cleanWhere(s.where); if(w) settings.where = w;
  const arr = (v) => Array.isArray(v) ? v : (v && typeof v === "object" ? Object.keys(v).sort((a, b) => a - b).map((k) => v[k]) : []);
  let days = arr(plan.days).map((d) => { const o = { id: String((d && d.id) || uid()), scenes: arr(d && d.scenes).map(String).filter(Boolean), call: String((d && d.call) || ""), note: String((d && d.note) || ""), date: parseISO(d && d.date) ? d.date : "" }; const w = cleanWhere(d && d.where); if(w) o.where = w; const hm = (v) => /^\d{2}:\d{2}$/.test(String(v || "")) ? String(v) : ""; if(hm(d && d.lunch)) o.lunch = d.lunch; if(hm(d && d.wrapAt)) o.wrapAt = d.wrapAt; const x = cleanExtras(d && d.extras); if(x.length) o.extras = x;
    // the day's meal: its own length, or none at all
    // the meal pinned after one scene (dragged there), and automatic company moves switched off before these scenes
    if(d && d.mealAfter) o.mealAfter = String(d.mealAfter).slice(0, 80);
    const nm = arr(d && d.noMove).map(String).filter(Boolean).slice(0, 40); if(nm.length) o.noMove = Array.from(new Set(nm));
    if(d && d.noMeal === true) o.noMeal = true; else if(d && d.mealMin != null && d.mealMin !== "" && isFinite(Number(d.mealMin))) o.mealMin = clampInt(d.mealMin, 5, 240, 30);
    return o; });
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
  // what each scene looked like when it was last checked (see sceneChanges): a list, as ids may not suit keys
  out.base = arr(plan.base).filter((b) => b && b.id).map((b) => ({ id: String(b.id), e: Math.max(0, Math.round(Number(b.e) || 0)), c: String(b.c || ""), l: String(b.l || ""), dn: String(b.dn || "") }));
  // cast types someone chose (Lead / Supporting / …), over the automatic ones
  out.castType = arr(plan.castType).filter((c) => c && c.name && CAST_TYPES.indexOf(c.t) >= 0).map((c) => ({ name: String(c.name), t: c.t }));
  out.flagStatus = arr(plan.flagStatus).filter((f) => f && f.id && /^(keep|watch|ignore)$/.test(f.s)).map((f) => ({ id: String(f.id), scene: f.scene ? String(f.scene) : "", s: f.s }));
  // each scene's shooting status, when it isn't just "Scheduled" (a list: scene ids may not suit database keys)
  out.status = arr(plan.status).filter((x) => x && x.id && STATUSES.indexOf(x.s) > 0).map((x) => ({ id: String(x.id), s: x.s }));
  // dates a cast member or a place can't be used: [{ k: "cast" | "loc", name, off: ["YYYY-MM-DD", …] }] (a list: names may not suit keys)
  out.avail = cleanAvail(plan.avail);
  // saved versions of the schedule (Save version… / Restore): days, settings, statuses and days off as they were
  out.versions = cleanVersions(plan.versions);
  // links to the call sheets made by the last Sync (kept as they are)
  if(plan.callsheets && typeof plan.callsheets === "object") out.callsheets = plan.callsheets;
  return out;
}

// The plan's choices in the shape breakdown.js takes: analyze(doc, analyzeOpts(plan))
// ---------- locations: script locations grouped into one real place (with areas) ----------
// plan.locMerge = [{ from, to }]. Chains (KITCHEN → HOUSE → PROPERTY) and loops from older saves are followed safely.
function locRoot(map, n){ const seen = {}; while(map[n] && map[n] !== n && !seen[n]){ seen[n] = 1; n = map[n]; } return n; }
function locMapOf(plan){ const m = {}; ((plan && plan.locMerge) || []).forEach((x) => { m[x.from] = x.to; }); return m; }
function locSave(plan, m){
  Object.keys(m).forEach((k) => { m[k] = locRoot(m, k); });               // flat: every location points straight at its place
  plan.locMerge = Object.keys(m).filter((k) => m[k] && m[k] !== k).sort().map((k) => ({ from: k, to: m[k] }));
  return plan;
}
const placeName = (s) => String(s || "").replace(/\s+/g, " ").trim().toUpperCase();
// Put these locations (and anything already grouped under them) into a place. Naming a location that is already in a place joins that place.
function groupLocs(plan, names, to){
  to = placeName(to); if(!to) return plan;
  const m = locMapOf(plan), root = locRoot(m, to);
  delete m[root];
  names.map(placeName).filter(Boolean).forEach((n) => {
    if(n === root) return;
    Object.keys(m).forEach((k) => { if(locRoot(m, k) === n) m[k] = root; });
    m[n] = root;
  });
  return locSave(plan, m);
}
// Take one location out of its place (it becomes its own location again)
function ungroupLoc(plan, name){ const m = locMapOf(plan); delete m[name]; return locSave(plan, m); }
// Split a whole place back into its locations
function splitPlace(plan, place){ const m = locMapOf(plan); Object.keys(m).forEach((k) => { if(locRoot(m, k) === place) delete m[k]; }); return locSave(plan, m); }
// Rename a place. isLoc: the old name is itself a location in the script (its scenes move under the new name as an area)
function renamePlace(plan, from, to, isLoc){
  to = placeName(to); if(!to || to === from) return plan;
  const m = locMapOf(plan), root = locRoot(m, to);
  if(root === from) return plan;
  Object.keys(m).forEach((k) => { if(locRoot(m, k) === from) m[k] = root; });
  if(isLoc) m[from] = root;
  delete m[root];
  return locSave(plan, m);
}

const CAST_TYPES = ["Lead", "Supporting", "Day player", "Featured (non-speaking)", "Voice only"];
function analyzeOpts(plan){
  const locs = {}, flags = {}, types = {};
  (plan && plan.castType || []).forEach((c) => { types[c.name] = c.t; });
  (plan && plan.locMerge || []).forEach((m) => { locs[m.from] = m.to; });
  (plan && plan.flagStatus || []).forEach((f) => { flags[f.id + (f.scene ? "@" + f.scene : "")] = f.s; });
  return Object.keys(types).length ? { locs, flags, types } : { locs, flags };
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
  const needs = {};
  sc.forEach((x) => Object.keys(x.needs || {}).forEach((c) => { (needs[c] = needs[c] || []); x.needs[c].forEach((n) => { if(needs[c].indexOf(n) < 0) needs[c].push(n); }); }));
  // A company move is every change of location in the order the day is shot, so going back counts again:
  // backyard → bathroom → backyard is two moves, not one. (The day's timetable already counts them this way.)
  let moves = 0, was = "";
  sc.forEach((s) => { const l = s.loc || ""; if(!l) return; if(was && l !== was) moves++; was = l; });
  return { scenes: sc.length, eighths, locs, cast, dn, over: eighths > maxEighths, moves, needs };
}

// ---------- automatic scheduling ----------
// Lays out a stripboard the way a 1st AD does, then cuts it into days by the page limit:
//   1. strips sorted by location (biggest first, then the location sharing most cast with the last one),
//      day/dawn-dusk before night within a location, then scenes with the same cast side by side;
//   2. each strip goes to the best day with room: same location (no company move) first, then the same
//      light (night work gets its own day rather than a turnaround), shared cast (fewer cast days and holds), and shared
//      special requirements (animals, stunts, children, weapons, water, effects: book the wrangler,
//      coordinator or chaperone once); ties go to the earliest day.
// Scenes already on a day stay where they are unless `all` is true.
const HEAVY_FLAGS = ["animals", "stunts", "minors", "weapons", "water", "vfx", "sfx", "intimacy", "driving", "drone", "blood", "vehicles"];
function lightOf(s){ return s.dn === "N" ? "N" : s.dn === "M" ? "M" : "D"; }
function heavyOf(s){ return (s.flags || []).filter((f) => HEAVY_FLAGS.indexOf(f) >= 0); }
function overlap(a, b){ let n = 0; for(let i = 0; i < a.length; i++) if(b.indexOf(a[i]) >= 0) n++; return n; }
// How well a scene fits on a day that already has `st` (scene list): higher is better
function fitScore(s, sc){
  if(!sc.length) return 0;
  let score = 0;
  if(sc.some((x) => x.loc === s.loc)) score += 100;
  const lights = sc.map(lightOf), L = lightOf(s);
  if(L !== "M"){
    const other = L === "N" ? "D" : "N";
    if(lights.indexOf(other) >= 0 && lights.indexOf(L) < 0) score -= 120;  // day-to-night turnaround: worse than coming back to the location another day
    else if(lights.indexOf(L) >= 0) score += 20;
  }
  const cast = [].concat(...sc.map((x) => x.cast || []));
  const shared = overlap(s.cast || [], cast), fresh = (s.cast || []).length - shared;
  score += shared * 4 - fresh * 1;
  const heavy = [].concat(...sc.map(heavyOf));
  score += overlap(heavyOf(s), heavy) * 3;
  // the same booked element (a horse, a hero car, a crane) on one day is hired once
  const sp = [].concat(...sc.map((x) => x.specials || []));
  score += overlap(s.specials || [], sp) * 2;
  return score;
}
// Chain scenes so each is next to the one it shares most cast with (keeps an actor's scenes together)
function chainByCast(list){
  if(list.length < 3) return list;
  const out = [list[0]], rest = list.slice(1);
  while(rest.length){
    const last = out[out.length - 1];
    let bi = 0, bs = -1;
    rest.forEach((s, i) => { const v = overlap(s.cast || [], last.cast || []) * 10 + overlap(heavyOf(s), heavyOf(last)) * 3 + overlap(s.specials || [], last.specials || []) * 2 - i * 0.01; if(v > bs){ bs = v; bi = i; } });
    out.push(rest.splice(bi, 1)[0]);
  }
  return out;
}
function stripOrder(todo){
  const groups = {};
  todo.forEach((s) => { const k = s.loc || "?"; (groups[k] = groups[k] || []).push(s); });
  const sum = (list) => list.reduce((t, s) => t + (s.eighths || 0), 0);
  const castOf = (list) => Array.from(new Set([].concat(...list.map((s) => s.cast || []))));
  // biggest location first; after that, whichever location shares most cast with the last one (ties: bigger)
  const keys = Object.keys(groups).sort((a, b) => sum(groups[b]) - sum(groups[a]) || a.localeCompare(b));
  const order = keys.length ? [keys.shift()] : [];
  while(keys.length){
    const prev = castOf(groups[order[order.length - 1]]);
    let bi = 0, bs = -1;
    keys.forEach((k, i) => { const v = overlap(castOf(groups[k]), prev) * 1000 + sum(groups[k]) - i * 0.001; if(v > bs){ bs = v; bi = i; } });
    order.push(keys.splice(bi, 1)[0]);
  }
  const rank = { D: 0, M: 1, N: 2 };
  const strips = [];
  order.forEach((k) => {
    const byLight = { D: [], M: [], N: [] };
    groups[k].sort((a, b) => a.n - b.n).forEach((s) => byLight[lightOf(s)].push(s));
    ["D", "M", "N"].sort((a, b) => rank[a] - rank[b]).forEach((L) => chainByCast(byLight[L]).forEach((s) => strips.push(s)));
  });
  return strips;
}
// Would this day still fit if these scenes were on it? (pages, and hours from call to wrap)
function dayFits(day, ids, byId, settings){
  const sc = ids.map((id) => byId[id]).filter(Boolean);
  if(sc.reduce((a, x) => a + (x.eighths || 0), 0) > settings.maxEighths && sc.length > 1) return false;
  const t = dayTimes(Object.assign({}, day, { scenes: ids, wrapAt: "" }), byId, settings);
  return t.length <= (settings.maxHours || 12) * 60 || sc.length <= 1;   // one scene longer than a day still gets a day (it's flagged)
}
// What a layout costs, roughly as a 1st AD weighs it (lower is better):
//   paid cast days (first to last day, holds included) ×3, each place on each day ×2, each extra place in a day
//   (a company move) ×2, a day mixing day and night ×4, each special element (wrangler, stunts, vehicles) on each day ×1
function planCost(days, byId){
  const first = {}, last = {}; let cost = 0;
  days.forEach((ids, i) => {
    const sc = ids.map((id) => byId[id]).filter(Boolean); if(!sc.length) return;
    const locs = new Set(sc.map((x) => x.loc || "?")), lights = new Set(sc.map(lightOf)), sp = new Set([].concat(...sc.map((x) => (x.specials || []).concat(heavyOf(x)))));
    cost += locs.size * 2 + (locs.size - 1) * 2 + sp.size + (lights.has("D") && lights.has("N") ? 4 : 0);
    sc.forEach((x) => (x.cast || []).forEach((n) => { if(!(n in first)) first[n] = i; last[n] = i; }));
  });
  Object.keys(first).forEach((n) => { cost += (last[n] - first[n] + 1) * 3; });
  return cost;
}
// Improve a layout by moving one scene to another day, or swapping two, while it gets cheaper (see planCost).
// Only scenes in `movable` move; pages, hours and days off are respected. Stops after a few passes or ~400 ms.
function improvePlan(plan, byId, movable, can){
  const st = plan.settings, days = plan.days.map((d) => d.scenes.slice()), t0 = Date.now();
  const fits = (i, ids) => dayFits(plan.days[i], ids, byId, st);
  let best = planCost(days, byId);
  for(let pass = 0; pass < 6 && Date.now() - t0 < 400; pass++){
    let better = false;
    for(let a = 0; a < days.length; a++){
      for(const id of days[a].slice()){
        if(!movable.has(id) || Date.now() - t0 > 400) continue;
        const s = byId[id]; if(!s) continue;
        for(let b = 0; b < days.length; b++){
          if(b === a || !can(s, b)) continue;
          const from = days[a].filter((x) => x !== id), to = days[b].concat(id);
          const trial = days.slice(); trial[a] = from; trial[b] = to;
          const c = planCost(trial, byId);
          if(c < best && fits(b, to)){ days[a] = from; days[b] = to; best = c; better = true; break; }
          // swap with a movable scene on that day
          let done = false;
          for(const o of days[b]){
            if(!movable.has(o) || !can(byId[o], a)) continue;
            const fa = from.concat(o), tb = days[b].filter((x) => x !== o).concat(id);
            const t2 = days.slice(); t2[a] = fa; t2[b] = tb;
            const c2 = planCost(t2, byId);
            if(c2 < best && fits(a, fa) && fits(b, tb)){ days[a] = fa; days[b] = tb; best = c2; better = true; done = true; break; }
          }
          if(done) break;
        }
      }
    }
    if(!better) break;
  }
  plan.days.forEach((d, i) => { d.scenes = days[i]; });
  return plan;
}
function autoSchedule(plan, breakdown, opts){
  opts = opts || {};
  plan = normalize(plan);
  const byId = sceneMap(breakdown), st = plan.settings;
  if(opts.all) plan.days.forEach((d) => { d.scenes = []; });
  const placed = new Set(); plan.days.forEach((d) => d.scenes.forEach((id) => placed.add(id)));
  const todo = (breakdown && breakdown.scenes || []).filter((s) => s.id && !placed.has(s.id));
  const onDay = plan.days.map((d) => d.scenes.map((id) => byId[id]).filter(Boolean));
  const left = [], dates = planDates(plan);
  const can = (s, i) => { const u = unavailOn(plan, s, dates[i]); return !u.cast.length && !u.loc; };   // nobody booked on a day they can't do
  const moved = new Set();
  stripOrder(todo).forEach((s) => {
    let best = -1, bs = -Infinity;
    for(let i = 0; i < plan.days.length; i++){
      if(!can(s, i)) continue;
      const ids = plan.days[i].scenes.concat(s.id);
      if(!dayFits(plan.days[i], ids, byId, st) && plan.days[i].scenes.length) continue;
      const v = fitScore(s, onDay[i]);
      if(v > bs){ bs = v; best = i; }
    }
    // a single scene longer than a whole day still goes on an empty day (it'll be flagged)
    if(best < 0) best = plan.days.findIndex((d, i) => !d.scenes.length && can(s, i));
    if(best < 0){ left.push(s.id); return; }
    plan.days[best].scenes.push(s.id); onDay[best].push(s); moved.add(s.id);
  });
  // then tidy: fewer paid cast days, holds, company moves and returns (only the scenes placed now move)
  if(opts.improve !== false && moved.size) improvePlan(plan, byId, moved, can);
  if(opts.all) plan.days.forEach((d, i) => sortDay(plan, i, "loc", byId));
  return { plan, unplaced: left };
}

// Best day for one new scene: same location with room, else the lightest day with room
function suggestDay(sceneId, plan, breakdown){
  plan = normalize(plan);
  const byId = sceneMap(breakdown), s = byId[sceneId]; if(!s) return -1;
  const max = plan.settings.maxEighths, st = plan.days.map((d) => dayStats(d, byId, max)), dates = planDates(plan);
  const can = (i) => { const u = unavailOn(plan, s, dates[i]); return !u.cast.length && !u.loc; };
  let best = -1;
  const fitsH = (i) => dayFits(plan.days[i], plan.days[i].scenes.concat(sceneId), byId, plan.settings);
  st.forEach((x, i) => { if(can(i) && x.eighths + s.eighths <= max && x.locs.indexOf(s.loc) >= 0 && best < 0 && fitsH(i)) best = i; });
  if(best >= 0) return best;
  st.forEach((x, i) => { if(can(i) && x.eighths + s.eighths <= max && (best < 0 || x.eighths < st[best].eighths) && fitsH(i)) best = i; });
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
    if(st.dn.indexOf("N") >= 0 && st.dn.indexOf("D") >= 0) out.push({ level: "info", code: "DAYNIGHT", day: i + 1, text: "Day " + (i + 1) + " has day and night scenes (check turnaround)" });
    if(st.moves >= 2) out.push({ level: "info", code: "MOVES", day: i + 1, text: "Day " + (i + 1) + " has " + st.moves + " company moves (" + st.locs.join(", ") + ")" });
  });
  // Children (under 18, or described as a child) have their own work-hour, permit and chaperone rules
  const kids = {}; (breakdown && breakdown.cast || []).forEach((c) => { if(c.minor) kids[c.name] = c; });
  if(Object.keys(kids).length) plan.days.forEach((d, i) => {
    const sc = (d.scenes || []).map((id) => byId[id]).filter(Boolean);
    const who = Array.from(new Set([].concat(...sc.map((s) => (s.cast || []).filter((n) => kids[n])))));
    if(!who.length) return;
    const night = sc.filter((s) => s.dn === "N" && (s.cast || []).some((n) => kids[n])).map((s) => s.sno || s.n);
    const label = who.map((n) => n + (kids[n].age != null ? " (" + kids[n].age + ")" : " (age?)")).join(", ");
    out.push({ level: night.length ? "warn" : "info", code: "MINOR", day: i + 1, text: "Day " + (i + 1) + ": " + label + " under 18. Check permit, chaperone and work-hour limits" + (night.length ? ". Night scene" + (night.length > 1 ? "s " : " ") + night.join(", ") + " with a minor" : "") });
  });
  // Hours: long days, meal breaks, rest between days, long runs, and children's hours (from the day's timetable)
  const hm = (min) => Math.floor(min / 60) + "h" + (min % 60 ? String(min % 60).padStart(2, "0") : "");
  const dates = planDates(plan), tts = plan.days.map((d, i) => dayTimes(d, byId, plan.settings, dates[i] || ""));
  const hasScenes = plan.days.map((d) => (d.scenes || []).some((id) => byId[id]));
  const clock = (x) => toHM(x);
  plan.days.forEach((d, i) => {
    if(!hasScenes[i]) return;
    const tt = tts[i], callM = toMin(tt.call), N = "Day " + (i + 1);
    const maxH = plan.settings.maxHours || 12;
    if(tt.length > maxH * 60) out.push({ level: "warn", code: "LONGDAY", day: i + 1, text: N + " runs " + hm(tt.length) + " (call " + tt.call + ", wrap " + tt.wrap + "). Over the " + maxH + "-hour limit: check overtime and safe travel home" });
    if(tt.lateMeal || tt.rows.some((r) => r.type === "meal" && r.late)) out.push({ level: "warn", code: "LATEMEAL", day: i + 1, text: N + ": the first meal break starts more than 6 hours after call. A meal penalty may apply" });
    else if(d.noMeal && tt.length > 6 * 60) out.push({ level: "warn", code: "NOMEAL", day: i + 1, text: N + " runs " + hm(tt.length) + " with no meal break" });
    const kidScenes = (d.scenes || []).map((id) => byId[id]).filter((sc) => sc && (sc.cast || []).some((n) => kids[n]));
    if(kidScenes.length){
      const ids = kidScenes.map((sc) => sc.id), last = tt.rows.filter((r) => r.type === "scene" && ids.indexOf(r.id) >= 0).pop(), span = last ? (toMin(last.wrap) - callM + 1440) % 1440 : 0;
      if(span > 8 * 60) out.push({ level: "warn", code: "KIDHOURS", day: i + 1, text: N + ": a child's scenes run until " + last.wrap + ", " + hm(span) + " after call. Check the permitted hours for their age" });
      const lastM = last ? toMin(last.wrap) : 0;
      if(last && (lastM >= 21 * 60 || lastM < callM)) out.push({ level: "warn", code: "KIDLATE", day: i + 1, text: N + ": a child's scene wraps at " + last.wrap + ". Check the latest finish allowed for their age" });
    }
  });
  // Rest between one wrap and the next call (10 hours), using the dates when set, else back-to-back days
  for(let i = 0; i + 1 < plan.days.length; i++){
    if(!hasScenes[i] || !hasScenes[i + 1]) continue;
    const a = tts[i], b = tts[i + 1], da = parseISO(dates[i]), db = parseISO(dates[i + 1]);
    const gap = da && db ? Math.round((db - da) / 864e5) : 1;
    if(gap < 1) continue;
    const rest = gap * 1440 + toMin(b.call) - (toMin(a.call) + a.length);
    if(rest < 10 * 60) out.push({ level: "warn", code: "TURNAROUND", day: i + 2, text: "Day " + (i + 2) + ": only " + hm(Math.max(0, rest)) + " between wrap on Day " + (i + 1) + " (" + a.wrap + ") and call (" + b.call + "). Aim for 10 hours rest" });
  }
  // Someone or somewhere booked on a day they can't do (needs dates)
  if((plan.avail || []).length) plan.days.forEach((d, i) => {
    if(!dates[i]) return;
    const who = {}, where = {};
    (d.scenes || []).map((id) => byId[id]).filter(Boolean).forEach((sc) => { const u = unavailOn(plan, sc, dates[i]); u.cast.forEach((n) => { (who[n] = who[n] || []).push(sc.sno || sc.n); }); if(u.loc) (where[u.loc] = where[u.loc] || []).push(sc.sno || sc.n); });
    Object.keys(who).forEach((n) => out.push({ level: "warn", code: "CASTOFF", day: i + 1, text: "Day " + (i + 1) + ": " + n + " isn't available (Sc " + who[n].join(", ") + ")" }));
    Object.keys(where).forEach((n) => out.push({ level: "warn", code: "LOCOFF", day: i + 1, text: "Day " + (i + 1) + ": " + n + " isn't available (Sc " + where[n].join(", ") + ")" }));
  });
  // Six or more shooting days in a row (needs dates)
  let run = 0;
  plan.days.forEach((d, i) => {
    const prev = i ? parseISO(dates[i - 1]) : null, cur = parseISO(dates[i]);
    const consecutive = i && hasScenes[i - 1] && hasScenes[i] && prev && cur && Math.round((cur - prev) / 864e5) === 1;
    run = hasScenes[i] ? (consecutive ? run + 1 : 1) : 0;
    if(run === 6) out.push({ level: "warn", code: "SIXDAYS", day: i + 1, text: "Day " + (i + 1) + " is the 6th shooting day in a row. Check that cast and crew get a day off" });
  });
  // What the breakdown says each day needs (only when the element sheets are feeding the plan)
  if(breakdown && breakdown.fromElements){
    const stats = plan.days.map((d) => dayStats(d, byId, max));
    const kidDays = stats.map((x) => x.cast.some((n) => kids[n]));
    stats.forEach((x, i) => {
      const n = x.needs || {};
      if(kidDays[i] && (n.weapons || []).length) out.push({ level: "warn", code: "KIDWEAPON", day: i + 1, text: "Day " + (i + 1) + ": a child is in the cast and the day has weapons (" + n.weapons.join(", ") + "). Check the armourer and safety plan" });
      if(kidDays[i] && (n.stunts || []).length) out.push({ level: "warn", code: "KIDSTUNT", day: i + 1, text: "Day " + (i + 1) + ": a child is in the cast and the day has stunts (" + n.stunts.slice(0, 3).join(", ") + "). Check the coordinator and child stunt double" });
      if((n.animals || []).length && !(n.wrangler || []).length) out.push({ level: "info", code: "NOWRANGLER", day: i + 1, text: "Day " + (i + 1) + " has " + n.animals.slice(0, 3).join(", ") + " but no animal wrangler is tagged" });
    });
    // special elements spread over many days: grouping them hires the wrangler, coordinator or vehicle fewer times
    const where = {};
    plan.days.forEach((d, i) => (d.scenes || []).forEach((id) => { const sc = byId[id]; if(sc) (sc.specials || []).forEach((k) => { (where[k] = where[k] || {})[i + 1] = 1; }); }));
    Object.keys(where).forEach((k) => {
      const dsn = Object.keys(where[k]).map(Number).sort((a, b) => a - b);
      if(dsn.length >= 3 && /^(animals|wrangler|stunts|vehicles|sfx|mfx|vfx|equipment)\|/.test(k)) {
        const cat = k.split("|")[0], label = k.split("|").slice(1).join("|");
        out.push({ level: "info", code: "SPREAD", text: label.charAt(0).toUpperCase() + label.slice(1) + " (" + cat + ") is needed on " + dsn.length + " days (" + dsn.join(", ") + "). Grouping them saves hiring it each time" });
      }
    });
  }
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
// ---------- stripboard (pure, so it's tested) ----------
// Move several scenes at once, keeping their order: onto a day (-1 = Unscheduled), in front of beforeId or at the end.
function moveManyIn(plan, ids, toDay, beforeId){
  ids = (ids || []).filter((x, i, a) => x && a.indexOf(x) === i);
  const from = {};
  plan.days.forEach((d, i) => { d.scenes.forEach((x) => { if(ids.indexOf(x) >= 0) from[x] = i; }); d.scenes = d.scenes.filter((x) => ids.indexOf(x) < 0); });
  if(toDay >= 0 && plan.days[toDay]){
    const list = plan.days[toDay].scenes;
    let at = beforeId && ids.indexOf(beforeId) < 0 ? list.indexOf(beforeId) : -1;
    if(at < 0) at = list.length;
    list.splice(at, 0, ...ids);
  }
  return { plan, from };
}
// Re-order one day's scenes: "loc" keeps each location together (in the order they first appear) and runs day to night
// inside it; "dn" day, then dawn/dusk, then night; "n" script order. Ties keep the current order.
function sortDay(plan, i, by, byId){
  const d = plan.days[i]; if(!d) return plan;
  const pos = {}; d.scenes.forEach((x, k) => { pos[x] = k; });
  const sc = (x) => byId[x] || {}, L = { D: 0, M: 1, N: 2 }, light = (x) => L[lightOf(sc(x))] || 0;
  const firstLoc = {}; d.scenes.forEach((x) => { const l = sc(x).loc || "?"; if(!(l in firstLoc)) firstLoc[l] = pos[x]; });
  const cmp = by === "loc" ? (a, b) => firstLoc[sc(a).loc || "?"] - firstLoc[sc(b).loc || "?"] || light(a) - light(b) || pos[a] - pos[b]
    : by === "dn" ? (a, b) => light(a) - light(b) || pos[a] - pos[b]
    : (a, b) => (sc(a).n || 0) - (sc(b).n || 0) || pos[a] - pos[b];
  d.scenes = d.scenes.slice().sort(cmp);
  return plan;
}
// Does a scene pass the stripboard's search and filters? f = { q, ie: "INT"|"EXT", dn: "D"|"N"|"M", cast: name }
function stripMatch(s, f){
  if(!s) return false; f = f || {};
  if(f.ie && !(new RegExp("\\b" + f.ie + "\\b").test(String(s.ie || "")))) return false;
  if(f.dn && lightOf(s) !== f.dn) return false;
  if(f.cast && (s.cast || []).indexOf(f.cast) < 0) return false;
  const q = String(f.q || "").trim().toLowerCase();
  if(q){
    const hay = [s.n, s.sno, s.heading, s.set, s.loc, s.syn, (s.cast || []).join(" "), s.storyDay, s.note].join(" ").toLowerCase();
    if(q.split(/\s+/).some((w) => hay.indexOf(w) < 0)) return false;
  }
  return true;
}
// Cast ID numbers on a strip: the breakdown's numbers when it has them, else the cast list order
function castIds(s, cast){
  if(s && Array.isArray(s.castNo) && s.castNo.length) return s.castNo.slice();
  const order = (cast || []).map((c) => c.name);
  return ((s && s.cast) || []).map((n) => order.indexOf(n) + 1).filter((n) => n > 0).sort((a, b) => a - b);
}

// ---------- extra banners on a day: breaks, company moves and notes added by hand ----------
// day.extras = [{ id, after: sceneId ("" = start of day), k: "break" | "move" | "note" | "banner", min, label }]. A break or move adds its
// minutes to the day; a note is just a line. One that sits after a scene no longer on the day goes to the end.
const EXTRA_KINDS = ["break", "move", "note", "banner"];   // banner: a neutral heading strip, no time
function cleanExtras(v){
  const a = Array.isArray(v) ? v : (v && typeof v === "object" ? Object.keys(v).sort((x, y) => x - y).map((k) => v[k]) : []);
  return a.filter((x) => x && EXTRA_KINDS.indexOf(x.k) >= 0).slice(0, 40).map((x) => ({ id: String(x.id || uid()).slice(0, 40), after: String(x.after || "").slice(0, 80), k: x.k,
    min: x.k === "note" || x.k === "banner" ? 0 : clampInt(x.min, 0, 600, 30), label: String(x.label || "").replace(/\s+/g, " ").trim().slice(0, 60) }));
}
function extrasAfter(day, sceneId){ const ids = (day && day.scenes) || []; return ((day && day.extras) || []).filter((x) => sceneId === null ? (x.after && ids.indexOf(x.after) < 0) : x.after === sceneId); }

// ---------- the day's timetable: call, shoot and wrap for each scene, plus the meal and company moves ----------
// Worked out, never stored: change the call time, the order or a scene's Est. minutes and it follows.
//   prep    minutes from crew call to the first shot (lighting, rehearsal)
//   turn    minutes to reset between scenes (turnaround / new setup)
//   meal    meal break length; mealBy = it starts no later than this many minutes after call
//   move    company move when the location changes (0 = never add one)
const TIME_DEFAULTS = { prep: 60, turn: 30, meal: 30, mealBy: 360, move: 30 };
const toMin = (hm) => { const m = /^(\d{1,2}):(\d{2})$/.exec(String(hm || "")); return m ? (+m[1]) * 60 + (+m[2]) : null; };
const toHM = (min) => { const m = ((Math.round(min) % 1440) + 1440) % 1440; return String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0"); };
// a scene's shooting time: its Est. minutes from the breakdown, else about an hour a page (at least 15 minutes)
function estOf(s){ const e = Number(s && s.est); return e > 0 ? Math.round(e) : Math.max(15, Math.round((Number(s && s.eighths) || 0) / 8 * 60 / 5) * 5); }
function timeSettings(settings){
  const t = Object.assign({}, TIME_DEFAULTS), src = (settings && settings.times) || {};
  Object.keys(TIME_DEFAULTS).forEach((k) => { const v = Number(src[k]); if(isFinite(v) && v >= 0 && v <= 1440) t[k] = Math.round(v); });
  return t;
}
// A day of night scenes can't start at the morning call: the first shot has to be after dark. When the shoot has a
// place and the day has a date, the call is worked back from that evening's sunset; otherwise the night call
// setting stands. A call typed in by hand always wins, and a day with any daylight in it is unaffected.
function nightCall_(day, sc, settings, T, date){
  if(day && day.call) return null;
  if(!sc.length || !sc.every((s) => (s.dn || "D") === "N")) return null;
  const where = (settings && settings.where) || null, iso = (day && day.date) || date || "";
  if(where && isFinite(Number(where.lat)) && isFinite(Number(where.lng)) && iso){
    const sun = sunTimes(iso, where.lat, where.lng);
    const set = sun && hmIn(sun.set, where.tz);
    const m = toMin(set);
    if(m !== null) return toHM(m - T.prep);   // first shot as the sun goes down
  }
  return /^\d{2}:\d{2}$/.test((settings && settings.nightCall) || "") ? settings.nightCall : DEFAULTS.nightCall;
}
function dayTimes(day, byId, settings, date){
  const T = timeSettings(settings);
  const sc = ((day && day.scenes) || []).map((id) => byId[id]).filter(Boolean);
  const call = toMin(nightCall_(day, sc, settings, T, date) || (day && day.call) || (settings && settings.call) || DEFAULTS.call);
  const rows = []; let t = call, est = 0, meal = null, prevLoc = "", lateMeal = false;
  const lunchAt = toMin(day && day.lunch);   // a lunch time set by hand: the meal goes in at the scene break nearest it
  let handMove = false;   // a company move added by hand right before this scene replaces the automatic one
  // this day's meal length (its own, the shoot's, or none)
  T.meal = day && day.noMeal ? 0 : (day && day.mealMin > 0 ? day.mealMin : T.meal);
  // a meal dragged after a scene stays there (only while that scene is on this day); otherwise the lunch time or the rules place it
  const pinAt = T.meal > 0 && day && day.mealAfter && sc.some((s) => s.id === day.mealAfter) ? day.mealAfter : null;
  const noMove = (day && day.noMove) || [];
  const extra = (x) => { rows.push({ type: "extra", id: x.id, k: x.k, label: x.label, min: x.min, start: toHM(t), end: toHM(t + x.min) }); t += x.min; if(x.k === "move") handMove = true; };
  extrasAfter(day, "").forEach(extra);
  sc.forEach((s, i) => {
    const e = estOf(s), loc = String(s.loc || "");
    if(i > 0 && T.move > 0 && !handMove && loc && prevLoc && loc !== prevLoc && noMove.indexOf(s.id) < 0){ rows.push({ type: "move", from: prevLoc, to: loc, before: s.id, start: toHM(t), end: toHM(t + T.move), min: T.move }); t += T.move; }
    const setup = i === 0 ? T.prep : T.turn;
    // the meal goes in before the scene that would run past the meal limit, once the day is close to it
    if(!pinAt && lunchAt != null && !meal && i > 0 && T.meal > 0 && (t >= lunchAt || (t + setup + e > lunchAt + 45 && t >= lunchAt - 60))){
      meal = { type: "meal", start: toHM(t), end: toHM(t + T.meal), min: T.meal, manual: true }; rows.push(meal); t += T.meal;
    }
    if(!pinAt && lunchAt == null && !meal && i > 0 && T.meal > 0 && t + setup + e > call + T.mealBy && t >= call + T.mealBy - 150){
      meal = { type: "meal", start: toHM(t), end: toHM(t + T.meal), min: T.meal }; rows.push(meal); t += T.meal;
    }
    rows.push({ type: "scene", id: s.id, n: s.n, call: toHM(t), shoot: toHM(t + setup), wrap: toHM(t + setup + e), est: e });
    t += setup + e; est += e; if(loc) prevLoc = loc;
    handMove = false; extrasAfter(day, s.id).forEach(extra);
    if(pinAt === s.id){ meal = { type: "meal", start: toHM(t), end: toHM(t + T.meal), min: T.meal, manual: true, pinned: true }; rows.push(meal); t += T.meal; }
    if(!pinAt && lunchAt == null && !meal && T.meal > 0 && t >= call + T.mealBy && i < sc.length - 1){ lateMeal = t > call + T.mealBy; meal = { type: "meal", start: toHM(t), end: toHM(t + T.meal), min: T.meal, late: lateMeal }; rows.push(meal); t += T.meal; }
  });
  extrasAfter(day, null).forEach(extra);
  const manualWrap = toMin(day && day.wrapAt), autoWrap = sc.length ? toHM(t) : "";
  const end = sc.length && manualWrap != null ? manualWrap : t;
  return { call: toHM(call), wrap: sc.length ? toHM(end) : "", autoWrap, wrapManual: sc.length && manualWrap != null, est, length: sc.length ? end - call : 0, rows, lateMeal };
}
// Every day's timetable, as sent with Sync (scene ids and HH:MM times only)
function timetable(plan, byId){
  const pl = normalize(plan), dates = planDates(pl);
  return pl.days.map((d, i) => Object.assign({ day: i + 1, date: dates[i] || "" }, dayTimes(d, byId, pl.settings, dates[i] || "")));
}

// Put new scenes on their suggested days (skips any already placed or with no room)
function placeScenes(plan, ids, breakdown){
  (ids || []).forEach((id) => { const i = suggestDay(id, plan, breakdown); if(i >= 0 && !plan.days.some((d) => d.scenes.indexOf(id) >= 0)) plan.days[i].scenes.push(id); });
  return plan;
}

// Undo history: snapshots exclude call-sheet links and save stamps, which aren't edits.
// Quick runs of edits (within 700 ms) count as one step; at most 80 steps.
const HIST_GAP = 700, HIST_MAX = 80;
function histKey(plan){ const c = Object.assign({}, plan); delete c.callsheets; delete c.updatedAt; delete c.by; delete c.versions; return JSON.stringify(c); }
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
  if(plan.versions) next.versions = plan.versions;   // saved versions aren't undone
  h.at = 0;
  return next;
}

// What the panel does each time it draws: bring the stored plan in line with the script.
// Returns the reconciled plan, what changed, and whether it needs saving.
// `known` comes from the stored plan (not an edit still waiting to save).
function syncWithScript(plan, knownList, breakdown, scriptId){
  const switched = !!(plan && plan.scriptId) && plan.scriptId !== scriptId;
  const rec = reconcile(plan, breakdown);
  const scenes = (breakdown && breakdown.scenes || []).filter((s) => s.id);
  const known = new Set(Array.isArray(knownList) ? knownList : []);
  const added = known.size ? scenes.filter((s) => !known.has(s.id)).map((s) => s.id) : [];
  let save = !!(rec.removed.length || added.length || !known.size || rec.plan.scriptId !== scriptId);
  if(save){ rec.plan.scriptId = scriptId; rec.plan.known = scenes.map((s) => s.id); }
  // revisions: scheduled scenes keep their last-checked look until someone accepts the change
  const ch = sceneChanges(rec.plan, breakdown, switched);
  if(ch.baseChanged){ rec.plan.base = ch.base; save = true; }
  return { plan: rec.plan, unscheduled: rec.unscheduled, removed: rec.removed, added, changed: ch.changed, save };
}

// ---------- script revisions on the stripboard ----------
// What matters to a shoot day about a scene: its length, cast (as the script has it, not the breakdown's edits), location (before any merging of rooms)
// and day/night. Scene numbers are left out: inserting a scene renumbers everything after it.
function sceneLook(s){ return { id: s.id, e: Math.max(0, Math.round(Number(s.eighths) || 0)), c: (s.ocast || s.cast || []).slice().sort().join("|"), l: String(s.oloc || s.loc || ""), dn: String(s.dn || "") }; }
// Compares scheduled scenes with how they looked when last checked. Scenes seen for the first time,
// and unscheduled scenes, are simply (re)recorded: a change only matters once a scene is on a day.
// `reset` (switching script) records everything afresh. Returns the new base, whether it differs from
// the stored one, and the changed scheduled scenes: [{ id, day, what:["length","cast","location","day/night"], from, to }].
function sceneChanges(plan, breakdown, reset){
  const old = {}; (plan.base || []).forEach((b) => { old[b.id] = b; });
  const dayOf = {}; plan.days.forEach((d, i) => d.scenes.forEach((id) => { dayOf[id] = i + 1; }));
  const base = [], changed = [];
  let baseChanged = false;
  (breakdown && breakdown.scenes || []).filter((s) => s.id).forEach((s) => {
    const now = sceneLook(s), was = old[s.id];
    if(reset || !was || !dayOf[s.id]){ base.push(now); if(!was || was.e !== now.e || was.c !== now.c || was.l !== now.l || was.dn !== now.dn) baseChanged = true; return; }
    base.push(was);
    const what = [];
    if(was.e !== now.e) what.push("length");
    if(was.c !== now.c) what.push("cast");
    if(was.l !== now.l) what.push("location");
    if(was.dn !== now.dn) what.push("day/night");
    if(what.length) changed.push({ id: s.id, day: dayOf[s.id], what, from: was, to: now });
  });
  if(base.length !== (plan.base || []).length) baseChanged = true;   // deleted scenes drop out
  return { base, baseChanged, changed };
}
// Accept revisions: record the current look of these scenes (all changed ones when ids is empty)
function acceptChanges(plan, breakdown, ids){
  const want = ids && ids.length ? new Set(ids) : null;
  const now = {}; (breakdown && breakdown.scenes || []).forEach((s) => { if(s.id) now[s.id] = sceneLook(s); });
  plan.base = (plan.base || []).map((b) => (now[b.id] && (!want || want.has(b.id))) ? now[b.id] : b);
  return plan;
}

// Call sheets are out of date when the plan was saved more than 5 s after they were made
function callsheetsStale(raw){
  const cs = raw && raw.callsheets;
  return !!(cs && raw.updatedAt && cs.at && raw.updatedAt > cs.at + 5000);
}

// ---------- shot list (from the storyboard) ----------
// The storyboard's shot list numbers scenes (sh.scene = scene n) and gives each scene the script
// heading's line id (sc.id), the same permanent id the plan uses. Shots are joined by that id, so
// renumbering scenes never moves shots to the wrong day. Scenes added only on the storyboard (isExtra)
// aren't in the script and are left out. Returns { sceneId: [shot, ...] } in shot order.
function shotsBySceneId(shotlist){
  const out = {};
  if(!shotlist || !Array.isArray(shotlist.scenes) || !Array.isArray(shotlist.shots)) return out;
  const idOfN = {};
  shotlist.scenes.forEach((sc) => { if(sc && sc.id && !sc.isExtra) idOfN[String(sc.n)] = String(sc.id); });
  shotlist.shots.forEach((sh) => {
    const id = sh && idOfN[String(sh.scene)]; if(!id) return;
    // the sheet starts each scene with an empty numbered row: it's a shot only once something is filled in
    if(!(sh.size || sh.angle || sh.move || sh.lens || sh.desc || sh.cast || sh.equip || sh.notes || Number(sh.est) > 0) && !/^(shot|needs reshoot)$/i.test(String(sh.status || ""))) return;
    (out[id] = out[id] || []).push({ shot: String(sh.shot == null ? "" : sh.shot), size: String(sh.size || ""), angle: String(sh.angle || ""), move: String(sh.move || ""),
      lens: String(sh.lens || ""), desc: String(sh.desc || ""), cast: String(sh.cast || ""), equip: String(sh.equip || ""), notes: String(sh.notes || ""), status: String(sh.status || ""),
      key: String(sh.key || ""), min: Number(sh.est) > 0 ? Math.round(Number(sh.est)) : 0 });   // min: EST. MIN typed in the Sheet
  });
  return out;
}
// A shoot day's shots, scene by scene in the day's order
function dayShots(day, shotMap){
  const scenes = (day && day.scenes || []).map((id) => ({ id, shots: (shotMap && shotMap[id]) || [] }));
  return { scenes, total: scenes.reduce((a, s) => a + s.shots.length, 0) };
}

const api = { VERSION_MAX, cleanVersions, saveVersion, restoreVersion, deleteVersion, scheduleFacts, compareVersion, dayFits, planCost, improvePlan, cleanAvail, availOff, setAvail, availRuns, unavailOn, DEFAULTS, MAX_DAYS, CAST_TYPES, locRoot, groupLocs, ungroupLoc, splitPlace, renamePlace, fmtEighths, parseISO, shootDates, planDates, analyzeOpts, normalize, resizeDays, reconcile, sceneMap, dayStats, autoSchedule, stripOrder, fitScore, suggestDay, dood, validate,
  EXTRA_KINDS, cleanExtras, moveSceneIn, moveManyIn, sortDay, stripMatch, castIds, placeScenes, STATUSES, statusOf, setStatus, cleanWhere, whereOf, sunTimes, hmIn, TIME_DEFAULTS, timeSettings, estOf, dayTimes, timetable, toMin, toHM, histKey, histNew, histRemember, histStep, syncWithScript, callsheetsStale, sceneLook, sceneChanges, acceptChanges, shotsBySceneId, dayShots };
if(typeof module !== "undefined" && module.exports) module.exports = api; else root.CampProduction = api;
})(typeof window !== "undefined" ? window : this);
