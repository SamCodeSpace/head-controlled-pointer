import { MODE_META, MODE_KEYS } from './statsEngine.js';

/**
 * Dashboard Charts Renderer (Chart.js 4)
 * Renders the 4 required comparative visualizations:
 * 1. Pointing Speed (Mean & Median ms) across modes
 * 2. Target Acquisition Accuracy & Miss Rate (%) across modes
 * 3. User Comfort Ratings (1–5) across modes
 * 4. Pointing Time across Target Sizes & Distances
 */
export class DashboardCharts {
  constructor() {
    this.charts = {};
  }

  destroyAll() {
    for (const key of Object.keys(this.charts)) {
      if (this.charts[key]) {
        this.charts[key].destroy();
        this.charts[key] = null;
      }
    }
  }

  renderAll(summaries, breakdown) {
    if (typeof window.Chart === 'undefined') return;
    this.destroyAll();

    const labels = summaries.map((s) => s.label);
    const colors = summaries.map((s) => MODE_META[s.condition].color);

    // 1. Pointing Speed (Mean & Median ms)
    const speedCanvas = document.getElementById('chart-speed');
    if (speedCanvas) {
      this.charts.speed = new window.Chart(speedCanvas, {
        type: 'bar',
        data: {
          labels,
          datasets: [
            {
              label: 'Mean Time (ms)',
              data: summaries.map((s) => Number(s.meanTimeMs.toFixed(1))),
              backgroundColor: colors,
              borderRadius: 6,
            },
            {
              label: 'Median Time (ms)',
              data: summaries.map((s) => Number(s.medianTimeMs.toFixed(1))),
              backgroundColor: summaries.map((s) => MODE_META[s.condition].bg),
              borderColor: colors,
              borderWidth: 2,
              borderRadius: 6,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { position: 'top' } },
          scales: {
            y: { beginAtZero: true, title: { display: true, text: 'Time (ms) — lower is faster' } },
          },
        },
      });
    }

    // 2. Accuracy & Miss Rate (%)
    const accCanvas = document.getElementById('chart-accuracy');
    if (accCanvas) {
      this.charts.accuracy = new window.Chart(accCanvas, {
        type: 'bar',
        data: {
          labels,
          datasets: [
            {
              label: 'Acquisition Accuracy (%)',
              data: summaries.map((s) => Number(s.accuracyPct.toFixed(1))),
              backgroundColor: '#10b981',
              borderRadius: 6,
            },
            {
              label: 'Miss & Aborted Rate (%)',
              data: summaries.map((s) => Number(s.missRatePct.toFixed(1))),
              backgroundColor: '#ef4444',
              borderRadius: 6,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { position: 'top' } },
          scales: {
            y: { beginAtZero: true, max: 100, title: { display: true, text: 'Percentage (%)' } },
          },
        },
      });
    }

    // 3. Comfort Ratings (1–5)
    const comfortCanvas = document.getElementById('chart-comfort');
    if (comfortCanvas) {
      this.charts.comfort = new window.Chart(comfortCanvas, {
        type: 'bar',
        data: {
          labels,
          datasets: [
            {
              label: 'Mean Comfort Rating (1–5)',
              data: summaries.map((s) => (s.meanComfort !== null ? Number(s.meanComfort.toFixed(2)) : 0)),
              backgroundColor: colors,
              borderRadius: 6,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: {
            y: { beginAtZero: true, max: 5, ticks: { stepSize: 1 }, title: { display: true, text: 'Comfort (1 = Poor, 5 = Excellent)' } },
          },
        },
      });
    }

    // 4. Pointing Time Across Target Sizes
    const sizeCanvas = document.getElementById('chart-size-distance');
    if (sizeCanvas) {
      const sizeLabels = breakdown.bySize.map((row) => `${row.sizePx}px Target`);
      this.charts.sizeDistance = new window.Chart(sizeCanvas, {
        type: 'line',
        data: {
          labels: sizeLabels.length ? sizeLabels : ['No trials yet'],
          datasets: MODE_KEYS.map((mode) => ({
            label: MODE_META[mode].label,
            data: breakdown.bySize.map((row) => (row[mode] !== null ? Number(row[mode].toFixed(1)) : null)),
            borderColor: MODE_META[mode].color,
            backgroundColor: MODE_META[mode].bg,
            tension: 0.25,
            fill: false,
            pointRadius: 5,
          })),
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { position: 'top' } },
          scales: {
            y: { beginAtZero: true, title: { display: true, text: 'Mean Selection Time (ms)' } },
          },
        },
      });
    }
  }
}
