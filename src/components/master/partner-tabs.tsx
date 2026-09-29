"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/components/icon";
import {
  CollectionCard,
  RowActions,
  newKey,
  type CollectionTabProps,
} from "@/components/master/collection-tab";
import { Combobox } from "@/components/ui/combobox";
import { Dialog } from "@/components/ui/dialog";
import { Field, FormRow } from "@/components/ui/form";
import { loadRegions } from "@/app/actions/region";
import type { RegionLevel, RegionOption } from "@/lib/erp/partner";
import type { RefOption } from "@/lib/erp/records";
import {
  addressErrors,
  contactErrors,
  formatAddress,
  type AddressDraft,
  type ContactDraft,
} from "@/lib/erp/partner-shape";

/**
 * The Partner form's two collection tabs — Alamat and Contact Person.
 *
 * Each is a table of what the Partner holds and, while the form is being
 * edited, a panel dialog that adds or changes one row. The dialog changes the
 * form, not the database: the rows are saved with the Partner when its Simpan
 * is pressed, in the same transaction (Claude-ERP.md P39), which is what the
 * dialog's footer says.
 */

// ================================================================= Alamat

export function AddressesTab({ editing, items, error, onChange }: CollectionTabProps<AddressDraft>) {
  // The row being edited, or a fresh draft for "Tambah"; null when closed.
  const [open, setOpen] = useState<AddressDraft | null>(null);

  const blank = (): AddressDraft => ({
    key: newKey("a"),
    provinceId: null,
    cityId: null,
    districtId: null,
    villageId: null,
    provinceName: "",
    cityName: "",
    districtName: "",
    villageName: "",
    postalCode: "",
    street: "",
    note: "",
    // The first address is almost always both; later ones usually neither.
    isBilling: items.length === 0,
    isShipping: items.length === 0,
  });

  const apply = (a: AddressDraft) => {
    const exists = items.some((x) => x.key === a.key);
    onChange(exists ? items.map((x) => (x.key === a.key ? a : x)) : [...items, a]);
    setOpen(null);
  };

  return (
    <CollectionCard
      icon="pin"
      title="Alamat"
      desc="Alamat penagihan menjadi tujuan faktur; alamat pengiriman menjadi tujuan barang. Minimal satu alamat."
      editing={editing}
      addLabel="Tambah Alamat"
      onAdd={() => setOpen(blank())}
      error={error}
    >
      {items.length === 0 ? (
        <div className="empty sm">
          <div className="ic">
            <Icon name="pin" size={18} />
          </div>
          <h4>Belum ada alamat</h4>
          <p>Partner wajib memiliki minimal satu alamat sebelum dapat disimpan.</p>
          {editing && (
            <button className="btn primary sm cta" onClick={() => setOpen(blank())}>
              <Icon name="plus" size={14} /> Tambah Alamat
            </button>
          )}
        </div>
      ) : (
        <div className="tw">
          <table className="grid coll">
            <thead>
              <tr>
                <th style={{ width: 44 }}>No</th>
                <th>Alamat</th>
                <th style={{ width: 118 }}>Penagihan</th>
                <th style={{ width: 118 }}>Pengiriman</th>
                {editing && <th style={{ width: 72 }} />}
              </tr>
            </thead>
            <tbody>
              {items.map((a, i) => (
                <tr
                  key={a.key}
                  className={editing ? "ed" : undefined}
                  onClick={editing ? () => setOpen(a) : undefined}
                >
                  <td className="no">{i + 1}</td>
                  <td className="addr">
                    {formatAddress(a)}
                    {a.note && <span className="an">{a.note}</span>}
                  </td>
                  <td>
                    {a.isBilling ? (
                      <span className="bdg s-ok">Penagihan</span>
                    ) : (
                      <span className="dash">—</span>
                    )}
                  </td>
                  <td>
                    {a.isShipping ? (
                      <span className="bdg s-ok">Pengiriman</span>
                    ) : (
                      <span className="dash">—</span>
                    )}
                  </td>
                  {editing && (
                    <td>
                      <RowActions
                        onEdit={() => setOpen(a)}
                        onRemove={() => onChange(items.filter((x) => x.key !== a.key))}
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
        <AddressDialog
          initial={open}
          isNew={!items.some((x) => x.key === open.key)}
          onCancel={() => setOpen(null)}
          onApply={apply}
        />
      )}
    </CollectionCard>
  );
}

const toOptions = (rows: RegionOption[], withPostal = false): RefOption[] =>
  rows.map((r) => ({
    id: r.id,
    // A kelurahan's kode pos is the one code worth showing beside its name.
    label: withPostal ? r.postalCode ?? "" : "",
    name: r.name,
    active: true,
  }));

function AddressDialog({
  initial,
  isNew,
  onCancel,
  onApply,
}: {
  initial: AddressDraft;
  isNew: boolean;
  onCancel: () => void;
  onApply: (a: AddressDraft) => void;
}) {
  const [a, setA] = useState<AddressDraft>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [lists, setLists] = useState<Record<RegionLevel, RegionOption[]>>({
    province: [],
    city: [],
    district: [],
    village: [],
  });

  const fetchLevel = async (level: RegionLevel, parentId: number | null) => {
    const rows = await loadRegions(level, parentId);
    setLists((l) => ({ ...l, [level]: rows }));
  };

  // Every list the saved choice needs, once, when the dialog opens.
  const { provinceId, cityId, districtId } = initial;
  useEffect(() => {
    let alive = true;
    const none = Promise.resolve<RegionOption[]>([]);
    Promise.all([
      loadRegions("province", null),
      provinceId ? loadRegions("city", provinceId) : none,
      cityId ? loadRegions("district", cityId) : none,
      districtId ? loadRegions("village", districtId) : none,
    ]).then(([province, city, district, village]) => {
      if (alive) setLists({ province, city, district, village });
    });
    return () => {
      alive = false;
    };
  }, [provinceId, cityId, districtId]);

  const clearError = (...names: string[]) =>
    setErrors((e) => {
      const next = { ...e };
      for (const n of names) delete next[n];
      return next;
    });

  const nameOf = (level: RegionLevel, id: number | null) =>
    lists[level].find((r) => r.id === id)?.name ?? "";

  // Choosing a region empties everything beneath it: a kecamatan from another
  // kota would otherwise survive the change and produce an address that does
  // not exist.
  const pickProvince = (id: number | null) => {
    setA((x) => ({
      ...x,
      provinceId: id,
      provinceName: nameOf("province", id),
      cityId: null,
      cityName: "",
      districtId: null,
      districtName: "",
      villageId: null,
      villageName: "",
      postalCode: "",
    }));
    setLists((l) => ({ ...l, city: [], district: [], village: [] }));
    if (id) void fetchLevel("city", id);
    clearError("province");
  };
  const pickCity = (id: number | null) => {
    setA((x) => ({
      ...x,
      cityId: id,
      cityName: nameOf("city", id),
      districtId: null,
      districtName: "",
      villageId: null,
      villageName: "",
      postalCode: "",
    }));
    setLists((l) => ({ ...l, district: [], village: [] }));
    if (id) void fetchLevel("district", id);
    clearError("city");
  };
  const pickDistrict = (id: number | null) => {
    setA((x) => ({
      ...x,
      districtId: id,
      districtName: nameOf("district", id),
      villageId: null,
      villageName: "",
      postalCode: "",
    }));
    setLists((l) => ({ ...l, village: [] }));
    if (id) void fetchLevel("village", id);
    clearError("district");
  };
  const pickVillage = (id: number | null) => {
    const v = lists.village.find((r) => r.id === id);
    setA((x) => ({
      ...x,
      villageId: id,
      villageName: v?.name ?? "",
      postalCode: v?.postalCode ?? "",
    }));
    clearError("village");
  };

  const submit = () => {
    const found = addressErrors(a);
    if (Object.keys(found).length) {
      setErrors(found);
      return;
    }
    onApply({ ...a, street: a.street.trim(), note: a.note.trim() });
  };

  return (
    <Dialog
      open
      icon="pin"
      title={isNew ? "Tambah Alamat" : "Ubah Alamat"}
      subtitle="Pilih wilayah dari atas ke bawah; kode pos mengikuti kelurahan."
      width={760}
      onClose={onCancel}
      foot={
        <>
          <span className="fnote">Tersimpan ke database saat Partner disimpan.</span>
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
        <Field label="Jenis Alamat" span={12} help="boleh keduanya">
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <label className="chk sm">
              <input
                type="checkbox"
                checked={a.isBilling}
                onChange={(e) => setA((x) => ({ ...x, isBilling: e.target.checked }))}
              />
              <span>
                <span className="ct">Alamat Penagihan (tujuan faktur)</span>
              </span>
            </label>
            <label className="chk sm">
              <input
                type="checkbox"
                checked={a.isShipping}
                onChange={(e) => setA((x) => ({ ...x, isShipping: e.target.checked }))}
              />
              <span>
                <span className="ct">Alamat Pengiriman (tujuan barang)</span>
              </span>
            </label>
          </div>
        </Field>

        <Field label="Negara" span={6}>
          <div className="ro">Indonesia</div>
        </Field>
        <Field label="Provinsi" span={6} required error={errors.province}>
          <Combobox
            value={a.provinceId}
            options={toOptions(lists.province)}
            placeholder="Pilih Provinsi…"
            invalid={Boolean(errors.province)}
            onChange={pickProvince}
          />
        </Field>
        <Field label="Kota / Kabupaten" span={6} required error={errors.city}>
          <Combobox
            value={a.cityId}
            options={toOptions(lists.city)}
            placeholder="Pilih Kota / Kabupaten…"
            invalid={Boolean(errors.city)}
            waitingFor={a.provinceId ? null : "Pilih Provinsi dulu…"}
            onChange={pickCity}
          />
        </Field>
        <Field label="Kecamatan" span={6} required error={errors.district}>
          <Combobox
            value={a.districtId}
            options={toOptions(lists.district)}
            placeholder="Pilih Kecamatan…"
            invalid={Boolean(errors.district)}
            waitingFor={a.cityId ? null : "Pilih Kota / Kabupaten dulu…"}
            onChange={pickDistrict}
          />
        </Field>
        <Field label="Kelurahan / Desa" span={6} required error={errors.village}>
          <Combobox
            value={a.villageId}
            options={toOptions(lists.village, true)}
            placeholder="Pilih Kelurahan / Desa…"
            invalid={Boolean(errors.village)}
            waitingFor={a.districtId ? null : "Pilih Kecamatan dulu…"}
            onChange={pickVillage}
          />
        </Field>
        <Field label="Kode Pos" span={6} help="mengikuti kelurahan">
          {a.postalCode ? (
            <div className="ro">
              <span className="lab">{a.postalCode}</span>
            </div>
          ) : (
            <div className="ro nil">{a.villageId ? "tidak ada di data" : "menunggu kelurahan"}</div>
          )}
        </Field>
        <Field label="Alamat" span={12} required help="jalan, nomor, blok, RT/RW, gedung" error={errors.street}>
          <textarea
            className={`ta${errors.street ? " bad" : ""}`}
            rows={2}
            value={a.street}
            placeholder="Jl. Gatot Subroto Kav. 21"
            onChange={(e) => {
              setA((x) => ({ ...x, street: e.target.value }));
              clearError("street");
            }}
          />
        </Field>
        <Field label="Catatan" span={12} error={errors.note}>
          <textarea
            className={`ta${errors.note ? " bad" : ""}`}
            rows={2}
            value={a.note}
            placeholder="Keterangan tambahan (opsional)…"
            onChange={(e) => {
              setA((x) => ({ ...x, note: e.target.value }));
              clearError("note");
            }}
          />
        </Field>
      </FormRow>
    </Dialog>
  );
}

// ========================================================= Contact Person

export function ContactsTab({ editing, items, error, onChange }: CollectionTabProps<ContactDraft>) {
  const [open, setOpen] = useState<ContactDraft | null>(null);

  const blank = (): ContactDraft => ({
    key: newKey("c"),
    name: "",
    position: "",
    phone: "",
    email: "",
  });

  const apply = (c: ContactDraft) => {
    const exists = items.some((x) => x.key === c.key);
    onChange(exists ? items.map((x) => (x.key === c.key ? c : x)) : [...items, c]);
    setOpen(null);
  };

  return (
    <CollectionCard
      icon="users"
      title="Contact Person"
      desc="Orang yang dihubungi pada Partner ini."
      editing={editing}
      addLabel="Tambah Contact"
      onAdd={() => setOpen(blank())}
      error={error}
    >
      {items.length === 0 ? (
        <div className="empty sm">
          <div className="ic">
            <Icon name="users" size={18} />
          </div>
          <h4>Belum ada contact person</h4>
          <p>Contact person tidak wajib, tetapi memudahkan tim penjualan menghubungi Partner.</p>
          {editing && (
            <button className="btn primary sm cta" onClick={() => setOpen(blank())}>
              <Icon name="plus" size={14} /> Tambah Contact
            </button>
          )}
        </div>
      ) : (
        <div className="tw">
          <table className="grid coll">
            <thead>
              <tr>
                <th style={{ width: 44 }}>No</th>
                <th>Nama</th>
                <th>Posisi</th>
                <th>Nomor Telepon</th>
                <th>Email</th>
                {editing && <th style={{ width: 72 }} />}
              </tr>
            </thead>
            <tbody>
              {items.map((c, i) => (
                <tr
                  key={c.key}
                  className={editing ? "ed" : undefined}
                  onClick={editing ? () => setOpen(c) : undefined}
                >
                  <td className="no">{i + 1}</td>
                  <td className="pri">{c.name}</td>
                  <td>{c.position}</td>
                  <td className="mono">{c.phone}</td>
                  <td>{c.email}</td>
                  {editing && (
                    <td>
                      <RowActions
                        onEdit={() => setOpen(c)}
                        onRemove={() => onChange(items.filter((x) => x.key !== c.key))}
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
        <ContactDialog
          initial={open}
          isNew={!items.some((x) => x.key === open.key)}
          onCancel={() => setOpen(null)}
          onApply={apply}
        />
      )}
    </CollectionCard>
  );
}

function ContactDialog({
  initial,
  isNew,
  onCancel,
  onApply,
}: {
  initial: ContactDraft;
  isNew: boolean;
  onCancel: () => void;
  onApply: (c: ContactDraft) => void;
}) {
  const [c, setC] = useState<ContactDraft>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const set = (name: keyof ContactDraft) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setC((x) => ({ ...x, [name]: value }));
    setErrors((er) => {
      const next = { ...er };
      delete next[name];
      return next;
    });
  };

  const submit = () => {
    const found = contactErrors(c);
    if (Object.keys(found).length) {
      setErrors(found);
      return;
    }
    onApply({
      ...c,
      name: c.name.trim(),
      position: c.position.trim(),
      phone: c.phone.trim(),
      email: c.email.trim(),
    });
  };

  const input = (name: "name" | "position" | "phone" | "email", placeholder: string, mono = false) => (
    <input
      className={`inp${mono ? " idf" : ""}${errors[name] ? " bad" : ""}`}
      type="text"
      inputMode={name === "phone" ? "tel" : name === "email" ? "email" : undefined}
      value={c[name]}
      placeholder={placeholder}
      autoComplete="off"
      onChange={set(name)}
    />
  );

  return (
    <Dialog
      open
      icon="users"
      title={isNew ? "Tambah Contact Person" : "Ubah Contact Person"}
      width={680}
      onClose={onCancel}
      foot={
        <>
          <span className="fnote">Tersimpan ke database saat Partner disimpan.</span>
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
        <Field label="Nama" span={6} required error={errors.name}>
          {input("name", "Nama")}
        </Field>
        <Field label="Nomor Telepon" span={6} required error={errors.phone}>
          {input("phone", "0812 8800 1122", true)}
        </Field>
        <Field label="Posisi" span={6} required error={errors.position}>
          {input("position", "Posisi")}
        </Field>
        <Field label="Email" span={6} required error={errors.email}>
          {input("email", "nama@perusahaan.co.id")}
        </Field>
      </FormRow>
    </Dialog>
  );
}
