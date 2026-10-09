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
