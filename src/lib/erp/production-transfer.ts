import "server-only";

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { holdPostingPeriod } from "./fiscal";
import { DAY, Refused, asDate, docTypeId, fourDecimals, fromUnits, isoDay, nextDailyNumber, parseQty, refusable, text, unitSeries, units as scaled } from "./production-doc";
import { availableBuckets, bucketsByIds, formPartai, issueJob, partaiHoldings, sendInTransit, transferBucket, trackingsByIds, unitStepsOf, type BucketView } from "./production-ledger";
import { routeMap, type RouteMap } from "./production-master";
import type { TransferKind, TransferStatus } from "./production-transfer-shape";

/**
 * Dokumen Push and BSTB between Units (P277, W64, T8). Goods leave a Unit from
 * Stand By for the next Unit of the routing they follow: **inside a Workstation
 * a Push** moves them at once into the next Persiapan; **across Workstations a
 * BSTB** keeps them at the sending Unit as Dalam Perjalanan until the receiving
 * Unit presses Terima. A BSTB Partai is the BSTB that leaves the segment before
 * the partai: the partai is formed at its Terima (W83).
 *
 * A document is made and posted (Push) or submitted (BSTB) in one step, never a
 * Draft, and writes no journal: the value stays in WIP (P275 keeps it off the
 * screen). A Job leaves whole; goods without a Job leave by the quantity typed,
 * and each such pickup gets a new No. Job at the sending Unit (W92) — except a
 * BSTB Partai and a Unit that assembles. A checkpoint Unit sends a whole partai
 * together (T5); one document holds one partai, except after the last checkpoint.
 */

type Db = Prisma.TransactionClient | typeof prisma;

export { TRANSFER_KIND_TEXT, TRANSFER_PATH, TRANSFER_STATUS_TEXT, type TransferKind, type TransferStatus } from "./production-transfer-shape";

/** The Unit each document goes to, for the reports. */
export async function transferDestinations(ids: number[]): Promise<Map<number, number>> {
  const rows = await prisma.prdTransfer.findMany({ where: { id: { in: ids } }, select: { id: true, to_unit_id: true } });
  return new Map(rows.map((t) => [t.id, t.to_unit_id]));
}

export type TransferLineInput = { bucket_id: number | null; qty: number | string };
export type TransferInput = { from_unit_id: number | null; to_unit_id: number | null; transfer_date: string; line_id: number | null; note: string; lines: TransferLineInput[] };
export type TransferResult = { ok: true; id: number; no: string; kind: TransferKind; status: TransferStatus } | { ok: false; errors: Record<string, string> };

// ------------------------------------------------------------------- rules

type Where = { routingId: number | null; step: number; routing: RouteMap["routings"][number] } | null;

/** Where a Unit sits on the routing goods follow: their partai's, else the segment before the partai. */
function placeOn(map: RouteMap, unitId: number, routingId: number | null): Where {
  const routing = routingId ? map.routings.find((r) => r.id === routingId) : map.routings.find((r) => r.lineId === null);
  const step = routing ? routing.steps.findIndex((s) => s.unitId === unitId) : -1;
  return routing && step >= 0 ? { routingId, step, routing } : null;
}

/** The partai's lines a BSTB Partai may start: the routings of each active line whose first Unit is a Unit of its own. */
function birthRoutes(map: RouteMap) {
  return map.routings.flatMap((r) => (r.lineId !== null && r.steps.length ? [{ lineId: r.lineId, routingId: r.id, toUnitId: r.steps[0].unitId, workstationId: r.steps[0].workstationId }] : []));
}

