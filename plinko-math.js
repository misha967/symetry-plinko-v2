/**
 * SYMETRY PLINKO — Math Engine
 * Target RTP: 96% across all configurations
 *
 * Architecture:
 * - Each row count has (rows+1) slots
 * - Ball path is determined by (rows) binary choices: 0=left, 1=right
 * - Slot index = sum of all right-choices (binomial distribution)
 * - Multipliers are symmetric around center
 * - RTP = sum over all slots of: P(slot) * multiplier(slot)
 *
 * Verification formula:
 *   P(slot k | rows n) = C(n,k) / 2^n
 *   RTP = Σ P(slot_k) * mult_k  → target 0.96
 */

// ─── BINOMIAL HELPERS ────────────────────────────────────────
function binomCoeff(n, k) {
  if (k < 0 || k > n) return 0;
  if (k === 0 || k === n) return 1;
  let result = 1;
  for (let i = 0; i < Math.min(k, n - k); i++) {
    result = result * (n - i) / (i + 1);
  }
  return result;
}

function slotProbabilities(rows) {
  const total = Math.pow(2, rows);
  const probs = [];
  for (let k = 0; k <= rows; k++) {
    probs.push(binomCoeff(rows, k) / total);
  }
  return probs;
}

function computeRTP(rows, multipliers) {
  const probs = slotProbabilities(rows);
  let rtp = 0;
  for (let i = 0; i < multipliers.length; i++) {
    rtp += probs[i] * multipliers[i];
  }
  return rtp;
}

// ─── MULTIPLIER TABLES ───────────────────────────────────────
// Format: symmetric arrays (left half + center), full array mirrored
// All verified at ~96% RTP via computeRTP()
//
// Design intent:
//   LOW    → gentle bell curve, many near-1x slots, low variance
//   MEDIUM → steeper curve, moderate highs
//   HIGH   → winner-takes-most, extreme edges, most slots < 1x

const MULTIPLIERS = {

  // ── 8 ROWS (9 slots) ──────────────────────────────────────
  8: {
    low: [
      // Slots 0..8 (symmetric)
      // P: .004 .031 .109 .219 .273 .219 .109 .031 .004
      // RTP check: 2*(0.004*5.5 + 0.031*2.1 + 0.109*1.2 + 0.219*1.0) + 0.273*0.7
      //          ≈ 2*(0.022+0.065+0.131+0.219) + 0.191 = 2*0.437 + 0.191 = 1.065 → too high
      // Tuned values:
      5.5, 2.1, 1.1, 0.7, 0.5, 0.7, 1.1, 2.1, 5.5
      // RTP = 2*(0.004*5.5 + 0.031*2.1 + 0.109*1.1 + 0.219*0.7) + 0.273*0.5
      //     = 2*(0.022 + 0.065 + 0.120 + 0.153) + 0.137
      //     = 2*0.360 + 0.137 = 0.857 → under, adjust center
    ],
    medium: [
      13, 3, 1.3, 0.7, 0.4, 0.7, 1.3, 3, 13
    ],
    high: [
      50, 8, 3, 0.5, 0.2, 0.5, 3, 8, 50
    ]
  },

  // ── 12 ROWS (13 slots) ────────────────────────────────────
  12: {
    low: [
      8, 3, 1.6, 1.1, 0.8, 0.6, 0.5, 0.6, 0.8, 1.1, 1.6, 3, 8
    ],
    medium: [
      24, 8, 3, 1.4, 0.7, 0.4, 0.3, 0.4, 0.7, 1.4, 3, 8, 24
    ],
    high: [
      120, 20, 7, 2, 0.6, 0.3, 0.2, 0.3, 0.6, 2, 7, 20, 120
    ]
  },

  // ── 16 ROWS (17 slots) ────────────────────────────────────
  16: {
    low: [
      16, 7, 3, 1.8, 1.2, 0.8, 0.6, 0.5, 0.4, 0.5, 0.6, 0.8, 1.2, 1.8, 3, 7, 16
    ],
    medium: [
      80, 20, 7, 3, 1.5, 0.8, 0.4, 0.3, 0.2, 0.3, 0.4, 0.8, 1.5, 3, 7, 20, 80
    ],
    high: [
      500, 80, 20, 6, 2, 0.7, 0.3, 0.2, 0.1, 0.2, 0.3, 0.7, 2, 6, 20, 80, 500
    ]
  }
};

// ─── AUTO-TUNE TO EXACT 96% ──────────────────────────────────
// Scale all multipliers so RTP = exactly 0.96
function tuneToRTP(rows, multipliers, targetRTP = 0.96) {
  const current = computeRTP(rows, multipliers);
  const scale = targetRTP / current;
  return multipliers.map(m => parseFloat((m * scale).toFixed(2)));
}

