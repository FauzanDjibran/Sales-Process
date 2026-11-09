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
            <Field label="Tanggal Bayar" span={4} required={editing} error={errors.tx_date}>
              {editing ? (
                <DateInput value={h.tx_date} invalid={Boolean(errors.tx_date)} onChange={(v) => set("tx_date", v)} />
              ) : (
                ro(formatDate(h.tx_date))
              )}
            </Field>
            <Field label="Referensi Bank" span={8} help={editing ? "nomor di mutasi rekening" : undefined}>
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
          <table className="grid ltab" style={{ minWidth: editing ? 680 : 560 }}>
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
                // The PPN the money typed books; only an advance bill books PPN here (P243).
                const split = b.kind === "fin_ap_advance" && s.ppn > 0 && (
                  <span className="fulltag">
                    PPN {money(s.ppn)}
                  </span>
                );
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
                          {split}
                        </>
                      ) : (
                        <>
                          <span className="mny">{money(s.cash)}</span>
                          {split}
                        </>
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
          </table>
        </div>
      )}
      {shown.length > 0 && (
        // What this payment moves (P243), as an Invoice states its total: the money paid on the bills,
        // the bank charge typed under it, and what leaves the bank.
        <div className="cardfoot">
          <div className="impact">
            <div className="ttl">Pengeluaran</div>
            <div className="ir">
              <span>Total dibayar untuk tagihan</span>
              <b>{money(received)}</b>
            </div>
            <div className="ir">
              <span>Biaya bank (ditanggung perusahaan)</span>
              {editing ? (
                <span style={{ width: 160 }}>
                  <MoneyInput
                    size="sm"
                    value={h.bank_charge}
                    invalid={Boolean(errors.bank_charge)}
                    ariaLabel="Biaya Bank"
                    onChange={(v) => set("bank_charge", v)}
                  />
                </span>
              ) : (
                <b>+{money(charge)}</b>
              )}
            </div>
            {errors.bank_charge && <p className="fnote">{errors.bank_charge}</p>}
            <div className="ir tot">
              <span>Dana keluar dari bank</span>
              <b>{money(intoBank)}</b>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  // ============================================== Dampak Transaksi card
  // What posting does to the Kas & Bank (P243): its balance now, the money going out, and its balance after.
  // Only before posting: a posted document is already in the balance.
  const afterPost = cashBank ? cashBank.balance - intoBank : 0;
  const impactCard = shown.length > 0 && status === "Draft" && cashBank && (
    <div className="card" style={{ marginTop: 14 }}>
      <div className="card-h" style={{ borderBottom: 0 }}>
        <span className="ci">
          <Icon name="send" size={15} />
        </span>
        <div className="ct">
          <h3>
            Dampak Transaksi (Pengeluaran): <span className="lab">{cashBank.label}</span>
          </h3>
          <p>{cashBank.name}</p>
          <p>(1 entri Buku Kas & Bank)</p>
        </div>
        <span className="txsum">
          <span>
            <i>Saldo Saat Ini</i>
            <b>{money(cashBank.balance)}</b>
          </span>
          <span>
            <i>Dana Keluar dari Bank</i>
            <b>{money(intoBank)}</b>
          </span>
          <span className={afterPost < 0 ? "k neg" : "k"}>
            <i>{afterPost < 0 ? "Kekurangan" : "Saldo Setelah Posting"}</i>
            <b>{money(Math.abs(afterPost))}</b>
          </span>
        </span>
      </div>
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
          {impactCard}
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

