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
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { ReceiptNoteActions } from "@/components/inventory/receipt-note-actions";
import { createReceiptNoteAction, updateReceiptNoteAction } from "@/app/actions/receipt-note";
import { SALES_RETURN, type ReceiptNoteAbilities } from "@/lib/erp/receipt-note-workflow";
import type { ReceiptNoteHeaderInput, ReceiptNoteView, ReturnReceiptOptions, RrSourceLine, RrSourceOption } from "@/lib/erp/receipt-note";
import { formatDate, formatNumber, todayIso } from "@/lib/format";

/**
 * A Receipt Note of purpose `sales_return` in all three modes (P288,
 * `Sales-Return-Plan.md` §5): goods a customer sends back, received against one
 * Open Sales Return. Each line is a quantity of a return line, and it comes in
 * as the lots that left on the Delivery Note — each lot in a location of the
 * warehouse where it has any, and under the stock status the warehouse decides
 * (a damaged good may come back Karantina or Diblokir). No price and no tax:
 * the goods come back at the value they left at, and the Credit Note reverses
 * what was billed.
 */

type LotState = { key: string; source_tracking_id: number; qty: string; location_id: number | null; stock_status_id: number | null };
type LineState = { key: string; source_doc_line_id: number; qty: string; lots: LotState[] };

let seq = 0;
const newKey = () => `r${Date.now().toString(36)}${seq++}`;
const qtyText = (n: number) => formatNumber(n, n % 1 ? 2 : 0);
const left = (l: RrSourceLine) => Math.max(0, l.qty - l.held);

/** A return line starting on all that is left, spread over its lots as far as each still holds. */
function startLine(l: RrSourceLine, available: number | null): LineState {
  let rest = left(l);
  const lots: LotState[] = [];
  for (const t of l.trackings) {
    if (rest <= 0) break;
    const take = Math.min(rest, t.room);
    if (take <= 0) continue;
    lots.push({ key: newKey(), source_tracking_id: t.id, qty: String(take), location_id: null, stock_status_id: available });
    rest -= take;
  }
  return { key: newKey(), source_doc_line_id: l.id, qty: String(left(l)), lots };
}