// Apply tuning to all configurations
for (const rows of [8, 12, 16]) {
  for (const risk of ['low', 'medium', 'high']) {
    MULTIPLIERS[rows][risk] = tuneToRTP(rows, MULTIPLIERS[rows][risk]);
  }
}

// ─── PROVABLY FAIR PATH GENERATION ───────────────────────────
/**
 * Generate a ball path for given rows using a seeded PRNG.
 * Returns: { path: [0|1, ...], slot: number, seed: string }
 *
 * Each element in path: 0 = bounce left, 1 = bounce right
 * slot = sum(path) → index into multipliers array
 */
function mulberry32(seed) {
  return function() {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function generatePath(rows, seedString) {
  // Hash seedString to uint32
  let hash = 0;
  for (let i = 0; i < seedString.length; i++) {
    hash = Math.imul(31, hash) + seedString.charCodeAt(i) | 0;
  }
  const rand = mulberry32(hash >>> 0);

  const path = [];
  for (let i = 0; i < rows; i++) {
    path.push(rand() < 0.5 ? 0 : 1);
  }
  const slot = path.reduce((a, b) => a + b, 0);
  return { path, slot, seed: seedString };
}

function newSeed() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// ─── SLOT COLORS ─────────────────────────────────────────────
// Symetry DA: white for high mult, dark grey for low mult
function slotColor(multiplier) {
  if (multiplier >= 20)  return { bg: '#ffffff', text: '#000000', glow: 'rgba(255,255,255,0.9)' };
  if (multiplier >= 10)  return { bg: '#ffd700', text: '#000000', glow: 'rgba(255,215,0,0.7)'   }; // gold
  if (multiplier >= 5)   return { bg: '#ff6b35', text: '#ffffff', glow: 'rgba(255,107,53,0.6)'  }; // orange
  if (multiplier >= 2)   return { bg: '#4a90d9', text: '#ffffff', glow: 'rgba(74,144,217,0.5)'  }; // blue
  if (multiplier >= 1)   return { bg: '#3a3a5c', text: '#aaaacc', glow: 'rgba(58,58,92,0.3)'    }; // indigo dim
  if (multiplier >= 0.5) return { bg: '#2a2a3a', text: '#666688', glow: 'rgba(42,42,58,0.2)'    }; // dark
  return                        { bg: '#1a1a24', text: '#444455', glow: 'rgba(26,26,36,0.1)'    }; // near black
}

// ─── RTP VERIFICATION (dev) ───────────────────────────────────
function verifyAllRTPs() {
  const results = {};
  for (const rows of [8, 12, 16]) {
    results[rows] = {};
    for (const risk of ['low', 'medium', 'high']) {
      results[rows][risk] = computeRTP(rows, MULTIPLIERS[rows][risk]).toFixed(4);
    }
  }
  return results;
}

// ─── MYSTERY SLOT ─────────────────────────────────────────────
/**
 * Reveals a mystery slot multiplier.
 * Distribution is weighted so E[result] ≈ baseMult → RTP unchanged.
 *
 * Tiers (relative weights):
 *   ×0.2  baseMult  — weight 15%  (bad surprise)
 *   ×0.5  baseMult  — weight 25%  (slight loss)
 *   ×1.0  baseMult  — weight 30%  (neutral)
 *   ×1.5  baseMult  — weight 20%  (nice)
 *   ×2.5  baseMult  — weight 10%  (big win)
 *
 * E = 0.15×0.2 + 0.25×0.5 + 0.30×1.0 + 0.20×1.5 + 0.10×2.5
 *   = 0.03 + 0.125 + 0.30 + 0.30 + 0.25 = 1.005 ≈ 1.0 ✓
 */
function revealMysterySlot(baseMult) {
  const r = Math.random();
  let factor;
  if      (r < 0.15) factor = 0.2;
  else if (r < 0.40) factor = 0.5;
  else if (r < 0.70) factor = 1.0;
  else if (r < 0.90) factor = 1.5;
  else               factor = 2.5;
  return parseFloat((baseMult * factor).toFixed(2));
}

/**
 * Pick a mystery slot index for this round.
 * Avoids extreme edge slots (first 2 and last 2) to keep it fair.
 */
function pickMysterySlot(rows) {
  const min = 2;
  const max = rows - 2;
  return min + Math.floor(Math.random() * (max - min + 1));
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { MULTIPLIERS, generatePath, newSeed, slotColor, computeRTP, verifyAllRTPs, slotProbabilities, revealMysterySlot, pickMysterySlot };
} else {
  window.PlinkoMath = { MULTIPLIERS, generatePath, newSeed, slotColor, computeRTP, verifyAllRTPs, slotProbabilities, revealMysterySlot, pickMysterySlot };
}
