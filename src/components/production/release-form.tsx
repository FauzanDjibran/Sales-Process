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
import { ReleaseActions } from "@/components/production/release-actions";
import { createReleaseAction, updateReleaseAction } from "@/app/actions/production-release";
import { RELEASE_PURPOSES, RELEASE_STATUS_BADGE, RELEASE_STATUS_TEXT, type ReleaseAbilities, type ReleasePurpose } from "@/lib/erp/production-release-workflow";
import type { ReleaseHeaderInput, ReleaseOptions, ReleaseView } from "@/lib/erp/production-release";
import { formatDate, formatMoney, formatNumber, todayIso } from "@/lib/format";

/**
 * Penerimaan Hasil Produksi or Pemusnahan Produksi in all three modes: `new`,
 * `edit` (Draft only) and `view` (Walet step 6, P170, M118). The user names the
 * workstation the goods leave and the day, then picks lines from what it holds —
 * received goods, any quantity (*Isi semua* takes each bucket whole); a receipt
 * also names the warehouse and, where it keeps locations, each line's place; a
 * scrap says why. No price is typed: the value is what the goods hold, shown once
 * posted. Changing the workstation clears the lines — they are its goods.
 */

export type ReleaseMode = "new" | "edit" | "view";

type LineState = { key: string; bucket_id: number | null; qty: string; location_id: number | null };

let seq = 0;
const newKey = () => `x${Date.now().toString(36)}${seq++}`;
const qtyText = (n: number) => formatNumber(n, n % 1 ? 2 : 0);
const num = (v: string) => Number(String(v).replace(",", ".")) || 0;
const blankLine = (): LineState => ({ key: newKey(), bucket_id: null, qty: "", location_id: null });

