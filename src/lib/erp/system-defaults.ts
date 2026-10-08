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
  | "receivable_account"
  | "sales_revenue_account"
  | "permit_advance_account"
  | "permit_revenue_account"
  | "permit_cost_account"
  | "cogs_account"
  | "inventory_account"
  | "goods_received_account"
  | "payable_account"
  | "purchase_advance_account"
  | "input_vat_account"
  | "supplier_invoice_diff_account"
  | "supplier_invoice_tolerance"
  | "production_scrap_account"
  | "ppn_rate"
  | "ppn_dpp_other_numerator"
  | "ppn_dpp_other_denominator";

/** Which master a `ref` setting points at — a registry entity key. */
export type SystemDefaultRef = "acc_account";

/** The page a setting is edited on. */
export type SettingsPage = "default" | "account";

export type SystemDefaultGroupKey =
  | "application"
  | "tax"
  | "purchase_rules"
  | "receipt"
  | "invoice"
  | "permit"
  | "delivery"
  | "purchase"
  | "production"
  | "fx"
  | "equity_pl";

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
    key: "purchase_rules",
    page: "default",
    name: "Pembelian",
    desc:
      "Batas selisih antara total tagihan supplier dan total Invoice Pembelian " +
      "yang dihitung dari Purchase Order. Selisih sampai batas ini dicatat ke " +
      "Account Selisih Tagihan Supplier; di atasnya Invoice Pembelian tidak dapat " +
      "diposting.",
    icon: "box",
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
    key: "invoice",
    page: "account",
    name: "Invoice Penjualan",
    desc:
      "Account yang dipakai saat Invoice Penjualan diposting: piutang usaha " +
      "atas barang yang ditagih dan penjualannya. Uang Muka Penjualan dan PPN " +
      "Keluaran memakai account pada Penerimaan Penjualan.",
    icon: "file",
  },
  {
    key: "permit",
    page: "account",
    name: "Perizinan",
    desc:
      "Account yang dipakai alur Perizinan: kewajiban atas Uang Muka Perizinan " +
      "yang diterima, pendapatan saat Invoice Perizinan diposting, dan biaya " +
      "perizinan yang dibayar. PPN Keluaran dan Piutang Usaha memakai account " +
      "pada Penerimaan Penjualan dan Invoice Penjualan.",
    icon: "clip",
  },
  {
    key: "delivery",
    page: "account",
    name: "Pengiriman Barang",
    desc:
      "Account yang dipakai saat Delivery Note diposting: harga pokok barang " +
      "yang keluar dibebankan ke HPP dan mengurangi Persediaan. Dipakai untuk " +
      "barang yang Kategori Item-nya tidak menyebut account sendiri.",
    icon: "truck",
  },
  {
    key: "purchase",
    page: "account",
    name: "Pembelian",
    desc:
      "Account yang dipakai Receipt Note, Uang Muka Pembelian, Pengeluaran " +
      "Kas & Bank dan Invoice Pembelian. Persediaan dan Beban mengikuti " +
      "Kategori Item; PPh yang dipotong perusahaan memakai account pada " +
      "Jenis PPh pembelian.",
    icon: "box",
  },
  {
    key: "production",
    page: "account",
    name: "Produksi",
    desc:
      "Beban atas barang yang dimusnahkan dari produksi. WIP tidak memiliki " +
      "cadangan di sini: setiap Kategori Item yang masuk produksi harus " +
      "menentukan Account WIP-nya sendiri. Biaya tenaga kerja dan overhead " +
      "memakai Elemen Biaya Produksi.",
    icon: "gear",
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

  // ------------------------------------------------------------- invoice
  //
  // Added with the Invoice Penjualan (U22), one each for the company until the
  // Kategori Item mapping (C25) names them per category.
  {
    key: "receivable_account",
    name: "Account Piutang Usaha",
    icon: "wallet",
    type: "ref",
    ref: "acc_account",
    group: "invoice",
    help: "piutang customer atas invoice, per customer",
  },
  {
    key: "sales_revenue_account",
    name: "Account Penjualan",
    icon: "trend",
    type: "ref",
    ref: "acc_account",
    group: "invoice",
    help: "pendapatan atas barang yang ditagih",
  },

  // ------------------------------------------------------------- permit
  //
  // The Perizinan flow (P137, Perizinan-Concept.md Z22).
  {
    key: "permit_advance_account",
    name: "Account Uang Muka Perizinan",
    icon: "wallet",
    type: "ref",
    ref: "acc_account",
    group: "permit",
    help: "kewajiban atas uang muka perizinan yang diterima, per customer",
  },
  {
    key: "permit_revenue_account",
    name: "Account Pendapatan Perizinan",
    icon: "trend",
    type: "ref",
    ref: "acc_account",
    group: "permit",
    help: "pendapatan jasa pengurusan perizinan saat invoice diposting",
  },
  {
    key: "permit_cost_account",
    name: "Account Biaya Perizinan",
    icon: "coin",
    type: "ref",
    ref: "acc_account",
    group: "permit",
    help: "biaya perizinan yang dibayar sebesar realisasinya",
  },

  // ------------------------------------------------------------ delivery
  //
  // Added with the Delivery Note (U12), one each for the company until the
  // Kategori Item mapping (C25) names them per category.
  {
    key: "cogs_account",
    name: "Account HPP",
    icon: "trend",
    type: "ref",
    ref: "acc_account",
    group: "delivery",
    help: "harga pokok barang yang dikirim",
  },
  {
    key: "inventory_account",
    name: "Account Persediaan",
    icon: "box",
    type: "ref",
    ref: "acc_account",
    group: "delivery",
    help: "persediaan barang yang berkurang saat dikirim",
  },

  // ------------------------------------------------------------ purchase
  //
  // Added with the purchasing module (P121, P122), ahead of the documents
  // that post them, because they are its masters (Purchasing-Concept.md B5).
  {
    key: "supplier_invoice_tolerance",
    name: "Toleransi Selisih Tagihan Supplier (Rp)",
    icon: "scale",
    type: "number",
    decimals: 0,
    above: -1,
    atMost: 1_000_000_000,
    group: "purchase_rules",
    help: "0 berarti tagihan supplier harus sama persis",
  },
  {
    key: "goods_received_account",
    name: "Account Barang Diterima Belum Ditagih",
    icon: "box",
    type: "ref",
    ref: "acc_account",
    group: "purchase",
    help: "kliring antara Receipt Note dan Invoice Pembelian",
  },
  {
    key: "payable_account",
    name: "Account Hutang Usaha",
    icon: "wallet",
    type: "ref",
    ref: "acc_account",
    group: "purchase",
    help: "hutang ke supplier atas invoice, per supplier",
  },
  {
    key: "purchase_advance_account",
    name: "Account Uang Muka Pembelian",
    icon: "wallet",
    type: "ref",
    ref: "acc_account",
    group: "purchase",
    help: "uang muka yang dibayar ke supplier, per supplier",
  },
  {
    key: "input_vat_account",
    name: "Account PPN Masukan",
    icon: "scale",
    type: "ref",
    ref: "acc_account",
    group: "purchase",
    help: "PPN dari faktur pajak supplier",
  },
  {
    key: "supplier_invoice_diff_account",
    name: "Account Selisih Tagihan Supplier",
    icon: "calc",
    type: "ref",
    ref: "acc_account",
    group: "purchase",
    help: "selisih dalam toleransi antara tagihan supplier dan invoice",
  },

  // ----------------------------------------------------------- production
  //
  // The production module (P150). WIP has no fallback here (M62): it is the
  // Kategori Item's own, and a document refuses an item whose category names
  // none, rather than send it somewhere generic.
  {
    key: "production_scrap_account",
    name: "Account Beban Pemusnahan Produksi",
    icon: "trash",
    type: "ref",
    ref: "acc_account",
    group: "production",
    help: "nilai barang produksi yang dimusnahkan",
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
  receivable_account: null,
  sales_revenue_account: null,
  permit_advance_account: null,
  permit_revenue_account: null,
  permit_cost_account: null,
  cogs_account: null,
  inventory_account: null,
  goods_received_account: null,
  payable_account: null,
  purchase_advance_account: null,
  input_vat_account: null,
  supplier_invoice_diff_account: null,
  supplier_invoice_tolerance: null,
  production_scrap_account: null,
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
