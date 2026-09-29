import test, { after, before, describe } from "node:test";
import assert from "node:assert/strict";

import { postJournal, readDraftJournal } from "../src/lib/erp/journal";
import {
  JOURNAL_TRANSITIONS,
  availableJournalActions,
  journalAbilities,
  journalIsEditable,
} from "../src/lib/erp/journal-workflow";
import {
  cancelManualJournal,
  checkManualJournal,
  createManualJournal,
  manualJournalOptions,
  postManualJournal,
  updateManualJournal,
} from "../src/lib/erp/manual-journal";
import { generalLedgerReport, trialBalanceReport } from "../src/lib/erp/ledger";
import { knownAuditEvents } from "../src/lib/erp/audit-events";
import {
  cleanupFiscalYear,
  cleanupFixtures,
  closeYear,
  openFiscalYear,
  disconnect,
  makeAccount,
  makePartner,
  prisma,
  systemUserId,
} from "./helpers";

/**
 * The manual journal, and the one thing it must never be able to do.
 *
 * A hand-written journal line touching an account that a book outside the
 * General Ledger reconciles against would move one and leave the other behind,
 * and **nothing would error** — the application would simply stop being able to
 * prove its own figures. Every refusal below is pushed at from the side it
 * could be got round: the Server Action is reachable directly, so the picker
 * narrowing its list is not the protection.
 *
 * The second theme is that a draft is not accounting. It has no posting date,
 * the General Ledger cannot see it, the Trial Balance does not count it, and it
 * is allowed not to balance — the balance is a rule about posting, not about
 * saving.
 */

let actor = 0;
let fiscalYear = 0;

/** Freely writable: an expense account reconciles against nothing but the GL. */
let expense = 0;
let expenseB = 0;
let baseCurrency = 0;
let foreignCurrency = 0;

const made: number[] = [];

before(async () => {
  // Posting is refused outside an Open fiscal year (`checkPostingPeriod`),
  // and the seed opens none — a calendar is business data. Reused when the
  // database already has one; removed again only if this run made it.
  fiscalYear = await openFiscalYear();
  actor = await systemUserId();

  expense = await makeAccount({ subcategoryLabel: "5.3.1" });
  expenseB = await makeAccount({ subcategoryLabel: "5.3.1" });

  baseCurrency = (
    await prisma.refCurrency.findFirstOrThrow({
      where: { currency_label: "IDR" },
      select: { id: true },
    })
  ).id;
  const foreign = await prisma.refCurrency.findFirst({
    where: { currency_label: { not: "IDR" }, status: "Active" },
    orderBy: { id: "asc" },
    select: { id: true },
  });
  foreignCurrency = foreign?.id ?? 0;
});

after(async () => {
  // Drafts and cancelled journals are fixtures of this run, written against
  // accounts that are about to stop existing. `cleanupFixtures` removes the
  // journals reached through those accounts; anything created without one is
  // removed here.
  for (const id of made) {
    await prisma.accJournalLine.deleteMany({ where: { journal_id: id } });
    await prisma.auditLog.deleteMany({
      where: { entity_key: "acc_journal", row_id: id },
    });
    await prisma.accJournal.deleteMany({ where: { id } });
  }
  await cleanupFiscalYear();
  await cleanupFixtures();
  await disconnect();
});

const line = (
  accountId: number,
  debit: number,
  credit: number,
  extra: Partial<{
    partner_id: number | null;
    currency_id: number | null;
    exchange_rate: number | null;
  }> = {}
) => ({
  account_id: accountId,
  partner_id: extra.partner_id ?? null,
  currency_id:
    extra.currency_id === undefined ? baseCurrency : extra.currency_id,
  exchange_rate: extra.exchange_rate ?? null,
  debit,
  credit,
  description: "",
});

const header = { description: "Fixture journal manual" };
const headerFor = () => ({ ...header });

async function draft(lines: ReturnType<typeof line>[]) {
  const result = await createManualJournal(headerFor(), lines, actor);
  assert.ok(result.ok, `draft was refused: ${JSON.stringify(result)}`);
  made.push(result.id);
  return result;
}

// ------------------------------------------------------- control accounts

