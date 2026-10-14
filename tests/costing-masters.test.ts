import test, { after, before, describe } from "node:test";
import assert from "node:assert/strict";

import { ENTITIES, tabApplies } from "../src/lib/erp/entities";
import { entityPermissions } from "../src/lib/erp/entity-access";
import { MODULES } from "../src/lib/erp/nav";
import { PERMISSIONS } from "../src/lib/erp/permissions";
import { ensureFiscalPeriods } from "../src/lib/erp/fiscal";
import {
  checkCostCenter,
  checkStandardRate,
  costCenterDeactivationRefusal,
  standardRateFor,
  workstationCostCenterProblem,
  writeCostCenterSpreads,
} from "../src/lib/erp/cost-center";
import { SPREADS_KEY, spreadRowErrors, spreadTotalProblem } from "../src/lib/erp/cost-center-shape";
import { checkSystemDefaultValue } from "../src/lib/erp/system-settings";
import { settingPageOf } from "../src/lib/erp/system-defaults";
import { FIXTURE_PREFIX, cleanupFixtures, disconnect, makeAccount, prisma, systemUserId } from "./helpers";

/**
 * The costing masters (P159, production Phase 5a): Cost Center types and an
 * Overhead's spread, the Workstation's Production Cost Center, Tarif Standar
 * per workstation, and Account Mapping's Biaya Produksi Dibebankan. Nothing
 * here posts; the execution and the close read it.
 */

let actor = 0;
const tag = `${FIXTURE_PREFIX}${Date.now() % 100000}`;
const f = {} as Record<string, number>;
const YEAR = 2091;

const navEntity = (moduleKey: string, key: string) =>
  (MODULES.find((m) => m.key === moduleKey)?.groups ?? []).flatMap((g) => g.entities).find((x) => x.key === key);

async function center(label: string, type: "Production" | "Overhead" | "Administrative", status: "Active" | "Inactive" = "Active") {
  return (
    await prisma.accCostCenter.create({
      data: {
        cost_center_code: `test.${tag}.${label}`,
        cost_center_label: `${tag}-${label}`,
        cost_center_name: label,
        cost_center_type: type,
        spread_method: type === "Overhead" ? "Even" : null,
        status,
        created_by: actor,
      },
    })
  ).id;
}

before(async () => {
  actor = await systemUserId();
  f.mix = await center("MIX", "Production");
  f.fill = await center("FILL", "Production");
  f.off = await center("OFF", "Production", "Inactive");
  f.foh = await center("FOH", "Overhead");
  f.adm = await center("ADM", "Administrative");
  f.free = await center("FREE", "Production");
  f.ws = (
    await prisma.refWorkstation.create({
      data: { workstation_code: `test.${tag}.WS`, workstation_label: `${tag}-WS`, workstation_name: "Mixing", cost_center_id: f.mix, created_by: actor },
    })
  ).id;
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
  f.costAccount = await makeAccount({ subcategoryLabel: "5.1.1", requireCostCenter: true });
  f.plainAccount = await makeAccount({ subcategoryLabel: "5.1.1" });
});

after(async () => {
  await prisma.refWorkstationRate.deleteMany({ where: { workstation_id: f.ws } });
  await prisma.refWorkstation.deleteMany({ where: { id: f.ws } });
  await prisma.accCostCenterSpread.deleteMany({ where: { overhead_cost_center_id: f.foh } });
  await prisma.accCostCenter.deleteMany({ where: { cost_center_code: { startsWith: `test.${tag}.` } } });
  await prisma.accFiscalPeriod.deleteMany({ where: { fiscal_year_id: f.year } });
  await prisma.accFiscalYear.deleteMany({ where: { id: f.year } });
  await cleanupFixtures();
  await disconnect();
});

