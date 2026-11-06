"use client";

import { useState } from "react";
import { Icon } from "@/components/icon";
import { Combobox } from "@/components/ui/combobox";
import { Dialog } from "@/components/ui/dialog";
import { Field, FormRow } from "@/components/ui/form";
import { RateInput } from "@/components/ui/rate-input";
import { CollectionCard, RowActions, newKey, type CollectionTabProps } from "@/components/master/collection-tab";
import {
  EXIT_ROUTE_LABEL,
  exitRoutes,
  stepErrors,
  type RateDraft,
  type StepDraft,
} from "@/lib/erp/production-master-shape";
import { formatPrice } from "@/lib/format";
import type { RefOption } from "@/lib/erp/records";

/**
 * The Routing form's Langkah tab and the Standard Cost form's Rate per Unit
 * tab (P225). Rows are saved with the record; the order of the steps is the
 * order of the routing.
 */

function UnitCell({ units, id }: { units: RefOption[]; id: number | null }) {
  const u = units.find((x) => x.id === id);
  return u ? (
    <>
      <span className="lab">{u.label}</span> {u.name}
    </>
  ) : (
    <span className="mut">—</span>
  );
}

const offered = (units: RefOption[], keep: number | null) => units.filter((u) => u.active || u.id === keep);

// ------------------------------------------------------------- routing steps

