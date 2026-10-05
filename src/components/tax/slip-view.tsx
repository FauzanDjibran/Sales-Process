"use client";

import { useState } from "react";
import Link from "next/link";
import { Icon } from "@/components/icon";
import { DateInput } from "@/components/ui/date-input";
import { Dialog } from "@/components/ui/dialog";
import { Field, FormBody, FormRow, FormSection } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import { recordSlipReceivedAction } from "@/app/actions/tax";
import { documentHref } from "@/lib/erp/document-links";
import type { SlipView as Slip } from "@/lib/erp/tax-document";
import { SLIP_STATUS_BADGE, SLIP_STATUS_TEXT, slipLate, type TaxAbilities } from "@/lib/erp/tax-document-workflow";
import { formatDate, formatMoney, formatPct } from "@/lib/format";

const money = (n: number) => formatMoney(n, "IDR");
const ro = (node: React.ReactNode) => <div className="ro">{node}</div>;
const nil = (t = "tidak diisi") => <div className="ro nil">{t}</div>;

const DOC_TEXT: Record<string, string> = { fin_ar_invoice: "Invoice Penjualan", fin_ar_advance: "Uang Muka Penjualan" };

/**
 * One Bukti Potong PPh (P100, `tax_concept.md` §6): the PPh a customer withheld
 * from one document on one receipt, under one Jenis PPh (P69). The amount was
 * fixed when the receipt posted; what a user records is the customer's BPPU —
 * its number and date — with *Catat Bukti Potong*, after which the PPh can be
 * credited, and *Ubah Bukti Potong* corrects them later (P101).
 */
