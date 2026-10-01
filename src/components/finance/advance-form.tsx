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
import { PercentInput } from "@/components/ui/percent-input";
import { useToast } from "@/components/ui/toast";
import { AdvanceActions } from "@/components/finance/advance-actions";
import { createSalesAdvanceAction, updateSalesAdvanceAction } from "@/app/actions/sales-advance";
import {
  advanceAmountProblem,
  computeAdvance,
  type AdvanceAmountType,
  type PriceMode,
} from "@/lib/erp/sales-tax";
import {
  ADVANCE_STATUS_BADGE,
  ADVANCE_STATUS_TEXT,
  type AdvanceAbilities,
} from "@/lib/erp/sales-advance-workflow";
import type { SalesAdvanceOptions, SalesAdvanceView } from "@/lib/erp/sales-advance";
import { formatTaxId } from "@/lib/erp/partner-shape";
import { formatDate, formatMoney, formatPct, todayIso } from "@/lib/format";

/**
 * Uang Muka Penjualan — the AR advance bill, in all three modes: `new`,
 * `edit` (Draft only) and `view` (P54–P58).
 *
 * The Customer Order comes first and decides everything the bill follows —
 * customer, address, PO, mode harga, Kena PPN — laid out as the Customer Order's
 * own header is, then the bill itself, then its value. The order's lines are
 * not copied onto the bill: a bill shows its own figures and links to the
 * order (S13/S14). The order is one line — the bill's Uraian beside the
 * order's total and DPP — and the value drawn from it is typed below (P64).
 *
 * The value is typed as a percent of the order or a flat value, with the same
 * toggle as a Customer Order line's discount (P55), and read in the order's price
 * mode. Every figure is `computeAdvance`, which the Server Action stores from.
 *
 * The AP advance will be this form with the other side's words (P58).
 */

export type AdvanceMode = "new" | "edit" | "view";

type State = {
  order_id: number | null;
  advance_date: string;
  due_date: string;
  cash_bank_id: number | null;
  description: string;
  note: string;
  amount_type: AdvanceAmountType;
  amount_value: string;
};

const MODE_TEXT: Record<PriceMode, string> = { Exclude: "Exclude PPN", Include: "Include PPN" };
const money = (n: number) => formatMoney(n, "IDR");
const DUE_DAYS = 7;

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const descriptionFor = (orderNo: string, poNo: string | null) =>
  `Uang muka atas pesanan ${orderNo}${poNo ? ` (PO ${poNo})` : ""}`;

/** A receipt that names this bill, as its page lists them (P66). */
export type AdvancePayment = { id: number; txNo: string; date: string; status: string; settled: number };

