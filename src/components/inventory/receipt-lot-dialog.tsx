"use client";

import { useState } from "react";
import { Icon } from "@/components/icon";
import { Combobox } from "@/components/ui/combobox";
import { DateInput } from "@/components/ui/date-input";
import { Dialog } from "@/components/ui/dialog";
import { MoneyInput } from "@/components/ui/money-input";
import type { WarehouseLocationOption } from "@/lib/erp/inventory";
import { formatNumber } from "@/lib/format";

export type ReceiptLot = { key: string; tracking_no: string; expiry_date: string; location_id: number | null; qty: string };

let seq = 0;
export const newLotKey = () => `lot${Date.now().toString(36)}${seq++}`;
const qtyText = (n: number) => formatNumber(n, n % 1 ? 2 : 0);
const units = (v: string | number) => Math.round((Number(v) || 0) * 10_000);

/**
 * How one received line is split into lots (P125 B19), in a dialog so the line
 * itself only holds its quantity: each lot a No. Stok (left empty, it is
 * numbered at posting), an expiry, a location where the warehouse has any, and
 * its share of the quantity. The foot says how much of the line is split; the
 * server still refuses a posting whose lots do not add up to the line.
 */
export function ReceiptLotDialog({
  itemLabel,
  uomLabel,
  lineQty,
  hasExpiry,
  locations,
  lots: initial,
  onApply,
  onClose,
}: {
  itemLabel: string;
  uomLabel: string;
  lineQty: number;
  hasExpiry: boolean;
  /** The warehouse's locations, or null when it keeps none. */
  locations: WarehouseLocationOption[] | null;
  lots: ReceiptLot[];
  onApply: (lots: ReceiptLot[]) => void;
  onClose: () => void;
}) {
  // An empty line starts on one lot holding all of it.
  const [lots, setLots] = useState<ReceiptLot[]>(() =>
    initial.length ? initial : [{ key: newLotKey(), tracking_no: "", expiry_date: "", location_id: null, qty: lineQty ? String(lineQty) : "" }]
  );
  const set = (key: string, patch: Partial<ReceiptLot>) => setLots((ls) => ls.map((x) => (x.key === key ? { ...x, ...patch } : x)));
  const split = lots.reduce((s, x) => s + units(x.qty), 0);
  const rest = units(lineQty) - split;

  return (
    <Dialog
      open
      icon="box"
      title="Atur Lot"
      subtitle={`${itemLabel} · ${qtyText(lineQty)} ${uomLabel} diterima`}
      width={locations ? 860 : 700}
      onClose={onClose}
      foot={
        <>
          <span className="fnote">
            {rest === 0
              ? `Seluruh ${qtyText(lineQty)} ${uomLabel} sudah dibagi ke lot.`
              : rest > 0
                ? `Belum dibagi ${qtyText(rest / 10_000)} ${uomLabel}.`
                : `Lot melebihi Qty baris sebanyak ${qtyText(-rest / 10_000)} ${uomLabel}.`}
          </span>
          <button className="btn" onClick={onClose}>
            Batal
          </button>
          <button className="btn primary" onClick={() => onApply(lots.filter((x) => x.tracking_no.trim() || units(x.qty) > 0))}>
            <Icon name="check" size={15} /> Terapkan
          </button>
        </>
      }
    >
      <div className="tw">
        <table className="grid ltab" style={{ minWidth: locations ? 800 : 640 }}>
          <thead>
            <tr>
              <th style={{ width: 40 }}>No</th>
              <th>Lot</th>
              <th style={{ width: 170 }}>Kadaluarsa{hasExpiry ? " *" : ""}</th>
              {locations && <th style={{ width: 180 }}>Lokasi *</th>}
              <th style={{ width: 150 }}>Qty</th>
              <th style={{ width: 40 }} />
            </tr>
          </thead>
          <tbody>
            {lots.map((lot, i) => (
              <tr key={lot.key} style={{ cursor: "default" }}>
                <td className="no">{i + 1}</td>
                <td>
                  <input
                    className="inp sm idf"
                    value={lot.tracking_no}
                    placeholder="kosong = otomatis saat posting"
                    aria-label={`Lot ${i + 1}`}
                    autoFocus={i === 0}
                    onChange={(e) => set(lot.key, { tracking_no: e.target.value })}
                  />
                </td>
                <td>
                  <DateInput value={lot.expiry_date} placeholder={hasExpiry ? "Wajib" : "Opsional"} onChange={(v) => set(lot.key, { expiry_date: v })} />
                </td>
                {locations && (
                  <td>
                    <Combobox
                      value={lot.location_id}
                      options={locations}
                      placeholder="Pilih Lokasi…"
                      emptyText="Gudang ini belum punya lokasi aktif."
                      onChange={(v) => set(lot.key, { location_id: v })}
                    />
                  </td>
                )}
                <td>
                  <div className="qcell">
                    <MoneyInput size="sm" decimals={4} value={lot.qty} ariaLabel={`Qty lot ${i + 1}`} onChange={(v) => set(lot.key, { qty: v })} />
                    <span className="qu">{uomLabel}</span>
                  </div>
                </td>
                <td>
                  <button className="iact del" title="Hapus lot" onClick={() => setLots((ls) => ls.filter((x) => x.key !== lot.key))}>
                    <Icon name="trash" size={13} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ marginTop: 10 }}>
        <button
          className="btn sm"
          onClick={() =>
            setLots((ls) => [...ls, { key: newLotKey(), tracking_no: "", expiry_date: "", location_id: null, qty: rest > 0 ? String(rest / 10_000) : "" }])
          }
        >
          <Icon name="plus" size={13} /> Tambah Lot
        </button>
      </div>
    </Dialog>
  );
}
