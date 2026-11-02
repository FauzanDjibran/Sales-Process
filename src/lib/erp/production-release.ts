import "server-only";

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { BASE_CURRENCY_LABEL } from "./currency";
import { nextDocumentNumber } from "./document-number";
import { checkTransactionDate } from "./fiscal";
import { receiveStock, warehouseLocationOptions } from "./inventory";
import { PostingDryRun, describeJournalLines, journalNumbersByIds, postJournal, type JournalLineInput, type JournalPreviewResult } from "./journal";
import { takeFromBucket } from "./production-ledger";
import { fallbackAccounts } from "./system-settings";
import {
  DAY,
  Refused,
  asDate,
  bucketOptions,
  checkBucketLines,
  docTypeId,
  firstError,
  isoDay,
  itemAccounts,
  refusable,
  text,
  workstationOptions,
  type BucketLineInput,
  type BucketOption,
  type Db,
  type Place,
  type PostResult,
} from "./production-doc";
import { RELEASE_WORKFLOW, prodDocIsEditable, prodDocTransitionAllowed, type ProdDocAction, type ProdDocStatus } from "./production-doc-workflow";
import { RELEASE_PURPOSES, releasePurpose, type ReleasePurposeKey } from "./production-release-purposes";

/**
 * Production Release (R8; `prd_release(_line)`) — goods leave production, any
 * quantity of any lot held at the workstation, at the value the bucket
 * releases, by purpose:
 *
 * - **`to_stock`** (*Penerimaan Hasil Produksi*, `PHP/…`): into a warehouse
 *   (and location, P136) **under the same lot**, through the stock books at
 *   that value; Dr Persediaan (the category's, else Account Mapping's) / Cr WIP.
 * - **`scrap`** (*Pemusnahan Produksi*, `PMS/…`): written off with a reason;
 *   Dr Beban Pemusnahan Produksi (Account Mapping) / Cr WIP.
 *
 * WIP is the item's category's, no fallback (R16). Named only by this module.
 */

export type ReleaseInput = {
  purpose: ReleasePurposeKey;
  release_date: string;
  workstation_id: number | null;
  warehouse_id: number | null;
  location_id: number | null;
  scrap_reason: string;
  note: string;
  lines: BucketLineInput[];
};
export type ReleaseResult = { ok: true; id: number; no: string } | { ok: false; errors: Record<string, string> };
export type ReleaseOptions = { workstations: Place[]; warehouses: (Place & { locations: Place[] })[]; buckets: BucketOption[] };

export async function releaseOptions(current: { workstationId: number; warehouseId: number | null; bucketIds: number[] } | null = null, db: Db = prisma): Promise<ReleaseOptions> {
  const [workstations, buckets, warehouses] = await Promise.all([
    workstationOptions(current ? [current.workstationId] : [], db),
    bucketOptions(current?.bucketIds ?? [], db),
    db.refWarehouse.findMany({
      where: { OR: [{ status: "Active" }, ...(current?.warehouseId ? [{ id: current.warehouseId }] : [])] },
      orderBy: { warehouse_label: "asc" },
      select: { id: true, warehouse_label: true, warehouse_name: true, status: true, use_location: true },
    }),
  ]);
  const locations = await warehouseLocationOptions(warehouses.filter((w) => w.use_location).map((w) => w.id), db);
  return {
    workstations,
    buckets,
    warehouses: warehouses.map((w) => ({ id: w.id, label: w.warehouse_label, name: w.warehouse_name, active: w.status === "Active", locations: locations.get(w.id) ?? [] })),
  };
}

type Checked = {
  data: { purpose: ReleasePurposeKey; release_date: Date; workstation_id: number; warehouse_id: number | null; location_id: number | null; scrap_reason: string | null; note: string | null };
  label: string;
  lines: ReturnType<typeof checkBucketLines>;
};

