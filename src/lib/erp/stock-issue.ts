import "server-only";

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { nextDailyNumber } from "./production-number";
import { formatNumber } from "@/lib/format";
import { BASE_CURRENCY_LABEL } from "./currency";
import { checkTransactionDate } from "./fiscal";
import { PostingDryRun, describeJournalLines, journalNumbersByIds, postJournal, type JournalLineInput, type JournalPreviewResult } from "./journal";
import { InventoryRefusal, issueStock, locationLabelsByIds, lotKey, lotOptions, lotTrackedItems, receiveStock, type LotOption } from "./inventory";
import { ProductionRefusal, enterProduction, receiveTransit, returnTransit } from "./production-ledger";
import { lockProductionOrderForIssue, productionOrdersForIssue, type IssueSourceOrder } from "./production-order";
import { requirementKey } from "./production-order-shape";
import { fallbackAccounts } from "./system-settings";
import { accountsForItems } from "./item-account";
import { DEFAULT_STOCK_ISSUE_PURPOSE, stockIssuePurpose } from "./stock-issue-purposes";
import {
  STOCK_ISSUE_TRANSITIONS,
  stockIssueIsEditable,
  stockIssueTransitionAllowed,
  type StockIssueAction,
  type StockIssueStatus,
} from "./stock-issue-workflow";

/**
 * The Stock Issue module (P158; `production_project.md` §9.3, *Pengeluaran ke
 * Produksi*): its tables are `log_stock_issue`, `log_stock_issue_line` and
 * `log_stock_issue_lot`, and nothing else names them.
 *
 * **Standalone** (P106): goods leave a warehouse for a use inside the company,
 * and the purpose (`stock-issue-purposes.ts`) says where. The one purpose so
 * far is `production_issue`: material placed at a workstation.
 *
 * The user picks the warehouse, the workstation, the day and the items, each in
 * its base unit (as sales, P108), and — every item being a Barang with Kelola
 * Stok — the lots each leaves from, exactly as on a Delivery Note (U15, P136):
 * a Draft may be picked in part, Posting needs every line picked in full.
 *
 * **Posting**, in one transaction: each pick is issued through the stock books
 * (`issueStock`, at the moving average, short stock refused) and enters the
 * production ledger at the workstation under **the same lot** (one register,
 * M128) and the value the stock released (`enterProduction`, M22) — the stock pool locked
 * before the bucket (§16 X23). One journal, **Dr WIP / Cr Persediaan** per
 * line: WIP is the item's Kategori Item's, with no fallback (M62); Persediaan
 * the category's, else Account Mapping's, as the Delivery Note. Each pick stores
 * what it cost and the production bucket it entered.
 *
 * **It is the Logistik BSTB** (Walet step 3, M113, M124): numbered
 * `BSTB_LOG_<DDMMYY>_<NNNNN>`, it may be raised from an Open **Perintah
 * Produksi** (optional, O4 — packaging sent to Packing needs none): its lines
 * then start on what the Perintah's requirements still ask of the station it
 * is sent to (P165); the BSTB alone picks the lots. Posted, the goods are **in
 * transit**; the workstation **receives** them whole (*Terima*, into its own
 * buckets, no journal) or **rejects** them whole (*Tolak*: back to the same
 * warehouse, location and lot at the value each pick left at, Dr Persediaan /
 * Cr WIP). Each sending moves exactly its own quantity and value out of transit.
 */

type Db = Prisma.TransactionClient | typeof prisma;

// ------------------------------------------------------------------ input

export type StockIssueHeaderInput = {
  /** The purpose's key; `production_issue` when omitted. */
  purpose?: string;
  warehouse_id: number | null;
  workstation_id: number | null;
  issue_date: string;
  note: string;
  /** The Perintah Produksi it is raised from — optional (O4). */
  order_id?: number | null;
};

export type StockIssuePickInput = { lot_id: number | null; location_id?: number | null; qty: number | string };

export type StockIssueLineInput = {
  item_id: number | null;
  qty: number | string;
  note: string;
  picks?: StockIssuePickInput[];
};

export type StockIssueResult = { ok: true; id: number; issueNo: string } | { ok: false; errors: Record<string, string> };

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const asDate = (d: string) => new Date(`${d}T00:00:00Z`);
const isoDay = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "");
const lineKey = (i: number, field: string) => `lines.${i}.${field}`;
const text = (v: string | null | undefined) => String(v ?? "").trim() || null;

/** Quantities are `Decimal(18, 4)`, compared in ten-thousandths. */
const QTY_SCALE = 10_000;
const units = (n: number) => Math.round(n * QTY_SCALE);
const fromUnits = (u: number) => u / QTY_SCALE;
const qtyText = (n: number) => formatNumber(n, n % 1 ? 2 : 0);

async function docTypeId(db: Db, table: string): Promise<number> {
  const row = await db.sysDocType.findFirst({ where: { doc_table: table }, select: { id: true } });
  if (!row) throw new Error(`Jenis dokumen ${table} belum terdaftar. Jalankan db:seed.`);
  return row.id;
}

// ---------------------------------------------------------------- options

export type StockIssuePlace = { id: number; label: string; name: string; active: boolean };

export type StockIssueItem = { id: number; label: string; name: string; uomId: number; uomLabel: string; active: boolean };

export type StockIssueOptions = {
  warehouses: StockIssuePlace[];
  workstations: StockIssuePlace[];
  /** Barang with Kelola Stok — the only items that leave by lot (P120). */
  items: StockIssueItem[];
  /** The lots each item may be picked from, per warehouse id, then item id; earliest expiry first. */
  lots: Record<number, Record<number, LotOption[]>>;
  /** Open Perintah Produksi a BSTB may be raised from (and the stored one's own). */
  orders: IssueSourceOrder[];
  /** Per Perintah id, what its BSTBs already sent per `requirementKey` (item and workstation). */
  sent: Record<number, Record<string, number>>;
};

