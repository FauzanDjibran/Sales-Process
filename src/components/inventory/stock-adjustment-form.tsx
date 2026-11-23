"use client";

import { useMemo, useState } from "react";
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
import { StockAdjustmentActions } from "@/components/inventory/stock-adjustment-actions";
import { createStockAdjustmentAction, loadCountSheetAction, updateStockAdjustmentAction } from "@/app/actions/stock-adjustment";
import type { CountSheet, StockAdjustmentHeaderInput, StockAdjustmentOptions, StockAdjustmentView } from "@/lib/erp/stock-adjustment";
import {
  STOCK_ADJUSTMENT_STATUS_BADGE,
  STOCK_ADJUSTMENT_STATUS_TEXT,
  STOCK_ADJUSTMENT_TRANSITIONS,
  availableStockAdjustmentActions,
  type StockAdjustmentAbilities,
} from "@/lib/erp/stock-adjustment-workflow";
import { formatDate, formatNumber, todayIso } from "@/lib/format";

/**
 * A Stock Adjustment in its three modes (P318). The user picks the warehouse and
 * loads what its books hold; each row then takes what is really there, the
 * difference beside it. A lot found where the books hold none is added by its
 * number. A Draft may be counted in part; Ajukan needs every row.
 */

type Line = { key: string; item_id: number | null; tracking_no: string; location_id: number | null; stock_status_id: number | null; book_qty: number; counted_qty: string; value: string; note: string; found: boolean };

let seq = 0;
const newKey = () => `a${Date.now().toString(36)}${seq++}`;
const qtyText = (n: number) => formatNumber(n, n % 1 ? 4 : 0);
const num = (v: string) => Number(v.replace(",", "."));
const placeKey = (l: { tracking_no: string; location_id: number | null; stock_status_id: number | null }) => `${l.tracking_no}|${l.location_id ?? 0}|${l.stock_status_id}`;

