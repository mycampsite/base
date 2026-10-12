// Tests for breakdown elements (elements.js). Run: node tests/elements.test.js
// No dependencies. Every deploy runs this first; a failure stops the deploy.
"use strict";
const assert = require("assert");
const B = require("../breakdown.js");
const E = require("../elements.js");

let passed = 0, failed = 0;
function test(name, fn){
  try{ fn(); passed++; console.log("  ok  " + name); }
  catch(e){ failed++; console.log("  FAIL " + name + "\n       " + (e && e.message)); }
}
function doc(lines){
  return { title: { title: "TEST" }, lines: lines.map(([type, text], i) => ({ id: "l" + i, type, runs: [{ t: text }] })), pageSettings: { pageSize: "letter" } };
}
function run(lines, store){ const d = doc(lines), bd = B.analyze(d); return E.build(d, bd, store || {}); }
const names = (b, n, cat) => (b.scenes[n - 1].els[cat] || []).map((k) => b.elements[k].name);

console.log("Breakdown elements");

test("every category has an id, label and colour, and ids are unique", () => {
  const ids = {};
  E.CATS.forEach((c) => { assert.ok(c.id && c.label && /^#[0-9a-f]{6}$/i.test(c.color), c.id); assert.ok(!ids[c.id], "dup " + c.id); ids[c.id] = 1; });
  ["cast", "background", "stunts", "vehicles", "props", "wardrobe", "makeup", "sfx", "vfx", "animals", "music", "sound", "setdress", "equipment"].forEach((id) => assert.ok(ids[id], id));
});

test("cast come from the breakdown, numbered in cast order", () => {
  const b = run([["scene", "INT. HOUSE - DAY"], ["character", "MUM"], ["dialogue", "Hi."], ["character", "JIMMY"], ["dialogue", "Yo."], ["scene", "INT. HALL - DAY"], ["character", "MUM"], ["dialogue", "Bye."]]);
  assert.deepStrictEqual(names(b, 1, "cast").sort(), ["JIMMY", "MUM"]);
  const mum = b.elements["cast|mum"];
  assert.ok(mum.no >= 1); assert.deepStrictEqual(mum.scenes, [1, 2]);
});

test("props: CAPS objects and everyday objects with a/the/her in front", () => {
  const b = run([["scene", "INT. KITCHEN - DAY"], ["character", "ANA"], ["dialogue", "Go."], ["action", "ANA grabs her phone and a battered SUITCASE. The KETTLE screams."]]);
  const p = names(b, 1, "props");
  ["Phone", "Suitcase", "Kettle"].forEach((x) => assert.ok(p.includes(x), x + " in " + p));
});

test("props: verbs and cast names don't count", () => {
  const b = run([["scene", "EXT. PARK - DAY"], ["character", "BOOK"], ["dialogue", "Hey."], ["action", "Two COPS watch. The kids watch cartoons. BOOK waves. She will book a table."]]);
  const p = names(b, 1, "props");
  assert.ok(!p.includes("Watch"), "watch: " + p); assert.ok(!p.includes("Book"), "book: " + p);
  assert.ok(names(b, 1, "background").includes("Cops"));
});

test("CAPS sounds go to Sound, not Props", () => {
  const b = run([["scene", "INT. HOUSE - NIGHT"], ["action", "The door SLAMS. A phone BUZZES. We hear a distant siren."]]);
  const s = names(b, 1, "sound");
  ["Slam", "Buzz", "Siren"].forEach((x) => assert.ok(s.includes(x), x + " in " + s));
  assert.ok(!names(b, 1, "props").includes("Slam"));
});

test("weapons bring the armourer and weapons safety; one gun, not two", () => {
  const b = run([["scene", "INT. BARN - NIGHT"], ["action", "He picks up a SHOTGUN."]]);
  assert.deepStrictEqual(names(b, 1, "weapons"), ["Shotgun"]);
  assert.ok(names(b, 1, "labor").includes("Armourer"));
  assert.ok(names(b, 1, "security").includes("Weapons safety"));
  assert.ok(!names(b, 1, "props").includes("Shotgun"));
});

test("vehicles, driving, animals and their wranglers", () => {
  const b = run([["scene", "EXT. ROAD - DAY"], ["action", "Jo drives off in the car. A dog chases it."]]);
  assert.ok(names(b, 1, "vehicles").includes("Car"));
  assert.ok(names(b, 1, "equipment").includes("Tow rig / process trailer"));
  assert.ok(names(b, 1, "animals").includes("Dog"));
  assert.ok(names(b, 1, "wrangler").includes("Dog wrangler"));
});

test("special effects, stunts and makeup use standard names", () => {
  const b = run([["scene", "EXT. FIELD - NIGHT"], ["action", "Rain pours down. They fight. He falls down the bank, bleeding. Smoke drifts."]]);
  assert.ok(names(b, 1, "sfx").includes("Rain")); assert.ok(names(b, 1, "sfx").includes("Smoke"));
  assert.ok(names(b, 1, "stunts").includes("Fight")); assert.ok(names(b, 1, "stunts").includes("Fall"));
  assert.ok(names(b, 1, "labor").includes("Stunt coordinator"));
  assert.ok(names(b, 1, "makeup").includes("Blood"));
  assert.ok(names(b, 1, "equipment").includes("Night exterior lighting"));
});

test("wardrobe says whose it is", () => {
  const b = run([["scene", "INT. HALL - DAY"], ["character", "MUM"], ["dialogue", "Ready?"], ["action", "MUM, in a red dress, waits."]]);
  assert.deepStrictEqual(names(b, 1, "wardrobe"), ["Mum: red dress"]);
});

test("the same element across scenes is one element with all its scenes", () => {
  const b = run([["scene", "INT. A - DAY"], ["action", "She checks her phone."], ["scene", "INT. B - DAY"], ["action", "The phone rings."], ["scene", "INT. C - DAY"], ["action", "Phones everywhere. She drops the phones."]]);
  assert.deepStrictEqual(b.elements["props|phone"].scenes, [1, 2, 3]);
});

test("story days: night to morning, LATER headings, flashbacks don't move the day", () => {
  const b = run([["scene", "INT. A - DAY"], ["action", "x"], ["scene", "INT. A - NIGHT"], ["action", "x"], ["scene", "INT. A - MORNING"], ["action", "x"],
    ["scene", "EXT. B - DAY - FLASHBACK"], ["action", "x"], ["scene", "INT. A - CONTINUOUS"], ["action", "x"], ["scene", "INT. C - THREE WEEKS LATER - DAY"], ["action", "x"]]);
  assert.deepStrictEqual(b.scenes.map((s) => s.day), ["D1", "N1", "D2", "Flashback", "D2", "D3"]);
});

test("estimates: about an hour a page, heavier for stunts, never under 15 minutes", () => {
  assert.strictEqual(E.estimate({ eighths: 8, flags: [] }), 60);
  assert.strictEqual(E.estimate({ eighths: 8, flags: ["stunts"] }), 90);
  assert.strictEqual(E.estimate({ eighths: 8, flags: ["stunts", "weapons"] }), 95);
  assert.strictEqual(E.estimate({ eighths: 1, flags: [] }), 15);
});

test("store: tag by hand, take out of one scene, ignore everywhere", () => {
  const lines = [["scene", "INT. A - DAY"], ["action", "She checks her phone."], ["scene", "INT. B - DAY"], ["action", "The phone rings."]];
  let st = E.tag({}, "l0", "setdress", "Fairy lights");
  let b = run(lines, st);
  assert.deepStrictEqual(names(b, 1, "setdress"), ["Fairy lights"]);
  assert.ok(b.elements["setdress|fairy light"].manual);
  st = E.untag(st, "l2", "props|phone");
  b = run(lines, st);
  assert.deepStrictEqual(b.elements["props|phone"].scenes, [1]);
  st = E.drop(st, "props|phone");
  b = run(lines, st);
  assert.ok(!b.elements["props|phone"]);
  st = E.undrop(st, "props|phone"); st = E.tag(st, "l2", "props", "phone");
  b = run(lines, st);
  assert.deepStrictEqual(b.elements["props|phone"].scenes, [1, 2]);
});

test("store: rename, merge, move category, notes follow, no loops", () => {
  const lines = [["scene", "INT. A - DAY"], ["action", "She checks her phone. He opens his laptop."]];
  let st = E.rename({}, "props|phone", "props", "Sarah's iPhone");
  st = E.setNote(st, "props|sarah's iphone", "Cracked screen");
  st = E.merge(st, ["props|laptop"], "props|sarah's iphone");
  let b = run(lines, st);
  const e = b.elements["props|sarah's iphone"];
  assert.strictEqual(e.name, "Sarah's iPhone"); assert.strictEqual(e.note, "Cracked screen");
  assert.ok(!b.elements["props|laptop"] && !b.elements["props|phone"]);
  st = E.rename(st, "props|sarah's iphone", "art", "Phone screen graphics");
  st = E.rename(st, E.key("art", "Phone screen graphics"), "props", "Sarah's iPhone");   // back again: must not loop
  b = run(lines, st);
  assert.ok(b.elements["props|sarah's iphone"]);
  assert.strictEqual(b.elements["props|sarah's iphone"].note, "Cracked screen");
});

test("store: scene sheet fields override the automatic ones and can be cleared", () => {
  const lines = [["scene", "INT. A - DAY"], ["action", "Something happens."]];
  let st = E.setScene({}, "l0", "syn", "Ana finds the letter");
  st = E.setScene(st, "l0", "day", "D4"); st = E.setScene(st, "l0", "est", "120");
  let s = run(lines, st).scenes[0];
  assert.strictEqual(s.syn, "Ana finds the letter"); assert.strictEqual(s.day, "D4"); assert.strictEqual(s.est, 120);
  assert.ok(!s.synAuto && !s.dayAuto && !s.estAuto);
  st = E.setScene(st, "l0", "est", ""); st = E.setScene(st, "l0", "day", ""); st = E.setScene(st, "l0", "syn", "");
  s = run(lines, st).scenes[0];
  assert.ok(s.synAuto && s.dayAuto && s.estAuto); assert.deepStrictEqual(st.scene || {}, {});
});

test("store edits never change the store they were given", () => {
  const st = { tags: { l0: [{ c: "props", n: "Cup" }] } }, before = JSON.stringify(st);
  E.tag(st, "l0", "props", "Mug"); E.untag(st, "l0", "props|cup"); E.drop(st, "props|cup"); E.rename(st, "props|cup", "props", "Mug"); E.setScene(st, "l0", "syn", "x");
  assert.strictEqual(JSON.stringify(st), before);
});

test("bad input: empty doc, missing breakdown, junk store", () => {
  assert.strictEqual(E.build(null, null, null).scenes.length, 0);
  const b = run([["scene", "INT. A - DAY"], ["action", "x"]], { tags: { l0: [null, { c: "nope", n: "x" }, { c: "props", n: "  " }] }, alias: { a: "a" }, drop: [] });
  assert.strictEqual(b.scenes[0].count, 0);
});

test("reports and CSV: one row per scene, one column per category", () => {
  const b = run([["scene", "INT. A - DAY"], ["action", "She checks her phone, then \"the phone\", again."]]);
  const rows = E.csv(b).split("\n");
  assert.strictEqual(rows.length, 2);
  assert.ok(rows[0].startsWith("Scene,Heading"));
  assert.strictEqual(E.report(b, "props")[0].name, "Phone");
  assert.strictEqual(E.fmtEighths(13), "1 5/8");
});

console.log(`\n${passed} passed, ${failed} failed`);
if(failed) process.exit(1);
