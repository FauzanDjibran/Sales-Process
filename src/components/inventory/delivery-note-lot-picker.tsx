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
 * The stock picking of one Delivery Note line (U15, P120): the item's lots
 * with stock in the note's warehouse, earliest expiry first, each with what is
 * available and the quantity taken from it. Together they may not pass the
 * line's quantity; a Draft may be picked in part, Posting needs it whole, and
 * the stock must still be there when it posts. *Isi FEFO* fills the rest lot
 * by lot from the earliest, up to what each holds.
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
  const short = (l: LotOption) => units(qty[l.id] ?? 0) > units(l.available);

  const fillFefo = () => {
    let rest = target - total;
    if (rest <= 0) return;
    const next = { ...qty };
    for (const l of shown) {
      if (rest <= 0) break;
      const room = units(l.available) - units(next[l.id] ?? 0);
      if (room <= 0) continue;
      const take = Math.min(room, rest);
      next[l.id] = String((units(next[l.id] ?? 0) + take) / SCALE);
      rest -= take;
    }
    setQty(next);
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
          <h4>Belum ada stok</h4>
          <p>Barang ini tidak punya stok tersedia di gudang Delivery Order.</p>
        </div>
      ) : (
        <>
          <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
            <button className="btn sm" disabled={!firstActive || total >= target} onClick={fillFefo}>
              <Icon name="clock" size={14} /> Isi FEFO
            </button>
          </div>
          <div className="tw">
            <table className="grid ltab" style={{ minWidth: 700 }}>
              <thead>
                <tr>
                  <th>No. Lot</th>
                  <th style={{ width: 150 }}>Kadaluarsa</th>
                  <th className="num" style={{ width: 120 }}>Tersedia</th>
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
                        {!l.active && <span className="bdg s-mute" style={{ marginLeft: 6 }}>Habis</span>}
                      </td>
                      <td>
                        {l.expiry ? <span className="mono">{formatDate(l.expiry)}</span> : <span className="dash">—</span>}
                        {expired && <span className="overtag">Kadaluarsa sebelum Tanggal Kirim</span>}
                      </td>
                      <td className="num">
                        <span className="mny">{qtyText(l.available)}</span>
                      </td>
                      <td>
                        <div className="qcell">
                          <MoneyInput
                            size="sm"
                            decimals={4}
                            value={qty[l.id] ?? ""}
                            over={(over && units(qty[l.id] ?? 0) > 0) || short(l)}
                            ariaLabel={`Qty lot ${l.lotNo}`}
                            onChange={(v) => setQty((q) => ({ ...q, [l.id]: v }))}
                          />
                          <span className="qu">{line.uomLabel}</span>
                        </div>
                        {short(l) && <span className="overtag">Melebihi stok tersedia</span>}
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
