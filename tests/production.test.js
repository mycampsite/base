// Tests for the scheduling engine (production.js). Run: node tests/production.test.js
"use strict";
const assert = require("assert");
const P = require("../production.js");

let passed = 0, failed = 0;
function test(name, fn){ try{ fn(); passed++; console.log("  ok  " + name); }catch(e){ failed++; console.log("  FAIL " + name + "\n       " + (e && e.message)); } }

// A small breakdown in the shape breakdown.js returns
const bd = {
  scenes: [
    { n: 1, id: "s1", loc: "HOUSE", dn: "D", eighths: 16, cast: ["ANA", "BEN"] },
    { n: 2, id: "s2", loc: "PARK", dn: "D", eighths: 12, cast: ["ANA"] },
    { n: 3, id: "s3", loc: "HOUSE", dn: "N", eighths: 10, cast: ["BEN"] },
    { n: 4, id: "s4", loc: "HOUSE", dn: "D", eighths: 6, cast: ["ANA", "CAL"] },
    { n: 5, id: "s5", loc: "CAR", dn: "N", eighths: 3, cast: ["CAL"] },
    { n: 6, id: "s6", loc: "PARK", dn: "D", eighths: 30, cast: ["BEN", "CAL"] }
  ],
  cast: [{ name: "ANA" }, { name: "BEN" }, { name: "CAL" }]
};
const total = bd.scenes.reduce((a, s) => a + s.eighths, 0);
const allPlaced = (plan) => plan.days.reduce((a, d) => a.concat(d.scenes), []);

console.log("Scheduling engine");

test("page lengths print as Final Draft does (4 3/8, 1/2, 7)", () => {
  assert.deepStrictEqual([0, 1, 4, 8, 35, 56, 6, 2].map(P.fmtEighths), ["0", "1/8", "1/2", "1", "4 3/8", "7", "3/4", "1/4"]);
});

test("shoot dates skip weekends on a 5-day week, Sundays on a 6-day week", () => {
  // 2026-11-06 is a Friday
  assert.deepStrictEqual(P.shootDates("2026-11-06", 3, 5), ["2026-11-06", "2026-11-09", "2026-11-10"]);
  assert.deepStrictEqual(P.shootDates("2026-11-06", 3, 6), ["2026-11-06", "2026-11-07", "2026-11-09"]);
  assert.deepStrictEqual(P.shootDates("2026-11-07", 2, 5), ["2026-11-09", "2026-11-10"]);   // starts on a Saturday
  assert.deepStrictEqual(P.shootDates("2026-11-07", 2, 7), ["2026-11-07", "2026-11-08"]);
  assert.deepStrictEqual(P.shootDates("", 2, 5), ["", ""]);
});

test("daylight saving changes don't shift dates (AEDT starts 2026-10-04)", () => {
  assert.deepStrictEqual(P.shootDates("2026-10-02", 2, 5), ["2026-10-02", "2026-10-05"]);
});

test("database oddities are cleaned: missing arrays, object-arrays, duplicate scenes", () => {
  const p = P.normalize({ settings: { days: 3 }, days: { 0: { id: "a", scenes: { 0: "s1", 1: "s2" } }, 1: { id: "b" }, 2: { id: "c", scenes: ["s2", "s3"] } } });
  assert.deepStrictEqual(p.days.map((d) => d.scenes), [["s1", "s2"], [], ["s3"]]);
});

test("more shoot days = empty days added; fewer = scenes go back to Unscheduled, none lost", () => {
  let { plan } = P.autoSchedule({ settings: { days: 4, maxEighths: 40 } }, bd);
  const before = allPlaced(plan).sort();
  const grow = P.resizeDays(plan, 6);
  assert.strictEqual(grow.plan.days.length, 6); assert.strictEqual(grow.moved.length, 0);
  const shrink = P.resizeDays(plan, 2);
  const after = allPlaced(shrink.plan).concat(shrink.moved.map((m) => m.id)).sort();
  assert.deepStrictEqual(after, before);
  assert.strictEqual(shrink.plan.settings.days, 2);
});

