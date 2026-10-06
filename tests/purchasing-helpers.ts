import assert from "node:assert/strict";

import { createPurchaseOrder, transitionPurchaseOrder, type PurchaseOrderLineInput } from "../src/lib/erp/purchase-order";
import { createPurchaseRequest, transitionPurchaseRequest } from "../src/lib/erp/purchase-request";
import { FIXTURE_PREFIX, cleanupStock, makeAccount, partnerCategoryId, prisma, systemUserId } from "./helpers";

/**
 * A purchasing world for the suites after the Purchase Order (P125 on): items
 * of every kind, a PKP supplier with an NPWP and one without, a warehouse, the
 * Pembelian accounts in Account Mapping and per Kategori Item, and a way to
 * reach an Open Purchase Order through its request. Everything it changes it
 * puts back in `teardown`.
 */
export type PurchasingWorld = {
  actor: number;
  key: (s: string) => string;
  f: Record<string, number>;
  ids: { pr: number[]; po: number[] };
  /** An Open PO (submitted and approved) for these items, each from its own request line. */
  openPO: (
    lines: { item: number; qty: number; price: number; uom?: number; wht?: number | null }[],
    over?: { itemType?: "Barang" | "Jasa"; taxable?: boolean; supplier?: number; date?: string }
  ) => Promise<{ id: number; orderNo: string; lineIds: number[] }>;
  setMapping: (k: string, v: string | null) => Promise<void>;
  teardown: () => Promise<void>;
};

