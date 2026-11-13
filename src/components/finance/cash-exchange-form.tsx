"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icon";
import { CancelButton } from "@/components/ui/cancel-button";
import { Combobox } from "@/components/ui/combobox";
import { DateInput } from "@/components/ui/date-input";
import { Field, FormBody, FormRow, FormSection } from "@/components/ui/form";
import { MoneyInput } from "@/components/ui/money-input";
import { useToast } from "@/components/ui/toast";
import { CashExchangeActions } from "@/components/finance/cash-exchange-actions";
import { createCashExchangeAction, updateCashExchangeAction } from "@/app/actions/cash-exchange";
import {
  CASH_EXCHANGE_KIND_TEXT,
  CASH_EXCHANGE_PATH,
  CASH_EXCHANGE_STATUS_BADGE,
  CASH_EXCHANGE_STATUS_TEXT,
  cashExchangeKind,
  cashExchangeRate,
  type CashExchangeAbilities,
} from "@/lib/erp/cash-exchange-workflow";
import type { CashExchangeInput, CashExchangeOptions, CashExchangeView } from "@/lib/erp/cash-exchange";
import { BASE_CURRENCY_LABEL } from "@/lib/erp/currency";
import { formatDate, formatMoney, formatRate, todayIso } from "@/lib/format";

/**
 * A Penukaran Valas in all three modes (MC11a). The user names the two Kas &
 * Bank and types both amounts as the bank printed them; which kind it is, and
 * the rate the bank dealt at, follow from them and are shown, never typed.
 */
