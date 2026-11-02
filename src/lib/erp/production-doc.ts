import "server-only";

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { InventoryRefusal } from "./inventory";
import { PeriodLockRefusal } from "./period-lock";
import { PostingDryRun, type JournalLineInput } from "./journal";
import { ProductionRefusal, availableBuckets, type BucketView } from "./production-ledger";
import { accountsForItems } from "./item-account";

/**
 * What the production documents share (R5, R7, R8): the workstations and the
 * buckets they pick from, the check of a line taken from a bucket, the WIP
 * account of an item (no fallback, R16) and the refusal plumbing of a
 * posting run as a dry run (P103). Each document keeps its own tables.
 */

export type Db = Prisma.TransactionClient | typeof prisma;

/** A bucket as a picker offers it (client-safe shape). */
export type BucketOption = Pick<BucketView, "id" | "lotId" | "lotNo" | "itemId" | "itemLabel" | "itemName" | "uomLabel" | "workstationId" | "qty" | "value" | "expiry">;

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

/** Active workstations, and the ones a stored document names whatever their status. */
export async function workstationOptions(keep: number[] = [], db: Db = prisma): Promise<Place[]> {
  const rows = await db.refWorkstation.findMany({
    where: { OR: [{ status: "Active" }, ...(keep.length ? [{ id: { in: keep } }] : [])] },
    orderBy: { workstation_label: "asc" },
  });
  return rows.map((w) => ({ id: w.id, label: w.workstation_label, name: w.workstation_name, active: w.status === "Active" }));
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
    workstationId: b.workstationId,
    qty: b.qty,
    value: b.value,
    expiry: b.expiry,
  }));
}

export type BucketLineInput = { bucket_id: number | null; qty: number | string };
export type CheckedBucketLine = { line_no: number; bucket_id: number; tracking_id: number; item_id: number; qty: number; bucket: BucketOption };

/**
 * Lines taken from buckets: each a bucket held at `workstationId`, once, at a
 * quantity above 0 with at most four decimals and no more than it holds. Errors
 * keyed `<prefix>.<i>.<field>`.
 */
export function checkBucketLines(
  raw: BucketLineInput[] | undefined,
  buckets: BucketOption[],
  workstationId: number | null,
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
    if (workstationId && b.workstationId !== workstationId) {
      errors[key("bucket_id")] = `Lot ${b.lotNo} tidak berada di Workstation ini.`;
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

/** The first message of a failed recheck, as a posting refusal. */
export function firstError(errors: Record<string, string>): string {
  return Object.entries(errors).find(([k]) => !k.startsWith("_"))?.[1] ?? Object.values(errors)[0] ?? "Periksa kembali isian.";
}
