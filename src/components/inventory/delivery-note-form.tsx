"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icon";
import { Amount } from "@/components/ui/amount";
import { CancelButton } from "@/components/ui/cancel-button";
import { Combobox } from "@/components/ui/combobox";
import { DateInput } from "@/components/ui/date-input";
import { DocumentHeader } from "@/components/ui/document-header";
import { Field, FormBody, FormRow, FormSection } from "@/components/ui/form";
import { MoneyInput } from "@/components/ui/money-input";
import { useToast } from "@/components/ui/toast";
import { DEFAULT_DELIVERY_NOTE_PURPOSE, deliveryNotePurpose } from "@/lib/erp/delivery-note-purposes";
import { DeliveryNoteActions } from "./delivery-note-actions";
import { DeliveryNoteLinePicker } from "@/components/inventory/delivery-note-line-picker";
import { DeliveryNoteLotPicker, type LotPick } from "@/components/inventory/delivery-note-lot-picker";
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
import { formatDate, formatNumber, formatPrice, todayIso } from "@/lib/format";

/**
 * A Delivery Note in all three modes: `new`, `edit` (Draft only) and `view`
 * (C28, U11–U15, P268, P269).
 *
 * Its purpose decides its source and the words around it — for a sale, an
 * issued Delivery Order chosen once and locked, whose Customer Order, customer,
 * warehouse and address are shown, not chosen. The user sets the day the goods
 * leave, the vehicle and the driver, and picks which source lines leave now and
 * how much.
 *
 * A line is the summary: its quantity in the document's unit, large, with the
 * base quantity under it when the unit is not the base one. The detail is its
 * tracking rows — lot, location, status and base quantity, picked in *Pilih
 * Lot* — and, once posted, what each released from stock: the value is the
 * stock's, so it is shown per tracking row and the line shows only the sum.
 * What the source still has to send is its own column while the note is a
 * Draft, and gone once posted.
 */

export type DeliveryNoteMode = "new" | "edit" | "view";

/** `picks[].qty` is in the item's base unit (P268). */
type LineState = { key: string; source_doc_line_id: number | null; qty: string; picks: LotPick[] };

