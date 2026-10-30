import "server-only";

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { BASE_CURRENCY_LABEL } from "./currency";
import { nextDocumentNumber } from "./document-number";
import { checkTransactionDate } from "./fiscal";
import { PostingDryRun, describeJournalLines, journalNumbersByIds, postJournal, type JournalLineInput, type JournalPreviewResult } from "./journal";
import { lotNumberTaken, produce } from "./production-ledger";
import { outputWeight } from "./production-execution";
import {
  DAY,
  Refused,
  asDate,
  bucketOptions,
  checkBucketLines,
  docTypeId,
  firstError,
  fourDecimals,
  fromUnits,
  isoDay,
  itemAccounts,
  parseQty,
  refusable,
  text,
  units,
  workstationOptions,
  type BucketLineInput,
  type BucketOption,
  type Db,
  type Place,
  type PostResult,
} from "./production-doc";
import { EXECUTION_WORKFLOW, prodDocIsEditable, prodDocTransitionAllowed, type ProdDocAction, type ProdDocStatus } from "./production-doc-workflow";

/**
 * Eksekusi Produksi (R5, R6, R11, R17; `prd_execution(_input, _output)`,
 * `EKS/YYYY/MM/NNNN`) — transformation only: at one workstation, inputs (any
 * lots held there, any quantity) are consumed and each output is a **new
 * lot**. Its value is Σ input value shared over the outputs by **qty × Bobot
 * Nilai** (largest remainder); an output weighing 0 takes nothing, and an
 * execution whose outputs all weigh 0 is refused. An output lot number is
 * typed, or `<execution number>-<n>` at posting; one the item already has is
 * refused. **Driver** (> 0) is the execution's share of the month's cost pool
 * at the close (R11).
 *
 * Posting writes the production ledger and, only where input and output WIP
 * accounts differ, one journal moving value between them; dry-run preview
 * (P103). Named only by this module.
 */

export type ExecutionOutputInput = { item_id: number | null; lot_no: string; expiry_date: string; qty: number | string };

export type ExecutionInput = {
  execution_date: string;
  workstation_id: number | null;
  driver: number | string;
  note: string;
  inputs: BucketLineInput[];
  outputs: ExecutionOutputInput[];
};

export type ExecutionResult = { ok: true; id: number; no: string } | { ok: false; errors: Record<string, string> };

export type OutputItem = { id: number; label: string; name: string; uomLabel: string; valueWeight: number | null; hasExpiry: boolean; active: boolean };

export type ExecutionOptions = { workstations: Place[]; buckets: BucketOption[]; items: OutputItem[] };

export async function executionOptions(current: { workstationId: number; bucketIds: number[]; itemIds: number[] } | null = null, db: Db = prisma): Promise<ExecutionOptions> {
  const [workstations, buckets, items] = await Promise.all([
    workstationOptions(current ? [current.workstationId] : [], db),
    bucketOptions(current?.bucketIds ?? [], db),
    db.mItem.findMany({
      where: { item_type: "Barang", track_stock: true, OR: [{ status: "Active" }, ...(current?.itemIds.length ? [{ id: { in: current.itemIds } }] : [])] },
      orderBy: { item_label: "asc" },
      select: { id: true, item_label: true, item_name: true, status: true, value_weight: true, has_expiry: true, base_uom: { select: { uom_label: true } } },
    }),
  ]);
  return {
    workstations,
    buckets,
    items: items.map((i) => ({
      id: i.id,
      label: i.item_label,
      name: i.item_name,
      uomLabel: i.base_uom.uom_label,
      valueWeight: i.value_weight?.toNumber() ?? null,
      hasExpiry: i.has_expiry,
      active: i.status === "Active",
    })),
  };
}

// ------------------------------------------------------------- validation

type CheckedOutput = { line_no: number; item_id: number; lot_no: string | null; expiry_date: Date | null; qty: number; weight: number };
type Checked = {
  data: { execution_date: Date; workstation_id: number; driver: number; note: string | null };
  workstationLabel: string;
  inputs: ReturnType<typeof checkBucketLines>;
  outputs: CheckedOutput[];
};

