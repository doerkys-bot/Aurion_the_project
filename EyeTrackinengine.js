export default class AurionEyeTrackingEngine {

  constructor(opts = {}) {
    this.video = opts.video ?? null;
    this.running = false;
    this.tracking = false;

    this.onStatus = opts.onStatus ?? (()=>{});
    this.onBlink = opts.onBlink ?? (()=>{});
    this.onDoubleBlink = opts.onDoubleBlink ?? (()=>{});
    this.onLookLeft = opts.onLookLeft ?? (()=>{});
    this.onLookRight = opts.onLookRight ?? (()=>{});
    this.onLookUp = opts.onLookUp ?? (()=>{});
    this.onLookDown = opts.onLookDown ?? (()=>{});
    this.onGaze = opts.onGaze ?? (()=>{});
  }

  isCameraRunning(){
    return this.running;
  }

  isTrackingRunning(){
    return this.tracking;
  }

  async startCamera(){
    if(this.running) return true;

    const stream = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: false
    });

    this.video.srcObject = stream;
    await this.video.play();

    this.running = true;
    this.onStatus("Kamera aktiv");
    return true;
  }

  stopCamera(){
    if(this.video && this.video.srcObject){
      this.video.srcObject.getTracks().forEach(t => t.stop());
      this.video.srcObject = null;
    }
    this.running = false;
    this.onStatus("Kamera aus");
  }

  async startTracking(){
    this.tracking = true;
    this.onStatus("Tracking läuft (Testmodus)");
    return true;
  }

  stopTracking(){
    this.tracking = false;
    this.onStatus("Tracking gestoppt");
  }

  async calibrateDirection(dir){
    return true;
  }

  confirmCalibration(){}

  getCalibrationData(){
    return {
      minX:0.2,
      maxX:0.8,
      minY:0.2,
      maxY:0.8
    };
  }

  loadCalibration(data){}
}
