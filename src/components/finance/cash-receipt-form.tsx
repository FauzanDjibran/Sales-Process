"use client";

import { useMemo, useState } from "react";
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
import { CashReceiptActions } from "@/components/finance/cash-receipt-actions";
import { createCashReceiptAction, updateCashReceiptAction } from "@/app/actions/cash-receipt";
import { settleBill, settlementBalance, type SettlementLine } from "@/lib/erp/sales-tax";
import { cashBankPurpose } from "@/lib/erp/cash-bank-purposes";
import {
  CASH_BANK_TX_STATUS_BADGE,
  CASH_BANK_TX_STATUS_TEXT,
  type CashReceiptAbilities,
} from "@/lib/erp/cash-bank-tx-workflow";
import type { CashReceiptOptions, CashReceiptView, OpenBill } from "@/lib/erp/cash-bank-tx";
import { formatDate, formatMoney, formatPct, todayIso } from "@/lib/format";

/**
 * Penerimaan Kas & Bank, in all three modes: `new`, `edit` (Draft only) and
 * `view` (P66–P70).
 *
 * **Tujuan, then Partner, decide what can be settled** (P67). Once both are
 * chosen, every open bill of that partner is listed in the table straight
 * away, each with a tick box — the shape Accurate and NetSuite give a receipt —
 * so settling three bills paid with one transfer is three ticks, not three
 * searches. A ticked bill starts on its full Sisa; lowering Dilunasi makes it
 * a partial payment. The PPh each bill's customer withheld follows by rule
 * (the Potong switch, P60), never typed.
 *
 * **Dana Diterima follows the ticked bills** until the user types it — the
 * common case, a customer paying in full, needs no typing at all. When the
 * bank statement says otherwise, the user types the figure and either records
 * the gap as Biaya Bank (the company absorbs it, P68) or presses **Alokasikan
 * Dana**, which spends the money on the ticked bills oldest first and leaves
 * the rest open. The document posts only when it balances:
 *
 *   Σ Dilunasi = Dana Diterima + Biaya Bank + Σ PPh.
 */

export type CashReceiptMode = "new" | "edit" | "view";

type Pick = { on: boolean; settled: string; withhold: boolean };

type Header = {
  purpose: string;
  tx_date: string;
  partner_id: number | null;
  cash_bank_id: number | null;
  bank_ref: string;
  note: string;
  cash_amount: string;
  bank_charge: string;
};

const money = (n: number) => formatMoney(n, "IDR");

/** Dilunasi whose cash (Dilunasi − its PPh) comes to `target`, or as close under it as the rounding allows. */
function settledForCash(bill: OpenBill, target: number, withhold: boolean): number {
  const cash = (s: number) => settleBill({ bill, before: bill.paid, settled: s, withhold }).cash;
  if (target <= 0) return 0;
  if (cash(bill.open) <= target) return bill.open;
  const pphShare = bill.total ? bill.withholdings.reduce((a, w) => a + w.amount, 0) / bill.total : 0;
  let s = Math.min(bill.open, Math.max(1, Math.round(target / (1 - (withhold ? pphShare : 0)))));
  for (let i = 0; i < 1000 && s < bill.open && cash(s) < target; i++) s++;
  for (let i = 0; i < 1000 && s > 0 && cash(s) > target; i++) s--;
  return s;
}

