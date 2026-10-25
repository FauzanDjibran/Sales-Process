import "server-only";

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { formatNumber } from "@/lib/format";
import { nextDocumentNumber } from "./document-number";
import { availableQtyByItem } from "./inventory";
import { lockSalesOrderLinesForPlan, planDemandLines, type PlanDemandLine } from "./sales-order";
import {
  PRODUCTION_PLAN_TRANSITIONS,
  productionPlanIsEditable,
  productionPlanTransitionAllowed,
  type ProductionPlanAction,
  type ProductionPlanStatus,
} from "./production-plan-workflow";

/**
 * The Rencana Produksi (P168, `walet/step4-and-rencana-plan.md` Part B): PPIC's
 * plan of what to make in one month, made at the end of the month before.
 * Its tables are `prd_plan`, `prd_plan_line` and `prd_plan_line_demand`, and
 * nothing else names them; the Perintah Produksi reads it through the functions
 * at the foot (§3.1: the Perintah depends on the plan, never the reverse).
 *
 * A line is **one item to make, how much, and the day to start** (inside the
 * month), each item once per start date. It covers **Open Sales Order lines** —
 * the demand, each with the part of it this line takes; a Pra-SO is listed but
 * cannot be produced for (P79). The quantity is **typed**: the demand less the
 * stock on hand only suggests it (*Saran*), as a BoM only suggests an execution's
 * inputs. A line may cover no Sales Order — a stock build.
 *
 * **Draft reserves nothing; Ajukan does:** it locks the Sales Order lines and
 * refuses a plan whose demand, with every other live plan's, goes past what the
 * line still has to deliver. Setujui makes it Open, so Perintah may be made from
 * its lines; Tutup (reason) is refused while one of them is still Draft or Open.
 * Posts nothing.
 */

type Db = Prisma.TransactionClient | typeof prisma;

export type PlanHeaderInput = {
  plan_date: string;
  /** The month, `YYYY-MM`. */
  period: string;
  note: string;
};

export type PlanDemandInput = { so_line_id: number | null; qty: number | string };

export type PlanLineInput = {
  item_id: number | null;
  qty: number | string;
  start_date: string;
  note: string;
  demands: PlanDemandInput[];
};

export type PlanResult = { ok: true; id: number; planNo: string } | { ok: false; errors: Record<string, string> };

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const asDate = (d: string) => new Date(`${d}T00:00:00Z`);
const isoDay = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "");
const text = (v: unknown) => String(v ?? "").trim() || null;
const lineKey = (i: number, f: string) => `lines.${i}.${f}`;
const demandKey = (i: number, j: number, f: string) => `lines.${i}.demands.${j}.${f}`;

/** Quantities are `Decimal(18, 4)`, compared in ten-thousandths. */
const QTY_SCALE = 10_000;
const units = (n: number) => Math.round(n * QTY_SCALE);
const fromUnits = (u: number) => u / QTY_SCALE;
const qtyText = (n: number) => formatNumber(n, n % 1 ? 2 : 0);

// ---------------------------------------------------------------- options

export type PlanItem = { id: number; label: string; name: string; uomLabel: string; active: boolean };

export type PlanDemandOption = PlanDemandLine & {
  /** What other live plans already cover of this Sales Order line. */
  reserved: number;
};

export type PlanOptions = {
  /** Barang with Kelola Stok — the only items production makes (M8). */
  items: PlanItem[];
  demands: PlanDemandOption[];
  /** Stock on hand per item id: the plan's *Stok FG*. */
  stock: Record<number, number>;
};

/** What a stored plan names, so its form stays readable whatever the status of those now. */
export type PlanCurrent = { itemIds: number[]; soLineIds: number[] };

/** What other live plans (every one but `selfId`) cover of each Sales Order line. */
async function reservedByOthers(soLineIds: number[], selfId: number | null, db: Db): Promise<Map<number, number>> {
  const out = new Map<number, number>();
  if (!soLineIds.length) return out;
  const rows = await db.prdPlanLineDemand.findMany({
    where: { so_line_id: { in: soLineIds }, plan_line: { plan: { status: { in: ["Submitted", "Open"] }, ...(selfId ? { id: { not: selfId } } : {}) } } },
    select: { so_line_id: true, qty: true },
  });
  for (const r of rows) out.set(r.so_line_id, fromUnits(units(out.get(r.so_line_id) ?? 0) + units(r.qty.toNumber())));
  return out;
}