describe("a manual journal may not touch a control account", () => {
  test("an account the user marked as a control account is refused", async () => {
    const declared = await makeAccount({
      subcategoryLabel: "5.3.1",
      controlAccount: true,
    });
    const refused = await checkManualJournal(headerFor(), [
      line(declared, 50_000, 0),
      line(expense, 0, 50_000),
    ]);
    assert.equal(refused.ok, false);
    const message = refused.ok ? "" : refused.errors["lines.0.account_id"];
    assert.match(message, /control account/i);
    // The refusal says what to do instead: a user told only "tidak dapat
    // dipilih" learns nothing they can act on.
    assert.match(message, /dokumen/);
  });

  test("the picker offers exactly what the check accepts", async () => {
    const controlled = await makeAccount({
      subcategoryLabel: "5.3.1",
      controlAccount: true,
    });
    const inactive = await makeAccount({
      subcategoryLabel: "5.3.1",
      active: false,
    });
    const parent = await makeAccount({
      subcategoryLabel: "5.3.1",
    });
    await makeAccount({
      subcategoryLabel: "5.3.1",
      parentId: parent,
    });

    const { accounts } = await manualJournalOptions();
    const offered = new Set(accounts.map((a) => a.id));

    assert.ok(offered.has(expense), "an ordinary expense account is offered");
    assert.ok(!offered.has(controlled), "a control account is not offered");
    assert.ok(!offered.has(inactive), "an inactive account is not offered");
    assert.ok(
      !offered.has(parent),
      "an account with a sub-account is a heading, not a destination"
    );
  });
});

// ----------------------------------------------------------- the line rules

describe("a line states enough to be accounting", () => {
  test("a header account is refused even when its flag says postable", async () => {
    const parent = await makeAccount({
      subcategoryLabel: "5.3.1",
    });
    await makeAccount({
      subcategoryLabel: "5.3.1",
      parentId: parent,
    });
    // The tree is the enforcement, not the flag: an account that somehow still
    // carried `is_postable` has to be refused anyway.
    await prisma.accAccount.update({
      where: { id: parent },
      data: { is_postable: true },
    });

    const refused = await checkManualJournal(headerFor(), [
      line(parent, 10_000, 0),
      line(expense, 0, 10_000),
    ]);
    assert.equal(refused.ok, false);
    assert.match(
      refused.ok ? "" : refused.errors["lines.0.account_id"],
      /header/i
    );
  });

  test("an account that names a Partner Category demands a matching Partner", async () => {
    const withPartner = await makeAccount({
      subcategoryLabel: "5.3.1",
      partnerCategoryLabel: "Customer",
    });

    const missing = await checkManualJournal(headerFor(), [
      line(withPartner, 10_000, 0),
      line(expense, 0, 10_000),
    ]);
    assert.equal(missing.ok, false);
    assert.ok(missing.ok || missing.errors["lines.0.partner_id"]);

    const wrongCategory = await makePartner({
      categoryLabel: "Supplier",
    });
    const mismatched = await checkManualJournal(headerFor(), [
      line(withPartner, 10_000, 0, { partner_id: wrongCategory }),
      line(expense, 0, 10_000),
    ]);
    assert.equal(mismatched.ok, false);
    assert.match(
      mismatched.ok ? "" : mismatched.errors["lines.0.partner_id"],
      /Partner Category/
    );

    const right = await makePartner({
      categoryLabel: "Customer",
    });
    const accepted = await checkManualJournal(headerFor(), [
      line(withPartner, 10_000, 0, { partner_id: right }),
      line(expense, 0, 10_000),
    ]);
    assert.equal(accepted.ok, true);
  });

  test("a line fills exactly one side", async () => {
    const both = await checkManualJournal(headerFor(), [
      line(expense, 10_000, 10_000),
      line(expenseB, 0, 10_000),
    ]);
    assert.equal(both.ok, false);
    assert.ok(both.ok || both.errors["lines.0.amount"]);

    const neither = await checkManualJournal(headerFor(), [
      line(expense, 0, 0),
      line(expenseB, 0, 10_000),
    ]);
    assert.equal(neither.ok, false);
    assert.ok(neither.ok || neither.errors["lines.0.amount"]);
  });

  test("a journal of one line is refused", async () => {
    const one = await checkManualJournal(headerFor(), [line(expense, 10_000, 0)]);
    assert.equal(one.ok, false);
    assert.ok(one.ok || one.errors._form);
  });

  test("a foreign line states its kurs; a base line is never asked for one", async (t) => {
    if (!foreignCurrency) return t.skip("no non-base currency on this database");

    const missingRate = await checkManualJournal(headerFor(), [
      line(expense, 100, 0, { currency_id: foreignCurrency }),
      line(expenseB, 0, 1_600_000),
    ]);
    assert.equal(missingRate.ok, false);
    assert.ok(missingRate.ok || missingRate.errors["lines.0.exchange_rate"]);

    const valued = await checkManualJournal(headerFor(), [
      line(expense, 100, 0, {
        currency_id: foreignCurrency,
        exchange_rate: 16_000,
      }),
      line(expenseB, 0, 1_600_000),
    ]);
    assert.ok(valued.ok);
    assert.equal(
      valued.debit,
      1_600_000,
      "debit and kredit are base currency; the foreign face is extra information"
    );
    assert.equal(valued.credit, 1_600_000);

    // A base-currency line is valued at the identity, and that is the only
    // case where a rate of 1 is right (CLAUDE.md §10 rule 68).
    assert.equal(valued.lines[1].rate, 1);
  });
});

