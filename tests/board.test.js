// Tests for the Board tab's logic (board.js). Run: node tests/board.test.js
"use strict";
const assert = require("assert");
const B = require("../board.js");

let passed = 0, failed = 0;
function test(name, fn){ try{ fn(); passed++; console.log("  ok  " + name); }catch(e){ failed++; console.log("  FAIL " + name + "\n       " + (e && e.message)); } }

console.log("Board");

/* ---------- links ---------- */
test("only web links are ever used as a link target", () => {
  ["javascript:alert(1)", "JaVaScRiPt:alert(1)", "data:text/html,<b>x</b>", "mailto:a@b.co", "ftp://x.com/a", "vbscript:x", "not a link", "", null, 'https://evil.com"onerror=x', "http://a b.com"]
    .forEach((u) => assert.strictEqual(B.safeUrl(u), "", String(u)));
  assert.strictEqual(B.safeUrl("https://www.imdb.com/name/nm1/"), "https://www.imdb.com/name/nm1/");
  assert.strictEqual(B.safeUrl("imdb.com/name/nm1"), "https://imdb.com/name/nm1");        // pasted without https
  assert.strictEqual(B.safeUrl("www.x.com"), "https://www.x.com/");
  assert.strictEqual(B.safeUrl("example.com:8080/x"), "https://example.com:8080/x");      // a port isn't a scheme
});
test("Drive links show as pictures, in every shape Drive hands out", () => {
  const want = "https://drive.google.com/thumbnail?id=1AbCdEfGhIjKl&sz=w900";
  assert.strictEqual(B.photoSrc("https://drive.google.com/file/d/1AbCdEfGhIjKl/view?usp=sharing"), want);
  assert.strictEqual(B.photoSrc("https://drive.google.com/open?id=1AbCdEfGhIjKl"), want);
  assert.strictEqual(B.photoSrc("https://drive.google.com/uc?export=view&id=1AbCdEfGhIjKl"), want);
  assert.strictEqual(B.photoSrc("https://drive.google.com/file/u/1/d/1AbCdEfGhIjKl/view"), want);
});
test("direct image links show; pages that aren't pictures don't", () => {
  assert.strictEqual(B.photoSrc("https://x.com/a/b.JPG?w=2"), "https://x.com/a/b.JPG?w=2");
  assert.strictEqual(B.photoSrc("https://lh3.googleusercontent.com/abc=w800"), "https://lh3.googleusercontent.com/abc=w800");
  assert.strictEqual(B.photoSrc("https://www.dropbox.com/s/abc/pic.png?dl=0"), "https://www.dropbox.com/s/abc/pic.png?raw=1");
  ["https://photos.app.goo.gl/abc", "https://drive.google.com/drive/folders/1AbCdEfGhIjKl", "https://example.com/gallery", "javascript:alert(1)", ""]
    .forEach((u) => assert.strictEqual(B.photoSrc(u), "", u));
});
test("map, phone and email links", () => {
  assert.strictEqual(B.mapUrl(" 12 Smith St, Fitzroy "), "https://www.google.com/maps/search/?api=1&query=12%20Smith%20St%2C%20Fitzroy");
  assert.strictEqual(B.mapUrl(""), "");
  assert.strictEqual(B.telUrl("0400 123 456"), "tel:0400123456");
  assert.strictEqual(B.telUrl("+61 (0)3 9999 1234"), "tel:+610399991234");
  assert.strictEqual(B.telUrl("ask Jo"), "");
  assert.strictEqual(B.mailUrl("jo@x.com"), "mailto:jo@x.com");
  assert.strictEqual(B.mailUrl("jo@x"), ""); assert.strictEqual(B.mailUrl('a"b@x.com'), "");
});
test("links typed in the notes become buttons and leave the rest as text", () => {
  const r = B.notesParts("Great read. Showreel https://youtu.be/abc, IMDb: www.imdb.com/name/nm9. Drive https://drive.google.com/file/d/1AbCdEfGhIjKl/view");
  assert.deepStrictEqual(r.links.map((l) => l.label), ["Showreel", "IMDb", "Drive"]);   // the word before a link names its button
  assert.strictEqual(r.links[0].url, "https://youtu.be/abc");                 // trailing comma not part of the link
  assert.strictEqual(r.text, "Great read.");
  assert.deepStrictEqual(B.notesParts("see javascript:alert(1)").links, []);   // never a button
  assert.deepStrictEqual(B.notesParts("https://youtu.be/abc").links.map((l) => l.label), ["YouTube"]);   // no word: the site names it
  assert.deepStrictEqual(B.notesParts("IMDb imdb.com/name/nm1 · agent Pat").links.map((l) => l.url), ["https://imdb.com/name/nm1"]);   // pasted without https
  assert.strictEqual(B.notesParts("IMDb imdb.com/name/nm1 · agent Pat").text, "agent Pat");
  assert.deepStrictEqual(B.notesParts("https://a.com/x https://a.com/x").links.length, 1);   // a repeat is one button
  assert.deepStrictEqual(B.notesParts(null), { text: "", links: [] });
});

