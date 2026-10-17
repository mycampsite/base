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

test("story days: played-back footage keeps the day and doesn't split the night around it", () => {
  // Jimmy watches the party tape at night: the DAY headings belong to the footage, not to a new morning
  const b = run([["scene", "INT. DINING TABLE - NIGHT"], ["action", "JIMMY watches the screen."],
    ["scene", "EXT. BACKYARD - DAY"], ["action", "CAMCORDER POV: TGM lifts the sheet."],
    ["scene", "INT. DINING TABLE - NIGHT"], ["action", "JIMMY stares."],
    ["scene", "EXT. BACKYARD - DAY"], ["action", "CAMCORDER POV: The fortune reads F*CK AROUND AND FIND OUT."]]);
  assert.deepStrictEqual(b.scenes.map((s) => s.day), ["N1", "Footage", "N1", "Footage"]);
  assert.deepStrictEqual(b.scenes.map((s) => s.playback), [false, true, false, true]);
  assert.deepStrictEqual(b.scenes.map((s) => s.storyDay), [1, 1, 1, 1]);   // still groups with the night it is watched on
});

test("story days: other playback labels count, ordinary prose and INSERT don't", () => {
  const day = (first) => run([["scene", "INT. OFFICE - NIGHT"], ["action", "They watch."],
    ["scene", "INT. LOBBY - DAY"], ["action", first]]).scenes[1].day;
  assert.strictEqual(day("SECURITY FOOTAGE: A man walks in."), "Footage");
  assert.strictEqual(day("ON THE TV: A reporter stands in the rain."), "Footage");
  assert.strictEqual(day("INSERT: a cracked phone screen."), "D2");         // present time, not playback
  assert.strictEqual(day("JIMMY'S POV: the grass."), "D2");                 // a point of view, not footage
  assert.strictEqual(day("He turns off the TV: it clicks."), "D2");         // prose that happens to hold a colon
});

test("props: a verb with a particle isn't handling something (\"holds in their laughs\")", () => {
  const b = run([["scene", "INT. A - DAY"], ["action", "Everyone else holds in their laughs. He gives in to the urge and picks on the new kid."]]);
  assert.deepStrictEqual(names(b, 1, "props"), []);
  const still = run([["scene", "INT. A - DAY"], ["action", "She holds a chipped mug."]]);
  assert.ok(names(still, 1, "props").some((n) => /mug/i.test(n)), names(still, 1, "props").join());
});

test("wardrobe: a possessive name owns the wet costume, and a bracketed aside doesn't hide the rest", () => {
  const b = run([["scene", "EXT. YARD - DAY"], ["character", "TGM"], ["dialogue", "Introducing!"],
    ["action", "JIMMY aims the hose at TGM's face. A burst of water crashes into TGM's face, and he is soaked."]]);
  assert.ok(names(b, 1, "wardrobe").some((n) => /^Tgm: wet costume/i.test(n)), names(b, 1, "wardrobe").join());
  const c = run([["scene", "INT. KITCHEN - NIGHT"], ["character", "THE MAN"], ["dialogue", "Hey."],
    ["action", "THE MAN, wearing a dilapidated vaquero (cowboy) outfit with chaps, a cowboy hat and a brown jacket, eats cake."]]);
  const w = names(c, 1, "wardrobe").join(" | ").toLowerCase();
  assert.ok(/vaquero outfit/.test(w) && /cowboy hat/.test(w) && /brown jacket/.test(w), w);
});

test("flags: what never happens, and what no person does, isn't a stunt", () => {
  const b = run([["scene", "INT. BATHROOM - DAY"], ["action", "TGM is about to punch the door. He thinks better of it."],
    ["scene", "EXT. YARD - DAY"], ["action", "JOHN drops the camcorder. It tumbles a little then settles."],
    ["scene", "EXT. YARD - DAY"], ["action", "TGM jumps off the shed and tumbles onto the grass."]]);
  assert.deepStrictEqual(b.scenes[0].flags.filter((f) => f === "stunts"), []);
  assert.deepStrictEqual(b.scenes[1].flags.filter((f) => f === "stunts"), []);
  assert.deepStrictEqual(b.scenes[2].flags.filter((f) => f === "stunts"), ["stunts"]);
});

test("props: a prop found once is picked up wherever the script names it again", () => {
  const b = run([["scene", "EXT. YARD - DAY"], ["action", "JIMMY picks up a Magic 8 ball and shakes it."],
    ["scene", "EXT. YARD - DAY"], ["action", "A crack forms in the 8 ball and the fortune spins."],
    ["scene", "INT. HALL - NIGHT"], ["action", "The hall is empty. Applause rings out somewhere far away."]]);
  assert.ok(names(b, 1, "props").some((n) => /ball/i.test(n)), names(b, 1, "props").join());
  assert.ok(names(b, 2, "props").some((n) => /ball/i.test(n)), "scene 2 should have the ball too: " + names(b, 2, "props").join());
  assert.deepStrictEqual(names(b, 3, "props"), []);   // nothing of the sort is named in scene 3
});

