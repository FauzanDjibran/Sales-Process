"use client";

import { useState } from "react";
import { Icon } from "@/components/icon";
import { Dialog } from "@/components/ui/dialog";
import { MoneyInput } from "@/components/ui/money-input";
import { Select } from "@/components/ui/select";
import type { ReceiptSourceTracking } from "@/lib/erp/stock-transfer-receipt";
import type { WarehouseLocationOption } from "@/lib/erp/inventory";
import { formatDate, formatNumber } from "@/lib/format";

export type TransferReceiptLot = { key: string; transfer_tracking_id: number; location_id: number | null; qty: string };

let seq = 0;
export const newTransferLotKey = () => `tl${Date.now().toString(36)}${seq++}`;
const qtyText = (n: number) => formatNumber(n, n % 1 ? 2 : 0);
const units = (v: string | number) => Math.round((Number(v) || 0) * 10_000);

/**
 * How one received line comes in lot by lot (P300, the pattern of P290): every
 * lot the Transfer Kirim sent on that line is a row — its No. Stok, expiry and
 * stock status travel with it — and the receiver types how much arrived and,
 * where the destination keeps them, in which location. *Bagi* adds a second
 * row of the same lot for another location. A row left at 0 is dropped.
 */
export function TransferReceiptLotDialog({
  itemLabel,
  uomLabel,
  lineQty,
  trackings,
  locations,
  lots: initial,
  onApply,
  onClose,
}: {
  itemLabel: string;
  uomLabel: string;
  lineQty: number;
  trackings: ReceiptSourceTracking[];
  locations: WarehouseLocationOption[] | null;
  lots: TransferReceiptLot[];
  onApply: (lots: TransferReceiptLot[]) => void;
  onClose: () => void;
}) {
  const [rows, setRows] = useState<TransferReceiptLot[]>(() => [
    ...initial,
    ...trackings.filter((t) => !initial.some((x) => x.transfer_tracking_id === t.id)).map((t) => ({ key: newTransferLotKey(), transfer_tracking_id: t.id, location_id: null, qty: "" })),
  ]);
  const byId = new Map(trackings.map((t) => [t.id, t]));
  const set = (key: string, patch: Partial<TransferReceiptLot>) => setRows((rs) => rs.map((x) => (x.key === key ? { ...x, ...patch } : x)));
  const rest = units(lineQty) - rows.reduce((s, x) => s + units(x.qty), 0);

  return (
    <Dialog
      open
      icon="box"
      title="Atur Lot"
      subtitle={`${itemLabel} · ${qtyText(lineQty)} ${uomLabel} diterima`}
      width={locations ? 900 : 760}
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
          <button className="btn primary" onClick={() => onApply(rows.filter((x) => units(x.qty) > 0))}>
            <Icon name="check" size={15} /> Terapkan
          </button>
        </>
      }
    >
      <div className="tw">
        <table className="grid ltab" style={{ minWidth: locations ? 840 : 700 }}>
          <thead>
            <tr>
              <th>Lot</th>
              <th style={{ width: 110 }}>Kadaluarsa</th>
              <th style={{ width: 120 }}>Status Stok</th>
              <th className="num" style={{ width: 110 }}>
                Sisa
              </th>
              {locations && <th style={{ width: 160 }}>Lokasi</th>}
              <th style={{ width: 150 }}>Qty</th>
              <th style={{ width: 70 }} />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const t = byId.get(r.transfer_tracking_id);
              return (
                <tr key={r.key} style={{ cursor: "default" }}>
                  <td>
                    <span className="lab">{t?.trackingNo}</span>
                  </td>
                  <td>{t?.expiry ? formatDate(t.expiry) : <span className="dash">—</span>}</td>
                  <td>
                    <span className={`bdg ${t?.statusName === "Tersedia" ? "t-slate" : "t-warn"}`}>{t?.statusName}</span>
                  </td>
                  <td className="num">
                    <span className="mny">
                      {qtyText(t?.room ?? 0)} {uomLabel}
                    </span>
                  </td>
                  {locations && (
                    <td>
                      <Select
                        value={r.location_id ? String(r.location_id) : ""}
                        options={locations.filter((x) => x.active || x.id === r.location_id).map((x) => ({ value: String(x.id), label: x.label }))}
                        placeholder="Pilih Lokasi…"
                        onChange={(v) => set(r.key, { location_id: v ? Number(v) : null })}
                      />
                    </td>
                  )}
                  <td>
                    <div className="qcell">
                      <MoneyInput size="sm" decimals={4} value={r.qty} ariaLabel={`Qty lot ${t?.trackingNo ?? ""}`} onChange={(v) => set(r.key, { qty: v })} />
                      <span className="qu">{uomLabel}</span>
                    </div>
                  </td>
                  <td>
                    {locations && (
                      <button
                        className="btn sm"
                        title="Bagi lot ini ke lokasi lain"
                        onClick={() =>
                          setRows((rs) => {
                            const at = rs.findIndex((x) => x.key === r.key);
                            return [...rs.slice(0, at + 1), { key: newTransferLotKey(), transfer_tracking_id: r.transfer_tracking_id, location_id: null, qty: "" }, ...rs.slice(at + 1)];
                          })
                        }
                      >
                        Bagi
                      </button>
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
