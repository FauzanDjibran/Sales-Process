"use client";

import { useState } from "react";
import { Icon } from "@/components/icon";
import { Dialog } from "@/components/ui/dialog";
import type { ReturnSourceLine } from "@/lib/erp/sales-return";
import { formatDate, formatNumber } from "@/lib/format";

const qtyText = (n: number) => formatNumber(n, n % 1 ? 2 : 0);

/**
 * The posted Delivery Note lines of the chosen Customer Order, to tick the ones
 * coming back (P287). Each row says which note and when it left, what left,
 * what other returns already hold, what is left, and which Invoice billed it —
 * information only: a billed line is credited later by a Credit Note. A line
 * with nothing left is shown but cannot be ticked.
 */
export function SalesReturnLinePicker({
  lines,
  current,
  orderNo,
  billing,
  onApply,
  onClose,
}: {
  lines: ReturnSourceLine[];
  current: number[];
  orderNo: string;
  billing: Record<number, { no: string }>;
  onApply: (ids: number[]) => void;
  onClose: () => void;
}) {
  const [on, setOn] = useState<Set<number>>(() => new Set(current));
  const leftOf = (l: ReturnSourceLine) => Math.max(0, l.baseQty - l.held);
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
      title="Pilih Barang dari Delivery Note"
      subtitle={`${orderNo} · centang barang Delivery Note yang dikembalikan customer`}
      width={900}
      onClose={onClose}
      foot={
        <>
          <span className="fnote">
            {on.size ? `${on.size} barang dipilih · Qty diisi di baris` : "Centang barang yang dikembalikan."}
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
        <table className="grid ltab" style={{ minWidth: 860 }}>
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
              <th style={{ width: 190 }}>Delivery Note</th>
              <th>Barang</th>
              <th className="num" style={{ width: 110 }}>
                Qty Kirim
              </th>
              <th className="num" style={{ width: 120 }}>
                Sudah Diretur
              </th>
              <th className="num" style={{ width: 110 }}>
                Sisa
              </th>
              <th style={{ width: 150 }}>Ditagih</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => {
              const left = leftOf(l);
              const v = on.has(l.id);
              const can = left > 0 || v;
              const bill = billing[l.id];
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
                      aria-label={`Pilih ${l.itemLabel} dari ${l.dnNo}`}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => toggle(l.id, e.target.checked)}
                    />
                  </td>
                  <td>
                    <span className="idc">
                      <span className="lab">{l.dnNo}</span>
                      <span className="nm">kirim {formatDate(l.dnDate)}</span>
                    </span>
                  </td>
                  <td>
                    <span className="idc">
                      <span className="lab">{l.itemLabel}</span>
                      <span className="nm">{l.itemName}</span>
                    </span>
                  </td>
                  <td className="num">
                    <span className="mny">
                      {qtyText(l.baseQty)} {l.uomLabel}
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
                  <td>{bill ? <span className="lab">{bill.no}</span> : <span className="dash">belum ditagih</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Dialog>
  );
}