/**
 * What the form offers: active warehouses and workstations, every Barang with
 * Kelola Stok, and the lots with stock of each in each warehouse. `current` is
 * a stored issue: its own warehouse, workstation, items and lots stay readable
 * whatever their status now.
 */
export async function stockIssueOptions(
  current: { warehouseId: number; workstationId: number | null; itemIds: number[]; lotIds: number[]; orderId?: number | null } | null = null,
  db: Db = prisma
): Promise<StockIssueOptions> {
  const [warehouses, workstations, items, orders] = await Promise.all([
    db.refWarehouse.findMany({
      where: { OR: [{ status: "Active" }, ...(current ? [{ id: current.warehouseId }] : [])] },
      orderBy: { warehouse_label: "asc" },
      select: { id: true, warehouse_label: true, warehouse_name: true, status: true },
    }),
    db.refWorkstation.findMany({
      where: { OR: [{ status: "Active" }, ...(current?.workstationId ? [{ id: current.workstationId }] : [])] },
      orderBy: { workstation_label: "asc" },
      select: { id: true, workstation_label: true, workstation_name: true, status: true },
    }),
    db.mItem.findMany({
      where: { item_type: "Barang", track_stock: true, OR: [{ status: "Active" }, ...(current?.itemIds.length ? [{ id: { in: current.itemIds } }] : [])] },
      orderBy: { item_label: "asc" },
      select: { id: true, item_label: true, item_name: true, status: true, base_uom_id: true, base_uom: { select: { uom_label: true } } },
    }),
    productionOrdersForIssue(current?.orderId ? [current.orderId] : [], db),
  ]);
  const byWarehouse = await lotOptions(
    items.map((i) => i.id),
    warehouses.map((w) => w.id),
    db,
    current?.lotIds ?? []
  );
  const lots: StockIssueOptions["lots"] = {};
  for (const [w, byItem] of byWarehouse) lots[w] = Object.fromEntries(byItem.entries());
  const sent: StockIssueOptions["sent"] = {};
  for (const [orderId, byKey] of await sentForOrders(orders.map((o) => o.id), db)) sent[orderId] = Object.fromEntries(byKey);
  return {
    warehouses: warehouses.map((w) => ({ id: w.id, label: w.warehouse_label, name: w.warehouse_name, active: w.status === "Active" })),
    workstations: workstations.map((w) => ({ id: w.id, label: w.workstation_label, name: w.workstation_name, active: w.status === "Active" })),
    items: items.map((i) => ({ id: i.id, label: i.item_label, name: i.item_name, uomId: i.base_uom_id, uomLabel: i.base_uom.uom_label, active: i.status === "Active" })),
    lots,
    orders,
    sent,
  };
}

// ------------------------------------------------------------- validation

type CheckedPick = { pick_no: number; lot_id: number; location_id: number | null; lot_no: string; expiry_date: Date | null; qty: number };

type CheckedLine = {
  line_no: number;
  item_id: number;
  uom_id: number;
  uom_factor: number;
  qty: number;
  base_qty: number;
  note: string | null;
  picks: CheckedPick[];
};

type Checked = {
  data: {
    purpose: string;
    warehouse_id: number;
    workstation_id: number | null;
    issue_date: Date;
    note: string | null;
    source_doc_type_id: number | null;
    source_doc_id: number | null;
    source_no: string | null;
  };
  warehouseLabel: string;
  workstationLabel: string;
  itemLabels: Map<number, { label: string; uomLabel: string }>;
  lines: CheckedLine[];
};

/**
 * Every rule a Stock Issue must satisfy to be saved — and, run again inside the
 * posting transaction with `forPosting`, to be posted: every line then picked
 * in full, the warehouse, workstation and items still active.
 */