export function AdvanceForm({
  mode,
  advance,
  options,
  can,
  payments = [],
}: {
  mode: AdvanceMode;
  advance: SalesAdvanceView | null;
  options: SalesAdvanceOptions;
  can: AdvanceAbilities;
  payments?: AdvancePayment[];
}) {
  const router = useRouter();
  const toast = useToast();
  const editing = mode !== "view";

  const [s, setS] = useState<State>(() => {
    if (advance) {
      const i = advance.input;
      return {
        order_id: Number(i.order_id),
        advance_date: i.advance_date,
        due_date: i.due_date,
        cash_bank_id: Number(i.cash_bank_id),
        description: i.description,
        note: i.note,
        amount_type: i.amount_type as AdvanceAmountType,
        amount_value: String(i.amount_value),
      };
    }
    const today = todayIso();
    const banks = options.banks.filter((b) => b.active);
    return {
      order_id: null,
      advance_date: today,
      due_date: addDays(today, DUE_DAYS),
      cash_bank_id: banks.length === 1 ? banks[0].id : null,
      description: "",
      note: "",
      amount_type: "Percent",
      amount_value: "",
    };
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  const order = options.orders.find((o) => o.id === s.order_id) ?? null;

  const touch = (...names: string[]) => {
    setDirty(true);
    setErrors((e) => {
      const next = { ...e };
      for (const n of names) delete next[n];
      return next;
    });
  };
  const set = <K extends keyof State>(k: K, v: State[K]) => {
    setS((x) => ({ ...x, [k]: v }));
    touch(k === "amount_type" ? "amount_value" : k);
  };

  /** Choosing the order fills what the bill follows from it. */
  const pickOrder = (id: number | null) => {
    const o = options.orders.find((x) => x.id === id) ?? null;
    setS((x) => {
      const prev = options.orders.find((y) => y.id === x.order_id);
      const auto = !x.description || (prev && x.description === descriptionFor(prev.orderNo, prev.poNo));
      return {
        ...x,
        order_id: id,
        description: o && auto ? descriptionFor(o.orderNo, o.poNo) : x.description,
        amount_value: "",
      };
    });
    touch("order_id", "description", "amount_value");
  };

  const typed = Number(s.amount_value) || 0;
  // A stored bill shows the rate it carries; one being edited previews the
  // rate in force, which its save will snapshot (P60).
  const rates = mode === "view" ? (advance?.rates ?? null) : options.ppnRates;
  const figures = useMemo(
    () => (order ? computeAdvance({ basis: order.basis, type: s.amount_type, typed, rates }) : null),
    [order, s.amount_type, typed, rates]
  );
  const factor = rates ? `${rates.otherNum}/${rates.otherDen}` : "—";
  const ratePct = rates ? formatPct(rates.rate) : "—";
  const over =
    editing && order && typed > 0
      ? advanceAmountProblem(s.amount_type, typed, order.value, order.left) !== null
      : false;

  const fillRest = () => {
    if (!order) return;
    setS((x) =>
      order.drawn === 0
        ? { ...x, amount_type: "Percent", amount_value: "100" }
        : { ...x, amount_type: "Amount", amount_value: String(order.left) }
    );
    touch("amount_value");
  };

  async function onSave() {
    setSaving(true);
    const input = { ...s, amount_value: typed };
    const result =
      mode === "edit" ? await updateSalesAdvanceAction(advance!.id, input) : await createSalesAdvanceAction(input);
    setSaving(false);
    if (!result.ok) {
      setErrors(result.errors);
      const n = Object.keys(result.errors).filter((k) => !k.startsWith("_")).length;
      toast(
        result.errors._form ? "Tidak diizinkan" : "Belum bisa disimpan",
        result.errors._form ?? `${n} field perlu diperbaiki.`,
        "err"
      );
      return;
    }
    setDirty(false);
    toast("Tagihan uang muka disimpan", `${result.advanceNo} · Draft`, "ok");
    router.push(`/finance/advance/sales/${result.id}`);
    router.refresh();
  }

  const status = advance?.status ?? "Draft";
  const backHref = advance ? `/finance/advance/sales/${advance.id}` : "/finance/advance/sales";
  const ro = (node: React.ReactNode) => <div className="ro">{node}</div>;
  const nil = (text = "tidak diisi") => <div className="ro nil">{text}</div>;
  const waitOrder = "menunggu Customer Order";

  const taxStatus = order
    ? [order.isPkp ? "PKP" : "Non-PKP", order.basis.vatCollector ? "Pemungut PPN" : null, order.collectsPph22 ? "Pemungut PPh 22" : null]
        .filter(Boolean)
        .join(" · ")
    : null;
  /** A value that follows from the order, or a wait while none is chosen. */
  const fromOrder = (node: (o: NonNullable<typeof order>) => React.ReactNode, empty = "tidak diisi") =>
    order ? node(order) ?? nil(empty) : nil(waitOrder);

  // ======================================================= header card
  //
  // The order's side reads exactly as the Customer Order's own header does —
  // Customer, Pesanan, Harga & Pajak, the same fields in the same places — so
  // a reader who knows one page finds everything on the other (P64). Only
  // the Tagihan section is the bill's own.
  const headerCard = (
    <div className="card">
      <FormBody>
        <FormSection title="Customer">
          <FormRow>
            <Field label="Customer" span={6}>
              {fromOrder((o) =>
                ro(
                  <>
                    <span className="lab">{o.customerLabel}</span>
                    <span>{o.customerName}</span>
                  </>
                )
              )}
            </Field>
            <Field label={order?.taxIdType === "NIK" ? "NIK Pembeli" : "NPWP Pembeli"} span={3}>
              {fromOrder((o) => (o.taxId ? ro(<span className="mono">{formatTaxId(o.taxId)}</span>) : null))}
            </Field>
            <Field label="Status Pajak" span={3}>
              {fromOrder(() => ro(<span className="bdg t-slate">{taxStatus}</span>))}
            </Field>
            <Field label="Alamat" span={12} help={editing && order ? "dari Customer Order" : undefined}>
              {fromOrder((o) => ro(<span>{o.addressText}</span>))}
            </Field>
          </FormRow>
        </FormSection>

        <FormSection title="Pesanan">
          <FormRow>
            <Field
              label="Customer Order"
              span={3}
              required={mode === "new"}
              locked={mode === "edit"}
              help={mode === "new" ? "hanya CO berstatus Open" : undefined}
              error={errors.order_id}
            >
              {mode === "new" ? (
                <Combobox
                  value={s.order_id}
                  options={options.orders
                    .filter((o) => o.left > 0)
                    .map((o) => ({ id: o.id, label: o.orderNo, name: o.customerName, active: true }))}
                  placeholder="Pilih Customer Order…"
                  invalid={Boolean(errors.order_id)}
                  onChange={pickOrder}
                />
              ) : order ? (
                ro(
                  <Link className="drl" href={`/sales/customer-order/${order.id}`}>
                    <span className="mono">{order.orderNo}</span>
                  </Link>
                )
              ) : (
                nil()
              )}
            </Field>
            <Field label="Tanggal CO" span={3}>
              {fromOrder((o) => ro(formatDate(o.orderDate)))}
            </Field>
            <Field label="No. PO Customer" span={3}>
              {fromOrder((o) => (o.poNo ? ro(<span className="mono">{o.poNo}</span>) : null))}
            </Field>
            <Field label="Tanggal PO" span={3}>
              {fromOrder((o) => (o.poDate ? ro(formatDate(o.poDate)) : null))}
            </Field>
            <Field label="Termin Pembayaran" span={3}>
              {fromOrder((o) =>
                ro(
                  <>
                    <span className="lab">{o.termLabel}</span>
                    <span>{o.termName}</span>
                  </>
                )
              )}
            </Field>
            <Field label="Salesperson" span={6}>
              {fromOrder((o) => (o.salesperson ? ro(o.salesperson) : null))}
            </Field>
          </FormRow>
        </FormSection>

        <FormSection title="Harga & Pajak">
          <FormRow>
            <Field label="PPN" span={4}>
              {fromOrder((o) =>
                ro(
                  <span className={`bdg ${o.basis.taxable ? "s-ok" : "s-mute"}`}>
                    {o.basis.taxable ? "Kena PPN" : "Tidak Kena PPN"}
                  </span>
                )
              )}
            </Field>
            {order?.basis.taxable && (
              <Field label="Mode Harga" span={4}>
                {ro(<span className="bdg t-slate">{MODE_TEXT[order.basis.mode]}</span>)}
              </Field>
            )}
          </FormRow>
        </FormSection>

        <FormSection title="Tagihan">
          <FormRow>
            <Field label="Tanggal Tagihan" span={3} required={editing} error={errors.advance_date}>
              {editing ? (
                <DateInput
                  value={s.advance_date}
                  invalid={Boolean(errors.advance_date)}
                  onChange={(v) => set("advance_date", v)}
                />
              ) : (
                ro(formatDate(s.advance_date))
              )}
            </Field>
            <Field label="Jatuh Tempo" span={3} required={editing} error={errors.due_date}>
              {editing ? (
                <DateInput value={s.due_date} invalid={Boolean(errors.due_date)} onChange={(v) => set("due_date", v)} />
              ) : (
                ro(
                  <>
                    {formatDate(s.due_date)}
                    {status === "Issued" && s.due_date < todayIso() && (
                      <span className="bdg t-bad">Lewat jatuh tempo</span>
                    )}
                  </>
                )
              )}
            </Field>
            <Field
              label="Rekening Pembayaran"
              span={6}
              required={editing}
              help={editing ? "tercetak pada tagihan" : undefined}
              error={errors.cash_bank_id}
            >
              {editing ? (
                <Combobox
                  value={s.cash_bank_id}
                  options={options.banks}
                  placeholder="Pilih Rekening…"
                  invalid={Boolean(errors.cash_bank_id)}
                  onChange={(v) => set("cash_bank_id", v)}
                />
              ) : (
                ro(
                  <>
                    <span className="lab">{advance?.bankLabel}</span>
                    <span>{advance?.bankName}</span>
                  </>
                )
              )}
            </Field>
            {!editing && advance?.status === "Issued" && (
              <Field label="Pembayaran" span={12}>
                {payments.length
                  ? ro(
                      <>
                        {(() => {
                          const paid = payments.filter((p) => p.status === "Posted").reduce((a, p) => a + p.settled, 0);
                          const total = advance.figures.total;
                          return (
                            <span className={`bdg ${paid >= total ? "t-ok" : paid > 0 ? "t-info" : "t-warn"}`}>
                              {paid >= total ? "Lunas" : paid > 0 ? `Sebagian · ${money(paid)}` : "Belum Dibayar"}
                            </span>
                          );
                        })()}
                        {payments.map((p) => (
                          <span key={p.id}>
                            <span className="rx">·</span>
                            <Link className="drl" href={`/finance/cash-bank/receipt/${p.id}`}>
                              <span className="mono">{p.txNo}</span>
                            </Link>
                            <span className="rx">
                              {p.status === "Posted" ? money(p.settled) : p.status === "Draft" ? "draft" : "dibatalkan"}
                            </span>
                          </span>
                        ))}
                      </>
                    )
                  : nil("belum dibayar")}
              </Field>
            )}
            <Field label="Catatan" span={12}>
              {editing ? (
                <textarea
                  className="ta"
                  rows={2}
                  value={s.note}
                  placeholder="Catatan internal, tidak tercetak…"
                  onChange={(e) => set("note", e.target.value)}
                />
              ) : s.note ? (
                <div className="ro multi">{s.note}</div>
              ) : (
                <div className="ro multi nil">tidak diisi</div>
              )}
            </Field>
          </FormRow>
        </FormSection>
        {advance?.status === "Cancelled" && advance.cancelReason && (
          <p className="fnote">
            <b>Dibatalkan:</b> {advance.cancelReason}
          </p>
        )}
        {!editing && advance?.status !== "Cancelled" && (
          <p className="fnote">
            {advance?.status === "Draft"
              ? "Tagihan masih Draft — belum dikirim ke customer dan masih dapat diubah. Menerbitkan tagihan tidak membentuk journal."
              : "Tagihan sudah diterbitkan. Tagihan uang muka bukan transaksi, sehingga tidak membentuk journal: kas, Uang Muka Penjualan dan PPN Keluaran dicatat saat pembayarannya diterima di menu Penerimaan Kas & Bank."}
          </p>
        )}
      </FormBody>
    </div>
  );

  // ======================================================== basis card
  //
  // The order as one line — its Uraian, what it is worth and its DPP — then
  // the one value the bill draws from it (P64), the shape the simulation's
  // Uang Muka Perizinan gives its pengajuan.
  const inclusive = Boolean(order?.basis.taxable && order.basis.mode === "Include");
  const valueLabel = !order
    ? "Nilai Uang Muka"
    : !order.basis.taxable
      ? "Uang Muka Ditarik (tanpa PPN)"
      : inclusive
        ? "Uang Muka Ditarik (termasuk PPN)"
        : "Uang Muka Ditarik (DPP)";
  const orderValueLabel = !order || !order.basis.taxable ? "nilai pesanan" : inclusive ? "total pesanan" : "DPP pesanan";
  const roomHelp =
    editing && order
      ? `maks ${money(order.left)}${order.drawn ? ` — ${money(order.drawn)} sudah ditagih uang muka lain` : ""}`
      : undefined;

  const basisCard = (
    <div className="card" style={{ marginTop: 14 }}>
      <div className="card-h">
        <span className="ci">
          <Icon name="calc" size={15} />
        </span>
        <div className="ct">
          <h3>Dasar Uang Muka</h3>
          <p>
            {!order
              ? "Nilai pesanan dari Customer Order yang dipilih menjadi dasar uang muka."
              : !order.basis.taxable
                ? "Pesanan sebagai satu baris, lalu satu nilai uang muka yang ditarik darinya. Tanpa PPN."
                : inclusive
                  ? "Pesanan sebagai satu baris, lalu satu nilai uang muka yang ditarik darinya (sudah termasuk PPN). DPP, DPP Nilai Lain dan PPN dihitung dari nilai itu."
                  : "Pesanan sebagai satu baris, lalu satu nilai uang muka yang ditarik darinya (sebelum PPN). DPP Nilai Lain dan PPN dihitung dari nilai itu."}
          </p>
        </div>
      </div>
      {!order ? (
        <div className="empty sm">
          <div className="ic">
            <Icon name="box" size={18} />
          </div>
          <h4>Menunggu Customer Order</h4>
          <p>Nilai pesanan tampil di sini; uang muka ditarik dari nilai itu.</p>
        </div>
      ) : (
        <>
          <div className="tw">
            <table className="grid ltab">
              <thead>
                <tr>
                  <th style={{ width: 34 }}>No</th>
                  <th>Uraian pada Tagihan</th>
                  <th className="num" style={{ width: 150 }}>Total Pesanan</th>
                  <th className="num" style={{ width: 160 }}>DPP (sebelum pajak)</th>
                </tr>
              </thead>
              <tbody>
                <tr className={errors.description ? "overrow" : undefined}>
                  <td className="no">1</td>
                  <td>
                    <span className="dstack">
                      {editing ? (
                        <input
                          className={`inp sm${errors.description ? " bad" : ""}`}
                          value={s.description}
                          placeholder="mis. Uang muka 30% atas pesanan …"
                          autoComplete="off"
                          aria-label="Uraian pada Tagihan"
                          onChange={(e) => set("description", e.target.value)}
                        />
                      ) : (
                        <span className="d1" title={s.description}>
                          {s.description}
                        </span>
                      )}
                      <span className="d2">
                        {order.orderNo}
                        {order.poNo ? ` · PO ${order.poNo}` : ""} · {order.lineCount} barang
                      </span>
                    </span>
                    {errors.description && <span className="overtag">{errors.description}</span>}
                  </td>
                  <td className="num">
                    <span className="mny">{money(order.basis.total)}</span>
                  </td>
                  <td className="num">
                    <span className="mny">{money(order.basis.dpp)}</span>
                  </td>
                </tr>
              </tbody>
              <tfoot>
                <tr className="totrow">
                  <td colSpan={3} style={{ textAlign: "right" }}>
                    Total DPP pesanan
                  </td>
                  <td className="num">
                    <span className="mny big">{money(order.basis.dpp)}</span>
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
          <FormBody>
            <FormRow>
              <Field label={valueLabel} span={6} required={editing} help={roomHelp} error={errors.amount_value}>
                {editing ? (
                  <div className="dcell">
                    <span className="dtog" role="group" aria-label="Cara mengisi nilai uang muka">
                      {(["Percent", "Amount"] as AdvanceAmountType[]).map((t) => (
                        <button
                          key={t}
                          type="button"
                          className={s.amount_type === t ? "on" : undefined}
                          onClick={() => {
                            if (s.amount_type === t) return;
                            setS((x) => ({ ...x, amount_type: t, amount_value: "" }));
                            touch("amount_value");
                          }}
                        >
                          {t === "Percent" ? "%" : "Nominal"}
                        </button>
                      ))}
                    </span>
                    {s.amount_type === "Percent" ? (
                      <PercentInput
                        value={s.amount_value}
                        invalid={Boolean(errors.amount_value) || over}
                        ariaLabel={valueLabel}
                        onChange={(v) => set("amount_value", v)}
                      />
                    ) : (
                      <MoneyInput
                        value={s.amount_value}
                        invalid={Boolean(errors.amount_value)}
                        over={over}
                        ariaLabel={valueLabel}
                        onChange={(v) => set("amount_value", v)}
                      />
                    )}
                    <button type="button" className="btn sm" onClick={fillRest} disabled={order.left <= 0}>
                      Sisa
                    </button>
                  </div>
                ) : (
                  ro(<span className="mny">{s.amount_type === "Percent" ? formatPct(typed) : money(typed)}</span>)
                )}
              </Field>
              <Field label="Nilai Ditarik" span={6}>
                {figures && figures.amount > 0
                  ? ro(
                      <>
                        <span className="mny">{money(figures.amount)}</span>
                        <span className="rx">
                          {formatPct(figures.percent)} dari {orderValueLabel} {money(order.value)}
                        </span>
                      </>
                    )
                  : nil("belum diisi")}
              </Field>
            </FormRow>
          </FormBody>
          {figures && (
            <div className="cardfoot multi">
              {(figures.withholdingTotal > 0 || figures.collectedPpn > 0) && (
                <div className="impact">
                  <div className="ttl">Estimasi Penerimaan</div>
                  <div className="ir">
                    <span>Total tagihan uang muka</span>
                    <b>{money(figures.total)}</b>
                  </div>
                  {figures.withholdings.map((w) => (
                    <div className="ir" key={w.key}>
                      <span>
                        {order.withholdingLabels[w.key] ?? "PPh"} {formatPct(w.rate)} × DPP {money(w.base)}
                      </span>
                      <b>−{money(w.amount)}</b>
                    </div>
                  ))}
                  {figures.collectedPpn > 0 && (
                    <div className="ir">
                      <span>PPN dipungut pembeli (WAPU)</span>
                      <b>−{money(figures.collectedPpn)}</b>
                    </div>
                  )}
                  <div className="ir tot">
                    <span>Estimasi dana diterima</span>
                    <b>{money(figures.expectedReceipt)}</b>
                  </div>
                </div>
              )}
              <div className="impact">
                <div className="ttl">
                  Perhitungan Uang Muka · {order.basis.taxable ? MODE_TEXT[order.basis.mode] : "Tidak Kena PPN"}
                </div>
                <div className="ir">
                  <span>DPP pesanan</span>
                  <b>{money(order.basis.dpp)}</b>
                </div>
                {order.basis.taxable ? (
                  <>
                    {inclusive && (
                      <div className="ir">
                        <span>Uang muka ditarik (termasuk PPN)</span>
                        <b>{money(figures.amount)}</b>
                      </div>
                    )}
                    <div className="ir">
                      <span>
                        {inclusive ? "DPP uang muka = nilai − PPN" : "Uang muka ditarik (DPP)"} · {formatPct(figures.percent)}
                      </span>
                      <b>{money(figures.dpp)}</b>
                    </div>
                    <div className="ir">
                      <span>DPP Nilai Lain ({factor})</span>
                      <b>{money(figures.dppOther)}</b>
                    </div>
                    <div className="ir">
                      <span>PPN {ratePct} × DPP Nilai Lain</span>
                      <b>{money(figures.ppn)}</b>
                    </div>
                    {inclusive && figures.total !== figures.amount && (
                      <div className="ir est">
                        <span>Pembulatan PPN (diserap DPP)</span>
                        <b>−{money(figures.amount - figures.total)}</b>
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    <div className="ir">
                      <span>Uang muka ditarik · {formatPct(figures.percent)}</span>
                      <b>{money(figures.dpp)}</b>
                    </div>
                    <div className="ir">
                      <span>PPN</span>
                      <b>Tidak Kena PPN</b>
                    </div>
                  </>
                )}
                <div className="ir tot">
                  <span>Total Tagihan Uang Muka</span>
                  <b>{money(figures.total)}</b>
                </div>
                {!editing && (
                  <div className="ir est">
                    <span>Sisa {orderValueLabel} setelah tagihan ini</span>
                    <b>{money(order.left - (status === "Cancelled" ? 0 : figures.amount))}</b>
                  </div>
                )}
              </div>
            </div>
          )}
        </>
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
          <span>Uang Muka</span>
          <span>/</span>
          <Link href="/finance/advance/sales">Uang Muka Penjualan</Link>
          <span>/</span>
          <span className="cur">{advance ? advance.advanceNo : "Baru"}</span>
        </div>
        <div className="ph-row">
          <h1>
            <span className="ph-ico">
              <Icon name="wallet" size={16} />
            </span>
            {advance ? (
              <>
                <span className="docno">{advance.advanceNo}</span>
                <span className={`bdg ${ADVANCE_STATUS_BADGE[status]}`}>{ADVANCE_STATUS_TEXT[status]}</span>
              </>
            ) : (
              "Uang Muka Penjualan Baru"
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
              <AdvanceActions
                id={advance!.id}
                subject={`${advance!.advanceNo} – ${money(advance!.figures.total)}`}
                status={status}
                can={can}
                figures={advance!.figures}
              />
            )}
          </div>
        </div>
      </div>

      <div className="fgrid solo">
        <div>
          {headerCard}
          {basisCard}
        </div>
      </div>
    </>
  );
}
