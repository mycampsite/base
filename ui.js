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

  // Phone menu on the Script, Treatment and Storyboard pages: always a way back to the hub and the project list
  (function () {
    var menu = d.getElementById("navMenu");
    if (!menu || menu.querySelector("#mnHub")) return;
    var cloud = ""; try { var c = new URLSearchParams(location.search).get("cloud"); if (c) cloud = "cloud=" + encodeURIComponent(c); } catch (_e) {}
    var hub = d.createElement("a"); hub.id = "mnHub"; hub.textContent = "Hub"; hub.href = "index.html" + (cloud ? "?" + cloud : "");
    var pr = d.createElement("a"); pr.id = "mnProjects"; pr.textContent = "Projects"; pr.href = "index.html?projects=1" + (cloud ? "&" + cloud : "");
    menu.insertBefore(pr, menu.firstChild); menu.insertBefore(hub, pr);
  })();

  // The little hand-drawn tent that stands for each person working live (Treatment, Script editor). Each person gets a colour.
  window.CampTent = {
    colors: ["#7d8f4e", "#d4932a", "#5a86b8", "#84707c", "#c9633d", "#3f9a8c", "#9a5c8f", "#a98a5a"],
    names: ["Olive", "Amber", "Blue", "Mauve", "Terracotta", "Teal", "Plum", "Sand"],
    // Colours for everyone present (ids in join order): a colour someone picked for themselves comes first
    // (window.CampLook.chosen, read from look/<pid>), the rest are spread so two people don't share one.
    assign: function (ids) {
      var C = this.colors, ch = (window.CampLook && window.CampLook.chosen) || {}, used = {}, out = {};
      ids.forEach(function (id) { var c = String(ch[id] || "").toLowerCase(); if (C.indexOf(c) >= 0) { out[id] = c; used[c] = 1; } });
      ids.forEach(function (id) {
        if (out[id]) return;
        var h = 2166136261, s = String(id); for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
        var k = (h >>> 0) % C.length; for (var j = 0; j < C.length && used[C[k]]; j++) k = (k + 1) % C.length;
        used[C[k]] = 1; out[id] = C[k];
      });
      return out;
    },
    // Owners see the person's name (names/<pid> is readable by owners only); everyone else sees the colour's name
    who: function (uid, color) { var n = window.CampLook && window.CampLook.people && window.CampLook.people[uid]; return n ? String(n) : this.label("", color); },
    // Everyone is shown as their tent's colour ("Amber"), never by a typed name
    label: function (name, color) {
      var i = this.colors.indexOf(String(color || "").toLowerCase());
      return this.names[i >= 0 ? i : 0];
    },
    svg: function (color) {
      var c = /^#[0-9a-f]{6}$/i.test(color || "") ? color : "#7d8f4e";
      return '<svg viewBox="0 0 40 44" aria-hidden="true" focusable="false"><circle cx="20" cy="5" r="3.1" fill="' + c + '"/>' +
        '<path d="M20.4 12.2 L36.3 38.4 L3.9 38.9 Z" fill="' + c + '" stroke="#fff" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>' +
        '<path d="M20.6 14 C20 16 16 20 11.5 27 M26 25.5 C28 29 30.5 33.5 32.6 36.5" stroke="#fff" stroke-opacity=".28" stroke-width="2" fill="none" stroke-linecap="round"/>' +
        '<path d="M19.1 21.6 L25.3 38.4 L14.6 38.5 Z" fill="#141414" stroke="#fff" stroke-width="2" stroke-linejoin="round"/>' +
        '<path d="M1.8 40.6 Q20 41.7 38.4 40.4" stroke="#fff" stroke-width="2.4" fill="none" stroke-linecap="round"/></svg>';
    }
  };

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