export async function checkStockIssue(
  db: Db,
  header: StockIssueHeaderInput,
  lines: StockIssueLineInput[],
  selfId: number | null,
  forPosting = false
): Promise<{ ok: true; c: Checked } | { ok: false; errors: Record<string, string> }> {
  const errors: Record<string, string> = {};
  const purpose = stockIssuePurpose(header.purpose ?? DEFAULT_STOCK_ISSUE_PURPOSE);
  if (!purpose) return { ok: false, errors: { purpose: "Tujuan Stock Issue tidak dikenal." } };

  const stored = selfId
    ? await db.logStockIssue.findUnique({
        where: { id: selfId },
        select: { warehouse_id: true, workstation_id: true, source_doc_id: true, lines: { select: { item_id: true, lots: { select: { lot_id: true } } } } },
      })
    : null;
  const options = await stockIssueOptions(
    stored
      ? {
          warehouseId: stored.warehouse_id,
          workstationId: stored.workstation_id,
          itemIds: stored.lines.map((l) => l.item_id),
          lotIds: stored.lines.flatMap((l) => l.lots.map((p) => p.lot_id)),
          orderId: stored.source_doc_id,
        }
      : null,
    db
  );

  // The Perintah it is raised from, if any (O4): Open, to save and to post.
  const orderId = Number(header.order_id) || null;
  const order = orderId ? options.orders.find((o) => o.id === orderId) : undefined;
  if (orderId && (!order || !order.open)) errors.order_id = "Perintah Produksi tidak ditemukan atau tidak Open.";

  const warehouseId = Number(header.warehouse_id) || null;
  const warehouse = warehouseId ? options.warehouses.find((w) => w.id === warehouseId) : undefined;
  if (!warehouseId) errors.warehouse_id = "Pilih gudang.";
  else if (!warehouse || (!warehouse.active && (forPosting || stored?.warehouse_id !== warehouseId))) errors.warehouse_id = "Gudang tidak ditemukan atau nonaktif.";

  const workstationId = Number(header.workstation_id) || null;
  const workstation = workstationId ? options.workstations.find((w) => w.id === workstationId) : undefined;
  if (purpose.needsWorkstation) {
    if (!workstationId) errors.workstation_id = "Pilih Workstation.";
    else if (!workstation || (!workstation.active && (forPosting || stored?.workstation_id !== workstationId))) {
      errors.workstation_id = "Workstation tidak ditemukan atau nonaktif.";
    }
  }

  const issueDate = String(header.issue_date ?? "").trim();
  if (!DAY.test(issueDate)) errors.issue_date = "Tanggal wajib diisi.";

  const raw = Array.isArray(lines) ? lines : [];
  const out: CheckedLine[] = [];
  if (!raw.length) errors._lines = "Tambahkan minimal satu barang.";
  const itemById = new Map(options.items.map((i) => [i.id, i]));
  const tracked = await lotTrackedItems([...itemById.keys()], db);
  const seen = new Set<number>();
  for (const [i, l] of raw.entries()) {
    const itemId = Number(l.item_id) || null;
    const item = itemId ? itemById.get(itemId) : undefined;
    if (!itemId) {
      errors[lineKey(i, "item_id")] = "Pilih barang.";
      continue;
    }
    if (!item || !tracked.has(item.id)) {
      errors[lineKey(i, "item_id")] = "Hanya Barang dengan Kelola Stok yang dapat dikeluarkan ke produksi.";
      continue;
    }
    if (!item.active && forPosting) {
      errors[lineKey(i, "item_id")] = `${item.label} nonaktif.`;
      continue;
    }
    if (seen.has(item.id)) {
      errors[lineKey(i, "item_id")] = `${item.label} dipilih lebih dari sekali.`;
      continue;
    }
    seen.add(item.id);
    const qty = Number(String(l.qty ?? "").replace(",", "."));
    if (!Number.isFinite(qty) || !(qty > 0)) {
      errors[lineKey(i, "qty")] = "Isi jumlah lebih dari 0.";
      continue;
    }
    if (Math.abs(qty * QTY_SCALE - units(qty)) > 1e-6) {
      errors[lineKey(i, "qty")] = "Paling banyak 4 angka desimal.";
      continue;
    }
    const lots = warehouse ? (options.lots[warehouse.id]?.[item.id] ?? []) : [];
    const picks = checkPicks(l.picks, item, lots, fromUnits(units(qty)), forPosting);
    if (!picks.ok) {
      errors[lineKey(i, "picks")] = picks.error;
      continue;
    }
    out.push({
      line_no: out.length + 1,
      item_id: item.id,
      uom_id: item.uomId,
      uom_factor: 1,
      qty: fromUnits(units(qty)),
      base_qty: fromUnits(units(qty)),
      note: text(l.note),
      picks: picks.picks,
    });
  }
  if (!errors._lines && Object.keys(errors).some((k) => k.startsWith("lines."))) errors._lines = "Ada baris yang perlu diperbaiki.";

  if (Object.keys(errors).length || !warehouse) return { ok: false, errors };
  return {
    ok: true,
    c: {
      data: {
        purpose: purpose.key,
        warehouse_id: warehouse.id,
        workstation_id: purpose.needsWorkstation ? workstationId : null,
        issue_date: asDate(issueDate),
        note: text(header.note),
        source_doc_type_id: order ? await docTypeId(db, "prd_order") : null,
        source_doc_id: order?.id ?? null,
        source_no: order?.orderNo ?? null,
      },
      warehouseLabel: warehouse.label,
      workstationLabel: workstation?.label ?? "",
      itemLabels: new Map(options.items.map((i) => [i.id, { label: i.label, uomLabel: i.uomLabel }])),
      lines: out,
    },
  };
}

/**
 * A line's picking, as the Delivery Note's (U15): lots of its item in the
 * issue's warehouse — a lot in a location being one pick — each once, each more
 * than 0, together never more than the line and, to be posted, exactly it.
 */
function checkPicks(
  raw: StockIssuePickInput[] | undefined,
  item: StockIssueItem,
  lots: LotOption[],
  lineQty: number,
  forPosting: boolean
): { ok: true; picks: CheckedPick[] } | { ok: false; error: string } {
  const list = Array.isArray(raw) ? raw : [];
  const byKey = new Map(lots.map((l) => [l.key, l]));
  const seen = new Set<string>();
  const picks: CheckedPick[] = [];
  let total = 0;
  for (const p of list) {
    const lot = byKey.get(lotKey(Number(p.lot_id), Number(p.location_id) || null));
    if (!lot) return { ok: false, error: `Lot tidak ada di gudang ini untuk ${item.label}. Pilih ulang lotnya.` };
    const where = lot.locationLabel ? ` di ${lot.locationLabel}` : "";
    if (seen.has(lot.key)) return { ok: false, error: `Lot ${lot.lotNo}${where} dipilih lebih dari sekali.` };
    seen.add(lot.key);
    const qty = Number(String(p.qty ?? "").replace(",", "."));
    if (!Number.isFinite(qty) || !(qty > 0)) return { ok: false, error: `Isi jumlah lot ${lot.lotNo} lebih dari 0.` };
    if (Math.abs(qty * QTY_SCALE - units(qty)) > 1e-6) return { ok: false, error: "Jumlah lot paling banyak 4 angka desimal." };
    total += units(qty);
    picks.push({
      pick_no: picks.length + 1,
      lot_id: lot.id,
      location_id: lot.locationId,
      lot_no: lot.lotNo,
      expiry_date: lot.expiry ? asDate(lot.expiry) : null,
      qty: fromUnits(units(qty)),
    });
  }
  if (total > units(lineQty)) {
    return { ok: false, error: `Lot yang dipilih (${qtyText(fromUnits(total))}) melebihi Qty baris (${qtyText(lineQty)} ${item.uomLabel}).` };
  }
  if (forPosting && total !== units(lineQty)) {
    return { ok: false, error: `${item.label}: lot baru ${qtyText(fromUnits(total))} dari ${qtyText(lineQty)} ${item.uomLabel}. Pilih lot sampai penuh.` };
  }
  return { ok: true, picks };
}

