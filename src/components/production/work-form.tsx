"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icon";
import { Combobox } from "@/components/ui/combobox";
import { DateInput } from "@/components/ui/date-input";
import { Field, FormBody, FormRow, FormSection } from "@/components/ui/form";
import { MoneyInput } from "@/components/ui/money-input";
import { useToast } from "@/components/ui/toast";
import { AuxCard, ErrorBox, ExecutionHeader, idc, money, newKey, qtyText, refs, ro, type AuxRow } from "@/components/production/execution-parts";
import { JobPicker } from "@/components/production/job-picker";
import { ProdDocActions } from "@/components/production/production-doc-actions";
import { previewWorkAction, saveWorkAction, transitionWorkAction } from "@/app/actions/production-execution";
import { unitCost } from "@/lib/erp/production-execution";
import { WORK_PATH, WORK_WORKFLOW } from "@/lib/erp/production-execution-workflow";
import type { ProdDocAbilities } from "@/lib/erp/production-doc-workflow";
import type { BucketOption } from "@/lib/erp/production-doc";
import type { WorkOptions, WorkView } from "@/lib/erp/production-work";
import { formatDate, todayIso } from "@/lib/format";

/**
 * Pengerjaan Unit in all three modes (W74, A5): opened from the Workspace with
 * the Jobs ticked there, more added by *Tambah No. Job*. A row is one Job, taken
 * whole (W96), or one No. Stok without a Job, which may be taken in part; each
 * row has exactly one karyawan. One partai per document (W76).
 */

type Picked = { bucket_id: number; qty: string; employee_id: number | null };
type Group = { key: string; members: BucketOption[] };

/** A Job's group key: goods without a No. Job stand alone. */
const groupOf = (b: BucketOption) => (b.jobId ? `j${b.jobId}` : `b${b.id}`);
const groupsOf = (rows: BucketOption[]): Group[] => {
  const out = new Map<string, BucketOption[]>();
  for (const b of rows) out.set(groupOf(b), [...(out.get(groupOf(b)) ?? []), b]);
  return [...out].map(([key, members]) => ({ key, members }));
};

