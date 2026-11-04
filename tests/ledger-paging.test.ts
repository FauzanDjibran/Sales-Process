import test, { after, before, describe } from "node:test";
import assert from "node:assert/strict";

import { postJournal } from "../src/lib/erp/journal";
import { generalLedgerReport, ledgerEntriesPage } from "../src/lib/erp/ledger";
import type { LedgerEntry } from "../src/lib/erp/ledger";
import { CASH_BANK_SUBCATEGORY } from "../src/lib/erp/records";
import {
  cleanupFixtures,
  disconnect,
  makeAccount,
  makePartner,
  prisma,
  systemUserId,
} from "./helpers";

/**
 * A General Ledger account opened a hundred entries at a time.
 *
 * The page states the rollup from the database's own sums and fetches rows when
 * an account is opened, so the two roads must agree: the rollup equals what
 * summing every line gives, and the pages put end to end are the full ledger,
 * Saldo included.
 */

const RANGE = { from: "1991-01-01", to: "1991-12-31" };
const JOURNALS = 130;

let cash = 0;
let payable = 0;

before(async () => {
  const actor = await systemUserId();
  const currency = (
    await prisma.refCurrency.findFirstOrThrow({ orderBy: { id: "asc" }, select: { id: true } })
  ).id;
  cash = await makeAccount({ subcategoryLabel: CASH_BANK_SUBCATEGORY });
  payable = await makeAccount({ subcategoryLabel: "2.1.1", partnerCategoryLabel: "Supplier" });
  const supplier = await makePartner({ categoryLabel: "Supplier" });

  const line = (accountId: number, debit: number, credit: number, partnerId: number | null) => ({
    accountId,
    partnerId,
    currencyId: currency,
    rate: 1,
    debit,
    credit,
    description: "Fixture",
  });

  // Several journals share a day, so the cursor has to order within one.
  for (let i = 0; i < JOURNALS; i++) {
    const amount = 1_000 + i;
    await postJournal(prisma, {
      description: `Fixture ledger paging ${i}`,
      postingDate: new Date(Date.UTC(1991, i % 6, 1 + (i % 20))),
      // One line naming a Partner on an account that takes none.
      lines: [line(cash, amount, 0, i === 7 ? supplier : null), line(payable, 0, amount, supplier)],
      actorId: actor,
    });
  }
});

after(async () => {
  await cleanupFixtures();
  await disconnect();
});

const same = (a: LedgerEntry, b: LedgerEntry) =>
  a.journalId === b.journalId &&
  a.date === b.date &&
  Math.round(a.debit * 100) === Math.round(b.debit * 100) &&
  Math.round(a.credit * 100) === Math.round(b.credit * 100) &&
  Math.round(a.balance * 100) === Math.round(b.balance * 100);

describe("a ledger account opened a page at a time", () => {
  test("the rollup from the database equals the sum of the lines", async () => {
    const full = (await generalLedgerReport([cash], RANGE)).accounts[0];
    const rollup = (await generalLedgerReport([cash], RANGE, [], { entries: false })).accounts[0];

    assert.equal(rollup.entries.length, 0, "a summary run reads no line");
    assert.equal(rollup.entryCount, JOURNALS);
    assert.equal(rollup.entryCount, full.entryCount);
    assert.equal(Math.round(rollup.debit * 100), Math.round(full.debit * 100));
    assert.equal(Math.round(rollup.credit * 100), Math.round(full.credit * 100));
    assert.equal(Math.round(rollup.closing * 100), Math.round(full.closing * 100));
    assert.equal(rollup.mismatchCount, 1, "the Partner on an account that takes none is counted");
    assert.equal(rollup.mismatchCount, full.mismatchCount);
    assert.deepEqual(rollup.foreignCurrencies, full.foreignCurrencies);
  });

  test("pages end to end are the whole ledger, Saldo included", async () => {
    const full = (await generalLedgerReport([cash], RANGE)).accounts[0];

    const first = await ledgerEntriesPage(cash, RANGE, null);
    assert.ok(first);
    assert.equal(first.entries.length, 100);
    assert.ok(first.next, "more remain after a hundred");

    const second = await ledgerEntriesPage(cash, RANGE, first.next);
    assert.ok(second);
    assert.equal(second.entries.length, JOURNALS - 100);
    assert.equal(second.next, null, "the last page says so");

    const joined = [...first.entries, ...second.entries];
    assert.equal(joined.length, full.entries.length);
    joined.forEach((e, i) => assert.ok(same(e, full.entries[i]), `entry ${i} differs`));
    assert.equal(
      Math.round(second.entries[second.entries.length - 1].balance * 100),
      Math.round(full.closing * 100),
      "the last Saldo is the closing balance"
    );
  });

  test("a narrowed account pages only its Partner's lines", async () => {
    const supplierLines = await generalLedgerReport([cash], RANGE, []);
    const withPartner = supplierLines.accounts[0].entries.filter((e) => e.partnerLabel);
    const partner = await prisma.mPartner.findFirstOrThrow({
      where: { partner_label: withPartner[0].partnerLabel! },
      select: { id: true },
    });
    const page = await ledgerEntriesPage(cash, RANGE, null, [partner.id]);
    assert.equal(page?.entries.length, 1);
  });

  test("a period with no lines has no pages", async () => {
    const page = await ledgerEntriesPage(cash, { from: "1992-01-01", to: "1992-12-31" }, null);
    assert.ok(page);
    assert.deepEqual(page.entries, []);
    assert.equal(page.next, null);
  });
});
