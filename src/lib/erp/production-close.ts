import "server-only";

import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import { formatDate } from "@/lib/format";
import { BASE_CURRENCY_LABEL } from "./currency";
import { draftDeliveryNotesUpTo } from "./delivery-note";
import { InventoryRefusal, poolFlows, revaluePool, type PoolFlow } from "./inventory";
import { accountsForItems } from "./item-account";
import { PostingDryRun, postJournal, type JournalLineInput } from "./journal";
import { accountNetMovements } from "./ledger";
import { lockCostedPeriod, PeriodLockRefusal } from "./period-lock";
import { settleClose, type CloseDestKind, type CloseOutput, type LotFate } from "./production-close-shape";
import { costPoolAccountIds } from "./production-cost";
import { draftCostBillsUpTo } from "./production-cost-bill";
import { ProductionRefusal, lotFates, revalueBucket } from "./production-ledger";
import { draftReleasesUpTo, releasePurposesByIds } from "./production-release";
import { draftExecutionsUpTo, postedRunsInRange, type PostedRun } from "./production-run";
import { draftTransfersUpTo } from "./production-transfer";
import { draftReceiptNotesUpTo } from "./receipt-note";
import { draftStockIssuesUpTo } from "./stock-issue";
import { fallbackAccounts } from "./system-settings";

/**
 * Penutupan Biaya Produksi — the month-end costing (R10–R15, R25, R28; P210).
 * Its tables are `prd_cost_close` and its four detail tables, and nothing else
 * names them.
 *
 * One fiscal period at a time, oldest first, after its last day. The **pool**
 * is the period's net debit on the accounts the Jenis Biaya book to (R10); it
 * is shared over the period's posted executions by Driver (R11), each share
 * goes to the execution's outputs by qty × Bobot Nilai and is followed forward
 * by quantity to where the goods are now — WIP, stock (split sold → HPP and
 * kept by goods available), scrap (R12); no execution sends it all to HPP
 * (R14). One journal dated the period's last day: Dr WIP / Persediaan / HPP /
 * Beban Pemusnahan, Cr Biaya Produksi Dibebankan (R13); value-only rows carry
 * it in the production ledger and the stock valuation book. It stores what it
 * closed (R25), is irreversible and locks the period (R15).
 *
 * The arithmetic is `settleClose` (pure); `costingFigures` runs it for any
 * range, so Costing Sementara (R26) reads the same figures.
 */

type Db = Prisma.TransactionClient | typeof prisma;
const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const day = (s: string) => new Date(`${s}T00:00:00Z`);

async function docTypeId(db: Db): Promise<number> {
  const row = await db.sysDocType.findFirst({ where: { doc_table: "prd_cost_close" }, select: { id: true } });
  if (!row) throw new Error("Jenis dokumen prd_cost_close belum terdaftar. Jalankan db:seed.");
  return row.id;
}

// ---------------------------------------------------------------- computing

export type CostingDest = { kind: CloseDestKind; itemId: number | null; itemLabel: string | null; bucketId: number | null; accountId: number | null; amount: number };
export type CostingItem = { itemId: number; itemLabel: string; itemName: string; uom: string; flow: PoolFlow; received: number; hpp: number; stock: number };

export type CostingFigures = {
  from: string;
  to: string;
  pool: number;
  pools: { accountId: number; amount: number }[];
  runs: PostedRun[];
  out: CloseOutput;
  dests: CostingDest[];
  items: CostingItem[];
  /** Accounts the journal needs that are not set. */
  missing: string[];
  lines: JournalLineInput[];
  absorbedAccountId: number | null;
};

