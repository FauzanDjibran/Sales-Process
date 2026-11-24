/**
 * Makloon demo data — the cosmetics simulation's world (PRJ.001), so a freshly
 * reset database can be used straight away (Claude-ERP.md P11, §5). Its twin
 * for the sarang walet company is `seed-walet.ts`; one database takes one.
 *
 * **Development only.** This is business data, not system data: it never runs
 * as part of `db:seed`, never in production, and nothing in the application
 * depends on it. Run it after `npm run db:seed` (or use `npm run db:fresh-makloon`).
 *
 * What it creates, taken from `Initialization/actual-simulation-v2.html`:
 *   Gudang (Satuan, Termin and currencies come from the system seed, P62)
 *   the starter chart with Account Mapping, Kategori Item and Jenis PPh
 *   accounts (`scripts/lib/starter-accounts.ts`, also `db:seed-accounts`)
 *   two rupiah bank accounts (Cash & Bank, each with its book)
 *   the current calendar year as an Open Fiscal Year with its twelve periods
 *   the simulation's customers, with tax identity, addresses and contacts
 *   suppliers with purchase defaults
 *   the whole item master, every Kategori Item, with purchase units and
 *   Timbangan (P320, P321), and the few Satuan they need
 *   opening stock of the finished goods, two lots per item per warehouse
 *
 * Not created: opening balances (they start empty, P27), documents, and the
 * perizinan services (set aside).
 *
 * **Idempotent and additive.** Every record is matched on its label or name —
 * the thing a person would recognise — and created only when missing. An
 * existing record is never changed — an item only gains a conversion or
 * Timbangan it lacks — and a setting or account pointer the user
 * has already filled is left alone. Running it twice creates nothing twice.
 *
 * It writes the same rows the application's forms would, with generated
 * codes, the Sistem user as author, a `create` audit entry for every master
 * record and a Cash Bank Book for every bank account. It goes to the
 * database directly rather than through the Server Actions, which need a
 * signed-in user; the data is fixed, and the arithmetic of the application is
 * not involved.
 */
import type { PermitCategory } from "../src/generated/prisma/client";
import { prisma } from "../src/lib/prisma";
import { nextCode } from "../src/lib/erp/records";
import { BASE_CURRENCY_LABEL } from "../src/lib/erp/currency";
import { seedStarterAccounts } from "./lib/starter-accounts";
import { injectStock, type InjectionRow } from "../src/lib/erp/inventory";
import { audit as auditAs, ensureBank, ensureFiscalYear, ensureItem, ensurePartner, ensureUoms, entity, seedActor, type ItemSpec, type PartnerSpec } from "./lib/seed-common";

// ------------------------------------------------------------------- data

const PERMIT_TYPES: [label: string, name: string, category: PermitCategory, estimate: number, description: string][] = [
  ["IZ-001", "Pra-Registrasi", "Regulatory", 500000, "Kajian formula, klaim dan penandaan sebelum notifikasi diajukan"],
  ["IZ-002", "Registrasi Notifikasi BPOM", "Regulatory", 100000, "Pengajuan notifikasi kosmetik di e-Notifikasi BPOM sampai terbit NA"],
  ["IZ-003", "Uji Stabilitas", "Laboratory", 200000, "Uji stabilitas dipercepat, termasuk laporan hasil uji"],
  ["IZ-004", "Uji Mikrobiologi", "Laboratory", 150000, "Uji cemaran mikroba — ALT, kapang-khamir dan patogen"],
  ["IZ-005", "Uji Logam Berat", "Laboratory", 175000, "Uji cemaran Pb, Hg, As dan Cd"],
  ["IZ-006", "Sertifikasi Halal", "Certification", 650000, "Pendampingan sertifikasi halal BPJPH sampai terbit sertifikat"],
  ["IZ-007", "Pendaftaran Merek", "IntellectualProperty", 1800000, "Permohonan merek satu kelas di DJKI"],
];

const WAREHOUSES: [label: string, name: string][] = [
  ["GD-CKR", "Gudang Cikarang"],
  ["GD-SBY", "Gudang Surabaya"],
];

/** The demo banks, each with its own account; every other account comes from the starter chart (P130). */
const BANKS = [
  { label: "BCA", name: "Bank BCA · 123-456-7890", account: "Bank BCA", note: "Rekening penerimaan 123-456-7890", currency: BASE_CURRENCY_LABEL },
  { label: "MANDIRI", name: "Bank Mandiri · 070-00-1234567-8", account: "Bank Mandiri", note: "Rekening penerimaan 070-00-1234567-8", currency: BASE_CURRENCY_LABEL },
];

