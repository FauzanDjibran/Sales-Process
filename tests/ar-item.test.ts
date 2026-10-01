import test, { after, before, describe } from "node:test";
import assert from "node:assert/strict";

import {
  ArItemOverdrawn,
  arItemsReconcile,
  arLedgerReport,
  createArItem,
  openArItemsAsOf,
  settleArItem,
} from "../src/lib/erp/ar-item";
import { agingBucket, daysOverdue } from "../src/lib/erp/ar-aging";
import { FIXTURE_PREFIX, cleanupFixtures, disconnect, makePartner, prisma, systemUserId } from "./helpers";

/**
 * AR items and Buku Piutang (P71–P75): an item is born with a Create entry,
 * its balance moves only through entries and never below zero, a report for a
 * past date reads the entries rather than today's balance, and Buku Piutang
 * signs every entry on the customer's Piutang Usaha position — an Invoice
 * raises it, an Uang Muka lowers it.
 */

let actor = 0;
const f = {} as Record<string, number>;
const items: number[] = [];

async function docType(table: string) {
  return (await prisma.sysDocType.findFirstOrThrow({ where: { doc_table: table } })).id;
}

before(async () => {
  actor = await systemUserId();
  f.customer = await makePartner({ categoryLabel: "Customer" });
  f.idr = (await prisma.refCurrency.findFirstOrThrow({ where: { currency_label: "IDR" } })).id;
  f.receiptType = await docType("fin_cash_bank_tx");
  f.billType = await docType("sal_advance");
  // A document id no real row carries; the book only records the reference.
  f.doc = 900_000_000 + (Date.now() % 100_000);
});

after(async () => {
  if (items.length) {
    await prisma.finArLedger.deleteMany({ where: { item_id: { in: items } } });
    await prisma.finArItem.deleteMany({ where: { id: { in: items } } });
  }
  await cleanupFixtures();
  await disconnect();
});

async function make(type: "Advance" | "Invoice", date: string, amount: number, dueDate: string | null = null) {
  const id = await createArItem(prisma, {
    type,
    partnerId: f.customer,
    currencyId: f.idr,
    date,
    dueDate,
    source: { docTypeId: f.receiptType, docId: f.doc, no: `${FIXTURE_PREFIX}/${type}/${items.length}` },
    order: { id: 1, no: "CO/TEST" },
    amount,
    actorId: actor,
  });
  items.push(id);
  return id;
}

describe("an AR item's balance moves only through Buku Piutang", () => {
  test("born with a Create entry; settled in part; never below zero", async () => {
    const adv = await make("Advance", "2026-09-01", 1_000_000);
    const inv = await make("Invoice", "2026-09-10", 5_000_000, "2026-10-10");
    await prisma.$transaction((tx) =>
      settleArItem(tx, {
        itemId: adv,
        event: "AdvanceUsed",
        amount: 400_000,
        date: "2026-09-10",
        doc: { docTypeId: f.billType, docId: f.doc, no: "INV/TEST" },
        counterItemId: inv,
        actorId: actor,
      })
    );
    const row = await prisma.finArItem.findUniqueOrThrow({ where: { id: adv }, include: { entries: { orderBy: { id: "asc" } } } });
    assert.equal(row.current_balance.toNumber(), 600_000);
    assert.deepEqual(row.entries.map((e) => [e.event, e.movement.toNumber(), e.balance_after.toNumber()]), [
      ["Create", 1_000_000, 1_000_000],
      ["AdvanceUsed", -400_000, 600_000],
    ]);
    assert.equal(row.entries[1].counter_item_id, inv, "the advance names the invoice that used it");

    await assert.rejects(
      prisma.$transaction((tx) =>
        settleArItem(tx, {
          itemId: adv,
          event: "AdvanceUsed",
          amount: 600_001,
          date: "2026-09-11",
          doc: { docTypeId: f.billType, docId: f.doc, no: "INV/TEST2" },
          actorId: actor,
        })
      ),
      ArItemOverdrawn
    );
    assert.equal((await prisma.finArItem.findUniqueOrThrow({ where: { id: adv } })).current_balance.toNumber(), 600_000, "nothing written");
    assert.equal(await arItemsReconcile(f.customer), true);
  });

  test("a report for a past date reads the entries, not today's balance", async () => {
    const before = await openArItemsAsOf("Advance", "2026-09-05", f.customer);
    assert.deepEqual(before.map((r) => [r.original, r.settled, r.open]), [[1_000_000, 0, 1_000_000]]);
    const now = await openArItemsAsOf("Advance", "2026-09-30", f.customer);
    assert.deepEqual(now.map((r) => [r.original, r.settled, r.open]), [[1_000_000, 400_000, 600_000]]);
    assert.equal((await openArItemsAsOf("Invoice", "2026-09-09", f.customer)).length, 0, "not yet born");
  });

  test("Buku Piutang holds Invoice items only unless Uang Muka is asked for (P77)", async () => {
    const r = (await arLedgerReport(f.customer, { from: "2026-09-05", to: "2026-09-30" }))!;
    assert.equal(r.includeAdvance, false);
    assert.equal(r.opening, 0, "the advance before the period is beside the book");
    assert.deepEqual(r.entries.map((e) => [e.event, e.type, e.exposure]), [["Create", "Invoice", 5_000_000]]);
    assert.equal(r.closing, 5_000_000);
    assert.deepEqual(r.closingByType, { Advance: 600_000, Invoice: 5_000_000 }, "still stated beside it");
  });

  test("with Uang Muka, Buku Piutang signs each entry on the net position", async () => {
    const r = (await arLedgerReport(f.customer, { from: "2026-09-05", to: "2026-09-30" }, { includeAdvance: true }))!;
    assert.equal(r.opening, -1_000_000, "the advance received before the period lowers the position");
    assert.deepEqual(r.entries.map((e) => [e.event, e.type, e.exposure]), [
      ["Create", "Invoice", 5_000_000],
      ["AdvanceUsed", "Advance", 400_000],
    ]);
    assert.equal(r.closing, 4_400_000);
    assert.deepEqual(r.closingByType, { Advance: 600_000, Invoice: 5_000_000 });
    assert.equal(r.closing, r.closingByType.Invoice - r.closingByType.Advance);
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
