import test, { after, before, describe } from "node:test";
import assert from "node:assert/strict";

import { MODULES } from "../src/lib/erp/nav";
import { PERMISSION_CODES } from "../src/lib/erp/permissions";
import {
  EMPTY_SYSTEM_DEFAULTS,
  SYSTEM_DEFAULTS,
  isSystemDefaultKey,
  refValueOf,
} from "../src/lib/erp/system-defaults";
import {
  checkSystemDefaultValue,
  defaultCurrencyId,
  missingClosingAccounts,
  missingNeracaAccounts,
  systemDefaults,
  systemDefaultsUsingAccount,
  writeSystemDefaults,
} from "../src/lib/erp/system-settings";
import {
  FIXTURE_PREFIX,
  cleanupFixtures,
  disconnect,
  makeAccount,
  prisma,
  systemUserId,
} from "./helpers";

/**
 * System Default.
 *
 * A default fills a control in and decides nothing, so the cases below are
 * about exactly that boundary: the catalogue is code, a value that would not be
 * offered to the user is not prefilled either, and a key nobody declared is
 * never written.
 *
 * The suite writes to a real settings table, so whatever was configured before
 * it ran is captured and put back afterwards.
 */

let actor = 0;
let activeCurrency = 0;
let inactiveCurrency = 0;
let previous: string | null = null;

/** The equity settings this suite writes over, so they can be put back. */
const EQUITY_KEYS = ["accumulated_pl_account", "current_pl_account"] as const;
const previousEquity: Record<string, string | null> = {};

before(async () => {
  actor = await systemUserId();
  const stored = await systemDefaults();
  previous = stored.default_currency;
  for (const key of EQUITY_KEYS) previousEquity[key] = stored[key];

  const base = await prisma.refCurrency.findFirstOrThrow({
    where: { status: "Active" },
    select: { id: true },
  });
  activeCurrency = base.id;

  const label = `${FIXTURE_PREFIX}CUR${Date.now() % 100000}`;
  const made = await prisma.refCurrency.create({
    data: {
      currency_code: `test.${label}`,
      currency_label: label,
      currency_name: `Fixture ${label}`,
      status: "Inactive",
      created_by: actor,
    },
    select: { id: true },
  });
  inactiveCurrency = made.id;
});

after(async () => {
  await writeSystemDefaults({ default_currency: previous, ...previousEquity }, actor);
  await cleanupFixtures();
  await prisma.refCurrency.deleteMany({
    where: { currency_label: { startsWith: FIXTURE_PREFIX } },
  });
  await prisma.auditLog.deleteMany({ where: { entity_key: "sys_setting" } });
  await disconnect();
});

// -------------------------------------------------------------- the catalogue


describe("the System Default catalogue lives in code", () => {
  test("every declared key has a home in the empty value set", () => {
    for (const def of SYSTEM_DEFAULTS) {
      assert.ok(
        def.key in EMPTY_SYSTEM_DEFAULTS,
        `${def.key} is declared but has no default value`
      );
      assert.equal(
        EMPTY_SYSTEM_DEFAULTS[def.key],
        null,
        "an unset default must read as null, never as a guess"
      );
    }
  });

  test("a key nobody declared is not a setting", () => {
    assert.equal(isSystemDefaultKey("default_currency"), true);
    assert.equal(isSystemDefaultKey("default_company"), false);
    assert.equal(isSystemDefaultKey(""), false);
  });

  test("the page is behind its own menu and action permissions", () => {
    for (const code of [
      "MENU_SYSTEM_DEFAULT_ACCESS",
      "SYSTEM_DEFAULT_VIEW",
      "SYSTEM_DEFAULT_EDIT",
    ]) {
      assert.ok(PERMISSION_CODES.includes(code as never), `${code} is missing`);
    }

    const leaf = MODULES.find((m) => m.key === "settings")
      ?.groups?.flatMap((g) => g.entities)
      .find((e) => e.slug === "system-default");
    assert.ok(leaf, "System Default must be reachable from the Pengaturan menu");
    assert.equal(leaf!.permission, "MENU_SYSTEM_DEFAULT_ACCESS");
  });

  test("a ref value reads back as a row id, and anything else as nothing", () => {
    const values = (raw: string | null) => ({
      ...EMPTY_SYSTEM_DEFAULTS,
      default_currency: raw,
    });
    assert.equal(refValueOf(values("12"), "default_currency"), 12);
    assert.equal(refValueOf(values(null), "default_currency"), null);
    assert.equal(refValueOf(values(""), "default_currency"), null);
    assert.equal(refValueOf(values("abc"), "default_currency"), null);
    assert.equal(refValueOf(values("0"), "default_currency"), null);
  });
});

// ------------------------------------------------------------- reading it back

describe("a saved default is what the forms read", () => {
  test("a value written is a value read", async () => {
    await writeSystemDefaults({ default_currency: String(activeCurrency) }, actor);
    assert.equal((await systemDefaults()).default_currency, String(activeCurrency));
    assert.equal(await defaultCurrencyId(), activeCurrency);
  });

  test("writing the same value again changes nothing", async () => {
    const changed = await writeSystemDefaults(
      { default_currency: String(activeCurrency) },
      actor
    );
    assert.deepEqual(changed, [], "an unchanged save must not claim a change");
  });

  test("clearing it leaves the picker empty rather than guessing", async () => {
    await writeSystemDefaults({ default_currency: null }, actor);
    assert.equal((await systemDefaults()).default_currency, null);
    assert.equal(await defaultCurrencyId(), null);
  });

  test("a deactivated currency is not prefilled", async () => {
    // The picker hides inactive records, so prefilling one would put a value in
    // the form that the form itself refuses to offer.
    await writeSystemDefaults({ default_currency: String(inactiveCurrency) }, actor);
    assert.equal(
      (await systemDefaults()).default_currency,
      String(inactiveCurrency),
      "the stored setting is left alone"
    );
    assert.equal(
      await defaultCurrencyId(),
      null,
      "but nothing is prefilled from it"
    );
  });

  test("a default pointing at a currency that no longer exists prefills nothing", async () => {
    await writeSystemDefaults({ default_currency: "999999" }, actor);
    assert.equal(await defaultCurrencyId(), null);
  });

  test("a key outside the catalogue is never written", async () => {
    await writeSystemDefaults(
      { default_currency: null, default_company: "1" } as never,
      actor
    );
    const row = await prisma.sysSetting.findUnique({
      where: { setting_key: "default_company" },
    });
    assert.equal(row, null, "sys_setting holds only keys the catalogue declares");
  });
});

