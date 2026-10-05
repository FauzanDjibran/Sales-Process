"use client";

import { useState } from "react";
import { Icon } from "@/components/icon";
import { Dialog } from "@/components/ui/dialog";
import { MoneyInput } from "@/components/ui/money-input";
import type { DnSourceLine } from "@/lib/erp/delivery-note";
import type { LotOption } from "@/lib/erp/inventory";
import { formatDate, formatNumber } from "@/lib/format";

const qtyText = (n: number) => formatNumber(n, n % 1 ? 2 : 0);
const SCALE = 10_000;
const units = (v: string | number) => Math.round((Number(String(v).replace(",", ".")) || 0) * SCALE);

export type LotPick = { lot_id: number; qty: string };

/**
 * The stock picking of one Delivery Note line (U15): the item's lots in the
 * note's warehouse, earliest expiry first, each with the quantity taken from
 * it. Together they may not pass the line's quantity; a Draft may be picked in
 * part, Posting needs it whole. *Isi FEFO* puts the rest on the earliest lot.
 */
export function DeliveryNoteLotPicker({
  line,
  lots,
  lineQty,
  current,
  shipDate,
  onApply,
  onClose,
}: {
  line: DnSourceLine;
  lots: LotOption[];
  lineQty: number;
  current: LotPick[];
  /** Tanggal Kirim, to flag a lot that expires before the goods leave. */
  shipDate: string;
  onApply: (picks: LotPick[]) => void;
  onClose: () => void;
}) {
  const [qty, setQty] = useState<Record<number, string>>(() =>
    Object.fromEntries(current.map((p) => [p.lot_id, p.qty]))
  );
  const shown = lots.filter((l) => l.active || qty[l.id] !== undefined);
  const total = shown.reduce((s, l) => s + units(qty[l.id] ?? 0), 0);
  const target = units(lineQty);
  const over = total > target;
  const firstActive = shown.find((l) => l.active);

  const fillFefo = () => {
    if (!firstActive) return;
    const rest = target - total;
    if (rest <= 0) return;
    setQty((q) => ({ ...q, [firstActive.id]: String((units(q[firstActive.id] ?? 0) + rest) / SCALE) }));
  };

  const apply = () =>
    onApply(
      shown.flatMap((l) => (units(qty[l.id] ?? 0) > 0 ? [{ lot_id: l.id, qty: String(units(qty[l.id]) / SCALE) }] : []))
    );

  return (
    <Dialog
      open
      icon="layers"
      title="Pilih Lot"
      subtitle={`${line.itemLabel} · ${line.itemName} · Qty baris ${qtyText(lineQty)} ${line.uomLabel}`}
      width={720}
      onClose={onClose}
      foot={
        <>
          <span className="fnote">
            Terpilih{" "}
            <b className="mono" style={{ color: over ? "var(--bad)" : total === target ? "var(--ok)" : undefined }}>
              {qtyText(total / SCALE)} / {qtyText(lineQty)} {line.uomLabel}
            </b>
            {over ? " · melebihi Qty baris" : total < target ? " · posting butuh lot penuh" : ""}
          </span>
          <button className="btn" onClick={onClose}>
            Batal
          </button>
          <button className="btn primary" disabled={over} onClick={apply}>
            <Icon name="check" size={15} /> Terapkan
          </button>
        </>
      }
    >
      {shown.length === 0 ? (
        <div className="empty sm">
          <div className="ic">
            <Icon name="box" size={18} />
          </div>
          <h4>Belum ada lot</h4>
          <p>Barang ini belum punya lot aktif di gudang Delivery Order.</p>
        </div>
      ) : (
        <>
          <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
            <button className="btn sm" disabled={!firstActive || total >= target} onClick={fillFefo}>
              <Icon name="clock" size={14} /> Isi FEFO
            </button>
          </div>
          <div className="tw">
            <table className="grid ltab" style={{ minWidth: 620 }}>
              <thead>
                <tr>
                  <th>No. Lot</th>
                  <th style={{ width: 170 }}>Kadaluarsa</th>
                  <th style={{ width: 220 }}>Qty Diambil</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((l) => {
                  const expired = Boolean(l.expiry && shipDate && l.expiry < shipDate);
                  return (
                    <tr key={l.id}>
                      <td>
                        <span className="lab">{l.lotNo}</span>
                        {!l.active && <span className="bdg s-mute" style={{ marginLeft: 6 }}>Nonaktif</span>}
                      </td>
                      <td>
                        {l.expiry ? <span className="mono">{formatDate(l.expiry)}</span> : <span className="dash">—</span>}
                        {expired && <span className="overtag">Kadaluarsa sebelum Tanggal Kirim</span>}
                      </td>
                      <td>
                        <div className="qcell">
                          <MoneyInput
                            size="sm"
                            decimals={4}
                            value={qty[l.id] ?? ""}
                            over={over && units(qty[l.id] ?? 0) > 0}
                            ariaLabel={`Qty lot ${l.lotNo}`}
                            onChange={(v) => setQty((q) => ({ ...q, [l.id]: v }))}
                          />
                          <span className="qu">{line.uomLabel}</span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Dialog>
  );
}
