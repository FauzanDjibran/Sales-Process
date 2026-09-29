"use client";

import { useState } from "react";
import { Icon } from "@/components/icon";
import { Dialog } from "@/components/ui/dialog";
import type { SalesOrderOptions } from "@/lib/erp/sales-order";

/** The picker dialog lines are added through (design convention §8.8). */
export function ItemPicker({
  items,
  taken,
  onCancel,
  onPick,
}: {
  items: SalesOrderOptions["items"];
  taken: number[];
  onCancel: () => void;
  onPick: (ids: number[]) => void;
}) {
  const [query, setQuery] = useState("");
  const [chosen, setChosen] = useState<number[]>([]);
  const q = query.trim().toLowerCase();
  const rows = items.filter((i) => !q || i.label.toLowerCase().includes(q) || i.name.toLowerCase().includes(q));
  const toggle = (id: number) =>
    setChosen((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]));

  return (
    <Dialog
      open
      icon="box"
      title="Tambah Barang"
      subtitle="Barang aktif yang dapat dijual. Barang yang sudah ada di pesanan tidak ditawarkan lagi."
      width={760}
      onClose={onCancel}
      foot={
        <>
          <span className="fnote">
            <b>{chosen.length}</b> barang dipilih
          </span>
          <button className="btn" onClick={onCancel}>
            Batal
          </button>
          <button className="btn primary" disabled={!chosen.length} onClick={() => onPick(chosen)}>
            <Icon name="plus" size={15} /> Tambahkan
          </button>
        </>
      }
    >
      <div style={{ margin: "14px 0 10px" }}>
        <input
          className="inp"
          autoFocus
          value={query}
          placeholder="Cari label atau nama barang…"
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      {rows.length ? (
        <div className="tw boxed">
          <table className="grid pkt2">
            <thead>
              <tr>
                <th style={{ width: 40 }} />
                <th style={{ width: 130 }}>Label</th>
                <th>Nama Barang</th>
                <th style={{ width: 160 }}>Satuan</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((i) => {
                const off = taken.includes(i.id);
                const on = chosen.includes(i.id);
                return (
                  <tr
                    key={i.id}
                    className={off ? "off" : on ? "on" : undefined}
                    onClick={() => !off && toggle(i.id)}
                  >
                    <td className="pkchk">
                      <input type="checkbox" checked={on} disabled={off} readOnly />
                    </td>
                    <td>
                      <span className="lab">{i.label}</span>
                    </td>
                    <td className="pri">
                      {i.name}
                      {off && <span className="fulltag">sudah di pesanan</span>}
                    </td>
                    <td className="mut">{i.uoms.map((u) => u.label).join(" · ")}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="empty sm">
          <div className="ic">
            <Icon name="box" size={18} />
          </div>
          <h4>{q ? "Tidak ada yang cocok" : "Belum ada barang yang dapat dijual"}</h4>
          <p>
            {q
              ? "Coba kata kunci lain."
              : "Buat Item bertipe Barang dengan tanda Dapat Dijual di Master › Item."}
          </p>
        </div>
      )}
    </Dialog>
  );
}