export function ReleaseForm({ purpose, mode, doc, options, can }: { purpose: ReleasePurpose; mode: ReleaseMode; doc: ReleaseView | null; options: ReleaseOptions; can: ReleaseAbilities }) {
  const router = useRouter();
  const toast = useToast();
  const def = RELEASE_PURPOSES[purpose];
  const editing = mode !== "view";
  const bucketById = useMemo(() => new Map(options.buckets.map((b) => [b.id, b])), [options.buckets]);

  const [header, setHeader] = useState<ReleaseHeaderInput>(() => (doc ? { ...doc.header } : { purpose, release_date: todayIso(), workstation_id: null, warehouse_id: null, reason: "", note: "" }));
  const [lines, setLines] = useState<LineState[]>(() => (doc ? doc.lines.map((l) => ({ key: newKey(), bucket_id: Number(l.bucket_id), qty: String(l.qty), location_id: l.location_id ?? null })) : []));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  const status = doc?.status ?? "Draft";
  const station = options.workstations.find((w) => w.id === header.workstation_id);
  const warehouse = options.warehouses.find((w) => w.id === header.warehouse_id);
  /** What the station holds, received: the only goods a document takes. */
  const held = useMemo(() => options.buckets.filter((b) => !b.inTransit && b.qty > 0 && b.workstationId === header.workstation_id), [options.buckets, header.workstation_id]);

  const touch = (...names: string[]) => {
    setDirty(true);
    setErrors((e) => {
      const next = { ...e };
      for (const n of names) delete next[n];
      return next;
    });
  };
  const set = <K extends keyof ReleaseHeaderInput>(k: K, v: ReleaseHeaderInput[K]) => {
    setHeader((x) => ({ ...x, [k]: v }));
    touch(k);
  };
  const setLine = (key: string, patch: Partial<LineState>) => {
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
    touch("_lines");
  };
  const pickStation = (id: number | null) => {
    setHeader((x) => ({ ...x, workstation_id: id }));
    if (id !== header.workstation_id) setLines([]);
    touch("workstation_id", "_lines");
  };
  /** Another warehouse clears each line's place: places belong to a warehouse. */
  const pickWarehouse = (id: number | null) => {
    setHeader((x) => ({ ...x, warehouse_id: id }));
    setLines((ls) => ls.map((l) => ({ ...l, location_id: null })));
    touch("warehouse_id", "_lines");
  };
  const fillAll = () => {
    const added: LineState[] = held.filter((b) => !lines.some((l) => l.bucket_id === b.id)).map((b) => ({ key: newKey(), bucket_id: b.id, qty: String(b.qty), location_id: null }));
    setLines([...lines.filter((l) => l.bucket_id), ...added]);
    touch("_lines");
  };

  async function onSave() {
    setSaving(true);
    const sent = lines;
    const payload = sent.map((l) => ({ bucket_id: l.bucket_id, qty: l.qty, location_id: l.location_id }));
    const result = mode === "edit" ? await updateReleaseAction(doc!.id, header, payload) : await createReleaseAction(header, payload);
    setSaving(false);
    if (!result.ok) {
      const mapped: Record<string, string> = {};
      for (const [k, v] of Object.entries(result.errors)) {
        const m = /^lines\.(\d+)\.(\w+)$/.exec(k);
        if (m) mapped[`lines.${sent[Number(m[1])]?.key}.${m[2]}`] = v;
        else mapped[k] = v;
      }
      setErrors(mapped);
      toast(result.errors._form ? "Tidak diizinkan" : "Belum bisa disimpan", result.errors._form ?? result.errors._lines ?? "Periksa kembali isian.", "err");
      return;
    }
    setDirty(false);
    toast(`${def.name} disimpan`, `${result.releaseNo} · Draft`, "ok");
    router.push(`${def.path}/${result.id}`);
  }

  const backHref = doc ? `${def.path}/${doc.id}` : def.path;
  const ro = (node: React.ReactNode) => <div className="ro">{node}</div>;
  const nil = (t = "tidak diisi") => <div className="ro nil">{t}</div>;
  const lineErr = (key: string, f: string) => errors[`lines.${key}.${f}`];
  const place = (p: { label: string; name: string } | undefined) =>
    p
      ? ro(
          <>
            <span className="lab">{p.label}</span>
            <span>{p.name}</span>
          </>
        )
      : nil();
  const bucketOptions = held.map((b) => ({ id: b.id, label: b.itemLabel, name: `lot ${b.lotNo}${b.jobNo ? ` · ${b.jobNo}` : ""}${b.isReject ? " · Reject" : ""} · ${qtyText(b.qty)}`, active: true }));

  const headerCard = (
    <div className="card">
      <FormBody>
        <FormSection title={def.name}>
          <FormRow>
            <Field label="Workstation" span={def.needsWarehouse ? 4 : 6} required={editing} help={editing ? "tempat barang berada sekarang" : undefined} error={errors.workstation_id}>
              {editing ? (
                <Combobox value={header.workstation_id} options={options.workstations.filter((w) => w.active || w.id === header.workstation_id)} placeholder="Pilih Workstation…" invalid={Boolean(errors.workstation_id)} onChange={pickStation} />
              ) : (
                place(station)
              )}
            </Field>
            {def.needsWarehouse && (
              <Field label="Gudang Tujuan" span={4} required={editing} help={editing ? "gudang yang menerima" : undefined} error={errors.warehouse_id}>
                {editing ? (
                  <Combobox value={header.warehouse_id} options={options.warehouses.filter((w) => w.active || w.id === header.warehouse_id)} placeholder="Pilih Gudang…" invalid={Boolean(errors.warehouse_id)} onChange={pickWarehouse} />
                ) : (
                  place(warehouse)
                )}
              </Field>
            )}
            <Field label="Tanggal" span={def.needsWarehouse ? 4 : 6} required={editing} help={editing ? "hari barang keluar dari produksi" : undefined} error={errors.release_date}>
              {editing ? <DateInput value={header.release_date} invalid={Boolean(errors.release_date)} onChange={(v) => set("release_date", v)} /> : ro(formatDate(header.release_date))}
            </Field>
          </FormRow>
          <FormRow>
            {def.needsReason && (
              <Field label="Alasan" span={12} required={editing} help={editing ? "mengapa barang dimusnahkan" : undefined} error={errors.reason}>
                {editing ? (
                  <textarea className={`ta${errors.reason ? " bad" : ""}`} rows={2} value={header.reason} placeholder="Alasan pemusnahan…" onChange={(e) => set("reason", e.target.value)} />
                ) : (
                  <div className="ro multi">{header.reason}</div>
                )}
              </Field>
            )}
            {doc && status === "Posted" && (
              <Field label="Journal" span={6}>
                {doc.journalId ? (
                  ro(
                    <Link className="drl" href={`/accounting/journal/${doc.journalId}`}>
                      <span className="mono">{doc.journalNo}</span>
                    </Link>
                  )
                ) : (
                  nil("tanpa nilai, tanpa journal")
                )}
              </Field>
            )}
            <Field label="Catatan" span={12}>
              {editing ? (
                <textarea className="ta" rows={2} value={header.note} placeholder="Catatan…" onChange={(e) => set("note", e.target.value)} />
              ) : header.note ? (
                <div className="ro multi">{header.note}</div>
              ) : (
                <div className="ro multi nil">tidak diisi</div>
              )}
            </Field>
          </FormRow>
        </FormSection>
        {doc?.cancelReason && status === "Cancelled" && (
          <p className="fnote">
            <b>Dibatalkan:</b> {doc.cancelReason}
          </p>
        )}
      </FormBody>
    </div>
  );

  const addButton = (cta?: boolean) => (
    <button
      className={`btn sm primary${cta ? " cta" : ""}`}
      disabled={!header.workstation_id}
      title={header.workstation_id ? undefined : "Pilih Workstation dulu…"}
      onClick={() => {
        setLines((ls) => [...ls, blankLine()]);
        touch("_lines");
      }}
    >
      <Icon name="plus" size={14} /> Tambah Baris
    </button>
  );
  const posted = status === "Posted";
  const locationOptions = (warehouse?.locations ?? []).filter((l) => l.active).map((l) => ({ id: l.id, label: l.label, name: l.name, active: true }));

  const linesCard = (
    <div className="card" style={{ marginTop: 14 }}>
      <div className="card-h">
        <span className="ci">
          <Icon name="box" size={15} />
        </span>
        <div className="ct">
          <h3>Barang Keluar dari Produksi</h3>
          <p>{editing ? "Pilih barang yang dipegang Workstation, per lot, dan jumlahnya — boleh sebagian. Reject keluar lewat sini juga." : posted ? "Barang dan nilai WIP yang dikeluarkan." : "Barang per lot dan jumlahnya."}</p>
        </div>
        {editing && (
          <button className="btn sm" disabled={!header.workstation_id || held.length === 0} onClick={fillAll}>
            <Icon name="layers" size={14} /> Isi semua barang Workstation
          </button>
        )}
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
          <p>{header.workstation_id ? "Tambahkan baris, atau isi semua barang yang dipegang Workstation." : "Pilih Workstation dulu…"}</p>
          {editing && addButton(true)}
        </div>
      ) : (
        <div className="tw">
          <table className="grid ltab" style={{ minWidth: def.needsWarehouse ? 940 : 760 }}>
            <thead>
              <tr>
                <th style={{ width: 40 }}>No</th>
                <th>Barang</th>
                <th style={{ width: 190 }}>Qty</th>
                {def.needsWarehouse && <th style={{ width: 200 }}>Lokasi</th>}
                {posted && (
                  <th className="num" style={{ width: 150 }}>
                    Nilai
                  </th>
                )}
                {editing && <th style={{ width: 40 }} />}
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => {
                const b = l.bucket_id ? bucketById.get(l.bucket_id) : undefined;
                const stored = doc?.lines[i];
                const e = lineErr(l.key, "bucket_id") ?? lineErr(l.key, "qty") ?? lineErr(l.key, "location_id");
                return (
                  <tr key={l.key} className={e ? "overrow" : undefined}>
                    <td className="no">{i + 1}</td>
                    <td>
                      {editing ? (
                        <Combobox
                          size="sm"
                          value={l.bucket_id}
                          options={bucketOptions}
                          placeholder="Pilih barang…"
                          emptyText="Workstation ini tidak memegang barang yang diterima."
                          invalid={Boolean(lineErr(l.key, "bucket_id"))}
                          onChange={(v) => {
                            const nb = v ? bucketById.get(v) : undefined;
                            setLine(l.key, { bucket_id: v, qty: nb ? String(nb.qty) : "" });
                          }}
                        />
                      ) : (
                        <span className="idc">
                          <span className="lab">{stored?.itemLabel}</span>
                          <span className="nm">
                            lot {stored?.lotNo}
                            {stored?.jobNo ? ` · ${stored.jobNo}` : ""}
                          </span>
                        </span>
                      )}
                      {e && <span className="overtag">{e}</span>}
                    </td>
                    <td>
                      {editing ? (
                        <>
                          <div className="qcell">
                            <MoneyInput size="sm" decimals={6} value={l.qty} ariaLabel={`Qty baris ${i + 1}`} onChange={(v) => setLine(l.key, { qty: v })} />
                          </div>
                          {b && <span className="fulltag">saldo {qtyText(b.qty)}</span>}
                        </>
                      ) : (
                        <span className="qview">
                          <span className="mny">{qtyText(num(l.qty))}</span>
                        </span>
                      )}
                    </td>
                    {def.needsWarehouse && (
                      <td>
                        {!warehouse?.useLocation ? (
                          <span className="dash">—</span>
                        ) : editing ? (
                          <Combobox size="sm" value={l.location_id} options={locationOptions} placeholder="Pilih lokasi…" invalid={Boolean(lineErr(l.key, "location_id"))} onChange={(v) => setLine(l.key, { location_id: v })} />
                        ) : (
                          <span className="mono">{warehouse.locations.find((x) => x.id === l.location_id)?.label ?? "—"}</span>
                        )}
                      </td>
                    )}
                    {posted && (
                      <td className="num">
                        <span className="mny">{formatMoney(stored?.cost ?? 0, "IDR")}</span>
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
                  <td colSpan={def.needsWarehouse ? 4 : 3} style={{ textAlign: "right" }}>
                    Nilai yang keluar dari WIP
                  </td>
                  <td className="num">
                    <span className="mny">{formatMoney(doc?.totalValue ?? 0, "IDR")}</span>
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}
    </div>
  );

  return (
    <>
      <div className="ph">
        <div className="crumb">
          <span>Produksi</span>
          <span>/</span>
          <Link href={def.path}>{def.name}</Link>
          <span>/</span>
          <span className="cur">{doc ? doc.releaseNo : "Baru"}</span>
        </div>
        <div className="ph-row">
          <h1>
            <span className="ph-ico">
              <Icon name={def.icon} size={16} />
            </span>
            {doc ? (
              <>
                <span className="docno">{doc.releaseNo}</span>
                <span className={`bdg ${RELEASE_STATUS_BADGE[status]}`}>{RELEASE_STATUS_TEXT[status]}</span>
              </>
            ) : (
              `${def.name} Baru`
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
              <ReleaseActions purpose={purpose} id={doc!.id} subject={doc!.releaseNo} status={status} can={can} />
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