/* ---------- cards ---------- */
const data = {
  statuses: { cast: ["Considering", "Callback", "Offered", "Cast", "Passed"], loc: ["Considering", "Scouted", "Confirmed", "Passed"] },
  cast: [
    { name: "ANA", type: "Lead", candidates: [
      { key: "cast:ANA:1", n: 1, row: 8, actor: "Jo Smith", photo: "https://drive.google.com/file/d/1AbCdEfGhIjKl/view", phone: "0400 111 222", email: "jo@x.com", status: "Passed", notes: "Too old" },
      { key: "cast:ANA:2", n: 2, row: 9, actor: "Mia Lee", photo: "", phone: "", email: "", status: "Callback", notes: "Reel https://vimeo.com/123" },
      { key: "cast:ANA:3", n: 3, row: 10, actor: "", photo: "", phone: "", email: "", status: "", notes: "" } ] },
    { name: "BEN", type: "Supporting", candidates: [
      { key: "cast:BEN:1", n: 1, row: 12, actor: "", photo: "", phone: "", email: "", status: "", notes: "" } ] },
    { name: "CAL", type: "", candidates: [
      { key: "cast:CAL:1", n: 1, row: 14, actor: "Sam Wu", photo: "", phone: "", email: "", status: "Cast", notes: "" } ] }
  ],
  locations: [
    { name: "HOUSE", type: "INT  ·  3 scenes", candidates: [
      { key: "loc:HOUSE:1", n: 1, row: 8, address: "12 Smith St, Fitzroy", photo: "", phone: "03 9999 1234", email: "", status: "Scouted", notes: "Lovely light" },
      { key: "loc:HOUSE:2", n: 2, row: 9, address: "", photo: "", phone: "", email: "", status: "", notes: "" } ] }
  ]
};
const cast = () => B.groupsOf(data, "cast", "f1");

test("only rows with something typed become cards; empty roles still show", () => {
  const g = cast();
  assert.deepStrictEqual(g.map((x) => [x.name, x.cards.length, x.slots]), [["ANA", 2, 3], ["BEN", 0, 1], ["CAL", 1, 1]]);
});
test("passed options sink to the end of their role", () => {
  assert.deepStrictEqual(cast()[0].cards.map((c) => c.title), ["Mia Lee", "Jo Smith"]);
});
test("a card carries its photo, links, status flags and where it sits in the Sheet", () => {
  const jo = cast()[0].cards[1];
  assert.strictEqual(jo.id, "f1|cast:ANA:1"); assert.strictEqual(jo.row, 8);
  assert.strictEqual(jo.photo, "https://drive.google.com/thumbnail?id=1AbCdEfGhIjKl&sz=w900");
  assert.deepStrictEqual(jo.links, []);                                                           // no Call / Email on the card
  assert.deepStrictEqual(jo.contact.map((l) => l.label), ["Call", "Email"]);                      // they live in the detail view
  assert.strictEqual(jo.passed, true); assert.strictEqual(cast()[2].cards[0].done, true);
  const mia = cast()[0].cards[0];
  assert.deepStrictEqual(mia.links.map((l) => l.label), ["Showreel"]); assert.strictEqual(mia.notes, "");
});
test("a location card gets a Map button from its address", () => {
  const h = B.groupsOf(data, "loc", "f1")[0].cards[0];
  assert.deepStrictEqual(h.links.map((l) => l.label), ["Map"]); assert.deepStrictEqual(h.contact.map((l) => l.label), ["Call"]);
  assert.strictEqual(h.title, "12 Smith St, Fitzroy"); assert.strictEqual(h.groupType, "INT · 3 scenes");   // runs of spaces tidied
});
test("an option with notes but no name or address is still shown, with a plain title", () => {
  const d = { cast: [{ name: "X", candidates: [{ key: "cast:X:1", n: 1, row: 1, actor: "", notes: "someone's cousin", status: "", photo: "", phone: "", email: "" }] }] };
  assert.strictEqual(B.groupsOf(d, "cast", "f")[0].cards[0].title, "Unnamed");
});

