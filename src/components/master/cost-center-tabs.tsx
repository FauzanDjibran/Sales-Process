"use client";

import { useState } from "react";
import { Icon } from "@/components/icon";
import { Combobox } from "@/components/ui/combobox";
import { Dialog } from "@/components/ui/dialog";
import { Field, FormRow } from "@/components/ui/form";
import { PercentInput } from "@/components/ui/percent-input";
import { CollectionCard, RowActions, newKey, type CollectionTabProps } from "@/components/master/collection-tab";
import { formatPct } from "@/lib/format";
import {
  SPREAD_TARGETS_REF,
  percentUnits,
  spreadRowErrors,
  spreadTotalProblem,
  type SpreadDraft,
} from "@/lib/erp/cost-center-shape";

/**
 * An Overhead Cost Center's Alokasi tab, shown while its Metode Alokasi is
 * Persentase (P159): the share of its balance each Production Cost Center
 * takes at the month-end close, 100% in all. Rows are saved with the Cost
 * Center.
 */
export function CostCenterSpreadsTab({ editing, items, error, onChange, context }: CollectionTabProps<SpreadDraft>) {
  const [open, setOpen] = useState<SpreadDraft | null>(null);
  const targets = context?.refs[SPREAD_TARGETS_REF] ?? [];
  const byId = new Map(targets.map((t) => [t.id, t]));
  const total = items.reduce((s, r) => s + (percentUnits(r.percent) ?? 0), 0) / 10000;
  const totalProblem = items.length ? spreadTotalProblem(items) : null;

  const blank = (): SpreadDraft => ({ key: newKey("s"), costCenterId: null, percent: "" });
  const apply = (r: SpreadDraft) => {
    const exists = items.some((x) => x.key === r.key);
    onChange(exists ? items.map((x) => (x.key === r.key ? r : x)) : [...items, r]);
    setOpen(null);
  };

  return (
    <CollectionCard
      icon="layers"
      title="Alokasi"
      desc="Bagian saldo Overhead yang diterima setiap Cost Center Produksi saat penutupan bulan. Jumlahnya tepat 100%."
      editing={editing}
      addLabel="Tambah Alokasi"
      onAdd={() => setOpen(blank())}
      error={error}
    >
      {items.length === 0 ? (
        <div className="empty sm">
          <div className="ic">
            <Icon name="layers" size={18} />
          </div>
          <h4>Belum ada alokasi</h4>
          <p>Tambahkan Cost Center Produksi yang menerima bagian Overhead ini, mis. MIX 50%, FILL 30%, PACK 20%.</p>
          {editing && (
            <button className="btn primary sm cta" onClick={() => setOpen(blank())}>
              <Icon name="plus" size={14} /> Tambah Alokasi
            </button>
          )}
        </div>
      ) : (
        <div className="tw">
          <table className="grid coll">
            <thead>
              <tr>
                <th style={{ width: 44 }}>No</th>
                <th>Cost Center Produksi</th>
                <th className="num" style={{ width: 140 }}>Persentase</th>
                {editing && <th style={{ width: 72 }} />}
              </tr>
            </thead>
            <tbody>
              {items.map((r, i) => {
                const t = r.costCenterId ? byId.get(r.costCenterId) : undefined;
                return (
                  <tr key={r.key} className={editing ? "ed" : undefined} onClick={editing ? () => setOpen(r) : undefined}>
                    <td className="no">{i + 1}</td>
                    <td>
                      {t ? (
                        <span className="idc">
                          <span className="lab">{t.label}</span>
                          <span className="nm">{t.name}</span>
                        </span>
                      ) : (
                        <span className="dash">—</span>
                      )}
                    </td>
                    <td className="num">
                      <span className="mny">{formatPct(Number(r.percent))}</span>
                    </td>
                    {editing && (
                      <td>
                        <RowActions onEdit={() => setOpen(r)} onRemove={() => onChange(items.filter((x) => x.key !== r.key))} />
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td />
                <td>Jumlah{totalProblem && editing ? <span className="mut"> — harus 100%</span> : null}</td>
                <td className="num">
                  <span className="mny">{formatPct(total)}</span>
                </td>
                {editing && <td />}
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {open && (
        <SpreadDialog
          initial={open}
          isNew={!items.some((x) => x.key === open.key)}
          options={targets.filter((t) => t.active || t.id === open.costCenterId)}
          taken={items.filter((x) => x.key !== open.key && x.costCenterId).map((x) => x.costCenterId!)}
          onCancel={() => setOpen(null)}
          onApply={apply}
        />
      )}
    </CollectionCard>
  );
}

function SpreadDialog({
  initial,
  isNew,
  options,
  taken,
  onCancel,
  onApply,
}: {
  initial: SpreadDraft;
  isNew: boolean;
  options: { id: number; label: string; name: string; active: boolean }[];
  taken: number[];
  onCancel: () => void;
  onApply: (r: SpreadDraft) => void;
}) {
  const [r, setR] = useState<SpreadDraft>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const submit = () => {
    const found = spreadRowErrors(r, taken);
    if (Object.keys(found).length) {
      setErrors(found);
      return;
    }
    onApply(r);
  };

  return (
    <Dialog
      open
      icon="layers"
      title={isNew ? "Tambah Alokasi" : "Ubah Alokasi"}
      subtitle="Bagian saldo Overhead untuk satu Cost Center Produksi."
      width={620}
      onClose={onCancel}
      foot={
        <>
          <span className="fnote">Tersimpan ke database saat Cost Center disimpan.</span>
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
        <Field label="Cost Center Produksi" span={8} required error={errors.costCenterId}>
          <Combobox
            value={r.costCenterId}
            options={options.filter((o) => !taken.includes(o.id))}
            placeholder="Pilih Cost Center Produksi…"
            emptyText="Belum ada Cost Center Produksi lain yang aktif"
            invalid={Boolean(errors.costCenterId)}
            onChange={(v) => {
              setR((x) => ({ ...x, costCenterId: v }));
              setErrors((e) => ({ ...e, costCenterId: "" }));
            }}
          />
        </Field>
        <Field label="Persentase" span={4} required error={errors.percent}>
          <PercentInput
            value={r.percent}
            decimals={4}
            invalid={Boolean(errors.percent)}
            ariaLabel="Persentase alokasi"
            onChange={(v) => {
              setR((x) => ({ ...x, percent: v }));
              setErrors((e) => ({ ...e, percent: "" }));
            }}
          />
        </Field>
      </FormRow>
    </Dialog>
  );
}
