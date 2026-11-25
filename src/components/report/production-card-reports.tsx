"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { loadProductionCardEntries } from "@/app/actions/book-entries";
import { Icon } from "@/components/icon";
import { Drill } from "@/components/report/drill";
import { LazyRows, useLazyEntries } from "@/components/report/lazy-entries";
import { BlockHead, CountLine, ReportEmpty } from "@/components/report/report-blocks";
import { ReportSummary, type ReportFigure } from "@/components/report/report-summary";
import { Figure, expandOf, flip, qty, round6 } from "@/components/report/stock-card-reports";
import { documentHref } from "@/lib/erp/document-links";
import type { PeriodRange } from "@/lib/erp/period";
import type { ProductionCard, ProductionCardEntry, ProductionCardFilter, ProductionCardKind, ProductionFigures, ProductionStage, WipRow } from "@/lib/erp/production-report";
import { ENTRY_PAGE_SIZE, type BookCursor } from "@/lib/erp/register-query";
import { reportHref } from "@/lib/erp/reports";
import { formatDate } from "@/lib/format";

/**
 * Saldo Produksi and Kartu Produksi in two levels, never more: a block per item
 * or per Unit and its rows. The stage is a column each, the Unit step, partai,
 * job and No. Stok columns beside them, and a block's figures speak of its own
 * subject only. Quantities only — the Produksi application shows no prices
 * (P275). A Unit adds its goods up within one unit of measure: production's own
 * exception to P135, without which a document's susut cannot be said.
 */

export type ProductionGroupBy = "item" | "unit";

export const lotHref = (lotNo: string) => reportHref("production-card", { lots: lotNo });

const STAGES: { key: ProductionStage; name: string }[] = [
  { key: "Preparation", name: "Persiapan" },
  { key: "Working", name: "Dikerjakan" },
  { key: "QcCheck", name: "QC" },
  { key: "StandBy", name: "Stand By" },
  { key: "InTransit", name: "Dalam Perjalanan" },
];
const sumOf = <T,>(rows: T[], f: (r: T) => number) => round6(rows.reduce((s, r) => s + f(r), 0));
const Mono = ({ text }: { text: string | null }) => (text ? <span className="mono">{text}</span> : <span className="dash">—</span>);

// ----------------------------------------------------------- Saldo Produksi

/** The stages of one No. Stok that share every other column stand on one row. */
function pivot(rows: WipRow[]): WipRow[][] {
  const at = new Map<string, WipRow[]>();
  for (const r of rows) {
    const k = [r.unit.id, r.item.id, r.lotNo, r.partai?.id, r.jobNo, r.qcReturn, r.auxiliary, r.process, r.to].join("|");
    at.set(k, [...(at.get(k) ?? []), r]);
  }
  return [...at.values()];
}

