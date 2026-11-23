import Link from "next/link";
import { notFound } from "next/navigation";
import { Icon } from "@/components/icon";
import { RecordHistoryCard } from "@/components/ui/record-history-card";
import { Field, FormBody, FormRow, FormSection } from "@/components/ui/form";
import { idc, qtyText, ro } from "@/components/production/execution-text";
import { requirePermission } from "@/lib/erp/auth";
import { unitIdsOf } from "@/lib/erp/production-access";
import { getJobOrder } from "@/lib/erp/production-job-order";
import { formatDate } from "@/lib/format";

export const dynamic = "force-dynamic";

/** A posted Job Order: each Job, the No. Stok it became and what it came from (P283). */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requirePermission("PRODUCTION_JOB_ORDER_VIEW", "/production/job-order");
  const doc = await getJobOrder(Number(id));
  if (!doc) notFound();
  const own = await unitIdsOf(actor);
  if (own && !own.includes(doc.unitId)) notFound();
  return (
    <>
      <div className="ph">
        <div className="crumb">
          <span>Dokumen</span>
          <span>/</span>
          <Link href="/production/job-order">Job Order</Link>
          <span>/</span>
          <span className="cur">{doc.no}</span>
        </div>
        <div className="ph-row">
          <h1>
            <span className="ph-ico">
              <Icon name="clip" size={16} />
            </span>
            <span className="docno">{doc.no}</span>
            <span className="bdg s-ok">Diposting</span>
          </h1>
          <div className="ph-act">
            <Link className="btn" href={`/production/workspace/${encodeURIComponent(doc.unitLabel)}`}>
              Workspace {doc.unitLabel}
            </Link>
          </div>
        </div>
      </div>
      <div className="card">
        <FormBody>
          <FormSection>
            <FormRow>
              <Field label="Unit" span={4}>
                {ro(
                  <>
                    <span className="lab">{doc.unitLabel}</span> {doc.unitName}
                  </>
                )}
              </Field>
              <Field label="Tanggal" span={4}>{ro(formatDate(doc.date))}</Field>
              <Field label="Partai" span={4}>{doc.partaiNo ? ro(<span className="mono">{doc.partaiNo}</span>) : <div className="ro nil">sebelum partai</div>}</Field>
              <Field label="Catatan" span={12}>{doc.note ? <div className="ro multi">{doc.note}</div> : <div className="ro multi nil">tidak diisi</div>}</Field>
            </FormRow>
          </FormSection>
        </FormBody>
      </div>
      <div className="card" style={{ marginTop: 14 }}>
        <div className="card-h">
          <span className="ci">
            <Icon name="clip" size={15} />
          </span>
          <div className="ct">
            <h3>Job Order</h3>
            <p>
              {doc.lines} Job · {qtyText(doc.grams)} g
            </p>
          </div>
        </div>
        <div className="tw">
          <table className="grid ltab" style={{ minWidth: 860 }}>
            <thead>
              <tr>
                <th style={{ width: 44 }}>No</th>
                <th style={{ width: 210 }}>Job Order · No. Job</th>
                <th style={{ width: 220 }}>No. Stok Baru</th>
                <th>Dari No. Stok</th>
                <th className="num" style={{ width: 100 }}>Gram</th>
              </tr>
            </thead>
            <tbody>
              {doc.items.map((l) => (
                <tr key={l.lineNo}>
                  <td className="no">{l.lineNo}</td>
                  <td>
                    <div className="mono">{l.jobOrderNo}</div>
                    <div className="uw-hint mono">{l.jobNo}</div>
                  </td>
                  <td>{idc(l.trackingNo, l.targetName)}</td>
                  <td className="uw-hint">
                    {l.from.map((p, i) => (
                      <span key={i} style={{ marginRight: 8 }}>
                        <span className="mono">{p.lotNo}</span> {qtyText(p.grams)} g
                      </span>
                    ))}
                  </td>
                  <td className="num">{qtyText(l.grams)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <RecordHistoryCard entityKey="prd_job_order" rowId={doc.id} />
    </>
  );
}
