import "server-only";

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { nextDocumentNumber } from "./document-number";
import {
  PURCHASE_REQUEST_TRANSITIONS,
  purchaseRequestIsEditable,
  purchaseRequestTransitionAllowed,
  type PurchaseRequestAction,
  type PurchaseRequestStatus,
} from "./purchase-request-workflow";

/**
 * The Purchase Request module (P123, Purchasing-Concept.md B6–B8): its tables
 * are `pur_request` and `pur_request_line`, and nothing else names them.
 *
 * A request says what is needed, in each item's base unit, and by when. It is
 * Barang or Jasa — one kind per request — and carries no supplier, price or
 * tax. Ajukan makes it Open, and only then may a Purchase Order take from it;
 * the PO module tells it what was ordered through `recordPurchaseRequestOrdered`
 * (step 3), and a request whose every line is fully ordered closes itself.
 */

type Db = Prisma.TransactionClient | typeof prisma;

export type PurchaseRequestHeaderInput = {
  item_type: "Barang" | "Jasa";
  request_date: string;
  needed_date: string;
  requester: string;
  warehouse_id: number | null;
  note: string;
};

export type PurchaseRequestLineInput = {
  item_id: number | null;
  qty: number | string;
  needed_date: string;
  note: string;
};

export type PurchaseRequestResult =
  | { ok: true; id: number; requestNo: string }
  | { ok: false; errors: Record<string, string> };

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const asDate = (d: string) => new Date(`${d}T00:00:00Z`);
const isoDay = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "");
const lineKey = (i: number, field: string) => `lines.${i}.${field}`;
const text = (v: unknown) => String(v ?? "").trim() || null;

/** Quantities are `Decimal(18, 4)`, compared in ten-thousandths. */
const QTY_SCALE = 10_000;
const units = (n: number) => Math.round(n * QTY_SCALE);
const fromUnits = (u: number) => u / QTY_SCALE;

// ---------------------------------------------------------------- options

export type PrItemOption = { id: number; label: string; name: string; active: boolean; uomId: number; uomLabel: string };

export type PurchaseRequestOptions = {
  items: PrItemOption[];
  warehouses: { id: number; label: string; name: string; active: boolean }[];
};

/**
 * What the form offers for one kind: the items of that type marked Dapat
 * Dibeli, each with its base unit (B3, B7), and the warehouses. `withItemIds`
 * keeps items a stored request already names readable after they change.
 */
export async function purchaseRequestOptions(itemType: "Barang" | "Jasa", withItemIds: number[] = []): Promise<PurchaseRequestOptions> {
  const [items, warehouses] = await Promise.all([
    prisma.mItem.findMany({
      where: { OR: [{ item_type: itemType, can_buy: true }, ...(withItemIds.length ? [{ id: { in: withItemIds } }] : [])] },
      orderBy: { item_label: "asc" },
      include: { base_uom: true },
    }),
    prisma.refWarehouse.findMany({ orderBy: { warehouse_label: "asc" } }),
  ]);
  return {
    items: items.map((i) => ({
      id: i.id,
      label: i.item_label,
      name: i.item_name,
      active: i.status === "Active" && i.can_buy && i.item_type === itemType,
      uomId: i.base_uom_id,
      uomLabel: i.base_uom.uom_label,
    })),
    warehouses: warehouses.map((w) => ({ id: w.id, label: w.warehouse_label, name: w.warehouse_name, active: w.status === "Active" })),
  };
}

// ------------------------------------------------------------- validation

type CheckedLine = { line_no: number; item_id: number; uom_id: number; qty: number; needed_date: Date; note: string | null };

type Checked = {
  data: {
    item_type: "Barang" | "Jasa";
    request_date: Date;
    needed_date: Date;
    requester: string | null;
    warehouse_id: number | null;
    note: string | null;
  };
  lines: CheckedLine[];
};

