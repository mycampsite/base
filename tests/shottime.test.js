// Tests for the shot and scene time estimates (shottime.js). Run: node tests/shottime.test.js
"use strict";
const assert = require("assert");
const T = require("../shottime.js");

let passed = 0, failed = 0;
function test(name, fn){ try{ fn(); passed++; console.log("  ok  " + name); }catch(e){ failed++; console.log("  FAIL " + name + "\n       " + (e && e.message)); } }
const pick = (t) => [t.complexity, t.score, t.setup, t.shoot, t.exact, t.min];

// The spec's cases: exact minutes before rounding, then the 10-minute rounding the schedule uses
const kitchen = { id: "k", ie: "INT", dn: "N", eighths: 8, cast: ["JIMMY"], tags: [] };
const cu = (st) => ({ size: "CU", move: "Static", desc: "Jimmy reacts to the video camera in shock", st });
test("one CU at night: Simple 2.4, setup 35, shoot 8, 47 (50 rounded)", () => {
  const r = T.sceneShots(kitchen, [cu()]);
  assert.deepStrictEqual(pick(r.shots[0]), ["Simple", 2.4, 35, 8, 47, 50]);
  assert.strictEqual(r.exact, 47); assert.strictEqual(r.total, 50); assert.strictEqual(r.prep, 0);
});
test("three CUs: same / lens / move setups", () => {
  [["same", 3, 12, 71, 90], ["lens", 5, 14, 75, 90], ["move", 19, 30, 107, 110]].forEach(([st, setup, each, exact, total]) => {
    const r = T.sceneShots(kitchen, [cu(), cu(st), cu(st)]);
    assert.strictEqual(r.shots[1].st, st); assert.strictEqual(r.shots[1].setup, setup); assert.strictEqual(r.shots[1].exact, each);
    assert.strictEqual(r.exact, exact, st + " exact"); assert.strictEqual(r.total, total, st + " rounded");
  });
});
const alley = { id: "a", ie: "EXT", dn: "N", eighths: 12, cast: ["MAYA", "JIMMY"], tags: ["stunt", "water", "sfx", "weapons", "lightfx"] };
test("a stunt-heavy night exterior: WS chase, then a CU (shot 2)", () => {
  const r = T.sceneShots(alley, [{ size: "WS", desc: "Chase down the alley" }, { size: "CU", desc: "Maya spits blood" }]);
  assert.deepStrictEqual(pick(r.shots[0]), ["Extreme", 14.1, 126, 59, 204, 210]);
  assert.strictEqual(r.shots[0].mv, "hand"); assert.strictEqual(r.shots[0].li, 4); assert.strictEqual(r.shots[0].takes, 8);
  assert.deepStrictEqual(pick(r.shots[1]), ["Moderate", 7.4, 35, 14, 54, 60]);
  assert.strictEqual(r.shots[1].st, "move");
  // prep: stunt 45 + water 40 + sfx 30 + weapons 15 + lightfx 20 = 150, +10% = 165, rounded up 170
  assert.strictEqual(r.prepExact, 165); assert.strictEqual(r.prep, 170); assert.strictEqual(r.total, 170 + 210 + 60);
});