type CustomerSpec = PartnerSpec;

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

/** Suppliers for the purchasing flow (P121): PKP and non-PKP, a company and a person. */
const SUPPLIERS: CustomerSpec[] = [
  {
    label: "S-001", name: "PT Kimia Bahan Kosmetik Indonesia", taxpayer: "Badan", idType: "NPWP", taxId: "0312456789012345",
    pkp: true, term: "NET30", mode: "Exclude", supplier: true,
    addresses: [{ city: "Kota Bekasi", district: "Bekasi Timur", street: "Jl. Industri Raya No. 5", note: "Kantor & Gudang", billing: true, shipping: true }],
    contact: ["Bpk. Rudi Hartono", "Sales", "0812 1100 2233", "rudi.hartono@kimiabahan.example"],
  },
  {
    label: "S-002", name: "PT Kemas Plastik Jaya", taxpayer: "Badan", idType: "NPWP", taxId: "0423567890123456",
    pkp: true, term: "NET45", mode: "Include", supplier: true,
    addresses: [{ city: "Kota Surabaya", district: "Rungkut", street: "Jl. Rungkut Industri III No. 22", note: "Pabrik", billing: true, shipping: true }],
    contact: ["Ibu Dewi Anggraini", "Marketing", "031 870 5566", "dewi.anggraini@kemasplastik.example"],
  },
  {
    label: "S-003", name: "CV Ekspedisi Cepat Sampai", taxpayer: "Badan", idType: "NPWP", taxId: "0534678901234567",
    pkp: false, term: "NET14", mode: "Exclude", supplier: true,
    addresses: [{ city: "Kota Administrasi Jakarta Timur", district: "Cakung", street: "Jl. Raya Bekasi Km 18", note: "Pool Cakung", billing: true }],
    contact: ["Bpk. Agus Salim", "Operasional", "021 460 7788", "agus.salim@cepatsampai.example"],
  },
  {
    label: "S-004", name: "Bengkel Teknik Budi", taxpayer: "OrangPribadi", idType: "NIK", taxId: "3273011203800004",
    pkp: false, term: "TUNAI", mode: "Exclude", supplier: true,
    addresses: [{ city: "Kota Bandung", district: "Sumur Bandung", street: "Jl. Braga No. 40", note: "Bengkel", billing: true }],
    contact: ["Bpk. Budi Prasetyo", "Pemilik", "0813 2200 3344", "budi.prasetyo@bengkelbudi.example"],
  },
];

/** Units goods are bought in that the system seed does not carry (P320). */
const UOMS: [label: string, name: string][] = [
  ["DRUM", "Drum"],
  ["SAK", "Sak"],
  ["JRG", "Jerigen"],
  ["ROL", "Rol"],
];

/**
 * The whole item master, every Kategori Item of it: raw and packaging materials
 * by lot, bought in packs, drums or litres and weighed at receipt (P320, P321),
 * semi-finished and finished goods, merchandise, consumables without stock, and
 * services.
 */
