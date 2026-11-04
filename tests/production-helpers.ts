import { cleanupStock, makeAccount, prisma, stockIn, systemUserId } from "./helpers";

/**
 * A production fixture (P200): a category with its own Persediaan and WIP
 * accounts, a material and two products, a warehouse, two units and a
 * stock lot of the material.
 * Everything is the test's own and goes in `teardown`.
 */
export type ProductionFixture = {
  actor: number;
  category: number;
  inventoryAcc: number;
  wipAcc: number;
  scrapAcc: number;
  uom: number;
  material: number;
  product: number;
  byproduct: number;
  warehouse: number;
  wsA: number;
  wsB: number;
  /** 1.000 base units of the material at Rp 1.000.000. */
  lot: number;
  key: (s: string) => string;
  teardown: () => Promise<void>;
};

export async function makeProductionFixture(tag: string): Promise<ProductionFixture> {
  const actor = await systemUserId();
  const stamp = `${tag}${Date.now() % 1_000_000}`;
  const key = (s: string) => `T${s}-${stamp}`.toUpperCase();
  const inventoryAcc = await makeAccount({ subcategoryLabel: "1.1.5" });
  const wipAcc = await makeAccount({ subcategoryLabel: "1.1.5" });
  const scrapAcc = await makeAccount({ subcategoryLabel: "5.1.9" });
  const category = (
    await prisma.sysItemCategory.create({
      data: { category_code: `test.${key("CAT")}`, category_label: key("CAT"), category_name: "Kategori Uji Produksi", item_type: "Barang", created_by: actor },
    })
  ).id;
  await prisma.accItemCategoryAccount.create({ data: { category_id: category, inventory_account_id: inventoryAcc, cogs_account_id: scrapAcc, wip_account_id: wipAcc, created_by: actor } });
  const uom = (await prisma.refUom.findFirstOrThrow({ where: { uom_label: "GR" } })).id;
  const item = async (label: string) =>
    (
      await prisma.mItem.create({
        data: { item_code: `test.${key(label)}`, item_label: key(label), item_name: label, item_type: "Barang", category_id: category, base_uom_id: uom, track_stock: true, created_by: actor },
      })
    ).id;
  const material = await item("BAHAN");
  const product = await item("PRODUK");
  const byproduct = await item("SISA");
  const warehouse = (await prisma.refWarehouse.create({ data: { warehouse_code: `test.${key("WH")}`, warehouse_label: key("WH"), warehouse_name: "Gudang Uji Produksi", created_by: actor } })).id;
  const ws = async (label: string) =>
    (await prisma.refUnit.create({ data: { unit_code: `test.${key(label)}`, unit_label: key(label), unit_name: label, created_by: actor } })).id;
  const wsA = await ws("WSA");
  const wsB = await ws("WSB");
  const lot = await stockIn(material, warehouse, key("L1"), 1_000, 1_000_000);
  const items = [material, product, byproduct];

  return {
    actor,
    category,
    inventoryAcc,
    wipAcc,
    scrapAcc,
    uom,
    material,
    product,
    byproduct,
    warehouse,
    wsA,
    wsB,
    lot,
    key,
    teardown: async () => {
      await cleanupProduction(items);
      await cleanupStock(items);
      await prisma.mItem.deleteMany({ where: { id: { in: items } } });
      await prisma.accItemCategoryAccount.deleteMany({ where: { category_id: category } });
      await prisma.sysItemCategory.deleteMany({ where: { id: category } });
      await prisma.refUnit.deleteMany({ where: { id: { in: [wsA, wsB] } } });
      await prisma.refWarehouse.deleteMany({ where: { id: warehouse } });
    },
  };
}

/** Removes every production book row of fixture items — a test's own teardown. */
export async function cleanupProduction(itemIds: number[]): Promise<void> {
  const lots = (await prisma.logStockTracking.findMany({ where: { item_id: { in: itemIds } }, select: { id: true } })).map((l) => l.id);
  await prisma.prdTrackingLink.deleteMany({ where: { OR: [{ from_tracking_id: { in: lots } }, { to_tracking_id: { in: lots } }] } });
  await prisma.prdLedger.deleteMany({ where: { item_id: { in: itemIds } } });
  await prisma.prdBalance.deleteMany({ where: { item_id: { in: itemIds } } });
}

/** A source for direct book calls: the given document type, a made-up id. */
export async function sourceOf(table: string, no: string, docId = 900_000_000 + (Date.now() % 1_000_000)) {
  const t = await prisma.sysDocType.findFirstOrThrow({ where: { doc_table: table }, select: { id: true } });
  return { docTypeId: t.id, docId, no };
}