export async function productionPlanOptions(current: PlanCurrent | null = null, selfId: number | null = null, db: Db = prisma): Promise<PlanOptions> {
  const itemIds = current?.itemIds ?? [];
  const [items, demands] = await Promise.all([
    db.mItem.findMany({
      where: { OR: [{ item_type: "Barang", track_stock: true, status: "Active" }, ...(itemIds.length ? [{ id: { in: itemIds } }] : [])] },
      orderBy: { item_label: "asc" },
      select: { id: true, item_label: true, item_name: true, status: true, item_type: true, track_stock: true, base_uom: { select: { uom_label: true } } },
    }),
    planDemandLines(current?.soLineIds ?? [], db),
  ]);
  const [reserved, stock] = await Promise.all([reservedByOthers(demands.map((d) => d.id), selfId, db), availableQtyByItem(items.map((i) => i.id), db)]);
  return {
    items: items.map((i) => ({
      id: i.id,
      label: i.item_label,
      name: i.item_name,
      uomLabel: i.base_uom.uom_label,
      active: i.status === "Active" && i.item_type === "Barang" && i.track_stock,
    })),
    demands: demands.map((d) => ({ ...d, reserved: reserved.get(d.id) ?? 0 })),
    stock: Object.fromEntries(stock),
  };
}

// ------------------------------------------------------------- validation

type CheckedDemand = { so_line_id: number; so_id: number; so_no: string; qty: number };
type CheckedLine = { line_no: number; item_id: number; qty: number; start_date: Date; note: string | null; demands: CheckedDemand[] };
type Checked = { data: { plan_date: Date; period: Date; note: string | null }; lines: CheckedLine[] };

/** What a Sales Order line has left for a plan: its quantity less delivered and less other live plans'. */
const roomOf = (d: { qty: number; delivered: number }, reserved: number) => Math.max(0, fromUnits(units(d.qty) - units(d.delivered) - units(reserved)));

/**
 * Every rule a plan must satisfy to be saved — and, run again inside Ajukan's
 * transaction with `forSubmit`, to be submitted: the items still active, every
 * Sales Order still Open, and the room read from the **locked** lines.
 */
