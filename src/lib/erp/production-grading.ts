import "server-only";

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { holdPostingPeriod } from "./fiscal";
import { PostingDryRun, journalNumbersByIds, type JournalLineInput, type JournalPreviewResult } from "./journal";
import { shareByWeight, shareGrading, shareQty } from "./production-execution";
import {
  Refused,
  asDate,
  auxOptions,
  checkAuxLines,
  docTypeId,
  fourDecimals,
  fromUnits,
  isoDay,
  postToErp,
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
import { type CostCharge, availableBuckets, bucketsByIds, consumeBucket, jobsByIds, unitStepsOf, type BucketView, gramsOf, linkTracking, lockRateVersion, produceIntoBucket, chargeUnit, recordTrackingInfo, registerDerivedStock } from "./production-ledger";
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
 * non-BJL outputs by gram. Outputs go to the next step of the Unit, or Stand By
 * after the last (T4). Grading always drops the No. Job (T2); the partai stays. With only BJL outputs the value is Beban Pemusnahan (W32).
 */

type Db = Prisma.TransactionClient | typeof prisma;

export type GradingOutputInput = { item_id: number | null; grams: number | string };
/** One document line: a Job taken whole, or one loose No. Stok taken in part (T6), with the outputs made from it. */
export type GradingItemInput = { job_id: number | null; bucket_id: number | null; qty: number | string; outputs: GradingOutputInput[] };
export type GradingInput = {
  unit_id: number | null;
  grading_date: string;
  note: string;
  items: GradingItemInput[];
  aux: AuxInput[];
  /** Who graded: optional, several (P286). */
  employee_ids?: number[];
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

type CheckedGroup = {
  group_no: number;
  job_id: number | null;
  parentLotId: number;
  inputs: { line_no: number; bucket_id: number; qty: number; bucket: BucketView }[];
  outputs: { line_no: number; item_id: number; qty: number; grams: number }[];
};

async function check(db: Db, input: GradingInput, strict: boolean, selfId: number | null = null) {
  const errors: Record<string, string> = {};
  const unitId = Number(input.unit_id) || null;
  const unit = unitId ? await db.refUnit.findUnique({ where: { id: unitId } }) : null;
  const step = unit ? (await unitStepsOf(db, unit.id)).find((x) => x.process === "Grading") : null;
  if (!unit) errors.unit_id = "Pilih Unit.";
  else if (!step) errors.unit_id = `${unit.unit_label} tidak punya proses Grading.`;
  else if (unit.status !== "Active") errors.unit_id = `Unit ${unit.unit_label} nonaktif.`;
  if (!DAY.test(input.grading_date)) errors.grading_date = "Isi tanggal.";

  const rawItems = Array.isArray(input.items) ? input.items : [];
  if (!rawItems.length) errors._items = "Pilih minimal satu No. Job atau No. Stok.";
  const held = unitId && step ? (await availableBuckets({ unitIds: [unitId], stage: "Preparation" }, db)).filter((b) => b.stepId === step.id && !b.auxiliary && b.qty > 0) : [];
  const allOutputs = rawItems.flatMap((it) => (Array.isArray(it.outputs) ? it.outputs : []).flatMap((o) => (o.item_id ? [Number(o.item_id)] : [])));
  const items = await outputItems(allOutputs, db);

  const groups: CheckedGroup[] = [];
  const seenJobs = new Set<number>();
  const seenBuckets = new Set<number>();
  let lineNo = 0;
  let outNo = 0;
  for (const [g, it] of rawItems.entries()) {
    const key = (f: string) => `items.${g}.${f}`;
    const jobId = Number(it.job_id) || null;
    const inputs: CheckedGroup["inputs"] = [];
    let parentLotId: number | null = null;
    if (jobId) {
      const job = (await jobsByIds([jobId], db)).get(jobId);
      const rows = held.filter((b) => b.jobId === jobId);
      const twin = job && !strict ? await db.prdGradingInput.findFirst({ where: { job_id: jobId, grading: { status: "Draft", ...(selfId ? { id: { not: selfId } } : {}) } }, select: { grading: { select: { grading_no: true } } } }) : null;
      if (!job) errors[key("job_id")] = "No. Job tidak ditemukan.";
      else if (seenJobs.has(jobId)) errors[key("job_id")] = `No. Job ${job.no} dipilih lebih dari sekali.`;
      else if (!rows.length) errors[key("job_id")] = `No. Job ${job.no} tidak ada di Persiapan Grading unit ini.`;
      else if (new Set(rows.map((b) => b.partaiId)).size > 1) errors[key("job_id")] = `No. Job ${job.no} memegang beberapa partai; satu No. Grading satu partai.`;
      else if (twin) errors[key("job_id")] = `No. Job ${job.no} sudah ada di Draft ${twin.grading.grading_no}.`;
      else {
        seenJobs.add(jobId);
        rows.sort((x, y) => x.lotNo.localeCompare(y.lotNo));
        for (const b of rows) inputs.push({ line_no: ++lineNo, bucket_id: b.id, qty: b.qty, bucket: b });
        parentLotId = job.trackingId ?? rows[0].lotId;
      }
    } else {
      const bucket = held.find((b) => b.id === Number(it.bucket_id)) ?? null;
      const qty = parseQty(it.qty);
      if (!bucket) errors[key("bucket_id")] = "Pilih barang dari Persiapan Grading unit ini.";
      else if (bucket.jobId) errors[key("bucket_id")] = `No. Stok ${bucket.lotNo} ada di No. Job ${bucket.jobNo}: grading mengambil Job itu utuh.`;
      else if (seenBuckets.has(bucket.id)) errors[key("bucket_id")] = `No. Stok ${bucket.lotNo} dipilih lebih dari sekali.`;
      else if (!(qty > 0)) errors[key("qty")] = "Isi jumlah yang diambil.";
      else if (!fourDecimals(qty)) errors[key("qty")] = "Paling banyak 4 angka desimal.";
      else if (units(qty) > units(bucket.qty)) errors[key("qty")] = `Melebihi saldo (${bucket.qty} ${bucket.uomLabel}).`;
      else {
        seenBuckets.add(bucket.id);
        inputs.push({ line_no: ++lineNo, bucket_id: bucket.id, qty: fromUnits(units(qty)), bucket });
        parentLotId = bucket.lotId;
      }
    }

    const raw = Array.isArray(it.outputs) ? it.outputs : [];
    const outputs: CheckedGroup["outputs"] = [];
    raw.forEach((o, i) => {
      const k = (f: string) => key(`outputs.${i}.${f}`);
      const item = items.get(Number(o.item_id));
      const grams = parseQty(o.grams);
      if (!item) errors[k("item_id")] = "Pilih Item.";
      else if (item.item_type !== "Barang" || !item.track_stock || item.status !== "Active") errors[k("item_id")] = `${item.item_label} bukan Barang aktif dengan Kelola Stok.`;
      if (!(grams > 0)) errors[k("grams")] = "Isi gram lebih dari 0.";
      else if (!fourDecimals(grams)) errors[k("grams")] = "Paling banyak 4 angka desimal.";
      if (item && grams > 0) outputs.push({ line_no: ++outNo, item_id: item.id, qty: item.base_uom.uom_label === GRAM_UOM ? grams : 1, grams });
    });
    if (strict && !raw.length) errors[key("outputs")] = "Isi minimal satu output.";
    // Grading loses gram, never makes it; a Draft may still be incomplete (P307).
    const gramsIn = inputs.reduce((a, i) => a + i.qty * (i.bucket.gramsEach ?? NaN), 0);
    const gramsOut = outputs.reduce((a, o) => a + o.grams, 0);
    if (strict && inputs.length && units(gramsOut) > units(gramsIn)) {
      errors[key("outputs")] = `Output ${fromUnits(units(gramsOut))} g melebihi input ${fromUnits(units(gramsIn))} g.`;
    }
    if (inputs.length) groups.push({ group_no: g + 1, job_id: jobId, parentLotId: parentLotId!, inputs, outputs });
  }

  // One document, one partai (W76); before a partai the rule does not apply.
  const partais = new Set(groups.flatMap((x) => x.inputs.map((i) => i.bucket.partaiId)));
  if (partais.size > 1) errors._items = "Satu dokumen hanya untuk satu partai.";

  const aux = await checkAuxLines(input.aux, unitId, errors, db);
  const wanted = [...new Set((Array.isArray(input.employee_ids) ? input.employee_ids : []).map(Number).filter((n) => n > 0))];
  const employees = wanted.length ? await db.mEmployee.findMany({ where: { id: { in: wanted }, status: "Active" }, select: { id: true } }) : [];
  if (employees.length !== wanted.length) errors.employee_ids = "Karyawan tidak ditemukan atau nonaktif.";
  if (Object.keys(errors).length) return { ok: false as const, errors };
  const single = groups.length === 1 ? groups[0].job_id : null;
  return {
    ok: true as const,
    data: { unit_id: unitId!, grading_date: asDate(input.grading_date), job_id: single, note: text(input.note) },
    unit: unit!,
    step: step!,
    employeeIds: wanted,
    groups,
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

const inputRows = (groups: CheckedGroup[]) => groups.flatMap((g) => g.inputs.map((i) => ({ line_no: i.line_no, group_no: g.group_no, job_id: g.job_id, bucket_id: i.bucket_id, qty: i.qty })));
const outputRows = (groups: CheckedGroup[]) => groups.flatMap((g) => g.outputs.map((o) => ({ line_no: o.line_no, group_no: g.group_no, item_id: o.item_id, qty: o.qty, grams: o.grams })));

export async function createGrading(input: GradingInput, actorId: number): Promise<GradingResult> {
  const c = await check(prisma, input, false);
  if (!c.ok) return c;
  const made = await prisma.$transaction(async (tx) => {
    const row = await tx.prdGrading.create({
      data: {
        ...c.data,
        grading_no: await nextNo(tx, unitSeries("NG", c.unit.unit_label, c.data.grading_date)),
        created_by: actorId,
        inputs: { create: inputRows(c.groups) },
        outputs: { create: outputRows(c.groups) },
        aux: { create: auxRows(c.aux) },
        employees: { create: c.employeeIds.map((employee_id) => ({ employee_id })) },
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
    await tx.prdGradingEmployee.deleteMany({ where: { grading_id: id } });
    await tx.prdGrading.update({
      where: { id },
      data: { ...c.data, grading_no, updated_by: actorId, inputs: { create: inputRows(c.groups) }, outputs: { create: outputRows(c.groups) }, aux: { create: auxRows(c.aux) }, employees: { create: c.employeeIds.map((employee_id) => ({ employee_id })) } },
    });
    await audit(tx, id, "UPDATE", "edit", actorId);
    return grading_no;
  });
  return { ok: true, id, no };
}

const auxRows = (aux: { line_no: number; bucket_id: number; qty: number }[]) => aux.map(({ line_no, bucket_id, qty }) => ({ line_no, bucket_id, qty }));

const asInput = (g: Prisma.PrdGradingGetPayload<{ include: { inputs: true; outputs: true; aux: true; employees: true } }>): GradingInput => {
  const groupNos = [...new Set(g.inputs.map((i) => i.group_no))].sort((x, y) => x - y);
  return {
    unit_id: g.unit_id,
    grading_date: isoDay(g.grading_date),
    note: g.note ?? "",
    items: groupNos.map((n) => {
      const ins = g.inputs.filter((i) => i.group_no === n).sort((x, y) => x.line_no - y.line_no);
      const job = ins[0].job_id;
      return {
        job_id: job,
        bucket_id: job ? null : ins[0].bucket_id,
        qty: job ? "" : ins[0].qty.toString(),
        outputs: g.outputs.filter((o) => o.group_no === n).sort((x, y) => x.line_no - y.line_no).map((o) => ({ item_id: o.item_id, grams: o.grams.toString() })),
      };
    }),
    aux: g.aux.sort((x, y) => x.line_no - y.line_no).map((a) => ({ bucket_id: a.bucket_id, qty: a.qty.toString() })),
    employee_ids: g.employees.map((e) => e.employee_id),
  };
};

export async function transitionGrading(id: number, action: ProdDocAction, actorId: number, reason?: string, options: { dryRun?: boolean } = {}) {
  const g = await prisma.prdGrading.findUnique({ where: { id }, include: { inputs: true, outputs: true, aux: true, employees: true } });
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

      // Each input leaves at its value and pays gram × its own locked rate (V1, W66).
      const moves: ValueMove[] = [];
      const costs: (CostCharge | null)[] = [];
      type Taken = { bucketId: number; lotId: number; grams: number; value: number; cost: number; rate: number; rateVersionId: number; routingId: number | null };
      const takenBy = new Map<number, Taken[]>();
      let partaiId: number | null = null;
      for (const grp of c.groups) {
        const list: Taken[] = [];
        for (const i of grp.inputs) {
          const t = await consumeBucket(tx, { bucketId: i.bucket_id, baseQty: i.qty, ...common });
          const grams = await gramsOf(tx, { lotId: t.lotId, itemId: t.itemId, qty: i.qty });
          const locked = await lockRateVersion(tx, { lotId: t.lotId, partaiId: t.partaiId, actorId });
          const cost = await chargeUnit(tx, { unitId: c.data.unit_id, stepId: c.step.id, rateVersionId: locked.rateVersionId, lotId: t.lotId, partaiId: t.partaiId, grams, isRework: t.qcCheckId != null, date });
          costs.push(cost.charge);
          moves.push({ itemId: t.itemId, amount: -t.value });
          list.push({ bucketId: i.bucket_id, lotId: t.lotId, grams: grams.toNumber(), value: t.value, cost: cost.amount, rate: Number(cost.rate), ...locked });
          partaiId = t.partaiId;
        }
        takenBy.set(grp.group_no, list);
      }
      let auxValue = 0;
      for (const a of c.aux) {
        const used = await consumeBucket(tx, { bucketId: a.bucket_id, baseQty: a.qty, ...common });
        await tx.prdAuxUse.update({ where: { id: g.aux.find((x) => x.line_no === a.line_no)!.id }, data: { value: used.value } });
        moves.push({ itemId: used.itemId, amount: -used.value });
        auxValue += used.value;
      }

      // Bahan penolong is shared over the lines by the gram each took, whole rupiah to the last.
      const lineGrams = c.groups.map((grp) => takenBy.get(grp.group_no)!.reduce((x, t) => x + t.grams, 0));
      const auxShare = shareByWeight(auxValue, lineGrams);
      let scrapTotal = 0;
      for (const [gi, grp] of c.groups.entries()) {
        const taken = takenBy.get(grp.group_no)!;
        const total = taken.reduce((x, t) => x + t.value + t.cost, 0) + auxShare[gi];
        const flagged = grp.outputs.map((o) => ({ ...o, isBjl: c.items.get(o.item_id)!.is_bjl }));
        const share = shareGrading(total, flagged);
        scrapTotal += share.scrap;
        const weights = taken.map((t) => t.grams);
        for (const [i, o] of flagged.entries()) {
          const made = await registerDerivedStock(tx, { parentLotId: grp.parentLotId, itemId: o.item_id, ...common });
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
            afterStepId: c.step.id,
            partaiId,
            // Grading always releases the No. Job; the partai stays (T2).
            jobId: null,
            baseQty: o.qty,
            value: share.values[i],
            ...common,
          });
          // Every output comes from every input of its line (W97), shared by the inputs gram.
          const qtys = shareQty(o.qty, weights);
          const values = shareByWeight(share.values[i], weights);
          for (const [k, t] of taken.entries()) await linkTracking(tx, { fromBucketId: t.bucketId, fromLotId: t.lotId, toLotId: made.id, qty: qtys[k], value: values[k], source });
          await tx.prdGradingOutput.update({
            where: { grading_id_line_no: { grading_id: id, line_no: o.line_no } },
            data: { is_bjl: o.isBjl, tracking_id: made.id, tracking_no: made.no, value: share.values[i], to_bucket_id: placed.bucketId },
          });
          moves.push({ itemId: o.item_id, amount: share.values[i] });
        }
      }
      // What was taken, as taken: a Job contents are read again at Posting.
      await tx.prdGradingInput.deleteMany({ where: { grading_id: id } });
      await tx.prdGradingInput.createMany({
        data: c.groups.flatMap((grp) =>
          grp.inputs.map((x, k) => {
            const t = takenBy.get(grp.group_no)![k];
            return { grading_id: id, line_no: x.line_no, group_no: grp.group_no, job_id: grp.job_id, bucket_id: x.bucket_id, qty: x.qty, grams: t.grams, value: t.value, cost_amount: t.cost };
          })
        ),
      });

      const flat = [...takenBy.values()].flat();
      const inputValue = flat.reduce((x, t) => x + t.value, 0);
      const costAmount = flat.reduce((x, t) => x + t.cost, 0);
      const grams = flat.reduce((x, t) => x + t.grams, 0);
      const posted = await postToErp(tx, { source, docTable: "prd_grading", date, description: `${g.grading_no} · Grading ${c.unit.unit_label}`, moves, costs, scrap: scrapTotal, actorId });
      await tx.prdGrading.update({
        where: { id },
        data: { grams, rate: flat[0].rate, input_value: inputValue, cost_amount: costAmount, aux_value: auxValue, scrap_amount: scrapTotal, journal_id: posted.journalId },
      });
      await audit(tx, id, "UPDATE", "post", actorId);
      if (options.dryRun) throw new PostingDryRun(posted.lines);
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
  return (await prisma.prdGradingInput.findFirst({ where: { job_id: jobId, grading: { status: "Draft" } }, select: { grading_id: true } }))?.grading_id ?? null;
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
    include: { unit: true, inputs: { select: { bucket_id: true, grams: true, job_id: true } }, _count: { select: { outputs: true } } },
  });
  const [buckets, jobs] = await Promise.all([bucketsByIds(rows.flatMap((r) => r.inputs.map((i) => i.bucket_id))), jobsByIds(rows.flatMap((r) => r.inputs.flatMap((i) => (i.job_id ? [i.job_id] : []))))]);
  return rows.map((r) => {
    const held = r.inputs.map((i) => buckets.get(i.bucket_id));
    return {
      id: r.id,
      no: r.grading_no,
      date: isoDay(r.grading_date),
      status: r.status as ProdDocStatus,
      unitLabel: r.unit.unit_label,
      unitName: r.unit.unit_name,
      jobNo: [...new Set(r.inputs.flatMap((i) => (i.job_id ? [jobs.get(i.job_id)?.no ?? ""] : [])))].join(", ") || null,
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
  /** The number of each Job a line takes, by id. */
  jobNos: Record<number, string>;
  /** What it takes: stored figures once posted. `groupNo` is its document line, `jobId` that line Job. */
  inputs: { bucketId: number; groupNo: number; jobId: number | null; qty: number; grams: number; value: number; cost: number }[];
  grams: number;
  rate: number;
  inputValue: number;
  cost: number;
  auxValue: number;
  scrap: number;
  note: string | null;
  reason: string | null;
  /** Who graded (P286). */
  employeeIds: number[];
  /** The journal Posting wrote (A7.4); none when nothing changed in the books. */
  journalId: number | null;
  journalNo: string | null;
  outputs: { groupNo: number; itemId: number; grams: number; qty: number; isBjl: boolean; trackingNo: string | null; value: number }[];
  aux: { bucketId: number; qty: number; value: number }[];
};

export async function getGrading(id: number): Promise<GradingView | null> {
  const g = await prisma.prdGrading.findUnique({
    where: { id },
    include: { unit: true, inputs: { orderBy: { line_no: "asc" } }, outputs: { orderBy: { line_no: "asc" } }, aux: { orderBy: { line_no: "asc" } }, employees: true },
  });
  if (!g) return null;
  const jobMap = await jobsByIds(g.inputs.flatMap((i) => (i.job_id ? [i.job_id] : [])));
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
    jobNos: Object.fromEntries([...jobMap].map(([k, v]) => [k, v.no])),
    inputs: g.inputs.map((i) => ({ bucketId: i.bucket_id, groupNo: i.group_no, jobId: i.job_id, qty: i.qty.toNumber(), grams: i.grams.toNumber(), value: i.value.toNumber(), cost: i.cost_amount.toNumber() })),
    grams: g.grams.toNumber(),
    rate: g.rate.toNumber(),
    inputValue: g.input_value.toNumber(),
    cost: g.cost_amount.toNumber(),
    auxValue: g.aux_value.toNumber(),
    scrap: g.scrap_amount.toNumber(),
    note: g.note,
    reason: g.status_reason,
    employeeIds: g.employees.map((e) => e.employee_id),
    journalId: g.journal_id,
    journalNo,
    outputs: g.outputs.map((o) => ({ groupNo: o.group_no, itemId: o.item_id, grams: o.grams.toNumber(), qty: o.qty.toNumber(), isBjl: o.is_bjl, trackingNo: o.tracking_no, value: o.value.toNumber() })),
    aux: g.aux.map((a) => ({ bucketId: a.bucket_id, qty: a.qty.toNumber(), value: a.value.toNumber() })),
  };
}
export type OutputItemOption = { id: number; label: string; name: string; uomLabel: string; isBjl: boolean };

export type GradingOptions = {
  units: { id: number; label: string; name: string }[];
  inputs: BucketOption[];
  aux: BucketOption[];
  items: OutputItemOption[];
  employees: { id: number; label: string; name: string }[];
};

export async function gradingOptions(keep: number[] = []): Promise<GradingOptions> {
  const units = await prisma.refUnit.findMany({ where: { steps: { some: { process: "Grading" } }, status: "Active" }, orderBy: { unit_label: "asc" } });
  const ids = units.map((u) => u.id);
  const [inputs, aux, items, employees] = await Promise.all([
    persiapanOptions(ids, keep, prisma, "Grading"),
    auxOptions(ids, keep),
    prisma.mItem.findMany({ where: { item_type: "Barang", track_stock: true, status: "Active" }, orderBy: { item_label: "asc" }, include: { base_uom: true } }),
    prisma.mEmployee.findMany({ where: { status: "Active" }, orderBy: { employee_name: "asc" }, select: { id: true, employee_label: true, employee_name: true } }),
  ]);
  return {
    units: units.map((u) => ({ id: u.id, label: u.unit_label, name: u.unit_name })),
    inputs,
    aux,
    employees: employees.map((e) => ({ id: e.id, label: e.employee_label, name: e.employee_name })),
    items: items.map((i) => ({ id: i.id, label: i.item_label, name: i.item_name, uomLabel: i.base_uom.uom_label, isBjl: i.is_bjl })),
  };
}

export async function gradingNumbersByIds(ids: number[]): Promise<Map<number, string>> {
  const rows = await prisma.prdGrading.findMany({ where: { id: { in: ids } }, select: { id: true, grading_no: true } });
  return new Map(rows.map((r) => [r.id, r.grading_no]));
}
