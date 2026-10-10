// Tests for the Production panel's save / undo / script-sync logic (the pure parts in production.js).
// Run: node tests/prodpanel.test.js
"use strict";
const assert = require("assert");
const P = require("../production.js");

let passed = 0, failed = 0;
function test(name, fn){ try{ fn(); passed++; console.log("  ok  " + name); }catch(e){ failed++; console.log("  FAIL " + name + "\n       " + (e && e.message)); } }

const bd = {
  scenes: [
    { n: 1, id: "s1", loc: "HOUSE", dn: "D", eighths: 16, cast: ["ANA"] },
    { n: 2, id: "s2", loc: "PARK", dn: "D", eighths: 12, cast: ["ANA"] },
    { n: 3, id: "s3", loc: "HOUSE", dn: "N", eighths: 10, cast: ["BEN"] },
    { n: 4, id: "s4", loc: "HOUSE", dn: "D", eighths: 6, cast: ["BEN"] }
  ],
  cast: [{ name: "ANA" }, { name: "BEN" }]
};
const mk = (days, extra) => P.normalize(Object.assign({ scriptId: "doc1", settings: { days: days.length, maxEighths: 40 }, days: days.map((scenes) => ({ scenes })) }, extra || {}));
const all = (plan) => plan.days.map((d) => d.scenes);
const baseOf = (b) => b.scenes.map(P.sceneLook);   // every scene recorded as it is now

console.log("Production panel");

/* ---------- moving scenes ---------- */
test("move a scene to another day, at a position", () => {
  const { plan, from } = P.moveSceneIn(mk([["s1", "s2"], ["s3"]]), "s1", 1, 0);
  assert.strictEqual(from, 0);
  assert.deepStrictEqual(all(plan), [["s2"], ["s1", "s3"]]);
});
test("move to Unscheduled (-1) takes it off every day", () => {
  const { plan, from } = P.moveSceneIn(mk([["s1"], ["s2"]]), "s2", -1, -1);
  assert.strictEqual(from, 1);
  assert.deepStrictEqual(all(plan), [["s1"], []]);
});
test("reorder on the same day, and an out-of-range position goes on the end", () => {
  assert.deepStrictEqual(all(P.moveSceneIn(mk([["s1", "s2", "s3"]]), "s3", 0, 0).plan), [["s3", "s1", "s2"]]);
  assert.deepStrictEqual(all(P.moveSceneIn(mk([["s1"], []]), "s1", 1, 99).plan), [[], ["s1"]]);
});
test("moving to a day that doesn't exist never loses the scene silently", () => {
  const { plan } = P.moveSceneIn(mk([["s1"]]), "s1", 5, -1);
  assert.deepStrictEqual(all(plan), [[]]);   // back in Unscheduled, still in the script
  assert.ok(P.reconcile(plan, bd).unscheduled.indexOf("s1") >= 0);
});
test("placing new scenes uses suggested days and skips ones already placed", () => {
  const plan = P.placeScenes(mk([["s1"], ["s2"]]), ["s4", "s2"], bd);
  assert.deepStrictEqual(all(plan), [["s1", "s4"], ["s2"]]);   // s4 joins HOUSE; s2 stays put
});

