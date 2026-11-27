"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icon";
import { Amount } from "@/components/ui/amount";
import { CancelButton } from "@/components/ui/cancel-button";
import { Combobox } from "@/components/ui/combobox";
import { DateInput } from "@/components/ui/date-input";
import { DocumentHeader } from "@/components/ui/document-header";
import { Field, FormBody, FormRow, FormSection } from "@/components/ui/form";
import { FormTabs, tabHasError } from "@/components/ui/form-tabs";
import { JournalReference } from "@/components/ui/journal-reference";
import { MoneyInput } from "@/components/ui/money-input";
import { SaveButtons, firstStep, withStep } from "@/components/ui/save-buttons";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { StockReceiptActions } from "@/components/inventory/stock-receipt-actions";
import { createStockReceiptAction, updateStockReceiptAction } from "@/app/actions/stock-receipt";
import type { SourceView, StockReceiptFormOptions, StockReceiptView } from "@/lib/erp/stock-receipt";
import { STOCK_RECEIPT_PATH, STOCK_RECEIPT_PURPOSES, STOCK_RECEIPT_PURPOSE_KEYS, VALUE_MODE_TEXT, type StockReceiptPurposeKey } from "@/lib/erp/stock-receipt-purposes";
import {
  STOCK_RECEIPT_STATUS_BADGE,
  STOCK_RECEIPT_STATUS_TEXT,
  availableStockReceiptActions,
  stockReceiptTransitions,
  type StockReceiptAbilities,
} from "@/lib/erp/stock-receipt-workflow";
import { formatDate, formatQty, todayIso } from "@/lib/format";

/**
 * A Stock Receipt in its three modes (P339). A new one picks its purpose, then
 * — when the purpose has one — the source waiting in the user's warehouses; the
 * page reloads on it (`?purpose=&source=`), so only that source is read. The
 * source is taken whole: the warehouse says only where each No. Stok goes and
 * under which status (and, for a bonus, its new number and expiry). Penerimaan
 * Lain-lain types its lines. **The value follows the purpose** (SR-7): locked
 * to the source's or to 0, or typed — nobody chooses whether goods keep value.
 */

type RowState = {
  k: string;
  key: number | null;
  item_id: number | null;
  tracking_no: string;
  expiry_date: string;
  location_id: number | null;
  stock_status_id: number | null;
  base_qty: string;
  value: string;
};

let seq = 0;
const newK = () => `s${Date.now().toString(36)}${seq++}`;
const ro = (node: React.ReactNode) => <div className="ro">{node}</div>;
const nil = (t: string) => <div className="ro nil">{t}</div>;
const idc = (label: string, name: string) => (
  <span className="idc">
    <span className="lab">{label}</span>
    <span className="nm">{name}</span>
  </span>
);

const RULE_TEXT = { source: "Dari sumber", zero: "Nol", typed: "Diketik" } as const;

