import test, { after, describe } from "node:test";
import assert from "node:assert/strict";

import { ENTITIES } from "../src/lib/erp/entities";
import { entityPermissions } from "../src/lib/erp/entity-access";
import { MODULES } from "../src/lib/erp/nav";
import { PERMISSIONS } from "../src/lib/erp/permissions";
import { paymentTermDaysError, withholdingRateError } from "../src/lib/erp/reference-rules";
import { formatPct } from "../src/lib/format";
import { checkSystemDefaultValue, defaultPph22WithholdingTaxId } from "../src/lib/erp/system-settings";
import { disconnect, prisma } from "./helpers";

/**
 * The reference masters added for the sales process: Satuan, Termin
 * Pembayaran, Gudang and Jenis PPh (P43, P44).
 *
 * They are registry entities, so the generic suites already cover their list,
 * form and audit. What is proved here is what is particular to them: each is
 * fully wired, the two value rules hold, and Jenis PPh starts seeded.
 */

const KEYS = ["ref_uom", "ref_payment_term", "ref_warehouse", "ref_withholding_tax"];

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
      where: { wht_code: { in: ["wht.0001", "wht.0002", "wht.0003", "wht.0004"] } },
      orderBy: { wht_code: "asc" },
    });
    assert.equal(rows.length, 4, "four starting types");
    // Seeded by code, not by label, so a user's rename is not undone.
    const byCode = Object.fromEntries(rows.map((r) => [r.wht_code, r.rate.toNumber()]));
    assert.ok(byCode["wht.0001"] > 0 && byCode["wht.0002"] > 0);
    const entity = ENTITIES.find((e) => e.key === "ref_withholding_tax")!;
    assert.ok(entityPermissions(entity.key).create, "users may add their own");
    assert.ok(!entity.fields.find((f) => f.name === "rate")?.locked, "and edit the rate");
  });
});

describe("the PPh 22 collector rule points at a Jenis PPh (P52)", () => {
  test("seeded to PPH22 and resolvable", async () => {
    const id = await defaultPph22WithholdingTaxId();
    assert.ok(id, "set by the seed");
    const row = await prisma.refWithholdingTax.findUniqueOrThrow({ where: { id: id! } });
    assert.equal(row.wht_code, "wht.0001");
  });

  test("an inactive Jenis PPh cannot be stored as the default", async () => {
    const row = await prisma.refWithholdingTax.create({
      data: {
        wht_code: `test.WHTX${Date.now() % 100000}`,
        wht_label: `ZZTESTWHT${Date.now() % 100000}`,
        wht_name: "Fixture",
        rate: 1,
        status: "Inactive",
        created_by: 1,
      },
    });
    try {
      assert.ok(await checkSystemDefaultValue("pph22_withholding_tax", row.id));
    } finally {
      await prisma.refWithholdingTax.delete({ where: { id: row.id } });
    }
  });
});
