import test, { after, before, describe } from "node:test";
import assert from "node:assert/strict";

import { InventoryRefusal, injectStock, issueStock, lotOptions } from "../src/lib/erp/inventory";
import {
  stockBalanceReport,
  stockBooksReconcile,
  stockLedgerReport,
  valuationLedgerReport,
  valuationReport,
} from "../src/lib/erp/stock-report";
import { FIXTURE_PREFIX, cleanupStock, disconnect, prisma, stockIn, systemUserId } from "./helpers";

/**
 * The stock books (P120) on the moving-average design of P114: quantity per
 * warehouse / lot / status and value per item's pool, written side by side.
 * What a receipt and an issue write; that an issue releases round(V × q ÷ Q)
 * and the emptying one V whole; that no stock goes negative; that lots are
 * per item; that only an item with Kelola Stok enters; and that the reports
 * read the ledgers as of a date.
 */

let actor = 0;
const f = {} as Record<string, number>;
const stamp = String(Date.now() % 100000);
const key = (s: string) => `${FIXTURE_PREFIX}${s}${stamp}`;
const day = (iso: string) => new Date(`${iso}T00:00:00Z`);
// A source no other suite uses: a fixture "document" of the injection type.
let src = { docTypeId: 0, docId: 0, no: "" };

before(async () => {
  actor = await systemUserId();
  f.pcs = (await prisma.refUom.create({ data: { uom_code: `test.${key("PCS")}`, uom_label: key("PCS"), uom_name: "Pcs", created_by: actor } })).id;
  const cat = (await prisma.sysItemCategory.findUniqueOrThrow({ where: { category_label: "BRG-JADI" } })).id;
  const item = async (l: string, track: boolean, expiry = false) =>
    (
      await prisma.mItem.create({
        data: {
          item_code: `test.${key(l)}`,
          item_label: key(l),
          item_name: l,
          item_type: "Barang",
          category_id: cat,
          base_uom_id: f.pcs,
          track_stock: track,
          has_expiry: expiry,
          created_by: actor,
        },
      })
    ).id;
  f.a = await item("A", true);
  f.b = await item("B", true, true);
  f.plain = await item("PLAIN", false);
  const wh = async (l: string) =>
    (await prisma.refWarehouse.create({ data: { warehouse_code: `test.${key(l)}`, warehouse_label: key(l), warehouse_name: l, created_by: actor } })).id;
  f.w1 = await wh("W1");
  f.w2 = await wh("W2");
  const type = await prisma.sysDocType.findFirstOrThrow({ where: { doc_table: "log_stock_injection" } });
  src = { docTypeId: type.id, docId: 900_000 + Number(stamp), no: key("SRC") };
});

after(async () => {
  await cleanupStock([f.a, f.b, f.plain]);
  await prisma.mItem.deleteMany({ where: { id: { in: [f.a, f.b, f.plain] } } });
  await prisma.refWarehouse.deleteMany({ where: { id: { in: [f.w1, f.w2] } } });
  await prisma.refUom.deleteMany({ where: { id: f.pcs } });
  await disconnect();
});

const pool = async (item: number) => {
  const p = await prisma.logStockValuationBalance.findUniqueOrThrow({ where: { item_id: item } });
  return [p.qty_balance.toNumber(), p.value_balance.toNumber(), p.avg_unit_cost.toNumber()];
};
const issue = (item: number, wh: number, lot: number, qty: number, date = "2026-10-01") =>
  prisma.$transaction((tx) => issueStock(tx, { itemId: item, warehouseId: wh, lotId: lot, baseQty: qty, date: day(date), source: src, actorId: actor }));