/* ---------- undo / redo ---------- */
test("undo steps back, redo steps forward", () => {
  const h = P.histNew();
  let plan = mk([["s1"], []]);
  P.histRemember(h, plan, 1000);
  plan = P.moveSceneIn(plan, "s1", 1, -1).plan;
  const back = P.histStep(h, plan, true);
  assert.deepStrictEqual(back.days.map((d) => d.scenes), [["s1"], []]);
  const fwd = P.histStep(h, P.normalize(back), false);
  assert.deepStrictEqual(fwd.days.map((d) => d.scenes), [[], ["s1"]]);
});
test("nothing to undo returns null", () => {
  assert.strictEqual(P.histStep(P.histNew(), mk([[]]), true), null);
  assert.strictEqual(P.histStep(P.histNew(), mk([[]]), false), null);
});
test("quick edits within 700 ms are one undo step; a pause makes a new one", () => {
  const h = P.histNew();
  P.histRemember(h, mk([["s1"]]), 1000);
  P.histRemember(h, mk([["s2"]]), 1300);   // typing a time: same step
  assert.strictEqual(h.undo.length, 1);
  P.histRemember(h, mk([["s3"]]), 3000);
  assert.strictEqual(h.undo.length, 2);
});
test("a new edit clears redo", () => {
  const h = P.histNew();
  P.histRemember(h, mk([["s1"]]), 1000);
  P.histStep(h, mk([["s2"]]), true);
  assert.strictEqual(h.redo.length, 1);
  P.histRemember(h, mk([["s3"]]), 5000);
  assert.strictEqual(h.redo.length, 0);
});
test("history is capped at 80 steps", () => {
  const h = P.histNew();
  for(let i = 0; i < 100; i++) P.histRemember(h, mk([[]], { scriptId: "doc" + i }), i * 1000);
  assert.strictEqual(h.undo.length, 80);
});
test("undo never brings back old call-sheet links, and save stamps aren't edits", () => {
  const h = P.histNew();
  const before = mk([["s1"]]); before.callsheets = { at: 1, days: [{ day: 1, url: "old" }] }; before.updatedAt = 5;
  P.histRemember(h, before, 1000);
  const now = mk([[]]); now.callsheets = { at: 9, days: [{ day: 1, url: "new" }] };
  const back = P.histStep(h, now, true);
  assert.strictEqual(back.callsheets.days[0].url, "new");
  assert.strictEqual(back.updatedAt, undefined);
  const a = mk([["s1"]]), b = mk([["s1"]]); a.updatedAt = 1; b.updatedAt = 2; a.by = "x";
  a.days.forEach((d, i) => { b.days[i].id = d.id; });   // same plan, different stamps
  assert.strictEqual(P.histKey(a), P.histKey(b));
});

/* ---------- keeping the plan in line with the script ---------- */
test("first open: no known list, so it saves and records every scene", () => {
  const r = P.syncWithScript(mk([["s1"]]), undefined, bd, "doc1");
  assert.strictEqual(r.save, true);
  assert.deepStrictEqual(r.added, []);   // nothing is "new" the first time
  assert.deepStrictEqual(r.plan.known, ["s1", "s2", "s3", "s4"]);
});
test("nothing changed: no save (so the panel doesn't write on every draw)", () => {
  const r = P.syncWithScript(mk([["s1"]], { base: baseOf(bd) }), ["s1", "s2", "s3", "s4"], bd, "doc1");
  assert.strictEqual(r.save, false);
  assert.deepStrictEqual(r.unscheduled, ["s2", "s3", "s4"]);
});
test("a scene added to the script is reported as new and Unscheduled", () => {
  const r = P.syncWithScript(mk([["s1"]]), ["s1", "s2", "s3"], bd, "doc1");
  assert.strictEqual(r.save, true);
  assert.deepStrictEqual(r.added, ["s4"]);
  assert.ok(r.unscheduled.indexOf("s4") >= 0);
});
test("a scene deleted from the script comes off its day and is reported", () => {
  const r = P.syncWithScript(mk([["s1", "gone"], ["s2"]]), ["s1", "s2", "s3", "s4", "gone"], bd, "doc1");
  assert.strictEqual(r.save, true);
  assert.deepStrictEqual(r.removed, [{ id: "gone", day: 1 }]);
  assert.deepStrictEqual(all(r.plan), [["s1"], ["s2"]]);
});
test("switching script saves the new script id", () => {
  const r = P.syncWithScript(mk([[]]), ["s1", "s2", "s3", "s4"], bd, "doc2");
  assert.strictEqual(r.save, true);
  assert.strictEqual(r.plan.scriptId, "doc2");
});
test("the database handing lists back as objects doesn't lose scheduled scenes", () => {
  const raw = { scriptId: "doc1", base: Object.assign({}, baseOf(bd)), settings: { days: 2 }, days: { 0: { scenes: { 0: "s1", 1: "s2" } }, 1: { scenes: { 0: "s3" } } } };
  const r = P.syncWithScript(P.normalize(raw), ["s1", "s2", "s3", "s4"], bd, "doc1");
  assert.deepStrictEqual(all(r.plan), [["s1", "s2"], ["s3"]]);
  assert.strictEqual(r.save, false);
});

