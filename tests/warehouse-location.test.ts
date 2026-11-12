import test, { after, before, describe } from "node:test";
import assert from "node:assert/strict";

import { InventoryRefusal, issueStock, lotOptions, receiveStock, warehouseLocationOptions } from "../src/lib/erp/inventory";
import { stockBalanceReport, stockBooksReconcile, stockLedgerReport } from "../src/lib/erp/stock-report";
import { checkWarehouseLocation, locationDeactivateRefusal } from "../src/lib/erp/warehouse";
import { FIXTURE_PREFIX, cleanupStock, disconnect, prisma, systemUserId } from "./helpers";

/**
 * Warehouse locations (P136, P267): a warehouse that has any location names
 * one of its own on every stock movement, any other names none; the bucket is
 * warehouse · location · lot · status, one bucket per lot where there is no
 * location; a lot may sit in two locations and is picked from each; the
 * Lokasi Gudang master refuses a first location in a stocked warehouse and a
 * deactivation that would strand stock.
 */

let actor = 0;
const f = {} as Record<string, number>;
const stamp = String(Date.now() % 100000);
const key = (s: string) => `${FIXTURE_PREFIX}${s}${stamp}`;
const day = (iso: string) => new Date(`${iso}T00:00:00Z`);
let src = { docTypeId: 0, docId: 0, no: "" };

before(async () => {
  actor = await systemUserId();
  f.pcs = (await prisma.refUom.create({ data: { uom_code: `test.${key("PCS")}`, uom_label: key("PCS"), uom_name: "Pcs", created_by: actor } })).id;
  const cat = (await prisma.sysItemCategory.findUniqueOrThrow({ where: { category_label: "BRG-JADI" } })).id;
  f.item = (
    await prisma.mItem.create({
      data: {
        item_code: `test.${key("IT")}`,
        item_label: key("IT"),
        item_name: "Item berlokasi",
        item_type: "Barang",
        category_id: cat,
        base_uom_id: f.pcs,
        track_stock: true,
        created_by: actor,
      },
    })
  ).id;
  const wh = async (l: string) =>
    (await prisma.refWarehouse.create({ data: { warehouse_code: `test.${key(l)}`, warehouse_label: key(l), warehouse_name: l, created_by: actor } })).id;
  f.plain = await wh("PL");
  f.loc = await wh("LC");
  f.other = await wh("OT");
  f.idle = await wh("ID");
  const location = async (warehouse_id: number, label: string, status: "Active" | "Inactive" = "Active") =>
    (
      await prisma.refWarehouseLocation.create({
        data: { warehouse_id, location_code: `test.${key(label)}`, location_label: label, location_name: `Rak ${label}`, status, created_by: actor },
      })
    ).id;
  f.a01 = await location(f.loc, "A-01");
  f.a02 = await location(f.loc, "A-02");
  f.off = await location(f.loc, "Z-99", "Inactive");
  f.elsewhere = await location(f.other, "B-01");
  f.idleLoc = await location(f.idle, "C-01", "Inactive");
  const type = await prisma.sysDocType.findFirstOrThrow({ where: { doc_table: "log_stock_injection" } });
  src = { docTypeId: type.id, docId: 800_000 + Number(stamp), no: key("SRC") };
});

after(async () => {
  await cleanupStock([f.item]);
  await prisma.mItem.deleteMany({ where: { id: f.item } });
  await prisma.refWarehouseLocation.deleteMany({ where: { warehouse_id: { in: [f.plain, f.loc, f.other, f.idle] } } });
  await prisma.refWarehouse.deleteMany({ where: { id: { in: [f.plain, f.loc, f.other, f.idle] } } });
  await prisma.refUom.deleteMany({ where: { id: f.pcs } });
  await disconnect();
});

const receive = (warehouseId: number, locationId: number | null, lot: string, qty: number, value: number, date = "2026-09-01") =>
  prisma.$transaction((tx) =>
    receiveStock(tx, { itemId: f.item, warehouseId, locationId, lotNo: key(lot), expiry: null, baseQty: qty, value, date: day(date), source: src, actorId: actor })
  );
const issue = (warehouseId: number, locationId: number | null, lotId: number, qty: number) =>
  prisma.$transaction((tx) => issueStock(tx, { itemId: f.item, warehouseId, locationId, lotId, baseQty: qty, date: day("2026-10-01"), source: src, actorId: actor }));

