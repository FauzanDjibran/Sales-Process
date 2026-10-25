import "server-only";

import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import { BASE_CURRENCY_LABEL } from "./currency";
import { checkTransactionDate } from "./fiscal";
import { PostingDryRun, describeJournalLines, journalNumbersByIds, postJournal, type JournalLineInput, type JournalPreviewResult } from "./journal";
import { accountsForItems } from "./item-account";
import { formatNumber } from "@/lib/format";
import { carriedSupplier } from "./production-execution";
import {
  ProductionRefusal,
  availableBuckets,
  bucketsByIds,
  lotNumberTaken,
  lotSupplierIds,
  passThrough,
  produce,
  productionIdentityNumbers,
  type BucketView,
} from "./production-ledger";
import { freeNumber, lotNumberBase, mixLotNumber, nextDailyNumber } from "./production-number";
import { standardCostFor, standardCostItemLabels } from "./standard-cost";
import {
  EXECUTION_TRANSITIONS,
  executionIsEditable,
  executionTransitionAllowed,
  kindsOfMode,
  type ExecutionAction,
  type ExecutionKind,
  type ExecutionOutputStatus,
  type ExecutionStatus,
} from "./production-run-workflow";

/**
 * The Eksekusi Produksi (Walet step 5, P169, M114, AD3, AD8, AD20): one posting
 * at one workstation, input → output, `NG_<unit>_<DDMMYY>_<NNNNN>` after the
 * unit. Its tables are `prd_execution`, `_section`, `_input`, `_output` and
 * `_cost`, and nothing else names them; the goods move through the production
 * ledger (`produce`, `passThrough`).
 *
 * A **section per Job** (AD3): its inputs — received goods at the station, any
 * quantity they hold — and its outputs. The station's **Cara Kerja** (P166)
 * decides the kind of run:
 * - **Transform**: outputs are free items, each a **new lot** registered with the
 *   run as its source (a typed number or one generated, O5); the Job of the
 *   inputs is kept. Value = Σ inputs + the section's standard, shared by
 *   **Bobot** = qty × the item's value weight — a BJL or a Reject takes 0 — in
 *   whole rupiah, largest remainder; a section with one eligible output gives it
 *   everything. A Reject output is flagged in production and stays there (O6).
 * - **PassThrough**: the **lot is kept**: the main input's bucket whole, extra
 *   inputs (a box) joining it, the quantity out free (susut or tambahan, F6).
 * - **Mix** (Moulding): the Partai's goods, whole, become **one lot** named
 *   \`<partai>_<kode barang>\`, no Job, no standard (M125); the hand-over then
 *   boxes it into Jobs.
 *
 * **Standard** (M92, M109, AD22): the section's **Driver** is typed; for each
 * Standard Cost Item in force at the station on the run's day, round(Driver ×
 * rate) is booked into WIP, so cost in = cost out and the outputs carry it.
 * **Journal**: per WIP account, outputs − inputs (Dr when more, Cr when less);
 * Cr each Standard Cost Item's account with the station's Cost Center; none when
 * nothing nets. A Draft touches no book; Posting writes everything or nothing.
 */

type Db = Prisma.TransactionClient | typeof prisma;
const D = Prisma.Decimal;
type Dec = Prisma.Decimal;

// ------------------------------------------------------------------ input

export type RunHeaderInput = {
  execution_date: string;
  kind: ExecutionKind | null;
  workstation_id: number | null;
  note: string;
};

export type RunInputLine = { bucket_id: number | null; qty: number | string; is_main?: boolean };

export type RunOutputLine = {
  item_id: number | null;
  qty: number | string;
  /** Typed, or empty to have one generated at Posting; a pass-through keeps its input's. */
  lot_no: string;
  expiry_date: string;
  status: ExecutionOutputStatus;
};

export type RunSectionInput = { driver: number | string; inputs: RunInputLine[]; outputs: RunOutputLine[] };

export type RunResult = { ok: true; id: number; executionNo: string } | { ok: false; errors: Record<string, string> };

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const asDate = (d: string) => new Date(`${d}T00:00:00Z`);
const isoDay = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "");
const text = (v: unknown) => String(v ?? "").trim() || null;
const qtyText = (d: Dec | number) => formatNumber(Number(d), 2);
const key = (i: number, f: string) => `sections.${i}.${f}`;
const inKey = (i: number, j: number, f: string) => `sections.${i}.inputs.${j}.${f}`;
const outKey = (i: number, j: number, f: string) => `sections.${i}.outputs.${j}.${f}`;

async function docTypeId(db: Db, table: string): Promise<number> {
  const row = await db.sysDocType.findFirst({ where: { doc_table: table }, select: { id: true } });
  if (!row) throw new Error(`Jenis dokumen ${table} belum terdaftar. Jalankan db:seed.`);
  return row.id;
}

/** A quantity typed as text, at most 6 decimals, above 0. */
function parseQty(v: unknown): Dec | null {
  const s = String(v ?? "").trim().replace(",", ".");
  if (!/^\d+(\.\d{1,6})?$/.test(s)) return null;
  const d = new D(s);
  return d.gt(0) ? d : null;
}

/** A Driver: 0 or more, at most 4 decimals. */
function parseDriver(v: unknown): Dec | null {
  const s = String(v ?? "").trim().replace(",", ".") || "0";
  if (!/^\d+(\.\d{1,4})?$/.test(s)) return null;
  return new D(s);
}

// ---------------------------------------------------------------- options

export type RunStation = { id: number; label: string; name: string; active: boolean; mode: string; costCenterId: number };

export type RunItem = {
  id: number;
  label: string;
  name: string;
  uomLabel: string;
  active: boolean;
  outputType: "Utama" | "Turunan" | "BJL" | null;
  valueWeight: number | null;
  hasExpiry: boolean;
};

