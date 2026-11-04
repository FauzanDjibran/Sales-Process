import test, { after, before, describe } from "node:test";
import assert from "node:assert/strict";

import { ENTITIES } from "../src/lib/erp/entities";
import { checkItemBjl } from "../src/lib/erp/item";
import { abilitiesFor } from "../src/lib/erp/entity-access";
import { checkRateCollections, checkRoutingCollections, routingCollections, writeRateCollections, writeRoutingCollections } from "../src/lib/erp/production-master";
import { STEPS_KEY, stepRuleErrors } from "../src/lib/erp/production-master-shape";
import { InventoryRefusal, injectStock, receiveStock } from "../src/lib/erp/inventory";
import { enterProduction } from "../src/lib/erp/production-ledger";
import { FIXTURE_PREFIX, cleanupFixtures, disconnect, prisma, systemUserId } from "./helpers";
import { makeProductionFixture, sourceOf } from "./production-helpers";

/**
 * The production masters (P225, W33): Unit and Workstation are data, a routing
 * is the order of Units with the rules of each step, the BJL flag locks once
 * used, and a No. Stok is one stock in the whole system (W10).
 */

let actor = 0;
const stamp = String(Date.now() % 100000);
const key = (s: string) => `${FIXTURE_PREFIX}${s}${stamp}`;
const f = {} as Record<string, number>;
/** The versions active before the suite: a test's version closes them. */
let activeBefore: number[] = [];

before(async () => {
  actor = await systemUserId();
  f.ws = (await prisma.refWorkstation.create({ data: { workstation_code: `test.${key("W")}`, workstation_label: key("W"), workstation_name: "Uji", created_by: actor } })).id;
  const unit = async (tag: string, processes: ("PassThrough" | "Grading" | "PartaiFormer" | "GradingMix" | "JobOrder" | "Assembly")[]) =>
    (await prisma.refUnit.create({ data: { unit_code: `test.${key(tag)}`, unit_label: key(tag), unit_name: tag, workstation_id: f.ws, processes, created_by: actor } })).id;
  f.grade = await unit("G", ["Grading"]);
  f.former = await unit("F", ["PartaiFormer", "Grading"]);
  f.mould = await unit("M", ["GradingMix", "JobOrder"]);
  f.pack = await unit("P", ["Assembly"]);
  const line = async (tag: string) =>
    (await prisma.prdLine.create({ data: { line_code: `test.${key(tag)}`, line_label: key(tag), line_name: "Uji", created_by: actor } })).id;
  f.line = await line("L");
  f.line2 = await line("L2");
  activeBefore = (await prisma.prdRateVersion.findMany({ where: { status: "Active" }, select: { id: true } })).map((v) => v.id);
});

after(async () => {
  await prisma.prdRoutingStep.deleteMany({ where: { unit_id: { in: [f.grade, f.former, f.mould, f.pack] } } });
  await prisma.prdRouting.deleteMany({ where: { routing_label: { startsWith: FIXTURE_PREFIX } } });
  await prisma.prdRateVersionLine.deleteMany({ where: { unit_id: { in: [f.grade, f.former, f.mould, f.pack] } } });
  await prisma.auditLog.deleteMany({ where: { entity_key: "prd_rate_version", row_id: { in: activeBefore } } });
  await prisma.prdRateVersion.deleteMany({ where: { rate_label: { startsWith: FIXTURE_PREFIX } } });
  await prisma.prdRateVersion.updateMany({ where: { id: { in: activeBefore } }, data: { status: "Active" } });
  await prisma.prdLine.deleteMany({ where: { id: { in: [f.line, f.line2] } } });
  await prisma.refUnit.deleteMany({ where: { id: { in: [f.grade, f.former, f.mould, f.pack] } } });
  await prisma.refWorkstation.deleteMany({ where: { id: f.ws } });
  await cleanupFixtures();
  await disconnect();
});

const step = (unit: number, over: Record<string, unknown> = {}) => ({ unit_id: unit, exit_mode: "WithQc", job_policy: "Carried", is_checkpoint: false, is_skippable: false, ...over });

describe("Unit, Workstation and the masters around them", () => {
  test("a Unit belongs to a Workstation and holds several kinds of work", async () => {
    const m = await prisma.refUnit.findUniqueOrThrow({ where: { id: f.mould }, include: { workstation: true } });
    assert.deepEqual(m.processes.sort(), ["GradingMix", "JobOrder"]);
    assert.equal(m.workstation?.id, f.ws);
  });

  test("every master is a registry entity with its permissions", () => {
    for (const k of ["ref_workstation", "ref_unit", "prd_line", "prd_routing", "prd_rate_version", "m_employee"]) {
      assert.ok(ENTITIES.some((e) => e.key === k), k);
    }
  });
});

