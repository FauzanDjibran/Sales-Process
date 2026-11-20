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
import { RateInput } from "@/components/ui/rate-input";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { CashTransferActions } from "@/components/finance/cash-transfer-actions";
import { createCashTransferAction, updateCashTransferAction } from "@/app/actions/cash-transfer";
import {
  CASH_TRANSFER_PATH,
  CASH_TRANSFER_PURPOSES,
  CASH_TRANSFER_PURPOSE_TEXT,
  CASH_TRANSFER_STATUS_BADGE,
  CASH_TRANSFER_STATUS_TEXT,
  crossesCurrency,
  transferDestinationRefusal,
  transferLineAmounts,
  transferSourceRefusal,
  type CashTransferAbilities,
  type CashTransferPurpose,
} from "@/lib/erp/cash-transfer-workflow";
import type { CashTransferInput, CashTransferOptions, CashTransferView } from "@/lib/erp/cash-transfer";
import { BASE_CURRENCY_LABEL } from "@/lib/erp/currency";
import { formatDate, formatMoney, formatRate, todayIso } from "@/lib/format";

type Line = { to_cash_bank_id: number | null; amount: string; exchange_rate: string };

/**
 * A Transfer Kas & Bank in all three modes (P299). The user states the purpose,
 * the source and each destination; a line types its amount in the document
 * currency and, when the pair crosses, the kurs — the rupiah side follows.
 */
