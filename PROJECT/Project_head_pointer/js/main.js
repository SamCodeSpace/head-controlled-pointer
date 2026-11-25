import { RawFilter } from './filters/rawFilter.js';
import { MovingAverageFilter } from './filters/movingAverage.js';
import { OneEuroFilter2D } from './filters/oneEuroFilter.js';
import { CoordinateMapper } from './tracking/coordinateMapper.js';
import { FaceTracker } from './tracking/faceTracker.js';
import { PointerController } from './interaction/pointerController.js';
import { DwellSelector } from './interaction/dwellSelector.js';
import { ExperimentManager } from './experiment/experimentManager.js';
import { StorageManager } from './data/storageManager.js';
import { trialsToCsv, summaryToCsv, downloadCsv, parseTrialsCsv } from './data/csvExporter.js';
import { computeModeSummaries } from './analytics/statsEngine.js';
import { DashboardCharts } from './analytics/dashboardCharts.js';
import { UIManager } from './ui/uiManager.js';

/**
 * Application Bootstrap & Main Real-Time Loop
 * Coordinates FaceTracker -> CoordinateMapper -> Active Smoothing Filter ->
 * PointerController -> DwellSelector / ExperimentManager at display refresh rate.
 */
class HeadControlledPointerApp {
  constructor() {
    this.filters = {
      raw: new RawFilter(),
      moving_average: new MovingAverageFilter(6),
      one_euro: new OneEuroFilter2D({ minCutoff: 1.0, beta: 0.007, dCutoff: 1.0 }),
    };
    this.activeMode = 'one_euro';
    this.isPaused = false;
    this.showPreview = true;
    this.lastLandmark = null;
    this.rafId = null;

    this.storage = new StorageManager();
    this.dashboardCharts = new DashboardCharts();
    this.ui = new UIManager(this.dashboardCharts);

    this.mapper = new CoordinateMapper({
      sensitivityX: 2.4,
      sensitivityY: 2.4,
      movementRange: 0.22,
      deadZone: 0.002,
    });

    this.tracker = new FaceTracker(
      document.getElementById('webcam-video'),
      document.getElementById('webcam-overlay')
    );

    this.pointer = new PointerController(document.getElementById('virtual-pointer'));
    this.dwell = new DwellSelector(document.getElementById('dwell-ring-progress'), {
      enabled: true,
      dwellDurationMs: 1000,
      selectionDelayMs: 450,
    });

    this.experiment = new ExperimentManager({
      arenaEl: document.getElementById('experiment-arena'),
      onModeChange: (modeKey) => this.setSmoothingMode(modeKey, true),
      onConditionCompleted: async (batch) => {
        await this.storage.saveTrials(batch);
        await this.refreshAnalytics();
        this.ui.showToast(`Saved ${batch.length} trials for ${batch[0].participantId} (${batch[0].condition}).`, 'success');
      },
      onTrialsCompleted: async (trials) => {
        await this.refreshAnalytics();
        this.ui.showToast(`All 3 conditions complete for ${trials[0]?.participantId || 'participant'} (${trials.length} total trials stored).`, 'success');
      },
      onStatusUpdate: (status) => this._renderExperimentStatus(status),
      getDwellDurationMs: () => this.dwell.dwellDurationMs,
      getInputSource: () => (this.tracker.simulationMode ? 'simulated' : 'webcam'),
    });
  }

  async init() {
    await this.storage.init();

    this.tracker.onStatusChange = (state, msg) => {
      this.ui.updateTrackingBadge(state, msg);
      if (state === 'error' || state === 'disconnected') {
        this.ui.showToast(msg, 'error');
      }
    };

    this.dwell.onSelect = () => {
      this.pointer.triggerClickPulse();
    };

    this.ui.initNavigation((section) => {
      if (section === 'results' || section === 'export') {
        this.refreshAnalytics();
      }
    });

    this._bindControls();
    this._bindKeyboardShortcuts();
    this.setSmoothingMode(this.activeMode, false);
    await this.refreshAnalytics();
  }

  setSmoothingMode(modeKey, silent = false) {
    if (!this.filters[modeKey]) return;
    this.activeMode = modeKey;
    this.filters[modeKey].reset();
    this.ui.updateModeBadges(modeKey);
    this.ui.clearTrail();
    if (!silent) {
      this.ui.showToast(`Switched smoothing mode to ${this.filters[modeKey].label}.`, 'info');
    }
  }

