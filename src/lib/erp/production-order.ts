import "server-only";

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { lotOptions } from "./inventory";
import { routingAndBomChoices, type BomChoice, type RoutingChoice } from "./production-master";
import { nextDailyNumber } from "./production-number";
import { ROUTING_MODE_TEXT, type RoutingStepModeValue } from "./production-master-shape";
import {
  PRODUCTION_ORDER_TRANSITIONS,
  productionOrderIsEditable,
  productionOrderTransitionAllowed,
  type ProductionOrderAction,
  type ProductionOrderStatus,
} from "./production-order-workflow";

/**
 * The Perintah Produksi module (Walet build step 3, `production_project.md`
 * M121): its tables are `prd_order`, `prd_order_step` and `prd_order_lot`, and
 * nothing else names them.
 *
 * PPIC raises one Perintah per Partai: the **Job Order** (the item the Partai
 * is to become), its **route** — copied from a Routing of that item and
 * changed freely while a Draft — and the **stock lots planned** for it, each
 * in its base unit, in one warehouse. *Buka* makes it Open; only then may a
 * Logistik BSTB be raised from it (`productionOrdersForIssue`), which sends the
 * lots and checks the stock. The planned lots are a plan, not a reservation.
 * The Partai itself is started later, when the first station hands its goods
 * on in Jobs (O3, step 4). Posts nothing.
 */

type Db = Prisma.TransactionClient | typeof prisma;

export type ProductionOrderHeaderInput = {
  order_date: string;
  target_item_id: number | null;
  routing_id: number | null;
  warehouse_id: number | null;
  note: string;
};

export type ProductionOrderStepInput = { workstation_id: number | null; mode: RoutingStepModeValue | null; bom_id: number | null };

export type ProductionOrderLotInput = { item_id: number | null; lot_id: number | null; qty: number | string; note: string };

export type ProductionOrderResult = { ok: true; id: number; orderNo: string } | { ok: false; errors: Record<string, string> };

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const asDate = (d: string) => new Date(`${d}T00:00:00Z`);
const isoDay = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "");
const text = (v: unknown) => String(v ?? "").trim() || null;

/** Quantities are `Decimal(18, 4)`, compared in ten-thousandths. */
const QTY_SCALE = 10_000;
const units = (n: number) => Math.round(n * QTY_SCALE);
const fromUnits = (u: number) => u / QTY_SCALE;

// ---------------------------------------------------------------- options

export type PpOption = { id: number; label: string; name: string; active: boolean };
export type PpItemOption = PpOption & { uomId: number; uomLabel: string };
export type PpLotOption = { id: number; lotNo: string; expiry: string | null; available: number };

export type ProductionOrderOptions = {
  /** Barang with Kelola Stok — the only items production holds (M8). */
  items: PpItemOption[];
  routings: RoutingChoice[];
  workstations: PpOption[];
  boms: BomChoice[];
  warehouses: PpOption[];
  /** Lots with stock, per warehouse id, then item id — summed over locations; earliest expiry first. */
  lots: Record<number, Record<number, PpLotOption[]>>;
};

export type ProductionOrderCurrent = {
  targetItemId: number;
  routingId: number | null;
  warehouseId: number;
  workstationIds: number[];
  bomIds: number[];
  itemIds: number[];
  lotIds: number[];
};

/**
 * What the form offers. `current` is a stored Perintah: what it names stays
 * readable whatever its status now.
 */