export type RunOptions = {
  workstations: RunStation[];
  /** Received goods holding quantity at any station — the form narrows to the run's. */
  buckets: BucketView[];
  /** Barang with Kelola Stok: what a run may put out. */
  items: RunItem[];
};

export type RunCurrent = { workstationId: number | null; bucketIds: number[]; itemIds: number[] };

export async function runOptions(current: RunCurrent | null = null, db: Db = prisma): Promise<RunOptions> {
  const itemIds = current?.itemIds ?? [];
  const [workstations, buckets, items] = await Promise.all([
    db.refWorkstation.findMany({
      where: { OR: [{ status: "Active" }, ...(current?.workstationId ? [{ id: current.workstationId }] : [])] },
      orderBy: { workstation_label: "asc" },
      select: { id: true, workstation_label: true, workstation_name: true, status: true, mode: true, cost_center_id: true },
    }),
    availableBuckets({ withIds: current?.bucketIds }, db),
    db.mItem.findMany({
      where: { OR: [{ item_type: "Barang", track_stock: true, status: "Active" }, ...(itemIds.length ? [{ id: { in: itemIds } }] : [])] },
      orderBy: { item_label: "asc" },
      select: { id: true, item_label: true, item_name: true, status: true, item_type: true, track_stock: true, output_type: true, value_weight: true, has_expiry: true, base_uom: { select: { uom_label: true } } },
    }),
  ]);
  return {
    workstations: workstations.map((w) => ({ id: w.id, label: w.workstation_label, name: w.workstation_name, active: w.status === "Active", mode: w.mode, costCenterId: w.cost_center_id })),
    buckets,
    items: items.map((i) => ({
      id: i.id,
      label: i.item_label,
      name: i.item_name,
      uomLabel: i.base_uom.uom_label,
      active: i.status === "Active" && i.item_type === "Barang" && i.track_stock,
      outputType: i.output_type,
      valueWeight: i.value_weight ? i.value_weight.toNumber() : null,
      hasExpiry: i.has_expiry,
    })),
  };
}

// ------------------------------------------------------------- validation

type CheckedInput = { line_no: number; bucketId: number; lotId: number; itemId: number; lotNo: string; qty: Dec; isMain: boolean; jobId: number | null; partaiId: number | null };
type CheckedOutput = { line_no: number; itemId: number; lotNo: string | null; expiry: Date | null; qty: Dec; status: ExecutionOutputStatus };
type CheckedSection = { section_no: number; driver: Dec; inputs: CheckedInput[]; outputs: CheckedOutput[]; jobId: number | null };

type Checked = {
  data: { execution_date: Date; kind: ExecutionKind; workstation_id: number; note: string | null };
  station: RunStation;
  sections: CheckedSection[];
  partaiId: number | null;
  items: Map<number, RunItem>;
};

/** Bobot of one section's outputs (Walet only, AD6, AD7, AD21): qty × value weight, 0 for a BJL or a Reject. */
export function sectionWeights(outs: { itemId: number; qty: number; status: ExecutionOutputStatus }[], items: Map<number, { label: string; outputType: string | null; valueWeight: number | null }>): { weights: number[] } | { error: string } {
  const eligible = outs.map((o) => o.status === "Available" && items.get(o.itemId)?.outputType !== "BJL");
  const n = eligible.filter(Boolean).length;
  if (n === 0) return { error: "Setiap section memerlukan minimal satu output Tersedia yang bukan BJL — nilainya harus ke mana-mana." };
  if (n === 1) return { weights: eligible.map((e) => (e ? 1 : 0)) };
  const weights: number[] = [];
  for (const [i, o] of outs.entries()) {
    if (!eligible[i]) {
      weights.push(0);
      continue;
    }
    const it = items.get(o.itemId);
    if (!it?.valueWeight || !(it.valueWeight > 0)) return { error: `Bobot Nilai ${it?.label ?? "barang"} belum diisi di master Item; perlu untuk membagi nilai beberapa output.` };
    weights.push(o.qty * it.valueWeight);
  }
  return { weights };
}

/**
 * Every rule a run must satisfy to be saved — and, run again inside the posting
 * transaction with `forPosting`, to be posted: the station and the items still
 * active, every output with a lot number free and an expiry where one is kept.
 */
