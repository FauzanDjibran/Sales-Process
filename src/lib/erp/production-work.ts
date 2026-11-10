import "server-only";

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { holdPostingPeriod } from "./fiscal";
import { PostingDryRun, postJournal, type JournalLineInput, type JournalPreviewResult } from "./journal";
import { shareWork } from "./production-execution";
import {
  DAY,
  Refused,
  asDate,
  auxOptions,
  checkAuxLines,
  docTypeId,
  executionJournalLines,
  firstError,
  fourDecimals,
  fromUnits,
  isoDay,
  itemAccounts,
  journalPreview,
  nextDailyNumber,
  parseQty,
  persiapanOptions,
  refusable,
  text,
  unitSeries,
  units,
  type AuxInput,
  type BucketOption,
  type ValueMove,
} from "./production-doc";
import { bucketsByIds, consumeBucket, gramsOf, lockRateVersion, preparationNoteUnits, produceIntoBucket, recordCostEntry, type BucketView } from "./production-ledger";
import { WORK_WORKFLOW } from "./production-execution-workflow";
import { prodDocTransitionAllowed, type ProdDocAction, type ProdDocStatus } from "./production-doc-workflow";

/**
 * Pengerjaan Unit (W74, V2): No. Job picked from Persiapan at a Pass Through
 * Unit, in one partai (W76), each Job with exactly one karyawan. Goods and gram
 * stay; the unit cost and any bahan penolong add value. Its tables are
 * `prd_work` and `prd_work_line`, with the bahan penolong in `prd_aux_use`.
 *
 * A line is one bucket, because one No. Job may hold several No. Stok after
 * grading; the karyawan is stored on each line and must agree within a Job. The
 * karyawan is a record of this work, not of the Job (W26).
 */

type Db = Prisma.TransactionClient | typeof prisma;

export type WorkLineInput = { bucket_id: number | null; qty: number | string; employee_id: number | null };
export type WorkInput = { unit_id: number | null; work_date: string; result_note: string; note: string; lines: WorkLineInput[]; aux: AuxInput[] };
export type WorkResult = { ok: true; id: number; no: string } | { ok: false; errors: Record<string, string> };

