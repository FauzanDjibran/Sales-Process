import test, { after, before, describe } from "node:test";
import assert from "node:assert/strict";

import { createRun, transitionRun, type RunSectionInput } from "../src/lib/erp/production-run";
import { createRelease, transitionRelease } from "../src/lib/erp/production-release";
import { enterProduction } from "../src/lib/erp/production-ledger";
import { lotCardReport, productionBooksReconcile, runRecapReport, traceReport, wipBalanceReport } from "../src/lib/erp/production-report";
import {
  FIXTURE_PREFIX,
  cleanupFiscalYear,
  cleanupFixtures,
  cleanupStock,
  disconnect,
  makeAccount,
  openFiscalYear,
  prisma,
  productionCostCenterId,
  setCategoryAccount,
  snapshotCategoryAccounts,
  stockIn,
  systemUserId,
} from "./helpers";

/**
 * The production reports (Walet step 7, P171), over one real chain: a supplier lot
 * is injected into stock, issued to a station (placed there), transformed into a
 * finished good and a BJL, and the good received into a warehouse. Saldo Produksi
 * reads the ledger as of a date, Kartu Lot shows the lot in both books, Telusur
 * goes back to the supplier's lot and forward to where the goods are, and Rekap
 * Produksi shows the loss and the cost per unit rising with it.
 */

const today = new Date().toISOString().slice(0, 10);
const day = new Date(`${today}T00:00:00Z`);
let actor = 0;
const f = {} as Record<string, number>;
const items: number[] = [];
let fgLotNo = "";
const runs: number[] = [];
const releases: number[] = [];
const stamp = String(Date.now() % 100000);
const key = (s: string) => `${FIXTURE_PREFIX}${s}${stamp}`;
const cleanups: (() => Promise<unknown>)[] = [];
const savedSettings = new Map<string, string | null>();

async function setMapping(k: string, v: string | null) {
  if (!savedSettings.has(k)) savedSettings.set(k, (await prisma.sysSetting.findUnique({ where: { setting_key: k } }))?.setting_value ?? null);
  await prisma.sysSetting.upsert({ where: { setting_key: k }, update: { setting_value: v }, create: { setting_key: k, setting_value: v, updated_by: actor } });
}

before(async () => {
  actor = await systemUserId();
  await openFiscalYear();
  const cc = await productionCostCenterId();
  f.g = (await prisma.refUom.create({ data: { uom_code: `test.${key("G")}`, uom_label: key("G"), uom_name: "Gram", created_by: actor } })).id;
  f.cat = (await prisma.sysItemCategory.findUniqueOrThrow({ where: { category_label: "BHN-BAKU" } })).id;
  const item = async (l: string, type: "Utama" | "BJL") => {
    const id = (
      await prisma.mItem.create({
        data: { item_code: `test.${key(l)}`, item_label: key(l), item_name: l, item_type: "Barang", category_id: f.cat, base_uom_id: f.g, track_stock: true, output_type: type, created_by: actor },
      })
    ).id;
    items.push(id);
    return id;
  };
  f.raw = await item("RAW", "Utama");
  f.fg = await item("FG", "Utama");
  f.bs = await item("BS", "BJL");
  f.warehouse = (await prisma.refWarehouse.create({ data: { warehouse_code: `test.${key("WH")}`, warehouse_label: key("WH"), warehouse_name: "Gudang", created_by: actor } })).id;
  f.ws = (await prisma.refWorkstation.create({ data: { workstation_code: `test.${key("WS")}`, workstation_label: key("WS"), workstation_name: "Grading", cost_center_id: cc, mode: "Transform", created_by: actor } })).id;
  const sub = async (label: string) => (await prisma.accAccountSubcategory.findFirstOrThrow({ where: { subcategory_label: { startsWith: label } }, orderBy: { id: "asc" } })).subcategory_label;
  f.wipAcc = await makeAccount({ subcategoryLabel: await sub("1") });
  f.invAcc = await makeAccount({ subcategoryLabel: await sub("1") });
  cleanups.push(await snapshotCategoryAccounts([f.cat]));
  await setCategoryAccount(f.cat, "Wip", f.wipAcc, actor);
  await setCategoryAccount(f.cat, "Inventory", null, actor);
  await setMapping("inventory_account", String(f.invAcc));

  // The supplier's lot, in stock, then at the station.
  f.rawLot = await stockIn(f.raw, f.warehouse, key("R1"), 100, 1000);
  const docTypeId = (await prisma.sysDocType.findFirstOrThrow({ where: { doc_table: "prd_execution" } })).id;
  f.rawBucket = (await prisma.$transaction((tx) => enterProduction(tx, { lotId: f.rawLot, itemId: f.raw, workstationId: f.ws, baseQty: 100, value: 1000, date: day, source: { docTypeId, docId: 600_000 + (Date.now() % 90_000), no: "TEST" }, actorId: actor }))).bucketId;
});