export function WipBalanceBody({ rows, groupBy, asOf }: { rows: WipRow[]; groupBy: ProductionGroupBy; asOf: string }) {
  const isUnit = groupBy === "unit";
  const groups = new Map<number, { id: number; label: string; name: string; rows: WipRow[] }>();
  for (const r of rows) {
    const s = isUnit ? r.unit : r.item;
    const g = groups.get(s.id) ?? { id: s.id, label: s.label, name: s.name, rows: [] };
    g.rows.push(r);
    groups.set(s.id, g);
  }
  // Units keep the order goods pass them, as the server sorted the rows.
  const list = isUnit ? [...groups.values()] : [...groups.values()].sort((a, b) => a.label.localeCompare(b.label));
  const [open, setOpen] = useState<Set<number>>(() => new Set(list.map((g) => g.id)));
  // shortcut: every row of the date reaches the browser and is drawn a page at a time; page it on the server when a Unit holds tens of thousands of pieces.
  const [shown, setShown] = useState<Record<number, number>>({});
  if (!rows.length) {
    return <ReportEmpty icon="layers" title="Tidak ada barang di produksi" body={`Pada ${formatDate(asOf)} tidak ada barang di produksi menurut filter ini.`} />;
  }
  const cardHref = (r: WipRow) => reportHref("production-card", { group: groupBy, units: r.unit.id, items: r.item.id, from: `${asOf.slice(0, 8)}01`, to: asOf });
  // One set of columns for every block.
  const stages = STAGES.filter((st) => rows.some((r) => r.stage === st.key));
  const travels = rows.some((r) => r.to);
  const marked = rows.some((r) => r.qcReturn || r.auxiliary);
  // A column no row fills is left out.
  const inPartai = rows.some((r) => r.partai);
  const inJob = rows.some((r) => r.jobNo);
  const lead = 3 + [inPartai, inJob, marked].filter(Boolean).length;

  return (
    <>
      <CountLine count={list.length} noun={isUnit ? "unit" : "barang"} when={`per ${formatDate(asOf)}`} expand={expandOf(list.map((g) => g.id), open, setOpen)} />
      {list.map((g) => {
        const goods = g.rows.filter((r) => !r.auxiliary || !isUnit);
        const uoms = [...new Set(goods.map((r) => r.item.uomLabel))];
        const lines = pivot(g.rows);
        const limit = shown[g.id] ?? ENTRY_PAGE_SIZE;
        const figures: ReportFigure[] = [
          ...(isUnit ? [{ label: "Barang", value: String(new Set(goods.map((r) => r.item.id)).size) }] : []),
          ...uoms.map((u) => ({ label: `Jumlah ${u}`, value: qty(sumOf(goods.filter((r) => r.item.uomLabel === u), (r) => r.qty)), key: true })),
        ];
        return (
          <div className="cblock" key={g.id}>
            <BlockHead label={g.label} open={open.has(g.id)} onToggle={() => setOpen(flip(open, g.id))} meta={`${g.name} · ${new Set(g.rows.map((r) => r.lotNo)).size} No. Stok`}>
              <ReportSummary figures={figures} />
            </BlockHead>
            {open.has(g.id) && (
              <div className="tw">
                <table className="grid" style={{ minWidth: 900 }}>
                  <thead>
                    <tr>
                      <th>{isUnit ? "Barang" : "Unit"}</th>
                      <th style={{ width: 180 }}>No. Stok</th>
                      <th style={{ width: 90 }}>Proses</th>
                      {inPartai && <th style={{ width: 130 }}>Partai</th>}
                      {inJob && <th style={{ width: 150 }}>No. Job</th>}
                      {marked && <th style={{ width: 120 }}>Tanda</th>}
                      {stages.map((st) => (
                        <th key={st.key} className="num" style={{ width: 88 }}>{st.name}</th>
                      ))}
                      {travels && <th style={{ width: 100 }}>Tujuan</th>}
                      <th className="num" style={{ width: 90 }}>Jumlah</th>
                      <th style={{ width: 66 }}>Satuan</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lines.slice(0, limit).map((line) => {
                      const r = line[0];
                      const s = isUnit ? r.item : r.unit;
                      return (
                        <tr key={r.bucketId} style={{ cursor: "default" }}>
                          <td>
                            <Drill href={cardHref(r)} title="Buka Kartu Produksi barang ini di unit ini">
                              <span className="lab">{s.label}</span> <span className="nm">{s.name}</span>
                            </Drill>
                          </td>
                          <td>
                            <Link className="lab" href={lotHref(r.lotNo)} title="Buka Kartu Produksi No. Stok ini">
                              {r.lotNo}
                            </Link>
                          </td>
                          <td>{r.process ?? <span className="dash">—</span>}</td>
                          {inPartai && <td><Mono text={r.partai?.no ?? null} /></td>}
                          {inJob && <td><Mono text={r.jobNo} /></td>}
                          {marked && (
                            <td>{r.qcReturn ? <span className="bdg s-warn">Balik QC</span> : r.auxiliary ? <span className="bdg s-mute">Bahan Penolong</span> : null}</td>
                          )}
                          {stages.map((st) => (
                            <td key={st.key} className="num"><Figure n={sumOf(line.filter((x) => x.stage === st.key), (x) => x.qty)} /></td>
                          ))}
                          {travels && <td>{r.to ? <span className="lab">{r.to}</span> : <span className="dash">—</span>}</td>}
                          <td className="num"><b><Figure n={sumOf(line, (x) => x.qty)} /></b></td>
                          <td><span className="lab">{r.item.uomLabel}</span></td>
                        </tr>
                      );
                    })}
                    {lines.length > limit && (
                      <tr>
                        <td colSpan={lead + stages.length + (travels ? 3 : 2)} style={{ textAlign: "center" }}>
                          <button type="button" className="btn sm" onClick={() => setShown({ ...shown, [g.id]: limit + ENTRY_PAGE_SIZE })}>
                            Tampilkan {Math.min(ENTRY_PAGE_SIZE, lines.length - limit)} baris berikutnya ({lines.length - limit} tersisa)
                          </button>
                        </td>
                      </tr>
                    )}
                  </tbody>
                  <tfoot>
                    {uoms.map((u) => {
                      const of = goods.filter((r) => r.item.uomLabel === u);
                      return (
                        <tr className="totrow" key={u}>
                          <td colSpan={lead}>Jumlah</td>
                          {stages.map((st) => (
                            <td key={st.key} className="num"><Figure n={sumOf(of.filter((r) => r.stage === st.key), (r) => r.qty)} /></td>
                          ))}
                          {travels && <td />}
                          <td className="num"><b><Figure n={sumOf(of, (r) => r.qty)} /></b></td>
                          <td><span className="lab">{u}</span></td>
                        </tr>
                      );
                    })}
                  </tfoot>
                </table>
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}

// ---------------------------------------------------------- Kartu Produksi

function Source({ s }: { s: ProductionCardEntry["source"] }) {
  // Only documents of this application: a floor user has no ERP to open the others in.
  const href = documentHref(s.table, s.id);
  return href?.startsWith("/production/") ? (
    <Link className="lab" href={href} title="Buka dokumen">
      {s.no}
    </Link>
  ) : (
    <span className="lab">{s.no}</span>
  );
}

/** Into a stage is green with its sign; out of it is in brackets. */
function Move({ n }: { n: number }) {
  if (!n) return null;
  return <span className={`mny${n > 0 ? " in" : ""}`}>{n > 0 ? `+${qty(n)}` : qty(n)}</span>;
}

/** A block's headline figures. A Unit says what crossed its border; an item or a No. Stok only where it stands, since a move between Units would count on both sides. */
function headline(kind: ProductionCardKind, all: ProductionFigures[]): ReportFigure[] {
  return all.flatMap((x) => {
    const of = (label: string) => (all.length > 1 ? `${label} ${x.uomLabel}` : label);
    const closing = { label: of("Saldo Akhir"), value: qty(x.closing), key: true };
    const opening = { label: of("Saldo Awal"), value: qty(x.opening), zero: !x.opening };
    if (kind !== "unit") return [opening, closing];
    return [
      opening,
      { label: of("Masuk"), value: qty(x.totalIn), zero: !x.totalIn },
      { label: of("Keluar"), value: qty(x.totalOut), zero: !x.totalOut },
      ...(x.shrinkage === null
        ? [{ label: of("Hasil − Pakai"), value: qty(x.worked), zero: !x.worked }]
        : [
            { label: of("Susut"), value: qty(x.shrinkage), zero: !x.shrinkage },
            ...(x.converted ? [{ label: of("Ubah Satuan"), value: qty(x.converted) }] : []),
          ]),
      closing,
    ];
  });
}

export function ProductionCardBody({
  cards,
  truncated,
  kind,
  filter,
  range,
}: {
  cards: ProductionCard[];
  truncated: boolean;
  kind: ProductionCardKind;
  filter: ProductionCardFilter;
  range: PeriodRange;
}) {
  const [open, setOpen] = useState<Set<number>>(() => new Set(cards.length === 1 ? [cards[0].id] : []));
  const lazy = useLazyEntries<ProductionCardEntry, BookCursor, number>((id, cursor) => loadProductionCardEntries(kind, id, filter, range.from, range.to, cursor));
  /** Opens these blocks, reading the first page of any not read yet. */
  const show = (next: Set<number>) => {
    setOpen(next);
    for (const c of cards) if (next.has(c.id) && c.entryCount > 0 && !lazy.get(c.id)) void lazy.more(c.id);
  };
  useEffect(() => {
    // One block has nothing to scan past: its rows open with the page.
    if (cards.length === 1 && cards[0].entryCount > 0) void lazy.more(cards[0].id);
    // Once per run: the page remounts this on a new run through its key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (!cards.length) return <ReportEmpty icon="layers" title="Tidak ada barang di produksi" body="Tidak ada saldo maupun mutasi untuk filter dan rentang tanggal ini." />;

  return (
    <>
      <CountLine
        count={cards.length}
        noun={{ unit: "unit", item: "barang", lot: "No. Stok" }[kind]}
        when={`${formatDate(range.from)} – ${formatDate(range.to)}`}
        expand={expandOf(cards.map((c) => c.id), open, show)}
      />
      {truncated && (
        <div className="nbox warn slim">
          <span className="ni">
            <Icon name="warn" size={14} />
          </span>
          <div>
            <b>Hanya {cards.length} No. Stok pertama yang ditampilkan.</b> Persempit dengan No. Stok, Barang atau Unit.
          </div>
        </div>
      )}
      {cards.map((c) => (
        <div className="cblock" key={c.id}>
          <BlockHead
            label={c.label}
            open={open.has(c.id)}
            onToggle={() => show(flip(open, c.id))}
            meta={[
              c.name,
              `${c.entryCount} baris`,
              c.figures.length === 1 && c.figures[0].uomLabel,
              c.lot && `asal ${c.lot.sourceNo}`,
              c.lot?.supplier && `supplier ${c.lot.supplier}`,
              c.lot?.expiry && `kadaluarsa ${formatDate(c.lot.expiry)}`,
              c.lot && `sekarang di ${c.lot.now.join("; ") || "luar produksi atau habis dipakai"}`,
            ]
              .filter(Boolean)
              .join(" · ")}
          >
            <ReportSummary figures={headline(kind, c.figures)} />
          </BlockHead>
          {open.has(c.id) && (
            <div className="tw">
              <CardTable card={c} kind={kind} range={range} have={lazy.get(c.id)} onMore={() => void lazy.more(c.id)} />
            </div>
          )}
        </div>
      ))}
    </>
  );
}

function CardTable({
  card: c,
  kind,
  range,
  have,
  onMore,
}: {
  card: ProductionCard;
  kind: ProductionCardKind;
  range: PeriodRange;
  have: React.ComponentProps<typeof LazyRows<ProductionCardEntry, BookCursor>>["have"];
  onMore: () => void;
}) {
  const entries = have?.entries ?? [];
  const stages = STAGES.filter((st) => c.figures.some((x) => x.stageOpening[st.key] || x.stageClosing[st.key]) || entries.some((e) => e.stages[st.key]));
  const shrinks = c.figures.some((x) => x.shrinkage !== null);
  const uoms = new Set([...c.figures.map((x) => x.uomLabel), ...entries.map((e) => e.uomLabel)]);
  const manyUoms = uoms.size > 1;
  // A column no row fills is left out.
  const inPartai = entries.some((e) => e.partaiNo);
  const inJob = entries.some((e) => e.jobNo);
  const lead = 6 + [inPartai, inJob].filter(Boolean).length;
  const cols = lead + stages.length + 2 + (shrinks ? 1 : 0) + (manyUoms ? 1 : 0);
  return (
    <>
      <table className="grid" style={{ minWidth: 940 }}>
        <thead>
          <tr>
            <th style={{ width: 84 }}>Tanggal</th>
            <th style={{ width: 160 }}>Dokumen</th>
            <th>Keterangan</th>
            <th style={{ width: 84 }}>{kind === "unit" ? "Barang" : "Unit"}</th>
            <th style={{ width: 160 }}>{kind === "lot" ? "Barang" : "No. Stok"}</th>
            <th style={{ width: 84 }}>Proses</th>
            {inPartai && <th style={{ width: 120 }}>Partai</th>}
            {inJob && <th style={{ width: 130 }}>No. Job</th>}
            {stages.map((st) => (
              <th key={st.key} className="num" style={{ width: 80 }}>{st.name}</th>
            ))}
            <th className="num" style={{ width: 72 }}>Masuk</th>
            <th className="num" style={{ width: 72 }}>Keluar</th>
            {shrinks && <th className="num" style={{ width: 64 }}>Susut</th>}
            {manyUoms && <th style={{ width: 60 }}>Satuan</th>}
          </tr>
        </thead>
        <tbody>
          {c.figures.map((x) => (
            <tr className="totrow" key={x.uomLabel}>
              <td colSpan={lead}>Saldo per {formatDate(range.from)}</td>
              {stages.map((st) => (
                <td key={st.key} className="num"><Figure n={x.stageOpening[st.key]} /></td>
              ))}
              <td colSpan={2 + (shrinks ? 1 : 0)} />
              {manyUoms && <td><span className="lab">{x.uomLabel}</span></td>}
            </tr>
          ))}
          {entries.map((e) => (
            <tr key={e.id} style={{ cursor: "default" }}>
              <td className="mono mut" style={{ fontSize: "11.5px" }}>{formatDate(e.date)}</td>
              <td><Source s={e.source} /></td>
              <td>{e.auxiliary ? `${e.text} · bahan penolong` : e.text}</td>
              <td><span className="lab">{kind === "unit" ? e.itemLabel : e.unitLabel}</span></td>
              <td>
                {kind === "lot" ? (
                  <span className="lab">{e.itemLabel}</span>
                ) : (
                  <Link className="lab" href={lotHref(e.lotNo)} title="Buka Kartu Produksi No. Stok ini">
                    {e.lotNo}
                  </Link>
                )}
              </td>
              <td>{e.process || <span className="dash">—</span>}</td>
              {inPartai && <td><Mono text={e.partaiNo} /></td>}
              {inJob && <td><Mono text={e.jobNo} /></td>}
              {stages.map((st) => (
                <td key={st.key} className="num"><Move n={e.stages[st.key]} /></td>
              ))}
              <td className="num">{e.crossed > 0 && <Figure n={e.crossed} />}</td>
              <td className="num">{e.crossed < 0 && <Figure n={-e.crossed} />}</td>
              {shrinks && <td className="num">{e.shrinkage !== null && <span className="mny">{e.shrinkage ? qty(e.shrinkage) : "0"}</span>}</td>}
              {manyUoms && <td><span className="lab">{e.uomLabel}</span></td>}
            </tr>
          ))}
          <LazyRows colSpan={cols} total={c.entryCount} have={have} onMore={onMore} />
          {c.entryCount === 0 && (
            <tr>
              <td colSpan={cols} className="mut" style={{ textAlign: "center" }}>
                Tidak ada mutasi pada rentang tanggal ini. Saldo akhir sama dengan saldo awal.
              </td>
            </tr>
          )}
        </tbody>
        <tfoot>
          {c.figures.map((x) => (
            <tr className="totrow" key={x.uomLabel}>
              <td colSpan={lead}>Saldo per {formatDate(range.to)}</td>
              {stages.map((st) => (
                <td key={st.key} className="num"><Figure n={x.stageClosing[st.key]} /></td>
              ))}
              <td className="num"><Figure n={x.totalIn} /></td>
              <td className="num"><Figure n={x.totalOut} /></td>
              {shrinks && <td className="num"><Figure n={x.shrinkage ?? 0} /></td>}
              {manyUoms && <td><span className="lab">{x.uomLabel}</span></td>}
            </tr>
          ))}
        </tfoot>
      </table>
      {c.lot && (
        <div className="rrow" style={{ padding: "8px 11px" }}>
          <Link className="btn sm" href={reportHref("trace", { q: c.label })}>
            <Icon name="tree" size={14} /> Telusur
          </Link>
        </div>
      )}
    </>
  );
}
