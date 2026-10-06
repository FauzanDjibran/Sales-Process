/**
 * Development showcase data — the simulation's demo world, so a freshly reset
 * database can be used straight away (Claude-ERP.md P11, §5).
 *
 * **Development only.** This is business data, not system data: it never runs
 * as part of `db:seed`, never in production, and nothing in the application
 * depends on it. Run it after `npm run db:seed` (or use `npm run db:fresh`).
 *
 * What it creates, taken from `Initialization/actual-simulation-v2.html`:
 *   Gudang (Satuan, Termin and currencies come from the system seed, P62)
 *   the accounts the sales flow posts to, under the seeded chart skeleton
 *   Account Mapping (Selisih Kurs, Laba/Rugi, Uang Muka, PPN, Beban Bank,
 *   HPP, Persediaan, Piutang Usaha, Penjualan) and the Jenis PPh accounts
 *   two rupiah bank accounts (Cash & Bank, each with its book)
 *   the current calendar year as an Open Fiscal Year with its twelve periods
 *   the simulation's customers, with tax identity, addresses and contacts
 *   the simulation's finished goods, with their box conversions
 *   a Harga Pokok (Sementara) per item and two lots per item per warehouse
 *
 * Not created: opening balances (they start empty, P27), documents, and the
 * perizinan services (set aside).
 *
 * **Idempotent and additive.** Every record is matched on its label or name —
 * the thing a person would recognise — and created only when missing. An
 * existing record is never changed, and a setting or account pointer the user
 * has already filled is left alone. Running it twice creates nothing twice.
 *
 * It writes the same rows the application's forms would, with generated
 * codes, the Sistem user as author, a `create` audit entry for every master
 * record and a Cash Bank Book for every bank account. It goes to the
 * database directly rather than through the Server Actions, which need a
 * signed-in user; the data is fixed, and the arithmetic of the application is
 * not involved.
 */
import { prisma } from "../src/lib/prisma";
import { ENTITIES } from "../src/lib/erp/entities";
import { CASH_BANK_SUBCATEGORY, nextCode } from "../src/lib/erp/records";
import { openCashBankBook } from "../src/lib/erp/cash-bank";
import { ensureFiscalPeriods, fiscalYearShape } from "../src/lib/erp/fiscal";
import { BASE_CURRENCY_LABEL } from "../src/lib/erp/currency";
import { CUSTOMER_CATEGORY } from "../src/lib/erp/entities";
import { injectStock, type InjectionRow } from "../src/lib/erp/inventory";

// ------------------------------------------------------------------- data

const WAREHOUSES: [label: string, name: string][] = [
  ["GD-CKR", "Gudang Cikarang"],
  ["GD-SBY", "Gudang Surabaya"],
];

type AccountSpec = {
  key: string;
  /** The seeded Account Subcategory the account sits under. */
  sub: string;
  name: string;
  normal: "Debit" | "Kredit";
  /** Every line names a Partner of this category (P25). */
  partner?: boolean;
  /** Posted by documents only; the manual journal refuses it (P16). */
  control?: boolean;
  note?: string;
};

