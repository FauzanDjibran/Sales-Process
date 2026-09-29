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
import { SalesOrderActions } from "@/components/sales/sales-order-actions";
import { ItemPicker } from "@/components/sales/item-picker";
import { createSalesOrderAction, updateSalesOrderAction } from "@/app/actions/sales-order";
import { computeSalesTotals, type DiscountType, type PriceMode } from "@/lib/erp/sales-tax";
import {
  SALES_ORDER_STATUS_BADGE,
  SALES_ORDER_STATUS_TEXT,
  type SalesOrderAbilities,
} from "@/lib/erp/sales-order-workflow";
import type {
  SalesOrderLineInput,
  SalesOrderOptions,
  SalesOrderView,
  SoCustomerOption,
} from "@/lib/erp/sales-order";
import { formatTaxId } from "@/lib/erp/partner-shape";
import { formatDate, formatMoney, formatNumber, formatPct, todayIso } from "@/lib/format";

/**
 * The Sales Order, in all three modes: `new` (also a Salin), `edit` (Draft
 * only) and `view`.
 *
 * Built the way the simulation's SO screen reads: the customer first — its
 * Termin and mode harga fill in from it (P51) — then the order, then the lines.
 * Every figure is `computeSalesTotals`, the module the Server Action stores
 * from, so the impact box shows exactly what saving will write.
 *
 * A document is a header card and a lines card (design convention §8.1); with
 * one collection there are no tabs (P38).
 */

export type SoMode = "new" | "edit" | "view";

type LineState = {
  key: string;
  item_id: number;
  uom_id: number;
  qty: string;
  price: string;
  discount_type: DiscountType | null;
  discount_value: string;
  withholding_tax_id: number | null;
  note: string;
};

type HeaderState = {
  order_date: string;
  customer_id: number | null;
  address_id: number | null;
  term_id: number | null;
  warehouse_id: number | null;
  price_mode: PriceMode;
  is_taxable: boolean;
  po_no: string;
  po_date: string;
  requested_date: string;
  salesperson: string;
  note: string;
};