// ------------------------------------------------------------------ writes

async function nextIssueNo(db: Db, date: Date): Promise<string> {
  // The Logistik BSTB's number (M124); no -NP series: it carries no tax (P109).
  return nextDailyNumber(["BSTB", "LOG"], date, async (series) => {
    const row = await db.logStockIssue.findFirst({ where: { issue_no: { startsWith: series } }, orderBy: { id: "desc" }, select: { issue_no: true } });
    return row?.issue_no ?? null;
  });
}

async function audit(db: Db, id: number, action: "TAMBAH" | "UPDATE", event: string, by: number) {
  await db.auditLog.create({ data: { entity_key: "log_stock_issue", row_id: id, action, event, by } });
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
    if (e instanceof InventoryRefusal || e instanceof ProductionRefusal) return { ok: false, errors: { _form: `Belum bisa diproses: ${e.message}` } };
    // A dry run reached the end of the posting: its journal, with every write rolled back (P103).
    if (e instanceof PostingDryRun) return { ok: true, journal: e.lines } as T;
    throw e;
  }
}

export async function createStockIssue(header: StockIssueHeaderInput, lines: StockIssueLineInput[], actorId: number): Promise<StockIssueResult> {
  return refusable(async () => {
    const made = await prisma.$transaction(async (tx) => {
      const r = await checkStockIssue(tx, header, lines, null);
      if (!r.ok) throw new Refused(r.errors);
      const row = await tx.logStockIssue.create({
        data: {
          ...r.c.data,
          issue_no: await nextIssueNo(tx, r.c.data.issue_date),
          created_by: actorId,
          lines: { create: r.c.lines.map(({ picks, ...l }) => ({ ...l, lots: { create: picks } })) },
        },
      });
      await audit(tx, row.id, "TAMBAH", "create", actorId);
      return row;
    });
    return { ok: true as const, id: made.id, issueNo: made.issue_no };
  });
}

export async function updateStockIssue(id: number, header: StockIssueHeaderInput, lines: StockIssueLineInput[], actorId: number): Promise<StockIssueResult> {
  const current = await prisma.logStockIssue.findUnique({ where: { id }, select: { status: true, issue_no: true, purpose: true } });
  if (!current) return { ok: false, errors: { _form: "Stock Issue tidak ditemukan." } };
  if (!stockIssueIsEditable(current.status as StockIssueStatus)) {
    return { ok: false, errors: { _form: "Stock Issue yang sudah diposting atau dibatalkan tidak dapat diubah." } };
  }
  return refusable(async () => {
    await prisma.$transaction(async (tx) => {
      const r = await checkStockIssue(tx, { ...header, purpose: current.purpose }, lines, id);
      if (!r.ok) throw new Refused(r.errors);
      const done = await tx.logStockIssue.updateMany({ where: { id, status: "Draft" }, data: { ...r.c.data, updated_by: actorId } });
      if (done.count !== 1) throw new Refused({ _form: "Stock Issue berubah saat diproses. Muat ulang halaman." });
      // A Draft's lines and picks are rewritten whole: nothing names them yet.
      await tx.logStockIssueLot.deleteMany({ where: { line: { stock_issue_id: id } } });
      await tx.logStockIssueLine.deleteMany({ where: { stock_issue_id: id } });
      for (const { picks, ...l } of r.c.lines) {
        await tx.logStockIssueLine.create({ data: { ...l, stock_issue_id: id, lots: { create: picks } } });
      }
      await audit(tx, id, "UPDATE", "update", actorId);
    });
    return { ok: true as const, id, issueNo: current.issue_no };
  });
}

const WITH_PICKS = { lines: { include: { lots: { orderBy: { pick_no: "asc" as const } } }, orderBy: { line_no: "asc" as const } } };
type StoredIssue = Prisma.LogStockIssueGetPayload<{ include: typeof WITH_PICKS }>;

function asInput(n: StoredIssue): { header: StockIssueHeaderInput; lines: StockIssueLineInput[] } {
  return {
    header: {
      purpose: n.purpose,
      warehouse_id: n.warehouse_id,
      workstation_id: n.workstation_id,
      issue_date: isoDay(n.issue_date),
      note: n.note ?? "",
      order_id: n.source_doc_id,
    },
    lines: n.lines.map((l) => ({
      item_id: l.item_id,
      qty: l.qty.toNumber(),
      note: l.note ?? "",
      picks: l.lots.map((p) => ({ lot_id: p.lot_id, location_id: p.location_id, qty: p.qty.toNumber() })),
    })),
  };
}

// --------------------------------------------------------------- posting

/**
 * The journal Posting — or Tolak, on `date` — would write now, for its dialog
 * (P103): `transitionStockIssue` run as a dry run — the recheck, every stock
 * and production movement, the journal — then rolled back.
 */
export async function stockIssuePreview(id: number, actorId: number, action: "post" | "reject" = "post", date?: string): Promise<JournalPreviewResult> {
  try {
    // Tolak's reason is not known yet when its dialog opens; the dry run needs one.
    const r = await transitionStockIssue(id, action, actorId, action === "reject" ? "pratinjau" : undefined, { dryRun: true, date });
    if (!r.ok) return r;
    return { ok: true, lines: await describeJournalLines(r.journal ?? []) };
  } catch (e) {
    if (e instanceof Error) return { ok: false, errors: { _form: e.message } };
    throw e;
  }
}

export type StockIssueTransitionResult =
  | { ok: true; /** Only on a dry run: the journal Posting would write. */ journal?: JournalLineInput[] }
  | { ok: false; errors: Record<string, string> };

