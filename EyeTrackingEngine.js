// EyeTrackingEngine.js
export default class AurionEyeTrackingEngine {
  constructor(opts){
    this.video = opts.video;
    this.onGaze = opts.onGaze;
    this.onBlink = opts.onBlink;
    this.onDoubleBlink = opts.onDoubleBlink;
    this.onStatus = opts.onStatus;
    this.onSleepChange = opts.onSleepChange;

    this.running = false;
    this.tracking = false;

    this.lastBlink = 0;
    this.pendingBlink = false;
    this.firstBlinkTs = 0;

    this.BLINK_ON = 0.55;
    this.BLINK_OFF = 0.25;
    this.DOUBLE_MS = 900;
  }

  async startCamera(){
    const s = await navigator.mediaDevices.getUserMedia({
      video:true,
      audio:false
    });
    this.video.srcObject = s;
    await this.video.play();
    this.running = true;
  }

  stopCamera(){
    this.video.srcObject?.getTracks()?.forEach(t => t.stop());
    this.running = false;
  }

  async startTracking(){
    if(!this.running) return;

    const vision = await import("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest");
    const fs = await vision.FilesetResolver.forVisionTasks(
      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm"
    );

    this.landmarker = await vision.FaceLandmarker.createFromOptions(fs,{
      baseOptions:{
        modelAssetPath:"https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task"
      },
      runningMode:"VIDEO",
      numFaces:1,
      outputFaceBlendshapes:true
    });

    this.tracking = true;
    this.loop();
  }

  irisCenter(lm){
    const L = [lm?.[468], lm?.[469], lm?.[470], lm?.[471]].filter(Boolean);
    const R = [lm?.[473], lm?.[474], lm?.[475], lm?.[476]].filter(Boolean);

    if(L.length && R.length){
      const lx = L.reduce((a,p)=>a+p.x,0)/L.length;
      const ly = L.reduce((a,p)=>a+p.y,0)/L.length;
      const rx = R.reduce((a,p)=>a+p.x,0)/R.length;
      const ry = R.reduce((a,p)=>a+p.y,0)/R.length;
      return {x:(lx+rx)/2, y:(ly+ry)/2};
    }
    return null;
  }

  processBlink(blink){
    const now = Date.now();

    if(blink < this.BLINK_OFF){
      this.blinkArmed = true;
    }

    if(!this.pendingBlink){
      if(this.blinkArmed && blink > this.BLINK_ON){
        this.pendingBlink = true;
        this.firstBlinkTs = now;
        this.onBlink?.();
      }
    }else{
      if(now - this.firstBlinkTs < this.DOUBLE_MS){
        if(blink > this.BLINK_ON){
          this.pendingBlink = false;
          this.onDoubleBlink?.();
        }
      }else{
        this.pendingBlink = false;
      }
    }
  }

  loop(){
    if(!this.tracking) return;

    const res = this.landmarker.detectForVideo(this.video, performance.now());

    if(res?.faceLandmarks?.length){
      const lm = res.faceLandmarks[0];
      const iris = this.irisCenter(lm);

      if(iris){
        this.onGaze?.({
          x: innerWidth * (1 - iris.x),
          y: innerHeight * iris.y
        });
      }

      const cats = res.faceBlendshapes?.[0]?.categories || [];
      const blink = Math.max(
        cats.find(c=>c.categoryName==="eyeBlinkLeft")?.score || 0,
        cats.find(c=>c.categoryName==="eyeBlinkRight")?.score || 0
      );

      this.processBlink(blink);
    }

    requestAnimationFrame(()=>this.loop());
  }
}