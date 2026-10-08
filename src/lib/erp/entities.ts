/**
 * Entity registry for the registry-driven modules.
 *
 * One config drives the list table, the detail view, and the create/edit form.
 * Adding an entity means adding a config here, not writing another page. Master
 * and Accounting both run on it; the only bespoke registry entity is Chart of
 * Accounts, whose *list* renders as a tree (`view: "tree"`) while its detail and
 * form stay generic.
 */
import type { IconName } from "@/components/icon";
import { isBaseCurrency } from "./currency";

/** A value a create form's field can start on (P61). */
export type FieldPreset = "base_currency";

export type FieldType =
  | "text"
  | "textarea"
  | "select"
  | "ref"
  | "bool"
  | "date"
  | "number"
  /**
   * An amount. Rendered by `ui/money-input.tsx` — mono, right-aligned,
   * grouped in thousands as it is typed, with the currency named by
   * `currencyFrom` shown inside the box. Never a native `<input
   * type="number">`: that control is drawn by the operating system and cannot
   * carry a separator, which is how the same figure came to read three
   * different ways on three screens.
   */
  | "money"
  /**
   * An exchange rate. Rendered by `ui/rate-input.tsx`, which is a separate
   * control from `money` on purpose: a rate is not an amount. It carries six
   * decimals where money carries two, it has to accept a decimal separator at
   * all, and it reads as a ratio between two currencies rather than as a
   * quantity of one. Giving it the money control would say it was the same
   * kind of figure — and would silently drop the decimals.
   */
  | "rate"
  /**
   * A percentage — a tax rate. `MoneyInput` with a `%` in the box and the four
   * decimals `Decimal(9,4)` holds, so `1,5` is typed the way it is written.
   * Stored as the percent itself (`1.5`), not as a fraction.
   */
  | "percent"
  /**
   * One number continuing a code the record inherits. The user types `5`; the
   * Server Action writes `1.1.1.5` into the field named by `writesTo`. See
   * `lib/erp/account-code.ts` — Chart of Accounts is the entity that needs it.
   */
  | "segment";

export type Field = {
  name: string;
  label: string;
  type: FieldType;
  /**
   * How much of the twelve-column form row this field takes. Left unset a
   * field takes a third, which is what suits the short values a master record
   * holds; `full` and a textarea take the whole row. Set it only where a field
   * genuinely needs a different share — a long name, or a pair that must sit
   * side by side. See `components/ui/form.tsx`.
   */
  span?: 3 | 4 | 5 | 6 | 8 | 12;
  required?: boolean;
  /** Enforced case-insensitively across the table. */
  unique?: boolean;
  /**
   * Narrows `unique` to rows sharing this column's value — an account number is
   * unique among its siblings, not globally.
   */
  uniqueWithin?: string;
  /** Short human identifier — renders as a chip when read-only, mono when editing. */
  ident?: boolean;
  /** Immutable once the record exists. */
  locked?: boolean;
  /**
   * Offered only when creating, and never written to the entity's own table —
   * the Server Action decides what to do with it. A Cash & Bank resource's
   * opening balance is the case: it becomes the first entry in that resource's
   * book, which is where a balance belongs.
   */
  createOnly?: boolean;
  /** Not a column on this table; `buildData` leaves it out entirely. */
  virtual?: boolean;
  /**
   * Written by the Server Action rather than typed: never offered on a form,
   * never `required`-checked, but still shown read-only on the detail view. A
   * Fiscal Year's name and date range are derived from the year it is for.
   */
  derived?: boolean;
  placeholder?: string;
  help?: string;
  /** `select` options. */
  options?: string[];
  optionLabels?: Record<string, string>;
  /** `ref` target entity key. */
  ref?: string;
  /**
   * Named narrowing for a ref field. The server applies the structural half
   * (postable, subcategory, active) when it builds the options; the form
   * applies the half that depends on values the user is still choosing, such
   * as the chosen Kelompok. Kept as a name so the config stays serialisable.
   */
  refFilter?:
    | "cashBankAccount"
    | "postableAccount"
    | "parentAccount"
    /** Kategori Item of the Tipe the form currently holds (P47). */
    | "itemCategoryByType";
  /**
   * Named predicate deciding whether the field applies at all. A field that
   * does not apply is hidden and stored as null — the Server Action evaluates
   * the same predicate, so hiding it is never what enforces the rule.
   */
  visibleWhen?:
    | "accountRequiresPartner"
    /**
     * The chosen `currency_id` is not the base currency. A base-currency
     * resource needs no kurs — asking for one and answering "1" would be a
     * field that states the obvious on every rupiah account in the system.
     */
    | "currencyIsForeign"
    /**
     * The chosen Partner Category is Customer. What a customer does with the
     * tax on a sale means nothing for a supplier, whose tax is the other way
     * round and is designed when purchasing is.
     */
    | "partnerIsCustomer"
    /**
     * The chosen Partner Category is Supplier: what a new Purchase Order starts
     * from (P122).
     */
    | "partnerIsSupplier"
    /**
     * The Item is a Barang. Stock and expiry mean nothing for a Jasa, so the
     * flags are not offered and are stored false.
     */
    | "itemIsGoods";
  /**
   * `segment` only. The ref fields whose chosen row supplies the code this
   * segment continues, in priority order — the first one filled wins. Chart of
   * Accounts inherits from its Parent Account when there is one and from its
   * Kelompok otherwise, which is exactly what makes the number shown on screen
   * the number that gets stored.
   */
  inheritsFrom?: string[];
  /** `segment` only. The field the composed code is written into. */
  writesTo?: string;
  /**
   * `money` and `rate`. The ref field naming the currency this field relates
   * to: for an amount, the currency it is denominated in; for a rate, the
   * currency it converts *from*. Either way the box can say so rather than
   * leaving the reader to infer it.
   */
  currencyFrom?: string;
  defaultValue?: string | boolean | number;
  /**
   * What this field starts on when creating. A preset fills the control in
   * and nothing more: it is not applied on edit, it never overrides a value,
   * and the Server Action validates the result exactly as it would a value
   * the user picked. `base_currency` is the currency the books are measured
   * in (P61).
   */
  preset?: FieldPreset;
  /** `bool` caption and sub-caption. */
  caption?: string;
  captionDetail?: string;
  full?: boolean;
  /** Clearing this field clears these too (dependent refs). */
  resets?: string[];
  /**
   * The form tab this field sits in (`Entity.tabs`). A field without one sits
   * in the header card above the tabs.
   */
  tab?: string;
  /** Section title within the tab's card, when the tab holds more than one. */
  section?: string;
};

