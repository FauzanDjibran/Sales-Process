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
  /**
   * The URL segment, when it is not the key. The Produksi application's modules
   * all live under `/production` (P258), so they share it; a module is then
   * told from its siblings by the leaf the path names.
   */
  path?: string;
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
      {
        // The Perizinan flow (P137): its own route, not a Customer Order.
        key: "permit",
        name: "Perizinan",
        entities: [
          {
            key: "sal_permit_request",
            slug: "permit",
            name: "Pengajuan Perizinan",
            icon: "clip",
            desc: "Perizinan yang diurus untuk produk customer maklon: estimasi tiap perizinan, lalu realisasinya. Tidak memposting apa pun; menjadi dasar Uang Muka dan Invoice Perizinan.",
            permission: "PERMIT_REQUEST_VIEW",
          },
        ],
      },
    ],
  },
  {
    // Purchase Request → Purchase Order (P121, P123). Goods and money
    // documents of purchasing sit under Persediaan and Finance, as for sales.
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
      {
        key: "order",
        name: "Pesanan",
        entities: [
          {
            key: "pur_order_goods",
            slug: "order/goods",
            name: "Purchase Order Barang",
            icon: "clip",
            desc: "Pesanan barang ke satu supplier, dari Purchase Request yang Open, dengan harga dan pajaknya. Tidak memposting apa pun.",
            permission: "PURCHASE_ORDER_VIEW",
          },
          {
            key: "pur_order_service",
            slug: "order/service",
            name: "Purchase Order Jasa",
            icon: "clip",
            desc: "Pesanan jasa ke satu supplier, dari Purchase Request yang Open, dengan harga dan pajaknya. Tidak memposting apa pun.",
            permission: "PURCHASE_ORDER_VIEW",
          },
        ],
      },
    ],
  },
  {
    // The money side of production (P254): an ERP module whose URL space is
    // `/costing`, because `/production/*` is the Produksi application.
    key: "costing",
    name: "Produksi",
    icon: "gear",
    desc: "Sisi uang produksi: rencana, biaya, Standard Cost, Closing, dan nilai WIP.",
    permission: "MENU_COSTING_ACCESS",
    groups: [
      {
        key: "cost",
        name: "Biaya",
        entities: [
          {
            key: "prd_cost_bill",
            slug: "cost-bill",
            name: "Tagihan Biaya",
            icon: "file",
            desc: "Biaya produksi yang diakui pada bulan terjadinya, per Jenis Biaya; dilunasi lewat Pengeluaran — Pembayaran Biaya Produksi.",
            permission: "PRODUCTION_COST_BILL_VIEW",
          },
        ],
      },
      {
        key: "cost-master",
        name: "Master Biaya",
        entities: [
          {
            key: "prd_rate_version",
            slug: "rate-version",
            name: "Standard Cost",
            icon: "calc",
            desc: "Rate biaya per gram tiap unit, dalam versi.",
            permission: "RATE_VERSION_VIEW",
          },
          {
            key: "acc_cost_type",
            slug: "cost-type",
            name: "Jenis Biaya",
            icon: "coin",
            desc: "Biaya produksi beserta account biayanya; dipilih di Tagihan Biaya.",
            permission: "COST_TYPE_VIEW",
          },
        ],
      },
    ],
  },
  // The Produksi application (P254, P258): modules on the rail like the ERP's,
  // each opening only its own menu. They share the URL segment `/production`.
  {
    key: "production-work",
    path: "production",
    name: "Pengerjaan",
    icon: "layers",
    desc: "Kerja di Unit: barang masuk, dikerjakan, diperiksa, lalu siap dikirim.",
    permission: "MENU_PRODUCTION_ACCESS",
    groups: [
      {
        key: "production-work-main",
        name: "Workspace",
        entities: [
          { key: "prd_unit", slug: "workspace", name: "Workspace Unit", icon: "layers", desc: "Pilih Unit, scan label, kerjakan satu form untuk satu pekerjaan.", permission: "PRODUCTION_UNIT_VIEW" },
        ],
      },
    ],
  },
  {
    key: "production-document",
    path: "production",
    name: "Dokumen",
    icon: "file",
    desc: "Dokumen pengerjaan di Unit: grading, pengerjaan, dan QC.",
    permission: "MENU_PRODUCTION_ACCESS",
    groups: [
      {
        key: "production-document-main",
        name: "Pengerjaan di Unit",
        entities: [
          { key: "prd_grading", slug: "grading", name: "No. Grading", icon: "layers", desc: "Satu No. Stok dari Persiapan menjadi output baru; di sinilah jenis dan gram berubah.", permission: "PRODUCTION_GRADING_VIEW" },
          { key: "prd_work", slug: "work", name: "Pengerjaan Unit", icon: "check", desc: "No. Job yang dikerjakan di unit Pass Through dan oleh siapa; barang dan gram tetap.", permission: "PRODUCTION_WORK_VIEW" },
          { key: "prd_qc_check", slug: "qc-check", name: "QC Check", icon: "check", desc: "QC memvalidasi hasil proses: Lulus ke Stand By, Balik ke Persiapan.", permission: "PRODUCTION_QC_VIEW" },
        ],
      },
    ],
  },
  {
    key: "production-report",
    path: "production",
    name: "Laporan",
    icon: "trend",
    desc: "Saldo, mutasi, dan silsilah No. Stok di produksi.",
    permission: "MENU_PRODUCTION_ACCESS",
    groups: [
      {
        key: "production-report-main",
        name: "Laporan",
        entities: [
          {
            key: "report_wip_balance",
            slug: "report/wip-balance",
            name: "Saldo Produksi",
            icon: "layers",
            desc: "Barang di produksi per unit dan No. Stok pada satu tanggal.",
            permission: "REPORT_WIP_BALANCE_VIEW",
          },
          {
            key: "report_lot_card",
            slug: "report/lot-card",
            name: "Kartu No. Stok",
            icon: "book",
            desc: "Seluruh mutasi satu No. Stok di produksi dan di stok.",
            permission: "REPORT_LOT_CARD_VIEW",
          },
          {
            key: "report_trace",
            slug: "report/trace",
            name: "Telusur Produksi",
            icon: "tree",
            desc: "Silsilah satu No. Stok: mundur sampai supplier, maju sampai customer.",
            permission: "REPORT_PRODUCTION_TRACE_VIEW",
          },
        ],
      },
    ],
  },
  {
    key: "production-master",
    path: "production",
    name: "Master",
    icon: "tags",
    desc: "Data pendukung lantai produksi.",
    permission: "MENU_PRODUCTION_ACCESS",
    groups: [
      {
        key: "production-master-main",
        name: "Master Pendukung",
        entities: [
          {
            key: "m_employee",
            slug: "employee",
            name: "Karyawan",
            icon: "users",
            desc: "Pekerja yang mengerjakan No. Job di unit Pass Through.",
            permission: "EMPLOYEE_VIEW",
          },
        ],
      },
    ],
  },
  {
    // One module for the goods (P131): the documents that move stock — standalone,
    // chosen by purpose (P106) — and the stock books they write (P120).
    key: "inventory",
    name: "Persediaan",
    icon: "box",
    desc: "Barang masuk dan keluar gudang, buku stok per gudang dan lot, dan nilai persediaan rata-rata bergerak per barang.",
    permission: "MENU_INVENTORY_ACCESS",
    groups: [
      {
        key: "document",
        name: "Operasi Gudang",
        entities: [
          {
            key: "log_receipt_note",
            slug: "receipt-note",
            name: "Receipt Note",
            icon: "box",
            desc: "Penerimaan barang atau jasa dari supplier menurut Purchase Order. Barang Kelola Stok masuk per lot; lainnya dibebankan. Hutang diakui di Invoice Pembelian.",
            permission: "RECEIPT_NOTE_VIEW",
          },
          {
            key: "log_stock_issue",
            slug: "stock-issue",
            name: "BSTB Issue",
            icon: "layers",
            desc: "Bahan dan bahan penolong keluar dari gudang per lot ke Unit; bergerak saat Unit menerima.",
            permission: "STOCK_ISSUE_VIEW",
          },
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
          {
            key: "fin_ar_permit_advance",
            slug: "advance/permit",
            name: "Uang Muka Perizinan",
            icon: "wallet",
            desc: "Tagihan uang muka ke customer atas Pengajuan Perizinan, satu baris uraian. Tidak memposting apa pun; pembayarannya dicatat di Penerimaan Kas & Bank.",
            permission: "PERMIT_ADVANCE_VIEW",
          },
          {
            key: "fin_ap_advance",
            slug: "advance/purchase",
            name: "Uang Muka Pembelian",
            icon: "wallet",
            desc: "Tagihan uang muka dari supplier atas Purchase Order. Tidak memposting apa pun; pembayarannya dicatat di Pengeluaran Kas & Bank.",
            permission: "PURCHASE_ADVANCE_VIEW",
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
          {
            key: "fin_ar_permit_invoice",
            slug: "invoice/permit",
            name: "Invoice Perizinan",
            icon: "file",
            desc: "Tagihan atas realisasi Pengajuan Perizinan, satu baris uraian, dipotong Uang Muka Perizinan. Posting mengakui piutang, Pendapatan Perizinan dan PPN.",
            permission: "PERMIT_INVOICE_VIEW",
          },
          {
            key: "fin_ap_invoice",
            slug: "invoice/purchase",
            name: "Invoice Pembelian",
            icon: "file",
            desc: "Tagihan supplier atas barang dan jasa yang sudah diterima: baris Receipt Note yang diposting, selalu pada harga PO, dipotong uang muka. Posting mengakui hutang, PPN Masukan dan PPh.",
            permission: "PURCHASE_INVOICE_VIEW",
          },
        ],
      },
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
          {
            key: "fin_cash_payment",
            slug: "cash-bank/payment",
            name: "Pengeluaran",
            single: "Pengeluaran Kas & Bank",
            icon: "send",
            desc: "Dana keluar dari kas atau bank. Tujuannya menentukan dokumen yang diselesaikan dan journal yang dibentuk.",
            permission: "CASH_PAYMENT_VIEW",
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
            desc: "Riwayat Piutang Usaha atau Uang Muka Customer per customer.",
            permission: "REPORT_AR_LEDGER_VIEW",
          },
          {
            key: "report_ar_balance",
            slug: "report/ar-balance",
            name: "Saldo Piutang",
            icon: "wallet",
            desc: "Saldo per customer, asal setiap item dan progres penyelesaiannya.",
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
            key: "report_ap_ledger",
            slug: "report/ap-ledger",
            name: "Buku Hutang",
            icon: "book",
            desc: "Riwayat Hutang Usaha atau Uang Muka Supplier per supplier.",
            permission: "REPORT_AP_LEDGER_VIEW",
          },
          {
            key: "report_ap_balance",
            slug: "report/ap-balance",
            name: "Saldo Hutang",
            icon: "wallet",
            desc: "Saldo per supplier, asal setiap item dan progres penyelesaiannya.",
            permission: "REPORT_AP_LEDGER_VIEW",
          },
          {
            key: "report_ap_aging",
            slug: "report/ap-aging",
            name: "Umur Hutang",
            icon: "clock",
            desc: "Invoice pembelian belum lunas menurut umur jatuh tempo, per supplier.",
            permission: "REPORT_AP_AGING_VIEW",
          },
          {
            key: "report_supplier_advance",
            slug: "report/supplier-advance",
            name: "Uang Muka Supplier",
            icon: "wallet",
            desc: "Uang muka dibayar yang belum dipakai invoice, per supplier dan Purchase Order.",
            permission: "REPORT_SUPPLIER_ADVANCE_VIEW",
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
          {
            key: "ref_warehouse_location",
            slug: "warehouse-location",
            name: "Lokasi Gudang",
            icon: "layers",
            desc: "Tempat di dalam gudang — rak, baris, bin — tempat stok disimpan.",
            permission: "WAREHOUSE_LOCATION_VIEW",
          },
        ],
      },
      {
        key: "production",
        name: "Produksi",
        entities: [
          {
            key: "ref_workstation",
            slug: "workstation",
            name: "Workstation",
            icon: "build",
            desc: "Pengelompok unit produksi.",
            permission: "WORKSTATION_VIEW",
          },
          {
            key: "ref_unit",
            slug: "unit",
            name: "Unit",
            icon: "gear",
            desc: "Tempat barang berada selama produksi dan jenis pekerjaan yang boleh dilakukan di sana.",
            permission: "UNIT_VIEW",
          },
          {
            key: "prd_line",
            slug: "production-line",
            name: "Line Produksi",
            icon: "layers",
            desc: "Lini produksi, mis. Reguler; routing mengikuti line.",
            permission: "LINE_VIEW",
          },
          {
            key: "prd_routing",
            slug: "routing",
            name: "Routing",
            icon: "tree",
            desc: "Urutan unit yang dilalui barang, per line dan per versi.",
            permission: "ROUTING_VIEW",
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
          {
            key: "ref_permit_type",
            slug: "permit-type",
            name: "Jenis Perizinan",
            icon: "clip",
            desc: "Perizinan yang diurus untuk produk customer maklon, beserta estimasi harga standarnya.",
            permission: "PERMIT_TYPE_VIEW",
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
 * The two applications behind one sign-in (P245, P254): a catalogue in code,
 * like the cash & bank purposes. Every module is the ERP's but `production`,
 * whose URL space `/production/*` is the Produksi application.
 */
export type AppKey = "erp" | "production";

export const APPS: Record<AppKey, { name: string; mark: string; desc: string }> = {
  erp: {
    name: "ERP",
    mark: "ER",
    desc: "Penjualan, Pembelian, Persediaan, Finance, Pajak, Accounting, dan sisi biaya produksi.",
  },
  production: {
    name: "Produksi",
    mark: "PR",
    desc: "Workspace Unit, dokumen pengerjaan, perpindahan antar Unit, dan telusur.",
  },
};

/** A module's URL segment. */
export function modulePath(m: Pick<NavModule, "key" | "path">): string {
  return m.path ?? m.key;
}

/**
 * The application a module belongs to, by its key or its URL segment: the
 * permission catalogue names one `production` module for the four on the rail.
 */
export function appOfModule(moduleKey: string): AppKey {
  const mod = MODULES.find((m) => m.key === moduleKey);
  return (mod ? modulePath(mod) : moduleKey) === "production" ? "production" : "erp";
}

/**
 * The navigation a given set of permissions can see, in one application or in
 * both.
 *
 * Menu visibility mirrors authorization but never substitutes for it: every
 * page and every Server Action behind these links checks for itself. A module
 * whose leaves are all hidden disappears rather than leading to a refusal.
 */
export function visibleModules(permissions: Iterable<string>, app?: AppKey): NavModule[] {
  const held = permissions instanceof Set ? permissions : new Set(permissions);
  const allowed = (code?: string) => !code || held.has(code);

  const out: NavModule[] = [];
  for (const mod of MODULES) {
    if (app && appOfModule(mod.key) !== app) continue;
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

/**
 * The applications a user has: one where some menu they may open asks for a
 * permission. Profil Saya asks for none, so it alone gives nobody the ERP.
 * There is no app table and no `APP_*` permission (P254 §9.1).
 */
export function appsOf(permissions: Iterable<string>): AppKey[] {
  const held = [...permissions];
  return (Object.keys(APPS) as AppKey[]).filter((app) =>
    visibleModules(held, app).some((m) =>
      m.groups ? m.groups.some((g) => g.entities.some((e) => e.permission)) : Boolean(m.permission)
    )
  );
}

/**
 * Where a signed-in user should land: the first menu of the application asked
 * for, or, with none asked, the picker for a user holding both (`/apps`).
 */
export function landingHref(permissions: Iterable<string>, app?: AppKey): string {
  const held = [...permissions];
  if (!app) {
    const apps = appsOf(held);
    if (apps.length > 1) return "/apps";
    app = apps[0] ?? "erp";
  }
  const first = visibleModules(held, app)[0];
  if (!first) return "/settings/profile";
  if (!first.groups) return `/${first.key}`;
  const leaf = first.groups[0]?.entities[0];
  return leaf ? entityHref(first.key, leaf.slug) : `/${first.key}`;
}

export function entityHref(moduleKey: string, slug: string): string {
  const mod = moduleByKey(moduleKey);
  return `/${mod ? modulePath(mod) : moduleKey}/${slug}`;
}

/**
 * The name of the module a page belongs to, for its breadcrumb: the one owning
 * the leaf at `/<segment>/<slug>`, so Karyawan reads *Master* and a report
 * *Laporan* in Produksi, whose modules share one segment.
 */
export function moduleNameAt(segment: string, slug: string): string {
  return resolvePath(`/${segment}/${slug}`).module?.name ?? moduleByKey(segment)?.name ?? segment;
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
  const [, segment, ...rest] = pathname.split("/");
  // Several modules may share a segment (Produksi, P258): the leaf decides.
  const candidates = MODULES.filter((m) => modulePath(m) === (segment ?? ""));
  if (!candidates.length) return { module: undefined, group: undefined, entity: undefined };

  const tail = rest.join("/");
  let best: { module: NavModule; group: NavGroup; entity: NavEntity } | null = null;

  for (const mod of candidates) {
    for (const group of mod.groups ?? []) {
      for (const entity of group.entities) {
        const matches = tail === entity.slug || tail.startsWith(`${entity.slug}/`);
        if (!matches) continue;
        if (!best || entity.slug.length > best.entity.slug.length) {
          best = { module: mod, group, entity };
        }
      }
    }
  }

  if (best) return best;
  // A page no leaf names (Profil Saya in Produksi) has no module when the
  // segment is shared, so no submenu claims it.
  return { module: candidates.length === 1 ? candidates[0] : undefined, group: undefined, entity: undefined };
}
