import "server-only";

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { holdPostingPeriod } from "./fiscal";
import { DAY, Refused, asDate, docTypeId, firstError, fromUnits, isoDay, nextDailyNumber, refusable, text, unitSeries, units } from "./production-doc";
import { availableBuckets, bucketsByIds, decideQcBucket, type BucketView } from "./production-ledger";
import { QC_CHECK_WORKFLOW, type QcDecision } from "./production-execution-workflow";
import { prodDocTransitionAllowed, type ProdDocAction, type ProdDocStatus } from "./production-doc-workflow";

/**
 * QC Check (W65, W77): QC says only go on or redo. One document per Unit and
 * partai (W76), a Job decided whole, every row of it at once (A4.2, W87), no journal: Lulus goes to Stand
 * By, Balik back to Persiapan as a row of its own naming this document (W66).
 * Its tables are `prd_qc_check` and `prd_qc_check_line`.
 *
 * shortcut: a row is one bucket, so two Pengerjaan Unit of the same No. Stok and
 * Job waiting at once are decided as one row. Split the bucket by execution if
 * QC ever needs to decide them apart.
 */

type Db = Prisma.TransactionClient | typeof prisma;

export type QcLineInput = { bucket_id: number | null; decision: QcDecision | "" | null; reason: string };
export type QcInput = { unit_id: number | null; qc_date: string; inspector: string; note: string; lines: QcLineInput[] };
export type QcResult = { ok: true; id: number; no: string } | { ok: false; errors: Record<string, string> };

async function check(db: Db, input: QcInput, strict: boolean) {
  const errors: Record<string, string> = {};
  const unitId = Number(input.unit_id) || null;
  const unit = unitId ? await db.refUnit.findUnique({ where: { id: unitId } }) : null;
  if (!unit) errors.unit_id = "Pilih Unit.";
  else if (!unit.has_qc) errors.unit_id = `${unit.unit_label} tidak punya QC Check.`;
  if (!DAY.test(input.qc_date)) errors.qc_date = "Isi tanggal.";

  const raw = Array.isArray(input.lines) ? input.lines : [];
  const buckets = await bucketsByIds(raw.flatMap((l) => (l.bucket_id ? [Number(l.bucket_id)] : [])), db);
  const lines: { line_no: number; bucket_id: number; qty: number; value: number; decision: QcDecision | null; reason: string | null; bucket: BucketView }[] = [];
  const seen = new Set<number>();
  let partai: number | null | undefined;
  raw.forEach((l, i) => {
    const key = (f: string) => `lines.${i}.${f}`;
    const b = buckets.get(Number(l.bucket_id));
    if (!b || b.unitId !== unitId || b.stage !== "QcCheck" || !(b.qty > 0)) {
      errors[key("bucket_id")] = "Baris ini tidak lagi menunggu QC di unit ini.";
      return;
    }
    if (seen.has(b.id)) return;
    seen.add(b.id);
    if (partai === undefined) partai = b.partaiId;
    else if (partai !== b.partaiId) errors[key("bucket_id")] = "Satu dokumen hanya untuk satu partai.";
    const decision = l.decision === "Pass" || l.decision === "Return" ? l.decision : null;
    if (strict && !decision) errors[key("decision")] = `Putuskan No. Stok ${b.lotNo}.`;
    lines.push({ line_no: lines.length + 1, bucket_id: b.id, qty: fromUnits(units(b.qty)), value: b.value, decision, reason: decision === "Return" ? text(l.reason) : null, bucket: b });
  });
  if (!raw.length) errors._lines = "Pilih barang yang diperiksa.";
  // A Job is decided whole (A4.2): every row of it waiting here, one decision.
  const jobs = new Map<number, typeof lines>();
  for (const l of lines) if (l.bucket.jobId) jobs.set(l.bucket.jobId, [...(jobs.get(l.bucket.jobId) ?? []), l]);
  if (jobs.size && unitId && !errors._lines) {
    const waiting = await availableBuckets({ unitIds: [unitId], stage: "QcCheck" }, db);
    for (const [jobId, rows] of jobs) {
      const missing = waiting.filter((b) => b.jobId === jobId && !rows.some((r) => r.bucket_id === b.id));
      if (missing.length) errors._lines = `No. Job ${rows[0].bucket.jobNo} diperiksa utuh: ${missing.map((b) => b.lotNo).join(", ")} belum ikut.`;
      else if (new Set(rows.map((r) => r.decision)).size > 1) errors._lines = `No. Job ${rows[0].bucket.jobNo} diputuskan sekali untuk seluruh isinya.`;
    }
  }
  if (Object.keys(errors).length) return { ok: false as const, errors };
  return { ok: true as const, data: { unit_id: unitId!, qc_date: asDate(input.qc_date), inspector: text(input.inspector), note: text(input.note) }, unit: unit!, lines };
}

async function audit(db: Db, id: number, action: "TAMBAH" | "UPDATE", event: string, by: number) {
  await db.auditLog.create({ data: { entity_key: "prd_qc_check", row_id: id, action, event, by } });
}