/** The close's figures for a range, as the books stand now (R12), without writing anything. */
export async function costingFigures(from: Date, to: Date, label: string, db: Db = prisma): Promise<CostingFigures> {
  const poolAccounts = await costPoolAccountIds(db);
  const [nets, runs] = await Promise.all([accountNetMovements(poolAccounts, from, to, db), postedRunsInRange(from, to, db)]);
  const pools = [...nets.entries()].filter(([, a]) => a !== 0).map(([accountId, amount]) => ({ accountId, amount }));
  const pool = Math.round(pools.reduce((a, p) => a + p.amount, 0));

  // What became of every lot the executions made, and of the lots made from those.
  const fates = new Map<number, LotFate>();
  let frontier = [...new Set(runs.flatMap((r) => r.outputs.map((o) => o.lotId)))];
  while (frontier.length) {
    const got = await lotFates(frontier, db);
    const next = new Set<number>();
    for (const [id, f] of got) {
      fates.set(id, f);
      for (const l of f.links) if (!fates.has(l.toLotId)) next.add(l.toLotId);
    }
    frontier = [...next];
  }
  const empty: LotFate = { held: [], links: [], released: [] };
  const releaseIds = [...new Set([...fates.values()].flatMap((f) => f.released.map((r) => r.docId)))];
  const purposes = await releasePurposesByIds(releaseIds, db);
  const stockItems = [...new Set([...fates.values()].flatMap((f) => f.released.filter((r) => purposes.get(r.docId) !== "scrap").map((r) => r.itemId)))];
  const flows = await poolFlows(stockItems, from, to, db);

  const out = settleClose({
    pool: pool > 0 ? pool : 0,
    runs,
    fate: (id) => fates.get(id) ?? empty,
    releasePurpose: (id) => purposes.get(id) ?? "to_stock",
    flows: (id) => flows.get(id) ?? { opening: 0, inflow: 0, outflow: 0, poolQty: 0 },
  });

  const itemIds = [...new Set([...out.dests.flatMap((d) => (d.itemId != null ? [d.itemId] : [])), ...out.items.map((i) => i.itemId)])];
  const [byItem, fb, itemRows] = await Promise.all([
    accountsForItems(itemIds, db),
    fallbackAccounts(["inventory_account", "cogs_account", "production_scrap_account", "production_absorbed_account"] as const),
    itemIds.length ? db.mItem.findMany({ where: { id: { in: itemIds } }, select: { id: true, item_label: true, item_name: true, base_uom: { select: { uom_label: true } } } }) : [],
  ]);
  const itemBy = new Map(itemRows.map((i) => [i.id, i]));
  const accountOf = (kind: CloseDestKind, itemId: number | null): number | null => {
    const a = itemId != null ? byItem.get(itemId) : undefined;
    if (kind === "Wip") return a?.wip ?? null;
    if (kind === "Stock") return a?.inventory ?? fb.inventory_account;
    if (kind === "Scrap") return fb.production_scrap_account;
    return a?.cogs ?? fb.cogs_account;
  };
  const dests: CostingDest[] = out.dests.map((d) => ({ ...d, itemLabel: d.itemId != null ? (itemBy.get(d.itemId)?.item_label ?? null) : null, accountId: accountOf(d.kind, d.itemId) }));

  const missing = new Set<string>();
  for (const d of dests) {
    if (d.accountId != null) continue;
    missing.add(d.kind === "Wip" ? `Account WIP Kategori Item barang ${d.itemLabel ?? ""}` : d.kind === "Stock" ? "Account Persediaan" : d.kind === "Scrap" ? "Account Beban Pemusnahan Produksi (Account Mapping)" : "Account HPP");
  }
  if (out.dests.length && !fb.production_absorbed_account) missing.add("Account Biaya Produksi Dibebankan (Account Mapping)");

  // The journal: Dr each destination's account / Cr Biaya Produksi Dibebankan (R13).
  const currency = await db.refCurrency.findFirst({ where: { currency_label: BASE_CURRENCY_LABEL }, select: { id: true } });
  const lines: JournalLineInput[] = [];
  if (currency && !missing.size && out.dests.length) {
    const net = new Map<number, number>();
    for (const d of dests) net.set(d.accountId!, (net.get(d.accountId!) ?? 0) + d.amount);
    const mk = (accountId: number, amount: number, description: string): JournalLineInput => ({ accountId, currencyId: currency.id, rate: 1, debit: amount > 0 ? amount : 0, credit: amount < 0 ? -amount : 0, description });
    for (const [accountId, amount] of net) if (amount !== 0) lines.push(mk(accountId, amount, `${label} · biaya produksi dibebankan`));
    lines.push(mk(fb.production_absorbed_account!, -out.dests.reduce((a, d) => a + d.amount, 0), label));
  }

  return {
    from: isoDay(from),
    to: isoDay(to),
    pool,
    pools,
    runs,
    out,
    dests,
    items: out.items.map((i) => {
      const it = itemBy.get(i.itemId);
      return { itemId: i.itemId, itemLabel: it?.item_label ?? `#${i.itemId}`, itemName: it?.item_name ?? "", uom: it?.base_uom.uom_label ?? "", flow: flows.get(i.itemId)!, received: i.received, hpp: i.hpp, stock: i.stock };
    }),
    missing: [...missing],
    lines,
    absorbedAccountId: fb.production_absorbed_account,
  };
}

