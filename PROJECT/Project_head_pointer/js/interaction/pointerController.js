/**
 * Pointer Controller
 * Renders and updates the custom browser-based virtual pointer overlay,
 * tracks instantaneous jitter (RMS displacement) and pointer velocity for telemetry.
 */
export class PointerController {
  constructor(pointerEl) {
    this.pointerEl = pointerEl;
    this.x = window.innerWidth / 2;
    this.y = window.innerHeight / 2;
    this.visible = false;
    this.paused = false;

    // Rolling window for real-time jitter & speed telemetry
    this.history = [];
    this.maxHistory = 30;
  }

  show() {
    this.visible = true;
    if (this.pointerEl) {
      this.pointerEl.classList.remove('hidden');
    }
  }

  hide() {
    this.visible = false;
    if (this.pointerEl) {
      this.pointerEl.classList.add('hidden');
    }
  }

  setPaused(isPaused) {
    this.paused = isPaused;
    if (this.pointerEl) {
      this.pointerEl.classList.toggle('pointer-paused', isPaused);
    }
  }

  recenter() {
    this.update(window.innerWidth / 2, window.innerHeight / 2, performance.now());
  }

  /**
   * Moves the virtual cursor to (x, y) and updates motion metrics.
   */
  update(x, y, timestampMs) {
    if (this.paused) return;
    this.x = x;
    this.y = y;

    if (this.pointerEl) {
      this.pointerEl.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
    }

    this.history.push({ x, y, t: timestampMs });
    if (this.history.length > this.maxHistory) {
      this.history.shift();
    }
  }

  /**
   * Triggers a brief visual pulse on the pointer when a dwell selection fires.
   */
  triggerClickPulse() {
    if (!this.pointerEl) return;
    this.pointerEl.classList.remove('pointer-clicked');
    // Force reflow to restart animation
    void this.pointerEl.offsetWidth;
    this.pointerEl.classList.add('pointer-clicked');
  }

  /**
   * Computes real-time stability telemetry:
   * - jitterPx: standard deviation of recent pointer positions (px)
   * - velocityPxPerSec: instantaneous speed (px/s)
   */
  getTelemetry() {
    const n = this.history.length;
    if (n < 2) return { jitterPx: 0, velocityPxPerSec: 0 };

    let meanX = 0;
    let meanY = 0;
    for (let i = 0; i < n; i++) {
      meanX += this.history[i].x;
      meanY += this.history[i].y;
    }
    meanX /= n;
    meanY /= n;

    let sqSum = 0;
    for (let i = 0; i < n; i++) {
      const dx = this.history[i].x - meanX;
      const dy = this.history[i].y - meanY;
      sqSum += dx * dx + dy * dy;
    }
    const jitterPx = Math.sqrt(sqSum / n);

    const prev = this.history[n - 2];
    const curr = this.history[n - 1];
    const dt = Math.max(0.001, (curr.t - prev.t) / 1000);
    const dist = Math.hypot(curr.x - prev.x, curr.y - prev.y);
    const velocityPxPerSec = dist / dt;

    return { jitterPx, velocityPxPerSec };
  }
}
