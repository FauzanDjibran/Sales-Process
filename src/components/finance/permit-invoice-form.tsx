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
import { InvoiceActions } from "@/components/finance/invoice-actions";
import { createPermitInvoiceAction, updatePermitInvoiceAction } from "@/app/actions/permit-invoice";
import { advancePpnUsed, computeInvoice, type PriceMode } from "@/lib/erp/sales-tax";
import { INVOICE_STATUS_BADGE, INVOICE_STATUS_TEXT, type InvoiceAbilities } from "@/lib/erp/ar-invoice-workflow";
import type { PermitInvoiceOptions, PermitInvoiceView } from "@/lib/erp/permit-invoice";
import { formatDate, formatMoney, formatPct, todayIso } from "@/lib/format";

/**
 * Invoice Perizinan (P137, Perizinan-Concept.md §9), in three modes. One
 * realised Pengajuan, billed as **one line** — the Uraian the customer sees —
 * at its realisation; the permits stay on the Pengajuan, linked (Z1). The
 * Pengajuan's own Uang Muka is picked with the DPP used, its PPN recalculated
 * (P118); every figure is `computeInvoice` over that one line, the function
 * Posting stores from.
 */

export type PermitInvoiceMode = "new" | "edit" | "view";

type Ded = { ar_item_id: number; dpp_used: string };

const MODE_TEXT: Record<PriceMode, string> = { Exclude: "Exclude PPN", Include: "Include PPN" };
const money = (n: number) => formatMoney(n, "IDR");
const describe = (productName: string, realizationNo: string | null) =>
  `Jasa pengurusan perizinan — ${productName}${realizationNo ? ` · realisasi ${realizationNo}` : ""}`;