const ACCOUNTS: AccountSpec[] = [
  { key: "bca", sub: CASH_BANK_SUBCATEGORY, name: "Bank BCA", normal: "Debit", control: true, note: "Rekening penerimaan 123-456-7890" },
  { key: "mandiri", sub: CASH_BANK_SUBCATEGORY, name: "Bank Mandiri", normal: "Debit", control: true, note: "Rekening penerimaan 070-00-1234567-8" },
  { key: "ar", sub: "1.1.3", name: "Piutang Usaha", normal: "Debit", partner: true, control: true, note: "Tagihan faktur penjualan yang belum dibayar, per customer" },
  { key: "inventory", sub: "1.1.5", name: "Persediaan Barang Jadi", normal: "Debit", control: true },
  { key: "pph23", sub: "1.1.7", name: "PPh 23 Dibayar Dimuka", normal: "Debit", note: "PPh 23 yang dipotong customer — dikreditkan dengan bukti potong" },
  { key: "pph22", sub: "1.1.7", name: "PPh 22 Dibayar Dimuka", normal: "Debit", note: "PPh 22 yang dipungut pembeli atas barang" },
  { key: "vat", sub: "2.1.2", name: "PPN Keluaran", normal: "Kredit", control: true, note: "PPN terutang atas penyerahan dan uang muka" },
  { key: "advance", sub: "2.1.4", name: "Uang Muka Penjualan", normal: "Kredit", partner: true, control: true, note: "Kewajiban menyerahkan barang atas uang muka yang sudah diterima" },
  { key: "capital", sub: "3.1.1", name: "Modal Disetor", normal: "Kredit" },
  { key: "plPrior", sub: "3.3.1", name: "Laba/Rugi Tahun Sebelumnya", normal: "Kredit" },
  { key: "plCurrent", sub: "3.4.1", name: "Laba/Rugi Tahun Berjalan", normal: "Kredit" },
  { key: "sales", sub: "4.1.1", name: "Penjualan Barang", normal: "Kredit" },
  { key: "returns", sub: "4.1.8", name: "Retur Penjualan", normal: "Debit" },
  { key: "otherIncome", sub: "4.9.1", name: "Pendapatan Lain-lain", normal: "Kredit" },
  { key: "fx", sub: "4.9.1", name: "Laba/Rugi Selisih Kurs", normal: "Kredit" },
  { key: "cogs", sub: "5.1.1", name: "HPP Barang", normal: "Debit" },
  { key: "bankFee", sub: "5.3.1", name: "Beban Bank", normal: "Debit" },
  { key: "admin", sub: "5.3.1", name: "Beban Umum & Administrasi", normal: "Debit" },
];

/** Account Mapping keys → the account each points at (only when unset). */
const MAPPINGS: [setting: string, account: string][] = [
  ["fx_account", "fx"],
  ["accumulated_pl_account", "plPrior"],
  ["current_pl_account", "plCurrent"],
  ["sales_advance_account", "advance"],
  ["output_vat_account", "vat"],
  ["bank_charge_account", "bankFee"],
  ["cogs_account", "cogs"],
  ["inventory_account", "inventory"],
  ["receivable_account", "ar"],
  ["sales_revenue_account", "sales"],
];

/** Jenis PPh label → its PPh Dibayar Dimuka account (only when unset). */
const WHT_ACCOUNTS: [whtLabel: string, account: string][] = [
  ["PPH22", "pph22"],
  ["PPH23", "pph23"],
  ["PPH23-15", "pph23"],
];

const CASH_BANKS: [label: string, name: string, account: string][] = [
  ["BCA", "Bank BCA · 123-456-7890", "bca"],
  ["MANDIRI", "Bank Mandiri · 070-00-1234567-8", "mandiri"],
];

type Address = { city: string; district: string; street: string; note?: string; billing?: boolean; shipping?: boolean };

type CustomerSpec = {
  label: string;
  name: string;
  active?: boolean;
  taxpayer: "Badan" | "OrangPribadi" | "InstansiPemerintah";
  idType: "NPWP" | "NIK";
  taxId: string;
  taxName?: string;
  pkp: boolean;
  pph23?: boolean;
  pph22?: boolean;
  government?: boolean;
  term: string;
  mode: "Exclude" | "Include";
  addresses: Address[];
  contact?: [name: string, position: string, phone: string, email: string];
};

