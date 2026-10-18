// Tests for Docs on phones (docscards.js): how a Sheet tab becomes cards. Run: node tests/docscards.test.js
"use strict";
const assert = require("assert");
const D = require("../docscards.js");

let passed = 0, failed = 0;
function test(name, fn){ try{ fn(); passed++; console.log("  ok  " + name); }catch(e){ failed++; console.log("  FAIL " + name + "\n       " + (e && e.message)); } }

console.log("Docs cards");

// Shaped like the Production Docs "Crew & Contacts" tab
const DIR = [
  ["THE FINAL ACT", "", "", "", ""],
  ["CREW & CONTACTS · Exported 12 Oct 2026", "", "", "", ""],
  ["Roles are a starting scaffold sized to this script, grouped by department.", "", "", "", ""],
  ["", "", "", "", ""],
  ["NAME", "ROLE", "PHONE", "EMAIL", "ScriptY key"],
  ["CREW", "", "", "", ""],
  ["PRODUCTION", "", "", "", ""],
  ["", "Producer", "", "", "k1"],
  ["Sam Lee", "Writer", "0412 345 678", "sam@example.com", "k2"],
  ["CAMERA", "", "", "", ""],
  ["", "Director of photography", "", "", "k3"]
];
const DIR_FMT = [{ b: 1 }, { b: 1 }, {}, {}, { b: 1, h: "#DCE3EE" }, { b: 1, h: "#1F2A3D" }, { b: 1, h: "#EDF1F6" }, {}, {}, { b: 1, h: "#EDF1F6" }, {}];

