/**
 * Navigation model: modules, the groups inside them, and the entities inside
 * those. Each registry entity declares its own module and group, so this file
 * describes the shape of the menu and nothing about the entities themselves.
 */
import type { IconName } from "@/components/icon";
import type { PermissionCode } from "./permissions";

export type NavEntity = {
  key: string;
  /** URL segment under the module. */
  slug: string;
  name: string;
  /** Singular form, when it differs from `name`. */
  single?: string;
  icon: IconName;
  desc: string;
  /**
   * Permission required to see this leaf. Omitted only where the destination is
   * open to every signed-in user — the profile, which is about who you are
   * rather than what you may do.
   */
  permission?: PermissionCode;
};

export type NavGroup = {
  key: string;
  name: string;
  entities: NavEntity[];
};

export type NavModule = {
  key: string;
  name: string;
  icon: IconName;
  desc: string;
  /** Menu access is its own permission, separate from any action inside. */
  permission?: PermissionCode;
  /** A module with no groups is a single page (the dashboard). */
  groups?: NavGroup[];
};

export const MODULES: NavModule[] = [
  {
    key: "dashboard",
    name: "Dashboard",
    icon: "grid",
    desc: "Ringkasan aplikasi. Dasbor penjualan menyusul.",
    permission: "MENU_DASHBOARD_ACCESS",
  },
  {
    key: "master",
    name: "Master",
    icon: "book",
    desc: "Sumber referensi untuk seluruh modul.",
    permission: "MENU_MASTER_ACCESS",
    groups: [
      {
        key: "entity",
        name: "Entitas",
        entities: [
          {
            key: "m_partner",
            slug: "partner",
            name: "Partner",
            icon: "users",
            desc: "Pelanggan dan pemasok — subjek posisi per Partner pada jurnal dan General Ledger.",
            permission: "PARTNER_VIEW",
          },
          {
            key: "m_item",
            slug: "item",
            name: "Item",
            icon: "box",
            desc: "Barang dan jasa yang dijual. Harga dan perlakuan pajak ditentukan pada transaksi.",
            permission: "ITEM_VIEW",
          },
          {
            key: "m_cash_bank",
            slug: "cash-bank",
            name: "Cash & Bank",
            icon: "wallet",
            desc: "Resource tempat uang berada. Setiap Cash Bank memiliki Cash Bank Book sendiri.",
            permission: "CASH_BANK_VIEW",
          },
          {
            key: "ref_warehouse",
            slug: "warehouse",
            name: "Gudang",
            icon: "build",
            desc: "Tempat barang disimpan. Stok dicatat per gudang, lot dan status di Persediaan.",
            permission: "WAREHOUSE_VIEW",
          },
        ],
      },
      {
        key: "reference",
        name: "Referensi",
        entities: [
          {
            key: "ref_currency",
            slug: "currency",
            name: "Currency",
            icon: "coin",
            desc: "Referensi mata uang. Base currency pelaporan adalah IDR; transaction currency dan base currency tetap dipisah.",
            permission: "CURRENCY_VIEW",
          },
          {
            key: "ref_uom",
            slug: "uom",
            name: "Satuan",
            icon: "tags",
            desc: "Satuan hitung barang (PCS, BOX, SET). Konversi antarsatuan ditentukan per barang.",
            permission: "UOM_VIEW",
          },
          {
            key: "ref_payment_term",
            slug: "payment-term",
            name: "Termin Pembayaran",
            icon: "cal",
            desc: "Berapa hari customer boleh membayar setelah tanggal invoice. 0 hari berarti Tunai.",
            permission: "PAYMENT_TERM_VIEW",
          },
          {
            key: "ref_withholding_tax",
            slug: "withholding-tax",
            name: "Jenis PPh",
            icon: "calc",
            desc: "PPh yang dipotong atau dipungut customer saat membayar: tarif, objek pajak dan akun PPh dibayar dimuka.",
            permission: "WITHHOLDING_TAX_VIEW",
          },
        ],
      },
    ],
  },
  {
    key: "sales",
    name: "Penjualan",
    icon: "tags",
    desc: "Dokumen penjualan, dari pesanan sampai penagihan.",
    permission: "MENU_SALES_ACCESS",
    groups: [
      {
        key: "document",
        name: "Dokumen",
        entities: [
          {
            key: "sal_customer_order",
            slug: "customer-order",
            name: "Customer Order",
            icon: "clip",
            desc: "Pesanan barang dari customer: jumlah dan nilai komersialnya. Tidak memposting apa pun; menjadi dasar uang muka, invoice dan Sales Order.",
            permission: "CUSTOMER_ORDER_VIEW",
          },
          {
            key: "sal_order",
            slug: "order",
            name: "Sales Order",
            icon: "cal",
            desc: "Bagian Customer Order yang dilepas ke PPIC dengan tanggal kirim. Hanya jumlah; tidak memposting apa pun.",
            permission: "SALES_ORDER_VIEW",
          },
          {
            key: "sal_delivery_order",
            slug: "delivery-order",
            name: "Delivery Order",
            icon: "truck",
            desc: "Perintah kirim ke gudang: barang dari Sales Order Open satu Customer Order, ke satu alamat. Tidak memposting apa pun.",
            permission: "DELIVERY_ORDER_VIEW",
          },
        ],
      },
    ],
  },
  {
    // Purchase Request → Purchase Order (P121, P123). Goods and money
    // documents of purchasing sit under Logistik and Finance, as for sales.
    key: "purchasing",
    name: "Pembelian",
    icon: "clip",
    desc: "Dokumen pembelian, dari permintaan sampai pesanan ke supplier.",
    permission: "MENU_PURCHASING_ACCESS",
    groups: [
      {
        key: "request",
        name: "Permintaan",
        entities: [
          {
            key: "pur_request_goods",
            slug: "request/goods",
            name: "Purchase Request Barang",
            icon: "box",
            desc: "Permintaan barang dalam satuan dasarnya dan tanggal dibutuhkan. Tidak memposting apa pun; menjadi dasar Purchase Order.",
            permission: "PURCHASE_REQUEST_VIEW",
          },
          {
            key: "pur_request_service",
            slug: "request/service",
            name: "Purchase Request Jasa",
            icon: "tags",
            desc: "Permintaan jasa dan tanggal dibutuhkan. Tidak memposting apa pun; menjadi dasar Purchase Order.",
            permission: "PURCHASE_REQUEST_VIEW",
          },
        ],
      },
    ],
  },
  {
    // Standalone goods documents serving more than one flow, chosen by purpose (P106).
    key: "logistics",
    name: "Logistik",
    icon: "truck",
    desc: "Dokumen barang yang dipakai lebih dari satu proses, dipilih menurut tujuannya.",
    permission: "MENU_LOGISTICS_ACCESS",
    groups: [
      {
        key: "document",
        name: "Dokumen",
        entities: [
          {
            key: "log_delivery_note",
            slug: "delivery-note",
            name: "Delivery Note",
            icon: "truck",
            desc: "Surat jalan: barang keluar dari gudang menurut tujuannya — untuk penjualan, dari Delivery Order. Posting mengakui HPP; piutang diakui di Invoice.",
            permission: "DELIVERY_NOTE_VIEW",
          },
        ],
      },
    ],
  },
  {
    // The stock books (P120): what is where, and what it is worth.
    key: "inventory",
    name: "Persediaan",
    icon: "box",
    desc: "Buku stok per gudang dan lot, dan nilai persediaan rata-rata bergerak per barang.",
    permission: "MENU_INVENTORY_ACCESS",
    groups: [
      {
        key: "report",
        name: "Laporan",
        entities: [
          {
            key: "report_stock_ledger",
            slug: "report/stock-ledger",
            name: "Kartu Stok",
            icon: "book",
            desc: "Mutasi jumlah satu barang per gudang dan lot pada rentang tanggal.",
            permission: "REPORT_STOCK_LEDGER_VIEW",
          },
          {
            key: "report_stock_balance",
            slug: "report/stock-balance",
            name: "Saldo Stok",
            icon: "layers",
            desc: "Jumlah per barang, gudang, lot dan status pada satu tanggal.",
            permission: "REPORT_STOCK_BALANCE_VIEW",
          },
          {
            key: "report_stock_valuation_ledger",
            slug: "report/stock-valuation-ledger",
            name: "Kartu Nilai Persediaan",
            icon: "book",
            desc: "Mutasi jumlah dan nilai rata-rata bergerak satu barang pada rentang tanggal.",
            permission: "REPORT_STOCK_VALUATION_LEDGER_VIEW",
          },
          {
            key: "report_stock_valuation",
            slug: "report/stock-valuation",
            name: "Nilai Persediaan",
            icon: "coin",
            desc: "Jumlah, nilai dan harga rata-rata per barang pada satu tanggal, dicocokkan dengan account Persediaan.",
            permission: "REPORT_STOCK_VALUATION_VIEW",
          },
        ],
      },
    ],
  },
  {
    key: "finance",
    name: "Finance",
    icon: "wallet2",
    desc: "Penerimaan kas & bank, uang muka, Buku Kas & Bank dan laporannya.",
    permission: "MENU_FINANCE_ACCESS",
    groups: [
      {
        key: "cash_bank",
        name: "Kas & Bank",
        entities: [
          {
            key: "fin_cash_receipt",
            slug: "cash-bank/receipt",
            name: "Penerimaan",
            single: "Penerimaan Kas & Bank",
            icon: "down",
            desc: "Dana masuk ke kas atau bank. Tujuannya menentukan dokumen yang diselesaikan dan journal yang dibentuk.",
            permission: "CASH_RECEIPT_VIEW",
          },
        ],
      },
      {
        // What bills the customer belongs to Finance; Sales holds only orders (P107).
        key: "invoice",
        name: "Invoice",
        entities: [
          {
            key: "fin_ar_invoice",
            slug: "invoice/sales",
            name: "Invoice Penjualan",
            icon: "file",
            desc: "Tagihan atas barang yang sudah dikirim: baris Delivery Note yang diposting, dipotong uang muka. Posting mengakui piutang, penjualan dan PPN.",
            permission: "SALES_INVOICE_VIEW",
          },
        ],
      },
      {
        key: "advance",
        name: "Uang Muka",
        entities: [
          {
            key: "fin_ar_advance",
            slug: "advance/sales",
            name: "Uang Muka Penjualan",
            icon: "wallet",
            desc: "Tagihan uang muka ke customer atas Customer Order. Tidak memposting apa pun; pembayarannya dicatat di Penerimaan Kas & Bank.",
            permission: "SALES_ADVANCE_VIEW",
          },
        ],
      },
      {
        key: "report",
        name: "Laporan",
        entities: [
          {
            key: "report_cash_bank_ledger",
            slug: "report/cash-bank-ledger",
            name: "Buku Kas & Bank",
            icon: "book",
            desc: "Seluruh mutasi satu resource kas atau bank pada rentang tanggal yang dipilih.",
            permission: "REPORT_CASH_BANK_LEDGER_VIEW",
          },
          {
            key: "report_ar_ledger",
            slug: "report/ar-ledger",
            name: "Buku Piutang",
            icon: "book",
            desc: "Riwayat AR item satu customer — invoice, uang muka dan pembayarannya.",
            permission: "REPORT_AR_LEDGER_VIEW",
          },
          {
            key: "report_ar_aging",
            slug: "report/ar-aging",
            name: "Umur Piutang",
            icon: "clock",
            desc: "Invoice belum lunas menurut umur jatuh tempo, per customer.",
            permission: "REPORT_AR_AGING_VIEW",
          },
          {
            key: "report_customer_advance",
            slug: "report/customer-advance",
            name: "Uang Muka Customer",
            icon: "wallet",
            desc: "Uang muka diterima yang belum dipakai invoice, per customer dan Customer Order.",
            permission: "REPORT_CUSTOMER_ADVANCE_VIEW",
          },
          {
            key: "report_cash_bank_balance",
            slug: "report/cash-bank-balance",
            name: "Saldo Kas & Bank",
            icon: "wallet",
            desc: "Saldo awal, penerimaan, pengeluaran, dan saldo akhir setiap resource kas dan bank.",
            permission: "REPORT_CASH_BANK_BALANCE_VIEW",
          },
        ],
      },
    ],
  },
  {
    key: "accounting",
    name: "Accounting",
    icon: "calc",
    desc: "Bagan akun, journal, buku besar, dan kendali periode.",
    permission: "MENU_ACCOUNTING_ACCESS",
    groups: [
      {
        key: "coa",
        name: "Chart of Accounts",
        entities: [
          {
            key: "acc_account",
            slug: "account",
            name: "Chart of Accounts",
            single: "Account",
            icon: "book",
            desc: "Bagan akun perusahaan. Account adalah subjek utama General Ledger.",
            permission: "ACCOUNT_VIEW",
          },
        ],
      },
      {
        key: "journal",
        name: "Journal",
        entities: [
          {
            key: "acc_journal",
            slug: "journal",
            name: "Journal",
            single: "Journal",
            icon: "book",
            desc: "Journal dari posting dokumen, dan Journal Manual untuk entri yang tidak berasal dari dokumen. Final setelah diposting.",
            permission: "JOURNAL_VIEW",
          },
        ],
      },
      {
        key: "report",
        name: "Laporan",
        entities: [
          {
            key: "report_general_ledger",
            slug: "report/general-ledger",
            name: "General Ledger",
            icon: "tree",
            desc: "Mutasi dan saldo setiap account pada rentang tanggal yang dipilih, satu tabel per account.",
            permission: "REPORT_GENERAL_LEDGER_VIEW",
          },
          {
            key: "report_trial_balance",
            slug: "report/trial-balance",
            name: "Trial Balance",
            icon: "calc",
            desc: "Saldo awal, mutasi debit, mutasi kredit, dan saldo akhir seluruh account — dengan uji keseimbangan debit dan kredit.",
            permission: "REPORT_TRIAL_BALANCE_VIEW",
          },
          {
            key: "report_profit_loss",
            slug: "report/profit-loss",
            name: "Laba Rugi",
            icon: "trend",
            desc: "Laba rugi bertingkat per periode tahun buku, dengan pembanding opsional.",
            permission: "REPORT_PROFIT_LOSS_VIEW",
          },
          {
            key: "report_balance_sheet",
            slug: "report/balance-sheet",
            name: "Neraca",
            icon: "scale",
            desc: "Aktiva, pasiva dan ekuitas pada akhir periode tahun buku, dengan pembanding opsional.",
            permission: "REPORT_BALANCE_SHEET_VIEW",
          },
        ],
      },
      {
        key: "fiscal",
        name: "Period Control",
        entities: [
          {
            key: "acc_fiscal_year",
            slug: "fiscal-year",
            name: "Fiscal Year",
            icon: "cal",
            desc: "Tahun buku. Periode bulanan di dalamnya dibuat otomatis saat tahun buku diaktifkan.",
            permission: "FISCAL_YEAR_VIEW",
          },
          {
            key: "acc_fiscal_closing",
            slug: "closing",
            name: "Fiscal Year Closing",
            icon: "lock",
            desc: "Menutup satu tahun buku: memindahkan hasil tahun berjalan ke ekuitas dan membuat Opening Balance tahun berikutnya.",
            permission: "FISCAL_YEAR_CLOSE",
          },
          {
            key: "acc_opening_balance",
            slug: "opening-balance",
            name: "Opening Balance",
            icon: "file",
            desc: "Posisi setiap account pada awal tahun buku. Dokumen final — ditulis oleh penutupan tahun buku, bukan diisi sendiri.",
            permission: "OPENING_BALANCE_VIEW",
          },
        ],
      },
      {
        key: "setting",
        name: "Pengaturan",
        entities: [
          {
            key: "account_mapping",
            slug: "account-mapping",
            name: "Account Mapping",
            icon: "link",
            desc: "Account tujuan tiap jenis posting: selisih kurs dan laba/rugi pada ekuitas, lalu piutang, uang muka dan pajak saat dokumennya dibangun.",
            permission: "MENU_ACCOUNT_MAPPING_ACCESS",
          },
          {
            key: "item_category_account",
            slug: "item-category-account",
            name: "Account Kategori Item",
            icon: "link",
            desc: "Account Persediaan, HPP dan Beban per Kategori Item; yang kosong memakai Account Mapping.",
            permission: "MENU_ACCOUNT_MAPPING_ACCESS",
          },
        ],
      },
    ],
  },
  {
    key: "tax",
    name: "Pajak",
    icon: "scale",
    desc: "Faktur pajak keluaran dan bukti potong PPh yang terbentuk otomatis dari penerimaan dan invoice.",
    permission: "MENU_TAX_ACCESS",
    groups: [
      {
        key: "document",
        name: "Dokumen Pajak",
        entities: [
          {
            key: "tax_faktur",
            slug: "faktur",
            name: "Faktur Pajak Keluaran",
            icon: "tags",
            desc: "Faktur pajak dari penerimaan uang muka ber-PPN dan invoice penjualan. Diupload ke Coretax paling lambat tanggal 15 bulan berikutnya.",
            permission: "TAX_FAKTUR_VIEW",
          },
          {
            key: "tax_withholding_slip",
            slug: "withholding-slip",
            name: "Bukti Potong PPh",
            icon: "scale",
            desc: "PPh yang dipotong customer dari pembayarannya, menunggu bukti potong (BPPU). Tanpa bukti potong, PPh tidak dapat dikreditkan.",
            permission: "TAX_SLIP_VIEW",
          },
        ],
      },
    ],
  },
  {
    key: "settings",
    name: "Pengaturan",
    icon: "gear",
    desc: "Pengguna, hak akses, dan akun Anda sendiri.",
    permission: "MENU_SETTINGS_ACCESS",
    groups: [
      {
        key: "access",
        name: "Kontrol Akses",
        entities: [
          {
            key: "sys_user",
            slug: "user",
            name: "User",
            icon: "user",
            desc: "Akun yang dapat masuk ke aplikasi. Akses setiap user ditentukan oleh Role yang diberikan kepadanya.",
            permission: "MENU_USER_ACCESS",
          },
          {
            key: "sys_role",
            slug: "role",
            name: "Role",
            icon: "tags",
            desc: "Kumpulan permission. Role adalah satu-satunya jalur pemberian akses kepada user.",
            permission: "MENU_ROLE_ACCESS",
          },
        ],
      },
      {
        key: "klasifikasi",
        name: "Klasifikasi",
        entities: [
          {
            key: "sys_partner_category",
            slug: "partner-category",
            name: "Partner Category",
            icon: "users",
            desc: "Jenis Partner — Customer dan Supplier. Account yang wajib Partner menyebut satu Partner Category.",
            permission: "PARTNER_CATEGORY_VIEW",
          },
        ],
      },
      {
        key: "system",
        name: "Sistem",
        entities: [
          {
            key: "sys_setting",
            slug: "system-default",
            name: "System Default",
            icon: "gear",
            desc: "Konfigurasi seluruh aplikasi: Base Currency dan tarif PPN. Account tujuan posting ada di Accounting › Account Mapping.",
            permission: "MENU_SYSTEM_DEFAULT_ACCESS",
          },
        ],
      },
      {
        key: "account",
        name: "Akun Saya",
        entities: [
          {
            key: "profile",
            slug: "profile",
            name: "Profil Saya",
            icon: "user",
            desc: "Data akun Anda sendiri dan ringkasan akses yang Anda miliki.",
          },
        ],
      },
    ],
  },
];

