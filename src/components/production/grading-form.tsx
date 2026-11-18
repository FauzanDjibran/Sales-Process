"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icon";
import { Combobox } from "@/components/ui/combobox";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DateInput } from "@/components/ui/date-input";
import { Dialog } from "@/components/ui/dialog";
import { Field, FormBody, FormRow, FormSection } from "@/components/ui/form";
import { MoneyInput } from "@/components/ui/money-input";
import { useToast } from "@/components/ui/toast";
import { AuxCard, ErrorBox, ExecutionHeader, PostedDialog, idc, newKey, qtyText, refs, ro, workspaceHref, type AuxRow } from "@/components/production/execution-parts";
import { InputBar } from "@/components/production/input-bar";
import { ProdDocActions } from "@/components/production/production-doc-actions";
import { saveGradingAction, transitionGradingAction } from "@/app/actions/production-execution";
import { GRADING_PATH, GRADING_WORKFLOW } from "@/lib/erp/production-execution-workflow";
import type { ProdDocAbilities } from "@/lib/erp/production-doc-workflow";
import type { BucketOption } from "@/lib/erp/production-doc";
import type { GradingOptions, GradingView } from "@/lib/erp/production-grading";
import { formatDate, todayIso } from "@/lib/format";

/**
 * No. Grading (W97, W107, T6, P286). The operator first picks the Jobs through
 * the input bar — a Job whole, a No. Stok without a Job in part — so one form
 * records many gradings at once. Each line is then opened in a pop-up worked
 * like a scale: the jenis stays chosen, the gram is focused, Enter adds the
 * result. *Simpan* keeps a Draft, *Posting* posts it from the form; afterwards
 * Buat Lagi or back to the Unit. No prices on the screen (P275).
 */

type OutputRow = { key: string; item_id: number | null; grams: string };
type Line = { key: string; jobId: number | null; bucketId: number | null; qty: string; outputs: OutputRow[] };