/* ---------- filtering, counts, progress ---------- */
test("status chips narrow the cards; All keeps unfilled roles in view", () => {
  const g = cast();
  assert.deepStrictEqual(B.filterGroups(g, "Callback", "").map((x) => [x.name, x.cards.length]), [["ANA", 1]]);
  assert.deepStrictEqual(B.filterGroups(g, "All", "").map((x) => x.name), ["ANA", "BEN", "CAL"]);
});
test("Unfilled lists only the roles with no options yet", () => {
  assert.deepStrictEqual(B.filterGroups(cast(), "Unfilled", "").map((x) => x.name), ["BEN"]);
});
test("search matches a name, a role, a status or a note, and a role name brings all its options", () => {
  const g = cast();
  assert.deepStrictEqual(B.filterGroups(g, "All", "sam").map((x) => x.name), ["CAL"]);
  assert.deepStrictEqual(B.filterGroups(g, "All", "too old").map((x) => x.cards.map((c) => c.title)), [["Jo Smith"]]);
  assert.strictEqual(B.filterGroups(g, "All", "ana")[0].cards.length, 2);
  assert.deepStrictEqual(B.filterGroups(g, "All", "zzz"), []);
});
test("counts and the progress line", () => {
  const c = B.counts(cast(), data.statuses.cast);
  assert.strictEqual(c.all, 3); assert.strictEqual(c.by.Callback, 1); assert.strictEqual(c.by.Cast, 1); assert.strictEqual(c.by.Passed, 1);
  assert.strictEqual(c.unfilled, 1); assert.strictEqual(c.settled, 1);
  assert.strictEqual(B.progressText("cast", c), "1 of 3 roles cast · 1 with no options yet");
  assert.strictEqual(B.progressText("loc", B.counts(B.groupsOf(data, "loc", "f"), data.statuses.loc)), "0 of 1 location confirmed");
  assert.strictEqual(B.progressText("cast", B.counts([], [])), "");
});
test("a status the Sheet has that we don't list is still counted", () => {
  const d = { cast: [{ name: "A", candidates: [{ key: "cast:A:1", n: 1, row: 1, actor: "Z", status: "Hold" }] }] };
  assert.strictEqual(B.counts(B.groupsOf(d, "cast", "f"), ["Cast"]).by.Hold, 1);
});
test("arrow keys in the detail view step through the cards on screen", () => {
  const g = B.filterGroups(cast(), "All", "");
  const ids = g.reduce((a, x) => a.concat(x.cards.map((c) => c.id)), []);
  assert.strictEqual(B.neighbour(g, ids[0], 1), ids[1]);
  assert.strictEqual(B.neighbour(g, ids[ids.length - 1], 1), "");
  assert.strictEqual(B.neighbour(g, ids[0], -1), "");
  assert.strictEqual(B.neighbour(g, "nope", 1), "");
});
test("no data at all gives nothing, never an error", () => {
  assert.deepStrictEqual(B.groupsOf(null, "cast", "f"), []);
  assert.deepStrictEqual(B.groupsOf({}, "loc", "f"), []);
  assert.deepStrictEqual(B.statusList(null, "loc"), ["Passed", "Considering", "Scouted", "Confirmed"]);   // lowest to highest
});

