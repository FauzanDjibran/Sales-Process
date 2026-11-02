import test, { after, before, describe } from "node:test";
import assert from "node:assert/strict";

import { issueStock } from "../src/lib/erp/inventory";
import { enterProduction } from "../src/lib/erp/production-ledger";
import { createRelease, getRelease, releasePreview, transitionRelease, type ReleaseInput } from "../src/lib/erp/production-release";
import { createTransfer, getTransfer, transitionTransfer, type TransferInput } from "../src/lib/erp/production-transfer";
import { cleanupFiscalYear, cleanupFixtures, disconnect, openFiscalYear, prisma } from "./helpers";
import { makeProductionFixture, sourceOf, type ProductionFixture } from "./production-helpers";

/**
 * Production Transfer (R7) and Production Release (R8): a lot moves directly
 * between workstations, value kept and no journal; it leaves production into
 * a warehouse under the same lot (Dr Persediaan / Cr WIP) or is written off
 * with a reason (Dr Beban Pemusnahan / Cr WIP).
 */

const today = new Date().toISOString().slice(0, 10);
const date = new Date(`${today}T00:00:00Z`);
let f: ProductionFixture;
let bucket = 0;
const transfers: number[] = [];
const releases: number[] = [];
const SCRAP_KEY = "production_scrap_account";
let savedScrap: string | null | undefined;

const transfer = (over: Partial<TransferInput> = {}): TransferInput => ({
  transfer_date: today,
  from_workstation_id: f.wsA,
  to_workstation_id: f.wsB,
  note: "",
  lines: [{ bucket_id: bucket, qty: "250" }],
  ...over,
});
const release = (over: Partial<ReleaseInput>): ReleaseInput => ({
  purpose: "to_stock",
  release_date: today,
  workstation_id: f.wsB,
  warehouse_id: f.warehouse,
  location_id: null,
  scrap_reason: "",
  note: "",
  lines: [],
  ...over,
});

before(async () => {
  await openFiscalYear();
  f = await makeProductionFixture("MV");
  savedScrap = (await prisma.sysSetting.findUnique({ where: { setting_key: SCRAP_KEY } }))?.setting_value;
  await prisma.sysSetting.upsert({ where: { setting_key: SCRAP_KEY }, update: { setting_value: String(f.scrapAcc) }, create: { setting_key: SCRAP_KEY, setting_value: String(f.scrapAcc), updated_by: f.actor } });
  const s = await sourceOf("log_stock_issue", "SI-MV");
  bucket = await prisma.$transaction(async (tx) => {
    const { cost } = await issueStock(tx, { itemId: f.material, warehouseId: f.warehouse, lotId: f.lot, baseQty: 400, date, source: s, actorId: f.actor });
    return (await enterProduction(tx, { lotId: f.lot, itemId: f.material, workstationId: f.wsA, baseQty: 400, value: cost, date, source: s, actorId: f.actor })).bucketId;
  });
});

after(async () => {
  await prisma.prdTransfer.deleteMany({ where: { id: { in: transfers } } });
  await prisma.prdRelease.deleteMany({ where: { id: { in: releases } } });
  await prisma.auditLog.deleteMany({ where: { OR: [{ entity_key: "prd_transfer", row_id: { in: transfers } }, { entity_key: "prd_release", row_id: { in: releases } }] } });
  if (savedScrap === undefined) await prisma.sysSetting.deleteMany({ where: { setting_key: SCRAP_KEY } });
  else await prisma.sysSetting.update({ where: { setting_key: SCRAP_KEY }, data: { setting_value: savedScrap } });
  await f.teardown();
  await cleanupFixtures();
  await cleanupFiscalYear();
  await disconnect();
});

