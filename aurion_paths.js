// aurion-paths.js
// Plattformunabhängige Referenzpfade für Aurion
// Konfiguration: passe hier Owner/Repo/Branch an

const AurionPaths = (function () {
  // --- CONFIG ---
  const config = {
    repoOwner: "DEIN_GITHUB_USER_ODER_ORG",     // z.B. "dirk"
    repoName: "aurion-repo",                    // z.B. "aurion"
    branch: "main",                             // branch name
    basePathInRepo: "www",                      // Pfad im Repo, z.B. "www" oder "" wenn root
    useSubfoldersForPlatforms: true,            // wenn true, sucht z.B. "mobile/..." bzw. "desktop/..."
    mobileSubfolder: "mobile",
    desktopSubfolder: "desktop",
    // Optionale lokale Fallback-Pfade (relative Pfade innerhalb der App)
    localFallbackBase: "./",                    // z.B. "./" oder "/assets/"
  };

  // --- Hilfsfunktionen ---
  function isMobile() {
    // moderne API (falls verfügbar)
    if (navigator.userAgentData && navigator.userAgentData.platform) {
      const p = navigator.userAgentData;
      // userAgentData.platform kann "Android", "iOS", "Windows" u.ä. sein
      return /android|ios|iphone|ipad/i.test(p.platform || "");
    }
    // Fallback - heuristik
    const ua = navigator.userAgent || "";
    if (/Mobi|Android|iPhone|iPad|iPod|Opera Mini|IEMobile/i.test(ua)) return true;
    // Touchscreen heuristic
    if (navigator.maxTouchPoints && navigator.maxTouchPoints > 1) return true;
    // Bildschirmbreite heuristic
    return window.innerWidth <= 760;
  }

  function buildRawBaseUrl() {
    // raw.githubusercontent base
    // Format: https://raw.githubusercontent.com/{owner}/{repo}/{branch}/{path}
    const parts = [
      "https://raw.githubusercontent.com",
      encodeURIComponent(config.repoOwner),
      encodeURIComponent(config.repoName),
      encodeURIComponent(config.branch),
    ];
    return parts.join("/");
  }

  function normalizePath(p) {
    if (!p) return "";
    return p.replace(/^\/+|\/+$/g, ""); // remove leading/trailing slashes
  }

  function getPlatformSubfolder() {
    if (!config.useSubfoldersForPlatforms) return "";
    return isMobile() ? config.mobileSubfolder : config.desktopSubfolder;
  }

  // Gibt die URL auf raw.githubusercontent für eine Ressource zurück
  function getGithubRawUrl(resourcePath) {
    const base = buildRawBaseUrl();
    const repoBase = normalizePath(config.basePathInRepo);
    const platformFolder = normalizePath(getPlatformSubfolder());
    const resource = normalizePath(resourcePath);

    // Baue Pfadliste in der Reihenfolge: repoBase / platformFolder / resource
    const parts = [];
    if (repoBase) parts.push(repoBase);
    if (platformFolder) parts.push(platformFolder);
    if (resource) parts.push(resource);

    return `${base}/${parts.join("/")}`;
  }

  // Liefert die primäre URL und eine lokale Fallback-URL, falls fetch scheitert
  function getResourceUrls(resourcePath) {
    return {
      github: getGithubRawUrl(resourcePath),
      local: (config.localFallbackBase ? (normalizePath(config.localFallbackBase) + "/") : "") + normalizePath(resourcePath)
    };
  }

  // Versucht die Ressource zu fetchen; bei Erfolg -> Response; bei Fehler -> Versuch lokale Fallback-URL
  async function fetchWithFallback(resourcePath, fetchOptions = {}) {
    const urls = getResourceUrls(resourcePath);
    try {
      const r = await fetch(urls.github, fetchOptions);
      if (!r.ok) throw new Error(`GitHub returned ${r.status}`);
      return r;
    } catch (e) {
      // Versuch lokale Fallback
      try {
        const r2 = await fetch(urls.local, fetchOptions);
        if (!r2.ok) throw new Error(`Local fallback returned ${r2.status}`);
        return r2;
      } catch (e2) {
        // Sowohl GitHub als auch lokal gescheitert
        throw new Error(`Beide Fetch-Versuche gescheitert: ${e.message}; ${e2?.message || "kein zweiter Fehler"} `);
      }
    }
  }

  // Dynamisch CSS hinzufügen (lädt die Datei von GitHub Raw, fallback lokal)
  function injectCss(resourcePath, attributes = {}) {
    const urls = getResourceUrls(resourcePath);
    // Direktes Einfügen eines Link-Tags, das GitHub-Raw-URL nutzt
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = urls.github;
    Object.entries(attributes).forEach(([k, v]) => link.setAttribute(k, v));
    // Optional: onerror fallback auf lokale Datei
    link.onerror = () => {
      console.warn(`[AurionPaths] GitHub-CSS failed, trying local: ${urls.local}`);
      link.onerror = null;
      link.href = urls.local;
    };
    document.head.appendChild(link);
    return link;
  }

  // Dynamisch Script laden (Promise)
  function loadScript(resourcePath, attributes = {}) {
    return new Promise((resolve, reject) => {
      const urls = getResourceUrls(resourcePath);
      const script = document.createElement("script");
      Object.entries(attributes).forEach(([k, v]) => script.setAttribute(k, v));
      script.src = urls.github;
      script.async = false; // falls du die Reihenfolge brauchst
      script.onload = () => resolve(script);
      script.onerror = () => {
        // fallback lokal
        console.warn(`[AurionPaths] GitHub-Script failed, trying local: ${urls.local}`);
        script.onerror = null;
        script.src = urls.local;
        // falls das auch scheitert, reject
        script.onload = () => resolve(script);
        script.onerror = (ev) => reject(new Error("Both script loads failed"));
      };
      document.body.appendChild(script);
    });
  }

  // Beispiel: JSON laden (fetch mit fallback)
  async function loadJson(resourcePath) {
    const r = await fetchWithFallback(resourcePath, { cache: "no-cache" });
    return r.json();
  }

  // Bild-URL ermitteln (nutzt GitHub Raw URL; du kannst <img src=...> direkt setzen)
  function getImageUrl(resourcePath) {
    const urls = getResourceUrls(resourcePath);
    // Wir geben primär die GitHub-URL zurück; Consumer kann onerror setzen, um auf local zu wechseln
    return urls.github;
  }

  // Exponierte API
  return {
    config,
    isMobile,
    getGithubRawUrl,
    getResourceUrls,
    fetchWithFallback,
    injectCss,
    loadScript,
    loadJson,
    getImageUrl,
  };
})();