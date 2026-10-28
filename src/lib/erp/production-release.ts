import "server-only";

import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import { BASE_CURRENCY_LABEL } from "./currency";
import { checkTransactionDate } from "./fiscal";
import { PostingDryRun, describeJournalLines, journalNumbersByIds, postJournal, type JournalLineInput, type JournalPreviewResult } from "./journal";
import { accountsForItems } from "./item-account";
import { InventoryRefusal, receiveStock, warehouseLocationOptions, type WarehouseLocationOption } from "./inventory";
import { formatNumber } from "@/lib/format";
import {
  ProductionRefusal,
  availableBuckets,
  bucketsByIds,
  orderIdOfPartai,
  partaiInProduction,
  productionIdentityNumbers,
  takeFromBucket,
  type BucketView,
} from "./production-ledger";
import { finishProductionOrder } from "./production-order";
import { nextDailyNumber } from "./production-number";
import { fallbackAccounts } from "./system-settings";
import {
  RELEASE_TRANSITIONS,
  releaseIsEditable,
  releasePurpose,
  releaseTransitionAllowed,
  type ReleaseAction,
  type ReleasePurpose,
  type ReleasePurposeDef,
  type ReleaseStatus,
} from "./production-release-workflow";

/**
 * What takes goods out of production (Walet step 6, P170, M118): its tables are
 * `prd_release` and `prd_release_line`, and nothing else names them. One table by
 * **purpose** (P106) — **Penerimaan Hasil Produksi** (`finished_receipt`) and
 * **Pemusnahan Produksi** (`scrap`) — each its own menu, number and permissions.
 *
 * The user names the workstation the goods leave and the day, then picks lines
 * from what the station holds — received goods, any quantity, a Reject included
 * (this is how it leaves); never goods in transit. A receipt also names the
 * warehouse (and, where it keeps locations, the place of each line); a scrap says
 * why.
 *
 * **Posting**, in one transaction: each line leaves its bucket at round(V × q ÷ Q)
 * (V whole when it empties, `takeFromBucket`); a receipt brings the goods into the
 * stock books **under the same lot** at that value (`receiveStock` — a Turunan at
 * the value it holds then, a BJL or a Reject at 0); the journal is **Dr Persediaan
 * / Cr WIP** (receipt) or **Dr Beban Pemusnahan Produksi / Cr WIP** (scrap), WIP
 * being the item's Kategori Item's, with no fallback (M62). When the last goods of
 * a Partai have left, its Perintah closes itself.
 *
 * shortcut: the production bucket is locked before the stock pool, the reverse of
 * the Logistik BSTB (§16 X23); a BSTB and a receipt of one lot posted at the same
 * instant could deadlock, and one of them would fail and be retried.
 */

type Db = Prisma.TransactionClient | typeof prisma;
const D = Prisma.Decimal;
type Dec = Prisma.Decimal;

// ------------------------------------------------------------------ input

export type ReleaseHeaderInput = {
  purpose: ReleasePurpose;
  release_date: string;
  workstation_id: number | null;
  /** A receipt's warehouse; unused by a scrap. */
  warehouse_id: number | null;
  /** A scrap's reason. */
  reason: string;
  note: string;
};

export type ReleaseLineInput = { bucket_id: number | null; qty: number | string; /** Where in a warehouse that keeps locations. */ location_id?: number | null };

export type ReleaseResult = { ok: true; id: number; releaseNo: string } | { ok: false; errors: Record<string, string> };

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const asDate = (d: string) => new Date(`${d}T00:00:00Z`);
const isoDay = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "");
const text = (v: unknown) => String(v ?? "").trim() || null;
const lineKey = (i: number, f: string) => `lines.${i}.${f}`;
const qtyText = (d: Dec | number) => formatNumber(Number(d), 2);

async function docTypeId(db: Db, table: string): Promise<number> {
  const row = await db.sysDocType.findFirst({ where: { doc_table: table }, select: { id: true } });
  if (!row) throw new Error(`Jenis dokumen ${table} belum terdaftar. Jalankan db:seed.`);
  return row.id;
}

function parseQty(v: unknown): Dec | null {
  const s = String(v ?? "").trim().replace(",", ".");
  if (!/^\d+(\.\d{1,6})?$/.test(s)) return null;
  const d = new D(s);
  return d.gt(0) ? d : null;
}

