"use client";

import { Fragment, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icon";
import { CancelButton } from "@/components/ui/cancel-button";
import { Combobox } from "@/components/ui/combobox";
import { DateInput } from "@/components/ui/date-input";
import { Field, FormBody, FormRow, FormSection } from "@/components/ui/form";
import { MoneyInput } from "@/components/ui/money-input";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { CashPaymentActions } from "@/components/finance/cash-payment-actions";
import { PaymentBillPicker, type PickedPayment } from "@/components/finance/cash-payment-bill-picker";
import { createCashPaymentAction, updateCashPaymentAction } from "@/app/actions/cash-payment";
import { cashToClear, settleBillFromCash, type SettlementLine } from "@/lib/erp/sales-tax";
import { PAID_DOC_ROUTE, PAID_DOC_TEXT, paidKey, cashBankPurpose } from "@/lib/erp/cash-bank-purposes";
import {
  CASH_BANK_TX_STATUS_BADGE,
  CASH_BANK_TX_STATUS_TEXT,
  type CashPaymentAbilities,
} from "@/lib/erp/cash-bank-tx-workflow";
import type { CashPaymentOptions, CashPaymentView, OpenPayable } from "@/lib/erp/cash-payment";
import { formatDate, formatMoney, formatPct, todayIso } from "@/lib/format";

/**
 * Pengeluaran Kas & Bank (P127, B24–B25), in all three modes — the receipt's
 * form (`cash-receipt-form.tsx`) mirrored. Tujuan, then Supplier, decide what
 * can be paid; *Pilih Tagihan* opens the supplier's open bills. **Each line
 * takes the cash paid** for its bill; the PPh the company withholds explains
 * the gap. What leaves the bank is what the lines paid plus the bank charge.
 */

export type CashPaymentMode = "new" | "edit" | "view";

type Line = PickedPayment;

type Header = {
  purpose: string;
  tx_date: string;
  partner_id: number | null;
  cash_bank_id: number | null;
  bank_ref: string;
  note: string;
  bank_charge: string;
};

type LiveLine = { bill: OpenPayable; input: Line; withhold: boolean; max: number; line: SettlementLine };

const money = (n: number) => formatMoney(n, "IDR");

/** Where a settled document opens. */
const billHref = (b: OpenPayable) => `${PAID_DOC_ROUTE[b.kind]}/${b.id}`;

export function CashPaymentForm({
  mode,
  payment,
  options,
  can,
}: {
  mode: CashPaymentMode;
  payment: CashPaymentView | null;
  options: CashPaymentOptions;
  can: CashPaymentAbilities;
}) {
  const router = useRouter();
  const toast = useToast();
  const editing = mode !== "view";

  const [h, setH] = useState<Header>(() => {
    if (payment) {
      const i = payment.input;
      return {
        purpose: i.purpose,
        tx_date: i.tx_date,
        partner_id: Number(i.partner_id),
        cash_bank_id: Number(i.cash_bank_id),
        bank_ref: i.bank_ref,
        note: i.note,
        bank_charge: i.bank_charge ? String(i.bank_charge) : "",
      };
    }
    const purposes = options.purposes;
    const banks = options.cashBanks.filter((b) => b.active);
    return {
      purpose: purposes.length === 1 ? purposes[0].key : "",
      tx_date: todayIso(),
      partner_id: null,
      cash_bank_id: banks.length === 1 ? banks[0].id : null,
      bank_ref: "",
      note: "",
      bank_charge: "",
    };
  });
  const [picked, setPicked] = useState<Line[]>(() =>
    (payment?.input.lines ?? []).map((l) => {
      const kind = l.doc_type;
      return { key: paidKey(kind, Number(l.doc_id)), kind, docId: Number(l.doc_id), cash: String(l.cash), withhold: l.withhold };
    })
  );
  const [pickerOpen, setPickerOpen] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  const purpose = cashBankPurpose(h.purpose);
  const touch = (...names: string[]) => {
    setDirty(true);
    setErrors((e) => {
      const next = { ...e };
      for (const n of names) delete next[n];
      return next;
    });
  };
  const set = <K extends keyof Header>(k: K, v: Header[K]) => {
    setH((x) => ({ ...x, [k]: v }));
    touch(k);
  };

  // ---- what may be settled: the purpose's documents, owed by the partner
  const partnerBills = useMemo(
    // Already oldest due first (the server sorts), advance bills and Invoices together.
    () => (purpose && h.partner_id ? options.bills.filter((b) => b.supplierId === h.partner_id && purpose.settles.includes(b.kind)) : []),
    [options.bills, purpose, h.partner_id]
  );
  const billByKey = useMemo(() => new Map(options.bills.map((b) => [b.key, b])), [options.bills]);
  const canWithhold = Boolean(purpose?.withholding);

  // ---- every line's figures, exactly as the Server Action will store them
  const lines = useMemo(() => {
    const out: LiveLine[] = [];
    for (const l of picked) {
      const bill = billByKey.get(l.key);
      if (!bill) continue;
      const withhold = canWithhold ? l.withhold : false;
      out.push({
        bill,
        input: l,
        withhold,
        max: cashToClear(bill, bill.paid, withhold),
        line: settleBillFromCash({ bill, before: bill.paid, cash: Number(l.cash) || 0, withhold }),
      });
    }
    return out;
  }, [picked, billByKey, canWithhold]);
  const charge = Number(h.bank_charge) || 0;

  const setLine = (key: string, patch: Partial<Line>) => {
    setPicked((x) => x.map((l) => (l.key === key ? { ...l, ...patch } : l)));
    touch("_lines", `lines.${key}`);
  };
  const removeLine = (key: string) => {
    setPicked((x) => x.filter((l) => l.key !== key));
    touch("_lines", `lines.${key}`);
  };
  const applyPicked = (next: Line[]) => {
    setPicked(next);
    setPickerOpen(false);
    touch("_lines", ...next.map((l) => `lines.${l.key}`));
  };

  async function onSave() {
    setSaving(true);
    const input = {
      ...h,
      bank_charge: charge,
      lines: lines.map((l) => ({ doc_type: l.bill.kind, doc_id: l.bill.id, cash: Number(l.input.cash) || 0, withhold: l.withhold })),
    };
    const result =
      mode === "edit" ? await updateCashPaymentAction(payment!.id, input) : await createCashPaymentAction(input);
    setSaving(false);
    if (!result.ok) {
      // Line errors come back by position; the table shows them by bill.
      const mapped: Record<string, string> = {};
      for (const [k, v] of Object.entries(result.errors)) {
        const m = /^lines\.(\d+)\.(\w+)$/.exec(k);
        if (m) mapped[`lines.${lines[Number(m[1])]?.bill.key}`] = v;
        else mapped[k] = v;
      }
      setErrors(mapped);
      toast(
        result.errors._form ? "Tidak diizinkan" : "Belum bisa disimpan",
        result.errors._form ?? result.errors._lines ?? "Periksa kembali isian.",
        "err"
      );
      return;
    }
    setDirty(false);
    toast("Pengeluaran disimpan", `${result.txNo} · Draft`, "ok");
    router.push(`/finance/cash-bank/payment/${result.id}`);
  }

  const status = payment?.status ?? "Draft";
  const backHref = payment ? `/finance/cash-bank/payment/${payment.id}` : "/finance/cash-bank/payment";
  const ro = (node: React.ReactNode) => <div className="ro">{node}</div>;
  const nil = (text = "tidak diisi") => <div className="ro nil">{text}</div>;
  const partners = options.partners.filter((p) => !purpose || p.category === purpose.partnerCategory);
  const partner = options.partners.find((p) => p.id === h.partner_id) ?? null;
  const cashBank = options.cashBanks.find((c) => c.id === h.cash_bank_id) ?? null;
  const whtLabel = (key: string) => options.withholdingLabels[key] ?? "PPh";

  // The live figures while editing, the stored ones in view mode.
  const shown = editing
    ? lines.map((l) => ({
        bill: l.bill,
        cash: l.line.cash,
        settled: l.line.settled,
        whts: l.line.withholdings,
        pph: l.line.pph,
        dpp: l.line.dppPart,
        ppn: l.line.ppnPart,
      }))
    : (payment?.lines ?? []).flatMap((l) => {
        const bill = billByKey.get(paidKey(l.kind, l.docId));
        return bill
          ? [{ bill, cash: l.settled - l.pph, settled: l.settled, whts: l.withholdings, pph: l.pph, dpp: l.dppPart, ppn: l.ppnPart }]
          : [];
      });
  const received = shown.reduce((a, l) => a + l.cash, 0);
  const settled = shown.reduce((a, l) => a + l.settled, 0);
  const pph = shown.reduce((a, l) => a + l.pph, 0);
  const intoBank = received + charge;

  // ======================================================= header card
  const headerCard = (
    <div className="card">
      <FormBody>
        <FormSection title="Pengeluaran">
          <FormRow>
            <Field
              label="Tujuan"
              span={4}
              required={mode === "new"}
              locked={mode === "edit"}
              help={mode === "new" ? "menentukan dokumen yang dapat dilunasi" : undefined}
              error={errors.purpose}
            >
              {mode === "new" ? (
                <Select
                  value={h.purpose}
                  options={options.purposes.map((p) => ({ value: p.key, label: p.name }))}
                  placeholder="Pilih Tujuan…"
                  invalid={Boolean(errors.purpose)}
                  onChange={(v) => {
                    setH((x) => ({ ...x, purpose: v, partner_id: null }));
                    setPicked([]);
                    touch("purpose", "partner_id");
                  }}
                />
              ) : (
                ro(<span>{purpose?.name ?? h.purpose}</span>)
              )}
            </Field>
            <Field
              label={purpose?.partnerCategory ?? "Partner"}
              span={4}
              required={editing}
              help={editing && purpose ? "hanya tagihan milik partner ini" : undefined}
              error={errors.partner_id}
            >
              {editing ? (
                <Combobox
                  value={h.partner_id}
                  options={partners}
                  placeholder={`Pilih ${purpose?.partnerCategory ?? "Partner"}…`}
                  waitingFor={purpose ? null : "Pilih Tujuan dulu…"}
                  invalid={Boolean(errors.partner_id)}
                  onChange={(v) => {
                    setH((x) => ({ ...x, partner_id: v }));
                    setPicked([]);
                    touch("partner_id", "_lines");
                  }}
                />
              ) : (
                ro(
                  <>
                    <span className="lab">{payment?.partnerLabel}</span>
                    <span>{payment?.partnerName}</span>
                  </>
                )
              )}
            </Field>
            <Field label="Kas & Bank" span={4} required={editing} help={editing ? "sumber dana yang dibayarkan" : undefined} error={errors.cash_bank_id}>
              {editing ? (
                <Combobox
                  value={h.cash_bank_id}
                  options={options.cashBanks}
                  placeholder="Pilih Kas & Bank…"
                  invalid={Boolean(errors.cash_bank_id)}
                  onChange={(v) => set("cash_bank_id", v)}
                />
              ) : (
                ro(
                  <>
                    <span className="lab">{payment?.cashBankLabel}</span>
                    <span>{payment?.cashBankName}</span>
                  </>
                )
              )}
            </Field>
            <Field label="Tanggal Bayar" span={3} required={editing} error={errors.tx_date}>
              {editing ? (
                <DateInput value={h.tx_date} invalid={Boolean(errors.tx_date)} onChange={(v) => set("tx_date", v)} />
              ) : (
                ro(formatDate(h.tx_date))
              )}
            </Field>
            <Field label="Referensi Bank" span={3} help={editing ? "nomor di mutasi rekening" : undefined}>
              {editing ? (
                <input
                  className="inp idf"
                  value={h.bank_ref}
                  placeholder="mis. TRF 0930-551203"
                  autoComplete="off"
                  onChange={(e) => set("bank_ref", e.target.value)}
                />
              ) : h.bank_ref ? (
                ro(<span className="mono">{h.bank_ref}</span>)
              ) : (
                nil()
              )}
            </Field>
            <Field label="Biaya Bank" span={3} help={editing ? "ditanggung perusahaan" : undefined} error={errors.bank_charge}>
              {editing ? (
                <MoneyInput
                  value={h.bank_charge}
                  currencyLabel="IDR"
                  invalid={Boolean(errors.bank_charge)}
                  ariaLabel="Biaya Bank"
                  onChange={(v) => set("bank_charge", v)}
                />
              ) : charge ? (
                ro(<span className="mny">{money(charge)}</span>)
              ) : (
                nil("tidak ada")
              )}
            </Field>
            <Field label="Dana Keluar dari Bank" span={3} help={editing ? "dibayar + biaya bank" : undefined}>
              {ro(<span className="mny">{money(Math.max(0, intoBank))}</span>)}
            </Field>
            <Field label="Catatan" span={12}>
              {editing ? (
                <textarea
                  className="ta"
                  rows={2}
                  value={h.note}
                  placeholder="Catatan internal…"
                  onChange={(e) => set("note", e.target.value)}
                />
              ) : h.note ? (
                <div className="ro multi">{h.note}</div>
              ) : (
                <div className="ro multi nil">tidak diisi</div>
              )}
            </Field>
            {!editing && payment?.journal && (
              <Field label="Referensi" span={12}>
                {ro(
                  <>
                    <span className="rx">Journal</span>
                    <Link className="drl" href={`/accounting/journal/${payment.journal.id}`}>
                      <span className="mono">{payment.journal.journalNo}</span>
                    </Link>
                  </>
                )}
              </Field>
            )}
          </FormRow>
        </FormSection>
        {payment?.status === "Cancelled" && payment.cancelReason && (
          <p className="fnote">
            <b>Dibatalkan:</b> {payment.cancelReason}
          </p>
        )}
        {!editing && payment?.status !== "Cancelled" && (
          <p className="fnote">
            {payment?.status === "Draft"
              ? "Pengeluaran masih Draft — belum membentuk journal, belum keluar dari Buku Kas & Bank, dan belum mengurangi tagihan."
              : "Diposting: dana keluar tercatat di Buku Kas & Bank. Untuk uang muka, journal membukukan Uang Muka Pembelian dan PPN Masukan; untuk invoice, hutang usaha berkurang. PPh yang dipotong dicatat sebagai Hutang PPh."}
          </p>
        )}
      </FormBody>
    </div>
  );

  // ======================================================== lines card
  const waiting = !purpose ? "Pilih Tujuan dulu…" : !h.partner_id ? `Pilih ${purpose.partnerCategory} dulu…` : null;
  const noun = purpose?.docNoun ?? "Tagihan";

  const linesCard = (
    <div className="card" style={{ marginTop: 14 }}>
      <div className="card-h">
        <span className="ci">
          <Icon name="wallet" size={15} />
        </span>
        <div className="ct">
          <h3>{`${noun} yang Dibayar`}</h3>
          <p>
            {editing
              ? "Isi dana yang dibayarkan untuk setiap tagihan. Kekurangannya dihitung sebagai PPh yang kita potong bila PPh dipotong; sisanya tetap terbuka."
              : "Tagihan yang diselesaikan pengeluaran ini."}
          </p>
        </div>
        {editing && !waiting && (
          <div className="ph-act" style={{ marginLeft: "auto" }}>
            <button type="button" className="btn sm" onClick={() => setPickerOpen(true)} disabled={!partnerBills.length}>
              <Icon name="plus" size={13} /> Pilih {noun}
            </button>
          </div>
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
      {editing && waiting ? (
        <div className="empty sm">
          <div className="ic">
            <Icon name="wallet" size={18} />
          </div>
          <h4>{waiting}</h4>
          <p>Tagihan yang dibayar dipilih setelah Tujuan dan Partner diisi.</p>
        </div>
      ) : shown.length === 0 ? (
        <div className="empty sm">
          <div className="ic">
            <Icon name="wallet" size={18} />
          </div>
          {partnerBills.length ? (
            <>
              <h4>Belum ada {noun.toLowerCase()} dipilih</h4>
              <p>
                {partner?.name ?? "Partner ini"} memiliki {partnerBills.length} {noun.toLowerCase()} terbuka. Tekan <b>Pilih {noun}</b>{" "}
                untuk memilih yang dibayar.
              </p>
            </>
          ) : (
            <>
              <h4>Tidak ada {noun.toLowerCase()} terbuka</h4>
              <p>
                {partner?.name ?? "Partner ini"} tidak memiliki {noun.toLowerCase()} yang diterbitkan dan belum lunas.
              </p>
            </>
          )}
        </div>
      ) : (
        <div className="tw">
          <table className="grid ltab" style={{ minWidth: editing ? 820 : 700 }}>
            <thead>
              <tr>
                <th style={{ minWidth: 220 }}>{noun}</th>
                {editing && (
                  <th className="num" style={{ width: 140 }}>
                    Sisa Tagihan
                  </th>
                )}
                <th className="num" style={{ width: 170 }}>
                  Dibayar
                </th>
                {canWithhold && <th style={{ width: 170 }}>PPh Dipotong</th>}
                <th className="num" style={{ width: 150 }}>
                  {editing ? "Setelah Ini" : "Dilunasi"}
                </th>
                {editing && <th style={{ width: 44 }} />}
              </tr>
            </thead>
            <tbody>
              {shown.map((s) => {
                const b = s.bill;
                const l = lines.find((x) => x.bill.key === b.key);
                const err = errors[`lines.${b.key}`];
                const hasWht = b.withholdings.some((w) => w.amount > 0);
                const typed = Number(l?.input.cash) || 0;
                const over = Boolean(l && typed > l.max);
                const left = b.open - s.settled;
                return (
                  <tr key={b.key} className={err || over ? "overrow" : undefined}>
                    <td>
                      <span className="dstack">
                        <span className="d1">
                          <span className={`bdg ${b.kind === "fin_ap_invoice" ? "t-info" : "t-vio"}`}>{PAID_DOC_TEXT[b.kind]}</span>{" "}
                          <Link className="drl" href={billHref(b)} target="_blank">
                            <span className="mono">{b.no}</span>
                          </Link>
                        </span>
                        <span className="d2">
                          {b.orderNo} · jt {formatDate(b.dueDate)}
                        </span>
                      </span>
                      {err && <span className="overtag">{err}</span>}
                    </td>
                    {editing && (
                      <td className="num">
                        <span className="mny">{money(b.open)}</span>
                      </td>
                    )}
                    <td className="num">
                      {editing && l ? (
                        <>
                          <MoneyInput
                            size="sm"
                            value={l.input.cash}
                            over={over}
                            ariaLabel={`Dibayar ${b.no}`}
                            onChange={(v) => setLine(b.key, { cash: v })}
                          />
                          {typed !== l.max && (
                            <button type="button" className="fulltag lnk" onClick={() => setLine(b.key, { cash: String(l.max) })}>
                              lunas bila {money(l.max)}
                            </button>
                          )}
                        </>
                      ) : (
                        <span className="mny">{money(s.cash)}</span>
                      )}
                    </td>
                    {canWithhold && (
                      <td>
                        {!hasWht ? (
                          <span className="dash">tidak ada PPh</span>
                        ) : editing && l ? (
                          <label className="chk sm" style={{ height: 30 }}>
                            <input
                              type="checkbox"
                              checked={l.input.withhold}
                              aria-label={`Potong PPh ${b.no}`}
                              onChange={(e) => setLine(b.key, { withhold: e.target.checked })}
                            />
                            <span>
                              <span className="ct">{!l.input.withhold ? "Tidak dipotong" : s.pph ? money(s.pph) : "Dipotong"}</span>
                            </span>
                          </label>
                        ) : s.whts.length ? (
                          <span className="dstack">
                            {s.whts.map((w) => (
                              <span key={w.key} title={`${formatPct(w.rate)} × DPP ${money(w.base)}`}>
                                <span className="lab">{whtLabel(w.key)}</span> <span className="mny">{money(w.amount)}</span>
                              </span>
                            ))}
                          </span>
                        ) : (
                          <span className="dash">tidak dipotong</span>
                        )}
                      </td>
                    )}
                    <td className="num">
                      {!editing ? (
                        <span className="mny">{money(s.settled)}</span>
                      ) : over ? (
                        <span className="bdg t-bad">Melebihi</span>
                      ) : !(s.settled > 0) ? (
                        <span className="dash">—</span>
                      ) : left <= 0 ? (
                        <span className="bdg t-ok">Lunas</span>
                      ) : (
                        <span className="dstack">
                          <span className="mny">{money(left)}</span>
                          <span className="d2">masih terbuka</span>
                        </span>
                      )}
                    </td>
                    {editing && (
                      <td>
                        <button type="button" className="iact del" title={`Hapus ${b.no}`} onClick={() => removeLine(b.key)}>
                          <Icon name="trash" size={14} />
                        </button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="totrow">
                <td colSpan={editing ? 2 : 1} style={{ textAlign: "right" }}>
                  Total Dibayar · {shown.length} {noun.toLowerCase()}
                </td>
                <td className="num">
                  <span className="mny big">{money(received)}</span>
                </td>
                {canWithhold && (
                  <td>
                    <span className="mny">{money(pph)}</span>
                  </td>
                )}
                <td className="num">{!editing && <span className="mny big">{money(settled)}</span>}</td>
                {editing && <td />}
              </tr>
            </tfoot>
          </table>
        </div>
      )}
      {editing && lines.length > 0 && <ExplainBox lines={lines} whtLabel={whtLabel} />}
      {shown.length > 0 && (
        <div className="cardfoot multi">
          <div className="impact">
            <div className="ttl">Bagian yang Dibukukan</div>
            {shown.map((x) =>
              x.bill.kind === "fin_ap_invoice" || x.bill.kind === "sal_permit_request" ? (
                // An Invoice's PPN was booked at the Invoice: what it settles clears Hutang (B27).
                // A permit cost is expensed whole, without tax (P137).
                <div className="ir" key={x.bill.key}>
                  <span>{x.bill.no} · {x.bill.kind === "fin_ap_invoice" ? "Hutang Usaha" : "Biaya Perizinan"}</span>
                  <b>{money(x.settled)}</b>
                </div>
              ) : (
                <div className="ir" key={x.bill.key}>
                  <span>
                    {x.bill.no} · DPP {money(x.dpp)} + PPN
                  </span>
                  <b>{money(x.ppn)}</b>
                </div>
              )
            )}
          </div>
          <div className="impact">
            <div className="ttl">Penyelesaian Tagihan</div>
            <div className="ir">
              <span>Dana keluar dari bank</span>
              <b>{money(intoBank)}</b>
            </div>
            {charge > 0 && (
              <div className="ir">
                <span>Biaya bank (Beban Bank)</span>
                <b>−{money(charge)}</b>
              </div>
            )}
            {whtTotals(shown.map((l) => l.whts)).map((w) => (
              <div className="ir" key={w.key}>
                <span>{whtLabel(w.key)} dipotong (Hutang PPh)</span>
                <b>{money(w.amount)}</b>
              </div>
            ))}
            <div className="ir tot">
              <span>Tagihan yang diselesaikan</span>
              <b>{money(settled)}</b>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  // ============================================================ page
  return (
    <>
      <div className="ph">
        <div className="crumb">
          <span>Finance</span>
          <span>/</span>
          <span>Kas & Bank</span>
          <span>/</span>
          <Link href="/finance/cash-bank/payment">Pengeluaran</Link>
          <span>/</span>
          <span className="cur">{payment ? payment.txNo : "Baru"}</span>
        </div>
        <div className="ph-row">
          <h1>
            <span className="ph-ico">
              <Icon name="send" size={16} />
            </span>
            {payment ? (
              <>
                <span className="docno">{payment.txNo}</span>
                <span className={`bdg ${CASH_BANK_TX_STATUS_BADGE[status]}`}>{CASH_BANK_TX_STATUS_TEXT[status]}</span>
              </>
            ) : (
              "Pengeluaran Baru"
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
              <CashPaymentActions id={payment!.id} subject={`${payment!.txNo} – ${money(intoBank)}`} status={status} can={can} />
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
      {cashBank && !cashBank.active && editing && (
        <p className="fnote">Kas & Bank {cashBank.label} sudah nonaktif — pilih yang lain sebelum menyimpan.</p>
      )}
      {pickerOpen && (
        <PaymentBillPicker
          bills={partnerBills}
          current={picked}
          noun={noun}
          partnerName={partner?.name ?? ""}
          withhold={canWithhold}
          onApply={applyPicked}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </>
  );
}

/** PPh summed per Jenis PPh across lines. */
function whtTotals(groups: { key: string; amount: number }[][]): { key: string; amount: number }[] {
  const m = new Map<string, number>();
  for (const g of groups) for (const w of g) m.set(w.key, (m.get(w.key) ?? 0) + w.amount);
  return [...m.entries()].map(([key, amount]) => ({ key, amount }));
}

/** What the gap between the open bills and the money is made of, in words (the simulation's explain box). */
function ExplainBox({ lines, whtLabel }: { lines: LiveLine[]; whtLabel: (key: string) => string }) {
  const over = lines.filter((l) => (Number(l.input.cash) || 0) > l.max);
  const partial = lines.filter((l) => l.line.settled < l.bill.open);
  const pph = lines.reduce((a, l) => a + l.line.pph, 0);
  const parts = whtTotals(lines.map((l) => l.line.withholdings))
    .map((w) => `${whtLabel(w.key)} ${formatMoney(w.amount, "IDR")}`)
    .join(", ");
  if (over.length) {
    return (
      <div className="nbox bad slim">
        <Icon name="warn" size={15} className="ni" />
        <div>
          <b>Dana melebihi yang melunasi {over.map((l) => l.bill.no).join(", ")}.</b>
          <p>Kurangi dana dibayar — kelebihan bayar tidak dicatat di pengeluaran ini.</p>
        </div>
      </div>
    );
  }
  if (partial.length) {
    const open = partial.reduce((a, l) => a + l.bill.open - l.line.settled, 0);
    return (
      <div className="nbox warn slim">
        <Icon name="warn" size={15} className="ni" />
        <div>
          <b>
            Pembayaran sebagian — {formatMoney(open, "IDR")} tetap terbuka pada {partial.map((l) => l.bill.no).join(", ")}.
          </b>
          <p>
            {parts ? `Potongan pajak dihitung sebanding dengan dana dibayar: ${parts}. ` : ""}
            Sisa yang belum dibayar tetap terbuka pada tagihan.
          </p>
        </div>
      </div>
    );
  }
  return (
    <div className="nbox slim">
      <Icon name="check" size={15} className="ni" />
      <div>
        {pph ? (
          <>
            <b>
              Selisih {formatMoney(pph, "IDR")} antara sisa tagihan dan dana dibayar adalah {parts}.
            </b>
            <p>Dihitung dari tarif setiap jenis PPh. Tagihan lunas setelah pengeluaran ini.</p>
          </>
        ) : (
          <b>Dana dibayar menutup seluruh sisa tagihan.</b>
        )}
      </div>
    </div>
  );
}