export function WorkForm({
  mode,
  work,
  options,
  can,
  initialBucketIds = [],
  autoPost = false,
}: {
  mode: "new" | "edit" | "view";
  work: WorkView | null;
  options: WorkOptions;
  can: ProdDocAbilities;
  /** The rows ticked in the Workspace Unit. */
  initialBucketIds?: number[];
  /** The form's *Posting* just saved this Draft: open the confirmation (D2). */
  autoPost?: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const editing = mode !== "view";
  const scanned = options.inputs.filter((b) => initialBucketIds.includes(b.id));
  const [unitId, setUnitId] = useState<number | null>(work?.unitId ?? scanned[0]?.unitId ?? (options.units.length === 1 ? options.units[0].id : null));
  const [date, setDate] = useState(work?.date ?? todayIso());
  const [resultNote, setResultNote] = useState(work?.resultNote ?? "");
  const [note, setNote] = useState(work?.note ?? "");
  const [picked, setPicked] = useState<Picked[]>(() => work?.lines.map((l) => ({ bucket_id: l.bucketId, qty: String(l.qty), employee_id: l.employeeId })) ?? scanned.map((b) => ({ bucket_id: b.id, qty: String(b.qty), employee_id: null })));
  const [aux, setAux] = useState<AuxRow[]>(() => work?.aux.map((a) => ({ key: newKey(), bucket_id: a.bucketId, qty: String(a.qty), job_id: a.jobId })) ?? []);
  const [adding, setAdding] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  const touched = () => {
    setDirty(true);
    setErrors({});
  };
  const unit = options.units.find((u) => u.id === unitId);
  const workspace = unit ? `/production/workspace/${encodeURIComponent(unit.label)}?tab=persiapan` : null;
  const byId = new Map(options.inputs.map((b) => [b.id, b]));
  const pickOf = new Map(picked.map((p) => [p.bucket_id, p]));
  const chosen = picked.flatMap((p) => byId.get(p.bucket_id) ?? []);
  const lines = groupsOf(chosen);
  const partai = chosen.find((b) => b.partaiId)?.partaiId ?? null;
  const posted = work?.status === "Posted" ? work : null;
  // What else waits here, of the same partai once one is chosen (W76).
  const waiting = groupsOf(options.inputs.filter((b) => b.unitId === unitId && b.qty > 0 && !pickOf.has(b.id)));
  const addable = waiting.filter((g) => !partai || !g.members[0].partaiId || g.members[0].partaiId === partai);

  const setWorker = (members: BucketOption[], employee_id: number | null) => {
    const ids = new Set(members.map((b) => b.id));
    setPicked((p) => p.map((x) => (ids.has(x.bucket_id) ? { ...x, employee_id } : x)));
    touched();
  };
  const remove = (members: BucketOption[]) => {
    const ids = new Set(members.map((b) => b.id));
    setPicked((p) => p.filter((x) => !ids.has(x.bucket_id)));
    touched();
  };
  const firstWorker = lines.length ? (pickOf.get(lines[0].members[0].id)?.employee_id ?? null) : null;

  async function save(post: boolean) {
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
      toast(result.errors._form ? "Tidak diizinkan" : "Belum bisa disimpan", result.errors._form ?? result.errors._lines ?? "Periksa kembali isian.", "err");
      return;
    }
    setDirty(false);
    if (!post) toast("Pengerjaan Unit disimpan", `${result.no} · Draft`, "ok");
    router.push(`${WORK_PATH}/${result.id}${post ? "?post=1" : ""}`);
  }

  const gramsOf = (b: BucketOption, qty: number) => (b.qty > 0 ? ((b.grams ?? 0) * qty) / b.qty : 0);
  const gramOfPick = (b: BucketOption) => gramsOf(b, Number(pickOf.get(b.id)?.qty) || 0);
  const totalGrams = posted ? posted.lines.reduce((a, l) => a + l.grams, 0) : chosen.reduce((a, b) => a + gramOfPick(b), 0);
  const cost = posted ? posted.cost : chosen.reduce((a, b) => a + unitCost(gramOfPick(b), b.rate ?? 0), 0);
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
        onSave={() => save(false)}
        onPost={can.post ? () => save(true) : undefined}
        backHref={work ? `${WORK_PATH}/${work.id}` : (workspace ?? WORK_PATH)}
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
              autoPost={autoPost}
              doneHref={workspace ?? undefined}
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
                  <Field label="Unit" span={4} required={editing} locked={editing && (mode === "edit" || picked.length > 0)} error={errors.unit_id}>
                    {mode === "new" && !picked.length ? (
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
                      ro(idc(work?.unitLabel ?? unit?.label ?? "", work?.unitName ?? unit?.name ?? ""))
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
                  <Field label="Partai" span={3}>
                    {chosen[0]?.partaiNo ? ro(<span className="mono">{chosen.find((b) => b.partaiNo)!.partaiNo}</span>) : <div className="ro nil">{chosen.length ? "sebelum partai" : "mengikuti baris"}</div>}
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
                  {posted && (
                    <Field label="Journal" span={4}>
                      {posted.journalId ? (
                        ro(
                          <Link className="drl" href={`/accounting/journal/${posted.journalId}`}>
                            <span className="mono">{posted.journalNo}</span>
                          </Link>
                        )
                      ) : (
                        <div className="ro nil">tanpa journal</div>
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
                <p>Satu No. Job dikerjakan utuh, tepat satu karyawan. Satu dokumen satu partai.</p>
              </div>
              {editing && lines.length > 1 && (
                <button className="btn sm" disabled={!firstWorker} onClick={() => setWorker(chosen, firstWorker)}>
                  Samakan dengan Baris Pertama
                </button>
              )}
              {editing && (
                <button className="btn sm primary" disabled={!unitId} onClick={() => setAdding(true)}>
                  <Icon name="plus" size={14} /> Tambah No. Job
                </button>
              )}
            </div>
            <ErrorBox text={errors._lines} />
            {lines.length ? (
              <div className="tw">
                <table className="grid ltab" style={{ minWidth: 820 }}>
                  <thead>
                    <tr>
                      <th>No. Job / No. Stok</th>
                      <th className="num" style={{ width: 190 }}>
                        Jumlah
                      </th>
                      <th className="num" style={{ width: 120 }}>
                        Gram
                      </th>
                      <th style={{ width: 230 }}>Karyawan</th>
                      {editing && <th style={{ width: 40 }} />}
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map(({ key, members }) => {
                      const head = members[0];
                      const pick = pickOf.get(head.id);
                      const err = members.map((b) => errorOf(b.id)).find(Boolean);
                      return (
                        <tr key={key} className={err ? "overrow" : undefined}>
                          <td>
                            {head.jobNo && <div className="mono">{head.jobNo}</div>}
                            {members.map((b) => (
                              <div key={b.id}>
                                {idc(b.lotNo, b.itemName)}
                                {b.isBjl && <span className="bdg s-mute">BJL</span>}
                                {b.qcCheckId && <span className="bdg s-warn">Balik QC · biaya unit masuk lagi</span>}
                              </div>
                            ))}
                            {err && <span className="overtag">{err}</span>}
                          </td>
                          <td className="num">
                            {editing && !head.jobId && pick ? (
                              <div className="qcell">
                                <MoneyInput
                                  size="sm"
                                  decimals={4}
                                  value={pick.qty}
                                  over={Number(pick.qty) > head.qty}
                                  ariaLabel={`Jumlah ${head.lotNo}`}
                                  onChange={(v) => {
                                    setPicked((p) => p.map((x) => (x.bucket_id === head.id ? { ...x, qty: v } : x)));
                                    touched();
                                  }}
                                />
                                <span className="qu">{head.uomLabel}</span>
                              </div>
                            ) : (
                              members.map((b) => <div key={b.id}>{`${qtyText(Number(pickOf.get(b.id)?.qty ?? b.qty))} ${b.uomLabel}`}</div>)
                            )}
                          </td>
                          <td className="num">{qtyText(members.reduce((a, b) => a + gramOfPick(b), 0))}</td>
                          <td>
                            {editing ? (
                              <Combobox size="sm" value={pick?.employee_id ?? null} options={refs(options.employees)} placeholder="Pilih karyawan…" emptyText="Belum ada Karyawan." onChange={(v) => setWorker(members, v)} />
                            ) : (
                              worker(pick?.employee_id ?? null) && idc(worker(pick!.employee_id)!.label, worker(pick!.employee_id)!.name)
                            )}
                          </td>
                          {editing && (
                            <td>
                              <button className="iact del" title="Keluarkan baris" onClick={() => remove(members)}>
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
            ) : (
              <div className="empty">
                <h4>{unitId ? "Belum ada No. Job" : "Pilih Unit dulu…"}</h4>
                {unitId && <p>Tambahkan No. Job dari Persiapan dengan Tambah No. Job.</p>}
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

          <div className="uw-pair card" style={{ marginTop: 14 }}>
            <div className="impact">
              <div className="ttl">Gram</div>
              <div className="ir">
                <span>No. Job</span>
                <b>{lines.length}</b>
              </div>
              <div className="ir tot">
                <span>Total gram</span>
                <b>{qtyText(totalGrams)} g</b>
              </div>
            </div>
            <div className="impact">
              <div className="ttl">Nilai</div>
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

      {adding && (
        <JobPicker
          title="Tambah No. Job"
          subtitle={`Yang menunggu di Persiapan ${unit?.label ?? ""}${partai ? ", partai yang sama" : ""}.`}
          choices={addable.map((g) => ({
            key: g.key,
            jobNo: g.members[0].jobNo,
            lotNo: g.members[0].lotNo,
            itemName: g.members[0].itemName,
            count: g.members.length,
            partaiId: g.members[0].partaiId,
            partaiNo: g.members[0].partaiNo,
            grams: g.members.reduce((a, b) => a + (b.grams ?? 0), 0),
          }))}
          onAdd={(keys) => {
            const add = addable.filter((g) => keys.includes(g.key)).flatMap((g) => g.members);
            setPicked((p) => [...p, ...add.map((b) => ({ bucket_id: b.id, qty: String(b.qty), employee_id: null }))]);
            setAdding(false);
            touched();
          }}
          onClose={() => setAdding(false)}
        />
      )}
    </>
  );
}
