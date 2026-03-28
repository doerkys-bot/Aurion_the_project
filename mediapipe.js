console.log("mediapipe.js wurde geladen");
window.AURION?.setStatus("modul gestartet");

window.addEventListener("aurion-tracking-start", () => {
  window.AURION?.setStatus("tracking event angekommen");
});