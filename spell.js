/* Camp Australian-English spellcheck: own dictionary (en_AU hunspell via Typo.js), wavy underline via CSS Custom Highlight API. */
(function(){
  "use strict";
  var ed = document.getElementById("scriptEditor");
  var canHL = typeof CSS !== "undefined" && CSS.highlights && typeof Highlight === "function";
  if(!ed || !canHL) return;                      // no support: leave the browser's own spellcheck alone
  var KEY = "SCRIPTY_PROOF_USER_WORDS_V1", OFFKEY = "Camp_SPELL_OFF_V1";
  var typo = null, loading = false, timer = 0, misses = [];   // misses: [{r:Range, w:String}]
  var cache = new Map();
  var style = document.createElement("style");
  style.textContent = "::highlight(camp-spell){ text-decoration: underline wavy #e5484d; text-decoration-thickness:1px; text-underline-offset:2px; } @media print{ ::highlight(camp-spell){ text-decoration:none; } }";
  document.head.appendChild(style);

  function userWords(){
    try{ var a = JSON.parse(localStorage.getItem(KEY) || "[]"); if(Array.isArray(a)) return new Set(a.map(function(x){ return String(x).toLowerCase(); })); if(a && Array.isArray(a.words)) return new Set(a.words.map(function(x){ return String(x).toLowerCase(); })); }catch(e){}
    return new Set();
  }
  function saveUser(set){ try{ localStorage.setItem(KEY, JSON.stringify(Array.from(set))); }catch(e){} }
  function isOff(){ try{ return localStorage.getItem(OFFKEY) === "1"; }catch(e){ return false; } }

  function load(cb){
    if(typo) return cb();
    if(loading) return;
    loading = true;
    Promise.all([ensureTypo(), fetch("spell/en_AU.aff").then(function(r){ return r.text(); }), fetch("spell/en_AU.dic").then(function(r){ return r.text(); })])
      .then(function(a){ typo = new window.Typo("en_AU", a[1], a[2]); cb(); })
      .catch(function(){ loading = false; });
  }
  function ensureTypo(){
    if(window.Typo) return Promise.resolve();
    return new Promise(function(res, rej){ var s = document.createElement("script"); s.src = "spell/typo.js"; s.onload = res; s.onerror = rej; document.head.appendChild(s); });
  }

  window.CampSpell = window.CampSpell || {};
  var user = userWords();
  function ok(w){
    var k = w.toLowerCase();
    if(user.has(k)) return true;
    var c = cache.get(w); if(c !== undefined) return c;
    var r = typo.check(w) || typo.check(w.toLowerCase()) || /^[A-Z]{2,}$/.test(w);
    if(!r && /['’]/.test(w)) r = typo.check(w.replace(/’/g, "'"));
    cache.set(w, r); return r;
  }

  var WORD = /[A-Za-z][A-Za-z'’]*[A-Za-z]|[A-Za-z]/g;
  function skip(node){
    var el = node.parentElement;
    if(!el) return true;
    var line = el.closest(".line"); if(!line || !ed.contains(line)) return true;
    for(var e = el; e && e !== line; e = e.parentElement){ if(e.classList.contains("nm") || e.getAttribute("spellcheck") === "false") return true; }
    var t = line.dataset.type; return t === "character" || t === "scene" || t === "transition";
  }
  function scan(){
    if(!typo || isOff()){ CSS.highlights.delete("camp-spell"); misses = []; return; }
    var out = [], w = document.createTreeWalker(ed, NodeFilter.SHOW_TEXT, null), n;
    while((n = w.nextNode())){
      var t = n.nodeValue; if(!t || skip(n)) continue;
      var m; WORD.lastIndex = 0;
      while((m = WORD.exec(t))){
        var word = m[0];
        if(word.length < 2 || ok(word)) continue;
        // skip words glued to digits (e.g. 3rd, 2pm)
        var nx = t.charAt(m.index + word.length); if(/\d/.test(nx)) continue;
        var r = document.createRange(); r.setStart(n, m.index); r.setEnd(n, m.index + word.length);
        out.push({ r: r, w: word });
      }
    }
    misses = out;
    if(out.length) CSS.highlights.set("camp-spell", new Highlight(...out.map(function(x){ return x.r; })));
    else CSS.highlights.delete("camp-spell");
  }
  function later(){ clearTimeout(timer); timer = setTimeout(function(){ load(scan); }, 600); }

  // Turn the browser's own spellcheck off for the script so only this one speaks (re-asserted if anything flips it).
  function force(){ if(ed.getAttribute("spellcheck") !== "false") ed.setAttribute("spellcheck", "false"); }
  force();
  new MutationObserver(force).observe(ed, { attributes: true, attributeFilter: ["spellcheck"] });
  new MutationObserver(later).observe(ed, { childList: true, subtree: true, characterData: true });
  window.addEventListener("storage", function(e){ if(e.key === KEY){ user = userWords(); cache.clear(); later(); } });
  load(scan);

  function wordAt(x, y){
    var pos = document.caretPositionFromPoint ? document.caretPositionFromPoint(x, y) : null;
    var node, off;
    if(pos){ node = pos.offsetNode; off = pos.offset; }
    else if(document.caretRangeFromPoint){ var r = document.caretRangeFromPoint(x, y); if(r){ node = r.startContainer; off = r.startOffset; } }
    if(!node) return null;
    for(var i = 0; i < misses.length; i++){
      var m = misses[i].r;
      if(m.startContainer === node && off >= m.startOffset && off <= m.endOffset) return misses[i];
    }
    return null;
  }
  function suggest(w){ try{ return typo.suggest(w, 5) || []; }catch(e){ return []; } }

  Object.assign(window.CampSpell, {
    hit: function(x, y){ return typo ? wordAt(x, y) : null; },
    suggest: suggest,
    replace: function(hit, text){
      var sel = getSelection(); sel.removeAllRanges(); sel.addRange(hit.r);
      ed.focus(); document.execCommand("insertText", false, text);
    },
    add: function(w){ user.add(w.toLowerCase()); saveUser(user); cache.clear(); scan(); },
    ignore: function(w){ user.add(w.toLowerCase()); cache.clear(); scan(); },   // this session only
    refresh: later
  });
})();
