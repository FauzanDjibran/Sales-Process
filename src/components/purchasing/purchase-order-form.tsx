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
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { PurchaseOrderActions } from "@/components/purchasing/purchase-order-actions";
import { PurchaseOrderRequestPicker } from "@/components/purchasing/purchase-order-request-picker";
import { createPurchaseOrderAction, updatePurchaseOrderAction } from "@/app/actions/purchase-order";
import { computeSalesTotals, type DiscountType, type PriceMode } from "@/lib/erp/sales-tax";
import {
  PURCHASE_ORDER_KINDS,
  PURCHASE_ORDER_REASON_TEXT,
  PURCHASE_ORDER_STATUS_BADGE,
  PURCHASE_ORDER_STATUS_TEXT,
  purchaseWithholdingRate,
  sharePurchaseOrderLine,
  type PurchaseOrderAbilities,
  type PurchaseOrderKind,
} from "@/lib/erp/purchase-order-workflow";
import type { PurchaseOrderHeaderInput, PurchaseOrderLineInput, PurchaseOrderOptions, PurchaseOrderView } from "@/lib/erp/purchase-order";
import { formatTaxId } from "@/lib/erp/partner-shape";
import { formatDate, formatMoney, formatNumber, formatPct, formatPrice, todayIso } from "@/lib/format";

/**
 * The Purchase Order in all three modes (P124): the supplier first — its Termin
 * and mode harga fill in from its purchase defaults (P122) — then the order,
 * then the lines, which come only from Open Purchase Requests (*Tambah dari
 * PR*, B13): request lines of one item are merged into one line in its base
 * unit (B9), whose unit may then be changed to any of the item's (B14). Each
 * line shows how its base quantity is shared over its requests, earliest need
 * first, and what goes beyond them (B15). Every figure is `computeSalesTotals`,
 * the module the save stores from (B11).
 */

type LineState = {
  key: string;
  item_id: number;
  uom_id: number;
  qty: string;
  price: string;
  discount_type: DiscountType;
  discount_value: string;
  withholding_tax_id: number | null;
  note: string;
  request_line_ids: number[];
};

let seq = 0;
const newKey = () => `l${Date.now().toString(36)}${seq++}`;
const MODE_TEXT: Record<PriceMode, string> = { Exclude: "Exclude PPN", Include: "Include PPN" };
const money = (n: number) => formatMoney(n, "IDR");
const qtyText = (n: number) => formatNumber(n, n % 1 ? 2 : 0);
const discountOf = (l: { discount_type: DiscountType; discount_value: string }) =>
  Number(l.discount_value) > 0 ? { type: l.discount_type, value: Number(l.discount_value) } : { type: null, value: null };

