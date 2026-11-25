"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icon";
import { CancelButton } from "@/components/ui/cancel-button";
import { Combobox } from "@/components/ui/combobox";
import { DateInput } from "@/components/ui/date-input";
import { DocumentHeader } from "@/components/ui/document-header";
import { JournalReference } from "@/components/ui/journal-reference";
import { Field, FormBody, FormRow, FormSection } from "@/components/ui/form";
import { MoneyInput } from "@/components/ui/money-input";
import { useToast } from "@/components/ui/toast";
import { CreditNoteActions } from "@/components/finance/credit-note-actions";
import { createCreditNoteAction, updateCreditNoteAction } from "@/app/actions/ar-credit-note";
import {
  CREDIT_NOTE_STATUS_BADGE,
  CREDIT_NOTE_STATUS_TEXT,
  creditLine,
  type CreditNoteAbilities,
} from "@/lib/erp/ar-credit-note-workflow";
import type { CnSource, CnSourceLine, CreditNoteHeaderInput, CreditNoteView } from "@/lib/erp/ar-credit-note";
import { taxScale } from "@/lib/erp/sales-tax";
import { formatDate, formatMoney, formatNumber, todayIso } from "@/lib/format";
import { FormTabs, tabHasError } from "@/components/ui/form-tabs";
import { SaveButtons, firstStep, withStep } from "@/components/ui/save-buttons";
import { CREDIT_NOTE_TRANSITIONS, availableCreditNoteActions } from "@/lib/erp/ar-credit-note-workflow";

/**
 * A Credit Note Penjualan in all three modes (P292, `Sales-Return-Plan.md` §6).
 *
 * It credits one posted Invoice Penjualan, chosen once and locked, for goods
 * that came back after it was billed. Each line is a quantity of an Invoice
 * line, starting on all that came back and is not yet credited; its figures are
 * the Invoice line's own by cumulative share, so the preview is what Posting
 * stores. Posting itself is the Credit Note's page.
 */

export type CreditNoteMode = "new" | "edit" | "view";

type LineState = { invoice_line_id: number; qty: string };

const qtyText = (n: number) => formatNumber(n, n % 1 ? 2 : 0);
const roomOf = (l: CnSourceLine) => Math.max(0, Math.round((l.returnedAfter - l.held) * 10_000) / 10_000);
const startLines = (inv: CnSource | undefined): LineState[] =>
  (inv?.lines ?? []).filter((l) => roomOf(l) > 0).map((l) => ({ invoice_line_id: l.id, qty: String(roomOf(l)) }));

