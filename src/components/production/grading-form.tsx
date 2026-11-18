"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icon";
import { Combobox } from "@/components/ui/combobox";
import { DateInput } from "@/components/ui/date-input";
import { Field, FormBody, FormRow, FormSection } from "@/components/ui/form";
import { MoneyInput } from "@/components/ui/money-input";
import { useToast } from "@/components/ui/toast";
import { AuxCard, ErrorBox, ExecutionHeader, idc, newKey, qtyText, refs, ro, type AuxRow } from "@/components/production/execution-parts";
import { InputBar } from "@/components/production/input-bar";
import { ProdDocActions } from "@/components/production/production-doc-actions";
import { previewGradingAction, saveGradingAction, transitionGradingAction } from "@/app/actions/production-execution";
import { GRADING_PATH, GRADING_WORKFLOW } from "@/lib/erp/production-execution-workflow";
import type { ProdDocAbilities } from "@/lib/erp/production-doc-workflow";
import type { BucketOption } from "@/lib/erp/production-doc";
import type { GradingOptions, GradingView } from "@/lib/erp/production-grading";
import { formatDate, todayIso } from "@/lib/format";

/**
 * No. Grading in all three modes (W97, W107, T6). One document holds many Jobs,
 * each taken whole, or a No. Stok without a Job taken in part (W96); every line
 * has its own results, typed scale-style: the jenis stays chosen, gram, Enter
 * (W99). Opened from the Workspace it returns there on Batal and after Posting
 * (D4). No prices on the screen (P275).
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
  autoPost = false,
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
  /** The form's *Posting* just saved this Draft: open the confirmation (D2). */
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
  const [active, setActive] = useState<string | null>(lines[0]?.key ?? null);
  const [aux, setAux] = useState<AuxRow[]>(() => grading?.aux.map((a) => ({ key: newKey(), bucket_id: a.bucketId, qty: String(a.qty), job_id: null })) ?? []);
  const [jenis, setJenis] = useState<number | null>(null);
  const [gram, setGram] = useState("");
  const [entryError, setEntryError] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  const touched = () => {
    setDirty(true);
    setErrors({});
  };
  const unit = options.units.find((u) => u.id === unitId);
  const posted = grading?.status === "Posted" ? grading : null;
  const workspace = unit ? `/production/workspace/${encodeURIComponent(unit.label)}` : null;
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

  const cur = lines.find((l) => l.key === active) ?? null;
  const curIndex = cur ? lines.indexOf(cur) : -1;
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
    items: lines.map((l) => ({ job_id: l.jobId, bucket_id: l.jobId ? null : l.bucketId, qty: l.jobId ? "" : l.qty, outputs: l.outputs.map((o) => ({ item_id: o.item_id, grams: o.grams })) })),
    aux: aux.map((a) => ({ bucket_id: a.bucket_id, qty: a.qty })),
  });

  async function save(post: boolean) {
    setSaving(true);
    const result = await saveGradingAction(grading?.id ?? null, payload());
    setSaving(false);
    if (!result.ok) {
      setErrors(result.errors);
      const bad = Object.keys(result.errors).find((k) => k.startsWith("items."));
      if (bad) setActive(lines[Number(bad.split(".")[1])]?.key ?? active);
      toast(result.errors._form ? "Tidak diizinkan" : "Belum bisa disimpan", result.errors._form ?? result.errors._items ?? "Periksa kembali isian.", "err");
      return;
    }
    setDirty(false);
    if (!post) toast("No. Grading disimpan", `${result.no} · Draft`, "ok");
    router.push(`${GRADING_PATH}/${result.id}${post ? "?post=1" : ""}`);
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
    setActive(line.key);
    touched();
  }

  function addOutput(e: FormEvent) {
    e.preventDefault();
    if (!cur) return;
    if (!jenis) return setEntryError("Pilih Jenis.");
    if (!((Number(gram) || 0) > 0)) return setEntryError("Isi gram lebih dari 0.");
    setLine(cur.key, { outputs: [...cur.outputs, { key: newKey(), item_id: jenis, grams: gram }] });
    setGram("");
    setEntryError("");
  }

  const lineError = (i: number) => errors[`items.${i}.job_id`] ?? errors[`items.${i}.bucket_id`] ?? errors[`items.${i}.qty`] ?? errors[`items.${i}.outputs`];
  const curNotes = cur?.jobId ? notes[cur.jobId] : undefined;
  const perJenis = cur
    ? [...cur.outputs.reduce((m, o) => {
        if (!o.item_id) return m;
        const r = m.get(o.item_id) ?? { n: 0, grams: 0 };
        m.set(o.item_id, { n: r.n + 1, grams: r.grams + (Number(o.grams) || 0) });
        return m;
      }, new Map<number, { n: number; grams: number }>())]
    : [];
  const trackingOf = (lineIdx: number, outIdx: number) => {
    if (!grading) return null;
    const groupNo = [...new Set(grading.inputs.map((i) => i.groupNo))].sort((a, b) => a - b)[lineIdx];
    return grading.outputs.filter((o) => o.groupNo === groupNo)[outIdx]?.trackingNo ?? null;
  };

  const linesCard = (
    <div className="card" style={{ marginTop: 14 }}>
      <div className="card-h">
        <span className="ci">
          <Icon name="layers" size={15} />
        </span>
        <div className="ct">
          <h3>Job yang Digrading</h3>
          <p>{editing ? "Satu baris satu No. Job, diambil utuh; No. Stok tanpa Job boleh diambil sebagian. Klik baris untuk mengisi hasilnya." : "Isi dokumen menurut barisnya."}</p>
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
          <table className="grid ltab" style={{ minWidth: 760 }}>
            <thead>
              <tr>
                <th>No. Job / No. Stok</th>
                <th className="num" style={{ width: 200 }}>Diambil</th>
                <th className="num" style={{ width: 110 }}>Gram</th>
                <th className="num" style={{ width: 120 }}>Output (g)</th>
                {editing && <th style={{ width: 40 }} />}
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => {
                const taken = takenOf(l);
                const b = taken[0]?.b ?? (l.bucketId ? bucketOf.get(l.bucketId) : undefined);
                const jobNo = jobNoOf(l.jobId);
                const err = lineError(i);
                return (
                  <tr key={l.key} className={`${l.key === active ? "on" : ""}${err ? " overrow" : ""}`} onClick={() => setActive(l.key)}>
                    <td>
                      {l.jobId ? (
                        <div className="mono">
                          {jobNo} <span className="mut">· {taken.length || "—"} No. Stok</span>
                        </div>
                      ) : (
                        b && idc(b.lotNo, b.itemName)
                      )}
                      {b?.qcCheckId && <span className="bdg s-warn">Balik QC</span>}
                      {err && <span className="overtag">{err}</span>}
                    </td>
                    <td className="num" onClick={(e) => e.stopPropagation()}>
                      {editing && !l.jobId && b ? (
                        <div className="qcell">
                          <MoneyInput size="sm" decimals={4} value={l.qty} over={(Number(l.qty) || 0) > b.qty} ariaLabel="Jumlah diambil" onChange={(v) => setLine(l.key, { qty: v })} />
                          <span className="qu">{b.uomLabel}</span>
                        </div>
                      ) : l.jobId ? (
                        "utuh"
                      ) : (
                        `${qtyText(Number(l.qty) || 0)} ${b?.uomLabel ?? ""}`
                      )}
                    </td>
                    <td className="num">{qtyText(gramsIn(l))}</td>
                    <td className="num">{qtyText(gramsOut(l))}</td>
                    {editing && (
                      <td onClick={(e) => e.stopPropagation()}>
                        <button
                          className="iact del"
                          title="Keluarkan baris"
                          onClick={() => {
                            setLines((ls) => ls.filter((x) => x.key !== l.key));
                            if (active === l.key) setActive(lines.find((x) => x.key !== l.key)?.key ?? null);
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
          {unitId && <p>Pilih atau scan No. Job / No. Stok di baris input di atas, lalu Tambah.</p>}
        </div>
      )}
    </div>
  );

  const outputCard = cur && (
    <div className="card" style={{ marginTop: 14 }}>
      <div className="card-h">
        <span className="ci">
          <Icon name="tree" size={15} />
        </span>
        <div className="ct">
          <h3>Hasil Grading · {cur.jobId ? (jobNoOf(cur.jobId) ?? "No. Job") : (bucketOf.get(cur.bucketId ?? 0)?.lotNo ?? "No. Stok")}</h3>
          <p>Tiap hasil menjadi No. Stok baru dari No. Stok asal barisnya. Item BJL tetap tercatat gramnya.</p>
        </div>
      </div>
      <ErrorBox text={errors[`items.${curIndex}.outputs`]} />
      {editing && (
        <form className="toolbar" onSubmit={addOutput}>
          <div style={{ width: 300 }}>
            <Combobox size="sm" value={jenis} options={refs(options.items)} placeholder="Pilih Jenis…" emptyText="Belum ada Barang dengan Kelola Stok." onChange={(v) => setJenis(v)} />
          </div>
          <div style={{ width: 170 }}>
            <MoneyInput size="sm" decimals={4} value={gram} ariaLabel="Gram hasil" onChange={(v) => setGram(v)} />
          </div>
          <button type="submit" className="btn sm primary">
            <Icon name="plus" size={14} /> Tambah
          </button>
          <span className="uw-hint">{entryError || "Jenis tetap terpilih; isi gram lalu Enter."}</span>
        </form>
      )}
      <div className="tw">
        <table className="grid ltab" style={{ minWidth: 640 }}>
          <thead>
            <tr>
              <th style={{ width: 48 }}>No</th>
              <th>Jenis</th>
              <th style={{ width: 190 }}>No. Stok Baru</th>
              <th className="num" style={{ width: 150 }}>Gram</th>
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
                    <td className="mono">{trackingOf(curIndex, i) ?? <span className="dash">otomatis</span>}</td>
                    <td className="num">{qtyText(Number(o.grams))}</td>
                    {editing && (
                      <td>
                        <button className="iact del" title="Hapus baris" onClick={() => setLine(cur.key, { outputs: cur.outputs.filter((x) => x.key !== o.key) })}>
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
                  Belum ada hasil.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {curNotes?.length ? (
        <FormBody>
          <p className="fnote">
            <b>Catatan Pre Cleaning:</b> {curNotes.join(" · ")}
          </p>
        </FormBody>
      ) : null}
      <div className="uw-pair">
        <div className="impact">
          <div className="ttl">Per Jenis</div>
          {perJenis.length ? (
            perJenis.map(([id, r]) => (
              <div className="ir" key={id}>
                <span>
                  {itemOf.get(id)?.label} · {r.n} baris
                </span>
                <b>{qtyText(r.grams)} g</b>
              </div>
            ))
          ) : (
            <div className="ir">
              <span>Belum ada hasil</span>
              <b>—</b>
            </div>
          )}
        </div>
        <div className="impact">
          <div className="ttl">Gram</div>
          <div className="ir">
            <span>Diambil{cur.jobId ? " (utuh)" : ""}</span>
            <b>{qtyText(gramsIn(cur))} g</b>
          </div>
          <div className="ir">
            <span>Output</span>
            <b>{qtyText(gramsOut(cur))} g</b>
          </div>
          <div className="ir tot">
            <span>Susut</span>
            <b>{qtyText(gramsIn(cur) - gramsOut(cur))} g</b>
          </div>
        </div>
      </div>
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
        onSave={() => save(false)}
        onPost={can.post ? () => save(true) : undefined}
        backHref={grading ? `${GRADING_PATH}/${grading.id}` : (workspace ?? GRADING_PATH)}
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
          {linesCard}
          {outputCard}
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
        </div>
      </div>
    </>
  );
}

export type { BucketOption };