/**
 * One tab of a record's form (Claude-ERP.md P38): a form is a header card, then
 * its remaining content in tabs, then the record history. A form with only one
 * section has no tabs at all.
 *
 * `fields` tabs hold registry fields (those naming the tab). `custom` tabs hold
 * a collection the registry cannot describe — a Partner's addresses — drawn by
 * the component `components/master/entity-tabs.tsx` maps the key to. Its value
 * travels in the form under `_<key>`, and the Server Action decides what to do
 * with it.
 */
export type EntityTab = {
  key: string;
  label: string;
  icon: IconName;
  /** One line under the card title saying what the tab holds. */
  desc: string;
  kind: "fields" | "custom";
  /** A custom tab shown only while the form's values call for it (`tabApplies`). */
  shownWhen?: "warehouseUsesLocation";
};

export type Column = {
  field: string;
  label: string;
  width?: string;
  /** `.pri` — bolder, primary column. */
  primary?: boolean;
  muted?: boolean;
  numeric?: boolean;
  /** Render as a `.lab` code chip. */
  isLabel?: boolean;
  isRef?: boolean;
  /** Show only the ref's short label, not label + name. */
  refLabelOnly?: boolean;
  isStatus?: boolean;
  isTag?: boolean;
  isBool?: boolean;
  isDate?: boolean;
  /** A stored percentage, shown `1,5%`. */
  isPercent?: boolean;
  truncate?: boolean;
  /** Value comes from the server-computed map rather than the row. */
  computed?: boolean;
  filter?: "text" | "ref" | "enum" | "bool";
};

/**
 * How a record carries active/inactive — or, for fiscal records, a lifecycle
 * that is not a toggle at all.
 *
 * `toggle` is what decides whether activate/deactivate exist as operations.
 * Fiscal Year and Fiscal Period move Draft -> Open -> Closed through an edit,
 * so they declare a status for filtering and display but no toggle.
 */
export type StatusModel = {
  field: string;
  /** `enum` stores the value as text; `bool` stores true/false. */
  kind: "enum" | "bool";
  /** Values offered in the list's status filter, in order. */
  options: string[];
  toggle: boolean;
};

export type Entity = {
  key: string;
  slug: string;
  module: string;
  name: string;
  single?: string;
  icon: IconName;
  desc: string;
  codeField: string;
  codePrefix: string;
  labelField?: string;
  nameField?: string;
  /**
   * Records with no identity of their own — a mapping is named by what it
   * connects. Titles are composed from these ref fields' labels.
   */
  titleRefs?: string[];
  /** How the list page renders. */
  view?: "table" | "tree";
  statusModel?: StatusModel;
  fields: Field[];
  columns: Column[];
  /** The form's tabs, in order. Absent for a form with one section. */
  tabs?: EntityTab[];
};

const ACTIVE_STATUS: StatusModel = {
  field: "status",
  kind: "enum",
  options: ["Active", "Inactive"],
  toggle: true,
};

const FISCAL_STATUS: StatusModel = {
  field: "status",
  kind: "enum",
  options: ["Draft", "Open", "Closed"],
  toggle: false,
};

const STATUS_FIELD: Field = {
  name: "status",
  label: "Status",
  type: "select",
  required: true,
  options: ["Active", "Inactive"],
  optionLabels: { Active: "Aktif", Inactive: "Non Aktif" },
  defaultValue: "Active",
  help: "bila Inactive, tidak muncul pada transaksi baru",
};

const FISCAL_STATUS_FIELD: Field = {
  name: "status",
  label: "Status",
  type: "select",
  required: true,
  options: ["Draft", "Open", "Closed"],
  defaultValue: "Draft",
  help: "Draft belum dipakai · Open menerima posting · Closed terkunci",
};

const NOTE_FIELD: Field = {
  name: "note",
  label: "Catatan",
  type: "textarea",
  full: true,
  placeholder: "Keterangan tambahan (opsional)…",
};

const identHelp =
  "identitas ringkas, dipakai di dropdown dan laporan";

/**
 * The years a Fiscal Year may be opened for: a decade around the current one.
 *
 * Creating a fiscal year is choosing a year and nothing else — everything the
 * table needs follows from it — so the field is a list rather than free text,
 * which also rules out a typo producing a "year" nobody can post into.
 */
export const YEAR_OPTIONS: string[] = Array.from({ length: 11 }, (_, i) =>
  String(new Date().getUTCFullYear() - 5 + i)
);

