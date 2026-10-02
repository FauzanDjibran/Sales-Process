import test, { after, before, describe } from "node:test";
import assert from "node:assert/strict";

import {
  ArItemExists,
  ArItemOverdrawn,
  arItemsReconcile,
  arLedgerReport,
  arPartnerOptions,
  arReceiptEntries,
  closeArItem,
  createArItem,
  openArItems,
  openArItemsAsOf,
  receiveArItem,
  settleArItem,
  type ArAmounts,
  type ArItemType,
} from "../src/lib/erp/ar-item";
import { agingBucket, daysOverdue } from "../src/lib/erp/ar-aging";
import { FIXTURE_PREFIX, cleanupFixtures, disconnect, makePartner, prisma, systemUserId } from "./helpers";

/**
 * AR items and Buku Piutang (P71–P75, P87–P92).
 *
 * An item is born with a Terbentuk entry and carries its open amount split into
 * DPP, PPN and expected PPh; every part moves only through entries and none
 * goes below zero. There is one item per document per type, so an Uang Muka
 * item is raised by each later receipt (Diterima) rather than duplicated, and
 * its entries keep each receipt's own figures. Every movement carries a base
 * value: in at its own rate, out at the carrying rate, the last release taking
 * exactly the base that is left. A report for a past date reads the entries;
 * Buku Piutang signs entries on Piutang Usaha and never shows a noted Tagihan.
 */

let actor = 0;
const f = {} as Record<string, number>;
const items: number[] = [];
let nextDoc = 0;

async function docType(table: string) {
  return (await prisma.sysDocType.findFirstOrThrow({ where: { doc_table: table } })).id;
}

before(async () => {
  actor = await systemUserId();
  f.customer = await makePartner({ categoryLabel: "Customer" });
  f.idr = (await prisma.refCurrency.findFirstOrThrow({ where: { currency_label: "IDR" } })).id;
  f.receiptType = await docType("fin_cash_bank_tx");
  f.billType = await docType("sal_advance");
  f.pph = (await prisma.refWithholdingTax.findFirstOrThrow({ where: { wht_code: { not: "" } }, orderBy: { id: "asc" } })).id;
  // Document ids no real row carries; the book only records the reference.
  nextDoc = 900_000_000 + (Date.now() % 100_000) * 10;
});

after(async () => {
  if (items.length) {
    await prisma.finArItemWht.deleteMany({ where: { item_id: { in: items } } });
    await prisma.finArLedger.deleteMany({ where: { item_id: { in: items } } });
    await prisma.finArItem.deleteMany({ where: { id: { in: items } } });
  }
  await cleanupFixtures();
  await disconnect();
});

const doc = (no: string, docTypeId = f.receiptType, docId = nextDoc++) => ({ docTypeId, docId, no: `${FIXTURE_PREFIX}/${no}` });
const amounts = (gross: number, ppn = 0, pph = 0): ArAmounts => ({ gross, dpp: gross - ppn, ppn, pph });

async function make(type: ArItemType, date: string, a: ArAmounts, opts: { dueDate?: string; rate?: number; source?: ReturnType<typeof doc> } = {}) {
  const source = opts.source ?? doc(`${type}/${items.length}`, f.billType);
  const { itemId } = await createArItem(prisma, {
    type,
    partnerId: f.customer,
    currencyId: f.idr,
    date,
    dueDate: opts.dueDate ?? null,
    source,
    order: { id: 1, no: "CO/TEST" },
    amounts: a,
    withholdings: a.pph ? [{ taxId: f.pph, rate: 1.5, base: Math.round(a.pph / 0.015), amount: a.pph }] : [],
    rate: opts.rate,
    by: doc("BY"),
    actorId: actor,
  });
  items.push(itemId);
  return itemId;
}

const balanceOf = async (id: number) => {
  const r = await prisma.finArItem.findUniqueOrThrow({ where: { id } });
  return [r.current_balance, r.current_dpp, r.current_ppn, r.current_pph, r.current_base_balance].map((d) => d.toNumber());
};