async function nextNo(tx: Prisma.TransactionClient, series: string) {
  const row = await tx.prdQcCheck.findFirst({ where: { qc_no: { startsWith: series } }, orderBy: { qc_no: "desc" }, select: { qc_no: true } });
  return nextDailyNumber(series, row?.qc_no ?? null);
}

const lineRows = (lines: { line_no: number; bucket_id: number; qty: number; value: number; decision: QcDecision | null; reason: string | null }[]) =>
  lines.map(({ line_no, bucket_id, qty, value, decision, reason }) => ({ line_no, bucket_id, qty, value, decision, reason }));

export async function createQcCheck(input: QcInput, actorId: number): Promise<QcResult> {
  const c = await check(prisma, input, false);
  if (!c.ok) return c;
  const made = await prisma.$transaction(async (tx) => {
    const row = await tx.prdQcCheck.create({
      data: { ...c.data, qc_no: await nextNo(tx, unitSeries("QCK", c.unit.unit_label, c.data.qc_date)), created_by: actorId, lines: { create: lineRows(c.lines) } },
    });
    await audit(tx, row.id, "TAMBAH", "create", actorId);
    return row;
  });
  return { ok: true, id: made.id, no: made.qc_no };
}

export async function updateQcCheck(id: number, input: QcInput, actorId: number): Promise<QcResult> {
  const current = await prisma.prdQcCheck.findUnique({ where: { id }, select: { status: true, qc_no: true } });
  if (!current) return { ok: false, errors: { _form: "Dokumen tidak ditemukan." } };
  if (current.status !== "Draft") return { ok: false, errors: { _form: "Hanya Draft yang dapat diubah." } };
  const c = await check(prisma, input, false);
  if (!c.ok) return c;
  const no = await prisma.$transaction(async (tx) => {
    const series = unitSeries("QCK", c.unit.unit_label, c.data.qc_date);
    const qc_no = current.qc_no.startsWith(series) ? current.qc_no : await nextNo(tx, series);
    await tx.prdQcCheckLine.deleteMany({ where: { qc_check_id: id } });
    await tx.prdQcCheck.update({ where: { id }, data: { ...c.data, qc_no, updated_by: actorId, lines: { create: lineRows(c.lines) } } });
    await audit(tx, id, "UPDATE", "edit", actorId);
    return qc_no;
  });
  return { ok: true, id, no };
}

export async function transitionQcCheck(id: number, action: ProdDocAction, actorId: number, reason?: string) {
  const q = await prisma.prdQcCheck.findUnique({ where: { id }, include: { lines: { orderBy: { line_no: "asc" } } } });
  if (!q) return { ok: false as const, errors: { _form: "Dokumen tidak ditemukan." } };
  if (!prodDocTransitionAllowed(QC_CHECK_WORKFLOW, action, q.status as ProdDocStatus)) return { ok: false as const, errors: { _form: "Status dokumen sudah berubah. Muat ulang." } };

  if (action === "cancel") {
    const why = text(reason);
    if (!why) return { ok: false as const, errors: { reason: "Alasan wajib diisi." } };
    await prisma.$transaction(async (tx) => {
      await tx.prdQcCheck.update({ where: { id }, data: { status: "Cancelled", status_reason: why, updated_by: actorId } });
      await audit(tx, id, "UPDATE", "cancel", actorId);
    });
    return { ok: true as const };
  }

  return refusable(async () => {
    await prisma.$transaction(async (tx) => {
      await holdPostingPeriod(tx, isoDay(q.qc_date));
      const c = await check(
        tx,
        {
          unit_id: q.unit_id,
          qc_date: isoDay(q.qc_date),
          inspector: q.inspector ?? "",
          note: q.note ?? "",
          lines: q.lines.map((l) => ({ bucket_id: l.bucket_id, decision: l.decision, reason: l.reason ?? "" })),
        },
        true
      );
      if (!c.ok) throw new Refused({ _form: `Belum bisa diposting: ${firstError(c.errors)}` });
      const done = await tx.prdQcCheck.updateMany({ where: { id, status: "Draft" }, data: { status: "Posted", updated_by: actorId } });
      if (done.count !== 1) throw new Refused({ _form: "Status dokumen sudah berubah. Muat ulang." });
      const source = { docTypeId: await docTypeId(tx, "prd_qc_check"), docId: id, no: q.qc_no };
      for (const stored of q.lines) {
        const moved = await decideQcBucket(tx, {
          bucketId: stored.bucket_id,
          baseQty: stored.qty,
          decision: stored.decision!,
          qcCheckId: id,
          date: c.data.qc_date,
          source,
          actorId,
        });
        await tx.prdQcCheckLine.update({ where: { id: stored.id }, data: { value: moved.value, to_bucket_id: moved.toBucketId } });
      }
      await audit(tx, id, "UPDATE", "post", actorId);
    });
    return { ok: true as const };
  });
}

// ------------------------------------------------------------------- reads

