const engine = new EyeTrackingEngine({
  mode: "doubleblink",
  magnet: true,
  dwell: false,
  sleepToCenter: true,
  smoothing: 0.18
});

engine.startCamera();
engine.startTracking();
engine.basicCalibration();
engine.fineCalibration();