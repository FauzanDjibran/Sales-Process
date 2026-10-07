"use client";

import { Fragment, useState } from "react";
import Link from "next/link";
import { Icon } from "@/components/icon";
import { ExpandAll } from "@/components/ui/expand-all";
import { Drill } from "@/components/report/drill";
import { ReportSummary } from "@/components/report/report-summary";
import { documentHref } from "@/lib/erp/document-links";
import type { PeriodRange } from "@/lib/erp/period";
import { reportHref } from "@/lib/erp/reports";
import type {
  StockCard,
  StockGroupBy,
  StockItemRef,
  StockPosition,
  StockSourceRef,
  StockWarehouseRef,
} from "@/lib/erp/stock-report";
import { formatDate, formatNumber } from "@/lib/format";

/**
 * Kartu Stok and Saldo Stok, grouped per item (*where is this item?*) or per
 * warehouse (*what does this warehouse hold?*). Both nest the same item ×
 * warehouse cards the other way round, in the General Ledger's rolled-up
 * blocks: the block header states the totals, a row per card states its
 * figures, and the lots or movements behind a card are one click further.
 *
 * A warehouse block totals nothing: its items are in different units, so the
 * count of items is its summary.
 */

const qty = (n: number) => formatNumber(n, Number.isInteger(n) ? 0 : 4);
const cardKey = (c: { item: StockItemRef; warehouse: StockWarehouseRef }) => `${c.item.id}:${c.warehouse.id}`;

type Block<T> = { id: number; label: string; name: string; cards: T[] };

/** The blocks in label order, each card once; the server already sorts cards by item, then warehouse. */
function groupCards<T extends { item: StockItemRef; warehouse: StockWarehouseRef }>(cards: T[], by: StockGroupBy): Block<T>[] {
  const blocks = new Map<number, Block<T>>();
  for (const c of cards) {
    const s = by === "item" ? c.item : c.warehouse;
    let b = blocks.get(s.id);
    if (!b) blocks.set(s.id, (b = { id: s.id, label: s.label, name: s.name, cards: [] }));
    b.cards.push(c);
  }
  const list = [...blocks.values()];
  if (by === "warehouse") list.sort((a, b) => a.label.localeCompare(b.label));
  return list;
}

/** Block and row fold state; a report of one block opens it, since there is nothing else to scan. */
function useFolds<T extends { item: StockItemRef; warehouse: StockWarehouseRef }>(blocks: Block<T>[]) {
  const [openBlocks, setOpenBlocks] = useState<Set<number>>(() => new Set(blocks.length === 1 ? [blocks[0].id] : []));
  const [openRows, setOpenRows] = useState<Set<string>>(new Set());
  const flip = <K,>(set: Set<K>, k: K) => {
    const next = new Set(set);
    if (next.has(k)) next.delete(k);
    else next.add(k);
    return next;
  };
  const allRows = blocks.flatMap((b) => b.cards.map(cardKey));
  return {
    blockOpen: (id: number) => openBlocks.has(id),
    rowOpen: (k: string) => openRows.has(k),
    toggleBlock: (id: number) => setOpenBlocks((s) => flip(s, id)),
    toggleRow: (k: string) => setOpenRows((s) => flip(s, k)),
    expandAll: () => {
      setOpenBlocks(new Set(blocks.map((b) => b.id)));
      setOpenRows(new Set(allRows));
    },
    collapseAll: () => {
      setOpenBlocks(new Set());
      setOpenRows(new Set());
    },
    allOpen: openBlocks.size === blocks.length && openRows.size === allRows.length,
    allClosed: openBlocks.size === 0 && openRows.size === 0,
  };
}

function ResultBar({ count, noun, when, folds }: { count: number; noun: string; when: string; folds: ReturnType<typeof useFolds> }) {
  return (
    <div className="rhead">
      <span className="count">
        <b>{count}</b> {noun} · {when}
      </span>
      <div className="tspace" />
      <ExpandAll onExpand={folds.expandAll} onCollapse={folds.collapseAll} allOpen={folds.allOpen} allClosed={folds.allClosed} />
    </div>
  );
}

