"use client";

import { useState } from "react";
import { Icon } from "@/components/icon";
import { CancelButton } from "@/components/ui/cancel-button";
import { Field, FormBody, FormRow, FormSection } from "@/components/ui/form";
import { Combobox } from "@/components/ui/combobox";
import { MoneyInput } from "@/components/ui/money-input";
import { PercentInput } from "@/components/ui/percent-input";
import { useToast } from "@/components/ui/toast";
import { saveSystemDefaults } from "@/app/actions/settings";
import { formatNumber } from "@/lib/format";
import type { RefOption } from "@/lib/erp/records";
import {
  settingGroupsOn,
  systemDefaultsIn,
  type SettingsPage,
  type SystemDefaultKey,
  type SystemDefaultValues,
} from "@/lib/erp/system-defaults";

const PAGE_TEXT: Record<SettingsPage, { module: string; title: string; icon: "gear" | "link"; note: string }> = {
  default: {
    module: "Pengaturan",
    title: "System Default",
    icon: "gear",
    note:
      "Base Currency ditetapkan sekali dan tidak dapat diubah: seluruh buku diukur dalam mata uang ini. " +
      "Kartu Pajak berlaku untuk dokumen yang disimpan setelah perubahan; dokumen lama tetap memakai " +
      "tarif yang disalinnya.",
  },
  account: {
    module: "Accounting",
    title: "Account Mapping",
    icon: "link",
    note:
      "Account Mapping menentukan ke mana posting ditulis. Proses yang membutuhkan sebuah account " +
      "ditolak dengan menyebut namanya selama account-nya belum diisi. Account PPh ada di setiap Jenis " +
      "PPh, dan account barang pada pemetaan Kategori Item.",
  },
};

/**
 * The two settings pages (P61), built from one catalogue: **System Default**
 * for application-wide configuration, **Account Mapping** for where each kind
 * of posting lands. A setting appears on its page as soon as it is declared.
 */
export function SystemDefaultForm({
  page,
  values: initial,
  options,
  canEdit,
  baseCurrency,
}: {
  page: SettingsPage;
  values: SystemDefaultValues;
  /** Options per setting key, already narrowed on the server. */
  options: Record<SystemDefaultKey, RefOption[]>;
  canEdit: boolean;
  /** System Default only: the currency the books are measured in, shown. */
  baseCurrency?: { label: string; name: string } | null;
}) {
  const text = PAGE_TEXT[page];
  const toast = useToast();
  const [values, setValues] = useState<SystemDefaultValues>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  const set = (key: SystemDefaultKey, value: string | null) => {
    setValues((v) => ({ ...v, [key]: value }));
    setDirty(true);
    setErrors((e) => {
      if (!e[key] && !e._form) return e;
      const next = { ...e };
      delete next[key];
      delete next._form;
      return next;
    });
  };

  const onSave = async () => {
    setSaving(true);
    const result = await saveSystemDefaults(page, values);
    setSaving(false);

    if (!result.ok) {
      setErrors(result.errors);
      toast(
        "Gagal menyimpan",
        result.errors._form ?? "Periksa kembali isian yang ditandai.",
        "err"
      );
      return;
    }
    setDirty(false);
    toast(
      "Pengaturan disimpan",
      result.changed
        ? `${result.changed} pengaturan diperbarui`
        : "Tidak ada perubahan",
      "ok"
    );
  };

  const reset = () => {
    setValues(initial);
    setErrors({});
    setDirty(false);
  };

  return (
    <>
      <div className="ph">
        <div className="crumb">
          <span>{text.module}</span>
          <span>/</span>
          <span className="cur">{text.title}</span>
        </div>
        <div className="ph-row">
          <h1>
            <span className="ph-ico">
              <Icon name={text.icon} size={16} />
            </span>
            {text.title}
          </h1>
          <div className="ph-act">
            {canEdit && dirty && (
              <>
                <span className="ph-dirty">
                  <span className="pulse" /> Belum disimpan
                </span>
                <CancelButton onCancel={reset} dirty={dirty} disabled={saving} />
                <button className="btn primary" onClick={onSave} disabled={saving}>
                  <Icon name="save" size={15} /> {saving ? "Menyimpan…" : "Simpan"}
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {errors._form && (
        <div className="card" style={{ marginBottom: 14 }}>
          <div className="card-b">
            <div className="err">
              <Icon name="warn" size={12} />
              {errors._form}
            </div>
          </div>
        </div>
      )}

      {settingGroupsOn(page).map((group) => (
        <div className="card" key={group.key} style={{ marginBottom: 14 }}>
          <div className="card-h">
            <span className="ci">
              <Icon name={group.icon} size={15} />
            </span>
            <div className="ct">
              <h3>{group.name}</h3>
              <p>{group.desc}</p>
            </div>
          </div>

          <FormBody>
            <FormSection>
              <FormRow>
                {group.key === "application" && (
                  <Field label="Base Currency" span={4} locked help="mata uang seluruh buku">
                    {baseCurrency ? (
                      <div className="ro">
                        <span className="lab">{baseCurrency.label}</span>
                        <span>{baseCurrency.name}</span>
                      </div>
                    ) : (
                      <div className="ro nil">belum terdaftar di master Currency</div>
                    )}
                  </Field>
                )}
                {systemDefaultsIn(group.key).map((def) => {
                  const value = values[def.key];
                  const list = options[def.key] ?? [];
                  return (
                    <Field
                      key={def.key}
                      label={def.name}
                      span={4}
                      help={def.help}
                      error={errors[def.key]}
                    >
                      {def.type === "number" ? (
                        canEdit ? (
                          "percent" in def && def.percent ? (
                            <PercentInput
                              decimals={def.decimals}
                              value={value ?? ""}
                              invalid={Boolean(errors[def.key])}
                              ariaLabel={def.name}
                              onChange={(v) => set(def.key, v)}
                            />
                          ) : (
                          <MoneyInput
                            decimals={def.decimals}
                            value={value ?? ""}
                            invalid={Boolean(errors[def.key])}
                            ariaLabel={def.name}
                            onChange={(v) => set(def.key, v)}
                          />
                          )
                        ) : (
                          <div className="ro">
                            <span className="mny">{value == null ? "—" : `${formatNumber(Number(value), Number(value) % 1 ? def.decimals : 0)}${"percent" in def && def.percent ? "%" : ""}`}</span>
                          </div>
                        )
                      ) : canEdit ? (
                        <Combobox
                          value={value ? Number(value) : null}
                          options={list}
                          placeholder={`Pilih ${def.name}…`}
                          invalid={Boolean(errors[def.key])}
                          onChange={(v) =>
                            set(def.key, v == null ? null : String(v))
                          }
                        />
                      ) : (
                        <ReadOnly
                          option={list.find((o) => o.id === Number(value)) ?? null}
                        />
                      )}
                    </Field>
                  );
                })}
              </FormRow>
            </FormSection>
          </FormBody>
        </div>
      ))}

      <p className="foot-note">{text.note}</p>
    </>
  );
}

function ReadOnly({ option }: { option: RefOption | null }) {
  if (!option) return <div className="ro nil">belum diatur</div>;
  return (
    <div className="ro">
      <span className="lab">{option.label}</span>
      <span>{option.name}</span>
    </div>
  );
}
