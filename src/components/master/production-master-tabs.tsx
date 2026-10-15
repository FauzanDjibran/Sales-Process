"use client";

import { useState } from "react";
import { Icon } from "@/components/icon";
import { Combobox } from "@/components/ui/combobox";
import { Dialog } from "@/components/ui/dialog";
import { Field, FormRow } from "@/components/ui/form";
import { RateInput } from "@/components/ui/rate-input";
import { Select } from "@/components/ui/select";
import { CollectionCard, RowActions, newKey, type CollectionTabProps } from "@/components/master/collection-tab";
import { formatQty } from "@/lib/format";
import type { RefOption } from "@/lib/erp/records";
import {
  BOM_COMPONENT_OPTIONS,
  ROUTING_BOM_OPTIONS,
  ROUTING_MODE_TEXT,
  ROUTING_WORKSTATION_OPTIONS,
  bomLineErrors,
  routingStepErrors,
  type BomLineDraft,
  type RoutingStepDraft,
  type RoutingStepModeValue,
} from "@/lib/erp/production-master-shape";

/**
 * The Komponen tab of a Bill of Materials and the Langkah tab of a Routing
 * (Walet build step 1). Rows are saved with their record (P38).
 */

function Ident({ o }: { o?: RefOption }) {
  return o ? (
    <span className="idc">
      <span className="lab">{o.label}</span>
      <span className="nm">{o.name}</span>
    </span>
  ) : (
    <span className="dash">—</span>
  );
}

const STEP_CHOICES = Array.from({ length: 30 }, (_, i) => ({ value: String(i + 1), label: `Langkah ${i + 1}` }));

// ------------------------------------------------------------------- BoM

