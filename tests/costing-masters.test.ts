import test, { after, before, describe } from "node:test";
import assert from "node:assert/strict";

import { ENTITIES } from "../src/lib/erp/entities";
import { entityPermissions } from "../src/lib/erp/entity-access";
import { MODULES } from "../src/lib/erp/nav";
import { PERMISSIONS } from "../src/lib/erp/permissions";
import { ensureFiscalPeriods } from "../src/lib/erp/fiscal";
import {
  costCenterCategoryProblem,
  costCenterDeactivationRefusal,
  overheadCostCenterProblem,
  workstationCostCenterProblem,
} from "../src/lib/erp/cost-center";
import {
  checkStandardCost,
  standardCostFor,
  standardCostItemAccountProblem,
  standardCostItemDeactivationRefusal,
  writeStandardCostLines,
} from "../src/lib/erp/standard-cost";
import { LINES_KEY, standardCostLineErrors } from "../src/lib/erp/standard-cost-shape";
import { isSystemDefaultKey, settingPageOf, systemDefaultDef } from "../src/lib/erp/system-defaults";
import { FIXTURE_PREFIX, cleanupFixtures, disconnect, makeAccount, prisma, systemUserId } from "./helpers";

/**
 * The costing masters (P160, production Phase 5a reworked): Cost Center as an
 * entity with a category, the overhead as a System Default, Standard Cost
 * Items each crediting their own account, a Standard Cost per workstation, and
 * Jenis Biaya naming the item it is absorbed under. Nothing here posts; the
 * execution and the close read it.
 */

let actor = 0;
const tag = `${FIXTURE_PREFIX}${Date.now() % 100000}`;
const f = {} as Record<string, number>;
const YEAR = 2091;
const OVERHEAD = "production_overhead_cost_center";
let overheadBefore: string | null | undefined;

const navEntity = (moduleKey: string, key: string) =>
  (MODULES.find((m) => m.key === moduleKey)?.groups ?? []).flatMap((g) => g.entities).find((x) => x.key === key);

async function center(label: string, category: "Production" | "NonProduction", status: "Active" | "Inactive" = "Active") {
  return (
    await prisma.accCostCenter.create({
      data: { cost_center_code: `test.${tag}.${label}`, cost_center_label: `${tag}-${label}`, cost_center_name: label, cost_center_category: category, status, created_by: actor },
    })
  ).id;
}

async function item(label: string, accountId: number, status: "Active" | "Inactive" = "Active") {
  return (
    await prisma.accStandardCostItem.create({
      data: { item_code: `test.${tag}.${label}`, item_label: `${tag}-${label}`, item_name: label, account_id: accountId, status, created_by: actor },
    })
  ).id;
}

const lines = (list: [number, string][]) => JSON.stringify(list.map(([itemId, rate], i) => ({ key: `k${i}`, itemId, rate })));

async function setOverhead(id: number | null) {
  await prisma.sysSetting.upsert({
    where: { setting_key: OVERHEAD },
    update: { setting_value: id == null ? null : String(id) },
    create: { setting_key: OVERHEAD, setting_value: id == null ? null : String(id) },
  });
}

