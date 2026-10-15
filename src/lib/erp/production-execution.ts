/**
 * Execution arithmetic (P150 E6, M13, M112) — pure and client-safe, so the
 * Eksekusi Produksi form previews exactly what the production ledger writes.
 *
 * - **Sharing a value by Bobot Biaya** (M13): whole rupiah, largest remainder,
 *   so the parts always add up to the whole; a weight of 0 takes nothing.
 * - **The Partai of the inputs** (M112): one at most — a Partai is never
 *   merged — and the supplier a made lot carries (M127).
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
  // Exact in integers while total × weight stays within 2^53; weights are
  // scaled to integers first so a decimal weight cannot drift.
  const scale = 10 ** Math.min(6, Math.max(0, ...weights.map(decimals)));
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
  const dot = s.indexOf(".");
  return dot < 0 ? 0 : s.length - dot - 1;
}

/**
 * Shares a quantity over weights in proportion at six decimals, the last part
 * taking the rounding so the parts add up exactly — for genealogy edges,
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

export type JobRef = { id: number; no: string };
export type PartaiRef = { id: number; no: string };

export type InputsPartai =
  /** No input belongs to a Partai yet (stock lots before the first transformation). */
  | { kind: "none" }
  | { kind: "one"; id: number }
  /** Two Partai among the inputs — never allowed: a Partai is never merged (M112). */
  | { kind: "many"; ids: number[] };

/** The Partai of an execution's inputs (null for an input outside any Partai). */
export function inputsPartai(partaiIds: (number | null)[]): InputsPartai {
  const ids = [...new Set(partaiIds.filter((x): x is number => x != null))].sort((a, b) => a - b);
  if (!ids.length) return { kind: "none" };
  if (ids.length === 1) return { kind: "one", id: ids[0] };
  return { kind: "many", ids };
}

/**
 * The supplier a lot made from inputs carries (M127, M128): the one supplier
 * behind its inputs' lots, inputs without one aside; none when two differ.
 */
export function carriedSupplier(partnerIds: (number | null)[]): number | null {
  const ids = new Set(partnerIds.filter((x): x is number => x != null));
  return ids.size === 1 ? [...ids][0] : null;
}