describe("an AR item's balance moves only through Buku Piutang", () => {
  test("born whole, moved by part; no part may go below zero", async () => {
    // A Tagihan of DPP 900.000 + PPN 99.000, expecting 9.000 PPh.
    const bill = await make("AdvanceRequest", "2026-09-01", amounts(999_000, 99_000, 9_000), { dueDate: "2026-09-08" });
    assert.deepEqual(await balanceOf(bill), [999_000, 900_000, 99_000, 9_000, 999_000]);
    await prisma.$transaction((tx) =>
      settleArItem(tx, { itemId: bill, event: "Payment", amounts: { gross: 499_500, dpp: 450_000, ppn: 49_500, pph: 4_500 }, date: "2026-09-03", doc: doc("BKM"), actorId: actor })
    );
    assert.deepEqual(await balanceOf(bill), [499_500, 450_000, 49_500, 4_500, 499_500]);

    // More PPN than is open is refused even when the gross would fit.
    await assert.rejects(
      prisma.$transaction((tx) =>
        settleArItem(tx, { itemId: bill, event: "Payment", amounts: { gross: 60_000, dpp: 0, ppn: 60_000, pph: 0 }, date: "2026-09-04", doc: doc("BKM"), actorId: actor })
      ),
      ArItemOverdrawn
    );
    assert.deepEqual(await balanceOf(bill), [499_500, 450_000, 49_500, 4_500, 499_500], "nothing written");

    const source = (await prisma.finArItem.findUniqueOrThrow({ where: { id: bill } })).source_doc_id;
    const [open] = await openArItems(prisma, { type: "AdvanceRequest", sourceTable: "sal_advance", sourceIds: [source] });
    assert.deepEqual(open.original, amounts(999_000, 99_000, 9_000), "what it was born with, from its entries");
    assert.equal(open.paid, 499_500);
    assert.deepEqual(open.withholdings.map((w) => w.amount), [9_000]);
    assert.equal(await arItemsReconcile(f.customer), true);
  });

  test("one item per document per type (P88)", async () => {
    const source = doc("ARA/ONE", f.billType);
    await make("AdvanceRequest", "2026-09-01", amounts(100_000), { source });
    await assert.rejects(make("AdvanceRequest", "2026-09-01", amounts(100_000), { source }), ArItemExists);
    // A different type about the same document is a different item.
    await make("Advance", "2026-09-02", amounts(100_000), { source });
  });

  test("a noted item is closed when its bill is cancelled", async () => {
    const bill = await make("AdvanceRequest", "2026-09-01", amounts(222_000, 22_000));
    await prisma.$transaction((tx) => closeArItem(tx, { itemId: bill, date: "2026-09-02", doc: doc("ARA/X", f.billType), actorId: actor }));
    assert.deepEqual(await balanceOf(bill), [0, 0, 0, 0, 0]);
    const events = await prisma.finArLedger.findMany({ where: { item_id: bill }, orderBy: { id: "asc" }, select: { event: true } });
    assert.deepEqual(events.map((e) => e.event), ["Create", "Cancelled"]);
  });
});