/** Every rule a Purchase Request must satisfy to be saved — and, run again, to be submitted. */
export async function checkPurchaseRequest(
  db: Db,
  header: PurchaseRequestHeaderInput,
  lines: PurchaseRequestLineInput[]
): Promise<{ ok: true; c: Checked } | { ok: false; errors: Record<string, string> }> {
  const errors: Record<string, string> = {};
  const itemType = header.item_type === "Jasa" ? "Jasa" : header.item_type === "Barang" ? "Barang" : null;
  if (!itemType) errors._form = "Jenis Purchase Request tidak dikenal.";

  const requestDate = String(header.request_date ?? "").trim();
  const neededDate = String(header.needed_date ?? "").trim();
  if (!DAY.test(requestDate)) errors.request_date = "Tanggal wajib diisi.";
  if (!DAY.test(neededDate)) errors.needed_date = "Tanggal dibutuhkan wajib diisi.";
  else if (DAY.test(requestDate) && neededDate < requestDate) errors.needed_date = "Tidak boleh sebelum tanggal Purchase Request.";

  // A warehouse is where Barang are wanted; a Jasa has none (B7).
  let warehouseId = Number(header.warehouse_id) || null;
  if (itemType === "Jasa") warehouseId = null;
  else if (warehouseId) {
    const w = await db.refWarehouse.findUnique({ where: { id: warehouseId }, select: { status: true } });
    if (!w) errors.warehouse_id = "Gudang tidak ditemukan.";
    else if (w.status !== "Active") errors.warehouse_id = "Gudang tersebut sudah nonaktif.";
  }

  const raw = Array.isArray(lines) ? lines : [];
  if (!raw.length) errors._lines = `Tambahkan minimal satu ${itemType === "Jasa" ? "jasa" : "barang"}.`;
  const itemIds = [...new Set(raw.map((l) => Number(l.item_id)).filter(Boolean))];
  const items = new Map(
    (await db.mItem.findMany({ where: { id: { in: itemIds } }, select: { id: true, item_label: true, item_type: true, can_buy: true, status: true, base_uom_id: true } })).map(
      (i) => [i.id, i]
    )
  );
  const out: CheckedLine[] = [];
  const seen = new Set<string>();
  for (const [i, l] of raw.entries()) {
    const item = items.get(Number(l.item_id));
    if (!item) {
      errors[lineKey(i, "item_id")] = l.item_id ? "Item tidak ditemukan." : `Pilih ${itemType === "Jasa" ? "jasa" : "barang"}.`;
      continue;
    }
    if (item.item_type !== itemType || !item.can_buy) {
      errors[lineKey(i, "item_id")] = `${item.item_label} bukan ${itemType === "Jasa" ? "jasa" : "barang"} yang dapat dibeli.`;
      continue;
    }
    if (item.status !== "Active") {
      errors[lineKey(i, "item_id")] = `${item.item_label} sudah nonaktif.`;
      continue;
    }
    const need = String(l.needed_date ?? "").trim() || neededDate;
    if (!DAY.test(need)) {
      errors[lineKey(i, "needed_date")] = "Tanggal dibutuhkan wajib diisi.";
      continue;
    }
    if (DAY.test(requestDate) && need < requestDate) {
      errors[lineKey(i, "needed_date")] = "Tidak boleh sebelum tanggal Purchase Request.";
      continue;
    }
    // The same item may be asked for on two dates, never twice for one date.
    const key = `${item.id}|${need}`;
    if (seen.has(key)) {
      errors[lineKey(i, "item_id")] = `${item.item_label} sudah diminta untuk tanggal yang sama.`;
      continue;
    }
    seen.add(key);
    const qty = Number(String(l.qty ?? "").replace(",", "."));
    if (!Number.isFinite(qty) || !(qty > 0)) {
      errors[lineKey(i, "qty")] = "Isi jumlah lebih dari 0.";
      continue;
    }
    if (Math.abs(qty * QTY_SCALE - units(qty)) > 1e-6) {
      errors[lineKey(i, "qty")] = "Paling banyak 4 angka desimal.";
      continue;
    }
    out.push({
      line_no: out.length + 1,
      item_id: item.id,
      uom_id: item.base_uom_id,
      qty: fromUnits(units(qty)),
      needed_date: asDate(need),
      note: text(l.note),
    });
  }
  if (!errors._lines && Object.keys(errors).some((k) => k.startsWith("lines."))) errors._lines = "Ada baris yang perlu diperbaiki.";

  if (Object.keys(errors).length || !itemType) return { ok: false, errors };
  return {
    ok: true,
    c: {
      data: {
        item_type: itemType,
        request_date: asDate(requestDate),
        needed_date: asDate(neededDate),
        requester: text(header.requester),
        warehouse_id: warehouseId,
        note: text(header.note),
      },
      lines: out,
    },
  };
}

// ------------------------------------------------------------------ writes

async function nextRequestNo(db: Db, date: Date): Promise<string> {
  return nextDocumentNumber("PR", date, async (series) => {
    const row = await db.purRequest.findFirst({ where: { request_no: { startsWith: series } }, orderBy: { id: "desc" }, select: { request_no: true } });
    return row?.request_no ?? null;
  });
}

