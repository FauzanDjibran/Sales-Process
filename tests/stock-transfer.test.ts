import test, { after, before, describe } from "node:test";
import assert from "node:assert/strict";

import { actorOf, cleanup, cleanupFiscalYear, cleanupStock, disconnect, FIXTURE_PREFIX, makeUser, openFiscalYear, prisma, stockIn, systemUserId } from "./helpers";
import { isAccessDenied } from "../src/lib/erp/auth-errors";
import { assertWarehouse, setUserWarehouses, warehouseIdsOf } from "../src/lib/erp/warehouse-access";
import { checkSystemDefaultValue, transitChangeRefusal, transitWarehouseId } from "../src/lib/erp/system-settings";
import { checkWarehouseLocation, warehouseDeactivateRefusal } from "../src/lib/erp/warehouse";
import { stockIssueOptions } from "../src/lib/erp/stock-issue";
import {
  createStockTransfer,
  getStockTransfer,
  listStockTransfers,
  stockTransferOptions,
  transitionStockTransfer,
  updateStockTransfer,
  type StockTransferHeaderInput,
  type StockTransferLineInput,
} from "../src/lib/erp/stock-transfer";
import {
  createTransferReceipt,
  getTransferReceipt,
  listTransferReceipts,
  transferReceiptSources,
  transitionTransferReceipt,
  type TransferReceiptLineInput,
} from "../src/lib/erp/stock-transfer-receipt";

/**
 * Stock transfer through the Gudang Transit (P300, Stock-Transfer-Plan.md):
 * the user ↔ warehouse assignment (OD-9), the transit setting and its rules on
 * other documents (A2, A4), Transfer Kirim (stock to transit, short stock
 * refused, the moving average unchanged) and Transfer Terima (in parts, never
 * beyond what was sent, never before the Kirim, the Kirim Diterima once full).
 */

const today = new Date().toISOString().slice(0, 10);
const stamp = String(Date.now() % 100000);
const key = (s: string) => `${FIXTURE_PREFIX}TRF${s}${stamp}`;
const f = {} as Record<string, number>;
const transferIds: number[] = [];
const receiptIds: number[] = [];
let previousTransit: string | null = null;
let tersedia = 0;
let karantina = 0;

const pool = async () => {
  const p = await prisma.logStockValuationBalance.findUniqueOrThrow({ where: { item_id: f.item } });
  return [p.qty_balance.toNumber(), p.value_balance.toNumber()];
};
const held = async (warehouseId: number) =>
  (await prisma.logStockBalance.aggregate({ where: { item_id: f.item, warehouse_id: warehouseId }, _sum: { qty_balance: true } }))._sum.qty_balance?.toNumber() ?? 0;

const header = (over: Partial<StockTransferHeaderInput> = {}): StockTransferHeaderInput => ({
  transfer_date: today,
  from_warehouse_id: f.wA,
  to_warehouse_id: f.wB,
  vehicle_no: "B 1234 XY",
  driver_name: "Budi",
  note: "",
  ...over,
});
const line = (qty: number, picks: { lot: number; qty: number; status?: number }[]): StockTransferLineInput => ({
  item_id: f.item,
  qty,
  note: "",
  picks: picks.map((p) => ({ tracking_id: p.lot, location_id: null, stock_status_id: p.status ?? tersedia, qty: p.qty })),
});

