import "server-only";

import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import { BASE_CURRENCY_LABEL } from "./currency";
import { costCenterOptions, costCenterPeriodNets, overheadCostCenterId } from "./cost-center";
import { PostingDryRun, describeJournalLines, postJournal, type JournalLineInput } from "./journal";
import { accountsForItems } from "./item-account";
import { InventoryRefusal, poolFlows, revaluePool } from "./inventory";
import { draftDeliveryNotesUpTo } from "./delivery-note";
import { draftReceiptNotesUpTo } from "./receipt-note";
import { unsettledStockIssuesUpTo } from "./stock-issue";
import { draftCostBillsUpTo, } from "./production-cost-bill";
import { expenseAccountItems } from "./production-cost";
import { unsettledHandoversUpTo } from "./production-handover";
import { ProductionRefusal, lotFates, revalueBucket, type LotFate } from "./production-ledger";
import { draftReleasesUpTo, releasePurposesByIds } from "./production-release";
import { draftRunsUpTo, postedRunsInRange } from "./production-run";
import { settleClose, type CloseDestOut, type ClosePoolOut, type CloseShareOut } from "./production-close-shape";
import { standardCostItemAccounts } from "./standard-cost";
import { fallbackAccounts } from "./system-settings";
import { formatNumber } from "@/lib/format";

/**
 * Penutupan Biaya Produksi — the month-end costing (Walet step 8, P172, M96–M99,
 * `Standard-Cost-Plan.md` §4). Its tables are `prd_cost_close` and its three
 * detail tables, and nothing else names them.
 *
 * A period at a time, oldest first, after its last day. For each Production
 * Cost Center and Standard Cost Item the **leftover** — what was spent less what
 * the executions absorbed at standard — is taken to zero: the Overhead is spread
 * Rata first, each Cost Center's balance is shared over the period's posted
 * executions by Driver (`production-close-shape.ts`), each share goes to the
 * execution's outputs by Bobot Biaya and is followed forward through the lots to
 * where the value is now — WIP, stock, HPP or scrap. One journal, dated the
 * period's last day: **Dr** WIP / Persediaan / HPP / Beban Pemusnahan, **Cr** each
 * Standard Cost Item's account at its Cost Center; value-only rows (quantity 0)
 * in the production ledger and the stock valuation book carry it. It is
 * irreversible and **locks the period** for stock, production and cost postings.
 */

type Db = Prisma.TransactionClient | typeof prisma;
const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const day = (s: string) => new Date(`${s}T00:00:00Z`);
const rp = (n: number) => `Rp ${formatNumber(n, 0)}`;

async function docTypeId(db: Db): Promise<number> {
  const row = await db.sysDocType.findFirst({ where: { doc_table: "prd_cost_close" }, select: { id: true } });
  if (!row) throw new Error("Jenis dokumen prd_cost_close belum terdaftar. Jalankan db:seed.");
  return row.id;
}

// ---------------------------------------------------------------- computing

export type CloseBlocker = string;

export type CloseView = {
  periodId: number;
  periodName: string;
  start: string;
  end: string;
  costed: boolean;
  blockers: CloseBlocker[];
  pools: (ClosePoolOut & { costCenterLabel: string; itemLabel: string })[];
  shares: (CloseShareOut & { runNo: string; stationLabel: string })[];
  dests: (CloseDestOut & { itemLabel: string | null; accountLabel: string })[];
  lines: JournalLineInput[];
  /** Σ leftover taken to the products and stock. */
  absorbed: number;
};

type Computed = {
  view: CloseView;
  lines: JournalLineInput[];
  out: ReturnType<typeof settleClose>;
  destAccounts: number[];
};

