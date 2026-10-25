import "server-only";

import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import { deliveriesOfLots } from "./delivery-note";
import type { PeriodRange } from "./period";
import type { RefOption } from "./records";
import { lotStockHistory, lotStockPositions, type LotStockMovement } from "./stock-report";

/**
 * The production reports (Walet step 7, P171): **Saldo Produksi**, **Kartu Lot**,
 * **Telusur** and **Rekap Produksi**. Read-only, and read from the ledgers — never
 * from the balance tables — so a past date is reported as it stood; each says
 * whether the balance table still equals its ledger.
 *
 * The books are written only by `production-ledger.ts` and the documents; this
 * module only reads them (as `stock-report.ts` reads the stock books).
 */

const D = Prisma.Decimal;
const day = (s: string) => new Date(`${s}T00:00:00Z`);
const iso = (d: Date) => d.toISOString().slice(0, 10);
const num = (d: Prisma.Decimal | null | undefined) => (d ? d.toNumber() : 0);
const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

// ----------------------------------------------------------------- options

export async function partaiOptions(): Promise<RefOption[]> {
  const rows = await prisma.prdPartai.findMany({ orderBy: { id: "desc" }, take: 300, select: { id: true, partai_no: true, target_item: { select: { item_label: true } } } });
  return rows.map((p) => ({ id: p.id, label: p.partai_no, name: p.target_item?.item_label ?? "", active: true }));
}

export async function stationOptions(): Promise<RefOption[]> {
  const rows = await prisma.refWorkstation.findMany({ orderBy: { workstation_label: "asc" }, select: { id: true, workstation_label: true, workstation_name: true } });
  return rows.map((w) => ({ id: w.id, label: w.workstation_label, name: w.workstation_name, active: true }));
}

// ----------------------------------------------------------- Saldo Produksi

export type WipStatus = "Tersedia" | "Reject" | "Dalam perjalanan";

export type WipRow = {
  bucketId: number;
  stationLabel: string;
  stationName: string;
  jobNo: string | null;
  itemLabel: string;
  itemName: string;
  lotNo: string;
  uom: string;
  status: WipStatus;
  qty: number;
  value: number;
  /** value ÷ qty, a description (P114). */
  unitCost: number;
};

export type WipBlock = { partaiId: number | null; partaiNo: string | null; targetLabel: string | null; rows: WipRow[]; value: number };

/**
 * What production held on a date, per Partai: every bucket's balance after its
 * last ledger row on or before it — so a past date is as it stood. Goods in
 * transit are shown as such, a Reject as Reject; goods of no Partai yet (stock
 * lots at a station) sit in their own block.
 */
export async function wipBalanceReport(asOf: string, filter: { partaiIds: number[]; workstationIds: number[] }): Promise<WipBlock[]> {
  const last = await prisma.$queryRaw<{ bucket_id: number; qty_balance: Prisma.Decimal; value_balance: Prisma.Decimal }[]>`
    SELECT DISTINCT ON (bucket_id) bucket_id, qty_balance, value_balance
      FROM prd_ledger WHERE posting_date <= ${asOf}::date ORDER BY bucket_id, id DESC`;
  const at = new Map(last.filter((l) => new D(l.qty_balance).gt(0)).map((l) => [l.bucket_id, l]));
  if (!at.size) return [];
  const buckets = await prisma.prdBalance.findMany({
    where: {
      id: { in: [...at.keys()] },
      ...(filter.partaiIds.length ? { partai_id: { in: filter.partaiIds } } : {}),
      ...(filter.workstationIds.length ? { workstation_id: { in: filter.workstationIds } } : {}),
    },
    include: {
      lot: { select: { tracking_no: true } },
      item: { select: { item_label: true, item_name: true, base_uom: { select: { uom_label: true } } } },
      workstation: { select: { workstation_label: true, workstation_name: true } },
      partai: { select: { partai_no: true, target_item: { select: { item_label: true } } } },
      job: { select: { job_no: true } },
    },
  });
  const blocks = new Map<number | null, WipBlock>();
  for (const b of buckets) {
    const p = at.get(b.id)!;
    const qty = num(p.qty_balance as Prisma.Decimal);
    const value = num(p.value_balance as Prisma.Decimal);
    const block = blocks.get(b.partai_id) ?? { partaiId: b.partai_id, partaiNo: b.partai?.partai_no ?? null, targetLabel: b.partai?.target_item?.item_label ?? null, rows: [], value: 0 };
    block.rows.push({
      bucketId: b.id,
      stationLabel: b.workstation.workstation_label,
      stationName: b.workstation.workstation_name,
      jobNo: b.job?.job_no ?? null,
      itemLabel: b.item.item_label,
      itemName: b.item.item_name,
      lotNo: b.lot.tracking_no,
      uom: b.item.base_uom.uom_label,
      status: b.in_transit ? "Dalam perjalanan" : b.is_reject ? "Reject" : "Tersedia",
      qty,
      value,
      unitCost: qty > 0 ? round6(value / qty) : 0,
    });
    block.value += value;
    blocks.set(b.partai_id, block);
  }
  for (const block of blocks.values()) block.rows.sort((a, b) => a.stationLabel.localeCompare(b.stationLabel) || (a.jobNo ?? "").localeCompare(b.jobNo ?? "") || a.lotNo.localeCompare(b.lotNo));
  // Partai first by number, the goods of no Partai last.
  return [...blocks.values()].sort((a, b) => (a.partaiNo === null ? 1 : b.partaiNo === null ? -1 : a.partaiNo.localeCompare(b.partaiNo)));
}