export function CreditNoteForm({
  mode,
  note,
  invoices,
  can,
}: {
  mode: CreditNoteMode;
  note: CreditNoteView | null;
  invoices: CnSource[];
  can: CreditNoteAbilities;
}) {
  const router = useRouter();
  const toast = useToast();
  const editing = mode !== "view";

  const [header, setHeader] = useState<CreditNoteHeaderInput>(() =>
    note ? { ...note.header } : { invoice_id: null, credit_date: todayIso(), customer_return_no: "", note: "" }
  );
  const [lines, setLines] = useState<LineState[]>(() =>
    note ? note.lines.map((l) => ({ invoice_line_id: Number(l.invoice_line_id), qty: String(l.qty) })) : []
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  const invoice = invoices.find((i) => i.id === header.invoice_id);
  const byId = useMemo(() => new Map((invoice?.lines ?? []).map((l) => [l.id, l])), [invoice]);
  const currency = invoice?.currency ?? "IDR";
  const money = (n: number) => formatMoney(n, currency);
  const scale = taxScale(currency);

  const touch = (...names: string[]) => {
    setDirty(true);
    setErrors((e) => {
      const next = { ...e };
      for (const n of names) delete next[n];
      return next;
    });
  };
  const set = <K extends keyof CreditNoteHeaderInput>(k: K, v: CreditNoteHeaderInput[K]) => {
    setHeader((x) => ({ ...x, [k]: v }));
    touch(k);
  };

  /** Each line's figures: stored once posted, else the share Posting would take now. */
  const figures = lines.map((l, i) => {
    const inv = byId.get(l.invoice_line_id);
    if (!editing && note?.lineAmounts[i]) return note.lineAmounts[i];
    const qty = Number(String(l.qty).replace(",", ".")) || 0;
    if (!inv || !(qty > 0) || qty > roomOf(inv) + 1e-9) return { dpp: 0, ppn: 0 };
    const f = creditLine(inv, inv.before, qty, scale);
    return { dpp: f.dpp, ppn: f.ppn };
  });
  const dpp = editing ? figures.reduce((a, f) => a + f.dpp, 0) : (note?.dpp ?? 0);
  const ppn = editing ? figures.reduce((a, f) => a + f.ppn, 0) : (note?.ppn ?? 0);

  // Every editable document is a Draft, so its next step is the Draft's (P309).
  const next = firstStep(availableCreditNoteActions("Draft", can), CREDIT_NOTE_TRANSITIONS);

  async function onSave(step?: string) {
    setSaving(true);
    const payload = lines.map((l) => ({ invoice_line_id: l.invoice_line_id, qty: l.qty }));
    const result = mode === "edit" ? await updateCreditNoteAction(note!.id, header, payload) : await createCreditNoteAction(header, payload);
    setSaving(false);
    if (!result.ok) {
      setErrors(result.errors);
      toast(
        result.errors._form ? "Tidak diizinkan" : "Belum bisa disimpan",
        result.errors._form ?? result.errors._lines ?? Object.values(result.errors)[0] ?? "Periksa kembali isian.",
        "err"
      );
      return;
    }
    setDirty(false);
    toast("Credit Note disimpan", `${result.creditNo} · Draft`, "ok");
    router.push(withStep(`/finance/invoice/credit-note/${result.id}`, step));
  }

  const status = note?.status ?? "Draft";
  const backHref = note ? `/finance/invoice/credit-note/${note.id}` : "/finance/invoice/credit-note";
  const ro = (node: React.ReactNode) => <div className="ro">{node}</div>;
  const nil = (t?: string) => <div className={`ro nil${t || editing ? "" : " opt"}`}>{t ?? "tidak diisi"}</div>;

  const headerCard = (
    <div className="card">
      <FormBody>
        <FormSection title="Invoice">
          <FormRow>
            <Field
              label="Invoice Penjualan"
              span={4}
              required={mode === "new"}
              locked={mode === "edit"}
              help={mode === "new" ? "yang barangnya kembali setelah ditagih" : undefined}
              error={errors.invoice_id}
            >
              {mode === "new" ? (
                <Combobox
                  value={header.invoice_id}
                  options={invoices.map((i) => ({ id: i.id, label: i.invoiceNo, name: i.customerName, active: true }))}
                  placeholder="Pilih Invoice Penjualan…"
                  emptyText="Belum ada Invoice yang barangnya diretur setelah ditagih."
                  invalid={Boolean(errors.invoice_id)}
                  onChange={(id) => {
                    set("invoice_id", id);
                    setLines(startLines(invoices.find((i) => i.id === id)));
                    touch("_lines");
                  }}
                />
              ) : invoice ? (
                ro(
                  <Link className="drl" href={`/finance/invoice/sales/${invoice.id}`}>
                    <span className="mono">{invoice.invoiceNo}</span>
                  </Link>
                )
              ) : (
                nil()
              )}
            </Field>
            <Field label="Customer" span={5}>
              {invoice ? (
                ro(
                  <>
                    <span className="lab">{invoice.customerLabel}</span>
                    <span>{invoice.customerName}</span>
                  </>
                )
              ) : (
                nil("menunggu Invoice")
              )}
            </Field>
            <Field label="Customer Order" span={3}>
              {invoice ? (
                ro(
                  <Link className="drl" href={`/sales/customer-order/${invoice.customerOrderId}`}>
                    <span className="mono">{invoice.customerOrderNo}</span>
                  </Link>
                )
              ) : (
                nil("menunggu Invoice")
              )}
            </Field>
          </FormRow>
        </FormSection>
        <FormSection title="Credit Note">
          <FormRow>
            <Field label="Tanggal" span={3} required={editing} help={editing ? "periode retur" : undefined} error={errors.credit_date}>
              {editing ? (
                <DateInput value={header.credit_date} invalid={Boolean(errors.credit_date)} onChange={(v) => set("credit_date", v)} />
              ) : (
                ro(formatDate(header.credit_date))
              )}
            </Field>
            <Field label="No. Nota Retur Customer" span={4} help={editing ? "dari pembeli PKP, jika sudah ada" : undefined}>
              {editing ? (
                <input
                  className="inp idf"
                  value={header.customer_return_no}
                  placeholder="Nomor Nota Retur…"
                  autoComplete="off"
                  onChange={(e) => set("customer_return_no", e.target.value)}
                />
              ) : header.customer_return_no ? (
                ro(<span className="mono">{header.customer_return_no}</span>)
              ) : (
                nil()
              )}
            </Field>
            <Field label="Catatan" span={12}>
              {editing ? (
                <textarea className="ta" rows={2} value={header.note} placeholder="Catatan…" onChange={(e) => set("note", e.target.value)} />
              ) : header.note ? (
                <div className="ro multi">{header.note}</div>
              ) : (
                <div className="ro multi nil opt">tidak diisi</div>
              )}
            </Field>
          </FormRow>
        </FormSection>
        <JournalReference id={note?.journalId} no={note?.journalNo} />
        {note?.cancelReason && (
          <p className="fnote">
            <b>Dibatalkan:</b> {note.cancelReason}
          </p>
        )}
      </FormBody>
    </div>
  );

  const linesCard = (
    <div className="card">
      <div className="card-h">
        <span className="ci">
          <Icon name="box" size={15} />
        </span>
        <div className="ct">
          <h3>Barang Dikredit</h3>
          <p>
            {editing
              ? "Setiap baris Invoice yang barangnya kembali setelah ditagih, terisi seluruh sisanya. Kurangi Qty atau hapus baris yang tidak dikredit."
              : "DPP dan PPN adalah bagian baris Invoice untuk Qty yang dikredit."}
          </p>
        </div>
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
            <Icon name="box" size={18} />
          </div>
          <h4>{invoice ? "Tidak ada baris" : "Pilih Invoice dulu…"}</h4>
          <p>Barang yang dapat dikredit mengikuti Receipt Note retur yang sudah diposting atas barang yang sudah ditagih.</p>
        </div>
      ) : (
        <div className="tw">
          <table className="grid ltab" style={{ minWidth: 820 }}>
            <thead>
              <tr>
                <th style={{ width: 40 }}>No</th>
                <th style={{ width: 170 }}>Delivery Note</th>
                <th>Barang</th>
                <th style={{ width: editing ? 210 : 130 }}>Qty</th>
                <th className="num" style={{ width: 140 }}>DPP</th>
                <th className="num" style={{ width: 120 }}>PPN</th>
                {editing && <th style={{ width: 40 }} />}
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => {
                const inv = byId.get(l.invoice_line_id);
                const room = inv ? roomOf(inv) : 0;
                const over = (Number(l.qty) || 0) > room + 1e-9;
                const lineError = errors[`lines.${i}.qty`] ?? errors[`lines.${i}.invoice_line_id`];
                return (
                  <tr key={l.invoice_line_id} className={lineError || (editing && over) ? "overrow" : undefined}>
                    <td className="no">{i + 1}</td>
                    <td>
                      {inv && (
                        <Link className="drl" href={`/inventory/delivery-note/${inv.dnId}`}>
                          <span className="mono">{inv.dnNo}</span>
                        </Link>
                      )}
                    </td>
                    <td>
                      <span className="idc">
                        <span className="lab">{inv?.itemLabel}</span>
                        <span className="nm">{inv?.itemName}</span>
                      </span>
                      {lineError && <span className="overtag">{lineError}</span>}
                    </td>
                    <td>
                      {editing ? (
                        <>
                          <div className="qcell">
                            <MoneyInput
                              size="sm"
                              decimals={4}
                              value={l.qty}
                              over={over}
                              ariaLabel={`Qty ${inv?.itemLabel ?? ""}`}
                              onChange={(v) => {
                                setLines((ls) => ls.map((x) => (x.invoice_line_id === l.invoice_line_id ? { ...x, qty: v } : x)));
                                touch(`lines.${i}.qty`, "_lines");
                              }}
                            />
                            <span className="qu">{inv?.uomLabel}</span>
                          </div>
                          {inv && (
                            <span className="fulltag">
                              maks. {qtyText(room)} {inv.uomLabel}
                            </span>
                          )}
                        </>
                      ) : (
                        <span className="qview">
                          <span className="mny">{qtyText(Number(l.qty))}</span>
                          <span className="lab">{inv?.uomLabel}</span>
                        </span>
                      )}
                    </td>
                    <td className="num mny">{money(figures[i].dpp)}</td>
                    <td className="num mny">{money(figures[i].ppn)}</td>
                    {editing && (
                      <td>
                        <button
                          className="iact del"
                          title="Hapus baris"
                          onClick={() => {
                            setLines((ls) => ls.filter((x) => x.invoice_line_id !== l.invoice_line_id));
                            touch("_lines");
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
      {invoice && lines.length > 0 && (
        <div className="cardfoot multi">
          {status === "Posted" && note && (
            <div className="impact">
              <div className="ttl">Kredit Customer</div>
              <div className="ir">
                <span>Sudah dipakai atau dikembalikan</span>
                <b>{money(note.total - note.openCredit)}</b>
              </div>
              <div className="ir tot">
                <span>Kredit terbuka</span>
                <b>{money(note.openCredit)}</b>
              </div>
            </div>
          )}
          <div className="impact">
            <div className="ttl">Nilai Credit Note</div>
            <div className="ir">
              <span>DPP dikredit</span>
              <b>{money(dpp)}</b>
            </div>
            {invoice.isTaxable && (
              <div className="ir">
                <span>PPN Keluaran dikurangi</span>
                <b>{money(ppn)}</b>
              </div>
            )}
            <div className="ir tot">
              <span>Total</span>
              <b>{money(dpp + ppn)}</b>
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
        trail={[{ label: "Credit Note Penjualan", href: "/finance/invoice/credit-note" }]}
        icon="file"
        number={note?.creditNo}
        placeholder="Credit Note Baru"
        status={status}
        statusLabel={{ text: CREDIT_NOTE_STATUS_TEXT[status], tone: CREDIT_NOTE_STATUS_BADGE[status] }}
        editing={mode === "edit"}
        dirty={editing && dirty}
      >
        {editing ? (
          <>
            <CancelButton href={backHref} dirty={dirty} disabled={saving} />
            <SaveButtons saving={saving} onSave={onSave} next={next} />
          </>
        ) : (
          <CreditNoteActions id={note!.id} subject={note!.creditNo} status={status} can={can} />
        )}
      </DocumentHeader>

      <div className="fgrid solo">
        <div>
          {headerCard}
          <FormTabs
            tabs={[
              { key: "lines", label: "Barang Dikredit", icon: "box", count: lines.length, bad: tabHasError(errors, "_lines", "lines.", "line."), content: linesCard },
            ]}
          />
        </div>
      </div>
    </>
  );
}