let seq = 0;
const newKey = () => `l${Date.now().toString(36)}${seq++}`;
const MODE_TEXT: Record<PriceMode, string> = { Exclude: "Exclude PPN", Include: "Include PPN" };
const money = (n: number) => formatMoney(n, "IDR");

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function SalesOrderForm({
  mode,
  order,
  options,
  can,
  copyFrom,
}: {
  mode: SoMode;
  order: SalesOrderView | null;
  options: SalesOrderOptions;
  can: SalesOrderAbilities;
  /** Salin: the order the new draft starts from. */
  copyFrom?: SalesOrderView | null;
}) {
  const router = useRouter();
  const toast = useToast();
  const editing = mode !== "view";
  const source = order ?? copyFrom ?? null;

  const [header, setHeader] = useState<HeaderState>(() => {
    if (source) {
      const h = source.header;
      const today = todayIso();
      return {
        // A copy is a new order dated today, without the customer's PO (the
        // simulation's Salin).
        order_date: copyFrom ? today : h.order_date,
        customer_id: Number(h.customer_id),
        address_id: Number(h.address_id),
        term_id: Number(h.term_id),
        warehouse_id: Number(h.warehouse_id),
        price_mode: h.price_mode as PriceMode,
        is_taxable: h.is_taxable,
        po_no: copyFrom ? "" : h.po_no,
        po_date: copyFrom ? "" : h.po_date,
        requested_date: copyFrom ? addDays(today, 3) : h.requested_date,
        salesperson: h.salesperson,
        note: h.note,
      };
    }
    const today = todayIso();
    return {
      order_date: today,
      customer_id: null,
      address_id: null,
      term_id: null,
      warehouse_id: null,
      price_mode: "Exclude",
      is_taxable: true,
      po_no: "",
      po_date: "",
      requested_date: addDays(today, 3),
      salesperson: "",
      note: "",
    };
  });

  const [lines, setLines] = useState<LineState[]>(() =>
    (source?.lines ?? []).map((l) => ({
      key: newKey(),
      item_id: Number(l.item_id),
      uom_id: Number(l.uom_id),
      qty: String(l.qty),
      price: String(l.price),
      discount_type: (l.discount_type as DiscountType | null) ?? null,
      discount_value: l.discount_value == null ? "" : String(l.discount_value),
      withholding_tax_id: l.withholding_tax_id ? Number(l.withholding_tax_id) : null,
      note: l.note ?? "",
    }))
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(Boolean(copyFrom));
  const [saving, setSaving] = useState(false);
  const [picking, setPicking] = useState(false);

  const customer = options.customers.find((c) => c.id === header.customer_id) ?? null;
  const itemById = useMemo(() => new Map(options.items.map((i) => [i.id, i])), [options.items]);
  const whtById = useMemo(
    () => new Map(options.withholdingTaxes.map((t) => [t.id, t])),
    [options.withholdingTaxes]
  );

  /** The Jenis PPh a line starts on for this customer (P52). */
  const defaultWht = (c: SoCustomerOption | null) =>
    c?.collectsPph22 && options.pph22DefaultId ? options.pph22DefaultId : null;

  const touch = (...names: string[]) => {
    setDirty(true);
    setErrors((e) => {
      const next = { ...e };
      for (const n of names) delete next[n];
      return next;
    });
  };

  const set = <K extends keyof HeaderState>(k: K, v: HeaderState[K]) => {
    setHeader((h) => ({ ...h, [k]: v }));
    touch(k);
  };

  /** Choosing a customer fills what depends on it (the simulation's applyCustomer). */
  const pickCustomer = (id: number | null) => {
    const c = options.customers.find((x) => x.id === id) ?? null;
    setHeader((h) => ({
      ...h,
      customer_id: id,
      address_id: c?.addresses[0]?.id ?? null,
      term_id: c?.defaultTermId ?? h.term_id,
      price_mode: c?.defaultPriceMode ?? h.price_mode,
    }));
    setLines((ls) => ls.map((l) => ({ ...l, withholding_tax_id: defaultWht(c) })));
    touch("customer_id", "address_id", "term_id", "price_mode");
  };

  const setLine = (key: string, patch: Partial<LineState>) => {
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
    touch("_lines");
  };

  const addItems = (ids: number[]) => {
    setLines((ls) => [
      ...ls,
      ...ids.map((id) => ({
        key: newKey(),
        item_id: id,
        uom_id: itemById.get(id)!.uoms[0].id,
        qty: "1",
        price: "",
        discount_type: null,
        discount_value: "",
        withholding_tax_id: defaultWht(customer),
        note: "",
      })),
    ]);
    touch("_lines");
    setPicking(false);
  };

  // ---- the figures, exactly as the server will store them. A stored order
  // shows the rate it carries; one being edited previews the rate in force,
  // which its save will snapshot (P60).
  const rates = mode === "view" ? (order?.rates ?? null) : options.ppnRates;
  const totals = useMemo(
    () =>
      computeSalesTotals({
        lines: lines.map((l) => {
          const t = l.withholding_tax_id ? whtById.get(l.withholding_tax_id) : null;
          return {
            qty: Number(l.qty) || 0,
            price: Number(l.price) || 0,
            discountType: l.discount_type,
            discountValue: l.discount_type ? Number(l.discount_value) || 0 : null,
            withholdingRate: t?.rate ?? null,
            withholdingKey: t ? String(t.id) : null,
          };
        }),
        mode: header.price_mode,
        taxable: header.is_taxable,
        vatCollector: customer?.vatCollector ?? false,
        rates,
      }),
    [lines, header.price_mode, header.is_taxable, customer, whtById, rates]
  );

  const payloadLines = (): SalesOrderLineInput[] =>
    lines.map((l) => ({
      item_id: l.item_id,
      uom_id: l.uom_id,
      qty: Number(l.qty) || 0,
      price: Number(l.price) || 0,
      discount_type: l.discount_type,
      discount_value: l.discount_type ? Number(l.discount_value) || 0 : null,
      withholding_tax_id: l.withholding_tax_id,
      note: l.note,
    }));

  async function onSave() {
    setSaving(true);
    const result =
      mode === "edit"
        ? await updateSalesOrderAction(order!.id, header, payloadLines())
        : await createSalesOrderAction(header, payloadLines(), copyFrom?.id ?? null);
    setSaving(false);
    if (!result.ok) {
      setErrors(result.errors);
      const n = Object.keys(result.errors).filter((k) => !k.startsWith("_") && !k.startsWith("lines.")).length;
      toast(
        result.errors._form ? "Tidak diizinkan" : "Belum bisa disimpan",
        result.errors._form ?? (n ? `${n} field perlu diperbaiki.` : result.errors._lines ?? "Periksa kembali isian."),
        "err"
      );
      return;
    }
    setDirty(false);
    toast("Sales Order disimpan", `${result.orderNo} · Draft`, "ok");
    router.push(`/sales/order/${result.id}`);
    router.refresh();
  }

  const status = order?.status ?? "Draft";
  const backHref = order ? `/sales/order/${order.id}` : "/sales/order";
  const ro = (node: React.ReactNode) => <div className="ro">{node}</div>;
  const nil = (text = "tidak diisi") => <div className="ro nil">{text}</div>;
  const waitCustomer = header.customer_id ? null : "Pilih Customer dulu…";

  const refOptions = (rows: { id: number; label: string; name: string; active: boolean }[]) => rows;

  // ======================================================= header card
  const customerOptions = options.customers.map((c) => ({
    id: c.id,
    label: c.label,
    name: c.name,
    active: c.active,
  }));

  const taxStatus = customer
    ? [
        customer.isPkp ? "PKP" : "Non-PKP",
        customer.vatCollector ? "Pemungut PPN" : null,
        customer.collectsPph22 ? "Pemungut PPh 22" : null,
      ]
        .filter(Boolean)
        .join(" · ")
    : null;

  const headerCard = (
    <div className="card">
      <FormBody>
        <FormSection title="Customer">
          <FormRow>
            <Field
              label="Customer"
              span={6}
              required={editing}
              help={editing ? "Termin dan mode harga mengikuti customer" : undefined}
              error={errors.customer_id}
            >
              {editing ? (
                <Combobox
                  value={header.customer_id}
                  options={customerOptions}
                  placeholder="Pilih Customer…"
                  invalid={Boolean(errors.customer_id)}
                  onChange={pickCustomer}
                />
              ) : (
                ro(
                  <>
                    <span className="lab">{order?.customerLabel}</span>
                    <span>{order?.customerName}</span>
                  </>
                )
              )}
            </Field>
            <Field label={customer?.taxIdType === "NIK" ? "NIK Pembeli" : "NPWP Pembeli"} span={3}>
              {customer?.taxId ? ro(<span className="mono">{formatTaxId(customer.taxId)}</span>) : nil("menunggu Customer")}
            </Field>
            <Field label="Status Pajak" span={3}>
              {taxStatus ? ro(<span className="bdg t-slate">{taxStatus}</span>) : nil("menunggu Customer")}
            </Field>
            {editing && customer && customer.problems.length > 0 && (
              <div className="fld f-12 full">
                <div className="nbox bad slim" style={{ margin: 0 }}>
                  <Icon name="warn" size={15} className="ni" />
                  <div>
                    <b>Customer ini belum dapat dipakai</b>
                    <p>{customer.problems.join(" ")}</p>
                  </div>
                </div>
              </div>
            )}
            <Field
              label="Alamat"
              span={12}
              required={editing}
              help={editing ? "satu alamat customer, penagihan maupun pengiriman" : undefined}
              error={errors.address_id}
            >
              {editing ? (
                <Select
                  value={header.address_id ? String(header.address_id) : ""}
                  options={(customer?.addresses ?? []).map((a) => ({
                    value: String(a.id),
                    label: a.text,
                    hint: [a.isBilling ? "Penagihan" : null, a.isShipping ? "Pengiriman" : null]
                      .filter(Boolean)
                      .join(" · "),
                  }))}
                  placeholder="Pilih Alamat…"
                  waitingFor={waitCustomer}
                  invalid={Boolean(errors.address_id)}
                  listWidth="wide"
                  onChange={(v) => set("address_id", v ? Number(v) : null)}
                />
              ) : (
                ro(<span>{order?.addressText}</span>)
              )}
            </Field>
          </FormRow>
        </FormSection>

        <FormSection title="Pesanan">
          <FormRow>
            <Field label="Tanggal SO" span={3} required={editing} error={errors.order_date}>
              {editing ? (
                <DateInput
                  value={header.order_date}
                  invalid={Boolean(errors.order_date)}
                  onChange={(v) => set("order_date", v)}
                />
              ) : (
                ro(formatDate(header.order_date))
              )}
            </Field>
            <Field label="No. PO Customer" span={3} help={editing ? "jika ada" : undefined} error={errors.po_no}>
              {editing ? (
                <input
                  className="inp idf"
                  value={header.po_no}
                  placeholder="PO-001/IX/2026"
                  autoComplete="off"
                  onChange={(e) => set("po_no", e.target.value)}
                />
              ) : header.po_no ? (
                ro(<span className="mono">{header.po_no}</span>)
              ) : (
                nil()
              )}
            </Field>
            <Field label="Tanggal PO" span={3} error={errors.po_date}>
              {editing ? (
                <DateInput
                  value={header.po_date}
                  invalid={Boolean(errors.po_date)}
                  onChange={(v) => set("po_date", v)}
                />
              ) : header.po_date ? (
                ro(formatDate(header.po_date))
              ) : (
                nil()
              )}
            </Field>
            <Field
              label="Kirim Diminta"
              span={3}
              required={editing}
              help={editing ? "permintaan customer" : undefined}
              error={errors.requested_date}
            >
              {editing ? (
                <DateInput
                  value={header.requested_date}
                  invalid={Boolean(errors.requested_date)}
                  onChange={(v) => set("requested_date", v)}
                />
              ) : (
                ro(formatDate(header.requested_date))
              )}
            </Field>
            <Field
              label="Termin Pembayaran"
              span={4}
              required={editing}
              help={
                editing && customer?.defaultTermId && header.term_id !== customer.defaultTermId
                  ? `default customer: ${options.terms.find((t) => t.id === customer.defaultTermId)?.name ?? ""}`
                  : undefined
              }
              error={errors.term_id}
            >
              {editing ? (
                <Combobox
                  value={header.term_id}
                  options={refOptions(options.terms)}
                  placeholder="Pilih Termin Pembayaran…"
                  invalid={Boolean(errors.term_id)}
                  onChange={(v) => set("term_id", v)}
                />
              ) : (
                ro(
                  <>
                    <span className="lab">{order?.termLabel}</span>
                    <span>{order?.termName}</span>
                  </>
                )
              )}
            </Field>
            <Field label="Gudang Pengirim" span={4} required={editing} error={errors.warehouse_id}>
              {editing ? (
                <Combobox
                  value={header.warehouse_id}
                  options={refOptions(options.warehouses)}
                  placeholder="Pilih Gudang…"
                  invalid={Boolean(errors.warehouse_id)}
                  onChange={(v) => set("warehouse_id", v)}
                />
              ) : (
                ro(
                  <>
                    <span className="lab">{order?.warehouseLabel}</span>
                    <span>{order?.warehouseName}</span>
                  </>
                )
              )}
            </Field>
            <Field label="Salesperson" span={4} help={editing ? "opsional" : undefined}>
              {editing ? (
                <input
                  className="inp"
                  value={header.salesperson}
                  placeholder="Nama salesperson"
                  autoComplete="off"
                  onChange={(e) => set("salesperson", e.target.value)}
                />
              ) : header.salesperson ? (
                ro(header.salesperson)
              ) : (
                nil()
              )}
            </Field>
          </FormRow>
        </FormSection>

        <FormSection title="Harga & Pajak">
          <FormRow>
            <Field
              label="Mode Harga"
              span={4}
              required={editing}
              help={editing ? "harga baris diketik sebelum atau sudah termasuk PPN" : undefined}
              error={errors.price_mode}
            >
              {editing ? (
                <Select
                  value={header.price_mode}
                  options={[
                    { value: "Exclude", label: MODE_TEXT.Exclude },
                    { value: "Include", label: MODE_TEXT.Include },
                  ]}
                  onChange={(v) => set("price_mode", (v || "Exclude") as PriceMode)}
                />
              ) : (
                ro(<span className="bdg t-slate">{MODE_TEXT[header.price_mode]}</span>)
              )}
            </Field>
            <Field label="PPN" span={4} help={editing ? "berlaku untuk seluruh baris" : undefined}>
              {editing ? (
                <label className="chk sm">
                  <input
                    type="checkbox"
                    checked={header.is_taxable}
                    onChange={(e) => set("is_taxable", e.target.checked)}
                  />
                  <span>
                    <span className="ct">Kena PPN</span>
                  </span>
                </label>
              ) : (
                ro(
                  <span className={`bdg ${header.is_taxable ? "s-ok" : "s-mute"}`}>
                    {header.is_taxable ? "Kena PPN" : "Tidak Kena PPN"}
                  </span>
                )
              )}
            </Field>
            {order?.copiedFrom && (
              <Field label="Disalin dari" span={4}>
                {ro(
                  <Link className="drl" href={`/sales/order/${order.copiedFrom.id}`}>
                    <span className="mono">{order.copiedFrom.orderNo}</span>
                  </Link>
                )}
              </Field>
            )}
            <Field label="Catatan" span={12}>
              {editing ? (
                <textarea
                  className="ta"
                  rows={2}
                  value={header.note}
                  placeholder="Keterangan tambahan (opsional)…"
                  onChange={(e) => set("note", e.target.value)}
                />
              ) : header.note ? (
                <div className="ro multi">{header.note}</div>
              ) : (
                <div className="ro multi nil">tidak diisi</div>
              )}
            </Field>
          </FormRow>
        </FormSection>
        {order?.status === "Cancelled" && order.cancelReason && (
          <p className="fnote">
            <b>Dibatalkan:</b> {order.cancelReason}
          </p>
        )}
      </FormBody>
    </div>
  );

  // ======================================================== lines card
  const whtOptions = [
    { value: "", label: "Tidak dipotong" },
    ...options.withholdingTaxes
      .filter((t) => t.active)
      .map((t) => ({ value: String(t.id), label: t.label, hint: formatPct(t.rate) })),
  ];
  const lineErr = (i: number, f: string) => errors[`lines.${i}.${f}`];

  const linesCard = (
    <div className="card" style={{ marginTop: 14 }}>
      <div className="card-h">
        <span className="ci">
          <Icon name="box" size={15} />
        </span>
        <div className="ct">
          <h3>Barang Dipesan</h3>
          <p>
            Harga per satuan dalam {MODE_TEXT[header.price_mode]}. Jenis PPh diisi bila customer akan memotong atau
            memungut PPh.
          </p>
        </div>
        {editing && (
          <button className="btn sm primary" onClick={() => setPicking(true)}>
            <Icon name="plus" size={14} /> Tambah Barang
          </button>
        )}
      </div>
      {editing && header.is_taxable && !rates && (
        <div className="nbox bad slim">
          <Icon name="warn" size={15} className="ni" />
          <div>
            <b>Tarif PPN belum diatur</b>
            <p>Isi Tarif PPN dan faktor DPP Nilai Lain di Pengaturan › System Default sebelum menyimpan pesanan Kena PPN.</p>
          </div>
        </div>
      )}
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
          <h4>Belum ada barang</h4>
          <p>Sales Order memerlukan minimal satu barang yang dapat dijual.</p>
          {editing && (
            <button className="btn primary sm cta" onClick={() => setPicking(true)}>
              <Icon name="plus" size={14} /> Tambah Barang
            </button>
          )}
        </div>
      ) : (
        <div className="tw">
          <table className="grid ltab">
            <thead>
              <tr>
                <th style={{ width: 34 }}>No</th>
                <th>Barang</th>
                <th style={{ width: 96 }}>Satuan</th>
                <th className="num" style={{ width: 88 }}>Qty</th>
                <th className="num" style={{ width: 128 }}>Harga</th>
                <th style={{ width: 196 }}>Diskon</th>
                <th style={{ width: 132 }}>Jenis PPh</th>
                <th className="num" style={{ width: 128 }}>Jumlah</th>
                {editing && <th style={{ width: 40 }} />}
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => {
                const item = itemById.get(l.item_id);
                const view = order?.lines[i];
                const r = totals.lines[i];
                const uoms = item?.uoms ?? [];
                const uom = uoms.find((u) => u.id === l.uom_id);
                const wht = l.withholding_tax_id ? whtById.get(l.withholding_tax_id) : null;
                const lineError =
                  lineErr(i, "item_id") ?? lineErr(i, "uom_id") ?? lineErr(i, "amount") ?? lineErr(i, "withholding_tax_id");
                return (
                  <tr key={l.key} className={lineError ? "overrow" : undefined}>
                    <td className="no">{i + 1}</td>
                    <td>
                      <span className="idc">
                        <span className="lab">{item?.label ?? view?.itemLabel}</span>
                        <span className="nm">{item?.name ?? view?.itemName}</span>
                      </span>
                      {lineError && <span className="overtag">{lineError}</span>}
                    </td>
                    <td>
                      {editing ? (
                        <Select
                          size="sm"
                          value={String(l.uom_id)}
                          options={uoms.map((u) => ({
                            value: String(u.id),
                            label: u.label,
                            hint: u.factor === 1 ? "satuan dasar" : `isi ${formatNumber(u.factor)}`,
                          }))}
                          ariaLabel="Satuan"
                          onChange={(v) => setLine(l.key, { uom_id: Number(v) })}
                        />
                      ) : (
                        <span className="lab">{uom?.label ?? view?.uomLabel}</span>
                      )}
                    </td>
                    <td className="num">
                      {editing ? (
                        <MoneyInput
                          size="sm"
                          decimals={4}
                          value={l.qty}
                          ariaLabel="Qty"
                          onChange={(v) => setLine(l.key, { qty: v })}
                        />
                      ) : (
                        <span className="mny">{formatNumber(Number(l.qty), Number(l.qty) % 1 ? 2 : 0)}</span>
                      )}
                    </td>
                    <td className="num">
                      {editing ? (
                        <MoneyInput
                          size="sm"
                          value={l.price}
                          ariaLabel="Harga"
                          onChange={(v) => setLine(l.key, { price: v })}
                        />
                      ) : (
                        <span className="mny">{money(Number(l.price))}</span>
                      )}
                    </td>
                    <td>
                      {editing ? (
                        <div className="dcell">
                          <span className="dtog" role="group" aria-label="Jenis diskon">
                            {(["Percent", "Amount"] as DiscountType[]).map((t) => (
                              <button
                                key={t}
                                type="button"
                                className={l.discount_type === t ? "on" : undefined}
                                onClick={() =>
                                  setLine(l.key, {
                                    discount_type: l.discount_type === t ? null : t,
                                    discount_value: "",
                                  })
                                }
                              >
                                {t === "Percent" ? "%" : "Nominal"}
                              </button>
                            ))}
                          </span>
                          {l.discount_type ? (
                            <MoneyInput
                              size="sm"
                              decimals={l.discount_type === "Percent" ? 2 : 0}
                              value={l.discount_value}
                              ariaLabel="Nilai diskon"
                              onChange={(v) => setLine(l.key, { discount_value: v })}
                            />
                          ) : (
                            <span className="dash">tanpa diskon</span>
                          )}
                        </div>
                      ) : l.discount_type ? (
                        <span className="mny">
                          {l.discount_type === "Percent"
                            ? formatPct(Number(l.discount_value))
                            : money(Number(l.discount_value))}
                        </span>
                      ) : (
                        <span className="dash">—</span>
                      )}
                    </td>
                    <td>
                      {editing ? (
                        <Select
                          size="sm"
                          value={l.withholding_tax_id ? String(l.withholding_tax_id) : ""}
                          options={whtOptions}
                          ariaLabel="Jenis PPh"
                          onChange={(v) => setLine(l.key, { withholding_tax_id: v ? Number(v) : null })}
                        />
                      ) : wht || view?.withholdingLabel ? (
                        <span className="lab">{wht?.label ?? view?.withholdingLabel}</span>
                      ) : (
                        <span className="dash">—</span>
                      )}
                    </td>
                    <td className="num">
                      <span className="mny">{money(r?.amount ?? 0)}</span>
                      {(r?.discount ?? 0) > 0 && <span className="fulltag">diskon {money(r.discount)}</span>}
                    </td>
                    {editing && (
                      <td>
                        <button
                          className="iact del"
                          title="Hapus baris"
                          onClick={() => {
                            setLines((ls) => ls.filter((x) => x.key !== l.key));
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
      <div className="cardfoot">
        <div className="impact">
          <div className="ttl">Nilai Pesanan</div>
          <div className="ir">
            <span>Subtotal</span>
            <b>{money(totals.gross)}</b>
          </div>
          {totals.discount > 0 && (
            <div className="ir">
              <span>Diskon</span>
              <b>−{money(totals.discount)}</b>
            </div>
          )}
          <div className="ir">
            <span>DPP</span>
            <b>{money(totals.dpp)}</b>
          </div>
          {header.is_taxable ? (
            <>
              <div className="ir">
                <span>
                  DPP Nilai Lain ({rates ? `${rates.otherNum}/${rates.otherDen}` : "—"}, per baris)
                </span>
                <b>{money(totals.dppOther)}</b>
              </div>
              <div className="ir">
                <span>PPN {rates ? formatPct(rates.rate) : "—"} × DPP Nilai Lain</span>
                <b>{money(totals.ppn)}</b>
              </div>
            </>
          ) : (
            <div className="ir">
              <span>PPN</span>
              <b>Tidak Kena PPN</b>
            </div>
          )}
          {totals.gross - totals.discount !== totals.total && header.is_taxable && (
            <div className="ir est">
              <span>Pembulatan PPN (diserap DPP)</span>
              <b>−{money(totals.gross - totals.discount - totals.total)}</b>
            </div>
          )}
          <div className="ir tot">
            <span>Total</span>
            <b>{money(totals.total)}</b>
          </div>
          {totals.withholdings.map((w) => (
            <div className="ir est" key={w.key}>
              <span>
                Estimasi {whtById.get(Number(w.key))?.label ?? "PPh"} {formatPct(w.rate)} × {money(w.base)}
              </span>
              <b>−{money(w.amount)}</b>
            </div>
          ))}
          {totals.collectedPpn > 0 && (
            <div className="ir est">
              <span>PPN dipungut pembeli (WAPU)</span>
              <b>−{money(totals.collectedPpn)}</b>
            </div>
          )}
          {(totals.withholdingTotal > 0 || totals.collectedPpn > 0) && (
            <div className="ir tot">
              <span>Estimasi Penerimaan</span>
              <b>{money(totals.expectedReceipt)}</b>
            </div>
          )}
        </div>
      </div>
    </div>
  );

  // ============================================================ page
  return (
    <>
      <div className="ph">
        <div className="crumb">
          <span>Penjualan</span>
          <span>/</span>
          <Link href="/sales/order">Sales Order</Link>
          <span>/</span>
          <span className="cur">{order ? order.orderNo : "Baru"}</span>
        </div>
        <div className="ph-row">
          <h1>
            <span className="ph-ico">
              <Icon name="clip" size={16} />
            </span>
            {order ? (
              <>
                <span className="docno">{order.orderNo}</span>
                <span className={`bdg ${SALES_ORDER_STATUS_BADGE[status]}`}>{SALES_ORDER_STATUS_TEXT[status]}</span>
              </>
            ) : (
              "Sales Order Baru"
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
              <SalesOrderActions id={order!.id} subject={order!.orderNo} status={status} can={can} />
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

      {picking && (
        <ItemPicker
          items={options.items.filter((i) => i.active)}
          taken={lines.map((l) => l.item_id)}
          onCancel={() => setPicking(false)}
          onPick={addItems}
        />
      )}
    </>
  );
}
