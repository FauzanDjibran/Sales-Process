/**
 * Walet demo data — the sarang walet company, so a freshly reset database can
 * walk Pembelian → Gudang → Produksi → Penjualan in walet terms (`Seed-Walet-Plan.md`).
 * Its twin for the makloon company is `seed-makloon.ts`; one database takes one.
 *
 * `npm run db:seed-walet` runs, in order: `db:seed-accounts` (the chart),
 * `db:seed-production` (Workstations, Units, Lines Reguler and Mie, routings, as
 * the Workspace Unit artifact draws them), `db:seed-production-showcase` (the walet
 * items in grams, Gudang Bahan Baku and Finish Goods, Standard Cost SC-SIM, BoM
 * Packing) and then this file, which adds what a company needs around production:
 *   Gudang Bahan Penolong, Gudang Hasil Samping and the Gudang Transit
 *   the rest of the item master, every Kategori Item, with purchase units and
 *   Timbangan (P320, P321), and the Satuan they need
 *   the artifact's six Karyawan
 *   suppliers (rumah walet, a pengepul, kemasan) and customers (a USD importer,
 *   a distributor, a toko)
 *   Kas, Bank Mandiri and BCA (IDR), Bank Mandiri USD and BCA USD, each with its
 *   Saldo Awal (`DEMO_BANKS`), and a USD Kurs for today
 *   the artifact's demo users with their roles and Units (only where a password
 *   is known: `erp123` on a local database, else `ERP_ADMIN_PASSWORD`)
 *   opening stock: three No. Stok of sarang mentah (the simulation's figures) and
 *   bahan penolong, injected without a journal like `db:stock-inject`
 *
 * **Development only, additive, matched on label / name** — running it twice
 * creates nothing twice. No documents and no GL opening balances; documents that fill
 * the stock and production ledgers are `db:seed-walet-ledger`.
 */
import { prisma } from "../src/lib/prisma";
import { nextCode } from "../src/lib/erp/records";
import { injectStock, type InjectionRow } from "../src/lib/erp/inventory";
import { hashPassword } from "../src/lib/erp/login";
import { audit, DEMO_BANKS, ensureBank, ensureFiscalYear, ensureItem, ensurePartner, ensureUoms, entity, seedActor, type ItemSpec, type PartnerSpec } from "./lib/seed-common";

const WAREHOUSES: [label: string, name: string][] = [
  ["GBP", "Gudang Bahan Penolong"],
  ["GHS", "Gudang Hasil Samping"],
  ["GTR", "Gudang Transit"],
];

const UOMS: [label: string, name: string][] = [
  ["ROL", "Rol"],
  ["JRG", "Jerigen"],
];

/**
 * The item master around what `db:seed-production-showcase` made: that seed's own
 * items gain the units they are bought or packed in and, where they are weighed
 * at receipt, their Timbangan (P320, P321); the rest are new, so every Kategori
 * Item has its items.
 */
