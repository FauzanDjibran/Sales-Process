import "server-only";

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { holdPostingPeriod } from "./fiscal";
import { PostingDryRun, journalNumbersByIds, postJournal, type JournalLineInput, type JournalPreviewResult } from "./journal";
import { shareByWeight, shareGrading, shareQty } from "./production-execution";
import {
  Refused,
  asDate,
  auxOptions,
  checkAuxLines,
  docTypeId,
  executionJournalLines,
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
  DAY,
  firstError,
  type AuxInput,
  type BucketOption,
  type ValueMove,
} from "./production-doc";
import { availableBuckets, bucketsByIds, consumeBucket, jobsByIds, type BucketView, gramsOf, linkTracking, lockRateVersion, produceIntoBucket, recordCostEntry, recordTrackingInfo, registerDerivedStock } from "./production-ledger";
import { GRADING_WORKFLOW } from "./production-execution-workflow";
import { prodDocTransitionAllowed, type ProdDocAction, type ProdDocStatus } from "./production-doc-workflow";

/**
 * No. Grading (W97, W107): one Job in Persiapan at a Grading Unit, taken whole,
 * becomes new No. Stok `<asal>-<n>`, numbered from the No. Stok the Job was
 * picked up from and running on across gradings (W60), each linked to every
 * input. Goods without a Job are one No. Stok, which may be taken in part
 * (W96). Its tables are `prd_grading`, `prd_grading_input` and
 * `prd_grading_output`, with the bahan penolong it used in `prd_aux_use`.
 *
 * **Posting**, in one transaction: each input leaves Persiapan at its value and
 * pays gram × its locked rate (V1, again for goods QC turned back, W66), the
 * bahan penolong leaves the Unit's balance, and the whole is shared over the
 * non-BJL outputs by gram. Outputs go to QC Check, or Stand By at a Unit
 * without one (W65). A Unit marked Lepas No. Job drops the No. Job here (W92);
 * the partai stays. With only BJL outputs the value is Beban Pemusnahan (W32).
 */

type Db = Prisma.TransactionClient | typeof prisma;

export type GradingOutputInput = { item_id: number | null; grams: number | string };
export type GradingInput = {
  unit_id: number | null;
  grading_date: string;
  /** The Job taken whole; for goods without one, `bucket_id` and `qty`. */
  job_id: number | null;
  bucket_id: number | null;
  qty: number | string;
  note: string;
  outputs: GradingOutputInput[];
  aux: AuxInput[];
};
export type GradingResult = { ok: true; id: number; no: string } | { ok: false; errors: Record<string, string> };

const GRAM_UOM = "GR";

/** The unit to take the output's item in: gram for a bulk item, else one piece (W16). */
async function outputItems(ids: number[], db: Db) {
  const rows = await db.mItem.findMany({
    where: { id: { in: ids } },
    select: { id: true, item_label: true, item_type: true, track_stock: true, status: true, is_bjl: true, base_uom: { select: { uom_label: true } } },
  });
  return new Map(rows.map((r) => [r.id, r]));
}

