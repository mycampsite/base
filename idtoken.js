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

  // Google sign-in for the script cloud, shown when it says "not allowed" (it only lets in whitelisted Google accounts).
  // refused = the cloud already turned down whoever is signed in. Resolves true once a Google account is signed in.
  async function googleSignIn(auth){
    const fb = window.firebase, first = auth.currentUser, anon = !!(first && first.isAnonymous);
    const fin = async (go) => { try{ return await go(); }catch(e){ if(e && e.code === "auth/credential-already-in-use" && e.credential) return auth.signInWithCredential(e.credential); throw e; } };
    const provider = new fb.auth.GoogleAuthProvider(); provider.setCustomParameters({ prompt:"select_account" });
    const popup = () => fin(() => anon ? first.linkWithPopup(provider) : auth.signInWithPopup(provider));
    const withToken = (tok) => { const cred = fb.auth.GoogleAuthProvider.credential(null, tok); return fin(() => anon ? first.linkWithCredential(cred) : auth.signInWithCredential(cred)); };
    const key = auth.app && auth.app.options && auth.app.options.apiKey;
    return window.CampSignIn && key ? window.CampSignIn.run(key, { popup, withToken }) : popup();
  }
  const escH = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]));
  let asking = null;
  window.campSignIn = function(refused){
    if(asking) return asking;
    asking = (async () => {
      const auth = await within(start(), 8000);
      if(!auth) return false;
      const u = auth.currentUser, who = u && !u.isAnonymous ? (u.email || "This account") : "";
      if(who) refused = true;   // their sign-in already went with the request, so the cloud turned this account down
      return await new Promise((resolve) => {
        const shade = document.createElement("div");
        shade.style.cssText = "position:fixed;inset:0;z-index:100000;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;padding:16px";
        const btn = "height:38px;padding:0 14px;border-radius:10px;font:inherit;cursor:pointer;";
        shade.innerHTML = `<div role="dialog" aria-label="Sign in" style="width:min(420px,100%);background:#1a1b1f;color:rgba(255,255,255,.92);border:1px solid rgba(255,255,255,.18);border-radius:14px;padding:20px;box-shadow:0 24px 60px rgba(0,0,0,.5);font:14px/1.45 system-ui,sans-serif">
          <div style="font-size:17px;font-weight:600;margin-bottom:6px">${refused && who ? "This account can't open scripts" : "Sign in to Camp"}</div>
          <div style="color:rgba(255,255,255,.65);font-size:13px">${refused && who ? `<b>${escH(who)}</b> isn't on Camp's list. Ask the person who runs Camp to add it, or use another Google account.` : "Sign in with your Google account to open your scripts."}</div>
          <div data-msg style="min-height:18px;margin-top:10px;font-size:12.5px;color:#ff7b72"></div>
          <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:10px">
            <button data-no type="button" style="${btn}border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.06);color:inherit">Cancel</button>
            <button data-ok type="button" style="${btn}border:1px solid #ececf0;background:#ececf0;color:#111;font-weight:600">${refused && who ? "Use another account" : "Sign in with Google"}</button>
          </div></div>`;
        document.body.appendChild(shade);
        const done = (ok) => { shade.remove(); resolve(ok); };
        shade.querySelector("[data-no]").onclick = () => done(false);
        shade.addEventListener("keydown", (e) => { e.stopPropagation(); if(e.key === "Escape") done(false); });
        shade.querySelector("[data-ok]").onclick = async () => {
          const msg = shade.querySelector("[data-msg]"); msg.textContent = "";
          try{
            await googleSignIn(auth);
            const nu = auth.currentUser;
            if(nu && !nu.isAnonymous){ cur = ""; await window.campIdToken(); done(true); }
          }catch(e){ msg.textContent = e && e.code === "auth/popup-closed-by-user" ? "Sign-in was closed." : "Couldn't sign in: " + ((e && e.message) || "try again"); }
        };
        setTimeout(() => { try{ shade.querySelector("[data-ok]").focus(); }catch(_e){} }, 30);
      });
    })().finally(() => { asking = null; });
    return asking;
  };
  // Sign this device out of Google/Camp (the Library's "Sign out on this device")
  window.campSignOut = async function(){ try{ const auth = await within(start(), 4000); if(auth) await auth.signOut(); }catch(_e){} cur = ""; };
  start(); window.campIdToken();

  // ---- Is this page the one that was published? ----
  // GitHub Pages can keep a page in the browser for about ten minutes, so someone can be looking at yesterday's
  // Camp without knowing it. Each deploy stamps the pages and version.json with the same build; when the two
  // differ, this says so and offers a reload. It never reloads on its own — that would throw away what
  // someone is in the middle of typing.
  (function buildWatch(){
    const meta = document.querySelector('meta[name="camp-build"]');
    const mine = meta && meta.content;
    if(!mine || mine === "__BUILD__") return;   // a copy that was never deployed (someone's own machine)
    let shown = false, last = 0;
    const show = function(){
      if(shown) return; shown = true;
      const bar = document.createElement("div");
      bar.style.cssText = "position:fixed;right:14px;bottom:14px;z-index:2147483000;display:flex;align-items:center;gap:10px;" +
        "background:#1a1b1f;color:rgba(255,255,255,.92);border:1px solid rgba(255,255,255,.18);border-radius:11px;" +
        "padding:9px 11px;box-shadow:0 14px 40px rgba(0,0,0,.5);font:13px/1.3 Inter,system-ui,sans-serif;";
      const txt = document.createElement("span"); txt.textContent = "Camp has been updated.";
      const go = document.createElement("button"); go.type = "button"; go.textContent = "Reload";
      go.style.cssText = "font:inherit;font-weight:600;color:inherit;background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.2);border-radius:8px;padding:4px 10px;cursor:pointer;";
      go.onclick = function(){ location.reload(); };
      const no = document.createElement("button"); no.type = "button"; no.textContent = "✕"; no.setAttribute("aria-label", "Dismiss");
      no.style.cssText = "font:inherit;color:rgba(255,255,255,.6);background:none;border:0;cursor:pointer;padding:2px 4px;";
      no.onclick = function(){ bar.remove(); };
      bar.appendChild(txt); bar.appendChild(go); bar.appendChild(no);
      (document.body || document.documentElement).appendChild(bar);
    };
    const check = async function(){
      if(shown || Date.now() - last < 120000) return;
      last = Date.now();
      try{
        const r = await fetch("version.json?_=" + Date.now(), { cache: "no-store" });
        if(!r.ok) return;
        const j = await r.json();
        if(j && j.build && j.build !== "__BUILD__" && j.build !== mine) show();
      }catch(_e){}
    };
    setTimeout(check, 4000);
    document.addEventListener("visibilitychange", function(){ if(!document.hidden) check(); });
  })();
})();
