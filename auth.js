window.__ensureGoogleUser = async function(auth, fb){
  const first = await new Promise(r => { const u = auth.onAuthStateChanged(x => { u(); r(x); }); });
  if(first && !first.isAnonymous) return { user: first };
  const provider = new fb.auth.GoogleAuthProvider();
  const key = auth.app && auth.app.options && auth.app.options.apiKey;
  const fin = async (go) => { try{ return await go(); }catch(e){ if(e.code === "auth/credential-already-in-use" && e.credential) return await auth.signInWithCredential(e.credential); throw e; } };
  const popup = () => fin(() => first ? first.linkWithPopup(provider) : auth.signInWithPopup(provider));
  if(!window.CampSignIn || !key) return popup();
  return window.CampSignIn.run(key, { popup, withToken: (tok) => { const cred = fb.auth.GoogleAuthProvider.credential(null, tok); return fin(() => first ? first.linkWithCredential(cred) : auth.signInWithCredential(cred)); } });
};
