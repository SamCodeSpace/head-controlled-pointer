/**
 * Mode 2: Moving Average Filter
 * Computes the unweighted arithmetic mean over the last N frames.
 * Reduces high-frequency webcam jitter at the cost of fixed group delay (~(N-1)/2 frames).
 */
export class MovingAverageFilter {
  /**
   * @param {number} windowSize - Number of recent frames to average (2–20)
   */
  constructor(windowSize = 6) {
    this.name = 'moving_average';
    this.label = 'Moving Average';
    this.windowSize = Math.max(1, Math.round(windowSize));
    this.bufferX = [];
    this.bufferY = [];
  }

  /**
   * Update the sliding window size dynamically.
   * @param {number} size
   */
  setWindowSize(size) {
    this.windowSize = Math.max(1, Math.min(30, Math.round(size)));
    while (this.bufferX.length > this.windowSize) {
      this.bufferX.shift();
      this.bufferY.shift();
    }
  }

  /**
   * Smooths a 2D point using a sliding window average.
   * @param {number} x
   * @param {number} y
   * @param {number} _timestampMs
   * @returns {{x: number, y: number}}
   */
  filter(x, y, _timestampMs) {
    this.bufferX.push(x);
    this.bufferY.push(y);

    if (this.bufferX.length > this.windowSize) {
      this.bufferX.shift();
      this.bufferY.shift();
    }

    let sumX = 0;
    let sumY = 0;
    const n = this.bufferX.length;
    for (let i = 0; i < n; i++) {
      sumX += this.bufferX[i];
      sumY += this.bufferY[i];
    }

    return { x: sumX / n, y: sumY / n };
  }

  /**
   * Clears the frame buffer (call when tracking restarts or mode switches).
   */
  reset() {
    this.bufferX = [];
    this.bufferY = [];
  }
}