/* ---------- call sheets ---------- */
test("call sheets go stale when the plan is saved more than 5 s after they were made", () => {
  assert.strictEqual(P.callsheetsStale({ updatedAt: 20000, callsheets: { at: 10000 } }), true);
  assert.strictEqual(P.callsheetsStale({ updatedAt: 14000, callsheets: { at: 10000 } }), false);   // the Sync's own save
  assert.strictEqual(P.callsheetsStale({ updatedAt: 20000 }), false);                              // none made yet
  assert.strictEqual(P.callsheetsStale(null), false);
});
test("normalize keeps call-sheet links as they are", () => {
  const cs = { at: 1, folderUrl: "f", days: { 0: { day: 1, url: "u" } } };
  assert.strictEqual(P.normalize({ callsheets: cs }).callsheets, cs);
});

/* ---------- shot list ---------- */
const sl = {
  scenes: [{ n: 1, id: "s1" }, { n: 2, id: "s2" }, { n: 3, id: "s3" }, { n: 9, id: "x9", isExtra: true }],
  shots: [
    { key: "k1", scene: 1, shot: "1A", size: "WS", desc: "Wide", status: "Shot" },
    { key: "k2", scene: 1, shot: "1B", size: "CU" },
    { key: "k3", scene: 3, shot: 1, size: "MS" },
    { key: "k4", scene: 9, shot: "9A" },       // a scene added only on the storyboard
    { key: "k5", scene: 7, shot: "7A" }        // no such scene
  ]
};
test("shots join to scenes by the heading's permanent id, in shot order", () => {
  const m = P.shotsBySceneId(sl);
  assert.deepStrictEqual(Object.keys(m).sort(), ["s1", "s3"]);
  assert.deepStrictEqual(m.s1.map((x) => x.shot), ["1A", "1B"]);
  assert.strictEqual(m.s1[0].status, "Shot");
  assert.strictEqual(m.s3[0].shot, "1");   // numbers come back as text
});
test("renumbered scenes keep their shots (the id, not the number, is the link)", () => {
  const renum = { scenes: [{ n: 5, id: "s1" }], shots: [{ scene: 5, shot: "1A" }] };
  assert.deepStrictEqual(P.shotsBySceneId(renum).s1.map((x) => x.shot), ["1A"]);
});
test("a bad or missing shot list gives no shots, never an error", () => {
  assert.deepStrictEqual(P.shotsBySceneId(null), {});
  assert.deepStrictEqual(P.shotsBySceneId({ ok: false }), {});
  assert.deepStrictEqual(P.shotsBySceneId({ scenes: [{ n: 1 }], shots: [{ scene: 1 }] }), {});   // scene without an id
});
test("a day's shots follow the day's scene order and add up", () => {
  const m = P.shotsBySceneId(sl);
  const ds = P.dayShots({ scenes: ["s3", "s2", "s1"] }, m);
  assert.deepStrictEqual(ds.scenes.map((x) => [x.id, x.shots.length]), [["s3", 1], ["s2", 0], ["s1", 2]]);
  assert.strictEqual(ds.total, 3);
  assert.strictEqual(P.dayShots({ scenes: [] }, m).total, 0);
});

