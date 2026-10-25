"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icon";
import { CancelButton } from "@/components/ui/cancel-button";
import { Combobox } from "@/components/ui/combobox";
import { DateInput } from "@/components/ui/date-input";
import { Field, FormBody, FormRow, FormSection } from "@/components/ui/form";
import { MoneyInput } from "@/components/ui/money-input";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { RunActions } from "@/components/production/run-actions";
import { createRunAction, updateRunAction } from "@/app/actions/production-run";
import {
  EXECUTION_KIND_TEXT,
  EXECUTION_OUTPUT_STATUS_TEXT,
  EXECUTION_STATUS_BADGE,
  EXECUTION_STATUS_TEXT,
  kindsOfMode,
  type ExecutionAbilities,
  type ExecutionKind,
  type ExecutionOutputStatus,
} from "@/lib/erp/production-run-workflow";
import type { RunHeaderInput, RunOptions, RunView } from "@/lib/erp/production-run";
import { formatDate, formatMoney, formatNumber, todayIso } from "@/lib/format";

/**
 * An Eksekusi Produksi in all three modes: `new`, `edit` (Draft only) and `view`
 * (Walet step 5, P169, M114). The user names the workstation, the kind — its Cara
 * Kerja decides which — and the day, then one **section per Job**: the goods
 * worked (received at the station, any quantity they hold) and what comes out.
 *
 * - **Transformasi**: free outputs, each a new lot (the number optional — one is
 *   generated), a status *Tersedia* or *Reject* (a Reject takes no cost and stays
 *   in production), an expiry where the item keeps one.
 * - **Pass-through**: the main input — taken whole — keeps its lot; extra inputs
 *   (a box) join it; the quantity out is free, the difference shown as susut or
 *   tambahan.
 * - **Mix**: the whole Partai becomes one lot; the item is chosen.
 *
 * The **Driver** is typed per section — it is what the station's standard runs
 * on. No price is typed anywhere: the value follows the goods; Posting shows the
 * journal.
 */

export type RunMode = "new" | "edit" | "view";

type InState = { key: string; bucket_id: number | null; qty: string; is_main: boolean };
type OutState = { key: string; item_id: number | null; qty: string; lot_no: string; expiry_date: string; status: ExecutionOutputStatus };
type SecState = { key: string; driver: string; inputs: InState[]; outputs: OutState[] };

let seq = 0;
const newKey = () => `e${Date.now().toString(36)}${seq++}`;
const qtyText = (n: number) => formatNumber(n, n % 1 ? 2 : 0);
const num = (v: string) => Number(String(v).replace(",", ".")) || 0;
const blankIn = (): InState => ({ key: newKey(), bucket_id: null, qty: "", is_main: false });
const blankOut = (): OutState => ({ key: newKey(), item_id: null, qty: "", lot_no: "", expiry_date: "", status: "Available" });
const blankSection = (): SecState => ({ key: newKey(), driver: "", inputs: [blankIn()], outputs: [] });

