import test, { after, before, describe } from "node:test";
import assert from "node:assert/strict";

import {
  checkSalesAdvance,
  createSalesAdvance,
  getSalesAdvance,
  salesAdvanceOptions,
  transitionSalesAdvance,
  updateSalesAdvance,
  type SalesAdvanceInput,
} from "../src/lib/erp/sales-advance";
import { createSalesOrder, transitionSalesOrder, type SalesOrderLineInput } from "../src/lib/erp/sales-order";
import { availableAdvanceActions, salesAdvanceAbilities } from "../src/lib/erp/sales-advance-workflow";
import { CASH_BANK_SUBCATEGORY } from "../src/lib/erp/records";
import { computeAdvance } from "../src/lib/erp/sales-tax";
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
 * Uang Muka Penjualan (P54–P58): what may be saved, how the order's room is
 * spent, how a bill moves Draft → Diterbitkan / Dibatalkan, and that only an
 * Open order takes one — a closed order takes no new bill, though its issued
 * ones stand (P63). A bill posts nothing, which the journal count proves.
 */

let actor = 0;
const f = {} as Record<string, number>;
const orders: number[] = [];
const advances: number[] = [];
const cleanups: (() => Promise<unknown>)[] = [];
const stamp = String(Date.now() % 100000);
const key = (s: string) => `${FIXTURE_PREFIX}${s}${stamp}`;

async function cashBank(label: string, type: "Cash" | "Bank", status: "Active" | "Inactive" = "Active") {
  const currency = (await prisma.refCurrency.findFirstOrThrow({ where: { currency_label: "IDR" } })).id;
  const account = await makeAccount({ subcategoryLabel: CASH_BANK_SUBCATEGORY });
  return (
    await prisma.mCashBank.create({
      data: {
        cash_bank_code: `test.${key(label)}`,
        cash_bank_label: key(label),
        cash_bank_name: label,
        cash_bank_type: type,
        currency_id: currency,
        account_id: account,
        status,
        created_by: actor,
      },
    })
  ).id;
}

/** An Open order: 2 PCS withheld + 1 PCS not, 1.000.000 each, Exclude PPN. */
async function openOrder(open = true) {
  const line = (over: Partial<SalesOrderLineInput> = {}): SalesOrderLineInput => ({
    item_id: f.goods,
    uom_id: f.pcs,
    qty: 1,
    price: 1_000_000,
    discount_type: null,
    discount_value: null,
    withholding_tax_id: null,
    note: "",
    ...over,
  });
  const r = await createSalesOrder(
    {
      order_date: "2026-09-10",
      customer_id: f.customer,
      address_id: f.address,
      term_id: f.term,
      price_mode: "Exclude",
      is_taxable: true,
      po_no: "PO-ADV-1",
      po_date: "",
      salesperson: "",
      note: "",
    },
    [line({ qty: 2, withholding_tax_id: f.wht }), line()],
    actor
  );
  assert.ok(r.ok, JSON.stringify(r));
  orders.push(r.id);
  if (open) {
    assert.deepEqual(await transitionSalesOrder(r.id, "submit", actor), { ok: true });
    assert.deepEqual(await transitionSalesOrder(r.id, "approve", actor), { ok: true });
  }
  return r.id;
}

async function setPpnRate(value: string) {
  await prisma.sysSetting.update({ where: { setting_key: "ppn_rate" }, data: { setting_value: value } });
}

const input = (over: Partial<SalesAdvanceInput> = {}): SalesAdvanceInput => ({
  order_id: f.order,
  advance_date: "2026-09-11",
  due_date: "2026-09-18",
  cash_bank_id: f.bank,
  description: "Uang muka 30%",
  note: "",
  amount_type: "Percent",
  amount_value: 30,
  ...over,
});

async function create(i = input()) {
  const r = await createSalesAdvance(i, actor);
  if (r.ok) advances.push(r.id);
  return r;
}