export async function productionOrderOptions(current: ProductionOrderCurrent | null = null, db: Db = prisma): Promise<ProductionOrderOptions> {
  const itemIds = current ? [current.targetItemId, ...current.itemIds] : [];
  const [items, choices, workstations, warehouses] = await Promise.all([
    db.mItem.findMany({
      where: { OR: [{ item_type: "Barang", track_stock: true, status: "Active" }, ...(itemIds.length ? [{ id: { in: itemIds } }] : [])] },
      orderBy: { item_label: "asc" },
      select: { id: true, item_label: true, item_name: true, status: true, item_type: true, track_stock: true, base_uom_id: true, base_uom: { select: { uom_label: true } } },
    }),
    routingAndBomChoices({ routingIds: current?.routingId ? [current.routingId] : [], bomIds: current?.bomIds ?? [] }, db),
    db.refWorkstation.findMany({
      where: { OR: [{ status: "Active" }, ...(current?.workstationIds.length ? [{ id: { in: current.workstationIds } }] : [])] },
      orderBy: { workstation_label: "asc" },
      select: { id: true, workstation_label: true, workstation_name: true, status: true },
    }),
    db.refWarehouse.findMany({
      where: { OR: [{ status: "Active" }, ...(current ? [{ id: current.warehouseId }] : [])] },
      orderBy: { warehouse_label: "asc" },
      select: { id: true, warehouse_label: true, warehouse_name: true, status: true },
    }),
  ]);
  const byWarehouse = await lotOptions(
    items.map((i) => i.id),
    warehouses.map((w) => w.id),
    db,
    current?.lotIds ?? []
  );
  const lots: ProductionOrderOptions["lots"] = {};
  for (const [w, byItem] of byWarehouse) {
    lots[w] = {};
    for (const [itemId, options] of byItem) {
      // A plan names a lot, not where in the warehouse it lies: the BSTB picks the location.
      const summed = new Map<number, PpLotOption>();
      for (const o of options) {
        const s = summed.get(o.id) ?? { id: o.id, lotNo: o.lotNo, expiry: o.expiry, available: 0 };
        s.available = fromUnits(units(s.available) + units(o.available));
        summed.set(o.id, s);
      }
      lots[w][itemId] = [...summed.values()].sort((a, b) => (a.expiry ?? "9999").localeCompare(b.expiry ?? "9999") || a.lotNo.localeCompare(b.lotNo));
    }
  }
  const stockItem = (i: (typeof items)[number]) => i.status === "Active" && i.item_type === "Barang" && i.track_stock;
  return {
    items: items.map((i) => ({ id: i.id, label: i.item_label, name: i.item_name, active: stockItem(i), uomId: i.base_uom_id, uomLabel: i.base_uom.uom_label })),
    routings: choices.routings,
    workstations: workstations.map((w) => ({ id: w.id, label: w.workstation_label, name: w.workstation_name, active: w.status === "Active" })),
    boms: choices.boms,
    warehouses: warehouses.map((w) => ({ id: w.id, label: w.warehouse_label, name: w.warehouse_name, active: w.status === "Active" })),
    lots,
  };
}

// ------------------------------------------------------------- validation

type CheckedStep = { step_no: number; workstation_id: number; mode: RoutingStepModeValue; bom_id: number | null };
type CheckedLot = { line_no: number; item_id: number; lot_id: number; uom_id: number; qty: number; note: string | null };

type Checked = {
  data: { order_date: Date; target_item_id: number; routing_id: number | null; warehouse_id: number; note: string | null };
  steps: CheckedStep[];
  lots: CheckedLot[];
};

/**
 * Every rule a Perintah must satisfy to be saved — and, run again with
 * `forOpening`, to be opened: everything it names still active.
 */
