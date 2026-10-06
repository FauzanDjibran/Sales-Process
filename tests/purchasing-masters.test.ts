import test, { after, before, describe } from "node:test";
import assert from "node:assert/strict";

import { ENTITIES, fieldApplies, SUPPLIER_CATEGORY } from "../src/lib/erp/entities";
import { checkCustomerOrder, customerOrderOptions } from "../src/lib/erp/customer-order";
import { accountsForItems, categoriesUsingAccount, saveItemCategoryAccounts } from "../src/lib/erp/item-account";
import { SYSTEM_DEFAULTS } from "../src/lib/erp/system-defaults";
import { FIXTURE_PREFIX, cleanupFixtures, disconnect, makeAccount, prisma, systemUserId } from "./helpers";

/**
 * The masters purchasing stands on (P122, Purchasing-Concept.md B1–B5a): a
 * Jenis PPh belongs to one side, Supplier is switched on with its purchase
 * defaults, the Pembelian settings exist, and each Kategori Item may name its
 * own Persediaan, HPP and Beban.
 */

let actor = 0;
const started = new Date();
const f = {} as Record<string, number>;
const stamp = String(Date.now() % 100000);
const key = (s: string) => `${FIXTURE_PREFIX}${s}${stamp}`;
const saved = new Map<number, { inventory_account_id: number | null; cogs_account_id: number | null; expense_account_id: number | null } | null>();

before(async () => {
  actor = await systemUserId();
  f.goodsCat = (await prisma.sysItemCategory.findUniqueOrThrow({ where: { category_label: "BRG-JADI" } })).id;
  f.serviceCat = (await prisma.sysItemCategory.findFirstOrThrow({ where: { item_type: "Jasa" } })).id;
  for (const id of [f.goodsCat, f.serviceCat]) {
    const row = await prisma.accItemCategoryAccount.findUnique({ where: { category_id: id } });
    saved.set(id, row ? { inventory_account_id: row.inventory_account_id, cogs_account_id: row.cogs_account_id, expense_account_id: row.expense_account_id } : null);
  }
  const sub = async (label: string) =>
    (await prisma.accAccountSubcategory.findFirstOrThrow({ where: { subcategory_label: { startsWith: label } }, orderBy: { id: "asc" } })).subcategory_label;
  f.inv = await makeAccount({ subcategoryLabel: await sub("1") });
  f.cogs = await makeAccount({ subcategoryLabel: await sub("5") });
  f.exp = await makeAccount({ subcategoryLabel: await sub("5") });
  f.pcs = (await prisma.refUom.create({ data: { uom_code: `test.${key("PCS")}`, uom_label: key("PCS"), uom_name: "Pcs", created_by: actor } })).id;
  f.item = (
    await prisma.mItem.create({
      data: { item_code: `test.${key("IT")}`, item_label: key("IT"), item_name: "Uji", item_type: "Barang", category_id: f.goodsCat, base_uom_id: f.pcs, can_sell: true, created_by: actor },
    })
  ).id;
});

after(async () => {
  for (const [id, row] of saved) {
    if (row) await prisma.accItemCategoryAccount.update({ where: { category_id: id }, data: row });
    else await prisma.accItemCategoryAccount.deleteMany({ where: { category_id: id } });
  }
  await prisma.auditLog.deleteMany({ where: { entity_key: "acc_item_category_account", at: { gte: started } } });
  await prisma.mItem.deleteMany({ where: { id: f.item } });
  await prisma.refUom.deleteMany({ where: { id: f.pcs } });
  await cleanupFixtures();
  await disconnect();
});

