"use client";

import { Fragment, useEffect, useState } from "react";
import Link from "next/link";
import { loadProductionCardEntries } from "@/app/actions/book-entries";
import { Icon } from "@/components/icon";
import { Drill } from "@/components/report/drill";
import { LazyRows, useLazyEntries } from "@/components/report/lazy-entries";
import { BlockHead, CountLine, ReportEmpty } from "@/components/report/report-blocks";
import { ReportSummary } from "@/components/report/report-summary";
import { Figure, expandOf, flip, qty, round6 } from "@/components/report/stock-card-reports";
import { documentHref } from "@/lib/erp/document-links";
import type { PeriodRange } from "@/lib/erp/period";
import type { ProductionCard, ProductionCardEntry, ProductionCardFilter, WipRow } from "@/lib/erp/production-report";
import type { BookCursor } from "@/lib/erp/register-query";
import { reportHref } from "@/lib/erp/reports";
import { formatDate } from "@/lib/format";

/**
 * Saldo Produksi and Kartu Produksi (P310): Saldo Stok and Kartu Stok with the
 * Unit as the warehouse and the stage as the location. Quantities only — the
 * Produksi application shows no prices (P275). A Unit and a partai total
 * nothing: their items are in different units.
 */

export type WipGroupBy = "unit" | "item" | "partai";
export type CardGroupBy = "unit" | "item" | "lot";

export const lotHref = (lotNo: string) => reportHref("production-card", { lots: lotNo });

function ItemCell({ item }: { item: { label: string; name: string } }) {
  return (
    <>
      <span className="lab">{item.label}</span> <span className="nm">{item.name}</span>
    </>
  );
}

// ----------------------------------------------------------- Saldo Produksi

/** The group a row belongs to; goods before their partai sort first. */
function groupOf(r: WipRow, by: WipGroupBy) {
  if (by === "unit") return r.unit;
  if (by === "item") return r.item;
  return r.partai ? { id: r.partai.id, label: r.partai.no, name: "" } : { id: 0, label: "Sebelum Partai", name: "" };
}

