import test, { after, before, describe } from "node:test";
import assert from "node:assert/strict";

import { ENTITIES } from "../src/lib/erp/entities";
import { entityPermissions } from "../src/lib/erp/entity-access";
import { MODULES } from "../src/lib/erp/nav";
import {
  bomDeactivationRefusal,
  checkBom,
  checkRouting,
  productionItemProblem,
  writeBom,
  writeRouting,
} from "../src/lib/erp/production-master";
import { BOM_LINES_KEY, ROUTING_STEPS_KEY, bomLineErrors } from "../src/lib/erp/production-master-shape";
import { FIXTURE_PREFIX, disconnect, prisma, productionCostCenterId, systemUserId } from "./helpers";

/**
 * Walet build step 1 (`walet/build-plan.md`): the Workstation's Kode Job, the
 * Item's output type and value weight, and the Bill of Materials and Routing
 * masters — a BoM a suggestion of what goes in per base quantity, a Routing
 * the stations a Partai passes to its target item.
 */

let actor = 0;
const tag = `${FIXTURE_PREFIX}${Date.now() % 100000}`;
const f = {} as Record<string, number>;
const navEntity = (moduleKey: string, key: string) =>
  (MODULES.find((m) => m.key === moduleKey)?.groups ?? []).flatMap((g) => g.entities).find((x) => x.key === key);

const lines = (list: [number, string, number | null][]) => JSON.stringify(list.map(([itemId, qty, stepNo], i) => ({ key: `k${i}`, itemId, qty, stepNo })));
const steps = (list: [number, string, number | null][]) => JSON.stringify(list.map(([workstationId, mode, bomId], i) => ({ key: `s${i}`, workstationId, mode, bomId })));

before(async () => {
  actor = await systemUserId();
  const gr = (await prisma.refUom.findFirstOrThrow({ where: { uom_label: "GR" } })).id;
  const cat = (await prisma.sysItemCategory.findUniqueOrThrow({ where: { category_label: "BRG-SETENGAH-JADI" } })).id;
  const item = async (l: string, track = true, status: "Active" | "Inactive" = "Active") =>
    (
      await prisma.mItem.create({
        data: { item_code: `test.${tag}.${l}`, item_label: `${tag}-${l}`, item_name: l, item_type: "Barang", category_id: cat, base_uom_id: gr, track_stock: track, status, output_type: "Utama", created_by: actor },
      })
    ).id;
  f.fg = await item("FG");
  f.bulk = await item("BULK");
  f.box = await item("BOX");
  f.plain = await item("PLAIN", false);
  f.off = await item("OFF", true, "Inactive");
  const ws = async (l: string, status: "Active" | "Inactive" = "Active") =>
    (
      await prisma.refWorkstation.create({
        data: { workstation_code: `test.${tag}.${l}`, workstation_label: `T${Date.now() % 1000}${l}`, workstation_name: l, cost_center_id: await productionCostCenterId(), status, created_by: actor },
      })
    ).id;
  f.ws1 = await ws("A");
  f.ws2 = await ws("B");
  f.wsOff = await ws("C", "Inactive");
});

after(async () => {
  const boms = await prisma.prdBom.findMany({ where: { bom_code: { startsWith: `test.${tag}` } }, select: { id: true } });
  const routings = await prisma.prdRouting.findMany({ where: { routing_code: { startsWith: `test.${tag}` } }, select: { id: true } });
  await prisma.prdRoutingStep.deleteMany({ where: { routing_id: { in: routings.map((r) => r.id) } } });
  await prisma.prdRouting.deleteMany({ where: { id: { in: routings.map((r) => r.id) } } });
  await prisma.prdBomLine.deleteMany({ where: { bom_id: { in: boms.map((b) => b.id) } } });
  await prisma.prdBom.deleteMany({ where: { id: { in: boms.map((b) => b.id) } } });
  await prisma.refWorkstation.deleteMany({ where: { workstation_code: { startsWith: `test.${tag}` } } });
  await prisma.mItem.deleteMany({ where: { item_code: { startsWith: `test.${tag}` } } });
  await disconnect();
});

async function bom(label: string, itemId: number, isDefault = false) {
  return (
    await prisma.prdBom.create({
      data: { bom_code: `test.${tag}.${label}`, bom_label: `${tag}-${label}`, bom_name: label, item_id: itemId, base_qty: 1, is_default: isDefault, created_by: actor },
    })
  ).id;
}

