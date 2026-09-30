/**
 * The settings catalogue — every value the application assumes, and every
 * account a posting is sent to, declared in code (Claude-ERP.md P61).
 *
 * Declared in code for the same reason the permission catalogue is: a setting
 * is a branch somewhere in the application, so one that could be created at
 * runtime would be a row nothing reads. `sys_setting` holds only what each key
 * is currently set to.
 *
 * The catalogue is one store read by **two pages**, so two different kinds of
 * decision never share a screen:
 *
 * - **System Default** (`page: "default"`) — application-wide configuration:
 *   the base currency (shown, never set — it is a constant in `currency.ts`)
 *   and the PPN rate and DPP Nilai Lain factor every taxable document
 *   snapshots (P60). Later defaults (a transit warehouse) join here.
 * - **Account Mapping** (`page: "account"`) — where a kind of posting lands:
 *   the FX difference account and the two Laba/Rugi equity accounts, one each
 *   for the one company (P9, P23). A mapping is added only when the document
 *   that posts it is built. PPh accounts stay on each Jenis PPh (P44), and
 *   item accounts on the Kategori Item mapping (C25).
 *
 * Client-safe on purpose — no `server-only`, no database import: the settings
 * forms read the same catalogue the Server Action writes against.
 */
import type { IconName } from "@/components/icon";

export type SystemDefaultKey =
  | "fx_account"
  | "accumulated_pl_account"
  | "current_pl_account"
  | "sales_advance_account"
  | "output_vat_account"
  | "bank_charge_account"
  | "ppn_rate"
  | "ppn_dpp_other_numerator"
  | "ppn_dpp_other_denominator";

/** Which master a `ref` setting points at — a registry entity key. */
export type SystemDefaultRef = "acc_account";

/** The page a setting is edited on. */
export type SettingsPage = "default" | "account";

export type SystemDefaultGroupKey = "application" | "tax" | "receipt" | "fx" | "equity_pl";

export type SystemDefaultGroup = {
  key: SystemDefaultGroupKey;
  page: SettingsPage;
  name: string;
  desc: string;
  icon: IconName;
};

/** The cards the two pages are built from, in page order. */
export const SYSTEM_DEFAULT_GROUPS = [
  {
    key: "application",
    page: "default",
    name: "Aplikasi",
    desc:
      "Berlaku untuk seluruh pengguna. Base Currency adalah mata uang tempat " +
      "seluruh buku diukur; ditetapkan sekali dan tidak dapat diubah.",
    icon: "gear",
  },
  {
    key: "tax",
    page: "default",
    name: "Pajak",
    desc:
      "Tarif PPN dan faktor DPP Nilai Lain yang berlaku. Ubah hanya saat " +
      "ketentuan pajak berubah: setiap dokumen menyalin nilai yang berlaku " +
      "saat disimpan, sehingga dokumen yang sudah ada tidak ikut berubah.",
    icon: "scale",
  },
  {
    key: "receipt",
    page: "account",
    name: "Penerimaan Penjualan",
    desc:
      "Account yang dipakai saat Penerimaan Kas & Bank diposting: kewajiban " +
      "uang muka dari customer, PPN Keluaran yang terutang, dan biaya transfer " +
      "yang dipotong bank. PPh yang dipotong customer memakai account pada " +
      "setiap Jenis PPh.",
    icon: "down",
  },
  {
    key: "fx",
    page: "account",
    name: "Selisih Kurs",
    desc:
      "Account tempat selisih kurs dicatat: gap antara nilai kewajiban saat " +
      "diakui dan harga currency yang dipakai melunasinya. Hanya terpakai " +
      "ketika dokumen mata uang asing diposting.",
    icon: "coin",
  },
  {
    key: "equity_pl",
    page: "account",
    name: "Laba/Rugi pada Ekuitas",
    desc:
      "Dua account ekuitas. Tahun Sebelumnya adalah tujuan posting saat " +
      "Fiscal Year ditutup, dan di bawahnya Neraca menampilkan laba rugi tiap " +
      "tahun yang belum ditutup; Tahun Berjalan adalah baris Neraca yang " +
      "nilainya dihitung, tidak pernah diposting.",
    icon: "calc",
  },
] as const satisfies readonly SystemDefaultGroup[];

type SystemDefaultBase = {
  key: SystemDefaultKey;
  /** Indonesian label shown on the settings page. */
  name: string;
  help: string;
  icon: IconName;
  group: SystemDefaultGroupKey;
};

