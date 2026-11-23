import Link from "next/link";
import { Icon, type IconName } from "@/components/icon";
import { Field, FormBody, FormRow, FormSection } from "@/components/ui/form";
import { idc, qtyText, ro } from "@/components/production/execution-text";
import { HANDOVER_STATUS_BADGE, type HandoverStatus } from "@/lib/erp/production-handover-shape";
import { formatDate } from "@/lib/format";

export type HandoverDoc = {
  no: string;
  status: HandoverStatus;
  unitLabel: string;
  warehouseName: string;
  date: string;
  receivedAt: string | null;
  note: string | null;
  items: { lineNo: number; lotNo: string; itemName: string; uomLabel: string; jobNo: string | null; qty: number; grams?: number | null }[];
};

/** A Production Receipt or Production Issue, read (P317). No prices (P275). */
export function HandoverView({ doc, title, icon, base, purpose, statusText, warehouseLabel, reason, action }: { doc: HandoverDoc; title: string; icon: IconName; base: string; purpose: string; statusText: Record<HandoverStatus, string>; warehouseLabel: string; reason?: string | null; action?: React.ReactNode }) {
  return (
    <>
      <div className="ph">
        <div className="crumb">
          <span>Dokumen</span>
          <span>/</span>
          <Link href={base}>{title}</Link>
          <span>/</span>
          <span className="cur">{doc.no}</span>
        </div>
        <div className="ph-row">
          <h1>
            <span className="ph-ico">
              <Icon name={icon} size={16} />
            </span>
            <span className="docno">{doc.no}</span>
            <span className={`bdg ${HANDOVER_STATUS_BADGE[doc.status]}`}>{statusText[doc.status]}</span>
          </h1>
          <div className="ph-act">
            <Link className="btn" href={`/production/workspace/${encodeURIComponent(doc.unitLabel)}`}>
              Workspace {doc.unitLabel}
            </Link>
            {action}
          </div>
        </div>
      </div>
      <div className="card">
        <FormBody>
          <FormSection>
            <FormRow>
              <Field label="Tujuan" span={3}>{ro(purpose)}</Field>
              <Field label="Unit" span={3}>{ro(<span className="lab">{doc.unitLabel}</span>)}</Field>
              <Field label={warehouseLabel} span={3}>{ro(doc.warehouseName)}</Field>
              <Field label="Tanggal Kirim" span={3}>{ro(formatDate(doc.date))}</Field>
              <Field label="Diterima" span={3}>{doc.receivedAt ? ro(formatDate(doc.receivedAt)) : <div className="ro nil">belum</div>}</Field>
              {reason && <Field label="Alasan" span={3}>{ro(reason)}</Field>}
              <Field label="Catatan" span={12}>{doc.note ? <div className="ro multi">{doc.note}</div> : <div className="ro multi nil opt">tidak diisi</div>}</Field>
            </FormRow>
          </FormSection>
        </FormBody>
      </div>
      <div className="card" style={{ marginTop: 14 }}>
        <div className="card-h">
          <span className="ci">
            <Icon name="layers" size={15} />
          </span>
          <div className="ct">
            <h3>Barang</h3>
          </div>
        </div>
        <div className="tw">
          <table className="grid ltab" style={{ minWidth: 640 }}>
            <thead>
              <tr>
                <th style={{ width: 44 }}>No</th>
                <th style={{ width: 200 }}>No. Job</th>
                <th>No. Stok</th>
                <th className="num" style={{ width: 130 }}>Jumlah</th>
                <th className="num" style={{ width: 110 }}>Gram</th>
              </tr>
            </thead>
            <tbody>
              {doc.items.map((l) => (
                <tr key={l.lineNo}>
                  <td className="no">{l.lineNo}</td>
                  <td>{l.jobNo ? <span className="mono">{l.jobNo}</span> : <span className="dash">—</span>}</td>
                  <td>{idc(l.lotNo, l.itemName)}</td>
                  <td className="num">
                    {qtyText(l.qty)} {l.uomLabel}
                  </td>
                  <td className="num">{l.grams != null ? qtyText(l.grams) : <span className="dash">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