// --------------------------------------------------- the equity P&L accounts

/**
 * The two equity accounts closing a Fiscal Year and the Neraca need.
 *
 * They name a destination rather than prefilling a control: the accumulated
 * one is where a year's result is posted, so it is checked when it is stored
 * and refused by name when it is missing. Whether either is closed to hand
 * entry is the account's own Control Account flag, which the user sets
 * (Claude-ERP.md P16) — naming it in a setting changes nothing about it.
 */
describe("the equity accounts closing posts into", () => {
  const isControl = async (id: number) =>
    (
      await prisma.accAccount.findUniqueOrThrow({
        where: { id },
        select: { is_control_account: true },
      })
    ).is_control_account;

  test("a header account is refused — a posting target is always a leaf", async () => {
    const parent = await makeAccount({
      subcategoryLabel: "3.3.1",
      normalBalance: "Kredit",
    });
    await makeAccount({
      subcategoryLabel: "3.3.1",
      normalBalance: "Kredit",
      parentId: parent,
    });
    assert.ok(
      await checkSystemDefaultValue("accumulated_pl_account", parent),
      "an account with a sub-account is a heading, not a destination"
    );
  });

  test("naming an account in a setting leaves its Control Account flag alone", async () => {
    const accumulated = await makeAccount({
      subcategoryLabel: "3.3.1",
      normalBalance: "Kredit",
    });
    await writeSystemDefaults(
      { accumulated_pl_account: String(accumulated) },
      actor
    );

    assert.equal(
      await isControl(accumulated),
      false,
      "the flag is the user's choice on the account form, not a consequence of a setting"
    );
    assert.deepEqual(await systemDefaultsUsingAccount(accumulated), [
      "Account Laba/Rugi Tahun Sebelumnya",
    ]);
  });

  test("an unset accumulated account is reported by name, and the current one is not", async () => {
    await writeSystemDefaults(
      { accumulated_pl_account: null },
      actor
    );
    const missing = await missingClosingAccounts();
    assert.deepEqual(missing, ["Account Laba/Rugi Tahun Sebelumnya"]);

    // Nothing posts to the current-year account, so an unset one blocks no
    // process — it is a report missing a line, not a refusal waiting to happen.
    assert.ok(
      !missing.some((m) => m.includes("Berjalan")),
      "the presentation line is not a blocking gap"
    );
    const account = await makeAccount({
      subcategoryLabel: "3.3.1",
      normalBalance: "Kredit",
    });
    await writeSystemDefaults(
      { accumulated_pl_account: String(account) },
      actor
    );
    assert.deepEqual(await missingClosingAccounts(), []);

    // Resolved against the master, never trusted as stored: an account that has
    // since been deactivated is somewhere the picker would no longer offer.
    await prisma.accAccount.update({
      where: { id: account },
      data: { is_active: false },
    });
    assert.deepEqual(await missingClosingAccounts(), [
      "Account Laba/Rugi Tahun Sebelumnya",
    ]);
    await prisma.accAccount.update({
      where: { id: account },
      data: { is_active: true },
    });
  });

  test("the Neraca's accounts: Tahun Berjalan always, Tahun Sebelumnya only while a year is carried", async () => {
    await writeSystemDefaults(
      { current_pl_account: null, accumulated_pl_account: null },
      actor
    );

    // Every Neraca places Tahun Berjalan, whatever the calendar holds.
    assert.deepEqual(await missingNeracaAccounts(false), [
      "Account Laba/Rugi Tahun Berjalan",
    ]);

    // Tahun Sebelumnya anchors the per-year lines, so it is asked for only
    // while an unclosed year is carried: a setting blocks only where it is
    // used.
    assert.deepEqual(await missingNeracaAccounts(true), [
      "Account Laba/Rugi Tahun Berjalan",
      "Account Laba/Rugi Tahun Sebelumnya",
    ]);
    const current = await makeAccount({
      subcategoryLabel: "3.4.1",
      normalBalance: "Kredit",
    });
    const accumulated = await makeAccount({
      subcategoryLabel: "3.3.1",
      normalBalance: "Kredit",
    });
    await writeSystemDefaults(
      {
        current_pl_account: String(current),
        accumulated_pl_account: String(accumulated),
      },
      actor
    );

    assert.deepEqual(await missingNeracaAccounts(true), []);

    // Resolved against the master: a deactivated account is not somewhere a
    // line can be placed any more than somewhere a posting can land.
    await prisma.accAccount.update({ where: { id: accumulated }, data: { is_active: false } });
    assert.deepEqual(await missingNeracaAccounts(true), [
      "Account Laba/Rugi Tahun Sebelumnya",
    ]);
    await prisma.accAccount.update({ where: { id: accumulated }, data: { is_active: true } });
  });
});