  async startWebcamTracking() {
    const ok = await this.tracker.startWebcam();
    if (ok) {
      this.isPaused = false;
      this.pointer.setPaused(false);
      this.pointer.show();
      this.filters[this.activeMode].reset();
      this._startLoop();
      this.ui.showToast('Webcam head tracking started locally.', 'success');
    }
  }

  startSimulatedTracking() {
    this.tracker.startSimulation();
    this.isPaused = false;
    this.pointer.setPaused(false);
    this.pointer.show();
    this.mapper.calibrate({ x: 0.5, y: 0.5 });
    this.filters[this.activeMode].reset();
    this._startLoop();
    this.ui.showToast('Simulated Head-Tracking Mode started (move mouse to steer with synthetic jitter).', 'info');
  }

  stopTracking() {
    this.tracker.stop();
    this._stopLoop();
    this.pointer.hide();
    this.dwell.cancelCurrentDwell();
  }

  togglePause() {
    if (!this.tracker.isRunning) {
      this.ui.showToast('Start webcam or simulated tracking first.', 'info');
      return;
    }
    this.isPaused = !this.isPaused;
    this.pointer.setPaused(this.isPaused);
    if (this.isPaused) {
      this.dwell.cancelCurrentDwell();
      this.ui.updateTrackingBadge('paused', 'Tracking paused. Press Resume or Spacebar to continue.');
    } else {
      const st = this.tracker.simulationMode ? 'simulated' : 'tracking';
      this.ui.updateTrackingBadge(st, 'Tracking resumed.');
    }
    const pauseBtn = document.getElementById('btn-pause-tracking');
    if (pauseBtn) pauseBtn.textContent = this.isPaused ? 'Resume Tracking' : 'Pause Tracking';
  }

  calibrateHeadCenter() {
    if (this.lastLandmark) {
      this.mapper.calibrate(this.lastLandmark);
      this.filters[this.activeMode].reset();
      this.pointer.recenter();
      this.ui.showToast('Neutral head position calibrated.', 'success');
    } else {
      this.mapper.recenter();
      this.pointer.recenter();
      this.ui.showToast('Pointer recentered. Start tracking to calibrate live head pose.', 'info');
    }
  }

  _startLoop() {
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    const step = (nowMs) => {
      if (!this.tracker.isRunning) return;
      const frame = this.tracker.detectFrame(nowMs, this.showPreview);

      if (frame) {
        if (!frame.detected) {
          this.ui.updateTrackingBadge('lost', 'Face temporarily lost — center your face in good lighting.');
          this.dwell.cancelCurrentDwell();
        } else if (!this.isPaused) {
          if (!frame.simulated) {
            this.ui.updateTrackingBadge('tracking', 'Face detected — tracking locally in browser.');
          }
          this.lastLandmark = { x: frame.x, y: frame.y };

          // 1. Map normalized landmark coordinates to screen viewport pixels first
          const mapped = this.mapper.mapToScreen(frame, window.innerWidth, window.innerHeight);

          // 2. Apply active smoothing filter in viewport pixel space (proper scale for One Euro beta)
          const filtered = this.filters[this.activeMode].filter(mapped.x, mapped.y, nowMs);

          // 3. Move virtual pointer
          this.pointer.update(filtered.x, filtered.y, nowMs);

          // 4. Update Dwell Selector (disabled inside active Fitts' Law arena so ExperimentManager owns target dwell)
          if (this.experiment.active && !this.experiment.awaitingComfort) {
            this.dwell.cancelCurrentDwell();
            this.experiment.updatePointer(filtered.x, filtered.y, nowMs);
          } else {
            this.dwell.update(filtered.x, filtered.y, nowMs);
          }

          // 5. Update telemetry HUD
          const { jitterPx, velocityPxPerSec } = this.pointer.getTelemetry();
          this.ui.updateTelemetry(jitterPx, velocityPxPerSec, filtered.x, filtered.y, this.activeMode);
        }
      }
      this.rafId = requestAnimationFrame(step);
    };
    this.rafId = requestAnimationFrame(step);
  }

