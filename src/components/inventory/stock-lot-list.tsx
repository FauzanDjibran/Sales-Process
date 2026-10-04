"use client";

import { useMemo, useState } from "react";
import { Icon } from "@/components/icon";
import { Combobox } from "@/components/ui/combobox";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DateInput } from "@/components/ui/date-input";
import { Dialog } from "@/components/ui/dialog";
import { Field, FormBody, FormRow } from "@/components/ui/form";
import { Pager, usePaging } from "@/components/ui/pager";
import { SearchField } from "@/components/ui/search-field";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { createStockLotAction, setStockLotActiveAction } from "@/app/actions/stock-lot";
import type { StockLotInput, StockLotRow, stockLotFormOptions } from "@/lib/erp/inventory";
import { STATUS_CLASS, STATUS_TEXT } from "@/lib/erp/entities";
import { formatDate } from "@/lib/format";

type Options = Awaited<ReturnType<typeof stockLotFormOptions>>;

const EMPTY: StockLotInput = { item_id: null, warehouse_id: null, lot_no: "", expiry_date: "" };

/**
 * Lot (Sementara) — the lots a Delivery Note picks from while stock is not
 * kept (U15). One row per lot of a Barang with Kelola Stok in one warehouse,
 * with its expiry; the picker offers them earliest expiry first. It holds no
 * quantity: the stand-in always has stock. Temporary by design, like Harga
 * Pokok (Sementara): it goes when real stock brings its own lots.
 */