export async function checkRun(
  db: Db,
  header: RunHeaderInput,
  sections: RunSectionInput[],
  selfId: number | null,
  forPosting = false
): Promise<{ ok: true; c: Checked } | { ok: false; errors: Record<string, string> }> {
  const errors: Record<string, string> = {};
  const stored = selfId
    ? await db.prdExecution.findUnique({
        where: { id: selfId },
        select: { workstation_id: true, sections: { select: { inputs: { select: { source_bucket_id: true } }, outputs: { select: { item_id: true } } } } },
      })
    : null;
  const options = await runOptions(
    stored
      ? {
          workstationId: stored.workstation_id,
          bucketIds: stored.sections.flatMap((s) => s.inputs.map((i) => i.source_bucket_id)),
          itemIds: stored.sections.flatMap((s) => s.outputs.map((o) => o.item_id)),
        }
      : null,
    db
  );
  const items = new Map(options.items.map((i) => [i.id, i]));
  const bucketById = new Map(options.buckets.map((b) => [b.id, b]));

  const wsId = Number(header.workstation_id) || null;
  const station = wsId ? options.workstations.find((w) => w.id === wsId) : undefined;
  if (!wsId) errors.workstation_id = "Pilih Workstation.";
  else if (!station || (!station.active && (forPosting || stored?.workstation_id !== wsId))) errors.workstation_id = "Workstation tidak ditemukan atau nonaktif.";
  const allowed = station ? kindsOfMode(station.mode) : [];
  const kind = header.kind && allowed.includes(header.kind) ? header.kind : null;
  if (station && !kind) errors.kind = header.kind ? `Cara Kerja ${station.label} tidak membolehkan jenis eksekusi ini.` : "Pilih jenis eksekusi.";
  const day = String(header.execution_date ?? "").trim();
  if (!DAY.test(day)) errors.execution_date = "Tanggal wajib diisi.";

  const raw = Array.isArray(sections) ? sections : [];
  if (!raw.length) errors._sections = "Tambahkan minimal satu section.";
  if (kind === "Mix" && raw.length > 1) errors._sections = "Mix hanya satu section: seluruh barang Partai menjadi satu lot.";

  const usedBucket = new Set<number>();
  const usedJob = new Set<number>();
  const outSections: CheckedSection[] = [];
  const partaiIds = new Set<number>();
  for (const [i, s] of raw.entries()) {
    const driver = parseDriver(s.driver);
    if (!driver) errors[key(i, "driver")] = "Driver berupa angka 0 atau lebih, paling banyak 4 desimal.";
    const ins: CheckedInput[] = [];
    for (const [j, l] of (Array.isArray(s.inputs) ? s.inputs : []).entries()) {
      const b = Number(l.bucket_id) ? bucketById.get(Number(l.bucket_id)) : undefined;
      if (!b) {
        errors[inKey(i, j, "bucket_id")] = "Barang tidak ditemukan di workstation. Pilih ulang.";
        continue;
      }
      if (b.inTransit || (wsId && b.workstationId !== wsId)) {
        errors[inKey(i, j, "bucket_id")] = `${b.itemLabel} lot ${b.lotNo} belum diterima di workstation ini.`;
        continue;
      }
      if (b.isReject) {
        errors[inKey(i, j, "bucket_id")] = `${b.itemLabel} lot ${b.lotNo} berstatus Reject: tidak dikerjakan lagi.`;
        continue;
      }
      if (usedBucket.has(b.id)) {
        errors[inKey(i, j, "bucket_id")] = `${b.itemLabel} lot ${b.lotNo} sudah dipakai di eksekusi ini.`;
        continue;
      }
      const qty = parseQty(l.qty);
      if (!qty) {
        errors[inKey(i, j, "qty")] = "Isi jumlah lebih dari 0, paling banyak 6 angka desimal.";
        continue;
      }
      if (qty.gt(b.qty)) {
        errors[inKey(i, j, "qty")] = `Melebihi saldo ${b.itemLabel} lot ${b.lotNo}: ${qtyText(b.qty)}.`;
        continue;
      }
      usedBucket.add(b.id);
      ins.push({ line_no: ins.length + 1, bucketId: b.id, lotId: b.lotId, itemId: b.itemId, lotNo: b.lotNo, qty, isMain: Boolean(l.is_main), jobId: b.jobId, partaiId: b.partaiId });
    }
    if (!ins.length && !Object.keys(errors).some((k) => k.startsWith(`sections.${i}.inputs`))) errors[key(i, "inputs")] = "Pilih barang yang dikerjakan.";
    for (const b of ins) if (b.partaiId != null) partaiIds.add(b.partaiId);
    // A section works one Job (AD3, AD20): the Job its inputs are in, if any.
    const jobIds = [...new Set(ins.flatMap((x) => (x.jobId != null ? [x.jobId] : [])))];
    if (kind !== "Mix" && jobIds.length > 1) errors[key(i, "inputs")] = "Satu section hanya untuk satu Job; pisahkan ke section lain.";
    const jobId = kind === "Mix" ? null : (jobIds[0] ?? null);
    if (jobId != null) {
      if (usedJob.has(jobId)) errors[key(i, "inputs")] = "Job ini sudah punya section di eksekusi ini.";
      usedJob.add(jobId);
    }

    const outs: CheckedOutput[] = [];
    const outRaw = Array.isArray(s.outputs) ? s.outputs : [];
    if (kind === "PassThrough") {
      const mains = ins.filter((x) => x.isMain);
      if (mains.length !== 1) errors[key(i, "inputs")] = "Pass-through: tandai tepat satu barang utama yang lotnya dipertahankan.";
      else {
        const m = mains[0];
        const b = bucketById.get(m.bucketId)!;
        if (!m.qty.eq(b.qty)) errors[inKey(i, ins.indexOf(m), "qty")] = `Barang utama pass-through diambil utuh: ${qtyText(b.qty)}.`;
      }
      if (outRaw.length !== 1) errors[key(i, "outputs")] = "Pass-through memiliki satu output: jumlah barang utama yang keluar.";
      else {
        const qty = parseQty(outRaw[0].qty);
        if (!qty) errors[outKey(i, 0, "qty")] = "Isi jumlah keluar lebih dari 0, paling banyak 6 angka desimal.";
        else if (mains.length === 1) outs.push({ line_no: 1, itemId: mains[0].itemId, lotNo: mains[0].lotNo, expiry: null, qty, status: "Available" });
      }
    } else if (kind === "Mix") {
      if (outRaw.length !== 1) errors[key(i, "outputs")] = "Mix memiliki satu output: lot baru dari seluruh barang Partai.";
      else {
        const o = outRaw[0];
        const item = Number(o.item_id) ? items.get(Number(o.item_id)) : undefined;
        const qty = parseQty(o.qty);
        if (!item || (!item.active && forPosting)) errors[outKey(i, 0, "item_id")] = "Pilih Barang aktif dengan Kelola Stok.";
        if (!qty) errors[outKey(i, 0, "qty")] = "Isi jumlah lebih dari 0, paling banyak 6 angka desimal.";
        if (item && qty) outs.push({ line_no: 1, itemId: item.id, lotNo: null, expiry: o.expiry_date ? asDate(o.expiry_date) : null, qty, status: "Available" });
      }
    } else if (kind === "Transform") {
      if (!outRaw.length) errors[key(i, "outputs")] = "Tambahkan minimal satu output.";
      for (const [j, o] of outRaw.entries()) {
        const item = Number(o.item_id) ? items.get(Number(o.item_id)) : undefined;
        if (!Number(o.item_id)) {
          errors[outKey(i, j, "item_id")] = "Pilih barang.";
          continue;
        }
        if (!item || (!item.active && forPosting)) {
          errors[outKey(i, j, "item_id")] = "Hanya Barang aktif dengan Kelola Stok yang dapat dihasilkan.";
          continue;
        }
        const qty = parseQty(o.qty);
        if (!qty) {
          errors[outKey(i, j, "qty")] = "Isi jumlah lebih dari 0, paling banyak 6 angka desimal.";
          continue;
        }
        const status: ExecutionOutputStatus = o.status === "Reject" ? "Reject" : "Available";
        if (o.expiry_date && !DAY.test(o.expiry_date)) {
          errors[outKey(i, j, "expiry_date")] = "Tanggal kadaluarsa tidak valid.";
          continue;
        }
        if (forPosting && item.hasExpiry && !o.expiry_date) {
          errors[outKey(i, j, "expiry_date")] = `${item.label} memiliki kadaluarsa: isi tanggal kadaluarsa.`;
          continue;
        }
        outs.push({ line_no: outs.length + 1, itemId: item.id, lotNo: text(o.lot_no)?.toUpperCase() ?? null, expiry: o.expiry_date ? asDate(o.expiry_date) : null, qty, status });
      }
    }
    outSections.push({ section_no: i + 1, driver: driver ?? new D(0), inputs: ins, outputs: outs, jobId });
  }

  // One Partai at most among everything worked (M112); the lots a run makes are new in the one register (M128).
  if (partaiIds.size > 1) errors._sections = "Input berasal dari lebih dari satu Partai; Partai tidak pernah digabung.";
  const typed = outSections.flatMap((s) => s.outputs.flatMap((o) => (o.lotNo && kind !== "PassThrough" ? [o.lotNo] : [])));
  if (new Set(typed).size !== typed.length) errors._sections = "Nomor lot output dipakai dua kali di eksekusi ini.";
  for (const no of typed) {
    if (await lotNumberTaken(no, db)) errors._sections = `Lot ${no} sudah tercatat; lot hasil eksekusi selalu baru.`;
  }
  if (kind === "Transform" || kind === "Mix") {
    for (const [i, s] of outSections.entries()) {
      if (!s.outputs.length) continue;
      const w = sectionWeights(s.outputs.map((o) => ({ itemId: o.itemId, qty: o.qty.toNumber(), status: o.status })), items);
      if ("error" in w) errors[key(i, "outputs")] = w.error;
    }
  }
  // Mix takes the whole Partai at the station (M125): every received bucket of it, every gram.
  if (kind === "Mix" && station && outSections.length === 1 && partaiIds.size === 1 && !errors._sections) {
    const partaiId = [...partaiIds][0];
    const taken = new Map(outSections[0].inputs.map((x) => [x.bucketId, x.qty]));
    const missing = options.buckets.filter((b) => b.partaiId === partaiId && b.workstationId === station.id && !b.inTransit && !b.isReject && !(taken.get(b.id)?.eq(b.qty) ?? false));
    if (missing.length) errors[key(0, "inputs")] = `Mix mengambil seluruh barang Partai: ${missing[0].itemLabel} lot ${missing[0].lotNo} masih ${qtyText(missing[0].qty)}${missing.length > 1 ? ` (dan ${missing.length - 1} lainnya)` : ""}.`;
  }
  if (kind === "Mix" && partaiIds.size === 0 && outSections.length === 1 && outSections[0].inputs.length) errors[key(0, "inputs")] = "Mix memerlukan barang yang sudah punya Partai.";

  if (Object.keys(errors).some((k) => k.startsWith("sections.")) && !errors._sections) errors._sections = "Ada section yang perlu diperbaiki.";
  if (Object.keys(errors).length || !station || !kind) return { ok: false, errors };
  return {
    ok: true,
    c: {
      data: { execution_date: asDate(day), kind, workstation_id: station.id, note: text(header.note) },
      station,
      sections: outSections,
      partaiId: partaiIds.size ? [...partaiIds][0] : null,
      items,
    },
  };
}

