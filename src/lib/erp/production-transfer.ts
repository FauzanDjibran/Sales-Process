import "server-only";

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { nextDocumentNumber } from "./document-number";
import { checkTransactionDate } from "./fiscal";
import { PostingDryRun } from "./journal";
import { transferBucket } from "./production-ledger";
import {
  DAY,
  Refused,
  asDate,
  bucketOptions,
  checkBucketLines,
  docTypeId,
  firstError,
  isoDay,
  refusable,
  text,
  workstationOptions,
  type BucketLineInput,
  type BucketOption,
  type Db,
  type Place,
  type PostResult,
} from "./production-doc";
import { TRANSFER_WORKFLOW, prodDocIsEditable, prodDocTransitionAllowed, type ProdDocAction, type ProdDocStatus } from "./production-doc-workflow";

/**
 * Production Transfer (R7; `prd_transfer(_line)`, `PT/YYYY/MM/NNNN`) — any
 * quantity of a lot moves **directly** from one workstation to another: out
 * at round(V × q ÷ Q), V whole when the bucket empties, and in at the same
 * value. No transit, no receipt, **no journal** — the value stays in WIP.
 * Named only by this module.
 */

export type TransferInput = { transfer_date: string; from_workstation_id: number | null; to_workstation_id: number | null; note: string; lines: BucketLineInput[] };
export type TransferResult = { ok: true; id: number; no: string } | { ok: false; errors: Record<string, string> };
export type TransferOptions = { workstations: Place[]; buckets: BucketOption[] };

export async function transferOptions(current: { workstationIds: number[]; bucketIds: number[] } | null = null, db: Db = prisma): Promise<TransferOptions> {
  const [workstations, buckets] = await Promise.all([workstationOptions(current?.workstationIds ?? [], db), bucketOptions(current?.bucketIds ?? [], db)]);
  return { workstations, buckets };
}

type Checked = {
  data: { transfer_date: Date; from_workstation_id: number; to_workstation_id: number; note: string | null };
  label: string;
  lines: ReturnType<typeof checkBucketLines>;
};

export async function checkTransfer(db: Db, input: TransferInput, selfId: number | null, forPosting = false): Promise<{ ok: true; c: Checked } | { ok: false; errors: Record<string, string> }> {
  const errors: Record<string, string> = {};
  const stored = selfId
    ? await db.prdTransfer.findUnique({ where: { id: selfId }, select: { from_workstation_id: true, to_workstation_id: true, lines: { select: { bucket_id: true } } } })
    : null;
  const options = await transferOptions(stored ? { workstationIds: [stored.from_workstation_id, stored.to_workstation_id], bucketIds: stored.lines.map((l) => l.bucket_id) } : null, db);
  const date = String(input.transfer_date ?? "").trim();
  if (!DAY.test(date)) errors.transfer_date = "Tanggal wajib diisi.";
  const pick = (field: "from_workstation_id" | "to_workstation_id", what: string) => {
    const id = Number(input[field]) || null;
    const ws = id ? options.workstations.find((w) => w.id === id) : undefined;
    if (!id) errors[field] = `Pilih Workstation ${what}.`;
    else if (!ws || (!ws.active && (forPosting || (stored?.[field] ?? null) !== id))) errors[field] = "Workstation tidak ditemukan atau nonaktif.";
    return ws;
  };
  const from = pick("from_workstation_id", "asal");
  const to = pick("to_workstation_id", "tujuan");
  if (from && to && from.id === to.id) errors.to_workstation_id = "Workstation tujuan harus berbeda dari asalnya.";
  if (!input.lines?.length) errors._lines = "Tambahkan minimal satu lot.";
  const lines = checkBucketLines(input.lines, options.buckets, from?.id ?? null, "lines", errors);
  if (!errors._lines && Object.keys(errors).some((k) => k.startsWith("lines."))) errors._lines = "Ada baris yang perlu diperbaiki.";
  if (Object.keys(errors).length || !from || !to) return { ok: false, errors };
  return {
    ok: true,
    c: { data: { transfer_date: asDate(date), from_workstation_id: from.id, to_workstation_id: to.id, note: text(input.note) }, label: `${from.label} → ${to.label}`, lines },
  };
}

