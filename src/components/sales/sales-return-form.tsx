"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icon";
import { CancelButton } from "@/components/ui/cancel-button";
import { Combobox } from "@/components/ui/combobox";
import { DateInput } from "@/components/ui/date-input";
import { DocumentHeader } from "@/components/ui/document-header";
import { Field, FormBody, FormRow, FormSection } from "@/components/ui/form";
import { MoneyInput } from "@/components/ui/money-input";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { SalesReturnActions } from "@/components/sales/sales-return-actions";
import { SalesReturnLinePicker } from "@/components/sales/sales-return-line-picker";
import { createSalesReturnAction, updateSalesReturnAction } from "@/app/actions/sales-return";
import {
  SALES_RETURN_REASONS,
  SALES_RETURN_REASON_TEXT,
  SALES_RETURN_STATUS_BADGE,
  SALES_RETURN_STATUS_TEXT,
  salesReturnReasonLabel,
  type SalesReturnAbilities,
} from "@/lib/erp/sales-return-workflow";
import type { SalesReturnHeaderInput, SalesReturnOptions, SalesReturnView } from "@/lib/erp/sales-return";
import { formatDate, formatNumber, todayIso } from "@/lib/format";
import { FormTabs, tabHasError, type FormTab } from "@/components/ui/form-tabs";
import { SaveButtons, firstStep, withStep } from "@/components/ui/save-buttons";
import { SALES_RETURN_TRANSITIONS, availableSalesReturnActions } from "@/lib/erp/sales-return-workflow";

/**
 * A Sales Return in all three modes: `new`, `edit` (Draft only) and `view`
 * (P287, `Sales-Return-Plan.md` §4).
 *
 * It starts from an approved Customer Order with a posted Delivery Note,
 * chosen once and locked — choosing it reloads the page on `?co=`, so only that
 * order's deliveries are read. Its lines are lines of those Delivery Notes,
 * picked in a dialog, each a base quantity never more than what left less what
 * other returns hold. No lot (the Receipt Note picks it), no price and no tax.
 */

export type SalesReturnMode = "new" | "edit" | "view";

type LineState = { key: string; delivery_note_line_id: number | null; qty: string };

let seq = 0;
const newKey = () => `l${Date.now().toString(36)}${seq++}`;
const qtyText = (n: number) => formatNumber(n, n % 1 ? 2 : 0);

