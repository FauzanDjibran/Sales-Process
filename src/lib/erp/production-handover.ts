import "server-only";

import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import { checkTransactionDate } from "./fiscal";
import { formatNumber } from "@/lib/format";
import { nextDailyNumber } from "./production-number";
import {
  ProductionRefusal,
  bucketsByIds,
  availableBuckets,
  jobIdsOfPartai,
  orderIdsWithPartai,
  partaiOfOrder,
  productionIdentityNumbers,
  receiveTransit,
  returnToSender,
  sendToTransit,
  startJob,
  startPartai,
  type BucketView,
} from "./production-ledger";
import { lockProductionOrderForHandover, productionOrderNumbersByIds, productionOrdersForHandover, type HandoverSourceOrder } from "./production-order";
import { HANDOVER_TRANSITIONS, handoverIsEditable, handoverTransitionAllowed, type HandoverAction, type HandoverStatus } from "./production-handover-workflow";

/**
 * The hand-over between workstations (Walet step 4, P167, M113, AD1): the BSTB a
 * station writes at its output, `BSTB_<unit>_<DDMMYY>_<NNNNN>` after the
 * **sending** unit. Its tables are `prd_handover` and `prd_handover_line`, and
 * nothing else names them. It moves goods that are already in production from one
 * station to the next — no stock, no value change, no journal.
 *
 * Posting hands the goods on: each line leaves a bucket of the sending station
 * for the receiving station's **transit** bucket (`sendToTransit`); the receiving
 * station then takes the whole sending (*Terima*) or returns it whole to the
 * sender (*Tolak*) — exactly the figures each line sent.
 *
 * Two cases, told by the goods:
 * - **Goods of a Partai** go whole: every bucket of that Partai at the station
 *   (AD1), every gram. Goods already in a Job keep it.
 * - **Goods of no Partai yet** — stock lots a Logistik BSTB brought to a station
 *   that makes Jobs (it has a Kode Job) — start one (O3): the user picks the lots
 *   and quantities and boxes them (`box_no`); posting makes the **Partai**, for the
 *   Perintah the hand-over names, taking its Item Target, and a **Job per box**.
 *   A lot may be split over several boxes. At such a station goods without a Job
 *   (the No. Moulding) are boxed too; the new Jobs' parents are every Job of the
 *   Partai — shortcut: that is right while a Partai's Jobs all went into the one
 *   mix; step 5's genealogy will say it exactly.
 *
 * A hand-over takes only received goods: never goods still in transit.
 */

type Db = Prisma.TransactionClient | typeof prisma;
const D = Prisma.Decimal;
type Dec = Prisma.Decimal;

// ------------------------------------------------------------------ input

export type HandoverHeaderInput = {
  from_workstation_id: number | null;
  to_workstation_id: number | null;
  handover_date: string;
  /** The Perintah the Partai is started for — required exactly when the goods have no Partai yet. */
  order_id?: number | null;
  note: string;
};

export type HandoverLineInput = {
  bucket_id: number | null;
  qty: number | string;
  /** The box, at a station that makes Jobs, for goods without a Job. */
  box_no?: number | string | null;
};

export type HandoverResult = { ok: true; id: number; handoverNo: string } | { ok: false; errors: Record<string, string> };

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const asDate = (d: string) => new Date(`${d}T00:00:00Z`);
const isoDay = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "");
const lineKey = (i: number, field: string) => `lines.${i}.${field}`;
const text = (v: string | null | undefined) => String(v ?? "").trim() || null;
const qtyText = (d: Dec | number) => formatNumber(Number(d), 2);

async function docTypeId(db: Db, table: string): Promise<number> {
  const row = await db.sysDocType.findFirst({ where: { doc_table: table }, select: { id: true } });
  if (!row) throw new Error(`Jenis dokumen ${table} belum terdaftar. Jalankan db:seed.`);
  return row.id;
}

/** A quantity typed as text, with at most 6 decimals (the bucket's own scale). */
function parseQty(v: unknown): Dec | null {
  const s = String(v ?? "").trim().replace(",", ".");
  if (!/^\d+(\.\d{1,6})?$/.test(s)) return null;
  const d = new D(s);
  return d.gt(0) ? d : null;
}

// ---------------------------------------------------------------- options