export const ENTITIES: Entity[] = [
  {
    key: "m_partner",
    slug: "partner",
    module: "master",
    name: "Partner",
    icon: "users",
    desc: "Pelanggan dan pemasok — subjek posisi per Partner pada jurnal dan General Ledger.",
    codeField: "partner_code",
    codePrefix: "part",
    labelField: "partner_label",
    nameField: "partner_name",
    statusModel: ACTIVE_STATUS,
    fields: [
      {
        name: "partner_label",
        label: "Label",
        type: "text",
        required: true,
        unique: true,
        ident: true,
        placeholder: "CUST-001",
        help: identHelp,
      },
      {
        name: "partner_name",
        label: "Nama Partner",
        type: "text",
        required: true,
        placeholder: "PT Pelanggan Utama",
        help: "nama lengkap",
      },
      {
        name: "category_id",
        label: "Partner Category",
        type: "ref",
        ref: "sys_partner_category",
        required: true,
        help: "menentukan Account mana yang boleh memakainya",
      },
      STATUS_FIELD,
      NOTE_FIELD,

      // ---- tab Pajak: the identity a faktur pajak names.
      {
        name: "taxpayer_type",
        label: "Tipe Wajib Pajak",
        type: "select",
        required: true,
        tab: "tax",
        section: "Identitas Pajak",
        options: ["Badan", "OrangPribadi", "InstansiPemerintah"],
        optionLabels: {
          Badan: "Badan",
          OrangPribadi: "Orang Pribadi",
          InstansiPemerintah: "Instansi Pemerintah",
        },
        help: "Badan dan Instansi Pemerintah wajib NPWP",
      },
      {
        name: "tax_id_type",
        label: "Jenis Identitas",
        type: "select",
        required: true,
        tab: "tax",
        section: "Identitas Pajak",
        options: ["NPWP", "NIK"],
        defaultValue: "NPWP",
        help: "NIK hanya untuk Orang Pribadi",
      },
      {
        name: "tax_id",
        label: "Nomor Identitas",
        type: "text",
        required: true,
        ident: true,
        tab: "tax",
        section: "Identitas Pajak",
        placeholder: "16 digit",
        help: "16 digit, tanpa titik atau spasi",
      },
      {
        name: "tax_name",
        label: "Nama sesuai NPWP / NIK",
        type: "text",
        required: true,
        span: 8,
        tab: "tax",
        section: "Identitas Pajak",
        placeholder: "PT Pelanggan Utama",
        help: "nama yang tercetak di faktur pajak",
      },
      {
        name: "is_pkp",
        label: "Status PKP",
        type: "bool",
        tab: "tax",
        section: "Identitas Pajak",
        caption: "Pengusaha Kena Pajak (PKP)",
        help: "PKP wajib memakai NPWP",
      },
      {
        name: "withholds_pph23",
        label: "PPh 23",
        type: "bool",
        tab: "tax",
        section: "Perlakuan Pajak Penjualan",
        visibleWhen: "partnerIsCustomer",
        caption: "Customer memotong PPh 23",
        captionDetail: "atas jasa — pembayarannya kurang sebesar PPh 23 (2%) dan diganti bukti potong",
      },
      {
        name: "collects_pph22",
        label: "PPh 22",
        type: "bool",
        tab: "tax",
        section: "Perlakuan Pajak Penjualan",
        visibleWhen: "partnerIsCustomer",
        caption: "Customer memungut PPh 22",
        captionDetail: "atas barang — pembayarannya kurang sebesar PPh 22 (1,5%) dan diganti bukti potong",
      },
      {
        name: "vat_collector",
        label: "Pemungut PPN (WAPU)",
        type: "select",
        required: true,
        tab: "tax",
        section: "Perlakuan Pajak Penjualan",
        visibleWhen: "partnerIsCustomer",
        options: ["None", "Government"],
        optionLabels: { None: "Bukan Pemungut", Government: "Instansi Pemerintah" },
        defaultValue: "None",
        help: "Instansi Pemerintah: faktur kode 02, PPN disetor sendiri oleh pembeli",
      },

      // ---- tab Penjualan: what a new Customer Order starts from (P51).
      {
        name: "default_term_id",
        label: "Termin Pembayaran Default",
        type: "ref",
        ref: "ref_payment_term",
        tab: "sales",
        visibleWhen: "partnerIsCustomer",
        help: "diisikan ke Customer Order baru, tetap dapat diubah",
      },
      {
        name: "default_price_mode",
        label: "Mode Harga Default",
        type: "select",
        tab: "sales",
        visibleWhen: "partnerIsCustomer",
        options: ["Exclude", "Include"],
        optionLabels: { Exclude: "Exclude PPN", Include: "Include PPN" },
        help: "harga diketik sebelum PPN atau sudah termasuk PPN",
      },

      // ---- tab Pembelian: what a new Purchase Order starts from (B2, P122).
      {
        name: "purchase_term_id",
        label: "Termin Pembayaran Default",
        type: "ref",
        ref: "ref_payment_term",
        tab: "purchase",
        visibleWhen: "partnerIsSupplier",
        help: "diisikan ke Purchase Order baru, tetap dapat diubah",
      },
      {
        name: "purchase_price_mode",
        label: "Mode Harga Default",
        type: "select",
        tab: "purchase",
        visibleWhen: "partnerIsSupplier",
        options: ["Exclude", "Include"],
        optionLabels: { Exclude: "Exclude PPN", Include: "Include PPN" },
        help: "harga supplier sebelum PPN atau sudah termasuk PPN",
      },
    ],
    tabs: [
      {
        key: "addresses",
        label: "Alamat",
        icon: "pin",
        desc: "Alamat penagihan (tujuan faktur) dan pengiriman. Minimal satu alamat.",
        kind: "custom",
      },
      {
        key: "contacts",
        label: "Contact Person",
        icon: "users",
        desc: "Orang yang dihubungi pada Partner ini.",
        kind: "custom",
      },
      {
        key: "tax",
        label: "Pajak",
        icon: "file",
        desc: "Identitas yang dicantumkan pada faktur pajak dan bukti potong.",
        kind: "fields",
      },
      {
        key: "sales",
        label: "Penjualan",
        icon: "tags",
        desc: "Nilai awal Customer Order baru untuk customer ini. Semuanya dapat diubah pada Customer Order.",
        kind: "fields",
      },
      {
        key: "purchase",
        label: "Pembelian",
        icon: "box",
        desc: "Nilai awal Purchase Order baru untuk supplier ini. Semuanya dapat diubah pada Purchase Order.",
        kind: "fields",
      },
    ],
    columns: [
      { field: "partner_label", label: "Label", isLabel: true, width: "140px", filter: "text" },
      { field: "partner_name", label: "Nama Partner", primary: true, filter: "text" },
      { field: "category_id", label: "Partner Category", isRef: true, width: "190px", filter: "ref" },
      { field: "status", label: "Status", isStatus: true, width: "120px", filter: "enum" },
    ],
  },

  {
    key: "m_item",
    slug: "item",
    module: "master",
    name: "Item",
    icon: "box",
    desc: "Barang dan jasa yang dijual. Harga dan perlakuan pajak ditentukan pada transaksi.",
    codeField: "item_code",
    codePrefix: "item",
    labelField: "item_label",
    nameField: "item_name",
    statusModel: ACTIVE_STATUS,
    fields: [
      {
        name: "item_type",
        label: "Tipe Item",
        type: "select",
        required: true,
        options: ["Barang", "Jasa"],
        // A category belongs to one type, so a new type empties the choice.
        resets: ["category_id"],
        help: "menentukan kategori yang boleh dipilih",
      },
      {
        name: "category_id",
        label: "Kategori Item",
        type: "ref",
        ref: "sys_item_category",
        refFilter: "itemCategoryByType",
        required: true,
      },
      {
        name: "base_uom_id",
        label: "Satuan Dasar",
        type: "ref",
        ref: "ref_uom",
        required: true,
        help: "satuan hitung; konversi lain dihitung ke satuan ini",
      },
      {
        name: "item_label",
        label: "Label",
        type: "text",
        required: true,
        unique: true,
        ident: true,
        placeholder: "FG-001",
        help: identHelp,
      },
      {
        name: "item_name",
        label: "Nama Item",
        type: "text",
        required: true,
        span: 8,
        placeholder: "Serum Wajah Vitamin C 30 ml",
        help: "nama lengkap, tercetak di dokumen",
      },
      {
        name: "can_sell",
        label: "Penjualan",
        type: "bool",
        span: 3,
        caption: "Dapat Dijual",
        defaultValue: true,
      },
      {
        name: "can_buy",
        label: "Pembelian",
        type: "bool",
        span: 3,
        caption: "Dapat Dibeli",
      },
      {
        name: "track_stock",
        label: "Stok",
        type: "bool",
        span: 3,
        visibleWhen: "itemIsGoods",
        caption: "Kelola Stok",
      },
      {
        name: "has_expiry",
        label: "Kadaluarsa",
        type: "bool",
        span: 3,
        visibleWhen: "itemIsGoods",
        caption: "Memiliki Kadaluarsa",
      },
      STATUS_FIELD,
      NOTE_FIELD,
    ],
    tabs: [
      {
        key: "uoms",
        label: "Konversi Satuan",
        icon: "scale",
        desc: "Satuan lain untuk item ini dan isinya dalam satuan dasar, mis. 1 BOX = 12 PCS.",
        kind: "custom",
      },
    ],
    columns: [
      { field: "item_label", label: "Label", isLabel: true, width: "130px", filter: "text" },
      { field: "item_name", label: "Nama Item", primary: true, filter: "text" },
      { field: "item_type", label: "Tipe", isTag: true, width: "96px", filter: "enum" },
      { field: "category_id", label: "Kategori", isRef: true, width: "210px", filter: "ref" },
      { field: "base_uom_id", label: "Satuan", isRef: true, refLabelOnly: true, width: "96px" },
      { field: "status", label: "Status", isStatus: true, width: "110px", filter: "enum" },
    ],
  },

  {
    key: "m_cash_bank",
    slug: "cash-bank",
    module: "master",
    name: "Cash & Bank",
    icon: "wallet",
    desc: "Resource tempat uang berada. Setiap Cash Bank memiliki Cash Bank Book sendiri.",
    codeField: "cash_bank_code",
    codePrefix: "cbnk",
    labelField: "cash_bank_label",
    nameField: "cash_bank_name",
    statusModel: ACTIVE_STATUS,
    fields: [
      {
        name: "cash_bank_label",
        label: "Label",
        type: "text",
        required: true,
        unique: true,
        ident: true,
        placeholder: "Mandiri IDR",
        help: identHelp,
      },
      {
        name: "cash_bank_name",
        label: "Nama Cash Bank",
        type: "text",
        required: true,
        placeholder: "Bank Mandiri Rupiah",
        help: "nama lengkap",
      },
      {
        name: "cash_bank_type",
        label: "Tipe",
        type: "select",
        required: true,
        options: ["Cash", "Bank"],
        defaultValue: "Bank",
      },
      {
        name: "currency_id",
        label: "Currency",
        type: "ref",
        ref: "ref_currency",
        required: true,
        preset: "base_currency",
        help: "currency resource, bukan currency transaksi",
      },
      {
        name: "account_id",
        label: "Account",
        type: "ref",
        ref: "acc_account",
        required: true,
        refFilter: "cashBankAccount",
        help: "account postable di kelompok Kas/Bank",
      },
      {
        name: "opening_balance",
        label: "Saldo Awal",
        type: "money",
        currencyFrom: "currency_id",
        createOnly: true,
        virtual: true,
        // Starts empty on its placeholder rather than on a literal `0` the user
        // has to delete first — the same as every other amount in the
        // application. A blank field is read as zero by `createRecord`.
        placeholder: "0",
        help: "dicatat sebagai entri pembuka di Cash Bank Book",
      },
      {
        // A foreign resource's opening balance was acquired at some price, and
        // that price starts its moving average — what a later payment out of
        // it releases. Without it the account would hold currency of unknown
        // value.
        name: "opening_rate",
        label: "Kurs Perolehan",
        type: "rate",
        currencyFrom: "currency_id",
        createOnly: true,
        virtual: true,
        visibleWhen: "currencyIsForeign",
        placeholder: "0",
        help: "kurs saat saldo awal itu diperoleh",
      },
      STATUS_FIELD,
      NOTE_FIELD,
    ],
    columns: [
      { field: "cash_bank_label", label: "Label", isLabel: true, width: "118px", filter: "text" },
      { field: "cash_bank_name", label: "Nama Cash Bank", primary: true, filter: "text" },
      { field: "cash_bank_type", label: "Tipe", isTag: true, width: "92px", filter: "enum" },
      { field: "currency_id", label: "Currency", isRef: true, width: "116px", filter: "ref" },
      { field: "account_id", label: "Account", isRef: true, width: "142px", filter: "ref" },
      { field: "balance", label: "Saldo", computed: true, numeric: true, width: "142px" },
      { field: "status", label: "Status", isStatus: true, width: "104px", filter: "enum" },
    ],
  },

  {
    key: "ref_currency",
    slug: "currency",
    module: "master",
    name: "Currency",
    icon: "coin",
    desc: "Referensi mata uang. Base currency pelaporan adalah IDR; transaction currency dan base currency tetap dipisah.",
    codeField: "currency_code",
    codePrefix: "curr",
    labelField: "currency_label",
    nameField: "currency_name",
    statusModel: ACTIVE_STATUS,
    fields: [
      {
        name: "currency_label",
        label: "Label",
        type: "text",
        required: true,
        unique: true,
        ident: true,
        placeholder: "EUR",
        help: "kode ISO mata uang",
      },
      {
        name: "currency_name",
        label: "Nama Currency",
        type: "text",
        required: true,
        placeholder: "Euro",
        help: "nama lengkap",
      },
      STATUS_FIELD,
      NOTE_FIELD,
    ],
    columns: [
      { field: "currency_label", label: "Label", isLabel: true, width: "118px", filter: "text" },
      { field: "currency_name", label: "Nama Currency", primary: true, filter: "text" },
      { field: "cash_bank_count", label: "Cash & Bank", computed: true, numeric: true, width: "112px" },
      { field: "status", label: "Status", isStatus: true, width: "120px", filter: "enum" },
      { field: "note", label: "Catatan", muted: true, truncate: true },
    ],
  },

  {
    key: "ref_uom",
    slug: "uom",
    module: "master",
    name: "Satuan",
    icon: "tags",
    desc: "Satuan hitung barang (PCS, BOX, SET). Konversi antarsatuan ditentukan per barang.",
    codeField: "uom_code",
    codePrefix: "uom",
    labelField: "uom_label",
    nameField: "uom_name",
    statusModel: ACTIVE_STATUS,
    fields: [
      {
        name: "uom_label",
        label: "Label",
        type: "text",
        required: true,
        unique: true,
        ident: true,
        placeholder: "PCS",
        help: "singkatan yang tercetak di dokumen",
      },
      {
        name: "uom_name",
        label: "Nama Satuan",
        type: "text",
        required: true,
        placeholder: "Pieces",
        help: "nama lengkap",
      },
      STATUS_FIELD,
      NOTE_FIELD,
    ],
    columns: [
      { field: "uom_label", label: "Label", isLabel: true, width: "118px", filter: "text" },
      { field: "uom_name", label: "Nama Satuan", primary: true, filter: "text" },
      { field: "status", label: "Status", isStatus: true, width: "120px", filter: "enum" },
      { field: "note", label: "Catatan", muted: true, truncate: true },
    ],
  },

  {
    key: "ref_payment_term",
    slug: "payment-term",
    module: "master",
    name: "Termin Pembayaran",
    single: "Termin",
    icon: "cal",
    desc: "Berapa hari customer boleh membayar setelah tanggal invoice. 0 hari berarti Tunai.",
    codeField: "term_code",
    codePrefix: "term",
    labelField: "term_label",
    nameField: "term_name",
    statusModel: ACTIVE_STATUS,
    fields: [
      {
        name: "term_label",
        label: "Label",
        type: "text",
        required: true,
        unique: true,
        ident: true,
        placeholder: "N30",
        help: identHelp,
      },
      {
        name: "term_name",
        label: "Nama Termin",
        type: "text",
        required: true,
        placeholder: "Net 30 hari",
        help: "nama yang tercetak di faktur",
      },
      {
        name: "due_days",
        label: "Jumlah Hari",
        type: "number",
        required: true,
        placeholder: "30",
        help: "jatuh tempo = tanggal invoice + hari ini",
      },
      STATUS_FIELD,
      NOTE_FIELD,
    ],
    columns: [
      { field: "term_label", label: "Label", isLabel: true, width: "118px", filter: "text" },
      { field: "term_name", label: "Nama Termin", primary: true, filter: "text" },
      { field: "due_days", label: "Hari", numeric: true, width: "96px" },
      { field: "status", label: "Status", isStatus: true, width: "120px", filter: "enum" },
      { field: "note", label: "Catatan", muted: true, truncate: true },
    ],
  },

  {
    key: "ref_warehouse",
    slug: "warehouse",
    module: "master",
    name: "Gudang",
    icon: "build",
    desc: "Tempat stok disimpan. Gudang dengan Gunakan Lokasi mencatat stok per lokasi di dalamnya.",
    codeField: "warehouse_code",
    codePrefix: "whse",
    labelField: "warehouse_label",
    nameField: "warehouse_name",
    statusModel: ACTIVE_STATUS,
    fields: [
      {
        name: "warehouse_label",
        label: "Label",
        type: "text",
        required: true,
        unique: true,
        ident: true,
        placeholder: "GD-CKR",
        help: identHelp,
      },
      {
        name: "warehouse_name",
        label: "Nama Gudang",
        type: "text",
        required: true,
        placeholder: "Gudang Cikarang",
        help: "nama lengkap",
      },
      {
        name: "use_location",
        label: "Lokasi",
        type: "bool",
        span: 4,
        caption: "Gunakan Lokasi",
        help: "stok dicatat per lokasi; hanya bisa diubah saat gudang kosong",
      },
      STATUS_FIELD,
      NOTE_FIELD,
    ],
    tabs: [
      {
        key: "locations",
        label: "Lokasi",
        icon: "layers",
        desc: "Tempat di dalam gudang — rak, baris, bin — tempat stok disimpan. Ditampilkan sebagai Gudang-Lokasi, mis. GD-CKR-A-01.",
        kind: "custom",
        shownWhen: "warehouseUsesLocation",
      },
    ],
    columns: [
      { field: "warehouse_label", label: "Label", isLabel: true, width: "130px", filter: "text" },
      { field: "warehouse_name", label: "Nama Gudang", primary: true, filter: "text" },
      { field: "status", label: "Status", isStatus: true, width: "120px", filter: "enum" },
      { field: "note", label: "Catatan", muted: true, truncate: true },
    ],
  },

  {
    key: "ref_withholding_tax",
    slug: "withholding-tax",
    module: "master",
    name: "Jenis PPh",
    icon: "calc",
    desc: "PPh yang dipotong customer dari perusahaan (Penjualan) atau dipotong perusahaan dari supplier (Pembelian): tarif, objek pajak dan akunnya.",
    codeField: "wht_code",
    codePrefix: "wht",
    labelField: "wht_label",
    nameField: "wht_name",
    statusModel: ACTIVE_STATUS,
    fields: [
      {
        name: "wht_label",
        label: "Label",
        type: "text",
        required: true,
        unique: true,
        ident: true,
        placeholder: "PPH23",
        help: identHelp,
      },
      {
        name: "wht_name",
        label: "Nama Jenis PPh",
        type: "text",
        required: true,
        placeholder: "PPh Pasal 23 — Jasa",
        help: "nama lengkap",
      },
      {
        // One record never serves both sides (P122): the two hit opposite
        // accounts — an asset when the customer withholds, a liability when
        // the company does — and a document offers only its own side's.
        name: "usage",
        label: "Penggunaan",
        type: "select",
        required: true,
        createOnly: true,
        options: ["Sales", "Purchase"],
        optionLabels: { Sales: "Penjualan", Purchase: "Pembelian" },
        defaultValue: "Sales",
        help: "Penjualan: dipotong customer · Pembelian: dipotong perusahaan",
      },
      {
        name: "rate",
        label: "Tarif",
        type: "percent",
        required: true,
        placeholder: "2",
        help: "persen dari DPP",
      },
      {
        name: "account_id",
        label: "Akun PPh",
        type: "ref",
        ref: "acc_account",
        refFilter: "postableAccount",
        span: 8,
        help: "Penjualan: PPh Dibayar Dimuka (aset) · Pembelian: Hutang PPh (kewajiban)",
      },
      {
        name: "tax_object",
        label: "Objek Pajak",
        type: "textarea",
        full: true,
        placeholder: "Penghasilan yang dikenai PPh ini…",
      },
      STATUS_FIELD,
      NOTE_FIELD,
    ],
    columns: [
      { field: "wht_label", label: "Label", isLabel: true, width: "130px", filter: "text" },
      { field: "wht_name", label: "Nama Jenis PPh", primary: true, filter: "text" },
      { field: "usage", label: "Penggunaan", isTag: true, width: "120px", filter: "enum" },
      { field: "rate", label: "Tarif", isPercent: true, numeric: true, width: "96px" },
      { field: "account_id", label: "Akun PPh", isRef: true, width: "240px" },
      { field: "status", label: "Status", isStatus: true, width: "120px", filter: "enum" },
    ],
  },

  {
    // Not an Item (Perizinan-Concept.md Z2): a permit has no unit or quantity
    // and only ever appears on the Pengajuan's internal list.
    key: "ref_permit_type",
    slug: "permit-type",
    module: "master",
    name: "Jenis Perizinan",
    icon: "clip",
    desc: "Perizinan yang diurus untuk produk customer maklon, beserta estimasi harga standarnya. Bukan barang — tanpa satuan maupun stok.",
    codeField: "permit_code",
    codePrefix: "izn",
    labelField: "permit_label",
    nameField: "permit_name",
    statusModel: ACTIVE_STATUS,
    fields: [
      {
        name: "permit_label",
        label: "Label",
        type: "text",
        required: true,
        unique: true,
        ident: true,
        placeholder: "IZ-001",
        help: identHelp,
      },
      {
        name: "permit_name",
        label: "Nama Perizinan",
        type: "text",
        required: true,
        placeholder: "Registrasi Notifikasi BPOM",
      },
      {
        name: "category",
        label: "Kategori",
        type: "select",
        required: true,
        options: ["Regulatory", "Laboratory", "Certification", "IntellectualProperty"],
        optionLabels: {
          Regulatory: "Regulatori",
          Laboratory: "Laboratorium",
          Certification: "Sertifikasi",
          IntellectualProperty: "Kekayaan Intelektual",
        },
        defaultValue: "Regulatory",
      },
      {
        name: "standard_estimate",
        label: "Harga Estimasi Standar",
        type: "money",
        placeholder: "0",
        help: "sebelum PPN; awal harga estimasi di Pengajuan, dapat diubah",
      },
      {
        name: "default_description",
        label: "Uraian Default",
        type: "textarea",
        full: true,
        placeholder: "Uraian yang muncul saat perizinan ini dipilih di Pengajuan…",
      },
      STATUS_FIELD,
      NOTE_FIELD,
    ],
    columns: [
      { field: "permit_label", label: "Label", isLabel: true, width: "118px", filter: "text" },
      { field: "permit_name", label: "Nama Perizinan", primary: true, filter: "text" },
      { field: "category", label: "Kategori", isTag: true, width: "170px", filter: "enum" },
      { field: "standard_estimate", label: "Harga Estimasi", numeric: true, width: "150px" },
      { field: "status", label: "Status", isStatus: true, width: "120px", filter: "enum" },
    ],
  },

  // ------------------------------------------------------ pengaturan

  {
    key: "sys_partner_category",
    slug: "partner-category",
    module: "settings",
    name: "Partner Category",
    icon: "users",
    desc: "Jenis Partner — Customer dan Supplier. Account yang wajib Partner menyebut satu Partner Category.",
    codeField: "category_code",
    codePrefix: "pcat",
    labelField: "category_label",
    nameField: "category_name",
    statusModel: ACTIVE_STATUS,
    fields: [
      {
        name: "category_label",
        label: "Label",
        type: "text",
        required: true,
        unique: true,
        ident: true,
        span: 4,
        placeholder: "Customer",
        help: identHelp,
      },
      {
        name: "category_name",
        label: "Nama Partner Category",
        type: "text",
        required: true,
        span: 8,
        placeholder: "Pelanggan",
        help: "nama lengkap",
      },
      STATUS_FIELD,
      NOTE_FIELD,
    ],
    columns: [
      { field: "category_label", label: "Label", isLabel: true, width: "130px", filter: "text" },
      { field: "category_name", label: "Nama Partner Category", primary: true, filter: "text" },
      { field: "partner_count", label: "Partner", computed: true, numeric: true, width: "92px" },
      { field: "status", label: "Status", isStatus: true, width: "110px", filter: "enum" },
    ],
  },

  // ------------------------------------------------- accounting · chart of accounts

  {
    key: "acc_account",
    slug: "account",
    module: "accounting",
    name: "Chart of Accounts",
    single: "Account",
    icon: "book",
    desc: "Bagan akun perusahaan. Account adalah subjek utama General Ledger.",
    codeField: "account_code",
    codePrefix: "coa",
    labelField: "account_label",
    nameField: "account_name",
    view: "tree",
    statusModel: { field: "is_active", kind: "bool", options: ["true", "false"], toggle: true },
    fields: [
      {
        name: "account_subcategory_id",
        label: "Kelompok Account",
        type: "ref",
        ref: "acc_account_subcategory",
        required: true,
        locked: true,
        resets: ["parent_account"],
        help: "menentukan posisi dan awal nomor account",
      },
      {
        name: "parent_account",
        label: "Parent Account",
        type: "ref",
        ref: "acc_account",
        refFilter: "parentAccount",
        locked: true,
        help: "opsional — nomornya melanjutkan nomor parent",
      },
      {
        name: "account_segment",
        label: "Nomor Urut",
        type: "segment",
        required: true,
        virtual: true,
        createOnly: true,
        inheritsFrom: ["parent_account", "account_subcategory_id"],
        writesTo: "account_label",
        placeholder: "1",
        help: "1–999, unik di bawah induk yang sama",
      },
      {
        name: "account_label",
        label: "Nomor Account",
        type: "text",
        required: true,
        derived: true,
        locked: true,
        ident: true,
        help: "dibentuk otomatis dari induk + nomor urut",
      },
      {
        name: "account_name",
        label: "Nama Account",
        type: "text",
        required: true,
        placeholder: "Persediaan",
        help: "nama lengkap",
      },
      {
        name: "normal_balance",
        label: "Normal Balance",
        type: "select",
        required: true,
        options: ["Debit", "Kredit"],
        defaultValue: "Debit",
      },
      {
        name: "require_partner",
        label: "Require Partner",
        type: "bool",
        defaultValue: false,
        resets: ["partner_category_id"],
        caption: "Wajib mengisi Partner",
      },
      {
        name: "partner_category_id",
        label: "Partner Category",
        type: "ref",
        ref: "sys_partner_category",
        required: true,
        visibleWhen: "accountRequiresPartner",
        help: "satu Account menampung satu Partner Category",
      },
      {
        // Chosen by the user (Claude-ERP.md P16), as it was before SIBA made
        // it derived from the structure. It marks an account whose balance a
        // document's posting keeps in step with a book outside the General
        // Ledger — Kas & Bank, Piutang, Hutang — and the manual journal
        // refuses it, so the two cannot drift apart by a hand-typed line.
        name: "is_control_account",
        label: "Control Account",
        type: "bool",
        defaultValue: false,
        caption: "Control account",
        captionDetail:
          "Hanya diisi lewat posting dokumen. Journal Manual tidak dapat memakai account ini.",
      },
      {
        name: "is_active",
        label: "Aktif",
        type: "bool",
        defaultValue: true,
        caption: "Account aktif",
      },
      NOTE_FIELD,
    ],
    columns: [
      { field: "account_label", label: "Account", isLabel: true, width: "116px", filter: "text" },
      { field: "account_name", label: "Nama Account", primary: true, filter: "text" },
      { field: "account_subcategory_id", label: "Kelompok", isRef: true, width: "196px", filter: "ref" },
      { field: "normal_balance", label: "Normal", isTag: true, width: "96px", filter: "enum" },
      { field: "partner_category_id", label: "Partner Cat.", isRef: true, refLabelOnly: true, width: "116px", filter: "ref" },
      { field: "is_active", label: "Status", isBool: true, width: "100px", filter: "bool" },
    ],
  },

  // ------------------------------------------------ accounting · period control

  {
    key: "acc_fiscal_year",
    slug: "fiscal-year",
    module: "accounting",
    name: "Fiscal Year",
    icon: "cal",
    desc: "Tahun buku. Periode bulanan di dalamnya dibuat otomatis saat tahun buku diaktifkan.",
    codeField: "year_code",
    codePrefix: "fyr",
    labelField: "year_label",
    nameField: "year_name",
    statusModel: FISCAL_STATUS,
    fields: [
      {
        name: "year_label",
        label: "Tahun",
        type: "select",
        options: YEAR_OPTIONS,
        required: true,
        unique: true,
        ident: true,
        locked: true,
        help:
          "Cukup pilih tahunnya. Nama, tanggal mulai 01/01, dan tanggal selesai " +
          "31/12 mengikuti otomatis dan tidak dapat diubah terpisah.",
      },
      { name: "year_name", label: "Nama Tahun Buku", type: "text", derived: true },
      { name: "start_date", label: "Tanggal Mulai", type: "date", derived: true },
      { name: "end_date", label: "Tanggal Selesai", type: "date", derived: true },
      {
        // A fiscal year's status is its lifecycle, not an isian: it is created
        // as Draft, activated into Open — which is what generates the twelve
        // periods — and closed by a process of its own. Derived and locked, so
        // neither form nor a submitted value can move it. See
        // `fiscal-workflow.ts` and `app/actions/fiscal.ts`.
        ...FISCAL_STATUS_FIELD,
        derived: true,
        locked: true,
        help:
          "Draft belum dipakai · Open menerima posting dan memiliki 12 Fiscal " +
          "Period · Closed terkunci.",
      },
      NOTE_FIELD,
    ],
    columns: [
      { field: "year_label", label: "Tahun", isLabel: true, width: "108px", filter: "text" },
      { field: "year_name", label: "Nama Tahun Buku", primary: true, filter: "text" },
      { field: "start_date", label: "Mulai", isDate: true, width: "126px" },
      { field: "end_date", label: "Selesai", isDate: true, width: "126px" },
      { field: "period_count", label: "Period", computed: true, numeric: true, width: "94px" },
      { field: "status", label: "Status", isStatus: true, width: "118px", filter: "enum" },
    ],
  },
];

