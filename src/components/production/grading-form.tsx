"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
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
import type { BucketOption } from "@/lib/erp/production-doc";
import type { GradingOptions, GradingView } from "@/lib/erp/production-grading";
import { formatDate, formatPrice, todayIso } from "@/lib/format";

/**
 * No. Grading in all three modes (W97, W107). It takes one Job whole, or one No.
 * Stok without a Job in part (W96); the outputs are typed scale-style: the
 * jenis stays chosen, gram, Enter (W99). Opened from the Workspace it returns
 * there on Batal and after Posting (D4).
 */

type OutputRow = { key: string; item_id: number | null; grams: string };
type Taken = { b: BucketOption; qty: number; grams: number; value: number; cost: number };

export function GradingForm({
  mode,
  grading,
  options,
  notes,
  can,
  initialJobId,
  initialBucketId,
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
  /** The form's *Posting* just saved this Draft: open the confirmation (D2). */
  autoPost?: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const editing = mode !== "view";
  const opened = options.inputs.find((b) => (initialJobId ? b.jobId === initialJobId : b.id === initialBucketId));
  const [unitId, setUnitId] = useState<number | null>(grading?.unitId ?? opened?.unitId ?? (options.units.length === 1 ? options.units[0].id : null));
  const [date, setDate] = useState(grading?.date ?? todayIso());
  const [jobId, setJobId] = useState<number | null>(grading ? grading.jobId : (initialJobId ?? null));
  const [bucketId, setBucketId] = useState<number | null>(grading ? (grading.jobId ? null : (grading.inputs[0]?.bucketId ?? null)) : initialJobId ? null : (opened?.id ?? null));
  const [qty, setQty] = useState(grading && !grading.jobId ? String(grading.inputs[0]?.qty ?? "") : !initialJobId && opened ? String(opened.qty) : "");
  const [note, setNote] = useState(grading?.note ?? "");
  const [outputs, setOutputs] = useState<OutputRow[]>(() => grading?.outputs.map((o) => ({ key: newKey(), item_id: o.itemId, grams: String(o.grams) })) ?? []);
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
  const itemOf = new Map(options.items.map((i) => [i.id, i]));
  const bucketOf = new Map(options.inputs.map((b) => [b.id, b]));
  const unit = options.units.find((u) => u.id === unitId);
  const posted = grading?.status === "Posted" ? grading : null;
  const workspace = unit ? `/production/workspace/${encodeURIComponent(unit.label)}?tab=persiapan` : null;

  // What it takes: the stored figures once posted, else what the Unit holds now.
  const taken: Taken[] = posted
    ? posted.inputs.flatMap((i) => {
        const b = bucketOf.get(i.bucketId);
        return b ? [{ b, qty: i.qty, grams: i.grams, value: i.value, cost: i.cost }] : [];
      })
    : jobId
      ? options.inputs
          .filter((b) => b.jobId === jobId && b.unitId === unitId && b.qty > 0)
          .map((b) => ({ b, qty: b.qty, grams: b.grams ?? 0, value: b.value, cost: unitCost(b.grams ?? 0, b.rate ?? 0) }))
      : (() => {
          const b = bucketId ? bucketOf.get(bucketId) : undefined;
          if (!b || !(b.qty > 0)) return [];
          const t = Math.min(Number(qty) || 0, b.qty);
          const grams = ((b.grams ?? 0) * t) / b.qty;
          return [{ b, qty: t, grams, value: t >= b.qty ? b.value : Math.round((b.value * t) / b.qty), cost: unitCost(grams, b.rate ?? 0) }];
        })();
  const chosen = Boolean(jobId || bucketId);
  const first = taken[0]?.b;
  const jobNo = grading?.jobNo ?? first?.jobNo ?? null;
  const partaiNo = first?.partaiNo ?? null;
  const jobNotes = jobId ? notes[jobId] : undefined;
  const balikQc = taken.some((t) => t.b.qcCheckId);

  const payload = () => ({
    unit_id: unitId,
    grading_date: date,
    job_id: jobId,
    bucket_id: jobId ? null : bucketId,
    qty: jobId ? "" : qty,
    note,
    outputs: outputs.map((o) => ({ item_id: o.item_id, grams: o.grams })),
    aux: aux.map((a) => ({ bucket_id: a.bucket_id, qty: a.qty })),
  });

  async function save(post: boolean) {
    setSaving(true);
    const result = await saveGradingAction(grading?.id ?? null, payload());
    setSaving(false);
    if (!result.ok) {
      setErrors(result.errors);
      toast(result.errors._form ? "Tidak diizinkan" : "Belum bisa disimpan", result.errors._form ?? "Periksa kembali isian.", "err");
      return;
    }
    setDirty(false);
    if (!post) toast("No. Grading disimpan", `${result.no} · Draft`, "ok");
    router.push(`${GRADING_PATH}/${result.id}${post ? "?post=1" : ""}`);
  }

  // The figures: a preview while a Draft, what Posting stored once posted.
  const gramsIn = posted ? posted.grams : taken.reduce((a, t) => a + t.grams, 0);
  const inputValue = posted ? posted.inputValue : taken.reduce((a, t) => a + t.value, 0);
  const cost = posted ? posted.cost : taken.reduce((a, t) => a + t.cost, 0);
  const auxValue = posted
    ? posted.auxValue
    : aux.reduce((sum, a) => {
        const b = options.aux.find((x) => x.id === a.bucket_id);
        return sum + (b && b.qty > 0 ? Math.min(b.value, Math.round((b.value * (Number(a.qty) || 0)) / b.qty)) : 0);
      }, 0);
  const shares = outputs.map((o) => ({ grams: Number(o.grams) || 0, isBjl: (o.item_id && itemOf.get(o.item_id)?.isBjl) || false }));
  const share = shareGrading(Math.round(inputValue + cost + auxValue), shares);
  const values = posted ? posted.outputs.map((o) => o.value) : share.values;
  const scrap = posted ? posted.scrap : outputs.length ? share.scrap : 0;
  const gramsOut = shares.reduce((a, o) => a + o.grams, 0);
  const rate = posted ? posted.rate : (first?.rate ?? 0);

  // ------------------------------------------------------------ pick
  const queue = options.inputs.filter((b) => b.unitId === unitId && b.qty > 0);
  const jobs = [...new Map(queue.filter((b) => b.jobId).map((b) => [b.jobId!, b])).values()];
  const loose = queue.filter((b) => !b.jobId);
  const pick = (job: number | null, b: BucketOption | null) => {
    setJobId(job);
    setBucketId(b?.id ?? null);
    setQty(b ? String(b.qty) : "");
    touched();
  };
  const pickCard = editing && !chosen && (
    <div className="card" style={{ marginTop: 14 }}>
      <div className="card-h">
        <span className="ci">
          <Icon name="layers" size={15} />
        </span>
        <div className="ct">
          <h3>Persiapan Unit</h3>
          <p>Satu No. Job diambil utuh menjadi satu No. Grading. No. Stok tanpa Job boleh diambil sebagian.</p>
        </div>
      </div>
      <ErrorBox text={errors.job_id ?? errors.bucket_id} />
      {queue.length ? (
        <div className="tw">
          <table className="grid ltab" style={{ minWidth: 720 }}>
            <thead>
              <tr>
                <th>No. Job / No. Stok</th>
                <th style={{ width: 170 }}>Partai</th>
                <th className="num" style={{ width: 130 }}>
                  Gram
                </th>
                <th style={{ width: 110 }} />
              </tr>
            </thead>
            <tbody>
              {jobs.map((b) => {
                const rows = queue.filter((x) => x.jobId === b.jobId);
                return (
                  <tr key={`j${b.jobId}`}>
                    <td>
                      <span className="mono">{b.jobNo}</span> <span className="mut">· {rows.length} No. Stok</span>
                    </td>
                    <td className="mono">{b.partaiNo ?? "—"}</td>
                    <td className="num">{qtyText(rows.reduce((a, x) => a + (x.grams ?? 0), 0))}</td>
                    <td>
                      <button className="btn sm primary" onClick={() => pick(b.jobId, null)}>
                        Grading
                      </button>
                    </td>
                  </tr>
                );
              })}
              {loose.map((b) => (
                <tr key={b.id}>
                  <td>
                    {idc(b.lotNo, b.itemName)}
                    {b.qcCheckId && <span className="bdg s-warn">Balik QC</span>}
                  </td>
                  <td className="mono">{b.partaiNo ?? "—"}</td>
                  <td className="num">{qtyText(b.grams ?? 0)}</td>
                  <td>
                    <button className="btn sm primary" onClick={() => pick(null, b)}>
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

  // ------------------------------------------------------------ input
  const inputCard = chosen && (
    <div className="card" style={{ marginTop: 14 }}>
      <div className="card-h">
        <span className="ci">
          <Icon name="box" size={15} />
        </span>
        <div className="ct">
          <h3>No. Stok Diambil</h3>
          <p>{jobId ? `Isi No. Job ${jobNo ?? ""}, diambil utuh.` : "Tanpa No. Job: boleh diambil sebagian."}</p>
        </div>
        {mode === "new" && (
          <button className="btn sm" onClick={() => pick(null, null)}>
            Ganti
          </button>
        )}
      </div>
      <ErrorBox text={errors.job_id ?? errors.bucket_id} />
      <div className="tw">
        <table className="grid ltab" style={{ minWidth: 720 }}>
          <thead>
            <tr>
              <th>No. Stok</th>
              <th style={{ width: 170 }}>Partai</th>
              <th className="num" style={{ width: 190 }}>
                {jobId ? "Jumlah" : "Diambil"}
              </th>
              <th className="num" style={{ width: 130 }}>
                Gram
              </th>
              <th className="num" style={{ width: 150 }}>
                Nilai
              </th>
            </tr>
          </thead>
          <tbody>
            {taken.map((t) => (
              <tr key={t.b.id}>
                <td>
                  {idc(t.b.lotNo, t.b.itemName)}
                  {t.b.qcCheckId && <span className="bdg s-warn">Balik QC</span>}
                </td>
                <td className="mono">{t.b.partaiNo ?? "—"}</td>
                <td className="num">
                  {editing && !jobId ? (
                    <div className="qcell">
                      <MoneyInput
                        size="sm"
                        decimals={4}
                        value={qty}
                        over={(Number(qty) || 0) > t.b.qty}
                        ariaLabel="Jumlah diambil"
                        onChange={(v) => {
                          setQty(v);
                          touched();
                        }}
                      />
                      <span className="qu">{t.b.uomLabel}</span>
                    </div>
                  ) : (
                    `${qtyText(t.qty)} ${t.b.uomLabel}`
                  )}
                  {errors.qty && <span className="overtag">{errors.qty}</span>}
                </td>
                <td className="num">{qtyText(t.grams)}</td>
                <td className="num">
                  <span className="mny">{money(t.value)}</span>
                </td>
              </tr>
            ))}
            {!taken.length && (
              <tr>
                <td colSpan={5} className="mut" style={{ textAlign: "center" }}>
                  Barang ini tidak ada lagi di Persiapan unit ini.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {(balikQc || jobNotes?.length) && (
        <FormBody>
          {balikQc && (
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
      )}
    </div>
  );

  // ------------------------------------------------------------ outputs
  function addOutput(e: FormEvent) {
    e.preventDefault();
    if (!jenis) return setEntryError("Pilih Jenis.");
    if (!((Number(gram) || 0) > 0)) return setEntryError("Isi gram lebih dari 0.");
    setOutputs((o) => [...o, { key: newKey(), item_id: jenis, grams: gram }]);
    setGram("");
    setEntryError("");
    touched();
  }
  const perJenis = [...outputs.reduce((m, o) => {
    if (!o.item_id) return m;
    const r = m.get(o.item_id) ?? { n: 0, grams: 0 };
    m.set(o.item_id, { n: r.n + 1, grams: r.grams + (Number(o.grams) || 0) });
    return m;
  }, new Map<number, { n: number; grams: number }>())];
  const outputCard = (chosen || !editing) && (
    <div className="card" style={{ marginTop: 14 }}>
      <div className="card-h">
        <span className="ci">
          <Icon name="tree" size={15} />
        </span>
        <div className="ct">
          <h3>Hasil Grading</h3>
          <p>Tiap hasil menjadi No. Stok baru dari No. Stok asal Job. Item BJL bernilai 0, gramnya tetap tercatat.</p>
        </div>
      </div>
      <ErrorBox text={errors._outputs} />
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
        <table className="grid ltab" style={{ minWidth: 720 }}>
          <thead>
            <tr>
              <th style={{ width: 48 }}>No</th>
              <th>Jenis</th>
              <th style={{ width: 190 }}>No. Stok Baru</th>
              <th className="num" style={{ width: 150 }}>
                Gram
              </th>
              <th className="num" style={{ width: 150 }}>
                Nilai
              </th>
              {editing && <th style={{ width: 40 }} />}
            </tr>
          </thead>
          <tbody>
            {/* Newest on top, as on the scale. */}
            {outputs
              .map((o, i) => ({ o, i }))
              .reverse()
              .map(({ o, i }) => {
                const item = o.item_id ? itemOf.get(o.item_id) : undefined;
                const err = errors[`outputs.${i}.item_id`] ?? errors[`outputs.${i}.grams`];
                return (
                  <tr key={o.key} className={err ? "overrow" : undefined}>
                    <td className="no">{i + 1}</td>
                    <td>
                      {item ? idc(item.label, item.name) : null}
                      {item?.isBjl && <span className="bdg s-mute">BJL</span>}
                      {err && <span className="overtag">{err}</span>}
                    </td>
                    <td className="mono">{grading?.outputs[i]?.trackingNo ?? <span className="dash">otomatis</span>}</td>
                    <td className="num">{qtyText(Number(o.grams))}</td>
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
                  Belum ada hasil.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
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
            <span>Diambil{jobId ? " (utuh)" : ""}</span>
            <b>{qtyText(gramsIn)} g</b>
          </div>
          <div className="ir">
            <span>Output</span>
            <b>{qtyText(gramsOut)} g</b>
          </div>
          <div className="ir tot">
            <span>Susut</span>
            <b>{qtyText(gramsIn - gramsOut)} g</b>
          </div>
        </div>
      </div>
    </div>
  );

  // ------------------------------------------------------------ value
  const valueCard = (chosen || !editing) && (
    <div className="card" style={{ marginTop: 14, padding: 14 }}>
      <div className="impact">
        <div className="ttl">Nilai</div>
        <div className="ir">
          <span>Nilai input</span>
          <b>{money(inputValue)}</b>
        </div>
        <div className="ir">
          <span>
            Biaya unit ({qtyText(gramsIn)} g × {formatPrice(rate)}/g)
          </span>
          <b>{money(cost)}</b>
        </div>
        <div className="ir">
          <span>Bahan penolong</span>
          <b>{money(auxValue)}</b>
        </div>
        {scrap > 0 && (
          <div className="ir">
            <span>Ke Beban Pemusnahan</span>
            <b>{money(scrap)}</b>
          </div>
        )}
        <div className="ir tot">
          <span>Dibagi ke output</span>
          <b>{money(inputValue + cost + auxValue - scrap)}</b>
        </div>
      </div>
      {scrap > 0 && (
        <p className="fnote">
          <b>Semua output BJL:</b> nilainya masuk Beban Pemusnahan Produksi saat Posting.
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
                  <Field label="Unit" span={3} required={editing} locked={mode === "edit" || (chosen && editing)} error={errors.unit_id}>
                    {editing && !chosen ? (
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
                  <Field label="No. Job" span={3}>
                    {jobNo ? ro(<span className="mono">{jobNo}</span>) : <div className="ro nil">tanpa No. Job</div>}
                  </Field>
                  <Field label="Partai" span={3}>
                    {partaiNo ? ro(<span className="mono">{partaiNo}</span>) : <div className="ro nil">sebelum partai</div>}
                  </Field>
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
          {(chosen || !editing) && (
            <AuxCard
              rows={aux}
              options={options.aux.filter((b) => b.unitId === unitId || aux.some((a) => a.bucket_id === b.id))}
              editing={editing}
              errors={errors}
              values={posted ? posted.aux.map((a) => a.value) : undefined}
              onChange={(r) => {
                setAux(r);
                touched();
              }}
            />
          )}
          {valueCard}
        </div>
      </div>
    </>
  );
}
