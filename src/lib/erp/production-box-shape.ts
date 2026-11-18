/**
 * Packing 95's arithmetic (P284, T12), client-safe so the Kotak form recommends
 * and refuses exactly what Tutup Kotak does. Gram is worked in tenths, whole
 * numbers, so the search is exact.
 */

export type BoxRule = { target: number; tolerance: number; minPieces: number; maxPieces: number };
export type Piece = { id: number; grams: number };

const tenths = (g: number) => Math.round(g * 10);

/**
 * The subset of `pool` whose weight is nearest `target` without passing `limit`,
 * with between `minPieces` and `maxPieces` pieces: a bounded knapsack over
 * (count, weight), weights in whole tenths of a gram (the artifact's `nearestBox`).
 */
export function nearestBox(pool: Piece[], target: number, limit: number, minPieces: number, maxPieces: number): Piece[] | null {
  const T = tenths(target);
  const L = tenths(limit);
  if (maxPieces < 1 || L <= 0) return null;
  // shortcut: the table is (maxPieces+1)×(L+1) per piece; capped at ~30M cells, enough for a kotak of a few hundred gram.
  const room = Math.min(pool.length, Math.floor(3e7 / Math.max(1, L * maxPieces)));
  const items = pool.slice(0, Math.max(room, minPieces)).map((p) => ({ p, w: tenths(p.grams) }));
  const dp = Array.from({ length: maxPieces + 1 }, () => new Int32Array(L + 1).fill(-1));
  dp[0][0] = -2;
  items.forEach((x, i) => {
    if (x.w <= 0) return;
    for (let c = maxPieces; c >= 1; c--) {
      const prev = dp[c - 1];
      const cur = dp[c];
      for (let s = L; s >= x.w; s--) if (prev[s - x.w] !== -1 && cur[s] === -1) cur[s] = i;
    }
  });
  let best: { d: number; s: number; c: number } | null = null;
  for (let c = Math.max(minPieces, 1); c <= maxPieces; c++) {
    for (let s = 0; s <= L; s++) {
      if (dp[c][s] === -1) continue;
      const d = Math.abs(s - T);
      if (!best || d < best.d || (d === best.d && s > best.s)) best = { d, s, c };
    }
  }
  if (!best) return null;
  const out: Piece[] = [];
  let { c, s } = best;
  while (c > 0) {
    const i = dp[c][s];
    out.push(items[i].p);
    s -= items[i].w;
    c--;
  }
  return out;
}

/** What still fills the kotak best, given the pieces already in it. */
export function recommend(rule: BoxRule, inBox: Piece[], free: Piece[]): Piece[] {
  const got = inBox.reduce((a, p) => a + p.grams, 0);
  const k = inBox.length;
  if (got >= rule.target || k >= rule.maxPieces) return [];
  return nearestBox(free, rule.target - got, rule.target + rule.tolerance - got, Math.max(0, rule.minPieces - k), rule.maxPieces - k) ?? [];
}

/** Why a kotak may not close yet; empty when it may. */
export function boxRuleErrors(rule: BoxRule, pieces: { grams: number; caiq: string }[]): string[] {
  const out: string[] = [];
  const g = pieces.reduce((a, p) => a + p.grams, 0);
  if (Math.abs(tenths(g) - tenths(rule.target)) > tenths(rule.tolerance)) out.push(`Berat ${Math.round(g * 10) / 10} g di luar ${rule.target} ± ${rule.tolerance} g.`);
  if (pieces.length < rule.minPieces || pieces.length > rule.maxPieces) out.push(`Jumlah keping ${pieces.length}, harus ${rule.minPieces}–${rule.maxPieces}.`);
  const caiqs = pieces.map((p) => p.caiq.trim());
  if (caiqs.some((c) => !c)) out.push("Setiap keping butuh No. CAIQ.");
  else if (new Set(caiqs.map((c) => c.toUpperCase())).size !== caiqs.length) out.push("No. CAIQ dipakai lebih dari sekali di kotak ini.");
  return out;
}
