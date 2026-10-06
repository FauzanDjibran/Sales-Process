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
import { ReceiptNoteActions } from "@/components/logistics/receipt-note-actions";
import { ReceiptNoteLinePicker } from "@/components/logistics/receipt-note-line-picker";
import { createReceiptNoteAction, updateReceiptNoteAction } from "@/app/actions/receipt-note";
import { RECEIPT_NOTE_STATUS_BADGE, RECEIPT_NOTE_STATUS_TEXT, cumulativeShare, type ReceiptNoteAbilities } from "@/lib/erp/receipt-note-workflow";
import type { ReceiptNoteHeaderInput, ReceiptNoteOptions, ReceiptNoteView } from "@/lib/erp/receipt-note";
import { PURCHASE_ORDER_KINDS, purchaseOrderKindOf } from "@/lib/erp/purchase-order-workflow";
import { formatDate, formatMoney, formatNumber, todayIso } from "@/lib/format";

/**
 * A Receipt Note in all three modes (P125): the Purchase Order first — chosen
 * once and locked — then where and when the goods came in, then the lines
 * picked from the order (B18). A Kelola Stok line is split into lots typed
 * here (B19), a lot without a number being numbered at posting; any other line
 * is an expense. The value shown is the line's share of the PO line's DPP (B20):
 * provisional on a Draft, as stored once posted.
 */

type LotState = { key: string; lot_no: string; expiry_date: string; qty: string };
type LineState = { key: string; source_doc_line_id: number; qty: string; note: string; lots: LotState[] };

let seq = 0;
const newKey = () => `k${Date.now().toString(36)}${seq++}`;
const money = (n: number) => formatMoney(n, "IDR");
const qtyText = (n: number) => formatNumber(n, n % 1 ? 2 : 0);

