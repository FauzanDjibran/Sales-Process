import test, { after, before, describe } from "node:test";
import assert from "node:assert/strict";

import { ENTITIES } from "../src/lib/erp/entities";
import { entityPermissions } from "../src/lib/erp/entity-access";
import { MODULES } from "../src/lib/erp/nav";
import {
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
 * masters — a BoM a suggestion of what goes in per base quantity at one
 * workstation, a Routing the stations a Partai passes to its target item; each
 * station works by its own Cara Kerja (P166).
 */

let actor = 0;
const tag = `${FIXTURE_PREFIX}${Date.now() % 100000}`;
const f = {} as Record<string, number>;
const navEntity = (moduleKey: string, key: string) =>
  (MODULES.find((m) => m.key === moduleKey)?.groups ?? []).flatMap((g) => g.entities).find((x) => x.key === key);

const lines = (list: [number, string][]) => JSON.stringify(list.map(([itemId, qty], i) => ({ key: `k${i}`, itemId, qty })));
const steps = (list: number[]) => JSON.stringify(list.map((workstationId, i) => ({ key: `s${i}`, workstationId })));

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
  const ws = async (l: string, mode: "Transform" | "PassThrough" | "MixTransform", status: "Active" | "Inactive" = "Active") =>
    (
      await prisma.refWorkstation.create({
        data: { workstation_code: `test.${tag}.${l}`, workstation_label: `T${Date.now() % 1000}${l}`, workstation_name: l, cost_center_id: await productionCostCenterId(), mode, status, created_by: actor },
      })
    ).id;
  f.ws1 = await ws("A", "Transform");
  f.ws2 = await ws("B", "PassThrough");
  f.wsOff = await ws("C", "Transform", "Inactive");
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

async function bom(label: string, itemId: number, workstationId: number, isDefault = false) {
  return (
    await prisma.prdBom.create({
      data: { bom_code: `test.${tag}.${label}`, bom_label: `${tag}-${label}`, bom_name: label, item_id: itemId, workstation_id: workstationId, base_qty: 1, is_default: isDefault, created_by: actor },
    })
  ).id;
}

describe("the registry carries the Walet masters (step 1)", () => {
  test("Workstation names its Kode Job and its Cara Kerja; a BoM its Workstation; Item its Tipe Output and value weight", () => {
    const ws = ENTITIES.find((e) => e.key === "ref_workstation")!;
    assert.ok(ws.fields.some((x) => x.name === "job_code"));
    assert.deepEqual(ws.fields.find((x) => x.name === "mode")?.options, ["Transform", "PassThrough", "MixTransform"]);
    assert.equal(ENTITIES.find((e) => e.key === "prd_bom")!.fields.find((x) => x.name === "workstation_id")?.required, true);
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

  test("a line names a component other than the output, once, above 0", () => {
    assert.ok(bomLineErrors({ itemId: f.fg, qty: "1" }, [], f.fg).itemId);
    assert.ok(bomLineErrors({ itemId: f.box, qty: "1" }, [f.box], f.fg).itemId);
    assert.ok(bomLineErrors({ itemId: f.box, qty: "0" }, [], f.fg).qty);
    assert.deepEqual(bomLineErrors({ itemId: f.box, qty: "1" }, [], f.fg), {});
  });

  test("the check needs an active workstation, refuses a non-stock component and an empty BoM", async () => {
    const base = { item_id: f.fg, workstation_id: f.ws1, base_qty: "1" };
    assert.match((await checkBom({ ...base, workstation_id: null, [BOM_LINES_KEY]: lines([[f.box, "1"]]) }, null)).errors.workstation_id, /workstation/);
    assert.match((await checkBom({ ...base, workstation_id: f.wsOff, [BOM_LINES_KEY]: lines([[f.box, "1"]]) }, null)).errors.workstation_id, /nonaktif/);
    assert.match((await checkBom({ ...base, [BOM_LINES_KEY]: "[]" }, null)).errors[BOM_LINES_KEY], /minimal satu/);
    assert.match((await checkBom({ ...base, [BOM_LINES_KEY]: lines([[f.plain, "1"]]) }, null)).errors[BOM_LINES_KEY], /Kelola Stok/);
    assert.match((await checkBom({ ...base, item_id: f.plain, [BOM_LINES_KEY]: lines([[f.box, "1"]]) }, null)).errors.item_id, /Kelola Stok/);
    const ok = await checkBom({ ...base, [BOM_LINES_KEY]: lines([[f.bulk, "50"], [f.box, "1"]]) }, null);
    assert.deepEqual(ok.errors, {});
    assert.deepEqual(ok.clean.lines, [{ itemId: f.bulk, qty: "50" }, { itemId: f.box, qty: "1" }]);
  });

  test("a default BoM is the only default of its item at its workstation; another station keeps its own", async () => {
    const a = await bom("A", f.fg, f.ws1, true);
    const other = await bom("O", f.fg, f.ws2, true);
    const b = await bom("B", f.fg, f.ws1, true); // the registry save sets its own flag
    await writeBom(prisma, b, { itemId: f.fg, workstationId: f.ws1, isDefault: true, lines: [{ itemId: f.box, qty: "1" }] }, actor);
    const rows = await prisma.prdBom.findMany({ where: { id: { in: [a, other, b] } }, orderBy: { id: "asc" } });
    assert.deepEqual(rows.map((r) => r.is_default), [false, true, true]);
    assert.equal(await prisma.prdBomLine.count({ where: { bom_id: b } }), 1);
  });
});

describe("Routing — the stations to the target item", () => {
  test("steps name active workstations, numbered in order; how each works is the workstation's", async () => {
    const base = { item_id: f.fg };
    assert.match((await checkRouting({ ...base, [ROUTING_STEPS_KEY]: "[]" }, null)).errors[ROUTING_STEPS_KEY], /minimal satu/);
    assert.match((await checkRouting({ ...base, [ROUTING_STEPS_KEY]: steps([f.wsOff]) }, null)).errors[ROUTING_STEPS_KEY], /aktif/);
    const ok = await checkRouting({ ...base, [ROUTING_STEPS_KEY]: steps([f.ws1, f.ws2, f.ws1]) }, null);
    assert.deepEqual(ok.errors, {});
    const routing = await prisma.prdRouting.create({
      data: { routing_code: `test.${tag}.R1`, routing_label: `${tag}-R1`, routing_name: "R1", item_id: f.fg, created_by: actor },
    });
    await writeRouting(prisma, routing.id, ok.clean, actor);
    const rows = await prisma.prdRoutingStep.findMany({ where: { routing_id: routing.id }, orderBy: { step_no: "asc" }, include: { workstation: { select: { mode: true } } } });
    assert.deepEqual(rows.map((r) => [r.step_no, r.workstation_id, r.workstation.mode]), [
      [1, f.ws1, "Transform"],
      [2, f.ws2, "PassThrough"],
      [3, f.ws1, "Transform"],
    ]);
  });
});
