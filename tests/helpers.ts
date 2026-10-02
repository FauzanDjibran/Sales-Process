import { prisma } from "../src/lib/prisma";
import { actorFor, type Actor } from "../src/lib/erp/access";
import { ensureFiscalPeriods } from "../src/lib/erp/fiscal";
import { hashPassword } from "../src/lib/erp/login";
import { ADMIN_ROLE, STAFF_ROLE } from "../src/lib/erp/roles";

/**
 * Shared fixtures for the security suite.
 *
 * The tests run against the real database and the real service layer — the
 * same functions the Server Actions call — because that is the only way to
 * prove the guards hold. Nothing is stubbed out.
 *
 * Every fixture user is created under a reserved email prefix and cleaned up
 * afterwards, so a run never disturbs the seeded baseline.
 */

export const TEST_PREFIX = "authtest+";

export async function roleIdFor(label: string): Promise<number> {
  const role = await prisma.sysRole.findUniqueOrThrow({ where: { role_label: label } });
  return role.id;
}

export const adminRoleId = () => roleIdFor(ADMIN_ROLE);
export const staffRoleId = () => roleIdFor(STAFF_ROLE);

let counter = 0;

export async function makeUser(options: {
  roleLabels?: string[];
  status?: "Active" | "Inactive";
  password?: string;
  permissions?: string[];
}): Promise<{ id: number; email: string; password: string }> {
  counter += 1;
  const email = `${TEST_PREFIX}${Date.now()}_${counter}@erp.test`;
  const password = options.password ?? "test-password-123";

  const user = await prisma.sysUser.create({
    data: {
      user_code: `test.${String(Date.now() % 100000)}${counter}`,
      email,
      name: `Test User ${counter}`,
      initials: "TU",
      password_hash: await hashPassword(password),
      status: options.status ?? "Active",
    },
  });

  for (const label of options.roleLabels ?? []) {
    await prisma.sysUserRole.create({
      data: { user_id: user.id, role_id: await roleIdFor(label) },
    });
  }

  // An ad-hoc role carrying exactly the permissions a test needs, so a case can
  // isolate one capability without depending on what STAFF happens to hold.
  if (options.permissions) {
    counter += 1;
    const role = await prisma.sysRole.create({
      data: {
        role_code: `test.${String(Date.now() % 100000)}${counter}`,
        role_label: `TEST_ROLE_${Date.now()}_${counter}`,
        role_name: "Test role",
      },
    });
    const perms = await prisma.sysPermission.findMany({
      where: { permission_code: { in: options.permissions } },
      select: { id: true },
    });
    await prisma.sysRolePermission.createMany({
      data: perms.map((p) => ({ role_id: role.id, permission_id: p.id })),
    });
    await prisma.sysUserRole.create({ data: { user_id: user.id, role_id: role.id } });
  }

  return { id: user.id, email, password };
}

export async function actorOf(userId: number): Promise<Actor> {
  const user = await prisma.sysUser.findUniqueOrThrow({
    where: { id: userId },
    select: { id: true, user_code: true, email: true, name: true, initials: true },
  });
  return actorFor(user);
}

/** Removes every row this suite created, leaving the seeded baseline intact. */
export async function cleanup(): Promise<void> {
  const users = await prisma.sysUser.findMany({
    where: { email: { startsWith: TEST_PREFIX } },
    select: { id: true },
  });
  const ids = users.map((u) => u.id);

  if (ids.length) {
    await prisma.sysSession.deleteMany({ where: { user_id: { in: ids } } });
    await prisma.sysUserRole.deleteMany({ where: { user_id: { in: ids } } });
    await prisma.auditLog.deleteMany({ where: { by: { in: ids } } });
    await prisma.auditLog.deleteMany({
      where: { entity_key: "sys_user", row_id: { in: ids } },
    });
    await prisma.sysUser.deleteMany({ where: { id: { in: ids } } });
  }

  const roles = await prisma.sysRole.findMany({
    where: { role_label: { startsWith: "TEST_ROLE_" } },
    select: { id: true },
  });
  const roleIds = roles.map((r) => r.id);
  if (roleIds.length) {
    await prisma.sysUserRole.deleteMany({ where: { role_id: { in: roleIds } } });
    await prisma.sysRolePermission.deleteMany({ where: { role_id: { in: roleIds } } });
    await prisma.auditLog.deleteMany({
      where: { entity_key: "sys_role", row_id: { in: roleIds } },
    });
    await prisma.sysRole.deleteMany({ where: { id: { in: roleIds } } });
  }
}

