export default class AurionEyeTrackingEngine {
  constructor(options = {}) {
    this.video = options.video || null;
    this.storagePrefix = options.storagePrefix || "aurion_engine";

    this.onStatus = options.onStatus || (() => {});
    this.onGaze = options.onGaze || (() => {});
    this.onBlink = options.onBlink || (() => {});
    this.onDoubleBlink = options.onDoubleBlink || (() => {});
    this.onLongBlink = options.onLongBlink || (() => {});
    this.onFaceFound = options.onFaceFound || (() => {});
    this.onFaceLost = options.onFaceLost || (() => {});
    this.onUserLoaded = options.onUserLoaded || (() => {});
    this.onCalibrationSaved = options.onCalibrationSaved || (() => {});
    this.onSleepChange = options.onSleepChange || (() => {});

    this.onHeadLeft = options.onHeadLeft || (() => {});
    this.onLookLeft = options.onLookLeft || (() => {});
    this.onHeadRight = options.onHeadRight || (() => {});
    this.onLookRight = options.onLookRight || (() => {});
    this.onGoBack = options.onGoBack || (() => {});
    this.onLookDown = options.onLookDown || (() => {});
    this.onSmile = options.onSmile || (() => {});

    this.faceMesh = null;
    this.mpCamera = null;
    this.cameraRunning = false;
    this.trackingRunning = false;

    this.latestRawX = 0.5;
    this.latestRawY = 0.5;
    this.latestBlink = 0;

    this.lastFaceSeenTs = 0;
    this.facePresent = false;
    this.sleeping = false;

    this.blinkArmed = true;
    this.pendingBlink = false;
    this.firstBlinkTs = 0;
    this.secondReadyByDrop = false;
    this.lastBlinkTs = 0;

    this.longBlinkStartTs = 0;
    this.longBlinkFired = false;

    this.lastHeadLeftTs = 0;
    this.lastLookLeftTs = 0;
    this.lastHeadRightTs = 0;
    this.lastLookRightTs = 0;
    this.lastGoBackTs = 0;
    this.lastLookDownTs = 0;
    this.lastSmileTs = 0;

    this.defaultBlinkProfile = {
      blinkOn: 0.50,
      blinkOff: 0.22,
      secondOn: 0.40,
      doubleWindow: 1400,
      secondMinGap: 120,
      cooldown: 180,
      longBlinkOn: 0.62,
      longBlinkMs: 900
    };

    this.gestureProfile = {
      headLeftThreshold: -0.040,
      headLeftCooldown: 1400,

      headRightThreshold: 0.040,
      headRightCooldown: 1400,

      lookLeftThreshold: 0.10,
      lookLeftCooldown: 1200,

      lookRightThreshold: 0.10,
      lookRightCooldown: 1200,

      headUpThreshold: -0.015,
      headUpCooldown: 1400,

      lookUpThreshold: 0.055,
      lookUpCooldown: 1200,

      headDownThreshold: 0.030,
      headDownCooldown: 1200,

      lookDownThreshold: 0.055,
      lookDownCooldown: 1000,

      smileThreshold: 0.38,
      smileCooldown: 3000
    };

    this.blinkProfile = this.loadBlinkProfile();
    this.calibration = this.loadCalibration() || {
      minX: 0,
      maxX: 1,
      minY: 0,
      maxY: 1
    };
  }

  key(name) {
    return `${this.storagePrefix}_${name}`;
  }

  setStatus(text) {
    this.onStatus(text);
  }

  wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
  }

  dist(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  avgPts(arr) {
    let x = 0;
    let y = 0;
    for (const p of arr) {
      x += p.x;
      y += p.y;
    }
    return { x: x / arr.length, y: y / arr.length };
  }

  loadScript(src) {
    return new Promise((resolve, reject) => {
      const existing = [...document.scripts].find(s => s.src === src);

      if (existing) {
        if (existing.dataset.loaded === "1") {
          resolve();
          return;
        }
        existing.addEventListener("load", () => resolve(), { once: true });
        existing.addEventListener("error", () => reject(new Error(`Script Fehler: ${src}`)), { once: true });
        return;
      }

      const s = document.createElement("script");
      s.src = src;
      s.async = true;
      s.onload = () => {
        s.dataset.loaded = "1";
        resolve();
      };
      s.onerror = () => reject(new Error(`Script Fehler: ${src}`));
      document.head.appendChild(s);
    });
  }

  async loadLibraries() {
    if (typeof window.FaceMesh === "undefined" || typeof window.Camera === "undefined") {
      await this.loadScript("https://cdn.jsdelivr.net/npm/@mediapipe/camera_utils/camera_utils.js");
      await this.loadScript("https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/face_mesh.js");
    }
  }

  async ensureFaceMesh() {
    if (this.faceMesh) return;

    await this.loadLibraries();

    this.faceMesh = new window.FaceMesh({
      locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`
    });

    this.faceMesh.setOptions({
      maxNumFaces: 1,
      refineLandmarks: true,
      minDetectionConfidence: 0.5,
      minTrackingConfidence: 0.5
    });

    this.faceMesh.onResults((results) => this.handleResults(results));
    this.setStatus("FaceMesh bereit");
  }

  async startCamera() {
    if (!this.video) throw new Error("Kein Video-Element übergeben");
    if (this.cameraRunning) return;

    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: "user",
        width: { ideal: 640 },
        height: { ideal: 480 }
      },
      audio: false
    });

    this.video.srcObject = stream;
    await this.video.play();

    this.cameraRunning = true;
    this.setStatus("Kamera an");
  }

  stopCamera() {
    if (!this.video) return;

    this.stopTracking();

    const stream = this.video.srcObject;
    if (stream && stream.getTracks) {
      stream.getTracks().forEach(t => t.stop());
    }

    this.video.pause();
    this.video.srcObject = null;
    this.cameraRunning = false;
    this.setStatus("Kamera aus");
  }

  async startTracking() {
    if (!this.cameraRunning) throw new Error("Erst Kamera starten");

    await this.ensureFaceMesh();

    if (!this.mpCamera) {
      this.mpCamera = new window.Camera(this.video, {
        onFrame: async () => {
          if (this.trackingRunning && this.faceMesh) {
            await this.faceMesh.send({ image: this.video });
          }
        },
        width: 640,
        height: 480
      });
    }

    this.resetBlinkState();
    this.trackingRunning = true;
    await this.mpCamera.start();
    this.setStatus("Tracking gestartet");
  }

  stopTracking() {
    this.trackingRunning = false;
    this.resetBlinkState();
    this.longBlinkStartTs = 0;
    this.longBlinkFired = false;
    this.setStatus("Tracking gestoppt");
  }

  isCameraRunning() {
    return this.cameraRunning;
  }

  isTrackingRunning() {
    return this.trackingRunning;
  }

  handleResults(results) {
    if (!this.trackingRunning) return;

    const faces = results?.multiFaceLandmarks || [];

    if (!faces.length) {
      if (this.facePresent) {
        this.facePresent = false;
        this.onFaceLost();
      }

      if ((Date.now() - this.lastFaceSeenTs) > 30000 && !this.sleeping) {
        this.sleeping = true;
        this.onSleepChange(true);
      }

      return;
    }

    if (!this.facePresent) {
      this.facePresent = true;
      this.onFaceFound();
    }

    this.lastFaceSeenTs = Date.now();

    if (this.sleeping) {
      this.sleeping = false;
      this.onSleepChange(false);
    }

    const lm = faces[0];
    const iris = this.irisCenterNorm(lm);

    if (iris) {
      this.latestRawX = iris.rx;
      this.latestRawY = iris.ry;

      const corrected = this.applyCalibration(iris.rx, iris.ry);
      this.onGaze({
        rawX: iris.rx,
        rawY: iris.ry,
        x: corrected.rx,
        y: corrected.ry
      });
    }

    const blink = this.detectBlinkFromLandmarks(lm);
    this.latestBlink = blink;

    this.processLongBlink(blink);
    this.processDoubleBlink(blink);
    this.processHeadGestures(lm);
    this.processSmile(lm);
  }

  irisCenterNorm(lm) {
    const L = [lm?.[468], lm?.[469], lm?.[470], lm?.[471]].filter(Boolean);
    const R = [lm?.[473], lm?.[474], lm?.[475], lm?.[476]].filter(Boolean);

    if (L.length >= 2 && R.length >= 2) {
      const lc = this.avgPts(L);
      const rc = this.avgPts(R);
      return {
        rx: this.clamp((lc.x + rc.x) / 2, 0, 1),
        ry: this.clamp((lc.y + rc.y) / 2, 0, 1)
      };
    }

    if (L.length >= 2) {
      const lc = this.avgPts(L);
      return { rx: this.clamp(lc.x, 0, 1), ry: this.clamp(lc.y, 0, 1) };
    }

    if (R.length >= 2) {
      const rc = this.avgPts(R);
      return { rx: this.clamp(rc.x, 0, 1), ry: this.clamp(rc.y, 0, 1) };
    }

    if (lm?.[468]) {
      return {
        rx: this.clamp(lm[468].x, 0, 1),
        ry: this.clamp(lm[468].y, 0, 1)
      };
    }

    return null;
  }

  eyeAspectRatio(top1, top2, bottom1, bottom2, left, right) {
    const v1 = this.dist(top1, bottom1);
    const v2 = this.dist(top2, bottom2);
    const h = this.dist(left, right) + 1e-6;
    return (v1 + v2) / (2 * h);
  }

  detectBlinkFromLandmarks(lm) {
    const leftEAR = this.eyeAspectRatio(
      lm[159], lm[160],
      lm[145], lm[144],
      lm[33], lm[133]
    );

    const rightEAR = this.eyeAspectRatio(
      lm[386], lm[385],
      lm[374], lm[380],
      lm[362], lm[263]
    );

    const ear = (leftEAR + rightEAR) / 2;
    return 1 - this.clamp(ear / 0.35, 0, 1);
  }

  processLongBlink(blink) {
    const now = Date.now();

    if (blink >= this.blinkProfile.longBlinkOn) {
      if (!this.longBlinkStartTs) {
        this.longBlinkStartTs = now;
      }

      if (!this.longBlinkFired && (now - this.longBlinkStartTs) >= this.blinkProfile.longBlinkMs) {
        this.longBlinkFired = true;
        this.onLongBlink();
      }
    } else {
      this.longBlinkStartTs = 0;
      this.longBlinkFired = false;
    }
  }

  processHeadGestures(lm) {
    const now = Date.now();

    const nose = lm?.[1];
    const leftEye = lm?.[33];
    const rightEye = lm?.[263];
    const leftIris = lm?.[468];
    const rightIris = lm?.[473];

    if (!nose || !leftEye || !rightEye) return;

    const eyeMidX = (leftEye.x + rightEye.x) / 2;
    const eyeMidY = (leftEye.y + rightEye.y) / 2;
    const faceWidth = Math.max(0.0001, Math.abs(rightEye.x - leftEye.x));

    const yaw = (nose.x - eyeMidX) / faceWidth;
    const pitch = (nose.y - eyeMidY) / faceWidth;

    if (
      yaw < this.gestureProfile.headLeftThreshold &&
      (now - this.lastHeadLeftTs) > this.gestureProfile.headLeftCooldown
    ) {
      this.lastHeadLeftTs = now;
      this.onHeadLeft({ via: "head_left", yaw, pitch });
    }

    if (
      yaw > this.gestureProfile.headRightThreshold &&
      (now - this.lastHeadRightTs) > this.gestureProfile.headRightCooldown
    ) {
      this.lastHeadRightTs = now;
      this.onHeadRight({ via: "head_right", yaw, pitch });
    }

    if (
      pitch < this.gestureProfile.headUpThreshold &&
      (now - this.lastGoBackTs) > this.gestureProfile.headUpCooldown
    ) {
      this.lastGoBackTs = now;
      this.onGoBack({ via: "head_up", yaw, pitch });
    }

    if (
      pitch > this.gestureProfile.headDownThreshold &&
      (now - this.lastLookDownTs) > this.gestureProfile.headDownCooldown
    ) {
      this.lastLookDownTs = now;
      this.onLookDown({ via: "head_down", yaw, pitch });
    }

    if (leftIris && rightIris) {
      const irisX = (leftIris.x + rightIris.x) / 2;
      const irisY = (leftIris.y + rightIris.y) / 2;

      const lookLeftAmount = eyeMidX - irisX;
      const lookRightAmount = irisX - eyeMidX;
      const lookUpAmount = eyeMidY - irisY;
      const lookDownAmount = irisY - eyeMidY;

      if (
        lookLeftAmount > this.gestureProfile.lookLeftThreshold &&
        (now - this.lastLookLeftTs) > this.gestureProfile.lookLeftCooldown
      ) {
        this.lastLookLeftTs = now;
        this.onLookLeft({ via: "eyes_left", yaw, pitch, lookLeftAmount });
      }

      if (
        lookRightAmount > this.gestureProfile.lookRightThreshold &&
        (now - this.lastLookRightTs) > this.gestureProfile.lookRightCooldown
      ) {
        this.lastLookRightTs = now;
        this.onLookRight({ via: "eyes_right", yaw, pitch, lookRightAmount });
      }

      if (
        lookUpAmount > this.gestureProfile.lookUpThreshold &&
        (now - this.lastGoBackTs) > this.gestureProfile.lookUpCooldown
      ) {
        this.lastGoBackTs = now;
        this.onGoBack({ via: "eyes_up", yaw, pitch, lookUpAmount });
      }

      if (
        lookDownAmount > this.gestureProfile.lookDownThreshold &&
        (now - this.lastLookDownTs) > this.gestureProfile.lookDownCooldown
      ) {
        this.lastLookDownTs = now;
        this.onLookDown({ via: "eyes_down", yaw, pitch, lookDownAmount });
      }
    }
  }

  mouthRatio(lm) {
    const left = lm?.[61];
    const right = lm?.[291];
    const top = lm?.[13];
    const bottom = lm?.[14];
    if (!left || !right || !top || !bottom) return 0;

    const width = this.dist(left, right) + 1e-6;
    const height = this.dist(top, bottom);
    return height / width;
  }

  processSmile(lm) {
    const now = Date.now();
    const ratio = this.mouthRatio(lm);

    if (
      ratio > this.gestureProfile.smileThreshold &&
      (now - this.lastSmileTs) > this.gestureProfile.smileCooldown
    ) {
      this.lastSmileTs = now;
      this.onSmile({ ratio });
    }
  }

  resetBlinkState() {
    this.blinkArmed = true;
    this.pendingBlink = false;
    this.firstBlinkTs = 0;
    this.secondReadyByDrop = false;
    this.lastBlinkTs = 0;
  }

  processDoubleBlink(blink) {
    const now = Date.now();

    if (blink < this.blinkProfile.blinkOff) {
      this.blinkArmed = true;
      if (this.pendingBlink) this.secondReadyByDrop = true;
    }

    if (this.pendingBlink && now > this.firstBlinkTs + this.blinkProfile.doubleWindow) {
      this.pendingBlink = false;
      this.secondReadyByDrop = false;
    }

    if (!this.pendingBlink) {
      if (
        this.blinkArmed &&
        blink > this.blinkProfile.blinkOn &&
        (now - this.lastBlinkTs) > this.blinkProfile.cooldown
      ) {
        this.blinkArmed = false;
        this.lastBlinkTs = now;
        this.pendingBlink = true;
        this.firstBlinkTs = now;
        this.secondReadyByDrop = false;
        this.onBlink();
      }
      return;
    }

    const gapOk = (now - this.firstBlinkTs) >= this.blinkProfile.secondMinGap;
    const readyOk = this.secondReadyByDrop || gapOk;

    if (
      readyOk &&
      blink > this.blinkProfile.secondOn &&
      (now - this.lastBlinkTs) > this.blinkProfile.cooldown
    ) {
      this.lastBlinkTs = now;
      this.pendingBlink = false;
      this.secondReadyByDrop = false;
      this.onDoubleBlink();
    }
  }

  applyCalibration(rx, ry) {
    const cal = this.calibration;
    if (!cal || (cal.maxX - cal.minX) <= 0.0001 || (cal.maxY - cal.minY) <= 0.0001) {
      return { rx, ry };
    }

    const nx = this.clamp((rx - cal.minX) / (cal.maxX - cal.minX), 0, 1);
    const ny = this.clamp((ry - cal.minY) / (cal.maxY - cal.minY), 0, 1);
    return { rx: nx, ry: ny };
  }

  loadBlinkProfile() {
    try {
      const raw = localStorage.getItem(this.key("blink"));
      if (!raw) return { ...this.defaultBlinkProfile };
      return { ...this.defaultBlinkProfile, ...JSON.parse(raw) };
    } catch {
      return { ...this.defaultBlinkProfile };
    }
  }

  saveBlinkProfile(profile) {
    this.blinkProfile = { ...this.defaultBlinkProfile, ...profile };
    localStorage.setItem(this.key("blink"), JSON.stringify(this.blinkProfile));
  }

  loadCalibration() {
    try {
      const raw = localStorage.getItem(this.key("calibration"));
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (
        parsed &&
        typeof parsed.minX === "number" &&
        typeof parsed.maxX === "number" &&
        typeof parsed.minY === "number" &&
        typeof parsed.maxY === "number"
      ) {
        return parsed;
      }
      return null;
    } catch {
      return null;
    }
  }

  saveCalibration(calibration) {
    this.calibration = { ...calibration };
    localStorage.setItem(this.key("calibration"), JSON.stringify(this.calibration));
    localStorage.setItem(this.key("last_calibration"), String(Date.now()));
    this.onCalibrationSaved(this.calibration);
  }

  clearCalibration() {
    this.calibration = { minX: 0, maxX: 1, minY: 0, maxY: 1 };
    localStorage.removeItem(this.key("calibration"));
    localStorage.removeItem(this.key("last_calibration"));
  }

  captureCalibrationSample(windowSize = 28) {
    const samples = [];
    for (let i = 0; i < windowSize; i++) {
      samples.push({
        x: this.latestRawX,
        y: this.latestRawY
      });
    }
    return samples;
  }

  buildCalibrationFromSamples(sampleGroups) {
    const all = [];

    for (const group of sampleGroups) {
      const xs = group.map(s => s.x);
      const ys = group.map(s => s.y);

      all.push({
        minX: Math.min(...xs),
        maxX: Math.max(...xs),
        minY: Math.min(...ys),
        maxY: Math.max(...ys)
      });
    }

    return {
      minX: Math.min(...all.map(a => a.minX)),
      maxX: Math.max(...all.map(a => a.maxX)),
      minY: Math.min(...all.map(a => a.minY)),
      maxY: Math.max(...all.map(a => a.maxY))
    };
  }

  buildCalibrationFromRawGroups(sampleGroups) {
    return this.buildCalibrationFromSamples(sampleGroups);
  }

  async collectStableSamples(durationMs = 850, maxSamples = 50) {
    if (!this.trackingRunning) {
      throw new Error("Tracking läuft nicht");
    }

    const start = Date.now();
    const samples = [];

    while ((Date.now() - start) < durationMs) {
      if (!this.facePresent) {
        await this.wait(40);
        continue;
      }

      samples.push({
        x: this.latestRawX,
        y: this.latestRawY
      });

      if (samples.length > maxSamples) {
        samples.shift();
      }

      await this.wait(35);
    }

    if (samples.length < 8) {
      throw new Error("Zu wenige Samples");
    }

    return samples;
  }

  async waitForCalibrationDoubleBlink(infoEl = null) {
    if (!this.trackingRunning) {
      throw new Error("Tracking läuft nicht");
    }

    const FIRST_ON = 0.32;
    const SECOND_ON = 0.30;
    const OFF = 0.14;
    const FIRST_GAP = 140;
    const WINDOW = 1900;
    const COOLDOWN = 220;
    const POST_RELEASE_MS = 520;

    let armed = true;
    let firstSeen = false;
    let firstTs = 0;
    let secondReady = false;
    let lastTs = 0;

    if (infoEl) {
      infoEl.style.display = "block";
      infoEl.textContent = "Bitte Doppelblink ausführen…";
    }

    return new Promise((resolve) => {
      const tick = () => {
        if (!this.trackingRunning) {
          if (infoEl) infoEl.style.display = "none";
          resolve(false);
          return;
        }

        const now = Date.now();
        const blink = this.latestBlink;

        if (blink < OFF) {
          armed = true;
          if (firstSeen) secondReady = true;
        }

        if (firstSeen && now > firstTs + WINDOW) {
          firstSeen = false;
          secondReady = false;
        }

        if (!firstSeen) {
          if (armed && blink > FIRST_ON && (now - lastTs) > COOLDOWN) {
            armed = false;
            lastTs = now;
            firstSeen = true;
            firstTs = now;
            secondReady = false;
            if (infoEl) infoEl.textContent = "Erster Blink erkannt…";
          }
          requestAnimationFrame(tick);
          return;
        }

        const gapOk = (now - firstTs) >= FIRST_GAP;
        const readyOk = secondReady || gapOk;

        if (readyOk && blink > SECOND_ON && (now - lastTs) > COOLDOWN) {
          lastTs = now;
          if (infoEl) infoEl.textContent = "Doppelblink erkannt";
          setTimeout(() => {
            if (infoEl) infoEl.style.display = "none";
            resolve(true);
          }, POST_RELEASE_MS);
          return;
        }

        requestAnimationFrame(tick);
      };

      tick();
    });
  }

  async runBlinkCalibration({ infoEl = null } = {}) {
    if (!this.trackingRunning) {
      throw new Error("Tracking läuft nicht");
    }

    if (infoEl) {
      infoEl.style.display = "block";
      infoEl.textContent = "Blink-Kalibrierung: Bitte mehrfach natürlich blinzeln…";
    }

    const samples = [];
    const start = Date.now();

    while ((Date.now() - start) < 5000) {
      samples.push(this.latestBlink);
      await this.wait(50);
    }

    if (samples.length < 20) {
      if (infoEl) infoEl.style.display = "none";
      throw new Error("Zu wenige Blink-Samples");
    }

    const sorted = [...samples].sort((a, b) => a - b);
    const p20 = sorted[Math.floor(sorted.length * 0.20)] ?? 0.18;
    const p80 = sorted[Math.floor(sorted.length * 0.80)] ?? 0.50;
    const p90 = sorted[Math.floor(sorted.length * 0.90)] ?? 0.62;

    this.saveBlinkProfile({
      blinkOff: this.clamp(p20, 0.08, 0.35),
      blinkOn: this.clamp(p80, 0.28, 0.75),
      secondOn: this.clamp(p80 * 0.9, 0.25, 0.7),
      longBlinkOn: this.clamp(p90, 0.35, 0.9)
    });

    localStorage.setItem(this.key("last_calibration"), String(Date.now()));

    if (infoEl) {
      infoEl.textContent = "Blink-Kalibrierung gespeichert";
      setTimeout(() => { infoEl.style.display = "none"; }, 800);
    }

    return true;
  }

  async runFivePointCalibration({ calInfoEl = null, calTargetEl = null } = {}) {
    if (!this.trackingRunning) {
      throw new Error("Tracking läuft nicht");
    }

    const points = [
      { x: 0.10, y: 0.12 },
      { x: 0.90, y: 0.12 },
      { x: 0.50, y: 0.50 },
      { x: 0.10, y: 0.88 },
      { x: 0.90, y: 0.88 }
    ];

    const groups = [];

    if (calInfoEl) {
      calInfoEl.style.display = "block";
      calInfoEl.textContent = "5-Punkt-Kalibrierung läuft…";
    }

    if (calTargetEl) {
      calTargetEl.style.display = "block";
    }

    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      const x = Math.round(window.innerWidth * p.x);
      const y = Math.round(window.innerHeight * p.y);

      if (calInfoEl) {
        calInfoEl.textContent = `Punkt ${i + 1} von ${points.length} anschauen`;
      }

      if (calTargetEl) {
        calTargetEl.style.left = `${x}px`;
        calTargetEl.style.top = `${y}px`;
      }

      await this.wait(900);
      const samples = await this.collectStableSamples(900, 60);
      groups.push(samples);
      await this.wait(250);
    }

    if (calTargetEl) {
      calTargetEl.style.display = "none";
    }

    const cal = this.buildCalibrationFromRawGroups(groups);
    this.saveCalibration(cal);

    if (calInfoEl) {
      calInfoEl.textContent = "Kalibrierung gespeichert";
      setTimeout(() => {
        calInfoEl.style.display = "none";
      }, 900);
    }

    return true;
  }
}