export type HandoverStation = { id: number; label: string; name: string; active: boolean; jobCode: string | null };

export type HandoverOptions = {
  workstations: HandoverStation[];
  /** Received goods holding quantity at any station — the form narrows to the sender. */
  buckets: BucketView[];
  /** Open Perintah the hand-over that starts a Partai may name (and the stored one's own). */
  orders: HandoverSourceOrder[];
  /** Perintah that already started a Partai: each starts one only. */
  startedOrderIds: number[];
};

export type HandoverCurrent = { workstationIds: number[]; bucketIds: number[]; orderId: number | null };

export async function handoverOptions(current: HandoverCurrent | null = null, db: Db = prisma): Promise<HandoverOptions> {
  const [workstations, buckets, orders, startedOrderIds] = await Promise.all([
    db.refWorkstation.findMany({
      where: { OR: [{ status: "Active" }, ...(current?.workstationIds.length ? [{ id: { in: current.workstationIds } }] : [])] },
      orderBy: { workstation_label: "asc" },
      select: { id: true, workstation_label: true, workstation_name: true, status: true, job_code: true },
    }),
    availableBuckets({ withIds: current?.bucketIds }, db),
    productionOrdersForHandover(current?.orderId ? [current.orderId] : [], db),
    orderIdsWithPartai(db),
  ]);
  return {
    workstations: workstations.map((w) => ({ id: w.id, label: w.workstation_label, name: w.workstation_name, active: w.status === "Active", jobCode: w.job_code })),
    buckets,
    orders,
    startedOrderIds,
  };
}

// ------------------------------------------------------------- validation

type CheckedLine = {
  line_no: number;
  source_bucket_id: number;
  lot_id: number;
  item_id: number;
  lot_no: string;
  qty: Dec;
  box_no: number | null;
  /** The Job the goods already carry, kept. */
  keeps_job_id: number | null;
};

type Checked = {
  data: { handover_date: Date; from_workstation_id: number; to_workstation_id: number; order_id: number | null; note: string | null };
  /** Whether the goods have no Partai yet: this hand-over starts one. */
  starts: boolean;
  partaiId: number | null;
  fromCode: string | null;
  fromLabel: string;
  toLabel: string;
  lines: CheckedLine[];
  order: HandoverSourceOrder | null;
};

/**
 * Every rule a hand-over must satisfy to be saved — and, run again inside the
 * posting transaction with `forPosting`, to be posted: the stations still
 * active, the Perintah still Open.
 */
