/**
 * The permission catalogue — the single place every capability in the system is
 * declared.
 *
 * A permission is ONE atomic capability. Roles bundle permissions; users hold
 * roles. There is no other path to a permission, so authorization always has
 * exactly one source of truth (see CLAUDE.md §12, "RBAC is role-based only").
 *
 * Codes are stable identifiers used by business logic. Names are Indonesian UI
 * copy and may change freely — never branch on a name.
 *
 * This module is deliberately free of `server-only` and of any database import:
 * client components reference the same codes the server enforces, so the UI can
 * never drift onto a permission the server does not know about.
 *
 * Menu access and actions are separate permissions on purpose. Seeing a module
 * is not permission to create, edit, approve, reject or post inside it.
 */

export type PermissionModule =
  | "dashboard"
  | "master"
  | "sales"
  | "purchasing"
  | "logistics"
  | "inventory"
  | "accounting"
  | "finance"
  | "tax"
  | "settings";

export type PermissionDef = {
  code: string;
  /** Indonesian label shown in the role matrix. */
  name: string;
  module: PermissionModule;
  description?: string;
};

/**
 * Entries are grouped by module and, within a module, menu access first. Adding
 * a module means adding its rows here — nothing else in the catalogue changes.
 */
export const PERMISSIONS = [
  // ---------------------------------------------------------------- dashboard
  { code: "MENU_DASHBOARD_ACCESS", name: "Akses menu Dashboard", module: "dashboard" },

  // ---------------------------------------------------------------- master
  { code: "MENU_MASTER_ACCESS", name: "Akses menu Master", module: "master" },

  { code: "PARTNER_VIEW", name: "Lihat Partner", module: "master" },
  { code: "PARTNER_CREATE", name: "Tambah Partner", module: "master" },
  { code: "PARTNER_EDIT", name: "Ubah Partner", module: "master" },
  { code: "PARTNER_ACTIVATE", name: "Aktifkan Partner", module: "master" },
  { code: "PARTNER_DEACTIVATE", name: "Nonaktifkan Partner", module: "master" },

  { code: "CASH_BANK_VIEW", name: "Lihat Cash & Bank", module: "master" },
  { code: "CASH_BANK_CREATE", name: "Tambah Cash & Bank", module: "master" },
  { code: "CASH_BANK_EDIT", name: "Ubah Cash & Bank", module: "master" },
  { code: "CASH_BANK_ACTIVATE", name: "Aktifkan Cash & Bank", module: "master" },
  { code: "CASH_BANK_DEACTIVATE", name: "Nonaktifkan Cash & Bank", module: "master" },

  { code: "ITEM_VIEW", name: "Lihat Item", module: "master" },
  { code: "ITEM_CREATE", name: "Tambah Item", module: "master" },
  { code: "ITEM_EDIT", name: "Ubah Item", module: "master" },
  { code: "ITEM_ACTIVATE", name: "Aktifkan Item", module: "master" },
  { code: "ITEM_DEACTIVATE", name: "Nonaktifkan Item", module: "master" },

  { code: "CURRENCY_VIEW", name: "Lihat Currency", module: "master" },
  { code: "CURRENCY_CREATE", name: "Tambah Currency", module: "master" },
  { code: "CURRENCY_EDIT", name: "Ubah Currency", module: "master" },
  { code: "CURRENCY_ACTIVATE", name: "Aktifkan Currency", module: "master" },
  { code: "CURRENCY_DEACTIVATE", name: "Nonaktifkan Currency", module: "master" },

  { code: "UOM_VIEW", name: "Lihat Satuan", module: "master" },
  { code: "UOM_CREATE", name: "Tambah Satuan", module: "master" },
  { code: "UOM_EDIT", name: "Ubah Satuan", module: "master" },
  { code: "UOM_ACTIVATE", name: "Aktifkan Satuan", module: "master" },
  { code: "UOM_DEACTIVATE", name: "Nonaktifkan Satuan", module: "master" },

  { code: "PAYMENT_TERM_VIEW", name: "Lihat Termin Pembayaran", module: "master" },
  { code: "PAYMENT_TERM_CREATE", name: "Tambah Termin Pembayaran", module: "master" },
  { code: "PAYMENT_TERM_EDIT", name: "Ubah Termin Pembayaran", module: "master" },
  { code: "PAYMENT_TERM_ACTIVATE", name: "Aktifkan Termin Pembayaran", module: "master" },
  { code: "PAYMENT_TERM_DEACTIVATE", name: "Nonaktifkan Termin Pembayaran", module: "master" },

  { code: "WAREHOUSE_VIEW", name: "Lihat Gudang", module: "master" },
  { code: "WAREHOUSE_CREATE", name: "Tambah Gudang", module: "master" },
  { code: "WAREHOUSE_EDIT", name: "Ubah Gudang", module: "master" },
  { code: "WAREHOUSE_ACTIVATE", name: "Aktifkan Gudang", module: "master" },
  { code: "WAREHOUSE_DEACTIVATE", name: "Nonaktifkan Gudang", module: "master" },

  { code: "WITHHOLDING_TAX_VIEW", name: "Lihat Jenis PPh", module: "master" },
  { code: "WITHHOLDING_TAX_CREATE", name: "Tambah Jenis PPh", module: "master" },
  { code: "WITHHOLDING_TAX_EDIT", name: "Ubah Jenis PPh", module: "master" },
  { code: "WITHHOLDING_TAX_ACTIVATE", name: "Aktifkan Jenis PPh", module: "master" },
  { code: "WITHHOLDING_TAX_DEACTIVATE", name: "Nonaktifkan Jenis PPh", module: "master" },

  { code: "PARTNER_CATEGORY_VIEW", name: "Lihat Partner Category", module: "settings" },
  { code: "PARTNER_CATEGORY_CREATE", name: "Tambah Partner Category", module: "settings" },
  { code: "PARTNER_CATEGORY_EDIT", name: "Ubah Partner Category", module: "settings" },
  { code: "PARTNER_CATEGORY_ACTIVATE", name: "Aktifkan Partner Category", module: "settings" },
  { code: "PARTNER_CATEGORY_DEACTIVATE", name: "Nonaktifkan Partner Category", module: "settings" },

  // ---------------------------------------------------------------- accounting
  // -------------------------------------------------------------------- sales
  { code: "MENU_SALES_ACCESS", name: "Akses menu Penjualan", module: "sales" },
  { code: "CUSTOMER_ORDER_VIEW", name: "Lihat Customer Order", module: "sales", description: "Termasuk yang masih Draft dan yang dibatalkan." },
  { code: "CUSTOMER_ORDER_CREATE", name: "Buat Customer Order", module: "sales", description: "Membuat Draft baru, termasuk lewat Salin." },
  { code: "CUSTOMER_ORDER_EDIT", name: "Ubah Customer Order", module: "sales", description: "Hanya selama masih Draft." },
  { code: "CUSTOMER_ORDER_SUBMIT", name: "Ajukan Customer Order", module: "sales", description: "Mengunci Draft dan mengajukannya untuk disetujui." },
  { code: "CUSTOMER_ORDER_APPROVE", name: "Setujui / Tolak Customer Order", module: "sales", description: "Menjadikan pesanan yang diajukan Open, atau menolaknya dengan alasan." },
  { code: "CUSTOMER_ORDER_CANCEL", name: "Batalkan Customer Order", module: "sales", description: "Hanya Draft, dengan alasan." },
  { code: "CUSTOMER_ORDER_CLOSE", name: "Tutup Customer Order", module: "sales", description: "Menutup pesanan Open walaupun belum seluruhnya dikirim, dengan alasan, bila tidak ada Sales Order yang masih berjalan." },
  { code: "SALES_ORDER_VIEW", name: "Lihat Sales Order", module: "sales", description: "Termasuk yang masih Draft dan yang dibatalkan." },
  { code: "SALES_ORDER_CREATE", name: "Buat Sales Order", module: "sales", description: "Membuat Draft dari Customer Order berstatus Open." },
  { code: "SALES_ORDER_EDIT", name: "Ubah Sales Order", module: "sales", description: "Hanya selama masih Draft." },
  { code: "SALES_ORDER_SUBMIT", name: "Ajukan Sales Order", module: "sales", description: "Mengunci Draft dan mengajukannya untuk disetujui." },
  { code: "SALES_ORDER_APPROVE", name: "Setujui / Tolak Sales Order", module: "sales", description: "Menjadikan Sales Order yang diajukan Pra-SO, atau menolaknya dengan alasan." },
  { code: "SALES_ORDER_CONFIRM", name: "Konfirmasi Sales Order", module: "sales", description: "Menjadikan Pra-SO Open, sehingga dapat menjadi dasar produksi." },
  { code: "SALES_ORDER_CANCEL", name: "Batalkan Sales Order", module: "sales", description: "Hanya Draft, dengan alasan." },
  { code: "SALES_ORDER_CLOSE", name: "Tutup Sales Order", module: "sales", description: "Menutup Pra-SO atau Open dengan alasan, bila tidak ada Delivery Order yang masih berjalan." },
  { code: "DELIVERY_ORDER_VIEW", name: "Lihat Delivery Order", module: "sales", description: "Termasuk yang masih Draft dan yang dibatalkan." },
  { code: "DELIVERY_ORDER_CREATE", name: "Buat Delivery Order", module: "sales", description: "Membuat Draft dari Sales Order berstatus Open." },
  { code: "DELIVERY_ORDER_EDIT", name: "Ubah Delivery Order", module: "sales", description: "Hanya selama masih Draft." },
  { code: "DELIVERY_ORDER_ISSUE", name: "Terbitkan Delivery Order", module: "sales", description: "Mengunci Draft dan mengirimnya ke gudang sebagai perintah kirim." },
  { code: "DELIVERY_ORDER_CANCEL", name: "Batalkan Delivery Order", module: "sales", description: "Hanya Draft, dengan alasan." },
  { code: "DELIVERY_ORDER_CLOSE", name: "Tutup Delivery Order", module: "sales", description: "Menutup Delivery Order yang sudah diterbitkan, dengan alasan, bila tidak ada Delivery Note Draft." },

  { code: "MENU_ACCOUNTING_ACCESS", name: "Akses menu Accounting", module: "accounting" },

  { code: "ACCOUNT_VIEW", name: "Lihat Account", module: "accounting" },
  { code: "ACCOUNT_CREATE", name: "Tambah Account", module: "accounting" },
  { code: "ACCOUNT_EDIT", name: "Ubah Account", module: "accounting" },
  { code: "ACCOUNT_ACTIVATE", name: "Aktifkan Account", module: "accounting" },
  { code: "ACCOUNT_DEACTIVATE", name: "Nonaktifkan Account", module: "accounting" },

  // Fiscal Period carries no permissions of its own: it has no menu and no
  // form. Periods are generated when a Fiscal Year is opened and are read from
  // inside it, so seeing and opening a year is the whole capability.
  { code: "FISCAL_YEAR_VIEW", name: "Lihat Fiscal Year", module: "accounting", description: "Termasuk Fiscal Period di dalamnya." },
  { code: "FISCAL_YEAR_CREATE", name: "Tambah Fiscal Year", module: "accounting" },
  { code: "FISCAL_YEAR_EDIT", name: "Ubah Fiscal Year", module: "accounting", description: "Catatan tahun buku. Status bukan isian dan tidak berubah lewat Ubah." },
  {
    code: "FISCAL_YEAR_CLOSE",
    name: "Tutup Fiscal Year",
    module: "accounting",
    description:
      "Memindahkan hasil tahun berjalan ke ekuitas dan membuat Opening Balance " +
      "tahun berikutnya. Tidak dapat dibatalkan.",
  },

  // Viewing is the whole capability. An Opening Balance is written by a
  // fiscal year's close or injected by a developer before the application has
  // any history; nothing creates, edits or deletes one through the GUI, so
  // there is no permission for doing so.
  {
    code: "OPENING_BALANCE_VIEW",
    name: "Lihat Opening Balance",
    module: "accounting",
    description:
      "Saldo awal per tahun buku. Hanya dibaca — dokumennya bersifat final.",
  },

  {
    code: "FISCAL_YEAR_OPEN",
    name: "Aktifkan Fiscal Year",
    module: "accounting",
    description:
      "Mengubah tahun buku Draft menjadi Open dan membuat 12 Fiscal Period. Tidak dapat dikembalikan.",
  },

  // A journal produced by a posting is immutable, so none of the four write
  // permissions below can reach one: they govern the **manual** journal, which
  // is typed by a person, saved as a Draft, and posted through the same engine.
  // There is deliberately no JOURNAL_DELETE and no reversal — a posted journal
  // is final and a correction is a new one.
  { code: "JOURNAL_VIEW", name: "Lihat Journal", module: "accounting", description: "Journal otomatis maupun manual, termasuk yang masih Draft." },
  { code: "JOURNAL_CREATE", name: "Tambah Journal Manual", module: "accounting", description: "Journal yang diketik sendiri — penyusutan, akrual, reklasifikasi. Control account tidak dapat dipilih." },
  { code: "JOURNAL_EDIT", name: "Ubah Journal Manual", module: "accounting", description: "Hanya selama berstatus Draft." },
  { code: "JOURNAL_POST", name: "Post Journal Manual", module: "accounting", description: "Memasukkan journal ke buku besar. Tidak dapat dibatalkan." },
  { code: "JOURNAL_CANCEL", name: "Batalkan Journal Manual", module: "accounting", description: "Hanya draft yang belum diposting." },
  { code: "REPORT_GENERAL_LEDGER_VIEW", name: "Lihat General Ledger", module: "accounting" },
  { code: "REPORT_TRIAL_BALANCE_VIEW", name: "Lihat Trial Balance", module: "accounting" },
  { code: "REPORT_PROFIT_LOSS_VIEW", name: "Lihat Laba Rugi", module: "accounting" },
  { code: "REPORT_BALANCE_SHEET_VIEW", name: "Lihat Neraca", module: "accounting" },
  // Account Mapping (P61): where each kind of posting lands. Separate from
  // System Default so configuring the application never edits the ledger's
  // routing, and the other way round.
  { code: "MENU_ACCOUNT_MAPPING_ACCESS", name: "Akses menu Account Mapping", module: "accounting" },
  { code: "ACCOUNT_MAPPING_VIEW", name: "Lihat Account Mapping", module: "accounting" },
  {
    code: "ACCOUNT_MAPPING_EDIT",
    name: "Ubah Account Mapping",
    module: "accounting",
    description: "Menentukan account tujuan posting, seperti selisih kurs dan laba/rugi ekuitas.",
  },

  // ------------------------------------------------------------- purchasing
  // Purchase Request → Purchase Order (P121); the documents that move goods
  // or money sit under Logistik and Finance, as on the sales side.
  { code: "MENU_PURCHASING_ACCESS", name: "Akses menu Pembelian", module: "purchasing" },
  { code: "PURCHASE_REQUEST_VIEW", name: "Lihat Purchase Request", module: "purchasing", description: "Barang dan Jasa, termasuk Draft dan yang dibatalkan." },
  { code: "PURCHASE_REQUEST_CREATE", name: "Buat Purchase Request", module: "purchasing" },
  { code: "PURCHASE_REQUEST_EDIT", name: "Ubah Purchase Request", module: "purchasing", description: "Hanya selama masih Draft." },
  { code: "PURCHASE_REQUEST_SUBMIT", name: "Ajukan Purchase Request", module: "purchasing", description: "Mengunci dan membuka Purchase Request untuk Purchase Order; tanpa persetujuan." },
  { code: "PURCHASE_REQUEST_CANCEL", name: "Batalkan Purchase Request", module: "purchasing", description: "Hanya Draft, dengan alasan." },
  { code: "PURCHASE_REQUEST_CLOSE", name: "Tutup Purchase Request", module: "purchasing", description: "Menutup sisa yang belum dipesan, dengan alasan." },
  { code: "PURCHASE_ORDER_VIEW", name: "Lihat Purchase Order", module: "purchasing", description: "Barang dan Jasa, termasuk Draft dan yang dibatalkan." },
  { code: "PURCHASE_ORDER_CREATE", name: "Buat Purchase Order", module: "purchasing", description: "Dari Purchase Request yang Open." },
  { code: "PURCHASE_ORDER_EDIT", name: "Ubah Purchase Order", module: "purchasing", description: "Hanya selama masih Draft." },
  { code: "PURCHASE_ORDER_SUBMIT", name: "Ajukan Purchase Order", module: "purchasing", description: "Mengunci pesanan dan mencatat jumlahnya pada Purchase Request." },
  { code: "PURCHASE_ORDER_APPROVE", name: "Setujui / Tolak Purchase Order", module: "purchasing" },
  { code: "PURCHASE_ORDER_CANCEL", name: "Batalkan Purchase Order", module: "purchasing", description: "Hanya Draft, dengan alasan." },
  { code: "PURCHASE_ORDER_CLOSE", name: "Tutup Purchase Order", module: "purchasing", description: "Mengembalikan sisa yang belum diterima ke Purchase Request, dengan alasan." },

  // -------------------------------------------------------------- logistics
  // Standalone goods documents, chosen by purpose (P106).
  { code: "MENU_LOGISTICS_ACCESS", name: "Akses menu Logistik", module: "logistics" },
  { code: "DELIVERY_NOTE_VIEW", name: "Lihat Delivery Note", module: "logistics", description: "Termasuk yang masih Draft dan yang dibatalkan." },
  { code: "DELIVERY_NOTE_CREATE", name: "Buat Delivery Note", module: "logistics", description: "Membuat Draft dari dokumen sumber tujuannya — untuk penjualan, Delivery Order yang sudah diterbitkan." },
  { code: "DELIVERY_NOTE_EDIT", name: "Ubah Delivery Note", module: "logistics", description: "Hanya selama masih Draft." },
  { code: "DELIVERY_NOTE_POST", name: "Posting Delivery Note", module: "logistics", description: "Mencatat barang keluar dan menjurnal HPP / Persediaan." },
  { code: "DELIVERY_NOTE_CANCEL", name: "Batalkan Delivery Note", module: "logistics", description: "Hanya Draft, dengan alasan." },
  { code: "RECEIPT_NOTE_VIEW", name: "Lihat Receipt Note", module: "logistics", description: "Termasuk yang masih Draft dan yang dibatalkan." },
  { code: "RECEIPT_NOTE_CREATE", name: "Buat Receipt Note", module: "logistics", description: "Membuat Draft dari Purchase Order yang Open." },
  { code: "RECEIPT_NOTE_EDIT", name: "Ubah Receipt Note", module: "logistics", description: "Hanya selama masih Draft." },
  { code: "RECEIPT_NOTE_POST", name: "Posting Receipt Note", module: "logistics", description: "Mencatat barang masuk per lot atau beban, dan menjurnal ke Barang Diterima Belum Ditagih." },
  { code: "RECEIPT_NOTE_CANCEL", name: "Batalkan Receipt Note", module: "logistics", description: "Hanya Draft, dengan alasan." },

  // -------------------------------------------------------------- inventory
  // The stock books and their reports (P120). Stock is moved by the documents
  // that post it, never from this menu.
  { code: "MENU_INVENTORY_ACCESS", name: "Akses menu Persediaan", module: "inventory" },
  { code: "REPORT_STOCK_LEDGER_VIEW", name: "Lihat Kartu Stok", module: "inventory", description: "Mutasi jumlah satu barang per gudang dan lot." },
  { code: "REPORT_STOCK_BALANCE_VIEW", name: "Lihat Saldo Stok", module: "inventory", description: "Jumlah per gudang, lot dan status pada satu tanggal." },
  { code: "REPORT_STOCK_VALUATION_LEDGER_VIEW", name: "Lihat Kartu Nilai Persediaan", module: "inventory", description: "Mutasi nilai rata-rata bergerak satu barang." },
  { code: "REPORT_STOCK_VALUATION_VIEW", name: "Lihat Nilai Persediaan", module: "inventory", description: "Jumlah, nilai dan harga rata-rata per barang, dicocokkan dengan account Persediaan." },

  // ---------------------------------------------------------------- finance
  { code: "MENU_FINANCE_ACCESS", name: "Akses menu Finance", module: "finance" },

  // Uang Muka Penjualan — the AR advance bill (P54–P58).
  { code: "SALES_ADVANCE_VIEW", name: "Lihat Uang Muka Penjualan", module: "finance", description: "Termasuk yang masih Draft dan yang dibatalkan." },
  { code: "SALES_ADVANCE_CREATE", name: "Buat Uang Muka Penjualan", module: "finance", description: "Membuat Draft tagihan dari Customer Order berstatus Open." },
  { code: "SALES_ADVANCE_EDIT", name: "Ubah Uang Muka Penjualan", module: "finance", description: "Hanya selama masih Draft." },
  { code: "SALES_ADVANCE_ISSUE", name: "Terbitkan Uang Muka Penjualan", module: "finance", description: "Mengunci tagihan untuk dikirim ke customer. Tidak memposting journal." },
  { code: "SALES_ADVANCE_CANCEL", name: "Batalkan Uang Muka Penjualan", module: "finance", description: "Draft maupun yang sudah diterbitkan, dengan alasan." },
  { code: "PURCHASE_ADVANCE_VIEW", name: "Lihat Uang Muka Pembelian", module: "finance", description: "Termasuk yang masih Draft dan yang dibatalkan." },
  { code: "PURCHASE_ADVANCE_CREATE", name: "Buat Uang Muka Pembelian", module: "finance", description: "Membuat Draft tagihan dari Purchase Order berstatus Open." },
  { code: "PURCHASE_ADVANCE_EDIT", name: "Ubah Uang Muka Pembelian", module: "finance", description: "Hanya selama masih Draft." },
  { code: "PURCHASE_ADVANCE_ISSUE", name: "Catat Uang Muka Pembelian", module: "finance", description: "Mengunci tagihan supplier untuk dibayar. Tidak memposting journal." },
  { code: "PURCHASE_ADVANCE_CANCEL", name: "Batalkan Uang Muka Pembelian", module: "finance", description: "Draft maupun yang sudah dicatat, dengan alasan; ditolak bila sudah dibayar." },
  // Invoice Penjualan — in Finance since P107; codes unchanged (P99).
  { code: "SALES_INVOICE_VIEW", name: "Lihat Invoice Penjualan", module: "finance", description: "Termasuk yang masih Draft dan yang dibatalkan." },
  { code: "SALES_INVOICE_CREATE", name: "Buat Invoice Penjualan", module: "finance", description: "Membuat Draft dari barang Delivery Note yang sudah diposting." },
  { code: "SALES_INVOICE_EDIT", name: "Ubah Invoice Penjualan", module: "finance", description: "Hanya Draft." },
  { code: "SALES_INVOICE_POST", name: "Posting Invoice Penjualan", module: "finance", description: "Mengakui piutang, penjualan dan PPN Keluaran, dan memakai uang muka." },
  { code: "SALES_INVOICE_CANCEL", name: "Batalkan Invoice Penjualan", module: "finance", description: "Hanya Draft, dengan alasan." },
  { code: "CASH_RECEIPT_VIEW", name: "Lihat Penerimaan Kas & Bank", module: "finance", description: "Termasuk yang masih Draft dan yang dibatalkan." },
  { code: "CASH_RECEIPT_CREATE", name: "Buat Penerimaan Kas & Bank", module: "finance", description: "Membuat Draft penerimaan." },
  { code: "CASH_RECEIPT_EDIT", name: "Ubah Penerimaan Kas & Bank", module: "finance", description: "Hanya selama masih Draft." },
  { code: "CASH_RECEIPT_POST", name: "Posting Penerimaan Kas & Bank", module: "finance", description: "Membentuk journal dan mencatat dana di Buku Kas & Bank. Tidak dapat dibalik." },
  { code: "CASH_RECEIPT_CANCEL", name: "Batalkan Penerimaan Kas & Bank", module: "finance", description: "Hanya Draft, dengan alasan." },
  { code: "CASH_PAYMENT_VIEW", name: "Lihat Pengeluaran Kas & Bank", module: "finance", description: "Termasuk yang masih Draft dan yang dibatalkan." },
  { code: "CASH_PAYMENT_CREATE", name: "Buat Pengeluaran Kas & Bank", module: "finance", description: "Membuat Draft pengeluaran." },
  { code: "CASH_PAYMENT_EDIT", name: "Ubah Pengeluaran Kas & Bank", module: "finance", description: "Hanya selama masih Draft." },
  { code: "CASH_PAYMENT_POST", name: "Posting Pengeluaran Kas & Bank", module: "finance", description: "Membentuk journal dan mengeluarkan dana dari Buku Kas & Bank. Ditolak bila saldo tidak mencukupi." },
  { code: "CASH_PAYMENT_CANCEL", name: "Batalkan Pengeluaran Kas & Bank", module: "finance", description: "Hanya Draft, dengan alasan." },

  // Report Views. `REPORT_` comes first for the same reason `MENU_` does: the
  // prefix says what kind of capability this is before it says which subject.
  // A report is read-only, so a single view permission is the whole capability.
  {
    code: "REPORT_CASH_BANK_LEDGER_VIEW",
    name: "Lihat laporan Buku Kas & Bank",
    module: "finance",
    description: "Seluruh mutasi satu resource kas/bank pada rentang tanggal.",
  },
  {
    code: "REPORT_CASH_BANK_BALANCE_VIEW",
    name: "Lihat laporan Saldo Kas & Bank",
    module: "finance",
    description: "Saldo awal, penerimaan, pengeluaran, dan saldo akhir per resource.",
  },
  { code: "REPORT_AR_LEDGER_VIEW", name: "Lihat Buku Piutang", module: "finance", description: "Riwayat AR item per customer." },
  { code: "REPORT_AR_AGING_VIEW", name: "Lihat Umur Piutang", module: "finance", description: "Invoice belum lunas menurut umur, per customer." },
  { code: "REPORT_CUSTOMER_ADVANCE_VIEW", name: "Lihat Uang Muka Customer", module: "finance", description: "Uang muka diterima yang belum dipakai invoice." },

  // ---------------------------------------------------------------- settings
  // Pajak — the tax documents the sales process gives rise to, kept as internal records (P100, P101).
  { code: "MENU_TAX_ACCESS", name: "Akses menu Pajak", module: "tax" },
  { code: "TAX_FAKTUR_VIEW", name: "Lihat Faktur Pajak Keluaran", module: "tax", description: "Catatan faktur pajak yang terbentuk otomatis dari penerimaan uang muka dan invoice penjualan." },
  { code: "TAX_FAKTUR_EDIT", name: "Isi / Ubah NSFP Faktur Pajak", module: "tax", description: "Mengisi atau mengoreksi NSFP Coretax dan tanggal upload sebagai referensi. Angka faktur tidak berubah; tidak membentuk journal." },
  { code: "TAX_SLIP_VIEW", name: "Lihat Bukti Potong PPh", module: "tax", description: "PPh yang dipotong customer dari pembayarannya." },
  { code: "TAX_SLIP_RECEIVE", name: "Catat Bukti Potong Diterima", module: "tax", description: "Mencatat atau mengoreksi nomor dan tanggal bukti potong (BPPU) dari customer. Tidak membentuk journal." },

  { code: "MENU_SETTINGS_ACCESS", name: "Akses menu Pengaturan", module: "settings" },
  { code: "MENU_USER_ACCESS", name: "Akses menu User", module: "settings" },
  { code: "MENU_ROLE_ACCESS", name: "Akses menu Role", module: "settings" },
  { code: "MENU_SYSTEM_DEFAULT_ACCESS", name: "Akses menu System Default", module: "settings" },

  {
    code: "SYSTEM_DEFAULT_VIEW",
    name: "Lihat System Default",
    module: "settings",
    description: "Konfigurasi seluruh aplikasi, seperti tarif PPN.",
  },
  {
    code: "SYSTEM_DEFAULT_EDIT",
    name: "Ubah System Default",
    module: "settings",
    description: "Termasuk tarif PPN yang disalin setiap dokumen kena pajak.",
  },

  { code: "USER_VIEW", name: "Lihat User", module: "settings" },
  { code: "USER_CREATE", name: "Tambah User", module: "settings" },
  { code: "USER_EDIT", name: "Ubah User", module: "settings" },
  { code: "USER_ACTIVATE", name: "Aktifkan User", module: "settings" },
  { code: "USER_DEACTIVATE", name: "Nonaktifkan User", module: "settings" },
  { code: "USER_PASSWORD_RESET", name: "Reset password User", module: "settings" },
  {
    code: "USER_ROLE_ASSIGN",
    name: "Atur Role User",
    module: "settings",
    description:
      "Permission yang menentukan akses user lain. Hanya diberikan kepada administrator.",
  },

  { code: "ROLE_VIEW", name: "Lihat Role", module: "settings" },
  { code: "ROLE_CREATE", name: "Tambah Role", module: "settings" },
  { code: "ROLE_EDIT", name: "Ubah Role", module: "settings" },
  { code: "ROLE_ACTIVATE", name: "Aktifkan Role", module: "settings" },
  { code: "ROLE_DEACTIVATE", name: "Nonaktifkan Role", module: "settings" },
  {
    code: "ROLE_PERMISSION_MANAGE",
    name: "Atur Permission Role",
    module: "settings",
    description:
      "Permission yang menentukan isi sebuah Role. Hanya diberikan kepada administrator.",
  },
] as const satisfies readonly PermissionDef[];