// ------------------------------------------------------------------ writes

async function nextRunNo(db: Db, unit: string, date: Date): Promise<string> {
  // `NG_<unit>_<DDMMYY>_<NNNNN>`, the unit's series (M124).
  return nextDailyNumber(["NG", unit], date, async (series) => {
    const row = await db.prdExecution.findFirst({ where: { execution_no: { startsWith: series } }, orderBy: { id: "desc" }, select: { execution_no: true } });
    return row?.execution_no ?? null;
  });
}

async function audit(db: Db, id: number, action: "TAMBAH" | "UPDATE", event: string, by: number) {
  await db.auditLog.create({ data: { entity_key: "prd_execution", row_id: id, action, event, by } });
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
    if (e instanceof ProductionRefusal) return { ok: false, errors: { _form: `Belum bisa diproses: ${e.message}` } };
    if (e instanceof PostingDryRun) return { ok: true, journal: e.lines } as T;
    throw e;
  }
}

/** A Draft's sections are rewritten whole: nothing names them yet. */
async function writeSections(tx: Prisma.TransactionClient, executionId: number, c: Checked) {
  await tx.prdExecutionSection.deleteMany({ where: { execution_id: executionId } });
  for (const s of c.sections) {
    await tx.prdExecutionSection.create({
      data: {
        execution_id: executionId,
        section_no: s.section_no,
        driver: s.driver,
        inputs: {
          create: s.inputs.map((x) => ({ line_no: x.line_no, source_bucket_id: x.bucketId, lot_id: x.lotId, item_id: x.itemId, lot_no: x.lotNo, qty: x.qty, is_main: x.isMain })),
        },
        outputs: {
          create: s.outputs.map((o) => ({ line_no: o.line_no, item_id: o.itemId, lot_no: o.lotNo, expiry_date: o.expiry, qty: o.qty, status: o.status })),
        },
      },
    });
  }
}