describe("Production Transfer (R7)", () => {
  test("the destination differs from the origin, and lines are lots held at the origin", async () => {
    const r = await createTransfer(transfer({ to_workstation_id: f.wsA }), f.actor);
    assert.ok(!r.ok && /berbeda/.test(r.errors.to_workstation_id));
  });

  test("posting moves the lot directly, value kept, no journal", async () => {
    const r = await createTransfer(transfer(), f.actor);
    assert.ok(r.ok, JSON.stringify(r));
    transfers.push(r.id);
    assert.ok((await transitionTransfer(r.id, "post", f.actor)).ok);
    const v = (await getTransfer(r.id))!;
    assert.equal(v.status, "Posted");
    assert.equal(v.value, 250_000);
    const at = async (ws: number) => (await prisma.prdBalance.findUniqueOrThrow({ where: { tracking_id_workstation_id: { tracking_id: f.lot, workstation_id: ws } } })).value_balance.toNumber();
    assert.deepEqual([await at(f.wsA), await at(f.wsB)], [150_000, 250_000]);
    assert.equal(await prisma.accJournal.count({ where: { source_doc_id: r.id, source_doc_type: { doc_table: "prd_transfer" } } }), 0);
  });
});

describe("Production Release (R8)", () => {
  test("to a warehouse: the same lot comes back into stock at the value it carried; Dr Persediaan / Cr WIP", async () => {
    const b = await prisma.prdBalance.findUniqueOrThrow({ where: { tracking_id_workstation_id: { tracking_id: f.lot, workstation_id: f.wsB } } });
    const r = await createRelease(release({ lines: [{ bucket_id: b.id, qty: "100" }] }), f.actor);
    assert.ok(r.ok, JSON.stringify(r));
    releases.push(r.id);
    assert.match(r.no, /^PHP\//);
    const preview = await releasePreview(r.id, f.actor);
    assert.ok(preview.ok, JSON.stringify(preview));
    assert.ok((await transitionRelease(r.id, "post", f.actor)).ok);
    const v = (await getRelease(r.id))!;
    assert.equal(v.value, 100_000);
    const lines = await prisma.accJournalLine.findMany({ where: { journal_id: v.journalId! }, orderBy: { sequence_no: "asc" } });
    assert.deepEqual(lines.map((l) => [l.account_id, l.debit_amount.toNumber(), l.kredit_amount.toNumber()]), [[f.inventoryAcc, 100_000, 0], [f.wipAcc, 0, 100_000]]);
    const stock = await prisma.logStockBalance.findFirstOrThrow({ where: { tracking_id: f.lot, warehouse_id: f.warehouse } });
    assert.equal(stock.qty_balance.toNumber(), 700, "600 left after the issue, 100 back under the same lot");
  });

  test("Pemusnahan needs a reason and writes Dr Beban Pemusnahan / Cr WIP", async () => {
    const b = await prisma.prdBalance.findUniqueOrThrow({ where: { tracking_id_workstation_id: { tracking_id: f.lot, workstation_id: f.wsA } } });
    const bare = await createRelease(release({ purpose: "scrap", workstation_id: f.wsA, warehouse_id: null, lines: [{ bucket_id: b.id, qty: "150" }] }), f.actor);
    assert.ok(!bare.ok && /Alasan/.test(bare.errors.scrap_reason));
    const r = await createRelease(release({ purpose: "scrap", workstation_id: f.wsA, warehouse_id: null, scrap_reason: "rusak", lines: [{ bucket_id: b.id, qty: "150" }] }), f.actor);
    assert.ok(r.ok, JSON.stringify(r));
    releases.push(r.id);
    assert.match(r.no, /^PMS\//);
    assert.ok((await transitionRelease(r.id, "post", f.actor)).ok);
    const v = (await getRelease(r.id))!;
    const lines = await prisma.accJournalLine.findMany({ where: { journal_id: v.journalId! }, orderBy: { sequence_no: "asc" } });
    assert.deepEqual(lines.map((l) => [l.account_id, l.debit_amount.toNumber(), l.kredit_amount.toNumber()]), [[f.scrapAcc, 150_000, 0], [f.wipAcc, 0, 150_000]]);
    const emptied = await prisma.prdBalance.findUniqueOrThrow({ where: { id: b.id } });
    assert.deepEqual([emptied.qty_balance.toNumber(), emptied.value_balance.toNumber()], [0, 0]);
  });
});