export type SystemDefaultDef =
  | (SystemDefaultBase & {
      /** A `ref` setting stores the referenced row's id as text. */
      type: "ref";
      /** Registry entity key the value points at. */
      ref: SystemDefaultRef;
    })
  | (SystemDefaultBase & {
      /** A `number` setting stores a figure as text; it is never empty. */
      type: "number";
      decimals: number;
      /** Exclusive lower bound and inclusive upper bound. */
      above: number;
      atMost: number;
      /** Typed in the percent field, with its `%`. */
      percent?: boolean;
    });

export const SYSTEM_DEFAULTS = [
  // ------------------------------------------------------------------ tax
  //
  // PPN = round(Tarif PPN × round(DPP × pembilang / penyebut)) (P59, P60).
  // The factor is two whole numbers rather than a decimal because 11/12 has
  // no exact decimal form.
  {
    key: "ppn_rate",
    name: "Tarif PPN (%)",
    icon: "scale",
    type: "number",
    decimals: 2,
    above: 0,
    atMost: 100,
    percent: true,
    group: "tax",
    help: "dikalikan pada DPP Nilai Lain",
  },
  {
    key: "ppn_dpp_other_numerator",
    name: "DPP Nilai Lain — Pembilang",
    icon: "calc",
    type: "number",
    decimals: 0,
    above: 0,
    atMost: 1000,
    group: "tax",
    help: "DPP Nilai Lain = DPP × pembilang / penyebut",
  },
  {
    key: "ppn_dpp_other_denominator",
    name: "DPP Nilai Lain — Penyebut",
    icon: "calc",
    type: "number",
    decimals: 0,
    above: 0,
    atMost: 1000,
    group: "tax",
    help: "tidak boleh lebih kecil dari pembilang",
  },

  // ------------------------------------------------------------- receipt
  //
  // Added with the document that posts them (P61): Penerimaan Kas & Bank.
  {
    key: "sales_advance_account",
    name: "Account Uang Muka Penjualan",
    icon: "wallet",
    type: "ref",
    ref: "acc_account",
    group: "receipt",
    help: "kewajiban atas uang muka yang diterima, per customer",
  },
  {
    key: "output_vat_account",
    name: "Account PPN Keluaran",
    icon: "scale",
    type: "ref",
    ref: "acc_account",
    group: "receipt",
    help: "PPN yang terutang saat uang muka diterima",
  },
  {
    key: "bank_charge_account",
    name: "Account Beban Bank",
    icon: "coin",
    type: "ref",
    ref: "acc_account",
    group: "receipt",
    help: "biaya transfer yang dipotong bank",
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
  fx_account: null,
  accumulated_pl_account: null,
  current_pl_account: null,
  sales_advance_account: null,
  output_vat_account: null,
  bank_charge_account: null,
  ppn_rate: null,
  ppn_dpp_other_numerator: null,
  ppn_dpp_other_denominator: null,
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

/** The cards of one page. */
export function settingGroupsOn(page: SettingsPage): readonly SystemDefaultGroup[] {
  return SYSTEM_DEFAULT_GROUPS.filter((g) => g.page === page);
}

/** The page a key is edited on — and so which permission writes it. */
export function settingPageOf(key: SystemDefaultKey): SettingsPage {
  const group = systemDefaultDef(key).group;
  return SYSTEM_DEFAULT_GROUPS.find((g) => g.key === group)!.page;
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

/**
 * Why a `number` setting's value cannot be stored, or null. The factor's two
 * halves are checked against each other: DPP Nilai Lain never exceeds the DPP.
 */
export function numberSettingProblem(
  def: Extract<SystemDefaultDef, { type: "number" }>,
  raw: string,
  values: Partial<SystemDefaultValues>
): string | null {
  const n = Number(raw);
  if (raw.trim() === "" || !Number.isFinite(n)) return "Wajib diisi dengan angka.";
  if (def.decimals === 0 && !Number.isInteger(n)) return "Harus bilangan bulat.";
  if (!(n > def.above) || n > def.atMost) return `Harus lebih dari ${def.above} dan paling besar ${def.atMost}.`;
  if (def.key === "ppn_dpp_other_denominator") {
    const num = Number(values.ppn_dpp_other_numerator);
    if (Number.isFinite(num) && n < num) return "Penyebut tidak boleh lebih kecil dari pembilang.";
  }
  return null;
}
