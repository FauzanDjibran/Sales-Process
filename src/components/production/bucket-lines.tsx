"use client";

import { Icon } from "@/components/icon";
import { Combobox } from "@/components/ui/combobox";
import { MoneyInput } from "@/components/ui/money-input";
import type { BucketOption } from "@/lib/erp/production-doc";
import { formatMoney, formatNumber } from "@/lib/format";

/** One line taken from a production bucket: a lot at a workstation and a quantity of it. */
export type BucketLine = { key: string; bucket_id: number | null; qty: string };

let seq = 0;
export const newBucketLine = (bucketId: number | null = null, qty = ""): BucketLine => ({ key: `b${Date.now().toString(36)}${seq++}`, bucket_id: bucketId, qty });

const qtyText = (n: number) => formatNumber(n, n % 1 ? 2 : 0);
const money = (n: number) => formatMoney(n, "IDR");
const num = (v: string) => Number(String(v).replace(",", ".")) || 0;

/** What taking `qty` of a bucket would release now: round(V × q ÷ Q), V whole when it empties. */
export function bucketReleaseEstimate(b: BucketOption | undefined, qty: number): number {
  if (!b || !(qty > 0) || !(b.qty > 0)) return 0;
  return qty >= b.qty ? b.value : Math.round((b.value * qty) / b.qty);
}

/**
 * The lines a production document takes from buckets (R5, R7, R8): each a lot
 * held at the document's workstation and a quantity of it, in the item's base
 * unit, each lot once. While editing a line shows what is held and the value
 * it would release now; once posted, the value it released.
 */
export function BucketLinesCard({
  title,
  desc,
  icon,
  editing,
  lines,
  buckets,
  waitingFor,
  posted,
  errors,
  valueLabel,
  onChange,
}: {
  title: string;
  desc: string;
  icon: "layers" | "box" | "truck";
  editing: boolean;
  lines: BucketLine[];
  /** The buckets offered — held at the workstation, plus any a stored line names. */
  buckets: BucketOption[];
  /** Why nothing can be picked yet, e.g. `Pilih Workstation dulu…`. */
  waitingFor?: string | null;
  /** Per line, once posted: the value it released. */
  posted?: (number | null)[];
  errors: Record<string, string>;
  valueLabel: string;
  onChange: (lines: BucketLine[]) => void;
}) {
  const byId = new Map(buckets.map((b) => [b.id, b]));
  const set = (key: string, patch: Partial<BucketLine>) => onChange(lines.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const err = (key: string, f: string) => errors[`${key}.${f}`];
  const add = (cta?: boolean) => (
    <button className={`btn sm primary${cta ? " cta" : ""}`} disabled={Boolean(waitingFor)} title={waitingFor ?? undefined} onClick={() => onChange([...lines, newBucketLine()])}>
      <Icon name="plus" size={14} /> Tambah Lot
    </button>
  );
  const total = lines.reduce((a, l, i) => a + (posted ? (posted[i] ?? 0) : bucketReleaseEstimate(byId.get(l.bucket_id ?? 0), num(l.qty))), 0);

  return (
    <div className="card" style={{ marginTop: 14 }}>
      <div className="card-h">
        <span className="ci">
          <Icon name={icon} size={15} />
        </span>
        <div className="ct">
          <h3>{title}</h3>
          <p>{desc}</p>
        </div>
        {editing && lines.length > 0 && add()}
      </div>
      {errors._self && (
        <div className="nbox bad slim">
          <Icon name="warn" size={15} className="ni" />
          <div>
            <b>{errors._self}</b>
          </div>
        </div>
      )}
      {lines.length === 0 ? (
        <div className="empty sm">
          <div className="ic">
            <Icon name={icon} size={18} />
          </div>
          <h4>Belum ada lot</h4>
          <p>{waitingFor ?? "Pilih lot yang ada di Workstation dan jumlahnya."}</p>
          {editing && add(true)}
        </div>
      ) : (
        <div className="tw">
          <table className="grid ltab" style={{ minWidth: 820 }}>
            <thead>
              <tr>
                <th style={{ width: 40 }}>No</th>
                <th>Lot · Barang</th>
                <th style={{ width: editing ? 220 : 130 }}>Qty</th>
                <th className="num" style={{ width: 160 }}>
                  {valueLabel}
                </th>
                {editing && <th style={{ width: 40 }} />}
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => {
                const b = l.bucket_id ? byId.get(l.bucket_id) : undefined;
                const q = num(l.qty);
                const over = Boolean(editing && b && q > b.qty + 1e-9);
                const e = err(l.key, "bucket_id") ?? err(l.key, "qty");
                const value = posted ? (posted[i] ?? 0) : bucketReleaseEstimate(b, Math.min(q, b?.qty ?? 0));
                return (
                  <tr key={l.key} className={e || over ? "overrow" : undefined}>
                    <td className="no">{i + 1}</td>
                    <td>
                      {editing ? (
                        <Combobox
                          size="sm"
                          value={l.bucket_id}
                          options={buckets
                            .filter((o) => o.id === l.bucket_id || (o.qty > 0 && !lines.some((x) => x.key !== l.key && x.bucket_id === o.id)))
                            .map((o) => ({ id: o.id, label: o.lotNo, name: `${o.itemLabel} · ${o.itemName}`, active: true }))}
                          placeholder="Pilih Lot…"
                          waitingFor={waitingFor}
                          emptyText="Tidak ada barang di Workstation ini."
                          invalid={Boolean(err(l.key, "bucket_id"))}
                          onChange={(v) => set(l.key, { bucket_id: v })}
                        />
                      ) : (
                        <span className="idc">
                          <span className="lab">{b?.lotNo}</span>
                          <span className="nm">
                            {b?.itemLabel} · {b?.itemName}
                          </span>
                        </span>
                      )}
                      {e && <span className="overtag">{e}</span>}
                    </td>
                    <td>
                      {editing ? (
                        <>
                          <div className="qcell">
                            <MoneyInput size="sm" decimals={4} value={l.qty} over={over} ariaLabel={`Qty ${b?.lotNo ?? ""}`} onChange={(v) => set(l.key, { qty: v })} />
                            <span className="qu">{b?.uomLabel}</span>
                          </div>
                          {b && (
                            <span className={over ? "overtag" : "fulltag"}>
                              tersedia {qtyText(b.qty)} {b.uomLabel}
                            </span>
                          )}
                        </>
                      ) : (
                        <span className="qview">
                          <span className="mny">{qtyText(q)}</span>
                          <span className="lab">{b?.uomLabel}</span>
                        </span>
                      )}
                    </td>
                    <td className="num">{b ? <span className="mny">{money(value)}</span> : <span className="dash">—</span>}</td>
                    {editing && (
                      <td>
                        <button className="iact del" title="Hapus baris" onClick={() => onChange(lines.filter((x) => x.key !== l.key))}>
                          <Icon name="trash" size={14} />
                        </button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="totrow">
                <td colSpan={3} style={{ textAlign: "right" }}>
                  {posted ? "Total" : "Perkiraan total"}
                </td>
                <td className="num">
                  <span className="mny">{money(total)}</span>
                </td>
                {editing && <td />}
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
