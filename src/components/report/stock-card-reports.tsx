"use client";

import { useEffect, useState } from "react";
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
  StockLotBalance,
  StockPosition,
  StockSourceRef,
  StockWarehouseRef,
} from "@/lib/erp/stock-report";
import { formatDate, formatNumber } from "@/lib/format";

/**
 * Kartu Stok and Saldo Stok in two levels, never more: a block per item
 * (*where is this item?*) or per warehouse (*what does this warehouse hold?*),
 * and its rows — the places or the items of Saldo Stok, the movements of Kartu
 * Stok. Anything else a row knows (location, lot, expiry, status) is a column,
 * and a block's figures speak of its own subject only.
 *
 * A warehouse totals nothing: its items are in different units, so the count of
 * items is its summary.
 */

export const qty = (n: number) => {
  const text = formatNumber(Math.abs(n), Number.isInteger(n) ? 0 : 4);
  return n === 0 ? "—" : n < 0 ? `(${text})` : text;
};
/** A quantity holds six decimals; adding them as numbers must not leave a tail. */
export const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

type Subjects = { item: StockItemRef; warehouse: StockWarehouseRef };

type Group<T> = { id: number; label: string; name: string; cards: T[] };

/** What goes in first is read first: the subject a row names, opening its card. */
function Subject({ s }: { s: { label: string; name: string } }) {
  return (
    <>
      <span className="lab">{s.label}</span> <span className="nm">{s.name}</span>
    </>
  );
}

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

export function flip<K>(set: Set<K>, k: K) {
  const next = new Set(set);
  if (!next.delete(k)) next.add(k);
  return next;
}

/** Buka / Tutup Semua over a report's blocks, when there is more than one. */
export function expandOf<K>(keys: K[], open: Set<K>, show: (next: Set<K>) => void) {
  if (keys.length < 2) return undefined;
  return { onExpand: () => show(new Set(keys)), onCollapse: () => show(new Set()), allOpen: open.size === keys.length, allClosed: open.size === 0 };
}

const AVAILABLE = "Tersedia";
const Status = ({ name }: { name: string }) => (name === AVAILABLE ? <>{name}</> : <span className="bdg s-warn">{name}</span>);
const Expiry = ({ date }: { date: string | null }) => (date ? <span className="mono">{formatDate(date)}</span> : <span className="dash">—</span>);

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

export const Figure = ({ n }: { n: number }) => (n ? <span className="mny">{qty(n)}</span> : <span className="dash">—</span>);

const Empty = ({ body }: { body: string }) => <ReportEmpty icon="layers" title="Tidak ada stok" body={body} />;

// ----------------------------------------------------------- Saldo Stok

