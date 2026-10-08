import { notFound } from "next/navigation";
import { ReportNeedsSubject, ReportView } from "@/components/report/report-view";
import { ProductionCostParams } from "@/components/report/production-cost-params";
import { CostBalanceBody, CostLedgerBody, type CostSourceDoc, type GlBeside } from "@/components/report/production-cost-reports";
import { requirePermission } from "@/lib/erp/auth";
import { reportableFiscalYears, type ReportableFiscalYear } from "@/lib/erp/fiscal";
import { accountMovements } from "@/lib/erp/ledger";
import { costBalances, costByAccount, costLedgerRows, elementOptions } from "@/lib/erp/production-cost";
import { reportBySlug, reportHref } from "@/lib/erp/reports";
import { formatDate } from "@/lib/format";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * The Produksi module's Report Views (P150 M66): Buku Biaya Produksi and Saldo
 * Biaya Produksi, each read for one month — a fiscal period — and optionally
 * one Elemen Biaya Produksi. The figures are the cost ledger's (M60); the GL
 * is set beside them only as a check (M67).
 */
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ report: string }>;
  searchParams: Promise<{ year?: string; period?: string; element?: string }>;
}) {
  const { report: slug } = await params;
  const report = reportBySlug(slug);
  if (!report || report.module !== "production") notFound();
  await requirePermission(report.permission, reportHref(slug));

  const query = await searchParams;
  const runAt = new Date().toISOString();
  const years = await reportableFiscalYears();
  if (!years.length) {
    return (
      <ReportView report={report} filter={null} runAt={runAt}>
        <ReportNeedsSubject
          icon="cal"
          title="Belum ada tahun buku aktif"
          body="Biaya produksi dibaca per bulan tahun buku. Aktifkan Fiscal Year terlebih dahulu — periode bulanannya dibuat saat itu."
        />
      </ReportView>
    );
  }

  const chosen = pickPeriod(years, Number(query.year) || null, Number(query.period) || null);
  const elementId = Number(query.element) || null;
  const elements = await elementOptions();
  const elementById = new Map(elements.map((e) => [e.id, e]));
  const filterIds = elementId ? [elementId] : [];

  const filter = (
    <ProductionCostParams
      slug={slug}
      years={years.map((y) => ({ id: y.id, name: y.label, periods: y.periods.map((p) => ({ id: p.id, name: p.name })) }))}
      value={{ yearId: chosen.year.id, periodId: chosen.period.id }}
      elements={elements.map((e) => ({ id: e.id, label: e.label, name: e.name }))}
      elementId={elementId}
    />
  );
  const range = { from: chosen.period.startDate, to: chosen.period.endDate };
  const footnote = (
    <>
      {chosen.period.name} · {formatDate(range.from)} s/d {formatDate(range.to)}. Angka dibaca dari Buku Biaya Produksi, sumber penutupan biaya produksi.
    </>
  );

  if (report.key === "production_cost_ledger") {
    const rows = await costLedgerRows(range, filterIds);
    const docTypes = await prisma.sysDocType.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.source.docTypeId))] } } });
    const docs = new Map<number, CostSourceDoc>(docTypes.map((d) => [d.id, { table: d.doc_table, name: d.doc_name }]));
    return (
      <ReportView report={report} filter={filter} runAt={runAt} footnote={footnote}>
        <CostLedgerBody rows={rows} elements={elementById} docs={docs} />
      </ReportView>
    );
  }

  // Saldo Biaya Produksi, with the GL beside it per element account.
  const accounts = [...new Map((elementId ? elements.filter((e) => e.id === elementId) : elements).map((e) => [e.accountId, e])).values()];
  const accountIds = accounts.map((e) => e.accountId);
  const [balances, ledgerByAccount, gl] = await Promise.all([costBalances(range, filterIds), costByAccount(range, accountIds), accountMovements(range, accountIds)]);
  const beside: GlBeside[] = accounts.map((e) => {
    const m = gl.get(e.accountId);
    return {
      accountId: e.accountId,
      accountLabel: e.accountLabel,
      accountName: e.accountName,
      costLedger: ledgerByAccount.get(e.accountId) ?? 0,
      gl: m ? Math.round((m.debit - m.credit) * 100) / 100 : 0,
    };
  });
  return (
    <ReportView report={report} filter={filter} runAt={runAt} footnote={footnote}>
      <CostBalanceBody balances={balances} elements={elementById} gl={beside} />
    </ReportView>
  );
}

/** The chosen period, else the one holding today in an Open year, else the newest. */
function pickPeriod(years: ReportableFiscalYear[], yearId: number | null, periodId: number | null) {
  const year = years.find((y) => y.id === yearId);
  const period = year?.periods.find((p) => p.id === periodId);
  if (year && period) return { year, period };
  const today = new Date().toISOString().slice(0, 10);
  for (const y of years) {
    const p = y.periods.find((x) => x.startDate <= today && today <= x.endDate);
    if (p) return { year: y, period: p };
  }
  const newest = years[0];
  return { year: newest, period: newest.periods[newest.periods.length - 1] };
}
