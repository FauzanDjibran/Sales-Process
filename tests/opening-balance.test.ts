import test, { after, before, describe } from "node:test";
import assert from "node:assert/strict";

import {
  OpeningBalanceImbalance,
  getOpeningBalance,
  writeOpeningBalance,
} from "../src/lib/erp/opening-balance";
import { JournalImbalance, postJournal } from "../src/lib/erp/journal";
import { closingBalances, generalLedgerReport } from "../src/lib/erp/ledger";
import { CASH_BANK_SUBCATEGORY } from "../src/lib/erp/records";
import {
  FIXTURE_PREFIX,
  cleanupFixtures,
  disconnect,
  makeAccount,
  makePartner,
  prisma,
  systemUserId,
} from "./helpers";

/**
 * The Opening Balance store, and the two things it rests on.
 *
 * A snapshot is immutable and has no rebuild function, so everything that
 * guarantees it is true has to happen at the moment it is written: it balances,
 * and it holds one line per `(account, partner?)` pair. Both are pushed at from
 * the two sides they could be got round — the writer's own checks, and the
 * database underneath it.
 *
 * `closingBalances` is the other half. It is what a close will hand the writer,
 * and its one property is that it agrees with the General Ledger: the same
 * journal lines, read at a finer grain, must still roll up to the same figure
 * the ledger prints.
 */

/**
 * A Draft fiscal year in the distant past, so nothing real collides with it.
 *
 * Draft rather than Open for two reasons. A snapshot attaches to a Draft year
 * by design — a close writes into the year that has not started yet, and §3.9
 * of the phase plan says Draft is enough. And an extra *Open* year would count
 * against the max-two-Open rule that `fiscal.test.ts` exercises, which is a
 * hazard when test files run side by side.
 */
const FIXTURE_YEAR = 1990;
const FIXTURE_YEAR_CODE = `fyr.${FIXTURE_PREFIX}${FIXTURE_YEAR}`;

let actor = 0;
let fiscalYear = 0;
let madeFiscalYear = false;
let currency = 0;

/**
 * Two sets of fixtures: each one account that names a Partner and one that
 * does not.
 *
 * The `doc*` accounts carry the written document, the others carry the
 * journals `closingBalances` reads. Keeping them apart means neither case can
 * disturb the other.
 */
let docReceivable = 0;
let docCash = 0;
let docBranch = 0;
let docBranch2 = 0;
let receivable = 0;
let cash = 0;
let branchA = 0;
let branchB = 0;

const openings: number[] = [];

before(async () => {
  actor = await systemUserId();
  currency = (
    await prisma.refCurrency.findFirstOrThrow({
      orderBy: { id: "asc" },
      select: { id: true },
    })
  ).id;

  const existing = await prisma.accFiscalYear.findFirst({
    where: { year_code: FIXTURE_YEAR_CODE },
    select: { id: true },
  });
  if (existing) {
    fiscalYear = existing.id;
  } else {
    fiscalYear = (
      await prisma.accFiscalYear.create({
        data: {
          year_code: FIXTURE_YEAR_CODE,
          year_label: String(FIXTURE_YEAR),
          year_name: `Tahun Buku ${FIXTURE_YEAR}`,
          start_date: new Date(Date.UTC(FIXTURE_YEAR, 0, 1)),
          end_date: new Date(Date.UTC(FIXTURE_YEAR, 11, 31)),
          status: "Draft",
          created_by: actor,
        },
        select: { id: true },
      })
    ).id;
    madeFiscalYear = true;
  }

  docReceivable = await makeAccount({
    subcategoryLabel: "1.1.4",
    partnerCategoryLabel: "Customer",
  });
  docCash = await makeAccount({
    subcategoryLabel: CASH_BANK_SUBCATEGORY,
  });
  docBranch = await makePartner({ categoryLabel: "Customer" });
  docBranch2 = await makePartner({ categoryLabel: "Customer" });

  receivable = await makeAccount({
    subcategoryLabel: "1.1.4",
    partnerCategoryLabel: "Customer",
  });
  cash = await makeAccount({
    subcategoryLabel: CASH_BANK_SUBCATEGORY,
  });
  branchA = await makePartner({ categoryLabel: "Customer" });
  branchB = await makePartner({ categoryLabel: "Customer" });
});

