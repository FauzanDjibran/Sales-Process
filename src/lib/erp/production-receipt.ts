import "server-only";

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { holdPostingPeriod } from "./fiscal";
import { HandoverRefusal, deliver, type HandoverMessage } from "./handover";
import { Refused, asDate, docTypeId, isoDay, refusable } from "./production-doc";
import { enterProduction, issueJob, jobsByIds, trackingByNo, trackingsByIds } from "./production-ledger";
import type { HandoverStatus, ProductionReceiptPurpose } from "./production-handover-shape";

/**
 * The Production Receipt (P317): goods coming into production. Its tables are
 * `prd_receipt` and `prd_receipt_line`, and nothing else names them.
 *
 * It is never typed: `IssueSent` makes it, a copy of the Stock Issue under the
 * same number with the value the warehouse froze, waiting for the Unit. **Terima**
 * puts each No. Stok in the Unit's Persiapan at that value — bahan to be worked
 * under a No. Job of its own, one per No. Stok (W98), bahan penolong under none —
 * dated the day of Terima, with no journal: the value became WIP at Kirim. It
 * then tells the ERP, which marks its issue Diterima.
 */

type Tx = Prisma.TransactionClient;

async function audit(tx: Tx, id: number, action: "TAMBAH" | "UPDATE", event: string, by: number) {
  await tx.auditLog.create({ data: { entity_key: "prd_receipt", row_id: id, action, event, by } });
}

/** The ERP sent goods to a Unit. Said twice, it makes nothing new. */
export async function takeIssueSent(tx: Tx, m: Extract<HandoverMessage, { type: "IssueSent" }>, actorId: number): Promise<void> {
  if (await tx.prdReceipt.findUnique({ where: { receipt_no: m.no }, select: { id: true } })) return;
  const unit = await tx.refUnit.findFirst({ where: { unit_label: m.unitLabel }, select: { id: true } });
  if (!unit) throw new HandoverRefusal(`Unit ${m.unitLabel} tidak dikenal di Produksi.`);
  const items = new Map((await tx.mItem.findMany({ where: { item_code: { in: m.lines.map((l) => l.itemCode) } }, select: { id: true, item_code: true } })).map((i) => [i.item_code, i.id]));
  const lines = [];
  for (const [i, l] of m.lines.entries()) {
    const itemId = items.get(l.itemCode);
    const tracking = await trackingByNo(tx, l.trackingNo);
    if (!itemId || !tracking || tracking.itemId !== itemId) throw new HandoverRefusal(`No. Stok ${l.trackingNo} tidak dikenal di Produksi.`);
    lines.push({ line_no: i + 1, item_id: itemId, tracking_id: tracking.id, qty: l.qty, base_cost_amount: l.value });
  }
  const row = await tx.prdReceipt.create({
    data: {
      receipt_no: m.no,
      purpose: m.purpose,
      unit_id: unit.id,
      warehouse_code: m.warehouseCode,
      warehouse_name: m.warehouseName,
      sent_date: asDate(m.date),
      note: m.note,
      created_by: actorId,
      lines: { create: lines },
    },
  });
  await audit(tx, row.id, "TAMBAH", "create", actorId);
}

/** Terima, by the Unit. */
export async function receiveProductionReceipt(id: number, actorId: number): Promise<{ ok: true; no: string } | { ok: false; errors: Record<string, string> }> {
  const r = await prisma.prdReceipt.findUnique({ where: { id }, include: { lines: { orderBy: { line_no: "asc" } } } });
  if (!r) return { ok: false, errors: { _form: "Dokumen tidak ditemukan." } };
  if (r.status !== "InTransit") return { ok: false, errors: { _form: "Dokumen ini sudah diterima. Muat ulang." } };
  const today = isoDay(new Date());
  if (today < isoDay(r.sent_date)) return { ok: false, errors: { _form: "Tanggal kirim di masa depan: Terima pada hari itu atau sesudahnya." } };
  return refusable(() =>
    prisma.$transaction(async (tx) => {
      await holdPostingPeriod(tx, today);
      const date = asDate(today);
      const done = await tx.prdReceipt.updateMany({ where: { id, status: "InTransit" }, data: { status: "Received", received_at: date, received_by: actorId, updated_by: actorId } });
      if (done.count !== 1) throw new Refused({ _form: "Dokumen ini berubah saat diproses. Muat ulang." });
      const source = { docTypeId: await docTypeId(tx, "prd_receipt"), docId: id, no: r.receipt_no };
      const auxiliary = r.purpose === "auxiliary";
      for (const l of r.lines) {
        const job = auxiliary ? null : await issueJob(tx, { unitId: r.unit_id, lotId: l.tracking_id, date, source, actorId });
        const entered = await enterProduction(tx, { jobId: job?.id ?? null, lotId: l.tracking_id, itemId: l.item_id, unitId: r.unit_id, baseQty: l.qty, value: l.base_cost_amount, auxiliary, date, source, actorId });
        await tx.prdReceiptLine.update({ where: { id: l.id }, data: { job_id: job?.id ?? null, bucket_id: entered.bucketId } });
      }
      await deliver(tx, { type: "IssueReceived", no: r.receipt_no, date: today }, actorId);
      await audit(tx, id, "UPDATE", "receive", actorId);
      return { ok: true as const, no: r.receipt_no };
    })
  );
}

