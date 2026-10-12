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
  ["Slam", "Buzz", "Siren"].forEach((x) => assert.ok(s.some((n) => n.toLowerCase().indexOf(x.toLowerCase()) >= 0), x + " in " + s));
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
  assert.ok(names(b, 1, "setdress").includes("Fairy lights"), names(b, 1, "setdress").join());
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

test("store: a tag remembers the words it was made from (for the editor's highlights)", () => {
  let st = E.tag({}, "l0", "props", "Shotgun", "SHOTGUN");
  st = E.tag(st, "l0", "props", "shotgun", "the old shotgun"); st = E.tag(st, "l0", "props", "Shotgun", "SHOTGUN");
  assert.strictEqual(st.tags.l0.length, 1);
  assert.deepStrictEqual(st.tags.l0[0].q, ["SHOTGUN", "the old shotgun"]);
  const b = run([["scene", "INT. A - DAY"], ["action", "x"]], st);
  assert.ok(b.scenes[0].els.props.length === 1);
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

test("sync: keys with Firebase-forbidden characters survive the round trip", () => {
  ["props|mr. smith's gun", "a/b#c$d[e]f", "100%", "x.y"].forEach((k) => {
    const e = E.encKey(k); assert.ok(!/[.#$\[\]\/]/.test(e), e); assert.strictEqual(E.decKey(e), k);
  });
});

test("sync: store -> Firebase tree -> store keeps everything", () => {
  let st = E.tag({}, "l0", "props", "Mr. Smith's gun", "the GUN");
  st = E.untag(st, "l4", "props|phone"); st = E.drop(st, "sound|bang");
  st = E.rename(st, "props|laptop", "props", "Sarah's iPhone"); st = E.setNote(st, "props|sarah's iphone", "Cracked");
  st = E.setScene(st, "l0", "syn", "A gun."); st = E.setScene(st, "l0", "est", 45);
  const back = E.fromRemote(JSON.parse(JSON.stringify(E.toRemote(st))));
  assert.deepStrictEqual(back, st);
});

test("sync: Firebase arrays that come back as objects are read", () => {
  const r = { tags: { l0: { [E.encKey("props|gun")]: { c: "props", n: "Gun", q: { 0: "GUN", 1: "a gun" } } } } };
  assert.deepStrictEqual(E.fromRemote(r).tags.l0[0].q, ["GUN", "a gun"]);
});

test("sync: an edit writes only the entries it changed", () => {
  let a = E.tag({}, "l0", "props", "Cup"); a = E.tag(a, "l2", "props", "Phone");
  const b = E.tag(a, "l0", "props", "Mug");
  assert.deepStrictEqual(Object.keys(E.diff(a, b)), ["tags/l0/props|mug"]);
  const c = E.untag(b, "l2", "props|phone");
  const d = E.diff(b, c);
  assert.strictEqual(d["tags/l2/props|phone"], null); assert.strictEqual(d["off/l2/props|phone"], true);
  assert.deepStrictEqual(E.diff(c, c), {});
  const e = E.setScene(c, "l0", "syn", "x"), f = E.setScene(e, "l0", "syn", "");
  assert.deepStrictEqual(E.diff(e, f), { "scene/l0": null });
});

test("sync: merging keeps both sides' tags; editor ops replay on the team's copy", () => {
  const team = E.tag({}, "l0", "props", "Cup", "a cup"), mine = E.tag(E.tag({}, "l0", "props", "Cup", "the CUP"), "l2", "sound", "Bang");
  const m = E.mergeStores(team, mine);
  assert.deepStrictEqual(m.tags.l0[0].q, ["a cup", "the CUP"]); assert.strictEqual(m.tags.l2[0].n, "Bang");
  const r = E.applyOps(team, [{ t: "tag", sk: "l2", c: "props", n: "Lamp", q: "LAMP" }, { t: "untag", sk: "l0", k: "props|cup" }, null, { t: "nope" }]);
  assert.strictEqual(r.tags.l2[0].n, "Lamp"); assert.ok(!r.tags.l0); assert.deepStrictEqual(r.off.l0, ["props|cup"]);
});

test("a real-style script: the things each department needs, and none of the usual false alarms", () => {
  const d = require("./fixtures/sample-script.js"), b = E.build(d, B.analyze(d), {});
  const all = (n) => { const s = b.scenes[n - 1]; const o = {}; Object.keys(s.els).forEach((c) => { o[c] = s.els[c].map((k) => b.elements[k].name); }); return o; };
  const has = (n, cat, name) => assert.ok((all(n)[cat] || []).includes(name), "sc " + n + " " + cat + " should have " + name + ": " + JSON.stringify(all(n)[cat] || []));
  const hasNot = (n, cat, name) => assert.ok(!(all(n)[cat] || []).includes(name), "sc " + n + " " + cat + " shouldn't have " + name);
  has(1, "vehicles", "Holden ute"); has(1, "stunts", "Vehicle crash"); has(1, "stunts", "Precision driving"); has(1, "equipment", "Rain towers");
  has(1, "wardrobe", "Maggie: wet costume (doubles)"); has(1, "props", "Thermos"); hasNot(1, "stunts", "Fight");
  has(2, "art", "Phone screen (graphic)"); has(2, "camera", "Car mount");
  has(3, "props", "Landline"); has(3, "props", "Tea towel"); has(3, "props", "Pint glass"); hasNot(3, "props", "Tea"); hasNot(3, "props", "Xxxx");
  has(3, "setdress", "Jukebox"); has(3, "setdress", "Mounted deer head"); has(3, "makeup", "Bandage");
  assert.strictEqual(b.scenes[2].qty[b.scenes[2].els.background[0]], 12);                     // "a dozen drinkers"
  has(4, "setdress", "Single bed"); has(4, "props", "Duffel bag"); has(4, "props", "Painkillers");
  hasNot(4, "animals", "Horse"); assert.ok(!all(4).background, "a room upstairs isn't a public bar");   // the horse is in a photograph
  has(5, "cast", "ELLIE"); has(5, "animals", "Kelpie"); has(5, "stunts", "Horse riding"); has(5, "labor", "Stunt double (child)"); has(5, "props", "Walking stick"); has(5, "wardrobe", "Ellie: gumboots");
  hasNot(5, "props", "Reid");
  has(6, "props", "Eggs"); has(6, "props", "Bacon"); has(6, "setdress", "Wood-fired stove"); has(6, "art", "Letter (graphic)"); has(6, "makeup", "Cuts & grazes"); hasNot(6, "props", "Fries");
  has(7, "art", "Bank statement (insert)"); hasNot(7, "weapons", "Rifle");                    // "rifles through a filing cabinet"
  has(8, "vehicles", "Road train"); has(8, "art", "Banner (graphic)");
  has(9, "sfx", "Fireworks (pyro)"); has(9, "labor", "Pyrotechnician"); has(9, "props", "Dagwood dog"); hasNot(9, "animals", "Dog"); hasNot(9, "setdress", "Swing");
  has(10, "stunts", "Fall from horse"); has(10, "wardrobe", "Ellie: riding helmet"); hasNot(10, "props", "Helmet");
  has(11, "cast", "FRANK"); has(11, "cast", "ELLIE"); has(11, "makeup", "Arm cast"); has(11, "setdress", "Heart monitor"); has(11, "music", "Recorded song (playback)"); has(11, "props", "Walkman");
  hasNot(11, "art", "Computer screen graphics"); hasNot(11, "props", "Singing");
  has(12, "weapons", "Shotgun"); has(12, "stunts", "Dive"); has(12, "cast", "FRANK"); hasNot(12, "props", "Broken");
  assert.ok(b.elements[E.key("props", "map")].hero, "a prop written in CAPS is a hero prop");
});

test("bad input: empty doc, missing breakdown, junk store", () => {
  assert.strictEqual(E.build(null, null, null).scenes.length, 0);
  const b = run([["scene", "INT. A - DAY"], ["action", "x"]], { tags: { l0: [null, { c: "nope", n: "x" }, { c: "props", n: "  " }] }, alias: { a: "a" }, drop: [] });
  assert.deepStrictEqual(Object.keys(b.scenes[0].els), ["setdress"]);   // only the set itself
});

test("reports and CSV: one row per scene, one column per category", () => {
  const b = run([["scene", "INT. A - DAY"], ["action", "She checks her phone, then \"the phone\", again."]]);
  const rows = E.csv(b).split("\n");
  assert.strictEqual(rows.length, 2);
  assert.ok(rows[0].startsWith("Scene,Heading"));
  assert.strictEqual(E.report(b, "props")[0].name, "Phone");
  assert.strictEqual(E.fmtEighths(13), "1 5/8");
});

test("enrich: element sheets drive each scene's cast, flags and needs for the plan", () => {
  const P = require("../production.js");
  const d = require("./fixtures/sample-script.js"), bd = B.analyze(d);
  const sk = bd.scenes[4].id;                                            // paddock: Ellie, Frank, pony, kelpie
  let st = {}, m = E.build(d, bd, st), en = E.enrich(bd, m, st, {});
  const s5 = en.scenes[4];
  assert.ok(s5.flags.indexOf("animals") >= 0, "animal elements give the animals flag");
  assert.ok(s5.needs.animals.length >= 1 && s5.needs.stunts.length >= 1);
  assert.ok(s5.specials.length >= 2, "special elements are listed for booking");
  assert.deepStrictEqual(s5.ocast, bd.scenes[4].cast, "the script's own cast is kept for revision checks");
  // ignoring an animal in the sheet takes its flag off when none are left
  const animals = (m.scenes[4].els.animals || []).slice();
  animals.forEach((k) => { st = E.untag(st, sk, k); });
  m = E.build(d, bd, st); en = E.enrich(bd, m, st, {});
  assert.strictEqual((m.scenes[4].els.animals || []).length, 0);
  // a cast member removed from a scene comes off that day
  const k0 = (m.scenes[4].els.cast || [])[0], nm = m.elements[k0].name;
  st = E.untag(st, sk, k0); m = E.build(d, bd, st); en = E.enrich(bd, m, st, {});
  assert.ok(en.scenes[4].cast.indexOf(nm) < 0, "removed cast is off the scene");
  assert.ok(P.dood(P.normalize({ days: [{ scenes: [sk] }] }), en).every((r) => r.name !== nm || r.workDays === 0));
  // the plan's ignore choice keeps a flag off even when an element would add it
  const ig = E.enrich(bd, E.build(d, bd, {}), {}, { flags: { animals: "ignore" } });
  assert.ok(ig.scenes[4].flags.filter((f) => f === "animals").length === 0 || bd.scenes[4].flags.indexOf("animals") >= 0);
});

test("false props: adjectives and adverbs after a body part, abstract nouns, and a cast name starting with 'The'", () => {
  const b = run([["scene", "INT. ROOM - DAY"], ["action", "THE DOCTOR (50s) sits. Holds their laugh. Wipes his face dry. Raises his hand high. Shows rings joined together. The TV playing quietly. The doctor nods."], ["character", "THE DOCTOR"], ["dialogue", "The thing is, the end."]]);
  const props = names(b, 1, "props").map((n) => n.toLowerCase());
  ["dry", "high", "together", "laugh"].forEach((w) => assert.ok(props.indexOf(w) < 0, w + " is not a prop"));
  assert.strictEqual(names(b, 1, "art").indexOf("TV playback"), -1, "a TV that is just on is set dressing, not playback graphics");
  assert.ok(names(b, 1, "setdress").indexOf("Television") >= 0);
  Object.keys(b.scenes[0].hits).forEach((k) => assert.ok(b.scenes[0].hits[k].every((q) => !/^the$/i.test(q)), "no element is coloured on the word 'the'"));
  const b2 = run([["scene", "INT. ROOM - DAY"], ["action", "A TV shows the evening news."]]);
  assert.ok(names(b2, 1, "art").indexOf("TV playback") >= 0, "a TV showing something needs playback");
});

test("sheetPayload: what Sync sends to the Schedule sheet and call sheets", () => {
  const d = require("./fixtures/sample-script.js"), bd = B.analyze(d), m = E.build(d, bd, {});
  const pl = E.sheetPayload(m);
  assert.strictEqual(pl.cats.length, E.CATS.length);
  const first = pl.scenes[bd.scenes[0].id];
  assert.ok(first && first.n === 1 && first.e.vehicles && first.e.vehicles.length, "scene 1 has its vehicle");
  assert.ok(pl.els.some((e) => e.c === "props" && e.n === "Map" && e.h === 1), "the hero prop is marked");
  assert.ok(JSON.stringify(pl).length < 200000, "small enough to send");
  JSON.parse(JSON.stringify(pl));
});

console.log(`\n${passed} passed, ${failed} failed`);
if(failed) process.exit(1);
