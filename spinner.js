/* COMPASS SPINNER: fills every .spin span with the compass (same size/markup), needle driven by one shared loop */
(function init(){
  if(!document.body){document.addEventListener("DOMContentLoaded",init);return;}
  var NS="http://www.w3.org/2000/svg";
  var defs=document.createElementNS(NS,"svg");
  defs.setAttribute("width","0");defs.setAttribute("height","0");defs.setAttribute("aria-hidden","true");defs.style.position="absolute";
  defs.innerHTML='<filter id="sp-fz" x="-10%" y="-10%" width="120%" height="120%"><feTurbulence id="sp-tbA" type="fractalNoise" baseFrequency="0.035" numOctaves="1" seed="2" result="a"/><feDisplacementMap in="SourceGraphic" in2="a" scale="1.8" result="d0"/><feTurbulence id="sp-tbB" type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed="5" result="n"/><feDisplacementMap in="d0" in2="n" scale="2.4" result="d"/><feGaussianBlur in="d" stdDeviation="0.45"/></filter>';
  document.body.appendChild(defs);
  var tbA=document.getElementById("sp-tbA"),tbB=document.getElementById("sp-tbB");
  var ICON='<svg viewBox="0 0 100 100" aria-hidden="true"><g filter="url(#sp-fz)" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><circle style="stroke-width:8" cx="50" cy="50" r="40"/><circle style="stroke-width:4.5" cx="51" cy="49" r="38.5"/><path style="stroke-width:7" d="M50 25 L50 17 M75 50 L83 50 M50 75 L50 83 M25 50 L17 50"/><g class="sn"><path d="M50 20 L56 50 L50 80 L44 50 Z" fill="currentColor" style="stroke-width:4"/><circle cx="50" cy="50" r="3.2" fill="#000" stroke="none"/></g></g></svg>';
  var reduce=window.matchMedia&&window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var sa=[2,5,9,14],sb=[5,8,12,3],W0=4.0,R=0.32,Q=0.07,LEAD=0.35,th=0.6,last=0,running=false;
  function speed(a){var x=a+LEAD;return W0*(1-R*Math.cos(x)+Q*Math.sin(2*x));}
  function tick(now){
    var ns=document.querySelectorAll(".spin .sn");
    if(!ns.length){running=false;return;}
    var dt=Math.min((now-last)/1000,0.033);last=now;
    for(var i=0;i<3;i++){th+=speed(th)*dt/3;}
    var f=Math.floor(now/130)%4;
    if(tbA.getAttribute("seed")!=sa[f]){tbA.setAttribute("seed",sa[f]);tbB.setAttribute("seed",sb[f]);}
    var a="rotate("+(th*180/Math.PI)+" 50 50)";
    for(var j=0;j<ns.length;j++)ns[j].setAttribute("transform",a);
    requestAnimationFrame(tick);
  }
  function start(){if(running||reduce)return;running=true;last=performance.now();requestAnimationFrame(tick);}
  function fill(root){
    var list=root.classList&&root.classList.contains("spin")?[root]:(root.querySelectorAll?root.querySelectorAll(".spin"):[]);
    for(var i=0;i<list.length;i++){var el=list[i];if(!el.firstChild){el.innerHTML=ICON;el.setAttribute("role","img");el.setAttribute("aria-label","Loading");}}
    if(list.length)start();
  }
  fill(document.body);
  new MutationObserver(function(ms){
    for(var i=0;i<ms.length;i++)for(var j=0;j<ms[i].addedNodes.length;j++){var n=ms[i].addedNodes[j];if(n.nodeType===1)fill(n);}
  }).observe(document.body,{childList:true,subtree:true});
})();
