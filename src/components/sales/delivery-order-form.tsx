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
import { DeliveryOrderActions } from "@/components/sales/delivery-order-actions";
import { DeliveryOrderLinePicker } from "@/components/sales/delivery-order-line-picker";
import { createDeliveryOrderAction, updateDeliveryOrderAction } from "@/app/actions/delivery-order";
import {
  DELIVERY_ORDER_REASON_TEXT,
  DELIVERY_ORDER_STATUS_BADGE,
  DELIVERY_ORDER_STATUS_TEXT,
  type DeliveryOrderAbilities,
} from "@/lib/erp/delivery-order-workflow";
import type { DeliveryOrderHeaderInput, DeliveryOrderOptions, DeliveryOrderView } from "@/lib/erp/delivery-order";
import { formatDate, formatNumber, todayIso } from "@/lib/format";

/**
 * A Delivery Order in all three modes: `new`, `edit` (Draft only) and `view`
 * (P93).
 *
 * It starts from a Customer Order with at least one Open Sales Order, chosen
 * once and locked: the customer and the PO come from it. Its lines are lines of
 * that order's Open Sales Orders, picked in a dialog, each a quantity in the
 * Sales Order line's unit, never more than what other Delivery Orders have left
 * of it. One warehouse and one address per Delivery Order; the address and the
 * ship date start on the first Sales Order picked. No price and no tax.
 */

export type DeliveryOrderMode = "new" | "edit" | "view";

type LineState = { key: string; sales_order_line_id: number | null; qty: string };

let seq = 0;
const newKey = () => `l${Date.now().toString(36)}${seq++}`;
const qtyText = (n: number) => formatNumber(n, n % 1 ? 2 : 0);

