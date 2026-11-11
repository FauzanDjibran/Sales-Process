"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icon";
import { Combobox } from "@/components/ui/combobox";
import { DateInput } from "@/components/ui/date-input";
import { Field, FormBody, FormRow, FormSection } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import { ErrorBox, ExecutionHeader, idc, qtyText, refs, ro } from "@/components/production/execution-parts";
import { JobPicker } from "@/components/production/job-picker";
import { ProdDocActions } from "@/components/production/production-doc-actions";
import { saveQcCheckAction, transitionQcCheckAction } from "@/app/actions/production-execution";
import { QC_CHECK_PATH, QC_CHECK_WORKFLOW, QC_DECISION_TEXT, type QcDecision } from "@/lib/erp/production-execution-workflow";
import type { ProdDocAbilities } from "@/lib/erp/production-doc-workflow";
import type { QcOptions, QcRow, QcView } from "@/lib/erp/production-qc";
import { formatDate, todayIso } from "@/lib/format";

/**
 * QC Check in all three modes (W65, A4): opened from the Workspace's QC tab with
 * the rows ticked there. A row is one Job — its No. Stok under it — or one No.
 * Stok without a Job, decided Lulus or Balik whole, the reason optional. One
 * partai per document; Posting waits for every row.
 */

type Decided = { decision: QcDecision | null; reason: string };
type Row = { key: string; jobNo: string | null; partaiId: number | null; partaiNo: string | null; buckets: QcRow[] };

const keyOf = (r: QcRow) => (r.jobId ? `j${r.jobId}` : `b${r.id}`);
const rowsOf = (buckets: QcRow[]): Row[] => {
  const out = new Map<string, Row>();
  for (const b of buckets) {
    const k = keyOf(b);
    const r = out.get(k) ?? { key: k, jobNo: b.jobNo, partaiId: b.partaiId, partaiNo: b.partaiNo, buckets: [] };
    r.buckets.push(b);
    out.set(k, r);
  }
  return [...out.values()];
};
const gramOf = (r: Row) => r.buckets.reduce((a, b) => a + (b.grams ?? 0), 0);