/** Every rule an execution must satisfy to be saved — and, run again with `forPosting`, to be posted. */
export async function checkExecution(db: Db, input: ExecutionInput, selfId: number | null, forPosting = false): Promise<{ ok: true; c: Checked } | { ok: false; errors: Record<string, string> }> {
  const errors: Record<string, string> = {};
  const stored = selfId
    ? await db.prdExecution.findUnique({ where: { id: selfId }, select: { workstation_id: true, inputs: { select: { bucket_id: true } }, outputs: { select: { item_id: true } } } })
    : null;
  const options = await executionOptions(
    stored ? { workstationId: stored.workstation_id, bucketIds: stored.inputs.map((i) => i.bucket_id), itemIds: stored.outputs.map((o) => o.item_id) } : null,
    db
  );
  const date = String(input.execution_date ?? "").trim();
  if (!DAY.test(date)) errors.execution_date = "Tanggal wajib diisi.";
  const wsId = Number(input.workstation_id) || null;
  const ws = wsId ? options.workstations.find((w) => w.id === wsId) : undefined;
  if (!wsId) errors.workstation_id = "Pilih Workstation.";
  else if (!ws || (!ws.active && (forPosting || stored?.workstation_id !== wsId))) errors.workstation_id = "Workstation tidak ditemukan atau nonaktif.";
  const driver = parseQty(input.driver);
  if (!Number.isFinite(driver) || !(driver > 0)) errors.driver = "Driver wajib diisi, lebih dari 0.";
  else if (!fourDecimals(driver)) errors.driver = "Paling banyak 4 angka desimal.";

  if (!input.inputs?.length) errors._inputs = "Tambahkan minimal satu input.";
  const inputs = checkBucketLines(input.inputs, options.buckets, ws?.id ?? null, "inputs", errors);

  const itemById = new Map(options.items.map((i) => [i.id, i]));
  const outputs: CheckedOutput[] = [];
  if (!input.outputs?.length) errors._outputs = "Tambahkan minimal satu output.";
  const lotsTaken = new Set<string>();
  for (const [i, o] of (input.outputs ?? []).entries()) {
    const key = (f: string) => `outputs.${i}.${f}`;
    const item = itemById.get(Number(o.item_id));
    if (!item) {
      errors[key("item_id")] = "Pilih barang output.";
      continue;
    }
    if (!item.active && forPosting) {
      errors[key("item_id")] = `${item.label} nonaktif.`;
      continue;
    }
    const qty = parseQty(o.qty);
    if (!Number.isFinite(qty) || !(qty > 0)) {
      errors[key("qty")] = "Isi jumlah lebih dari 0.";
      continue;
    }
    if (!fourDecimals(qty)) {
      errors[key("qty")] = "Paling banyak 4 angka desimal.";
      continue;
    }
    const lotNo = String(o.lot_no ?? "").trim().toUpperCase() || null;
    if (lotNo) {
      if (lotsTaken.has(`${item.id}:${lotNo}`)) {
        errors[key("lot_no")] = `Lot ${lotNo} dipakai dua kali.`;
        continue;
      }
      lotsTaken.add(`${item.id}:${lotNo}`);
      if (await lotNumberTaken(item.id, lotNo, db)) {
        errors[key("lot_no")] = `${item.label} sudah punya lot ${lotNo}; lot output selalu baru.`;
        continue;
      }
    }
    const expiry = String(o.expiry_date ?? "").trim();
    if (expiry && !DAY.test(expiry)) {
      errors[key("expiry_date")] = "Tanggal tidak dikenali.";
      continue;
    }
    if (item.hasExpiry && !expiry && forPosting) {
      errors[key("expiry_date")] = `${item.label} memiliki kadaluarsa: isi tanggalnya.`;
      continue;
    }
    const q = fromUnits(units(qty));
    outputs.push({ line_no: outputs.length + 1, item_id: item.id, lot_no: lotNo, expiry_date: expiry ? asDate(expiry) : null, qty: q, weight: outputWeight(q, item.valueWeight) });
  }
  if (outputs.length && outputs.length === (input.outputs ?? []).length && !outputs.some((o) => o.weight > 0)) {
    errors._outputs = "Semua output berbobot 0: isi Bobot Nilai pada barang output, minimal satu.";
  }
  if (!errors._inputs && Object.keys(errors).some((k) => k.startsWith("inputs."))) errors._inputs = "Ada input yang perlu diperbaiki.";
  if (!errors._outputs && Object.keys(errors).some((k) => k.startsWith("outputs."))) errors._outputs = "Ada output yang perlu diperbaiki.";
  if (Object.keys(errors).length || !ws) return { ok: false, errors };
  return {
    ok: true,
    c: { data: { execution_date: asDate(date), workstation_id: ws.id, driver: fromUnits(units(driver)), note: text(input.note) }, workstationLabel: ws.label, inputs, outputs },
  };
}