const ITEMS: ItemSpec[] = [
  // Sarang mentah: kept in grams, bought by the kilogram, always weighed.
  { label: "SM-A", name: "Sarang Mentah Grade A", category: "BHN-BAKU", base: "GR", conversions: [["KG", 1000]], buy: true, stock: true, weighting: [0.001, 1] },
  { label: "SM-B", name: "Sarang Mentah Grade B", category: "BHN-BAKU", base: "GR", conversions: [["KG", 1000]], buy: true, stock: true, weighting: [0.001, 1] },
  { label: "SM-C", name: "Sarang Mentah Grade C", category: "BHN-BAKU", base: "GR", conversions: [["KG", 1000]], buy: true, stock: true, weighting: [0.001, 1] },
  { label: "SM-SD", name: "Sarang Mentah Sudut", category: "BHN-BAKU", base: "GR", conversions: [["KG", 1000]], buy: true, stock: true, weighting: [0.001, 1] },
  { label: "SM-PT", name: "Sarang Mentah Patahan", category: "BHN-BAKU", base: "GR", conversions: [["KG", 1000]], buy: true, stock: true, weighting: [0.001, 1] },
  { label: "SM-PL", name: "Sarang Mentah Plontos", category: "BHN-BAKU", base: "GR", conversions: [["KG", 1000]], buy: true, stock: true, weighting: [0.001, 1] },
  { label: "SM-GS", name: "Sarang Mentah Goa", category: "BHN-BAKU", base: "GR", conversions: [["KG", 1000]], buy: true, stock: true, weighting: [0.001, 1] },
  // Bahan penolong: kept by the piece, bought by the pack or roll.
  { label: "GRMS", name: "Gramasi", category: "BHN-KEMAS", base: "PCS", conversions: [["PAK", 100]], buy: true, stock: true },
  { label: "STK-DAUN", name: "Stiker Daun", category: "BHN-KEMAS", base: "PCS", conversions: [["ROL", 500]], buy: true, stock: true },
  { label: "STK-SGL", name: "Stiker Segel", category: "BHN-KEMAS", base: "PCS", conversions: [["ROL", 1000]], buy: true, stock: true },
  { label: "STK-CAIQ", name: "Stiker CAIQ", category: "BHN-KEMAS", base: "PCS", conversions: [["ROL", 1000]], buy: true, stock: true },
  { label: "KTG", name: "Kantong Plastik", category: "BHN-KEMAS", base: "PCS", conversions: [["PAK", 100]], buy: true, stock: true, weighting: [0.004, 5] },
  { label: "BOX", name: "Box", category: "BHN-KEMAS", base: "PCS", conversions: [["KRT", 50]], buy: true, stock: true, weighting: [0.12, 5] },
  { label: "KARTON", name: "Karton", category: "BHN-KEMAS", base: "PCS", conversions: [["PAK", 25]], buy: true, stock: true, weighting: [0.5, 5] },
  { label: "SILIKA", name: "Silica Gel 5 g", category: "BHN-KEMAS", base: "PCS", conversions: [["PAK", 200]], buy: true, stock: true, weighting: [0.005, 5] },
  { label: "PITA", name: "Pita Kemasan", category: "BHN-KEMAS", base: "ROL", conversions: [["BOX", 24]], buy: true, stock: true },
  // Finished goods: sold by the kotak, shipped by the karton.
  { label: "BMK25", name: "B-MK 25 gr", category: "BRG-JADI", base: "PCS", conversions: [["KRT", 40]], sell: true, stock: true },
  { label: "BMK50", name: "B-MK 50 gr", category: "BRG-JADI", base: "PCS", conversions: [["KRT", 20]], sell: true, stock: true },
  { label: "BMK100", name: "B-MK 100 gr", category: "BRG-JADI", base: "PCS", conversions: [["KRT", 10]], sell: true, stock: true },
  { label: "BSD50", name: "B-SD 50 gr", category: "BRG-JADI", base: "PCS", conversions: [["KRT", 20]], sell: true, stock: true },
  // Merchandise: bought and sold as it is.
  { label: "DG-HMP", name: "Hampers Sarang Walet (kotak hadiah)", category: "BRG-DAGANG", base: "SET", conversions: [["KRT", 6]], buy: true, sell: true, stock: true },
  { label: "DG-GBT", name: "Gula Batu Kristal 250 g", category: "BRG-DAGANG", base: "PCS", conversions: [["LSN", 12], ["KRT", 48]], buy: true, sell: true, stock: true, weighting: [0.26, 5] },
  // Consumables: an expense when received.
  { label: "BHP-SRG", name: "Sarung Tangan", category: "BRG-HABIS-PAKAI", base: "BOX", conversions: [["KRT", 10]], buy: true },
  { label: "BHP-MSK", name: "Masker dan Hairnet", category: "BRG-HABIS-PAKAI", base: "BOX", conversions: [["KRT", 20]], buy: true },
  { label: "BHP-PST", name: "Pinset Cabut Bulu", category: "BRG-HABIS-PAKAI", base: "PCS", conversions: [["LSN", 12]], buy: true },
  { label: "BHP-KUAS", name: "Kuas Pembersih", category: "BRG-HABIS-PAKAI", base: "PCS", conversions: [["LSN", 12]], buy: true },
  { label: "BHP-ALK", name: "Alkohol 70% Sanitasi", category: "BRG-HABIS-PAKAI", base: "L", conversions: [["JRG", 20]], buy: true },
  // Services.
  { label: "JS-LAB", name: "Jasa Uji Lab (Nitrit)", type: "Jasa", category: "JASA-LAIN", base: "UNIT", buy: true },
  { label: "JS-KIRIM", name: "Jasa Pengiriman", type: "Jasa", category: "JASA-PENGIRIMAN", base: "UNIT", buy: true },
  { label: "JS-KAL", name: "Jasa Kalibrasi Timbangan", type: "Jasa", category: "JASA-PEMELIHARAAN", base: "UNIT", buy: true },
  { label: "JS-HACCP", name: "Jasa Konsultasi HACCP", type: "Jasa", category: "JASA-KONSULTASI", base: "UNIT", buy: true },
  { label: "JS-CABUT", name: "Jasa Maklon Cabut Bulu", type: "Jasa", category: "JASA-MAKLON", base: "UNIT", buy: true, sell: true },
];

