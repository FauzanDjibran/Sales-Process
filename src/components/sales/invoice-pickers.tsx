"use client";

import { useState } from "react";
import { Icon } from "@/components/icon";
import { Dialog } from "@/components/ui/dialog";
import type { InvoiceAdvance, InvoiceNoteLine } from "@/lib/erp/sales-invoice";
import { formatDate, formatMoney, formatNumber } from "@/lib/format";

const qtyText = (n: number) => formatNumber(n, n % 1 ? 2 : 0);
const money = (n: number) => formatMoney(n, "IDR");

function toggled(set: Set<number>, ids: number[], on: boolean): Set<number> {
  const next = new Set(set);
  for (const id of ids) {
    if (on) next.add(id);
    else next.delete(id);
  }
  return next;
}

/**
 * *Pilih Surat Jalan* (U17): the Customer Order's posted Delivery Note lines,
 * grouped by note, to tick the ones this Invoice bills — a whole note at once
 * or line by line. Each line is billed whole, so there is nothing to type. A
 * line another Invoice already bills is shown but cannot be ticked.
 */
export function InvoiceNotePicker({
  lines,
  current,
  orderNo,
  onApply,
  onClose,
}: {
  lines: InvoiceNoteLine[];
  current: number[];
  orderNo: string;
  onApply: (ids: number[]) => void;
  onClose: () => void;
}) {
  const [on, setOn] = useState<Set<number>>(() => new Set(current));
  const free = (l: InvoiceNoteLine) => !l.billedBy || current.includes(l.id);
  const notes = [...new Map(lines.map((l) => [l.deliveryNoteId, l])).values()];

  return (
    <Dialog
      open
      icon="truck"
      title="Pilih Surat Jalan"
      subtitle={`${orderNo} · centang barang terkirim yang ditagih dengan Invoice ini`}
      width={880}
      onClose={onClose}
      foot={
        <>
          <span className="fnote">{on.size ? `${on.size} baris dipilih · ditagih utuh` : "Centang barang yang ditagih."}</span>
          <button className="btn" onClick={onClose}>
            Batal
          </button>
          <button className="btn primary" onClick={() => onApply(lines.filter((l) => on.has(l.id)).map((l) => l.id))}>
            <Icon name="check" size={15} /> Terapkan
          </button>
        </>
      }
    >
      {notes.length === 0 ? (
        <div className="empty sm">
          <div className="ic">
            <Icon name="truck" size={18} />
          </div>
          <h4>Belum ada barang terkirim</h4>
          <p>Invoice hanya menagih barang dari Delivery Note yang sudah diposting.</p>
        </div>
      ) : (
        <div className="tw">
          <table className="grid ltab" style={{ minWidth: 800 }}>
            <thead>
              <tr>
                <th className="pick" />
                <th style={{ width: 170 }}>Sales Order</th>
                <th>Barang</th>
                <th className="num" style={{ width: 130 }}>
                  Qty
                </th>
                <th style={{ width: 200 }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {notes.map((n) => {
                const mine = lines.filter((l) => l.deliveryNoteId === n.deliveryNoteId);
                const pickable = mine.filter(free);
                const allOn = pickable.length > 0 && pickable.every((l) => on.has(l.id));
                return [
                  <tr key={`n${n.deliveryNoteId}`} className="grp">
                    <td className="pick">
                      <input
                        type="checkbox"
                        checked={allOn}
                        disabled={!pickable.length}
                        aria-label={`Pilih semua barang ${n.dnNo}`}
                        onChange={(e) => setOn((x) => toggled(x, pickable.map((l) => l.id), e.target.checked))}
                      />
                    </td>
                    <td colSpan={4}>
                      <span className="lab">{n.dnNo}</span> <span className="mut">· dikirim {formatDate(n.dnDate)}</span>
                    </td>
                  </tr>,
                  ...mine.map((l) => {
                    const can = free(l);
                    const v = on.has(l.id);
                    return (
                      <tr
                        key={l.id}
                        className={can ? (v ? "clk" : "clk unpicked") : "unpicked"}
                        onClick={can ? () => setOn((x) => toggled(x, [l.id], !v)) : undefined}
                      >
                        <td className="pick">
                          <input
                            type="checkbox"
                            checked={v}
                            disabled={!can}
                            aria-label={`Pilih ${l.itemLabel} dari ${l.dnNo}`}
                            onClick={(e) => e.stopPropagation()}
                            onChange={(e) => setOn((x) => toggled(x, [l.id], e.target.checked))}
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
                        <td>
                          {l.billedBy && !current.includes(l.id) ? (
                            <span className="bdg s-mute">Ditagih {l.billedBy.no}</span>
                          ) : (
                            <span className="dash">Belum ditagih</span>
                          )}
                        </td>
                      </tr>
                    );
                  }),
                ];
              })}
            </tbody>
          </table>
        </div>
      )}
    </Dialog>
  );
}

/**
 * *Pilih Uang Muka* (U8): the Customer Order's Uang Muka still open, with the
 * bill it pays, the receipt that brought it, what is left and what other Draft
 * Invoices reserve. The DPP used is typed on the page after Terapkan; nothing is
 * pre-filled.
 */
export function InvoiceAdvancePicker({
  advances,
  current,
  orderNo,
  onApply,
  onClose,
}: {
  advances: InvoiceAdvance[];
  current: number[];
  orderNo: string;
  onApply: (ids: number[]) => void;
  onClose: () => void;
}) {
  const [on, setOn] = useState<Set<number>>(() => new Set(current));
  const freeOf = (a: InvoiceAdvance) => Math.max(0, a.balance - a.reserved);
  const can = (a: InvoiceAdvance) => freeOf(a) > 0 || current.includes(a.id);

  return (
    <Dialog
      open
      icon="wallet"
      title="Pilih Uang Muka"
      subtitle={`${orderNo} · uang muka yang sudah diterima dan belum terpakai`}
      width={900}
      onClose={onClose}
      foot={
        <>
          <span className="fnote">{on.size ? `${on.size} uang muka dipilih · DPP dipakai diisi di baris` : "Centang uang muka yang dipotong."}</span>
          <button className="btn" onClick={onClose}>
            Batal
          </button>
          <button className="btn primary" onClick={() => onApply(advances.filter((a) => on.has(a.id)).map((a) => a.id))}>
            <Icon name="check" size={15} /> Terapkan
          </button>
        </>
      }
    >
      {advances.length === 0 ? (
        <div className="empty sm">
          <div className="ic">
            <Icon name="wallet" size={18} />
          </div>
          <h4>Tidak ada uang muka terbuka</h4>
          <p>Customer Order ini tidak punya uang muka yang sudah diterima dan belum terpakai.</p>
        </div>
      ) : (
        <div className="tw">
          <table className="grid ltab" style={{ minWidth: 840 }}>
            <thead>
              <tr>
                <th className="pick" />
                <th style={{ width: 150 }}>AR Item</th>
                <th style={{ width: 96 }}>Diterima</th>
                <th>Tagihan · Penerimaan</th>
                <th style={{ width: 150 }}>No. Faktur Pajak</th>
                <th className="num" style={{ width: 130 }}>
                  Sisa (DPP)
                </th>
                <th className="num" style={{ width: 130 }}>
                  Dicadangkan
                </th>
              </tr>
            </thead>
            <tbody>
              {advances.map((a) => {
                const v = on.has(a.id);
                const ok = can(a);
                return (
                  <tr
                    key={a.id}
                    className={ok ? (v ? "clk" : "clk unpicked") : "unpicked"}
                    onClick={ok ? () => setOn((x) => toggled(x, [a.id], !v)) : undefined}
                  >
                    <td className="pick">
                      <input
                        type="checkbox"
                        checked={v}
                        disabled={!ok}
                        aria-label={`Pilih ${a.arItemNo}`}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => setOn((x) => toggled(x, [a.id], e.target.checked))}
                      />
                    </td>
                    <td>
                      <span className="lab">{a.arItemNo}</span>
                    </td>
                    <td>{formatDate(a.date)}</td>
                    <td>
                      <span className="lab">{a.sourceNo}</span> <span className="mut">· {a.createdByNo}</span>
                    </td>
                    <td>{a.taxInvoiceNo ? <span className="mono">{a.taxInvoiceNo}</span> : <span className="dash">belum diisi</span>}</td>
                    <td className="num">
                      <span className="mny">{money(a.balance)}</span>
                    </td>
                    <td className="num">{a.reserved ? <span className="mny">{money(a.reserved)}</span> : <span className="dash">—</span>}</td>
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
