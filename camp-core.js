/* camp-core.js — shared route/config/API/password helpers for camp pages.
   Exposes window.camp. Load with <script src="camp-core.js"></script> before the page script. */
(function(){
  "use strict";

  function route(){
    const qs = new URLSearchParams(location.search);
    return { fileId: String(qs.get("fileId") || qs.get("id") || ""), pid: String(qs.get("pid") || ""), cloud: String(qs.get("cloud") || "") };
  }
  function normalizeEndpoint(u){ return String(u||"").trim().replace(/\s+/g,"").replace(/\/+$/,""); }
  const CLOUD_ENDPOINT_KEYS = ["SCRIPTY_CLOUD_ENDPOINT_V1","SCRIPTY_CLOUD_ENDPOINT","SCRIPTY_CLOUD_URL","CLOUD_ENDPOINT","SCRIPTY_GAS_ENDPOINT","SCRIPTY_CLOUD_ENDPOINT_V0"];
  const CLOUD_KEY_KEY = "SCRIPTY_CLOUD_KEY_V1";

  let __CONFIG = null;
  async function loadConfig_(){
    if(__CONFIG) return __CONFIG;
    try{
      const r = await fetch("config.json?_=" + Date.now(), { cache:"no-store" });
      if(r.ok) __CONFIG = await r.json();
    }catch(_e){}
    __CONFIG = __CONFIG || {};
    return __CONFIG;
  }
  async function getCloudEndpoint(){
    const r = route();
    for(const k of CLOUD_ENDPOINT_KEYS){ const v = localStorage.getItem(k); if(v) return normalizeEndpoint(v); }
    const cfg = await loadConfig_();
    return normalizeEndpoint(cfg.cloudUrl || cfg.cloudURL || cfg.cloud || cfg.endpoint || "");
  }
  function getCloudKey(){ return String(localStorage.getItem(CLOUD_KEY_KEY) || ""); }
  function setCloudKey(v){ try{ localStorage.setItem(CLOUD_KEY_KEY, v); }catch(_e){} }
  function cloudParam(){ const r = route(); return r.cloud ? "&cloud=" + encodeURIComponent(r.cloud) : ""; }

  function escapeHtml(s){ return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }

  function loadScript(src){
    return new Promise((res, rej) => {
      if(document.querySelector(`script[src="${src}"]`)) return res();
      const s = document.createElement("script"); s.src = src; s.async = true;
      s.onload = () => res(); s.onerror = () => rej(new Error("Couldn't load " + String(src).split("/").pop()));
      document.head.appendChild(s);
    });
  }

  let __pwPromise = null;
  function askPassword(wasWrong){
    if(__pwPromise) return __pwPromise;
    __pwPromise = new Promise((resolve) => {
      const shade = document.createElement("div");
      shade.style.cssText = "position:fixed;inset:0;z-index:100001;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;padding:16px;";
      shade.innerHTML = `
        <div role="dialog" aria-label="Enter your password" style="width:min(420px,100%);background:#1a1b1f;color:rgba(255,255,255,.92);border:1px solid rgba(255,255,255,.18);border-radius:14px;padding:20px;box-shadow:0 24px 60px rgba(0,0,0,.6);font:14px/1.45 Inter,system-ui,sans-serif;">
          <div style="font-size:17px;font-weight:600;margin-bottom:4px">Enter the password</div>
          <div style="color:rgba(255,255,255,.6);font-size:13px;margin-bottom:14px">Same one you use in the script editor.</div>
          <input type="password" autocomplete="current-password" style="width:100%;height:40px;padding:0 12px;border-radius:9px;border:1px solid rgba(255,255,255,.2);background:rgba(0,0,0,.25);color:inherit;font:inherit;outline:none;box-sizing:border-box">
          <div data-msg style="min-height:18px;margin-top:10px;font-size:12.5px;color:#ff7b72">${wasWrong ? "That password didn't work. Try again." : ""}</div>
          <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px">
            <button data-ok type="button" style="height:38px;padding:0 16px;border-radius:10px;border:1px solid #ececf0;background:#ececf0;color:#111;font:inherit;font-weight:600;cursor:pointer">Unlock</button>
          </div>
        </div>`;
      document.body.appendChild(shade);
      const inp = shade.querySelector("input");
      shade.querySelector("[data-ok]").onclick = () => { const v = inp.value.trim(); if(!v){ inp.focus(); return; } setCloudKey(v); shade.remove(); __pwPromise = null; resolve(true); };
      inp.addEventListener("keydown", (e) => { if(e.key === "Enter") shade.querySelector("[data-ok]").click(); });
      setTimeout(() => inp.focus(), 30);
    });
    return __pwPromise;
  }

  // Both helpers always resolve (never throw): a dropped connection comes back as { ok:false, error }.
  async function fetchJson_(url, opts, ms){
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), ms || 30000);
    try{
      const r = await fetch(url, Object.assign({ cache:"no-store", signal: ctl.signal }, opts || {}));
      try{ return await r.json(); }catch(_e){ return { ok:false, error:"Drive's reply couldn't be read. Check the Apps Script is deployed." }; }
    }catch(err){
      return { ok:false, network:true, error: err && err.name === "AbortError" ? "Drive took too long to answer." : "Couldn't reach Drive. Check your connection." };
    }finally{ clearTimeout(t); }
  }
  const NO_CLOUD = "Cloud isn't set up. Open the Library and connect your Apps Script link first.";
  async function apiGet(action, params){
    const ep = await getCloudEndpoint();
    if(!ep) return { ok:false, error:NO_CLOUD };
    let key = getCloudKey();
    for(let tries = 0; tries < 2; tries++){
      const qs = new URLSearchParams(Object.assign({ action, key }, params || {}));
      const j = await fetchJson_(ep + "?" + qs.toString());
      if(j && j.auth === false){ await askPassword(tries > 0); key = getCloudKey(); continue; }
      return j;
    }
    return { ok:false, error:"That password didn't work." };
  }
  // ms: POST timeout in ms (default 60000; treatment.html passes 90000)
  async function apiPost(action, body, ms){
    const ep = await getCloudEndpoint();
    if(!ep) return { ok:false, error:NO_CLOUD };
    let key = getCloudKey();
    for(let tries = 0; tries < 2; tries++){
      const j = await fetchJson_(ep, { method:"POST", headers:{ "Content-Type":"text/plain;charset=UTF-8" }, body: JSON.stringify(Object.assign({ action, key }, body || {})) }, ms || 60000);
      if(j && j.auth === false){ await askPassword(tries > 0); key = getCloudKey(); continue; }
      return j;
    }
    return { ok:false, error:"That password didn't work." };
  }

  // Same logic as editor's auth.js. Reuses an existing Google session (no popup); otherwise
  // upgrades an anonymous user or opens the Google popup. Needs a user gesture only on first sign-in.
  async function ensureGoogleUser(auth, fb){
    const first = await new Promise(r => { const u = auth.onAuthStateChanged(x => { u(); r(x); }); });
    if(first && !first.isAnonymous) return { user: first };
    const provider = new fb.auth.GoogleAuthProvider();
    try{
      return first ? await first.linkWithPopup(provider) : await auth.signInWithPopup(provider);
    }catch(e){
      if(e.code === "auth/credential-already-in-use" && e.credential) return await auth.signInWithCredential(e.credential);
      throw e;
    }
  }
  // Asks the hub to refresh this script's room->project mapping. Never throws, waits at most 8s.
  async function roomAccess(auth, fileId){
    try{
      const cfg = await loadConfig_();
      const url = normalizeEndpoint(cfg.hubUrl || "");
      const user = auth && auth.currentUser;
      if(!url || !user || !fileId) return { linked:false };
      const idToken = await user.getIdToken();
      const out = await fetchJson_(url, { method:"POST", headers:{ "Content-Type":"text/plain;charset=UTF-8" },
        body: JSON.stringify({ idToken, action:"roomAccess", fileId }) }, 8000);
      return out && out.ok ? out.data : { linked:false };
    }catch(_e){ return { linked:false }; }
  }
   window.camp = { ensureGoogleUser, roomAccess, route, normalizeEndpoint, loadConfig_, getCloudEndpoint, getCloudKey, setCloudKey, cloudParam, escapeHtml, loadScript, askPassword, fetchJson_, apiGet, apiPost };
})();
