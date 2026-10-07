"use client";

import { useState } from "react";
import { Icon } from "@/components/icon";
import { Dialog } from "@/components/ui/dialog";
import { Field, FormRow } from "@/components/ui/form";
import { Select } from "@/components/ui/select";
import { CollectionCard, RowActions, newKey, type CollectionTabProps } from "@/components/master/collection-tab";
import { STATUS_CLASS, STATUS_TEXT } from "@/lib/erp/entities";
import { locationDisplayLabel } from "@/lib/erp/warehouse-location";
import { locationErrors, type LocationDraft } from "@/lib/erp/warehouse-shape";

/**
 * The Gudang form's Lokasi tab, shown while Gunakan Lokasi is on: the places
 * inside the warehouse stock is kept in — each its own code, label and name,
 * read as `<gudang>-<lokasi>`. Rows are saved with the Gudang. A location stock
 * has moved through is never removed, only deactivated.
 */
export function WarehouseLocationsTab({ editing, items, error, onChange, context }: CollectionTabProps<LocationDraft>) {
  const [open, setOpen] = useState<LocationDraft | null>(null);
  const warehouseLabel = String(context?.values.warehouse_label ?? "").trim();
  const shown = (label: string) => (warehouseLabel ? locationDisplayLabel(warehouseLabel, label) : label);

  const blank = (): LocationDraft => ({ key: newKey("l"), code: "", label: "", name: "", status: "Active" });
  const apply = (l: LocationDraft) => {
    const exists = items.some((x) => x.key === l.key);
    onChange(exists ? items.map((x) => (x.key === l.key ? l : x)) : [...items, l]);
    setOpen(null);
  };

  return (
    <CollectionCard
      icon="layers"
      title="Lokasi"
      desc="Tempat di dalam gudang — rak, baris, bin. Setiap stok di gudang ini dicatat di salah satu lokasi aktif."
      editing={editing}
      addLabel="Tambah Lokasi"
      onAdd={() => setOpen(blank())}
      error={error}
    >
      {items.length === 0 ? (
        <div className="empty sm">
          <div className="ic">
            <Icon name="layers" size={18} />
          </div>
          <h4>Belum ada lokasi</h4>
          <p>Gudang dengan Gunakan Lokasi butuh minimal satu lokasi aktif, mis. A-01 untuk rak A baris 1.</p>
          {editing && (
            <button className="btn primary sm cta" onClick={() => setOpen(blank())}>
              <Icon name="plus" size={14} /> Tambah Lokasi
            </button>
          )}
        </div>
      ) : (
        <div className="tw">
          <table className="grid coll">
            <thead>
              <tr>
                <th style={{ width: 44 }}>No</th>
                <th style={{ width: 110 }}>Kode</th>
                <th style={{ width: 200 }}>Lokasi</th>
                <th>Nama</th>
                <th style={{ width: 110 }}>Status</th>
                {editing && <th style={{ width: 72 }} />}
              </tr>
            </thead>
            <tbody>
              {items.map((l, i) => (
                <tr key={l.key} className={editing ? "ed" : undefined} onClick={editing ? () => setOpen(l) : undefined}>
                  <td className="no">{i + 1}</td>
                  <td className="mono mut">{l.code || "baru"}</td>
                  <td>
                    <span className="lab">{shown(l.label)}</span>
                  </td>
                  <td>{l.name}</td>
                  <td>
                    <span className={`bdg ${STATUS_CLASS[l.status]}`}>{STATUS_TEXT[l.status]}</span>
                  </td>
                  {editing && (
                    <td>
                      <RowActions
                        onEdit={() => setOpen(l)}
                        onRemove={() => onChange(items.filter((x) => x.key !== l.key))}
                        removeBlocked={l.used ? "Sudah dipakai stok atau dokumen: nonaktifkan, jangan dihapus" : undefined}
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
        <LocationDialog
          initial={open}
          isNew={!items.some((x) => x.key === open.key)}
          warehouseLabel={warehouseLabel}
          takenLabels={items.filter((x) => x.key !== open.key).map((x) => x.label)}
          onCancel={() => setOpen(null)}
          onApply={apply}
        />
      )}
    </CollectionCard>
  );
}

function LocationDialog({
  initial,
  isNew,
  warehouseLabel,
  takenLabels,
  onCancel,
  onApply,
}: {
  initial: LocationDraft;
  isNew: boolean;
  warehouseLabel: string;
  takenLabels: string[];
  onCancel: () => void;
  onApply: (l: LocationDraft) => void;
}) {
  const [l, setL] = useState<LocationDraft>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const label = l.label.trim();

  const submit = () => {
    const found = locationErrors(l, takenLabels);
    if (Object.keys(found).length) {
      setErrors(found);
      return;
    }
    onApply({ ...l, label, name: l.name.trim() });
  };

  return (
    <Dialog
      open
      icon="layers"
      title={isNew ? "Tambah Lokasi" : "Ubah Lokasi"}
      subtitle={warehouseLabel ? `Lokasi di gudang ${warehouseLabel}.` : "Lokasi di gudang ini."}
      width={620}
      onClose={onCancel}
      foot={
        <>
          <span className="fnote">Tersimpan ke database saat Gudang disimpan.</span>
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
        <Field label="Label" span={4} required help="tanpa spasi" error={errors.label}>
          <input
            className={`inp idf${errors.label ? " bad" : ""}`}
            value={l.label}
            placeholder="A-01"
            autoComplete="off"
            onChange={(e) => {
              setL((x) => ({ ...x, label: e.target.value }));
              setErrors((er) => ({ ...er, label: "" }));
            }}
          />
        </Field>
        <Field label="Nama Lokasi" span={8} required error={errors.name}>
          <input
            className={`inp${errors.name ? " bad" : ""}`}
            value={l.name}
            placeholder="Rak A, baris 1"
            autoComplete="off"
            onChange={(e) => {
              setL((x) => ({ ...x, name: e.target.value }));
              setErrors((er) => ({ ...er, name: "" }));
            }}
          />
        </Field>
        <Field label="Ditampilkan" span={8}>
          <div className="ro">
            <span className="lab">{label ? (warehouseLabel ? locationDisplayLabel(warehouseLabel, label) : label) : "menunggu label"}</span>
          </div>
        </Field>
        <Field label="Status" span={4}>
          <Select
            value={l.status}
            options={[
              { value: "Active", label: STATUS_TEXT.Active },
              { value: "Inactive", label: STATUS_TEXT.Inactive },
            ]}
            ariaLabel="Status lokasi"
            onChange={(v) => setL((x) => ({ ...x, status: v as LocationDraft["status"] }))}
          />
        </Field>
      </FormRow>
    </Dialog>
  );
}
