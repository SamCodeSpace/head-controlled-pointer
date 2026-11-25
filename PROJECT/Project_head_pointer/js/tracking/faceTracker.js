/**
 * Face Tracker (Local Browser Webcam + MediaPipe Face Landmarker)
 * - Processes all video frames strictly on-device (never uploads or records video).
 * - Uses @mediapipe/tasks-vision FaceLandmarker with GPU->CPU delegate fallback.
 * - Includes an optional Simulated Head-Tracking mode (mouse + synthetic webcam noise)
 *   for offline testing, debugging, or environments where webcam access is blocked.
 */
const MEDIAPIPE_VISION_CDN = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14';
const MEDIAPIPE_WASM_CDN = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm';
const FACE_LANDMARKER_MODEL =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

export class FaceTracker {
  constructor(videoEl, overlayCanvas) {
    this.videoEl = videoEl;
    this.overlayCanvas = overlayCanvas;
    this.overlayCtx = overlayCanvas ? overlayCanvas.getContext('2d') : null;

    this.faceLandmarker = null;
    this.stream = null;
    this.isRunning = false;
    this.isModelLoading = false;
    this.faceDetected = false;
    this.lastVideoTime = -1;
    // MediaPipe Face Landmarker indices: 1 = nose tip, 168 = nose bridge (glabella)
    this.landmarkIndex = 1;

    // Simulated mode state (allows full testing without webcam permissions)
    this.simulationMode = false;
    this.simPointer = { x: 0.5, y: 0.5 };
    this.simNoiseLevel = 0.0045; // Realistic webcam landmark jitter in normalized units
    this._onSimMouseMove = (e) => {
      if (!this.simulationMode) return;
      // Convert mouse viewport position to synthetic mirrored nose coordinates
      const normX = e.clientX / Math.max(1, window.innerWidth);
      const normY = e.clientY / Math.max(1, window.innerHeight);
      this.simPointer.x = 0.5 - (normX - 0.5) * 0.22;
      this.simPointer.y = 0.5 + (normY - 0.5) * 0.22;
    };

    this.onStatusChange = null;
  }

  setLandmarkIndex(index) {
    this.landmarkIndex = Number(index) || 1;
  }

  /**
   * Lazily loads MediaPipe FaceLandmarker from jsDelivr + Google Storage.
   */
  async loadModel() {
    if (this.faceLandmarker) return true;
    this.isModelLoading = true;
    this._emitStatus('loading', 'Loading MediaPipe Face Landmarker model...');

    try {
      const visionModule = await import(MEDIAPIPE_VISION_CDN);
      const { FilesetResolver, FaceLandmarker } = visionModule;
      const filesetResolver = await FilesetResolver.forVisionTasks(MEDIAPIPE_WASM_CDN);

      try {
        this.faceLandmarker = await FaceLandmarker.createFromOptions(filesetResolver, {
          baseOptions: {
            modelAssetPath: FACE_LANDMARKER_MODEL,
            delegate: 'GPU',
          },
          runningMode: 'VIDEO',
          numFaces: 1,
          minFaceDetectionConfidence: 0.5,
          minFacePresenceConfidence: 0.5,
          minTrackingConfidence: 0.5,
        });
      } catch (_gpuErr) {
        // Fallback to CPU delegate if WebGL/GPU fails
        this.faceLandmarker = await FaceLandmarker.createFromOptions(filesetResolver, {
          baseOptions: {
            modelAssetPath: FACE_LANDMARKER_MODEL,
            delegate: 'CPU',
          },
          runningMode: 'VIDEO',
          numFaces: 1,
        });
      }

      this.isModelLoading = false;
      this._emitStatus('ready', 'Face Landmarker model ready.');
      return true;
    } catch (err) {
      this.isModelLoading = false;
      this._emitStatus(
        'error',
        `Could not load MediaPipe model (${err.message || 'network unavailable'}). You can switch to Simulated Head-Tracking Mode to test all features.`
      );
      return false;
    }
  }