// ------------------------------------------------------------------ writes

async function nextNo(db: Db, date: Date): Promise<string> {
  return nextDocumentNumber("EKS", date, async (series) => {
    const row = await db.prdExecution.findFirst({ where: { execution_no: { startsWith: series } }, orderBy: { id: "desc" }, select: { execution_no: true } });
    return row?.execution_no ?? null;
  });
}

async function audit(db: Db, id: number, action: "TAMBAH" | "UPDATE", event: string, by: number) {
  await db.auditLog.create({ data: { entity_key: "prd_execution", row_id: id, action, event, by } });
}

async function writeLines(tx: Prisma.TransactionClient, id: number, c: Checked) {
  await tx.prdExecutionInput.deleteMany({ where: { execution_id: id } });
  await tx.prdExecutionOutput.deleteMany({ where: { execution_id: id } });
  for (const l of c.inputs) await tx.prdExecutionInput.create({ data: { execution_id: id, line_no: l.line_no, bucket_id: l.bucket_id, lot_id: l.lot_id, item_id: l.item_id, qty: l.qty } });
  for (const o of c.outputs) {
    await tx.prdExecutionOutput.create({ data: { execution_id: id, line_no: o.line_no, item_id: o.item_id, lot_no: o.lot_no, expiry_date: o.expiry_date, qty: o.qty } });
  }
}

export async function createExecution(input: ExecutionInput, actorId: number): Promise<ExecutionResult> {
  return refusable(async () =>
    prisma.$transaction(async (tx) => {
      const r = await checkExecution(tx, input, null);
      if (!r.ok) throw new Refused(r.errors);
      const no = await nextNo(tx, r.c.data.execution_date);
      const row = await tx.prdExecution.create({ data: { ...r.c.data, execution_no: no, created_by: actorId } });
      await writeLines(tx, row.id, r.c);
      await audit(tx, row.id, "TAMBAH", "create", actorId);
      return { ok: true as const, id: row.id, no };
    })
  );
}

export async function updateExecution(id: number, input: ExecutionInput, actorId: number): Promise<ExecutionResult> {
  const current = await prisma.prdExecution.findUnique({ where: { id }, select: { status: true, execution_no: true } });
  if (!current) return { ok: false, errors: { _form: "Eksekusi tidak ditemukan." } };
  if (!prodDocIsEditable(current.status)) return { ok: false, errors: { _form: "Hanya Draft yang dapat diubah." } };
  return refusable(async () =>
    prisma.$transaction(async (tx) => {
      const r = await checkExecution(tx, input, id);
      if (!r.ok) throw new Refused(r.errors);
      const done = await tx.prdExecution.updateMany({ where: { id, status: "Draft" }, data: { ...r.c.data, updated_by: actorId } });
      if (done.count !== 1) throw new Refused({ _form: "Eksekusi berubah saat disimpan. Muat ulang halaman." });
      await writeLines(tx, id, r.c);
      await audit(tx, id, "UPDATE", "update", actorId);
      return { ok: true as const, id, no: current.execution_no };
    })
  );
}

const WITH_LINES = { inputs: { orderBy: { line_no: "asc" as const } }, outputs: { orderBy: { line_no: "asc" as const } } };
type Stored = Prisma.PrdExecutionGetPayload<{ include: typeof WITH_LINES }>;

function asInput(e: Stored): ExecutionInput {
  return {
    execution_date: isoDay(e.execution_date),
    workstation_id: e.workstation_id,
    driver: e.driver.toString(),
    note: e.note ?? "",
    inputs: e.inputs.map((l) => ({ bucket_id: l.bucket_id, qty: l.qty.toString() })),
    outputs: e.outputs.map((o) => ({ item_id: o.item_id, lot_no: o.lot_no ?? "", expiry_date: isoDay(o.expiry_date), qty: o.qty.toString() })),
  };
}

