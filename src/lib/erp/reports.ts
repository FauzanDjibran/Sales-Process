/**
 * The report catalogue — every Report View in the application, declared once.
 *
 * A **Report View** is a screen whose whole purpose is to show a report: it is
 * parameterised, it restates what it was run for, it reconciles its own
 * arithmetic, and it never writes. The convention is recorded in CLAUDE.md §12;
 * this file is its index.
 *
 * Declared in code rather than in a table for the same reason the permission
 * catalogue is: a report is a page somebody wrote, so a row created at runtime
 * would name a report that does not exist. `sys_*` holds no report definitions.
 *
 * Client-safe on purpose — no `server-only` and no database import — so the
 * navigation, the route and the page body all read the same entry.
 */
import type { IconName } from "@/components/icon";
import type { PermissionCode } from "./permissions";

/**
 * Which parameters a report takes.
 *
 * Each set below is one shape of filter. A new one arrives
 * when a report needs different parameters — as an added member here, so the
 * route keeps resolving parameters in one place rather than each report parsing
 * the query string its own way.
 */
export type ReportParams =
  | "cash-bank-period"
  | "account-period"
  /**
   * A date range, nothing else — the Trial Balance, whose subject is every
   * account by definition. `?all=1` lists the silent ones too.
   */
  | "period"
  /**
   * A fiscal year and a period in it, optionally a second pair to compare
   * against — the financial statements. Always a period viewpoint: a Laba Rugi
   * or a Neraca is read for a month of a year, never for two arbitrary dates.
   */
  | "fiscal-period"
  /** An optional customer and the one date the figures stand at (P75). */
  | "ar-asof"
  /** One customer and a date range — a book of that customer (P75). */
  | "ar-period"
  /** An optional supplier and the one date the figures stand at (B33). */
  | "ap-asof"
  /** One supplier and a date range — a book of that supplier (B33). */
  | "ap-period"
  /** One item, optionally a warehouse, and a date range — a stock card (P120). */
  | "stock-period"
  /** Optionally an item and a warehouse, and the one date the stock stands at (P120). */
  | "stock-asof"
  /** A fiscal period — the month — and optionally one Cost Center (P154, M90). */
  | "production-cost-period";

export type ReportDef = {
  key: string;
  /** URL segment under the module's `report/` namespace. */
  slug: string;
  module: "finance" | "accounting" | "inventory" | "production";
  name: string;
  /** Singular subject line shown under the title. */
  desc: string;
  icon: IconName;
  permission: PermissionCode;
  params: ReportParams;
  /** Whether the report can run without a subject chosen. */
  subjectRequired: boolean;
};

