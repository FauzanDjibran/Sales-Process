import Link from "next/link";
import { notFound } from "next/navigation";
import { Icon } from "@/components/icon";
import { RecordHistoryCard } from "@/components/ui/record-history-card";
import { Field, FormBody, FormRow, FormSection } from "@/components/ui/form";
import { idc, qtyText, ro } from "@/components/production/execution-text";
import { requirePermission } from "@/lib/erp/auth";
import { unitIdsOf } from "@/lib/erp/production-access";
import { getKerja } from "@/lib/erp/production-kerja";
import { KERJA_BADGE, KERJA_STATUS_TEXT } from "@/lib/erp/production-kerja-shape";
import { formatDate } from "@/lib/format";

export const dynamic = "force-dynamic";

const clock = (iso: string) => `${formatDate(iso.slice(0, 10))} ${iso.slice(11, 16)}`;

/** A Kerja and the state of each of its lines. Selesai and Batal Mulai are on the Workspace (P282). */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requirePermission("PRODUCTION_KERJA_VIEW", "/production/kerja");
  const doc = await getKerja(Number(id));
  if (!doc) notFound();
  const own = await unitIdsOf(actor);
  if (own && !own.includes(doc.unitId)) notFound();
  return (
    <>
      <div className="ph">
        <div className="crumb">
          <span>Dokumen</span>
          <span>/</span>
          <Link href="/production/kerja">Kerja</Link>
          <span>/</span>
          <span className="cur">{doc.no}</span>
        </div>
        <div className="ph-row">
          <h1>
            <span className="ph-ico">
              <Icon name="clock" size={16} />
            </span>
            <span className="docno">{doc.no}</span>
            <span className={`bdg ${KERJA_BADGE[doc.status]}`}>{KERJA_STATUS_TEXT[doc.status]}</span>
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
              <Field label="Tanggal Mulai" span={4}>{ro(formatDate(doc.date))}</Field>
              <Field label="Partai" span={4}>{doc.partaiNo ? ro(<span className="mono">{doc.partaiNo}</span>) : <div className="ro nil">sebelum partai</div>}</Field>
              <Field label="Catatan" span={12}>{doc.note ? <div className="ro multi">{doc.note}</div> : <div className="ro multi nil">tidak diisi</div>}</Field>
            </FormRow>
          </FormSection>
        </FormBody>
      </div>
      <div className="card" style={{ marginTop: 14 }}>
        <div className="card-h">
          <span className="ci">
            <Icon name="users" size={15} />
          </span>
          <div className="ct">
            <h3>Job Dikerjakan</h3>
            <p>
              {doc.open} dari {doc.lines} No. Stok masih Sedang Dikerjakan.
            </p>
          </div>
        </div>
        <div className="tw">
          <table className="grid ltab" style={{ minWidth: 860 }}>
            <thead>
              <tr>
                <th style={{ width: 44 }}>No</th>
                <th style={{ width: 190 }}>No. Job</th>
                <th>No. Stok</th>
                <th className="num" style={{ width: 100 }}>Gram</th>
                <th style={{ width: 170 }}>Karyawan</th>
                <th style={{ width: 130 }}>Mulai</th>
                <th style={{ width: 150 }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {doc.items.map((l) => (
                <tr key={l.lineNo}>
                  <td className="no">{l.lineNo}</td>
                  <td>{l.jobNo ? <span className="mono">{l.jobNo}</span> : <span className="dash">—</span>}</td>
                  <td>
                    {idc(l.lotNo, l.itemName)}
                    {l.rework && <span className="bdg t-bad">Balik QC</span>}
                  </td>
                  <td className="num">{l.grams != null ? qtyText(l.grams) : <span className="dash">—</span>}</td>
                  <td>{l.employee}</td>
                  <td>{clock(l.startedAt)}</td>
                  <td>
                    {l.finishedAt ? (
                      <span className="bdg s-ok">Selesai {clock(l.finishedAt)}</span>
                    ) : l.cancelledAt ? (
                      <span className="bdg s-mute">Batal Mulai</span>
                    ) : (
                      <span className="bdg s-warn">Sedang Dikerjakan</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <RecordHistoryCard entityKey="prd_kerja" rowId={doc.id} />
    </>
  );
}
