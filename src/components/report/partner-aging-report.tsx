"use client";

import { Fragment, useState } from "react";
import { Icon } from "@/components/icon";
import { DocLink } from "@/components/report/customer-advance-report";
import { ExpandAll } from "@/components/ui/expand-all";
import { AGING_BUCKETS, type AgingFigures, type AgingReport } from "@/lib/erp/ar-aging";
import { BOOK_WORDS, type BookSide } from "@/lib/erp/partner-book";
import { formatDate, formatMoney } from "@/lib/format";

/**
 * Umur Piutang and Umur Hutang (P235) — a tree, as Odoo's Aged Receivable reads:
 * a partner's position per bucket first and, opened, its documents, each standing
 * in the bucket it is in, so the columns add up at both levels. An Uang Muka has
 * no due date: it sits in its own column.
 */
const money = (n: number) => formatMoney(n, "IDR");
const cell = (n: number) => (n ? <span className="mny">{money(n)}</span> : <span className="dash">–</span>);
const credit = (n: number) => (n ? <span className="mny">−{money(n)}</span> : <span className="dash">–</span>);
const signed = (n: number) => (n < 0 ? `−${money(-n)}` : money(n));

function Figures({ f }: { f: AgingFigures }) {
  return (
    <>
      {AGING_BUCKETS.map((b) => (
        <td key={b.key} className="num">{cell(f.buckets[b.key])}</td>
      ))}
      <td className="num">{cell(f.invoice)}</td>
      <td className="num">{credit(f.advance)}</td>
      <td className="num"><b className="mny">{signed(f.net)}</b></td>
    </>
  );
}

export function PartnerAgingReport({ report, side, asOf }: { report: AgingReport; side: BookSide; asOf: string }) {
  const { partners, totals } = report;
  const noun = BOOK_WORDS[side].partner;
  const position = side === "ar" ? "Piutang" : "Hutang";
  // One partner has nothing to scan past: its documents open with the page.
  const [open, setOpen] = useState<Set<number>>(() => new Set(partners.length === 1 ? [partners[0].partnerId] : []));
  const toggle = (id: number) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  if (!partners.length) {
    return (
      <div className="empty sm">
        <div className="ic"><Icon name="clock" size={20} /></div>
        <h4>Tidak ada {position.toLowerCase()} terbuka</h4>
        <p>Pada tanggal ini tidak ada invoice yang belum lunas dan tidak ada uang muka {noun.toLowerCase()} yang belum dipakai.</p>
      </div>
    );
  }

  return (
    <>
      <div className="rhead">
        <span className="count">
          <b>{partners.length}</b> {noun.toLowerCase()} · per {formatDate(asOf)}
        </span>
        <div className="tspace" />
        {partners.length > 1 && (
          <ExpandAll
            onExpand={() => setOpen(new Set(partners.map((p) => p.partnerId)))}
            onCollapse={() => setOpen(new Set())}
            allOpen={open.size === partners.length}
            allClosed={open.size === 0}
          />
        )}
      </div>
      <div className="tw">
        <table className="grid stm" style={{ minWidth: 1180 }}>
          <thead>
            <tr>
              <th>{noun} / Dokumen</th>
              {AGING_BUCKETS.map((b) => (
                <th key={b.key} className="num" style={{ width: 112 }}>{b.label}</th>
              ))}
              <th className="num" style={{ width: 122 }}>Total {position}</th>
              <th className="num" style={{ width: 118 }}>Uang Muka</th>
              <th className="num" style={{ width: 122 }}>Posisi Bersih</th>
            </tr>
          </thead>
          <tbody>
            {partners.map((p) => {
              const isOpen = open.has(p.partnerId);
              return (
                <Fragment key={p.partnerId}>
                  <tr className="st-cat" style={{ cursor: "default" }}>
                    <td className="stn">
                      <div className="stc">
                        <button className="tgl" aria-expanded={isOpen} title={isOpen ? "Tutup" : "Buka"} onClick={() => toggle(p.partnerId)}>
                          <span className={`chev${isOpen ? " o" : ""}`}>
                            <Icon name="chev" size={11} />
                          </span>
                        </button>
                        <span className="lab">{p.label}</span>
                        <span className="nm">{p.name}</span>
                      </div>
                    </td>
                    <Figures f={p} />
                  </tr>
                  {isOpen &&
                    p.invoices.map((d) => (
                      <tr key={d.id} style={{ cursor: "default" }}>
                        <td className="stn d1">
                          <span className="dstack" style={{ alignItems: "flex-start" }}>
                            <DocLink table={d.sourceTable} id={d.sourceId} no={d.sourceNo} />
                            <span className="d2" style={{ fontFamily: "inherit" }}>
                              {formatDate(d.date)} · jatuh tempo {formatDate(d.due)}
                              {d.days > 0 && ` · lewat ${d.days} hari`}
                            </span>
                          </span>
                        </td>
                        {AGING_BUCKETS.map((b) => (
                          <td key={b.key} className="num">{cell(b.key === d.bucket ? d.open : 0)}</td>
                        ))}
                        <td className="num">{cell(d.open)}</td>
                        <td className="num">{credit(0)}</td>
                        <td className="num"><span className="mny">{money(d.open)}</span></td>
                      </tr>
                    ))}
                  {isOpen &&
                    p.advances.map((d) => (
                      <tr key={d.id} style={{ cursor: "default" }}>
                        <td className="stn d1">
                          <span className="dstack" style={{ alignItems: "flex-start" }}>
                            <DocLink table={d.sourceTable} id={d.sourceId} no={d.sourceNo} />
                            <span className="d2" style={{ fontFamily: "inherit" }}>{formatDate(d.date)} · uang muka</span>
                          </span>
                        </td>
                        {AGING_BUCKETS.map((b) => (
                          <td key={b.key} className="num">{cell(0)}</td>
                        ))}
                        <td className="num">{cell(0)}</td>
                        <td className="num">{credit(d.open)}</td>
                        <td className="num"><span className="mny">−{money(d.open)}</span></td>
                      </tr>
                    ))}
                </Fragment>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="totrow">
              <td>Total</td>
              <Figures f={totals} />
            </tr>
          </tfoot>
        </table>
      </div>
    </>
  );
}
