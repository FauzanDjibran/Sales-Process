import test, { after, before, describe } from "node:test";
import assert from "node:assert/strict";

import {
  createReceiptNote,
  getReceiptNote,
  liveReceiptNoteRefusal,
  receiptNoteOptions,
  receiptNotePreview,
  transitionReceiptNote,
  type ReceiptNoteHeaderInput,
} from "../src/lib/erp/receipt-note";
import { getPurchaseOrder, transitionPurchaseOrder } from "../src/lib/erp/purchase-order";
import { cumulativeShare } from "../src/lib/erp/receipt-note-workflow";
import { cleanupFiscalYear, cleanupFixtures, disconnect, openFiscalYear, prisma } from "./helpers";
import { purchasingWorld, type PurchasingWorld } from "./purchasing-helpers";

/**
 * The Receipt Note (P125, Purchasing-Concept.md B17–B22): from one Open PO, no
 * over-receipt; a Kelola Stok line comes in as lots made here, any other line
 * and a Jasa is an expense; each line worth its cumulative share of the PO
 * line's DPP; Dr Persediaan / Beban, Cr Barang Diterima Belum Ditagih; the PO
 * told what came in, closing itself once fully received.
 */

const today = new Date().toISOString().slice(0, 10);
let w: PurchasingWorld;
const rns: number[] = [];

const header = (po: number, over: Partial<ReceiptNoteHeaderInput> = {}): ReceiptNoteHeaderInput => ({
  source_doc_id: po,
  rn_date: today,
  warehouse_id: w.f.warehouse,
  supplier_dn_no: "SJ-SUP-1",
  note: "",
  ...over,
});

async function create(...args: Parameters<typeof createReceiptNote>) {
  const r = await createReceiptNote(...args);
  if (r.ok) rns.push(r.id);
  return r;
}

async function journalOf(rnId: number) {
  const n = await prisma.logReceiptNote.findUniqueOrThrow({ where: { id: rnId } });
  return prisma.accJournalLine.findMany({ where: { journal_id: n.journal_id! }, orderBy: { id: "asc" } });
}

before(async () => {
  await openFiscalYear();
  w = await purchasingWorld("RN");
});

after(async () => {
  await prisma.logReceiptNoteLot.deleteMany({ where: { line: { receipt_note_id: { in: rns } } } });
  await prisma.logReceiptNoteLine.deleteMany({ where: { receipt_note_id: { in: rns } } });
  await prisma.logReceiptNote.deleteMany({ where: { id: { in: rns } } });
  await prisma.auditLog.deleteMany({ where: { entity_key: "log_receipt_note", row_id: { in: rns } } });
  await w.teardown();
  await cleanupFixtures();
  await cleanupFiscalYear();
  await disconnect();
});

describe("the value of a receipt (B20)", () => {
  test("cumulative shares of a DPP add up to it exactly", () => {
    const parts = [1, 1, 1].map((q, i) => cumulativeShare(100, 3, i, q));
    assert.deepEqual(parts, [33, 34, 33]);
    assert.equal(parts.reduce((a, b) => a + b), 100);
  });
});