function BlockHead({ block, open, onToggle, meta, children }: { block: Block<unknown>; open: boolean; onToggle: () => void; meta: string; children: React.ReactNode }) {
  return (
    <div className="cbh" onClick={onToggle} style={{ cursor: "pointer" }}>
      <span className={`chev${open ? " o" : ""}`}>
        <Icon name="chev" size={12} />
      </span>
      <b>{block.label}</b>
      <span className="cbn">
        {block.name} · {meta}
      </span>
      {children}
    </div>
  );
}

function Toggle({ open, onClick, what }: { open: boolean; onClick: () => void; what: string }) {
  return (
    <button className="tgl" onClick={onClick} title={open ? `Tutup ${what}` : `Buka ${what}`}>
      <span className={`chev${open ? " o" : ""}`}>
        <Icon name="chev" size={11} />
      </span>
    </button>
  );
}

/** The other side of the card: the warehouse in an item's block, the item in a warehouse's. */
const otherSide = (c: { item: StockItemRef; warehouse: StockWarehouseRef }, by: StockGroupBy) => (by === "item" ? c.warehouse : c.item);

function Lot({ lotNo, expiry, statusName, showExpiry }: { lotNo: string; expiry: string | null; statusName: string; showExpiry?: boolean }) {
  return (
    <>
      <span className="lab">{lotNo}</span>
      {showExpiry && expiry && <span className="rsub">ED {formatDate(expiry)}</span>}
      {/* Status is worth a word only when the lot is not simply available. */}
      {statusName && statusName !== "Tersedia" && <span className="rsub">{statusName}</span>}
    </>
  );
}

function Source({ s }: { s: StockSourceRef }) {
  const href = documentHref(s.table, s.id);
  return href ? (
    <Link className="rsub" href={href} title={`Buka ${s.docName}`}>
      {s.no}
    </Link>
  ) : (
    <span className="rsub" title={s.docName}>
      {s.no}
    </span>
  );
}

function Empty({ title, body }: { title: string; body: string }) {
  return (
    <div className="empty sm">
      <div className="ic">
        <Icon name="layers" size={20} />
      </div>
      <h4>{title}</h4>
      <p>{body}</p>
    </div>
  );
}

// ----------------------------------------------------------- Saldo Stok