/** Whether the balance table still equals its ledger — the books' own check, shown as a warning when it fails. */
export async function productionBooksReconcile(): Promise<boolean> {
  const [bal, led] = await Promise.all([
    prisma.prdBalance.aggregate({ _sum: { qty_balance: true, value_balance: true } }),
    prisma.$queryRaw<{ q: Prisma.Decimal | null; v: Prisma.Decimal | null }[]>`
      SELECT SUM(qty_change) AS q, SUM(value_change) AS v FROM prd_ledger`,
  ]);
  return num(bal._sum.qty_balance) === num(led[0]?.q) && num(bal._sum.value_balance) === num(led[0]?.v);
}

// --------------------------------------------------------------- Kartu Lot

export type LotMovement = {
  date: string;
  ledgerNo: string;
  sourceNo: string;
  movement: string;
  stationLabel: string;
  inTransit: boolean;
  partaiNo: string | null;
  jobNo: string | null;
  qtyChange: number;
  qtyBalance: number;
  valueChange: number;
  valueBalance: number;
};

export type LotCard = {
  lotNo: string;
  itemLabel: string;
  itemName: string;
  uom: string;
  expiry: string | null;
  sourceNo: string | null;
  supplier: string | null;
  inProduction: LotMovement[];
  inStock: LotStockMovement[];
};

/** One lot's whole life: the production ledger's rows and the stock books', by date (the lot is one register, M128). */
export async function lotCardReport(lotNo: string): Promise<LotCard | null> {
  const lot = await prisma.logStockTracking.findUnique({
    where: { tracking_no: lotNo.trim().toUpperCase() },
    include: { item: { select: { item_label: true, item_name: true, base_uom: { select: { uom_label: true } } } } },
  });
  if (!lot) return null;
  const rows = await prisma.prdLedger.findMany({ where: { lot_id: lot.id }, orderBy: [{ posting_date: "asc" }, { id: "asc" }], include: { workstation: { select: { workstation_label: true } } } });
  const ids = await identityNumbers(rows.flatMap((r) => (r.partai_id ? [r.partai_id] : [])), rows.flatMap((r) => (r.job_id ? [r.job_id] : [])));
  const supplier = lot.source_partner_id ? (await prisma.mPartner.findUnique({ where: { id: lot.source_partner_id }, select: { partner_label: true, partner_name: true } })) : null;
  return {
    lotNo: lot.tracking_no,
    itemLabel: lot.item.item_label,
    itemName: lot.item.item_name,
    uom: lot.item.base_uom.uom_label,
    expiry: lot.expiry_date ? iso(lot.expiry_date) : null,
    sourceNo: lot.source_no,
    supplier: supplier ? `${supplier.partner_label} · ${supplier.partner_name}` : null,
    inProduction: rows.map((r) => ({
      date: iso(r.posting_date),
      ledgerNo: `${r.ledger_no}#${r.line_no}`,
      sourceNo: r.source_no,
      movement: r.movement,
      stationLabel: r.workstation.workstation_label,
      inTransit: r.in_transit,
      partaiNo: r.partai_id ? (ids.partai.get(r.partai_id) ?? null) : null,
      jobNo: r.job_id ? (ids.jobs.get(r.job_id) ?? null) : null,
      qtyChange: num(r.qty_change),
      qtyBalance: num(r.qty_balance),
      valueChange: num(r.value_change),
      valueBalance: num(r.value_balance),
    })),
    inStock: await lotStockHistory(lot.id),
  };
}