export function CashExchangeForm({
  mode,
  doc,
  options,
  can,
}: {
  mode: "new" | "edit" | "view";
  doc: CashExchangeView | null;
  options: CashExchangeOptions;
  can: CashExchangeAbilities;
}) {
  const router = useRouter();
  const toast = useToast();
  const editing = mode !== "view";

  const [form, setForm] = useState<CashExchangeInput>(() =>
    doc
      ? {
          exchange_date: doc.exchangeDate,
          from_cash_bank_id: doc.fromId,
          to_cash_bank_id: doc.toId,
          from_amount: String(doc.fromAmount),
          to_amount: String(doc.toAmount),
          reference: doc.reference ?? "",
          note: doc.note ?? "",
        }
      : { exchange_date: todayIso(), from_cash_bank_id: null, to_cash_bank_id: null, from_amount: "", to_amount: "", reference: "", note: "" }
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  const set = <K extends keyof CashExchangeInput>(key: K, v: CashExchangeInput[K]) => {
    setForm((f) => ({ ...f, [key]: v }));
    setDirty(true);
    setErrors((e) => {
      const next = { ...e };
      delete next[key];
      return next;
    });
  };

  const byId = new Map(options.resources.map((r) => [r.id, r]));
  const from = byId.get(Number(form.from_cash_bank_id));
  const to = byId.get(Number(form.to_cash_bank_id));
  const kind = from && to ? cashExchangeKind(from.isBase, to.isBase) : doc?.kind ?? null;
  const fromAmount = Number(form.from_amount) || 0;
  const toAmount = Number(form.to_amount) || 0;
  const rate = kind ? cashExchangeRate(kind, fromAmount, toAmount) : null;
  const foreign = kind === "Buy" ? to?.currency ?? doc?.to.currency : from?.currency ?? doc?.from.currency;
  const pickable = options.resources.map((r) => ({ ...r, name: `${r.name} · ${r.currency}` }));
  const status = doc?.status ?? "Draft";

  async function onSave() {
    setSaving(true);
    const result = mode === "edit" ? await updateCashExchangeAction(doc!.id, form) : await createCashExchangeAction(form);
    setSaving(false);
    if (!result.ok) {
      setErrors(result.errors);
      toast(result.errors._form ? "Tidak diizinkan" : "Belum bisa disimpan", result.errors._form ?? "Periksa kembali isian.", "err");
      return;
    }
    setDirty(false);
    toast("Penukaran Valas disimpan", `${result.exchangeNo} · Draft`, "ok");
    router.push(`${CASH_EXCHANGE_PATH}/${result.id}`);
  }

  const ro = (node: React.ReactNode) => <div className="ro">{node}</div>;
  const nil = (t = "tidak diisi") => <div className="ro nil">{t}</div>;
  const resource = (r: { label: string; name: string; currency: string } | undefined) =>
    r
      ? ro(
          <>
            <span className="lab">{r.label}</span>
            <span>{r.name}</span>
            <span className="rx">{r.currency}</span>
          </>
        )
      : nil();
  const picker = (key: "from_cash_bank_id" | "to_cash_bank_id", placeholder: string) => (
    <Combobox
      value={Number(form[key]) || null}
      options={pickable}
      placeholder={placeholder}
      emptyText="Belum ada Kas & Bank. Buat di Master › Entitas › Cash & Bank."
      invalid={Boolean(errors[key])}
      onChange={(v) => set(key, v)}
    />
  );
  const amount = (key: "from_amount" | "to_amount", currency: string | undefined) =>
    editing ? (
      <MoneyInput value={String(form[key] ?? "")} currencyLabel={currency} decimals={2} invalid={Boolean(errors[key])} onChange={(v) => set(key, v)} />
    ) : (
      ro(<span className="mny">{formatMoney(Number(form[key]), currency)}</span>)
    );

  const headerCard = (
    <div className="card">
      <FormBody>
        <FormSection title="Penukaran">
          <FormRow>
            <Field label="Tanggal" span={3} required={editing} help={editing ? "tanggal di rekening koran" : undefined} error={errors.exchange_date}>
              {editing ? (
                <DateInput value={form.exchange_date} invalid={Boolean(errors.exchange_date)} onChange={(v) => set("exchange_date", v)} />
              ) : (
                ro(formatDate(form.exchange_date))
              )}
            </Field>
            <Field label="Jenis" span={3} help={editing ? "mengikuti sisi rupiah" : undefined}>
              {kind ? ro(<span className="bdg t-info">{CASH_EXCHANGE_KIND_TEXT[kind]}</span>) : nil(editing ? "Pilih Kas & Bank dulu…" : "tidak dikenali")}
            </Field>
            <Field label="Kurs" span={3} help={editing ? `${BASE_CURRENCY_LABEL} per 1 ${foreign ?? "valas"}` : undefined}>
              {rate ? ro(<span className="mny">{formatRate(rate)}</span>) : nil(editing ? "dari kedua jumlah" : "—")}
            </Field>
            <Field label="No. Referensi Bank" span={3} help={editing ? "opsional" : undefined}>
              {editing ? (
                <input className="inp" value={form.reference ?? ""} placeholder="Nomor transaksi bank" onChange={(e) => set("reference", e.target.value)} />
              ) : form.reference ? (
                ro(<span className="mono">{form.reference}</span>)
              ) : (
                nil()
              )}
            </Field>
          </FormRow>
        </FormSection>
        <FormSection title="Keluar">
          <FormRow>
            <Field label="Dari Kas & Bank" span={6} required={editing} error={errors.from_cash_bank_id}>
              {editing ? picker("from_cash_bank_id", "Pilih Kas & Bank asal…") : resource(doc?.from)}
            </Field>
            <Field
              label="Jumlah Keluar"
              span={6}
              required={editing}
              help={editing && from ? `saldo ${formatMoney(from.balance, from.currency)}` : undefined}
              error={errors.from_amount}
            >
              {amount("from_amount", from?.currency ?? doc?.from.currency)}
            </Field>
          </FormRow>
        </FormSection>
        <FormSection title="Masuk">
          <FormRow>
            <Field label="Ke Kas & Bank" span={6} required={editing} error={errors.to_cash_bank_id}>
              {editing ? picker("to_cash_bank_id", "Pilih Kas & Bank tujuan…") : resource(doc?.to)}
            </Field>
            <Field label="Jumlah Masuk" span={6} required={editing} help={editing ? "yang dikreditkan bank" : undefined} error={errors.to_amount}>
              {amount("to_amount", to?.currency ?? doc?.to.currency)}
            </Field>
            <Field label="Catatan" span={12}>
              {editing ? (
                <textarea className="ta" rows={2} value={form.note ?? ""} placeholder="Keterangan tambahan…" onChange={(e) => set("note", e.target.value)} />
              ) : form.note ? (
                <div className="ro multi">{form.note}</div>
              ) : (
                <div className="ro multi nil">tidak diisi</div>
              )}
            </Field>
          </FormRow>
        </FormSection>
        {doc?.status === "Posted" && doc.fromBase !== null && doc.toBase !== null && (
          <p className="fnote">
            <b>Nilai dasar:</b> keluar {formatMoney(doc.fromBase, BASE_CURRENCY_LABEL)}, masuk {formatMoney(doc.toBase, BASE_CURRENCY_LABEL)}
            {doc.fxDifference !== 0 && (
              <>
                ; selisih kurs {doc.fxDifference > 0 ? "laba" : "rugi"} {formatMoney(Math.abs(doc.fxDifference), BASE_CURRENCY_LABEL)}
              </>
            )}
            .{" "}
            {doc.journalId && (
              <>
                Journal{" "}
                <Link className="drl" href={`/accounting/journal/${doc.journalId}`}>
                  <span className="mono">{doc.journalNo}</span>
                </Link>
                .
              </>
            )}
          </p>
        )}
        {doc?.cancelReason && (
          <p className="fnote">
            <b>Dibatalkan:</b> {doc.cancelReason}
          </p>
        )}
      </FormBody>
    </div>
  );

  const backHref = doc ? `${CASH_EXCHANGE_PATH}/${doc.id}` : CASH_EXCHANGE_PATH;
  return (
    <>
      <div className="ph">
        <div className="crumb">
          <span>Finance</span>
          <span>/</span>
          <Link href={CASH_EXCHANGE_PATH}>Penukaran Valas</Link>
          <span>/</span>
          <span className="cur">{doc ? doc.exchangeNo : "Baru"}</span>
        </div>
        <div className="ph-row">
          <h1>
            <span className="ph-ico">
              <Icon name="coin" size={16} />
            </span>
            {doc ? (
              <>
                <span className="docno">{doc.exchangeNo}</span>
                <span className={`bdg ${CASH_EXCHANGE_STATUS_BADGE[status]}`}>{CASH_EXCHANGE_STATUS_TEXT[status]}</span>
              </>
            ) : (
              "Penukaran Valas Baru"
            )}
            {mode === "edit" && <span className="bdg t-warn">Mode Ubah</span>}
          </h1>
          <div className="ph-act">
            {editing ? (
              <>
                {dirty && (
                  <span className="ph-dirty">
                    <span className="pulse" /> Belum disimpan
                  </span>
                )}
                <CancelButton href={backHref} dirty={dirty} disabled={saving} />
                <button className="btn primary" onClick={onSave} disabled={saving}>
                  <Icon name="save" size={15} /> {saving ? "Menyimpan…" : "Simpan"}
                </button>
              </>
            ) : (
              <CashExchangeActions id={doc!.id} subject={doc!.exchangeNo} status={status} can={can} />
            )}
          </div>
        </div>
      </div>

      <div className="fgrid solo">
        <div>{headerCard}</div>
      </div>
    </>
  );
}