async function check(db: Db, input: GradingInput, strict: boolean, selfId: number | null = null) {
  const errors: Record<string, string> = {};
  const unitId = Number(input.unit_id) || null;
  const unit = unitId ? await db.refUnit.findUnique({ where: { id: unitId } }) : null;
  if (!unit) errors.unit_id = "Pilih Unit.";
  else if (unit.process !== "Grading") errors.unit_id = `${unit.unit_label} bukan unit Grading.`;
  else if (unit.status !== "Active") errors.unit_id = `Unit ${unit.unit_label} nonaktif.`;
  if (!DAY.test(input.grading_date)) errors.grading_date = "Isi tanggal.";

  const inputs: { line_no: number; bucket_id: number; qty: number; bucket: BucketView }[] = [];
  const jobId = Number(input.job_id) || null;
  let parentLotId: number | null = null;
  if (jobId) {
    const job = (await jobsByIds([jobId], db)).get(jobId);
    const held = unitId ? (await availableBuckets({ unitIds: [unitId], stage: "Preparation" }, db)).filter((b) => b.jobId === jobId && !b.auxiliary && b.qty > 0) : [];
    const twin = job && !strict ? await db.prdGrading.findFirst({ where: { job_id: jobId, status: "Draft", ...(selfId ? { id: { not: selfId } } : {}) }, select: { grading_no: true } }) : null;
    if (!job) errors.job_id = "No. Job tidak ditemukan.";
    else if (!held.length) errors.job_id = `No. Job ${job.no} tidak ada di Persiapan unit ini.`;
    else if (new Set(held.map((b) => b.partaiId)).size > 1) errors.job_id = `No. Job ${job.no} memegang beberapa partai; satu No. Grading satu partai.`;
    else if (twin) errors.job_id = `No. Job ${job.no} sudah ada di Draft ${twin.grading_no}.`;
    else {
      held.sort((a, b) => a.lotNo.localeCompare(b.lotNo));
      held.forEach((b, i) => inputs.push({ line_no: i + 1, bucket_id: b.id, qty: b.qty, bucket: b }));
      parentLotId = job.trackingId ?? held[0].lotId;
    }
  } else {
    const bucketId = Number(input.bucket_id) || null;
    const bucket = bucketId ? (await bucketsByIds([bucketId], db)).get(bucketId) : null;
    const qty = parseQty(input.qty);
    if (!bucket) errors.bucket_id = "Pilih barang dari Persiapan.";
    else if (bucket.unitId !== unitId || bucket.stage !== "Preparation" || bucket.auxiliary) errors.bucket_id = `No. Stok ${bucket.lotNo} tidak ada di Persiapan unit ini.`;
    else if (bucket.jobId) errors.bucket_id = `No. Stok ${bucket.lotNo} ada di No. Job ${bucket.jobNo}: grading mengambil Job itu utuh.`;
    else if (!(qty > 0)) errors.qty = "Isi jumlah yang diambil.";
    else if (!fourDecimals(qty)) errors.qty = "Paling banyak 4 angka desimal.";
    else if (units(qty) > units(bucket.qty)) errors.qty = `Melebihi saldo (${bucket.qty} ${bucket.uomLabel}).`;
    else {
      inputs.push({ line_no: 1, bucket_id: bucket.id, qty: fromUnits(units(qty)), bucket });
      parentLotId = bucket.lotId;
    }
  }

  const raw = Array.isArray(input.outputs) ? input.outputs : [];
  const items = await outputItems(raw.flatMap((o) => (o.item_id ? [Number(o.item_id)] : [])), db);
  const outputs: { line_no: number; item_id: number; qty: number; grams: number }[] = [];
  raw.forEach((o, i) => {
    const key = (f: string) => `outputs.${i}.${f}`;
    const item = items.get(Number(o.item_id));
    const grams = parseQty(o.grams);
    if (!item) errors[key("item_id")] = "Pilih Item.";
    else if (item.item_type !== "Barang" || !item.track_stock || item.status !== "Active") errors[key("item_id")] = `${item.item_label} bukan Barang aktif dengan Kelola Stok.`;
    if (!(grams > 0)) errors[key("grams")] = "Isi gram lebih dari 0.";
    else if (!fourDecimals(grams)) errors[key("grams")] = "Paling banyak 4 angka desimal.";
    if (item && grams > 0) outputs.push({ line_no: outputs.length + 1, item_id: item.id, qty: item.base_uom.uom_label === GRAM_UOM ? grams : 1, grams });
  });
  if (strict && !raw.length) errors._outputs = "Isi minimal satu output.";

  const aux = await checkAuxLines(input.aux, unitId, errors, db);
  if (Object.keys(errors).length) return { ok: false as const, errors };
  return {
    ok: true as const,
    data: { unit_id: unitId!, grading_date: asDate(input.grading_date), job_id: jobId, note: text(input.note) },
    unit: unit!,
    inputs,
    parentLotId: parentLotId!,
    outputs,
    aux,
    items,
  };
}

async function audit(db: Db, id: number, action: "TAMBAH" | "UPDATE", event: string, by: number) {
  await db.auditLog.create({ data: { entity_key: "prd_grading", row_id: id, action, event, by } });
}

async function nextNo(tx: Prisma.TransactionClient, series: string) {
  const row = await tx.prdGrading.findFirst({ where: { grading_no: { startsWith: series } }, orderBy: { grading_no: "desc" }, select: { grading_no: true } });
  return nextDailyNumber(series, row?.grading_no ?? null);
}