async function check(db: Db, input: WorkInput, strict: boolean) {
  const errors: Record<string, string> = {};
  const unitId = Number(input.unit_id) || null;
  const unit = unitId ? await db.refUnit.findUnique({ where: { id: unitId } }) : null;
  if (!unit) errors.unit_id = "Pilih Unit.";
  else if (unit.process !== "PassThrough") errors.unit_id = `${unit.unit_label} bukan unit Pass Through.`;
  else if (unit.status !== "Active") errors.unit_id = `Unit ${unit.unit_label} nonaktif.`;
  if (!DAY.test(input.work_date)) errors.work_date = "Isi tanggal.";

  const raw = Array.isArray(input.lines) ? input.lines : [];
  const buckets = await bucketsByIds(raw.flatMap((l) => (l.bucket_id ? [Number(l.bucket_id)] : [])), db);
  const employees = new Map(
    (await db.mEmployee.findMany({ where: { id: { in: raw.flatMap((l) => (l.employee_id ? [Number(l.employee_id)] : [])) } }, select: { id: true, status: true } })).map((e) => [e.id, e])
  );
  const lines: { line_no: number; bucket_id: number; job_id: number | null; employee_id: number; qty: number; bucket: BucketView }[] = [];
  const workerOfJob = new Map<number, number>();
  const seen = new Set<number>();
  let partai: number | null | undefined;
  raw.forEach((l, i) => {
    const key = (f: string) => `lines.${i}.${f}`;
    const b = buckets.get(Number(l.bucket_id));
    if (!b || b.unitId !== unitId || b.stage !== "Preparation" || b.auxiliary) {
      errors[key("bucket_id")] = "Barang tidak ada di Persiapan unit ini.";
      return;
    }
    if (seen.has(b.id)) {
      errors[key("bucket_id")] = `No. Stok ${b.lotNo} dipilih lebih dari sekali.`;
      return;
    }
    seen.add(b.id);
    // One document, one partai (W76); before a partai the rule does not apply.
    if (partai === undefined) partai = b.partaiId;
    else if ((partai ?? b.partaiId) !== (b.partaiId ?? partai)) errors[key("bucket_id")] = "Satu dokumen hanya untuk satu partai.";
    const qty = parseQty(l.qty);
    if (!(qty > 0)) errors[key("qty")] = "Isi jumlah lebih dari 0.";
    else if (!fourDecimals(qty)) errors[key("qty")] = "Paling banyak 4 angka desimal.";
    else if (units(qty) > units(b.qty)) errors[key("qty")] = `Melebihi saldo (${b.qty} ${b.uomLabel}).`;
    const employeeId = Number(l.employee_id) || 0;
    const employee = employees.get(employeeId);
    if (!employee) errors[key("employee_id")] = b.jobNo ? `Pilih karyawan untuk ${b.jobNo}.` : "Pilih karyawan.";
    else if (employee.status !== "Active") errors[key("employee_id")] = "Karyawan nonaktif.";
    else if (b.jobId) {
      const known = workerOfJob.get(b.jobId);
      if (known && known !== employeeId) errors[key("employee_id")] = `Satu No. Job satu karyawan: ${b.jobNo} sudah punya karyawan lain.`;
      workerOfJob.set(b.jobId, employeeId);
    }
    if (qty > 0 && employee) lines.push({ line_no: lines.length + 1, bucket_id: b.id, job_id: b.jobId, employee_id: employeeId, qty: fromUnits(units(qty)), bucket: b });
  });
  if (strict && !raw.length) errors._lines = "Pilih minimal satu No. Job.";

  const aux = await checkAuxLines(input.aux, unitId, errors, db);
  if (Object.keys(errors).length) return { ok: false as const, errors };
  return {
    ok: true as const,
    data: { unit_id: unitId!, work_date: asDate(input.work_date), result_note: text(input.result_note), note: text(input.note) },
    unit: unit!,
    lines,
    aux,
  };
}

async function audit(db: Db, id: number, action: "TAMBAH" | "UPDATE", event: string, by: number) {
  await db.auditLog.create({ data: { entity_key: "prd_work", row_id: id, action, event, by } });
}

async function nextNo(tx: Prisma.TransactionClient, series: string) {
  const row = await tx.prdWork.findFirst({ where: { work_no: { startsWith: series } }, orderBy: { work_no: "desc" }, select: { work_no: true } });
  return nextDailyNumber(series, row?.work_no ?? null);
}

const lineRows = (lines: { line_no: number; bucket_id: number; job_id: number | null; employee_id: number; qty: number }[]) =>
  lines.map(({ line_no, bucket_id, job_id, employee_id, qty }) => ({ line_no, bucket_id, job_id, employee_id, qty }));

const auxRows = (aux: { line_no: number; bucket_id: number; job_id: number | null; qty: number }[]) => aux.map(({ line_no, bucket_id, job_id, qty }) => ({ line_no, bucket_id, job_id, qty }));

export async function createWork(input: WorkInput, actorId: number): Promise<WorkResult> {
  const c = await check(prisma, input, false);
  if (!c.ok) return c;
  const made = await prisma.$transaction(async (tx) => {
    const row = await tx.prdWork.create({
      data: {
        ...c.data,
        work_no: await nextNo(tx, unitSeries("KRJ", c.unit.unit_label, c.data.work_date)),
        created_by: actorId,
        lines: { create: lineRows(c.lines) },
        aux: { create: auxRows(c.aux) },
      },
    });
    await audit(tx, row.id, "TAMBAH", "create", actorId);
    return row;
  });
  return { ok: true, id: made.id, no: made.work_no };
}