export async function createRun(header: RunHeaderInput, sections: RunSectionInput[], actorId: number): Promise<RunResult> {
  return refusable(async () => {
    const made = await prisma.$transaction(async (tx) => {
      const r = await checkRun(tx, header, sections, null);
      if (!r.ok) throw new Refused(r.errors);
      const row = await tx.prdExecution.create({
        data: { ...r.c.data, execution_no: await nextRunNo(tx, r.c.station.label, r.c.data.execution_date), created_by: actorId },
      });
      await writeSections(tx, row.id, r.c);
      await audit(tx, row.id, "TAMBAH", "create", actorId);
      return row;
    });
    return { ok: true as const, id: made.id, executionNo: made.execution_no };
  });
}

export async function updateRun(id: number, header: RunHeaderInput, sections: RunSectionInput[], actorId: number): Promise<RunResult> {
  const current = await prisma.prdExecution.findUnique({ where: { id }, select: { status: true, execution_no: true, workstation_id: true, execution_date: true } });
  if (!current) return { ok: false, errors: { _form: "Eksekusi tidak ditemukan." } };
  if (!executionIsEditable(current.status as ExecutionStatus)) return { ok: false, errors: { _form: "Eksekusi yang sudah diposting atau dibatalkan tidak dapat diubah." } };
  return refusable(async () => {
    const no = await prisma.$transaction(async (tx) => {
      const r = await checkRun(tx, header, sections, id);
      if (!r.ok) throw new Refused(r.errors);
      // The number carries the unit and the day: a Draft that changes either takes the next of its new series.
      const renumber = r.c.data.workstation_id !== current.workstation_id || r.c.data.execution_date.getTime() !== current.execution_date.getTime();
      const execution_no = renumber ? await nextRunNo(tx, r.c.station.label, r.c.data.execution_date) : current.execution_no;
      const done = await tx.prdExecution.updateMany({ where: { id, status: "Draft" }, data: { ...r.c.data, execution_no, updated_by: actorId } });
      if (done.count !== 1) throw new Refused({ _form: "Eksekusi berubah saat diproses. Muat ulang halaman." });
      await writeSections(tx, id, r.c);
      await audit(tx, id, "UPDATE", "update", actorId);
      return execution_no;
    });
    return { ok: true as const, id, executionNo: no };
  });
}

const WITH_ALL = {
  sections: { orderBy: { section_no: "asc" as const }, include: { inputs: { orderBy: { line_no: "asc" as const } }, outputs: { orderBy: { line_no: "asc" as const } } } },
  costs: { orderBy: { id: "asc" as const } },
};
type Stored = Prisma.PrdExecutionGetPayload<{ include: typeof WITH_ALL }>;

function asInput(e: Stored): { header: RunHeaderInput; sections: RunSectionInput[] } {
  return {
    header: { execution_date: isoDay(e.execution_date), kind: e.kind as ExecutionKind, workstation_id: e.workstation_id, note: e.note ?? "" },
    sections: e.sections.map((s) => ({
      driver: s.driver.toString(),
      inputs: s.inputs.map((x) => ({ bucket_id: x.source_bucket_id, qty: x.qty.toString(), is_main: x.is_main })),
      outputs: s.outputs.map((o) => ({
        item_id: o.item_id,
        qty: o.qty.toString(),
        lot_no: o.lot_no ?? "",
        expiry_date: isoDay(o.expiry_date),
        status: o.status as ExecutionOutputStatus,
      })),
    })),
  };
}

// --------------------------------------------------------------- lifecycle

export type RunTransitionResult =
  | { ok: true; /** Only on a dry run: the journal Posting would write. */ journal?: JournalLineInput[] }
  | { ok: false; errors: Record<string, string> };

/** The WIP account of each item's Kategori Item, with no fallback (M62); a missing one is named. */
async function wipAccounts(itemIds: number[]): Promise<{ ok: true; accounts: Map<number, number> } | { ok: false; error: string }> {
  const byItem = await accountsForItems([...new Set(itemIds)]);
  const accounts = new Map<number, number>();
  for (const [itemId, a] of byItem) {
    if (!a.wip) {
      const item = await prisma.mItem.findUnique({ where: { id: itemId }, select: { item_label: true, category: { select: { category_label: true } } } });
      return { ok: false, error: `Lengkapi Account Kategori Item ${item?.category.category_label ?? ""} dulu: Account WIP untuk ${item?.item_label ?? "barang"}.` };
    }
    accounts.set(itemId, a.wip);
  }
  return { ok: true, accounts };
}

/** round(driver × rate), half up, whole rupiah (M92). */
const standardOf = (driver: Dec, rate: number) => driver.mul(rate).toDecimalPlaces(0, D.ROUND_HALF_UP);

/**
 * The journal Posting would write now, for its dialog (P103): `transitionRun`
 * run as a dry run — the recheck, every ledger movement, the journal — rolled back.
 */
export async function runPreview(id: number, actorId: number): Promise<JournalPreviewResult> {
  try {
    const r = await transitionRun(id, "post", actorId, undefined, { dryRun: true });
    if (!r.ok) return r;
    return { ok: true, lines: await describeJournalLines(r.journal ?? []) };
  } catch (e) {
    if (e instanceof Error) return { ok: false, errors: { _form: e.message } };
    throw e;
  }
}

