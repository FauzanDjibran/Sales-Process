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
import { DEFAULT_DELIVERY_NOTE_PURPOSE, deliveryNotePurpose } from "@/lib/erp/delivery-note-purposes";
import { DeliveryNoteActions } from "@/components/logistics/delivery-note-actions";
import { DeliveryNoteLinePicker } from "@/components/logistics/delivery-note-line-picker";
import { DeliveryNoteLotPicker, type LotPick } from "@/components/logistics/delivery-note-lot-picker";
import { createDeliveryNoteAction, updateDeliveryNoteAction } from "@/app/actions/delivery-note";
import {
  DELIVERY_NOTE_STATUS_BADGE,
  DELIVERY_NOTE_STATUS_TEXT,
  type DeliveryNoteAbilities,
} from "@/lib/erp/delivery-note-workflow";
import type {
  DeliveryNoteHeaderInput,
  DeliveryNoteOptions,
  DeliveryNoteView,
  DnSourceLine,
} from "@/lib/erp/delivery-note";
import { formatDate, formatMoney, formatNumber, todayIso } from "@/lib/format";

/**
 * A Delivery Note in all three modes: `new`, `edit` (Draft only) and `view`
 * (C28, U11–U14).
 *
 * It starts from an issued Delivery Order, chosen once and locked: the
 * Customer Order, customer, warehouse and address all come from it and are
 * shown, not chosen. The user sets the day the goods leave, the vehicle and the
 * driver, and picks which of the order's lines leave now and how much — and,
 * for an item kept by lot, which lots they leave from (U15). Once posted, each line shows the Harga Pokok it left at and the HPP it booked.
 */

export type DeliveryNoteMode = "new" | "edit" | "view";

type LineState = { key: string; source_doc_line_id: number | null; qty: string; picks: LotPick[] };

let seq = 0;
const newKey = () => `l${Date.now().toString(36)}${seq++}`;
const qtyText = (n: number) => formatNumber(n, n % 1 ? 2 : 0);
const money = (n: number) => formatMoney(n, "IDR");

