/**
 * Development data for walking the PO → Gudang → Produksi → Packing 95 flow through
 * the application (P280, `Simulasi-Gudang-Produksi-Plan.md` 7.0). Never real data:
 * it refuses to run in production and never goes into `prisma/seed.ts` (P11).
 *
 * Additive and matched on label / name, so running it twice changes nothing. Needs
 * `db:seed`, `db:seed-accounts` (the categories' WIP and stock accounts) and
 * `db:seed-production` (the Units) first.
 *
 * Writes: two Gudang without locations, the production items (in grams, one BJL),
 * the kotak items per Nama Jual, bahan penolong, one supplier of sarang walet, and
 * a Standard Cost version with one rate per Unit (P281), made active, and a BoM
 * Packing per Nama Jual (P284), the current fiscal year Open (a PO and every
 * posting need it) and two Karyawan for Pengerjaan Unit and Kerja.
 */
import { prisma } from "../src/lib/prisma";
import { ENTITIES } from "../src/lib/erp/entities";
import { nextCode } from "../src/lib/erp/records";
import { writeRateCollections } from "../src/lib/erp/production-master";
import { SUPPLIER_CATEGORY } from "../src/lib/erp/entities";
import { ensureFiscalPeriods, fiscalYearShape } from "../src/lib/erp/fiscal";

const WAREHOUSES: [label: string, name: string][] = [
  ["GBB", "Gudang Bahan Baku"],
  ["GFG", "Gudang Finish Goods"],
];

/** `was`: the name an earlier run of this seed gave the label, renamed in place while it still reads so. */
type ItemSpec = { label: string; name: string; was?: string; category: string; base: string; buy?: boolean; sell?: boolean; bjl?: boolean };
const SB = "BRG-SETENGAH-JADI";
const ITEMS: ItemSpec[] = [
  // What comes in from the supplier, by grade, in grams.
  { label: "SM-A", name: "Sarang Mentah Grade A", was: "Sarang Mentah A", category: "BHN-BAKU", base: "GR", buy: true },
  { label: "SM-B", name: "Sarang Mentah Grade B", category: "BHN-BAKU", base: "GR", buy: true },
  { label: "SM-C", name: "Sarang Mentah Grade C", category: "BHN-BAKU", base: "GR", buy: true },
  { label: "SM-SD", name: "Sarang Mentah Sudut", category: "BHN-BAKU", base: "GR", buy: true },
  { label: "SM-PT", name: "Sarang Mentah Patahan", category: "BHN-BAKU", base: "GR", buy: true },
  // What grading makes of it: by quality, and by shape.
  { label: "HLS-A", name: "Hasil Grading Super", was: "Sarang Halus A", category: SB, base: "GR" },
  { label: "HLS-B", name: "Hasil Grading Reguler", was: "Sarang Halus B", category: SB, base: "GR" },
  { label: "HLS-C", name: "Hasil Grading Ekonomi", category: SB, base: "GR" },
  { label: "HLS-SD", name: "Hasil Grading Sudut", category: SB, base: "GR" },
  { label: "HLS-PT", name: "Hasil Grading Patahan", category: SB, base: "GR" },
  // BJL (bahan yang dibuang): carries grams and quantity but is always valued 0 (W32).
  { label: "BJL-S", name: "BJL Serpihan", was: "BJL Sortir", category: SB, base: "GR", bjl: true },
  { label: "BJL-B", name: "BJL Bulu", category: SB, base: "GR", bjl: true },
  { label: "BJL-K", name: "BJL Kotoran", category: SB, base: "GR", bjl: true },
  { label: "BJL-D", name: "BJL Debu", category: SB, base: "GR", bjl: true },
  // Moulded goods, then the pieces cut for a kotak.
  { label: "MLD-A", name: "Mangkok Moulding", was: "Sarang Moulding A", category: SB, base: "GR" },
  { label: "MLD-B", name: "Mangkok Moulding Reguler", category: SB, base: "GR" },
  { label: "MLD-SD", name: "Sudut Moulding", category: SB, base: "GR" },
  { label: "PCS-A", name: "Keping Mangkok", was: "Keping Sarang A", category: SB, base: "GR" },
  { label: "PCS-B", name: "Keping Mangkok Reguler", category: SB, base: "GR" },
  { label: "PCS-SD", name: "Keping Sudut", category: SB, base: "GR" },
  // A kotak is the Nama Jual's item, one per box (P280 §5.4).
  { label: "BMK25", name: "B-MK 25 gr", category: "BRG-JADI", base: "PCS", sell: true },
  { label: "BMK50", name: "B-MK 50 gr", was: "Sarang Walet BMK 50 g", category: "BRG-JADI", base: "PCS", sell: true },
  { label: "BMK100", name: "B-MK 100 gr", was: "Sarang Walet BMK 100 g", category: "BRG-JADI", base: "PCS", sell: true },
  { label: "BSD50", name: "B-SD 50 gr", category: "BRG-JADI", base: "PCS", sell: true },
  // Bahan penolong, issued to a Unit by BSTB Issue.
  { label: "GRMS", name: "Gramasi", category: "BHN-KEMAS", base: "PCS", buy: true },
  { label: "STK-DAUN", name: "Stiker Daun", category: "BHN-KEMAS", base: "PCS", buy: true },
  { label: "STK-SGL", name: "Stiker Segel", category: "BHN-KEMAS", base: "PCS", buy: true },
  { label: "KTG", name: "Kantong Plastik", category: "BHN-KEMAS", base: "PCS", buy: true },
  { label: "BOX", name: "Box", category: "BHN-KEMAS", base: "PCS", buy: true },
];

