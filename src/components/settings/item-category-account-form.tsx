"use client";

import { useState } from "react";
import { Icon } from "@/components/icon";
import { CancelButton } from "@/components/ui/cancel-button";
import { Combobox } from "@/components/ui/combobox";
import { useToast } from "@/components/ui/toast";
import { saveItemCategoryAccountsAction } from "@/app/actions/settings";
import type { ItemCategoryAccountRow } from "@/lib/erp/item-account";
import type { RefOption } from "@/lib/erp/records";

type Kind = "inventory" | "cogs" | "expense";

const KINDS: { kind: Kind; label: string; goodsOnly: boolean }[] = [
  { kind: "inventory", label: "Persediaan", goodsOnly: true },
  { kind: "cogs", label: "HPP", goodsOnly: true },
  { kind: "expense", label: "Beban", goodsOnly: false },
];

/**
 * Accounts per Kategori Item (P122): one table per Item Type, a picker per
 * account a category may carry. Persediaan and HPP left empty fall back to
 * Account Mapping, shown as the picker's placeholder; Beban has no fallback.
 */
export function ItemCategoryAccountForm({
  rows: initial,
  accounts,
  fallback,
  canEdit,
}: {
  rows: ItemCategoryAccountRow[];
  accounts: RefOption[];
  fallback: { inventory: number | null; cogs: number | null };
  canEdit: boolean;
}) {
  const toast = useToast();
  const [rows, setRows] = useState(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const byId = new Map(accounts.map((a) => [a.id, a]));

  const set = (categoryId: number, kind: Kind, v: number | null) => {
    setRows((rs) => rs.map((r) => (r.categoryId === categoryId ? { ...r, [kind]: v } : r)));
    setDirty(true);
    setErrors((e) => {
      const next = { ...e };
      delete next[`${categoryId}.${kind}`];
      delete next._form;
      return next;
    });
  };

  const onSave = async () => {
    setSaving(true);
    const result = await saveItemCategoryAccountsAction(
      rows.map((r) => ({ categoryId: r.categoryId, inventory: r.inventory, cogs: r.cogs, expense: r.expense }))
    );
    setSaving(false);
    if (!result.ok) {
      setErrors(result.errors);
      toast("Gagal menyimpan", result.errors._form ?? "Periksa kembali account yang ditandai.", "err");
      return;
    }
    setDirty(false);
    toast("Account Kategori Item disimpan", result.changed ? `${result.changed} kategori diperbarui` : "Tidak ada perubahan", "ok");
  };

  const fallbackText = (kind: Kind) => {
    const id = kind === "inventory" ? fallback.inventory : kind === "cogs" ? fallback.cogs : null;
    if (kind === "expense") return "Belum diatur";
    const a = id ? byId.get(id) : null;
    return a ? `Ikut Account Mapping: ${a.label}` : "Ikut Account Mapping (belum diatur)";
  };

  const table = (type: "Barang" | "Jasa") => {
    const list = rows.filter((r) => r.itemType === type);
    const kinds = KINDS.filter((k) => type === "Barang" || !k.goodsOnly);
    return (
      <div className="card" style={{ marginBottom: 14 }} key={type}>
        <div className="card-h">
          <span className="ci">
            <Icon name={type === "Barang" ? "box" : "tags"} size={15} />
          </span>
          <div className="ct">
            <h3>Kategori {type}</h3>
            <p>
              {type === "Barang"
                ? "Persediaan dan HPP untuk barang dengan Kelola Stok; Beban untuk barang tanpa Kelola Stok, yang dibebankan saat diterima."
                : "Jasa dibebankan saat diterima, ke Account Beban kategorinya."}
            </p>
          </div>
        </div>
        <div className="tw">
          <table className="grid ltab" style={{ minWidth: type === "Barang" ? 980 : 620 }}>
            <thead>
              <tr>
                <th>Kategori</th>
                {kinds.map((k) => (
                  <th key={k.kind} style={{ width: 280 }}>
                    {k.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {list.map((r) => (
                <tr key={r.categoryId} style={{ cursor: "default" }}>
                  <td>
                    <span className="idc">
                      <span className="lab">{r.label}</span>
                      <span className="nm">{r.name}</span>
                    </span>
                  </td>
                  {kinds.map((k) => {
                    const value = r[k.kind];
                    const err = errors[`${r.categoryId}.${k.kind}`];
                    const chosen = value ? byId.get(value) : null;
                    return (
                      <td key={k.kind}>
                        {canEdit ? (
                          <Combobox
                            value={value}
                            options={accounts}
                            placeholder={fallbackText(k.kind)}
                            invalid={Boolean(err)}
                            onChange={(v) => set(r.categoryId, k.kind, v)}
                          />
                        ) : chosen ? (
                          <span className="idc">
                            <span className="lab">{chosen.label}</span>
                            <span className="nm">{chosen.name}</span>
                          </span>
                        ) : (
                          <span className="dash">{fallbackText(k.kind)}</span>
                        )}
                        {err && <span className="overtag">{err}</span>}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  return (
    <>
      <div className="ph">
        <div className="crumb">
          <span>Accounting</span>
          <span>/</span>
          <span className="cur">Account Kategori Item</span>
        </div>
        <div className="ph-row">
          <h1>
            <span className="ph-ico">
              <Icon name="link" size={16} />
            </span>
            Account Kategori Item
          </h1>
          <div className="ph-act">
            {canEdit && dirty && (
              <>
                <span className="ph-dirty">
                  <span className="pulse" /> Belum disimpan
                </span>
                <CancelButton
                  onCancel={() => {
                    setRows(initial);
                    setErrors({});
                    setDirty(false);
                  }}
                  dirty={dirty}
                  disabled={saving}
                />
                <button className="btn primary" onClick={onSave} disabled={saving}>
                  <Icon name="save" size={15} /> {saving ? "Menyimpan…" : "Simpan"}
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {errors._form && (
        <div className="nbox bad slim" style={{ marginBottom: 14 }}>
          <Icon name="warn" size={15} className="ni" />
          <div>
            <b>{errors._form}</b>
          </div>
        </div>
      )}

      {table("Barang")}
      {table("Jasa")}

      <p className="foot-note">
        Persediaan dan HPP yang kosong memakai account di Account Mapping (kartu Pengiriman Barang). Beban tidak punya
        cadangan: penerimaan barang tanpa Kelola Stok atau jasa ditolak selama kategorinya belum menyebut Account Beban.
      </p>
    </>
  );
}
