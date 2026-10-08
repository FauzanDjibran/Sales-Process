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
import { CostBillActions } from "@/components/production/cost-bill-actions";
import { createCostBillAction, updateCostBillAction } from "@/app/actions/production-cost-bill";
import {
  COST_BILL_PATH,
  COST_BILL_PAYMENT_BADGE,
  COST_BILL_PAYMENT_TEXT,
  COST_BILL_STATUS_BADGE,
  COST_BILL_STATUS_TEXT,
  costBillPayment,
  type CostBillAbilities,
} from "@/lib/erp/production-cost-bill-workflow";
import type { CostBillInput, CostBillOptions, CostBillView } from "@/lib/erp/production-cost-bill";
import { formatDate, formatMoney, todayIso } from "@/lib/format";

/**
 * A Tagihan Biaya Produksi in all three modes: `new`, `edit` (Draft only) and
 * `view` (P150 M68). The header says when the cost belongs and which Supplier
 * is owed; the credit side is Account Mapping's *Hutang Biaya Produksi*, shown
 * and never chosen (P151). Each line is an Elemen Biaya Produksi and its
 * amount, posted to the element's own account.
 */

type LineState = { key: string; element_id: number | null; amount: string; note: string };

let seq = 0;
const newKey = () => `l${Date.now().toString(36)}${seq++}`;
const money = (n: number) => formatMoney(n, "IDR");

