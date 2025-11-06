const AurionPaths = (function () {
  function isMobile() {
    return /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent || "");
  }
  function normalizePath(p) { return p.replace(/^\/+/g,"").replace(/\/+$/g,""); }
  function getResourceUrl(resourcePath) { return normalizePath(resourcePath); }
  function injectCss(resourcePath) {
    const link = document.createElement("link"); link.rel="stylesheet"; link.href=getResourceUrl(resourcePath); document.head.appendChild(link);
  }
  function loadScript(resourcePath) {
    return new Promise((resolve,reject)=>{const script=document.createElement("script"); script.src=getResourceUrl(resourcePath); script.async=false; script.onload=()=>resolve(); script.onerror=(e)=>reject(e); document.body.appendChild(script);});
  }
  async function loadJson(resourcePath) {
    const r = await fetch(getResourceUrl(resourcePath)); if(!r.ok) throw new Error(`Fehler beim Laden: ${r.status}`); return r.json();
  }
  function getImageUrl(resourcePath){ return getResourceUrl(resourcePath); }
  return { isMobile, injectCss, loadScript, loadJson, getImageUrl };
})();