describe("the inventory book keeps the location rule", () => {
  test("a warehouse with locations needs one of its own active locations; any other takes none", async () => {
    await assert.rejects(receive(f.loc, null, "L1", 1, 100), /memakai lokasi: pilih lokasinya/);
    await assert.rejects(receive(f.plain, f.a01, "L1", 1, 100), /tidak memakai lokasi/);
    await assert.rejects(receive(f.loc, f.elsewhere, "L1", 1, 100), /Lokasi tidak ada di gudang/);
    await assert.rejects(receive(f.loc, f.off, "L1", 1, 100), (e) => e instanceof InventoryRefusal && /nonaktif/.test(e.message));
    assert.equal(await prisma.logStockLedger.count({ where: { item_id: f.item } }), 0, "nothing written");
  });

  test("a warehouse whose locations are all inactive still has locations: nothing comes in until one is active", async () => {
    await assert.rejects(receive(f.idle, null, "L9", 1, 100), /pilih lokasinya/);
    await assert.rejects(receive(f.idle, f.idleLoc, "L9", 1, 100), /nonaktif/);
  });

  test("one lot in two locations is two buckets; without locations one lot is one bucket", async () => {
    f.lot = (await receive(f.loc, f.a01, "L1", 10, 1_000)).trackingId;
    await receive(f.loc, f.a02, "L1", 5, 500);
    await receive(f.plain, null, "L1", 3, 300);
    await receive(f.plain, null, "L1", 2, 200, "2026-09-02");
    const buckets = await prisma.logStockBalance.findMany({ where: { item_id: f.item }, orderBy: { id: "asc" } });
    assert.deepEqual(
      buckets.map((b) => [b.warehouse_id, b.location_id, b.qty_balance.toNumber()]),
      [
        [f.loc, f.a01, 10],
        [f.loc, f.a02, 5],
        [f.plain, null, 5],
      ],
      "the two plain receipts share one null-location bucket"
    );
    const rows = await prisma.logStockLedger.findMany({ where: { item_id: f.item }, orderBy: { id: "asc" } });
    assert.deepEqual(rows.map((r) => r.location_id), [f.a01, f.a02, null, null]);
  });

  test("an issue leaves from its location, and short stock names the location", async () => {
    await issue(f.loc, f.a01, f.lot, 6);
    await assert.rejects(issue(f.loc, f.a01, f.lot, 5), new RegExp(`lokasi ${key("LC")}-A-01 tidak cukup: tersedia 4, diminta 5`));
    await assert.rejects(issue(f.loc, null, f.lot, 1), /pilih lokasinya/);
    assert.ok(await stockBooksReconcile([f.item]));
  });

  test("a picker sees each lot in each location, shown <gudang>-<lokasi>", async () => {
    f.tersedia = (await prisma.sysStockStatus.findUniqueOrThrow({ where: { status_label: "TERSEDIA" } })).id;
    const lots = await lotOptions([f.item], [f.loc, f.plain]);
    assert.deepEqual(
      lots.get(f.loc)?.get(f.item)?.map((l) => [l.key, l.locationLabel, l.available]),
      [
        [`${f.lot}:${f.a01}:${f.tersedia}`, `${key("LC")}-A-01`, 4],
        [`${f.lot}:${f.a02}:${f.tersedia}`, `${key("LC")}-A-02`, 5],
      ]
    );
    assert.deepEqual(lots.get(f.plain)?.get(f.item)?.map((l) => [l.locationId, l.available]), [[null, 5]]);
    const options = await warehouseLocationOptions([f.loc, f.plain]);
    assert.deepEqual(options.get(f.loc)?.map((o) => [o.label, o.active]), [
      [`${key("LC")}-A-01`, true],
      [`${key("LC")}-A-02`, true],
      [`${key("LC")}-Z-99`, false],
    ]);
    assert.equal(options.get(f.plain), undefined, "a warehouse without locations has none");
  });
});

describe("the reports show Gudang and Lokasi apart", () => {
  test("Saldo Stok buckets carry the location's own label", async () => {
    const positions = await stockBalanceReport("2099-12-31", [f.item], [f.loc]);
    assert.deepEqual(
      positions.map((p) => [p.warehouse.label, p.qty, p.lots.map((l) => [l.locationLabel, l.qty])]),
      [[key("LC"), 9, [["A-01", 4], ["A-02", 5]]]]
    );
  });

  test("Kartu Stok movements carry their location; the running balance stays per item × warehouse", async () => {
    const [card] = await stockLedgerReport([f.item], [f.loc], { from: "2026-09-01", to: "2026-10-31" });
    assert.deepEqual(card.entries.map((e) => [e.locationLabel, e.qtyIn, e.qtyOut, e.balance]), [
      ["A-01", 10, 0, 10],
      ["A-02", 5, 0, 15],
      ["A-01", 0, 6, 9],
    ]);
  });
});

describe("the Lokasi Gudang master guards the books", () => {
  const values = (warehouse_id: number, location_label: string, status = "Active") => ({ warehouse_id, location_label, location_name: "Rak", status });

  test("the first location of a warehouse waits until the warehouse holds no stock", async () => {
    const errors = await checkWarehouseLocation(values(f.plain, "A-01"), null);
    assert.match(errors.warehouse_id ?? "", /lokasi pertama hanya bisa ditambahkan saat gudang kosong/);
    assert.deepEqual(await checkWarehouseLocation(values(f.loc, "A-03"), null), {}, "a warehouse that already has locations takes another");
  });

  test("a location holding stock is not deactivated; an empty one may be", async () => {
    const errors = await checkWarehouseLocation(values(f.loc, "A-01", "Inactive"), f.a01);
    assert.match(errors.status ?? "", /masih menyimpan stok/);
    assert.match((await locationDeactivateRefusal(f.a01)) ?? "", /masih menyimpan stok/);
    assert.equal(await locationDeactivateRefusal(f.off), null);
  });

  test("a label has no spaces", async () => {
    assert.match((await checkWarehouseLocation(values(f.loc, "A 01"), null)).location_label ?? "", /tanpa spasi/);
  });
});
