"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icon";
import { CancelButton } from "@/components/ui/cancel-button";
import { Combobox } from "@/components/ui/combobox";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DateInput } from "@/components/ui/date-input";
import { Field, FormBody, FormRow, FormSection } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import { ErrorBox, idc, qtyText, ro, PostedDialog, WorkspaceCrumb, workspaceHref } from "@/components/production/execution-parts";
import { InputBar } from "@/components/production/input-bar";
import { postJobOrderAction } from "@/app/actions/production-job-order";
import type { JobOrderOptions } from "@/lib/erp/production-job-order";
import { todayIso } from "@/lib/format";

/**
 * Job Order (P283, T7): the No. Stok waiting at the Job Order step are listed
 * with what is still free; the operator types the gram to take from each into
 * the cart, picks a Jenis (it stays chosen) and presses Buat Job. Each Job made
 * becomes one new No. Stok with its own No. Job at Posting. Gram is unchanged;
 * no prices (P275).
 */

type Part = { bucketId: number; qty: number };
type Line = { targetId: number; parts: Part[] };
const round = (n: number) => Math.round(n * 10_000) / 10_000;

export function JobOrderForm({ options, initialBucketIds }: { options: JobOrderOptions; initialBucketIds: number[] }) {
  const router = useRouter();
  const toast = useToast();
  const byId = new Map(options.buckets.map((b) => [b.id, b]));
  const [date, setDate] = useState(todayIso());
  const [note, setNote] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [cart, setCart] = useState<Part[]>(() => initialBucketIds.filter((id) => byId.has(id)).map((id) => ({ bucketId: id, qty: byId.get(id)!.qty })));
  const [target, setTarget] = useState<number | null>(null);
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [postedNo, setPostedNo] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const used = (id: number) => [...lines.flatMap((l) => l.parts), ...cart].filter((p) => p.bucketId === id).reduce((x, p) => x + p.qty, 0);
  const free = (id: number) => round(byId.get(id)!.qty - used(id));
  const anchor = lines[0]?.parts[0] ?? cart[0];
  const partai = anchor ? byId.get(anchor.bucketId)!.partaiId : null;
  // Any No. Stok here may be taken in part, a Job's too: Job Order mixes No. Stok, not Jobs (T7).
  const shown = options.buckets.filter((b) => free(b.id) > 0 && (!anchor || b.partaiId === partai));
  const cartGrams = cart.reduce((a, p) => a + p.qty, 0);
  const targets = options.targets.map((t) => ({ id: t.id, label: t.label, name: t.name, active: true }));
  const label = (id: number) => options.targets.find((t) => t.id === id);
  const back = workspaceHref(options.unit.label, "JobOrder");

  function makeJob() {
    if (!target || !cart.length) return;
    if (new Set(cart.map((p) => byId.get(p.bucketId)!.partaiId)).size > 1) return toast("Lain partai", "Satu dokumen hanya untuk satu partai.", "err");
    setLines((l) => [...l, { targetId: target, parts: cart }]);
    setCart([]);
    setErrors({});
  }

  async function submit() {
    setBusy(true);
    const result = await postJobOrderAction({ unit_id: options.unit.id, doc_date: date, note, lines: lines.map((l) => ({ target_item_id: l.targetId, parts: l.parts.map((p) => ({ bucket_id: p.bucketId, qty: p.qty })) })) });
    setBusy(false);
    setAsking(false);
    if (!result.ok) {
      setErrors(result.errors);
      toast(result.errors._form ? "Tidak diizinkan" : "Belum bisa diposting", result.errors._form ?? result.errors._lines ?? Object.values(result.errors)[0] ?? "Periksa kembali isian.", "err");
      return;
    }
    setPostedNo(`${result.no} · ${lines.length} Job baru`);
  }

  return (
    <>
      <div className="ph">
        <WorkspaceCrumb path="/production/job-order" noun="Job Order" no={null} unitLabel={options.unit.label} unitTab="JobOrder" />
        <div className="ph-row">
          <h1>
            <span className="ph-ico">
              <Icon name="clip" size={16} />
            </span>
            Job Order di {options.unit.label}
          </h1>
          <div className="ph-act">
            <CancelButton href={back} dirty={lines.length > 0} />
            <button className="btn primary" disabled={busy || !lines.length} onClick={() => setAsking(true)}>
              <Icon name="check" size={15} /> Posting
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
              <Field label="Tanggal" span={4} required error={errors.doc_date}>
                <DateInput value={date} invalid={Boolean(errors.doc_date)} onChange={setDate} />
              </Field>
              <Field label="Partai" span={4}>
                {(() => {
                  const b = lines[0] ? byId.get(lines[0].parts[0].bucketId) : cart[0] ? byId.get(cart[0].bucketId) : null;
                  return b?.partaiNo ? ro(<span className="mono">{b.partaiNo}</span>) : <div className="ro nil">{b ? "sebelum partai" : "pilih No. Stok dulu"}</div>;
                })()}
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
            <Icon name="layers" size={15} />
          </span>
          <div className="ct">
            <h3>Ambil dari Persiapan</h3>
            <p>Pilih atau scan No. Stok, isi gram bila sebagian, Tambah; ulangi sampai lengkap. Lalu pilih Jenis dan Buat Job. Sisanya tetap di Persiapan.</p>
          </div>
        </div>
        <InputBar
          label="No. Stok"
          choices={shown.map((b) => ({ key: String(b.id), jobNo: null, lotNo: b.lotNo, itemName: b.itemName, count: 1, partaiId: b.partaiId, partaiNo: b.partaiNo, grams: free(b.id) }))}
          partial={() => true}
          emptyText="Semua No. Stok di Persiapan Job Order sudah diambil."
          onAdd={(k, grams) => {
            const id = Number(k);
            setCart((c) => [...c, { bucketId: id, qty: grams ?? free(id) }]);
            setErrors({});
          }}
        />
        {cart.length > 0 && (
          <div className="tw">
            <table className="grid ltab" style={{ minWidth: 560 }}>
              <thead>
                <tr>
                  <th>Akan jadi satu Job</th>
                  <th style={{ width: 200 }}>Partai</th>
                  <th className="num" style={{ width: 110 }}>Gram</th>
                  <th style={{ width: 40 }} />
                </tr>
              </thead>
              <tbody>
                {cart.map((p, i) => {
                  const b = byId.get(p.bucketId)!;
                  return (
                    <tr key={i}>
                      <td>{idc(b.lotNo, b.itemName)}</td>
                      <td>{b.partaiNo ? <span className="mono">{b.partaiNo}</span> : <span className="dash">sebelum partai</span>}</td>
                      <td className="num">{qtyText(p.qty)}</td>
                      <td>
                        <button className="iact del" title="Keluarkan" onClick={() => setCart((c) => c.filter((_, j) => j !== i))}>
                          <Icon name="trash" size={14} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <div className="toolbar">
          <div style={{ width: 300 }}>
            <Combobox size="sm" value={target} options={targets} placeholder="Pilih Jenis…" emptyText="Belum ada Barang bersatuan gram." onChange={setTarget} />
          </div>
          <button className="btn sm primary" disabled={!target || !cart.length} onClick={makeJob}>
            <Icon name="check" size={14} /> Buat Job
          </button>
          <span className="uw-hint">
            Jenis tetap terpilih. Akan jadi satu Job · {cart.length} No. Stok · {qtyText(cartGrams)} g
          </span>
        </div>
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        <div className="card-h">
          <span className="ci">
            <Icon name="clip" size={15} />
          </span>
          <div className="ct">
            <h3>Job Order</h3>
            <p>
              {lines.length} Job · {qtyText(lines.reduce((a, l) => a + l.parts.reduce((x, p) => x + p.qty, 0), 0))} g. Tiap Job menjadi No. Stok baru dengan No. Job sendiri saat Posting.
            </p>
          </div>
        </div>
        <ErrorBox text={errors._lines} />
        {lines.length ? (
          <div className="tw">
            <table className="grid ltab" style={{ minWidth: 640 }}>
              <thead>
                <tr>
                  <th style={{ width: 44 }}>No</th>
                  <th style={{ width: 230 }}>Jenis</th>
                  <th>Dari No. Stok</th>
                  <th className="num" style={{ width: 100 }}>Gram</th>
                  <th style={{ width: 40 }} />
                </tr>
              </thead>
              <tbody>
                {lines.map((l, k) => (
                  <tr key={k}>
                    <td className="no">{k + 1}</td>
                    <td>{idc(label(l.targetId)?.label ?? "", label(l.targetId)?.name ?? "")}</td>
                    <td className="uw-hint">
                      {l.parts.map((p) => (
                        <span key={p.bucketId} style={{ marginRight: 8 }}>
                          <span className="mono">{byId.get(p.bucketId)!.lotNo}</span> {qtyText(p.qty)} g
                        </span>
                      ))}
                    </td>
                    <td className="num">{qtyText(l.parts.reduce((a, p) => a + p.qty, 0))}</td>
                    <td>
                      <button className="iact del" title="Hapus Job" onClick={() => setLines((x) => x.filter((_, i) => i !== k))}>
                        <Icon name="trash" size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty sm">
            <h4>Belum ada Job</h4>
            <p>Isi gram yang diambil, pilih Jenis, lalu Buat Job.</p>
          </div>
        )}
      </div>

      <PostedDialog
        no={postedNo}
        done="Selesai"
        onDone={() => router.push(back)}
        onAgain={() => router.push(`/production/job-order/new?unit=${encodeURIComponent(options.unit.label)}&n=${Date.now()}`)}
      />
      <ConfirmDialog
        open={asking}
        icon="clip"
        tone="brand"
        title={`Posting ${lines.length} Job Order?`}
        subject={options.unit.label}
        body="Tiap Job menjadi No. Stok baru dengan No. Job dan Job Order sendiri, lalu masuk proses berikutnya. Gram tetap; biaya Unit dibebankan di proses terakhir. Dokumen yang sudah diposting tidak dapat diubah."
        confirmLabel="Ya, Posting"
        busy={busy}
        onConfirm={submit}
        onCancel={() => setAsking(false)}
      />
    </>
  );
}