export function CashReceiptForm({
  mode,
  receipt,
  options,
  can,
}: {
  mode: CashReceiptMode;
  receipt: CashReceiptView | null;
  options: CashReceiptOptions;
  can: CashReceiptAbilities;
}) {
  const router = useRouter();
  const toast = useToast();
  const editing = mode !== "view";

  const [h, setH] = useState<Header>(() => {
    if (receipt) {
      const i = receipt.input;
      return {
        purpose: i.purpose,
        tx_date: i.tx_date,
        partner_id: Number(i.partner_id),
        cash_bank_id: Number(i.cash_bank_id),
        bank_ref: i.bank_ref,
        note: i.note,
        cash_amount: String(i.cash_amount),
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
      cash_amount: "",
      bank_charge: "",
    };
  });
  const [picks, setPicks] = useState<Record<number, Pick>>(() =>
    Object.fromEntries(
      (receipt?.input.lines ?? []).map((l) => [
        Number(l.doc_id),
        { on: true, settled: String(l.settled), withhold: l.withhold },
      ])
    )
  );
  // Until the user types Dana Diterima, it follows the ticked bills.
  const [cashTyped, setCashTyped] = useState(Boolean(receipt));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  const purpose = cashBankPurpose(h.purpose);
  const touch = (...names: string[]) => {
    setDirty(true);
    setErrors((e) => {
      const next = { ...e };
      for (const n of names) delete next[n];
      delete next._balance;
      return next;
    });
  };
  const set = <K extends keyof Header>(k: K, v: Header[K]) => {
    setH((x) => ({ ...x, [k]: v }));
    touch(k);
  };

  // ---- what may be settled: the purpose's documents, owed by the partner
  const partnerBills = useMemo(
    () =>
      purpose && h.partner_id
        ? options.bills
            .filter((b) => b.customerId === h.partner_id)
            .sort((a, b) => (a.advanceDate === b.advanceDate ? a.id - b.id : a.advanceDate < b.advanceDate ? -1 : 1))
        : [],
    [options.bills, purpose, h.partner_id]
  );
  const billById = useMemo(() => new Map(options.bills.map((b) => [b.id, b])), [options.bills]);

  // ---- every ticked bill's figures, exactly as the Server Action will store them
  const lines = useMemo(() => {
    const out: { bill: OpenBill; line: SettlementLine; withhold: boolean }[] = [];
    for (const b of partnerBills) {
      const p = picks[b.id];
      if (!p?.on) continue;
      const withhold = purpose?.withholding ? p.withhold : false;
      out.push({ bill: b, withhold, line: settleBill({ bill: b, before: b.paid, settled: Number(p.settled) || 0, withhold }) });
    }
    return out;
  }, [partnerBills, picks, purpose]);
  const charge = Number(h.bank_charge) || 0;
  const expected = lines.reduce((a, l) => a + l.line.cash, 0) - charge;
  const cashValue = cashTyped ? Number(h.cash_amount) || 0 : Math.max(0, expected);
  const balance = settlementBalance(
    lines.map((l) => l.line),
    cashValue,
    charge
  );

  const pick = (b: OpenBill, on: boolean) => {
    setPicks((x) => ({
      ...x,
      [b.id]: { on, settled: x[b.id]?.settled && on ? x[b.id].settled : String(Math.max(0, b.open)), withhold: x[b.id]?.withhold ?? true },
    }));
    touch("_lines", `lines.${b.id}`);
  };
  const setPick = (id: number, patch: Partial<Pick>) => {
    setPicks((x) => ({ ...x, [id]: { ...x[id], ...patch } }));
    touch("_lines");
  };
  const allOn = partnerBills.length > 0 && partnerBills.every((b) => picks[b.id]?.on);
  const pickAll = (on: boolean) => {
    setPicks((x) => {
      const next = { ...x };
      for (const b of partnerBills) next[b.id] = { on, settled: String(Math.max(0, b.open)), withhold: x[b.id]?.withhold ?? true };
      return next;
    });
    touch("_lines");
  };

  /** Spends Dana Diterima + Biaya Bank on the ticked bills, oldest first. */
  const allocate = () => {
    let left = (Number(h.cash_amount) || 0) + charge;
    setPicks((x) => {
      const next = { ...x };
      for (const b of partnerBills) {
        const p = next[b.id];
        if (!p?.on) continue;
        const withhold = purpose?.withholding ? p.withhold : false;
        const s = settledForCash(b, left, withhold);
        if (s <= 0) {
          next[b.id] = { ...p, on: false, settled: String(Math.max(0, b.open)) };
          continue;
        }
        next[b.id] = { ...p, settled: String(s) };
        left -= settleBill({ bill: b, before: b.paid, settled: s, withhold }).cash;
      }
      return next;
    });
    touch("_lines");
  };

  async function onSave() {
    setSaving(true);
    const input = {
      ...h,
      cash_amount: cashValue,
      bank_charge: charge,
      lines: lines.map((l) => ({ doc_id: l.bill.id, settled: l.line.settled, withhold: l.withhold })),
    };
    const result =
      mode === "edit" ? await updateCashReceiptAction(receipt!.id, input) : await createCashReceiptAction(input);
    setSaving(false);
    if (!result.ok) {
      // Line errors come back by position; the table shows them by bill.
      const mapped: Record<string, string> = {};
      for (const [k, v] of Object.entries(result.errors)) {
        const m = /^lines\.(\d+)\.(\w+)$/.exec(k);
        if (m) mapped[`lines.${lines[Number(m[1])]?.bill.id}`] = v;
        else mapped[k] = v;
      }
      setErrors(mapped);
      toast(
        result.errors._form ? "Tidak diizinkan" : "Belum bisa disimpan",
        result.errors._form ?? result.errors._balance ?? result.errors._lines ?? "Periksa kembali isian.",
        "err"
      );
      return;
    }
    setDirty(false);
    toast("Penerimaan disimpan", `${result.txNo} · Draft`, "ok");
    router.push(`/finance/cash-bank/receipt/${result.id}`);
    router.refresh();
  }

  const status = receipt?.status ?? "Draft";
  const backHref = receipt ? `/finance/cash-bank/receipt/${receipt.id}` : "/finance/cash-bank/receipt";
  const ro = (node: React.ReactNode) => <div className="ro">{node}</div>;
  const nil = (text = "tidak diisi") => <div className="ro nil">{text}</div>;
  const partners = options.partners.filter((p) => !purpose || p.category === purpose.partnerCategory);
  const partner = options.partners.find((p) => p.id === h.partner_id) ?? null;
  const cashBank = options.cashBanks.find((c) => c.id === h.cash_bank_id) ?? null;

  // ======================================================= header card
  const headerCard = (
    <div className="card">
      <FormBody>
        <FormSection title="Penerimaan">
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
                    setPicks({});
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
                    setPicks({});
                    touch("partner_id", "_lines");
                  }}
                />
              ) : (
                ro(
                  <>
                    <span className="lab">{receipt?.partnerLabel}</span>
                    <span>{receipt?.partnerName}</span>
                  </>
                )
              )}
            </Field>
            <Field label="Kas & Bank" span={4} required={editing} help={editing ? "tempat dana diterima" : undefined} error={errors.cash_bank_id}>
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
                    <span className="lab">{receipt?.cashBankLabel}</span>
                    <span>{receipt?.cashBankName}</span>
                  </>
                )
              )}
            </Field>
            <Field label="Tanggal Terima" span={3} required={editing} error={errors.tx_date}>
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
            <Field
              label="Dana Diterima"
              span={3}
              required={editing}
              help={editing ? (cashTyped ? "sesuai mutasi rekening" : "mengikuti tagihan yang dicentang") : undefined}
              error={errors.cash_amount}
            >
              {editing ? (
                <MoneyInput
                  value={cashTyped ? h.cash_amount : expected > 0 ? String(expected) : ""}
                  currencyLabel="IDR"
                  invalid={Boolean(errors.cash_amount)}
                  ariaLabel="Dana Diterima"
                  onChange={(v) => {
                    setCashTyped(true);
                    set("cash_amount", v);
                  }}
                />
              ) : (
                ro(<span className="mny">{money(Number(h.cash_amount))}</span>)
              )}
            </Field>
            <Field label="Biaya Bank" span={3} help={editing ? "dipotong bank, ditanggung perusahaan" : undefined} error={errors.bank_charge}>
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
            {!editing && receipt?.journal && (
              <Field label="Referensi" span={12}>
                {ro(
                  <>
                    <span className="rx">Journal</span>
                    <Link className="drl" href={`/accounting/journal/${receipt.journal.id}`}>
                      <span className="mono">{receipt.journal.journalNo}</span>
                    </Link>
                  </>
                )}
              </Field>
            )}
          </FormRow>
        </FormSection>
        {receipt?.status === "Cancelled" && receipt.cancelReason && (
          <p className="fnote">
            <b>Dibatalkan:</b> {receipt.cancelReason}
          </p>
        )}
        {!editing && receipt?.status !== "Cancelled" && (
          <p className="fnote">
            {receipt?.status === "Draft"
              ? "Penerimaan masih Draft — belum membentuk journal, belum masuk Buku Kas & Bank, dan belum mengurangi tagihan."
              : "Diposting: dana tercatat di Buku Kas & Bank, dan journal membukukan kewajiban uang muka, PPN Keluaran serta PPh yang dipotong customer pada tanggal terima. Bukti potong dan faktur pajak uang muka dibuat dari angka baris ini saat menu Pajak tersedia."}
          </p>
        )}
      </FormBody>
    </div>
  );

  // ======================================================== bills card
  const viewLines = receipt?.lines ?? [];
  const rows = editing ? partnerBills : viewLines.map((l) => billById.get(l.docId)).filter((b): b is OpenBill => Boolean(b));
  const waiting = !purpose ? "Pilih Tujuan dulu…" : !h.partner_id ? `Pilih ${purpose.partnerCategory} dulu…` : null;
  const whtLabel = (key: string) => options.withholdingLabels[key] ?? "PPh";

  const billsCard = (
    <div className="card" style={{ marginTop: 14 }}>
      <div className="card-h">
        <span className="ci">
          <Icon name="wallet" size={15} />
        </span>
        <div className="ct">
          <h3>{purpose ? `${purpose.docNoun} yang Dibayar` : "Dokumen yang Dibayar"}</h3>
          <p>
            {editing
              ? "Semua tagihan terbuka milik partner ini. Centang yang dibayar — Dilunasi terisi sisa tagihan dan dapat dikurangi untuk pembayaran sebagian. PPh yang dipotong customer dihitung otomatis."
              : "Tagihan yang diselesaikan penerimaan ini."}
          </p>
        </div>
        {editing && partnerBills.length > 0 && (
          <div className="ph-act" style={{ marginLeft: "auto" }}>
            <button type="button" className="btn sm" onClick={allocate} disabled={!lines.length || !cashTyped} title="Isi Dana Diterima dulu, lalu bagikan ke tagihan tercentang dari yang terlama">
              <Icon name="calc" size={13} /> Alokasikan Dana
            </button>
            <button type="button" className="btn sm" onClick={() => pickAll(!allOn)}>
              <Icon name="check" size={13} /> {allOn ? "Kosongkan" : "Pilih Semua"}
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
          <p>Tagihan terbuka partner tampil di sini setelah Tujuan dan Partner dipilih.</p>
        </div>
      ) : rows.length === 0 ? (
        <div className="empty sm">
          <div className="ic">
            <Icon name="wallet" size={18} />
          </div>
          <h4>Tidak ada tagihan terbuka</h4>
          <p>{partner?.name ?? "Partner ini"} tidak memiliki {purpose?.docNoun.toLowerCase() ?? "tagihan"} yang diterbitkan dan belum lunas.</p>
        </div>
      ) : (
        <div className="tw">
          <table className="grid ltab" style={{ minWidth: 960 }}>
            <thead>
              <tr>
                {editing && (
                  <th className="pick">
                    <input type="checkbox" checked={allOn} aria-label="Pilih semua" onChange={(e) => pickAll(e.target.checked)} />
                  </th>
                )}
                <th style={{ minWidth: 250 }}>Tagihan</th>
                <th style={{ width: 100 }}>Tanggal</th>
                <th className="num" style={{ width: 128 }}>Total</th>
                <th className="num" style={{ width: 128 }}>{editing ? "Sisa" : "Sisa Sebelum"}</th>
                <th className="num" style={{ width: 150 }}>Dilunasi</th>
                <th style={{ width: 150 }}>PPh Dipotong</th>
                <th className="num" style={{ width: 128 }}>Dana</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((b) => {
                const p = picks[b.id];
                const on = editing ? Boolean(p?.on) : true;
                const stored = viewLines.find((l) => l.docId === b.id);
                const calc = lines.find((l) => l.bill.id === b.id);
                const settled = editing ? calc?.line.settled ?? 0 : stored?.settled ?? 0;
                const whts = editing ? calc?.line.withholdings ?? [] : stored?.withholdings ?? [];
                const pph = editing ? calc?.line.pph ?? 0 : stored?.pph ?? 0;
                const hasWht = b.withholdings.some((w) => w.amount > 0) && purpose?.withholding;
                const err = errors[`lines.${b.id}`];
                return (
                  <tr key={b.id} className={[on ? "" : "unpicked", err ? "overrow" : ""].filter(Boolean).join(" ") || undefined}>
                    {editing && (
                      <td className="pick">
                        <input type="checkbox" checked={on} aria-label={`Bayar ${b.advanceNo}`} onChange={(e) => pick(b, e.target.checked)} />
                      </td>
                    )}
                    <td>
                      <span className="dstack">
                        <Link className="d1 drl" href={`/finance/advance/sales/${b.id}`} target="_blank">
                          <span className="mono">{b.advanceNo}</span>
                        </Link>
                        <span className="d2">{b.orderNo}</span>
                      </span>
                      {err && <span className="overtag">{err}</span>}
                    </td>
                    <td>
                      <span className="dstack">
                        <span>{formatDate(b.advanceDate)}</span>
                        <span className="d2">jt {formatDate(b.dueDate)}</span>
                      </span>
                    </td>
                    <td className="num">
                      <span className="mny">{money(b.total)}</span>
                    </td>
                    <td className="num">
                      <span className="mny">{money(b.open)}</span>
                      {editing && b.paid > 0 && <span className="fulltag">dibayar {money(b.paid)}</span>}
                    </td>
                    <td className="num">
                      {editing && on ? (
                        <MoneyInput
                          size="sm"
                          value={p?.settled ?? ""}
                          over={Number(p?.settled) > b.open}
                          ariaLabel={`Dilunasi ${b.advanceNo}`}
                          onChange={(v) => setPick(b.id, { settled: v })}
                        />
                      ) : on ? (
                        <span className="mny">{money(settled)}</span>
                      ) : (
                        <span className="dash">—</span>
                      )}
                      {editing && on && settled > 0 && settled < b.open && <span className="fulltag">sebagian — sisa {money(b.open - settled)}</span>}
                    </td>
                    <td>
                      {!hasWht ? (
                        <span className="dash">tidak ada PPh</span>
                      ) : editing ? (
                        <label className="chk sm" style={{ height: 30, opacity: on ? 1 : 0.5 }}>
                          <input
                            type="checkbox"
                            checked={p?.withhold ?? true}
                            disabled={!on}
                            onChange={(e) => setPick(b.id, { withhold: e.target.checked })}
                          />
                          <span>
                            <span className="ct">Potong{on && pph ? ` · ${money(pph)}` : ""}</span>
                          </span>
                        </label>
                      ) : whts.length ? (
                        <span className="dstack">
                          {whts.map((w) => (
                            <span key={w.key} title={`${formatPct(w.rate)} × DPP ${money(w.base)}`}>
                              <span className="lab">{whtLabel(w.key)}</span> <span className="mny">{money(w.amount)}</span>
                            </span>
                          ))}
                        </span>
                      ) : (
                        <span className="dash">tidak dipotong</span>
                      )}
                    </td>
                    <td className="num">
                      <span className="mny">{on ? money(settled - pph) : "—"}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="totrow">
                <td colSpan={editing ? 5 : 4} style={{ textAlign: "right" }}>
                  {lines.length || !editing ? `${editing ? lines.length : viewLines.length} tagihan dibayar` : "Belum ada tagihan dicentang"}
                </td>
                <td className="num">
                  <span className="mny big">{money(editing ? balance.settled : viewLines.reduce((a, l) => a + l.settled, 0))}</span>
                </td>
                <td>
                  <span className="mny">{money(editing ? balance.pph : viewLines.reduce((a, l) => a + l.pph, 0))}</span>
                </td>
                <td className="num">
                  <span className="mny big">
                    {money(editing ? balance.settled - balance.pph : viewLines.reduce((a, l) => a + l.settled - l.pph, 0))}
                  </span>
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
      {editing && lines.length > 0 && <BalanceNote balance={balance} cashTyped={cashTyped} />}
      {(lines.length > 0 || !editing) && (
        <div className="cardfoot multi">
          <div className="impact">
            <div className="ttl">Bagian yang Dibukukan</div>
            {(editing
              ? lines.map((l) => ({ no: l.bill.advanceNo, dpp: l.line.dppPart, ppn: l.line.ppnPart }))
              : viewLines.map((l) => ({ no: billById.get(l.docId)?.advanceNo ?? "", dpp: l.dppPart, ppn: l.ppnPart }))
            ).map((x) => (
              <div className="ir" key={x.no}>
                <span>
                  {x.no} · DPP {money(x.dpp)} + PPN
                </span>
                <b>{money(x.ppn)}</b>
              </div>
            ))}
            {whtTotals(editing ? lines.map((l) => l.line.withholdings) : viewLines.map((l) => l.withholdings)).map((w) => (
              <div className="ir" key={w.key}>
                <span>{whtLabel(w.key)} dipotong customer</span>
                <b>{money(w.amount)}</b>
              </div>
            ))}
          </div>
          <div className="impact">
            <div className="ttl">Penyelesaian</div>
            <div className="ir">
              <span>Tagihan dilunasi</span>
              <b>{money(editing ? balance.settled : viewLines.reduce((a, l) => a + l.settled, 0))}</b>
            </div>
            <div className="ir">
              <span>PPh dipotong customer</span>
              <b>−{money(editing ? balance.pph : viewLines.reduce((a, l) => a + l.pph, 0))}</b>
            </div>
            <div className="ir">
              <span>Biaya bank</span>
              <b>−{money(charge)}</b>
            </div>
            <div className="ir tot">
              <span>Dana seharusnya diterima</span>
              <b>{money(editing ? balance.expectedCash : Number(h.cash_amount))}</b>
            </div>
            <div className="ir">
              <span>Dana diterima</span>
              <b>{money(editing ? balance.cash : Number(h.cash_amount))}</b>
            </div>
            {editing && (
              <div className={`ir ${balance.difference === 0 ? "ok" : "diff"}`}>
                <span>Selisih</span>
                <b>{balance.difference === 0 ? "Seimbang" : money(balance.difference)}</b>
              </div>
            )}
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
          <Link href="/finance/cash-bank/receipt">Penerimaan</Link>
          <span>/</span>
          <span className="cur">{receipt ? receipt.txNo : "Baru"}</span>
        </div>
        <div className="ph-row">
          <h1>
            <span className="ph-ico">
              <Icon name="down" size={16} />
            </span>
            {receipt ? (
              <>
                <span className="docno">{receipt.txNo}</span>
                <span className={`bdg ${CASH_BANK_TX_STATUS_BADGE[status]}`}>{CASH_BANK_TX_STATUS_TEXT[status]}</span>
              </>
            ) : (
              "Penerimaan Baru"
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
              <CashReceiptActions
                id={receipt!.id}
                subject={`${receipt!.txNo} – ${money(Number(h.cash_amount))}`}
                status={status}
                can={can}
              />
            )}
          </div>
        </div>
      </div>

      {errors._balance && (
        <div className="nbox bad" style={{ margin: "0 0 14px" }}>
          <Icon name="warn" size={15} className="ni" />
          <div>
            <b>Belum seimbang</b>
            <p>{errors._balance}</p>
          </div>
        </div>
      )}

      <div className="fgrid solo">
        <div>
          {headerCard}
          {billsCard}
        </div>
      </div>
      {cashBank && !cashBank.active && editing && (
        <p className="fnote">Kas & Bank {cashBank.label} sudah nonaktif — pilih yang lain sebelum menyimpan.</p>
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

/** What the gap between the bills and the money is made of, in words (the simulation's explain box). */
function BalanceNote({ balance, cashTyped }: { balance: ReturnType<typeof settlementBalance>; cashTyped: boolean }) {
  if (balance.difference === 0) {
    return (
      <div className="nbox slim">
        <Icon name="check" size={15} className="ni" />
        <div>
          <b>Seimbang — dana diterima menjelaskan seluruh tagihan yang dilunasi.</b>
          {balance.pph > 0 && <p>Selisih antara tagihan dan dana adalah PPh {formatMoney(balance.pph, "IDR")} yang dipotong customer{balance.bankCharge ? ` dan biaya bank ${formatMoney(balance.bankCharge, "IDR")}` : ""}.</p>}
        </div>
      </div>
    );
  }
  if (balance.difference < 0) {
    return (
      <div className="nbox warn slim">
        <Icon name="warn" size={15} className="ni" />
        <div>
          <b>Dana kurang {formatMoney(-balance.difference, "IDR")} dari tagihan yang dicentang.</b>
          <p>
            Bila selisihnya dipotong bank, isi sebagai Biaya Bank. Bila customer membayar sebagian, tekan{" "}
            <b>Alokasikan Dana</b> — dana dibagikan ke tagihan dari yang terlama dan sisanya tetap terbuka.
          </p>
        </div>
      </div>
    );
  }
  return (
    <div className="nbox bad slim">
      <Icon name="warn" size={15} className="ni" />
      <div>
        <b>Dana {formatMoney(balance.difference, "IDR")} lebih besar dari tagihan yang dicentang.</b>
        <p>
          {cashTyped
            ? "Centang tagihan lain atau periksa dana diterima. Kelebihan bayar belum ditangani penerimaan ini."
            : "Periksa biaya bank."}
        </p>
      </div>
    </div>
  );
}
