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
import { sendTransferAction } from "@/app/actions/production-transfer";
import { TRANSFER_KIND_TEXT } from "@/lib/erp/production-transfer-shape";
import type { TransferOptions, TransferRoute } from "@/lib/erp/production-transfer";
import type { BucketView } from "@/lib/erp/production-ledger";
import { todayIso } from "@/lib/format";

/**
 * Kirim from a Unit Stand By (T8, P277): the goods picked in the Workspace, a
 * Tujuan, a date. A Job leaves whole; goods without a Job leave by the gram
 * typed, each pickup becoming a Job of its own. Inside a Workstation it is a
 * Push, posted at once; across, a BSTB that waits for Terima. No prices (P275).
 */

type Row = { key: string; jobNo: string | null; partaiId: number | null; partaiNo: string | null; buckets: BucketView[] };

const keyOf = (b: BucketView) => (b.jobId ? `j${b.jobId}` : `b${b.id}`);
function rowsOf(buckets: BucketView[]): Row[] {
  const out = new Map<string, Row>();
  for (const b of buckets) {
    const k = keyOf(b);
    const r = out.get(k) ?? { key: k, jobNo: b.jobNo, partaiId: b.partaiId, partaiNo: b.partaiNo, buckets: [] };
    r.buckets.push(b);
    out.set(k, r);
  }
  return [...out.values()];
}
const gramOf = (r: Row) => r.buckets.reduce((a, b) => a + (b.grams ?? 0), 0);
const routeLabel = (r: TransferRoute) => `${r.toLabel}${r.line ? ` · Line ${r.line.name}` : ""}`;

