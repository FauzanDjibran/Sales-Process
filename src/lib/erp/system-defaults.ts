/**
 * The System Default catalogue — every value the application prefills or
 * assumes when the user has not said otherwise.
 *
 * Declared in code for the same reason the permission catalogue is: a setting
 * is a branch somewhere in the application, so one that could be created at
 * runtime would be a row nothing reads. `sys_setting` holds only what each key
 * is currently set to.
 *
 * A default is a starting point, never a rule. Everything here fills a control
 * in that the user can then change — it must not decide what is valid, which
 * stays with the Server Actions. The account-valued settings are the exception
 * that names a destination: the FX difference account and the two Laba/Rugi
 * equity accounts are where postings and the Neraca go, one each for the one
 * company (Claude-ERP.md P9, P23).
 *
 * Client-safe on purpose — no `server-only`, no database import: the settings
 * form reads the same catalogue the Server Action writes against.
 */
import type { IconName } from "@/components/icon";

export type SystemDefaultKey =
  | "default_currency"
  | "fx_account"
  | "accumulated_pl_account"
  | "current_pl_account";

/** Which master a `ref` setting points at — a registry entity key. */
export type SystemDefaultRef = "ref_currency" | "acc_account";

export type SystemDefaultGroupKey = "application" | "fx" | "equity_pl";

export type SystemDefaultGroup = {
  key: SystemDefaultGroupKey;
  name: string;
  desc: string;
  icon: IconName;
};

/** The cards the settings page is built from. */
export const SYSTEM_DEFAULT_GROUPS = [
  {
    key: "application",
    name: "Default Aplikasi",
    desc: "Berlaku untuk seluruh pengguna.",
    icon: "gear",
  },
  {
    key: "fx",
    name: "Selisih Kurs",
    desc:
      "Account tempat selisih kurs dicatat: gap antara nilai kewajiban saat " +
      "diakui dan harga currency yang dipakai melunasinya. Hanya terpakai " +
      "ketika dokumen mata uang asing diposting.",
    icon: "coin",
  },
  {
    key: "equity_pl",
    name: "Laba/Rugi pada Ekuitas",
    desc:
      "Dua account ekuitas. Tahun Sebelumnya adalah tujuan posting saat " +
      "Fiscal Year ditutup, dan di bawahnya Neraca menampilkan laba rugi tiap " +
      "tahun yang belum ditutup; Tahun Berjalan adalah baris Neraca yang " +
      "nilainya dihitung, tidak pernah diposting.",
    icon: "calc",
  },
] as const satisfies readonly SystemDefaultGroup[];

export type SystemDefaultDef = {
  key: SystemDefaultKey;
  /** Indonesian label shown on the settings page. */
  name: string;
  help: string;
  icon: IconName;
  /** A `ref` setting stores the referenced row's id as text. */
  type: "ref";
  /** Registry entity key the value points at. */
  ref: SystemDefaultRef;
  group: SystemDefaultGroupKey;
};

export const SYSTEM_DEFAULTS = [
  {
    key: "default_currency",
    name: "Currency Default",
    icon: "coin",
    type: "ref",
    ref: "ref_currency",
    group: "application",
    help: "mengisi pilihan Currency lebih dulu",
  },

  // ------------------------------------------------------------------ fx
  //
  // One account rather than a gain and a loss. A gain and a loss are the same
  // fact with opposite signs — the same payment produces one or the other
  // depending on which kurs was used — so netting them in one account is what
  // an accountant expects.
  {
    key: "fx_account",
    name: "Account Selisih Kurs",
    icon: "coin",
    type: "ref",
    ref: "acc_account",
    group: "fx",
    help: "hanya terpakai saat dokumen mata uang asing diposting",
  },

  // ---------------------------------------------------------- equity / P&L
  //
  // The **accumulated** account is a posting target: it is where a Fiscal
  // Year's result lands when the year is closed. It is also where the Neraca
  // anchors one computed line per year not closed yet, printed directly
  // beneath it. The **current** account is never posted to at all: the Neraca
  // places the reported year's result to date on it. Both are real accounts so
  // that the user decides what the lines are called and where they sit, by
  // editing the account; the report computes the figures.
  {
    key: "accumulated_pl_account",
    name: "Account Laba/Rugi Tahun Sebelumnya",
    icon: "hist",
    type: "ref",
    ref: "acc_account",
    group: "equity_pl",
    help: "tujuan posting saat Fiscal Year ditutup",
  },
  {
    key: "current_pl_account",
    name: "Account Laba/Rugi Tahun Berjalan",
    icon: "calc",
    type: "ref",
    ref: "acc_account",
    group: "equity_pl",
    help: "baris penyajian Neraca, tidak pernah diposting",
  },
] as const satisfies readonly SystemDefaultDef[];

/** What each key is set to; a key that has never been set reads as null. */
export type SystemDefaultValues = Record<SystemDefaultKey, string | null>;

export const EMPTY_SYSTEM_DEFAULTS: SystemDefaultValues = {
  default_currency: null,
  fx_account: null,
  accumulated_pl_account: null,
  current_pl_account: null,
};

export function isSystemDefaultKey(key: string): key is SystemDefaultKey {
  return SYSTEM_DEFAULTS.some((d) => d.key === key);
}

export function systemDefaultDef(key: SystemDefaultKey): SystemDefaultDef {
  return SYSTEM_DEFAULTS.find((d) => d.key === key)!;
}

/** The settings belonging to one card, in catalogue order. */
export function systemDefaultsIn(
  group: SystemDefaultGroupKey
): readonly SystemDefaultDef[] {
  return SYSTEM_DEFAULTS.filter((d) => d.group === group);
}

/** A ref setting's value as a row id, or null when unset or unparseable. */
export function refValueOf(
  values: SystemDefaultValues,
  key: SystemDefaultKey
): number | null {
  const raw = values[key];
  if (raw == null || raw === "") return null;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}