// The artifact's EMP: Ani and Budi come from db:seed-production-showcase.
const EMPLOYEES: [label: string, name: string][] = [
  ["CITRA", "Citra"],
  ["DEDI", "Dedi"],
  ["EKA", "Eka"],
  ["FITRI", "Fitri"],
];

const PARTNERS: PartnerSpec[] = [
  {
    label: "S-W01", name: "PT Rumah Walet Kalbar", taxpayer: "Badan", idType: "NPWP", taxId: "0731245678900012",
    pkp: true, term: "NET30", mode: "Exclude", supplier: true,
    addresses: [{ city: "Kota Pontianak", district: "Pontianak Barat", street: "Jl. Komyos Sudarso No. 88", note: "Kantor & gudang sarang", billing: true, shipping: true }],
    contact: ["Bpk. Hendrik Wijaya", "Pemilik", "0561 777 8811", "hendrik@rumahwaletkalbar.example"],
  },
  {
    label: "S-W02", name: "Pengepul H. Syamsul", taxpayer: "OrangPribadi", idType: "NIK", taxId: "6202011507700003",
    pkp: false, term: "TUNAI", mode: "Exclude", supplier: true,
    addresses: [{ city: "Kabupaten Kotawaringin Timur", district: "Mentawa Baru Ketapang", street: "Jl. Tjilik Riwut Km 3", note: "Rumah pengepul", billing: true }],
    contact: ["H. Syamsul Bahri", "Pengepul", "0813 4900 2211", "syamsul@pengepul.example"],
  },
  {
    label: "S-W03", name: "CV Kemas Prima", taxpayer: "Badan", idType: "NPWP", taxId: "0842356789000013",
    pkp: true, term: "NET30", mode: "Include", supplier: true,
    addresses: [{ city: "Kota Surabaya", district: "Rungkut", street: "Jl. Rungkut Industri II No. 7", note: "Pabrik kemasan", billing: true, shipping: true }],
    contact: ["Ibu Ratna Sari", "Marketing", "031 870 1122", "ratna@kemasprima.example"],
  },
  {
    // An importer abroad; the address is its forwarder's in Jakarta, because a Partner address is a kelurahan.
    label: "C-W01", name: "Hong Kong Bird's Nest Trading Ltd", taxpayer: "Badan", idType: "NPWP", taxId: "0953467890000014",
    pkp: false, term: "NET30", mode: "Exclude", currency: "USD",
    addresses: [{ city: "Kota Administrasi Jakarta Utara", district: "Tanjung Priok", street: "Jl. Enggano No. 5 (forwarder)", note: "Alamat agen pengiriman", billing: true, shipping: true }],
    contact: ["Mr. Chan Wai Ming", "Purchasing", "+852 2345 6789", "chan@hkbirdsnest.example"],
  },
  {
    label: "C-W02", name: "PT Sarang Emas Nusantara", taxpayer: "Badan", idType: "NPWP", taxId: "0164578900000015",
    pkp: true, pph23: false, term: "NET30", mode: "Exclude",
    addresses: [
      { city: "Kota Administrasi Jakarta Barat", district: "Taman Sari", street: "Jl. Hayam Wuruk No. 120", note: "Kantor Pusat", billing: true },
      { city: "Kota Administrasi Jakarta Utara", district: "Penjaringan", street: "Pergudangan Pluit Blok C-3", note: "Gudang", shipping: true },
    ],
    contact: ["Bpk. Budi Santoso", "Pengadaan", "021 690 3344", "budi@sarangemas.example"],
  },
  {
    label: "C-W03", name: "Toko Walet Sehat", taxpayer: "OrangPribadi", idType: "NIK", taxId: "3578011203850004", taxName: "Lie Siu Lan",
    pkp: false, term: "TUNAI", mode: "Include",
    addresses: [{ city: "Kota Surabaya", district: "Genteng", street: "Jl. Kembang Jepun No. 31", note: "Toko", billing: true, shipping: true }],
    contact: ["Ibu Lie Siu Lan", "Pemilik", "0812 3300 4455", "siulan@waletsehat.example"],
  },
];