async function compute(periodId: number, db: Db): Promise<Computed | null> {
  const period = await db.accFiscalPeriod.findUnique({ where: { id: periodId } });
  if (!period) return null;
  const from = period.start_date;
  const to = period.end_date;
  const blockers: string[] = [];
  const costed = period.production_costed_at != null;

  if (costed) blockers.push("Periode ini sudah ditutup biayanya.");
  if (!costed && isoDay(new Date()) <= isoDay(to)) blockers.push(`Periode ${period.period_name} belum berakhir: penutupan dijalankan setelah hari terakhirnya.`);
  if (period.status !== "Open") blockers.push(`Periode ${period.period_name} belum berstatus Open.`);

  // Oldest first: an earlier period with production activity must be costed before this one.
  const earlier = await db.accFiscalPeriod.findMany({ where: { end_date: { lt: from }, production_costed_at: null }, orderBy: { start_date: "asc" } });
  for (const p of earlier) {
    const [runs, nets] = await Promise.all([postedRunsInRange(p.start_date, p.end_date, db), costCenterPeriodNets(p.start_date, p.end_date, db)]);
    if (runs.length || nets.length) {
      blockers.push(`Periode ${p.period_name} belum ditutup biayanya: tutup periode yang lebih lama lebih dulu.`);
      break;
    }
  }

  const drafts = await Promise.all([
    draftRunsUpTo(to, db).then((n) => [n, "Eksekusi Produksi"] as const),
    draftReleasesUpTo(to, db).then((n) => [n, "Penerimaan Hasil / Pemusnahan Produksi"] as const),
    unsettledHandoversUpTo(to, db).then((n) => [n, "Hand-over (Draft atau masih dalam perjalanan)"] as const),
    unsettledStockIssuesUpTo(to, db).then((n) => [n, "Stock Issue / BSTB (Draft atau masih dalam perjalanan)"] as const),
    draftReceiptNotesUpTo(to, db).then((n) => [n, "Receipt Note"] as const),
    draftDeliveryNotesUpTo(to, db).then((n) => [n, "Delivery Note"] as const),
    draftCostBillsUpTo(to, db).then((n) => [n, "Tagihan Biaya"] as const),
  ]);
  for (const [n, what] of drafts) if (n) blockers.push(`${n} ${what} bertanggal sampai ${isoDay(to)} belum diselesaikan.`);

  // Pools: the Production Cost Centers' balances per Standard Cost Item.
  const [centers, nets, expenseItem, items, overhead, runs, stations] = await Promise.all([
    costCenterOptions(db),
    costCenterPeriodNets(from, to, db),
    expenseAccountItems(db),
    standardCostItemAccounts(db),
    overheadCostCenterId(),
    postedRunsInRange(from, to, db),
    db.refWorkstation.findMany({ select: { id: true, workstation_label: true, cost_center_id: true } }),
  ]);
  const productionCenters = new Map(centers.filter((c) => c.category === "Production").map((c) => [c.id, c]));
  const itemOfAccount = new Map(items.map((i) => [i.accountId, i.id]));
  const itemById = new Map(items.map((i) => [i.id, i]));
  const poolMap = new Map<string, { costCenterId: number; itemId: number; accountId: number; actual: number; standard: number }>();
  for (const n of nets) {
    if (!productionCenters.has(n.costCenterId)) continue;
    const viaExpense = expenseItem.get(n.accountId);
    const viaAccount = itemOfAccount.get(n.accountId);
    const itemId = viaExpense ?? viaAccount;
    if (itemId == null) {
      blockers.push(`Cost Center ${productionCenters.get(n.costCenterId)!.label} memiliki biaya pada account yang tidak terhubung ke Standard Cost Item (account #${n.accountId}).`);
      continue;
    }
    const item = itemById.get(itemId)!;
    const k = `${n.costCenterId}:${itemId}`;
    const p = poolMap.get(k) ?? { costCenterId: n.costCenterId, itemId, accountId: item.accountId, actual: 0, standard: 0 };
    if (viaExpense != null) p.actual += n.debit - n.credit;
    else p.standard += n.credit - n.debit;
    poolMap.set(k, p);
  }

  // Executions and what became of their outputs.
  const stationCenter = new Map(stations.map((s) => [s.id, s]));
  const closeRuns = runs.flatMap((r) => {
    const cc = stationCenter.get(r.workstationId)?.cost_center_id;
    return cc && productionCenters.has(cc) ? [{ id: r.id, costCenterId: cc, driver: r.driver, outputs: r.outputs }] : [];
  });
  const fates = new Map<number, LotFate>();
  let frontier = [...new Set(closeRuns.flatMap((r) => r.outputs.map((o) => o.lotId)))];
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
    pools: [...poolMap.values()],
    overheadCostCenterId: overhead,
    runs: closeRuns,
    fate: (id) => fates.get(id) ?? empty,
    releasePurpose: (id) => purposes.get(id) ?? "finished_receipt",
    flows: (id) => flows.get(id) ?? { opening: 0, inflow: 0, outflow: 0, poolQty: 0 },
  });

  // Accounts for the destinations.
  const destItems = [...new Set(out.dests.flatMap((d) => (d.itemId != null ? [d.itemId] : [])))];
  const byItem = await accountsForItems(destItems, db);
  const fb = await fallbackAccounts(["inventory_account", "cogs_account", "production_scrap_account"] as const);
  const itemRows = destItems.length ? await db.mItem.findMany({ where: { id: { in: destItems } }, select: { id: true, item_label: true } }) : [];
  const itemLabel = new Map(itemRows.map((i) => [i.id, i.item_label]));
  const accountOf = (d: CloseDestOut): number | null => {
    const a = d.itemId != null ? byItem.get(d.itemId) : undefined;
    if (d.kind === "Wip") return a?.wip ?? null;
    if (d.kind === "Stock") return a?.inventory ?? fb.inventory_account;
    if (d.kind === "Scrap") return fb.production_scrap_account;
    return a?.cogs ?? fb.cogs_account;
  };
  const missing = new Set<string>();
  for (const d of out.dests) {
    if (accountOf(d) == null) {
      const what = d.kind === "Wip" ? `Account WIP Kategori Item ${itemLabel.get(d.itemId!) ?? ""}` : d.kind === "Stock" ? "Account Persediaan" : d.kind === "Scrap" ? "Account Beban Pemusnahan Produksi (Account Mapping)" : "Account HPP";
      missing.add(what);
    }
  }
  if (missing.size) blockers.push(`Lengkapi dulu: ${[...missing].join(", ")}.`);

  // The journal: Dr destinations / Cr each Standard Cost Item's account at its Cost Center.
  const lines: JournalLineInput[] = [];
  const label = `Penutupan Biaya Produksi ${period.period_name}`;
  const net = new Map<number, number>();
  for (const d of out.dests) {
    const a = accountOf(d);
    if (a != null) net.set(a, (net.get(a) ?? 0) + d.amount);
  }
  const currency = await db.refCurrency.findFirst({ where: { currency_label: BASE_CURRENCY_LABEL }, select: { id: true } });
  const mk = (accountId: number, amount: number, description: string, costCenterId?: number): JournalLineInput => ({
    accountId,
    currencyId: currency!.id,
    rate: 1,
    debit: amount > 0 ? amount : 0,
    credit: amount < 0 ? -amount : 0,
    description,
    ...(costCenterId ? { costCenterId } : {}),
  });
  for (const [accountId, amount] of net) if (amount !== 0) lines.push(mk(accountId, amount, `${label} · biaya dibebankan`));
  for (const p of out.pools) if (p.leftover !== 0) lines.push(mk(p.accountId, -p.leftover, `${label} · ${itemById.get(p.itemId)?.label ?? ""}`, p.costCenterId));

  const view: CloseView = {
    periodId,
    periodName: period.period_name,
    start: isoDay(from),
    end: isoDay(to),
    costed,
    blockers,
    pools: out.pools.map((p) => ({ ...p, costCenterLabel: productionCenters.get(p.costCenterId)?.label ?? `#${p.costCenterId}`, itemLabel: itemById.get(p.itemId)?.label ?? `#${p.itemId}` })),
    shares: out.shares.map((s) => {
      const r = runs.find((x) => x.id === s.runId)!;
      return { ...s, runNo: r.no, stationLabel: stationCenter.get(r.workstationId)?.workstation_label ?? "" };
    }),
    dests: out.dests.map((d) => ({ ...d, itemLabel: d.itemId != null ? itemLabel.get(d.itemId) ?? null : null, accountLabel: d.kind })),
    lines,
    absorbed: out.absorbed,
  };
  const destAccounts = out.dests.map((d) => accountOf(d) ?? 0);
  return { view, lines, out, destAccounts };
}