export function WipBalanceBody({ rows, groupBy, asOf }: { rows: WipRow[]; groupBy: WipGroupBy; asOf: string }) {
  const groups = new Map<number, { id: number; label: string; name: string; rows: WipRow[] }>();
  for (const r of rows) {
    const s = groupOf(r, groupBy);
    const g = groups.get(s.id) ?? { id: s.id, label: s.label, name: s.name, rows: [] };
    g.rows.push(r);
    groups.set(s.id, g);
  }
  const list = [...groups.values()].sort((a, b) => Number(a.id !== 0) - Number(b.id !== 0) || a.label.localeCompare(b.label));
  const [open, setOpen] = useState<Set<number>>(() => new Set(list.map((g) => g.id)));
  if (!rows.length) {
    return <ReportEmpty icon="layers" title="Tidak ada barang di produksi" body={`Pada ${formatDate(asOf)} tidak ada barang di produksi menurut filter ini.`} />;
  }
  const cardHref = (r: WipRow) =>
    reportHref("production-card", { group: groupBy === "item" ? "item" : "unit", units: r.unit.id, items: r.item.id, from: `${asOf.slice(0, 8)}01`, to: asOf });
  const noun = { unit: "unit", item: "barang", partai: "partai" }[groupBy];

  return (
    <>
      <CountLine count={list.length} noun={noun} when={`per ${formatDate(asOf)}`} expand={expandOf(list.map((g) => g.id), open, setOpen)} />
      {list.map((g) => (
        <div className="cblock" key={g.id}>
          <BlockHead
            label={g.label}
            open={open.has(g.id)}
            onToggle={() => setOpen(flip(open, g.id))}
            meta={[g.name, `${g.rows.length} baris`, groupBy === "item" ? g.rows[0].item.uomLabel : ""].filter(Boolean).join(" · ")}
          >
            <ReportSummary
              figures={[
                groupBy === "item"
                  ? { label: "Jumlah", value: qty(round6(g.rows.reduce((s, r) => s + r.qty, 0))), key: true }
                  : { label: "Barang", value: String(new Set(g.rows.map((r) => r.item.id)).size), key: true },
              ]}
            />
          </BlockHead>
          {open.has(g.id) && (
            <div className="tw">
              <table className="grid" style={{ minWidth: 940 }}>
                <thead>
                  <tr>
                    {groupBy !== "item" && <th>Barang</th>}
                    {groupBy !== "unit" && <th style={{ width: groupBy === "item" ? undefined : 90 }}>Unit</th>}
                    <th style={{ width: 170 }}>Tahap</th>
                    {groupBy !== "partai" && <th style={{ width: 140 }}>Partai</th>}
                    <th style={{ width: 170 }}>No. Job</th>
                    <th style={{ width: 180 }}>No. Stok</th>
                    <th className="num" style={{ width: 120 }}>Jumlah</th>
                  </tr>
                </thead>
                <tbody>
                  {g.rows.map((r) => (
                    <tr key={r.bucketId} style={{ cursor: "default" }}>
                      {groupBy !== "item" && (
                        <td>
                          <Drill href={cardHref(r)} title="Buka Kartu Produksi barang ini di Unit ini">
                            <ItemCell item={r.item} />
                          </Drill>
                        </td>
                      )}
                      {groupBy !== "unit" && (
                        <td>
                          {groupBy === "item" ? (
                            <Drill href={cardHref(r)} title="Buka Kartu Produksi barang ini di Unit ini">
                              <ItemCell item={r.unit} />
                            </Drill>
                          ) : (
                            <span className="lab">{r.unit.label}</span>
                          )}
                        </td>
                      )}
                      <td>
                        {r.stage}
                        {(r.qcReturn || r.auxiliary) && <span className="rsub">{r.qcReturn ? "Balik QC" : "Bahan Penolong"}</span>}
                      </td>
                      {groupBy !== "partai" && <td>{r.partai ? <span className="mono">{r.partai.no}</span> : <span className="dash">—</span>}</td>}
                      <td>{r.jobNo ? <span className="mono">{r.jobNo}</span> : <span className="dash">—</span>}</td>
                      <td>
                        <Link className="lab" href={lotHref(r.lotNo)} title="Buka Kartu Produksi No. Stok ini">
                          {r.lotNo}
                        </Link>
                      </td>
                      <td className="num">
                        <Figure n={r.qty} />
                        {groupBy !== "item" && <span className="cd"> {r.item.uomLabel}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ))}
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

export function ProductionCardBody({
  cards,
  truncated,
  groupBy,
  filter,
  range,
  stages,
}: {
  cards: ProductionCard[];
  truncated: boolean;
  groupBy: CardGroupBy;
  filter: ProductionCardFilter;
  range: PeriodRange;
  stages: boolean;
}) {
  const kind = groupBy === "lot" ? "lot" : "unit";
  const [open, setOpen] = useState<Set<string>>(() => new Set(cards.length === 1 ? [cards[0].key] : []));
  const lazy = useLazyEntries<ProductionCardEntry, BookCursor, string>((k, cursor) => {
    const [itemId, ofId] = k.split(":").map(Number);
    return loadProductionCardEntries(kind, { itemId, ofId }, filter, range.from, range.to, stages, cursor);
  });
  /** Opens these blocks, reading the first page of any not read yet. */
  const show = (next: Set<string>) => {
    setOpen(next);
    for (const c of cards) if (next.has(c.key) && c.entryCount > 0 && !lazy.get(c.key)) void lazy.more(c.key);
  };
  useEffect(() => {
    // One card has nothing to scan past: its movements open with the page.
    if (cards.length === 1 && cards[0].entryCount > 0) void lazy.more(cards[0].key);
    // Once per run: the page remounts this on a new run through its key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (!cards.length) return <ReportEmpty icon="layers" title="Tidak ada barang di produksi" body="Tidak ada saldo maupun mutasi untuk filter dan rentang tanggal ini." />;

  // No. Stok cards stand alone; the others sit under their Unit or their item.
  const groups = new Map<number, { id: number; label: string; name: string; cards: ProductionCard[] }>();
  for (const c of cards) {
    const s = groupBy === "unit" ? c.unit! : groupBy === "item" ? c.item : { id: 0, label: "", name: "" };
    const g = groups.get(s.id) ?? { id: s.id, label: s.label, name: s.name, cards: [] };
    g.cards.push(c);
    groups.set(s.id, g);
  }
  const list = [...groups.values()].sort((a, b) => a.label.localeCompare(b.label));
  const cols = 8;

  return (
    <>
      <CountLine
        count={cards.length}
        noun={kind === "lot" ? "No. Stok" : "kartu"}
        when={`${formatDate(range.from)} – ${formatDate(range.to)}`}
        expand={expandOf(cards.map((c) => c.key), open, show)}
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
      {list.map((g) => (
        <Fragment key={g.id}>
          {kind === "unit" && (
            <div className="rgrp">
              <b>{g.label}</b>
              <span>
                {g.name}
                {groupBy === "item" &&
                  g.cards.length > 1 &&
                  ` · saldo akhir ${qty(round6(g.cards.reduce((s, c) => s + c.closing, 0)))} ${g.cards[0].item.uomLabel}`}
              </span>
            </div>
          )}
          {g.cards.map((c) => {
            const head = groupBy === "lot" ? { label: c.lot!.no, name: `${c.item.label} ${c.item.name}` } : groupBy === "unit" ? c.item : c.unit!;
            const have = lazy.get(c.key);
            let running = c.opening;
            return (
              <div className="cblock" key={c.key}>
                <BlockHead label={head.label} open={open.has(c.key)} onToggle={() => show(flip(open, c.key))} meta={`${head.name} · ${c.entryCount} mutasi · ${c.item.uomLabel}`}>
                  <ReportSummary
                    figures={[
                      { label: "Saldo Awal", value: qty(c.opening), zero: !c.opening },
                      { label: "Masuk", value: qty(c.totalIn), zero: !c.totalIn },
                      { label: "Keluar", value: qty(c.totalOut), zero: !c.totalOut },
                      { label: "Saldo Akhir", value: qty(c.closing), key: true },
                    ]}
                  />
                </BlockHead>
                {open.has(c.key) && (
                  <>
                    {c.lot && (
                      <div className="rgrp" style={{ margin: "8px 14px" }}>
                        <span>
                          {[
                            `Asal ${c.lot.sourceNo}`,
                            c.lot.supplier && `supplier ${c.lot.supplier}`,
                            c.lot.expiry && `kadaluarsa ${formatDate(c.lot.expiry)}`,
                            `sekarang di ${c.lot.now.join("; ") || "luar produksi atau habis dipakai"}`,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                        <div className="tspace" />
                        <Link className="btn sm" href={reportHref("trace", { q: c.lot.no })}>
                          <Icon name="tree" size={14} /> Telusur
                        </Link>
                      </div>
                    )}
                    <div className="tw">
                      <table className="grid" style={{ minWidth: 940 }}>
                        <thead>
                          <tr>
                            <th style={{ width: 124 }}>Tanggal</th>
                            <th style={{ width: 176 }}>Dokumen</th>
                            <th>Keterangan</th>
                            <th style={{ width: kind === "lot" ? 110 : 160 }}>{kind === "lot" ? "Unit" : "No. Stok"}</th>
                            <th style={{ width: 160 }}>Partai / No. Job</th>
                            <th className="num" style={{ width: 80 }}>Masuk</th>
                            <th className="num" style={{ width: 80 }}>Keluar</th>
                            <th className="num" style={{ width: 88 }}>Saldo</th>
                          </tr>
                        </thead>
                        <tbody>
                          <tr className="totrow">
                            <td colSpan={cols - 1}>Saldo per {formatDate(range.from)}</td>
                            <td className="num"><Figure n={c.opening} /></td>
                          </tr>
                          {have?.entries.map((e) => {
                            running = round6(running + e.change);
                            return (
                              <tr key={e.id} style={{ cursor: "default" }}>
                                <td className="mono mut" style={{ fontSize: "11.5px" }}>
                                  <span className="dstack">
                                    <span>{formatDate(e.date)}</span>
                                    <span className="d2">{e.ledgerNo}</span>
                                  </span>
                                </td>
                                <td><Source s={e.source} /></td>
                                <td className="wrapok">
                                  {e.text}
                                  {stages && e.stages && <span className="rsub">{e.stages}</span>}
                                </td>
                                <td>
                                  {kind === "lot" ? (
                                    <span className="lab">{e.unitLabel}</span>
                                  ) : (
                                    <Link className="lab" href={lotHref(e.lotNo)} title="Buka Kartu Produksi No. Stok ini">
                                      {e.lotNo}
                                    </Link>
                                  )}
                                </td>
                                <td>
                                  {e.partaiNo || e.jobNo ? (
                                    <span className="dstack mono" style={{ fontSize: "11.5px" }}>
                                      {e.partaiNo && <span>{e.partaiNo}</span>}
                                      {e.jobNo && <span className="d2">{e.jobNo}</span>}
                                    </span>
                                  ) : (
                                    <span className="dash">—</span>
                                  )}
                                </td>
                                <td className="num"><Figure n={Math.max(e.change, 0)} /></td>
                                <td className="num"><Figure n={Math.max(-e.change, 0)} /></td>
                                <td className="num"><Figure n={running} /></td>
                              </tr>
                            );
                          })}
                          <LazyRows colSpan={cols} total={c.entryCount} have={have} onMore={() => void lazy.more(c.key)} />
                          {c.entryCount === 0 && (
                            <tr>
                              <td colSpan={cols} className="mut" style={{ textAlign: "center" }}>
                                Tidak ada mutasi pada rentang tanggal ini. Saldo akhir sama dengan saldo awal.
                              </td>
                            </tr>
                          )}
                        </tbody>
                        <tfoot>
                          <tr className="totrow">
                            <td colSpan={cols - 3}>Saldo per {formatDate(range.to)}</td>
                            <td className="num"><Figure n={c.totalIn} /></td>
                            <td className="num"><Figure n={c.totalOut} /></td>
                            <td className="num"><b><Figure n={c.closing} /></b></td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </Fragment>
      ))}
    </>
  );
}