export async function checkProductionOrder(
  db: Db,
  header: ProductionOrderHeaderInput,
  steps: ProductionOrderStepInput[],
  lots: ProductionOrderLotInput[],
  selfId: number | null,
  forOpening = false
): Promise<{ ok: true; c: Checked } | { ok: false; errors: Record<string, string> }> {
  const errors: Record<string, string> = {};
  const stored = selfId
    ? await db.prdOrder.findUnique({ where: { id: selfId }, include: { steps: true, lots: true } })
    : null;
  const options = await productionOrderOptions(stored ? currentOf(stored) : null, db);
  // Stored names stay readable on a Draft; opening needs them active again.
  const usable = <T extends PpOption>(list: T[], id: number | null, storedIds: (number | null)[]) => {
    const o = id ? list.find((x) => x.id === id) : undefined;
    return o && (o.active || (!forOpening && storedIds.includes(id))) ? o : undefined;
  };

  const orderDate = String(header.order_date ?? "").trim();
  if (!DAY.test(orderDate)) errors.order_date = "Tanggal wajib diisi.";

  const targetId = Number(header.target_item_id) || null;
  const target = usable(options.items, targetId, [stored?.target_item_id ?? null]);
  if (!targetId) errors.target_item_id = "Pilih Job Order — barang yang akan dibuat.";
  else if (!target) errors.target_item_id = "Job Order harus Barang aktif dengan Kelola Stok.";

  const routingId = Number(header.routing_id) || null;
  if (routingId) {
    const r = usable(options.routings, routingId, [stored?.routing_id ?? null]);
    if (!r) errors.routing_id = "Routing tidak ditemukan atau nonaktif.";
    else if (targetId && r.itemId !== targetId) errors.routing_id = "Routing ini untuk barang lain.";
  }

  const warehouseId = Number(header.warehouse_id) || null;
  const warehouse = usable(options.warehouses, warehouseId, [stored?.warehouse_id ?? null]);
  if (!warehouseId) errors.warehouse_id = "Pilih gudang asal lot.";
  else if (!warehouse) errors.warehouse_id = "Gudang tidak ditemukan atau nonaktif.";

  const rawSteps = Array.isArray(steps) ? steps : [];
  const outSteps: CheckedStep[] = [];
  if (!rawSteps.length) errors._steps = "Tambahkan minimal satu workstation.";
  for (const [i, s] of rawSteps.entries()) {
    const k = (f: string) => `steps.${i}.${f}`;
    const wsId = Number(s.workstation_id) || null;
    const ws = usable(options.workstations, wsId, stored?.steps.map((x) => x.workstation_id) ?? []);
    if (!wsId) errors[k("workstation_id")] = "Pilih workstation.";
    else if (!ws) errors[k("workstation_id")] = "Workstation tidak ditemukan atau nonaktif.";
    const mode = s.mode && s.mode in ROUTING_MODE_TEXT ? s.mode : null;
    if (!mode) errors[k("mode")] = "Pilih cara kerja.";
    const bomId = Number(s.bom_id) || null;
    if (bomId && !usable(options.boms, bomId, stored?.steps.map((x) => x.bom_id) ?? [])) errors[k("bom_id")] = "BoM tidak ditemukan atau nonaktif.";
    if (ws && mode) outSteps.push({ step_no: outSteps.length + 1, workstation_id: ws.id, mode, bom_id: bomId });
  }
  if (!errors._steps && Object.keys(errors).some((x) => x.startsWith("steps."))) errors._steps = "Ada langkah yang perlu diperbaiki.";

  const rawLots = Array.isArray(lots) ? lots : [];
  const outLots: CheckedLot[] = [];
  if (!rawLots.length) errors._lots = "Tambahkan minimal satu lot yang direncanakan.";
  const seen = new Set<number>();
  for (const [i, l] of rawLots.entries()) {
    const k = (f: string) => `lots.${i}.${f}`;
    const itemId = Number(l.item_id) || null;
    const item = usable(options.items, itemId, stored?.lots.map((x) => x.item_id) ?? []);
    if (!itemId) {
      errors[k("item_id")] = "Pilih barang.";
      continue;
    }
    if (!item) {
      errors[k("item_id")] = "Hanya Barang aktif dengan Kelola Stok yang masuk produksi.";
      continue;
    }
    const lotId = Number(l.lot_id) || null;
    const offered = warehouse ? (options.lots[warehouse.id]?.[item.id] ?? []) : [];
    const lot = lotId ? offered.find((x) => x.id === lotId) : undefined;
    if (!lotId) {
      errors[k("lot_id")] = "Pilih lot.";
      continue;
    }
    if (!lot) {
      errors[k("lot_id")] = `Lot ini tidak ada di gudang untuk ${item.label}.`;
      continue;
    }
    if (seen.has(lot.id)) {
      errors[k("lot_id")] = `Lot ${lot.lotNo} direncanakan lebih dari sekali.`;
      continue;
    }
    seen.add(lot.id);
    const qty = Number(String(l.qty ?? "").replace(",", "."));
    if (!Number.isFinite(qty) || !(qty > 0)) {
      errors[k("qty")] = "Isi jumlah lebih dari 0.";
      continue;
    }
    if (Math.abs(qty * QTY_SCALE - units(qty)) > 1e-6) {
      errors[k("qty")] = "Paling banyak 4 angka desimal.";
      continue;
    }
    outLots.push({ line_no: outLots.length + 1, item_id: item.id, lot_id: lot.id, uom_id: item.uomId, qty: fromUnits(units(qty)), note: text(l.note) });
  }
  if (!errors._lots && Object.keys(errors).some((x) => x.startsWith("lots."))) errors._lots = "Ada lot yang perlu diperbaiki.";

  if (Object.keys(errors).length || !target || !warehouse) return { ok: false, errors };
  return {
    ok: true,
    c: {
      data: { order_date: asDate(orderDate), target_item_id: target.id, routing_id: routingId, warehouse_id: warehouse.id, note: text(header.note) },
      steps: outSteps,
      lots: outLots,
    },
  };
}

// ------------------------------------------------------------------ writes