before(async () => {
  actor = await systemUserId();
  f.pcs = (await prisma.refUom.create({ data: { uom_code: `test.${key("PCS")}`, uom_label: key("PCS"), uom_name: "Pcs", created_by: actor } })).id;
  const cat = (await prisma.sysItemCategory.findUniqueOrThrow({ where: { category_label: "BRG-JADI" } })).id;
  f.goods = (
    await prisma.mItem.create({
      data: { item_code: `test.${key("G")}`, item_label: key("G"), item_name: "Barang", item_type: "Barang", category_id: cat, base_uom_id: f.pcs, can_sell: true, created_by: actor },
    })
  ).id;
  f.term = (await prisma.refPaymentTerm.create({ data: { term_code: `test.${key("T")}`, term_label: key("T"), term_name: "Net 30", due_days: 30, created_by: actor } })).id;
  f.wht = (await prisma.refWithholdingTax.create({ data: { wht_code: `test.${key("WHT")}`, wht_label: key("WHT"), wht_name: "PPh 22 Uji", rate: 1.5, created_by: actor } })).id;

  f.customer = await makePartner({ categoryLabel: "Customer" });
  await prisma.mPartner.update({
    where: { id: f.customer },
    data: { taxpayer_type: "Badan", tax_id_type: "NPWP", tax_id: "0987654321098765", tax_name: "PT FIXTURE", is_pkp: true, collects_pph22: true },
  });
  const village = await prisma.sysRegionVillage.findFirstOrThrow({ orderBy: { code: "asc" } });
  f.address = (await prisma.mPartnerAddress.create({ data: { partner_id: f.customer, village_id: village.id, street: "Kantor", created_by: actor } })).id;

  f.bank = await cashBank("BANK", "Bank");
  f.cash = await cashBank("KAS", "Cash");
  f.order = await openOrder();

  cleanups.push(
    () => prisma.mItem.deleteMany({ where: { id: f.goods } }),
    () => prisma.refUom.deleteMany({ where: { id: f.pcs } }),
    () => prisma.refPaymentTerm.deleteMany({ where: { id: f.term } }),
    () => prisma.refWithholdingTax.deleteMany({ where: { id: f.wht } })
  );
});

after(async () => {
  await prisma.salAdvance.deleteMany({ where: { id: { in: advances } } });
  await prisma.auditLog.deleteMany({ where: { entity_key: "sal_advance", row_id: { in: advances } } });
  await prisma.salOrderLine.deleteMany({ where: { order_id: { in: orders } } });
  await prisma.salOrder.deleteMany({ where: { id: { in: orders } } });
  await prisma.auditLog.deleteMany({ where: { entity_key: "sal_order", row_id: { in: orders } } });
  await cleanupFixtures();
  for (const c of cleanups) await c();
  await disconnect();
});

// ----------------------------------------------------------------- options

describe("what the form offers", () => {
  test("Open orders with their room, and rupiah bank accounts only", async () => {
    const draft = await openOrder(false);
    const o = await salesAdvanceOptions();
    const so = o.orders.find((x) => x.id === f.order);
    assert.ok(so);
    assert.equal(so.value, 3_000_000, "Exclude: drawn from the order's DPP");
    assert.equal(so.left, 3_000_000 - so.drawn);
    assert.deepEqual(so.basis.withholdings, [{ key: String(f.wht), rate: 1.5, base: 2_000_000 }]);
    assert.ok(!o.orders.some((x) => x.id === draft), "a Draft order is not offered");
    const banks = o.banks.map((b) => b.id);
    assert.ok(banks.includes(f.bank) && !banks.includes(f.cash));
  });
});

// -------------------------------------------------------------- validation