function addDays(iso: string, days: number): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return "";
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function PermitInvoiceForm({
  mode,
  invoice,
  options,
  can,
  payments = [],
}: {
  mode: PermitInvoiceMode;
  invoice: PermitInvoiceView | null;
  options: PermitInvoiceOptions;
  can: InvoiceAbilities;
  payments?: { id: number; txNo: string; status: string; settled: number }[];
}) {
  const router = useRouter();
  const toast = useToast();
  const editing = mode !== "view";

  const [h, setH] = useState(() =>
    invoice
      ? { ...invoice.input, permit_request_id: Number(invoice.input.permit_request_id) }
      : {
          permit_request_id: null as number | null,
          invoice_date: todayIso(),
          address_id: null as number | null,
          cash_bank_id: options.banks.filter((b) => b.active).length === 1 ? options.banks.find((b) => b.active)!.id : (null as number | null),
          description: "",
          note: "",
        }
  );
  const [deds, setDeds] = useState<Ded[]>(() => (invoice?.deductions ?? []).map((d) => ({ ar_item_id: d.ar_item_id, dpp_used: String(d.dpp_used) })));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  const source = options.sources.find((s) => s.id === h.permit_request_id) ?? null;
  const touch = (...names: string[]) => {
    setDirty(true);
    setErrors((e) => {
      const next = { ...e };
      for (const n of names) delete next[n];
      return next;
    });
  };

  /** Choosing the Pengajuan fills the billing address, the Uraian and its Uang Muka as far as they reach (Z16). */
  const pick = (id: number | null) => {
    const s = options.sources.find((x) => x.id === id) ?? null;
    setH((x) => ({
      ...x,
      permit_request_id: id,
      address_id: s ? (s.addresses.find((a) => a.isBilling)?.id ?? s.addressId) : null,
      description: s ? describe(s.productName, s.realizationNo) : "",
    }));
    let room = s ? computeInvoice({ lines: [line(s)], mode: s.basis.mode, taxable: s.basis.taxable, rates: s.rates, advanceUsed: 0 }).dpp : 0;
    const next: Ded[] = [];
    for (const a of s?.advances ?? []) {
      const take = Math.min(Math.max(0, a.balance - a.reserved), room);
      if (take > 0) {
        next.push({ ar_item_id: a.id, dpp_used: String(take) });
        room -= take;
      }
    }
    setDeds(next);
    touch("permit_request_id", "address_id", "description", "_deductions");
  };

  const rates = source?.rates ?? null;
  const advanceUsed = deds.reduce((a, d) => a + (Number(d.dpp_used) || 0), 0);
  const advancePpn = deds.reduce((a, d) => {
    const item = source?.advances.find((x) => x.id === d.ar_item_id);
    return a + (item && source?.basis.taxable ? advancePpnUsed({ rates, usedBefore: item.original - item.balance, used: Number(d.dpp_used) || 0 }) : 0);
  }, 0);
  const figures = useMemo(
    () =>
      source
        ? computeInvoice({ lines: [line(source)], mode: source.basis.mode, taxable: source.basis.taxable, rates: source.rates, advanceUsed, advancePpn })
        : null,
    [source, advanceUsed, advancePpn]
  );
  const shown = mode === "view" && invoice ? invoice.figures : null;

  async function onSave() {
    setSaving(true);
    const payload = deds.map((d) => ({ ar_item_id: d.ar_item_id, dpp_used: Number(d.dpp_used) || 0 }));
    const result =
      mode === "edit" ? await updatePermitInvoiceAction(invoice!.id, h, payload) : await createPermitInvoiceAction(h, payload);
    setSaving(false);
    if (!result.ok) {
      setErrors(result.errors);
      toast(result.errors._form ? "Tidak diizinkan" : "Belum bisa disimpan", result.errors._form ?? result.errors._deductions ?? "Periksa kembali isian.", "err");
      return;
    }
    setDirty(false);
    toast("Invoice Perizinan disimpan", `${result.invoiceNo} · Draft`, "ok");
    router.push(`/finance/invoice/permit/${result.id}`);
  }

  const status = invoice?.status ?? "Draft";
  const backHref = invoice ? `/finance/invoice/permit/${invoice.id}` : "/finance/invoice/permit";
  const ro = (node: React.ReactNode) => <div className="ro">{node}</div>;
  const nil = (t = "tidak diisi") => <div className="ro nil">{t}</div>;
  const wait = "menunggu Pengajuan";

  const header = (
    <div className="card">
      <FormBody>
        <FormSection title="Pengajuan">
          <FormRow>
            <Field
              label="Pengajuan Perizinan"
              span={6}
              required={mode === "new"}
              locked={mode === "edit"}
              help={mode === "new" ? "Terealisasi, belum ditagih" : undefined}
              error={errors.permit_request_id}
            >
              {mode === "new" ? (
                <Combobox
                  value={h.permit_request_id}
                  options={options.sources.map((s) => ({ id: s.id, label: s.orderNo, name: `${s.customerName} · ${s.productName}`, active: true }))}
                  placeholder="Pilih Pengajuan Perizinan…"
                  emptyText="Belum ada Pengajuan Perizinan terealisasi yang belum ditagih."
                  invalid={Boolean(errors.permit_request_id)}
                  onChange={pick}
                />
              ) : source ? (
                ro(
                  <>
                    <Link className="drl" href={`/sales/permit/${source.id}`}>
                      <span className="mono">{source.orderNo}</span>
                    </Link>
                    {source.realizationNo && <span className="rx">realisasi {source.realizationNo}</span>}
                  </>
                )
              ) : (
                nil()
              )}
            </Field>
            <Field label="Customer" span={6}>
              {source
                ? ro(
                    <>
                      <span className="lab">{source.customerLabel}</span>
                      <span>{source.customerName}</span>
                    </>
                  )
                : nil(wait)}
            </Field>
            <Field label="Alamat Penagihan" span={12} required={editing} error={errors.address_id}>
              {editing ? (
                <Select
                  value={h.address_id ? String(h.address_id) : ""}
                  options={(source?.addresses ?? []).map((a) => ({ value: String(a.id), label: a.text, hint: a.isBilling ? "Penagihan" : "" }))}
                  placeholder="Pilih Alamat…"
                  waitingFor={source ? null : "Pilih Pengajuan dulu…"}
                  invalid={Boolean(errors.address_id)}
                  listWidth="wide"
                  onChange={(v) => {
                    setH((x) => ({ ...x, address_id: v ? Number(v) : null }));
                    touch("address_id");
                  }}
                />
              ) : (
                ro(source?.addresses.find((a) => a.id === h.address_id)?.text ?? "")
              )}
            </Field>
            <Field label="PPN" span={4}>
              {source
                ? ro(
                    <span className={`bdg ${source.basis.taxable ? "s-ok" : "s-mute"}`}>
                      {source.basis.taxable ? `Kena PPN · ${MODE_TEXT[source.basis.mode]}` : "Tidak Kena PPN"}
                    </span>
                  )
                : nil(wait)}
            </Field>
            <Field label="Jenis PPh" span={4}>
              {source?.withholdingTaxId
                ? ro(
                    <>
                      <span className="lab">{source.withholdingLabels[String(source.withholdingTaxId)]}</span>
                      <span>{formatPct(source.withholdingRate ?? 0)}</span>
                    </>
                  )
                : nil(source ? "Tanpa PPh" : wait)}
            </Field>
            <Field label="Termin" span={4}>
              {source ? ro(<span className="lab">{source.termLabel}</span>) : nil(wait)}
            </Field>
          </FormRow>
        </FormSection>
        <FormSection title="Invoice">
          <FormRow>
            <Field label="Tanggal Invoice" span={3} required={editing} help={editing ? "juga tanggal faktur pajak" : undefined} error={errors.invoice_date}>
              {editing ? (
                <DateInput
                  value={h.invoice_date}
                  invalid={Boolean(errors.invoice_date)}
                  onChange={(v) => {
                    setH((x) => ({ ...x, invoice_date: v }));
                    touch("invoice_date");
                  }}
                />
              ) : (
                ro(formatDate(h.invoice_date))
              )}
            </Field>
            <Field label="Jatuh Tempo" span={3}>
              {source ? ro(formatDate(invoice && !editing ? invoice.dueDate : addDays(h.invoice_date, source.termDays))) : nil(wait)}
            </Field>
            <Field label="Rekening Pembayaran" span={6} required={editing} help={editing ? "tercetak pada invoice" : undefined} error={errors.cash_bank_id}>
              {editing ? (
                <Combobox
                  value={h.cash_bank_id}
                  options={options.banks}
                  placeholder="Pilih Rekening…"
                  invalid={Boolean(errors.cash_bank_id)}
                  onChange={(v) => {
                    setH((x) => ({ ...x, cash_bank_id: v }));
                    touch("cash_bank_id");
                  }}
                />
              ) : (
                ro(
                  <>
                    <span className="lab">{invoice?.bankLabel}</span>
                    <span>{invoice?.bankName}</span>
                  </>
                )
              )}
            </Field>
            {!editing && invoice?.status === "Posted" && (
              <Field label="Pembayaran" span={12}>
                {ro(
                  <>
                    <span className={`bdg ${invoice.paid >= invoice.figures.total ? "t-ok" : invoice.paid > 0 ? "t-info" : "t-warn"}`}>
                      {invoice.paid >= invoice.figures.total ? "Lunas" : invoice.paid > 0 ? `Sebagian · ${money(invoice.paid)}` : "Belum Dibayar"}
                    </span>
                    {payments.map((p) => (
                      <Link key={p.id} className="drl" href={`/finance/cash-bank/receipt/${p.id}`}>
                        <span className="mono">{p.txNo}</span>
                      </Link>
                    ))}
                  </>
                )}
              </Field>
            )}
            <Field label="Catatan" span={12}>
              {editing ? (
                <textarea
                  className="ta"
                  rows={2}
                  value={h.note}
                  placeholder="Catatan internal, tidak tercetak…"
                  onChange={(e) => {
                    setH((x) => ({ ...x, note: e.target.value }));
                    setDirty(true);
                  }}
                />
              ) : h.note ? (
                <div className="ro multi">{h.note}</div>
              ) : (
                <div className="ro multi nil">tidak diisi</div>
              )}
            </Field>
          </FormRow>
        </FormSection>
        {invoice?.status === "Cancelled" && invoice.cancelReason && (
          <p className="fnote">
            <b>Dibatalkan:</b> {invoice.cancelReason}
          </p>
        )}
      </FormBody>
    </div>
  );

  const v = shown ?? (figures ? { amount: figures.amount, dpp: figures.dpp, advanceDpp: figures.advanceUsed, advancePpn: figures.advancePpn, netDpp: figures.netDpp, dppOther: figures.dppOther, fullPpn: figures.fullPpn, ppn: figures.ppn, total: figures.total } : null);

  const lineCard = (
    <div className="card" style={{ marginTop: 14 }}>
      <div className="card-h">
        <span className="ci">
          <Icon name="clip" size={15} />
        </span>
        <div className="ct">
          <h3>Perizinan Ditagih</h3>
          <p>Satu baris sebesar realisasi — rincian per perizinan ada di Pengajuannya.</p>
        </div>
      </div>
      {!source || !v ? (
        <div className="empty sm">
          <div className="ic">
            <Icon name="clip" size={18} />
          </div>
          <h4>Pilih realisasi perizinan</h4>
          <p>Nilai invoice diambil dari realisasi sebagai satu baris.</p>
        </div>
      ) : (
        <div className="tw">
          <table className="grid ltab">
            <thead>
              <tr>
                <th style={{ width: 34 }}>No</th>
                <th>Uraian pada Invoice</th>
                <th className="num" style={{ width: 150 }}>DPP</th>
                <th className="num" style={{ width: 140 }}>PPN</th>
              </tr>
            </thead>
            <tbody>
              <tr className={errors.description ? "overrow" : undefined}>
                <td className="no">1</td>
                <td>
                  <span className="dstack">
                    {editing ? (
                      <input
                        className={`inp sm${errors.description ? " bad" : ""}`}
                        value={h.description}
                        aria-label="Uraian pada Invoice"
                        onChange={(e) => {
                          setH((x) => ({ ...x, description: e.target.value }));
                          touch("description");
                        }}
                      />
                    ) : (
                      <span className="d1">{h.description}</span>
                    )}
                    <span className="d2">
                      {source.orderNo} · {source.lineCount} perizinan
                    </span>
                  </span>
                  {errors.description && <span className="overtag">{errors.description}</span>}
                </td>
                <td className="num">
                  <span className="mny">{money(v.dpp)}</span>
                </td>
                <td className="num">
                  <span className="mny">{money(v.fullPpn)}</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );

  const advances = source?.advances ?? [];
  const advanceCard = source && (advances.length > 0 || deds.length > 0) && (
    <div className="card" style={{ marginTop: 14 }}>
      <div className="card-h">
        <span className="ci">
          <Icon name="wallet" size={15} />
        </span>
        <div className="ct">
          <h3>Uang Muka Dipakai</h3>
          <p>Uang Muka Perizinan Pengajuan ini; DPP yang dipakai diisi per item, PPN-nya dihitung ulang.</p>
        </div>
      </div>
      {errors._deductions && (
        <div className="nbox bad slim">
          <Icon name="warn" size={15} className="ni" />
          <div>
            <b>{errors._deductions}</b>
          </div>
        </div>
      )}
      <div className="tw">
        <table className="grid ltab">
          <thead>
            <tr>
              <th>AR Item</th>
              <th className="num" style={{ width: 150 }}>Sisa</th>
              <th className="num" style={{ width: 170 }}>DPP Dipakai</th>
            </tr>
          </thead>
          <tbody>
            {(editing ? advances : (invoice?.deductions ?? []).map((d) => ({ id: d.ar_item_id, arItemNo: d.ar_item_no, balance: 0, reserved: 0, sourceNo: "" }))).map((a, i) => {
              const d = deds.find((x) => x.ar_item_id === a.id);
              const err = errors[`deductions.${deds.findIndex((x) => x.ar_item_id === a.id)}.dpp_used`];
              return (
                <tr key={a.id} className={err ? "overrow" : undefined}>
                  <td>
                    <span className="idc">
                      <span className="lab">{a.arItemNo}</span>
                      <span className="nm">{a.sourceNo}</span>
                    </span>
                    {err && <span className="overtag">{err}</span>}
                  </td>
                  <td className="num">{editing ? <span className="mny">{money(Math.max(0, a.balance - a.reserved))}</span> : <span className="dash">—</span>}</td>
                  <td className="num">
                    {editing ? (
                      <MoneyInput
                        size="sm"
                        value={d?.dpp_used ?? ""}
                        ariaLabel={`DPP dipakai ${i + 1}`}
                        onChange={(val) => {
                          setDeds((xs) => {
                            const rest = xs.filter((x) => x.ar_item_id !== a.id);
                            return Number(val) > 0 ? [...rest, { ar_item_id: a.id, dpp_used: val }] : rest;
                          });
                          touch("_deductions");
                        }}
                      />
                    ) : (
                      <span className="mny">{money(Number(d?.dpp_used ?? 0))}</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );

  const figuresBox = v && source && (
    <div className="card" style={{ marginTop: 14 }}>
      <div className="cardfoot multi" style={{ borderTop: 0 }}>
        {figures && figures.withholdingTotal > 0 && (
          <div className="impact">
            <div className="ttl">Estimasi Penerimaan</div>
            <div className="ir">
              <span>Total Invoice</span>
              <b>{money(figures.total)}</b>
            </div>
            {figures.withholdings.map((w) => (
              <div className="ir" key={w.key}>
                <span>
                  {source.withholdingLabels[w.key] ?? "PPh"} {formatPct(w.rate)} × DPP {money(w.base)}
                </span>
                <b>−{money(w.amount)}</b>
              </div>
            ))}
            <div className="ir tot">
              <span>Estimasi dana diterima</span>
              <b>{money(figures.expectedReceipt)}</b>
            </div>
          </div>
        )}
        <div className="impact">
          <div className="ttl">Nilai Invoice · {source.basis.taxable ? MODE_TEXT[source.basis.mode] : "Tidak Kena PPN"}</div>
          <div className="ir">
            <span>DPP jasa perizinan</span>
            <b>{money(v.dpp)}</b>
          </div>
          {v.advanceDpp > 0 && (
            <div className="ir">
              <span>Uang muka dipakai (DPP)</span>
              <b>−{money(v.advanceDpp)}</b>
            </div>
          )}
          {source.basis.taxable && (
            <>
              <div className="ir">
                <span>DPP Nilai Lain ({rates ? `${rates.otherNum}/${rates.otherDen}` : "—"})</span>
                <b>{money(v.dppOther)}</b>
              </div>
              <div className="ir">
                <span>PPN {rates ? formatPct(rates.rate) : "—"} atas DPP penuh</span>
                <b>{money(v.fullPpn)}</b>
              </div>
              {v.advancePpn > 0 && (
                <div className="ir">
                  <span>PPN uang muka (sudah difakturkan)</span>
                  <b>−{money(v.advancePpn)}</b>
                </div>
              )}
            </>
          )}
          <div className="ir tot">
            <span>Total Invoice</span>
            <b>{money(v.total)}</b>
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <>
      <div className="ph">
        <div className="crumb">
          <span>Finance</span>
          <span>/</span>
          <span>Invoice</span>
          <span>/</span>
          <Link href="/finance/invoice/permit">Invoice Perizinan</Link>
          <span>/</span>
          <span className="cur">{invoice ? invoice.invoiceNo : "Baru"}</span>
        </div>
        <div className="ph-row">
          <h1>
            <span className="ph-ico">
              <Icon name="file" size={16} />
            </span>
            {invoice ? (
              <>
                <span className="docno">{invoice.invoiceNo}</span>
                <span className={`bdg ${INVOICE_STATUS_BADGE[status]}`}>{INVOICE_STATUS_TEXT[status]}</span>
              </>
            ) : (
              "Invoice Perizinan Baru"
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
              <InvoiceActions id={invoice!.id} subject={`${invoice!.invoiceNo} – ${money(invoice!.figures.total)}`} status={status} can={can} variant="permit" />
            )}
          </div>
        </div>
      </div>
      <div className="fgrid solo">
        <div>
          {header}
          {lineCard}
          {advanceCard}
          {figuresBox}
        </div>
      </div>
    </>
  );
}

/** The invoice's one line, as `computeInvoice` reads a line. */
function line(s: PermitInvoiceOptions["sources"][number]) {
  const amount = s.realized.amount;
  return {
    qty: 1,
    orderQty: 1,
    orderGross: amount,
    orderDiscount: 0,
    price: amount,
    discountType: null,
    discountValue: null,
    billedQtyBefore: 0,
    withholdingRate: s.withholdingRate,
    withholdingKey: s.withholdingTaxId ? String(s.withholdingTaxId) : null,
  };
}
