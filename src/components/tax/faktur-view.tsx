"use client";

import { Fragment, useState } from "react";
import Link from "next/link";
import { Icon } from "@/components/icon";
import { DateInput } from "@/components/ui/date-input";
import { Dialog } from "@/components/ui/dialog";
import { Field, FormBody, FormRow, FormSection } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import { recordFakturUploadAction } from "@/app/actions/tax";
import { documentHref } from "@/lib/erp/document-links";
import type { FakturView as Faktur } from "@/lib/erp/tax-document";
import {
  FAKTUR_KIND_TEXT,
  FAKTUR_STATUS_BADGE,
  FAKTUR_STATUS_TEXT,
  fakturLate,
  normalizeNsfp,
  type TaxAbilities,
} from "@/lib/erp/tax-document-workflow";
import { formatDate, formatMoney, formatNumber, formatPct } from "@/lib/format";

const money = (n: number) => formatMoney(n, "IDR");
const qtyText = (n: number) => formatNumber(n, n % 1 ? 2 : 0);
const ro = (node: React.ReactNode) => <div className="ro">{node}</div>;
const nil = (t = "tidak diisi") => <div className="ro nil">{t}</div>;

/** What the source document was, in words. */
const SOURCE_TEXT: Record<string, string> = {
  fin_cash_bank_tx: "Penerimaan",
  sal_invoice: "Invoice Penjualan",
  sal_advance: "Uang Muka Penjualan",
};

/** A link to a document named by its table and id, or its number alone. */
function DocLink({ table, id, no }: { table: string; id: number; no: string }) {
  const href = documentHref(table, id);
  return href ? (
    <Link className="drl" href={href}>
      <span className="mono">{no}</span>
    </Link>
  ) : (
    <span className="mono">{no}</span>
  );
}

/**
 * One Faktur Pajak Keluaran (P100, `tax_concept.md` §5). Everything on it was
 * derived from the posting that made it — buyer, lines, DPP, DPP Nilai Lain,
 * PPN — so the page is read-only. The one thing a user records is the upload
 * to Coretax: *Catat Upload* takes the NSFP Coretax gave and the upload date,
 * and the faktur is then *Dilaporkan* and final.
 */