/**
 * Runs one lifecycle step. **Posting**, in one transaction: rechecks the
 * stored execution, names the outputs without a lot number, runs `produce`,
 * stores what each input released and each output received, and writes the
 * journal between WIP accounts where they differ. **Batalkan** (Draft) asks
 * for a reason.
 */
export async function transitionExecution(id: number, action: ProdDocAction, actorId: number, reason?: string, options: { dryRun?: boolean } = {}): Promise<PostResult> {
  const e = await prisma.prdExecution.findUnique({ where: { id }, include: WITH_LINES });
  if (!e) return { ok: false, errors: { _form: "Eksekusi tidak ditemukan." } };
  if (!prodDocTransitionAllowed(EXECUTION_WORKFLOW, action, e.status)) {
    return { ok: false, errors: { _form: `Eksekusi berstatus ini tidak dapat di-${EXECUTION_WORKFLOW.transitions[action].label.toLowerCase()}.` } };
  }
  const moved = "Eksekusi berubah saat diproses. Muat ulang halaman.";
  if (action === "cancel") {
    const why = String(reason ?? "").trim();
    if (!why) return { ok: false, errors: { reason: "Alasan wajib diisi." } };
    await prisma.$transaction(async (tx) => {
      const done = await tx.prdExecution.updateMany({ where: { id, status: "Draft" }, data: { status: "Cancelled", cancel_reason: why, updated_by: actorId } });
      if (done.count !== 1) throw new Error(moved);
      await audit(tx, id, "UPDATE", "cancel", actorId);
    });
    return { ok: true };
  }

  const period = await checkTransactionDate(isoDay(e.execution_date));
  if (!period.ok) return { ok: false, errors: { _form: period.message } };
  const accounts = await itemAccounts([...e.inputs.map((l) => l.item_id), ...e.outputs.map((o) => o.item_id)], ["wip"], null);
  if (!accounts.ok) return { ok: false, errors: { _form: accounts.message } };
  const currency = await prisma.refCurrency.findFirst({ where: { currency_label: BASE_CURRENCY_LABEL }, select: { id: true } });
  if (!currency) return { ok: false, errors: { _form: "Mata uang dasar tidak ditemukan." } };

  return refusable(async () => {
    let journalLines: JournalLineInput[] = [];
    await prisma.$transaction(async (tx) => {
      const r = await checkExecution(tx, asInput(e), id, true);
      if (!r.ok) throw new Refused({ _form: `Belum bisa diposting: ${firstError(r.errors)}` });
      const done = await tx.prdExecution.updateMany({ where: { id, status: "Draft" }, data: { status: "Posted", updated_by: actorId } });
      if (done.count !== 1) throw new Refused({ _form: moved });

      const source = { docTypeId: await docTypeId(tx, "prd_execution"), docId: id, no: e.execution_no };
      const date = r.c.data.execution_date;
      // R17: an output without a typed number takes <execution number>-<n>.
      const lotNos = r.c.outputs.map((o) => o.lot_no ?? `${e.execution_no}-${o.line_no}`);
      const made = await produce(tx, {
        workstationId: r.c.data.workstation_id,
        inputs: r.c.inputs.map((l) => ({ bucketId: l.bucket_id, baseQty: l.qty })),
        outputs: r.c.outputs.map((o, i) => ({ itemId: o.item_id, lotNo: lotNos[i], expiry: o.expiry_date, baseQty: o.qty })),
        date,
        source,
        actorId,
      });
      for (const [i, l] of r.c.inputs.entries()) {
        await tx.prdExecutionInput.update({ where: { execution_id_line_no: { execution_id: id, line_no: l.line_no } }, data: { value: made.inputs[i].value } });
      }
      for (const [i, o] of r.c.outputs.entries()) {
        await tx.prdExecutionOutput.update({
          where: { execution_id_line_no: { execution_id: id, line_no: o.line_no } },
          data: { lot_no: lotNos[i].toUpperCase(), weight: made.outputs[i].weight, value: made.outputs[i].value, lot_id: made.outputs[i].lotId, bucket_id: made.outputs[i].bucketId },
        });
      }

      // Value moves between WIP accounts only where input and output differ.
      const net = new Map<number, number>();
      const wip = (item: number) => accounts.accounts.get(item)!.wip;
      for (const [i, l] of r.c.inputs.entries()) net.set(wip(l.item_id), (net.get(wip(l.item_id)) ?? 0) - made.inputs[i].value);
      for (const [i, o] of r.c.outputs.entries()) net.set(wip(o.item_id), (net.get(wip(o.item_id)) ?? 0) + made.outputs[i].value);
      const base = { currencyId: currency.id, rate: 1 };
      journalLines = [...net.entries()]
        .filter(([, v]) => v !== 0)
        .sort((a, b) => b[1] - a[1])
        .map(([accountId, v]) => ({ ...base, accountId, debit: v > 0 ? v : 0, credit: v < 0 ? -v : 0, description: `${e.execution_no} · ${v > 0 ? "Output" : "Input"} ${r.c.workstationLabel}` }));
      const journal = journalLines.length
        ? await postJournal(tx, { description: `${e.execution_no} · Eksekusi Produksi ${r.c.workstationLabel}`, sourceDocTypeId: source.docTypeId, sourceDocId: id, postingDate: date, actorId, lines: journalLines })
        : null;
      await tx.prdExecution.update({ where: { id }, data: { input_value: made.total, journal_id: journal?.id ?? null } });
      await audit(tx, id, "UPDATE", "post", actorId);
      if (options.dryRun) throw new PostingDryRun(journalLines);
    });
    return { ok: true as const, journal: journalLines };
  });
}

