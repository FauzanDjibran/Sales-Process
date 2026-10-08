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
import { PermitRequestActions } from "@/components/sales/permit-request-actions";
import { PermitTypePicker } from "@/components/sales/permit-type-picker";
import {
  createPermitRequestAction,
  saveRealizationAction,
  updatePermitRequestAction,
} from "@/app/actions/permit-request";
import { computePermitTotals, ppnChain, type PermitTotals, type PriceMode } from "@/lib/erp/sales-tax";
import {
  PERMIT_REQUEST_REASON_TEXT,
  PERMIT_REQUEST_STATUS_BADGE,
  PERMIT_REQUEST_STATUS_TEXT,
  type PermitRequestAbilities,
} from "@/lib/erp/permit-request-workflow";
import type { PermitRequestOptions, PermitRequestView, PermitTypeOption } from "@/lib/erp/permit-request";
import { formatTaxId } from "@/lib/erp/partner-shape";
import { formatDate, formatMoney, formatPct, todayIso } from "@/lib/format";

/**
 * The Pengajuan Perizinan, in four modes: `new`, `edit` (Draft), `view`, and
 * `realization` — the same document opened to record the real price of each
 * permit (Z7), its estimates locked beside it.
 *
 * It is the internal document of the Perizinan flow (Z1): every permit is
 * listed here, while the customer's Uang Muka and Invoice carry one line. The
 * figures are `computePermitTotals`, the function the save stores from — PPN
 * once on the total, the faktur's single line (Z5).
 */

export type PermitFormMode = "new" | "edit" | "view" | "realization";

type LineState = {
  key: string;
  permit_type_id: number;
  description: string;
  estimate: string;
  realized: string;
  is_added: boolean;
};

type HeaderState = {
  request_date: string;
  customer_id: number | null;
  address_id: number | null;
  term_id: number | null;
  price_mode: PriceMode;
  is_taxable: boolean;
  withholding_tax_id: number | null;
  po_no: string;
  po_date: string;
  salesperson: string;
  product_name: string;
  note: string;
};

let seq = 0;
const newKey = () => `p${Date.now().toString(36)}${seq++}`;
const MODE_TEXT: Record<PriceMode, string> = { Exclude: "Exclude PPN", Include: "Include PPN" };
const money = (n: number) => formatMoney(n, "IDR");
const signed = (n: number) => (n > 0 ? `+${money(n)}` : n < 0 ? `−${money(-n)}` : money(0));

