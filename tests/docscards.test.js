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
  assert.strictEqual(c.fields.length, 0);
});
test("a filled row: name as the title, phone and email tappable", () => {
  const c = D.layout(DIR, DIR_FMT).items.find((i) => i.title === "Sam Lee");
  assert.strictEqual(c.missing, "");
  assert.deepStrictEqual(c.fields.map((f) => [f.label, f.kind]), [["ROLE", "text"], ["PHONE", "phone"], ["EMAIL", "email"]]);
  assert.strictEqual(D.telHref("0412 345 678"), "tel:0412345678");
});
test("short codes (account, scene, shot) become a badge beside the next value", () => {
  const L = D.layout([["ACCT", "DESCRIPTION", "TOTAL"], ["2300", "Art Department", "$4,200"], ["", "TOTAL BELOW THE LINE", "$12,000"], ["12A", "INT. KITCHEN - NIGHT", "2 2/8"]]);
  const [a, t, s] = L.items;
  assert.deepStrictEqual([a.badge, a.title, a.fields[0].value], ["2300", "Art Department", "$4,200"]);
  assert.ok(t.total && !t.badge);
  assert.deepStrictEqual([s.badge, s.title], ["12A", "INT. KITCHEN - NIGHT"]);
});
test("long text spans the card; links are only plain web links", () => {
  const L = D.layout([["NAME", "NOTES", "LINK"], ["Ana", "x".repeat(80), "https://example.com/a"]]);
  const f = L.items[0].fields;
  assert.ok(f[0].long);
  assert.strictEqual(f[1].kind, "url");
  assert.strictEqual(D.kindOf("javascript:alert(1)"), "text");
  assert.strictEqual(D.kindOf("2 2/8"), "text");
  assert.strictEqual(D.kindOf("12"), "text");
});
test("search finds cards by any value, never headings", () => {
  const L = D.layout(DIR, DIR_FMT);
  const hits = L.items.filter((i) => D.matches(i, "sam@"));
  assert.deepStrictEqual(hits.map((h) => h.title), ["Sam Lee"]);
});
test("odd input doesn't throw", () => {
  assert.deepStrictEqual(D.layout(null).items, []);
  assert.deepStrictEqual(D.layout([[]]).items, []);
  assert.ok(Array.isArray(D.layout([["only one"], ["a", "b"], [1, null]]).items));
});

console.log(`\n${passed} passed, ${failed} failed`);
if(failed) process.exit(1);