export async function createGrading(input: GradingInput, actorId: number): Promise<GradingResult> {
  const c = await check(prisma, input, false);
  if (!c.ok) return c;
  const made = await prisma.$transaction(async (tx) => {
    const row = await tx.prdGrading.create({
      data: {
        ...c.data,
        grading_no: await nextNo(tx, unitSeries("NG", c.unit.unit_label, c.data.grading_date)),
        created_by: actorId,
        inputs: { create: inputRows(c.inputs) },
        outputs: { create: c.outputs },
        aux: { create: auxRows(c.aux) },
      },
    });
    await audit(tx, row.id, "TAMBAH", "create", actorId);
    return row;
  });
  return { ok: true, id: made.id, no: made.grading_no };
}

export async function updateGrading(id: number, input: GradingInput, actorId: number): Promise<GradingResult> {
  const current = await prisma.prdGrading.findUnique({ where: { id }, select: { status: true, grading_no: true } });
  if (!current) return { ok: false, errors: { _form: "Dokumen tidak ditemukan." } };
  if (current.status !== "Draft") return { ok: false, errors: { _form: "Hanya Draft yang dapat diubah." } };
  const c = await check(prisma, input, false, id);
  if (!c.ok) return c;
  const no = await prisma.$transaction(async (tx) => {
    const series = unitSeries("NG", c.unit.unit_label, c.data.grading_date);
    const grading_no = current.grading_no.startsWith(series) ? current.grading_no : await nextNo(tx, series);
    await tx.prdGradingInput.deleteMany({ where: { grading_id: id } });
    await tx.prdGradingOutput.deleteMany({ where: { grading_id: id } });
    await tx.prdAuxUse.deleteMany({ where: { grading_id: id } });
    await tx.prdGrading.update({ where: { id }, data: { ...c.data, grading_no, updated_by: actorId, inputs: { create: inputRows(c.inputs) }, outputs: { create: c.outputs }, aux: { create: auxRows(c.aux) } } });
    await audit(tx, id, "UPDATE", "edit", actorId);
    return grading_no;
  });
  return { ok: true, id, no };
}

const inputRows = (inputs: { line_no: number; bucket_id: number; qty: number }[]) => inputs.map(({ line_no, bucket_id, qty }) => ({ line_no, bucket_id, qty }));

const auxRows = (aux: { line_no: number; bucket_id: number; qty: number }[]) => aux.map(({ line_no, bucket_id, qty }) => ({ line_no, bucket_id, qty }));

const asInput = (g: Prisma.PrdGradingGetPayload<{ include: { inputs: true; outputs: true; aux: true } }>): GradingInput => ({
  unit_id: g.unit_id,
  grading_date: isoDay(g.grading_date),
  job_id: g.job_id,
  bucket_id: g.job_id ? null : (g.inputs[0]?.bucket_id ?? null),
  qty: g.job_id ? "" : (g.inputs[0]?.qty.toString() ?? ""),
  note: g.note ?? "",
  outputs: g.outputs.sort((a, b) => a.line_no - b.line_no).map((o) => ({ item_id: o.item_id, grams: o.grams.toString() })),
  aux: g.aux.sort((a, b) => a.line_no - b.line_no).map((a) => ({ bucket_id: a.bucket_id, qty: a.qty.toString() })),
});

