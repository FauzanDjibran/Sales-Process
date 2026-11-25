import "server-only";

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { holdPostingPeriod } from "./fiscal";
import { DAY, Refused, asDate, docTypeId, fourDecimals, fromUnits, isoDay, postToErp, nextDailyNumber, parseQty, refusable, text, unitSeries, units as scaled, type ValueMove } from "./production-doc";
import {
  availableBuckets,
  bucketsByIds,
  consumeBucket,
  gramsOf,
  issueJob,
  linkTracking,
  lockRateVersion,
  produceIntoBucket,
  recordTrackingInfo,
  registerDerivedStock,
  trackingsByIds,
  unitStepsOf,
  type BucketView,
} from "./production-ledger";

/**
 * Job Order (P283, T7): at a Unit's Job Order step (Moulding), several No. Stok —
 * in part, if wanted — and one target jenis become **one new No. Stok**
 * `<largest input>-<n>` with **its own No. Job** and Job Order number `JO_<job no>`.
 * Gram is unchanged and no Unit rate is charged here (P281: Moulding charges at
 * Assign). Value is what the inputs carried; a journal only moves it between WIP
 * accounts when they differ. Posted in one step, never a Draft; one partai.
 */

type Db = Prisma.TransactionClient | typeof prisma;
const GRAM = "GR";

export type JobOrderPart = { bucket_id: number | null; qty: number | string };
export type JobOrderLineInput = { target_item_id: number | null; parts: JobOrderPart[] };
export type JobOrderInput = { unit_id: number | null; doc_date: string; note: string; lines: JobOrderLineInput[] };
export type JobOrderResult = { ok: true; id: number; no: string } | { ok: false; errors: Record<string, string> };

async function check(db: Db, input: JobOrderInput) {
  const errors: Record<string, string> = {};
  const unitId = Number(input.unit_id) || null;
  const unit = unitId ? await db.refUnit.findUnique({ where: { id: unitId } }) : null;
  const step = unit ? (await unitStepsOf(db, unit.id)).find((s) => s.process === "JobOrder") : undefined;
  if (!unit) errors.unit_id = "Pilih Unit.";
  else if (!step) errors.unit_id = `${unit.unit_label} tidak punya proses Job Order.`;
  if (!DAY.test(input.doc_date)) errors.doc_date = "Isi tanggal.";

  const raw = Array.isArray(input.lines) ? input.lines : [];
  if (!raw.length) errors._lines = "Buat minimal satu Job.";
  const bucketIds = raw.flatMap((l) => (Array.isArray(l.parts) ? l.parts : []).flatMap((p) => (p.bucket_id ? [Number(p.bucket_id)] : [])));
  const buckets = await bucketsByIds(bucketIds, db);
  const targets = new Map(
    (
      await db.mItem.findMany({
        where: { id: { in: raw.flatMap((l) => (l.target_item_id ? [Number(l.target_item_id)] : [])) } },
        select: { id: true, item_type: true, status: true, item_label: true, base_uom: { select: { uom_label: true } } },
      })
    ).map((i) => [i.id, i])
  );
  const takenOf = new Map<number, number>();
  const lines: { line_no: number; targetId: number; parts: { bucket: BucketView; qty: number }[] }[] = [];
  raw.forEach((l, i) => {
    const key = (f: string) => `lines.${i}.${f}`;
    const t = targets.get(Number(l.target_item_id));
    if (!t) errors[key("target_item_id")] = "Pilih jenis.";
    else if (t.status !== "Active" || t.item_type !== "Barang") errors[key("target_item_id")] = `${t.item_label} tidak aktif.`;
    else if (t.base_uom.uom_label !== GRAM) errors[key("target_item_id")] = `${t.item_label} tidak bersatuan gram.`;
    const parts: { bucket: BucketView; qty: number }[] = [];
    for (const [k, p] of (Array.isArray(l.parts) ? l.parts : []).entries()) {
      const b = buckets.get(Number(p.bucket_id));
      if (!b || b.unitId !== unit?.id || b.stage !== "Preparation" || b.stepId !== step?.id || b.auxiliary || !(b.qty > 0)) {
        errors[`lines.${i}.parts.${k}`] = "Barang ini tidak lagi di Persiapan Job Order unit ini.";
        continue;
      }
      const qty = parseQty(p.qty);
      if (!(qty > 0) || !fourDecimals(qty)) {
        errors[`lines.${i}.parts.${k}`] = "Isi gram lebih dari 0, paling banyak 4 desimal.";
        continue;
      }
      const sum = (takenOf.get(b.id) ?? 0) + scaled(qty);
      if (sum > scaled(b.qty)) {
        errors[`lines.${i}.parts.${k}`] = `${b.lotNo} melebihi saldo (${b.qty} ${b.uomLabel}).`;
        continue;
      }
      takenOf.set(b.id, sum);
      parts.push({ bucket: b, qty: fromUnits(scaled(qty)) });
    }
    if (!parts.length && !errors[key("target_item_id")]) errors[key("target_item_id")] = "Pilih No. Stok yang dicampur.";
    if (t && parts.length) lines.push({ line_no: lines.length + 1, targetId: t.id, parts });
  });
  if (!unit || !step || Object.keys(errors).length) return { ok: false as const, errors };
  const all = lines.flatMap((l) => l.parts);
  if (new Set(all.map((p) => p.bucket.partaiId)).size > 1) return { ok: false as const, errors: { _lines: "Satu dokumen hanya untuk satu partai." } };
  return { ok: true as const, unit, step, lines, partaiId: all[0].bucket.partaiId, date: asDate(input.doc_date), note: text(input.note) };
}

