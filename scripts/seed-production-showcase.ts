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
 * Packing per Nama Jual (P284).
 */
import { prisma } from "../src/lib/prisma";
import { ENTITIES } from "../src/lib/erp/entities";
import { nextCode } from "../src/lib/erp/records";
import { writeRateCollections } from "../src/lib/erp/production-master";
import { SUPPLIER_CATEGORY } from "../src/lib/erp/entities";

const WAREHOUSES: [label: string, name: string][] = [
  ["GBB", "Gudang Bahan Baku"],
  ["GFG", "Gudang Finish Goods"],
];

type ItemSpec = { label: string; name: string; category: string; base: string; buy?: boolean; sell?: boolean; bjl?: boolean };
const ITEMS: ItemSpec[] = [
  // What comes in from the supplier and what grading makes of it, in grams.
  { label: "SM-A", name: "Sarang Mentah A", category: "BHN-BAKU", base: "GR", buy: true },
  { label: "HLS-A", name: "Sarang Halus A", category: "BRG-SETENGAH-JADI", base: "GR" },
  { label: "HLS-B", name: "Sarang Halus B", category: "BRG-SETENGAH-JADI", base: "GR" },
  { label: "BJL-S", name: "BJL Sortir", category: "BRG-SETENGAH-JADI", base: "GR", bjl: true },
  { label: "MLD-A", name: "Sarang Moulding A", category: "BRG-SETENGAH-JADI", base: "GR" },
  { label: "PCS-A", name: "Keping Sarang A", category: "BRG-SETENGAH-JADI", base: "GR" },
  // A kotak is the Nama Jual's item, one per box (P280 §5.4).
  { label: "BMK50", name: "Sarang Walet BMK 50 g", category: "BRG-JADI", base: "PCS", sell: true },
  { label: "BMK100", name: "Sarang Walet BMK 100 g", category: "BRG-JADI", base: "PCS", sell: true },
  // Bahan penolong, issued to a Unit by BSTB Issue.
  { label: "GRMS", name: "Gramasi", category: "BHN-KEMAS", base: "PCS", buy: true },
  { label: "STK-DAUN", name: "Stiker Daun", category: "BHN-KEMAS", base: "PCS", buy: true },
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
  { label: "BMK50-V1", item: "BMK50", target: 50, tol: 1, min: 8, max: 13, aux: [["GRMS", 1], ["STK-DAUN", 1]] },
  { label: "BMK100-V1", item: "BMK100", target: 100, tol: 1.5, min: 16, max: 26, aux: [["GRMS", 1], ["STK-DAUN", 2]] },
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

  for (const [label, name] of WAREHOUSES) {
    if (await prisma.refWarehouse.findFirst({ where: { OR: [{ warehouse_label: label }, { warehouse_name: name }] } })) continue;
    const row = await prisma.refWarehouse.create({ data: { warehouse_code: await nextCode(entity("ref_warehouse")), warehouse_label: label, warehouse_name: name, created_by: actor } });
    await audit("ref_warehouse", row.id);
    made.push(name);
  }

  const uoms = new Map((await prisma.refUom.findMany({ select: { id: true, uom_label: true } })).map((u) => [u.uom_label, u.id]));
  for (const it of ITEMS) {
    if (await prisma.mItem.findFirst({ where: { OR: [{ item_label: it.label }, { item_name: { equals: it.name, mode: "insensitive" } }] } })) continue;
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
    if (await prisma.prdBom.findFirst({ where: { bom_label: b.label } })) continue;
    const item = await prisma.mItem.findFirstOrThrow({ where: { item_label: b.item } });
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