let seq = 0;
const newKey = () => `l${Date.now().toString(36)}${seq++}`;
const qtyText = (n: number) => formatNumber(n, n % 1 ? 2 : 0);
const SCALE = 10_000;
const units = (v: string | number) => Math.round((Number(String(v).replace(",", ".")) || 0) * SCALE);

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
        picks: (l.picks ?? []).map((p) => ({
          tracking_id: Number(p.tracking_id),
          location_id: p.location_id ?? null,
          stock_status_id: p.stock_status_id ?? null,
          qty: String(p.base_qty),
        })),
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

  const purpose = deliveryNotePurpose(header.purpose ?? DEFAULT_DELIVERY_NOTE_PURPOSE)!;
  const source = header.source_doc_id ? orderById.get(header.source_doc_id) : undefined;
  const doLineById = useMemo(() => new Map((source?.lines ?? []).map((l) => [l.id, l])), [source]);
  const status = note?.status ?? "Draft";
  const posted = status === "Posted";
  /** What the source still has to send means something only until the note posts (P269). */
  const draft = status === "Draft";
  const billed = posted && purpose.billed && billing !== null;

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
    const payload = sent.map((l) => ({
      source_doc_line_id: l.source_doc_line_id,
      qty: l.qty,
      note: "",
      picks: l.picks.map((p) => ({ tracking_id: p.tracking_id, location_id: p.location_id, stock_status_id: p.stock_status_id ?? null, base_qty: p.qty })),
    }));
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
    router.push(`/inventory/delivery-note/${result.id}`);
  }

  const backHref = note ? `/inventory/delivery-note/${note.id}` : "/inventory/delivery-note";
  const ro = (node: React.ReactNode) => <div className="ro">{node}</div>;
  const nil = (text = "tidak diisi") => <div className="ro nil">{text}</div>;
  const waitSource = `menunggu ${purpose.sourceNoun}`;
  const lineErr = (key: string, f: string) => errors[`lines.${key}.${f}`];

  // ======================================================= header card
  const headerCard = (
    <div className="card">
      <FormBody>
        <FormSection title="Sumber">
          <FormRow>
            <Field label="Tujuan" span={4} locked={mode !== "view"} help={mode !== "view" ? "menentukan sumber dan jurnalnya" : undefined}>
              {ro(purpose.name)}
            </Field>
            <Field
              label={purpose.sourceNoun}
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
                  placeholder={`Pilih ${purpose.sourceNoun}…`}
                  emptyText={`Belum ada ${purpose.sourceNoun} yang diterbitkan.`}
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
            <Field label="Customer Order" span={4}>
              {source ? (
                ro(
                  <Link className="drl" href={`/sales/customer-order/${source.customerOrderId}`}>
                    <span className="mono">{source.customerOrderNo}</span>
                  </Link>
                )
              ) : (
                nil(waitSource)
              )}
            </Field>
            <Field label="Customer" span={12}>
              {source ? (
                ro(
                  <>
                    <span className="lab">{source.customerLabel}</span>
                    <span>{source.customerName}</span>
                  </>
                )
              ) : (
                nil(waitSource)
              )}
            </Field>
          </FormRow>
        </FormSection>
        <FormSection title="Pengiriman">
          <FormRow>
            <Field label="Tanggal Kirim" span={3} required={editing} help={editing ? "hari barang keluar" : undefined} error={errors.dn_date}>
              {editing ? (
                <DateInput value={header.dn_date} invalid={Boolean(errors.dn_date)} onChange={(v) => set("dn_date", v)} />
              ) : (
                ro(formatDate(header.dn_date))
              )}
            </Field>
            <Field label="Gudang" span={3} help={editing ? `dari ${purpose.sourceNoun}` : undefined}>
              {source ? (
                ro(
                  <>
                    <span className="lab">{source.warehouseLabel}</span>
                    <span>{source.warehouseName}</span>
                  </>
                )
              ) : (
                nil(waitSource)
              )}
            </Field>
            <Field label="No. Kendaraan" span={3}>
              {editing ? (
                <input className="inp" value={header.vehicle_no} placeholder="B 1234 XYZ" onChange={(e) => set("vehicle_no", e.target.value)} />
              ) : header.vehicle_no ? (
                ro(<span className="mono">{header.vehicle_no}</span>)
              ) : (
                nil()
              )}
            </Field>
            <Field label="Pengemudi" span={3}>
              {editing ? (
                <input className="inp" value={header.driver_name} placeholder="Nama pengemudi" onChange={(e) => set("driver_name", e.target.value)} />
              ) : header.driver_name ? (
                ro(header.driver_name)
              ) : (
                nil()
              )}
            </Field>
            <Field label="Alamat Kirim" span={12} help={editing ? `dari ${purpose.sourceNoun}` : undefined}>
              {source ? <div className="ro multi">{source.addressText}</div> : nil(waitSource)}
            </Field>
            <Field label="Catatan" span={12}>
              {editing ? (
                <textarea className="ta" rows={2} value={header.note} placeholder="Catatan pada surat jalan…" onChange={(e) => set("note", e.target.value)} />
              ) : header.note ? (
                <div className="ro multi">{header.note}</div>
              ) : (
                <div className="ro multi nil">tidak diisi</div>
              )}
            </Field>
          </FormRow>
        </FormSection>
        {posted && (
          <FormSection title="Referensi">
            <FormRow>
              <Field label="Journal" span={4}>
                {note?.journalId
                  ? ro(
                      <Link className="drl" href={`/accounting/journal/${note.journalId}`}>
                        <span className="mono">{note.journalNo}</span>
                      </Link>
                    )
                  : nil("tanpa journal — stok bernilai nol")}
              </Field>
            </FormRow>
          </FormSection>
        )}
        {note?.cancelReason && status === "Cancelled" ? (
          <p className="fnote">
            <b>Dibatalkan:</b> {note.cancelReason}
          </p>
        ) : (
          <p className="fnote">
            {posted
              ? "Diposting: barang sudah keluar dari stok dan tidak dapat diubah. Koreksi dengan dokumen baru."
              : "Draft belum mengubah stok maupun journal; Posting mengeluarkan setiap lot dari stok."}
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
  const baseOf = (l: LineState, d: DnSourceLine | undefined) => (units(l.qty) * (d?.uomFactor ?? 1)) / SCALE;

  /**
   * The Lot cell: the line's tracking rows — a button and how far it is picked
   * while editing, the rows themselves otherwise, each with its base quantity,
   * expiry, location, a status other than Tersedia and, once posted, its value.
   */
  const lotCell = (l: LineState, d: DnSourceLine | undefined, stored?: DeliveryNoteView["lines"][number]) => {
    if (!d) return null;
    if (!d.lotTracked) return <span className="dash">tanpa lot</span>;
    const lineBase = baseOf(l, d);
    const picked = l.picks.reduce((s, p) => s + units(p.qty), 0) / SCALE;
    const full = lineBase > 0 && units(picked) === units(lineBase);
    if (editing) {
      return (
        <>
          <button className="btn sm" disabled={!(lineBase > 0)} title={lineBase > 0 ? undefined : "Isi Qty dulu"} onClick={() => setLotsFor(l.key)}>
            <Icon name="layers" size={14} /> {l.picks.length ? `${l.picks.length} lot` : "Pilih Lot"}
          </button>
          <span className={full ? "fulltag" : "overtag"}>
            {lineBase > 0 ? `${qtyText(picked)} / ${qtyText(lineBase)} ${d.baseUomLabel}${full ? "" : " · belum penuh"}` : "isi Qty dulu"}
          </span>
        </>
      );
    }
    const lots = stored?.pickedLots ?? [];
    if (!lots.length) return <span className="overtag">Belum dipilih</span>;
    return (
      <span className="dstack" style={{ gap: 6 }}>
        {lots.map((p) => (
          <span key={`${p.lotId}:${p.locationId ?? 0}:${p.statusId}`} className="dstack">
            <span className="lab" title={p.lotNo}>
              {p.lotNo}
            </span>
            {/* The quantity goes under the lot, so a long lot number never hides it. */}
            <span className="d2">
              {qtyText(p.baseQty)} {d.baseUomLabel}
              {p.expiry ? ` · ED ${formatDate(p.expiry)}` : ""}
              {p.locationLabel ? ` · ${p.locationLabel}` : ""}
            </span>
            {p.statusLabel !== "TERSEDIA" && <span className="bdg t-warn">{p.statusName}</span>}
            {posted && <Amount value={p.cost} />}
          </span>
        ))}
        {draft && !full && <span className="overtag">{qtyText(picked)} dari {qtyText(lineBase)} · belum penuh</span>}
      </span>
    );
  };

  const columns = 4 + (draft ? 1 : 0) + 1 + (posted ? 2 : 0) + (billed ? 1 : 0) + (editing ? 1 : 0);
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
              ? `Pilih barang dari ${purpose.sourceNoun} lewat Tambah Item, isi Qty yang keluar, lalu pilih lotnya dalam satuan dasar.`
              : posted
                ? "Setiap lot dengan nilai yang dilepas stok saat Posting; baris menunjukkan jumlahnya."
                : `Jumlah per barang dari ${purpose.sourceNoun} dan lot yang dipilih.`}{" "}
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
          <h4>{source ? "Belum ada barang" : `Pilih ${purpose.sourceNoun} dulu…`}</h4>
          <p>
            {source
              ? `Pilih barang ${purpose.sourceNoun} yang keluar dengan Delivery Note ini.`
              : `Barang yang dapat dikirim mengikuti baris ${purpose.sourceNoun} yang sudah diterbitkan.`}
          </p>
          {editing && source && addButton(true)}
        </div>
      ) : (
        <div className="tw">
          <table className="grid ltab" style={{ minWidth: 640 + (draft ? 110 : 0) + (posted ? 250 : 0) + (billed ? 140 : 0) }}>
            <thead>
              <tr>
                <th style={{ width: 40 }}>No</th>
                <th style={{ width: 130 }}>{purpose.sourceLineNoun}</th>
                <th>Barang</th>
                {draft && (
                  <th className="num" style={{ width: 110 }}>
                    {purpose.remainingLabel}
                  </th>
                )}
                <th style={{ width: editing ? 200 : 120 }}>Qty</th>
                <th style={{ width: editing ? 180 : 200 }}>Lot</th>
                {posted && (
                  <>
                    <th className="num" style={{ width: 120 }}>
                      Harga Pokok
                    </th>
                    <th className="num" style={{ width: 130 }}>
                      HPP
                    </th>
                  </>
                )}
                {billed && <th style={{ width: 140 }}>Ditagih</th>}
                {editing && <th style={{ width: 40 }} />}
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => {
                const d = l.source_doc_line_id ? doLineById.get(l.source_doc_line_id) : undefined;
                const left = d ? d.qty - d.held : 0;
                const typed = Number(String(l.qty).replace(",", ".")) || 0;
                const over = Boolean(d && units(typed) > units(left));
                const lineError = lineErr(l.key, "source_doc_line_id") ?? lineErr(l.key, "qty") ?? lineErr(l.key, "picks");
                const stored = viewLines[i];
                const baseQty = baseOf(l, d);
                // The base quantity speaks only when the document's unit is not the base one.
                const showBase = Boolean(d && d.uomLabel !== d.baseUomLabel && typed > 0);
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
                    {draft && (
                      <td className="num">
                        {d && (
                          <span className="qview">
                            <span className="mny">{qtyText(left)}</span>
                            <span className="lab">{d.uomLabel}</span>
                          </span>
                        )}
                      </td>
                    )}
                    <td>
                      {editing ? (
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
                      ) : (
                        <span className="qview">
                          <span className="mny">{qtyText(typed)}</span>
                          <span className="lab">{d?.uomLabel}</span>
                        </span>
                      )}
                      {showBase && (
                        <span className="d2">
                          = {qtyText(baseQty)} {d!.baseUomLabel}
                        </span>
                      )}
                    </td>
                    <td>{lotCell(l, d, stored)}</td>
                    {posted && (
                      <>
                        <td className="num">
                          {/* Derived on read — the line's value over its base quantity (P114, P268). */}
                          <span className="mny">{formatPrice(stored && stored.baseQty > 0 ? stored.cost / stored.baseQty : 0)}</span>
                        </td>
                        <td className="num">
                          <Amount value={stored?.cost ?? 0} />
                        </td>
                      </>
                    )}
                    {billed && (
                      <td>
                        {stored && billing![stored.id] ? (
                          <Link className="lab" href={`/finance/invoice/sales/${billing![stored.id].id}`}>
                            {billing![stored.id].no}
                          </Link>
                        ) : (
                          <span className="dash">Belum ditagih</span>
                        )}
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
            {posted && (
              <tfoot>
                <tr className="totrow">
                  <td colSpan={columns - 1 - (billed ? 1 : 0)} style={{ textAlign: "right" }}>
                    Total HPP
                  </td>
                  <td className="num">
                    <Amount value={note?.cost ?? 0} big />
                  </td>
                  {billed && <td />}
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}
      {lotsFor &&
        source &&
        (() => {
          const l = lines.find((x) => x.key === lotsFor);
          const d = l?.source_doc_line_id ? doLineById.get(l.source_doc_line_id) : undefined;
          if (!l || !d) return null;
          return (
            <DeliveryNoteLotPicker
              line={{ itemLabel: d.itemLabel, itemName: d.itemName, uomLabel: d.baseUomLabel }}
              lots={source.lots[d.itemId] ?? []}
              lineQty={baseOf(l, d)}
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
      <DocumentHeader
        module="Persediaan"
        trail={[{ label: "Delivery Note", href: "/inventory/delivery-note" }]}
        icon="truck"
        number={note?.dnNo}
        placeholder="Delivery Note Baru"
        status={note ? status : null}
        statusLabel={note ? { text: DELIVERY_NOTE_STATUS_TEXT[status], tone: DELIVERY_NOTE_STATUS_BADGE[status] } : undefined}
        editing={mode === "edit"}
        dirty={editing && dirty}
      >
        {editing ? (
          <>
            <CancelButton href={backHref} dirty={dirty} disabled={saving} />
            <button className="btn primary" onClick={onSave} disabled={saving}>
              <Icon name="save" size={15} /> {saving ? "Menyimpan…" : "Simpan"}
            </button>
          </>
        ) : (
          <DeliveryNoteActions id={note!.id} subject={note!.dnNo} status={status} can={can} />
        )}
      </DocumentHeader>

      <div className="fgrid solo">
        <div>
          {headerCard}
          {linesCard}
        </div>
      </div>
    </>
  );
}