export async function checkHandover(
  db: Db,
  header: HandoverHeaderInput,
  lines: HandoverLineInput[],
  selfId: number | null,
  forPosting = false
): Promise<{ ok: true; c: Checked } | { ok: false; errors: Record<string, string> }> {
  const errors: Record<string, string> = {};
  const stored = selfId
    ? await db.prdHandover.findUnique({
        where: { id: selfId },
        select: { from_workstation_id: true, to_workstation_id: true, order_id: true, lines: { select: { source_bucket_id: true } } },
      })
    : null;
  const options = await handoverOptions(
    stored
      ? { workstationIds: [stored.from_workstation_id, stored.to_workstation_id], bucketIds: stored.lines.map((l) => l.source_bucket_id), orderId: stored.order_id }
      : null,
    db
  );

  const station = (id: number | null) => (id ? options.workstations.find((w) => w.id === id) : undefined);
  const fromId = Number(header.from_workstation_id) || null;
  const toId = Number(header.to_workstation_id) || null;
  const from = station(fromId);
  const to = station(toId);
  if (!fromId) errors.from_workstation_id = "Pilih Workstation pengirim.";
  else if (!from || (!from.active && (forPosting || stored?.from_workstation_id !== fromId))) errors.from_workstation_id = "Workstation pengirim tidak ditemukan atau nonaktif.";
  if (!toId) errors.to_workstation_id = "Pilih Workstation tujuan.";
  else if (!to || (!to.active && (forPosting || stored?.to_workstation_id !== toId))) errors.to_workstation_id = "Workstation tujuan tidak ditemukan atau nonaktif.";
  else if (toId === fromId) errors.to_workstation_id = "Workstation tujuan harus lain dari pengirim.";

  const day = String(header.handover_date ?? "").trim();
  if (!DAY.test(day)) errors.handover_date = "Tanggal wajib diisi.";

  const raw = Array.isArray(lines) ? lines : [];
  if (!raw.length) errors._lines = "Pilih barang yang diserahkan.";
  const bucketById = new Map(options.buckets.map((b) => [b.id, b]));
  const out: CheckedLine[] = [];
  const takenOf = new Map<number, Dec>();
  const seenBox = new Set<string>();
  const sources: BucketView[] = [];
  for (const [i, l] of raw.entries()) {
    const b = Number(l.bucket_id) ? bucketById.get(Number(l.bucket_id)) : undefined;
    if (!b) {
      errors[lineKey(i, "bucket_id")] = "Barang tidak ditemukan di workstation pengirim. Pilih ulang.";
      continue;
    }
    if (b.inTransit || (fromId && b.workstationId !== fromId)) {
      errors[lineKey(i, "bucket_id")] = `${b.itemLabel} lot ${b.lotNo} tidak sedang diterima di workstation pengirim.`;
      continue;
    }
    if (b.isReject) {
      errors[lineKey(i, "bucket_id")] = `${b.itemLabel} lot ${b.lotNo} berstatus Reject: tinggal di produksi sampai dikeluarkan (O6).`;
      continue;
    }
    const qty = parseQty(l.qty);
    if (!qty) {
      errors[lineKey(i, "qty")] = "Isi jumlah lebih dari 0, paling banyak 6 angka desimal.";
      continue;
    }
    const taken = (takenOf.get(b.id) ?? new D(0)).add(qty);
    if (taken.gt(b.qty)) {
      errors[lineKey(i, "qty")] = `Melebihi saldo ${b.itemLabel} lot ${b.lotNo}: ${qtyText(b.qty)}.`;
      continue;
    }
    takenOf.set(b.id, taken);
    const box = l.box_no == null || String(l.box_no).trim() === "" ? null : Number(l.box_no);
    if (box != null && (!Number.isInteger(box) || box < 1)) {
      errors[lineKey(i, "box_no")] = "Nomor box berupa bilangan bulat mulai 1.";
      continue;
    }
    const dupe = `${b.id}:${box ?? ""}`;
    if (seenBox.has(dupe)) {
      errors[lineKey(i, "bucket_id")] = `${b.itemLabel} lot ${b.lotNo} sudah ada di box ini.`;
      continue;
    }
    seenBox.add(dupe);
    sources.push(b);
    out.push({
      line_no: out.length + 1,
      source_bucket_id: b.id,
      lot_id: b.lotId,
      item_id: b.itemId,
      lot_no: b.lotNo,
      qty,
      box_no: box,
      keeps_job_id: b.jobId,
    });
  }

  // The goods say which case this is: of one Partai, or of none yet.
  let starts = false;
  let partaiId: number | null = null;
  if (sources.length) {
    const partaiIds = new Set(sources.map((b) => b.partaiId));
    if (partaiIds.size > 1) errors._lines = "Satu hand-over hanya untuk satu Partai, atau untuk barang yang belum punya Partai.";
    else {
      partaiId = [...partaiIds][0];
      starts = partaiId == null;
    }
  }

  const order = Number(header.order_id) ? (options.orders.find((o) => o.id === Number(header.order_id)) ?? null) : null;
  if (from && sources.length && !errors._lines) {
    const makesJobs = Boolean(from.jobCode);
    const jobless = out.filter((l) => l.keeps_job_id == null);
    if (jobless.length && !makesJobs) {
      errors._lines = starts
        ? `Partai dimulai dari workstation yang membuat Job; ${from.label} tidak punya Kode Job.`
        : `Barang tanpa Job hanya diserahkan dari workstation yang membuat Job; ${from.label} tidak punya Kode Job.`;
    }
    for (const [i, l] of out.entries()) {
      if (l.keeps_job_id == null && l.box_no == null) errors[lineKey(i, "box_no")] = "Isi nomor box.";
      // Goods already in a Job keep it: a box number there would say otherwise.
      if (l.keeps_job_id != null && l.box_no != null) errors[lineKey(i, "box_no")] = "Barang ini sudah di dalam Job dan tetap di Job-nya.";
    }
    if (starts) {
      if (!order) errors.order_id = "Pilih Perintah Produksi yang Partainya dimulai.";
      else if (!order.open && (forPosting || stored?.order_id !== order.id)) errors.order_id = "Perintah Produksi tidak Open.";
      else if (options.startedOrderIds.includes(order.id)) errors.order_id = `Perintah ${order.orderNo} sudah memulai Partai.`;
      else if (fromId && !order.workstationIds.includes(fromId)) errors.order_id = `${from.label} tidak ada di rute Perintah ${order.orderNo}.`;
    } else if (partaiId != null) {
      // AD1: the whole Partai at the station goes — every bucket, every gram.
      const taken = new Map<number, Dec>();
      for (const l of out) taken.set(l.source_bucket_id, (taken.get(l.source_bucket_id) ?? new D(0)).add(l.qty));
      const missing = options.buckets.filter((b) => b.partaiId === partaiId && b.workstationId === fromId && !b.inTransit && !b.isReject && !(taken.get(b.id) ?? new D(0)).eq(b.qty));
      if (missing.length) {
        const first = missing[0];
        errors._lines = `Partai ${first.partaiNo} diserahkan utuh: ${first.itemLabel} lot ${first.lotNo} masih ${qtyText(first.qty)} di ${from.label}${missing.length > 1 ? ` (dan ${missing.length - 1} lainnya)` : ""}.`;
      }
    }
  }
  if (!errors._lines && Object.keys(errors).some((k) => k.startsWith("lines."))) errors._lines = "Ada baris yang perlu diperbaiki.";
  if (Object.keys(errors).length || !from || !to) return { ok: false, errors };
  return {
    ok: true,
    c: {
      data: {
        handover_date: asDate(day),
        from_workstation_id: from.id,
        to_workstation_id: to.id,
        order_id: starts ? (order?.id ?? null) : null,
        note: text(header.note),
      },
      starts,
      partaiId,
      fromCode: from.jobCode,
      fromLabel: from.label,
      toLabel: to.label,
      lines: out,
      order,
    },
  };
}