export function QcForm({
  mode,
  check,
  options,
  can,
  initialBucketIds = [],
  autoPost = false,
}: {
  mode: "new" | "edit" | "view";
  check: QcView | null;
  options: QcOptions;
  can: ProdDocAbilities;
  /** The rows ticked in the Workspace's QC tab. */
  initialBucketIds?: number[];
  /** The form's *Posting* just saved this Draft: open the confirmation (D2). */
  autoPost?: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const editing = mode !== "view";
  const byId = new Map(options.rows.map((r) => [r.id, r]));
  const stored = (check?.lines ?? []).flatMap((l) => byId.get(l.bucketId) ?? []);
  const opened = initialBucketIds.flatMap((id) => byId.get(id) ?? []);
  const start = stored.length ? stored : opened;
  const [unitId, setUnitId] = useState<number | null>(check?.unitId ?? start[0]?.unitId ?? (options.units.length === 1 ? options.units[0].id : null));
  const [date, setDate] = useState(check?.date ?? todayIso());
  const [inspector, setInspector] = useState(check?.inspector ?? "");
  const [note, setNote] = useState(check?.note ?? "");
  const [keys, setKeys] = useState<string[]>(() => [...new Set(start.map(keyOf))]);
  const [decided, setDecided] = useState<Record<string, Decided>>(() => {
    const out: Record<string, Decided> = {};
    for (const l of check?.lines ?? []) {
      const b = byId.get(l.bucketId);
      if (b) out[keyOf(b)] = { decision: l.decision, reason: l.reason ?? "" };
    }
    return out;
  });
  const [adding, setAdding] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  const touched = () => {
    setDirty(true);
    setErrors({});
  };
  const unit = options.units.find((u) => u.id === unitId);
  const workspace = unit ? `/production/workspace/${encodeURIComponent(unit.label)}?tab=qc` : null;
  // While a Draft, a Job is what waits here now; once posted, what the document held.
  const waiting = rowsOf(options.rows.filter((r) => r.unitId === unitId && r.qty > 0));
  const rows: Row[] = check?.status === "Posted" || !editing ? rowsOf(stored) : keys.flatMap((k) => waiting.find((w) => w.key === k) ?? []);
  const partai = rows[0]?.partaiId;
  const addable = waiting.filter((w) => !keys.includes(w.key) && (!rows.length || w.partaiId === partai));
  const undecided = rows.filter((r) => !decided[r.key]?.decision).length;

  const decide = (key: string, patch: Partial<Decided>) => {
    setDecided((d) => ({ ...d, [key]: { decision: d[key]?.decision ?? null, reason: d[key]?.reason ?? "", ...patch } }));
    touched();
  };

  async function save(post: boolean) {
    setSaving(true);
    const result = await saveQcCheckAction(check?.id ?? null, {
      unit_id: unitId,
      qc_date: date,
      inspector,
      note,
      lines: rows.flatMap((r) => r.buckets.map((b) => ({ bucket_id: b.id, decision: decided[r.key]?.decision ?? null, reason: decided[r.key]?.reason ?? "" }))),
    });
    setSaving(false);
    if (!result.ok) {
      setErrors(result.errors);
      toast(result.errors._form ? "Tidak diizinkan" : "Belum bisa disimpan", result.errors._form ?? result.errors._lines ?? "Periksa kembali isian.", "err");
      return;
    }
    setDirty(false);
    if (!post) toast("QC Check disimpan", `${result.no} · Draft`, "ok");
    router.push(`${QC_CHECK_PATH}/${result.id}${post ? "?post=1" : ""}`);
  }

  return (
    <>
      <ExecutionHeader
        noun="QC Check"
        path={QC_CHECK_PATH}
        icon="check"
        no={check?.no ?? null}
        status={check?.status ?? "Draft"}
        editing={editing}
        isEdit={mode === "edit"}
        dirty={dirty}
        saving={saving}
        onSave={() => save(false)}
        onPost={can.post ? () => save(true) : undefined}
        postDisabled={!rows.length || undecided > 0}
        backHref={check ? `${QC_CHECK_PATH}/${check.id}` : (workspace ?? QC_CHECK_PATH)}
        actions={
          check && (
            <ProdDocActions
              workflow={QC_CHECK_WORKFLOW}
              id={check.id}
              subject={check.no}
              status={check.status}
              can={can}
              run={(action, reason) => transitionQcCheckAction(check.id, action, reason)}
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
              <FormSection title="Pemeriksaan">
                <FormRow>
                  <Field label="Unit" span={4} required={editing} locked={editing && (mode === "edit" || rows.length > 0)} error={errors.unit_id}>
                    {mode === "new" && !rows.length ? (
                      <Combobox
                        value={unitId}
                        options={refs(options.units.map((u) => ({ id: u.id, label: u.label, name: `${u.name} · ${u.waiting} menunggu` })))}
                        placeholder="Pilih Unit…"
                        emptyText="Belum ada unit ber-QC."
                        onChange={(v) => {
                          setUnitId(v);
                          setKeys([]);
                          touched();
                        }}
                      />
                    ) : (
                      ro(idc(check?.unitLabel ?? unit?.label ?? "", check?.unitName ?? unit?.name ?? ""))
                    )}
                  </Field>
                  <Field label="Tanggal" span={3} required={editing} error={errors.qc_date}>
                    {editing ? (
                      <DateInput
                        value={date}
                        invalid={Boolean(errors.qc_date)}
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
                    {rows[0]?.partaiNo ? ro(<span className="mono">{rows[0].partaiNo}</span>) : <div className="ro nil">{rows.length ? "sebelum partai" : "mengikuti baris"}</div>}
                  </Field>
                  <Field label="Pemeriksa" span={6}>
                    {editing ? (
                      <input
                        className="inp"
                        value={inspector}
                        onChange={(e) => {
                          setInspector(e.target.value);
                          touched();
                        }}
                      />
                    ) : (
                      ro(inspector || "—")
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
              {check?.reason && (
                <p className="fnote">
                  <b>Dibatalkan:</b> {check.reason}
                </p>
              )}
            </FormBody>
          </div>

          <div className="card" style={{ marginTop: 14 }}>
            <div className="card-h">
              <span className="ci">
                <Icon name="check" size={15} />
              </span>
              <div className="ct">
                <h3>Hasil yang Diperiksa</h3>
                <p>
                  {editing
                    ? `Satu baris satu No. Job, diputuskan utuh. ${rows.length ? (undecided ? `${undecided} baris belum diputuskan.` : "Semua baris sudah diputuskan.") : ""}`
                    : "Lulus masuk Stand By; Balik kembali ke Persiapan unit ini."}
                </p>
              </div>
              {editing && rows.length > 0 && undecided > 0 && (
                <button
                  className="btn sm"
                  onClick={() => {
                    setDecided((d) => ({ ...d, ...Object.fromEntries(rows.filter((r) => !d[r.key]?.decision).map((r) => [r.key, { decision: "Pass" as const, reason: "" }])) }));
                    touched();
                  }}
                >
                  Lulus Semua
                </button>
              )}
              {editing && (
                <button className="btn sm primary" disabled={!unitId} onClick={() => setAdding(true)}>
                  <Icon name="plus" size={14} /> Tambah Baris
                </button>
              )}
            </div>
            <ErrorBox text={errors._lines} />
            {rows.length ? (
              <div className="tw">
                <table className="grid ltab" style={{ minWidth: 780 }}>
                  <thead>
                    <tr>
                      <th>No. Job / No. Stok</th>
                      <th className="num" style={{ width: 120 }}>
                        Gram
                      </th>
                      <th style={{ width: 170 }}>Keputusan</th>
                      <th style={{ width: 220 }}>Alasan Balik</th>
                      {editing && <th style={{ width: 40 }} />}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => {
                      const d = decided[r.key];
                      return (
                        <tr key={r.key} className={d?.decision === "Return" ? "overrow" : undefined}>
                          <td>
                            {r.jobNo ? <div className="mono">{r.jobNo}</div> : null}
                            {r.buckets.map((b) => (
                              <div key={b.id}>
                                {idc(b.lotNo, b.itemName)}
                                {b.isBjl && <span className="bdg s-mute">BJL</span>}
                                <span className="mut"> · {`${qtyText(check?.lines.find((l) => l.bucketId === b.id)?.qty ?? b.qty)} ${b.uomLabel}`}</span>
                              </div>
                            ))}
                          </td>
                          <td className="num">{qtyText(gramOf(r))}</td>
                          <td>
                            {editing ? (
                              <span className="dtog" role="group" aria-label={`Keputusan ${r.jobNo ?? r.buckets[0].lotNo}`}>
                                {(["Pass", "Return"] as QcDecision[]).map((v) => (
                                  <button key={v} type="button" className={d?.decision === v ? "on" : undefined} onClick={() => decide(r.key, { decision: v })}>
                                    {QC_DECISION_TEXT[v]}
                                  </button>
                                ))}
                              </span>
                            ) : d?.decision ? (
                              <span className={`bdg ${d.decision === "Pass" ? "s-ok" : "s-warn"}`}>{QC_DECISION_TEXT[d.decision]}</span>
                            ) : (
                              <span className="dash">—</span>
                            )}
                          </td>
                          <td>
                            {editing && d?.decision === "Return" ? (
                              <input className="inp sm" value={d.reason} placeholder="opsional" onChange={(e) => decide(r.key, { reason: e.target.value })} />
                            ) : (
                              <span className="mut">{d?.reason || <span className="dash">—</span>}</span>
                            )}
                          </td>
                          {editing && (
                            <td>
                              <button
                                className="iact del"
                                title="Keluarkan baris"
                                onClick={() => {
                                  setKeys((k) => k.filter((x) => x !== r.key));
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
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="empty">
                <h4>{unitId ? "Belum ada baris" : "Pilih Unit dulu…"}</h4>
                {unitId && <p>Tambahkan No. Job yang menunggu QC dengan Tambah Baris.</p>}
              </div>
            )}
          </div>
        </div>
      </div>

      {adding && (
        <JobPicker
          title="Tambah Baris"
          subtitle={rows.length ? `Yang menunggu QC di ${unit?.label ?? ""}, partai yang sama.` : `Yang menunggu QC di ${unit?.label ?? ""}.`}
          choices={addable.map((w) => ({ key: w.key, jobNo: w.jobNo, lotNo: w.buckets[0].lotNo, itemName: w.buckets[0].itemName, count: w.buckets.length, partaiId: w.partaiId, partaiNo: w.partaiNo, grams: gramOf(w) }))}
          onAdd={(k) => {
            setKeys((x) => [...x, ...k]);
            setAdding(false);
            touched();
          }}
          onClose={() => setAdding(false)}
        />
      )}
    </>
  );
}
