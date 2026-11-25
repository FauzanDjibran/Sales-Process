import "server-only";

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { holdPostingPeriod } from "./fiscal";
import { HandoverRefusal, deliver, type HandoverMessage } from "./handover";
import { DAY, Refused, asDate, docTypeId, fourDecimals, fromUnits, isoDay, nextDailyNumber, parseQty, refusable, text, unitSeries, units as scaled } from "./production-doc";
import { ProductionRefusal, availableBuckets, bucketsByIds, jobsByIds, partaiNosByIds, sendInTransit, takeFromBucket, trackingsByIds, type BucketView } from "./production-ledger";
import { endsLine, routeMap } from "./production-master";
import { isTransitWarehouse } from "./system-settings";
import { PRODUCTION_ISSUE_PURPOSES, PRODUCTION_ISSUE_REASONS, issuePurposeOf, type HandoverStatus, type ProductionIssuePurpose } from "./production-handover-shape";

/**
 * The Production Issue (P317): goods leaving production. Its tables are
 * `prd_issue` and `prd_issue_line`, and nothing else names them. Two purposes:
 *
 * - **BSTB ke Finish Goods** (`finish_goods`, `BFG_…`): Stand By of the Unit that
 *   ends a line's routing, each No. Stok whole (P303).
 * - **BSTB Pengeluaran** (`return`, `BPG_…`): Persiapan or Stand By of any Unit
 *   (W29), a No. Stok without a Job in part, a Job whole (W96); it ends the Job
 *   (W104). Its reason is for reading only.
 *
 * **Kirim** (no Draft, no journal): the goods wait at the Unit as Dalam
 * Perjalanan, a row of this document's own, so the value each carries is frozen;
 * `ReceiptSent` makes the Stock Receipt. When the warehouse takes it in,
 * `ReceiptReceived` empties those rows at exactly that value.
 */

type Tx = Prisma.TransactionClient;
type Db = Tx | typeof prisma;

/** The warehouse each document goes to, for the reports. */
export async function issueWarehouses(ids: number[]): Promise<Map<number, string>> {
  const rows = await prisma.prdIssue.findMany({ where: { id: { in: ids } }, select: { id: true, warehouse_name: true } });
  return new Map(rows.map((i) => [i.id, i.warehouse_name]));
}

export type ProductionIssueLineInput = { bucket_id: number | null; qty: number | string };
export type ProductionIssueInput = { purpose?: ProductionIssuePurpose; reason?: string | null; from_unit_id: number | null; warehouse_id: number | null; issue_date: string; note: string; lines: ProductionIssueLineInput[] };
export type ProductionIssueResult = { ok: true; id: number; no: string } | { ok: false; errors: Record<string, string> };

async function audit(tx: Tx, id: number, action: "TAMBAH" | "UPDATE", event: string, by: number) {
  await tx.auditLog.create({ data: { entity_key: "prd_issue", row_id: id, action, event, by } });
}

type Warehouse = { id: number; code: string; label: string; name: string };

/** Warehouses that take goods from production: active, not the Gudang Transit. */
async function receivingWarehouses(db: Db): Promise<Warehouse[]> {
  const rows = await db.refWarehouse.findMany({ where: { status: "Active" }, orderBy: { warehouse_code: "asc" }, select: { id: true, warehouse_code: true, warehouse_label: true, warehouse_name: true } });
  const out: Warehouse[] = [];
  for (const w of rows) if (!(await isTransitWarehouse(w.id, db))) out.push({ id: w.id, code: w.warehouse_code, label: w.warehouse_label, name: w.warehouse_name });
  return out;
}

/** What each purpose may send: Stand By of the line's last Unit, or Persiapan and Stand By anywhere. */
const sendable = (purpose: ProductionIssuePurpose, b: BucketView) => b.qty > 0 && (purpose === "return" ? b.stage === "Preparation" || b.stage === "StandBy" : b.stage === "StandBy" && !b.auxiliary);

// -------------------------------------------------------------------- Kirim

