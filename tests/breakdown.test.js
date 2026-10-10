// Tests for the script breakdown engine (breakdown.js). Run: node tests/breakdown.test.js
// No dependencies. Every deploy runs this first; a failure stops the deploy.
"use strict";
const assert = require("assert");
const B = require("../breakdown.js");

let passed = 0, failed = 0;
function test(name, fn){
  try{ fn(); passed++; console.log("  ok  " + name); }
  catch(e){ failed++; console.log("  FAIL " + name + "\n       " + (e && e.message)); }
}

// Build a script doc from a compact list: ["scene", "INT. HOUSE - DAY"], ["action", "..."], ...
function doc(lines, pages){
  return {
    title: { title: "TEST" },
    lines: lines.map(([type, text], i) => type === "dual"
      ? { id: "l" + i, type, dual: { left: { characterRuns: [{ t: text[0] }], dialogueRuns: [{ t: text[1] }] }, right: { characterRuns: [{ t: text[2] }], dialogueRuns: [{ t: text[3] }] } } }
      : { id: "l" + i, type, runs: [{ t: text }] }),
    meta: pages ? { pages } : {},
    pageSettings: { pageSize: "letter" }
  };
}
const castOf = (r, n) => r.scenes[n - 1].cast.slice().sort();
const member = (r, name) => r.cast.find((c) => c.name === name);

console.log("Script breakdown");

test("a character named in action is in the scene, not only when they speak", () => {
  const r = B.analyze(doc([
    ["scene", "INT. HOUSE - DAY"], ["action", "JIMMY sits at the table."],
    ["character", "MUM"], ["dialogue", "Eat your dinner."],
    ["scene", "EXT. YARD - DAY"], ["action", "JIMMY runs outside. Mum watches from the door."],
    ["scene", "INT. BEDROOM - NIGHT"], ["character", "JIMMY"], ["dialogue", "Goodnight."]
  ], 3));
  assert.deepStrictEqual(castOf(r, 1), ["JIMMY", "MUM"]);
  assert.deepStrictEqual(castOf(r, 2), ["JIMMY", "MUM"]);
  assert.deepStrictEqual(member(r, "JIMMY").scenes, [1, 2, 3]);
});

test("Normal Case names count, but not when the name is an ordinary word", () => {
  const r = B.analyze(doc([
    ["scene", "INT. OFFICE - DAY"], ["character", "CHERYL"], ["dialogue", "Hi."], ["character", "WILL"], ["dialogue", "Hey."],
    ["scene", "INT. HALL - DAY"], ["action", "Cheryl walks past. It will rain soon. Will it ever stop?"]
  ], 1));
  assert.deepStrictEqual(castOf(r, 2), ["CHERYL"]);
  assert.deepStrictEqual(member(r, "WILL").scenes, [1]);
});

test("CAPS always count, even for names that are ordinary words", () => {
  const r = B.analyze(doc([
    ["scene", "INT. OFFICE - DAY"], ["character", "WILL"], ["dialogue", "Hey."],
    ["scene", "INT. HALL - DAY"], ["action", "WILL enters, soaked."]
  ], 1));
  assert.deepStrictEqual(member(r, "WILL").scenes, [1, 2]);
});

test("a name inside another word does not count (ANN in ANNOUNCES, JO in JOKES)", () => {
  const r = B.analyze(doc([
    ["scene", "INT. A - DAY"], ["character", "ANN"], ["dialogue", "Hi."], ["character", "JO"], ["dialogue", "Hi."],
    ["scene", "INT. B - DAY"], ["action", "The radio ANNOUNCES the news. Someone JOKES."]
  ], 1));
  assert.deepStrictEqual(castOf(r, 2), []);
});

test("possessives count (JIMMY'S POV)", () => {
  const r = B.analyze(doc([
    ["scene", "INT. A - DAY"], ["character", "JIMMY"], ["dialogue", "Hi."],
    ["scene", "EXT. B - DAY"], ["action", "JIMMY'S POV: the yard is empty."]
  ], 1));
  assert.deepStrictEqual(castOf(r, 2), ["JIMMY"]);
});

test("group cues (EVERYONE, CROWD) are background, not cast", () => {
  const r = B.analyze(doc([
    ["scene", "EXT. PARK - DAY"], ["character", "TGM"], ["dialogue", "Repeat after me!"], ["character", "EVERYONE"], ["dialogue", "JIMMY!"],
    ["character", "CROWD"], ["dialogue", "Yeah!"]
  ], 1));
  assert.ok(!member(r, "EVERYONE") && !member(r, "CROWD"));
  assert.deepStrictEqual(castOf(r, 1), ["TGM"]);
  assert.notStrictEqual(r.scenes[0].bg, "None");
});

test("voice-over only is not on camera; named in action later puts them on camera", () => {
  const r = B.analyze(doc([
    ["scene", "INT. CAR - NIGHT"], ["character", "DAD (V.O.)"], ["dialogue", "Drive safe."],
    ["scene", "INT. KITCHEN - NIGHT"], ["action", "DAD pours tea."]
  ], 1));
  assert.deepStrictEqual(castOf(r, 1), []);
  assert.deepStrictEqual(member(r, "DAD").scenes, [2]);
});