/* ---------- editing ---------- */
test("a card remembers the Sheet's own text, so an edit starts from it", () => {
  const mia = cast()[0].cards[0];
  assert.strictEqual(mia.raw.notes, "Reel https://vimeo.com/123");   // links stay in the notes
  assert.strictEqual(mia.raw.actor, "Mia Lee"); assert.strictEqual(mia.raw.status, "Callback");
  assert.deepStrictEqual(Object.keys(B.groupsOf(data, "loc", "f")[0].cards[0].raw), ["address", "photo", "phone", "email", "status", "notes"]);   // a place has no showreel or audition
  assert.deepStrictEqual(B.fieldsOf("cast").slice(-2), ["showreel", "audition"]);
});
test("an edit is checked before it is sent", () => {
  const st = data.statuses.cast;
  assert.strictEqual(B.checkEdit("cast", { actor: "Jo", status: "Cast" }, st), "");
  assert.match(B.checkEdit("cast", { status: "Maybe" }, st), /isn't a status/);
  assert.match(B.checkEdit("cast", { photo: "javascript:alert(1)" }, st), /web link/);
  assert.match(B.checkEdit("cast", { email: "jo@x" }, st), /email/);
  assert.match(B.checkEdit("cast", { actor: "  " }, st, true), /something/);
  assert.strictEqual(B.checkEdit("cast", { actor: "", photo: "" }, st), "");       // clearing a field is fine when editing
  assert.strictEqual(B.checkEdit("cast", { photo: "imdb.com/x" }, st), "");
});
test("only what changed is sent, and a pasted link is tidied", () => {
  const base = { actor: "Mia Lee", photo: "", phone: "", email: "", status: "Callback", notes: "Reel https://vimeo.com/123" };
  assert.deepStrictEqual(B.changes("cast", base, { actor: "Mia Lee ", status: "Offered", notes: "Reel https://vimeo.com/123", photo: "www.x.com/a.jpg" }), { status: "Offered", photo: "https://www.x.com/a.jpg" });
  assert.deepStrictEqual(B.changes("cast", base, Object.assign({}, base)), {});
  assert.deepStrictEqual(B.changes("cast", base, { notes: "" }), { notes: "" });   // emptying a field counts
});
test("a saved option is put back into the data; clearing empties it or removes it", () => {
  const cand = { key: "cast:BEN:1", n: 1, row: 12, actor: "Bo", photo: "", phone: "", email: "", status: "Considering", notes: "" };
  const d2 = B.withCandidate(data, "cast", cand);
  assert.strictEqual(B.groupsOf(d2, "cast", "f")[1].cards[0].title, "Bo");
  assert.strictEqual(data.cast[1].candidates[0].actor, "");                                      // the original is untouched
  const added = B.withCandidate(d2, "cast", Object.assign({}, cand, { key: "cast:BEN:2", n: 2, row: 13, actor: "Bea" }));
  assert.deepStrictEqual(B.groupsOf(added, "cast", "f")[1].cards.map((c) => c.title), ["Bo", "Bea"]);
  assert.strictEqual(B.groupsOf(B.withoutCandidate(d2, "cast", "cast:BEN:1", false), "cast", "f")[1].cards.length, 0);
  assert.strictEqual(B.withoutCandidate(added, "cast", "cast:BEN:2", true).cast[1].candidates.length, 1);
  assert.deepStrictEqual(B.keyParts("loc:HOUSE B:3"), { kind: "loc", group: "HOUSE B", n: 3 }); assert.strictEqual(B.keyParts("nope"), null);
});

/* ---------- showreel, audition, favourites, order, brief ---------- */
const extra = {
  statuses: data.statuses,
  cast: [{ name: "ANA", type: "Lead", brief: " Guarded, mid 30s ", candidates: [
    { key: "cast:ANA:1", n: 1, row: 8, actor: "A", status: "", notes: "", showreel: "https://youtu.be/r1", audition: "vimeo.com/9", fav: false, order: 0 },
    { key: "cast:ANA:2", n: 2, row: 9, actor: "B", status: "", notes: "IMDb imdb.com/name/nm1", showreel: "https://youtu.be/r1", fav: true, order: 1, photos: ["https://x.com/a.jpg", "javascript:x", "https://x.com/a.jpg"], photo: "https://x.com/a.jpg" },
    { key: "cast:ANA:3", n: 3, row: 10, actor: "C", status: "Passed", fav: true, order: 0 },
    { key: "cast:ANA:4", n: 4, row: 11, actor: "D", status: "", order: 2, fav: false } ] }]
};
test("a card's links are showreel, audition and notes links; reel isn't repeated from the notes", () => {
  const g = B.groupsOf(extra, "cast", "f")[0];
  assert.strictEqual(g.brief, "Guarded, mid 30s");
  assert.deepStrictEqual(g.cards.map((c) => c.title), ["B", "D", "A", "C"]);                  // order set first, then the Sheet's order; passed last
  assert.deepStrictEqual(g.cards[2].links.map((l) => l.label), ["Showreel", "Audition"]);
  assert.deepStrictEqual(g.cards[0].links.map((l) => l.label), ["Showreel", "IMDb"]);
  assert.deepStrictEqual(g.cards[0].photos, ["https://x.com/a.jpg"]);                         // unsafe and repeated photos dropped
});
test("favourites come from every group and keep their own place too", () => {
  const g = B.groupsOf(extra, "cast", "f");
  assert.deepStrictEqual(B.favoritesOf(g).map((c) => c.title), ["B", "C"]);
  assert.strictEqual(g[0].cards.length, 4);
});
test("moving a card by one step or before another", () => {
  const k = ["a", "b", "c", "d"];
  assert.deepStrictEqual(B.reorder(k, "c", -1), ["a", "c", "b", "d"]);
  assert.deepStrictEqual(B.reorder(k, "a", -1), k);
  assert.deepStrictEqual(B.reorder(k, "b", 1), ["a", "c", "b", "d"]);
  assert.deepStrictEqual(B.reorder(k, "a", "c"), ["b", "a", "c", "d"]);
  assert.deepStrictEqual(B.reorder(k, "d", "b"), ["a", "d", "b", "c"]);
  assert.deepStrictEqual(B.reorder(k, "x", 1), k);
  assert.deepStrictEqual(B.swap(k, "a", "c"), ["c", "b", "a", "d"]);                         // dragging one onto another swaps them
  assert.deepStrictEqual(B.swap(k, "a", "zz"), k);
  const d = B.withOrder(extra, "cast", ["cast:ANA:4", "cast:ANA:1", "cast:ANA:2", "cast:ANA:3"]);
  assert.deepStrictEqual(B.groupsOf(d, "cast", "f")[0].cards.map((c) => c.title), ["D", "A", "B", "C"]);
  assert.strictEqual(B.withBrief(extra, "cast", "ANA", "x").cast[0].brief, "x");
});
test("links in an edit are checked and tidied", () => {
  const st = data.statuses.cast;
  assert.match(B.checkEdit("cast", { showreel: "javascript:x" }, st), /showreel/);
  assert.match(B.checkEdit("cast", { audition: "nope" }, st), /audition/);
  assert.strictEqual(B.tidyValues("cast", { showreel: "vimeo.com/5" }).showreel, "https://vimeo.com/5");
  assert.deepStrictEqual(B.changes("cast", { showreel: "https://a.com/" }, { showreel: "a.com" }), {});
});

/* ---------- photos ---------- */
test("the first photo is the display photo; making another the display photo reorders", () => {
  const l = ["https://a.com/1.jpg", "https://a.com/2.jpg", "https://a.com/3.jpg"];
  assert.deepStrictEqual(B.photoFields(l), { photo: l[0], photos: [l[1], l[2]] });
  assert.deepStrictEqual(B.makeDisplay(l, l[2]), [l[2], l[0], l[1]]);
  assert.deepStrictEqual(B.makeDisplay(l, l[0]), l);
  assert.deepStrictEqual(B.removePhoto(l, l[0]), [l[1], l[2]]);                       // the next one becomes the display photo
  assert.deepStrictEqual(B.photoFields([]), { photo: "", photos: [] });
});
test("added photos skip repeats and unsafe links, and stop at the limit", () => {
  assert.deepStrictEqual(B.addPhotos(["https://a.com/1.jpg"], ["https://a.com/1.jpg", "javascript:x", "https://a.com/2.jpg"]), ["https://a.com/1.jpg", "https://a.com/2.jpg"]);
  const many = []; for(let i = 0; i < 20; i++) many.push("https://a.com/" + i + ".jpg");
  assert.strictEqual(B.addPhotos([], many).length, B.MAX_PHOTOS);
  assert.strictEqual(B.samePhotos(["https://a.com/1.jpg"], ["a.com/1.jpg"]), true);        // spelling tidied the same way
  assert.strictEqual(B.samePhotos(["https://a.com/1.jpg"], ["https://a.com/1.jpg"]), true);
});
test("the viewer asks Drive for a bigger picture; only real images upload", () => {
  const u = "https://drive.google.com/file/d/1AbCdEfGhIjKl/view";
  assert.strictEqual(B.viewSrc(u, true), "https://drive.google.com/thumbnail?id=1AbCdEfGhIjKl&sz=w1600");
  assert.strictEqual(B.viewSrc("https://example.com/page", true), "");
  assert.strictEqual(B.imageOk("image/jpeg", 1000), true); assert.strictEqual(B.imageOk("application/pdf", 1000), false); assert.strictEqual(B.imageOk("image/png", 0), false);
});

test("several showreels and audition tapes, each its own button", () => {
  const d = { cast: [{ name: "A", candidates: [{ key: "cast:A:1", n: 1, row: 1, actor: "X", showreel: "https://youtu.be/1\n vimeo.com/2 \nhttps://youtu.be/1", audition: "https://a.com/t" }] }] };
  const c = B.groupsOf(d, "cast", "f")[0].cards[0];
  assert.deepStrictEqual(c.links.map((l) => l.label), ["Showreel 1", "Showreel 2", "Audition"]);
  assert.strictEqual(B.tidyValues("cast", { showreel: "vimeo.com/2\n\nhttps://youtu.be/1\nvimeo.com/2" }).showreel, "https://vimeo.com/2\nhttps://youtu.be/1");
  assert.match(B.checkEdit("cast", { showreel: "https://youtu.be/1\nnope" }, ["Cast"]), /showreel/);
  assert.strictEqual(B.checkEdit("cast", { showreel: "https://youtu.be/1\nvimeo.com/2" }, ["Cast"]), "");
});

console.log(`\n${passed} passed, ${failed} failed`);
if(failed) process.exit(1);
