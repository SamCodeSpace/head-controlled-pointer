import { MODE_META } from '../analytics/statsEngine.js';

/**
 * Fitts' Law Pointing Experiment Manager
 * Runs a structured within-subject evaluation across all three smoothing modes:
 *   1. Raw Tracking
 *   2. Moving Average
 *   3. One Euro Filter
 *
 * Features:
 * - Privacy notice & informed consent gate (anonymous participant ID only)
 * - Randomized condition ordering (Fisher-Yates shuffle) to reduce order/fatigue effects
 * - Practice trials before recorded experimental trials
 * - Varied target sizes (W: 44px, 68px, 96px) and distances (D)
 * - Dwell-based target acquisition with live ring fill
 * - Tracks selection time, misses (outside-target dwells/timeouts), and aborted dwell attempts
 * - Collects post-condition comfort rating (1–5)
 */
export class ExperimentManager {
  constructor(options) {
    this.arenaEl = options.arenaEl;
    this.onModeChange = options.onModeChange;
    this.onConditionCompleted = options.onConditionCompleted;
    this.onTrialsCompleted = options.onTrialsCompleted;
    this.onStatusUpdate = options.onStatusUpdate;
    this.getDwellDurationMs = options.getDwellDurationMs;
    this.getInputSource = options.getInputSource;

    this.active = false;
    this.awaitingComfort = false;
    this.participantId = '';
    this.conditionOrder = [];
    this.conditionIdx = 0;
    this.phase = 'idle'; // 'practice' | 'formal' | 'comfort' | 'done'
    this.practiceCount = 3;
    this.formalTrialsPerCondition = 9; // 3 sizes x 3 distances
    this.trialQueue = [];
    this.currentTrialIdx = 0;

    // Active target state
    this.targetEl = null;
    this.targetRingEl = null;
    this.currentTarget = null;
    this.trialStartMs = 0;
    this.lastCenter = null;
    this.dwellEnterMs = null;
    this.isInsideTarget = false;
    this.currentMisses = 0;
    this.currentAborted = 0;
    this.conditionTrialsBuffer = [];
    this.allSessionTrials = [];
  }

  /**
   * Starts a new full within-subject experiment session for an anonymous participant.
   */
  startSession({ participantId, practiceTrials = 3, formalTrials = 9 }) {
    this.participantId = participantId || `P${String(Math.floor(100 + Math.random() * 900))}`;
    this.practiceCount = Math.max(1, Math.min(6, Number(practiceTrials) || 3));
    this.formalTrialsPerCondition = Math.max(3, Math.min(18, Number(formalTrials) || 9));

    // Balanced 6-permutation Latin-square counterbalancing (eliminates Phase 1 order skew)
    const latinSquare = [
      ['raw', 'moving_average', 'one_euro'],
      ['moving_average', 'one_euro', 'raw'],
      ['one_euro', 'raw', 'moving_average'],
      ['raw', 'one_euro', 'moving_average'],
      ['moving_average', 'raw', 'one_euro'],
      ['one_euro', 'moving_average', 'raw'],
    ];
    const numMatch = String(this.participantId).match(/\d+/);
    const seqIdx = numMatch ? Math.max(0, parseInt(numMatch[0], 10) - 1) % latinSquare.length : Math.floor(Math.random() * latinSquare.length);
    this.conditionOrder = [...latinSquare[seqIdx]];

    this.conditionIdx = 0;
    this.allSessionTrials = [];
    this.active = true;
    this.awaitingComfort = false;

    this._startCondition(0);
  }

  stopSession() {
    this.active = false;
    this.awaitingComfort = false;
    this.phase = 'idle';
    this._clearArena();
    this._notify();
  }

  _startCondition(idx) {
    this.conditionIdx = idx;
    const mode = this.conditionOrder[idx];
    if (typeof this.onModeChange === 'function') {
      this.onModeChange(mode);
    }

    this.conditionTrialsBuffer = [];
    this.phase = 'practice';
    this.trialQueue = this._buildTrialQueue(this.practiceCount);
    this.currentTrialIdx = 0;
    this.lastCenter = null;

    this._spawnNextTarget();
    this._notify();
  }

  _buildTrialQueue(count) {
    const sizes = [44, 68, 96]; // Small, Medium, Large target diameters (px)
    const distFactors = [0.22, 0.34, 0.44]; // Relative to arena min dimension
    const queue = [];
    for (let i = 0; i < count; i++) {
      queue.push({
        size: sizes[i % sizes.length],
        distFactor: distFactors[Math.floor(i / sizes.length) % distFactors.length],
      });
    }
    // Shuffle trial geometry order
    for (let i = queue.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [queue[i], queue[j]] = [queue[j], queue[i]];
    }
    return queue;
  }