async function check(db: Db, input: TransferInput) {
  const errors: Record<string, string> = {};
  const fromId = Number(input.from_unit_id) || null;
  const toId = Number(input.to_unit_id) || null;
  const [from, to] = await Promise.all([
    fromId ? db.refUnit.findUnique({ where: { id: fromId } }) : null,
    toId ? db.refUnit.findUnique({ where: { id: toId } }) : null,
  ]);
  if (!from) errors.from_unit_id = "Pilih Unit asal.";
  else if (from.status !== "Active") errors.from_unit_id = `Unit ${from.unit_label} nonaktif.`;
  if (!to) errors.to_unit_id = "Pilih Tujuan.";
  else if (to.status !== "Active") errors.to_unit_id = `Unit ${to.unit_label} nonaktif.`;
  else if (from && to.id === from.id) errors.to_unit_id = "Tujuan sama dengan Unit asal.";
  if (!DAY.test(input.transfer_date)) errors.transfer_date = "Isi tanggal.";

  const raw = Array.isArray(input.lines) ? input.lines : [];
  if (!raw.length) errors._lines = "Pilih barang yang dikirim.";
  const buckets = await bucketsByIds(raw.flatMap((l) => (l.bucket_id ? [Number(l.bucket_id)] : [])), db);
  const rows: { line_no: number; bucket: BucketView; qty: number }[] = [];
  const seen = new Set<number>();
  raw.forEach((l, i) => {
    const key = (f: string) => `lines.${i}.${f}`;
    const b = buckets.get(Number(l.bucket_id));
    if (!b || b.unitId !== from?.id || b.stage !== "StandBy" || b.auxiliary || !(b.qty > 0)) {
      errors[key("bucket_id")] = "Barang ini tidak lagi di Stand By unit ini.";
      return;
    }
    if (seen.has(b.id)) {
      errors[key("bucket_id")] = `No. Stok ${b.lotNo} dipilih lebih dari sekali.`;
      return;
    }
    seen.add(b.id);
    // A Job leaves whole (W96); goods without one by the quantity typed.
    const qty = b.jobId ? b.qty : parseQty(l.qty);
    if (!(qty > 0)) errors[key("qty")] = "Isi jumlah lebih dari 0.";
    else if (!fourDecimals(qty)) errors[key("qty")] = "Paling banyak 4 angka desimal.";
    else if (scaled(qty) > scaled(b.qty)) errors[key("qty")] = `Melebihi saldo (${b.qty} ${b.uomLabel}).`;
    else rows.push({ line_no: rows.length + 1, bucket: b, qty: b.jobId ? b.qty : fromUnits(scaled(qty)) });
  });
  if (!from || !to || Object.keys(errors).length) return { ok: false as const, errors };

  const map = await routeMap();
  // A Job is sent with every No. Stok of it at this Unit, all of each.
  const jobIds = [...new Set(rows.flatMap((r) => (r.bucket.jobId ? [r.bucket.jobId] : [])))];
  if (jobIds.length) {
    const held = (await availableBuckets({ unitIds: [from.id], stage: "StandBy" }, db)).filter((b) => b.jobId && jobIds.includes(b.jobId) && !b.auxiliary && b.qty > 0);
    const short = held.find((b) => !rows.some((r) => r.bucket.id === b.id));
    if (short) errors._lines = `No. Job ${short.jobNo} dikirim utuh: ${short.lotNo} belum ikut.`;
  }

  // One document, one partai (W76), except after the last checkpoint (W103).
  const partais = new Set(rows.map((r) => r.bucket.partaiId));
  const routingId = rows[0].bucket.partaiRoutingId;
  const here = placeOn(map, from.id, routingId);
  const lastCheckpoint = here ? here.routing.steps.map((s) => s.checkpoint).lastIndexOf(true) : -1;
  const afterCheckpoint = here !== null && lastCheckpoint >= 0 && here.step > lastCheckpoint;
  if (!errors._lines && partais.size > 1 && !afterCheckpoint) errors._lines = "Satu dokumen hanya untuk satu partai.";

  // Where they go: the next Unit of the routing, or, from the end of the segment before the partai, the first Unit of a line.
  let birth: { lineId: number; routingId: number } | null = null;
  if (!errors._lines) {
    if (!here) errors._lines = `${from.unit_label} tidak ada di routing barang ini.`;
    else {
      const next = here.routing.steps[here.step + 1];
      if (next) {
        if (to.id !== next.unitId) errors.to_unit_id = "Tujuan harus Unit berikutnya pada routing barang ini.";
      } else if (here.routing.lineId === null) {
        const lineId = Number(input.line_id) || null;
        const route = birthRoutes(map).find((r) => r.lineId === lineId && r.toUnitId === to.id);
        if (!lineId) errors.line_id = "Pilih Line yang diikuti partai baru.";
        else if (!route) errors.to_unit_id = "Tujuan harus Unit pertama routing Line itu.";
        else if (partais.size !== 1 || rows[0].bucket.partaiId !== null) errors._lines = "Hanya barang sebelum partai yang membentuk partai baru.";
        else birth = { lineId: route.lineId, routingId: route.routingId };
      } else {
        errors._lines = `${from.unit_label} adalah Unit terakhir routing: belum ada tujuan berikutnya.`;
      }
    }
  }

  // A checkpoint sends the whole partai at once: all of it, at this Stand By, in this document (T5).
  const partaiId = rows[0].bucket.partaiId;
  if (!Object.keys(errors).length && here && partaiId && here.routing.steps[here.step].checkpoint) {
    const holding = await partaiHoldings(partaiId, db);
    const rest = holding.filter((h) => !(h.unitId === from.id && h.stage === "StandBy" && rows.some((r) => r.bucket.id === h.id && scaled(r.qty) === scaled(h.qty))));
    if (rest.length) {
      const where = [...new Set(rest.map((h) => (h.unitId === from.id && h.stage === "StandBy" ? "Stand By belum ikut" : h.unitLabel)))];
      errors._lines = `${from.unit_label} adalah checkpoint: seluruh isi partai dikirim bersama. Masih ada ${rest.length} baris di ${where.join(", ")}.`;
    }
  }

  if (Object.keys(errors).length) return { ok: false as const, errors };
  const toSteps = await unitStepsOf(db, to.id);
  const kind: TransferKind = birth ? "BstbPartai" : from.workstation_id != null && from.workstation_id === to.workstation_id ? "Push" : "Bstb";
  return {
    ok: true as const,
    from,
    to,
    kind,
    birth,
    rows,
    partaiId,
    // Goods without a Job get one on the way out, except at birth and into a Unit that assembles (W92).
    needJob: !birth && !toSteps.some((s) => s.process === "Assembly"),
    date: asDate(input.transfer_date),
    note: text(input.note),
  };
}