export function FakturView({
  faktur: f,
  orderNo,
  can,
  today,
}: {
  faktur: Faktur;
  orderNo: string | null;
  can: TaxAbilities;
  today: string;
}) {
  const [recording, setRecording] = useState(false);
  const late = fakturLate(f, today);
  const settlement = f.kind === "Settlement";

  const headerCard = (
    <div className="card">
      <FormBody>
        <FormSection title="Faktur">
          <FormRow>
            <Field label="Jenis Faktur" span={4} locked>
              {ro(FAKTUR_KIND_TEXT[f.kind])}
            </Field>
            <Field label="Tanggal Faktur" span={4} help="tanggal terutang PPN">
              {ro(formatDate(f.taxDate))}
            </Field>
            <Field label="Batas Upload" span={4} help="tanggal 15 bulan berikutnya">
              {ro(
                <>
                  {formatDate(f.deadline)}
                  {late && <span className="bdg t-bad">Terlambat</span>}
                </>
              )}
            </Field>
            <Field label="Nomor Seri Faktur Pajak" span={4} help={f.nsfp ? undefined : "diisi saat upload dicatat"}>
              {f.nsfp ? ro(<span className="mono">{f.nsfp}</span>) : nil("belum diupload")}
            </Field>
            <Field label="Tanggal Upload" span={4}>
              {f.reportedDate ? ro(formatDate(f.reportedDate)) : nil("belum diupload")}
            </Field>
            <Field label="Dokumen Sumber" span={4}>
              {ro(
                <>
                  <span className="rx">{SOURCE_TEXT[f.sourceTable] ?? "Dokumen"}</span>
                  <DocLink table={f.sourceTable} id={f.sourceId} no={f.sourceNo} />
                </>
              )}
            </Field>
            <Field label="Referensi" span={12}>
              {ro(
                <>
                  {orderNo && (
                    <Link className="drl" href={`/sales/customer-order/${f.customerOrderId}`}>
                      <span className="mono">{orderNo}</span>
                    </Link>
                  )}
                  {f.ref && (
                    <>
                      <span className="rx">·</span>
                      <DocLink table={f.ref.table} id={f.ref.id} no={f.ref.no} />
                    </>
                  )}
                  {f.deducts.map((d) => (
                    <Fragment key={d.id}>
                      <span className="rx">· memotong</span>
                      <Link className="drl" href={`/tax/faktur/${d.id}`}>
                        <span className="mono">{d.fakturNo}</span>
                      </Link>
                      <span className="rx">{d.nsfp ? `NSFP ${d.nsfp}` : "NSFP belum ada"}</span>
                    </Fragment>
                  ))}
                  {f.deductedBy.map((d) => (
                    <Fragment key={d.id}>
                      <span className="rx">· dipotong oleh</span>
                      <Link className="drl" href={`/tax/faktur/${d.id}`}>
                        <span className="mono">{d.fakturNo}</span>
                      </Link>
                      <span className="rx">DPP {money(d.dpp)}</span>
                    </Fragment>
                  ))}
                </>
              )}
            </Field>
          </FormRow>
        </FormSection>
        <FormSection title="Pembeli">
          <FormRow>
            <Field label="Nama sesuai Identitas Pajak" span={5}>
              {ro(
                <>
                  <span className="lab">{f.buyer.label}</span>
                  <span>{f.buyer.name}</span>
                </>
              )}
            </Field>
            <Field label={f.buyer.taxType ?? "NPWP / NIK"} span={3}>
              {f.buyer.taxId ? ro(<span className="mono">{f.buyer.taxId}</span>) : nil("belum ada di Partner")}
            </Field>
            <Field label="Uraian" span={4}>
              {f.description ? ro(f.description) : nil()}
            </Field>
            <Field label="Alamat" span={12}>
              {f.buyer.address ? <div className="ro multi">{f.buyer.address}</div> : nil()}
            </Field>
          </FormRow>
        </FormSection>
      </FormBody>
    </div>
  );

  const linesCard = (
    <div className="card" style={{ marginTop: 14 }}>
      <div className="card-h">
        <span className="ci">
          <Icon name="box" size={15} />
        </span>
        <div className="ct">
          <h3>Rincian</h3>
          <p>
            PPN dihitung per baris lalu dijumlahkan, seperti tercetak di faktur
            {settlement ? "; DPP tiap baris sudah dikurangi uang muka yang dipotong" : ""}.
          </p>
        </div>
      </div>
      <div className="tw">
        <table className="grid ltab" style={{ minWidth: settlement ? 1120 : 860 }}>
          <thead>
            <tr>
              <th style={{ width: 40 }}>No</th>
              <th>Uraian</th>
              <th className="num" style={{ width: 100 }}>
                Qty
              </th>
              <th className="num" style={{ width: 120 }}>
                Harga
              </th>
              {settlement && (
                <>
                  <th className="num" style={{ width: 130 }}>
                    DPP Barang
                  </th>
                  <th className="num" style={{ width: 120 }}>
                    Uang Muka
                  </th>
                </>
              )}
              <th className="num" style={{ width: 130 }}>
                DPP
              </th>
              <th className="num" style={{ width: 130 }}>
                DPP Nilai Lain
              </th>
              <th className="num" style={{ width: 120 }}>
                PPN
              </th>
            </tr>
          </thead>
          <tbody>
            {f.lines.map((l) => (
              <tr key={l.lineNo}>
                <td className="no">{l.lineNo}</td>
                <td>
                  {l.itemLabel ? (
                    <span className="idc">
                      <span className="lab">{l.itemLabel}</span>
                      <span className="nm">{l.description}</span>
                    </span>
                  ) : (
                    l.description
                  )}
                </td>
                <td className="num">
                  {l.qty != null ? (
                    <span className="mny">
                      {qtyText(l.qty)} {l.uomLabel}
                    </span>
                  ) : (
                    <span className="dash">—</span>
                  )}
                </td>
                <td className="num">{l.price != null ? <span className="mny">{money(l.price)}</span> : <span className="dash">—</span>}</td>
                {settlement && (
                  <>
                    <td className="num">
                      <span className="mny">{money(l.grossDpp)}</span>
                    </td>
                    <td className="num">
                      {l.advanceDpp ? <span className="mny">−{money(l.advanceDpp)}</span> : <span className="dash">—</span>}
                    </td>
                  </>
                )}
                <td className="num">
                  <span className="mny">{money(l.dpp)}</span>
                </td>
                <td className="num">
                  <span className="mny">{money(l.dppOther)}</span>
                </td>
                <td className="num">
                  <span className="mny">{money(l.ppn)}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="cardfoot multi">
        <div className="impact">
          <div className="ttl">Perhitungan PPN</div>
          {settlement && (
            <>
              <div className="ir">
                <span>DPP barang</span>
                <b>{money(f.grossDpp)}</b>
              </div>
              <div className="ir">
                <span>Dikurangi DPP uang muka</span>
                <b>−{money(f.advanceDpp)}</b>
              </div>
            </>
          )}
          <div className="ir">
            <span>DPP</span>
            <b>{money(f.dpp)}</b>
          </div>
          <div className="ir">
            <span>
              DPP Nilai Lain ({f.rates.otherNum}/{f.rates.otherDen}, per baris)
            </span>
            <b>{money(f.dppOther)}</b>
          </div>
          <div className="ir">
            <span>PPN {formatPct(f.rates.rate)} × DPP Nilai Lain</span>
            <b>{money(f.ppn)}</b>
          </div>
          <div className="ir tot">
            <span>PPN Keluaran</span>
            <b>{money(f.ppn)}</b>
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <>
      <div className="ph">
        <div className="crumb">
          <span>Pajak</span>
          <span>/</span>
          <Link href="/tax/faktur">Faktur Pajak Keluaran</Link>
          <span>/</span>
          <span className="cur">{f.fakturNo}</span>
        </div>
        <div className="ph-row">
          <h1>
            <span className="ph-ico">
              <Icon name="tags" size={16} />
            </span>
            <span className="docno">{f.fakturNo}</span>
            <span className={`bdg ${FAKTUR_STATUS_BADGE[f.status]}`}>{FAKTUR_STATUS_TEXT[f.status]}</span>
            {late && <span className="bdg t-bad">Terlambat</span>}
          </h1>
          <div className="ph-act">
            <span className="lockchip">
              <Icon name="lock" size={13} /> Dibuat otomatis dari {SOURCE_TEXT[f.sourceTable] ?? "posting"}
            </span>
            {f.status === "Awaiting" && can.upload && (
              <button className="btn primary" onClick={() => setRecording(true)}>
                <Icon name="send" size={15} /> Catat Upload
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="fgrid solo">
        <div>
          {headerCard}
          {linesCard}
        </div>
      </div>

      {recording && <UploadDialog faktur={f} today={today} onClose={() => setRecording(false)} />}
    </>
  );
}

/** *Catat Upload*: the NSFP from Coretax and the upload date. */
function UploadDialog({ faktur: f, today, onClose }: { faktur: Faktur; today: string; onClose: () => void }) {
  const toast = useToast();
  const [nsfp, setNsfp] = useState("");
  const [date, setDate] = useState(today);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const digits = normalizeNsfp(nsfp).length;

  const save = async () => {
    setBusy(true);
    const result = await recordFakturUploadAction(f.id, { nsfp, date });
    setBusy(false);
    if (!result.ok) {
      if (result.errors._form) toast("Tidak dapat disimpan", result.errors._form, "err");
      setErrors(result.errors);
      return;
    }
    toast("Upload dicatat — faktur dilaporkan", f.fakturNo, "ok");
    onClose();
  };

  return (
    <Dialog
      open
      icon="send"
      title="Catat Upload Coretax"
      subtitle={`${f.fakturNo} · ${FAKTUR_KIND_TEXT[f.kind]} · PPN ${money(f.ppn)}`}
      width={560}
      onClose={onClose}
      foot={
        <>
          <span className="fnote">Setelah dicatat, faktur menjadi Dilaporkan dan tidak dapat diubah.</span>
          <button className="btn" onClick={onClose} disabled={busy}>
            Batal
          </button>
          <button className="btn primary" onClick={save} disabled={busy}>
            <Icon name="check" size={15} /> {busy ? "Menyimpan…" : "Simpan"}
          </button>
        </>
      }
    >
      <FormRow>
        <Field label="Nomor Seri Faktur Pajak" span={8} required help={`${digits}/17 digit`} error={errors.nsfp} htmlFor="nsfp">
          <input
            id="nsfp"
            className={`inp idf${errors.nsfp ? " bad" : ""}`}
            value={nsfp}
            placeholder="NSFP dari Coretax"
            autoFocus
            onChange={(e) => setNsfp(e.target.value)}
          />
        </Field>
        <Field label="Tanggal Upload" span={4} required error={errors.date}>
          <DateInput value={date} invalid={Boolean(errors.date)} onChange={setDate} />
        </Field>
      </FormRow>
    </Dialog>
  );
}