/**
 * Runs one lifecycle step. **Posting**, in one transaction: rechecks the stored
 * run, then per section takes the inputs and puts out the outputs through the
 * production ledger (`produce`, or `passThrough` keeping the lot), books each
 * Standard Cost Item's round(Driver × rate) into WIP and stores what every input
 * released and every output carries; writes the journal and the standard's
 * snapshot. **Batalkan** (Draft only) asks for a reason and writes nothing else.
 * A dry run rolls everything back and returns the journal.
 */
export async function transitionRun(id: number, action: ExecutionAction, actorId: number, reason?: string, options: { dryRun?: boolean } = {}): Promise<RunTransitionResult> {
  const run = await prisma.prdExecution.findUnique({ where: { id }, include: WITH_ALL });
  if (!run) return { ok: false, errors: { _form: "Eksekusi tidak ditemukan." } };
  const t = EXECUTION_TRANSITIONS[action];
  if (!executionTransitionAllowed(action, run.status as ExecutionStatus)) return { ok: false, errors: { _form: `Eksekusi berstatus ini tidak dapat di-${t.label.toLowerCase()}.` } };
  const moved = "Eksekusi berubah saat diproses. Muat ulang halaman.";
  let why: string | null = null;
  if (t.reason) {
    why = String(reason ?? "").trim();
    if (!why) return { ok: false, errors: { reason: "Alasan wajib diisi." } };
  }
  if (action === "cancel") {
    await prisma.$transaction(async (tx) => {
      const done = await tx.prdExecution.updateMany({ where: { id, status: "Draft" }, data: { status: "Cancelled", cancel_reason: why, updated_by: actorId } });
      if (done.count !== 1) throw new Error(moved);
      await audit(tx, id, "UPDATE", "cancel", actorId);
    });
    return { ok: true };
  }

  const period = await checkTransactionDate(isoDay(run.execution_date));
  if (!period.ok) return { ok: false, errors: { _form: period.message } };
  const baseCurrency = await prisma.refCurrency.findFirst({ where: { currency_label: BASE_CURRENCY_LABEL }, select: { id: true } });
  if (!baseCurrency) return { ok: false, errors: { _form: "Mata uang dasar tidak ditemukan." } };

  return refusable(async () => {
    const input = asInput(run);
    let journalOut: JournalLineInput[] = [];
    await prisma.$transaction(async (tx) => {
      const r = await checkRun(tx, input.header, input.sections, id, true);
      if (!r.ok) {
        const first = Object.entries(r.errors).find(([k]) => k !== "_sections")?.[1] ?? r.errors._sections;
        throw new Refused({ _form: `Belum bisa diposting: ${first}` });
      }
      const done = await tx.prdExecution.updateMany({ where: { id, status: "Draft" }, data: { status: "Posted", updated_by: actorId } });
      if (done.count !== 1) throw new Refused({ _form: moved });

      const c = r.c;
      const date = c.data.execution_date;
      const source = { docTypeId: await docTypeId(tx, "prd_execution"), docId: id, no: run.execution_no };
      const station = c.station;
      // The standard in force at the station on the run's day (M109): none reads as no standard.
      const std = c.data.kind === "Mix" ? [] : (await standardCostFor(station.id, isoDay(date), tx)).rates;
      const stdTotal = new Map<number, { rate: number; accountId: number; driver: Dec; amount: Dec }>();
      const partai = c.partaiId ? ((await productionIdentityNumbers({ partaiIds: [c.partaiId] }, tx)).partai.get(c.partaiId) ?? "") : "";

      const wip = await wipAccounts([...c.sections.flatMap((s) => [...s.inputs.map((x) => x.itemId), ...s.outputs.map((o) => o.itemId)])]);
      if (!wip.ok) throw new Refused({ _form: wip.error });

      const net = new Map<number, Dec>(); // account → outputs − inputs
      const add = (account: number, v: Dec) => net.set(account, (net.get(account) ?? new D(0)).add(v));
      const takenLots = new Set<string>();
      let standardSum = new D(0);
      let totalValue = new D(0);
      let partaiId: number | null = c.partaiId;

      for (const sec of c.sections) {
        const secStd = std.map((s) => ({ ...s, amount: standardOf(sec.driver, s.rate) }));
        const secStdAmount = secStd.reduce((a, s) => a.add(s.amount), new D(0));
        const stored = await tx.prdExecutionSection.findUniqueOrThrow({
          where: { execution_id_section_no: { execution_id: id, section_no: sec.section_no } },
          include: { inputs: { orderBy: { line_no: "asc" } }, outputs: { orderBy: { line_no: "asc" } } },
        });
        for (const s of secStd) {
          const had = stdTotal.get(s.itemId);
          stdTotal.set(s.itemId, { rate: s.rate, accountId: s.accountId, driver: (had?.driver ?? new D(0)).add(sec.driver), amount: (had?.amount ?? new D(0)).add(s.amount) });
        }

        if (c.data.kind === "PassThrough") {
          const main = sec.inputs.find((x) => x.isMain)!;
          const extras = sec.inputs.filter((x) => !x.isMain);
          const out = sec.outputs[0];
          const res = await passThrough(tx, {
            workstationId: station.id,
            main: { bucketId: main.bucketId, outQty: out.qty.toString() },
            extras: extras.map((x) => ({ bucketId: x.bucketId, baseQty: x.qty.toString() })),
            addedValue: secStdAmount.toNumber(),
            date,
            source,
            actorId,
          });
          partaiId = partaiId ?? res.partaiId;
          const valueOf = new Map<number, number>([[main.bucketId, res.inValue], ...res.extras.map((x) => [x.bucketId, x.value] as [number, number])]);
          for (const x of stored.inputs) await tx.prdExecutionInput.update({ where: { id: x.id }, data: { cost_amount: valueOf.get(x.source_bucket_id) ?? 0 } });
          await tx.prdExecutionOutput.update({
            where: { id: stored.outputs[0].id },
            data: { lot_id: res.lotId, bucket_id: res.bucketId, cost_amount: res.outValue, weight: 1 },
          });
          for (const x of sec.inputs) add(wip.accounts.get(x.itemId)!, new D(valueOf.get(x.bucketId) ?? 0).neg());
          add(wip.accounts.get(res.itemId)!, new D(res.outValue));
          await tx.prdExecutionSection.update({ where: { id: stored.id }, data: { job_id: res.jobId, standard_amount: secStdAmount } });
          totalValue = totalValue.add(res.outValue);
        } else {
          // Transform and Mix: outputs are new lots, numbered before anything is written.
          const lotIds = sec.inputs.map((x) => x.lotId);
          const supplierId = carriedSupplier(await lotSupplierIds(lotIds, tx));
          const supplier = supplierId ? (await tx.mPartner.findUnique({ where: { id: supplierId }, select: { partner_label: true } }))?.partner_label : null;
          const outs: { itemId: number; lotNo: string; expiry: Date | null; qty: Dec; status: ExecutionOutputStatus; weight: number }[] = [];
          const w = sectionWeights(sec.outputs.map((o) => ({ itemId: o.itemId, qty: o.qty.toNumber(), status: o.status })), c.items);
          if ("error" in w) throw new Refused({ _form: w.error });
          for (const [j, o] of sec.outputs.entries()) {
            const item = c.items.get(o.itemId)!;
            const base = o.lotNo ?? (c.data.kind === "Mix" ? mixLotNumber(partai, item.label) : lotNumberBase({ unit: station.label, supplier, itemCode: item.label, date }));
            const lotNo = o.lotNo
              ? o.lotNo
              : await freeNumber(base, async (no) => takenLots.has(no) || (await lotNumberTaken(no, tx)));
            takenLots.add(lotNo);
            outs.push({ itemId: o.itemId, lotNo, expiry: o.expiry, qty: o.qty, status: o.status, weight: w.weights[j] });
          }
          const res = await produce(tx, {
            workstationId: station.id,
            inputs: sec.inputs.map((x) => ({ bucketId: x.bucketId, baseQty: x.qty.toString() })),
            outputs: outs.map((o) => ({ itemId: o.itemId, lotNo: o.lotNo, expiry: o.expiry, baseQty: o.qty.toString(), weight: o.weight, jobId: sec.jobId, reject: o.status === "Reject" })),
            addedValue: secStdAmount.toNumber(),
            date,
            source,
            actorId,
          });
          partaiId = partaiId ?? res.partaiId;
          for (const [j, x] of stored.inputs.entries()) await tx.prdExecutionInput.update({ where: { id: x.id }, data: { cost_amount: res.inputs[j].value } });
          for (const [j, o] of stored.outputs.entries()) {
            await tx.prdExecutionOutput.update({
              where: { id: o.id },
              data: { lot_no: outs[j].lotNo, weight: outs[j].weight, cost_amount: res.outputs[j].value, lot_id: res.outputs[j].lotId, bucket_id: res.outputs[j].bucketId },
            });
            add(wip.accounts.get(outs[j].itemId)!, new D(res.outputs[j].value));
            totalValue = totalValue.add(res.outputs[j].value);
          }
          for (const [j, x] of sec.inputs.entries()) add(wip.accounts.get(x.itemId)!, new D(res.inputs[j].value).neg());
          await tx.prdExecutionSection.update({ where: { id: stored.id }, data: { job_id: sec.jobId, standard_amount: secStdAmount } });
        }
        standardSum = standardSum.add(secStdAmount);
      }

      // The journal: WIP by account (outputs − inputs), the standard credited to its accounts with the station's Cost Center.
      const lines: JournalLineInput[] = [];
      const what = `${run.execution_no} · ${station.label}`;
      for (const [accountId, v] of net) {
        if (v.isZero()) continue;
        lines.push({ accountId, currencyId: baseCurrency.id, rate: 1, debit: v.gt(0) ? v.toNumber() : 0, credit: v.lt(0) ? v.neg().toNumber() : 0, description: `WIP ${what}` });
      }
      for (const [, s] of stdTotal) {
        if (s.amount.isZero()) continue;
        lines.push({ accountId: s.accountId, costCenterId: station.costCenterId, currencyId: baseCurrency.id, rate: 1, debit: 0, credit: s.amount.toNumber(), description: `Biaya standar ${what}` });
      }
      const journal = lines.length
        ? await postJournal(tx, { description: `${what} · Eksekusi Produksi`, sourceDocTypeId: source.docTypeId, sourceDocId: id, postingDate: date, actorId, lines })
        : null;
      for (const [standard_cost_item_id, s] of stdTotal) {
        await tx.prdExecutionCost.create({ data: { execution_id: id, standard_cost_item_id, account_id: s.accountId, cost_center_id: station.costCenterId, rate: s.rate, driver: s.driver, amount: s.amount } });
      }
      await tx.prdExecution.update({ where: { id }, data: { journal_id: journal?.id ?? null, partai_id: partaiId, standard_amount: standardSum, total_value: totalValue } });
      await audit(tx, id, "UPDATE", "post", actorId);
      journalOut = lines;
      if (options.dryRun) throw new PostingDryRun(lines);
    });
    return { ok: true as const, journal: journalOut };
  });
}

