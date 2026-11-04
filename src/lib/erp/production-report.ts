import "server-only";

import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import type { RefOption } from "./records";
import { deliveriesOfLots } from "./delivery-note";
import { lotStockHistory, lotStockPositions, type LotStockMovement } from "./stock-report";

/**
 * The production reports (R18, P209): **Saldo Produksi** and **Kartu Lot**,
 * salvaged from `walet` without Partai, Job, transit or standard cost, and
 * **Telusur Produksi**. Read-only, and read from the ledgers — never from the balance
 * tables — so a past date is reported as it stood; Saldo Produksi says whether
 * the balance table still equals its ledger.
 *
 * The book is written only by `production-ledger.ts`; this module only reads it
 * (as `stock-report.ts` reads the stock books).
 */

const iso = (d: Date) => d.toISOString().slice(0, 10);
const num = (d: Prisma.Decimal | null | undefined) => (d ? d.toNumber() : 0);
const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

export async function stationOptions(): Promise<RefOption[]> {
  const rows = await prisma.refWorkstation.findMany({ orderBy: { workstation_label: "asc" }, select: { id: true, workstation_label: true, workstation_name: true, status: true } });
  return rows.map((w) => ({ id: w.id, label: w.workstation_label, name: w.workstation_name, active: w.status === "Active" }));
}

// ----------------------------------------------------------- Saldo Produksi

export type WipRow = {
  bucketId: number;
  itemLabel: string;
  itemName: string;
  lotNo: string;
  uom: string;
  qty: number;
  value: number;
  /** value ÷ qty, a description (P114). */
  unitCost: number;
};

export type WipBlock = { stationId: number; stationLabel: string; stationName: string; rows: WipRow[]; value: number };

/**
 * What production held on a date, per workstation: every bucket's balance after
 * its last ledger row on or before it — so a past date is as it stood.
 */
export async function wipBalanceReport(asOf: string, workstationIds: number[]): Promise<WipBlock[]> {
  const last = await prisma.$queryRaw<{ bucket_id: number; qty_balance: Prisma.Decimal; value_balance: Prisma.Decimal }[]>`
    SELECT DISTINCT ON (bucket_id) bucket_id, qty_balance, value_balance
      FROM prd_ledger WHERE posting_date <= ${asOf}::date ORDER BY bucket_id, posting_date DESC, id DESC`;
  const at = new Map(last.filter((l) => num(l.qty_balance) > 0 || num(l.value_balance) !== 0).map((l) => [l.bucket_id, l]));
  if (!at.size) return [];
  const buckets = await prisma.prdBalance.findMany({
    where: { id: { in: [...at.keys()] }, ...(workstationIds.length ? { workstation_id: { in: workstationIds } } : {}) },
    include: {
      tracking: { select: { tracking_no: true } },
      item: { select: { item_label: true, item_name: true, base_uom: { select: { uom_label: true } } } },
      workstation: { select: { workstation_label: true, workstation_name: true } },
    },
  });
  const blocks = new Map<number, WipBlock>();
  for (const b of buckets) {
    const p = at.get(b.id)!;
    const qty = num(p.qty_balance);
    const value = num(p.value_balance);
    const block = blocks.get(b.workstation_id) ?? { stationId: b.workstation_id, stationLabel: b.workstation.workstation_label, stationName: b.workstation.workstation_name, rows: [], value: 0 };
    block.rows.push({
      bucketId: b.id,
      itemLabel: b.item.item_label,
      itemName: b.item.item_name,
      lotNo: b.tracking.tracking_no,
      uom: b.item.base_uom.uom_label,
      qty,
      value,
      unitCost: qty > 0 ? round6(value / qty) : 0,
    });
    block.value += value;
    blocks.set(b.workstation_id, block);
  }
  for (const block of blocks.values()) block.rows.sort((a, b) => a.itemLabel.localeCompare(b.itemLabel) || a.lotNo.localeCompare(b.lotNo));
  return [...blocks.values()].sort((a, b) => a.stationLabel.localeCompare(b.stationLabel));
}

/** Whether every bucket still equals its ledger rows — the book's own check, shown as a warning when it fails. */
export async function productionBooksReconcile(): Promise<boolean> {
  const rows = await prisma.$queryRaw<{ n: bigint }[]>`
    SELECT COUNT(*) AS n FROM prd_balance b
      LEFT JOIN (SELECT bucket_id, SUM(qty_change) AS q, SUM(value_change) AS v FROM prd_ledger GROUP BY bucket_id) l ON l.bucket_id = b.id
     WHERE b.qty_balance <> COALESCE(l.q, 0) OR b.value_balance <> COALESCE(l.v, 0)`;
  return Number(rows[0].n) === 0;
}