// ------------------------------------------------------------------ writes

async function nextHandoverNo(db: Db, fromLabel: string, date: Date): Promise<string> {
  // `BSTB_<unit>_<DDMMYY>_<NNNNN>`, the sending unit's series (M124).
  return nextDailyNumber(["BSTB", fromLabel], date, async (series) => {
    const row = await db.prdHandover.findFirst({ where: { handover_no: { startsWith: series } }, orderBy: { id: "desc" }, select: { handover_no: true } });
    return row?.handover_no ?? null;
  });
}

async function audit(db: Db, id: number, action: "TAMBAH" | "UPDATE", event: string, by: number) {
  await db.auditLog.create({ data: { entity_key: "prd_handover", row_id: id, action, event, by } });
}

/** Rules failing inside a transaction roll it back and come out as errors. */
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
    throw e;
  }
}

const lineData = (l: CheckedLine) => ({
  line_no: l.line_no,
  source_bucket_id: l.source_bucket_id,
  lot_id: l.lot_id,
  item_id: l.item_id,
  lot_no: l.lot_no,
  qty: l.qty,
  box_no: l.box_no,
});

export async function createHandover(header: HandoverHeaderInput, lines: HandoverLineInput[], actorId: number): Promise<HandoverResult> {
  return refusable(async () => {
    const made = await prisma.$transaction(async (tx) => {
      const r = await checkHandover(tx, header, lines, null);
      if (!r.ok) throw new Refused(r.errors);
      const row = await tx.prdHandover.create({
        data: {
          ...r.c.data,
          handover_no: await nextHandoverNo(tx, r.c.fromLabel, r.c.data.handover_date),
          created_by: actorId,
          lines: { create: r.c.lines.map(lineData) },
        },
      });
      await audit(tx, row.id, "TAMBAH", "create", actorId);
      return row;
    });
    return { ok: true as const, id: made.id, handoverNo: made.handover_no };
  });
}