// ---------------------------------------------------------------- options

export type ReleaseStation = { id: number; label: string; name: string; active: boolean };
export type ReleaseWarehouse = { id: number; label: string; name: string; active: boolean; useLocation: boolean; locations: WarehouseLocationOption[] };

export type ReleaseOptions = {
  workstations: ReleaseStation[];
  /** Goods held at any station, not in transit — the form narrows to the document's. */
  buckets: BucketView[];
  /** Active warehouses with their locations — a receipt's destination. */
  warehouses: ReleaseWarehouse[];
};

export type ReleaseCurrent = { workstationId: number | null; warehouseId: number | null; bucketIds: number[] };

export async function releaseOptions(current: ReleaseCurrent | null = null, db: Db = prisma): Promise<ReleaseOptions> {
  const [workstations, buckets, warehouses] = await Promise.all([
    db.refWorkstation.findMany({
      where: { OR: [{ status: "Active" }, ...(current?.workstationId ? [{ id: current.workstationId }] : [])] },
      orderBy: { workstation_label: "asc" },
      select: { id: true, workstation_label: true, workstation_name: true, status: true },
    }),
    availableBuckets({ withIds: current?.bucketIds }, db),
    db.refWarehouse.findMany({
      where: { OR: [{ status: "Active" }, ...(current?.warehouseId ? [{ id: current.warehouseId }] : [])] },
      orderBy: { warehouse_label: "asc" },
      select: { id: true, warehouse_label: true, warehouse_name: true, status: true, use_location: true },
    }),
  ]);
  const locations = await warehouseLocationOptions(warehouses.filter((w) => w.use_location).map((w) => w.id), db);
  return {
    workstations: workstations.map((w) => ({ id: w.id, label: w.workstation_label, name: w.workstation_name, active: w.status === "Active" })),
    buckets,
    warehouses: warehouses.map((w) => ({
      id: w.id,
      label: w.warehouse_label,
      name: w.warehouse_name,
      active: w.status === "Active",
      useLocation: w.use_location,
      locations: locations.get(w.id) ?? [],
    })),
  };
}

// ------------------------------------------------------------- validation

type CheckedLine = { line_no: number; bucket: BucketView; qty: Dec; location_id: number | null };

type Checked = {
  purpose: ReleasePurposeDef;
  data: { release_date: Date; workstation_id: number; warehouse_id: number | null; reason: string | null; note: string | null };
  station: ReleaseStation;
  warehouse: ReleaseWarehouse | null;
  lines: CheckedLine[];
};

/**
 * Every rule a document must satisfy to be saved — and, run again inside the
 * posting transaction with `forPosting`, to be posted: the station and warehouse
 * still active, every line's place named where the warehouse keeps locations.
 */
