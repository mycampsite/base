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

console.log(`\n${passed} passed, ${failed} failed`);
if(failed) process.exit(1);