export function BomLinesTab({ editing, items, error, onChange, context }: CollectionTabProps<BomLineDraft>) {
  const [open, setOpen] = useState<BomLineDraft | null>(null);
  const options = context?.refs[BOM_COMPONENT_OPTIONS] ?? [];
  const byId = new Map(options.map((o) => [o.id, o]));
  const outputItemId = Number(context?.values.item_id) || null;

  const blank = (): BomLineDraft => ({ key: newKey("l"), itemId: null, qty: "", stepNo: null });
  const apply = (l: BomLineDraft) => {
    const exists = items.some((x) => x.key === l.key);
    onChange(exists ? items.map((x) => (x.key === l.key ? l : x)) : [...items, l]);
    setOpen(null);
  };

  return (
    <CollectionCard
      icon="box"
      title="Komponen"
      desc="Barang yang dipakai per jumlah dasar. Saran saja — Eksekusi Produksi mencatat yang benar-benar dipakai."
      editing={editing}
      addLabel="Tambah Komponen"
      onAdd={() => setOpen(blank())}
      error={error}
    >
      {items.length === 0 ? (
        <div className="empty sm">
          <div className="ic">
            <Icon name="box" size={18} />
          </div>
          <h4>Belum ada komponen</h4>
          <p>Tambahkan barang yang masuk, mis. 50 g N-NL-PU dan 1 box untuk satu N-MK 50 g.</p>
          {editing && (
            <button className="btn primary sm cta" onClick={() => setOpen(blank())}>
              <Icon name="plus" size={14} /> Tambah Komponen
            </button>
          )}
        </div>
      ) : (
        <div className="tw">
          <table className="grid coll">
            <thead>
              <tr>
                <th style={{ width: 44 }}>No</th>
                <th>Komponen</th>
                <th className="num" style={{ width: 160 }}>Jumlah</th>
                <th style={{ width: 140 }}>Langkah</th>
                {editing && <th style={{ width: 72 }} />}
              </tr>
            </thead>
            <tbody>
              {items.map((l, i) => (
                <tr key={l.key} className={editing ? "ed" : undefined} onClick={editing ? () => setOpen(l) : undefined}>
                  <td className="no">{i + 1}</td>
                  <td>
                    <Ident o={l.itemId ? byId.get(l.itemId) : undefined} />
                  </td>
                  <td className="num">
                    <span className="mny">{formatQty(l.qty)}</span>
                  </td>
                  <td>{l.stepNo ? `Langkah ${l.stepNo}` : <span className="mut">langkah hasil</span>}</td>
                  {editing && (
                    <td>
                      <RowActions onEdit={() => setOpen(l)} onRemove={() => onChange(items.filter((x) => x.key !== l.key))} />
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {open && (
        <BomLineDialog
          initial={open}
          isNew={!items.some((x) => x.key === open.key)}
          options={options.filter((o) => (o.active || o.id === open.itemId) && o.id !== outputItemId)}
          taken={items.filter((x) => x.key !== open.key && x.itemId).map((x) => x.itemId!)}
          outputItemId={outputItemId}
          onCancel={() => setOpen(null)}
          onApply={apply}
        />
      )}
    </CollectionCard>
  );
}

function BomLineDialog({
  initial,
  isNew,
  options,
  taken,
  outputItemId,
  onCancel,
  onApply,
}: {
  initial: BomLineDraft;
  isNew: boolean;
  options: RefOption[];
  taken: number[];
  outputItemId: number | null;
  onCancel: () => void;
  onApply: (l: BomLineDraft) => void;
}) {
  const [l, setL] = useState<BomLineDraft>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const submit = () => {
    const found = bomLineErrors(l, taken, outputItemId);
    if (Object.keys(found).length) return setErrors(found);
    onApply(l);
  };
  return (
    <Dialog
      open
      icon="box"
      title={isNew ? "Tambah Komponen" : "Ubah Komponen"}
      subtitle="Barang yang masuk per jumlah dasar BoM ini."
      width={640}
      onClose={onCancel}
      foot={
        <>
          <span className="fnote">Tersimpan ke database saat BoM disimpan.</span>
          <button className="btn" onClick={onCancel}>
            Batal
          </button>
          <button className="btn primary" onClick={submit}>
            <Icon name="check" size={15} /> {isNew ? "Tambahkan" : "Perbarui"}
          </button>
        </>
      }
    >
      <FormRow>
        <Field label="Komponen" span={12} required error={errors.itemId}>
          <Combobox
            value={l.itemId}
            options={options.filter((o) => !taken.includes(o.id))}
            placeholder="Pilih komponen…"
            emptyText="Belum ada Barang dengan Kelola Stok yang belum dipakai"
            invalid={Boolean(errors.itemId)}
            onChange={(v) => {
              setL((x) => ({ ...x, itemId: v }));
              setErrors((e) => ({ ...e, itemId: "" }));
            }}
          />
        </Field>
        <Field label="Jumlah" span={6} required help="satuan dasar komponen" error={errors.qty}>
          <RateInput
            value={l.qty}
            invalid={Boolean(errors.qty)}
            ariaLabel="Jumlah komponen"
            onChange={(v) => {
              setL((x) => ({ ...x, qty: v }));
              setErrors((e) => ({ ...e, qty: "" }));
            }}
          />
        </Field>
        <Field label="Dipakai di Langkah" span={6} help="kosong = langkah yang menghasilkan barang ini" error={errors.stepNo}>
          <Select
            value={l.stepNo ? String(l.stepNo) : ""}
            options={[{ value: "", label: "Langkah hasil" }, ...STEP_CHOICES]}
            ariaLabel="Langkah routing"
            onChange={(v) => setL((x) => ({ ...x, stepNo: v ? Number(v) : null }))}
          />
        </Field>
      </FormRow>
    </Dialog>
  );
}

// --------------------------------------------------------------- Routing

const MODE_CHOICES = (Object.keys(ROUTING_MODE_TEXT) as RoutingStepModeValue[]).map((m) => ({ value: m, label: ROUTING_MODE_TEXT[m] }));

export function RoutingStepsTab({ editing, items, error, onChange, context }: CollectionTabProps<RoutingStepDraft>) {
  const [open, setOpen] = useState<{ step: RoutingStepDraft; at: number } | null>(null);
  const workstations = context?.refs[ROUTING_WORKSTATION_OPTIONS] ?? [];
  const boms = context?.refs[ROUTING_BOM_OPTIONS] ?? [];
  const wsById = new Map(workstations.map((o) => [o.id, o]));
  const bomById = new Map(boms.map((o) => [o.id, o]));

  const blank = (): RoutingStepDraft => ({ key: newKey("s"), workstationId: null, mode: "Transform", bomId: null });
  const apply = (s: RoutingStepDraft, at: number) => {
    const rest = items.filter((x) => x.key !== s.key);
    rest.splice(Math.min(Math.max(at, 0), rest.length), 0, s);
    onChange(rest);
    setOpen(null);
  };

  return (
    <CollectionCard
      icon="tree"
      title="Langkah"
      desc="Workstation yang dilalui Partai, berurutan. Transformasi membuat lot baru; Pass-through mempertahankan lot; Mix + Transformasi mencampur Job menjadi No. Moulding lebih dulu."
      editing={editing}
      addLabel="Tambah Langkah"
      onAdd={() => setOpen({ step: blank(), at: items.length })}
      error={error}
    >
      {items.length === 0 ? (
        <div className="empty sm">
          <div className="ic">
            <Icon name="tree" size={18} />
          </div>
          <h4>Belum ada langkah</h4>
          <p>Tambahkan workstation pertama, mis. UGH — Grading Halus, Transformasi.</p>
          {editing && (
            <button className="btn primary sm cta" onClick={() => setOpen({ step: blank(), at: 0 })}>
              <Icon name="plus" size={14} /> Tambah Langkah
            </button>
          )}
        </div>
      ) : (
        <div className="tw">
          <table className="grid coll">
            <thead>
              <tr>
                <th style={{ width: 70 }}>Langkah</th>
                <th>Workstation</th>
                <th style={{ width: 190 }}>Cara Kerja</th>
                <th style={{ width: 220 }}>BoM</th>
                {editing && <th style={{ width: 72 }} />}
              </tr>
            </thead>
            <tbody>
              {items.map((s, i) => (
                <tr key={s.key} className={editing ? "ed" : undefined} onClick={editing ? () => setOpen({ step: s, at: i }) : undefined}>
                  <td className="no">{i + 1}</td>
                  <td>
                    <Ident o={s.workstationId ? wsById.get(s.workstationId) : undefined} />
                  </td>
                  <td>
                    <span className={`bdg ${s.mode === "PassThrough" ? "t-slate" : s.mode === "MixTransform" ? "t-vio" : "t-info"}`}>{ROUTING_MODE_TEXT[s.mode]}</span>
                  </td>
                  <td>{s.bomId ? <span className="lab">{bomById.get(s.bomId)?.label ?? "—"}</span> : <span className="dash">—</span>}</td>
                  {editing && (
                    <td>
                      <RowActions onEdit={() => setOpen({ step: s, at: i })} onRemove={() => onChange(items.filter((x) => x.key !== s.key))} />
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {open && (
        <RoutingStepDialog
          initial={open.step}
          at={open.at}
          count={items.some((x) => x.key === open.step.key) ? items.length : items.length + 1}
          isNew={!items.some((x) => x.key === open.step.key)}
          workstations={workstations.filter((o) => o.active || o.id === open.step.workstationId)}
          boms={boms.filter((o) => o.active || o.id === open.step.bomId)}
          onCancel={() => setOpen(null)}
          onApply={apply}
        />
      )}
    </CollectionCard>
  );
}

function RoutingStepDialog({
  initial,
  at,
  count,
  isNew,
  workstations,
  boms,
  onCancel,
  onApply,
}: {
  initial: RoutingStepDraft;
  at: number;
  count: number;
  isNew: boolean;
  workstations: RefOption[];
  boms: RefOption[];
  onCancel: () => void;
  onApply: (s: RoutingStepDraft, at: number) => void;
}) {
  const [s, setS] = useState<RoutingStepDraft>(initial);
  const [position, setPosition] = useState(at);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const submit = () => {
    const found = routingStepErrors(s);
    if (Object.keys(found).length) return setErrors(found);
    onApply(s, position);
  };
  return (
    <Dialog
      open
      icon="tree"
      title={isNew ? "Tambah Langkah" : "Ubah Langkah"}
      subtitle="Satu workstation dalam urutan routing ini."
      width={640}
      onClose={onCancel}
      foot={
        <>
          <span className="fnote">Tersimpan ke database saat Routing disimpan.</span>
          <button className="btn" onClick={onCancel}>
            Batal
          </button>
          <button className="btn primary" onClick={submit}>
            <Icon name="check" size={15} /> {isNew ? "Tambahkan" : "Perbarui"}
          </button>
        </>
      }
    >
      <FormRow>
        <Field label="Urutan" span={4}>
          <Select
            value={String(position)}
            options={Array.from({ length: count }, (_, i) => ({ value: String(i), label: `Langkah ${i + 1}` }))}
            ariaLabel="Urutan langkah"
            onChange={(v) => setPosition(Number(v))}
          />
        </Field>
        <Field label="Workstation" span={8} required error={errors.workstationId}>
          <Combobox
            value={s.workstationId}
            options={workstations}
            placeholder="Pilih workstation…"
            invalid={Boolean(errors.workstationId)}
            onChange={(v) => {
              setS((x) => ({ ...x, workstationId: v }));
              setErrors((e) => ({ ...e, workstationId: "" }));
            }}
          />
        </Field>
        <Field label="Cara Kerja" span={6} required error={errors.mode}>
          <Select value={s.mode} options={MODE_CHOICES} ariaLabel="Cara kerja" onChange={(v) => setS((x) => ({ ...x, mode: v as RoutingStepModeValue }))} />
        </Field>
        <Field label="BoM" span={6} help="opsional — saran input di langkah ini">
          <Combobox
            value={s.bomId}
            options={boms}
            placeholder="Pilih BoM…"
            emptyText="Belum ada BoM"
            onChange={(v) => setS((x) => ({ ...x, bomId: v }))}
          />
        </Field>
      </FormRow>
    </Dialog>
  );
}
