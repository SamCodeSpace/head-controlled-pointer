/**
 * Mode 3: One Euro Filter (1€ Filter)
 * Reference: Casiez, G., Roussel, N., & Vogel, D. (2012).
 * "1€ Filter: A Simple Speed-based Low-pass Filter for Noisy Input in Interactive Systems."
 * ACM CHI 2012, pp. 2527–2530. https://gery.casiez.net/publications/CHI2012-casiez.pdf
 *
 * Adapts its cutoff frequency based on signal velocity:
 * - Low speed  -> low cutoff -> strong jitter suppression (steady dwell)
 * - High speed -> high cutoff -> minimal lag (fast ballistic movement)
 */
class LowPassFilter1D {
  constructor() {
    this.initialized = false;
    this.hatX = 0;
  }

  filter(x, alpha) {
    if (!this.initialized) {
      this.initialized = true;
      this.hatX = x;
      return x;
    }
    this.hatX = alpha * x + (1 - alpha) * this.hatX;
    return this.hatX;
  }

  reset() {
    this.initialized = false;
    this.hatX = 0;
  }
}

class OneEuroFilter1D {
  constructor(minCutoff = 1.0, beta = 0.007, dCutoff = 1.0) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
    this.xFilter = new LowPassFilter1D();
    this.dxFilter = new LowPassFilter1D();
    this.lastTimestamp = null;
    this.lastRaw = null;
  }

  alpha(cutoff, dt) {
    const tau = 1.0 / (2 * Math.PI * cutoff);
    return 1.0 / (1.0 + tau / dt);
  }

  filter(x, timestampSec) {
    if (this.lastTimestamp === null) {
      this.lastTimestamp = timestampSec;
      this.lastRaw = x;
      return this.xFilter.filter(x, 1.0);
    }

    // Guard against duplicate or zero timestamps
    const dt = Math.max(1e-4, timestampSec - this.lastTimestamp);
    this.lastTimestamp = timestampSec;

    // Estimate derivative (signal speed) and smooth it
    const rawDx = (x - this.lastRaw) / dt;
    this.lastRaw = x;
    const edx = this.dxFilter.filter(rawDx, this.alpha(this.dCutoff, dt));

    // Adaptive cutoff rises linearly with speed
    const cutoff = this.minCutoff + this.beta * Math.abs(edx);
    return this.xFilter.filter(x, this.alpha(cutoff, dt));
  }

  reset() {
    this.xFilter.reset();
    this.dxFilter.reset();
    this.lastTimestamp = null;
    this.lastRaw = null;
  }
}

export class OneEuroFilter2D {
  /**
   * @param {{minCutoff?: number, beta?: number, dCutoff?: number}} params
   */
  constructor({ minCutoff = 1.0, beta = 0.007, dCutoff = 1.0 } = {}) {
    this.name = 'one_euro';
    this.label = 'One Euro Filter';
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
    this.filterX = new OneEuroFilter1D(minCutoff, beta, dCutoff);
    this.filterY = new OneEuroFilter1D(minCutoff, beta, dCutoff);
  }

  /**
   * Update filter parameters in real time.
   */
  setParams({ minCutoff, beta, dCutoff }) {
    if (typeof minCutoff === 'number') {
      this.minCutoff = Math.max(0.05, minCutoff);
      this.filterX.minCutoff = this.minCutoff;
      this.filterY.minCutoff = this.minCutoff;
    }
    if (typeof beta === 'number') {
      this.beta = Math.max(0, beta);
      this.filterX.beta = this.beta;
      this.filterY.beta = this.beta;
    }
    if (typeof dCutoff === 'number') {
      this.dCutoff = Math.max(0.1, dCutoff);
      this.filterX.dCutoff = this.dCutoff;
      this.filterY.dCutoff = this.dCutoff;
    }
  }

  /**
   * Filter a 2D point given a millisecond timestamp.
   * @param {number} x
   * @param {number} y
   * @param {number} timestampMs
   * @returns {{x: number, y: number}}
   */
  filter(x, y, timestampMs) {
    const tSec = timestampMs / 1000.0;
    return {
      x: this.filterX.filter(x, tSec),
      y: this.filterY.filter(y, tSec),
    };
  }

  reset() {
    this.filterX.reset();
    this.filterY.reset();
  }
}