export async function updateHandover(id: number, header: HandoverHeaderInput, lines: HandoverLineInput[], actorId: number): Promise<HandoverResult> {
  const current = await prisma.prdHandover.findUnique({ where: { id }, select: { status: true, handover_no: true, from_workstation_id: true, handover_date: true } });
  if (!current) return { ok: false, errors: { _form: "Hand-over tidak ditemukan." } };
  if (!handoverIsEditable(current.status as HandoverStatus)) {
    return { ok: false, errors: { _form: "Hand-over yang sudah diposting atau dibatalkan tidak dapat diubah." } };
  }
  return refusable(async () => {
    const no = await prisma.$transaction(async (tx) => {
      const r = await checkHandover(tx, header, lines, id);
      if (!r.ok) throw new Refused(r.errors);
      // The number carries the sending unit and the day: a Draft that changes either takes the next of its new series.
      const renumber = r.c.data.from_workstation_id !== current.from_workstation_id || r.c.data.handover_date.getTime() !== current.handover_date.getTime();
      const handover_no = renumber ? await nextHandoverNo(tx, r.c.fromLabel, r.c.data.handover_date) : current.handover_no;
      const done = await tx.prdHandover.updateMany({ where: { id, status: "Draft" }, data: { ...r.c.data, handover_no, updated_by: actorId } });
      if (done.count !== 1) throw new Refused({ _form: "Hand-over berubah saat diproses. Muat ulang halaman." });
      // A Draft's lines are rewritten whole: nothing names them yet.
      await tx.prdHandoverLine.deleteMany({ where: { handover_id: id } });
      await tx.prdHandoverLine.createMany({ data: r.c.lines.map((l) => ({ ...lineData(l), handover_id: id })) });
      await audit(tx, id, "UPDATE", "update", actorId);
      return handover_no;
    });
    return { ok: true as const, id, handoverNo: no };
  });
}

const WITH_LINES = { lines: { orderBy: { line_no: "asc" as const } } };
type StoredHandover = Prisma.PrdHandoverGetPayload<{ include: typeof WITH_LINES }>;

function asInput(h: StoredHandover): { header: HandoverHeaderInput; lines: HandoverLineInput[] } {
  return {
    header: {
      from_workstation_id: h.from_workstation_id,
      to_workstation_id: h.to_workstation_id,
      handover_date: isoDay(h.handover_date),
      order_id: h.order_id,
      note: h.note ?? "",
    },
    lines: h.lines.map((l) => ({ bucket_id: l.source_bucket_id, qty: l.qty.toString(), box_no: l.box_no })),
  };
}

// --------------------------------------------------------------- lifecycle

export type HandoverTransitionResult = { ok: true } | { ok: false; errors: Record<string, string> };

/**
 * Runs one lifecycle step. Every step is conditional on the status just read.
 *
 * - **Posting**, in one transaction: for the hand-over that starts a Partai, locks
 *   the Perintah (it must be Open and not yet started), rechecks, starts the
 *   **Partai** (the Perintah's Item Target) and makes a **Job** per box; then for
 *   every line sends the goods into transit to the next station under their Partai
 *   and Job, storing the value moved and the transit bucket.
 * - **Terima** (`date`): each line's own quantity and value enter the station's bucket.
 * - **Tolak** (`date`, reason): each line's own quantity and value go back to the sender.
 * - **Batalkan** (Draft only) asks for a reason and writes nothing else.
 *
 * None writes a journal: a hand-over changes where the goods are, never their value.
 */
