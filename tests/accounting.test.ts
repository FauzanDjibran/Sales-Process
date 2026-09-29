import test, { after, before, describe } from "node:test";
import assert from "node:assert/strict";

import { ENTITIES } from "../src/lib/erp/entities";
import { entityPermissions } from "../src/lib/erp/entity-access";
import { PERMISSION_CODES } from "../src/lib/erp/permissions";
import {
  SEGMENT_MAX,
  SEGMENT_MIN,
  codeDepth,
  compareCodes,
  isUnder,
  joinCode,
  parentCode,
  parseSegment,
} from "../src/lib/erp/account-code";
import {
  CASH_BANK_SUBCATEGORY,
  accountDescendants,
  accountUsage,
  checkAccountIsLeaf,
  checkAccountNumber,
  checkCashBankAccount,
} from "../src/lib/erp/records";
import {
  FIXTURE_PREFIX,
  subcategoryId,
  cleanupFixtures,
  disconnect,
  makeAccount,
  prisma,
  systemUserId,
} from "./helpers";

/**
 * The Accounting module's enforcement points, checked against a real database.
 *
 * The rules here are the ones a hand-crafted request would have to get past:
 * which account a Cash & Bank resource may post to, whether a parent account
 * would close a loop, and whether an account number is free.
 * The form narrows its options to the same sets, but that is presentation.
 *
 * The chart of accounts is business data a real user builds, so this suite
 * builds its own and removes it afterwards rather than assuming any account
 * exists.
 */

after(async () => {
  await cleanupFixtures();
  await disconnect();
});

/** A postable Kas account. */
let cash = 0;
/** A header account with one postable Bank account beneath it. */
let bankHeader = 0;
let bankLeaf = 0;
/** A postable account outside the Kas/Bank groups. */
let receivable = 0;
/** A deactivated Kas account. */
let inactiveCash = 0;
/** Holds the number the uniqueness cases contest. */
let contested = 0;

before(async () => {
  cash = await makeAccount({ subcategoryLabel: CASH_BANK_SUBCATEGORY });
  bankHeader = await makeAccount({
    subcategoryLabel: CASH_BANK_SUBCATEGORY,
    postable: false,
  });
  bankLeaf = await makeAccount({
    subcategoryLabel: CASH_BANK_SUBCATEGORY,
    parentId: bankHeader,
  });
  receivable = await makeAccount({ subcategoryLabel: "1.1.3" });
  inactiveCash = await makeAccount({
    subcategoryLabel: CASH_BANK_SUBCATEGORY,
    active: false,
  });

  contested = (
    await prisma.accAccount.create({
      data: {
        account_code: `${FIXTURE_PREFIX}.contested`,
        account_label: `${CASH_BANK_SUBCATEGORY}.987`,
        account_name: "Fixture Nomor Diperebutkan",
        account_subcategory_id: await subcategoryId(CASH_BANK_SUBCATEGORY),
        normal_balance: "Debit",
        created_by: await systemUserId(),
      },
      select: { id: true },
    })
  ).id;
});

describe("every registry entity declares its permissions", () => {
  test("each operation names a permission that exists in the catalogue", () => {
    for (const entity of ENTITIES) {
      const perms = entityPermissions(entity.key);
      for (const [operation, code] of Object.entries(perms)) {
        if (!code) continue;
        assert.ok(
          PERMISSION_CODES.includes(code),
          `${entity.key}.${operation} names ${code}, which is not in the catalogue`
        );
      }
    }
  });

  test("an entity whose status cannot be toggled declares no activate permission", () => {
    for (const entity of ENTITIES) {
      if (entity.statusModel?.toggle) continue;
      const perms = entityPermissions(entity.key);
      assert.equal(
        perms.activate,
        undefined,
        `${entity.key} has no status toggle but claims an activate permission`
      );
      assert.equal(perms.deactivate, undefined, `${entity.key}: same for deactivate`);
    }
  });
});

