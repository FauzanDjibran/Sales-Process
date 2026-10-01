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
import { createSalesOrderAction, updateSalesOrderAction } from "@/app/actions/sales-order";
import {
  SALES_ORDER_REASON_TEXT,
  SALES_ORDER_STATUS_BADGE,
  SALES_ORDER_STATUS_TEXT,
  type SalesOrderAbilities,
} from "@/lib/erp/sales-order-workflow";
import type { SalesOrderHeaderInput, SalesOrderOptions, SalesOrderView, SoSourceOption } from "@/lib/erp/sales-order";
import { formatDate, formatNumber, todayIso } from "@/lib/format";

/**
 * A Sales Order in all three modes: `new`, `edit` (Draft only) and `view`
 * (P79).
 *
 * It starts from an Open Customer Order, chosen once and locked: the customer,
 * the PO and the items come from it, and its address is where the goods go
 * unless another of the customer's addresses is picked. Each line takes a
 * quantity of one of the Customer Order's lines, in that line's unit, never
 * more than what other Sales Orders have left of it. No price and no tax:
 * those stay on the Customer Order, which every financial document is drawn
 * from.
 */

export type SalesOrderMode = "new" | "edit" | "view";

type LineState = { key: string; customer_order_line_id: number | null; qty: string };

let seq = 0;
const newKey = () => `l${Date.now().toString(36)}${seq++}`;
const qtyText = (n: number) => formatNumber(n, n % 1 ? 2 : 0);

/**
 * A fresh Draft's lines: every Customer Order line with something left, the
 * quantity still to type. A line left blank is not part of the Sales Order.
 */
const linesFor = (o: SoSourceOption | undefined): LineState[] =>
  (o?.lines ?? [])
    .filter((l) => l.qty - l.held > 0)
    .map((l) => ({ key: newKey(), customer_order_line_id: l.id, qty: "" }));

