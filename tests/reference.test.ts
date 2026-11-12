import test, { after, describe } from "node:test";
import assert from "node:assert/strict";

import { ENTITIES } from "../src/lib/erp/entities";
import { entityPermissions } from "../src/lib/erp/entity-access";
import { MODULES, visibleModules } from "../src/lib/erp/nav";
import { PERMISSIONS } from "../src/lib/erp/permissions";
import { paymentTermDaysError, withholdingRateError } from "../src/lib/erp/reference-rules";
import { formatPct } from "../src/lib/format";
import { SYSTEM_DEFAULTS } from "../src/lib/erp/system-defaults";
import { disconnect, prisma } from "./helpers";

/**
 * The reference masters added for the sales process: Satuan, Termin
 * Pembayaran, Gudang and Jenis PPh (P43, P44).
 *
 * They are registry entities, so the generic suites already cover their list,
 * form and audit. What is proved here is what is particular to them: each is
 * fully wired, the two value rules hold, and Jenis PPh starts seeded.
 */

const KEYS = ["ref_uom", "ref_payment_term", "ref_warehouse", "ref_withholding_tax", "ref_exchange_rate"];

after(disconnect);

describe("each reference master is wired end to end", () => {
  const codes = new Set(PERMISSIONS.map((p) => p.code));
  const navKeys = new Set(
    MODULES.flatMap((m) => (m.groups ?? []).flatMap((g) => g.entities.map((e) => e.key)))
  );

  for (const key of KEYS) {
    test(`${key}: registry, permissions and menu`, () => {
      const entity = ENTITIES.find((e) => e.key === key);
      assert.ok(entity, "registered");
      assert.equal(entity.module, "master");
      const perms = entityPermissions(key);
      for (const op of ["view", "create", "edit", "activate", "deactivate"] as const) {
        assert.ok(perms[op] && codes.has(perms[op]!), `${op} permission exists in the catalogue`);
      }
      assert.ok(navKeys.has(key), "reachable from the Master menu");
    });
  }

  test("there is no tax-code table: PPN or not is an enum on the transaction", () => {
    assert.ok(!ENTITIES.some((e) => /tax_code|kode_pajak/.test(e.key)));
  });
});

describe("Kurs (Multi-Currency-Plan MC6, MC19)", () => {
  test("one active rate per currency, type and day; an inactive one may repeat it", async () => {
    const usd = await prisma.refCurrency.findFirstOrThrow({ where: { currency_label: "USD" } });
    const row = (code: string, status: "Active" | "Inactive" = "Active") => ({
      rate_code: code, currency_id: usd.id, rate_date: new Date("2099-01-02T00:00:00Z"), rate: 16000, status, created_by: 1,
    });
    const a = await prisma.refExchangeRate.create({ data: row("test.kurs.a") });
    try {
      await assert.rejects(prisma.refExchangeRate.create({ data: row("test.kurs.b") }));
      const c = await prisma.refExchangeRate.create({ data: row("test.kurs.c", "Inactive") });
      await prisma.refExchangeRate.delete({ where: { id: c.id } });
      await assert.rejects(prisma.refExchangeRate.create({ data: { ...row("test.kurs.d"), rate_date: new Date("2099-01-03T00:00:00Z"), rate: 0 } }));
    } finally {
      await prisma.refExchangeRate.delete({ where: { id: a.id } });
    }
  });

  test("the Pajak module is hidden from the menu while multi-currency is built", () => {
    const all = PERMISSIONS.map((p) => p.code);
    assert.ok(MODULES.some((m) => m.key === "tax"), "kept, not deleted");
    assert.ok(!visibleModules(all).some((m) => m.key === "tax"), "not shown even to a user holding every permission");
  });
});

describe("Termin Pembayaran counts whole days", () => {
  test("0 (Tunai) up to ten years is accepted", () => {
    for (const d of [0, 7, 30, 60, 3650]) assert.equal(paymentTermDaysError(d), null);
  });
  test("negative, fractional, missing or absurd days are refused", () => {
    for (const d of [-1, 1.5, null, 3651, Number.NaN]) assert.ok(paymentTermDaysError(d));
  });
});

describe("Jenis PPh carries a real rate", () => {
  test("above 0 and at most 100 percent", () => {
    for (const r of [0.5, 1.5, 2, 15, 100]) assert.equal(withholdingRateError(r), null);
    for (const r of [0, -2, 100.01, null]) assert.ok(withholdingRateError(r));
  });

  test("a rate prints the Indonesian way, only with the decimals it has", () => {
    assert.equal(formatPct(1.5), "1,5%");
    assert.equal(formatPct(2), "2%");
    assert.equal(formatPct("12.25"), "12,25%");
  });

  test("the common types are seeded, and stay editable user data", async () => {
    const rows = await prisma.refWithholdingTax.findMany({
      where: { wht_label: { in: ["PPH22", "PPH23", "PPH23-15"] } },
      orderBy: { wht_code: "asc" },
    });
    // Three since P60 dropped PPH42-SEWA (P62): PPH22, PPH23, PPH23-15.
    assert.equal(rows.length, 3, "three starting types");
    assert.ok(rows.every((r) => r.rate.toNumber() > 0), "each with a real rate");
    const entity = ENTITIES.find((e) => e.key === "ref_withholding_tax")!;
    assert.ok(entityPermissions(entity.key).create, "users may add their own");
    assert.ok(!entity.fields.find((f) => f.name === "rate")?.locked, "and edit the rate");
  });
});

describe("Jenis PPh is a plain master (P61)", () => {
  test("no setting points at a Jenis PPh any more", () => {
    assert.ok(!SYSTEM_DEFAULTS.some((d) => d.key === ("pph22_withholding_tax" as never)));
  });
});

