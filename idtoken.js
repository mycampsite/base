/* idtoken.js: the signed-in person's Google (Firebase) sign-in token, sent with every request to the script cloud
   so it can check who is asking against the whitelist.
     await campIdToken()  -> fresh token, or "" if nobody is signed in (never throws, waits at most ~5s)
     campIdTokenNow()     -> the last token seen, for code that can't wait
   On pages that already set up Firebase (editor, storyboard, treatment) it reuses that; elsewhere (library) it loads
   the Firebase sign-in scripts itself. The hub (index.html) uses the newer Firebase and defines these itself. */
(function(){
  "use strict";
  if(window.campIdToken) return;
  const SDK = "https://www.gstatic.com/firebasejs/10.12.2/";
  let cur = "", init = null;

  // Load a script once. A tag another loader added may still be downloading: wait for it.
  function load(src){
    return new Promise((ok, bad) => {
      const have = document.querySelector(`script[src="${src}"]`);
      if(have){
        if(have.dataset.loaded) return ok();
        have.addEventListener("load", () => ok()); have.addEventListener("error", () => bad(new Error("load")));
        return;
      }
      const s = document.createElement("script"); s.src = src; s.async = true;
      s.onload = () => { s.dataset.loaded = "1"; ok(); }; s.onerror = () => bad(new Error("load"));
      document.head.appendChild(s);
    });
  }
  async function firebaseCfg(){
    try{ const r = await fetch("config.json?_=" + Date.now(), { cache:"no-store" }); if(r.ok){ const j = await r.json(); if(j && j.firebase && j.firebase.apiKey) return j.firebase; } }catch(_e){}
    try{ const c = JSON.parse(localStorage.getItem("SCRIPTY_FIREBASE_V1") || "null"); if(c && c.apiKey) return c; }catch(_e){}
    return null;
  }
  // Resolves with Firebase Auth once it knows who (if anyone) is signed in on this site
  function start(){
    if(init) return init;
    init = (async () => {
      if(!(window.firebase && window.firebase.auth)){
        const cfg = await firebaseCfg(); if(!cfg) return null;
        await load(SDK + "firebase-app-compat.js"); await load(SDK + "firebase-auth-compat.js");
        if(!window.firebase.apps.length) window.firebase.initializeApp(cfg);
      }
      if(!window.firebase.apps.length){ const cfg = await firebaseCfg(); if(!cfg) return null; window.firebase.initializeApp(cfg); }
      const auth = window.firebase.auth();
      await new Promise((r) => { const u = auth.onAuthStateChanged(() => { u(); r(); }); });
      auth.onIdTokenChanged((u) => { if(!u || u.isAnonymous) cur = ""; });
      return auth;
    })().catch(() => null);
    return init;
  }
  const within = (p, ms) => Promise.race([p, new Promise((r) => setTimeout(() => r(null), ms))]);

  window.campIdToken = async function(){
    try{
      const auth = await within(start(), 4000);
      const u = auth && auth.currentUser;
      if(!u || u.isAnonymous){ cur = ""; return ""; }
      const t = await within(u.getIdToken(), 4000);   // refreshes by itself when close to expiring
      if(t) cur = t;
      return cur;
    }catch(_e){ return cur; }
  };
  window.campIdTokenNow = () => cur;
  start(); window.campIdToken();
})();