export async function checkRelease(
  db: Db,
  header: ReleaseHeaderInput,
  lines: ReleaseLineInput[],
  selfId: number | null,
  forPosting = false
): Promise<{ ok: true; c: Checked } | { ok: false; errors: Record<string, string> }> {
  const errors: Record<string, string> = {};
  const purpose = releasePurpose(header.purpose);
  if (!purpose) return { ok: false, errors: { _form: "Tujuan dokumen tidak dikenal." } };
  const stored = selfId
    ? await db.prdRelease.findUnique({ where: { id: selfId }, select: { workstation_id: true, warehouse_id: true, lines: { select: { source_bucket_id: true } } } })
    : null;
  const options = await releaseOptions(stored ? { workstationId: stored.workstation_id, warehouseId: stored.warehouse_id, bucketIds: stored.lines.map((l) => l.source_bucket_id) } : null, db);
  const bucketById = new Map(options.buckets.map((b) => [b.id, b]));

  const wsId = Number(header.workstation_id) || null;
  const station = wsId ? options.workstations.find((w) => w.id === wsId) : undefined;
  if (!wsId) errors.workstation_id = "Pilih Workstation.";
  else if (!station || (!station.active && (forPosting || stored?.workstation_id !== wsId))) errors.workstation_id = "Workstation tidak ditemukan atau nonaktif.";

  let warehouse: ReleaseWarehouse | null = null;
  if (purpose.needsWarehouse) {
    const whId = Number(header.warehouse_id) || null;
    warehouse = whId ? (options.warehouses.find((w) => w.id === whId) ?? null) : null;
    if (!whId) errors.warehouse_id = "Pilih gudang tujuan.";
    else if (!warehouse || (!warehouse.active && (forPosting || stored?.warehouse_id !== whId))) errors.warehouse_id = "Gudang tidak ditemukan atau nonaktif.";
  }
  const day = String(header.release_date ?? "").trim();
  if (!DAY.test(day)) errors.release_date = "Tanggal wajib diisi.";
  const reason = text(header.reason);
  if (purpose.needsReason && !reason) errors.reason = "Alasan pemusnahan wajib diisi.";

  const raw = Array.isArray(lines) ? lines : [];
  if (!raw.length) errors._lines = "Pilih barang yang keluar dari produksi.";
  const out: CheckedLine[] = [];
  const used = new Set<number>();
  for (const [i, l] of raw.entries()) {
    const b = Number(l.bucket_id) ? bucketById.get(Number(l.bucket_id)) : undefined;
    if (!b) {
      errors[lineKey(i, "bucket_id")] = "Barang tidak ditemukan di workstation. Pilih ulang.";
      continue;
    }
    if (b.inTransit || (wsId && b.workstationId !== wsId)) {
      errors[lineKey(i, "bucket_id")] = `${b.itemLabel} lot ${b.lotNo} tidak sedang diterima di workstation ini.`;
      continue;
    }
    if (used.has(b.id)) {
      errors[lineKey(i, "bucket_id")] = `${b.itemLabel} lot ${b.lotNo} sudah ada di dokumen ini.`;
      continue;
    }
    const qty = parseQty(l.qty);
    if (!qty) {
      errors[lineKey(i, "qty")] = "Isi jumlah lebih dari 0, paling banyak 6 angka desimal.";
      continue;
    }
    if (qty.gt(b.qty)) {
      errors[lineKey(i, "qty")] = `Melebihi saldo ${b.itemLabel} lot ${b.lotNo}: ${qtyText(b.qty)}.`;
      continue;
    }
    let location_id: number | null = null;
    if (purpose.needsWarehouse && warehouse) {
      const locId = Number(l.location_id) || null;
      if (warehouse.useLocation) {
        const loc = locId ? warehouse.locations.find((x) => x.id === locId) : undefined;
        if (!locId) {
          if (forPosting) {
            errors[lineKey(i, "location_id")] = `Pilih lokasi di ${warehouse.label}.`;
            continue;
          }
        } else if (!loc || (!loc.active && forPosting)) {
          errors[lineKey(i, "location_id")] = "Lokasi tidak ditemukan di gudang ini atau nonaktif.";
          continue;
        } else location_id = locId;
      }
    }
    used.add(b.id);
    out.push({ line_no: out.length + 1, bucket: b, qty, location_id });
  }
  if (!errors._lines && Object.keys(errors).some((k) => k.startsWith("lines."))) errors._lines = "Ada baris yang perlu diperbaiki.";
  if (Object.keys(errors).length || !station) return { ok: false, errors };
  return {
    ok: true,
    c: { purpose, data: { release_date: asDate(day), workstation_id: station.id, warehouse_id: warehouse?.id ?? null, reason, note: text(header.note) }, station, warehouse, lines: out },
  };
}

// ------------------------------------------------------------------ writes

async function nextReleaseNo(db: Db, purpose: ReleasePurposeDef, unit: string, date: Date): Promise<string> {
  // `PHP_<unit>_<DDMMYY>_<NNNNN>` / `PMS_…`, the unit's series (M124).
  return nextDailyNumber([purpose.prefix, unit], date, async (series) => {
    const row = await db.prdRelease.findFirst({ where: { release_no: { startsWith: series } }, orderBy: { id: "desc" }, select: { release_no: true } });
    return row?.release_no ?? null;
  });
}