test("THE MAN introduced as 'THE MAN (late 30s)' is one person, not two", () => {
  const r = B.analyze(doc([
    ["scene", "INT. KITCHEN - DAY"], ["action", "He peeks around the corner and THE MAN (late 30s) is cooking."],
    ["character", "THE MAN"], ["dialogue", "Hungry?"]
  ], 1));
  assert.ok(member(r, "THE MAN"));
  assert.ok(!member(r, "MAN"));
});

test("dual dialogue: both speakers are in the scene", () => {
  const r = B.analyze(doc([
    ["scene", "EXT. STAGE - DAY"], ["dual", ["TGM", "Vale!", "KIDS", "Vale!"]], ["dual", ["ANA", "One", "BEN", "Two"]]
  ], 1));
  assert.deepStrictEqual(castOf(r, 1), ["ANA", "BEN", "TGM"]);
});

test("page eighths add up exactly to the script's page count", () => {
  const lines = [];
  for(let i = 0; i < 17; i++){ lines.push(["scene", "INT. ROOM " + i + " - DAY"]); for(let k = 0; k <= i % 5; k++) lines.push(["action", "Something happens here that takes a little while to describe properly on the page."]); }
  [3, 7, 12, 33].forEach((pages) => {
    const r = B.analyze(doc(lines, pages));
    assert.strictEqual(r.totals.eighths, pages * 8, pages + " pages");
    assert.ok(r.scenes.every((s) => Number.isInteger(s.eighths) && s.eighths >= 1));
  });
  // More scenes than eighths: every scene still counts as at least 1/8 (industry minimum)
  const tiny = B.analyze(doc(lines, 1));
  assert.ok(tiny.scenes.every((s) => s.eighths === 1));
  assert.strictEqual(tiny.totals.eighths, 17);
});

test("cast eighths are the sum of their scenes' eighths", () => {
  const r = B.analyze(doc([
    ["scene", "INT. A - DAY"], ["action", "JIMMY waits."], ["action", "And waits a long time, looking out of the window, thinking about everything."],
    ["scene", "INT. B - DAY"], ["character", "JIMMY"], ["dialogue", "Hello?"],
    ["scene", "INT. C - DAY"], ["action", "Empty room."]
  ], 2));
  const j = member(r, "JIMMY"), sum = j.scenes.reduce((a, n) => a + r.scenes[n - 1].eighths, 0);
  assert.strictEqual(j.eighths, sum);
});

test("day / night: CONTINUOUS inherits the previous scene's time", () => {
  const r = B.analyze(doc([
    ["scene", "EXT. ROAD - NIGHT"], ["action", "Dark."], ["scene", "INT. CAR - CONTINUOUS"], ["action", "Still dark."], ["scene", "EXT. FIELD - DAY"], ["action", "Sun."]
  ], 1));
  assert.deepStrictEqual(r.scenes.map((s) => s.dn), ["N", "N", "D"]);
});

test("column widths match Final Draft (61 / 35 / 25)", () => {
  assert.strictEqual(B.cols.action, 61); assert.strictEqual(B.cols.dialogue, 35); assert.strictEqual(B.cols.parenthetical, 25);
});

test("children described in words are flagged as possible minors", () => {
  const r = B.analyze(doc([
    ["scene", "INT. KITCHEN - DAY"], ["action", "MUM stirs a pot. LILY, a little girl, runs in."], ["character", "MUM"], ["dialogue", "Hi."], ["character", "LILY"], ["dialogue", "Mum!"]
  ], 1));
  const lily = r.cast.filter((c) => c.name === "LILY")[0], mum = r.cast.filter((c) => c.name === "MUM")[0];
  assert.ok(lily.minor && lily.minorHint, "LILY should be a possible minor");
  assert.ok(/little girl/.test(lily.note));
  assert.ok(!mum.minor);
  assert.ok(r.scenes[0].flags.indexOf("minors") >= 0);
});

test("a stated age under 18 is a confirmed minor; an adult age or 'boy's father' is not", () => {
  const r = B.analyze(doc([
    ["scene", "INT. A - DAY"], ["action", "Kate, 11, hides. BEN, the boy's father, waves. JOHN, 35, sits."],
    ["character", "KATE"], ["dialogue", "Shh."], ["character", "BEN"], ["dialogue", "Hi."], ["character", "JOHN"], ["dialogue", "Hey."]
  ], 1));
  const by = (n) => r.cast.filter((c) => c.name === n)[0];
  assert.ok(by("KATE").minor && !by("KATE").minorHint && by("KATE").age === 11);
  assert.ok(!by("BEN").minor && !by("JOHN").minor);
});

test("child cues (LITTLE GIRL) count, GIRLFRIEND does not", () => {
  const r = B.analyze(doc([
    ["scene", "INT. A - DAY"], ["character", "LITTLE GIRL"], ["dialogue", "Hello."], ["character", "GIRLFRIEND"], ["dialogue", "Hi."]
  ], 1));
  assert.ok(r.cast.filter((c) => c.name === "LITTLE GIRL")[0].minor);
  assert.ok(!r.cast.filter((c) => c.name === "GIRLFRIEND")[0].minor);
});

console.log(`\n${passed} passed, ${failed} failed`);
if(failed) process.exit(1);
