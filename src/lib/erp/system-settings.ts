import "server-only";

import { prisma } from "@/lib/prisma";
import { BASE_CURRENCY_LABEL } from "./currency";
import { checkAccountIsLeaf, type RefOption } from "./records";
import type { PpnRates } from "./sales-tax";
import {
  EMPTY_SYSTEM_DEFAULTS,
  SYSTEM_DEFAULTS,
  isSystemDefaultKey,
  refValueOf,
  systemDefaultDef,
  type SystemDefaultKey,
  type SystemDefaultValues,
} from "./system-defaults";

/**
 * Reading and writing the settings catalogue (System Default and Account
 * Mapping, P61).
 *
 * `sys_setting` is a key/value table whose keys are declared in code, so a row
 * with an unknown key is ignored rather than surfaced: it can only be left over
 * from a setting that no longer exists. A key that has never been set reads as
 * null, which every caller must treat as "no default" — a default that failed
 * to load must leave a control empty, never guess.
 */
export async function systemDefaults(): Promise<SystemDefaultValues> {
  const rows = await prisma.sysSetting.findMany();
  const out: SystemDefaultValues = { ...EMPTY_SYSTEM_DEFAULTS };
  for (const row of rows) {
    if (isSystemDefaultKey(row.setting_key)) {
      out[row.setting_key] = row.setting_value;
    }
  }
  return out;
}

/**
 * Writes the submitted keys, leaving the rest alone.
 *
 * Returns the keys whose value actually changed, which is what the audit entry
 * and the toast describe — saving a form nobody edited should say so rather
 * than claim a change.
 */
export async function writeSystemDefaults(
  values: Partial<Record<SystemDefaultKey, string | null>>,
  actorId: number
): Promise<SystemDefaultKey[]> {
  const current = await systemDefaults();
  const changed: SystemDefaultKey[] = [];

  for (const def of SYSTEM_DEFAULTS) {
    if (!(def.key in values)) continue;
    const next = values[def.key] ?? null;
    if ((current[def.key] ?? null) === next) continue;

    await prisma.sysSetting.upsert({
      where: { setting_key: def.key },
      update: { setting_value: next, updated_by: actorId },
      create: { setting_key: def.key, setting_value: next, updated_by: actorId },
    });
    changed.push(def.key);
  }

  return changed;
}

/**
 * The System Defaults currently pointing at an account, by name.
 *
 * Read before that account is given a sub-account: becoming a parent revokes
 * its posting privilege, and every account-valued default names somewhere a
 * posting *goes* — the FX difference account and the Laba/Rugi equity
 * accounts. A setting left pointing at a heading would refuse an FX posting or
 * a close later, by name, for a reason nobody would connect to the
 * sub-account they had created.
 */
export async function systemDefaultsUsingAccount(
  accountId: number
): Promise<string[]> {
  const current = await systemDefaults();
  return SYSTEM_DEFAULTS.filter(
    (def) => def.type === "ref" && def.ref === "acc_account" && refValueOf(current, def.key) === accountId
  ).map((def) => def.name);
}

/**
 * The base currency's row: the one currency every book is measured in
 * (`currency.ts`). It is a constant, never a setting, so this only finds the
 * row that carries its label. A new record's Currency picker starts on it
 * (P61) — resolved against the master, so a deactivated row prefills nothing.
 */
export async function baseCurrency(): Promise<{ id: number; label: string; name: string; active: boolean } | null> {
  const row = await prisma.refCurrency.findFirst({ where: { currency_label: BASE_CURRENCY_LABEL } });
  return row
    ? { id: row.id, label: row.currency_label, name: row.currency_name, active: row.status === "Active" }
    : null;
}

/** The base currency's id when it can be offered in a picker, else null. */
export async function baseCurrencyId(): Promise<number | null> {
  const c = await baseCurrency();
  return c?.active ? c.id : null;
}

/**
 * The PPN rate and DPP Nilai Lain factor in force, or null when any of them
 * is unset or unusable — a taxable document is then refused by name rather
 * than computed on a guess (P60). A document snapshots what this returns.
 */
