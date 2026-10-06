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
import { useToast } from "@/components/ui/toast";
import { PurchaseInvoiceActions } from "@/components/finance/purchase-invoice-actions";
import { PurchaseInvoicePicker } from "@/components/finance/purchase-invoice-pickers";
import { createPurchaseInvoiceAction, updatePurchaseInvoiceAction } from "@/app/actions/ap-invoice";
import { advancePpnUsed } from "@/lib/erp/sales-tax";
import { INVOICE_STATUS_BADGE, INVOICE_STATUS_TEXT, computePurchaseInvoice, type InvoiceAbilities } from "@/lib/erp/ap-invoice-workflow";
import type { PiAdvance, PiReceiptLine, PurchaseInvoiceHeaderInput, PurchaseInvoiceOptions, PurchaseInvoiceView } from "@/lib/erp/ap-invoice";
import { formatDate, formatMoney, formatNumber, formatPct, formatPrice, todayIso } from "@/lib/format";

/**
 * An Invoice Pembelian in all three modes (P128, B28–B31): the Purchase Order
 * first — chosen once and locked — then the supplier's document (number, date,
 * faktur pajak), then the lines picked from its posted Receipt Notes, always at
 * the PO price (B29a), then the Uang Muka used. At the foot the supplier's
 * total is typed and compared with ours against the tolerance (B29b). Every
 * figure is `computePurchaseInvoice`, which Posting books from.
 */

const money = (n: number) => formatMoney(n, "IDR");
const qtyText = (n: number) => formatNumber(n, n % 1 ? 2 : 0);
type Ded = { ap_item_id: number; dpp_used: string };