export function entityBySlug(slug: string): Entity | undefined {
  return ENTITIES.find((e) => e.slug === slug);
}

export function entityByKey(key: string): Entity | undefined {
  return ENTITIES.find((e) => e.key === key);
}

/** Label shown on the create button. */
export function createLabel(entity: Entity): string {
  return `Tambah ${entity.single ?? entity.name}`;
}

/**
 * The fields that have to be answered before this one can be, in form order.
 *
 * Derived from `resets` rather than declared a second time. A field that
 * clears another when it changes *is* a field that other one depends on —
 * Kelompok Account clears Parent Account because a parent sits in one — so
 * stating the dependency twice would be a rule with two answers, and the two
 * would drift the first time one of them was edited alone.
 *
 * A `bool` never counts: it is always answered, one way or the other. A field
 * that does not apply is skipped, so a hidden field never blocks the ones
 * behind it.
 */
export function prerequisitesOf(
  entity: Entity,
  field: Field,
  values: Record<string, unknown>,
  applies: (f: Field) => boolean
): Field[] {
  return entity.fields.filter(
    (f) =>
      f.type !== "bool" &&
      (f.resets?.includes(field.name) ?? false) &&
      applies(f) &&
      (values[f.name] == null || values[f.name] === "")
  );
}

/**
 * What a picker says while it waits — `Pilih Kelompok Account
 * dulu…`, in the same `Pilih <what>…` shape every prompt in the application
 * uses (CLAUDE.md §8).
 */
