"use client";

import Link from "next/link";
import { Icon } from "@/components/icon";
import { formatDate, formatMoney } from "@/lib/format";
import type { ClosePeriodRow } from "@/lib/erp/production-close";

/** Penutupan Biaya Produksi: every fiscal period and whether its cost is closed (P172). */
export function CostCloseList({ rows }: { rows: ClosePeriodRow[] }) {
  return (
    <>
      <div className="ph">
        <div className="crumb">
          <span>Produksi</span>
          <span>/</span>
          <span className="cur">Penutupan Biaya</span>
        </div>
        <div className="ph-row">
          <h1>
            <span className="ph-ico">
              <Icon name="lock" size={16} />
            </span>
            Penutupan Biaya Produksi
          </h1>
        </div>
        <p className="ph-sub">Tiap bulan, sisa biaya tiap Cost Center dibagi ke eksekusi menurut Driver dan dibawa ke WIP, stok, HPP atau scrap. Dijalankan dari periode tertua, setelah hari terakhirnya; tidak dapat dibatalkan.</p>
      </div>
      <div className="card">
        {rows.length ? (
          <div className="tw">
            <table className="grid" style={{ minWidth: 640 }}>
              <thead>
                <tr>
                  <th>Periode</th>
                  <th style={{ width: 220 }}>Rentang</th>
                  <th style={{ width: 150 }}>Status</th>
                  <th className="num" style={{ width: 170 }}>
                    Biaya Dibebankan
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={p.periodId}>
                    <td>
                      <Link className="lab" href={`/production/cost-close/${p.periodId}`}>
                        {p.periodName}
                      </Link>
                    </td>
                    <td>
                      {formatDate(p.start)} – {formatDate(p.end)}
                    </td>
                    <td>{p.costed ? <span className="bdg s-ok">Biaya ditutup</span> : <span className="bdg s-mute">Belum ditutup</span>}</td>
                    <td className="num">{p.leftoverTotal != null ? <span className="mny">{formatMoney(p.leftoverTotal, "IDR")}</span> : <span className="dash">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty sm">
            <h4>Belum ada periode</h4>
            <p>Periode berasal dari Fiscal Year yang dibuka.</p>
          </div>
        )}
      </div>
    </>
  );
}