/**
 * The accounts each item's line posts to: WIP is the item's Kategori Item's,
 * with no fallback (M62); Persediaan the category's, else Account Mapping's
 * (P122). A missing one is named.
 */
async function lineAccountsFor(itemIds: number[]): Promise<{ ok: true; accounts: Map<number, { wip: number; inventory: number }> } | { ok: false; error: string }> {
  const fallback = await fallbackAccounts(["inventory_account"] as const);
  const byCategory = await accountsForItems([...new Set(itemIds)]);
  const accounts = new Map<number, { wip: number; inventory: number }>();
  for (const [itemId, c] of byCategory) {
    const inventory = c.inventory ?? fallback.inventory_account;
    if (!c.wip || !inventory) {
      const item = await prisma.mItem.findUnique({ where: { id: itemId }, select: { item_label: true, category: { select: { category_label: true } } } });
      const missing = [!c.wip && "WIP", !inventory && "Persediaan"].filter(Boolean).join(" dan ");
      return { ok: false, error: `Lengkapi Account Kategori Item ${item?.category.category_label ?? ""} dulu: Account ${missing} untuk ${item?.item_label ?? "barang"}.` };
    }
    accounts.set(itemId, { wip: c.wip, inventory });
  }
  return { ok: true, accounts };
}

/**
 * Runs one lifecycle step. Every step is conditional on the status just read.
 *
 * - **Posting**, in one transaction: locks its Perintah (if any) and checks it
 *   is still Open, rechecks the stored issue, then for every pick issues the
 *   stock and sends it into production **in transit** to the workstation,
 *   under the same lot and at the value released; stores the cost and the
 *   bucket; writes the journal Dr WIP / Cr Persediaan dated the issue.
 * - **Terima** (`date`): each pick's own quantity and value leave transit and
 *   enter the station's bucket. No journal.
 * - **Tolak** (`date`, reason): each pick's own quantity and value leave
 *   transit and come back to the warehouse, location and lot it left, at that
 *   value; the journal Dr Persediaan / Cr WIP dated the rejection.
 * - **Batalkan** (Draft only) asks for a reason and writes nothing else.
 *
 * A dry run (Posting, Tolak) rolls everything back and returns the journal.
 */
export async function transitionStockIssue(
  id: number,
  action: StockIssueAction,
  actorId: number,
  reason?: string,
  options: { dryRun?: boolean; date?: string } = {}
): Promise<StockIssueTransitionResult> {
  const issue = await prisma.logStockIssue.findUnique({ where: { id }, include: WITH_PICKS });
  if (!issue) return { ok: false, errors: { _form: "Stock Issue tidak ditemukan." } };
  const t = STOCK_ISSUE_TRANSITIONS[action];
  if (!stockIssueTransitionAllowed(action, issue.status as StockIssueStatus)) {
    return { ok: false, errors: { _form: `Stock Issue berstatus ini tidak dapat di-${t.label.toLowerCase()}.` } };
  }
  const moved = "Stock Issue berubah saat diproses. Muat ulang halaman.";
  let why: string | null = null;
  if (t.reason) {
    why = String(reason ?? "").trim();
    if (!why) return { ok: false, errors: { reason: "Alasan wajib diisi." } };
  }

  if (action === "cancel") {
    await prisma.$transaction(async (tx) => {
      const done = await tx.logStockIssue.updateMany({ where: { id, status: "Draft" }, data: { status: "Cancelled", cancel_reason: why, updated_by: actorId } });
      if (done.count !== 1) throw new Error(moved);
      await audit(tx, id, "UPDATE", "cancel", actorId);
    });
    return { ok: true };
  }

  if (action === "receive" || action === "reject") return settleTransit(issue, action, actorId, why, options);

  const period = await checkTransactionDate(isoDay(issue.issue_date));
  if (!period.ok) return { ok: false, errors: { _form: period.message } };
  const accounts = await lineAccountsFor(issue.lines.map((l) => l.item_id));
  if (!accounts.ok) return { ok: false, errors: { _form: accounts.error } };
  const baseCurrency = await prisma.refCurrency.findFirst({ where: { currency_label: BASE_CURRENCY_LABEL }, select: { id: true } });
  if (!baseCurrency) return { ok: false, errors: { _form: "Mata uang dasar tidak ditemukan." } };

  return refusable(async () => {
    await prisma.$transaction(async (tx) => {
      // The Perintah first (a Tutup on it waits), then the stock pools, then the buckets.
      if (issue.source_doc_id) {
        const order = await lockProductionOrderForIssue(tx, issue.source_doc_id);
        if (!order.ok) throw new Refused({ _form: `Belum bisa diposting: ${order.error}` });
      }
      const input = asInput(issue);
      const r = await checkStockIssue(tx, input.header, input.lines, id, true);
      if (!r.ok) {
        const first = Object.entries(r.errors).find(([k]) => k !== "_lines")?.[1] ?? r.errors._lines;
        throw new Refused({ _form: `Belum bisa diposting: ${first}` });
      }
      const done = await tx.logStockIssue.updateMany({ where: { id, status: "Draft" }, data: { status: "Posted", updated_by: actorId } });
      if (done.count !== 1) throw new Refused({ _form: moved });

      const typeId = await docTypeId(tx, "log_stock_issue");
      const source = { docTypeId: typeId, docId: id, no: issue.issue_no };
      const date = r.c.data.issue_date;
      const journalLines: JournalLineInput[] = [];
      let total = 0;
      for (const line of r.c.lines) {
        const stored = await tx.logStockIssueLine.findUniqueOrThrow({
          where: { stock_issue_id_line_no: { stock_issue_id: id, line_no: line.line_no } },
          select: { id: true },
        });
        let cost = 0;
        for (const p of line.picks) {
          const baseQty = fromUnits(units(p.qty * line.uom_factor));
          // Stock pool and bucket first, then the production bucket (§16 X23).
          const out = await issueStock(tx, {
            itemId: line.item_id,
            warehouseId: r.c.data.warehouse_id,
            locationId: p.location_id,
            lotId: p.lot_id,
            baseQty,
            date,
            source,
            actorId,
          });
          // The goods enter production under the same lot (M128), in transit to
          // the workstation until it receives them (M113); a stock lot belongs to
          // no Partai or Job until its Partai is started (O3).
          const entered = await enterProduction(tx, {
            itemId: line.item_id,
            lotId: p.lot_id,
            workstationId: r.c.data.workstation_id!,
            inTransit: true,
            baseQty,
            value: out.cost,
            date,
            source,
            actorId,
          });
          await tx.logStockIssueLot.update({
            where: { stock_issue_line_id_pick_no: { stock_issue_line_id: stored.id, pick_no: p.pick_no } },
            data: { base_qty: baseQty, unit_cost: out.unitCost, cost_amount: out.cost, prd_bucket_id: entered.bucketId },
          });
          cost += out.cost;
        }
        // A description of what it left at, never read back (P114).
        const unitCost = line.base_qty > 0 ? Math.round((cost / line.base_qty) * 1_000_000) / 1_000_000 : 0;
        await tx.logStockIssueLine.update({ where: { id: stored.id }, data: { base_qty: line.base_qty, unit_cost: unitCost, cost_amount: cost } });
        total += cost;
        if (cost > 0) {
          const what = `${r.c.itemLabels.get(line.item_id)?.label ?? ""} · ${qtyText(line.qty)} ${r.c.itemLabels.get(line.item_id)?.uomLabel ?? ""}`;
          const acc = accounts.accounts.get(line.item_id)!;
          journalLines.push(
            { accountId: acc.wip, currencyId: baseCurrency.id, rate: 1, debit: cost, credit: 0, description: `WIP ${r.c.workstationLabel} · ${what}` },
            { accountId: acc.inventory, currencyId: baseCurrency.id, rate: 1, debit: 0, credit: cost, description: `Keluar ${r.c.warehouseLabel} · ${what}` }
          );
        }
      }
      // Stock carried at no value moves with no journal: nothing changes in the books.
      const journal = !journalLines.length
        ? null
        : await postJournal(tx, {
            description: `${issue.issue_no} · Pengeluaran ke Produksi ${r.c.warehouseLabel} → ${r.c.workstationLabel}`,
            sourceDocTypeId: typeId,
            sourceDocId: id,
            postingDate: date,
            actorId,
            lines: journalLines,
          });
      await tx.logStockIssue.update({ where: { id }, data: { journal_id: journal?.id ?? null, cost_amount: total } });
      await audit(tx, id, "UPDATE", "post", actorId);
      if (options.dryRun) throw new PostingDryRun(journalLines);
    });
    return { ok: true as const };
  });
}

