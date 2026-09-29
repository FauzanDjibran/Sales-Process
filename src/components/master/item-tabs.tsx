"use client";

import { useState } from "react";
import { Icon } from "@/components/icon";
import { Combobox } from "@/components/ui/combobox";
import { Dialog } from "@/components/ui/dialog";
import { Field, FormRow } from "@/components/ui/form";
import { MoneyInput } from "@/components/ui/money-input";
import {
  CollectionCard,
  RowActions,
  newKey,
  type CollectionTabProps,
} from "@/components/master/collection-tab";
import { uomErrors, type UomDraft } from "@/lib/erp/item-shape";
import type { RefOption } from "@/lib/erp/records";
import { formatNumber } from "@/lib/format";

/**
 * The Item form's Konversi Satuan tab: the item's other units and how many
 * base units each holds — `1 BOX = 12 PCS`.
 *
 * The base unit is chosen in the header, so the tab reads it from the form
 * (`context`) rather than keeping a copy: change the base unit and every row
 * reads against the new one at once. Rows are saved with the Item.
 */

/** A factor as written, without the trailing zeros a Decimal comes back with. */
const factorText = (f: string) => formatNumber(Number(f), Number(f) % 1 ? 4 : 0).replace(/(,\d*?)0+$/, "$1").replace(/,$/, "");

export function UomConversionsTab({
  editing,
  items,
  error,
  onChange,
  context,
}: CollectionTabProps<UomDraft>) {
  const [open, setOpen] = useState<UomDraft | null>(null);

  const uomOptions = context?.refs.base_uom_id ?? [];
  const baseUomId = Number(context?.values.base_uom_id) || null;
  const base = uomOptions.find((o) => o.id === baseUomId) ?? null;

  const blank = (): UomDraft => ({ key: newKey("u"), uomId: null, factor: "", uomLabel: "", uomName: "" });

  const apply = (u: UomDraft) => {
    const exists = items.some((x) => x.key === u.key);
    onChange(exists ? items.map((x) => (x.key === u.key ? u : x)) : [...items, u]);
    setOpen(null);
  };

  const addButton = (
    <button className="btn primary sm cta" onClick={() => setOpen(blank())} disabled={!base}>
      <Icon name="plus" size={14} /> Tambah Konversi
    </button>
  );

  return (
    <CollectionCard
      icon="scale"
      title="Konversi Satuan"
      desc={
        base
          ? `Satuan lain untuk item ini dan isinya dalam ${base.label}. Tidak wajib.`
          : "Setiap konversi dihitung ke Satuan Dasar, yang belum dipilih."
      }
      editing={editing && Boolean(base)}
      addLabel="Tambah Konversi"
      onAdd={() => setOpen(blank())}
      error={error}
    >
      {items.length === 0 ? (
        <div className="empty sm">
          <div className="ic">
            <Icon name="scale" size={18} />
          </div>
          <h4>Belum ada konversi satuan</h4>
          <p>
            {base
              ? `Item ini hanya dihitung dalam ${base.label}. Tambahkan satuan lain bila dijual per kemasan, mis. BOX.`
              : "Pilih Satuan Dasar pada bagian atas terlebih dahulu."}
          </p>
          {editing && base && addButton}
        </div>
      ) : (
        <div className="tw">
          <table className="grid coll">
            <thead>
              <tr>
                <th style={{ width: 44 }}>No</th>
                <th>Satuan</th>
                <th className="num" style={{ width: 150 }}>Faktor</th>
                <th>Konversi</th>
                {editing && <th style={{ width: 72 }} />}
              </tr>
            </thead>
            <tbody>
              {items.map((u, i) => (
                <tr
                  key={u.key}
                  className={editing ? "ed" : undefined}
                  onClick={editing ? () => setOpen(u) : undefined}
                >
                  <td className="no">{i + 1}</td>
                  <td>
                    <span className="idc">
                      <span className="lab">{u.uomLabel}</span>
                      <span className="nm">{u.uomName}</span>
                    </span>
                  </td>
                  <td className="num mono">{factorText(u.factor)}</td>
                  <td className="mut">
                    1 {u.uomLabel} = {factorText(u.factor)} {base?.label ?? "satuan dasar"}
                  </td>
                  {editing && (
                    <td>
                      <RowActions
                        onEdit={() => setOpen(u)}
                        onRemove={() => onChange(items.filter((x) => x.key !== u.key))}
                      />
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {open && (
        <UomDialog
          initial={open}
          isNew={!items.some((x) => x.key === open.key)}
          baseUomId={baseUomId}
          baseLabel={base?.label ?? ""}
          options={uomOptions.filter((o) => o.id !== baseUomId)}
          takenUomIds={items.filter((x) => x.key !== open.key).flatMap((x) => (x.uomId ? [x.uomId] : []))}
          onCancel={() => setOpen(null)}
          onApply={apply}
        />
      )}
    </CollectionCard>
  );
}

function UomDialog({
  initial,
  isNew,
  baseUomId,
  baseLabel,
  options,
  takenUomIds,
  onCancel,
  onApply,
}: {
  initial: UomDraft;
  isNew: boolean;
  baseUomId: number | null;
  baseLabel: string;
  options: RefOption[];
  takenUomIds: number[];
  onCancel: () => void;
  onApply: (u: UomDraft) => void;
}) {
  const [u, setU] = useState<UomDraft>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const chosen = options.find((o) => o.id === u.uomId);

  const submit = () => {
    const found = uomErrors(u, baseUomId, takenUomIds);
    if (Object.keys(found).length) {
      setErrors(found);
      return;
    }
    onApply({ ...u, uomLabel: chosen?.label ?? u.uomLabel, uomName: chosen?.name ?? u.uomName });
  };

  return (
    <Dialog
      open
      icon="scale"
      title={isNew ? "Tambah Konversi Satuan" : "Ubah Konversi Satuan"}
      subtitle={`Berapa ${baseLabel} dalam satu satuan ini.`}
      width={620}
      onClose={onCancel}
      foot={
        <>
          <span className="fnote">Tersimpan ke database saat Item disimpan.</span>
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
        <Field label="Satuan" span={6} required error={errors.uom}>
          <Combobox
            value={u.uomId}
            options={options}
            placeholder="Pilih Satuan…"
            invalid={Boolean(errors.uom)}
            onChange={(id) => {
              setU((x) => ({ ...x, uomId: id }));
              setErrors((e) => ({ ...e, uom: "" }));
            }}
          />
        </Field>
        <Field label="Faktor" span={6} required help={`isi dalam ${baseLabel}`} error={errors.factor}>
          <MoneyInput
            value={u.factor}
            currencyLabel={baseLabel}
            decimals={4}
            invalid={Boolean(errors.factor)}
            placeholder="12"
            onChange={(v) => {
              setU((x) => ({ ...x, factor: v }));
              setErrors((e) => ({ ...e, factor: "" }));
            }}
          />
        </Field>
        <Field label="Artinya" span={12}>
          <div className="ro">
            {chosen && Number(u.factor) > 0
              ? `1 ${chosen.label} = ${factorText(u.factor)} ${baseLabel}`
              : "menunggu satuan dan faktor"}
          </div>
        </Field>
      </FormRow>
    </Dialog>
  );
}