test("rows above the header become the title", () => {
  const L = D.layout(DIR, DIR_FMT);
  assert.deepStrictEqual(L.title.slice(0, 2), ["THE FINAL ACT", "CREW & CONTACTS · Exported 12 Oct 2026"]);
});
test("the hidden key column never shows", () => {
  const L = D.layout(DIR, DIR_FMT);
  assert.deepStrictEqual(L.header, ["NAME", "ROLE", "PHONE", "EMAIL"]);
  assert.ok(!JSON.stringify(L.items).includes("k2"));
});
test("single-value rows are headings: a group then its sub-group", () => {
  const secs = D.layout(DIR, DIR_FMT).items.filter((i) => i.type === "section");
  assert.deepStrictEqual(secs.map((s) => [s.text, s.level]), [["CREW", 1], ["PRODUCTION", 2], ["CAMERA", 2]]);
});
test("an unfilled crew slot shows the role and says the name is missing", () => {
  const c = D.layout(DIR, DIR_FMT).items.find((i) => i.title === "Producer");
  assert.strictEqual(c.missing, "NAME");
  assert.strictEqual(c.rows.length + c.notes.length + c.chips.length, 0);
});
test("a filled row: name as the title, phone and email tappable", () => {
  const c = D.layout(DIR, DIR_FMT).items.find((i) => i.title === "Sam Lee");
  assert.strictEqual(c.missing, "");
  assert.strictEqual(c.subtitle, "Writer");
  assert.deepStrictEqual(c.rows.map((f) => [f.label, f.kind]), [["PHONE", "phone"], ["EMAIL", "email"]]);
  assert.strictEqual(D.telHref("0412 345 678"), "tel:0412345678");
});
test("budget: account badge, item title, total on the right, a bold account line is a group heading", () => {
  const L = D.layout([["ACCT", "ITEM", "QTY", "UNIT", "RATE", "TOTAL", "", "NOTES"], ["2300", "ART DEPARTMENT", "", "", "", "$4,200", "", ""], ["2310", "Production designer", "5", "days", "$450", "$2,250", "", "Prep and shoot"]],
    [{ b: 1 }, { b: 1 }, {}]);
  const [g, c] = L.items;
  assert.strictEqual(g.type, "group");
  assert.deepStrictEqual([g.badges[0].value, g.title, g.figure.value], ["2300", "ART DEPARTMENT", "$4,200"]);
  assert.deepStrictEqual([c.badges[0].value, c.title, c.figure.value], ["2310", "Production designer", "$2,250"]);
  assert.deepStrictEqual(c.chips, []);
  assert.deepStrictEqual(c.rows.map((x) => x.value), ["5 days × $450"]);
  assert.deepStrictEqual(c.notes.map((x) => x.value), ["Prep and shoot"]);
});
test("shot list: codes as badges, size/angle/lens as chips, the action as a paragraph", () => {
  const L = D.layout([["NO.", "SC.", "SHOT", "I/E", "D/N", "SHOT SIZE", "ANGLE", "LENS", "LOCATION", "DESCRIPTION OF ACTION", "STATUS"], ["1", "12A", "12A-1", "INT", "NIGHT", "MS", "Eye level", "35mm", "KITCHEN", "Jimmy watches the gift wobble on the table.", "To shoot"]]);
  const c = L.items[0];
  assert.deepStrictEqual(c.badges.map((b) => b.value), ["1", "12A", "12A-1"]);
  assert.strictEqual(c.title, "KITCHEN");
  assert.deepStrictEqual(c.chips.map((x) => x.value), ["INT", "NIGHT", "MS", "Eye level", "35mm", "To shoot"]);
  assert.deepStrictEqual(c.notes.map((x) => x.label), ["DESCRIPTION OF ACTION"]);
});
test("short codes still become a badge when there are no code columns", () => {
  const L = D.layout([["WHAT", "WHERE", "WHEN"], ["12A", "INT. KITCHEN - NIGHT", "Day 2"], ["", "TOTAL BELOW THE LINE", "$12,000"]]);
  assert.deepStrictEqual([L.items[0].badges[0].value, L.items[0].title], ["12A", "INT. KITCHEN - NIGHT"]);
  assert.ok(L.items[1].total);
});
test("long text becomes a note; links are only plain web links", () => {
  const L = D.layout([["NAME", "NOTES", "LINK"], ["Ana", "x".repeat(80), "https://example.com/a"]]);
  const c = L.items[0];
  assert.strictEqual(c.notes[0].label, "NOTES");
  assert.strictEqual(c.rows[0].kind, "url");
  assert.strictEqual(D.kindOf("javascript:alert(1)"), "text");
  assert.strictEqual(D.kindOf("2 2/8"), "text");
  assert.strictEqual(D.kindOf("12"), "text");
});
test("search finds cards by any value, never headings", () => {
  const L = D.layout(DIR, DIR_FMT);
  const hits = L.items.filter((i) => D.matches(i, "sam@"));
  assert.deepStrictEqual(hits.map((h) => h.title), ["Sam Lee"]);
});
test("table view mirrors the Sheet: hidden and empty columns go, bands, bold totals, numbers on the right", () => {
  const T = D.table([["BUDGET", "", "", "", ""], ["ACCT", "ITEM", "", "TOTAL", "ScriptY key"], ["ABOVE THE LINE", "", "", "", ""], ["1100", "Story", "", "$500", "k"], ["", "GRAND TOTAL", "", "$24,300", ""]],
    [{ b: 1 }, { b: 1, h: "#dce3ee" }, { b: 1, h: "#1f2a3d" }, {}, { b: 1 }]);
  assert.deepStrictEqual(T.title, ["BUDGET"]);
  assert.deepStrictEqual(T.columns.map((c) => [c.label, c.num]), [["ACCT", true], ["ITEM", false], ["TOTAL", true]]);
  assert.deepStrictEqual(T.rows.map((r) => r.type), ["section", "row", "row"]);
  assert.strictEqual(T.rows[0].band, "dark");
  assert.ok(T.rows[2].bold);
});
test("odd input doesn't throw", () => {
  assert.deepStrictEqual(D.layout(null).items, []);
  assert.deepStrictEqual(D.layout([[]]).items, []);
  assert.ok(Array.isArray(D.layout([["only one"], ["a", "b"], [1, null]]).items));
  assert.ok(Array.isArray(D.table(null).rows) && Array.isArray(D.table([["x"]]).rows));
});

console.log(`\n${passed} passed, ${failed} failed`);
if(failed) process.exit(1);
