/**
 * The Walet production world for the showcase (Walet build step 1,
 * `walet/build-plan.md`): the swiftlet-nest items in grams with their output
 * type and value weight, the eleven units as workstations with their Cost
 * Centers, Kode Job and Standard Cost per gram, the warehouses, the N-MK
 * routing and BoM, and the supplier's raw lots in stock.
 *
 * Figures come from the source workbooks (`walet/walet.md` §4, §6): the
 * standard rates per gram (Pre Wash 182,86 · Cleaning 733,36 · Moulding 190,87 ·
 * Wrapping 27,13 · Barcoding 41,55), each split over the starter Standard Cost
 * Items (TKL, BOP-MESIN, BOP-PABRIK), and the value weights per gram from the
 * Penyebaran card (PT-1 7.140,06 · PT-2 6.136,24 · G2 6.268,77 · BS 3.987,70).
 *
 * Development data only; additive — every record matched on its label and
 * created only when missing. Run from `seed-showcase.ts` after the starter
 * chart (it needs the Standard Cost Items and the fiscal year).
 */
import { prisma } from "../../src/lib/prisma";
import { ENTITIES } from "../../src/lib/erp/entities";
import { nextCode } from "../../src/lib/erp/records";
import { injectStock, type InjectionRow } from "../../src/lib/erp/inventory";

type Ctx = { actor: number; tally: (what: string) => void };

const entity = (key: string) => {
  const e = ENTITIES.find((x) => x.key === key);
  if (!e) throw new Error(`Registry entity ${key} not found`);
  return e;
};

/** Item: label, name, category, base unit, output type, value weight / base unit, bought, sold. */
type ItemSpec = [label: string, name: string, category: string, base: string, output: "Utama" | "Turunan" | "BJL", weight: number | null, buy: boolean, sell: boolean];

export const WALET_ITEMS: ItemSpec[] = [
  // Raw nest as bought (Fase 1)
  ["MK-1-0-PTH", "Mangkok 1 Putih (bahan kotor)", "BHN-BAKU", "GR", "Utama", null, true, false],
  ["MK-1-0-KR", "Mangkok 1 Krem (bahan kotor)", "BHN-BAKU", "GR", "Utama", null, true, false],
  // Graded kinds and in-process goods
  ["MK-1-BSA-PK", "Mangkok 1 Bulu Sedikit Putih Kalsium", "BRG-SETENGAH-JADI", "GR", "Utama", 7000, false, false],
  ["MK-2-BSA-KR", "Mangkok 2 Bulu Sedikit Krem", "BRG-SETENGAH-JADI", "GR", "Utama", 6200, false, false],
  ["KK-0-0-0", "Kakian", "BRG-SETENGAH-JADI", "GR", "Turunan", 4000, false, false],
  ["BS", "BS Grading (rontokan, renda, serabut)", "BRG-SETENGAH-JADI", "GR", "BJL", null, false, false],
  ["SRB", "Serabut", "BRG-SETENGAH-JADI", "GR", "BJL", null, false, false],
  ["PT-1-BSA-PK", "Patahan 1 Bulu Sedikit Putih Kalsium", "BRG-SETENGAH-JADI", "GR", "Utama", 7140.06, false, false],
  ["PT-2-BSA-PK", "Patahan 2 Bulu Sedikit Putih Kalsium", "BRG-SETENGAH-JADI", "GR", "Utama", 6136.24, false, false],
  ["G2-0-0-0", "Grade 2", "BRG-SETENGAH-JADI", "GR", "Utama", 6268.77, false, false],
  ["BS-0-0-0", "BS (lanjut produksi)", "BRG-SETENGAH-JADI", "GR", "Turunan", 3987.7, false, false],
  ["N-NL-KR", "Natural Noodle Krem (kering A)", "BRG-SETENGAH-JADI", "GR", "Utama", null, false, false],
  ["N-NL", "Natural Noodle (moulding)", "BRG-SETENGAH-JADI", "GR", "Utama", null, false, false],
  ["N-NL-PU", "Natural Noodle Putih (barcoding)", "BRG-SETENGAH-JADI", "GR", "Utama", null, false, false],
  // Finished good and packaging
  ["N-MK-50", "N-MK 50 g", "BRG-JADI", "PCS", "Utama", null, false, true],
  ["BOX-NMK", "Box N-MK", "BHN-KEMAS", "PCS", "Utama", null, true, false],
  ["BOX-LUAR", "Box Luar Premium", "BHN-KEMAS", "PCS", "Utama", null, true, false],
];