export function PurchaseInvoiceForm({
  mode,
  invoice,
  options,
  can,
}: {
  mode: "new" | "edit" | "view";
  invoice: PurchaseInvoiceView | null;
  options: PurchaseInvoiceOptions;
  can: InvoiceAbilities;
}) {
  const router = useRouter();
  const toast = useToast();
  const editing = mode !== "view";
  const today = todayIso();
  const [h, setH] = useState<PurchaseInvoiceHeaderInput>(() =>
    invoice
      ? { ...invoice.header }
      : { purchase_order_id: null, invoice_date: today, supplier_invoice_no: "", supplier_invoice_date: today, supplier_tax_invoice_no: "", supplier_total: null, note: "" }
  );
  const [lineIds, setLineIds] = useState<number[]>(() => (invoice?.lines ?? []).map((l) => Number(l.receipt_note_line_id)));
  const [deds, setDeds] = useState<Ded[]>(() => (invoice?.deductions ?? []).map((d) => ({ ap_item_id: d.ap_item_id, dpp_used: String(d.dpp_used) })));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [picker, setPicker] = useState<"lines" | "advances" | null>(null);

  const order = options.orders.find((o) => o.id === h.purchase_order_id) ?? null;
  const lineById = useMemo(() => new Map((order?.receiptLines ?? []).map((l) => [l.id, l])), [order]);
  const advById = useMemo(() => new Map((order?.advances ?? []).map((a) => [a.id, a])), [order]);
  const poLine = useMemo(() => new Map((order?.lines ?? []).map((l) => [l.id, l])), [order]);
  const touch = (...names: string[]) => {
    setDirty(true);
    setErrors((e) => {
      const next = { ...e };
      for (const n of names) delete next[n];
      return next;
    });
  };
  const set = <K extends keyof PurchaseInvoiceHeaderInput>(k: K, v: PurchaseInvoiceHeaderInput[K]) => {
    setH((x) => ({ ...x, [k]: v }));
    touch(k);
  };

  const picked = lineIds.map((id) => lineById.get(id)).filter((l): l is PiReceiptLine => Boolean(l));
  const usedDeds = deds
    .map((d) => {
      const a = advById.get(d.ap_item_id);
      const used = Number(d.dpp_used) || 0;
      return a ? { a, used, ppn: order?.taxable ? advancePpnUsed({ rates: order.rates, usedBefore: a.original - a.balance, used }) : 0 } : null;
    })
    .filter((x): x is { a: PiAdvance; used: number; ppn: number } => Boolean(x));
  const supplierTotal = h.supplier_total === null || String(h.supplier_total).trim() === "" ? null : Number(h.supplier_total);
  const f = computePurchaseInvoice({
    lines: picked.map((l) => {
      const p = poLine.get(l.purchaseOrderLineId);
      return { dpp: l.value, withholdingRate: p?.withholdingRate ?? null, withholdingKey: p?.withholdingTaxId ? String(p.withholdingTaxId) : null };
    }),
    taxable: order?.taxable ?? false,
    rates: order?.rates ?? null,
    advanceUsed: usedDeds.reduce((s, d) => s + d.used, 0),
    advancePpn: usedDeds.reduce((s, d) => s + d.ppn, 0),
    supplierTotal,
    tolerance: options.tolerance,
  });
  const whtLabel = (key: string) => order?.lines.find((l) => String(l.withholdingTaxId) === key)?.withholdingLabel ?? "PPh";

  async function onSave() {
    setSaving(true);
    const lines = lineIds.map((id) => ({ receipt_note_line_id: id }));
    const d = deds.map((x) => ({ ap_item_id: x.ap_item_id, dpp_used: x.dpp_used }));
    const result = mode === "edit" ? await updatePurchaseInvoiceAction(invoice!.id, h, lines, d) : await createPurchaseInvoiceAction(h, lines, d);
    setSaving(false);
    if (!result.ok) {
      setErrors(result.errors);
      toast(result.errors._form ? "Tidak diizinkan" : "Belum bisa disimpan", result.errors._form ?? result.errors._lines ?? result.errors._deductions ?? "Periksa kembali isian.", "err");
      return;
    }
    setDirty(false);
    toast("Invoice Pembelian disimpan", `${result.invoiceNo} · Draft`, "ok");
    router.push(`/finance/invoice/purchase/${result.id}`);
  }

  const status = invoice?.status ?? "Draft";
  const ro = (n: React.ReactNode) => <div className="ro">{n}</div>;
  const nil = (t = "tidak diisi") => <div className="ro nil">{t}</div>;
  const orderOptions = options.orders.map((o) => ({ id: o.id, label: o.orderNo, name: `${o.supplierLabel} · ${o.supplierName}`, active: true }));
  const poPath = order ? `${order.itemType === "Jasa" ? "/purchasing/order/service" : "/purchasing/order/goods"}/${order.id}` : "#";

  const headerCard = (
    <div className="card">
      <FormBody>
        <FormSection title="Purchase Order">
          <FormRow>
            <Field label="Purchase Order" span={4} required={mode === "new"} error={errors.purchase_order_id}>
              {mode === "new" ? (
                <Combobox
                  value={h.purchase_order_id}
                  options={orderOptions}
                  placeholder="Pilih Purchase Order…"
                  emptyText="Belum ada Purchase Order dengan Receipt Note yang belum ditagih"
                  invalid={Boolean(errors.purchase_order_id)}
                  onChange={(v) => {
                    setH((x) => ({ ...x, purchase_order_id: v }));
                    setLineIds([]);
                    setDeds([]);
                    touch("purchase_order_id", "_lines", "_deductions");
                  }}
                />
              ) : (
                ro(
                  <Link className="drl" href={poPath}>
                    <span className="mono">{order?.orderNo}</span>
                  </Link>
                )
              )}
            </Field>
            <Field label="Supplier" span={5}>
              {order ? ro(<><span className="lab">{order.supplierLabel}</span><span>{order.supplierName}</span></>) : nil("menunggu Purchase Order")}
            </Field>
            <Field label="Termin" span={3}>
              {order ? ro(<span>{order.termLabel} · {order.termDays} hari</span>) : nil("—")}
            </Field>
          </FormRow>
        </FormSection>
        <FormSection title="Invoice Supplier">
          <FormRow>
            <Field label="No. Invoice Supplier" span={3} required={editing} error={errors.supplier_invoice_no}>
              {editing ? (
                <input className={`inp idf${errors.supplier_invoice_no ? " bad" : ""}`} value={h.supplier_invoice_no} autoComplete="off" onChange={(e) => set("supplier_invoice_no", e.target.value)} />
              ) : (
                ro(<span className="mono">{h.supplier_invoice_no}</span>)
              )}
            </Field>
            <Field label="Tanggal Invoice Supplier" span={3} required={editing} help={editing ? "jatuh tempo dihitung dari tanggal ini" : undefined} error={errors.supplier_invoice_date}>
              {editing ? <DateInput value={h.supplier_invoice_date} invalid={Boolean(errors.supplier_invoice_date)} onChange={(v) => set("supplier_invoice_date", v)} /> : ro(formatDate(h.supplier_invoice_date))}
            </Field>
            <Field label="No. Faktur Pajak Supplier" span={3} help={editing ? "opsional" : undefined}>
              {editing ? (
                <input className="inp idf" value={h.supplier_tax_invoice_no} autoComplete="off" onChange={(e) => set("supplier_tax_invoice_no", e.target.value)} />
              ) : h.supplier_tax_invoice_no ? (
                ro(<span className="mono">{h.supplier_tax_invoice_no}</span>)
              ) : (
                nil()
              )}
            </Field>
            <Field label="Tanggal" span={3} required={editing} help={editing ? "tanggal journal" : undefined} error={errors.invoice_date}>
              {editing ? <DateInput value={h.invoice_date} invalid={Boolean(errors.invoice_date)} onChange={(v) => set("invoice_date", v)} /> : ro(formatDate(h.invoice_date))}
            </Field>
            {invoice && (
              <Field label="Jatuh Tempo" span={3}>
                {ro(formatDate(invoice.dueDate))}
              </Field>
            )}
            {invoice?.journalNo && (
              <Field label="Journal" span={3}>
                {ro(
                  <Link className="drl" href={`/accounting/journal/${invoice.journalId}`}>
                    <span className="mono">{invoice.journalNo}</span>
                  </Link>
                )}
              </Field>
            )}
            <Field label="Catatan" span={12}>
              {editing ? (
                <textarea className="ta" rows={2} value={h.note} placeholder="Keterangan tambahan (opsional)…" onChange={(e) => set("note", e.target.value)} />
              ) : h.note ? (
                <div className="ro multi">{h.note}</div>
              ) : (
                <div className="ro multi nil">tidak diisi</div>
              )}
            </Field>
          </FormRow>
        </FormSection>
        {invoice?.cancelReason && (
          <p className="fnote">
            <b>Dibatalkan:</b> {invoice.cancelReason}
          </p>
        )}
      </FormBody>
    </div>
  );

  const err = (k: string) => errors[k] && (
    <div className="nbox bad slim">
      <Icon name="warn" size={15} className="ni" />
      <div>
        <b>{errors[k]}</b>
      </div>
    </div>
  );

  const linesCard = (
    <div className="card" style={{ marginTop: 14 }}>
      <div className="card-h">
        <span className="ci">
          <Icon name="box" size={15} />
        </span>
        <div className="ct">
          <h3>Ditagih</h3>
          <p>Baris Receipt Note yang diposting, utuh, pada harga Purchase Order. DPP-nya adalah nilai penerimaannya.</p>
        </div>
        {editing && order && (
          <button className="btn sm primary" onClick={() => setPicker("lines")}>
            <Icon name="plus" size={14} /> Pilih Receipt Note
          </button>
        )}
      </div>
      {err("_lines")}
      {picked.length === 0 ? (
        <div className="empty sm">
          <h4>Belum ada baris</h4>
          <p>{order ? "Pilih baris Receipt Note yang ditagih supplier." : "Pilih Purchase Order dulu…"}</p>
        </div>
      ) : (
        <div className="tw">
          <table className="grid ltab" style={{ minWidth: 860 }}>
            <thead>
              <tr>
                <th style={{ width: 150 }}>Receipt Note</th>
                <th>Barang / Jasa</th>
                <th className="num" style={{ width: 120 }}>Qty</th>
                <th className="num" style={{ width: 130 }}>Harga PO</th>
                <th style={{ width: 110 }}>Jenis PPh</th>
                <th className="num" style={{ width: 140 }}>DPP</th>
                {editing && <th style={{ width: 40 }} />}
              </tr>
            </thead>
            <tbody>
              {picked.map((l, i) => (
                <tr key={l.id} className={errors[`lines.${i}.receipt_note_line_id`] ? "overrow" : undefined}>
                  <td>
                    <Link className="drl" href={`/logistics/receipt-note/${l.receiptNoteId}`}>
                      <span className="mono">{l.rnNo}</span>
                    </Link>
                    <span className="fulltag">{formatDate(l.rnDate)}</span>
                  </td>
                  <td>
                    <span className="idc">
                      <span className="lab">{l.itemLabel}</span>
                      <span className="nm">{l.itemName}</span>
                    </span>
                    {errors[`lines.${i}.receipt_note_line_id`] && <span className="overtag">{errors[`lines.${i}.receipt_note_line_id`]}</span>}
                  </td>
                  <td className="num">
                    <span className="mny">
                      {qtyText(l.qty)} {l.uomLabel}
                    </span>
                  </td>
                  <td className="num">
                    <span className="mny">{formatPrice(l.price)}</span>
                  </td>
                  <td>{l.withholdingLabel ? <span className="lab">{l.withholdingLabel}</span> : <span className="dash">—</span>}</td>
                  <td className="num">
                    <span className="mny">{money(l.value)}</span>
                  </td>
                  {editing && (
                    <td>
                      <button className="iact del" title="Hapus baris" onClick={() => { setLineIds((x) => x.filter((id) => id !== l.id)); touch("_lines"); }}>
                        <Icon name="trash" size={14} />
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );

  const advancesCard = (order?.advances.length || deds.length) ? (
    <div className="card" style={{ marginTop: 14 }}>
      <div className="card-h">
        <span className="ci">
          <Icon name="wallet" size={15} />
        </span>
        <div className="ct">
          <h3>Uang Muka Dipakai</h3>
          <p>Uang muka Purchase Order ini yang sudah dibayar. DPP dipakai diketik; PPN-nya dihitung ulang dan dikurangkan sekali.</p>
        </div>
        {editing && order && (
          <button className="btn sm" onClick={() => setPicker("advances")}>
            <Icon name="plus" size={14} /> Pilih Uang Muka
          </button>
        )}
      </div>
      {err("_deductions")}
      {usedDeds.length === 0 ? (
        <div className="empty sm">
          <p>Tidak ada uang muka dipakai.</p>
        </div>
      ) : (
        <div className="tw">
          <table className="grid ltab">
            <thead>
              <tr>
                <th>Uang Muka</th>
                <th className="num" style={{ width: 150 }}>Sisa</th>
                <th className="num" style={{ width: 170 }}>DPP Dipakai</th>
                <th className="num" style={{ width: 130 }}>PPN-nya</th>
                {editing && <th style={{ width: 40 }} />}
              </tr>
            </thead>
            <tbody>
              {usedDeds.map(({ a, ppn }, i) => (
                <tr key={a.id}>
                  <td>
                    <span className="mono">{a.apItemNo}</span> <span className="fulltag">{a.sourceNo} · {a.createdByNo}</span>
                    {errors[`deductions.${i}.ap_item_id`] && <span className="overtag">{errors[`deductions.${i}.ap_item_id`]}</span>}
                  </td>
                  <td className="num">
                    <span className="mny">{money(Math.max(0, a.balance - a.reserved))}</span>
                  </td>
                  <td className="num">
                    {editing ? (
                      <MoneyInput
                        size="sm"
                        value={deds[i].dpp_used}
                        ariaLabel={`DPP dipakai ${a.apItemNo}`}
                        onChange={(v) => {
                          setDeds((x) => x.map((d) => (d.ap_item_id === a.id ? { ...d, dpp_used: v } : d)));
                          touch("_deductions");
                        }}
                      />
                    ) : (
                      <span className="mny">{money(Number(deds[i].dpp_used))}</span>
                    )}
                    {errors[`deductions.${i}.dpp_used`] && <span className="overtag">{errors[`deductions.${i}.dpp_used`]}</span>}
                  </td>
                  <td className="num">
                    <span className="mny">{money(ppn)}</span>
                  </td>
                  {editing && (
                    <td>
                      <button className="iact del" title="Hapus" onClick={() => setDeds((x) => x.filter((d) => d.ap_item_id !== a.id))}>
                        <Icon name="trash" size={14} />
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  ) : null;

  const shown = mode === "view" && invoice ? { ...f, ...invoice.stored, fullPpn: invoice.stored.ppn + invoice.stored.advancePpn } : f;
  const figuresCard = (
    <div className="card" style={{ marginTop: 14 }}>
      <div className="cardfoot multi">
        <div className="impact">
          <div className="ttl">Tagihan Supplier</div>
          <div className="ir">
            <span>Total invoice kita (sebelum PPh)</span>
            <b>{money(shown.total)}</b>
          </div>
          <div className="ir">
            <span>Total tagihan supplier</span>
            {editing ? (
              <span style={{ width: 180 }}>
                <MoneyInput size="sm" value={h.supplier_total == null ? "" : String(h.supplier_total)} ariaLabel="Total tagihan supplier" onChange={(v) => set("supplier_total", v === "" ? null : v)} />
              </span>
            ) : (
              <b>{invoice?.header.supplier_total != null ? money(Number(invoice.header.supplier_total)) : "tidak dibandingkan"}</b>
            )}
          </div>
          {(supplierTotal !== null || shown.difference !== 0) && (
            <div className={`ir ${f.withinTolerance || mode === "view" ? "" : "est"}`}>
              <span>Selisih (toleransi {money(options.tolerance)})</span>
              <b>
                {money(shown.difference)} {mode !== "view" && !f.withinTolerance && <span className="bdg t-bad">melebihi toleransi</span>}
              </b>
            </div>
          )}
          {errors.supplier_total && <p className="fnote">{errors.supplier_total}</p>}
          {f.withholdings.map((w) => (
            <div className="ir" key={w.key}>
              <span>
                {whtLabel(w.key)} {formatPct(w.rate)} × DPP {money(w.base)} — kita potong
              </span>
              <b>−{money(w.amount)}</b>
            </div>
          ))}
          <div className="ir tot">
            <span>Hutang dibayar ke supplier</span>
            <b>{money(shown.total + shown.difference - shown.pph)}</b>
          </div>
        </div>
        <div className="impact">
          <div className="ttl">Nilai Invoice · {order?.taxable ? "Kena PPN" : "Tidak Kena PPN"}</div>
          <div className="ir">
            <span>DPP</span>
            <b>{money(shown.dpp)}</b>
          </div>
          {shown.advanceUsed > 0 && (
            <div className="ir">
              <span>Uang muka dipakai (DPP)</span>
              <b>−{money(shown.advanceUsed)}</b>
            </div>
          )}
          {order?.taxable && (
            <>
              <div className="ir">
                <span>PPN {order.rates ? formatPct(order.rates.rate) : ""} atas DPP penuh</span>
                <b>{money(shown.fullPpn)}</b>
              </div>
              {shown.advancePpn > 0 && (
                <div className="ir">
                  <span>PPN uang muka</span>
                  <b>−{money(shown.advancePpn)}</b>
                </div>
              )}
            </>
          )}
          <div className="ir tot">
            <span>Total Invoice</span>
            <b>{money(shown.total)}</b>
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <>
      <div className="ph">
        <div className="crumb">
          <span>Finance</span>
          <span>/</span>
          <Link href="/finance/invoice/purchase">Invoice Pembelian</Link>
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
              "Invoice Pembelian Baru"
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
                <CancelButton href={invoice ? `/finance/invoice/purchase/${invoice.id}` : "/finance/invoice/purchase"} dirty={dirty} disabled={saving} />
                <button className="btn primary" onClick={onSave} disabled={saving}>
                  <Icon name="save" size={15} /> {saving ? "Menyimpan…" : "Simpan"}
                </button>
              </>
            ) : (
              <PurchaseInvoiceActions id={invoice!.id} subject={`${invoice!.invoiceNo} – ${money(invoice!.stored.total)}`} status={status} can={can} />
            )}
          </div>
        </div>
      </div>
      <div className="fgrid solo">
        <div>
          {headerCard}
          {linesCard}
          {advancesCard}
          {figuresCard}
        </div>
      </div>
      {picker && order && (
        <PurchaseInvoicePicker
          kind={picker}
          lines={order.receiptLines}
          advances={order.advances}
          currentLines={lineIds}
          currentAdvances={deds.map((d) => d.ap_item_id)}
          onClose={() => setPicker(null)}
          onApply={(ids) => {
            if (picker === "lines") {
              setLineIds(ids);
              touch("_lines");
            } else {
              setDeds((x) => ids.map((id) => x.find((d) => d.ap_item_id === id) ?? { ap_item_id: id, dpp_used: String(Math.max(0, (advById.get(id)?.balance ?? 0) - (advById.get(id)?.reserved ?? 0))) }));
              touch("_deductions");
            }
            setPicker(null);
          }}
        />
      )}
    </>
  );
}