test("auto-schedule places every scene once, never over the page limit when it fits", () => {
  const { plan, unplaced } = P.autoSchedule({ settings: { days: 4, maxEighths: 32 } }, bd);
  const placed = allPlaced(plan);
  assert.strictEqual(new Set(placed).size, placed.length);
  assert.strictEqual(placed.length + unplaced.length, bd.scenes.length);
  const byId = P.sceneMap(bd);
  plan.days.forEach((d) => assert.ok(P.dayStats(d, byId, 32).eighths <= 32));
});

test("auto-schedule keeps a location together and shoots day before night", () => {
  const { plan } = P.autoSchedule({ settings: { days: 4, maxEighths: 40 } }, bd);
  const dayOf = (id) => plan.days.findIndex((d) => d.scenes.indexOf(id) >= 0);
  assert.strictEqual(dayOf("s1"), dayOf("s4"));                       // HOUSE day scenes together
  const house = plan.days[dayOf("s1")].scenes;
  assert.ok(house.indexOf("s1") < house.indexOf("s3") || dayOf("s3") !== dayOf("s1"));
});

test("a scene longer than a day still gets an empty day (and is flagged)", () => {
  const big = { scenes: [{ n: 1, id: "x", loc: "A", dn: "D", eighths: 60, cast: [] }], cast: [] };
  const { plan, unplaced } = P.autoSchedule({ settings: { days: 2, maxEighths: 40 } }, big);
  assert.strictEqual(unplaced.length, 0);
  assert.ok(P.validate(plan, big).some((w) => w.code === "OVER"));
});

test("not enough days: leftovers are reported, not dropped", () => {
  const { plan, unplaced } = P.autoSchedule({ settings: { days: 1, maxEighths: 20 } }, bd);
  assert.strictEqual(allPlaced(plan).length + unplaced.length, bd.scenes.length);
  assert.ok(unplaced.length > 0);
});

test("script changes: a deleted scene comes off its day, a new scene is Unscheduled", () => {
  const plan = { settings: { days: 2 }, days: [{ id: "a", scenes: ["s1", "gone"] }, { id: "b", scenes: ["s2"] }] };
  const r = P.reconcile(plan, bd);
  assert.deepStrictEqual(r.removed, [{ id: "gone", day: 1 }]);
  assert.deepStrictEqual(r.plan.days[0].scenes, ["s1"]);
  assert.deepStrictEqual(r.unscheduled.sort(), ["s3", "s4", "s5", "s6"]);
});

test("renumbered scenes stay on their day (ids, not numbers)", () => {
  const renum = { scenes: bd.scenes.map((s) => Object.assign({}, s, { n: s.n + 10 })), cast: bd.cast };
  const r = P.reconcile({ settings: { days: 1 }, days: [{ id: "a", scenes: ["s3"] }] }, renum);
  assert.deepStrictEqual(r.plan.days[0].scenes, ["s3"]); assert.strictEqual(r.removed.length, 0);
});

test("day totals: pages add up and match the script total when everything is scheduled", () => {
  const { plan } = P.autoSchedule({ settings: { days: 6, maxEighths: 40 } }, bd);
  const byId = P.sceneMap(bd);
  const sum = plan.days.reduce((a, d) => a + P.dayStats(d, byId, 40).eighths, 0);
  assert.strictEqual(sum, total);
});

test("auto-schedule: night scenes get their own day when there's room (no turnaround)", () => {
  const b = { scenes: [
    { n: 1, id: "a", loc: "HOUSE", dn: "D", eighths: 8, cast: ["ANA"] },
    { n: 2, id: "b", loc: "HOUSE", dn: "N", eighths: 8, cast: ["ANA"] },
    { n: 3, id: "c", loc: "PARK", dn: "D", eighths: 8, cast: ["ANA"] },
    { n: 4, id: "d", loc: "STREET", dn: "N", eighths: 8, cast: ["ANA"] }], cast: [{ name: "ANA" }] };
  const { plan } = P.autoSchedule({ settings: { days: 2, maxEighths: 40 } }, b);
  const dayOf = (id) => plan.days.findIndex((d) => d.scenes.indexOf(id) >= 0);
  assert.strictEqual(dayOf("a"), dayOf("c")); assert.strictEqual(dayOf("b"), dayOf("d")); assert.notStrictEqual(dayOf("a"), dayOf("b"));
  assert.ok(!P.validate(plan, b).some((w) => w.code === "DAYNIGHT"));
});

