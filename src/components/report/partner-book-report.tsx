"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { loadPartnerBookEntries } from "@/app/actions/book-entries";
import { Icon } from "@/components/icon";
import { DocLink } from "@/components/report/customer-advance-report";
import { LazyRows, useLazyEntries } from "@/components/report/lazy-entries";
import { ReportSummary } from "@/components/report/report-summary";
import { ExpandAll } from "@/components/ui/expand-all";
import { BOOK_WORDS, type BookEntry, type BookKind, type BookSubject, type PartnerBook } from "@/lib/erp/partner-book";
import type { BookCursor } from "@/lib/erp/register-query";
import { formatDate, formatMoney } from "@/lib/format";

/**
 * Buku and Saldo Piutang / Hutang (P233) — SIBA's Buku Subjek and Saldo Buku
 * Subjek on the AR and AP items. One block per partner, its header stating Saldo
 * Awal, Bertambah, Berkurang and the closing. The book reads a block entry by
 * entry, fetched when it is opened; the balance reads it item by item, with
 * where each came from and how far it has been settled.
 *
 * Piutang / Hutang Usaha and Uang Muka are two books, chosen by the toggle, each
 * in its own direction, so Bertambah and Berkurang always mean the book in view.
 */
const money = (n: number) => formatMoney(n, "IDR");
const figure = (n: number) => (n ? <span className="mny">{money(n)}</span> : <span className="dash">–</span>);

/** Moves at once: it changes what is read, not a filter to be confirmed. */
export function BookToggle({ book, side, hrefs }: { book: BookKind; side: "ar" | "ap"; hrefs: Record<BookKind, string> }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <>
      <span className="rl">Buku</span>
      <span className="dtog" role="group" aria-label="Buku yang dibaca">
        {(["Invoice", "Advance"] as BookKind[]).map((b) => (
          <button
            key={b}
            type="button"
            className={book === b ? "on" : undefined}
            aria-pressed={book === b}
            disabled={pending}
            onClick={() => {
              if (book !== b) startTransition(() => router.push(hrefs[b]));
            }}
          >
            {BOOK_WORDS[side][b]}
          </button>
        ))}
      </span>
      <span className="rsep" />
    </>
  );
}

function SubjectHead({
  s,
  isOpen,
  count,
  book,
  onToggle,
}: {
  s: BookSubject;
  isOpen: boolean;
  count: string;
  book: string;
  onToggle: () => void;
}) {
  return (
    <div
      className="cbh"
      role="button"
      tabIndex={0}
      aria-expanded={isOpen}
      onClick={onToggle}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onToggle();
        }
      }}
      style={{ cursor: "pointer" }}
    >
      <span className={`chev${isOpen ? " o" : ""}`}>
        <Icon name="chev" size={12} />
      </span>
      <b>{s.label}</b>
      <span className="cbn">
        {s.name} · {count}
      </span>
      <ReportSummary
        figures={[
          { label: "Saldo Awal", value: money(s.opening), zero: !s.opening },
          { label: "Bertambah", value: money(s.raised), zero: !s.raised },
          { label: "Berkurang", value: money(s.lowered), zero: !s.lowered },
          { label: book, value: money(s.closing), key: true },
        ]}
      />
    </div>
  );
}

/** Blocks that fold, with the count line above them and the net position below. */
function useBlocks(report: PartnerBook, startOpen: boolean) {
  const [open, setOpen] = useState<Set<number>>(() => new Set(startOpen ? report.subjects.map((s) => s.partnerId) : []));
  const toggle = (id: number) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  return { open, setOpen, toggle };
}

function CountLine({ report, open, setOpen }: { report: PartnerBook; open: Set<number>; setOpen: (s: Set<number>) => void }) {
  const words = BOOK_WORDS[report.side];
  return (
    <div className="rhead">
      <span className="count">
        <b>{report.subjects.length}</b> {words.partner.toLowerCase()} · {formatDate(report.range.from)} – {formatDate(report.range.to)}
      </span>
      <div className="tspace" />
      {report.subjects.length > 1 && (
        <ExpandAll
          onExpand={() => setOpen(new Set(report.subjects.map((s) => s.partnerId)))}
          onCollapse={() => setOpen(new Set())}
          allOpen={open.size === report.subjects.length}
          allClosed={open.size === 0}
        />
      )}
    </div>
  );
}

