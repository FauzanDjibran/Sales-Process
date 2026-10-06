"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icon";
import { CancelButton } from "@/components/ui/cancel-button";
import { Combobox } from "@/components/ui/combobox";
import { DateInput } from "@/components/ui/date-input";
import { Field, FormBody, FormRow, FormSection } from "@/components/ui/form";
import { MoneyInput } from "@/components/ui/money-input";
import { useToast } from "@/components/ui/toast";
import { PurchaseRequestActions } from "@/components/purchasing/purchase-request-actions";
import { createPurchaseRequestAction, updatePurchaseRequestAction } from "@/app/actions/purchase-request";
import {
  PURCHASE_REQUEST_KINDS,
  PURCHASE_REQUEST_REASON_TEXT,
  PURCHASE_REQUEST_STATUS_BADGE,
  PURCHASE_REQUEST_STATUS_TEXT,
  type PurchaseRequestAbilities,
  type PurchaseRequestKind,
} from "@/lib/erp/purchase-request-workflow";
import type { PurchaseRequestHeaderInput, PurchaseRequestOptions, PurchaseRequestView } from "@/lib/erp/purchase-request";
import { formatDate, formatNumber, todayIso } from "@/lib/format";

/**
 * A Purchase Request in all three modes: `new`, `edit` (Draft only) and `view`
 * (P123). The header says when it is asked, by whom, by when it is needed
 * and — for Barang — where; each line is an item in its base unit with its own
 * Tanggal Dibutuhkan, which starts on the header's.
 */

type LineState = { key: string; item_id: number | null; qty: string; needed_date: string; note: string };

let seq = 0;
const newKey = () => `l${Date.now().toString(36)}${seq++}`;
const qtyText = (n: number) => formatNumber(n, n % 1 ? 2 : 0);
const UNIT = 10_000;
const units = (v: number | string) => Math.round((Number(String(v).replace(",", ".")) || 0) * UNIT);

