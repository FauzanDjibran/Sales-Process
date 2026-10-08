import test, { after, before, describe } from "node:test";
import assert from "node:assert/strict";

import { ENTITIES } from "../src/lib/erp/entities";
import { entityPermissions } from "../src/lib/erp/entity-access";
import { CATEGORY_ACCOUNT_KINDS } from "../src/lib/erp/item-account";
import { MODULES } from "../src/lib/erp/nav";
import { PERMISSIONS } from "../src/lib/erp/permissions";
import { costTypesUsingAccount } from "../src/lib/erp/production-cost";
import { isSystemDefaultKey, settingPageOf } from "../src/lib/erp/system-defaults";
import { cleanupFixtures, disconnect, makeAccount, prisma, systemUserId } from "./helpers";

/**
 * Production masters (P150 Phase 1, reworked by P154): the Workstation master,
 * Jenis Biaya naming its two accounts, Cost Center, Account Kategori Item as a
 * mapping list with WIP, and the Produksi account card.
 */

let actor = 0;
const f = {} as Record<string, number>;
const navEntity = (moduleKey: string, key: string) =>
  (MODULES.find((m) => m.key === moduleKey)?.groups ?? []).flatMap((g) => g.entities).find((x) => x.key === key);

before(async () => {
  actor = await systemUserId();
  f.cost = await makeAccount({ subcategoryLabel: "5.1.1", requireCostCenter: true });
  f.payable = await makeAccount({ subcategoryLabel: "2.1.3", normalBalance: "Kredit" });
});

after(async () => {
  await cleanupFixtures();
  await disconnect();
});

describe("Workstation is a master the user creates (G9, M7)", () => {
  test("a registry entity under Master › Entitas with its own permissions", () => {
    const e = ENTITIES.find((x) => x.key === "ref_workstation");
    assert.equal(e?.module, "master");
    assert.deepEqual(e!.fields.map((x) => x.name), ["workstation_label", "workstation_name", "status", "note"]);
    const p = entityPermissions("ref_workstation");
    for (const code of [p.view, p.create, p.edit, p.activate, p.deactivate]) {
      assert.ok(PERMISSIONS.some((x) => x.code === code), `${code} declared`);
    }
    assert.equal(navEntity("master", "ref_workstation")?.permission, "WORKSTATION_VIEW");
  });
});

describe("Jenis Biaya names a cost, its expense account and its own credit account (P154, M84)", () => {
  test("a master under Master › Referensi: label, name, both accounts and the paid flag", () => {
    const e = ENTITIES.find((x) => x.key === "acc_cost_type");
    assert.equal(e?.module, "master");
    assert.deepEqual(e!.fields.map((x) => x.name), ["cost_type_label", "cost_type_name", "expense_account_id", "contra_account_id", "is_payable", "status", "note"]);
    for (const key of ["expense_account_id", "contra_account_id"]) {
      const account: { required?: boolean; locked?: boolean } | undefined = e!.fields.find((x) => x.name === key);
      assert.equal(account?.required, true);
      assert.equal(account?.locked, true, "fixed once chosen");
    }
    assert.equal(entityPermissions("acc_cost_type").view, "COST_TYPE_VIEW");
    assert.equal(navEntity("master", "acc_cost_type")?.permission, "COST_TYPE_VIEW");
  });

  test("two Jenis Biaya may share accounts, and the account names them before it is deactivated", async () => {
    for (const label of ["A", "B"]) {
      await prisma.accCostType.create({
        data: {
          cost_type_code: `test.${label}.${Date.now()}`,
          cost_type_label: `TEST-${label}-${Date.now()}`,
          cost_type_name: `Uji ${label}`,
          expense_account_id: f.cost,
          contra_account_id: f.payable,
          created_by: actor,
        },
      });
    }
    assert.equal((await costTypesUsingAccount(f.cost)).asExpense.length, 2);
    assert.equal((await costTypesUsingAccount(f.payable)).asContra.length, 2);
  });
});

describe("Cost Center is a master the user creates (P154, M83)", () => {
  test("a registry entity under Master › Referensi with its own permissions; the account form asks Require Cost Center", () => {
    const e = ENTITIES.find((x) => x.key === "acc_cost_center");
    assert.equal(e?.module, "master");
    assert.deepEqual(e!.fields.map((x) => x.name), ["cost_center_label", "cost_center_name", "cost_center_type", "status", "note"]);
    const p = entityPermissions("acc_cost_center");
    for (const code of [p.view, p.create, p.edit, p.activate, p.deactivate]) {
      assert.ok(PERMISSIONS.some((x) => x.code === code), `${code} declared`);
    }
    assert.equal(navEntity("master", "acc_cost_center")?.permission, "COST_CENTER_VIEW");
    const account = ENTITIES.find((x) => x.key === "acc_account")!;
    assert.equal(account.fields.find((x) => x.name === "require_cost_center")?.type, "bool");
  });

  test("the seed's starter Cost Center is PRODUKSI", async () => {
    assert.ok(await prisma.accCostCenter.findFirst({ where: { cost_center_label: "PRODUKSI" } }));
  });
});

describe("Account Kategori Item is a mapping list (M54)", () => {
  test("one row per category and kind; WIP is a kind; a Jasa category takes Beban only", () => {
    const e = ENTITIES.find((x) => x.key === "acc_item_category_account");
    assert.equal(e?.module, "accounting");
    const kind = e!.fields.find((x) => x.name === "account_kind")!;
    assert.deepEqual(kind.options, ["Inventory", "Cogs", "Wip", "Expense"]);
    assert.equal(kind.uniqueWithin, "category_id");
    assert.deepEqual(
      CATEGORY_ACCOUNT_KINDS.filter((k) => k.itemTypes.includes("Jasa")).map((k) => k.kind),
      ["Expense"]
    );
    assert.equal(navEntity("accounting", "acc_item_category_account")?.permission, "MENU_ACCOUNT_MAPPING_ACCESS");
  });

  test("the categories' rows are one per category and kind", async () => {
    const rows = await prisma.accItemCategoryAccount.findMany({ select: { category_id: true, account_kind: true } });
    const keys = rows.map((r) => `${r.category_id}:${r.account_kind}`);
    assert.equal(new Set(keys).size, keys.length);
  });
});

describe("the Produksi settings (§8, M57)", () => {
  test("Beban Pemusnahan is Account Mapping; WIP has no fallback (M62); no Satuan Pembebanan Biaya yet", () => {
    assert.equal(isSystemDefaultKey("wip_account"), false, "an item's WIP is its category's, or the document refuses");
    assert.equal(settingPageOf("production_scrap_account"), "account");
    assert.equal(isSystemDefaultKey("production_cost_uom"), false, "the spreading basis is decided with the close");
  });
});
