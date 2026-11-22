"use client";

import { useState } from "react";
import Link from "next/link";
import { Icon } from "@/components/icon";
import { Amount } from "@/components/ui/amount";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DocumentHeader } from "@/components/ui/document-header";
import { Field, FormBody, FormRow, FormSection } from "@/components/ui/form";
import { JournalPreview } from "@/components/ui/journal-preview";
import { useToast } from "@/components/ui/toast";
import { previewFinishGoodsAction, receiveFinishGoodsAction } from "@/app/actions/production-receipt";
import type { ProductionReceiptView as View } from "@/lib/erp/production-receipt";
import { PRODUCTION_RECEIPT_PATH, PRODUCTION_RECEIPT_STATUS_BADGE, PRODUCTION_RECEIPT_STATUS_TEXT } from "@/lib/erp/production-receipt-shape";
import { formatDate, formatNumber } from "@/lib/format";

const qtyText = (n: number) => formatNumber(n, n % 1 ? 2 : 0);
const ro = (node: React.ReactNode) => <div className="ro">{node}</div>;
const nil = (text: string) => <div className="ro nil">{text}</div>;

/**
 * A BSTB ke Finish Goods as the warehouse sees it (P303): where it came from,
 * the No. Stok it brings, and Terima, whose confirmation shows the journal by a
 * dry run of the posting itself (P103).
 */
export function ProductionReceiptView({ receipt: r, canReceive }: { receipt: View; canReceive: boolean }) {
  const toast = useToast();
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [postable, setPostable] = useState(false);
  const posted = r.status === "Posted";

  async function receive() {
    setBusy(true);
    const result = await receiveFinishGoodsAction(r.id);
    setBusy(false);
    setAsking(false);
    if (!result.ok) return toast("Tidak dapat diterima", result.errors._form ?? Object.values(result.errors)[0], "err");
    toast(result.message, r.no, "ok");
  }

  return (
    <>
      <DocumentHeader
        module="Persediaan"
        trail={[{ label: "BSTB ke Finish Goods", href: PRODUCTION_RECEIPT_PATH }]}
        icon="down"
        number={r.no}
        status={r.status}
        statusLabel={{ text: PRODUCTION_RECEIPT_STATUS_TEXT[r.status], tone: PRODUCTION_RECEIPT_STATUS_BADGE[r.status] }}
      >
        {!posted && canReceive ? (
          <button
            className="btn primary"
            disabled={busy}
            onClick={() => {
              setPostable(false);
              setAsking(true);
            }}
          >
            <Icon name="check" size={15} /> Terima
          </button>
        ) : (
          <span className="lockchip">
            <Icon name="lock" size={13} /> {posted ? "Sudah diterima" : "Menunggu Terima gudang"}
          </span>
        )}
      </DocumentHeader>

      <div className="card">
        <FormBody>
          <FormSection title="Sumber">
            <FormRow>
              <Field label="Unit Asal" span={4}>
                {ro(
                  <span className="idc">
                    <span className="lab">{r.unitLabel}</span>
                    <span className="nm">{r.unitName}</span>
                  </span>
                )}
              </Field>
              <Field label="Tanggal Kirim" span={4}>
                {ro(formatDate(r.date))}
              </Field>
            </FormRow>
          </FormSection>
          <FormSection title="Penerimaan">
            <FormRow>
              <Field label="Gudang Tujuan" span={4}>
                {ro(
                  <span className="idc">
                    <span className="lab">{r.warehouseLabel}</span>
                    <span className="nm">{r.warehouseName}</span>
                  </span>
                )}
              </Field>
              <Field label="Tanggal Terima" span={4}>
                {r.receivedAt ? ro(formatDate(r.receivedAt)) : nil("belum diterima")}
              </Field>
              <Field label="Catatan" span={12}>
                {r.note ? <div className="ro multi">{r.note}</div> : <div className="ro multi nil">tidak diisi</div>}
              </Field>
            </FormRow>
          </FormSection>
          {posted && (
            <FormSection title="Referensi">
              <FormRow>
                <Field label="Journal" span={4}>
                  {r.journalId
                    ? ro(
                        <Link className="drl" href={`/accounting/journal/${r.journalId}`}>
                          <span className="mono">{r.journalNo}</span>
                        </Link>
                      )
                    : nil("tanpa journal — barang bernilai nol")}
                </Field>
              </FormRow>
            </FormSection>
          )}
          <p className="fnote">Barang masuk gudang dengan No. Stok yang sama dan senilai yang dibawanya dari produksi: Persediaan didebit, WIP dikredit.</p>
        </FormBody>
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        <div className="card-h">
          <span className="ci">
            <Icon name="layers" size={15} />
          </span>
          <div className="ct">
            <h3>Barang</h3>
            <p>{posted ? "Nilai adalah yang dilepas produksi saat Terima." : "Nilai terlihat setelah Terima."}</p>
          </div>
        </div>
        <div className="tw">
          <table className="grid ltab" style={{ minWidth: 720 }}>
            <thead>
              <tr>
                <th style={{ width: 44 }}>No</th>
                <th>No. Stok</th>
                <th>Barang</th>
                <th className="num" style={{ width: 110 }}>Qty</th>
                <th className="num" style={{ width: 110 }}>Gram</th>
                {posted && <th className="num" style={{ width: 150 }}>Nilai</th>}
              </tr>
            </thead>
            <tbody>
              {r.items.map((l) => (
                <tr key={l.lineNo}>
                  <td className="mut">{l.lineNo}</td>
                  <td>
                    <span className="mono">{l.lotNo}</span>
                  </td>
                  <td>
                    <span className="idc">
                      <span className="lab">{l.itemLabel}</span>
                      <span className="nm">{l.itemName}</span>
                    </span>
                  </td>
                  <td className="num">
                    {qtyText(l.qty)} {l.uomLabel}
                  </td>
                  <td className="num">{l.grams != null ? qtyText(l.grams) : <span className="dash">—</span>}</td>
                  {posted && (
                    <td className="num">
                      <Amount value={l.value} />
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
            {posted && (
              <tfoot>
                <tr>
                  <td colSpan={5} className="num">
                    Total
                  </td>
                  <td className="num">
                    <Amount value={r.cost} />
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      {asking && (
        <ConfirmDialog
          open
          wide
          icon="check"
          tone="ok"
          title="Terima BSTB ke Finish Goods"
          subject={r.no}
          body={`${r.lines} baris keluar dari produksi ${r.unitLabel} dan masuk ${r.warehouseLabel} dengan No. Stok yang sama, bertanggal hari ini. Dokumen yang sudah diterima tidak dapat diubah atau dibatalkan.`}
          confirmLabel="Ya, Terima"
          confirmTone="primary"
          busy={busy}
          confirmDisabled={!postable}
          onConfirm={receive}
          onCancel={() => setAsking(false)}
        >
          <JournalPreview load={() => previewFinishGoodsAction(r.id)} onReady={setPostable} />
        </ConfirmDialog>
      )}
    </>
  );
}