export async function disconnect(): Promise<void> {
  await prisma.$disconnect();
}

export { prisma };

// --------------------------------------------------------- business fixtures
//
// The seed carries system data only — no partners, no accounts — so
// a test that needs business data creates it. Fixtures are labelled with
// `FIXTURE_PREFIX` and removed by `cleanupFixtures`, which is what keeps a run
// from leaving anything behind in a database somebody is actually using.

export const FIXTURE_PREFIX = "ZZTEST";

let fixtureSeq = 0;
const nextFixture = () => `${FIXTURE_PREFIX}${Date.now() % 1_000_000}${++fixtureSeq}`;

/** The account seeded rows are attributed to; fixtures borrow it. */
export async function systemUserId(): Promise<number> {
  const row = await prisma.sysUser.findFirstOrThrow({
    where: { email: "sistem@erp.app" },
    select: { id: true },
  });
  return row.id;
}

export async function partnerCategoryId(label: string): Promise<number> {
  const row = await prisma.sysPartnerCategory.findFirstOrThrow({
    where: { category_label: label },
    select: { id: true },
  });
  return row.id;
}

export async function subcategoryId(label: string): Promise<number> {
  const row = await prisma.accAccountSubcategory.findFirstOrThrow({
    where: { subcategory_label: label },
    select: { id: true },
  });
  return row.id;
}

/**
 * The next unused number under `parentLabel`.
 *
 * A fixture cannot simply take segment 1: the database it runs against belongs
 * to whoever uses the application, and a real user's own `1.1.1.1` would
 * collide with it. Probing exact labels rather than a prefix is deliberate —
 * `1.1.1.1.1` starts with `1.1.1.` but is a grandchild, not a sibling.
 */
async function freeSegment(parentLabel: string): Promise<string> {
  const siblings = await prisma.accAccount.findMany({
    where: { account_label: { startsWith: `${parentLabel}.` } },
    select: { account_label: true },
  });
  const taken = new Set(siblings.map((a) => a.account_label));
  for (let segment = 1; segment <= 999; segment += 1) {
    const label = `${parentLabel}.${segment}`;
    if (!taken.has(label)) return label;
  }
  throw new Error(`No free account number left under ${parentLabel}`);
}

export async function makeAccount(options: {
  subcategoryLabel: string;
  postable?: boolean;
  active?: boolean;
  parentId?: number | null;
  normalBalance?: "Debit" | "Kredit";
  /** Reconciled against a book outside the General Ledger — see §10 rule 79. */
  controlAccount?: boolean;
  /** Names a Partner on every line, of this category. */
  partnerCategoryLabel?: string | null;
}): Promise<number> {
  const key = nextFixture();
  // A fixture account carries a real lineage code: it continues its parent
  // account's number when it has one and its kelompok's otherwise, exactly as
  // `createRecord` composes it.
  const parentLabel = options.parentId
    ? (
        await prisma.accAccount.findUniqueOrThrow({
          where: { id: options.parentId },
          select: { account_label: true },
        })
      ).account_label
    : options.subcategoryLabel;

  const row = await prisma.accAccount.create({
    data: {
      account_code: `${FIXTURE_PREFIX}.${key}`,
      account_label: await freeSegment(parentLabel),
      account_name: `Fixture ${key}`,
      account_subcategory_id: await subcategoryId(options.subcategoryLabel),
      parent_account: options.parentId ?? null,
      is_postable: options.postable ?? true,
      is_active: options.active ?? true,
      normal_balance: options.normalBalance ?? "Debit",
      is_control_account: options.controlAccount ?? false,
      require_partner: Boolean(options.partnerCategoryLabel),
      partner_category_id: options.partnerCategoryLabel
        ? await partnerCategoryId(options.partnerCategoryLabel)
        : null,
      created_by: await systemUserId(),
    },
    select: { id: true },
  });
  return row.id;
}