async function nextNo(tx: Prisma.TransactionClient, series: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${series}))`;
  const row = await tx.prdJobOrder.findFirst({ where: { job_order_doc_no: { startsWith: series } }, orderBy: { job_order_doc_no: "desc" }, select: { job_order_doc_no: true } });
  return nextDailyNumber(series, row?.job_order_doc_no ?? null);
}

/** Posts the document: each line takes its parts, makes its No. Stok and Job, and places it after the step. */
export async function postJobOrder(input: JobOrderInput, actorId: number): Promise<JobOrderResult> {
  const first = await check(prisma, input);
  if (!first.ok) return first;
  return refusable(async () =>
    prisma.$transaction(async (tx) => {
      await holdPostingPeriod(tx, input.doc_date);
      const c = await check(tx, input);
      if (!c.ok) throw new Refused(c.errors);
      const no = await nextNo(tx, unitSeries("JOD", c.unit.unit_label, c.date));
      const header = await tx.prdJobOrder.create({ data: { job_order_doc_no: no, doc_date: c.date, unit_id: c.unit.id, unit_step_id: c.step.id, partai_id: c.partaiId, note: c.note, created_by: actorId } });
      const source = { docTypeId: await docTypeId(tx, "prd_job_order"), docId: header.id, no };
      const common = { date: c.date, source, actorId };
      const moves: ValueMove[] = [];

      for (const l of c.lines) {
        const taken = [];
        for (const p of l.parts) {
          const t = await consumeBucket(tx, { bucketId: p.bucket.id, baseQty: p.qty, ...common });
          const grams = (await gramsOf(tx, { lotId: t.lotId, itemId: t.itemId, qty: p.qty })).toNumber();
          const locked = await lockRateVersion(tx, { lotId: t.lotId, partaiId: t.partaiId, actorId });
          moves.push({ itemId: t.itemId, amount: -t.value });
          taken.push({ bucketId: p.bucket.id, lotId: t.lotId, qty: p.qty, grams, value: t.value, ...locked });
        }
        // The new No. Stok is numbered from the input that gave the most gram (T7).
        const parent = taken.reduce((a, b) => (b.grams > a.grams ? b : a));
        const grams = taken.reduce((a, t) => a + t.grams, 0);
        const value = taken.reduce((a, t) => a + t.value, 0);
        const made = await registerDerivedStock(tx, { parentLotId: parent.lotId, itemId: l.targetId, ...common });
        await recordTrackingInfo(tx, { lotId: made.id, grams, form: "Bulk", rateVersionId: parent.rateVersionId, routingId: parent.routingId, actorId });
        const job = await issueJob(tx, { unitId: c.unit.id, lotId: made.id, partaiId: c.partaiId, ...common });
        const placed = await produceIntoBucket(tx, { lotId: made.id, itemId: l.targetId, unitId: c.unit.id, afterStepId: c.step.id, partaiId: c.partaiId, jobId: job.id, baseQty: grams, value, ...common });
        for (const t of taken) await linkTracking(tx, { fromBucketId: t.bucketId, fromLotId: t.lotId, toLotId: made.id, qty: t.qty, value: t.value, source });
        moves.push({ itemId: l.targetId, amount: value });
        await tx.prdJobOrderLine.create({
          data: {
            job_order_id: header.id,
            line_no: l.line_no,
            target_item_id: l.targetId,
            job_order_no: `JO_${job.no}`,
            grams,
            base_cost_amount: value,
            job_id: job.id,
            tracking_id: made.id,
            tracking_no: made.no,
            to_bucket_id: placed.bucketId,
            inputs: { create: taken.map((t) => ({ bucket_id: t.bucketId, tracking_id: t.lotId, qty: t.qty, grams: t.grams, base_cost_amount: t.value })) },
          },
        });
      }

      const posted = await postToErp(tx, { source, docTable: "prd_job_order", date: c.date, description: `${no} · Job Order ${c.unit.unit_label}`, moves, costs: [], actorId });
      if (posted.journalId) await tx.prdJobOrder.update({ where: { id: header.id }, data: { journal_id: posted.journalId } });
      await tx.auditLog.create({ data: { entity_key: "prd_job_order", row_id: header.id, action: "TAMBAH", event: "post", by: actorId } });
      return { ok: true as const, id: header.id, no };
    })
  );
}

// -------------------------------------------------------------------- reads

export type JobOrderRow = { id: number; no: string; date: string; unitId: number; unitLabel: string; unitName: string; partaiNo: string | null; lines: number; grams: number };

export async function listJobOrders(units: number[] | null = null): Promise<JobOrderRow[]> {
  const rows = await prisma.prdJobOrder.findMany({
    where: units ? { unit_id: { in: units } } : undefined,
    orderBy: [{ doc_date: "desc" }, { id: "desc" }],
    include: { unit: true, partai: { select: { partai_no: true } }, lines: { select: { grams: true } } },
  });
  return rows.map((r) => ({
    id: r.id,
    no: r.job_order_doc_no,
    date: isoDay(r.doc_date),
    unitId: r.unit_id,
    unitLabel: r.unit.unit_label,
    unitName: r.unit.unit_name,
    partaiNo: r.partai?.partai_no ?? null,
    lines: r.lines.length,
    grams: r.lines.reduce((a, l) => a + l.grams.toNumber(), 0),
  }));
}

export type JobOrderView = JobOrderRow & {
  note: string | null;
  items: { lineNo: number; jobOrderNo: string; jobNo: string; trackingNo: string; targetLabel: string; targetName: string; grams: number; from: { lotNo: string; grams: number }[] }[];
};

export async function getJobOrder(id: number): Promise<JobOrderView | null> {
  const j = await prisma.prdJobOrder.findUnique({
    where: { id },
    include: { unit: true, partai: { select: { partai_no: true } }, lines: { orderBy: { line_no: "asc" }, include: { job: { select: { job_no: true } }, target: { select: { item_label: true, item_name: true } }, inputs: true } } },
  });
  if (!j) return null;
  const lots = await trackingsByIds(j.lines.flatMap((l) => l.inputs.map((i) => i.tracking_id)));
  return {
    id: j.id,
    no: j.job_order_doc_no,
    date: isoDay(j.doc_date),
    unitId: j.unit_id,
    unitLabel: j.unit.unit_label,
    unitName: j.unit.unit_name,
    partaiNo: j.partai?.partai_no ?? null,
    lines: j.lines.length,
    grams: j.lines.reduce((a, l) => a + l.grams.toNumber(), 0),
    note: j.note,
    items: j.lines.map((l) => ({
      lineNo: l.line_no,
      jobOrderNo: l.job_order_no,
      jobNo: l.job.job_no,
      trackingNo: l.tracking_no,
      targetLabel: l.target.item_label,
      targetName: l.target.item_name,
      grams: l.grams.toNumber(),
      from: l.inputs.map((i) => ({ lotNo: lots.get(i.tracking_id)?.no ?? "", grams: i.grams.toNumber() })),
    })),
  };
}

export async function jobOrderNumbersByIds(ids: number[]): Promise<Map<number, string>> {
  const rows = await prisma.prdJobOrder.findMany({ where: { id: { in: ids } }, select: { id: true, job_order_doc_no: true } });
  return new Map(rows.map((r) => [r.id, r.job_order_doc_no]));
}

export type JobOrderOptions = { unit: { id: number; label: string; name: string }; buckets: BucketView[]; targets: { id: number; label: string; name: string }[] };

/** What waits at a Unit's Job Order step, and the jenis it may become: the form. */
export async function jobOrderOptions(unitId: number): Promise<JobOrderOptions | null> {
  const unit = await prisma.refUnit.findUnique({ where: { id: unitId }, select: { id: true, unit_label: true, unit_name: true } });
  if (!unit) return null;
  const step = (await unitStepsOf(prisma, unitId)).find((s) => s.process === "JobOrder");
  if (!step) return null;
  const [buckets, targets] = await Promise.all([
    availableBuckets({ unitIds: [unitId], stage: "Preparation" }),
    prisma.mItem.findMany({ where: { status: "Active", item_type: "Barang", track_stock: true, is_bjl: false, base_uom: { uom_label: GRAM } }, orderBy: { item_label: "asc" }, select: { id: true, item_label: true, item_name: true } }),
  ]);
  return {
    unit: { id: unit.id, label: unit.unit_label, name: unit.unit_name },
    buckets: buckets.filter((b) => b.stepId === step.id && !b.auxiliary && b.qty > 0),
    targets: targets.map((t) => ({ id: t.id, label: t.item_label, name: t.item_name })),
  };
}
