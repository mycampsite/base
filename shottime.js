/* shottime.js — shot and scene time estimates from the breakdown and the shot list. Pure functions, no DOM:
   the same code runs in the browser (window.CampShotTime) and in the tests (node tests/shottime.test.js).
   Rule-based and deterministic: the same scene and shots always give the same minutes. Every number lives in CONFIG
   (placeholders to calibrate against a real crew); a project can override any of them (settings.shotTimes).

   Which time a scene gets (sceneMinutes):
     1. Est. typed on the breakdown sheet   (always wins)
     2. its shots in the shot list           (prep + the sum of the shots)
     3. the breakdown's own auto Est.        (about an hour a page plus allowances; unchanged when there are no shots)
   Shot and prep times round UP to the next 10 minutes (CONFIG.round), so a scene is exactly prep + its shots.

   Inputs (what the hub already has; nothing here is stored):
     scene { id, ie: "INT"|"EXT"|"INT/EXT"|"I/E", dn: "D"|"N"|"M"(dawn/dusk)|"C", eighths, cast: [names] or a count,
             tags: [tag keys] (see sceneTags), est, estAuto }
     shot  { size, angle, move, equip, desc, cast: "ANA, BEN" or a count,                    (the shot list's columns)
             mv, li, st, takes, dur, inc }                                                   (optional overrides; empty = work it out) */