export async function updateWork(id: number, input: WorkInput, actorId: number): Promise<WorkResult> {
  const current = await prisma.prdWork.findUnique({ where: { id }, select: { status: true, work_no: true } });
  if (!current) return { ok: false, errors: { _form: "Dokumen tidak ditemukan." } };
  if (current.status !== "Draft") return { ok: false, errors: { _form: "Hanya Draft yang dapat diubah." } };
  const c = await check(prisma, input, false);
  if (!c.ok) return c;
  const no = await prisma.$transaction(async (tx) => {
    const series = unitSeries("KRJ", c.unit.unit_label, c.data.work_date);
    const work_no = current.work_no.startsWith(series) ? current.work_no : await nextNo(tx, series);
    await tx.prdWorkLine.deleteMany({ where: { work_id: id } });
    await tx.prdAuxUse.deleteMany({ where: { work_id: id } });
    await tx.prdWork.update({ where: { id }, data: { ...c.data, work_no, updated_by: actorId, lines: { create: lineRows(c.lines) }, aux: { create: auxRows(c.aux) } } });
    await audit(tx, id, "UPDATE", "edit", actorId);
    return work_no;
  });
  return { ok: true, id, no };
}

const asInput = (w: Prisma.PrdWorkGetPayload<{ include: { lines: true; aux: true } }>): WorkInput => ({
  unit_id: w.unit_id,
  work_date: isoDay(w.work_date),
  result_note: w.result_note ?? "",
  note: w.note ?? "",
  lines: w.lines.sort((a, b) => a.line_no - b.line_no).map((l) => ({ bucket_id: l.bucket_id, qty: l.qty.toString(), employee_id: l.employee_id })),
  aux: w.aux.sort((a, b) => a.line_no - b.line_no).map((a) => ({ bucket_id: a.bucket_id, qty: a.qty.toString(), job_id: a.job_id })),
});

