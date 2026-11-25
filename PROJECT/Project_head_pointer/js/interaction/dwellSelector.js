/**
 * Dwell Selector
 * Enables hands-free selection by hovering the virtual head-controlled pointer
 * over any interactive DOM element (`button`, `a`, `input`, `[data-dwellable]`)
 * for a configurable duration.
 *
 * Includes:
 * - Visual SVG circular progress ring around the virtual pointer
 * - Configurable dwell duration (ms) and post-selection cooldown/delay (ms)
 * - Cancel / pause dwell selection toggle
 * - Unsuccessful dwell attempt callback (when user enters a target and leaves before completion)
 */
export class DwellSelector {
  constructor(ringCircleEl, options = {}) {
    this.ringCircleEl = ringCircleEl;
    this.circumference = 2 * Math.PI * 20; // r=20 in SVG
    if (this.ringCircleEl) {
      this.ringCircleEl.style.strokeDasharray = `${this.circumference}`;
      this.ringCircleEl.style.strokeDashoffset = `${this.circumference}`;
    }

    this.enabled = options.enabled ?? true;
    this.dwellDurationMs = options.dwellDurationMs ?? 1000;
    this.selectionDelayMs = options.selectionDelayMs ?? 400; // Cooldown before re-triggering
    this.currentTarget = null;
    this.dwellStartMs = null;
    this.cooldownUntilMs = 0;

    this.onSelect = null;
    this.onAttemptAborted = null;
  }

  updateConfig({ enabled, dwellDurationMs, selectionDelayMs }) {
    if (typeof enabled === 'boolean') {
      this.enabled = enabled;
      if (!enabled) this.cancelCurrentDwell();
    }
    if (typeof dwellDurationMs === 'number') {
      this.dwellDurationMs = Math.max(300, Math.min(3000, dwellDurationMs));
    }
    if (typeof selectionDelayMs === 'number') {
      this.selectionDelayMs = Math.max(0, Math.min(2000, selectionDelayMs));
    }
  }

  /**
   * Cancels any active dwell progress immediately.
   */
  cancelCurrentDwell() {
    if (this.currentTarget) {
      this.currentTarget.classList.remove('dwell-hover');
    }
    this.currentTarget = null;
    this.dwellStartMs = null;
    this._setRingProgress(0);
  }

  /**
   * Called every animation frame with the virtual pointer's viewport coordinates.
   * @param {number} x
   * @param {number} y
   * @param {number} nowMs
   */
  update(x, y, nowMs) {
    if (!this.enabled) {
      this._setRingProgress(0);
      return;
    }

    if (nowMs < this.cooldownUntilMs) {
      this._setRingProgress(0);
      return;
    }

    const hitEl = this._findDwellableTarget(x, y);

    if (hitEl !== this.currentTarget) {
      // If user left a target after starting a dwell (>150ms), log an aborted attempt
      if (this.currentTarget && this.dwellStartMs !== null && nowMs - this.dwellStartMs > 150) {
        if (typeof this.onAttemptAborted === 'function') {
          this.onAttemptAborted(this.currentTarget);
        }
      }
      if (this.currentTarget) {
        this.currentTarget.classList.remove('dwell-hover');
      }
      this.currentTarget = hitEl;
      this.dwellStartMs = hitEl ? nowMs : null;
      if (hitEl) {
        hitEl.classList.add('dwell-hover');
      }
      this._setRingProgress(0);
      return;
    }

    if (!this.currentTarget || this.dwellStartMs === null) {
      this._setRingProgress(0);
      return;
    }

    const elapsed = nowMs - this.dwellStartMs;
    const progress = Math.min(1, elapsed / this.dwellDurationMs);
    this._setRingProgress(progress);

    if (progress >= 1) {
      const target = this.currentTarget;
      target.classList.remove('dwell-hover');
      this.currentTarget = null;
      this.dwellStartMs = null;
      this._setRingProgress(0);
      this.cooldownUntilMs = nowMs + this.selectionDelayMs;

      // Trigger hands-free interaction on the DOM element
      if (target.tagName === 'INPUT' && target.type === 'range') {
        const rect = target.getBoundingClientRect();
        const ratio = Math.max(0, Math.min(1, (x - rect.left) / Math.max(1, rect.width)));
        const min = parseFloat(target.min || '0');
        const max = parseFloat(target.max || '100');
        const step = parseFloat(target.step || '1');
        const rawVal = min + ratio * (max - min);
        const snapped = Math.max(min, Math.min(max, Math.round((rawVal - min) / step) * step + min));
        target.value = String(Number(snapped.toFixed(4)));
        target.dispatchEvent(new Event('input', { bubbles: true }));
        target.dispatchEvent(new Event('change', { bubbles: true }));
      } else if (target.tagName === 'SELECT') {
        if (target.options && target.options.length > 0) {
          target.selectedIndex = (target.selectedIndex + 1) % target.options.length;
          target.dispatchEvent(new Event('change', { bubbles: true }));
        }
      } else if (typeof target.click === 'function') {
        target.click();
      }
      if (typeof this.onSelect === 'function') {
        this.onSelect(target);
      }
    }
  }

  _findDwellableTarget(x, y) {
    const el = document.elementFromPoint(x, y);
    if (!el) return null;
    const match = el.closest('[data-dwellable], button:not(:disabled), a[href], input[type="checkbox"], input[type="radio"], input[type="range"], select');
    if (!match || match.hasAttribute('data-no-dwell')) return null;
    return match;
  }

  _setRingProgress(ratio) {
    if (!this.ringCircleEl) return;
    const offset = this.circumference * (1 - Math.max(0, Math.min(1, ratio)));
    this.ringCircleEl.style.strokeDashoffset = `${offset.toFixed(1)}`;
  }
}