export async function transitionHandover(id: number, action: HandoverAction, actorId: number, reason?: string, options: { date?: string } = {}): Promise<HandoverTransitionResult> {
  const h = await prisma.prdHandover.findUnique({ where: { id }, include: WITH_LINES });
  if (!h) return { ok: false, errors: { _form: "Hand-over tidak ditemukan." } };
  const t = HANDOVER_TRANSITIONS[action];
  if (!handoverTransitionAllowed(action, h.status as HandoverStatus)) {
    return { ok: false, errors: { _form: `Hand-over berstatus ini tidak dapat di-${t.label.toLowerCase()}.` } };
  }
  const moved = "Hand-over berubah saat diproses. Muat ulang halaman.";
  let why: string | null = null;
  if (t.reason) {
    why = String(reason ?? "").trim();
    if (!why) return { ok: false, errors: { reason: "Alasan wajib diisi." } };
  }

  if (action === "cancel") {
    await prisma.$transaction(async (tx) => {
      const done = await tx.prdHandover.updateMany({ where: { id, status: "Draft" }, data: { status: "Cancelled", cancel_reason: why, updated_by: actorId } });
      if (done.count !== 1) throw new Error(moved);
      await audit(tx, id, "UPDATE", "cancel", actorId);
    });
    return { ok: true };
  }
  if (action === "receive" || action === "reject") return settleTransit(h, action, actorId, why, options.date);

  const period = await checkTransactionDate(isoDay(h.handover_date));
  if (!period.ok) return { ok: false, errors: { _form: period.message } };
  return refusable(async () => {
    await prisma.$transaction(async (tx) => {
      // The Perintah first (a Tutup on it waits), then the buckets.
      const input = asInput(h);
      let locked: Extract<Awaited<ReturnType<typeof lockProductionOrderForHandover>>, { ok: true }> | null = null;
      if (h.order_id) {
        const o = await lockProductionOrderForHandover(tx, h.order_id);
        if (!o.ok) throw new Refused({ _form: `Belum bisa diposting: ${o.error}` });
        locked = o;
      }
      const r = await checkHandover(tx, input.header, input.lines, id, true);
      if (!r.ok) {
        const first = Object.entries(r.errors).find(([k]) => k !== "_lines")?.[1] ?? r.errors._lines;
        throw new Refused({ _form: `Belum bisa diposting: ${first}` });
      }
      const done = await tx.prdHandover.updateMany({ where: { id, status: "Draft" }, data: { status: "Posted", updated_by: actorId } });
      if (done.count !== 1) throw new Refused({ _form: moved });

      const source = { docTypeId: await docTypeId(tx, "prd_handover"), docId: id, no: h.handover_no };
      const date = r.c.data.handover_date;
      let partaiId = r.c.partaiId;
      if (r.c.starts) {
        if (!locked || (await partaiOfOrder(h.order_id!, tx))) throw new Refused({ _form: "Belum bisa diposting: Perintah ini sudah memulai Partai." });
        partaiId = (await startPartai(tx, { date, targetItemId: locked.targetItemId, orderId: h.order_id, source, actorId })).id;
      }
      // A Job per box, at a station that makes Jobs; the parents are the Partai's earlier Jobs (none for its first).
      const parents = r.c.starts || partaiId == null ? [] : await jobIdsOfPartai(partaiId, tx);
      const jobOfBox = new Map<number, number>();
      for (const box of [...new Set(r.c.lines.flatMap((l) => (l.box_no != null ? [l.box_no] : [])))].sort((a, b) => a - b)) {
        jobOfBox.set(box, (await startJob(tx, { partaiId: partaiId!, workstationId: r.c.data.from_workstation_id, parentJobIds: parents, date, source, actorId })).id);
      }
      let total = 0;
      for (const l of r.c.lines) {
        const sent = await sendToTransit(tx, {
          bucketId: l.source_bucket_id,
          toWorkstationId: r.c.data.to_workstation_id,
          baseQty: l.qty,
          partaiId,
          jobId: l.box_no != null ? jobOfBox.get(l.box_no)! : l.keeps_job_id,
          date,
          source,
          actorId,
        });
        await tx.prdHandoverLine.update({
          where: { handover_id_line_no: { handover_id: id, line_no: l.line_no } },
          data: { job_id: sent.jobId, cost_amount: sent.value, transit_bucket_id: sent.bucketId },
        });
        total += sent.value;
      }
      await tx.prdHandover.update({ where: { id }, data: { partai_id: partaiId, cost_amount: total } });
      await audit(tx, id, "UPDATE", "post", actorId);
    });
    return { ok: true as const };
  });
}