export async function makePartner(options: {
  categoryLabel: string;
  status?: "Active" | "Inactive";
}): Promise<number> {
  const key = nextFixture();
  const row = await prisma.mPartner.create({
    data: {
      partner_code: `test.${key}`,
      partner_label: key,
      partner_name: `Fixture ${key}`,
      category_id: await partnerCategoryId(options.categoryLabel),
      status: options.status ?? "Active",
      created_by: await systemUserId(),
    },
    select: { id: true },
  });
  return row.id;
}

/**
 * Removes every business fixture, children before parents so the self
 * -referencing account tree never blocks a delete.
 */
export async function cleanupFixtures(): Promise<void> {
  // Journals point at accounts, so they go before the accounts do.
  // The application never deletes a journal — it is append-only and immutable
  // (CLAUDE.md §12). A test tearing down its own fixtures is the same
  // exception already made for fixture accounts: these journals were written
  // by this run against accounts that are about to stop existing.
  const journalIds = [
    ...new Set(
      (
        await prisma.accJournalLine.findMany({
          where: { account: { account_code: { startsWith: FIXTURE_PREFIX } } },
          select: { journal_id: true },
        })
      ).map((l) => l.journal_id)
    ),
  ];
  if (journalIds.length) {
    await prisma.accJournalLine.deleteMany({
      where: { journal_id: { in: journalIds } },
    });
    await prisma.auditLog.deleteMany({
      where: { entity_key: "acc_journal", row_id: { in: journalIds } },
    });
    await prisma.accJournal.deleteMany({ where: { id: { in: journalIds } } });
  }

  // An Opening Balance line points at an account and at a Partner, so a
  // snapshot a suite left behind blocks every later run from clearing its own
  // accounts. The application never deletes one — it is immutable — and this
  // is the same exception already made for fixture journals above: these
  // snapshots were written by a test run against accounts that are about to
  // stop existing. A whole document goes whenever any of its lines names one,
  // because what would remain could no longer balance.
  const snapshots = [
    ...new Set(
      (
        await prisma.accOpeningBalanceLine.findMany({
          where: { account: { account_code: { startsWith: FIXTURE_PREFIX } } },
          select: { opening_id: true },
        })
      ).map((l) => l.opening_id)
    ),
  ];
  if (snapshots.length) {
    await prisma.accOpeningBalanceLine.deleteMany({
      where: { opening_id: { in: snapshots } },
    });
    await prisma.auditLog.deleteMany({
      where: { entity_key: "acc_opening_balance", row_id: { in: snapshots } },
    });
    await prisma.accOpeningBalance.deleteMany({ where: { id: { in: snapshots } } });
  }

  // A Cash & Bank resource points at an account, so a fixture resource left
  // behind by an earlier failure blocks every later suite from clearing its own
  // accounts — and the failure surfaces three suites away from its cause. Each
  // suite still tears down the resources it made; this is the backstop for the
  // run that did not get that far.
  const orphans = await prisma.mCashBank.findMany({
    where: { cash_bank_code: { startsWith: "test." } },
    select: { id: true },
  });
  if (orphans.length) {
    const ids = orphans.map((o) => o.id);
    await prisma.cashBankLedger.deleteMany({ where: { cash_bank_id: { in: ids } } });
    await prisma.cashBankBalance.deleteMany({ where: { cash_bank_id: { in: ids } } });
    await prisma.mCashBank.deleteMany({ where: { id: { in: ids } } });
  }

  const accounts = await prisma.accAccount.findMany({
    // Keyed on the system code, not the label: an account's label is now a
    // lineage code with no room for a fixture marker in it.
    where: { account_code: { startsWith: FIXTURE_PREFIX } },
    orderBy: { id: "desc" },
    select: { id: true },
  });
  for (const a of accounts) {
    await prisma.accAccount.delete({ where: { id: a.id } });
  }
  // An AR item names its partner, so one a suite left behind would block the
  // partner's removal. Its Buku Piutang entries go with it.
  const fixtureItems = await prisma.finArItem.findMany({
    where: { partner: { partner_label: { startsWith: FIXTURE_PREFIX } } },
    select: { id: true },
  });
  if (fixtureItems.length) {
    const ids = fixtureItems.map((i) => i.id);
    await prisma.finArItemWht.deleteMany({ where: { item_id: { in: ids } } });
    await prisma.finArLedger.deleteMany({ where: { OR: [{ item_id: { in: ids } }, { counter_item_id: { in: ids } }] } });
    await prisma.finArItem.deleteMany({ where: { id: { in: ids } } });
  }

  // A Partner's addresses and contacts are part of it and go first.
  const fixturePartners = { partner: { partner_label: { startsWith: FIXTURE_PREFIX } } };
  await prisma.mPartnerAddress.deleteMany({ where: fixturePartners });
  await prisma.mPartnerContact.deleteMany({ where: fixturePartners });
  await prisma.mPartner.deleteMany({
    where: { partner_label: { startsWith: FIXTURE_PREFIX } },
  });
}

