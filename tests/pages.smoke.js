// Page smoke tests: every page opens in a real (headless) browser with a fake Apps Script and no network,
// and must load without a JavaScript error. Run: node tests/pages.smoke.js  (needs the "playwright" package)
// Deploy runs this after the node tests; a failure stops the deploy.
"use strict";
const http = require("http"), fs = require("fs"), path = require("path");
const { chromium } = require("playwright");
const ROOT = path.join(__dirname, "..");

const L = (t, x, i) => ({ id: "l" + i, type: t, runs: [{ t: x }] });
const lines = []; let n = 0;
for(let s = 0; s < 12; s++){ lines.push(L("scene", (s % 2 ? "EXT. PARK" : "INT. HOUSE - KITCHEN") + " - DAY", n++)); lines.push(L("action", "ANA walks in. BEN follows.", n++)); lines.push(L("character", s % 3 ? "ANA" : "BEN", n++)); lines.push(L("dialogue", "Some words to say out loud.", n++)); }
const DOC = { title: { title: "SMOKE", name: "Tester" }, lines, meta: { pages: 6 }, pageSettings: {} };
const answer = (a) => a === "load" ? { ok: true, doc: DOC, file: { name: "SMOKE", modified: new Date().toISOString() } }
  : a === "treatmentload" ? { ok: true, exists: false } : a === "shotlistdata" ? { ok: true, shots: [], scenes: [] }
  : a === "list" ? { ok: true, files: [{ id: "f1", name: "SMOKE", modified: new Date().toISOString() }], folders: [] } : { ok: true };
const TYPES = { ".js": "text/javascript", ".json": "application/json", ".png": "image/png", ".css": "text/css", ".ttf": "font/ttf" };
const srv = http.createServer((q, r) => {
  const u = new URL(q.url, "http://x");
  if(u.pathname === "/api"){
    let body = ""; q.on("data", (d) => { body += d; });
    q.on("end", () => {
      let a = u.searchParams.get("action"); try{ a = a || JSON.parse(body).action; }catch(_e){}
      const cb = u.searchParams.get("callback") || u.searchParams.get("cb"), j = JSON.stringify(answer(a));
      r.writeHead(200, { "content-type": cb ? "text/javascript" : "application/json" }); r.end(cb ? cb + "(" + j + ")" : j);
    });
    return;
  }
  const f = path.join(ROOT, decodeURIComponent(u.pathname));
  if(!f.startsWith(ROOT)){ r.writeHead(403); return r.end(); }
  fs.readFile(f, (e, d) => { r.writeHead(e ? 404 : 200, { "content-type": TYPES[path.extname(f)] || "text/html" }); r.end(d); });
});

let passed = 0, failed = 0;
async function page(browser, name, url, check){
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } }), p = await ctx.newPage(), errs = [];
  p.on("pageerror", (e) => errs.push(e.message));
  await ctx.route(/^https?:\/\/(?!localhost)/, (r) => r.abort());           // no fonts, Firebase or Google: the pages must cope
  try{
    await p.goto(BASE + "/library.html"); await p.evaluate((ep) => localStorage.setItem("SCRIPTY_CLOUD_ENDPOINT_V1", ep), BASE + "/api");
    await p.goto(BASE + url); await p.waitForTimeout(2500);
    if(check) await check(p);
    if(errs.length) throw new Error("page error: " + errs.slice(0, 3).join(" | "));
    passed++; console.log("  ok  " + name);
  }catch(e){ failed++; console.log("  FAIL " + name + "\n       " + (e && e.message)); }
  await ctx.close();
}
const expect = async (p, fn, what) => { const ok = await p.evaluate(fn); if(!ok) throw new Error("expected " + what); };
let BASE = "";