export function waitingClause(missing: Field[]): string | null {
  if (!missing.length) return null;
  const names = missing.map((f) => f.label);
  const list =
    names.length > 1
      ? `${names.slice(0, -1).join(", ")} dan ${names[names.length - 1]}`
      : names[0];
  return `Pilih ${list} dulu…`;
}

/** Whether a tab is in play, given the values currently entered — a Gudang's Lokasi tab only with Gunakan Lokasi. */
export function tabApplies(tab: EntityTab, values: Record<string, unknown>): boolean {
  if (tab.shownWhen === "warehouseUsesLocation") return values.use_location === true || values.use_location === "true";
  return true;
}

/** Whether a field applies, given the values currently entered. */
export function fieldApplies(
  field: Field,
  values: Record<string, unknown>,
  /** The short label of the row a ref field currently points at. */
  refLabelOf?: (fieldName: string, id: unknown) => string | undefined
): boolean {
  if (!field.visibleWhen) return true;
  if (field.visibleWhen === "accountRequiresPartner") {
    const v = values.require_partner;
    return v === true || v === "true";
  }
  if (field.visibleWhen === "itemIsGoods") {
    return values.item_type === "Barang";
  }
  if (field.visibleWhen === "partnerIsCustomer") {
    return refLabelOf?.("category_id", values.category_id) === CUSTOMER_CATEGORY;
  }
  if (field.visibleWhen === "partnerIsSupplier") {
    return refLabelOf?.("category_id", values.category_id) === SUPPLIER_CATEGORY;
  }
  // currencyIsForeign
  const label = refLabelOf?.("currency_id", values.currency_id);
  // Nothing chosen yet is not foreign: the field appears once the answer is
  // known, rather than flickering in on an empty picker.
  return label ? !isBaseCurrency(label) : false;
}

