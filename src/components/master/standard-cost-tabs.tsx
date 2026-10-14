"use client";

import { useState } from "react";
import { Icon } from "@/components/icon";
import { Combobox } from "@/components/ui/combobox";
import { Dialog } from "@/components/ui/dialog";
import { Field, FormRow } from "@/components/ui/form";
import { RateInput } from "@/components/ui/rate-input";
import { CollectionCard, RowActions, newKey, type CollectionTabProps } from "@/components/master/collection-tab";
import { formatPrice } from "@/lib/format";
import { ITEM_OPTIONS_REF, standardCostLineErrors, type StandardCostLineDraft } from "@/lib/erp/standard-cost-shape";

/**
 * A Standard Cost's Item tab (P160): the rate per Driver of each Standard
 * Cost Item at this workstation. Rows are saved with the Standard Cost. The
 * Eksekusi Produksi books Driver × each rate to the item's account with the
 * workstation's Cost Center.
 */
export function StandardCostLinesTab({ editing, items, error, onChange, context }: CollectionTabProps<StandardCostLineDraft>) {
  const [open, setOpen] = useState<StandardCostLineDraft | null>(null);
  const options = context?.refs[ITEM_OPTIONS_REF] ?? [];
  const byId = new Map(options.map((o) => [o.id, o]));
  const total = items.reduce((s, l) => s + (Number(l.rate) || 0), 0);

  const blank = (): StandardCostLineDraft => ({ key: newKey("l"), itemId: null, rate: "" });
  const apply = (l: StandardCostLineDraft) => {
    const exists = items.some((x) => x.key === l.key);
    onChange(exists ? items.map((x) => (x.key === l.key ? l : x)) : [...items, l]);
    setOpen(null);
  };

  return (
    <CollectionCard
      icon="layers"
      title="Item"
      desc="Tarif per Driver setiap Standard Cost Item di workstation ini. Item yang tidak ada, atau bertarif 0, tidak memiliki standar."
      editing={editing}
      addLabel="Tambah Item"
      onAdd={() => setOpen(blank())}
      error={error}
    >
      {items.length === 0 ? (
        <div className="empty sm">
          <div className="ic">
            <Icon name="layers" size={18} />
          </div>
          <h4>Belum ada item</h4>
          <p>Tambahkan Standard Cost Item yang dibebankan workstation ini, mis. TKL Rp 20.000 per Driver.</p>
          {editing && (
            <button className="btn primary sm cta" onClick={() => setOpen(blank())}>
              <Icon name="plus" size={14} /> Tambah Item
            </button>
          )}
        </div>
      ) : (
        <div className="tw">
          <table className="grid coll">
            <thead>
              <tr>
                <th style={{ width: 44 }}>No</th>
                <th>Standard Cost Item</th>
                <th className="num" style={{ width: 200 }}>Tarif per Driver</th>
                {editing && <th style={{ width: 72 }} />}
              </tr>
            </thead>
            <tbody>
              {items.map((l, i) => {
                const o = l.itemId ? byId.get(l.itemId) : undefined;
                return (
                  <tr key={l.key} className={editing ? "ed" : undefined} onClick={editing ? () => setOpen(l) : undefined}>
                    <td className="no">{i + 1}</td>
                    <td>
                      {o ? (
                        <span className="idc">
                          <span className="lab">{o.label}</span>
                          <span className="nm">{o.name}</span>
                        </span>
                      ) : (
                        <span className="dash">—</span>
                      )}
                    </td>
                    <td className="num">
                      <span className="mny">{formatPrice(Number(l.rate))}</span>
                    </td>
                    {editing && (
                      <td>
                        <RowActions onEdit={() => setOpen(l)} onRemove={() => onChange(items.filter((x) => x.key !== l.key))} />
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td />
                <td>Jumlah per Driver</td>
                <td className="num">
                  <span className="mny">{formatPrice(total)}</span>
                </td>
                {editing && <td />}
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {open && (
        <LineDialog
          initial={open}
          isNew={!items.some((x) => x.key === open.key)}
          options={options.filter((o) => o.active || o.id === open.itemId)}
          taken={items.filter((x) => x.key !== open.key && x.itemId).map((x) => x.itemId!)}
          onCancel={() => setOpen(null)}
          onApply={apply}
        />
      )}
    </CollectionCard>
  );
}

function LineDialog({
  initial,
  isNew,
  options,
  taken,
  onCancel,
  onApply,
}: {
  initial: StandardCostLineDraft;
  isNew: boolean;
  options: { id: number; label: string; name: string; active: boolean }[];
  taken: number[];
  onCancel: () => void;
  onApply: (l: StandardCostLineDraft) => void;
}) {
  const [l, setL] = useState<StandardCostLineDraft>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const submit = () => {
    const found = standardCostLineErrors(l, taken);
    if (Object.keys(found).length) {
      setErrors(found);
      return;
    }
    onApply(l);
  };

  return (
    <Dialog
      open
      icon="layers"
      title={isNew ? "Tambah Item" : "Ubah Item"}
      subtitle="Tarif per Driver satu Standard Cost Item di workstation ini."
      width={620}
      onClose={onCancel}
      foot={
        <>
          <span className="fnote">Tersimpan ke database saat Standard Cost disimpan.</span>
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
        <Field label="Standard Cost Item" span={8} required error={errors.itemId}>
          <Combobox
            value={l.itemId}
            options={options.filter((o) => !taken.includes(o.id))}
            placeholder="Pilih Standard Cost Item…"
            emptyText="Belum ada Standard Cost Item aktif yang belum dipakai"
            invalid={Boolean(errors.itemId)}
            onChange={(v) => {
              setL((x) => ({ ...x, itemId: v }));
              setErrors((e) => ({ ...e, itemId: "" }));
            }}
          />
        </Field>
        <Field label="Tarif per Driver" span={4} required help="Rp; 0 = tanpa standar" error={errors.rate}>
          <RateInput
            value={l.rate}
            invalid={Boolean(errors.rate)}
            ariaLabel="Tarif per Driver"
            onChange={(v) => {
              setL((x) => ({ ...x, rate: v }));
              setErrors((e) => ({ ...e, rate: "" }));
            }}
          />
        </Field>
      </FormRow>
    </Dialog>
  );
}
