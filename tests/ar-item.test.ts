import test, { after, before, describe } from "node:test";
import assert from "node:assert/strict";

import {
  ArItemOverdrawn,
  arItemsReconcile,
  arBook,
  arBookEntriesPage,
  createArItem,
  openArItemsAsOf,
  settleArItem,
} from "../src/lib/erp/ar-item";
import { agingBucket, daysOverdue, foldAging, type AgingRow } from "../src/lib/erp/ar-aging";
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
  f.billType = await docType("fin_ar_advance");
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

async function make(type: "Advance" | "Invoice", date: string, amount: number, dueDate: string | null = null, base = amount) {
  const id = await createArItem(prisma, {
    type,
    partnerId: f.customer,
    currencyId: f.idr,
    date,
    dueDate,
    // One document, one item (P214): each item is about a document of its own.
    source: { docTypeId: f.receiptType, docId: f.doc + 1 + items.length, no: `${FIXTURE_PREFIX}/${type}/${items.length}` },
    createdBy: { docTypeId: f.receiptType, docId: f.doc, no: `${FIXTURE_PREFIX}/R/${items.length}` },
    scope: { docTypeId: f.receiptType, docId: 1 },
    amount,
    base,
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
    assert.deepEqual(row.entries.map((e) => [e.event, e.movement.toNumber()]), [
      ["Create", 1_000_000],
      ["AdvanceUsed", -400_000],
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

  test("numbered ARI/YYYY/MM/NNNN in its month, about its source, created by the posting its Create entry names (U1)", async () => {
    const rows = await prisma.finArItem.findMany({ where: { id: { in: items } }, include: { entries: { where: { event: "Create" } } }, orderBy: { id: "asc" } });
    assert.ok(rows.every((r) => /^ARI\/2026\/09\/\d{4}$/.test(r.ar_item_no)));
    assert.ok(Number(rows[1].ar_item_no.slice(-4)) > Number(rows[0].ar_item_no.slice(-4)), "the series runs on");
    assert.ok(rows.every((r) => r.source_no.includes("/Advance/") || r.source_no.includes("/Invoice/")));
    assert.ok(rows.every((r) => r.entries[0].doc_no.includes("/R/")), "the Create entry names the creating posting");
    const report = await openArItemsAsOf("Advance", "2026-09-30", f.customer);
    assert.equal(report[0].arItemNo, rows[0].ar_item_no);
    assert.match(report[0].createdByNo, /\/R\//);
    assert.equal(report[0].scopeId, 1);
  });

  test("a report for a past date reads the entries, not today's balance", async () => {
    const before = await openArItemsAsOf("Advance", "2026-09-05", f.customer);
    assert.deepEqual(before.map((r) => [r.original, r.settled, r.open]), [[1_000_000, 0, 1_000_000]]);
    const now = await openArItemsAsOf("Advance", "2026-09-30", f.customer);
    assert.deepEqual(now.map((r) => [r.original, r.settled, r.open]), [[1_000_000, 400_000, 600_000]]);
    assert.equal((await openArItemsAsOf("Invoice", "2026-09-09", f.customer)).length, 0, "not yet born");
  });

  test("each book runs in its own direction (P233)", async () => {
    const range = { from: "2026-09-05", to: "2026-09-30" };
    const piutang = await arBook("Invoice", range, [f.customer]);
    assert.deepEqual(piutang.subjects.map((s) => [s.opening, s.raised, s.lowered, s.closing]), [[0, 5_000_000, 0, 5_000_000]]);

    const advance = await arBook("Advance", range, [f.customer]);
    assert.deepEqual(advance.subjects.map((s) => [s.opening, s.raised, s.lowered, s.closing]), [[1_000_000, 0, 400_000, 600_000]], "received raises it, used lowers it");
    const [item] = advance.subjects[0].items;

    const page = await arBookEntriesPage("Advance", f.customer, range, null);
    assert.deepEqual(page.entries.map((e) => [e.eventText, e.movement]), [["Dipakai Invoice", -400_000]]);
    assert.equal(page.entries[0].sourceNo, item.sourceNo, "an entry names the document that moved (P234)");
    assert.equal(page.next, null);
  });

  test("an item is listed while it stands or moves, and not before it is born (P233)", async () => {
    const later = await arBook("Advance", { from: "2026-10-01", to: "2026-10-31" }, [f.customer]);
    assert.deepEqual(later.subjects[0].items.map((i) => [i.opening, i.closing]), [[600_000, 600_000]]);
    const none = await arBook("Invoice", { from: "2026-09-01", to: "2026-09-02" }, [f.customer]);
    assert.deepEqual(none.subjects, []);
  });

  test("its base is relieved at its own carrying rate, and the last relief empties it exactly (MC10)", async () => {
    // 100 carried at 1.501.234 (a carrying rate no deal quoted): 30 releases
    // round(30 × 1.501.234 / 100) to the sen, the rest releases what is left.
    // Dated after the other tests' report ranges.
    const inv = await make("Invoice", "2027-01-12", 100, "2027-02-12", 1_501_234);
    const settle = (amount: number, no: string) =>
      prisma.$transaction((tx) =>
        settleArItem(tx, { itemId: inv, event: "Payment", amount, date: "2027-01-13", doc: { docTypeId: f.billType, docId: f.doc, no }, actorId: actor })
      );
    assert.equal(await settle(30, "BKM/FX1"), 450_370.2);
    assert.equal(await settle(70, "BKM/FX2"), 1_050_863.8);
    const row = await prisma.finArItem.findUniqueOrThrow({ where: { id: inv }, include: { entries: { orderBy: { id: "asc" } } } });
    assert.deepEqual([row.current_balance.toNumber(), row.base_current_balance.toNumber()], [0, 0]);
    assert.deepEqual(row.entries.map((e) => e.base_movement.toNumber()), [1_501_234, -450_370.2, -1_050_863.8]);
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

  test("the tree adds up at both levels and leaves an Uang Muka out of the buckets (P235)", () => {
    const row = (id: number, partnerId: number, open: number, dueDate: string | null): AgingRow => ({
      id,
      partnerId,
      partnerLabel: `P${partnerId}`,
      partnerName: `Partner ${partnerId}`,
      date: "2026-08-01",
      dueDate,
      open,
      sourceNo: `DOC/${id}`,
      sourceTable: "fin_ar_invoice",
      sourceId: id,
    });
    const tree = foldAging(
      [row(1, 2, 100.1, "2026-10-20"), row(2, 2, 200.2, "2026-09-01"), row(3, 1, 300, "2026-12-01"), row(4, 2, 50, null)],
      [row(5, 2, 75, null), row(6, 3, 10, null)],
      "2026-10-31"
    );
    assert.deepEqual(tree.partners.map((p) => p.label), ["P1", "P2", "P3"]);
    const [, two, three] = tree.partners;
    assert.deepEqual(two.invoices.map((d) => [d.sourceNo, d.days, d.bucket]), [
      ["DOC/4", 91, "over90"],
      ["DOC/2", 60, "d60"],
      ["DOC/1", 11, "d30"],
    ], "oldest due first, no due date ages from its own date");
    assert.deepEqual(two.buckets, { current: 0, d30: 100.1, d60: 200.2, d90: 0, over90: 50 });
    assert.deepEqual([two.invoice, two.advance, two.net], [350.3, 75, 275.3]);
    assert.deepEqual([three.invoice, three.advance, three.net], [0, 10, -10], "an advance alone still has its row");
    assert.deepEqual(tree.totals.buckets, { current: 300, d30: 100.1, d60: 200.2, d90: 0, over90: 50 });
    assert.deepEqual([tree.totals.invoice, tree.totals.advance, tree.totals.net], [650.3, 85, 565.3]);
  });
});
