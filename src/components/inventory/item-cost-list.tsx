"use client";

import { useMemo, useState } from "react";
import { Icon } from "@/components/icon";
import { Dialog } from "@/components/ui/dialog";
import { Field, FormBody, FormRow } from "@/components/ui/form";
import { MoneyInput } from "@/components/ui/money-input";
import { Pager, usePaging } from "@/components/ui/pager";
import { SearchField } from "@/components/ui/search-field";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { setItemCostAction } from "@/app/actions/item-cost";
import type { ItemCostRow } from "@/lib/erp/inventory";
import { formatDate, formatMoney, formatPrice } from "@/lib/format";

/**
 * Harga Pokok (Sementara) — one cost per Barang, per base unit, which the
 * stand-in inventory issues every Delivery Note at (U11). Temporary by design:
 * it goes when real stock and its valuation arrive, so it lives in its own
 * group and says so. A change applies to the next issue only; posted notes keep
 * the cost they were posted at.
 */
export function ItemCostList({ rows, canEdit }: { rows: ItemCostRow[]; canEdit: boolean }) {
  const toast = useToast();
  const [query, setQuery] = useState("");
  const [state, setState] = useState("");
  const [editing, setEditing] = useState<ItemCostRow | null>(null);
  const [value, setValue] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const q = query.trim().toLowerCase();
  const shown = useMemo(
    () =>
      rows.filter(
        (r) =>
          (!state || (state === "set" ? r.unitCost !== null : r.unitCost === null)) &&
          (!q || r.itemLabel.toLowerCase().includes(q) || r.itemName.toLowerCase().includes(q))
      ),
    [rows, q, state]
  );
  const paging = usePaging(shown, `${q}|${state}`);
  const missing = rows.filter((r) => r.unitCost === null && r.active).length;

  const open = (r: ItemCostRow) => {
    setEditing(r);
    setValue(r.unitCost === null ? "" : String(r.unitCost));
    setError("");
  };
  const save = async () => {
    if (!editing) return;
    setBusy(true);
    const result = await setItemCostAction(editing.itemId, value);
    setBusy(false);
    if (!result.ok) {
      setError(result.errors.unit_cost ?? result.errors._form ?? "Gagal disimpan.");
      return;
    }
    toast("Harga Pokok disimpan", `${editing.itemLabel} · ${formatMoney(Number(value), "IDR")}`, "ok");
    setEditing(null);
  };

  return (
    <>
      <div className="ph">
        <div className="crumb">
          <span>Master</span>
          <span>/</span>
          <span className="cur">Harga Pokok (Sementara)</span>
        </div>
        <div className="ph-row">
          <h1>
            <span className="ph-ico">
              <Icon name="coin" size={16} />
            </span>
            Harga Pokok (Sementara)
          </h1>
        </div>
        <p className="ph-sub">
          Selama stok belum dikelola, setiap Delivery Note mengakui HPP dengan harga pokok di sini, per satuan dasar barang.
          Perubahan hanya berlaku untuk pengiriman berikutnya. Menu ini dihapus saat persediaan dibangun.
        </p>
      </div>

      {missing > 0 && (
        <div className="nbox warn slim" style={{ marginBottom: 14 }}>
          <Icon name="warn" size={15} className="ni" />
          <div>
            <b>{missing} barang aktif belum punya Harga Pokok.</b> Delivery Note dengan barang tersebut belum bisa diposting.
          </div>
        </div>
      )}

      <div className="card">
        <div className="toolbar">
          <SearchField value={query} onChange={setQuery} placeholder="Cari kode atau nama barang…" />
          <Select
            variant="toolbar"
            value={state}
            set={Boolean(state)}
            options={[
              { value: "", label: "Harga Pokok: semua" },
              { value: "set", label: "Sudah diisi" },
              { value: "missing", label: "Belum diisi" },
            ]}
            onChange={setState}
          />
          <span className="tspace" />
          <span className="count">
            <b>{shown.length}</b> barang
          </span>
        </div>
        {shown.length ? (
          <>
            <div className="tw">
              <table className="grid">
                <thead>
                  <tr>
                    <th>Barang</th>
                    <th style={{ width: 200 }}>Kategori</th>
                    <th style={{ width: 120 }}>Satuan Dasar</th>
                    <th className="num" style={{ width: 160 }}>
                      Harga Pokok
                    </th>
                    <th style={{ width: 120 }}>Diubah</th>
                    {canEdit && <th style={{ width: 90 }} />}
                  </tr>
                </thead>
                <tbody>
                  {paging.pageRows.map((r) => (
                    <tr key={r.itemId} style={{ cursor: "default" }}>
                      <td>
                        <span className="idc">
                          <span className="lab">{r.itemLabel}</span>
                          <span className="nm">{r.itemName}</span>
                        </span>
                        {!r.active && <span className="bdg s-mute" style={{ marginLeft: 8 }}>Nonaktif</span>}
                      </td>
                      <td>{r.categoryName}</td>
                      <td>
                        <span className="lab">{r.baseUomLabel}</span>
                      </td>
                      <td className="num">
                        {r.unitCost === null ? (
                          <span className="bdg s-warn">Belum diisi</span>
                        ) : (
                          <span className="mny">{formatPrice(r.unitCost)}</span>
                        )}
                      </td>
                      <td>{r.updatedAt ? formatDate(r.updatedAt.slice(0, 10)) : <span className="dash">—</span>}</td>
                      {canEdit && (
                        <td>
                          <button className="btn sm" onClick={() => open(r)}>
                            <Icon name="pen" size={13} /> Ubah
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
              <Icon name="coin" size={20} />
            </div>
            <h4>{q || state ? "Tidak ada yang cocok" : "Belum ada barang"}</h4>
            <p>{q || state ? "Tidak ada barang yang sesuai dengan pencarian atau filter." : "Harga Pokok diisi untuk barang bertipe Barang di Master › Item."}</p>
          </div>
        )}
      </div>

      {editing && (
        <Dialog
          open
          icon="coin"
          title="Ubah Harga Pokok"
          subtitle={`${editing.itemLabel} · ${editing.itemName}`}
          width={460}
          onClose={() => setEditing(null)}
          foot={
            <>
              <button className="btn" onClick={() => setEditing(null)} disabled={busy}>
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
              <Field label={`Harga Pokok per ${editing.baseUomLabel}`} span={12} required help="berlaku untuk pengiriman berikutnya" error={error}>
                <MoneyInput
                  value={value}
                  decimals={6}
                  invalid={Boolean(error)}
                  onChange={(v) => {
                    setValue(v);
                    setError("");
                  }}
                />
              </Field>
            </FormRow>
          </FormBody>
        </Dialog>
      )}
    </>
  );
}