export type QcListRow = { id: number; no: string; date: string; status: ProdDocStatus; unitLabel: string; unitName: string; partaiNo: string | null; lines: number; grams: number };

/** The buckets a Draft of this document names: *Ada di Draft* in the Workspace (P263). */
export async function qcDraftBucketIds(): Promise<number[]> {
  return (await prisma.prdQcCheckLine.findMany({ where: { qc_check: { status: "Draft" } }, select: { bucket_id: true } })).map((r) => r.bucket_id);
}

/** The Unit a document is at, for the actions' Unit check (P260). */
export async function qcCheckUnitId(id: number): Promise<number | null> {
  return (await prisma.prdQcCheck.findUnique({ where: { id }, select: { unit_id: true } }))?.unit_id ?? null;
}

/** `units`: the actor's Units, or null for all (P260). */
export async function listQcChecks(units: number[] | null = null): Promise<QcListRow[]> {
  const rows = await prisma.prdQcCheck.findMany({
    where: units ? { unit_id: { in: units } } : undefined,
    orderBy: [{ qc_date: "desc" }, { id: "desc" }],
    include: { unit: true, lines: { select: { bucket_id: true, qty: true } } },
  });
  const buckets = await bucketsByIds(rows.flatMap((r) => r.lines.map((l) => l.bucket_id)));
  return rows.map((r) => {
    const held = r.lines.map((l) => ({ l, b: buckets.get(l.bucket_id) }));
    return {
      id: r.id,
      no: r.qc_no,
      date: isoDay(r.qc_date),
      status: r.status as ProdDocStatus,
      unitLabel: r.unit.unit_label,
      unitName: r.unit.unit_name,
      partaiNo: held.find((x) => x.b?.partaiNo)?.b?.partaiNo ?? null,
      // A row is a Job, or a No. Stok without one (A4.2).
      lines: new Set(held.map(({ l, b }) => (b?.jobId ? `j${b.jobId}` : `b${l.bucket_id}`))).size,
      grams: held.reduce((a, { l, b }) => a + l.qty.toNumber() * (b?.gramsEach ?? 0), 0),
    };
  });
}

export type QcView = {
  id: number;
  no: string;
  date: string;
  status: ProdDocStatus;
  unitId: number;
  unitLabel: string;
  unitName: string;
  inspector: string | null;
  note: string | null;
  reason: string | null;
  lines: { bucketId: number; qty: number; value: number; decision: QcDecision | null; reason: string | null }[];
};

export async function getQcCheck(id: number): Promise<QcView | null> {
  const q = await prisma.prdQcCheck.findUnique({ where: { id }, include: { unit: true, lines: { orderBy: { line_no: "asc" } } } });
  if (!q) return null;
  return {
    id: q.id,
    no: q.qc_no,
    date: isoDay(q.qc_date),
    status: q.status as ProdDocStatus,
    unitId: q.unit_id,
    unitLabel: q.unit.unit_label,
    unitName: q.unit.unit_name,
    inspector: q.inspector,
    note: q.note,
    reason: q.status_reason,
    lines: q.lines.map((l) => ({ bucketId: l.bucket_id, qty: l.qty.toNumber(), value: l.value.toNumber(), decision: l.decision as QcDecision | null, reason: l.reason })),
  };
}

export type QcRow = Pick<BucketView, "id" | "lotNo" | "itemLabel" | "itemName" | "uomLabel" | "unitId" | "partaiId" | "partaiNo" | "jobId" | "jobNo" | "grams" | "isBjl" | "qty" | "value">;

export type QcOptions = { units: { id: number; label: string; name: string; waiting: number }[]; rows: QcRow[] };

const row = (b: BucketView): QcRow => ({
  id: b.id,
  lotNo: b.lotNo,
  itemLabel: b.itemLabel,
  itemName: b.itemName,
  uomLabel: b.uomLabel,
  unitId: b.unitId,
  partaiId: b.partaiId,
  partaiNo: b.partaiNo,
  jobId: b.jobId,
  jobNo: b.jobNo,
  grams: b.grams,
  isBjl: b.isBjl,
  qty: b.qty,
  value: b.value,
});

export async function qcOptions(keep: number[] = []): Promise<QcOptions> {
  const units = await prisma.refUnit.findMany({ where: { has_qc: true, status: "Active" }, orderBy: { unit_label: "asc" } });
  const buckets = await availableBuckets({ unitIds: units.map((u) => u.id), stage: "QcCheck", withIds: keep });
  return {
    units: units.map((u) => ({ id: u.id, label: u.unit_label, name: u.unit_name, waiting: buckets.filter((b) => b.unitId === u.id && b.stage === "QcCheck").length })),
    rows: buckets.map(row),
  };
}

export async function qcNumbersByIds(ids: number[]): Promise<Map<number, string>> {
  const rows = await prisma.prdQcCheck.findMany({ where: { id: { in: ids } }, select: { id: true, qc_no: true } });
  return new Map(rows.map((r) => [r.id, r.qc_no]));
}