export async function transitionGrading(id: number, action: ProdDocAction, actorId: number, reason?: string, options: { dryRun?: boolean } = {}) {
  const g = await prisma.prdGrading.findUnique({ where: { id }, include: { inputs: true, outputs: true, aux: true } });
  if (!g) return { ok: false as const, errors: { _form: "Dokumen tidak ditemukan." } };
  if (!prodDocTransitionAllowed(GRADING_WORKFLOW, action, g.status as ProdDocStatus)) return { ok: false as const, errors: { _form: "Status dokumen sudah berubah. Muat ulang." } };

  if (action === "cancel") {
    const why = text(reason);
    if (!why) return { ok: false as const, errors: { reason: "Alasan wajib diisi." } };
    await prisma.$transaction(async (tx) => {
      await tx.prdGrading.update({ where: { id }, data: { status: "Cancelled", status_reason: why, updated_by: actorId } });
      await audit(tx, id, "UPDATE", "cancel", actorId);
    });
    return { ok: true as const };
  }

  return refusable(async () => {
    await prisma.$transaction(async (tx) => {
      await holdPostingPeriod(tx, isoDay(g.grading_date));
      const c = await check(tx, asInput(g), true, id);
      if (!c.ok) throw new Refused({ _form: `Belum bisa diposting: ${firstError(c.errors)}` });
      const done = await tx.prdGrading.updateMany({ where: { id, status: "Draft" }, data: { status: "Posted", updated_by: actorId } });
      if (done.count !== 1) throw new Refused({ _form: "Status dokumen sudah berubah. Muat ulang." });

      const source = { docTypeId: await docTypeId(tx, "prd_grading"), docId: id, no: g.grading_no };
      const date = c.data.grading_date;
      const common = { date, source, actorId };

      const accounts = await itemAccounts([...c.inputs.map((i) => i.bucket.itemId), ...c.outputs.map((o) => o.item_id), ...c.aux.map((a) => a.bucket.itemId)], ["wip"], null, tx);
      if (!accounts.ok) throw new Refused({ _form: accounts.message });
      const wip = (itemId: number) => accounts.accounts.get(itemId)!.wip;

      // Each input leaves at its value and pays gram × its own locked rate (V1, W66).
      const moves: ValueMove[] = [];
      const taken: { bucketId: number; lotId: number; grams: number; value: number; cost: number; rate: number; rateVersionId: number; routingId: number | null }[] = [];
      let partaiId: number | null = null;
      let jobId: number | null = null;
      for (const i of c.inputs) {
        const t = await consumeBucket(tx, { bucketId: i.bucket_id, baseQty: i.qty, ...common });
        const grams = await gramsOf(tx, { lotId: t.lotId, itemId: t.itemId, qty: i.qty });
        const locked = await lockRateVersion(tx, { lotId: t.lotId, partaiId: t.partaiId, actorId });
        const cost = await recordCostEntry(tx, { unitId: c.data.unit_id, rateVersionId: locked.rateVersionId, lotId: t.lotId, partaiId: t.partaiId, grams, isRework: t.qcCheckId != null, ...common });
        moves.push({ accountId: wip(t.itemId), amount: -t.value });
        taken.push({ bucketId: i.bucket_id, lotId: t.lotId, grams: grams.toNumber(), value: t.value, cost: cost.amount, rate: Number(cost.rate), ...locked });
        partaiId = t.partaiId;
        jobId = t.jobId;
      }
      let auxValue = 0;
      for (const a of c.aux) {
        const used = await consumeBucket(tx, { bucketId: a.bucket_id, baseQty: a.qty, ...common });
        await tx.prdAuxUse.update({ where: { id: g.aux.find((x) => x.line_no === a.line_no)!.id }, data: { value: used.value } });
        moves.push({ accountId: wip(used.itemId), amount: -used.value });
        auxValue += used.value;
      }

      const inputValue = taken.reduce((a, t) => a + t.value, 0);
      const costAmount = taken.reduce((a, t) => a + t.cost, 0);
      const grams = taken.reduce((a, t) => a + t.grams, 0);
      const total = inputValue + auxValue + costAmount;
      const flagged = c.outputs.map((o) => ({ ...o, isBjl: c.items.get(o.item_id)!.is_bjl }));
      const share = shareGrading(total, flagged);
      const stage = c.unit.has_qc ? ("QcCheck" as const) : ("StandBy" as const);
      const weights = taken.map((t) => t.grams);
      for (const [i, o] of flagged.entries()) {
        const made = await registerDerivedStock(tx, { parentLotId: c.parentLotId, itemId: o.item_id, ...common });
        await recordTrackingInfo(tx, {
          lotId: made.id,
          grams: o.grams,
          form: c.items.get(o.item_id)!.base_uom.uom_label === GRAM_UOM ? "Bulk" : "Piece",
          rateVersionId: taken[0].rateVersionId,
          routingId: taken[0].routingId,
          actorId,
        });
        const placed = await produceIntoBucket(tx, {
          lotId: made.id,
          itemId: o.item_id,
          unitId: c.data.unit_id,
          stage,
          partaiId,
          jobId: c.unit.releases_job ? null : jobId,
          baseQty: o.qty,
          value: share.values[i],
          ...common,
        });
        // Every output comes from every input (W97), shared by the inputs' gram.
        const qtys = shareQty(o.qty, weights);
        const values = shareByWeight(share.values[i], weights);
        for (const [k, t] of taken.entries()) await linkTracking(tx, { fromBucketId: t.bucketId, fromLotId: t.lotId, toLotId: made.id, qty: qtys[k], value: values[k], source });
        await tx.prdGradingOutput.update({
          where: { grading_id_line_no: { grading_id: id, line_no: o.line_no } },
          data: { is_bjl: o.isBjl, tracking_id: made.id, tracking_no: made.no, value: share.values[i], to_bucket_id: placed.bucketId },
        });
        moves.push({ accountId: wip(o.item_id), amount: share.values[i] });
      }
      // What was taken, as taken: a Job's contents are read again at Posting.
      await tx.prdGradingInput.deleteMany({ where: { grading_id: id } });
      await tx.prdGradingInput.createMany({
        data: c.inputs.map((x, k) => ({ grading_id: id, line_no: x.line_no, bucket_id: x.bucket_id, qty: x.qty, grams: taken[k].grams, value: taken[k].value, cost_amount: taken[k].cost })),
      });

      const lines = await executionJournalLines(moves, costAmount, share.scrap, `${g.grading_no} · Grading ${c.unit.unit_label}`, tx);
      const journal = lines.length ? await postJournal(tx, { description: `${g.grading_no} · Grading ${c.unit.unit_label}`, sourceDocTypeId: source.docTypeId, sourceDocId: id, postingDate: date, actorId, lines }) : null;
      await tx.prdGrading.update({
        where: { id },
        data: { grams, rate: taken[0].rate, input_value: inputValue, cost_amount: costAmount, aux_value: auxValue, scrap_amount: share.scrap, journal_id: journal?.id ?? null },
      });
      await audit(tx, id, "UPDATE", "post", actorId);
      if (options.dryRun) throw new PostingDryRun(lines as JournalLineInput[]);
    });
    return { ok: true as const } as { ok: true; journal?: JournalLineInput[] };
  });
}

