"use client";

import { useState } from "react";
import { Icon } from "@/components/icon";
import { Dialog } from "@/components/ui/dialog";
import type { PiAdvance, PiReceiptLine } from "@/lib/erp/ap-invoice";
import { formatDate, formatMoney, formatNumber } from "@/lib/format";

const money = (n: number) => formatMoney(n, "IDR");
const qtyText = (n: number) => formatNumber(n, n % 1 ? 2 : 0);

/** Tick receipt lines, or the PO's Uang Muka items, to put on the invoice. */
export function PurchaseInvoicePicker({
  kind,
  lines,
  advances,
  currentLines,
  currentAdvances,
  onApply,
  onClose,
}: {
  kind: "lines" | "advances";
  lines: PiReceiptLine[];
  advances: PiAdvance[];
  currentLines: number[];
  currentAdvances: number[];
  onApply: (ids: number[]) => void;
  onClose: () => void;
}) {
  const [on, setOn] = useState<Set<number>>(() => new Set(kind === "lines" ? currentLines : currentAdvances));
  const rows =
    kind === "lines"
      ? lines.map((l) => ({ id: l.id, can: !l.billedBy || currentLines.includes(l.id), a: `${l.rnNo} · ${formatDate(l.rnDate)}`, b: `${l.itemLabel} — ${qtyText(l.qty)} ${l.uomLabel}`, c: l.billedBy ? `ditagih ${l.billedBy.no}` : money(l.value) }))
      : advances.map((a) => {
          const free = Math.max(0, a.balance - a.reserved);
          return { id: a.id, can: free > 0 || currentAdvances.includes(a.id), a: a.apItemNo, b: `${a.sourceNo} · dibayar ${a.createdByNo}`, c: money(free) };
        });
  const toggle = (id: number) =>
    setOn((x) => {
      const n = new Set(x);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  return (
    <Dialog
      open
      icon={kind === "lines" ? "box" : "wallet"}
      title={kind === "lines" ? "Pilih Receipt Note" : "Pilih Uang Muka"}
      subtitle={kind === "lines" ? "Baris yang diposting dan belum ditagih" : "Uang muka Purchase Order ini yang masih bersisa"}
      width={720}
      onClose={onClose}
      foot={
        <>
          <span className="fnote">{on.size} dipilih</span>
          <button className="btn" onClick={onClose}>
            Batal
          </button>
          <button className="btn primary" onClick={() => onApply(rows.filter((r) => on.has(r.id)).map((r) => r.id))}>
            <Icon name="check" size={15} /> Terapkan
          </button>
        </>
      }
    >
      <div className="tw">
        <table className="grid ltab" style={{ minWidth: 520 }}>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className={r.can ? (on.has(r.id) ? "clk" : "clk unpicked") : "unpicked"} onClick={r.can ? () => toggle(r.id) : undefined}>
                <td className="pick">
                  <input type="checkbox" checked={on.has(r.id)} disabled={!r.can} aria-label={`Pilih ${r.a}`} onClick={(e) => e.stopPropagation()} onChange={() => toggle(r.id)} />
                </td>
                <td>
                  <span className="mono">{r.a}</span>
                </td>
                <td>{r.b}</td>
                <td className="num">
                  <span className="mny">{r.c}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Dialog>
  );
}
