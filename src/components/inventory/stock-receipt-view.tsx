"use client";

import { useState } from "react";
import Link from "next/link";
import { Icon } from "@/components/icon";
import { Amount } from "@/components/ui/amount";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DocumentHeader } from "@/components/ui/document-header";
import { Field, FormBody, FormRow, FormSection } from "@/components/ui/form";
import { JournalPreview } from "@/components/ui/journal-preview";
import { useToast } from "@/components/ui/toast";
import { previewStockReceiptAction, receiveStockReceiptAction } from "@/app/actions/stock-receipt";
import type { StockReceiptView as View } from "@/lib/erp/stock-receipt";
import { STOCK_RECEIPT_PATH, STOCK_RECEIPT_PURPOSES, STOCK_RECEIPT_STATUS_BADGE, STOCK_RECEIPT_STATUS_TEXT, VALUE_MODE_TEXT, type ProductionValueMode } from "@/lib/erp/stock-receipt-purposes";
import { Select } from "@/components/ui/select";
import { formatDate, formatQty } from "@/lib/format";
import { FormTabs } from "@/components/ui/form-tabs";

const qtyText = formatQty;
const ro = (node: React.ReactNode) => <div className="ro">{node}</div>;
const nil = (text: string) => <div className="ro nil">{text}</div>;

/**
 * A BSTB from production as the warehouse sees it (P303, P304): where it came
 * from, the No. Stok it brings, and Terima, whose confirmation shows the journal
 * by a dry run of the posting itself (P103). A BSTB Pengeluaran asks there
 * whether the goods come in at their value or at none.
 */
