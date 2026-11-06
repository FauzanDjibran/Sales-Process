import "server-only";

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { InventoryRefusal } from "./inventory";
import { PeriodLockRefusal } from "./period-lock";
import { PostingDryRun, describeJournalLines, type JournalLineInput, type JournalPreviewResult } from "./journal";
import { ProductionRefusal, availableBuckets, bucketsByIds, ratesOfBuckets, type BucketView } from "./production-ledger";
import { accountsForItems } from "./item-account";
import { fallbackAccounts } from "./system-settings";
import { dailySeries, nextDailyNumber } from "./document-number";
import { BASE_CURRENCY_LABEL } from "./currency";

/**
 * What the production documents share (R5, R7, R8): the units and the
 * buckets they pick from, the check of a line taken from a bucket, the WIP
 * account of an item (no fallback, R16) and the refusal plumbing of a
 * posting run as a dry run (P103). Each document keeps its own tables.
 */

export type Db = Prisma.TransactionClient | typeof prisma;

/** A bucket as a picker offers it (client-safe shape). */
export type BucketOption = Pick<BucketView, "id" | "lotId" | "lotNo" | "itemId" | "itemLabel" | "itemName" | "uomLabel" | "unitId" | "partaiId" | "partaiNo" | "jobId" | "jobNo" | "auxiliary" | "qcCheckId" | "grams" | "isBjl" | "qty" | "value" | "expiry"> & {
  /** Rp per gram it would be costed at. */
  rate?: number;
};

export type Place = { id: number; label: string; name: string; active: boolean };

export const DAY = /^\d{4}-\d{2}-\d{2}$/;
export const asDate = (d: string) => new Date(`${d}T00:00:00Z`);
export const isoDay = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "");
export const text = (v: string | null | undefined) => String(v ?? "").trim() || null;

/** Quantities on the documents are `Decimal(18, 4)`, compared in ten-thousandths. */
const SCALE = 10_000;
export const units = (n: number) => Math.round(n * SCALE);
export const fromUnits = (u: number) => u / SCALE;
export const parseQty = (v: unknown) => Number(String(v ?? "").replace(",", "."));
export const fourDecimals = (n: number) => Math.abs(n * SCALE - units(n)) <= 1e-6;

export async function docTypeId(db: Db, table: string): Promise<number> {
  const row = await db.sysDocType.findFirst({ where: { doc_table: table }, select: { id: true } });
  if (!row) throw new Error(`Jenis dokumen ${table} belum terdaftar. Jalankan db:seed.`);
  return row.id;
}

/** Active units, and the ones a stored document names whatever their status. */
export async function unitOptions(keep: number[] = [], db: Db = prisma): Promise<Place[]> {
  const rows = await db.refUnit.findMany({
    where: { OR: [{ status: "Active" }, ...(keep.length ? [{ id: { in: keep } }] : [])] },
    orderBy: { unit_label: "asc" },
  });
  return rows.map((w) => ({ id: w.id, label: w.unit_label, name: w.unit_name, active: w.status === "Active" }));
}

/** Every bucket holding goods (and any a stored document names), for the pickers. */
export async function bucketOptions(withIds: number[] = [], db: Db = prisma): Promise<BucketOption[]> {
  return (await availableBuckets({ withIds }, db)).map((b) => ({
    id: b.id,
    lotId: b.lotId,
    lotNo: b.lotNo,
    itemId: b.itemId,
    itemLabel: b.itemLabel,
    itemName: b.itemName,
    uomLabel: b.uomLabel,
    unitId: b.unitId,
    partaiId: b.partaiId,
    partaiNo: b.partaiNo,
    jobId: b.jobId,
    jobNo: b.jobNo,
    auxiliary: b.auxiliary,
    qcCheckId: b.qcCheckId,
    grams: b.grams,
    isBjl: b.isBjl,
    qty: b.qty,
    value: b.value,
    expiry: b.expiry,
  }));
}

async function optionsOf(buckets: BucketView[], db: Db): Promise<BucketOption[]> {
  const rates = await ratesOfBuckets(buckets, db);
  return buckets.map((b) => ({ ...b, rate: rates.get(b.id) ?? 0 }));
}

/** What the Units may work: goods in Persiapan, and any row a stored document names. */
export async function persiapanOptions(unitIds: number[], keep: number[] = [], db: Db = prisma): Promise<BucketOption[]> {
  const rows = await availableBuckets({ unitIds, stage: "Preparation", withIds: keep }, db);
  return optionsOf(rows.filter((b) => !b.auxiliary), db);
}

