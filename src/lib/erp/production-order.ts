import "server-only";

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { routingAndBomChoices, type BomChoice, type RoutingChoice } from "./production-master";
import { nextDailyNumber } from "./production-number";
import { availableQtyByItem } from "./inventory";
import { planLineChoices, type PlanLineChoice } from "./production-plan";
import type { RoutingStepModeValue } from "./production-master-shape";
import { orderRequirements, type Requirement } from "./production-order-shape";
import {
  PRODUCTION_ORDER_TRANSITIONS,
  productionOrderIsEditable,
  productionOrderTransitionAllowed,
  type ProductionOrderAction,
  type ProductionOrderStatus,
} from "./production-order-workflow";

/**
 * The Perintah Produksi module (Walet build step 3, `production_project.md`
 * M121, P164, P165): its tables are `prd_order`, `prd_order_step` and
 * `prd_order_requirement`, and nothing else names them.
 *
 * PPIC raises one Perintah per Partai: the **Item Target** (what the Partai is
 * to become) and the **Qty Target**, and its **route** — the workstations it
 * passes, copied from a Routing of that item and changed freely while a Draft;
 * each works by its own Cara Kerja (P166). Its **material requirements** are
 * the Item Target's BoMs at those workstations × that quantity
 * (`production-order-shape.ts`), worked out at every save and again at
 * *Buka*, and are never typed: without a BoM there are none and what goes in is
 * free. The Perintah names no lot and no warehouse — the Logistik BSTB picks
 * and sends (`productionOrdersForIssue`), each to a station, pre-filled from
 * that station's requirements. The Partai is started later, by the hand-over
 * that boxes a station's output into Jobs (O3, step 4). Posts nothing.
 */

type Db = Prisma.TransactionClient | typeof prisma;

export type ProductionOrderHeaderInput = {
  order_date: string;
  target_item_id: number | null;
  target_qty: number | string;
  routing_id: number | null;
  note: string;
  /** The line of an Open Rencana Produksi it is released from — optional (P168). */
  plan_line_id?: number | null;
};

export type ProductionOrderStepInput = { workstation_id: number | null };

export type ProductionOrderResult = { ok: true; id: number; orderNo: string } | { ok: false; errors: Record<string, string> };

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const asDate = (d: string) => new Date(`${d}T00:00:00Z`);
const isoDay = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "");
const text = (v: unknown) => String(v ?? "").trim() || null;

/** Quantities are `Decimal(18, 4)`, compared in ten-thousandths. */
const QTY_SCALE = 10_000;
const units = (n: number) => Math.round(n * QTY_SCALE);

// ---------------------------------------------------------------- options

export type PpOption = { id: number; label: string; name: string; active: boolean };
export type PpItemOption = PpOption & { uomId: number; uomLabel: string };

export type ProductionOrderOptions = {
  /** Barang with Kelola Stok — the only items production holds (M8); also every BoM component. */
  items: PpItemOption[];
  routings: RoutingChoice[];
  /** Each with its Cara Kerja (P166). */
  workstations: (PpOption & { mode: RoutingStepModeValue })[];
  boms: BomChoice[];
  /** Lines of Open plans (and the stored one's own) a Perintah may be released from. */
  planLines: PlanLineChoice[];
  /** Per plan line id, what live Perintah already hold of it (P168). */
  released: Record<number, number>;
};

export type ProductionOrderCurrent = {
  planLineId?: number | null;
  targetItemId: number;
  routingId: number | null;
  workstationIds: number[];
  bomIds: number[];
  /** Items its stored requirements name. */
  itemIds: number[];
};

/**
 * What the form offers. `current` is a stored Perintah: what it names stays
 * readable whatever its status now.
 */
