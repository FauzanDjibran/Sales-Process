"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icon";
import { CancelButton } from "@/components/ui/cancel-button";
import { Combobox } from "@/components/ui/combobox";
import { DateInput } from "@/components/ui/date-input";
import { DocumentHeader } from "@/components/ui/document-header";
import { JournalReference } from "@/components/ui/journal-reference";
import { Field, FormBody, FormRow, FormSection } from "@/components/ui/form";
import { FormTabs, tabHasError } from "@/components/ui/form-tabs";
import { MoneyInput } from "@/components/ui/money-input";
import { SaveButtons, firstStep, withStep } from "@/components/ui/save-buttons";
import { useToast } from "@/components/ui/toast";
import { CreditApplicationActions } from "@/components/finance/credit-application-actions";
import { createCreditApplicationAction, updateCreditApplicationAction } from "@/app/actions/ar-credit-application";
import type { ApplicableCredit, CreditApplicationHeaderInput, CreditApplicationOptions, CreditApplicationView } from "@/lib/erp/ar-credit-application";
import {
  CREDIT_APPLICATION_STATUS_BADGE,
  CREDIT_APPLICATION_STATUS_TEXT,
  CREDIT_APPLICATION_TRANSITIONS,
  availableCreditApplicationActions,
  type CreditApplicationAbilities,
} from "@/lib/erp/ar-credit-application-workflow";
import { isBaseCurrency } from "@/lib/erp/currency";
import { formatDate, formatMoney, todayIso } from "@/lib/format";

/**
 * A Penerapan Kredit in all three modes (P332): each line takes part of one
 * Credit Note's open credit off one open Invoice of the same customer and
 * currency. Nothing is paired for the user; picking both fills the most that
 * line can take, which they may lower.
 */

type LineState = { key: number; credit_note_id: number | null; invoice_id: number | null; amount: string };

const BASE = "/finance/invoice/credit-application";
const cents = (n: number) => Math.round(n * 100);