async function identityNumbers(partaiIds: number[], jobIds: number[]) {
  const [p, j] = await Promise.all([
    partaiIds.length ? prisma.prdPartai.findMany({ where: { id: { in: [...new Set(partaiIds)] } }, select: { id: true, partai_no: true } }) : [],
    jobIds.length ? prisma.prdJob.findMany({ where: { id: { in: [...new Set(jobIds)] } }, select: { id: true, job_no: true } }) : [],
  ]);
  return { partai: new Map(p.map((x) => [x.id, x.partai_no])), jobs: new Map(j.map((x) => [x.id, x.job_no])) };
}

// ----------------------------------------------------------------- Telusur

export type TraceEdge = { sourceNo: string; qty: number; value: number };

export type TraceNode = {
  lotId: number;
  lotNo: string;
  itemLabel: string;
  itemName: string;
  uom: string;
  /** Steps from the start lots; 0 is the start. */
  depth: number;
  /** What made it (backward) or what it made (forward), per run. */
  via: TraceEdge[];
  /** Backward ends: where the lot was registered (a receipt, an injection) and from whom. */
  origin: { sourceNo: string | null; supplier: string | null } | null;
  /** Forward ends and the start: where it is now. */
  now: { production: { stationLabel: string; qty: number }[]; stock: { where: string; qty: number }[]; delivered: { noteNo: string; date: string; to: string; qty: number }[] } | null;
};

export type TraceReport = {
  subject: string;
  kind: "lot" | "job" | "partai";
  start: TraceNode[];
  /** Where the goods came from, nearest first, down to the supplier's lots. */
  backward: TraceNode[];
  /** Where they went, nearest first, to finished goods and the customer. */
  forward: TraceNode[];
  truncated: boolean;
};

const TRACE_NODE_CAP = 300;
const TRACE_DEPTH_CAP = 14;

/**
 * The genealogy of a lot, a Job or a Partai (M127, M128): back through every run
 * to the lots that came from a supplier, and forward to the finished goods in stock
 * and the customer they were delivered to. A Job or Partai starts from every lot it
 * ever held.
 */