  _spawnNextTarget() {
    this._clearArena();
    if (!this.arenaEl) return;

    const rect = this.arenaEl.getBoundingClientRect();
    const w = Math.max(320, rect.width);
    const h = Math.max(260, rect.height);
    const spec = this.trialQueue[this.currentTrialIdx];
    const size = spec.size;
    const margin = size / 2 + 16;

    const prevX = this.lastCenter ? this.lastCenter.x : w / 2;
    const prevY = this.lastCenter ? this.lastCenter.y : h / 2;
    const desiredDist = Math.min(Math.min(w, h) * spec.distFactor, Math.min(w, h) * 0.44);

    // Pick a reachable angle that keeps target cleanly inside arena bounds
    let tx = w / 2;
    let ty = h / 2;
    let placed = false;
    for (let attempt = 0; attempt < 24; attempt++) {
      const angle = Math.random() * Math.PI * 2;
      const cx = prevX + Math.cos(angle) * desiredDist;
      const cy = prevY + Math.sin(angle) * desiredDist;
      if (cx >= margin && cx <= w - margin && cy >= margin && cy <= h - margin) {
        tx = cx;
        ty = cy;
        placed = true;
        break;
      }
    }
    if (!placed) {
      tx = margin + Math.random() * Math.max(10, w - 2 * margin);
      ty = margin + Math.random() * Math.max(10, h - 2 * margin);
    }

    const actualDist = Math.max(40, Math.hypot(tx - prevX, ty - prevY));
    this.currentTarget = {
      cx: tx,
      cy: ty,
      radius: size / 2,
      size,
      distance: actualDist,
    };
    this.lastCenter = { x: tx, y: ty };
    this.trialStartMs = performance.now();
    this.dwellEnterMs = null;
    this.isInsideTarget = false;
    this.currentMisses = 0;
    this.currentAborted = 0;

    // Render target DOM element with SVG dwell progress ring
    const btn = document.createElement('div');
    btn.className = `fitts-target ${this.phase === 'practice' ? 'is-practice' : ''}`;
    btn.setAttribute('data-no-dwell', 'true'); // Handled directly by ExperimentManager for exact timing
    btn.style.width = `${size}px`;
    btn.style.height = `${size}px`;
    btn.style.left = `${tx - size / 2}px`;
    btn.style.top = `${ty - size / 2}px`;

    const r = size / 2 - 4;
    const circ = 2 * Math.PI * r;
    btn.innerHTML = `
      <svg class="fitts-ring" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
        <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="rgba(15,23,42,0.14)" stroke-width="4" />
        <circle class="fitts-ring-progress" cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="#047857" stroke-width="4"
          stroke-dasharray="${circ.toFixed(1)}" stroke-dashoffset="${circ.toFixed(1)}"
          transform="rotate(-90 ${size / 2} ${size / 2})" />
      </svg>
      <span class="fitts-dot"></span>
    `;

    this.arenaEl.appendChild(btn);
    this.targetEl = btn;
    this.targetRingEl = btn.querySelector('.fitts-ring-progress');
    this.targetCircumference = circ;
  }

  /**
   * Called every animation frame with the virtual pointer's viewport coordinates.
   */
  updatePointer(viewportX, viewportY, nowMs) {
    if (!this.active || this.awaitingComfort || !this.currentTarget || !this.arenaEl) return;

    const rect = this.arenaEl.getBoundingClientRect();
    const localX = viewportX - rect.left;
    const localY = viewportY - rect.top;
    const distToCenter = Math.hypot(localX - this.currentTarget.cx, localY - this.currentTarget.cy);
    const inside = distToCenter <= this.currentTarget.radius;

    const dwellMs = this.getDwellDurationMs ? this.getDwellDurationMs() : 1000;

    if (inside) {
      if (!this.isInsideTarget) {
        this.isInsideTarget = true;
        this.dwellEnterMs = nowMs;
        if (this.targetEl) this.targetEl.classList.add('is-dwelling');
      }
      const elapsed = nowMs - this.dwellEnterMs;
      const progress = Math.min(1, elapsed / dwellMs);
      if (this.targetRingEl) {
        this.targetRingEl.style.strokeDashoffset = `${(this.targetCircumference * (1 - progress)).toFixed(1)}`;
      }
      if (progress >= 1) {
        this._completeCurrentTrial(nowMs);
      }
    } else {
      if (this.isInsideTarget) {
        // User entered target and slipped off before finishing dwell -> aborted attempt / miss
        const dwellHeld = nowMs - (this.dwellEnterMs || nowMs);
        if (dwellHeld > 120) {
          this.currentAborted += 1;
          this.currentMisses += 1;
        }
        this.isInsideTarget = false;
        this.dwellEnterMs = null;
        if (this.targetEl) this.targetEl.classList.remove('is-dwelling');
        if (this.targetRingEl) {
          this.targetRingEl.style.strokeDashoffset = `${this.targetCircumference.toFixed(1)}`;
        }
      }
    }
  }