export async function checkRelease(db: Db, input: ReleaseInput, selfId: number | null, forPosting = false): Promise<{ ok: true; c: Checked } | { ok: false; errors: Record<string, string> }> {
  const errors: Record<string, string> = {};
  const purpose = releasePurpose(input.purpose);
  if (!purpose) return { ok: false, errors: { purpose: "Tujuan tidak dikenal." } };
  const stored = selfId
    ? await db.prdRelease.findUnique({ where: { id: selfId }, select: { workstation_id: true, warehouse_id: true, lines: { select: { bucket_id: true } } } })
    : null;
  const options = await releaseOptions(stored ? { workstationId: stored.workstation_id, warehouseId: stored.warehouse_id, bucketIds: stored.lines.map((l) => l.bucket_id) } : null, db);
  const date = String(input.release_date ?? "").trim();
  if (!DAY.test(date)) errors.release_date = "Tanggal wajib diisi.";
  const wsId = Number(input.workstation_id) || null;
  const ws = wsId ? options.workstations.find((w) => w.id === wsId) : undefined;
  if (!wsId) errors.workstation_id = "Pilih Workstation.";
  else if (!ws || (!ws.active && (forPosting || stored?.workstation_id !== wsId))) errors.workstation_id = "Workstation tidak ditemukan atau nonaktif.";

  let warehouseId: number | null = null;
  let locationId: number | null = null;
  let where = "";
  if (purpose.toStock) {
    const whId = Number(input.warehouse_id) || null;
    const wh = whId ? options.warehouses.find((w) => w.id === whId) : undefined;
    if (!whId) errors.warehouse_id = "Pilih Gudang tujuan.";
    else if (!wh || (!wh.active && (forPosting || stored?.warehouse_id !== whId))) errors.warehouse_id = "Gudang tidak ditemukan atau nonaktif.";
    else {
      warehouseId = wh.id;
      where = wh.label;
      const locId = Number(input.location_id) || null;
      if (wh.locations.length || locId) {
        const loc = locId ? wh.locations.find((l) => l.id === locId) : undefined;
        if (!loc) errors.location_id = "Gudang ini memakai lokasi: pilih lokasinya.";
        else locationId = loc.id;
      }
    }
  }
  const scrapReason = text(input.scrap_reason);
  if (!purpose.toStock && !scrapReason) errors.scrap_reason = "Alasan pemusnahan wajib diisi.";

  if (!input.lines?.length) errors._lines = "Tambahkan minimal satu lot.";
  const lines = checkBucketLines(input.lines, options.buckets, ws?.id ?? null, "lines", errors);
  if (!errors._lines && Object.keys(errors).some((k) => k.startsWith("lines."))) errors._lines = "Ada baris yang perlu diperbaiki.";
  if (Object.keys(errors).length || !ws) return { ok: false, errors };
  return {
    ok: true,
    c: {
      data: { purpose: purpose.key, release_date: asDate(date), workstation_id: ws.id, warehouse_id: warehouseId, location_id: locationId, scrap_reason: purpose.toStock ? null : scrapReason, note: text(input.note) },
      label: purpose.toStock ? `${ws.label} → ${where}` : ws.label,
      lines,
    },
  };
}

async function nextNo(db: Db, prefix: string, date: Date): Promise<string> {
  return nextDocumentNumber(prefix, date, async (series) => {
    const row = await db.prdRelease.findFirst({ where: { release_no: { startsWith: series } }, orderBy: { id: "desc" }, select: { release_no: true } });
    return row?.release_no ?? null;
  });
}

async function audit(db: Db, id: number, action: "TAMBAH" | "UPDATE", event: string, by: number) {
  await db.auditLog.create({ data: { entity_key: "prd_release", row_id: id, action, event, by } });
}

async function writeLines(tx: Prisma.TransactionClient, id: number, c: Checked) {
  await tx.prdReleaseLine.deleteMany({ where: { release_id: id } });
  for (const l of c.lines) await tx.prdReleaseLine.create({ data: { release_id: id, line_no: l.line_no, bucket_id: l.bucket_id, lot_id: l.lot_id, item_id: l.item_id, qty: l.qty } });
}