export async function ppnRates(): Promise<PpnRates | null> {
  const v = await systemDefaults();
  const rate = Number(v.ppn_rate);
  const otherNum = Number(v.ppn_dpp_other_numerator);
  const otherDen = Number(v.ppn_dpp_other_denominator);
  const ok =
    v.ppn_rate != null && v.ppn_dpp_other_numerator != null && v.ppn_dpp_other_denominator != null &&
    rate > 0 && rate <= 100 && Number.isInteger(otherNum) && Number.isInteger(otherDen) &&
    otherNum > 0 && otherDen >= otherNum;
  return ok ? { rate, otherNum, otherDen } : null;
}

/** The refusal a taxable document reads when the PPN settings are not usable. */
export const PPN_SETTINGS_MISSING =
  "Tarif PPN atau faktor DPP Nilai Lain belum diatur di System Default.";

// ------------------------------------------------------- posting targets

/**
 * Is this a value the setting may actually hold?
 *
 * The account-valued settings name where a posting lands or where the Neraca
 * places a figure, so they are checked when they are *stored* as well as when
 * they are read: an account must be postable, active and a leaf. Returns an
 * Indonesian message, or null when the value is fine.
 *
 * This narrows nothing on its own — the picker offers the same set — but the
 * Server Action is reachable directly with any id, which is where it counts.
 */
export async function checkSystemDefaultValue(
  key: SystemDefaultKey,
  id: number
): Promise<string | null> {
  const def = systemDefaultDef(key);
  if (def.type !== "ref" || def.ref !== "acc_account") return null;

  const account = await prisma.accAccount.findUnique({
    where: { id },
    select: { is_postable: true, is_active: true },
  });
  if (!account) return "Account tidak ditemukan.";
  if (!account.is_postable) return "Account tersebut bukan account postable.";
  if (!account.is_active) return "Account tersebut non-aktif.";
  // A parent account is a heading, not a destination — a posting made to one
  // would be money in the chart no leaf accounts for.
  return checkAccountIsLeaf(id);
}

/** A setting's account id, or null when it is unset or no longer usable. */
async function usableAccount(
  values: SystemDefaultValues,
  key: SystemDefaultKey
): Promise<number | null> {
  const id = refValueOf(values, key);
  if (!id || (await checkSystemDefaultValue(key, id))) return null;
  return id;
}

/**
 * The accumulated-P&L setting, by name, when it is not usable.
 *
 * Closing a Fiscal Year moves that year's result into Laba/Rugi Tahun
 * Sebelumnya, so without that account there is nowhere for the closing journal
 * to post and the whole process is refused: a posting target is never guessed
 * and never falls back.
 *
 * Resolved against the master rather than trusted as stored, so a setting
 * pointing at an account that has since been deactivated, made non-postable
 * or given a sub-account reads as unset rather than as ready.
 *
 * The Neraca's computed-line account, Tahun Berjalan, is deliberately **not**
 * checked here. Nothing posts to it, so closing does not need it — the Neraca
 * does, and `missingNeracaAccounts` asks on its behalf.
 */
export async function missingClosingAccounts(): Promise<string[]> {
  const values = await systemDefaults();
  return (await usableAccount(values, "accumulated_pl_account"))
    ? []
    : [systemDefaultDef("accumulated_pl_account").name];
}

/**
 * The Neraca's settings that are not usable, by name.
 *
 * Laba/Rugi Tahun Berjalan is never posted to; the Neraca computes the figure
 * and **places** it on the account the setting names, so the user decides the
 * line's name and position in the chart. Laba/Rugi Tahun Sebelumnya is where
 * the closing journal posts, and the Neraca prints one computed line per
 * unclosed year directly beneath it. Without either account the report has
 * nowhere to put a figure and is not produced — refused by name.
 *
 * Tahun Berjalan is needed by every Neraca. Tahun Sebelumnya is needed only
 * while an unclosed year is carried, so it is asked for only where the caller
 * says so: a setting blocks only where it is used.
 */
export async function missingNeracaAccounts(
  carryingUnclosedYear: boolean
): Promise<string[]> {
  const result = await neracaAccounts(carryingUnclosedYear);
  return result.ok ? [] : result.missing;
}