  _stopLoop() {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  async refreshAnalytics() {
    const trials = await this.storage.getAllTrials();
    this.ui.renderDashboard(trials);
  }

  _renderExperimentStatus(st) {
    const badge = document.getElementById('exp-phase-badge');
    const condEl = document.getElementById('exp-current-condition');
    const progText = document.getElementById('exp-progress-text');
    const progBar = document.getElementById('exp-progress-bar');
    const comfortCard = document.getElementById('exp-comfort-panel');
    const setupCard = document.getElementById('exp-setup-panel');
    const arenaWrap = document.getElementById('exp-arena-wrapper');

    if (setupCard) setupCard.classList.toggle('hidden', st.active || st.awaitingComfort);
    if (arenaWrap) arenaWrap.classList.toggle('hidden', !st.active && !st.awaitingComfort);
    if (comfortCard) comfortCard.classList.toggle('hidden', !st.awaitingComfort);

    if (badge) {
      badge.textContent =
        st.phase === 'practice'
          ? 'Practice Trials (Not Recorded)'
          : st.phase === 'formal'
          ? 'Recorded Experiment Trials'
          : st.phase === 'comfort'
          ? 'Condition Comfort Rating'
          : 'Ready';
    }
    if (condEl) {
      condEl.textContent = `Condition ${st.conditionStep} of ${st.totalConditions}: ${st.conditionLabel}`;
    }
    if (progText) {
      progText.textContent =
        st.phase === 'comfort'
          ? `Rate comfort for ${st.conditionLabel} (1–5)`
          : `Trial ${st.trialStep} of ${st.totalTrialsInPhase}`;
    }
    if (progBar) {
      const pct =
        st.totalTrialsInPhase > 0
          ? Math.round(((st.trialStep - 1) / st.totalTrialsInPhase) * 100)
          : 0;
      progBar.style.width = `${st.phase === 'comfort' ? 100 : pct}%`;
    }
  }

  _bindControls() {
    const on = (id, evt, fn) => {
      const el = document.getElementById(id);
      if (el) el.addEventListener(evt, fn);
    };

    // Tracking controls
    on('btn-start-webcam', 'click', () => this.startWebcamTracking());
    on('btn-start-sim', 'click', () => this.startSimulatedTracking());
    on('btn-stop-tracking', 'click', () => this.stopTracking());
    on('btn-pause-tracking', 'click', () => this.togglePause());
    on('btn-calibrate', 'click', () => this.calibrateHeadCenter());
    on('btn-recenter', 'click', () => {
      this.pointer.recenter();
      this.mapper.recenter();
      this.ui.showToast('Pointer recentered.', 'info');
    });
    on('btn-quick-start-live', 'click', () => {
      this.ui.showSection('live');
      this.startWebcamTracking();
    });
    on('btn-quick-start-sim', 'click', () => {
      this.ui.showSection('live');
      this.startSimulatedTracking();
    });

    // Webcam preview toggle
    on('toggle-webcam-preview', 'change', (e) => {
      this.showPreview = e.target.checked;
      const box = document.getElementById('webcam-preview-box');
      if (box) box.classList.toggle('hidden', !this.showPreview);
    });

    // Landmark choice (Nose Tip #1 vs Nose Bridge #168)
    on('select-landmark', 'change', (e) => {
      this.tracker.setLandmarkIndex(Number(e.target.value));
      this.ui.showToast('Updated tracked facial landmark.', 'info');
    });

    // Mode switcher buttons across Live, Settings, and Mode Comparison
    document.querySelectorAll('[data-mode-select]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const mode = btn.getAttribute('data-mode-select');
        this.setSmoothingMode(mode);
      });
    });

    on('btn-clear-trail', 'click', () => this.ui.clearTrail());

    // Sensitivity, Range, Dead-zone sliders
    const bindSlider = (id, outId, formatter, onVal) => {
      const el = document.getElementById(id);
      const out = document.getElementById(outId);
      if (!el) return;
      const sync = () => {
        const v = Number(el.value);
        if (out) out.textContent = formatter(v);
        onVal(v);
      };
      el.addEventListener('input', sync);
      sync();
    };

    bindSlider('slider-sens-x', 'val-sens-x', (v) => `${v.toFixed(1)}x`, (v) =>
      this.mapper.updateConfig({ sensitivityX: v })
    );
    bindSlider('slider-sens-y', 'val-sens-y', (v) => `${v.toFixed(1)}x`, (v) =>
      this.mapper.updateConfig({ sensitivityY: v })
    );
    bindSlider('slider-range', 'val-range', (v) => `${Math.round(v * 100)}%`, (v) =>
      this.mapper.updateConfig({ movementRange: v })
    );
    bindSlider('slider-deadzone', 'val-deadzone', (v) => `${(v * 1000).toFixed(1)}`, (v) =>
      this.mapper.updateConfig({ deadZone: v })
    );

    // Filter parameter sliders
    bindSlider('slider-ma-window', 'val-ma-window', (v) => `${Math.round(v)} frames`, (v) =>
      this.filters.moving_average.setWindowSize(v)
    );
    bindSlider('slider-oe-mincutoff', 'val-oe-mincutoff', (v) => `${v.toFixed(2)} Hz`, (v) =>
      this.filters.one_euro.setParams({ minCutoff: v })
    );
    bindSlider('slider-oe-beta', 'val-oe-beta', (v) => v.toFixed(3), (v) =>
      this.filters.one_euro.setParams({ beta: v })
    );

    // Dwell controls
    on('toggle-dwell-enabled', 'change', (e) => {
      this.dwell.updateConfig({ enabled: e.target.checked });
    });
    bindSlider('slider-dwell-ms', 'val-dwell-ms', (v) => `${Math.round(v)} ms`, (v) =>
      this.dwell.updateConfig({ dwellDurationMs: v })
    );
    bindSlider('slider-dwell-delay', 'val-dwell-delay', (v) => `${Math.round(v)} ms`, (v) =>
      this.dwell.updateConfig({ selectionDelayMs: v })
    );

    // Experiment controls
    on('btn-start-experiment', 'click', () => {
      const consent = document.getElementById('exp-consent-checkbox');
      if (consent && !consent.checked) {
        this.ui.showToast('Please review and check the informed consent box before starting.', 'error');
        return;
      }
      if (!this.tracker.isRunning) {
        this.startSimulatedTracking();
        this.ui.showToast('Started Simulated Mode automatically so you can run the experiment right away.', 'info');
      }
      const pidInput = document.getElementById('exp-participant-id');
      const practiceInput = document.getElementById('exp-practice-count');
      const formalInput = document.getElementById('exp-formal-count');
      this.experiment.startSession({
        participantId: pidInput ? pidInput.value.trim() : '',
        practiceTrials: practiceInput ? Number(practiceInput.value) : 3,
        formalTrials: formalInput ? Number(formalInput.value) : 9,
      });
    });

    on('btn-abort-experiment', 'click', () => {
      this.experiment.stopSession();
      this.ui.showToast('Experiment session stopped.', 'info');
    });

    document.querySelectorAll('[data-comfort-score]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const score = Number(btn.getAttribute('data-comfort-score'));
        this.experiment.submitComfortRating(score);
      });
    });

    // Data Export & Import controls
    const exportTrialsHandler = async () => {
      const trials = await this.storage.getAllTrials();
      if (!trials.length) {
        this.ui.showToast('No experiment trials to export yet.', 'info');
        return;
      }
      downloadCsv(trialsToCsv(trials), `head_pointer_trials_${new Date().toISOString().slice(0, 10)}.csv`);
      this.ui.showToast(`Exported ${trials.length} trial rows to CSV.`, 'success');
    };
    on('btn-export-trials-csv', 'click', exportTrialsHandler);
    on('btn-dashboard-export-csv', 'click', exportTrialsHandler);

    on('btn-export-summary-csv', 'click', async () => {
      const trials = await this.storage.getAllTrials();
      if (!trials.length) {
        this.ui.showToast('No summary data to export yet.', 'info');
        return;
      }
      const summaries = computeModeSummaries(trials);
      downloadCsv(summaryToCsv(summaries), `head_pointer_summary_${new Date().toISOString().slice(0, 10)}.csv`);
      this.ui.showToast('Exported condition summary CSV.', 'success');
    });

    on('input-import-csv', 'change', async (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      const text = await file.text();
      const parsed = parseTrialsCsv(text);
      if (!parsed.length) {
        this.ui.showToast('No valid trial rows found in CSV.', 'error');
        return;
      }
      await this.storage.saveTrials(parsed);
      await this.refreshAnalytics();
      this.ui.showToast(`Imported ${parsed.length} trials from ${file.name}.`, 'success');
      e.target.value = '';
    });

    on('btn-clear-all-data', 'click', async () => {
      await this.storage.clearAll();
      await this.refreshAnalytics();
      this.ui.showToast('Cleared all locally stored experiment data.', 'info');
    });
  }

  _bindKeyboardShortcuts() {
    window.addEventListener('keydown', (e) => {
      if (e.target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;
      if (e.code === 'Space' && this.tracker.isRunning) {
        e.preventDefault();
        this.togglePause();
      } else if (e.key === 'c' || e.key === 'C') {
        this.calibrateHeadCenter();
      } else if (e.key === 'r' || e.key === 'R') {
        this.pointer.recenter();
        this.mapper.recenter();
      } else if (e.key === 'Escape') {
        this.dwell.cancelCurrentDwell();
      }
    });
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const app = new HeadControlledPointerApp();
  app.init();
});