// -------------------------------------------------------------------- reads

export type ClosePeriodRow = { periodId: number; periodName: string; start: string; end: string; costed: boolean; costedAt: string | null; leftoverTotal: number | null };

/** Fiscal periods with whether their cost has been closed, newest year first. */
export async function closePeriods(): Promise<ClosePeriodRow[]> {
  const rows = await prisma.accFiscalPeriod.findMany({ orderBy: { start_date: "desc" }, include: { cost_close: { select: { leftover_total: true } } } });
  return rows.map((p) => ({
    periodId: p.id,
    periodName: p.period_name,
    start: isoDay(p.start_date),
    end: isoDay(p.end_date),
    costed: p.production_costed_at != null,
    costedAt: p.production_costed_at ? p.production_costed_at.toISOString() : null,
    leftoverTotal: p.cost_close?.leftover_total.toNumber() ?? null,
  }));
}

/** The close of a period as it would be (a preview) — or, once run, as it was stored. */
export async function previewClose(periodId: number): Promise<CloseView | null> {
  const c = await compute(periodId, prisma);
  return c?.view ?? null;
}

export type CloseStored = {
  closeId: number;
  journalId: number | null;
  leftoverTotal: number;
  pools: { costCenterLabel: string; itemLabel: string; actual: number; standard: number; overhead: number; leftover: number }[];
  shares: { runNo: string; driver: number; amount: number }[];
  dests: { kind: string; itemLabel: string | null; amount: number }[];
};