/** Rp per gram per Unit, charged once at the Unit's last process (P281). */
const RATES: Record<string, string> = {
  UGH: "10",
  UPC: "5",
  UPY: "3",
  UPW: "5",
  UCL: "20",
  UC1: "2",
  USR: "4",
  UDA: "6",
  UML: "15",
  UDB: "6",
  UWP: "8",
  UBC: "5",
  UP5: "10",
};

/** BoM Packing per Nama Jual: gram ± tolerance, piece count, bahan penolong per kotak (the artifact's NJ). */
const BOMS: { label: string; item: string; target: number; tol: number; min: number; max: number; aux: [string, number][] }[] = [
  { label: "BMK25-V1", item: "BMK25", target: 25, tol: 0.5, min: 4, max: 7, aux: [["GRMS", 1], ["STK-SGL", 1]] },
  { label: "BMK50-V1", item: "BMK50", target: 50, tol: 1, min: 8, max: 13, aux: [["GRMS", 1], ["STK-DAUN", 1]] },
  { label: "BMK100-V1", item: "BMK100", target: 100, tol: 1.5, min: 16, max: 26, aux: [["GRMS", 1], ["STK-DAUN", 2]] },
  { label: "BSD50-V1", item: "BSD50", target: 50, tol: 1, min: 8, max: 13, aux: [["GRMS", 1], ["KTG", 1]] },
];

const entity = (key: string) => {
  const e = ENTITIES.find((x) => x.key === key);
  if (!e) throw new Error(`Registry entity ${key} not found`);
  return e;
};