export function ReturnReceiptForm({
  mode,
  note,
  options,
  can,
  presetReturnId = null,
}: {
  mode: "new" | "edit" | "view";
  note: ReceiptNoteView | null;
  options: ReturnReceiptOptions;
  can: ReceiptNoteAbilities;
  presetReturnId?: number | null;
}) {
  const router = useRouter();
  const toast = useToast();
  const editing = mode !== "view";
  const available = options.statuses.find((s) => s.label === "TERSEDIA")?.id ?? null;
  const byId = useMemo(() => new Map(options.returns.map((r) => [r.id, r])), [options.returns]);

  const startFrom = (r: RrSourceOption | undefined) => r?.lines.filter((l) => left(l) > 0).map((l) => startLine(l, available)) ?? [];
  const preset = presetReturnId ? byId.get(presetReturnId) : undefined;

  const [header, setHeader] = useState<ReceiptNoteHeaderInput>(() =>
    note
      ? { ...note.header }
      : {
          purpose: SALES_RETURN,
          source_doc_id: preset?.id ?? null,
          rn_date: todayIso(),
          warehouse_id: preset?.lines[0]?.warehouseId ?? null,
          supplier_dn_no: "",
          note: "",
        }
  );
  const [lines, setLines] = useState<LineState[]>(() =>
    note
      ? note.lines.map((l) => ({
          key: newKey(),
          source_doc_line_id: Number(l.source_doc_line_id),
          qty: String(l.qty),
          lots: (l.lots ?? []).map((p) => ({
            key: newKey(),
            source_tracking_id: Number(p.source_tracking_id),
            qty: String(p.qty),
            location_id: p.location_id ?? null,
            stock_status_id: p.stock_status_id ?? null,
          })),
        }))
      : startFrom(preset)
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  const source = header.source_doc_id ? byId.get(header.source_doc_id) : undefined;
  const srLine = useMemo(() => new Map((source?.lines ?? []).map((l) => [l.id, l])), [source]);
  const warehouse = options.warehouses.find((w) => w.id === header.warehouse_id);
  const statusName = new Map(options.statuses.map((s) => [s.id, s.name]));
  const locationLabel = new Map((warehouse?.locations ?? []).map((x) => [x.id, x.label]));

  const touch = (...names: string[]) => {
    setDirty(true);
    setErrors((e) => {
      const next = { ...e };
      for (const n of names) delete next[n];
      return next;
    });
  };
  const set = <K extends keyof ReceiptNoteHeaderInput>(k: K, v: ReceiptNoteHeaderInput[K]) => {
    setHeader((x) => ({ ...x, [k]: v }));
    touch(k);
  };
  const pickReturn = (id: number | null) => {
    const r = id ? byId.get(id) : undefined;
    setHeader((x) => ({ ...x, source_doc_id: id, warehouse_id: r?.lines[0]?.warehouseId ?? x.warehouse_id }));
    setLines(startFrom(r));
    touch("source_doc_id", "warehouse_id", "_lines");
  };
  const setLine = (key: string, patch: Partial<LineState>) => {
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
    touch("_lines");
  };
  const setLot = (lineKey: string, lotKey: string, patch: Partial<LotState>) => {
    setLines((ls) => ls.map((l) => (l.key === lineKey ? { ...l, lots: l.lots.map((p) => (p.key === lotKey ? { ...p, ...patch } : p)) } : l)));
    touch("_lines");
  };

  async function onSave() {
    setSaving(true);
    const sent = lines;
    const payload = sent.map((l) => ({
      source_doc_line_id: l.source_doc_line_id,
      qty: l.qty,
      note: "",
      lots: l.lots.map((p) => ({
        tracking_no: "",
        expiry_date: "",
        source_tracking_id: p.source_tracking_id,
        qty: p.qty,
        location_id: p.location_id,
        stock_status_id: p.stock_status_id,
      })),
    }));
    const result = mode === "edit" ? await updateReceiptNoteAction(note!.id, header, payload) : await createReceiptNoteAction(header, payload);
    setSaving(false);
    if (!result.ok) {
      const mapped: Record<string, string> = {};
      for (const [k, v] of Object.entries(result.errors)) {
        const m = /^lines\.(\d+)\.(\w+)$/.exec(k);
        if (m) mapped[`lines.${sent[Number(m[1])]?.key}`] = v;
        else mapped[k] = v;
      }
      setErrors(mapped);
      toast(result.errors._form ? "Tidak diizinkan" : "Belum bisa disimpan", result.errors._form ?? result.errors._lines ?? "Periksa kembali isian.", "err");
      return;
    }
    setDirty(false);
    toast("Receipt Note disimpan", `${result.rnNo} · Draft`, "ok");
    router.push(`/inventory/receipt-note/${result.id}`);
  }

  const status = note?.status ?? "Draft";
  const ro = (node: React.ReactNode) => <div className="ro">{node}</div>;
  const nil = (t = "tidak diisi") => <div className="ro nil">{t}</div>;
  const storedLine = new Map((note?.lines ?? []).map((l) => [Number(l.source_doc_line_id), l]));

  const headerCard = (
    <div className="card">
      <FormBody>
        <FormSection title="Sumber">
          <FormRow>
            <Field label="Tujuan" span={3}>
              {ro("Retur Penjualan")}
            </Field>
            <Field label="Sales Return" span={3} required={mode === "new"} locked={mode === "edit"} error={errors.source_doc_id}>
              {mode === "new" ? (
                <Combobox
                  value={header.source_doc_id}
                  options={options.returns.map((r) => ({ id: r.id, label: r.returnNo, name: r.customerName, active: true }))}
                  placeholder="Pilih Sales Return…"
                  emptyText="Belum ada Sales Return Open yang menunggu barangnya."
                  invalid={Boolean(errors.source_doc_id)}
                  onChange={pickReturn}
                />
              ) : source ? (
                ro(
                  <Link className="drl" href={`/sales/return/${source.id}`}>
                    <span className="mono">{source.returnNo}</span>
                  </Link>
                )
              ) : (
                nil()
              )}
            </Field>
            <Field label="Customer Order" span={3}>
              {source ? ro(<span className="mono">{source.customerOrderNo}</span>) : nil("menunggu Sales Return")}
            </Field>
            <Field label="Customer" span={3}>
              {source
                ? ro(
                    <>
                      <span className="lab">{source.customerLabel}</span>
                      <span>{source.customerName}</span>
                    </>
                  )
                : nil("menunggu Sales Return")}
            </Field>
          </FormRow>
        </FormSection>
        <FormSection title="Penerimaan">
          <FormRow>
            <Field label="Tanggal Terima" span={3} required={editing} error={errors.rn_date}>
              {editing ? (
                <DateInput value={header.rn_date} invalid={Boolean(errors.rn_date)} onChange={(v) => set("rn_date", v)} />
              ) : (
                ro(formatDate(header.rn_date))
              )}
            </Field>
            <Field label="Gudang" span={4} required={editing} help={editing ? "mulai dari gudang pengiriman" : undefined} error={errors.warehouse_id}>
              {editing ? (
                <Combobox
                  value={header.warehouse_id}
                  options={options.warehouses.map((w) => ({ id: w.id, label: w.label, name: w.name, active: w.active }))}
                  placeholder="Pilih Gudang…"
                  invalid={Boolean(errors.warehouse_id)}
                  onChange={(v) => {
                    set("warehouse_id", v);
                    // Locations belong to a warehouse: a change clears them.
                    setLines((ls) => ls.map((l) => ({ ...l, lots: l.lots.map((p) => ({ ...p, location_id: null })) })));
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
                nil()
              )}
            </Field>
            {note?.journalNo && (
              <Field label="Journal" span={3}>
                {ro(
                  <Link className="drl" href={`/accounting/journal/${note.journalId}`}>
                    <span className="mono">{note.journalNo}</span>
                  </Link>
                )}
              </Field>
            )}
            <Field label="Catatan" span={12}>
              {editing ? (
                <textarea className="ta" rows={2} value={header.note} placeholder="Kondisi barang saat diterima…" onChange={(e) => set("note", e.target.value)} />
              ) : header.note ? (
                <div className="ro multi">{header.note}</div>
              ) : (
                <div className="ro multi nil">tidak diisi</div>
              )}
            </Field>
          </FormRow>
        </FormSection>
        {note?.cancelReason && (
          <p className="fnote">
            <b>Dibatalkan:</b> {note.cancelReason}
          </p>
        )}
      </FormBody>
    </div>
  );

  const linesCard = (
    <div className="card" style={{ marginTop: 14 }}>
      <div className="card-h">
        <span className="ci">
          <Icon name="box" size={15} />
        </span>
        <div className="ct">
          <h3>Barang Diterima Kembali</h3>
          <p>Per lot yang dulu dikirim. Nilainya mengikuti nilai saat barang keluar, sehingga HPP dibalik tepat.</p>
        </div>
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
          <h4>{source ? "Tidak ada yang tersisa" : "Pilih Sales Return dulu…"}</h4>
          <p>{source ? "Semua barang Sales Return ini sudah ada di Receipt Note lain." : "Barangnya mengikuti baris Sales Return yang dipilih."}</p>
        </div>
      ) : (
        <div className="tw">
          <table className="grid ltab" style={{ minWidth: 900 }}>
            <thead>
              <tr>
                <th style={{ width: 40 }}>No</th>
                <th>Barang</th>
                <th style={{ width: editing ? 190 : 120 }}>Qty</th>
                <th style={{ width: 430 }}>Lot</th>
                {!editing && <th className="num" style={{ width: 130 }}>Nilai</th>}
                {editing && <th style={{ width: 40 }} />}
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => {
                const sr = srLine.get(l.source_doc_line_id);
                const err = errors[`lines.${l.key}`];
                const tracks = new Map((sr?.trackings ?? []).map((t) => [t.id, t]));
                const unused = (sr?.trackings ?? []).filter((t) => !l.lots.some((p) => p.source_tracking_id === t.id));
                return (
                  <tr key={l.key} className={err ? "overrow" : undefined}>
                    <td className="no">{i + 1}</td>
                    <td>
                      <span className="idc">
                        <span className="lab">{sr?.itemLabel}</span>
                        <span className="nm">{sr?.itemName}</span>
                      </span>
                      {err && <span className="overtag">{err}</span>}
                    </td>
                    <td>
                      {editing ? (
                        <>
                          <div className="qcell">
                            <MoneyInput size="sm" decimals={4} value={l.qty} ariaLabel={`Qty ${sr?.itemLabel ?? ""}`} onChange={(v) => setLine(l.key, { qty: v })} />
                            <span className="qu">{sr?.uomLabel}</span>
                          </div>
                          {sr && (
                            <span className="fulltag">
                              maks. {qtyText(left(sr))} {sr.uomLabel}
                            </span>
                          )}
                        </>
                      ) : (
                        <span className="qview">
                          <span className="mny">{qtyText(Number(l.qty))}</span>
                          <span className="lab">{sr?.uomLabel}</span>
                        </span>
                      )}
                    </td>
                    <td>
                      {l.lots.map((p, j) => {
                        const t = tracks.get(p.source_tracking_id);
                        const lotValue = status === "Posted" ? storedLine.get(l.source_doc_line_id)?.lotValues[j] : undefined;
                        return editing ? (
                          <div key={p.key} className="qcell" style={{ gap: 6, marginBottom: 6, flexWrap: "wrap" }}>
                            <span className="mono" style={{ minWidth: 110 }} title={t?.expiryDate ? `kadaluarsa ${formatDate(t.expiryDate)}` : undefined}>
                              {t?.trackingNo}
                            </span>
                            <div style={{ width: 90 }}>
                              <MoneyInput size="sm" decimals={4} value={p.qty} ariaLabel={`Qty lot ${t?.trackingNo ?? ""}`} onChange={(v) => setLot(l.key, p.key, { qty: v })} />
                            </div>
                            <div style={{ width: 120 }}>
                              <Select
                                value={p.stock_status_id ? String(p.stock_status_id) : ""}
                                options={options.statuses.map((s) => ({ value: String(s.id), label: s.name }))}
                                placeholder="Status…"
                                onChange={(v) => setLot(l.key, p.key, { stock_status_id: v ? Number(v) : null })}
                              />
                            </div>
                            {warehouse?.useLocation && (
                              <div style={{ width: 110 }}>
                                <Select
                                  value={p.location_id ? String(p.location_id) : ""}
                                  options={warehouse.locations.filter((x) => x.active || x.id === p.location_id).map((x) => ({ value: String(x.id), label: x.label }))}
                                  placeholder="Lokasi…"
                                  onChange={(v) => setLot(l.key, p.key, { location_id: v ? Number(v) : null })}
                                />
                              </div>
                            )}
                            <button
                              className="iact del"
                              title="Hapus lot"
                              onClick={() => setLine(l.key, { lots: l.lots.filter((x) => x.key !== p.key) })}
                            >
                              <Icon name="trash" size={13} />
                            </button>
                            {t && <span className="fulltag">bisa kembali {qtyText(t.room)}</span>}
                          </div>
                        ) : (
                          <div key={p.key} className="idc">
                            <span className="lab">{t?.trackingNo}</span>
                            <span className="nm">
                              {qtyText(Number(p.qty))} {sr?.uomLabel} · {statusName.get(p.stock_status_id ?? 0) ?? "Tersedia"}
                              {p.location_id ? ` · ${locationLabel.get(p.location_id) ?? ""}` : ""}
                              {lotValue != null && (
                                <>
                                  {" · "}
                                  <Amount value={lotValue} />
                                </>
                              )}
                            </span>
                          </div>
                        );
                      })}
                      {editing && unused.length > 0 && (
                        <button
                          className="btn sm"
                          onClick={() =>
                            setLine(l.key, {
                              lots: [...l.lots, { key: newKey(), source_tracking_id: unused[0].id, qty: "", location_id: null, stock_status_id: available }],
                            })
                          }
                        >
                          <Icon name="plus" size={13} /> Lot {unused[0].trackingNo}
                        </button>
                      )}
                    </td>
                    {!editing && (
                      <td className="num">{status === "Posted" ? <Amount value={storedLine.get(l.source_doc_line_id)?.value ?? 0} /> : <span className="dash">—</span>}</td>
                    )}
                    {editing && (
                      <td>
                        <button className="iact del" title="Hapus baris" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}>
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

  return (
    <>
      <DocumentHeader
        module="Persediaan"
        trail={[{ label: "Receipt Note", href: "/inventory/receipt-note" }]}
        icon="box"
        number={note?.rnNo}
        placeholder="Penerimaan Retur Baru"
        status={status}
        editing={mode === "edit"}
        dirty={editing && dirty}
      >
        {editing ? (
          <>
            <CancelButton href={note ? `/inventory/receipt-note/${note.id}` : "/inventory/receipt-note"} dirty={dirty} disabled={saving} />
            <button className="btn primary" onClick={onSave} disabled={saving}>
              <Icon name="save" size={15} /> {saving ? "Menyimpan…" : "Simpan"}
            </button>
          </>
        ) : (
          <ReceiptNoteActions id={note!.id} subject={note!.rnNo} status={status} can={can} purpose={SALES_RETURN} />
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