async function nextOrderNo(db: Db, date: Date): Promise<string> {
  return nextDailyNumber(["PP"], date, async (series) => {
    const row = await db.prdOrder.findFirst({ where: { order_no: { startsWith: series } }, orderBy: { id: "desc" }, select: { order_no: true } });
    return row?.order_no ?? null;
  });
}

async function audit(db: Db, id: number, action: "TAMBAH" | "UPDATE", event: string, by: number) {
  await db.auditLog.create({ data: { entity_key: "prd_order", row_id: id, action, event, by } });
}

class Refused extends Error {
  constructor(readonly errors: Record<string, string>) {
    super("refused");
  }
}

async function refusable<T>(run: () => Promise<T>): Promise<T | { ok: false; errors: Record<string, string> }> {
  try {
    return await run();
  } catch (e) {
    if (e instanceof Refused) return { ok: false, errors: e.errors };
    throw e;
  }
}

export async function createProductionOrder(
  header: ProductionOrderHeaderInput,
  steps: ProductionOrderStepInput[],
  lots: ProductionOrderLotInput[],
  actorId: number
): Promise<ProductionOrderResult> {
  return refusable(async () => {
    const made = await prisma.$transaction(async (tx) => {
      const r = await checkProductionOrder(tx, header, steps, lots, null);
      if (!r.ok) throw new Refused(r.errors);
      const row = await tx.prdOrder.create({
        data: {
          ...r.c.data,
          order_no: await nextOrderNo(tx, r.c.data.order_date),
          created_by: actorId,
          steps: { create: r.c.steps },
          lots: { create: r.c.lots },
        },
      });
      await audit(tx, row.id, "TAMBAH", "create", actorId);
      return row;
    });
    return { ok: true as const, id: made.id, orderNo: made.order_no };
  });
}

export async function updateProductionOrder(
  id: number,
  header: ProductionOrderHeaderInput,
  steps: ProductionOrderStepInput[],
  lots: ProductionOrderLotInput[],
  actorId: number
): Promise<ProductionOrderResult> {
  const current = await prisma.prdOrder.findUnique({ where: { id }, select: { status: true, order_no: true } });
  if (!current) return { ok: false, errors: { _form: "Perintah Produksi tidak ditemukan." } };
  if (!productionOrderIsEditable(current.status as ProductionOrderStatus)) {
    return { ok: false, errors: { _form: "Perintah yang sudah dibuka tidak dapat diubah." } };
  }
  return refusable(async () => {
    await prisma.$transaction(async (tx) => {
      const r = await checkProductionOrder(tx, header, steps, lots, id);
      if (!r.ok) throw new Refused(r.errors);
      const done = await tx.prdOrder.updateMany({ where: { id, status: "Draft" }, data: { ...r.c.data, updated_by: actorId } });
      if (done.count !== 1) throw new Refused({ _form: "Perintah berubah saat diproses. Muat ulang halaman." });
      // A Draft's route and lots are rewritten whole: nothing names them before it is Open.
      await tx.prdOrderStep.deleteMany({ where: { order_id: id } });
      await tx.prdOrderLot.deleteMany({ where: { order_id: id } });
      await tx.prdOrderStep.createMany({ data: r.c.steps.map((s) => ({ ...s, order_id: id })) });
      await tx.prdOrderLot.createMany({ data: r.c.lots.map((l) => ({ ...l, order_id: id })) });
      await audit(tx, id, "UPDATE", "update", actorId);
    });
    return { ok: true as const, id, orderNo: current.order_no };
  });
}

const WITH_ALL = { steps: { orderBy: { step_no: "asc" as const } }, lots: { orderBy: { line_no: "asc" as const } } };
type Stored = Prisma.PrdOrderGetPayload<{ include: typeof WITH_ALL }>;

function currentOf(o: Prisma.PrdOrderGetPayload<{ include: { steps: true; lots: true } }>): ProductionOrderCurrent {
  return {
    targetItemId: o.target_item_id,
    routingId: o.routing_id,
    warehouseId: o.warehouse_id,
    workstationIds: o.steps.map((s) => s.workstation_id),
    bomIds: o.steps.flatMap((s) => (s.bom_id ? [s.bom_id] : [])),
    itemIds: o.lots.map((l) => l.item_id),
    lotIds: o.lots.map((l) => l.lot_id),
  };
}