describe("the registry carries the costing masters (P159)", () => {
  test("Cost Center has three types, a spread method shown for Overhead, and an Alokasi tab shown for Persentase", () => {
    const e = ENTITIES.find((x) => x.key === "acc_cost_center")!;
    assert.deepEqual(e.fields.find((x) => x.name === "cost_center_type")?.options, ["Production", "Overhead", "Administrative"]);
    const method = e.fields.find((x) => x.name === "spread_method")!;
    assert.deepEqual(method.options, ["Even", "Percent"]);
    assert.equal(method.visibleWhen, "costCenterIsOverhead");
    const tab = e.tabs!.find((t) => t.key === "spreads")!;
    assert.equal(tabApplies(tab, { cost_center_type: "Overhead", spread_method: "Percent" }), true);
    assert.equal(tabApplies(tab, { cost_center_type: "Overhead", spread_method: "Even" }), false);
    assert.equal(tabApplies(tab, { cost_center_type: "Production", spread_method: "Percent" }), false);
  });

  test("a Workstation names its Production Cost Center", () => {
    const e = ENTITIES.find((x) => x.key === "ref_workstation")!;
    const field = e.fields.find((x) => x.name === "cost_center_id")!;
    assert.equal(field.required, true);
    assert.equal(field.refFilter, "productionCostCenter");
  });

  test("Tarif Standar is its own master, per workstation from a period, with its own permissions and menu", () => {
    const e = ENTITIES.find((x) => x.key === "ref_workstation_rate")!;
    assert.equal(e.module, "master");
    assert.deepEqual(e.fields.map((x) => x.name), ["workstation_id", "effective_period_id", "rate", "note"]);
    for (const name of ["workstation_id", "effective_period_id"]) assert.equal(e.fields.find((x) => x.name === name)?.locked, true);
    const p = entityPermissions("ref_workstation_rate");
    for (const code of [p.view, p.create, p.edit]) assert.ok(PERMISSIONS.some((x) => x.code === code), `${code} declared`);
    assert.equal(p.activate, undefined, "a rate row has no status");
    assert.equal(navEntity("master", "ref_workstation_rate")?.permission, "STANDARD_RATE_VIEW");
  });
});

describe("an Overhead's spread (P159, M93)", () => {
  test("the dialog's rules: a Production Cost Center once, a percent above 0 and at most 100", () => {
    assert.ok(spreadRowErrors({ costCenterId: null, percent: "10" }, []).costCenterId);
    assert.ok(spreadRowErrors({ costCenterId: 5, percent: "10" }, [5]).costCenterId);
    assert.ok(spreadRowErrors({ costCenterId: 5, percent: "0" }, []).percent);
    assert.deepEqual(spreadRowErrors({ costCenterId: 5, percent: "12.5" }, []), {});
  });

  test("the rows add up to exactly 100, to four decimals", () => {
    assert.match(spreadTotalProblem([{ percent: "50" }, { percent: "30" }])!, /tepat 100%/);
    assert.match(spreadTotalProblem([{ percent: "33.3333" }, { percent: "33.3333" }, { percent: "33.3333" }])!, /99,9999/);
    assert.equal(spreadTotalProblem([{ percent: "33.3334" }, { percent: "33.3333" }, { percent: "33.3333" }]), null);
    assert.ok(spreadTotalProblem([]));
  });

  test("an Overhead needs a spread method", async () => {
    const r = await checkCostCenter({ cost_center_type: "Overhead", spread_method: "" }, f.foh);
    assert.ok(r.errors.spread_method);
  });

  test("Persentase rows go only to active Production Cost Centers", async () => {
    const rows = (list: [number, string][]) => JSON.stringify(list.map(([id, p], i) => ({ key: `k${i}`, costCenterId: id, percent: p })));
    const toAdmin = await checkCostCenter({ cost_center_type: "Overhead", spread_method: "Percent", [SPREADS_KEY]: rows([[f.mix, "50"], [f.adm, "50"]]) }, f.foh);
    assert.match(toAdmin.errors[SPREADS_KEY], /bukan Cost Center Produksi/);
    const toInactive = await checkCostCenter({ cost_center_type: "Overhead", spread_method: "Percent", [SPREADS_KEY]: rows([[f.mix, "50"], [f.off, "50"]]) }, f.foh);
    assert.match(toInactive.errors[SPREADS_KEY], /nonaktif/);
    const short = await checkCostCenter({ cost_center_type: "Overhead", spread_method: "Percent", [SPREADS_KEY]: rows([[f.mix, "50"], [f.fill, "40"]]) }, f.foh);
    assert.match(short.errors[SPREADS_KEY], /tepat 100%/);
    const ok = await checkCostCenter({ cost_center_type: "Overhead", spread_method: "Percent", [SPREADS_KEY]: rows([[f.mix, "60"], [f.fill, "40"]]) }, f.foh);
    assert.deepEqual(ok.errors, {});
    assert.deepEqual(ok.clean.spreads.map((s) => [s.productionCostCenterId, Number(s.percent)]), [[f.mix, 60], [f.fill, 40]]);
  });

  test("the spread is written with the Overhead, replaced on the next save, and gone when it turns Rata", async () => {
    await writeCostCenterSpreads(prisma, f.foh, { spreads: [{ productionCostCenterId: f.mix, percent: "60" }, { productionCostCenterId: f.fill, percent: "40" }] }, actor);
    await writeCostCenterSpreads(prisma, f.foh, { spreads: [{ productionCostCenterId: f.mix, percent: "70" }, { productionCostCenterId: f.free, percent: "30" }] }, actor);
    const rows = await prisma.accCostCenterSpread.findMany({ where: { overhead_cost_center_id: f.foh }, orderBy: { production_cost_center_id: "asc" } });
    assert.deepEqual(rows.map((r) => [r.production_cost_center_id, r.percent.toNumber()]).sort((a, b) => a[0] - b[0]), [[f.mix, 70], [f.free, 30]].sort((a, b) => a[0] - b[0]));
    const even = await checkCostCenter({ cost_center_type: "Overhead", spread_method: "Even" }, f.foh);
    assert.deepEqual(even.clean.spreads, [], "Rata keeps no rows");
  });

  test("a Production Cost Center an active Overhead spreads into is not deactivated", async () => {
    await prisma.accCostCenter.update({ where: { id: f.foh }, data: { spread_method: "Percent" } });
    assert.match((await costCenterDeactivationRefusal(f.free))!, /alokasi Overhead/);
    await prisma.accCostCenter.update({ where: { id: f.foh }, data: { spread_method: "Even" } });
    await writeCostCenterSpreads(prisma, f.foh, { spreads: [] }, actor);
    assert.equal(await costCenterDeactivationRefusal(f.free), null);
  });
});