/** Bahan penolong the Units hold (V8). */
export async function auxOptions(unitIds: number[], keep: number[] = [], db: Db = prisma): Promise<BucketOption[]> {
  const rows = await availableBuckets({ unitIds, stage: "Preparation", withIds: keep }, db);
  return optionsOf(rows.filter((b) => b.auxiliary), db);
}

export type AuxInput = { bucket_id: number | null; qty: number | string; job_id?: number | null };

/** Bahan penolong used by an execution: a balance of its Unit, each once (V8, W75). Errors keyed `aux.<i>.<field>`. */
export async function checkAuxLines(raw: AuxInput[] | undefined, unitId: number | null, errors: Record<string, string>, db: Db = prisma) {
  const rows = Array.isArray(raw) ? raw : [];
  const buckets = await bucketsByIds(rows.flatMap((a) => (a.bucket_id ? [Number(a.bucket_id)] : [])), db);
  const out: { line_no: number; bucket_id: number; job_id: number | null; qty: number; bucket: BucketView }[] = [];
  const seen = new Set<number>();
  rows.forEach((a, i) => {
    const key = (f: string) => `aux.${i}.${f}`;
    const b = buckets.get(Number(a.bucket_id));
    if (!b || b.unitId !== unitId || !b.auxiliary) {
      errors[key("bucket_id")] = "Pilih bahan penolong dari saldo unit ini.";
      return;
    }
    if (seen.has(b.id)) {
      errors[key("bucket_id")] = `${b.itemLabel} dipilih lebih dari sekali.`;
      return;
    }
    seen.add(b.id);
    const qty = parseQty(a.qty);
    if (!(qty > 0)) errors[key("qty")] = "Isi jumlah lebih dari 0.";
    else if (!fourDecimals(qty)) errors[key("qty")] = "Paling banyak 4 angka desimal.";
    else if (units(qty) > units(b.qty)) errors[key("qty")] = `Melebihi saldo (${b.qty} ${b.uomLabel}).`;
    else out.push({ line_no: out.length + 1, bucket_id: b.id, job_id: Number(a.job_id) || null, qty: fromUnits(units(qty)), bucket: b });
  });
  return out;
}

export type BucketLineInput = { bucket_id: number | null; qty: number | string };
export type CheckedBucketLine = { line_no: number; bucket_id: number; tracking_id: number; item_id: number; qty: number; bucket: BucketOption };

/**
 * Lines taken from buckets: each a bucket held at `unitId`, once, at a
 * quantity above 0 with at most four decimals and no more than it holds. Errors
 * keyed `<prefix>.<i>.<field>`.
 */
export function checkBucketLines(
  raw: BucketLineInput[] | undefined,
  buckets: BucketOption[],
  unitId: number | null,
  prefix: string,
  errors: Record<string, string>
): CheckedBucketLine[] {
  const byId = new Map(buckets.map((b) => [b.id, b]));
  const seen = new Set<number>();
  const out: CheckedBucketLine[] = [];
  for (const [i, l] of (Array.isArray(raw) ? raw : []).entries()) {
    const key = (f: string) => `${prefix}.${i}.${f}`;
    const b = byId.get(Number(l.bucket_id));
    if (!b) {
      errors[key("bucket_id")] = "Pilih lot.";
      continue;
    }
    if (unitId && b.unitId !== unitId) {
      errors[key("bucket_id")] = `Lot ${b.lotNo} tidak berada di Unit ini.`;
      continue;
    }
    if (seen.has(b.id)) {
      errors[key("bucket_id")] = `Lot ${b.lotNo} dipilih lebih dari sekali.`;
      continue;
    }
    seen.add(b.id);
    const qty = parseQty(l.qty);
    if (!Number.isFinite(qty) || !(qty > 0)) {
      errors[key("qty")] = "Isi jumlah lebih dari 0.";
      continue;
    }
    if (!fourDecimals(qty)) {
      errors[key("qty")] = "Paling banyak 4 angka desimal.";
      continue;
    }
    if (units(qty) > units(b.qty)) {
      errors[key("qty")] = `Melebihi yang tersedia (${b.qty} ${b.uomLabel}).`;
      continue;
    }
    out.push({ line_no: out.length + 1, bucket_id: b.id, tracking_id: b.lotId, item_id: b.itemId, qty: fromUnits(units(qty)), bucket: b });
  }
  return out;
}

/**
 * The WIP account of each item, from its Kategori Item — no fallback (R16) —
 * with the other kinds the caller needs. A category without what is asked is
 * refused by name.
 */
