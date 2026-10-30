"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icon";
import { CancelButton } from "@/components/ui/cancel-button";
import { Combobox } from "@/components/ui/combobox";
import { DateInput } from "@/components/ui/date-input";
import { DocumentHeader } from "@/components/ui/document-header";
import { Field, FormBody, FormRow, FormSection } from "@/components/ui/form";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { BucketLinesCard, newBucketLine, type BucketLine } from "@/components/production/bucket-lines";
import { ProdDocActions } from "@/components/production/production-doc-actions";
import { createReleaseAction, previewReleaseAction, transitionReleaseAction, updateReleaseAction } from "@/app/actions/production-release";
import { PROD_DOC_STATUS_BADGE, PROD_DOC_STATUS_TEXT, RELEASE_WORKFLOW, type ProdDocAbilities } from "@/lib/erp/production-doc-workflow";
import { RELEASE_PURPOSES, releasePurpose, type ReleasePurposeKey } from "@/lib/erp/production-release-purposes";
import type { ReleaseOptions, ReleaseView } from "@/lib/erp/production-release";
import { formatDate, todayIso } from "@/lib/format";

/**
 * A Production Release in all three modes (R8): goods leave a workstation —
 * into a warehouse (and location) under the same lot, or written off with a
 * reason. The purpose decides the number series, so it is fixed once saved.
 */

const W = RELEASE_WORKFLOW;