describe("a receipt adds its own quantity and value", () => {
  test("into its lot, warehouse and status, and into the item's pool", async () => {
    f.lotA1 = await stockIn(f.a, f.w1, key("A1"), 10, 100_000, null, "2026-09-01");
    f.lotA2 = await stockIn(f.a, f.w2, key("A2"), 20, 260_000, null, "2026-09-02");
    assert.deepEqual(await pool(f.a), [30, 360_000, 12_000]);
    const buckets = await prisma.logStockBalance.findMany({ where: { item_id: f.a }, orderBy: { warehouse_id: "asc" } });
    assert.deepEqual(
      buckets.map((b) => [b.warehouse_id, b.tracking_id, b.qty_balance.toNumber()]),
      [
        [f.w1, f.lotA1, 10],
        [f.w2, f.lotA2, 20],
      ]
    );
    const status = await prisma.sysStockStatus.findUniqueOrThrow({ where: { status_label: "TERSEDIA" } });
    assert.ok(buckets.every((b) => b.stock_status_id === status.id), "received as Tersedia");
  });

  test("a lot is unique per item: the same number adds to it, another item may reuse it", async () => {
    await stockIn(f.a, f.w1, key("A1"), 5, 50_000, null, "2026-09-15");
    assert.equal(await prisma.logStockTracking.count({ where: { item_id: f.a, tracking_no: key("A1") } }), 1);
    const reused = await stockIn(f.b, f.w1, key("A1"), 1, 1_000, "2030-01-31");
    assert.notEqual(reused, f.lotA1, "B's A1 is its own lot");
    assert.deepEqual(await pool(f.a), [35, 410_000, 11_714.285714]);
  });

  test("an item with Memiliki Kadaluarsa needs its expiry, and a known lot keeps the one it has", async () => {
    await assert.rejects(stockIn(f.b, f.w1, key("B1"), 1, 1_000), /kadaluarsa/);
    await assert.rejects(stockIn(f.b, f.w1, key("A1"), 1, 1_000, "2031-01-31"), /sudah tercatat dengan kadaluarsa 2030-01-31/);
  });

  test("an item without Kelola Stok never enters the books; a value is whole rupiah", async () => {
    await assert.rejects(stockIn(f.plain, f.w1, key("P1"), 1, 1_000), /tidak dikelola stok/);
    await assert.rejects(stockIn(f.a, f.w1, key("A1"), 1, 1_000.5), /rupiah utuh/);
    await assert.rejects(stockIn(f.a, f.w1, key("A1"), 0, 0), /lebih dari 0/);
  });
});

describe("an issue releases from the pool at its moving average (P114)", () => {
  test("round(V × q ÷ Q), the remainder staying in the pool", async () => {
    // Pool 35 worth 410.000: 3 release round(35.142,857…) = 35.143.
    const out = await issue(f.a, f.w1, f.lotA1, 3);
    assert.deepEqual(out, { unitCost: 11_714.333333, cost: 35_143 });
    assert.deepEqual(await pool(f.a), [32, 374_857, 11_714.28125]);
  });

  test("short stock in the lot and warehouse is refused, naming both figures, and writes nothing", async () => {
    const before = await prisma.logStockLedger.count({ where: { item_id: f.a } });
    await assert.rejects(issue(f.a, f.w1, f.lotA1, 13), /tidak cukup: tersedia 12, diminta 13/);
    await assert.rejects(issue(f.a, f.w1, f.lotA2, 1), /tidak cukup: tersedia 0/, "A2 is in the other warehouse");
    await assert.rejects(issue(f.plain, f.w1, f.lotA1, 1), (e) => e instanceof InventoryRefusal && /tidak dikelola stok/.test(e.message));
    assert.equal(await prisma.logStockLedger.count({ where: { item_id: f.a } }), before);
  });

  test("the issue that empties the pool releases V whole, leaving 0 / 0", async () => {
    await issue(f.a, f.w1, f.lotA1, 12);
    const left = await pool(f.a);
    const out = await issue(f.a, f.w2, f.lotA2, 20);
    assert.equal(out.cost, left[1], "everything left, not round(V × 20 ÷ 20) by a separate route");
    assert.deepEqual(await pool(f.a), [0, 0, 0]);
    assert.ok(await stockBooksReconcile(f.a), "both balances equal their ledgers");
  });

  test("each movement writes one row to each book, sharing the posting's ledger numbers", async () => {
    const q = await prisma.logStockLedger.findMany({ where: { item_id: f.a, source_doc_id: src.docId, source_doc_type_id: src.docTypeId }, orderBy: { id: "asc" } });
    const v = await prisma.logStockValuationLedger.findMany({ where: { item_id: f.a, source_doc_id: src.docId, source_doc_type_id: src.docTypeId }, orderBy: { id: "asc" } });
    assert.equal(q.length, 3);
    assert.deepEqual(q.map((r) => r.value_change.toNumber()), v.map((r) => r.value_change.toNumber()));
    assert.equal(new Set(q.map((r) => r.ledger_no)).size, 1);
    assert.equal(new Set(v.map((r) => r.ledger_no)).size, 1);
    assert.deepEqual(q.map((r) => r.line_no), [1, 2, 3]);
  });
});

