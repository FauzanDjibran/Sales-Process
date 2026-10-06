"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { authorizeAction } from "@/lib/erp/auth";
import { isAccessDenied } from "@/lib/erp/auth-errors";
import { saveItemCategoryAccounts, type ItemCategoryAccountInput, type ItemCategoryAccountResult } from "@/lib/erp/item-account";
import {
  isSystemDefaultKey,
  numberSettingProblem,
  settingPageOf,
  systemDefaultDef,
  type SettingsPage,
  type SystemDefaultKey,
} from "@/lib/erp/system-defaults";
import {
  checkSystemDefaultValue,
  writeSystemDefaults,
} from "@/lib/erp/system-settings";

/**
 * The one write path for both settings pages (P61): System Default and
 * Account Mapping. Each page is written under its own permission and writes
 * only its own keys, so holding one never edits the other.
 *
 * A default only fills a control in — it decides nothing — so the checking here
 * is deliberately light: the permission, that the keys are ones the catalogue
 * declares, and that a `ref` value is a row id rather than arbitrary text. What
 * a value is allowed to be is still decided where it matters, by the Server
 * Action that saves the record the default was prefilled into.
 */
export type SettingsResult =
  | { ok: true; changed: number }
  | { ok: false; errors: Record<string, string> };

const EDIT_PERMISSION: Record<SettingsPage, string> = {
  default: "SYSTEM_DEFAULT_EDIT",
  account: "ACCOUNT_MAPPING_EDIT",
};

export async function saveSystemDefaults(
  page: SettingsPage,
  values: Record<string, string | null>
): Promise<SettingsResult> {
  let actorId: number;
  try {
    const actor = await authorizeAction(EDIT_PERMISSION[page] ?? "SYSTEM_DEFAULT_EDIT");
    actorId = actor.user.id;
  } catch (error) {
    if (isAccessDenied(error)) {
      return { ok: false, errors: { _form: error.message } };
    }
    throw error;
  }

  const clean: Partial<Record<SystemDefaultKey, string | null>> = {};
  const errors: Record<string, string> = {};

  for (const [key, raw] of Object.entries(values)) {
    // A key the catalogue does not declare is not a setting, and a key of the
    // other page is not this permission's to write.
    if (!isSystemDefaultKey(key) || settingPageOf(key) !== page) continue;

    const value = raw == null ? "" : String(raw).trim();
    // A figure the tax law sets (P60) is never empty and is checked against
    // its bounds, and the factor's two halves against each other.
    const def = systemDefaultDef(key);
    if (def.type === "number") {
      const problem = numberSettingProblem(def, value, values);
      if (problem) errors[key] = problem;
      else clean[key] = String(Number(value));
      continue;
    }
    if (value === "") {
      clean[key] = null;
      continue;
    }
    const n = Number(value);
    if (!Number.isInteger(n) || n <= 0) {
      errors[key] = "Pilihan tidak dikenali.";
      continue;
    }
    // An account-valued setting is checked here as well as when it is read:
    // it decides which account a posting lands in, so storing one that could
    // not take a posting would be storing a fault.
    const refused = await checkSystemDefaultValue(key, n);
    if (refused) {
      errors[key] = refused;
      continue;
    }
    clean[key] = String(n);
  }

  if (Object.keys(errors).length) return { ok: false, errors };

  const changed = await writeSystemDefaults(clean, actorId);

  for (const key of changed) {
    const row = await prisma.sysSetting.findUnique({
      where: { setting_key: key },
      select: { id: true },
    });
    if (row) {
      await prisma.auditLog.create({
        data: {
          entity_key: "sys_setting",
          row_id: row.id,
          action: "UPDATE",
          event: "update",
          by: actorId,
        },
      });
    }
  }

  // Defaults are read wherever a form is built, so every form is now stale.
  revalidatePath("/settings/system-default");
  revalidatePath("/accounting/account-mapping");
  revalidatePath("/master/cash-bank/new");
  revalidatePath("/dashboard");

  return { ok: true, changed: changed.length };
}

/**
 * Accounts per Kategori Item (P122): the same permission as Account Mapping,
 * because it is the same kind of decision — where a posting lands.
 */
export async function saveItemCategoryAccountsAction(input: ItemCategoryAccountInput[]): Promise<ItemCategoryAccountResult> {
  let actorId: number;
  try {
    actorId = (await authorizeAction("ACCOUNT_MAPPING_EDIT")).user.id;
  } catch (error) {
    if (isAccessDenied(error)) return { ok: false, errors: { _form: error.message } };
    throw error;
  }
  const result = await saveItemCategoryAccounts(Array.isArray(input) ? input : [], actorId);
  if (result.ok) revalidatePath("/accounting/item-category-account");
  return result;
}