describe("a Jenis PPh belongs to one side (P122)", () => {
  test("the seeded sales types are Sales, and a purchase starter is its own record", async () => {
    const sales = await prisma.refWithholdingTax.findMany({ where: { wht_label: { in: ["PPH22", "PPH23", "PPH23-15"] } } });
    assert.ok(sales.length === 3 && sales.every((t) => t.usage === "Sales"));
    const buy = await prisma.refWithholdingTax.findFirstOrThrow({ where: { wht_label: "PPH23-BELI" } });
    assert.equal(buy.usage, "Purchase");
    assert.equal(buy.rate.toNumber(), 2);
  });

  test("its usage is chosen once, at creation", () => {
    const usage = ENTITIES.find((e) => e.key === "ref_withholding_tax")!.fields.find((x) => x.name === "usage")!;
    assert.equal(usage.createOnly, true);
  });

  test("a Customer Order offers and accepts sales Jenis PPh only", async () => {
    const options = await customerOrderOptions();
    const buy = await prisma.refWithholdingTax.findFirstOrThrow({ where: { wht_label: "PPH23-BELI" } });
    assert.ok(!options.withholdingTaxes.some((t) => t.id === buy.id), "not offered");
    const r = await checkCustomerOrder(
      { order_date: "2026-10-06", customer_id: null, address_id: null, term_id: null, price_mode: "Exclude", is_taxable: false, po_no: "", po_date: "", salesperson: "", note: "" },
      [{ item_id: f.item, uom_id: f.pcs, qty: 1, price: 1000, discount_type: null, discount_value: null, withholding_tax_id: buy.id, note: "" }]
    );
    assert.ok(!r.ok && /Jenis PPh pembelian/.test(r.errors["lines.0.withholding_tax_id"]), "refused on its row");
  });
});

describe("Supplier is switched on with purchase defaults (B1, B2)", () => {
  test("the Supplier category is Active", async () => {
    const c = await prisma.sysPartnerCategory.findFirstOrThrow({ where: { category_label: SUPPLIER_CATEGORY } });
    assert.equal(c.status, "Active");
  });

  test("the Pembelian tab shows for a supplier only", () => {
    const partner = ENTITIES.find((e) => e.key === "m_partner")!;
    const term = partner.fields.find((x) => x.name === "purchase_term_id")!;
    assert.equal(term.tab, "purchase");
    assert.equal(fieldApplies(term, { category_id: 2 }, () => "Supplier"), true);
    assert.equal(fieldApplies(term, { category_id: 1 }, () => "Customer"), false);
  });
});

describe("the Pembelian settings exist (B5, B29b)", () => {
  test("five accounts on Account Mapping and the tolerance on System Default, seeded at Rp 100", async () => {
    const keys = SYSTEM_DEFAULTS.map((d) => d.key as string);
    for (const k of ["goods_received_account", "payable_account", "purchase_advance_account", "input_vat_account", "supplier_invoice_diff_account", "supplier_invoice_tolerance"]) {
      assert.ok(keys.includes(k), k);
    }
    const t = await prisma.sysSetting.findUniqueOrThrow({ where: { setting_key: "supplier_invoice_tolerance" } });
    assert.equal(t.setting_value, "100");
  });
});

describe("accounts per Kategori Item (B5a, closes C25)", () => {
  test("a Jasa category takes only a Beban account; every account must be active and postable", async () => {
    const jasa = await saveItemCategoryAccounts([{ categoryId: f.serviceCat, inventory: f.inv, cogs: null, expense: null }], actor);
    assert.ok(!jasa.ok && /hanya memakai Account Beban/.test(jasa.errors[`${f.serviceCat}.inventory`]));
    await prisma.accAccount.update({ where: { id: f.exp }, data: { is_active: false } });
    const bad = await saveItemCategoryAccounts([{ categoryId: f.goodsCat, inventory: null, cogs: null, expense: f.exp }], actor);
    await prisma.accAccount.update({ where: { id: f.exp }, data: { is_active: true } });
    assert.ok(!bad.ok && /non-aktif/.test(bad.errors[`${f.goodsCat}.expense`]), "an inactive account is refused");
  });

  test("saved accounts resolve per item; an empty one reads null for the caller's fallback", async () => {
    const r = await saveItemCategoryAccounts([{ categoryId: f.goodsCat, inventory: f.inv, cogs: f.cogs, expense: null }], actor);
    assert.deepEqual(r, { ok: true, changed: 1 });
    assert.deepEqual((await accountsForItems([f.item])).get(f.item), { inventory: f.inv, cogs: f.cogs, expense: null });
    assert.deepEqual(await saveItemCategoryAccounts([{ categoryId: f.goodsCat, inventory: f.inv, cogs: f.cogs, expense: null }], actor), { ok: true, changed: 0 }, "nothing changed, nothing written");
  });

  test("an account a category uses is named before it is deactivated", async () => {
    const label = (await prisma.sysItemCategory.findUniqueOrThrow({ where: { id: f.goodsCat } })).category_label;
    assert.ok((await categoriesUsingAccount(f.inv)).includes(label));
  });
});