describe("an Uang Muka item is one per bill, raised by each receipt (P88)", () => {
  let adv = 0;

  test("Diterima raises it; each receipt stays an entry of its own", async () => {
    adv = await make("Advance", "2026-09-05", { gross: 1_665_000, dpp: 1_500_000, ppn: 165_000, pph: 0 });
    await prisma.$transaction((tx) =>
      receiveArItem(tx, { itemId: adv, amounts: { gross: 1_665_000, dpp: 1_500_000, ppn: 165_000, pph: 0 }, date: "2026-09-20", doc: doc("BKM/2"), actorId: actor })
    );
    assert.deepEqual(await balanceOf(adv), [3_330_000, 3_000_000, 330_000, 0, 3_330_000]);
    const receipts = await arReceiptEntries(prisma, adv);
    assert.deepEqual(receipts.map((r) => [r.amounts.gross, r.left.gross]), [
      [1_665_000, 1_665_000],
      [1_665_000, 1_665_000],
    ]);
  });

  test("a use names the receipt entry it draws on and the invoice that took it", async () => {
    const inv = await make("Invoice", "2026-09-25", amounts(7_770_000, 770_000), { dueDate: "2026-10-25" });
    const [first] = await arReceiptEntries(prisma, adv);
    await prisma.$transaction((tx) =>
      settleArItem(tx, {
        itemId: adv,
        event: "AdvanceUsed",
        amounts: { gross: 1_332_000, dpp: 1_200_000, ppn: 132_000, pph: 0 },
        date: "2026-09-25",
        doc: doc("FJ"),
        counterItemId: inv,
        sourceEntryId: first.entryId,
        actorId: actor,
      })
    );
    const receipts = await arReceiptEntries(prisma, adv);
    assert.deepEqual(receipts.map((r) => [r.left.gross, r.left.dpp, r.left.ppn]), [
      [333_000, 300_000, 33_000],
      [1_665_000, 1_500_000, 165_000],
    ]);
    assert.deepEqual(await balanceOf(adv), [1_998_000, 1_800_000, 198_000, 0, 1_998_000]);
  });

  test("only an Uang Muka item may go up", async () => {
    const inv = await make("Invoice", "2026-09-26", amounts(100_000), { dueDate: "2026-10-26" });
    await assert.rejects(
      prisma.$transaction((tx) => receiveArItem(tx, { itemId: inv, amounts: amounts(1), date: "2026-09-27", doc: doc("BKM"), actorId: actor })),
      /tidak dapat bertambah/
    );
  });
});

describe("every movement carries its base value (P92)", () => {
  test("in at its own rate, out at the carrying rate, the last release exact", async () => {
    // 100 in at 16.000 and 100 in at 15.500: 200 carried at 3.150.000.
    const adv = await make("Advance", "2026-09-01", amounts(100), { rate: 16_000 });
    await prisma.$transaction((tx) => receiveArItem(tx, { itemId: adv, amounts: amounts(100), rate: 15_500, date: "2026-09-02", doc: doc("BKM"), actorId: actor }));
    assert.equal((await balanceOf(adv))[4], 3_150_000);
    // 70 leaves at the carrying rate 15.750: 1.102.500.
    await prisma.$transaction((tx) => settleArItem(tx, { itemId: adv, event: "AdvanceUsed", amounts: amounts(70), date: "2026-09-03", doc: doc("FJ"), actorId: actor }));
    assert.equal((await balanceOf(adv))[4], 2_047_500);
    // The last 130 takes exactly what is left, whatever rounding came before.
    await prisma.$transaction((tx) => settleArItem(tx, { itemId: adv, event: "AdvanceUsed", amounts: amounts(130), date: "2026-09-04", doc: doc("FJ"), actorId: actor }));
    assert.deepEqual(await balanceOf(adv), [0, 0, 0, 0, 0]);
    const base = await prisma.finArLedger.findMany({ where: { item_id: adv }, orderBy: { id: "asc" }, select: { base_movement: true } });
    assert.deepEqual(base.map((b) => b.base_movement.toNumber()), [1_600_000, 1_550_000, -1_102_500, -2_047_500]);
    assert.equal(await arItemsReconcile(f.customer), true);
  });
});

