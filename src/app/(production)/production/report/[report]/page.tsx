import { notFound } from "next/navigation";
import { ReportNeedsSubject, ReportView } from "@/components/report/report-view";
import { ProductionReportParams } from "@/components/report/production-report-params";
import { LotCardBody, ProductionMismatch, TraceBody, WipBalanceBody } from "@/components/report/production-reports";
import { requirePermission } from "@/lib/erp/auth";
import { lotCardReport, productionBooksReconcile, stationOptions, traceReport, wipBalanceReport } from "@/lib/erp/production-report";
import { reportBySlug, reportHref } from "@/lib/erp/reports";
import { formatDate } from "@/lib/format";

export const dynamic = "force-dynamic";

/**
 * Every Report View in the Produksi module (R18), driven by the catalogue like
 * the other modules': Saldo Produksi as of a date, Kartu Lot and Telusur for
 * one lot number. Parameters come from the query string (`asOf`, `stations=1,4`,
 * `q`); the figures from the ledgers.
 */
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ report: string }>;
  searchParams: Promise<{ q?: string; stations?: string; asOf?: string }>;
}) {
  const { report: slug } = await params;
  const report = reportBySlug(slug);
  if (!report || report.module !== "production") notFound();
  await requirePermission(report.permission, reportHref(slug));

  const query = await searchParams;
  const runAt = new Date().toISOString();
  const stationIds = idList(query.stations);
  const today = new Date().toISOString().slice(0, 10);
  const asOf = isDate(query.asOf) ? query.asOf : today;
  const text = (query.q ?? "").trim();
  const mode = report.params === "production-asof" ? "asof" : "lot";
  const stations = mode === "asof" ? await stationOptions() : [];
  const filter = <ProductionReportParams slug={slug} mode={mode} stations={stations} stationIds={stationIds} asOf={asOf} query={text} />;

  if (report.key === "wip_balance") {
    const [blocks, reconciles] = await Promise.all([wipBalanceReport(asOf, stationIds), productionBooksReconcile()]);
    return (
      <ReportView report={report} filter={filter} runAt={runAt} footnote={<>Saldo per {formatDate(asOf)} dari buku produksi; jumlah dalam satuan dasar barang, nilai dalam rupiah utuh.</>}>
        <WipBalanceBody blocks={blocks} asOf={asOf} />
        <ProductionMismatch show={!reconciles} />
      </ReportView>
    );
  }
  if (!text) {
    return (
      <ReportView report={report} filter={filter} runAt={runAt}>
        <ReportNeedsSubject icon="book" title="Isi nomor lot" body="Ketik nomornya di atas, lalu tekan Tampilkan." />
      </ReportView>
    );
  }
  if (report.key === "trace") {
    const trace = await traceReport(text);
    return (
      <ReportView report={report} filter={filter} runAt={runAt} footnote={<>Dibaca dari silsilah lot; jumlah dan nilai tiap langkah dari buku produksi.</>}>
        {trace ? <TraceBody report={trace} /> : <ReportNeedsSubject icon="tree" title="Lot tidak ditemukan" body={`Tidak ada lot bernomor ${text}.`} />}
      </ReportView>
    );
  }
  const cards = await lotCardReport(text);
  return (
    <ReportView report={report} filter={filter} runAt={runAt} footnote={<>Satu lot, satu register: sama di produksi dan di stok. Nomor lot unik per barang, jadi satu nomor bisa menunjuk lot beberapa barang.</>}>
      {cards.length ? <LotCardBody cards={cards} /> : <ReportNeedsSubject icon="book" title="Lot tidak ditemukan" body={`Tidak ada lot bernomor ${text}.`} />}
    </ReportView>
  );
}

function isDate(value: string | undefined): value is string {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)));
}

/** `1,4,9` → [1, 4, 9]; anything that is not a positive whole number is dropped. */
function idList(value: string | undefined): number[] {
  return [...new Set((value ?? "").split(",").map(Number).filter((n) => Number.isInteger(n) && n > 0))];
}