export function PurchaseRequestForm({
  kind,
  mode,
  request,
  options,
  can,
}: {
  kind: PurchaseRequestKind;
  mode: "new" | "edit" | "view";
  request: PurchaseRequestView | null;
  options: PurchaseRequestOptions;
  can: PurchaseRequestAbilities;
}) {
  const router = useRouter();
  const toast = useToast();
  const k = PURCHASE_REQUEST_KINDS[kind];
  const goods = kind === "goods";
  const noun = goods ? "barang" : "jasa";
  const editing = mode !== "view";
  const today = todayIso();

  const [header, setHeader] = useState<PurchaseRequestHeaderInput>(() =>
    request
      ? { ...request.header }
      : { item_type: k.itemType, request_date: today, needed_date: today, requester: "", warehouse_id: null, note: "" }
  );
  const [lines, setLines] = useState<LineState[]>(() =>
    request
      ? request.lines.map((l) => ({ key: newKey(), item_id: Number(l.item_id), qty: String(l.qty), needed_date: l.needed_date, note: l.note }))
      : [{ key: newKey(), item_id: null, qty: "", needed_date: today, note: "" }]
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  const itemById = new Map(options.items.map((i) => [i.id, i]));
  const status = request?.status ?? "Draft";
  const open = status === "Open" || status === "Closed";
  const touch = (...names: string[]) => {
    setDirty(true);
    setErrors((e) => {
      const next = { ...e };
      for (const n of names) delete next[n];
      return next;
    });
  };
  const set = <K extends keyof PurchaseRequestHeaderInput>(key: K, v: PurchaseRequestHeaderInput[K]) => {
    setHeader((h) => ({ ...h, [key]: v }));
    touch(key);
  };
  /** A new default date carries to the lines that still had the old one. */
  const setNeeded = (v: string) => {
    const before = header.needed_date;
    setHeader((h) => ({ ...h, needed_date: v }));
    setLines((ls) => ls.map((l) => (l.needed_date === before ? { ...l, needed_date: v } : l)));
    touch("needed_date");
  };
  const setLine = (key: string, patch: Partial<LineState>) => {
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
    touch("_lines");
  };

  async function onSave() {
    setSaving(true);
    const payload = lines.map((l) => ({ item_id: l.item_id, qty: l.qty, needed_date: l.needed_date, note: l.note }));
    const result = mode === "edit" ? await updatePurchaseRequestAction(request!.id, header, payload) : await createPurchaseRequestAction(header, payload);
    setSaving(false);
    if (!result.ok) {
      const mapped: Record<string, string> = {};
      for (const [key, v] of Object.entries(result.errors)) {
        const m = /^lines\.(\d+)\.(\w+)$/.exec(key);
        if (m) mapped[`lines.${lines[Number(m[1])]?.key}.${m[2]}`] = v;
        else mapped[key] = v;
      }
      setErrors(mapped);
      toast(result.errors._form ? "Tidak diizinkan" : "Belum bisa disimpan", result.errors._form ?? result.errors._lines ?? "Periksa kembali isian.", "err");
      return;
    }
    setDirty(false);
    toast("Purchase Request disimpan", `${result.requestNo} · Draft`, "ok");
    router.push(`${k.path}/${result.id}`);
  }

  const ro = (node: React.ReactNode) => <div className="ro">{node}</div>;
  const nil = (t = "tidak diisi") => <div className="ro nil">{t}</div>;
  const lineErr = (key: string, f: string) => errors[`lines.${key}.${f}`];
  const warehouse = header.warehouse_id ? options.warehouses.find((w) => w.id === header.warehouse_id) : null;

  // ======================================================== header card
  const headerCard = (
    <div className="card">
      <FormBody>
        <FormSection title="Permintaan">
          <FormRow>
            <Field label="Tanggal" span={3} required={editing} error={errors.request_date}>
              {editing ? <DateInput value={header.request_date} invalid={Boolean(errors.request_date)} onChange={(v) => set("request_date", v)} /> : ro(formatDate(header.request_date))}
            </Field>
            <Field label="Dibutuhkan" span={3} required={editing} help={editing ? "awal tanggal tiap baris" : undefined} error={errors.needed_date}>
              {editing ? <DateInput value={header.needed_date} invalid={Boolean(errors.needed_date)} onChange={setNeeded} /> : ro(formatDate(header.needed_date))}
            </Field>
            <Field label="Peminta" span={goods ? 3 : 6}>
              {editing ? (
                <input className="inp" value={header.requester} placeholder="Nama peminta atau bagian" onChange={(e) => set("requester", e.target.value)} />
              ) : header.requester ? (
                ro(header.requester)
              ) : (
                nil()
              )}
            </Field>
            {goods && (
              <Field label="Gudang Tujuan" span={3} help={editing ? "opsional" : undefined} error={errors.warehouse_id}>
                {editing ? (
                  <Combobox
                    value={header.warehouse_id}
                    options={options.warehouses}
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
            )}
            <Field label="Catatan" span={12}>
              {editing ? (
                <textarea className="ta" rows={2} value={header.note} placeholder="Keperluan atau keterangan…" onChange={(e) => set("note", e.target.value)} />
              ) : header.note ? (
                <div className="ro multi">{header.note}</div>
              ) : (
                <div className="ro multi nil">tidak diisi</div>
              )}
            </Field>
          </FormRow>
        </FormSection>
        {request?.statusReason && PURCHASE_REQUEST_REASON_TEXT[status] && (
          <p className="fnote">
            <b>{PURCHASE_REQUEST_REASON_TEXT[status]}:</b> {request.statusReason}
          </p>
        )}
      </FormBody>
    </div>
  );

  // ======================================================== lines card
  const addLine = () => {
    setLines((ls) => [...ls, { key: newKey(), item_id: null, qty: "", needed_date: header.needed_date, note: "" }]);
    touch("_lines");
  };
  const viewLines = request?.lines ?? [];
  const linesCard = (
    <div className="card" style={{ marginTop: 14 }}>
      <div className="card-h">
        <span className="ci">
          <Icon name={goods ? "box" : "tags"} size={15} />
        </span>
        <div className="ct">
          <h3>{goods ? "Barang Diminta" : "Jasa Diminta"}</h3>
          <p>
            Jumlah dalam satuan dasar {noun}
            {open ? "; Dipesan adalah yang sudah diambil Purchase Order." : ", dan kapan dibutuhkan."}
          </p>
        </div>
        {editing && (
          <button className="btn sm primary" onClick={addLine}>
            <Icon name="plus" size={14} /> Tambah {goods ? "Barang" : "Jasa"}
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
      <div className="tw">
        <table className="grid ltab" style={{ minWidth: 820 }}>
          <thead>
            <tr>
              <th style={{ width: 40 }}>No</th>
              <th>{goods ? "Barang" : "Jasa"}</th>
              <th style={{ width: editing ? 200 : 130 }}>Qty</th>
              <th style={{ width: editing ? 170 : 120 }}>Dibutuhkan</th>
              {open && <th className="num" style={{ width: 120 }}>Dipesan</th>}
              {!editing && <th>Catatan</th>}
              {editing && <th style={{ width: 40 }} />}
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => {
              const item = l.item_id ? itemById.get(l.item_id) : undefined;
              const lineError = lineErr(l.key, "item_id") ?? lineErr(l.key, "qty") ?? lineErr(l.key, "needed_date");
              const stored = viewLines[i];
              return (
                <tr key={l.key} className={lineError ? "overrow" : undefined}>
                  <td className="no">{i + 1}</td>
                  <td>
                    {editing ? (
                      <Combobox
                        size="sm"
                        value={l.item_id}
                        options={options.items}
                        placeholder={`Pilih ${goods ? "Barang" : "Jasa"}…`}
                        emptyText={`Belum ada ${noun} dengan Dapat Dibeli.`}
                        invalid={Boolean(lineErr(l.key, "item_id"))}
                        onChange={(v) => setLine(l.key, { item_id: v })}
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
                      <div className="qcell">
                        <MoneyInput size="sm" decimals={4} value={l.qty} ariaLabel={`Qty ${item?.label ?? ""}`} onChange={(v) => setLine(l.key, { qty: v })} />
                        <span className="qu">{item?.uomLabel}</span>
                      </div>
                    ) : (
                      <span className="qview">
                        <span className="mny">{qtyText(Number(l.qty))}</span>
                        <span className="lab">{item?.uomLabel}</span>
                      </span>
                    )}
                  </td>
                  <td>{editing ? <DateInput value={l.needed_date} onChange={(v) => setLine(l.key, { needed_date: v })} /> : formatDate(l.needed_date)}</td>
                  {open && (
                    <td className="num">
                      <span className={`mny${stored && units(stored.ordered) >= units(stored.qty) ? " in" : ""}`}>{qtyText(stored?.ordered ?? 0)}</span>
                    </td>
                  )}
                  {!editing && <td className="mut">{l.note || <span className="dash">—</span>}</td>}
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
            {lines.length === 0 && (
              <tr>
                <td colSpan={6} className="mut" style={{ textAlign: "center" }}>
                  Belum ada {noun}. Tambahkan dengan tombol di atas.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );

  // ============================================================== page
  const backHref = request ? `${k.path}/${request.id}` : k.path;
  return (
    <>
      <div className="ph">
        <div className="crumb">
          <span>Pembelian</span>
          <span>/</span>
          <Link href={k.path}>{k.name}</Link>
          <span>/</span>
          <span className="cur">{request ? request.requestNo : "Baru"}</span>
        </div>
        <div className="ph-row">
          <h1>
            <span className="ph-ico">
              <Icon name={goods ? "box" : "tags"} size={16} />
            </span>
            {request ? (
              <>
                <span className="docno">{request.requestNo}</span>
                <span className={`bdg ${PURCHASE_REQUEST_STATUS_BADGE[status]}`}>{PURCHASE_REQUEST_STATUS_TEXT[status]}</span>
              </>
            ) : (
              `${k.name} Baru`
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
              <PurchaseRequestActions id={request!.id} basePath={k.path} subject={request!.requestNo} status={status} can={can} />
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