const CUSTOMERS: CustomerSpec[] = [
  {
    label: "C-001", name: "PT Sentosa Retail Nusantara", taxpayer: "Badan", idType: "NPWP", taxId: "0987654321098765",
    pkp: true, pph23: true, term: "NET30", mode: "Exclude",
    addresses: [
      { city: "Kota Administrasi Jakarta Selatan", district: "Setiabudi", street: "Jl. Gatot Subroto Kav. 21", note: "Kantor Pusat", billing: true },
      { city: "Kota Bekasi", district: "Bekasi Timur", street: "Jl. Ahmad Yani No. 9", note: "Cabang Bekasi", billing: true },
      { city: "Kota Administrasi Jakarta Timur", district: "Cakung", street: "Kawasan Industri Pulogadung Blok C-4", note: "Gudang Pusat Cakung", shipping: true },
      { city: "Kota Bekasi", district: "Rawalumbu", street: "Jl. Raya Narogong Km 7", note: "DC Bekasi", shipping: true },
    ],
    contact: ["Bpk. Hadi Santoso", "Purchasing", "0812 8800 1122", "hadi.santoso@sentosa.example"],
  },
  {
    label: "C-002", name: "CV Mitra Sehat Abadi", taxpayer: "Badan", idType: "NPWP", taxId: "0765432109876543",
    pkp: true, term: "NET30", mode: "Include",
    addresses: [
      { city: "Kota Surabaya", district: "Tegalsari", street: "Jl. Diponegoro No. 88", note: "Kantor Pusat", billing: true },
      { city: "Kota Surabaya", district: "Wonokromo", street: "Jl. Raya Darmo No. 51", note: "Apotek Mitra Sehat Darmo", shipping: true },
      { city: "Kota Surabaya", district: "Rungkut", street: "Jl. Rungkut Industri I No. 14", note: "Apotek Mitra Sehat Rungkut", shipping: true },
    ],
    contact: ["Ibu Maya Kartika", "Pemilik", "0813 3120 4455", "maya.kartika@mitrasehat.example"],
  },
  {
    label: "C-003", name: "PT Apotek Prima Medika", taxpayer: "Badan", idType: "NPWP", taxId: "0543210987654321",
    pkp: true, pph23: true, term: "NET30", mode: "Include",
    addresses: [
      { city: "Kota Bandung", district: "Sumur Bandung", street: "Jl. Asia Afrika No. 120", note: "Kantor Pusat", billing: true },
      { city: "Kota Cimahi", district: "Cimahi Tengah", street: "Jl. Amir Machmud No. 310", note: "Cabang Cimahi", billing: true },
      { city: "Kota Bandung", district: "Bandung Kidul", street: "Jl. Soekarno-Hatta No. 590", note: "Gudang Bandung", shipping: true },
    ],
    contact: ["Bpk. Yusuf Hakim", "Purchasing", "0822 1700 9080", "yusuf.hakim@primamedika.example"],
  },
  {
    label: "C-004", name: "Toko Kosmetik Cantik Jaya", taxpayer: "OrangPribadi", idType: "NIK", taxId: "3174051234560001",
    taxName: "Lina Marlina", pkp: false, term: "NET7", mode: "Include",
    addresses: [
      { city: "Kota Administrasi Jakarta Pusat", district: "Sawah Besar", street: "Pasar Baru Blok B-17", note: "Toko Pasar Baru", billing: true, shipping: true },
    ],
    contact: ["Ibu Lina Marlina", "Pemilik", "0857 7788 1200", "lina.marlina@cantikjaya.example"],
  },
  {
    label: "C-005", name: "PT Klinik Estetika Sejahtera", taxpayer: "Badan", idType: "NPWP", taxId: "0321098765432109",
    pkp: true, pph23: true, term: "NET30", mode: "Exclude",
    addresses: [
      { city: "Kota Semarang", district: "Semarang Tengah", street: "Jl. Pemuda No. 45", note: "Kantor Pusat / Klinik Pemuda", billing: true, shipping: true },
      { city: "Kabupaten Sukoharjo", district: "Grogol", street: "Jl. Ir. Soekarno No. 12, Solo Baru", note: "Klinik Solo Baru", shipping: true },
    ],
    contact: ["Ibu Ratna Dewi", "Manajer Klinik", "0811 2900 3344", "ratna.dewi@estetika.example"],
  },
  {
    label: "C-006", name: "PT Glowindo Brand Kreasi", taxpayer: "Badan", idType: "NPWP", taxId: "0612345678901234",
    pkp: true, pph23: true, term: "NET30", mode: "Exclude",
    addresses: [
      { city: "Kota Tangerang Selatan", district: "Serpong", street: "Jl. BSD Grand Boulevard No. 8", note: "Kantor Pusat", billing: true },
      { city: "Kota Tangerang Selatan", district: "Setu", street: "Taman Tekno BSD Blok H-3", note: "Gudang BSD", shipping: true },
    ],
    contact: ["Ibu Nadia Putri", "Supply Chain", "0812 9090 7766", "nadia.putri@glowindo.example"],
  },
  {
    label: "C-007", name: "RSUD Sukamakmur", taxpayer: "InstansiPemerintah", idType: "NPWP", taxId: "0045678901234567",
    pkp: false, pph23: true, pph22: true, government: true, term: "NET45", mode: "Exclude",
    addresses: [
      { city: "Kabupaten Bogor", district: "Sukamakmur", street: "Jl. Kesehatan No. 1", note: "Bendahara RSUD", billing: true },
      { city: "Kabupaten Bogor", district: "Sukamakmur", street: "Jl. Kesehatan No. 1, Gedung B", note: "Instalasi Farmasi", shipping: true },
    ],
    contact: ["Bpk. Agus Salim", "PPK", "0266 555 0101", "agus.salim@rsud-sukamakmur.example"],
  },
  {
    label: "C-008", name: "PT Dermaskin Laboratories", active: false, taxpayer: "Badan", idType: "NPWP", taxId: "0234567890123456",
    pkp: true, pph23: true, term: "NET30", mode: "Exclude",
    addresses: [
      { city: "Kota Administrasi Jakarta Barat", district: "Kalideres", street: "Jl. Daan Mogot Km 12", note: "Kantor Pusat", billing: true, shipping: true },
    ],
  },
  {
    label: "C-009", name: "CV Ayu Beauty Supply", taxpayer: "Badan", idType: "NPWP", taxId: "0456789012345678",
    pkp: true, term: "NET14", mode: "Include",
    addresses: [{ city: "Kota Malang", district: "Klojen", street: "Jl. Ijen No. 27", note: "Toko Ijen", billing: true, shipping: true }],
    contact: ["Ibu Ayu Lestari", "Pemilik", "0341 777 2020", "ayu.lestari@ayubeauty.example"],
  },
  {
    label: "C-010", name: "PT Bina Farma Nusantara (Persero)", taxpayer: "Badan", idType: "NPWP", taxId: "0198765432109876",
    pkp: true, pph23: true, pph22: true, term: "NET30", mode: "Exclude",
    addresses: [
      { city: "Kota Administrasi Jakarta Pusat", district: "Gambir", street: "Jl. Medan Merdeka Timur No. 16", note: "Kantor Pusat", billing: true },
      { city: "Kota Administrasi Jakarta Timur", district: "Pulogadung", street: "Jl. Rawa Gelam IV No. 7", note: "Gudang Distribusi Pulogadung", shipping: true },
    ],
    contact: ["Ibu Sri Handayani", "Pengadaan", "021 344 9900", "sri.handayani@binafarma.example"],
  },
];

