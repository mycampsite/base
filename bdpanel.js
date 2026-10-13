/* bdpanel.js — the Breakdown tab in the hub's Production section.
   Scene-by-scene breakdown sheets (the elements each scene needs, by industry category), an Elements manager
   (rename, merge, recategorise, ignore, notes) and per-category reports with a CSV export.
   It reads the script with breakdown.js, builds elements with elements.js, and shows them.
   Needs: breakdown.js, production.js, elements.js and window.__CampHub (set up by index.html).
   Edits are shared with the team at projects/<pid>/breakdown/<scriptId> (Firebase), one small entry at a time,
   and this device keeps a copy so the editor can colour tags (see `local` and `sync` below). */
(function(){
"use strict";
const B = window.CampBreakdown, P = window.CampProduction, E = window.CampElements;
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;" }[c]));
const lsGet = (k) => { try{ return localStorage.getItem(k); }catch(_e){ return null; } };
const lsSet = (k, v) => { try{ localStorage.setItem(k, v); }catch(_e){} };
const H = () => window.__CampHub;
const VIEW_KEY = "Camp_BD_VIEW_V1", NOTE_KEY = "Camp_BD_NOTE_V1";

/* ---------- where edits live ----------
   The team's copy: projects/<pid>/breakdown/<scriptId> in Firebase. The hub already listens to the whole
   project, so it arrives live as project.breakdown. This device keeps:
     Camp_BD_V1_<sid>          a copy of the store (the editor reads it to colour tags)
     Camp_BD_PENDING_V1_<sid>  tags made in the editor, waiting for the hub to upload them
     Camp_BD_UNSYNCED_V1_<sid> "1" when this device has edits the team doesn't (made offline, before sync
                               existed, or while the database refused them); they're merged in, never dropped */
const local = {
  key: (sid) => "Camp_BD_V1_" + sid,
  load(pid, sid){
    try{
      let raw = lsGet(this.key(sid));
      if(raw == null){ raw = lsGet("Camp_BD_V1_" + pid + "_" + sid); if(raw != null){ lsSet(this.key(sid), raw); this.dirty(sid, true); } }   // device-only edits from before
      const v = JSON.parse(raw || "{}"); return v && typeof v === "object" ? v : {};
    }catch(_e){ return {}; }
  },
  save(sid, st){ lsSet(this.key(sid), JSON.stringify(st || {})); },
  pending(sid){ try{ const v = JSON.parse(lsGet("Camp_BD_PENDING_V1_" + sid) || "[]"); return Array.isArray(v) ? v : []; }catch(_e){ return []; } },
  clearPending(sid, n){ const rest = this.pending(sid).slice(n); if(rest.length) lsSet("Camp_BD_PENDING_V1_" + sid, JSON.stringify(rest)); else { try{ localStorage.removeItem("Camp_BD_PENDING_V1_" + sid); }catch(_e){} } },
  // never synced from this device and there's something here: treat it as unshared
  isDirty(sid){ const d = lsGet("Camp_BD_UNSYNCED_V1_" + sid); if(d != null) return d === "1"; const raw = lsGet(this.key(sid)); return !!(raw && raw !== "{}"); },
  dirty(sid, on){ lsSet("Camp_BD_UNSYNCED_V1_" + sid, on ? "1" : "0"); }
};

const S = {
  on: false, pid: null,
  view: lsGet(VIEW_KEY) || "sheets",   // sheets | elements | reports
  scripts: {},                          // scriptId -> { state, doc, bd, err, modified }
  stores: {},                           // pid|scriptId -> store
  model: null, modelKey: "",
  sel: 1,                               // scene number open on the Sheets view
  cat: "all", q: "", rpBy: "cat",                    // Elements view filter
  scQ: "", scF: "all",                  // Sheets view: scene search and I/E · D/N filter
  qCat: lsGet("Camp_BD_QCAT_V1") || "props",   // category the quick-add box last used
  showEmpty: lsGet("Camp_BD_EMPTY_V1") === "1",  // Sheets view: show every category, even with nothing in it
  showText: lsGet("Camp_BD_TEXT_V1") !== "0",    // Sheets view: the scene's script text above the categories
  qQuote: "",                           // words picked in the scene text, kept with the next quick-add as the tag's quote
  adding: null,                         // { sk, cat } adding an element by hand
  edit: null,                           // element key being edited
  share: {},                            // pid|scriptId -> "ok" | "denied" | "error" | "off" (no database)
  seen: {},                             // pid|scriptId -> the team copy last taken in (JSON)
  inflight: {},                         // pid|scriptId -> changes sent and not yet confirmed
  scriptPick: {},                       // pid -> script chosen here (this device only; the shared plan isn't touched)
  hist: {}                              // pid|scriptId -> { undo:[json], redo:[json] }
};

const css = `
#bdctl{ display:none; flex-direction:column; flex:1; min-height:0; background:#171717; }
#bdctl.on{ display:flex; }
#bdctl .bdTop{ display:flex; align-items:center; gap:10px; flex-wrap:wrap; padding:8px 12px; min-height:48px; border-bottom:1px solid var(--uiBorder); }
#bdctl .bdTitle{ font-weight:700; font-size:14px; padding:0 4px; }
#bdctl .bdChips{ display:flex; gap:6px; flex-wrap:wrap; flex:1; min-width:0; }
#bdctl .bdChip{ font-size:11.5px; color:var(--uiMuted); border:1px solid var(--uiBorder); border-radius:999px; padding:2px 9px; white-space:nowrap; }
#bdctl .bdChip.warn{ color:#f1c76b; border-color:rgba(241,199,107,.4); }
#bdctl .bdActs{ margin-left:auto; display:flex; gap:8px; align-items:center; flex-wrap:wrap; }
#bdctl .seg{ display:inline-flex; gap:2px; padding:3px; border-radius:10px; background:rgba(255,255,255,.06); border:1px solid rgba(255,255,255,.1); }
#bdctl .seg button{ border:0; background:transparent; padding:5px 12px; height:auto; border-radius:7px; font-size:12.5px; font-weight:600; cursor:pointer; color:rgba(255,255,255,.6); white-space:nowrap; }
#bdctl .seg button.on{ background:rgba(255,255,255,.14); color:#fff; }
#bdctl .bdBody{ flex:1; min-height:0; overflow:auto; padding:0 12px 24px; overscroll-behavior:contain; }
#bdctl .bdLoad{ flex:1; min-height:min(60vh,520px); display:flex; flex-direction:column; align-items:center; justify-content:center; gap:10px; text-align:center; color:var(--uiMuted); font-size:12.5px; }
#bdctl .bdLoad b{ color:var(--uiText); font-size:14px; font-weight:600; }
#bdctl .bdEmpty{ padding:22px 6px; color:var(--uiMuted); font-size:13px; line-height:1.55; }
#bdctl .bdNote{ margin:10px 0 0; padding:8px 12px; border-radius:10px; background:rgba(241,199,107,.08); border:1px solid rgba(241,199,107,.3); font-size:12px; color:#e6d3a0; line-height:1.5; }
/* sheets view */
#bdctl .bdBody.split{ overflow:hidden; display:flex; flex-direction:column; }
#bdctl .bdSplit{ display:grid; grid-template-columns:280px minmax(0,1fr); grid-template-rows:minmax(0,1fr); gap:14px; padding-top:12px; flex:1; min-height:0; }
#bdctl .bdListWrap{ display:flex; flex-direction:column; min-height:0; gap:8px; }
#bdctl .bdSplit > *, #bdctl .shGrid > *{ min-width:0; }
#bdctl input, #bdctl select, #bdctl textarea{ box-sizing:border-box; max-width:100%; }
#bdctl .bdFind{ display:flex; flex-wrap:wrap; gap:6px; align-items:center; }
#bdctl .bdFind input{ flex:1 1 100%; }
#bdctl .bdFind .cnt{ margin-left:auto; font-size:11px; color:var(--uiMuted); }
#bdctl .seg.sm button{ padding:3px 8px; font-size:11.5px; }
#bdctl .bdList{ display:flex; flex-direction:column; gap:2px; flex:1; min-height:0; overflow:auto; padding:0 4px 14px 0; overscroll-behavior:contain; }
#bdctl .bdSc{ display:grid; grid-template-columns:34px minmax(0,1fr) auto; gap:8px; align-items:center; text-align:left; width:100%; border:0; border-left:5px solid var(--sc,#ddd); border-radius:4px; padding:6px 8px 6px 6px; background:color-mix(in srgb, var(--sc,#ddd) 9%, #1b1b1b); cursor:pointer; font:inherit; font-size:12px; color:inherit; }
#bdctl .bdSc:hover{ background:color-mix(in srgb, var(--sc,#ddd) 17%, #1d1d1d); }
#bdctl .bdSc.on{ background:color-mix(in srgb, var(--sc,#ddd) 24%, #262626); box-shadow:inset 0 0 0 1px rgba(255,255,255,.4); }
#bdctl .bdSc .no{ font-weight:800; font-size:14px; text-align:center; font-variant-numeric:tabular-nums; }
#bdctl .bdSc .mid{ min-width:0; display:flex; flex-direction:column; gap:1px; }
#bdctl .bdSc .l{ font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
#bdctl .bdSc .m{ color:var(--uiMuted); font-size:11px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
#bdctl .bdSc .cn{ color:#ddd; }
#bdctl .bdSc .pg{ color:var(--uiMuted); font-size:11px; white-space:nowrap; align-self:start; padding-top:1px; }
#bdctl .bdSc .dots{ display:flex; gap:2px; margin-top:3px; flex-wrap:wrap; }
#bdctl .bdSc .dots i{ width:6px; height:6px; border-radius:50%; display:block; }
#bdctl .bdSheet{ overflow:auto; min-height:0; overscroll-behavior:contain; border:1px solid var(--uiBorder); border-radius:12px; background:#1b1b1b; min-width:0; }
#bdctl .shBar{ position:sticky; top:0; z-index:3; display:flex; align-items:center; gap:6px; flex-wrap:wrap; padding:8px 12px; background:#1b1b1b; border-bottom:1px solid var(--uiBorder); border-radius:12px 12px 0 0; }
#bdctl .shBar .jump{ min-width:0; max-width:340px; flex:0 1 340px; }
#bdctl .shBar .pos{ font-size:11.5px; color:var(--uiMuted); padding:0 6px; font-variant-numeric:tabular-nums; }
#bdctl .shBar .sp{ flex:1; }
#bdctl .tgl{ display:inline-flex; align-items:center; gap:6px; font-size:12px; color:var(--uiMuted); cursor:pointer; white-space:nowrap; }
#bdctl .tgl input{ accent-color:#7fb6ff; width:14px; height:14px; }
#bdctl .shHead{ display:flex; align-items:baseline; gap:12px; padding:12px 14px 4px; }
#bdctl .shHead h3{ margin:0; font-size:15px; letter-spacing:.04em; font-family:ui-monospace,"Courier Prime","Courier New",monospace; font-weight:700; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; flex:1; min-width:0; }
#bdctl .shHead .pr{ font-size:11.5px; color:var(--uiMuted); white-space:nowrap; }
#bdctl .shFields{ display:grid; grid-template-columns:86px 92px minmax(150px,2fr) 100px 92px minmax(90px,1fr) minmax(90px,1fr) 80px; margin:8px 14px 0; border:1px solid var(--uiBorder); border-left:5px solid var(--sc,#ddd); border-radius:10px; overflow:hidden; background:#181818; }
#bdctl .shFields .f{ padding:8px 10px; border-left:1px solid var(--uiBorder); display:flex; flex-direction:column; gap:6px; min-width:0; justify-content:space-between; }
#bdctl .shFields .f:first-child{ border-left:0; background:color-mix(in srgb, var(--sc,#ddd) 14%, #181818); }
#bdctl .shFields .lb{ font-size:10px; text-transform:uppercase; letter-spacing:.06em; color:var(--uiMuted); white-space:nowrap; }
#bdctl .shFields b{ font-size:14px; font-weight:700; }
#bdctl .shFields .ell{ overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
#bdctl .shFields .big{ font-size:26px; font-weight:800; line-height:1; font-variant-numeric:tabular-nums; }
#bdctl .shFields input, #bdctl .shFields select{ width:100%; height:28px; }
#bdctl .shGrid{ display:grid; grid-template-columns:minmax(0,1fr) 300px; align-items:start; }
#bdctl .shMain{ min-width:0; padding:12px 14px 16px; }
#bdctl .shSide{ border-left:1px solid var(--uiBorder); padding:12px 14px 16px; display:flex; flex-direction:column; gap:12px; position:sticky; top:46px; margin-top:12px; }
#bdctl .fld{ margin-top:0; }
#bdctl .fld span{ display:inline; font-size:inherit; color:inherit; margin:0; }
#bdctl .fld label, #bdctl .shMeta label{ display:flex; flex-direction:column; gap:4px; font-size:10.5px; text-transform:uppercase; letter-spacing:.05em; color:var(--uiMuted); }
#bdctl .fld label{ display:block; margin-bottom:4px; }
#bdctl .fld .hint{ text-transform:none; letter-spacing:0; opacity:.7; margin-left:4px; }
#bdctl .shMeta{ display:grid; grid-template-columns:1fr 1fr; gap:10px; }
#bdctl .shMeta label:last-child{ grid-column:1 / -1; }
#bdctl .shMeta input, #bdctl .shMeta select{ width:100%; }
#bdctl input[type=text], #bdctl input[type=number], #bdctl select, #bdctl textarea{ border-radius:8px; border:1px solid var(--uiBorder); background:#111; color:inherit; font:inherit; font-size:13px; padding:0 8px; height:30px; text-transform:none; letter-spacing:0; }
#bdctl textarea{ height:auto; padding:7px 9px; width:100%; resize:vertical; line-height:1.45; }
#bdctl .qAdd{ display:flex; gap:6px; margin-bottom:12px; }
#bdctl .qAdd select{ flex:0 0 auto; max-width:170px; border-left:4px solid var(--cc,#888); }
#bdctl .qAdd input{ flex:1; min-width:0; }
#bdctl .shText{ border:1px solid var(--uiBorder); border-radius:10px; background:#141414; margin-bottom:12px; overflow:hidden; }
#bdctl .stHd{ display:flex; align-items:baseline; gap:10px; padding:7px 12px; border-bottom:1px solid var(--uiBorder); font-size:10.5px; text-transform:uppercase; letter-spacing:.06em; color:var(--uiMuted); }
#bdctl .stHd small{ text-transform:none; letter-spacing:0; font-size:11px; opacity:.75; margin-left:auto; }
#bdctl .stBody{ max-height:300px; overflow:auto; padding:12px 16px 14px; font-family:"Courier Prime","Courier New",ui-monospace,monospace; font-size:13px; line-height:1.5; color:#e8e8e8; overscroll-behavior:contain; }
#bdctl .stBody .sl{ max-width:62ch; margin:0 0 .6em; white-space:pre-wrap; }
#bdctl .stBody .t-scene{ font-weight:700; text-transform:uppercase; }
#bdctl .stBody .t-character{ margin:0 0 0 22ch; text-transform:uppercase; }
#bdctl .stBody .t-parenthetical{ margin:0 0 0 16ch; max-width:30ch; }
#bdctl .stBody .t-dialogue{ margin:0 0 .6em 10ch; max-width:36ch; }
#bdctl .stBody .t-transition{ text-align:right; text-transform:uppercase; }
#bdctl .stBody .dualRow{ display:grid; grid-template-columns:1fr 1fr; gap:16px; max-width:none; }
#bdctl .stBody .dualRow .t-character{ margin-left:6ch; } #bdctl .stBody .dualRow .t-dialogue{ margin-left:0; }
#bdctl .stBody mark{ background:color-mix(in srgb, var(--cc) 30%, transparent); color:inherit; border-radius:3px; padding:0 1px; box-shadow:inset 0 -2px 0 var(--cc); }
#bdctl .stBody ::selection{ background:rgba(127,182,255,.45); }
#bdctl .shCats{ display:grid; grid-template-columns:repeat(auto-fill,minmax(380px,1fr)); gap:12px; align-items:start; }
#bdctl .cat{ border:1px solid color-mix(in srgb, var(--cc) 40%, #262626); border-radius:10px; background:#181818; overflow:hidden; }
#bdctl .cat.isEmpty{ opacity:.7; }
#bdctl .cat > .ch{ display:flex; align-items:center; gap:8px; padding:7px 8px 7px 10px; background:color-mix(in srgb, var(--cc) 18%, #181818); border-bottom:1px solid color-mix(in srgb, var(--cc) 30%, #262626); }
#bdctl .cat > .ch .ci{ width:17px; height:17px; color:var(--cc); flex:none; filter:brightness(1.35); }
#bdctl .cat > .ch .nm{ font-size:13px; font-weight:700; }
#bdctl .cat > .ch .k{ font-size:11px; font-weight:700; min-width:20px; text-align:center; padding:1px 6px; border-radius:999px; background:rgba(255,255,255,.08); color:var(--uiMuted); }
#bdctl .cat > .ch .add{ margin-left:auto; border:1px solid rgba(255,255,255,.14); background:rgba(0,0,0,.2); color:inherit; cursor:pointer; font:inherit; font-size:11.5px; font-weight:600; border-radius:7px; padding:3px 9px; }
#bdctl .cat > .ch .add:hover{ border-color:rgba(255,255,255,.4); }
#bdctl table.ct{ width:100%; border-collapse:collapse; table-layout:fixed; font-size:12.5px; }
#bdctl table.ct th{ font-size:10px; text-transform:uppercase; letter-spacing:.05em; color:var(--uiMuted); font-weight:600; text-align:left; padding:5px 6px; border-bottom:1px solid var(--uiBorder); }
#bdctl table.ct td{ padding:5px 6px; border-top:1px solid rgba(255,255,255,.05); vertical-align:top; }
#bdctl table.ct tr:hover td{ background:rgba(255,255,255,.03); }
#bdctl table.ct .c-no{ width:34px; text-align:center; padding-left:8px; }
#bdctl table.ct .c-q{ width:38px; text-align:center; color:var(--uiMuted); font-variant-numeric:tabular-nums; }
#bdctl table.ct .c-nm{ width:34%; }
#bdctl table.ct th.c-nt{ overflow:visible; font-size:10px; color:var(--uiMuted); }
#bdctl table.ct .c-nm b{ font-weight:600; cursor:pointer; word-break:break-word; }
#bdctl table.ct .c-nm b:hover{ text-decoration:underline; text-underline-offset:2px; }
#bdctl table.ct .c-nt{ color:var(--uiMuted); font-size:12px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
#bdctl table.ct .c-nt .mu{ opacity:.45; }
#bdctl table.ct .c-sc{ width:30px; text-align:center; color:var(--uiMuted); font-size:11px; }
#bdctl table.ct .c-x{ width:28px; text-align:center; }
#bdctl table.ct .c-h{ width:26px; text-align:center; padding-left:0; padding-right:0; }
#bdctl .star{ border:0; background:none; cursor:pointer; font-size:14px; line-height:1; padding:0 3px; color:var(--uiMuted); opacity:.35; }
#bdctl tr:hover .star, #bdctl .star:focus-visible{ opacity:.9; }
#bdctl .star.on{ color:#f1c76b; opacity:1; }
#bdctl .star:disabled{ cursor:default; }
@media (hover:none){ #bdctl .star{ opacity:.8; } }
#bdctl table.ct .c-x button{ border:0; background:none; color:var(--uiMuted); cursor:pointer; font-size:12px; padding:0 4px; line-height:1; opacity:.6; }
#bdctl table.ct tr:hover .c-x button{ opacity:1; }
#bdctl table.ct .c-x button:hover{ color:#fff; }
#bdctl table.ct .dot{ margin:0; width:8px; height:8px; }
#bdctl table.ct .hero{ color:#f1c76b; font-size:11px; }
#bdctl .cat .none{ padding:12px 10px; text-align:center; font-size:12px; color:var(--uiMuted); }
#bdctl .addRow{ display:flex; gap:5px; padding:0 8px 8px; }
#bdctl .addRow input{ flex:1; min-width:0; }
@media (max-width:1380px){
  #bdctl .shFields{ grid-template-columns:repeat(auto-fit,minmax(110px,1fr)); }
  #bdctl .shFields .f{ border-top:1px solid var(--uiBorder); margin-top:-1px; }
  #bdctl .shFields .fw{ grid-column:span 2; }
}
@media (max-width:1180px){
  #bdctl .shGrid{ grid-template-columns:1fr; }
  #bdctl .shSide{ margin-top:0; }
  #bdctl .shSide{ border-left:0; border-top:1px solid var(--uiBorder); position:static; }
  #bdctl .shMeta{ grid-template-columns:repeat(3,1fr); }
  #bdctl .shMeta label:last-child{ grid-column:auto; }
}
/* elements view */
#bdctl .bdTools{ display:flex; gap:8px; flex-wrap:wrap; align-items:center; padding:12px 0 8px; }
#bdctl .catChips{ display:flex; gap:5px; flex-wrap:wrap; }
#bdctl .catChip{ border:1px solid color-mix(in srgb, var(--cc, #888) 55%, #222); background:color-mix(in srgb, var(--cc, #888) 10%, #1a1a1a); border-radius:999px; padding:2px 10px; font-size:11.5px; cursor:pointer; color:inherit; font-family:inherit; }
#bdctl .catChip.on{ background:var(--cc, #ececf0); color:#111; font-weight:700; }
#bdctl .catChip small{ opacity:.7; margin-left:3px; }
#bdctl table.bdT{ border-collapse:collapse; width:100%; font-size:12.5px; }
#bdctl table.bdT th{ text-align:left; font-size:10.5px; text-transform:uppercase; letter-spacing:.05em; color:var(--uiMuted); padding:6px 8px; border-bottom:1px solid var(--uiBorder); position:sticky; top:0; background:#171717; }
#bdctl table.bdT td{ padding:6px 8px; border-top:1px solid var(--uiBorder); vertical-align:top; }
#bdctl .dot{ display:inline-block; width:9px; height:9px; border-radius:50%; margin-right:7px; vertical-align:baseline; }
#bdctl .bdTools .cnt{ margin-left:auto; font-size:11.5px; color:var(--uiMuted); }
#bdctl table.bdT{ table-layout:fixed; }
#bdctl table.bdT th{ z-index:1; }
#bdctl table.bdT .num{ text-align:right; white-space:nowrap; font-variant-numeric:tabular-nums; }
#bdctl table.bdT tr.er:hover td{ background:rgba(255,255,255,.03); }
#bdctl table.bdT tr.er.on td{ background:color-mix(in srgb, var(--cc) 10%, transparent); }
#bdctl table.bdT td:first-child{ overflow:hidden; text-overflow:ellipsis; }
#bdctl table.bdT tr.grp td{ padding:14px 8px 5px; border-top:0; font-size:10.5px; font-weight:700; text-transform:uppercase; letter-spacing:.07em; color:var(--uiText); }
#bdctl table.bdT tr.grp i{ display:inline-block; width:9px; height:9px; border-radius:50%; background:var(--cc); margin-right:7px; }
#bdctl table.bdT tr.grp span{ color:var(--uiMuted); margin-left:7px; font-weight:600; }
#bdctl table.bdT tr.grp + tr td{ border-top-color:color-mix(in srgb, var(--cc) 45%, transparent); }
#bdctl .cpill{ display:inline-block; font-size:11px; padding:1px 8px; border-radius:999px; border:1px solid color-mix(in srgb, var(--cc) 50%, #222); background:color-mix(in srgb, var(--cc) 12%, #161616); white-space:nowrap; }
#bdctl .cno{ display:inline-block; min-width:18px; margin-right:6px; padding:0 4px; border-radius:4px; background:var(--cc, #e03131); color:#fff; font-size:11px; font-weight:700; text-align:center; }
#bdctl td.act{ text-align:right; }
#bdctl .edBtn{ border:1px solid var(--uiBorder); background:transparent; color:var(--uiMuted); border-radius:6px; padding:2px 9px; font:inherit; font-size:11.5px; cursor:pointer; opacity:.55; }
#bdctl tr.er:hover .edBtn, #bdctl .edBtn:focus-visible{ opacity:1; color:var(--uiText); border-color:rgba(255,255,255,.35); }
@media (hover:none){ #bdctl .edBtn{ opacity:1; } }
#bdctl .scBtns{ display:flex; flex-wrap:wrap; gap:3px; }
#bdctl .scBtn{ border:1px solid var(--uiBorder); background:rgba(255,255,255,.04); color:inherit; border-radius:6px; padding:0 6px; font-size:11.5px; cursor:pointer; font-family:inherit; }
#bdctl .scBtn:hover{ border-color:rgba(255,255,255,.4); }
#bdctl .edForm{ display:flex; flex-wrap:wrap; gap:8px; align-items:flex-end; padding:8px 10px; background:#202020; border-radius:9px; }
#bdctl .edForm label{ display:flex; flex-direction:column; gap:3px; font-size:10.5px; text-transform:uppercase; letter-spacing:.05em; color:var(--uiMuted); }
#bdctl .tag{ font-size:10px; color:var(--uiMuted); border:1px solid var(--uiBorder); border-radius:5px; padding:0 4px; margin-left:6px; }
#bdctl .nt{ color:var(--uiMuted); font-size:11.5px; display:block; margin-top:2px; white-space:pre-wrap; }
/* reports */
/* stripboard */
#bdctl .stpHead, #bdctl .stp{ display:grid; grid-template-columns:44px 58px minmax(140px,1fr) 78px 54px 50px minmax(70px,140px) 130px; gap:8px; align-items:center; }
#bdctl .stpHead{ font-size:10.5px; text-transform:uppercase; letter-spacing:.05em; color:var(--uiMuted); padding:12px 10px 6px 15px; }
#bdctl .stpWrap{ display:flex; flex-direction:column; gap:2px; }
#bdctl .stp{ text-align:left; width:100%; border:0; border-left:5px solid var(--sc,#ddd); border-radius:4px; padding:5px 10px; background:color-mix(in srgb, var(--sc,#ddd) 16%, #191919); color:inherit; font:inherit; font-size:12.5px; cursor:pointer; }
#bdctl .stp:hover{ background:color-mix(in srgb, var(--sc,#ddd) 26%, #191919); }
#bdctl .stp .n{ font-weight:700; }
#bdctl .stp .set{ overflow:hidden; white-space:nowrap; text-overflow:ellipsis; font-weight:600; }
#bdctl .stp .set small{ font-weight:400; color:var(--uiMuted); margin-left:8px; }
#bdctl .stp .cast{ color:#ddd; overflow:hidden; white-space:nowrap; text-overflow:ellipsis; }
#bdctl .stp .mk{ display:flex; gap:3px; flex-wrap:wrap; }
#bdctl .stp .mk i{ width:9px; height:9px; border-radius:2px; display:block; }
#bdctl .stpDay{ display:flex; gap:10px; align-items:center; background:#000; border:1px solid #333; border-radius:4px; padding:6px 12px; margin:2px 0 8px; font-size:12px; }
#bdctl .stpDay span{ margin-left:auto; color:var(--uiMuted); }
#bdctl .stpWrap.canDrag .stp[draggable]{ cursor:grab; }
#bdctl .stp.dragging{ opacity:.35; }
#bdctl .stp.dropBefore{ box-shadow:0 -3px 0 0 #7fb6ff; }
#bdctl .stpDay.dropEnd{ border-color:#7fb6ff; box-shadow:0 0 0 1px #7fb6ff; }
#bdctl .stpDay.un{ background:rgba(241,199,107,.08); border-color:rgba(241,199,107,.35); margin-top:10px; }
#bdctl .stpLegend{ display:flex; flex-wrap:wrap; gap:6px 14px; margin-top:12px; font-size:12px; color:var(--uiMuted); }
#bdctl .stpLegend b{ color:var(--uiText); margin-right:3px; }
@media (max-width:760px){
  #bdctl .stpHead{ display:none; }
  #bdctl .stp{ grid-template-columns:36px 1fr 46px; }
  #bdctl .stp .ie, #bdctl .stp .dn, #bdctl .stp .sd, #bdctl .stp .mk{ display:none; }
  #bdctl .stp .cast{ grid-column:2 / 4; font-size:11.5px; }
}
#bdctl .rpGrid{ columns:320px; column-gap:12px; padding-top:12px; }
#bdctl .rp{ break-inside:avoid; margin-bottom:12px; border:1px solid color-mix(in srgb, var(--cc) 50%, #222); border-radius:12px; overflow:hidden; background:#1b1b1b; }
#bdctl .rp tr:hover td{ background:rgba(255,255,255,.03); }
#bdctl .rp h4{ margin:0; padding:7px 12px; font-size:12.5px; background:color-mix(in srgb, var(--cc) 22%, #181818); display:flex; justify-content:space-between; }
#bdctl .rp table{ width:100%; border-collapse:collapse; font-size:12px; }
#bdctl .rp td{ padding:4px 12px; border-top:1px solid var(--uiBorder); vertical-align:top; }
#bdctl .rp td:first-child{ white-space:nowrap; }
#bdctl .rp td:last-child{ color:var(--uiMuted); text-align:right; white-space:nowrap; }
#bdctl .rp h4{ flex-wrap:wrap; gap:2px 10px; }
#bdctl .rpDay td:last-child{ white-space:normal; text-align:left; overflow-wrap:anywhere; color:inherit; }
#bdctl .rpDay td:first-child{ width:1%; }
@media (max-width:760px){
  #bdctl .bdBody{ padding:0 10px 90px; }
  #bdctl .bdSplit{ grid-template-columns:1fr; }
  #bdctl .bdList{ flex-direction:row; max-height:none; overflow-x:auto; position:static; padding-bottom:6px; }
  #bdctl .bdSc{ flex:0 0 170px; }
  #bdctl .bdFind input{ flex:1 1 auto; }
  #bdctl .shHead h3{ white-space:normal; }
  #bdctl .shHead .pr{ display:none; }
  #bdctl .shBar{ position:static; }
  #bdctl .shBar .jump{ flex:1 1 100%; max-width:none; order:-1; }
  #bdctl .shCats{ grid-template-columns:1fr; }
  #bdctl .shBar .sp, #bdctl .shBar [data-a=print]{ display:none; }
  #bdctl .shFields{ grid-template-columns:1fr 1fr; margin:8px 10px 0; }
  #bdctl .shFields .fw{ grid-column:1 / -1; }
  #bdctl .shMain, #bdctl .shSide{ padding-left:10px; padding-right:10px; }
  #bdctl .qAdd{ flex-wrap:wrap; }
  #bdctl .qAdd select{ max-width:none; flex:1 1 100%; }
  #bdctl .shCats{ grid-template-columns:1fr; }
  #bdctl .stBody{ font-size:12px; padding:10px; }
  #bdctl .stBody .t-character{ margin-left:12ch; } #bdctl .stBody .t-dialogue{ margin-left:4ch; } #bdctl .stBody .t-parenthetical{ margin-left:8ch; }
  #bdctl input, #bdctl select, #bdctl textarea{ font-size:16px; }
  #bdctl .bdChip.hideSm{ display:none; }
  #bdctl #bdQ{ width:100% !important; }
}`;
// Print: only the open breakdown sheet, on white
const printCss = `
@media print{
  @page{ margin:12mm; }
  body *{ visibility:hidden !important; }
  #bdctl .bdSheet, #bdctl .bdSheet *{ visibility:visible !important; }
  #bdctl .bdSheet{ position:absolute; left:0; top:0; width:100%; overflow:visible !important; border:0; background:#fff !important; color:#000 !important; }
  #bdctl .bdSheet *{ color:#000 !important; background:transparent !important; box-shadow:none !important; }
  #bdctl .shBar, #bdctl .qAdd, #bdctl .cat > .ch .add, #bdctl .c-x, #bdctl .addRow, #bdctl .cat.isEmpty{ display:none !important; }
  #bdctl .shGrid{ grid-template-columns:1fr !important; }
  #bdctl .stBody{ max-height:none !important; } #bdctl .stHd small{ display:none !important; }
  #bdctl .stBody mark{ box-shadow:inset 0 -2px 0 var(--cc) !important; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
  #bdctl .shSide{ position:static !important; border:0 !important; }
  #bdctl .shFields{ grid-template-columns:repeat(8,auto) !important; border-color:#000 !important; }
  #bdctl .shFields .f, #bdctl .cat, #bdctl table.ct td, #bdctl table.ct th{ border-color:#999 !important; }
  #bdctl .cat{ break-inside:avoid; border-left:4px solid var(--cc) !important; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
  #bdctl .cat .ci{ color:var(--cc) !important; filter:none !important; }
  #bdctl .cno{ border:1px solid #000; }
  #bdctl input, #bdctl select, #bdctl textarea{ border:0 !important; padding:0 !important; resize:none; appearance:none; }
}`;
const style = document.createElement("style"); style.textContent = css + printCss; document.head.appendChild(style);

/* ---------- helpers ---------- */
function stripColor(s){
  const ext = /EXT/.test(s.ie || "") && !/INT/.test(s.ie || ""), both = /INT/.test(s.ie || "") && /EXT/.test(s.ie || "");
  if(s.dn === "M") return "#f2994a";
  if(s.dn === "N") return ext ? "#5ccf8a" : both ? "#7fb6ff" : "#5b8cff";
  return ext ? "#f2c94c" : both ? "#f5dc8a" : "#e8e8e8";
}
const DN = { D: "Day", N: "Night", M: "Dawn/Dusk" };
const fmtMin = (m) => m >= 60 ? Math.floor(m / 60) + "h" + (m % 60 ? " " + String(m % 60).padStart(2, "0") : "") : m + "m";
const SKEY = (pid, sid) => pid + "|" + sid;
let rafId = 0;
function rerender(){ S.forceDraw = true; cancelAnimationFrame(rafId); rafId = requestAnimationFrame(() => { if(S.pid && S.on) render(S.pid); }); }

/* ---------- script ---------- */
async function loadScript(id, force){
  const hub = H(), cur = S.scripts[id], mod = hub.scriptModified(id);
  if(cur && !force && (cur.state === "loading" || (cur.state === "ok" && cur.modified === mod))) return;
  S.scripts[id] = { state: "loading", doc: cur && cur.doc, bd: cur && cur.bd, akey: cur && cur.akey, modified: mod };
  rerender();
  try{
    const res = await hub.ripGet({ action: "load", fileId: id });
    if(!res || res.ok === false || !res.doc) throw new Error((res && res.error) || "Couldn't read the script.");
    S.scripts[id] = { state: "ok", doc: res.doc, bd: null, akey: null, modified: mod };
  }catch(err){
    S.scripts[id] = { state: "error", err: (err && err.message) || String(err), doc: cur && cur.doc, bd: cur && cur.bd, akey: cur && cur.akey, modified: mod };
  }
  S.model = null; rerender();
}
// The plan's flag and location choices shape the breakdown everywhere, so use the same ones here
function planOpts(p){ try{ return P.analyzeOpts(P.normalize(p && p.production)); }catch(_e){ return {}; } }
function storeOf(pid, sid){ const k = SKEY(pid, sid); return S.stores[k] || (S.stores[k] = local.load(pid, sid)); }

/* ---------- team sync ---------- */
// Send only the entries that changed. A refusal (no database rule yet, or no permission) keeps the edit
// on this device, marked unshared, so it's merged in once sharing works.
function push(pid, sid, paths){
  const hub = H(), k = SKEY(pid, sid);
  if(!Object.keys(paths).length) return;
  if(!hub.writeBreakdown || S.share[k] === "denied" || S.share[k] === "off"){ local.dirty(sid, true); return; }
  S.inflight[k] = (S.inflight[k] || 0) + 1;
  const done = () => { S.inflight[k]--; S.seen[k] = undefined; rerender(); };   // look at the team copy again once it's settled
  Promise.resolve().then(() => hub.writeBreakdown(pid, sid, paths)).then(() => {
    S.share[k] = "ok"; done();
  }).catch((err) => {
    const m = String((err && (err.code || err.message)) || err);
    S.share[k] = /permission|denied/i.test(m) ? "denied" : "error";
    local.dirty(sid, true);
    hub.toast(S.share[k] === "denied" ? "The breakdown isn't shared yet: the database refused it. Your changes are kept on this device." : "Couldn't share that change. It's kept on this device: " + m, "err", 5000);
    done();
  });
}
// Each draw: take in the team's copy, add anything this device hasn't shared yet, upload the difference
function sync(pid, sid, p, can){
  const hub = H(), k = SKEY(pid, sid);
  if(!hub.writeBreakdown){ S.share[k] = "off"; return; }
  if(S.share[k] === "denied") return;                                   // keep working on this device's copy
  // While a change is on its way, the database may briefly show the copy without it (or take it back if
  // refused): don't take that in, or the change would vanish from this device too. Look again once it settles.
  if(S.inflight[k] > 0) return;
  const raw = (p && p.breakdown && p.breakdown[sid]) || null, rj = JSON.stringify(raw);
  const pend = can ? local.pending(sid) : [], dirty = can && local.isDirty(sid);
  if(rj === S.seen[k] && !pend.length && !dirty) return;
  S.seen[k] = rj;
  const team = E.fromRemote(raw);
  let next = team;
  if(dirty) next = E.mergeStores(team, local.load(pid, sid));          // keep both: nothing is dropped
  if(pend.length) next = E.applyOps(next, pend);
  if(can){
    if(pend.length) local.clearPending(sid, pend.length);
    if(dirty) local.dirty(sid, false);
    push(pid, sid, E.diff(team, next));                                 // a refusal marks it unshared again
  }
  if(!dirty && can) local.dirty(sid, false);                            // this device is now in step with the team
  if(JSON.stringify(next) !== JSON.stringify(S.stores[k])){ S.stores[k] = next; S.model = null; }
  local.save(sid, next);
}

/* ---------- the model: script + edits -> scenes with elements ---------- */
function modelFor(pid, sid, sc, p){
  const opts = planOpts(p), akey = JSON.stringify(opts);
  if(sc.doc && (!sc.bd || sc.akey !== akey)){ sc.bd = B.analyze(sc.doc, opts); sc.akey = akey; S.model = null; }
  const st = storeOf(pid, sid), mk = SKEY(pid, sid) + "|" + sc.akey + "|" + (sc.modified || "");
  if(!S.model || S.modelKey !== mk){ S.model = E.build(sc.doc, sc.bd, st); S.modelKey = mk; }
  return S.model;
}
// Every edit goes through here: apply it, remember it for undo, save it, rebuild
function edit(pid, sid, fn, quiet){
  const k = SKEY(pid, sid), cur = storeOf(pid, sid), next = fn(cur);
  if(JSON.stringify(next) === JSON.stringify(cur)) return;
  const h = S.hist[k] = S.hist[k] || { undo: [], redo: [] };
  h.undo.push(JSON.stringify(cur)); if(h.undo.length > 60) h.undo.shift(); h.redo = [];
  S.stores[k] = next; local.save(sid, next); S.model = null;
  push(pid, sid, E.diff(cur, next));
  if(!quiet) rerender();
}
function stepHist(pid, sid, back){
  const k = SKEY(pid, sid), h = S.hist[k]; if(!h) return;
  const from = back ? h.undo : h.redo, to = back ? h.redo : h.undo;
  if(!from.length) return;
  to.push(JSON.stringify(storeOf(pid, sid)));
  const cur = storeOf(pid, sid), next = JSON.parse(from.pop());
  S.stores[k] = next; local.save(sid, next); S.model = null;
  push(pid, sid, E.diff(cur, next)); rerender();
}

/* ---------- the breakdown as the plan's source of truth ---------- */
// The Plan tab asks for the script analysis with the element sheets applied (cast, flags and needs per scene),
// so Auto-schedule, warnings, Day Out of Days and day cards all follow what's in the breakdown.
const EN = {};
function enriched(pid, sid, p, doc, bd, modified, opts){
  try{
    if(!doc || !bd || !p || !sid) return bd;
    sync(pid, sid, p, H().canEdit(p));
    const st = storeOf(pid, sid), sj = JSON.stringify(st), c = EN[sid];
    if(c && c.bd === bd && c.sj === sj && c.mod === modified) return c.out;
    const model = E.build(doc, bd, st), out = E.enrich(bd, model, st, opts);
    EN[sid] = { bd, sj, mod: modified, out };
    return out;
  }catch(_e){ return bd; }
}

// The finished breakdown for a script, for Sync / Export (the Schedule sheet and call sheets read it)
async function payload(pid, sid){
  const hub = H(), p = hub.project(pid); if(!p || !sid) return null;
  let sc = S.scripts[sid];
  let doc = sc && sc.doc;
  if(!doc){
    const res = await hub.ripGet({ action: "load", fileId: sid });
    if(!res || res.ok === false || !res.doc) return null;
    doc = res.doc;
  }
  const bd = B.analyze(doc, planOpts(p));
  sync(pid, sid, p, hub.canEdit(p));
  return E.sheetPayload(E.build(doc, bd, storeOf(pid, sid)));
}

/* ---------- rendering ---------- */
function render(pid){
  const box = document.getElementById("bdctl"); if(!box) return;
  const ae = document.activeElement;
  if(ae && box.contains(ae) && /^(INPUT|TEXTAREA)$/.test(ae.tagName) && ae.type !== "checkbox" && !S.forceDraw){
    if(!S.waitBlur){ S.waitBlur = true; ae.addEventListener("blur", () => { S.waitBlur = false; setTimeout(() => { if(S.on && S.pid) render(S.pid); }, 0); }, { once: true }); }
    return;
  }
  S.forceDraw = false; S.waitBlur = false;
  const body = box.querySelector(".bdBody"), list = box.querySelector(".bdList"), sheet = box.querySelector(".bdSheet");
  const top = body ? body.scrollTop : 0, ltop = list ? list.scrollTop : 0, lleft = list ? list.scrollLeft : 0;
  const stop = sheet ? sheet.scrollTop : 0, ssel = S.sel, sview = S.view;
  draw(pid);
  const b2 = box.querySelector(".bdBody"), l2 = box.querySelector(".bdList"), s2 = box.querySelector(".bdSheet");
  if(b2 && top) b2.scrollTop = top;
  // same scene still open: stay where you were on the sheet (a new scene starts at the top)
  if(s2 && stop && ssel === S.sel && sview === S.view) s2.scrollTop = stop;
  if(l2){ if(ltop) l2.scrollTop = ltop; if(lleft) l2.scrollLeft = lleft; }
  // keep the open scene showing in the list
  const on = l2 && l2.querySelector(".bdSc.on");
  if(on){ const a = on.offsetTop - l2.offsetTop, z = a + on.offsetHeight; if(a < l2.scrollTop) l2.scrollTop = a - 6; else if(z > l2.scrollTop + l2.clientHeight) l2.scrollTop = z - l2.clientHeight + 6; }
}
function head(chips, acts){ return `<div class="bdTop"><span class="bdTitle">${S.lock === "strips" ? "Stripboard" : "Breakdown"}</span><div class="bdChips">${chips || ""}</div>${acts || ""}</div>`; }

function draw(pid){
  S.pid = pid;
  const hub = H(), box = document.getElementById("bdctl"); if(!box || !hub) return;
  box.className = S.on ? "on" : "";
  if(!S.on) return;
  const p = hub.project(pid); if(!p){ box.innerHTML = ""; return; }
  const ids = hub.scriptIds(p), plan = P.normalize(p.production);
  const pick = S.scriptPick[pid];
  const sid = (pick && ids.indexOf(pick) >= 0) ? pick : (plan.scriptId && ids.indexOf(plan.scriptId) >= 0) ? plan.scriptId : ids[0] || "";
  S.sid = sid;
  if(!ids.length){ box.innerHTML = head(`<span class="bdChip">Add a script to this project to break it down</span>`); wire(box, pid); return; }
  const sc = S.scripts[sid];
  if(!sc || (sc.state === "loading" && !sc.doc)){
    if(!sc) loadScript(sid);
    box.innerHTML = head("") + `<div class="bdLoad"><span class="spin"></span><b>Loading the breakdown…</b><span>Reading the script and finding every element</span></div>`;
    wire(box, pid); return;
  }
  if(sc.state === "error" && !sc.doc){
    box.innerHTML = head(`<span class="bdChip warn">Couldn't read the script</span>`) + `<div class="bdEmpty">${esc(sc.err)} <button class="btn sm" type="button" data-a="reload">Try again</button></div>`;
    wire(box, pid); return;
  }
  const modNow = hub.scriptModified(sid);
  if(sc.state === "ok" && modNow && sc.modified && sc.modified !== modNow) loadScript(sid);
  else if(sc.state === "ok" && modNow && !sc.modified) sc.modified = modNow;

  const can = hub.canEdit(p);
  sync(pid, sid, p, can);
  const b = modelFor(pid, sid, sc, p);
  if(!b.scenes.length){ box.innerHTML = head(`<span class="bdChip">No scenes yet</span>`) + `<div class="bdEmpty">Write a scene heading in the script (INT. HOUSE - DAY) and the breakdown fills in.</div>`; wire(box, pid); return; }
  if(S.sel < 1 || S.sel > b.scenes.length) S.sel = 1;
  const hh = S.hist[SKEY(pid, sid)] || { undo: [], redo: [] };
  const scriptSel = ids.length > 1 ? `<select data-a="script" aria-label="Script">${ids.map((id) => `<option value="${esc(id)}"${id === sid ? " selected" : ""}>${esc(hub.scriptTitle(id))}</option>`).join("")}</select>` : "";
  const chips = `<span class="bdChip">${b.totals.scenes} scenes · ${E.fmtEighths(b.totals.eighths)} pages</span>
    <span class="bdChip hideSm">${b.totals.elements} elements</span>
    <span class="bdChip hideSm" title="Estimated shooting time, about an hour a page plus allowances for heavy scenes">~${fmtMin(b.totals.est)} to shoot</span>
    ${sc.state === "loading" ? `<span class="bdChip">Updating from script…</span>` : ""}${!can ? `<span class="bdChip">View only</span>` : ""}
    ${shareChip(S.share[SKEY(pid, sid)], can)}`;
  const acts = `<div class="bdActs">${scriptSel}
    ${S.lock ? "" : `<div class="seg" role="tablist">${[["sheets", "Sheets"], ["elements", "Elements"], ["reports", "Reports"]].map(([v, n]) => `<button type="button" role="tab" class="${S.view === v ? "on" : ""}" data-a="view" data-v="${v}" aria-selected="${S.view === v}">${n}</button>`).join("")}</div>`}
    ${can && !S.lock ? `<span class="seg"><button type="button" data-a="undo" title="Undo"${hh.undo.length ? "" : " disabled"}>↶</button><button type="button" data-a="redo" title="Redo"${hh.redo.length ? "" : " disabled"}>↷</button></span>` : ""}
    </div>`;
  const note = `<div class="bdNote">Suggestions come from the script. Remove what's wrong, add what's missing. Changes are shared with everyone on the project. <button class="btn sm" type="button" data-a="dismissnote" style="margin-left:8px">Got it</button></div>`;
  // The stripboard lives under Schedule (locked mode); in Breakdown a saved "strips" view falls back to Sheets
  const V = S.lock === "strips" ? "strips" : S.view === "strips" ? "sheets" : S.view;
  const view = V === "elements" ? elementsView(b, can) : V === "reports" ? reportsView(b, p) : V === "strips" ? stripsView(b, p) : sheetsView(b, can);
  box.innerHTML = head(chips, acts) + `<div class="bdBody${V === "sheets" ? " split" : ""}">${can && !lsGet(NOTE_KEY) ? note : ""}${view}</div>`;
  wire(box, pid);
}

function shareChip(st, can){
  if(!can) return "";
  if(st === "denied") return `<span class="bdChip warn" title="Firebase refused the breakdown (the database rule for projects/…/breakdown is missing, or your role can't edit). Changes stay on this device and are merged in once sharing works.">⚠ Not shared · this device only</span>`;
  if(st === "error") return `<span class="bdChip warn" title="The last change didn't reach the team. It's kept on this device and is sent again on the next change.">⚠ Not sent</span>`;
  if(st === "off") return `<span class="bdChip">This device only</span>`;
  return "";
}

/* ---------- sheets ---------- */
const SC_FILTERS = [["all", "All"], ["int", "INT"], ["ext", "EXT"], ["D", "Day"], ["N", "Night"]];
function scMatch(x){
  const f = S.scF, ie = x.ie || "", q = S.scQ.trim().toLowerCase();
  if(f === "int" && !/INT/.test(ie)) return false;
  if(f === "ext" && !/EXT/.test(ie)) return false;
  if((f === "D" || f === "N") && x.dn !== f) return false;
  return !q || String(x.n) === q || (x.heading || "").toLowerCase().indexOf(q) >= 0 || (x.syn || "").toLowerCase().indexOf(q) >= 0;
}
function sheetsView(b, can){
  const s = b.scenes[S.sel - 1];
  const castNos = (x) => (x.els.cast || []).map((k) => b.elements[k].no).filter(Boolean).sort((p, q) => p - q);
  const shown = b.scenes.filter(scMatch);
  const list = shown.map((x) => {
    const cats = E.CATS.filter((c) => (x.els[c.id] || []).length), cn = castNos(x);
    return `<button type="button" class="bdSc${x.n === S.sel ? " on" : ""}" data-a="pick" data-n="${x.n}" style="--sc:${stripColor(x)}" title="${esc(x.heading || "")}">
      <span class="no">${x.n}</span>
      <span class="mid"><span class="l">${esc(x.set || x.loc || x.heading)}</span><span class="m">${esc(x.ie || "")} · ${esc(DN[x.dn] || "")}${cn.length ? ` · <span class="cn">${cn.join(", ")}</span>` : ""}</span>
        <span class="dots" title="${x.count} elements">${cats.map((c) => `<i style="background:${c.color}"></i>`).join("")}</span></span>
      <span class="pg">${E.fmtEighths(x.eighths)}</span></button>`;
  }).join("") || `<div class="bdEmpty" style="padding:10px 4px">No scenes match.</div>`;
  const listBox = `<div class="bdListWrap"><div class="bdFind"><input type="text" id="bdScQ" placeholder="Find a scene" value="${esc(S.scQ)}" autocomplete="off" aria-label="Find a scene">
      <div class="seg sm">${SC_FILTERS.map(([v, n]) => `<button type="button" class="${S.scF === v ? "on" : ""}" data-a="scf" data-v="${v}">${n}</button>`).join("")}</div>
      <span class="cnt">${shown.length === b.scenes.length ? b.scenes.length + " scenes" : shown.length + " of " + b.scenes.length}</span></div>
    <div class="bdList" role="list">${list}</div></div>`;

  const adding = S.adding && S.adding.sk === s.key ? S.adding.cat : "";
  const catBox = (c) => {
    const keys = s.els[c.id] || [];
    if(!keys.length && adding !== c.id && !S.showEmpty) return "";   // empty categories stay hidden unless "Show empty" is on
    const isCast = c.id === "cast";
    const rows = keys.map((k) => {
      const e = b.elements[k], tip = (e.auto ? "Found in the script: " + e.why.join(", ") : "Added by hand") + (e.scenes.length > 1 ? " · in scenes " + e.scenes.join(", ") : "");
      return `<tr class="${e.manual && !e.auto ? "man" : ""}" title="${esc(tip)}">
        <td class="c-no">${isCast && e.no ? `<span class="cno">${e.no}</span>` : `<span class="dot" style="background:${c.color}"></span>`}</td>
        <td class="c-nm"><b data-a="edit" data-k="${esc(k)}">${esc(e.name)}</b></td>
        <td class="c-q">${s.qty && s.qty[k] ? s.qty[k] : isCast ? "" : "1"}</td>
        <td class="c-nt">${e.note ? esc(e.note) : `<span class="mu">—</span>`}</td>
        <td class="c-sc" title="${e.scenes.length} scene${e.scenes.length === 1 ? "" : "s"}">${e.scenes.length > 1 ? e.scenes.length : ""}</td>
        <td class="c-h">${can || e.hero ? `<button type="button" class="star${e.hero ? " on" : ""}" data-a="hero" data-k="${esc(k)}" data-on="${e.hero ? 0 : 1}" aria-pressed="${e.hero}" aria-label="${e.hero ? "Remove hero from " : "Make "}${esc(e.name)}${e.hero ? "" : " a hero"}" title="${e.hero ? "Hero" + (e.heroSet ? "" : " (found automatically)") + ": plan doubles and continuity. Click to turn off" : "Make this a hero: plan doubles and continuity"}"${can ? "" : " disabled"}>${e.hero ? "★" : "☆"}</button>` : ""}</td>
        <td class="c-x">${can ? `<button type="button" data-a="rm" data-sk="${esc(s.key)}" data-k="${esc(k)}" aria-label="Take ${esc(e.name)} out of this scene" title="Take out of this scene">✕</button>` : ""}</td></tr>`;
    }).join("");
    const names = (b.byCat[c.id] || []).map((k) => b.elements[k].name);
    const addRow = adding === c.id ? `<div class="addRow"><input type="text" id="bdAdd" list="bdDL" maxlength="60" placeholder="${esc(c.short)} name" autocomplete="off"><datalist id="bdDL">${names.map((n) => `<option value="${esc(n)}">`).join("")}</datalist><button class="btn sm primary" type="button" data-a="addok" data-c="${c.id}" data-sk="${esc(s.key)}">Add</button><button class="btn sm" type="button" data-a="addcancel">✕</button></div>` : "";
    return `<div class="cat${keys.length ? "" : " isEmpty"}" style="--cc:${c.color}"><div class="ch">${catIcon(c.id)}<span class="nm">${esc(c.label)}</span><span class="k">${keys.length}</span>${can ? `<button class="add" type="button" data-a="add" data-c="${c.id}" data-sk="${esc(s.key)}" aria-label="Add ${esc(c.label)}" title="Add ${esc(c.label.toLowerCase())}">+ Add</button>` : ""}</div>
      ${rows ? `<table class="ct"><thead><tr><th class="c-no">${isCast ? "ID" : ""}</th><th class="c-nm">${isCast ? "Character" : "Element"}</th><th class="c-q">${isCast ? "" : "Qty"}</th><th class="c-nt">Notes</th><th class="c-sc" title="How many scenes it's in">Sc</th><th class="c-h" title="Hero">★</th><th class="c-x"></th></tr></thead><tbody>${rows}</tbody></table>` : `<div class="none">No ${esc(c.short.toLowerCase())} in this scene</div>`}${addRow}</div>`;
  };
  const dis = can ? "" : " disabled";
  const qc = E.CAT[S.qCat] ? S.qCat : "props";
  const allNames = Object.keys(b.elements).filter((k) => !(s.els[b.elements[k].cat] || []).includes(k)).map((k) => `<option value="${esc(b.elements[k].name)}" label="${esc(E.CAT[b.elements[k].cat].short)}">`).join("");
  const quick = can ? `<div class="qAdd"><select id="bdQCat" aria-label="Category" style="--cc:${E.CAT[qc].color}">${E.CATS.map((c) => `<option value="${c.id}"${c.id === qc ? " selected" : ""}>${esc(c.label)}</option>`).join("")}</select>
      <input type="text" id="bdQuick" list="bdQL" maxlength="60" placeholder="Add an element to this scene… (type a name, Enter)" autocomplete="off" aria-label="Add an element"><datalist id="bdQL">${allNames}</datalist>
      <button class="btn sm primary" type="button" data-a="qadd" data-sk="${esc(s.key)}">Add</button></div>` : "";
  const cats = E.CATS.map(catBox).join("");
  const idx = shown.findIndex((x) => x.n === s.n);
  const pv = idx > 0 ? shown[idx - 1].n : 0, nx = idx >= 0 && idx < shown.length - 1 ? shown[idx + 1].n : 0;
  const jump = `<select id="bdJump" class="jump" aria-label="Go to scene">${b.scenes.map((x) => `<option value="${x.n}"${x.n === s.n ? " selected" : ""}>Scene ${x.n} – ${esc(x.heading || "")}</option>`).join("")}</select>`;
  const bar = `<div class="shBar">
      <button class="btn sm" type="button" data-a="pick" data-n="${pv}" aria-label="Previous scene" title="Previous scene (K)"${pv ? "" : " disabled"}>←</button>${jump}<button class="btn sm" type="button" data-a="pick" data-n="${nx}" aria-label="Next scene" title="Next scene (J)"${nx ? "" : " disabled"}>→</button>
      <span class="pos">${s.n} / ${b.scenes.length}</span>
      <span class="sp"></span>
      <label class="tgl"><input type="checkbox" id="bdShowText"${S.showText ? " checked" : ""}> Scene text</label>
      <label class="tgl"><input type="checkbox" id="bdShowEmpty"${S.showEmpty ? " checked" : ""}> Show empty categories</label>
      <button class="btn sm" type="button" data-a="print" title="Print this breakdown sheet">Print</button></div>`;
  const tot = E.CATS.reduce((a, c) => a + (s.els[c.id] || []).length, 0);
  const fld = (label, val, cls) => `<div class="f${cls ? " " + cls : ""}"><span class="lb">${label}</span>${val}</div>`;
  const fields = `<div class="shFields" style="--sc:${stripColor(s)}">
      ${fld("Scene", `<span class="big">${s.n}</span>`, "fn")}
      ${fld("INT / EXT", `<b>${esc(s.ie || "—")}</b>`)}
      ${fld("Set / location", `<b class="ell" title="${esc(s.set || s.loc || "")}">${esc(s.set || s.loc || "—")}</b>`, "fw")}
      ${fld("Day / Night", `<b>${esc(DN[s.dn] || "—")}</b>`)}
      ${fld("Pages (1/8)", `<b title="A page is 8 eighths">${E.fmtEighths(s.eighths)}</b>`)}
      ${fld("Story day", `<input type="text" id="shDay" maxlength="40" value="${esc(s.dayAuto ? "" : s.day)}" placeholder="${esc(s.day)}"${dis}>`)}
      ${fld("Est. minutes", `<input type="number" id="shEst" min="5" max="1440" step="5" value="${s.estAuto ? "" : s.est}" placeholder="${s.est}"${dis}>`)}
      ${fld("Elements", `<b>${tot}</b>`)}
    </div>`;
  return `<div class="bdSplit">${listBox}
    <div class="bdSheet">
      ${bar}
      <div class="shHead" style="--sc:${stripColor(s)}"><h3>${esc(s.heading || "(no scene heading)")}</h3><span class="pr">${esc(hubTitle())}</span></div>
      ${fields}
      <div class="shGrid">
        <div class="shMain">${S.showText ? sceneText(b, s) : ""}${quick}
          <div class="shCats">${cats || `<div class="bdEmpty" style="grid-column:1/-1;padding:6px 0">Nothing found in this scene yet.${can ? " Add what it needs above." : ""}</div>`}</div></div>
        <aside class="shSide">
          <div class="fld"><label for="shSyn">Scene summary</label><textarea id="shSyn" rows="3" maxlength="2000"${dis}>${esc(s.syn)}</textarea></div>
          <div class="fld"><label for="shNote">Production notes</label><textarea id="shNote" rows="4" maxlength="2000"${dis}>${esc(s.note)}</textarea></div>
          <div class="fld"><label for="shDir">Director's notes</label><textarea id="shDir" rows="4" maxlength="2000"${dis}>${esc(s.dir || "")}</textarea></div>
        </aside>
      </div>
    </div></div>`;
}
/* ---------- the scene's script text, with what's tagged coloured in ----------
   Uses the same words the editor colours (the model's hits per element), whole words only. */
const WORDCH = /[A-Za-z0-9À-ɏ'’]/;
function findAll(hay, needle){
  const out = []; if(!needle) return out;
  const h = hay.toLowerCase(), n = needle.toLowerCase(); let i = 0;
  while((i = h.indexOf(n, i)) >= 0){
    const a = i, z = i + n.length;
    if((!WORDCH.test(hay.charAt(a - 1) || " ") || !WORDCH.test(n.charAt(0))) && (!WORDCH.test(hay.charAt(z) || " ") || !WORDCH.test(n.charAt(n.length - 1)))) out.push([a, z]);
    i = z;
  }
  return out;
}
const runsText = (r) => (r || []).map((x) => x && x.t || "").join("");
function sceneLines(doc, s){
  const ls = (doc && doc.lines) || [];
  let i = s.id ? ls.findIndex((l) => l.type === "scene" && l.id === s.id) : -1;
  if(i < 0){ let n = 0; i = ls.findIndex((l) => l.type === "scene" && ++n === s.n); }
  if(i < 0) return [];
  const out = [ls[i]];
  for(let j = i + 1; j < ls.length && ls[j].type !== "scene"; j++) out.push(ls[j]);
  return out;
}
function sceneText(b, s){
  const sc = S.scripts[S.sid], lines = sceneLines(sc && sc.doc, s);
  if(!lines.length) return "";
  const needles = [];
  Object.keys(s.els).forEach((c) => (s.els[c] || []).forEach((k) => { const e = b.elements[k]; (s.hits && s.hits[k] || []).forEach((q) => { if(q) needles.push({ q, c, name: e ? e.name : q }); }); }));
  needles.sort((x, y) => y.q.length - x.q.length);   // longer words win where two overlap
  const mark = (txt) => {
    const spans = [];
    needles.forEach((nd) => findAll(txt, nd.q).forEach(([a, z]) => { if(!spans.some((p) => a < p.z && z > p.a)) spans.push({ a, z, nd }); }));
    spans.sort((x, y) => x.a - y.a);
    let h = "", at = 0;
    spans.forEach((p) => { const c = E.CAT[p.nd.c]; h += esc(txt.slice(at, p.a)) + `<mark style="--cc:${c.color}" title="${esc(p.nd.name)} · ${esc(c.label)}">${esc(txt.slice(p.a, p.z))}</mark>`; at = p.z; });
    return h + esc(txt.slice(at));
  };
  const row = (type, txt) => txt.trim() ? `<div class="sl t-${esc(type)}">${mark(txt)}</div>` : "";
  const html = lines.map((l) => {
    if(l.type === "dual" && l.dual){
      const side = (d) => d ? row("character", runsText(d.characterRuns)) + row("dialogue", runsText(d.dialogueRuns)) : "";
      return `<div class="sl dualRow"><div>${side(l.dual.left)}</div><div>${side(l.dual.right)}</div></div>`;
    }
    return row(l.type || "action", runsText(l.runs));
  }).join("");
  const can = H().canEdit(H().project(S.pid));
  return `<div class="shText" aria-label="Scene text"><div class="stHd"><span>Scene text</span>${can ? `<small>Select words to add them below</small>` : ""}</div><div class="stBody">${html}</div></div>`;
}
function hubTitle(){ try{ return H().scriptTitle(S.sid) || ""; }catch(_e){ return ""; } }
// Small line icons for each category (24px grid, drawn with currentColor)
const CAT_ICON = {
  cast: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  background: '<circle cx="8" cy="9" r="3"/><circle cx="17" cy="9" r="2.5"/><path d="M2 20a6 6 0 0 1 12 0M14 20a4.5 4.5 0 0 1 8 0"/>',
  stunts: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
  vehicles: '<path d="M5 16h14l-1.5-6a2 2 0 0 0-2-1.5h-7a2 2 0 0 0-2 1.5z"/><circle cx="7.5" cy="17.5" r="1.8"/><circle cx="16.5" cy="17.5" r="1.8"/>',
  props: '<path d="M3 8l9-5 9 5v8l-9 5-9-5z"/><path d="M3 8l9 5 9-5M12 13v8"/>',
  weapons: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/>',
  wardrobe: '<path d="M8 3l4 3 4-3 5 4-3 3v11H6V10L3 7z"/>',
  makeup: '<path d="M14 3l7 7-9 9H5v-7z"/><path d="M5 19l-2 2"/>',
  sfx: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6"/>',
  mfx: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2"/>',
  vfx: '<path d="M12 3 3 8l9 5 9-5z"/><path d="M3 13l9 5 9-5"/>',
  animals: '<circle cx="7" cy="9" r="2"/><circle cx="17" cy="9" r="2"/><circle cx="10" cy="5" r="2"/><circle cx="14" cy="5" r="2"/><path d="M7 17c0-3 2.5-5 5-5s5 2 5 5-2.5 3-5 2-5 1-5-2z"/>',
  wrangler: '<circle cx="12" cy="7" r="3"/><path d="M5 21a7 7 0 0 1 14 0M4 10h16"/>',
  music: '<path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/>',
  sound: '<path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M17 8a5 5 0 0 1 0 8M19.5 5.5a8.5 8.5 0 0 1 0 13"/>',
  art: '<path d="M12 3a9 9 0 1 0 0 18c1.5 0 2-1 2-2s-1-1.5-1-2.5S14 15 15 15h2a4 4 0 0 0 4-4c0-4.4-4-8-9-8z"/><circle cx="7.5" cy="11" r="1"/><circle cx="10" cy="7" r="1"/><circle cx="15" cy="7.5" r="1"/>',
  setdress: '<path d="M4 18v-6a2 2 0 0 1 4 0v2h8v-2a2 2 0 0 1 4 0v6z"/><path d="M6 18v2M18 18v2M8 10V7a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v3"/>',
  greenery: '<path d="M5 19c0-8 5-14 15-14 0 10-6 15-14 15"/><path d="M5 19 13 11"/>',
  camera: '<rect x="3" y="7" width="13" height="10" rx="2"/><path d="m16 11 5-3v8l-5-3"/>',
  equipment: '<path d="M14 6a4 4 0 0 0 5 5l-9 9a2 2 0 0 1-3-3l9-9a4 4 0 0 1-2-2z"/>',
  security: '<path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z"/>',
  labor: '<path d="M4 15a8 8 0 0 1 16 0v2H4z"/><path d="M10 7V5h4v2M3 17h18"/>',
  misc: '<circle cx="6" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="18" cy="12" r="1.5"/>'
};
const catIcon = (id) => `<svg class="ci" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${CAT_ICON[id] || CAT_ICON.misc}</svg>`;

/* ---------- elements manager ---------- */
function elementsView(b, can){
  const q = S.q.trim().toLowerCase();
  const keys = Object.keys(b.elements).filter((k) => { const e = b.elements[k]; return (S.cat === "all" || e.cat === S.cat) && (!q || e.name.toLowerCase().indexOf(q) >= 0 || e.note.toLowerCase().indexOf(q) >= 0); });
  const counts = {}; Object.keys(b.elements).forEach((k) => { const c = b.elements[k].cat; counts[c] = (counts[c] || 0) + 1; });
  const chips = [`<button type="button" class="catChip${S.cat === "all" ? " on" : ""}" data-a="cat" data-c="all">All<small>${b.totals.elements}</small></button>`]
    .concat(E.CATS.filter((c) => counts[c.id]).map((c) => `<button type="button" class="catChip${S.cat === c.id ? " on" : ""}" style="--cc:${c.color}" data-a="cat" data-c="${c.id}">${esc(c.short)}<small>${counts[c.id]}</small></button>`)).join("");
  keys.sort((a, c) => { const A = b.elements[a], C = b.elements[c], ia = E.CATS.findIndex((x) => x.id === A.cat), ic = E.CATS.findIndex((x) => x.id === C.cat); return (ia - ic) || b.byCat[A.cat].indexOf(a) - b.byCat[A.cat].indexOf(c); });
  const grouped = S.cat === "all" && !q;
  let lastCat = "";
  const rows = keys.map((k) => {
    const e = b.elements[k], c = E.CAT[e.cat];
    const grp = grouped && e.cat !== lastCat ? `<tr class="grp" style="--cc:${c.color}"><td colspan="${grouped ? 4 : 5}"><i></i>${esc(c.label)}<span>${counts[e.cat]}</span></td></tr>` : "";
    lastCat = e.cat;
    const form = S.edit === k && can ? `<tr><td colspan="${grouped ? 4 : 5}"><div class="edForm">
        <label>Name<input type="text" id="edName" maxlength="60" value="${esc(e.name)}"></label>
        <label>Category<select id="edCat">${E.CATS.map((x) => `<option value="${x.id}"${x.id === e.cat ? " selected" : ""}>${esc(x.label)}</option>`).join("")}</select></label>
        <label>Note (shows on every sheet)<input type="text" id="edNote" maxlength="2000" value="${esc(e.note)}" style="min-width:220px"></label>
        <button class="btn sm primary" type="button" data-a="edsave" data-k="${esc(k)}">Save</button>
        <label>Merge into<select id="edMerge"><option value="">Choose…</option>${Object.keys(b.elements).filter((x) => x !== k).sort((x, y) => b.elements[x].name.localeCompare(b.elements[y].name)).map((x) => `<option value="${esc(x)}">${esc(b.elements[x].name)} (${esc(E.CAT[b.elements[x].cat].short)})</option>`).join("")}</select></label>
        <button class="btn sm" type="button" data-a="edmerge" data-k="${esc(k)}">Merge</button>
        <button class="btn sm" type="button" data-a="eddrop" data-k="${esc(k)}" title="Remove this element from every scene">Ignore everywhere</button>
        <button class="btn sm" type="button" data-a="edcancel">Cancel</button></div></td></tr>` : "";
    return `${grp}<tr class="er${S.edit === k ? " on" : ""}" style="--cc:${c.color}"><td>${e.no && e.cat === "cast" ? `<span class="cno">${e.no}</span>` : `<span class="dot" style="background:${c.color}"></span>`}<b>${esc(e.name)}</b>${can ? `<button type="button" class="star${e.hero ? " on" : ""}" data-a="hero" data-k="${esc(k)}" data-on="${e.hero ? 0 : 1}" aria-pressed="${e.hero}" aria-label="${e.hero ? "Remove hero from " : "Make "}${esc(e.name)}${e.hero ? "" : " a hero"}" title="${e.hero ? "Hero: plan doubles and continuity. Click to turn off" : "Make this a hero"}" style="margin-left:6px">${e.hero ? "★" : "☆"}</button>` : e.hero ? `<span class="tag" style="color:#f1c76b;border-color:rgba(241,199,107,.45)">★ hero</span>` : ""}${e.hero && !e.heroSet ? `<span class="tag" title="Found automatically: written in CAPS or handled in several scenes">auto</span>` : ""}${e.manual && !e.auto ? `<span class="tag">by hand</span>` : ""}${e.note ? `<span class="nt">${esc(e.note)}</span>` : ""}</td>
      ${grouped ? "" : `<td><span class="cpill">${esc(c.short)}</span></td>`}
      <td><div class="scBtns">${e.scenes.map((n) => `<button type="button" class="scBtn" data-a="goto" data-n="${n}" title="Open scene ${n}">${n}</button>`).join("")}</div></td>
      <td class="num">${E.fmtEighths(e.eighths)}</td>
      <td class="act">${can ? `<button class="edBtn" type="button" data-a="edit" data-k="${esc(k)}" aria-label="Edit ${esc(e.name)}" title="Rename, recategorise, merge or ignore">Edit</button>` : ""}</td></tr>${form}`;
  }).join("");
  const dropped = (storeOf(S.pid, S.sid).drop || []);
  const ignored = dropped.length ? `<div style="margin-top:14px;font-size:12px;color:var(--uiMuted)"><b style="color:var(--uiText)">Ignored</b> ${dropped.map((k) => `<button type="button" class="scBtn" style="margin:2px" data-a="undrop" data-k="${esc(k)}" title="Bring back"${can ? "" : " disabled"}>${esc(k.split("|").slice(1).join("|"))} ✕</button>`).join("")}</div>` : "";
  return `<div class="bdTools"><input type="text" id="bdQ" placeholder="Search elements and notes" value="${esc(S.q)}" style="width:220px" autocomplete="off"><div class="catChips">${chips}</div><span class="cnt">${keys.length === b.totals.elements ? keys.length + " elements" : keys.length + " of " + b.totals.elements}</span></div>
    ${rows ? `<table class="bdT"><colgroup><col>${grouped ? "" : `<col style="width:130px">`}<col style="width:38%"><col style="width:70px"><col style="width:64px"></colgroup><thead><tr><th>Element</th>${grouped ? "" : "<th>Category</th>"}<th>Scenes</th><th class="num">Pages</th><th></th></tr></thead><tbody>${rows}</tbody></table>` : `<div class="bdEmpty">Nothing matches.</div>`}${ignored}`;
}

/* ---------- reports ---------- */
// The shoot plan's days as scene lists (only scenes that are still in the script), plus the leftovers
function planDays(b, p){
  if(!p || !p.production) return null;
  const PP = window.CampProdPanel, pl = PP && PP.planOf && S.pid ? PP.planOf(S.pid) : P.normalize(p.production), dates = P.planDates(pl), byId = {};
  b.scenes.forEach((s) => { if(s.id) byId[s.id] = s; });
  const seen = {};
  const days = pl.days.map((d, i) => ({ n: i + 1, date: dates[i] || "", scenes: d.scenes.map((id) => { seen[id] = 1; return byId[id]; }).filter(Boolean) }));
  return { days, unsched: b.scenes.filter((s) => !s.id || !seen[s.id]) };
}
function fmtDate(iso){ const d = P.parseISO(iso); return d ? d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }) : ""; }
// Stripboard "Needs": every category in the scene except cast (cast has its own column)
const needCatsOf = (s) => E.CATS.filter((c) => c.id !== "cast" && (s.els[c.id] || []).length);

/* ---------- stripboard: the shoot in order, one strip per scene, a banner at the end of each day ---------- */
function stripsView(b, p){
  const pd = planDays(b, p);
  const drag = S.lock === "strips" && H().canEdit(p) && !!(window.CampProdPanel && window.CampProdPanel.moveSceneBefore);
  if(!pd) return `<div class="bdEmpty">No shoot plan yet. Start it on the Schedule tab and the stripboard appears here in shoot order.</div>`;
  const castNo = (k) => b.elements[k].no || "";
  const strip = (s, day) => {
    const cast = (s.els.cast || []).map(castNo).filter(Boolean).sort((x, y) => x - y);
    const marks = needCatsOf(s);
    return `<button type="button" class="stp" data-a="goto" data-n="${s.n}"${drag && s.id ? ` draggable="true" data-sid="${esc(s.id)}" data-day="${day}"` : ""} style="--sc:${stripColor(s)}" title="${esc(s.heading)}${s.syn ? " — " + esc(s.syn) : ""}">
      <span class="n">${s.n}</span><span class="ie">${esc(s.ie || "")}</span><span class="set">${esc(s.set || s.loc || "")}<small>${esc(s.syn || "")}</small></span>
      <span class="dn">${esc(DN[s.dn] || "")}</span><span class="pg">${E.fmtEighths(s.eighths)}</span><span class="sd">${esc(s.day || "")}</span>
      <span class="cast">${cast.join(", ")}</span><span class="mk">${marks.map((c) => `<i title="${esc(c.label + ": " + s.els[c.id].map((k) => b.elements[k].name).join(", "))}" style="background:${c.color}"></i>`).join("")}</span></button>`;
  };
  const banner = (d) => {
    const e = d.scenes.reduce((a, s) => a + s.eighths, 0), m = d.scenes.reduce((a, s) => a + s.est, 0);
    return `<div class="stpDay"${drag ? ` data-dropday="${d.n - 1}" title="Drop here to put a scene at the end of Day ${d.n}"` : ""}><b>End of Day ${d.n}</b>${d.date ? " · " + esc(fmtDate(d.date)) : ""}<span>${d.scenes.length} sc · ${E.fmtEighths(e)} pg · ~${fmtMin(m)}</span></div>`;
  };
  const legend = (b.byCat.cast || []).filter((k) => b.elements[k].no).map((k) => `<span><b>${b.elements[k].no}</b> ${esc(b.elements[k].name)}</span>`).join("");
  return `<div class="stpHead"><span class="n">Sc</span><span class="ie">I/E</span><span class="set">Set · synopsis</span><span class="dn">D/N</span><span class="pg">Pages</span><span class="sd">Story</span><span class="cast">Cast</span><span class="mk">Needs</span></div>
    <div class="stpWrap${drag ? " canDrag" : ""}">${pd.days.map((d) => d.scenes.map((s) => strip(s, d.n - 1)).join("") + banner(d)).join("")}
    ${pd.unsched.length || drag ? `<div class="stpDay un"${drag ? ` data-dropday="-1" title="Drop here to take a scene off the schedule"` : ""}><b>Unscheduled</b><span>${pd.unsched.length} sc · ${E.fmtEighths(pd.unsched.reduce((a, s) => a + s.eighths, 0))} pg</span></div>${pd.unsched.map((s) => strip(s, -1)).join("")}` : ""}</div>
    ${legend ? `<div class="stpLegend"><b>Cast</b>${legend}</div>` : ""}
    <div class="bdEmpty" style="padding:8px 0">${drag ? "Drag a strip to move it: onto another strip to go in front of it, onto a day's banner to go at the end of that day. Click a strip to open its sheet." : "Move scenes between days in Schedule › Shoot plan. Click a strip to open its sheet."}</div>`;
}

/* ---------- reports: by category, or what each shoot day needs ---------- */
function reportsView(b, p){
  const by = S.rpBy === "day" ? "day" : "cat";
  const seg = `<div class="bdTools"><div class="seg">${[["cat", "By category"], ["day", "By shoot day"]].map(([v, n]) => `<button type="button" class="${by === v ? "on" : ""}" data-a="rpby" data-v="${v}">${n}</button>`).join("")}</div><button class="btn sm" type="button" data-a="csv" title="Download the whole breakdown as a CSV file" style="margin-left:auto">Download CSV</button></div>`;
  if(by === "day"){
    const pd = planDays(b, p);
    if(!pd) return seg + `<div class="bdEmpty">No shoot plan yet. Start it on the Schedule tab to see what each day needs.</div>`;
    const cards = pd.days.filter((d) => d.scenes.length).map((d) => {
      const rows = E.CATS.map((c) => {
        const ks = []; d.scenes.forEach((s) => (s.els[c.id] || []).forEach((k) => { if(ks.indexOf(k) < 0) ks.push(k); }));
        if(!ks.length) return "";
        return `<tr><td><span class="dot" style="background:${c.color}"></span>${esc(c.short)}</td><td>${ks.map((k) => esc((b.elements[k].no && c.id === "cast" ? b.elements[k].no + ". " : "") + b.elements[k].name)).join(", ")}</td></tr>`;
      }).join("");
      return `<div class="rp rpDay" style="--cc:#8a8f98"><h4><span>Day ${d.n}${d.date ? " · " + esc(fmtDate(d.date)) : ""}</span><span>Sc ${d.scenes.map((s) => s.n).join(", ")}</span></h4><table>${rows}</table></div>`;
    }).join("");
    return seg + `<div class="rpGrid">${cards || `<div class="bdEmpty">No scenes on shoot days yet.</div>`}</div>`;
  }
  const cards = E.CATS.map((c) => {
    const r = E.report(b, c.id); if(!r.length) return "";
    return `<div class="rp" style="--cc:${c.color}"><h4><span>${esc(c.label)}</span><span>${r.length}</span></h4><table>${r.map((x) => `<tr><td><b>${x.no ? x.no + ". " : ""}${esc(x.name)}</b>${b.elements[x.key] && b.elements[x.key].hero ? ` <span style="color:#f1c76b" title="Hero prop">★</span>` : ""}${x.note ? `<span class="nt">${esc(x.note)}</span>` : ""}</td><td>Sc ${x.scenes.length > 8 ? x.scenes.slice(0, 8).join(", ") + " +" + (x.scenes.length - 8) : x.scenes.join(", ")}</td></tr>`).join("")}</table></div>`;
  }).join("");
  return seg + `<div class="rpGrid">${cards || `<div class="bdEmpty">No elements yet.</div>`}</div>`;
}

/* ---------- interaction ---------- */
function download(name, text){
  try{
    const blob = new Blob(["﻿" + text], { type: "text/csv;charset=utf-8" }), a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 800);
  }catch(_e){ H().toast("Couldn't make the file.", "err", 2200); }
}
function wire(box, pid){
  const hub = H(), p = hub.project(pid), can = !!(p && hub.canEdit(p)), sid = S.sid;
  const model = () => S.model;
  const ed = (fn) => edit(pid, sid, fn);
  box.onclick = (ev) => {
    const a = ev.target.closest("[data-a]"); if(!a || a.tagName === "SELECT" || a.tagName === "INPUT") return;
    const k = a.dataset.a;
    if(k === "view"){ S.view = a.dataset.v; lsSet(VIEW_KEY, S.view); S.edit = null; S.adding = null; rerender(); return; }
    if(k === "scf"){ S.scF = a.dataset.v; rerender(); return; }
    if((k === "pick" || k === "goto") && !Number(a.dataset.n)) return;
    if(k === "pick" || k === "goto"){ S.qQuote = ""; S.sel = Number(a.dataset.n) || 1; S.view = "sheets"; lsSet(VIEW_KEY, S.view); S.adding = null; if(S.lock){ window.dispatchEvent(new CustomEvent("camp:open-breakdown")); return; } rerender(); return; }
    if(k === "reload"){ loadScript(sid || hub.scriptIds(p)[0], true); return; }
    if(k === "csv"){ const m = model(); if(m) download(((hub.scriptTitle(sid) || "breakdown") + " - breakdown.csv").replace(/[\\/:*?"<>|]/g, "-"), E.csv(m)); return; }
    if(k === "rpby"){ S.rpBy = a.dataset.v; rerender(); return; }
    if(k === "print"){ window.print(); return; }
    if(k === "dismissnote"){ lsSet(NOTE_KEY, "1"); rerender(); return; }
    if(k === "cat"){ S.cat = a.dataset.c; rerender(); return; }
    if(k === "undo" || k === "redo"){ stepHist(pid, sid, k === "undo"); return; }
    if(!can) return;
    if(k === "add"){ S.adding = { sk: a.dataset.sk, cat: a.dataset.c }; rerender(); setTimeout(() => { const i = box.querySelector("#bdAdd"); if(i) i.focus(); }, 30); return; }
    if(k === "addcancel"){ S.adding = null; rerender(); return; }
    if(k === "qadd"){ quickAdd(box, a.dataset.sk, ed); return; }
    if(k === "addok"){ commitAdd(box, a.dataset.sk, a.dataset.c, ed); return; }
    if(k === "rm"){ const sk = a.dataset.sk, key = a.dataset.k; ed((st) => E.untag(st, sk, key)); return; }
    if(k === "hero"){ const key = a.dataset.k, on = a.dataset.on === "1"; ed((st) => E.setHero(st, key, on)); return; }
    if(k === "edit"){ S.edit = a.dataset.k; S.view = "elements"; lsSet(VIEW_KEY, S.view); S.cat = "all"; rerender(); setTimeout(() => { const i = box.querySelector("#edName"); if(i){ i.focus(); i.select(); i.scrollIntoView({ block: "nearest" }); } }, 30); return; }
    if(k === "edcancel"){ S.edit = null; rerender(); return; }
    if(k === "edsave"){
      const key = a.dataset.k, name = (box.querySelector("#edName") || {}).value, cat = (box.querySelector("#edCat") || {}).value, note = (box.querySelector("#edNote") || {}).value;
      if(!String(name || "").trim()){ hub.toast("Give it a name.", "err", 1800); return; }
      let nk = key;
      ed((st) => { let s2 = E.rename(st, key, cat, name); nk = E.key(cat, name); s2 = E.setNote(s2, nk, note); return s2; });
      S.edit = null; return;
    }
    if(k === "edmerge"){
      const key = a.dataset.k, into = (box.querySelector("#edMerge") || {}).value;
      if(!into){ hub.toast("Choose what to merge it into.", "err", 1800); return; }
      ed((st) => E.merge(st, [key], into)); S.edit = null;
      hub.toast("Merged.", "ok", 1500); return;
    }
    if(k === "eddrop"){
      const key = a.dataset.k, m = model(), e = m && m.elements[key];
      hub.confirm("Ignore " + (e ? e.name : "this element") + "?", "It comes out of every scene. You can bring it back from the Ignored list.", "Ignore", false).then((ok) => { if(ok){ ed((st) => E.drop(st, key)); S.edit = null; } });
      return;
    }
    if(k === "undrop"){ const key = a.dataset.k; ed((st) => E.undrop(st, key)); return; }
  };
  box.onchange = (ev) => {
    const t = ev.target;
    if(t.id === "bdJump"){ S.sel = Number(t.value) || 1; S.adding = null; rerender(); return; }
    if(t.id === "bdShowText"){ S.showText = t.checked; lsSet("Camp_BD_TEXT_V1", t.checked ? "1" : "0"); rerender(); return; }
    if(t.id === "bdShowEmpty"){ S.showEmpty = t.checked; lsSet("Camp_BD_EMPTY_V1", t.checked ? "1" : "0"); rerender(); return; }
    if(t.id === "bdQCat"){ S.qCat = t.value; lsSet("Camp_BD_QCAT_V1", t.value); t.style.setProperty("--cc", (E.CAT[t.value] || {}).color || "#888"); const i = box.querySelector("#bdQuick"); if(i) i.focus(); return; }
    if(t.dataset && t.dataset.a === "script"){ S.scriptPick[pid] = t.value; S.model = null; loadScript(t.value); rerender(); return; }
    if(!can) return;
    const sk = (model() && model().scenes[S.sel - 1] || {}).key; if(!sk) return;
    if(t.id === "shSyn"){ const cur = model().scenes[S.sel - 1], v = t.value.trim(); edit(pid, sid, (st) => E.setScene(st, sk, "syn", cur && cur.synAuto && v === cur.syn ? "" : v), true); }
    else if(t.id === "shNote") edit(pid, sid, (st) => E.setScene(st, sk, "note", t.value), true);
    else if(t.id === "shDir") edit(pid, sid, (st) => E.setScene(st, sk, "dir", t.value), true);
    else if(t.id === "shDay"){ edit(pid, sid, (st) => E.setScene(st, sk, "day", t.value.trim())); }
    else if(t.id === "shEst"){ edit(pid, sid, (st) => E.setScene(st, sk, "est", t.value)); }
    else if(t.id === "shUnit"){ edit(pid, sid, (st) => E.setScene(st, sk, "unit", t.value === "Main" ? "" : t.value)); }
  };
  // Stripboard drag: hand the move to the Plan panel (same save, undo and feedback as dragging on the Plan)
  box.ondragstart = (e) => {
    const st = e.target.closest && e.target.closest(".stp[data-sid]"); if(!st) return;
    S.sdrag = st.dataset.sid; e.dataTransfer.effectAllowed = "move";
    try{ e.dataTransfer.setData("text/plain", S.sdrag); }catch(_e){}
    setTimeout(() => st.classList.add("dragging"), 0);
  };
  const clearDrop = () => box.querySelectorAll(".dropBefore, .dropEnd").forEach((x) => x.classList.remove("dropBefore", "dropEnd"));
  box.ondragend = () => { S.sdrag = null; clearDrop(); box.querySelectorAll(".stp.dragging").forEach((x) => x.classList.remove("dragging")); };
  box.ondragover = (e) => {
    if(!S.sdrag) return;
    const t = e.target.closest && (e.target.closest(".stp[data-sid]") || e.target.closest("[data-dropday]")); if(!t) return;
    e.preventDefault(); e.dataTransfer.dropEffect = "move";
    if(t.classList.contains(t.dataset.sid ? "dropBefore" : "dropEnd")) return;
    clearDrop(); t.classList.add(t.dataset.sid ? "dropBefore" : "dropEnd");
  };
  box.ondrop = (e) => {
    const id = S.sdrag; if(!id) return;
    const t = e.target.closest && (e.target.closest(".stp[data-sid]") || e.target.closest("[data-dropday]"));
    S.sdrag = null; clearDrop(); if(!t) return;
    e.preventDefault();
    const toDay = Number(t.dataset.sid ? t.dataset.day : t.dataset.dropday), before = t.dataset.sid && t.dataset.sid !== id ? t.dataset.sid : null;
    if(t.dataset.sid === id) return;                     // dropped on itself
    if(!isFinite(toDay)) return;
    if(window.CampProdPanel.moveSceneBefore(pid, id, toDay, before)) rerender();
  };
  // Words picked in the scene text go into the quick-add box (and are kept as the tag's quote)
  box.onmouseup = () => {
    if(!can) return;
    const sel = window.getSelection(), t = sel && String(sel).replace(/\s+/g, " ").trim();
    if(!t || t.length > 60) return;
    const a = sel.anchorNode, el = a && (a.nodeType === 1 ? a : a.parentElement);
    if(!el || !el.closest || !el.closest(".shText")) return;
    const i = box.querySelector("#bdQuick"); if(!i) return;
    const name = t.replace(/^[^A-Za-z0-9À-ɏ]+|[^A-Za-z0-9À-ɏ]+$/g, "");
    if(!name) return;
    i.value = /[A-Z]/.test(name) && name === name.toUpperCase() ? name.charAt(0) + name.slice(1).toLowerCase() : name;   // "LANTERN" -> "Lantern"
    S.qQuote = t;
    i.dispatchEvent(new Event("input", { bubbles: true }));
    i.focus(); i.select();
  };
  box.oninput = (ev) => {
    // picking a name the project already uses sets its category
    if(ev.target.id === "bdQuick" && !ev.target.value.trim()) S.qQuote = "";
    if(ev.target.id === "bdQuick"){ const m = model(), v = ev.target.value.trim().toLowerCase(), hit = m && Object.keys(m.elements).find((k) => m.elements[k].name.toLowerCase() === v), sel = box.querySelector("#bdQCat"); if(hit && sel && sel.value !== m.elements[hit].cat){ sel.value = m.elements[hit].cat; S.qCat = sel.value; sel.style.setProperty("--cc", E.CAT[sel.value].color); } return; }
    if(ev.target.id === "bdScQ"){ S.scQ = ev.target.value; const pos = ev.target.selectionStart; rerender(); setTimeout(() => { const i = box.querySelector("#bdScQ"); if(i){ i.focus(); try{ i.setSelectionRange(pos, pos); }catch(_e){} } }, 40); return; }
    if(ev.target.id === "bdQ"){ S.q = ev.target.value; const pos = ev.target.selectionStart; rerender(); setTimeout(() => { const i = box.querySelector("#bdQ"); if(i){ i.focus(); try{ i.setSelectionRange(pos, pos); }catch(_e){} } }, 40); } };
  box.onkeydown = (ev) => {
    if(ev.key === "Enter" && ev.target.id === "bdQuick"){ ev.preventDefault(); const b2 = box.querySelector("[data-a=qadd]"); if(b2) quickAdd(box, b2.dataset.sk, ed); }
    else if(ev.key === "Enter" && ev.target.id === "bdAdd" && S.adding){ ev.preventDefault(); commitAdd(box, S.adding.sk, S.adding.cat, ed); }
    else if(ev.key === "Escape" && (S.adding || S.edit)){ S.adding = null; S.edit = null; rerender(); }
    else if(ev.key === "Enter" && ev.target.id === "edName"){ const b = box.querySelector("[data-a=edsave]"); if(b) b.click(); }
  };
}
// The quick-add box: same tag call as the per-category "+", so it's shared with the team the same way
function quickAdd(box, sk, ed){
  const i = box.querySelector("#bdQuick"), sel = box.querySelector("#bdQCat"), name = i ? i.value.trim() : "", cat = sel ? sel.value : S.qCat;
  if(!name){ H().toast("Type a name first.", "err", 1600); if(i) i.focus(); return; }
  if(!E.CAT[cat]) return;
  S.qCat = cat; lsSet("Camp_BD_QCAT_V1", cat);
  const quote = S.qQuote; S.qQuote = "";
  ed((st) => E.tag(st, sk, cat, name, quote));
  setTimeout(() => { const j = box.querySelector("#bdQuick"); if(j) j.focus(); }, 60);
}
function commitAdd(box, sk, cat, ed){
  const i = box.querySelector("#bdAdd"), name = i ? i.value.trim() : "";
  if(!name){ H().toast("Type a name first.", "err", 1600); return; }
  S.adding = null; ed((st) => E.tag(st, sk, cat, name));
}

// J / K: next / previous scene on the Sheets view (skips scenes hidden by the filter)
document.addEventListener("keydown", (e) => {
  if(!S.on || S.lock || !S.model || e.ctrlKey || e.metaKey || e.altKey) return;
  if((S.view === "strips" ? "sheets" : S.view) !== "sheets" || (e.key !== "j" && e.key !== "k")) return;
  if(e.target.closest && e.target.closest("input, select, textarea, [contenteditable=true]")) return;
  if(document.querySelector(".shade")) return;
  const shown = S.model.scenes.filter(scMatch), i = shown.findIndex((x) => x.n === S.sel), t = shown[i + (e.key === "j" ? 1 : -1)];
  if(t){ e.preventDefault(); S.sel = t.n; S.adding = null; rerender(); }
});
// Ctrl/Cmd+Z while the breakdown is showing
document.addEventListener("keydown", (e) => {
  if(!S.on || !S.pid || !(e.ctrlKey || e.metaKey)) return;
  if(e.target.closest && e.target.closest("input, select, textarea, [contenteditable=true]")) return;
  if(document.querySelector(".shade")) return;
  const k = e.key.toLowerCase();
  if(k === "z" || k === "y"){ e.preventDefault(); stepHist(S.pid, S.sid, k === "z" && !e.shiftKey); }
});

// Tags made in the editor (another tab) arrive through localStorage
window.addEventListener("storage", (e) => {
  if(!e.key || !/^Camp_BD_(V1|PENDING_V1|UNSYNCED_V1)_/.test(e.key)) return;
  S.seen = {};                                                         // look again (and upload the editor's tags)
  Object.keys(S.share).forEach((k) => { if(S.share[k] === "off" || S.share[k] === "denied") delete S.stores[k]; });   // no team copy: read this device's again
  S.model = null; rerender();
});
function setMode(on, lock){ on = !!on; lock = on && lock ? lock : null; if(on === S.on && lock === (S.lock || null)) return; S.on = on; S.lock = lock; if(on){ S.edit = null; S.adding = null; S.seen = {}; S.model = null; } rerender(); const box = document.getElementById("bdctl"); if(box) box.className = on ? "on" : ""; }
window.CampBdPanel = { enriched, payload, render: (pid) => { S.pid = pid; if(S.on) render(pid); }, setMode, reloadScript: (id) => loadScript(id, true) };
})();