after(async () => {
  const lots = (await prisma.logStockTracking.findMany({ where: { item_id: { in: items } }, select: { id: true } })).map((l) => l.id);
  await prisma.prdReleaseLine.deleteMany({ where: { release_id: { in: releases } } });
  await prisma.prdRelease.deleteMany({ where: { id: { in: releases } } });
  await prisma.auditLog.deleteMany({ where: { entity_key: "prd_release", row_id: { in: releases } } });
  await prisma.prdExecutionCost.deleteMany({ where: { execution_id: { in: runs } } });
  await prisma.prdExecutionOutput.deleteMany({ where: { section: { execution_id: { in: runs } } } });
  await prisma.prdExecutionInput.deleteMany({ where: { section: { execution_id: { in: runs } } } });
  await prisma.prdExecutionSection.deleteMany({ where: { execution_id: { in: runs } } });
  await prisma.prdExecution.deleteMany({ where: { id: { in: runs } } });
  await prisma.auditLog.deleteMany({ where: { entity_key: "prd_execution", row_id: { in: runs } } });
  await prisma.prdLotLink.deleteMany({ where: { OR: [{ from_lot_id: { in: lots } }, { to_lot_id: { in: lots } }] } });
  await prisma.prdLedger.deleteMany({ where: { item_id: { in: items } } });
  await prisma.prdBalance.deleteMany({ where: { item_id: { in: items } } });
  for (const [k, v] of savedSettings) await prisma.sysSetting.update({ where: { setting_key: k }, data: { setting_value: v } });
  for (const c of cleanups) await c();
  await cleanupFixtures();
  await cleanupStock(items);
  await prisma.mItem.deleteMany({ where: { id: { in: items } } });
  await prisma.refWorkstation.deleteMany({ where: { id: f.ws } });
  await prisma.refWarehouse.deleteMany({ where: { id: f.warehouse } });
  await prisma.refUom.deleteMany({ where: { id: f.g } });
  await cleanupFiscalYear();
  await disconnect();
});

const station = { workstationIds: [] as number[], partaiIds: [] as number[] };

describe("Saldo Produksi reads the ledger as of a date", () => {
  test("the goods at the station, valued, before any run; nothing the day before they came", async () => {
    const before = await wipBalanceReport(today, { ...station, workstationIds: [f.ws] });
    const rows = before.flatMap((b) => b.rows);
    assert.equal(rows.length, 1);
    assert.deepEqual([rows[0].qty, rows[0].value, rows[0].unitCost, rows[0].status], [100, 1000, 10, "Tersedia"]);
    assert.equal(before[0].partaiNo, null, "stock lots at a station belong to no Partai yet");
    const yesterday = new Date(day.getTime() - 86_400_000).toISOString().slice(0, 10);
    assert.deepEqual(await wipBalanceReport(yesterday, { ...station, workstationIds: [f.ws] }), [], "as it stood: nothing yet");
  });

  test("after a run the balances are the run's outputs; a BJL carries no value; the books reconcile", async () => {
    const sec: RunSectionInput = {
      driver: 0,
      inputs: [{ bucket_id: f.rawBucket, qty: 100 }],
      outputs: [
        { item_id: f.fg, qty: 90, lot_no: "", expiry_date: "", status: "Available" },
        { item_id: f.bs, qty: 4, lot_no: "", expiry_date: "", status: "Available" },
      ],
    };
    const r = await createRun({ execution_date: today, kind: "Transform", workstation_id: f.ws, note: "" }, [sec], actor);
    assert.ok(r.ok, JSON.stringify(r));
    runs.push(r.id);
    assert.ok((await transitionRun(r.id, "post", actor)).ok);
    const blocks = await wipBalanceReport(today, { ...station, workstationIds: [f.ws] });
    const rows = blocks.flatMap((b) => b.rows).sort((a, b) => b.value - a.value);
    assert.deepEqual(rows.map((x) => [x.itemLabel === key("FG") ? "fg" : "bs", x.qty, x.value]), [["fg", 90, 1000], ["bs", 4, 0]]);
    assert.equal(blocks.reduce((s, b) => s + b.value, 0), 1000, "cost in = cost out");
    assert.equal(await productionBooksReconcile(), true);
    fgLotNo = (await prisma.prdExecutionOutput.findFirstOrThrow({ where: { section: { execution_id: r.id }, item_id: f.fg } })).lot_no!;
  });
});

