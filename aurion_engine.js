export default class AurionEngine {
  constructor(options = {}) {
    this.video = options.video || null;

    this.onStatus = options.onStatus || (() => {});
    this.onGaze = options.onGaze || (() => {});
    this.onBlink = options.onBlink || (() => {});
    this.onDoubleBlink = options.onDoubleBlink || (() => {});
    this.onSleepChange = options.onSleepChange || (() => {});
    this.onFaceFound = options.onFaceFound || (() => {});
    this.onFaceLost = options.onFaceLost || (() => {});

    // spätere Gesten vorbereitet
    this.onHeadLeft = options.onHeadLeft || (() => {});
    this.onHeadRight = options.onHeadRight || (() => {});
    this.onLookUp = options.onLookUp || (() => {});
    this.onLookDown = options.onLookDown || (() => {});

    this.faceMesh = null;
    this.mpCamera = null;

    this.cameraRunning = false;
    this.trackingRunning = false;

    this.latestRawX = 0.5;
    this.latestRawY = 0.5;
    this.latestBlink = 0;

    this.facePresent = false;
    this.lastFaceSeenTs = 0;
    this.sleeping = false;

    this.lastHeadGestureTs = 0;
    this.headGestureCooldown = 900;

    this.blinkProfile = this.loadBlinkProfile();
    this.calibration = this.loadCalibration();

    this.blinkArmed = true;
    this.pendingBlink = false;
    this.firstBlinkTs = 0;
    this.secondReadyByDrop = false;
    this.lastBlinkTs = 0;
  }

  setStatus(text) {
    this.onStatus(String(text ?? ""));
  }

  key(name) {
    return `aurion_engine_${name}`;
  }

  clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
  }

  wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  dist(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  avgPts(arr) {
    let x = 0, y = 0;
    for (const p of arr) {
      x += p.x;
      y += p.y;
    }
    return { x: x / arr.length, y: y / arr.length };
  }

  median(arr) {
    const s = [...arr].sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }

  removeOutliers(arr, tolerance = 0.08) {
    const m = this.median(arr);
    return arr.filter(v => Math.abs(v - m) < tolerance);
  }

  average(arr) {
    return arr.reduce((a, b) => a + b, 0) / arr.length;
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
    this.stopTracking();

    if (this.video?.srcObject?.getTracks) {
      this.video.srcObject.getTracks().forEach(t => t.stop());
    }

    if (this.video) {
      this.video.pause();
      this.video.srcObject = null;
    }

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

  irisCenterNorm(lm) {
    const L = [lm?.[468], lm?.[469], lm?.[470], lm?.[471]].filter(Boolean);
    const R = [lm?.[473], lm?.[474], lm?.[475], lm?.[476]].filter(Boolean);

    if (L.length >= 2 && R.length >= 2) {
      const lc = this.avgPts(L);
      const rc = this.avgPts(R);
      return {
        rx: this.clamp((lc.x + rc.x) / 2, 0, 1),
        ry: this.clamp((lc.y + rc.y) / 2, 0, 1),
        left: lc,
        right: rc
      };
    }

    if (L.length >= 2) {
      const lc = this.avgPts(L);
      return { rx: this.clamp(lc.x, 0, 1), ry: this.clamp(lc.y, 0, 1), left: lc, right: lc };
    }

    if (R.length >= 2) {
      const rc = this.avgPts(R);
      return { rx: this.clamp(rc.x, 0, 1), ry: this.clamp(rc.y, 0, 1), left: rc, right: rc };
    }

    if (lm?.[468]) {
      return {
        rx: this.clamp(lm[468].x, 0, 1),
        ry: this.clamp(lm[468].y, 0, 1),
        left: lm[468],
        right: lm[468]
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

  detectHeadGestures(lm, iris) {
    const now = Date.now();
    if ((now - this.lastHeadGestureTs) < this.headGestureCooldown) return;

    const nose = lm?.[1];
    const leftCheek = lm?.[234];
    const rightCheek = lm?.[454];
    const forehead = lm?.[10];
    const chin = lm?.[152];

    if (!nose || !leftCheek || !rightCheek || !forehead || !chin) return;

    const faceWidth = Math.abs(rightCheek.x - leftCheek.x) + 1e-6;
    const faceHeight = Math.abs(chin.y - forehead.y) + 1e-6;

    const noseCenterOffset = (nose.x - ((leftCheek.x + rightCheek.x) / 2)) / faceWidth;
    const noseVerticalOffset = (nose.y - ((forehead.y + chin.y) / 2)) / faceHeight;

    if (noseCenterOffset < -0.10) {
      this.lastHeadGestureTs = now;
      this.onHeadLeft();
      return;
    }

    if (noseCenterOffset > 0.10) {
      this.lastHeadGestureTs = now;
      this.onHeadRight();
      return;
    }

    if (iris && iris.ry < 0.10) {
      this.lastHeadGestureTs = now;
      this.onLookUp();
      return;
    }

    if (iris && iris.ry > 0.90) {
      this.lastHeadGestureTs = now;
      this.onLookDown();
    }
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
    this.processDoubleBlink(blink);

    this.detectHeadGestures(lm, iris);
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

  loadCalibration() {
    try {
      const raw = localStorage.getItem(this.key("calibration"));
      if (!raw) {
        return { minX: 0, maxX: 1, minY: 0, maxY: 1 };
      }
      return JSON.parse(raw);
    } catch {
      return { minX: 0, maxX: 1, minY: 0, maxY: 1 };
    }
  }

  saveCalibration(calibration) {
    this.calibration = { ...calibration };
    localStorage.setItem(this.key("calibration"), JSON.stringify(this.calibration));
  }

  loadBlinkProfile() {
    const fallback = {
      blinkOn: 0.50,
      blinkOff: 0.22,
      secondOn: 0.40,
      doubleWindow: 1400,
      secondMinGap: 120,
      cooldown: 180
    };

    try {
      const raw = localStorage.getItem(this.key("blink"));
      if (!raw) return fallback;
      return { ...fallback, ...JSON.parse(raw) };
    } catch {
      return fallback;
    }
  }

  saveBlinkProfile(profile) {
    const fallback = {
      blinkOn: 0.50,
      blinkOff: 0.22,
      secondOn: 0.40,
      doubleWindow: 1400,
      secondMinGap: 120,
      cooldown: 180
    };

    this.blinkProfile = { ...fallback, ...profile };
    localStorage.setItem(this.key("blink"), JSON.stringify(this.blinkProfile));
  }

  async collectStableSamples(durationMs = 700, maxSamples = 60) {
    if (!this.trackingRunning) throw new Error("Tracking läuft nicht");

    const start = Date.now();
    const samples = [];

    while ((Date.now() - start) < durationMs) {
      if (this.facePresent) {
        samples.push({
          x: this.latestRawX,
          y: this.latestRawY
        });

        if (samples.length > maxSamples) {
          samples.shift();
        }
      }

      await this.wait(35);
    }

    if (samples.length < 8) throw new Error("Zu wenige Samples");
    return samples;
  }

  async waitForCalibrationDoubleBlink(infoEl = null) {
    if (!this.trackingRunning) throw new Error("Tracking läuft nicht");

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

    const start = Date.now();

    while ((Date.now() - start) < 11000) {
      const blink = this.latestBlink;
      const now = Date.now();

      if (blink < OFF) {
        armed = true;
        if (firstSeen) secondReady = true;
      }

      if (!firstSeen) {
        if (armed && blink > FIRST_ON && (now - lastTs) > COOLDOWN) {
          armed = false;
          lastTs = now;
          firstSeen = true;
          firstTs = now;
          if (infoEl) infoEl.textContent = "Erster Blink erkannt – nochmal Doppelblink";
        }
      } else {
        if ((now - firstTs) > WINDOW) return false;

        const gapOk = (now - firstTs) >= FIRST_GAP;
        const readyOk = secondReady || gapOk;

        if (readyOk && blink > SECOND_ON && (now - lastTs) > COOLDOWN) {
          while (this.latestBlink >= OFF) {
            await this.wait(25);
          }
          await this.wait(POST_RELEASE_MS);
          return true;
        }
      }

      await this.wait(25);
    }

    return false;
  }

  async runFivePointCalibration({ calInfoEl, calTargetEl } = {}) {
    if (!this.trackingRunning) throw new Error("Tracking läuft nicht");
    if (!calInfoEl || !calTargetEl) throw new Error("Kalibrierungs-Elemente fehlen");

    const points = [
      { key: "lt", name: "links oben",  x: window.innerWidth * 0.18, y: window.innerHeight * 0.22 },
      { key: "rt", name: "rechts oben", x: window.innerWidth * 0.82, y: window.innerHeight * 0.22 },
      { key: "lb", name: "links unten", x: window.innerWidth * 0.18, y: window.innerHeight * 0.78 },
      { key: "rb", name: "rechts unten", x: window.innerWidth * 0.82, y: window.innerHeight * 0.78 },
      { key: "c",  name: "mitte",       x: window.innerWidth * 0.50, y: window.innerHeight * 0.50 }
    ];

    const pointData = {};

    calInfoEl.style.display = "block";
    calTargetEl.style.display = "block";

    try {
      for (const p of points) {
        calInfoEl.textContent = `Fixiere ${p.name} und Doppelblink`;
        calTargetEl.style.left = `${p.x}px`;
        calTargetEl.style.top = `${p.y}px`;

        await this.wait(350);

        const ok = await this.waitForCalibrationDoubleBlink(calInfoEl);
        if (!ok) throw new Error(`Doppelblink für ${p.name} nicht erkannt`);

        const samples = await this.collectStableSamples(700, 60);
        const xs = samples.map(s => s.x);
        const ys = samples.map(s => s.y);

        const xsClean = this.removeOutliers(xs, 0.08);
        const ysClean = this.removeOutliers(ys, 0.08);

        if (xsClean.length < 6 || ysClean.length < 6) {
          throw new Error(`Zu unruhige Messung bei ${p.name}`);
        }

        pointData[p.key] = {
          x: this.average(xsClean),
          y: this.average(ysClean)
        };

        calInfoEl.textContent = `${p.name} gespeichert`;
        await this.wait(420);
      }

      const rightX = (pointData.rt.x + pointData.rb.x) / 2;
      const leftX  = (pointData.lt.x + pointData.lb.x) / 2;
      const topY   = (pointData.lt.y + pointData.rt.y) / 2;
      const botY   = (pointData.lb.y + pointData.rb.y) / 2;

      this.saveCalibration({
        minX: rightX - 0.02,
        maxX: leftX + 0.02,
        minY: topY - 0.02,
        maxY: botY + 0.02,
        centerX: pointData.c.x,
        centerY: pointData.c.y
      });

      localStorage.setItem(this.key("fine_calibrated"), "true");
      this.setStatus("5-Punkt-Kalibrierung gespeichert");
      return true;
    } finally {
      calTargetEl.style.display = "none";
      calInfoEl.style.display = "none";
    }
  }

  async runBlinkCalibration({ infoEl } = {}) {
    if (!this.trackingRunning) throw new Error("Tracking läuft nicht");
    if (!infoEl) throw new Error("Info-Element fehlt");

    infoEl.style.display = "block";

    try {
      infoEl.textContent = "Blink-Kalibrierung: bitte 5x deutlich blinzeln";
      await this.wait(800);

      const peaks = [];
      let lastBelow = true;
      const start = Date.now();

      while (peaks.length < 5 && (Date.now() - start) < 15000) {
        const b = this.latestBlink;

        if (b < 0.18) {
          lastBelow = true;
        }

        if (lastBelow && b > 0.32) {
          peaks.push(b);
          lastBelow = false;
          infoEl.textContent = `Blink ${peaks.length}/5 erkannt`;
          await this.wait(450);
        }

        await this.wait(30);
      }

      if (peaks.length < 3) throw new Error("Zu wenige Blinks erkannt");

      const peakAvg = peaks.reduce((a, b) => a + b, 0) / peaks.length;

      this.saveBlinkProfile({
        blinkOn: Math.max(0.34, Math.min(0.80, peakAvg * 0.78)),
        secondOn: Math.max(0.30, Math.min(0.72, peakAvg * 0.66)),
        blinkOff: 0.20,
        doubleWindow: 1400,
        secondMinGap: 120,
        cooldown: 180
      });

      localStorage.setItem(this.key("blink_calibrated"), "true");
      this.setStatus("Blink-Kalibrierung gespeichert");
      return true;
    } finally {
      infoEl.style.display = "none";
    }
  }
}