async function audit(db: Db, id: number, action: "TAMBAH" | "UPDATE", event: string, by: number) {
  await db.auditLog.create({ data: { entity_key: "pur_request", row_id: id, action, event, by } });
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

export async function createPurchaseRequest(
  header: PurchaseRequestHeaderInput,
  lines: PurchaseRequestLineInput[],
  actorId: number
): Promise<PurchaseRequestResult> {
  return refusable(async () => {
    const made = await prisma.$transaction(async (tx) => {
      const r = await checkPurchaseRequest(tx, header, lines);
      if (!r.ok) throw new Refused(r.errors);
      const row = await tx.purRequest.create({
        data: {
          ...r.c.data,
          request_no: await nextRequestNo(tx, r.c.data.request_date),
          created_by: actorId,
          lines: { create: r.c.lines },
        },
      });
      await audit(tx, row.id, "TAMBAH", "create", actorId);
      return row;
    });
    return { ok: true as const, id: made.id, requestNo: made.request_no };
  });
}

export async function updatePurchaseRequest(
  id: number,
  header: PurchaseRequestHeaderInput,
  lines: PurchaseRequestLineInput[],
  actorId: number
): Promise<PurchaseRequestResult> {
  const current = await prisma.purRequest.findUnique({ where: { id }, select: { status: true, request_no: true, item_type: true } });
  if (!current) return { ok: false, errors: { _form: "Purchase Request tidak ditemukan." } };
  if (!purchaseRequestIsEditable(current.status as PurchaseRequestStatus)) {
    return { ok: false, errors: { _form: "Purchase Request yang sudah diajukan tidak dapat diubah." } };
  }
  if (header.item_type !== current.item_type) return { ok: false, errors: { _form: "Jenis Purchase Request tidak dapat diganti." } };
  return refusable(async () => {
    await prisma.$transaction(async (tx) => {
      const r = await checkPurchaseRequest(tx, header, lines);
      if (!r.ok) throw new Refused(r.errors);
      const done = await tx.purRequest.updateMany({ where: { id, status: "Draft" }, data: { ...r.c.data, updated_by: actorId } });
      if (done.count !== 1) throw new Refused({ _form: "Purchase Request berubah saat diproses. Muat ulang halaman." });
      // A Draft's lines are rewritten whole: nothing names them before it is Open.
      await tx.purRequestLine.deleteMany({ where: { request_id: id } });
      await tx.purRequestLine.createMany({ data: r.c.lines.map((l) => ({ ...l, request_id: id })) });
      await audit(tx, id, "UPDATE", "update", actorId);
    });
    return { ok: true as const, id, requestNo: current.request_no };
  });
}

function asInput(r: Prisma.PurRequestGetPayload<{ include: { lines: true } }>): {
  header: PurchaseRequestHeaderInput;
  lines: PurchaseRequestLineInput[];
} {
  return {
    header: {
      item_type: r.item_type,
      request_date: isoDay(r.request_date),
      needed_date: isoDay(r.needed_date),
      requester: r.requester ?? "",
      warehouse_id: r.warehouse_id,
      note: r.note ?? "",
    },
    lines: [...r.lines]
      .sort((a, b) => a.line_no - b.line_no)
      .map((l) => ({ item_id: l.item_id, qty: l.qty.toNumber(), needed_date: isoDay(l.needed_date), note: l.note ?? "" })),
  };
}

// --------------------------------------------------------------- lifecycle

export type PurchaseRequestTransitionResult = { ok: true } | { ok: false; errors: Record<string, string> };

/**
 * One lifecycle step (B8). **Ajukan** checks the stored request again — an
 * item may have been deactivated since it was saved. Batalkan and Tutup ask
 * for a reason, kept in `status_reason`. Every step is conditional on the
 * status just read, so two people acting at once cannot both succeed.
 */
export async function transitionPurchaseRequest(
  id: number,
  action: PurchaseRequestAction,
  actorId: number,
  reason?: string
): Promise<PurchaseRequestTransitionResult> {
  const request = await prisma.purRequest.findUnique({ where: { id }, include: { lines: true } });
  if (!request) return { ok: false, errors: { _form: "Purchase Request tidak ditemukan." } };
  const t = PURCHASE_REQUEST_TRANSITIONS[action];
  if (!purchaseRequestTransitionAllowed(action, request.status as PurchaseRequestStatus)) {
    return { ok: false, errors: { _form: `Purchase Request berstatus ini tidak dapat di-${t.label.toLowerCase()}.` } };
  }
  let why: string | null = null;
  if (t.reason) {
    why = String(reason ?? "").trim();
    if (!why) return { ok: false, errors: { reason: "Alasan wajib diisi." } };
  }
  return refusable(async () => {
    await prisma.$transaction(async (tx) => {
      if (action === "submit") {
        const input = asInput(request);
        const r = await checkPurchaseRequest(tx, input.header, input.lines);
        if (!r.ok) {
          const first = Object.entries(r.errors).find(([k]) => k !== "_lines")?.[1] ?? r.errors._lines;
          throw new Refused({ _form: `Belum bisa diajukan: ${first}` });
        }
      }
      const done = await tx.purRequest.updateMany({
        where: { id, status: request.status },
        data: { status: t.to, ...(why ? { status_reason: why } : {}), updated_by: actorId },
      });
      if (done.count !== 1) throw new Refused({ _form: "Purchase Request berubah saat diproses. Muat ulang halaman." });
      await audit(tx, id, "UPDATE", action, actorId);
    });
    return { ok: true as const };
  });
}

// ------------------------------------------------- for the Purchase Order

/**
 * Records what Purchase Orders took of these request lines (base units;
 * negative gives quantity back), then closes every Open request whose lines
 * are all fully ordered — closed because fulfilled, so with no reason. Called
 * by the PO module inside its own transaction (step 3); returns the numbers of
 * the requests it closed.
 */
export async function recordPurchaseRequestOrdered(
  tx: Prisma.TransactionClient,
  ordered: Map<number, number>,
  actorId: number
): Promise<string[]> {
  if (!ordered.size) return [];
  for (const [lineId, qty] of ordered) {
    await tx.purRequestLine.update({ where: { id: lineId }, data: { ordered_qty: { increment: qty } } });
  }
  const requests = await tx.purRequest.findMany({
    where: { status: "Open", lines: { some: { id: { in: [...ordered.keys()] } } } },
    include: { lines: true },
  });
  const closed: string[] = [];
  for (const r of requests) {
    if (!r.lines.every((l) => units(l.ordered_qty.toNumber()) >= units(l.qty.toNumber()))) continue;
    const done = await tx.purRequest.updateMany({ where: { id: r.id, status: "Open" }, data: { status: "Closed", status_reason: null, updated_by: actorId } });
    if (done.count === 1) {
      await audit(tx, r.id, "UPDATE", "fulfil", actorId);
      closed.push(r.request_no);
    }
  }
  return closed;
}

// ------------------------------------------------------------------- reads

export type PurchaseRequestListRow = {
  id: number;
  requestNo: string;
  requestDate: string;
  neededDate: string;
  status: PurchaseRequestStatus;
  requester: string | null;
  warehouseLabel: string | null;
  lines: number;
};

export async function listPurchaseRequests(itemType: "Barang" | "Jasa"): Promise<PurchaseRequestListRow[]> {
  const rows = await prisma.purRequest.findMany({
    where: { item_type: itemType },
    orderBy: [{ request_date: "desc" }, { id: "desc" }],
    include: { warehouse: true, _count: { select: { lines: true } } },
  });
  return rows.map((r) => ({
    id: r.id,
    requestNo: r.request_no,
    requestDate: isoDay(r.request_date),
    neededDate: isoDay(r.needed_date),
    status: r.status as PurchaseRequestStatus,
    requester: r.requester,
    warehouseLabel: r.warehouse?.warehouse_label ?? null,
    lines: r._count.lines,
  }));
}

export type PurchaseRequestView = {
  id: number;
  requestNo: string;
  status: PurchaseRequestStatus;
  header: PurchaseRequestHeaderInput;
  lines: (PurchaseRequestLineInput & { id: number; ordered: number })[];
  statusReason: string | null;
};

export async function getPurchaseRequest(id: number): Promise<PurchaseRequestView | null> {
  const r = await prisma.purRequest.findUnique({ where: { id }, include: { lines: true } });
  if (!r) return null;
  const input = asInput(r);
  const sorted = [...r.lines].sort((a, b) => a.line_no - b.line_no);
  return {
    id: r.id,
    requestNo: r.request_no,
    status: r.status as PurchaseRequestStatus,
    header: input.header,
    lines: input.lines.map((l, i) => ({ ...l, id: sorted[i].id, ordered: sorted[i].ordered_qty.toNumber() })),
    statusReason: r.status_reason,
  };
}

/** Request numbers by id, for the audit panel. */
export async function purchaseRequestNumbersByIds(ids: number[]): Promise<Map<number, string>> {
  const rows = await prisma.purRequest.findMany({ where: { id: { in: ids } }, select: { id: true, request_no: true } });
  return new Map(rows.map((r) => [r.id, r.request_no]));
}
