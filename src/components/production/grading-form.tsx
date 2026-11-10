"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icon";
import { Combobox } from "@/components/ui/combobox";
import { DateInput } from "@/components/ui/date-input";
import { Field, FormBody, FormRow, FormSection } from "@/components/ui/form";
import { MoneyInput } from "@/components/ui/money-input";
import { useToast } from "@/components/ui/toast";
import { AuxCard, ErrorBox, ExecutionHeader, idc, money, newKey, qtyText, refs, ro, type AuxRow } from "@/components/production/execution-parts";
import { ProdDocActions } from "@/components/production/production-doc-actions";
import { previewGradingAction, saveGradingAction, transitionGradingAction } from "@/app/actions/production-execution";
import { shareGrading, unitCost } from "@/lib/erp/production-execution";
import { GRADING_PATH, GRADING_WORKFLOW } from "@/lib/erp/production-execution-workflow";
import type { ProdDocAbilities } from "@/lib/erp/production-doc-workflow";
import type { GradingOptions, GradingView } from "@/lib/erp/production-grading";
import { formatDate, formatPrice, todayIso } from "@/lib/format";

/**
 * No. Grading in all three modes. A new one starts on the Unit's Persiapan;
 * picking a row opens it with the input filled, then the outputs are typed and
 * the summary follows at once (W25, V3).
 */

type OutputRow = { key: string; item_id: number | null; grams: string };

