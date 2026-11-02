"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icon";
import { CancelButton } from "@/components/ui/cancel-button";
import { Combobox } from "@/components/ui/combobox";
import { DateInput } from "@/components/ui/date-input";
import { DocumentHeader } from "@/components/ui/document-header";
import { Field, FormBody, FormRow, FormSection } from "@/components/ui/form";
import { MoneyInput } from "@/components/ui/money-input";
import { useToast } from "@/components/ui/toast";
import { BucketLinesCard, bucketReleaseEstimate, newBucketLine, type BucketLine } from "@/components/production/bucket-lines";
import { ProdDocActions } from "@/components/production/production-doc-actions";
import { createExecutionAction, previewExecutionAction, transitionExecutionAction, updateExecutionAction } from "@/app/actions/production-run";
import { EXECUTION_WORKFLOW, PROD_DOC_STATUS_BADGE, PROD_DOC_STATUS_TEXT, type ProdDocAbilities } from "@/lib/erp/production-doc-workflow";
import { outputWeight, shareByWeight } from "@/lib/erp/production-execution";
import type { ExecutionOptions, ExecutionView } from "@/lib/erp/production-run";
import { formatDate, formatMoney, formatNumber, todayIso } from "@/lib/format";

/**
 * An Eksekusi Produksi in all three modes (R5, R6, R11, R17). The header
 * names the workstation, the day and the Driver; the inputs are lots held at
 * that workstation; the outputs are new lots, each an item, a quantity and an
 * optional lot number (else `<number>-<n>` at posting). The value column
 * previews Σ input value shared by qty × Bobot Nilai, exactly as posting
 * shares it; once posted it shows what each received.
 */

type OutputLine = { key: string; item_id: number | null; tracking_no: string; expiry_date: string; qty: string };

let seq = 0;
const newOutput = (): OutputLine => ({ key: `o${Date.now().toString(36)}${seq++}`, item_id: null, tracking_no: "", expiry_date: "", qty: "" });
const num = (v: string) => Number(String(v).replace(",", ".")) || 0;
const money = (n: number) => formatMoney(n, "IDR");
const qtyText = (n: number) => formatNumber(n, n % 1 ? 2 : 0);
const W = EXECUTION_WORKFLOW;