/** What stops a period's close (R15, R28): the order of periods, its end, Drafts, a negative pool, missing accounts. */
async function blockersFor(period: { id: number; period_name: string; start_date: Date; end_date: Date; status: string; production_costed_at: Date | null }, f: CostingFigures, db: Db): Promise<string[]> {
  const blockers: string[] = [];
  if (period.production_costed_at) blockers.push("Periode ini sudah ditutup biayanya.");
  if (isoDay(new Date()) <= isoDay(period.end_date)) blockers.push(`Periode ${period.period_name} belum berakhir: penutupan dijalankan setelah ${formatDate(isoDay(period.end_date))}.`);
  if (period.status !== "Open") blockers.push(`Periode ${period.period_name} tidak berstatus Open.`);
  const earlier = await db.accFiscalPeriod.findMany({ where: { end_date: { lt: period.start_date }, production_costed_at: null }, orderBy: { start_date: "asc" } });
  for (const p of earlier) {
    if (await hasProductionActivity(p.start_date, p.end_date, db)) {
      blockers.push(`Periode ${p.period_name} belum ditutup biayanya: tutup periode yang lebih lama lebih dulu.`);
      break;
    }
  }
  const to = period.end_date;
  const drafts = await Promise.all([
    draftExecutionsUpTo(to, db).then((n) => [n, "Eksekusi Produksi"] as const),
    draftTransfersUpTo(to, db).then((n) => [n, "Production Transfer"] as const),
    draftReleasesUpTo(to, db).then((n) => [n, "Production Release"] as const),
    draftStockIssuesUpTo(to, db).then((n) => [n, "Stock Issue"] as const),
    draftReceiptNotesUpTo(to, db).then((n) => [n, "Receipt Note"] as const),
    draftDeliveryNotesUpTo(to, db).then((n) => [n, "Delivery Note"] as const),
    draftCostBillsUpTo(to, db).then((n) => [n, "Tagihan Biaya"] as const),
  ]);
  for (const [n, what] of drafts) if (n) blockers.push(`${n} ${what} Draft bertanggal sampai ${formatDate(isoDay(to))}: posting atau batalkan dulu.`);
  if (f.pool < 0) blockers.push("Biaya produksi periode ini negatif: periksa journal pada account Jenis Biaya.");
  if (f.missing.length) blockers.push(`Lengkapi dulu: ${f.missing.join(", ")}.`);
  return blockers;
}

/** A period with a posted execution or a cost on a Jenis Biaya account — one the year may not close without (R28). */
async function hasProductionActivity(from: Date, to: Date, db: Db): Promise<boolean> {
  const [runs, nets] = await Promise.all([postedRunsInRange(from, to, db), costPoolAccountIds(db).then((ids) => accountNetMovements(ids, from, to, db))]);
  return runs.length > 0 || [...nets.values()].some((a) => a !== 0);
}

/**
 * Why a fiscal year may not close (R28): a period of it with production or
 * cost activity is not costed. Composed by the year-end closing's caller.
 */
export async function uncostedPeriodRefusal(fiscalYearId: number): Promise<string | null> {
  const periods = await prisma.accFiscalPeriod.findMany({ where: { fiscal_year_id: fiscalYearId, production_costed_at: null }, orderBy: { start_date: "asc" } });
  for (const p of periods) {
    if (await hasProductionActivity(p.start_date, p.end_date, prisma)) return `Periode ${p.period_name} belum ditutup biayanya (Penutupan Biaya Produksi).`;
  }
  return null;
}

// -------------------------------------------------------------------- reads

export type ClosePeriodRow = { periodId: number; periodName: string; yearLabel: string; start: string; end: string; status: string; costed: boolean; costedAt: string | null; poolTotal: number | null };

