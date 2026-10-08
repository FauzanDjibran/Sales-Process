import test, { after, before, describe } from "node:test";
import assert from "node:assert/strict";

import { ENTITIES } from "../src/lib/erp/entities";
import { entityPermissions } from "../src/lib/erp/entity-access";
import { postJournal } from "../src/lib/erp/journal";
import { saveItemCategoryAccounts } from "../src/lib/erp/item-account";
import { MODULES } from "../src/lib/erp/nav";
import { PERMISSIONS } from "../src/lib/erp/permissions";
import { COST_ELEMENT_REFUSAL, costElementAccountProblem, isCostElementAccount } from "../src/lib/erp/production-cost";
import { refOptions } from "../src/lib/erp/records";
import { settingPageOf, systemDefaultDef } from "../src/lib/erp/system-defaults";
import { checkSystemDefaultValue, settingOptions, systemDefaults } from "../src/lib/erp/system-settings";
import { cleanupFixtures, disconnect, makeAccount, prisma, systemUserId } from "./helpers";

/**
 * Production, Phase 1 (P150, production_project.md §8): the Workstation
 * master, the Elemen Biaya Produksi and their guards, and the Produksi
 * settings.
 */

let actor = 0;
const started = new Date();
const f = {} as Record<string, number>;
let savedCategory: { inventory_account_id: number | null; cogs_account_id: number | null; expense_account_id: number | null } | null = null;

before(async () => {
  actor = await systemUserId();
  f.goodsCat = (await prisma.sysItemCategory.findUniqueOrThrow({ where: { category_label: "BRG-JADI" } })).id;
  const row = await prisma.accItemCategoryAccount.findUnique({ where: { category_id: f.goodsCat } });
  savedCategory = row ? { inventory_account_id: row.inventory_account_id, cogs_account_id: row.cogs_account_id, expense_account_id: row.expense_account_id } : null;

  f.cost = await makeAccount({ subcategoryLabel: "5.1.1", controlAccount: true });
  f.costPlain = await makeAccount({ subcategoryLabel: "5.1.1" });
  f.asset = await makeAccount({ subcategoryLabel: "1.1.5", controlAccount: true });
  f.posted = await makeAccount({ subcategoryLabel: "5.1.1", controlAccount: true });
  f.other = await makeAccount({ subcategoryLabel: "2.1.3" });
});

after(async () => {
  if (savedCategory) await prisma.accItemCategoryAccount.update({ where: { category_id: f.goodsCat }, data: savedCategory });
  await prisma.auditLog.deleteMany({ where: { entity_key: "acc_item_category_account", at: { gte: started } } });
  await cleanupFixtures();
  await disconnect();
});

describe("Workstation is a master the user creates (G9, M7)", () => {
  test("a registry entity under Master with its own permissions", () => {
    const e = ENTITIES.find((x) => x.key === "ref_workstation");
    assert.ok(e, "registered");
    assert.equal(e!.module, "master");
    assert.deepEqual(
      e!.fields.map((x) => x.name),
      ["workstation_label", "workstation_name", "status", "note"]
    );
    const p = entityPermissions("ref_workstation");
    for (const code of [p.view, p.create, p.edit, p.activate, p.deactivate]) {
      assert.ok(PERMISSIONS.some((x) => x.code === code), `${code} declared`);
    }
  });

  test("it is on the menu under Master › Entitas", () => {
    const master = MODULES.find((m) => m.key === "master")!;
    const found = (master.groups ?? []).flatMap((g) => g.entities).find((x) => x.key === "ref_workstation");
    assert.equal(found?.permission, "WORKSTATION_VIEW");
  });
});