/** Finished goods: label, name, base unit, [unit, factor] conversions. */
const ITEMS: [label: string, name: string, base: string, conversions: [string, number][]][] = [
  ["FG-001", "Serum Wajah Vitamin C 30 ml", "PCS", [["BOX", 12]]],
  ["FG-002", "Sunscreen SPF 50 PA++++ 50 ml", "PCS", [["BOX", 12]]],
  ["FG-003", "Facial Wash Gentle 100 ml", "PCS", [["BOX", 24]]],
  ["FG-004", "Lip Balm Natural 10 g", "PCS", [["BOX", 48]]],
  ["FG-005", "Toner Hydrating 150 ml", "PCS", [["BOX", 12]]],
  ["FG-006", "Night Cream Retinol 30 g", "PCS", [["BOX", 12]]],
  ["FG-007", "Body Lotion Brightening 200 ml", "PCS", [["BOX", 12]]],
  ["FG-008", "Paket Perawatan Kulit Klinik (1 set)", "SET", []],
];

/**
 * Opening stock (P120), injected through the inventory book as `db:stock-inject`
 * does: two lots per item in each warehouse, at a cost per base unit, so a
 * Delivery Note can be picked and posted straight away. No journal is written.
 */
const ITEM_COSTS: Record<string, number> = {
  "FG-001": 38_000, "FG-002": 42_000, "FG-003": 18_500, "FG-004": 9_000,
  "FG-005": 27_500, "FG-006": 51_000, "FG-007": 31_000, "FG-008": 240_000,
};
const OPENING_QTY = 500;
const LOTS: [suffix: string, monthsToExpiry: number][] = [["A", 14], ["B", 26]];

