import { shareByWeight } from "./production-execution";

/**
 * The month-end production costing as pure arithmetic (R10–R14), salvaged from
 * `walet` P172 with one pool instead of Cost Centers and standard cost: no
 * database, so the close, its preview and *Costing Sementara* (R26) all run the
 * same function, and a test can feed it the plan's scenarios.
 */

/** What became of a lot, as the books stand when the close runs. */
export type LotFate = {
  /** Still in production, by bucket. */
  held: { bucketId: number; itemId: number; qty: number }[];
  /** Taken as an input of a later execution, into this output lot. */
  links: { toLotId: number; qty: number }[];
  /** Taken out of production by a Production Release. */
  released: { docId: number; itemId: number; qty: number }[];
};

export type CloseRunIn = { id: number; driver: number; outputs: { lotId: number; weight: number; qty: number }[] };
/** An item's stock pool over the period (M27): before it, in, out, and what it holds now. */
export type CloseFlowIn = { opening: number; inflow: number; outflow: number; poolQty: number };

export type CloseInput = {
  /** The month's pool (R10), whole rupiah. */
  pool: number;
  runs: CloseRunIn[];
  fate: (lotId: number) => LotFate;
  /** `to_stock` or `scrap`, per release document. */
  releasePurpose: (docId: number) => string;
  flows: (itemId: number) => CloseFlowIn;
};

export type CloseShareOut = { runId: number; driver: number; amount: number };
export type CloseDestKind = "Wip" | "Stock" | "Hpp" | "Scrap";
export type CloseDestOut = { kind: CloseDestKind; itemId: number | null; bucketId: number | null; amount: number };
/** Per item received to stock (R25): what reached it, split sold vs kept by goods available. */
export type CloseItemOut = { itemId: number; flow: CloseFlowIn; received: number; hpp: number; stock: number };

export type CloseOutput = { shares: CloseShareOut[]; dests: CloseDestOut[]; items: CloseItemOut[] };

const sum = (xs: number[]) => xs.reduce((a, x) => a + x, 0);

export function settleClose(input: CloseInput): CloseOutput {
  const dests: CloseDestOut[] = [];
  const shares: CloseShareOut[] = [];
  const runs = input.runs.filter((r) => r.driver > 0);

  // R14: a pool with no execution to carry it is HPP.
  if (input.pool !== 0 && !runs.length) dests.push({ kind: "Hpp", itemId: null, bucketId: null, amount: input.pool });
  const parts = runs.length ? shareByWeight(input.pool, runs.map((r) => r.driver)) : [];

  // R12: each lot passes its part on by quantity — still held, taken by a later
  // execution (onward to its outputs), released to stock, or scrapped.
  const stockIn = new Map<number, number>();
  const push = (lotId: number, amount: number, depth: number) => {
    if (amount === 0) return;
    const f = input.fate(lotId);
    const fates = [
      ...f.held.map((h) => ({ w: h.qty, apply: (a: number) => dests.push({ kind: "Wip", itemId: h.itemId, bucketId: h.bucketId, amount: a }) })),
      ...f.links.map((l) => ({ w: l.qty, apply: (a: number) => (depth < 40 ? push(l.toLotId, a, depth + 1) : dests.push({ kind: "Hpp", itemId: null, bucketId: null, amount: a })) })),
      ...f.released.map((r) => ({
        w: r.qty,
        apply: (a: number) => (input.releasePurpose(r.docId) === "scrap" ? dests.push({ kind: "Scrap", itemId: r.itemId, bucketId: null, amount: a }) : stockIn.set(r.itemId, (stockIn.get(r.itemId) ?? 0) + a)),
      })),
    ].filter((x) => x.w > 0);
    // Goods that are nowhere any more (none should be) are expensed rather than lost.
    if (!fates.length) return void dests.push({ kind: "Hpp", itemId: null, bucketId: null, amount });
    shareByWeight(amount, fates.map((x) => x.w)).forEach((a, i) => fates[i].apply(a));
  };
  runs.forEach((r, i) => {
    shares.push({ runId: r.id, driver: r.driver, amount: parts[i] });
    const basis = r.outputs.filter((o) => o.weight > 0);
    if (!basis.length) return void dests.push({ kind: "Hpp", itemId: null, bucketId: null, amount: parts[i] });
    shareByWeight(parts[i], basis.map((o) => o.weight)).forEach((a, j) => push(basis[j].lotId, a, 0));
  });

  // Stock part per item: sold vs kept by goods available; the kept part goes to the pool when it holds any.
  const items: CloseItemOut[] = [];
  for (const [itemId, x] of stockIn) {
    if (x === 0) continue;
    const flow = input.flows(itemId);
    const available = flow.opening + flow.inflow;
    const hpp = available > 0 ? Math.sign(x) * Math.min(Math.abs(x), Math.round((Math.abs(x) * Math.min(flow.outflow, available)) / available)) : 0;
    const kept = x - hpp;
    const stock = flow.poolQty > 0 ? kept : 0;
    if (hpp + (kept - stock) !== 0) dests.push({ kind: "Hpp", itemId, bucketId: null, amount: hpp + (kept - stock) });
    if (stock !== 0) dests.push({ kind: "Stock", itemId, bucketId: null, amount: stock });
    items.push({ itemId, flow, received: x, hpp: hpp + (kept - stock), stock });
  }

  // One destination per place.
  const folded = new Map<string, CloseDestOut>();
  for (const d of dests) {
    if (d.amount === 0) continue;
    const k = `${d.kind}:${d.itemId ?? ""}:${d.bucketId ?? ""}`;
    const e = folded.get(k);
    if (e) e.amount += d.amount;
    else folded.set(k, { ...d });
  }
  const out = { shares, dests: [...folded.values()], items };
  // Every rupiah of the pool lands somewhere (R13).
  if (sum(out.dests.map((d) => d.amount)) !== input.pool) throw new Error("Penutupan tidak seimbang: pool tidak habis terbagi.");
  return out;
}