export function moduleByKey(key: string): NavModule | undefined {
  return MODULES.find((m) => m.key === key);
}

/**
 * The navigation a given set of permissions can see.
 *
 * Menu visibility mirrors authorization but never substitutes for it: every
 * page and every Server Action behind these links checks for itself. A module
 * whose leaves are all hidden disappears rather than leading to a refusal.
 */
export function visibleModules(permissions: Iterable<string>): NavModule[] {
  const held = permissions instanceof Set ? permissions : new Set(permissions);
  const allowed = (code?: string) => !code || held.has(code);

  const out: NavModule[] = [];
  for (const mod of MODULES) {
    if (!allowed(mod.permission)) continue;
    if (!mod.groups) {
      out.push(mod);
      continue;
    }
    const groups = mod.groups
      .map((g) => ({ ...g, entities: g.entities.filter((e) => allowed(e.permission)) }))
      .filter((g) => g.entities.length > 0);
    if (groups.length) out.push({ ...mod, groups });
  }
  return out;
}

/** Where a signed-in user should land, given what they can see. */
export function landingHref(permissions: Iterable<string>): string {
  const visible = visibleModules(permissions);
  const first = visible[0];
  if (!first) return "/settings/profile";
  if (!first.groups) return `/${first.key}`;
  const leaf = first.groups[0]?.entities[0];
  return leaf ? entityHref(first.key, leaf.slug) : `/${first.key}`;
}