export async function checkProductionPlan(
  db: Db,
  header: PlanHeaderInput,
  lines: PlanLineInput[],
  selfId: number | null,
  forSubmit = false
): Promise<{ ok: true; c: Checked } | { ok: false; errors: Record<string, string> }> {
  const errors: Record<string, string> = {};
  const raw = Array.isArray(lines) ? lines : [];
  // Locked first at Ajukan, before anything is read: what the Sales Order lines
  // hold — and what other plans then cover — is as of this very moment.
  const locked = forSubmit
    ? await lockSalesOrderLinesForPlan(db as Prisma.TransactionClient, [...new Set(raw.flatMap((l) => (l.demands ?? []).map((d) => Number(d.so_line_id)).filter(Boolean)))])
    : null;
  const stored = selfId
    ? await db.prdPlan.findUnique({ where: { id: selfId }, select: { lines: { select: { item_id: true, demands: { select: { so_line_id: true } } } } } })
    : null;
  const options = await productionPlanOptions(
    stored ? { itemIds: stored.lines.map((l) => l.item_id), soLineIds: stored.lines.flatMap((l) => l.demands.map((d) => d.so_line_id)) } : null,
    selfId,
    db
  );

  const planDate = String(header.plan_date ?? "").trim();
  if (!DAY.test(planDate)) errors.plan_date = "Tanggal wajib diisi.";
  const period = String(header.period ?? "").trim();
  if (!MONTH.test(period)) errors.period = "Pilih bulan rencana.";

  if (!raw.length) errors._lines = "Tambahkan minimal satu barang.";
  const itemById = new Map(options.items.map((i) => [i.id, i]));
  const demandById = new Map(options.demands.map((d) => [d.id, d]));
  const taken = new Map<number, number>();
  const seenLine = new Set<string>();
  const out: CheckedLine[] = [];
  for (const [i, l] of raw.entries()) {
    const itemId = Number(l.item_id) || null;
    const item = itemId ? itemById.get(itemId) : undefined;
    if (!itemId) {
      errors[lineKey(i, "item_id")] = "Pilih barang.";
      continue;
    }
    if (!item || (!item.active && forSubmit)) {
      errors[lineKey(i, "item_id")] = "Hanya Barang aktif dengan Kelola Stok yang dapat direncanakan.";
      continue;
    }
    const qty = Number(String(l.qty ?? "").replace(",", "."));
    if (!Number.isFinite(qty) || !(qty > 0)) {
      errors[lineKey(i, "qty")] = "Isi jumlah lebih dari 0.";
      continue;
    }
    if (Math.abs(qty * QTY_SCALE - units(qty)) > 1e-6) {
      errors[lineKey(i, "qty")] = "Paling banyak 4 angka desimal.";
      continue;
    }
    const start = String(l.start_date ?? "").trim();
    if (!DAY.test(start)) {
      errors[lineKey(i, "start_date")] = "Isi tanggal mulai.";
      continue;
    }
    if (MONTH.test(period) && start.slice(0, 7) !== period) {
      errors[lineKey(i, "start_date")] = "Tanggal mulai harus di dalam bulan rencana.";
      continue;
    }
    const dupe = `${item.id}|${start}`;
    if (seenLine.has(dupe)) {
      errors[lineKey(i, "item_id")] = `${item.label} sudah ada pada tanggal mulai ini.`;
      continue;
    }
    seenLine.add(dupe);

    const demands: CheckedDemand[] = [];
    const seenDemand = new Set<number>();
    for (const [j, d] of (Array.isArray(l.demands) ? l.demands : []).entries()) {
      const src = Number(d.so_line_id) ? demandById.get(Number(d.so_line_id)) : undefined;
      if (!src || src.itemId !== item.id) {
        errors[demandKey(i, j, "qty")] = "Baris Sales Order tidak ditemukan untuk barang ini. Pilih ulang.";
        continue;
      }
      if (src.status !== "Open") {
        errors[demandKey(i, j, "qty")] = `${src.salesOrderNo} belum Open — baru Pra-SO, belum bisa diproduksi.`;
        continue;
      }
      if (seenDemand.has(src.id)) {
        errors[demandKey(i, j, "qty")] = `${src.salesOrderNo} dipilih lebih dari sekali.`;
        continue;
      }
      seenDemand.add(src.id);
      const dq = Number(String(d.qty ?? "").replace(",", "."));
      if (!Number.isFinite(dq) || !(dq > 0) || Math.abs(dq * QTY_SCALE - units(dq)) > 1e-6) {
        errors[demandKey(i, j, "qty")] = "Isi jumlah lebih dari 0, paling banyak 4 angka desimal.";
        continue;
      }
      const lockedRow = locked?.get(src.id);
      if (forSubmit && lockedRow && lockedRow.status !== "Open") {
        errors[demandKey(i, j, "qty")] = `${src.salesOrderNo} tidak lagi Open.`;
        continue;
      }
      const room = roomOf(lockedRow ?? src, src.reserved) - (taken.get(src.id) ?? 0);
      if (units(dq) > units(room)) {
        errors[demandKey(i, j, "qty")] = `Melebihi sisa ${src.salesOrderNo}: ${qtyText(Math.max(0, room))} ${item.uomLabel}.`;
        continue;
      }
      taken.set(src.id, fromUnits(units(taken.get(src.id) ?? 0) + units(dq)));
      demands.push({ so_line_id: src.id, so_id: src.salesOrderId, so_no: src.salesOrderNo, qty: fromUnits(units(dq)) });
    }
    out.push({ line_no: out.length + 1, item_id: item.id, qty: fromUnits(units(qty)), start_date: asDate(start), note: text(l.note), demands });
  }
  if (!errors._lines && Object.keys(errors).some((k) => k.startsWith("lines."))) errors._lines = "Ada baris yang perlu diperbaiki.";
  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, c: { data: { plan_date: asDate(planDate), period: asDate(`${period}-01`), note: text(header.note) }, lines: out } };
}

// ------------------------------------------------------------------ writes

async function nextPlanNo(db: Db, date: Date): Promise<string> {
  return nextDocumentNumber("RP", date, async (series) => {
    const row = await db.prdPlan.findFirst({ where: { plan_no: { startsWith: series } }, orderBy: { id: "desc" }, select: { plan_no: true } });
    return row?.plan_no ?? null;
  });
}