export function CostBillForm({
  mode,
  bill,
  options,
  can,
}: {
  mode: "new" | "edit" | "view";
  bill: CostBillView | null;
  options: CostBillOptions;
  can: CostBillAbilities;
}) {
  const router = useRouter();
  const toast = useToast();
  const editing = mode !== "view";
  const today = todayIso();

  const [header, setHeader] = useState<CostBillInput>(() =>
    bill
      ? {
          bill_date: bill.billDate,
          partner_id: bill.partnerId,
          supplier_ref: bill.supplierRef ?? "",
          due_date: bill.dueDate ?? "",
          description: bill.description,
          note: bill.note ?? "",
        }
      : { bill_date: today, partner_id: null, supplier_ref: "", due_date: "", description: "", note: "" }
  );
  const [lines, setLines] = useState<LineState[]>(() =>
    bill
      ? bill.lines.map((l) => ({ key: newKey(), element_id: l.elementId, amount: String(l.amount), note: l.note ?? "" }))
      : [{ key: newKey(), element_id: null, amount: "", note: "" }]
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  const elementById = new Map(options.elements.map((e) => [e.id, e]));
  const status = bill?.status ?? "Draft";
  // A posted bill shows the payable it was posted on; a Draft today's mapping (P151).
  const payableAccount = bill?.status === "Posted" ? bill.payableAccount : bill?.status === "Cancelled" ? null : options.payableAccount;
  const total = lines.reduce((a, l) => a + (Number(l.amount) || 0), 0);

  const touch = (...names: string[]) => {
    setDirty(true);
    setErrors((e) => {
      const next = { ...e };
      for (const n of names) delete next[n];
      return next;
    });
  };
  const set = <K extends keyof CostBillInput>(key: K, v: CostBillInput[K]) => {
    setHeader((h) => ({ ...h, [key]: v }));
    touch(key);
  };
  const setLine = (key: string, patch: Partial<LineState>) => {
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
    touch("_lines");
  };

  async function onSave() {
    setSaving(true);
    const payload = lines.map((l) => ({ element_id: l.element_id, amount: l.amount, note: l.note }));
    const result = mode === "edit" ? await updateCostBillAction(bill!.id, header, payload) : await createCostBillAction(header, payload);
    setSaving(false);
    if (!result.ok) {
      const mapped: Record<string, string> = {};
      for (const [key, v] of Object.entries(result.errors)) {
        const m = /^lines\.(\d+)\.(\w+)$/.exec(key);
        if (m) mapped[`lines.${lines[Number(m[1])]?.key}.${m[2]}`] = v;
        else mapped[key] = v;
      }
      setErrors(mapped);
      toast(result.errors._form ? "Tidak diizinkan" : "Belum bisa disimpan", result.errors._form ?? result.errors._lines ?? "Periksa kembali isian.", "err");
      return;
    }
    setDirty(false);
    toast("Tagihan Biaya Produksi disimpan", `${result.billNo} · Draft`, "ok");
    router.push(`${COST_BILL_PATH}/${result.id}`);
  }

  const ro = (node: React.ReactNode) => <div className="ro">{node}</div>;
  const nil = (t = "tidak diisi") => <div className="ro nil">{t}</div>;
  const chip = (label: string, name: string) => ro(
    <>
      <span className="lab">{label}</span>
      <span>{name}</span>
    </>
  );
  const lineErr = (key: string, f: string) => errors[`lines.${key}.${f}`];
  const supplier = header.partner_id ? options.suppliers.find((s) => s.id === Number(header.partner_id)) : null;

  // ======================================================== header card
  const headerCard = (
    <div className="card">
      <FormBody>
        <FormSection title="Tagihan">
          <FormRow>
            <Field label="Tanggal" span={3} required={editing} help={editing ? "bulan biaya ini terjadi" : undefined} error={errors.bill_date}>
              {editing ? <DateInput value={header.bill_date} invalid={Boolean(errors.bill_date)} onChange={(v) => set("bill_date", v)} /> : ro(formatDate(header.bill_date))}
            </Field>
            <Field label="Supplier" span={4} required={editing} help={editing ? "yang menagih" : undefined} error={errors.partner_id}>
              {editing ? (
                <Combobox
                  value={Number(header.partner_id) || null}
                  options={options.suppliers}
                  placeholder="Pilih Supplier…"
                  invalid={Boolean(errors.partner_id)}
                  onChange={(v) => set("partner_id", v)}
                />
              ) : supplier ? (
                chip(supplier.label, supplier.name)
              ) : (
                nil()
              )}
            </Field>
            <Field label="Account Hutang" span={5} help={status !== "Posted" ? "dari Account Mapping › Produksi" : undefined}>
              {payableAccount ? (
                chip(payableAccount.label, payableAccount.name)
              ) : status === "Draft" ? (
                <div className="ro nil">belum diatur — atur Hutang Biaya Produksi di Account Mapping sebelum posting</div>
              ) : (
                nil("—")
              )}
            </Field>
            <Field label="No. Tagihan Supplier" span={4} help={editing ? "opsional" : undefined}>
              {editing ? (
                <input className="inp" value={header.supplier_ref ?? ""} placeholder="Nomor tagihan / invoice dari supplier" onChange={(e) => set("supplier_ref", e.target.value)} />
              ) : header.supplier_ref ? (
                ro(<span className="mono">{header.supplier_ref}</span>)
              ) : (
                nil()
              )}
            </Field>
            <Field label="Jatuh Tempo" span={3} help={editing ? "opsional" : undefined} error={errors.due_date}>
              {editing ? <DateInput value={header.due_date ?? ""} invalid={Boolean(errors.due_date)} onChange={(v) => set("due_date", v)} /> : header.due_date ? ro(formatDate(header.due_date)) : nil()}
            </Field>
            <Field label="Uraian" span={12} required={editing} error={errors.description}>
              {editing ? (
                <input
                  className={`inp${errors.description ? " bad" : ""}`}
                  value={header.description}
                  placeholder="mis. Listrik pabrik Oktober 2026"
                  onChange={(e) => set("description", e.target.value)}
                />
              ) : (
                ro(header.description)
              )}
            </Field>
            <Field label="Catatan" span={12}>
              {editing ? (
                <textarea className="ta" rows={2} value={header.note ?? ""} placeholder="Keterangan tambahan…" onChange={(e) => set("note", e.target.value)} />
              ) : header.note ? (
                <div className="ro multi">{header.note}</div>
              ) : (
                <div className="ro multi nil">tidak diisi</div>
              )}
            </Field>
          </FormRow>
        </FormSection>
        {bill?.status === "Posted" && bill.isPayable && (
          <p className="fnote">
            <b>Pembayaran:</b> dibayar {money(bill.paid)} dari {money(bill.total)}; sisa {money(bill.total - bill.paid)}.
          </p>
        )}
        {bill?.cancelReason && (
          <p className="fnote">
            <b>Dibatalkan:</b> {bill.cancelReason}
          </p>
        )}
      </FormBody>
    </div>
  );

  // ======================================================== lines card
  const addLine = () => {
    setLines((ls) => [...ls, { key: newKey(), element_id: null, amount: "", note: "" }]);
    touch("_lines");
  };
  const linesCard = (
    <div className="card" style={{ marginTop: 14 }}>
      <div className="card-h">
        <span className="ci">
          <Icon name="coin" size={15} />
        </span>
        <div className="ct">
          <h3>Rincian Biaya</h3>
          <p>Setiap baris diposting ke account Elemen Biaya Produksi-nya dan masuk Buku Biaya Produksi.</p>
        </div>
        {editing && (
          <button className="btn sm primary" onClick={addLine}>
            <Icon name="plus" size={14} /> Tambah Biaya
          </button>
        )}
      </div>
      {errors._lines && (
        <div className="nbox bad slim">
          <Icon name="warn" size={15} className="ni" />
          <div>
            <b>{errors._lines}</b>
          </div>
        </div>
      )}
      <div className="tw">
        <table className="grid ltab" style={{ minWidth: 820 }}>
          <thead>
            <tr>
              <th style={{ width: 40 }}>No</th>
              <th>Elemen Biaya Produksi</th>
              <th style={{ width: 250 }}>Account</th>
              <th className="num" style={{ width: 180 }}>
                Jumlah
              </th>
              <th style={{ width: editing ? 220 : undefined }}>Keterangan</th>
              {editing && <th style={{ width: 40 }} />}
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => {
              const e = l.element_id ? elementById.get(l.element_id) : undefined;
              const lineError = lineErr(l.key, "element_id") ?? lineErr(l.key, "amount");
              return (
                <tr key={l.key} className={lineError ? "overrow" : undefined}>
                  <td className="no">{i + 1}</td>
                  <td>
                    {editing ? (
                      <Combobox
                        size="sm"
                        value={l.element_id}
                        options={options.elements}
                        placeholder="Pilih Elemen Biaya…"
                        emptyText="Belum ada Elemen Biaya Produksi. Buat di Master › Referensi."
                        invalid={Boolean(lineErr(l.key, "element_id"))}
                        onChange={(v) => setLine(l.key, { element_id: v })}
                      />
                    ) : (
                      <span className="idc">
                        <span className="lab">{e?.label}</span>
                        <span className="nm">{e?.name}</span>
                      </span>
                    )}
                    {lineError && <span className="overtag">{lineError}</span>}
                  </td>
                  <td>
                    {e ? (
                      <span className="idc">
                        <span className="lab">{e.accountLabel}</span>
                        <span className="nm">{e.accountName}</span>
                      </span>
                    ) : (
                      <span className="dash">—</span>
                    )}
                  </td>
                  <td className="num">
                    {editing ? (
                      <MoneyInput size="sm" value={l.amount} ariaLabel={`Jumlah ${e?.label ?? ""}`} onChange={(v) => setLine(l.key, { amount: v })} />
                    ) : (
                      <span className="mny">{money(Number(l.amount))}</span>
                    )}
                  </td>
                  <td>
                    {editing ? (
                      <input className="inp sm" value={l.note} placeholder="opsional" onChange={(ev) => setLine(l.key, { note: ev.target.value })} />
                    ) : (
                      <span className="mut">{l.note || <span className="dash">—</span>}</span>
                    )}
                  </td>
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
            {lines.length === 0 && (
              <tr>
                <td colSpan={6} className="mut" style={{ textAlign: "center" }}>
                  Belum ada biaya. Tambahkan dengan tombol di atas.
                </td>
              </tr>
            )}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={3} style={{ textAlign: "right" }}>
                <b>Total</b>
              </td>
              <td className="num">
                <span className="mny">
                  <b>{money(total)}</b>
                </span>
              </td>
              <td colSpan={editing ? 2 : 1} />
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );

  // ============================================================== page
  const backHref = bill ? `${COST_BILL_PATH}/${bill.id}` : COST_BILL_PATH;
  const pay = bill ? costBillPayment(bill.total, bill.paid) : null;
  return (
    <>
      <div className="ph">
        <div className="crumb">
          <span>Produksi</span>
          <span>/</span>
          <Link href={COST_BILL_PATH}>Tagihan Biaya Produksi</Link>
          <span>/</span>
          <span className="cur">{bill ? bill.billNo : "Baru"}</span>
        </div>
        <div className="ph-row">
          <h1>
            <span className="ph-ico">
              <Icon name="file" size={16} />
            </span>
            {bill ? (
              <>
                <span className="docno">{bill.billNo}</span>
                <span className={`bdg ${COST_BILL_STATUS_BADGE[status]}`}>{COST_BILL_STATUS_TEXT[status]}</span>
                {bill.status === "Posted" && bill.isPayable && pay && <span className={`bdg ${COST_BILL_PAYMENT_BADGE[pay]}`}>{COST_BILL_PAYMENT_TEXT[pay]}</span>}
              </>
            ) : (
              "Tagihan Biaya Produksi Baru"
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
              <CostBillActions id={bill!.id} subject={bill!.billNo} status={status} can={can} />
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
    </>
  );
}
