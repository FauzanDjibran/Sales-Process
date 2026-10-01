"use client";

import { useState } from "react";
import { Icon } from "@/components/icon";
import { Dialog } from "@/components/ui/dialog";
import type { SoSourceLine } from "@/lib/erp/sales-order";
import { formatNumber } from "@/lib/format";

const qtyText = (n: number) => formatNumber(n, n % 1 ? 2 : 0);

/**
 * The Customer Order's lines, to tick the ones this Sales Order delivers
 * (P81). What helps choose — the ordered quantity, what other Sales Orders
 * already hold, what is left — lives here, so the page's lines hold only the
 * quantity to type. A line with nothing left is shown but cannot be ticked;
 * a line already on the page stays ticked and keeps its quantity.
 */
export function SalesOrderLinePicker({
  lines,
  current,
  orderNo,
  onApply,
  onClose,
}: {
  lines: SoSourceLine[];
  current: number[];
  orderNo: string;
  onApply: (ids: number[]) => void;
  onClose: () => void;
}) {
  const [on, setOn] = useState<Set<number>>(() => new Set(current));
  const leftOf = (l: SoSourceLine) => Math.max(0, l.qty - l.held);
  const pickable = lines.filter((l) => leftOf(l) > 0 || on.has(l.id));
  const allOn = pickable.length > 0 && pickable.every((l) => on.has(l.id));
  const toggle = (id: number, v: boolean) =>
    setOn((x) => {
      const next = new Set(x);
      if (v) next.add(id);
      else next.delete(id);
      return next;
    });

  return (
    <Dialog
      open
      icon="box"
      title="Pilih Barang dari Customer Order"
      subtitle={`${orderNo} · centang barang yang dikirim di Sales Order ini`}
      width={760}
      onClose={onClose}
      foot={
        <>
          <span className="fnote">
            {on.size ? `${on.size} barang dipilih · Qty diisi di baris` : "Centang barang yang akan dikirim."}
          </span>
          <button className="btn" onClick={onClose}>
            Batal
          </button>
          <button className="btn primary" onClick={() => onApply(lines.filter((l) => on.has(l.id)).map((l) => l.id))}>
            <Icon name="check" size={15} /> Terapkan
          </button>
        </>
      }
    >
      <div className="tw">
        <table className="grid ltab" style={{ minWidth: 640 }}>
          <thead>
            <tr>
              <th className="pick">
                <input
                  type="checkbox"
                  checked={allOn}
                  aria-label="Pilih semua"
                  onChange={(e) => setOn(new Set(e.target.checked ? pickable.map((l) => l.id) : []))}
                />
              </th>
              <th>Barang</th>
              <th className="num" style={{ width: 120 }}>
                Qty CO
              </th>
              <th className="num" style={{ width: 120 }}>
                Sudah di-SO
              </th>
              <th className="num" style={{ width: 120 }}>
                Sisa
              </th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => {
              const left = leftOf(l);
              const v = on.has(l.id);
              const can = left > 0 || v;
              return (
                <tr
                  key={l.id}
                  className={can ? (v ? "clk" : "clk unpicked") : "unpicked"}
                  onClick={can ? () => toggle(l.id, !v) : undefined}
                >
                  <td className="pick">
                    <input
                      type="checkbox"
                      checked={v}
                      disabled={!can}
                      aria-label={`Pilih ${l.itemLabel}`}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => toggle(l.id, e.target.checked)}
                    />
                  </td>
                  <td>
                    <span className="idc">
                      <span className="lab">{l.itemLabel}</span>
                      <span className="nm">{l.itemName}</span>
                    </span>
                  </td>
                  <td className="num">
                    <span className="mny">
                      {qtyText(l.qty)} {l.uomLabel}
                    </span>
                  </td>
                  <td className="num">
                    {l.held ? (
                      <span className="mny">
                        {qtyText(l.held)} {l.uomLabel}
                      </span>
                    ) : (
                      <span className="dash">—</span>
                    )}
                  </td>
                  <td className="num">
                    {left > 0 ? (
                      <span className="mny">
                        {qtyText(left)} {l.uomLabel}
                      </span>
                    ) : (
                      <span className="bdg s-mute">Habis</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Dialog>
  );
}