const ITEMS: ItemSpec[] = [
  // Bahan baku: kept in the unit it is weighed or poured in.
  { label: "BB-001", name: "Niacinamide (Bahan Baku)", category: "BHN-BAKU", base: "KG", conversions: [["SAK", 25]], buy: true, stock: true, expiry: true, weighting: [1, 1] },
  // Kept by weight, bought by volume: a litre of glycerin is 1,26 Kg.
  { label: "BB-002", name: "Gliserin Murni (Bahan Baku)", category: "BHN-BAKU", base: "KG", conversions: [["L", 1.26], ["DRUM", 250]], buy: true, stock: true, expiry: true, weighting: [1, 2] },
  { label: "BB-003", name: "Asam Askorbat (Bahan Baku)", category: "BHN-BAKU", base: "KG", conversions: [["SAK", 25]], buy: true, stock: true, expiry: true, weighting: [1, 1] },
  { label: "BB-004", name: "Air Murni (Aqua Demineralisata)", category: "BHN-BAKU", base: "L", conversions: [["JRG", 20], ["DRUM", 200]], buy: true, stock: true, expiry: true, weighting: [1, 2] },
  { label: "BB-005", name: "Titanium Dioxide (Bahan Baku)", category: "BHN-BAKU", base: "KG", conversions: [["SAK", 25]], buy: true, stock: true, expiry: true, weighting: [1, 1] },
  { label: "BB-006", name: "Shea Butter (Bahan Baku)", category: "BHN-BAKU", base: "KG", conversions: [["BOX", 20]], buy: true, stock: true, expiry: true, weighting: [1, 2] },
  { label: "BB-007", name: "Fragrance Rose (Bahan Baku)", category: "BHN-BAKU", base: "ML", conversions: [["BTL", 500], ["L", 1000]], buy: true, stock: true, expiry: true, weighting: [0.00095, 2] },
  { label: "BB-008", name: "Retinol (Bahan Baku)", category: "BHN-BAKU", base: "GR", conversions: [["KG", 1000]], buy: true, stock: true, expiry: true, weighting: [0.001, 1] },
  { label: "BB-009", name: "Sodium Hyaluronate (Bahan Baku)", category: "BHN-BAKU", base: "GR", conversions: [["KG", 1000]], buy: true, stock: true, expiry: true, weighting: [0.001, 1] },
  // Bahan kemas: kept by the piece, bought by the box, its count checked by weight.
  { label: "BK-001", name: "Botol Kaca Amber 30 ml", category: "BHN-KEMAS", base: "PCS", conversions: [["BOX", 100], ["KRT", 1000]], buy: true, stock: true, weighting: [0.09, 5] },
  { label: "BK-002", name: "Tube Plastik 50 ml", category: "BHN-KEMAS", base: "PCS", conversions: [["BOX", 200]], buy: true, stock: true, weighting: [0.012, 5] },
  { label: "BK-003", name: "Karton Box Pengiriman", category: "BHN-KEMAS", base: "PCS", conversions: [["PAK", 25]], buy: true, stock: true, weighting: [0.45, 5] },
  { label: "BK-004", name: "Pump Dispenser 24 mm", category: "BHN-KEMAS", base: "PCS", conversions: [["BOX", 250]], buy: true, stock: true, weighting: [0.008, 5] },
  { label: "BK-005", name: "Label Stiker Botol 30 ml", category: "BHN-KEMAS", base: "PCS", conversions: [["ROL", 1000]], buy: true, stock: true },
  { label: "BK-006", name: "Box Lipat Serum 30 ml", category: "BHN-KEMAS", base: "PCS", conversions: [["PAK", 100], ["KRT", 500]], buy: true, stock: true, weighting: [0.015, 5] },
  { label: "BK-007", name: "Pot Krim Akrilik 30 g", category: "BHN-KEMAS", base: "PCS", conversions: [["BOX", 120]], buy: true, stock: true, weighting: [0.055, 5] },
  // Barang setengah jadi: neither bought nor sold.
  { label: "BSJ-001", name: "Bulk Serum Vitamin C", category: "BRG-SETENGAH-JADI", base: "KG", stock: true, expiry: true },
  { label: "BSJ-002", name: "Bulk Sunscreen SPF 50", category: "BRG-SETENGAH-JADI", base: "KG", stock: true, expiry: true },
  { label: "BSJ-003", name: "Bulk Night Cream Retinol", category: "BRG-SETENGAH-JADI", base: "KG", stock: true, expiry: true },
  // Barang jadi: the simulation's finished goods.
  { label: "FG-001", name: "Serum Wajah Vitamin C 30 ml", category: "BRG-JADI", base: "PCS", conversions: [["BOX", 12]], sell: true, stock: true, expiry: true },
  { label: "FG-002", name: "Sunscreen SPF 50 PA++++ 50 ml", category: "BRG-JADI", base: "PCS", conversions: [["BOX", 12]], sell: true, stock: true, expiry: true },
  { label: "FG-003", name: "Facial Wash Gentle 100 ml", category: "BRG-JADI", base: "PCS", conversions: [["BOX", 24]], sell: true, stock: true, expiry: true },
  { label: "FG-004", name: "Lip Balm Natural 10 g", category: "BRG-JADI", base: "PCS", conversions: [["BOX", 48]], sell: true, stock: true, expiry: true },
  { label: "FG-005", name: "Toner Hydrating 150 ml", category: "BRG-JADI", base: "PCS", conversions: [["BOX", 12]], sell: true, stock: true, expiry: true },
  { label: "FG-006", name: "Night Cream Retinol 30 g", category: "BRG-JADI", base: "PCS", conversions: [["BOX", 12]], sell: true, stock: true, expiry: true },
  { label: "FG-007", name: "Body Lotion Brightening 200 ml", category: "BRG-JADI", base: "PCS", conversions: [["BOX", 12]], sell: true, stock: true, expiry: true },
  { label: "FG-008", name: "Paket Perawatan Kulit Klinik (1 set)", category: "BRG-JADI", base: "SET", conversions: [["BOX", 6]], sell: true, stock: true, expiry: true },
  // Barang dagangan: bought and sold as it is.
  { label: "BD-001", name: "Kapas Wajah Organik isi 80", category: "BRG-DAGANG", base: "PCS", conversions: [["LSN", 12], ["KRT", 48]], buy: true, sell: true, stock: true, weighting: [0.06, 5] },
  { label: "BD-002", name: "Spons Make Up Latex Free", category: "BRG-DAGANG", base: "PCS", conversions: [["LSN", 12], ["KRT", 144]], buy: true, sell: true, stock: true },
  // Habis pakai: an expense when received, so no stock, lot or weight.
  { label: "BHP-001", name: "Sarung Tangan Nitril", category: "BRG-HABIS-PAKAI", base: "BOX", conversions: [["KRT", 10]], buy: true },
  { label: "BHP-002", name: "Masker Medis 3 Ply", category: "BRG-HABIS-PAKAI", base: "BOX", conversions: [["KRT", 40]], buy: true },
  { label: "BHP-003", name: "Alkohol 70% Sanitasi", category: "BRG-HABIS-PAKAI", base: "L", conversions: [["JRG", 20]], buy: true },
  // Jasa.
  { label: "JS-001", name: "Jasa Pengiriman Ekspedisi", type: "Jasa", category: "JASA-PENGIRIMAN", base: "UNIT", buy: true },
  { label: "JS-002", name: "Jasa Kalibrasi Mesin Produksi", type: "Jasa", category: "JASA-PEMELIHARAAN", base: "UNIT", buy: true },
  { label: "JS-003", name: "Jasa Konsultasi Formula", type: "Jasa", category: "JASA-KONSULTASI", base: "UNIT", buy: true },
  { label: "JS-004", name: "Jasa Maklon Produksi Kosmetik", type: "Jasa", category: "JASA-MAKLON", base: "UNIT", buy: true, sell: true },
  { label: "JS-005", name: "Jasa Uji Laboratorium", type: "Jasa", category: "JASA-LAIN", base: "UNIT", buy: true },
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

let actor = 0;
const audit = (entityKey: string, rowId: number) => auditAs(actor, entityKey, rowId);

// ------------------------------------------------------------------- main

async function main() {
  actor = await seedActor("seed-makloon");

  // ---- Satuan and Termin come from the system seed (P62); Gudang is
  // business data, so it is created here.
  const uoms = await ensureUoms(actor, UOMS);
  if (uoms) made["satuan"] = uoms;

  for (const [label, name] of WAREHOUSES) {
    if (await prisma.refWarehouse.findFirst({ where: { warehouse_label: label } })) continue;
    const row = await prisma.refWarehouse.create({
      data: { warehouse_code: await nextCode(entity("ref_warehouse")), warehouse_label: label, warehouse_name: name, created_by: actor },
    });
    await audit("ref_warehouse", row.id);
    tally("gudang");
  }

  // ---- Jenis Perizinan, the simulation's PERMITS (P137)
  for (const [label, name, category, estimate, description] of PERMIT_TYPES) {
    if (await prisma.refPermitType.findFirst({ where: { permit_label: label } })) continue;
    const row = await prisma.refPermitType.create({
      data: {
        permit_code: await nextCode(entity("ref_permit_type")),
        permit_label: label,
        permit_name: name,
        category,
        standard_estimate: estimate,
        default_description: description,
        created_by: actor,
      },
    });
    await audit("ref_permit_type", row.id);
    tally("jenis perizinan");
  }

  // ---- the starter chart with its mappings (shared with db:seed-accounts),
  // then the demo banks beside it, each with its book
  const starter = await seedStarterAccounts(actor);
  for (const [what, n] of Object.entries(starter.made)) made[what] = n;
  for (const b of BANKS) if (await ensureBank(actor, b)) tally("cash & bank");

  // ---- the current calendar year, Open, with its twelve periods
  if (await ensureFiscalYear(actor)) tally("fiscal year");

  // ---- customers and suppliers
  for (const c of [...CUSTOMERS, ...SUPPLIERS]) {
    if (await ensurePartner(actor, c)) tally(c.supplier ? "suppliers" : "customers");
    else skipped.push(c.name);
  }

  // ---- the item master. An item already there keeps all it has; only a
  // conversion or Timbangan it lacks is added (P320, P321).
  for (const it of ITEMS) {
    const done = await ensureItem(actor, it);
    if (done) tally(done === "made" ? "items" : "items dilengkapi");
    else skipped.push(it.name);
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