export function entityHref(moduleKey: string, slug: string): string {
  return `/${moduleKey}/${slug}`;
}

/**
 * Finds the module/group/entity that owns a pathname like `/master/partner`.
 *
 * The slug is matched against the **whole** tail after the module, not just its
 * first segment, because a Report View's slug spans two (`report/cash-bank-ledger`).
 * Deeper paths still resolve to the entity that owns them — `/master/partner/12`
 * and `/accounting/journal/5` both land on their list entity — and the longest
 * matching slug wins, so an entity whose slug is a prefix of another's can never
 * swallow it.
 */
export function resolvePath(pathname: string) {
  const [, moduleKey, ...rest] = pathname.split("/");
  const mod = moduleByKey(moduleKey ?? "");
  if (!mod) return { module: undefined, group: undefined, entity: undefined };

  const tail = rest.join("/");
  let best: { group: NavGroup; entity: NavEntity } | null = null;

  for (const group of mod.groups ?? []) {
    for (const entity of group.entities) {
      const matches = tail === entity.slug || tail.startsWith(`${entity.slug}/`);
      if (!matches) continue;
      if (!best || entity.slug.length > best.entity.slug.length) {
        best = { group, entity };
      }
    }
  }

  return best
    ? { module: mod, group: best.group, entity: best.entity }
    : { module: mod, group: undefined, entity: undefined };
}