// ---------------------------------------------------------------- helpers

const made: Record<string, number> = {};
const skipped: string[] = [];
const tally = (what: string) => (made[what] = (made[what] ?? 0) + 1);

const entity = (key: string) => {
  const e = ENTITIES.find((x) => x.key === key);
  if (!e) throw new Error(`Registry entity ${key} not found`);
  return e;
};

let actor = 0;

async function audit(entityKey: string, rowId: number) {
  await prisma.auditLog.create({
    data: { entity_key: entityKey, row_id: rowId, action: "TAMBAH", event: "create", by: actor },
  });
}

/** The next free account number directly under a subcategory: `1.1.3` → `1.1.3.2`. */
async function nextAccountLabel(sub: string): Promise<string> {
  const rows = await prisma.accAccount.findMany({
    where: { account_label: { startsWith: `${sub}.` } },
    select: { account_label: true },
  });
  let max = 0;
  for (const r of rows) {
    const rest = r.account_label.slice(sub.length + 1);
    const n = Number(rest.split(".")[0]);
    if (Number.isInteger(n) && n > max) max = n;
  }
  return `${sub}.${max + 1}`;
}

/** A kelurahan in the named kecamatan of the named kota / kabupaten. */
async function villageFor(a: Address): Promise<number> {
  const city = await prisma.sysRegionCity.findFirst({ where: { name: { equals: a.city, mode: "insensitive" } } });
  if (!city) throw new Error(`Region not found: ${a.city} — has npm run db:seed loaded the regions?`);
  // Refused rather than guessed: a silent fallback would put an address in
  // the wrong kecamatan, which a Faktur Pajak would later print.
  const district = await prisma.sysRegionDistrict.findFirst({
    where: { city_id: city.id, name: { equals: a.district, mode: "insensitive" } },
  });
  if (!district) throw new Error(`Kecamatan not found: ${a.district}, ${a.city}`);
  const village = await prisma.sysRegionVillage.findFirst({
    where: { district_id: district.id },
    orderBy: { name: "asc" },
  });
  if (!village) throw new Error(`No kelurahan found in ${a.district}, ${a.city}`);
  return village.id;
}

// ------------------------------------------------------------------- main