export async function createRelease(input: ReleaseInput, actorId: number): Promise<ReleaseResult> {
  return refusable(async () =>
    prisma.$transaction(async (tx) => {
      const r = await checkRelease(tx, input, null);
      if (!r.ok) throw new Refused(r.errors);
      const no = await nextNo(tx, releasePurpose(r.c.data.purpose)!.prefix, r.c.data.release_date);
      const row = await tx.prdRelease.create({ data: { ...r.c.data, release_no: no, created_by: actorId } });
      await writeLines(tx, row.id, r.c);
      await audit(tx, row.id, "TAMBAH", "create", actorId);
      return { ok: true as const, id: row.id, no };
    })
  );
}

export async function updateRelease(id: number, input: ReleaseInput, actorId: number): Promise<ReleaseResult> {
  const current = await prisma.prdRelease.findUnique({ where: { id }, select: { status: true, release_no: true, purpose: true } });
  if (!current) return { ok: false, errors: { _form: "Production Release tidak ditemukan." } };
  if (!prodDocIsEditable(current.status)) return { ok: false, errors: { _form: "Hanya Draft yang dapat diubah." } };
  return refusable(async () =>
    prisma.$transaction(async (tx) => {
      // The purpose decides the number series, so it is fixed once saved.
      const r = await checkRelease(tx, { ...input, purpose: current.purpose as ReleasePurposeKey }, id);
      if (!r.ok) throw new Refused(r.errors);
      const done = await tx.prdRelease.updateMany({ where: { id, status: "Draft" }, data: { ...r.c.data, updated_by: actorId } });
      if (done.count !== 1) throw new Refused({ _form: "Production Release berubah saat disimpan. Muat ulang halaman." });
      await writeLines(tx, id, r.c);
      await audit(tx, id, "UPDATE", "update", actorId);
      return { ok: true as const, id, no: current.release_no };
    })
  );
}

const WITH_LINES = { lines: { orderBy: { line_no: "asc" as const } } };
type Stored = Prisma.PrdReleaseGetPayload<{ include: typeof WITH_LINES }>;

const asInput = (d: Stored): ReleaseInput => ({
  purpose: d.purpose as ReleasePurposeKey,
  release_date: isoDay(d.release_date),
  workstation_id: d.workstation_id,
  warehouse_id: d.warehouse_id,
  location_id: d.location_id,
  scrap_reason: d.scrap_reason ?? "",
  note: d.note ?? "",
  lines: d.lines.map((l) => ({ bucket_id: l.bucket_id, qty: l.qty.toString() })),
});

/**
 * **Posting**, in one transaction: rechecks, takes each line out of its bucket
 * at the value released and — for `to_stock` — receives it into the warehouse
 * under the same lot at that value; then one journal, Dr Persediaan or Beban
 * Pemusnahan / Cr WIP per line. Dry run for the confirmation (P103).
 */