after(async () => {
  if (openings.length) {
    await prisma.accOpeningBalanceLine.deleteMany({
      where: { opening_id: { in: openings } },
    });
    await prisma.auditLog.deleteMany({
      where: { entity_key: "acc_opening_balance", row_id: { in: openings } },
    });
    await prisma.accOpeningBalance.deleteMany({ where: { id: { in: openings } } });
  }
  await cleanupFixtures();
  if (madeFiscalYear) {
    await prisma.accFiscalYear.deleteMany({ where: { id: fiscalYear } });
  }
  await disconnect();
});

const snapshot = (
  lines: { accountId: number; partnerId?: number | null; debit: number; credit: number }[]
) => ({
  fiscalYearId: fiscalYear,
  sourceFiscalYearId: null,
  postingDate: new Date(Date.UTC(FIXTURE_YEAR, 0, 1)),
  lines,
  actorId: actor,
});

// ------------------------------------------------- the document's two sides

describe("an Opening Balance balances, or it is not written", () => {
  test("a balanced snapshot is written, and reads back", async () => {
    const result = await writeOpeningBalance(
      prisma,
      snapshot([
        { accountId: docReceivable, partnerId: docBranch, debit: 300_000, credit: 0 },
        { accountId: docCash, debit: 700_000, credit: 0 },
        { accountId: docReceivable, partnerId: docBranch2, debit: 0, credit: 1_000_000 },
      ])
    );
    openings.push(result.id);
    assert.match(result.openingNo, /^OPB-\d{4}$/);

    const detail = await getOpeningBalance(result.id);
    assert.ok(detail, "the snapshot reads back");
    assert.equal(detail.lines.length, 3);
    assert.equal(detail.debit, 1_000_000);
    assert.equal(detail.credit, 1_000_000);
    // Nothing produced it, which is what marks a go-live snapshot.
    assert.equal(detail.sourceFiscalYearLabel, null);
    // Sequence numbers are the writer's, in the order it was handed the lines.
    assert.deepEqual(
      detail.lines.map((l) => l.sequenceNo),
      [1, 2, 3]
    );
  });

  test("an unbalanced snapshot is refused and writes nothing", async () => {
    const before = await prisma.accOpeningBalance.count();

    await assert.rejects(
      writeOpeningBalance(
        prisma,
        snapshot([
          { accountId: cash, debit: 1_000_000, credit: 0 },
          { accountId: receivable, partnerId: branchA, debit: 0, credit: 999_999 },
        ])
      ),
      OpeningBalanceImbalance
    );

    assert.equal(
      await prisma.accOpeningBalance.count(),
      before,
      "a refused snapshot must leave no header behind"
    );
  });

  test("a line carrying both sides, or neither, is refused", async () => {
    for (const line of [
      { accountId: cash, debit: 500_000, credit: 500_000 },
      { accountId: cash, debit: 0, credit: 0 },
    ]) {
      await assert.rejects(
        writeOpeningBalance(
          prisma,
          snapshot([
            line,
            { accountId: receivable, partnerId: branchA, debit: 0, credit: 500_000 },
          ])
        ),
        /tepat satu sisi/
      );
    }
  });

  test("a snapshot with no lines is refused", async () => {
    await assert.rejects(
      writeOpeningBalance(prisma, snapshot([])),
      /tanpa baris/
    );
  });
});

// ------------------------------------------------------- one line per pair