describe("the registry carries the Walet masters (step 1)", () => {
  test("Workstation names its Kode Job; Item its Tipe Output and value weight", () => {
    const ws = ENTITIES.find((e) => e.key === "ref_workstation")!;
    assert.ok(ws.fields.some((x) => x.name === "job_code"));
    const item = ENTITIES.find((e) => e.key === "m_item")!;
    assert.deepEqual(item.fields.find((x) => x.name === "output_type")?.options, ["Utama", "Turunan", "BJL"]);
    assert.equal(item.fields.find((x) => x.name === "value_weight")?.visibleWhen, "itemIsGoods");
  });

  test("BoM and Routing sit in Produksi › Master Data with their own permissions", () => {
    for (const [key, view] of [["prd_bom", "BOM_VIEW"], ["prd_routing", "ROUTING_VIEW"]] as const) {
      const e = ENTITIES.find((x) => x.key === key)!;
      assert.equal(e.module, "production");
      assert.equal(entityPermissions(key).view, view);
      assert.equal(navEntity("production", key)?.permission, view);
    }
  });
});

describe("Bill of Materials — a suggestion per base quantity", () => {
  test("only a Barang kept in stock is produced or put in", async () => {
    assert.equal(await productionItemProblem(f.fg), null);
    assert.match((await productionItemProblem(f.plain))!, /Kelola Stok/);
    assert.match((await productionItemProblem(f.off))!, /nonaktif/);
  });

  test("a line names a component other than the output, once, above 0, with an optional step", () => {
    assert.ok(bomLineErrors({ itemId: f.fg, qty: "1", stepNo: null }, [], f.fg).itemId);
    assert.ok(bomLineErrors({ itemId: f.box, qty: "1", stepNo: null }, [f.box], f.fg).itemId);
    assert.ok(bomLineErrors({ itemId: f.box, qty: "0", stepNo: null }, [], f.fg).qty);
    assert.deepEqual(bomLineErrors({ itemId: f.box, qty: "1", stepNo: 10 }, [], f.fg), {});
  });

  test("the check refuses a non-stock component and an empty BoM, and keeps the steps", async () => {
    const base = { item_id: f.fg, base_qty: "1" };
    assert.match((await checkBom({ ...base, [BOM_LINES_KEY]: "[]" }, null)).errors[BOM_LINES_KEY], /minimal satu/);
    assert.match((await checkBom({ ...base, [BOM_LINES_KEY]: lines([[f.plain, "1", null]]) }, null)).errors[BOM_LINES_KEY], /Kelola Stok/);
    assert.match((await checkBom({ item_id: f.plain, base_qty: "1", [BOM_LINES_KEY]: lines([[f.box, "1", null]]) }, null)).errors.item_id, /Kelola Stok/);
    const ok = await checkBom({ ...base, [BOM_LINES_KEY]: lines([[f.bulk, "50", null], [f.box, "1", 11]]) }, null);
    assert.deepEqual(ok.errors, {});
    assert.deepEqual(ok.clean.lines, [{ itemId: f.bulk, qty: "50", stepNo: null }, { itemId: f.box, qty: "1", stepNo: 11 }]);
  });

  test("a default BoM is the only default of its item", async () => {
    const a = await bom("A", f.fg, true);
    const b = await bom("B", f.fg, true); // the registry save sets its own flag
    await writeBom(prisma, b, { itemId: f.fg, isDefault: true, lines: [{ itemId: f.box, qty: "1", stepNo: null }] }, actor);
    const rows = await prisma.prdBom.findMany({ where: { id: { in: [a, b] } }, orderBy: { id: "asc" } });
    assert.deepEqual(rows.map((r) => r.is_default), [false, true]);
    assert.equal(await prisma.prdBomLine.count({ where: { bom_id: b } }), 1);
  });
});

describe("Routing — the stations to the target item", () => {
  test("steps name active workstations with a mode and an optional active BoM; numbered in order", async () => {
    const theBom = await bom("R", f.fg);
    const base = { item_id: f.fg };
    assert.match((await checkRouting({ ...base, [ROUTING_STEPS_KEY]: "[]" }, null)).errors[ROUTING_STEPS_KEY], /minimal satu/);
    assert.match((await checkRouting({ ...base, [ROUTING_STEPS_KEY]: steps([[f.wsOff, "Transform", null]]) }, null)).errors[ROUTING_STEPS_KEY], /aktif/);
    const ok = await checkRouting({ ...base, [ROUTING_STEPS_KEY]: steps([[f.ws1, "Transform", null], [f.ws2, "PassThrough", theBom], [f.ws1, "MixTransform", null]]) }, null);
    assert.deepEqual(ok.errors, {});
    const routing = await prisma.prdRouting.create({
      data: { routing_code: `test.${tag}.R1`, routing_label: `${tag}-R1`, routing_name: "R1", item_id: f.fg, created_by: actor },
    });
    await writeRouting(prisma, routing.id, ok.clean, actor);
    const rows = await prisma.prdRoutingStep.findMany({ where: { routing_id: routing.id }, orderBy: { step_no: "asc" } });
    assert.deepEqual(rows.map((r) => [r.step_no, r.workstation_id, r.mode, r.bom_id]), [
      [1, f.ws1, "Transform", null],
      [2, f.ws2, "PassThrough", theBom],
      [3, f.ws1, "MixTransform", null],
    ]);
    assert.match((await bomDeactivationRefusal(theBom))!, /Routing aktif/);
  });
});