async function check(db: Db, input: ProductionIssueInput) {
  const purpose = issuePurposeOf(input.purpose ?? "finish_goods");
  const errors: Record<string, string> = {};
  const unitId = Number(input.from_unit_id) || null;
  const unit = unitId ? await db.refUnit.findUnique({ where: { id: unitId } }) : null;
  if (!unit) errors.from_unit_id = "Pilih Unit asal.";
  else if (unit.status !== "Active") errors.from_unit_id = `Unit ${unit.unit_label} nonaktif.`;
  else if (purpose === "finish_goods" && !endsLine(await routeMap(), unit.id)) errors.from_unit_id = `${unit.unit_label} bukan Unit terakhir routing: kirim lewat Push atau BSTB.`;
  const warehouse = (await receivingWarehouses(db)).find((w) => w.id === Number(input.warehouse_id));
  if (!warehouse) errors.warehouse_id = "Pilih Gudang aktif.";
  if (!DAY.test(input.issue_date)) errors.issue_date = "Isi tanggal.";
  const reason = purpose === "return" ? text(input.reason) : null;
  if (reason && !(reason in PRODUCTION_ISSUE_REASONS)) errors.reason = "Alasan tidak dikenal.";

  const raw = Array.isArray(input.lines) ? input.lines : [];
  if (!raw.length) errors._lines = "Pilih barang yang dikirim.";
  const buckets = await bucketsByIds(raw.flatMap((l) => (l.bucket_id ? [Number(l.bucket_id)] : [])), db);
  const rows: { bucket: BucketView; qty: number }[] = [];
  const seen = new Set<number>();
  raw.forEach((l, i) => {
    const b = buckets.get(Number(l.bucket_id));
    const key = `lines.${i}.qty`;
    if (!b || b.unitId !== unit?.id || !sendable(purpose, b)) {
      errors._lines = purpose === "return" ? "Ada barang yang tidak lagi di Persiapan atau Stand By unit ini. Muat ulang." : "Ada barang yang tidak lagi di Stand By unit ini. Muat ulang.";
      return;
    }
    if (seen.has(b.id)) {
      errors._lines = `No. Stok ${b.lotNo} dipilih lebih dari sekali.`;
      return;
    }
    seen.add(b.id);
    // Finished goods and a Job leave whole (W96); a BSTB Pengeluaran takes a No. Stok without a Job in part.
    const whole = purpose === "finish_goods" || b.jobId != null;
    const qty = whole ? b.qty : parseQty(l.qty);
    if (!(qty > 0)) errors[key] = "Isi jumlah lebih dari 0.";
    else if (!fourDecimals(qty)) errors[key] = "Paling banyak 4 angka desimal.";
    else if (scaled(qty) > scaled(b.qty)) errors[key] = `Melebihi saldo (${b.qty} ${b.uomLabel}).`;
    else rows.push({ bucket: b, qty: whole ? b.qty : fromUnits(scaled(qty)) });
  });
  // A Job leaves with every No. Stok of it waiting at the same stage of this Unit.
  const jobs = [...new Set(rows.flatMap((r) => (r.bucket.jobId ? [`${r.bucket.jobId}|${r.bucket.stage}`] : [])))];
  if (!errors._lines && jobs.length) {
    const held = (await availableBuckets({ unitIds: [unit!.id] }, db)).filter((b) => b.jobId && jobs.includes(`${b.jobId}|${b.stage}`) && sendable(purpose, b));
    const short = held.find((b) => !seen.has(b.id));
    if (short) errors._lines = `No. Job ${short.jobNo} dikirim utuh: ${short.lotNo} belum ikut.`;
  }
  if (Object.keys(errors).length) return { ok: false as const, errors };
  return { ok: true as const, purpose, reason, unit: unit!, warehouse: warehouse!, rows, date: asDate(input.issue_date), note: text(input.note) };
}