export function RunForm({ mode, run, options, can }: { mode: RunMode; run: RunView | null; options: RunOptions; can: ExecutionAbilities }) {
  const router = useRouter();
  const toast = useToast();
  const editing = mode !== "view";
  const bucketById = useMemo(() => new Map(options.buckets.map((b) => [b.id, b])), [options.buckets]);
  const itemById = useMemo(() => new Map(options.items.map((i) => [i.id, i])), [options.items]);

  const [header, setHeader] = useState<RunHeaderInput>(() => (run ? { ...run.header } : { execution_date: todayIso(), kind: null, workstation_id: null, note: "" }));
  const [sections, setSections] = useState<SecState[]>(() =>
    run
      ? run.sections.map((s) => ({
          key: newKey(),
          driver: String(s.driver),
          inputs: s.inputs.map((x) => ({ key: newKey(), bucket_id: Number(x.bucket_id), qty: String(x.qty), is_main: Boolean(x.is_main) })),
          outputs: s.outputs.map((o) => ({ key: newKey(), item_id: Number(o.item_id), qty: String(o.qty), lot_no: o.lot_no, expiry_date: o.expiry_date, status: o.status })),
        }))
      : []
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  const status = run?.status ?? "Draft";
  const station = options.workstations.find((w) => w.id === header.workstation_id);
  const kinds = station ? kindsOfMode(station.mode) : [];
  const kind = header.kind;
  /** What the station holds, received and workable: the only goods a run takes. */
  const held = useMemo(() => options.buckets.filter((b) => !b.inTransit && !b.isReject && b.qty > 0 && b.workstationId === header.workstation_id), [options.buckets, header.workstation_id]);

  const touch = (...names: string[]) => {
    setDirty(true);
    setErrors((e) => {
      const next = { ...e };
      for (const n of names) delete next[n];
      return next;
    });
  };
  const set = <K extends keyof RunHeaderInput>(k: K, v: RunHeaderInput[K]) => {
    setHeader((x) => ({ ...x, [k]: v }));
    touch(k);
  };
  const patchSection = (key: string, fn: (s: SecState) => SecState) => {
    setSections((ss) => ss.map((s) => (s.key === key ? fn(s) : s)));
    touch("_sections");
  };
  const pickStation = (id: number | null) => {
    const ws = options.workstations.find((w) => w.id === id);
    const allowed = ws ? kindsOfMode(ws.mode) : [];
    setHeader((x) => ({ ...x, workstation_id: id, kind: allowed.length === 1 ? allowed[0] : null }));
    setSections([]);
    touch("workstation_id", "kind", "_sections");
  };
  const pickKind = (k: ExecutionKind) => {
    set("kind", k);
    setSections([]);
  };

  /** Puts the station's goods on the page the way this kind takes them: a section per Job, per lot, or the whole Partai. */
  const fillAll = () => {
    if (!kind) return;
    const groups = new Map<string, typeof held>();
    for (const b of held) groups.set(kind === "Mix" ? `p${b.partaiId ?? 0}` : kind === "PassThrough" ? `b${b.id}` : `j${b.jobId ?? 0}`, [...(groups.get(kind === "Mix" ? `p${b.partaiId ?? 0}` : kind === "PassThrough" ? `b${b.id}` : `j${b.jobId ?? 0}`) ?? []), b]);
    let list = [...groups.values()];
    if (kind === "Mix") list = list.filter((g) => g[0].partaiId != null).slice(0, 1);
    setSections(
      list.map((g) => ({
        key: newKey(),
        driver: kind === "Mix" ? "0" : String(g.reduce((s, b) => s + b.qty, 0)),
        inputs: g.map((b, i) => ({ key: newKey(), bucket_id: b.id, qty: String(b.qty), is_main: kind === "PassThrough" && i === 0 })),
        outputs:
          kind === "PassThrough"
            ? [{ ...blankOut(), item_id: g[0].itemId, qty: String(g[0].qty) }]
            : kind === "Mix"
              ? [{ ...blankOut(), qty: String(g.reduce((s, b) => s + b.qty, 0)) }]
              : [],
      }))
    );
    touch("_sections");
  };

  async function onSave() {
    setSaving(true);
    const sent = sections;
    const payload = sent.map((s) => ({
      driver: s.driver || "0",
      inputs: s.inputs.map((x) => ({ bucket_id: x.bucket_id, qty: x.qty, is_main: x.is_main })),
      outputs: s.outputs.map((o) => ({ item_id: o.item_id, qty: o.qty, lot_no: o.lot_no, expiry_date: o.expiry_date, status: o.status })),
    }));
    const result = mode === "edit" ? await updateRunAction(run!.id, header, payload) : await createRunAction(header, payload);
    setSaving(false);
    if (!result.ok) {
      const mapped: Record<string, string> = {};
      for (const [k, v] of Object.entries(result.errors)) {
        const m = /^sections\.(\d+)\.(inputs|outputs)\.(\d+)\.(\w+)$/.exec(k);
        const s = /^sections\.(\d+)\.(\w+)$/.exec(k);
        if (m) {
          const sec = sent[Number(m[1])];
          const row = (m[2] === "inputs" ? sec?.inputs : sec?.outputs)?.[Number(m[3])];
          mapped[`S.${sec?.key}.${m[2]}.${row?.key}.${m[4]}`] = v;
        } else if (s) mapped[`S.${sent[Number(s[1])]?.key}.${s[2]}`] = v;
        else mapped[k] = v;
      }
      setErrors(mapped);
      toast(result.errors._form ? "Tidak diizinkan" : "Belum bisa disimpan", result.errors._form ?? result.errors._sections ?? "Periksa kembali isian.", "err");
      return;
    }
    setDirty(false);
    toast("Eksekusi disimpan", `${result.executionNo} · Draft`, "ok");
    router.push(`/production/execution/${result.id}`);
  }

  const backHref = run ? `/production/execution/${run.id}` : "/production/execution";
  const ro = (node: React.ReactNode) => <div className="ro">{node}</div>;
  const nil = (t = "tidak diisi") => <div className="ro nil">{t}</div>;
  const bucketOptions = held.map((b) => ({ id: b.id, label: b.itemLabel, name: `lot ${b.lotNo}${b.jobNo ? ` · ${b.jobNo}` : ""}${b.partaiNo ? ` · ${b.partaiNo}` : ""} · ${qtyText(b.qty)}`, active: true }));

  // ======================================================= header card
  const headerCard = (
    <div className="card">
      <FormBody>
        <FormSection title="Eksekusi">
          <FormRow>
            <Field label="Workstation" span={4} required={editing} help={editing ? "tempat barang dikerjakan" : undefined} error={errors.workstation_id}>
              {editing ? (
                <Combobox
                  value={header.workstation_id}
                  options={options.workstations.filter((w) => w.active || w.id === header.workstation_id)}
                  placeholder="Pilih Workstation…"
                  invalid={Boolean(errors.workstation_id)}
                  onChange={pickStation}
                />
              ) : station ? (
                ro(
                  <>
                    <span className="lab">{station.label}</span>
                    <span>{station.name}</span>
                  </>
                )
              ) : (
                nil()
              )}
            </Field>
            <Field label="Jenis" span={4} required={editing} help={editing ? "menurut Cara Kerja workstation" : undefined} error={errors.kind}>
              {editing ? (
                <Select
                  value={kind ?? ""}
                  options={kinds.map((k) => ({ value: k, label: EXECUTION_KIND_TEXT[k] }))}
                  waitingFor={station ? null : "Pilih Workstation dulu…"}
                  placeholder="Pilih jenis…"
                  invalid={Boolean(errors.kind)}
                  onChange={(v) => pickKind(v as ExecutionKind)}
                />
              ) : (
                ro(kind ? EXECUTION_KIND_TEXT[kind] : "")
              )}
            </Field>
            <Field label="Tanggal" span={4} required={editing} help={editing ? "hari barang dikerjakan" : undefined} error={errors.execution_date}>
              {editing ? <DateInput value={header.execution_date} invalid={Boolean(errors.execution_date)} onChange={(v) => set("execution_date", v)} /> : ro(formatDate(header.execution_date))}
            </Field>
          </FormRow>
          <FormRow>
            {run && status === "Posted" && (
              <>
                <Field label="Partai" span={4}>
                  {run.partaiNo ? ro(<span className="mono">{run.partaiNo}</span>) : nil("belum ada Partai")}
                </Field>
                <Field label="Journal" span={4}>
                  {run.journalId ? (
                    ro(
                      <Link className="drl" href={`/accounting/journal/${run.journalId}`}>
                        <span className="mono">{run.journalNo}</span>
                      </Link>
                    )
                  ) : (
                    nil("tanpa biaya standar, tanpa journal")
                  )}
                </Field>
                <Field label="Biaya Standar" span={4}>
                  {ro(<span className="mny">{formatMoney(run.standard, "IDR")}</span>)}
                </Field>
              </>
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
        {run?.cancelReason && status === "Cancelled" && (
          <p className="fnote">
            <b>Dibatalkan:</b> {run.cancelReason}
          </p>
        )}
      </FormBody>
    </div>
  );

  // ====================================================== a section card
  const sectionCard = (s: SecState, idx: number) => {
    const posted = run && status === "Posted" ? run.posted[idx] : null;
    const err = (k: string) => errors[`S.${s.key}.${k}`];
    const inErr = (row: InState, f: string) => errors[`S.${s.key}.inputs.${row.key}.${f}`];
    const outErr = (row: OutState, f: string) => errors[`S.${s.key}.outputs.${row.key}.${f}`];
    const jobNo = posted?.jobNo ?? s.inputs.map((x) => (x.bucket_id ? bucketById.get(x.bucket_id)?.jobNo : null)).find(Boolean) ?? null;
    const main = s.inputs.find((x) => x.is_main);
    const mainBucket = main?.bucket_id ? bucketById.get(main.bucket_id) : undefined;
    const outQty = num(s.outputs[0]?.qty ?? "");
    const diff = kind === "PassThrough" && mainBucket ? outQty - num(main!.qty) : 0;
    const setInput = (key: string, patch: Partial<InState>) =>
      patchSection(s.key, (x) => ({ ...x, inputs: x.inputs.map((r) => (r.key === key ? { ...r, ...patch } : r)) }));
    const setOutput = (key: string, patch: Partial<OutState>) =>
      patchSection(s.key, (x) => ({ ...x, outputs: x.outputs.map((r) => (r.key === key ? { ...r, ...patch } : r)) }));
    const cost = (n: number) => <span className="mny">{formatMoney(n, "IDR")}</span>;

    return (
      <div key={s.key} className="card" style={{ marginTop: 14 }}>
        <div className="card-h">
          <span className="ci">
            <Icon name="layers" size={15} />
          </span>
          <div className="ct">
            <h3>
              Section {idx + 1}
              {jobNo && (
                <>
                  {" · "}
                  <span className="mono">{jobNo}</span>
                </>
              )}
            </h3>
            <p>
              {kind === "PassThrough"
                ? "Barang utama diambil utuh dan lotnya tetap; barang tambahan (kemasan) ikut masuk; jumlah keluar bebas."
                : kind === "Mix"
                  ? "Seluruh barang Partai di workstation menjadi satu lot, tanpa Job dan tanpa biaya standar."
                  : "Barang yang dikerjakan menjadi output; nilainya dibagi menurut Bobot Biaya (qty × bobot nilai), BJL dan Reject 0."}
            </p>
          </div>
          {kind !== "Mix" && (
            <div style={{ width: 190 }}>
              {editing ? (
                <div className="qcell" title="Driver: angka yang dikalikan tarif biaya standar workstation">
                  <MoneyInput size="sm" decimals={4} value={s.driver} ariaLabel={`Driver section ${idx + 1}`} placeholder="Driver" onChange={(v) => patchSection(s.key, (x) => ({ ...x, driver: v }))} />
                  <span className="qu">driver</span>
                </div>
              ) : (
                <span className="d2">
                  driver {qtyText(num(s.driver))} · standar {cost(posted?.standard ?? 0)}
                </span>
              )}
            </div>
          )}
          {editing && (
            <button
              className="iact del"
              title="Hapus section"
              onClick={() => {
                setSections((ss) => ss.filter((x) => x.key !== s.key));
                touch("_sections");
              }}
            >
              <Icon name="trash" size={14} />
            </button>
          )}
        </div>
        {(err("inputs") || err("outputs") || err("driver")) && (
          <div className="nbox bad slim">
            <Icon name="warn" size={15} className="ni" />
            <div>
              <b>{err("inputs") ?? err("outputs") ?? err("driver")}</b>
            </div>
          </div>
        )}

        <div className="tw">
          <table className="grid ltab" style={{ minWidth: 760 }}>
            <thead>
              <tr>
                <th style={{ width: 40 }}>No</th>
                <th>Input</th>
                <th style={{ width: 200 }}>Qty</th>
                {kind === "PassThrough" && <th style={{ width: 90 }}>Utama</th>}
                {posted && (
                  <th className="num" style={{ width: 150 }}>
                    Nilai
                  </th>
                )}
                {editing && <th style={{ width: 40 }} />}
              </tr>
            </thead>
            <tbody>
              {s.inputs.map((x, j) => {
                const b = x.bucket_id ? bucketById.get(x.bucket_id) : undefined;
                const stored = posted?.inputs[j];
                const e = inErr(x, "bucket_id") ?? inErr(x, "qty");
                return (
                  <tr key={x.key} className={e ? "overrow" : undefined}>
                    <td className="no">{j + 1}</td>
                    <td>
                      {editing ? (
                        <Combobox
                          size="sm"
                          value={x.bucket_id}
                          options={bucketOptions}
                          placeholder="Pilih barang…"
                          emptyText="Workstation ini tidak memegang barang yang diterima."
                          invalid={Boolean(inErr(x, "bucket_id"))}
                          onChange={(v) => {
                            const nb = v ? bucketById.get(v) : undefined;
                            setInput(x.key, { bucket_id: v, qty: nb ? String(nb.qty) : "" });
                          }}
                        />
                      ) : (
                        <span className="idc">
                          <span className="lab">{stored?.itemLabel ?? b?.itemLabel}</span>
                          <span className="nm">lot {stored?.lotNo ?? b?.lotNo}</span>
                        </span>
                      )}
                      {e && <span className="overtag">{e}</span>}
                    </td>
                    <td>
                      {editing ? (
                        <>
                          <div className="qcell">
                            <MoneyInput size="sm" decimals={6} value={x.qty} ariaLabel={`Qty input ${j + 1}`} onChange={(v) => setInput(x.key, { qty: v })} />
                          </div>
                          {b && <span className="fulltag">saldo {qtyText(b.qty)}</span>}
                        </>
                      ) : (
                        <span className="qview">
                          <span className="mny">{qtyText(num(x.qty))}</span>
                        </span>
                      )}
                    </td>
                    {kind === "PassThrough" && (
                      <td>
                        {editing ? (
                          <button
                            className={`btn sm${x.is_main ? " primary" : ""}`}
                            aria-pressed={x.is_main}
                            aria-label={`Barang utama ${j + 1}`}
                            onClick={() =>
                              patchSection(s.key, (sec) => ({
                                ...sec,
                                inputs: sec.inputs.map((r) => ({ ...r, is_main: r.key === x.key })),
                                outputs: [{ ...(sec.outputs[0] ?? blankOut()), item_id: b?.itemId ?? null, qty: b ? String(b.qty) : "" }],
                              }))
                            }
                          >
                            Utama
                          </button>
                        ) : x.is_main ? (
                          <span className="bdg s-ok">Utama</span>
                        ) : (
                          <span className="dash">—</span>
                        )}
                      </td>
                    )}
                    {posted && <td className="num">{cost(stored?.cost ?? 0)}</td>}
                    {editing && (
                      <td>
                        <button
                          className="iact del"
                          title="Hapus baris"
                          onClick={() => patchSection(s.key, (sec) => ({ ...sec, inputs: sec.inputs.filter((r) => r.key !== x.key) }))}
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
        {editing && (
          <div style={{ padding: "0 14px 10px" }}>
            <button className="btn sm" onClick={() => patchSection(s.key, (sec) => ({ ...sec, inputs: [...sec.inputs, blankIn()] }))}>
              <Icon name="plus" size={14} /> {kind === "PassThrough" ? "Tambah Barang Tambahan" : "Tambah Input"}
            </button>
          </div>
        )}

        <div className="tw">
          <table className="grid ltab" style={{ minWidth: 860 }}>
            <thead>
              <tr>
                <th style={{ width: 40 }}>No</th>
                <th>Output</th>
                <th style={{ width: 200 }}>Qty</th>
                {kind !== "PassThrough" && <th style={{ width: 170 }}>No. Lot</th>}
                {kind === "Transform" && <th style={{ width: 130 }}>Status</th>}
                {kind !== "PassThrough" && <th style={{ width: 130 }}>Kadaluarsa</th>}
                {posted && (
                  <>
                    <th className="num" style={{ width: 110 }}>
                      Bobot
                    </th>
                    <th className="num" style={{ width: 150 }}>
                      Nilai
                    </th>
                  </>
                )}
                {editing && kind === "Transform" && <th style={{ width: 40 }} />}
              </tr>
            </thead>
            <tbody>
              {s.outputs.length === 0 && (
                <tr>
                  <td colSpan={9} className="dash" style={{ padding: 12 }}>
                    {kind === "PassThrough" ? "Tandai barang utama di atas." : "Belum ada output."}
                  </td>
                </tr>
              )}
              {s.outputs.map((o, j) => {
                const item = o.item_id ? itemById.get(o.item_id) : undefined;
                const stored = posted?.outputs[j];
                const e = outErr(o, "item_id") ?? outErr(o, "qty") ?? outErr(o, "expiry_date");
                return (
                  <tr key={o.key} className={e ? "overrow" : undefined}>
                    <td className="no">{j + 1}</td>
                    <td>
                      {editing && kind !== "PassThrough" ? (
                        <Combobox
                          size="sm"
                          value={o.item_id}
                          options={options.items.filter((i) => i.active || i.id === o.item_id)}
                          placeholder="Pilih Barang…"
                          emptyText="Belum ada Barang dengan Kelola Stok."
                          invalid={Boolean(outErr(o, "item_id"))}
                          onChange={(v) => setOutput(o.key, { item_id: v })}
                        />
                      ) : (
                        <span className="idc">
                          <span className="lab">{stored?.itemLabel ?? item?.label}</span>
                          <span className="nm">{stored?.itemName ?? item?.name}</span>
                        </span>
                      )}
                      {item?.outputType && <span className="d2"> {item.outputType}</span>}
                      {e && <span className="overtag">{e}</span>}
                    </td>
                    <td>
                      {editing ? (
                        <>
                          <div className="qcell">
                            <MoneyInput size="sm" decimals={6} value={o.qty} ariaLabel={`Qty output ${j + 1}`} onChange={(v) => setOutput(o.key, { qty: v })} />
                            <span className="qu">{item?.uomLabel}</span>
                          </div>
                          {kind === "PassThrough" && mainBucket && diff !== 0 && (
                            <span className={diff < 0 ? "overtag" : "fulltag"}>
                              {diff < 0 ? `susut ${qtyText(-diff)}` : `tambahan ${qtyText(diff)}`}
                            </span>
                          )}
                        </>
                      ) : (
                        <span className="qview">
                          <span className="mny">{qtyText(num(o.qty))}</span>
                          <span className="lab">{item?.uomLabel}</span>
                        </span>
                      )}
                    </td>
                    {kind !== "PassThrough" && (
                      <td>
                        {editing ? (
                          <input className="inp mono" value={o.lot_no} placeholder="otomatis" aria-label={`No. lot output ${j + 1}`} onChange={(ev) => setOutput(o.key, { lot_no: ev.target.value })} />
                        ) : (
                          <span className="mono">{stored?.lotNo ?? o.lot_no}</span>
                        )}
                      </td>
                    )}
                    {kind === "Transform" && (
                      <td>
                        {editing ? (
                          <Select
                            size="sm"
                            value={o.status}
                            options={(["Available", "Reject"] as ExecutionOutputStatus[]).map((v) => ({ value: v, label: EXECUTION_OUTPUT_STATUS_TEXT[v] }))}
                            onChange={(v) => setOutput(o.key, { status: v as ExecutionOutputStatus })}
                          />
                        ) : (
                          <span className={`bdg ${o.status === "Reject" ? "s-bad" : "s-ok"}`}>{EXECUTION_OUTPUT_STATUS_TEXT[o.status]}</span>
                        )}
                      </td>
                    )}
                    {kind !== "PassThrough" && (
                      <td>
                        {item?.hasExpiry ? (
                          editing ? (
                            <DateInput value={o.expiry_date} invalid={Boolean(outErr(o, "expiry_date"))} onChange={(v) => setOutput(o.key, { expiry_date: v })} />
                          ) : (
                            formatDate(o.expiry_date)
                          )
                        ) : (
                          <span className="dash">—</span>
                        )}
                      </td>
                    )}
                    {posted && (
                      <>
                        <td className="num">
                          <span className="mny">{qtyText(stored?.weight ?? 0)}</span>
                        </td>
                        <td className="num">{cost(stored?.cost ?? 0)}</td>
                      </>
                    )}
                    {editing && kind === "Transform" && (
                      <td>
                        <button className="iact del" title="Hapus baris" onClick={() => patchSection(s.key, (sec) => ({ ...sec, outputs: sec.outputs.filter((r) => r.key !== o.key) }))}>
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
        {editing && kind === "Transform" && (
          <div style={{ padding: "0 14px 10px" }}>
            <button className="btn sm" onClick={() => patchSection(s.key, (sec) => ({ ...sec, outputs: [...sec.outputs, blankOut()] }))}>
              <Icon name="plus" size={14} /> Tambah Output
            </button>
          </div>
        )}
        {editing && kind === "Mix" && s.outputs.length === 0 && (
          <div style={{ padding: "0 14px 10px" }}>
            <button
              className="btn sm"
              onClick={() => patchSection(s.key, (sec) => ({ ...sec, outputs: [{ ...blankOut(), qty: String(sec.inputs.reduce((t, r) => t + num(r.qty), 0)) }] }))}
            >
              <Icon name="plus" size={14} /> Tambah Output
            </button>
          </div>
        )}
      </div>
    );
  };

  // ============================================================ page
  const costsCard =
    run && status === "Posted" && run.costs.length > 0 ? (
      <div className="card" style={{ marginTop: 14 }}>
        <div className="card-h">
          <span className="ci">
            <Icon name="coin" size={15} />
          </span>
          <div className="ct">
            <h3>Biaya Standar</h3>
            <p>round(Driver × tarif) per Standard Cost Item, dibukukan ke WIP; Cr akun item dengan Cost Center workstation.</p>
          </div>
        </div>
        <div className="tw">
          <table className="grid" style={{ minWidth: 640 }}>
            <thead>
              <tr>
                <th>Standard Cost Item</th>
                <th className="num" style={{ width: 150 }}>
                  Tarif
                </th>
                <th className="num" style={{ width: 150 }}>
                  Driver
                </th>
                <th className="num" style={{ width: 170 }}>
                  Biaya
                </th>
              </tr>
            </thead>
            <tbody>
              {run.costs.map((c, i) => (
                <tr key={i}>
                  <td>
                    <span className="lab">{c.itemLabel}</span>
                  </td>
                  <td className="num">
                    <span className="mny">{qtyText(c.rate)}</span>
                  </td>
                  <td className="num">
                    <span className="mny">{qtyText(c.driver)}</span>
                  </td>
                  <td className="num">
                    <span className="mny">{formatMoney(c.amount, "IDR")}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    ) : null;

  return (
    <>
      <div className="ph">
        <div className="crumb">
          <span>Produksi</span>
          <span>/</span>
          <Link href="/production/execution">Eksekusi Produksi</Link>
          <span>/</span>
          <span className="cur">{run ? run.executionNo : "Baru"}</span>
        </div>
        <div className="ph-row">
          <h1>
            <span className="ph-ico">
              <Icon name="gear" size={16} />
            </span>
            {run ? (
              <>
                <span className="docno">{run.executionNo}</span>
                <span className={`bdg ${EXECUTION_STATUS_BADGE[status]}`}>{EXECUTION_STATUS_TEXT[status]}</span>
              </>
            ) : (
              "Eksekusi Produksi Baru"
            )}
            {mode === "edit" && <span className="bdg t-warn">Mode Ubah</span>}
          </h1>
          <div className="ph-act">
            {editing ? (
              <>
                {dirty && (
                  <span className="ph-dirty">
                    <span className="pulse" /> Belum disimpan
                  </span>
                )}
                <CancelButton href={backHref} dirty={dirty} disabled={saving} />
                <button className="btn primary" onClick={onSave} disabled={saving}>
                  <Icon name="save" size={15} /> {saving ? "Menyimpan…" : "Simpan"}
                </button>
              </>
            ) : (
              <RunActions id={run!.id} subject={run!.executionNo} status={status} can={can} />
            )}
          </div>
        </div>
      </div>

      <div className="fgrid solo">
        <div>
          {headerCard}
          {errors._sections && (
            <div className="nbox bad slim" style={{ marginTop: 14 }}>
              <Icon name="warn" size={15} className="ni" />
              <div>
                <b>{errors._sections}</b>
              </div>
            </div>
          )}
          {editing && (
            <div style={{ display: "flex", gap: 8, margin: "14px 0 0" }}>
              <button className="btn sm" disabled={!kind} title={kind ? undefined : "Pilih Workstation dan jenis dulu…"} onClick={fillAll}>
                <Icon name="layers" size={14} /> Isi dari Barang Workstation
              </button>
              {kind !== "Mix" && (
                <button
                  className="btn sm primary"
                  disabled={!kind}
                  onClick={() => {
                    setSections((ss) => [...ss, blankSection()]);
                    touch("_sections");
                  }}
                >
                  <Icon name="plus" size={14} /> Tambah Section
                </button>
              )}
            </div>
          )}
          {sections.map((s, i) => sectionCard(s, i))}
          {costsCard}
        </div>
      </div>
    </>
  );
}