export function GradingForm({
  mode,
  grading,
  options,
  notes,
  can,
  initialBucketId,
}: {
  mode: "new" | "edit" | "view";
  grading: GradingView | null;
  options: GradingOptions;
  /** The row a scan in the Workspace Unit opened this form on. */
  initialBucketId?: number;
  /** Pre Cleaning's notes by No. Job (W42). */
  notes: Record<number, string[]>;
  can: ProdDocAbilities;
}) {
  const router = useRouter();
  const toast = useToast();
  const editing = mode !== "view";
  const scanned = options.inputs.find((b) => b.id === initialBucketId);
  const [unitId, setUnitId] = useState<number | null>(grading?.unitId ?? scanned?.unitId ?? (options.units.length === 1 ? options.units[0].id : null));
  const [date, setDate] = useState(grading?.date ?? todayIso());
  const [bucketId, setBucketId] = useState<number | null>(grading?.bucketId ?? scanned?.id ?? null);
  const [qty, setQty] = useState(grading ? String(grading.qty) : scanned ? String(scanned.qty) : "");
  const [note, setNote] = useState(grading?.note ?? "");
  const [outputs, setOutputs] = useState<OutputRow[]>(() => grading?.outputs.map((o) => ({ key: newKey(), item_id: o.itemId, grams: String(o.grams) })) ?? []);
  const [aux, setAux] = useState<AuxRow[]>(() => grading?.aux.map((a) => ({ key: newKey(), bucket_id: a.bucketId, qty: String(a.qty), job_id: null })) ?? []);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  const touched = () => {
    setDirty(true);
    setErrors({});
  };
  const itemOf = new Map(options.items.map((i) => [i.id, i]));
  const input = bucketId ? options.inputs.find((b) => b.id === bucketId) : undefined;
  const queue = options.inputs.filter((b) => b.unitId === unitId && b.qty > 0);
  const unit = options.units.find((u) => u.id === unitId);
  const auxOptions = options.aux.filter((b) => b.unitId === unitId || aux.some((a) => a.bucket_id === b.id));
  const jobNotes = input?.jobId ? notes[input.jobId] : undefined;

  async function onSave() {
    setSaving(true);
    const result = await saveGradingAction(grading?.id ?? null, {
      unit_id: unitId,
      grading_date: date,
      bucket_id: bucketId,
      qty,
      note,
      outputs: outputs.map((o) => ({ item_id: o.item_id, grams: o.grams })),
      aux: aux.map((a) => ({ bucket_id: a.bucket_id, qty: a.qty })),
    });
    setSaving(false);
    if (!result.ok) {
      setErrors(result.errors);
      toast(result.errors._form ? "Tidak diizinkan" : "Belum bisa disimpan", result.errors._form ?? "Periksa kembali isian.", "err");
      return;
    }
    setDirty(false);
    toast("No. Grading disimpan", `${result.no} · Draft`, "ok");
    router.push(`${GRADING_PATH}/${result.id}`);
  }

  // The summary: a preview while editing, what Posting stored once posted.
  const taken = Number(qty) || 0;
  const posted = grading?.status === "Posted" ? grading : null;
  const gramsIn = posted ? posted.grams : input && input.qty > 0 ? ((input.grams ?? 0) * taken) / input.qty : 0;
  const inputValue = posted ? posted.inputValue : input && input.qty > 0 ? (taken >= input.qty ? input.value : Math.round((input.value * taken) / input.qty)) : 0;
  const cost = posted ? posted.cost : unitCost(gramsIn, input?.rate ?? 0);
  const auxValue = posted
    ? posted.auxValue
    : aux.reduce((sum, a) => {
        const b = options.aux.find((x) => x.id === a.bucket_id);
        return sum + (b && b.qty > 0 ? Math.min(b.value, Math.round((b.value * (Number(a.qty) || 0)) / b.qty)) : 0);
      }, 0);
  const shares = outputs.map((o) => ({ grams: Number(o.grams) || 0, isBjl: (o.item_id && itemOf.get(o.item_id)?.isBjl) || false }));
  const share = shareGrading(Math.round(inputValue + cost + auxValue), shares);
  const values = posted ? posted.outputs.map((o) => o.value) : share.values;
  const scrap = posted ? posted.scrap : share.scrap;
  const gramsOut = shares.reduce((a, o) => a + o.grams, 0);

  const pickCard = editing && !bucketId && (
    <div className="card" style={{ marginTop: 14 }}>
      <div className="card-h">
        <span className="ci">
          <Icon name="layers" size={15} />
        </span>
        <div className="ct">
          <h3>Persiapan Unit</h3>
          <p>Pilih satu baris: satu No. Stok input menghasilkan satu No. Grading.</p>
        </div>
      </div>
      <ErrorBox text={errors.bucket_id} />
      {queue.length ? (
        <div className="tw">
          <table className="grid ltab" style={{ minWidth: 760 }}>
            <thead>
              <tr>
                <th>No. Stok</th>
                <th style={{ width: 170 }}>Partai</th>
                <th style={{ width: 170 }}>No. Job</th>
                <th className="num" style={{ width: 130 }}>
                  Saldo
                </th>
                <th style={{ width: 110 }} />
              </tr>
            </thead>
            <tbody>
              {queue.map((b) => (
                <tr key={b.id}>
                  <td>
                    {idc(b.lotNo, b.itemName)}
                    {b.qcCheckId && <span className="bdg s-warn">Balik QC</span>}
                  </td>
                  <td className="mono">{b.partaiNo ?? "—"}</td>
                  <td className="mono">{b.jobNo ?? "—"}</td>
                  <td className="num">
                    {qtyText(b.qty)} {b.uomLabel}
                  </td>
                  <td>
                    <button
                      className="btn sm primary"
                      onClick={() => {
                        setBucketId(b.id);
                        setQty(String(b.qty));
                        touched();
                      }}
                    >
                      Grading
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="empty">
          <h4>{unitId ? "Belum ada barang di Persiapan unit ini" : "Pilih Unit dulu…"}</h4>
        </div>
      )}
    </div>
  );

  const inputCard = input && (
    <div className="card" style={{ marginTop: 14 }}>
      <div className="card-h">
        <span className="ci">
          <Icon name="box" size={15} />
        </span>
        <div className="ct">
          <h3>Input</h3>
          <p>
            {input.partaiNo ? `Partai ${input.partaiNo}` : "Sebelum partai"}
            {input.jobNo ? ` · ${input.jobNo}` : ""}
          </p>
        </div>
        {editing && (
          <button
            className="btn sm"
            onClick={() => {
              setBucketId(null);
              setQty("");
              touched();
            }}
          >
            Ganti
          </button>
        )}
      </div>
      <FormBody>
        <FormRow>
          <Field label="No. Stok" span={5}>
            {ro(idc(input.lotNo, input.itemName))}
          </Field>
          <Field label="Saldo" span={3}>
            {ro(`${qtyText(input.qty)} ${input.uomLabel}`)}
          </Field>
          <Field label="Diambil" span={4} required={editing} error={errors.qty}>
            {editing ? (
              <div className="qcell">
                <MoneyInput
                  decimals={4}
                  value={qty}
                  over={taken > input.qty}
                  ariaLabel="Jumlah diambil"
                  onChange={(v) => {
                    setQty(v);
                    touched();
                  }}
                />
                <span className="qu">{input.uomLabel}</span>
              </div>
            ) : (
              ro(`${qtyText(Number(qty))} ${input.uomLabel}`)
            )}
          </Field>
        </FormRow>
        {input.qcCheckId && (
          <p className="fnote">
            <b>Balik QC:</b> barang ini kembali dari QC, jadi biaya unit masuk lagi.
          </p>
        )}
        {jobNotes?.length ? (
          <p className="fnote">
            <b>Catatan Pre Cleaning:</b> {jobNotes.join(" · ")}
          </p>
        ) : null}
      </FormBody>
    </div>
  );

  const addOutput = () => {
    setOutputs((o) => [...o, { key: newKey(), item_id: null, grams: "" }]);
    touched();
  };
  const setOutput = (key: string, patch: Partial<OutputRow>) => {
    setOutputs((o) => o.map((r) => (r.key === key ? { ...r, ...patch } : r)));
    touched();
  };
  const outputCard = (bucketId || !editing) && (
    <div className="card" style={{ marginTop: 14 }}>
      <div className="card-h">
        <span className="ci">
          <Icon name="tree" size={15} />
        </span>
        <div className="ct">
          <h3>Output</h3>
          <p>Tiap output menjadi No. Stok baru. Item BJL bernilai 0, gramnya tetap tercatat.</p>
        </div>
        {editing && (
          <button className="btn sm primary" onClick={addOutput}>
            <Icon name="plus" size={14} /> Tambah Output
          </button>
        )}
      </div>
      <ErrorBox text={errors._outputs} />
      <div className="tw">
        <table className="grid ltab" style={{ minWidth: 760 }}>
          <thead>
            <tr>
              <th style={{ width: 40 }}>No</th>
              <th>Item</th>
              <th style={{ width: 190 }}>No. Stok Baru</th>
              <th className="num" style={{ width: 170 }}>
                Gram
              </th>
              <th className="num" style={{ width: 160 }}>
                Nilai
              </th>
              {editing && <th style={{ width: 40 }} />}
            </tr>
          </thead>
          <tbody>
            {outputs.map((o, i) => {
              const item = o.item_id ? itemOf.get(o.item_id) : undefined;
              const stored = grading?.outputs[i];
              const err = errors[`outputs.${i}.item_id`] ?? errors[`outputs.${i}.grams`];
              return (
                <tr key={o.key} className={err ? "overrow" : undefined}>
                  <td className="no">{i + 1}</td>
                  <td>
                    {editing ? (
                      <Combobox size="sm" value={o.item_id} options={refs(options.items)} placeholder="Pilih Item…" emptyText="Belum ada Barang dengan Kelola Stok." onChange={(v) => setOutput(o.key, { item_id: v })} />
                    ) : item ? (
                      idc(item.label, item.name)
                    ) : null}
                    {item?.isBjl && <span className="bdg s-mute">BJL</span>}
                    {err && <span className="overtag">{err}</span>}
                  </td>
                  <td className="mono">{stored?.trackingNo ?? <span className="dash">otomatis</span>}</td>
                  <td className="num">
                    {editing ? (
                      <MoneyInput size="sm" decimals={4} value={o.grams} ariaLabel={`Gram ${item?.label ?? ""}`} onChange={(v) => setOutput(o.key, { grams: v })} />
                    ) : (
                      qtyText(Number(o.grams))
                    )}
                  </td>
                  <td className="num">
                    <span className="mny">{money(values[i] ?? 0)}</span>
                  </td>
                  {editing && (
                    <td>
                      <button
                        className="iact del"
                        title="Hapus baris"
                        onClick={() => {
                          setOutputs((r) => r.filter((x) => x.key !== o.key));
                          touched();
                        }}
                      >
                        <Icon name="trash" size={14} />
                      </button>
                    </td>
                  )}
                </tr>
              );
            })}
            {outputs.length === 0 && (
              <tr>
                <td colSpan={6} className="mut" style={{ textAlign: "center" }}>
                  Belum ada output. Tambahkan dengan tombol di atas.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );

  const summary = (bucketId || !editing) && (
    <div className="card" style={{ marginTop: 14, padding: 14 }}>
      <div className="impact">
        <div className="ttl">Ringkasan Nilai</div>
        <div className="ir">
          <span>Nilai input</span>
          <b>{money(inputValue)}</b>
        </div>
        <div className="ir">
          <span>
            Biaya unit ({qtyText(gramsIn)} g × {formatRate(posted ? posted.rate : (input?.rate ?? 0))})
          </span>
          <b>{money(cost)}</b>
        </div>
        <div className="ir">
          <span>Bahan penolong</span>
          <b>{money(auxValue)}</b>
        </div>
        <div className="ir">
          <span>Susut gram</span>
          <b>{qtyText(gramsIn - gramsOut)} g</b>
        </div>
        <div className="ir tot">
          <span>Dibagi ke output</span>
          <b>{money(inputValue + cost + auxValue - scrap)}</b>
        </div>
      </div>
      {scrap > 0 && (
        <p className="fnote">
          <b>Semua output BJL:</b> {money(scrap)} masuk Beban Pemusnahan Produksi saat Posting.
        </p>
      )}
    </div>
  );

  return (
    <>
      <ExecutionHeader
        noun="No. Grading"
        path={GRADING_PATH}
        icon="layers"
        no={grading?.no ?? null}
        status={grading?.status ?? "Draft"}
        editing={editing}
        isEdit={mode === "edit"}
        dirty={dirty}
        saving={saving}
        onSave={onSave}
        backHref={grading ? `${GRADING_PATH}/${grading.id}` : GRADING_PATH}
        actions={
          grading && (
            <ProdDocActions
              workflow={GRADING_WORKFLOW}
              id={grading.id}
              subject={grading.no}
              status={grading.status}
              can={can}
              run={(action, reason) => transitionGradingAction(grading.id, action, reason)}
              preview={() => previewGradingAction(grading.id)}
            />
          )
        }
      />
      <div className="fgrid solo">
        <div>
          <div className="card">
            <FormBody>
              <FormSection title="Pengerjaan">
                <FormRow>
                  <Field label="Unit" span={5} required={editing} locked={mode === "edit" || Boolean(bucketId && editing)} error={errors.unit_id}>
                    {editing && !bucketId ? (
                      <Combobox
                        value={unitId}
                        options={refs(options.units)}
                        placeholder="Pilih Unit…"
                        emptyText="Belum ada unit Grading."
                        onChange={(v) => {
                          setUnitId(v);
                          touched();
                        }}
                      />
                    ) : (
                      ro(idc(grading?.unitLabel ?? unit?.label ?? "", grading?.unitName ?? unit?.name ?? ""))
                    )}
                  </Field>
                  <Field label="Tanggal" span={3} required={editing} error={errors.grading_date}>
                    {editing ? (
                      <DateInput
                        value={date}
                        invalid={Boolean(errors.grading_date)}
                        onChange={(v) => {
                          setDate(v);
                          touched();
                        }}
                      />
                    ) : (
                      ro(formatDate(date))
                    )}
                  </Field>
                  <Field label="Catatan" span={12}>
                    {editing ? (
                      <textarea
                        className="ta"
                        rows={2}
                        value={note}
                        placeholder="Keterangan tambahan…"
                        onChange={(e) => {
                          setNote(e.target.value);
                          touched();
                        }}
                      />
                    ) : note ? (
                      <div className="ro multi">{note}</div>
                    ) : (
                      <div className="ro multi nil">tidak diisi</div>
                    )}
                  </Field>
                </FormRow>
              </FormSection>
              {grading?.reason && (
                <p className="fnote">
                  <b>Dibatalkan:</b> {grading.reason}
                </p>
              )}
            </FormBody>
          </div>
          {pickCard}
          {inputCard}
          {outputCard}
          {(bucketId || !editing) && (
            <AuxCard
              rows={aux}
              options={auxOptions}
              editing={editing}
              errors={errors}
              values={posted ? posted.aux.map((a) => a.value) : undefined}
              onChange={(r) => {
                setAux(r);
                touched();
              }}
            />
          )}
          {summary}
        </div>
      </div>
    </>
  );
}

const formatRate = (r: number) => `${formatPrice(r)}/g`;