function asInput(o: Stored) {
  return {
    header: {
      order_date: isoDay(o.order_date),
      target_item_id: o.target_item_id,
      routing_id: o.routing_id,
      warehouse_id: o.warehouse_id,
      note: o.note ?? "",
    } satisfies ProductionOrderHeaderInput,
    steps: o.steps.map((s) => ({ workstation_id: s.workstation_id, mode: s.mode as RoutingStepModeValue, bom_id: s.bom_id })),
    lots: o.lots.map((l) => ({ item_id: l.item_id, lot_id: l.lot_id, qty: l.qty.toNumber(), note: l.note ?? "" })),
  };
}

// --------------------------------------------------------------- lifecycle

export type ProductionOrderTransitionResult = { ok: true } | { ok: false; errors: Record<string, string> };

/**
 * One lifecycle step. **Buka** checks the stored Perintah again — anything it
 * names may have been deactivated since. Batalkan and Tutup ask for a reason,
 * kept in `status_reason`. **Tutup** takes a `guard` from the action layer,
 * which knows the BSTBs raised from it (§3.1: the BSTB depends on the
 * Perintah, never the reverse). Every step is conditional on the status just
 * read.
 */
export async function transitionProductionOrder(
  id: number,
  action: ProductionOrderAction,
  actorId: number,
  reason?: string,
  guard?: () => Promise<string | null>
): Promise<ProductionOrderTransitionResult> {
  const order = await prisma.prdOrder.findUnique({ where: { id }, include: WITH_ALL });
  if (!order) return { ok: false, errors: { _form: "Perintah Produksi tidak ditemukan." } };
  const t = PRODUCTION_ORDER_TRANSITIONS[action];
  if (!productionOrderTransitionAllowed(action, order.status as ProductionOrderStatus)) {
    return { ok: false, errors: { _form: `Perintah berstatus ini tidak dapat di-${t.label.toLowerCase()}.` } };
  }
  let why: string | null = null;
  if (t.reason) {
    why = String(reason ?? "").trim();
    if (!why) return { ok: false, errors: { reason: "Alasan wajib diisi." } };
  }
  return refusable(async () => {
    await prisma.$transaction(async (tx) => {
      // The row is locked first, so a BSTB being posted from it waits (it locks the same row).
      await tx.$queryRaw`SELECT id FROM prd_order WHERE id = ${id} FOR UPDATE`;
      if (action === "open") {
        const input = asInput(order);
        const r = await checkProductionOrder(tx, input.header, input.steps, input.lots, id, true);
        if (!r.ok) {
          const first = Object.entries(r.errors).find(([k]) => !k.startsWith("_"))?.[1] ?? Object.values(r.errors)[0];
          throw new Refused({ _form: `Belum bisa dibuka: ${first}` });
        }
      }
      if (action === "close" && guard) {
        const refusal = await guard();
        if (refusal) throw new Refused({ _form: refusal });
      }
      const done = await tx.prdOrder.updateMany({
        where: { id, status: order.status },
        data: { status: t.to, ...(why ? { status_reason: why } : {}), updated_by: actorId },
      });
      if (done.count !== 1) throw new Refused({ _form: "Perintah berubah saat diproses. Muat ulang halaman." });
      await audit(tx, id, "UPDATE", action, actorId);
    });
    return { ok: true as const };
  });
}

// ------------------------------------------------------------------- reads

export type ProductionOrderListRow = {
  id: number;
  orderNo: string;
  orderDate: string;
  status: ProductionOrderStatus;
  targetLabel: string;
  targetName: string;
  warehouseLabel: string;
  firstWorkstation: string | null;
  steps: number;
  lots: number;
  plannedQty: number;
};