export function GradingForm({
  mode,
  grading,
  options,
  notes,
  can,
  initialJobId,
  initialBucketId,
  initialUnitId,
}: {
  mode: "new" | "edit" | "view";
  grading: GradingView | null;
  options: GradingOptions;
  /** Pre Cleaning's notes by No. Job (W42). */
  notes: Record<number, string[]>;
  can: ProdDocAbilities;
  /** The Job or loose No. Stok the Workspace opened this form on. */
  initialJobId?: number;
  initialBucketId?: number;
  /** The Unit a tab button opened it on, with nothing picked yet. */
  initialUnitId?: number;
  /** Kept for the view page's link from older flows; Posting now happens on the form. */
  autoPost?: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const editing = mode !== "view";
  const bucketOf = new Map(options.inputs.map((b) => [b.id, b]));
  const itemOf = new Map(options.items.map((i) => [i.id, i]));
  const opened = options.inputs.find((b) => (initialJobId ? b.jobId === initialJobId : b.id === initialBucketId));

  const [unitId, setUnitId] = useState<number | null>(grading?.unitId ?? opened?.unitId ?? initialUnitId ?? (options.units.length === 1 ? options.units[0].id : null));
  const [date, setDate] = useState(grading?.date ?? todayIso());
  const [note, setNote] = useState(grading?.note ?? "");
  const [workers, setWorkers] = useState<number[]>(grading?.employeeIds ?? []);
  const [lines, setLines] = useState<Line[]>(() => {
    if (grading) {
      const groups = [...new Set(grading.inputs.map((i) => i.groupNo))].sort((a, b) => a - b);
      return groups.map((n) => {
        const ins = grading.inputs.filter((i) => i.groupNo === n);
        const job = ins[0].jobId;
        return {
          key: newKey(),
          jobId: job,
          bucketId: job ? null : ins[0].bucketId,
          qty: job ? "" : String(ins[0].qty),
          outputs: grading.outputs.filter((o) => o.groupNo === n).map((o) => ({ key: newKey(), item_id: o.itemId, grams: String(o.grams) })),
        };
      });
    }
    if (initialJobId && opened) return [{ key: newKey(), jobId: initialJobId, bucketId: null, qty: "", outputs: [] }];
    if (opened) return [{ key: newKey(), jobId: null, bucketId: opened.id, qty: String(opened.qty), outputs: [] }];
    return [];
  });
  const [aux, setAux] = useState<AuxRow[]>(() => grading?.aux.map((a) => ({ key: newKey(), bucket_id: a.bucketId, qty: String(a.qty), job_id: null })) ?? []);
  const [popup, setPopup] = useState<string | null>(null);
  const [jenis, setJenis] = useState<number | null>(null);
  const [gram, setGram] = useState("");
  const [entryError, setEntryError] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [asking, setAsking] = useState(false);
  const [postedNo, setPostedNo] = useState<string | null>(null);
  const gramBox = useRef<HTMLDivElement>(null);

  const touched = () => {
    setDirty(true);
    setErrors({});
  };
  const unit = options.units.find((u) => u.id === unitId);
  const unitLabel = grading?.unitLabel ?? unit?.label ?? null;
  const backToUnit = unitLabel ? workspaceHref(unitLabel, "Grading") : GRADING_PATH;
  const posted = grading?.status === "Posted" ? grading : null;
  const jobNoOf = (id: number | null) => (id ? (grading?.jobNos[id] ?? options.inputs.find((b) => b.jobId === id)?.jobNo ?? null) : null);

  /** The buckets a line takes: a Job whole, or the loose No. Stok in part. */
  const takenOf = (l: Line) =>
    l.jobId
      ? options.inputs.filter((b) => b.jobId === l.jobId && b.unitId === unitId && b.qty > 0).map((b) => ({ b, qty: b.qty, grams: b.grams ?? 0 }))
      : (() => {
          const b = l.bucketId ? bucketOf.get(l.bucketId) : undefined;
          if (!b || !(b.qty > 0)) return [];
          const t = Math.min(Number(l.qty) || 0, b.qty);
          return [{ b, qty: t, grams: ((b.grams ?? 0) * t) / b.qty }];
        })();
  const storedGrams = (l: Line) => (posted ? posted.inputs.filter((i) => (l.jobId ? i.jobId === l.jobId : i.bucketId === l.bucketId)).reduce((a, i) => a + i.grams, 0) : null);
  const gramsIn = (l: Line) => storedGrams(l) ?? takenOf(l).reduce((a, t) => a + t.grams, 0);
  const gramsOut = (l: Line) => l.outputs.reduce((a, o) => a + (Number(o.grams) || 0), 0);
  /** A line is complete when it has results and they do not weigh more than it took. */
  const statusOf = (l: Line): [string, string] =>
    !l.outputs.length ? ["Belum ada hasil", "t-warn"] : gramsOut(l) > gramsIn(l) + 1e-9 ? ["Output melebihi", "t-bad"] : ["Lengkap", "t-ok"];
  const complete = lines.length > 0 && lines.every((l) => statusOf(l)[0] === "Lengkap");

  const first = lines.length ? (takenOf(lines[0])[0]?.b ?? (lines[0].bucketId ? bucketOf.get(lines[0].bucketId) : undefined)) : undefined;
  const partaiNo = first?.partaiNo ?? null;
  const partaiId = first?.partaiId ?? null;

  const setLine = (key: string, patch: Partial<Line>) => {
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
    touched();
  };

  const payload = () => ({
    unit_id: unitId,
    grading_date: date,
    note,
    employee_ids: workers,
    items: lines.map((l) => ({ job_id: l.jobId, bucket_id: l.jobId ? null : l.bucketId, qty: l.jobId ? "" : l.qty, outputs: l.outputs.map((o) => ({ item_id: o.item_id, grams: o.grams })) })),
    aux: aux.map((a) => ({ bucket_id: a.bucket_id, qty: a.qty })),
  });

  /** Simpan keeps a Draft and returns to the Unit; Posting saves and posts in one go (P286). */
  async function save(post: boolean) {
    setSaving(true);
    const result = await saveGradingAction(grading?.id ?? null, payload());
    if (!result.ok) {
      setSaving(false);
      setAsking(false);
      setErrors(result.errors);
      const bad = Object.keys(result.errors).find((k) => k.startsWith("items."));
      if (bad) setPopup(lines[Number(bad.split(".")[1])]?.key ?? null);
      toast(result.errors._form ? "Tidak diizinkan" : "Belum bisa disimpan", result.errors._form ?? result.errors._items ?? "Periksa kembali isian.", "err");
      return;
    }
    setDirty(false);
    if (!post) {
      setSaving(false);
      toast("No. Grading disimpan", `${result.no} · Draft`, "ok");
      router.push(backToUnit);
      return;
    }
    const done = await transitionGradingAction(result.id, "post", "");
    setSaving(false);
    setAsking(false);
    if (!done.ok) {
      toast("Draft disimpan, belum terposting", Object.values(done.errors)[0] ?? "Periksa kembali isian.", "err");
      router.push(`${GRADING_PATH}/${result.id}/edit`);
      return;
    }
    setPostedNo(result.no);
  }

  // ------------------------------------------------------------ pick
  const queue = options.inputs.filter((b) => b.unitId === unitId && b.qty > 0);
  const usedJobs = new Set(lines.flatMap((l) => (l.jobId ? [l.jobId] : [])));
  const usedBuckets = new Set(lines.flatMap((l) => (l.bucketId ? [l.bucketId] : [])));
  const choices = [
    ...[...new Map(queue.filter((b) => b.jobId && !usedJobs.has(b.jobId)).map((b) => [b.jobId!, b])).values()].map((b) => {
      const rows = queue.filter((x) => x.jobId === b.jobId);
      return { key: `j${b.jobId}`, jobNo: b.jobNo, lotNo: rows[0].lotNo, itemName: rows[0].itemName, count: rows.length, partaiId: b.partaiId, partaiNo: b.partaiNo, grams: rows.reduce((a, x) => a + (x.grams ?? 0), 0) };
    }),
    ...queue.filter((b) => !b.jobId && !usedBuckets.has(b.id)).map((b) => ({ key: `b${b.id}`, jobNo: null, lotNo: b.lotNo, itemName: b.itemName, count: 1, partaiId: b.partaiId, partaiNo: b.partaiNo, grams: b.grams ?? 0 })),
  ];
  /** One row from the input bar: a Job whole, or a No. Stok without a Job by the gram typed (all of it when empty). */
  function addLine(k: string, grams: number | null) {
    const b = k[0] === "j" ? undefined : bucketOf.get(Number(k.slice(1)));
    const qty = b ? (grams != null && b.grams ? (grams / b.grams) * b.qty : b.qty) : 0;
    const line: Line = { key: newKey(), jobId: k[0] === "j" ? Number(k.slice(1)) : null, bucketId: b?.id ?? null, qty: b ? String(Math.round(qty * 10_000) / 10_000) : "", outputs: [] };
    setLines((ls) => [...ls, line]);
    touched();
  }

  // ------------------------------------------------------------ the pop-up
  const cur = lines.find((l) => l.key === popup) ?? null;
  const curIndex = cur ? lines.indexOf(cur) : -1;
  const focusGram = () => setTimeout(() => gramBox.current?.querySelector("input")?.focus(), 0);
  useEffect(() => {
    if (popup && editing) focusGram();
  }, [popup, editing]);

  function addOutput(e: FormEvent) {
    e.preventDefault();
    if (!cur) return;
    if (!jenis) return setEntryError("Pilih Jenis.");
    if (!((Number(gram) || 0) > 0)) return setEntryError("Isi gram lebih dari 0.");
    setLine(cur.key, { outputs: [...cur.outputs, { key: newKey(), item_id: jenis, grams: gram }] });
    setGram("");
    setEntryError("");
    focusGram();
  }

  const lineError = (i: number) => errors[`items.${i}.job_id`] ?? errors[`items.${i}.bucket_id`] ?? errors[`items.${i}.qty`] ?? errors[`items.${i}.outputs`];
  const trackingOf = (lineIdx: number, outIdx: number) => {
    if (!grading) return null;
    const groupNo = [...new Set(grading.inputs.map((i) => i.groupNo))].sort((a, b) => a - b)[lineIdx];
    return grading.outputs.filter((o) => o.groupNo === groupNo)[outIdx]?.trackingNo ?? null;
  };
  const lineTitle = (l: Line) => (l.jobId ? (jobNoOf(l.jobId) ?? "No. Job") : (bucketOf.get(l.bucketId ?? 0)?.lotNo ?? "No. Stok"));
  const totals = lines.reduce((a, l) => ({ in: a.in + gramsIn(l), out: a.out + gramsOut(l) }), { in: 0, out: 0 });

  const popupBody = cur && (
    <>
      <div className="tw boxed">
        <table className="grid ltab" style={{ minWidth: 520 }}>
          <thead>
            <tr>
              <th style={{ width: 180 }}>No. Stok Input</th>
              <th>Item</th>
              <th style={{ width: 180 }}>Partai</th>
              <th className="num" style={{ width: 110 }}>
                Gram
              </th>
            </tr>
          </thead>
          <tbody>
            {takenOf(cur).map((t) => (
              <tr key={t.b.id}>
                <td className="mono">{t.b.lotNo}</td>
                <td>
                  {idc(t.b.itemLabel, t.b.itemName)}
                  {t.b.qcCheckId && <span className="bdg s-warn">Balik QC</span>}
                </td>
                <td className="mono">{t.b.partaiNo ?? <span className="dash">sebelum partai</span>}</td>
                <td className="num">{qtyText(t.grams)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editing && !cur.jobId && cur.bucketId && bucketOf.get(cur.bucketId) && (
        <div className="toolbar" style={{ padding: "10px 0 0", borderBottom: 0 }}>
          <span className="uw-hint">Tanpa No. Job, diambil sebagian:</span>
          <div style={{ width: 170 }}>
            <MoneyInput size="sm" decimals={4} value={cur.qty} over={(Number(cur.qty) || 0) > bucketOf.get(cur.bucketId)!.qty} ariaLabel="Jumlah diambil" onChange={(v) => setLine(cur.key, { qty: v })} />
          </div>
          <span className="uw-hint">dari {qtyText(bucketOf.get(cur.bucketId)!.qty)} {bucketOf.get(cur.bucketId)!.uomLabel}</span>
        </div>
      )}
      {cur.jobId && notes[cur.jobId]?.length ? (
        <p className="uw-hint" style={{ margin: "10px 0 0" }}>
          <b>Catatan Pre Cleaning:</b> {notes[cur.jobId].join(" · ")}
        </p>
      ) : null}
      <ErrorBox text={errors[`items.${curIndex}.outputs`]} />
      {editing && (
        <form className="toolbar" style={{ padding: "12px 0", borderBottom: 0 }} onSubmit={addOutput}>
          <div style={{ width: 300 }}>
            <Combobox
              value={jenis}
              options={refs(options.items)}
              placeholder="Pilih Jenis…"
              emptyText="Belum ada Barang dengan Kelola Stok."
              onChange={(v) => {
                setJenis(v);
                focusGram();
              }}
            />
          </div>
          <div style={{ width: 170 }} ref={gramBox}>
            <MoneyInput decimals={4} value={gram} disabled={!jenis} placeholder={jenis ? "0" : "Pilih Jenis dulu…"} ariaLabel="Gram hasil" onChange={(v) => setGram(v)} />
          </div>
          <button type="submit" className="btn primary" disabled={!jenis || !((Number(gram) || 0) > 0)}>
            <Icon name="plus" size={14} /> Tambah
          </button>
          <span className="uw-hint">{entryError || "Jenis tetap terpilih; ketik gram lalu Enter."}</span>
        </form>
      )}
      <div className="tw boxed">
        <table className="grid ltab" style={{ minWidth: 520 }}>
          <thead>
            <tr>
              <th style={{ width: 48 }}>No</th>
              <th>Jenis</th>
              <th style={{ width: 190 }}>No. Stok Baru</th>
              <th className="num" style={{ width: 120 }}>
                Gram
              </th>
              {editing && <th style={{ width: 40 }} />}
            </tr>
          </thead>
          <tbody>
            {/* Newest on top, as on the scale. */}
            {cur.outputs
              .map((o, i) => ({ o, i }))
              .reverse()
              .map(({ o, i }) => {
                const item = o.item_id ? itemOf.get(o.item_id) : undefined;
                const err = errors[`items.${curIndex}.outputs.${i}.item_id`] ?? errors[`items.${curIndex}.outputs.${i}.grams`];
                return (
                  <tr key={o.key} className={err ? "overrow" : undefined}>
                    <td className="no">{i + 1}</td>
                    <td>
                      {item ? idc(item.label, item.name) : null}
                      {item?.isBjl && <span className="bdg s-mute">BJL</span>}
                      {err && <span className="overtag">{err}</span>}
                    </td>
                    <td className="mono">{trackingOf(curIndex, i) ?? <span className="dash">saat Posting</span>}</td>
                    <td className="num">{qtyText(Number(o.grams))}</td>
                    {editing && (
                      <td>
                        <button className="iact del" title="Hapus hasil" onClick={() => setLine(cur.key, { outputs: cur.outputs.filter((x) => x.key !== o.key) })}>
                          <Icon name="trash" size={14} />
                        </button>
                      </td>
                    )}
                  </tr>
                );
              })}
            {cur.outputs.length === 0 && (
              <tr>
                <td colSpan={5} className="mut" style={{ textAlign: "center" }}>
                  Belum ada hasil. Pilih Jenis, ketik gram, lalu Enter.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="impact" style={{ marginTop: 12 }}>
        <div className="ir">
          <span>Diambil{cur.jobId ? " (utuh)" : ""}</span>
          <b>{qtyText(gramsIn(cur))} g</b>
        </div>
        <div className="ir">
          <span>Output · {cur.outputs.length} No. Stok baru</span>
          <b>{qtyText(gramsOut(cur))} g</b>
        </div>
        <div className="ir tot">
          <span>Susut</span>
          <b>{qtyText(gramsIn(cur) - gramsOut(cur))} g</b>
        </div>
      </div>
    </>
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
        onSave={() => save(false)}
        onPost={can.post ? () => setAsking(true) : undefined}
        postDisabled={!complete}
        backHref={backToUnit}
        unitLabel={unitLabel}
        unitTab="Grading"
        actions={
          grading && (
            <ProdDocActions
              workflow={GRADING_WORKFLOW}
              id={grading.id}
              subject={grading.no}
              status={grading.status}
              can={can}
              run={(action, reason) => transitionGradingAction(grading.id, action, reason)}
              doneHref={backToUnit}
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
                  <Field label="Unit" span={4} required={editing} locked={mode === "edit" || (lines.length > 0 && editing)} error={errors.unit_id}>
                    {editing && !lines.length ? (
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
                  <Field label="Tanggal" span={4} required={editing} error={errors.grading_date}>
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
                  <Field label="Partai" span={4}>
                    {partaiNo ? ro(<span className="mono">{partaiNo}</span>) : <div className="ro nil">{partaiId === null && lines.length ? "sebelum partai" : "mengikuti baris"}</div>}
                  </Field>
                  <Field label="Karyawan" span={12} help="opsional, boleh lebih dari satu" error={errors.employee_ids}>
                    {editing ? (
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        {options.employees.map((e) => {
                          const on = workers.includes(e.id);
                          return (
                            <button
                              key={e.id}
                              type="button"
                              className={`btn sm${on ? " primary" : ""}`}
                              aria-pressed={on}
                              onClick={() => {
                                setWorkers((w) => (on ? w.filter((x) => x !== e.id) : [...w, e.id]));
                                touched();
                              }}
                            >
                              {e.name}
                            </button>
                          );
                        })}
                        {!options.employees.length && <span className="uw-hint">Belum ada Karyawan aktif.</span>}
                      </div>
                    ) : workers.length ? (
                      ro(options.employees.filter((e) => workers.includes(e.id)).map((e) => e.name).join(", "))
                    ) : (
                      <div className="ro nil">tidak diisi</div>
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

          <div className="card" style={{ marginTop: 14 }}>
            <div className="card-h">
              <span className="ci">
                <Icon name="layers" size={15} />
              </span>
              <div className="ct">
                <h3>Job</h3>
                <p>
                  {lines.filter((l) => statusOf(l)[0] === "Lengkap").length} dari {lines.length} lengkap · {editing ? "pilih Job dulu, lalu klik barisnya untuk mengisi hasil grading" : "klik baris untuk melihat hasilnya"}
                </p>
              </div>
            </div>
            {editing && unitId && (
              <InputBar
                choices={choices.filter((c) => !lines.length || !partaiId || !c.partaiId || c.partaiId === partaiId)}
                partial={(c) => !c.jobNo}
                emptyText={`Tidak ada lagi yang menunggu di Persiapan Grading ${unit?.label ?? ""}.`}
                onAdd={addLine}
              />
            )}
            <ErrorBox text={errors._items} />
            {lines.length ? (
              <div className="tw">
                <table className="grid" style={{ minWidth: 860 }}>
                  <thead>
                    <tr>
                      <th style={{ width: 44 }}>No</th>
                      <th style={{ width: 190 }}>No. Job</th>
                      <th style={{ width: 150 }}>Isi</th>
                      <th>Item</th>
                      <th className="num" style={{ width: 96 }}>
                        Gram
                      </th>
                      <th className="num" style={{ width: 76 }}>
                        Output
                      </th>
                      <th className="num" style={{ width: 90 }}>
                        Susut
                      </th>
                      <th style={{ width: 150 }}>Status</th>
                      {editing && <th style={{ width: 40 }} />}
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((l, i) => {
                      const taken = takenOf(l);
                      const b = taken[0]?.b ?? (l.bucketId ? bucketOf.get(l.bucketId) : undefined);
                      const err = lineError(i);
                      const [st, tone] = statusOf(l);
                      const items = [...new Set(taken.map((t) => t.b.itemLabel))];
                      return (
                        <tr key={l.key} className={err ? "overrow" : undefined} onClick={() => setPopup(l.key)}>
                          <td className="no">{i + 1}</td>
                          <td>{l.jobId ? <span className="mono">{jobNoOf(l.jobId)}</span> : <span className="dash">Tanpa No. Job</span>}</td>
                          <td>{taken.length === 1 || !l.jobId ? <span className="mono">{b?.lotNo}</span> : `${taken.length} No. Stok`}</td>
                          <td>
                            {items.length === 1 && b ? idc(b.itemLabel, b.itemName) : items.join(", ")}
                            {b?.qcCheckId && <span className="bdg s-warn">Balik QC</span>}
                            {err && <span className="overtag">{err}</span>}
                          </td>
                          <td className="num">{qtyText(gramsIn(l))}</td>
                          <td className="num">{l.outputs.length}</td>
                          <td className="num">{l.outputs.length ? `${qtyText(gramsIn(l) - gramsOut(l))} g` : <span className="dash">—</span>}</td>
                          <td>
                            <span className={`bdg ${tone}`}>{st}</span>
                          </td>
                          {editing && (
                            <td onClick={(e) => e.stopPropagation()}>
                              <button
                                className="iact del"
                                title="Keluarkan baris"
                                onClick={() => {
                                  setLines((ls) => ls.filter((x) => x.key !== l.key));
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
                <h4>{unitId ? "Belum ada Job" : "Pilih Unit dulu…"}</h4>
                {unitId && <p>Pilih atau scan No. Job / No. Stok di baris input di atas, lalu Tambah. Ulangi untuk Job berikutnya.</p>}
              </div>
            )}
          </div>

          {lines.length > 0 && (
            <AuxCard
              rows={aux}
              options={options.aux.filter((b) => b.unitId === unitId || aux.some((a) => a.bucket_id === b.id))}
              editing={editing}
              errors={errors}
              noValue
              onChange={(r) => {
                setAux(r);
                touched();
              }}
            />
          )}

          {lines.length > 0 && (
            <div className="card" style={{ marginTop: 14, padding: 14 }}>
              <div className="impact">
                <div className="ttl">Ringkasan Gram · {lines.length} Job</div>
                <div className="ir">
                  <span>Diambil</span>
                  <b>{qtyText(totals.in)} g</b>
                </div>
                <div className="ir">
                  <span>Output</span>
                  <b>{qtyText(totals.out)} g</b>
                </div>
                <div className="ir tot">
                  <span>Susut</span>
                  <b>{qtyText(totals.in - totals.out)} g</b>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      <Dialog
        open={cur !== null}
        icon="layers"
        title={cur ? `Grading · ${lineTitle(cur)}` : ""}
        subtitle={cur ? `${takenOf(cur).length} No. Stok · ${qtyText(gramsIn(cur))} g${cur.jobId ? ", diambil utuh" : ""}${partaiNo ? ` · ${partaiNo}` : ""}` : undefined}
        width={780}
        onClose={() => setPopup(null)}
        foot={
          <button className="btn primary" onClick={() => setPopup(null)}>
            <Icon name="check" size={14} /> Selesai
          </button>
        }
      >
        {popupBody}
      </Dialog>

      <ConfirmDialog
        open={asking}
        icon="check"
        tone="brand"
        title="Posting No. Grading?"
        subject={unitLabel ?? undefined}
        body={`${lines.length} Job · ${qtyText(totals.in)} g diambil, ${qtyText(totals.out)} g menjadi No. Stok baru. Dokumen yang sudah diposting tidak dapat diubah.`}
        confirmLabel="Ya, Posting"
        busy={saving}
        onConfirm={() => save(true)}
        onCancel={() => setAsking(false)}
      />

      <PostedDialog
        no={postedNo}
        done="Selesai"
        again="Buat Lagi"
        onDone={() => router.push(backToUnit)}
        onAgain={unitLabel ? () => router.push(`${GRADING_PATH}/new?unit=${encodeURIComponent(unitLabel)}&n=${Date.now()}`) : undefined}
      />
    </>
  );
}

export type { BucketOption };