(function (root) {
"use strict";

// ---------- the one config: tags, camera moves, lighting, setups, sizes ----------
// tags: [label, score, scenePrepMin (paid once per scene), perShotMin, scope f = in frame / e = the whole environment]
const CONFIG = {
  tags: {
    stunt: ["Stunts", 4, 45, 15, "f"], sfx: ["Special FX", 3, 30, 10, "f"], vfx: ["Visual FX", 2, 10, 5, "f"],
    water: ["Water", 3, 40, 10, "e"], animals: ["Animals", 2, 15, 10, "f"], kids: ["Minors", 2, 10, 10, "f"],
    extras: ["Extras", 1, 15, 5, "f"], crowd: ["Crowd", 2, 30, 10, "f"], car: ["Picture vehicle", 2, 20, 10, "f"],
    drive: ["Vehicle in motion", 4, 45, 20, "e"], weapons: ["Weapons", 2, 15, 5, "f"], props: ["Props", 1, 10, 5, "f"],
    makeup: ["Makeup FX", 2, 15, 5, "f"], practicals: ["Practical lights", 1, 10, 10, "e"], lightfx: ["Lighting FX", 2, 20, 15, "e"],
    tight: ["Tight location", 1, 0, 10, "e"], height: ["Height", 3, 40, 15, "e"], equip: ["Special camera gear", 2, 30, 15, "e"]
  },
  // camera moves: [weight, setupMin]
  moves: { static: [0, 10], pan: [1, 15], hand: [1, 10], slider: [2, 20], dolly: [3, 35], steady: [3, 30], crane: [4, 50], drone: [4, 45], car: [5, 75] },
  // lighting levels 0 natural … 4 large: [weight, setupMin]
  light: [[0, 0], [1, 10], [2, 25], [3, 45], [4, 70]],
  // setup types: how much of a full setup it costs
  setup: { new: 1, move: 0.55, lens: 0.15, same: 0.05 },
  // take length in seconds by size; +longMove for the bigger moves
  takeSec: { INSERT: 10, CUTAWAY: 15, ECU: 10, CU: 25, MCU: 25, MS: 35, "TWO SHOT": 35, OTS: 35, POV: 20, MWS: 40, WS: 45, EWS: 45 },
  longMove: 15, longMoves: ["dolly", "steady", "crane", "drone", "car"],
  night: 15,          // extra setup minutes at night
  castMin: 3,         // setup minutes per extra cast member in frame
  cont: 10,           // % contingency on every shot and on prep
  round: 10,          // shot and prep times round up to this many minutes (1 = no rounding)
  bands: [[4, "Simple"], [8, "Moderate"], [12, "Complex"], [Infinity, "Extreme"]]
};
const TAG_KEYS = Object.keys(CONFIG.tags);
const WIDE = { EWS: 1, WS: 1, MWS: 1 }, TIGHT = { CU: 1, ECU: 1, INSERT: 1, CUTAWAY: 1 };
// frame tags a mid shot doesn't see unless the description says so
const MID_SKIPS = { extras: 1, crowd: 1, stunt: 1, car: 1, sfx: 1, vfx: 1 };

// Whole words only (so "car" never matches "scar", "cat" never "locate", "pan" never "company")
const W = (s) => new RegExp("\\b(?:" + s + ")\\b", "i");
const KEYWORDS = {
  stunt: W("stunts?|fights?|fighting|punch(?:es|ed|ing)?|falls?|falling|fell|jumps?|jumped|jumping|crash(?:es|ed|ing)?|chases?|chased|chasing|tackles?|tackled|brawls?"),
  sfx: W("explo\\w*|squibs?|blood\\w*|smoke|smoking|sparks?|gunshots?|gunfire|shatter\\w*|fire|flames?|burn(?:s|ing|ed)?|glass"),
  vfx: W("green ?screen|vfx|cgi|composite|monsters?|creatures?|holograms?"),
  animals: W("dogs?|cats?|horses?|animals?|pupp(?:y|ies)|birds?"),
  kids: W("child|children|kids?|bab(?:y|ies)|toddlers?"),
  extras: W("crowds?|extras|background|busy|party|market"),
  crowd: W("crowds?|stadium|mob|rally"),
  car: W("cars?|vehicles?|trucks?|bikes?|vans?|motorbikes?"),
  weapons: W("guns?|pistols?|knives|knife|weapons?|rifles?|swords?|shoots|shooting|shot at"),
  props: W("props?|phones?|letters?|keys"),
  makeup: W("blood\\w*|wounds?|scars?|bruises?|bruised|prosthetics?|burns?|burned")
};
// a description's camera move, first match wins
const MOVE_WORDS = [
  ["crane", W("crane|jib")], ["drone", W("drone|aerial")],
  ["steady", W("steadicam|gimbal|follows?|following|tracking|walks?|walking|runs?|running")],
  ["dolly", W("dolly|push(?:es)? in|pull(?:s)? (?:out|back)")], ["slider", W("slider")],
  ["hand", W("handheld|hand-held|shaky|fights?|chases?|chasing")], ["pan", W("pans?|tilts?|whip|reveals?")]
];
const LENS_WORDS = W("same|tighter|closer|punch(?:es)? in");
// the shot list's MOVEMENT and EQUIPMENT dropdowns
const MOVE_COL = { static: "static", pan: "pan", tilt: "pan", zoom: "pan", dolly: "dolly", truck: "dolly", handheld: "hand", "steadicam/gimbal": "steady", steadicam: "steady", gimbal: "steady", "crane/jib": "crane", crane: "crane", jib: "crane", drone: "drone", slider: "slider", car: "car", "car mount": "car", "tracking vehicle": "car" };
const EQUIP_COL = { tripod: "static", handheld: "hand", gimbal: "steady", slider: "slider", dolly: "dolly", "jib/crane": "crane", drone: "drone" };

// ---------- helpers ----------
const num = (v) => { const n = Number(v); return isFinite(n) ? n : 0; };
const ceilTo = (m, step) => step > 1 ? Math.ceil(Math.round(m * 1000) / 1000 / step) * step : Math.ceil(Math.round(m * 1000) / 1000);
const r1 = (x) => Math.round(x * 10) / 10;
function config(over){
  const c = JSON.parse(JSON.stringify(CONFIG)); c.bands = CONFIG.bands;
  if(over && typeof over === "object") ["night", "castMin", "cont", "round", "longMove"].forEach((k) => { const v = Number(over[k]); if(over[k] !== "" && over[k] != null && isFinite(v) && v >= 0 && v <= 1000) c[k] = v; });
  return c;
}
function band(score, cfg){ return (cfg.bands.find((b) => score < b[0]) || cfg.bands[cfg.bands.length - 1])[1]; }
// shot sizes as the shot list writes them, plus common aliases
function sizeOf(shot){
  const s = String((shot && shot.size) || "").toUpperCase().replace(/[-_.]/g, " ").replace(/\s+/g, " ").trim();
  const A = { "EXTREME WIDE": "EWS", "EXTREME WIDE SHOT": "EWS", ELS: "EWS", ESTABLISHING: "EWS", "WIDE": "WS", "WIDE SHOT": "WS", LS: "WS", "LONG SHOT": "WS", MASTER: "WS",
    "MEDIUM WIDE": "MWS", MLS: "MWS", COWBOY: "MWS", "MEDIUM": "MS", "MID": "MS", "MEDIUM SHOT": "MS", "MEDIUM CLOSE UP": "MCU", "CLOSE UP": "CU", CLOSEUP: "CU",
    "EXTREME CLOSE UP": "ECU", XCU: "ECU", "OVER THE SHOULDER": "OTS", "2 SHOT": "TWO SHOT", TWOSHOT: "TWO SHOT", "2S": "TWO SHOT", "TWO": "TWO SHOT", INS: "INSERT" };
  const k = A[s] || s;
  if(CONFIG.takeSec[k] != null) return k;
  if(/\bPOV\b/i.test(String((shot && shot.angle) || ""))) return "POV";
  return "MS";   // not set (or not known): treat it as a mid shot
}
const classOf = (size) => WIDE[size] ? "wide" : TIGHT[size] ? "tight" : "mid";
const castCount = (v) => typeof v === "number" ? Math.max(0, Math.round(v)) : Array.isArray(v) ? v.filter(Boolean).length : String(v || "").split(/[,;\/&]|\band\b/i).map((x) => x.trim()).filter(Boolean).length;
const night = (dn) => dn === "N";
// stack: the biggest tag counts in full, the next at half, the rest at a quarter (a stunt, its FX and its weapon are one setup)
function stack(list){
  const f = [1, 0.5];
  const s = list.slice().sort((a, b) => (b.score - a.score) || (b.min - a.min) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return s.reduce((o, t, i) => { const m = i < f.length ? f[i] : 0.25; o.score += t.score * m; o.min += t.min * m; return o; }, { score: 0, min: 0 });
}

// ---------- one shot ----------
// prev: the shot before it in the same scene (for the setup type), first: true for the scene's first shot
function shotTime(scene, shot, ctx, cfgIn){
  const cfg = cfgIn && cfgIn.tags ? cfgIn : config(cfgIn);
  shot = shot || {}; ctx = ctx || {};
  const sceneTags = (scene.tags || []).filter((k) => cfg.tags[k]);
  const size = sizeOf(shot), cls = classOf(size), desc = String(shot.desc || "");
  const inc = Array.isArray(shot.inc) ? shot.inc.filter((k) => sceneTags.indexOf(k) >= 0) : [];
  // 1. tags in frame
  const inFrame = [];
  sceneTags.forEach((k) => {
    const t = cfg.tags[k];
    if(t[4] === "e"){ inFrame.push({ key: k, w: cls === "tight" ? 0.5 : 1 }); return; }
    const on = inc.length ? inc.indexOf(k) >= 0
      : (KEYWORDS[k] && KEYWORDS[k].test(desc)) || cls === "wide" || (cls === "mid" && !MID_SKIPS[k]) || (size === "INSERT" && k === "props");
    if(on) inFrame.push({ key: k, w: 1 });
  });
  const has = (k) => inFrame.some((t) => t.key === k);
  // 2. camera move: a typed override, the MOVEMENT column, the EQUIPMENT column, a moving vehicle, then the description
  let mv = cfg.moves[shot.mv] ? shot.mv : MOVE_COL[String(shot.move || "").toLowerCase().trim()] || "";
  if(!mv) mv = EQUIP_COL[String(shot.equip || "").toLowerCase().trim()] || "";
  if(!mv && has("drive")) mv = "car";
  if(!mv){ const hit = MOVE_WORDS.find((x) => x[1].test(desc)); mv = hit ? hit[0] : "static"; }
  const MV = cfg.moves[mv];
  // 3. lighting
  const ie = String(scene.ie || "INT").toUpperCase(), ext = /EXT/.test(ie) && !/INT/.test(ie), dn = String(scene.dn || "D").toUpperCase();
  let li = shot.li != null && shot.li !== "" && shot.li !== "auto" && isFinite(Number(shot.li)) ? Number(shot.li) : null;
  if(li == null){
    li = dn === "N" ? 2 : dn === "M" ? (ext ? 1 : 2) : (ext ? 0 : 1);
    li += cls === "wide" ? 1 : cls === "tight" ? -1 : 0;
    if(has("practicals")) li++;
    if(has("lightfx")) li++;
  }
  li = Math.max(0, Math.min(4, Math.round(li)));
  const LI = cfg.light[li];
  // 4. cast in frame: the CHARACTERS column, else from the size
  const sceneCast = castCount(scene.cast);
  let cast = shot.cast != null && shot.cast !== "" ? castCount(shot.cast) : null;
  if(cast == null) cast = cls === "tight" ? (size === "INSERT" || size === "CUTAWAY" ? 0 : Math.min(1, sceneCast)) : cls === "mid" ? Math.min(sceneCast, 2) : sceneCast;
  // 5. setup type: new for the scene's first shot; a lens change; the same setup again (same size, move and cast); else a move
  let st = cfg.setup[shot.st] != null ? shot.st : "";
  if(!st){
    const p = ctx.prev;
    st = ctx.first || !p ? "new" : LENS_WORDS.test(desc) ? "lens" : (p.size === size && p.mv === mv && p.cast === cast) ? "same" : "move";
  }
  // 6. takes
  let takes = num(shot.takes) > 0 ? Math.round(num(shot.takes)) : 0;
  if(!takes) takes = 3 + (MV[0] >= 3 ? 2 : MV[0] >= 1 ? 1 : 0) + (has("stunt") ? 3 : 0) + (has("kids") || has("animals") ? 2 : 0) + (cast >= 3 ? 1 : 0) + (cls === "wide" ? 1 : 0);
  const takeSec = num(shot.dur) > 0 ? num(shot.dur) : cfg.takeSec[size] + (cfg.longMoves.indexOf(mv) >= 0 ? cfg.longMove : 0);
  // the sums
  const tg = stack(inFrame.map((t) => ({ key: t.key, score: cfg.tags[t.key][1] * t.w, min: cfg.tags[t.key][3] * t.w })));
  const isNight = night(dn);
  const raw = MV[1] + LI[1] + Math.max(0, cast - 1) * cfg.castMin + (isNight ? cfg.night : 0) + tg.min;
  const sc = MV[0] + LI[0] + Math.min(cast, 6) * 0.4 + (isNight ? 1 : 0) + tg.score, score = r1(sc);   // shown to 1 decimal, used in full
  const setup = Math.max(3, Math.round(raw * cfg.setup[st]));
  const shoot = Math.ceil(Math.round(takes * (takeSec / 60 + 1 + 0.4 * sc) * 1000) / 1000);
  const exact = Math.round((setup + shoot) * (1 + cfg.cont / 100));
  return { size, cls, mv, li, cast, st, takes, takeSec, tags: inFrame.map((t) => t.key), score, complexity: band(sc, cfg), setup, shoot, exact, min: ceilTo(exact, cfg.round) };
}

// ---------- a scene: prep (once) plus every shot in order ----------
function sceneShots(scene, shots, cfgIn){
  const cfg = cfgIn && cfgIn.tags ? cfgIn : config(cfgIn);
  scene = scene || {};
  const tags = (scene.tags || []).filter((k, i, a) => cfg.tags[k] && a.indexOf(k) === i);
  const prepRaw = tags.reduce((a, k) => a + cfg.tags[k][2], 0);
  const prepExact = Math.round(prepRaw * (1 + cfg.cont / 100));
  const prep = prepRaw ? ceilTo(prepExact, cfg.round) : 0;
  const out = []; let prev = null;
  (shots || []).forEach((sh, i) => { const t = shotTime(scene, sh, { first: i === 0, prev }, cfg); out.push(t); prev = t; });
  const st = stack(tags.map((k) => ({ key: k, score: cfg.tags[k][1], min: 0 })));
  const score = r1(st.score + (night(String(scene.dn || "").toUpperCase()) ? 1 : 0) + Math.min(castCount(scene.cast), 8) * 0.3);
  return { prep, prepExact, shots: out, n: out.length, total: prep + out.reduce((a, t) => a + t.min, 0), exact: prepExact + out.reduce((a, t) => a + t.exact, 0), score, complexity: band(score, cfg) };
}

// ---------- the minutes the schedule uses for a scene ----------
// Returns { min, src: "manual" | "shots" | "auto", shots?: sceneShots result }
function sceneMinutes(scene, shots, cfgIn){
  scene = scene || {};
  const est = Math.round(num(scene.est));
  if(est > 0 && scene.estAuto === false) return { min: est, src: "manual" };
  if(shots && shots.length){ const r = sceneShots(scene, shots, cfgIn); return { min: r.total, src: "shots", shots: r }; }
  if(est > 0) return { min: est, src: "auto" };
  return { min: 0, src: "auto" };
}

// ---------- tags from the breakdown ----------
// The breakdown's categories give most tags; the rest are ticked on the breakdown sheet (env: water, height, tight, drive,
// lightfx, practicals, equip). els = { categoryId: [element keys] }, bg = the breakdown's background size ("Crowd" …),
// minors = true when a cast member in the scene is under 18.
const CAT_TAG = { stunts: "stunt", sfx: "sfx", mfx: "sfx", vfx: "vfx", animals: "animals", wrangler: "animals", background: "extras", vehicles: "car", weapons: "weapons", props: "props", makeup: "makeup", camera: "equip" };
const ENV_TAGS = ["water", "height", "tight", "drive", "lightfx", "practicals", "equip"];
function sceneTags(o){
  o = o || {}; const out = [];
  const add = (k) => { if(CONFIG.tags[k] && out.indexOf(k) < 0) out.push(k); };
  const els = o.els || {};
  Object.keys(CAT_TAG).forEach((c) => { if((els[c] || []).length) add(CAT_TAG[c]); });
  if(/crowd/i.test(String(o.bg || ""))) add("crowd");
  if(o.minors) add("kids");
  (Array.isArray(o.env) ? o.env : []).forEach((k) => { if(ENV_TAGS.indexOf(k) >= 0) add(k); });
  return out;
}

const api = { CONFIG, TAG_KEYS, ENV_TAGS, CAT_TAG, KEYWORDS, config, sizeOf, classOf, castCount, stack, shotTime, sceneShots, sceneMinutes, sceneTags, ceilTo };
if(typeof module !== "undefined" && module.exports) module.exports = api; else root.CampShotTime = api;
})(typeof window !== "undefined" ? window : this);