const FIXED_REPORTS = [
  {
    key: "cash_bank_ledger",
    slug: "cash-bank-ledger",
    module: "finance",
    name: "Buku Kas & Bank",
    desc:
      "Seluruh mutasi satu resource kas atau bank pada rentang tanggal yang dipilih, " +
      "lengkap dengan saldo awal dan saldo akhir.",
    icon: "book",
    permission: "REPORT_CASH_BANK_LEDGER_VIEW",
    params: "cash-bank-period",
    // A book is a book *of* something: without a resource there is nothing to
    // show, so the report asks before it runs.
    subjectRequired: true,
  },
  {
    key: "cash_bank_balance",
    slug: "cash-bank-balance",
    module: "finance",
    name: "Saldo Kas & Bank",
    desc:
      "Saldo awal, total penerimaan, total pengeluaran, dan saldo akhir setiap " +
      "resource kas dan bank pada rentang tanggal yang dipilih.",
    icon: "wallet",
    permission: "REPORT_CASH_BANK_BALANCE_VIEW",
    params: "cash-bank-period",
    // Every resource at once is the useful default; narrowing to one is a
    // filter, not a precondition.
    subjectRequired: false,
  },
  {
    key: "ar_ledger",
    slug: "ar-ledger",
    module: "finance",
    name: "Buku Piutang",
    desc:
      "Setiap perubahan AR item satu customer pada rentang tanggal — invoice, uang muka " +
      "dan pembayarannya — dengan posisi Piutang Usaha awal dan akhir.",
    icon: "book",
    permission: "REPORT_AR_LEDGER_VIEW",
    params: "ar-period",
    // A book is a book *of* someone.
    subjectRequired: true,
  },
  {
    key: "ar_aging",
    slug: "ar-aging",
    module: "finance",
    name: "Umur Piutang",
    desc:
      "Invoice yang belum lunas per customer menurut umur jatuh temponya, beserta uang " +
      "muka yang masih dipegang dan posisi bersihnya.",
    icon: "clock",
    permission: "REPORT_AR_AGING_VIEW",
    params: "ar-asof",
    subjectRequired: false,
  },
  {
    key: "customer_advance",
    slug: "customer-advance",
    module: "finance",
    name: "Uang Muka Customer",
    desc:
      "Uang muka yang sudah diterima dan belum dipakai invoice, per customer dan Sales " +
      "Order, dicocokkan dengan account Uang Muka Penjualan.",
    icon: "wallet",
    permission: "REPORT_CUSTOMER_ADVANCE_VIEW",
    params: "ar-asof",
    subjectRequired: false,
  },
  {
    key: "ap_ledger",
    slug: "ap-ledger",
    module: "finance",
    name: "Buku Hutang",
    desc: "Setiap perubahan AP item satu supplier pada rentang tanggal — invoice, uang muka dan pembayarannya — dengan posisi Hutang Usaha awal dan akhir.",
    icon: "book",
    permission: "REPORT_AP_LEDGER_VIEW",
    params: "ap-period",
    subjectRequired: true,
  },
  {
    key: "ap_aging",
    slug: "ap-aging",
    module: "finance",
    name: "Umur Hutang",
    desc: "Invoice pembelian yang belum lunas per supplier menurut umur jatuh temponya, beserta uang muka yang sudah dibayar dan posisi bersihnya.",
    icon: "clock",
    permission: "REPORT_AP_AGING_VIEW",
    params: "ap-asof",
    subjectRequired: false,
  },
  {
    key: "supplier_advance",
    slug: "supplier-advance",
    module: "finance",
    name: "Uang Muka Supplier",
    desc: "Uang muka yang sudah dibayar ke supplier dan belum dipakai invoice, per supplier dan Purchase Order, dicocokkan dengan account Uang Muka Pembelian.",
    icon: "wallet",
    permission: "REPORT_SUPPLIER_ADVANCE_VIEW",
    params: "ap-asof",
    subjectRequired: false,
  },
  {
    key: "stock_ledger",
    slug: "stock-ledger",
    module: "inventory",
    name: "Kartu Stok",
    desc: "Mutasi jumlah per barang per gudang pada rentang tanggal, dengan saldo awal dan akhir — dikelompokkan per barang atau per gudang.",
    icon: "book",
    permission: "REPORT_STOCK_LEDGER_VIEW",
    params: "stock-period",
    // Each card is one item in one warehouse; none chosen reads every card.
    subjectRequired: false,
  },
  {
    key: "stock_balance",
    slug: "stock-balance",
    module: "inventory",
    name: "Saldo Stok",
    desc: "Jumlah per barang per gudang, dengan lot di baliknya, pada satu tanggal — dikelompokkan per barang atau per gudang.",
    icon: "layers",
    permission: "REPORT_STOCK_BALANCE_VIEW",
    params: "stock-asof",
    subjectRequired: false,
  },
  {
    key: "stock_valuation_ledger",
    slug: "stock-valuation-ledger",
    module: "inventory",
    name: "Kartu Nilai Persediaan",
    desc: "Setiap mutasi jumlah dan nilai satu barang pada rentang tanggal, dengan saldo dan harga rata-rata setelahnya.",
    icon: "book",
    permission: "REPORT_STOCK_VALUATION_LEDGER_VIEW",
    params: "stock-period",
    subjectRequired: true,
  },
  {
    key: "stock_valuation",
    slug: "stock-valuation",
    module: "inventory",
    name: "Nilai Persediaan",
    desc: "Jumlah, nilai dan harga rata-rata per barang pada satu tanggal, dicocokkan dengan account Persediaan.",
    icon: "coin",
    permission: "REPORT_STOCK_VALUATION_VIEW",
    params: "stock-asof",
    subjectRequired: false,
  },
  {
    key: "general_ledger",
    slug: "general-ledger",
    module: "accounting",
    name: "General Ledger",
    desc:
      "Mutasi setiap account yang dipilih pada rentang tanggal, lengkap dengan saldo " +
      "awal dan saldo akhir — satu tabel per account.",
    icon: "tree",
    permission: "REPORT_GENERAL_LEDGER_VIEW",
    params: "account-period",
    // A ledger is a ledger *of* an account: without one there is nothing to
    // show. Several at once is the point, but zero is not a run.
    subjectRequired: true,
  },
  {
    key: "trial_balance",
    slug: "trial-balance",
    module: "accounting",
    name: "Trial Balance",
    desc:
      "Saldo awal, mutasi debit, mutasi kredit, dan saldo akhir seluruh account pada " +
      "rentang tanggal, per tipe dan kelompok — dengan uji keseimbangan debit dan kredit.",
    icon: "calc",
    permission: "REPORT_TRIAL_BALANCE_VIEW",
    params: "period",
    // Every account at once is the whole idea of a trial balance.
    subjectRequired: false,
  },
  {
    key: "profit_loss",
    slug: "profit-loss",
    module: "accounting",
    name: "Laba Rugi",
    desc:
      "Pendapatan, harga pokok dan beban per periode tahun buku — " +
      "bertingkat sampai Laba Bersih, dengan pembanding opsional.",
    icon: "trend",
    permission: "REPORT_PROFIT_LOSS_VIEW",
    params: "fiscal-period",
    // The statement covers the whole chart; the period is what is chosen, and
    // the route defaults it to the latest one.
    subjectRequired: false,
  },
  {
    key: "balance_sheet",
    slug: "balance-sheet",
    module: "accounting",
    name: "Neraca",
    desc:
      "Aktiva, pasiva dan ekuitas pada akhir periode tahun buku, " +
      "dengan laba rugi yang belum ditutup di ekuitas dan pembanding opsional.",
    icon: "scale",
    permission: "REPORT_BALANCE_SHEET_VIEW",
    params: "fiscal-period",
    subjectRequired: false,
  },
  // Cost per Cost Center (P154, M90): read for one month — a fiscal period —
  // because the close spreads one period's pool; journal lines are the source.
  {
    key: "cost_center",
    slug: "cost-center",
    module: "production",
    name: "Laporan Cost Center",
    desc: "Biaya per Cost Center dan account dalam satu bulan — saldo awal, debit, kredit, saldo akhir — dengan baris journalnya.",
    icon: "book",
    permission: "REPORT_COST_CENTER_VIEW",
    params: "production-cost-period",
    subjectRequired: false,
  },
] as const satisfies readonly ReportDef[];

export const REPORTS: readonly ReportDef[] = FIXED_REPORTS;

export type ReportKey = (typeof FIXED_REPORTS)[number]["key"];

const BY_SLUG = new Map<string, ReportDef>(REPORTS.map((r) => [r.slug, r]));

export function reportBySlug(slug: string): ReportDef | undefined {
  return BY_SLUG.get(slug);
}

/** `/finance/report/cash-bank-ledger` — the one place a report URL is built. */
export function reportHref(
  slug: string,
  params?: Record<string, string | number | null | undefined>
): string {
  const base = `/${BY_SLUG.get(slug)?.module ?? "finance"}/report/${slug}`;
  if (!params) return base;
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== null && value !== undefined && value !== "") {
      query.set(key, String(value));
    }
  }
  const search = query.toString();
  return search ? `${base}?${search}` : base;
}
