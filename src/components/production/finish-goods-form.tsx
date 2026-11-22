"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icon";
import { CancelButton } from "@/components/ui/cancel-button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DateInput } from "@/components/ui/date-input";
import { Field, FormBody, FormRow, FormSection } from "@/components/ui/form";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { ErrorBox, idc, qtyText, ro, PostedDialog, WorkspaceCrumb, workspaceHref } from "@/components/production/execution-parts";
import { InputBar } from "@/components/production/input-bar";
import { sendFinishGoodsAction } from "@/app/actions/production-receipt";
import { PRODUCTION_RECEIPT_PATH } from "@/lib/erp/production-receipt-shape";
import type { FinishGoodsOptions } from "@/lib/erp/production-receipt";
import type { BucketView } from "@/lib/erp/production-ledger";
import { todayIso } from "@/lib/format";

/**
 * Kirim ke Finish Goods (P303) from the Stand By of the Unit that ends a line:
 * the goods picked leave whole for a warehouse and wait as Dalam Perjalanan
 * until it presses Terima in the ERP. No prices (P275).
 */

type Row = { key: string; jobNo: string | null; buckets: BucketView[] };
const keyOf = (b: BucketView) => (b.jobId ? `j${b.jobId}` : `b${b.id}`);
function rowsOf(buckets: BucketView[]): Row[] {
  const out = new Map<string, Row>();
  for (const b of buckets) {
    const r = out.get(keyOf(b)) ?? { key: keyOf(b), jobNo: b.jobNo, buckets: [] };
    r.buckets.push(b);
    out.set(r.key, r);
  }
  return [...out.values()];
}
const gramOf = (r: Row) => r.buckets.reduce((a, b) => a + (b.grams ?? 0), 0);
const qtyOf = (r: Row) => r.buckets.reduce((a, b) => a + b.qty, 0);