export function StockBalanceBody({ positions, groupBy, asOf }: { positions: StockPosition[]; groupBy: StockGroupBy; asOf: string }) {
  const blocks = groupCards(positions, groupBy);
  const folds = useFolds(blocks);
  if (!positions.length) return <Empty title="Tidak ada stok" body="Tidak ada barang dengan saldo pada tanggal dan filter ini." />;

  // A position opens its Kartu Stok over its month to date, so the reader sees how it came to be.
  const ledgerHref = (p: StockPosition) =>
    reportHref("stock-ledger", { items: p.item.id, warehouses: p.warehouse.id, group: groupBy, from: `${asOf.slice(0, 8)}01`, to: asOf });

  return (
    <>
      <ResultBar count={blocks.length} noun={groupBy === "item" ? "barang" : "gudang"} when={`per ${formatDate(asOf)}`} folds={folds} />
      {blocks.map((b) => {
        const open = folds.blockOpen(b.id);
        const lots = b.cards.reduce((s, c) => s + c.lots.length, 0);
        return (
          <div className="cblock" key={b.id}>
            {groupBy === "item" ? (
              <BlockHead block={b} open={open} onToggle={() => folds.toggleBlock(b.id)} meta={`${b.cards.length} gudang · ${lots} lot · ${b.cards[0].item.uomLabel}`}>
                <ReportSummary figures={[{ label: "Jumlah", value: qty(b.cards.reduce((s, c) => s + c.qty, 0)), key: true }]} />
              </BlockHead>
            ) : (
              <BlockHead block={b} open={open} onToggle={() => folds.toggleBlock(b.id)} meta={`${lots} lot`}>
                <ReportSummary figures={[{ label: "Barang", value: String(b.cards.length), key: true }]} />
              </BlockHead>
            )}
            {open && (
              <div className="tw">
                <table className="grid stm">
                  <thead>
                    <tr>
                      <th>{groupBy === "item" ? "Gudang / Lot" : "Barang / Lot"}</th>
                      <th style={{ width: 120 }}>Kadaluarsa</th>
                      <th className="num" style={{ width: 160 }}>
                        Jumlah
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {b.cards.map((p) => {
                      const k = cardKey(p);
                      const rowOpen = folds.rowOpen(k);
                      const s = otherSide(p, groupBy);
                      return (
                        <Fragment key={k}>
                          <tr className="st-cat">
                            <td className="stn">
                              <div className="stc">
                                <Toggle open={rowOpen} onClick={() => folds.toggleRow(k)} what="lot" />
                                <Drill href={ledgerHref(p)} title="Buka Kartu Stok barang ini di gudang ini">
                                  <span className="lab">{s.label}</span>
                                </Drill>
                                <span className="nm">{s.name}</span>
                                <span className="cd">· {p.lots.length} lot</span>
                              </div>
                            </td>
                            <td />
                            <td className="num">
                              <span className="mny">{qty(p.qty)}</span> <span className="cd">{p.item.uomLabel}</span>
                            </td>
                          </tr>
                          {rowOpen &&
                            p.lots.map((l, i) => (
                              <tr key={`${k}-${i}`} className="st-par">
                                <td className="stn d2">
                                  <Lot {...l} />
                                </td>
                                <td>{l.expiry ? <span className="mono">{formatDate(l.expiry)}</span> : <span className="dash">—</span>}</td>
                                <td className="num">
                                  <span className="mny">{qty(l.qty)}</span>
                                </td>
                              </tr>
                            ))}
                        </Fragment>
                      );
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

export function StockLedgerBody({ cards, groupBy, range }: { cards: StockCard[]; groupBy: StockGroupBy; range: PeriodRange }) {
  const blocks = groupCards(cards, groupBy);
  const folds = useFolds(blocks);
  if (!cards.length) return <Empty title="Tidak ada stok" body="Tidak ada saldo maupun mutasi untuk barang dan gudang ini pada rentang tanggal ini." />;

  const sum = (list: StockCard[], f: (c: StockCard) => number) => list.reduce((s, c) => s + f(c), 0);

  return (
    <>
      <ResultBar
        count={blocks.length}
        noun={groupBy === "item" ? "barang" : "gudang"}
        when={`${formatDate(range.from)} – ${formatDate(range.to)}`}
        folds={folds}
      />
      {blocks.map((b) => {
        const open = folds.blockOpen(b.id);
        const moves = sum(b.cards, (c) => c.entries.length);
        return (
          <div className="cblock" key={b.id}>
            {groupBy === "item" ? (
              <BlockHead
                block={b}
                open={open}
                onToggle={() => folds.toggleBlock(b.id)}
                meta={`${b.cards.length} gudang · ${moves} mutasi · ${b.cards[0].item.uomLabel}`}
              >
                <ReportSummary
                  figures={[
                    { label: "Saldo Awal", value: qty(sum(b.cards, (c) => c.opening)), zero: !sum(b.cards, (c) => c.opening) },
                    { label: "Masuk", value: qty(sum(b.cards, (c) => c.totalIn)), zero: !sum(b.cards, (c) => c.totalIn) },
                    { label: "Keluar", value: qty(sum(b.cards, (c) => c.totalOut)), zero: !sum(b.cards, (c) => c.totalOut) },
                    { label: "Saldo Akhir", value: qty(sum(b.cards, (c) => c.closing)), key: true },
                  ]}
                />
              </BlockHead>
            ) : (
              <BlockHead block={b} open={open} onToggle={() => folds.toggleBlock(b.id)} meta={`${moves} mutasi`}>
                <ReportSummary figures={[{ label: "Barang", value: String(b.cards.length), key: true }]} />
              </BlockHead>
            )}
            {open && (
              <div className="tw">
                <table className="grid stm" style={{ minWidth: 860 }}>
                  <thead>
                    <tr>
                      <th>{groupBy === "item" ? "Gudang / Tanggal" : "Barang / Tanggal"}</th>
                      <th style={{ width: 170 }}>Entri</th>
                      <th style={{ width: 170 }}>Lot</th>
                      <th className="num" style={{ width: 100 }}>
                        Masuk
                      </th>
                      <th className="num" style={{ width: 100 }}>
                        Keluar
                      </th>
                      <th className="num" style={{ width: 130 }}>
                        Saldo
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {b.cards.map((c) => {
                      const k = cardKey(c);
                      const rowOpen = folds.rowOpen(k);
                      const s = otherSide(c, groupBy);
                      const u = c.item.uomLabel;
                      return (
                        <Fragment key={k}>
                          <tr className="st-cat">
                            <td className="stn" colSpan={3}>
                              <div className="stc">
                                <Toggle open={rowOpen} onClick={() => folds.toggleRow(k)} what="mutasi" />
                                <span className="lab">{s.label}</span>
                                <span className="nm">{s.name}</span>
                                <span className="cd">
                                  · awal {qty(c.opening)} · {c.entries.length} mutasi
                                </span>
                              </div>
                            </td>
                            <td className="num">{c.totalIn ? <span className="mny in">{qty(c.totalIn)}</span> : <span className="dash">–</span>}</td>
                            <td className="num">{c.totalOut ? <span className="mny">{qty(c.totalOut)}</span> : <span className="dash">–</span>}</td>
                            <td className="num">
                              <b className="mny">{qty(c.closing)}</b> <span className="cd">{u}</span>
                            </td>
                          </tr>
                          {rowOpen && (
                            <>
                              <tr className="st-par">
                                <td className="stn d2" colSpan={3}>
                                  Saldo awal per {formatDate(range.from)}
                                </td>
                                <td className="num">
                                  <span className="dash">–</span>
                                </td>
                                <td className="num">
                                  <span className="dash">–</span>
                                </td>
                                <td className="num">
                                  <span className="mny">{qty(c.opening)}</span>
                                </td>
                              </tr>
                              {c.entries.map((e) => (
                                <tr key={e.id} className="st-par">
                                  <td className="stn d2 mono" style={{ fontSize: "11.5px" }}>
                                    {formatDate(e.date)}
                                  </td>
                                  <td>
                                    <span className="lab">
                                      {e.ledgerNo}·{e.lineNo}
                                    </span>
                                    <Source s={e.source} />
                                  </td>
                                  <td>
                                    <Lot lotNo={e.lotNo} expiry={e.expiry} statusName={e.statusName} showExpiry />
                                  </td>
                                  <td className="num">{e.qtyIn ? <span className="mny in">{qty(e.qtyIn)}</span> : <span className="dash">–</span>}</td>
                                  <td className="num">{e.qtyOut ? <span className="mny">{qty(e.qtyOut)}</span> : <span className="dash">–</span>}</td>
                                  <td className="num">
                                    <span className="mny">{qty(e.balance)}</span>
                                  </td>
                                </tr>
                              ))}
                              {c.entries.length === 0 && (
                                <tr className="st-par">
                                  <td colSpan={6} className="mut" style={{ textAlign: "center" }}>
                                    Tidak ada mutasi pada rentang tanggal ini. Saldo akhir sama dengan saldo awal.
                                  </td>
                                </tr>
                              )}
                            </>
                          )}
                        </Fragment>
                      );
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