export async function purchasingWorld(tag: string): Promise<PurchasingWorld> {
  const actor = await systemUserId();
  const stamp = String(Date.now() % 100000);
  const key = (s: string) => `${FIXTURE_PREFIX}${tag}${s}${stamp}`;
  const f: Record<string, number> = {};
  const ids = { pr: [] as number[], po: [] as number[] };
  const saved = new Map<string, string | null>();
  const savedCats = new Map<number, { inventory_account_id: number | null; cogs_account_id: number | null; expense_account_id: number | null } | null>();

  const setMapping = async (k: string, v: string | null) => {
    if (!saved.has(k)) saved.set(k, (await prisma.sysSetting.findUnique({ where: { setting_key: k } }))?.setting_value ?? null);
    await prisma.sysSetting.upsert({ where: { setting_key: k }, update: { setting_value: v }, create: { setting_key: k, setting_value: v, updated_by: actor } });
  };
  const setCategory = async (categoryId: number, data: { inventory_account_id?: number | null; expense_account_id?: number | null }) => {
    if (!savedCats.has(categoryId)) {
      const row = await prisma.accItemCategoryAccount.findUnique({ where: { category_id: categoryId } });
      savedCats.set(categoryId, row ? { inventory_account_id: row.inventory_account_id, cogs_account_id: row.cogs_account_id, expense_account_id: row.expense_account_id } : null);
    }
    await prisma.accItemCategoryAccount.upsert({ where: { category_id: categoryId }, update: data, create: { category_id: categoryId, ...data, created_by: actor } });
  };

  f.pcs = (await prisma.refUom.create({ data: { uom_code: `test.${key("PCS")}`, uom_label: key("PCS"), uom_name: "Pcs", created_by: actor } })).id;
  f.box = (await prisma.refUom.create({ data: { uom_code: `test.${key("BOX")}`, uom_label: key("BOX"), uom_name: "Box", created_by: actor } })).id;
  const cat = async (label: string) => (await prisma.sysItemCategory.findUniqueOrThrow({ where: { category_label: label } })).id;
  f.catStock = await cat("BHN-BAKU");
  f.catPlain = await cat("BHN-KEMAS");
  f.catService = await cat("JASA-LAIN");
  const item = async (l: string, type: "Barang" | "Jasa", category: number, extra: Record<string, boolean> = {}) =>
    (
      await prisma.mItem.create({
        data: { item_code: `test.${key(l)}`, item_label: key(l), item_name: l, item_type: type, category_id: category, base_uom_id: f.pcs, can_buy: true, can_sell: false, created_by: actor, ...extra },
      })
    ).id;
  f.stock = await item("STOCK", "Barang", f.catStock, { track_stock: true });
  f.expiring = await item("EXP", "Barang", f.catStock, { track_stock: true, has_expiry: true });
  f.plain = await item("PLAIN", "Barang", f.catPlain);
  f.service = await item("SERVICE", "Jasa", f.catService);
  await prisma.mItemUom.create({ data: { item_id: f.stock, uom_id: f.box, factor: 12, created_by: actor } });
  f.term = (await prisma.refPaymentTerm.create({ data: { term_code: `test.${key("T")}`, term_label: key("T"), term_name: "Net 30", due_days: 30, created_by: actor } })).id;
  f.warehouse = (await prisma.refWarehouse.create({ data: { warehouse_code: `test.${key("WH")}`, warehouse_label: key("WH"), warehouse_name: "Gudang Uji", created_by: actor } })).id;
  f.wht = (await prisma.refWithholdingTax.create({ data: { wht_code: `test.${key("W")}`, wht_label: key("W"), wht_name: "PPh 23 Beli", rate: 2, usage: "Purchase", created_by: actor } })).id;
  const supplierCat = await partnerCategoryId("Supplier");
  const supplier = async (l: string, pkp: boolean, taxId: string | null) =>
    (
      await prisma.mPartner.create({
        data: { partner_code: `test.${key(l)}`, partner_label: key(l), partner_name: `Supplier ${l}`, category_id: supplierCat, is_pkp: pkp, tax_id: taxId, tax_id_type: taxId ? "NPWP" : null, created_by: actor },
      })
    ).id;
  f.supplier = await supplier("PKP", true, "0123456789012345");
  f.noNpwp = await supplier("NONPWP", false, null);

  const sub = async (label: string) =>
    (await prisma.accAccountSubcategory.findFirstOrThrow({ where: { subcategory_label: { startsWith: label } }, orderBy: { id: "asc" } })).subcategory_label;
  f.invAcc = await makeAccount({ subcategoryLabel: await sub("1") });
  f.catInvAcc = await makeAccount({ subcategoryLabel: await sub("1") });
  f.expAcc = await makeAccount({ subcategoryLabel: await sub("5") });
  f.grirAcc = await makeAccount({ subcategoryLabel: await sub("2") });
  await setMapping("inventory_account", String(f.invAcc));
  await setMapping("goods_received_account", String(f.grirAcc));
  await setCategory(f.catStock, { inventory_account_id: f.catInvAcc });
  await setCategory(f.catPlain, { inventory_account_id: null, expense_account_id: f.expAcc });
  await setCategory(f.catService, { expense_account_id: f.expAcc });

  const openPO: PurchasingWorld["openPO"] = async (lines, over = {}) => {
    const itemType = over.itemType ?? "Barang";
    const date = over.date ?? new Date().toISOString().slice(0, 10);
    const pr = await createPurchaseRequest(
      { item_type: itemType, request_date: date, needed_date: date, requester: "", warehouse_id: null, note: "" },
      lines.map((l) => ({ item_id: l.item, qty: l.qty * (l.uom === f.box ? 12 : 1), needed_date: date, note: "" })),
      actor
    );
    assert.ok(pr.ok, JSON.stringify(pr));
    ids.pr.push(pr.id);
    await transitionPurchaseRequest(pr.id, "submit", actor);
    const prLines = await prisma.purRequestLine.findMany({ where: { request_id: pr.id }, orderBy: { line_no: "asc" } });
    const poLines: PurchaseOrderLineInput[] = lines.map((l, i) => ({
      item_id: l.item,
      uom_id: l.uom ?? f.pcs,
      qty: l.qty,
      price: l.price,
      discount_type: null,
      discount_value: null,
      withholding_tax_id: l.wht ?? null,
      note: "",
      request_line_ids: [prLines[i].id],
    }));
    const po = await createPurchaseOrder(
      {
        item_type: itemType,
        order_date: date,
        supplier_id: over.supplier ?? f.supplier,
        term_id: f.term,
        delivery_date: date,
        warehouse_id: itemType === "Barang" ? f.warehouse : null,
        quotation_no: "",
        price_mode: "Exclude",
        is_taxable: over.taxable ?? true,
        note: "",
      },
      poLines,
      actor
    );
    assert.ok(po.ok, JSON.stringify(po));
    ids.po.push(po.id);
    assert.deepEqual(await transitionPurchaseOrder(po.id, "submit", actor), { ok: true });
    assert.deepEqual(await transitionPurchaseOrder(po.id, "approve", actor), { ok: true });
    const stored = await prisma.purOrderLine.findMany({ where: { order_id: po.id }, orderBy: { line_no: "asc" } });
    return { id: po.id, orderNo: po.orderNo, lineIds: stored.map((l) => l.id) };
  };

  const teardown = async () => {
    await prisma.purOrderLineRequest.deleteMany({ where: { order_line: { order_id: { in: ids.po } } } });
    await prisma.purOrderLine.deleteMany({ where: { order_id: { in: ids.po } } });
    await prisma.purOrder.deleteMany({ where: { id: { in: ids.po } } });
    await prisma.auditLog.deleteMany({ where: { OR: [{ entity_key: "pur_order", row_id: { in: ids.po } }, { entity_key: "pur_request", row_id: { in: ids.pr } }] } });
    await prisma.purRequestLine.deleteMany({ where: { request_id: { in: ids.pr } } });
    await prisma.purRequest.deleteMany({ where: { id: { in: ids.pr } } });
    for (const [k, v] of saved) await prisma.sysSetting.update({ where: { setting_key: k }, data: { setting_value: v } });
    for (const [categoryId, row] of savedCats) {
      if (row) await prisma.accItemCategoryAccount.update({ where: { category_id: categoryId }, data: row });
      else await prisma.accItemCategoryAccount.delete({ where: { category_id: categoryId } });
    }
    const items = [f.stock, f.expiring, f.plain, f.service];
    await cleanupStock(items);
    await prisma.mItemUom.deleteMany({ where: { item_id: { in: items } } });
    await prisma.mItem.deleteMany({ where: { id: { in: items } } });
    await prisma.mPartner.deleteMany({ where: { id: { in: [f.supplier, f.noNpwp] } } });
    await prisma.refWithholdingTax.deleteMany({ where: { id: f.wht } });
    await prisma.refPaymentTerm.deleteMany({ where: { id: f.term } });
    await prisma.refWarehouse.deleteMany({ where: { id: f.warehouse } });
    await prisma.refUom.deleteMany({ where: { id: { in: [f.pcs, f.box] } } });
  };

  return { actor, key, f, ids, openPO, setMapping, teardown };
}
