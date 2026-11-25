import { notFound, redirect } from "next/navigation";
import { ProductionCardBody, WipBalanceBody, type ProductionGroupBy } from "@/components/report/production-card-reports";
import { ProductionCardParams, TraceParams, WipBalanceParams } from "@/components/report/production-report-params";
import { ProductionMismatch, TraceBody } from "@/components/report/production-reports";
import { ReportNeedsSubject, ReportView } from "@/components/report/report-view";
import { requirePermission } from "@/lib/erp/auth";
import {
  partaiOptions,
  productionBooksReconcile,
  productionCardReport,
  productionItemOptions,
  productionLots,
  stationOptions,
  traceReport,
  wipBalanceReport,
} from "@/lib/erp/production-report";
import { parseIds, resolveRange } from "@/lib/erp/report-params";
import { reportBySlug, reportHref } from "@/lib/erp/reports";
import { formatDate } from "@/lib/format";

export const dynamic = "force-dynamic";

type Query = Record<"q" | "group" | "units" | "stations" | "items" | "partai" | "lots" | "aux" | "asOf" | "from" | "to", string | undefined>;

/**
 * Every Report View in the Produksi application (R18, P310), driven by the
 * catalogue like the other modules': Saldo Produksi as of a date, Kartu
 * Produksi over a period, Telusur for one No. Stok. Parameters come from the
 * query string; the figures from the ledger.
 */
export default async function Page({ params, searchParams }: { params: Promise<{ report: string }>; searchParams: Promise<Query> }) {
  const { report: slug } = await params;
  const query = await searchParams;
  // Kartu No. Stok is a part of Kartu Produksi since P315; its links still work.
  if (slug === "lot-card") redirect(reportHref("production-card", { lots: query.q?.trim() }));
  const report = reportBySlug(slug);
  if (!report || report.module !== "production") notFound();
  await requirePermission(report.permission, reportHref(slug));

  const runAt = new Date().toISOString();
  const today = runAt.slice(0, 10);
  // Each run is keyed on its URL, so its filter and blocks start from what was applied.
  const runKey = JSON.stringify(query);
  const unitIds = parseIds(query.units ?? query.stations);
  const itemIds = parseIds(query.items);
  // Per item or per Unit, nothing else: an old link's other grouping reads per Unit.
  const groupBy: ProductionGroupBy = query.group === "item" ? "item" : "unit";
  const groupHref = (group: ProductionGroupBy, more: Partial<Query> = {}) => reportHref(slug, { ...query, ...more, group });

  if (report.key === "wip_balance") {
    const asOf = resolveRange(query.asOf ?? today, query.asOf ?? today).to;
    const f = { unitIds, itemIds, partaiIds: parseIds(query.partai), auxiliary: query.aux === "1" };
    const [rows, reconciles, units, items, partai] = await Promise.all([
      wipBalanceReport(asOf, f),
      productionBooksReconcile(),
      stationOptions(),
      productionItemOptions(),
      partaiOptions(),
    ]);
    return (
      <ReportView
        report={report}
        runAt={runAt}
        filter={
          <WipBalanceParams
            key={runKey}
            groupBy={groupBy}
            groupHrefs={{ unit: groupHref("unit"), item: groupHref("item") }}
            units={units}
            items={items}
            partai={partai}
            initial={f}
            asOf={asOf}
          />
        }
        footnote={<>Saldo per {formatDate(asOf)} dari buku produksi; jumlah dalam satuan dasar barang. Barang Dalam Perjalanan dihitung di unit pengirim.</>}
      >
        <WipBalanceBody key={runKey} rows={rows} groupBy={groupBy} asOf={asOf} />
        <ProductionMismatch show={!reconciles} />
      </ReportView>
    );
  }

  if (report.key === "production_card") {
    const typed = (query.lots ?? "").split(",").map((l) => l.trim()).filter(Boolean);
    const lots = await productionLots(typed);
    // A chosen No. Stok reads its whole life, its moves included, unless the URL says otherwise.
    const firsts = lots.flatMap((l) => l.first ?? []).sort();
    const range = resolveRange(query.from ?? firsts[0], query.to ?? today);
    const kind = typed.length ? "lot" : groupBy;
    const f = { unitIds, itemIds, lotIds: lots.map((l) => l.id) };
    // Numbers that name nothing must read nothing, not everything.
    const none = typed.length > 0 && !lots.length;
    const [units, items, data, reconciles] = await Promise.all([
      stationOptions(),
      productionItemOptions(),
      none ? { cards: [], truncated: false } : productionCardReport(kind, f, range),
      productionBooksReconcile(),
    ]);
    return (
      <ReportView
        report={report}
        runAt={runAt}
        filter={
          <ProductionCardParams
            key={runKey}
            groupBy={groupBy}
            // A No. Stok reads its own journey, whatever the grouping: the toggle leaves it.
            groupHrefs={{ unit: groupHref("unit", { lots: undefined }), item: groupHref("item", { lots: undefined }) }}
            units={units}
            items={items}
            initial={{ unitIds, itemIds }}
            lots={lots.map((l) => l.no)}
            from={range.from}
            to={range.to}
          />
        }
        footnote={<>Jumlah dalam satuan dasar barang. Masuk dan Keluar hanya yang melintasi batas unit; perpindahan tahap terbaca di kolom tahapnya. Bahan penolong tidak ikut jumlah unit.</>}
      >
        <ProductionCardBody key={runKey} cards={data.cards} truncated={data.truncated} kind={kind} filter={f} range={range} />
        <ProductionMismatch show={!reconciles} />
      </ReportView>
    );
  }

  const text = (query.q ?? "").trim();
  const trace = text ? await traceReport(text) : null;
  return (
    <ReportView
      report={report}
      filter={<TraceParams key={runKey} query={text} />}
      runAt={runAt}
      footnote={text ? <>Dibaca dari silsilah No. Stok; jumlah tiap langkah dari buku produksi.</> : undefined}
    >
      {trace ? (
        <TraceBody report={trace} />
      ) : text ? (
        <ReportNeedsSubject icon="tree" title="No. Stok tidak ditemukan" body={`Tidak ada No. Stok ${text}.`} />
      ) : (
        <ReportNeedsSubject icon="book" title="Isi No. Stok" body="Ketik nomornya di atas, lalu tekan Tampilkan." />
      )}
    </ReportView>
  );
}
