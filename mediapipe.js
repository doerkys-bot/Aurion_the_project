import { FaceLandmarker, FilesetResolver } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22/+esm";

const A = window.AURION;
A.setStatus("modul gestartet");

let faceLandmarker = null;
let lastVideoTime = -1;
let loopStarted = false;
let blinkClosed = false;
let blinkHistory = [];
let trackingWanted = false;

function clamp(v, min, max){
  return Math.max(min, Math.min(max, v));
}

function dist(a, b){
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function midpoint(a, b){
  return { x:(a.x+b.x)/2, y:(a.y+b.y)/2 };
}

function lm(arr, i){
  return { x: arr[i].x, y: arr[i].y };
}

function eyeAspectRatio(top1, top2, bottom1, bottom2, left, right){
  const v1 = dist(top1, bottom1);
  const v2 = dist(top2, bottom2);
  const h  = dist(left, right) + 1e-6;
  return (v1 + v2) / (2 * h);
}

async function initMediaPipe(){
  if(faceLandmarker) return true;

  try{
    A.setStatus("mediapipe wasm");
    const vision = await FilesetResolver.forVisionTasks(
      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22/wasm"
    );

    A.setStatus("mediapipe modell");
    faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task"
      },
      runningMode: "VIDEO",
      numFaces: 1,
      outputFaceBlendshapes: false,
      outputFacialTransformationMatrixes: false
    });

    A.setStatus("mediapipe bereit");
    return true;
  }catch(err){
    console.error("MediaPipe Fehler:", err);
    A.setStatus("mediapipe fehler");
    return false;
  }
}

function inferGaze(landmarks){
  const leftIris  = midpoint(lm(landmarks, 468), lm(landmarks, 469));
  const rightIris = midpoint(lm(landmarks, 473), lm(landmarks, 474));

  const leftOuter  = lm(landmarks, 33);
  const leftInner  = lm(landmarks, 133);
  const rightInner = lm(landmarks, 362);
  const rightOuter = lm(landmarks, 263);

  const leftRatio = clamp(
    dist(leftOuter, leftIris) / (dist(leftOuter, leftInner) + 1e-6),
    0, 1
  );

  const rightRatio = clamp(
    dist(rightInner, rightIris) / (dist(rightInner, rightOuter) + 1e-6),
    0, 1
  );

  const hor = ((leftRatio - 0.5) + (rightRatio - 0.5)) / 2;

  const leftTop = lm(landmarks, 159);
  const leftBot = lm(landmarks, 145);
  const rightTop = lm(landmarks, 386);
  const rightBot = lm(landmarks, 374);

  const eyeMidY = (leftTop.y + leftBot.y + rightTop.y + rightBot.y) / 4;
  const irisMidY = (leftIris.y + rightIris.y) / 2;
  const ver = (irisMidY - eyeMidY) * 7.0;

  const x = clamp(innerWidth  * (0.5 - hor * 1.9), 0, innerWidth);
  const y = clamp(innerHeight * (0.5 + ver * 1.9), 0, innerHeight);

  A.setTarget(x, y);
  A.setStatus("dot durch mediapipe");

  const leftEAR = eyeAspectRatio(
    lm(landmarks,160), lm(landmarks,159),
    lm(landmarks,144), lm(landmarks,145),
    leftOuter, leftInner
  );

  const rightEAR = eyeAspectRatio(
    lm(landmarks,386), lm(landmarks,385),
    lm(landmarks,374), lm(landmarks,380),
    rightInner, rightOuter
  );

  const ear = (leftEAR + rightEAR) / 2;
  detectDoubleBlink(ear);
}

function detectDoubleBlink(ear){
  const now = performance.now();
  const threshold = 0.19;

  if(ear < threshold && !blinkClosed){
    blinkClosed = true;
  }

  if(ear >= threshold && blinkClosed){
    blinkClosed = false;
    blinkHistory.push(now);
    blinkHistory = blinkHistory.filter(t => now - t < 650);

    if(blinkHistory.length >= 2){
      blinkHistory = [];
      A.registerBlink();
    }
  }
}

async function startLoop(){
  if(loopStarted) return;
  loopStarted = true;

  const ok = await initMediaPipe();
  if(!ok){
    loopStarted = false;
    return;
  }

  A.setStatus("tracking schleife bereit");

  const loop = () => {
    if(trackingWanted && A.running && faceLandmarker && A.video && A.video.readyState >= 2){
      if(A.video.currentTime !== lastVideoTime){
        lastVideoTime = A.video.currentTime;

        try{
          const result = faceLandmarker.detectForVideo(A.video, performance.now());

          if(result.faceLandmarks && result.faceLandmarks.length){
            inferGaze(result.faceLandmarks[0]);
            A.setStatus("gesicht erkannt");
          }else{
            A.setStatus("kein gesicht");
          }
        }catch(err){
          console.error("detectForVideo Fehler:", err);
          A.setStatus("tracking fehler");
        }
      }
    }

    requestAnimationFrame(loop);
  };

  loop();
}

window.addEventListener("aurion-tracking-start", async () => {
  trackingWanted = true;
  A.setStatus("tracking startet");
  await startLoop();
});

window.addEventListener("aurion-tracking-stop", () => {
  trackingWanted = false;
  A.setStatus("tracking aus");
});

window.addEventListener("aurion-camera-stopped", () => {
  trackingWanted = false;
  lastVideoTime = -1;
});