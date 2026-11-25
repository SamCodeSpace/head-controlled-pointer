/**
 * Mode 1: Raw Tracking Filter (Baseline)
 * Passes incoming normalized landmark coordinates through unchanged.
 * Used as the unsmoothed baseline condition in the Fitts' Law experiment.
 */
export class RawFilter {
  constructor() {
    this.name = 'raw';
    this.label = 'Raw Tracking';
  }

  /**
   * Returns the raw point unmodified.
   * @param {number} x - Raw X coordinate
   * @param {number} y - Raw Y coordinate
   * @param {number} _timestampMs - Frame timestamp in ms (unused)
   * @returns {{x: number, y: number}}
   */
  filter(x, y, _timestampMs) {
    return { x, y };
  }

  /**
   * Resets internal state (no-op for raw pass-through).
   */
  reset() {}
}