// ------------------------------------------------------------------- reads

export type RunListRow = {
  id: number;
  executionNo: string;
  executionDate: string;
  status: ExecutionStatus;
  kind: ExecutionKind;
  stationLabel: string;
  stationName: string;
  partaiNo: string | null;
  sections: number;
  totalValue: number;
};

export async function listRuns(): Promise<RunListRow[]> {
  const rows = await prisma.prdExecution.findMany({
    orderBy: [{ execution_date: "desc" }, { id: "desc" }],
    include: { workstation: true, _count: { select: { sections: true } } },
  });
  const ids = await productionIdentityNumbers({ partaiIds: rows.flatMap((r) => (r.partai_id ? [r.partai_id] : [])) });
  return rows.map((r) => ({
    id: r.id,
    executionNo: r.execution_no,
    executionDate: isoDay(r.execution_date),
    status: r.status as ExecutionStatus,
    kind: r.kind as ExecutionKind,
    stationLabel: r.workstation.workstation_label,
    stationName: r.workstation.workstation_name,
    partaiNo: r.partai_id ? (ids.partai.get(r.partai_id) ?? null) : null,
    sections: r._count.sections,
    totalValue: r.total_value.toNumber(),
  }));
}

export type RunView = {
  id: number;
  executionNo: string;
  status: ExecutionStatus;
  header: RunHeaderInput;
  sections: RunSectionInput[];
  partaiNo: string | null;
  cancelReason: string | null;
  journalId: number | null;
  journalNo: string | null;
  standard: number;
  totalValue: number;
  /** As stored at Posting, per section in order: the Job, its standard and what each line moved. */
  posted: {
    jobNo: string | null;
    standard: number;
    inputs: { itemLabel: string; itemName: string; lotNo: string; qty: number; cost: number; isMain: boolean }[];
    outputs: { itemLabel: string; itemName: string; lotNo: string; qty: number; status: ExecutionOutputStatus; weight: number; cost: number }[];
  }[];
  costs: { itemLabel: string; rate: number; driver: number; amount: number }[];
};