type Mode = "Transform" | "PassThrough" | "MixTransform";

/** Workstation: unit code (label), name, Kode Job, Cara Kerja (P166), standard per gram per Standard Cost Item. */
type StationSpec = [unit: string, name: string, jobCode: string | null, mode: Mode, rates: [item: string, rate: number][]];

export const WALET_STATIONS: StationSpec[] = [
  ["UGH", "Grading Halus", "UGH", "Transform", []],
  ["UPC", "Pre Cleaning", null, "Transform", []],
  ["UPY", "Penyebaran", null, "Transform", []],
  ["UPW", "Pre Wash", null, "PassThrough", [["TKL", 110], ["BOP-MESIN", 50], ["BOP-PABRIK", 22.86]]],
  ["UCL", "Cleaning", null, "PassThrough", [["TKL", 600], ["BOP-MESIN", 80], ["BOP-PABRIK", 53.36]]],
  ["UDA", "Dry A", null, "Transform", []],
  ["UML", "Moulding", "UDB", "MixTransform", [["TKL", 120], ["BOP-MESIN", 45], ["BOP-PABRIK", 25.87]]],
  ["UWP", "Wrapping", null, "PassThrough", [["TKL", 15], ["BOP-MESIN", 8], ["BOP-PABRIK", 4.13]]],
  ["UBC", "Barcoding", null, "Transform", [["TKL", 25], ["BOP-MESIN", 10], ["BOP-PABRIK", 6.55]]],
  ["UP5", "Packing 95", null, "Transform", []],
  ["UP8", "Packing 98", null, "PassThrough", []],
];

export const WALET_WAREHOUSES: [label: string, name: string][] = [
  ["GD-BB", "Gudang Bahan Baku (Cold Storage)"],
  ["GD-KMS", "Gudang Bahan Kemas"],
  ["GD-FG", "Gudang Barang Jadi"],
  ["GD-BJL", "Gudang BJL"],
];

/** The N-MK route, station by station; each works by its own Cara Kerja. */
const ROUTE = ["UGH", "UPC", "UPY", "UPW", "UCL", "UDA", "UML", "UWP", "UBC", "UP5", "UP8"];

/** N-MK 50 g's BoMs, one per station where components go in (P166). */
const NMK_BOMS: [label: string, name: string, unit: string, lines: [item: string, qty: number][]][] = [
  ["BOM-NMK-50", "N-MK 50 g — isi dan box", "UP5", [["N-NL-PU", 50], ["BOX-NMK", 1]]],
  ["BOM-NMK-50-UP8", "N-MK 50 g — box luar", "UP8", [["BOX-LUAR", 1]]],
];

async function audit(actor: number, entityKey: string, rowId: number) {
  await prisma.auditLog.create({ data: { entity_key: entityKey, row_id: rowId, action: "TAMBAH", event: "create", by: actor } });
}