test("props: a word doing a job isn't the prop (\"Applause rings\" is not the ring)", () => {
  const b = run([["scene", "INT. STAGE - DAY"], ["action", "TGM holds up a silver ring."],
    ["scene", "INT. HALL - NIGHT"], ["action", "Applause rings around the empty hall."]]);
  assert.ok(names(b, 1, "props").some((n) => /ring/i.test(n)), names(b, 1, "props").join());
  assert.deepStrictEqual(names(b, 2, "props").filter((n) => /ring/i.test(n)), []);
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

test("more props and stunts: tools in lists, 'with a rag', 'reaches for a bat', climbing, jumping, choking, shootings, fire", () => {
  const one = (a) => run([["scene", "INT. SHED - DAY"], ["action", a]]);
  const has = (b, cat, n) => assert.ok(names(b, 1, cat).map((x) => x.toLowerCase()).indexOf(n.toLowerCase()) >= 0, n + " in " + cat + ": " + names(b, 1, cat).join(", "));
  let b = one("She grabs the keys from the hook, a set of pliers and a roll of duct tape."); has(b, "props", "Keys"); has(b, "props", "Pliers"); has(b, "props", "Duct tape");
  b = one("Tom wipes the bar with a rag, then reaches under the counter for a baseball bat."); has(b, "props", "Rag"); has(b, "weapons", "Baseball bat");
  b = one("Dean unlocks the safe, pulls out a bundle of cash and an envelope."); has(b, "props", "Cash"); assert.ok(names(b, 1, "props").indexOf("Bundle") < 0, "a bundle of cash is cash");
  b = one("She climbs the ladder to the roof and hangs from the gutter."); has(b, "stunts", "Climb / work at height");
  b = one("Dean leaps over the counter and tackles the thug. They struggle, Dean chokes him."); has(b, "stunts", "Jump"); has(b, "stunts", "Fight");
  b = one("A bottle smashes over his head. He drops to the floor, knocked out."); has(b, "stunts", "Fall");
  b = one("The man catches fire and runs screaming."); has(b, "stunts", "Fire gag (stunt)");
  b = one("The thief shoots Frank in the leg. Blood sprays the wall."); has(b, "weapons", "Firearm"); has(b, "sfx", "Blood hit / squib");
  b = one("The kids ride bikes down the lane."); has(b, "vehicles", "Bicycle");
  b = one("He sits with a smile and a plan."); assert.strictEqual(names(b, 1, "props").length, 0, "'with a smile' is not a prop");
});
test("background counts come only from the script: no invented crowd of 50", () => {
  const b = run([["scene", "EXT. SHOWGROUND - DAY"], ["action", "A crowd gathers. Hundreds of locals cheer. Twelve guests sit with their parents."]]);
  const q = b.scenes[0].qty || {}, vals = Object.keys(q).map((k) => q[k]);
  assert.ok(vals.indexOf(50) < 0, "no made-up 50");
  assert.ok(vals.every((n) => n === 12 || n === 2), "only counts written out");
});

test("hero: switch it on for any element, off for an automatic one, and it syncs and follows renames", () => {
  const lines = [["scene", "INT. A - DAY"], ["action", "She puts on a raincoat. She picks up the KNIFE."]];
  const sk = run(lines, {}).scenes[0].key;
  let b = run(lines, E.tag({}, sk, "wardrobe", "Raincoat"));
  assert.strictEqual(b.elements["wardrobe|raincoat"].hero, false);     // wardrobe isn't automatic
  assert.strictEqual(b.elements["weapons|knife"].hero, true);            // CAPS prop: automatic
  assert.ok(b.elements["weapons|knife"].heroAuto && !b.elements["weapons|knife"].heroSet);
  let st = E.tag({}, sk, "wardrobe", "Raincoat"); st = E.setHero(st, "wardrobe|raincoat", true);
  st = E.setHero(st, "weapons|knife", false);
  b = run(lines, st);
  assert.strictEqual(b.elements["wardrobe|raincoat"].hero, true);
  assert.strictEqual(b.elements["weapons|knife"].hero, false);
  assert.ok(b.elements["weapons|knife"].heroAuto && b.elements["weapons|knife"].heroSet);
  // it reaches the Schedule sheet payload and the plan's specials
  assert.ok(E.sheetPayload(b).els.some((x) => x.n === "Raincoat" && x.h === 1));
  // sync round trip and diff
  const back = E.fromRemote(JSON.parse(JSON.stringify(E.toRemote(st))));
  assert.deepStrictEqual(back, st);
  assert.ok(Object.keys(E.diff({}, st)).some((k) => /^heroes\//.test(k)));
  assert.deepStrictEqual(E.mergeStores(E.setHero({}, "props|a", true), E.setHero({}, "props|b", true)).heroes, { "props|a": "1", "props|b": "1" });
  // back to automatic
  st = E.setHero(st, "weapons|knife", null); assert.strictEqual(run(lines, st).elements["weapons|knife"].hero, true);
  assert.ok(!E.setHero(E.setHero({}, "props|a", true), "props|a", null).heroes);
  // rename and merge carry it
  let r = E.rename(E.setHero({}, "props|lamp", true), "props|lamp", "props", "Desk lamp");
  assert.strictEqual(r.heroes["props|desk lamp"], "1"); assert.ok(!r.heroes["props|lamp"]);
  r = E.merge(E.setHero({}, "props|lamp", true), ["props|lamp"], "props|light");
  assert.strictEqual(r.heroes["props|light"], "1");
});


/* ---------- clear and re-tag ---------- */
const RST = () => ({ tags: { a: [{ c: "props", n: "Gun" }], b: [{ c: "props", n: "Hat" }], gone: [{ c: "props", n: "Old" }] }, off: { a: ["props|cup"], gone: ["props|x"] },
  drop: ["props|thing"], alias: { "props|pistol": "props|gun" }, names: { "props|gun": "Gun" }, notes: { "props|gun": "loaded" }, heroes: { "props|gun": "1" },
  scene: { a: { syn: "Fight", mute: ["props|gun|0|3"] }, b: { day: "D2" }, gone: { syn: "x" } } });
test("a whole-script reset clears hand tagging and leftovers, keeps what was asked, and stamps the time", () => {
  const r = E.resetStore(RST(), { live: ["a", "b"], keep: { names: true, notes: true, heroes: true, scene: true }, at: 500 });
  assert.strictEqual(r.tags, undefined); assert.strictEqual(r.off, undefined); assert.strictEqual(r.drop, undefined);
  assert.deepStrictEqual(r.scene, { a: { syn: "Fight" }, b: { day: "D2" } });           // muted words gone, fields kept, deleted scene swept
  assert.deepStrictEqual(r.alias, { "props|pistol": "props|gun" }); assert.strictEqual(r.notes["props|gun"], "loaded"); assert.strictEqual(r.heroes["props|gun"], "1");
  assert.strictEqual(r.reset, 500);
  const all = E.resetStore(RST(), { live: ["a", "b"], keep: {}, at: 500 });
  assert.deepStrictEqual(Object.keys(all).sort(), ["reset"]);
});
test("a one-scene reset touches only that scene and stamps it", () => {
  const r = E.resetStore(RST(), { scene: "a", live: ["a", "b"], keep: { scene: true }, at: 700 });
  assert.deepStrictEqual(Object.keys(r.tags), ["b"]); assert.strictEqual(r.off, undefined);
  assert.deepStrictEqual(r.scene.a, { syn: "Fight", rs: 700 }); assert.deepStrictEqual(r.drop, ["props|thing"]); assert.strictEqual(r.notes["props|gun"], "loaded");
  assert.strictEqual(r.reset, undefined);
});
test("without the list of scenes, nothing is swept as a leftover", () => {
  const r = E.resetStore(RST(), { scene: "a", keep: {}, at: 1 });
  assert.ok(r.tags.gone); assert.ok(r.scene.gone);
});
test("reset counts match what goes", () => {
  const c = E.resetCounts(RST(), { live: ["a", "b"], keep: { names: true, notes: true, heroes: true, scene: true } });
  assert.deepStrictEqual([c.tags, c.off, c.mute, c.orphans, c.drop, c.names, c.notes, c.heroes, c.scene], [2, 1, 1, 3, 1, 0, 0, 0, 0]);
  const one = E.resetCounts(RST(), { scene: "b", live: ["a", "b"], keep: {} });
  assert.deepStrictEqual([one.tags, one.off, one.scene, one.drop], [1, 0, 1, 0]);
});
test("edits queued before a reset can't bring old tags back; later ones still apply", () => {
  const team = E.resetStore(RST(), { live: ["a", "b"], keep: {}, at: 1000 });
  const r = E.applyOps(team, [{ t: "tag", sk: "a", c: "props", n: "Knife", at: 900 }, { t: "tag", sk: "a", c: "props", n: "Rope" }, { t: "tag", sk: "a", c: "props", n: "Lamp", at: 1100 }]);
  assert.deepStrictEqual(r.tags.a.map((t) => t.n), ["Lamp"]);
  const sc = E.resetStore(RST(), { scene: "a", live: ["a", "b"], keep: {}, at: 1000 });
  const r2 = E.applyOps(sc, [{ t: "tag", sk: "a", c: "props", n: "Knife", at: 900 }, { t: "tag", sk: "b", c: "props", n: "Rope", at: 900 }]);
  assert.deepStrictEqual(r2.tags.a, undefined); assert.ok(r2.tags.b.some((t) => t.n === "Rope"));
});
test("a device's old unshared copy can't undo a reset when merged", () => {
  const old = RST(), team = E.resetStore(old, { live: ["a", "b"], keep: {}, at: 1000 });
  assert.deepStrictEqual(E.mergeStores(team, old), { reset: 1000 });
  const sc = E.resetStore(old, { scene: "a", live: ["a", "b"], keep: {}, at: 1000 }), m = E.mergeStores(sc, old);
  assert.strictEqual(m.tags.a, undefined); assert.ok(m.tags.b); assert.strictEqual(m.scene.a.rs, 1000);
  // after the reset is in step, new edits from that device merge as usual
  const later = E.tag(team, "a", "props", "Lamp"), m2 = E.mergeStores(team, later);
  assert.strictEqual(m2.tags.a[0].n, "Lamp"); assert.strictEqual(m2.reset, 1000);
});
test("the reset time goes to and from the database", () => {
  const st = E.resetStore(RST(), { live: ["a", "b"], keep: {}, at: 1234 });
  assert.strictEqual(E.toRemote(st).reset, 1234); assert.strictEqual(E.fromRemote(E.toRemote(st)).reset, 1234);
  const d = E.diff(RST(), st); assert.strictEqual(d.reset, 1234); assert.strictEqual(d["tags/a/props%7Cgun"] === undefined, true);
  assert.ok(Object.keys(d).some((k) => /^tags\/a\//.test(k) && d[k] === null));
});

test("shoot conditions: only known ones, no repeats, and they survive the team sync", () => {
  let st = E.setScene({}, "s1", "env", ["water", "nope", "water", "height"]);
  assert.deepStrictEqual(st.scene.s1.env, ["water", "height"]);
  const back = E.fromRemote(JSON.parse(JSON.stringify(E.toRemote(st))));
  assert.deepStrictEqual(back.scene.s1.env, ["water", "height"]);
  st = E.setScene(st, "s1", "env", []); assert.ok(!st.scene || !st.scene.s1);
});

test("cast ID numbers set by hand: swap on clash, the rest follow on, shared and reset", () => {
  const lines = [["scene", "INT. HOUSE - DAY"], ["character", "MUM"], ["dialogue", "Hi."], ["character", "JIMMY"], ["dialogue", "Yo."], ["character", "DAD"], ["dialogue", "Hey."]];
  const b0 = run(lines), cur = (b) => { const o = {}; (b.byCat.cast || []).forEach((k) => { o[k] = b.elements[k].no; }); return o; };
  const auto = cur(b0); assert.deepStrictEqual(Object.values(auto).sort(), [1, 2, 3]);
  const first = Object.keys(auto).find((k) => auto[k] === 1), third = Object.keys(auto).find((k) => auto[k] === 3);
  // give the third one number 1: they swap
  let st = E.setCastNo({}, third, 1, auto); const b1 = run(lines, st), c1 = cur(b1);
  assert.strictEqual(c1[third], 1); assert.strictEqual(c1[first], 3); assert.deepStrictEqual(Object.values(c1).sort(), [1, 2, 3]);
  assert.strictEqual(b1.castNos[b1.elements[third].name], 1);
  // a number nobody has: the others keep theirs
  st = E.setCastNo(st, third, 10, c1); const c2 = cur(run(lines, st)); assert.strictEqual(c2[third], 10); assert.strictEqual(c2[first], 3);
  // survives the trip through the database, and a rename
  assert.deepStrictEqual(E.fromRemote(E.toRemote(st)).nums, st.nums);
  assert.ok(Object.keys(E.diff({}, st)).some((p) => /^nums\//.test(p)));
  const st2 = E.rename(st, third, "cast", "GRANDAD"); assert.strictEqual(st2.nums["cast|grandad"], "10");
  // back to the script order
  assert.ok(!E.clearCastNos(st).nums); assert.deepStrictEqual(cur(run(lines, E.clearCastNos(st))), auto);
  assert.ok(!E.resetStore(st, {}).nums);
});

console.log(`\n${passed} passed, ${failed} failed`);
if(failed) process.exit(1);