export function RoutingStepsTab({ editing, locked, items, error, onChange, context }: CollectionTabProps<StepDraft>) {
  const [open, setOpen] = useState<StepDraft | null>(null);
  const units = context?.refs._units ?? [];
  const routes = exitRoutes(
    items.map((s) => units.find((u) => u.id === s.unit_id)?.workstationId ?? null),
    Number(context?.values.line_id) > 0
  );

  const blank = (): StepDraft => ({ key: newKey("s"), unit_id: null, is_checkpoint: false, is_skippable: false });
  const apply = (s: StepDraft) => {
    onChange(items.some((x) => x.key === s.key) ? items.map((x) => (x.key === s.key ? s : x)) : [...items, s]);
    setOpen(null);
  };
  const move = (i: number, by: -1 | 1) => {
    const next = [...items];
    [next[i], next[i + by]] = [next[i + by], next[i]];
    onChange(next);
  };

  return (
    <CollectionCard
      icon="tree"
      title="Langkah"
      desc="Unit berurutan yang dilalui barang. Keluar Lewat dihitung dari Workstation: satu Workstation Dokumen Push, lintas Workstation BSTB."
      editing={editing}
      locked={locked}
      addLabel="Tambah Langkah"
      onAdd={() => setOpen(blank())}
      error={error}
    >
      {items.length === 0 ? (
        <div className="empty sm">
          <div className="ic">
            <Icon name="tree" size={18} />
          </div>
          <h4>Belum ada langkah</h4>
          <p>Tambahkan unit pertama yang dilalui barang.</p>
        </div>
      ) : (
        <div className="tw">
          <table className="grid coll" style={{ minWidth: 700 }}>
            <thead>
              <tr>
                <th style={{ width: 44 }}>No</th>
                <th>Unit</th>
                <th style={{ width: 130 }}>Keluar Lewat</th>
                <th style={{ width: 110 }}>Checkpoint</th>
                <th style={{ width: 110 }}>Boleh Dilewati</th>
                {editing && <th style={{ width: 130 }} />}
              </tr>
            </thead>
            <tbody>
              {items.map((s, i) => (
                <tr key={s.key} className={editing ? "ed" : undefined} onClick={editing ? () => setOpen(s) : undefined}>
                  <td className="no">{i + 1}</td>
                  <td>
                    <UnitCell units={units} id={s.unit_id} />
                  </td>
                  <td>{routes[i] ? EXIT_ROUTE_LABEL[routes[i]] : "—"}</td>
                  <td>{s.is_checkpoint ? "Ya" : "—"}</td>
                  <td>{s.is_skippable ? "Ya" : "—"}</td>
                  {editing && (
                    <td>
                      <div className="ract">
                        <button
                          className="iact"
                          title="Naik"
                          disabled={i === 0}
                          onClick={(e) => {
                            e.stopPropagation();
                            move(i, -1);
                          }}
                        >
                          <Icon name="collapse" size={14} />
                        </button>
                        <button
                          className="iact"
                          title="Turun"
                          disabled={i === items.length - 1}
                          onClick={(e) => {
                            e.stopPropagation();
                            move(i, 1);
                          }}
                        >
                          <Icon name="expand" size={14} />
                        </button>
                        <RowActions onEdit={() => setOpen(s)} onRemove={() => onChange(items.filter((x) => x.key !== s.key))} />
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {open && (
        <StepDialog
          initial={open}
          isNew={!items.some((x) => x.key === open.key)}
          units={units}
          takenUnits={items.filter((x) => x.key !== open.key).flatMap((x) => (x.unit_id ? [x.unit_id] : []))}
          onCancel={() => setOpen(null)}
          onApply={apply}
        />
      )}
    </CollectionCard>
  );
}

function StepDialog({
  initial,
  isNew,
  units,
  takenUnits,
  onCancel,
  onApply,
}: {
  initial: StepDraft;
  isNew: boolean;
  units: RefOption[];
  takenUnits: number[];
  onCancel: () => void;
  onApply: (s: StepDraft) => void;
}) {
  const [s, setS] = useState<StepDraft>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const submit = () => {
    const found = stepErrors(s, takenUnits);
    if (Object.keys(found).length) setErrors(found);
    else onApply(s);
  };
  return (
    <Dialog
      open
      icon="tree"
      title={isNew ? "Tambah Langkah" : "Ubah Langkah"}
      subtitle="Satu unit dalam urutan routing."
      width={620}
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
        <Field label="Unit" span={12} required error={errors.unit_id}>
          <Combobox
            value={s.unit_id}
            options={offered(units, initial.unit_id)}
            placeholder="Pilih Unit…"
            invalid={Boolean(errors.unit_id)}
            onChange={(v) => {
              setS((x) => ({ ...x, unit_id: v == null ? null : Number(v) }));
              setErrors((e) => ({ ...e, unit_id: "" }));
            }}
          />
        </Field>
        <Field label="Checkpoint" span={6} help="keluar langkah ini seluruh isi partai harus lengkap">
          <label className="chk sm">
            <input type="checkbox" checked={s.is_checkpoint} onChange={(e) => setS((x) => ({ ...x, is_checkpoint: e.target.checked }))} />
            <span>
              <span className="ct">Checkpoint partai</span>
            </span>
          </label>
        </Field>
        <Field label="Dilewati" span={6}>
          <label className="chk sm">
            <input type="checkbox" checked={s.is_skippable} onChange={(e) => setS((x) => ({ ...x, is_skippable: e.target.checked }))} />
            <span>
              <span className="ct">Boleh dilewati</span>
            </span>
          </label>
        </Field>
      </FormRow>
    </Dialog>
  );
}

// -------------------------------------------------------------------- rates

/**
 * One row per Unit in routing order, typed in place: the version is written once,
 * so the whole of it is on one screen. A Unit left empty has no row, and costs 0.
 */
export function RateLinesTab({ editing, items, error, onChange, context }: CollectionTabProps<RateDraft>) {
  const units = context?.refs._units ?? [];
  const rateOf = (unitId: number) => items.find((r) => r.unit_id === unitId)?.rate ?? "";
  const rows = units.filter((u) => (editing ? u.active : rateOf(u.id) !== ""));

  const type = (unitId: number, rate: string) =>
    onChange(
      rate === ""
        ? items.filter((r) => r.unit_id !== unitId)
        : items.some((r) => r.unit_id === unitId)
          ? items.map((r) => (r.unit_id === unitId ? { ...r, rate } : r))
          : [...items, { key: newKey("r"), unit_id: unitId, rate }]
    );

  return (
    <CollectionCard
      icon="calc"
      title="Rate per Unit"
      desc="Rate biaya per gram input, urut routing. Unit yang kosong berarti rate 0. Versi tidak dapat diubah setelah disimpan."
      editing={editing}
      error={error}
    >
      {rows.length === 0 ? (
        <div className="empty sm">
          <div className="ic">
            <Icon name="calc" size={18} />
          </div>
          <h4>{editing ? "Belum ada unit aktif" : "Semua unit berate 0"}</h4>
          <p>{editing ? "Buat Unit lebih dulu." : "Versi ini tidak mengisi rate untuk unit mana pun."}</p>
        </div>
      ) : (
        <div className="tw">
          <table className="grid coll" style={{ minWidth: 520 }}>
            <thead>
              <tr>
                <th style={{ width: 44 }}>No</th>
                <th>Unit</th>
                <th className="num" style={{ width: 220 }}>
                  Rate per Gram
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((u, i) => (
                <tr key={u.id}>
                  <td className="no">{i + 1}</td>
                  <td>
                    <span className="lab">{u.label}</span> {u.name}
                  </td>
                  <td className="num mono">
                    {editing ? <RateInput value={rateOf(u.id)} pairLabel="Rp/g" onChange={(v) => type(u.id, v)} /> : formatPrice(rateOf(u.id))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </CollectionCard>
  );
}