export function StockLotList({ rows, options, canEdit }: { rows: StockLotRow[]; options: Options; canEdit: boolean }) {
  const toast = useToast();
  const [query, setQuery] = useState("");
  const [state, setState] = useState("active");
  const [adding, setAdding] = useState(false);
  const [input, setInput] = useState<StockLotInput>(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [toggling, setToggling] = useState<StockLotRow | null>(null);

  const q = query.trim().toLowerCase();
  const shown = useMemo(
    () =>
      rows.filter(
        (r) =>
          (!state || (state === "active" ? r.active : !r.active)) &&
          (!q ||
            r.lotNo.toLowerCase().includes(q) ||
            r.itemLabel.toLowerCase().includes(q) ||
            r.itemName.toLowerCase().includes(q) ||
            r.warehouseLabel.toLowerCase().includes(q))
      ),
    [rows, q, state]
  );
  const paging = usePaging(shown, `${q}|${state}`);
  const item = options.items.find((i) => i.id === input.item_id);

  const set = <K extends keyof StockLotInput>(k: K, v: StockLotInput[K]) => {
    setInput((x) => ({ ...x, [k]: v }));
    setErrors((e) => ({ ...e, [k]: "" }));
  };

  const save = async () => {
    setBusy(true);
    const result = await createStockLotAction(input);
    setBusy(false);
    if (!result.ok) {
      setErrors(result.errors);
      if (result.errors._form) toast("Tidak diizinkan", result.errors._form, "err");
      return;
    }
    toast("Lot ditambahkan", `${input.lot_no.trim().toUpperCase()} · ${item?.label ?? ""}`, "ok");
    setAdding(false);
  };

  const toggle = async () => {
    if (!toggling) return;
    setBusy(true);
    const result = await setStockLotActiveAction(toggling.id, !toggling.active);
    setBusy(false);
    setToggling(null);
    if (!result.ok) toast("Tidak dapat diproses", result.errors._form, "err");
    else toast(toggling.active ? "Lot dinonaktifkan" : "Lot diaktifkan", toggling.lotNo, "ok");
  };

  return (
    <>
      <div className="ph">
        <div className="crumb">
          <span>Master</span>
          <span>/</span>
          <span className="cur">Lot (Sementara)</span>
        </div>
        <div className="ph-row">
          <h1>
            <span className="ph-ico">
              <Icon name="layers" size={16} />
            </span>
            Lot (Sementara)
          </h1>
          {canEdit && (
            <div className="ph-act">
              <button
                className="btn primary"
                onClick={() => {
                  setInput(EMPTY);
                  setErrors({});
                  setAdding(true);
                }}
              >
                <Icon name="plus" size={15} /> Tambah Lot
              </button>
            </div>
          )}
        </div>
        <p className="ph-sub">
          Selama stok belum dikelola, Delivery Note memilih lot barang ber-Kelola Stok dari daftar ini, kadaluarsa terdekat lebih
          dulu. Lot tidak menyimpan jumlah: stok dianggap selalu cukup. Menu ini dihapus saat persediaan dibangun.
        </p>
      </div>

      <div className="card">
        <div className="toolbar">
          <SearchField value={query} onChange={setQuery} placeholder="Cari no. lot, barang atau gudang…" />
          <Select
            variant="toolbar"
            value={state}
            set={state !== "active"}
            options={[
              { value: "active", label: "Status: Aktif" },
              { value: "inactive", label: "Nonaktif" },
              { value: "", label: "Status: semua" },
            ]}
            onChange={setState}
          />
          <span className="tspace" />
          <span className="count">
            <b>{shown.length}</b> lot
          </span>
        </div>
        {shown.length ? (
          <>
            <div className="tw">
              <table className="grid">
                <thead>
                  <tr>
                    <th style={{ width: 180 }}>No. Lot</th>
                    <th>Barang</th>
                    <th style={{ width: 220 }}>Gudang</th>
                    <th style={{ width: 130 }}>Kadaluarsa</th>
                    <th style={{ width: 100 }}>Status</th>
                    {canEdit && <th style={{ width: 130 }} />}
                  </tr>
                </thead>
                <tbody>
                  {paging.pageRows.map((r) => (
                    <tr key={r.id} style={{ cursor: "default" }}>
                      <td>
                        <span className="lab">{r.lotNo}</span>
                      </td>
                      <td>
                        <span className="idc">
                          <span className="lab">{r.itemLabel}</span>
                          <span className="nm">{r.itemName}</span>
                        </span>
                      </td>
                      <td>
                        <span className="idc">
                          <span className="lab">{r.warehouseLabel}</span>
                          <span className="nm">{r.warehouseName}</span>
                        </span>
                      </td>
                      <td>{r.expiry ? <span className="mono">{formatDate(r.expiry)}</span> : <span className="dash">—</span>}</td>
                      <td>
                        <span className={`bdg ${STATUS_CLASS[r.active ? "Active" : "Inactive"]}`}>{STATUS_TEXT[r.active ? "Active" : "Inactive"]}</span>
                      </td>
                      {canEdit && (
                        <td>
                          <button className="btn sm" onClick={() => setToggling(r)}>
                            <Icon name={r.active ? "block" : "check"} size={13} /> {r.active ? "Nonaktifkan" : "Aktifkan"}
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pager
              page={paging.page}
              pages={paging.pages}
              total={paging.total}
              perPage={paging.perPage}
              onPage={paging.setPage}
              onPerPage={paging.setPerPage}
            />
          </>
        ) : (
          <div className="empty">
            <div className="ic">
              <Icon name="layers" size={20} />
            </div>
            <h4>{q || state ? "Tidak ada yang cocok" : "Belum ada lot"}</h4>
            <p>
              {q || state
                ? "Tidak ada lot yang sesuai dengan pencarian atau filter."
                : "Lot dibuat untuk barang ber-Kelola Stok, per gudang, agar Delivery Note dapat memilihnya."}
            </p>
          </div>
        )}
      </div>

      {adding && (
        <Dialog
          open
          icon="layers"
          title="Tambah Lot"
          subtitle="Lot barang ber-Kelola Stok di satu gudang"
          width={560}
          onClose={() => setAdding(false)}
          foot={
            <>
              <button className="btn" onClick={() => setAdding(false)} disabled={busy}>
                Batal
              </button>
              <button className="btn primary" onClick={save} disabled={busy}>
                <Icon name="save" size={15} /> {busy ? "Menyimpan…" : "Simpan"}
              </button>
            </>
          }
        >
          <FormBody>
            <FormRow>
              <Field label="Barang" span={12} required help="hanya barang dengan Kelola Stok" error={errors.item_id}>
                <Combobox
                  value={input.item_id}
                  options={options.items.map((i) => ({ id: i.id, label: i.label, name: i.name, active: true }))}
                  placeholder="Pilih barang…"
                  invalid={Boolean(errors.item_id)}
                  onChange={(v) => set("item_id", v)}
                />
              </Field>
              <Field label="Gudang" span={12} required error={errors.warehouse_id}>
                <Combobox
                  value={input.warehouse_id}
                  options={options.warehouses.map((w) => ({ id: w.id, label: w.label, name: w.name, active: true }))}
                  placeholder="Pilih gudang…"
                  invalid={Boolean(errors.warehouse_id)}
                  onChange={(v) => set("warehouse_id", v)}
                />
              </Field>
              <Field label="No. Lot" span={6} required error={errors.lot_no}>
                <input
                  className={`inp mono${errors.lot_no ? " bad" : ""}`}
                  value={input.lot_no}
                  placeholder="LOT-2610-01"
                  onChange={(e) => set("lot_no", e.target.value)}
                />
              </Field>
              <Field
                label="Kadaluarsa"
                span={6}
                required={Boolean(item?.hasExpiry)}
                help={item && !item.hasExpiry ? "opsional" : undefined}
                error={errors.expiry_date}
              >
                <DateInput value={input.expiry_date} invalid={Boolean(errors.expiry_date)} onChange={(v) => set("expiry_date", v)} />
              </Field>
            </FormRow>
          </FormBody>
        </Dialog>
      )}

      {toggling && (
        <ConfirmDialog
          open
          icon={toggling.active ? "block" : "check"}
          tone={toggling.active ? "danger" : "ok"}
          title={toggling.active ? "Nonaktifkan lot?" : "Aktifkan lot?"}
          subject={`${toggling.lotNo} · ${toggling.itemLabel} · ${toggling.warehouseLabel}`}
          body={
            toggling.active
              ? "Lot ini tidak lagi ditawarkan saat memilih lot. Delivery Note Draft yang sudah memilihnya tidak bisa diposting sampai lotnya diganti."
              : "Lot ini kembali ditawarkan saat memilih lot di Delivery Note."
          }
          confirmLabel={toggling.active ? "Ya, Nonaktifkan" : "Ya, Aktifkan"}
          confirmTone={toggling.active ? "solid-danger" : "primary"}
          busy={busy}
          onConfirm={toggle}
          onCancel={() => setToggling(null)}
        />
      )}
    </>
  );
}