export type PermissionCode = (typeof PERMISSIONS)[number]["code"];

export const PERMISSION_CODES: PermissionCode[] = PERMISSIONS.map((p) => p.code);

const BY_CODE = new Map<string, PermissionDef>(PERMISSIONS.map((p) => [p.code, p]));

export function permissionByCode(code: string): PermissionDef | undefined {
  return BY_CODE.get(code);
}

export function isPermissionCode(code: string): code is PermissionCode {
  return BY_CODE.has(code);
}

export const MODULE_LABELS: Record<PermissionModule, string> = {
  dashboard: "Dashboard",
  master: "Master",
  sales: "Penjualan",
  purchasing: "Pembelian",
  logistics: "Logistik",
  inventory: "Persediaan",
  accounting: "Accounting",
  finance: "Finance",
  tax: "Pajak",
  settings: "Pengaturan",
};

/** Catalogue order, grouped by module — drives the role permission matrix. */
export const MODULE_ORDER: PermissionModule[] = [
  "dashboard",
  "master",
  "sales",
  "purchasing",
  "logistics",
  "inventory",
  "accounting",
  "finance",
  "tax",
  "settings",
];

export function permissionsByModule(): Record<PermissionModule, PermissionDef[]> {
  const out = {} as Record<PermissionModule, PermissionDef[]>;
  for (const m of MODULE_ORDER) out[m] = [];
  for (const p of PERMISSIONS) out[p.module].push(p);
  return out;
}

/**
 * Permissions that let a user change who can do what. Granting any of these is
 * granting administration, so the guards in `user-admin.ts` treat them as the
 * privilege boundary: a user can never hand one to themselves.
 */
export const PRIVILEGE_PERMISSIONS: PermissionCode[] = [
  "USER_ROLE_ASSIGN",
  "ROLE_PERMISSION_MANAGE",
];

/**
 * What it takes to administer the application: reach the settings menu, reach
 * user management, read the register, create an account, and grant it a role.
 *
 * This is an ALL-OF set. `user-admin.ts` refuses any change that would leave no
 * active user holding every entry, so a user holding one or two of these — a
 * staff member who can see the settings menu to reach their own profile, say —
 * is not an administrator and is not counted as one.
 */
export const ADMIN_CRITICAL_PERMISSIONS: PermissionCode[] = [
  "MENU_SETTINGS_ACCESS",
  "MENU_USER_ACCESS",
  "USER_VIEW",
  "USER_CREATE",
  "USER_ROLE_ASSIGN",
];