  /**
   * Registers an explicit miss if the user triggers a click outside the target in the arena.
   */
  recordManualMiss() {
    if (!this.active || this.awaitingComfort) return;
    this.currentMisses += 1;
  }

  _completeCurrentTrial(nowMs) {
    const selectionTimeMs = Math.max(100, nowMs - this.trialStartMs);
    const mode = this.conditionOrder[this.conditionIdx];

    if (this.phase === 'formal') {
      this.conditionTrialsBuffer.push({
        participantId: this.participantId,
        condition: mode,
        conditionOrderIndex: this.conditionIdx + 1,
        trialNumber: this.currentTrialIdx + 1,
        targetSize: this.currentTarget.size,
        targetDistance: this.currentTarget.distance,
        selectionTimeMs,
        misses: this.currentMisses,
        unsuccessfulAttempts: this.currentAborted,
        comfortRating: null,
        inputSource: this.getInputSource ? this.getInputSource() : 'webcam',
        timestampIso: new Date().toISOString(),
      });
    }

    this.currentTrialIdx += 1;

    if (this.currentTrialIdx < this.trialQueue.length) {
      this._spawnNextTarget();
      this._notify();
      return;
    }

    // Finished current phase
    if (this.phase === 'practice') {
      this.phase = 'formal';
      this.trialQueue = this._buildTrialQueue(this.formalTrialsPerCondition);
      this.currentTrialIdx = 0;
      this._spawnNextTarget();
      this._notify();
    } else if (this.phase === 'formal') {
      // Prompt for 1–5 comfort rating for this condition
      this._clearArena();
      this.phase = 'comfort';
      this.awaitingComfort = true;
      this._notify();
    }
  }

  /**
   * Records the participant's 1–5 comfort rating for the just-completed condition
   * and advances to the next condition or finishes the experiment.
   */
  submitComfortRating(rating) {
    if (!this.awaitingComfort) return;
    const score = Math.max(1, Math.min(5, Number(rating) || 3));
    for (const t of this.conditionTrialsBuffer) {
      t.comfortRating = score;
    }
    const finishedBatch = [...this.conditionTrialsBuffer];
    this.allSessionTrials.push(...finishedBatch);
    this.conditionTrialsBuffer = [];
    this.awaitingComfort = false;

    if (typeof this.onConditionCompleted === 'function' && finishedBatch.length > 0) {
      this.onConditionCompleted(finishedBatch);
    }

    if (this.conditionIdx + 1 < this.conditionOrder.length) {
      this._startCondition(this.conditionIdx + 1);
    } else {
      this.active = false;
      this.phase = 'done';
      this._clearArena();
      if (typeof this.onTrialsCompleted === 'function') {
        this.onTrialsCompleted(this.allSessionTrials);
      }
      this._notify();
    }
  }

  _clearArena() {
    if (this.arenaEl) {
      const targets = this.arenaEl.querySelectorAll('.fitts-target');
      targets.forEach((el) => el.remove());
    }
    this.targetEl = null;
    this.targetRingEl = null;
    this.currentTarget = null;
  }

  _notify() {
    if (typeof this.onStatusUpdate !== 'function') return;
    const mode = this.conditionOrder[this.conditionIdx] || 'raw';
    this.onStatusUpdate({
      active: this.active,
      phase: this.phase,
      awaitingComfort: this.awaitingComfort,
      participantId: this.participantId,
      condition: mode,
      conditionLabel: MODE_META[mode] ? MODE_META[mode].label : mode,
      conditionStep: this.conditionIdx + 1,
      totalConditions: this.conditionOrder.length || 3,
      trialStep: Math.min(this.currentTrialIdx + 1, this.trialQueue.length || 1),
      totalTrialsInPhase: this.trialQueue.length || 0,
      completedSessionTrials: this.allSessionTrials.length,
    });
  }
}
