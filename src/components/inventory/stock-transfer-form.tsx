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
import { DeliveryNoteLotPicker, type LotPick } from "@/components/inventory/delivery-note-lot-picker";
import { TransferActions } from "@/components/inventory/transfer-actions";
import { createStockTransferAction, transitionStockTransferAction, updateStockTransferAction } from "@/app/actions/stock-transfer";
import {
  STOCK_TRANSFER_RECEIPT_STATUS_BADGE,
  STOCK_TRANSFER_RECEIPT_STATUS_TEXT,
  STOCK_TRANSFER_STATUS_BADGE,
  STOCK_TRANSFER_STATUS_TEXT,
  STOCK_TRANSFER_TRANSITIONS,
  availableStockTransferActions,
  stockTransferIsEditable,
  type StockTransferAbilities,
  type StockTransferReceiptStatus,
} from "@/lib/erp/stock-transfer-workflow";
import type { StockTransferHeaderInput, StockTransferOptions, StockTransferView } from "@/lib/erp/stock-transfer";
import { formatDate, formatNumber, todayIso } from "@/lib/format";
import { FormTabs, tabHasError } from "@/components/ui/form-tabs";

/**
 * A Transfer Kirim in its three modes (P300, Stock-Transfer-Plan.md §3.1).
 *
 * The user names the origin — one of their warehouses (OD-9) — the
 * destination and the day; then each item in its base unit and the buckets it
 * leaves from, any status (OD-4), with the Delivery Note's lot picker.
 * Changing the origin clears the picks. Quantities only: a transfer moves no
 * value (OD-6), so no value is shown. Once sent, each lot shows what the
 * destination received, and the Transfer Terima made from it are listed.
 */

type LineState = { key: string; item_id: number | null; qty: string; picks: LotPick[] };

let seq = 0;
const newKey = () => `t${Date.now().toString(36)}${seq++}`;
const qtyText = (n: number) => formatNumber(n, n % 1 ? 2 : 0);
const blankLine = (): LineState => ({ key: newKey(), item_id: null, qty: "", picks: [] });

export type TransferReceiptRef = { id: number; receiptNo: string; receiptDate: string; status: StockTransferReceiptStatus; qty: number };