export function FinishGoodsForm({ options, initialBucketIds }: { options: FinishGoodsOptions; initialBucketIds: number[] }) {
  const router = useRouter();
  const toast = useToast();
  const byId = new Map(options.buckets.map((b) => [b.id, b]));
  const [keys, setKeys] = useState<string[]>(() => [...new Set(initialBucketIds.flatMap((id) => byId.get(id) ?? []).map(keyOf))]);
  const [warehouse, setWarehouse] = useState(String((options.warehouses.find((w) => /finish/i.test(w.name)) ?? options.warehouses[0])?.id ?? ""));
  const [date, setDate] = useState(todayIso());
  const [note, setNote] = useState("");
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [posted, setPosted] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const all = rowsOf(options.buckets);
  const rows = keys.flatMap((k) => all.find((w) => w.key === k) ?? []);
  const addable = all.filter((w) => !keys.includes(w.key));
  const back = workspaceHref(options.unit.label, "standby");
  const target = options.warehouses.find((w) => String(w.id) === warehouse);
  const touched = () => setErrors({});

  async function submit() {
    setBusy(true);
    const result = await sendFinishGoodsAction({ from_unit_id: options.unit.id, warehouse_id: Number(warehouse) || null, receipt_date: date, note, bucket_ids: rows.flatMap((r) => r.buckets.map((b) => b.id)) });
    setBusy(false);
    setAsking(false);
    if (!result.ok) {
      setErrors(result.errors);
      toast(result.errors._form ? "Tidak diizinkan" : "Belum bisa dikirim", result.errors._form ?? result.errors._lines ?? result.errors.from_unit_id ?? result.errors.warehouse_id ?? "Periksa kembali isian.", "err");
      return;
    }
    setPosted(result.no);
  }

  return (
    <>
      <div className="ph">
        <WorkspaceCrumb path={PRODUCTION_RECEIPT_PATH} noun="BSTB ke Finish Goods" no={null} unitLabel={options.unit.label} unitTab="standby" />
        <div className="ph-row">
          <h1>
            <span className="ph-ico">
              <Icon name="truck" size={16} />
            </span>
            BSTB ke Finish Goods Baru
          </h1>
          <div className="ph-act">
            <CancelButton href={back} dirty={rows.length > 0} />
            <button className="btn primary" disabled={busy || !rows.length || !target || !options.endsLine} onClick={() => setAsking(true)}>
              <Icon name="send" size={15} /> Ajukan
            </button>
          </div>
        </div>
      </div>

      {!options.endsLine && <ErrorBox text={`${options.unit.label} bukan Unit terakhir routing: barangnya dikirim lewat Push atau BSTB.`} />}

      <div className="card">
        <FormBody>
          <FormSection>
            <FormRow>
              <Field label="Unit Asal" span={3}>
                {ro(
                  <>
                    <span className="lab">{options.unit.label}</span> {options.unit.name}
                  </>
                )}
              </Field>
              <Field label="Gudang Tujuan" span={5} required error={errors.warehouse_id} help="gudang tanpa Lokasi; barang masuk saat gudang menekan Terima">
                <Select
                  value={warehouse}
                  options={options.warehouses.map((w) => ({ value: String(w.id), label: `${w.label} · ${w.name}` }))}
                  placeholder="Pilih gudang…"
                  invalid={Boolean(errors.warehouse_id)}
                  onChange={(v) => {
                    setWarehouse(v);
                    touched();
                  }}
                />
              </Field>
              <Field label="Tanggal" span={4} required error={errors.receipt_date}>
                <DateInput
                  value={date}
                  invalid={Boolean(errors.receipt_date)}
                  onChange={(v) => {
                    setDate(v);
                    touched();
                  }}
                />
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
            <h3>Barang yang Dikirim</h3>
            <p>Setiap No. Stok dikirim utuh; Job dikirim dengan seluruh No. Stok-nya.</p>
          </div>
        </div>
        {addable.length > 0 && (
          <div className="toolbar" style={{ paddingBottom: 0, borderBottom: 0 }}>
            <span className="tspace" />
            <button
              className="btn sm"
              onClick={() => {
                setKeys((x) => [...x, ...addable.map((w) => w.key)]);
                touched();
              }}
            >
              Ambil Semua
            </button>
          </div>
        )}
        <InputBar
          choices={addable.map((w) => ({ key: w.key, jobNo: w.jobNo, lotNo: w.buckets[0].lotNo, itemName: w.buckets[0].itemName, count: w.buckets.length, partaiId: w.buckets[0].partaiId, partaiNo: w.buckets[0].partaiNo, grams: gramOf(w) }))}
          partial={() => false}
          emptyText={`Tidak ada lagi di Stand By ${options.unit.label}.`}
          onAdd={(k) => {
            setKeys((x) => [...x, k]);
            touched();
          }}
        />
        <ErrorBox text={errors._lines} />
        {rows.length ? (
          <div className="tw">
            <table className="grid ltab" style={{ minWidth: 640 }}>
              <thead>
                <tr>
                  <th>No. Job / No. Stok</th>
                  <th className="num" style={{ width: 110 }}>Qty</th>
                  <th className="num" style={{ width: 110 }}>Gram</th>
                  <th style={{ width: 40 }} />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.key}>
                    <td>
                      {r.jobNo ? <div className="mono">{r.jobNo}</div> : null}
                      {r.buckets.map((b) => (
                        <div key={b.id}>{idc(b.lotNo, b.itemName)}</div>
                      ))}
                    </td>
                    <td className="num">
                      {qtyText(qtyOf(r))} {r.buckets[0].uomLabel}
                    </td>
                    <td className="num">{gramOf(r) ? qtyText(gramOf(r)) : <span className="dash">—</span>}</td>
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
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty">
            <h4>Belum ada baris</h4>
            <p>Pilih atau scan No. Job / No. Stok di baris input di atas, lalu Tambah.</p>
          </div>
        )}
      </div>

      <PostedDialog
        no={posted ? `${posted} · Dalam Perjalanan, menunggu Terima gudang` : null}
        done="Selesai"
        again="Kirim Lagi"
        onDone={() => router.push(back)}
        onAgain={() => router.push(`/production/transfer/finish-goods?unit=${encodeURIComponent(options.unit.label)}&n=${Date.now()}`)}
      />
      <ConfirmDialog
        open={asking}
        icon="send"
        tone="brand"
        title="Ajukan BSTB ke Finish Goods"
        subject={target ? `${options.unit.label} → ${target.label}` : undefined}
        body={`${rows.length} baris berstatus Dalam Perjalanan sampai ${target?.label ?? "gudang"} menekan Terima. BSTB yang sudah diajukan tidak dapat dibatalkan.`}
        confirmLabel="Ya, Ajukan"
        busy={busy}
        onConfirm={submit}
        onCancel={() => setAsking(false)}
      />
    </>
  );
}
