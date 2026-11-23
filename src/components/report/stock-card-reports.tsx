"use client";

import { Fragment, useEffect, useState } from "react";
import Link from "next/link";
import { loadStockCardEntries } from "@/app/actions/book-entries";
import { BlockHead, CountLine, ReportEmpty } from "@/components/report/report-blocks";
import { Drill } from "@/components/report/drill";
import { LazyRows, useLazyEntries } from "@/components/report/lazy-entries";
import { ReportSummary } from "@/components/report/report-summary";
import { documentHref } from "@/lib/erp/document-links";
import type { PeriodRange } from "@/lib/erp/period";
import type { BookCursor } from "@/lib/erp/register-query";
import { reportHref } from "@/lib/erp/reports";
import type {
  StockCard,
  StockGroupBy,
  StockItemRef,
  StockLedgerEntry,
  StockPosition,
  StockSourceRef,
  StockWarehouseRef,
} from "@/lib/erp/stock-report";
import { formatDate, formatNumber } from "@/lib/format";

/**
 * Kartu Stok and Saldo Stok, grouped per item (*where is this item?*) or per
 * warehouse (*what does this warehouse hold?*), in the subject books' blocks
 * (Buku Piutang) with one level of folding. Kartu Stok is a block per item ×
 * warehouse, its movements read when it is opened; Saldo Stok a block per item
 * or warehouse, a row per bucket.
 *
 * A warehouse totals nothing: its items are in different units, so the count of
 * items is its summary.
 */

const qty = (n: number) => {
  const text = formatNumber(Math.abs(n), Number.isInteger(n) ? 0 : 4);
  return n === 0 ? "—" : n < 0 ? `(${text})` : text;
};
/** A quantity holds six decimals; adding them as numbers must not leave a tail. */
const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

type Subjects = { item: StockItemRef; warehouse: StockWarehouseRef };
const cardKey = (c: Subjects) => `${c.item.id}:${c.warehouse.id}`;

type Group<T> = { id: number; label: string; name: string; cards: T[] };

/** The groups in label order, each card once; the server already sorts cards by item, then warehouse. */
function groupCards<T extends Subjects>(cards: T[], by: StockGroupBy): Group<T>[] {
  const groups = new Map<number, Group<T>>();
  for (const c of cards) {
    const s = by === "item" ? c.item : c.warehouse;
    let g = groups.get(s.id);
    if (!g) groups.set(s.id, (g = { id: s.id, label: s.label, name: s.name, cards: [] }));
    g.cards.push(c);
  }
  const list = [...groups.values()];
  if (by === "warehouse") list.sort((a, b) => a.label.localeCompare(b.label));
  return list;
}

function flip<K>(set: Set<K>, k: K) {
  const next = new Set(set);
  if (!next.delete(k)) next.add(k);
  return next;
}

/** Buka / Tutup Semua over a report's blocks, when there is more than one. */
function expandOf<K>(keys: K[], open: Set<K>, show: (next: Set<K>) => void) {
  if (keys.length < 2) return undefined;
  return { onExpand: () => show(new Set(keys)), onCollapse: () => show(new Set()), allOpen: open.size === keys.length, allClosed: open.size === 0 };
}

function Lot({ lotNo, statusName }: { lotNo: string; statusName: string }) {
  return (
    <>
      <span className="lab">{lotNo}</span>
      {/* Status is worth a word only when the lot is not simply available. */}
      {statusName && statusName !== "Tersedia" && <span className="rsub">{statusName}</span>}
    </>
  );
}

/** The location's own label, `—` where the warehouse keeps none. */
function Location({ label, name }: { label: string | null; name: string | null }) {
  if (!label) return <span className="dash">—</span>;
  return (
    <>
      <span className="lab">{label}</span>
      {name && <span className="rsub">{name}</span>}
    </>
  );
}

function Source({ s }: { s: StockSourceRef }) {
  const href = documentHref(s.table, s.id);
  return href ? (
    <Link className="lab" href={href} title={`Buka ${s.docName}`}>
      {s.no}
    </Link>
  ) : (
    <span className="lab">{s.no}</span>
  );
}

const Figure = ({ n }: { n: number }) => (n ? <span className="mny">{qty(n)}</span> : <span className="dash">—</span>);

const Empty = ({ body }: { body: string }) => <ReportEmpty icon="layers" title="Tidak ada stok" body={body} />;

// ----------------------------------------------------------- Saldo Stok