export function ReleaseForm({ mode, release, options, can }: { mode: "new" | "edit" | "view"; release: ReleaseView | null; options: ReleaseOptions; can: ProdDocAbilities }) {
  const router = useRouter();
  const toast = useToast();
  const editing = mode !== "view";
  const src = release?.input;
  const [header, setHeader] = useState(() => ({
    purpose: (src?.purpose ?? "to_stock") as ReleasePurposeKey,
    release_date: src?.release_date ?? todayIso(),
    workstation_id: (src?.workstation_id as number | null) ?? null,
    warehouse_id: (src?.warehouse_id as number | null) ?? null,
    location_id: (src?.location_id as number | null) ?? null,
    scrap_reason: src?.scrap_reason ?? "",
    note: src?.note ?? "",
  }));
  const [lines, setLines] = useState<BucketLine[]>(() => (src ? src.lines.map((l) => newBucketLine(Number(l.bucket_id), String(l.qty))) : []));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const status = release?.status ?? "Draft";
  const purpose = releasePurpose(header.purpose)!;

  const touch = (...names: string[]) => {
    setDirty(true);
    setErrors((e) => {
      const next = { ...e };
      for (const n of names) delete next[n];
      return next;
    });
  };
  const set = <K extends keyof typeof header>(k: K, v: (typeof header)[K]) => {
    setHeader((h) => ({ ...h, [k]: v }));
    touch(k);
  };

  async function onSave() {
    setSaving(true);
    const payload = { ...header, lines: lines.map((l) => ({ bucket_id: l.bucket_id, qty: l.qty })) };
    const r = mode === "edit" ? await updateReleaseAction(release!.id, payload) : await createReleaseAction(payload);
    setSaving(false);
    if (!r.ok) {
      const mapped: Record<string, string> = {};
      for (const [k, v] of Object.entries(r.errors)) {
        const m = /^lines\.(\d+)\.(\w+)$/.exec(k);
        mapped[m ? `${lines[Number(m[1])]?.key}.${m[2]}` : k] = v;
      }
      setErrors(mapped);
      toast(r.errors._form ? "Tidak diizinkan" : "Belum bisa disimpan", r.errors._form ?? r.errors._lines ?? "Periksa kembali isian.", "err");
      return;
    }
    setDirty(false);
    toast("Production Release disimpan", `${r.no} · Draft`, "ok");
    router.push(`${W.path}/${r.id}`);
  }

  const ro = (n: React.ReactNode) => <div className="ro">{n}</div>;
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
  const ws = options.workstations.find((w) => w.id === header.workstation_id);
  const wh = options.warehouses.find((w) => w.id === header.warehouse_id);
  const loc = wh?.locations.find((l) => l.id === header.location_id);

  return (
    <>
      <DocumentHeader
        module="Produksi"
        trail={[{ label: "Production Release", href: W.path }]}
        icon="box"
        number={release?.no}
        placeholder="Production Release Baru"
        status={release ? status : null}
        statusLabel={release ? { text: PROD_DOC_STATUS_TEXT[status], tone: PROD_DOC_STATUS_BADGE[status] } : undefined}
        tags={<span className={`bdg ${purpose.toStock ? "t-slate" : "t-warn"}`}>{purpose.short}</span>}
        editing={mode === "edit"}
        dirty={editing && dirty}
      >
        {editing ? (
          <>
            <CancelButton href={release ? `${W.path}/${release.id}` : W.path} dirty={dirty} disabled={saving} />
            <button className="btn primary" onClick={onSave} disabled={saving}>
              <Icon name="save" size={15} /> {saving ? "Menyimpan…" : "Simpan"}
            </button>
          </>
        ) : (
          <ProdDocActions
            workflow={W}
            id={release!.id}
            subject={release!.no}
            status={status}
            can={can}
            run={(a, reason) => transitionReleaseAction(release!.id, a, reason)}
            preview={() => previewReleaseAction(release!.id)}
          />
        )}
      </DocumentHeader>

      <div className="fgrid solo">
        <div>
          <div className="card">
            <FormBody>
              <FormSection title="Keluar Produksi">
                <FormRow>
                  <Field label="Tujuan" span={4} required={mode === "new"} locked={mode === "edit"} help={mode === "new" ? "menentukan nomor dan journalnya" : undefined}>
                    {mode === "new" ? (
                      <Select
                        value={header.purpose}
                        options={RELEASE_PURPOSES.map((p) => ({ value: p.key, label: p.name }))}
                        onChange={(v) => {
                          setHeader((h) => ({ ...h, purpose: v as ReleasePurposeKey, warehouse_id: null, location_id: null }));
                          touch("purpose", "warehouse_id", "scrap_reason");
                        }}
                      />
                    ) : (
                      ro(purpose.name)
                    )}
                  </Field>
                  <Field label="Tanggal" span={3} required={editing} error={errors.release_date}>
                    {editing ? <DateInput value={header.release_date} invalid={Boolean(errors.release_date)} onChange={(v) => set("release_date", v)} /> : ro(formatDate(header.release_date))}
                  </Field>
                  {status === "Posted" && (
                    <Field label="Journal" span={5}>
                      {release?.journalId
                        ? ro(
                            <Link className="drl" href={`/accounting/journal/${release.journalId}`}>
                              <span className="mono">{release.journalNo}</span>
                            </Link>
                          )
                        : nil("tanpa nilai, tanpa journal")}
                    </Field>
                  )}
                </FormRow>
                <FormRow>
                  <Field label="Workstation" span={purpose.toStock ? 4 : 6} required={editing} help={editing ? "tempat barang berada" : undefined} error={errors.workstation_id}>
                    {editing ? (
                      <Combobox
                        value={header.workstation_id}
                        options={options.workstations.filter((w) => w.active || w.id === header.workstation_id)}
                        placeholder="Pilih Workstation…"
                        emptyText="Belum ada Workstation yang aktif."
                        invalid={Boolean(errors.workstation_id)}
                        onChange={(v) => {
                          setHeader((h) => ({ ...h, workstation_id: v }));
                          if (v !== header.workstation_id) setLines([]);
                          touch("workstation_id", "_lines");
                        }}
                      />
                    ) : (
                      place(ws)
                    )}
                  </Field>
                  {purpose.toStock ? (
                    <>
                      <Field label="Gudang" span={4} required={editing} help={editing ? "lot masuk ke sini" : undefined} error={errors.warehouse_id}>
                        {editing ? (
                          <Combobox
                            value={header.warehouse_id}
                            options={options.warehouses.filter((w) => w.active || w.id === header.warehouse_id)}
                            placeholder="Pilih Gudang…"
                            invalid={Boolean(errors.warehouse_id)}
                            onChange={(v) => {
                              setHeader((h) => ({ ...h, warehouse_id: v, location_id: null }));
                              touch("warehouse_id", "location_id");
                            }}
                          />
                        ) : (
                          place(wh)
                        )}
                      </Field>
                      <Field label="Lokasi" span={4} required={editing && Boolean(wh?.locations.length)} error={errors.location_id}>
                        {editing ? (
                          wh?.locations.length ? (
                            <Combobox value={header.location_id} options={wh.locations.filter((l) => l.active || l.id === header.location_id)} placeholder="Pilih Lokasi…" invalid={Boolean(errors.location_id)} onChange={(v) => set("location_id", v)} />
                          ) : (
                            nil(wh ? "gudang tanpa lokasi" : "Pilih Gudang dulu…")
                          )
                        ) : (
                          place(loc) ?? nil("—")
                        )}
                      </Field>
                    </>
                  ) : (
                    <Field label="Alasan Pemusnahan" span={6} required={editing} error={errors.scrap_reason}>
                      {editing ? (
                        <input className={`inp${errors.scrap_reason ? " bad" : ""}`} value={header.scrap_reason} placeholder="mis. rusak, terkontaminasi" onChange={(e) => set("scrap_reason", e.target.value)} />
                      ) : (
                        ro(header.scrap_reason)
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
              {release?.cancelReason && status === "Cancelled" && (
                <p className="fnote">
                  <b>Dibatalkan:</b> {release.cancelReason}
                </p>
              )}
            </FormBody>
          </div>
          <BucketLinesCard
            title={purpose.toStock ? "Barang ke Gudang" : "Barang Dimusnahkan"}
            desc={purpose.desc}
            icon="box"
            editing={editing}
            lines={lines}
            buckets={options.buckets.filter((b) => b.workstationId === header.workstation_id || lines.some((l) => l.bucket_id === b.id))}
            waitingFor={header.workstation_id ? null : "Pilih Workstation dulu…"}
            posted={status === "Posted" ? release?.lineValues : undefined}
            errors={{ ...errors, _self: errors._lines ?? "" }}
            valueLabel={status === "Posted" ? "Nilai" : "Perkiraan Nilai"}
            onChange={(ls) => {
              setLines(ls);
              touch("_lines");
            }}
          />
        </div>
      </div>
    </>
  );
}