/** Terima or Tolak at the workstation (M113): the whole sending, pick by pick, at its own figures. */
async function settleTransit(
  issue: StoredIssue,
  action: "receive" | "reject",
  actorId: number,
  why: string | null,
  options: { dryRun?: boolean; date?: string }
): Promise<StockIssueTransitionResult> {
  const day = String(options.date ?? "").trim();
  if (!DAY.test(day)) return { ok: false, errors: { date: "Tanggal wajib diisi." } };
  if (day < isoDay(issue.issue_date)) return { ok: false, errors: { date: "Tidak boleh sebelum tanggal Stock Issue." } };
  const period = await checkTransactionDate(day);
  if (!period.ok) return { ok: false, errors: { date: period.message } };
  const rejecting = action === "reject";
  const accounts = rejecting ? await lineAccountsFor(issue.lines.map((l) => l.item_id)) : null;
  if (accounts && !accounts.ok) return { ok: false, errors: { _form: accounts.error } };
  const accountOf = accounts?.ok ? accounts.accounts : new Map<number, { wip: number; inventory: number }>();
  const baseCurrency = await prisma.refCurrency.findFirst({ where: { currency_label: BASE_CURRENCY_LABEL }, select: { id: true } });
  if (!baseCurrency) return { ok: false, errors: { _form: "Mata uang dasar tidak ditemukan." } };
  const [warehouse, workstation, itemRows] = await Promise.all([
    prisma.refWarehouse.findUniqueOrThrow({ where: { id: issue.warehouse_id }, select: { warehouse_label: true } }),
    issue.workstation_id ? prisma.refWorkstation.findUnique({ where: { id: issue.workstation_id }, select: { workstation_label: true } }) : null,
    prisma.mItem.findMany({ where: { id: { in: issue.lines.map((l) => l.item_id) } }, select: { id: true, item_label: true, base_uom: { select: { uom_label: true } } } }),
  ]);
  const itemBy = new Map(itemRows.map((i) => [i.id, i]));

  return refusable(async () => {
    await prisma.$transaction(async (tx) => {
      const date = asDate(day);
      const done = await tx.logStockIssue.updateMany({
        where: { id: issue.id, status: "Posted" },
        data: {
          status: rejecting ? "Rejected" : "Received",
          received_date: date,
          received_by: actorId,
          ...(rejecting ? { reject_reason: why } : {}),
          updated_by: actorId,
        },
      });
      if (done.count !== 1) throw new Refused({ _form: "Stock Issue berubah saat diproses. Muat ulang halaman." });
      const typeId = await docTypeId(tx, "log_stock_issue");
      const source = { docTypeId: typeId, docId: issue.id, no: issue.issue_no };
      const journalLines: JournalLineInput[] = [];
      for (const line of issue.lines) {
        let cost = 0;
        for (const p of line.lots) {
          if (p.prd_bucket_id == null) throw new Refused({ _form: "Stock Issue ini tidak mencatat saldo dalam perjalanannya." });
          const move = { bucketId: p.prd_bucket_id, baseQty: p.base_qty, value: p.cost_amount, date, source, actorId };
          if (!rejecting) {
            const into = await receiveTransit(tx, move);
            await tx.logStockIssueLot.update({ where: { id: p.id }, data: { received_bucket_id: into.bucketId } });
            continue;
          }
          // Out of transit, then back into the very lot and place it left (P114:
          // a return comes back at the value it left at).
          await returnTransit(tx, move);
          await receiveStock(tx, {
            itemId: line.item_id,
            warehouseId: issue.warehouse_id,
            locationId: p.location_id,
            lotNo: p.lot_no,
            expiry: p.expiry_date,
            baseQty: p.base_qty,
            value: p.cost_amount,
            date,
            source,
            actorId,
          });
          cost += p.cost_amount.toNumber();
        }
        if (rejecting && cost > 0) {
          const item = itemBy.get(line.item_id);
          const what = `${item?.item_label ?? ""} · ${qtyText(line.qty.toNumber())} ${item?.base_uom.uom_label ?? ""}`;
          const acc = accountOf.get(line.item_id)!;
          journalLines.push(
            { accountId: acc.inventory, currencyId: baseCurrency.id, rate: 1, debit: cost, credit: 0, description: `Kembali ${warehouse.warehouse_label} · ${what}` },
            { accountId: acc.wip, currencyId: baseCurrency.id, rate: 1, debit: 0, credit: cost, description: `Ditolak ${workstation?.workstation_label ?? ""} · ${what}` }
          );
        }
      }
      if (rejecting) {
        const journal = !journalLines.length
          ? null
          : await postJournal(tx, {
              description: `${issue.issue_no} · Ditolak di ${workstation?.workstation_label ?? ""} → kembali ke ${warehouse.warehouse_label}`,
              sourceDocTypeId: typeId,
              sourceDocId: issue.id,
              postingDate: date,
              actorId,
              lines: journalLines,
            });
        await tx.logStockIssue.update({ where: { id: issue.id }, data: { return_journal_id: journal?.id ?? null } });
      }
      await audit(tx, issue.id, "UPDATE", action, actorId);
      if (options.dryRun) throw new PostingDryRun(journalLines);
    });
    return { ok: true as const };
  });
}

