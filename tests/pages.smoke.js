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
    await p.click('.bdtPop [data-c=wardrobe]'); await p.click('.bdtPop [data-a=add]'); await p.waitForTimeout(900);
    await expect(p, () => { const st = window.CampBdTag.store(); const k = Object.keys(st.tags || {})[0]; return k && st.tags[k][0].c === "wardrobe" && st.tags[k][0].n === "ANA"; }, "the tag saved for the scene");
    await expect(p, () => !window.CSS.highlights || window.CSS.highlights.has("bd-wardrobe"), "the words coloured by category");
    await expect(p, () => !document.querySelector(".bdtKey").hidden && !window.CSS.highlights || window.CSS.highlights.has("bd-cast"), "found tags (cast) shown with the key");
    await expect(p, () => !!document.querySelector("#bdtPanel .bdtKey.inPanel") && !document.getElementById("bdtField").hidden, "the tags key sits in the right panel under Font");
    await expect(p, () => document.querySelectorAll("#bdtPanel .bdtGrp").length > 0, "this scene's tags are listed in dropdowns by category");
    await p.evaluate(() => { const d = document.querySelector("#bdtPanel .bdtGrp"); d.open = true; });
    await p.waitForTimeout(200);
    await p.evaluate(() => { document.querySelector("#bdtPanel .bdtGrp [data-k=rm]").click(); });
    await p.waitForTimeout(900);
    await expect(p, () => Object.keys(window.CampBdTag.store().off || {}).length > 0, "taking a found tag out is remembered");
    await expect(p, () => !window.CSS.highlights || window.CSS.highlights.has("bd-cast") || window.CSS.highlights.has("bd-wardrobe"), "found tags are coloured like any other");
    await p.keyboard.press("Escape"); await p.evaluate(() => document.getElementById("mToggleTags").click()); await p.waitForTimeout(300);
    await expect(p, () => document.querySelector(".bdtKey").hidden && (!window.CSS.highlights || !window.CSS.highlights.has("bd-cast")), "View › Show Breakdown Tags turns them off");
  });
  await page(browser, "editor: Shot Heading (Ctrl+7) is upper case, lines up with action, and is not a scene", "/editor.html?fileId=f1", async (p) => {
    await p.waitForSelector('#scriptEditor .line[data-type="action"]');
    const before = await p.evaluate(() => document.querySelectorAll('#scriptEditor .line[data-type="scene"]').length);
    await p.evaluate(() => { const l = [...document.querySelectorAll("#scriptEditor .line")].find((x) => x.dataset.type === "action"); l.textContent = "close on the knife"; l.focus(); const r = document.createRange(); r.selectNodeContents(l); r.collapse(false); const s = getSelection(); s.removeAllRanges(); s.addRange(r); });
    await p.keyboard.press("Control+7"); await p.waitForTimeout(600);
    const r = await p.evaluate(() => { const sh = document.querySelector('#scriptEditor .line[data-type="shot"]'), ac = document.querySelector('#scriptEditor .line[data-type="action"]'); if(!sh) return null; const a = getComputedStyle(sh), b = getComputedStyle(ac); return { text: sh.textContent, tt: a.textTransform, ml: a.marginLeft === b.marginLeft, scenes: document.querySelectorAll('#scriptEditor .line[data-type="scene"]').length }; });
    if(!r || r.text !== "CLOSE ON THE KNIFE" || r.tt !== "uppercase" || !r.ml || r.scenes !== before) throw new Error("shot: " + JSON.stringify(r) + " scenes before " + before);
  });
  await page(browser, "editor: Australian spellcheck flags color and teh, not realise or colour", "/editor.html?fileId=f1", async (p) => {
    await p.evaluate(() => { const l = [...document.querySelectorAll("#scriptEditor .line")].find((x) => x.dataset.type === "action"); l.textContent = "We realise the colour is wrong, the color teh."; });
    await p.waitForFunction(() => window.CampSpell && window.CampSpell.refresh, null, { timeout: 8000 });
    await p.waitForTimeout(4000);
    const words = await p.evaluate(() => { const h = CSS.highlights.get("camp-spell"); return h ? [...h].map((r) => r.toString()) : []; });
    if(!(words.includes("color") && words.includes("teh") && !words.includes("realise") && !words.includes("colour"))) throw new Error("flagged: " + JSON.stringify(words));
  });
  await page(browser, "editor: the right-click menu keeps the typing suggestions out of its way", "/editor.html?fileId=f1", async (p) => {
    await p.waitForSelector('#scriptEditor .line[data-type="character"]');
    await p.evaluate(() => { const m = document.getElementById("charMenu") || Object.assign(document.body.appendChild(document.createElement("div")), { id: "charMenu", className: "charMenu" }); m.hidden = false; m.textContent = "ANA"; });
    await p.evaluate(() => document.querySelector('#scriptEditor .line[data-type="character"]').scrollIntoView({ block: "center" })); await p.waitForTimeout(400);
    await p.click('#scriptEditor .line[data-type="character"]', { button: "right" }); await p.waitForTimeout(200);
    await expect(p, () => !document.getElementById("qMenu").hidden && document.body.classList.contains("ctxOpen") && getComputedStyle(document.getElementById("charMenu")).display === "none", "only the right-click menu showing");
    await p.keyboard.press("Escape"); await p.waitForTimeout(100);
    await expect(p, () => document.getElementById("qMenu").hidden && !document.body.classList.contains("ctxOpen"), "closed again");
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
    await p.evaluate(() => CampProdPanel.render("p1")); await p.waitForTimeout(600); await p.evaluate(() => CampProdPanel.render("p1")); await p.waitForTimeout(300);
    await p.click('[data-sb=sec][data-v=cast]'); await p.waitForTimeout(300);
    await expect(p, () => !!document.querySelector("details[data-sec=cast] select[data-ctype]"), "the cast type dropdowns on the Cast tab");
    await p.click('[data-sb=sec][data-v=locs]'); await p.waitForTimeout(300);
    await p.click("[data-a=lcnew]"); await p.fill("#lcName", "house");
    for(const v of ["KITCHEN", "BEDROOM"]) await p.check(`.lcPick input[value="${v}"]`);
    await p.click("[data-a=lcok]"); await p.waitForTimeout(500);
    await expect(p, () => (window.__CampHub.project().production.locMerge || []).length === 2, "two locations grouped into HOUSE");
  });
  await page(browser, "plan follows the breakdown: a hand-tagged animal reaches the day card", "/tests/fixtures/plan.html?popout=1", async (p) => {
    await p.evaluate(() => { localStorage.clear(); CampProdPanel.render("p1"); });
    await p.waitForTimeout(1500); await p.evaluate(() => CampProdPanel.render("p1"));
    await p.waitForTimeout(700);
    await p.evaluate(() => {
      const k = doc.lines.find((l) => l.type === "scene").id;
      localStorage.setItem("Camp_BD_V1_f1", JSON.stringify(CampElements.tag({}, k, "stunts", "Horse fall")));
      __CampHub.project().production.days[0].scenes = [k];
      window.dispatchEvent(new StorageEvent("storage", { key: "Camp_BD_V1_f1" }));
      CampProdPanel.render("p1");
    });
    await p.waitForTimeout(500);
    await expect(p, () => /Stunts 1/.test(document.querySelector(".sbBoard .sbNeeds").textContent), "the stunt shows as a need on the day (in the Elements chip)");
  });
  await page(browser, "stripboard: strips, day headers, move several, filters, tabs", "/tests/fixtures/plan.html?popout=1", async (p) => {
    await p.evaluate(() => { localStorage.clear(); CampProdPanel.render("p1"); });
    await p.waitForTimeout(800); await p.evaluate(() => CampProdPanel.render("p1")); await p.waitForTimeout(300);
    await expect(p, () => document.querySelectorAll(".sbRow").length >= 3 && document.querySelectorAll(".sbDayWrap:not(.sbBone)").length === 2 && !!document.querySelector(".sbBone"), "strips, two days and the Unscheduled pool");
    await expect(p, () => document.querySelectorAll(".sbEnd").length === 2 && /End of Day 1/i.test(document.querySelector(".sbEnd").innerText), "End of Day banners");
    // pick two strips from the pool (click, then Ctrl+click) and move them to Day 2 together
    await p.click(".sbBone .sbRow >> nth=0"); await p.waitForTimeout(150); await p.click(".sbBone .sbRow >> nth=1", { modifiers: ["Control"] }); await p.waitForTimeout(200);
    await expect(p, () => /2 selected/.test((document.querySelector(".sbSelBar") || {}).innerText || ""), "the selection bar with 2 selected");
    const want = await p.evaluate(() => Array.from(document.querySelectorAll(".sbBone .sbRow.sel")).map((r) => r.dataset.sid));
    await p.selectOption("[data-sbmove]", "1"); await p.waitForTimeout(700);
    await expect(p, () => !document.querySelector(".sbSelBar"), "selection cleared after the move");
    const got = await p.evaluate(() => (__CampHub.project().production.days[1] || {}).scenes || []);
    if(JSON.stringify(got) !== JSON.stringify(want)) throw new Error("Day 2 has " + JSON.stringify(got) + ", wanted " + JSON.stringify(want));
    // drag one strip onto Day 1's header
    // drag a strip up onto Day 1: it moves only up and down, and a gap shows where it lands
    { const a = await p.$('.sbDayWrap[data-day="1"] .sbRow'), ab = await a.boundingBox(), t = await (await p.$('.sbDayWrap[data-day="0"] .sbDay')).boundingBox();
      await p.mouse.move(ab.x + ab.width / 2, ab.y + ab.height / 2); await p.mouse.down();
      for(let k = 1; k <= 8; k++){ await p.mouse.move(ab.x + ab.width / 2, ab.y + ab.height / 2 + (t.y + t.height / 2 - ab.y - ab.height / 2) * k / 8); await p.waitForTimeout(30); }
      await expect(p, () => !!document.querySelector(".sbFloat") && !!document.querySelector('.sbDayWrap[data-day="0"] .sbGap'), "the floating strip and the gap in Day 1");
      await p.mouse.up(); await p.waitForTimeout(800); }
    await expect(p, () => ((__CampHub.project().production.days[0] || {}).scenes || []).length === 1, "a strip dragged onto Day 1");
    // filters hide strips; the note says how many
    await p.selectOption("[data-sbf=dn]", "N"); await p.waitForTimeout(300);
    await expect(p, () => document.querySelectorAll(".sbRow.sbHide").length >= 1 && !!document.querySelector(".sbFiltNote"), "night filter hides day strips");
    await p.click("[data-sb=unfilter]"); await p.waitForTimeout(300);
    await expect(p, () => !document.querySelector(".sbRow.sbHide"), "Show all brings them back");
    // sort a day and the other plan views
    await p.click('[data-sb=sec][data-v=dood]'); await p.waitForTimeout(300);
    await expect(p, () => !!document.querySelector(".sbSec details[open] table"), "the Day Out of Days tab");
    await p.click('[data-sb=sec][data-v=strips]'); await p.waitForTimeout(200);
    await expect(p, () => !!document.querySelector(".sbBoard") && !document.querySelector("[data-a=pview], [data-sb=dense], .sbLegend"), "no view, density or legend toggles");
    // dropdowns open downwards and still drive the plan
    await p.click('.sbDayWrap[data-day="0"] .sbDayB label:nth-child(2) .sbPick'); await p.waitForTimeout(150);
    await expect(p, () => { const m = document.querySelector(".sbMenu"), b = document.querySelector('.sbDayWrap[data-day="0"] .sbDayB label:nth-child(2) .sbPick'); return m && b && m.getBoundingClientRect().top >= b.getBoundingClientRect().bottom; }, "the Lunch list opening below its button");
    await p.click('.sbMenu .sbOpt:has-text("12:00 pm")'); await p.waitForTimeout(500);
    await expect(p, () => __CampHub.project().production.days[0].lunch === "12:00", "lunch set from the list");
    // a break added by hand
    await p.click('.sbDayWrap[data-day="0"] [data-sb=xnew]'); await p.waitForTimeout(200);
    await p.fill('.sbXForm [data-xf=label]', "Camera reset"); await p.click('.sbXForm [data-sb=xsave]'); await p.waitForTimeout(500);
    await expect(p, () => ((__CampHub.project().production.days[0].extras) || []).length === 1 && /Camera reset/.test(document.querySelector('.sbDayWrap[data-day="0"]').innerText), "the break on Day 1");
    // every strip is the same height, with or without a description
    await expect(p, () => new Set(Array.from(document.querySelectorAll(".sbRow")).map((r) => Math.round(r.getBoundingClientRect().height))).size === 1, "strips all one height");
    // the meal: change its length, take it off the day, put it back
    await p.evaluate(() => { const pr = __CampHub.project().production, ids = doc.lines.filter((l) => l.type === "scene").map((l) => l.id); pr.days[0].scenes = ids.slice(0, 3); pr.days[0].extras = []; delete pr.days[0].lunch; pr.settings.times = { mealBy: 30 }; CampProdPanel.render("p1"); });
    await p.waitForTimeout(500);
    await p.click('.sbDayWrap[data-day="0"] [data-sb=meal]'); await p.waitForTimeout(200);
    await p.fill('.sbXForm.meal [data-mf=min]', "45"); await p.click('.sbXForm.meal [data-sb=mealsave]'); await p.waitForTimeout(500);
    await expect(p, () => __CampHub.project().production.days[0].mealMin === 45, "a 45-minute meal");
    await p.click('.sbDayWrap[data-day="0"] [data-sb=meal]'); await p.waitForTimeout(200); await p.click('.sbXForm.meal [data-sb=mealdel]'); await p.waitForTimeout(500);
    await expect(p, () => __CampHub.project().production.days[0].noMeal === true && !!document.querySelector('[data-sb=mealback]'), "no meal on Day 1, with a way to put it back");
    await p.click('[data-sb=mealback]'); await p.waitForTimeout(500);
    await expect(p, () => !__CampHub.project().production.days[0].noMeal && !!document.querySelector('.sbDayWrap[data-day="0"] [data-sb=meal]'), "the meal back");
    // from the Breakdown: show a scene on the Stripboard, selected
    await p.evaluate(() => CampProdPanel.focusScene("p1", doc.lines.filter((l) => l.type === "scene")[1].id)); await p.waitForTimeout(400);
    await expect(p, () => { const r = document.querySelector(".sbRow.sel"); return r && r.dataset.sid === doc.lines.filter((l) => l.type === "scene")[1].id; }, "the scene selected on the Stripboard");
    await p.hover(".sbTot .cap"); await p.waitForTimeout(150);
    await expect(p, () => { const t = document.getElementById("sbTip"); return t && t.classList.contains("show") && t.textContent.length > 5; }, "a tooltip on hover");
  });
  await page(browser, "layouts: new board, draw, kit piece, move, undo, note", "/tests/fixtures/layouts.html", async (p) => {
    await p.click("[data-ly=new]"); await p.waitForTimeout(300);
    await expect(p, () => Object.keys(__CampHub.project().layouts).length === 1 && !!document.querySelector(".lyCard.on"), "a new layout, selected");
    const box = await (await p.$(".lySvg")).boundingBox(), cx = box.x + box.width / 2, cy = box.y + box.height / 2;
    await p.click("[data-tool=rect]"); await p.mouse.move(cx - 100, cy - 60); await p.mouse.down(); await p.mouse.move(cx - 20, cy - 10, { steps: 5 }); await p.mouse.up(); await p.waitForTimeout(200);
    const items = () => { const L = Object.values(__CampHub.project().layouts)[0]; return Object.values((L && L.items) || {}); };
    await expect(p, () => { const L = Object.values(__CampHub.project().layouts)[0]; return Object.values(L.items || {}).some((i) => i.t === "rect" && i.w > 50); }, "a rectangle drawn");
    await p.click("[data-ly=kit]"); await p.click("[data-kit=fresnel]"); await p.waitForTimeout(200);
    await expect(p, () => { const L = Object.values(__CampHub.project().layouts)[0]; return Object.values(L.items || {}).some((i) => i.t === "kit" && i.k === "fresnel"); }, "a fresnel added from the kit");
    // move the selected fresnel by dragging it
    const before = await p.evaluate(() => { const L = Object.values(__CampHub.project().layouts)[0]; const f = Object.values(L.items).find((i) => i.k === "fresnel"); return [f.x, f.y]; });
    const g = await (await p.$('.lyItemsG .lyIt:last-child')).boundingBox();
    await p.mouse.move(g.x + g.width / 2, g.y + g.height - 6); await p.mouse.down(); await p.mouse.move(g.x + g.width / 2 + 80, g.y + g.height - 6 + 40, { steps: 6 }); await p.mouse.up(); await p.waitForTimeout(200);
    const after = await p.evaluate(() => { const L = Object.values(__CampHub.project().layouts)[0]; const f = Object.values(L.items).find((i) => i.k === "fresnel"); return [f.x, f.y]; });
    if(!(after[0] > before[0] + 40)) throw new Error("fresnel didn't move: " + before + " -> " + after);
    await p.click("[data-ly=undo]"); await p.waitForTimeout(200);
    const back = await p.evaluate(() => { const L = Object.values(__CampHub.project().layouts)[0]; const f = Object.values(L.items).find((i) => i.k === "fresnel"); return [f.x, f.y]; });
    if(Math.abs(back[0] - before[0]) > 1) throw new Error("undo didn't put it back");
    await p.click("[data-tool=note]"); await p.mouse.click(cx + 150, cy + 80); await p.waitForTimeout(150);
    await p.keyboard.type("Key light from window"); await p.keyboard.press("Escape"); await p.waitForTimeout(200);
    await expect(p, () => { const L = Object.values(__CampHub.project().layouts)[0]; return Object.values(L.items).some((i) => i.t === "note" && /Key light/.test(i.text)); }, "a sticky note with text");
    void items;
  });
  await page(browser, "calendar: add an event, meeting minutes, action item, search", "/tests/fixtures/calendar.html", async (p) => {
    await p.fill('.caAdd input[name=t]', 'Location recce'); await p.selectOption('.caAdd select', 'meeting'); await p.press('.caAdd input[name=t]', 'Enter'); await p.waitForTimeout(300);
    await expect(p, () => Object.values(__CampHub.project().calendar).some((e) => e.title === "Location recce" && e.k === "meeting"), "an event on the selected day");
    await expect(p, () => !!document.querySelector(".caEd"), "the meeting opens ready for minutes");
    await p.fill('.caEd textarea[data-f=mn]', 'Agreed to shoot the diner at dawn'); await p.press('.caEd textarea[data-f=mn]', 'Tab'); await p.waitForTimeout(300);
    await p.fill('.caAct input', 'Book the diner'); await p.press('.caAct input', 'Enter'); await p.waitForTimeout(300);
    await expect(p, () => Object.values(__CampHub.project().calendar).some((e) => /dawn/.test(e.mn || "") && e.acts === "[ ] Book the diner"), "minutes and an action item saved");
    await p.click('.caActs input[type=checkbox]'); await p.waitForTimeout(300);
    await expect(p, () => Object.values(__CampHub.project().calendar).some((e) => e.acts === "[x] Book the diner"), "the action item ticked");
    await p.click('.caTabs [data-s=min]'); await p.fill('.caSearch', 'diner'); await p.waitForTimeout(200);
    await expect(p, () => document.querySelectorAll(".caBody .caEv").length === 1, "the minutes found by search");
  });
  await page(browser, "breakdown: category picker with colours, highlighted jump to the scene text, icons", "/tests/fixtures/bd.html", async (p) => {
    await p.evaluate(() => { localStorage.clear(); CampBdPanel.setMode(true); CampBdPanel.render("p1"); });
    await p.waitForTimeout(700); await p.evaluate(() => CampBdPanel.render("p1")); await p.waitForTimeout(300);
    await p.click(".qAdd .catPick"); await p.waitForTimeout(150);
    await expect(p, () => document.querySelectorAll(".catMenu .cpO .cpI svg").length > 10, "the category list with an icon for each");
    await p.click('.catMenu .cpO:has-text("Wardrobe")'); await p.waitForTimeout(150);
    await expect(p, () => document.getElementById("bdQCat").value === "wardrobe" && /Wardrobe/.test(document.querySelector(".qAdd .catPick").innerText), "Wardrobe picked");
    await p.click('table.ct .goText >> nth=0'); await p.waitForTimeout(600);
    await expect(p, () => !!document.querySelector(".stBody mark.hiEl") && !!document.querySelector(".hiChip"), "the element's words highlighted, with a chip to clear it");
    await p.click(".hiChip"); await p.waitForTimeout(300);
    await expect(p, () => !document.querySelector(".stBody mark.hiEl"), "highlight cleared");
    await p.click('[data-a=view][data-v=elements]'); await p.waitForTimeout(300);
    await expect(p, () => !!document.querySelector(".catChip .ci") && !!document.querySelector("tr.grp .ci"), "category icons in the Elements view");
    await p.click('[data-a=view][data-v=reports]'); await p.waitForTimeout(300);
    await expect(p, () => !!document.querySelector(".rp h4 .ci"), "category icons on the reports");
  });
  await page(browser, "breakdown panel: sheets, add and remove an element, elements manager", "/tests/fixtures/bd.html", async (p) => {
    await p.evaluate(() => { localStorage.clear(); CampBdPanel.setMode(true); CampBdPanel.render("p1"); });
    await p.waitForTimeout(700); await p.evaluate(() => CampBdPanel.render("p1")); await p.waitForTimeout(300);
    await expect(p, () => document.querySelectorAll(".bdSc").length >= 3 && !!document.querySelector(".bdSheet .cat"), "scene list and a sheet with category boxes");
    await expect(p, () => /ANA/.test(document.querySelector(".bdSheet").innerText), "cast on the sheet");
    await expect(p, () => !!document.querySelector(".shText mark"), "the scene text with tagged words coloured");
    await expect(p, () => !!document.getElementById("shDir"), "the director's notes box");
    await expect(p, () => !!document.querySelector("table.ct .star"), "a hero star on each element");
    await p.selectOption("#bdQCat", "props"); await p.fill("#bdQuick", "lantern"); await p.keyboard.press("Enter"); await p.waitForTimeout(300);
    await expect(p, () => /Lantern/.test(document.querySelector(".bdSheet").innerText), "the hand-added prop");
    await expect(p, () => { const b = __CampHub.project().breakdown; const sid = b && Object.keys(b)[0]; return !!sid && JSON.stringify(b[sid].tags || {}).indexOf("props|lantern") >= 0; }, "the tag shared to the team's copy");
    await p.click('table.ct tr:has-text("Lantern") [data-a=rm]'); await p.waitForTimeout(300);
    await expect(p, () => !/Lantern/.test(document.querySelector(".bdSheet").innerText), "the prop taken out again");
    await expect(p, () => { const b = __CampHub.project().breakdown, r = b[Object.keys(b)[0]]; return JSON.stringify(r.tags || {}).indexOf("lantern") < 0; }, "the removal shared too");
    // a teammate's change arrives through the project and shows up
    await p.evaluate(() => { const b = __CampHub.project().breakdown, sid = Object.keys(b)[0]; const st = CampElements.fromRemote(b[sid]); const k = doc.lines.find((l) => l.type === "scene").id; b[sid] = CampElements.toRemote(CampElements.tag(st, k, "animals", "Goose")); CampBdPanel.render("p1"); });
    await p.waitForTimeout(300);
    await expect(p, () => /Goose/.test(document.querySelector(".bdSheet").innerText), "a teammate's tag");
    // the database refuses: the change stays on this device and says so
    await p.evaluate(() => { window.__denyBd = true; }); await p.selectOption("#bdQCat", "props"); await p.fill("#bdQuick", "kite"); await p.keyboard.press("Enter"); await p.waitForTimeout(400);
    await expect(p, () => /Kite/.test(document.querySelector(".bdSheet").innerText) && /Not shared/.test(document.querySelector(".bdTop").innerText), "kept on this device, marked not shared");
    await p.click('[data-a=view][data-v=elements]'); await p.waitForTimeout(300);
    await expect(p, () => !!document.querySelector("table.bdT tbody tr"), "the elements table");
    await p.click('[data-a=view][data-v=reports]'); await p.waitForTimeout(300);
    await expect(p, () => document.querySelectorAll(".rp").length > 0, "category reports");
    await expect(p, () => !document.querySelector('[data-a=view][data-v=strips]'), "no Stripboard button in Breakdown (it lives under Schedule)");
    await p.evaluate(() => { CampBdPanel.setMode(true, "strips"); CampBdPanel.render("p1"); }); await p.waitForTimeout(500);
    await expect(p, () => document.querySelectorAll(".stp").length >= 3 && !!document.querySelector(".stpDay"), "the stripboard with day banners");
  });
  await browser.close(); srv.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  if(failed) process.exit(1);
})().catch((e) => { console.error(e); process.exit(1); });