describe("a Cash & Bank resource may only post to an eligible account", () => {
  test("accepts a postable Kas or Bank account", async () => {
    assert.equal(await checkCashBankAccount(cash), null);
    assert.equal(await checkCashBankAccount(bankLeaf), null);
  });

  test("refuses a header account, which cannot receive a Journal Line", async () => {
    const problem = await checkCashBankAccount(bankHeader);
    assert.match(String(problem), /postable/);
  });

  test("refuses a postable account outside the Kas / Setara Kas group", async () => {
    const row = await prisma.accAccount.findUniqueOrThrow({
      where: { id: receivable },
      select: {
        is_postable: true,
        account_subcategory: { select: { subcategory_label: true } },
      },
    });
    assert.equal(row.is_postable, true, "only the group rule may stop this one");
    assert.notEqual(row.account_subcategory.subcategory_label, CASH_BANK_SUBCATEGORY);

    const problem = await checkCashBankAccount(receivable);
    assert.match(String(problem), /Kas \/ Setara Kas/);
  });

  test("refuses a deactivated account", async () => {
    const problem = await checkCashBankAccount(inactiveCash);
    assert.match(String(problem), /non-aktif/);
  });

  test("refuses an account that does not exist", async () => {
    const problem = await checkCashBankAccount(999_999_999);
    assert.match(String(problem), /tidak ditemukan/);
  });
});

describe("an account that gains a sub-account stops receiving postings", () => {
  /**
   * Becoming a parent revokes the posting privilege, permanently: a parent is a
   * heading over where money lands, and its balance is whatever sits below it.
   * `createRecord` writes `is_postable = false` on the parent in the same
   * transaction as the child, and these are the checks underneath that flag —
   * an account that somehow still carried it has to be refused anyway, which is
   * why the rule is asked of the tree rather than of the boolean.
   */
  let postableParent = 0;

  before(async () => {
    postableParent = await makeAccount({
      subcategoryLabel: CASH_BANK_SUBCATEGORY,
      postable: true,
    });
    await makeAccount({
      subcategoryLabel: CASH_BANK_SUBCATEGORY,
      parentId: postableParent,
    });
  });

  test("a leaf is still a leaf", async () => {
    assert.equal(await checkAccountIsLeaf(bankLeaf), null);
    assert.equal(await checkAccountIsLeaf(cash), null);
  });

  test("an account with children is refused, and says why", async () => {
    assert.match(String(await checkAccountIsLeaf(bankHeader)), /sub-account/);
  });

  test("the flag is not what decides it", async () => {
    const row = await prisma.accAccount.findUniqueOrThrow({
      where: { id: postableParent },
      select: { is_postable: true },
    });
    assert.equal(row.is_postable, true, "only the tree may stop this one");
    assert.match(String(await checkAccountIsLeaf(postableParent)), /sub-account/);
  });

  test("a Cash & Bank resource may not post to it either", async () => {
    // Every other condition passes: postable, active, and in
    // kelompok 1.1.1. Only the sub-account underneath it refuses.
    assert.match(
      String(await checkCashBankAccount(postableParent)),
      /sub-account/
    );
  });
});

describe("an account already in use cannot be given a sub-account", () => {
  /**
   * The mirror rule. A sub-account revokes the parent's posting privilege, so
   * anything already naming the account as somewhere money goes would be left
   * naming a heading — and the postings already made to it would have no leaf
   * accounting for them. A miscoded account is deactivated, never restructured.
   */
  test("an untouched account is free", async () => {
    assert.deepEqual(await accountUsage(cash), []);
  });

});

describe("an account cannot become its own ancestor", () => {
  test("descendants of a header include the accounts under it", async () => {
    const descendants = await accountDescendants(bankHeader);
    assert.ok(descendants.has(bankHeader), "the root is part of its own subtree");
    assert.ok(
      descendants.has(bankLeaf),
      "a child must be refused as its parent's parent"
    );
  });

  test("a leaf has no descendants but itself", async () => {
    const descendants = await accountDescendants(bankLeaf);
    assert.deepEqual([...descendants], [bankLeaf]);
  });
});

