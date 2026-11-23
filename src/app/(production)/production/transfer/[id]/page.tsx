import Link from "next/link";
import { notFound } from "next/navigation";
import { Icon } from "@/components/icon";
import { RecordHistoryCard } from "@/components/ui/record-history-card";
import { Field, FormBody, FormRow, FormSection } from "@/components/ui/form";
import { idc, qtyText, ro } from "@/components/production/execution-text";
import { TransferReceiveButton } from "@/components/production/transfer-receive-button";
import { requirePermission } from "@/lib/erp/auth";
import { unitIdsOf } from "@/lib/erp/production-access";
import { getTransfer } from "@/lib/erp/production-transfer";
import { TRANSFER_KIND_TEXT, TRANSFER_PATH } from "@/lib/erp/production-transfer-shape";
import { formatDate } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requirePermission("PRODUCTION_TRANSFER_VIEW", TRANSFER_PATH);
  const doc = await getTransfer(Number(id));
  if (!doc) notFound();
  const own = await unitIdsOf(actor);
  if (own && !own.includes(doc.fromUnitId) && !own.includes(doc.toUnitId)) notFound();
  const waiting = doc.status === "Submitted";
  const mine = !own || own.includes(doc.toUnitId);
  const back = `/production/workspace/${encodeURIComponent(waiting ? doc.toLabel : doc.fromLabel)}`;
  return (
    <>
      <div className="ph">
        <div className="crumb">
          <span>Dokumen</span>
          <span>/</span>
          <Link href={TRANSFER_PATH}>Push dan BSTB</Link>
          <span>/</span>
          <span className="cur">{doc.no}</span>
        </div>
        <div className="ph-row">
          <h1>
            <span className="ph-ico">
              <Icon name="truck" size={16} />
            </span>
            <span className="docno">{doc.no}</span>
            <span className={`bdg ${waiting ? "s-warn" : "s-ok"}`}>{waiting ? "Dalam Perjalanan" : doc.kind === "Push" ? "Diposting" : "Diterima"}</span>
          </h1>
          <div className="ph-act">
            <Link className="btn" href={back}>
              Workspace {waiting ? doc.toLabel : doc.fromLabel}
            </Link>
            {waiting && mine && actor.permissions.has("PRODUCTION_TRANSFER_RECEIVE") && <TransferReceiveButton id={doc.id} subject={doc.no} from={doc.fromLabel} partai={doc.kind === "BstbPartai"} />}
          </div>
        </div>
      </div>
      <div className="card">
        <FormBody>
          <FormSection>
            <FormRow>
              <Field label="Jenis" span={3}>{ro(TRANSFER_KIND_TEXT[doc.kind])}</Field>
              <Field label="Dari" span={3}>{ro(<span className="lab">{doc.fromLabel}</span>)}</Field>
              <Field label="Ke" span={3}>{ro(<span className="lab">{doc.toLabel}</span>)}</Field>
              <Field label="Tanggal" span={3}>{ro(formatDate(doc.date))}</Field>
              <Field label="Partai" span={3}>{doc.partaiNo ? ro(<span className="mono">{doc.partaiNo}</span>) : <div className="ro nil">{doc.kind === "BstbPartai" ? "lahir saat diterima" : "sebelum partai"}</div>}</Field>
              {doc.lineName && <Field label="Line" span={3}>{ro(doc.lineName)}</Field>}
              <Field label="Diterima" span={3}>{doc.receivedAt ? ro(formatDate(doc.receivedAt)) : <div className="ro nil">belum</div>}</Field>
              <Field label="Catatan" span={12}>{doc.note ? <div className="ro multi">{doc.note}</div> : <div className="ro multi nil">tidak diisi</div>}</Field>
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
            <h3>Barang yang Dikirim</h3>
          </div>
        </div>
        <div className="tw">
          <table className="grid ltab" style={{ minWidth: 640 }}>
            <thead>
              <tr>
                <th style={{ width: 44 }}>No</th>
                <th style={{ width: 200 }}>No. Job</th>
                <th>No. Stok</th>
                <th className="num" style={{ width: 120 }}>Jumlah</th>
                <th className="num" style={{ width: 110 }}>Gram</th>
              </tr>
            </thead>
            <tbody>
              {doc.items.map((l) => (
                <tr key={l.lineNo}>
                  <td className="no">{l.lineNo}</td>
                  <td>{l.jobNo ? <><span className="mono">{l.jobNo}</span>{l.newJob && <span className="bdg t-info">baru</span>}</> : <span className="dash">—</span>}</td>
                  <td>{idc(l.lotNo, l.itemName)}</td>
                  <td className="num">{qtyText(l.qty)} {l.uomLabel}</td>
                  <td className="num">{l.grams != null ? qtyText(l.grams) : <span className="dash">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <RecordHistoryCard entityKey="prd_transfer" rowId={doc.id} />
    </>
  );
}
