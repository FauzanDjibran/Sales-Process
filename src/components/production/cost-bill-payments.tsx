import Link from "next/link";
import { Icon } from "@/components/icon";
import { formatDate, formatMoney } from "@/lib/format";

export type CostBillPaymentLink = { id: number; txNo: string; date: string; status: string; settled: number };

const STATUS: Record<string, string> = { Draft: "Draft", Posted: "Posted" };

/**
 * The Pengeluaran that pay a posted Tagihan Biaya Produksi (P151). The bill is
 * what *Pembayaran Biaya Produksi* references; each payment is another
 * module's document, linked and never embedded (S13 / S14) — the page composes
 * them from the payment module.
 */
export function CostBillPaymentsCard({ payments }: { payments: CostBillPaymentLink[] }) {
  return (
    <div className="card" style={{ marginTop: 14 }}>
      <div className="card-h">
        <span className="ci">
          <Icon name="link" size={15} />
        </span>
        <div className="ct">
          <h3>Pembayaran</h3>
          <p>Pengeluaran Kas &amp; Bank yang membayar tagihan ini.</p>
        </div>
      </div>
      {payments.length === 0 ? (
        <div className="empty sm">
          <div className="ic">
            <Icon name="link" size={18} />
          </div>
          <h4>Belum dibayar</h4>
          <p>Bayar lewat Finance › Kas &amp; Bank › Pengeluaran, tujuan Pembayaran Biaya Produksi.</p>
        </div>
      ) : (
        <div className="tw">
          <table className="grid">
            <thead>
              <tr>
                <th>Nomor</th>
                <th style={{ width: 110 }}>Tanggal</th>
                <th style={{ width: 120 }}>Status</th>
                <th className="num" style={{ width: 160 }}>
                  Dibayar
                </th>
              </tr>
            </thead>
            <tbody>
              {payments.map((p) => (
                <tr key={p.id}>
                  <td>
                    <Link className="lab" href={`/finance/cash-bank/payment/${p.id}`}>
                      {p.txNo}
                    </Link>
                  </td>
                  <td>{formatDate(p.date)}</td>
                  <td>{STATUS[p.status] ?? p.status}</td>
                  <td className="num">
                    <span className="mny">{formatMoney(p.settled, "IDR")}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