export type NeracaAccounts =
  | { ok: true; currentId: number; accumulatedId: number | null }
  | { ok: false; missing: string[] };

/**
 * Where the Neraca places its computed equity figures, or what is missing, by
 * name.
 *
 * The Neraca is **not produced** without them, so this is the refusal's source
 * as well as the placement's. Tahun Sebelumnya is resolved only when the
 * caller has year lines to anchor beneath it.
 */
export async function neracaAccounts(
  needsYearLines: boolean
): Promise<NeracaAccounts> {
  const values = await systemDefaults();
  const currentId = await usableAccount(values, "current_pl_account");
  const accumulatedId = needsYearLines
    ? await usableAccount(values, "accumulated_pl_account")
    : null;

  const missing: string[] = [];
  if (!currentId) missing.push(systemDefaultDef("current_pl_account").name);
  if (needsYearLines && !accumulatedId) {
    missing.push(systemDefaultDef("accumulated_pl_account").name);
  }
  if (missing.length) return { ok: false, missing };

  return { ok: true, currentId: currentId!, accumulatedId };
}

/**
 * Several posting targets at once, by key, or the ones that are not usable, by
 * name — the refusal a posting reads when Account Mapping is incomplete. Each
 * is resolved against the master, exactly as `closingAccount` is.
 */
export async function postingAccounts<K extends SystemDefaultKey>(
  keys: readonly K[]
): Promise<{ ok: true; ids: Record<K, number> } | { ok: false; missing: string[] }> {
  const values = await systemDefaults();
  const ids = {} as Record<K, number>;
  const missing: string[] = [];
  for (const key of keys) {
    const id = await usableAccount(values, key);
    if (id) ids[key] = id;
    else missing.push(systemDefaultDef(key).name);
  }
  return missing.length ? { ok: false, missing } : { ok: true, ids };
}

/**
 * The accounts these settings name where usable, null where not — for a
 * posting that has another source first (a Kategori Item's own account, P122)
 * and uses the setting only as its fallback.
 */
export async function fallbackAccounts<K extends SystemDefaultKey>(keys: readonly K[]): Promise<Record<K, number | null>> {
  const values = await systemDefaults();
  const out = {} as Record<K, number | null>;
  for (const key of keys) out[key] = await usableAccount(values, key);
  return out;
}

export type ClosingAccount =
  | { ok: true; accountId: number }
  | { ok: false; missing: string };

/**
 * Where the closing journal posts its result, resolved by name.
 *
 * A posting target is named, never guessed and never fallen back to. Resolved
 * against the master rather than trusted as stored, so a setting pointing at
 * an account that has since been deactivated, made non-postable or given a
 * sub-account reads as unset — posting to it would be posting somewhere the
 * application itself would no longer offer.
 */
export async function closingAccount(): Promise<ClosingAccount> {
  const id = await usableAccount(await systemDefaults(), "accumulated_pl_account");
  return id
    ? { ok: true, accountId: id }
    : { ok: false, missing: systemDefaultDef("accumulated_pl_account").name };
}

/**
 * The picker options for each `ref` setting — exactly what the setting's rules
 * admit: postable accounts that are active, plus whatever is already stored
 * even if it has since been deactivated, so a page that opens on a stale value
 * still shows what it is rather than an empty box.
 */
export async function settingOptions(
  current: SystemDefaultValues
): Promise<Record<SystemDefaultKey, RefOption[]>> {
  const accounts = await prisma.accAccount.findMany({
    where: { is_postable: true },
    orderBy: { account_label: "asc" },
  });
  const out = {} as Record<SystemDefaultKey, RefOption[]>;
  for (const def of SYSTEM_DEFAULTS) {
    if (def.type !== "ref") {
      out[def.key] = [];
      continue;
    }
    const chosen = Number(current[def.key] ?? "");
    out[def.key] = accounts
      .filter((a) => a.is_active || a.id === chosen)
      .map((a) => ({ id: a.id, label: a.account_label, name: a.account_name, active: a.is_active }));
  }
  return out;
}
