import test, { after, before, describe } from "node:test";
import assert from "node:assert/strict";

import {
  cashBankEntriesPage,
  cashBankLedgerReport,
  openCashBankBook,
  recordCashBankEntry,
} from "../src/lib/erp/cash-bank";
import { CASH_BANK_SUBCATEGORY } from "../src/lib/erp/records";
import {
  FIXTURE_PREFIX,
  cleanupFixtures,
  disconnect,
  makeAccount,
  prisma,
  systemUserId,
} from "./helpers";

/**
 * Buku Kas & Bank opened a page at a time: the rollup the page states from the
 * database's own sums equals what summing the entries gives, and the pages put
 * end to end are the whole book, in its own order.
 */

const RANGE = { from: "2020-02-01", to: "2020-08-31" };
const ENTRIES = 130;
const cents = (n: number) => Math.round(n * 100);

let cashBank = 0;

before(async () => {
  const actor = await systemUserId();
  const currency = (
    await prisma.refCurrency.findFirstOrThrow({ orderBy: { id: "asc" }, select: { id: true } })
  ).id;
  const account = await makeAccount({ subcategoryLabel: CASH_BANK_SUBCATEGORY });
  const key = `${FIXTURE_PREFIX}PG${Date.now() % 100000}`;
  cashBank = (
    await prisma.mCashBank.create({
      data: {
        cash_bank_code: `test.${key}`,
        cash_bank_label: key,
        cash_bank_name: `Fixture ${key}`,
        cash_bank_type: "Cash",
        currency_id: currency,
        account_id: account,
        created_by: actor,
      },
      select: { id: true },
    })
  ).id;
  await openCashBankBook(prisma, { cashBankId: cashBank, openingBalance: 0, rate: 1, date: "2020-01-01", actorId: actor });

  await recordCashBankEntry(prisma, { cashBankId: cashBank, date: "2020-01-15", type: "Transaction", direction: "In", amount: 900, rate: 1, actorId: actor });
  // Several entries share a day, so the cursor has to order within one.
  for (let i = 0; i < ENTRIES; i++) {
    const date = `2020-0${2 + (i % 5)}-${String(2 + (i % 9)).padStart(2, "0")}`;
    await recordCashBankEntry(prisma, { cashBankId: cashBank, date, type: "Transaction", direction: "In", amount: 100 + i, rate: 1, actorId: actor });
  }
});

after(async () => {
  await prisma.cashBankLedger.deleteMany({ where: { cash_bank_id: cashBank } });
  await prisma.cashBankPeriod.deleteMany({ where: { cash_bank_id: cashBank } });
  await prisma.cashBankBalance.deleteMany({ where: { cash_bank_id: cashBank } });
  await prisma.mCashBank.deleteMany({ where: { id: cashBank } });
  await cleanupFixtures();
  await disconnect();
});

describe("Buku Kas & Bank opened a page at a time", () => {
  test("the rollup from the database equals the sum of the entries", async () => {
    const full = (await cashBankLedgerReport(cashBank, RANGE))!;
    const rollup = (await cashBankLedgerReport(cashBank, RANGE, { entries: false }))!;

    assert.equal(rollup.entries.length, 0, "a summary run reads no entry");
    assert.equal(rollup.entryCount, ENTRIES);
    assert.equal(rollup.entryCount, full.entryCount);
    assert.equal(rollup.opening, 900);
    for (const f of ["opening", "totalIn", "totalOut", "closing", "baseTotalIn", "baseTotalOut", "baseClosing"] as const) {
      assert.equal(cents(rollup[f]), cents(full[f]), `${f} differs`);
    }
    assert.equal(rollup.reconciles, full.reconciles);
  });

  test("pages end to end are the whole book, in its order", async () => {
    const full = (await cashBankLedgerReport(cashBank, RANGE))!;
    const first = await cashBankEntriesPage(cashBank, RANGE, null);
    assert.ok(first);
    assert.equal(first.entries.length, 100);
    assert.ok(first.next);

    const second = await cashBankEntriesPage(cashBank, RANGE, first.next);
    assert.ok(second);
    assert.equal(second.entries.length, ENTRIES - 100);
    assert.equal(second.next, null);

    assert.deepEqual(
      [...first.entries, ...second.entries].map((e) => e.id),
      full.entries.map((e) => e.id)
    );
  });
});
