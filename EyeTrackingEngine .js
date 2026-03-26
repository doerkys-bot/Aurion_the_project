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

    this.dotEnabled = true;

    this.lastFaceSeen = Date.now();
    this.sleeping = false;
    this._rafId = null;

    this.lookThresholdX = opts.lookThresholdX ?? 0.14;
    this.lookThresholdY = opts.lookThresholdY ?? 0.10;
    this.lookCooldownMs = opts.lookCooldownMs ?? 900;

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

    this.basicKey = opts.basicKey ?? "aurion_calibration_basic";
    this.fineKey = opts.fineKey ?? "aurion_calibration_fine";
    this.blinkKey = opts.blinkKey ?? "aurion_blink_profile";
    this.fineFlagKey = opts.fineFlagKey ?? "aurion_fine_calibrated";
    this.blinkFlagKey = opts.blinkFlagKey ?? "aurion_blink_calibrated";

    // Richtungs-Kalibrierung für Vorhof
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
    try {
      this.onStatus?.(text);
    } catch {}
  }

  isCameraRunning() {
    return this.running;
  }

  isTrackingRunning() {
    return this.tracking;
  }

  isDotEnabled() {
    return this.dotEnabled;
  }

  toggleDot() {
    this.dotEnabled = !this.dotEnabled;
    return this.dotEnabled;
  }

  setNeutralPoint(rx = 0.5, ry = 0.5) {
    this.neutralRx = rx;
    this.neutralRy = ry;
  }

  resetBlinkState() {
    this.blinkArmed = true;
    this.pendingBlink = false;
    this.firstBlinkTs = 0;
    this.secondReadyByDrop = false;
    this.lastBlinkTs = 0;
  }

  saveJSON(key, data) {
    try {
      localStorage.setItem(key, JSON.stringify(data));
      return true;
    } catch {
      return false;
    }
  }

  loadJSON(key) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  loadCalibrationFromStorage(keys = {}) {
    const basicKey = keys.basicKey ?? this.basicKey;
    const fineKey = keys.fineKey ?? this.fineKey;
    const blinkKey = keys.blinkKey ?? this.blinkKey;

    const fine = this.loadJSON(fineKey);
    const basic = this.loadJSON(basicKey);
    const blink = this.loadJSON(blinkKey);

    if (fine) {
      this.calibration = fine;
    } else if (basic) {
      this.calibration = basic;
    }

    if (blink) {
      this.blinkProfile = {
        ...this.blinkProfile,
        ...blink
      };
    }

    return {
      calibration: this.calibration,
      blinkProfile: this.blinkProfile
    };
  }

  saveBasicCalibration(bounds, key = this.basicKey) {
    this.calibration = bounds;
    this.saveJSON(key, bounds);
  }

  saveFineCalibration(bounds, key = this.fineKey, flagKey = this.fineFlagKey) {
    this.calibration = bounds;
    this.saveJSON(key, bounds);
    try {
      localStorage.setItem(flagKey, "true");
    } catch {}
  }

  saveBlinkProfile(profile, key = this.blinkKey, flagKey = this.blinkFlagKey) {
    this.blinkProfile = {
      ...this.blinkProfile,
      ...profile
    };
    this.saveJSON(key, this.blinkProfile);
    try {
      localStorage.setItem(flagKey, "true");
    } catch {}
  }

  async startCamera() {
    if (this.running) return true;
    if (!this.video) throw new Error("No video element provided.");

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

    this.running = true;
    this.setStatus("Kamera aktiv");
    return true;
  }

  stopCamera() {
    if (this.stream) {
      this.stream.getTracks().forEach(t => t.stop());
    }
    this.stream = null;

    if (this.video) {
      this.video.srcObject = null;
    }

    this.running = false;
    this.setStatus("Kamera aus");
  }

  async loadLandmarker() {
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
  }

  async startTracking() {
    if (!this.running) throw new Error("Camera must be started first.");
    if (this.tracking) return true;

    if (!this.faceLandmarker) {
      this.setStatus("Tracking lädt…");
      await this.loadLandmarker();
    }

    this.resetBlinkState();
    this.tracking = true;
    this.lastFaceSeen = Date.now();
    this.sleeping = false;

    this.setStatus("Tracking läuft");
    this.trackLoop();

    return true;
  }

  stopTracking() {
    this.tracking = false;
    if (this._rafId) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
    this.setStatus("Tracking aus");
  }

  avgPts(arr) {
    let x = 0;
    let y = 0;
    for (const p of arr) {
      x += p.x;
      y += p.y;
    }
    return {
      x: x / arr.length,
      y: y / arr.length
    };
  }

  irisCenterNorm(lm) {
    const L = [lm?.[468], lm?.[469], lm?.[470], lm?.[471]].filter(Boolean);
    const R = [lm?.[473], lm?.[474], lm?.[475], lm?.[476]].filter(Boolean);

    if (L.length >= 2 && R.length >= 2) {
      const lc = this.avgPts(L);
      const rc = this.avgPts(R);
      return {
        rx: Math.max(0, Math.min(1, (lc.x + rc.x) / 2)),
        ry: Math.max(0, Math.min(1, (lc.y + rc.y) / 2))
      };
    }

    if (L.length >= 2) {
      const lc = this.avgPts(L);
      return {
        rx: Math.max(0, Math.min(1, lc.x)),
        ry: Math.max(0, Math.min(1, lc.y))
      };
    }

    if (R.length >= 2) {
      const rc = this.avgPts(R);
      return {
        rx: Math.max(0, Math.min(1, rc.x)),
        ry: Math.max(0, Math.min(1, rc.y))
      };
    }

    if (lm?.[468]) {
      return {
        rx: Math.max(0, Math.min(1, lm[468].x)),
        ry: Math.max(0, Math.min(1, lm[468].y))
      };
    }

    return null;
  }

  applyCalibration(rx, ry) {
    const cal = this.calibration;
    if (cal && (cal.maxX - cal.minX) > 0.0001 && (cal.maxY - cal.minY) > 0.0001) {
      rx = (rx - cal.minX) / (cal.maxX - cal.minX);
      ry = (ry - cal.minY) / (cal.maxY - cal.minY);
      rx = Math.max(0, Math.min(1, rx));
      ry = Math.max(0, Math.min(1, ry));
    }
    return { rx, ry };
  }

  processLookDirections(rx, ry) {
    const now = Date.now();
    const dx = rx - this.neutralRx;
    const dy = ry - this.neutralRy;

    if (dx <= -this.lookThresholdX && (now - this.lastLookLeftTs) > this.lookCooldownMs) {
      this.lastLookLeftTs = now;
      this.onLookLeft?.();
    }

    if (dx >= this.lookThresholdX && (now - this.lastLookRightTs) > this.lookCooldownMs) {
      this.lastLookRightTs = now;
      this.onLookRight?.();
    }

    if (dy <= -this.lookThresholdY && (now - this.lastLookUpTs) > this.lookCooldownMs) {
      this.lastLookUpTs = now;
      this.onLookUp?.();
    }

    if (dy >= this.lookThresholdY && (now - this.lastLookDownTs) > this.lookCooldownMs) {
      this.lastLookDownTs = now;
      this.onLookDown?.();
    }
  }

  processDoubleBlink(blink) {
    const now = Date.now();
    const p = this.blinkProfile;

    if (blink < p.blinkOff) {
      this.blinkArmed = true;
      if (this.pendingBlink) this.secondReadyByDrop = true;
    }

    if (this.pendingBlink && now > this.firstBlinkTs + p.doubleWindow) {
      this.pendingBlink = false;
      this.secondReadyByDrop = false;
    }

    if (!this.pendingBlink) {
      if (this.blinkArmed && blink > p.blinkOn && (now - this.lastBlinkTs) > p.cooldown) {
        this.blinkArmed = false;
        this.lastBlinkTs = now;
        this.pendingBlink = true;
        this.firstBlinkTs = now;
        this.secondReadyByDrop = false;
        this.onBlink?.();
      }
    } else {
      const gapOk = (now - this.firstBlinkTs) >= p.secondMinGap;
      const readyOk = this.secondReadyByDrop || gapOk;

      if (readyOk && blink > p.secondOn && (now - this.lastBlinkTs) > p.cooldown) {
        this.lastBlinkTs = now;
        this.pendingBlink = false;
        this.secondReadyByDrop = false;
        this.onDoubleBlink?.();
      }
    }
  }

  trackLoop() {
    if (!this.tracking || !this.faceLandmarker || !this.video) return;

    const loop = () => {
      if (!this.tracking) return;

      const res = this.faceLandmarker.detectForVideo(this.video, performance.now());

      if (res?.faceLandmarks?.length) {
        this.lastFaceSeen = Date.now();

        if (this.sleeping) {
          this.sleeping = false;
          this.onSleepChange?.(false);
        }

        const lm = res.faceLandmarks[0];
        const n0 = this.irisCenterNorm(lm);

        if (n0) {
          this.latestRawRx = n0.rx;
          this.latestRawRy = n0.ry;

          const corrected = this.applyCalibration(n0.rx, n0.ry);

          this.onGaze?.({
            x: innerWidth * (1 - corrected.rx),
            y: innerHeight * corrected.ry,
            rx: corrected.rx,
            ry: corrected.ry,
            rawRx: n0.rx,
            rawRy: n0.ry
          });

          this.processLookDirections(corrected.rx, corrected.ry);
        }

        const cats = res.faceBlendshapes?.[0]?.categories || [];
        this.latestBlink = Math.max(
          cats.find(c => c.categoryName === "eyeBlinkLeft")?.score || 0,
          cats.find(c => c.categoryName === "eyeBlinkRight")?.score || 0
        );

        this.processDoubleBlink(this.latestBlink);
      } else {
        const goneMs = Date.now() - this.lastFaceSeen;
        if (goneMs > 30000 && !this.sleeping) {
          this.sleeping = true;
          this.onSleepChange?.(true);
        }
      }

      this._rafId = requestAnimationFrame(loop);
    };

    loop();
  }

  async runFivePointCalibration({
    calInfoEl,
    calTargetEl,
    saveKey = this.fineKey,
    flagKey = this.fineFlagKey
  } = {}) {
    if (!this.tracking) {
      this.setStatus("Erst Track starten");
      return false;
    }

    const infoEl = calInfoEl ?? null;
    const targetEl = calTargetEl ?? null;

    const points = [
      { label: "Mitte schauen, Doppelblink",  x: innerWidth * 0.50, y: innerHeight * 0.50 },
      { label: "Links schauen, Doppelblink",  x: innerWidth * 0.32, y: innerHeight * 0.50 },
      { label: "Rechts schauen, Doppelblink", x: innerWidth * 0.68, y: innerHeight * 0.50 },
      { label: "Oben schauen, Doppelblink",   x: innerWidth * 0.50, y: innerHeight * 0.34 },
      { label: "Unten schauen, Doppelblink",  x: innerWidth * 0.50, y: innerHeight * 0.66 }
    ];

    if (infoEl) infoEl.style.display = "block";

    const grouped = [];
    const blinkPeaks = [];
    const endAt = Date.now() + 8000;

    for (const pt of points) {
      if (Date.now() > endAt) {
        if (targetEl) targetEl.style.display = "none";
        if (infoEl) infoEl.style.display = "none";
        this.setStatus("Kalibrierung abgebrochen");
        return false;
      }

      if (infoEl) infoEl.textContent = pt.label;

      if (targetEl) {
        targetEl.style.left = pt.x + "px";
        targetEl.style.top = pt.y + "px";
        targetEl.style.display = "block";
      }

      const samples = [];
      const ok = await this.waitForCalibrationDoubleBlink(samples, blinkPeaks, endAt);

      if (!ok || !samples.length) {
        if (targetEl) targetEl.style.display = "none";
        if (infoEl) infoEl.style.display = "none";
        this.setStatus("Kalibrierung abgebrochen");
        return false;
      }

      const avgX = samples.reduce((a, s) => a + s.x, 0) / samples.length;
      const avgY = samples.reduce((a, s) => a + s.y, 0) / samples.length;
      grouped.push({ x: avgX, y: avgY });

      await new Promise(r => setTimeout(r, 120));
    }

    if (targetEl) targetEl.style.display = "none";

    const bounds = {
      minX: Math.min(...grouped.map(p => p.x)),
      maxX: Math.max(...grouped.map(p => p.x)),
      minY: Math.min(...grouped.map(p => p.y)),
      maxY: Math.max(...grouped.map(p => p.y))
    };

    this.saveFineCalibration(bounds, saveKey, flagKey);

    const peak = Math.max(...blinkPeaks, 0.60);
    this.saveBlinkProfile({
      blinkOn: Math.min(0.92, Math.max(0.42, peak * 0.72)),
      blinkOff: 0.24,
      secondOn: Math.min(0.95, Math.max(0.42, peak * 0.66)),
      doubleWindow: 900,
      secondMinGap: 90,
      cooldown: 180
    });

    if (infoEl) {
      infoEl.textContent = "Feinabstimmung aktiv";
      setTimeout(() => {
        infoEl.style.display = "none";
      }, 1400);
    }

    this.setStatus("Feinabstimmung aktiv");
    return true;
  }

  async runBlinkCalibration({
    infoEl,
    saveKey = this.blinkKey,
    flagKey = this.blinkFlagKey
  } = {}) {
    if (!this.tracking) {
      this.setStatus("Erst Track starten");
      return false;
    }

    if (infoEl) {
      infoEl.style.display = "block";
      infoEl.textContent = "Blink-Kalibrierung: bitte mehrmals doppelt blinzeln";
    }

    const peaks = [];
    const endAt = Date.now() + 8000;

    while (Date.now() < endAt) {
      const peak = await this.waitForOneDoubleBlinkPeak(endAt);
      if (peak !== null) peaks.push(peak);
      await new Promise(r => setTimeout(r, 120));
    }

    if (infoEl) infoEl.style.display = "none";

    if (!peaks.length) {
      this.setStatus("Blink-Kalibrierung abgebrochen");
      return false;
    }

    const peak = Math.max(...peaks, 0.60);

    this.saveBlinkProfile({
      blinkOn: Math.min(0.92, Math.max(0.42, peak * 0.72)),
      blinkOff: 0.24,
      secondOn: Math.min(0.95, Math.max(0.42, peak * 0.66)),
      doubleWindow: 900,
      secondMinGap: 90,
      cooldown: 180
    }, saveKey, flagKey);

    this.setStatus("Blink-Kalibrierung aktiv");
    return true;
  }

  async waitForCalibrationDoubleBlink(samples, blinkPeaks, endAt) {
    return new Promise(resolve => {
      let armed = true;
      let firstTs = 0;
      let firstSeen = false;
      let secondReady = false;
      let lastTs = 0;
      let peak = 0;

      const stepLoop = () => {
        if (!this.tracking || Date.now() > endAt) {
          resolve(false);
          return;
        }

        peak = Math.max(peak, this.latestBlink);

        if (this.latestBlink < 0.20) {
          armed = true;
          if (firstSeen) secondReady = true;
        }

        const now = Date.now();

        if (!firstSeen) {
          if (armed && this.latestBlink > 0.42 && (now - lastTs) > 120) {
            armed = false;
            lastTs = now;
            firstSeen = true;
            firstTs = now;
          }
        } else {
          if (now - firstTs > 1200) {
            resolve(false);
            return;
          }

          const gapOk = (now - firstTs) >= 80;
          const readyOk = secondReady || gapOk;

          if (readyOk && this.latestBlink > 0.42 && (now - lastTs) > 120) {
            blinkPeaks.push(peak);
            resolve(true);
            return;
          }
        }

        samples.push({
          x: this.latestRawRx,
          y: this.latestRawRy
        });

        requestAnimationFrame(stepLoop);
      };

      stepLoop();
    });
  }

  async waitForOneDoubleBlinkPeak(endAt) {
    return new Promise(resolve => {
      let armed = true;
      let firstTs = 0;
      let firstSeen = false;
      let secondReady = false;
      let lastTs = 0;
      let peak = 0;

      const stepLoop = () => {
        if (!this.tracking || Date.now() > endAt) {
          resolve(null);
          return;
        }

        peak = Math.max(peak, this.latestBlink);

        if (this.latestBlink < 0.20) {
          armed = true;
          if (firstSeen) secondReady = true;
        }

        const now = Date.now();

        if (!firstSeen) {
          if (armed && this.latestBlink > 0.42 && (now - lastTs) > 120) {
            armed = false;
            lastTs = now;
            firstSeen = true;
            firstTs = now;
          }
        } else {
          if (now - firstTs > 1200) {
            resolve(null);
            return;
          }

          const gapOk = (now - firstTs) >= 80;
          const readyOk = secondReady || gapOk;

          if (readyOk && this.latestBlink > 0.42 && (now - lastTs) > 120) {
            resolve(peak);
            return;
          }
        }

        requestAnimationFrame(stepLoop);
      };

      stepLoop();
    });
  }

  // ===== Vorhof-Richtungs-Kalibrierung =====
  async calibrateDirection(direction) {
    if (!this.tracking) {
      throw new Error("Tracking not running");
    }

    return new Promise((resolve) => {
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