async function audit(db: Db, id: number, action: "TAMBAH" | "UPDATE", event: string, by: number) {
  await db.auditLog.create({ data: { entity_key: "prd_plan", row_id: id, action, event, by } });
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

/** A Draft's lines are rewritten whole: nothing names them before it is Open. */
async function writeLines(tx: Prisma.TransactionClient, planId: number, lines: CheckedLine[]) {
  await tx.prdPlanLine.deleteMany({ where: { plan_id: planId } });
  for (const { demands, ...l } of lines) {
    await tx.prdPlanLine.create({ data: { ...l, plan_id: planId, demands: { create: demands } } });
  }
}

export async function createProductionPlan(header: PlanHeaderInput, lines: PlanLineInput[], actorId: number): Promise<PlanResult> {
  return refusable(async () => {
    const made = await prisma.$transaction(async (tx) => {
      const r = await checkProductionPlan(tx, header, lines, null);
      if (!r.ok) throw new Refused(r.errors);
      const row = await tx.prdPlan.create({ data: { ...r.c.data, plan_no: await nextPlanNo(tx, r.c.data.plan_date), created_by: actorId } });
      await writeLines(tx, row.id, r.c.lines);
      await audit(tx, row.id, "TAMBAH", "create", actorId);
      return row;
    });
    return { ok: true as const, id: made.id, planNo: made.plan_no };
  });
}

export async function updateProductionPlan(id: number, header: PlanHeaderInput, lines: PlanLineInput[], actorId: number): Promise<PlanResult> {
  const current = await prisma.prdPlan.findUnique({ where: { id }, select: { status: true, plan_no: true } });
  if (!current) return { ok: false, errors: { _form: "Rencana tidak ditemukan." } };
  if (!productionPlanIsEditable(current.status as ProductionPlanStatus)) return { ok: false, errors: { _form: "Rencana yang sudah diajukan tidak dapat diubah." } };
  return refusable(async () => {
    await prisma.$transaction(async (tx) => {
      const r = await checkProductionPlan(tx, header, lines, id);
      if (!r.ok) throw new Refused(r.errors);
      const done = await tx.prdPlan.updateMany({ where: { id, status: "Draft" }, data: { ...r.c.data, updated_by: actorId } });
      if (done.count !== 1) throw new Refused({ _form: "Rencana berubah saat diproses. Muat ulang halaman." });
      await writeLines(tx, id, r.c.lines);
      await audit(tx, id, "UPDATE", "update", actorId);
    });
    return { ok: true as const, id, planNo: current.plan_no };
  });
}

const WITH_LINES = { lines: { orderBy: { line_no: "asc" as const }, include: { demands: { orderBy: { id: "asc" as const } } } } };
type Stored = Prisma.PrdPlanGetPayload<{ include: typeof WITH_LINES }>;

function asInput(p: Stored): { header: PlanHeaderInput; lines: PlanLineInput[] } {
  return {
    header: { plan_date: isoDay(p.plan_date), period: isoDay(p.period).slice(0, 7), note: p.note ?? "" },
    lines: p.lines.map((l) => ({
      item_id: l.item_id,
      qty: l.qty.toNumber(),
      start_date: isoDay(l.start_date),
      note: l.note ?? "",
      demands: l.demands.map((d) => ({ so_line_id: d.so_line_id, qty: d.qty.toNumber() })),
    })),
  };
}

// --------------------------------------------------------------- lifecycle

export type PlanTransitionResult = { ok: true } | { ok: false; errors: Record<string, string> };

/**
 * One lifecycle step, each conditional on the status just read. **Ajukan**
 * locks the plan, the Sales Order lines it covers and rechecks everything — so
 * the room is what those lines hold now, less every other live plan's. Setujui
 * and Tolak share a permission. Batalkan (Draft), Tolak and Tutup ask a reason;
 * **Tutup** takes a `guard` from the action layer, which knows the Perintah
 * made from the plan (§3.1: the Perintah depends on the plan, never the reverse).
 */
export async function transitionProductionPlan(
  id: number,
  action: ProductionPlanAction,
  actorId: number,
  reason?: string,
  guard?: () => Promise<string | null>
): Promise<PlanTransitionResult> {
  const plan = await prisma.prdPlan.findUnique({ where: { id }, include: WITH_LINES });
  if (!plan) return { ok: false, errors: { _form: "Rencana tidak ditemukan." } };
  const t = PRODUCTION_PLAN_TRANSITIONS[action];
  if (!productionPlanTransitionAllowed(action, plan.status as ProductionPlanStatus)) {
    return { ok: false, errors: { _form: `Rencana berstatus ini tidak dapat di-${t.label.toLowerCase()}.` } };
  }
  let why: string | null = null;
  if (t.reason) {
    why = String(reason ?? "").trim();
    if (!why) return { ok: false, errors: { reason: "Alasan wajib diisi." } };
  }
  return refusable(async () => {
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM prd_plan WHERE id = ${id} FOR UPDATE`;
      if (action === "submit") {
        const input = asInput(plan);
        const r = await checkProductionPlan(tx, input.header, input.lines, id, true);
        if (!r.ok) {
          const first = Object.entries(r.errors).find(([k]) => k !== "_lines")?.[1] ?? r.errors._lines;
          throw new Refused({ _form: `Belum bisa diajukan: ${first}` });
        }
      }
      if (action === "close") {
        const refusal = guard ? await guard() : null;
        if (refusal) throw new Refused({ _form: refusal });
      }
      const done = await tx.prdPlan.updateMany({
        where: { id, status: { in: t.from } },
        data: { status: t.to, ...(t.reason ? { status_reason: why } : {}), updated_by: actorId },
      });
      if (done.count !== 1) throw new Refused({ _form: "Rencana berubah saat diproses. Muat ulang halaman." });
      await audit(tx, id, "UPDATE", action, actorId);
    });
    return { ok: true as const };
  });
}

// ------------------------------------------------------------------- reads

export type PlanListRow = {
  id: number;
  planNo: string;
  planDate: string;
  period: string;
  status: ProductionPlanStatus;
  lines: number;
  /** Σ Qty Rencana of its lines — one number only because lines may be of different items; shown as a count of items. */
  items: number;
};

export async function listProductionPlans(): Promise<PlanListRow[]> {
  const rows = await prisma.prdPlan.findMany({
    orderBy: [{ period: "desc" }, { id: "desc" }],
    include: { lines: { select: { item_id: true } } },
  });
  return rows.map((r) => ({
    id: r.id,
    planNo: r.plan_no,
    planDate: isoDay(r.plan_date),
    period: isoDay(r.period).slice(0, 7),
    status: r.status as ProductionPlanStatus,
    lines: r.lines.length,
    items: new Set(r.lines.map((l) => l.item_id)).size,
  }));
}

export type PlanView = {
  id: number;
  planNo: string;
  status: ProductionPlanStatus;
  header: PlanHeaderInput;
  /** `lineIds[i]` is the stored id of `lines[i]` — what a Perintah is released from. */
  lineIds: number[];
  lines: PlanLineInput[];
  /** Per line, the Sales Order numbers its demands cover (as stored). */
  demandNos: Record<number, string>;
  statusReason: string | null;
};

export async function getProductionPlan(id: number): Promise<PlanView | null> {
  const p = await prisma.prdPlan.findUnique({ where: { id }, include: WITH_LINES });
  if (!p) return null;
  const input = asInput(p);
  return {
    id: p.id,
    planNo: p.plan_no,
    status: p.status as ProductionPlanStatus,
    header: input.header,
    lineIds: p.lines.map((l) => l.id),
    lines: input.lines,
    demandNos: Object.fromEntries(p.lines.flatMap((l) => l.demands.map((d) => [d.so_line_id, d.so_no] as const))),
    statusReason: p.status_reason,
  };
}

export function productionPlanCurrent(v: PlanView): PlanCurrent {
  return { itemIds: v.lines.map((l) => Number(l.item_id)), soLineIds: v.lines.flatMap((l) => l.demands.map((d) => Number(d.so_line_id))) };
}

/** Plan numbers by id, for the audit panel. */
export async function productionPlanNumbersByIds(ids: number[]): Promise<Map<number, string>> {
  const rows = await prisma.prdPlan.findMany({ where: { id: { in: ids } }, select: { id: true, plan_no: true } });
  return new Map(rows.map((r) => [r.id, r.plan_no]));
}

// ----------------------------------------------- for the Perintah Produksi

/** A plan line a Perintah may be released from: its plan is Open, so the Perintah offers it. */
export type PlanLineChoice = {
  id: number;
  planId: number;
  planNo: string;
  itemId: number;
  itemLabel: string;
  itemName: string;
  qty: number;
  startDate: string;
  /** Whether its plan is Open — a stored Perintah keeps reading its line after the plan closes. */
  open: boolean;
};

/** Lines of Open plans, plus any named (a stored Perintah's own), earliest start first. */
export async function planLineChoices(withIds: number[] = [], db: Db = prisma): Promise<PlanLineChoice[]> {
  const rows = await db.prdPlanLine.findMany({
    where: { OR: [{ plan: { status: "Open" } }, ...(withIds.length ? [{ id: { in: withIds } }] : [])] },
    orderBy: [{ start_date: "asc" }, { id: "asc" }],
    include: { plan: { select: { id: true, plan_no: true, status: true } }, item: { select: { item_label: true, item_name: true } } },
  });
  return rows.map((l) => ({
    id: l.id,
    planId: l.plan.id,
    planNo: l.plan.plan_no,
    itemId: l.item_id,
    itemLabel: l.item.item_label,
    itemName: l.item.item_name,
    qty: l.qty.toNumber(),
    startDate: isoDay(l.start_date),
    open: l.plan.status === "Open",
  }));
}

/** The ids of every line of these plans, for the page to ask the Perintah module what was released from them. */
export async function planLineIdsOfPlan(planId: number, db: Db = prisma): Promise<number[]> {
  return (await db.prdPlanLine.findMany({ where: { plan_id: planId }, select: { id: true } })).map((l) => l.id);
}
