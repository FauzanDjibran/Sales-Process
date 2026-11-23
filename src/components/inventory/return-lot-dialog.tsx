"use client";

import { useState } from "react";
import { Icon } from "@/components/icon";
import { Dialog } from "@/components/ui/dialog";
import { MoneyInput } from "@/components/ui/money-input";
import { Select } from "@/components/ui/select";
import type { RrSourceTracking } from "@/lib/erp/receipt-note";
import type { WarehouseLocationOption } from "@/lib/erp/inventory";
import { formatDate, formatNumber } from "@/lib/format";

export type ReturnLot = { key: string; source_tracking_id: number; qty: string; location_id: number | null; stock_status_id: number | null };

let seq = 0;
export const newReturnLotKey = () => `rl${Date.now().toString(36)}${seq++}`;
const qtyText = (n: number) => formatNumber(n, n % 1 ? 2 : 0);
const units = (v: string | number) => Math.round((Number(v) || 0) * 10_000);

/**
 * How one returned line comes back lot by lot (P288), in a dialog so the line
 * itself only holds its quantity. Every lot that left on the Delivery Note is a
 * row — its No. Stok and expiry are the ones it left with — and the warehouse
 * types how much of it came back, under which stock status and, where the
 * warehouse keeps them, in which location. *Bagi* adds a second row of the same
 * lot, for part of it held back or put elsewhere. A row left at 0 is dropped.
 */
export function ReturnLotDialog({
  itemLabel,
  uomLabel,
  lineQty,
  trackings,
  statuses,
  locations,
  defaultStatusId,
  lots: initial,
  onApply,
  onClose,
}: {
  itemLabel: string;
  uomLabel: string;
  lineQty: number;
  trackings: RrSourceTracking[];
  statuses: { id: number; name: string }[];
  /** The warehouse's locations, or null when it keeps none. */
  locations: WarehouseLocationOption[] | null;
  defaultStatusId: number | null;
  lots: ReturnLot[];
  onApply: (lots: ReturnLot[]) => void;
  onClose: () => void;
}) {
  // Every lot that left is offered; one not yet taken shows as an empty row. A
  // line not split yet starts with its quantity spread over the lots in order.
  const [rows, setRows] = useState<ReturnLot[]>(() => {
    let rest = units(lineQty);
    const spread = (t: RrSourceTracking) => {
      if (initial.length) return "";
      const take = Math.min(rest, units(t.room));
      rest -= take;
      return take > 0 ? String(take / 10_000) : "";
    };
    return [
      ...initial,
      ...trackings
        .filter((t) => !initial.some((x) => x.source_tracking_id === t.id))
        .map((t) => ({ key: newReturnLotKey(), source_tracking_id: t.id, qty: spread(t), location_id: null, stock_status_id: defaultStatusId })),
    ];
  });
  const byId = new Map(trackings.map((t) => [t.id, t]));
  const set = (key: string, patch: Partial<ReturnLot>) => setRows((rs) => rs.map((x) => (x.key === key ? { ...x, ...patch } : x)));
  const split = rows.reduce((s, x) => s + units(x.qty), 0);
  const rest = units(lineQty) - split;

  return (
    <Dialog
      open
      icon="box"
      title="Atur Lot"
      subtitle={`${itemLabel} · ${qtyText(lineQty)} ${uomLabel} diterima kembali`}
      width={locations ? 920 : 780}
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
        <table className="grid ltab" style={{ minWidth: locations ? 860 : 720 }}>
          <thead>
            <tr>
              <th>Lot</th>
              <th style={{ width: 120 }}>Kadaluarsa</th>
              <th className="num" style={{ width: 120 }}>
                Bisa Kembali
              </th>
              <th style={{ width: 150 }}>Status Stok</th>
              {locations && <th style={{ width: 150 }}>Lokasi</th>}
              <th style={{ width: 150 }}>Qty</th>
              <th style={{ width: 70 }} />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const t = byId.get(r.source_tracking_id);
              return (
                <tr key={r.key} style={{ cursor: "default" }}>
                  <td>
                    <span className="lab">{t?.trackingNo}</span>
                  </td>
                  <td>{t?.expiryDate ? formatDate(t.expiryDate) : <span className="dash">—</span>}</td>
                  <td className="num">
                    <span className="mny">
                      {qtyText(t?.room ?? 0)} {uomLabel}
                    </span>
                  </td>
                  <td>
                    <Select
                      value={r.stock_status_id ? String(r.stock_status_id) : ""}
                      options={statuses.map((s) => ({ value: String(s.id), label: s.name }))}
                      placeholder="Pilih Status…"
                      onChange={(v) => set(r.key, { stock_status_id: v ? Number(v) : null })}
                    />
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
                    <button
                      className="btn sm"
                      title="Bagi lot ini ke status atau lokasi lain"
                      onClick={() =>
                        setRows((rs) => {
                          const at = rs.findIndex((x) => x.key === r.key);
                          const copy = { key: newReturnLotKey(), source_tracking_id: r.source_tracking_id, qty: "", location_id: null, stock_status_id: defaultStatusId };
                          return [...rs.slice(0, at + 1), copy, ...rs.slice(at + 1)];
                        })
                      }
                    >
                      Bagi
                    </button>
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