test("auto-schedule: after the biggest location comes the one sharing its cast", () => {
  const b = { scenes: [
    { n: 1, id: "a", loc: "BIG", dn: "D", eighths: 20, cast: ["ANA"] },
    { n: 2, id: "b", loc: "OTHER", dn: "D", eighths: 10, cast: ["ZED"] },
    { n: 3, id: "c", loc: "SMALL", dn: "D", eighths: 4, cast: ["ANA"] }], cast: [] };
  assert.deepStrictEqual(P.stripOrder(b.scenes).map((s) => s.id), ["a", "c", "b"]);
});

test("auto-schedule: scenes needing the same special requirement share a day", () => {
  const b = { scenes: [
    { n: 1, id: "a", loc: "FARM", dn: "D", eighths: 8, cast: ["ANA"], flags: ["animals"] },
    { n: 2, id: "b", loc: "SHOP", dn: "D", eighths: 8, cast: ["BEN"] },
    { n: 3, id: "c", loc: "ROAD", dn: "D", eighths: 8, cast: ["CAL"], flags: ["animals"] }], cast: [] };
  const plan = P.normalize({ settings: { days: 2, maxEighths: 16 }, days: [{ id: "x", scenes: ["a"] }, { id: "y", scenes: ["b"] }] });
  const r = P.autoSchedule(plan, b);
  assert.ok(r.plan.days[0].scenes.indexOf("c") >= 0);   // with the other animal scene, not the shop day
});

test("a day mixing day and night scenes is noted", () => {
  const plan = { settings: { days: 1, maxEighths: 40 }, days: [{ id: "a", scenes: ["s1", "s3"] }] };
  assert.ok(P.validate(plan, bd).some((w) => w.code === "DAYNIGHT" && w.level === "info"));
});

test("suggested day for a new scene: same location with room first", () => {
  const plan = { settings: { days: 3, maxEighths: 40 }, days: [{ id: "a", scenes: ["s2"] }, { id: "b", scenes: ["s1"] }, { id: "c", scenes: [] }] };
  assert.strictEqual(P.suggestDay("s4", plan, bd), 1);   // HOUSE is on day 2
  assert.strictEqual(P.suggestDay("s5", plan, bd), 2);   // CAR: lightest day with room
});

test("Day Out of Days: start, hold, finish marks and counts", () => {
  const plan = { settings: { days: 4 }, days: [{ id: "1", scenes: ["s1"] }, { id: "2", scenes: ["s5"] }, { id: "3", scenes: ["s2"] }, { id: "4", scenes: ["s3"] }] };
  const rows = P.dood(plan, bd), row = (n) => rows.find((r) => r.name === n);
  assert.deepStrictEqual(row("ANA").marks, ["SW", "H", "WF", ""]);
  assert.strictEqual(row("ANA").workDays, 2); assert.strictEqual(row("ANA").holdDays, 1);
  assert.deepStrictEqual(row("BEN").marks, ["SW", "H", "H", "WF"]);
  assert.deepStrictEqual(row("CAL").marks, ["", "SWF", "", ""]);
});

test("a child on a shoot day is flagged, and a night scene with one is a warning", () => {
  const kidBd = { scenes: bd.scenes, cast: [{ name: "ANA" }, { name: "BEN", minor: true, age: 9 }, { name: "CAL", minor: true, minorHint: true, age: null }] };
  const plan = P.normalize({ settings: { days: 3, maxEighths: 80 }, days: [{ scenes: ["s1", "s2"] }, { scenes: ["s3"] }, { scenes: ["s4", "s5"] }] });
  const w = P.validate(plan, kidBd).filter((x) => x.code === "MINOR");
  assert.strictEqual(w.length, 3);
  assert.strictEqual(w[0].level, "info");                       // day 1: BEN in a day scene
  assert.strictEqual(w[1].level, "warn");                       // day 2: BEN in a night scene
  assert.ok(/BEN \(9\)/.test(w[0].text) && /Night scene 3/.test(w[1].text));
  assert.ok(/CAL \(age\?\)/.test(w[2].text));                // day 3: CAL, age unknown
});