/** Fiscal periods with whether their production cost is closed, newest first. */
export async function closePeriods(): Promise<ClosePeriodRow[]> {
  const [rows, closes] = await Promise.all([
    prisma.accFiscalPeriod.findMany({ orderBy: { start_date: "desc" }, include: { fiscal_year: { select: { year_label: true } } } }),
    prisma.prdCostClose.findMany({ select: { period_id: true, pool_total: true } }),
  ]);
  const pool = new Map(closes.map((c) => [c.period_id, c.pool_total.toNumber()]));
  return rows.map((p) => ({
    periodId: p.id,
    periodName: p.period_name,
    yearLabel: p.fiscal_year.year_label,
    start: isoDay(p.start_date),
    end: isoDay(p.end_date),
    status: p.status,
    costed: p.production_costed_at != null,
    costedAt: p.production_costed_at?.toISOString() ?? null,
    poolTotal: pool.get(p.id) ?? null,
  }));
}

/** The figures a close shows — the same shape before it runs and as it stored them. */
export type CostingView = {
  poolTotal: number;
  pools: { accountLabel: string; accountName: string; amount: number }[];
  shares: { executionId: number; executionNo: string; driver: number; amount: number }[];
  dests: { kind: string; itemLabel: string | null; accountLabel: string; amount: number }[];
  items: { itemLabel: string; itemName: string; openingQty: number; inflowQty: number; outflowQty: number; endingQty: number; valueBefore: number; hpp: number; stock: number }[];
};

/** Names the accounts of a run's figures for the screen. */
export async function costingView(f: CostingFigures, db: Db = prisma): Promise<CostingView> {
  const ids = [...new Set([...f.pools.map((p) => p.accountId), ...f.dests.flatMap((d) => (d.accountId != null ? [d.accountId] : []))])];
  const accounts = new Map((await db.accAccount.findMany({ where: { id: { in: ids } }, select: { id: true, account_label: true, account_name: true } })).map((a) => [a.id, a]));
  const runNo = new Map(f.runs.map((r) => [r.id, r.no]));
  return {
    poolTotal: f.pool,
    pools: f.pools.map((p) => ({ accountLabel: accounts.get(p.accountId)?.account_label ?? "", accountName: accounts.get(p.accountId)?.account_name ?? "", amount: p.amount })),
    shares: f.out.shares.map((s) => ({ executionId: s.runId, executionNo: runNo.get(s.runId) ?? "", driver: s.driver, amount: s.amount })),
    dests: f.dests.map((d) => ({ kind: d.kind, itemLabel: d.itemLabel, accountLabel: d.accountId != null ? (accounts.get(d.accountId)?.account_label ?? "") : "", amount: d.amount })),
    items: f.items.map((i) => ({ itemLabel: i.itemLabel, itemName: i.itemName, openingQty: i.flow.opening, inflowQty: i.flow.inflow, outflowQty: i.flow.outflow, endingQty: i.flow.opening + i.flow.inflow - i.flow.outflow, valueBefore: i.flow.poolValue, hpp: i.hpp, stock: i.stock })),
  };
}

export type ClosePreview = { periodId: number; periodName: string; start: string; end: string; figures: CostingFigures; view: CostingView; blockers: string[] };

/** A period's close as it would run now. */
export async function previewClose(periodId: number): Promise<ClosePreview | null> {
  const period = await prisma.accFiscalPeriod.findUnique({ where: { id: periodId } });
  if (!period) return null;
  const figures = await costingFigures(period.start_date, period.end_date, `Penutupan Biaya Produksi ${period.period_name}`);
  return { periodId, periodName: period.period_name, start: isoDay(period.start_date), end: isoDay(period.end_date), figures, view: await costingView(figures), blockers: await blockersFor(period, figures, prisma) };
}

export type StoredClose = CostingView & { closeId: number; periodName: string; start: string; end: string; closeDate: string; journalId: number | null; createdAt: string };