export async function seedWaletProduction({ actor, tally }: Ctx): Promise<void> {
  const uomId = new Map((await prisma.refUom.findMany()).map((u) => [u.uom_label.toUpperCase(), u.id]));
  for (const needed of ["GR", "PCS"]) if (!uomId.has(needed)) throw new Error(`Satuan ${needed} is missing. Run \`npm run db:seed\` first.`);

  // ---- items
  const itemId = new Map<string, number>();
  for (const [label, name, category, base, output, weight, buy, sell] of WALET_ITEMS) {
    let row = await prisma.mItem.findFirst({ where: { item_label: { equals: label, mode: "insensitive" } } });
    if (!row) {
      const cat = await prisma.sysItemCategory.findFirstOrThrow({ where: { category_label: category } });
      row = await prisma.mItem.create({
        data: {
          item_code: await nextCode(entity("m_item")),
          item_label: label,
          item_name: name,
          item_type: "Barang",
          category_id: cat.id,
          base_uom_id: uomId.get(base)!,
          can_sell: sell,
          can_buy: buy,
          track_stock: true,
          has_expiry: false,
          output_type: output,
          value_weight: weight,
          created_by: actor,
        },
      });
      await audit(actor, "m_item", row.id);
      tally("walet items");
    }
    itemId.set(label, row.id);
  }

  // ---- warehouses
  const warehouseId = new Map<string, number>();
  for (const [label, name] of WALET_WAREHOUSES) {
    let row = await prisma.refWarehouse.findFirst({ where: { warehouse_label: label } });
    if (!row) {
      row = await prisma.refWarehouse.create({
        data: { warehouse_code: await nextCode(entity("ref_warehouse")), warehouse_label: label, warehouse_name: name, created_by: actor },
      });
      await audit(actor, "ref_warehouse", row.id);
      tally("walet warehouses");
    }
    warehouseId.set(label, row.id);
  }

  // ---- Cost Centers: one Produksi pool per unit
  const costCenterId = new Map<string, number>();
  for (const [unit, name] of WALET_STATIONS) {
    const label = `CC-${unit}`;
    let row = await prisma.accCostCenter.findFirst({ where: { cost_center_label: { equals: label, mode: "insensitive" } } });
    if (!row) {
      row = await prisma.accCostCenter.create({
        data: { cost_center_code: await nextCode(entity("acc_cost_center")), cost_center_label: label, cost_center_name: name, cost_center_category: "Production", created_by: actor },
      });
      await audit(actor, "acc_cost_center", row.id);
      tally("walet cost centers");
    }
    costCenterId.set(unit, row.id);
  }

  // ---- workstations: label = unit code, Kode Job where the unit makes Jobs
  const workstationId = new Map<string, number>();
  for (const [unit, name, jobCode, mode] of WALET_STATIONS) {
    let row = await prisma.refWorkstation.findFirst({ where: { workstation_label: unit } });
    if (!row) {
      row = await prisma.refWorkstation.create({
        data: {
          workstation_code: await nextCode(entity("ref_workstation")),
          workstation_label: unit,
          workstation_name: name,
          cost_center_id: costCenterId.get(unit)!,
          job_code: jobCode,
          mode,
          created_by: actor,
        },
      });
      await audit(actor, "ref_workstation", row.id);
      tally("walet workstations");
    }
    workstationId.set(unit, row.id);
  }

  // ---- Standard Cost per gram from January, once per station
  const year = new Date().getUTCFullYear();
  const january = await prisma.accFiscalPeriod.findFirst({ where: { fiscal_year: { year_label: String(year) }, sequence_no: 1 }, select: { id: true } });
  const standardItem = new Map((await prisma.accStandardCostItem.findMany({ select: { id: true, item_label: true } })).map((i) => [i.item_label, i.id]));
  for (const [unit, , , , rates] of WALET_STATIONS) {
    if (!rates.length || !january) continue;
    const ws = workstationId.get(unit)!;
    if (await prisma.accStandardCost.findFirst({ where: { workstation_id: ws } })) continue;
    for (const [item] of rates) if (!standardItem.has(item)) throw new Error(`Standard Cost Item ${item} is missing — the starter chart should have made it.`);
    const row = await prisma.accStandardCost.create({
      data: {
        standard_cost_code: await nextCode(entity("acc_standard_cost")),
        workstation_id: ws,
        effective_period_id: january.id,
        created_by: actor,
        lines: { create: rates.map(([item, rate]) => ({ item_id: standardItem.get(item)!, rate, created_by: actor })) },
      },
    });
    await audit(actor, "acc_standard_cost", row.id);
    tally("walet standard cost");
  }

  // ---- N-MK 50 g's BoMs: 50 g N-NL-PU + a box at Packing 95, an outer box at Packing 98
  for (const [label, name, unit, lines] of NMK_BOMS) {
    if (await prisma.prdBom.findFirst({ where: { bom_label: label } })) continue;
    const bom = await prisma.prdBom.create({
      data: {
        bom_code: await nextCode(entity("prd_bom")),
        bom_label: label,
        bom_name: name,
        item_id: itemId.get("N-MK-50")!,
        workstation_id: workstationId.get(unit)!,
        base_qty: 1,
        is_default: true,
        created_by: actor,
        lines: { create: lines.map(([item, qty]) => ({ item_id: itemId.get(item)!, qty, created_by: actor })) },
      },
    });
    await audit(actor, "prd_bom", bom.id);
    tally("walet bom");
  }

  // ---- Routing N-MK 50 g — Reguler, as the simulation runs it
  if (!(await prisma.prdRouting.findFirst({ where: { routing_label: "RTE-NMK-50" } }))) {
    const row = await prisma.prdRouting.create({
      data: {
        routing_code: await nextCode(entity("prd_routing")),
        routing_label: "RTE-NMK-50",
        routing_name: "N-MK 50 g — Reguler",
        item_id: itemId.get("N-MK-50")!,
        is_default: true,
        created_by: actor,
        steps: {
          create: ROUTE.map((unit, i) => ({ step_no: i + 1, workstation_id: workstationId.get(unit)!, created_by: actor })),
        },
      },
    });
    await audit(actor, "prd_routing", row.id);
    tally("walet routing");
  }

  // ---- the supplier's raw lots and the packaging, in stock
  const supplier = await prisma.mPartner.findFirst({ where: { partner_label: "D0001" }, select: { id: true } });
  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const ddmmyy = `${String(today.getUTCDate()).padStart(2, "0")}${String(today.getUTCMonth() + 1).padStart(2, "0")}${String(today.getUTCFullYear()).slice(2)}`;
  const lots: [item: string, warehouse: string, lotNo: string, qty: number, value: number, fromSupplier: boolean][] = [
    ["MK-1-0-PTH", "GD-BB", `GS_D0001_MK-1-0-PTH_${ddmmyy}`, 40000, 240_000_000, true],
    ["MK-1-0-KR", "GD-BB", `GS_D0001_MK-1-0-KR_${ddmmyy}`, 10000, 50_000_000, true],
    ["BOX-NMK", "GD-KMS", `BOX-NMK_${ddmmyy}`, 1000, 3_500_000, false],
    ["BOX-LUAR", "GD-KMS", `BOX-LUAR_${ddmmyy}`, 1000, 6_000_000, false],
  ];
  const rows: InjectionRow[] = [];
  for (const [item, warehouse, lotNo, qty, value, fromSupplier] of lots) {
    // Additive: once any lot of the item is in stock, the showcase leaves it.
    if (await prisma.logStockTracking.findFirst({ where: { item_id: itemId.get(item)! } })) continue;
    rows.push({
      itemId: itemId.get(item)!,
      warehouseId: warehouseId.get(warehouse)!,
      lotNo,
      expiry: null,
      qty: String(qty),
      value: String(value),
      date: today,
      partnerId: fromSupplier ? supplier?.id ?? null : null,
    });
  }
  if (rows.length) {
    const run = await injectStock(rows, actor);
    tally(`walet stok (${run.no}) — ${run.count} lot`);
  }
}
