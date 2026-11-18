"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icon";
import { CancelButton } from "@/components/ui/cancel-button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DateInput } from "@/components/ui/date-input";
import { Field, FormBody, FormRow, FormSection } from "@/components/ui/form";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { ErrorBox, idc, qtyText, ro } from "@/components/production/execution-parts";
import { JobPicker } from "@/components/production/job-picker";
import { startKerjaAction } from "@/app/actions/production-kerja";
import type { KerjaOptions } from "@/lib/erp/production-kerja";
import type { BucketView } from "@/lib/erp/production-ledger";
import { todayIso } from "@/lib/format";

/**
 * Mulai Kerja (P282, T13): the Jobs picked from the Persiapan of the Kerja step,
 * each with one karyawan. Mulai makes the document and moves them into Sedang
 * Dikerjakan; Selesai and Batal Mulai are on the Workspace. No prices (P275).
 */

type Row = { key: string; jobNo: string | null; partaiId: number | null; partaiNo: string | null; buckets: BucketView[] };
const keyOf = (b: BucketView) => (b.jobId ? `j${b.jobId}` : `b${b.id}`);
function rowsOf(buckets: BucketView[]): Row[] {
  const out = new Map<string, Row>();
  for (const b of buckets) {
    const r = out.get(keyOf(b)) ?? { key: keyOf(b), jobNo: b.jobNo, partaiId: b.partaiId, partaiNo: b.partaiNo, buckets: [] };
    r.buckets.push(b);
    out.set(r.key, r);
  }
  return [...out.values()];
}
const gramOf = (r: Row) => r.buckets.reduce((a, b) => a + (b.grams ?? 0), 0);