async function audit(db: Db, id: number, action: "TAMBAH" | "UPDATE", event: string, by: number) {
  await db.auditLog.create({ data: { entity_key: "prd_release", row_id: id, action, event, by } });
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
    if (e instanceof ProductionRefusal || e instanceof InventoryRefusal) return { ok: false, errors: { _form: `Belum bisa diproses: ${e.message}` } };
    if (e instanceof PostingDryRun) return { ok: true, journal: e.lines } as T;
    throw e;
  }
}

const lineRow = (l: CheckedLine) => ({
  line_no: l.line_no,
  source_bucket_id: l.bucket.id,
  lot_id: l.bucket.lotId,
  item_id: l.bucket.itemId,
  lot_no: l.bucket.lotNo,
  qty: l.qty,
  location_id: l.location_id,
  partai_id: l.bucket.partaiId,
  job_id: l.bucket.jobId,
});

export async function createRelease(header: ReleaseHeaderInput, lines: ReleaseLineInput[], actorId: number): Promise<ReleaseResult> {
  return refusable(async () => {
    const made = await prisma.$transaction(async (tx) => {
      const r = await checkRelease(tx, header, lines, null);
      if (!r.ok) throw new Refused(r.errors);
      const row = await tx.prdRelease.create({
        data: {
          ...r.c.data,
          purpose: r.c.purpose.key,
          release_no: await nextReleaseNo(tx, r.c.purpose, r.c.station.label, r.c.data.release_date),
          created_by: actorId,
          lines: { create: r.c.lines.map(lineRow) },
        },
      });
      await audit(tx, row.id, "TAMBAH", "create", actorId);
      return row;
    });
    return { ok: true as const, id: made.id, releaseNo: made.release_no };
  });
}

export async function updateRelease(id: number, header: ReleaseHeaderInput, lines: ReleaseLineInput[], actorId: number): Promise<ReleaseResult> {
  const current = await prisma.prdRelease.findUnique({ where: { id }, select: { status: true, release_no: true, purpose: true, workstation_id: true, release_date: true } });
  if (!current) return { ok: false, errors: { _form: "Dokumen tidak ditemukan." } };
  if (!releaseIsEditable(current.status as ReleaseStatus)) return { ok: false, errors: { _form: "Dokumen yang sudah diposting atau dibatalkan tidak dapat diubah." } };
  return refusable(async () => {
    const no = await prisma.$transaction(async (tx) => {
      const r = await checkRelease(tx, { ...header, purpose: current.purpose as ReleasePurpose }, lines, id);
      if (!r.ok) throw new Refused(r.errors);
      // The number carries the unit and the day: a Draft that changes either takes the next of its new series.
      const renumber = r.c.data.workstation_id !== current.workstation_id || r.c.data.release_date.getTime() !== current.release_date.getTime();
      const release_no = renumber ? await nextReleaseNo(tx, r.c.purpose, r.c.station.label, r.c.data.release_date) : current.release_no;
      const done = await tx.prdRelease.updateMany({ where: { id, status: "Draft" }, data: { ...r.c.data, release_no, updated_by: actorId } });
      if (done.count !== 1) throw new Refused({ _form: "Dokumen berubah saat diproses. Muat ulang halaman." });
      await tx.prdReleaseLine.deleteMany({ where: { release_id: id } });
      await tx.prdReleaseLine.createMany({ data: r.c.lines.map((l) => ({ ...lineRow(l), release_id: id })) });
      await audit(tx, id, "UPDATE", "update", actorId);
      return release_no;
    });
    return { ok: true as const, id, releaseNo: no };
  });
}

const WITH_LINES = { lines: { orderBy: { line_no: "asc" as const } } };
type Stored = Prisma.PrdReleaseGetPayload<{ include: typeof WITH_LINES }>;

function asInput(r: Stored): { header: ReleaseHeaderInput; lines: ReleaseLineInput[] } {
  return {
    header: { purpose: r.purpose as ReleasePurpose, release_date: isoDay(r.release_date), workstation_id: r.workstation_id, warehouse_id: r.warehouse_id, reason: r.reason ?? "", note: r.note ?? "" },
    lines: r.lines.map((l) => ({ bucket_id: l.source_bucket_id, qty: l.qty.toString(), location_id: l.location_id })),
  };
}

// --------------------------------------------------------------- lifecycle