export async function getRun(id: number): Promise<RunView | null> {
  const e = await prisma.prdExecution.findUnique({ where: { id }, include: WITH_ALL });
  if (!e) return null;
  const input = asInput(e);
  const itemIds = e.sections.flatMap((s) => [...s.inputs.map((x) => x.item_id), ...s.outputs.map((o) => o.item_id)]);
  const [items, ids, journalNos, costItems] = await Promise.all([
    prisma.mItem.findMany({ where: { id: { in: itemIds } }, select: { id: true, item_label: true, item_name: true } }),
    productionIdentityNumbers({ partaiIds: e.partai_id ? [e.partai_id] : [], jobIds: e.sections.flatMap((s) => (s.job_id ? [s.job_id] : [])) }),
    e.journal_id ? journalNumbersByIds([e.journal_id]) : new Map<number, string>(),
    standardCostItemLabels(e.costs.map((c) => c.standard_cost_item_id)),
  ]);
  const itemBy = new Map(items.map((i) => [i.id, i]));
  const costBy = costItems;
  return {
    id: e.id,
    executionNo: e.execution_no,
    status: e.status as ExecutionStatus,
    header: input.header,
    sections: input.sections,
    partaiNo: e.partai_id ? (ids.partai.get(e.partai_id) ?? null) : null,
    cancelReason: e.cancel_reason,
    journalId: e.journal_id,
    journalNo: e.journal_id ? (journalNos.get(e.journal_id) ?? null) : null,
    standard: e.standard_amount.toNumber(),
    totalValue: e.total_value.toNumber(),
    posted: e.sections.map((s) => ({
      jobNo: s.job_id ? (ids.jobs.get(s.job_id) ?? null) : null,
      standard: s.standard_amount.toNumber(),
      inputs: s.inputs.map((x) => ({ itemLabel: itemBy.get(x.item_id)?.item_label ?? "", itemName: itemBy.get(x.item_id)?.item_name ?? "", lotNo: x.lot_no, qty: x.qty.toNumber(), cost: x.cost_amount.toNumber(), isMain: x.is_main })),
      outputs: s.outputs.map((o) => ({
        itemLabel: itemBy.get(o.item_id)?.item_label ?? "",
        itemName: itemBy.get(o.item_id)?.item_name ?? "",
        lotNo: o.lot_no ?? "",
        qty: o.qty.toNumber(),
        status: o.status as ExecutionOutputStatus,
        weight: o.weight.toNumber(),
        cost: o.cost_amount.toNumber(),
      })),
    })),
    costs: e.costs.map((c) => ({ itemLabel: costBy.get(c.standard_cost_item_id) ?? "", rate: c.rate.toNumber(), driver: c.driver.toNumber(), amount: c.amount.toNumber() })),
  };
}

/** What a stored run's form must keep readable, whatever its status now. */
export function runCurrent(v: RunView): RunCurrent {
  return {
    workstationId: Number(v.header.workstation_id),
    bucketIds: v.sections.flatMap((s) => s.inputs.map((x) => Number(x.bucket_id))),
    itemIds: v.sections.flatMap((s) => s.outputs.map((o) => Number(o.item_id))),
  };
}

/** Execution numbers by id, for the audit panel. */
export async function runNumbersByIds(ids: number[]): Promise<Map<number, string>> {
  const rows = await prisma.prdExecution.findMany({ where: { id: { in: ids } }, select: { id: true, execution_no: true } });
  return new Map(rows.map((r) => [r.id, r.execution_no]));
}

/** The buckets a stored run named, for the form to show what is now left of them. */
export async function runSourceBuckets(v: RunView): Promise<BucketView[]> {
  return bucketsByIds(v.sections.flatMap((s) => s.inputs.map((x) => Number(x.bucket_id))));
}