// --------------------------------------------------------------- Kartu Lot

export type LotMovement = {
  date: string;
  ledgerNo: string;
  sourceNo: string;
  movement: string;
  stationLabel: string;
  qtyChange: number;
  qtyBalance: number;
  valueChange: number;
  valueBalance: number;
};

export type LotCard = {
  lotId: number;
  lotNo: string;
  itemLabel: string;
  itemName: string;
  uom: string;
  expiry: string | null;
  sourceNo: string;
  supplier: string | null;
  inProduction: LotMovement[];
  inStock: LotStockMovement[];
};

/** How a ledger movement reads on the card. */
export const MOVEMENT_LABEL: Record<string, string> = {
  Issued: "Masuk dari gudang",
  Consumed: "Dipakai",
  Produced: "Dihasilkan",
  TransferOut: "Pindah keluar",
  TransferIn: "Pindah masuk",
  Released: "Keluar produksi",
};

/**
 * Every lot with this number — a lot is unique per item (P120), so one number
 * may name lots of several items — with its whole life: the production
 * ledger's rows and the stock books', by date.
 */
export async function lotCardReport(lotNo: string): Promise<LotCard[]> {
  const lots = await prisma.logStockTracking.findMany({
    where: { tracking_no: { equals: lotNo.trim(), mode: "insensitive" } },
    orderBy: { id: "asc" },
    include: {
      item: { select: { item_label: true, item_name: true, base_uom: { select: { uom_label: true } } } },
      source_partner: { select: { partner_label: true, partner_name: true } },
    },
  });
  return Promise.all(
    lots.map(async (lot) => {
      const [rows, inStock] = await Promise.all([
        prisma.prdLedger.findMany({ where: { tracking_id: lot.id }, orderBy: [{ posting_date: "asc" }, { id: "asc" }], include: { workstation: { select: { workstation_label: true } } } }),
        lotStockHistory(lot.id),
      ]);
      return {
        lotId: lot.id,
        lotNo: lot.tracking_no,
        itemLabel: lot.item.item_label,
        itemName: lot.item.item_name,
        uom: lot.item.base_uom.uom_label,
        expiry: lot.expiry_date ? iso(lot.expiry_date) : null,
        sourceNo: lot.source_no,
        supplier: lot.source_partner ? `${lot.source_partner.partner_label} · ${lot.source_partner.partner_name}` : null,
        inProduction: rows.map((r) => ({
          date: iso(r.posting_date),
          ledgerNo: `${r.ledger_no}#${r.line_no}`,
          sourceNo: r.source_no,
          movement: r.movement,
          stationLabel: r.workstation.workstation_label,
          qtyChange: num(r.qty_change),
          qtyBalance: num(r.qty_balance),
          valueChange: num(r.value_change),
          valueBalance: num(r.value_balance),
        })),
        inStock,
      };
    }),
  );
}

// ---------------------------------------------------------- Telusur Produksi

export type TraceEdge = { sourceNo: string; stationLabel: string; qty: number; value: number };

export type TraceNode = {
  lotId: number;
  lotNo: string;
  itemLabel: string;
  itemName: string;
  uom: string;
  /** Steps from the start lots; 0 is the start. */
  depth: number;
  /** The executions between it and the lot one step nearer the start, with the workstation they ran at. */
  via: TraceEdge[];
  /** Where the lot was registered and from whom, for a lot no execution made. */
  origin: { sourceNo: string; supplier: string | null } | null;
  /** Where it is now: at a workstation, in stock, delivered. Shown for the start and the forward lots. */
  now: { production: { stationLabel: string; qty: number }[]; stock: { where: string; qty: number }[]; delivered: { noteNo: string; date: string; to: string; qty: number }[] } | null;
};

export type TraceReport = { start: TraceNode[]; backward: TraceNode[]; forward: TraceNode[]; truncated: boolean };

const TRACE_NODE_CAP = 300;
const TRACE_DEPTH_CAP = 20;

/**
 * The genealogy of a lot number (R27): back through every execution to the
 * lots that came in from a supplier, and forward to where the goods are now —
 * at a workstation, in stock, or delivered to a customer. Read from
 * `prd_tracking_link`, which every posted execution writes; every lot of the number
 * starts the walk (a lot is unique per item, P120).
 */
