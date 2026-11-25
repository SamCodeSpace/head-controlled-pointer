/**
 * Statistical Analytics Engine
 * Computes descriptive statistics, Fitts' Law Index of Difficulty & Throughput,
 * accuracy/miss rates, target size & distance breakdowns, and within-subject
 * paired t-tests across the three smoothing modes.
 */
export const MODE_META = {
  raw: { label: 'Raw Tracking', color: '#b57a4e', bg: 'rgba(181, 122, 78, 0.18)' },
  moving_average: { label: 'Moving Average', color: '#3b82f6', bg: 'rgba(59, 130, 246, 0.18)' },
  one_euro: { label: 'One Euro Filter', color: '#4f8e42', bg: 'rgba(107, 175, 93, 0.2)' },
};

export const MODE_KEYS = ['raw', 'moving_average', 'one_euro'];

export function mean(arr) {
  if (!arr.length) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

export function median(arr) {
  if (!arr.length) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

export function stdDev(arr) {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  const variance = arr.reduce((acc, v) => acc + (v - m) ** 2, 0) / (arr.length - 1);
  return Math.sqrt(variance);
}

/**
 * Computes per-mode descriptive metrics from trial records.
 */
export function computeModeSummaries(trials) {
  return MODE_KEYS.map((condition) => {
    const subset = trials.filter((t) => t.condition === condition);
    const times = subset.map((t) => t.selectionTimeMs).filter((v) => Number.isFinite(v) && v > 0);
    const participants = new Set(subset.map((t) => t.participantId));

    const totalMisses = subset.reduce((s, t) => s + (t.misses || 0), 0);
    const totalAborted = subset.reduce((s, t) => s + (t.unsuccessfulAttempts || 0), 0);
    const totalAttempts = subset.length + totalMisses + totalAborted;
    const accuracyPct = totalAttempts > 0 ? (subset.length / totalAttempts) * 100 : 0;
    const missRatePct = totalAttempts > 0 ? ((totalMisses + totalAborted) / totalAttempts) * 100 : 0;

    // Average comfort rating per participant first so each participant has equal weight
    const comfortByParticipant = new Map();
    for (const t of subset) {
      if (typeof t.comfortRating === 'number' && t.comfortRating >= 1 && t.comfortRating <= 5) {
        comfortByParticipant.set(t.participantId, t.comfortRating);
      }
    }
    const comfortVals = Array.from(comfortByParticipant.values());
    const meanComfort = comfortVals.length > 0 ? mean(comfortVals) : null;

    // Fitts' Law Throughput: mean(ID / MT_seconds), where ID = log2(D/W + 1)
    const throughputs = subset
      .filter((t) => t.selectionTimeMs > 0 && t.targetSize > 0)
      .map((t) => {
        const id = Math.log2(t.targetDistance / t.targetSize + 1);
        return id / (t.selectionTimeMs / 1000);
      });

    return {
      condition,
      label: MODE_META[condition].label,
      count: subset.length,
      participantCount: participants.size,
      meanTimeMs: mean(times),
      medianTimeMs: median(times),
      sdTimeMs: stdDev(times),
      accuracyPct,
      missRatePct,
      totalMisses,
      totalAborted,
      meanComfort,
      throughputBitsPerSec: mean(throughputs),
    };
  });
}

/**
 * Computes breakdown of mean pointing time by target size (small/medium/large) and distance.
 */
export function computeSizeDistanceBreakdown(trials) {
  const sizes = Array.from(new Set(trials.map((t) => Math.round(t.targetSize)))).sort((a, b) => a - b);
  const bySize = sizes.map((sz) => {
    const entry = { sizePx: sz };
    for (const mode of MODE_KEYS) {
      const matching = trials.filter((t) => t.condition === mode && Math.round(t.targetSize) === sz);
      entry[mode] = matching.length ? mean(matching.map((t) => t.selectionTimeMs)) : null;
    }
    return entry;
  });

  // Bucket distances into Near (<210px), Mid (210–310px), Far (>310px)
  const buckets = [
    { label: 'Near (<210px)', test: (d) => d < 210 },
    { label: 'Medium (210–310px)', test: (d) => d >= 210 && d <= 310 },
    { label: 'Far (>310px)', test: (d) => d > 310 },
  ];
  const byDistance = buckets.map((b) => {
    const entry = { bucket: b.label };
    for (const mode of MODE_KEYS) {
      const matching = trials.filter((t) => t.condition === mode && b.test(t.targetDistance));
      entry[mode] = matching.length ? mean(matching.map((t) => t.selectionTimeMs)) : null;
    }
    return entry;
  });

  return { bySize, byDistance };
}

/**
 * Two-tailed p-value approximation for Student's t distribution using Hill's / normal-adjusted
 * continued fraction approximation (suitable for exploratory pilot-study reporting).
 */
function approxTwoTailedP(tAbs, df) {
  if (df <= 0 || !Number.isFinite(tAbs)) return 1.0;
  // Convert t to approximate z via Cornish-Fisher / Abramowitz-Stegun 26.7.5
  const z =
    (tAbs * (1 - 1 / (4 * df))) /
    Math.sqrt(1 + (tAbs * tAbs) / (2 * df));
  // Complementary error function approximation for standard normal tail
  const t = 1 / (1 + 0.2316419 * z);
  const poly =
    t *
    (0.31938153 +
      t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  const tail = (1 / Math.sqrt(2 * Math.PI)) * Math.exp(-0.5 * z * z) * poly;
  return Math.max(0.0001, Math.min(1.0, 2 * tail));
}

/**
 * Runs within-subject paired t-tests comparing participant-level mean pointing times
 * across all three pairs of conditions.
 */
export function computePairedComparisons(trials) {
  const pairs = [
    ['raw', 'moving_average'],
    ['raw', 'one_euro'],
    ['moving_average', 'one_euro'],
  ];

  // Aggregate mean time per participant per mode
  const participantMap = new Map();
  for (const t of trials) {
    if (!participantMap.has(t.participantId)) {
      participantMap.set(t.participantId, { raw: [], moving_average: [], one_euro: [] });
    }
    if (participantMap.get(t.participantId)[t.condition]) {
      participantMap.get(t.participantId)[t.condition].push(t.selectionTimeMs);
    }
  }

  return pairs.map(([a, b]) => {
    const diffs = [];
    for (const [, modes] of participantMap.entries()) {
      if (modes[a].length > 0 && modes[b].length > 0) {
        diffs.push(mean(modes[a]) - mean(modes[b]));
      }
    }

    const n = diffs.length;
    if (n < 2) {
      return {
        pairLabel: `${MODE_META[a].label} vs ${MODE_META[b].label}`,
        nPairs: n,
        meanDiffMs: n === 1 ? diffs[0] : null,
        tStat: null,
        pValue: null,
        note: 'Requires ≥2 participants completing both modes',
      };
    }

    const mDiff = mean(diffs);
    const sdDiff = stdDev(diffs);
    const se = sdDiff / Math.sqrt(n);
    const tStat = se > 0 ? mDiff / se : 0;
    const pValue = approxTwoTailedP(Math.abs(tStat), n - 1);
    const faster = mDiff > 0 ? MODE_META[b].label : MODE_META[a].label;

    return {
      pairLabel: `${MODE_META[a].label} vs ${MODE_META[b].label}`,
      nPairs: n,
      meanDiffMs: mDiff,
      tStat,
      pValue,
      note:
        pValue < 0.05
          ? `${faster} faster (p ≈ ${pValue.toFixed(3)}, exploratory)`
          : `No statistically significant difference (p ≈ ${pValue.toFixed(3)})`,
    };
  });
}
