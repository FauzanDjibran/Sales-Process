"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icon";
import { CancelButton } from "@/components/ui/cancel-button";
import { Combobox } from "@/components/ui/combobox";
import { DateInput } from "@/components/ui/date-input";
import { Field, FormBody, FormRow, FormSection } from "@/components/ui/form";
import { MoneyInput } from "@/components/ui/money-input";
import { useToast } from "@/components/ui/toast";
import { TransferActions } from "@/components/inventory/transfer-actions";
import { TransferReceiptLotDialog, newTransferLotKey, type TransferReceiptLot } from "@/components/inventory/transfer-receipt-lot-dialog";
import { createTransferReceiptAction, transitionTransferReceiptAction, updateTransferReceiptAction } from "@/app/actions/stock-transfer";
import {
  STOCK_TRANSFER_RECEIPT_STATUS_BADGE,
  STOCK_TRANSFER_RECEIPT_STATUS_TEXT,
  STOCK_TRANSFER_RECEIPT_TRANSITIONS,
  availableStockTransferReceiptActions,
  stockTransferReceiptIsEditable,
  type StockTransferReceiptAbilities,
} from "@/lib/erp/stock-transfer-workflow";
import type { ReceiptSource, TransferReceiptView } from "@/lib/erp/stock-transfer-receipt";
import { formatDate, formatNumber, todayIso } from "@/lib/format";
import { DocumentHeader } from "@/components/ui/document-header";
import { FormTabs, tabHasError } from "@/components/ui/form-tabs";
import { SaveButtons, firstStep, withStep } from "@/components/ui/save-buttons";

/**
 * A Transfer Terima in its three modes (P300, Stock-Transfer-Plan.md §3.2).
 *
 * A new one first names the Transfer Kirim in transit to one of the user's
 * warehouses (OD-9); the page reloads on it (`?from=`), so only that transfer
 * is read. Every line still on the way starts filled with what is left, its
 * lots spread in order; the receiver lowers what did not arrive — it stays in
 * transit (OD-7) — and, where the destination keeps locations, says where each
 * lot goes, in the lot dialog. Quantities only (OD-6).
 */

type LineState = { key: string; transfer_line_id: number; qty: string; lots: TransferReceiptLot[] };

let seq = 0;
const newKey = () => `r${Date.now().toString(36)}${seq++}`;
const qtyText = (n: number) => formatNumber(n, n % 1 ? 2 : 0);
const units = (v: string | number) => Math.round((Number(String(v).replace(",", ".")) || 0) * 10_000);

function startLines(source: ReceiptSource): LineState[] {
  const oneLocation = source.locations?.filter((l) => l.active).length === 1 ? source.locations.find((l) => l.active)!.id : null;
  return source.lines
    .filter((l) => units(l.room) > 0)
    .map((l) => ({
      key: newKey(),
      transfer_line_id: l.id,
      qty: String(l.room),
      lots: l.trackings.filter((t) => units(t.room) > 0).map((t) => ({ key: newTransferLotKey(), transfer_tracking_id: t.id, location_id: oneLocation, qty: String(t.room) })),
    }));
}

