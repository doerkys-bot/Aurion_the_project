import { FaceLandmarker, FilesetResolver } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22/+esm";

const A = window.AURION;

if (A) {
  A.setStatus("modul gestartet");
} else {
  console.error("AURION fehlt");
}

let faceLandmarker = null;

async function initMediaPipe(){
  if (!A) return false;
  if (faceLandmarker) return true;

  try {
    A.setStatus("mediapipe wasm");
    const vision = await FilesetResolver.forVisionTasks(
      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22/wasm"
    );

    A.setStatus("mediapipe modell");
    faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath:
          "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task"
      },
      runningMode: "VIDEO",
      numFaces: 1
    });

    A.setStatus("mediapipe bereit");
    return true;
  } catch (err) {
    console.error("MediaPipe Fehler:", err);
    A.setStatus("mediapipe fehler");
    return false;
  }
}

window.addEventListener("aurion-tracking-start", async () => {
  if (!A) return;
  A.setStatus("tracking angekommen");
  await initMediaPipe();
});

window.addEventListener("aurion-tracking-stop", () => {
  if (!A) return;
  A.setStatus("tracking gestoppt");
});

window.addEventListener("aurion-camera-stopped", () => {
  if (!A) return;
  A.setStatus("kamera gestoppt");
});