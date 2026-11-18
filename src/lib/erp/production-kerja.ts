import "server-only";

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { holdPostingPeriod } from "./fiscal";
import { postJournal } from "./journal";
import { DAY, Refused, asDate, docTypeId, executionJournalLines, isoDay, itemAccounts, nextDailyNumber, refusable, text, unitSeries, type ValueMove } from "./production-doc";
import { availableBuckets, bucketsByIds, gramsOf, lockRateVersion, moveKerja, recordCostEntry, trackingsByIds, unitStepsOf, type BucketView } from "./production-ledger";

/**
 * Kerja (P282, T13): the process of a Unit worked over time, as Cleaning is.
 * **Mulai** takes Jobs whole from the Persiapan of the Unit's Kerja step into
 * *Sedang Dikerjakan*, each with one karyawan. **Selesai** moves a line on to
 * what follows the step — the next Persiapan, QC Check or Stand By — and, when
 * Kerja is the Unit's last step, charges the Unit rate (P281) with a journal
 * Dr WIP / Cr Biaya Produksi Dibebankan. **Batal Mulai** sends a line back to
 * Persiapan at no cost. Gram never changes. No Draft: Mulai makes the document.
 */

type Db = Prisma.TransactionClient | typeof prisma;

import type { KerjaStatus } from "./production-kerja-shape";
export { KERJA_STATUS_TEXT, type KerjaStatus } from "./production-kerja-shape";

export type KerjaLineInput = { bucket_id: number | null; employee_id: number | null };
export type KerjaInput = { unit_id: number | null; kerja_date: string; note: string; lines: KerjaLineInput[] };
export type KerjaResult = { ok: true; id: number; no: string } | { ok: false; errors: Record<string, string> };
type CloseResult = { ok: true; lines: number; cost: number } | { ok: false; errors: Record<string, string> };

async function check(db: Db, input: KerjaInput) {
  const errors: Record<string, string> = {};
  const unitId = Number(input.unit_id) || null;
  const unit = unitId ? await db.refUnit.findUnique({ where: { id: unitId } }) : null;
  const step = unit ? (await unitStepsOf(db, unit.id)).find((s) => s.process === "Kerja") : undefined;
  if (!unit) errors.unit_id = "Pilih Unit.";
  else if (!step) errors.unit_id = `${unit.unit_label} tidak punya proses Kerja.`;
  if (!DAY.test(input.kerja_date)) errors.kerja_date = "Isi tanggal.";

  const raw = Array.isArray(input.lines) ? input.lines : [];
  if (!raw.length) errors._lines = "Pilih Job yang dikerjakan.";
  const buckets = await bucketsByIds(raw.flatMap((l) => (l.bucket_id ? [Number(l.bucket_id)] : [])), db);
  const employees = new Map(
    (await db.mEmployee.findMany({ where: { id: { in: raw.flatMap((l) => (l.employee_id ? [Number(l.employee_id)] : [])) } }, select: { id: true, status: true } })).map((e) => [e.id, e])
  );
  const rows: { line_no: number; bucket: BucketView; employeeId: number }[] = [];
  const seen = new Set<number>();
  const workerOfJob = new Map<number, number>();
  raw.forEach((l, i) => {
    const key = (f: string) => `lines.${i}.${f}`;
    const b = buckets.get(Number(l.bucket_id));
    if (!b || b.unitId !== unit?.id || b.stage !== "Preparation" || b.stepId !== step?.id || b.auxiliary || !(b.qty > 0)) {
      errors[key("bucket_id")] = "Barang ini tidak lagi di Persiapan Kerja unit ini.";
      return;
    }
    if (seen.has(b.id)) {
      errors[key("bucket_id")] = `No. Stok ${b.lotNo} dipilih lebih dari sekali.`;
      return;
    }
    seen.add(b.id);
    const emp = employees.get(Number(l.employee_id));
    if (!emp) errors[key("employee_id")] = "Pilih karyawan.";
    else if (emp.status !== "Active") errors[key("employee_id")] = "Karyawan nonaktif.";
    else if (b.jobId && workerOfJob.has(b.jobId) && workerOfJob.get(b.jobId) !== emp.id) errors[key("employee_id")] = `No. Job ${b.jobNo} dikerjakan satu karyawan.`;
    else {
      if (b.jobId) workerOfJob.set(b.jobId, emp.id);
      rows.push({ line_no: rows.length + 1, bucket: b, employeeId: emp.id });
    }
  });
  if (!unit || !step || Object.keys(errors).length) return { ok: false as const, errors };

  // A Job goes in whole: every No. Stok of it waiting at this step (W96).
  const jobIds = [...new Set(rows.flatMap((r) => (r.bucket.jobId ? [r.bucket.jobId] : [])))];
  if (jobIds.length) {
    const held = (await availableBuckets({ unitIds: [unit.id], stage: "Preparation" }, db)).filter((b) => b.stepId === step.id && b.jobId && jobIds.includes(b.jobId) && !b.auxiliary && b.qty > 0);
    const short = held.find((b) => !rows.some((r) => r.bucket.id === b.id));
    if (short) errors._lines = `No. Job ${short.jobNo} dikerjakan utuh: ${short.lotNo} belum ikut.`;
  }
  if (!errors._lines && new Set(rows.map((r) => r.bucket.partaiId)).size > 1) errors._lines = "Satu dokumen hanya untuk satu partai.";
  if (Object.keys(errors).length) return { ok: false as const, errors };
  return { ok: true as const, unit, step, rows, partaiId: rows[0].bucket.partaiId, date: asDate(input.kerja_date), note: text(input.note) };
}