export function CreditApplicationForm({
  mode,
  application,
  options,
  can,
}: {
  mode: "new" | "edit" | "view";
  application: CreditApplicationView | null;
  options: CreditApplicationOptions;
  can: CreditApplicationAbilities;
}) {
  const router = useRouter();
  const toast = useToast();
  const editing = mode !== "view";

  const [header, setHeader] = useState<CreditApplicationHeaderInput>(
    () => application?.header ?? { customer_id: null, currency_id: null, application_date: todayIso(), note: "" }
  );
  const [lines, setLines] = useState<LineState[]>(
    () => application?.lines.map((l, i) => ({ key: i, credit_note_id: l.credit_note_id, invoice_id: l.invoice_id, amount: String(l.amount) })) ?? []
  );
  const [nextKey, setNextKey] = useState(lines.length);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  const ofHeader = (c: ApplicableCredit) => c.customerId === header.customer_id && c.currencyId === header.currency_id;
  const credits = options.credits.filter(ofHeader);
  const picked = credits[0];
  const currency = application?.currency ?? picked?.currency ?? "IDR";
  const invoices = options.invoices.filter((i) => i.customerId === header.customer_id && i.currency === currency);
  const money = (n: number) => formatMoney(n, currency);
  const creditOf = (id: number | null) => credits.find((c) => c.id === id);
  const invoiceOf = (id: number | null) => invoices.find((i) => i.id === id);

  // A customer with credit in two currencies is two choices: one document is one currency.
  const parties = [...new Map(options.credits.map((c) => [`${c.customerId}:${c.currencyId}`, c])).values()];

  const changed = () => {
    setDirty(true);
    setErrors({});
  };
  const setLine = (key: number, patch: Partial<LineState>) => {
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
    changed();
  };
  /** The most a line may take: its credit and its Invoice, less what the other lines take of each. */
  const roomOf = (l: LineState) => {
    const taken = (f: "credit_note_id" | "invoice_id") =>
      lines.filter((x) => x.key !== l.key && x[f] === l[f]).reduce((a, x) => a + cents(Number(x.amount) || 0), 0);
    const c = creditOf(l.credit_note_id);
    const i = invoiceOf(l.invoice_id);
    if (!c || !i) return 0;
    return Math.max(0, Math.min(cents(c.free) - taken("credit_note_id"), cents(i.free) - taken("invoice_id"))) / 100;
  };
  const pick = (l: LineState, patch: Partial<LineState>) => {
    const next = { ...l, ...patch };
    const room = roomOf(next);
    setLine(l.key, { ...patch, amount: next.credit_note_id && next.invoice_id && room > 0 ? String(room) : "" });
  };
  const addLine = () => {
    setLines((ls) => [...ls, { key: nextKey, credit_note_id: null, invoice_id: null, amount: "" }]);
    setNextKey((k) => k + 1);
    changed();
  };

  const total = lines.reduce((a, l) => a + cents(Number(l.amount) || 0), 0) / 100;
  const next = firstStep(availableCreditApplicationActions("Draft", can), CREDIT_APPLICATION_TRANSITIONS);

  async function onSave(step?: string) {
    setSaving(true);
    const payload = lines.map(({ credit_note_id, invoice_id, amount }) => ({ credit_note_id, invoice_id, amount }));
    const result = mode === "edit" ? await updateCreditApplicationAction(application!.id, header, payload) : await createCreditApplicationAction(header, payload);
    setSaving(false);
    if (!result.ok) {
      setErrors(result.errors);
      toast(result.errors._form ? "Tidak diizinkan" : "Belum bisa disimpan", result.errors._form ?? result.errors._lines ?? Object.values(result.errors)[0], "err");
      return;
    }
    setDirty(false);
    toast("Penerapan Kredit disimpan", `${result.applicationNo} · Draft`, "ok");
    router.push(withStep(`${BASE}/${result.id}`, step));
  }

  const status = application?.status ?? "Draft";
  const ro = (node: React.ReactNode) => <div className="ro">{node}</div>;

  const linesCard = (
    <div className="card">
      <div className="card-h">
        <span className="ci">
          <Icon name="file" size={15} />
        </span>
        <div className="ct">
          <h3>Kredit yang Dipotong</h3>
          <p>{editing ? "Setiap baris memotongkan kredit satu Credit Note ke satu Invoice, sebagian atau seluruhnya." : "Nilai yang dipotongkan dari setiap Credit Note ke Invoice."}</p>
        </div>
        {editing && (
          <button type="button" className="btn sm" disabled={!header.customer_id} onClick={addLine}>
            <Icon name="plus" size={14} /> Tambah Baris
          </button>
        )}
      </div>
      {errors._lines && (
        <div className="nbox bad slim">
          <Icon name="warn" size={15} className="ni" />
          <div>
            <b>{errors._lines}</b>
          </div>
        </div>
      )}
      {lines.length === 0 ? (
        <div className="empty sm">
          <div className="ic">
            <Icon name="file" size={18} />
          </div>
          <h4>{header.customer_id ? "Belum ada baris" : "Pilih Customer dulu…"}</h4>
          <p>Tambah baris, lalu pilih Credit Note dan Invoice yang dipotong.</p>
        </div>
      ) : (
        <div className="tw">
          <table className="grid ltab" style={{ minWidth: editing ? 900 : 700 }}>
            <thead>
              <tr>
                <th style={{ width: 40 }}>No</th>
                <th>Credit Note</th>
                <th>Invoice Penjualan</th>
                <th className="num" style={{ width: 200 }}>
                  Dipotong
                </th>
                {editing && <th style={{ width: 40 }} />}
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => {
                const c = creditOf(l.credit_note_id);
                const v = invoiceOf(l.invoice_id);
                const room = roomOf(l);
                const over = editing && Boolean(c && v) && cents(Number(l.amount) || 0) > cents(room);
                const error = errors[`lines.${i}.credit_note_id`] ?? errors[`lines.${i}.invoice_id`] ?? errors[`lines.${i}.amount`];
                return (
                  <tr key={l.key} className={error || over ? "overrow" : undefined}>
                    <td className="no">{i + 1}</td>
                    <td>
                      {editing ? (
                        <Combobox
                          value={l.credit_note_id}
                          options={credits.map((x) => ({ id: x.id, label: x.no, name: `sisa ${money(x.free)}`, active: true }))}
                          placeholder="Pilih Credit Note…"
                          invalid={Boolean(errors[`lines.${i}.credit_note_id`])}
                          onChange={(id) => pick(l, { credit_note_id: id })}
                        />
                      ) : (
                        <Link className="drl" href={`/finance/invoice/credit-note/${l.credit_note_id}`}>
                          <span className="mono">{c?.no}</span>
                        </Link>
                      )}
                      {c && <span className="fulltag">{editing ? `sisa ${money(c.free)} · atas ${c.invoiceNo}` : `atas ${c.invoiceNo}`}</span>}
                      {error && <span className="overtag">{error}</span>}
                    </td>
                    <td>
                      {editing ? (
                        <Combobox
                          value={l.invoice_id}
                          options={invoices.map((x) => ({ id: x.id, label: x.no, name: `sisa ${money(x.free)}`, active: true }))}
                          placeholder="Pilih Invoice…"
                          emptyText="Tidak ada Invoice terbuka customer ini dalam currency yang sama."
                          invalid={Boolean(errors[`lines.${i}.invoice_id`])}
                          onChange={(id) => pick(l, { invoice_id: id })}
                        />
                      ) : (
                        <Link className="drl" href={`/finance/invoice/sales/${l.invoice_id}`}>
                          <span className="mono">{v?.no}</span>
                        </Link>
                      )}
                      {v && (
                        <span className="fulltag">
                          {editing && `sisa ${money(v.free)} · `}jatuh tempo {formatDate(v.dueDate)}
                        </span>
                      )}
                    </td>
                    <td className="num">
                      {editing ? (
                        <>
                          <MoneyInput
                            size="sm"
                            decimals={isBaseCurrency(currency) ? 0 : 2}
                            value={l.amount}
                            over={over}
                            ariaLabel={`Nilai dipotong baris ${i + 1}`}
                            onChange={(x) => setLine(l.key, { amount: x })}
                          />
                          {c && v && <span className="fulltag">maks. {money(room)}</span>}
                        </>
                      ) : (
                        <span className="mny">{money(Number(l.amount))}</span>
                      )}
                    </td>
                    {editing && (
                      <td>
                        <button
                          type="button"
                          className="iact del"
                          title="Hapus baris"
                          onClick={() => {
                            setLines((ls) => ls.filter((x) => x.key !== l.key));
                            changed();
                          }}
                        >
                          <Icon name="trash" size={14} />
                        </button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {lines.length > 0 && (
        <div className="cardfoot multi">
          <div className="impact">
            <div className="ttl">Penerapan Kredit</div>
            <div className="ir tot">
              <span>Total dipotong</span>
              <b>{money(total)}</b>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  return (
    <>
      <DocumentHeader
        module="Finance"
        trail={[{ label: "Penerapan Kredit", href: BASE }]}
        icon="file"
        number={application?.applicationNo}
        placeholder="Penerapan Kredit Baru"
        status={status}
        statusLabel={{ text: CREDIT_APPLICATION_STATUS_TEXT[status], tone: CREDIT_APPLICATION_STATUS_BADGE[status] }}
        editing={mode === "edit"}
        dirty={editing && dirty}
      >
        {editing ? (
          <>
            <CancelButton href={application ? `${BASE}/${application.id}` : BASE} dirty={dirty} disabled={saving} />
            <SaveButtons saving={saving} onSave={onSave} next={next} />
          </>
        ) : (
          <CreditApplicationActions id={application!.id} subject={application!.applicationNo} status={status} can={can} />
        )}
      </DocumentHeader>

      <div className="fgrid solo">
        <div>
          <div className="card">
            <FormBody>
              <FormSection title="Penerapan Kredit">
                <FormRow>
                  <Field label="Customer" span={6} required={mode === "new"} locked={mode === "edit"} help={mode === "new" ? "yang punya kredit terbuka" : undefined} error={errors.customer_id}>
                    {mode === "new" ? (
                      <Combobox
                        value={picked?.id ?? null}
                        options={parties.map((c) => ({ id: c.id, label: c.customerLabel, name: `${c.customerName} · ${c.currency}`, active: true }))}
                        placeholder="Pilih Customer…"
                        emptyText="Belum ada customer dengan kredit terbuka."
                        invalid={Boolean(errors.customer_id)}
                        onChange={(id) => {
                          const c = options.credits.find((x) => x.id === id);
                          setHeader((h) => ({ ...h, customer_id: c?.customerId ?? null, currency_id: c?.currencyId ?? null }));
                          setLines([]);
                          changed();
                        }}
                      />
                    ) : (
                      ro(
                        <>
                          <span className="lab">{application!.customerLabel}</span>
                          <span>{application!.customerName}</span>
                        </>
                      )
                    )}
                  </Field>
                  <Field label="Currency" span={3}>
                    {header.currency_id ? ro(<span className="mono">{currency}</span>) : <div className="ro nil">menunggu Customer</div>}
                  </Field>
                  <Field label="Tanggal" span={3} required={editing} error={errors.application_date}>
                    {editing ? (
                      <DateInput
                        value={header.application_date}
                        invalid={Boolean(errors.application_date)}
                        onChange={(v) => {
                          setHeader((h) => ({ ...h, application_date: v }));
                          changed();
                        }}
                      />
                    ) : (
                      ro(formatDate(header.application_date))
                    )}
                  </Field>
                  <Field label="Catatan" span={12}>
                    {editing ? (
                      <textarea
                        className="ta"
                        rows={2}
                        value={header.note}
                        placeholder="Catatan…"
                        onChange={(e) => {
                          setHeader((h) => ({ ...h, note: e.target.value }));
                          changed();
                        }}
                      />
                    ) : header.note ? (
                      <div className="ro multi">{header.note}</div>
                    ) : (
                      <div className="ro multi nil opt">tidak diisi</div>
                    )}
                  </Field>
                </FormRow>
              </FormSection>
              <JournalReference id={application?.journalId} no={application?.journalNo} />
              {application?.cancelReason && (
                <p className="fnote">
                  <b>Dibatalkan:</b> {application.cancelReason}
                </p>
              )}
            </FormBody>
          </div>
          <FormTabs
            tabs={[{ key: "lines", label: "Kredit yang Dipotong", icon: "file", count: lines.length, bad: tabHasError(errors, "_lines", "lines."), content: linesCard }]}
          />
        </div>
      </div>
    </>
  );
}
