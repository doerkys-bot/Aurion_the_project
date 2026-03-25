class AurionEyeTrackingEngine {
  constructor(options = {}) {
    this.video = options.video || null;
    this.statusCallback = options.onStatus || (() => {});
    this.gazeCallback = options.onGaze || (() => {});
    this.blinkCallback = options.onBlink || (() => {});
    this.doubleBlinkCallback = options.onDoubleBlink || (() => {});
    this.sleepCallback = options.onSleepChange || (() => {});
    this.dotEnabledCallback = options.onDotEnabledChange || (() => {});

    this.faceLandmarker = null;
    this.stream = null;

    this.runningCamera = false;
    this.runningTracking = false;
    this.sleepMode = false;
    this.dotEnabled = true;

    this.tx = window.innerWidth / 2;
    this.ty = window.innerHeight / 2;

    this.lastFaceSeen = Date.now();

    this.blinkArmed = true;
    this.pendingBlink = false;
    this.firstBlinkTs = 0;
    this.secondReadyByDrop = false;
    this.lastBlinkTs = 0;

    this.BLINK_ON = 0.60;
    this.BLINK_OFF = 0.25;
    this.DOUBLE_WINDOW = 750;
    this.SECOND_ON = 0.54;
    this.SECOND_MIN_GAP = 120;
    this.COOLDOWN = 220;

    this.DOT_SPEED = options.dotSpeed ?? 0.28;

    this.calActive = false;
    this.calSamples = [];
    this.calTargetEl = null;
    this.calInfoEl = null;

    this.boundLoop = this.loop.bind(this);
    this.initialized = false;
  }

  // ---------- Storage ----------
  getFineCalibrationKey() {
    return "aurion_fine_calibration_" + navigator.userAgent;
  }

  getSharedCalibrationKeys() {
    return [
      this.getFineCalibrationKey(),
      "aurion_calibration",
      "aurion_cal_" + navigator.userAgent,
      "aurion_cal"
    ];
  }

  getFineCalibratedFlagKey() {
    return "aurion_fine_calibrated";
  }

  getDotEnabledKey() {
    return "aurion_dot_enabled";
  }

  loadCalibration() {
    for (const key of this.getSharedCalibrationKeys()) {
      try {
        const raw = localStorage.getItem(key);
        if (!raw) continue;
        const cal = JSON.parse(raw);
        if (
          cal &&
          typeof cal.minX === "number" &&
          typeof cal.maxX === "number" &&
          typeof cal.minY === "number" &&
          typeof cal.maxY === "number"
        ) {
          return cal;
        }
      } catch {}
    }
    return null;
  }

  saveFineCalibration(calData) {
    try {
      localStorage.setItem(this.getFineCalibrationKey(), JSON.stringify(calData));
      localStorage.setItem(this.getFineCalibratedFlagKey(), "true");
    } catch (e) {
      console.warn("Feinkalibrierung konnte nicht gespeichert werden:", e);
    }
  }

  hasFineCalibration() {
    return localStorage.getItem(this.getFineCalibratedFlagKey()) === "true";
  }

  resetFineCalibrationFlag() {
    localStorage.setItem(this.getFineCalibratedFlagKey(), "false");
  }

  loadDotEnabled() {
    const raw = localStorage.getItem(this.getDotEnabledKey());
    if (raw === null) return true;
    return raw === "true";
  }

  saveDotEnabled(value) {
    localStorage.setItem(this.getDotEnabledKey(), value ? "true" : "false");
  }

  // ---------- Public state ----------
  getTarget() {
    return { x: this.tx, y: this.ty };
  }

  isCameraRunning() {
    return this.runningCamera;
  }

  isTrackingRunning() {
    return this.runningTracking;
  }

  isSleepMode() {
    return this.sleepMode;
  }

  isDotEnabled() {
    return this.dotEnabled;
  }

  // ---------- Status ----------
  setStatus(text) {
    this.statusCallback(text);
  }

  setSleepMode(on) {
    if (this.sleepMode === on) return;
    this.sleepMode = on;
    this.sleepCallback(on);
  }

  setDotEnabled(on) {
    this.dotEnabled = !!on;
    this.saveDotEnabled(this.dotEnabled);
    this.dotEnabledCallback(this.dotEnabled);
  }

  toggleDot() {
    this.setDotEnabled(!this.dotEnabled);
    return this.dotEnabled;
  }

  // ---------- Calibration ----------
  applyCalibration(rx, ry) {
    const cal = this.loadCalibration();

    if (cal && (cal.maxX - cal.minX) > 0.0001 && (cal.maxY - cal.minY) > 0.0001) {
      rx = (rx - cal.minX) / (cal.maxX - cal.minX);
      ry = (ry - cal.minY) / (cal.maxY - cal.minY);

      rx = Math.max(0, Math.min(1, rx));
      ry = Math.max(0, Math.min(1, ry));
    }

    return { rx, ry };
  }

  async runFivePointCalibration({ calInfoEl = null, calTargetEl = null } = {}) {
    if (!this.runningTracking || !this.faceLandmarker || !this.video) {
      this.setStatus("Erst Kamera und Tracking starten");
      return false;
    }

    this.calInfoEl = calInfoEl;
    this.calTargetEl = calTargetEl;

    this.calActive = true;
    this.calSamples = [];

    if (this.calInfoEl) this.calInfoEl.style.display = "block";
    if (this.calTargetEl) this.calTargetEl.style.display = "block";

    this.setStatus("Feinkalibrierung läuft");

    const marginX = Math.max(60, window.innerWidth * 0.12);
    const marginY = Math.max(90, window.innerHeight * 0.14);

    const points = [
      { x: marginX, y: marginY },
      { x: window.innerWidth - marginX, y: marginY },
      { x: window.innerWidth - marginX, y: window.innerHeight - marginY },
      { x: marginX, y: window.innerHeight - marginY },
      { x: window.innerWidth / 2, y: window.innerHeight / 2 }
    ];

    const grouped = [];

    for (const pt of points) {
      if (this.calTargetEl) {
        this.calTargetEl.style.left = pt.x + "px";
        this.calTargetEl.style.top = pt.y + "px";
      }

      const startIndex = this.calSamples.length;
      await new Promise(r => setTimeout(r, 1200));
      const endIndex = this.calSamples.length;

      const slice = this.calSamples.slice(startIndex, endIndex);
      if (slice.length) {
        const avgX = slice.reduce((a, s) => a + s.x, 0) / slice.length;
        const avgY = slice.reduce((a, s) => a + s.y, 0) / slice.length;
        grouped.push({ x: avgX, y: avgY });
      }
    }

    this.calActive = false;

    if (this.calInfoEl) this.calInfoEl.style.display = "none";
    if (this.calTargetEl) this.calTargetEl.style.display = "none";

    if (grouped.length >= 3) {
      const bounds = {
        minX: Math.min(...grouped.map(p => p.x)),
        maxX: Math.max(...grouped.map(p => p.x)),
        minY: Math.min(...grouped.map(p => p.y)),
        maxY: Math.max(...grouped.map(p => p.y))
      };

      this.saveFineCalibration(bounds);
      this.setStatus("Kalibrierung gespeichert");
      return true;
    }

    this.setStatus("Kalibrierung fehlgeschlagen");
    return false;
  }

  // ---------- MediaPipe ----------
  async init() {
    if (this.initialized) return;

    this.dotEnabled = this.loadDotEnabled();
    this.dotEnabledCallback(this.dotEnabled);

    this.setStatus("Tracking lädt…");

    const vision = await import("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest");
    const fs = await vision.FilesetResolver.forVisionTasks(
      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm"
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

    this.initialized = true;
    this.setStatus("Tracking bereit");
  }

  async startCamera() {
    if (!this.video) {
      throw new Error("Kein Video-Element übergeben.");
    }

    if (this.runningCamera) return;

    this.stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: "user",
        width: { ideal: 640 },
        height: { ideal: 480 }
      },
      audio: false
    });

    this.video.srcObject = this.stream;
    await this.video.play();

    this.runningCamera = true;
    this.setSleepMode(false);
    this.setStatus("Kamera aktiv");
  }

  stopCamera() {
    if (this.stream) {
      this.stream.getTracks().forEach(t => t.stop());
      this.stream = null;
    }

    if (this.video) {
      this.video.srcObject = null;
    }

    this.runningCamera = false;
    this.runningTracking = false;
    this.setSleepMode(false);
    this.setStatus("Kamera aus");
  }

  async startTracking() {
    if (!this.runningCamera) {
      throw new Error("Erst Kamera starten.");
    }

    if (!this.initialized) {
      await this.init();
    }

    if (this.runningTracking) return;

    this.runningTracking = true;
    this.lastFaceSeen = Date.now();
    this.setStatus("Tracking läuft");
    requestAnimationFrame(this.boundLoop);
  }

  stopTracking() {
    this.runningTracking = false;
    this.setSleepMode(false);
    this.setStatus("Tracking gestoppt");
  }

  // ---------- Blink ----------
  getBlinkScore(categories) {
    return Math.max(
      categories.find(c => c.categoryName === "eyeBlinkLeft")?.score || 0,
      categories.find(c => c.categoryName === "eyeBlinkRight")?.score || 0
    );
  }

  processBlink(blink, payload) {
    const now = Date.now();

    if (blink < this.BLINK_OFF) {
      this.blinkArmed = true;
      if (this.pendingBlink) this.secondReadyByDrop = true;
    }

    if (this.pendingBlink && now > this.firstBlinkTs + this.DOUBLE_WINDOW) {
      this.pendingBlink = false;
      this.secondReadyByDrop = false;
    }

    if (!this.pendingBlink) {
      if (this.blinkArmed && blink > this.BLINK_ON && (now - this.lastBlinkTs) > this.COOLDOWN) {
        this.blinkArmed = false;
        this.lastBlinkTs = now;
        this.pendingBlink = true;
        this.firstBlinkTs = now;
        this.secondReadyByDrop = false;
        this.blinkCallback(payload);
      }
    } else {
      const gapOk = (now - this.firstBlinkTs) >= this.SECOND_MIN_GAP;
      const readyOk = this.secondReadyByDrop || gapOk;

      if (readyOk && blink > this.SECOND_ON && (now - this.lastBlinkTs) > this.COOLDOWN) {
        this.lastBlinkTs = now;
        this.pendingBlink = false;
        this.secondReadyByDrop = false;
        this.doubleBlinkCallback(payload);
      }
    }
  }

  // ---------- Main loop ----------
  loop() {
    if (!this.runningTracking || !this.faceLandmarker || !this.video) return;

    const res = this.faceLandmarker.detectForVideo(this.video, performance.now());

    if (res?.faceLandmarks?.length) {
      this.lastFaceSeen = Date.now();

      if (this.sleepMode) {
        this.setSleepMode(false);
      }

      const p = res.faceLandmarks[0][468];

      if (this.calActive) {
        this.calSamples.push({ x: p.x, y: p.y });
      }

      const corrected = this.applyCalibration(p.x, p.y);
      const x = window.innerWidth * (1 - corrected.rx);
      const y = window.innerHeight * corrected.ry;

      this.tx = x;
      this.ty = y;

      const payload = {
        rawX: p.x,
        rawY: p.y,
        correctedX: corrected.rx,
        correctedY: corrected.ry,
        x,
        y
      };

      this.gazeCallback(payload);

      const cats = res.faceBlendshapes?.[0]?.categories || [];
      const blink = this.getBlinkScore(cats);
      this.processBlink(blink, payload);
    } else {
      if ((Date.now() - this.lastFaceSeen) > 2000) {
        this.tx = window.innerWidth / 2;
        this.ty = window.innerHeight / 2;
        this.gazeCallback({
          rawX: 0.5,
          rawY: 0.5,
          correctedX: 0.5,
          correctedY: 0.5,
          x: this.tx,
          y: this.ty
        });
      }

      if (!this.sleepMode && (Date.now() - this.lastFaceSeen) > 30000) {
        this.setSleepMode(true);
      }
    }

    requestAnimationFrame(this.boundLoop);
  }
}

window.AurionEyeTrackingEngine = AurionEyeTrackingEngine;
export default AurionEyeTrackingEngine;