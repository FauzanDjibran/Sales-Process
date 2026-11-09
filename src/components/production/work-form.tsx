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
import { previewWorkAction, saveWorkAction, transitionWorkAction } from "@/app/actions/production-execution";
import { unitCost } from "@/lib/erp/production-execution";
import { WORK_PATH, WORK_WORKFLOW } from "@/lib/erp/production-execution-workflow";
import type { ProdDocAbilities } from "@/lib/erp/production-doc-workflow";
import type { BucketOption } from "@/lib/erp/production-doc";
import type { WorkOptions, WorkView } from "@/lib/erp/production-work";
import { formatDate, todayIso } from "@/lib/format";

/**
 * Pengerjaan Unit in all three modes: the Unit's Persiapan grouped by partai and
 * Job, a tick per Job, its karyawan on the row (W74). Once a Job of one partai
 * is ticked the others switch off, so W76 never ends as a refusal.
 */

type Picked = { bucket_id: number; qty: string; employee_id: number | null };

/** A Job's group key: goods without a No. Job stand alone. */
const groupOf = (b: BucketOption) => (b.jobId ? `j${b.jobId}` : `b${b.id}`);

export function WorkForm({
  mode,
  work,
  options,
  can,
  initialBucketIds = [],
}: {
  mode: "new" | "edit" | "view";
  work: WorkView | null;
  options: WorkOptions;
  can: ProdDocAbilities;
  /** The rows a scan in the Workspace Unit opened this form on. */
  initialBucketIds?: number[];
}) {
  const router = useRouter();
  const toast = useToast();
  const editing = mode !== "view";
  const scanned = options.inputs.filter((b) => initialBucketIds.includes(b.id));
  const [unitId, setUnitId] = useState<number | null>(work?.unitId ?? scanned[0]?.unitId ?? null);
  const [date, setDate] = useState(work?.date ?? todayIso());
  const [resultNote, setResultNote] = useState(work?.resultNote ?? "");
  const [note, setNote] = useState(work?.note ?? "");
  const [picked, setPicked] = useState<Picked[]>(() => work?.lines.map((l) => ({ bucket_id: l.bucketId, qty: String(l.qty), employee_id: l.employeeId })) ?? scanned.map((b) => ({ bucket_id: b.id, qty: String(b.qty), employee_id: null })));
  const [aux, setAux] = useState<AuxRow[]>(() => work?.aux.map((a) => ({ key: newKey(), bucket_id: a.bucketId, qty: String(a.qty), job_id: a.jobId })) ?? []);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  const touched = () => {
    setDirty(true);
    setErrors({});
  };
  const unit = options.units.find((u) => u.id === unitId);
  const byId = new Map(options.inputs.map((b) => [b.id, b]));
  const pickOf = new Map(picked.map((p) => [p.bucket_id, p]));
  const rows = options.inputs.filter((b) => b.unitId === unitId && (editing ? b.qty > 0 || pickOf.has(b.id) : pickOf.has(b.id)));
  const chosen = picked.flatMap((p) => byId.get(p.bucket_id) ?? []);
  const partai = chosen.find((b) => b.partaiId)?.partaiId ?? null;
  const posted = work?.status === "Posted" ? work : null;

  const groups = new Map<string, BucketOption[]>();
  for (const b of rows) groups.set(groupOf(b), [...(groups.get(groupOf(b)) ?? []), b]);

  const toggle = (members: BucketOption[], on: boolean) => {
    const ids = new Set(members.map((b) => b.id));
    setPicked((p) => (on ? [...p, ...members.filter((b) => !pickOf.has(b.id)).map((b) => ({ bucket_id: b.id, qty: String(b.qty), employee_id: null }))] : p.filter((x) => !ids.has(x.bucket_id))));
    touched();
  };
  const setWorker = (members: BucketOption[], employee_id: number | null) => {
    const ids = new Set(members.map((b) => b.id));
    setPicked((p) => p.map((x) => (ids.has(x.bucket_id) ? { ...x, employee_id } : x)));
    touched();
  };

  async function onSave() {
    setSaving(true);
    const result = await saveWorkAction(work?.id ?? null, {
      unit_id: unitId,
      work_date: date,
      result_note: resultNote,
      note,
      lines: picked.map((p) => ({ bucket_id: p.bucket_id, qty: p.qty, employee_id: p.employee_id })),
      aux: aux.map((a) => ({ bucket_id: a.bucket_id, qty: a.qty, job_id: a.job_id })),
    });
    setSaving(false);
    if (!result.ok) {
      setErrors(result.errors);
      toast(result.errors._form ? "Tidak diizinkan" : "Belum bisa disimpan", result.errors._form ?? "Periksa kembali isian.", "err");
      return;
    }
    setDirty(false);
    toast("Pengerjaan Unit disimpan", `${result.no} · Draft`, "ok");
    router.push(`${WORK_PATH}/${result.id}`);
  }

  const gramsOf = (b: BucketOption, qty: number) => (b.qty > 0 ? ((b.grams ?? 0) * qty) / b.qty : 0);
  const totalGrams = posted ? posted.lines.reduce((a, l) => a + l.grams, 0) : chosen.reduce((a, b) => a + gramsOf(b, Number(pickOf.get(b.id)?.qty) || 0), 0);
  const cost = posted ? posted.cost : chosen.reduce((a, b) => a + unitCost(gramsOf(b, Number(pickOf.get(b.id)?.qty) || 0), b.rate ?? 0), 0);
  const auxValue = posted
    ? posted.auxValue
    : aux.reduce((sum, a) => {
        const b = options.aux.find((x) => x.id === a.bucket_id);
        return sum + (b && b.qty > 0 ? Math.min(b.value, Math.round((b.value * (Number(a.qty) || 0)) / b.qty)) : 0);
      }, 0);
  const jobChoices = [...new Map(chosen.filter((b) => b.jobId).map((b) => [b.jobId!, { id: b.jobId!, label: b.jobNo!, name: b.lotNo }])).values()];
  const errorOf = (id: number) => {
    const i = picked.findIndex((p) => p.bucket_id === id);
    return errors[`lines.${i}.bucket_id`] ?? errors[`lines.${i}.qty`] ?? errors[`lines.${i}.employee_id`];
  };
  const worker = (id: number | null) => options.employees.find((e) => e.id === id);

  return (
    <>
      <ExecutionHeader
        noun="Pengerjaan Unit"
        path={WORK_PATH}
        icon="check"
        no={work?.no ?? null}
        status={work?.status ?? "Draft"}
        editing={editing}
        isEdit={mode === "edit"}
        dirty={dirty}
        saving={saving}
        onSave={onSave}
        backHref={work ? `${WORK_PATH}/${work.id}` : WORK_PATH}
        actions={
          work && (
            <ProdDocActions
              workflow={WORK_WORKFLOW}
              id={work.id}
              subject={work.no}
              status={work.status}
              can={can}
              run={(action, reason) => transitionWorkAction(work.id, action, reason)}
              preview={() => previewWorkAction(work.id)}
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
                  <Field label="Unit" span={5} required={editing} locked={mode === "edit"} error={errors.unit_id}>
                    {mode === "new" ? (
                      <Combobox
                        value={unitId}
                        options={refs(options.units)}
                        placeholder="Pilih Unit…"
                        emptyText="Belum ada unit Pass Through."
                        onChange={(v) => {
                          setUnitId(v);
                          setPicked([]);
                          setAux([]);
                          touched();
                        }}
                      />
                    ) : (
                      ro(idc(work?.unitLabel ?? "", work?.unitName ?? ""))
                    )}
                  </Field>
                  <Field label="Tanggal" span={3} required={editing} help={editing ? "biaya masuk periode ini" : undefined} error={errors.work_date}>
                    {editing ? (
                      <DateInput
                        value={date}
                        invalid={Boolean(errors.work_date)}
                        onChange={(v) => {
                          setDate(v);
                          touched();
                        }}
                      />
                    ) : (
                      ro(formatDate(date))
                    )}
                  </Field>
                  {(unit?.resultNote || resultNote) && (
                    <Field label="Catatan Hasil" span={12} help={editing ? "jenis dan berat, dibawa ke Penyebaran" : undefined}>
                      {editing ? (
                        <textarea
                          className="ta"
                          rows={2}
                          value={resultNote}
                          placeholder="mis. Jenis A, 500 g"
                          onChange={(e) => {
                            setResultNote(e.target.value);
                            touched();
                          }}
                        />
                      ) : (
                        <div className="ro multi">{resultNote}</div>
                      )}
                    </Field>
                  )}
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
              {work?.reason && (
                <p className="fnote">
                  <b>Dibatalkan:</b> {work.reason}
                </p>
              )}
            </FormBody>
          </div>

          <div className="card" style={{ marginTop: 14 }}>
            <div className="card-h">
              <span className="ci">
                <Icon name="users" size={15} />
              </span>
              <div className="ct">
                <h3>Daftar Job</h3>
                <p>Satu dokumen satu partai, dan tiap No. Job tepat satu karyawan.</p>
              </div>
              {editing && picked.length > 1 && (
                <Combobox
                  size="sm"
                  value={null}
                  options={refs(options.employees)}
                  placeholder="Isi semua karyawan…"
                  onChange={(v) => setWorker(chosen, v)}
                />
              )}
            </div>
            <ErrorBox text={errors._lines} />
            {rows.length ? (
              <div className="tw">
                <table className="grid ltab" style={{ minWidth: 860 }}>
                  <thead>
                    <tr>
                      {editing && <th style={{ width: 36 }} />}
                      <th style={{ width: 190 }}>No. Job</th>
                      <th>No. Stok</th>
                      <th className="num" style={{ width: 170 }}>
                        Gram
                      </th>
                      <th style={{ width: 220 }}>Karyawan</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...groups.values()].map((members) =>
                      members.map((b, i) => {
                        const pick = pickOf.get(b.id);
                        const blocked = !pick && Boolean(partai) && b.partaiId !== partai;
                        const err = errorOf(b.id);
                        return (
                          <tr key={b.id} className={err ? "overrow" : undefined}>
                            {editing && (
                              <td>
                                {i === 0 && (
                                  <input
                                    type="checkbox"
                                    aria-label={`Pilih ${b.jobNo ?? b.lotNo}`}
                                    checked={Boolean(pick)}
                                    disabled={blocked}
                                    title={blocked ? "Partai lain: satu dokumen satu partai" : undefined}
                                    onChange={(e) => toggle(members, e.target.checked)}
                                  />
                                )}
                              </td>
                            )}
                            <td className="mono">
                              {i === 0 ? (b.jobNo ?? "—") : ""}
                              {i === 0 && b.partaiNo && <span className="mut"> {b.partaiNo}</span>}
                            </td>
                            <td>
                              {idc(b.lotNo, b.itemName)}
                              {b.isBjl && <span className="bdg s-mute">BJL</span>}
                              {b.qcCheckId && <span className="bdg s-warn">Balik QC · biaya unit masuk lagi</span>}
                              {err && <span className="overtag">{err}</span>}
                            </td>
                            <td className="num">
                              {editing && pick ? (
                                <div className="qcell">
                                  <MoneyInput
                                    size="sm"
                                    decimals={4}
                                    value={pick.qty}
                                    over={Number(pick.qty) > b.qty}
                                    ariaLabel={`Jumlah ${b.lotNo}`}
                                    onChange={(v) => {
                                      setPicked((p) => p.map((x) => (x.bucket_id === b.id ? { ...x, qty: v } : x)));
                                      touched();
                                    }}
                                  />
                                  <span className="qu">{b.uomLabel}</span>
                                </div>
                              ) : (
                                `${qtyText(pick ? Number(pick.qty) : b.qty)} ${b.uomLabel}`
                              )}
                            </td>
                            <td>
                              {i > 0 || !pick ? null : editing ? (
                                <Combobox size="sm" value={pick.employee_id} options={refs(options.employees)} placeholder="Pilih karyawan…" emptyText="Belum ada Karyawan." onChange={(v) => setWorker(members, v)} />
                              ) : (
                                worker(pick.employee_id) && idc(worker(pick.employee_id)!.label, worker(pick.employee_id)!.name)
                              )}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="empty">
                <h4>{unitId ? "Belum ada barang di Persiapan unit ini" : "Pilih Unit dulu…"}</h4>
              </div>
            )}
          </div>

          {(unitId || aux.length > 0) && (
            <AuxCard
              rows={aux}
              options={options.aux.filter((b) => b.unitId === unitId)}
              jobs={jobChoices}
              editing={editing}
              errors={errors}
              values={posted ? posted.aux.map((a) => a.value) : undefined}
              onChange={(r) => {
                setAux(r);
                touched();
              }}
            />
          )}

          <div className="card" style={{ marginTop: 14, padding: 14 }}>
            <div className="impact">
              <div className="ttl">Ringkasan Biaya</div>
              <div className="ir">
                <span>Total gram</span>
                <b>{qtyText(totalGrams)} g</b>
              </div>
              <div className="ir">
                <span>Biaya unit</span>
                <b>{money(cost)}</b>
              </div>
              <div className="ir">
                <span>Bahan penolong</span>
                <b>{money(auxValue)}</b>
              </div>
              <div className="ir tot">
                <span>Menambah nilai barang</span>
                <b>{money(cost + auxValue - (posted?.scrap ?? 0))}</b>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