export function PermitRequestForm({
  mode,
  request,
  options,
  can,
  realizationLocked = false,
}: {
  mode: PermitFormMode;
  request: PermitRequestView | null;
  options: PermitRequestOptions;
  can: PermitRequestAbilities;
  realizationLocked?: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const headerEditing = mode === "new" || mode === "edit";
  const realizing = mode === "realization";
  const editing = headerEditing || realizing;

  const [header, setHeader] = useState<HeaderState>(() => {
    if (request) {
      const h = request.header;
      return {
        request_date: h.request_date,
        customer_id: Number(h.customer_id),
        address_id: Number(h.address_id),
        term_id: Number(h.term_id),
        price_mode: h.price_mode as PriceMode,
        is_taxable: h.is_taxable,
        withholding_tax_id: h.withholding_tax_id ? Number(h.withholding_tax_id) : null,
        po_no: h.po_no,
        po_date: h.po_date,
        salesperson: h.salesperson,
        product_name: h.product_name,
        note: h.note,
      };
    }
    return {
      request_date: todayIso(),
      customer_id: null,
      address_id: null,
      term_id: null,
      price_mode: "Exclude",
      is_taxable: true,
      withholding_tax_id: null,
      po_no: "",
      po_date: "",
      salesperson: "",
      product_name: "",
      note: "",
    };
  });
  const [lines, setLines] = useState<LineState[]>(() =>
    (request?.lines ?? []).map((l) => ({
      key: newKey(),
      permit_type_id: l.permitTypeId,
      description: l.description,
      estimate: String(l.estimatePrice),
      // Opening the realisation, every permit starts at its estimate until the
      // real price is typed (the simulation's startRealization).
      realized: l.realizedPrice != null ? String(l.realizedPrice) : realizing ? String(l.estimatePrice) : "",
      is_added: l.isAdded,
    }))
  );
  const [rz, setRz] = useState(() => ({
    date: request?.realization.date || todayIso(),
    note: request?.realization.note ?? "",
  }));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [picker, setPicker] = useState(false);

  const customer = options.customers.find((c) => c.id === header.customer_id) ?? null;
  const typeById = useMemo(() => new Map(options.permitTypes.map((t) => [t.id, t])), [options.permitTypes]);
  const wht = options.withholdingTaxes.find((t) => t.id === header.withholding_tax_id) ?? null;

  const touch = (...names: string[]) => {
    setDirty(true);
    setErrors((e) => {
      const next = { ...e };
      for (const n of names) delete next[n];
      return next;
    });
  };
  const set = <K extends keyof HeaderState>(k: K, v: HeaderState[K]) => {
    setHeader((h) => ({ ...h, [k]: v }));
    touch(k);
  };
  const pickCustomer = (id: number | null) => {
    const c = options.customers.find((x) => x.id === id) ?? null;
    setHeader((h) => ({
      ...h,
      customer_id: id,
      address_id: c?.addresses.find((a) => a.isBilling)?.id ?? c?.addresses[0]?.id ?? null,
      term_id: c?.defaultTermId ?? h.term_id,
      price_mode: c?.defaultPriceMode ?? h.price_mode,
    }));
    touch("customer_id", "address_id", "term_id", "price_mode");
  };
  const setLine = (key: string, patch: Partial<LineState>) => {
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
    touch("_lines");
  };

  const priceMode: PriceMode = header.is_taxable ? header.price_mode : "Exclude";
  const rates = headerEditing ? options.ppnRates : (request?.rates ?? null);
  const whtRate = headerEditing ? (wht?.rate ?? null) : (request?.withholdingRate ?? null);

  /** A permit's standard estimate in the document's price mode: Include adds its PPN by the chain. */
  const standardPrice = (t: PermitTypeOption): number | null => {
    if (t.standardEstimate == null) return null;
    if (!header.is_taxable || priceMode === "Exclude" || !rates) return t.standardEstimate;
    return t.standardEstimate + ppnChain(t.standardEstimate, rates).ppn;
  };

  const totalsOf = (prices: number[]): PermitTotals =>
    computePermitTotals({ prices, mode: priceMode, taxable: header.is_taxable, rates, withholdingRate: whtRate });
  const estimate = useMemo(
    () => totalsOf(lines.filter((l) => !l.is_added).map((l) => Number(l.estimate) || 0)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [lines, priceMode, header.is_taxable, rates, whtRate]
  );
  const showRealized = realizing || (request?.realization.entered ?? false);
  const realized = useMemo(
    () => totalsOf(lines.map((l) => Number(l.realized) || 0)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [lines, priceMode, header.is_taxable, rates, whtRate]
  );

  const addTypes = (ids: number[]) => {
    setLines((ls) => [
      ...ls,
      ...ids.map((id) => {
        const t = typeById.get(id)!;
        const price = standardPrice(t);
        return {
          key: newKey(),
          permit_type_id: id,
          description: t.description || t.name,
          estimate: realizing ? "0" : price != null ? String(price) : "",
          realized: realizing && price != null ? String(price) : "",
          is_added: realizing,
        };
      }),
    ]);
    setPicker(false);
    touch("_lines");
  };

  async function onSave() {
    setSaving(true);
    const result = realizing
      ? await saveRealizationAction(request!.id, {
          realization_date: rz.date,
          realization_note: rz.note,
          lines: lines.map((l) => ({
            permit_type_id: l.permit_type_id,
            description: l.description,
            realized_price: l.realized === "" ? null : Number(l.realized),
            is_added: l.is_added,
          })),
        })
      : await (mode === "edit"
          ? updatePermitRequestAction(request!.id, header, payloadLines())
          : createPermitRequestAction(header, payloadLines()));
    setSaving(false);
    if (!result.ok) {
      setErrors(result.errors);
      toast(
        result.errors._form ? "Tidak diizinkan" : "Belum bisa disimpan",
        result.errors._form ?? result.errors._lines ?? "Periksa kembali isian.",
        "err"
      );
      return;
    }
    setDirty(false);
    toast(realizing ? "Realisasi disimpan" : "Pengajuan Perizinan disimpan", result.requestNo, "ok");
    router.push(`/sales/permit/${result.id}`);
  }
  const payloadLines = () =>
    lines.map((l) => ({ permit_type_id: l.permit_type_id, description: l.description, estimate_price: Number(l.estimate) || 0 }));

  const status = request?.status ?? "Draft";
  const backHref = request ? `/sales/permit/${request.id}` : "/sales/permit";
  const ro = (node: React.ReactNode) => <div className="ro">{node}</div>;
  const nil = (text = "tidak diisi") => <div className="ro nil">{text}</div>;
  const waitCustomer = header.customer_id ? null : "Pilih Customer dulu…";

  // ======================================================= header card
  const headerCard = (
    <div className="card">
      <FormBody>
        <FormSection title="Customer">
          <FormRow>
            <Field
              label="Customer"
              span={6}
              required={headerEditing}
              help={headerEditing ? "pemilik produk maklon yang didaftarkan" : undefined}
              error={errors.customer_id}
            >
              {headerEditing ? (
                <Combobox
                  value={header.customer_id}
                  options={options.customers.map((c) => ({ id: c.id, label: c.label, name: c.name, active: c.active }))}
                  placeholder="Pilih Customer…"
                  invalid={Boolean(errors.customer_id)}
                  onChange={pickCustomer}
                />
              ) : (
                ro(
                  <>
                    <span className="lab">{request?.customerLabel}</span>
                    <span>{request?.customerName}</span>
                  </>
                )
              )}
            </Field>
            <Field label={customer?.taxIdType === "NIK" ? "NIK Pembeli" : "NPWP Pembeli"} span={3}>
              {customer?.taxId ? ro(<span className="mono">{formatTaxId(customer.taxId)}</span>) : nil("menunggu Customer")}
            </Field>
            <Field label="Status Pajak" span={3}>
              {customer ? ro(<span className="bdg t-slate">{customer.isPkp ? "PKP" : "Non-PKP"}</span>) : nil("menunggu Customer")}
            </Field>
            {headerEditing && customer && customer.problems.length > 0 && (
              <div className="fld f-12 full">
                <div className="nbox bad slim" style={{ margin: 0 }}>
                  <Icon name="warn" size={15} className="ni" />
                  <div>
                    <b>Customer ini belum dapat dipakai</b>
                    <p>{customer.problems.join(" ")}</p>
                  </div>
                </div>
              </div>
            )}
            <Field
              label="Alamat"
              span={12}
              required={headerEditing}
              help={headerEditing ? "alamat penagihan pada dokumen customer" : undefined}
              error={errors.address_id}
            >
              {headerEditing ? (
                <Select
                  value={header.address_id ? String(header.address_id) : ""}
                  options={(customer?.addresses ?? []).map((a) => ({
                    value: String(a.id),
                    label: a.text,
                    hint: [a.isBilling ? "Penagihan" : null, a.isShipping ? "Pengiriman" : null].filter(Boolean).join(" · "),
                  }))}
                  placeholder="Pilih Alamat…"
                  waitingFor={waitCustomer}
                  invalid={Boolean(errors.address_id)}
                  listWidth="wide"
                  onChange={(v) => set("address_id", v ? Number(v) : null)}
                />
              ) : (
                ro(<span>{request?.addressText}</span>)
              )}
            </Field>
          </FormRow>
        </FormSection>

        <FormSection title="Pengajuan">
          <FormRow>
            <Field label="Tanggal Pengajuan" span={3} required={headerEditing} error={errors.request_date}>
              {headerEditing ? (
                <DateInput value={header.request_date} invalid={Boolean(errors.request_date)} onChange={(v) => set("request_date", v)} />
              ) : (
                ro(formatDate(header.request_date))
              )}
            </Field>
            <Field label="No. PO Customer" span={3} help={headerEditing ? "jika ada" : undefined}>
              {headerEditing ? (
                <input
                  className="inp idf"
                  value={header.po_no}
                  placeholder="PO-001/IX/2026"
                  autoComplete="off"
                  onChange={(e) => set("po_no", e.target.value)}
                />
              ) : header.po_no ? (
                ro(<span className="mono">{header.po_no}</span>)
              ) : (
                nil()
              )}
            </Field>
            <Field label="Tanggal PO" span={3} error={errors.po_date}>
              {headerEditing ? (
                <DateInput value={header.po_date} invalid={Boolean(errors.po_date)} onChange={(v) => set("po_date", v)} />
              ) : header.po_date ? (
                ro(formatDate(header.po_date))
              ) : (
                nil()
              )}
            </Field>
            <Field label="Termin Pembayaran" span={3} required={headerEditing} error={errors.term_id}>
              {headerEditing ? (
                <Combobox
                  value={header.term_id}
                  options={options.terms}
                  placeholder="Pilih Termin Pembayaran…"
                  invalid={Boolean(errors.term_id)}
                  onChange={(v) => set("term_id", v)}
                />
              ) : (
                ro(
                  <>
                    <span className="lab">{request?.termLabel}</span>
                    <span>{request?.termName}</span>
                  </>
                )
              )}
            </Field>
            <Field
              label="Produk yang Didaftarkan"
              span={6}
              required={headerEditing}
              help={headerEditing ? "produk maklon milik customer" : undefined}
              error={errors.product_name}
            >
              {headerEditing ? (
                <input
                  className={`inp${errors.product_name ? " bad" : ""}`}
                  value={header.product_name}
                  placeholder='Serum Wajah "Glowin" 30 ml'
                  autoComplete="off"
                  onChange={(e) => set("product_name", e.target.value)}
                />
              ) : (
                ro(header.product_name)
              )}
            </Field>
            <Field label="Salesperson" span={6} help={headerEditing ? "opsional" : undefined}>
              {headerEditing ? (
                <input
                  className="inp"
                  value={header.salesperson}
                  placeholder="Nama salesperson"
                  autoComplete="off"
                  onChange={(e) => set("salesperson", e.target.value)}
                />
              ) : header.salesperson ? (
                ro(header.salesperson)
              ) : (
                nil()
              )}
            </Field>
          </FormRow>
        </FormSection>

        <FormSection title="Harga & Pajak">
          <FormRow>
            <Field label="PPN" span={4} help={headerEditing ? "berlaku untuk seluruh perizinan" : undefined}>
              {headerEditing ? (
                <label className="chk sm">
                  <input
                    type="checkbox"
                    checked={header.is_taxable}
                    onChange={(e) => {
                      const taxable = e.target.checked;
                      setHeader((h) => ({
                        ...h,
                        is_taxable: taxable,
                        price_mode: taxable ? (customer?.defaultPriceMode ?? h.price_mode) : h.price_mode,
                      }));
                      touch("is_taxable", "price_mode");
                    }}
                  />
                  <span>
                    <span className="ct">Kena PPN</span>
                  </span>
                </label>
              ) : (
                ro(
                  <span className={`bdg ${header.is_taxable ? "s-ok" : "s-mute"}`}>
                    {header.is_taxable ? "Kena PPN" : "Tidak Kena PPN"}
                  </span>
                )
              )}
            </Field>
            {header.is_taxable && (
              <Field
                label="Mode Harga"
                span={4}
                required={headerEditing}
                help={headerEditing ? "harga diketik sebelum atau sudah termasuk PPN" : undefined}
                error={errors.price_mode}
              >
                {headerEditing ? (
                  <Select
                    value={header.price_mode}
                    options={[
                      { value: "Exclude", label: MODE_TEXT.Exclude },
                      { value: "Include", label: MODE_TEXT.Include },
                    ]}
                    onChange={(v) => set("price_mode", (v || "Exclude") as PriceMode)}
                  />
                ) : (
                  ro(<span className="bdg t-slate">{MODE_TEXT[header.price_mode]}</span>)
                )}
              </Field>
            )}
            <Field
              label="Jenis PPh"
              span={4}
              help={headerEditing ? "dipotong customer atas jasa ini" : undefined}
              error={errors.withholding_tax_id}
            >
              {headerEditing ? (
                <Select
                  value={header.withholding_tax_id ? String(header.withholding_tax_id) : ""}
                  options={[
                    { value: "", label: "Tanpa PPh" },
                    ...options.withholdingTaxes
                      .filter((t) => t.active)
                      .map((t) => ({ value: String(t.id), label: t.label, hint: formatPct(t.rate) })),
                  ]}
                  onChange={(v) => set("withholding_tax_id", v ? Number(v) : null)}
                />
              ) : request?.withholdingLabel ? (
                ro(
                  <>
                    <span className="lab">{request.withholdingLabel}</span>
                    <span>{formatPct(request.withholdingRate ?? 0)}</span>
                  </>
                )
              ) : (
                nil("Tanpa PPh")
              )}
            </Field>
            <Field label="Catatan" span={12}>
              {headerEditing ? (
                <textarea
                  className="ta"
                  rows={2}
                  value={header.note}
                  placeholder="Keterangan pengajuan (opsional)…"
                  onChange={(e) => set("note", e.target.value)}
                />
              ) : header.note ? (
                <div className="ro multi">{header.note}</div>
              ) : (
                <div className="ro multi nil">tidak diisi</div>
              )}
            </Field>
          </FormRow>
        </FormSection>

        {request && request.status !== "Draft" && request.status !== "Submitted" && (
          <FormSection title="Realisasi">
            <FormRow>
              <Field label="No. Realisasi" span={3}>
                {request.realization.no ? ro(<span className="mono">{request.realization.no}</span>) : nil("diberikan saat direalisasi")}
              </Field>
              <Field label="Tanggal Realisasi" span={3} required={realizing} error={errors.realization_date}>
                {realizing ? (
                  <DateInput
                    value={rz.date}
                    invalid={Boolean(errors.realization_date)}
                    onChange={(v) => {
                      setRz((x) => ({ ...x, date: v }));
                      touch("realization_date");
                    }}
                  />
                ) : request.realization.date ? (
                  ro(formatDate(request.realization.date))
                ) : (
                  nil("belum direalisasi")
                )}
              </Field>
              <Field label="Catatan Realisasi" span={6}>
                {realizing ? (
                  <input
                    className="inp"
                    value={rz.note}
                    placeholder="mis. tarif uji laboratorium turun"
                    onChange={(e) => {
                      setRz((x) => ({ ...x, note: e.target.value }));
                      setDirty(true);
                    }}
                  />
                ) : request.realization.note ? (
                  ro(request.realization.note)
                ) : (
                  nil()
                )}
              </Field>
            </FormRow>
          </FormSection>
        )}
        {request?.statusReason && PERMIT_REQUEST_REASON_TEXT[request.status] && (
          <p className="fnote">
            <b>{PERMIT_REQUEST_REASON_TEXT[request.status]}:</b> {request.statusReason}
          </p>
        )}
      </FormBody>
    </div>
  );

  // ======================================================== lines card
  const lineErr = (i: number, f: string) => errors[`lines.${i}.${f}`];
  const canAdd = headerEditing || realizing;
  const linesCard = (
    <div className="card" style={{ marginTop: 14 }}>
      <div className="card-h">
        <span className="ci">
          <Icon name="clip" size={15} />
        </span>
        <div className="ct">
          <h3>Perizinan Diajukan</h3>
          <p>
            {realizing
              ? "Harga estimasi terkunci. Isi harga sebenarnya setiap perizinan — boleh naik atau turun, 0 bila tidak jadi diurus; perizinan yang tidak diestimasi ditambahkan dengan estimasi 0."
              : `Harga per perizinan dalam ${header.is_taxable ? MODE_TEXT[priceMode] : "rupiah, tanpa PPN"}. Dokumen customer memuat satu baris.`}
          </p>
        </div>
        {canAdd && (
          <button className="btn sm primary" disabled={headerEditing && !customer} onClick={() => setPicker(true)}>
            <Icon name="plus" size={14} /> Tambah Perizinan
          </button>
        )}
      </div>
      {headerEditing && header.is_taxable && !rates && (
        <div className="nbox bad slim">
          <Icon name="warn" size={15} className="ni" />
          <div>
            <b>Tarif PPN belum diatur</b>
            <p>Isi Tarif PPN dan faktor DPP Nilai Lain di Pengaturan › System Default sebelum menyimpan pengajuan Kena PPN.</p>
          </div>
        </div>
      )}
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
          <div className="ic">
            <Icon name="clip" size={18} />
          </div>
          <h4>{customer ? "Belum ada perizinan dipilih" : "Lengkapi header terlebih dahulu"}</h4>
          <p>{customer ? "Tekan Tambah Perizinan untuk memilih perizinan yang diurus." : "Pilih Customer terlebih dahulu — mode harga mengikuti customer."}</p>
        </div>
      ) : (
        <div className="tw">
          <table className="grid ltab" style={{ minWidth: showRealized ? 920 : 760 }}>
            <thead>
              <tr>
                <th style={{ width: 40 }}>No</th>
                <th style={{ width: 230 }}>Perizinan</th>
                <th>Uraian</th>
                <th className="num" style={{ width: 150 }}>
                  Harga Estimasi
                </th>
                {showRealized && (
                  <>
                    <th className="num" style={{ width: 150 }}>
                      Harga Realisasi
                    </th>
                    <th className="num" style={{ width: 124 }}>
                      Selisih
                    </th>
                  </>
                )}
                {(headerEditing || realizing) && <th style={{ width: 40 }} />}
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => {
                const t = typeById.get(l.permit_type_id);
                const view = request?.lines.find((x) => x.permitTypeId === l.permit_type_id);
                const descOpen = headerEditing || (realizing && l.is_added);
                const err = lineErr(i, "permit_type_id") ?? lineErr(i, "estimate_price") ?? lineErr(i, "realized_price");
                const removable = headerEditing || (realizing && l.is_added);
                return (
                  <tr key={l.key} className={err ? "overrow" : undefined}>
                    <td className="no">{i + 1}</td>
                    <td>
                      <span className="idc">
                        <span className="lab">{t?.label ?? view?.permitLabel}</span>
                        <span className="nm">
                          {t?.name ?? view?.permitName}
                          {l.is_added && <span className="bdg t-warn" style={{ marginLeft: 6 }}>tambahan</span>}
                        </span>
                      </span>
                      {err && <span className="overtag">{err}</span>}
                    </td>
                    <td>
                      {descOpen ? (
                        <input
                          className="inp sm"
                          value={l.description}
                          placeholder="Uraian perizinan…"
                          onChange={(e) => setLine(l.key, { description: e.target.value })}
                        />
                      ) : (
                        <span>{l.description}</span>
                      )}
                    </td>
                    <td className="num">
                      {headerEditing ? (
                        <MoneyInput size="sm" value={l.estimate} ariaLabel="Harga estimasi" onChange={(v) => setLine(l.key, { estimate: v })} />
                      ) : (
                        <span className="mny">{money(Number(l.estimate) || 0)}</span>
                      )}
                    </td>
                    {showRealized && (
                      <>
                        <td className="num">
                          {realizing ? (
                            <MoneyInput size="sm" value={l.realized} ariaLabel="Harga realisasi" onChange={(v) => setLine(l.key, { realized: v })} />
                          ) : (
                            <span className="mny">{money(Number(l.realized) || 0)}</span>
                          )}
                        </td>
                        <td className="num">
                          <span className="mny">{signed((Number(l.realized) || 0) - (Number(l.estimate) || 0))}</span>
                        </td>
                      </>
                    )}
                    {(headerEditing || realizing) && (
                      <td>
                        {removable && (
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
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <div className="cardfoot multi">
        {(showRealized ? realized : estimate).pph > 0 && (
          <div className="impact">
            <div className="ttl">Estimasi Penerimaan</div>
            <div className="ir">
              <span>Total {showRealized ? "Realisasi" : "Estimasi"}</span>
              <b>{money((showRealized ? realized : estimate).total)}</b>
            </div>
            <div className="ir">
              <span>
                {wht?.label ?? request?.withholdingLabel ?? "PPh"} {formatPct(whtRate ?? 0)} × DPP {money((showRealized ? realized : estimate).dpp)}
              </span>
              <b>−{money((showRealized ? realized : estimate).pph)}</b>
            </div>
            <div className="ir tot">
              <span>Estimasi dana diterima</span>
              <b>{money((showRealized ? realized : estimate).expected)}</b>
            </div>
          </div>
        )}
        {[...(showRealized ? [["Realisasi", realized] as const] : []), ["Estimasi", estimate] as const].map(([label, v]) => (
          <div className="impact" key={label}>
            <div className="ttl">
              {label} · {header.is_taxable ? MODE_TEXT[priceMode] : "Tidak Kena PPN"}
            </div>
            <div className="ir">
              <span>Harga perizinan</span>
              <b>{money(v.amount)}</b>
            </div>
            <div className="ir">
              <span>DPP</span>
              <b>{money(v.dpp)}</b>
            </div>
            {header.is_taxable ? (
              <>
                <div className="ir">
                  <span>DPP Nilai Lain ({rates ? `${rates.otherNum}/${rates.otherDen}` : "—"})</span>
                  <b>{money(v.dppOther)}</b>
                </div>
                <div className="ir">
                  <span>PPN {rates ? formatPct(rates.rate) : "—"} × DPP Nilai Lain</span>
                  <b>{money(v.ppn)}</b>
                </div>
              </>
            ) : (
              <div className="ir">
                <span>PPN</span>
                <b>Tidak Kena PPN</b>
              </div>
            )}
            {header.is_taxable && priceMode === "Include" && v.amount !== v.total && (
              <div className="ir est">
                <span>Pembulatan PPN (diserap DPP)</span>
                <b>−{money(v.amount - v.total)}</b>
              </div>
            )}
            <div className="ir tot">
              <span>Total {label}</span>
              <b>{money(v.total)}</b>
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  // ============================================================ page
  return (
    <>
      <div className="ph">
        <div className="crumb">
          <span>Penjualan</span>
          <span>/</span>
          <span>Perizinan</span>
          <span>/</span>
          <Link href="/sales/permit">Pengajuan Perizinan</Link>
          <span>/</span>
          <span className="cur">{request ? request.requestNo : "Baru"}</span>
        </div>
        <div className="ph-row">
          <h1>
            <span className="ph-ico">
              <Icon name="clip" size={16} />
            </span>
            {request ? (
              <>
                <span className="docno">{request.requestNo}</span>
                <span className={`bdg ${PERMIT_REQUEST_STATUS_BADGE[status]}`}>{PERMIT_REQUEST_STATUS_TEXT[status]}</span>
              </>
            ) : (
              "Pengajuan Perizinan Baru"
            )}
            {mode === "edit" && <span className="bdg t-warn">Mode Ubah</span>}
            {realizing && <span className="bdg t-warn">Input Realisasi</span>}
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
                  <Icon name="save" size={15} /> {saving ? "Menyimpan…" : realizing ? "Simpan Realisasi" : "Simpan"}
                </button>
              </>
            ) : (
              <PermitRequestActions
                id={request!.id}
                subject={request!.requestNo}
                status={status}
                can={can}
                realizationEntered={request!.realization.entered}
                realizationLocked={realizationLocked}
              />
            )}
          </div>
        </div>
      </div>

      <div className="fgrid solo">
        <div>
          {headerCard}
          {linesCard}
        </div>
      </div>

      {picker && (
        <PermitTypePicker
          types={options.permitTypes}
          taken={lines.map((l) => l.permit_type_id)}
          realization={realizing}
          priceOf={standardPrice}
          onApply={addTypes}
          onClose={() => setPicker(false)}
        />
      )}
    </>
  );
}
