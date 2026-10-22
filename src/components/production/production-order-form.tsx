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
import { ProductionOrderActions } from "@/components/production/production-order-actions";
import { createProductionOrderAction, updateProductionOrderAction } from "@/app/actions/production-order";
import { ROUTING_MODE_TEXT, type RoutingStepModeValue } from "@/lib/erp/production-master-shape";
import { orderRequirements, requirementKey } from "@/lib/erp/production-order-shape";
import {
  PRODUCTION_ORDER_REASON_TEXT,
  PRODUCTION_ORDER_STATUS_BADGE,
  PRODUCTION_ORDER_STATUS_TEXT,
  type ProductionOrderAbilities,
} from "@/lib/erp/production-order-workflow";
import type { ProductionOrderHeaderInput, ProductionOrderOptions, ProductionOrderView } from "@/lib/erp/production-order";
import { formatDate, formatNumber, todayIso } from "@/lib/format";

/**
 * A Perintah Produksi in all three modes: `new`, `edit` (Draft only) and
 * `view` (Walet step 3, M121, P165). The header names the **Item Target** — the
 * item the Partai is to become — and the **Qty Target**; picking a Routing
 * copies its stations into **Rute**, which stays editable. **Kebutuhan Bahan**
 * is never typed: it is the route's BoMs (else the item's default BoM) × Qty
 * Target, per station, worked out here as Simpan will store it — and, once
 * saved, shown as stored. Without a BoM there is none. Once Open, each
 * requirement shows what the Logistik BSTBs sent to its station (`sent`,
 * composed by the page).
 */

type StepState = { key: string; workstation_id: number | null; mode: RoutingStepModeValue | null; bom_id: number | null };

let seq = 0;
const newKey = () => `p${Date.now().toString(36)}${seq++}`;
const qtyText = (n: number) => formatNumber(n, n % 1 ? 2 : 0);
const MODES = Object.entries(ROUTING_MODE_TEXT).map(([value, label]) => ({ value, label }));

