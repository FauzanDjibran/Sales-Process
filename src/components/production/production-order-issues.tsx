import Link from "next/link";
import { Icon } from "@/components/icon";
import { formatDate, formatMoney } from "@/lib/format";
import type { IssueOfOrder } from "@/lib/erp/stock-issue";
import { STOCK_ISSUE_STATUS_BADGE, STOCK_ISSUE_STATUS_TEXT, stockIssueIsPosted } from "@/lib/erp/stock-issue-workflow";

/**
 * The Logistik BSTBs raised from a Perintah Produksi (Walet step 3). Each is
 * another module's document, linked and never embedded (S13 / S14) — the page
 * composes them from the BSTB module.
 */
export function ProductionOrderIssuesCard({ issues, canCreate }: { issues: IssueOfOrder[]; canCreate: boolean }) {
  return (
    <div className="card" style={{ marginTop: 14 }}>
      <div className="card-h">
        <span className="ci">
          <Icon name="truck" size={15} />
        </span>
        <div className="ct">
          <h3>BSTB Logistik</h3>
          <p>Pengiriman lot dari gudang ke workstation untuk Perintah ini.</p>
        </div>
        {canCreate && (
          <Link className="btn sm primary" href="/inventory/stock-issue/new">
            <Icon name="plus" size={14} /> Stock Issue Baru
          </Link>
        )}
      </div>
      {issues.length === 0 ? (
        <div className="empty sm">
          <div className="ic">
            <Icon name="truck" size={18} />
          </div>
          <h4>Belum dikirim</h4>
          <p>Buat Stock Issue di Persediaan dan pilih Perintah ini: gudang, workstation dan lotnya terisi dari sini.</p>
        </div>
      ) : (
        <div className="tw">
          <table className="grid">
            <thead>
              <tr>
                <th>Nomor</th>
                <th style={{ width: 110 }}>Tanggal</th>
                <th style={{ width: 130 }}>Status</th>
                <th style={{ width: 140 }}>Workstation</th>
                <th className="num" style={{ width: 160 }}>
                  Nilai ke WIP
                </th>
              </tr>
            </thead>
            <tbody>
              {issues.map((i) => (
                <tr key={i.id}>
                  <td>
                    <Link className="lab" href={`/inventory/stock-issue/${i.id}`}>
                      {i.issueNo}
                    </Link>
                  </td>
                  <td>{formatDate(i.issueDate)}</td>
                  <td>
                    <span className={`bdg ${STOCK_ISSUE_STATUS_BADGE[i.status]}`}>{STOCK_ISSUE_STATUS_TEXT[i.status]}</span>
                  </td>
                  <td>{i.workstationLabel ? <span className="lab">{i.workstationLabel}</span> : <span className="dash">—</span>}</td>
                  <td className="num">{stockIssueIsPosted(i.status) ? <span className="mny">{formatMoney(i.cost, "IDR")}</span> : <span className="dash">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
