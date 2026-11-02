import test, { after, before, describe } from "node:test";
import assert from "node:assert/strict";

import { issueStock } from "../src/lib/erp/inventory";
import { enterProduction } from "../src/lib/erp/production-ledger";
import { createExecution, executionPreview, getExecution, transitionExecution, updateExecution, type ExecutionInput } from "../src/lib/erp/production-run";
import { cleanupFiscalYear, cleanupFixtures, disconnect, makeAccount, openFiscalYear, prisma } from "./helpers";
import { makeProductionFixture, sourceOf, type ProductionFixture } from "./production-helpers";

/**
 * Eksekusi Produksi (R5, R6, R11, R17): inputs held at the workstation become
 * new output lots valued by qty × Bobot Nilai; a Driver above 0; output lots
 * named `<number>-<n>` when not typed; a journal only between different WIP
 * accounts.
 */

const today = new Date().toISOString().slice(0, 10);
const date = new Date(`${today}T00:00:00Z`);
let f: ProductionFixture;
let bucket = 0;
let otherCategory = 0;
let otherWip = 0;
const ids: number[] = [];

const input = (over: Partial<ExecutionInput> = {}): ExecutionInput => ({
  execution_date: today,
  workstation_id: f.wsA,
  driver: "8",
  note: "",
  inputs: [{ bucket_id: bucket, qty: "400" }],
  outputs: [
    { item_id: f.product, tracking_no: "", expiry_date: "", qty: "300" },
    { item_id: f.byproduct, tracking_no: "", expiry_date: "", qty: "50" },
  ],
  ...over,
});

before(async () => {
  await openFiscalYear();
  f = await makeProductionFixture("EX");
  // The product sits in a category of its own, with another WIP account, so value moves between WIP accounts.
  otherWip = await makeAccount({ subcategoryLabel: "1.1.5" });
  otherCategory = (
    await prisma.sysItemCategory.create({ data: { category_code: `test.${f.key("CAT2")}`, category_label: f.key("CAT2"), category_name: "Kategori Uji Produk", item_type: "Barang", created_by: f.actor } })
  ).id;
  await prisma.accItemCategoryAccount.create({ data: { category_id: otherCategory, inventory_account_id: f.inventoryAcc, wip_account_id: otherWip, created_by: f.actor } });
  await prisma.mItem.update({ where: { id: f.product }, data: { category_id: otherCategory, value_weight: 2 } });
  const s = await sourceOf("log_stock_issue", "SI-EX");
  bucket = await prisma.$transaction(async (tx) => {
    const { cost } = await issueStock(tx, { itemId: f.material, warehouseId: f.warehouse, lotId: f.lot, baseQty: 500, date, source: s, actorId: f.actor });
    return (await enterProduction(tx, { lotId: f.lot, itemId: f.material, workstationId: f.wsA, baseQty: 500, value: cost, date, source: s, actorId: f.actor })).bucketId;
  });
});

after(async () => {
  await prisma.prdExecution.deleteMany({ where: { id: { in: ids } } });
  await prisma.auditLog.deleteMany({ where: { entity_key: "prd_execution", row_id: { in: ids } } });
  await prisma.mItem.update({ where: { id: f.product }, data: { category_id: f.category } });
  await f.teardown();
  await prisma.accItemCategoryAccount.deleteMany({ where: { category_id: otherCategory } });
  await prisma.sysItemCategory.deleteMany({ where: { id: otherCategory } });
  await cleanupFixtures();
  await cleanupFiscalYear();
  await disconnect();
});