// ------------------------------------------------------------------- reads

export type StockIssueListRow = {
  id: number;
  issueNo: string;
  issueDate: string;
  status: StockIssueStatus;
  purpose: string;
  warehouseLabel: string;
  warehouseName: string;
  workstationLabel: string;
  workstationName: string;
  /** The Perintah Produksi it was raised from, if any. */
  orderNo: string | null;
  receivedDate: string | null;
  lines: number;
  cost: number;
};

export async function listStockIssues(): Promise<StockIssueListRow[]> {
  const rows = await prisma.logStockIssue.findMany({
    orderBy: [{ issue_date: "desc" }, { id: "desc" }],
    include: { warehouse: true, workstation: true, _count: { select: { lines: true } } },
  });
  return rows.map((r) => ({
    id: r.id,
    issueNo: r.issue_no,
    issueDate: isoDay(r.issue_date),
    status: r.status as StockIssueStatus,
    purpose: r.purpose,
    warehouseLabel: r.warehouse.warehouse_label,
    warehouseName: r.warehouse.warehouse_name,
    workstationLabel: r.workstation?.workstation_label ?? "",
    workstationName: r.workstation?.workstation_name ?? "",
    orderNo: r.source_no,
    receivedDate: r.received_date ? isoDay(r.received_date) : null,
    lines: r._count.lines,
    cost: r.cost_amount.toNumber(),
  }));
}

export type StockIssueView = {
  id: number;
  issueNo: string;
  status: StockIssueStatus;
  header: StockIssueHeaderInput;
  lines: (StockIssueLineInput & {
    id: number;
    baseQty: number;
    unitCost: number;
    cost: number;
    /** The lots picked, as stored (snapshotted lot no and expiry). */
    pickedLots: { lotId: number; locationId: number | null; locationLabel: string | null; lotNo: string; expiry: string | null; qty: number; cost: number }[];
  })[];
  cost: number;
  journalId: number | null;
  journalNo: string | null;
  cancelReason: string | null;
  /** The Perintah Produksi it was raised from, if any. */
  orderNo: string | null;
  /** Terima or Tolak: the day. */
  receivedDate: string | null;
  rejectReason: string | null;
  returnJournalId: number | null;
  returnJournalNo: string | null;
};

export async function getStockIssue(id: number): Promise<StockIssueView | null> {
  const n = await prisma.logStockIssue.findUnique({ where: { id }, include: WITH_PICKS });
  if (!n) return null;
  const input = asInput(n);
  const journalIds = [n.journal_id, n.return_journal_id].filter((x): x is number => x != null);
  const journalNos = journalIds.length ? await journalNumbersByIds(journalIds) : new Map<number, string>();
  const journalNo = n.journal_id ? (journalNos.get(n.journal_id) ?? null) : null;
  const locations = await locationLabelsByIds(n.lines.flatMap((l) => l.lots.flatMap((p) => (p.location_id ? [p.location_id] : []))));
  return {
    id: n.id,
    issueNo: n.issue_no,
    status: n.status as StockIssueStatus,
    header: input.header,
    lines: input.lines.map((l, i) => ({
      ...l,
      id: n.lines[i].id,
      baseQty: n.lines[i].base_qty.toNumber(),
      unitCost: n.lines[i].unit_cost.toNumber(),
      cost: n.lines[i].cost_amount.toNumber(),
      pickedLots: n.lines[i].lots.map((p) => ({
        lotId: p.lot_id,
        locationId: p.location_id,
        locationLabel: p.location_id ? (locations.get(p.location_id) ?? null) : null,
        lotNo: p.lot_no,
        expiry: p.expiry_date ? isoDay(p.expiry_date) : null,
        qty: p.qty.toNumber(),
        cost: p.cost_amount.toNumber(),
      })),
    })),
    cost: n.cost_amount.toNumber(),
    journalId: n.journal_id,
    journalNo,
    cancelReason: n.cancel_reason,
    orderNo: n.source_no,
    receivedDate: n.received_date ? isoDay(n.received_date) : null,
    rejectReason: n.reject_reason,
    returnJournalId: n.return_journal_id,
    returnJournalNo: n.return_journal_id ? (journalNos.get(n.return_journal_id) ?? null) : null,
  };
}

