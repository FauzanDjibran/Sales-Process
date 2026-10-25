"use client";

import { useState } from "react";
import { Icon } from "@/components/icon";
import { Dialog } from "@/components/ui/dialog";
import { MoneyInput } from "@/components/ui/money-input";
import type { PlanDemandOption } from "@/lib/erp/production-plan";
import { formatDate, formatNumber } from "@/lib/format";

const qtyText = (n: number) => formatNumber(n, n % 1 ? 2 : 0);
const units = (n: number) => Math.round(n * 10_000);

/** What a Sales Order line has left for a plan: its quantity less delivered and less other live plans'. */
export const roomOf = (d: PlanDemandOption) => Math.max(0, (units(d.qty) - units(d.delivered) - units(d.reserved)) / 10_000);

export type DemandPick = { so_line_id: number; qty: string };

/**
 * The Sales Order lines of one item, to tick the ones a plan line covers (P168).
 * An Open order's line with something left can be taken, each with the part this
 * line covers — starting on all that is left; a Pra-SO is listed greyed, since
 * it may only buy material (P79). What helps choose lives here: the order, when
 * it is due, what it asks, what was delivered and what other plans already cover.
 */
export function ProductionPlanDemandPicker({
  item,
  demands,
  current,
  onApply,
  onClose,
}: {
  item: { label: string; name: string; uomLabel: string };
  /** Only this item's lines. */
  demands: PlanDemandOption[];
  current: DemandPick[];
  onApply: (picks: DemandPick[]) => void;
  onClose: () => void;
}) {
  const [on, setOn] = useState<Map<number, string>>(() => new Map(current.map((p) => [p.so_line_id, String(p.qty)])));
  const shown = demands.filter((d) => (d.status === "Open" && roomOf(d) > 0) || d.status === "PreSO" || on.has(d.id));
  const toggle = (d: PlanDemandOption, v: boolean) =>
    setOn((x) => {
      const next = new Map(x);
      if (v) next.set(d.id, String(roomOf(d)));
      else next.delete(d.id);
      return next;
    });
  const bad = [...on.entries()].some(([id, q]) => {
    const d = demands.find((x) => x.id === id);
    return !d || !(Number(q) > 0) || units(Number(q)) > units(roomOf(d));
  });
  const total = [...on.values()].reduce((s, q) => s + (Number(q) || 0), 0);

  return (
    <Dialog
      open
      icon="clip"
      title="Pilih Sales Order"
      subtitle={`${item.label} · ${item.name} — baris Sales Order yang Open, dengan jumlah yang dicakup baris rencana ini`}
      width={940}
      onClose={onClose}
      foot={
        <>
          <span className="fnote">{on.size ? `${on.size} baris · ${qtyText(total)} ${item.uomLabel}` : "Centang baris Sales Order yang dicakup."}</span>
          <button className="btn" onClick={onClose}>
            Batal
          </button>
          <button
            className="btn primary"
            disabled={bad}
            title={bad ? "Jumlah harus lebih dari 0 dan tidak melebihi sisa." : undefined}
            onClick={() => onApply(demands.filter((d) => on.has(d.id)).map((d) => ({ so_line_id: d.id, qty: on.get(d.id)! })))}
          >
            <Icon name="check" size={15} /> Terapkan
          </button>
        </>
      }
    >
      {shown.length === 0 ? (
        <div className="empty sm">
          <h4>Tidak ada baris Sales Order</h4>
          <p>Belum ada Sales Order Open untuk barang ini yang masih punya sisa. Rencana tetap bisa dibuat tanpa Sales Order (stok).</p>
        </div>
      ) : (
        <div className="tw">
          <table className="grid ltab" style={{ minWidth: 860 }}>
            <thead>
              <tr>
                <th className="pick" />
                <th style={{ width: 150 }}>Sales Order</th>
                <th style={{ width: 140 }}>Customer Order</th>
                <th style={{ width: 100 }}>Kirim</th>
                <th className="num" style={{ width: 100 }}>Qty SO</th>
                <th className="num" style={{ width: 90 }}>Terkirim</th>
                <th className="num" style={{ width: 100 }}>Direncanakan</th>
                <th className="num" style={{ width: 100 }}>Sisa</th>
                <th style={{ width: 150 }}>Dicakup</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((d) => {
                const pickable = d.status === "Open";
                const v = on.has(d.id);
                const room = roomOf(d);
                return (
                  <tr key={d.id} className={v ? "clk" : pickable ? "clk unpicked" : "unpicked"} onClick={() => pickable && toggle(d, !v)}>
                    <td className="pick">
                      <input
                        type="checkbox"
                        checked={v}
                        disabled={!pickable}
                        aria-label={`Pilih ${d.salesOrderNo}`}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => toggle(d, e.target.checked)}
                      />
                    </td>
                    <td>
                      <span className="dstack">
                        <span className="mono">{d.salesOrderNo}</span>
                        {!pickable && <span className="overtag">Pra-SO — belum bisa diproduksi</span>}
                      </span>
                    </td>
                    <td>
                      <span className="mono">{d.customerOrderNo}</span>
                    </td>
                    <td>{formatDate(d.deliveryDate)}</td>
                    <td className="num">
                      <span className="mny">{qtyText(d.qty)}</span>
                    </td>
                    <td className="num">{d.delivered ? <span className="mny">{qtyText(d.delivered)}</span> : <span className="dash">—</span>}</td>
                    <td className="num">{d.reserved ? <span className="mny">{qtyText(d.reserved)}</span> : <span className="dash">—</span>}</td>
                    <td className="num">
                      <span className="mny">{qtyText(room)}</span>
                    </td>
                    <td onClick={(e) => e.stopPropagation()}>
                      {v ? (
                        <div className="qcell">
                          <MoneyInput
                            size="sm"
                            decimals={4}
                            value={on.get(d.id)!}
                            over={units(Number(on.get(d.id))) > units(room)}
                            ariaLabel={`Jumlah ${d.salesOrderNo}`}
                            onChange={(q) => setOn((x) => new Map(x).set(d.id, q))}
                          />
                          <span className="qu">{item.uomLabel}</span>
                        </div>
                      ) : (
                        <span className="dash">—</span>
                      )}
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