test("shoot dates skip weekends and days off, and a pinned date moves the days after it", () => {
  // Fri 2026-11-06 start, Mon–Fri, Tue 10th off, day 4 pinned to Mon 16th
  const plan = P.normalize({ settings: { days: 5, start: "2026-11-06", perWeek: 5, off: ["2026-11-10"] }, days: [{}, {}, {}, { date: "2026-11-16" }, {}] });
  assert.deepStrictEqual(P.planDates(plan), ["2026-11-06", "2026-11-09", "2026-11-11", "2026-11-16", "2026-11-17"]);
  // no start date: days after a pinned one carry on from it
  const p2 = P.normalize({ settings: { days: 2 }, days: [{ date: "2026-12-01" }, {}] });
  assert.deepStrictEqual(P.planDates(p2), ["2026-12-01", "2026-12-02"]);
  // days off survive the database turning the list into an object
  assert.deepStrictEqual(P.normalize({ settings: { off: { 0: "2026-11-10", 1: "bad" } } }).settings.off, ["2026-11-10"]);
});

test("cast types survive the database and reach the breakdown options", () => {
  const p = P.normalize({ castType: { 0: { name: "ANA", t: "Lead" }, 1: { name: "BEN", t: "Hero" }, 2: { t: "Lead" } } });
  assert.deepStrictEqual(p.castType, [{ name: "ANA", t: "Lead" }]);
  assert.deepStrictEqual(P.analyzeOpts(p).types, { ANA: "Lead" });
  assert.strictEqual(P.analyzeOpts(P.normalize({})).types, undefined);
});

test("places: group, join, chain, rename, take out and split", () => {
  const m = (pl) => Object.fromEntries(pl.locMerge.map((x) => [x.from, x.to]));
  let pl = P.normalize({});
  P.groupLocs(pl, ["KITCHEN", "BEDROOM"], "house");
  assert.deepStrictEqual(m(pl), { BEDROOM: "HOUSE", KITCHEN: "HOUSE" });
  // the place itself (a script location) goes into a bigger place: its areas come with it
  P.groupLocs(pl, ["HOUSE", "BACKYARD"], "PROPERTY");
  assert.deepStrictEqual(m(pl), { BACKYARD: "PROPERTY", BEDROOM: "PROPERTY", HOUSE: "PROPERTY", KITCHEN: "PROPERTY" });
  // naming a location that's already in a place joins that place, never a loop
  P.groupLocs(pl, ["GARAGE"], "KITCHEN");
  assert.strictEqual(m(pl).GARAGE, "PROPERTY");
  P.groupLocs(pl, ["PROPERTY"], "KITCHEN");
  assert.ok(pl.locMerge.every((x) => P.locRoot(m(pl), x.from) === "PROPERTY"));
  // rename a pure group name; then rename one that is itself a location
  P.renamePlace(pl, "PROPERTY", "FARM", false);
  assert.ok(Object.values(m(pl)).every((v) => v === "FARM") && !m(pl).PROPERTY);
  P.ungroupLoc(pl, "GARAGE"); assert.strictEqual(m(pl).GARAGE, undefined);
  P.splitPlace(pl, "FARM"); assert.deepStrictEqual(pl.locMerge, []);
  // an old save with a loop doesn't hang
  assert.ok(["A", "B"].indexOf(P.locRoot({ A: "B", B: "A" }, "A")) >= 0);
});