/** The journal Posting would write: a dry run, rolled back (P103). */
export async function gradingPreview(id: number, actorId: number): Promise<JournalPreviewResult> {
  return journalPreview(() => transitionGrading(id, "post", actorId, undefined, { dryRun: true }));
}

// ------------------------------------------------------------------- reads

export type GradingListRow = {
  id: number;
  no: string;
  date: string;
  status: ProdDocStatus;
  unitLabel: string;
  unitName: string;
  jobNo: string | null;
  partaiNo: string | null;
  lines: number;
  /** Gram taken: stored at Posting, else what the inputs hold now. */
  grams: number;
  value: number;
};

/** The buckets a Draft of this document names: *Ada di Draft* in the Workspace (P263). */
export async function gradingDraftBucketIds(): Promise<number[]> {
  return (await prisma.prdGradingInput.findMany({ where: { grading: { status: "Draft" } }, select: { bucket_id: true } })).map((r) => r.bucket_id);
}

/** The Draft that already takes this Job, so opening the Job again opens it. */
export async function gradingDraftOfJob(jobId: number): Promise<number | null> {
  return (await prisma.prdGrading.findFirst({ where: { job_id: jobId, status: "Draft" }, select: { id: true } }))?.id ?? null;
}

/** The Unit a document is at, for the actions' Unit check (P260). */
export async function gradingUnitId(id: number): Promise<number | null> {
  return (await prisma.prdGrading.findUnique({ where: { id }, select: { unit_id: true } }))?.unit_id ?? null;
}

/** `units`: the actor's Units, or null for all (P260). */
export async function listGradings(units: number[] | null = null): Promise<GradingListRow[]> {
  const rows = await prisma.prdGrading.findMany({
    where: units ? { unit_id: { in: units } } : undefined,
    orderBy: [{ grading_date: "desc" }, { id: "desc" }],
    include: { unit: true, inputs: { select: { bucket_id: true, grams: true } }, _count: { select: { outputs: true } } },
  });
  const [buckets, jobs] = await Promise.all([bucketsByIds(rows.flatMap((r) => r.inputs.map((i) => i.bucket_id))), jobsByIds(rows.flatMap((r) => (r.job_id ? [r.job_id] : [])))]);
  return rows.map((r) => {
    const held = r.inputs.map((i) => buckets.get(i.bucket_id));
    return {
      id: r.id,
      no: r.grading_no,
      date: isoDay(r.grading_date),
      status: r.status as ProdDocStatus,
      unitLabel: r.unit.unit_label,
      unitName: r.unit.unit_name,
      jobNo: r.job_id ? (jobs.get(r.job_id)?.no ?? null) : null,
      partaiNo: held.find((b) => b?.partaiNo)?.partaiNo ?? null,
      lines: r._count.outputs,
      grams: r.status === "Posted" ? r.grams.toNumber() : held.reduce((a, b) => a + (b?.grams ?? 0), 0),
      value: r.input_value.add(r.cost_amount).add(r.aux_value).toNumber(),
    };
  });
}

