import Link from "next/link";
import { Icon } from "@/components/icon";
import { formatDate, formatMoney } from "@/lib/format";

export type PermitLink = {
  kind: "advance" | "cost" | "invoice";
  id: number;
  no: string;
  date?: string;
  status: string;
  amount: number;
  /** What was paid of it, for an advance bill or an invoice. */
  paid?: number;
};

const KIND: Record<PermitLink["kind"], { label: string; href: string }> = {
  advance: { label: "Uang Muka Perizinan", href: "/finance/advance/permit" },
  cost: { label: "Biaya Perizinan", href: "/finance/cash-bank/payment" },
  invoice: { label: "Invoice Perizinan", href: "/finance/invoice/permit" },
};

const STATUS: Record<string, string> = {
  Draft: "Draft",
  Issued: "Diterbitkan",
  Posted: "Diposting",
  Cancelled: "Dibatalkan",
};

/**
 * The documents the Pengajuan's flow made (Z1): its Uang Muka Perizinan, the
 * Biaya Perizinan paid and its Invoice Perizinan. Each is another module's
 * document, linked and never embedded (S13 / S14); the page composes them.
 */
export function PermitRequestLinksCard({ links }: { links: PermitLink[] }) {
  return (
    <div className="card" style={{ marginTop: 14 }}>
      <div className="card-h">
        <span className="ci">
          <Icon name="link" size={15} />
        </span>
        <div className="ct">
          <h3>Dokumen Terkait</h3>
          <p>Uang muka, biaya yang dibayar dan invoice atas pengajuan ini.</p>
        </div>
      </div>
      {links.length === 0 ? (
        <div className="empty sm">
          <div className="ic">
            <Icon name="link" size={18} />
          </div>
          <h4>Belum ada dokumen</h4>
          <p>Uang muka, pembayaran biaya dan invoice atas pengajuan ini akan muncul di sini.</p>
        </div>
      ) : (
        <div className="tw">
          <table className="grid">
            <thead>
              <tr>
                <th style={{ width: 190 }}>Jenis</th>
                <th>Nomor</th>
                <th style={{ width: 110 }}>Tanggal</th>
                <th style={{ width: 120 }}>Status</th>
                <th className="num" style={{ width: 160 }}>
                  Nilai
                </th>
              </tr>
            </thead>
            <tbody>
              {links.map((l) => (
                <tr key={`${l.kind}:${l.id}`}>
                  <td>{KIND[l.kind].label}</td>
                  <td>
                    <Link className="lab" href={`${KIND[l.kind].href}/${l.id}`}>
                      {l.no}
                    </Link>
                  </td>
                  <td>{l.date ? formatDate(l.date) : <span className="dash">—</span>}</td>
                  <td>{STATUS[l.status] ?? l.status}</td>
                  <td className="num">
                    <span className="mny">{formatMoney(l.amount, "IDR")}</span>
                    {l.paid != null && l.paid > 0 && <span className="fulltag">dibayar {formatMoney(l.paid, "IDR")}</span>}
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