export function ExecutionForm({
  mode,
  execution,
  options,
  can,
}: {
  mode: "new" | "edit" | "view";
  execution: ExecutionView | null;
  options: ExecutionOptions;
  can: ProdDocAbilities;
}) {
  const router = useRouter();
  const toast = useToast();
  const editing = mode !== "view";
  const posted = execution?.status === "Posted";
  const itemById = useMemo(() => new Map(options.items.map((i) => [i.id, i])), [options.items]);
  const bucketById = useMemo(() => new Map(options.buckets.map((b) => [b.id, b])), [options.buckets]);

  const src = execution?.input;
  const [header, setHeader] = useState(() => ({
    execution_date: src?.execution_date ?? todayIso(),
    workstation_id: (src?.workstation_id as number | null) ?? null,
    driver: src ? String(src.driver) : "",
    note: src?.note ?? "",
  }));
  const [inputs, setInputs] = useState<BucketLine[]>(() => (src ? src.inputs.map((l) => newBucketLine(Number(l.bucket_id), String(l.qty))) : []));
  const [outputs, setOutputs] = useState<OutputLine[]>(() =>
    src ? src.outputs.map((o) => ({ ...newOutput(), item_id: Number(o.item_id), tracking_no: o.tracking_no, expiry_date: o.expiry_date, qty: String(o.qty) })) : [newOutput()]
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

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
  const setOutput = (key: string, patch: Partial<OutputLine>) => {
    setOutputs((os) => os.map((o) => (o.key === key ? { ...o, ...patch } : o)));
    touch("_outputs");
  };

  // The preview of what posting shares: Σ input estimates over qty × Bobot Nilai.
  const inputTotal = posted ? (execution?.value ?? 0) : inputs.reduce((a, l) => a + bucketReleaseEstimate(bucketById.get(l.bucket_id ?? 0), num(l.qty)), 0);
  const weights = outputs.map((o) => outputWeight(num(o.qty), o.item_id ? itemById.get(o.item_id)?.valueWeight : 0));
  const shares = weights.some((w) => w > 0) ? shareByWeight(inputTotal, weights) : weights.map(() => 0);

  async function onSave() {
    setSaving(true);
    const payload = {
      ...header,
      inputs: inputs.map((l) => ({ bucket_id: l.bucket_id, qty: l.qty })),
      outputs: outputs.map((o) => ({ item_id: o.item_id, tracking_no: o.tracking_no, expiry_date: o.expiry_date, qty: o.qty })),
    };
    const r = mode === "edit" ? await updateExecutionAction(execution!.id, payload) : await createExecutionAction(payload);
    setSaving(false);
    if (!r.ok) {
      const mapped: Record<string, string> = {};
      for (const [k, v] of Object.entries(r.errors)) {
        const m = /^(inputs|outputs)\.(\d+)\.(\w+)$/.exec(k);
        if (m) mapped[`${m[1] === "inputs" ? inputs[Number(m[2])]?.key : `out.${outputs[Number(m[2])]?.key}`}.${m[3]}`] = v;
        else mapped[k] = v;
      }
      setErrors(mapped);
      toast(r.errors._form ? "Tidak diizinkan" : "Belum bisa disimpan", r.errors._form ?? r.errors._inputs ?? r.errors._outputs ?? "Periksa kembali isian.", "err");
      return;
    }
    setDirty(false);
    toast("Eksekusi Produksi disimpan", `${r.no} · Draft`, "ok");
    router.push(`${W.path}/${r.id}`);
  }

  const ro = (n: React.ReactNode) => <div className="ro">{n}</div>;
  const nil = (t = "tidak diisi") => <div className="ro nil">{t}</div>;
  const ws = options.workstations.find((w) => w.id === header.workstation_id);
  const wsBuckets = options.buckets.filter((b) => b.workstationId === header.workstation_id || inputs.some((l) => l.bucket_id === b.id));
  const status = execution?.status ?? "Draft";

  const headerCard = (
    <div className="card">
      <FormBody>
        <FormSection title="Eksekusi">
          <FormRow>
            <Field label="Tanggal" span={3} required={editing} error={errors.execution_date}>
              {editing ? <DateInput value={header.execution_date} invalid={Boolean(errors.execution_date)} onChange={(v) => set("execution_date", v)} /> : ro(formatDate(header.execution_date))}
            </Field>
            <Field label="Workstation" span={6} required={editing} help={editing ? "input diambil dan output dibuat di sini" : undefined} error={errors.workstation_id}>
              {editing ? (
                <Combobox
                  value={header.workstation_id}
                  options={options.workstations.filter((w) => w.active || w.id === header.workstation_id)}
                  placeholder="Pilih Workstation…"
                  emptyText="Belum ada Workstation yang aktif."
                  invalid={Boolean(errors.workstation_id)}
                  onChange={(v) => {
                    setHeader((h) => ({ ...h, workstation_id: v }));
                    // Inputs are lots at the workstation: another one clears them.
                    if (v !== header.workstation_id) setInputs([]);
                    touch("workstation_id", "_inputs");
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
                nil()
              )}
            </Field>
            <Field label="Driver" span={3} required={editing} help={editing ? "dasar alokasi biaya bulan" : undefined} error={errors.driver}>
              {editing ? <MoneyInput decimals={4} value={header.driver} ariaLabel="Driver" onChange={(v) => set("driver", v)} /> : ro(<span className="mono">{qtyText(num(header.driver))}</span>)}
            </Field>
            {posted && (
              <Field label="Journal" span={4}>
                {execution?.journalId
                  ? ro(
                      <Link className="drl" href={`/accounting/journal/${execution.journalId}`}>
                        <span className="mono">{execution.journalNo}</span>
                      </Link>
                    )
                  : nil("WIP sama, tanpa journal")}
              </Field>
            )}
            <Field label="Catatan" span={12}>
              {editing ? (
                <textarea className="ta" rows={2} value={header.note} placeholder="Catatan eksekusi…" onChange={(e) => set("note", e.target.value)} />
              ) : header.note ? (
                <div className="ro multi">{header.note}</div>
              ) : (
                <div className="ro multi nil">tidak diisi</div>
              )}
            </Field>
          </FormRow>
        </FormSection>
        {execution?.cancelReason && status === "Cancelled" && (
          <p className="fnote">
            <b>Dibatalkan:</b> {execution.cancelReason}
          </p>
        )}
      </FormBody>
    </div>
  );

  const outputsCard = (
    <div className="card" style={{ marginTop: 14 }}>
      <div className="card-h">
        <span className="ci">
          <Icon name="box" size={15} />
        </span>
        <div className="ct">
          <h3>Output</h3>
          <p>Setiap output menjadi lot baru. Nilai input dibagi menurut Qty × Bobot Nilai barangnya; output tanpa Bobot Nilai bernilai 0.</p>
        </div>
        {editing && (
          <button
            className="btn sm primary"
            onClick={() => {
              setOutputs((os) => [...os, newOutput()]);
              touch("_outputs");
            }}
          >
            <Icon name="plus" size={14} /> Tambah Output
          </button>
        )}
      </div>
      {errors._outputs && (
        <div className="nbox bad slim">
          <Icon name="warn" size={15} className="ni" />
          <div>
            <b>{errors._outputs}</b>
          </div>
        </div>
      )}
      <div className="tw">
        <table className="grid ltab" style={{ minWidth: 980 }}>
          <thead>
            <tr>
              <th style={{ width: 40 }}>No</th>
              <th>Barang</th>
              <th style={{ width: 200 }}>No. Lot</th>
              <th style={{ width: 150 }}>Kadaluarsa</th>
              <th style={{ width: editing ? 190 : 120 }}>Qty</th>
              <th className="num" style={{ width: 110 }}>
                Bobot
              </th>
              <th className="num" style={{ width: 150 }}>
                {posted ? "Nilai" : "Perkiraan Nilai"}
              </th>
              {editing && <th style={{ width: 40 }} />}
            </tr>
          </thead>
          <tbody>
            {outputs.map((o, i) => {
              const item = o.item_id ? itemById.get(o.item_id) : undefined;
              const e = (f: string) => errors[`out.${o.key}.${f}`];
              const err = e("item_id") ?? e("tracking_no") ?? e("expiry_date") ?? e("qty");
              const stored = execution?.outputs[i];
              return (
                <tr key={o.key} className={err ? "overrow" : undefined}>
                  <td className="no">{i + 1}</td>
                  <td>
                    {editing ? (
                      <Combobox
                        size="sm"
                        value={o.item_id}
                        options={options.items.filter((x) => x.active || x.id === o.item_id)}
                        placeholder="Pilih Barang…"
                        emptyText="Belum ada Barang dengan Kelola Stok."
                        invalid={Boolean(e("item_id"))}
                        onChange={(v) => setOutput(o.key, { item_id: v })}
                      />
                    ) : (
                      <span className="idc">
                        <span className="lab">{item?.label}</span>
                        <span className="nm">{item?.name}</span>
                      </span>
                    )}
                    {err && <span className="overtag">{err}</span>}
                  </td>
                  <td>
                    {editing ? (
                      <input className={`inp sm${e("tracking_no") ? " bad" : ""}`} value={o.tracking_no} placeholder="otomatis" onChange={(ev) => setOutput(o.key, { tracking_no: ev.target.value })} />
                    ) : (
                      <span className="mono">{stored?.lotNo ?? (o.tracking_no || "otomatis")}</span>
                    )}
                  </td>
                  <td>
                    {editing ? (
                      item?.hasExpiry ? (
                        <DateInput value={o.expiry_date} invalid={Boolean(e("expiry_date"))} onChange={(v) => setOutput(o.key, { expiry_date: v })} />
                      ) : (
                        <span className="dash">—</span>
                      )
                    ) : o.expiry_date ? (
                      <span className="mono">{formatDate(o.expiry_date)}</span>
                    ) : (
                      <span className="dash">—</span>
                    )}
                  </td>
                  <td>
                    {editing ? (
                      <div className="qcell">
                        <MoneyInput size="sm" decimals={4} value={o.qty} ariaLabel={`Qty ${item?.label ?? ""}`} onChange={(v) => setOutput(o.key, { qty: v })} />
                        <span className="qu">{item?.uomLabel}</span>
                      </div>
                    ) : (
                      <span className="qview">
                        <span className="mny">{qtyText(num(o.qty))}</span>
                        <span className="lab">{item?.uomLabel}</span>
                      </span>
                    )}
                  </td>
                  <td className="num">
                    <span className="mny">{qtyText(posted ? (stored?.weight ?? 0) : weights[i])}</span>
                  </td>
                  <td className="num">
                    <span className="mny">{money(posted ? (stored?.value ?? 0) : shares[i])}</span>
                  </td>
                  {editing && (
                    <td>
                      <button
                        className="iact del"
                        title="Hapus baris"
                        onClick={() => {
                          setOutputs((os) => os.filter((x) => x.key !== o.key));
                          touch("_outputs");
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
    </div>
  );

  return (
    <>
      <DocumentHeader
        module="Produksi"
        trail={[{ label: "Eksekusi Produksi", href: W.path }]}
        icon="gear"
        number={execution?.no}
        placeholder="Eksekusi Produksi Baru"
        status={execution ? status : null}
        statusLabel={execution ? { text: PROD_DOC_STATUS_TEXT[status], tone: PROD_DOC_STATUS_BADGE[status] } : undefined}
        editing={mode === "edit"}
        dirty={editing && dirty}
      >
        {editing ? (
          <>
            <CancelButton href={execution ? `${W.path}/${execution.id}` : W.path} dirty={dirty} disabled={saving} />
            <button className="btn primary" onClick={onSave} disabled={saving}>
              <Icon name="save" size={15} /> {saving ? "Menyimpan…" : "Simpan"}
            </button>
          </>
        ) : (
          <ProdDocActions
            workflow={W}
            id={execution!.id}
            subject={execution!.no}
            status={status}
            can={can}
            run={(a, reason) => transitionExecutionAction(execution!.id, a, reason)}
            preview={() => previewExecutionAction(execution!.id)}
          />
        )}
      </DocumentHeader>

      <div className="fgrid solo">
        <div>
          {headerCard}
          <BucketLinesCard
            title="Input"
            desc="Lot yang ada di Workstation ini dan jumlah yang dipakai. Nilainya dilepas round(V × q ÷ Q)."
            icon="layers"
            editing={editing}
            lines={inputs}
            buckets={wsBuckets}
            waitingFor={header.workstation_id ? null : "Pilih Workstation dulu…"}
            posted={posted ? execution?.inputValues : undefined}
            errors={{ ...errors, _self: errors._inputs ?? "" }}
            valueLabel={posted ? "Nilai" : "Perkiraan Nilai"}
            onChange={(ls) => {
              setInputs(ls);
              touch("_inputs");
            }}
          />
          {outputsCard}
        </div>
      </div>
    </>
  );
}