export function StockAdjustmentForm({ mode, doc, options, sheet, can }: { mode: "new" | "edit" | "view"; doc: StockAdjustmentView | null; options: StockAdjustmentOptions; sheet: CountSheet | null; can: StockAdjustmentAbilities }) {
  const router = useRouter();
  const toast = useToast();
  const editing = mode !== "view";
  const itemById = useMemo(() => new Map(options.items.map((i) => [i.id, i])), [options.items]);
  const [header, setHeader] = useState<StockAdjustmentHeaderInput>(() => doc?.header ?? { adjustment_date: todayIso(), warehouse_id: options.warehouses.length === 1 ? options.warehouses[0].id : null, note: "" });
  const [lines, setLines] = useState<Line[]>(() =>
    (doc?.lines ?? []).map((l) => ({ key: newKey(), item_id: l.item_id, tracking_no: l.tracking_no, location_id: l.location_id, stock_status_id: l.stock_status_id, book_qty: Number(l.book_qty), counted_qty: String(l.counted_qty), value: String(l.value), note: l.note, found: Number(l.book_qty) === 0 }))
  );
  const [locations, setLocations] = useState(sheet?.locations ?? []);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const status = doc?.status ?? "Draft";
  const posted = status === "Posted";
  const tersedia = options.statuses[0]?.id ?? null;

  const touch = (...names: string[]) => {
    setDirty(true);
    setErrors((e) => {
      const next = { ...e };
      for (const n of names) delete next[n];
      return next;
    });
  };
  const setLine = (key: string, patch: Partial<Line>) => {
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
    touch("_lines", ...["item_id", "tracking_no", "location_id", "stock_status_id", "counted_qty", "value"].map((f) => `lines.${key}.${f}`));
  };

  /** Brings the books in: new buckets are added, and a row whose balance changed is counted again. */
  async function load(warehouseId: number | null) {
    if (!warehouseId) return;
    setBusy(true);
    const r = await loadCountSheetAction(warehouseId, mode === "edit");
    setBusy(false);
    if (!r.ok) return toast("Tidak dapat dimuat", r.errors._form, "err");
    setLocations(r.sheet.locations);
    let changed = 0;
    setLines((ls) => {
      const held = new Map(r.sheet.rows.map((x) => [placeKey(x), x]));
      const kept = ls.map((l) => {
        const now = held.get(placeKey(l))?.book_qty ?? 0;
        if (now === l.book_qty) return l;
        changed += 1;
        return { ...l, book_qty: now, counted_qty: "", found: now === 0 };
      });
      const known = new Set(ls.map(placeKey));
      const fresh = r.sheet.rows.filter((x) => !known.has(placeKey(x))).map((x) => ({ key: newKey(), ...x, counted_qty: "", value: "", note: "", found: false }));
      return [...kept, ...fresh];
    });
    touch("_lines");
    setErrors({});
    toast("Saldo dimuat", changed ? `${changed} baris berubah dan perlu dihitung lagi` : `${r.sheet.rows.length} lot di buku`, "ok");
  }

  const next = firstStep(availableStockAdjustmentActions("Draft", can), STOCK_ADJUSTMENT_TRANSITIONS);

  async function onSave(step?: string) {
    setBusy(true);
    const payload = lines.map(({ item_id, tracking_no, location_id, stock_status_id, book_qty, counted_qty, value, note }) => ({ item_id, tracking_no, location_id, stock_status_id, book_qty, counted_qty, value, note }));
    const result = mode === "edit" ? await updateStockAdjustmentAction(doc!.id, header, payload) : await createStockAdjustmentAction(header, payload);
    setBusy(false);
    if (!result.ok) {
      const mapped: Record<string, string> = {};
      for (const [k, v] of Object.entries(result.errors)) {
        const m = /^lines\.(\d+)\.(\w+)$/.exec(k);
        mapped[m ? `lines.${lines[Number(m[1])]?.key}.${m[2]}` : k] = v;
      }
      setErrors(mapped);
      toast(result.errors._form ? "Tidak diizinkan" : "Belum bisa disimpan", result.errors._form ?? result.errors._lines ?? "Periksa kembali isian.", "err");
      return;
    }
    setDirty(false);
    toast("Stock Adjustment disimpan", `${result.no} · Draft`, "ok");
    router.push(withStep(`/inventory/stock-adjustment/${result.id}`, step));
  }

  const ro = (node: React.ReactNode) => <div className="ro">{node}</div>;
  const warehouse = doc?.warehouse ?? options.warehouses.find((w) => w.id === header.warehouse_id);
  const counted = lines.filter((l) => l.counted_qty.trim() !== "");
  const differing = counted.filter((l) => num(l.counted_qty) !== l.book_qty);
  const errOf = (l: Line) => ["item_id", "tracking_no", "location_id", "stock_status_id", "counted_qty", "value"].map((f) => errors[`lines.${l.key}.${f}`]).find(Boolean);

  const headerCard = (
    <div className="card">
      <FormBody>
        <FormSection title="Hitungan">
          <FormRow>
            <Field label="Gudang" span={4} required={editing} locked={editing && lines.length > 0} help={editing ? "satu gudang per hitungan" : undefined} error={errors.warehouse_id}>
              {editing && !lines.length ? (
                <Combobox
                  value={header.warehouse_id}
                  options={options.warehouses.filter((w) => w.active || w.id === header.warehouse_id)}
                  placeholder="Pilih Gudang…"
                  emptyText="Anda belum ditugaskan ke gudang mana pun."
                  invalid={Boolean(errors.warehouse_id)}
                  onChange={(v) => {
                    setHeader((h) => ({ ...h, warehouse_id: v }));
                    touch("warehouse_id");
                  }}
                />
              ) : warehouse ? (
                ro(
                  <>
                    <span className="lab">{warehouse.label}</span>
                    <span>{warehouse.name}</span>
                  </>
                )
              ) : (
                <div className="ro nil">tidak diisi</div>
              )}
            </Field>
            <Field label="Tanggal" span={3} required={editing} help={editing ? "hari selisih dibukukan" : undefined} error={errors.adjustment_date}>
              {editing ? (
                <DateInput
                  value={header.adjustment_date}
                  invalid={Boolean(errors.adjustment_date)}
                  onChange={(v) => {
                    setHeader((h) => ({ ...h, adjustment_date: v }));
                    touch("adjustment_date");
                  }}
                />
              ) : (
                ro(formatDate(header.adjustment_date))
              )}
            </Field>
            <Field label="Catatan" span={12}>
              {editing ? (
                <textarea
                  className="ta"
                  rows={2}
                  value={header.note}
                  placeholder="Catatan hitungan…"
                  onChange={(e) => {
                    setHeader((h) => ({ ...h, note: e.target.value }));
                    touch();
                  }}
                />
              ) : header.note ? (
                <div className="ro multi">{header.note}</div>
              ) : (
                <div className="ro multi nil opt">tidak diisi</div>
              )}
            </Field>
          </FormRow>
        </FormSection>
        <JournalReference id={doc?.journalId} no={doc?.journalNo} />
        {doc?.reason && (
          <p className="fnote">
            <b>{STOCK_ADJUSTMENT_STATUS_TEXT[status]}:</b> {doc.reason}
          </p>
        )}
        {editing && <p className="fnote">Hitungan berlaku terhadap saldo buku saat dimuat. Lot yang bergerak sesudahnya harus dihitung lagi.</p>}
      </FormBody>
    </div>
  );

  const linesCard = (
    <div className="card">
      <div className="card-h">
        <span className="ci">
          <Icon name="scale" size={15} />
        </span>
        <div className="ct">
          <h3>Lot Dihitung</h3>
          <p>
            {counted.length} dari {lines.length} baris dihitung · {differing.length} berselisih
          </p>
        </div>
        {editing && header.warehouse_id && (
          <>
            <button className="btn sm" disabled={busy} onClick={() => load(header.warehouse_id)}>
              <Icon name="layers" size={14} /> {lines.length ? "Muat Ulang Saldo" : "Muat Saldo"}
            </button>
            <button
              className="btn sm"
              disabled={busy}
              title="Lot yang ditemukan tanpa saldo di buku"
              onClick={() => {
                setLines((ls) => [...ls, { key: newKey(), item_id: null, tracking_no: "", location_id: null, stock_status_id: tersedia, book_qty: 0, counted_qty: "", value: "", note: "", found: true }]);
                touch("_lines");
              }}
            >
              <Icon name="plus" size={14} /> Lot Ditemukan
            </button>
          </>
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
      {lines.length ? (
        <div className="tw">
          <table className="grid ltab" style={{ minWidth: 1080 }}>
            <thead>
              <tr>
                <th style={{ width: 40 }}>No</th>
                <th>Barang</th>
                <th style={{ width: 190 }}>Lot</th>
                <th style={{ width: 190 }}>Tempat</th>
                <th className="num" style={{ width: 110 }}>Buku</th>
                <th className="num" style={{ width: 130 }}>Fisik</th>
                <th className="num" style={{ width: 110 }}>Selisih</th>
                <th className="num" style={{ width: 140 }}>{posted ? "Nilai" : "Nilai Lebih"}</th>
                {editing && <th style={{ width: 40 }} />}
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => {
                const item = l.item_id ? itemById.get(l.item_id) : undefined;
                const diff = l.counted_qty.trim() === "" ? null : Math.round((num(l.counted_qty) - l.book_qty) * 1_000_000) / 1_000_000;
                const err = errOf(l);
                const place = [locations.find((x) => x.id === l.location_id)?.label ?? (editing ? null : doc?.lines[i]?.locationLabel), options.statuses.find((s) => s.id === l.stock_status_id)?.name].filter(Boolean).join(" · ");
                return (
                  <tr key={l.key} className={err ? "overrow" : undefined}>
                    <td className="no">{i + 1}</td>
                    <td>
                      {editing && l.found ? (
                        <Combobox size="sm" value={l.item_id} options={options.items} placeholder="Pilih Barang…" onChange={(v) => setLine(l.key, { item_id: v })} />
                      ) : (
                        <span className="idc">
                          <span className="lab">{item?.label}</span>
                          <span className="nm">{item?.name}</span>
                        </span>
                      )}
                      {err && <span className="overtag">{err}</span>}
                    </td>
                    <td>
                      {editing && l.found ? (
                        <input className="inp sm mono" value={l.tracking_no} placeholder="Nomor lot" aria-label="Nomor lot" onChange={(e) => setLine(l.key, { tracking_no: e.target.value.toUpperCase() })} />
                      ) : (
                        <span className="mono">{l.tracking_no}</span>
                      )}
                    </td>
                    <td>
                      {editing && l.found ? (
                        <span className="dstack" style={{ gap: 4 }}>
                          {locations.length > 0 && (
                            <Select size="sm" ariaLabel="Lokasi" value={String(l.location_id ?? "")} options={locations.map((x) => ({ value: String(x.id), label: `${x.label} · ${x.name}` }))} placeholder="Pilih lokasi…" onChange={(v) => setLine(l.key, { location_id: Number(v) || null })} />
                          )}
                          <Select size="sm" ariaLabel="Status stok" value={String(l.stock_status_id ?? "")} options={options.statuses.map((s) => ({ value: String(s.id), label: s.name }))} placeholder="Pilih status…" onChange={(v) => setLine(l.key, { stock_status_id: Number(v) || null })} />
                        </span>
                      ) : (
                        place
                      )}
                    </td>
                    <td className="num">
                      {qtyText(l.book_qty)} {item?.uomLabel}
                    </td>
                    <td className="num">
                      {editing ? (
                        <MoneyInput size="sm" decimals={4} value={l.counted_qty} ariaLabel={`Fisik ${l.tracking_no}`} onChange={(v) => setLine(l.key, { counted_qty: v })} />
                      ) : l.counted_qty.trim() === "" ? (
                        <span className="dash">—</span>
                      ) : (
                        qtyText(num(l.counted_qty))
                      )}
                    </td>
                    <td className="num">{diff === null ? <span className="dash">—</span> : diff === 0 ? "0" : <span className={diff < 0 ? "overtag" : "fulltag"}>{diff > 0 ? "+" : "−"}{qtyText(Math.abs(diff))}</span>}</td>
                    <td className="num">
                      {posted ? (
                        <Amount value={doc?.lines[i]?.valueAmount ?? 0} ledger />
                      ) : diff !== null && diff > 0 ? (
                        editing ? (
                          <MoneyInput size="sm" decimals={0} value={l.value} placeholder="rata-rata" ariaLabel={`Nilai lebih ${l.tracking_no}`} onChange={(v) => setLine(l.key, { value: v })} />
                        ) : l.value ? (
                          <Amount value={Number(l.value)} />
                        ) : (
                          <span className="mut">rata-rata</span>
                        )
                      ) : (
                        <span className="dash">—</span>
                      )}
                    </td>
                    {editing && (
                      <td>
                        <button
                          className="iact del"
                          title="Keluarkan baris"
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
                <tr>
                  <td colSpan={7} className="num">
                    Lebih − kurang
                  </td>
                  <td className="num">
                    <Amount value={doc!.over - doc!.short} ledger />
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      ) : (
        <div className="empty sm">
          <h4>Belum ada lot</h4>
          <p>{header.warehouse_id ? "Muat Saldo membawa semua lot yang ada di buku gudang ini." : "Pilih Gudang dulu…"}</p>
        </div>
      )}
      {editing && lines.length > 0 && <p className="fnote">Nilai Lebih hanya dipakai bila barang itu tidak punya stok sama sekali; selain itu selisih lebih memakai harga pokok rata-rata.</p>}
    </div>
  );

  return (
    <>
      <DocumentHeader
        module="Persediaan"
        trail={[{ label: "Stock Adjustment", href: "/inventory/stock-adjustment" }]}
        icon="scale"
        number={doc?.no}
        placeholder="Stock Adjustment Baru"
        status={status}
        statusLabel={{ text: STOCK_ADJUSTMENT_STATUS_TEXT[status], tone: STOCK_ADJUSTMENT_STATUS_BADGE[status] }}
        editing={mode === "edit"}
        dirty={editing && dirty}
      >
        {editing ? (
          <>
            <CancelButton href={doc ? `/inventory/stock-adjustment/${doc.id}` : "/inventory/stock-adjustment"} dirty={dirty} disabled={busy} />
            <SaveButtons saving={busy} onSave={onSave} next={next} />
          </>
        ) : (
          <StockAdjustmentActions id={doc!.id} subject={doc!.no} status={status} can={can} />
        )}
      </DocumentHeader>
      <div className="fgrid solo">
        <div>
          {headerCard}
          <FormTabs tabs={[{ key: "lines", label: "Lot Dihitung", icon: "scale", count: lines.length, bad: tabHasError(errors, "_lines", "lines.", "line."), content: linesCard }]} />
        </div>
      </div>
    </>
  );
}