describe("one line per (account, partner?) pair", () => {
  test("the same account and partner twice is refused, by name", async () => {
    await assert.rejects(
      writeOpeningBalance(
        prisma,
        snapshot([
          { accountId: receivable, partnerId: branchA, debit: 400_000, credit: 0 },
          { accountId: receivable, partnerId: branchA, debit: 0, credit: 400_000 },
        ])
      ),
      /lebih dari satu kali/
    );
  });

  test("the same account with no partner twice is refused", async () => {
    // The case Postgres would let through on its own: NULL is distinct from
    // NULL by default, and an account naming no Partner is the common shape.
    await assert.rejects(
      writeOpeningBalance(
        prisma,
        snapshot([
          { accountId: cash, debit: 400_000, credit: 0 },
          { accountId: cash, debit: 0, credit: 400_000 },
        ])
      ),
      /tanpa partner/
    );
  });

  test("the database refuses a duplicate pair on its own", async () => {
    // The writer's check is the readable refusal; this is the guarantee under
    // it. A second null-partner row for one account is what `NULLS NOT
    // DISTINCT` exists for, and nothing else in the schema is written that way.
    const [opening] = openings;
    await assert.rejects(
      prisma.accOpeningBalanceLine.create({
        data: {
          opening_id: opening,
          sequence_no: 99,
          account_id: docCash,
          partner_id: null,
          debit_amount: 1,
          kredit_amount: 0,
          created_by: actor,
        },
      }),
      /Unique constraint|unique/i
    );

    await assert.rejects(
      prisma.accOpeningBalanceLine.create({
        data: {
          opening_id: opening,
          sequence_no: 98,
          account_id: docReceivable,
          partner_id: docBranch,
          debit_amount: 1,
          kredit_amount: 0,
          created_by: actor,
        },
      }),
      /Unique constraint|unique/i
    );
  });

  test("one snapshot per fiscal year", async () => {
    await assert.rejects(
      writeOpeningBalance(
        prisma,
        snapshot([
          { accountId: docCash, debit: 1_000, credit: 0 },
          { accountId: docReceivable, partnerId: docBranch, debit: 0, credit: 1_000 },
        ])
      ),
      /Unique constraint|unique/i,
      "a second answer to where the books stood on 1 January must be unreachable"
    );
  });

});

// ------------------------------------------- what a close will be handed

describe("closingBalances agrees with the General Ledger", () => {
  const WHOLE_TIME = { from: "2000-01-01", to: "2999-12-31" };
  const AS_OF = "2999-12-31";

  before(async () => {
    const line = (
      accountId: number,
      partnerId: number | null,
      debit: number,
      credit: number
    ) => ({
      accountId,
      partnerId,
      currencyId: currency,
      rate: 1,
      debit,
      credit,
      description: "Fixture",
    });

    const post = (lines: ReturnType<typeof line>[]) =>
      postJournal(prisma, {
        description: "Fixture closing-balance journal",
        lines,
        actorId: actor,
      });

    await post([
      line(receivable, branchA, 300_000, 0),
      line(cash, null, 0, 300_000),
    ]);
    await post([
      line(receivable, branchB, 200_000, 0),
      line(cash, null, 0, 200_000),
    ]);
    await post([
      line(cash, null, 100_000, 0),
      line(receivable, branchA, 0, 100_000),
    ]);
  });

  test("the partner grain is what was actually posted", async () => {
    const rows = (await closingBalances(AS_OF)).filter(
      (r) => r.accountId === receivable
    );

    assert.deepEqual(
      rows.map((r) => [r.partnerId, r.net]).sort((a, b) => Number(a[0]) - Number(b[0])),
      [
        [branchA, 200_000],
        [branchB, 200_000],
      ].sort((a, b) => Number(a[0]) - Number(b[0])),
      "one row per Partner actually posted against, at that Partner's own figure"
    );
  });

  test("the pairs roll up to the General Ledger's closing balance", async () => {
    const pairs = await closingBalances(AS_OF);
    const ledger = await generalLedgerReport(
      [receivable, cash],
      WHOLE_TIME
    );

    for (const account of ledger.accounts) {
      const rolled = pairs
        .filter((p) => p.accountId === account.id)
        .reduce((t, p) => t + p.balance, 0);
      assert.equal(
        Math.round(rolled * 100),
        Math.round(account.closing * 100),
        `${account.label} disagrees with its own General Ledger`
      );
    }
  });

  test("an account with no Partner keeps one null-partner row", async () => {
    const rows = (await closingBalances(AS_OF)).filter(
      (r) => r.accountId === cash
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].partnerId, null);
    // Kredit-side movement on a Debit account: 400.000 out, and the raw net
    // and the normal-balance signing disagree in sign, which is the whole
    // reason both are carried.
    assert.equal(rows[0].net, -400_000);
    assert.equal(rows[0].balance, -400_000);
  });

  test("a pair that settles to nothing is not a row", async () => {
    const settled = await makePartner({ categoryLabel: "Customer" });
    const line = (debit: number, credit: number, partnerId: number | null) => ({
      accountId: partnerId ? receivable : cash,
      partnerId,
      currencyId: currency,
      rate: 1,
      debit,
      credit,
      description: "Fixture",
    });

    await postJournal(prisma, {
      description: "Fixture settled pair",
      lines: [line(50_000, 0, settled), line(0, 50_000, null)],
      actorId: actor,
    });
    await postJournal(prisma, {
      description: "Fixture settled pair",
      lines: [line(0, 50_000, settled), line(50_000, 0, null)],
      actorId: actor,
    });

    const rows = await closingBalances(AS_OF);
    assert.equal(
      rows.filter((r) => r.partnerId === settled).length,
      0,
      "a Partner who owes nothing holds no position, and a zero line says nothing"
    );
  });

  test("a date cuts the balance off", async () => {
    // Every fixture journal is dated today, and the closing entry below is
    // dated the last day of 1990, so a balance struck in 1980 sees none of
    // them.
    const rows = (await closingBalances("1980-01-01")).filter(
      (r) => r.accountId === receivable || r.accountId === cash
    );
    assert.deepEqual(rows, []);
  });
});

