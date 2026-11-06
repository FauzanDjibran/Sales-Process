/**
 * Production sharing arithmetic — pure and client-safe, so a form previews
 * exactly what the production ledger writes.
 */

/**
 * Shares a whole-rupiah `total` over `weights` in proportion, largest
 * remainder: each part is floor(total × w ÷ Σw), and the rupiahs left go one
 * each to the largest fractional remainders (earliest first on a tie). A
 * negative total is shared by its magnitude and given back negative.
 */
export function shareByWeight(total: number, weights: number[]): number[] {
  if (!Number.isInteger(total)) throw new Error("Nilai yang dibagi harus rupiah utuh.");
  if (weights.some((w) => !(w >= 0))) throw new Error("Bobot tidak boleh negatif.");
  const sum = weights.reduce((a, w) => a + w, 0);
  if (!weights.length) return [];
  if (!(sum > 0)) {
    if (total !== 0) throw new Error("Jumlah bobot harus lebih dari 0.");
    return weights.map(() => 0);
  }
  const sign = total < 0 ? -1 : 1;
  const whole = Math.abs(total);
  // Exact in integers: weights are scaled to integers first so a decimal
  // weight cannot drift.
  const scale = 10 ** Math.min(12, Math.max(0, ...weights.map(decimals)));
  const ints = weights.map((w) => BigInt(Math.round(w * scale)));
  const den = ints.reduce((a, w) => a + w, BigInt(0));
  const parts = ints.map((w) => (BigInt(whole) * w) / den);
  const rest = ints.map((w, i) => ({ i, r: (BigInt(whole) * w) % den }));
  let left = whole - Number(parts.reduce((a, p) => a + p, BigInt(0)));
  rest.sort((a, b) => (a.r === b.r ? a.i - b.i : a.r > b.r ? -1 : 1));
  for (const { i } of rest) {
    if (left <= 0) break;
    parts[i] += BigInt(1);
    left -= 1;
  }
  return parts.map((p) => sign * Number(p));
}

function decimals(n: number): number {
  const s = String(n);
  if (s.includes("e")) return 12;
  const dot = s.indexOf(".");
  return dot < 0 ? 0 : s.length - dot - 1;
}

/** Biaya unit (V1), for a form's preview: the book writes it in exact decimals, rounded once. */
export function unitCost(grams: number, rate: number): number {
  return Math.round(Number((grams * rate).toFixed(6)));
}

export type GradingOutputShare = { grams: number; isBjl: boolean };

/**
 * What one No. Grading gives its outputs (V3, W32): the whole value over the
 * non-BJL by gram, BJL always 0. With no receiver it is `scrap`, for Beban
 * Pemusnahan Produksi.
 */
export function shareGrading(total: number, outputs: GradingOutputShare[]): { values: number[]; scrap: number } {
  const weights = outputs.map((o) => (o.isBjl ? 0 : o.grams));
  if (!weights.some((w) => w > 0)) return { values: outputs.map(() => 0), scrap: total };
  return { values: shareByWeight(total, weights), scrap: 0 };
}

export type WorkLineShare = { key: string; grams: number; isBjl: boolean; input: number; cost: number };

/**
 * What one Pengerjaan Unit gives its lines (V2, W75): each non-BJL line keeps
 * its input and its own cost, so without BJL a line takes exactly gram × rate.
 * The cost of BJL lines goes over the others by gram. Bahan penolong goes into
 * its Job, by gram; a Job of BJL alone passes it to the document, and with no
 * receiver at all it is `scrap`.
 */
export function shareWork(lines: WorkLineShare[], aux: { key: string | null; value: number }[]): { values: number[]; auxValues: number[]; scrap: number } {
  const receivers = lines.map((l) => (l.isBjl ? 0 : l.grams));
  const aside = lines.reduce((a, l) => a + (l.isBjl ? l.cost : 0), 0);
  const any = receivers.some((w) => w > 0);
  const values = lines.map((l) => (l.isBjl ? l.input : l.input + l.cost));
  const auxValues = lines.map(() => 0);
  let scrap = 0;
  if (any) shareByWeight(aside, receivers).forEach((v, i) => (values[i] += v));
  else scrap += aside;
  for (const a of aux) {
    const own = lines.map((l, i) => (a.key == null || l.key === a.key ? receivers[i] : 0));
    const weights = own.some((w) => w > 0) ? own : receivers;
    if (!weights.some((w) => w > 0)) {
      scrap += a.value;
      continue;
    }
    shareByWeight(a.value, weights).forEach((v, i) => {
      values[i] += v;
      auxValues[i] += v;
    });
  }
  return { values, auxValues, scrap };
}

/**
 * Shares a quantity over weights in proportion at six decimals, the last part
 * taking the rounding so the parts add up exactly — for genealogy links,
 * which describe and are never summed into a balance.
 */
export function shareQty(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, w) => a + w, 0);
  if (!(sum > 0)) return weights.map(() => 0);
  const round6 = (x: number) => Math.round(x * 1e6) / 1e6;
  const parts = weights.map((w) => round6((total * w) / sum));
  const last = parts.map((p, i) => ({ p, i })).filter((x) => weights[x.i] > 0).pop();
  if (last) parts[last.i] = round6(total - parts.reduce((a, p, i) => (i === last.i ? a : a + p), 0));
  return parts;
}
