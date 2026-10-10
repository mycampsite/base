/* Camp: small shared behaviours for every page. Load with defer. */
(function () {
  "use strict";
  var d = document, n = navigator;

  // iPhone / iPad zoom the whole page in when you tap a text box whose text is under 16px, and don't zoom back out.
  // maximum-scale=1 stops that jump; iOS still lets you pinch-zoom. (Not added elsewhere: Android would block pinch.)
  var iOS = /iP(hone|ad|od)/.test(n.userAgent) || (n.platform === "MacIntel" && n.maxTouchPoints > 1);
  if (iOS) {
    var vp = d.querySelector('meta[name="viewport"]');
    if (vp && !/maximum-scale/.test(vp.content)) vp.content += ", maximum-scale=1";
  }

  // Camp's own pop-ups instead of the browser's: CampUI.confirm / alert / prompt return Promises.
  // window.alert is replaced too (it never needed an answer), so every old alert matches the site.
  function modal(o) {
    return new Promise(function (resolve) {
      var prev = d.activeElement, shade = d.createElement("div");
      shade.className = "campDlgShade";
      shade.innerHTML = '<form class="campDlg" role="dialog" aria-modal="true"><h2></h2><p></p>' +
        (o.input != null ? '<input class="campDlgIn" type="text" autocomplete="off">' : "") +
        '<div class="campDlgBtns">' + (o.cancel ? '<button type="button" class="campDlgNo"></button>' : "") + '<button type="submit" class="campDlgOk"></button></div></form>';
      var f = shade.firstChild, inp = f.querySelector(".campDlgIn");
      f.querySelector("h2").textContent = o.title || "";
      var body = f.querySelector("p"); if (o.text) body.textContent = o.text; else body.remove();
      var ok = f.querySelector(".campDlgOk"); ok.textContent = o.ok || "OK"; if (o.danger) ok.classList.add("danger");
      var no = f.querySelector(".campDlgNo"); if (no) no.textContent = o.cancel;
      if (inp) inp.value = o.input || "";
      function done(v) { d.removeEventListener("keydown", onKey, true); shade.remove(); try { prev && prev.focus && prev.focus({ preventScroll: true }); } catch (_e) {} resolve(v); }
      function onKey(e) { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); done(o.cancel ? (inp ? null : false) : true); } }
      f.onsubmit = function (e) { e.preventDefault(); done(inp ? inp.value : true); };
      if (no) no.onclick = function () { done(inp ? null : false); };
      shade.addEventListener("pointerdown", function (e) { if (e.target === shade) done(o.cancel ? (inp ? null : false) : true); });
      d.addEventListener("keydown", onKey, true);
      d.body.appendChild(shade);
      setTimeout(function () { (inp || ok).focus(); if (inp) inp.select(); }, 20);
    });
  }
  // A message written for the old pop-ups ("Title?\n\nDetails") splits into a heading and the text under it
  function split(msg) { msg = String(msg == null ? "" : msg); var i = msg.indexOf("\n\n"); return i > 0 ? { title: msg.slice(0, i), text: msg.slice(i + 2) } : msg.length < 70 ? { title: msg, text: "" } : { title: "", text: msg }; }
  window.CampUI = {
    confirm: function (msg, okLabel, danger) { var s = split(msg); return modal({ title: s.title, text: s.text, ok: okLabel || "OK", cancel: "Cancel", danger: !!danger }); },
    alert: function (msg) { var s = split(msg); return modal({ title: s.title, text: s.text, ok: "OK" }); },
    prompt: function (msg, value) { var s = split(msg); return modal({ title: s.title, text: s.text, ok: "OK", cancel: "Cancel", input: value == null ? "" : String(value) }); }
  };
  window.alert = function (msg) { window.CampUI.alert(msg); };

  // Offline notice. Pages that already show this in their own save status opt out with <body data-own-offline>.
  if (d.body && d.body.hasAttribute("data-own-offline")) return;
  var el = null, hideT = 0;
  function show(online) {
    if (!el) {
      el = d.createElement("div"); el.className = "campOffline"; el.setAttribute("role", "status");
      el.innerHTML = "<i></i><span></span>"; d.body.appendChild(el);
    }
    clearTimeout(hideT);
    el.classList.toggle("back", online);
    el.lastChild.textContent = online ? "Back online" : "You're offline. Changes won't save until you're back online.";
    void el.offsetWidth; el.classList.add("on");
    if (online) hideT = setTimeout(function () { el.classList.remove("on"); }, 2200);
  }
  window.addEventListener("offline", function () { show(false); });
  window.addEventListener("online", function () { if (el && el.classList.contains("on")) show(true); });
  if (n.onLine === false) show(false);
})();