export async function traceReport(lotNo: string): Promise<TraceReport | null> {
  const startIds = (await prisma.logStockTracking.findMany({ where: { tracking_no: { equals: lotNo.trim(), mode: "insensitive" } }, select: { id: true } })).map((l) => l.id);
  if (!startIds.length) return null;

  const edgesOf = { back: new Map<number, Map<string, TraceEdge>>(), fwd: new Map<number, Map<string, TraceEdge>>() };
  const depths = { back: new Map<number, number>(), fwd: new Map<number, number>() };
  const walk = async (dir: "back" | "fwd") => {
    const seen = new Set<number>(startIds);
    let frontier = [...startIds];
    const order: number[] = [];
    let depth = 0;
    let truncated = false;
    while (frontier.length && depth < TRACE_DEPTH_CAP) {
      const links = await prisma.prdTrackingLink.findMany({
        where: dir === "back" ? { to_tracking_id: { in: frontier } } : { from_tracking_id: { in: frontier } },
        select: { from_tracking_id: true, to_tracking_id: true, source_no: true, qty: true, value: true, from_bucket: { select: { workstation: { select: { workstation_label: true } } } } },
      });
      depth += 1;
      const next: number[] = [];
      for (const l of links) {
        // Backward a node is an input lot, forward an output lot; each carries the execution between.
        const id = dir === "back" ? l.from_tracking_id : l.to_tracking_id;
        const edges = edgesOf[dir].get(id) ?? new Map<string, TraceEdge>();
        const e = edges.get(l.source_no) ?? { sourceNo: l.source_no, stationLabel: l.from_bucket.workstation.workstation_label, qty: 0, value: 0 };
        e.qty = round6(e.qty + num(l.qty));
        e.value += num(l.value);
        edges.set(l.source_no, e);
        edgesOf[dir].set(id, edges);
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
  const [back, fwd] = await Promise.all([walk("back"), walk("fwd")]);

  const allIds = [...new Set([...startIds, ...back.order, ...fwd.order])];
  const lots = await prisma.logStockTracking.findMany({
    where: { id: { in: allIds } },
    include: { item: { select: { item_label: true, item_name: true, base_uom: { select: { uom_label: true } } } }, source_partner: { select: { partner_label: true, partner_name: true } } },
  });
  const lotBy = new Map(lots.map((l) => [l.id, l]));
  const made = new Set((await prisma.prdTrackingLink.findMany({ where: { to_tracking_id: { in: allIds } }, distinct: ["to_tracking_id"], select: { to_tracking_id: true } })).map((x) => x.to_tracking_id));
  const nowIds = [...new Set([...startIds, ...fwd.order])];
  const [held, stock, delivered] = await Promise.all([
    prisma.prdBalance.findMany({ where: { tracking_id: { in: nowIds }, qty_balance: { gt: 0 } }, include: { workstation: { select: { workstation_label: true } } } }),
    lotStockPositions(nowIds),
    deliveriesOfLots(nowIds),
  ]);
  const node = (id: number, dir: "back" | "fwd" | "start"): TraceNode => {
    const l = lotBy.get(id)!;
    return {
      lotId: id,
      lotNo: l.tracking_no,
      itemLabel: l.item.item_label,
      itemName: l.item.item_name,
      uom: l.item.base_uom.uom_label,
      depth: dir === "start" ? 0 : (depths[dir].get(id) ?? 1),
      via: dir === "start" ? [] : [...(edgesOf[dir].get(id)?.values() ?? [])],
      origin: dir !== "fwd" && !made.has(id) ? { sourceNo: l.source_no, supplier: l.source_partner ? `${l.source_partner.partner_label} · ${l.source_partner.partner_name}` : null } : null,
      now:
        dir === "back"
          ? null
          : {
              production: held.filter((h) => h.tracking_id === id).map((h) => ({ stationLabel: h.workstation.workstation_label, qty: num(h.qty_balance) })),
              stock: stock.filter((s) => s.lotId === id).map((s) => ({ where: s.locationLabel ? `${s.warehouseLabel} · ${s.locationLabel}` : s.warehouseLabel, qty: s.qty })),
              delivered: delivered.filter((d) => d.lotId === id).map((d) => ({ noteNo: d.noteNo, date: d.date, to: `${d.partnerLabel} · ${d.partnerName}`, qty: d.baseQty })),
            },
    };
  };
  return {
    start: startIds.map((id) => node(id, "start")),
    backward: back.order.map((id) => node(id, "back")),
    forward: fwd.order.map((id) => node(id, "fwd")),
    truncated: back.truncated || fwd.truncated,
  };
}