describe("a routing is the order of Units, the rules of each step the step's own", () => {
  test("a line's routing round-trips with its order and per-step flags", async () => {
    const routing = await prisma.prdRouting.create({
      data: { routing_code: `test.${key("R")}`, routing_label: key("R"), routing_name: "Uji", line_id: f.line, created_by: actor },
    });
    const values = { line_id: f.line, [STEPS_KEY]: JSON.stringify([step(f.grade, { exit_mode: "Direct", job_policy: "Issued" }), step(f.mould, { is_checkpoint: true }), step(f.pack, { exit_mode: "PerCarton", is_skippable: true })]) };
    const checked = await checkRoutingCollections(values, routing.id);
    assert.deepEqual(checked.errors, {});
    await prisma.$transaction((tx) => writeRoutingCollections(tx, routing.id, checked.clean));
    const back = (await routingCollections(routing.id)).steps;
    assert.deepEqual(back.map((s) => s.unit_id), [f.grade, f.mould, f.pack]);
    assert.deepEqual(back.map((s) => s.exit_mode), ["Direct", "WithQc", "PerCarton"]);
    assert.equal(back[1].is_checkpoint, true);
    assert.equal(back[2].is_skippable, true);
  });

  test("a Unit appears once, and Per Kotak needs an Assembly Unit", async () => {
    const twice = await checkRoutingCollections({ line_id: f.line, [STEPS_KEY]: JSON.stringify([step(f.grade), step(f.grade)]) }, null);
    assert.match(twice.errors[STEPS_KEY], /sudah ada di routing/);
    const carton = await checkRoutingCollections({ line_id: f.line, [STEPS_KEY]: JSON.stringify([step(f.grade, { exit_mode: "PerCarton" })]) }, null);
    assert.match(carton.errors[STEPS_KEY], /Per Kotak hanya untuk unit dengan pekerjaan Assembly/);
  });

  test("the segment before the partai ends at the one Unit that forms it; a line's starts after", async () => {
    const ok = await checkRoutingCollections({ [STEPS_KEY]: JSON.stringify([step(f.grade, { exit_mode: "Direct" }), step(f.former)]) }, null);
    assert.equal(ok.errors[STEPS_KEY], undefined);
    const noFormer = await checkRoutingCollections({ [STEPS_KEY]: JSON.stringify([step(f.grade)]) }, null);
    assert.match(noFormer.errors[STEPS_KEY], /Pembentuk Partai/);
    const inLine = await checkRoutingCollections({ line_id: f.line, [STEPS_KEY]: JSON.stringify([step(f.former)]) }, null);
    assert.match(inLine.errors[STEPS_KEY], /sesudah partai terbentuk/);
  });

  test("one checkpoint at most, and never the first step", () => {
    const processes = () => ["Grading"];
    assert.match(stepRuleErrors([step(1, { is_checkpoint: true }), step(2, { is_checkpoint: true })] as never, true, processes).join(" "), /hanya boleh satu/);
    assert.match(stepRuleErrors([step(1, { is_checkpoint: true }), step(2)] as never, true, processes).join(" "), /pertama/);
    assert.deepEqual(stepRuleErrors([step(1), step(2, { is_checkpoint: true })] as never, true, processes), []);
  });

  test("another line's routing is only data: a different order of the same Units is accepted", async () => {
    const other = await checkRoutingCollections({ line_id: f.line2, [STEPS_KEY]: JSON.stringify([step(f.mould), step(f.grade), step(f.pack)]) }, null);
    assert.deepEqual(other.errors, {});
  });

  test("a line has one routing: a second is refused, the database holding the same rule (P226)", async () => {
    const second = await checkRoutingCollections({ line_id: f.line, [STEPS_KEY]: JSON.stringify([step(f.grade)]) }, null);
    assert.match(second.errors.line_id, /sudah punya routing/);
    await assert.rejects(
      prisma.prdRouting.create({ data: { routing_code: `test.${key("R2")}`, routing_label: key("R2"), routing_name: "Uji", line_id: f.line, created_by: actor } }),
      /Unique constraint/
    );
    const own = await prisma.prdRouting.findFirstOrThrow({ where: { line_id: f.line } });
    const same = await checkRoutingCollections({ line_id: f.line, [STEPS_KEY]: JSON.stringify([step(f.grade)]) }, own.id);
    assert.equal(same.errors.line_id, undefined, "saving itself is no clash");
  });
});

