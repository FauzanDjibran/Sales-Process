"use client";

import { useState } from "react";
import { Icon } from "@/components/icon";
import { Dialog } from "@/components/ui/dialog";
import { Field, FormRow } from "@/components/ui/form";
import { MoneyInput } from "@/components/ui/money-input";
import { cashToClear } from "@/lib/erp/sales-tax";
import type { OpenBill } from "@/lib/erp/cash-bank-tx";
import { formatDate, formatMoney } from "@/lib/format";

/** A bill on the Penerimaan: what was received for it, and whether PPh was withheld. */
export type PickedLine = { docId: number; cash: string; withhold: boolean };

/**
 * The partner's open bills, to tick the ones being paid. What helps choose —
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
  const [on, setOn] = useState<Set<number>>(() => new Set(current.map((l) => l.docId)));
  const [spread, setSpread] = useState("");
  const allOn = bills.length > 0 && bills.every((b) => on.has(b.id));
  const toggle = (id: number, v: boolean) =>
    setOn((x) => {
      const next = new Set(x);
      if (v) next.add(id);
      else next.delete(id);
      return next;
    });

  const kept = (b: OpenBill) => current.find((l) => l.docId === b.id);
  const clearOf = (b: OpenBill) => cashToClear(b, b.paid, withhold ? kept(b)?.withhold ?? true : false);
  const chosen = bills.filter((b) => on.has(b.id));
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
        out.push({ docId: b.id, cash: String(take), withhold: w });
      } else {
        out.push(kept(b) ?? { docId: b.id, cash: String(clearOf(b)), withhold: w });
      }
    }
    onApply(out);
  };

  return (
    <Dialog
      open
      icon="wallet"
      title={`Pilih ${noun}`}
      subtitle={`${partnerName} · ${noun.toLowerCase()} diterbitkan yang belum lunas`}
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
                  onChange={(e) => setOn(new Set(e.target.checked ? bills.map((b) => b.id) : []))}
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
              const v = on.has(b.id);
              return (
                <tr key={b.id} className={v ? "clk" : "clk unpicked"} onClick={() => toggle(b.id, !v)}>
                  <td className="pick">
                    <input
                      type="checkbox"
                      checked={v}
                      aria-label={`Pilih ${b.advanceNo}`}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => toggle(b.id, e.target.checked)}
                    />
                  </td>
                  <td>
                    <span className="dstack">
                      <span className="d1 mono">{b.advanceNo}</span>
                      <span className="d2">{b.orderNo}</span>
                    </span>
                  </td>
                  <td>
                    <span className="dstack">
                      <span>{formatDate(b.advanceDate)}</span>
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