function NetNote({ report }: { report: PartnerBook }) {
  const words = BOOK_WORDS[report.side];
  const invoice = report.book === "Invoice" ? report.closing : report.otherClosing;
  const advance = report.book === "Advance" ? report.closing : report.otherClosing;
  return (
    <div className="nbox slim">
      <span className="ni"><Icon name="scale" size={14} /></span>
      <div>
        <b>
          Per {formatDate(report.range.to)}: {words.Invoice} {money(invoice)} − {words.Advance} {money(advance)} = Posisi bersih{" "}
          {money(invoice - advance)}
        </b>
      </div>
    </div>
  );
}

function Empty({ report }: { report: PartnerBook }) {
  return (
    <div className="empty sm">
      <div className="ic"><Icon name="book" size={20} /></div>
      <h4>Belum ada posisi pada buku ini</h4>
      <p>{BOOK_WORDS[report.side][report.book]} tidak mencatat apa pun untuk pilihan dan periode ini.</p>
    </div>
  );
}

const closingLabel = (report: PartnerBook) => (report.book === "Invoice" ? BOOK_WORDS[report.side].Invoice : "Sisa Uang Muka");

export function PartnerLedgerReport({ report }: { report: PartnerBook }) {
  const words = BOOK_WORDS[report.side];
  // One partner has nothing to scan past: its entries open with the page.
  const only = report.subjects.length === 1 ? report.subjects[0] : null;
  const blocks = useBlocks(report, Boolean(only));
  const lazy = useLazyEntries<BookEntry, BookCursor, number>((partnerId, cursor) =>
    loadPartnerBookEntries(report.side, report.book, partnerId, report.range.from, report.range.to, cursor)
  );
  useEffect(() => {
    if (only?.entryCount) void lazy.more(only.partnerId);
    // Once per run: the parent remounts this on a new run through its key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!report.subjects.length) return <Empty report={report} />;

  const toggle = (s: BookSubject) => {
    blocks.toggle(s.partnerId);
    if (!blocks.open.has(s.partnerId) && s.entryCount > 0 && !lazy.get(s.partnerId)) void lazy.more(s.partnerId);
  };

  return (
    <>
      <CountLine
        report={report}
        open={blocks.open}
        setOpen={(next) => {
          blocks.setOpen(next);
          for (const s of report.subjects) if (next.has(s.partnerId) && s.entryCount > 0 && !lazy.get(s.partnerId)) void lazy.more(s.partnerId);
        }}
      />
      {report.subjects.map((s) => {
        const isOpen = blocks.open.has(s.partnerId);
        const have = lazy.get(s.partnerId);
        let running = s.opening;
        return (
          <div className="cblock" key={s.partnerId}>
            <SubjectHead s={s} isOpen={isOpen} count={`${s.entryCount} entri`} book={closingLabel(report)} onToggle={() => toggle(s)} />
            {isOpen && (
              <div className="tw">
                <table className="grid" style={{ minWidth: 980 }}>
                  <thead>
                    <tr>
                      <th style={{ width: 118 }}>Tanggal</th>
                      <th style={{ width: 150 }}>Dokumen</th>
                      <th style={{ width: 190 }}>{words.item}</th>
                      <th>Keterangan</th>
                      <th className="num" style={{ width: 120 }}>Bertambah</th>
                      <th className="num" style={{ width: 120 }}>Berkurang</th>
                      <th className="num" style={{ width: 128 }}>Saldo</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="totrow">
                      <td colSpan={6}>Saldo per {formatDate(report.range.from)}</td>
                      <td className="num">{money(s.opening)}</td>
                    </tr>
                    {have?.entries.map((e) => {
                      running += e.movement;
                      return (
                        <tr key={e.id} style={{ cursor: "default" }}>
                          <td className="mono mut" style={{ fontSize: "11.5px" }}>
                            <span className="dstack">
                              <span>{formatDate(e.date)}</span>
                              <span className="d2">{e.ledgerNo}</span>
                            </span>
                          </td>
                          <td><DocLink table={e.docTable} id={e.docId} no={e.docNo} /></td>
                          <td>
                            <span className="dstack">
                              <span className="lab">{e.itemNo}</span>
                              <span className="d2">
                                {e.itemSourceNo}
                                {e.agreementNo ? ` · ${e.agreementNo}` : ""}
                              </span>
                            </span>
                          </td>
                          <td>
                            <span className="dstack">
                              <span>{e.eventText}</span>
                              {e.note && <span className="d2" style={{ fontFamily: "inherit", whiteSpace: "normal" }}>{e.note}</span>}
                            </span>
                          </td>
                          <td className="num">{figure(Math.max(e.movement, 0))}</td>
                          <td className="num">{figure(Math.max(-e.movement, 0))}</td>
                          <td className="num"><span className="mny">{money(running)}</span></td>
                        </tr>
                      );
                    })}
                    <LazyRows colSpan={7} total={s.entryCount} have={have} onMore={() => void lazy.more(s.partnerId)} />
                    {s.entryCount === 0 && (
                      <tr>
                        <td colSpan={7} className="mut" style={{ textAlign: "center" }}>
                          Tidak ada perubahan pada rentang tanggal ini.
                        </td>
                      </tr>
                    )}
                  </tbody>
                  <tfoot>
                    <tr className="totrow">
                      <td colSpan={4}>Saldo per {formatDate(report.range.to)}</td>
                      <td className="num"><span className="mny">{money(s.raised)}</span></td>
                      <td className="num"><span className="mny">{money(s.lowered)}</span></td>
                      <td className="num"><b>{money(s.closing)}</b></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>
        );
      })}
      <NetNote report={report} />
    </>
  );
}

export function PartnerBalanceReport({ report }: { report: PartnerBook }) {
  const words = BOOK_WORDS[report.side];
  const blocks = useBlocks(report, true);
  if (!report.subjects.length) return <Empty report={report} />;
  return (
    <>
      <CountLine report={report} open={blocks.open} setOpen={blocks.setOpen} />
      {report.subjects.map((s) => {
        const isOpen = blocks.open.has(s.partnerId);
        return (
          <div className="cblock" key={s.partnerId}>
            <SubjectHead
              s={s}
              isOpen={isOpen}
              count={`${s.items.length} item`}
              book={closingLabel(report)}
              onToggle={() => blocks.toggle(s.partnerId)}
            />
            {isOpen && (
              <div className="tw">
                <table className="grid" style={{ minWidth: 1040 }}>
                  <thead>
                    <tr>
                      <th style={{ width: 88 }}>Tanggal</th>
                      <th style={{ width: 130 }}>{words.item}</th>
                      <th>Asal</th>
                      <th className="num" style={{ width: 116 }}>Saldo Awal</th>
                      <th className="num" style={{ width: 116 }}>Bertambah</th>
                      <th className="num" style={{ width: 116 }}>Berkurang</th>
                      <th className="num" style={{ width: 122 }}>Saldo</th>
                      <th style={{ width: 210 }}>Progres</th>
                    </tr>
                  </thead>
                  <tbody>
                    {s.items.map((i) => (
                      <tr key={i.id} style={{ cursor: "default" }}>
                        <td className="mono mut" style={{ fontSize: "11.5px" }}>{formatDate(i.date)}</td>
                        <td><span className="lab">{i.itemNo}</span></td>
                        <td>
                          <span className="dstack">
                            <DocLink table={i.sourceTable} id={i.sourceId} no={i.sourceNo} />
                            {i.agreementNo && <DocLink table={i.scopeTable} id={i.scopeId} no={i.agreementNo} />}
                          </span>
                        </td>
                        <td className="num">{figure(i.opening)}</td>
                        <td className="num">{figure(i.raised)}</td>
                        <td className="num">{figure(i.lowered)}</td>
                        <td className="num"><b className="mny">{money(i.closing)}</b></td>
                        <td>
                          <span className="dstack">
                            <span style={{ display: "flex", alignItems: "center", gap: 7 }}>
                              <span className="bar" style={{ flex: "1 1 auto" }}><i style={{ width: `${i.progress}%` }} /></span>
                              <span className="mono" style={{ fontSize: "11px" }}>{i.progress}%</span>
                            </span>
                            <span className="d2" style={{ fontFamily: "inherit", whiteSpace: "normal" }}>
                              {i.settledBy.length
                                ? i.settledBy.map((b) => `${b.text} ${money(b.amount)}`).join(" · ")
                                : `Belum ada penyelesaian dari ${money(i.original)}`}
                            </span>
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        );
      })}
      <NetNote report={report} />
    </>
  );
}