describe("injection (db:stock-inject)", () => {
  test("one run is one source numbered INJ/…, all or nothing", async () => {
    const before = await prisma.logStockLedger.count();
    await assert.rejects(
      injectStock(
        [
          { itemId: f.a, warehouseId: f.w1, lotNo: key("X1"), expiry: null, qty: "1", value: "100", date: day("2026-10-02") },
          { itemId: f.plain, warehouseId: f.w1, lotNo: key("X2"), expiry: null, qty: "1", value: "100", date: day("2026-10-02") },
        ],
        actor
      ),
      /Baris 2: .*tidak dikelola stok/
    );
    assert.equal(await prisma.logStockLedger.count(), before, "the first row was rolled back with the second");
    const run = await injectStock(
      [{ itemId: f.a, warehouseId: f.w1, lotNo: key("X1"), expiry: null, qty: "4", value: "48000", date: day("2026-10-02") }],
      actor
    );
    assert.match(run.no, /^INJ\/\d{4}\/\d{2}\/\d{4}$/);
    const lot = await prisma.logStockTracking.findFirstOrThrow({ where: { item_id: f.a, tracking_no: key("X1") } });
    assert.deepEqual([lot.source_no, lot.source_doc_id], [run.no, run.docId]);
  });

  test("a picker sees the lots with stock in each warehouse, with what they hold", async () => {
    const lots = await lotOptions([f.a], [f.w1, f.w2]);
    assert.deepEqual(lots.get(f.w1)?.get(f.a)?.map((l) => [l.lotNo, l.available]), [[key("X1"), 4]]);
    assert.equal(lots.get(f.w2), undefined, "an emptied lot is not offered");
  });
});

describe("the reports read the ledgers as of a date", () => {
  test("Kartu Stok: opening, movements in date order with a running balance, closing", async () => {
    const r = (await stockLedgerReport(f.a, f.w1, { from: "2026-09-16", to: "2026-10-31" }))!;
    // Opening: the 10 received on 01/09 and the 5 on 15/09, in W1.
    assert.equal(r.opening, 15);
    assert.deepEqual(r.entries.map((e) => [e.date, e.qtyIn, e.qtyOut, e.balance]), [
      ["2026-10-01", 0, 3, 12],
      ["2026-10-01", 0, 12, 0],
      ["2026-10-02", 4, 0, 4],
    ]);
    assert.equal(r.closing, 4);
  });

  test("Saldo Stok and Nilai Persediaan as of a past date", async () => {
    const past = await stockBalanceReport("2026-09-30", f.a, null);
    assert.deepEqual(past.map((b) => [b.warehouseLabel, b.lotNo, b.qty]), [
      [key("W1"), key("A1"), 15],
      [key("W2"), key("A2"), 20],
    ]);
    const value = await valuationReport("2026-09-30", f.a);
    assert.deepEqual(value.map((v) => [v.qty, v.value, v.average]), [[35, 410_000, 11_714.285714]]);
    const card = (await valuationLedgerReport(f.a, { from: "2026-10-01", to: "2026-10-01" }))!;
    assert.equal(card.openingValue, 410_000);
    assert.equal(card.entries.length, 3);
  });
});