async function nextNo(db: Db, date: Date): Promise<string> {
  return nextDocumentNumber("PT", date, async (series) => {
    const row = await db.prdTransfer.findFirst({ where: { transfer_no: { startsWith: series } }, orderBy: { id: "desc" }, select: { transfer_no: true } });
    return row?.transfer_no ?? null;
  });
}

async function audit(db: Db, id: number, action: "TAMBAH" | "UPDATE", event: string, by: number) {
  await db.auditLog.create({ data: { entity_key: "prd_transfer", row_id: id, action, event, by } });
}

async function writeLines(tx: Prisma.TransactionClient, id: number, c: Checked) {
  await tx.prdTransferLine.deleteMany({ where: { transfer_id: id } });
  for (const l of c.lines) await tx.prdTransferLine.create({ data: { transfer_id: id, line_no: l.line_no, bucket_id: l.bucket_id, tracking_id: l.tracking_id, item_id: l.item_id, qty: l.qty } });
}

export async function createTransfer(input: TransferInput, actorId: number): Promise<TransferResult> {
  return refusable(async () =>
    prisma.$transaction(async (tx) => {
      const r = await checkTransfer(tx, input, null);
      if (!r.ok) throw new Refused(r.errors);
      const no = await nextNo(tx, r.c.data.transfer_date);
      const row = await tx.prdTransfer.create({ data: { ...r.c.data, transfer_no: no, created_by: actorId } });
      await writeLines(tx, row.id, r.c);
      await audit(tx, row.id, "TAMBAH", "create", actorId);
      return { ok: true as const, id: row.id, no };
    })
  );
}

export async function updateTransfer(id: number, input: TransferInput, actorId: number): Promise<TransferResult> {
  const current = await prisma.prdTransfer.findUnique({ where: { id }, select: { status: true, transfer_no: true } });
  if (!current) return { ok: false, errors: { _form: "Production Transfer tidak ditemukan." } };
  if (!prodDocIsEditable(current.status)) return { ok: false, errors: { _form: "Hanya Draft yang dapat diubah." } };
  return refusable(async () =>
    prisma.$transaction(async (tx) => {
      const r = await checkTransfer(tx, input, id);
      if (!r.ok) throw new Refused(r.errors);
      const done = await tx.prdTransfer.updateMany({ where: { id, status: "Draft" }, data: { ...r.c.data, updated_by: actorId } });
      if (done.count !== 1) throw new Refused({ _form: "Production Transfer berubah saat disimpan. Muat ulang halaman." });
      await writeLines(tx, id, r.c);
      await audit(tx, id, "UPDATE", "update", actorId);
      return { ok: true as const, id, no: current.transfer_no };
    })
  );
}

const WITH_LINES = { lines: { orderBy: { line_no: "asc" as const } } };
type Stored = Prisma.PrdTransferGetPayload<{ include: typeof WITH_LINES }>;

const asInput = (t: Stored): TransferInput => ({
  transfer_date: isoDay(t.transfer_date),
  from_workstation_id: t.from_workstation_id,
  to_workstation_id: t.to_workstation_id,
  note: t.note ?? "",
  lines: t.lines.map((l) => ({ bucket_id: l.bucket_id, qty: l.qty.toString() })),
});