/** What a costed period's close stored (R25). */
export async function storedClose(periodId: number): Promise<StoredClose | null> {
  const period = await prisma.accFiscalPeriod.findUnique({ where: { id: periodId }, select: { period_name: true, start_date: true, end_date: true } });
  const c = await prisma.prdCostClose.findUnique({ where: { period_id: periodId }, include: { pools: true, shares: { orderBy: { id: "asc" } }, dests: { orderBy: { id: "asc" } }, items: { orderBy: { id: "asc" } } } });
  if (!c || !period) return null;
  const accountIds = [...new Set([...c.pools.map((p) => p.account_id), ...c.dests.map((d) => d.account_id)])];
  const itemIds = [...new Set([...c.dests.flatMap((d) => (d.item_id != null ? [d.item_id] : [])), ...c.items.map((i) => i.item_id)])];
  const [accounts, items] = await Promise.all([
    prisma.accAccount.findMany({ where: { id: { in: accountIds } }, select: { id: true, account_label: true, account_name: true } }),
    prisma.mItem.findMany({ where: { id: { in: itemIds } }, select: { id: true, item_label: true, item_name: true } }),
  ]);
  const acc = new Map(accounts.map((a) => [a.id, a]));
  const it = new Map(items.map((i) => [i.id, i]));
  return {
    closeId: c.id,
    periodName: period.period_name,
    start: isoDay(period.start_date),
    end: isoDay(period.end_date),
    closeDate: isoDay(c.close_date),
    journalId: c.journal_id,
    poolTotal: c.pool_total.toNumber(),
    createdAt: c.created_at.toISOString(),
    pools: c.pools.map((p) => ({ accountLabel: acc.get(p.account_id)?.account_label ?? "", accountName: acc.get(p.account_id)?.account_name ?? "", amount: p.amount.toNumber() })),
    shares: c.shares.map((s) => ({ executionId: s.execution_id, executionNo: s.execution_no, driver: s.driver.toNumber(), amount: s.amount.toNumber() })),
    dests: c.dests.map((d) => ({ kind: d.kind, itemLabel: d.item_id != null ? (it.get(d.item_id)?.item_label ?? null) : null, accountLabel: acc.get(d.account_id)?.account_label ?? "", amount: d.amount.toNumber() })),
    items: c.items.map((i) => ({
      itemLabel: it.get(i.item_id)?.item_label ?? "",
      itemName: it.get(i.item_id)?.item_name ?? "",
      openingQty: i.opening_qty.toNumber(),
      inflowQty: i.inflow_qty.toNumber(),
      outflowQty: i.outflow_qty.toNumber(),
      endingQty: i.ending_qty.toNumber(),
      valueBefore: i.value_before.toNumber(),
      hpp: i.hpp_amount.toNumber(),
      stock: i.stock_amount.toNumber(),
    })),
  };
}

/** "Penutupan Biaya <periode>" per close id — the audit trail's subject names. */
export async function closeNumbersByIds(ids: number[]): Promise<Map<number, string>> {
  const closes = await prisma.prdCostClose.findMany({ where: { id: { in: ids } }, select: { id: true, period_id: true } });
  const periods = await prisma.accFiscalPeriod.findMany({ where: { id: { in: closes.map((c) => c.period_id) } }, select: { id: true, period_name: true } });
  const name = new Map(periods.map((p) => [p.id, p.period_name]));
  return new Map(closes.map((c) => [c.id, `Penutupan Biaya ${name.get(c.period_id) ?? ""}`]));
}

export type CostingSoFar = {
  periodName: string;
  from: string;
  to: string;
  costed: boolean;
  view: CostingView;
  /** Per item received to stock: the pool as posted and as the close would leave it (R26). */
  items: { itemId: number; itemLabel: string; itemName: string; uom: string; poolQty: number; postedValue: number; share: number; hpp: number; stock: number; finalValue: number; finalUnitCost: number }[];
};

/**
 * Costing Sementara (R26): the close of the period holding `asOf`, run as a
 * dry run of its own calculation over what is posted from the period's first
 * day to `asOf` — nothing is written. Null when no fiscal period holds the date.
 */
export async function costingSoFar(asOf: string): Promise<CostingSoFar | null> {
  const to = day(asOf);
  const period = await prisma.accFiscalPeriod.findFirst({ where: { start_date: { lte: to }, end_date: { gte: to } } });
  if (!period) return null;
  const f = await costingFigures(period.start_date, to, `Costing Sementara ${period.period_name}`);
  return {
    periodName: period.period_name,
    from: isoDay(period.start_date),
    to: asOf,
    costed: period.production_costed_at != null,
    view: await costingView(f),
    items: f.items.map((i) => {
      const finalValue = i.flow.poolValue + i.stock;
      return {
        itemId: i.itemId,
        itemLabel: i.itemLabel,
        itemName: i.itemName,
        uom: i.uom,
        poolQty: i.flow.poolQty,
        postedValue: i.flow.poolValue,
        share: i.received,
        hpp: i.hpp,
        stock: i.stock,
        finalValue,
        finalUnitCost: i.flow.poolQty > 0 ? Math.round((finalValue / i.flow.poolQty) * 1e6) / 1e6 : 0,
      };
    }),
  };
}

// ------------------------------------------------------------------ running

