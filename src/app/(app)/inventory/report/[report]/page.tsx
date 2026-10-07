import { notFound } from "next/navigation";
import { ReportNeedsSubject, ReportView } from "@/components/report/report-view";
import { StockReportParams } from "@/components/report/stock-report-params";
import { StockBalanceBody, StockLedgerBody } from "@/components/report/stock-card-reports";
import { Mismatch, ValuationBody, ValuationLedgerBody, type InventoryGl } from "@/components/report/stock-reports";
import { requirePermission } from "@/lib/erp/auth";
import { closingBalances } from "@/lib/erp/ledger";
import type { PeriodRange } from "@/lib/erp/period";
import { reportBySlug, reportHref } from "@/lib/erp/reports";
import {
  stockBalanceReport,
  stockBooksReconcile,
  stockItemOptions,
  stockLedgerReport,
  stockWarehouseOptions,
  valuationLedgerReport,
  valuationReport,
  type StockGroupBy,
} from "@/lib/erp/stock-report";
import { postingAccounts } from "@/lib/erp/system-settings";
import { formatDate } from "@/lib/format";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * Every Report View in the Persediaan module (P120), driven by the catalogue
 * like Finance's and Accounting's: Kartu Stok and Kartu Nilai Persediaan over a
 * period, Saldo Stok and Nilai Persediaan as of a date. Parameters come from
 * the query string; the figures are read from the stock ledgers. Kartu Stok and
 * Saldo Stok take sets of items and warehouses (`items=1,4`, `warehouses=2`)
 * and a grouping (`group=item|warehouse`); the valuation reports one item.
 */
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ report: string }>;
  searchParams: Promise<{ item?: string; items?: string; warehouses?: string; group?: string; asOf?: string; from?: string; to?: string }>;
}) {
  const { report: slug } = await params;
  const report = reportBySlug(slug);
  if (!report || report.module !== "inventory") notFound();
  await requirePermission(report.permission, reportHref(slug));

  const query = await searchParams;
  const itemId = positiveInt(query.item);
  const itemIds = idList(query.items);
  const warehouseIds = idList(query.warehouses);
  const groupBy: StockGroupBy = query.group === "warehouse" ? "warehouse" : "item";
  const range = resolveRange(query.from, query.to);
  const asOf = isDate(query.asOf) ? query.asOf : new Date().toISOString().slice(0, 10);
  const runAt = new Date().toISOString();
  // The valuation pool is the item's, over every warehouse: no warehouse filter and no grouping.
  const grouped = report.key === "stock_ledger" || report.key === "stock_balance";
  const [items, warehouses] = await Promise.all([stockItemOptions(), grouped ? stockWarehouseOptions() : null]);
  // Each run is keyed on its URL, so its blocks start folded afresh.
  const runKey = JSON.stringify(query);

  const filter = (
    <StockReportParams
      slug={slug}
      items={items}
      warehouses={warehouses}
      grouped={grouped}
      itemIds={grouped ? itemIds : itemId ? [itemId] : []}
      warehouseIds={warehouseIds}
      groupBy={groupBy}
      mode={report.params === "stock-asof" ? "asof" : "period"}
      asOf={asOf}
      from={range.from}
      to={range.to}
      itemRequired={report.subjectRequired}
    />
  );
  const needsItem = (
    <ReportNeedsSubject
      icon="book"
      title="Pilih Barang terlebih dahulu"
      body="Kartu ini selalu milik satu barang. Pilih barang dan rentang tanggal di atas, lalu tekan Tampilkan."
    />
  );

  if (report.key === "stock_ledger") {
    const [cards, reconciles] = await Promise.all([stockLedgerReport(itemIds, warehouseIds, range), stockBooksReconcile(itemIds)]);
    return (
      <ReportView
        report={report}
        filter={filter}
        runAt={runAt}
        footnote={
          <>
            Jumlah dalam satuan dasar barang. Saldo per barang per gudang, menurut tanggal lalu urutan posting, dari saldo awal sebelum{" "}
            {formatDate(range.from)}.
          </>
        }
      >
        <StockLedgerBody key={runKey} cards={cards} groupBy={groupBy} range={range} />
        <Mismatch show={!reconciles} />
      </ReportView>
    );
  }

  if (report.key === "stock_valuation_ledger") {
    const data = itemId ? await valuationLedgerReport(itemId, range) : null;
    return (
      <ReportView
        report={report}
        filter={filter}
        runAt={runAt}
        footnote={<>Nilai rata-rata bergerak per barang untuk seluruh gudang; barang keluar dilepas sebesar nilai × qty ÷ jumlah, dibulatkan ke rupiah.</>}
      >
        {data ? <ValuationLedgerBody report={data} /> : needsItem}
      </ReportView>
    );
  }

  if (report.key === "stock_balance") {
    const [positions, reconciles] = await Promise.all([stockBalanceReport(asOf, itemIds, warehouseIds), stockBooksReconcile(itemIds)]);
    return (
      <ReportView report={report} filter={filter} runAt={runAt} footnote={<>Saldo per {formatDate(asOf)} dari Kartu Stok, dalam satuan dasar barang.</>}>
        <StockBalanceBody key={runKey} positions={positions} groupBy={groupBy} asOf={asOf} />
        <Mismatch show={!reconciles} />
      </ReportView>
    );
  }

  const reconciles = await stockBooksReconcile(itemId);

  // Nilai Persediaan, checked against the Persediaan account in the General Ledger.
  const rows = await valuationReport(asOf, itemId);
  let gl: InventoryGl;
  const mapped = await postingAccounts(["inventory_account"] as const);
  if (itemId) {
    gl = { ok: false, missing: "Pencocokan dengan Buku Besar hanya untuk seluruh barang." };
  } else if (!mapped.ok) {
    gl = { ok: false, missing: `${mapped.missing.join(", ")} belum diatur di Account Mapping.` };
  } else {
    const accountId = mapped.ids.inventory_account;
    const balance = (await closingBalances(asOf)).filter((b) => b.accountId === accountId).reduce((s, b) => s + b.balance, 0);
    const account = await prisma.accAccount.findUnique({ where: { id: accountId }, select: { account_label: true, account_name: true } });
    gl = { ok: true, accountLabel: account?.account_label ?? "", accountName: account?.account_name ?? "", balance };
  }
  return (
    <ReportView
      report={report}
      filter={filter}
      runAt={runAt}
      footnote={<>Nilai per {formatDate(asOf)} dari Kartu Nilai Persediaan. Stok yang diinjeksi tidak berjurnal, jadi selisih dengan Buku Besar sebesar nilainya adalah wajar.</>}
    >
      <ValuationBody rows={rows} gl={gl} reconciles={reconciles} />
    </ReportView>
  );
}

function resolveRange(from?: string, to?: string): PeriodRange {
  const today = new Date();
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const monthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
  const start = isDate(from) ? from : iso(monthStart);
  const end = isDate(to) ? to : iso(today);
  return start <= end ? { from: start, to: end } : { from: end, to: start };
}

function isDate(value: string | undefined): value is string {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)));
}

/** `1,4,9` → [1, 4, 9]; anything that is not a positive whole number is dropped. */
function idList(value: string | undefined): number[] {
  return [...new Set((value ?? "").split(",").map(Number).filter((n) => Number.isInteger(n) && n > 0))];
}

function positiveInt(value: string | undefined): number | null {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}
