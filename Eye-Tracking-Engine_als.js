export default class AurionEyeTrackingEngineALS {
  constructor(opts = {}) {
    this.onGaze = opts.onGaze || (() => {});
    this.onDoubleBlink = opts.onDoubleBlink || (() => {});
    this.onBlink = opts.onBlink || (() => {});
    this.onFaceFound = opts.onFaceFound || (() => {});
    this.onFaceLost = opts.onFaceLost || (() => {});
    this.onCalibrationStatus = opts.onCalibrationStatus || (() => {});
    this.onCalibrationPointChange = opts.onCalibrationPointChange || (() => {});
    this.onCalibrationStart = opts.onCalibrationStart || (() => {});
    this.onCalibrationDone = opts.onCalibrationDone || (() => {});
    this.onBlinkCalibrationStart = opts.onBlinkCalibrationStart || (() => {});
    this.onBlinkCalibrationDone = opts.onBlinkCalibrationDone || (() => {});

    this.video = opts.videoEl || document.createElement("video");
    this.video.autoplay = true;
    this.video.playsInline = true;
    this.video.muted = true;

    if (!opts.videoEl) {
      this.video.style.display = "none";
      document.body.appendChild(this.video);
    }

    this.faceMesh = null;
    this.camera = null;
    this.started = false;
    this.trackingRunning = false;
    this.facePresent = false;

    this.latestRawX = 0.5;
    this.latestRawY = 0.5;
    this.latestBlinkStrength = 0;

    this.calibration = {
      gaze: {
        minX: null,
        maxX: null,
        minY: null,
        maxY: null
      }
    };

    this.defaultBlinkProfile = {
      blinkOn: 0.42,
      blinkOff: 0.20,
      secondOn: 0.34,
      doubleWindow: 1900,
      secondMinGap: 70,
      cooldown: 120
    };

    this.blinkProfile = this.loadBlinkProfile();

    this.blinkArmed = true;
    this.pendingBlink = false;
    this.firstBlinkTs = 0;
    this.secondReadyByDrop = false;
    this.lastBlinkTs = 0;

    this.loadCalibration();
  }

  isStarted() {
    return this.started;
  }

  hasGazeCalibration() {
    const g = this.calibration?.gaze;
    return Number.isFinite(g?.minX) &&
      Number.isFinite(g?.maxX) &&
      Number.isFinite(g?.minY) &&
      Number.isFinite(g?.maxY);
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

  async initFaceMesh() {
    if (this.faceMesh) return;

    const FaceMeshCtor = window.FaceMesh || window.faceMesh?.FaceMesh;
    if (!FaceMeshCtor) {
      throw new Error("MediaPipe FaceMesh wurde nicht geladen");
    }

    this.faceMesh = new FaceMeshCtor({
      locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`
    });

    this.faceMesh.setOptions({
      maxNumFaces: 1,
      refineLandmarks: true,
      minDetectionConfidence: 0.5,
      minTrackingConfidence: 0.5
    });

    this.faceMesh.onResults((results) => this.handleResults(results));
  }

  async start() {
    if (this.started) return;

    await this.initFaceMesh();

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

    const CameraCtor = window.Camera || window.camera_utils?.Camera;
    if (!CameraCtor) {
      throw new Error("MediaPipe Camera wurde nicht geladen");
    }

    if (!this.camera) {
      this.camera = new CameraCtor(this.video, {
        onFrame: async () => {
          if (this.trackingRunning) {
            await this.faceMesh.send({ image: this.video });
          }
        },
        width: 640,
        height: 480
      });
    }

    this.resetBlinkState();
    this.trackingRunning = true;
    await this.camera.start();
    this.started = true;
  }

  stop() {
    this.trackingRunning = false;
    this.started = false;
    this.resetBlinkState();

    try {
      const stream = this.video?.srcObject;
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
      }
      this.video.pause();
      this.video.srcObject = null;
    } catch {}
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

    const lm = faces[0];
    const iris = this.irisCenterNorm(lm);

    if (iris) {
      this.latestRawX = iris.rx;
      this.latestRawY = iris.ry;

      const corrected = this.applyGazeCalibration(iris.rx, iris.ry);

      this.onGaze({
        rawX: iris.rx,
        rawY: iris.ry,
        x: corrected.rx,
        y: corrected.ry
      });
    }

    const blink = this.detectBlinkFromLandmarks(lm);
    this.latestBlinkStrength = blink;

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

  applyGazeCalibration(rx, ry) {
    const g = this.calibration.gaze;

    if (
      !Number.isFinite(g?.minX) || !Number.isFinite(g?.maxX) ||
      !Number.isFinite(g?.minY) || !Number.isFinite(g?.maxY) ||
      Math.abs(g.maxX - g.minX) < 0.0001 ||
      Math.abs(g.maxY - g.minY) < 0.0001
    ) {
      return { rx, ry };
    }

    return {
      rx: this.clamp((rx - g.minX) / (g.maxX - g.minX), 0, 1),
      ry: this.clamp((ry - g.minY) / (g.maxY - g.minY), 0, 1)
    };
  }

  loadCalibration() {
    try {
      const raw = localStorage.getItem("aurionALSCalibration");
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (parsed?.gaze) {
        this.calibration.gaze = { ...this.calibration.gaze, ...parsed.gaze };
      }
    } catch {}
  }

  saveCalibration() {
    localStorage.setItem("aurionALSCalibration", JSON.stringify(this.calibration));
  }

  clearCalibration() {
    localStorage.removeItem("aurionALSCalibration");
    localStorage.removeItem("aurionALSBlinkProfile");
    this.calibration = {
      gaze: {
        minX: null,
        maxX: null,
        minY: null,
        maxY: null
      }
    };
    this.blinkProfile = { ...this.defaultBlinkProfile };
    this.resetBlinkState();
  }

  loadBlinkProfile() {
    try {
      const raw = localStorage.getItem("aurionALSBlinkProfile");
      if (!raw) return { ...this.defaultBlinkProfile };
      return { ...this.defaultBlinkProfile, ...JSON.parse(raw) };
    } catch {
      return { ...this.defaultBlinkProfile };
    }
  }

  saveBlinkProfile(profile) {
    this.blinkProfile = { ...this.defaultBlinkProfile, ...profile };
    localStorage.setItem("aurionALSBlinkProfile", JSON.stringify(this.blinkProfile));
  }

  averageSamples(samples) {
    if (!samples.length) return null;
    const sx = samples.reduce((a, s) => a + s.x, 0);
    const sy = samples.reduce((a, s) => a + s.y, 0);
    return { x: sx / samples.length, y: sy / samples.length };
  }

  async collectGazeSamples(durationMs = 850, intervalMs = 35) {
    const samples = [];
    const start = Date.now();

    while ((Date.now() - start) < durationMs) {
      if (Number.isFinite(this.latestRawX) && Number.isFinite(this.latestRawY)) {
        samples.push({
          x: this.latestRawX,
          y: this.latestRawY
        });
      }
      await this.wait(intervalMs);
    }

    return samples;
  }

  async runGazeCalibration() {
    if (!this.trackingRunning) throw new Error("Tracking läuft nicht");

    this.onCalibrationStart();

    const margin = 0.08;
    const pts = [
      { x: margin, y: margin },
      { x: 1 - margin, y: margin },
      { x: 0.5, y: 0.5 },
      { x: margin, y: 1 - margin },
      { x: 1 - margin, y: 1 - margin }
    ];

    const means = [];

    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      this.onCalibrationPointChange(i, pts.length, p);
      this.onCalibrationStatus(`Schau Punkt ${i + 1} von ${pts.length} ruhig an.`);
      await this.wait(450);
      const samples = await this.collectGazeSamples(900, 35);
      const mean = this.averageSamples(samples);
      if (!mean) throw new Error("Zu wenige Blickdaten");
      means.push(mean);
      await this.wait(220);
    }

    const xs = means.map(m => m.x);
    const ys = means.map(m => m.y);

    this.calibration.gaze = {
      minX: Math.min(...xs),
      maxX: Math.max(...xs),
      minY: Math.min(...ys),
      maxY: Math.max(...ys)
    };

    this.saveCalibration();
    this.onCalibrationDone();
  }

  async runBlinkCalibration() {
    if (!this.trackingRunning) throw new Error("Tracking läuft nicht");

    this.onBlinkCalibrationStart();
    this.onCalibrationStatus("Blink-Kalibrierung: Bitte 2 Sekunden ruhig schauen, dann 4-mal bewusst doppelt blinzeln.");

    const samples = [];
    const start = Date.now();

    while ((Date.now() - start) < 7000) {
      samples.push(this.latestBlinkStrength);
      await this.wait(50);
    }

    if (samples.length < 20) {
      this.onBlinkCalibrationDone();
      throw new Error("Zu wenige Blink-Samples");
    }

    const sorted = [...samples].sort((a, b) => a - b);
    const p20 = sorted[Math.floor(sorted.length * 0.20)] ?? 0.18;
    const p80 = sorted[Math.floor(sorted.length * 0.80)] ?? 0.50;

    this.saveBlinkProfile({
      blinkOff: this.clamp(p20, 0.10, 0.30),
      blinkOn: this.clamp(p80, 0.34, 0.70),
      secondOn: this.clamp(p80 * 0.82, 0.28, 0.62),
      doubleWindow: 1900,
      secondMinGap: 70,
      cooldown: 120
    });

    this.onCalibrationStatus("Blink-Kalibrierung gespeichert");
    await this.wait(900);
    this.onBlinkCalibrationDone();
    this.resetBlinkState();
  }

  async runCalibration() {
    await this.runGazeCalibration();
    await this.runBlinkCalibration();
  }
}