import { shareByWeight } from "./production-execution";
import type { LotFate } from "./production-ledger";

/**
 * The month-end production costing as pure arithmetic (P172, M96–M99,
 * `Standard-Cost-Plan.md` §4.2–4.3): no database, so the preview and the posting
 * share it and a test can feed it the reference examples.
 */

export type ClosePoolIn = { costCenterId: number; itemId: number; accountId: number; actual: number; standard: number };
export type CloseRunIn = {
  id: number;
  costCenterId: number;
  driver: number;
  outputs: { lotId: number; weight: number; qty: number }[];
};
export type CloseFlowIn = { opening: number; inflow: number; outflow: number; poolQty: number };

export type CloseInput = {
  pools: ClosePoolIn[];
  /** The Overhead Cost Center, or null when none is set. */
  overheadCostCenterId: number | null;
  runs: CloseRunIn[];
  /** What became of a lot, as the books stand now. */
  fate: (lotId: number) => LotFate;
  /** `finished_receipt` or `scrap` for a release document. */
  releasePurpose: (docId: number) => string;
  /** Goods available / sold per item, for the stock split (M27). */
  flows: (itemId: number) => CloseFlowIn;
};

export type ClosePoolOut = ClosePoolIn & { overhead: number; leftover: number };
export type CloseShareOut = { runId: number; driver: number; amount: number };
export type CloseDestKind = "Wip" | "Stock" | "Hpp" | "Scrap";
export type CloseDestOut = { kind: CloseDestKind; itemId: number | null; bucketId: number | null; amount: number };

export type CloseOutput = {
  pools: ClosePoolOut[];
  shares: CloseShareOut[];
  dests: CloseDestOut[];
  /** Σ over every Production Cost Center of what it takes into the products (Overhead spread included). */
  absorbed: number;
};

const sum = (xs: number[]) => xs.reduce((a, x) => a + x, 0);

/** Splits a whole-rupiah amount over weights; an all-zero set of weights splits evenly. */
function split(total: number, weights: number[]): number[] {
  if (!weights.length) return [];
  return shareByWeight(total, sum(weights) > 0 ? weights : weights.map(() => 1));
}