// -------------------------------------------------------------- the draft

describe("a draft is not accounting", () => {
  test("an unbalanced draft saves, and refuses to post", async () => {
    const created = await draft([
      line(expense, 100_000, 0),
      line(expenseB, 0, 60_000),
    ]);

    const posted = await postManualJournal(created.id, actor);
    assert.equal(posted.ok, false);
    assert.match(posted.ok ? "" : posted.errors._form, /tidak seimbang/i);

    const row = await prisma.accJournal.findUniqueOrThrow({
      where: { id: created.id },
      select: { status: true, posting_date: true },
    });
    assert.equal(row.status, "Draft", "a refused post leaves the draft alone");
    // A draft carries the date it was written for (today, when a caller in
    // code names none) — a refused post neither clears nor moves it.
    assert.equal(
      row.posting_date?.toISOString().slice(0, 10),
      new Date().toISOString().slice(0, 10)
    );
  });

  test("a draft carries its date and is still invisible to both ledger reports", async () => {
    const created = await draft([
      line(expense, 250_000, 0),
      line(expenseB, 0, 250_000),
    ]);

    const range = { from: "2000-01-01", to: "2100-12-31" };
    const ledger = await generalLedgerReport([expense], range);
    const seen = ledger.accounts[0]?.entries.some(
      (e) => e.journalId === created.id
    );
    assert.equal(seen, false, "the General Ledger reads posted journals only");

    const trial = await trialBalanceReport(range);
    assert.equal(
      trial.unbalanced.some((j) => j.id === created.id),
      false,
      "a draft that does not balance yet is not a system fault"
    );
  });

  test("an edit replaces the draft's content", async () => {
    const created = await draft([
      line(expense, 10_000, 0),
      line(expenseB, 0, 10_000),
    ]);

    const updated = await updateManualJournal(
      created.id,
      { ...headerFor(), description: "Diubah" },
      [line(expense, 25_000, 0), line(expenseB, 0, 25_000)],
      actor
    );
    assert.ok(updated.ok);

    const read = await readDraftJournal(created.id);
    assert.equal(read?.description, "Diubah");
    assert.equal(read?.lines.length, 2);
    assert.equal(read?.lines[0].debit, 25_000);
  });

});

// --------------------------------------------------------------- posting

