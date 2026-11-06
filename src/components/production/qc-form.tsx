"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icon";
import { Combobox } from "@/components/ui/combobox";
import { DateInput } from "@/components/ui/date-input";
import { Field, FormBody, FormRow, FormSection } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import { ErrorBox, ExecutionHeader, idc, qtyText, refs, ro } from "@/components/production/execution-parts";
import { ProdDocActions } from "@/components/production/production-doc-actions";
import { saveQcCheckAction, transitionQcCheckAction } from "@/app/actions/production-execution";
import { QC_CHECK_PATH, QC_CHECK_WORKFLOW, QC_DECISION_TEXT, type QcDecision } from "@/lib/erp/production-execution-workflow";
import type { ProdDocAbilities } from "@/lib/erp/production-doc-workflow";
import type { QcOptions, QcRow, QcView } from "@/lib/erp/production-qc";
import { formatDate, todayIso } from "@/lib/format";

/**
 * QC Check in all three modes (W65): the Unit's waiting rows of one partai, each
 * decided Lulus or Balik whole, the reason optional. Posting waits for every row.
 */

type Decided = { decision: QcDecision | null; reason: string };

/** One partai at a time (W76); goods before a partai share one group. */
const partaiKey = (r: QcRow) => r.partaiId ?? 0;

