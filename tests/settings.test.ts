import test, { after, before, describe } from "node:test";
import assert from "node:assert/strict";

import { MODULES } from "../src/lib/erp/nav";
import { PERMISSION_CODES } from "../src/lib/erp/permissions";
import {
  EMPTY_SYSTEM_DEFAULTS,
  SYSTEM_DEFAULTS,
  isSystemDefaultKey,
  refValueOf,
  numberSettingProblem,
  settingPageOf,
  systemDefaultDef,
} from "../src/lib/erp/system-defaults";
import {
  checkSystemDefaultValue,
  baseCurrency,
  baseCurrencyId,
  missingClosingAccounts,
  missingNeracaAccounts,
  ppnRates,
  systemDefaults,
  systemDefaultsUsingAccount,
  writeSystemDefaults,
} from "../src/lib/erp/system-settings";
import {
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

/** The settings this suite writes over, so they can be put back. */
const TOUCHED_KEYS = ["fx_account", "accumulated_pl_account", "current_pl_account"] as const;
const previous: Record<string, string | null> = {};

before(async () => {
  actor = await systemUserId();
  const stored = await systemDefaults();
  for (const key of TOUCHED_KEYS) previous[key] = stored[key];
});

after(async () => {
  await writeSystemDefaults(previous, actor);
  await cleanupFixtures();
  await prisma.auditLog.deleteMany({ where: { entity_key: "sys_setting" } });
  await disconnect();
});

// -------------------------------------------------------------- the catalogue

describe("the settings catalogue lives in code", () => {
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
    assert.equal(isSystemDefaultKey("fx_account"), true);
    assert.equal(isSystemDefaultKey("default_currency"), false, "retired by P61");
    assert.equal(isSystemDefaultKey("pph22_withholding_tax"), false, "retired by P61");
    assert.equal(isSystemDefaultKey(""), false);
  });

  test("configuration and account routing sit on separate pages (P61)", () => {
    assert.deepEqual(
      SYSTEM_DEFAULTS.filter((d) => settingPageOf(d.key) === "account").map((d) => d.key),
      [
        // Penerimaan Kas & Bank's posting targets (P66), added with it.
        "sales_advance_account",
        "output_vat_account",
        "bank_charge_account",
        // The Delivery Note's (U12).
        "cogs_account",
        "inventory_account",
        "fx_account",
        "accumulated_pl_account",
        "current_pl_account",
      ]
    );
    for (const d of SYSTEM_DEFAULTS) {
      assert.equal(
        settingPageOf(d.key) === "account",
        d.type === "ref",
        `${d.key}: every account setting is on Account Mapping, and nothing else is`
      );
    }
  });

  test("each page is behind its own menu and action permissions", () => {
    for (const code of [
      "MENU_SYSTEM_DEFAULT_ACCESS",
      "SYSTEM_DEFAULT_VIEW",
      "SYSTEM_DEFAULT_EDIT",
      "MENU_ACCOUNT_MAPPING_ACCESS",
      "ACCOUNT_MAPPING_VIEW",
      "ACCOUNT_MAPPING_EDIT",
    ]) {
      assert.ok(PERMISSION_CODES.includes(code as never), `${code} is missing`);
    }
    const leaf = (module: string, slug: string) =>
      MODULES.find((m) => m.key === module)
        ?.groups?.flatMap((g) => g.entities)
        .find((e) => e.slug === slug);
    assert.equal(leaf("settings", "system-default")?.permission, "MENU_SYSTEM_DEFAULT_ACCESS");
    assert.equal(leaf("accounting", "account-mapping")?.permission, "MENU_ACCOUNT_MAPPING_ACCESS");
  });

  test("a ref value reads back as a row id, and anything else as nothing", () => {
    const values = (raw: string | null) => ({ ...EMPTY_SYSTEM_DEFAULTS, fx_account: raw });
    assert.equal(refValueOf(values("12"), "fx_account"), 12);
    assert.equal(refValueOf(values(null), "fx_account"), null);
    assert.equal(refValueOf(values(""), "fx_account"), null);
    assert.equal(refValueOf(values("abc"), "fx_account"), null);
    assert.equal(refValueOf(values("0"), "fx_account"), null);
  });
});

// ------------------------------------------------------------- reading it back

describe("a saved setting is what the application reads", () => {
  test("a value written is a value read, and an unchanged save claims nothing", async () => {
    await writeSystemDefaults({ fx_account: "12" }, actor);
    assert.equal((await systemDefaults()).fx_account, "12");
    assert.deepEqual(await writeSystemDefaults({ fx_account: "12" }, actor), []);
    await writeSystemDefaults({ fx_account: null }, actor);
    assert.equal((await systemDefaults()).fx_account, null);
  });

  test("a key outside the catalogue is never written", async () => {
    await writeSystemDefaults({ fx_account: null, default_company: "1" } as never, actor);
    const row = await prisma.sysSetting.findUnique({ where: { setting_key: "default_company" } });
    assert.equal(row, null, "sys_setting holds only keys the catalogue declares");
  });

  test("a new record's Currency starts on the base currency (P61)", async () => {
    const base = await baseCurrency();
    assert.equal(base?.label, "IDR");
    assert.equal(await baseCurrencyId(), base?.active ? base.id : null);
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

describe("the PPN settings (P60)", () => {
  test("seeded to 12 % on 11/12 and read as the rates documents snapshot", async () => {
    assert.deepEqual(await ppnRates(), { rate: 12, otherNum: 11, otherDen: 12 });
  });

  test("a figure the tax law sets is never empty and stays in bounds", () => {
    const rate = systemDefaultDef("ppn_rate");
    const num = systemDefaultDef("ppn_dpp_other_numerator");
    const den = systemDefaultDef("ppn_dpp_other_denominator");
    assert.ok(rate.type === "number" && num.type === "number" && den.type === "number");
    assert.ok(numberSettingProblem(rate, "", {}), "empty");
    assert.ok(numberSettingProblem(rate, "0", {}), "zero");
    assert.ok(numberSettingProblem(rate, "101", {}), "over 100 %");
    assert.equal(numberSettingProblem(rate, "12", {}), null);
    assert.ok(numberSettingProblem(num, "11.5", {}), "a whole number");
    assert.ok(numberSettingProblem(den, "10", { ppn_dpp_other_numerator: "11" }), "DPP Nilai Lain never exceeds DPP");
    assert.equal(numberSettingProblem(den, "12", { ppn_dpp_other_numerator: "11" }), null);
  });
});