export function ProductionOrderForm({
  mode,
  order,
  options,
  sent,
  can,
}: {
  mode: "new" | "edit" | "view";
  order: ProductionOrderView | null;
  options: ProductionOrderOptions;
  /** Per `requirementKey` (item and workstation), what the BSTBs raised from this Perintah sent. */
  sent: Record<string, number>;
  can: ProductionOrderAbilities;
}) {
  const router = useRouter();
  const toast = useToast();
  const editing = mode !== "view";
  const itemById = useMemo(() => new Map(options.items.map((i) => [i.id, i])), [options.items]);

  const [header, setHeader] = useState<ProductionOrderHeaderInput>(() =>
    order ? { ...order.header, target_qty: String(order.header.target_qty) } : { order_date: todayIso(), target_item_id: null, target_qty: "", routing_id: null, note: "" }
  );
  const [steps, setSteps] = useState<StepState[]>(() =>
    order ? order.steps.map((s) => ({ key: newKey(), workstation_id: s.workstation_id, mode: s.mode, bom_id: s.bom_id })) : []
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  const status = order?.status ?? "Draft";
  const opened = status === "Open" || status === "Closed";
  const touch = (...names: string[]) => {
    setDirty(true);
    setErrors((e) => {
      const next = { ...e };
      for (const n of names) delete next[n];
      return next;
    });
  };
  const set = <K extends keyof ProductionOrderHeaderInput>(k: K, v: ProductionOrderHeaderInput[K]) => {
    setHeader((h) => ({ ...h, [k]: v }));
    touch(k);
  };
  /** A Routing's stations become the route, replacing what was there. */
  const copyRouting = (routingId: number | null) => {
    set("routing_id", routingId);
    const r = routingId ? options.routings.find((x) => x.id === routingId) : undefined;
    if (r) setSteps(r.steps.map((s) => ({ key: newKey(), workstation_id: s.workstationId, mode: s.mode, bom_id: s.bomId })));
    touch("_steps");
  };
  /** Another Item Target drops a routing of the old one and starts on the item's default routing. */
  const pickTarget = (itemId: number | null) => {
    set("target_item_id", itemId);
    const current = header.routing_id ? options.routings.find((x) => x.id === header.routing_id) : undefined;
    if (current && current.itemId === itemId) return;
    const fallback = options.routings.find((x) => x.active && x.itemId === itemId && x.isDefault);
    copyRouting(fallback?.id ?? null);
  };
  const setStep = (key: string, patch: Partial<StepState>) => {
    setSteps((ss) => ss.map((s) => (s.key === key ? { ...s, ...patch } : s)));
    touch("_steps");
  };

  // While editing, the requirements follow the form; once saved, they are as stored.
  const requirements = useMemo(
    () =>
      editing
        ? orderRequirements(
            header.target_item_id,
            Number(String(header.target_qty).replace(",", ".")) || 0,
            steps.map((s) => ({ workstationId: s.workstation_id, bomId: s.bom_id })),
            options.boms
          )
        : (order?.requirements ?? []),
    [editing, header.target_item_id, header.target_qty, steps, options.boms, order]
  );

  async function onSave() {
    setSaving(true);
    const stepPayload = steps.map((s) => ({ workstation_id: s.workstation_id, mode: s.mode, bom_id: s.bom_id }));
    const result = mode === "edit" ? await updateProductionOrderAction(order!.id, header, stepPayload) : await createProductionOrderAction(header, stepPayload);
    setSaving(false);
    if (!result.ok) {
      const mapped: Record<string, string> = {};
      for (const [k, v] of Object.entries(result.errors)) {
        const m = /^steps\.(\d+)\.(\w+)$/.exec(k);
        if (m) mapped[`steps.${steps[Number(m[1])]?.key}.${m[2]}`] = v;
        else mapped[k] = v;
      }
      setErrors(mapped);
      toast(result.errors._form ? "Tidak diizinkan" : "Belum bisa disimpan", result.errors._form ?? result.errors._steps ?? "Periksa kembali isian.", "err");
      return;
    }
    setDirty(false);
    toast("Perintah Produksi disimpan", `${result.orderNo} · Draft`, "ok");
    router.push(`/production/order/${result.id}`);
  }

  const ro = (node: React.ReactNode) => <div className="ro">{node}</div>;
  const nil = (t = "tidak diisi") => <div className="ro nil">{t}</div>;
  const chip = (o: { label: string; name: string } | undefined) =>
    o
      ? ro(
          <>
            <span className="lab">{o.label}</span>
            <span>{o.name}</span>
          </>
        )
      : nil();
  const target = header.target_item_id ? itemById.get(header.target_item_id) : undefined;
  const routing = header.routing_id ? options.routings.find((r) => r.id === header.routing_id) : undefined;
  const banner = (msg?: string) =>
    msg ? (
      <div className="nbox bad slim">
        <Icon name="warn" size={15} className="ni" />
        <div>
          <b>{msg}</b>
        </div>
      </div>
    ) : null;

  // ======================================================== header card
  const headerCard = (
    <div className="card">
      <FormBody>
        <FormSection title="Perintah">
          <FormRow>
            <Field label="Tanggal" span={3} required={editing} error={errors.order_date}>
              {editing ? <DateInput value={header.order_date} invalid={Boolean(errors.order_date)} onChange={(v) => set("order_date", v)} /> : ro(formatDate(header.order_date))}
            </Field>
            <Field label="Item Target" span={5} required={editing} help={editing ? "barang yang akan dibuat Partai ini" : undefined} error={errors.target_item_id}>
              {editing ? (
                <Combobox
                  value={header.target_item_id}
                  options={options.items.filter((i) => i.active || i.id === header.target_item_id)}
                  placeholder="Pilih Barang…"
                  emptyText="Belum ada Barang dengan Kelola Stok."
                  invalid={Boolean(errors.target_item_id)}
                  onChange={pickTarget}
                />
              ) : (
                chip(target)
              )}
            </Field>
            <Field label="Qty Target" span={4} required={editing} help={editing ? "satuan dasar" : undefined} error={errors.target_qty}>
              {editing ? (
                <div className="qcell">
                  <MoneyInput decimals={4} value={String(header.target_qty)} invalid={Boolean(errors.target_qty)} ariaLabel="Qty Target" onChange={(v) => set("target_qty", v)} />
                  <span className="qu">{target?.uomLabel}</span>
                </div>
              ) : (
                ro(
                  <span className="qview">
                    <span className="mny">{qtyText(Number(header.target_qty))}</span>
                    <span className="lab">{target?.uomLabel}</span>
                  </span>
                )
              )}
            </Field>
          </FormRow>
          <FormRow>
            <Field label="Routing" span={6} help={editing ? "menyalin rute; boleh diubah" : undefined} error={errors.routing_id}>
              {editing ? (
                <Combobox
                  value={header.routing_id ?? 0}
                  waitingFor={header.target_item_id ? null : "Pilih Item Target dulu…"}
                  options={[
                    { id: 0, label: "", name: "Tanpa Routing", active: true },
                    ...options.routings.filter((r) => r.itemId === header.target_item_id && (r.active || r.id === header.routing_id)),
                  ]}
                  placeholder="Pilih Routing…"
                  invalid={Boolean(errors.routing_id)}
                  onChange={(v) => copyRouting(v || null)}
                />
              ) : routing ? (
                chip(routing)
              ) : (
                nil("tanpa Routing")
              )}
            </Field>
            <Field label="Catatan" span={12}>
              {editing ? (
                <textarea className="ta" rows={2} value={header.note} placeholder="Catatan untuk produksi…" onChange={(e) => set("note", e.target.value)} />
              ) : header.note ? (
                <div className="ro multi">{header.note}</div>
              ) : (
                <div className="ro multi nil">tidak diisi</div>
              )}
            </Field>
          </FormRow>
        </FormSection>
        {order?.statusReason && PRODUCTION_ORDER_REASON_TEXT[status] && (
          <p className="fnote">
            <b>{PRODUCTION_ORDER_REASON_TEXT[status]}:</b> {order.statusReason}
          </p>
        )}
      </FormBody>
    </div>
  );

  // ========================================================= route card
  const stepsCard = (
    <div className="card" style={{ marginTop: 14 }}>
      <div className="card-h">
        <span className="ci">
          <Icon name="tree" size={15} />
        </span>
        <div className="ct">
          <h3>Rute</h3>
          <p>Workstation yang dilalui Partai, berurutan. BoM pada sebuah langkah menentukan kebutuhan bahannya.</p>
        </div>
        {editing && (
          <button
            className="btn sm primary"
            onClick={() => {
              setSteps((ss) => [...ss, { key: newKey(), workstation_id: null, mode: "Transform", bom_id: null }]);
              touch("_steps");
            }}
          >
            <Icon name="plus" size={14} /> Tambah Langkah
          </button>
        )}
      </div>
      {banner(errors._steps)}
      <div className="tw">
        <table className="grid ltab" style={{ minWidth: 760 }}>
          <thead>
            <tr>
              <th style={{ width: 50 }}>Langkah</th>
              <th>Workstation</th>
              <th style={{ width: 200 }}>Cara Kerja</th>
              <th style={{ width: 220 }}>BoM</th>
              {editing && <th style={{ width: 40 }} />}
            </tr>
          </thead>
          <tbody>
            {steps.map((s, i) => {
              const err = (f: string) => errors[`steps.${s.key}.${f}`];
              const ws = s.workstation_id ? options.workstations.find((w) => w.id === s.workstation_id) : undefined;
              const bom = s.bom_id ? options.boms.find((b) => b.id === s.bom_id) : undefined;
              const rowError = err("workstation_id") ?? err("mode") ?? err("bom_id");
              return (
                <tr key={s.key} className={rowError ? "overrow" : undefined}>
                  <td className="no">{i + 1}</td>
                  <td>
                    {editing ? (
                      <Combobox
                        size="sm"
                        value={s.workstation_id}
                        options={options.workstations.filter((w) => w.active || w.id === s.workstation_id)}
                        placeholder="Pilih Workstation…"
                        invalid={Boolean(err("workstation_id"))}
                        onChange={(v) => setStep(s.key, { workstation_id: v })}
                      />
                    ) : (
                      <span className="idc">
                        <span className="lab">{ws?.label}</span>
                        <span className="nm">{ws?.name}</span>
                      </span>
                    )}
                    {rowError && <span className="overtag">{rowError}</span>}
                  </td>
                  <td>
                    {editing ? (
                      <Select size="sm" value={s.mode ?? ""} options={MODES} placeholder="Pilih Cara Kerja…" invalid={Boolean(err("mode"))} onChange={(v) => setStep(s.key, { mode: v as RoutingStepModeValue })} />
                    ) : (
                      ((s.mode && ROUTING_MODE_TEXT[s.mode]) ?? "")
                    )}
                  </td>
                  <td>
                    {editing ? (
                      <Combobox
                        size="sm"
                        value={s.bom_id ?? 0}
                        options={[{ id: 0, label: "", name: "Tanpa BoM", active: true }, ...options.boms.filter((b) => b.active || b.id === s.bom_id)]}
                        placeholder="Pilih BoM…"
                        invalid={Boolean(err("bom_id"))}
                        onChange={(v) => setStep(s.key, { bom_id: v || null })}
                      />
                    ) : bom ? (
                      <span className="lab">{bom.label}</span>
                    ) : (
                      <span className="dash">—</span>
                    )}
                  </td>
                  {editing && (
                    <td>
                      <button
                        className="iact del"
                        title="Hapus langkah"
                        onClick={() => {
                          setSteps((ss) => ss.filter((x) => x.key !== s.key));
                          touch("_steps");
                        }}
                      >
                        <Icon name="trash" size={14} />
                      </button>
                    </td>
                  )}
                </tr>
              );
            })}
            {steps.length === 0 && (
              <tr>
                <td colSpan={5} className="mut" style={{ textAlign: "center" }}>
                  {editing ? "Pilih Routing untuk menyalin rutenya, atau tambahkan langkah." : "Belum ada langkah."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );

  // =================================================== requirements card
  const stationOf = (id: number | null) => (id ? options.workstations.find((w) => w.id === id) : undefined);
  const requirementsCard = (
    <div className="card" style={{ marginTop: 14 }}>
      <div className="card-h">
        <span className="ci">
          <Icon name="layers" size={15} />
        </span>
        <div className="ct">
          <h3>Kebutuhan Bahan</h3>
          <p>
            Dari BoM pada rute (atau BoM default Item Target) × Qty Target, per workstation yang memakainya. Tidak diketik; lot dipilih di BSTB.
            {opened ? " Dikirim adalah yang sudah keluar ke workstation itu dengan BSTB dan tidak ditolak." : ""}
          </p>
        </div>
      </div>
      {requirements.length === 0 ? (
        <div className="empty sm">
          <div className="ic">
            <Icon name="layers" size={18} />
          </div>
          <h4>Tanpa kebutuhan bahan</h4>
          <p>
            {header.target_item_id && Number(header.target_qty) > 0
              ? "Tidak ada BoM pada rute maupun BoM default untuk Item Target ini: bahan yang dipakai bebas."
              : "Pilih Item Target dan isi Qty Target; kebutuhan dihitung dari BoM-nya."}
          </p>
        </div>
      ) : (
        <div className="tw">
          <table className="grid ltab" style={{ minWidth: 700 }}>
            <thead>
              <tr>
                <th style={{ width: 40 }}>No</th>
                <th>Barang</th>
                <th style={{ width: 200 }}>Workstation</th>
                <th className="num" style={{ width: 150 }}>
                  Kebutuhan
                </th>
                {opened && (
                  <th className="num" style={{ width: 130 }}>
                    Dikirim
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {requirements.map((r, i) => {
                const item = itemById.get(r.itemId);
                const ws = stationOf(r.workstationId);
                const done = sent[requirementKey(r.itemId, r.workstationId)] ?? 0;
                return (
                  <tr key={`${r.itemId}|${r.stepNo ?? 0}`}>
                    <td className="no">{i + 1}</td>
                    <td>
                      <span className="idc">
                        <span className="lab">{item?.label}</span>
                        <span className="nm">{item?.name}</span>
                      </span>
                    </td>
                    <td>
                      {ws ? (
                        <span className="idc">
                          <span className="lab">{ws.label}</span>
                          <span className="nm">langkah {r.stepNo}</span>
                        </span>
                      ) : (
                        <span className="dash">—</span>
                      )}
                    </td>
                    <td className="num">
                      <span className="qview">
                        <span className="mny">{qtyText(r.qty)}</span>
                        <span className="lab">{item?.uomLabel}</span>
                      </span>
                    </td>
                    {opened && (
                      <td className="num">
                        <span className={`mny${done + 1e-9 >= r.qty ? " in" : ""}`}>{qtyText(done)}</span>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );

  // ============================================================== page
  const backHref = order ? `/production/order/${order.id}` : "/production/order";
  return (
    <>
      <div className="ph">
        <div className="crumb">
          <span>Produksi</span>
          <span>/</span>
          <Link href="/production/order">Perintah Produksi</Link>
          <span>/</span>
          <span className="cur">{order ? order.orderNo : "Baru"}</span>
        </div>
        <div className="ph-row">
          <h1>
            <span className="ph-ico">
              <Icon name="clip" size={16} />
            </span>
            {order ? (
              <>
                <span className="docno">{order.orderNo}</span>
                <span className={`bdg ${PRODUCTION_ORDER_STATUS_BADGE[status]}`}>{PRODUCTION_ORDER_STATUS_TEXT[status]}</span>
              </>
            ) : (
              "Perintah Produksi Baru"
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
              <ProductionOrderActions id={order!.id} subject={order!.orderNo} status={status} can={can} />
            )}
          </div>
        </div>
      </div>

      <div className="fgrid solo">
        <div>
          {headerCard}
          {stepsCard}
          {requirementsCard}
        </div>
      </div>
    </>
  );
}