async function main() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("seed-showcase is development data and never runs in production.");
  }

  const sistem = await prisma.sysUser.findUnique({ where: { email: "sistem@erp.app" }, select: { id: true } });
  if (!sistem) throw new Error("System data is missing. Run `npm run db:seed` first.");
  actor = sistem.id;

  // ---- Satuan and Termin come from the system seed (P62); Gudang is
  // business data, so it is created here.
  const uomId = new Map((await prisma.refUom.findMany()).map((u) => [u.uom_label.toUpperCase(), u.id]));
  const termId = new Map((await prisma.refPaymentTerm.findMany()).map((t) => [t.term_label.toUpperCase(), t.id]));
  for (const needed of ["PCS", "BOX", "SET"]) {
    if (!uomId.has(needed)) throw new Error(`Satuan ${needed} is missing. Run \`npm run db:seed\` first.`);
  }

  for (const [label, name] of WAREHOUSES) {
    if (await prisma.refWarehouse.findFirst({ where: { warehouse_label: label } })) continue;
    const row = await prisma.refWarehouse.create({
      data: { warehouse_code: await nextCode(entity("ref_warehouse")), warehouse_label: label, warehouse_name: name, created_by: actor },
    });
    await audit("ref_warehouse", row.id);
    tally("gudang");
  }

  // ---- accounts
  const customerCategory = await prisma.sysPartnerCategory.findFirstOrThrow({
    where: { category_label: CUSTOMER_CATEGORY },
  });
  const accountId = new Map<string, number>();
  for (const a of ACCOUNTS) {
    let row = await prisma.accAccount.findFirst({ where: { account_name: { equals: a.name, mode: "insensitive" } } });
    if (!row) {
      const sub = await prisma.accAccountSubcategory.findFirst({ where: { subcategory_label: a.sub } });
      if (!sub) throw new Error(`Account subcategory ${a.sub} is missing. Run \`npm run db:seed\` first.`);
      row = await prisma.accAccount.create({
        data: {
          account_code: await nextCode(entity("acc_account")),
          account_label: await nextAccountLabel(a.sub),
          account_name: a.name,
          account_subcategory_id: sub.id,
          is_postable: true,
          normal_balance: a.normal,
          is_control_account: Boolean(a.control),
          require_partner: Boolean(a.partner),
          partner_category_id: a.partner ? customerCategory.id : null,
          note: a.note ?? null,
          created_by: actor,
        },
      });
      await audit("acc_account", row.id);
      tally("accounts");
    }
    accountId.set(a.key, row.id);
  }

  // ---- Account Mapping and the Jenis PPh accounts — only where still empty.
  for (const [key, account] of MAPPINGS) {
    const current = await prisma.sysSetting.findUnique({ where: { setting_key: key } });
    if (current?.setting_value) continue;
    await prisma.sysSetting.upsert({
      where: { setting_key: key },
      update: { setting_value: String(accountId.get(account)), updated_by: actor },
      create: { setting_key: key, setting_value: String(accountId.get(account)), updated_by: actor },
    });
    tally("account mappings");
  }
  for (const [whtLabel, account] of WHT_ACCOUNTS) {
    const done = await prisma.refWithholdingTax.updateMany({
      where: { wht_label: whtLabel, account_id: null },
      data: { account_id: accountId.get(account), updated_by: actor },
    });
    if (done.count) tally("jenis PPh accounts");
  }

  // ---- Cash & Bank, each with its book
  const idr = await prisma.refCurrency.findFirst({ where: { currency_label: BASE_CURRENCY_LABEL } });
  if (!idr) throw new Error("The base currency is missing. Run `npm run db:seed` first.");
  for (const [label, name, account] of CASH_BANKS) {
    if (await prisma.mCashBank.findFirst({ where: { cash_bank_label: label } })) continue;
    const code = await nextCode(entity("m_cash_bank"));
    const row = await prisma.$transaction(async (tx) => {
      const cb = await tx.mCashBank.create({
        data: {
          cash_bank_code: code,
          cash_bank_label: label,
          cash_bank_name: name,
          cash_bank_type: "Bank",
          currency_id: idr.id,
          account_id: accountId.get(account)!,
          created_by: actor,
        },
      });
      await openCashBankBook(tx, {
        cashBankId: cb.id,
        openingBalance: 0,
        rate: 1,
        date: new Date().toISOString().slice(0, 10),
        actorId: actor,
      });
      return cb;
    });
    await audit("m_cash_bank", row.id);
    tally("cash & bank");
  }

  // ---- the current calendar year, Open, with its twelve periods
  const year = new Date().getUTCFullYear();
  if (!(await prisma.accFiscalYear.findFirst({ where: { year_label: String(year) } }))) {
    const code = await nextCode(entity("acc_fiscal_year"));
    const fy = await prisma.$transaction(async (tx) => {
      const row = await tx.accFiscalYear.create({
        data: { year_code: code, year_label: String(year), ...fiscalYearShape(year), status: "Open", created_by: actor },
      });
      await ensureFiscalPeriods(tx, { fiscalYearId: row.id, year, actorId: actor });
      return row;
    });
    await audit("acc_fiscal_year", fy.id);
    tally("fiscal year");
  }

  // ---- customers
  for (const c of CUSTOMERS) {
    if (await prisma.mPartner.findFirst({ where: { partner_name: { equals: c.name, mode: "insensitive" } } })) {
      skipped.push(c.name);
      continue;
    }
    const villages = await Promise.all(c.addresses.map(villageFor));
    const code = await nextCode(entity("m_partner"));
    const row = await prisma.mPartner.create({
      data: {
        partner_code: code,
        partner_label: c.label,
        partner_name: c.name,
        category_id: customerCategory.id,
        status: c.active === false ? "Inactive" : "Active",
        taxpayer_type: c.taxpayer,
        tax_id_type: c.idType,
        tax_id: c.taxId,
        tax_name: c.taxName ?? c.name,
        is_pkp: c.pkp,
        withholds_pph23: Boolean(c.pph23),
        collects_pph22: Boolean(c.pph22),
        vat_collector: c.government ? "Government" : "None",
        default_term_id: termId.get(c.term) ?? null,
        default_price_mode: c.mode,
        created_by: actor,
        addresses: {
          create: c.addresses.map((a, i) => ({
            village_id: villages[i],
            street: a.street,
            note: a.note ?? null,
            is_billing: Boolean(a.billing),
            is_shipping: Boolean(a.shipping),
            sort_order: i,
            created_by: actor,
          })),
        },
        contacts: c.contact
          ? {
              create: [
                {
                  contact_name: c.contact[0],
                  position: c.contact[1],
                  phone: c.contact[2],
                  email: c.contact[3],
                  sort_order: 0,
                  created_by: actor,
                },
              ],
            }
          : undefined,
      },
    });
    await audit("m_partner", row.id);
    tally("customers");
  }

  // ---- finished goods
  const finishedGoods = await prisma.sysItemCategory.findFirstOrThrow({ where: { category_label: "BRG-JADI" } });
  for (const [label, name, base, conversions] of ITEMS) {
    if (await prisma.mItem.findFirst({ where: { item_name: { equals: name, mode: "insensitive" } } })) {
      skipped.push(name);
      continue;
    }
    const row = await prisma.mItem.create({
      data: {
        item_code: await nextCode(entity("m_item")),
        item_label: label,
        item_name: name,
        item_type: "Barang",
        category_id: finishedGoods.id,
        base_uom_id: uomId.get(base)!,
        can_sell: true,
        can_buy: false,
        track_stock: true,
        has_expiry: true,
        created_by: actor,
        uoms: {
          create: conversions.map(([uom, factor], i) => ({
            uom_id: uomId.get(uom)!,
            factor,
            sort_order: i,
            created_by: actor,
          })),
        },
      },
    });
    await audit("m_item", row.id);
    tally("items");
  }

  // ---- opening stock, injected through the inventory book
  const warehouses = await prisma.refWarehouse.findMany({ where: { warehouse_label: { in: WAREHOUSES.map(([l]) => l) } }, orderBy: { id: "asc" } });
  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const opening: InjectionRow[] = [];
  for (const [label, cost] of Object.entries(ITEM_COSTS)) {
    const item = await prisma.mItem.findFirst({ where: { item_label: label } });
    if (!item || !item.track_stock) continue;
    for (const w of warehouses) {
      for (const [suffix, months] of LOTS) {
        const lotNo = `${label}-${w.warehouse_label}-${now.getUTCFullYear()}${suffix}`;
        // Additive: a lot already received is left as it is.
        if (await prisma.logStockTracking.findFirst({ where: { item_id: item.id, tracking_no: lotNo } })) continue;
        opening.push({
          itemId: item.id,
          warehouseId: w.id,
          lotNo,
          expiry: item.has_expiry ? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + months, 1)) : null,
          qty: String(OPENING_QTY),
          value: String(OPENING_QTY * cost),
          date: today,
        });
      }
    }
  }
  if (opening.length) {
    const run = await injectStock(opening, actor);
    made[`stok awal (${run.no})`] = run.count;
  }

  // ---- report
  const entries = Object.entries(made);
  if (entries.length) {
    console.log("Showcase data created:");
    for (const [what, n] of entries) console.log(`  ${String(n).padStart(4)}  ${what}`);
  } else {
    console.log("Nothing to create — the showcase data is already there.");
  }
  if (skipped.length) {
    console.log(`\nAlready present, left as they are: ${skipped.length} customer(s) / item(s).`);
  }
  console.log("\nDevelopment data only. Opening balances and documents are not created.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