export function SlipView({ slip: s, can, today }: { slip: Slip; can: TaxAbilities; today: string }) {
  const [recording, setRecording] = useState(false);
  const late = slipLate(s, today);
  const doc = documentHref(s.docTable, s.docId);

  const headerCard = (
    <div className="card">
      <FormBody>
        <FormSection title="Pemotongan">
          <FormRow>
            <Field label="Pemotong" span={5}>
              {ro(
                <>
                  <span className="lab">{s.customerLabel}</span>
                  <span>{s.withholder.name}</span>
                </>
              )}
            </Field>
            <Field label={s.withholder.taxType ?? "NPWP / NIK"} span={3}>
              {s.withholder.taxId ? ro(<span className="mono">{s.withholder.taxId}</span>) : nil("belum ada di Partner")}
            </Field>
            <Field label="Masa Pajak" span={4}>
              {ro(<span className="mono">{s.taxPeriod}</span>)}
            </Field>
            <Field label="Tanggal Potong" span={4} help="tanggal penerimaan">
              {ro(formatDate(s.withheldDate))}
            </Field>
            <Field label="Jenis PPh" span={4}>
              {ro(
                <>
                  <span className="lab">{s.whtLabel}</span>
                  <span>{s.whtName}</span>
                </>
              )}
            </Field>
            <Field label="Diharapkan" span={4} help="tanggal 20 bulan berikutnya">
              {ro(
                <>
                  {formatDate(s.expected)}
                  {late && <span className="bdg t-bad">Perlu ditagih</span>}
                </>
              )}
            </Field>
            <Field label="Referensi" span={12}>
              {ro(
                <>
                  <span className="rx">Penerimaan</span>
                  <Link className="drl" href={`/finance/cash-bank/receipt/${s.receiptId}`}>
                    <span className="mono">{s.receiptNo}</span>
                  </Link>
                  <span className="rx">· {DOC_TEXT[s.docTable] ?? "Dokumen"}</span>
                  {doc ? (
                    <Link className="drl" href={doc}>
                      <span className="mono">{s.docNo}</span>
                    </Link>
                  ) : (
                    <span className="mono">{s.docNo}</span>
                  )}
                </>
              )}
            </Field>
          </FormRow>
        </FormSection>
        <FormSection title="Bukti Potong dari Customer (BPPU)">
          <FormRow>
            <Field label="Nomor Bukti Potong" span={6}>
              {s.slipNumber ? ro(<span className="mono">{s.slipNumber}</span>) : nil("belum diterima")}
            </Field>
            <Field label="Tanggal Bukti Potong" span={6}>
              {s.slipDate ? ro(formatDate(s.slipDate)) : nil("belum diterima")}
            </Field>
          </FormRow>
        </FormSection>
      </FormBody>
      <div className="cardfoot multi">
        <div className="impact">
          <div className="ttl">Perhitungan PPh</div>
          <div className="ir">
            <span>Dasar pengenaan (DPP)</span>
            <b>{money(s.base)}</b>
          </div>
          <div className="ir">
            <span>Tarif {s.whtLabel}</span>
            <b>{formatPct(s.rate)}</b>
          </div>
          <div className="ir tot">
            <span>PPh dipotong</span>
            <b>{money(s.amount)}</b>
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
          <Link href="/tax/withholding-slip">Bukti Potong PPh</Link>
          <span>/</span>
          <span className="cur">{s.slipNo}</span>
        </div>
        <div className="ph-row">
          <h1>
            <span className="ph-ico">
              <Icon name="scale" size={16} />
            </span>
            <span className="docno">{s.slipNo}</span>
            <span className={`bdg ${SLIP_STATUS_BADGE[s.status]}`}>{SLIP_STATUS_TEXT[s.status]}</span>
            {late && <span className="bdg t-bad">Perlu ditagih</span>}
          </h1>
          <div className="ph-act">
            <span className="lockchip">
              <Icon name="lock" size={13} /> Dibuat otomatis dari Penerimaan
            </span>
            {can.receive && (
              <button className={s.status === "Awaiting" ? "btn primary" : "btn"} onClick={() => setRecording(true)}>
                <Icon name={s.status === "Awaiting" ? "check" : "pen"} size={15} /> {s.status === "Awaiting" ? "Catat Bukti Potong" : "Ubah Bukti Potong"}
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="fgrid solo">
        <div>{headerCard}</div>
      </div>

      {recording && <ReceiveDialog slip={s} today={today} onClose={() => setRecording(false)} />}
    </>
  );
}

/** *Catat Bukti Potong* / *Ubah Bukti Potong*: the BPPU's number and date. */
function ReceiveDialog({ slip: s, today, onClose }: { slip: Slip; today: string; onClose: () => void }) {
  const toast = useToast();
  const correcting = s.status === "Received";
  const [number, setNumber] = useState(s.slipNumber ?? "");
  const [date, setDate] = useState(s.slipDate ?? today);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    const result = await recordSlipReceivedAction(s.id, { number, date });
    setBusy(false);
    if (!result.ok) {
      if (result.errors._form) toast("Tidak dapat disimpan", result.errors._form, "err");
      setErrors(result.errors);
      return;
    }
    toast(correcting ? "Bukti potong dikoreksi" : "Bukti potong dicatat diterima", s.slipNo, "ok");
    onClose();
  };

  return (
    <Dialog
      open
      icon={correcting ? "pen" : "check"}
      title={correcting ? "Ubah Bukti Potong" : "Catat Bukti Potong Diterima"}
      subtitle={`${s.slipNo} · ${s.whtLabel} ${money(s.amount)} · ${s.customerName}`}
      width={560}
      onClose={onClose}
      foot={
        <>
          <span className="fnote">Pastikan nilai pada BPPU sama dengan {money(s.amount)}.</span>
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
        <Field label="Nomor Bukti Potong" span={8} required error={errors.number} htmlFor="slipno">
          <input
            id="slipno"
            className={`inp idf${errors.number ? " bad" : ""}`}
            value={number}
            placeholder="Nomor BPPU dari customer"
            autoFocus
            onChange={(e) => setNumber(e.target.value)}
          />
        </Field>
        <Field label="Tanggal Bukti Potong" span={4} required error={errors.date}>
          <DateInput value={date} invalid={Boolean(errors.date)} onChange={setDate} />
        </Field>
      </FormRow>
    </Dialog>
  );
}
