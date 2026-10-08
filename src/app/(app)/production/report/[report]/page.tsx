import { notFound } from "next/navigation";
import { ReportNeedsSubject, ReportView } from "@/components/report/report-view";
import { ProductionCostParams } from "@/components/report/production-cost-params";
import { CostCenterReportBody, type SourceDocName } from "@/components/report/cost-center-report";
import { requirePermission } from "@/lib/erp/auth";
import { costCenterOptions, costCenterReport } from "@/lib/erp/cost-center";
import { reportableFiscalYears, type ReportableFiscalYear } from "@/lib/erp/fiscal";
import { reportBySlug, reportHref } from "@/lib/erp/reports";
import { formatDate } from "@/lib/format";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * The Produksi module's Report View (P154, M90): *Laporan Cost Center*, read
 * for one month — a fiscal period — and optionally one Cost Center, from
 * journal lines only. The General Ledger and the other reports are unchanged
 * (M85).
 */
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ report: string }>;
  searchParams: Promise<{ year?: string; period?: string; center?: string }>;
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
          body="Biaya per Cost Center dibaca per bulan tahun buku. Aktifkan Fiscal Year terlebih dahulu — periode bulanannya dibuat saat itu."
        />
      </ReportView>
    );
  }

  const chosen = pickPeriod(years, Number(query.year) || null, Number(query.period) || null);
  const centerId = Number(query.center) || null;
  const centers = await costCenterOptions();

  const filter = (
    <ProductionCostParams
      slug={slug}
      years={years.map((y) => ({ id: y.id, name: y.label, periods: y.periods.map((p) => ({ id: p.id, name: p.name })) }))}
      value={{ yearId: chosen.year.id, periodId: chosen.period.id }}
      costCenters={centers.map((c) => ({ id: c.id, label: c.label, name: c.name }))}
      costCenterId={centerId}
    />
  );
  const range = { from: chosen.period.startDate, to: chosen.period.endDate };
  const blocks = await costCenterReport({ yearStart: chosen.year.startDate, ...range, costCenterIds: centerId ? [centerId] : [] });
  const typeIds = [...new Set(blocks.flatMap((b) => b.accounts.flatMap((a) => a.lines.map((l) => l.sourceDocTypeId))).filter((x): x is number => Boolean(x)))];
  const docTypes = typeIds.length ? await prisma.sysDocType.findMany({ where: { id: { in: typeIds } } }) : [];
  const docs = new Map<number, SourceDocName>(docTypes.map((d) => [d.id, { table: d.doc_table, name: d.doc_name }]));

  return (
    <ReportView
      report={report}
      filter={filter}
      runAt={runAt}
      footnote={
        <>
          {chosen.period.name} · {formatDate(range.from)} s/d {formatDate(range.to)}. Saldo awal dihitung sejak awal tahun buku ({formatDate(chosen.year.startDate)}). Angka dibaca dari baris journal yang menyebut Cost Center.
        </>
      }
    >
      <CostCenterReportBody blocks={blocks} docs={docs} range={range} />
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