const USD_RATE = 16_250;

/** The artifact's USERS; `units: null` opens every Unit (PRODUCTION_UNIT_ALL). */
const ROLES: { label: string; name: string; modules: string[]; except?: string[] }[] = [
  { label: "SPV-PRD", name: "Supervisor Produksi", modules: ["production", "costing", "inventory"] },
  { label: "ADM-UNIT", name: "Admin Unit", modules: ["production"], except: ["PRODUCTION_UNIT_ALL"] },
  { label: "ADM-LOG", name: "Admin Logistik", modules: ["inventory", "purchasing"] },
];
const USERS: { email: string; name: string; initials: string; role: string; units: string[] | null }[] = [
  { email: "hendra@walet.test", name: "Hendra", initials: "HN", role: "SPV-PRD", units: null },
  { email: "dewi@walet.test", name: "Dewi", initials: "DW", role: "ADM-LOG", units: [] },
  { email: "rina@walet.test", name: "Rina", initials: "RN", role: "ADM-UNIT", units: ["UGH"] },
  { email: "bagas@walet.test", name: "Bagas", initials: "BG", role: "ADM-UNIT", units: ["UPW", "UCL"] },
  { email: "sari@walet.test", name: "Sari", initials: "SR", role: "ADM-UNIT", units: ["UP5"] },
];

/** Opening stock: [item, No. Stok, supplier label, qty, value]. Sarang in grams; STK-0001/0002 are the simulation's. */
const OPENING: { warehouse: string; rows: [item: string, no: string, qty: number, value: number][] }[] = [
  { warehouse: "GBB", rows: [["SM-A", "STK-0001", 10_000, 40_000_000], ["SM-B", "STK-0002", 6_000, 27_000_000], ["SM-C", "STK-0003", 5_000, 18_500_000]] },
  {
    warehouse: "GBP",
    rows: [["GRMS", "BP-GRMS-01", 500, 1_000_000], ["STK-DAUN", "BP-DAUN-01", 500, 2_500_000], ["STK-SGL", "BP-SGL-01", 500, 1_500_000], ["KTG", "BP-KTG-01", 500, 750_000], ["BOX", "BP-BOX-01", 200, 30_000_000], ["KARTON", "BP-KRT-01", 20, 800_000]],
  },
];

async function nextSeqCode(prefix: string, codes: string[]) {
  const max = codes.reduce((m, c) => Math.max(m, Number(c.split(".")[1]) || 0), 0);
  return `${prefix}.${String(max + 1).padStart(4, "0")}`;
}