export function settleClose(input: CloseInput): CloseOutput {
  const ovh = input.overheadCostCenterId;
  const driverOf = new Map<number, number>();
  for (const r of input.runs) driverOf.set(r.costCenterId, (driverOf.get(r.costCenterId) ?? 0) + Math.max(0, r.driver));
  // Production Cost Centers that ran executions this month receive the Overhead (P160).
  const receivers = [...driverOf.keys()].filter((c) => c !== ovh).sort((a, b) => a - b);

  // 1. Pools, with the Overhead spread Rata per Standard Cost Item.
  const pools = new Map<string, ClosePoolOut>();
  const key = (c: number, i: number) => `${c}:${i}`;
  for (const p of input.pools) {
    pools.set(key(p.costCenterId, p.itemId), { ...p, overhead: 0, leftover: p.actual - p.standard });
  }
  if (ovh != null && receivers.length) {
    for (const p of [...pools.values()].filter((x) => x.costCenterId === ovh)) {
      if (p.leftover === 0) continue;
      const parts = shareByWeight(p.leftover, receivers.map(() => 1));
      p.overhead = -p.leftover;
      receivers.forEach((c, i) => {
        const to = pools.get(key(c, p.itemId)) ?? { costCenterId: c, itemId: p.itemId, accountId: p.accountId, actual: 0, standard: 0, overhead: 0, leftover: 0 };
        to.overhead += parts[i];
        pools.set(key(c, p.itemId), to);
      });
    }
  }
  const taken = (p: ClosePoolOut) => p.leftover + p.overhead;

  // 2. Each Production Cost Center's balance over its executions by Driver.
  const total = new Map<number, number>();
  for (const p of pools.values()) if (p.costCenterId !== ovh || !receivers.length) total.set(p.costCenterId, (total.get(p.costCenterId) ?? 0) + taken(p));
  const shareOf = new Map<number, number>();
  const idle: number[] = [];
  for (const [cc, t] of total) {
    if (t === 0) continue;
    const runs = input.runs.filter((r) => r.costCenterId === cc && r.driver > 0);
    if (!runs.length) {
      idle.push(t);
      continue;
    }
    split(t, runs.map((r) => r.driver)).forEach((a, i) => shareOf.set(runs[i].id, (shareOf.get(runs[i].id) ?? 0) + a));
  }
  // 3. A Cost Center with a balance and no Driver: shared by what the executions took, else by Driver, else evenly (M97).
  const idleTotal = sum(idle);
  const dests: CloseDestOut[] = [];
  if (idleTotal !== 0) {
    if (!input.runs.length) {
      dests.push({ kind: "Hpp", itemId: null, bucketId: null, amount: idleTotal });
    } else {
      const byTaken = input.runs.map((r) => Math.max(0, shareOf.get(r.id) ?? 0));
      const w = sum(byTaken) > 0 ? byTaken : input.runs.map((r) => Math.max(0, r.driver));
      split(idleTotal, w).forEach((a, i) => shareOf.set(input.runs[i].id, (shareOf.get(input.runs[i].id) ?? 0) + a));
    }
  }

  // 4–5. Each execution's share to its outputs, then forward through the lots.
  const push = (lotId: number, amount: number, depth: number, stock: Map<number, number>) => {
    if (amount === 0) return;
    const f = input.fate(lotId);
    type Fate = { w: number; apply: (a: number) => void };
    const fates: Fate[] = [
      ...f.held.map((h) => ({ w: h.qty, apply: (a: number) => dests.push({ kind: "Wip" as const, itemId: h.itemId, bucketId: h.bucketId, amount: a }) })),
      ...f.links.map((l) => ({ w: l.qty, apply: (a: number) => (depth < 40 ? push(l.toLotId, a, depth + 1, stock) : dests.push({ kind: "Hpp", itemId: null, bucketId: null, amount: a })) })),
      ...f.released.map((r) => ({
        w: r.qty,
        apply: (a: number) =>
          input.releasePurpose(r.docId) === "scrap" ? dests.push({ kind: "Scrap", itemId: r.itemId, bucketId: null, amount: a }) : stock.set(r.itemId, (stock.get(r.itemId) ?? 0) + a),
      })),
    ].filter((x) => x.w > 0);
    if (!fates.length) {
      dests.push({ kind: "Hpp", itemId: null, bucketId: null, amount });
      return;
    }
    shareByWeight(amount, fates.map((x) => x.w)).forEach((a, i) => fates[i].apply(a));
  };
  const stockIn = new Map<number, number>();
  const shares: CloseShareOut[] = [];
  for (const r of input.runs) {
    const amount = shareOf.get(r.id) ?? 0;
    shares.push({ runId: r.id, driver: r.driver, amount });
    if (amount === 0) continue;
    const eligible = r.outputs.filter((o) => o.weight > 0);
    const basis = eligible.length ? eligible : r.outputs.filter((o) => o.qty > 0);
    if (!basis.length) {
      dests.push({ kind: "Hpp", itemId: null, bucketId: null, amount });
      continue;
    }
    shareByWeight(amount, basis.map((o) => (eligible.length ? o.weight : o.qty))).forEach((a, i) => push(basis[i].lotId, a, 0, stockIn));
  }

  // Stock part per item: sold vs ending by goods available (M27); the ending goes to the pool when it holds any.
  for (const [itemId, x] of stockIn) {
    if (x === 0) continue;
    const f = input.flows(itemId);
    const available = f.opening + f.inflow;
    const sold = available > 0 ? Math.min(Math.abs(x), Math.round((Math.abs(x) * Math.min(f.outflow, available)) / available)) * Math.sign(x) : 0;
    const ending = x - sold;
    if (sold !== 0) dests.push({ kind: "Hpp", itemId, bucketId: null, amount: sold });
    if (ending !== 0) dests.push(f.poolQty > 0 ? { kind: "Stock", itemId, bucketId: null, amount: ending } : { kind: "Hpp", itemId, bucketId: null, amount: ending });
  }

  // Fold the destinations that are the same place.
  const folded = new Map<string, CloseDestOut>();
  for (const d of dests) {
    if (d.amount === 0) continue;
    const k = `${d.kind}:${d.itemId ?? ""}:${d.bucketId ?? ""}`;
    const e = folded.get(k);
    if (e) e.amount += d.amount;
    else folded.set(k, { ...d });
  }
  return {
    pools: [...pools.values()].sort((a, b) => a.costCenterId - b.costCenterId || a.itemId - b.itemId),
    shares,
    dests: [...folded.values()],
    absorbed: sum([...total.values()]),
  };
}