// -------------------------------------------------------------------- reads

export type ProductionReceiptRow = {
  id: number;
  no: string;
  purpose: ProductionReceiptPurpose;
  date: string;
  status: HandoverStatus;
  unitId: number;
  unitLabel: string;
  warehouseName: string;
  lines: number;
};

const purposeOf = (p: string): ProductionReceiptPurpose => (p === "auxiliary" ? "auxiliary" : "material");

/** `units`: the actor's (P260), or null for all. */
export async function listProductionReceipts(units: number[] | null = null): Promise<ProductionReceiptRow[]> {
  const rows = await prisma.prdReceipt.findMany({
    where: units ? { unit_id: { in: units } } : undefined,
    orderBy: [{ sent_date: "desc" }, { id: "desc" }],
    include: { unit: true, _count: { select: { lines: true } } },
  });
  return rows.map((r) => ({ id: r.id, no: r.receipt_no, purpose: purposeOf(r.purpose), date: isoDay(r.sent_date), status: r.status, unitId: r.unit_id, unitLabel: r.unit.unit_label, warehouseName: r.warehouse_name, lines: r._count.lines }));
}

export type ProductionReceiptView = ProductionReceiptRow & {
  receivedAt: string | null;
  note: string | null;
  items: { lineNo: number; lotNo: string; itemLabel: string; itemName: string; uomLabel: string; jobNo: string | null; qty: number }[];
};

async function viewsOf(where: Prisma.PrdReceiptWhereInput): Promise<ProductionReceiptView[]> {
  const rows = await prisma.prdReceipt.findMany({ where, orderBy: [{ sent_date: "asc" }, { id: "asc" }], include: { unit: true, lines: { orderBy: { line_no: "asc" } } } });
  const all = rows.flatMap((r) => r.lines);
  const [trackings, jobs] = await Promise.all([trackingsByIds(all.map((l) => l.tracking_id)), jobsByIds(all.flatMap((l) => (l.job_id ? [l.job_id] : [])))]);
  return rows.map((r) => ({
    id: r.id,
    no: r.receipt_no,
    purpose: purposeOf(r.purpose),
    date: isoDay(r.sent_date),
    status: r.status,
    unitId: r.unit_id,
    unitLabel: r.unit.unit_label,
    warehouseName: r.warehouse_name,
    lines: r.lines.length,
    receivedAt: isoDay(r.received_at) || null,
    note: r.note,
    items: r.lines.map((l) => {
      const t = trackings.get(l.tracking_id);
      return {
        lineNo: l.line_no,
        lotNo: t?.no ?? "",
        itemLabel: t?.itemLabel ?? "",
        itemName: t?.itemName ?? "",
        uomLabel: t?.uomLabel ?? "",
        jobNo: l.job_id ? (jobs.get(l.job_id)?.no ?? null) : null,
        qty: l.qty.toNumber(),
      };
    }),
  }));
}

export const getProductionReceipt = async (id: number): Promise<ProductionReceiptView | null> => (await viewsOf({ id }))[0] ?? null;

/** What waits for a Unit's Terima: the Workspace's *Penerimaan*. */
export const waitingProductionReceipts = (): Promise<ProductionReceiptView[]> => viewsOf({ status: "InTransit" });

/** The Unit a receipt goes to: Terima is that Unit's (P260). */
export async function productionReceiptUnit(id: number): Promise<number | null> {
  return (await prisma.prdReceipt.findUnique({ where: { id }, select: { unit_id: true } }))?.unit_id ?? null;
}

export async function productionReceiptNumbersByIds(ids: number[]): Promise<Map<number, string>> {
  const rows = await prisma.prdReceipt.findMany({ where: { id: { in: ids } }, select: { id: true, receipt_no: true } });
  return new Map(rows.map((r) => [r.id, r.receipt_no]));
}
