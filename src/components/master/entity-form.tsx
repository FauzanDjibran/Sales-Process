"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icon";
import { CancelButton } from "@/components/ui/cancel-button";
import {
  headerButtonClass,
  masterHeaderActions,
  type ActionTone,
} from "@/lib/erp/header-actions";
import { Combobox } from "@/components/ui/combobox";
import { DateInput } from "@/components/ui/date-input";
import { Select } from "@/components/ui/select";
import { MoneyInput } from "@/components/ui/money-input";
import { RateInput } from "@/components/ui/rate-input";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import {
  Field as FormField,
  FormRow,
  FormSection,
  type FieldSpan,
} from "@/components/ui/form";
import { createRecord, updateRecord, toggleStatus, type FormValues } from "@/app/actions/master";
import type { EntityAbilities } from "@/lib/erp/entity-access";
import {
  STATUS_CLASS,
  STATUS_TEXT,
  TAG_CLASS,
  fieldApplies,
  isActiveStatus,
  prerequisitesOf,
  waitingClause,
  type Entity,
  type Field,
} from "@/lib/erp/entities";
import { moduleByKey } from "@/lib/erp/nav";
import type { RefOption, Row } from "@/lib/erp/records";
import type { SystemDefaultKey } from "@/lib/erp/system-defaults";
import { formatDate, formatMoney, formatPct, formatRate, todayIso } from "@/lib/format";
import { BASE_CURRENCY_LABEL, isBaseCurrency } from "@/lib/erp/currency";
import { recordTitle } from "@/lib/erp/record-title";
import { AddressesTab, ContactsTab } from "@/components/master/partner-tabs";
import { UomConversionsTab } from "@/components/master/item-tabs";
import type { CollectionTabProps } from "@/components/master/collection-tab";