export type GradingView = {
  id: number;
  no: string;
  date: string;
  status: ProdDocStatus;
  unitId: number;
  unitLabel: string;
  unitName: string;
  jobId: number | null;
  jobNo: string | null;
  /** What it takes: stored figures once posted. */
  inputs: { bucketId: number; qty: number; grams: number; value: number; cost: number }[];
  grams: number;
  rate: number;
  inputValue: number;
  cost: number;
  auxValue: number;
  scrap: number;
  note: string | null;
  reason: string | null;
  /** The journal Posting wrote (A7.4); none when nothing changed in the books. */
  journalId: number | null;
  journalNo: string | null;
  outputs: { itemId: number; grams: number; qty: number; isBjl: boolean; trackingNo: string | null; value: number }[];
  aux: { bucketId: number; qty: number; value: number }[];
};

export async function getGrading(id: number): Promise<GradingView | null> {
  const g = await prisma.prdGrading.findUnique({
    where: { id },
    include: { unit: true, inputs: { orderBy: { line_no: "asc" } }, outputs: { orderBy: { line_no: "asc" } }, aux: { orderBy: { line_no: "asc" } } },
  });
  if (!g) return null;
  const [job, journalNo] = await Promise.all([
    g.job_id ? jobsByIds([g.job_id]).then((m) => m.get(g.job_id!)) : null,
    g.journal_id ? journalNumbersByIds([g.journal_id]).then((m) => m.get(g.journal_id!) ?? null) : null,
  ]);
  return {
    id: g.id,
    no: g.grading_no,
    date: isoDay(g.grading_date),
    status: g.status as ProdDocStatus,
    unitId: g.unit_id,
    unitLabel: g.unit.unit_label,
    unitName: g.unit.unit_name,
    jobId: g.job_id,
    jobNo: job?.no ?? null,
    inputs: g.inputs.map((i) => ({ bucketId: i.bucket_id, qty: i.qty.toNumber(), grams: i.grams.toNumber(), value: i.value.toNumber(), cost: i.cost_amount.toNumber() })),
    grams: g.grams.toNumber(),
    rate: g.rate.toNumber(),
    inputValue: g.input_value.toNumber(),
    cost: g.cost_amount.toNumber(),
    auxValue: g.aux_value.toNumber(),
    scrap: g.scrap_amount.toNumber(),
    note: g.note,
    reason: g.status_reason,
    journalId: g.journal_id,
    journalNo,
    outputs: g.outputs.map((o) => ({ itemId: o.item_id, grams: o.grams.toNumber(), qty: o.qty.toNumber(), isBjl: o.is_bjl, trackingNo: o.tracking_no, value: o.value.toNumber() })),
    aux: g.aux.map((a) => ({ bucketId: a.bucket_id, qty: a.qty.toNumber(), value: a.value.toNumber() })),
  };
}
export type OutputItemOption = { id: number; label: string; name: string; uomLabel: string; isBjl: boolean };

export type GradingOptions = {
  units: { id: number; label: string; name: string }[];
  inputs: BucketOption[];
  aux: BucketOption[];
  items: OutputItemOption[];
};

export async function gradingOptions(keep: number[] = []): Promise<GradingOptions> {
  const units = await prisma.refUnit.findMany({ where: { process: "Grading", status: "Active" }, orderBy: { unit_label: "asc" } });
  const ids = units.map((u) => u.id);
  const [inputs, aux, items] = await Promise.all([
    persiapanOptions(ids, keep),
    auxOptions(ids, keep),
    prisma.mItem.findMany({ where: { item_type: "Barang", track_stock: true, status: "Active" }, orderBy: { item_label: "asc" }, include: { base_uom: true } }),
  ]);
  return {
    units: units.map((u) => ({ id: u.id, label: u.unit_label, name: u.unit_name })),
    inputs,
    aux,
    items: items.map((i) => ({ id: i.id, label: i.item_label, name: i.item_name, uomLabel: i.base_uom.uom_label, isBjl: i.is_bjl })),
  };
}

export async function gradingNumbersByIds(ids: number[]): Promise<Map<number, string>> {
  const rows = await prisma.prdGrading.findMany({ where: { id: { in: ids } }, select: { id: true, grading_no: true } });
  return new Map(rows.map((r) => [r.id, r.grading_no]));
}
