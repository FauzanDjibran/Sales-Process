import Link from "next/link";
import { notFound } from "next/navigation";
import { Icon } from "@/components/icon";
import { RecordHistoryCard } from "@/components/ui/record-history-card";
import { Field, FormBody, FormRow, FormSection } from "@/components/ui/form";
import { qtyText, ro } from "@/components/production/execution-parts";
import { requirePermission } from "@/lib/erp/auth";
import { unitIdsOf } from "@/lib/erp/production-access";
import { getBox } from "@/lib/erp/production-box";
import { formatDate } from "@/lib/format";

export const dynamic = "force-dynamic";

/** A closed kotak: its pieces with CAIQ, Manual marked, and the bahan penolong used (P284). */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requirePermission("PRODUCTION_BOX_VIEW", "/production/box");
  const doc = await getBox(Number(id));
  if (!doc) notFound();
  const own = await unitIdsOf(actor);
  if (own && !own.includes(doc.unitId)) notFound();
  return (
    <>
      <div className="ph">
        <div className="crumb">
          <span>Dokumen</span>
          <span>/</span>
          <Link href="/production/box">Kotak</Link>
          <span>/</span>
          <span className="cur">{doc.no}</span>
        </div>
        <div className="ph-row">
          <h1>
            <span className="ph-ico">
              <Icon name="box" size={16} />
            </span>
            <span className="docno">{doc.no}</span>
            <span className="bdg s-ok">Ditutup</span>
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
              <Field label="No. Stok Kotak" span={4}>{ro(<span className="mono">{doc.trackingNo}</span>)}</Field>
              <Field label="Nama Jual" span={5}>
                {ro(
                  <>
                    <span className="lab">{doc.itemLabel}</span> {doc.itemName}
                  </>
                )}
              </Field>
              <Field label="Tanggal" span={3}>{ro(formatDate(doc.date))}</Field>
              <Field label="BoM" span={4}>{ro(<span className="lab">{doc.bomLabel}</span>)}</Field>
              <Field label="Isi" span={4}>{ro(`${doc.pieces} keping · ${qtyText(doc.grams)} g`)}</Field>
              <Field label="Partai" span={4}>{doc.partaiNo ? ro(<span className="mono">{doc.partaiNo}</span>) : <div className="ro nil">lintas partai</div>}</Field>
              <Field label="Bahan Penolong" span={12}>
                {doc.components.length ? ro(doc.components.map((c) => `${c.itemName} × ${qtyText(c.qty)}`).join(" · ")) : <div className="ro nil">tanpa bahan penolong</div>}
              </Field>
            </FormRow>
          </FormSection>
        </FormBody>
      </div>
      <div className="card" style={{ marginTop: 14 }}>
        <div className="card-h">
          <span className="ci">
            <Icon name="box" size={15} />
          </span>
          <div className="ct">
            <h3>Isi Kotak</h3>
            <p>Keping yang dimasukkan tanpa scan ditandai Manual.</p>
          </div>
        </div>
        <div className="tw">
          <table className="grid ltab" style={{ minWidth: 640 }}>
            <thead>
              <tr>
                <th style={{ width: 44 }}>No</th>
                <th style={{ width: 200 }}>No. Stok</th>
                <th>Partai</th>
                <th className="num" style={{ width: 90 }}>Gram</th>
                <th style={{ width: 200 }}>No. CAIQ</th>
              </tr>
            </thead>
            <tbody>
              {doc.pieceList.map((p) => (
                <tr key={p.lineNo}>
                  <td className="no">{p.lineNo}</td>
                  <td>
                    <span className="mono">{p.lotNo}</span> {p.manual && <span className="bdg t-warn">Manual</span>}
                  </td>
                  <td>{p.partaiNo ? <span className="mono">{p.partaiNo}</span> : <span className="dash">—</span>}</td>
                  <td className="num">{qtyText(p.grams)}</td>
                  <td className="mono">{p.caiq}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <RecordHistoryCard entityKey="prd_box" rowId={doc.id} />
    </>
  );
}
