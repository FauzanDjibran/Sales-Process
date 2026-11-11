"use client";

import { useState } from "react";
import { Dialog } from "@/components/ui/dialog";
import { idc, qtyText } from "@/components/production/execution-parts";

/** A row offered: one Job, or one No. Stok without a Job. */
export type JobChoice = { key: string; jobNo: string | null; lotNo: string; itemName: string; count: number; partaiId: number | null; partaiNo: string | null; grams: number };

/**
 * *Tambah No. Job* / *Tambah Baris* (A4.2, A5.1): what else waits at the Unit,
 * a Job per row. One partai per document (W76): once one is ticked, rows of
 * another partai wait; goods before a partai go with any.
 */
export function JobPicker({ title, subtitle, choices, onAdd, onClose }: { title: string; subtitle: string; choices: JobChoice[]; onAdd: (keys: string[]) => void; onClose: () => void }) {
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const partai = choices.find((c) => ticked.has(c.key) && c.partaiId)?.partaiId ?? null;
  return (
    <Dialog
      open
      icon="plus"
      title={title}
      subtitle={subtitle}
      width={640}
      onClose={onClose}
      foot={
        <>
          <button className="btn" onClick={onClose}>
            Batal
          </button>
          <button className="btn primary" disabled={!ticked.size} onClick={() => onAdd([...ticked])}>
            Tambahkan {ticked.size || ""}
          </button>
        </>
      }
    >
      {choices.length ? (
        <div className="tw">
          <table className="grid ltab" style={{ minWidth: 560 }}>
            <thead>
              <tr>
                <th className="selchk" />
                <th>No. Job / No. Stok</th>
                <th style={{ width: 160 }}>Partai</th>
                <th className="num" style={{ width: 110 }}>
                  Gram
                </th>
              </tr>
            </thead>
            <tbody>
              {choices.map((c) => {
                const on = ticked.has(c.key);
                const other = partai != null && c.partaiId != null && c.partaiId !== partai;
                return (
                  <tr key={c.key}>
                    <td className="selchk">
                      <input
                        type="checkbox"
                        checked={on}
                        disabled={other && !on}
                        aria-label={`Pilih ${c.jobNo ?? c.lotNo}`}
                        onChange={() =>
                          setTicked((s) => {
                            const n = new Set(s);
                            if (n.has(c.key)) n.delete(c.key);
                            else n.add(c.key);
                            return n;
                          })
                        }
                      />
                    </td>
                    <td>
                      {c.jobNo ? <span className="mono">{c.jobNo}</span> : idc(c.lotNo, c.itemName)}
                      {c.jobNo && <span className="mut"> · {c.count} No. Stok</span>}
                    </td>
                    <td className="mono">{c.partaiNo ?? "—"}</td>
                    <td className="num">{qtyText(c.grams)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="empty">
          <h4>Tidak ada lagi yang menunggu</h4>
        </div>
      )}
    </Dialog>
  );
}