export async function transitionRelease(id: number, action: ProdDocAction, actorId: number, reason?: string, options: { dryRun?: boolean } = {}): Promise<PostResult> {
  const d = await prisma.prdRelease.findUnique({ where: { id }, include: WITH_LINES });
  if (!d) return { ok: false, errors: { _form: "Production Release tidak ditemukan." } };
  if (!prodDocTransitionAllowed(RELEASE_WORKFLOW, action, d.status)) {
    return { ok: false, errors: { _form: `Production Release berstatus ini tidak dapat di-${RELEASE_WORKFLOW.transitions[action].label.toLowerCase()}.` } };
  }
  const moved = "Production Release berubah saat diproses. Muat ulang halaman.";
  if (action === "cancel") {
    const why = String(reason ?? "").trim();
    if (!why) return { ok: false, errors: { reason: "Alasan wajib diisi." } };
    await prisma.$transaction(async (tx) => {
      const done = await tx.prdRelease.updateMany({ where: { id, status: "Draft" }, data: { status: "Cancelled", cancel_reason: why, updated_by: actorId } });
      if (done.count !== 1) throw new Error(moved);
      await audit(tx, id, "UPDATE", "cancel", actorId);
    });
    return { ok: true };
  }

  const period = await checkTransactionDate(isoDay(d.release_date));
  if (!period.ok) return { ok: false, errors: { _form: period.message } };
  const toStock = releasePurpose(d.purpose)!.toStock;
  const mapped = await fallbackAccounts(["inventory_account", "production_scrap_account"] as const);
  const accounts = await itemAccounts(d.lines.map((l) => l.item_id), toStock ? ["wip", "inventory"] : ["wip"], mapped.inventory_account);
  if (!accounts.ok) return { ok: false, errors: { _form: accounts.message } };
  if (!toStock && !mapped.production_scrap_account) {
    return { ok: false, errors: { _form: "Account Beban Pemusnahan Produksi belum diatur di Account Mapping › Produksi." } };
  }
  const currency = await prisma.refCurrency.findFirst({ where: { currency_label: BASE_CURRENCY_LABEL }, select: { id: true } });
  if (!currency) return { ok: false, errors: { _form: "Mata uang dasar tidak ditemukan." } };

  return refusable(async () => {
    const journalLines: JournalLineInput[] = [];
    await prisma.$transaction(async (tx) => {
      const r = await checkRelease(tx, asInput(d), id, true);
      if (!r.ok) throw new Refused({ _form: `Belum bisa diposting: ${firstError(r.errors)}` });
      const done = await tx.prdRelease.updateMany({ where: { id, status: "Draft" }, data: { status: "Posted", updated_by: actorId } });
      if (done.count !== 1) throw new Refused({ _form: moved });
      const source = { docTypeId: await docTypeId(tx, "prd_release"), docId: id, no: d.release_no };
      const date = r.c.data.release_date;
      const base = { currencyId: currency.id, rate: 1 };
      let total = 0;
      for (const l of r.c.lines) {
        const out = await takeFromBucket(tx, { bucketId: l.bucket_id, baseQty: l.qty, date, source, actorId });
        if (toStock) {
          await receiveStock(tx, {
            itemId: l.item_id,
            warehouseId: r.c.data.warehouse_id!,
            locationId: r.c.data.location_id,
            lotNo: out.lotNo,
            expiry: out.expiry,
            baseQty: l.qty,
            value: out.value,
            date,
            source,
            actorId,
          });
        }
        await tx.prdReleaseLine.update({ where: { release_id_line_no: { release_id: id, line_no: l.line_no } }, data: { value: out.value } });
        total += out.value;
        if (out.value > 0) {
          const acc = accounts.accounts.get(l.item_id)!;
          const what = `${l.bucket.itemLabel} lot ${out.lotNo}`;
          journalLines.push(
            { ...base, accountId: toStock ? acc.inventory! : mapped.production_scrap_account!, debit: out.value, credit: 0, description: `${toStock ? "Masuk" : "Musnah"} ${what}` },
            { ...base, accountId: acc.wip, debit: 0, credit: out.value, description: `Keluar ${r.c.label} · ${what}` }
          );
        }
      }
      // Goods carried at no value leave with no journal: nothing changes in the books.
      const journal = journalLines.length
        ? await postJournal(tx, {
            description: `${d.release_no} · ${releasePurpose(d.purpose)!.name} ${r.c.label}`,
            sourceDocTypeId: source.docTypeId,
            sourceDocId: id,
            postingDate: date,
            actorId,
            lines: journalLines,
          })
        : null;
      await tx.prdRelease.update({ where: { id }, data: { value: total, journal_id: journal?.id ?? null } });
      await audit(tx, id, "UPDATE", "post", actorId);
      if (options.dryRun) throw new PostingDryRun(journalLines);
    });
    return { ok: true as const, journal: journalLines };
  });
}

export async function releasePreview(id: number, actorId: number): Promise<JournalPreviewResult> {
  try {
    const r = await transitionRelease(id, "post", actorId, undefined, { dryRun: true });
    if (!r.ok) return r;
    return { ok: true, lines: await describeJournalLines(r.journal ?? []) };
  } catch (e) {
    if (e instanceof Error) return { ok: false, errors: { _form: e.message } };
    throw e;
  }
}