before(async () => {
  await openFiscalYear();
  f.actor = await systemUserId();
  tersedia = (await prisma.sysStockStatus.findUniqueOrThrow({ where: { status_label: "TERSEDIA" } })).id;
  karantina = (await prisma.sysStockStatus.findUniqueOrThrow({ where: { status_label: "KARANTINA" } })).id;
  f.pcs = (await prisma.refUom.create({ data: { uom_code: `test.${key("U")}`, uom_label: key("U"), uom_name: "Pcs", created_by: f.actor } })).id;
  const cat = (await prisma.sysItemCategory.findUniqueOrThrow({ where: { category_label: "BRG-JADI" } })).id;
  f.item = (
    await prisma.mItem.create({
      data: { item_code: `test.${key("I")}`, item_label: key("I"), item_name: "Barang Transfer", item_type: "Barang", category_id: cat, base_uom_id: f.pcs, track_stock: true, created_by: f.actor },
    })
  ).id;
  const wh = async (l: string) => (await prisma.refWarehouse.create({ data: { warehouse_code: `test.${key(l)}`, warehouse_label: key(l), warehouse_name: l, created_by: f.actor } })).id;
  f.wA = await wh("A");
  f.wB = await wh("B");
  f.wT = await wh("T");
  f.wL = await wh("L");
  f.locB = (await prisma.refWarehouseLocation.create({ data: { warehouse_id: f.wB, location_code: `test.${key("LB")}`, location_label: "R1", location_name: "Rak 1", created_by: f.actor } })).id;
  f.locL = (await prisma.refWarehouseLocation.create({ data: { warehouse_id: f.wL, location_code: `test.${key("LL")}`, location_label: "R1", location_name: "Rak 1", created_by: f.actor } })).id;
  previousTransit = (await prisma.sysSetting.findUnique({ where: { setting_key: "transit_warehouse" } }))?.setting_value ?? null;
  await prisma.sysSetting.upsert({ where: { setting_key: "transit_warehouse" }, update: { setting_value: String(f.wT) }, create: { setting_key: "transit_warehouse", setting_value: String(f.wT) } });
  // 100 pcs at 1.000 = Rp 100.000, and 7 pcs at Rp 9.001 in a second lot: an average that does not divide evenly.
  f.lot1 = await stockIn(f.item, f.wA, key("L1"), 100, 100_000);
  f.lot2 = await stockIn(f.item, f.wA, key("L2"), 7, 9_001);
});

after(async () => {
  await prisma.logStockTransferReceiptTracking.deleteMany({ where: { line: { receipt_id: { in: receiptIds } } } });
  await prisma.logStockTransferReceiptLine.deleteMany({ where: { receipt_id: { in: receiptIds } } });
  await prisma.logStockTransferReceipt.deleteMany({ where: { id: { in: receiptIds } } });
  await prisma.logStockTransferTracking.deleteMany({ where: { line: { stock_transfer_id: { in: transferIds } } } });
  await prisma.logStockTransferLine.deleteMany({ where: { stock_transfer_id: { in: transferIds } } });
  await prisma.logStockTransfer.deleteMany({ where: { id: { in: transferIds } } });
  await prisma.auditLog.deleteMany({ where: { entity_key: { in: ["log_stock_transfer", "log_stock_transfer_receipt"] }, row_id: { in: [...transferIds, ...receiptIds] } } });
  await prisma.sysSetting.update({ where: { setting_key: "transit_warehouse" }, data: { setting_value: previousTransit } });
  await cleanupStock([f.item]);
  await prisma.logUserWarehouse.deleteMany({ where: { warehouse_id: { in: [f.wA, f.wB, f.wT, f.wL] } } });
  await prisma.refWarehouseLocation.deleteMany({ where: { id: { in: [f.locB, f.locL] } } });
  await prisma.mItem.deleteMany({ where: { id: f.item } });
  await prisma.refWarehouse.deleteMany({ where: { id: { in: [f.wA, f.wB, f.wT, f.wL] } } });
  await prisma.refUom.deleteMany({ where: { id: f.pcs } });
  await cleanup();
  await cleanupFiscalYear();
  await disconnect();
});

const denied = async (run: () => Promise<unknown>) => {
  try {
    await run();
  } catch (error) {
    return isAccessDenied(error);
  }
  return false;
};

describe("a user works only in the warehouses assigned to them (OD-9)", () => {
  test("assigning takes USER_ROLE_ASSIGN, never one's own; INVENTORY_WAREHOUSE_ALL needs none", async () => {
    const admin = (await makeUser({ permissions: ["USER_ROLE_ASSIGN"] })).id;
    const clerk = (await makeUser({ permissions: ["STOCK_TRANSFER_VIEW"] })).id;
    const boss = (await makeUser({ permissions: ["STOCK_TRANSFER_VIEW", "INVENTORY_WAREHOUSE_ALL"] })).id;
    assert.ok(await denied(async () => setUserWarehouses(await actorOf(clerk), clerk, [f.wA])));
    assert.equal((await setUserWarehouses(await actorOf(admin), admin, [f.wA])).ok, false);
    assert.ok((await setUserWarehouses(await actorOf(admin), clerk, [f.wA, f.wA])).ok);
    assert.deepEqual(await warehouseIdsOf(await actorOf(clerk)), [f.wA]);
    assert.equal(await warehouseIdsOf(await actorOf(boss)), null);
    assert.equal(await prisma.auditLog.count({ where: { entity_key: "sys_user", row_id: clerk, event: "warehouses" } }), 1);
    await assertWarehouse(await actorOf(clerk), f.wA);
    assert.ok(await denied(async () => assertWarehouse(await actorOf(clerk), f.wB)));
    assert.equal((await setUserWarehouses(await actorOf(admin), clerk, [999_999_999])).ok, false);
  });
});