export async function traceReport(query: string): Promise<TraceReport | null> {
  const q = query.trim().toUpperCase();
  if (!q) return null;
  let kind: TraceReport["kind"] = "lot";
  let startIds: number[] = [];
  const lot = await prisma.logStockTracking.findUnique({ where: { tracking_no: q }, select: { id: true } });
  if (lot) startIds = [lot.id];
  else {
    const job = await prisma.prdJob.findUnique({ where: { job_no: q }, select: { id: true } });
    const partai = job ? null : await prisma.prdPartai.findUnique({ where: { partai_no: q }, select: { id: true } });
    if (job) {
      kind = "job";
      startIds = (await prisma.prdLedger.findMany({ where: { job_id: job.id }, distinct: ["lot_id"], select: { lot_id: true } })).map((r) => r.lot_id);
    } else if (partai) {
      kind = "partai";
      startIds = (await prisma.prdLedger.findMany({ where: { partai_id: partai.id }, distinct: ["lot_id"], select: { lot_id: true } })).map((r) => r.lot_id);
    }
  }
  if (!startIds.length) return null;

  type Link = { from_lot_id: number; to_lot_id: number; source_no: string; qty: Prisma.Decimal; value: Prisma.Decimal };
  const edgesOf = new Map<number, Map<string, TraceEdge>>();
  // Depths are tracked per direction (a lot can be an ancestor and a descendant of different start lots).
  const depths = { back: new Map<number, number>(), fwd: new Map<number, number>() };
  const walkDir = async (dir: "back" | "fwd") => {
    const seen = new Set<number>(startIds);
    let frontier = [...startIds];
    const order: number[] = [];
    let depth = 0;
    let truncated = false;
    while (frontier.length && depth < TRACE_DEPTH_CAP) {
      const links: Link[] = await prisma.prdLotLink.findMany({
        where: dir === "back" ? { to_lot_id: { in: frontier } } : { from_lot_id: { in: frontier } },
        select: { from_lot_id: true, to_lot_id: true, source_no: true, qty: true, value: true },
      });
      depth += 1;
      const next: number[] = [];
      for (const l of links) {
        const id = dir === "back" ? l.from_lot_id : l.to_lot_id;
        const k = `${dir}:${id}`;
        const edges = edgesOf.get(id) ?? new Map<string, TraceEdge>();
        const e = edges.get(k + l.source_no) ?? { sourceNo: l.source_no, qty: 0, value: 0 };
        e.qty = round6(e.qty + num(l.qty));
        e.value += num(l.value);
        edges.set(k + l.source_no, e);
        edgesOf.set(id, edges);
        if (seen.has(id)) continue;
        if (order.length >= TRACE_NODE_CAP) {
          truncated = true;
          continue;
        }
        seen.add(id);
        order.push(id);
        depths[dir].set(id, depth);
        next.push(id);
      }
      frontier = next;
    }
    return { order, truncated };
  };
  const [back, fwd] = await Promise.all([walkDir("back"), walkDir("fwd")]);

  const allIds = [...new Set([...startIds, ...back.order, ...fwd.order])];
  const lots = await prisma.logStockTracking.findMany({
    where: { id: { in: allIds } },
    include: { item: { select: { item_label: true, item_name: true, base_uom: { select: { uom_label: true } } } } },
  });
  const lotBy = new Map(lots.map((l) => [l.id, l]));
  const partnerIds = [...new Set(lots.flatMap((l) => (l.source_partner_id ? [l.source_partner_id] : [])))];
  const partners = partnerIds.length ? await prisma.mPartner.findMany({ where: { id: { in: partnerIds } }, select: { id: true, partner_label: true, partner_name: true } }) : [];
  const partnerBy = new Map(partners.map((p) => [p.id, `${p.partner_label} · ${p.partner_name}`]));

  // Where the forward ends — and the start — are now.
  const hasOut = new Set((await prisma.prdLotLink.findMany({ where: { from_lot_id: { in: allIds } }, distinct: ["from_lot_id"], select: { from_lot_id: true } })).map((r) => r.from_lot_id));
  const hasIn = new Set((await prisma.prdLotLink.findMany({ where: { to_lot_id: { in: allIds } }, distinct: ["to_lot_id"], select: { to_lot_id: true } })).map((r) => r.to_lot_id));
  const nowIds = [...new Set([...startIds, ...fwd.order.filter((id) => !hasOut.has(id))])];
  const [held, stock, delivered] = await Promise.all([
    nowIds.length ? prisma.prdBalance.findMany({ where: { lot_id: { in: nowIds }, qty_balance: { gt: 0 } }, include: { workstation: { select: { workstation_label: true } } } }) : [],
    lotStockPositions(nowIds),
    deliveriesOfLots(nowIds),
  ]);
  const now = (id: number): TraceNode["now"] => ({
    production: held.filter((h) => h.lot_id === id).map((h) => ({ stationLabel: h.in_transit ? `${h.workstation.workstation_label} (dalam perjalanan)` : h.workstation.workstation_label, qty: num(h.qty_balance) })),
    stock: stock.filter((s) => s.lotId === id).map((s) => ({ where: s.locationLabel ? `${s.warehouseLabel} · ${s.locationLabel}` : s.warehouseLabel, qty: s.qty })),
    delivered: delivered.filter((d) => d.lotId === id).map((d) => ({ noteNo: d.noteNo, date: d.date, to: `${d.partnerLabel} · ${d.partnerName}`, qty: d.baseQty })),
  });
  const node = (id: number, depth: number, dir: "back" | "fwd" | "start"): TraceNode => {
    const l = lotBy.get(id)!;
    const edges = dir === "start" ? [] : [...(edgesOf.get(id)?.entries() ?? [])].filter(([k]) => k.startsWith(`${dir}:`)).map(([, e]) => e);
    return {
      lotId: id,
      lotNo: l.tracking_no,
      itemLabel: l.item.item_label,
      itemName: l.item.item_name,
      uom: l.item.base_uom.uom_label,
      depth,
      via: edges,
      origin: dir === "back" && !hasIn.has(id) ? { sourceNo: l.source_no, supplier: l.source_partner_id ? (partnerBy.get(l.source_partner_id) ?? null) : null } : null,
      now: dir === "start" || (dir === "fwd" && !hasOut.has(id)) ? now(id) : null,
    };
  };
  const subject = kind === "lot" ? `Lot ${q}` : kind === "job" ? `Job ${q}` : `Partai ${q}`;
  return {
    subject,
    kind,
    start: startIds.map((id) => node(id, 0, "start")),
    backward: back.order.map((id) => node(id, depths.back.get(id) ?? 1, "back")),
    forward: fwd.order.map((id) => node(id, depths.fwd.get(id) ?? 1, "fwd")),
    truncated: back.truncated || fwd.truncated,
  };
}

