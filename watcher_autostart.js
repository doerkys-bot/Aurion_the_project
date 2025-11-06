// watcher_autostart.js

document.addEventListener("DOMContentLoaded", () => {
  // Prüfen, ob der Watcher bereits läuft
  const watcherActive = localStorage.getItem("aurion_watcher_active");

  if (!watcherActive) {
    startWatcher();
    localStorage.setItem("aurion_watcher_active", "true");
    console.log("Watcher gestartet (Erststart).");
  } else {
    console.log("Watcher läuft bereits.");
  }
});

function startWatcher() {
  // Beispiel: Der Watcher beobachtet Netzwerk, Uhrzeit oder Präsenz.
  console.log("🌀 Aurion Watcher initialisiert...");

  // 1. Wiederkehrende Überprüfung
  setInterval(() => {
    const now = new Date();
    console.log(`[Watcher] Aktiv um ${now.toLocaleTimeString()}`);

    // Beispiel-Aktion: Synchronisation mit Feld oder Datenbank
    // (kann später ersetzt werden durch echten Code)
  }, 60000); // alle 60 Sekunden

  // 2. Optional: sichtbarer Indikator
  const indicator = document.createElement("div");
  indicator.innerText = "Watcher aktiv";
  indicator.style.position = "fixed";
  indicator.style.bottom = "8px";
  indicator.style.right = "8px";
  indicator.style.fontSize = "12px";
  indicator.style.color = "#9fd";
  indicator.style.opacity = "0.5";
  document.body.appendChild(indicator);
}