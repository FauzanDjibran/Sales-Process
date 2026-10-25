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
import { ProductionPlanActions } from "@/components/production/production-plan-actions";
import { ProductionPlanDemandPicker, type DemandPick } from "@/components/production/production-plan-demand-picker";
import { createProductionPlanAction, updateProductionPlanAction } from "@/app/actions/production-plan";
import { PRODUCTION_ORDER_STATUS_BADGE, PRODUCTION_ORDER_STATUS_TEXT, type ProductionOrderStatus } from "@/lib/erp/production-order-workflow";
import { PRODUCTION_PLAN_STATUS_BADGE, PRODUCTION_PLAN_STATUS_TEXT, type ProductionPlanAbilities } from "@/lib/erp/production-plan-workflow";
import { nextMonth, periodChoices, periodText, suggestedQty } from "@/lib/erp/production-plan-shape";
import type { PlanHeaderInput, PlanOptions, PlanView } from "@/lib/erp/production-plan";
import type { PlanMaterial } from "@/lib/erp/production-order";
import { formatDate, formatNumber, todayIso } from "@/lib/format";

/**
 * A Rencana Produksi in all three modes: `new`, `edit` (Draft only) and `view`
 * (P168). PPIC names the month, then each line: the item to make, how much and
 * the day to start inside the month, and — by *Pilih Sales Order* — the Open
 * Sales Order lines it covers, each with the part this line takes. The quantity
 * is typed; beside it the demand covered, the stock on hand and a **Saran**
 * (demand less stock) help decide, never force. A line may cover no Sales Order
 * (a stock build). Once approved, each line shows what Perintah Produksi were
 * released from it (*Dirilis*, composed by the page) and offers *Buat Perintah*;
 * the page also shows the material the whole plan asks of the BoMs.
 */

export type ProductionPlanMode = "new" | "edit" | "view";

type LineState = { key: string; item_id: number | null; qty: string; start_date: string; demands: DemandPick[] };

let seq = 0;
const newKey = () => `r${Date.now().toString(36)}${seq++}`;
const qtyText = (n: number) => formatNumber(n, n % 1 ? 2 : 0);
const num = (v: string) => Number(String(v).replace(",", ".")) || 0;