describe("post is the boundary, and it is the same engine", () => {
  test("a balanced draft posts, is dated today, and reaches the General Ledger", async () => {
    const created = await draft([
      line(expense, 400_000, 0),
      line(expenseB, 0, 400_000),
    ]);

    const posted = await postManualJournal(created.id, actor);
    assert.ok(posted.ok);

    const row = await prisma.accJournal.findUniqueOrThrow({
      where: { id: created.id },
      select: { status: true, posting_date: true, is_manual: true, journal_no: true },
    });
    assert.equal(row.status, "Posted");
    assert.equal(row.is_manual, true);
    assert.equal(
      row.posting_date?.toISOString().slice(0, 10),
      new Date().toISOString().slice(0, 10),
      "a journal is dated the day it was posted, never back-dated"
    );
    assert.match(
      row.journal_no,
      /^JV\/\d{4}\/\d{2}\/\d{4}$/,
      "every journal shares the JV series; is_manual says who typed it"
    );

    const ledger = await generalLedgerReport(
      [expense],
      { from: "2000-01-01", to: "2100-12-31" }
    );
    assert.ok(
      ledger.accounts[0].entries.some((e) => e.journalId === created.id),
      "a posted manual journal is ordinary accounting from that moment"
    );
  });

  test("a posted journal cannot be edited, posted again or cancelled", async () => {
    const created = await draft([
      line(expense, 70_000, 0),
      line(expenseB, 0, 70_000),
    ]);
    assert.ok((await postManualJournal(created.id, actor)).ok);

    const edited = await updateManualJournal(
      created.id,
      headerFor(),
      [line(expense, 1, 0), line(expenseB, 0, 1)],
      actor
    );
    assert.equal(edited.ok, false);
    assert.match(edited.ok ? "" : edited.errors._form, /Draft/);

    assert.equal((await postManualJournal(created.id, actor)).ok, false);
    assert.equal((await cancelManualJournal(created.id, actor)).ok, false);
  });

  test("an account that became a control account since refuses at post", async () => {
    // The plan can be complete and still be refused: the chart moved on. This
    // is the same reasoning `applyPosting` uses for re-reading its Budgets.
    const account = await makeAccount({
      subcategoryLabel: "5.3.1",
    });
    const created = await draft([
      line(account, 30_000, 0),
      line(expenseB, 0, 30_000),
    ]);

    await prisma.accAccount.update({
      where: { id: account },
      data: { is_control_account: true },
    });

    const refused = await postManualJournal(created.id, actor);
    assert.equal(refused.ok, false);
    assert.match(refused.ok ? "" : refused.errors._form, /control account/i);

    const row = await prisma.accJournal.findUniqueOrThrow({
      where: { id: created.id },
      select: { status: true },
    });
    assert.equal(row.status, "Draft", "a refused post writes nothing at all");
  });

  test("a cancelled draft is retired rather than deleted", async () => {
    const created = await draft([
      line(expense, 15_000, 0),
      line(expenseB, 0, 15_000),
    ]);
    assert.ok((await cancelManualJournal(created.id, actor)).ok);

    const row = await prisma.accJournal.findUniqueOrThrow({
      where: { id: created.id },
      select: { status: true, journal_no: true },
    });
    assert.equal(row.status, "Cancelled");
    assert.ok(row.journal_no, "the number stays behind as a trace");

    assert.equal((await postManualJournal(created.id, actor)).ok, false);
  });

  test("an automatic journal is not reachable from the manual path", async () => {
    const automatic = await postJournal(prisma, {
      description: "Fixture posting",
      lines: [
        {
          accountId: expense,
          currencyId: baseCurrency,
          rate: 1,
          debit: 5_000,
          credit: 0,
          description: "d",
        },
        {
          accountId: expenseB,
          currencyId: baseCurrency,
          rate: 1,
          debit: 0,
          credit: 5_000,
          description: "c",
        },
      ],
      actorId: actor,
    });
    made.push(automatic.id);

    assert.match(automatic.journalNo, /^JV\//);
    const refused = await updateManualJournal(
      automatic.id,
      headerFor(),
      [line(expense, 1, 0), line(expenseB, 0, 1)],
      actor
    );
    assert.equal(refused.ok, false);
    assert.match(
      refused.ok ? "" : refused.errors._form,
      /posting dokumen/,
      "a journal a document produced is final from the moment it exists"
    );
  });
});

// -------------------------------------------------------------- lifecycle

describe("the lifecycle is one table, read by both sides", () => {
  test("only a Draft offers anything, and only to whoever may", () => {
    const all = journalAbilities([
      "JOURNAL_CREATE",
      "JOURNAL_EDIT",
      "JOURNAL_POST",
      "JOURNAL_CANCEL",
    ]);
    assert.deepEqual(availableJournalActions("Draft", all), ["post", "cancel"]);
    assert.deepEqual(availableJournalActions("Posted", all), []);
    assert.deepEqual(availableJournalActions("Cancelled", all), []);

    const readOnly = journalAbilities(["JOURNAL_VIEW"]);
    assert.deepEqual(availableJournalActions("Draft", readOnly), []);
  });

  test("editing is confined to Draft", () => {
    assert.equal(journalIsEditable("Draft"), true);
    assert.equal(journalIsEditable("Posted"), false);
    assert.equal(journalIsEditable("Cancelled"), false);
  });

  test("nothing in the table produces a Draft, so Posted is one-way", () => {
    for (const t of Object.values(JOURNAL_TRANSITIONS)) {
      assert.notEqual(t.to, "Draft", `${t.label} would re-open a posted journal`);
    }
  });

  test("every transition can be named in a record's history", () => {
    const known = knownAuditEvents()["acc_journal"] ?? [];
    for (const key of Object.keys(JOURNAL_TRANSITIONS)) {
      assert.ok(
        known.includes(key),
        `${key} would read as a bare "Diubah" in the history panel`
      );
    }
  });
});

// ------------------------------------------------------------- the period lock

describe("a manual journal is refused outside an open period", () => {
  test("a closed year takes no hand-written entry either", async () => {
    const created = await draft([
      line(expense, 120_000, 0),
      line(expenseB, 0, 120_000),
    ]);

    // Asked in `postManualJournal` rather than in `postDraftJournal`: the
    // Journal is an independent book that imports only the shared kernel, so
    // the rule about *when* it may be written lives in the layer above it —
    // beside the control-account rule, which is there for the same reason.
    const reopen = await closeYear(fiscalYear);
    try {
      const refused = await postManualJournal(created.id, actor);
      assert.equal(refused.ok, false);
      assert.match(refused.ok ? "" : refused.errors._form, /sudah ditutup/);

      assert.equal(
        (
          await prisma.accJournal.findUniqueOrThrow({
            where: { id: created.id },
            select: { status: true, posting_date: true },
          })
        ).status,
        "Draft",
        "the draft is untouched — a refusal at Post is not a cancellation"
      );
    } finally {
      await reopen();
    }

    assert.ok(
      (await postManualJournal(created.id, actor)).ok,
      "the same draft posts once the year is open again"
    );
  });
});