// ------------------------------------------------------------ fiscal calendar
//
// Posting is only allowed inside an Open fiscal year not yet closed
// (`checkPostingPeriod`), so every suite that posts needs one covering today.
// The seed creates no fiscal year — a calendar is business data a user opens
// through the GUI — so CI has none at all, and a developer's database has
// whatever they opened.

let madeFiscalYear: number | null = null;

/**
 * An Open fiscal year covering `date`, created only if there is not one.
 *
 * A year that already exists is reused and never touched: it belongs to
 * whoever uses the database, and a fixture that flipped its status would be
 * rewriting their calendar. One that exists but is not Open is reported rather
 * than activated, for the same reason — the run cannot proceed, and silently
 * opening somebody's Draft year is worse than saying so.
 */
export async function openFiscalYear(date: Date = new Date()): Promise<number> {
  const day = new Date(`${date.toISOString().slice(0, 10)}T00:00:00Z`);
  const existing = await prisma.accFiscalYear.findFirst({
    where: { start_date: { lte: day }, end_date: { gte: day } },
    select: { id: true, year_name: true, status: true },
  });
  if (existing) {
    if (existing.status !== "Open") {
      throw new Error(
        `${existing.year_name} is ${existing.status}. Posting tests need it Open — ` +
          "activate it from Accounting > Fiscal Year, or drop it and let the fixture " +
          "make its own."
      );
    }
    return existing.id;
  }

  const year = day.getUTCFullYear();
  const actor = await systemUserId();
  const created = await prisma.accFiscalYear.create({
    data: {
      year_code: `fyr.${FIXTURE_PREFIX}${year}`,
      year_label: String(year),
      year_name: `Tahun Buku ${year}`,
      start_date: new Date(Date.UTC(year, 0, 1)),
      end_date: new Date(Date.UTC(year, 11, 31)),
      status: "Open",
      created_by: actor,
    },
    select: { id: true },
  });
  madeFiscalYear = created.id;
  await ensureFiscalPeriods(prisma, {
    fiscalYearId: created.id,
    year,
    actorId: actor,
  });
  return created.id;
}

/**
 * Records a year as closed, and hands back the undo.
 *
 * A test that needs to prove the lock writes the row the lock reads, rather
 * than running the whole close. Which is also what the lock is for: the state
 * is a record, not an inference.
 */
export async function closeYear(
  fiscalYearId: number
): Promise<() => Promise<void>> {
  const row = await prisma.accFiscalClosing.create({
    data: {
      fiscal_year_id: fiscalYearId,
      status: "Closed",
      closed_at: new Date(),
      closed_by: await systemUserId(),
      created_by: await systemUserId(),
    },
    select: { id: true },
  });
  return async () => {
    await prisma.accFiscalClosing.deleteMany({ where: { id: row.id } });
  };
}

/** Removes a fiscal year this run created, leaving one it merely found alone. */
export async function cleanupFiscalYear(): Promise<void> {
  if (madeFiscalYear === null) return;
  const id = madeFiscalYear;
  madeFiscalYear = null;
  await prisma.accFiscalClosing.deleteMany({ where: { fiscal_year_id: id } });
  await prisma.accFiscalPeriod.deleteMany({ where: { fiscal_year_id: id } });
  await prisma.accFiscalYear.deleteMany({ where: { id } });
}