export async function transitionWork(id: number, action: ProdDocAction, actorId: number, reason?: string, options: { dryRun?: boolean } = {}) {
  const w = await prisma.prdWork.findUnique({ where: { id }, include: { lines: true, aux: true } });
  if (!w) return { ok: false as const, errors: { _form: "Dokumen tidak ditemukan." } };
  if (!prodDocTransitionAllowed(WORK_WORKFLOW, action, w.status as ProdDocStatus)) return { ok: false as const, errors: { _form: "Status dokumen sudah berubah. Muat ulang." } };

  if (action === "cancel") {
    const why = text(reason);
    if (!why) return { ok: false as const, errors: { reason: "Alasan wajib diisi." } };
    await prisma.$transaction(async (tx) => {
      await tx.prdWork.update({ where: { id }, data: { status: "Cancelled", status_reason: why, updated_by: actorId } });
      await audit(tx, id, "UPDATE", "cancel", actorId);
    });
    return { ok: true as const };
  }

  return refusable(async () => {
    await prisma.$transaction(async (tx) => {
      await holdPostingPeriod(tx, isoDay(w.work_date));
      const c = await check(tx, asInput(w), true);
      if (!c.ok) throw new Refused({ _form: `Belum bisa diposting: ${firstError(c.errors)}` });
      const done = await tx.prdWork.updateMany({ where: { id, status: "Draft" }, data: { status: "Posted", updated_by: actorId } });
      if (done.count !== 1) throw new Refused({ _form: "Status dokumen sudah berubah. Muat ulang." });

      const source = { docTypeId: await docTypeId(tx, "prd_work"), docId: id, no: w.work_no };
      const date = c.data.work_date;
      const common = { date, source, actorId };
      const accounts = await itemAccounts([...c.lines.map((l) => l.bucket.itemId), ...c.aux.map((a) => a.bucket.itemId)], ["wip"], null, tx);
      if (!accounts.ok) throw new Refused({ _form: accounts.message });
      const wip = (itemId: number) => accounts.accounts.get(itemId)!.wip;

      // Inputs first: their value is the base each line keeps.
      const worked = [];
      let rate = 0;
      for (const l of c.lines) {
        const input = await consumeBucket(tx, { bucketId: l.bucket_id, baseQty: l.qty, ...common });
        const grams = await gramsOf(tx, { lotId: input.lotId, itemId: input.itemId, qty: l.qty });
        const locked = await lockRateVersion(tx, { lotId: input.lotId, partaiId: input.partaiId, actorId });
        const cost = await recordCostEntry(tx, {
          unitId: c.data.unit_id,
          rateVersionId: locked.rateVersionId,
          lotId: input.lotId,
          partaiId: input.partaiId,
          grams,
          isRework: input.qcCheckId != null,
          ...common,
        });
        rate = cost.rate;
        worked.push({ line: l, input, grams, cost: cost.amount });
      }

      const moves: ValueMove[] = [];
      const aux: { key: string | null; value: number }[] = [];
      let auxValue = 0;
      for (const a of c.aux) {
        const used = await consumeBucket(tx, { bucketId: a.bucket_id, baseQty: a.qty, ...common });
        await tx.prdAuxUse.update({ where: { id: w.aux.find((x) => x.line_no === a.line_no)!.id }, data: { value: used.value } });
        moves.push({ accountId: wip(used.itemId), amount: -used.value });
        aux.push({ key: a.job_id ? String(a.job_id) : null, value: used.value });
        auxValue += used.value;
      }

      const share = shareWork(
        worked.map((x) => ({ key: String(x.line.job_id ?? `b${x.line.bucket_id}`), grams: x.grams.toNumber(), isBjl: x.line.bucket.isBjl, input: x.input.value, cost: x.cost })),
        aux
      );
      const stage = c.unit.has_qc ? ("QcCheck" as const) : ("StandBy" as const);
      for (const [i, x] of worked.entries()) {
        const placed = await produceIntoBucket(tx, {
          lotId: x.input.lotId,
          itemId: x.input.itemId,
          unitId: c.data.unit_id,
          stage,
          partaiId: x.input.partaiId,
          jobId: x.input.jobId,
          baseQty: x.line.qty,
          value: share.values[i],
          ...common,
        });
        await tx.prdWorkLine.update({
          where: { work_id_line_no: { work_id: id, line_no: x.line.line_no } },
          data: { grams: x.grams, input_value: x.input.value, cost_amount: x.cost, aux_value: share.auxValues[i], value: share.values[i], to_bucket_id: placed.bucketId },
        });
        moves.push({ accountId: wip(x.input.itemId), amount: share.values[i] - x.input.value });
      }

      const total = worked.reduce((a, x) => a + x.cost, 0);
      const description = `${w.work_no} · Pengerjaan ${c.unit.unit_label}`;
      const lines = await executionJournalLines(moves, total, share.scrap, description, tx);
      const journal = lines.length ? await postJournal(tx, { description, sourceDocTypeId: source.docTypeId, sourceDocId: id, postingDate: date, actorId, lines }) : null;
      await tx.prdWork.update({ where: { id }, data: { rate, cost_amount: total, aux_value: auxValue, scrap_amount: share.scrap, journal_id: journal?.id ?? null } });
      await audit(tx, id, "UPDATE", "post", actorId);
      if (options.dryRun) throw new PostingDryRun(lines as JournalLineInput[]);
    });
    return { ok: true as const } as { ok: true; journal?: JournalLineInput[] };
  });
}

/** The journal Posting would write: a dry run, rolled back (P103). */
export async function workPreview(id: number, actorId: number): Promise<JournalPreviewResult> {
  return journalPreview(() => transitionWork(id, "post", actorId, undefined, { dryRun: true }));
}

// ------------------------------------------------------------------- reads

export type WorkListRow = { id: number; no: string; date: string; status: ProdDocStatus; unitLabel: string; unitName: string; lines: number; value: number };

/** The Unit a document is at, for the actions' Unit check (P260). */
export async function workUnitId(id: number): Promise<number | null> {
  return (await prisma.prdWork.findUnique({ where: { id }, select: { unit_id: true } }))?.unit_id ?? null;
}

/** `units`: the actor's Units, or null for all (P260). */
export async function listWorks(units: number[] | null = null): Promise<WorkListRow[]> {
  const rows = await prisma.prdWork.findMany({ where: units ? { unit_id: { in: units } } : undefined, orderBy: [{ work_date: "desc" }, { id: "desc" }], include: { unit: true, _count: { select: { lines: true } } } });
  return rows.map((r) => ({
    id: r.id,
    no: r.work_no,
    date: isoDay(r.work_date),
    status: r.status as ProdDocStatus,
    unitLabel: r.unit.unit_label,
    unitName: r.unit.unit_name,
    lines: r._count.lines,
    value: r.cost_amount.add(r.aux_value).toNumber(),
  }));
}