export function ProductionPlanForm({
  mode,
  plan,
  options,
  released,
  orders,
  materials,
  can,
}: {
  mode: ProductionPlanMode;
  plan: PlanView | null;
  options: PlanOptions;
  /** Per stored line id, what live Perintah hold of it. */
  released: Record<number, number>;
  /** The Perintah made from the plan's lines. */
  orders: { id: number; orderNo: string; status: ProductionOrderStatus; planLineId: number; targetQty: number }[];
  materials: PlanMaterial[];
  can: ProductionPlanAbilities;
}) {
  const router = useRouter();
  const toast = useToast();
  const editing = mode !== "view";
  const itemById = useMemo(() => new Map(options.items.map((i) => [i.id, i])), [options.items]);

  const [header, setHeader] = useState<PlanHeaderInput>(() => (plan ? { ...plan.header } : { plan_date: todayIso(), period: nextMonth(todayIso()), note: "" }));
  const [lines, setLines] = useState<LineState[]>(() =>
    plan
      ? plan.lines.map((l) => ({
          key: newKey(),
          item_id: Number(l.item_id),
          qty: String(l.qty),
          start_date: l.start_date,
          demands: l.demands.map((d) => ({ so_line_id: Number(d.so_line_id), qty: String(d.qty) })),
        }))
      : []
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [pickFor, setPickFor] = useState<string | null>(null);

  const status = plan?.status ?? "Draft";
  const touch = (...names: string[]) => {
    setDirty(true);
    setErrors((e) => {
      const next = { ...e };
      for (const n of names) delete next[n];
      return next;
    });
  };
  const set = <K extends keyof PlanHeaderInput>(k: K, v: PlanHeaderInput[K]) => {
    setHeader((x) => ({ ...x, [k]: v }));
    touch(k);
  };
  const setLine = (key: string, patch: Partial<LineState>) => {
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
    touch("_lines");
  };
  const addLine = () => {
    setLines((ls) => [...ls, { key: newKey(), item_id: null, qty: "", start_date: `${header.period}-01`, demands: [] }]);
    touch("_lines");
  };
  /** The month moves every line's start date into it, keeping the day where it still exists. */
  const pickPeriod = (ym: string) => {
    setHeader((x) => ({ ...x, period: ym }));
    setLines((ls) => ls.map((l) => ({ ...l, start_date: l.start_date ? `${ym}-${l.start_date.slice(8, 10)}` : `${ym}-01` })));
    touch("period", "_lines");
  };

  async function onSave() {
    setSaving(true);
    const sent = lines;
    const payload = sent.map((l) => ({ item_id: l.item_id, qty: l.qty, start_date: l.start_date, note: "", demands: l.demands }));
    const result = mode === "edit" ? await updateProductionPlanAction(plan!.id, header, payload) : await createProductionPlanAction(header, payload);
    setSaving(false);
    if (!result.ok) {
      const mapped: Record<string, string> = {};
      for (const [k, v] of Object.entries(result.errors)) {
        const m = /^lines\.(\d+)\.(.+)$/.exec(k);
        if (m) mapped[`lines.${sent[Number(m[1])]?.key}.${m[2]}`] = v;
        else mapped[k] = v;
      }
      setErrors(mapped);
      toast(result.errors._form ? "Tidak diizinkan" : "Belum bisa disimpan", result.errors._form ?? result.errors._lines ?? "Periksa kembali isian.", "err");
      return;
    }
    setDirty(false);
    toast("Rencana disimpan", `${result.planNo} · Draft`, "ok");
    router.push(`/production/plan/${result.id}`);
  }

  const backHref = plan ? `/production/plan/${plan.id}` : "/production/plan";
  const ro = (node: React.ReactNode) => <div className="ro">{node}</div>;
  const lineErr = (key: string, f: string) => errors[`lines.${key}.${f}`];
  const demandErr = (key: string) => Object.entries(errors).find(([k]) => k.startsWith(`lines.${key}.demands.`))?.[1];

  // ======================================================= header card
  const headerCard = (
    <div className="card">
      <FormBody>
        <FormSection title="Rencana">
          <FormRow>
            <Field label="Bulan" span={4} required={editing} help={editing ? "bulan yang direncanakan" : undefined} error={errors.period}>
              {editing ? (
                <Select value={header.period} options={periodChoices(todayIso(), [header.period])} invalid={Boolean(errors.period)} onChange={pickPeriod} />
              ) : (
                ro(periodText(header.period))
              )}
            </Field>
            <Field label="Tanggal" span={4} required={editing} help={editing ? "tanggal rencana disusun" : undefined} error={errors.plan_date}>
              {editing ? <DateInput value={header.plan_date} invalid={Boolean(errors.plan_date)} onChange={(v) => set("plan_date", v)} /> : ro(formatDate(header.plan_date))}
            </Field>
            <Field label="Catatan" span={12}>
              {editing ? (
                <textarea className="ta" rows={2} value={header.note} placeholder="Catatan rencana…" onChange={(e) => set("note", e.target.value)} />
              ) : header.note ? (
                <div className="ro multi">{header.note}</div>
              ) : (
                <div className="ro multi nil">tidak diisi</div>
              )}
            </Field>
          </FormRow>
        </FormSection>
        {plan?.statusReason && (status === "Cancelled" || status === "Rejected" || status === "Closed") && (
          <p className="fnote">
            <b>{PRODUCTION_PLAN_STATUS_TEXT[status]}:</b> {plan.statusReason}
          </p>
        )}
        {status === "Submitted" && (
          <p className="fnote">
            <b>Menunggu persetujuan</b> — jumlah Sales Order yang dicakup sudah dicadangkan.
          </p>
        )}
      </FormBody>
    </div>
  );

  // ======================================================== lines card
  const addButton = (cta?: boolean) => (
    <button className={`btn sm primary${cta ? " cta" : ""}`} onClick={addLine}>
      <Icon name="plus" size={14} /> Tambah Barang
    </button>
  );
  const storedId = (i: number) => plan?.lineIds[i];
  const ordersOf = (lineId: number | undefined) => orders.filter((o) => o.planLineId === lineId);
  const open = status === "Open";

  const linesCard = (
    <div className="card" style={{ marginTop: 14 }}>
      <div className="card-h">
        <span className="ci">
          <Icon name="box" size={15} />
        </span>
        <div className="ct">
          <h3>Barang yang Direncanakan</h3>
          <p>
            {editing
              ? "Pilih barang, jumlah dan tanggal mulai di dalam bulan, lalu Sales Order yang dicakup. Jumlah diketik; saran hanya membantu."
              : "Barang, jumlah dan tanggal mulai; Sales Order yang dicakup dan Perintah Produksi yang sudah dirilis."}
          </p>
        </div>
        {editing && lines.length > 0 && addButton()}
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
          <div className="ic">
            <Icon name="box" size={18} />
          </div>
          <h4>Belum ada barang</h4>
          <p>Tambahkan barang yang akan dibuat bulan ini.</p>
          {editing && addButton(true)}
        </div>
      ) : (
        <div className="tw">
          <table className="grid ltab" style={{ minWidth: editing ? 1010 : 1080 }}>
            <thead>
              <tr>
                <th style={{ width: 40 }}>No</th>
                <th>Barang</th>
                <th style={{ width: 200 }}>Qty Rencana</th>
                <th style={{ width: 130 }}>Mulai</th>
                <th style={{ width: 210 }}>Sales Order</th>
                <th className="num" style={{ width: 110 }}>Stok FG</th>
                {!editing && (
                  <>
                    <th className="num" style={{ width: 110 }}>Dirilis</th>
                    <th style={{ width: 170 }}>Perintah</th>
                  </>
                )}
                {editing && <th style={{ width: 40 }} />}
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => {
                const item = l.item_id ? itemById.get(l.item_id) : undefined;
                const demandTotal = l.demands.reduce((s, d) => s + num(d.qty), 0);
                const stock = l.item_id ? (options.stock[l.item_id] ?? 0) : 0;
                const saran = suggestedQty(demandTotal, stock);
                const lineError = lineErr(l.key, "item_id") ?? lineErr(l.key, "qty") ?? lineErr(l.key, "start_date");
                const id = storedId(i);
                const done = id ? (released[id] ?? 0) : 0;
                return (
                  <tr key={l.key} className={lineError || demandErr(l.key) ? "overrow" : undefined}>
                    <td className="no">{i + 1}</td>
                    <td>
                      {editing ? (
                        <Combobox
                          size="sm"
                          value={l.item_id}
                          options={options.items.filter((o) => o.active || o.id === l.item_id)}
                          placeholder="Pilih Barang…"
                          emptyText="Belum ada Barang dengan Kelola Stok."
                          invalid={Boolean(lineErr(l.key, "item_id"))}
                          onChange={(v) => setLine(l.key, { item_id: v, demands: [] })}
                        />
                      ) : (
                        <span className="idc">
                          <span className="lab">{item?.label}</span>
                          <span className="nm">{item?.name}</span>
                        </span>
                      )}
                      {lineError && <span className="overtag">{lineError}</span>}
                    </td>
                    <td>
                      {editing ? (
                        <>
                          <div className="qcell">
                            <MoneyInput size="sm" decimals={4} value={l.qty} ariaLabel={`Qty rencana ${item?.label ?? ""}`} onChange={(v) => setLine(l.key, { qty: v })} />
                            <span className="qu">{item?.uomLabel}</span>
                          </div>
                          {item && (
                            <span className="fulltag">
                              {saran > 0 ? (
                                <>
                                  saran {qtyText(saran)} ·{" "}
                                  <a
                                    href="#"
                                    onClick={(e) => {
                                      e.preventDefault();
                                      setLine(l.key, { qty: String(saran) });
                                    }}
                                  >
                                    pakai
                                  </a>
                                </>
                              ) : (
                                "saran 0 — stok mencukupi"
                              )}
                            </span>
                          )}
                        </>
                      ) : (
                        <span className="qview">
                          <span className="mny">{qtyText(num(l.qty))}</span>
                          <span className="lab">{item?.uomLabel}</span>
                        </span>
                      )}
                    </td>
                    <td>
                      {editing ? (
                        <DateInput value={l.start_date} invalid={Boolean(lineErr(l.key, "start_date"))} onChange={(v) => setLine(l.key, { start_date: v })} />
                      ) : (
                        formatDate(l.start_date)
                      )}
                    </td>
                    <td>
                      {editing ? (
                        <>
                          <button
                            className="btn sm"
                            disabled={!l.item_id}
                            title={l.item_id ? undefined : "Pilih barang dulu…"}
                            onClick={() => setPickFor(l.key)}
                          >
                            <Icon name="clip" size={14} /> {l.demands.length ? `${l.demands.length} pesanan` : "Pilih Sales Order"}
                          </button>
                          {l.demands.length > 0 && (
                            <span className="fulltag">
                              dicakup {qtyText(demandTotal)} {item?.uomLabel}
                            </span>
                          )}
                          {demandErr(l.key) && <span className="overtag">{demandErr(l.key)}</span>}
                        </>
                      ) : l.demands.length ? (
                        <span className="dstack" style={{ gap: 2 }}>
                          {l.demands.map((d) => (
                            <span key={d.so_line_id} className="d2">
                              <span className="mono">{plan?.demandNos[Number(d.so_line_id)]}</span> · {qtyText(num(String(d.qty)))} {item?.uomLabel}
                            </span>
                          ))}
                        </span>
                      ) : (
                        <span className="dash">stok / tanpa SO</span>
                      )}
                    </td>
                    <td className="num">
                      <span className="mny">{item ? qtyText(stock) : "—"}</span>
                    </td>
                    {!editing && (
                      <>
                        <td className="num">
                          <span className={done > num(l.qty) ? "overtag" : "mny"}>{qtyText(done)}</span>
                          {done > num(l.qty) && <span className="overtag">melebihi rencana</span>}
                        </td>
                        <td>
                          <span className="dstack" style={{ gap: 2 }}>
                            {ordersOf(id).map((o) => (
                              <Link key={o.id} className="drl" href={`/production/order/${o.id}`}>
                                <span className="mono">{o.orderNo}</span>{" "}
                                <span className={`bdg ${PRODUCTION_ORDER_STATUS_BADGE[o.status]}`}>{PRODUCTION_ORDER_STATUS_TEXT[o.status]}</span>
                              </Link>
                            ))}
                            {open && can.release && id && (
                              <Link className="btn sm" href={`/production/order/new?planLine=${id}`}>
                                <Icon name="plus" size={14} /> Buat Perintah
                              </Link>
                            )}
                          </span>
                        </td>
                      </>
                    )}
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
      {pickFor &&
        (() => {
          const l = lines.find((x) => x.key === pickFor);
          const item = l?.item_id ? itemById.get(l.item_id) : undefined;
          if (!l || !item) return null;
          return (
            <ProductionPlanDemandPicker
              item={item}
              demands={options.demands.filter((d) => d.itemId === item.id)}
              current={l.demands}
              onApply={(picks) => {
                setLine(l.key, { demands: picks });
                setPickFor(null);
              }}
              onClose={() => setPickFor(null)}
            />
          );
        })()}
    </div>
  );

  // ================================================ material card (view)
  const materialCard =
    !editing && plan && materials.length > 0 ? (
      <div className="card" style={{ marginTop: 14 }}>
        <div className="card-h">
          <span className="ci">
            <Icon name="layers" size={15} />
          </span>
          <div className="ct">
            <h3>Kebutuhan Bahan</h3>
            <p>Seluruh rencana × BoM di setiap workstation rute standar barangnya, dibandingkan dengan stok sekarang. Hanya informasi — tidak mencadangkan apa pun.</p>
          </div>
        </div>
        <div className="tw">
          <table className="grid" style={{ minWidth: 640 }}>
            <thead>
              <tr>
                <th>Bahan</th>
                <th className="num" style={{ width: 150 }}>Dibutuhkan</th>
                <th className="num" style={{ width: 150 }}>Stok Sekarang</th>
                <th className="num" style={{ width: 150 }}>Kekurangan</th>
              </tr>
            </thead>
            <tbody>
              {materials.map((m) => (
                <tr key={m.itemId}>
                  <td>
                    <span className="idc">
                      <span className="lab">{m.label}</span>
                      <span className="nm">{m.name}</span>
                    </span>
                  </td>
                  <td className="num">
                    <span className="mny">
                      {qtyText(m.qty)} {m.uomLabel}
                    </span>
                  </td>
                  <td className="num">
                    <span className="mny">{qtyText(m.onHand)}</span>
                  </td>
                  <td className="num">{m.qty > m.onHand ? <span className="overtag">{qtyText(m.qty - m.onHand)}</span> : <span className="dash">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    ) : null;

  // ============================================================ page
  return (
    <>
      <div className="ph">
        <div className="crumb">
          <span>Produksi</span>
          <span>/</span>
          <Link href="/production/plan">Rencana Produksi</Link>
          <span>/</span>
          <span className="cur">{plan ? plan.planNo : "Baru"}</span>
        </div>
        <div className="ph-row">
          <h1>
            <span className="ph-ico">
              <Icon name="cal" size={16} />
            </span>
            {plan ? (
              <>
                <span className="docno">{plan.planNo}</span>
                <span className={`bdg ${PRODUCTION_PLAN_STATUS_BADGE[status]}`}>{PRODUCTION_PLAN_STATUS_TEXT[status]}</span>
              </>
            ) : (
              "Rencana Produksi Baru"
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
              <ProductionPlanActions id={plan!.id} subject={plan!.planNo} status={status} can={can} />
            )}
          </div>
        </div>
      </div>

      <div className="fgrid solo">
        <div>
          {headerCard}
          {linesCard}
          {materialCard}
        </div>
      </div>
    </>
  );
}