describe("an Eksekusi Produksi is checked before it is saved", () => {
  test("a Driver above 0 (R11), inputs held at its workstation, outputs that carry weight (R6)", async () => {
    const r = await createExecution(input({ driver: "0", workstation_id: f.wsB, outputs: [{ item_id: f.byproduct, tracking_no: "", expiry_date: "", qty: "5" }] }), f.actor);
    assert.ok(!r.ok);
    if (!r.ok) {
      assert.match(r.errors.driver, /Driver/);
      assert.match(r.errors["inputs.0.bucket_id"], /tidak berada di Workstation/);
      assert.match(r.errors._outputs, /berbobot 0/);
    }
  });

  test("an output lot number the item already has is refused (R17)", async () => {
    const lotNo = (await prisma.logStockTracking.findUniqueOrThrow({ where: { id: f.lot } })).tracking_no;
    const r = await createExecution(input({ outputs: [{ item_id: f.material, tracking_no: lotNo, expiry_date: "", qty: "1" }, { item_id: f.product, tracking_no: "", expiry_date: "", qty: "1" }] }), f.actor);
    assert.ok(!r.ok && /sudah punya lot/.test(r.errors["outputs.0.tracking_no"]));
  });
});

describe("posting transforms the inputs into new lots", () => {
  test("the value shares by qty × Bobot Nilai; the journal moves it between WIP accounts; lots are named by the execution", async () => {
    const r = await createExecution(input(), f.actor);
    assert.ok(r.ok, JSON.stringify(r));
    ids.push(r.id);
    assert.ok((await updateExecution(r.id, input({ driver: "10" }), f.actor)).ok);
    const preview = await executionPreview(r.id, f.actor);
    assert.ok(preview.ok, JSON.stringify(preview));
    if (preview.ok) assert.deepEqual(preview.lines.map((l) => [l.debit, l.credit]), [[400_000, 0], [0, 400_000]]);

    assert.ok((await transitionExecution(r.id, "post", f.actor)).ok);
    const v = (await getExecution(r.id))!;
    assert.equal(v.status, "Posted");
    assert.equal(v.value, 400_000);
    assert.deepEqual(v.outputs.map((o) => [o.lotNo, o.weight, o.value]), [
      [`${v.no}-1`, 600, 400_000],
      [`${v.no}-2`, 0, 0],
    ]);
    const lines = await prisma.accJournalLine.findMany({ where: { journal_id: v.journalId! }, orderBy: { sequence_no: "asc" } });
    assert.deepEqual(lines.map((l) => [l.account_id, l.debit_amount.toNumber(), l.kredit_amount.toNumber()]), [[otherWip, 400_000, 0], [f.wipAcc, 0, 400_000]]);
    const made = await prisma.prdBalance.findMany({ where: { workstation_id: f.wsA, item_id: { in: [f.product, f.byproduct] } }, orderBy: { item_id: "asc" } });
    assert.deepEqual(made.map((b) => b.qty_balance.toNumber()).sort((a, b) => a - b), [50, 300]);
  });

  test("an execution within one WIP account writes no journal; a posted one is final", async () => {
    const r = await createExecution(input({ inputs: [{ bucket_id: bucket, qty: "100" }], outputs: [{ item_id: f.byproduct, tracking_no: "", expiry_date: "", qty: "10" }, { item_id: f.material, tracking_no: f.key("RE1"), expiry_date: "", qty: "1" }] }), f.actor);
    assert.ok(!r.ok, "material has no Bobot Nilai either: all outputs weigh 0");
    await prisma.mItem.update({ where: { id: f.material }, data: { value_weight: 1 } });
    const ok = await createExecution(input({ inputs: [{ bucket_id: bucket, qty: "100" }], outputs: [{ item_id: f.material, tracking_no: f.key("RE1"), expiry_date: "", qty: "90" }] }), f.actor);
    assert.ok(ok.ok, JSON.stringify(ok));
    ids.push(ok.id);
    assert.ok((await transitionExecution(ok.id, "post", f.actor)).ok);
    const v = (await getExecution(ok.id))!;
    assert.equal(v.journalId, null);
    assert.equal(v.outputs[0].value, 100_000);
    assert.ok(!(await transitionExecution(ok.id, "cancel", f.actor, "x")).ok);
  });
});
