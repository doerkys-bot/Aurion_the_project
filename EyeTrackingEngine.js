export default class EyeTrackingEngine {
  constructor(opts = {}) {
    this.video = opts.video ?? null;

    this.onStatus = opts.onStatus ?? (() => {});
    this.onGaze = opts.onGaze ?? (() => {});

    this.running = false;
    this.tracking = false;

    this.stream = null;
    this.faceLandmarker = null;
    this._rafId = null;
  }

  isCameraRunning() {
    return this.running;
  }

  isTrackingRunning() {
    return this.tracking;
  }

  async startCamera() {
    if (this.running) return true;
    if (!this.video) throw new Error("No video element provided");

    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: "user",
        width: { ideal: 640 },
        height: { ideal: 480 }
      },
      audio: false
    });

    this.stream = stream;
    this.video.srcObject = stream;
    await this.video.play();

    this.running = true;
    this.onStatus("Kamera aktiv");
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
    this.onStatus("Kamera aus");
  }

  async loadLandmarker() {
    const vision = await import(
      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/vision_bundle.mjs"
    );

    const filesetResolver = await vision.FilesetResolver.forVisionTasks(
      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm"
    );

    this.faceLandmarker = await vision.FaceLandmarker.createFromOptions(
      filesetResolver,
      {
        baseOptions: {
          modelAssetPath:
            "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task"
        },
        runningMode: "VIDEO",
        numFaces: 1,
        outputFaceBlendshapes: false
      }
    );
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

  async startTracking() {
    if (!this.running) throw new Error("Camera must be started first");
    if (this.tracking) return true;

    if (!this.faceLandmarker) {
      this.onStatus("Tracking lädt…");
      await this.loadLandmarker();
    }

    this.tracking = true;
    this.onStatus("Tracking läuft");
    this.trackLoop();
    return true;
  }

  stopTracking() {
    this.tracking = false;
    if (this._rafId) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
    this.onStatus("Tracking gestoppt");
  }

  trackLoop() {
    if (!this.tracking || !this.faceLandmarker || !this.video) return;

    const loop = () => {
      if (!this.tracking) return;

      const result = this.faceLandmarker.detectForVideo(
        this.video,
        performance.now()
      );

      if (result?.faceLandmarks?.length) {
        const lm = result.faceLandmarks[0];
        const iris = this.irisCenterNorm(lm);

        if (iris) {
          const x = innerWidth * (1 - iris.rx);
          const y = innerHeight * iris.ry;

          this.onGaze({
            x,
            y,
            rx: iris.rx,
            ry: iris.ry
          });
        }
      }

      this._rafId = requestAnimationFrame(loop);
    };

    loop();
  }
}