// ------------------------------------------- the closing journal's series

describe("a closing journal names its own date and series", () => {
  const line = (accountId: number, debit: number, credit: number) => ({
    accountId,
    currencyId: currency,
    rate: 1,
    debit,
    credit,
    description: "Fixture",
  });

  test("CLS is its own series, dated the day it is given", async () => {
    const lastDay = new Date(Date.UTC(FIXTURE_YEAR, 11, 31));
    const result = await postJournal(prisma, {
      description: "Fixture closing journal",
      series: "CLS",
      postingDate: lastDay,
      lines: [line(cash, 1_000, 0), line(receivable, 0, 1_000)],
      actorId: actor,
    });

    assert.match(result.journalNo, /^CLS-\d{4}$/);
    const written = await prisma.accJournal.findUniqueOrThrow({
      where: { id: result.id },
      select: { posting_date: true, status: true },
    });
    assert.equal(written.posting_date?.toISOString(), lastDay.toISOString());
    assert.equal(written.status, "Posted");
  });

  test("the balance rule is unchanged by the series", async () => {
    await assert.rejects(
      postJournal(prisma, {
        description: "Fixture closing journal",
        series: "CLS",
        postingDate: new Date(Date.UTC(FIXTURE_YEAR, 11, 31)),
        lines: [line(cash, 1_000, 0), line(receivable, 0, 999)],
        actorId: actor,
      }),
      JournalImbalance
    );
  });

  test("an ordinary journal may be backdated, but never dated ahead", async () => {
    // Backdating is allowed; whether the day is inside an open period is the
    // caller's question (`checkTransactionDate`). What the engine itself
    // refuses is a day that has not happened yet.
    const tomorrow = new Date(Date.now() + 86_400_000);
    await assert.rejects(
      postJournal(prisma, {
        description: "Fixture future journal",
        postingDate: new Date(`${tomorrow.toISOString().slice(0, 10)}T00:00:00Z`),
        lines: [line(cash, 1_000, 0), line(receivable, 0, 1_000)],
        actorId: actor,
      }),
      /masa depan/
    );
  });

  test("an ordinary posting is still dated today, in the JRN series", async () => {
    const result = await postJournal(prisma, {
      description: "Fixture ordinary journal",
      lines: [line(cash, 1_000, 0), line(receivable, 0, 1_000)],
      actorId: actor,
    });
    assert.match(result.journalNo, /^JRN-\d{4}$/);

    const written = await prisma.accJournal.findUniqueOrThrow({
      where: { id: result.id },
      select: { posting_date: true },
    });
    assert.equal(
      written.posting_date?.toISOString().slice(0, 10),
      new Date().toISOString().slice(0, 10)
    );
  });
});
