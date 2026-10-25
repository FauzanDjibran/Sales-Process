import { notFound } from "next/navigation";
import { ReportNeedsSubject, ReportView } from "@/components/report/report-view";
import { ProductionCostParams } from "@/components/report/production-cost-params";
import { ProductionReportParams } from "@/components/report/production-report-params";
import { LotCardBody, ProductionMismatch, RecapBody, TraceBody, WipBalanceBody } from "@/components/report/production-reports";
import { CostCenterReportBody, type SourceDocName } from "@/components/report/cost-center-report";
import { requirePermission } from "@/lib/erp/auth";
import { costCenterOptions, costCenterReport } from "@/lib/erp/cost-center";
import { reportableFiscalYears, type ReportableFiscalYear } from "@/lib/erp/fiscal";
import { lotCardReport, partaiOptions, productionBooksReconcile, runRecapReport, stationOptions, traceReport, wipBalanceReport } from "@/lib/erp/production-report";
import { reportBySlug, reportHref, type ReportDef } from "@/lib/erp/reports";
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
  searchParams: Promise<{ year?: string; period?: string; center?: string; q?: string; stations?: string; partai?: string; asOf?: string; from?: string; to?: string }>;
}) {
  const { report: slug } = await params;
  const report = reportBySlug(slug);
  if (!report || report.module !== "production") notFound();
  await requirePermission(report.permission, reportHref(slug));

  const query = await searchParams;
  const runAt = new Date().toISOString();
  if (report.key !== "cost_center") return ProductionReportPage({ report, query, runAt });
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

/**
 * The four production reports (Walet step 7, P171), each from the ledgers: Saldo
 * Produksi as of a date, Kartu Lot and Telusur for one number, Rekap Produksi over
 * a period. Parameters are in the query string like every Report View.
 */
async function ProductionReportPage({
  report,
  query,
  runAt,
}: {
  report: ReportDef;
  query: { q?: string; stations?: string; partai?: string; asOf?: string; from?: string; to?: string };
  runAt: string;
}) {
  const slug = report.slug;
  const stationIds = idList(query.stations);
  const partaiId = Number(query.partai) > 0 ? Number(query.partai) : null;
  const today = new Date().toISOString().slice(0, 10);
  const asOf = isDate(query.asOf) ? query.asOf : today;
  const monthStart = `${today.slice(0, 8)}01`;
  const range = resolveRange(isDate(query.from) ? query.from : monthStart, isDate(query.to) ? query.to : today);
  const text = (query.q ?? "").trim();
  const mode = report.params === "production-asof" ? "asof" : report.params === "production-period" ? "period" : "lot";
  const [stations, partais] = mode === "lot" ? [[], []] : await Promise.all([stationOptions(), mode === "asof" ? partaiOptions() : []]);
  const filter = (
    <ProductionReportParams
      slug={slug}
      mode={mode}
      stations={stations}
      partais={partais}
      stationIds={stationIds}
      partaiId={partaiId}
      asOf={asOf}
      from={range.from}
      to={range.to}
      query={text}
      queryLabel={report.key === "trace" ? "Lot, Job atau Partai" : "Lot"}
    />
  );

  if (report.key === "wip_balance") {
    const [blocks, reconciles] = await Promise.all([wipBalanceReport(asOf, { partaiIds: partaiId ? [partaiId] : [], workstationIds: stationIds }), productionBooksReconcile()]);
    return (
      <ReportView report={report} filter={filter} runAt={runAt} footnote={<>Saldo per {formatDate(asOf)} dari buku produksi; jumlah dalam satuan dasar barang, nilai dalam rupiah utuh.</>}>
        <WipBalanceBody blocks={blocks} asOf={asOf} />
        <ProductionMismatch show={!reconciles} />
      </ReportView>
    );
  }
  if (report.key === "production_recap") {
    const stationsRecap = await runRecapReport(range, stationIds);
    return (
      <ReportView
        report={report}
        filter={filter}
        runAt={runAt}
        footnote={<>Eksekusi yang diposting {formatDate(range.from)} s/d {formatDate(range.to)}; susut = input − output, dan HPP per unit naik setiap ada susut karena nilainya tetap ikut barang.</>}
      >
        <RecapBody stations={stationsRecap} />
      </ReportView>
    );
  }
  if (!text) {
    return (
      <ReportView report={report} filter={filter} runAt={runAt}>
        <ReportNeedsSubject icon="book" title={report.key === "trace" ? "Isi nomor lot, Job atau Partai" : "Isi nomor lot"} body="Ketik nomornya di atas, lalu tekan Tampilkan." />
      </ReportView>
    );
  }
  if (report.key === "lot_card") {
    const card = await lotCardReport(text);
    return (
      <ReportView report={report} filter={filter} runAt={runAt} footnote={<>Satu lot, satu register: sama di produksi dan di stok (M128).</>}>
        {card ? <LotCardBody card={card} /> : <ReportNeedsSubject icon="book" title="Lot tidak ditemukan" body={`Tidak ada lot bernomor ${text.toUpperCase()}.`} />}
      </ReportView>
    );
  }
  const trace = await traceReport(text);
  return (
    <ReportView report={report} filter={filter} runAt={runAt} footnote={<>Dibaca dari silsilah lot setiap eksekusi; Job dan Partai dimulai dari semua lot yang pernah dipegangnya.</>}>
      {trace ? <TraceBody report={trace} /> : <ReportNeedsSubject icon="tree" title="Tidak ditemukan" body={`Tidak ada lot, Job atau Partai bernomor ${text.toUpperCase()}.`} />}
    </ReportView>
  );
}

function isDate(value: string | undefined): value is string {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)));
}

function resolveRange(a: string, b: string) {
  return a <= b ? { from: a, to: b } : { from: b, to: a };
}

/** `1,4,9` → [1, 4, 9]; anything that is not a positive whole number is dropped. */
function idList(value: string | undefined): number[] {
  return [...new Set((value ?? "").split(",").map(Number).filter((n) => Number.isInteger(n) && n > 0))];
}