/* ---------- script revisions on the stripboard ---------- */
const edit = (id, ch) => ({ scenes: bd.scenes.map((s) => s.id === id ? Object.assign({}, s, ch) : s), cast: bd.cast });
const KNOWN = ["s1", "s2", "s3", "s4"];
test("an older plan records each scene's look once, with nothing flagged", () => {
  const r = P.syncWithScript(mk([["s1"]]), KNOWN, bd, "doc1");
  assert.strictEqual(r.save, true);
  assert.deepStrictEqual(r.changed, []);
  assert.strictEqual(r.plan.base.length, 4);
  const again = P.syncWithScript(P.normalize(r.plan), KNOWN, bd, "doc1");   // and then it's quiet
  assert.strictEqual(again.save, false);
});
test("a scheduled scene that got longer, gained cast, moved location or switched to night is flagged", () => {
  const plan = mk([["s1", "s3"], []], { base: baseOf(bd) });
  const r = P.syncWithScript(plan, KNOWN, edit("s1", { eighths: 24, cast: ["ANA", "CAL"], oloc: "BARN", loc: "BARN", dn: "N" }), "doc1");
  assert.strictEqual(r.changed.length, 1);
  assert.deepStrictEqual(r.changed[0].what, ["length", "cast", "location", "day/night"]);
  assert.strictEqual(r.changed[0].day, 1);
  assert.strictEqual(r.changed[0].from.e, 16); assert.strictEqual(r.changed[0].to.e, 24);
  assert.strictEqual(r.save, false);   // the flag stays until accepted: nothing to write
});
test("the flag stays on every draw until accepted, then clears", () => {
  const bd2 = edit("s1", { eighths: 24 });
  let plan = mk([["s1"]], { base: baseOf(bd) });
  assert.strictEqual(P.syncWithScript(plan, KNOWN, bd2, "doc1").changed.length, 1);
  assert.strictEqual(P.syncWithScript(plan, KNOWN, bd2, "doc1").changed.length, 1);
  plan = P.normalize(P.acceptChanges(plan, bd2, []));
  const r = P.syncWithScript(plan, KNOWN, bd2, "doc1");
  assert.deepStrictEqual(r.changed, []); assert.strictEqual(r.save, false);
});
test("accepting one scene leaves the others flagged", () => {
  const bd2 = { scenes: edit("s1", { eighths: 24 }).scenes.map((s) => s.id === "s3" ? Object.assign({}, s, { dn: "D" }) : s), cast: bd.cast };
  const plan = P.normalize(P.acceptChanges(mk([["s1", "s3"]], { base: baseOf(bd) }), bd2, ["s1"]));
  assert.deepStrictEqual(P.syncWithScript(plan, KNOWN, bd2, "doc1").changed.map((c) => c.id), ["s3"]);
});
test("unscheduled scenes are re-recorded quietly, so they aren't flagged once placed", () => {
  const bd2 = edit("s2", { eighths: 40 });
  const r = P.syncWithScript(mk([["s1"]], { base: baseOf(bd) }), KNOWN, bd2, "doc1");
  assert.deepStrictEqual(r.changed, []);
  assert.strictEqual(r.save, true);                               // s2's new look is recorded
  const placed = P.moveSceneIn(P.normalize(r.plan), "s2", 0, -1).plan;
  assert.deepStrictEqual(P.syncWithScript(placed, KNOWN, bd2, "doc1").changed, []);
});
test("renumbering scenes and merging rooms into one location aren't revisions", () => {
  const renum = { scenes: bd.scenes.map((s) => Object.assign({}, s, { n: s.n + 1 })), cast: bd.cast };
  assert.deepStrictEqual(P.syncWithScript(mk([["s1"]], { base: baseOf(bd) }), KNOWN, renum, "doc1").changed, []);
  const merged = edit("s1", { oloc: "HOUSE", loc: "FARM" });       // locMerge changes loc, not oloc
  assert.deepStrictEqual(P.syncWithScript(mk([["s1"]], { base: baseOf(bd) }), KNOWN, merged, "doc1").changed, []);
});
test("cast order doesn't count as a change", () => {
  const two = edit("s1", { cast: ["ANA", "BEN"] }), plan = mk([["s1"]], { base: baseOf(two) });
  assert.deepStrictEqual(P.syncWithScript(plan, KNOWN, edit("s1", { cast: ["BEN", "ANA"] }), "doc1").changed, []);
});
test("switching to another script records it fresh instead of flagging everything", () => {
  const other = { scenes: bd.scenes.map((s) => Object.assign({}, s, { eighths: 99 })), cast: bd.cast };
  const r = P.syncWithScript(mk([["s1"]], { base: baseOf(bd) }), KNOWN, other, "doc2");
  assert.deepStrictEqual(r.changed, []);
  assert.strictEqual(r.plan.base[0].e, 99);
});
test("a deleted scene drops out of the record", () => {
  const less = { scenes: bd.scenes.filter((s) => s.id !== "s4"), cast: bd.cast };
  const r = P.syncWithScript(mk([["s1"]], { base: baseOf(bd) }), KNOWN, less, "doc1");
  assert.strictEqual(r.save, true);
  assert.deepStrictEqual(r.plan.base.map((b) => b.id), ["s1", "s2", "s3"]);
});
test("undo snapshots include the record, so undoing an accept brings the flag back", () => {
  const bd2 = edit("s1", { eighths: 24 }), h = P.histNew();
  let plan = mk([["s1"]], { base: baseOf(bd) });
  P.histRemember(h, plan, 1000);
  plan = P.normalize(P.acceptChanges(plan, bd2, []));
  const back = P.normalize(P.histStep(h, plan, true));
  assert.strictEqual(P.syncWithScript(back, KNOWN, bd2, "doc1").changed.length, 1);
});

console.log(`\n${passed} passed, ${failed} failed`);
if(failed) process.exit(1);
