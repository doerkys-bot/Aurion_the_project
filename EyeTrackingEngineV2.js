alert("EyeTrackingEngine V2 geladen");

export default class EyeTrackingEngineV2 {
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

    this.stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user" },
      audio: false
    });

    this.video.srcObject = this.stream;
    await this.video.play();

    this.running = true;
    this.onStatus("Kamera aktiv");
    return true;
  }

  stopCamera() {
    if (this.stream) {
      this.stream.getTracks().forEach(t => t.stop());
    }

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
        numFaces: 1
      }
    );
  }

  async startTracking() {
    if (!this.running) throw new Error("Camera first");
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
    if (this._rafId) cancelAnimationFrame(this._rafId);
    this.onStatus("Tracking gestoppt");
  }

  trackLoop() {
    if (!this.tracking) return;

    const loop = () => {
      if (!this.tracking) return;

      const res = this.faceLandmarker.detectForVideo(
        this.video,
        performance.now()
      );

      if (res?.faceLandmarks?.length) {
        const lm = res.faceLandmarks[0];

        // Nasenpunkt (stabil)
        const p = lm[1];

        if (p) {
          const x = innerWidth * (1 - p.x);
          const y = innerHeight * p.y;

          this.onGaze({
            x,
            y
          });
        }
      }

      this._rafId = requestAnimationFrame(loop);
    };

    loop();
  }
}