describe("an account code states its own lineage", () => {
  test("a segment is a whole number 1-999 and nothing else", () => {
    assert.equal(parseSegment("1"), SEGMENT_MIN);
    assert.equal(parseSegment("999"), SEGMENT_MAX);
    assert.equal(parseSegment(" 42 "), 42);

    for (const bad of ["0", "1000", "007", "1.2", "-1", "", "  ", "1a", null]) {
      assert.equal(parseSegment(bad), null, `${JSON.stringify(bad)} is not a segment`);
    }
  });

  test("a leading zero is refused rather than trimmed", () => {
    // Otherwise 1.1.1.01 and 1.1.1.1 would be two spellings of one account.
    assert.equal(codeDepth("1.1.1.01"), 0);
    assert.equal(codeDepth("1.1.1.1"), 4);
  });

  test("a code knows its depth and its parent", () => {
    assert.equal(codeDepth("1"), 1);
    assert.equal(codeDepth("1.1.1.2.1"), 5);
    assert.equal(parentCode("1.1.1.2"), "1.1.1");
    assert.equal(parentCode("1"), null);
    assert.equal(joinCode("1.1.1", 2), "1.1.1.2");
  });

  test("a subtree is recognised by its prefix, not by string matching", () => {
    assert.ok(isUnder("1.1.1.2", "1.1.1"));
    assert.ok(isUnder("1.1.1", "1.1.1"));
    assert.ok(!isUnder("1.1.10", "1.1.1"), "1.1.10 is a sibling, not a child");
  });

  test("codes order as numbers, so 1.1.2 comes before 1.1.10", () => {
    const sorted = ["1.1.10", "1.1.2", "1.2", "1.1"].sort(compareCodes);
    assert.deepEqual(sorted, ["1.1", "1.1.2", "1.1.10", "1.2"]);
  });

  test("the seeded skeleton is exactly three levels, each continuing its parent", async () => {
    const [types, categories, subcategories] = await Promise.all([
      prisma.sysAccountType.findMany({ select: { type_label: true } }),
      prisma.accAccountCategory.findMany({
        select: { category_label: true, account_type: { select: { type_label: true } } },
      }),
      prisma.accAccountSubcategory.findMany({
        select: {
          subcategory_label: true,
          account_category: { select: { category_label: true } },
        },
      }),
    ]);

    for (const t of types) assert.equal(codeDepth(t.type_label), 1, t.type_label);

    for (const c of categories) {
      assert.equal(codeDepth(c.category_label), 2, c.category_label);
      assert.equal(
        parentCode(c.category_label),
        c.account_type.type_label,
        `${c.category_label} must continue its account type's code`
      );
    }

    for (const sub of subcategories) {
      assert.equal(codeDepth(sub.subcategory_label), 3, sub.subcategory_label);
      assert.equal(
        parentCode(sub.subcategory_label),
        sub.account_category.category_label,
        `${sub.subcategory_label} must continue its category's code`
      );
    }
  });

  test("every Account Type says which statement it belongs to", async () => {
    const types = await prisma.sysAccountType.findMany({
      select: { type_label: true, type_name: true, section: true },
    });
    assert.ok(types.length, "the skeleton seeds five Account Types");

    // The column exists so that nothing has to read the section off the first
    // segment of a lineage code. That convention holds today and is exactly
    // what a stored fact protects against: a type added later that does not
    // follow it would break a derivation silently, and fails here instead.
    const bySection = (section: string) =>
      types
        .filter((t) => t.section === section)
        .map((t) => t.type_label)
        .sort();

    assert.deepEqual(bySection("ProfitLoss"), ["4", "5"], "PENDAPATAN and BIAYA");
    assert.deepEqual(bySection("BalanceSheet"), ["1", "2", "3"], "AKTIVA, PASIVA, EKUITAS");
    assert.equal(
      bySection("ProfitLoss").length + bySection("BalanceSheet").length,
      types.length,
      "the two sets partition the Account Types — every type is one or the other"
    );
  });

  test("every Account Type says which side its total reads positive on", async () => {
    const types = await prisma.sysAccountType.findMany({
      select: { type_label: true, normal_balance: true },
    });
    const side = (label: string) => types.find((t) => t.type_label === label)?.normal_balance;
    // The Neraca signs by this, so a contra account inside a type prints as a
    // deduction there. A wrong side would print every AKTIVA negative.
    assert.equal(side("1"), "Debit", "AKTIVA");
    assert.equal(side("2"), "Kredit", "PASIVA");
    assert.equal(side("3"), "Kredit", "EKUITAS");
    assert.equal(side("4"), "Kredit", "PENDAPATAN");
    assert.equal(side("5"), "Debit", "BIAYA");
  });

  test("every Laba Rugi category names its step, and no Neraca category does", async () => {
    const categories = await prisma.accAccountCategory.findMany({
      select: {
        category_label: true,
        pl_group: true,
        account_type: { select: { section: true } },
      },
    });
    assert.ok(categories.length, "the skeleton seeds its categories");

    // Across two tables, so no CHECK constraint can say it: the step exists
    // exactly where the type's section is Laba Rugi. A category that
    // lacked one would drop its accounts out of every subtotal of the
    // statement, and nothing else would fail.
    for (const c of categories) {
      if (c.account_type.section === "ProfitLoss") {
        assert.ok(c.pl_group, `${c.category_label} is Laba Rugi and names no step`);
      } else {
        assert.equal(c.pl_group, null, `${c.category_label} is Neraca and names a step`);
      }
    }

    // And the seeded six sit where Template COA Sheet1 lays them out.
    const step = (label: string) =>
      categories.find((c) => c.category_label === label)?.pl_group;
    assert.equal(step("4.1"), "OperatingRevenue");
    assert.equal(step("5.1"), "CostOfSales");
    assert.equal(step("5.2"), "OperatingExpense");
    assert.equal(step("5.3"), "OperatingExpense");
    assert.equal(step("4.9"), "OtherIncome");
    assert.equal(step("5.9"), "OtherExpense");
  });

  test("every account resolves to exactly one section through its own lineage", async () => {
    // One account either side of the boundary, so the assertion is never
    // vacuous on a database that carries no chart of its own yet.
    await makeAccount({ subcategoryLabel: CASH_BANK_SUBCATEGORY });
    await makeAccount({ subcategoryLabel: "5.3.1" });

    const accounts = await prisma.accAccount.findMany({
      select: {
        account_label: true,
        account_subcategory: {
          select: {
            account_category: {
              select: { account_type: { select: { type_label: true, section: true } } },
            },
          },
        },
      },
    });
    assert.ok(accounts.length >= 2);

    const seen = new Set<string>();
    for (const a of accounts) {
      const type = a.account_subcategory.account_category.account_type;
      assert.ok(
        type.section === "BalanceSheet" || type.section === "ProfitLoss",
        `${a.account_label} reaches no section`
      );
      seen.add(type.section);
      // The lineage and the stored section must agree, which is the whole
      // point of storing it: the chart can be asked, and the answer can be
      // checked against the convention rather than resting on it.
      const expected = ["4", "5"].includes(type.type_label.split(".")[0])
        ? "ProfitLoss"
        : "BalanceSheet";
      assert.equal(type.section, expected, a.account_label);
    }
    assert.equal(seen.size, 2, "both sections are reachable from real accounts");
  });

  test("the kelompok Cash & Bank posts into is one that exists", async () => {
    const row = await prisma.accAccountSubcategory.findUnique({
      where: { subcategory_label: CASH_BANK_SUBCATEGORY },
      select: { subcategory_name: true },
    });
    assert.ok(
      row,
      `${CASH_BANK_SUBCATEGORY} must be seeded — checkCashBankAccount refuses everything otherwise`
    );
  });

  test("a fixture account's number continues whatever it hangs under", async () => {
    const kelompok = await makeAccount({
      subcategoryLabel: CASH_BANK_SUBCATEGORY,
    });
    const parent = await prisma.accAccount.findUniqueOrThrow({
      where: { id: kelompok },
      select: { account_label: true },
    });
    assert.equal(parentCode(parent.account_label), CASH_BANK_SUBCATEGORY);

    const childId = await makeAccount({
      subcategoryLabel: CASH_BANK_SUBCATEGORY,
      parentId: kelompok,
    });
    const child = await prisma.accAccount.findUniqueOrThrow({
      where: { id: childId },
      select: { account_label: true },
    });
    assert.equal(parentCode(child.account_label), parent.account_label);
    assert.ok(isUnder(child.account_label, CASH_BANK_SUBCATEGORY));
  });
});