export function DeliveryNoteForm({
  mode,
  note,
  options,
  can,
  presetDeliveryOrderId = null,
  billing = null,
}: {
  mode: DeliveryNoteMode;
  note: DeliveryNoteView | null;
  options: DeliveryNoteOptions;
  can: DeliveryNoteAbilities;
  /** `?do=<id>` — started from a Delivery Order's page: its open lines start ticked. */
  presetDeliveryOrderId?: number | null;
  /** For a posted note: the live Invoice billing each line, by line id (U17). */
  billing?: Record<number, { id: number; no: string; status: string }> | null;
}) {
  const router = useRouter();
  const toast = useToast();
  const editing = mode !== "view";
  const orderById = useMemo(() => new Map(options.orders.map((o) => [o.id, o])), [options.orders]);
  const preset = presetDeliveryOrderId ? orderById.get(presetDeliveryOrderId) : undefined;

  const [header, setHeader] = useState<DeliveryNoteHeaderInput>(() =>
    note
      ? { ...note.header }
      : { purpose: DEFAULT_DELIVERY_NOTE_PURPOSE, source_doc_id: preset?.id ?? null, dn_date: todayIso(), vehicle_no: "", driver_name: "", note: "" }
  );
  const [lines, setLines] = useState<LineState[]>(() => {
    if (note) {
      return note.lines.map((l) => ({
        key: newKey(),
        source_doc_line_id: Number(l.source_doc_line_id),
        qty: String(l.qty),
        picks: (l.picks ?? []).map((p) => ({ lot_id: Number(p.lot_id), qty: String(p.qty) })),
      }));
    }
    return (preset?.lines ?? [])
      .filter((l) => l.qty - l.held > 0)
      .map((l) => ({ key: newKey(), source_doc_line_id: l.id, qty: "", picks: [] }));
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [lotsFor, setLotsFor] = useState<string | null>(null);

  const source = header.source_doc_id ? orderById.get(header.source_doc_id) : undefined;
  const doLineById = useMemo(() => new Map((source?.lines ?? []).map((l) => [l.id, l])), [source]);
  const posted = note?.status === "Posted";

  const touch = (...names: string[]) => {
    setDirty(true);
    setErrors((e) => {
      const next = { ...e };
      for (const n of names) delete next[n];
      return next;
    });
  };
  const set = <K extends keyof DeliveryNoteHeaderInput>(k: K, v: DeliveryNoteHeaderInput[K]) => {
    setHeader((x) => ({ ...x, [k]: v }));
    touch(k);
  };
  const setLine = (key: string, patch: Partial<LineState>) => {
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
    touch("_lines");
  };
  const pickOrder = (id: number | null) => {
    setHeader((x) => ({ ...x, source_doc_id: id }));
    setLines([]);
    touch("source_doc_id", "_lines");
  };
  /** The picker's ticks become the lines: kept ones keep their quantity, new ones start blank. */
  const applyPicked = (ids: number[]) => {
    setLines((ls) =>
      ids.map((id) => ls.find((l) => l.source_doc_line_id === id) ?? { key: newKey(), source_doc_line_id: id, qty: "", picks: [] })
    );
    touch("_lines");
    setPickerOpen(false);
  };

  async function onSave() {
    setSaving(true);
    // Every line was picked on purpose, so a blank quantity is sent and refused
    // on its row rather than quietly dropped.
    const sent = lines;
    const payload = sent.map((l) => ({ source_doc_line_id: l.source_doc_line_id, qty: l.qty, note: "", picks: l.picks }));
    const result =
      mode === "edit" ? await updateDeliveryNoteAction(note!.id, header, payload) : await createDeliveryNoteAction(header, payload);
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
    toast("Delivery Note disimpan", `${result.dnNo} · Draft`, "ok");
    router.push(`/logistics/delivery-note/${result.id}`);
  }

  const status = note?.status ?? "Draft";
  const backHref = note ? `/logistics/delivery-note/${note.id}` : "/logistics/delivery-note";
  const ro = (node: React.ReactNode) => <div className="ro">{node}</div>;
  const nil = (text = "tidak diisi") => <div className="ro nil">{text}</div>;
  const waitOrder = "menunggu Delivery Order";
  const lineErr = (key: string, f: string) => errors[`lines.${key}.${f}`];

  // ======================================================= header card
  const headerCard = (
    <div className="card">
      <FormBody>
        <FormSection title="Delivery Order">
          <FormRow>
            <Field label="Tujuan" span={4} locked={mode !== "view"} help={mode !== "view" ? "menentukan sumber dan jurnalnya" : undefined}>
              {ro(deliveryNotePurpose(header.purpose ?? DEFAULT_DELIVERY_NOTE_PURPOSE)?.name ?? header.purpose)}
            </Field>
          </FormRow>
          <FormRow>
            <Field
              label="Delivery Order"
              span={4}
              required={mode === "new"}
              locked={mode === "edit"}
              help={mode === "new" ? "yang sudah diterbitkan" : undefined}
              error={errors.source_doc_id}
            >
              {mode === "new" ? (
                <Combobox
                  value={header.source_doc_id}
                  options={options.orders
                    .filter((o) => o.status === "Issued")
                    .map((o) => ({ id: o.id, label: o.doNo, name: o.customerName, active: true }))}
                  placeholder="Pilih Delivery Order…"
                  emptyText="Belum ada Delivery Order yang diterbitkan."
                  invalid={Boolean(errors.source_doc_id)}
                  onChange={pickOrder}
                />
              ) : source ? (
                ro(
                  <Link className="drl" href={`/sales/delivery-order/${source.id}`}>
                    <span className="mono">{source.doNo}</span>
                  </Link>
                )
              ) : (
                nil()
              )}
            </Field>
            <Field label="Customer Order" span={3}>
              {source ? (
                ro(
                  <Link className="drl" href={`/sales/customer-order/${source.customerOrderId}`}>
                    <span className="mono">{source.customerOrderNo}</span>
                  </Link>
                )
              ) : (
                nil(waitOrder)
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
                nil(waitOrder)
              )}
            </Field>
          </FormRow>
        </FormSection>
        <FormSection title="Pengiriman">
          <FormRow>
            <Field
              label="Tanggal Kirim"
              span={3}
              required={editing}
              help={editing ? "hari barang keluar" : undefined}
              error={errors.dn_date}
            >
              {editing ? (
                <DateInput value={header.dn_date} invalid={Boolean(errors.dn_date)} onChange={(v) => set("dn_date", v)} />
              ) : (
                ro(formatDate(header.dn_date))
              )}
            </Field>
            <Field label="Gudang" span={3} help={editing ? "dari Delivery Order" : undefined}>
              {source ? (
                ro(
                  <>
                    <span className="lab">{source.warehouseLabel}</span>
                    <span>{source.warehouseName}</span>
                  </>
                )
              ) : (
                nil(waitOrder)
              )}
            </Field>
            <Field label="No. Kendaraan" span={3}>
              {editing ? (
                <input
                  className="inp"
                  value={header.vehicle_no}
                  placeholder="B 1234 XYZ"
                  onChange={(e) => set("vehicle_no", e.target.value)}
                />
              ) : header.vehicle_no ? (
                ro(<span className="mono">{header.vehicle_no}</span>)
              ) : (
                nil()
              )}
            </Field>
            <Field label="Pengemudi" span={3}>
              {editing ? (
                <input
                  className="inp"
                  value={header.driver_name}
                  placeholder="Nama pengemudi"
                  onChange={(e) => set("driver_name", e.target.value)}
                />
              ) : header.driver_name ? (
                ro(header.driver_name)
              ) : (
                nil()
              )}
            </Field>
            <Field label="Alamat Kirim" span={posted ? 8 : 12} help={editing ? "dari Delivery Order" : undefined}>
              {source ? <div className="ro multi">{source.addressText}</div> : nil(waitOrder)}
            </Field>
            {posted && (
              <Field label="Journal" span={4}>
                {note?.journalId
                  ? ro(
                      <Link className="drl" href={`/accounting/journal/${note.journalId}`}>
                        <span className="mono">{note.journalNo}</span>
                      </Link>
                    )
                  : nil()}
              </Field>
            )}
            <Field label="Catatan" span={12}>
              {editing ? (
                <textarea
                  className="ta"
                  rows={2}
                  value={header.note}
                  placeholder="Catatan pada surat jalan…"
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
        {note?.cancelReason && status === "Cancelled" && (
          <p className="fnote">
            <b>Dibatalkan:</b> {note.cancelReason}
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
  const viewLines = note?.lines ?? [];
  /**
   * The Lot cell: for an item kept by lot, what is picked against the line's
   * quantity — a button in a Draft being edited, the lots themselves otherwise.
   */
  const lotCell = (l: LineState, d: DnSourceLine | undefined, stored?: DeliveryNoteView["lines"][number]) => {
    if (!d) return null;
    if (!d.lotTracked) return <span className="dash">tanpa lot</span>;
    const lineQty = Number(String(l.qty).replace(",", ".")) || 0;
    const picked = l.picks.reduce((s, p) => s + Math.round(Number(p.qty) * 10_000), 0) / 10_000;
    const full = lineQty > 0 && Math.abs(picked - lineQty) < 1e-9;
    if (editing) {
      return (
        <>
          <button className="btn sm" disabled={!(lineQty > 0)} title={lineQty > 0 ? undefined : "Isi Qty dulu"} onClick={() => setLotsFor(l.key)}>
            <Icon name="layers" size={14} /> {l.picks.length ? `${l.picks.length} lot` : "Pilih Lot"}
          </button>
          <span className={full ? "fulltag" : "overtag"}>
            {lineQty > 0 ? `${qtyText(picked)} / ${qtyText(lineQty)} ${d.uomLabel}${full ? "" : " · belum penuh"}` : "isi Qty dulu"}
          </span>
        </>
      );
    }
    const lots = stored?.pickedLots ?? [];
    const names = new Map((source?.lots[d.itemId] ?? []).map((x) => [x.id, x]));
    if (!lots.length) return <span className="overtag">Belum dipilih</span>;
    return (
      <span className="dstack" style={{ gap: 4 }}>
        {lots.map((p) => {
          const expiry = p.expiry ?? names.get(p.lotId)?.expiry ?? null;
          return (
            <span key={p.lotId} className="dstack">
              <span className="lab" title={p.lotNo}>
                {p.lotNo}
              </span>
              {/* The quantity goes under the lot, so a long lot number never hides it. */}
              <span className="d2">
                {qtyText(p.qty)} {d.uomLabel}
                {expiry ? ` · ED ${formatDate(expiry)}` : ""}
              </span>
            </span>
          );
        })}
        {!posted && !full && <span className="overtag">{qtyText(picked)} dari {qtyText(lineQty)} · belum penuh</span>}
      </span>
    );
  };
  const linesCard = (
    <div className="card" style={{ marginTop: 14 }}>
      <div className="card-h">
        <span className="ci">
          <Icon name="box" size={15} />
        </span>
        <div className="ct">
          <h3>Barang Keluar</h3>
          <p>
            {editing
              ? "Pilih barang dari Delivery Order lewat Tambah Item, isi Qty yang keluar, lalu pilih lotnya untuk barang yang dikelola per lot."
              : posted
                ? "Jumlah yang keluar dan lotnya, dengan Harga Pokok saat diposting dan HPP yang dijurnal."
                : "Jumlah per barang dari Delivery Order, dalam satuannya, dan lot yang dipilih."}{" "}
            Harga jual dan pajak tetap di Customer Order.
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
          <h4>{source ? "Belum ada barang" : "Pilih Delivery Order dulu…"}</h4>
          <p>
            {source
              ? "Pilih barang Delivery Order yang keluar dengan Delivery Note ini."
              : "Barang yang dapat dikirim mengikuti baris Delivery Order yang sudah diterbitkan."}
          </p>
          {editing && source && addButton(true)}
        </div>
      ) : (
        <div className="tw">
          <table className="grid ltab" style={{ minWidth: posted ? (billing ? 1000 : 900) : 900 }}>
            <thead>
              <tr>
                <th style={{ width: 40 }}>No</th>
                <th style={{ width: 130 }}>Sales Order</th>
                <th>Barang</th>
                <th style={{ width: editing ? 220 : 110 }}>Qty</th>
                <th style={{ width: editing ? 170 : 190 }}>Lot</th>
                {posted && (
                  <>
                    <th className="num" style={{ width: 120 }}>
                      Harga Pokok
                    </th>
                    <th className="num" style={{ width: 130 }}>
                      HPP
                    </th>
                    {billing && <th style={{ width: 140 }}>Ditagih</th>}
                  </>
                )}
                {editing && <th style={{ width: 40 }} />}
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => {
                const d = l.source_doc_line_id ? doLineById.get(l.source_doc_line_id) : undefined;
                const left = d ? d.qty - d.held : 0;
                const typed = Number(l.qty) || 0;
                const over = Boolean(d && typed > left + 1e-9);
                const lineError = lineErr(l.key, "source_doc_line_id") ?? lineErr(l.key, "qty") ?? lineErr(l.key, "picks");
                const stored = viewLines[i];
                return (
                  <tr key={l.key} className={lineError || over ? "overrow" : undefined}>
                    <td className="no">{i + 1}</td>
                    <td>
                      {d && (
                        <Link className="lab" href={`/sales/order/${d.salesOrderId}`}>
                          {d.salesOrderNo}
                        </Link>
                      )}
                    </td>
                    <td>
                      <span className="idc">
                        <span className="lab">{d?.itemLabel}</span>
                        <span className="nm">{d?.itemName}</span>
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
                              ariaLabel={`Qty ${d?.itemLabel ?? ""}`}
                              onChange={(v) => setLine(l.key, { qty: v })}
                            />
                            <span className="qu">{d?.uomLabel}</span>
                          </div>
                          {d && (
                            <span className="fulltag">
                              maks. {qtyText(left)} {d.uomLabel}
                            </span>
                          )}
                        </>
                      ) : (
                        <span className="qview">
                          <span className="mny">{qtyText(Number(l.qty))}</span>
                          <span className="lab">{d?.uomLabel}</span>
                        </span>
                      )}
                    </td>
                    <td>{lotCell(l, d, stored)}</td>
                    {posted && (
                      <>
                        <td className="num">
                          <span className="mny">{money(stored?.unitCost ?? 0)}</span>
                        </td>
                        <td className="num">
                          <span className="mny">{money(stored?.cost ?? 0)}</span>
                        </td>
                        {billing && (
                          <td>
                            {stored && billing[stored.id] ? (
                              <Link className="lab" href={`/finance/invoice/sales/${billing[stored.id].id}`}>
                                {billing[stored.id].no}
                              </Link>
                            ) : (
                              <span className="dash">Belum ditagih</span>
                            )}
                          </td>
                        )}
                      </>
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
            {posted && (
              <tfoot>
                <tr className="totrow">
                  <td colSpan={6} style={{ textAlign: "right" }}>
                    Total HPP
                  </td>
                  <td className="num">
                    <span className="mny">{money(note?.cost ?? 0)}</span>
                  </td>
                  {billing && <td />}
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}
      {lotsFor && source && (() => {
        const l = lines.find((x) => x.key === lotsFor);
        const d = l?.source_doc_line_id ? doLineById.get(l.source_doc_line_id) : undefined;
        if (!l || !d) return null;
        return (
          <DeliveryNoteLotPicker
            line={d}
            lots={source.lots[d.itemId] ?? []}
            lineQty={Number(String(l.qty).replace(",", ".")) || 0}
            current={l.picks}
            shipDate={header.dn_date}
            onApply={(picks) => {
              setLine(l.key, { picks });
              touch(`lines.${l.key}.picks`);
              setLotsFor(null);
            }}
            onClose={() => setLotsFor(null)}
          />
        );
      })()}
      {pickerOpen && source && (
        <DeliveryNoteLinePicker
          lines={source.lines}
          current={lines.flatMap((l) => (l.source_doc_line_id ? [l.source_doc_line_id] : []))}
          orderNo={source.doNo}
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
          <span>Logistik</span>
          <span>/</span>
          <Link href="/logistics/delivery-note">Delivery Note</Link>
          <span>/</span>
          <span className="cur">{note ? note.dnNo : "Baru"}</span>
        </div>
        <div className="ph-row">
          <h1>
            <span className="ph-ico">
              <Icon name="truck" size={16} />
            </span>
            {note ? (
              <>
                <span className="docno">{note.dnNo}</span>
                <span className={`bdg ${DELIVERY_NOTE_STATUS_BADGE[status]}`}>{DELIVERY_NOTE_STATUS_TEXT[status]}</span>
              </>
            ) : (
              "Delivery Note Baru"
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
              <DeliveryNoteActions id={note!.id} subject={note!.dnNo} status={status} can={can} />
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