export function StockTransferForm({
  mode,
  transfer,
  options,
  can,
  receipts = [],
}: {
  mode: "new" | "edit" | "view";
  transfer: StockTransferView | null;
  options: StockTransferOptions;
  can: StockTransferAbilities;
  receipts?: TransferReceiptRef[];
}) {
  const router = useRouter();
  const toast = useToast();
  const editing = mode !== "view";
  const itemById = useMemo(() => new Map(options.items.map((i) => [i.id, i])), [options.items]);
  const onlyFrom = options.fromWarehouses.filter((w) => w.active);

  const [header, setHeader] = useState<StockTransferHeaderInput>(() =>
    transfer
      ? { ...transfer.header }
      : { transfer_date: todayIso(), from_warehouse_id: onlyFrom.length === 1 ? onlyFrom[0].id : null, to_warehouse_id: null, vehicle_no: "", driver_name: "", note: "" }
  );
  const [lines, setLines] = useState<LineState[]>(() =>
    transfer
      ? transfer.lines.map((l) => ({
          key: newKey(),
          item_id: Number(l.item_id),
          qty: String(l.qty),
          picks: (l.picks ?? []).map((p) => ({ tracking_id: Number(p.tracking_id), location_id: p.location_id ?? null, stock_status_id: p.stock_status_id ?? null, qty: String(p.qty) })),
        }))
      : [blankLine()]
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [lotsFor, setLotsFor] = useState<string | null>(null);

  const status = transfer?.status ?? "Draft";
  const sent = status === "InTransit" || status === "Received";
  const lotsOf = (itemId: number | null) => (header.from_warehouse_id && itemId ? (options.lots[header.from_warehouse_id]?.[itemId] ?? []) : []);
  const placeOf = (id: number | null, list: { id: number; label: string; name: string }[]) => list.find((w) => w.id === id);

  const touch = (...names: string[]) => {
    setDirty(true);
    setErrors((e) => {
      const next = { ...e };
      for (const n of names) delete next[n];
      return next;
    });
  };
  const set = <K extends keyof StockTransferHeaderInput>(k: K, v: StockTransferHeaderInput[K]) => {
    setHeader((x) => ({ ...x, [k]: v }));
    touch(k);
  };
  const setLine = (key: string, patch: Partial<LineState>) => {
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
    touch("_lines");
  };
  const pickFrom = (id: number | null) => {
    setHeader((x) => ({ ...x, from_warehouse_id: id }));
    if (id !== header.from_warehouse_id) setLines((ls) => ls.map((l) => ({ ...l, picks: [] })));
    touch("from_warehouse_id", "_lines");
  };

  async function onSave() {
    setSaving(true);
    const sentLines = lines;
    const payload = sentLines.map((l) => ({ item_id: l.item_id, qty: l.qty, note: "", picks: l.picks }));
    const result = mode === "edit" ? await updateStockTransferAction(transfer!.id, header, payload) : await createStockTransferAction(header, payload);
    setSaving(false);
    if (!result.ok) {
      const mapped: Record<string, string> = {};
      for (const [k, v] of Object.entries(result.errors)) {
        const m = /^lines\.(\d+)\.(\w+)$/.exec(k);
        if (m) mapped[`lines.${sentLines[Number(m[1])]?.key}.${m[2]}`] = v;
        else mapped[k] = v;
      }
      setErrors(mapped);
      toast(result.errors._form ? "Tidak diizinkan" : "Belum bisa disimpan", result.errors._form ?? result.errors._lines ?? "Periksa kembali isian.", "err");
      return;
    }
    setDirty(false);
    toast("Transfer Kirim disimpan", `${result.transferNo} · Draft`, "ok");
    router.push(`/inventory/stock-transfer/${result.id}`);
  }

  const backHref = transfer ? `/inventory/stock-transfer/${transfer.id}` : "/inventory/stock-transfer";
  const ro = (node: React.ReactNode) => <div className="ro">{node}</div>;
  const nil = (t = "tidak diisi") => <div className="ro nil">{t}</div>;
  const place = (p: { label: string; name: string } | undefined) =>
    p
      ? ro(
          <>
            <span className="lab">{p.label}</span>
            <span>{p.name}</span>
          </>
        )
      : nil();
  const lineErr = (key: string, f: string) => errors[`lines.${key}.${f}`];
  const transit = transfer?.transit ?? options.transit;

  const headerCard = (
    <div className="card">
      <FormBody>
        <FormSection title="Pengiriman">
          <FormRow>
            <Field label="Tanggal Kirim" span={3} required={editing} help={editing ? "hari barang keluar" : undefined} error={errors.transfer_date}>
              {editing ? <DateInput value={header.transfer_date} invalid={Boolean(errors.transfer_date)} onChange={(v) => set("transfer_date", v)} /> : ro(formatDate(header.transfer_date))}
            </Field>
            <Field label="Gudang Asal" span={3} required={editing} help={editing ? "gudang Anda" : undefined} error={errors.from_warehouse_id}>
              {editing ? (
                <Combobox
                  value={header.from_warehouse_id}
                  options={options.fromWarehouses.filter((w) => w.active || w.id === header.from_warehouse_id)}
                  placeholder="Pilih Gudang Asal…"
                  emptyText="Anda belum ditugaskan ke gudang mana pun."
                  invalid={Boolean(errors.from_warehouse_id)}
                  onChange={pickFrom}
                />
              ) : (
                place(placeOf(Number(header.from_warehouse_id), options.fromWarehouses) ?? placeOf(Number(header.from_warehouse_id), options.toWarehouses))
              )}
            </Field>
            <Field label="Gudang Tujuan" span={3} required={editing} error={errors.to_warehouse_id}>
              {editing ? (
                <Combobox
                  value={header.to_warehouse_id}
                  options={options.toWarehouses.filter((w) => (w.active || w.id === header.to_warehouse_id) && w.id !== header.from_warehouse_id)}
                  placeholder={header.from_warehouse_id ? "Pilih Gudang Tujuan…" : "Pilih Gudang Asal dulu…"}
                  invalid={Boolean(errors.to_warehouse_id)}
                  onChange={(v) => set("to_warehouse_id", v)}
                />
              ) : (
                place(placeOf(Number(header.to_warehouse_id), options.toWarehouses))
              )}
            </Field>
            <Field label="Gudang Transit" span={3} locked help={editing ? "dari System Default" : undefined}>
              {transit ? place(transit) : <div className="ro nil">belum diatur di System Default</div>}
            </Field>
          </FormRow>
          <FormRow>
            <Field label="No. Kendaraan" span={3}>
              {editing ? <input className="inp" value={header.vehicle_no} placeholder="B 1234 XY" onChange={(e) => set("vehicle_no", e.target.value)} /> : header.vehicle_no ? ro(header.vehicle_no) : nil()}
            </Field>
            <Field label="Pengemudi" span={3}>
              {editing ? <input className="inp" value={header.driver_name} placeholder="Nama pengemudi" onChange={(e) => set("driver_name", e.target.value)} /> : header.driver_name ? ro(header.driver_name) : nil()}
            </Field>
            <Field label="Catatan" span={6}>
              {editing ? (
                <textarea className="ta" rows={1} value={header.note} placeholder="Catatan pengiriman…" onChange={(e) => set("note", e.target.value)} />
              ) : header.note ? (
                <div className="ro multi">{header.note}</div>
              ) : (
                <div className="ro multi nil">tidak diisi</div>
              )}
            </Field>
          </FormRow>
        </FormSection>
        {transfer?.cancelReason && status === "Cancelled" && (
          <p className="fnote">
            <b>Dibatalkan:</b> {transfer.cancelReason}
          </p>
        )}
        {editing && !options.transit && (
          <p className="fnote">
            <b>Gudang Transit belum diatur.</b> Draft dapat disimpan, tetapi Kirim ditolak sampai System Default › Persediaan menyebut Gudang Transit.
          </p>
        )}
      </FormBody>
    </div>
  );

  const addButton = (cta?: boolean) => (
    <button
      className={`btn sm primary${cta ? " cta" : ""}`}
      onClick={() => {
        setLines((ls) => [...ls, blankLine()]);
        touch("_lines");
      }}
    >
      <Icon name="plus" size={14} /> Tambah Baris
    </button>
  );

  const lotCell = (l: LineState, stored?: StockTransferView["lines"][number]) => {
    const item = l.item_id ? itemById.get(l.item_id) : undefined;
    if (!item) return <span className="dash">—</span>;
    const lineQty = Number(String(l.qty).replace(",", ".")) || 0;
    const picked = l.picks.reduce((s, p) => s + Math.round(Number(p.qty) * 10_000), 0) / 10_000;
    const full = lineQty > 0 && Math.abs(picked - lineQty) < 1e-9;
    if (editing) {
      const why = !header.from_warehouse_id ? "Pilih Gudang Asal dulu…" : lineQty > 0 ? undefined : "Isi Qty dulu";
      return (
        <>
          <button className="btn sm" disabled={Boolean(why)} title={why} onClick={() => setLotsFor(l.key)}>
            <Icon name="layers" size={14} /> {l.picks.length ? `${l.picks.length} lot` : "Pilih Lot"}
          </button>
          <span className={full ? "fulltag" : "overtag"}>{why ? why.toLowerCase() : `${qtyText(picked)} / ${qtyText(lineQty)} ${item.uomLabel}${full ? "" : " · belum penuh"}`}</span>
        </>
      );
    }
    const lots = stored?.pickedLots ?? [];
    if (!lots.length) return <span className="overtag">Belum dipilih</span>;
    return (
      <span className="dstack" style={{ gap: 4 }}>
        {lots.map((p) => (
          <span key={p.id} className="dstack">
            <span className="lab" title={p.lotNo}>
              {p.lotNo}
            </span>
            <span className="d2">
              {qtyText(p.qty)} {item.uomLabel}
              {p.expiry ? ` · ED ${formatDate(p.expiry)}` : ""}
              {p.locationLabel ? ` · ${p.locationLabel}` : ""}
              {p.statusName && p.statusName !== "Tersedia" ? ` · ${p.statusName}` : ""}
              {sent ? ` · diterima ${qtyText(p.receivedQty)}` : ""}
            </span>
          </span>
        ))}
        {!sent && !full && (
          <span className="overtag">
            {qtyText(picked)} dari {qtyText(lineQty)} · belum penuh
          </span>
        )}
      </span>
    );
  };

  const viewLines = transfer?.lines ?? [];
  const linesCard = (
    <div className="card">
      <div className="card-h">
        <span className="ci">
          <Icon name="box" size={15} />
        </span>
        <div className="ct">
          <h3>Barang Dikirim</h3>
          <p>
            {editing
              ? "Pilih barang dan jumlahnya dalam satuan dasar, lalu lot asalnya. Lot dan status stok terbawa sampai gudang tujuan."
              : sent
                ? "Jumlah yang dikirim per lot dan berapa yang sudah diterima gudang tujuan."
                : "Jumlah per barang dalam satuan dasar dan lot yang dipilih."}
          </p>
        </div>
        {editing && lines.length > 0 && addButton()}
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
          <h4>Belum ada barang</h4>
          <p>Hanya Barang dengan Kelola Stok yang dapat ditransfer, per lot.</p>
          {editing && addButton(true)}
        </div>
      ) : (
        <div className="tw">
          <table className="grid ltab" style={{ minWidth: sent ? 900 : 860 }}>
            <thead>
              <tr>
                <th style={{ width: 40 }}>No</th>
                <th>Barang</th>
                <th style={{ width: editing ? 220 : 110 }}>Qty</th>
                <th style={{ width: editing ? 180 : 280 }}>Lot</th>
                {sent && (
                  <th className="num" style={{ width: 120 }}>
                    Diterima
                  </th>
                )}
                {editing && <th style={{ width: 40 }} />}
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => {
                const item = l.item_id ? itemById.get(l.item_id) : undefined;
                const available = lotsOf(l.item_id).reduce((s, x) => s + x.available, 0);
                const typed = Number(String(l.qty).replace(",", ".")) || 0;
                const over = Boolean(item && header.from_warehouse_id && typed > available + 1e-9);
                const lineError = lineErr(l.key, "item_id") ?? lineErr(l.key, "qty") ?? lineErr(l.key, "picks");
                const stored = viewLines[i];
                return (
                  <tr key={l.key} className={lineError || over ? "overrow" : undefined}>
                    <td className="no">{i + 1}</td>
                    <td>
                      {editing ? (
                        <Combobox
                          size="sm"
                          value={l.item_id}
                          options={options.items.filter((o) => (o.active || o.id === l.item_id) && (o.id === l.item_id || !lines.some((x) => x.key !== l.key && x.item_id === o.id)))}
                          placeholder="Pilih Barang…"
                          emptyText="Belum ada Barang dengan Kelola Stok."
                          invalid={Boolean(lineErr(l.key, "item_id"))}
                          onChange={(v) => setLine(l.key, { item_id: v, picks: [] })}
                        />
                      ) : (
                        <span className="idc">
                          <span className="lab">{item?.label}</span>
                          <span className="nm">{item?.name}</span>
                        </span>
                      )}
                      {lineError && <span className="overtag">{lineError}</span>}
                    </td>
                    <td>
                      {editing ? (
                        <>
                          <div className="qcell">
                            <MoneyInput size="sm" decimals={4} value={l.qty} over={over} ariaLabel={`Qty ${item?.label ?? ""}`} onChange={(v) => setLine(l.key, { qty: v })} />
                            <span className="qu">{item?.uomLabel}</span>
                          </div>
                          {item && header.from_warehouse_id && (
                            <span className={over ? "overtag" : "fulltag"}>
                              tersedia {qtyText(available)} {item.uomLabel}
                            </span>
                          )}
                        </>
                      ) : (
                        <span className="qview">
                          <span className="mny">{qtyText(Number(l.qty))}</span>
                          <span className="lab">{item?.uomLabel}</span>
                        </span>
                      )}
                    </td>
                    <td>{lotCell(l, stored)}</td>
                    {sent && (
                      <td className="num">
                        <span className="mny">{qtyText(stored?.receivedQty ?? 0)}</span>
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
      {lotsFor &&
        (() => {
          const l = lines.find((x) => x.key === lotsFor);
          const item = l?.item_id ? itemById.get(l.item_id) : undefined;
          if (!l || !item) return null;
          return (
            <DeliveryNoteLotPicker
              line={{ itemLabel: item.label, itemName: item.name, uomLabel: item.uomLabel }}
              lots={lotsOf(item.id)}
              lineQty={Number(String(l.qty).replace(",", ".")) || 0}
              current={l.picks}
              shipDate={header.transfer_date}
              dateLabel="Tanggal Kirim"
              emptyText="Barang ini tidak punya stok di gudang asal."
              onApply={(picks) => {
                setLine(l.key, { picks });
                touch(`lines.${l.key}.picks`);
                setLotsFor(null);
              }}
              onClose={() => setLotsFor(null)}
            />
          );
        })()}
    </div>
  );

  const receiptsCard = sent && (
    <div className="card">
      <div className="card-h">
        <span className="ci">
          <Icon name="down" size={15} />
        </span>
        <div className="ct">
          <h3>Transfer Terima</h3>
          <p>Penerimaan di gudang tujuan. Yang belum diterima tetap di Gudang Transit.</p>
        </div>
      </div>
      {receipts.length ? (
        <div className="tw">
          <table className="grid">
            <thead>
              <tr>
                <th style={{ width: 170 }}>Nomor</th>
                <th style={{ width: 120 }}>Status</th>
                <th style={{ width: 110 }}>Tanggal</th>
                <th className="num">Qty</th>
              </tr>
            </thead>
            <tbody>
              {receipts.map((r) => (
                <tr key={r.id} onClick={() => router.push(`/inventory/stock-transfer-receipt/${r.id}`)}>
                  <td>
                    <Link className="lab" href={`/inventory/stock-transfer-receipt/${r.id}`}>
                      {r.receiptNo}
                    </Link>
                  </td>
                  <td>
                    <span className={`bdg ${STOCK_TRANSFER_RECEIPT_STATUS_BADGE[r.status]}`}>{STOCK_TRANSFER_RECEIPT_STATUS_TEXT[r.status]}</span>
                  </td>
                  <td>{formatDate(r.receiptDate)}</td>
                  <td className="num">
                    <span className="mny">{qtyText(r.qty)}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="empty sm">
          <h4>Belum ada penerimaan</h4>
          <p>Gudang tujuan menerima barang lewat Transfer Terima.</p>
        </div>
      )}
    </div>
  );

  return (
    <>
      <div className="ph">
        <div className="crumb">
          <span>Persediaan</span>
          <span>/</span>
          <Link href="/inventory/stock-transfer">Transfer Kirim</Link>
          <span>/</span>
          <span className="cur">{transfer ? transfer.transferNo : "Baru"}</span>
        </div>
        <div className="ph-row">
          <h1>
            <span className="ph-ico">
              <Icon name="send" size={16} />
            </span>
            {transfer ? (
              <>
                <span className="docno">{transfer.transferNo}</span>
                <span className={`bdg ${STOCK_TRANSFER_STATUS_BADGE[status]}`}>{STOCK_TRANSFER_STATUS_TEXT[status]}</span>
              </>
            ) : (
              "Transfer Kirim Baru"
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
              <TransferActions
                subject={transfer!.transferNo}
                actions={availableStockTransferActions(status, can)}
                transitions={STOCK_TRANSFER_TRANSITIONS}
                editHref={stockTransferIsEditable(status) && can.edit ? `/inventory/stock-transfer/${transfer!.id}/edit` : null}
                lockText={status === "Cancelled" ? "Transfer dibatalkan" : status === "Received" ? "Transfer diterima" : "Transfer dikirim"}
                run={(a, r) => transitionStockTransferAction(transfer!.id, a, r)}
              />
            )}
          </div>
        </div>
      </div>

      <div className="fgrid solo">
        <div>
          {headerCard}
          <FormTabs
            tabs={[
              { key: "lines", label: "Barang", icon: "box", count: lines.length, bad: tabHasError(errors, "_lines", "lines.", "line."), content: linesCard },
              receiptsCard && { key: "receipts", label: "Transfer Terima", icon: "down", count: receipts.length, content: receiptsCard },
            ]}
          />
        </div>
      </div>
    </>
  );
}