before(async () => {
  actor = await systemUserId();
  overheadBefore = (await prisma.sysSetting.findUnique({ where: { setting_key: OVERHEAD } }))?.setting_value;
  f.mix = await center("MIX", "Production");
  f.fill = await center("FILL", "Production");
  f.off = await center("OFF", "Production", "Inactive");
  f.foh = await center("FOH", "Production");
  f.adm = await center("ADM", "NonProduction");
  f.ws = (
    await prisma.refWorkstation.create({
      data: { workstation_code: `test.${tag}.WS`, workstation_label: `${tag}-WS`, workstation_name: "Mixing", cost_center_id: f.mix, created_by: actor },
    })
  ).id;
  f.costAccount = await makeAccount({ subcategoryLabel: "5.1.1", requireCostCenter: true, normalBalance: "Kredit" });
  f.plainAccount = await makeAccount({ subcategoryLabel: "5.1.1" });
  f.tkl = await item("TKL", f.costAccount);
  f.bop = await item("BOP", f.costAccount);
  f.oldItem = await item("OLD", f.costAccount, "Inactive");
  // A year of its own, far ahead, so a period can be closed without touching real ones.
  f.year = (
    await prisma.accFiscalYear.create({
      data: {
        year_code: `fyr.${tag}`,
        year_label: String(YEAR),
        year_name: `Tahun Buku ${YEAR}`,
        start_date: new Date(Date.UTC(YEAR, 0, 1)),
        end_date: new Date(Date.UTC(YEAR, 11, 31)),
        status: "Open",
        created_by: actor,
      },
    })
  ).id;
  await ensureFiscalPeriods(prisma, { fiscalYearId: f.year, year: YEAR, actorId: actor });
  const periods = await prisma.accFiscalPeriod.findMany({ where: { fiscal_year_id: f.year }, orderBy: { sequence_no: "asc" } });
  f.jan = periods[0].id;
  f.apr = periods[3].id;
  f.dec = periods[11].id;
  await prisma.accFiscalPeriod.update({ where: { id: f.dec }, data: { status: "Closed" } });
  await setOverhead(f.foh);
});

after(async () => {
  if (overheadBefore === undefined) await prisma.sysSetting.deleteMany({ where: { setting_key: OVERHEAD } });
  else await prisma.sysSetting.update({ where: { setting_key: OVERHEAD }, data: { setting_value: overheadBefore } });
  const costs = await prisma.accStandardCost.findMany({ where: { workstation_id: f.ws }, select: { id: true } });
  await prisma.accStandardCostLine.deleteMany({ where: { standard_cost_id: { in: costs.map((c) => c.id) } } });
  await prisma.accStandardCost.deleteMany({ where: { workstation_id: f.ws } });
  await prisma.accStandardCostItem.deleteMany({ where: { item_code: { startsWith: `test.${tag}.` } } });
  await prisma.refWorkstation.deleteMany({ where: { id: f.ws } });
  await prisma.accCostCenter.deleteMany({ where: { cost_center_code: { startsWith: `test.${tag}.` } } });
  await prisma.accFiscalPeriod.deleteMany({ where: { fiscal_year_id: f.year } });
  await prisma.accFiscalYear.deleteMany({ where: { id: f.year } });
  await cleanupFixtures();
  await disconnect();
});