test("whole words only: scar is not a car, locate is not a cat, company is not a pan", () => {
  const sc = { ie: "INT", dn: "D", cast: ["ANA"], tags: ["car", "animals"] };
  const t = T.shotTime(sc, { size: "CU", desc: "Ana touches the scar, trying to locate the company file" }, { first: true });
  assert.deepStrictEqual(t.tags, []); assert.strictEqual(t.mv, "static");
  assert.deepStrictEqual(T.shotTime(sc, { size: "CU", desc: "The cars race past" }, { first: true }).tags, ["car"]);
});
test("shot list columns: sizes, MOVEMENT and EQUIPMENT dropdowns, CHARACTERS", () => {
  const sc = { ie: "INT", dn: "D", cast: ["A", "B", "C"], tags: [] };
  assert.strictEqual(T.shotTime(sc, { size: "TWO SHOT", move: "Steadicam/gimbal" }, { first: true }).mv, "steady");
  assert.strictEqual(T.shotTime(sc, { size: "MS", equip: "Slider" }, { first: true }).mv, "slider");
  assert.strictEqual(T.shotTime(sc, { size: "MS", move: "Truck", equip: "Slider" }, { first: true }).mv, "dolly");   // MOVEMENT beats EQUIPMENT
  assert.strictEqual(T.shotTime(sc, { size: "WS", cast: "A, B" }, { first: true }).cast, 2);
  assert.strictEqual(T.shotTime(sc, { size: "WS" }, { first: true }).cast, 3);
  assert.strictEqual(T.shotTime(sc, { size: "INSERT" }, { first: true }).cast, 0);
  assert.strictEqual(T.sizeOf({ size: "Close up" }), "CU"); assert.strictEqual(T.sizeOf({ size: "", angle: "POV" }), "POV"); assert.strictEqual(T.sizeOf({}), "MS");
});
test("tags: Insert sees props, manual ticks override, moving vehicle means a car rig", () => {
  const sc = { ie: "EXT", dn: "D", cast: ["A"], tags: ["props", "stunt", "drive"] };
  assert.deepStrictEqual(T.shotTime(sc, { size: "INSERT" }, { first: true }).tags.sort(), ["drive", "props"]);
  assert.deepStrictEqual(T.shotTime(sc, { size: "WS", inc: ["props"] }, { first: true }).tags.sort(), ["drive", "props"]);
  const t = T.shotTime(sc, { size: "MS" }, { first: true });
  assert.strictEqual(t.mv, "car"); assert.strictEqual(t.takeSec, 35 + 15);
  assert.ok(t.tags.indexOf("stunt") < 0);   // a mid shot doesn't see the stunt unless the description says so
});
test("setup type: the same size, move and cast again is a re-slate; a closer shot is a lens change", () => {
  const sc = { ie: "INT", dn: "D", cast: ["A"], tags: [] };
  const r = T.sceneShots(sc, [{ size: "CU" }, { size: "CU" }, { size: "CU", desc: "tighter on her eyes" }, { size: "WS" }]);
  assert.deepStrictEqual(r.shots.map((s) => s.st), ["new", "same", "lens", "move"]);
});
test("which time a scene gets: typed Est., else its shots once one is timed, else the breakdown's auto Est.", () => {
  const sc = Object.assign({}, kitchen, { est: 75, estAuto: true });
  assert.deepStrictEqual(T.sceneMinutes(sc, []), { min: 75, src: "auto" });
  assert.deepStrictEqual(T.sceneMinutes(sc, [cu()]), { min: 75, src: "auto" });   // shots with no typed minutes: still the breakdown's
  const s = T.sceneMinutes(sc, [Object.assign(cu(), { min: 30 }), cu("move")]); assert.strictEqual(s.src, "shots"); assert.strictEqual(s.min, 30 + 30);
  assert.deepStrictEqual(T.sceneMinutes(Object.assign({}, sc, { estAuto: false }), [Object.assign(cu(), { min: 30 })]), { min: 75, src: "manual" });
});
test("tags from the breakdown categories, crowd, minors and the ticked environment", () => {
  assert.deepStrictEqual(T.sceneTags({ els: { stunts: ["k"], mfx: ["x"], sfx: ["y"], vehicles: ["v"], cast: ["c"], props: [] }, bg: "Crowd", minors: true, env: ["water", "nope"] }),
    ["stunt", "sfx", "car", "crowd", "kids", "water"]);
});
test("config: rounding and contingency can be changed per project", () => {
  const r = T.sceneShots(kitchen, [cu()], { round: 1, cont: 0 });
  assert.strictEqual(r.shots[0].exact, 43); assert.strictEqual(r.total, 43);
  assert.strictEqual(T.ceilTo(40, 10), 40); assert.strictEqual(T.ceilTo(40.0000001, 10), 40); assert.strictEqual(T.ceilTo(41, 10), 50);
});

test("EST. MIN typed in the shot list wins for that shot; the estimate is still worked out", () => {
  const r = T.sceneShots(kitchen, [cu(), Object.assign(cu("move"), { min: 25 })]);
  assert.strictEqual(r.shots[1].typed, true); assert.strictEqual(r.shots[1].min, 25); assert.strictEqual(r.shots[1].auto, 30);
  assert.strictEqual(r.total, 50 + 25);
});

console.log("\n" + passed + " passed, " + failed + " failed");
if(failed) process.exit(1);
