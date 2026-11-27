import test, { after, before, describe } from "node:test";
import assert from "node:assert/strict";

import { cancelStockReceipt, createStockReceipt, getStockReceipt, receiveStockReceipt, stockReceiptPreview, updateStockReceipt, type StockReceiptInput } from "../src/lib/erp/stock-receipt";
import { cleanupFiscalYear, cleanupFixtures, disconnect, openFiscalYear, prisma } from "./helpers";
import { makeProductionFixture, type ProductionFixture } from "./production-helpers";

/**
 * Penerimaan Lain-lain (P339): a Stock Receipt with no source, its lines and
 * value typed and a reason required. A Draft moves nothing and is cancelled with
 * a reason; Posting brings each new No. Stok in at its typed value with
 * Dr Persediaan / Cr Penerimaan Persediaan Lain-lain, refused without the mapping.
 */

const today = new Date().toISOString().slice(0, 10);
const KEY = "stock_other_receipt_account";
let f: ProductionFixture;
const ids: number[] = [];
let saved: string | null | undefined;

const input = (over: Partial<StockReceiptInput> = {}): StockReceiptInput => ({
  purpose: "other_receipt",
  warehouse_id: f.warehouse,
  source_id: null,
  receipt_date: today,
  note: "Barang titipan diserahkan",
  rows: [{ item_id: f.material, tracking_no: f.key("LL1"), expiry_date: null, base_qty: "4", value: "1000" }],
  ...over,
});
async function create(i: StockReceiptInput) {
  const r = await createStockReceipt(i, f.actor);
  if (r.ok) ids.push(r.id);
  return r;
}
const map = (value: string | null) => prisma.sysSetting.upsert({ where: { setting_key: KEY }, update: { setting_value: value }, create: { setting_key: KEY, setting_value: value, updated_by: f.actor } });

before(async () => {
  await openFiscalYear();
  f = await makeProductionFixture("SRL");
  saved = (await prisma.sysSetting.findUnique({ where: { setting_key: KEY } }))?.setting_value;
});

after(async () => {
  if (saved === undefined) await prisma.sysSetting.deleteMany({ where: { setting_key: KEY } });
  else await map(saved);
  const journals = (await prisma.logStockReceipt.findMany({ where: { id: { in: ids } } })).flatMap((r) => (r.journal_id ? [r.journal_id] : []));
  await prisma.logStockReceiptTracking.deleteMany({ where: { line: { stock_receipt_id: { in: ids } } } });
  await prisma.logStockReceiptLine.deleteMany({ where: { stock_receipt_id: { in: ids } } });
  await prisma.logStockReceipt.deleteMany({ where: { id: { in: ids } } });
  await prisma.accJournalLine.deleteMany({ where: { journal_id: { in: journals } } });
  await prisma.accJournal.deleteMany({ where: { id: { in: journals } } });
  await prisma.auditLog.deleteMany({ where: { entity_key: "log_stock_receipt", row_id: { in: ids } } });
  await f.teardown();
  await cleanupFixtures();
  await cleanupFiscalYear();
  await disconnect();
});

describe("Penerimaan Lain-lain (P339)", () => {
  test("a reason, a new No. Stok and whole rupiah are required", async () => {
    const r = await create(input({ note: "", rows: [{ item_id: f.material, tracking_no: "", base_qty: "0", value: "1.5" }] }));
    assert.ok(!r.ok);
    if (!r.ok) {
      assert.match(r.errors.note, /Alasan/);
      assert.match(r.errors["rows.0.tracking_no"], /No. Stok/);
      assert.match(r.errors["rows.0.base_qty"], /lebih dari 0/);
      assert.match(r.errors["rows.0.value"], /rupiah utuh/);
    }
    const lot = await prisma.logStockTracking.findUniqueOrThrow({ where: { id: f.lot } });
    const known = await create(input({ rows: [{ item_id: f.material, tracking_no: lot.tracking_no, base_qty: "1", value: "0" }] }));
    assert.ok(!known.ok && /sudah ada/.test(known.errors["rows.0.tracking_no"]), "a receipt brings a new No. Stok (W10)");
  });

  test("a Draft moves nothing and is cancelled with a reason", async () => {
    const r = await create(input({ rows: [{ item_id: f.material, tracking_no: f.key("LL0"), base_qty: "1", value: "10" }] }));
    assert.ok(r.ok, JSON.stringify(r));
    if (!r.ok) return;
    assert.match(r.no, /^SRC\/\d{4}\/\d{2}\/\d{4}$/);
    assert.ok((await updateStockReceipt(r.id, input({ rows: [{ item_id: f.material, tracking_no: f.key("LL0"), base_qty: "2", value: "20" }] }), f.actor)).ok);
    assert.equal((await getStockReceipt(r.id))!.cost, 20);
    assert.ok(!(await cancelStockReceipt(r.id, "", f.actor)).ok, "a reason is required");
    assert.ok((await cancelStockReceipt(r.id, "salah input", f.actor)).ok);
    const v = (await getStockReceipt(r.id))!;
    assert.deepEqual([v.status, v.statusReason], ["Cancelled", "salah input"]);
    assert.equal(await prisma.logStockTracking.count({ where: { tracking_no: f.key("LL0").toUpperCase() } }), 0, "nothing came into stock");
    assert.ok(!(await receiveStockReceipt(r.id, f.actor)).ok, "final");
  });

  test("Posting brings each No. Stok in at its typed value, Dr Persediaan / Cr Penerimaan Persediaan Lain-lain", async () => {
    const r = await create(input());
    assert.ok(r.ok, JSON.stringify(r));
    if (!r.ok) return;
    await map(null);
    const unmapped = await receiveStockReceipt(r.id, f.actor);
    assert.ok(!unmapped.ok && /Account Mapping/.test(unmapped.errors._form));
    await map(String(f.scrapAcc));
    const preview = await stockReceiptPreview(r.id, f.actor);
    assert.ok(preview.ok, JSON.stringify(preview));
    assert.equal((await getStockReceipt(r.id))!.status, "Draft", "a dry run writes nothing");
    const done = await receiveStockReceipt(r.id, f.actor);
    assert.ok(done.ok, JSON.stringify(done));
    const v = (await getStockReceipt(r.id))!;
    assert.deepEqual([v.status, v.cost], ["Posted", 1000]);
    const lines = await prisma.accJournalLine.findMany({ where: { journal_id: v.journalId! }, orderBy: { sequence_no: "asc" } });
    assert.deepEqual(lines.map((l) => [l.account_id, l.debit_amount.toNumber(), l.kredit_amount.toNumber()]), [[f.inventoryAcc, 1000, 0], [f.scrapAcc, 0, 1000]]);
    const lot = await prisma.logStockTracking.findUniqueOrThrow({ where: { tracking_no: f.key("LL1").toUpperCase() } });
    const stock = await prisma.logStockBalance.findFirstOrThrow({ where: { warehouse_id: f.warehouse, tracking_id: lot.id } });
    assert.equal(stock.qty_balance.toNumber(), 4);
    assert.ok(!(await cancelStockReceipt(r.id, "x", f.actor)).ok, "final");
  });
});
