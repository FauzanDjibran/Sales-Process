"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { Icon, type IconName } from "@/components/icon";
import { CancelButton } from "@/components/ui/cancel-button";
import { Combobox } from "@/components/ui/combobox";
import { MoneyInput } from "@/components/ui/money-input";
import { formatMoney, formatNumber } from "@/lib/format";
import { PROD_DOC_STATUS_BADGE, PROD_DOC_STATUS_TEXT, type ProdDocStatus } from "@/lib/erp/production-doc-workflow";
import type { BucketOption } from "@/lib/erp/production-doc";

/** What the three documents of work at a Unit draw alike. */

export const money = (n: number) => formatMoney(n, "IDR");
export const qtyText = (n: number) => formatNumber(n, n % 1 ? 2 : 0);
export const ro = (node: ReactNode) => <div className="ro">{node}</div>;
export const idc = (label: string, name: string) => (
  <span className="idc">
    <span className="lab">{label}</span>
    <span className="nm">{name}</span>
  </span>
);

let seq = 0;
export const newKey = () => `r${Date.now().toString(36)}${seq++}`;

/** A picker's options: everything these forms offer is already active. */
export const refs = <T extends { id: number; label: string; name: string }>(rows: T[]) => rows.map((r) => ({ id: r.id, label: r.label, name: r.name, active: true }));

/** Sticky header of a document: its number and status, or the actions that save it. */
export function ExecutionHeader({
  noun,
  path,
  icon,
  no,
  status,
  editing,
  isEdit,
  dirty,
  saving,
  onSave,
  backHref,
  actions,
}: {
  noun: string;
  path: string;
  icon: IconName;
  no: string | null;
  status: ProdDocStatus;
  editing: boolean;
  isEdit: boolean;
  dirty: boolean;
  saving: boolean;
  onSave: () => void;
  backHref: string;
  actions: ReactNode;
}) {
  return (
    <div className="ph">
      <div className="crumb">
        <span>Dokumen</span>
        <span>/</span>
        <Link href={path}>{noun}</Link>
        <span>/</span>
        <span className="cur">{no ?? "Baru"}</span>
      </div>
      <div className="ph-row">
        <h1>
          <span className="ph-ico">
            <Icon name={icon} size={16} />
          </span>
          {no ? (
            <>
              <span className="docno">{no}</span>
              <span className={`bdg ${PROD_DOC_STATUS_BADGE[status]}`}>{PROD_DOC_STATUS_TEXT[status]}</span>
            </>
          ) : (
            `${noun} Baru`
          )}
          {isEdit && <span className="bdg t-warn">Mode Ubah</span>}
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
            actions
          )}
        </div>
      </div>
    </div>
  );
}

export function ErrorBox({ text }: { text?: string }) {
  if (!text) return null;
  return (
    <div className="nbox bad slim">
      <Icon name="warn" size={15} className="ni" />
      <div>
        <b>{text}</b>
      </div>
    </div>
  );
}

export type AuxRow = { key: string; bucket_id: number | null; qty: string; job_id: number | null };

/** Bahan penolong used from the Unit's balance (V8): value, never gram (W19). */
export function AuxCard({
  rows,
  options,
  jobs,
  editing,
  errors,
  values,
  onChange,
}: {
  rows: AuxRow[];
  options: BucketOption[];
  /** The Jobs it may go into; absent on a grading, where it goes to the outputs. */
  jobs?: { id: number; label: string; name: string }[];
  editing: boolean;
  errors: Record<string, string>;
  /** Stored values of a posted document. */
  values?: number[];
  onChange: (rows: AuxRow[]) => void;
}) {
  if (!editing && !rows.length) return null;
  const byId = new Map(options.map((b) => [b.id, b]));
  const free = (r: AuxRow) => options.filter((b) => b.id === r.bucket_id || (b.qty > 0 && !rows.some((x) => x.bucket_id === b.id)));
  const set = (key: string, patch: Partial<AuxRow>) => onChange(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  return (
    <div className="card" style={{ marginTop: 14 }}>
      <div className="card-h">
        <span className="ci">
          <Icon name="box" size={15} />
        </span>
        <div className="ct">
          <h3>Bahan Penolong</h3>
          <p>Diambil dari saldo unit. Menambah nilai, bukan gram.</p>
        </div>
        {editing && (
          <button className="btn sm" disabled={!options.length} title={options.length ? undefined : "Belum ada saldo bahan penolong di unit ini"} onClick={() => onChange([...rows, { key: newKey(), bucket_id: null, qty: "", job_id: null }])}>
            <Icon name="plus" size={14} /> Tambah
          </button>
        )}
      </div>
      {rows.length > 0 && (
        <div className="tw">
          <table className="grid ltab" style={{ minWidth: 640 }}>
            <thead>
              <tr>
                <th>Bahan</th>
                {jobs && <th style={{ width: 210 }}>No. Job</th>}
                <th className="num" style={{ width: 180 }}>
                  Qty
                </th>
                <th className="num" style={{ width: 150 }}>
                  Nilai
                </th>
                {editing && <th style={{ width: 40 }} />}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const b = r.bucket_id ? byId.get(r.bucket_id) : undefined;
                const typed = Number(r.qty) || 0;
                const estimate = b && b.qty > 0 ? (typed >= b.qty ? b.value : Math.round((b.value * typed) / b.qty)) : 0;
                const err = errors[`aux.${i}.bucket_id`] ?? errors[`aux.${i}.qty`];
                return (
                  <tr key={r.key} className={err ? "overrow" : undefined}>
                    <td>
                      {editing ? (
                        <Combobox
                          size="sm"
                          value={r.bucket_id}
                          options={refs(free(r).map((x) => ({ id: x.id, label: x.lotNo, name: x.itemName })))}
                          placeholder="Pilih bahan…"
                          emptyText="Belum ada saldo bahan penolong di unit ini."
                          onChange={(v) => set(r.key, { bucket_id: v })}
                        />
                      ) : b ? (
                        idc(b.itemLabel, b.itemName)
                      ) : null}
                      {err && <span className="overtag">{err}</span>}
                    </td>
                    {jobs && (
                      <td>
                        {editing ? (
                          <Combobox size="sm" value={r.job_id} options={refs(jobs)} placeholder="Semua Job" onChange={(v) => set(r.key, { job_id: v })} />
                        ) : (
                          <span className="mono">{jobs.find((j) => j.id === r.job_id)?.label ?? "Semua Job"}</span>
                        )}
                      </td>
                    )}
                    <td className="num">
                      {editing ? (
                        <div className="qcell">
                          <MoneyInput size="sm" decimals={4} value={r.qty} ariaLabel="Qty bahan penolong" onChange={(v) => set(r.key, { qty: v })} />
                          <span className="qu">{b?.uomLabel}</span>
                        </div>
                      ) : (
                        `${qtyText(Number(r.qty))} ${b?.uomLabel ?? ""}`
                      )}
                      {editing && b && <span className="fulltag">saldo {qtyText(b.qty)}</span>}
                    </td>
                    <td className="num">
                      <span className="mny">{money(values?.[i] ?? estimate)}</span>
                    </td>
                    {editing && (
                      <td>
                        <button className="iact del" title="Hapus baris" onClick={() => onChange(rows.filter((x) => x.key !== r.key))}>
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
}