// ---------------------------------------------------------- Rekap Produksi

export type RecapRow = {
  stationId: number;
  stationLabel: string;
  stationName: string;
  uom: string;
  runs: number;
  inQty: number;
  outQty: number;
  /** In − out: a loss (susut) when positive, a gain (tambahan) when negative. */
  loss: number;
  lossPct: number;
  inValue: number;
  outValue: number;
  /** Per unit: what a gram (or piece) cost going in and coming out — the loss raising the cost per unit (F10). */
  inUnitCost: number;
  outUnitCost: number;
};

export type RecapStation = { stationId: number; stationLabel: string; stationName: string; runs: number; standard: number; rows: RecapRow[]; executions: { id: number; no: string; date: string; kind: string }[] };

/**
 * Per workstation over a period: what went in and came out of its posted runs per
 * unit of measure, the loss (susut), the standard it booked, and the cost per unit
 * in and out — so the rise in HPP per gram at each station is visible (F10).
 */
export async function runRecapReport(range: PeriodRange, workstationIds: number[]): Promise<RecapStation[]> {
  const runs = await prisma.prdExecution.findMany({
    where: { status: "Posted", execution_date: { gte: day(range.from), lte: day(range.to) }, ...(workstationIds.length ? { workstation_id: { in: workstationIds } } : {}) },
    orderBy: [{ execution_date: "asc" }, { id: "asc" }],
    include: { workstation: { select: { workstation_label: true, workstation_name: true } }, sections: { include: { inputs: true, outputs: true } } },
  });
  const itemIds = [...new Set(runs.flatMap((r) => r.sections.flatMap((s) => [...s.inputs.map((x) => x.item_id), ...s.outputs.map((o) => o.item_id)])))];
  const items = itemIds.length ? await prisma.mItem.findMany({ where: { id: { in: itemIds } }, select: { id: true, base_uom: { select: { uom_label: true } } } }) : [];
  const uomOf = new Map(items.map((i) => [i.id, i.base_uom.uom_label]));
  const stations = new Map<number, RecapStation & { by: Map<string, RecapRow & { runIds: Set<number> }> }>();
  for (const r of runs) {
    const st: RecapStation & { by: Map<string, RecapRow & { runIds: Set<number> }> } =
      stations.get(r.workstation_id) ??
      { stationId: r.workstation_id, stationLabel: r.workstation.workstation_label, stationName: r.workstation.workstation_name, runs: 0, standard: 0, rows: [], executions: [], by: new Map() };
    st.runs += 1;
    st.standard += num(r.standard_amount);
    st.executions.push({ id: r.id, no: r.execution_no, date: iso(r.execution_date), kind: r.kind });
    const row = (uom: string) => {
      const k = uom;
      const had = st.by.get(k);
      if (had) return had;
      const fresh = { stationId: st.stationId, stationLabel: st.stationLabel, stationName: st.stationName, uom, runs: 0, inQty: 0, outQty: 0, loss: 0, lossPct: 0, inValue: 0, outValue: 0, inUnitCost: 0, outUnitCost: 0, runIds: new Set<number>() };
      st.by.set(k, fresh);
      return fresh;
    };
    for (const s of r.sections) {
      for (const x of s.inputs) {
        const g = row(uomOf.get(x.item_id) ?? "");
        g.inQty += num(x.qty);
        g.inValue += num(x.cost_amount);
        g.runIds.add(r.id);
      }
      for (const o of s.outputs) {
        const g = row(uomOf.get(o.item_id) ?? "");
        g.outQty += num(o.qty);
        g.outValue += num(o.cost_amount);
        g.runIds.add(r.id);
      }
    }
    stations.set(r.workstation_id, st);
  }
  return [...stations.values()]
    .map(({ by, ...st }) => ({
      ...st,
      rows: [...by.values()]
        .map(({ runIds, ...g }) => ({
          ...g,
          runs: runIds.size,
          inQty: round6(g.inQty),
          outQty: round6(g.outQty),
          loss: round6(g.inQty - g.outQty),
          lossPct: g.inQty > 0 ? Math.round(((g.inQty - g.outQty) / g.inQty) * 10_000) / 100 : 0,
          inUnitCost: g.inQty > 0 ? round6(g.inValue / g.inQty) : 0,
          outUnitCost: g.outQty > 0 ? round6(g.outValue / g.outQty) : 0,
        }))
        .sort((a, b) => a.uom.localeCompare(b.uom)),
    }))
    .sort((a, b) => a.stationLabel.localeCompare(b.stationLabel));
}