test("elements shape the plan: shared specials group together, warnings use the needs", () => {
  const mk = (id, n, loc, extra) => Object.assign({ id, n, loc, set: loc, dn: "D", eighths: 8, cast: [], flags: [], needs: {}, specials: [] }, extra);
  const bd = { fromElements: true, cast: [{ name: "KID", minor: true, age: 9 }], totals: { eighths: 32 }, scenes: [
    mk("a", 1, "BARN", { specials: ["animals|horse"], needs: { animals: ["Horse"] } }),
    mk("b", 2, "HOUSE", { specials: [], needs: {} }),
    mk("c", 3, "FIELD", { specials: ["animals|horse"], needs: { animals: ["Horse"] }, cast: ["KID"] }),
    mk("d", 4, "SHOP", { specials: [], needs: {} })] };
  const plan = P.normalize({ days: [{ scenes: ["a"] }, { scenes: ["b"] }], settings: { days: 2, maxEighths: 16 } });
  assert.ok(P.fitScore(bd.scenes[2], [bd.scenes[0]]) > P.fitScore(bd.scenes[2], [bd.scenes[1]]), "the same horse on one day scores higher");
  assert.deepStrictEqual(P.dayStats({ scenes: ["a", "c"] }, P.sceneMap(bd), 24).needs.animals, ["Horse"]);
  const w = P.validate(P.normalize({ days: [{ scenes: ["c"] }], settings: { days: 1 } }), bd).map((x) => x.code);
  assert.ok(w.indexOf("NOWRANGLER") >= 0, "animals with no wrangler tagged");
  const bd2 = JSON.parse(JSON.stringify(bd)); bd2.scenes[2].needs.weapons = ["Shotgun"];
  assert.ok(P.validate(P.normalize({ days: [{ scenes: ["c"] }], settings: { days: 1 } }), bd2).some((x) => x.code === "KIDWEAPON"));
  void plan;
});

test("timetable: call, shoot and wrap per scene with the meal at six hours (matches a real day)", () => {
  // Day 1 of a real schedule: call 6:00, scenes of 2h30, 2h, 1h30, 2h; meal 12:00-12:30; wrap 5:00 pm
  const by = { a: { id: "a", n: 12, loc: "DINER", est: 150 }, b: { id: "b", n: 14, loc: "DINER", est: 120 }, c: { id: "c", n: 1, loc: "DINER", est: 90 }, d: { id: "d", n: 21, loc: "DINER", est: 120 } };
  const t = P.dayTimes({ scenes: ["a", "b", "c", "d"], call: "06:00" }, by, { call: "07:00" });
  const sc = t.rows.filter((r) => r.type === "scene");
  assert.deepStrictEqual(sc.map((r) => [r.call, r.shoot, r.wrap]), [["06:00", "07:00", "09:30"], ["09:30", "10:00", "12:00"], ["12:30", "13:00", "14:30"], ["14:30", "15:00", "17:00"]]);
  const meal = t.rows.find((r) => r.type === "meal");
  assert.deepStrictEqual([meal.start, meal.end], ["12:00", "12:30"]);
  assert.strictEqual(t.rows.indexOf(meal), 2);
  assert.strictEqual(t.call, "06:00"); assert.strictEqual(t.wrap, "17:00"); assert.strictEqual(t.est, 480);
});
test("timetable: the meal comes early rather than after six hours when the next scene is long (day 3)", () => {
  const by = { a: { id: "a", loc: "HWY", est: 120 }, b: { id: "b", loc: "HWY", est: 105 }, c: { id: "c", loc: "HWY", est: 120 } };
  const t = P.dayTimes({ scenes: ["a", "b", "c"], call: "06:00" }, by, { call: "07:00", times: { prep: 30 } });
  const meal = t.rows.find((r) => r.type === "meal");
  assert.deepStrictEqual([meal.start, meal.end], ["10:45", "11:15"]);
  assert.strictEqual(t.rows.filter((r) => r.type === "scene")[2].shoot, "11:45");
});
test("timetable: a company move when the location changes; settings, defaults and empty days", () => {
  const by = { a: { id: "a", loc: "STREET", est: 60 }, b: { id: "b", loc: "BRIDGE", est: 60 }, c: { id: "c", loc: "BRIDGE", eighths: 12 } };
  const t = P.dayTimes({ scenes: ["a", "b", "c"] }, by, { call: "07:00" });
  const mv = t.rows.find((r) => r.type === "move");
  assert.deepStrictEqual([mv.from, mv.to, mv.start, mv.end], ["STREET", "BRIDGE", "09:00", "09:30"]);
  assert.strictEqual(t.rows.filter((r) => r.type === "scene")[2].est, 90);   // no Est.: about an hour a page (1 4/8 pages)
  assert.ok(!P.dayTimes({ scenes: ["a", "b"] }, by, { call: "07:00", times: { move: 0 } }).rows.some((r) => r.type === "move"));
  const e = P.dayTimes({ scenes: [] }, by, { call: "07:00" }); assert.strictEqual(e.wrap, ""); assert.strictEqual(e.rows.length, 0);
  assert.deepStrictEqual(P.timeSettings({ times: { prep: "45", turn: -5, meal: "x" } }), Object.assign({}, P.TIME_DEFAULTS, { prep: 45 }));
  assert.strictEqual(P.toHM(25 * 60 + 5), "01:05");
  const tt = P.timetable({ settings: { days: 2, call: "07:00" }, days: [{ scenes: ["a"] }, { scenes: [] }] }, by);
  assert.strictEqual(tt.length, 2); assert.strictEqual(tt[0].rows[0].shoot, "08:00"); assert.strictEqual(tt[1].wrap, "");
});