export function PurchaseOrderForm({
  kind,
  mode,
  order,
  options,
  can,
}: {
  kind: PurchaseOrderKind;
  mode: "new" | "edit" | "view";
  order: PurchaseOrderView | null;
  options: PurchaseOrderOptions;
  can: PurchaseOrderAbilities;
}) {
  const router = useRouter();
  const toast = useToast();
  const k = PURCHASE_ORDER_KINDS[kind];
  const goods = kind === "goods";
  const editing = mode !== "view";
  const today = todayIso();

  const [header, setHeader] = useState<PurchaseOrderHeaderInput>(() =>
    order
      ? { ...order.header }
      : {
          item_type: k.itemType,
          order_date: today,
          supplier_id: null,
          term_id: null,
          delivery_date: today,
          warehouse_id: null,
          quotation_no: "",
          price_mode: "Exclude",
          is_taxable: true,
          note: "",
        }
  );
  const [lines, setLines] = useState<LineState[]>(() =>
    (order?.lines ?? []).map((l) => ({
      key: newKey(),
      item_id: Number(l.item_id),
      uom_id: Number(l.uom_id),
      qty: String(l.qty),
      price: String(l.price),
      discount_type: (l.discount_type as DiscountType | null) ?? "Percent",
      discount_value: l.discount_value == null ? "" : String(l.discount_value),
      withholding_tax_id: l.withholding_tax_id ? Number(l.withholding_tax_id) : null,
      note: l.note ?? "",
      request_line_ids: l.request_line_ids,
    }))
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [picking, setPicking] = useState(false);

  const supplier = options.suppliers.find((s) => s.id === header.supplier_id) ?? null;
  const hasTaxId = Boolean(supplier?.taxId);
  const itemById = useMemo(() => new Map(options.items.map((i) => [i.id, i])), [options.items]);
  const srcById = useMemo(() => new Map(options.sources.map((s) => [s.id, s])), [options.sources]);
  const whtById = useMemo(() => new Map(options.withholdingTaxes.map((t) => [t.id, t])), [options.withholdingTaxes]);

  const touch = (...names: string[]) => {
    setDirty(true);
    setErrors((e) => {
      const next = { ...e };
      for (const n of names) delete next[n];
      return next;
    });
  };
  const set = <K extends keyof PurchaseOrderHeaderInput>(key: K, v: PurchaseOrderHeaderInput[K]) => {
    setHeader((h) => ({ ...h, [key]: v }));
    touch(key);
  };
  const pickSupplier = (id: number | null) => {
    const s = options.suppliers.find((x) => x.id === id) ?? null;
    setHeader((h) => ({
      ...h,
      supplier_id: id,
      term_id: s?.defaultTermId ?? h.term_id,
      price_mode: s?.defaultPriceMode ?? h.price_mode,
      // Only a PKP issues a faktur pajak (B10).
      is_taxable: s ? s.isPkp && h.is_taxable : h.is_taxable,
    }));
    touch("supplier_id", "term_id", "price_mode", "is_taxable");
  };
  const setLine = (key: string, patch: Partial<LineState>) => {
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
    touch("_lines");
  };

  const leftOf = (id: number) => {
    const s = srcById.get(id);
    return s ? Math.max(0, s.qty - s.ordered) : 0;
  };
  const factorOf = (l: LineState) => itemById.get(l.item_id)?.uoms.find((u) => u.id === l.uom_id)?.factor ?? 1;

  /**
   * Applies the picker: a new request line joins the line of its item in the
   * base unit, or starts one, adding what it still needs (B9); an unticked one
   * leaves its line, taking its quantity with it, and a line left with no
   * request goes.
   */
  const applyPick = (ids: number[]) => {
    const picked = new Set(ids);
    let next = lines.map((l) => {
      const gone = l.request_line_ids.filter((id) => !picked.has(id));
      if (!gone.length) return l;
      const less = gone.reduce((s, id) => s + leftOf(id), 0) / factorOf(l);
      const qty = Number(l.qty) - less;
      return { ...l, request_line_ids: l.request_line_ids.filter((id) => picked.has(id)), qty: qty > 0 ? String(+qty.toFixed(4)) : l.qty };
    });
    next = next.filter((l) => l.request_line_ids.length);
    const have = new Set(next.flatMap((l) => l.request_line_ids));
    for (const id of ids) {
      if (have.has(id)) continue;
      const s = srcById.get(id)!;
      const base = itemById.get(s.itemId)?.uoms[0];
      const into = next.find((l) => l.item_id === s.itemId && l.uom_id === base?.id);
      if (into) {
        into.request_line_ids = [...into.request_line_ids, id];
        into.qty = String(+(Number(into.qty) + leftOf(id)).toFixed(4));
      } else {
        next.push({
          key: newKey(),
          item_id: s.itemId,
          uom_id: base?.id ?? s.uomId,
          qty: String(leftOf(id)),
          price: "",
          discount_type: "Percent",
          discount_value: "",
          withholding_tax_id: null,
          note: "",
          request_line_ids: [id],
        });
      }
    }
    setLines(next.map((l) => ({ ...l })));
    setPicking(false);
    touch("_lines");
  };

  const priceMode: PriceMode = header.is_taxable ? (header.price_mode as PriceMode) : "Exclude";
  const rates = mode === "view" ? (order?.rates ?? null) : options.ppnRates;
  const rateOf = (l: LineState) => {
    const t = l.withholding_tax_id ? whtById.get(l.withholding_tax_id) : null;
    return t ? purchaseWithholdingRate(t.rate, hasTaxId) : null;
  };
  const totals = computeSalesTotals({
    lines: lines.map((l, i) => ({
      qty: Number(l.qty) || 0,
      price: Number(l.price) || 0,
      discountType: discountOf(l).type,
      discountValue: discountOf(l).value,
      // A stored order shows the rate it froze; a Draft the rate it would take.
      withholdingRate: mode === "view" ? (order?.lines[i]?.withholdingRate ?? null) : rateOf(l),
      withholdingKey: l.withholding_tax_id ? String(l.withholding_tax_id) : null,
    })),
    mode: priceMode,
    taxable: header.is_taxable,
    vatCollector: false,
    rates,
  });

  async function onSave() {
    setSaving(true);
    const payload: PurchaseOrderLineInput[] = lines.map((l) => ({
      item_id: l.item_id,
      uom_id: l.uom_id,
      qty: Number(l.qty) || 0,
      price: Number(l.price) || 0,
      discount_type: discountOf(l).type,
      discount_value: discountOf(l).value,
      withholding_tax_id: l.withholding_tax_id,
      note: l.note,
      request_line_ids: l.request_line_ids,
    }));
    const result = mode === "edit" ? await updatePurchaseOrderAction(order!.id, header, payload) : await createPurchaseOrderAction(header, payload);
    setSaving(false);
    if (!result.ok) {
      setErrors(result.errors);
      toast(result.errors._form ? "Tidak diizinkan" : "Belum bisa disimpan", result.errors._form ?? result.errors._lines ?? "Periksa kembali isian.", "err");
      return;
    }
    setDirty(false);
    toast("Purchase Order disimpan", `${result.orderNo} · Draft`, "ok");
    router.push(`${k.path}/${result.id}`);
  }

  const status = order?.status ?? "Draft";
  const backHref = order ? `${k.path}/${order.id}` : k.path;
  const ro = (node: React.ReactNode) => <div className="ro">{node}</div>;
  const nil = (t = "tidak diisi") => <div className="ro nil">{t}</div>;

  const headerCard = (
    <div className="card">
      <FormBody>
        <FormSection title="Supplier">
          <FormRow>
            <Field label="Supplier" span={6} required={editing} help={editing ? "Termin dan mode harga mengikuti supplier" : undefined} error={errors.supplier_id}>
              {editing ? (
                <Combobox value={header.supplier_id} options={options.suppliers} placeholder="Pilih Supplier…" invalid={Boolean(errors.supplier_id)} onChange={pickSupplier} />
              ) : (
                ro(
                  <>
                    <span className="lab">{order?.supplierLabel}</span>
                    <span>{order?.supplierName}</span>
                  </>
                )
              )}
            </Field>
            <Field label={supplier?.taxIdType === "NIK" ? "NIK Supplier" : "NPWP Supplier"} span={3}>
              {supplier?.taxId ? ro(<span className="mono">{formatTaxId(supplier.taxId)}</span>) : supplier ? nil("tidak ada") : nil("menunggu Supplier")}
            </Field>
            <Field label="Status Pajak" span={3}>
              {supplier ? (
                <div className="ro" style={{ flexWrap: "wrap", rowGap: 4 }}>
                  <span className="bdg t-slate">{supplier.isPkp ? "PKP" : "Non-PKP"}</span>
                  {!hasTaxId && <span className="bdg t-warn">Tanpa NPWP · PPh 2×</span>}
                </div>
              ) : (
                nil("menunggu Supplier")
              )}
            </Field>
          </FormRow>
        </FormSection>

        <FormSection title="Pesanan">
          <FormRow>
            <Field label="Tanggal PO" span={3} required={editing} error={errors.order_date}>
              {editing ? <DateInput value={header.order_date} invalid={Boolean(errors.order_date)} onChange={(v) => set("order_date", v)} /> : ro(formatDate(header.order_date))}
            </Field>
            <Field label="Tanggal Kirim Diharapkan" span={3} required={editing} error={errors.delivery_date}>
              {editing ? <DateInput value={header.delivery_date} invalid={Boolean(errors.delivery_date)} onChange={(v) => set("delivery_date", v)} /> : ro(formatDate(header.delivery_date))}
            </Field>
            <Field label="Termin Pembayaran" span={3} required={editing} error={errors.term_id}>
              {editing ? (
                <Combobox value={header.term_id} options={options.terms} placeholder="Pilih Termin Pembayaran…" invalid={Boolean(errors.term_id)} onChange={(v) => set("term_id", v)} />
              ) : (
                ro(
                  <>
                    <span className="lab">{order?.termLabel}</span>
                    <span>{order?.termName}</span>
                  </>
                )
              )}
            </Field>
            <Field label="No. Penawaran Supplier" span={3} help={editing ? "jika ada" : undefined}>
              {editing ? (
                <input className="inp idf" value={header.quotation_no} autoComplete="off" onChange={(e) => set("quotation_no", e.target.value)} />
              ) : header.quotation_no ? (
                ro(<span className="mono">{header.quotation_no}</span>)
              ) : (
                nil()
              )}
            </Field>
            {goods && (
              <Field label="Gudang Tujuan" span={6} help={editing ? "opsional" : undefined} error={errors.warehouse_id}>
                {editing ? (
                  <Combobox value={header.warehouse_id} options={options.warehouses} placeholder="Pilih Gudang…" onChange={(v) => set("warehouse_id", v)} />
                ) : order?.warehouseLabel ? (
                  ro(<span className="lab">{order.warehouseLabel}</span>)
                ) : (
                  nil()
                )}
              </Field>
            )}
          </FormRow>
        </FormSection>

        <FormSection title="Harga & Pajak">
          <FormRow>
            <Field label="PPN" span={4} help={editing ? "hanya supplier PKP" : undefined} error={errors.is_taxable}>
              {editing ? (
                <label className="chk sm">
                  <input
                    type="checkbox"
                    checked={header.is_taxable}
                    disabled={Boolean(supplier && !supplier.isPkp)}
                    onChange={(e) => set("is_taxable", e.target.checked)}
                  />
                  <span>
                    <span className="ct">Kena PPN</span>
                  </span>
                </label>
              ) : (
                ro(<span className={`bdg ${header.is_taxable ? "s-ok" : "s-mute"}`}>{header.is_taxable ? "Kena PPN" : "Tidak Kena PPN"}</span>)
              )}
            </Field>
            {header.is_taxable && (
              <Field label="Mode Harga" span={4} required={editing} error={errors.price_mode}>
                {editing ? (
                  <Select
                    value={header.price_mode}
                    options={[
                      { value: "Exclude", label: MODE_TEXT.Exclude },
                      { value: "Include", label: MODE_TEXT.Include },
                    ]}
                    onChange={(v) => set("price_mode", v || "Exclude")}
                  />
                ) : (
                  ro(<span className="bdg t-slate">{MODE_TEXT[header.price_mode as PriceMode]}</span>)
                )}
              </Field>
            )}
            <Field label="Catatan" span={12}>
              {editing ? (
                <textarea className="ta" rows={2} value={header.note} placeholder="Keterangan tambahan (opsional)…" onChange={(e) => set("note", e.target.value)} />
              ) : header.note ? (
                <div className="ro multi">{header.note}</div>
              ) : (
                <div className="ro multi nil">tidak diisi</div>
              )}
            </Field>
          </FormRow>
        </FormSection>
        {order?.statusReason && PURCHASE_ORDER_REASON_TEXT[order.status] && (
          <p className="fnote">
            <b>{PURCHASE_ORDER_REASON_TEXT[order.status]}:</b> {order.statusReason}
          </p>
        )}
      </FormBody>
    </div>
  );

  const whtOptions = [
    { value: "", label: "Tanpa PPh" },
    ...options.withholdingTaxes.filter((t) => t.active).map((t) => ({ value: String(t.id), label: t.label, hint: formatPct(purchaseWithholdingRate(t.rate, hasTaxId)) })),
  ];
  const lineErr = (i: number, f: string) => errors[`lines.${i}.${f}`];
  const addButton = (
    <button className="btn sm primary" onClick={() => setPicking(true)}>
      <Icon name="plus" size={14} /> Tambah dari PR
    </button>
  );

  const linesCard = (
    <div className="card" style={{ marginTop: 14 }}>
      <div className="card-h">
        <span className="ci">
          <Icon name="box" size={15} />
        </span>
        <div className="ct">
          <h3>{goods ? "Barang Dipesan" : "Jasa Dipesan"}</h3>
          <p>
            {header.is_taxable ? `Harga per satuan dalam ${MODE_TEXT[priceMode]}.` : "Harga per satuan, tanpa PPN."} Jenis PPh diisi bila kita memotong PPh supplier.
          </p>
        </div>
        {editing && addButton}
      </div>
      {editing && header.is_taxable && !rates && (
        <div className="nbox bad slim">
          <Icon name="warn" size={15} className="ni" />
          <div>
            <b>Tarif PPN belum diatur</b>
            <p>Isi Tarif PPN dan faktor DPP Nilai Lain di Pengaturan › System Default.</p>
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
            <Icon name="clip" size={18} />
          </div>
          <h4>Belum ada baris</h4>
          <p>Purchase Order dibuat dari Purchase Request yang Open.</p>
          {editing && <div className="cta">{addButton}</div>}
        </div>
      ) : (
        <div className="tw">
          <table className="grid ltab" style={{ minWidth: editing ? 1040 : 900 }}>
            <thead>
              <tr>
                <th style={{ width: 40 }}>No</th>
                <th>{goods ? "Barang" : "Jasa"} · Purchase Request</th>
                <th style={{ width: editing ? 172 : 130 }}>Qty</th>
                <th className="num" style={{ width: 128 }}>Harga</th>
                <th style={{ width: editing ? 168 : 112 }}>Diskon</th>
                <th style={{ width: 120 }}>Jenis PPh</th>
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
                const baseLabel = uoms[0]?.label ?? view?.uomLabel ?? "";
                const wht = l.withholding_tax_id ? whtById.get(l.withholding_tax_id) : null;
                const lineError = lineErr(i, "item_id") ?? lineErr(i, "uom_id") ?? lineErr(i, "amount") ?? lineErr(i, "withholding_tax_id");
                // The share as the save will store it (Draft) or as stored.
                const share = editing
                  ? sharePurchaseOrderLine(
                      (Number(l.qty) || 0) * factorOf(l),
                      l.request_line_ids.map((id) => ({ id, neededDate: srcById.get(id)?.neededDate ?? "", left: leftOf(id) }))
                    )
                  : null;
                const refs = editing
                  ? l.request_line_ids.map((id) => ({ id, no: srcById.get(id)?.requestNo ?? "", need: srcById.get(id)?.neededDate ?? "", qty: share!.shares.get(id) ?? 0 }))
                  : (view?.shares ?? []).map((s) => ({ id: s.requestLineId, no: s.requestNo, need: s.neededDate, qty: s.baseQty }));
                const excess = editing ? share!.excess : (Number(l.qty) || 0) * (view?.uomFactor ?? 1) - refs.reduce((s, x) => s + x.qty, 0);
                return (
                  <tr key={l.key} className={lineError ? "overrow" : undefined}>
                    <td className="no">{i + 1}</td>
                    <td>
                      <span className="idc">
                        <span className="lab">{item?.label ?? view?.itemLabel}</span>
                        <span className="nm">{item?.name ?? view?.itemName}</span>
                      </span>
                      <span className="fulltag" style={{ display: "block", whiteSpace: "normal" }}>
                        {refs.map((x) => `${x.no} (${formatDate(x.need)}): ${qtyText(x.qty)} ${baseLabel}`).join(" · ")}
                        {excess > 0.00005 && status !== "Closed" && ` · melebihi PR ${qtyText(+excess.toFixed(4))} ${baseLabel}`}
                      </span>
                      {lineError && <span className="overtag">{lineError}</span>}
                    </td>
                    <td>
                      {editing ? (
                        <div className="qcell">
                          <MoneyInput size="sm" decimals={4} value={l.qty} ariaLabel="Qty" onChange={(v) => setLine(l.key, { qty: v })} />
                          {uoms.length > 1 ? (
                            <Select
                              size="sm"
                              value={String(l.uom_id)}
                              options={uoms.map((u) => ({ value: String(u.id), label: u.label, hint: u.factor === 1 ? "satuan dasar" : `isi ${formatNumber(u.factor)}` }))}
                              ariaLabel="Satuan"
                              onChange={(v) => setLine(l.key, { uom_id: Number(v) })}
                            />
                          ) : (
                            <span className="qu">{uom?.label ?? ""}</span>
                          )}
                        </div>
                      ) : (
                        <span className="qview">
                          <span className="mny">{qtyText(Number(l.qty))}</span>
                          <span className="lab">{view?.uomLabel}</span>
                        </span>
                      )}
                    </td>
                    <td className="num">
                      {editing ? (
                        <MoneyInput size="sm" value={l.price} decimals={6} ariaLabel="Harga" onChange={(v) => setLine(l.key, { price: v })} />
                      ) : (
                        <span className="mny">{formatPrice(Number(l.price))}</span>
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
                                onClick={() => l.discount_type !== t && setLine(l.key, { discount_type: t, discount_value: "" })}
                              >
                                {t === "Percent" ? "%" : "Nominal"}
                              </button>
                            ))}
                          </span>
                          {l.discount_type === "Percent" ? (
                            <PercentInput size="sm" value={l.discount_value} ariaLabel="Diskon persen" onChange={(v) => setLine(l.key, { discount_value: v })} />
                          ) : (
                            <MoneyInput size="sm" value={l.discount_value} ariaLabel="Nilai diskon" onChange={(v) => setLine(l.key, { discount_value: v })} />
                          )}
                        </div>
                      ) : discountOf(l).type ? (
                        <span className="mny">{l.discount_type === "Percent" ? formatPct(Number(l.discount_value)) : money(Number(l.discount_value))}</span>
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
                        <span className="lab">
                          {wht?.label ?? view?.withholdingLabel} {view?.withholdingRate != null && <span className="nm">{formatPct(view.withholdingRate)}</span>}
                        </span>
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
      <div className="cardfoot multi">
        {totals.withholdingTotal > 0 && (
          <div className="impact">
            <div className="ttl">Estimasi Pembayaran</div>
            <div className="ir">
              <span>Total Purchase Order</span>
              <b>{money(totals.total)}</b>
            </div>
            {totals.withholdings.map((w) => (
              <div className="ir" key={w.key}>
                <span>
                  {whtById.get(Number(w.key))?.label ?? "PPh"} {formatPct(w.rate)} × DPP {money(w.base)}
                </span>
                <b>−{money(w.amount)}</b>
              </div>
            ))}
            <div className="ir tot">
              <span>Estimasi dibayar ke supplier</span>
              <b>{money(totals.total - totals.withholdingTotal)}</b>
            </div>
          </div>
        )}
        <div className="impact">
          <div className="ttl">Nilai Pesanan · {header.is_taxable ? MODE_TEXT[priceMode] : "Tidak Kena PPN"}</div>
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
                <span>DPP Nilai Lain ({rates ? `${rates.otherNum}/${rates.otherDen}` : "—"}, per baris)</span>
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
          {header.is_taxable && priceMode === "Include" && totals.gross - totals.discount !== totals.total && (
            <div className="ir est">
              <span>Pembulatan PPN (diserap DPP)</span>
              <b>−{money(totals.gross - totals.discount - totals.total)}</b>
            </div>
          )}
          <div className="ir tot">
            <span>Total Purchase Order</span>
            <b>{money(totals.total)}</b>
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <>
      <div className="ph">
        <div className="crumb">
          <span>Pembelian</span>
          <span>/</span>
          <Link href={k.path}>{k.name}</Link>
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
                <span className={`bdg ${PURCHASE_ORDER_STATUS_BADGE[status]}`}>{PURCHASE_ORDER_STATUS_TEXT[status]}</span>
              </>
            ) : (
              `${k.name} Baru`
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
              <PurchaseOrderActions id={order!.id} basePath={k.path} subject={order!.orderNo} status={status} can={can} />
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
        <PurchaseOrderRequestPicker sources={options.sources} current={lines.flatMap((l) => l.request_line_ids)} onApply={applyPick} onClose={() => setPicking(false)} />
      )}
    </>
  );
}