export function StockReceiptForm({
  mode,
  receipt,
  purpose: givenPurpose,
  source,
  options,
  can,
}: {
  mode: "new" | "edit" | "view";
  receipt: StockReceiptView | null;
  purpose: StockReceiptPurposeKey | null;
  source: SourceView | null;
  options: StockReceiptFormOptions | null;
  can: StockReceiptAbilities;
}) {
  const router = useRouter();
  const toast = useToast();
  const editing = mode !== "view";
  const purpose = receipt?.purpose ?? givenPurpose;
  const p = purpose ? STOCK_RECEIPT_PURPOSES[purpose] : null;
  const status = receipt?.status ?? "Draft";
  const typed = p?.valueRule === "typed";
  const bonus = purpose === "purchase_bonus";
  const fromProduction = p?.source === "production";

  const [warehouseId, setWarehouseId] = useState<number | null>(receipt?.warehouseId ?? source?.warehouseId ?? (options?.warehouses.length === 1 ? options.warehouses[0].id : null));
  const warehouse = options?.warehouses.find((w) => w.id === warehouseId);
  const locations = warehouse?.locations ?? [];
  const statuses = options?.statuses ?? [];
  const oneLocation = locations.length === 1 ? locations[0].id : null;
  const [date, setDate] = useState(receipt?.date ?? todayIso());
  const [note, setNote] = useState(receipt?.note ?? "");
  const [rows, setRows] = useState<RowState[]>(() => {
    const stored = receipt?.rows ?? [];
    if (source) {
      return source.rows.map((r) => {
        const s = stored.find((x) => x.key === r.key);
        return {
          k: newK(),
          key: r.key,
          item_id: r.itemId,
          tracking_no: s?.trackingNo ?? r.lotNo,
          expiry_date: (s ? s.expiry : r.expiry) ?? "",
          location_id: s ? s.locationId : (r.locationId ?? oneLocation),
          stock_status_id: s?.statusId ?? statuses[0]?.id ?? null,
          base_qty: String(r.qty),
          value: String(r.value),
        };
      });
    }
    if (stored.length) {
      return stored.map((s) => ({ k: newK(), key: null, item_id: s.itemId, tracking_no: s.trackingNo, expiry_date: s.expiry ?? "", location_id: s.locationId, stock_status_id: s.statusId, base_qty: String(s.qty), value: String(s.value) }));
    }
    return typed ? [{ k: newK(), key: null, item_id: null, tracking_no: "", expiry_date: "", location_id: oneLocation, stock_status_id: statuses[0]?.id ?? null, base_qty: "", value: "" }] : [];
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  const touch = (...names: string[]) => {
    setDirty(true);
    setErrors((e) => {
      const next = { ...e };
      for (const n of names) delete next[n];
      return next;
    });
  };
  const setRow = (k: string, i: number, patch: Partial<RowState>) => {
    setRows((rs) => rs.map((r) => (r.k === k ? { ...r, ...patch } : r)));
    touch(...Object.keys(patch).map((f) => `rows.${i}.${f}`), "_rows");
  };
  const setAll = (patch: Partial<RowState>) => {
    setRows((rs) => rs.map((r) => ({ ...r, ...patch })));
    touch();
  };

  const next = purpose ? firstStep(availableStockReceiptActions("Draft", can), stockReceiptTransitions(purpose)) : null;
  const itemOf = (id: number | null) => options?.items.find((i) => i.id === id);
  const sourceRow = (key: number | null) => source?.rows.find((r) => r.key === key);

  async function onSave(step?: string) {
    if (!purpose) return;
    setSaving(true);
    const input = {
      purpose,
      warehouse_id: warehouseId,
      source_id: source?.id ?? null,
      receipt_date: date,
      note,
      rows: rows.map((r) => ({ key: r.key, item_id: r.item_id, tracking_no: r.tracking_no, expiry_date: r.expiry_date || null, location_id: r.location_id, stock_status_id: r.stock_status_id, base_qty: r.base_qty, value: r.value })),
    };
    const result = mode === "edit" ? await updateStockReceiptAction(receipt!.id, input) : await createStockReceiptAction(input);
    setSaving(false);
    if (!result.ok) {
      setErrors(result.errors);
      toast(result.errors._form ? "Tidak diizinkan" : "Belum bisa disimpan", result.errors._form ?? result.errors._rows ?? Object.values(result.errors)[0] ?? "Periksa kembali isian.", "err");
      return;
    }
    setDirty(false);
    toast("Stock Receipt disimpan", `${result.no} · Draft`, "ok");
    router.push(withStep(`${STOCK_RECEIPT_PATH}/${result.id}`, step));
  }

  const choosePurpose = (v: string) => router.push(`${STOCK_RECEIPT_PATH}/new${v ? `?purpose=${v}` : ""}`);
  const sourceChoices = (options?.sources ?? []).filter((s) => s.purpose === purpose);
  const valueText = !p ? null : fromProduction ? `${RULE_TEXT.source} · ${VALUE_MODE_TEXT[(source?.valueMode ?? receipt?.valueMode) ?? "carried"].name}` : RULE_TEXT[p.valueRule];
  const noValue = p?.valueRule === "zero" || (fromProduction && (source?.valueMode ?? receipt?.valueMode) === "none");

  const headerCard = (
    <div className="card">
      <FormBody>
        <FormSection title="Sumber">
          <FormRow>
            <Field label="Tujuan" span={4} required={mode === "new"} locked={Boolean(purpose) && editing && mode !== "new"} error={errors.purpose}>
              {mode === "new" && !source ? (
                <Select
                  value={purpose ?? ""}
                  options={STOCK_RECEIPT_PURPOSE_KEYS.map((k) => ({ value: k, label: STOCK_RECEIPT_PURPOSES[k].name }))}
                  placeholder="Pilih tujuan…"
                  onChange={choosePurpose}
                />
              ) : (
                ro(p?.name ?? "—")
              )}
            </Field>
            {p?.source && (
              <Field
                label={fromProduction ? "Kiriman Produksi" : "Receipt Note"}
                span={4}
                required={mode === "new"}
                locked={Boolean(source) && editing}
                error={errors.source_id}
                help={mode === "new" && !source ? "yang menunggu diterima di gudang Anda" : undefined}
              >
                {mode === "new" && !source ? (
                  <Combobox
                    value={null}
                    options={sourceChoices.map((s) => ({ id: s.id, label: s.no, name: `${s.fromName || s.fromLabel} · ${formatDate(s.date)}`, active: true }))}
                    placeholder={fromProduction ? "Pilih kiriman…" : "Pilih Receipt Note…"}
                    emptyText={fromProduction ? "Tidak ada kiriman produksi yang menunggu di gudang Anda." : "Tidak ada bonus Receipt Note yang menunggu di gudang Anda."}
                    onChange={(v) => v && router.push(`${STOCK_RECEIPT_PATH}/new?purpose=${purpose}&source=${v}`)}
                  />
                ) : bonus ? (
                  ro(
                    <Link className="drl" href={`/inventory/receipt-note/${source?.id ?? receipt?.sourceId}`}>
                      <span className="mono">{source?.no ?? receipt?.sourceNo}</span>
                    </Link>
                  )
                ) : (
                  ro(<span className="mono">{source?.no ?? receipt?.sourceNo}</span>)
                )}
              </Field>
            )}
            {p?.source && (
              <Field label={fromProduction ? "Unit Asal" : "Supplier"} span={4}>
                {source ? ro(fromProduction ? idc(source.fromLabel, source.fromName) : source.fromName) : receipt?.unitLabel ? ro(idc(receipt.unitLabel, receipt.unitName)) : nil(mode === "new" ? "Pilih sumber dulu…" : "—")}
              </Field>
            )}
          </FormRow>
        </FormSection>
        <FormSection title="Penerimaan">
          <FormRow>
            <Field label="Gudang" span={4} required={editing && typed} locked={editing && Boolean(p?.source)} error={errors.warehouse_id}>
              {editing && typed ? (
                <Select
                  value={warehouseId ? String(warehouseId) : ""}
                  options={(options?.warehouses ?? []).map((w) => ({ value: String(w.id), label: `${w.label} · ${w.name}` }))}
                  placeholder="Pilih gudang…"
                  invalid={Boolean(errors.warehouse_id)}
                  onChange={(v) => {
                    const id = Number(v) || null;
                    setWarehouseId(id);
                    const w = options?.warehouses.find((x) => x.id === id);
                    setAll({ location_id: w?.locations.length === 1 ? w.locations[0].id : null });
                  }}
                />
              ) : warehouse ? (
                ro(idc(warehouse.label, warehouse.name))
              ) : receipt ? (
                ro(idc(receipt.warehouseLabel, receipt.warehouseName))
              ) : (
                nil(p?.source ? "Mengikuti sumber" : "Pilih tujuan dulu…")
              )}
            </Field>
            <Field label="Tanggal Terima" span={4} required={editing} error={errors.receipt_date} help={editing && source ? `tidak sebelum ${formatDate(source.date)}` : undefined}>
              {editing ? (
                <DateInput
                  value={date}
                  invalid={Boolean(errors.receipt_date)}
                  onChange={(v) => {
                    setDate(v);
                    touch("receipt_date");
                  }}
                />
              ) : (
                ro(formatDate(date))
              )}
            </Field>
            {p && (
              <Field label="Nilai" span={4} locked={editing && !typed} help={typed ? "diketik per No. Stok" : "ditentukan tujuan, tidak dipilih di sini"}>
                {ro(valueText)}
              </Field>
            )}
            <Field label={p?.noteLabel ?? "Catatan"} span={12} required={editing && Boolean(p?.noteLabel)} error={errors.note}>
              {editing ? (
                <textarea
                  className={`ta${errors.note ? " bad" : ""}`}
                  rows={1}
                  value={note}
                  placeholder={p?.noteLabel ? "Mengapa barang ini masuk gudang…" : "Catatan penerimaan…"}
                  onChange={(e) => {
                    setNote(e.target.value);
                    touch("note");
                  }}
                />
              ) : (source?.note ?? note) ? (
                <div className="ro multi">{note || source?.note}</div>
              ) : (
                <div className="ro multi nil opt">tidak diisi</div>
              )}
            </Field>
          </FormRow>
        </FormSection>
        {receipt && (
          <JournalReference id={receipt.journalId} no={receipt.journalNo}>
            {receipt.writtenOff > 0 ? (
              <Field label="Beban Pemusnahan Produksi" span={4}>
                {ro(<Amount value={receipt.writtenOff} />)}
              </Field>
            ) : null}
          </JournalReference>
        )}
        {p && <p className="fnote">{p.desc}</p>}
        {receipt?.statusReason && status === "Cancelled" && (
          <p className="fnote">
            <b>Dibatalkan:</b> {receipt.statusReason}
          </p>
        )}
      </FormBody>
    </div>
  );

  const locationOptions = locations.map((l) => ({ value: String(l.id), label: `${l.label} · ${l.name}` }));
  const statusOptions = statuses.map((s) => ({ value: String(s.id), label: s.name }));
  const showLoc = editing ? locations.length > 0 : (receipt?.rows ?? []).some((r) => r.locationId);
  const viewRows = receipt?.rows ?? [];

  const linesCard = !p ? null : (
    <div className="card">
      <div className="card-h">
        <span className="ci">
          <Icon name="layers" size={15} />
        </span>
        <div className="ct">
          <h3>Barang</h3>
          <p>
            {!editing
              ? "No. Stok yang masuk gudang, lokasinya dan statusnya."
              : typed
                ? "Ketik barang, No. Stok baru, jumlah dalam satuan dasar dan nilainya."
                : bonus
                  ? "Bonus diterima utuh. Atur No. Stok baru, kadaluarsa, lokasi dan status."
                  : "Kiriman diterima utuh. Pilih lokasi dan status tiap No. Stok."}
          </p>
        </div>
      </div>
      {errors._rows && (
        <div className="nbox bad slim">
          <Icon name="warn" size={15} className="ni" />
          <div>
            <b>{errors._rows}</b>
          </div>
        </div>
      )}
      {editing && rows.length > 1 && (
        <div className="toolbar" style={{ paddingBottom: 0, borderBottom: 0 }}>
          <span className="count">Untuk semua baris:</span>
          {locations.length > 0 && (
            <div style={{ width: 220 }}>
              <Select value="" ariaLabel="Lokasi semua baris" options={locationOptions} placeholder="Pilih lokasi…" onChange={(v) => setAll({ location_id: Number(v) || null })} />
            </div>
          )}
          <div style={{ width: 170 }}>
            <Select value="" ariaLabel="Status semua baris" options={statusOptions} placeholder="Pilih status…" onChange={(v) => setAll({ stock_status_id: Number(v) || null })} />
          </div>
        </div>
      )}
      {editing && !rows.length ? (
        <div className="empty sm">
          <h4>Pilih sumber dulu…</h4>
          <p>Barang yang diterima mengikuti sumbernya.</p>
        </div>
      ) : (
        <div className="tw">
          <table className="grid ltab" style={{ minWidth: 1000 + (showLoc ? 200 : 0) }}>
            <thead>
              <tr>
                <th style={{ width: 40 }}>No</th>
                <th style={{ width: typed && editing ? 240 : undefined }}>Barang</th>
                <th style={{ width: 200 }}>No. Stok</th>
                {fromProduction && <th style={{ width: 150 }}>No. Job</th>}
                {!fromProduction && <th style={{ width: 150 }}>Kadaluarsa</th>}
                <th className="num" style={{ width: 150 }}>Qty</th>
                {showLoc && <th style={{ width: 200 }}>Lokasi</th>}
                <th style={{ width: 150 }}>Status Stok</th>
                <th className="num" style={{ width: 150 }}>Nilai</th>
                {editing && typed && <th style={{ width: 40 }} />}
              </tr>
            </thead>
            <tbody>
              {editing
                ? rows.map((r, i) => {
                    const sr = sourceRow(r.key);
                    const item = sr ? { label: sr.itemLabel, name: sr.itemName, uomLabel: sr.uomLabel } : itemOf(r.item_id);
                    const err = (f: string) => errors[`rows.${i}.${f}`];
                    const bad = ["item_id", "tracking_no", "expiry_date", "base_qty", "value", "location_id", "stock_status_id"].map(err).find(Boolean);
                    return (
                      <tr key={r.k} className={bad ? "overrow" : undefined}>
                        <td className="no">{i + 1}</td>
                        <td>
                          {typed ? (
                            <Combobox
                              size="sm"
                              value={r.item_id}
                              invalid={Boolean(err("item_id"))}
                              options={(options?.items ?? []).map((x) => ({ id: x.id, label: x.label, name: x.name, active: true }))}
                              placeholder="Pilih barang…"
                              onChange={(v) => setRow(r.k, i, { item_id: v })}
                            />
                          ) : (
                            item && idc(item.label, item.name)
                          )}
                          {bad && <span className="overtag">{bad}</span>}
                        </td>
                        <td>
                          {typed || bonus ? (
                            <input className={`inp sm${err("tracking_no") ? " bad" : ""}`} value={r.tracking_no} placeholder="No. Stok baru" aria-label={`No. Stok baris ${i + 1}`} onChange={(e) => setRow(r.k, i, { tracking_no: e.target.value.toUpperCase() })} />
                          ) : (
                            <span className="mono">{r.tracking_no}</span>
                          )}
                        </td>
                        {fromProduction && <td>{sr?.jobNo ? <span className="mono">{sr.jobNo}</span> : <span className="dash">—</span>}</td>}
                        {!fromProduction && (
                          <td>
                            <DateInput value={r.expiry_date} invalid={Boolean(err("expiry_date"))} onChange={(v) => setRow(r.k, i, { expiry_date: v })} />
                          </td>
                        )}
                        <td className="num">
                          {typed ? (
                            <div className="qcell">
                              <MoneyInput size="sm" decimals={6} value={r.base_qty} invalid={Boolean(err("base_qty"))} ariaLabel={`Qty baris ${i + 1}`} onChange={(v) => setRow(r.k, i, { base_qty: v })} />
                              <span className="qu">{item?.uomLabel}</span>
                            </div>
                          ) : (
                            <>
                              {formatQty(Number(r.base_qty))} {item?.uomLabel}
                              {sr?.grams != null && <span className="d2">{formatQty(sr.grams)} g</span>}
                            </>
                          )}
                        </td>
                        {showLoc && (
                          <td>
                            <Select size="sm" ariaLabel={`Lokasi baris ${i + 1}`} value={String(r.location_id ?? "")} options={locationOptions} placeholder="Pilih lokasi…" invalid={Boolean(err("location_id"))} onChange={(v) => setRow(r.k, i, { location_id: Number(v) || null })} />
                          </td>
                        )}
                        <td>
                          <Select size="sm" ariaLabel={`Status baris ${i + 1}`} value={String(r.stock_status_id ?? "")} options={statusOptions} placeholder="Pilih status…" onChange={(v) => setRow(r.k, i, { stock_status_id: Number(v) || null })} />
                        </td>
                        <td className="num">
                          {typed ? (
                            <MoneyInput size="sm" value={r.value} invalid={Boolean(err("value"))} ariaLabel={`Nilai baris ${i + 1}`} onChange={(v) => setRow(r.k, i, { value: v })} />
                          ) : (
                            <Amount value={noValue ? 0 : Number(r.value)} />
                          )}
                        </td>
                        {typed && (
                          <td>
                            <button
                              className="iact del"
                              title="Hapus baris"
                              onClick={() => {
                                setRows((rs) => rs.filter((x) => x.k !== r.k));
                                touch("_rows");
                              }}
                            >
                              <Icon name="trash" size={14} />
                            </button>
                          </td>
                        )}
                      </tr>
                    );
                  })
                : viewRows.map((r, i) => (
                    <tr key={i}>
                      <td className="no">{i + 1}</td>
                      <td>{idc(r.itemLabel, r.itemName)}</td>
                      <td>
                        <span className="mono">{r.trackingNo}</span>
                      </td>
                      {fromProduction && <td>{r.jobNo ? <span className="mono">{r.jobNo}</span> : <span className="dash">—</span>}</td>}
                      {!fromProduction && <td>{r.expiry ? formatDate(r.expiry) : <span className="dash">—</span>}</td>}
                      <td className="num">
                        {formatQty(r.qty)} {r.uomLabel}
                        {r.grams != null && <span className="d2">{formatQty(r.grams)} g</span>}
                      </td>
                      {showLoc && <td>{r.locationLabel ?? <span className="dash">—</span>}</td>}
                      <td>{r.statusName ?? <span className="dash">—</span>}</td>
                      <td className="num">
                        <Amount value={noValue ? 0 : r.value} />
                      </td>
                    </tr>
                  ))}
            </tbody>
          </table>
        </div>
      )}
      {editing && typed && (
        <div className="cardfoot">
          <button
            className="btn sm"
            onClick={() => {
              setRows((rs) => [...rs, { k: newK(), key: null, item_id: null, tracking_no: "", expiry_date: "", location_id: oneLocation, stock_status_id: statuses[0]?.id ?? null, base_qty: "", value: "" }]);
              touch("_rows");
            }}
          >
            <Icon name="plus" size={14} /> Tambah Barang
          </button>
        </div>
      )}
    </div>
  );

  const backHref = receipt ? `${STOCK_RECEIPT_PATH}/${receipt.id}` : STOCK_RECEIPT_PATH;
  return (
    <>
      <DocumentHeader
        module="Persediaan"
        trail={[{ label: "Stock Receipt", href: STOCK_RECEIPT_PATH }]}
        icon="down"
        number={receipt?.no}
        placeholder="Stock Receipt Baru"
        status={status}
        statusLabel={{ text: STOCK_RECEIPT_STATUS_TEXT[status], tone: STOCK_RECEIPT_STATUS_BADGE[status] }}
        editing={mode === "edit"}
        dirty={editing && dirty}
      >
        {editing ? (
          <>
            <CancelButton href={backHref} dirty={dirty} disabled={saving} />
            <SaveButtons saving={saving} disabled={saving || !p || !rows.length || (Boolean(p?.source) && !source)} onSave={onSave} next={next} />
          </>
        ) : (
          <StockReceiptActions id={receipt!.id} subject={receipt!.no} purpose={receipt!.purpose} status={status} can={can} />
        )}
      </DocumentHeader>
      <div className="fgrid solo">
        <div>
          {headerCard}
          <FormTabs
            tabs={[
              {
                key: "lines",
                label: "Barang",
                icon: "box",
                count: editing ? rows.length : viewRows.length,
                bad: tabHasError(errors, "_rows", "rows."),
                content: linesCard ?? (
                  <div className="card">
                    <div className="empty sm">
                      <h4>Pilih tujuan dulu…</h4>
                      <p>Tujuan menentukan sumber barang dan nilainya.</p>
                    </div>
                  </div>
                ),
              },
            ]}
          />
        </div>
      </div>
    </>
  );
}