export async function productionOrderOptions(current: ProductionOrderCurrent | null = null, db: Db = prisma): Promise<ProductionOrderOptions> {
  const itemIds = current ? [current.targetItemId, ...current.itemIds] : [];
  const [items, choices, workstations, planLines] = await Promise.all([
    db.mItem.findMany({
      where: { OR: [{ item_type: "Barang", track_stock: true, status: "Active" }, ...(itemIds.length ? [{ id: { in: itemIds } }] : [])] },
      orderBy: { item_label: "asc" },
      select: { id: true, item_label: true, item_name: true, status: true, item_type: true, track_stock: true, base_uom_id: true, base_uom: { select: { uom_label: true } } },
    }),
    routingAndBomChoices({ routingIds: current?.routingId ? [current.routingId] : [], bomIds: current?.bomIds ?? [] }, db),
    db.refWorkstation.findMany({
      where: { OR: [{ status: "Active" }, ...(current?.workstationIds.length ? [{ id: { in: current.workstationIds } }] : [])] },
      orderBy: { workstation_label: "asc" },
      select: { id: true, workstation_label: true, workstation_name: true, status: true, mode: true },
    }),
    planLineChoices(current?.planLineId ? [current.planLineId] : [], db),
  ]);
  const released = await releasedByPlanLines(planLines.map((l) => l.id), db);
  const stockItem = (i: (typeof items)[number]) => i.status === "Active" && i.item_type === "Barang" && i.track_stock;
  return {
    items: items.map((i) => ({ id: i.id, label: i.item_label, name: i.item_name, active: stockItem(i), uomId: i.base_uom_id, uomLabel: i.base_uom.uom_label })),
    routings: choices.routings,
    workstations: workstations.map((w) => ({ id: w.id, label: w.workstation_label, name: w.workstation_name, active: w.status === "Active", mode: w.mode as RoutingStepModeValue })),
    boms: choices.boms,
    planLines,
    released: Object.fromEntries(released),
  };
}

// ------------------------------------------------------------- validation

type CheckedStep = { step_no: number; workstation_id: number };
type CheckedRequirement = { line_no: number; item_id: number; uom_id: number; qty: number; step_no: number | null; workstation_id: number | null; bom_id: number };

type Checked = {
  data: { order_date: Date; target_item_id: number; target_qty: number; routing_id: number | null; note: string | null; plan_line_id: number | null };
  steps: CheckedStep[];
  requirements: CheckedRequirement[];
};

/**
 * Every rule a Perintah must satisfy to be saved — and, run again with
 * `forOpening`, to be opened: everything it names still active. Works out its
 * requirements from the BoMs as they stand now.
 */
