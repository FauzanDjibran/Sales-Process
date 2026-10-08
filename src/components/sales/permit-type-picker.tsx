"use client";

import { useState } from "react";
import { Icon } from "@/components/icon";
import { Dialog } from "@/components/ui/dialog";
import type { PermitTypeOption } from "@/lib/erp/permit-request";
import { formatMoney } from "@/lib/format";

const CATEGORY_TEXT: Record<string, string> = {
  Regulatory: "Regulatori",
  Laboratory: "Laboratorium",
  Certification: "Sertifikasi",
  IntellectualProperty: "Kekayaan Intelektual",
};

/**
 * Jenis Perizinan to add to a Pengajuan (Z4): the ones already on it are shown
 * but cannot be ticked. During the realisation it adds permits that were not
 * estimated; their standard price becomes the first realised price.
 */
export function PermitTypePicker({
  types,
  taken,
  realization,
  priceOf,
  onApply,
  onClose,
}: {
  types: PermitTypeOption[];
  taken: number[];
  realization: boolean;
  /** The standard estimate in the document's price mode. */
  priceOf: (t: PermitTypeOption) => number | null;
  onApply: (ids: number[]) => void;
  onClose: () => void;
}) {
  const [on, setOn] = useState<Set<number>>(new Set());
  const rows = types.filter((t) => t.active || taken.includes(t.id));
  const toggle = (id: number) =>
    setOn((x) => {
      const next = new Set(x);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <Dialog
      open
      icon="clip"
      title="Pilih Perizinan"
      subtitle={
        realization
          ? "Perizinan tambahan saat realisasi — estimasinya 0, harga standar menjadi harga realisasi awal"
          : "Perizinan yang diurus — harga standar menjadi estimasi awal"
      }
      width={720}
      onClose={onClose}
      foot={
        <>
          <span className="fnote">{on.size ? `${on.size} perizinan dipilih` : "Centang perizinan yang diurus."}</span>
          <button className="btn" onClick={onClose}>
            Batal
          </button>
          <button className="btn primary" disabled={!on.size} onClick={() => onApply([...on])}>
            <Icon name="plus" size={15} /> Tambah ke Dokumen
          </button>
        </>
      }
    >
      <div className="tw">
        <table className="grid ltab" style={{ minWidth: 600 }}>
          <thead>
            <tr>
              <th className="pick" />
              <th>Jenis Perizinan</th>
              <th style={{ width: 170 }}>Kategori</th>
              <th className="num" style={{ width: 140 }}>
                Harga Standar
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((t) => {
              const used = taken.includes(t.id);
              const v = on.has(t.id);
              const price = priceOf(t);
              return (
                <tr key={t.id} className={used ? "unpicked" : v ? "clk" : "clk unpicked"} onClick={used ? undefined : () => toggle(t.id)}>
                  <td className="pick">
                    <input
                      type="checkbox"
                      checked={v || used}
                      disabled={used}
                      aria-label={`Pilih ${t.label}`}
                      onClick={(e) => e.stopPropagation()}
                      onChange={() => toggle(t.id)}
                    />
                  </td>
                  <td>
                    <span className="idc">
                      <span className="lab">{t.label}</span>
                      <span className="nm">
                        {t.name} {used && <span className="bdg t-slate">sudah di dokumen</span>}
                      </span>
                    </span>
                  </td>
                  <td>{CATEGORY_TEXT[t.category] ?? t.category}</td>
                  <td className="num">
                    {price != null ? <span className="mny">{formatMoney(price, "IDR")}</span> : <span className="dash">—</span>}
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