/**
 * An account number is unique across the one chart of accounts.
 */
describe("an account number cannot be reused", () => {
  // A number chosen high enough that no chart a person builds will hold it.
  const CONTESTED = `${CASH_BANK_SUBCATEGORY}.987`;

  test("a number already taken is refused, and names the holder", async () => {
    const holder = await prisma.accAccount.findUniqueOrThrow({
      where: { id: contested },
      select: { account_name: true },
    });

    const problem = await checkAccountNumber(CONTESTED);
    assert.ok(problem, "the number is in use and must be refused");
    assert.match(String(problem), new RegExp(holder.account_name));
  });

  test("an unused number is free", async () => {
    assert.equal(await checkAccountNumber("9.9.9.999"), null);
  });

  test("an account does not collide with itself when edited", async () => {
    assert.equal(await checkAccountNumber(CONTESTED, contested), null);
  });

  test("the database refuses a duplicate even if nothing checked first", async () => {
    await assert.rejects(
      prisma.accAccount.create({
        data: {
          account_code: `${FIXTURE_PREFIX}.collision`,
          account_label: CONTESTED,
          account_name: "Fixture collision",
          account_subcategory_id: await subcategoryId(CASH_BANK_SUBCATEGORY),
          normal_balance: "Debit",
          created_by: await systemUserId(),
        },
      }),
      /Unique constraint/,
      "@@unique([account_label]) is the backstop under the check"
    );
  });
});