export function StockBalanceBody({ positions, groupBy, asOf }: { positions: StockPosition[]; groupBy: StockGroupBy; asOf: string }) {
  const groups = groupCards(positions, groupBy);
  const [open, setOpen] = useState<Set<number>>(() => new Set(groups.map((g) => g.id)));
  if (!positions.length) return <Empty body="Tidak ada barang dengan saldo pada tanggal dan filter ini." />;

  // A position opens its Kartu Stok over its month to date, so the reader sees how it came to be.
  const ledgerHref = (p: StockPosition) =>
    reportHref("stock-ledger", { items: p.item.id, warehouses: p.warehouse.id, group: groupBy, from: `${asOf.slice(0, 8)}01`, to: asOf });

  return (
    <>
      <CountLine
        count={groups.length}
        noun={groupBy === "item" ? "barang" : "gudang"}
        when={`per ${formatDate(asOf)}`}
        expand={expandOf(groups.map((g) => g.id), open, setOpen)}
      />
      {groups.map((g) => {
        const isOpen = open.has(g.id);
        const rows = g.cards.reduce((s, c) => s + c.lots.length, 0);
        return (
          <div className="cblock" key={g.id}>
            <BlockHead
              label={g.label}
              open={isOpen}
              onToggle={() => setOpen(flip(open, g.id))}
              meta={`${g.name} · ${rows} baris${groupBy === "item" ? ` · ${g.cards[0].item.uomLabel}` : ""}`}
            >
              <ReportSummary
                figures={[
                  groupBy === "item"
                    ? { label: "Jumlah", value: qty(round6(g.cards.reduce((s, c) => s + c.qty, 0))), key: true }
                    : { label: "Barang", value: String(g.cards.length), key: true },
                ]}
              />
            </BlockHead>
            {isOpen && (
              <div className="tw">
                <table className="grid" style={{ minWidth: 860 }}>
                  <thead>
                    <tr>
                      <th>{groupBy === "item" ? "Gudang" : "Barang"}</th>
                      <th style={{ width: 160 }}>Lokasi</th>
                      <th style={{ width: 220 }}>Lot</th>
                      <th style={{ width: 120 }}>Kadaluarsa</th>
                      <th className="num" style={{ width: 150 }}>Jumlah</th>
                    </tr>
                  </thead>
                  <tbody>
                    {g.cards.flatMap((p) => {
                      const s = groupBy === "item" ? p.warehouse : p.item;
                      return p.lots.map((l, i) => (
                        <tr key={`${cardKey(p)}-${i}`} style={{ cursor: "default" }}>
                          <td>
                            <Drill href={ledgerHref(p)} title="Buka Kartu Stok barang ini di gudang ini">
                              <span className="lab">{s.label}</span> <span className="nm">{s.name}</span>
                            </Drill>
                          </td>
                          <td>
                            <Location label={l.locationLabel} name={l.locationName} />
                          </td>
                          <td>
                            <Lot {...l} />
                          </td>
                          <td>{l.expiry ? <span className="mono">{formatDate(l.expiry)}</span> : <span className="dash">—</span>}</td>
                          <td className="num">
                            <Figure n={l.qty} />
                            {groupBy === "warehouse" && <span className="cd"> {p.item.uomLabel}</span>}
                          </td>
                        </tr>
                      ));
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}

// ---------------------------------------------------------- Kartu Stok

export function StockLedgerBody({ cards, groupBy, range, lotNos }: { cards: StockCard[]; groupBy: StockGroupBy; range: PeriodRange; lotNos: string[] }) {
  const [open, setOpen] = useState<Set<string>>(() => new Set(cards.length === 1 ? [cardKey(cards[0])] : []));
  const lazy = useLazyEntries<StockLedgerEntry, BookCursor, string>((k, cursor) => {
    const [itemId, warehouseId] = k.split(":").map(Number);
    return loadStockCardEntries(itemId, warehouseId, range.from, range.to, lotNos, cursor);
  });
  /** Opens these blocks, reading the first page of any not read yet. */
  const show = (next: Set<string>) => {
    setOpen(next);
    for (const c of cards) {
      const k = cardKey(c);
      if (next.has(k) && c.entryCount > 0 && !lazy.get(k)) void lazy.more(k);
    }
  };
  useEffect(() => {
    // One card has nothing to scan past: its movements open with the page.
    if (cards.length === 1 && cards[0].entryCount > 0) void lazy.more(cardKey(cards[0]));
    // Once per run: the page remounts this on a new run through its key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (!cards.length) return <Empty body="Tidak ada saldo maupun mutasi untuk filter dan rentang tanggal ini." />;

  return (
    <>
      <CountLine
        count={cards.length}
        noun="kartu"
        when={`${formatDate(range.from)} – ${formatDate(range.to)}`}
        expand={expandOf(cards.map(cardKey), open, show)}
      />
      {groupCards(cards, groupBy).map((g) => (
        <Fragment key={g.id}>
          <div className="rgrp">
            <b>{g.label}</b>
            <span>
              {g.name}
              {groupBy === "item" &&
                g.cards.length > 1 &&
                ` · saldo akhir ${qty(round6(g.cards.reduce((s, c) => s + c.closing, 0)))} ${g.cards[0].item.uomLabel}`}
            </span>
          </div>
          {g.cards.map((c) => {
            const k = cardKey(c);
            const s = groupBy === "item" ? c.warehouse : c.item;
            const have = lazy.get(k);
            let running = c.opening;
            return (
              <div className="cblock" key={k}>
                <BlockHead label={s.label} open={open.has(k)} onToggle={() => show(flip(open, k))} meta={`${s.name} · ${c.entryCount} mutasi · ${c.item.uomLabel}`}>
                  <ReportSummary
                    figures={[
                      { label: "Saldo Awal", value: qty(c.opening), zero: !c.opening },
                      { label: "Masuk", value: qty(c.totalIn), zero: !c.totalIn },
                      { label: "Keluar", value: qty(c.totalOut), zero: !c.totalOut },
                      { label: "Saldo Akhir", value: qty(c.closing), key: true },
                    ]}
                  />
                </BlockHead>
                {open.has(k) && (
                  <div className="tw">
                    <table className="grid" style={{ minWidth: 940 }}>
                      <thead>
                        <tr>
                          <th style={{ width: 124 }}>Tanggal</th>
                          <th style={{ width: 156 }}>Dokumen</th>
                          <th>Keterangan</th>
                          <th style={{ width: 84 }}>Lokasi</th>
                          <th style={{ width: 176 }}>Lot</th>
                          <th className="num" style={{ width: 86 }}>Masuk</th>
                          <th className="num" style={{ width: 86 }}>Keluar</th>
                          <th className="num" style={{ width: 94 }}>Saldo</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr className="totrow">
                          <td colSpan={7}>Saldo per {formatDate(range.from)}</td>
                          <td className="num"><Figure n={c.opening} /></td>
                        </tr>
                        {have?.entries.map((e) => {
                          running = round6(running + e.change);
                          return (
                            <tr key={e.id} style={{ cursor: "default" }}>
                              <td className="mono mut" style={{ fontSize: "11.5px" }}>
                                <span className="dstack">
                                  <span>{formatDate(e.date)}</span>
                                  <span className="d2">{e.ledgerNo}·{e.lineNo}</span>
                                </span>
                              </td>
                              <td><Source s={e.source} /></td>
                              <td className="pri wrapok">{e.source.docName}</td>
                              <td><Location label={e.locationLabel} name={e.locationName} /></td>
                              <td>
                                <Lot {...e} />
                                {e.expiry && <span className="rsub">ED {formatDate(e.expiry)}</span>}
                              </td>
                              <td className="num"><Figure n={Math.max(e.change, 0)} /></td>
                              <td className="num"><Figure n={Math.max(-e.change, 0)} /></td>
                              <td className="num"><Figure n={running} /></td>
                            </tr>
                          );
                        })}
                        <LazyRows colSpan={8} total={c.entryCount} have={have} onMore={() => void lazy.more(k)} />
                        {c.entryCount === 0 && (
                          <tr>
                            <td colSpan={8} className="mut" style={{ textAlign: "center" }}>
                              Tidak ada mutasi pada rentang tanggal ini. Saldo akhir sama dengan saldo awal.
                            </td>
                          </tr>
                        )}
                      </tbody>
                      <tfoot>
                        <tr className="totrow">
                          <td colSpan={5}>Saldo per {formatDate(range.to)}</td>
                          <td className="num"><Figure n={c.totalIn} /></td>
                          <td className="num"><Figure n={c.totalOut} /></td>
                          <td className="num"><b><Figure n={c.closing} /></b></td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
        </Fragment>
      ))}
    </>
  );
}