describe("the registry carries the costing masters (P160)", () => {
  test("a Cost Center has a category only — Produksi or Non-Produksi — and no spread", () => {
    const e = ENTITIES.find((x) => x.key === "acc_cost_center")!;
    assert.deepEqual(e.fields.find((x) => x.name === "cost_center_category")?.options, ["Production", "NonProduction"]);
    assert.equal(e.tabs, undefined);
    assert.ok(!e.fields.some((x) => x.name === "spread_method"));
  });

  test("a Workstation names its Produksi Cost Center", () => {
    const field = ENTITIES.find((x) => x.key === "ref_workstation")!.fields.find((x) => x.name === "cost_center_id")!;
    assert.equal(field.required, true);
    assert.equal(field.refFilter, "productionCostCenter");
  });

  test("Standard Cost Item is a master naming its own account, fixed once chosen; Jenis Biaya names its item", () => {
    const e = ENTITIES.find((x) => x.key === "acc_standard_cost_item")!;
    assert.equal(e.module, "master");
    assert.deepEqual(e.fields.map((x) => x.name), ["item_label", "item_name", "account_id", "status", "note"]);
    assert.equal(e.fields.find((x) => x.name === "account_id")?.locked, true);
    assert.equal(navEntity("master", "acc_standard_cost_item")?.permission, "STANDARD_COST_ITEM_VIEW");
    const link = ENTITIES.find((x) => x.key === "acc_cost_type")!.fields.find((x) => x.name === "standard_cost_item_id");
    assert.equal(link?.ref, "acc_standard_cost_item");
    assert.equal(link?.required, true);
  });

  test("Standard Cost sits in Accounting › Pengaturan, per workstation and period, with an Item tab", () => {
    const e = ENTITIES.find((x) => x.key === "acc_standard_cost")!;
    assert.equal(e.module, "accounting");
    assert.deepEqual(e.fields.map((x) => x.name), ["workstation_id", "effective_period_id", "note"]);
    assert.deepEqual(e.tabs?.map((t) => t.key), ["lines"]);
    const p = entityPermissions("acc_standard_cost");
    for (const code of [p.view, p.create, p.edit]) assert.ok(PERMISSIONS.some((x) => x.code === code), `${code} declared`);
    assert.equal(p.activate, undefined, "a Standard Cost has no status");
    assert.equal(navEntity("accounting", "acc_standard_cost")?.permission, "STANDARD_COST_VIEW");
    assert.ok(!PERMISSIONS.some((x) => x.code.startsWith("STANDARD_RATE_")));
  });

  test("the overhead is a System Default naming a Cost Center; the global absorbed account is gone", () => {
    assert.equal(settingPageOf(OVERHEAD), "default");
    const def = systemDefaultDef(OVERHEAD);
    assert.equal(def.type === "ref" && def.ref, "acc_cost_center");
    assert.equal(isSystemDefaultKey("production_absorbed_account"), false);
  });
});

describe("Cost Center roles are settings, not types (M110)", () => {
  test("a Workstation pools only into an active Produksi Cost Center that is not the overhead", async () => {
    assert.equal(await workstationCostCenterProblem(f.fill), null);
    assert.match((await workstationCostCenterProblem(f.adm))!, /berkategori Produksi/);
    assert.match((await workstationCostCenterProblem(f.off))!, /nonaktif/);
    assert.match((await workstationCostCenterProblem(f.foh))!, /Cost Center Overhead/);
  });

  test("the overhead is an active Produksi Cost Center no workstation pools into", async () => {
    assert.equal(await overheadCostCenterProblem(f.foh), null);
    assert.match((await overheadCostCenterProblem(f.adm))!, /berkategori Produksi/);
    assert.match((await overheadCostCenterProblem(f.mix))!, /Workstation/);
  });

  test("a used Cost Center keeps its category and stays active", async () => {
    assert.match((await costCenterCategoryProblem({ cost_center_category: "NonProduction" }, f.mix))!, /Workstation/);
    assert.match((await costCenterCategoryProblem({ cost_center_category: "NonProduction" }, f.foh))!, /Overhead/);
    assert.equal(await costCenterCategoryProblem({ cost_center_category: "Production" }, f.adm), null, "an unused one may change");
    assert.match((await costCenterDeactivationRefusal(f.mix))!, /Workstation/);
    assert.match((await costCenterDeactivationRefusal(f.foh))!, /Overhead/);
    assert.equal(await costCenterDeactivationRefusal(f.fill), null);
  });
});