describe("receiving goods", () => {
  test("a stock line comes in as lots, valued at the PO's DPP; Dr Persediaan / Cr GR-IR naming the supplier", async () => {
    const po = await w.openPO([{ item: w.f.stock, qty: 10, price: 1_000 }]);
    const o = await receiptNoteOptions();
    assert.ok(o.orders.some((x) => x.id === po.id));
    const over = await create(header(po.id), [{ source_doc_line_id: po.lineIds[0], qty: 11, note: "" }], w.actor);
    assert.ok(!over.ok && /Melebihi sisa/.test(over.errors["lines.0.qty"]), "no over-receipt");

    const r = await create(
      header(po.id),
      [{ source_doc_line_id: po.lineIds[0], qty: 3, note: "", lots: [{ lot_no: w.key("A"), expiry_date: "", qty: 1 }, { lot_no: "", expiry_date: "", qty: 2 }] }],
      w.actor
    );
    assert.ok(r.ok, JSON.stringify(r));
    assert.match(r.rnNo, /^RN\/\d{4}\/\d{2}\/\d{4}$/);
    const preview = await receiptNotePreview(r.id, w.actor);
    assert.ok(preview.ok);
    assert.deepEqual(await transitionReceiptNote(r.id, "post", w.actor), { ok: true, closed: [] });

    const v = (await getReceiptNote(r.id))!;
    assert.equal(v.value, 3_000);
    assert.deepEqual(v.lines[0].lotValues, [1_000, 2_000]);
    assert.equal(v.lines[0].lots![1].lot_no, `${r.rnNo.replace(/\//g, "")}-1-2`, "an empty lot number is generated");
    const balance = await prisma.logStockValuationBalance.findFirstOrThrow({ where: { item_id: w.f.stock } });
    assert.equal(balance.qty_balance.toNumber(), 3);
    assert.equal(balance.value_balance.toNumber(), 3_000);
    const lines = await journalOf(r.id);
    assert.deepEqual(
      lines.map((l) => [l.account_id, l.debit_amount.toNumber(), l.kredit_amount.toNumber(), l.partner_id]),
      [
        [w.f.catInvAcc, 3_000, 0, null],
        [w.f.grirAcc, 0, 3_000, w.f.supplier],
      ],
      "the category's Persediaan; GR/IR names the supplier"
    );
    assert.equal((await getPurchaseOrder(po.id))!.lines[0].received, 3);

    // The rest of the line: the receipts add up to the DPP, and the PO closes itself.
    const rest = await create(header(po.id), [{ source_doc_line_id: po.lineIds[0], qty: 7, note: "", lots: [{ lot_no: w.key("B"), expiry_date: "", qty: 7 }] }], w.actor);
    assert.ok(rest.ok);
    const done = await transitionReceiptNote(rest.id, "post", w.actor);
    assert.deepEqual(done, { ok: true, closed: [po.orderNo] });
    assert.equal((await getReceiptNote(rest.id))!.value, 7_000);
    assert.equal((await getPurchaseOrder(po.id))!.status, "Closed");
  });

  test("lots must be complete to post; an expiring item needs its expiry", async () => {
    const po = await w.openPO([{ item: w.f.expiring, qty: 5, price: 100 }]);
    const r = await create(header(po.id), [{ source_doc_line_id: po.lineIds[0], qty: 5, note: "", lots: [{ lot_no: "", expiry_date: "", qty: 2 }] }], w.actor);
    assert.ok(r.ok, "a Draft may be partly lotted");
    const short = await transitionReceiptNote(r.id, "post", w.actor);
    assert.ok(!short.ok && /Lengkapi lotnya|kadaluarsa/.test(short.errors._form));
    assert.match((await liveReceiptNoteRefusal(prisma as never, po.id)) ?? "", /Receipt Note Draft/);
    assert.ok(!(await transitionPurchaseOrder(po.id, "close", w.actor, "x", liveReceiptNoteRefusal)).ok, "a PO with a Draft receipt stays open");
  });

  test("a Barang without Kelola Stok and a Jasa are expensed; a Jasa receipt has no warehouse", async () => {
    const po = await w.openPO([{ item: w.f.plain, qty: 4, price: 250 }]);
    const r = await create(header(po.id), [{ source_doc_line_id: po.lineIds[0], qty: 4, note: "" }], w.actor);
    assert.ok(r.ok);
    await transitionReceiptNote(r.id, "post", w.actor);
    assert.deepEqual((await journalOf(r.id)).map((l) => [l.account_id, l.debit_amount.toNumber()]), [[w.f.expAcc, 1_000], [w.f.grirAcc, 0]]);

    const jasa = await w.openPO([{ item: w.f.service, qty: 1, price: 5_000 }], { itemType: "Jasa" });
    const s = await create(header(jasa.id, { warehouse_id: w.f.warehouse }), [{ source_doc_line_id: jasa.lineIds[0], qty: 1, note: "" }], w.actor);
    assert.ok(s.ok);
    assert.equal((await prisma.logReceiptNote.findUniqueOrThrow({ where: { id: s.id } })).warehouse_id, null);
    assert.deepEqual(await transitionReceiptNote(s.id, "post", w.actor), { ok: true, closed: [jasa.orderNo] });
    assert.equal((await getReceiptNote(s.id))!.value, 5_000);
  });

  test("another unit comes into stock in base units", async () => {
    const po = await w.openPO([{ item: w.f.stock, qty: 2, price: 24_000, uom: w.f.box }]);
    const before = (await prisma.logStockValuationBalance.findFirst({ where: { item_id: w.f.stock } }))?.qty_balance.toNumber() ?? 0;
    const r = await create(header(po.id), [{ source_doc_line_id: po.lineIds[0], qty: 1, note: "", lots: [{ lot_no: w.key("BX"), expiry_date: "", qty: 1 }] }], w.actor);
    assert.ok(r.ok);
    await transitionReceiptNote(r.id, "post", w.actor);
    const after = (await prisma.logStockValuationBalance.findFirstOrThrow({ where: { item_id: w.f.stock } })).qty_balance.toNumber();
    assert.equal(after - before, 12);
    assert.equal((await getReceiptNote(r.id))!.value, 24_000);
  });
});
