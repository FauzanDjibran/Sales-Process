"use client";

import { useState } from "react";
import { Icon } from "@/components/icon";
import { Dialog } from "@/components/ui/dialog";
import type { DnSourceLine } from "@/lib/erp/delivery-note";
import { formatNumber } from "@/lib/format";

const qtyText = (n: number) => formatNumber(n, n % 1 ? 2 : 0);

/**
 * The Delivery Order's lines, to tick the ones leaving on this note. Each row
 * says which Sales Order it serves, with the quantity ordered, what other notes
 * already sent or reserved, and what is left, so the page's lines hold only the
 * quantity to type. A line with nothing left is shown but cannot be ticked; a
 * line already on the page stays ticked and keeps its quantity.
 */
export function DeliveryNoteLinePicker({
  lines,
  current,
  orderNo,
  onApply,
  onClose,
}: {
  lines: DnSourceLine[];
  current: number[];
  orderNo: string;
  onApply: (ids: number[]) => void;
  onClose: () => void;
}) {
  const [on, setOn] = useState<Set<number>>(() => new Set(current));
  const leftOf = (l: DnSourceLine) => Math.max(0, l.qty - l.held);
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
      title="Pilih Barang dari Delivery Order"
      subtitle={`${orderNo} · centang barang yang keluar dengan Delivery Note ini`}
      width={860}
      onClose={onClose}
      foot={
        <>
          <span className="fnote">
            {on.size ? `${on.size} barang dipilih · Qty diisi di baris` : "Centang barang yang dikirim."}
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
        <table className="grid ltab" style={{ minWidth: 800 }}>
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
              <th style={{ width: 170 }}>Sales Order</th>
              <th>Barang</th>
              <th className="num" style={{ width: 110 }}>
                Qty DO
              </th>
              <th className="num" style={{ width: 130 }}>
                Sudah Dikirim
              </th>
              <th className="num" style={{ width: 110 }}>
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
                      aria-label={`Pilih ${l.itemLabel} dari ${l.salesOrderNo}`}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => toggle(l.id, e.target.checked)}
                    />
                  </td>
                  <td>
                    <span className="lab">{l.salesOrderNo}</span>
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