export async function listProductionOrders(): Promise<ProductionOrderListRow[]> {
  const rows = await prisma.prdOrder.findMany({
    orderBy: [{ order_date: "desc" }, { id: "desc" }],
    include: {
      target_item: { select: { item_label: true, item_name: true } },
      warehouse: { select: { warehouse_label: true } },
      steps: { orderBy: { step_no: "asc" }, select: { workstation: { select: { workstation_label: true } } } },
      lots: { select: { qty: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    orderNo: r.order_no,
    orderDate: isoDay(r.order_date),
    status: r.status as ProductionOrderStatus,
    targetLabel: r.target_item.item_label,
    targetName: r.target_item.item_name,
    warehouseLabel: r.warehouse.warehouse_label,
    firstWorkstation: r.steps[0]?.workstation.workstation_label ?? null,
    steps: r.steps.length,
    lots: r.lots.length,
    plannedQty: fromUnits(r.lots.reduce((s, l) => s + units(l.qty.toNumber()), 0)),
  }));
}

export type ProductionOrderView = {
  id: number;
  orderNo: string;
  status: ProductionOrderStatus;
  header: ProductionOrderHeaderInput;
  steps: ProductionOrderStepInput[];
  lots: (ProductionOrderLotInput & { lotNo: string; expiry: string | null })[];
  statusReason: string | null;
};

export async function getProductionOrder(id: number): Promise<ProductionOrderView | null> {
  const o = await prisma.prdOrder.findUnique({
    where: { id },
    include: { steps: { orderBy: { step_no: "asc" } }, lots: { orderBy: { line_no: "asc" }, include: { lot: { select: { tracking_no: true, expiry_date: true } } } } },
  });
  if (!o) return null;
  const input = asInput(o);
  return {
    id: o.id,
    orderNo: o.order_no,
    status: o.status as ProductionOrderStatus,
    header: input.header,
    steps: input.steps,
    lots: input.lots.map((l, i) => ({ ...l, lotNo: o.lots[i].lot.tracking_no, expiry: o.lots[i].lot.expiry_date ? isoDay(o.lots[i].lot.expiry_date) : null })),
    statusReason: o.status_reason,
  };
}

/** What a stored Perintah's form must keep readable. */
export function productionOrderCurrent(v: ProductionOrderView): ProductionOrderCurrent {
  return {
    targetItemId: Number(v.header.target_item_id),
    routingId: v.header.routing_id,
    warehouseId: Number(v.header.warehouse_id),
    workstationIds: v.steps.map((s) => Number(s.workstation_id)),
    bomIds: v.steps.flatMap((s) => (s.bom_id ? [s.bom_id] : [])),
    itemIds: v.lots.map((l) => Number(l.item_id)),
    lotIds: v.lots.map((l) => Number(l.lot_id)),
  };
}

/** Perintah numbers by id, for the audit panel. */
export async function productionOrderNumbersByIds(ids: number[]): Promise<Map<number, string>> {
  const rows = await prisma.prdOrder.findMany({ where: { id: { in: ids } }, select: { id: true, order_no: true } });
  return new Map(rows.map((r) => [r.id, r.order_no]));
}

// -------------------------------------------------------- for the BSTB

/**
 * A Perintah as the Logistik BSTB reads it: its warehouse, the first station
 * of its route (where the lots are sent) and the lots planned. The BSTB module
 * takes this rather than reading `prd_order` itself.
 */
export type IssueSourceOrder = {
  id: number;
  orderNo: string;
  open: boolean;
  targetLabel: string;
  targetName: string;
  warehouseId: number;
  firstWorkstationId: number | null;
  lots: { itemId: number; lotId: number; qty: number }[];
};

/** Open Perintah, plus any named (a stored BSTB's own), newest first. */
export async function productionOrdersForIssue(withIds: number[] = [], db: Db = prisma): Promise<IssueSourceOrder[]> {
  const rows = await db.prdOrder.findMany({
    where: { OR: [{ status: "Open" }, ...(withIds.length ? [{ id: { in: withIds } }] : [])] },
    orderBy: [{ order_date: "desc" }, { id: "desc" }],
    include: {
      target_item: { select: { item_label: true, item_name: true } },
      steps: { orderBy: { step_no: "asc" }, take: 1 },
      lots: { orderBy: { line_no: "asc" } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    orderNo: r.order_no,
    open: r.status === "Open",
    targetLabel: r.target_item.item_label,
    targetName: r.target_item.item_name,
    warehouseId: r.warehouse_id,
    firstWorkstationId: r.steps[0]?.workstation_id ?? null,
    lots: r.lots.map((l) => ({ itemId: l.item_id, lotId: l.lot_id, qty: l.qty.toNumber() })),
  }));
}

/**
 * Locks a Perintah for a BSTB's save or posting and says whether it may still
 * send goods: it must be Open. Returns its number for the BSTB to copy.
 */
export async function lockProductionOrderForIssue(tx: Prisma.TransactionClient, id: number): Promise<{ ok: true; orderNo: string } | { ok: false; error: string }> {
  const [row] = await tx.$queryRaw<{ order_no: string; status: string }[]>`SELECT order_no, status::text FROM prd_order WHERE id = ${id} FOR UPDATE`;
  if (!row) return { ok: false, error: "Perintah Produksi tidak ditemukan." };
  if (row.status !== "Open") return { ok: false, error: `Perintah ${row.order_no} tidak Open; BSTB hanya dari Perintah yang Open.` };
  return { ok: true, orderNo: row.order_no };
}