/** The journal Posting would write, for the confirmation dialog (P103). */
export async function executionPreview(id: number, actorId: number): Promise<JournalPreviewResult> {
  try {
    const r = await transitionExecution(id, "post", actorId, undefined, { dryRun: true });
    if (!r.ok) return r;
    return { ok: true, lines: await describeJournalLines(r.journal ?? []) };
  } catch (e) {
    if (e instanceof Error) return { ok: false, errors: { _form: e.message } };
    throw e;
  }
}

// ------------------------------------------------------------------- reads

export type ExecutionListRow = { id: number; no: string; date: string; status: ProdDocStatus; workstationLabel: string; workstationName: string; lines: number; value: number };

export async function listExecutions(): Promise<ExecutionListRow[]> {
  const rows = await prisma.prdExecution.findMany({
    include: { workstation: true, _count: { select: { inputs: true, outputs: true } } },
    orderBy: [{ execution_date: "desc" }, { id: "desc" }],
  });
  return rows.map((r) => ({
    id: r.id,
    no: r.execution_no,
    date: isoDay(r.execution_date),
    status: r.status,
    workstationLabel: r.workstation.workstation_label,
    workstationName: r.workstation.workstation_name,
    lines: r._count.inputs + r._count.outputs,
    value: r.input_value.toNumber(),
  }));
}

export type ExecutionView = {
  id: number;
  no: string;
  status: ProdDocStatus;
  input: ExecutionInput;
  inputValues: number[];
  outputs: { lotNo: string | null; weight: number; value: number }[];
  value: number;
  journalId: number | null;
  journalNo: string | null;
  cancelReason: string | null;
};

export async function getExecution(id: number): Promise<ExecutionView | null> {
  const e = await prisma.prdExecution.findUnique({ where: { id }, include: WITH_LINES });
  if (!e) return null;
  return {
    id: e.id,
    no: e.execution_no,
    status: e.status,
    input: asInput(e),
    inputValues: e.inputs.map((l) => l.value.toNumber()),
    outputs: e.outputs.map((o) => ({ lotNo: o.lot_no, weight: o.weight.toNumber(), value: o.value.toNumber() })),
    value: e.input_value.toNumber(),
    journalId: e.journal_id,
    journalNo: e.journal_id ? ((await journalNumbersByIds([e.journal_id])).get(e.journal_id) ?? null) : null,
    cancelReason: e.cancel_reason,
  };
}

export function executionCurrent(v: ExecutionView) {
  return {
    workstationId: Number(v.input.workstation_id),
    bucketIds: v.input.inputs.map((l) => Number(l.bucket_id)),
    itemIds: v.input.outputs.map((o) => Number(o.item_id)),
  };
}

export async function executionNumbersByIds(ids: number[]): Promise<Map<number, string>> {
  if (!ids.length) return new Map();
  const rows = await prisma.prdExecution.findMany({ where: { id: { in: ids } }, select: { id: true, execution_no: true } });
  return new Map(rows.map((r) => [r.id, r.execution_no]));
}