describe("a Workstation pools into a Production Cost Center (M93)", () => {
  test("only an active Production one", async () => {
    assert.equal(await workstationCostCenterProblem(f.fill), null);
    assert.match((await workstationCostCenterProblem(f.foh))!, /bertipe Produksi/);
    assert.match((await workstationCostCenterProblem(f.adm))!, /bertipe Produksi/);
    assert.match((await workstationCostCenterProblem(f.off))!, /nonaktif/);
  });

  test("its Cost Center keeps its type and stays active while the workstation pools into it", async () => {
    const changed = await checkCostCenter({ cost_center_type: "Administrative" }, f.mix);
    assert.match(changed.errors.cost_center_type, /Workstation/);
    assert.match((await costCenterDeactivationRefusal(f.mix))!, /Workstation/);
    const unused = await checkCostCenter({ cost_center_type: "Administrative" }, f.adm);
    assert.equal(unused.errors.cost_center_type, undefined, "an unused one may change type");
  });
});

describe("Tarif Standar per workstation (M94 amended)", () => {
  test("a rate is 0 or more; one row per workstation and period; a closed period takes none", async () => {
    assert.match((await checkStandardRate({ workstation_id: f.ws, effective_period_id: f.jan, rate: "-1" }, null)).rate, /negatif/);
    assert.match((await checkStandardRate({ workstation_id: f.ws, effective_period_id: f.dec, rate: "100" }, null)).effective_period_id, /ditutup/);
    assert.deepEqual(await checkStandardRate({ workstation_id: f.ws, effective_period_id: f.jan, rate: "0" }, null), {});
    const jan = await prisma.refWorkstationRate.create({
      data: { rate_code: `test.${tag}.1`, workstation_id: f.ws, effective_period_id: f.jan, rate: 25_000, created_by: actor },
    });
    assert.match((await checkStandardRate({ workstation_id: f.ws, effective_period_id: f.jan, rate: "30000" }, null)).effective_period_id, /sudah memiliki/);
    assert.deepEqual(await checkStandardRate({ rate: "30000" }, jan.id), {}, "its rate may change while the period is open");
  });

  test("the rate of a date is the latest row starting on or before its period; none reads as 0", async () => {
    await prisma.refWorkstationRate.create({
      data: { rate_code: `test.${tag}.2`, workstation_id: f.ws, effective_period_id: f.apr, rate: 27_500.5, created_by: actor },
    });
    assert.equal((await standardRateFor(f.ws, `${YEAR}-03-31`)).rate, 25_000);
    const april = await standardRateFor(f.ws, `${YEAR}-04-01`);
    assert.equal(april.rate, 27_500.5);
    assert.equal(april.fromPeriod, `April ${YEAR}`);
    assert.equal((await standardRateFor(f.ws, `${YEAR}-11-15`)).rate, 27_500.5, "until the next row");
    assert.deepEqual(await standardRateFor(f.ws, `${YEAR - 1}-12-31`), { rate: 0, rateId: null, fromPeriod: null });
  });
});

describe("Account Mapping's Biaya Produksi Dibebankan (M92, M96)", () => {
  test("an Account Mapping key that requires a Cost Center account", async () => {
    assert.equal(settingPageOf("production_absorbed_account"), "account");
    assert.match((await checkSystemDefaultValue("production_absorbed_account", f.plainAccount))!, /Require Cost Center/);
    assert.equal(await checkSystemDefaultValue("production_absorbed_account", f.costAccount), null);
  });
});