export function KerjaForm({ options, initialBucketIds }: { options: KerjaOptions; initialBucketIds: number[] }) {
  const router = useRouter();
  const toast = useToast();
  const byId = new Map(options.buckets.map((b) => [b.id, b]));
  const [keys, setKeys] = useState<string[]>(() => [...new Set(initialBucketIds.flatMap((id) => byId.get(id) ?? []).map(keyOf))]);
  const [worker, setWorker] = useState<Record<string, string>>({});
  const [date, setDate] = useState(todayIso());
  const [note, setNote] = useState("");
  const [adding, setAdding] = useState(false);
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const all = rowsOf(options.buckets);
  const rows = keys.flatMap((k) => all.find((w) => w.key === k) ?? []);
  const partai = rows[0]?.partaiId ?? null;
  const addable = all.filter((w) => !keys.includes(w.key) && (!rows.length || w.partaiId === partai));
  const back = `/production/workspace/${encodeURIComponent(options.unit.label)}`;
  const employees = options.employees.map((e) => ({ value: String(e.id), label: `${e.label} · ${e.name}` }));
  const missing = rows.some((r) => !worker[r.key]);

  async function submit() {
    setBusy(true);
    const result = await startKerjaAction({
      unit_id: options.unit.id,
      kerja_date: date,
      note,
      lines: rows.flatMap((r) => r.buckets.map((b) => ({ bucket_id: b.id, employee_id: Number(worker[r.key]) || null }))),
    });
    setBusy(false);
    setAsking(false);
    if (!result.ok) {
      setErrors(result.errors);
      toast(result.errors._form ? "Tidak diizinkan" : "Belum bisa dimulai", result.errors._form ?? result.errors._lines ?? Object.values(result.errors)[0] ?? "Periksa kembali isian.", "err");
      return;
    }
    toast("Kerja dimulai", `${result.no} · ${rows.length} Job Sedang Dikerjakan`, "ok");
    router.push(back);
  }

  return (
    <>
      <div className="ph">
        <div className="crumb">
          <span>Dokumen</span>
          <span>/</span>
          <Link href="/production/kerja">Kerja</Link>
          <span>/</span>
          <span className="cur">Baru</span>
        </div>
        <div className="ph-row">
          <h1>
            <span className="ph-ico">
              <Icon name="clock" size={16} />
            </span>
            Mulai Kerja di {options.unit.label}
          </h1>
          <div className="ph-act">
            <CancelButton href={back} dirty={rows.length > 0} />
            <button className="btn primary" disabled={busy || !rows.length || missing} onClick={() => setAsking(true)}>
              <Icon name="check" size={15} /> Mulai
            </button>
          </div>
        </div>
      </div>

      <div className="card">
        <FormBody>
          <FormSection>
            <FormRow>
              <Field label="Unit" span={4}>
                {ro(
                  <>
                    <span className="lab">{options.unit.label}</span> {options.unit.name}
                  </>
                )}
              </Field>
              <Field label="Tanggal" span={4} required error={errors.kerja_date}>
                <DateInput value={date} invalid={Boolean(errors.kerja_date)} onChange={setDate} />
              </Field>
              <Field label="Partai" span={4}>
                {rows[0]?.partaiNo ? ro(<span className="mono">{rows[0].partaiNo}</span>) : <div className="ro nil">{rows.length ? "sebelum partai" : "pilih Job dulu"}</div>}
              </Field>
              <Field label="Catatan" span={12}>
                <textarea className="ta" rows={2} value={note} placeholder="Keterangan tambahan…" onChange={(e) => setNote(e.target.value)} />
              </Field>
            </FormRow>
          </FormSection>
        </FormBody>
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        <div className="card-h">
          <span className="ci">
            <Icon name="users" size={15} />
          </span>
          <div className="ct">
            <h3>Job Dikerjakan</h3>
            <p>Satu Job dikerjakan satu karyawan dan diambil utuh. Biaya Unit dibebankan saat Selesai bila Kerja proses terakhir Unit ini.</p>
          </div>
          <button className="btn sm primary" disabled={!addable.length} onClick={() => setAdding(true)}>
            <Icon name="plus" size={14} /> Tambah Baris
          </button>
        </div>
        <ErrorBox text={errors._lines} />
        {rows.length ? (
          <div className="tw">
            <table className="grid ltab" style={{ minWidth: 720 }}>
              <thead>
                <tr>
                  <th>No. Job / No. Stok</th>
                  <th className="num" style={{ width: 110 }}>Gram</th>
                  <th style={{ width: 260 }}>Karyawan</th>
                  <th style={{ width: 40 }} />
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.key}>
                    <td>
                      {r.jobNo ? <div className="mono">{r.jobNo}</div> : null}
                      {r.buckets.map((b) => (
                        <div key={b.id}>
                          {idc(b.lotNo, b.itemName)}
                          {b.isBjl && <span className="bdg s-mute">BJL</span>}
                        </div>
                      ))}
                    </td>
                    <td className="num">{qtyText(gramOf(r))}</td>
                    <td>
                      <Select
                        value={worker[r.key] ?? ""}
                        options={employees}
                        placeholder="Pilih karyawan…"
                        invalid={Object.keys(errors).some((k) => k.endsWith(".employee_id")) && !worker[r.key]}
                        onChange={(v) => setWorker((w) => ({ ...w, [r.key]: v }))}
                      />
                      {i > 0 && worker[rows[0].key] && !worker[r.key] && (
                        <button type="button" className="btn sm ghost" onClick={() => setWorker((w) => ({ ...w, [r.key]: w[rows[0].key] }))}>
                          Samakan dengan baris pertama
                        </button>
                      )}
                    </td>
                    <td>
                      <button className="iact del" title="Keluarkan baris" onClick={() => setKeys((k) => k.filter((x) => x !== r.key))}>
                        <Icon name="trash" size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty">
            <h4>Belum ada baris</h4>
            <p>Tambahkan Job dari Persiapan Kerja {options.unit.label} dengan Tambah Baris.</p>
          </div>
        )}
      </div>

      {adding && (
        <JobPicker
          title="Tambah Baris"
          subtitle={`Yang menunggu di Persiapan Kerja ${options.unit.label}${rows.length ? ", partai yang sama" : ""}.`}
          choices={addable.map((w) => ({ key: w.key, jobNo: w.jobNo, lotNo: w.buckets[0].lotNo, itemName: w.buckets[0].itemName, count: w.buckets.length, partaiId: w.partaiId, partaiNo: w.partaiNo, grams: gramOf(w) }))}
          onAdd={(k) => {
            setKeys((x) => [...x, ...k]);
            setAdding(false);
          }}
          onClose={() => setAdding(false)}
        />
      )}

      <ConfirmDialog
        open={asking}
        icon="clock"
        tone="brand"
        title={`Mulai ${rows.length} Job?`}
        subject={options.unit.label}
        body="Job pindah ke Sedang Dikerjakan dan jam mulainya dicatat. Biaya Unit dibebankan saat Selesai; Batal Mulai mengembalikannya tanpa biaya."
        confirmLabel="Ya, Mulai"
        busy={busy}
        onConfirm={submit}
        onCancel={() => setAsking(false)}
      />
    </>
  );
}