export async function storedClose(periodId: number): Promise<CloseStored | null> {
  const c = await prisma.prdCostClose.findUnique({ where: { period_id: periodId }, include: { pools: true, shares: true, dests: true } });
  if (!c) return null;
  const [centers, items, runs, itemRows] = await Promise.all([
    costCenterOptions(),
    standardCostItemAccounts(),
    postedRunsInRange(new Date("2000-01-01T00:00:00Z"), new Date("2100-01-01T00:00:00Z")),
    prisma.mItem.findMany({ where: { id: { in: c.dests.flatMap((d) => (d.item_id != null ? [d.item_id] : [])) } }, select: { id: true, item_label: true } }),
  ]);
  const cc = new Map(centers.map((x) => [x.id, x.label]));
  const it = new Map(items.map((x) => [x.id, x.label]));
  const run = new Map(runs.map((r) => [r.id, r.no]));
  const itl = new Map(itemRows.map((i) => [i.id, i.item_label]));
  return {
    closeId: c.id,
    journalId: c.journal_id,
    leftoverTotal: c.leftover_total.toNumber(),
    pools: c.pools.map((p) => ({ costCenterLabel: cc.get(p.cost_center_id) ?? `#${p.cost_center_id}`, itemLabel: it.get(p.standard_cost_item_id) ?? `#${p.standard_cost_item_id}`, actual: p.actual.toNumber(), standard: p.standard.toNumber(), overhead: p.overhead.toNumber(), leftover: p.leftover.toNumber() })),
    shares: c.shares.map((s) => ({ runNo: run.get(s.execution_id) ?? `#${s.execution_id}`, driver: s.driver.toNumber(), amount: s.amount.toNumber() })),
    dests: c.dests.map((d) => ({ kind: d.kind, itemLabel: d.item_id != null ? itl.get(d.item_id) ?? null : null, amount: d.amount.toNumber() })),
  };
}