describe("the Gudang Transit (A1, A2, A4)", () => {
  test("it keeps no locations, other documents neither offer nor take it, and it stays active", async () => {
    assert.equal(await transitWarehouseId(), f.wT);
    assert.match((await checkSystemDefaultValue("transit_warehouse", f.wB)) ?? "", /tidak memakai lokasi/);
    assert.equal(await checkSystemDefaultValue("transit_warehouse", f.wT), null);
    const offered = (await stockIssueOptions()).warehouses.map((w) => w.id);
    assert.ok(offered.includes(f.wA) && !offered.includes(f.wT));
    const first = await checkWarehouseLocation({ warehouse_id: f.wT, location_label: "X1" }, null);
    assert.match(first.warehouse_id ?? "", /Gudang Transit/);
    assert.match((await warehouseDeactivateRefusal(f.wT)) ?? "", /Gudang Transit/);
    assert.equal(await warehouseDeactivateRefusal(f.wA), null);
    const options = await stockTransferOptions(null);
    assert.ok(!options.fromWarehouses.some((w) => w.id === f.wT) && !options.toWarehouses.some((w) => w.id === f.wT));
    assert.equal(options.transit?.id, f.wT);
  });
});

describe("Transfer Kirim moves stock into the transit at an unchanged average (§3.1, OD-6)", () => {
  test("it is checked before it is saved", async () => {
    const same = await createStockTransfer(header({ to_warehouse_id: f.wA }), [line(10, [{ lot: f.lot1, qty: 10 }])], f.actor);
    assert.ok(!same.ok && /berbeda/.test(same.errors.to_warehouse_id));
    const transit = await createStockTransfer(header({ to_warehouse_id: f.wT }), [line(10, [{ lot: f.lot1, qty: 10 }])], f.actor);
    assert.ok(!transit.ok && /Transit/.test(transit.errors.to_warehouse_id));
    const over = await createStockTransfer(header(), [line(10, [{ lot: f.lot1, qty: 11 }])], f.actor);
    assert.ok(!over.ok && /melebihi/.test(over.errors["lines.0.picks"]));
  });

  test("a Draft may be picked in part; Kirim needs it in full", async () => {
    const r = await createStockTransfer(header(), [line(30, [{ lot: f.lot1, qty: 20 }])], f.actor);
    assert.ok(r.ok, JSON.stringify(r));
    transferIds.push(r.id);
    assert.match(r.transferNo, /^TSK\/\d{4}\/\d{2}\/\d{4}$/);
    const refused = await transitionStockTransfer(r.id, "send", f.actor);
    assert.ok(!refused.ok && /Pilih lot sampai penuh/.test(refused.errors._form));
    const fixed = await updateStockTransfer(r.id, header(), [line(32, [{ lot: f.lot1, qty: 25 }, { lot: f.lot2, qty: 7 }])], f.actor);
    assert.ok(fixed.ok, JSON.stringify(fixed));
  });

  test("Kirim: origin to transit, same lots, no journal, the pool and its average exactly as before", async () => {
    const id = transferIds[0];
    const before = await pool();
    assert.deepEqual(before, [107, 109_001]);
    const journals = await prisma.accJournal.count();
    assert.ok((await transitionStockTransfer(id, "send", f.actor)).ok);
    const v = (await getStockTransfer(id))!;
    assert.equal(v.status, "InTransit");
    assert.equal(v.transit?.id, f.wT);
    assert.deepEqual(await pool(), before, "the moving average does not move");
    assert.equal(await prisma.accJournal.count(), journals, "no journal");
    assert.equal(await held(f.wA), 75);
    assert.equal(await held(f.wT), 32);
    const rows = await prisma.logStockValuationLedger.findMany({ where: { source_doc_id: id, item_id: f.item, source_no: v.transferNo } });
    assert.equal(rows.reduce((s, r) => s + r.value_change.toNumber(), 0), 0);
    assert.equal(rows.reduce((s, r) => s + r.qty_change.toNumber(), 0), 0);
    assert.ok(!(await transitionStockTransfer(id, "cancel", f.actor, "x")).ok, "a sent transfer is final");
  });

  test("short stock is refused, and any status may travel (OD-4)", async () => {
    const r = await createStockTransfer(header(), [line(80, [{ lot: f.lot1, qty: 80 }])], f.actor);
    assert.ok(r.ok, "a Draft takes no stock");
    transferIds.push(r.id);
    const short = await transitionStockTransfer(r.id, "send", f.actor);
    assert.ok(!short.ok && /tidak cukup: tersedia 75/.test(short.errors._form), JSON.stringify(short));
    assert.ok((await transitionStockTransfer(r.id, "cancel", f.actor, "stok kurang")).ok);
    // Put 5 in quarantine and send them as quarantine.
    await prisma.$transaction(async (tx) => {
      const { issueStock, receiveStock } = await import("../src/lib/erp/inventory");
      const type = await tx.sysDocType.findFirstOrThrow({ where: { doc_table: "log_stock_injection" } });
      const source = { docTypeId: type.id, docId: 990_000 + Number(stamp), no: key("Q") };
      const out = await issueStock(tx, { itemId: f.item, warehouseId: f.wA, lotId: f.lot1, baseQty: 5, date: new Date(`${today}T00:00:00Z`), source, actorId: f.actor });
      await receiveStock(tx, { itemId: f.item, warehouseId: f.wA, lotNo: key("L1"), expiry: null, baseQty: 5, value: out.cost, statusId: karantina, date: new Date(`${today}T00:00:00Z`), source, actorId: f.actor });
    });
    const q = await createStockTransfer(header({ to_warehouse_id: f.wL }), [line(5, [{ lot: f.lot1, qty: 5, status: karantina }])], f.actor);
    assert.ok(q.ok, JSON.stringify(q));
    transferIds.push(q.id);
    assert.ok((await transitionStockTransfer(q.id, "send", f.actor)).ok);
    const inTransit = await prisma.logStockBalance.findFirstOrThrow({ where: { warehouse_id: f.wT, tracking_id: f.lot1, stock_status_id: karantina } });
    assert.equal(inTransit.qty_balance.toNumber(), 5);
  });

  test("the register is filtered to the user's warehouses, from or to", async () => {
    assert.ok((await listStockTransfers([f.wB])).some((r) => r.id === transferIds[0]));
    assert.ok(!(await listStockTransfers([f.wB])).some((r) => r.id === transferIds[2]));
    assert.ok((await listStockTransfers(null)).some((r) => r.id === transferIds[2]));
  });
});

