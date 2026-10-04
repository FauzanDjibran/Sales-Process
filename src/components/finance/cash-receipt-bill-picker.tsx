"use client";

import { useState } from "react";
import { Icon } from "@/components/icon";
import { Dialog } from "@/components/ui/dialog";
import { Field, FormRow } from "@/components/ui/form";
import { MoneyInput } from "@/components/ui/money-input";
import { cashToClear } from "@/lib/erp/sales-tax";
import type { OpenBill } from "@/lib/erp/cash-bank-tx";
import { SETTLED_DOC_TEXT, type SettledDocKind } from "@/lib/erp/cash-bank-purposes";
import { formatDate, formatMoney } from "@/lib/format";

/** A bill on the Penerimaan — an advance bill or a Faktur: what was received for it, and whether PPh was withheld. */
export type PickedLine = { key: string; kind: SettledDocKind; docId: number; cash: string; withhold: boolean };

/**
 * The partner's open bills — advance bills and Fakturs together (P83), oldest
 * due first — to tick the ones being paid. What helps choose —
 * dates, totals, what earlier receipts paid — lives here, so the page holds
 * only the bills being settled. A bill already on the page keeps its figures.
 *
 * *Bagikan Dana* spreads one transfer over the ticked bills, oldest first,
 * each up to what clears it; a bill the money does not reach is left out.
 */
export function BillPicker({
  bills,
  current,
  noun,
  partnerName,
  withhold,
  onApply,
  onClose,
}: {
  bills: OpenBill[];
  current: PickedLine[];
  noun: string;
  partnerName: string;
  withhold: boolean;
  onApply: (lines: PickedLine[]) => void;
  onClose: () => void;
}) {
  const [on, setOn] = useState<Set<string>>(() => new Set(current.map((l) => l.key)));
  const [spread, setSpread] = useState("");
  const allOn = bills.length > 0 && bills.every((b) => on.has(b.key));
  const toggle = (id: string, v: boolean) =>
    setOn((x) => {
      const next = new Set(x);
      if (v) next.add(id);
      else next.delete(id);
      return next;
    });

  const kept = (b: OpenBill) => current.find((l) => l.key === b.key);
  const clearOf = (b: OpenBill) => cashToClear(b, b.paid, withhold ? kept(b)?.withhold ?? true : false);
  const chosen = bills.filter((b) => on.has(b.key));
  const clearTotal = chosen.reduce((a, b) => a + clearOf(b), 0);
  const amount = Number(spread) || 0;

  const apply = () => {
    let left = amount;
    const out: PickedLine[] = [];
    for (const b of chosen) {
      const w = kept(b)?.withhold ?? true;
      if (amount > 0) {
        const take = Math.min(left, clearOf(b));
        if (take <= 0) continue;
        left -= take;
        out.push({ key: b.key, kind: b.kind, docId: b.id, cash: String(take), withhold: w });
      } else {
        out.push(kept(b) ?? { key: b.key, kind: b.kind, docId: b.id, cash: String(clearOf(b)), withhold: w });
      }
    }
    onApply(out);
  };

  return (
    <Dialog
      open
      icon="wallet"
      title={`Pilih ${noun}`}
      subtitle={`${partnerName} · uang muka diterbitkan dan faktur diposting yang belum lunas`}
      width={880}
      onClose={onClose}
      foot={
        <>
          <span className="fnote">
            {chosen.length
              ? `${chosen.length} dipilih · lunas bila diterima ${formatMoney(clearTotal, "IDR")}`
              : "Centang tagihan yang dibayar customer."}
          </span>
          <button className="btn" onClick={onClose}>
            Batal
          </button>
          <button className="btn primary" onClick={apply}>
            <Icon name="check" size={15} /> Terapkan
          </button>
        </>
      }
    >
      <div className="tw">
        <table className="grid ltab" style={{ minWidth: 760 }}>
          <thead>
            <tr>
              <th className="pick">
                <input
                  type="checkbox"
                  checked={allOn}
                  aria-label="Pilih semua"
                  onChange={(e) => setOn(new Set(e.target.checked ? bills.map((b) => b.key) : []))}
                />
              </th>
              <th>{noun}</th>
              <th style={{ width: 118 }}>Tanggal</th>
              <th className="num" style={{ width: 130 }}>
                Total
              </th>
              <th className="num" style={{ width: 120 }}>
                Sudah Dibayar
              </th>
              <th className="num" style={{ width: 130 }}>
                Sisa
              </th>
            </tr>
          </thead>
          <tbody>
            {bills.map((b) => {
              const v = on.has(b.key);
              return (
                <tr key={b.key} className={v ? "clk" : "clk unpicked"} onClick={() => toggle(b.key, !v)}>
                  <td className="pick">
                    <input
                      type="checkbox"
                      checked={v}
                      aria-label={`Pilih ${b.no}`}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => toggle(b.key, e.target.checked)}
                    />
                  </td>
                  <td>
                    <span className="dstack">
                      <span className="d1">
                        <span className={`bdg ${b.kind === "sal_invoice" ? "t-info" : "t-vio"}`}>{SETTLED_DOC_TEXT[b.kind]}</span>{" "}
                        <span className="mono">{b.no}</span>
                      </span>
                      <span className="d2">{b.orderNo}</span>
                    </span>
                  </td>
                  <td>
                    <span className="dstack">
                      <span>{formatDate(b.date)}</span>
                      <span className="d2">jt {formatDate(b.dueDate)}</span>
                    </span>
                  </td>
                  <td className="num">
                    <span className="mny">{formatMoney(b.total, "IDR")}</span>
                  </td>
                  <td className="num">
                    {b.paid ? <span className="mny">{formatMoney(b.paid, "IDR")}</span> : <span className="dash">—</span>}
                  </td>
                  <td className="num">
                    <span className="mny">{formatMoney(b.open, "IDR")}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <FormRow>
        <Field label="Bagikan Dana" span={6} help="opsional — dibagi ke tagihan terpilih dari yang terlama">
          <MoneyInput value={spread} currencyLabel="IDR" ariaLabel="Bagikan Dana" onChange={setSpread} />
        </Field>
        <Field label="Artinya" span={6}>
          <div className="ro">
            {!amount
              ? "Setiap tagihan terpilih diisi nilai yang melunasinya."
              : amount >= clearTotal
                ? "Cukup melunasi semua tagihan terpilih."
                : `Kurang ${formatMoney(clearTotal - amount, "IDR")} — tagihan terakhir yang terjangkau dibayar sebagian.`}
          </div>
        </Field>
      </FormRow>
    </Dialog>
  );
}