async function main() {
  const actor = await seedActor("seed-walet");
  const made: string[] = [];

  if (await ensureFiscalYear(actor)) made.push("Tahun Buku");

  for (const [label, name] of WAREHOUSES) {
    if (await prisma.refWarehouse.findFirst({ where: { OR: [{ warehouse_label: label }, { warehouse_name: name }] } })) continue;
    const row = await prisma.refWarehouse.create({ data: { warehouse_code: await nextCode(entity("ref_warehouse")), warehouse_label: label, warehouse_name: name, created_by: actor } });
    await audit(actor, "ref_warehouse", row.id);
    made.push(name);
  }

  if (await ensureUoms(actor, UOMS)) made.push("Satuan");
  for (const it of ITEMS) {
    const done = await ensureItem(actor, it);
    if (done) made.push(done === "made" ? it.label : `${it.label} (dilengkapi)`);
  }

  // The Gudang Transit, only where none is set (P301): transfers need one.
  const transit = await prisma.refWarehouse.findFirst({ where: { warehouse_label: "GTR" } });
  const setting = await prisma.sysSetting.findUnique({ where: { setting_key: "transit_warehouse" } });
  if (transit && !setting?.setting_value) {
    await prisma.sysSetting.upsert({
      where: { setting_key: "transit_warehouse" },
      update: { setting_value: String(transit.id), updated_by: actor },
      create: { setting_key: "transit_warehouse", setting_value: String(transit.id), updated_by: actor },
    });
    made.push("Gudang Transit di System Default");
  }

  for (const [label, name] of EMPLOYEES) {
    if (await prisma.mEmployee.findFirst({ where: { employee_label: label } })) continue;
    const row = await prisma.mEmployee.create({ data: { employee_code: await nextCode(entity("m_employee")), employee_label: label, employee_name: name, created_by: actor } });
    await audit(actor, "m_employee", row.id);
    made.push(`Karyawan ${name}`);
  }

  for (const p of PARTNERS) if (await ensurePartner(actor, p)) made.push(p.name);
  for (const b of DEMO_BANKS) if (await ensureBank(actor, b)) made.push(b.name);

  const usd = await prisma.refCurrency.findFirstOrThrow({ where: { currency_label: "USD" } });
  const today = new Date(new Date().toISOString().slice(0, 10));
  if (!(await prisma.refExchangeRate.findFirst({ where: { currency_id: usd.id, rate_type: "Transaction", rate_date: today, status: "Active" } }))) {
    const row = await prisma.refExchangeRate.create({ data: { rate_code: await nextCode(entity("ref_exchange_rate")), currency_id: usd.id, rate_date: today, rate: USD_RATE, created_by: actor } });
    await audit(actor, "ref_exchange_rate", row.id);
    made.push(`Kurs USD ${USD_RATE}`);
  }

  // ---- demo users: a password only where one is known, never a made-up one on a shared database.
  const local = /@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL ?? "");
  const password = process.env.ERP_ADMIN_PASSWORD ?? (local ? "erp123" : null);
  if (!password) console.log("User demo dilewati: database bukan lokal dan ERP_ADMIN_PASSWORD tidak ada.");
  else {
    const permissions = await prisma.sysPermission.findMany({ select: { id: true, permission_code: true, module: true } });
    const roleId = new Map<string, number>();
    for (const r of ROLES) {
      let role = await prisma.sysRole.findUnique({ where: { role_label: r.label } });
      if (!role) {
        const grant = permissions.filter((p) => r.modules.includes(p.module) && !r.except?.includes(p.permission_code));
        role = await prisma.sysRole.create({
          data: {
            role_code: await nextSeqCode("role", (await prisma.sysRole.findMany({ select: { role_code: true } })).map((x) => x.role_code)),
            role_label: r.label,
            role_name: r.name,
            created_by: actor,
            permissions: { create: grant.map((p) => ({ permission_id: p.id, created_by: actor })) },
          },
        });
        await audit(actor, "sys_role", role.id);
        made.push(`Role ${r.name}`);
      }
      roleId.set(r.label, role.id);
    }
    const unitId = new Map((await prisma.refUnit.findMany({ select: { id: true, unit_label: true } })).map((u) => [u.unit_label, u.id]));
    for (const u of USERS) {
      if (await prisma.sysUser.findUnique({ where: { email: u.email } })) continue;
      const row = await prisma.sysUser.create({
        data: {
          user_code: await nextSeqCode("user", (await prisma.sysUser.findMany({ select: { user_code: true } })).map((x) => x.user_code)),
          email: u.email,
          name: u.name,
          initials: u.initials,
          password_hash: await hashPassword(password),
          created_by: actor,
          roles: { create: [{ role_id: roleId.get(u.role)!, created_by: actor }] },
        },
      });
      if (u.units?.length) await prisma.prdUserUnit.createMany({ data: u.units.map((l) => ({ user_id: row.id, unit_id: unitId.get(l)!, created_by: actor })) });
      await audit(actor, "sys_user", row.id);
      made.push(`User ${u.email}`);
    }
  }

  // ---- opening stock, through the inventory book like db:stock-inject (no journal)
  const rows: InjectionRow[] = [];
  for (const block of OPENING) {
    const warehouse = await prisma.refWarehouse.findFirstOrThrow({ where: { warehouse_label: block.warehouse } });
    for (const [label, no, qty, value] of block.rows) {
      if (await prisma.logStockTracking.findFirst({ where: { tracking_no: no } })) continue;
      const item = await prisma.mItem.findFirstOrThrow({ where: { item_label: label } });
      rows.push({ itemId: item.id, warehouseId: warehouse.id, lotNo: no, expiry: null, qty: String(qty), value: String(value), date: today });
    }
  }
  if (rows.length) {
    const run = await injectStock(rows, actor);
    made.push(`stok awal ${run.no} (${run.count} baris)`);
  }

  console.log(made.length ? `Dibuat: ${made.join(", ")}` : "Semua data walet sudah ada.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