async function nextNo(tx: Prisma.TransactionClient, series: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${series}))`;
  const row = await tx.prdKerja.findFirst({ where: { kerja_no: { startsWith: series } }, orderBy: { kerja_no: "desc" }, select: { kerja_no: true } });
  return nextDailyNumber(series, row?.kerja_no ?? null);
}

async function audit(db: Db, id: number, action: "TAMBAH" | "UPDATE", event: string, by: number) {
  await db.auditLog.create({ data: { entity_key: "prd_kerja", row_id: id, action, event, by } });
}

/** Mulai: the document is made and its Jobs move into Sedang Dikerjakan. */
export async function startKerja(input: KerjaInput, actorId: number): Promise<KerjaResult> {
  const first = await check(prisma, input);
  if (!first.ok) return first;
  return refusable(async () =>
    prisma.$transaction(async (tx) => {
      await holdPostingPeriod(tx, input.kerja_date);
      const c = await check(tx, input);
      if (!c.ok) throw new Refused(c.errors);
      const no = await nextNo(tx, unitSeries("KJ", c.unit.unit_label, c.date));
      const header = await tx.prdKerja.create({
        data: { kerja_no: no, kerja_date: c.date, unit_id: c.unit.id, unit_step_id: c.step.id, partai_id: c.partaiId, note: c.note, created_by: actorId },
      });
      const source = { docTypeId: await docTypeId(tx, "prd_kerja"), docId: header.id, no };
      for (const r of c.rows) {
        const moved = await moveKerja(tx, { bucketId: r.bucket.id, move: "start", date: c.date, source, actorId });
        await tx.prdKerjaLine.create({
          data: {
            kerja_id: header.id,
            line_no: r.line_no,
            from_bucket_id: r.bucket.id,
            work_bucket_id: moved.toBucketId,
            tracking_id: r.bucket.lotId,
            job_id: r.bucket.jobId,
            employee_id: r.employeeId,
            qty: moved.qty,
            grams: r.bucket.gramsEach != null ? moved.qty * r.bucket.gramsEach : null,
            is_rework: r.bucket.qcCheckId != null,
            value: moved.value,
          },
        });
      }
      await audit(tx, header.id, "TAMBAH", "start", actorId);
      return { ok: true as const, id: header.id, no };
    })
  );
}

/** The open lines on these Sedang Dikerjakan buckets, grouped by their document. */
async function openLines(db: Db, bucketIds: number[]) {
  return db.prdKerjaLine.findMany({
    where: { work_bucket_id: { in: bucketIds }, finished_at: null, cancelled_at: null },
    orderBy: [{ kerja_id: "asc" }, { line_no: "asc" }],
    include: { kerja: { include: { unit: true } } },
  });
}

async function settleStatus(tx: Prisma.TransactionClient, kerjaIds: number[], actorId: number) {
  for (const id of kerjaIds) {
    const lines = await tx.prdKerjaLine.findMany({ where: { kerja_id: id }, select: { finished_at: true, cancelled_at: true } });
    if (lines.some((l) => !l.finished_at && !l.cancelled_at)) continue;
    const status: KerjaStatus = lines.some((l) => l.finished_at) ? "Finished" : "Cancelled";
    await tx.prdKerja.update({ where: { id }, data: { status, updated_by: actorId } });
  }
}

/**
 * Selesai or Batal Mulai of Sedang Dikerjakan buckets (the Workspace's ticked rows).
 * A bucket moves whole; every open line on it closes together.
 */
export async function closeKerja(bucketIds: number[], how: "finish" | "cancel", date: string, actorId: number, units: number[] | null = null): Promise<CloseResult> {
  if (!bucketIds.length) return { ok: false, errors: { _form: "Pilih Job yang Sedang Dikerjakan." } };
  if (!DAY.test(date)) return { ok: false, errors: { _form: "Isi tanggal." } };
  return refusable(async () =>
    prisma.$transaction(async (tx) => {
      await holdPostingPeriod(tx, date);
      const lines = await openLines(tx, bucketIds);
      const found = new Set(lines.map((l) => l.work_bucket_id));
      if (bucketIds.some((id) => !found.has(id))) throw new Refused({ _form: "Sebagian Job tidak lagi Sedang Dikerjakan. Muat ulang." });
      if (units && lines.some((l) => !units.includes(l.kerja.unit_id))) throw new Refused({ _form: "Unit ini bukan Unit Anda." });
      const on = asDate(date);
      const now = new Date();
      let cost = 0;
      for (const kerjaId of [...new Set(lines.map((l) => l.kerja_id))]) {
        const mine = lines.filter((l) => l.kerja_id === kerjaId);
        const k = mine[0].kerja;
        if (date < isoDay(k.kerja_date)) throw new Refused({ _form: `Tanggal tidak boleh sebelum Mulai ${k.kerja_no}.` });
        const source = { docTypeId: await docTypeId(tx, "prd_kerja"), docId: k.id, no: k.kerja_no };
        const moves: ValueMove[] = [];
        let docCost = 0;
        for (const bucketId of [...new Set(mine.map((l) => l.work_bucket_id!))]) {
          const group = mine.filter((l) => l.work_bucket_id === bucketId);
          const costs: number[] = [];
          if (how === "finish") {
            for (const l of group) {
              const bucket = (await bucketsByIds([bucketId], tx)).get(bucketId)!;
              const grams = await gramsOf(tx, { lotId: l.tracking_id, itemId: bucket.itemId, qty: l.qty });
              const locked = await lockRateVersion(tx, { lotId: l.tracking_id, partaiId: bucket.partaiId, actorId });
              const c = await recordCostEntry(tx, { unitId: k.unit_id, stepId: k.unit_step_id, rateVersionId: locked.rateVersionId, lotId: l.tracking_id, partaiId: bucket.partaiId, grams, isRework: l.is_rework, date: on, source, actorId });
              costs.push(c.amount);
            }
          }
          const added = costs.reduce((a, x) => a + x, 0);
          const moved = await moveKerja(tx, { bucketId, move: how, addValue: added, date: on, source, actorId });
          if (added) {
            const itemId = (await bucketsByIds([moved.toBucketId], tx)).get(moved.toBucketId)!.itemId;
            const accounts = await itemAccounts([itemId], ["wip"], null, tx);
            if (!accounts.ok) throw new Refused({ _form: accounts.message });
            moves.push({ accountId: accounts.accounts.get(itemId)!.wip, amount: added });
          }
          for (const [i, l] of group.entries()) {
            await tx.prdKerjaLine.update({
              where: { id: l.id },
              data: how === "finish" ? { finished_at: now, cost_amount: costs[i] ?? 0, to_bucket_id: moved.toBucketId, closed_by: actorId } : { cancelled_at: now, to_bucket_id: moved.toBucketId, closed_by: actorId },
            });
          }
          docCost += added;
        }
        if (docCost) {
          const description = `${k.kerja_no} · Kerja ${k.unit.unit_label}`;
          const jl = await executionJournalLines(moves, docCost, 0, description, tx);
          const journal = await postJournal(tx, { description, sourceDocTypeId: source.docTypeId, sourceDocId: k.id, postingDate: on, actorId, lines: jl });
          await tx.prdKerjaLine.updateMany({ where: { id: { in: mine.map((l) => l.id) } }, data: { journal_id: journal.id } });
        }
        cost += docCost;
        await audit(tx, k.id, "UPDATE", how === "finish" ? "finish" : "cancel_start", actorId);
      }
      await settleStatus(tx, [...new Set(lines.map((l) => l.kerja_id))], actorId);
      return { ok: true as const, lines: lines.length, cost };
    })
  );
}

// -------------------------------------------------------------------- reads

export type KerjaRow = { id: number; no: string; date: string; status: KerjaStatus; unitId: number; unitLabel: string; unitName: string; partaiNo: string | null; lines: number; open: number; grams: number };

export async function listKerjas(units: number[] | null = null): Promise<KerjaRow[]> {
  const rows = await prisma.prdKerja.findMany({
    where: units ? { unit_id: { in: units } } : undefined,
    orderBy: [{ kerja_date: "desc" }, { id: "desc" }],
    include: { unit: true, partai: { select: { partai_no: true } }, lines: { select: { grams: true, finished_at: true, cancelled_at: true } } },
  });
  return rows.map((r) => ({
    id: r.id,
    no: r.kerja_no,
    date: isoDay(r.kerja_date),
    status: r.status,
    unitId: r.unit_id,
    unitLabel: r.unit.unit_label,
    unitName: r.unit.unit_name,
    partaiNo: r.partai?.partai_no ?? null,
    lines: r.lines.length,
    open: r.lines.filter((l) => !l.finished_at && !l.cancelled_at).length,
    grams: r.lines.reduce((a, l) => a + (l.grams?.toNumber() ?? 0), 0),
  }));
}

export type KerjaView = KerjaRow & {
  note: string | null;
  items: { lineNo: number; lotNo: string; itemLabel: string; itemName: string; jobNo: string | null; employee: string; qty: number; uomLabel: string; grams: number | null; startedAt: string; finishedAt: string | null; cancelledAt: string | null; rework: boolean }[];
};

export async function getKerja(id: number): Promise<KerjaView | null> {
  const k = await prisma.prdKerja.findUnique({
    where: { id },
    include: { unit: true, partai: { select: { partai_no: true } }, lines: { orderBy: { line_no: "asc" }, include: { job: { select: { job_no: true } }, employee: { select: { employee_name: true } } } } },
  });
  if (!k) return null;
  const byId = await trackingsByIds(k.lines.map((l) => l.tracking_id));
  const iso = (d: Date | null) => (d ? d.toISOString() : null);
  return {
    id: k.id,
    no: k.kerja_no,
    date: isoDay(k.kerja_date),
    status: k.status,
    unitId: k.unit_id,
    unitLabel: k.unit.unit_label,
    unitName: k.unit.unit_name,
    partaiNo: k.partai?.partai_no ?? null,
    lines: k.lines.length,
    open: k.lines.filter((l) => !l.finished_at && !l.cancelled_at).length,
    grams: k.lines.reduce((a, l) => a + (l.grams?.toNumber() ?? 0), 0),
    note: k.note,
    items: k.lines.map((l) => {
      const x = byId.get(l.tracking_id);
      return {
        lineNo: l.line_no,
        lotNo: x?.no ?? "",
        itemLabel: x?.itemLabel ?? "",
        itemName: x?.itemName ?? "",
        jobNo: l.job?.job_no ?? null,
        employee: l.employee.employee_name,
        qty: l.qty.toNumber(),
        uomLabel: x?.uomLabel ?? "",
        grams: l.grams?.toNumber() ?? null,
        startedAt: l.started_at.toISOString(),
        finishedAt: iso(l.finished_at),
        cancelledAt: iso(l.cancelled_at),
        rework: l.is_rework,
      };
    }),
  };
}

export async function kerjaNumbersByIds(ids: number[]): Promise<Map<number, string>> {
  const rows = await prisma.prdKerja.findMany({ where: { id: { in: ids } }, select: { id: true, kerja_no: true } });
  return new Map(rows.map((r) => [r.id, r.kerja_no]));
}

export async function kerjaUnitId(id: number): Promise<number | null> {
  return (await prisma.prdKerja.findUnique({ where: { id }, select: { unit_id: true } }))?.unit_id ?? null;
}

/** Who works each Sedang Dikerjakan bucket and since when: the Workspace's Keterangan. */
export async function runningByBuckets(bucketIds: number[]): Promise<Map<number, { no: string; employee: string; since: string }>> {
  if (!bucketIds.length) return new Map();
  const rows = await prisma.prdKerjaLine.findMany({
    where: { work_bucket_id: { in: bucketIds }, finished_at: null, cancelled_at: null },
    include: { kerja: { select: { kerja_no: true } }, employee: { select: { employee_name: true } } },
  });
  return new Map(rows.map((r) => [r.work_bucket_id!, { no: r.kerja.kerja_no, employee: r.employee.employee_name, since: r.started_at.toISOString() }]));
}

export type KerjaOptions = { unit: { id: number; label: string; name: string }; buckets: BucketView[]; employees: { id: number; label: string; name: string }[] };

/** What waits at a Unit's Kerja step, and who may work it: the Mulai form. */
export async function kerjaOptions(unitId: number): Promise<KerjaOptions | null> {
  const unit = await prisma.refUnit.findUnique({ where: { id: unitId }, select: { id: true, unit_label: true, unit_name: true } });
  if (!unit) return null;
  const step = (await unitStepsOf(prisma, unitId)).find((s) => s.process === "Kerja");
  if (!step) return null;
  const [buckets, employees] = await Promise.all([
    availableBuckets({ unitIds: [unitId], stage: "Preparation" }),
    prisma.mEmployee.findMany({ where: { status: "Active" }, orderBy: { employee_name: "asc" }, select: { id: true, employee_label: true, employee_name: true } }),
  ]);
  return {
    unit: { id: unit.id, label: unit.unit_label, name: unit.unit_name },
    buckets: buckets.filter((b) => b.stepId === step.id && !b.auxiliary && b.qty > 0),
    employees: employees.map((e) => ({ id: e.id, label: e.employee_label, name: e.employee_name })),
  };
}