export type ReleaseTransitionResult =
  | { ok: true; /** Only on a dry run: the journal Posting would write. */ journal?: JournalLineInput[] }
  | { ok: false; errors: Record<string, string> };

/** The journal Posting would write now, for its dialog (P103): the posting itself as a dry run, rolled back. */
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

/**
 * Runs one lifecycle step. **Posting**, in one transaction: rechecks the stored
 * document, takes each line out of its bucket, brings a receipt's goods into stock
 * under the same lot, stores what each line released, writes the journal and closes
 * the Perintah of every Partai whose last goods have left. **Batalkan** (Draft only)
 * asks for a reason and writes nothing else. A dry run rolls everything back.
 */
export async function transitionRelease(id: number, action: ReleaseAction, actorId: number, reason?: string, options: { dryRun?: boolean } = {}): Promise<ReleaseTransitionResult> {
  const doc = await prisma.prdRelease.findUnique({ where: { id }, include: WITH_LINES });
  if (!doc) return { ok: false, errors: { _form: "Dokumen tidak ditemukan." } };
  const t = RELEASE_TRANSITIONS[action];
  if (!releaseTransitionAllowed(action, doc.status as ReleaseStatus)) return { ok: false, errors: { _form: `Dokumen berstatus ini tidak dapat di-${t.label.toLowerCase()}.` } };
  const moved = "Dokumen berubah saat diproses. Muat ulang halaman.";
  let why: string | null = null;
  if (t.reason) {
    why = String(reason ?? "").trim();
    if (!why) return { ok: false, errors: { reason: "Alasan wajib diisi." } };
  }
  if (action === "cancel") {
    await prisma.$transaction(async (tx) => {
      const done = await tx.prdRelease.updateMany({ where: { id, status: "Draft" }, data: { status: "Cancelled", cancel_reason: why, updated_by: actorId } });
      if (done.count !== 1) throw new Error(moved);
      await audit(tx, id, "UPDATE", "cancel", actorId);
    });
    return { ok: true };
  }

  const period = await checkTransactionDate(isoDay(doc.release_date));
  if (!period.ok) return { ok: false, errors: { _form: period.message } };
  const baseCurrency = await prisma.refCurrency.findFirst({ where: { currency_label: BASE_CURRENCY_LABEL }, select: { id: true } });
  if (!baseCurrency) return { ok: false, errors: { _form: "Mata uang dasar tidak ditemukan." } };

  return refusable(async () => {
    const input = asInput(doc);
    let journalOut: JournalLineInput[] = [];
    await prisma.$transaction(async (tx) => {
      const r = await checkRelease(tx, input.header, input.lines, id, true);
      if (!r.ok) {
        const first = Object.entries(r.errors).find(([k]) => k !== "_lines")?.[1] ?? r.errors._lines;
        throw new Refused({ _form: `Belum bisa diposting: ${first}` });
      }
      const c = r.c;
      const done = await tx.prdRelease.updateMany({ where: { id, status: "Draft" }, data: { status: "Posted", updated_by: actorId } });
      if (done.count !== 1) throw new Refused({ _form: moved });

      // Accounts: WIP is the item's Kategori Item's with no fallback (M62); the debit side is Persediaan (the category's, else Account Mapping's) or the scrap expense.
      const byItem = await accountsForItems([...new Set(c.lines.map((l) => l.bucket.itemId))], tx);
      const fallback = await fallbackAccounts(["inventory_account", "production_scrap_account"] as const);
      const wipOf = new Map<number, number>();
      const debitOf = new Map<number, number>();
      for (const l of c.lines) {
        const a = byItem.get(l.bucket.itemId);
        const debit = c.purpose.needsWarehouse ? (a?.inventory ?? fallback.inventory_account) : fallback.production_scrap_account;
        if (!a?.wip || !debit) {
          const missing = [!a?.wip && `Account WIP Kategori Item ${l.bucket.itemLabel}`, !debit && (c.purpose.needsWarehouse ? "Account Persediaan" : "Account Beban Pemusnahan Produksi (Account Mapping)")].filter(Boolean).join(" dan ");
          throw new Refused({ _form: `Lengkapi dulu: ${missing}.` });
        }
        wipOf.set(l.bucket.itemId, a.wip);
        debitOf.set(l.bucket.itemId, debit);
      }

      const source = { docTypeId: await docTypeId(tx, "prd_release"), docId: id, no: doc.release_no };
      const date = c.data.release_date;
      const dr = new Map<number, Dec>();
      const cr = new Map<number, Dec>();
      const add = (m: Map<number, Dec>, k: number, v: Dec) => m.set(k, (m.get(k) ?? new D(0)).add(v));
      let total = new D(0);
      const partaiIds = new Set<number>();
      for (const l of c.lines) {
        const taken = await takeFromBucket(tx, { bucketId: l.bucket.id, baseQty: l.qty.toString(), date, source, actorId });
        if (taken.partaiId != null) partaiIds.add(taken.partaiId);
        if (c.purpose.needsWarehouse) {
          await receiveStock(tx, {
            itemId: taken.itemId,
            warehouseId: c.data.warehouse_id!,
            locationId: l.location_id,
            lotNo: taken.lotNo,
            expiry: taken.expiry,
            baseQty: l.qty.toString(),
            value: taken.value,
            date,
            source,
            actorId,
          });
        }
        await tx.prdReleaseLine.update({ where: { release_id_line_no: { release_id: id, line_no: l.line_no } }, data: { cost_amount: taken.value } });
        total = total.add(taken.value);
        add(dr, debitOf.get(l.bucket.itemId)!, new D(taken.value));
        add(cr, wipOf.get(l.bucket.itemId)!, new D(taken.value));
      }

      const what = `${doc.release_no} · ${c.station.label}`;
      const lines: JournalLineInput[] = [];
      for (const [accountId, v] of dr) {
        if (!v.isZero()) lines.push({ accountId, currencyId: baseCurrency.id, rate: 1, debit: v.toNumber(), credit: 0, description: `${c.purpose.needsWarehouse ? `Masuk ${c.warehouse?.label ?? ""}` : "Pemusnahan"} ${what}` });
      }
      for (const [accountId, v] of cr) {
        if (!v.isZero()) lines.push({ accountId, currencyId: baseCurrency.id, rate: 1, debit: 0, credit: v.toNumber(), description: `WIP ${what}` });
      }
      // Goods carrying no value (a BJL, a Reject) move with no journal: nothing changes in the books.
      const journal = lines.length
        ? await postJournal(tx, { description: `${what} · ${c.purpose.name}`, sourceDocTypeId: source.docTypeId, sourceDocId: id, postingDate: date, actorId, lines })
        : null;
      await tx.prdRelease.update({ where: { id }, data: { journal_id: journal?.id ?? null, total_value: total } });

      // The last goods of a Partai have left: its Perintah is finished (P170).
      for (const partaiId of partaiIds) {
        if (await partaiInProduction(partaiId, tx)) continue;
        const orderId = await orderIdOfPartai(partaiId, tx);
        if (orderId) await finishProductionOrder(tx, orderId, actorId);
      }
      await audit(tx, id, "UPDATE", "post", actorId);
      journalOut = lines;
      if (options.dryRun) throw new PostingDryRun(lines);
    });
    return { ok: true as const, journal: journalOut };
  });
}