/** The seeded Partner Category a sale is made to (prisma/seed.ts). */
export const CUSTOMER_CATEGORY = "Customer";

/** The seeded Partner Category a purchase is made from (prisma/seed.ts). */
export const SUPPLIER_CATEGORY = "Supplier";

export const STATUS_TEXT: Record<string, string> = {
  Active: "Aktif",
  Inactive: "Non Aktif",
  Open: "Open",
  Draft: "Draft",
  Closed: "Closed",
  Posted: "Posted",
  Cancelled: "Dibatalkan",
  true: "Aktif",
  false: "Non Aktif",
};

export const STATUS_CLASS: Record<string, string> = {
  Active: "s-ok",
  Open: "s-ok",
  Posted: "s-ok",
  Inactive: "s-bad",
  Draft: "s-warn",
  Closed: "s-mute",
  Cancelled: "s-mute",
  true: "s-ok",
  false: "s-bad",
};

export const TAG_CLASS: Record<string, string> = {
  Bank: "t-info",
  Cash: "t-vio",
  Debit: "t-info",
  Kredit: "t-acc",
  Barang: "t-info",
  Jasa: "t-vio",
};

/** The value a status model treats as "active". */
export function isActiveStatus(model: StatusModel, raw: unknown): boolean {
  return model.kind === "bool" ? raw === true : raw === "Active";
}