export function StockBalanceBody({ positions, groupBy, showLots, asOf }: { positions: StockPosition[]; groupBy: StockGroupBy; showLots: boolean; asOf: string }) {
  const groups = groupCards(positions, groupBy);
  const [open, setOpen] = useState<Set<number>>(() => new Set(groups.map((g) => g.id)));
  if (!positions.length) return <Empty body="Tidak ada barang dengan saldo pada tanggal dan filter ini." />;

  // A position opens its Kartu Stok over its month to date, so the reader sees how it came to be.
  const ledgerHref = (p: StockPosition) =>
    reportHref("stock-ledger", { items: p.item.id, warehouses: p.warehouse.id, group: groupBy, from: `${asOf.slice(0, 8)}01`, to: asOf });
  // One set of columns for every block, so they line up down the page.
  const unavailable = !showLots && positions.some((p) => p.lots.some((l) => l.statusName !== AVAILABLE));

  return (
    <>
      <CountLine
        count={groups.length}
        noun={groupBy === "item" ? "barang" : "gudang"}
        when={`per ${formatDate(asOf)}`}
        expand={expandOf(groups.map((g) => g.id), open, setOpen)}
      />
      {groups.map((g) => (
        <div className="cblock" key={g.id}>
          <BlockHead label={g.label} open={open.has(g.id)} onToggle={() => setOpen(flip(open, g.id))} meta={groupBy === "item" ? `${g.name} · ${g.cards[0].item.uomLabel}` : g.name}>
            <ReportSummary
              figures={[
                groupBy === "item"
                  ? { label: "Jumlah", value: qty(round6(g.cards.reduce((s, c) => s + c.qty, 0))), key: true }
                  : { label: "Barang", value: String(g.cards.length), key: true },
              ]}
            />
          </BlockHead>
          {open.has(g.id) && (
            <div className="tw">
              <table className="grid" style={{ minWidth: showLots ? 980 : 700, tableLayout: "fixed" }}>
                <thead>
                  <tr>
                    <th>{groupBy === "item" ? "Gudang" : "Barang"}</th>
                    <th style={{ width: 110 }}>Lokasi</th>
                    {showLots && (
                      <>
                        <th style={{ width: 210 }}>No. Stok</th>
                        <th style={{ width: 110 }}>Kadaluarsa</th>
                        <th style={{ width: 130 }}>Status</th>
                      </>
                    )}
                    {unavailable && <th className="num" style={{ width: 140 }}>Tidak Tersedia</th>}
                    <th className="num" style={{ width: 140 }}>Jumlah</th>
                    <th style={{ width: 90 }}>Satuan</th>
                  </tr>
                </thead>
                <tbody>
                  {g.cards.flatMap((p) =>
                    (showLots ? p.lots.map((l) => [l]) : byLocation(p.lots)).map((lots, i) => (
                      <tr key={`${p.item.id}:${p.warehouse.id}:${i}`} style={{ cursor: "default" }}>
                        <td>
                          <Drill href={ledgerHref(p)} title="Buka Kartu Stok barang ini di gudang ini">
                            <Subject s={groupBy === "item" ? p.warehouse : p.item} />
                          </Drill>
                        </td>
                        <td>
                          <Location label={lots[0].locationLabel} name={lots[0].locationName} />
                        </td>
                        {showLots && (
                          <>
                            <td><span className="lab">{lots[0].lotNo}</span></td>
                            <td><Expiry date={lots[0].expiry} /></td>
                            <td><Status name={lots[0].statusName} /></td>
                          </>
                        )}
                        {unavailable && <td className="num"><Figure n={sumQty(lots.filter((l) => l.statusName !== AVAILABLE))} /></td>}
                        <td className="num"><Figure n={sumQty(lots)} /></td>
                        <td><span className="lab">{p.item.uomLabel}</span></td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ))}
    </>
  );
}

const sumQty = (lots: StockLotBalance[]) => round6(lots.reduce((s, l) => s + l.qty, 0));

function byLocation(lots: StockLotBalance[]): StockLotBalance[][] {
  const at = new Map<string | null, StockLotBalance[]>();
  for (const l of lots) at.set(l.locationLabel, [...(at.get(l.locationLabel) ?? []), l]);
  return [...at.values()];
}

// ---------------------------------------------------------- Kartu Stok

export function StockLedgerBody({
  cards,
  groupBy,
  range,
  itemIds,
  warehouseIds,
  lotNos,
}: {
  cards: StockCard[];
  groupBy: StockGroupBy;
  range: PeriodRange;
  itemIds: number[];
  warehouseIds: number[];
  lotNos: string[];
}) {
  const groups = groupCards(cards, groupBy);
  const count = (g: Group<StockCard>) => g.cards.reduce((s, c) => s + c.entryCount, 0);
  const [open, setOpen] = useState<Set<number>>(() => new Set(groups.length === 1 ? [groups[0].id] : []));
  const lazy = useLazyEntries<StockLedgerEntry, BookCursor, number>((id, cursor) =>
    loadStockCardEntries(groupBy === "item" ? { itemIds: [id], warehouseIds } : { itemIds, warehouseIds: [id] }, range.from, range.to, lotNos, cursor)
  );
  /** Opens these blocks, reading the first page of any not read yet. */
  const show = (next: Set<number>) => {
    setOpen(next);
    for (const g of groups) if (next.has(g.id) && count(g) > 0 && !lazy.get(g.id)) void lazy.more(g.id);
  };
  useEffect(() => {
    // One block has nothing to scan past: its movements open with the page.
    if (groups.length === 1 && count(groups[0]) > 0) void lazy.more(groups[0].id);
    // Once per run: the page remounts this on a new run through its key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (!cards.length) return <Empty body="Tidak ada saldo maupun mutasi untuk filter dan rentang tanggal ini." />;

  const isItem = groupBy === "item";
  return (
    <>
      <CountLine
        count={groups.length}
        noun={isItem ? "barang" : "gudang"}
        when={`${formatDate(range.from)} – ${formatDate(range.to)}`}
        expand={expandOf(groups.map((g) => g.id), open, show)}
      />
      {groups.map((g) => {
        const have = lazy.get(g.id);
        const n = count(g);
        // A column no row fills is left out.
        const located = have?.entries.some((e) => e.locationLabel);
        const held = have?.entries.some((e) => e.statusName !== AVAILABLE);
        const cols = 10 + [located, held].filter(Boolean).length;
        const add = (f: (c: StockCard) => number) => round6(g.cards.reduce((s, c) => s + f(c), 0));
        const total = { opening: add((c) => c.opening), in: add((c) => c.totalIn), out: add((c) => c.totalOut), closing: add((c) => c.closing) };
        // An item's balance runs over its warehouses; in a warehouse each item runs on its own.
        const running = new Map<number, number>();
        for (const c of g.cards) running.set(c.item.id, round6((running.get(c.item.id) ?? 0) + c.opening));
        return (
          <div className="cblock" key={g.id}>
            <BlockHead label={g.label} open={open.has(g.id)} onToggle={() => show(flip(open, g.id))} meta={`${g.name} · ${n} mutasi${isItem ? ` · ${g.cards[0].item.uomLabel}` : ""}`}>
              <ReportSummary
                figures={
                  isItem
                    ? [
                        { label: "Saldo Awal", value: qty(total.opening), zero: !total.opening },
                        { label: "Masuk", value: qty(total.in), zero: !total.in },
                        { label: "Keluar", value: qty(total.out), zero: !total.out },
                        { label: "Saldo Akhir", value: qty(total.closing), key: true },
                      ]
                    : [{ label: "Barang", value: String(g.cards.length), key: true }]
                }
              />
            </BlockHead>
            {open.has(g.id) && (
              <div className="tw">
                <table className="grid" style={{ minWidth: 940 }}>
                  <thead>
                    <tr>
                      <th style={{ width: 88 }}>Tanggal</th>
                      <th style={{ width: 150 }}>Dokumen</th>
                      <th style={{ width: 140 }}>No. Ledger</th>
                      <th>Keterangan</th>
                      <th style={{ width: 100 }}>{isItem ? "Gudang" : "Barang"}</th>
                      {located && <th style={{ width: 84 }}>Lokasi</th>}
                      <th style={{ width: 170 }}>No. Stok</th>
                      <th style={{ width: 96 }}>Kadaluarsa</th>
                      {held && <th style={{ width: 100 }}>Status</th>}
                      <th className="num" style={{ width: 84 }}>Masuk</th>
                      <th className="num" style={{ width: 84 }}>Keluar</th>
                      <th className="num" style={{ width: 100 }}>{isItem ? "Saldo" : "Saldo Barang"}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {isItem && (
                      <tr className="totrow">
                        <td colSpan={cols - 1}>Saldo per {formatDate(range.from)}</td>
                        <td className="num"><Figure n={total.opening} /></td>
                      </tr>
                    )}
                    {have?.entries.map((e) => {
                      const balance = round6((running.get(e.itemId) ?? 0) + e.change);
                      running.set(e.itemId, balance);
                      return (
                        <tr key={e.id} style={{ cursor: "default" }}>
                          <td className="mono mut" style={{ fontSize: "11.5px" }}>{formatDate(e.date)}</td>
                          <td><Source s={e.source} /></td>
                          <td className="mono mut" style={{ fontSize: "11.5px" }}>{e.ledgerNo}·{e.lineNo}</td>
                          <td className="pri wrapok">{e.source.docName}</td>
                          <td><span className="lab">{isItem ? e.warehouseLabel : e.itemLabel}</span></td>
                          {located && <td><Location label={e.locationLabel} name={e.locationName} /></td>}
                          <td><span className="lab">{e.lotNo}</span></td>
                          <td><Expiry date={e.expiry} /></td>
                          {held && <td><Status name={e.statusName} /></td>}
                          <td className="num"><Figure n={Math.max(e.change, 0)} /></td>
                          <td className="num"><Figure n={Math.max(-e.change, 0)} /></td>
                          <td className="num"><Figure n={balance} /></td>
                        </tr>
                      );
                    })}
                    <LazyRows colSpan={cols} total={n} have={have} onMore={() => void lazy.more(g.id)} />
                    {n === 0 && (
                      <tr>
                        <td colSpan={cols} className="mut" style={{ textAlign: "center" }}>
                          Tidak ada mutasi pada rentang tanggal ini. Saldo akhir sama dengan saldo awal.
                        </td>
                      </tr>
                    )}
                  </tbody>
                  {isItem && (
                    <tfoot>
                      <tr className="totrow">
                        <td colSpan={cols - 3}>Saldo per {formatDate(range.to)}</td>
                        <td className="num"><Figure n={total.in} /></td>
                        <td className="num"><Figure n={total.out} /></td>
                        <td className="num"><b><Figure n={total.closing} /></b></td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}
