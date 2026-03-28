export default class AurionEyeTrackingEngine {
  constructor(options = {}) {
    this.video = options.video || null;
    this.storagePrefix = options.storagePrefix || "aurion_engine";

    this.onStatus = options.onStatus || (() => {});
    this.onGaze = options.onGaze || (() => {});
    this.onBlink = options.onBlink || (() => {});
    this.onDoubleBlink = options.onDoubleBlink || (() => {});
    this.onFaceFound = options.onFaceFound || (() => {});
    this.onFaceLost = options.onFaceLost || (() => {});
    this.onUserLoaded = options.onUserLoaded || (() => {});
    this.onCalibrationSaved = options.onCalibrationSaved || (() => {});

    this.faceMesh = null;
    this.mpCamera = null;
    this.cameraRunning = false;
    this.trackingRunning = false;

    this.latestRawX = 0.5;
    this.latestRawY = 0.5;
    this.latestBlink = 0;

    this.lastFaceSeenTs = 0;
    this.facePresent = false;

    this.activeUserName = null;

    this.blinkArmed = true;
    this.pendingBlink = false;
    this.firstBlinkTs = 0;
    this.secondReadyByDrop = false;
    this.lastBlinkTs = 0;

    this.defaultBlinkProfile = {
      blinkOn: 0.52,
      blinkOff: 0.20,
      secondOn: 0.42,
      doubleWindow: 1200,
      secondMinGap: 80,
      cooldown: 120
    };

    this.blinkProfile = this.loadBlinkProfile();

    this.calibration = {
      minX: 0,
      maxX: 1,
      minY: 0,
      maxY: 1
    };

    this.loadActiveUserName();
    this.loadCalibrationForActiveUser();
  }

  key(name) {
    return `${this.storagePrefix}_${name}`;
  }

  setStatus(text) {
    this.onStatus(text);
  }

  async loadLibraries() {
    if (typeof window.FaceMesh === "undefined" || typeof window.Camera === "undefined") {
      await this.loadScript("https://cdn.jsdelivr.net/npm/@mediapipe/camera_utils/camera_utils.js");
      await this.loadScript("https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/face_mesh.js");
    }
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
      return;
    }

    if (!this.facePresent) {
      this.facePresent = true;
      this.onFaceFound();
    }

    this.lastFaceSeenTs = Date.now();

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
    this.processDoubleBlink(blink);
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

  avgPts(arr) {
    let x = 0;
    let y = 0;
    for (const p of arr) {
      x += p.x;
      y += p.y;
    }
    return { x: x / arr.length, y: y / arr.length };
  }

  clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
  }

  dist(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y);
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

  loadUsersDb() {
    try {
      const raw = localStorage.getItem(this.key("users"));
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  }

  saveUsersDb(db) {
    localStorage.setItem(this.key("users"), JSON.stringify(db));
  }

  getUserRecord(name) {
    const db = this.loadUsersDb();
    return db[name] || null;
  }

  saveUserRecord(name, record) {
    const db = this.loadUsersDb();
    db[name] = record;
    this.saveUsersDb(db);
  }

  loadActiveUserName() {
    try {
      const name = localStorage.getItem(this.key("active_user"));
      this.activeUserName = name && name.trim() ? name.trim() : null;
    } catch {
      this.activeUserName = null;
    }
    return this.activeUserName;
  }

  setActiveUserName(name) {
    this.activeUserName = name ? name.trim() : null;
    if (this.activeUserName) {
      localStorage.setItem(this.key("active_user"), this.activeUserName);
    } else {
      localStorage.removeItem(this.key("active_user"));
    }
  }

  loadCalibrationForActiveUser() {
    if (!this.activeUserName) {
      this.calibration = { minX: 0, maxX: 1, minY: 0, maxY: 1 };
      return false;
    }

    const record = this.getUserRecord(this.activeUserName);
    if (record?.calibration) {
      this.calibration = record.calibration;
      this.onUserLoaded(this.activeUserName, record);
      return true;
    }

    this.calibration = { minX: 0, maxX: 1, minY: 0, maxY: 1 };
    return false;
  }

  registerOrLoadUser(name) {
    const clean = (name || "").trim();
    if (!clean) return false;

    this.setActiveUserName(clean);
    const record = this.getUserRecord(clean);

    if (record) {
      record.lastSeen = Date.now();
      this.saveUserRecord(clean, record);
      this.loadCalibrationForActiveUser();
      return true;
    }

    this.saveUserRecord(clean, {
      calibration: { minX: 0, maxX: 1, minY: 0, maxY: 1 },
      lastSeen: Date.now()
    });

    this.loadCalibrationForActiveUser();
    return true;
  }

  saveCalibration(calibration) {
    this.calibration = { ...calibration };

    if (this.activeUserName) {
      const record = this.getUserRecord(this.activeUserName) || {};
      record.calibration = { ...this.calibration };
      record.lastSeen = Date.now();
      this.saveUserRecord(this.activeUserName, record);
    }

    this.onCalibrationSaved(this.calibration);
  }

  getLatestRawPoint() {
    return {
      x: this.latestRawX,
      y: this.latestRawY
    };
  }

  async waitForDoubleBlinkConfirm({
    timeoutMs = 7000,
    sampleLimit = 60,
    sampleIntervalMs = 16,
    beforeStart = null
  } = {}) {
    if (!this.isTrackingRunning()) {
      throw new Error("Tracking läuft nicht");
    }

    if (typeof beforeStart === "function") {
      beforeStart();
    }

    return new Promise((resolve) => {
      const samples = [];
      const startTs = Date.now();

      let armed = true;
      let firstTs = 0;
      let firstSeen = false;
      let secondReady = false;
      let lastTs = 0;
      let done = false;

      const finish = (ok) => {
        if (done) return;
        done = true;
        resolve({
          ok,
          samples
        });
      };

      const step = () => {
        if (done) return;

        if (!this.isTrackingRunning()) {
          finish(false);
          return;
        }

        const now = Date.now();
        if (now - startTs > timeoutMs) {
          finish(false);
          return;
        }

        samples.push({
          x: this.latestRawX,
          y: this.latestRawY,
          t: now
        });

        if (samples.length > sampleLimit) {
          samples.shift();
        }

        const blink = this.latestBlink;

        if (blink < 0.20) {
          armed = true;
          if (firstSeen) secondReady = true;
        }

        if (!firstSeen) {
          if (armed && blink > 0.42 && (now - lastTs) > 120) {
            armed = false;
            lastTs = now;
            firstSeen = true;
            firstTs = now;
          }
        } else {
          if (now - firstTs > 1200) {
            finish(false);
            return;
          }

          const gapOk = (now - firstTs) >= 80;
          const readyOk = secondReady || gapOk;

          if (readyOk && blink > 0.42 && (now - lastTs) > 120) {
            finish(true);
            return;
          }
        }

        setTimeout(step, sampleIntervalMs);
      };

      step();
    });
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

  async runGuidedCalibration({
    points,
    onPointStart,
    onPointEnd,
    timeoutMs = 7000,
    minSamples = 8,
    settleMs = 1200
  }) {
    if (!this.isTrackingRunning()) {
      throw new Error("Tracking läuft nicht");
    }

    if (!Array.isArray(points) || !points.length) {
      throw new Error("Keine Kalibrierpunkte angegeben");
    }

    const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
    const sampleGroups = [];

    for (const point of points) {
      this.resetBlinkState();

      this.setStatus(`Kalibrierung: ${point.name}`);

      if (typeof onPointStart === "function") {
        await onPointStart(point);
      }

      await sleep(settleMs);

      this.resetBlinkState();

      const result = await this.waitForDoubleBlinkConfirm({
        timeoutMs
      });

      if (typeof onPointEnd === "function") {
        await onPointEnd(point, result);
      }

      if (!result.ok || result.samples.length < minSamples) {
        throw new Error(`Kalibrierung abgebrochen: ${point.name}`);
      }

      sampleGroups.push(result.samples);

      this.resetBlinkState();
      await sleep(500);
    }

    const calibration = this.buildCalibrationFromSamples(sampleGroups);
    this.saveCalibration(calibration);
    return calibration;
  }
}