describe("Rekap Produksi: the loss raises the cost per unit", () => {
  test("100 in, 94 out: susut 6 (6 %), Rp 10 per unit in, Rp 1.000 ÷ 94 out; a range without runs is empty", async () => {
    const [st] = await runRecapReport({ from: today, to: today }, [f.ws]);
    assert.equal(st.runs, 1);
    const row = st.rows[0];
    assert.deepEqual([row.inQty, row.outQty, row.loss, row.lossPct, row.inValue, row.outValue], [100, 94, 6, 6, 1000, 1000]);
    assert.equal(row.inUnitCost, 10);
    assert.equal(row.outUnitCost, Math.round((1000 / 94) * 1e6) / 1e6);
    assert.ok(row.outUnitCost > row.inUnitCost);
    assert.equal(st.executions.length, 1);
    assert.deepEqual(await runRecapReport({ from: "2000-01-01", to: "2000-01-31" }, [f.ws]), []);
  });
});

describe("Kartu Lot and Telusur follow the lot through both books", () => {
  test("the finished good goes to stock; its card has the run in production and the receipt in stock", async () => {
    const docs = await prisma.prdBalance.findFirstOrThrow({ where: { lot: { tracking_no: fgLotNo }, workstation_id: f.ws } });
    const rel = await createRelease({ purpose: "finished_receipt", release_date: today, workstation_id: f.ws, warehouse_id: f.warehouse, reason: "", note: "" }, [{ bucket_id: docs.id, qty: 90, location_id: null }], actor);
    assert.ok(rel.ok, JSON.stringify(rel));
    releases.push(rel.id);
    assert.ok((await transitionRelease(rel.id, "post", actor)).ok);

    const card = (await lotCardReport(fgLotNo.toLowerCase()))!;
    assert.deepEqual([card.itemLabel, card.uom], [key("FG"), key("G")]);
    assert.deepEqual(card.inProduction.map((m) => [m.movement, m.qtyChange, m.qtyBalance, m.valueBalance]), [["Produced", 90, 90, 1000], ["Released", -90, 0, 0]]);
    assert.deepEqual(card.inStock.map((m) => [m.qtyChange, m.value]), [[90, 1000]]);
    assert.equal(await lotCardReport("NO-SUCH-LOT"), null);
  });

  test("Telusur of the good goes back to the supplier's lot; of the supplier's lot goes forward to the good in stock", async () => {
    const back = (await traceReport(fgLotNo))!;
    assert.equal(back.kind, "lot");
    assert.equal(back.start[0].now!.stock[0].qty, 90, "the start shows where it is now");
    const root = back.backward.find((n) => n.lotNo === key("R1").toUpperCase())!;
    assert.ok(root, "back to the lot that came in");
    assert.match(root.origin?.sourceNo ?? "", /^INJ\//, "its origin is the injection that brought it into stock");
    assert.equal(root.depth, 1);
    assert.equal(back.backward[0].via[0].qty > 0, true);

    const fwd = (await traceReport(key("R1")))!;
    const leaf = fwd.forward.find((n) => n.lotNo === fgLotNo)!;
    assert.ok(leaf, "forward to the finished good");
    assert.deepEqual(leaf.now!.stock.map((s) => s.qty), [90]);
    assert.ok(fwd.forward.some((n) => n.itemLabel === key("BS")), "and to the BJL it made");
    assert.equal(await traceReport("NO-SUCH-THING"), null);
    assert.equal(await traceReport("  "), null);
  });
});