export type CloseResult = { ok: true; closeId: number; journal: JournalLineInput[] } | { ok: false; errors: Record<string, string> };

/** Closes a period's production cost, once. `dryRun` rolls it all back and returns the journal (P103). */
export async function runClose(periodId: number, actorId: number, options: { dryRun?: boolean } = {}): Promise<CloseResult> {
  let closeId = 0;
  let journal: JournalLineInput[] = [];
  try {
    await prisma.$transaction(
      async (tx) => {
        // Two closes of one period serialise on the period row.
        await tx.$queryRaw`SELECT "id" FROM "acc_fiscal_period" WHERE "id" = ${periodId} FOR UPDATE`;
        const period = await tx.accFiscalPeriod.findUnique({ where: { id: periodId } });
        if (!period) throw new ProductionRefusal("Periode tidak ditemukan.");
        const label = `Penutupan Biaya Produksi ${period.period_name}`;
        const f = await costingFigures(period.start_date, period.end_date, label, tx);
        const blockers = await blockersFor(period, f, tx);
        if (blockers.length) throw new ProductionRefusal(blockers[0]);
        const date = period.end_date;

        const close = await tx.prdCostClose.create({ data: { period_id: periodId, close_date: date, pool_total: f.pool, created_by: actorId } });
        closeId = close.id;
        const source = { docTypeId: await docTypeId(tx), docId: close.id, no: label };
        for (const d of f.dests) {
          if (d.kind === "Wip") await revalueBucket(tx, { bucketId: d.bucketId!, value: d.amount, date, source, actorId });
          else if (d.kind === "Stock") await revaluePool(tx, { itemId: d.itemId!, value: d.amount, date, source, actorId });
        }
        const posted = f.lines.length ? await postJournal(tx, { description: label, sourceDocTypeId: source.docTypeId, sourceDocId: close.id, postingDate: date, actorId, lines: f.lines }) : null;
        await tx.prdCostClose.update({ where: { id: close.id }, data: { journal_id: posted?.id ?? null } });
        if (f.pools.length) await tx.prdCostClosePool.createMany({ data: f.pools.map((p) => ({ close_id: close.id, account_id: p.accountId, amount: p.amount })) });
        const runNo = new Map(f.runs.map((r) => [r.id, r.no]));
        if (f.out.shares.length) await tx.prdCostCloseShare.createMany({ data: f.out.shares.map((s) => ({ close_id: close.id, execution_id: s.runId, execution_no: runNo.get(s.runId) ?? "", driver: s.driver, amount: s.amount })) });
        if (f.dests.length) await tx.prdCostCloseDest.createMany({ data: f.dests.map((d) => ({ close_id: close.id, kind: d.kind, item_id: d.itemId, bucket_id: d.bucketId, account_id: d.accountId!, amount: d.amount })) });
        if (f.items.length) {
          await tx.prdCostCloseItem.createMany({
            data: f.items.map((i) => ({
              close_id: close.id,
              item_id: i.itemId,
              opening_qty: i.flow.opening,
              inflow_qty: i.flow.inflow,
              outflow_qty: i.flow.outflow,
              ending_qty: i.flow.opening + i.flow.inflow - i.flow.outflow,
              value_before: i.flow.poolValue,
              hpp_amount: i.hpp,
              stock_amount: i.stock,
            })),
          });
        }
        // The lock is the close's last write, so its own rows above went through (R15).
        const poolAccounts = await costPoolAccountIds(tx);
        await lockCostedPeriod(tx, periodId, [...poolAccounts, ...(f.absorbedAccountId ? [f.absorbedAccountId] : [])], actorId);
        await tx.auditLog.create({ data: { entity_key: "prd_cost_close", row_id: close.id, action: "TAMBAH", event: "close", by: actorId } });
        journal = f.lines;
        if (options.dryRun) throw new PostingDryRun(f.lines);
      },
      { timeout: 120_000 }
    );
  } catch (e) {
    if (e instanceof PostingDryRun) return { ok: true, closeId: 0, journal: e.lines };
    if (e instanceof ProductionRefusal || e instanceof InventoryRefusal || e instanceof PeriodLockRefusal) return { ok: false, errors: { _form: `Belum bisa ditutup: ${e.message}` } };
    throw e;
  }
  return { ok: true, closeId, journal };
}

/** `2026-11-30` → the Date the close and Costing Sementara read up to. */
export const closeDay = day;
