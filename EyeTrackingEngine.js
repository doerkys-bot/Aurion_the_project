export default class EyeTrackingEngine {
  constructor(options = {}) {
    this.video = options.video;
    this.onStatus = options.onStatus || (() => {});
    this.onGaze = options.onGaze || (() => {});
    this.stream = null;
    this.tracking = false;
    this.timer = null;
    this.t = 0;
  }

  async startCamera() {
    if (this.stream) return;

    this.stream = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: false
    });

    this.video.srcObject = this.stream;
    await this.video.play();
    this.onStatus("Kamera läuft");
  }

  stopCamera() {
    this.stopTracking();

    if (this.stream) {
      this.stream.getTracks().forEach(t => t.stop());
      this.stream = null;
    }

    if (this.video) {
      this.video.pause();
      this.video.srcObject = null;
    }

    this.onStatus("Kamera gestoppt");
  }

  isCameraRunning() {
    return !!this.stream;
  }

  async startTracking() {
    if (!this.stream) {
      throw new Error("Kamera läuft nicht");
    }

    if (this.tracking) return;

    this.tracking = true;
    this.onStatus("Tracking läuft");

    this.timer = setInterval(() => {
      this.t += 0.06;

      const x = window.innerWidth  * 0.5 + Math.cos(this.t) * 160;
      const y = window.innerHeight * 0.5 + Math.sin(this.t * 1.4) * 110;

      this.onGaze({ x, y });
    }, 30);
  }

  stopTracking() {
    this.tracking = false;

    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }

    this.onStatus("Tracking gestoppt");
  }

  isTrackingRunning() {
    return this.tracking;
  }
}