/**
 * The components that draw a `custom` tab, by `<entity key>.<tab key>`. A
 * custom tab edits a collection the registry cannot describe; its items travel
 * to the Server Action under `_<tab key>`.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const CUSTOM_TABS: Record<string, (props: CollectionTabProps<any>) => React.ReactNode> = {
  "m_partner.addresses": AddressesTab,
  "m_partner.contacts": ContactsTab,
  "m_item.uoms": UomConversionsTab,
};

export type FormMode = "new" | "view" | "edit";

export function EntityForm({
  entity,
  mode,
  row,
  refs,
  can,
  headerActions,
  editTone = "primary",
  defaults,
  lockedFields,
  lockNote,
  collections: initialCollections,
}: {
  entity: Entity;
  mode: FormMode;
  row: Row | null;
  /** Keyed by field name, not by target table — see `refOptions` in records.ts. */
  refs: Record<string, RefOption[]>;
  /** Presentation only — the Server Actions check the same permissions. */
  can: EntityAbilities;
  /**
   * Buttons an entity with a lifecycle of its own contributes to the detail
   * header — a Fiscal Year is activated, not edited into Open. The registry
   * describes fields, not lifecycles, so the escape hatch is a slot rather
   * than another config key nothing else would use.
   */
  headerActions?: React.ReactNode;
  /**
   * How prominent Ubah is, and therefore where it sits. A header carries one
   * primary and it is the rightmost button, so when `headerActions` supplies
   * the screen's chief action — activating a Fiscal Year — Ubah steps down to
   * neutral and moves to its left. See `lib/erp/header-actions.ts`.
   */
  editTone?: ActionTone;
  /**
   * System Defaults, already resolved against their masters, used to fill a
   * create form in. Absent on view and edit: a default is a starting point for
   * a new record, never something that reaches an existing one.
   */
  defaults?: Partial<Record<SystemDefaultKey, number | null>>;
  /**
   * Fields this particular record may not edit, where the registry cannot say
   * so because it depends on the row rather than on the entity — an account
   * that has gained a sub-account no longer decides whether it is postable.
   */
  lockedFields?: string[];
  /** Why those fields are locked, as a closing note at the foot of the card. */
  lockNote?: string;
  /** What each `custom` tab starts with, by tab key — a Partner's addresses. */
  collections?: Record<string, unknown[]>;
}) {
  const router = useRouter();
  const toast = useToast();
  const editing = mode === "new" || mode === "edit";
  const basePath = `/${entity.module}/${entity.slug}`;
  const moduleName = moduleByKey(entity.module)?.name ?? entity.module;
  const canEdit = can.edit;
  const statusModel = entity.statusModel;

  const [values, setValues] = useState<FormValues>(() =>
    initialValues(entity, row, defaults)
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmToggle, setConfirmToggle] = useState(false);
  const [busyToggle, setBusyToggle] = useState(false);

  // A form is a header card, its remaining content in tabs, then the record
  // history (Claude-ERP.md P38).
  // A fields tab whose every field is out of play for this record — the
  // customer-only Penjualan tab on a supplier — is not offered at all.
  const tabs = (entity.tabs ?? []).filter(
    (t) =>
      t.kind === "custom" ||
      entity.fields.some(
        (f) =>
          f.tab === t.key &&
          fieldApplies(f, values, (name, id) =>
            refs[name]?.find((o) => o.id === Number(id))?.label
          )
      )
  );
  const [chosenTab, setActiveTab] = useState(tabs[0]?.key ?? "");
  // The chosen tab, unless it has since dropped out of play.
  const activeTab = tabs.some((t) => t.key === chosenTab) ? chosenTab : (tabs[0]?.key ?? "");
  const [collections, setCollections] = useState<Record<string, unknown[]>>(
    () => initialCollections ?? {}
  );

  const active = statusModel
    ? isActiveStatus(statusModel, row?.[statusModel.field])
    : true;
  const canToggleStatus =
    Boolean(statusModel?.toggle) && (active ? can.deactivate : can.activate);
  const viewActions = masterHeaderActions({
    toggle: canToggleStatus ? (active ? "deactivate" : "activate") : null,
    edit: canEdit,
    editTone,
  });

  const setField = (field: Field, value: string | boolean | null) => {
    setValues((v) => {
      const next = { ...v, [field.name]: value };
      // Dependent refs are cleared so a stale selection can't survive.
      for (const dep of field.resets ?? []) next[dep] = null;
      return next;
    });
    setDirty(true);
    setErrors((e) => {
      if (!e[field.name]) return e;
      const next = { ...e };
      delete next[field.name];
      return next;
    });
  };

  /** The short label of the row a ref field currently points at. */
  const refLabelOf = (fieldName: string, id: unknown) =>
    refs[fieldName]?.find((o) => o.id === Number(id))?.label;

  const applies = (field: Field) => fieldApplies(field, values, refLabelOf);

  /**
   * The code a `segment` field continues — the first of its `inheritsFrom`
   * fields that has a value. Shown beside the input so the number being typed
   * is read in full; the Server Action resolves the same prefix from the
   * database and composes the code there.
   */
  const inheritedCode = (field: Field): string | null => {
    for (const name of field.inheritsFrom ?? []) {
      const id = Number(values[name] ?? 0);
      if (!id) continue;
      return refs[name]?.find((o) => o.id === id)?.label ?? null;
    }
    return null;
  };

  /**
   * The half of a ref narrowing that depends on what is being entered right
   * now. The server already applied the structural half when it built these
   * options, and re-checks the whole rule when the form is submitted.
   */
  /** The currency a `money` field is denominated in, for the label in its box. */
  const currencyLabelOf = (field: Field): string | undefined => {
    if (!field.currencyFrom) return undefined;
    const id = Number(values[field.currencyFrom] ?? 0);
    if (!id) return undefined;
    return refs[field.currencyFrom]?.find((o) => o.id === id)?.label;
  };

  /**
   * What this field is still waiting on, if anything.
   *
   * A ref whose options are decided by another field used to render as an open
   * picker over an empty list: clicking it said "Tidak ada pilihan yang cocok",
   * which reads as *there are none* rather than *the question that decides them
   * has not been asked yet*. It now says which field to fill in first, and does
   * not collect an answer out of order. Nothing is hidden — the field stays in
   * its place, so the shape of the form never changes under the reader.
   */
  const waitingFor = (field: Field): string | null =>
    field.type === "ref"
      ? waitingClause(prerequisitesOf(entity, field, values, applies))
      : null;

  const optionsFor = (field: Field): RefOption[] => {
    const all = refs[field.name] ?? [];

    switch (field.refFilter) {
      case "parentAccount": {
        // A parent decides this account's number, so it has to sit in the
        // same kelompok. `validateAccount` re-checks it.
        const subcategoryId = Number(values.account_subcategory_id ?? 0);
        if (!subcategoryId) return [];
        return all.filter(
          (o) => o.subcategoryId === subcategoryId && o.id !== row?.id
        );
      }
      case "itemCategoryByType": {
        // A category belongs to one Item Type; until the type is chosen the
        // picker waits (`resets` on the type field). The server re-checks.
        const type = values.item_type;
        if (!type) return [];
        return all.filter((o) => o.itemType === type);
      }
      default:
        return all;
    }
  };

  /** The tab that holds a given error key, if any. */
  const tabOfError = (key: string): string | undefined => {
    const custom = tabs.find((t) => t.kind === "custom" && `_${t.key}` === key);
    if (custom) return custom.key;
    return entity.fields.find((f) => f.name === key)?.tab;
  };

  const onSave = async () => {
    setSaving(true);
    const payload: FormValues = { ...values };
    for (const t of tabs) {
      if (t.kind === "custom") payload[`_${t.key}`] = JSON.stringify(collections[t.key] ?? []);
    }
    const result =
      mode === "new"
        ? await createRecord(entity.slug, payload)
        : await updateRecord(entity.slug, row!.id, payload);
    setSaving(false);

    if (!result.ok) {
      setErrors(result.errors);
      // Bring the refusal into view: if nothing in the header card is wrong,
      // open the first tab that holds an error.
      const keys = Object.keys(result.errors).filter((k) => k !== "_form");
      const headerWrong = keys.some((k) => !tabOfError(k));
      const firstTab = tabs.find((t) => keys.some((k) => tabOfError(k) === t.key));
      if (!headerWrong && firstTab) setActiveTab(firstTab.key);
      // `_form` is a whole-form refusal (a denied permission), not a field error.
      const refusal = result.errors._form;
      toast(
        refusal ? "Tidak diizinkan" : "Belum bisa disimpan",
        refusal ?? `${Object.keys(result.errors).length} field perlu diperbaiki.`,
        "err"
      );
      return;
    }

    setDirty(false);
    if (mode === "new") {
      toast(
        `${entity.single ?? entity.name} dibuat`,
        `Kode sistem ${result.code} dibuat otomatis.`,
        "ok"
      );
    } else {
      toast("Perubahan tersimpan", `${entity.name} berhasil diperbarui.`, "ok");
    }
    router.push(`${basePath}/${result.id}`);
    router.refresh();
  };

  const onToggle = async () => {
    if (!row) return;
    setBusyToggle(true);
    const result = await toggleStatus(entity.slug, row.id);
    setBusyToggle(false);
    setConfirmToggle(false);
    if (result.ok) {
      toast(
        "Status diperbarui",
        `${title} sekarang ${result.active ? "aktif" : "nonaktif"}.`,
        "ok"
      );
      router.refresh();
    } else {
      toast("Gagal", result.message ?? "Status tidak dapat diubah.", "err");
    }
  };

  const label = entity.labelField ? String(row?.[entity.labelField] ?? "") : "";
  const title = recordTitle(entity, row, refs);
  const statusValue = statusModel ? String(row?.[statusModel.field] ?? "") : "";

  // A create-only field has nowhere to read a value back from — it was never a
  // column on this table — so it exists on the create form and nowhere else. A
  // derived field is the mirror image: never typed, but worth showing once it
  // has a value, so it appears read-only on the detail and not on either form.
  const visible = entity.fields.filter(
    (f) =>
      applies(f) &&
      !(f.createOnly && mode !== "new") &&
      !(f.derived && editing)
  );
  const statusFieldName = statusModel?.field;
  const headerFields = visible.filter((f) => !f.tab);
  const businessFields = headerFields.filter(
    (f) => f.name !== "note" && f.name !== statusFieldName
  );
  const statusFields = headerFields.filter((f) => f.name === statusFieldName);
  const noteFields = headerFields.filter((f) => f.name === "note");

  const control = (f: Field, extra?: { statusLike?: boolean }) => (
    <FieldControl
      key={f.name}
      field={f}
      value={values[f.name]}
      row={row}
      editing={editing}
      exists={mode !== "new"}
      error={errors[f.name]}
      options={optionsFor(f)}
      prefix={f.type === "segment" ? inheritedCode(f) : null}
      waitingFor={waitingFor(f)}
      currencyLabel={currencyLabelOf(f)}
      forceLocked={lockedFields?.includes(f.name)}
      statusLike={extra?.statusLike}
      onChange={(v) => setField(f, v)}
    />
  );

  const tabHasError = (key: string) =>
    Object.keys(errors).some((k) => tabOfError(k) === key);

  const renderTab = () => {
    const tab = tabs.find((t) => t.key === activeTab);
    if (!tab) return null;

    if (tab.kind === "custom") {
      const Custom = CUSTOM_TABS[`${entity.key}.${tab.key}`];
      if (!Custom) return null;
      return (
        <Custom
          editing={editing}
          items={collections[tab.key] ?? []}
          error={errors[`_${tab.key}`]}
          context={{ values, refs }}
          onChange={(items) => {
            setCollections((c) => ({ ...c, [tab.key]: items }));
            setDirty(true);
            setErrors((e) => {
              if (!e[`_${tab.key}`]) return e;
              const next = { ...e };
              delete next[`_${tab.key}`];
              return next;
            });
          }}
        />
      );
    }

    const fields = visible.filter((f) => f.tab === tab.key);
    const sections = [...new Set(fields.map((f) => f.section ?? ""))];
    return (
      <div className="card">
        <div className="card-h">
          <span className="ci">
            <Icon name={tab.icon} size={15} />
          </span>
          <div className="ct">
            <h3>{tab.label}</h3>
            <p>{tab.desc}</p>
          </div>
        </div>
        {sections.map((s) => (
          <FormSection key={s} title={sections.length > 1 ? s : undefined}>
            <FormRow>{fields.filter((f) => (f.section ?? "") === s).map((f) => control(f))}</FormRow>
          </FormSection>
        ))}
      </div>
    );
  };

  // Before the first save there is no code and no status to show, so the
  // heading is a placeholder identity rather than a summary of blanks.
  const heading = mode === "new" ? `${entity.single ?? entity.name} Baru` : title;
  const code = mode === "new" ? "" : String(row?.[entity.codeField] ?? "");

  return (
    <>
      <div className="ph">
        <div className="crumb">
          <span>{moduleName}</span>
          <span>/</span>
          <Link href={basePath}>{entity.name}</Link>
          <span>/</span>
          <span className="cur">{mode === "new" ? "Baru" : title}</span>
        </div>

        <div className="ph-row">
          <h1>
            <span className="ph-ico">
              <Icon name={entity.icon} size={16} />
            </span>
            {heading}
            {mode !== "new" && label && <span className="lab lg">{label}</span>}
            {/* A master record is known by its name, so the name stays the
                heading; the system code is its technical reference and belongs
                beside it rather than in a card of its own. */}
            {code && <span className="docno sm">{code}</span>}
            {mode === "view" && statusValue && (
              <span className={`bdg ${STATUS_CLASS[statusValue] ?? "s-mute"}`}>
                {STATUS_TEXT[statusValue] ?? statusValue}
              </span>
            )}
            {mode === "edit" && <span className="bdg t-warn">Mode Ubah</span>}
          </h1>

          <div className="ph-act">
            {editing && dirty && (
              <span className="ph-dirty">
                <span className="pulse" /> Belum disimpan
              </span>
            )}
            {mode === "view" &&
              viewActions
                .filter((a) => a.key === "toggle")
                .map((a) => (
                  <button
                    key={a.key}
                    className={headerButtonClass(a.tone)}
                    onClick={() => setConfirmToggle(true)}
                  >
                    <Icon name="gear" size={15} /> {a.label}
                  </button>
                ))}
            {mode === "view" && editTone === "primary" && headerActions}
            {editing ? (
              <>
                <CancelButton href={mode === "new" ? basePath : `${basePath}/${row!.id}`} dirty={dirty} disabled={saving} />
                <button className="btn primary" onClick={onSave} disabled={saving}>
                  <Icon name="save" size={15} /> {saving ? "Menyimpan…" : "Simpan"}
                </button>
              </>
            ) : viewActions.some((a) => a.key === "edit") ? (
              <Link
                className={headerButtonClass(editTone)}
                href={`${basePath}/${row!.id}/edit`}
              >
                <Icon name="pen" size={15} /> Ubah
              </Link>
            ) : null}
            {mode === "view" && editTone !== "primary" && headerActions}
          </div>
        </div>
      </div>

      <div className="fgrid solo">
        <div>
          <div className="card">
            <FormSection>
              <FormRow>{businessFields.map((f) => control(f))}</FormRow>
            </FormSection>

            {statusFields.length > 0 && (
              // No section hint: the status field's own help says the same
              // thing, and with help now on the label row the two sat one line
              // apart.
              <FormSection title="Status Data">
                <FormRow>
                  {statusFields.map((f) => control({ ...f }, { statusLike: true }))}
                </FormRow>
              </FormSection>
            )}

            {noteFields.length > 0 && (
              <FormSection>
                <FormRow>{noteFields.map((f) => control(f))}</FormRow>
              </FormSection>
            )}

            {lockNote && <p className="fnote">{lockNote}</p>}
          </div>

          {tabs.length > 0 && (
            <>
              <div className="tabs" role="tablist">
                {tabs.map((t) => {
                  const count = t.kind === "custom" ? (collections[t.key] ?? []).length : null;
                  const bad = tabHasError(t.key);
                  return (
                    <button
                      key={t.key}
                      role="tab"
                      aria-selected={t.key === activeTab}
                      className={`tab${t.key === activeTab ? " on" : ""}${bad ? " bad" : ""}`}
                      onClick={() => setActiveTab(t.key)}
                    >
                      <Icon name={t.icon} size={14} />
                      {t.label}
                      {count !== null && <span className="tc">{count}</span>}
                      {bad && <span className="td" title="Ada yang perlu diperbaiki" />}
                    </button>
                  );
                })}
              </div>
              {renderTab()}
            </>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={confirmToggle}
        icon={active ? "warn" : "check"}
        tone={active ? "danger" : "ok"}
        title={`Konfirmasi ${active ? "Nonaktifkan" : "Aktifkan"} Data`}
        subject={title}
        body={
          active
            ? "Data yang nonaktif tidak akan muncul lagi sebagai pilihan pada transaksi baru. Seluruh history dan referensi yang sudah ada tetap utuh."
            : "Data akan kembali tersedia sebagai pilihan pada transaksi baru."
        }
        confirmLabel={`Ya, ${active ? "Nonaktifkan" : "Aktifkan"}`}
        confirmTone={active ? "solid-danger" : "primary"}
        busy={busyToggle}
        onConfirm={onToggle}
        onCancel={() => setConfirmToggle(false)}
      />
    </>
  );
}

function initialValues(
  entity: Entity,
  row: Row | null,
  defaults?: Partial<Record<SystemDefaultKey, number | null>>
): FormValues {
  const out: FormValues = {};
  for (const f of entity.fields) {
    const preset = f.systemDefault ? defaults?.[f.systemDefault] : null;
    if (row) {
      const v = row[f.name];
      if (f.type === "bool") out[f.name] = Boolean(v);
      // Dates arrive as full ISO timestamps; `DateInput` works in `yyyy-mm-dd`
      // and shows `dd/mm/yyyy`, and the Server Action parses the ISO form back
      // at UTC midnight.
      else if (f.type === "date") out[f.name] = v == null ? null : String(v).slice(0, 10);
      else out[f.name] = v == null ? null : String(v);
    } else if (preset != null) {
      out[f.name] = String(preset);
    } else if (f.defaultValue != null) {
      out[f.name] = f.defaultValue as string | boolean;
    } else if (f.type === "bool") {
      out[f.name] = false;
    } else if (f.type === "date" && !f.derived && !f.locked) {
      // A date somebody types is almost always today's. A derived date is the
      // action's to write, so it is left alone.
      out[f.name] = todayIso();
    } else {
      out[f.name] = "";
    }
  }
  return out;
}

function FieldControl({
  field,
  value,
  row,
  editing,
  exists,
  error,
  options,
  prefix,
  currencyLabel,
  statusLike,
  forceLocked,
  waitingFor,
  onChange,
}: {
  field: Field;
  value: string | boolean | null | undefined;
  row: Row | null;
  editing: boolean;
  exists: boolean;
  /** Locked for this row rather than for the entity — see `lockedFields`. */
  forceLocked?: boolean;
  /** What must be answered before this field can be — see `Combobox`. */
  waitingFor?: string | null;
  error?: string;
  options: RefOption[];
  /** `segment` only: the code this field's number continues. */
  prefix?: string | null;
  /** `money` only: the currency the amount is in. */
  currencyLabel?: string;
  /** This field carries the record's status, so a boolean reads Aktif/Non Aktif. */
  statusLike?: boolean;
  onChange: (value: string | boolean | null) => void;
}) {
  const locked = Boolean((field.locked || forceLocked) && exists);
  // Three columns by default: a master record's fields are short, and two
  // columns left a date picker in a 500px box. `full` and a textarea still take
  // the whole row, and a field that needs a different share says so in the
  // registry.
  const span: FieldSpan =
    field.span ?? (field.full || field.type === "textarea" ? 12 : 4);

  // A locked field is shown as what it holds, never as a disabled control: it
  // cannot be changed, and a greyed-out input reads as one that merely is not
  // available right now. The Server Action ignores it whatever is submitted.
  const node =
    editing && !locked
      ? editableControl({
          field,
          value,
          error,
          options,
          prefix,
          currencyLabel,
          waitingFor,
          onChange,
        })
      : readOnlyBody({ field, row, options, currencyLabel, statusLike });

  return (
    <FormField
      label={field.label}
      span={span}
      required={editing && field.required}
      locked={locked && editing}
      help={editing ? field.help : undefined}
      error={error}
    >
      {node}
    </FormField>
  );
}

/** How a saved value presents itself — as text, never as a disabled input. */
function readOnlyBody({
  field,
  row,
  options,
  currencyLabel,
  statusLike,
}: {
  field: Field;
  row: Row | null;
  options: RefOption[];
  currencyLabel?: string;
  statusLike?: boolean;
}): React.ReactNode {
  const raw = row?.[field.name];

  if (field.type === "ref") {
    const opt = options.find((o) => o.id === Number(raw));
    return opt ? (
      <div className="ro">
        <span className="lab">{opt.label}</span>
        <span>{opt.name}</span>
      </div>
    ) : (
      <div className="ro nil">tidak diisi</div>
    );
  }
  if (field.type === "bool") {
    return (
      <div className="ro">
        <span className={`bdg ${raw ? "s-ok" : "s-bad"}`}>
          {statusLike ? (raw ? "Aktif" : "Non Aktif") : raw ? "Ya" : "Tidak"}
        </span>
      </div>
    );
  }
  if (field.type === "date") {
    return raw ? (
      <div className="ro">{formatDate(raw as string)}</div>
    ) : (
      <div className="ro nil">tidak diisi</div>
    );
  }
  if (field.type === "select") {
    if (raw == null || raw === "") return <div className="ro nil">tidak diisi</div>;
    const s = String(raw);
    // The field's own labels win over the global status vocabulary. They used
    // not to be read here at all, so a select whose values happened not to be
    // in STATUS_TEXT printed its raw stored value — "IN" where the form had
    // just offered "Penerimaan", which is the one thing the direction rule
    // forbids. Status still reads correctly because its values are in both.
    const label = field.optionLabels?.[s] ?? STATUS_TEXT[s] ?? s;
    return (
      <div className="ro">
        <span className={`bdg ${STATUS_CLASS[s] ?? TAG_CLASS[s] ?? "t-slate"}`}>
          {label}
        </span>
      </div>
    );
  }
  if (field.type === "money") {
    return raw == null || raw === "" ? (
      <div className="ro nil">tidak diisi</div>
    ) : (
      <div className="ro">
        <span className="mny">{formatMoney(raw as number, currencyLabel ?? "IDR")}</span>
      </div>
    );
  }
  if (field.type === "percent") {
    return raw == null || raw === "" ? (
      <div className="ro nil">tidak diisi</div>
    ) : (
      <div className="ro">
        <span className="mny">{formatPct(raw as number)}</span>
      </div>
    );
  }
  if (field.type === "rate") {
    return raw == null || raw === "" ? (
      <div className="ro nil">tidak diisi</div>
    ) : (
      <div className="ro">
        <span className="mny">{formatRate(raw as number)}</span>
      </div>
    );
  }
  if (field.type === "textarea") {
    return raw ? (
      <div className="ro multi">{String(raw)}</div>
    ) : (
      <div className="ro multi nil">tidak diisi</div>
    );
  }
  if (field.ident) {
    return raw ? (
      <div className="ro">
        <span className="lab">{String(raw)}</span>
      </div>
    ) : (
      <div className="ro nil">tidak diisi</div>
    );
  }
  return raw == null || raw === "" ? (
    <div className="ro nil">tidak diisi</div>
  ) : (
    <div className="ro">{String(raw)}</div>
  );
}

function editableControl({
  field,
  value,
  error,
  options,
  prefix,
  currencyLabel,
  waitingFor,
  onChange,
}: {
  field: Field;
  value: string | boolean | null | undefined;
  error?: string;
  options: RefOption[];
  prefix?: string | null;
  currencyLabel?: string;
  waitingFor?: string | null;
  onChange: (value: string | boolean | null) => void;
}): React.ReactNode {
  if (field.type === "bool") {
    // A caption that stands on its own gets the one-line control, so a form
    // full of toggles does not read as a wall of explanation.
    const compact = !field.captionDetail;
    return (
      <label
        className={`chk${compact ? " sm" : ""}${error ? " bad" : ""}`}
      >
        <input
          type="checkbox"
          checked={Boolean(value)}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span>
          <span className="ct">{field.caption ?? "Aktif"}</span>
          {field.captionDetail && <span className="cd">{field.captionDetail}</span>}
        </span>
      </label>
    );
  }

  // One number continuing an inherited code. Until the field it inherits from
  // is chosen there is nothing to continue, so the input waits rather than
  // collecting a number that would have no place to go.
  if (field.type === "segment") {
    return (
      <div className={`segf${error ? " bad" : ""}`}>
        <span className={`pfx${prefix ? "" : " nil"}`}>
          {prefix ? `${prefix}.` : "menunggu induk"}
        </span>
        <input
          value={value == null ? "" : String(value)}
          placeholder={field.placeholder}
          disabled={!prefix}
          inputMode="numeric"
          autoComplete="off"
          maxLength={3}
          onChange={(e) => onChange(e.target.value.replace(/[^0-9]/g, ""))}
        />
      </div>
    );
  }

  if (field.type === "ref") {
    return (
      <Combobox
        value={value == null || value === "" ? null : Number(value)}
        options={options}
        placeholder={`Pilih ${field.label}…`}
        invalid={Boolean(error)}
        waitingFor={waitingFor}
        onChange={(v) => onChange(v == null ? null : String(v))}
      />
    );
  }
  if (field.type === "select") {
    return (
      <Select
        value={value == null ? "" : String(value)}
        options={[
          ...(field.required ? [] : [{ value: "", label: "— tidak diisi —" }]),
          ...(field.options ?? []).map((o) => ({
            value: o,
            label: field.optionLabels?.[o] ?? o,
          })),
        ]}
        placeholder={`Pilih ${field.label}…`}
        invalid={Boolean(error)}
        onChange={onChange}
      />
    );
  }
  if (field.type === "date") {
    return (
      <DateInput
        value={value == null ? "" : String(value)}
        invalid={Boolean(error)}
        onChange={onChange}
      />
    );
  }
  if (field.type === "money") {
    return (
      <MoneyInput
        value={value == null ? "" : String(value)}
        currencyLabel={currencyLabel}
        invalid={Boolean(error)}
        placeholder={field.placeholder ?? "0"}
        onChange={onChange}
      />
    );
  }
  if (field.type === "percent") {
    return (
      <MoneyInput
        value={value == null ? "" : String(value)}
        currencyLabel="%"
        decimals={4}
        invalid={Boolean(error)}
        placeholder={field.placeholder ?? "0"}
        onChange={onChange}
      />
    );
  }
  if (field.type === "rate") {
    // The pair the rate converts, inside the box, so it reads in a direction
    // rather than as a bare number.
    const pair =
      currencyLabel && !isBaseCurrency(currencyLabel)
        ? `${currencyLabel} → ${BASE_CURRENCY_LABEL}`
        : undefined;
    return (
      <RateInput
        value={value == null ? "" : String(value)}
        pairLabel={pair}
        invalid={Boolean(error)}
        placeholder={field.placeholder ?? "0"}
        onChange={onChange}
      />
    );
  }
  if (field.type === "textarea") {
    return (
      <textarea
        className={`ta${error ? " bad" : ""}`}
        rows={2}
        value={value == null ? "" : String(value)}
        placeholder={field.placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }
  return (
    <input
      className={`inp${field.ident ? " idf" : ""}${error ? " bad" : ""}`}
      type="text"
      inputMode={field.type === "number" ? "numeric" : undefined}
      value={value == null ? "" : String(value)}
      placeholder={field.placeholder}
      autoComplete="off"
      onChange={(e) => onChange(e.target.value)}
    />
  );
}