test("sunrise and sunset: known places and dates, and no sunrise at the pole in summer", () => {
  const hm = (iso, lat, lng, tz) => { const t = P.sunTimes(iso, lat, lng); return [P.hmIn(t.rise, tz), P.hmIn(t.set, tz)]; };
  const near = (a, b) => Math.abs(P.toMin(a) - P.toMin(b)) <= 3;
  const [r1, s1] = hm("2026-06-21", 51.5072, -0.1276, "Europe/London"); assert.ok(near(r1, "04:43") && near(s1, "21:21"), r1 + " " + s1);
  const [r2, s2] = hm("2024-11-04", 34.0522, -118.2437, "America/Los_Angeles"); assert.ok(near(r2, "06:15") && near(s2, "16:58"), r2 + " " + s2);
  const [r3, s3] = hm("2026-11-04", -37.8136, 144.9631, "Australia/Melbourne"); assert.ok(near(r3, "06:10") && near(s3, "19:57"), r3 + " " + s3);
  assert.strictEqual(P.sunTimes("2026-06-21", 78.2, 15.6), null);
  assert.strictEqual(P.sunTimes("", 1, 1), null);
});
test("plan keeps day timing, places and scene status; drops junk", () => {
  const pl = P.normalize({ settings: { times: { prep: 45, turn: "", meal: -1 }, where: { name: "Melbourne", lat: -37.81, lng: 144.96, tz: "Australia/Melbourne" } },
    days: [{ scenes: ["a"], where: { name: "Geelong", lat: -38.15, lng: 144.36 } }, { scenes: [], where: { name: "" } }],
    status: [{ id: "a", s: "Shot" }, { id: "b", s: "Scheduled" }, { id: "c", s: "bogus" }] });
  assert.deepStrictEqual(pl.settings.times, { prep: 45 });
  assert.strictEqual(pl.settings.where.tz, "Australia/Melbourne");
  assert.strictEqual(pl.days[0].where.name, "Geelong"); assert.ok(!pl.days[1].where);
  assert.strictEqual(P.whereOf(pl, 0).name, "Geelong"); assert.strictEqual(P.whereOf(pl, 1).name, "Melbourne");
  assert.deepStrictEqual(pl.status, [{ id: "a", s: "Shot" }]);
  assert.strictEqual(P.statusOf(pl, "a"), "Shot"); assert.strictEqual(P.statusOf(pl, "z"), "Scheduled");
  P.setStatus(pl, "a", "Scheduled"); assert.deepStrictEqual(pl.status, []);
  P.setStatus(pl, "a", "Part shot"); assert.strictEqual(P.statusOf(pl, "a"), "Part shot");
  assert.strictEqual(P.cleanWhere({ name: "X", lat: 0, lng: 0 }).lat, undefined);
  assert.strictEqual(P.cleanWhere({ name: "X", tz: "bad tz!" }).tz, undefined);
  // the timetable reads the settings that were kept
  assert.strictEqual(P.dayTimes({ scenes: ["a"] }, { a: { id: "a", est: 60 } }, pl.settings).rows[0].shoot, "07:45");
});

console.log(`\n${passed} passed, ${failed} failed`);
if(failed) process.exit(1);