describe("Standard Cost Items and Standard Cost (M107, M109)", () => {
  test("an item credits a postable account that requires a Cost Center", async () => {
    assert.equal(await standardCostItemAccountProblem(f.costAccount), null);
    assert.match((await standardCostItemAccountProblem(f.plainAccount))!, /Require Cost Center/);
  });

  test("a line names an item once at a rate of 0 or more", () => {
    assert.ok(standardCostLineErrors({ itemId: null, rate: "1" }, []).itemId);
    assert.ok(standardCostLineErrors({ itemId: 5, rate: "1" }, [5]).itemId);
    assert.ok(standardCostLineErrors({ itemId: 5, rate: "-1" }, []).rate);
    assert.ok(standardCostLineErrors({ itemId: 5, rate: "" }, []).rate);
    assert.deepEqual(standardCostLineErrors({ itemId: 5, rate: "0" }, []), {});
  });

  test("an entry needs an item, active items only, and a period that is not closed", async () => {
    const base = { workstation_id: f.ws, effective_period_id: f.jan };
    assert.match((await checkStandardCost({ ...base, [LINES_KEY]: "[]" }, null)).errors[LINES_KEY], /minimal satu/);
    assert.match((await checkStandardCost({ ...base, [LINES_KEY]: lines([[f.oldItem, "100"]]) }, null)).errors[LINES_KEY], /nonaktif/);
    assert.match((await checkStandardCost({ ...base, [LINES_KEY]: lines([[f.tkl, "1"], [f.tkl, "2"]]) }, null)).errors[LINES_KEY], /sudah ada/);
    assert.match((await checkStandardCost({ ...base, effective_period_id: f.dec, [LINES_KEY]: lines([[f.tkl, "1"]]) }, null)).errors.effective_period_id, /ditutup/);
    const ok = await checkStandardCost({ ...base, [LINES_KEY]: lines([[f.tkl, "20000"], [f.bop, "15000.5"]]) }, null);
    assert.deepEqual(ok.errors, {});
    assert.deepEqual(ok.clean.lines, [{ itemId: f.tkl, rate: "20000" }, { itemId: f.bop, rate: "15000.5" }]);
  });

  test("the entry in force is the latest on or before the date's period; a 0 rate is no standard; one entry per workstation and period", async () => {
    const make = async (periodId: number, list: { itemId: number; rate: string }[]) => {
      const row = await prisma.accStandardCost.create({
        data: { standard_cost_code: `test.${tag}.${periodId}`, workstation_id: f.ws, effective_period_id: periodId, created_by: actor },
      });
      await writeStandardCostLines(prisma, row.id, { lines: list }, actor);
      return row.id;
    };
    const jan = await make(f.jan, [{ itemId: f.tkl, rate: "20000" }, { itemId: f.bop, rate: "15000" }]);
    await make(f.apr, [{ itemId: f.tkl, rate: "22500.5" }, { itemId: f.bop, rate: "0" }]);

    const march = await standardCostFor(f.ws, `${YEAR}-03-31`);
    assert.equal(march.standardCostId, jan);
    assert.deepEqual(march.rates.map((r) => [r.itemId, r.rate, r.accountId]), [[f.tkl, 20000, f.costAccount], [f.bop, 15000, f.costAccount]]);
    const nov = await standardCostFor(f.ws, `${YEAR}-11-15`);
    assert.equal(nov.fromPeriod, `April ${YEAR}`);
    assert.deepEqual(nov.rates.map((r) => [r.itemId, r.rate]), [[f.tkl, 22500.5]], "BOP at 0 has no standard");
    assert.deepEqual(await standardCostFor(f.ws, `${YEAR - 1}-12-31`), { standardCostId: null, fromPeriod: null, rates: [] });

    const again = await checkStandardCost({ workstation_id: f.ws, effective_period_id: f.jan, [LINES_KEY]: lines([[f.tkl, "1"]]) }, null);
    assert.match(again.errors.effective_period_id, /sudah memiliki/);
    // Rewriting replaces the lines exactly.
    await writeStandardCostLines(prisma, jan, { lines: [{ itemId: f.bop, rate: "16000" }] }, actor);
    assert.deepEqual((await standardCostFor(f.ws, `${YEAR}-01-15`)).rates.map((r) => [r.itemId, r.rate]), [[f.bop, 16000]]);
  });

  test("an item with a rate on a Standard Cost is not deactivated", async () => {
    assert.match((await standardCostItemDeactivationRefusal(f.tkl))!, /masih bertarif/);
    assert.equal(await standardCostItemDeactivationRefusal(f.oldItem), null);
  });
});