export async function closeNumbersByIds(ids: number[]): Promise<Map<number, string>> {
  const rows = await prisma.prdCostClose.findMany({ where: { id: { in: ids } }, include: { period: { select: { period_name: true } } } });
  return new Map(rows.map((r) => [r.id, `Penutupan Biaya ${r.period.period_name}`]));
}

// ------------------------------------------------------------------ running

export type CloseResult = { ok: true; closeId: number; journal: JournalLineInput[] } | { ok: false; errors: Record<string, string> };

/** Closes a period's production cost, once: value rows, one journal, the lock. `dryRun` rolls it all back and returns the journal (P103). */
export async function runClose(periodId: number, actorId: number, options: { dryRun?: boolean } = {}): Promise<CloseResult> {
  let journalOut: JournalLineInput[] = [];
  let closeId = 0;
  try {
    await prisma.$transaction(
      async (tx) => {
        // Serialise two closes of one period: the period row is the lock.
        await tx.$queryRaw`SELECT "id" FROM "acc_fiscal_period" WHERE "id" = ${periodId} FOR UPDATE`;
        const c = await compute(periodId, tx);
        if (!c) throw new ProductionRefusal("Periode tidak ditemukan.");
        if (c.view.blockers.length) throw new ProductionRefusal(c.view.blockers[0]);
        const period = (await tx.accFiscalPeriod.findUnique({ where: { id: periodId }, select: { end_date: true, period_name: true } }))!;
        const date = period.end_date;
        const close = await tx.prdCostClose.create({ data: { period_id: periodId, close_date: date, leftover_total: c.out.absorbed, created_by: actorId } });
        closeId = close.id;
        const source = { docTypeId: await docTypeId(tx), docId: close.id, no: `Penutupan Biaya ${period.period_name}` };

        for (const d of c.out.dests) {
          if (d.kind === "Wip") await revalueBucket(tx, { bucketId: d.bucketId!, value: d.amount, date, source, actorId });
          else if (d.kind === "Stock") await revaluePool(tx, { itemId: d.itemId!, value: d.amount, date, source, actorId });
        }
        const journal = c.lines.length
          ? await postJournal(tx, { description: source.no, sourceDocTypeId: source.docTypeId, sourceDocId: close.id, postingDate: date, actorId, lines: c.lines, costClose: true })
          : null;
        await tx.prdCostClose.update({ where: { id: close.id }, data: { journal_id: journal?.id ?? null } });
        await tx.prdCostClosePool.createMany({
          data: c.out.pools.map((p) => ({ close_id: close.id, cost_center_id: p.costCenterId, standard_cost_item_id: p.itemId, actual: p.actual, standard: p.standard, overhead: p.overhead, leftover: p.leftover })),
        });
        await tx.prdCostCloseShare.createMany({ data: c.out.shares.map((s) => ({ close_id: close.id, execution_id: s.runId, driver: s.driver, amount: s.amount })) });
        await tx.prdCostCloseDest.createMany({
          data: c.out.dests.map((d, i) => ({ close_id: close.id, kind: d.kind, item_id: d.itemId, bucket_id: d.bucketId, account_id: c.destAccounts[i], amount: d.amount })),
        });
        await tx.accFiscalPeriod.update({ where: { id: periodId }, data: { production_costed_at: new Date() } });
        await tx.auditLog.create({ data: { entity_key: "prd_cost_close", row_id: close.id, action: "TAMBAH", event: "close", by: actorId } });
        journalOut = c.lines;
        if (options.dryRun) throw new PostingDryRun(c.lines);
      },
      { timeout: 120000 }
    );
  } catch (e) {
    if (e instanceof PostingDryRun) return { ok: true, closeId: 0, journal: e.lines };
    if (e instanceof ProductionRefusal || e instanceof InventoryRefusal) return { ok: false, errors: { _form: `Belum bisa ditutup: ${e.message}` } };
    throw e;
  }
  return { ok: true, closeId, journal: journalOut };
}

export { describeJournalLines, rp };
