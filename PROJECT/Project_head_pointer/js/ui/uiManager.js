import {
  MODE_META,
  computeModeSummaries,
  computeSizeDistanceBreakdown,
  computePairedComparisons,
} from '../analytics/statsEngine.js';

/**
 * UI Manager
 * Handles 9-section navigation, toast feedback, Mode Comparison trajectory canvas,
 * Practice Area hands-free interactive controls, Results Dashboard tables, and Data Export preview.
 */
export class UIManager {
  constructor(dashboardCharts) {
    this.dashboardCharts = dashboardCharts;
    this.activeSection = 'live';
    this.practiceCount = 0;
    this.practiceToggleOn = false;
    this.practiceHistory = [];

    // Trajectory trail points for Mode Comparison live canvas
    this.trailPoints = [];
    this.maxTrailPoints = 90;
    this.trailCanvas = document.getElementById('comparison-trail-canvas');
    this.trailCtx = this.trailCanvas ? this.trailCanvas.getContext('2d') : null;
  }

  initNavigation(onSectionChange) {
    const navButtons = document.querySelectorAll('[data-nav-target]');
    navButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        const target = btn.getAttribute('data-nav-target');
        if (target) {
          this.showSection(target);
          if (typeof onSectionChange === 'function') onSectionChange(target);
        }
      });
    });

    // Mobile nav toggle
    const menuToggle = document.getElementById('mobile-menu-toggle');
    const sidebar = document.getElementById('app-sidebar');
    if (menuToggle && sidebar) {
      menuToggle.addEventListener('click', () => {
        sidebar.classList.toggle('open');
      });
    }
  }

  showSection(sectionId) {
    this.activeSection = sectionId;
    document.querySelectorAll('.app-section').forEach((sec) => {
      sec.classList.toggle('active', sec.id === `section-${sectionId}`);
    });
    document.querySelectorAll('.nav-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.getAttribute('data-nav-target') === sectionId);
    });
    const sidebar = document.getElementById('app-sidebar');
    if (sidebar) sidebar.classList.remove('open');
  }

  showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => {
      toast.classList.add('toast-fade');
      setTimeout(() => toast.remove(), 300);
    }, 3200);
  }

  updateTrackingBadge(state, message) {
    const badges = document.querySelectorAll('[data-tracking-status-badge]');
    const labels = {
      stopped: 'Stopped',
      loading: 'Loading...',
      ready: 'Model Ready',
      tracking: 'Face Tracking Active',
      simulated: 'Simulated Mode',
      lost: 'Face Lost',
      disconnected: 'Camera Disconnected',
      error: 'Camera Error',
      paused: 'Paused',
    };
    badges.forEach((el) => {
      el.textContent = labels[state] || state;
      el.className = `status-pill status-${state}`;
    });
    const msgEl = document.getElementById('tracking-status-message');
    if (msgEl && message) msgEl.textContent = message;
  }

  updateModeBadges(modeKey) {
    const meta = MODE_META[modeKey] || MODE_META.raw;
    document.querySelectorAll('[data-active-mode-badge]').forEach((el) => {
      el.textContent = meta.label;
      el.style.borderColor = meta.color;
      el.style.color = meta.color;
    });
    document.querySelectorAll('[data-mode-select]').forEach((btn) => {
      btn.classList.toggle('active', btn.getAttribute('data-mode-select') === modeKey);
    });
  }

  updateTelemetry(jitterPx, velocityPxPerSec, pointerX, pointerY, modeKey) {
    const jitterEl = document.getElementById('hud-jitter');
    const velEl = document.getElementById('hud-velocity');
    const coordEl = document.getElementById('hud-coords');
    if (jitterEl) jitterEl.textContent = `${jitterPx.toFixed(1)} px`;
    if (velEl) velEl.textContent = `${Math.round(velocityPxPerSec)} px/s`;
    if (coordEl) coordEl.textContent = `${Math.round(pointerX)}, ${Math.round(pointerY)}`;

    const cmpJitter = document.getElementById('cmp-jitter-val');
    const cmpVel = document.getElementById('cmp-velocity-val');
    if (cmpJitter) cmpJitter.textContent = `${jitterPx.toFixed(1)} px RMS`;
    if (cmpVel) cmpVel.textContent = `${Math.round(velocityPxPerSec)} px/s`;

    // Update Mode Comparison trajectory canvas when visible
    if (this.activeSection === 'live' && this.trailCtx && this.trailCanvas) {
      this._drawTrail(pointerX, pointerY, modeKey);
    }
  }

  _drawTrail(px, py, modeKey) {
    const w = this.trailCanvas.width;
    const h = this.trailCanvas.height;
    const nx = (px / Math.max(1, window.innerWidth)) * w;
    const ny = (py / Math.max(1, window.innerHeight)) * h;
    this.trailPoints.push({ x: nx, y: ny });
    if (this.trailPoints.length > this.maxTrailPoints) {
      this.trailPoints.shift();
    }

    const ctx = this.trailCtx;
    ctx.clearRect(0, 0, w, h);

    // Subtle grid
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.15)';
    ctx.lineWidth = 1;
    for (let gx = 40; gx < w; gx += 40) {
      ctx.beginPath();
      ctx.moveTo(gx, 0);
      ctx.lineTo(gx, h);
      ctx.stroke();
    }
    for (let gy = 40; gy < h; gy += 40) {
      ctx.beginPath();
      ctx.moveTo(0, gy);
      ctx.lineTo(w, gy);
      ctx.stroke();
    }

    // Center crosshair
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.35)';
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, 18, 0, Math.PI * 2);
    ctx.stroke();

    const color = (MODE_META[modeKey] && MODE_META[modeKey].color) || '#38bdf8';
    if (this.trailPoints.length > 1) {
      ctx.strokeStyle = color;
      ctx.lineWidth = 2.5;
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(this.trailPoints[0].x, this.trailPoints[0].y);
      for (let i = 1; i < this.trailPoints.length; i++) {
        ctx.lineTo(this.trailPoints[i].x, this.trailPoints[i].y);
      }
      ctx.stroke();
    }

    const last = this.trailPoints[this.trailPoints.length - 1];
    if (last) {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(last.x, last.y, 5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  clearTrail() {
    this.trailPoints = [];
    if (this.trailCtx && this.trailCanvas) {
      this.trailCtx.clearRect(0, 0, this.trailCanvas.width, this.trailCanvas.height);
    }
  }


  /**
   * Updates the Results Dashboard & Data Export preview tables from stored trials.
   */
  renderDashboard(trials) {
    const summaries = computeModeSummaries(trials);
    const breakdown = computeSizeDistanceBreakdown(trials);
    const paired = computePairedComparisons(trials);

    const totalTrialsEl = document.getElementById('kpi-total-trials');
    const participantsEl = document.getElementById('kpi-participants');
    const fastestEl = document.getElementById('kpi-fastest-mode');
    const lowestMissEl = document.getElementById('kpi-lowest-miss');

    const uniqueParticipants = new Set(trials.map((t) => t.participantId));
    if (totalTrialsEl) totalTrialsEl.textContent = String(trials.length);
    if (participantsEl) participantsEl.textContent = String(uniqueParticipants.size);

    const populated = summaries.filter((s) => s.count > 0);
    if (populated.length > 0) {
      const fastest = [...populated].sort((a, b) => a.meanTimeMs - b.meanTimeMs)[0];
      const mostAccurate = [...populated].sort((a, b) => a.missRatePct - b.missRatePct)[0];
      if (fastestEl) fastestEl.textContent = `${fastest.label} (${Math.round(fastest.meanTimeMs)} ms)`;
      if (lowestMissEl) lowestMissEl.textContent = `${mostAccurate.label} (${mostAccurate.missRatePct.toFixed(1)}%)`;
    } else {
      if (fastestEl) fastestEl.textContent = 'No data yet';
      if (lowestMissEl) lowestMissEl.textContent = 'No data yet';
    }

    // Summary stats table
    const tbody = document.getElementById('summary-stats-tbody');
    if (tbody) {
      tbody.innerHTML = summaries
        .map(
          (s) => `
          <tr>
            <td><strong>${s.label}</strong></td>
            <td>${s.count}</td>
            <td>${s.count ? `${Math.round(s.meanTimeMs)} ms` : '—'}</td>
            <td>${s.count ? `${Math.round(s.medianTimeMs)} ms` : '—'}</td>
            <td>${s.count ? `${Math.round(s.sdTimeMs)} ms` : '—'}</td>
            <td>${s.count ? `${s.accuracyPct.toFixed(1)}%` : '—'}</td>
            <td>${s.count ? `${s.missRatePct.toFixed(1)}%` : '—'}</td>
            <td>${s.meanComfort !== null ? `${s.meanComfort.toFixed(2)} / 5` : '—'}</td>
            <td>${s.count ? `${s.throughputBitsPerSec.toFixed(2)} bits/s` : '—'}</td>
          </tr>`
        )
        .join('');
    }

    // Paired statistical tests table
    const pairedBody = document.getElementById('paired-stats-tbody');
    if (pairedBody) {
      pairedBody.innerHTML = paired
        .map(
          (p) => `
          <tr>
            <td>${p.pairLabel}</td>
            <td>${p.nPairs}</td>
            <td>${p.meanDiffMs !== null ? `${p.meanDiffMs > 0 ? '+' : ''}${Math.round(p.meanDiffMs)} ms` : '—'}</td>
            <td>${p.tStat !== null ? p.tStat.toFixed(2) : '—'}</td>
            <td>${p.pValue !== null ? p.pValue.toFixed(4) : '—'}</td>
            <td>${p.note}</td>
          </tr>`
        )
        .join('');
    }

    // Per-Participant Breakdown table
    const pBody = document.getElementById('participant-breakdown-tbody');
    if (pBody) {
      const byP = new Map();
      for (const t of trials) {
        if (!byP.has(t.participantId)) {
          byP.set(t.participantId, { raw: [], moving_average: [], one_euro: [], total: 0 });
        }
        const rec = byP.get(t.participantId);
        rec.total += 1;
        if (rec[t.condition]) rec[t.condition].push(t.selectionTimeMs);
      }
      const avg = (arr) => (arr.length ? `${Math.round(arr.reduce((a, b) => a + b, 0) / arr.length)} ms` : '—');
      if (byP.size === 0) {
        pBody.innerHTML = '<tr><td colspan="5" class="muted-cell">No participants stored yet.</td></tr>';
      } else {
        pBody.innerHTML = Array.from(byP.entries())
          .map(
            ([pid, d]) => `
            <tr>
              <td><strong>${pid}</strong></td>
              <td>${d.total}</td>
              <td>${avg(d.raw)}</td>
              <td>${avg(d.moving_average)}</td>
              <td>${avg(d.one_euro)}</td>
            </tr>`
          )
          .join('');
      }
    }

    // Data Export preview table (most recent 25 rows)
    const exportCountEl = document.getElementById('export-row-count');
    if (exportCountEl) exportCountEl.textContent = `${trials.length} recorded trial rows (${uniqueParticipants.size} participants)`;

    const exportBody = document.getElementById('export-preview-tbody');
    if (exportBody) {
      const recent = [...trials].slice(-25).reverse();
      if (recent.length === 0) {
        exportBody.innerHTML = '<tr><td colspan="9" class="muted-cell">No experiment trials recorded yet. Complete a session in the Experiment tab or import a CSV.</td></tr>';
      } else {
        exportBody.innerHTML = recent
          .map(
            (t) => `
            <tr>
              <td>${t.participantId}</td>
              <td>${(MODE_META[t.condition] && MODE_META[t.condition].label) || t.condition}</td>
              <td>${t.trialNumber}</td>
              <td>${Math.round(t.targetSize)} px</td>
              <td>${Math.round(t.targetDistance)} px</td>
              <td>${Math.round(t.selectionTimeMs)} ms</td>
              <td>${t.misses ?? 0}</td>
              <td>${t.unsuccessfulAttempts ?? 0}</td>
              <td>${t.comfortRating ?? '—'}</td>
            </tr>`
          )
          .join('');
      }
    }

    // Render all 4 Chart.js charts
    if (this.dashboardCharts) {
      this.dashboardCharts.renderAll(summaries, breakdown);
    }
  }
}