(async () => {
  await new Promise((ok) => srv.listen(0, ok)); BASE = "http://localhost:" + srv.address().port;
  const browser = await chromium.launch();
  console.log("Pages");
  await page(browser, "hub opens", "/index.html");
  await page(browser, "library opens", "/library.html");
  await page(browser, "editor shows the script's scenes", "/editor.html?fileId=f1", (p) => expect(p, () => /SMOKE/.test(document.body.innerText) && /INT\. HOUSE/.test(document.body.innerText), "the script title and scenes"));
  await page(browser, "editor: tag selected words for the breakdown", "/editor.html?fileId=f1", async (p) => {
    await p.evaluate(() => localStorage.clear());
    await expect(p, () => !!document.querySelector('#scriptEditor .line[data-type="action"]') && !!window.CampBdTag, "the script and the tagger");
    await p.evaluate(() => {
      const line = document.querySelector('#scriptEditor .line[data-type="action"]'), t = line.firstChild;
      const r = document.createRange(); r.setStart(t.nodeType === 3 ? t : line.firstChild.firstChild, 0); r.setEnd(t.nodeType === 3 ? t : line.firstChild.firstChild, 3);
      const s = getSelection(); s.removeAllRanges(); s.addRange(r);
      document.getElementById("mTagBreakdown").click();
    });
    await p.waitForTimeout(300);
    await expect(p, () => !document.querySelector(".bdtPop").hidden && document.querySelector("#bdtName").value === "ANA", "the tag card with the selected word");
    await p.click('.bdtPop [data-c=wardrobe]'); await p.click('.bdtPop [data-a=add]'); await p.waitForTimeout(400);
    await expect(p, () => { const st = window.CampBdTag.store(); const k = Object.keys(st.tags || {})[0]; return k && st.tags[k][0].c === "wardrobe" && st.tags[k][0].n === "ANA"; }, "the tag saved for the scene");
    await expect(p, () => !window.CSS.highlights || window.CSS.highlights.has("bd-wardrobe"), "the words coloured by category");
  });
  await page(browser, "storyboard opens", "/storyboard.html?fileId=f1");
  await page(browser, "treatment builds its pages, and Export shows the preview first", "/treatment.html?fileId=f1", async (p) => {
    await expect(p, () => document.querySelectorAll(".navItem").length > 2 && !!document.querySelector("#stage .tpage"), "pages on the stage");
    await p.click("#stage"); await p.keyboard.press("Control+a"); await p.waitForTimeout(200);
    await expect(p, () => /SELECTED/.test((document.querySelector("#rightRail .section-title") || {}).textContent || ""), "Ctrl/Cmd+A to select several");
    await p.keyboard.press("Escape");
    await p.click("#exportBtn"); await p.waitForTimeout(300);
    await expect(p, () => document.getElementById("preview").classList.contains("exporting"), "the export preview");
  });
  await page(browser, "plan panel: cast types and places with areas", "/tests/fixtures/plan.html?popout=1", async (p) => {
    await p.evaluate(() => { localStorage.setItem("Camp_PROD_LOCS_OPEN_V1", "1"); localStorage.setItem("Camp_PROD_CAST_OPEN_V1", "1"); CampProdPanel.render("p1"); });
    await p.waitForTimeout(600); await p.evaluate(() => CampProdPanel.render("p1")); await p.waitForTimeout(300);
    await expect(p, () => !!document.querySelector("details[data-sec=cast] select[data-ctype]"), "the cast type dropdowns");
    await p.click("[data-a=lcnew]"); await p.fill("#lcName", "house");
    for(const v of ["KITCHEN", "BEDROOM"]) await p.check(`.lcPick input[value="${v}"]`);
    await p.click("[data-a=lcok]"); await p.waitForTimeout(500);
    await expect(p, () => (window.__CampHub.project().production.locMerge || []).length === 2, "two locations grouped into HOUSE");
  });
  await page(browser, "breakdown panel: sheets, add and remove an element, elements manager", "/tests/fixtures/bd.html", async (p) => {
    await p.evaluate(() => { localStorage.clear(); CampBdPanel.setMode(true); CampBdPanel.render("p1"); });
    await p.waitForTimeout(700); await p.evaluate(() => CampBdPanel.render("p1")); await p.waitForTimeout(300);
    await expect(p, () => document.querySelectorAll(".bdSc").length >= 3 && !!document.querySelector(".bdSheet .cat"), "scene list and a sheet with category boxes");
    await expect(p, () => /ANA/.test(document.querySelector(".bdSheet").innerText), "cast on the sheet");
    await p.click("[data-a=add][data-c=props]"); await p.fill("#bdAdd", "lantern"); await p.keyboard.press("Enter"); await p.waitForTimeout(300);
    await expect(p, () => /Lantern/.test(document.querySelector(".bdSheet").innerText), "the hand-added prop");
    await expect(p, () => { const b = __CampHub.project().breakdown; const sid = b && Object.keys(b)[0]; return !!sid && JSON.stringify(b[sid].tags || {}).indexOf("props|lantern") >= 0; }, "the tag shared to the team's copy");
    await p.click('.el [data-a=rm]:near(:text("Lantern"))'); await p.waitForTimeout(300);
    await expect(p, () => !/Lantern/.test(document.querySelector(".bdSheet").innerText), "the prop taken out again");
    await expect(p, () => { const b = __CampHub.project().breakdown, r = b[Object.keys(b)[0]]; return JSON.stringify(r.tags || {}).indexOf("lantern") < 0; }, "the removal shared too");
    // a teammate's change arrives through the project and shows up
    await p.evaluate(() => { const b = __CampHub.project().breakdown, sid = Object.keys(b)[0]; const st = CampElements.fromRemote(b[sid]); const k = doc.lines.find((l) => l.type === "scene").id; b[sid] = CampElements.toRemote(CampElements.tag(st, k, "animals", "Goose")); CampBdPanel.render("p1"); });
    await p.waitForTimeout(300);
    await expect(p, () => /Goose/.test(document.querySelector(".bdSheet").innerText), "a teammate's tag");
    // the database refuses: the change stays on this device and says so
    await p.evaluate(() => { window.__denyBd = true; }); await p.click("[data-a=add][data-c=props]"); await p.fill("#bdAdd", "kite"); await p.keyboard.press("Enter"); await p.waitForTimeout(400);
    await expect(p, () => /Kite/.test(document.querySelector(".bdSheet").innerText) && /Not shared/.test(document.querySelector(".bdTop").innerText), "kept on this device, marked not shared");
    await p.click('[data-a=view][data-v=elements]'); await p.waitForTimeout(300);
    await expect(p, () => !!document.querySelector("table.bdT tbody tr"), "the elements table");
    await p.click('[data-a=view][data-v=reports]'); await p.waitForTimeout(300);
    await expect(p, () => document.querySelectorAll(".rp").length > 0, "category reports");
    await p.click('[data-a=view][data-v=strips]'); await p.waitForTimeout(300);
    await expect(p, () => document.querySelectorAll(".stp").length >= 3 && !!document.querySelector(".stpDay"), "the stripboard with day banners");
  });
  await browser.close(); srv.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  if(failed) process.exit(1);
})().catch((e) => { console.error(e); process.exit(1); });
