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
import { PRODUCTION_RECEIPT_PURPOSES } from "@/lib/erp/production-receipt-shape";
import type { FinishGoodsOptions } from "@/lib/erp/production-receipt";
import type { BucketView } from "@/lib/erp/production-ledger";
import { todayIso } from "@/lib/format";

/**
 * Kirim from production into a warehouse (P303, P304): BSTB ke Finish Goods from
 * the Stand By of the Unit that ends a line, each No. Stok whole; BSTB
 * Pengeluaran from Persiapan or Stand By of any Unit, a No. Stok without a Job
 * by the quantity typed, a Job whole. The goods wait as Dalam Perjalanan until
 * the warehouse presses Terima in the ERP. No prices (P275).
 */

type Row = { key: string; jobNo: string | null; buckets: BucketView[] };
const STAGE_TEXT: Partial<Record<BucketView["stage"], string>> = { Preparation: "Persiapan", StandBy: "Stand By" };
const keyOf = (b: BucketView) => (b.jobId ? `j${b.jobId}${b.stage}` : `b${b.id}`);
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
  const p = PRODUCTION_RECEIPT_PURPOSES[options.purpose];
  const isReturn = options.purpose === "return";
  const byId = new Map(options.buckets.map((b) => [b.id, b]));
  const [keys, setKeys] = useState<string[]>(() => [...new Set(initialBucketIds.flatMap((id) => byId.get(id) ?? []).map(keyOf))]);
  const [qty, setQty] = useState<Record<number, string>>({});
  const preferred = isReturn ? /bahan baku/i : /finish/i;
  const [warehouse, setWarehouse] = useState(String((options.warehouses.find((w) => preferred.test(w.name)) ?? options.warehouses[0])?.id ?? ""));
  const [date, setDate] = useState(todayIso());
  const [note, setNote] = useState("");
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [posted, setPosted] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const all = rowsOf(options.buckets);
  const rows = keys.flatMap((k) => all.find((w) => w.key === k) ?? []);
  const addable = all.filter((w) => !keys.includes(w.key));
  const backTab = isReturn ? undefined : "standby";
  const back = workspaceHref(options.unit.label, backTab);
  const target = options.warehouses.find((w) => String(w.id) === warehouse);
  const blocked = !isReturn && !options.endsLine;
  const partial = (r: Row) => isReturn && !r.jobNo;
  const touched = () => setErrors({});
  const lines = rows.flatMap((r) => r.buckets.map((b) => ({ bucket_id: b.id, qty: partial(r) ? (qty[b.id] ?? String(b.qty)) : b.qty })));

  async function submit() {
    setBusy(true);
    const result = await sendFinishGoodsAction({ purpose: options.purpose, from_unit_id: options.unit.id, warehouse_id: Number(warehouse) || null, receipt_date: date, note, lines });
    setBusy(false);
    setAsking(false);
    if (!result.ok) {
      setErrors(result.errors);
      const lineError = Object.entries(result.errors).find(([k]) => k.startsWith("lines."))?.[1];
      toast(result.errors._form ? "Tidak diizinkan" : "Belum bisa dikirim", result.errors._form ?? result.errors._lines ?? lineError ?? result.errors.from_unit_id ?? result.errors.warehouse_id ?? "Periksa kembali isian.", "err");
      return;
    }
    setPosted(result.no);
  }

  return (
    <>
      <div className="ph">
        <WorkspaceCrumb path={p.path} noun={p.name} no={null} unitLabel={options.unit.label} unitTab={backTab} />
        <div className="ph-row">
          <h1>
            <span className="ph-ico">
              <Icon name="truck" size={16} />
            </span>
            {p.name} Baru
          </h1>
          <div className="ph-act">
            <CancelButton href={back} dirty={rows.length > 0} />
            <button className="btn primary" disabled={busy || !rows.length || !target || blocked} onClick={() => setAsking(true)}>
              <Icon name="send" size={15} /> Ajukan
            </button>
          </div>
        </div>
      </div>

      {blocked && <ErrorBox text={`${options.unit.label} bukan Unit terakhir routing: barangnya dikirim lewat Push atau BSTB.`} />}

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
              <Field label={isReturn ? "Alasan / Catatan" : "Catatan"} span={12}>
                <textarea className="ta" rows={2} value={note} placeholder={isReturn ? "Reject, sisa bahan penolong, barang dikeluarkan dari line…" : "Keterangan tambahan…"} onChange={(e) => setNote(e.target.value)} />
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
            <p>
              {isReturn
                ? "Dari Persiapan atau Stand By. Job dikirim utuh; No. Stok tanpa Job boleh sebagian. No. Job berakhir di sini."
                : "Setiap No. Stok dikirim utuh; Job dikirim dengan seluruh No. Stok-nya."}
            </p>
          </div>
        </div>
        {addable.length > 0 && !isReturn && (
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
          // Goods without grams (bahan penolong) are added whole; their quantity is edited on the row.
          partial={(c) => isReturn && !c.jobNo && c.grams > 0}
          emptyText={isReturn ? `Tidak ada lagi di Persiapan atau Stand By ${options.unit.label}.` : `Tidak ada lagi di Stand By ${options.unit.label}.`}
          onAdd={(k, grams) => {
            const w = addable.find((x) => x.key === k)!;
            const b = w.buckets[0];
            // The gram typed is turned into the bucket's own quantity (a gram item's quantity is its gram).
            if (partial(w) && grams != null) setQty((q) => ({ ...q, [b.id]: String(b.grams ? Math.round((grams / b.grams) * b.qty * 10_000) / 10_000 : grams) }));
            setKeys((x) => [...x, k]);
            touched();
          }}
        />
        <ErrorBox text={errors._lines} />
        {rows.length ? (
          <div className="tw">
            <table className="grid ltab" style={{ minWidth: 720 }}>
              <thead>
                <tr>
                  <th>No. Job / No. Stok</th>
                  {isReturn && <th style={{ width: 110 }}>Tahap</th>}
                  <th className="num" style={{ width: 120 }}>Ada</th>
                  <th className="num" style={{ width: 150 }}>Dikirim</th>
                  <th style={{ width: 40 }} />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const b = r.buckets[0];
                  const err = errors[`lines.${lines.findIndex((l) => l.bucket_id === b.id)}.qty`];
                  return (
                    <tr key={r.key}>
                      <td>
                        {r.jobNo ? <div className="mono">{r.jobNo}</div> : null}
                        {r.buckets.map((x) => (
                          <div key={x.id}>
                            {idc(x.lotNo, x.itemName)}
                            {x.auxiliary && <span className="bdg s-mute">Bahan penolong</span>}
                            {x.isBjl && <span className="bdg s-mute">BJL</span>}
                          </div>
                        ))}
                      </td>
                      {isReturn && <td>{STAGE_TEXT[b.stage] ?? b.stage}</td>}
                      <td className="num">
                        {qtyText(qtyOf(r))} {b.uomLabel}
                      </td>
                      <td className="num">
                        {partial(r) ? (
                          <input
                            className={`inp sm${err ? " bad" : ""}`}
                            style={{ textAlign: "right" }}
                            inputMode="decimal"
                            value={qty[b.id] ?? String(b.qty)}
                            aria-label={`Jumlah dikirim ${b.lotNo}`}
                            onChange={(e) => {
                              setQty((q) => ({ ...q, [b.id]: e.target.value }));
                              touched();
                            }}
                          />
                        ) : (
                          <span className="mut">utuh</span>
                        )}
                      </td>
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
                  );
                })}
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
        onAgain={() => router.push(`${p.sendPath}?unit=${encodeURIComponent(options.unit.label)}&n=${Date.now()}`)}
      />
      <ConfirmDialog
        open={asking}
        icon="send"
        tone="brand"
        title={`Ajukan ${p.name}`}
        subject={target ? `${options.unit.label} → ${target.label}` : undefined}
        body={`${rows.length} baris berstatus Dalam Perjalanan sampai ${target?.label ?? "gudang"} menekan Terima${isReturn ? "; gudang memilih apakah barang masuk dengan nilainya atau tanpa nilai" : ""}. Dokumen yang sudah diajukan tidak dapat dibatalkan.`}
        confirmLabel="Ya, Ajukan"
        busy={busy}
        onConfirm={submit}
        onCancel={() => setAsking(false)}
      />
    </>
  );
}
