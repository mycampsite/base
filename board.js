/* board.js — the logic behind the hub's Board tab (casting and location options as photo cards).
   Pure functions, no DOM: the same code runs in the browser (window.CampBoard) and in the tests (node).

   The data is whatever the script's Production Docs Sheet holds (read by Code.gs "boarddata"):
     { cast:[{ name, type, candidates:[{ key, n, row, actor, photo, phone, email, status, notes }] }],
       locations:[{ name, type, candidates:[{ key, n, row, address, photo, phone, email, status, notes }] }],
       statuses:{ cast:[...], loc:[...] } }
   A candidate also carries what the Board keeps in the Sheet's "Board Details" tab: showreel, audition, photos[], fav, order;
   a group carries its brief.
   Nothing is stored here: the Sheet is the one source of truth. */
(function (root) {
"use strict";

// The status that settles a role / location, and the order statuses are listed in
const DONE = { cast: "Cast", loc: "Confirmed" };
const PASSED = "Passed";
const KINDS = { cast: { list: "cast", field: "actor", noun: "role", nouns: "roles", done: "cast" }, loc: { list: "locations", field: "address", noun: "location", nouns: "locations", done: "confirmed" } };

const clean = (s) => String(s == null ? "" : s).replace(/[​﻿ ]/g, " ").replace(/\s+/g, " ").trim();

// ---------- links (every link that reaches the page goes through safeUrl) ----------
// Only web links are ever used as a link target: "javascript:", "data:", "mailto:" and the like come back empty.
function safeUrl(u){
  u = clean(u); if(!u || /\s/.test(u)) return "";
  if(!/^https?:\/\//i.test(u)){
    if(/^[a-z][a-z0-9+.-]*:(?!\d)/i.test(u)) return "";                  // some other scheme
    if(!/^(www\.)?[a-z0-9-]+(\.[a-z0-9-]+)+(:\d+)?([/?#].*)?$/i.test(u)) return "";
    u = "https://" + u;                                                   // "imdb.com/name/nm1" pasted without https
  }
  try{ const x = new URL(u); return (x.protocol === "https:" || x.protocol === "http:") && /\.[a-z]{2,}$/i.test(x.hostname) ? x.href : ""; }catch(_e){ return ""; }
}
function hostOf(u){ try{ return new URL(u).hostname.replace(/^www\./, "").toLowerCase(); }catch(_e){ return ""; } }
function driveId(u){
  const m = /drive\.google\.com\/(?:file\/d\/|open\?(?:[^#]*&)?id=|uc\?(?:[^#]*&)?id=|thumbnail\?(?:[^#]*&)?id=)([A-Za-z0-9_-]{10,})/i.exec(u)
    || /drive\.google\.com\/file\/u\/\d+\/d\/([A-Za-z0-9_-]{10,})/i.exec(u);
  return m ? m[1] : "";
}
const IMG_EXT = /\.(jpe?g|png|webp|gif|avif)$/i;
// A link the page can show as a picture, or "" when it can't (a Google Photos page, a folder, a website).
// Drive files show through Drive's thumbnail address; the file needs "anyone with the link" to display.
function photoSrc(u){
  u = safeUrl(u); if(!u) return "";
  const id = driveId(u); if(id) return "https://drive.google.com/thumbnail?id=" + id + "&sz=w900";
  const x = new URL(u), h = x.hostname.replace(/^www\./, "").toLowerCase();
  if(/(^|\.)googleusercontent\.com$/.test(h)) return u;
  if(!IMG_EXT.test(x.pathname)) return "";
  if(h === "dropbox.com"){ x.searchParams.delete("dl"); x.searchParams.set("raw", "1"); return x.href; }
  return u;
}
function mapUrl(address){ address = clean(address); return address ? "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(address) : ""; }
function telUrl(phone){ phone = clean(phone); const d = phone.replace(/[^\d+]/g, ""); return d.replace(/\D/g, "").length >= 6 ? "tel:" + d : ""; }
function mailUrl(email){ email = clean(email); return /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]{2,}$/.test(email) ? "mailto:" + email : ""; }

// Links typed into the notes become buttons ("Showreel https://youtu.be/…"); the rest stays as text.
// A word just before the link ("Showreel", "IMDb", "Audition") names the button; otherwise the site does.
const WORDS = { showreel: "Showreel", reel: "Showreel", audition: "Audition", tape: "Audition", "self-tape": "Audition", selftape: "Audition", imdb: "IMDb", website: "Website", portfolio: "Portfolio",
  spotlight: "Spotlight", listing: "Listing", map: "Map", photo: "Photo", photos: "Photos", instagram: "Instagram", insta: "Instagram", drive: "Drive", youtube: "YouTube", vimeo: "Vimeo" };
const URL_RE = new RegExp("(?:\\b(showreel|reel|audition|self[- ]?tape|tape|imdb|website|portfolio|spotlight|listing|map|photos?|instagram|insta|drive|youtube|vimeo)\\b[\\s:\u2013\u2014-]*)?((?:https?:\\/\\/|www\\.|(?:imdb\\.com|youtu\\.be|youtube\\.com|vimeo\\.com|instagram\\.com)\\/)[^\\s<>\"')\\]]+)", "gi");
function siteLabel(u){
  const h = hostOf(u);
  if(/(^|\.)(youtube\.com|youtu\.be)$/.test(h)) return "YouTube";
  if(/(^|\.)vimeo\.com$/.test(h)) return "Vimeo";
  if(/(^|\.)imdb\.com$/.test(h)) return "IMDb";
  if(/(^|\.)instagram\.com$/.test(h)) return "Instagram";
  if(/(^|\.)(drive\.google\.com|docs\.google\.com)$/.test(h)) return "Drive";
  if(/(^|\.)(photos\.app\.goo\.gl|photos\.google\.com)$/.test(h)) return "Photos";
  if(/(^|\.)(maps\.app\.goo\.gl|google\.[a-z.]+)$/.test(h) && /maps/.test(u)) return "Map";
  const venue = /(?:^|\.)(airbnb|peerspace|giggster)\./.exec(h);
  if(venue) return venue[1].replace(/^./, (c) => c.toUpperCase());
  return h || "Link";
}
function notesParts(notes){
  const links = [], seen = {};
  const text = String(notes == null ? "" : notes).replace(URL_RE, (m, word, rawUrl) => {
    const raw = rawUrl.replace(/[.,;:!?]+$/, ""), url = safeUrl(raw);   // a comma or full stop after the link isn't part of it
    if(!url) return m;
    if(!seen[url]){ seen[url] = 1; links.push({ url, label: (word && WORDS[word.toLowerCase().replace(/[\s]+/g, "-")]) || siteLabel(url) }); }
    return " ";
  });
  return { text: clean(text).replace(/(?:\s*[,;])+(?=\s*(?:[,;.]|$))/g, "").replace(/\s+([.,;])/g, "$1").replace(/^[\s\-\u2013\u2014\u00b7:,;]+|[\s\-\u2013\u2014\u00b7:,;]+$/g, ""), links };
}

// ---------- turning the Sheet's rows into cards ----------
function isFilled(kind, c){ return !!(c && [c[KINDS[kind].field], c.photo, c.phone, c.email, c.status, c.notes].some((v) => clean(v))); }
function statusList(data, kind){
  const s = data && data.statuses && data.statuses[kind]; if(Array.isArray(s) && s.length) return s.map(String);
  return kind === "cast" ? ["Considering", "Callback", "Offered", "Cast", "Passed"] : ["Considering", "Scouted", "Confirmed", "Passed"];
}
// Favourite cards from every visible group, in group order (they also stay in their own group)
function favoritesOf(groups){ const out = []; groups.forEach((g) => g.cards.forEach((c) => { if(c.fav) out.push(c); })); return out; }
// The keys of a group's cards after moving one: to a position before another card, or one step earlier / later
function reorder(keys, key, to){
  const a = keys.slice(), i = a.indexOf(key); if(i < 0) return a;
  let j;
  if(to === -1 || to === 1) j = i + to;
  else{ j = a.indexOf(to); if(j < 0) return a; if(j > i) j--; }
  if(j < 0 || j >= a.length || j === i) return a;
  a.splice(i, 1); a.splice(j, 0, key); return a;
}
function withOrder(data, kind, keys){
  const list = KINDS[kind].list, out = Object.assign({}, data);
  out[list] = ((data && data[list]) || []).map((g) => Object.assign({}, g, { candidates: (g.candidates || []).map((c) => { const i = keys.indexOf(c.key); return i < 0 ? c : Object.assign({}, c, { order: i + 1 }); }) }));
  return out;
}
function withBrief(data, kind, group, text){
  const list = KINDS[kind].list, out = Object.assign({}, data);
  out[list] = ((data && data[list]) || []).map((g) => g.name === group ? Object.assign({}, g, { brief: text }) : g);
  return out;
}

// ---------- editing (the Board writes back to the Sheet through Code.gs "boardsave") ----------
// Casting also has a showreel and an audition tape; a location has neither (just its map link and notes)
function fieldsOf(kind){ return [KINDS[kind].field, "photo", "phone", "email", "status", "notes"].concat(kind === "cast" ? ["showreel", "audition"] : []); }
const LINK_FIELDS = ["photo", "showreel", "audition"];
// The Sheet's own text for each field (notes keep their line breaks), used as the starting point of an edit
function rawOf(kind, c){ const o = {}; fieldsOf(kind).forEach((f) => { o[f] = String(c && c[f] != null ? c[f] : "").trim(); }); return o; }
// A web link is tidied ("imdb.com/x" becomes https://imdb.com/x); anything else is returned untouched
function tidyValues(kind, vals){
  const o = {}; fieldsOf(kind).forEach((f) => { if(vals && f in vals) o[f] = String(vals[f] == null ? "" : vals[f]).trim(); });
  LINK_FIELDS.forEach((f) => { if(o[f]){ const u = safeUrl(o[f]); if(u) o[f] = u; } });
  return o;
}
// "" when fine, else what to tell the person
function checkEdit(kind, vals, statuses, needSomething){
  const v = tidyValues(kind, vals);
  if(v.status && statuses.indexOf(v.status) < 0) return "“" + v.status + "” isn't a status the Sheet knows.";
  if(v.photo && !safeUrl(v.photo)) return "The photo needs to be a web link, like https://… or a Drive share link.";
  if(v.showreel && !safeUrl(v.showreel)) return "The showreel needs to be a web link.";
  if(v.audition && !safeUrl(v.audition)) return "The audition tape needs to be a web link.";
  if(v.email && !mailUrl(v.email)) return "That email address doesn't look right.";
  if(needSomething && !fieldsOf(kind).some((f) => v[f])) return "Type something first.";
  return "";
}
// Only the fields that differ from what the Board last showed
function changes(kind, base, vals){
  const v = tidyValues(kind, vals), b = rawOf(kind, base), out = {};
  Object.keys(v).forEach((f) => { if(v[f] !== b[f]) out[f] = v[f]; });
  return out;
}
const keyRe = /^(cast|loc):(.+):(\d+)$/;
function keyParts(key){ const m = keyRe.exec(String(key || "")); return m ? { kind: m[1], group: m[2], n: Number(m[3]) } : null; }
// A copy of the data with one saved option put in place (replaced by key, or added to its role / location)
function withCandidate(data, kind, cand){
  const list = KINDS[kind].list, kp = keyParts(cand.key), out = Object.assign({}, data);
  out[list] = ((data && data[list]) || []).map((g) => {
    const has = (g.candidates || []).some((c) => c.key === cand.key);
    if(has) return Object.assign({}, g, { candidates: g.candidates.map((c) => c.key === cand.key ? Object.assign({}, c, cand) : c) });
    if(kp && g.name === kp.group) return Object.assign({}, g, { candidates: (g.candidates || []).concat([cand]) });
    return g;
  });
  return out;
}
// A copy with one option emptied (its slot stays) or gone altogether
function withoutCandidate(data, kind, key, removed){
  const list = KINDS[kind].list, f = fieldsOf(kind), out = Object.assign({}, data);
  out[list] = ((data && data[list]) || []).map((g) => Object.assign({}, g, { candidates: (g.candidates || []).reduce((a, c) => {
    if(c.key !== key){ a.push(c); return a; }
    if(!removed){ const e = Object.assign({}, c); f.forEach((k) => { e[k] = ""; }); e.photos = []; e.fav = false; e.order = 0; a.push(e); }
    return a;
  }, []) }));
  return out;
}

// One card from one filled candidate row
function cardOf(kind, group, c, fileId){
  const f = KINDS[kind].field, main = clean(c[f]), np = notesParts(c.notes);
  const title = main || (kind === "cast" ? "Unnamed" : "No address yet");
  // On the card: the map (a place), the showreel and audition tape (an actor), then any link typed in the notes.
  // Phone and email are only in the detail view (contact).
  const links = [], contact = [];
  if(kind === "loc" && mapUrl(main)) links.push({ kind: "map", label: "Map", url: mapUrl(main) });
  const sr = safeUrl(c.showreel), au = safeUrl(c.audition);
  if(sr) links.push({ kind: "web", label: "Showreel", url: sr });
  if(au) links.push({ kind: "web", label: "Audition", url: au });
  np.links.forEach((l) => { if(l.url !== sr && l.url !== au) links.push({ kind: "web", label: l.label, url: l.url }); });
  const ph = telUrl(c.phone), em = mailUrl(c.email);
  if(ph) contact.push({ kind: "tel", label: "Call", url: ph });
  if(em) contact.push({ kind: "mail", label: "Email", url: em });
  const photoLink = safeUrl(c.photo);
  const photos = [c.photo].concat(Array.isArray(c.photos) ? c.photos : []).map(safeUrl).filter((u, i, a) => u && a.indexOf(u) === i);
  return { id: (fileId || "") + "|" + c.key, key: c.key, row: c.row, n: c.n, kind, group: group.name, groupType: clean(group.type), title, main,
    status: clean(c.status), phone: clean(c.phone), email: clean(c.email), notes: np.text, photo: photoSrc(c.photo), photoLink, photos, links, contact, raw: rawOf(kind, c),
    fav: !!c.fav, order: Number(c.order) || 0, passed: clean(c.status) === PASSED, done: clean(c.status) === DONE[kind] };
}
// All cards for one tab, grouped by role / location in the Sheet's order. Passed options sink to the end of their group.
function groupsOf(data, kind, fileId){
  const list = (data && data[KINDS[kind].list]) || [];
  return list.map((g) => {
    const cards = (g.candidates || []).filter((c) => isFilled(kind, c)).map((c) => cardOf(kind, g, c, fileId));
    // the order the director set (then the Sheet's order); passed options sink to the end
    const byOrder = (a, b) => (a.order && b.order ? a.order - b.order : a.order ? -1 : b.order ? 1 : 0) || a.n - b.n;
    cards.sort(byOrder);
    const keep = cards.filter((c) => !c.passed).concat(cards.filter((c) => c.passed));
    return { name: g.name, type: clean(g.type), brief: String(g.brief || "").trim(), cards: keep, slots: (g.candidates || []).length, settled: keep.some((c) => c.done) };
  });
}
// The visible groups for a status chip ("All" | a status | "Unfilled") and a search
function filterGroups(groups, status, q){
  q = clean(q).toLowerCase();
  const hit = (c) => !q || [c.title, c.group, c.status, c.notes, c.phone, c.email].some((v) => String(v || "").toLowerCase().indexOf(q) >= 0);
  const out = [];
  groups.forEach((g) => {
    if(status === "Unfilled"){ if(!g.cards.length && (!q || g.name.toLowerCase().indexOf(q) >= 0)) out.push(Object.assign({}, g)); return; }
    const nameHit = q && g.name.toLowerCase().indexOf(q) >= 0;
    const cards = g.cards.filter((c) => (status === "All" || !status || c.status === status) && (nameHit || hit(c)));
    if(cards.length) out.push(Object.assign({}, g, { cards }));
    else if(status === "All" && !q) out.push(Object.assign({}, g, { cards }));   // an unfilled role still shows, so nothing looks missing
  });
  return out;
}
// Numbers for the chips and the progress line
function counts(groups, statuses){
  const by = {}; statuses.forEach((s) => { by[s] = 0; }); by.none = 0;
  let all = 0;
  groups.forEach((g) => g.cards.forEach((c) => { all++; if(c.status && by[c.status] != null) by[c.status]++; else if(c.status) by[c.status] = 1; else by.none++; }));
  return { all, by, groups: groups.length, unfilled: groups.filter((g) => !g.cards.length).length, settled: groups.filter((g) => g.settled).length };
}
function progressText(kind, c){
  if(!c.groups) return "";
  const k = KINDS[kind];
  return c.settled + " of " + c.groups + " " + (c.groups === 1 ? k.noun : k.nouns) + " " + k.done + (c.unfilled ? " · " + c.unfilled + " with no options yet" : "");
}
// The card before / after this one in the visible order (for the detail view's arrow keys)
function neighbour(groups, id, dir){
  const flat = []; groups.forEach((g) => g.cards.forEach((c) => flat.push(c.id)));
  const i = flat.indexOf(id); if(i < 0) return "";
  return flat[i + dir] || "";
}

const api = { DONE, KINDS, clean, safeUrl, hostOf, driveId, photoSrc, mapUrl, telUrl, mailUrl, siteLabel, notesParts, isFilled, statusList, cardOf, groupsOf, filterGroups, counts, progressText, neighbour, fieldsOf, rawOf, tidyValues, checkEdit, changes, keyParts, withCandidate, withoutCandidate, favoritesOf, reorder, withOrder, withBrief };
if(typeof module !== "undefined" && module.exports) module.exports = api; else root.CampBoard = Object.assign(root.CampBoard || {}, { logic: api });
})(typeof window !== "undefined" ? window : this);
