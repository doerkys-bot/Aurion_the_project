window.AURION?.setStatus("modul gestartet");
console.log("mediapipe.js geladen");

window.addEventListener("aurion-tracking-start", () => {
  window.AURION?.setStatus("tracking angekommen");
});