export function DeliveryOrderForm({
  mode,
  order,
  options,
  can,
  presetCustomerOrderId = null,
  presetSalesOrderId = null,
}: {
  mode: DeliveryOrderMode;
  order: DeliveryOrderView | null;
  options: DeliveryOrderOptions;
  can: DeliveryOrderAbilities;
  /** `?co=<id>` — a new Delivery Order started from a Customer Order. */
  presetCustomerOrderId?: number | null;
  /** `?so=<id>` — started from a Sales Order's page: its lines start ticked. */
  presetSalesOrderId?: number | null;
}) {
  const router = useRouter();
  const toast = useToast();
  const editing = mode !== "view";
  const orderById = useMemo(() => new Map(options.orders.map((o) => [o.id, o])), [options.orders]);

  // From a Sales Order's page, its Customer Order is found through it.
  const presetSource = presetSalesOrderId
    ? options.orders.find((o) => o.salesOrders.some((s) => s.id === presetSalesOrderId))
    : presetCustomerOrderId
      ? orderById.get(presetCustomerOrderId)
      : undefined;
  const presetSo = presetSource?.salesOrders.find((s) => s.id === presetSalesOrderId && s.status === "Open");

  const [header, setHeader] = useState<DeliveryOrderHeaderInput>(() => {
    if (order) return { ...order.header };
    return {
      customer_order_id: presetSource?.id ?? null,
      do_date: todayIso(),
      delivery_date: presetSo?.deliveryDate ?? "",
      warehouse_id: null,
      address_id: presetSo?.addressId ?? presetSource?.addressId ?? null,
      note: "",
    };
  });
  const [lines, setLines] = useState<LineState[]>(() => {
    if (order) {
      return order.lines.map((l) => ({ key: newKey(), sales_order_line_id: Number(l.sales_order_line_id), qty: String(l.qty) }));
    }
    if (!presetSo || !presetSource) return [];
    return presetSource.lines
      .filter((l) => l.salesOrderId === presetSo.id && l.qty - l.held > 0)
      .map((l) => ({ key: newKey(), sales_order_line_id: l.id, qty: "" }));
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  // Until the user picks an address or a date, they follow the first Sales
  // Order picked.
  const [addressTouched, setAddressTouched] = useState(Boolean(order || presetSo));
  const [dateTouched, setDateTouched] = useState(Boolean(order || presetSo));

  const source = header.customer_order_id ? orderById.get(header.customer_order_id) : undefined;
  const soLineById = useMemo(() => new Map((source?.lines ?? []).map((l) => [l.id, l])), [source]);
  const address = source?.addresses.find((a) => a.id === header.address_id);
  const warehouse = options.warehouses.find((w) => w.id === header.warehouse_id);

  const touch = (...names: string[]) => {
    setDirty(true);
    setErrors((e) => {
      const next = { ...e };
      for (const n of names) delete next[n];
      return next;
    });
  };
  const set = <K extends keyof DeliveryOrderHeaderInput>(k: K, v: DeliveryOrderHeaderInput[K]) => {
    setHeader((x) => ({ ...x, [k]: v }));
    touch(k);
  };
  const setLine = (key: string, patch: Partial<LineState>) => {
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
    touch("_lines");
  };
  const pickOrder = (id: number | null) => {
    const o = id ? orderById.get(id) : undefined;
    setHeader((x) => ({ ...x, customer_order_id: id, address_id: o?.addressId ?? null }));
    setLines([]);
    setAddressTouched(false);
    setDateTouched(false);
    touch("customer_order_id", "address_id", "_lines");
  };

  /** The picker's ticks become the lines: kept ones keep their quantity, new ones start blank. */
  const [pickerOpen, setPickerOpen] = useState(false);
  const applyPicked = (ids: number[]) => {
    setLines((ls) =>
      ids.map((id) => ls.find((l) => l.sales_order_line_id === id) ?? { key: newKey(), sales_order_line_id: id, qty: "" })
    );
    const first = ids.length ? soLineById.get(ids[0]) : undefined;
    const so = first ? source?.salesOrders.find((s) => s.id === first.salesOrderId) : undefined;
    if (so) {
      setHeader((x) => ({
        ...x,
        ...(addressTouched ? {} : { address_id: so.addressId }),
        ...(dateTouched ? {} : { delivery_date: so.deliveryDate }),
      }));
    }
    touch("_lines");
    setPickerOpen(false);
  };

  async function onSave() {
    setSaving(true);
    // Every line was picked on purpose, so a blank quantity is sent and refused
    // on its row rather than quietly dropped.
    const sent = lines;
    const payload = sent.map((l) => ({ sales_order_line_id: l.sales_order_line_id, qty: l.qty, note: "" }));
    const result =
      mode === "edit"
        ? await updateDeliveryOrderAction(order!.id, header, payload)
        : await createDeliveryOrderAction(header, payload);
    setSaving(false);
    if (!result.ok) {
      // Line errors come back by position in what was sent; shown by row.
      const mapped: Record<string, string> = {};
      for (const [k, v] of Object.entries(result.errors)) {
        const m = /^lines\.(\d+)\.(\w+)$/.exec(k);
        if (m) mapped[`lines.${sent[Number(m[1])]?.key}.${m[2]}`] = v;
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
    toast("Delivery Order disimpan", `${result.doNo} · Draft`, "ok");
    router.push(`/sales/delivery-order/${result.id}`);
  }

  const status = order?.status ?? "Draft";
  const backHref = order ? `/sales/delivery-order/${order.id}` : "/sales/delivery-order";
  const ro = (node: React.ReactNode) => <div className="ro">{node}</div>;
  const nil = (text = "tidak diisi") => <div className="ro nil">{text}</div>;
  const waitOrder = source ? null : "Pilih Customer Order dulu…";
  const lineErr = (key: string, f: string) => errors[`lines.${key}.${f}`];

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
              help={mode === "new" ? "yang punya Sales Order Open" : undefined}
              error={errors.customer_order_id}
            >
              {mode === "new" ? (
                <Combobox
                  value={header.customer_order_id}
                  options={options.orders
                    .filter((o) => o.status === "Open" && o.salesOrders.some((s) => s.status === "Open"))
                    .map((o) => ({ id: o.id, label: o.orderNo, name: o.customerName, active: true }))}
                  placeholder="Pilih Customer Order…"
                  invalid={Boolean(errors.customer_order_id)}
                  onChange={pickOrder}
                />
              ) : source ? (
                ro(
                  <Link className="drl" href={`/sales/customer-order/${source.id}`}>
                    <span className="mono">{source.orderNo}</span>
                  </Link>
                )
              ) : (
                nil()
              )}
            </Field>
            <Field label="Customer" span={5}>
              {source ? (
                ro(
                  <>
                    <span className="lab">{source.customerLabel}</span>
                    <span>{source.customerName}</span>
                  </>
                )
              ) : (
                nil("menunggu Customer Order")
              )}
            </Field>
            <Field label="No. PO Customer" span={3}>
              {source?.poNo ? ro(<span className="mono">{source.poNo}</span>) : nil()}
            </Field>
          </FormRow>
        </FormSection>
        <FormSection title="Pengiriman">
          <FormRow>
            <Field label="Tanggal DO" span={3} required={editing} error={errors.do_date}>
              {editing ? (
                <DateInput value={header.do_date} invalid={Boolean(errors.do_date)} onChange={(v) => set("do_date", v)} />
              ) : (
                ro(formatDate(header.do_date))
              )}
            </Field>
            <Field
              label="Tanggal Kirim"
              span={3}
              required={editing}
              help={editing ? "mulai dari Sales Order" : undefined}
              error={errors.delivery_date}
            >
              {editing ? (
                <DateInput
                  value={header.delivery_date}
                  invalid={Boolean(errors.delivery_date)}
                  onChange={(v) => {
                    setDateTouched(true);
                    set("delivery_date", v);
                  }}
                />
              ) : (
                ro(formatDate(header.delivery_date))
              )}
            </Field>
            <Field label="Gudang" span={6} required={editing} help={editing ? "asal barang dikirim" : undefined} error={errors.warehouse_id}>
              {editing ? (
                <Combobox
                  value={header.warehouse_id}
                  options={options.warehouses.map((w) => ({ id: w.id, label: w.label, name: w.name, active: w.active }))}
                  placeholder="Pilih Gudang…"
                  invalid={Boolean(errors.warehouse_id)}
                  onChange={(v) => set("warehouse_id", v)}
                />
              ) : warehouse ? (
                ro(
                  <>
                    <span className="lab">{warehouse.label}</span>
                    <span>{warehouse.name}</span>
                  </>
                )
              ) : (
                nil()
              )}
            </Field>
            <Field
              label="Alamat Kirim"
              span={12}
              required={editing}
              help={editing ? "mulai dari alamat Sales Order" : undefined}
              error={errors.address_id}
            >
              {editing ? (
                <Select
                  value={header.address_id ? String(header.address_id) : ""}
                  options={(source?.addresses ?? []).map((a) => ({
                    value: String(a.id),
                    label: a.text,
                    hint: a.id === source?.addressId ? "alamat Customer Order" : undefined,
                  }))}
                  placeholder="Pilih Alamat…"
                  waitingFor={waitOrder}
                  invalid={Boolean(errors.address_id)}
                  listWidth="wide"
                  onChange={(v) => {
                    setAddressTouched(true);
                    set("address_id", v ? Number(v) : null);
                  }}
                />
              ) : address ? (
                <div className="ro multi">{address.text}</div>
              ) : (
                nil()
              )}
            </Field>
            <Field label="Catatan" span={12}>
              {editing ? (
                <textarea
                  className="ta"
                  rows={2}
                  value={header.note}
                  placeholder="Catatan untuk gudang…"
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
        {order?.statusReason && DELIVERY_ORDER_REASON_TEXT[status] && (
          <p className="fnote">
            <b>{DELIVERY_ORDER_REASON_TEXT[status]}:</b> {order.statusReason}
          </p>
        )}
      </FormBody>
    </div>
  );

  // ======================================================== lines card
  const addButton = (cta?: boolean) => (
    <button className={`btn sm primary${cta ? " cta" : ""}`} onClick={() => setPickerOpen(true)}>
      <Icon name="plus" size={14} /> Tambah Item
    </button>
  );
  const linesCard = (
    <div className="card" style={{ marginTop: 14 }}>
      <div className="card-h">
        <span className="ci">
          <Icon name="box" size={15} />
        </span>
        <div className="ct">
          <h3>Barang Dikirim</h3>
          <p>
            {editing
              ? "Pilih barang dari Sales Order Open lewat Tambah Item, lalu isi Qty yang dikirim."
              : "Jumlah per barang dari Sales Order, dalam satuannya."}{" "}
            Harga dan pajak tetap di Customer Order.
          </p>
        </div>
        {editing && source && lines.length > 0 && addButton()}
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
          <h4>{source ? "Belum ada barang" : "Pilih Customer Order dulu…"}</h4>
          <p>
            {source
              ? "Pilih barang Sales Order yang dikirim di Delivery Order ini."
              : "Barang yang dapat dikirim mengikuti baris Sales Order Open dari Customer Order."}
          </p>
          {editing && source && addButton(true)}
        </div>
      ) : (
        <div className="tw">
          <table className="grid ltab" style={{ minWidth: 760 }}>
            <thead>
              <tr>
                <th style={{ width: 40 }}>No</th>
                <th style={{ width: 250 }}>Sales Order</th>
                <th>Barang</th>
                <th style={{ width: editing ? 220 : 160 }}>Qty</th>
                {editing && <th style={{ width: 40 }} />}
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => {
                const so = l.sales_order_line_id ? soLineById.get(l.sales_order_line_id) : undefined;
                const left = so ? so.qty - so.held : 0;
                const typed = Number(l.qty) || 0;
                const over = Boolean(so && typed > left + 1e-9);
                const lineError = lineErr(l.key, "sales_order_line_id") ?? lineErr(l.key, "qty");
                return (
                  <tr key={l.key} className={lineError || over ? "overrow" : undefined}>
                    <td className="no">{i + 1}</td>
                    <td>
                      {so && (
                        <span className="idc">
                          <Link className="lab" href={`/sales/order/${so.salesOrderId}`}>
                            {so.salesOrderNo}
                          </Link>
                          <span className="nm">kirim {formatDate(so.deliveryDate)}</span>
                        </span>
                      )}
                    </td>
                    <td>
                      <span className="idc">
                        <span className="lab">{so?.itemLabel}</span>
                        <span className="nm">{so?.itemName}</span>
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
                              ariaLabel={`Qty ${so?.itemLabel ?? ""}`}
                              onChange={(v) => setLine(l.key, { qty: v })}
                            />
                            <span className="qu">{so?.uomLabel}</span>
                          </div>
                          {so && (
                            <span className="fulltag">
                              maks. {qtyText(left)} {so.uomLabel}
                            </span>
                          )}
                        </>
                      ) : (
                        <span className="qview">
                          <span className="mny">{qtyText(Number(l.qty))}</span>
                          <span className="lab">{so?.uomLabel}</span>
                        </span>
                      )}
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
      {pickerOpen && source && (
        <DeliveryOrderLinePicker
          lines={source.lines}
          current={lines.flatMap((l) => (l.sales_order_line_id ? [l.sales_order_line_id] : []))}
          orderNo={source.orderNo}
          onApply={applyPicked}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </div>
  );

  // ============================================================ page
  return (
    <>
      <div className="ph">
        <div className="crumb">
          <span>Penjualan</span>
          <span>/</span>
          <Link href="/sales/delivery-order">Delivery Order</Link>
          <span>/</span>
          <span className="cur">{order ? order.doNo : "Baru"}</span>
        </div>
        <div className="ph-row">
          <h1>
            <span className="ph-ico">
              <Icon name="truck" size={16} />
            </span>
            {order ? (
              <>
                <span className="docno">{order.doNo}</span>
                <span className={`bdg ${DELIVERY_ORDER_STATUS_BADGE[status]}`}>{DELIVERY_ORDER_STATUS_TEXT[status]}</span>
              </>
            ) : (
              "Delivery Order Baru"
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
              <DeliveryOrderActions id={order!.id} subject={order!.doNo} status={status} can={can} />
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
    </>
  );
}