/** Terima or Tolak at the receiving station (M113): the whole sending, line by line, at its own figures. */
async function settleTransit(h: StoredHandover, action: "receive" | "reject", actorId: number, why: string | null, dayText: string | undefined): Promise<HandoverTransitionResult> {
  const day = String(dayText ?? "").trim();
  if (!DAY.test(day)) return { ok: false, errors: { date: "Tanggal wajib diisi." } };
  if (day < isoDay(h.handover_date)) return { ok: false, errors: { date: "Tidak boleh sebelum tanggal Hand-over." } };
  const period = await checkTransactionDate(day);
  if (!period.ok) return { ok: false, errors: { date: period.message } };
  const rejecting = action === "reject";
  return refusable(async () => {
    await prisma.$transaction(async (tx) => {
      const date = asDate(day);
      const done = await tx.prdHandover.updateMany({
        where: { id: h.id, status: "Posted" },
        data: { status: rejecting ? "Rejected" : "Received", received_date: date, received_by: actorId, ...(rejecting ? { reject_reason: why } : {}), updated_by: actorId },
      });
      if (done.count !== 1) throw new Refused({ _form: "Hand-over berubah saat diproses. Muat ulang halaman." });
      const source = { docTypeId: await docTypeId(tx, "prd_handover"), docId: h.id, no: h.handover_no };
      for (const l of h.lines) {
        if (l.transit_bucket_id == null) throw new Refused({ _form: "Hand-over ini tidak mencatat saldo dalam perjalanannya." });
        const move = { bucketId: l.transit_bucket_id, baseQty: l.qty, value: l.cost_amount, date, source, actorId };
        if (rejecting) await returnToSender(tx, { ...move, senderId: h.from_workstation_id });
        else {
          const into = await receiveTransit(tx, move);
          await tx.prdHandoverLine.update({ where: { id: l.id }, data: { received_bucket_id: into.bucketId } });
        }
      }
      await audit(tx, h.id, "UPDATE", action, actorId);
    });
    return { ok: true as const };
  });
}

// ------------------------------------------------------------------- reads

export type HandoverListRow = {
  id: number;
  handoverNo: string;
  handoverDate: string;
  status: HandoverStatus;
  fromLabel: string;
  fromName: string;
  toLabel: string;
  toName: string;
  /** The Perintah that started its Partai, if this hand-over did. */
  orderNo: string | null;
  partaiNo: string | null;
  receivedDate: string | null;
  lines: number;
  cost: number;
};

export async function listHandovers(): Promise<HandoverListRow[]> {
  const rows = await prisma.prdHandover.findMany({
    orderBy: [{ handover_date: "desc" }, { id: "desc" }],
    include: { from: true, to: true, _count: { select: { lines: true } } },
  });
  const [ids, orderNos] = await Promise.all([
    productionIdentityNumbers({ partaiIds: rows.flatMap((r) => (r.partai_id ? [r.partai_id] : [])) }),
    productionOrderNumbersByIds(rows.flatMap((r) => (r.order_id ? [r.order_id] : []))),
  ]);
  return rows.map((r) => ({
    id: r.id,
    handoverNo: r.handover_no,
    handoverDate: isoDay(r.handover_date),
    status: r.status as HandoverStatus,
    fromLabel: r.from.workstation_label,
    fromName: r.from.workstation_name,
    toLabel: r.to.workstation_label,
    toName: r.to.workstation_name,
    orderNo: r.order_id ? (orderNos.get(r.order_id) ?? null) : null,
    partaiNo: r.partai_id ? (ids.partai.get(r.partai_id) ?? null) : null,
    receivedDate: r.received_date ? isoDay(r.received_date) : null,
    lines: r._count.lines,
    cost: r.cost_amount.toNumber(),
  }));
}

export type HandoverView = {
  id: number;
  handoverNo: string;
  status: HandoverStatus;
  header: HandoverHeaderInput;
  /** Set at Posting: the Partai handed on, or started. */
  partaiId: number | null;
  partaiNo: string | null;
  orderNo: string | null;
  lines: (HandoverLineInput & {
    id: number;
    itemLabel: string;
    itemName: string;
    lotNo: string;
    /** The Job the goods carried at the sender before this hand-over. */
    fromJobNo: string | null;
    /** The Job carrying them now (made or kept); set at Posting. */
    jobNo: string | null;
    cost: number;
  })[];
  cost: number;
  cancelReason: string | null;
  receivedDate: string | null;
  rejectReason: string | null;
};

