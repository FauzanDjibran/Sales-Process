"use client";

import { useState } from "react";
import { Icon } from "@/components/icon";
import { Dialog } from "@/components/ui/dialog";
import { SearchField } from "@/components/ui/search-field";
import type { PoSourceLine } from "@/lib/erp/purchase-request";
import { formatDate, formatNumber } from "@/lib/format";

const qtyText = (n: number) => formatNumber(n, n % 1 ? 2 : 0);

/**
 * The Open Purchase Request lines of the order's kind, to tick the ones this
 * Purchase Order buys (B13). Lines of one item are merged into one PO line by
 * the form (B9). What helps choose — the request, when it is needed, what it
 * asks, what other orders already took and what is left — lives here.
 */
export function PurchaseOrderRequestPicker({
  sources,
  current,
  onApply,
  onClose,
}: {
  sources: PoSourceLine[];
  current: number[];
  onApply: (ids: number[]) => void;
  onClose: () => void;
}) {
  const [on, setOn] = useState<Set<number>>(() => new Set(current));
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const leftOf = (l: PoSourceLine) => Math.max(0, l.qty - l.ordered);
  const shown = sources.filter(
    (l) => (l.requestOpen && leftOf(l) > 0) || on.has(l.id)
  ).filter((l) => !q || `${l.requestNo} ${l.itemLabel} ${l.itemName}`.toLowerCase().includes(q));
  const allOn = shown.length > 0 && shown.every((l) => on.has(l.id));
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
      icon="clip"
      title="Pilih dari Purchase Request"
      subtitle="Baris Purchase Request yang Open; barang yang sama digabung menjadi satu baris PO"
      width={860}
      onClose={onClose}
      foot={
        <>
          <span className="fnote">{on.size ? `${on.size} baris PR dipilih` : "Centang baris yang akan dipesan."}</span>
          <button className="btn" onClick={onClose}>
            Batal
          </button>
          <button className="btn primary" onClick={() => onApply(sources.filter((l) => on.has(l.id)).map((l) => l.id))}>
            <Icon name="check" size={15} /> Terapkan
          </button>
        </>
      }
    >
      <div className="toolbar" style={{ padding: "0 0 10px" }}>
        <SearchField value={query} onChange={setQuery} placeholder="Cari nomor PR atau barang…" />
      </div>
      {shown.length === 0 ? (
        <div className="empty sm">
          <h4>Tidak ada baris Purchase Request</h4>
          <p>Belum ada Purchase Request yang Open dengan sisa yang belum dipesan.</p>
        </div>
      ) : (
        <div className="tw">
          <table className="grid ltab" style={{ minWidth: 760 }}>
            <thead>
              <tr>
                <th className="pick">
                  <input
                    type="checkbox"
                    checked={allOn}
                    aria-label="Pilih semua"
                    onChange={(e) => setOn((x) => new Set(e.target.checked ? [...x, ...shown.map((l) => l.id)] : [...x].filter((id) => !shown.some((l) => l.id === id))))}
                  />
                </th>
                <th style={{ width: 150 }}>Purchase Request</th>
                <th>Barang</th>
                <th style={{ width: 110 }}>Dibutuhkan</th>
                <th className="num" style={{ width: 110 }}>Qty PR</th>
                <th className="num" style={{ width: 110 }}>Sudah di-PO</th>
                <th className="num" style={{ width: 110 }}>Sisa</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((l) => {
                const v = on.has(l.id);
                return (
                  <tr key={l.id} className={v ? "clk" : "clk unpicked"} onClick={() => toggle(l.id, !v)}>
                    <td className="pick">
                      <input
                        type="checkbox"
                        checked={v}
                        aria-label={`Pilih ${l.requestNo} ${l.itemLabel}`}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => toggle(l.id, e.target.checked)}
                      />
                    </td>
                    <td>
                      <span className="mono">{l.requestNo}</span>
                    </td>
                    <td>
                      <span className="idc">
                        <span className="lab">{l.itemLabel}</span>
                        <span className="nm">{l.itemName}</span>
                      </span>
                    </td>
                    <td>{formatDate(l.neededDate)}</td>
                    <td className="num">
                      <span className="mny">
                        {qtyText(l.qty)} {l.uomLabel}
                      </span>
                    </td>
                    <td className="num">{l.ordered ? <span className="mny">{qtyText(l.ordered)}</span> : <span className="dash">—</span>}</td>
                    <td className="num">
                      <span className="mny">
                        {qtyText(leftOf(l))} {l.uomLabel}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Dialog>
  );
}