// ------------------------------------------------------------------- reads

export type ReleaseListRow = {
  id: number;
  releaseNo: string;
  releaseDate: string;
  status: ReleaseStatus;
  stationLabel: string;
  stationName: string;
  warehouseLabel: string | null;
  lines: number;
  totalValue: number;
};

export async function listReleases(purpose: ReleasePurpose): Promise<ReleaseListRow[]> {
  const rows = await prisma.prdRelease.findMany({
    where: { purpose },
    orderBy: [{ release_date: "desc" }, { id: "desc" }],
    include: { workstation: true, warehouse: true, _count: { select: { lines: true } } },
  });
  return rows.map((r) => ({
    id: r.id,
    releaseNo: r.release_no,
    releaseDate: isoDay(r.release_date),
    status: r.status as ReleaseStatus,
    stationLabel: r.workstation.workstation_label,
    stationName: r.workstation.workstation_name,
    warehouseLabel: r.warehouse?.warehouse_label ?? null,
    lines: r._count.lines,
    totalValue: r.total_value.toNumber(),
  }));
}

export type ReleaseView = {
  id: number;
  releaseNo: string;
  status: ReleaseStatus;
  header: ReleaseHeaderInput;
  lines: (ReleaseLineInput & { id: number; itemLabel: string; itemName: string; lotNo: string; jobNo: string | null; partaiNo: string | null; cost: number })[];
  cancelReason: string | null;
  journalId: number | null;
  journalNo: string | null;
  totalValue: number;
};

