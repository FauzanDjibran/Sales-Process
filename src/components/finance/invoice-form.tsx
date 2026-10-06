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
import { InvoiceActions } from "@/components/finance/invoice-actions";
import { InvoiceAdvancePicker, InvoiceNotePicker } from "@/components/finance/invoice-pickers";
import { createInvoiceAction, updateInvoiceAction } from "@/app/actions/ar-invoice";
import {
  INVOICE_PAY_BADGE,
  INVOICE_PAY_TEXT,
  INVOICE_STATUS_BADGE,
  INVOICE_STATUS_TEXT,
  type InvoiceAbilities,
  type InvoicePayState,
} from "@/lib/erp/ar-invoice-workflow";
import type { InvoiceHeaderInput, InvoiceOptions, InvoiceView, InvoiceNoteLine, InvoiceOrderOption } from "@/lib/erp/ar-invoice";
import { advancePpnUsed, computeInvoice, withholdingsOf, type InvoiceFigures, type InvoiceLineInput as TaxLine, type PriceMode } from "@/lib/erp/sales-tax";
import type { TaxDocRefs } from "@/lib/erp/tax-document-workflow";
import { formatDate, formatMoney, formatNumber, formatPct, todayIso, formatPrice } from "@/lib/format";

/**
 * An Invoice Penjualan in all three modes: `new`, `edit` (Draft only) and `view`
 * (`Sales-Process-Concept.md` §9, U16–U22).
 *
 * It starts from one Customer Order, chosen once and locked: the customer,
 * Termin, price mode and Kena PPN are the order's and shown, not chosen. Its
 * lines are whole lines of the order's posted Delivery Notes, picked with
 * *Pilih Surat Jalan*; their price comes from the order. The Uang Muka used is
 * picked with *Pilih Uang Muka* and its DPP typed on the row. The Invoice has
 * its own date; the tax date and the due date follow from the latest Tanggal
 * Kirim of the notes picked. The figures are worked out by the same tax module
 * the server stores them with.
 */

export type InvoiceMode = "new" | "edit" | "view";

type DedState = { key: string; ar_item_id: number; dpp_used: string };

let seq = 0;
const newKey = () => `d${Date.now().toString(36)}${seq++}`;
const qtyText = (n: number) => formatNumber(n, n % 1 ? 2 : 0);
const money = (n: number) => formatMoney(n, "IDR");
const MODE_TEXT: Record<PriceMode, string> = { Exclude: "Exclude PPN", Include: "Include PPN" };

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** The lines as the tax module prices them — the same cumulative walk the server does (P112). */
function pricedLines(order: InvoiceOrderOption, picked: InvoiceNoteLine[]): TaxLine[] {
  const running = new Map(Object.entries(order.billedBefore).map(([k, v]) => [Number(k), v.qty]));
  const byId = new Map(order.lines.map((l) => [l.id, l]));
  return picked.map((n) => {
    const o = byId.get(n.customerOrderLineId)!;
    const before = running.get(o.id) ?? 0;
    running.set(o.id, before + n.qty);
    return {
      qty: n.qty,
      orderQty: o.qty,
      orderGross: o.amount + o.discountAmount,
      orderDiscount: o.discountAmount,
      price: o.price,
      discountType: o.discountType,
      discountValue: o.discountValue,
      billedQtyBefore: before,
      withholdingRate: o.withholdingRate,
      withholdingKey: o.withholdingTaxId ? String(o.withholdingTaxId) : null,
    };
  });
}