export async function itemAccounts(
  itemIds: number[],
  need: ("wip" | "inventory")[],
  fallbackInventory: number | null,
  db: Db = prisma
): Promise<{ ok: true; accounts: Map<number, { wip: number; inventory: number | null }> } | { ok: false; message: string }> {
  const byItem = await accountsForItems([...new Set(itemIds)], db);
  const out = new Map<number, { wip: number; inventory: number | null }>();
  for (const id of new Set(itemIds)) {
    const c = byItem.get(id);
    const inventory = c?.inventory ?? fallbackInventory;
    const missing = [need.includes("wip") && !c?.wip && "WIP", need.includes("inventory") && !inventory && "Persediaan"].filter(Boolean);
    if (missing.length) {
      const item = await db.mItem.findUnique({ where: { id }, select: { item_label: true, category: { select: { category_label: true } } } });
      return { ok: false, message: `Lengkapi Account Kategori Item ${item?.category.category_label ?? ""} dulu: Account ${missing.join(" dan ")} untuk ${item?.item_label ?? "barang"}.` };
    }
    out.set(id, { wip: c!.wip!, inventory: inventory ?? null });
  }
  return { ok: true, accounts: out };
}

/** The next daily number of a unit's document series (W11): `<KIND>_<unit>_<ddmmyy>_<NNNNN>`. */
export const unitSeries = (kind: string, unitLabel: string, date: Date) => dailySeries(`${kind}_${unitLabel}`, date);
export { nextDailyNumber };

export type ValueMove = { accountId: number; amount: number };

/**
 * The journal of an execution, net per account, because WIP moves only where
 * the accounts differ (§7): `moves` are what each WIP account gained or lost,
 * the unit cost is credited to Biaya Produksi Dibebankan, and value with no
 * receiver is debited to Beban Pemusnahan Produksi (W32). Nothing to move is no
 * journal.
 */
export async function executionJournalLines(
  moves: ValueMove[],
  cost: number,
  scrap: number,
  description: string,
  db: Db = prisma
): Promise<JournalLineInput[]> {
  const net = new Map<number, number>();
  for (const m of moves) net.set(m.accountId, (net.get(m.accountId) ?? 0) + m.amount);
  const accounts = await fallbackAccounts(["production_absorbed_account", "production_scrap_account"] as const);
  const add = (key: "production_absorbed_account" | "production_scrap_account", name: string, amount: number) => {
    if (!amount) return;
    const id = accounts[key];
    if (!id) throw new Refused({ _form: `Lengkapi Account Mapping dulu: ${name}.` });
    net.set(id, (net.get(id) ?? 0) + amount);
  };
  add("production_absorbed_account", "Biaya Produksi Dibebankan", -cost);
  add("production_scrap_account", "Beban Pemusnahan Produksi", scrap);
  const lines = [...net].filter(([, amount]) => amount !== 0);
  if (!lines.length) return [];
  const currency = await db.refCurrency.findFirst({ where: { currency_label: BASE_CURRENCY_LABEL }, select: { id: true } });
  if (!currency) throw new Refused({ _form: "Mata uang dasar tidak ditemukan." });
  return lines.map(([accountId, amount]) => ({ accountId, currencyId: currency.id, rate: 1, debit: Math.max(amount, 0), credit: Math.max(-amount, 0), description }));
}

/** Rules failing inside a transaction roll it back and come out as errors. */
export class Refused extends Error {
  constructor(readonly errors: Record<string, string>) {
    super("refused");
  }
}

export type PostResult = { ok: true; journal?: JournalLineInput[] } | { ok: false; errors: Record<string, string> };

/** Runs a write; a refusal, a book's refusal or a dry run's end come back as a result. */
export async function refusable<T>(run: () => Promise<T>): Promise<T | { ok: false; errors: Record<string, string> }> {
  try {
    return await run();
  } catch (e) {
    if (e instanceof Refused) return { ok: false, errors: e.errors };
    if (e instanceof PeriodLockRefusal) return { ok: false, errors: { _form: e.message } };
    if (e instanceof InventoryRefusal || e instanceof ProductionRefusal) return { ok: false, errors: { _form: `Belum bisa diposting: ${e.message}` } };
    // A dry run reached the end of the posting: its journal, with every write rolled back (P103).
    if (e instanceof PostingDryRun) return { ok: true, journal: e.lines } as T;
    throw e;
  }
}

/** A posting's dry run as the confirmation reads it (P103). */
export async function journalPreview(run: () => Promise<{ ok: true; journal?: JournalLineInput[] } | { ok: false; errors: Record<string, string> }>): Promise<JournalPreviewResult> {
  const r = await run();
  if (!r.ok) return r;
  return { ok: true, lines: await describeJournalLines(r.journal ?? []) };
}

/** The first message of a failed recheck, as a posting refusal. */
export function firstError(errors: Record<string, string>): string {
  return Object.entries(errors).find(([k]) => !k.startsWith("_"))?.[1] ?? Object.values(errors)[0] ?? "Periksa kembali isian.";
}