describe("what may be saved", () => {
  test("a complete bill passes, with the tax module's figures", async () => {
    const r = await checkSalesAdvance(prisma, input(), null);
    assert.ok(r.ok);
    assert.equal(r.c.figures.amount, 900_000);
    assert.equal(r.c.figures.ppn, 99_000);
    assert.equal(r.c.figures.total, 999_000);
    assert.equal(r.c.data.customer_id, f.customer, "the customer follows the order");
    assert.equal(r.c.data.price_mode, "Exclude");
  });

  test("the order, dates, bank, description and value are enforced", async () => {
    const draft = await openOrder(false);
    const a = await checkSalesAdvance(prisma, input({ order_id: draft }), null);
    assert.ok(!a.ok && /Open/.test(a.errors.order_id));
    const b = await checkSalesAdvance(
      prisma,
      input({ advance_date: "2026-09-01", due_date: "2026-08-30", cash_bank_id: f.cash, description: " ", amount_value: 101 }),
      null
    );
    assert.ok(!b.ok);
    for (const k of ["advance_date", "due_date", "cash_bank_id", "description", "amount_value"]) {
      assert.ok(b.errors[k], `${k} is refused`);
    }
  });
});

// ---------------------------------------------------------------- the room

describe("an order's room is spent once", () => {
  test("bills drawn from one order cannot exceed it; a cancelled bill gives its share back", async () => {
    const order = await openOrder();
    const first = await create(input({ order_id: order, amount_value: 30 }));
    assert.ok(first.ok);
    const tooMuch = await create(input({ order_id: order, amount_value: 80 }));
    assert.ok(!tooMuch.ok && /sisa/i.test(tooMuch.errors.amount_value));
    const rest = await create(input({ order_id: order, amount_type: "Amount", amount_value: 2_100_000 }));
    assert.ok(rest.ok, "exactly what is left may be billed");
    const none = await create(input({ order_id: order, amount_type: "Amount", amount_value: 1 }));
    assert.ok(!none.ok);

    assert.deepEqual(await transitionSalesAdvance(first.id, "cancel", actor, "Salah persen"), { ok: true });
    const again = await create(input({ order_id: order, amount_value: 30 }));
    assert.ok(again.ok, "the cancelled bill's 30 % is billable again");
  });

  test("editing a bill does not count its own draw against it", async () => {
    const order = await openOrder();
    const r = await create(input({ order_id: order, amount_value: 100 }));
    assert.ok(r.ok);
    const up = await updateSalesAdvance(r.id, input({ order_id: order, amount_value: 90 }), actor);
    assert.ok(up.ok, JSON.stringify(up));
  });
});

// ---------------------------------------------------------------- lifecycle

