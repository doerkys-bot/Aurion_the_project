export default class AurionEyeTrackingEngine {
  constructor(opts = {}) {
    this.video = opts.video ?? null;

    this.onStatus = opts.onStatus ?? (() => {});
    this.onGaze = opts.onGaze ?? (() => {});
    this.onBlink = opts.onBlink ?? (() => {});
    this.onDoubleBlink = opts.onDoubleBlink ?? (() => {});
    this.onSleepChange = opts.onSleepChange ?? (() => {});

    this.onLookLeft = opts.onLookLeft ?? (() => {});
    this.onLookRight = opts.onLookRight ?? (() => {});
    this.onLookUp = opts.onLookUp ?? (() => {});
    this.onLookDown = opts.onLookDown ?? (() => {});

    this.running = false;
    this.tracking = false;
    this.stream = null;
    this.faceLandmarker = null;
    this._rafId = null;

    this.lastFaceSeen = Date.now();
    this.sleeping = false;

    this.lookThresholdX = 0.14;
    this.lookThresholdY = 0.10;
    this.lookCooldownMs = 900;

    this.lastLookLeftTs = 0;
    this.lastLookRightTs = 0;
    this.lastLookUpTs = 0;
    this.lastLookDownTs = 0;

    this.neutralRx = 0.5;
    this.neutralRy = 0.5;

    this.calibration = null;

    this.blinkProfile = {
      blinkOn: 0.58,
      blinkOff: 0.24,
      secondOn: 0.50,
      doubleWindow: 900,
      secondMinGap: 90,
      cooldown: 180
    };

    this.blinkArmed = true;
    this.pendingBlink = false;
    this.firstBlinkTs = 0;
    this.secondReadyByDrop = false;
    this.lastBlinkTs = 0;

    this.latestRawRx = 0.5;
    this.latestRawRy = 0.5;
    this.latestBlink = 0;

    this.calibrationSamples = {
      left: null,
      right: null,
      up: null,
      down: null
    };

    this.pendingCalibrationDirection = null;
    this.pendingCalibrationResolve = null;
  }

  setStatus(text) {
    try { this.onStatus?.(text); } catch {}
  }

  isCameraRunning() {
    return this.running;
  }

  isTrackingRunning() {
    return this.tracking;
  }

  async startCamera() {
    if (this.running) return true;

    this.stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user" },
      audio: false
    });

    this.video.srcObject = this.stream;
    await this.video.play();

    this.running = true;
    this.setStatus("Kamera aktiv");
    return true;
  }

  stopCamera() {
    if (this.stream) {
      this.stream.getTracks().forEach(t => t.stop());
    }
    this.stream = null;
    if (this.video) this.video.srcObject = null;
    this.running = false;
    this.setStatus("Kamera aus");
  }

  async loadLandmarker() {
    const vision = await import(
      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/vision_bundle.mjs"
    );

    const fs = await vision.FilesetResolver.forVisionTasks(
      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm"
    );

    this.faceLandmarker = await vision.FaceLandmarker.createFromOptions(fs, {
      baseOptions: {
        modelAssetPath:
          "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task"
      },
      runningMode: "VIDEO",
      numFaces: 1,
      outputFaceBlendshapes: true
    });
  }

  async startTracking() {
    if (!this.running) throw new Error("Camera first");
    if (this.tracking) return true;

    if (!this.faceLandmarker) {
      this.setStatus("Tracking lädt…");
      await this.loadLandmarker();
    }

    this.tracking = true;
    this.lastFaceSeen = Date.now();
    this.sleeping = false;

    this.resetBlinkState();
    this.setStatus("Tracking läuft");
    this.trackLoop();
    return true;
  }

  stopTracking() {
    this.tracking = false;
    if (this._rafId) cancelAnimationFrame(this._rafId);
    this.setStatus("Tracking aus");
  }

  resetBlinkState() {
    this.blinkArmed = true;
    this.pendingBlink = false;
    this.firstBlinkTs = 0;
    this.secondReadyByDrop = false;
    this.lastBlinkTs = 0;
  }

  avgPts(arr) {
    let x = 0, y = 0;
    for (const p of arr) {
      x += p.x;
      y += p.y;
    }
    return { x: x / arr.length, y: y / arr.length };
  }

  irisCenterNorm(lm) {
    const L = [lm?.[468], lm?.[469], lm?.[470], lm?.[471]].filter(Boolean);
    const R = [lm?.[473], lm?.[474], lm?.[475], lm?.[476]].filter(Boolean);

    if (L.length >= 2 && R.length >= 2) {
      const lc = this.avgPts(L);
      const rc = this.avgPts(R);
      return { rx: (lc.x + rc.x) / 2, ry: (lc.y + rc.y) / 2 };
    }

    return null;
  }

  applyCalibration(rx, ry) {
    if (
      this.calibration &&
      (this.calibration.maxX - this.calibration.minX) > 0.0001 &&
      (this.calibration.maxY - this.calibration.minY) > 0.0001
    ) {
      rx = (rx - this.calibration.minX) / (this.calibration.maxX - this.calibration.minX);
      ry = (ry - this.calibration.minY) / (this.calibration.maxY - this.calibration.minY);

      rx = Math.max(0, Math.min(1, rx));
      ry = Math.max(0, Math.min(1, ry));
    }

    return { rx, ry };
  }

  processLookDirections(rx, ry) {
    const now = Date.now();
    const dx = rx - this.neutralRx;
    const dy = ry - this.neutralRy;

    if (dx <= -this.lookThresholdX && now - this.lastLookLeftTs > this.lookCooldownMs) {
      this.lastLookLeftTs = now;
      this.onLookLeft();
    }
    if (dx >= this.lookThresholdX && now - this.lastLookRightTs > this.lookCooldownMs) {
      this.lastLookRightTs = now;
      this.onLookRight();
    }
    if (dy <= -this.lookThresholdY && now - this.lastLookUpTs > this.lookCooldownMs) {
      this.lastLookUpTs = now;
      this.onLookUp();
    }
    if (dy >= this.lookThresholdY && now - this.lastLookDownTs > this.lookCooldownMs) {
      this.lastLookDownTs = now;
      this.onLookDown();
    }
  }

  processBlinks(blinkScore) {
    const now = Date.now();
    const p = this.blinkProfile;

    if (blinkScore < p.blinkOff) {
      this.blinkArmed = true;
      if (this.pendingBlink) this.secondReadyByDrop = true;
    }

    if (this.pendingBlink && now > this.firstBlinkTs + p.doubleWindow) {
      this.pendingBlink = false;
      this.secondReadyByDrop = false;
    }

    if (!this.pendingBlink) {
      if (this.blinkArmed && blinkScore > p.blinkOn && (now - this.lastBlinkTs) > p.cooldown) {
        this.blinkArmed = false;
        this.lastBlinkTs = now;
        this.pendingBlink = true;
        this.firstBlinkTs = now;
        this.secondReadyByDrop = false;
        this.onBlink();
      }
    } else {
      const gapOk = (now - this.firstBlinkTs) >= p.secondMinGap;
      const readyOk = this.secondReadyByDrop || gapOk;

      if (readyOk && blinkScore > p.secondOn && (now - this.lastBlinkTs) > p.cooldown) {
        this.lastBlinkTs = now;
        this.pendingBlink = false;
        this.secondReadyByDrop = false;
        this.onDoubleBlink();
      }
    }
  }

  trackLoop() {
    if (!this.tracking) return;

    const loop = () => {
      if (!this.tracking) return;

      const res = this.faceLandmarker.detectForVideo(this.video, performance.now());

      if (res?.faceLandmarks?.length) {
        this.lastFaceSeen = Date.now();

        if (this.sleeping) {
          this.sleeping = false;
          this.onSleepChange(false);
        }

        const lm = res.faceLandmarks[0];
        const iris = this.irisCenterNorm(lm);

        if (iris) {
          this.latestRawRx = iris.rx;
          this.latestRawRy = iris.ry;

          const corrected = this.applyCalibration(iris.rx, iris.ry);

          const x = innerWidth * (1 - corrected.rx);
          const y = innerHeight * corrected.ry;

          this.onGaze({
            x,
            y,
            rx: corrected.rx,
            ry: corrected.ry,
            rawRx: iris.rx,
            rawRy: iris.ry
          });

          this.processLookDirections(corrected.rx, corrected.ry);
        }

        const cats = res.faceBlendshapes?.[0]?.categories || [];
        this.latestBlink = Math.max(
          cats.find(c => c.categoryName === "eyeBlinkLeft")?.score || 0,
          cats.find(c => c.categoryName === "eyeBlinkRight")?.score || 0
        );

        this.processBlinks(this.latestBlink);
      } else {
        const goneMs = Date.now() - this.lastFaceSeen;
        if (goneMs > 30000 && !this.sleeping) {
          this.sleeping = true;
          this.onSleepChange(true);
        }
      }

      this._rafId = requestAnimationFrame(loop);
    };

    loop();
  }

  async calibrateDirection(direction) {
    if (!this.tracking) {
      throw new Error("Tracking not running");
    }

    return new Promise(resolve => {
      this.pendingCalibrationDirection = direction;
      this.pendingCalibrationResolve = resolve;
    });
  }

  confirmCalibration() {
    if (!this.pendingCalibrationDirection || !this.pendingCalibrationResolve) {
      return false;
    }

    this.calibrationSamples[this.pendingCalibrationDirection] = {
      rx: this.latestRawRx,
      ry: this.latestRawRy
    };

    const resolve = this.pendingCalibrationResolve;

    this.pendingCalibrationDirection = null;
    this.pendingCalibrationResolve = null;

    resolve(true);
    return true;
  }

  getCalibrationData() {
    const s = this.calibrationSamples;

    if (!s.left || !s.right || !s.up || !s.down) {
      return null;
    }

    const bounds = {
      minX: Math.min(s.left.rx, s.up.rx, s.down.rx),
      maxX: Math.max(s.right.rx, s.up.rx, s.down.rx),
      minY: Math.min(s.up.ry, s.left.ry, s.right.ry),
      maxY: Math.max(s.down.ry, s.left.ry, s.right.ry)
    };

    this.calibration = bounds;
    return bounds;
  }

  loadCalibration(data) {
    if (!data) return false;

    if (
      typeof data.minX !== "number" ||
      typeof data.maxX !== "number" ||
      typeof data.minY !== "number" ||
      typeof data.maxY !== "number"
    ) {
      return false;
    }

    this.calibration = data;
    return true;
  }
}