/** What a stored issue's form must keep readable, whatever its status now. */
export function stockIssueCurrent(v: StockIssueView) {
  return {
    warehouseId: Number(v.header.warehouse_id),
    workstationId: v.header.workstation_id ? Number(v.header.workstation_id) : null,
    itemIds: v.lines.map((l) => Number(l.item_id)),
    lotIds: v.lines.flatMap((l) => l.pickedLots.map((p) => p.lotId)),
    orderId: v.header.order_id ?? null,
  };
}

/** Stock Issue numbers by id, for the audit panel. */
export async function stockIssueNumbersByIds(ids: number[]): Promise<Map<number, string>> {
  const rows = await prisma.logStockIssue.findMany({ where: { id: { in: ids } }, select: { id: true, issue_no: true } });
  return new Map(rows.map((r) => [r.id, r.issue_no]));
}

/**
 * For the Gudang master (Gunakan Lokasi): how many Draft Stock Issues take goods
 * out of the warehouse, and which of the locations a pick of any issue names.
 */
export async function stockIssueLocationUse(warehouseId: number, locationIds: number[]): Promise<{ drafts: number; named: Set<number> }> {
  const [drafts, named] = await Promise.all([
    prisma.logStockIssue.count({ where: { warehouse_id: warehouseId, status: "Draft" } }),
    locationIds.length
      ? prisma.logStockIssueLot.findMany({ where: { location_id: { in: locationIds } }, distinct: ["location_id"], select: { location_id: true } })
      : [],
  ]);
  return { drafts, named: new Set(named.flatMap((r) => (r.location_id ? [r.location_id] : []))) };
}

// ------------------------------------------------ for the Perintah Produksi

export type IssueOfOrder = { id: number; issueNo: string; issueDate: string; status: StockIssueStatus; workstationLabel: string; cost: number };

/**
 * What the BSTBs raised from these Perintah sent, per `requirementKey` (item
 * and workstation): goods that left stock and were not sent back — Dikirim or
 * Diterima.
 */
async function sentForOrders(orderIds: number[], db: Db = prisma): Promise<Map<number, Map<string, number>>> {
  const out = new Map<number, Map<string, number>>();
  if (!orderIds.length) return out;
  const typeId = await docTypeId(db, "prd_order");
  const lines = await db.logStockIssueLine.findMany({
    where: { stock_issue: { source_doc_type_id: typeId, source_doc_id: { in: orderIds }, status: { in: ["Posted", "Received"] } } },
    select: { item_id: true, base_qty: true, stock_issue: { select: { source_doc_id: true, workstation_id: true } } },
  });
  for (const l of lines) {
    const orderId = l.stock_issue.source_doc_id!;
    const byKey = out.get(orderId) ?? new Map<string, number>();
    const key = requirementKey(l.item_id, l.stock_issue.workstation_id);
    byKey.set(key, fromUnits(units(byKey.get(key) ?? 0) + units(l.base_qty.toNumber())));
    out.set(orderId, byKey);
  }
  return out;
}

/**
 * The BSTBs raised from one Perintah, and what they sent per item and station
 * — composed by the Perintah's page (§3.1: the BSTB depends on the Perintah,
 * never the reverse).
 */
export async function stockIssuesOfOrder(orderId: number): Promise<{ issues: IssueOfOrder[]; sent: Map<string, number> }> {
  const typeId = await docTypeId(prisma, "prd_order");
  const [rows, sent] = await Promise.all([
    prisma.logStockIssue.findMany({
      where: { source_doc_type_id: typeId, source_doc_id: orderId },
      orderBy: [{ issue_date: "asc" }, { id: "asc" }],
      include: { workstation: { select: { workstation_label: true } } },
    }),
    sentForOrders([orderId]),
  ]);
  return {
    issues: rows.map((r) => ({
      id: r.id,
      issueNo: r.issue_no,
      issueDate: isoDay(r.issue_date),
      status: r.status as StockIssueStatus,
      workstationLabel: r.workstation?.workstation_label ?? "",
      cost: r.cost_amount.toNumber(),
    })),
    sent: sent.get(orderId) ?? new Map(),
  };
}

/** Why a Perintah may not be closed yet: a BSTB from it is still a Draft or in transit. Null when it may. */
export async function openIssuesRefusal(orderId: number, db: Db = prisma): Promise<string | null> {
  const typeId = await docTypeId(db, "prd_order");
  const live = await db.logStockIssue.findMany({
    where: { source_doc_type_id: typeId, source_doc_id: orderId, status: { in: ["Draft", "Posted"] } },
    select: { issue_no: true, status: true },
  });
  if (!live.length) return null;
  const names = live.map((i) => `${i.issue_no} (${i.status === "Draft" ? "Draft" : "belum diterima"})`).join(", ");
  return `Perintah belum bisa ditutup: masih ada BSTB ${names}. Posting, terima, tolak atau batalkan dulu.`;
}

/** Documents of this kind that would still post into a period closing on `to` — a blocker of Penutupan Biaya Produksi (P172, Q74). */
export async function unsettledStockIssuesUpTo(to: Date, db: Db = prisma): Promise<number> {
  return db.logStockIssue.count({ where: { status: { in: ["Draft", "Posted"] }, issue_date: { lte: to } } });
}
