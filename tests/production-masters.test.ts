import test, { after, before, describe } from "node:test";
import assert from "node:assert/strict";

import { ENTITIES } from "../src/lib/erp/entities";
import { entityPermissions } from "../src/lib/erp/entity-access";
import { CATEGORY_ACCOUNT_KINDS } from "../src/lib/erp/item-account";
import { MODULES } from "../src/lib/erp/nav";
import { PERMISSIONS } from "../src/lib/erp/permissions";
import { elementsUsingAccount } from "../src/lib/erp/production-cost";
import { isSystemDefaultKey, settingPageOf } from "../src/lib/erp/system-defaults";
import { cleanupFixtures, disconnect, makeAccount, prisma, systemUserId } from "./helpers";

/**
 * Production, Phase 1 after its review (P150, production_project.md §8,
 * M53–M57): the Workstation master, Elemen Biaya Produksi as a master naming
 * its account, Account Kategori Item as a mapping list with WIP, and the
 * Produksi account card.
 */

let actor = 0;
const f = {} as Record<string, number>;
const navEntity = (moduleKey: string, key: string) =>
  (MODULES.find((m) => m.key === moduleKey)?.groups ?? []).flatMap((g) => g.entities).find((x) => x.key === key);

before(async () => {
  actor = await systemUserId();
  f.cost = await makeAccount({ subcategoryLabel: "5.1.1" });
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

describe("Elemen Biaya Produksi names a kind of cost and its account (M53, M55, M61)", () => {
  test("a master under Master › Referensi: label, name, account — no group list", () => {
    const e = ENTITIES.find((x) => x.key === "acc_production_cost_element");
    assert.equal(e?.module, "master");
    assert.deepEqual(e!.fields.map((x) => x.name), ["element_label", "element_name", "account_id", "status", "note"]);
    const account = e!.fields.find((x) => x.name === "account_id")!;
    assert.equal(account.refFilter, "postableAccount", "any postable account; the Control Account mark is never read");
    assert.equal(account.locked, true, "fixed once chosen");
    assert.equal(account.unique, undefined, "several elements may share an account");
    assert.equal(entityPermissions("acc_production_cost_element").view, "PRODUCTION_COST_ELEMENT_VIEW");
    assert.equal(navEntity("master", "acc_production_cost_element")?.permission, "PRODUCTION_COST_ELEMENT_VIEW");
  });

  test("two elements may name one account, and the account names them both before it is deactivated", async () => {
    for (const label of ["A", "B"]) {
      await prisma.accProductionCostElement.create({
        data: { element_code: `test.${label}.${Date.now()}`, element_label: `TEST-${label}-${Date.now()}`, element_name: `Uji ${label}`, account_id: f.cost, created_by: actor },
      });
    }
    assert.equal((await elementsUsingAccount(f.cost)).length, 2);
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
  test("WIP and Beban Pemusnahan are Account Mapping; no Satuan Pembebanan Biaya yet", () => {
    assert.equal(settingPageOf("wip_account"), "account");
    assert.equal(settingPageOf("production_scrap_account"), "account");
    assert.equal(isSystemDefaultKey("production_cost_uom"), false, "the spreading basis is decided with the close");
  });
});