/** **Posting** moves each line's lot to the destination at the value it releases; **Batalkan** a Draft with a reason. */
export async function transitionTransfer(id: number, action: ProdDocAction, actorId: number, reason?: string, options: { dryRun?: boolean } = {}): Promise<PostResult> {
  const t = await prisma.prdTransfer.findUnique({ where: { id }, include: WITH_LINES });
  if (!t) return { ok: false, errors: { _form: "Production Transfer tidak ditemukan." } };
  if (!prodDocTransitionAllowed(TRANSFER_WORKFLOW, action, t.status)) {
    return { ok: false, errors: { _form: `Production Transfer berstatus ini tidak dapat di-${TRANSFER_WORKFLOW.transitions[action].label.toLowerCase()}.` } };
  }
  const moved = "Production Transfer berubah saat diproses. Muat ulang halaman.";
  if (action === "cancel") {
    const why = String(reason ?? "").trim();
    if (!why) return { ok: false, errors: { reason: "Alasan wajib diisi." } };
    await prisma.$transaction(async (tx) => {
      const done = await tx.prdTransfer.updateMany({ where: { id, status: "Draft" }, data: { status: "Cancelled", cancel_reason: why, updated_by: actorId } });
      if (done.count !== 1) throw new Error(moved);
      await audit(tx, id, "UPDATE", "cancel", actorId);
    });
    return { ok: true };
  }
  const period = await checkTransactionDate(isoDay(t.transfer_date));
  if (!period.ok) return { ok: false, errors: { _form: period.message } };
  return refusable(async () => {
    await prisma.$transaction(async (tx) => {
      const r = await checkTransfer(tx, asInput(t), id, true);
      if (!r.ok) throw new Refused({ _form: `Belum bisa diposting: ${firstError(r.errors)}` });
      const done = await tx.prdTransfer.updateMany({ where: { id, status: "Draft" }, data: { status: "Posted", updated_by: actorId } });
      if (done.count !== 1) throw new Refused({ _form: moved });
      const source = { docTypeId: await docTypeId(tx, "prd_transfer"), docId: id, no: t.transfer_no };
      let total = 0;
      for (const l of r.c.lines) {
        const out = await transferBucket(tx, { bucketId: l.bucket_id, toWorkstationId: r.c.data.to_workstation_id, baseQty: l.qty, date: r.c.data.transfer_date, source, actorId });
        await tx.prdTransferLine.update({ where: { transfer_id_line_no: { transfer_id: id, line_no: l.line_no } }, data: { value: out.value, to_bucket_id: out.toBucketId } });
        total += out.value;
      }
      await tx.prdTransfer.update({ where: { id }, data: { value: total } });
      await audit(tx, id, "UPDATE", "post", actorId);
      if (options.dryRun) throw new PostingDryRun([]);
    });
    return { ok: true as const };
  });
}

export type TransferListRow = { id: number; no: string; date: string; status: ProdDocStatus; from: { label: string; name: string }; to: { label: string; name: string }; lines: number; value: number };

export async function listTransfers(): Promise<TransferListRow[]> {
  const rows = await prisma.prdTransfer.findMany({
    include: { from_workstation: true, to_workstation: true, _count: { select: { lines: true } } },
    orderBy: [{ transfer_date: "desc" }, { id: "desc" }],
  });
  return rows.map((r) => ({
    id: r.id,
    no: r.transfer_no,
    date: isoDay(r.transfer_date),
    status: r.status,
    from: { label: r.from_workstation.workstation_label, name: r.from_workstation.workstation_name },
    to: { label: r.to_workstation.workstation_label, name: r.to_workstation.workstation_name },
    lines: r._count.lines,
    value: r.value.toNumber(),
  }));
}

export type TransferView = { id: number; no: string; status: ProdDocStatus; input: TransferInput; lineValues: number[]; value: number; cancelReason: string | null };

export async function getTransfer(id: number): Promise<TransferView | null> {
  const t = await prisma.prdTransfer.findUnique({ where: { id }, include: WITH_LINES });
  if (!t) return null;
  return { id: t.id, no: t.transfer_no, status: t.status, input: asInput(t), lineValues: t.lines.map((l) => l.value.toNumber()), value: t.value.toNumber(), cancelReason: t.cancel_reason };
}

export const transferCurrent = (v: TransferView) => ({
  workstationIds: [Number(v.input.from_workstation_id), Number(v.input.to_workstation_id)],
  bucketIds: v.input.lines.map((l) => Number(l.bucket_id)),
});

export async function transferNumbersByIds(ids: number[]): Promise<Map<number, string>> {
  if (!ids.length) return new Map();
  const rows = await prisma.prdTransfer.findMany({ where: { id: { in: ids } }, select: { id: true, transfer_no: true } });
  return new Map(rows.map((r) => [r.id, r.transfer_no]));
}

/** Drafts dated up to a day — the month-end close's checklist (R28). */
export async function draftTransfersUpTo(to: Date, db: Db = prisma): Promise<number> {
  return db.prdTransfer.count({ where: { status: "Draft", transfer_date: { lte: to } } });
}