async function nextNo(tx: Prisma.TransactionClient, series: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${series}))`;
  const row = await tx.prdTransfer.findFirst({ where: { transfer_no: { startsWith: series } }, orderBy: { transfer_no: "desc" }, select: { transfer_no: true } });
  return nextDailyNumber(series, row?.transfer_no ?? null);
}

async function audit(db: Db, id: number, action: "TAMBAH" | "UPDATE", event: string, by: number) {
  await db.auditLog.create({ data: { entity_key: "prd_transfer", row_id: id, action, event, by } });
}

// ------------------------------------------------------------------ writing

/** Makes the document and moves the goods: a Push is received at once, a BSTB waits for Terima. */
export async function sendTransfer(input: TransferInput, actorId: number): Promise<TransferResult> {
  const first = await check(prisma, input);
  if (!first.ok) return first;
  return refusable(async () => {
    return prisma.$transaction(async (tx) => {
      await holdPostingPeriod(tx, input.transfer_date);
      const c = await check(tx, input);
      if (!c.ok) throw new Refused(c.errors);
      const push = c.kind === "Push";
      const no = await nextNo(tx, push ? unitSeries("PSH", c.from.unit_label, c.date) : unitSeries("BST", c.to.unit_label, c.date));
      const header = await tx.prdTransfer.create({
        data: {
          transfer_no: no,
          kind: c.kind,
          transfer_date: c.date,
          from_unit_id: c.from.id,
          to_unit_id: c.to.id,
          partai_id: c.partaiId,
          line_id: c.birth?.lineId ?? null,
          routing_id: c.birth?.routingId ?? null,
          status: push ? "Posted" : "Submitted",
          received_at: push ? c.date : null,
          received_by: push ? actorId : null,
          note: c.note,
          created_by: actorId,
        },
      });
      const source = { docTypeId: await docTypeId(tx, "prd_transfer"), docId: header.id, no };
      for (const r of c.rows) {
        const b = r.bucket;
        let jobId = b.jobId;
        let isNew = false;
        if (!jobId && c.needJob) {
          jobId = (await issueJob(tx, { unitId: c.from.id, lotId: b.lotId, partaiId: b.partaiId, date: c.date, source, actorId })).id;
          isNew = true;
        }
        const take = { bucketId: b.id, baseQty: r.qty, date: c.date, source, actorId };
        const moved = push ? await transferBucket(tx, { ...take, toUnitId: c.to.id, jobId }) : await sendInTransit(tx, { ...take, jobId, doc: source });
        await tx.prdTransferLine.create({
          data: {
            transfer_id: header.id,
            line_no: r.line_no,
            from_bucket_id: b.id,
            tracking_id: b.lotId,
            job_id: jobId,
            is_new_job: isNew,
            qty: r.qty,
            grams: b.gramsEach != null ? r.qty * b.gramsEach : null,
            value: moved.value,
            transit_bucket_id: push ? null : moved.toBucketId,
            to_bucket_id: push ? moved.toBucketId : null,
          },
        });
      }
      await audit(tx, header.id, "TAMBAH", push ? "create" : "send", actorId);
      return { ok: true as const, id: header.id, no, kind: c.kind, status: (push ? "Posted" : "Submitted") as TransferStatus };
    });
  });
}

/** The receiving Unit presses Terima: Dalam Perjalanan becomes Persiapan there, and a BSTB Partai forms its partai (W83). */
export async function receiveTransfer(id: number, actorId: number): Promise<{ ok: true; no: string } | { ok: false; errors: Record<string, string> }> {
  const t = await prisma.prdTransfer.findUnique({ where: { id }, include: { lines: { orderBy: { line_no: "asc" } } } });
  if (!t) return { ok: false, errors: { _form: "Dokumen tidak ditemukan." } };
  if (t.status !== "Submitted") return { ok: false, errors: { _form: "Status dokumen sudah berubah. Muat ulang." } };
  const today = new Date().toISOString().slice(0, 10);
  return refusable(async () =>
    prisma.$transaction(async (tx) => {
      await holdPostingPeriod(tx, today);
      const done = await tx.prdTransfer.updateMany({ where: { id, status: "Submitted" }, data: { status: "Posted", received_at: asDate(today), received_by: actorId, updated_by: actorId } });
      if (done.count !== 1) throw new Refused({ _form: "Status dokumen sudah berubah. Muat ulang." });
      const date = asDate(today);
      const source = { docTypeId: await docTypeId(tx, "prd_transfer"), docId: id, no: t.transfer_no };
      let partaiId: number | undefined;
      if (t.kind === "BstbPartai") {
        const born = await formPartai(tx, { lineId: t.line_id!, routingId: t.routing_id!, date, source, actorId });
        partaiId = born.id;
        await tx.prdTransfer.update({ where: { id }, data: { partai_id: born.id } });
      }
      for (const l of t.lines) {
        const moved = await transferBucket(tx, { bucketId: l.transit_bucket_id!, baseQty: l.qty, toUnitId: t.to_unit_id, fromStage: "InTransit", partaiId, jobId: l.job_id, date, source, actorId });
        await tx.prdTransferLine.update({ where: { id: l.id }, data: { to_bucket_id: moved.toBucketId } });
      }
      await audit(tx, id, "UPDATE", "receive", actorId);
      return { ok: true as const, no: t.transfer_no };
    })
  );
}

// -------------------------------------------------------------------- reads

export type TransferRow = { id: number; no: string; kind: TransferKind; date: string; status: TransferStatus; fromLabel: string; toLabel: string; fromUnitId: number; toUnitId: number; lines: number; grams: number };

/** `units`: the actor's Units, or null for all; a transfer shows to both ends (P260). */
export async function listTransfers(units: number[] | null = null): Promise<TransferRow[]> {
  const rows = await prisma.prdTransfer.findMany({
    where: units ? { OR: [{ from_unit_id: { in: units } }, { to_unit_id: { in: units } }] } : undefined,
    orderBy: [{ transfer_date: "desc" }, { id: "desc" }],
    include: { from_unit: true, to_unit: true, lines: { select: { grams: true } } },
  });
  return rows.map((r) => ({
    id: r.id,
    no: r.transfer_no,
    kind: r.kind,
    date: isoDay(r.transfer_date),
    status: r.status,
    fromLabel: r.from_unit.unit_label,
    toLabel: r.to_unit.unit_label,
    fromUnitId: r.from_unit_id,
    toUnitId: r.to_unit_id,
    lines: r.lines.length,
    grams: r.lines.reduce((a, l) => a + (l.grams?.toNumber() ?? 0), 0),
  }));
}

export type TransferView = TransferRow & {
  receivedAt: string | null;
  partaiNo: string | null;
  lineName: string | null;
  note: string | null;
  items: { lineNo: number; lotNo: string; itemLabel: string; itemName: string; jobNo: string | null; newJob: boolean; qty: number; uomLabel: string; grams: number | null }[];
};

export async function getTransfer(id: number): Promise<TransferView | null> {
  const t = await prisma.prdTransfer.findUnique({
    where: { id },
    include: { from_unit: true, to_unit: true, partai: { select: { partai_no: true } }, line: { select: { line_name: true } }, lines: { orderBy: { line_no: "asc" }, include: { job: { select: { job_no: true } } } } },
  });
  if (!t) return null;
  const byId = await trackingsByIds(t.lines.map((l) => l.tracking_id));
  return {
    id: t.id,
    no: t.transfer_no,
    kind: t.kind,
    date: isoDay(t.transfer_date),
    status: t.status,
    fromLabel: t.from_unit.unit_label,
    toLabel: t.to_unit.unit_label,
    fromUnitId: t.from_unit_id,
    toUnitId: t.to_unit_id,
    lines: t.lines.length,
    grams: t.lines.reduce((a, l) => a + (l.grams?.toNumber() ?? 0), 0),
    receivedAt: t.received_at ? isoDay(t.received_at) : null,
    partaiNo: t.partai?.partai_no ?? null,
    lineName: t.line?.line_name ?? null,
    note: t.note,
    items: t.lines.map((l) => {
      const x = byId.get(l.tracking_id);
      return { lineNo: l.line_no, lotNo: x?.no ?? "", itemLabel: x?.itemLabel ?? "", itemName: x?.itemName ?? "", jobNo: l.job?.job_no ?? null, newJob: l.is_new_job, qty: l.qty.toNumber(), uomLabel: x?.uomLabel ?? "", grams: l.grams?.toNumber() ?? null };
    }),
  };
}

export async function transferNumbersByIds(ids: number[]): Promise<Map<number, string>> {
  const rows = await prisma.prdTransfer.findMany({ where: { id: { in: ids } }, select: { id: true, transfer_no: true } });
  return new Map(rows.map((r) => [r.id, r.transfer_no]));
}

/** The Units a transfer touches, for the actions' Unit check (P260). */
export async function transferUnits(id: number): Promise<{ from: number; to: number } | null> {
  const t = await prisma.prdTransfer.findUnique({ where: { id }, select: { from_unit_id: true, to_unit_id: true } });
  return t ? { from: t.from_unit_id, to: t.to_unit_id } : null;
}

export type IncomingTransfer = { id: number; no: string; kind: TransferKind; date: string; fromLabel: string; toUnitId: number; lines: { lotNo: string; jobNo: string | null; qty: number; grams: number | null }[] };

/** The BSTB waiting for Terima: the Workspace's Penerimaan beside the BSTB Issue (W20). */
export async function incomingTransfers(): Promise<IncomingTransfer[]> {
  const rows = await prisma.prdTransfer.findMany({
    where: { status: "Submitted" },
    orderBy: [{ transfer_date: "asc" }, { id: "asc" }],
    include: { from_unit: { select: { unit_label: true } }, lines: { orderBy: { line_no: "asc" }, include: { job: { select: { job_no: true } } } } },
  });
  const trackings = await trackingsByIds(rows.flatMap((r) => r.lines.map((l) => l.tracking_id)));
  return rows.map((r) => ({
    id: r.id,
    no: r.transfer_no,
    kind: r.kind,
    date: isoDay(r.transfer_date),
    fromLabel: r.from_unit.unit_label,
    toUnitId: r.to_unit_id,
    lines: r.lines.map((l) => ({ lotNo: trackings.get(l.tracking_id)?.no ?? "", jobNo: l.job?.job_no ?? null, qty: l.qty.toNumber(), grams: l.grams?.toNumber() ?? null })),
  }));
}

export type TransferRoute = { toUnitId: number; toLabel: string; kind: TransferKind; routingId: number | null; line: { id: number; name: string } | null };
export type TransferOptions = { unit: { id: number; label: string; name: string }; buckets: BucketView[]; routes: TransferRoute[] };

/** What a Unit has in Stand By, and where each routing sends it: the form of a Push or BSTB. */
export async function transferOptions(unitId: number): Promise<TransferOptions | null> {
  const unit = await prisma.refUnit.findUnique({ where: { id: unitId }, select: { id: true, unit_label: true, unit_name: true, workstation_id: true } });
  if (!unit) return null;
  const [buckets, map] = await Promise.all([availableBuckets({ unitIds: [unitId], stage: "StandBy" }), routeMap()]);
  const goods = buckets.filter((b) => !b.auxiliary && b.qty > 0);
  const routes: TransferRoute[] = [];
  const labels = new Map((await prisma.refUnit.findMany({ select: { id: true, unit_label: true, workstation_id: true } })).map((u) => [u.id, u]));
  const lines = new Map(map.lines.map((l) => [l.id, l]));
  for (const routingId of new Set(goods.map((b) => b.partaiRoutingId))) {
    const here = placeOn(map, unitId, routingId);
    if (!here) continue;
    const next = here.routing.steps[here.step + 1];
    if (next) {
      const to = labels.get(next.unitId);
      routes.push({ toUnitId: next.unitId, toLabel: to?.unit_label ?? "", kind: unit.workstation_id != null && unit.workstation_id === to?.workstation_id ? "Push" : "Bstb", routingId, line: null });
    } else if (here.routing.lineId === null) {
      for (const r of birthRoutes(map)) routes.push({ toUnitId: r.toUnitId, toLabel: labels.get(r.toUnitId)?.unit_label ?? "", kind: "BstbPartai", routingId, line: { id: r.lineId, name: lines.get(r.lineId)?.name ?? "" } });
    }
  }
  return { unit: { id: unit.id, label: unit.unit_label, name: unit.unit_name }, buckets: goods, routes };
}