export async function getRelease(id: number): Promise<ReleaseView | null> {
  const r = await prisma.prdRelease.findUnique({ where: { id }, include: WITH_LINES });
  if (!r) return null;
  const input = asInput(r);
  const [ids, items, journalNos] = await Promise.all([
    productionIdentityNumbers({ partaiIds: r.lines.flatMap((l) => (l.partai_id ? [l.partai_id] : [])), jobIds: r.lines.flatMap((l) => (l.job_id ? [l.job_id] : [])) }),
    prisma.mItem.findMany({ where: { id: { in: r.lines.map((l) => l.item_id) } }, select: { id: true, item_label: true, item_name: true } }),
    r.journal_id ? journalNumbersByIds([r.journal_id]) : new Map<number, string>(),
  ]);
  const itemBy = new Map(items.map((i) => [i.id, i]));
  return {
    id: r.id,
    releaseNo: r.release_no,
    status: r.status as ReleaseStatus,
    header: input.header,
    lines: input.lines.map((l, i) => ({
      ...l,
      id: r.lines[i].id,
      itemLabel: itemBy.get(r.lines[i].item_id)?.item_label ?? "",
      itemName: itemBy.get(r.lines[i].item_id)?.item_name ?? "",
      lotNo: r.lines[i].lot_no,
      jobNo: r.lines[i].job_id ? (ids.jobs.get(r.lines[i].job_id!) ?? null) : null,
      partaiNo: r.lines[i].partai_id ? (ids.partai.get(r.lines[i].partai_id!) ?? null) : null,
      cost: r.lines[i].cost_amount.toNumber(),
    })),
    cancelReason: r.cancel_reason,
    journalId: r.journal_id,
    journalNo: r.journal_id ? (journalNos.get(r.journal_id) ?? null) : null,
    totalValue: r.total_value.toNumber(),
  };
}

/** What a stored document's form must keep readable, whatever its status now. */
export function releaseCurrent(v: ReleaseView): ReleaseCurrent {
  return { workstationId: Number(v.header.workstation_id), warehouseId: v.header.warehouse_id ? Number(v.header.warehouse_id) : null, bucketIds: v.lines.map((l) => Number(l.bucket_id)) };
}

/** Document numbers by id, for the audit panel. */
export async function releaseNumbersByIds(ids: number[]): Promise<Map<number, string>> {
  const rows = await prisma.prdRelease.findMany({ where: { id: { in: ids } }, select: { id: true, release_no: true } });
  return new Map(rows.map((r) => [r.id, r.release_no]));
}

/** The purpose of a stored document, so a link by id lands on the right menu. */
export async function releasePurposeOf(id: number): Promise<ReleasePurpose | null> {
  const r = await prisma.prdRelease.findUnique({ where: { id }, select: { purpose: true } });
  return r ? (r.purpose as ReleasePurpose) : null;
}

/** The buckets a stored document named, to show what is now left of them. */
export async function releaseSourceBuckets(v: ReleaseView): Promise<BucketView[]> {
  return bucketsByIds(v.lines.map((l) => Number(l.bucket_id)));
}

/** Documents of this kind that would still post into a period closing on `to` — a blocker of Penutupan Biaya Produksi (P172, Q74). */
export async function draftReleasesUpTo(to: Date, db: Db = prisma): Promise<number> {
  return db.prdRelease.count({ where: { status: "Draft", release_date: { lte: to } } });
}

/** The purpose of each release (`finished_receipt` / `scrap`) — the close follows value that left production by it (P172). */
export async function releasePurposesByIds(ids: number[], db: Db = prisma): Promise<Map<number, string>> {
  if (!ids.length) return new Map();
  const rows = await db.prdRelease.findMany({ where: { id: { in: ids } }, select: { id: true, purpose: true } });
  return new Map(rows.map((r) => [r.id, r.purpose]));
}