export function TransferForm({ options, initialBucketIds }: { options: TransferOptions; initialBucketIds: number[] }) {
  const router = useRouter();
  const toast = useToast();
  const byId = new Map(options.buckets.map((b) => [b.id, b]));
  const [keys, setKeys] = useState<string[]>(() => [...new Set(initialBucketIds.flatMap((id) => byId.get(id) ?? []).map(keyOf))]);
  const [qty, setQty] = useState<Record<number, string>>({});
  const [date, setDate] = useState(todayIso());
  const [note, setNote] = useState("");
  const [routeKey, setRouteKey] = useState("");
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [posted, setPosted] = useState<{ no: string; push: boolean } | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const all = rowsOf(options.buckets);
  const rows = keys.flatMap((k) => all.find((w) => w.key === k) ?? []);
  const partai = rows[0]?.partaiId ?? null;
  const addable = all.filter((w) => !keys.includes(w.key) && (!rows.length || w.partaiId === partai));
  // The routes of the goods picked: the one routing they follow.
  const routing = rows[0]?.buckets[0].partaiRoutingId ?? null;
  const routes = options.routes.filter((r) => !rows.length || r.routingId === routing);
  const routeId = (r: TransferRoute) => `${r.toUnitId}:${r.line?.id ?? ""}`;
  const route = routes.find((r) => routeId(r) === routeKey) ?? (routes.length === 1 ? routes[0] : null);
  const back = workspaceHref(options.unit.label, "standby");
  const touched = () => setErrors({});

  const lines = rows.flatMap((r) => r.buckets.map((b) => ({ bucket_id: b.id, qty: r.jobNo ? b.qty : (qty[b.id] ?? String(b.qty)) })));

  async function submit() {
    setBusy(true);
    const result = await sendTransferAction({ from_unit_id: options.unit.id, to_unit_id: route?.toUnitId ?? null, transfer_date: date, line_id: route?.line?.id ?? null, note, lines });
    setBusy(false);
    setAsking(false);
    if (!result.ok) {
      setErrors(result.errors);
      toast(result.errors._form ? "Tidak diizinkan" : "Belum bisa dikirim", result.errors._form ?? result.errors._lines ?? result.errors.to_unit_id ?? result.errors.line_id ?? "Periksa kembali isian.", "err");
      return;
    }
    setPosted({ no: result.no, push: result.kind === "Push" });
  }

  const kind = route?.kind ?? null;

  return (
    <>
      <div className="ph">
        <WorkspaceCrumb path="/production/transfer" noun="Push dan BSTB" no={null} unitLabel={options.unit.label} unitTab="standby" />
        <div className="ph-row">
          <h1>
            <span className="ph-ico">
              <Icon name="truck" size={16} />
            </span>
            {kind ? `${TRANSFER_KIND_TEXT[kind]} Baru` : `Kirim dari ${options.unit.label}`}
          </h1>
          <div className="ph-act">
            <CancelButton href={back} dirty={rows.length > 0} />
            <button className="btn primary" disabled={busy || !rows.length || !route} onClick={() => setAsking(true)}>
              <Icon name="send" size={15} /> {kind === "Push" ? "Posting" : "Ajukan"}
            </button>
          </div>
        </div>
      </div>

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
              <Field label="Tujuan" span={5} required error={errors.to_unit_id || errors.line_id} help={kind === "Push" ? "satu Workstation: langsung masuk Persiapan" : kind ? "lintas Workstation: menunggu Terima" : undefined}>
                {routes.length > 1 ? (
                  <Select
                    value={route ? routeId(route) : ""}
                    options={routes.map((r) => ({ value: routeId(r), label: routeLabel(r) }))}
                    placeholder="Pilih tujuan…"
                    onChange={(v) => {
                      setRouteKey(v);
                      touched();
                    }}
                  />
                ) : routes.length === 1 ? (
                  ro(
                    <>
                      <span className="lab">{routes[0].toLabel}</span> <span className="mut">{TRANSFER_KIND_TEXT[routes[0].kind]}</span>
                    </>
                  )
                ) : (
                  <div className="ro nil">{rows.length ? "tidak ada tujuan pada routing" : "pilih barang dulu"}</div>
                )}
              </Field>
              <Field label="Tanggal" span={4} required error={errors.transfer_date}>
                <DateInput
                  value={date}
                  invalid={Boolean(errors.transfer_date)}
                  onChange={(v) => {
                    setDate(v);
                    touched();
                  }}
                />
              </Field>
              <Field label="Partai" span={3}>
                {rows[0]?.partaiNo ? ro(<span className="mono">{rows[0].partaiNo}</span>) : <div className="ro nil">sebelum partai</div>}
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
            <p>Job dikirim utuh. No. Stok tanpa Job dikirim sebanyak gram yang diisi, dan tiap ambilan mendapat No. Job sendiri.</p>
          </div>
        </div>
        {addable.length > 0 && (
          <div className="toolbar" style={{ paddingBottom: 0, borderBottom: 0 }}>
            <span className="tspace" />
            <button
              className="btn sm"
              onClick={() => {
                // All of one partai at once: a Job whole, a No. Stok without a Job all of it (the checkpoint's way, T5).
                const p = rows.length ? partai : addable[0].partaiId;
                setKeys((x) => [...x, ...addable.filter((w) => w.partaiId === p).map((w) => w.key)]);
                touched();
              }}
            >
              Ambil Semua
            </button>
          </div>
        )}
        <InputBar
          choices={addable.map((w) => ({ key: w.key, jobNo: w.jobNo, lotNo: w.buckets[0].lotNo, itemName: w.buckets[0].itemName, count: w.buckets.length, partaiId: w.partaiId, partaiNo: w.partaiNo, grams: gramOf(w) }))}
          partial={(c) => !c.jobNo}
          emptyText={`Tidak ada lagi di Stand By ${options.unit.label}${rows.length ? " untuk partai ini" : ""}.`}
          onAdd={(k, grams) => {
            const w = addable.find((x) => x.key === k)!;
            if (!w.jobNo) setQty((q) => ({ ...q, [w.buckets[0].id]: ((b: { grams: number | null; qty: number }, grams: number | null) => String(grams != null && b.grams ? Math.round(((grams / b.grams) * b.qty) * 10_000) / 10_000 : b.qty))(w.buckets[0], grams) }));
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
                  <th className="num" style={{ width: 120 }}>Ada di Stand By</th>
                  <th className="num" style={{ width: 160 }}>Dikirim</th>
                  <th style={{ width: 40 }} />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
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
                    <td className="num">
                      {r.jobNo ? (
                        <span className="mut">utuh</span>
                      ) : (
                        <input
                          className={`inp sm${errors[`lines.${lines.findIndex((l) => l.bucket_id === r.buckets[0].id)}.qty`] ? " bad" : ""}`}
                          style={{ textAlign: "right" }}
                          inputMode="decimal"
                          value={qty[r.buckets[0].id] ?? String(r.buckets[0].qty)}
                          aria-label={`Gram dikirim ${r.buckets[0].lotNo}`}
                          onChange={(e) => {
                            setQty((q) => ({ ...q, [r.buckets[0].id]: e.target.value }));
                            touched();
                          }}
                        />
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
        no={posted ? `${posted.no}${posted.push ? " · barang masuk Persiapan tujuan" : " · Dalam Perjalanan, menunggu Terima"}` : null}
        done="Selesai"
        again="Kirim Lagi"
        onDone={() => router.push(back)}
        onAgain={() => router.push(`/production/transfer/new?unit=${encodeURIComponent(options.unit.label)}&n=${Date.now()}`)}
      />
      <ConfirmDialog
        open={asking}
        icon="send"
        tone="brand"
        title={kind === "Push" ? "Posting Dokumen Push" : "Ajukan BSTB"}
        subject={route ? `${options.unit.label} → ${route.toLabel}` : undefined}
        body={
          kind === "Push"
            ? `${rows.length} baris langsung masuk Persiapan ${route?.toLabel}. Dokumen yang sudah diposting tidak dapat diubah atau dibatalkan.`
            : `${rows.length} baris berstatus Dalam Perjalanan sampai ${route?.toLabel} menekan Terima${kind === "BstbPartai" ? "; partai baru lahir saat diterima" : ""}. BSTB yang sudah diajukan tidak dapat dibatalkan.`
        }
        confirmLabel={kind === "Push" ? "Ya, Posting" : "Ya, Ajukan"}
        busy={busy}
        onConfirm={submit}
        onCancel={() => setAsking(false)}
      />
    </>
  );
}