describe("Standard Cost versions", () => {
  test("a rate is 0 or more with at most six decimals, once per Unit", async () => {
    const ok = await checkRateCollections({ _rates: JSON.stringify([{ unit_id: f.grade, rate: "182.8637" }, { unit_id: f.mould, rate: "0" }]) });
    assert.deepEqual(ok.errors, {});
    const bad = await checkRateCollections({ _rates: JSON.stringify([{ unit_id: f.grade, rate: "-1" }]) });
    assert.match(bad.errors._rates, /0 atau lebih/);
    const dup = await checkRateCollections({ _rates: JSON.stringify([{ unit_id: f.grade, rate: "1" }, { unit_id: f.grade, rate: "2" }]) });
    assert.match(dup.errors._rates, /sudah punya rate/);
  });

  test("a saved version has no edit and no toggle, for anyone", () => {
    const can = abilitiesFor("prd_rate_version", ["RATE_VERSION_VIEW", "RATE_VERSION_CREATE", "RATE_VERSION_EDIT", "RATE_VERSION_ACTIVATE", "RATE_VERSION_DEACTIVATE"]);
    assert.deepEqual(can, { create: true, edit: false, activate: false, deactivate: false });
  });

  test("saving a version makes it the one active; the closed one keeps its rates and its id (P226)", async () => {
    const save = async (tag: string, rate: string) => {
      const v = await prisma.prdRateVersion.create({ data: { rate_code: `test.${key(tag)}`, rate_label: key(tag), rate_name: tag, created_by: actor } });
      assert.equal(v.status, "Inactive", "born closed, made active by saving");
      await prisma.$transaction((tx) => writeRateCollections(tx, v.id, { rates: [{ unit_id: f.grade, rate }] }, actor));
      return v.id;
    };
    const first = await save("V1", "10");
    const second = await save("V2", "20");
    const rows = await prisma.prdRateVersion.findMany({ where: { status: "Active" } });
    assert.deepEqual(rows.map((r) => r.id), [second]);
    const old = await prisma.prdRateVersion.findUniqueOrThrow({ where: { id: first }, include: { lines: true } });
    assert.equal(old.status, "Inactive");
    assert.equal(old.lines[0].rate.toNumber(), 10);
    await assert.rejects(prisma.prdRateVersion.update({ where: { id: first }, data: { status: "Active" } }), /Unique constraint/);
  });
});

describe("BJL and No. Stok", () => {
  test("BJL can change until the Item has been in production, then it is locked", async () => {
    const p = await makeProductionFixture("BJL");
    try {
      assert.deepEqual(await checkItemBjl({ is_bjl: true }, p.material), {});
      const date = new Date();
      const src = await sourceOf("log_stock_issue", "SI/TEST");
      await prisma.$transaction((tx) =>
        enterProduction(tx, { lotId: p.lot, itemId: p.material, unitId: p.wsA, baseQty: 10, value: 10_000, date, source: src, actorId: p.actor })
      );
      assert.match((await checkItemBjl({ is_bjl: true }, p.material)).is_bjl, /sudah dipakai di produksi/);
      // Unchanged is never an error, locked or not.
      assert.deepEqual(await checkItemBjl({ is_bjl: false }, p.material), {});
    } finally {
      await p.teardown();
    }
  });

  test("one No. Stok is one stock: another item cannot take the number, an injection cannot reuse it", async () => {
    const uom = await prisma.refUom.findFirstOrThrow();
    const cat = await prisma.sysItemCategory.findFirstOrThrow({ where: { item_type: "Barang" } });
    const wh = await prisma.refWarehouse.create({ data: { warehouse_code: `test.${key("WH")}`, warehouse_label: key("WH"), warehouse_name: "Uji", created_by: actor } });
    const mk = (tag: string) =>
      prisma.mItem.create({
        data: { item_code: `test.${key(tag)}`, item_label: key(tag), item_name: tag, item_type: "Barang", category_id: cat.id, base_uom_id: uom.id, track_stock: true, created_by: actor },
      });
    const a = await mk("A");
    const b = await mk("B");
    const type = await prisma.sysDocType.findFirstOrThrow();
    const no = key("NS");
    try {
      await prisma.$transaction((tx) =>
        receiveStock(tx, { itemId: a.id, warehouseId: wh.id, lotNo: no, expiry: null, baseQty: "5", value: "5000", date: new Date(), source: { docTypeId: type.id, docId: 1, no: "X" }, actorId: actor })
      );
      await assert.rejects(
        prisma.$transaction((tx) =>
          receiveStock(tx, { itemId: b.id, warehouseId: wh.id, lotNo: no, expiry: null, baseQty: "5", value: "5000", date: new Date(), source: { docTypeId: type.id, docId: 2, no: "Y" }, actorId: actor })
        ),
        (e: unknown) => e instanceof InventoryRefusal && /satu nomor satu stok/.test(e.message)
      );
      await assert.rejects(
        injectStock([{ itemId: a.id, warehouseId: wh.id, lotNo: no, expiry: null, qty: "1", value: "1000", date: new Date() }], actor),
        (e: unknown) => e instanceof InventoryRefusal && /sudah ada/.test(e.message)
      );
    } finally {
      const ids = [a.id, b.id];
      await prisma.logStockLedger.deleteMany({ where: { item_id: { in: ids } } });
      await prisma.logStockBalance.deleteMany({ where: { item_id: { in: ids } } });
      await prisma.logStockValuationLedger.deleteMany({ where: { item_id: { in: ids } } });
      await prisma.logStockValuationBalance.deleteMany({ where: { item_id: { in: ids } } });
      await prisma.logStockTracking.deleteMany({ where: { item_id: { in: ids } } });
      await prisma.mItem.deleteMany({ where: { id: { in: ids } } });
      await prisma.refWarehouse.delete({ where: { id: wh.id } });
    }
  });
});