export function InvoiceForm({
  mode,
  invoice,
  options,
  can,
  presetOrderId = null,
  pay = null,
  payments = [],
  taxDocs = null,
  advanceNsfp = {},
}: {
  mode: InvoiceMode;
  invoice: InvoiceView | null;
  options: InvoiceOptions;
  can: InvoiceAbilities;
  presetOrderId?: number | null;
  /** A posted Invoice's standing, from its Invoice AR item (U26). */
  pay?: { state: InvoicePayState; open: number; overdue: boolean } | null;
  /** The receipts that name it. */
  payments?: { id: number; txNo: string; date: string; status: string; settled: number }[];
  /** Its faktur pajak and the bukti potong of its payments (P100). */
  taxDocs?: TaxDocRefs | null;
  /** Each Uang Muka item's faktur uang muka NSFP, from the tax module (P116); absent = no PPN. */
  advanceNsfp?: Record<number, string | null>;
}) {
  const router = useRouter();
  const toast = useToast();
  const editing = mode !== "view";
  const orderById = useMemo(() => new Map(options.orders.map((o) => [o.id, o])), [options.orders]);
  const preset = presetOrderId ? orderById.get(presetOrderId) : undefined;
  const defaultAddress = (o: InvoiceOrderOption | undefined) =>
    o ? (o.addresses.find((a) => a.isBilling)?.id ?? o.addressId) : null;

  const [header, setHeader] = useState<InvoiceHeaderInput>(() =>
    invoice
      ? { ...invoice.header }
      : {
          customer_order_id: preset?.id ?? null,
          invoice_date: todayIso(),
          address_id: defaultAddress(preset),
          cash_bank_id: options.banks.filter((b) => b.active).length === 1 ? options.banks.find((b) => b.active)!.id : null,
          note: "",
        }
  );
  const [lineIds, setLineIds] = useState<number[]>(() =>
    invoice ? invoice.lines.map((l) => Number(l.delivery_note_line_id)) : (preset?.noteLines ?? []).filter((l) => !l.billedBy).map((l) => l.id)
  );
  const [deds, setDeds] = useState<DedState[]>(() =>
    (invoice?.deductions ?? []).map((d) => ({ key: newKey(), ar_item_id: d.ar_item_id, dpp_used: String(d.dpp_used) }))
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [picking, setPicking] = useState<"notes" | "advances" | null>(null);

  const order = header.customer_order_id ? orderById.get(header.customer_order_id) : undefined;
  const noteById = useMemo(() => new Map((order?.noteLines ?? []).map((l) => [l.id, l])), [order]);
  const advanceById = useMemo(() => new Map((order?.advances ?? []).map((a) => [a.id, a])), [order]);
  const orderLineById = useMemo(() => new Map((order?.lines ?? []).map((l) => [l.id, l])), [order]);
  const picked = lineIds.map((id) => noteById.get(id)).filter((l): l is InvoiceNoteLine => Boolean(l));
  const posted = invoice?.status === "Posted";

  const taxDate = editing ? picked.reduce((m, l) => (l.dnDate > m ? l.dnDate : m), "") : (invoice?.taxDate ?? "");
  const dueDate = editing ? (taxDate && order ? addDays(taxDate, order.termDays) : "") : (invoice?.dueDate ?? "");
  const used = deds.reduce((a, d) => a + (Number(d.dpp_used) || 0), 0);

  // The PPN of each Uang Muka used (P113): worked out live while editing, as
  // stored once saved — the same cumulative share the server takes.
  const dedPpn = (d: DedState): number => {
    if (!editing) return invoice?.deductions.find((x) => x.ar_item_id === d.ar_item_id)?.ppn_used ?? 0;
    const a = advanceById.get(d.ar_item_id);
    return a && order?.taxable ? advancePpnUsed({ rates: order.rates, usedBefore: a.original - a.balance, used: Number(d.dpp_used) || 0 }) : 0;
  };
  const advancePpn = deds.reduce((a, d) => a + dedPpn(d), 0);

  // Editing: worked out live. View: as stored — what was saved or posted.
  const figures: InvoiceFigures | null = useMemo(() => {
    if (!order) return null;
    if (editing) {
      return computeInvoice({ lines: pricedLines(order, picked), mode: order.mode, taxable: order.taxable, rates: order.rates, advanceUsed: used, advancePpn });
    }
    const s = invoice!.stored;
    const byLine = new Map(s.lines.map((l) => [l.delivery_note_line_id, l]));
    const withholdings = withholdingsOf(
      picked.map((n) => {
        const o = orderLineById.get(n.customerOrderLineId);
        return { key: o?.withholdingTaxId ? String(o.withholdingTaxId) : null, rate: o?.withholdingRate ?? null, dpp: byLine.get(n.id)?.netDpp ?? 0 };
      })
    );
    const withholdingTotal = withholdings.reduce((a, w) => a + w.amount, 0);
    return {
      lines: picked.map((n) => {
        const l = byLine.get(n.id);
        return {
          gross: l?.gross ?? 0,
          discount: l?.discount ?? 0,
          amount: l?.amount ?? 0,
          dpp: l?.dpp ?? 0,
          advanceDpp: l?.advanceDpp ?? 0,
          netDpp: l?.netDpp ?? 0,
          dppOther: 0,
          ppn: l?.ppn ?? 0,
        };
      }),
      gross: s.gross,
      discount: s.discount,
      amount: s.amount,
      dpp: s.dpp,
      advanceUsed: s.advanceUsed,
      netDpp: s.netDpp,
      dppOther: s.dppOther,
      fullPpn: s.fullPpn,
      advancePpn: s.advancePpn,
      ppn: s.ppn,
      total: s.total,
      withholdings,
      withholdingTotal,
      expectedReceipt: s.total - withholdingTotal,
    };
  }, [order, editing, picked, used, advancePpn, invoice, orderLineById]);

  const touch = (...names: string[]) => {
    setDirty(true);
    setErrors((e) => {
      const next = { ...e };
      for (const n of names) delete next[n];
      return next;
    });
  };
  const set = <K extends keyof InvoiceHeaderInput>(k: K, v: InvoiceHeaderInput[K]) => {
    setHeader((x) => ({ ...x, [k]: v }));
    touch(k);
  };
  const pickOrder = (id: number | null) => {
    const o = id ? orderById.get(id) : undefined;
    setHeader((x) => ({ ...x, customer_order_id: id, address_id: defaultAddress(o) }));
    setLineIds([]);
    setDeds([]);
    touch("customer_order_id", "address_id", "_lines", "_deductions");
  };

  async function onSave() {
    setSaving(true);
    const sentLines = lineIds.map((id) => ({ delivery_note_line_id: id }));
    const sentDeds = deds.map((d) => ({ ar_item_id: d.ar_item_id, dpp_used: d.dpp_used }));
    const result =
      mode === "edit"
        ? await updateInvoiceAction(invoice!.id, header, sentLines, sentDeds)
        : await createInvoiceAction(header, sentLines, sentDeds);
    setSaving(false);
    if (!result.ok) {
      const mapped: Record<string, string> = {};
      for (const [k, v] of Object.entries(result.errors)) {
        const m = /^(lines|deductions)\.(\d+)\.(\w+)$/.exec(k);
        if (m && m[1] === "lines") mapped[`line.${lineIds[Number(m[2])]}`] = v;
        else if (m) mapped[`ded.${deds[Number(m[2])]?.key}`] = v;
        else mapped[k] = v;
      }
      setErrors(mapped);
      toast(
        result.errors._form ? "Tidak diizinkan" : "Belum bisa disimpan",
        result.errors._form ?? result.errors._lines ?? result.errors._deductions ?? "Periksa kembali isian.",
        "err"
      );
      return;
    }
    setDirty(false);
    toast("Invoice disimpan", `${result.invoiceNo} · Draft`, "ok");
    router.push(`/finance/invoice/sales/${result.id}`);
  }

  const status = invoice?.status ?? "Draft";
  const backHref = invoice ? `/finance/invoice/sales/${invoice.id}` : "/finance/invoice/sales";
  const ro = (node: React.ReactNode) => <div className="ro">{node}</div>;
  const nil = (t = "tidak diisi") => <div className="ro nil">{t}</div>;
  const waitOrder = "menunggu Customer Order";
  const address = order?.addresses.find((a) => a.id === header.address_id);
  const bank = options.banks.find((b) => b.id === header.cash_bank_id);

  // ======================================================= header card
  const headerCard = (
    <div className="card">
      <FormBody>
        <FormSection title="Customer Order">
          <FormRow>
            <Field
              label="Customer Order"
              span={4}
              required={mode === "new"}
              locked={mode === "edit"}
              help={mode === "new" ? "yang barangnya sudah dikirim" : undefined}
              error={errors.customer_order_id}
            >
              {mode === "new" ? (
                <Combobox
                  value={header.customer_order_id}
                  options={options.orders.map((o) => ({ id: o.id, label: o.orderNo, name: o.customerName, active: true }))}
                  placeholder="Pilih Customer Order…"
                  emptyText="Belum ada Customer Order dengan Delivery Note yang belum ditagih."
                  invalid={Boolean(errors.customer_order_id)}
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
            <Field label="Customer" span={5}>
              {order ? (
                ro(
                  <>
                    <span className="lab">{order.customerLabel}</span>
                    <span>{order.customerName}</span>
                  </>
                )
              ) : (
                nil(waitOrder)
              )}
            </Field>
            <Field label="No. PO" span={3}>
              {order?.poNo ? ro(<span className="mono">{order.poNo}</span>) : nil(order ? "tidak diisi" : waitOrder)}
            </Field>
          </FormRow>
        </FormSection>
        <FormSection title="Harga & Pajak">
          <FormRow>
            <Field label="Kena PPN" span={4} help={editing ? "dari Customer Order" : undefined}>
              {order ? ro(order.taxable ? "Ya" : "Tidak") : nil(waitOrder)}
            </Field>
            <Field label="Mode Harga" span={4} help={editing ? "dari Customer Order" : undefined}>
              {order ? ro(order.taxable ? MODE_TEXT[order.mode] : "—") : nil(waitOrder)}
            </Field>
            <Field label="Termin" span={4} help={editing ? "dari Customer Order" : undefined}>
              {order ? ro(<span className="lab">{order.termLabel}</span>) : nil(waitOrder)}
            </Field>
          </FormRow>
        </FormSection>
        <FormSection title="Tagihan">
          <FormRow>
            <Field label="Tanggal Invoice" span={4} required={editing} help={editing ? "tanggal journal" : undefined} error={errors.invoice_date}>
              {editing ? (
                <DateInput value={header.invoice_date} invalid={Boolean(errors.invoice_date)} onChange={(v) => set("invoice_date", v)} />
              ) : (
                ro(formatDate(header.invoice_date))
              )}
            </Field>
            <Field label="Tanggal Pajak" span={4} help={editing ? "Tanggal Kirim terakhir" : undefined}>
              {taxDate ? ro(formatDate(taxDate)) : nil("menunggu barang")}
            </Field>
            <Field label="Jatuh Tempo" span={4} help={editing && order ? `Tanggal Pajak + ${order.termLabel}` : undefined}>
              {dueDate ? ro(formatDate(dueDate)) : nil("menunggu barang")}
            </Field>
            <Field label="Alamat Penagihan" span={8} required={editing} error={errors.address_id}>
              {editing ? (
                <Select
                  value={header.address_id ? String(header.address_id) : ""}
                  options={(order?.addresses ?? []).map((a) => ({
                    value: String(a.id),
                    label: a.text,
                    hint: a.isBilling ? "alamat penagihan" : a.id === order?.addressId ? "alamat Customer Order" : undefined,
                  }))}
                  placeholder="Pilih Alamat…"
                  waitingFor={order ? undefined : waitOrder}
                  invalid={Boolean(errors.address_id)}
                  listWidth="wide"
                  onChange={(v) => set("address_id", v ? Number(v) : null)}
                />
              ) : address ? (
                <div className="ro multi">{address.text}</div>
              ) : (
                nil()
              )}
            </Field>
            <Field label="Rekening Pembayaran" span={4} required={editing} help={editing ? "tercetak pada invoice" : undefined} error={errors.cash_bank_id}>
              {editing ? (
                <Combobox
                  value={header.cash_bank_id}
                  options={options.banks}
                  placeholder="Pilih Rekening…"
                  invalid={Boolean(errors.cash_bank_id)}
                  onChange={(v) => set("cash_bank_id", v)}
                />
              ) : bank ? (
                ro(
                  <>
                    <span className="lab">{bank.label}</span>
                    <span>{bank.name}</span>
                  </>
                )
              ) : (
                nil()
              )}
            </Field>
            {!editing && (
              <>
                <Field label="Journal" span={4}>
                  {invoice?.journalId
                    ? ro(
                        <Link className="drl" href={`/accounting/journal/${invoice.journalId}`}>
                          <span className="mono">{invoice.journalNo}</span>
                        </Link>
                      )
                    : nil(posted ? "tidak ada" : "saat posting")}
                </Field>
                <Field label="Faktur Pajak" span={4}>
                  {taxDocs?.fakturs.length
                    ? ro(
                        taxDocs.fakturs.map((f) => (
                          <Fragment key={f.id}>
                            <Link className="drl" href={`/tax/faktur/${f.id}`}>
                              <span className="mono">{f.fakturNo}</span>
                            </Link>
                            <span className="rx">{f.nsfp ? `NSFP ${f.nsfp}` : "NSFP belum diisi"}</span>
                          </Fragment>
                        ))
                      )
                    : invoice?.taxInvoiceNo
                      ? ro(<span className="mono">{invoice.taxInvoiceNo}</span>)
                      : nil(posted ? (order && !order.taxable ? "tidak kena PPN" : "tidak ada") : "saat posting")}
                </Field>
                {posted && pay && (
                  <Field label="Pembayaran" span={12}>
                    {ro(
                      <>
                        <span className={`bdg ${INVOICE_PAY_BADGE[pay.state]}`}>
                          {pay.state === "Partial" ? `Sebagian · sisa ${money(pay.open)}` : INVOICE_PAY_TEXT[pay.state]}
                        </span>
                        {pay.overdue && <span className="bdg t-bad">Lewat jatuh tempo</span>}
                        {payments.map((p) => (
                          <Fragment key={p.id}>
                            <span className="rx">·</span>
                            <Link className="drl" href={`/finance/cash-bank/receipt/${p.id}`}>
                              <span className="mono">{p.txNo}</span>
                            </Link>
                            <span className="rx">{p.status === "Posted" ? money(p.settled) : p.status === "Draft" ? "draft" : "dibatalkan"}</span>
                          </Fragment>
                        ))}
                        {taxDocs?.slips.map((x) => (
                          <Fragment key={`s${x.id}`}>
                            <span className="rx">· Bukti Potong</span>
                            <Link className="drl" href={`/tax/withholding-slip/${x.id}`}>
                              <span className="mono">{x.slipNo}</span>
                            </Link>
                          </Fragment>
                        ))}
                      </>
                    )}
                  </Field>
                )}
              </>
            )}
            <Field label="Catatan" span={12}>
              {editing ? (
                <textarea className="ta" rows={2} value={header.note} placeholder="Catatan pada invoice…" onChange={(e) => set("note", e.target.value)} />
              ) : header.note ? (
                <div className="ro multi">{header.note}</div>
              ) : (
                <div className="ro multi nil">tidak diisi</div>
              )}
            </Field>
          </FormRow>
        </FormSection>
        {invoice?.cancelReason && status === "Cancelled" && (
          <p className="fnote">
            <b>Dibatalkan:</b> {invoice.cancelReason}
          </p>
        )}
      </FormBody>
    </div>
  );

  // ======================================================== lines card
  const pickNotes = (cta?: boolean) => (
    <button className={`btn sm primary${cta ? " cta" : ""}`} onClick={() => setPicking("notes")}>
      <Icon name="truck" size={14} /> Pilih Surat Jalan
    </button>
  );
  const linesCard = (
    <div className="card" style={{ marginTop: 14 }}>
      <div className="card-h">
        <span className="ci">
          <Icon name="box" size={15} />
        </span>
        <div className="ct">
          <h3>Barang Ditagih</h3>
          <p>
            Baris Delivery Note yang sudah diposting, ditagih utuh dengan harga Customer Order
            {order ? ` (${order.taxable ? MODE_TEXT[order.mode] : "tidak kena PPN"})` : ""}.
          </p>
        </div>
        {editing && order && picked.length > 0 && pickNotes()}
      </div>
      {errors._lines && (
        <div className="nbox bad slim">
          <Icon name="warn" size={15} className="ni" />
          <div>
            <b>{errors._lines}</b>
          </div>
        </div>
      )}
      {picked.length === 0 ? (
        <div className="empty sm">
          <div className="ic">
            <Icon name="truck" size={18} />
          </div>
          <h4>{order ? "Belum ada barang" : "Pilih Customer Order dulu…"}</h4>
          <p>{order ? "Pilih baris Delivery Note yang ditagih dengan Invoice ini." : "Invoice hanya menagih barang yang sudah dikirim dengan Delivery Note."}</p>
          {editing && order && pickNotes(true)}
        </div>
      ) : (
        <div className="tw">
          <table className="grid ltab" style={{ minWidth: 960 }}>
            <thead>
              <tr>
                <th style={{ width: 40 }}>No</th>
                <th style={{ width: 150 }}>Delivery Note</th>
                <th>Barang</th>
                <th className="num" style={{ width: 110 }}>
                  Qty
                </th>
                <th className="num" style={{ width: 120 }}>
                  Harga
                </th>
                <th className="num" style={{ width: 120 }}>
                  Diskon
                </th>
                <th className="num" style={{ width: 130 }}>
                  Jumlah
                </th>
                <th className="num" style={{ width: 130 }}>
                  DPP
                </th>
                <th style={{ width: 110 }}>PPh</th>
                {editing && <th style={{ width: 40 }} />}
              </tr>
            </thead>
            <tbody>
              {picked.map((n, i) => {
                const o = orderLineById.get(n.customerOrderLineId);
                const f = figures?.lines[i];
                const err = errors[`line.${n.id}`];
                return (
                  <tr key={n.id} className={err ? "overrow" : undefined}>
                    <td className="no">{i + 1}</td>
                    <td>
                      <span className="dstack">
                        <Link className="lab" href={`/logistics/delivery-note/${n.deliveryNoteId}`}>
                          {n.dnNo}
                        </Link>
                        <span className="d2">{formatDate(n.dnDate)}</span>
                      </span>
                    </td>
                    <td>
                      <span className="idc">
                        <span className="lab">{n.itemLabel}</span>
                        <span className="nm">{n.itemName}</span>
                      </span>
                      {err && <span className="overtag">{err}</span>}
                    </td>
                    <td className="num">
                      <span className="qview">
                        <span className="mny">{qtyText(n.qty)}</span>
                        <span className="lab">{n.uomLabel}</span>
                      </span>
                    </td>
                    <td className="num">
                      <span className="mny">{formatPrice(o?.price ?? 0)}</span>
                      {o?.discountType && (
                        <span className="fulltag">
                          diskon {o.discountType === "Percent" ? formatPct(o.discountValue ?? 0) : `${money(o.discountValue ?? 0)} / ${qtyText(o.qty)}`}
                        </span>
                      )}
                    </td>
                    <td className="num">
                      {f && f.discount > 0 ? <span className="mny">−{money(f.discount)}</span> : <span className="dash">—</span>}
                    </td>
                    <td className="num">
                      <span className="mny">{money(f?.amount ?? 0)}</span>
                    </td>
                    <td className="num">
                      <span className="mny">{money(f?.dpp ?? 0)}</span>
                    </td>
                    <td>{o?.withholdingLabel ? <span className="lab">{o.withholdingLabel}</span> : <span className="dash">Tanpa PPh</span>}</td>
                    {editing && (
                      <td>
                        <button
                          className="iact del"
                          title="Hapus baris"
                          onClick={() => {
                            setLineIds((ls) => ls.filter((x) => x !== n.id));
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
      {picking === "notes" && order && (
        <InvoiceNotePicker
          lines={order.noteLines}
          current={lineIds}
          orderNo={order.orderNo}
          onApply={(ids) => {
            setLineIds(ids);
            touch("_lines");
            setPicking(null);
          }}
          onClose={() => setPicking(null)}
        />
      )}
    </div>
  );

  // ===================================================== Uang Muka card
  const pickAdvances = (cta?: boolean) => (
    <button className={`btn sm${cta ? " cta" : ""}`} onClick={() => setPicking("advances")}>
      <Icon name="wallet" size={14} /> Pilih Uang Muka
    </button>
  );
  const advanceCard = (
    <div className="card" style={{ marginTop: 14 }}>
      <div className="card-h">
        <span className="ci">
          <Icon name="wallet" size={15} />
        </span>
        <div className="ct">
          <h3>Uang Muka Dipakai</h3>
          <p>Uang muka Customer Order ini yang sudah diterima, dipotong dari DPP invoice. Isi DPP yang dipakai dari tiap uang muka.</p>
        </div>
        {editing && order && deds.length > 0 && pickAdvances()}
      </div>
      {errors._deductions && (
        <div className="nbox bad slim">
          <Icon name="warn" size={15} className="ni" />
          <div>
            <b>{errors._deductions}</b>
          </div>
        </div>
      )}
      {deds.length === 0 ? (
        <div className="empty sm">
          <div className="ic">
            <Icon name="wallet" size={18} />
          </div>
          <h4>{editing ? "Tidak ada uang muka dipotong" : "Tanpa uang muka"}</h4>
          <p>
            {!order
              ? "Pilih Customer Order dulu…"
              : order.advances.length
                ? `${order.advances.length} uang muka Customer Order ini masih terbuka.`
                : "Customer Order ini tidak punya uang muka yang terbuka."}
          </p>
          {editing && order && order.advances.length > 0 && pickAdvances(true)}
        </div>
      ) : (
        <div className="tw">
          <table className="grid ltab" style={{ minWidth: 820 }}>
            <thead>
              <tr>
                <th style={{ width: 160 }}>AR Item</th>
                <th>Tagihan · Penerimaan</th>
                <th style={{ width: 150 }}>No. Faktur Pajak</th>
                {/* The item's balance belongs to the AR item: shown while choosing, not on a saved Invoice. */}
                {editing && (
                  <th className="num" style={{ width: 130 }}>
                    Sisa (DPP)
                  </th>
                )}
                <th className={editing ? undefined : "num"} style={{ width: 200 }}>
                  DPP Dipakai
                </th>
                {order?.taxable && (
                  <th className="num" style={{ width: 130 }}>
                    PPN Dipakai
                  </th>
                )}
                {editing && <th style={{ width: 40 }} />}
              </tr>
            </thead>
            <tbody>
              {deds.map((d) => {
                const a = advanceById.get(d.ar_item_id);
                const free = a ? Math.max(0, a.balance - a.reserved) : 0;
                const err = errors[`ded.${d.key}`];
                return (
                  <tr key={d.key} className={err ? "overrow" : undefined}>
                    <td>
                      <span className="lab">{a?.arItemNo}</span>
                      {err && <span className="overtag">{err}</span>}
                    </td>
                    <td>
                      <span className="dstack">
                        <span className="d1">
                          <span className="lab">{a?.sourceNo}</span>
                        </span>
                        <span className="d2">
                          {a?.createdByNo} · {a ? formatDate(a.date) : ""}
                        </span>
                      </span>
                    </td>
                    <td>
                      {a && advanceNsfp[a.id] ? (
                        <span className="mono">{advanceNsfp[a.id]}</span>
                      ) : (
                        // An advance without PPN has no faktur pajak at all.
                        <span className="dash">{!order?.taxable ? "tidak kena PPN" : "belum diisi"}</span>
                      )}
                    </td>
                    {editing && (
                      <td className="num">
                        <span className="mny">{money(free)}</span>
                      </td>
                    )}
                    <td className={editing ? undefined : "num"}>
                      {editing ? (
                        <>
                          <MoneyInput
                            size="sm"
                            value={d.dpp_used}
                            over={Number(d.dpp_used) > free}
                            ariaLabel={`DPP dipakai ${a?.arItemNo ?? ""}`}
                            onChange={(v) => {
                              setDeds((ds) => ds.map((x) => (x.key === d.key ? { ...x, dpp_used: v } : x)));
                              touch(`ded.${d.key}`, "_deductions");
                            }}
                          />
                          <span className="fulltag">maks. {money(free)}</span>
                        </>
                      ) : (
                        <span className="mny">{money(Number(d.dpp_used))}</span>
                      )}
                    </td>
                    {order?.taxable && (
                      <td className="num">
                        <span className="mny">{money(dedPpn(d))}</span>
                      </td>
                    )}
                    {editing && (
                      <td>
                        <button
                          className="iact del"
                          title="Hapus uang muka"
                          onClick={() => {
                            setDeds((ds) => ds.filter((x) => x.key !== d.key));
                            touch("_deductions");
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
      {picking === "advances" && order && (
        <InvoiceAdvancePicker
          advances={order.advances}
          taxable={order.taxable}
          nsfp={advanceNsfp}
          current={deds.map((d) => d.ar_item_id)}
          orderNo={order.orderNo}
          onApply={(ids) => {
            setDeds((ds) => ids.map((id) => ds.find((d) => d.ar_item_id === id) ?? { key: newKey(), ar_item_id: id, dpp_used: "" }));
            touch("_deductions");
            setPicking(null);
          }}
          onClose={() => setPicking(null)}
        />
      )}

      {/* ---- the figures */}
      {order && figures && (
        <div className="cardfoot multi">
          {figures.withholdingTotal > 0 && (
            <div className="impact">
              <div className="ttl">Estimasi Penerimaan</div>
              <div className="ir">
                <span>Total Tagihan</span>
                <b>{money(figures.total)}</b>
              </div>
              {figures.withholdings.map((w) => (
                <div className="ir" key={w.key}>
                  <span>
                    {order.lines.find((l) => String(l.withholdingTaxId) === w.key)?.withholdingLabel ?? "PPh"} {formatPct(w.rate)} × DPP {money(w.base)}
                  </span>
                  <b>−{money(w.amount)}</b>
                </div>
              ))}
              <div className="ir tot">
                <span>Estimasi dana diterima</span>
                <b>{money(figures.expectedReceipt)}</b>
              </div>
            </div>
          )}
          <div className="impact">
            <div className="ttl">Nilai Invoice · {order.taxable ? MODE_TEXT[order.mode] : "Tidak Kena PPN"}</div>
            {figures.discount > 0 && (
              <>
                <div className="ir">
                  <span>Jumlah bruto</span>
                  <b>{money(figures.gross)}</b>
                </div>
                <div className="ir">
                  <span>Diskon</span>
                  <b>−{money(figures.discount)}</b>
                </div>
              </>
            )}
            <div className="ir">
              <span>DPP barang ditagih</span>
              <b>{money(figures.dpp)}</b>
            </div>
            {/* An Invoice posted before P113 used Uang Muka without deducting its PPN:
                its PPN was the chain on the net DPP, shown after the deduction. */}
            {order.taxable && !(figures.advanceUsed > 0 && figures.advancePpn === 0) ? (
              <>
                {editing && (
                  <div className="ir">
                    <span>
                      DPP Nilai Lain ({order.rates ? `${order.rates.otherNum}/${order.rates.otherDen}` : "—"}, per baris)
                    </span>
                    <b>{money(figures.dppOther)}</b>
                  </div>
                )}
                <div className="ir">
                  <span>PPN {order.rates ? formatPct(order.rates.rate) : "—"} × DPP Nilai Lain</span>
                  <b>{money(figures.fullPpn)}</b>
                </div>
              </>
            ) : null}
            {/* Full less the advance (P113): the Uang Muka's DPP and its PPN, deducted once. */}
            {figures.advanceUsed > 0 && (
              <>
                <div className="ir">
                  <span>Uang Muka Dipakai (DPP)</span>
                  <b>−{money(figures.advanceUsed)}</b>
                </div>
                {order.taxable && figures.advancePpn > 0 && (
                  <div className="ir">
                    <span>PPN Uang Muka</span>
                    <b>−{money(figures.advancePpn)}</b>
                  </div>
                )}
                <div className="ir">
                  <span>DPP setelah Uang Muka</span>
                  <b>{money(figures.netDpp)}</b>
                </div>
                {order.taxable && figures.advancePpn > 0 && (
                  <div className="ir">
                    <span>PPN setelah Uang Muka</span>
                    <b>{money(figures.ppn)}</b>
                  </div>
                )}
                {order.taxable && figures.advancePpn === 0 && (
                  <div className="ir">
                    <span>PPN {order.rates ? formatPct(order.rates.rate) : "—"} × DPP Nilai Lain</span>
                    <b>{money(figures.ppn)}</b>
                  </div>
                )}
              </>
            )}
            {order.taxable ? null : (
              <div className="ir">
                <span>PPN</span>
                <b>Tidak Kena PPN</b>
              </div>
            )}
            <div className="ir tot">
              <span>Total Tagihan</span>
              <b>{money(figures.total)}</b>
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
          <Link href="/finance/invoice/sales">Invoice Penjualan</Link>
          <span>/</span>
          <span className="cur">{invoice ? invoice.invoiceNo : "Baru"}</span>
        </div>
        <div className="ph-row">
          <h1>
            <span className="ph-ico">
              <Icon name="file" size={16} />
            </span>
            {invoice ? (
              <>
                <span className="docno">{invoice.invoiceNo}</span>
                <span className={`bdg ${INVOICE_STATUS_BADGE[status]}`}>{INVOICE_STATUS_TEXT[status]}</span>
              </>
            ) : (
              "Invoice Penjualan Baru"
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
              <InvoiceActions id={invoice!.id} subject={invoice!.invoiceNo} status={status} can={can} />
            )}
          </div>
        </div>
      </div>

      <div className="fgrid solo">
        <div>
          {headerCard}
          {linesCard}
          {advanceCard}
        </div>
      </div>
    </>
  );
}
