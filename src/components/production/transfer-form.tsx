"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icon";
import { CancelButton } from "@/components/ui/cancel-button";
import { Combobox } from "@/components/ui/combobox";
import { DateInput } from "@/components/ui/date-input";
import { DocumentHeader } from "@/components/ui/document-header";
import { Field, FormBody, FormRow, FormSection } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import { BucketLinesCard, newBucketLine, type BucketLine } from "@/components/production/bucket-lines";
import { ProdDocActions } from "@/components/production/production-doc-actions";
import { createTransferAction, transitionTransferAction, updateTransferAction } from "@/app/actions/production-transfer";
import { PROD_DOC_STATUS_BADGE, PROD_DOC_STATUS_TEXT, TRANSFER_WORKFLOW, type ProdDocAbilities } from "@/lib/erp/production-doc-workflow";
import type { TransferOptions, TransferView } from "@/lib/erp/production-transfer";
import { formatDate, todayIso } from "@/lib/format";

/**
 * A Production Transfer in all three modes (R7): from one workstation to
 * another, the lots held at the first and how much of each. Posting moves them
 * directly at the value they carry; no journal.
 */

const W = TRANSFER_WORKFLOW;

export function TransferForm({ mode, transfer, options, can }: { mode: "new" | "edit" | "view"; transfer: TransferView | null; options: TransferOptions; can: ProdDocAbilities }) {
  const router = useRouter();
  const toast = useToast();
  const editing = mode !== "view";
  const src = transfer?.input;
  const [header, setHeader] = useState(() => ({
    transfer_date: src?.transfer_date ?? todayIso(),
    from_workstation_id: (src?.from_workstation_id as number | null) ?? null,
    to_workstation_id: (src?.to_workstation_id as number | null) ?? null,
    note: src?.note ?? "",
  }));
  const [lines, setLines] = useState<BucketLine[]>(() => (src ? src.lines.map((l) => newBucketLine(Number(l.bucket_id), String(l.qty))) : []));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const status = transfer?.status ?? "Draft";

  const touch = (...names: string[]) => {
    setDirty(true);
    setErrors((e) => {
      const next = { ...e };
      for (const n of names) delete next[n];
      return next;
    });
  };

  async function onSave() {
    setSaving(true);
    const payload = { ...header, lines: lines.map((l) => ({ bucket_id: l.bucket_id, qty: l.qty })) };
    const r = mode === "edit" ? await updateTransferAction(transfer!.id, payload) : await createTransferAction(payload);
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
    toast("Production Transfer disimpan", `${r.no} · Draft`, "ok");
    router.push(`${W.path}/${r.id}`);
  }

  const ro = (n: React.ReactNode) => <div className="ro">{n}</div>;
  const station = (field: "from_workstation_id" | "to_workstation_id", label: string, help: string) => {
    const ws = options.workstations.find((w) => w.id === header[field]);
    return (
      <Field label={label} span={4} required={editing} help={editing ? help : undefined} error={errors[field]}>
        {editing ? (
          <Combobox
            value={header[field]}
            options={options.workstations.filter((w) => w.active || w.id === header[field])}
            placeholder="Pilih Workstation…"
            emptyText="Belum ada Workstation yang aktif."
            invalid={Boolean(errors[field])}
            onChange={(v) => {
              setHeader((h) => ({ ...h, [field]: v }));
              // The lines are lots at the origin: another origin clears them.
              if (field === "from_workstation_id" && v !== header.from_workstation_id) setLines([]);
              touch(field, "_lines");
            }}
          />
        ) : ws ? (
          ro(
            <>
              <span className="lab">{ws.label}</span>
              <span>{ws.name}</span>
            </>
          )
        ) : (
          <div className="ro nil">tidak diisi</div>
        )}
      </Field>
    );
  };

  return (
    <>
      <DocumentHeader
        module="Produksi"
        trail={[{ label: "Production Transfer", href: W.path }]}
        icon="truck"
        number={transfer?.no}
        placeholder="Production Transfer Baru"
        status={transfer ? status : null}
        statusLabel={transfer ? { text: PROD_DOC_STATUS_TEXT[status], tone: PROD_DOC_STATUS_BADGE[status] } : undefined}
        editing={mode === "edit"}
        dirty={editing && dirty}
      >
        {editing ? (
          <>
            <CancelButton href={transfer ? `${W.path}/${transfer.id}` : W.path} dirty={dirty} disabled={saving} />
            <button className="btn primary" onClick={onSave} disabled={saving}>
              <Icon name="save" size={15} /> {saving ? "Menyimpan…" : "Simpan"}
            </button>
          </>
        ) : (
          <ProdDocActions workflow={W} id={transfer!.id} subject={transfer!.no} status={status} can={can} run={(a, reason) => transitionTransferAction(transfer!.id, a, reason)} />
        )}
      </DocumentHeader>

      <div className="fgrid solo">
        <div>
          <div className="card">
            <FormBody>
              <FormSection title="Perpindahan">
                <FormRow>
                  <Field label="Tanggal" span={4} required={editing} error={errors.transfer_date}>
                    {editing ? (
                      <DateInput
                        value={header.transfer_date}
                        invalid={Boolean(errors.transfer_date)}
                        onChange={(v) => {
                          setHeader((h) => ({ ...h, transfer_date: v }));
                          touch("transfer_date");
                        }}
                      />
                    ) : (
                      ro(formatDate(header.transfer_date))
                    )}
                  </Field>
                  {station("from_workstation_id", "Dari Workstation", "tempat lot berada sekarang")}
                  {station("to_workstation_id", "Ke Workstation", "tujuan lot")}
                  <Field label="Catatan" span={12}>
                    {editing ? (
                      <textarea
                        className="ta"
                        rows={2}
                        value={header.note}
                        placeholder="Catatan perpindahan…"
                        onChange={(e) => {
                          setHeader((h) => ({ ...h, note: e.target.value }));
                          touch("note");
                        }}
                      />
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
            </FormBody>
          </div>
          <BucketLinesCard
            title="Lot Dipindahkan"
            desc="Lot yang ada di Workstation asal dan jumlah yang dipindahkan. Nilainya ikut pindah; tetap di WIP."
            icon="truck"
            editing={editing}
            lines={lines}
            buckets={options.buckets.filter((b) => b.workstationId === header.from_workstation_id || lines.some((l) => l.bucket_id === b.id))}
            waitingFor={header.from_workstation_id ? null : "Pilih Workstation asal dulu…"}
            posted={status === "Posted" ? transfer?.lineValues : undefined}
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