export function SalesOrderForm({
  mode,
  order,
  options,
  can,
  presetCustomerOrderId = null,
}: {
  mode: SalesOrderMode;
  order: SalesOrderView | null;
  options: SalesOrderOptions;
  can: SalesOrderAbilities;
  /** `?co=<id>` — a new Sales Order started from a Customer Order's page. */
  presetCustomerOrderId?: number | null;
}) {
  const router = useRouter();
  const toast = useToast();
  const editing = mode !== "view";
  const orderById = useMemo(() => new Map(options.orders.map((o) => [o.id, o])), [options.orders]);

  const [header, setHeader] = useState<SalesOrderHeaderInput>(() => {
    if (order) return { ...order.header };
    const preset = presetCustomerOrderId ? orderById.get(presetCustomerOrderId) : undefined;
    return {
      customer_order_id: preset?.id ?? null,
      order_date: todayIso(),
      delivery_date: "",
      address_id: preset?.addressId ?? null,
      note: "",
    };
  });
  const [lines, setLines] = useState<LineState[]>(() =>
    order
      ? order.lines.map((l) => ({
          key: newKey(),
          customer_order_line_id: Number(l.customer_order_line_id),
          qty: String(l.qty),
        }))
      : linesFor(presetCustomerOrderId ? orderById.get(presetCustomerOrderId) : undefined)
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  const source = header.customer_order_id ? orderById.get(header.customer_order_id) : undefined;
  const coLineById = useMemo(() => new Map((source?.lines ?? []).map((l) => [l.id, l])), [source]);
  const address = source?.addresses.find((a) => a.id === header.address_id);

  const touch = (...names: string[]) => {
    setDirty(true);
    setErrors((e) => {
      const next = { ...e };
      for (const n of names) delete next[n];
      return next;
    });
  };
  const set = <K extends keyof SalesOrderHeaderInput>(k: K, v: SalesOrderHeaderInput[K]) => {
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
    setLines(linesFor(o));
    touch("customer_order_id", "address_id", "_lines");
  };

  async function onSave() {
    setSaving(true);
    // A line left without a quantity is a Customer Order line this delivery
    // does not take; it is not sent, rather than refused.
    const sent = lines.filter((l) => l.qty.trim() !== "");
    const payload = sent.map((l) => ({ customer_order_line_id: l.customer_order_line_id, qty: l.qty, note: "" }));
    const result =
      mode === "edit" ? await updateSalesOrderAction(order!.id, header, payload) : await createSalesOrderAction(header, payload);
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
    toast("Sales Order disimpan", `${result.orderNo} · Draft`, "ok");
    router.push(`/sales/order/${result.id}`);
    router.refresh();
  }

  const status = order?.status ?? "Draft";
  const backHref = order ? `/sales/order/${order.id}` : "/sales/order";
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
              help={mode === "new" ? "hanya CO berstatus Open" : undefined}
              error={errors.customer_order_id}
            >
              {mode === "new" ? (
                <Combobox
                  value={header.customer_order_id}
                  options={options.orders
                    .filter((o) => o.status === "Open")
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
            <Field label="Tanggal SO" span={3} required={editing} error={errors.order_date}>
              {editing ? (
                <DateInput value={header.order_date} invalid={Boolean(errors.order_date)} onChange={(v) => set("order_date", v)} />
              ) : (
                ro(formatDate(header.order_date))
              )}
            </Field>
            <Field
              label="Tanggal Kirim"
              span={3}
              required={editing}
              help={editing ? "yang direncanakan PPIC" : undefined}
              error={errors.delivery_date}
            >
              {editing ? (
                <DateInput
                  value={header.delivery_date}
                  invalid={Boolean(errors.delivery_date)}
                  onChange={(v) => set("delivery_date", v)}
                />
              ) : (
                ro(formatDate(header.delivery_date))
              )}
            </Field>
            <Field
              label="Alamat Kirim"
              span={6}
              required={editing}
              help={editing ? "mulai dari alamat Customer Order" : undefined}
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
                  onChange={(v) => set("address_id", v ? Number(v) : null)}
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
                  placeholder="Catatan untuk PPIC…"
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
        {order?.statusReason && SALES_ORDER_REASON_TEXT[status] && (
          <p className="fnote">
            <b>{SALES_ORDER_REASON_TEXT[status]}:</b> {order.statusReason}
          </p>
        )}
      </FormBody>
    </div>
  );

  // ======================================================== lines card
  const usedLineIds = (key: string) => new Set(lines.filter((x) => x.key !== key).map((x) => x.customer_order_line_id));
  const linesCard = (
    <div className="card" style={{ marginTop: 14 }}>
      <div className="card-h">
        <span className="ci">
          <Icon name="box" size={15} />
        </span>
        <div className="ct">
          <h3>Barang Dikirim</h3>
          <p>
            Jumlah per barang dari Customer Order, dalam satuannya. {editing && "Kosongkan Qty untuk barang yang tidak dikirim di Sales Order ini. "}
            Harga dan pajak tetap di Customer Order.
          </p>
        </div>
        {editing && source && (
          <button
            className="btn sm primary"
            disabled={lines.length >= source.lines.length}
            onClick={() => {
              setLines((ls) => [...ls, { key: newKey(), customer_order_line_id: null, qty: "" }]);
              touch("_lines");
            }}
          >
            <Icon name="plus" size={14} /> Tambah Baris
          </button>
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
      {lines.length === 0 ? (
        <div className="empty sm">
          <div className="ic">
            <Icon name="box" size={18} />
          </div>
          <h4>{source ? "Belum ada barang" : "Pilih Customer Order dulu…"}</h4>
          <p>
            {source
              ? "Seluruh jumlah Customer Order ini sudah dijadwalkan, atau semua baris dihapus."
              : "Barang yang dapat dikirim mengikuti baris Customer Order."}
          </p>
        </div>
      ) : (
        <div className="tw">
          <table className="grid ltab">
            <thead>
              <tr>
                <th style={{ width: 34 }}>No</th>
                <th style={{ minWidth: 280 }}>Barang</th>
                <th style={{ width: 96 }}>Satuan</th>
                <th className="num" style={{ width: 170 }}>
                  Qty
                </th>
                {editing && <th style={{ width: 40 }} />}
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => {
                const co = l.customer_order_line_id ? coLineById.get(l.customer_order_line_id) : undefined;
                const left = co ? co.qty - co.held : 0;
                const typed = Number(l.qty) || 0;
                const over = Boolean(co && typed > left + 1e-9);
                const lineError = lineErr(l.key, "customer_order_line_id") ?? lineErr(l.key, "qty");
                return (
                  <tr key={l.key} className={lineError || over ? "overrow" : undefined}>
                    <td className="no">{i + 1}</td>
                    <td>
                      {editing ? (
                        <Select
                          size="sm"
                          value={l.customer_order_line_id ? String(l.customer_order_line_id) : ""}
                          options={(source?.lines ?? [])
                            .filter((o) => o.id === l.customer_order_line_id || !usedLineIds(l.key).has(o.id))
                            .map((o) => ({
                              value: String(o.id),
                              label: `${o.itemLabel} — ${o.itemName}`,
                              hint: `sisa ${qtyText(o.qty - o.held)} ${o.uomLabel}`,
                            }))}
                          placeholder="Pilih Barang…"
                          waitingFor={waitOrder}
                          ariaLabel="Barang"
                          onChange={(v) => setLine(l.key, { customer_order_line_id: v ? Number(v) : null })}
                        />
                      ) : (
                        <span className="idc">
                          <span className="lab">{co?.itemLabel}</span>
                          <span className="nm">{co?.itemName}</span>
                        </span>
                      )}
                      {lineError && <span className="overtag">{lineError}</span>}
                    </td>
                    <td>
                      <span className="lab">{co?.uomLabel ?? "—"}</span>
                    </td>
                    <td className="num">
                      {editing ? (
                        <>
                          <MoneyInput
                            size="sm"
                            decimals={4}
                            value={l.qty}
                            over={over}
                            ariaLabel={`Qty ${co?.itemLabel ?? ""}`}
                            onChange={(v) => setLine(l.key, { qty: v })}
                          />
                          {co && (
                            <span className="fulltag">
                              sisa CO {qtyText(left)} {co.uomLabel}
                            </span>
                          )}
                        </>
                      ) : (
                        <span className="mny">{qtyText(Number(l.qty))}</span>
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
              <Icon name="cal" size={16} />
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
    </>
  );
}