export function SalesReturnForm({
  extraTabs,
  mode,
  ret,
  options,
  billing,
  can,
}: {
  /** Tabs the page composes from other modules (§3.1). */
  extraTabs?: FormTab[];
  mode: SalesReturnMode;
  ret: SalesReturnView | null;
  options: SalesReturnOptions;
  /** Which Invoice bills each Delivery Note line — composed by the page from the invoice module. */
  billing: Record<number, { no: string }>;
  can: SalesReturnAbilities;
}) {
  const router = useRouter();
  const toast = useToast();
  const editing = mode !== "view";
  const source = options.source;

  const [header, setHeader] = useState<SalesReturnHeaderInput>(() =>
    ret
      ? { ...ret.header }
      : {
          customer_order_id: source?.id ?? null,
          return_date: todayIso(),
          address_id: source?.addressId ?? null,
          reason: "",
          reason_note: "",
          customer_return_no: "",
          customer_return_date: "",
          note: "",
        }
  );
  const [lines, setLines] = useState<LineState[]>(() =>
    (ret?.lines ?? []).map((l) => ({ key: newKey(), delivery_note_line_id: Number(l.delivery_note_line_id), qty: String(l.qty) }))
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  const dnLineById = useMemo(() => new Map((source?.lines ?? []).map((l) => [l.id, l])), [source]);
  const received = useMemo(
    () => new Map((ret?.lines ?? []).map((l) => [Number(l.delivery_note_line_id), l.received])),
    [ret]
  );
  const address = source?.addresses.find((a) => a.id === header.address_id);

  const touch = (...names: string[]) => {
    setDirty(true);
    setErrors((e) => {
      const next = { ...e };
      for (const n of names) delete next[n];
      return next;
    });
  };
  const set = <K extends keyof SalesReturnHeaderInput>(k: K, v: SalesReturnHeaderInput[K]) => {
    setHeader((x) => ({ ...x, [k]: v }));
    touch(k);
  };
  const setLine = (key: string, patch: Partial<LineState>) => {
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
    touch("_lines");
  };
  /** The picker's ticks become the lines: kept ones keep their quantity, new ones start blank. */
  const applyPicked = (ids: number[]) => {
    setLines((ls) =>
      ids.map((id) => ls.find((l) => l.delivery_note_line_id === id) ?? { key: newKey(), delivery_note_line_id: id, qty: "" })
    );
    touch("_lines");
    setPickerOpen(false);
  };

  // Every editable document is a Draft, so its next step is the Draft's (P309).
  const next = firstStep(availableSalesReturnActions("Draft", can), SALES_RETURN_TRANSITIONS);

  async function onSave(step?: string) {
    setSaving(true);
    // Every line was picked on purpose, so a blank quantity is sent and refused on its row.
    const sent = lines;
    const payload = sent.map((l) => ({ delivery_note_line_id: l.delivery_note_line_id, qty: l.qty, note: "" }));
    const result =
      mode === "edit" ? await updateSalesReturnAction(ret!.id, header, payload) : await createSalesReturnAction(header, payload);
    setSaving(false);
    if (!result.ok) {
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
    toast("Sales Return disimpan", `${result.returnNo} · Draft`, "ok");
    router.push(withStep(`/sales/return/${result.id}`, step));
  }

  const status = ret?.status ?? "Draft";
  const backHref = ret ? `/sales/return/${ret.id}` : "/sales/return";
  const ro = (node: React.ReactNode) => <div className="ro">{node}</div>;
  const nil = (text = "tidak diisi") => <div className="ro nil">{text}</div>;
  const lineErr = (key: string, f: string) => errors[`lines.${key}.${f}`];
  const showReceived = status === "Open" || status === "Closed";

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
              help={mode === "new" ? "yang punya Delivery Note posted" : undefined}
              error={errors.customer_order_id}
            >
              {mode === "new" ? (
                <Combobox
                  value={header.customer_order_id}
                  options={options.orders.map((o) => ({ id: o.id, label: o.orderNo, name: o.customerName, active: true }))}
                  placeholder="Pilih Customer Order…"
                  emptyText="Belum ada Customer Order dengan Delivery Note yang diposting."
                  invalid={Boolean(errors.customer_order_id)}
                  onChange={(id) => router.replace(id ? `/sales/return/new?co=${id}` : "/sales/return/new")}
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
        <FormSection title="Retur">
          <FormRow>
            <Field label="Tanggal Retur" span={3} required={editing} error={errors.return_date}>
              {editing ? (
                <DateInput value={header.return_date} invalid={Boolean(errors.return_date)} onChange={(v) => set("return_date", v)} />
              ) : (
                ro(formatDate(header.return_date))
              )}
            </Field>
            <Field label="Alasan" span={3} required={editing} error={errors.reason}>
              {editing ? (
                <Select
                  value={header.reason}
                  options={SALES_RETURN_REASONS.map((r) => ({ value: r.key, label: r.label }))}
                  placeholder="Pilih Alasan…"
                  invalid={Boolean(errors.reason)}
                  onChange={(v) => set("reason", v)}
                />
              ) : (
                ro(salesReturnReasonLabel(header.reason))
              )}
            </Field>
            <Field
              label="Keterangan Alasan"
              span={6}
              required={editing && header.reason === "other"}
              help={editing && header.reason !== "other" ? "jika perlu" : undefined}
              error={errors.reason_note}
            >
              {editing ? (
                <input
                  className={`inp${errors.reason_note ? " bad" : ""}`}
                  value={header.reason_note}
                  placeholder="Mis. kemasan penyok saat diterima…"
                  autoComplete="off"
                  onChange={(e) => set("reason_note", e.target.value)}
                />
              ) : header.reason_note ? (
                ro(header.reason_note)
              ) : (
                nil()
              )}
            </Field>
            <Field
              label="Alamat Pengambilan"
              span={12}
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
                  waitingFor={source ? null : "Pilih Customer Order dulu…"}
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
            <Field label="No. Nota Retur Customer" span={4} help={editing ? "dari pembeli PKP, jika sudah ada" : undefined}>
              {editing ? (
                <input
                  className="inp idf"
                  value={header.customer_return_no}
                  placeholder="Nomor Nota Retur…"
                  autoComplete="off"
                  onChange={(e) => set("customer_return_no", e.target.value)}
                />
              ) : header.customer_return_no ? (
                ro(<span className="mono">{header.customer_return_no}</span>)
              ) : (
                nil()
              )}
            </Field>
            <Field label="Tanggal Nota Retur" span={3} error={errors.customer_return_date}>
              {editing ? (
                <DateInput
                  value={header.customer_return_date}
                  invalid={Boolean(errors.customer_return_date)}
                  onChange={(v) => set("customer_return_date", v)}
                />
              ) : header.customer_return_date ? (
                ro(formatDate(header.customer_return_date))
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
        {ret?.statusReason && SALES_RETURN_REASON_TEXT[status] && (
          <p className="fnote">
            <b>{SALES_RETURN_REASON_TEXT[status]}:</b> {ret.statusReason}
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
    <div className="card">
      <div className="card-h">
        <span className="ci">
          <Icon name="box" size={15} />
        </span>
        <div className="ct">
          <h3>Barang Diretur</h3>
          <p>
            {editing
              ? "Pilih barang dari Delivery Note yang sudah diposting lewat Tambah Item, lalu isi Qty yang dikembalikan."
              : "Jumlah per barang dalam satuan dasar."}{" "}
            Lot dipilih gudang di Receipt Note.
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
              ? "Pilih barang Delivery Note yang dikembalikan customer."
              : "Barang yang dapat diretur mengikuti Delivery Note yang sudah diposting pada Customer Order."}
          </p>
          {editing && source && addButton(true)}
        </div>
      ) : (
        <div className="tw">
          <table className="grid ltab" style={{ minWidth: 760 }}>
            <thead>
              <tr>
                <th style={{ width: 40 }}>No</th>
                <th style={{ width: 210 }}>Delivery Note</th>
                <th>Barang</th>
                <th style={{ width: editing ? 220 : 150 }}>Qty</th>
                {showReceived && <th style={{ width: 130 }}>Diterima</th>}
                {editing && <th style={{ width: 40 }} />}
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => {
                const dn = l.delivery_note_line_id ? dnLineById.get(l.delivery_note_line_id) : undefined;
                const left = dn ? dn.baseQty - dn.held : 0;
                const typed = Number(l.qty) || 0;
                const over = Boolean(dn && typed > left + 1e-9);
                const lineError = lineErr(l.key, "delivery_note_line_id") ?? lineErr(l.key, "qty");
                return (
                  <tr key={l.key} className={lineError || over ? "overrow" : undefined}>
                    <td className="no">{i + 1}</td>
                    <td>
                      {dn && (
                        <span className="idc">
                          <Link className="lab" href={`/inventory/delivery-note/${dn.deliveryNoteId}`}>
                            {dn.dnNo}
                          </Link>
                          <span className="nm">
                            kirim {formatDate(dn.dnDate)}
                            {billing[dn.id] ? ` · ditagih ${billing[dn.id].no}` : ""}
                          </span>
                        </span>
                      )}
                    </td>
                    <td>
                      <span className="idc">
                        <span className="lab">{dn?.itemLabel}</span>
                        <span className="nm">{dn?.itemName}</span>
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
                              ariaLabel={`Qty ${dn?.itemLabel ?? ""}`}
                              onChange={(v) => setLine(l.key, { qty: v })}
                            />
                            <span className="qu">{dn?.uomLabel}</span>
                          </div>
                          {dn && (
                            <span className="fulltag">
                              maks. {qtyText(left)} {dn.uomLabel}
                            </span>
                          )}
                        </>
                      ) : (
                        <span className="qview">
                          <span className="mny">{qtyText(Number(l.qty))}</span>
                          <span className="lab">{dn?.uomLabel}</span>
                        </span>
                      )}
                    </td>
                    {showReceived && (
                      <td>
                        <span className="qview">
                          <span className="mny">{qtyText(received.get(Number(l.delivery_note_line_id)) ?? 0)}</span>
                          <span className="lab">{dn?.uomLabel}</span>
                        </span>
                      </td>
                    )}
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
        <SalesReturnLinePicker
          lines={source.lines}
          current={lines.flatMap((l) => (l.delivery_note_line_id ? [l.delivery_note_line_id] : []))}
          orderNo={source.orderNo}
          billing={billing}
          onApply={applyPicked}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </div>
  );

  // ============================================================ page
  return (
    <>
      <DocumentHeader
        module="Penjualan"
        trail={[{ label: "Sales Return", href: "/sales/return" }]}
        icon="box"
        number={ret?.returnNo}
        placeholder="Sales Return Baru"
        status={status}
        statusLabel={{ text: SALES_RETURN_STATUS_TEXT[status], tone: SALES_RETURN_STATUS_BADGE[status] }}
        editing={mode === "edit"}
        dirty={editing && dirty}
      >
        {editing ? (
          <>
            <CancelButton href={backHref} dirty={dirty} disabled={saving} />
            <SaveButtons saving={saving} onSave={onSave} next={next} />
          </>
        ) : (
          <SalesReturnActions id={ret!.id} subject={ret!.returnNo} status={status} can={can} />
        )}
      </DocumentHeader>

      <div className="fgrid solo">
        <div>
          {headerCard}
          <FormTabs
            tabs={[
              { key: "lines", label: "Barang", icon: "box", count: lines.length, bad: tabHasError(errors, "_lines", "lines.", "line."), content: linesCard },
              ...(extraTabs ?? []),
            ]}
          />
        </div>
      </div>
    </>
  );
}
