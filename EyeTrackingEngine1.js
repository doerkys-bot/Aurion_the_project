export default class AurionEyeTrackingEngine {
  constructor(opts = {}) {
    this.video = opts.video;

    this.onStatus = opts.onStatus || (() => {});
    this.onGaze = opts.onGaze || (() => {});
    this.onBlink = opts.onBlink || (() => {});
    this.onDoubleBlink = opts.onDoubleBlink || (() => {});
    this.onFaceFound = opts.onFaceFound || (() => {});
    this.onFaceLost = opts.onFaceLost || (() => {});
    this.onLookDown = opts.onLookDown || (() => {});
    this.onGoBack = opts.onGoBack || (() => {});

    this.faceMesh = null;
    this.camera = null;

    this.cameraRunning = false;
    this.trackingRunning = false;

    this.latestRawX = null;
    this.latestRawY = null;

    this.calibration = {
      minX: null, maxX: null,
      minY: null, maxY: null
    };

    this.blinkArmed = true;
    this.pendingBlink = false;
    this.firstBlinkTs = 0;
    this.secondReadyByDrop = false;
    this.lastBlinkTs = 0;

    this.blinkProfile = {
      blinkOn: 0.48,
      blinkOff: 0.20,
      secondOn: 0.36,
      doubleWindow: 1400,
      secondMinGap: 120,
      cooldown: 180
    };

    this.loadCalibration();
  }

  setStatus(t) { this.onStatus(t); }
  clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

  async initFaceMesh() {
    if (this.faceMesh) return;

    if (!window.FaceMesh) {
      throw new Error("MediaPipe FaceMesh wurde nicht geladen");
    }

    this.faceMesh = new window.FaceMesh({
      locateFile: (file) =>
        `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`
    });

    this.faceMesh.setOptions({
      maxNumFaces: 1,
      refineLandmarks: true,
      minDetectionConfidence: 0.5,
      minTrackingConfidence: 0.5
    });

    this.faceMesh.onResults((r) => this.handleResults(r));
  }

  async startCamera() {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user" },
      audio: false
    });

    this.video.srcObject = stream;
    await this.video.play();

    this.cameraRunning = true;
    this.setStatus("Cam an");
  }

  stopCamera() {
    const s = this.video?.srcObject;
    if (s) s.getTracks().forEach(t => t.stop());
    if (this.video) {
      this.video.pause();
      this.video.srcObject = null;
    }
    this.cameraRunning = false;
  }

  async startTracking() {
    await this.initFaceMesh();

    if (!window.Camera) {
      throw new Error("MediaPipe Camera wurde nicht geladen");
    }

    if (!this.camera) {
      this.camera = new window.Camera(this.video, {
        onFrame: async () => {
          if (this.trackingRunning) {
            await this.faceMesh.send({ image: this.video });
          }
        }
      });
    }

    this.trackingRunning = true;
    await this.camera.start();
    this.setStatus("Tracking läuft");
  }

  stopTracking() {
    this.trackingRunning = false;
  }

  isCameraRunning() { return this.cameraRunning; }
  isTrackingRunning() { return this.trackingRunning; }

  handleResults(results) {
    if (!this.trackingRunning) return;

    const faces = results.multiFaceLandmarks;
    if (!faces || !faces.length) {
      this.onFaceLost();
      return;
    }

    this.onFaceFound();

    const lm = faces[0];

    const iris = lm[468];
    if (iris) {
      this.latestRawX = iris.x;
      this.latestRawY = iris.y;

      const x = this.mapX(iris.x);
      const y = this.mapY(iris.y);

      this.onGaze({ x, y });

      if (y < 0.15) this.onGoBack();
      if (y > 0.85) this.onLookDown();
    }

    const blink = this.detectBlink(lm);
    this.processBlink(blink);
  }

  mapX(v) {
    if (this.calibration.minX == null) return v;
    return this.clamp(
      (v - this.calibration.minX) /
      (this.calibration.maxX - this.calibration.minX),
      0, 1
    );
  }

  mapY(v) {
    if (this.calibration.minY == null) return v;
    return this.clamp(
      (v - this.calibration.minY) /
      (this.calibration.maxY - this.calibration.minY),
      0, 1
    );
  }

  dist(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  ear(t1, t2, b1, b2, l, r) {
    const v1 = this.dist(t1, b1);
    const v2 = this.dist(t2, b2);
    const h = this.dist(l, r) + 1e-6;
    return (v1 + v2) / (2 * h);
  }

  detectBlink(lm) {
    const leftEAR = this.ear(
      lm[159], lm[160],
      lm[145], lm[144],
      lm[33], lm[133]
    );

    const rightEAR = this.ear(
      lm[386], lm[385],
      lm[374], lm[380],
      lm[362], lm[263]
    );

    const ear = (leftEAR + rightEAR) / 2;
    return 1 - this.clamp(ear / 0.35, 0, 1);
  }

  processBlink(blink) {
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

  saveCalibration(cal) {
    this.calibration = cal;
    localStorage.setItem("aurionCal", JSON.stringify(cal));
  }

  loadCalibration() {
    const c = localStorage.getItem("aurionCal");
    if (c) this.calibration = JSON.parse(c);
  }

  async runFivePointCalibration({ calInfoEl, calTargetEl }) {
    const margin = 40;

    const pts = [
      { x: margin, y: margin, label: "oben links" },
      { x: innerWidth - margin, y: margin, label: "oben rechts" },
      { x: innerWidth / 2, y: innerHeight / 2, label: "Mitte" },
      { x: margin, y: innerHeight - margin, label: "unten links" },
      { x: innerWidth - margin, y: innerHeight - margin, label: "unten rechts" }
    ];

    const samples = [];

    calInfoEl.style.display = "block";
    calTargetEl.style.display = "block";

    for (const p of pts) {
      calTargetEl.style.left = p.x + "px";
      calTargetEl.style.top = p.y + "px";
      calInfoEl.innerText = "Kalibrierung: " + p.label;

      await new Promise(r => setTimeout(r, 900));

      samples.push({
        x: this.latestRawX,
        y: this.latestRawY
      });
    }

    calTargetEl.style.display = "none";
    calInfoEl.style.display = "none";

    const cal = {
      minX: samples[1].x,
      maxX: samples[0].x,
      minY: (samples[0].y + samples[1].y) / 2,
      maxY: (samples[3].y + samples[4].y) / 2
    };

    this.saveCalibration(cal);
    return true;
  }
}