export type WorkView = {
  id: number;
  no: string;
  date: string;
  status: ProdDocStatus;
  unitId: number;
  unitLabel: string;
  unitName: string;
  resultNote: string | null;
  note: string | null;
  reason: string | null;
  rate: number;
  cost: number;
  auxValue: number;
  scrap: number;
  lines: { bucketId: number; employeeId: number; qty: number; grams: number; inputValue: number; costAmount: number; value: number }[];
  aux: { bucketId: number; jobId: number | null; qty: number; value: number }[];
};

export async function getWork(id: number): Promise<WorkView | null> {
  const w = await prisma.prdWork.findUnique({ where: { id }, include: { unit: true, lines: { orderBy: { line_no: "asc" } }, aux: { orderBy: { line_no: "asc" } } } });
  if (!w) return null;
  return {
    id: w.id,
    no: w.work_no,
    date: isoDay(w.work_date),
    status: w.status as ProdDocStatus,
    unitId: w.unit_id,
    unitLabel: w.unit.unit_label,
    unitName: w.unit.unit_name,
    resultNote: w.result_note,
    note: w.note,
    reason: w.status_reason,
    rate: w.rate.toNumber(),
    cost: w.cost_amount.toNumber(),
    auxValue: w.aux_value.toNumber(),
    scrap: w.scrap_amount.toNumber(),
    lines: w.lines.map((l) => ({ bucketId: l.bucket_id, employeeId: l.employee_id, qty: l.qty.toNumber(), grams: l.grams.toNumber(), inputValue: l.input_value.toNumber(), costAmount: l.cost_amount.toNumber(), value: l.value.toNumber() })),
    aux: w.aux.map((a) => ({ bucketId: a.bucket_id, jobId: a.job_id, qty: a.qty.toNumber(), value: a.value.toNumber() })),
  };
}

export type WorkOptions = {
  units: { id: number; label: string; name: string; resultNote: boolean }[];
  inputs: BucketOption[];
  aux: BucketOption[];
  employees: { id: number; label: string; name: string }[];
};

export async function workOptions(keep: number[] = []): Promise<WorkOptions> {
  const units = await prisma.refUnit.findMany({ where: { process: "PassThrough", status: "Active" }, orderBy: { unit_label: "asc" } });
  const ids = units.map((u) => u.id);
  const [inputs, aux, employees, noted] = await Promise.all([
    persiapanOptions(ids, keep),
    auxOptions(ids, keep),
    prisma.mEmployee.findMany({ where: { status: "Active" }, orderBy: { employee_label: "asc" } }),
    preparationNoteUnits(),
  ]);
  return {
    units: units.map((u) => ({ id: u.id, label: u.unit_label, name: u.unit_name, resultNote: noted.has(u.id) })),
    inputs,
    aux,
    employees: employees.map((e) => ({ id: e.id, label: e.employee_label, name: e.employee_name })),
  };
}

/** The result notes of the Jobs a Dokumen Grading reads (W42), newest first. */
export async function resultNotesOfJobs(jobIds: number[]): Promise<Map<number, string[]>> {
  if (!jobIds.length) return new Map();
  const rows = await prisma.prdWorkLine.findMany({
    where: { job_id: { in: jobIds }, work: { status: "Posted", result_note: { not: null } } },
    orderBy: { id: "desc" },
    select: { job_id: true, work: { select: { result_note: true } } },
  });
  const out = new Map<number, string[]>();
  for (const r of rows) {
    const list = out.get(r.job_id!) ?? [];
    if (!list.includes(r.work.result_note!)) list.push(r.work.result_note!);
    out.set(r.job_id!, list);
  }
  return out;
}

export async function workNumbersByIds(ids: number[]): Promise<Map<number, string>> {
  const rows = await prisma.prdWork.findMany({ where: { id: { in: ids } }, select: { id: true, work_no: true } });
  return new Map(rows.map((r) => [r.id, r.work_no]));
}
