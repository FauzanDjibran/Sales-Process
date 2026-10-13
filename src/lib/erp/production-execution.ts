/**
 * Execution arithmetic (P150 E6, M13, M41) — pure and client-safe, so the
 * Eksekusi Produksi form previews exactly what the production ledger writes.
 *
 * - **Sharing a value by Bobot Biaya** (M13): whole rupiah, largest remainder,
 *   so the parts always add up to the whole; a weight of 0 takes nothing.
 * - **The job rule** (M41): no jobed input starts a new job; one job
 *   among the inputs is carried, un-jobed inputs (more material, packaging)
 *   joining it; two or more are refused unless *Job Baru*, whose parents are
 *   all of them; *Job Baru* is always allowed.
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

export type JobOutcome =
  /** No jobed input, or *Job Baru*: a new job starts; `parents` are the inputs' jobs. */
  | { kind: "new"; parents: JobRef[] }
  /** One job among the inputs: it is carried to the outputs. */
  | { kind: "carried"; job: JobRef }
  /** Two or more jobs without *Job Baru*. */
  | { kind: "mixed"; jobs: JobRef[] };

/** The job rule (M41) over the inputs' jobs (null for an un-jobed input). */
export function jobOutcome(inputJobs: (JobRef | null)[], newJob: boolean): JobOutcome {
  const distinct = new Map<number, JobRef>();
  for (const b of inputJobs) if (b) distinct.set(b.id, b);
  const jobs = [...distinct.values()].sort((a, b) => a.id - b.id);
  if (newJob || !jobs.length) return { kind: "new", parents: jobs };
  if (jobs.length === 1) return { kind: "carried", job: jobs[0] };
  return { kind: "mixed", jobs };
}