describe("reports read the entries; a noted Tagihan is in none of them", () => {
  let customer = 0;

  before(async () => {
    customer = await makePartner({ categoryLabel: "Customer" });
    const own = (type: ArItemType, date: string, a: ArAmounts, dueDate?: string) =>
      createArItem(prisma, {
        type,
        partnerId: customer,
        currencyId: f.idr,
        date,
        dueDate: dueDate ?? null,
        source: doc(`R/${type}`, f.billType),
        amounts: a,
        by: doc("BY"),
        actorId: actor,
      }).then((r) => (items.push(r.itemId), r.itemId));
    await own("AdvanceRequest", "2026-09-01", amounts(1_110_000, 110_000));
    const adv = await own("Advance", "2026-09-01", amounts(1_110_000, 110_000));
    const inv = await own("Invoice", "2026-09-10", amounts(5_550_000, 550_000), "2026-10-10");
    await prisma.$transaction((tx) =>
      settleArItem(tx, { itemId: adv, event: "AdvanceUsed", amounts: amounts(444_000, 44_000), date: "2026-09-10", doc: doc("FJ"), counterItemId: inv, actorId: actor })
    );
  });

  test("a report for a past date reads the entries, not today's balance", async () => {
    const before = await openArItemsAsOf("Advance", "2026-09-05", customer);
    assert.deepEqual(before.map((r) => [r.original, r.settled, r.open, r.openDpp]), [[1_110_000, 0, 1_110_000, 1_000_000]]);
    const now = await openArItemsAsOf("Advance", "2026-09-30", customer);
    assert.deepEqual(now.map((r) => [r.original, r.settled, r.open, r.openDpp]), [[1_110_000, 444_000, 666_000, 600_000]]);
    assert.equal((await openArItemsAsOf("Invoice", "2026-09-09", customer)).length, 0, "not yet born");
  });

  test("Buku Piutang holds Invoice items only unless Uang Muka is asked for (P77)", async () => {
    const r = (await arLedgerReport(customer, { from: "2026-09-05", to: "2026-09-30" }))!;
    assert.equal(r.opening, 0, "the advance before the period is beside the book, the Tagihan nowhere");
    assert.deepEqual(r.entries.map((e) => [e.event, e.type, e.exposure]), [["Create", "Invoice", 5_550_000]]);
    assert.deepEqual(r.closingByType, { Advance: 666_000, Invoice: 5_550_000 }, "still stated beside it");
  });

  test("with Uang Muka, Buku Piutang signs each entry on the net position", async () => {
    const r = (await arLedgerReport(customer, { from: "2026-09-05", to: "2026-09-30" }, { includeAdvance: true }))!;
    assert.equal(r.opening, -1_110_000, "the advance received before the period lowers the position");
    assert.deepEqual(r.entries.map((e) => [e.event, e.type, e.exposure]), [
      ["Create", "Invoice", 5_550_000],
      ["AdvanceUsed", "Advance", 444_000],
    ]);
    assert.equal(r.closing, r.closingByType.Invoice - r.closingByType.Advance);
  });

  test("a customer with only a noted Tagihan is not offered by the reports", async () => {
    const onlyBilled = await makePartner({ categoryLabel: "Customer" });
    const { itemId } = await createArItem(prisma, {
      type: "AdvanceRequest",
      partnerId: onlyBilled,
      currencyId: f.idr,
      date: "2026-09-01",
      source: doc("R/ONLY", f.billType),
      amounts: amounts(10_000),
      by: doc("BY"),
      actorId: actor,
    });
    items.push(itemId);
    const offered = (await arPartnerOptions()).map((p) => p.id);
    assert.ok(offered.includes(customer));
    assert.ok(!offered.includes(onlyBilled));
  });
});

describe("Umur Piutang ages from the due date (P75)", () => {
  test("buckets", () => {
    assert.equal(daysOverdue("2026-10-10", "2026-10-10"), 0);
    assert.equal(agingBucket("2026-10-10", "2026-10-10"), "current");
    assert.equal(agingBucket("2026-10-10", "2026-10-11"), "d30");
    assert.equal(agingBucket("2026-10-10", "2026-11-09"), "d30");
    assert.equal(agingBucket("2026-10-10", "2026-11-10"), "d60");
    assert.equal(agingBucket("2026-10-10", "2027-01-08"), "d90");
    assert.equal(agingBucket("2026-10-10", "2027-01-09"), "over90");
    assert.equal(agingBucket("2026-10-10", "2026-09-30"), "current", "not yet due");
  });
});
