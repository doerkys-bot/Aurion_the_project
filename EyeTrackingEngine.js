export default class AurionEyeTrackingEngine {
  constructor(options = {}) {
    this.video = options.video;
    this.onStatus = options.onStatus || (() => {});
    this.cameraRunning = false;
    this.trackingRunning = false;
    this.onStatus("Mini-Engine lebt");
  }

  isCameraRunning() {
    return this.cameraRunning;
  }

  isTrackingRunning() {
    return this.trackingRunning;
  }

  async startCamera() {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("Kamera nicht verfügbar");
    }

    const stream = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: false
    });

    this.video.srcObject = stream;
    await this.video.play();
    this.cameraRunning = true;
    this.onStatus("Mini-Kamera an");
  }

  stopCamera() {
    if (this.video.srcObject) {
      this.video.srcObject.getTracks().forEach(t => t.stop());
    }
    this.video.srcObject = null;
    this.cameraRunning = false;
    this.onStatus("Mini-Kamera aus");
  }

  async startTracking() {
    this.trackingRunning = true;
    this.onStatus("Mini-Tracking an");
  }

  stopTracking() {
    this.trackingRunning = false;
    this.onStatus("Mini-Tracking aus");
  }

  calibrateDirection() {
    return Promise.resolve();
  }

  confirmCalibration() {}

  getCalibrationData() {
    return null;
  }

  loadCalibration() {}
}