/** Kirim: the goods wait as Dalam Perjalanan at the Unit until the warehouse takes them in. */
export async function sendProductionIssue(input: ProductionIssueInput, actorId: number): Promise<ProductionIssueResult> {
  const first = await check(prisma, input);
  if (!first.ok) return first;
  return refusable(() =>
    prisma.$transaction(async (tx) => {
      await holdPostingPeriod(tx, input.issue_date);
      const c = await check(tx, input);
      if (!c.ok) throw new Refused(c.errors);
      const s = unitSeries(PRODUCTION_ISSUE_PURPOSES[c.purpose].prefix, c.unit.unit_label, c.date);
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${s}))`;
      const last = await tx.prdIssue.findFirst({ where: { issue_no: { startsWith: s } }, orderBy: { issue_no: "desc" }, select: { issue_no: true } });
      const no = nextDailyNumber(s, last?.issue_no ?? null);
      const header = await tx.prdIssue.create({
        data: { issue_no: no, purpose: c.purpose, reason: c.reason, unit_id: c.unit.id, warehouse_code: c.warehouse.code, warehouse_name: c.warehouse.name, issue_date: c.date, note: c.note, created_by: actorId },
      });
      const source = { docTypeId: await docTypeId(tx, "prd_issue"), docId: header.id, no };
      const made: { row: (typeof c.rows)[number]; value: number; grams: number | null }[] = [];
      for (const row of c.rows) {
        const b = row.bucket;
        const moved = await sendInTransit(tx, { bucketId: b.id, baseQty: row.qty, date: c.date, source, actorId, doc: source, fromPreparation: c.purpose === "return" });
        const grams = b.gramsEach != null ? row.qty * b.gramsEach : b.grams;
        await tx.prdIssueLine.create({
          data: {
            issue_id: header.id,
            line_no: made.length + 1,
            item_id: b.itemId,
            tracking_id: b.lotId,
            job_id: b.jobId,
            partai_id: b.partaiId,
            qty: row.qty,
            grams,
            value: moved.value,
            from_bucket_id: b.id,
            transit_bucket_id: moved.toBucketId,
          },
        });
        made.push({ row, value: moved.value, grams });
      }
      const codes = new Map((await tx.mItem.findMany({ where: { id: { in: made.map((m) => m.row.bucket.itemId) } }, select: { id: true, item_code: true } })).map((i) => [i.id, i.item_code]));
      await deliver(
        tx,
        {
          type: "ReceiptSent",
          no,
          purpose: c.purpose,
          date: isoDay(c.date),
          unitLabel: c.unit.unit_label,
          warehouseCode: c.warehouse.code,
          note: [c.reason ? PRODUCTION_ISSUE_REASONS[c.reason] : null, c.note].filter(Boolean).join(" · ") || null,
          lines: made.map(({ row: { bucket: b, qty }, value, grams }) => ({
            trackingNo: b.lotNo,
            itemCode: codes.get(b.itemId)!,
            qty: String(qty),
            value,
            expiry: b.expiry,
            grams: grams == null ? null : String(grams),
            jobNo: b.jobNo,
            partaiNo: b.partaiNo,
          })),
        },
        actorId
      );
      await audit(tx, header.id, "TAMBAH", "send", actorId);
      return { ok: true as const, id: header.id, no };
    })
  );
}

/** The warehouse took the goods in: what travelled leaves production at the value frozen at Kirim. Said twice, it changes nothing. */
export async function takeReceiptReceived(tx: Tx, m: Extract<HandoverMessage, { type: "ReceiptReceived" }>, actorId: number): Promise<void> {
  const issue = await tx.prdIssue.findUnique({ where: { issue_no: m.no }, include: { lines: true } });
  if (!issue) throw new HandoverRefusal(`Production Issue ${m.no} tidak ditemukan.`);
  const date = asDate(m.date);
  const done = await tx.prdIssue.updateMany({ where: { id: issue.id, status: "InTransit" }, data: { status: "Received", received_at: date, updated_by: actorId } });
  if (done.count !== 1) return;
  const source = { docTypeId: await docTypeId(tx, "prd_issue"), docId: issue.id, no: issue.issue_no };
  // Lines of one No. Stok from two stages travel in one row: it is emptied once.
  const rows = new Map<number, { qty: Prisma.Decimal; value: Prisma.Decimal }>();
  for (const l of issue.lines) {
    const r = rows.get(l.transit_bucket_id);
    rows.set(l.transit_bucket_id, r ? { qty: r.qty.add(l.qty), value: r.value.add(l.value) } : { qty: l.qty, value: l.value });
  }
  try {
    for (const [bucketId, r] of [...rows].sort((a, b) => a[0] - b[0])) {
      const out = await takeFromBucket(tx, { bucketId, baseQty: r.qty, date, source, actorId });
      if (!r.value.eq(out.value)) throw new HandoverRefusal(`${out.lotNo} membawa ${out.value}, bukan ${r.value} seperti saat dikirim.`);
    }
  } catch (e) {
    if (e instanceof ProductionRefusal) throw new HandoverRefusal(e.message);
    throw e;
  }
  await audit(tx, issue.id, "UPDATE", "receive", actorId);
}

// -------------------------------------------------------------------- reads

export type ProductionIssueOptions = {
  purpose: ProductionIssuePurpose;
  unit: { id: number; label: string; name: string };
  endsLine: boolean;
  buckets: BucketView[];
  warehouses: { id: number; label: string; name: string }[];
};

/** The Kirim form: what the Unit may send for this purpose, and the warehouses that take it. */
export async function productionIssueOptions(unitId: number, purpose: ProductionIssuePurpose = "finish_goods"): Promise<ProductionIssueOptions | null> {
  const unit = await prisma.refUnit.findUnique({ where: { id: unitId }, select: { id: true, unit_label: true, unit_name: true } });
  if (!unit) return null;
  const [buckets, map, warehouses] = await Promise.all([availableBuckets({ unitIds: [unitId] }), routeMap(), receivingWarehouses(prisma)]);
  return {
    purpose,
    unit: { id: unit.id, label: unit.unit_label, name: unit.unit_name },
    endsLine: endsLine(map, unitId),
    buckets: buckets.filter((b) => sendable(purpose, b)),
    warehouses: warehouses.map((w) => ({ id: w.id, label: w.label, name: w.name })),
  };
}

export type ProductionIssueRow = {
  id: number;
  no: string;
  purpose: ProductionIssuePurpose;
  reason: string | null;
  date: string;
  status: HandoverStatus;
  unitId: number;
  unitLabel: string;
  warehouseName: string;
  lines: number;
};

/** `units`: the actor's (P260), or null for all. */
export async function listProductionIssues(units: number[] | null = null): Promise<ProductionIssueRow[]> {
  const rows = await prisma.prdIssue.findMany({
    where: units ? { unit_id: { in: units } } : undefined,
    orderBy: [{ issue_date: "desc" }, { id: "desc" }],
    include: { unit: true, _count: { select: { lines: true } } },
  });
  return rows.map((r) => ({
    id: r.id,
    no: r.issue_no,
    purpose: issuePurposeOf(r.purpose),
    reason: r.reason,
    date: isoDay(r.issue_date),
    status: r.status,
    unitId: r.unit_id,
    unitLabel: r.unit.unit_label,
    warehouseName: r.warehouse_name,
    lines: r._count.lines,
  }));
}

export type ProductionIssueView = ProductionIssueRow & {
  receivedAt: string | null;
  note: string | null;
  items: { lineNo: number; lotNo: string; itemLabel: string; itemName: string; uomLabel: string; jobNo: string | null; partaiNo: string | null; qty: number; grams: number | null }[];
};

export async function getProductionIssue(id: number): Promise<ProductionIssueView | null> {
  const r = await prisma.prdIssue.findUnique({ where: { id }, include: { unit: true, lines: { orderBy: { line_no: "asc" } } } });
  if (!r) return null;
  const [trackings, jobs, partai] = await Promise.all([
    trackingsByIds(r.lines.map((l) => l.tracking_id)),
    jobsByIds(r.lines.flatMap((l) => (l.job_id ? [l.job_id] : []))),
    partaiNosByIds(r.lines.flatMap((l) => (l.partai_id ? [l.partai_id] : []))),
  ]);
  return {
    id: r.id,
    no: r.issue_no,
    purpose: issuePurposeOf(r.purpose),
    reason: r.reason,
    date: isoDay(r.issue_date),
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
        partaiNo: l.partai_id ? (partai.get(l.partai_id) ?? null) : null,
        qty: l.qty.toNumber(),
        grams: l.grams?.toNumber() ?? null,
      };
    }),
  };
}

export async function productionIssueNumbersByIds(ids: number[]): Promise<Map<number, string>> {
  const rows = await prisma.prdIssue.findMany({ where: { id: { in: ids } }, select: { id: true, issue_no: true } });
  return new Map(rows.map((r) => [r.id, r.issue_no]));
}
