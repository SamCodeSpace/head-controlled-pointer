/**
 * CSV Exporter & Importer
 * Generates RFC-4180 compliant CSV files for trial-level and condition-summary data,
 * and parses imported participant CSVs so researchers can aggregate multi-device studies.
 */
export const TRIAL_CSV_HEADERS = [
  'participant_id',
  'condition',
  'condition_order_index',
  'trial_number',
  'target_size_px',
  'target_distance_px',
  'fitts_id_bits',
  'selection_time_ms',
  'misses',
  'unsuccessful_attempts',
  'comfort_rating_1_to_5',
  'input_source',
  'timestamp_iso',
];

function escapeCsvCell(val) {
  const str = val === null || val === undefined ? '' : String(val);
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function trialsToCsv(trials) {
  const lines = [TRIAL_CSV_HEADERS.join(',')];
  for (const t of trials) {
    const idBits = Math.log2(t.targetDistance / Math.max(1, t.targetSize) + 1);
    const row = [
      t.participantId,
      t.condition,
      t.conditionOrderIndex ?? '',
      t.trialNumber,
      Math.round(t.targetSize),
      Math.round(t.targetDistance),
      idBits.toFixed(3),
      Math.round(t.selectionTimeMs),
      t.misses ?? 0,
      t.unsuccessfulAttempts ?? 0,
      t.comfortRating ?? '',
      t.inputSource || 'webcam',
      t.timestampIso || '',
    ];
    lines.push(row.map(escapeCsvCell).join(','));
  }
  return lines.join('\n');
}

export function summaryToCsv(modeSummaries) {
  const headers = [
    'condition',
    'trial_count',
    'participant_count',
    'mean_time_ms',
    'median_time_ms',
    'sd_time_ms',
    'accuracy_pct',
    'miss_rate_pct',
    'total_misses',
    'total_unsuccessful_attempts',
    'mean_comfort_1_to_5',
    'throughput_bits_per_sec',
  ];
  const lines = [headers.join(',')];
  for (const s of modeSummaries) {
    const row = [
      s.condition,
      s.count,
      s.participantCount,
      s.meanTimeMs.toFixed(1),
      s.medianTimeMs.toFixed(1),
      s.sdTimeMs.toFixed(1),
      s.accuracyPct.toFixed(2),
      s.missRatePct.toFixed(2),
      s.totalMisses,
      s.totalAborted,
      s.meanComfort !== null ? s.meanComfort.toFixed(2) : '',
      s.throughputBitsPerSec.toFixed(3),
    ];
    lines.push(row.map(escapeCsvCell).join(','));
  }
  return lines.join('\n');
}

export function downloadCsv(csvContent, filename) {
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Parses an exported trial CSV back into structured trial records.
 */
export function parseTrialsCsv(csvText) {
  const lines = csvText.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const headers = lines[0].split(',').map((h) => h.trim().replace(/^"|"$/g, ''));
  const idx = (name) => headers.indexOf(name);

  const trials = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const cols = line.split(',').map((c) => c.trim().replace(/^"|"$/g, ''));
    const participantId = cols[idx('participant_id')] || `P_IMP_${i}`;
    const condition = cols[idx('condition')];
    if (!['raw', 'moving_average', 'one_euro'].includes(condition)) continue;

    trials.push({
      recordId: `${participantId}_${condition}_${cols[idx('trial_number')]}_${Date.now()}_${i}`,
      participantId,
      condition,
      conditionOrderIndex: Number(cols[idx('condition_order_index')]) || 0,
      trialNumber: Number(cols[idx('trial_number')]) || i,
      targetSize: Number(cols[idx('target_size_px')]) || 60,
      targetDistance: Number(cols[idx('target_distance_px')]) || 200,
      selectionTimeMs: Number(cols[idx('selection_time_ms')]) || 0,
      misses: Number(cols[idx('misses')]) || 0,
      unsuccessfulAttempts: Number(cols[idx('unsuccessful_attempts')]) || 0,
      comfortRating: cols[idx('comfort_rating_1_to_5')] ? Number(cols[idx('comfort_rating_1_to_5')]) : null,
      inputSource: cols[idx('input_source')] || 'webcam',
      timestampIso: cols[idx('timestamp_iso')] || new Date().toISOString(),
    });
  }
  return trials;
}