  /**
   * Starts webcam capture and MediaPipe inference.
   */
  async startWebcam() {
    this.stopSimulation();
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      this._emitStatus(
        'error',
        'Webcam API is not available in this browser context (requires HTTPS or localhost). Use Simulated Head-Tracking Mode to test.'
      );
      return false;
    }

    this._emitStatus('loading', 'Requesting local webcam access...');
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 640 },
          height: { ideal: 480 },
          facingMode: 'user',
          frameRate: { ideal: 30 },
        },
        audio: false,
      });

      // Handle unexpected camera unplug / revocation
      const [track] = this.stream.getVideoTracks();
      if (track) {
        track.addEventListener('ended', () => {
          this.isRunning = false;
          this.faceDetected = false;
          this._emitStatus('disconnected', 'Webcam disconnected. Reconnect camera and click Start Tracking.');
        });
      }

      this.videoEl.srcObject = this.stream;
      await this.videoEl.play();

      const loaded = await this.loadModel();
      if (!loaded) {
        this.stop();
        return false;
      }

      this.isRunning = true;
      this.lastVideoTime = -1;
      this._emitStatus('tracking', 'Webcam active — local face tracking running.');
      return true;
    } catch (err) {
      let friendly = 'Unable to access webcam.';
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        friendly = 'Camera permission denied. Allow webcam access in browser settings or use Simulated Mode.';
      } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
        friendly = 'No webcam detected on this device. Use Simulated Head-Tracking Mode to explore the system.';
      } else if (err.name === 'NotReadableError') {
        friendly = 'Webcam is currently in use by another application.';
      }
      this._emitStatus('error', friendly);
      return false;
    }
  }

  /**
   * Starts Simulated Head-Tracking Mode (injects realistic Gaussian-like jitter onto mouse input).
   */
  startSimulation() {
    this.stopWebcamOnly();
    this.simulationMode = true;
    this.isRunning = true;
    this.faceDetected = true;
    window.addEventListener('mousemove', this._onSimMouseMove);
    this._emitStatus('simulated', 'Simulated Head-Tracking Mode active (mouse + synthetic webcam jitter).');
    return true;
  }

  stopSimulation() {
    if (this.simulationMode) {
      this.simulationMode = false;
      window.removeEventListener('mousemove', this._onSimMouseMove);
    }
  }

  stopWebcamOnly() {
    if (this.stream) {
      this.stream.getTracks().forEach((t) => t.stop());
      this.stream = null;
    }
    if (this.videoEl) {
      this.videoEl.srcObject = null;
    }
  }

  stop() {
    this.isRunning = false;
    this.faceDetected = false;
    this.stopSimulation();
    this.stopWebcamOnly();
    if (this.overlayCtx && this.overlayCanvas) {
      this.overlayCtx.clearRect(0, 0, this.overlayCanvas.width, this.overlayCanvas.height);
    }
    this._emitStatus('stopped', 'Tracking stopped.');
  }

  /**
   * Detects the tracked facial landmark for the current animation frame.
   * @param {number} nowMs - performance.now() timestamp
   * @param {boolean} showOverlay - Whether to draw landmark reticle on preview canvas
   * @returns {{detected: boolean, x: number, y: number, simulated: boolean}|null}
   */
  detectFrame(nowMs, showOverlay = true) {
    if (!this.isRunning) return null;

    if (this.simulationMode) {
      // Box-Muller approximate Gaussian jitter mimicking real webcam landmark noise
      const u1 = Math.max(1e-6, Math.random());
      const u2 = Math.random();
      const z0 = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
      const z1 = Math.sqrt(-2.0 * Math.log(u1)) * Math.sin(2.0 * Math.PI * u2);
      const sx = Math.max(0.05, Math.min(0.95, this.simPointer.x + z0 * this.simNoiseLevel));
      const sy = Math.max(0.05, Math.min(0.95, this.simPointer.y + z1 * this.simNoiseLevel));
      this.faceDetected = true;
      if (showOverlay) this._drawSimulatedOverlay(sx, sy);
      return { detected: true, x: sx, y: sy, simulated: true };
    }

    if (!this.faceLandmarker || !this.videoEl || this.videoEl.readyState < 2) {
      return null;
    }

    if (this.videoEl.currentTime === this.lastVideoTime) {
      return null;
    }
    this.lastVideoTime = this.videoEl.currentTime;

    let result;
    try {
      result = this.faceLandmarker.detectForVideo(this.videoEl, nowMs);
    } catch (_e) {
      return null;
    }

    if (result && result.faceLandmarks && result.faceLandmarks.length > 0) {
      const landmarks = result.faceLandmarks[0];
      const pt = landmarks[this.landmarkIndex] || landmarks[1];
      this.faceDetected = true;
      if (showOverlay) this._drawWebcamOverlay(landmarks, pt);
      return { detected: true, x: pt.x, y: pt.y, simulated: false };
    } else {
      this.faceDetected = false;
      if (showOverlay && this.overlayCtx && this.overlayCanvas) {
        this.overlayCtx.clearRect(0, 0, this.overlayCanvas.width, this.overlayCanvas.height);
      }
      return { detected: false, x: 0.5, y: 0.5, simulated: false };
    }
  }

  _drawWebcamOverlay(landmarks, trackedPt) {
    if (!this.overlayCtx || !this.overlayCanvas) return;
    const w = this.overlayCanvas.width;
    const h = this.overlayCanvas.height;
    const ctx = this.overlayCtx;
    ctx.clearRect(0, 0, w, h);

    // Draw subtle face mesh dots (sampled every 6th landmark for crisp 60fps rendering)
    ctx.fillStyle = 'rgba(56, 189, 248, 0.45)';
    for (let i = 0; i < landmarks.length; i += 6) {
      const lm = landmarks[i];
      ctx.beginPath();
      ctx.arc((1 - lm.x) * w, lm.y * h, 1.5, 0, Math.PI * 2);
      ctx.fill();
    }

    // Highlight tracked nose landmark
    const nx = (1 - trackedPt.x) * w;
    const ny = trackedPt.y * h;
    ctx.strokeStyle = '#10b981';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(nx, ny, 9, 0, Math.PI * 2);
    ctx.stroke();

    ctx.fillStyle = '#10b981';
    ctx.beginPath();
    ctx.arc(nx, ny, 3.5, 0, Math.PI * 2);
    ctx.fill();
  }

  _drawSimulatedOverlay(sx, sy) {
    if (!this.overlayCtx || !this.overlayCanvas) return;
    const w = this.overlayCanvas.width;
    const h = this.overlayCanvas.height;
    const ctx = this.overlayCtx;
    ctx.clearRect(0, 0, w, h);

    // Draw stylized face outline centered on simulated nose
    const nx = (1 - sx) * w;
    const ny = sy * h;
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.35)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.ellipse(nx, ny, 36, 46, 0, 0, Math.PI * 2);
    ctx.stroke();

    // Draw eyes
    ctx.fillStyle = 'rgba(148, 163, 184, 0.5)';
    ctx.beginPath();
    ctx.arc(nx - 14, ny - 12, 3, 0, Math.PI * 2);
    ctx.arc(nx + 14, ny - 12, 3, 0, Math.PI * 2);
    ctx.fill();

    // Tracked nose marker
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(nx, ny, 8, 0, Math.PI * 2);
    ctx.stroke();

    ctx.fillStyle = '#38bdf8';
    ctx.beginPath();
    ctx.arc(nx, ny, 3, 0, Math.PI * 2);
    ctx.fill();
  }

  _emitStatus(state, message) {
    if (typeof this.onStatusChange === 'function') {
      this.onStatusChange(state, message);
    }
  }
}