export function QcForm({ mode, check, options, can }: { mode: "new" | "edit" | "view"; check: QcView | null; options: QcOptions; can: ProdDocAbilities }) {
  const router = useRouter();
  const toast = useToast();
  const editing = mode !== "view";
  const [unitId, setUnitId] = useState<number | null>(check?.unitId ?? null);
  const [date, setDate] = useState(check?.date ?? todayIso());
  const [inspector, setInspector] = useState(check?.inspector ?? "");
  const [note, setNote] = useState(check?.note ?? "");
  const byId = new Map(options.rows.map((r) => [r.id, r]));
  const [partai, setPartai] = useState<number | null>(() => {
    const first = check?.lines[0] ? byId.get(check.lines[0].bucketId) : undefined;
    return first ? partaiKey(first) : null;
  });
  const [decided, setDecided] = useState<Record<number, Decided>>(() => Object.fromEntries((check?.lines ?? []).map((l) => [l.bucketId, { decision: l.decision, reason: l.reason ?? "" }])));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  const touched = () => {
    setDirty(true);
    setErrors({});
  };
  const waiting = options.rows.filter((r) => r.unitId === unitId);
  const groups = [...new Map(waiting.map((r) => [partaiKey(r), r])).entries()].map(([id, r]) => ({ id, label: r.partaiNo ?? "Sebelum partai", name: `${waiting.filter((x) => partaiKey(x) === id).length} baris` }));
  const rows = editing ? waiting.filter((r) => partai != null && partaiKey(r) === partai) : (check?.lines ?? []).flatMap((l) => byId.get(l.bucketId) ?? []);
  const setRow = (id: number, patch: Partial<Decided>) => {
    setDecided((d) => ({ ...d, [id]: { decision: d[id]?.decision ?? null, reason: d[id]?.reason ?? "", ...patch } }));
    touched();
  };

  async function onSave() {
    setSaving(true);
    const result = await saveQcCheckAction(check?.id ?? null, {
      unit_id: unitId,
      qc_date: date,
      inspector,
      note,
      lines: rows.map((r) => ({ bucket_id: r.id, decision: decided[r.id]?.decision ?? null, reason: decided[r.id]?.reason ?? "" })),
    });
    setSaving(false);
    if (!result.ok) {
      setErrors(result.errors);
      toast(result.errors._form ? "Tidak diizinkan" : "Belum bisa disimpan", result.errors._form ?? result.errors._lines ?? "Periksa kembali isian.", "err");
      return;
    }
    setDirty(false);
    toast("QC Check disimpan", `${result.no} · Draft`, "ok");
    router.push(`${QC_CHECK_PATH}/${result.id}`);
  }

  const undecided = rows.filter((r) => !decided[r.id]?.decision).length;

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
        onSave={onSave}
        backHref={check ? `${QC_CHECK_PATH}/${check.id}` : QC_CHECK_PATH}
        actions={check && <ProdDocActions workflow={QC_CHECK_WORKFLOW} id={check.id} subject={check.no} status={check.status} can={can} run={(action, reason) => transitionQcCheckAction(check.id, action, reason)} />}
      />
      <div className="fgrid solo">
        <div>
          <div className="card">
            <FormBody>
              <FormSection title="Pemeriksaan">
                <FormRow>
                  <Field label="Unit" span={5} required={editing} locked={mode === "edit"} error={errors.unit_id}>
                    {mode === "new" ? (
                      <Combobox
                        value={unitId}
                        options={refs(options.units.map((u) => ({ id: u.id, label: u.label, name: `${u.name} · ${u.waiting} menunggu` })))}
                        placeholder="Pilih Unit…"
                        emptyText="Belum ada unit ber-QC."
                        onChange={(v) => {
                          setUnitId(v);
                          setPartai(null);
                          touched();
                        }}
                      />
                    ) : (
                      ro(idc(check?.unitLabel ?? "", check?.unitName ?? ""))
                    )}
                  </Field>
                  <Field label="Partai" span={4} required={editing} locked={mode === "edit"} help={editing ? "satu dokumen satu partai" : undefined}>
                    {mode === "new" ? (
                      <Combobox
                        value={partai}
                        options={refs(groups)}
                        placeholder="Pilih Partai…"
                        waitingFor={unitId ? undefined : "Pilih Unit dulu…"}
                        emptyText="Tidak ada hasil yang menunggu QC di unit ini."
                        onChange={(v) => {
                          setPartai(v);
                          touched();
                        }}
                      />
                    ) : (
                      ro(<span className="mono">{rows[0]?.partaiNo ?? "Sebelum partai"}</span>)
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
                  <Field label="Pemeriksa" span={4}>
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
                <p>{editing ? `Satu baris diputuskan utuh. ${undecided ? `${undecided} baris belum diputuskan.` : "Semua baris sudah diputuskan."}` : "Lulus masuk Stand By; Balik kembali ke Persiapan unit ini."}</p>
              </div>
              {editing && undecided > 0 && rows.length > 0 && (
                <button
                  className="btn sm"
                  onClick={() => {
                    setDecided((d) => ({ ...d, ...Object.fromEntries(rows.filter((r) => !d[r.id]?.decision).map((r) => [r.id, { decision: "Pass" as const, reason: "" }])) }));
                    touched();
                  }}
                >
                  Sisanya Lulus
                </button>
              )}
            </div>
            <ErrorBox text={errors._lines} />
            {rows.length ? (
              <div className="tw">
                <table className="grid ltab" style={{ minWidth: 760 }}>
                  <thead>
                    <tr>
                      <th>No. Stok</th>
                      <th style={{ width: 170 }}>No. Job</th>
                      <th className="num" style={{ width: 120 }}>
                        Jumlah
                      </th>
                      <th style={{ width: 170 }}>Keputusan</th>
                      <th style={{ width: 220 }}>Alasan</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r, i) => {
                      const d = decided[r.id];
                      const err = errors[`lines.${i}.bucket_id`] ?? errors[`lines.${i}.decision`];
                      return (
                        <tr key={r.id} className={err || d?.decision === "Return" ? "overrow" : undefined}>
                          <td>
                            {idc(r.lotNo, r.itemName)}
                            {r.isBjl && <span className="bdg s-mute">BJL</span>}
                            {err && <span className="overtag">{err}</span>}
                          </td>
                          <td className="mono">{r.jobNo ?? "—"}</td>
                          <td className="num">{`${qtyText(check?.lines.find((l) => l.bucketId === r.id)?.qty ?? r.qty)} ${r.uomLabel}`}</td>
                          <td>
                            {editing ? (
                              <span className="dtog" role="group" aria-label={`Keputusan ${r.lotNo}`}>
                                {(["Pass", "Return"] as QcDecision[]).map((v) => (
                                  <button key={v} type="button" className={d?.decision === v ? "on" : undefined} onClick={() => setRow(r.id, { decision: v })}>
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
                              <input className="inp sm" value={d.reason} placeholder="opsional" onChange={(e) => setRow(r.id, { reason: e.target.value })} />
                            ) : (
                              <span className="mut">{d?.reason || <span className="dash">—</span>}</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="empty">
                <h4>{partai == null ? "Pilih Partai dulu…" : "Tidak ada hasil yang menunggu QC di unit ini"}</h4>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