export async function getHandover(id: number): Promise<HandoverView | null> {
  const h = await prisma.prdHandover.findUnique({ where: { id }, include: WITH_LINES });
  if (!h) return null;
  const input = asInput(h);
  const [buckets, ids, items] = await Promise.all([
    bucketsByIds(h.lines.map((l) => l.source_bucket_id)),
    productionIdentityNumbers({ partaiIds: h.partai_id ? [h.partai_id] : [], jobIds: h.lines.flatMap((l) => (l.job_id ? [l.job_id] : [])) }),
    prisma.mItem.findMany({ where: { id: { in: h.lines.map((l) => l.item_id) } }, select: { id: true, item_label: true, item_name: true } }),
  ]);
  const bucketBy = new Map(buckets.map((b) => [b.id, b]));
  const itemBy = new Map(items.map((i) => [i.id, i]));
  return {
    id: h.id,
    handoverNo: h.handover_no,
    status: h.status as HandoverStatus,
    header: input.header,
    partaiId: h.partai_id,
    partaiNo: h.partai_id ? (ids.partai.get(h.partai_id) ?? null) : null,
    orderNo: h.order_id ? ((await productionOrderNumbersByIds([h.order_id])).get(h.order_id) ?? null) : null,
    lines: input.lines.map((l, i) => ({
      ...l,
      id: h.lines[i].id,
      itemLabel: itemBy.get(h.lines[i].item_id)?.item_label ?? "",
      itemName: itemBy.get(h.lines[i].item_id)?.item_name ?? "",
      lotNo: h.lines[i].lot_no,
      fromJobNo: bucketBy.get(h.lines[i].source_bucket_id)?.jobNo ?? null,
      jobNo: h.lines[i].job_id ? (ids.jobs.get(h.lines[i].job_id!) ?? null) : null,
      cost: h.lines[i].cost_amount.toNumber(),
    })),
    cost: h.cost_amount.toNumber(),
    cancelReason: h.cancel_reason,
    receivedDate: h.received_date ? isoDay(h.received_date) : null,
    rejectReason: h.reject_reason,
  };
}

/** What a stored hand-over's form must keep readable, whatever its status now. */
export function handoverCurrent(v: HandoverView): HandoverCurrent {
  return {
    workstationIds: [Number(v.header.from_workstation_id), Number(v.header.to_workstation_id)],
    bucketIds: v.lines.map((l) => Number(l.bucket_id)),
    orderId: v.header.order_id ?? null,
  };
}

/** Hand-over numbers by id, for the audit panel. */
export async function handoverNumbersByIds(ids: number[]): Promise<Map<number, string>> {
  const rows = await prisma.prdHandover.findMany({ where: { id: { in: ids } }, select: { id: true, handover_no: true } });
  return new Map(rows.map((r) => [r.id, r.handover_no]));
}

/** Why a Perintah may not be closed yet: the hand-over that starts its Partai is still a Draft or in transit. Null when it may. */
export async function openHandoversRefusal(orderId: number, db: Db = prisma): Promise<string | null> {
  const live = await db.prdHandover.findMany({ where: { order_id: orderId, status: { in: ["Draft", "Posted"] } }, select: { handover_no: true, status: true } });
  if (!live.length) return null;
  const names = live.map((i) => `${i.handover_no} (${i.status === "Draft" ? "Draft" : "belum diterima"})`).join(", ");
  return `Perintah belum bisa ditutup: masih ada Hand-over ${names}. Posting, terima, tolak atau batalkan dulu.`;
}

/** The hand-overs that started a Perintah's Partai, for its page. */
export async function handoversOfOrder(orderId: number): Promise<{ id: number; handoverNo: string; handoverDate: string; status: HandoverStatus; fromLabel: string; toLabel: string }[]> {
  const rows = await prisma.prdHandover.findMany({
    where: { order_id: orderId },
    orderBy: [{ handover_date: "asc" }, { id: "asc" }],
    include: { from: { select: { workstation_label: true } }, to: { select: { workstation_label: true } } },
  });
  return rows.map((r) => ({ id: r.id, handoverNo: r.handover_no, handoverDate: isoDay(r.handover_date), status: r.status as HandoverStatus, fromLabel: r.from.workstation_label, toLabel: r.to.workstation_label }));
}

/** Documents of this kind that would still post into a period closing on `to` — a blocker of Penutupan Biaya Produksi (P172, Q74). */
export async function unsettledHandoversUpTo(to: Date, db: Db = prisma): Promise<number> {
  return db.prdHandover.count({ where: { status: { in: ["Draft", "Posted"] }, handover_date: { lte: to } } });
}