async function main() {
  if (process.env.NODE_ENV === "production") throw new Error("seed-production-showcase is development data and never runs in production.");
  const sistem = await prisma.sysUser.findUnique({ where: { email: "sistem@erp.app" }, select: { id: true } });
  if (!sistem) throw new Error("System data is missing. Run `npm run db:seed` first.");
  const actor = sistem.id;
  const made: string[] = [];
  const audit = (entityKey: string, rowId: number) => prisma.auditLog.create({ data: { entity_key: entityKey, row_id: rowId, action: "TAMBAH", event: "create", by: actor } });

  const year = new Date().getUTCFullYear();
  if (!(await prisma.accFiscalYear.findFirst({ where: { year_label: String(year) } }))) {
    const code = await nextCode(entity("acc_fiscal_year"));
    const fy = await prisma.$transaction(async (tx) => {
      const row = await tx.accFiscalYear.create({ data: { year_code: code, year_label: String(year), ...fiscalYearShape(year), status: "Open", created_by: actor } });
      await ensureFiscalPeriods(tx, { fiscalYearId: row.id, year, actorId: actor });
      return row;
    });
    await audit("acc_fiscal_year", fy.id);
    made.push(`Tahun Buku ${year}`);
  }

  for (const [label, name] of [["ANI", "Ani"], ["BUDI", "Budi"]] as const) {
    if (await prisma.mEmployee.findFirst({ where: { employee_label: label } })) continue;
    const row = await prisma.mEmployee.create({ data: { employee_code: await nextCode(entity("m_employee")), employee_label: label, employee_name: name, created_by: actor } });
    await audit("m_employee", row.id);
    made.push(`Karyawan ${name}`);
  }

  for (const [label, name] of WAREHOUSES) {
    if (await prisma.refWarehouse.findFirst({ where: { OR: [{ warehouse_label: label }, { warehouse_name: name }] } })) continue;
    const row = await prisma.refWarehouse.create({ data: { warehouse_code: await nextCode(entity("ref_warehouse")), warehouse_label: label, warehouse_name: name, created_by: actor } });
    await audit("ref_warehouse", row.id);
    made.push(name);
  }

  const uoms = new Map((await prisma.refUom.findMany({ select: { id: true, uom_label: true } })).map((u) => [u.uom_label, u.id]));
  for (const it of ITEMS) {
    const known = await prisma.mItem.findFirst({ where: { OR: [{ item_label: it.label }, { item_name: { equals: it.name, mode: "insensitive" } }] } });
    if (known) {
      if (it.was && known.item_label === it.label && known.item_name === it.was) {
        await prisma.mItem.update({ where: { id: known.id }, data: { item_name: it.name, updated_by: actor } });
        made.push(`${it.label} (nama diperbarui)`);
      }
      continue;
    }
    const category = await prisma.sysItemCategory.findUniqueOrThrow({ where: { category_label: it.category } });
    const base = uoms.get(it.base);
    if (!base) throw new Error(`Satuan ${it.base} tidak ada. Jalankan npm run db:seed.`);
    const row = await prisma.mItem.create({
      data: {
        item_code: await nextCode(entity("m_item")),
        item_label: it.label,
        item_name: it.name,
        item_type: "Barang",
        category_id: category.id,
        base_uom_id: base,
        can_sell: Boolean(it.sell),
        can_buy: Boolean(it.buy),
        track_stock: true,
        has_expiry: false,
        is_bjl: Boolean(it.bjl),
        created_by: actor,
      },
    });
    await audit("m_item", row.id);
    made.push(it.label);
  }

  const supplierName = "CV Sarang Walet Nusantara";
  if (!(await prisma.mPartner.findFirst({ where: { partner_name: { equals: supplierName, mode: "insensitive" } } }))) {
    const category = await prisma.sysPartnerCategory.findFirstOrThrow({ where: { category_label: SUPPLIER_CATEGORY } });
    const city = await prisma.sysRegionCity.findFirst({ where: { name: { contains: "Surabaya", mode: "insensitive" } } });
    const district = city ? await prisma.sysRegionDistrict.findFirst({ where: { city_id: city.id }, orderBy: { name: "asc" } }) : null;
    const village = await prisma.sysRegionVillage.findFirst({ where: district ? { district_id: district.id } : {}, orderBy: { name: "asc" } });
    if (!village) throw new Error("Wilayah belum dimuat. Jalankan npm run db:seed.");
    const term = await prisma.refPaymentTerm.findFirst({ where: { term_label: "NET30" } });
    const row = await prisma.mPartner.create({
      data: {
        partner_code: await nextCode(entity("m_partner")),
        partner_label: "SWN",
        partner_name: supplierName,
        category_id: category.id,
        taxpayer_type: "Badan",
        tax_id_type: "NPWP",
        tax_id: "0912345678901234",
        tax_name: supplierName,
        is_pkp: true,
        purchase_term_id: term?.id ?? null,
        purchase_price_mode: "Exclude",
        created_by: actor,
        addresses: { create: [{ village_id: village.id, street: "Jl. Walet No. 1", is_billing: true, is_shipping: true, sort_order: 0, created_by: actor }] },
      },
    });
    await audit("m_partner", row.id);
    made.push(supplierName);
  }

  if (!(await prisma.prdRateVersion.findFirst({ where: { rate_label: "SC-SIM" } }))) {
    const units = await prisma.refUnit.findMany({ where: { unit_label: { in: Object.keys(RATES) }, status: "Active" }, select: { id: true, unit_label: true } });
    if (units.length !== Object.keys(RATES).length) throw new Error("Unit produksi belum lengkap. Jalankan npm run db:seed-production.");
    await prisma.$transaction(async (tx) => {
      const v = await tx.prdRateVersion.create({ data: { rate_code: await nextCode(entity("prd_rate_version")), rate_label: "SC-SIM", rate_name: "Standard Cost Simulasi", created_by: actor } });
      await writeRateCollections(tx, v.id, { rates: units.map((u) => ({ unit_id: u.id, rate: RATES[u.unit_label] })) }, actor);
      await tx.auditLog.create({ data: { entity_key: "prd_rate_version", row_id: v.id, action: "TAMBAH", event: "create", by: actor } });
    });
    made.push("Standard Cost SC-SIM (aktif)");
  }

  for (const b of BOMS) {
    const item = await prisma.mItem.findFirstOrThrow({ where: { item_label: b.item } });
    const have = await prisma.prdBom.findFirst({ where: { bom_label: b.label } });
    if (have) {
      // The name follows the item's, so a renamed item does not leave the BoM reading the old one.
      if (have.bom_name !== `${item.item_name} versi 1`) await prisma.prdBom.update({ where: { id: have.id }, data: { bom_name: `${item.item_name} versi 1`, updated_by: actor } });
      continue;
    }
    const aux = await prisma.mItem.findMany({ where: { item_label: { in: b.aux.map(([l]) => l) } }, select: { id: true, item_label: true } });
    const row = await prisma.prdBom.create({
      data: {
        bom_code: await nextCode(entity("prd_bom")),
        bom_label: b.label,
        bom_name: `${item.item_name} versi 1`,
        item_id: item.id,
        target_grams: b.target,
        tolerance_grams: b.tol,
        min_pieces: b.min,
        max_pieces: b.max,
        created_by: actor,
        components: { create: b.aux.map(([l, qty], i) => ({ item_id: aux.find((a) => a.item_label === l)!.id, qty, sort_order: i })) },
      },
    });
    await audit("prd_bom", row.id);
    made.push(`BoM ${b.label}`);
  }

  console.log(made.length ? `Dibuat: ${made.join(", ")}` : "Semua data simulasi produksi sudah ada.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
