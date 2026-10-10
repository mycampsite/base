/* signin.js: Google sign-in that works in any browser (private windows, iPhone Firefox/Safari, in-app browsers).
   Firebase's own pop-up loses its state in browsers that partition storage, and Google then shows
   "The requested action is invalid". This asks Google directly for a token in a pop-up that talks straight back
   to the page, then hands that token to Firebase. If that isn't available it falls back to Firebase's pop-up. */
(function(){
  const LS = "camp.gClientId";
  const lsGet = (k) => { try{ return localStorage.getItem(k) || ""; }catch(_e){ return ""; } };
  const lsSet = (k, v) => { try{ localStorage.setItem(k, v); }catch(_e){} };
  let gsi = null;
  function loadGsi(){
    if(window.google && window.google.accounts && window.google.accounts.oauth2) return Promise.resolve();
    if(gsi) return gsi;
    return (gsi = new Promise((ok, no) => {
      const s = document.createElement("script"); s.src = "https://accounts.google.com/gsi/client"; s.async = true;
      s.onload = () => ok(); s.onerror = () => { gsi = null; no(new Error("Google sign-in couldn't load")); };
      document.head.appendChild(s);
    }));
  }
  // The Google OAuth client Firebase already uses for this project, read from Firebase itself
  async function clientId(apiKey){
    const saved = lsGet(LS); if(saved) return saved;
    const r = await fetch("https://identitytoolkit.googleapis.com/v1/accounts:createAuthUri?key=" + encodeURIComponent(apiKey), {
      method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify({ providerId:"google.com", continueUri: location.origin + "/" })
    });
    const j = await r.json(), uri = j && j.authUri;
    const id = uri ? new URL(uri).searchParams.get("client_id") : "";
    if(!id) throw new Error("No Google client id");
    lsSet(LS, id); return id;
  }
  // Must be called from a click (it opens a pop-up). Resolves to a Google access token.
  async function googleToken(apiKey){
    const id = await clientId(apiKey);
    await loadGsi();
    return new Promise((ok, no) => {
      let done = false;
      const tc = window.google.accounts.oauth2.initTokenClient({
        client_id: id, scope: "openid email profile",
        callback: (r) => { done = true; r && r.access_token ? ok(r.access_token) : no(Object.assign(new Error((r && (r.error_description || r.error)) || "Sign-in failed"), { code:"camp/token" })); },
        error_callback: (e) => { if(done) return; done = true; no(Object.assign(new Error((e && e.type) || "Sign-in was closed"), { code: e && e.type === "popup_closed" ? "auth/popup-closed-by-user" : "camp/popup" })); }
      });
      tc.requestAccessToken({ prompt: "select_account" });
    });
  }
  window.CampSignIn = {
    googleToken,
    // Same as the old sign-in, with the new route first. `ops` carries the Firebase calls so it works with both SDK styles.
    async run(apiKey, ops){
      let token = "";
      try{ token = await googleToken(apiKey); }
      catch(e){
        // closed after this route has worked before = they cancelled. Closed on a first try may be Google refusing this
        // site's address (not added to the Google client yet), so let Firebase's pop-up have a go rather than lock them out.
        if(e && e.code === "auth/popup-closed-by-user" && lsGet("camp.gOk")) throw e;
        console.warn("Direct Google sign-in unavailable, using Firebase's pop-up:", e && e.message);
        return ops.popup();
      }
      lsSet("camp.gOk", "1");
      return ops.withToken(token);
    }
  };
})();