export function ReceiptNoteForm({
  mode,
  note,
  options,
  can,
}: {
  mode: "new" | "edit" | "view";
  note: ReceiptNoteView | null;
  options: ReceiptNoteOptions;
  can: ReceiptNoteAbilities;
}) {
  const router = useRouter();
  const toast = useToast();
  const editing = mode !== "view";
  const [header, setHeader] = useState<ReceiptNoteHeaderInput>(() =>
    note ? { ...note.header } : { source_doc_id: null, rn_date: todayIso(), warehouse_id: null, supplier_dn_no: "", note: "" }
  );
  const [lines, setLines] = useState<LineState[]>(() =>
    (note?.lines ?? []).map((l) => ({
      key: newKey(),
      source_doc_line_id: Number(l.source_doc_line_id),
      qty: String(l.qty),
      note: l.note,
      lots: (l.lots ?? []).map((p) => ({ key: newKey(), lot_no: p.lot_no, expiry_date: p.expiry_date, qty: String(p.qty) })),
    }))
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [picking, setPicking] = useState(false);

  const order = options.orders.find((o) => o.id === header.source_doc_id) ?? null;
  const poLine = useMemo(() => new Map((order?.lines ?? []).map((l) => [l.id, l])), [order]);
  const goods = order ? order.itemType === "Barang" : true;
  const touch = (...names: string[]) => {
    setDirty(true);
    setErrors((e) => {
      const next = { ...e };
      for (const n of names) delete next[n];
      return next;
    });
  };
  const set = <K extends keyof ReceiptNoteHeaderInput>(k: K, v: ReceiptNoteHeaderInput[K]) => {
    setHeader((h) => ({ ...h, [k]: v }));
    touch(k);
  };
  const pickOrder = (id: number | null) => {
    const o = options.orders.find((x) => x.id === id);
    setHeader((h) => ({ ...h, source_doc_id: id, warehouse_id: o?.itemType === "Barang" ? (o.warehouseId ?? null) : null }));
    setLines([]);
    touch("source_doc_id", "warehouse_id", "_lines");
  };
  const setLine = (key: string, patch: Partial<LineState>) => {
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
    touch("_lines");
  };
  const leftOf = (id: number) => {
    const l = poLine.get(id);
    return l ? Math.max(0, l.qty - l.held) : 0;
  };
  const applyPick = (ids: number[]) => {
    const keep = lines.filter((l) => ids.includes(l.source_doc_line_id));
    const have = new Set(keep.map((l) => l.source_doc_line_id));
    const added = ids
      .filter((id) => !have.has(id))
      .map((id) => {
        const left = String(leftOf(id));
        const stock = poLine.get(id)?.isStock;
        return { key: newKey(), source_doc_line_id: id, qty: left, note: "", lots: stock ? [{ key: newKey(), lot_no: "", expiry_date: "", qty: left }] : [] };
      });
    setLines([...keep, ...added]);
    setPicking(false);
    touch("_lines");
  };

  const valueOf = (l: LineState, i: number) => {
    if (mode === "view") return note?.lines[i]?.value ?? 0;
    const p = poLine.get(l.source_doc_line_id);
    return p ? cumulativeShare(p.dpp, p.qty, p.received, Math.min(Number(l.qty) || 0, Math.max(0, p.qty - p.received))) : 0;
  };
  const total = lines.reduce((s, l, i) => s + valueOf(l, i), 0);

  async function onSave() {
    setSaving(true);
    const payload = lines.map((l) => ({
      source_doc_line_id: l.source_doc_line_id,
      qty: l.qty,
      note: l.note,
      lots: l.lots.map((p) => ({ lot_no: p.lot_no, expiry_date: p.expiry_date, qty: p.qty })),
    }));
    const result = mode === "edit" ? await updateReceiptNoteAction(note!.id, header, payload) : await createReceiptNoteAction(header, payload);
    setSaving(false);
    if (!result.ok) {
      setErrors(result.errors);
      toast(result.errors._form ? "Tidak diizinkan" : "Belum bisa disimpan", result.errors._form ?? result.errors._lines ?? "Periksa kembali isian.", "err");
      return;
    }
    setDirty(false);
    toast("Receipt Note disimpan", `${result.rnNo} · Draft`, "ok");
    router.push(`/logistics/receipt-note/${result.id}`);
  }

  const status = note?.status ?? "Draft";
  const ro = (n: React.ReactNode) => <div className="ro">{n}</div>;
  const nil = (t = "tidak diisi") => <div className="ro nil">{t}</div>;
  const orderOptions = options.orders.map((o) => ({ id: o.id, label: o.orderNo, name: `${o.supplierLabel} · ${o.supplierName}`, active: true }));

  const headerCard = (
    <div className="card">
      <FormBody>
        <FormSection title="Sumber">
          <FormRow>
            <Field label="Purchase Order" span={4} required={mode === "new"} help={mode === "new" ? "Purchase Order yang Open" : undefined} error={errors.source_doc_id}>
              {mode === "new" ? (
                <Combobox
                  value={header.source_doc_id}
                  options={orderOptions}
                  placeholder="Pilih Purchase Order…"
                  emptyText="Belum ada Purchase Order Open yang masih bisa diterima"
                  invalid={Boolean(errors.source_doc_id)}
                  onChange={pickOrder}
                />
              ) : (
                ro(
                  <Link className="drl" href={`${PURCHASE_ORDER_KINDS[purchaseOrderKindOf(order?.itemType ?? "Barang")].path}/${header.source_doc_id}`}>
                    <span className="mono">{order?.orderNo}</span>
                  </Link>
                )
              )}
            </Field>
            <Field label="Supplier" span={5}>
              {order ? ro(<><span className="lab">{order.supplierLabel}</span><span>{order.supplierName}</span></>) : nil("menunggu Purchase Order")}
            </Field>
            <Field label="Jenis" span={3}>
              {order ? ro(<span className="bdg t-slate">{order.itemType}</span>) : nil("—")}
            </Field>
          </FormRow>
        </FormSection>
        <FormSection title="Penerimaan">
          <FormRow>
            <Field label="Tanggal Terima" span={3} required={editing} error={errors.rn_date}>
              {editing ? <DateInput value={header.rn_date} invalid={Boolean(errors.rn_date)} onChange={(v) => set("rn_date", v)} /> : ro(formatDate(header.rn_date))}
            </Field>
            {goods && (
              <Field label="Gudang" span={3} required={editing} error={errors.warehouse_id}>
                {editing ? (
                  <Combobox value={header.warehouse_id} options={options.warehouses} placeholder="Pilih Gudang…" invalid={Boolean(errors.warehouse_id)} onChange={(v) => set("warehouse_id", v)} />
                ) : (
                  ro(<span className="lab">{options.warehouses.find((w) => w.id === header.warehouse_id)?.label ?? "—"}</span>)
                )}
              </Field>
            )}
            <Field label="No. Surat Jalan Supplier" span={3} help={editing ? "jika ada" : undefined}>
              {editing ? (
                <input className="inp idf" value={header.supplier_dn_no} autoComplete="off" onChange={(e) => set("supplier_dn_no", e.target.value)} />
              ) : header.supplier_dn_no ? (
                ro(<span className="mono">{header.supplier_dn_no}</span>)
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
                <textarea className="ta" rows={2} value={header.note} placeholder="Keterangan tambahan (opsional)…" onChange={(e) => set("note", e.target.value)} />
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

  const addButton = order && (
    <button className="btn sm primary" onClick={() => setPicking(true)}>
      <Icon name="plus" size={14} /> Pilih dari PO
    </button>
  );

  const linesCard = (
    <div className="card" style={{ marginTop: 14 }}>
      <div className="card-h">
        <span className="ci">
          <Icon name="box" size={15} />
        </span>
        <div className="ct">
          <h3>Diterima</h3>
          <p>Barang Kelola Stok masuk per lot (No. Lot kosong diberi nomor saat posting); barang lain dan jasa dibebankan.</p>
        </div>
        {editing && addButton}
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
          <h4>Belum ada baris</h4>
          <p>{order ? "Pilih baris Purchase Order yang diterima." : "Pilih Purchase Order dulu…"}</p>
          {editing && addButton && <div className="cta">{addButton}</div>}
        </div>
      ) : (
        <div className="tw">
          <table className="grid ltab" style={{ minWidth: 940 }}>
            <thead>
              <tr>
                <th style={{ width: 40 }}>No</th>
                <th>Barang / Jasa</th>
                <th style={{ width: 170 }}>Qty</th>
                <th style={{ width: 380 }}>Lot</th>
                <th className="num" style={{ width: 140 }}>Nilai</th>
                {editing && <th style={{ width: 40 }} />}
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => {
                const p = poLine.get(l.source_doc_line_id);
                const err = errors[`lines.${i}.source_doc_line_id`] ?? errors[`lines.${i}.qty`] ?? errors[`lines.${i}.lots`];
                const stock = p?.isStock ?? note?.lines[i]?.isStock ?? false;
                return (
                  <tr key={l.key} className={err ? "overrow" : undefined}>
                    <td className="no">{i + 1}</td>
                    <td>
                      <span className="idc">
                        <span className="lab">{p?.itemLabel}</span>
                        <span className="nm">{p?.itemName}</span>
                      </span>
                      {err && <span className="overtag">{err}</span>}
                    </td>
                    <td>
                      {editing ? (
                        <div className="qcell">
                          <MoneyInput size="sm" decimals={4} value={l.qty} ariaLabel="Qty" onChange={(v) => setLine(l.key, { qty: v })} />
                          <span className="qu">{p?.uomLabel}</span>
                        </div>
                      ) : (
                        <span className="qview">
                          <span className="mny">{qtyText(Number(l.qty))}</span>
                          <span className="lab">{p?.uomLabel}</span>
                        </span>
                      )}
                      {editing && p && <span className="fulltag">sisa {qtyText(leftOf(p.id))}</span>}
                    </td>
                    <td>
                      {!stock ? (
                        <span className="dash">{goods ? "dibebankan" : "jasa — dibebankan"}</span>
                      ) : editing ? (
                        <div style={{ display: "grid", gap: 4 }}>
                          {l.lots.map((lot) => (
                            <div key={lot.key} style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr 0.9fr 28px", gap: 4 }}>
                              <input
                                className="inp sm idf"
                                value={lot.lot_no}
                                placeholder="No. Lot (otomatis)"
                                aria-label="No. Lot"
                                onChange={(e) => setLine(l.key, { lots: l.lots.map((x) => (x.key === lot.key ? { ...x, lot_no: e.target.value } : x)) })}
                              />
                              <DateInput
                                value={lot.expiry_date}
                                placeholder={p?.hasExpiry ? "Kadaluarsa" : "Kadaluarsa (opsional)"}
                                onChange={(v) => setLine(l.key, { lots: l.lots.map((x) => (x.key === lot.key ? { ...x, expiry_date: v } : x)) })}
                              />
                              <MoneyInput
                                size="sm"
                                decimals={4}
                                value={lot.qty}
                                ariaLabel="Qty lot"
                                onChange={(v) => setLine(l.key, { lots: l.lots.map((x) => (x.key === lot.key ? { ...x, qty: v } : x)) })}
                              />
                              <button className="iact del" title="Hapus lot" onClick={() => setLine(l.key, { lots: l.lots.filter((x) => x.key !== lot.key) })}>
                                <Icon name="trash" size={13} />
                              </button>
                            </div>
                          ))}
                          <button
                            className="btn sm"
                            style={{ justifySelf: "start" }}
                            onClick={() => {
                              const used = l.lots.reduce((s, x) => s + (Number(x.qty) || 0), 0);
                              const rest = Math.max(0, (Number(l.qty) || 0) - used);
                              setLine(l.key, { lots: [...l.lots, { key: newKey(), lot_no: "", expiry_date: "", qty: rest ? String(+rest.toFixed(4)) : "" }] });
                            }}
                          >
                            <Icon name="plus" size={13} /> Tambah Lot
                          </button>
                        </div>
                      ) : (
                        <span className="fulltag" style={{ whiteSpace: "normal" }}>
                          {l.lots.map((lot) => `${lot.lot_no || "(otomatis)"}${lot.expiry_date ? ` · exp ${formatDate(lot.expiry_date)}` : ""}: ${qtyText(Number(lot.qty))}`).join(" · ")}
                        </span>
                      )}
                    </td>
                    <td className="num">
                      <span className="mny">{money(valueOf(l, i))}</span>
                    </td>
                    {editing && (
                      <td>
                        <button className="iact del" title="Hapus baris" onClick={() => { setLines((ls) => ls.filter((x) => x.key !== l.key)); touch("_lines"); }}>
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
        <div className="impact">
          <div className="ttl">Nilai Penerimaan · DPP Purchase Order</div>
          <div className="ir tot">
            <span>{status === "Posted" ? "Nilai diposting" : "Perkiraan nilai"}</span>
            <b>{money(status === "Posted" ? (note?.value ?? 0) : total)}</b>
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <>
      <div className="ph">
        <div className="crumb">
          <span>Logistik</span>
          <span>/</span>
          <Link href="/logistics/receipt-note">Receipt Note</Link>
          <span>/</span>
          <span className="cur">{note ? note.rnNo : "Baru"}</span>
        </div>
        <div className="ph-row">
          <h1>
            <span className="ph-ico">
              <Icon name="box" size={16} />
            </span>
            {note ? (
              <>
                <span className="docno">{note.rnNo}</span>
                <span className={`bdg ${RECEIPT_NOTE_STATUS_BADGE[status]}`}>{RECEIPT_NOTE_STATUS_TEXT[status]}</span>
              </>
            ) : (
              "Receipt Note Baru"
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
                <CancelButton href={note ? `/logistics/receipt-note/${note.id}` : "/logistics/receipt-note"} dirty={dirty} disabled={saving} />
                <button className="btn primary" onClick={onSave} disabled={saving}>
                  <Icon name="save" size={15} /> {saving ? "Menyimpan…" : "Simpan"}
                </button>
              </>
            ) : (
              <ReceiptNoteActions id={note!.id} subject={note!.rnNo} status={status} can={can} />
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
      {picking && order && (
        <ReceiptNoteLinePicker lines={order.lines} current={lines.map((l) => l.source_doc_line_id)} orderNo={order.orderNo} onApply={applyPick} onClose={() => setPicking(false)} />
      )}
    </>
  );
}
