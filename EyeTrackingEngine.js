export default class AurionEyeTrackingEngine {
  constructor(config = {}) {
    this.video = config.video;

    this.onStatus = config.onStatus || (() => {});
    this.onGaze = config.onGaze || (() => {});
    this.onBlink = config.onBlink || (() => {});
    this.onDoubleBlink = config.onDoubleBlink || (() => {});
    this.onLookLeft = config.onLookLeft || (() => {});
    this.onLookRight = config.onLookRight || (() => {});
    this.onLookUp = config.onLookUp || (() => {});
    this.onLookDown = config.onLookDown || (() => {});
    this.onSleepChange = config.onSleepChange || (() => {});

    this.stream = null;
    this.camera = null;
    this.faceMesh = null;

    this.cameraRunning = false;
    this.trackingRunning = false;

    this.lastFaceTime = 0;

    this.doubleBlinkDelay = 480;
    this.lastBlinkTime = 0;
    this.lastBlinkVisualTime = 0;

    this.blinkState = false;
    this.blinkStartedAt = 0;

    this.sleeping = false;
    this.sleepClosedMs = 1400;

    this.calibration = {
      left: null,
      right: null,
      up: null,
      down: null
    };

    this.currentCalibrationDirection = null;
    this.currentCalibrationSamples = [];
    this.currentCalibrationResolver = null;

    this.directionHold = {
      left: 0,
      right: 0,
      up: 0,
      down: 0
    };

    this.directionCooldownUntil = {
      left: 0,
      right: 0,
      up: 0,
      down: 0
    };

    this.directionHoldMs = 320;
    this.directionCooldownMs = 900;

    this.smoothedGaze = {
      xNorm: 0.5,
      yNorm: 0.5
    };

    this.smoothing = 0.18;

    this.debug = {
      face: false,
      eyes: false
    };
  }

  async startCamera() {
    if (this.cameraRunning) return;

    if (!this.video) {
      throw new Error("Kein Video-Element übergeben.");
    }

    if (typeof FaceMesh === "undefined") {
      throw new Error("FaceMesh ist nicht geladen.");
    }

    if (typeof Camera === "undefined") {
      throw new Error("Camera Utils sind nicht geladen.");
    }

    this.faceMesh = new FaceMesh({
      locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`
    });

    this.faceMesh.setOptions({
      maxNumFaces: 1,
      refineLandmarks: true,
      minDetectionConfidence: 0.5,
      minTrackingConfidence: 0.5
    });

    this.faceMesh.onResults((results) => this.handleResults(results));

    this.camera = new Camera(this.video, {
      onFrame: async () => {
        if (!this.faceMesh || !this.cameraRunning) return;
        await this.faceMesh.send({ image: this.video });
      },
      width: 640,
      height: 480
    });

    await this.camera.start();
    this.cameraRunning = true;
    this.onStatus("Kamera läuft");
  }

  stopCamera() {
    this.stopTracking();

    if (this.video && this.video.srcObject) {
      const tracks = this.video.srcObject.getTracks();
      tracks.forEach((t) => t.stop());
      this.video.srcObject = null;
    }

    this.camera = null;
    this.faceMesh = null;
    this.cameraRunning = false;
  }

  isCameraRunning() {
    return this.cameraRunning;
  }

  async startTracking() {
    if (!this.cameraRunning) {
      throw new Error("Kamera läuft nicht.");
    }
    this.trackingRunning = true;
    this.onStatus("Tracking läuft");
  }

  stopTracking() {
    this.trackingRunning = false;
    this.currentCalibrationDirection = null;
    this.currentCalibrationSamples = [];
    this.currentCalibrationResolver = null;
  }

  isTrackingRunning() {
    return this.trackingRunning;
  }

  calibrateDirection(dir) {
    if (!["left", "right", "up", "down"].includes(dir)) {
      return Promise.reject(new Error("Ungültige Kalibrierrichtung."));
    }

    this.currentCalibrationDirection = dir;
    this.currentCalibrationSamples = [];
    this.onStatus(`Kalibriere ${dir}`);

    return new Promise((resolve) => {
      this.currentCalibrationResolver = resolve;
    });
  }

  confirmCalibration() {
    if (!this.currentCalibrationDirection || !this.currentCalibrationResolver) return;

    if (this.currentCalibrationSamples.length < 5) {
      this.onStatus("Zu wenig Daten für Kalibrierung");
      return;
    }

    const avg = this.averageNormPoints(this.currentCalibrationSamples);
    this.calibration[this.currentCalibrationDirection] = avg;

    const resolver = this.currentCalibrationResolver;
    this.currentCalibrationDirection = null;
    this.currentCalibrationSamples = [];
    this.currentCalibrationResolver = null;

    resolver(avg);
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
    this.calibration.left = data.left || null;
    this.calibration.right = data.right || null;
    this.calibration.up = data.up || null;
    this.calibration.down = data.down || null;
  }

  handleResults(results) {
    if (!this.trackingRunning) return;

    const now = performance.now();
    const faces = results.multiFaceLandmarks || [];

    if (!faces.length) {
      this.debug.face = false;
      this.debug.eyes = false;
      return;
    }

    const landmarks = faces[0];
    this.lastFaceTime = now;
    this.debug.face = true;

    const gaze = this.estimateGaze(landmarks);
    if (!gaze) {
      this.debug.eyes = false;
      return;
    }

    this.debug.eyes = true;

    this.smoothedGaze.xNorm += (gaze.xNorm - this.smoothedGaze.xNorm) * this.smoothing;
    this.smoothedGaze.yNorm += (gaze.yNorm - this.smoothedGaze.yNorm) * this.smoothing;

    const screenX = this.smoothedGaze.xNorm * window.innerWidth;
    const screenY = this.smoothedGaze.yNorm * window.innerHeight;

    this.onGaze({ x: screenX, y: screenY });

    this.processBlink(landmarks, now);
    this.processSleep(landmarks, now);

    if (this.currentCalibrationDirection) {
      this.currentCalibrationSamples.push({
        xNorm: this.smoothedGaze.xNorm,
        yNorm: this.smoothedGaze.yNorm
      });

      if (this.currentCalibrationSamples.length > 60) {
        this.currentCalibrationSamples.shift();
      }
      return;
    }

    this.processDirections(this.smoothedGaze, now);
  }

  estimateGaze(landmarks) {
    try {
      const leftIris = this.avgPoints(landmarks, [468, 469, 470, 471, 472]);
      const rightIris = this.avgPoints(landmarks, [473, 474, 475, 476, 477]);
      const irisCenter = {
        x: (leftIris.x + rightIris.x) / 2,
        y: (leftIris.y + rightIris.y) / 2
      };

      const leftFace = landmarks[234];
      const rightFace = landmarks[454];
      const topFace = landmarks[10];
      const bottomFace = landmarks[152];

      let xNorm = (irisCenter.x - leftFace.x) / Math.max(0.0001, (rightFace.x - leftFace.x));
      let yNorm = (irisCenter.y - topFace.y) / Math.max(0.0001, (bottomFace.y - topFace.y));

      xNorm = this.clamp(xNorm, 0, 1);
      yNorm = this.clamp(yNorm, 0, 1);

      xNorm = 1 - xNorm;

      return { xNorm, yNorm };
    } catch (e) {
      return null;
    }
  }

  processDirections(gaze, now) {
    if (!this.calibration.left || !this.calibration.right || !this.calibration.up || !this.calibration.down) {
      return;
    }

    const centerX = (this.calibration.left.xNorm + this.calibration.right.xNorm) / 2;
    const centerY = (this.calibration.up.yNorm + this.calibration.down.yNorm) / 2;

    const leftThreshold = (this.calibration.left.xNorm + centerX) / 2;
    const rightThreshold = (this.calibration.right.xNorm + centerX) / 2;
    const upThreshold = (this.calibration.up.yNorm + centerY) / 2;
    const downThreshold = (this.calibration.down.yNorm + centerY) / 2;

    this.handleDirection("left", gaze.xNorm <= leftThreshold, now, this.onLookLeft);
    this.handleDirection("right", gaze.xNorm >= rightThreshold, now, this.onLookRight);
    this.handleDirection("up", gaze.yNorm <= upThreshold, now, this.onLookUp);
    this.handleDirection("down", gaze.yNorm >= downThreshold, now, this.onLookDown);
  }

  handleDirection(name, isActive, now, callback) {
    if (now < this.directionCooldownUntil[name]) {
      if (!isActive) this.directionHold[name] = 0;
      return;
    }

    if (isActive) {
      if (!this.directionHold[name]) {
        this.directionHold[name] = now;
      } else if (now - this.directionHold[name] >= this.directionHoldMs) {
        this.directionCooldownUntil[name] = now + this.directionCooldownMs;
        this.directionHold[name] = 0;
        callback();
      }
    } else {
      this.directionHold[name] = 0;
    }
  }

  processBlink(landmarks, now) {
    const leftEAR = this.eyeAspectRatio(landmarks, true);
    const rightEAR = this.eyeAspectRatio(landmarks, false);
    const avgEAR = (leftEAR + rightEAR) / 2;

    const blinkThreshold = 0.19;

    if (!this.blinkState && avgEAR < blinkThreshold) {
      this.blinkState = true;
      this.blinkStartedAt = now;
    }

    if (this.blinkState && avgEAR >= blinkThreshold) {
      const blinkDuration = now - this.blinkStartedAt;
      this.blinkState = false;

      if (blinkDuration >= 40 && blinkDuration <= 420) {
        this.onBlink();

        if (now - this.lastBlinkTime <= this.doubleBlinkDelay) {
          this.onDoubleBlink();
          this.lastBlinkTime = 0;
        } else {
          this.lastBlinkTime = now;
        }
      }
    }
  }

  processSleep(landmarks, now) {
    const leftEAR = this.eyeAspectRatio(landmarks, true);
    const rightEAR = this.eyeAspectRatio(landmarks, false);
    const avgEAR = (leftEAR + rightEAR) / 2;

    const sleepThreshold = 0.16;

    if (avgEAR < sleepThreshold) {
      if (!this.blinkState && !this.blinkStartedAt) {
        this.blinkStartedAt = now;
      }

      if (!this.sleeping && this.blinkStartedAt && (now - this.blinkStartedAt > this.sleepClosedMs)) {
        this.sleeping = true;
        this.onSleepChange(true);
      }
    } else {
      if (this.sleeping) {
        this.sleeping = false;
        this.onSleepChange(false);
      }
    }
  }

  eyeAspectRatio(landmarks, left = true) {
    if (left) {
      const outer = landmarks[33];
      const inner = landmarks[133];
      const top1 = landmarks[159];
      const top2 = landmarks[160];
      const bottom1 = landmarks[145];
      const bottom2 = landmarks[144];
      return (
        (this.distance(top1, bottom1) + this.distance(top2, bottom2)) / 2
      ) / Math.max(0.0001, this.distance(outer, inner));
    } else {
      const outer = landmarks[362];
      const inner = landmarks[263];
      const top1 = landmarks[386];
      const top2 = landmarks[385];
      const bottom1 = landmarks[374];
      const bottom2 = landmarks[380];
      return (
        (this.distance(top1, bottom1) + this.distance(top2, bottom2)) / 2
      ) / Math.max(0.0001, this.distance(outer, inner));
    }
  }

  avgPoints(landmarks, ids) {
    let x = 0;
    let y = 0;
    for (const id of ids) {
      x += landmarks[id].x;
      y += landmarks[id].y;
    }
    return {
      x: x / ids.length,
      y: y / ids.length
    };
  }

  averageNormPoints(samples) {
    const sum = samples.reduce((acc, s) => {
      acc.x += s.xNorm;
      acc.y += s.yNorm;
      return acc;
    }, { x: 0, y: 0 });

    return {
      xNorm: sum.x / samples.length,
      yNorm: sum.y / samples.length
    };
  }

  distance(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
  }
}