export type ReleaseListRow = {
  id: number;
  no: string;
  date: string;
  status: ProdDocStatus;
  purposeName: string;
  workstation: { label: string; name: string };
  warehouse: { label: string; name: string };
  lines: number;
  value: number;
};

export async function listReleases(): Promise<ReleaseListRow[]> {
  const rows = await prisma.prdRelease.findMany({ include: { workstation: true, warehouse: true, _count: { select: { lines: true } } }, orderBy: [{ release_date: "desc" }, { id: "desc" }] });
  return rows.map((r) => ({
    id: r.id,
    no: r.release_no,
    date: isoDay(r.release_date),
    status: r.status,
    purposeName: RELEASE_PURPOSES.find((p) => p.key === r.purpose)?.short ?? r.purpose,
    workstation: { label: r.workstation.workstation_label, name: r.workstation.workstation_name },
    warehouse: r.warehouse ? { label: r.warehouse.warehouse_label, name: r.warehouse.warehouse_name } : { label: "", name: "" },
    lines: r._count.lines,
    value: r.value.toNumber(),
  }));
}

export type ReleaseView = { id: number; no: string; status: ProdDocStatus; input: ReleaseInput; lineValues: number[]; value: number; journalId: number | null; journalNo: string | null; cancelReason: string | null };

export async function getRelease(id: number): Promise<ReleaseView | null> {
  const d = await prisma.prdRelease.findUnique({ where: { id }, include: WITH_LINES });
  if (!d) return null;
  return {
    id: d.id,
    no: d.release_no,
    status: d.status,
    input: asInput(d),
    lineValues: d.lines.map((l) => l.value.toNumber()),
    value: d.value.toNumber(),
    journalId: d.journal_id,
    journalNo: d.journal_id ? ((await journalNumbersByIds([d.journal_id])).get(d.journal_id) ?? null) : null,
    cancelReason: d.cancel_reason,
  };
}

export const releaseCurrent = (v: ReleaseView) => ({
  workstationId: Number(v.input.workstation_id),
  warehouseId: v.input.warehouse_id ? Number(v.input.warehouse_id) : null,
  bucketIds: v.input.lines.map((l) => Number(l.bucket_id)),
});

export async function releaseNumbersByIds(ids: number[]): Promise<Map<number, string>> {
  if (!ids.length) return new Map();
  const rows = await prisma.prdRelease.findMany({ where: { id: { in: ids } }, select: { id: true, release_no: true } });
  return new Map(rows.map((r) => [r.id, r.release_no]));
}

/** For the Gudang master (Gunakan Lokasi): Draft releases into the warehouse, and which locations any release names. */
export async function releaseLocationUse(warehouseId: number, locationIds: number[]): Promise<{ drafts: number; named: Set<number> }> {
  const [drafts, named] = await Promise.all([
    prisma.prdRelease.count({ where: { warehouse_id: warehouseId, status: "Draft" } }),
    locationIds.length ? prisma.prdRelease.findMany({ where: { location_id: { in: locationIds } }, distinct: ["location_id"], select: { location_id: true } }) : [],
  ]);
  return { drafts, named: new Set(named.flatMap((r) => (r.location_id ? [r.location_id] : []))) };
}

/** Drafts dated up to a day — the month-end close's checklist (R28). */
export async function draftReleasesUpTo(to: Date, db: Db = prisma): Promise<number> {
  return db.prdRelease.count({ where: { status: "Draft", release_date: { lte: to } } });
}

/** The purpose of each release, by id (`to_stock` / `scrap`) — the close sends value to stock or scrap by it (R12). */
export async function releasePurposesByIds(ids: number[], db: Db = prisma): Promise<Map<number, string>> {
  if (!ids.length) return new Map();
  const rows = await db.prdRelease.findMany({ where: { id: { in: ids } }, select: { id: true, purpose: true } });
  return new Map(rows.map((r) => [r.id, r.purpose]));
}