describe("a bill's life", () => {
  test("numbered ARA in its own month's series", async () => {
    const a = await create();
    const b = await create(input({ amount_value: 1 }));
    assert.ok(a.ok && b.ok);
    assert.match(a.advanceNo, /^ARA\/2026\/09\/\d{4}$/);
    assert.equal(Number(b.advanceNo.slice(-4)), Number(a.advanceNo.slice(-4)) + 1);
    await transitionSalesAdvance(a.id, "cancel", actor, "uji");
    await transitionSalesAdvance(b.id, "cancel", actor, "uji");
  });

  test("a Draft is edited; issuing locks it and posts nothing", async () => {
    const journals = await prisma.accJournal.count();
    const r = await create();
    assert.ok(r.ok);
    const moved = await updateSalesAdvance(r.id, input({ order_id: await openOrder() }), actor);
    assert.ok(!moved.ok && moved.errors.order_id, "the order cannot be swapped");
    const up = await updateSalesAdvance(r.id, input({ amount_type: "Amount", amount_value: 500_000 }), actor);
    assert.ok(up.ok);
    let a = (await getSalesAdvance(r.id))!;
    assert.deepEqual(a.figures, { amount: 500_000, dpp: 500_000, dppOther: 458_333, ppn: 55_000, total: 555_000 });

    assert.deepEqual(await transitionSalesAdvance(r.id, "issue", actor), { ok: true });
    a = (await getSalesAdvance(r.id))!;
    assert.equal(a.status, "Issued");
    const again = await updateSalesAdvance(r.id, input(), actor);
    assert.ok(!again.ok && again.errors._form, "an issued bill is not edited");
    assert.equal(await prisma.accJournal.count(), journals, "a bill posts nothing");

    const events = (
      await prisma.auditLog.findMany({ where: { entity_key: "sal_advance", row_id: r.id }, orderBy: { id: "asc" } })
    ).map((x) => x.event);
    assert.deepEqual(events, ["create", "update", "issue"]);

    const bare = await transitionSalesAdvance(r.id, "cancel", actor, " ");
    assert.ok(!bare.ok && bare.errors.reason);
    assert.deepEqual(await transitionSalesAdvance(r.id, "cancel", actor, "Customer batal"), { ok: true });
    assert.equal((await getSalesAdvance(r.id))!.cancelReason, "Customer batal");
  });

  test("issuing re-checks the bank", async () => {
    const r = await create(input({ amount_value: 10 }));
    assert.ok(r.ok);
    await prisma.mCashBank.update({ where: { id: f.bank }, data: { status: "Inactive" } });
    try {
      const c = await transitionSalesAdvance(r.id, "issue", actor);
      assert.ok(!c.ok && /nonaktif/.test(c.errors._form));
    } finally {
      await prisma.mCashBank.update({ where: { id: f.bank }, data: { status: "Active" } });
    }
    await transitionSalesAdvance(r.id, "cancel", actor, "uji");
  });

  test("the PPh estimate covers the order's withheld Barang lines", async () => {
    const [o] = (await salesAdvanceOptions()).orders.filter((x) => x.id === f.order);
    const fig = computeAdvance({ basis: o.basis, type: "Percent", typed: 30, rates: { rate: 12, otherNum: 11, otherDen: 12 } });
    assert.deepEqual(fig.withholdings.map((w) => [w.base, w.amount]), [[600_000, 9_000]]);
  });

  test("a bill snapshots the PPN rate; Terbitkan freezes it (P60)", async () => {
    const r = await create(input({ amount_type: "Amount", amount_value: 100_000 }));
    assert.ok(r.ok);
    let a = (await getSalesAdvance(r.id))!;
    assert.deepEqual(a.rates, { rate: 12, otherNum: 11, otherDen: 12 });
    await setPpnRate("11");
    try {
      // A Draft takes the rate in force at its next step…
      assert.deepEqual(await transitionSalesAdvance(r.id, "issue", actor), { ok: true });
      a = (await getSalesAdvance(r.id))!;
      assert.equal(a.rates?.rate, 11);
      assert.equal(a.figures.ppn, 10_083, "11 % × round(100.000 × 11/12) = 11 % × 91.667");
    } finally {
      await setPpnRate("12");
    }
    // …and keeps it once issued, whatever the setting says afterwards.
    a = (await getSalesAdvance(r.id))!;
    assert.equal(a.rates?.rate, 11);
    assert.equal(a.figures.ppn, 10_083);
    await transitionSalesAdvance(r.id, "cancel", actor, "uji");
  });

  test("the buttons offered follow the table and the permissions", () => {
    const all = salesAdvanceAbilities(["SALES_ADVANCE_ISSUE", "SALES_ADVANCE_CANCEL"]);
    assert.deepEqual(availableAdvanceActions("Draft", all), ["issue", "cancel"]);
    assert.deepEqual(availableAdvanceActions("Issued", all), ["cancel"]);
    assert.deepEqual(availableAdvanceActions("Cancelled", all), []);
    assert.deepEqual(availableAdvanceActions("Draft", salesAdvanceAbilities([])), []);
  });
});

// ------------------------------------------------------ the order's side

describe("a closed order takes no new bill (P63)", () => {
  test("its issued bill stands; a new one is refused", async () => {
    const order = await openOrder();
    const r = await create(input({ order_id: order }));
    assert.ok(r.ok);
    assert.deepEqual(await transitionSalesAdvance(r.id, "issue", actor), { ok: true });
    assert.deepEqual(await transitionSalesOrder(order, "close", actor, "selesai"), { ok: true });
    assert.equal((await getSalesAdvance(r.id))!.status, "Issued", "closing leaves the bill alone");
    const late = await create(input({ order_id: order }));
    assert.ok(!late.ok && late.errors.order_id, "a closed order takes no bill");
  });
});