export function CashTransferForm({
  mode,
  doc,
  options,
  can,
}: {
  mode: "new" | "edit" | "view";
  doc: CashTransferView | null;
  options: CashTransferOptions;
  can: CashTransferAbilities;
}) {
  const router = useRouter();
  const toast = useToast();
  const editing = mode !== "view";

  const [head, setHead] = useState({
    transfer_date: doc?.transferDate ?? todayIso(),
    purpose: (doc?.purpose ?? "Transfer") as CashTransferPurpose,
    from_cash_bank_id: doc?.fromId ?? (null as number | null),
    reference: doc?.reference ?? "",
    note: doc?.note ?? "",
  });
  const [lines, setLines] = useState<Line[]>(() =>
    doc?.lines.length
      ? doc.lines.map((l) => ({ to_cash_bank_id: l.toId, amount: String(l.amount), exchange_rate: String(l.rate) }))
      : [{ to_cash_bank_id: null, amount: "", exchange_rate: "" }]
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  const touch = (keys: string[]) => {
    setDirty(true);
    setErrors((e) => {
      const next = { ...e };
      for (const k of keys) delete next[k];
      return next;
    });
  };
  const setH = <K extends keyof typeof head>(key: K, v: (typeof head)[K]) => {
    setHead((h) => ({ ...h, [key]: v }));
    touch([key]);
  };
  const setLine = (i: number, patch: Partial<Line>) => {
    setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
    touch(Object.keys(patch).map((k) => `lines.${i}.${k}`).concat("lines"));
  };

  const byId = new Map(options.resources.map((r) => [r.id, r]));
  const purpose = head.purpose;
  const crosses = crossesCurrency(purpose);
  const from = head.from_cash_bank_id ? byId.get(head.from_cash_bank_id) : undefined;
  const firstForeignTo = lines.map((l) => (l.to_cash_bank_id ? byId.get(l.to_cash_bank_id) : undefined)).find((r) => r && !r.isBase);
  const docCurrency = purpose === "PembelianValas" ? firstForeignTo?.currency ?? doc?.currency : from?.currency ?? doc?.currency;
  const sourceCurrency = from?.currency ?? doc?.from.currency;
  const status = doc?.status ?? "Draft";

  const sourceOptions = options.resources
    .filter((r) => (r.active && !transferSourceRefusal(purpose, r.isBase, r.currency)) || r.id === head.from_cash_bank_id)
    .map((r) => ({ ...r, name: `${r.name} · ${r.currency}` }));
  const destOptions = (i: number) =>
    options.resources
      .filter(
        (r) =>
          r.id === lines[i].to_cash_bank_id ||
          (r.active &&
            r.id !== head.from_cash_bank_id &&
            !lines.some((l, j) => j !== i && l.to_cash_bank_id === r.id) &&
            !transferDestinationRefusal(purpose, docCurrency ?? r.currency, r.currency, r.isBase))
      )
      .map((r) => ({ ...r, name: `${r.name} · ${r.currency}` }));

  const figures = lines.map((l) => transferLineAmounts(purpose, Number(l.amount) || 0, crosses ? Number(l.exchange_rate) || 0 : 1));
  const totalAmount = lines.reduce((s, l) => s + (Number(l.amount) || 0), 0);
  const totalOut = figures.reduce((s, f) => s + f.outAmount, 0);

  async function onSave() {
    setSaving(true);
    const input: CashTransferInput = { ...head, lines };
    const result = mode === "edit" ? await updateCashTransferAction(doc!.id, input) : await createCashTransferAction(input);
    setSaving(false);
    if (!result.ok) {
      setErrors(result.errors);
      toast(result.errors._form ? "Tidak diizinkan" : "Belum bisa disimpan", result.errors._form ?? "Periksa kembali isian.", "err");
      return;
    }
    setDirty(false);
    toast("Transfer disimpan", `${result.transferNo} · Draft`, "ok");
    router.push(`${CASH_TRANSFER_PATH}/${result.id}`);
  }

  const ro = (node: React.ReactNode) => <div className="ro">{node}</div>;
  const nil = (t = "tidak diisi") => <div className="ro nil">{t}</div>;
  const lineErrors = Object.entries(errors).filter(([k]) => k.startsWith("lines"));

  const headerCard = (
    <div className="card">
      <FormBody>
        <FormSection title="Transfer">
          <FormRow>
            <Field label="Tujuan Transfer" span={4} required={editing} help={editing ? CASH_TRANSFER_PURPOSES.find((p) => p.key === purpose)?.hint : undefined} error={errors.purpose}>
              {editing ? (
                <Select
                  value={purpose}
                  options={CASH_TRANSFER_PURPOSES.map((p) => ({ value: p.key, label: p.label }))}
                  invalid={Boolean(errors.purpose)}
                  onChange={(v) => setH("purpose", v as CashTransferPurpose)}
                />
              ) : (
                ro(<span className="bdg t-info">{CASH_TRANSFER_PURPOSE_TEXT[purpose]}</span>)
              )}
            </Field>
            <Field label="Tanggal" span={4} required={editing} help={editing ? "tanggal di rekening koran" : undefined} error={errors.transfer_date}>
              {editing ? (
                <DateInput value={head.transfer_date} invalid={Boolean(errors.transfer_date)} onChange={(v) => setH("transfer_date", v)} />
              ) : (
                ro(formatDate(head.transfer_date))
              )}
            </Field>
            <Field label="No. Referensi Bank" span={4} help={editing ? "opsional" : undefined}>
              {editing ? (
                <input className="inp" value={head.reference} placeholder="Nomor transaksi bank" onChange={(e) => setH("reference", e.target.value)} />
              ) : head.reference ? (
                ro(<span className="mono">{head.reference}</span>)
              ) : (
                nil()
              )}
            </Field>
            <Field
              label="Dari Kas & Bank"
              span={6}
              required={editing}
              help={editing && from ? `saldo ${formatMoney(from.balance, from.currency)}` : undefined}
              error={errors.from_cash_bank_id}
            >
              {editing ? (
                <Combobox
                  value={head.from_cash_bank_id}
                  options={sourceOptions}
                  placeholder="Pilih Kas & Bank asal…"
                  emptyText="Belum ada Kas & Bank yang sesuai tujuan ini."
                  invalid={Boolean(errors.from_cash_bank_id)}
                  onChange={(v) => setH("from_cash_bank_id", v)}
                />
              ) : (
                ro(
                  <>
                    <span className="lab">{doc!.from.label}</span>
                    <span>{doc!.from.name}</span>
                    <span className="rx">{doc!.from.currency}</span>
                  </>
                )
              )}
            </Field>
            <Field label="Catatan" span={6}>
              {editing ? (
                <input className="inp" value={head.note} placeholder="Keterangan tambahan…" onChange={(e) => setH("note", e.target.value)} />
              ) : head.note ? (
                ro(head.note)
              ) : (
                nil()
              )}
            </Field>
          </FormRow>
        </FormSection>
        {doc?.status === "Posted" && doc.fromBase !== null && (
          <p className="fnote">
            <b>Nilai dasar keluar:</b> {formatMoney(doc.fromBase, BASE_CURRENCY_LABEL)}
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

  const rupiahHeading = purpose === "Pencairan" ? `${BASE_CURRENCY_LABEL} Diterima` : `${BASE_CURRENCY_LABEL} Dibayar`;
  const linesCard = (
    <div className="card" style={{ marginTop: 14 }}>
      <div className="card-h">
        <span className="ci">
          <Icon name="link" size={15} />
        </span>
        <div className="ct">
          <h3>Kas &amp; Bank Tujuan</h3>
          <p>
            {crosses
              ? `Jumlah dalam ${docCurrency ?? "valas"} dan kurs bank; sisi ${BASE_CURRENCY_LABEL} = jumlah × kurs.`
              : "Jumlah yang dipindahkan ke setiap Kas & Bank tujuan."}
          </p>
        </div>
        {editing && (
          <div className="ph-act" style={{ marginLeft: "auto" }}>
            <button
              type="button"
              className="btn sm"
              onClick={() => {
                setLines((ls) => [...ls, { to_cash_bank_id: null, amount: "", exchange_rate: "" }]);
                touch(["lines"]);
              }}
            >
              <Icon name="plus" size={13} /> Tambah Tujuan
            </button>
          </div>
        )}
      </div>
      {lineErrors.length > 0 && (
        <div className="nbox bad slim">
          <Icon name="warn" size={15} className="ni" />
          <div>
            <b>{lineErrors.map(([k, v]) => (k === "lines" ? v : `Baris ${Number(k.split(".")[1]) + 1}: ${v}`)).join(" ")}</b>
          </div>
        </div>
      )}
      <div className="tw">
        <table className="grid ltab" style={{ minWidth: crosses ? 860 : 600 }}>
          <thead>
            <tr>
              <th style={{ width: 34 }}>No</th>
              <th style={{ minWidth: 240 }}>Kas &amp; Bank Tujuan</th>
              <th className="num" style={{ width: 180 }}>
                Jumlah ({docCurrency ?? "—"})
              </th>
              {crosses && (
                <>
                  <th className="num" style={{ width: 170 }}>
                    Kurs ({docCurrency ?? "valas"} → {BASE_CURRENCY_LABEL})
                  </th>
                  <th className="num" style={{ width: 170 }}>
                    {rupiahHeading}
                  </th>
                </>
              )}
              {doc?.status === "Posted" && purpose === "Pencairan" && (
                <th className="num" style={{ width: 150 }}>
                  Selisih Kurs
                </th>
              )}
              {editing && <th style={{ width: 44 }} />}
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => {
              const f = figures[i];
              const rupiah = purpose === "Pencairan" ? f.inAmount : f.outAmount;
              const bad = (k: string) => Boolean(errors[`lines.${i}.${k}`]);
              return (
                <tr key={i} className={lineErrors.some(([k]) => k.startsWith(`lines.${i}.`)) ? "overrow" : undefined}>
                  <td className="mono">{i + 1}</td>
                  <td>
                    {editing ? (
                      <Combobox
                        size="sm"
                        value={l.to_cash_bank_id}
                        options={destOptions(i)}
                        placeholder={head.from_cash_bank_id ? "Pilih Kas & Bank tujuan…" : "Pilih Kas & Bank asal dulu…"}
                        emptyText="Tidak ada Kas & Bank yang sesuai tujuan ini."
                        invalid={bad("to_cash_bank_id")}
                        onChange={(v) => setLine(i, { to_cash_bank_id: v })}
                      />
                    ) : (
                      <span className="dstack">
                        <span className="d1">
                          <span className="lab">{doc!.lines[i].to.label}</span> {doc!.lines[i].to.name}
                        </span>
                        <span className="d2">{doc!.lines[i].to.currency}</span>
                      </span>
                    )}
                  </td>
                  <td className="num">
                    {editing ? (
                      <MoneyInput size="sm" value={l.amount} decimals={2} invalid={bad("amount")} onChange={(v) => setLine(i, { amount: v })} />
                    ) : (
                      <span className="mny">{formatMoney(Number(l.amount), docCurrency)}</span>
                    )}
                  </td>
                  {crosses && (
                    <>
                      <td className="num">
                        {editing ? (
                          <RateInput size="sm" value={l.exchange_rate} invalid={bad("exchange_rate")} onChange={(v) => setLine(i, { exchange_rate: v })} />
                        ) : (
                          <span className="mny">{formatRate(Number(l.exchange_rate))}</span>
                        )}
                      </td>
                      <td className="num">
                        {rupiah > 0 ? <span className="mny">{formatMoney(rupiah, BASE_CURRENCY_LABEL)}</span> : <span className="dash">—</span>}
                      </td>
                    </>
                  )}
                  {doc?.status === "Posted" && purpose === "Pencairan" && (
                    <td className="num">
                      <span className="mny">{formatMoney(doc.lines[i].fxDifference, BASE_CURRENCY_LABEL)}</span>
                    </td>
                  )}
                  {editing && (
                    <td>
                      {lines.length > 1 && (
                        <button
                          type="button"
                          className="iact del"
                          title="Hapus baris"
                          onClick={() => {
                            setLines((ls) => ls.filter((_, j) => j !== i));
                            setErrors({});
                            setDirty(true);
                          }}
                        >
                          <Icon name="trash" size={14} />
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <td />
              <td>
                <b>Total</b>
                {sourceCurrency && totalOut > 0 && (
                  <span className="d2"> · keluar dari asal {formatMoney(totalOut, sourceCurrency)}</span>
                )}
              </td>
              <td className="num">
                <b className="mny">{formatMoney(totalAmount, docCurrency)}</b>
              </td>
              {crosses && (
                <>
                  <td />
                  <td className="num">
                    <b className="mny">{formatMoney(figures.reduce((s, f) => s + (purpose === "Pencairan" ? f.inAmount : f.outAmount), 0), BASE_CURRENCY_LABEL)}</b>
                  </td>
                </>
              )}
              {doc?.status === "Posted" && purpose === "Pencairan" && (
                <td className="num">
                  <b className="mny">{formatMoney(doc.fxDifference, BASE_CURRENCY_LABEL)}</b>
                </td>
              )}
              {editing && <td />}
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );

  const backHref = doc ? `${CASH_TRANSFER_PATH}/${doc.id}` : CASH_TRANSFER_PATH;
  return (
    <>
      <div className="ph">
        <div className="crumb">
          <span>Finance</span>
          <span>/</span>
          <Link href={CASH_TRANSFER_PATH}>Transfer</Link>
          <span>/</span>
          <span className="cur">{doc ? doc.transferNo : "Baru"}</span>
        </div>
        <div className="ph-row">
          <h1>
            <span className="ph-ico">
              <Icon name="link" size={16} />
            </span>
            {doc ? (
              <>
                <span className="docno">{doc.transferNo}</span>
                <span className={`bdg ${CASH_TRANSFER_STATUS_BADGE[status]}`}>{CASH_TRANSFER_STATUS_TEXT[status]}</span>
              </>
            ) : (
              "Transfer Baru"
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
              <CashTransferActions id={doc!.id} subject={doc!.transferNo} status={status} can={can} />
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
    </>
  );
}