export function StockReceiptView({ receipt: r, canReceive }: { receipt: View; canReceive: boolean }) {
  const toast = useToast();
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [postable, setPostable] = useState(false);
  const posted = r.status === "Received";
  const p = STOCK_RECEIPT_PURPOSES[r.purpose];
  const isReturn = p.asksValue;
  const bonus = !p.fromProduction;
  const [mode, setMode] = useState<ProductionValueMode>("carried");
  // Where each No. Stok goes, chosen while it waits (P317).
  const placing = !posted && canReceive;
  const [places, setPlaces] = useState<{ id: number; location_id: number | null; stock_status_id: number | null }[]>(() => r.items.map((i) => ({ id: i.id, location_id: null as number | null, stock_status_id: r.statuses[0]?.id ?? null })));
  const place = (id: number, patch: { location_id?: number | null; stock_status_id?: number | null }) => setPlaces((x) => x.map((q) => (q.id === id ? { ...q, ...patch } : q)));
  const placeAll = (patch: { location_id?: number | null; stock_status_id?: number | null }) => setPlaces((x) => x.map((q) => ({ ...q, ...patch })));
  const locationOptions = r.locations.map((l) => ({ value: String(l.id), label: `${l.label} · ${l.name}` }));
  const statusOptions = r.statuses.map((x) => ({ value: String(x.id), label: x.name }));
  const input = { valueMode: isReturn ? mode : null, places };
  const missing = placing && r.locations.length > 0 && places.some((q) => !q.location_id);

  async function receive() {
    setBusy(true);
    const result = await receiveStockReceiptAction(r.id, input);
    setBusy(false);
    setAsking(false);
    if (!result.ok) return toast("Tidak dapat diterima", result.errors._form ?? Object.values(result.errors)[0], "err");
    toast(result.message, r.no, "ok");
  }

  return (
    <>
      <DocumentHeader
        module="Persediaan"
        trail={[{ label: "Stock Receipt", href: STOCK_RECEIPT_PATH }]}
        icon="down"
        number={r.no}
        status={r.status}
        statusLabel={{ text: STOCK_RECEIPT_STATUS_TEXT[r.status], tone: STOCK_RECEIPT_STATUS_BADGE[r.status] }}
      >
        {!posted && canReceive ? (
          <button
            className="btn primary"
            disabled={busy || missing}
            title={missing ? "Pilih lokasi dulu…" : undefined}
            onClick={() => {
              setPostable(false);
              setAsking(true);
            }}
          >
            <Icon name="check" size={15} /> Terima
          </button>
        ) : (
          <span className="lockchip">
            <Icon name="lock" size={13} /> {posted ? "Sudah diterima" : "Menunggu Terima gudang"}
          </span>
        )}
      </DocumentHeader>

      <div className="card">
        <FormBody>
          <FormSection title="Sumber">
            <FormRow>
              <Field label="Tujuan" span={4}>
                {ro(p.name)}
              </Field>
              <Field label={bonus ? "Receipt Note" : "Unit Asal"} span={4}>
                {ro(
                  bonus ? (
                    <Link className="drl" href={`/inventory/receipt-note/${r.sourceId}`}>
                      <span className="mono">{r.sourceNo}</span>
                    </Link>
                  ) : (
                    <span className="idc">
                      <span className="lab">{r.unitLabel}</span>
                      <span className="nm">{r.unitName}</span>
                    </span>
                  )
                )}
              </Field>
              {!bonus && (
                <Field label="Tanggal Kirim" span={4}>
                  {ro(formatDate(r.date))}
                </Field>
              )}
            </FormRow>
          </FormSection>
          <FormSection title="Penerimaan">
            <FormRow>
              <Field label="Gudang Tujuan" span={4}>
                {ro(
                  <span className="idc">
                    <span className="lab">{r.warehouseLabel}</span>
                    <span className="nm">{r.warehouseName}</span>
                  </span>
                )}
              </Field>
              <Field label="Tanggal Terima" span={4}>
                {r.receivedAt ? ro(formatDate(r.receivedAt)) : nil("belum diterima")}
              </Field>
              {isReturn && posted && (
                <Field label="Nilai" span={4}>
                  {ro(r.valueMode ? VALUE_MODE_TEXT[r.valueMode].name : "—")}
                </Field>
              )}
              <Field label={isReturn ? "Alasan dan Catatan" : "Catatan"} span={12}>
                {r.note ? <div className="ro multi">{r.note}</div> : <div className="ro multi nil opt">tidak diisi</div>}
              </Field>
            </FormRow>
          </FormSection>
          {posted && (
            <FormSection title="Referensi">
              <FormRow>
                <Field label="Journal" span={4}>
                  {r.journalId
                    ? ro(
                        <Link className="drl" href={`/accounting/journal/${r.journalId}`}>
                          <span className="mono">{r.journalNo}</span>
                        </Link>
                      )
                    : nil("tanpa journal — barang bernilai nol")}
                </Field>
                {r.writtenOff > 0 && (
                  <Field label="Beban Pemusnahan Produksi" span={4}>
                    {ro(<Amount value={r.writtenOff} />)}
                  </Field>
                )}
              </FormRow>
            </FormSection>
          )}
          <p className="fnote">
            {bonus
              ? "Kelebihan timbangan di atas toleransi, yang tidak ditagih supplier: masuk stok bernilai 0 dengan No. Stok baru, tanpa journal."
              : isReturn
              ? "Barang masuk gudang dengan No. Stok yang sama. Nilai terbawa: Persediaan didebit, WIP dikredit. Tanpa nilai: stok masuk bernilai 0 dan nilainya dibebankan ke Beban Pemusnahan Produksi."
              : "Barang masuk gudang dengan No. Stok yang sama dan senilai yang dibawanya dari produksi: Persediaan didebit, WIP dikredit."}
          </p>
        </FormBody>
      </div>

      <FormTabs
        tabs={[
          { key: "lines", label: "Barang", icon: "box", count: r.items.length, content: (
      <div className="card">
        <div className="card-h">
          <span className="ci">
            <Icon name="layers" size={15} />
          </span>
          <div className="ct">
            <h3>Barang</h3>
            <p>{bonus ? "Masuk stok bersama posting Receipt Note-nya." : posted ? "Nilai adalah yang dibekukan produksi saat Kirim." : placing ? (r.locations.length ? "Pilih lokasi dan status tiap No. Stok, lalu Terima." : "Pilih status tiap No. Stok, lalu Terima.") : "Menunggu Terima gudang."}</p>
          </div>
        </div>
        {placing && r.items.length > 1 && (
          <div className="toolbar" style={{ paddingBottom: 0, borderBottom: 0 }}>
            <span className="count">Untuk semua baris:</span>
            {r.locations.length > 0 && (
              <div style={{ width: 220 }}>
                <Select value="" ariaLabel="Lokasi semua baris" options={locationOptions} placeholder="Pilih lokasi…" onChange={(v) => placeAll({ location_id: Number(v) || null })} />
              </div>
            )}
            <div style={{ width: 170 }}>
              <Select value="" ariaLabel="Status semua baris" options={statusOptions} placeholder="Pilih status…" onChange={(v) => placeAll({ stock_status_id: Number(v) || null })} />
            </div>
          </div>
        )}
        <div className="tw">
          <table className="grid ltab" style={{ minWidth: r.locations.length ? 1080 : 900 }}>
            <thead>
              <tr>
                <th style={{ width: 44 }}>No</th>
                <th>No. Stok</th>
                <th>Barang</th>
                {isReturn && <th style={{ width: 170 }}>No. Job</th>}
                <th className="num" style={{ width: 110 }}>Qty</th>
                <th className="num" style={{ width: 110 }}>Gram</th>
                {r.locations.length > 0 && <th style={{ width: 200 }}>Lokasi</th>}
                <th style={{ width: 150 }}>Status Stok</th>
                {posted && <th className="num" style={{ width: 150 }}>Nilai</th>}
              </tr>
            </thead>
            <tbody>
              {r.items.map((l, i) => (
                <tr key={l.id}>
                  <td className="mut">{i + 1}</td>
                  <td>
                    <span className="mono">{l.lotNo}</span>
                  </td>
                  <td>
                    <span className="idc">
                      <span className="lab">{l.itemLabel}</span>
                      <span className="nm">{l.itemName}</span>
                    </span>
                  </td>
                  {isReturn && <td>{l.jobNo ? <span className="mono">{l.jobNo}</span> : <span className="dash">—</span>}</td>}
                  <td className="num">
                    {qtyText(l.qty)} {l.uomLabel}
                  </td>
                  <td className="num">{l.grams != null ? qtyText(l.grams) : <span className="dash">—</span>}</td>
                  {r.locations.length > 0 && (
                    <td>
                      {placing ? (
                        <Select size="sm" ariaLabel={`Lokasi ${l.lotNo}`} value={String(places[i]?.location_id ?? "")} options={locationOptions} placeholder="Pilih lokasi…" onChange={(v) => place(l.id, { location_id: Number(v) || null })} />
                      ) : (
                        (l.locationLabel ?? <span className="dash">—</span>)
                      )}
                    </td>
                  )}
                  <td>
                    {placing ? (
                      <Select size="sm" ariaLabel={`Status ${l.lotNo}`} value={String(places[i]?.stock_status_id ?? "")} options={statusOptions} placeholder="Pilih status…" onChange={(v) => place(l.id, { stock_status_id: Number(v) || null })} />
                    ) : (
                      (l.statusName ?? <span className="dash">—</span>)
                    )}
                  </td>
                  {posted && (
                    <td className="num">
                      <Amount value={l.value} />
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
            {posted && (
              <tfoot>
                <tr>
                  <td colSpan={(isReturn ? 7 : 6) + (r.locations.length > 0 ? 1 : 0)} className="num">
                    Total
                  </td>
                  <td className="num">
                    <Amount value={r.cost} />
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
          ) },
        ]}
      />

      {asking && (
        <ConfirmDialog
          open
          wide
          icon="check"
          tone="ok"
          title={`Terima ${p.name}`}
          subject={r.no}
          body={`${r.lots} No. Stok keluar dari produksi ${r.unitLabel} dan masuk ${r.warehouseLabel} dengan No. Stok yang sama, bertanggal hari ini. Dokumen yang sudah diterima tidak dapat diubah atau dibatalkan.`}
          confirmLabel="Ya, Terima"
          confirmTone="primary"
          busy={busy}
          confirmDisabled={!postable}
          onConfirm={receive}
          onCancel={() => setAsking(false)}
        >
          {isReturn && (
            <div style={{ display: "grid", gap: 8, marginBottom: 12 }} role="radiogroup" aria-label="Nilai barang">
              {(Object.keys(VALUE_MODE_TEXT) as ProductionValueMode[]).map((m) => (
                <label key={m} className="chk">
                  <input
                    type="radio"
                    name="value_mode"
                    checked={mode === m}
                    onChange={() => {
                      setPostable(false);
                      setMode(m);
                    }}
                  />
                  <span style={{ display: "grid" }}>
                    <span className="ct">{VALUE_MODE_TEXT[m].name}</span>
                    <span className="cd">{VALUE_MODE_TEXT[m].help}</span>
                  </span>
                </label>
              ))}
            </div>
          )}
          <JournalPreview key={mode} load={() => previewStockReceiptAction(r.id, input)} onReady={setPostable} />
        </ConfirmDialog>
      )}
    </>
  );
}