describe("an Elemen Biaya Produksi is a Control Account carrying only production cost (M39, M40)", () => {
  test("a postable Biaya Control Account nothing has posted to may become one", async () => {
    assert.equal(await costElementAccountProblem(f.cost), null);
  });

  test("an account outside Biaya is refused", async () => {
    assert.match((await costElementAccountProblem(f.asset)) ?? "", /account Biaya/);
  });

  test("an account not marked Control Account is refused", async () => {
    assert.match((await costElementAccountProblem(f.costPlain)) ?? "", /Control Account/);
  });

  test("an account already posted to is refused", async () => {
    const idr = await prisma.refCurrency.findFirstOrThrow({ where: { currency_label: "IDR" } });
    const line = (accountId: number, debit: number, credit: number) => ({ accountId, currencyId: idr.id, rate: 1, debit, credit, description: "Fixture" });
    await postJournal(prisma, { description: "Fixture journal", actorId: actor, lines: [line(f.posted, 1000, 0), line(f.other, 0, 1000)] });
    assert.match((await costElementAccountProblem(f.posted)) ?? "", /sudah pernah diposting/);
  });

  test("the account picker offers only postable Biaya Control Accounts", async () => {
    const e = ENTITIES.find((x) => x.key === "acc_production_cost_element")!;
    const ids = new Set((await refOptions(e)).account_id.map((o) => o.id));
    assert.ok(ids.has(f.cost));
    assert.ok(!ids.has(f.costPlain), "not a Control Account");
    assert.ok(!ids.has(f.asset), "not a Biaya account");
  });

  test("once an element, Account Mapping and Kategori Item stock accounts refuse it; a Beban may name it", async () => {
    await prisma.accProductionCostElement.create({
      data: { element_code: `test.${Date.now()}`, account_id: f.cost, element_group: "DirectLabor", created_by: actor },
    });
    assert.equal(await isCostElementAccount(f.cost), true);
    assert.equal(await checkSystemDefaultValue("wip_account", f.cost), COST_ELEMENT_REFUSAL);

    const asCogs = await saveItemCategoryAccounts(
      [{ categoryId: f.goodsCat, inventory: savedCategory?.inventory_account_id ?? null, cogs: f.cost, expense: savedCategory?.expense_account_id ?? null }],
      actor
    );
    assert.equal(asCogs.ok, false);
    if (!asCogs.ok) assert.equal(asCogs.errors[`${f.goodsCat}.cogs`], COST_ELEMENT_REFUSAL);

    const asExpense = await saveItemCategoryAccounts(
      [{ categoryId: f.goodsCat, inventory: savedCategory?.inventory_account_id ?? null, cogs: savedCategory?.cogs_account_id ?? null, expense: f.cost }],
      actor
    );
    assert.equal(asExpense.ok, true, "the Receipt Note writes the cost ledger for a Beban");
  });

  test("the elements sit on Account Mapping's permissions, under Accounting › Pengaturan", () => {
    const p = entityPermissions("acc_production_cost_element");
    assert.equal(p.view, "ACCOUNT_MAPPING_VIEW");
    assert.equal(p.create, "ACCOUNT_MAPPING_EDIT");
    const accounting = MODULES.find((m) => m.key === "accounting")!;
    const found = (accounting.groups ?? []).flatMap((g) => g.entities).find((x) => x.key === "acc_production_cost_element");
    assert.equal(found?.permission, "MENU_ACCOUNT_MAPPING_ACCESS");
  });
});

describe("the Produksi settings (§8)", () => {
  test("WIP and Beban Pemusnahan are Account Mapping; Satuan Pembebanan Biaya is a System Default", () => {
    assert.equal(settingPageOf("wip_account"), "account");
    assert.equal(settingPageOf("production_scrap_account"), "account");
    assert.equal(settingPageOf("production_cost_uom"), "default");
    const uom = systemDefaultDef("production_cost_uom");
    assert.equal(uom.type === "ref" && uom.ref, "ref_uom");
  });

  test("Satuan Pembebanan Biaya offers the active units and refuses an unknown one", async () => {
    const options = await settingOptions(await systemDefaults());
    const kg = await prisma.refUom.findFirst({ where: { uom_label: "KG" } });
    if (kg) assert.ok(options.production_cost_uom.some((o) => o.id === kg.id));
    assert.equal(await checkSystemDefaultValue("production_cost_uom", 2_000_000_000), "Satuan tidak ditemukan.");
  });
});