describe("Transfer Terima takes the transit stock into the destination (§3.2)", () => {
  const lines = async (transferId: number, qtyByLot: Record<number, number>, locationId: number | null): Promise<TransferReceiptLineInput[]> => {
    const [s] = await transferReceiptSources(prisma, { ids: [transferId] }, null);
    return s.lines.map((l) => {
      const picks = l.trackings.filter((t) => qtyByLot[t.trackingId]).map((t) => ({ transfer_tracking_id: t.id, location_id: locationId, qty: qtyByLot[t.trackingId] }));
      return { transfer_line_id: l.id, qty: picks.reduce((s, p) => s + p.qty, 0), note: "", picks };
    });
  };

  test("never before the Kirim, never beyond what was sent, a location where the destination keeps them", async () => {
    const id = transferIds[0];
    const early = await createTransferReceipt({ stock_transfer_id: id, receipt_date: "2000-01-01", note: "" }, await lines(id, { [f.lot1]: 5 }, f.locB), f.actor);
    assert.ok(!early.ok && /sebelum Tanggal Kirim/.test(early.errors.receipt_date));
    const over = await createTransferReceipt({ stock_transfer_id: id, receipt_date: today, note: "" }, await lines(id, { [f.lot1]: 26 }, f.locB), f.actor);
    assert.ok(!over.ok);
    const noLoc = await createTransferReceipt({ stock_transfer_id: id, receipt_date: today, note: "" }, await lines(id, { [f.lot1]: 10 }, null), f.actor);
    assert.ok(noLoc.ok, "a Draft may leave the location empty");
    receiptIds.push(noLoc.id);
    const refused = await transitionTransferReceipt(noLoc.id, "post", f.actor);
    assert.ok(!refused.ok && /pilih lokasi/.test(refused.errors._form));
    assert.ok((await transitionTransferReceipt(noLoc.id, "cancel", f.actor, "uji")).ok);
  });

  test("received in parts: what a Draft holds is not free, and the pool never moves", async () => {
    const id = transferIds[0];
    const before = await pool();
    const first = await createTransferReceipt({ stock_transfer_id: id, receipt_date: today, note: "" }, await lines(id, { [f.lot1]: 20 }, f.locB), f.actor);
    assert.ok(first.ok, JSON.stringify(first));
    receiptIds.push(first.id);
    assert.match(first.receiptNo, /^TST\/\d{4}\/\d{2}\/\d{4}$/);
    const tooMuch = await createTransferReceipt({ stock_transfer_id: id, receipt_date: today, note: "" }, await lines(id, { [f.lot1]: 6 }, f.locB), f.actor);
    assert.ok(!tooMuch.ok, "the Draft holds 20 of the 25");
    assert.ok((await transitionTransferReceipt(first.id, "post", f.actor)).ok);
    assert.equal((await getTransferReceipt(first.id))!.status, "Posted");
    assert.deepEqual(await pool(), before);
    assert.equal(await held(f.wB), 20);
    assert.equal((await getStockTransfer(id))!.status, "InTransit", "still 12 on the way");
    const bucket = await prisma.logStockBalance.findFirstOrThrow({ where: { warehouse_id: f.wB, tracking_id: f.lot1 } });
    assert.equal(bucket.location_id, f.locB);
  });

  test("the last part closes the Kirim as Diterima; the transit is empty again", async () => {
    const id = transferIds[0];
    const rest = await createTransferReceipt({ stock_transfer_id: id, receipt_date: today, note: "" }, await lines(id, { [f.lot1]: 5, [f.lot2]: 7 }, f.locB), f.actor);
    assert.ok(rest.ok, JSON.stringify(rest));
    receiptIds.push(rest.id);
    assert.ok((await transitionTransferReceipt(rest.id, "post", f.actor)).ok);
    const v = (await getStockTransfer(id))!;
    assert.equal(v.status, "Received");
    assert.ok(v.lines.every((l) => l.receivedQty === Number(l.qty)));
    assert.equal(await held(f.wB), 32);
    assert.equal(await held(f.wT), 5, "only the quarantine transfer is still on the way");
    assert.deepEqual(await pool(), [107, 109_001]);
    assert.ok((await listTransferReceipts([f.wB])).some((r) => r.id === rest.id));
    assert.ok(!(await listTransferReceipts([f.wA])).some((r) => r.id === rest.id));
  });

  test("the transit is not changed while it holds stock", async () => {
    assert.match((await transitChangeRefusal(f.wA)) ?? "", /masih menyimpan stok/);
    assert.match((await transitChangeRefusal(null)) ?? "", /masih menyimpan stok/);
    // The quarantine goods arrive; the status travelled with them.
    const id = transferIds[2];
    const r = await createTransferReceipt({ stock_transfer_id: id, receipt_date: today, note: "" }, await lines(id, { [f.lot1]: 5 }, f.locL), f.actor);
    assert.ok(r.ok, JSON.stringify(r));
    receiptIds.push(r.id);
    assert.ok((await transitionTransferReceipt(r.id, "post", f.actor)).ok);
    const arrived = await prisma.logStockBalance.findFirstOrThrow({ where: { warehouse_id: f.wL, tracking_id: f.lot1 } });
    assert.equal(arrived.stock_status_id, karantina);
    assert.equal(await transitChangeRefusal(f.wA), null);
  });
});
