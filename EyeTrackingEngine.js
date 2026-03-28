import {
  FaceLandmarker,
  FilesetResolver
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22/vision_bundle.mjs";

export default class AurionEyeTrackingEngine {
  constructor(options = {}) {
    this.video = options.video;
    this.onStatus = options.onStatus || (() => {});
    this.onGaze = options.onGaze || (() => {});
    this.onBlink = options.onBlink || (() => {});
    this.onDoubleBlink = options.onDoubleBlink || (() => {});
    this.onLookLeft = options.onLookLeft || (() => {});
    this.onLookRight = options.onLookRight || (() => {});
    this.onLookUp = options.onLookUp || (() => {});
    this.onLookDown = options.onLookDown || (() => {});
    this.onSleepChange = options.onSleepChange || (() => {});

    this.faceLandmarker = null;
    this.stream = null;
    this.cameraRunning = false;
    this.trackingRunning = false;
    this.loopRunning = false;
    this.lastVideoTime = -1;

    this.blinkClosed = false;
    this.blinkHistory = [];

    this.lastLookDir = null;
    this.lastLookTime = 0;

    this.sleeping = false;
    this.noFaceSince = 0;

    this.calibrationMode = null;
    this.pendingCalibrationResolve = null;
    this.pendingCalibrationSamples = [];

    this.calibration = {
      left: null,
      right: null,
      up: null,
      down: null
    };

    this.smoothing = {
      x: window.innerWidth / 2,
      y: window.innerHeight / 2
    };
  }

  status(text) {
    try { this.onStatus(text); } catch {}
  }

  isCameraRunning() {
    return this.cameraRunning;
  }

  isTrackingRunning() {
    return this.trackingRunning;
  }

  async startCamera() {
    if (this.cameraRunning) return;

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error("Kamera im Browser nicht verfügbar");
    }

    this.status("Kamera startet");

    this.stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: "user",
        width: { ideal: 640 },
        height: { ideal: 480 }
      },
      audio: false
    });

    this.video.srcObject = this.stream;
    this.video.muted = true;
    this.video.playsInline = true;
    await this.video.play();

    this.cameraRunning = true;
    this.status("Kamera bereit");
  }

  stopCamera() {
    this.stopTracking();

    if (this.stream) {
      this.stream.getTracks().forEach(t => t.stop());
      this.stream = null;
    }

    if (this.video) {
      this.video.pause();
      this.video.srcObject = null;
    }

    this.cameraRunning = false;
    this.status("Kamera gestoppt");
  }

  async initMediaPipe() {
    if (this.faceLandmarker) return;

    this.status("MediaPipe lädt");

    const vision = await FilesetResolver.forVisionTasks(
      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22/wasm"
    );

    this.status("Modell lädt");

    this.faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath:
          "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task"
      },
      runningMode: "VIDEO",
      numFaces: 1,
      outputFaceBlendshapes: false,
      outputFacialTransformationMatrixes: false
    });

    this.status("MediaPipe bereit");
  }

  async startTracking() {
    if (!this.cameraRunning) {
      throw new Error("Kamera läuft nicht");
    }

    await this.initMediaPipe();

    if (this.trackingRunning) return;

    this.trackingRunning = true;
    this.lastVideoTime = -1;
    this.status("Tracking läuft");

    if (!this.loopRunning) {
      this.loopRunning = true;
      this.loop();
    }
  }

  stopTracking() {
    this.trackingRunning = false;
    this.calibrationMode = null;

    if (this.pendingCalibrationResolve) {
      this.pendingCalibrationResolve = null;
    }

    this.status("Tracking gestoppt");
  }

  getCalibrationData() {
    return {
      left: this.calibration.left,
      right: this.calibration.right,
      up: this.calibration.up,
      down: this.calibration.down
    };
  }

  loadCalibration(data) {
    if (!data) return;
    this.calibration.left = data.left ?? null;
    this.calibration.right = data.right ?? null;
    this.calibration.up = data.up ?? null;
    this.calibration.down = data.down ?? null;
    this.status("Kalibrierung geladen");
  }

  async calibrateDirection(direction) {
    if (!this.trackingRunning) {
      throw new Error("Tracking läuft nicht");
    }

    this.calibrationMode = direction;
    this.pendingCalibrationSamples = [];
    this.status("Kalibriere: " + direction);

    return new Promise(resolve => {
      this.pendingCalibrationResolve = resolve;
    });
  }

  confirmCalibration() {
    if (!this.calibrationMode) return;
    if (!this.pendingCalibrationSamples.length) return;

    const values = this.pendingCalibrationSamples;
    const avg = values.reduce((a, b) => a + b, 0) / values.length;

    this.calibration[this.calibrationMode] = avg;

    const resolve = this.pendingCalibrationResolve;
    this.pendingCalibrationResolve = null;
    this.pendingCalibrationSamples = [];
    this.calibrationMode = null;

    this.status("Kalibriert");
    if (resolve) resolve(avg);
  }

  clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
  }

  dist(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  midpoint(a, b) {
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  }

  lm(arr, i) {
    return { x: arr[i].x, y: arr[i].y };
  }

  eyeAspectRatio(top1, top2, bottom1, bottom2, left, right) {
    const v1 = this.dist(top1, bottom1);
    const v2 = this.dist(top2, bottom2);
    const h = this.dist(left, right) + 1e-6;
    return (v1 + v2) / (2 * h);
  }

  detectDoubleBlink(ear) {
    const now = performance.now();
    const threshold = 0.19;

    if (ear < threshold && !this.blinkClosed) {
      this.blinkClosed = true;
    }

    if (ear >= threshold && this.blinkClosed) {
      this.blinkClosed = false;
      this.onBlink();

      this.blinkHistory.push(now);
      this.blinkHistory = this.blinkHistory.filter(t => now - t < 650);

      if (this.blinkHistory.length >= 2) {
        this.blinkHistory = [];
        this.onDoubleBlink();
      }
    }
  }

  getHorizontalSignal(landmarks) {
    const leftIris  = this.midpoint(this.lm(landmarks, 468), this.lm(landmarks, 469));
    const rightIris = this.midpoint(this.lm(landmarks, 473), this.lm(landmarks, 474));

    const leftOuter  = this.lm(landmarks, 33);
    const leftInner  = this.lm(landmarks, 133);
    const rightInner = this.lm(landmarks, 362);
    const rightOuter = this.lm(landmarks, 263);

    const leftRatio = this.clamp(
      this.dist(leftOuter, leftIris) / (this.dist(leftOuter, leftInner) + 1e-6),
      0, 1
    );

    const rightRatio = this.clamp(
      this.dist(rightInner, rightIris) / (this.dist(rightInner, rightOuter) + 1e-6),
      0, 1
    );

    return ((leftRatio - 0.5) + (rightRatio - 0.5)) / 2;
  }

  getVerticalSignal(landmarks) {
    const leftIris  = this.midpoint(this.lm(landmarks, 468), this.lm(landmarks, 469));
    const rightIris = this.midpoint(this.lm(landmarks, 473), this.lm(landmarks, 474));

    const leftTop = this.lm(landmarks, 159);
    const leftBot = this.lm(landmarks, 145);
    const rightTop = this.lm(landmarks, 386);
    const rightBot = this.lm(landmarks, 374);

    const eyeMidY = (leftTop.y + leftBot.y + rightTop.y + rightBot.y) / 4;
    const irisMidY = (leftIris.y + rightIris.y) / 2;

    return (irisMidY - eyeMidY) * 7.0;
  }

  handleLookDirections(horizontal, vertical) {
    const now = performance.now();

    if (
      this.calibration.left !== null &&
      horizontal < this.calibration.left &&
      (this.lastLookDir !== "left" || now - this.lastLookTime > 1200)
    ) {
      this.lastLookDir = "left";
      this.lastLookTime = now;
      this.onLookLeft();
      return;
    }

    if (
      this.calibration.right !== null &&
      horizontal > this.calibration.right &&
      (this.lastLookDir !== "right" || now - this.lastLookTime > 1200)
    ) {
      this.lastLookDir = "right";
      this.lastLookTime = now;
      this.onLookRight();
      return;
    }

    if (
      this.calibration.up !== null &&
      vertical < this.calibration.up &&
      (this.lastLookDir !== "up" || now - this.lastLookTime > 1200)
    ) {
      this.lastLookDir = "up";
      this.lastLookTime = now;
      this.onLookUp();
      return;
    }

    if (
      this.calibration.down !== null &&
      vertical > this.calibration.down &&
      (this.lastLookDir !== "down" || now - this.lastLookTime > 1200)
    ) {
      this.lastLookDir = "down";
      this.lastLookTime = now;
      this.onLookDown();
      return;
    }
  }

  processLandmarks(landmarks) {
    const horizontal = this.getHorizontalSignal(landmarks);
    const vertical = this.getVerticalSignal(landmarks);

    if (this.calibrationMode) {
      if (this.calibrationMode === "left" || this.calibrationMode === "right") {
        this.pendingCalibrationSamples.push(horizontal);
      } else {
        this.pendingCalibrationSamples.push(vertical);
      }

      if (this.pendingCalibrationSamples.length > 30) {
        this.pendingCalibrationSamples.shift();
      }
    }

    const x = this.clamp(window.innerWidth * (0.5 - horizontal * 1.9), 0, window.innerWidth);
    const y = this.clamp(window.innerHeight * (0.5 + vertical * 1.9), 0, window.innerHeight);

    this.smoothing.x += (x - this.smoothing.x) * 0.18;
    this.smoothing.y += (y - this.smoothing.y) * 0.18;

    this.onGaze({
      x: this.smoothing.x,
      y: this.smoothing.y,
      rawX: horizontal,
      rawY: vertical
    });

    const leftEAR = this.eyeAspectRatio(
      this.lm(landmarks, 160), this.lm(landmarks, 159),
      this.lm(landmarks, 144), this.lm(landmarks, 145),
      this.lm(landmarks, 33), this.lm(landmarks, 133)
    );

    const rightEAR = this.eyeAspectRatio(
      this.lm(landmarks, 386), this.lm(landmarks, 385),
      this.lm(landmarks, 374), this.lm(landmarks, 380),
      this.lm(landmarks, 362), this.lm(landmarks, 263)
    );

    const ear = (leftEAR + rightEAR) / 2;
    this.detectDoubleBlink(ear);

    this.handleLookDirections(horizontal, vertical);
  }

  handleNoFace() {
    const now = performance.now();

    if (!this.noFaceSince) {
      this.noFaceSince = now;
    }

    if (now - this.noFaceSince > 2500 && !this.sleeping) {
      this.sleeping = true;
      this.onSleepChange(true);
    }
  }

  handleFaceSeen() {
    this.noFaceSince = 0;
    if (this.sleeping) {
      this.sleeping = false;
      this.onSleepChange(false);
    }
  }

  loop() {
    if (!this.loopRunning) return;

    if (
      this.trackingRunning &&
      this.faceLandmarker &&
      this.video &&
      this.video.readyState >= 2
    ) {
      if (this.video.currentTime !== this.lastVideoTime) {
        this.lastVideoTime = this.video.currentTime;

        try {
          const result = this.faceLandmarker.detectForVideo(
            this.video,
            performance.now()
          );

          if (result.faceLandmarks && result.faceLandmarks.length) {
            this.handleFaceSeen();
            this.processLandmarks(result.faceLandmarks[0]);
          } else {
            this.handleNoFace();
          }
        } catch (err) {
          console.log(err);
          this.status("Tracking Fehler");
        }
      }
    }

    requestAnimationFrame(() => this.loop());
  }
}