export async function checkProductionOrder(
  db: Db,
  header: ProductionOrderHeaderInput,
  steps: ProductionOrderStepInput[],
  selfId: number | null,
  forOpening = false
): Promise<{ ok: true; c: Checked } | { ok: false; errors: Record<string, string> }> {
  const errors: Record<string, string> = {};
  const stored = selfId ? await db.prdOrder.findUnique({ where: { id: selfId }, include: { steps: true, requirements: true } }) : null;
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
  if (!targetId) errors.target_item_id = "Pilih Item Target — barang yang akan dibuat.";
  else if (!target) errors.target_item_id = "Item Target harus Barang aktif dengan Kelola Stok.";

  const qty = Number(String(header.target_qty ?? "").replace(",", "."));
  if (!Number.isFinite(qty) || !(qty > 0)) errors.target_qty = "Isi Qty Target lebih dari 0.";
  else if (Math.abs(qty * QTY_SCALE - units(qty)) > 1e-6) errors.target_qty = "Paling banyak 4 angka desimal.";

  const routingId = Number(header.routing_id) || null;
  if (routingId) {
    const r = usable(options.routings, routingId, [stored?.routing_id ?? null]);
    if (!r) errors.routing_id = "Routing tidak ditemukan atau nonaktif.";
    else if (targetId && r.itemId !== targetId) errors.routing_id = "Routing ini untuk barang lain.";
  }

  const rawSteps = Array.isArray(steps) ? steps : [];
  const outSteps: CheckedStep[] = [];
  if (!rawSteps.length) errors._steps = "Tambahkan minimal satu workstation.";
  for (const [i, s] of rawSteps.entries()) {
    const k = (f: string) => `steps.${i}.${f}`;
    const wsId = Number(s.workstation_id) || null;
    const ws = usable(options.workstations, wsId, stored?.steps.map((x) => x.workstation_id) ?? []);
    if (!wsId) errors[k("workstation_id")] = "Pilih workstation.";
    else if (!ws) errors[k("workstation_id")] = "Workstation tidak ditemukan atau nonaktif.";
    if (ws) outSteps.push({ step_no: outSteps.length + 1, workstation_id: ws.id });
  }
  if (!errors._steps && Object.keys(errors).some((x) => x.startsWith("steps."))) errors._steps = "Ada langkah yang perlu diperbaiki.";

  // A line of an Open plan, for that item (P168). Exceeding what the plan line has left is allowed:
  // Walet over-produces for loss and buffer — the plan shows it, nothing refuses it.
  const planLineId = Number(header.plan_line_id) || null;
  if (planLineId) {
    const pl = options.planLines.find((l) => l.id === planLineId);
    if (!pl || (!pl.open && (forOpening || stored?.plan_line_id !== planLineId))) errors.plan_line_id = "Baris rencana tidak ditemukan atau rencananya tidak lagi Disetujui.";
    else if (targetId && pl.itemId !== targetId) errors.plan_line_id = "Baris rencana ini untuk barang lain.";
  }

  if (Object.keys(errors).length || !target) return { ok: false, errors };

  const itemBy = new Map(options.items.map((i) => [i.id, i]));
  const requirements: CheckedRequirement[] = [];
  for (const r of orderRequirements(
    target.id,
    qty,
    outSteps.map((s) => ({ workstationId: s.workstation_id })),
    options.boms
  )) {
    const item = itemBy.get(r.itemId);
    // A BoM component is a Barang with Kelola Stok (P162); one switched off since is named.
    if (!item) return { ok: false, errors: { _form: "Ada komponen BoM yang tidak lagi Barang dengan Kelola Stok. Periksa BoM-nya dulu." } };
    requirements.push({ line_no: requirements.length + 1, item_id: r.itemId, uom_id: item.uomId, qty: r.qty, step_no: r.stepNo, workstation_id: r.workstationId, bom_id: r.bomId });
  }
  return {
    ok: true,
    c: {
      data: { order_date: asDate(orderDate), target_item_id: target.id, target_qty: qty, routing_id: routingId, note: text(header.note), plan_line_id: planLineId },
      steps: outSteps,
      requirements,
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

/** A Draft's route and requirements are rewritten whole: nothing names them before it is Open. */
async function writeCollections(tx: Prisma.TransactionClient, id: number, c: Checked) {
  await tx.prdOrderStep.deleteMany({ where: { order_id: id } });
  await tx.prdOrderRequirement.deleteMany({ where: { order_id: id } });
  await tx.prdOrderStep.createMany({ data: c.steps.map((s) => ({ ...s, order_id: id })) });
  await tx.prdOrderRequirement.createMany({ data: c.requirements.map((r) => ({ ...r, order_id: id })) });
}

export async function createProductionOrder(header: ProductionOrderHeaderInput, steps: ProductionOrderStepInput[], actorId: number): Promise<ProductionOrderResult> {
  return refusable(async () => {
    const made = await prisma.$transaction(async (tx) => {
      const r = await checkProductionOrder(tx, header, steps, null);
      if (!r.ok) throw new Refused(r.errors);
      const row = await tx.prdOrder.create({ data: { ...r.c.data, order_no: await nextOrderNo(tx, r.c.data.order_date), created_by: actorId } });
      await writeCollections(tx, row.id, r.c);
      await audit(tx, row.id, "TAMBAH", "create", actorId);
      return row;
    });
    return { ok: true as const, id: made.id, orderNo: made.order_no };
  });
}

export async function updateProductionOrder(id: number, header: ProductionOrderHeaderInput, steps: ProductionOrderStepInput[], actorId: number): Promise<ProductionOrderResult> {
  const current = await prisma.prdOrder.findUnique({ where: { id }, select: { status: true, order_no: true } });
  if (!current) return { ok: false, errors: { _form: "Perintah Produksi tidak ditemukan." } };
  if (!productionOrderIsEditable(current.status as ProductionOrderStatus)) {
    return { ok: false, errors: { _form: "Perintah yang sudah dibuka tidak dapat diubah." } };
  }
  return refusable(async () => {
    await prisma.$transaction(async (tx) => {
      const r = await checkProductionOrder(tx, header, steps, id);
      if (!r.ok) throw new Refused(r.errors);
      const done = await tx.prdOrder.updateMany({ where: { id, status: "Draft" }, data: { ...r.c.data, updated_by: actorId } });
      if (done.count !== 1) throw new Refused({ _form: "Perintah berubah saat diproses. Muat ulang halaman." });
      await writeCollections(tx, id, r.c);
      await audit(tx, id, "UPDATE", "update", actorId);
    });
    return { ok: true as const, id, orderNo: current.order_no };
  });
}

const WITH_ALL = { steps: { orderBy: { step_no: "asc" as const } }, requirements: { orderBy: { line_no: "asc" as const } } };
type Stored = Prisma.PrdOrderGetPayload<{ include: typeof WITH_ALL }>;

function currentOf(o: Prisma.PrdOrderGetPayload<{ include: { steps: true; requirements: true } }>): ProductionOrderCurrent {
  return {
    planLineId: o.plan_line_id,
    targetItemId: o.target_item_id,
    routingId: o.routing_id,
    workstationIds: [...o.steps.map((s) => s.workstation_id), ...o.requirements.flatMap((r) => (r.workstation_id ? [r.workstation_id] : []))],
    bomIds: o.requirements.map((r) => r.bom_id),
    itemIds: o.requirements.map((r) => r.item_id),
  };
}

function asInput(o: Stored) {
  return {
    header: {
      order_date: isoDay(o.order_date),
      target_item_id: o.target_item_id,
      target_qty: o.target_qty.toNumber(),
      routing_id: o.routing_id,
      note: o.note ?? "",
      plan_line_id: o.plan_line_id,
    } satisfies ProductionOrderHeaderInput,
    steps: o.steps.map((s) => ({ workstation_id: s.workstation_id })),
  };
}

// --------------------------------------------------------------- lifecycle

export type ProductionOrderTransitionResult = { ok: true } | { ok: false; errors: Record<string, string> };

/**
 * One lifecycle step. **Buka** checks the stored Perintah again — anything it
 * names may have been deactivated since — and works its requirements out once
 * more from the BoMs as they stand, which then stay as opened. Batalkan and
 * Tutup ask for a reason, kept in `status_reason`. **Tutup** takes a `guard`
 * from the action layer, which knows the BSTBs raised from it (§3.1: the BSTB
 * depends on the Perintah, never the reverse). Every step is conditional on
 * the status just read.
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
        const r = await checkProductionOrder(tx, input.header, input.steps, id, true);
        if (!r.ok) {
          const first = Object.entries(r.errors).find(([k]) => !k.startsWith("_"))?.[1] ?? Object.values(r.errors)[0];
          throw new Refused({ _form: `Belum bisa dibuka: ${first}` });
        }
        await writeCollections(tx, id, r.c);
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
  targetQty: number;
  targetUom: string;
  firstWorkstation: string | null;
  steps: number;
  requirements: number;
};

export async function listProductionOrders(): Promise<ProductionOrderListRow[]> {
  const rows = await prisma.prdOrder.findMany({
    orderBy: [{ order_date: "desc" }, { id: "desc" }],
    include: {
      target_item: { select: { item_label: true, item_name: true, base_uom: { select: { uom_label: true } } } },
      steps: { orderBy: { step_no: "asc" }, select: { workstation: { select: { workstation_label: true } } } },
      _count: { select: { requirements: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    orderNo: r.order_no,
    orderDate: isoDay(r.order_date),
    status: r.status as ProductionOrderStatus,
    targetLabel: r.target_item.item_label,
    targetName: r.target_item.item_name,
    targetQty: r.target_qty.toNumber(),
    targetUom: r.target_item.base_uom.uom_label,
    firstWorkstation: r.steps[0]?.workstation.workstation_label ?? null,
    steps: r.steps.length,
    requirements: r._count.requirements,
  }));
}

export type ProductionOrderView = {
  id: number;
  orderNo: string;
  status: ProductionOrderStatus;
  header: ProductionOrderHeaderInput;
  steps: ProductionOrderStepInput[];
  /** As stored: worked out at the last save, or at Buka. */
  requirements: Requirement[];
  statusReason: string | null;
};

export async function getProductionOrder(id: number): Promise<ProductionOrderView | null> {
  const o = await prisma.prdOrder.findUnique({ where: { id }, include: WITH_ALL });
  if (!o) return null;
  const input = asInput(o);
  return {
    id: o.id,
    orderNo: o.order_no,
    status: o.status as ProductionOrderStatus,
    header: input.header,
    steps: input.steps,
    requirements: o.requirements.map((r) => ({ itemId: r.item_id, qty: r.qty.toNumber(), stepNo: r.step_no, workstationId: r.workstation_id, bomId: r.bom_id })),
    statusReason: o.status_reason,
  };
}

/** What a stored Perintah's form must keep readable. */
export function productionOrderCurrent(v: ProductionOrderView): ProductionOrderCurrent {
  return {
    targetItemId: Number(v.header.target_item_id),
    routingId: v.header.routing_id,
    workstationIds: [...v.steps.map((s) => Number(s.workstation_id)), ...v.requirements.flatMap((r) => (r.workstationId ? [r.workstationId] : []))],
    bomIds: v.requirements.map((r) => r.bomId),
    itemIds: v.requirements.map((r) => r.itemId),
    planLineId: v.header.plan_line_id ?? null,
  };
}

/** Perintah numbers by id, for the audit panel. */
export async function productionOrderNumbersByIds(ids: number[]): Promise<Map<number, string>> {
  const rows = await prisma.prdOrder.findMany({ where: { id: { in: ids } }, select: { id: true, order_no: true } });
  return new Map(rows.map((r) => [r.id, r.order_no]));
}

// -------------------------------------------------------- for the BSTB

/**
 * A Perintah as the Logistik BSTB reads it: its route's first station (the
 * default destination) and its requirements per station, so a BSTB to a
 * station pre-fills what that station needs. The BSTB module takes this rather
 * than reading `prd_order` itself.
 */
export type IssueSourceOrder = {
  id: number;
  orderNo: string;
  open: boolean;
  targetLabel: string;
  targetName: string;
  firstWorkstationId: number | null;
  requirements: { itemId: number; qty: number; workstationId: number | null }[];
};

/** Open Perintah, plus any named (a stored BSTB's own), newest first. */
export async function productionOrdersForIssue(withIds: number[] = [], db: Db = prisma): Promise<IssueSourceOrder[]> {
  const rows = await db.prdOrder.findMany({
    where: { OR: [{ status: "Open" }, ...(withIds.length ? [{ id: { in: withIds } }] : [])] },
    orderBy: [{ order_date: "desc" }, { id: "desc" }],
    include: {
      target_item: { select: { item_label: true, item_name: true } },
      steps: { orderBy: { step_no: "asc" }, take: 1 },
      requirements: { orderBy: { line_no: "asc" } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    orderNo: r.order_no,
    open: r.status === "Open",
    targetLabel: r.target_item.item_label,
    targetName: r.target_item.item_name,
    firstWorkstationId: r.steps[0]?.workstation_id ?? null,
    requirements: r.requirements.map((q) => ({ itemId: q.item_id, qty: q.qty.toNumber(), workstationId: q.workstation_id })),
  }));
}

/**
 * Locks a Perintah for a BSTB's posting and says whether it may still send
 * goods: it must be Open. Returns its number for the BSTB to copy.
 */
export async function lockProductionOrderForIssue(tx: Prisma.TransactionClient, id: number): Promise<{ ok: true; orderNo: string } | { ok: false; error: string }> {
  const [row] = await tx.$queryRaw<{ order_no: string; status: string }[]>`SELECT order_no, status::text FROM prd_order WHERE id = ${id} FOR UPDATE`;
  if (!row) return { ok: false, error: "Perintah Produksi tidak ditemukan." };
  if (row.status !== "Open") return { ok: false, error: `Perintah ${row.order_no} tidak Open; BSTB hanya dari Perintah yang Open.` };
  return { ok: true, orderNo: row.order_no };
}

// ---------------------------------------------------- for the hand-over

/**
 * A Perintah as the hand-over reads it (P167): what the Partai is to become and
 * the stations of its route. The hand-over that starts a Partai names one.
 */
export type HandoverSourceOrder = {
  id: number;
  orderNo: string;
  open: boolean;
  targetItemId: number;
  targetLabel: string;
  targetName: string;
  workstationIds: number[];
};

/** Open Perintah, plus any named (a stored hand-over's own), newest first. */
export async function productionOrdersForHandover(withIds: number[] = [], db: Db = prisma): Promise<HandoverSourceOrder[]> {
  const rows = await db.prdOrder.findMany({
    where: { OR: [{ status: "Open" }, ...(withIds.length ? [{ id: { in: withIds } }] : [])] },
    orderBy: [{ order_date: "desc" }, { id: "desc" }],
    include: { target_item: { select: { item_label: true, item_name: true } }, steps: { orderBy: { step_no: "asc" } } },
  });
  return rows.map((r) => ({
    id: r.id,
    orderNo: r.order_no,
    open: r.status === "Open",
    targetItemId: r.target_item_id,
    targetLabel: r.target_item.item_label,
    targetName: r.target_item.item_name,
    workstationIds: r.steps.map((s) => s.workstation_id),
  }));
}

/**
 * Locks a Perintah for the posting of the hand-over that starts its Partai: it
 * must be Open. Returns what the Partai takes from it, and its route.
 */
export async function lockProductionOrderForHandover(
  tx: Prisma.TransactionClient,
  id: number
): Promise<{ ok: true; orderNo: string; targetItemId: number; workstationIds: number[] } | { ok: false; error: string }> {
  const [row] = await tx.$queryRaw<{ order_no: string; status: string; target_item_id: number }[]>`
    SELECT order_no, status::text, target_item_id FROM prd_order WHERE id = ${id} FOR UPDATE`;
  if (!row) return { ok: false, error: "Perintah Produksi tidak ditemukan." };
  if (row.status !== "Open") return { ok: false, error: `Perintah ${row.order_no} tidak Open; Partai hanya dimulai untuk Perintah yang Open.` };
  const steps = await tx.prdOrderStep.findMany({ where: { order_id: id }, orderBy: { step_no: "asc" }, select: { workstation_id: true } });
  return { ok: true, orderNo: row.order_no, targetItemId: row.target_item_id, workstationIds: steps.map((s) => s.workstation_id) };
}

// ------------------------------------------------------- for the plan

/**
 * What live Perintah (every one but a Cancelled one) hold of each plan line, in
 * the line's item's base unit — the plan's *Dirilis* (P168).
 */
export async function releasedByPlanLines(planLineIds: number[], db: Db = prisma): Promise<Map<number, number>> {
  const out = new Map<number, number>();
  if (!planLineIds.length) return out;
  const rows = await db.prdOrder.groupBy({
    by: ["plan_line_id"],
    where: { plan_line_id: { in: planLineIds }, status: { not: "Cancelled" } },
    _sum: { target_qty: true },
  });
  for (const r of rows) if (r.plan_line_id != null) out.set(r.plan_line_id, r._sum.target_qty?.toNumber() ?? 0);
  return out;
}

/** Why a plan may not be closed yet: a Perintah made from one of its lines is still a Draft or Open. Null when it may. */
export async function openOrdersOfPlanRefusal(planLineIds: number[], db: Db = prisma): Promise<string | null> {
  if (!planLineIds.length) return null;
  const live = await db.prdOrder.findMany({ where: { plan_line_id: { in: planLineIds }, status: { in: ["Draft", "Open"] } }, select: { order_no: true, status: true } });
  if (!live.length) return null;
  return `Rencana belum bisa ditutup: masih ada Perintah Produksi ${live.map((o) => `${o.order_no} (${o.status === "Draft" ? "Draft" : "Open"})`).join(", ")}. Tutup atau batalkan dulu.`;
}

/** The Perintah made from these plan lines, for the plan's page. */
export async function ordersOfPlanLines(planLineIds: number[], db: Db = prisma): Promise<{ id: number; orderNo: string; status: ProductionOrderStatus; planLineId: number; targetQty: number }[]> {
  if (!planLineIds.length) return [];
  const rows = await db.prdOrder.findMany({ where: { plan_line_id: { in: planLineIds } }, orderBy: { id: "asc" }, select: { id: true, order_no: true, status: true, plan_line_id: true, target_qty: true } });
  return rows.map((r) => ({ id: r.id, orderNo: r.order_no, status: r.status as ProductionOrderStatus, planLineId: r.plan_line_id!, targetQty: r.target_qty.toNumber() }));
}

export type PlanMaterial = { itemId: number; label: string; name: string; uomLabel: string; qty: number; onHand: number };

/**
 * The material a plan's lines ask of the BoMs — each line's item at its default
 * Routing's stations, × its quantity — summed per component, beside what stock
 * holds (P168). Read-only: the seed of MRP (step 9), it books and reserves
 * nothing; an item with no default Routing or no BoM adds nothing.
 */
export async function planMaterials(lines: { itemId: number; qty: number }[], db: Db = prisma): Promise<PlanMaterial[]> {
  if (!lines.length) return [];
  const options = await productionOrderOptions(null, db);
  const total = new Map<number, number>();
  for (const l of lines) {
    const routing = options.routings.find((r) => r.itemId === l.itemId && r.isDefault && r.active);
    if (!routing) continue;
    for (const r of orderRequirements(l.itemId, l.qty, routing.steps, options.boms)) {
      total.set(r.itemId, Math.round(((total.get(r.itemId) ?? 0) + r.qty) * QTY_SCALE) / QTY_SCALE);
    }
  }
  const stock = await availableQtyByItem([...total.keys()], db);
  const itemBy = new Map(options.items.map((i) => [i.id, i]));
  return [...total.entries()]
    .map(([itemId, qty]) => ({ itemId, label: itemBy.get(itemId)?.label ?? "", name: itemBy.get(itemId)?.name ?? "", uomLabel: itemBy.get(itemId)?.uomLabel ?? "", qty, onHand: stock.get(itemId) ?? 0 }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * Closes an Open Perintah by itself once nothing of its Partai is left in
 * production (P170): no reason, audit event *finish*. Called inside the posting
 * that took the last goods out. Returns whether it closed.
 */
export async function finishProductionOrder(tx: Prisma.TransactionClient, orderId: number, actorId: number): Promise<boolean> {
  const done = await tx.prdOrder.updateMany({ where: { id: orderId, status: "Open" }, data: { status: "Closed", status_reason: null, updated_by: actorId } });
  if (done.count !== 1) return false;
  await tx.auditLog.create({ data: { entity_key: "prd_order", row_id: orderId, action: "UPDATE", event: "finish", by: actorId } });
  return true;
}
