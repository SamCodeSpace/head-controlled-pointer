/**
 * Coordinate Mapper
 * Translates normalized facial landmark coordinates [0..1] into viewport pixel
 * coordinates [0..innerWidth, 0..innerHeight] using neutral head calibration,
 * sensitivity gain, active movement range, and an optional micro-deadzone.
 */
export class CoordinateMapper {
  constructor(options = {}) {
    this.center = { x: 0.5, y: 0.5 };
    this.calibrated = false;
    this.sensitivityX = options.sensitivityX ?? 2.4;
    this.sensitivityY = options.sensitivityY ?? 2.4;
    // Active head range in normalized camera units (smaller = less head turn needed)
    this.movementRange = options.movementRange ?? 0.22;
    this.deadZone = options.deadZone ?? 0.002;
    this.mirrorX = options.mirrorX ?? true;
    this.lastNormalized = { x: 0.5, y: 0.5 };
  }

  /**
   * Sets the user's neutral head center from the current landmark sample.
   * @param {{x: number, y: number}} landmark
   */
  calibrate(landmark) {
    if (!landmark) return false;
    this.center = { x: landmark.x, y: landmark.y };
    this.calibrated = true;
    return true;
  }

  /**
   * Re-centers calibration to the last observed landmark.
   */
  recenter() {
    this.center = { ...this.lastNormalized };
    this.calibrated = true;
  }

  /**
   * Update sensitivity, movement range, or deadzone settings.
   */
  updateConfig(cfg = {}) {
    if (typeof cfg.sensitivityX === 'number') this.sensitivityX = cfg.sensitivityX;
    if (typeof cfg.sensitivityY === 'number') this.sensitivityY = cfg.sensitivityY;
    if (typeof cfg.movementRange === 'number') this.movementRange = Math.max(0.08, cfg.movementRange);
    if (typeof cfg.deadZone === 'number') this.deadZone = Math.max(0, cfg.deadZone);
    if (typeof cfg.mirrorX === 'boolean') this.mirrorX = cfg.mirrorX;
  }

  /**
   * Maps a normalized landmark coordinate (0..1) into viewport pixel coordinates.
   * @param {{x: number, y: number}} landmark
   * @param {number} viewportWidth
   * @param {number} viewportHeight
   * @returns {{x: number, y: number, dx: number, dy: number}}
   */
  mapToScreen(landmark, viewportWidth, viewportHeight) {
    this.lastNormalized = { x: landmark.x, y: landmark.y };

    // Auto-calibrate on first valid face frame if user hasn't calibrated yet
    if (!this.calibrated) {
      this.calibrate(landmark);
    }

    // Mirror X so turning head right moves pointer right (natural selfie-mirror behavior)
    let dx = this.mirrorX ? (this.center.x - landmark.x) : (landmark.x - this.center.x);
    let dy = landmark.y - this.center.y;

    // Apply small dead-zone around neutral center if configured
    if (Math.abs(dx) < this.deadZone) dx = 0;
    if (Math.abs(dy) < this.deadZone) dy = 0;

    // Normalize displacement by active movement range and apply sensitivity gain
    const halfRange = this.movementRange / 2;
    const normX = 0.5 + (dx / halfRange) * (this.sensitivityX * 0.25);
    const normY = 0.5 + (dy / halfRange) * (this.sensitivityY * 0.25);

    const clampedX = Math.max(0.005, Math.min(0.995, normX));
    const clampedY = Math.max(0.005, Math.min(0.995, normY));

    return {
      x: clampedX * viewportWidth,
      y: clampedY * viewportHeight,
      dx,
      dy,
    };
  }
}