export function TransferReceiptForm({
  mode,
  receipt,
  source,
  sources,
  can,
}: {
  mode: "new" | "edit" | "view";
  receipt: TransferReceiptView | null;
  /** The Transfer Kirim received, once chosen. */
  source: ReceiptSource | null;
  /** For a new receipt without a source yet: the transfers it may take. */
  sources: { id: number; label: string; name: string; active: boolean }[];
  can: StockTransferReceiptAbilities;
}) {
  const router = useRouter();
  const toast = useToast();
  const editing = mode !== "view";
  const [date, setDate] = useState(receipt?.header.receipt_date ?? todayIso());
  const [note, setNote] = useState(receipt?.header.note ?? "");
  const [lines, setLines] = useState<LineState[]>(() =>
    receipt
      ? receipt.lines.map((l) => ({
          key: newKey(),
          transfer_line_id: l.transfer_line_id,
          qty: String(l.qty),
          lots: (l.picks ?? []).map((p) => ({ key: newTransferLotKey(), transfer_tracking_id: p.transfer_tracking_id, location_id: p.location_id, qty: String(p.qty) })),
        }))
      : source
        ? startLines(source)
        : []
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [lotsFor, setLotsFor] = useState<string | null>(null);

  const status = receipt?.status ?? "Draft";
  const lineOf = (id: number) => source?.lines.find((l) => l.id === id);
  const touch = (...names: string[]) => {
    setDirty(true);
    setErrors((e) => {
      const next = { ...e };
      for (const n of names) delete next[n];
      return next;
    });
  };
  const setLine = (key: string, patch: Partial<LineState>) => {
    setLines((ls) =>
      ls.map((l) => {
        if (l.key !== key) return l;
        const next = { ...l, ...patch };
        // One lot in the line follows a changed Qty, as on the Receipt Note (P290).
        if (patch.qty !== undefined && !patch.lots && l.lots.length === 1) next.lots = [{ ...l.lots[0], qty: patch.qty }];
        return next;
      })
    );
    touch("_lines");
  };

  // Every editable document is a Draft, so its next step is the Draft's (P309).
  const next = firstStep(availableStockTransferReceiptActions("Draft", can), STOCK_TRANSFER_RECEIPT_TRANSITIONS);

  async function onSave(step?: string) {
    if (!source) return;
    setSaving(true);
    const sent = lines;
    const header = { stock_transfer_id: source.id, receipt_date: date, note };
    const payload = sent.map((l) => ({ transfer_line_id: l.transfer_line_id, qty: l.qty, note: "", picks: l.lots.map((x) => ({ transfer_tracking_id: x.transfer_tracking_id, location_id: x.location_id, qty: x.qty })) }));
    const result = mode === "edit" ? await updateTransferReceiptAction(receipt!.id, header, payload) : await createTransferReceiptAction(header, payload);
    setSaving(false);
    if (!result.ok) {
      const mapped: Record<string, string> = {};
      for (const [k, v] of Object.entries(result.errors)) {
        const m = /^lines\.(\d+)\.(\w+)$/.exec(k);
        if (m) mapped[`lines.${sent[Number(m[1])]?.key}.${m[2]}`] = v;
        else mapped[k] = v;
      }
      setErrors(mapped);
      toast(result.errors._form ? "Tidak diizinkan" : "Belum bisa disimpan", result.errors._form ?? result.errors._lines ?? Object.values(result.errors)[0] ?? "Periksa kembali isian.", "err");
      return;
    }
    setDirty(false);
    toast("Transfer Terima disimpan", `${result.receiptNo} · Draft`, "ok");
    router.push(withStep(`/inventory/stock-transfer-receipt/${result.id}`, step));
  }

  const backHref = receipt ? `/inventory/stock-transfer-receipt/${receipt.id}` : "/inventory/stock-transfer-receipt";
  const ro = (node: React.ReactNode) => <div className="ro">{node}</div>;
  const place = (label: string, name: string) =>
    ro(
      <>
        <span className="lab">{label}</span>
        <span>{name}</span>
      </>
    );

  const headerCard = (
    <div className="card">
      <FormBody>
        <FormSection title="Penerimaan">
          <FormRow>
            <Field label="Transfer Kirim" span={3} required={mode === "new"} locked={Boolean(source) && editing} error={errors.stock_transfer_id} help={mode === "new" && !source ? "kiriman ke gudang Anda" : undefined}>
              {source ? (
                ro(
                  <Link className="drl" href={`/inventory/stock-transfer/${source.id}`}>
                    <span className="mono">{source.transferNo}</span>
                  </Link>
                )
              ) : (
                <Combobox
                  value={null}
                  options={sources}
                  placeholder="Pilih Transfer Kirim…"
                  emptyText="Tidak ada Transfer Kirim dalam perjalanan ke gudang Anda."
                  onChange={(v) => v && router.push(`/inventory/stock-transfer-receipt/new?from=${v}`)}
                />
              )}
            </Field>
            <Field label="Gudang Asal" span={3}>
              {source ? place(source.fromLabel, source.fromName) : <div className="ro nil">Pilih Transfer Kirim dulu…</div>}
            </Field>
            <Field label="Gudang Tujuan" span={3}>
              {source ? place(source.toLabel, source.toName) : <div className="ro nil">Pilih Transfer Kirim dulu…</div>}
            </Field>
            <Field label="Tanggal Terima" span={3} required={editing} error={errors.receipt_date} help={editing && source ? `tidak sebelum ${formatDate(source.transferDate)}` : undefined}>
              {editing ? (
                <DateInput
                  value={date}
                  invalid={Boolean(errors.receipt_date)}
                  onChange={(v) => {
                    setDate(v);
                    touch("receipt_date");
                  }}
                />
              ) : (
                ro(formatDate(date))
              )}
            </Field>
            <Field label="Catatan" span={12}>
              {editing ? (
                <textarea
                  className="ta"
                  rows={1}
                  value={note}
                  placeholder="Catatan penerimaan, mis. barang kurang atau rusak…"
                  onChange={(e) => {
                    setNote(e.target.value);
                    touch();
                  }}
                />
              ) : note ? (
                <div className="ro multi">{note}</div>
              ) : (
                <div className="ro multi nil opt">tidak diisi</div>
              )}
            </Field>
          </FormRow>
        </FormSection>
        {receipt?.cancelReason && status === "Cancelled" && (
          <p className="fnote">
            <b>Dibatalkan:</b> {receipt.cancelReason}
          </p>
        )}
      </FormBody>
    </div>
  );

  const lotSummary = (l: LineState) => {
    const line = lineOf(l.transfer_line_id);
    const split = l.lots.reduce((s, x) => s + units(x.qty), 0);
    const full = split === units(l.qty) && split > 0;
    const unplaced = Boolean(source?.locations) && l.lots.some((x) => !x.location_id);
    if (!editing) {
      const stored = receipt?.lines.find((x) => x.transfer_line_id === l.transfer_line_id);
      return (
        <span className="dstack" style={{ gap: 4 }}>
          {(stored?.pickedLots ?? []).map((p, i) => (
            <span key={i} className="dstack">
              <span className="lab">{p.lotNo}</span>
              <span className="d2">
                {qtyText(p.qty)} {line?.uomLabel}
                {p.expiry ? ` · ED ${formatDate(p.expiry)}` : ""}
                {p.locationLabel ? ` · ${p.locationLabel}` : ""}
              </span>
            </span>
          ))}
        </span>
      );
    }
    return (
      <>
        <button className="btn sm" onClick={() => setLotsFor(l.key)}>
          <Icon name="layers" size={14} /> Atur Lot
        </button>
        <span className={full && !unplaced ? "fulltag" : "overtag"}>
          {l.lots.length} lot · {qtyText(split / 10_000)} / {qtyText(units(l.qty) / 10_000)}
          {unplaced ? " · lokasi belum dipilih" : ""}
        </span>
      </>
    );
  };

  const linesCard = source && (
    <div className="card">
      <div className="card-h">
        <span className="ci">
          <Icon name="box" size={15} />
        </span>
        <div className="ct">
          <h3>Barang Diterima</h3>
          <p>
            {editing
              ? "Isi yang benar-benar tiba. Yang kurang tetap di Gudang Transit dan bisa diterima dengan Transfer Terima berikutnya."
              : "Jumlah yang diterima per lot dan lokasinya di gudang tujuan."}
          </p>
        </div>
      </div>
      {errors._lines && (
        <div className="nbox bad slim">
          <Icon name="warn" size={15} className="ni" />
          <div>
            <b>{errors._lines}</b>
          </div>
        </div>
      )}
      {lines.length === 0 ? (
        <div className="empty sm">
          <h4>Tidak ada yang tersisa untuk diterima</h4>
          <p>Seluruh barang Transfer Kirim ini sudah diterima atau sedang di Draft lain.</p>
        </div>
      ) : (
        <div className="tw">
          <table className="grid ltab" style={{ minWidth: 880 }}>
            <thead>
              <tr>
                <th style={{ width: 40 }}>No</th>
                <th>Barang</th>
                <th className="num" style={{ width: 100 }}>
                  Dikirim
                </th>
                {editing && (
                  <th className="num" style={{ width: 110 }}>
                    Sisa
                  </th>
                )}
                <th style={{ width: editing ? 190 : 110 }}>Qty</th>
                <th style={{ width: editing ? 200 : 280 }}>Lot</th>
                {editing && <th style={{ width: 40 }} />}
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => {
                const line = lineOf(l.transfer_line_id);
                const err = errors[`lines.${l.key}.qty`] ?? errors[`lines.${l.key}.picks`];
                const over = units(l.qty) > units(line?.room ?? 0);
                return (
                  <tr key={l.key} className={err || (editing && over) ? "overrow" : undefined}>
                    <td className="no">{i + 1}</td>
                    <td>
                      <span className="idc">
                        <span className="lab">{line?.itemLabel}</span>
                        <span className="nm">{line?.itemName}</span>
                      </span>
                      {err && <span className="overtag">{err}</span>}
                    </td>
                    <td className="num">
                      <span className="mny">{qtyText(line?.qty ?? 0)}</span>
                    </td>
                    {editing && (
                      <td className="num">
                        <span className="mny">
                          {qtyText(line?.room ?? 0)} {line?.uomLabel}
                        </span>
                      </td>
                    )}
                    <td>
                      {editing ? (
                        <div className="qcell">
                          <MoneyInput size="sm" decimals={4} value={l.qty} over={over} ariaLabel={`Qty ${line?.itemLabel ?? ""}`} onChange={(v) => setLine(l.key, { qty: v })} />
                          <span className="qu">{line?.uomLabel}</span>
                        </div>
                      ) : (
                        <span className="qview">
                          <span className="mny">{qtyText(Number(l.qty))}</span>
                          <span className="lab">{line?.uomLabel}</span>
                        </span>
                      )}
                    </td>
                    <td>{lotSummary(l)}</td>
                    {editing && (
                      <td>
                        <button
                          className="iact del"
                          title="Hapus baris"
                          onClick={() => {
                            setLines((ls) => ls.filter((x) => x.key !== l.key));
                            touch("_lines");
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
      )}
      {lotsFor &&
        (() => {
          const l = lines.find((x) => x.key === lotsFor);
          const line = l ? lineOf(l.transfer_line_id) : undefined;
          if (!l || !line) return null;
          return (
            <TransferReceiptLotDialog
              itemLabel={line.itemLabel}
              uomLabel={line.uomLabel}
              lineQty={units(l.qty) / 10_000}
              trackings={line.trackings}
              locations={source.locations}
              lots={l.lots}
              onApply={(lots) => {
                setLine(l.key, { lots });
                touch(`lines.${l.key}.picks`);
                setLotsFor(null);
              }}
              onClose={() => setLotsFor(null)}
            />
          );
        })()}
    </div>
  );

  return (
    <>
      <DocumentHeader
        module="Persediaan"
        trail={[{ label: "Transfer Terima", href: "/inventory/stock-transfer-receipt" }]}
        icon="down"
        number={receipt?.receiptNo}
        placeholder="Transfer Terima Baru"
        status={status}
        statusLabel={{ text: STOCK_TRANSFER_RECEIPT_STATUS_TEXT[status], tone: STOCK_TRANSFER_RECEIPT_STATUS_BADGE[status] }}
        editing={mode === "edit"}
        dirty={editing && dirty}
      >
        {editing ? (
          <>
            <CancelButton href={backHref} dirty={dirty} disabled={saving} />
            <SaveButtons saving={saving} disabled={saving || !source || !lines.length} onSave={onSave} next={next} />
          </>
        ) : (
          <TransferActions
            subject={receipt!.receiptNo}
            actions={availableStockTransferReceiptActions(status, can)}
            transitions={STOCK_TRANSFER_RECEIPT_TRANSITIONS}
            editHref={stockTransferReceiptIsEditable(status) && can.edit ? `/inventory/stock-transfer-receipt/${receipt!.id}/edit` : null}
            lockText={status === "Cancelled" ? "Transfer Terima dibatalkan" : "Transfer Terima diposting"}
            run={(a, r) => transitionTransferReceiptAction(receipt!.id, a, r)}
          />
        )}
      </DocumentHeader>
      <div className="fgrid solo">
        <div>
          {headerCard}
          <FormTabs
            tabs={[
              { key: "lines", label: "Barang", icon: "box", count: lines.length, bad: tabHasError(errors, "_lines", "lines.", "line."), content: linesCard || <div className="card"><div className="empty sm"><h4>Pilih Transfer Kirim dulu…</h4><p>Barang yang dapat diterima mengikuti Transfer Kirim.</p></div></div> },
            ]}
          />
        </div>
      </div>
    </>
  );
}
