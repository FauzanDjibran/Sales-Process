import test, { after, before, describe } from "node:test";
import assert from "node:assert/strict";

import { openCashBankBook } from "../src/lib/erp/cash-bank";
import { cashExchangePreview, checkCashExchange, createCashExchange, transitionCashExchange, type CashExchangeInput } from "../src/lib/erp/cash-exchange";
import { cashExchangeKind, cashExchangeRate } from "../src/lib/erp/cash-exchange-workflow";
import { CASH_BANK_SUBCATEGORY } from "../src/lib/erp/records";
import { FIXTURE_PREFIX, cleanupFiscalYear, cleanupFixtures, disconnect, makeAccount, openFiscalYear, prisma, systemUserId } from "./helpers";

/**
 * Penukaran Valas (Multi-Currency-Plan MC11a): a purchase brings the rupiah
 * paid into the foreign pool exactly, a sale releases the pool at its moving
 * average and books the difference as selisih kurs.
 */

const today = new Date().toISOString().slice(0, 10);
const f = {} as Record<string, number>;
const banks: number[] = [];
const docs: number[] = [];
let savedFx: string | null = null;

async function makeBank(currencyId: number, opening: number, rate: number) {
  const key = `${FIXTURE_PREFIX}PV${banks.length}${Date.now() % 100000}`;
  const row = await prisma.mCashBank.create({
    data: {
      cash_bank_code: `test.${key}`,
      cash_bank_label: key,
      cash_bank_name: `Bank ${key}`,
      cash_bank_type: "Bank",
      currency_id: currencyId,
      account_id: await makeAccount({ subcategoryLabel: CASH_BANK_SUBCATEGORY }),
      created_by: f.actor,
    },
  });
  await openCashBankBook(prisma, { cashBankId: row.id, openingBalance: opening, rate, date: today, actorId: f.actor });
  banks.push(row.id);
  return row.id;
}

const pool = async (id: number) => {
  const b = await prisma.cashBankBalance.findUniqueOrThrow({ where: { cash_bank_id: id } });
  return [b.balance.toNumber(), b.base_balance.toNumber()];
};

async function post(input: Omit<CashExchangeInput, "exchange_date">) {
  const made = await createCashExchange({ exchange_date: today, ...input }, f.actor);
  assert.ok(made.ok, JSON.stringify(made));
  docs.push(made.id);
  return { id: made.id, result: await transitionCashExchange(made.id, "post", f.actor) };
}

before(async () => {
  await openFiscalYear();
  f.actor = await systemUserId();
  f.idr = (await prisma.refCurrency.findFirstOrThrow({ where: { currency_label: "IDR" } })).id;
  f.usd = (await prisma.refCurrency.findFirstOrThrow({ where: { currency_label: "USD" } })).id;
  f.idrBank = await makeBank(f.idr, 100_000_000, 1);
  f.usdBank = await makeBank(f.usd, 0, 1);
  f.usdBank2 = await makeBank(f.usd, 0, 1);
  f.fx = await makeAccount({ subcategoryLabel: CASH_BANK_SUBCATEGORY });
  savedFx = (await prisma.sysSetting.findUnique({ where: { setting_key: "fx_account" } }))?.setting_value ?? null;
  await prisma.sysSetting.upsert({
    where: { setting_key: "fx_account" },
    update: { setting_value: String(f.fx) },
    create: { setting_key: "fx_account", setting_value: String(f.fx), updated_by: f.actor },
  });
});

after(async () => {
  await prisma.sysSetting.update({ where: { setting_key: "fx_account" }, data: { setting_value: savedFx } });
  await prisma.auditLog.deleteMany({ where: { entity_key: "fin_cash_exchange", row_id: { in: docs } } });
  await prisma.cashBankLedger.deleteMany({ where: { cash_bank_id: { in: banks } } });
  await prisma.finCashExchange.deleteMany({ where: { id: { in: docs } } });
  await prisma.cashBankPeriod.deleteMany({ where: { cash_bank_id: { in: banks } } });
  await prisma.cashBankBalance.deleteMany({ where: { cash_bank_id: { in: banks } } });
  await prisma.mCashBank.deleteMany({ where: { id: { in: banks } } });
  await cleanupFixtures();
  await cleanupFiscalYear();
  await disconnect();
});

describe("Penukaran Valas (MC11a)", () => {
  test("the kind follows the rupiah side, and the rate is the bank's quotient", () => {
    assert.equal(cashExchangeKind(true, false), "Buy");
    assert.equal(cashExchangeKind(false, true), "Sell");
    assert.equal(cashExchangeKind(true, true), null);
    assert.equal(cashExchangeRate("Buy", 16_250_000, 1_000), 16_250);
    assert.equal(cashExchangeRate("Sell", 500, 8_200_000), 16_400);
  });

  test("a pair in one currency is not a penukaran", async () => {
    const r = await checkCashExchange(prisma, {
      exchange_date: today,
      from_cash_bank_id: f.usdBank,
      to_cash_bank_id: f.usdBank2,
      from_amount: 10,
      to_amount: 10,
    });
    assert.equal(r.ok, false);
    assert.match(!r.ok ? r.errors.to_cash_bank_id : "", /Transfer/);
  });

  test("buying brings the rupiah paid into the foreign pool exactly, with no difference", async () => {
    const a = await post({ from_cash_bank_id: f.idrBank, to_cash_bank_id: f.usdBank, from_amount: 16_250_000, to_amount: 1_000 });
    assert.ok(a.result.ok, JSON.stringify(a.result));
    const b = await post({ from_cash_bank_id: f.idrBank, to_cash_bank_id: f.usdBank, from_amount: 15_500_000, to_amount: 1_000 });
    assert.ok(b.result.ok, JSON.stringify(b.result));
    assert.deepEqual(await pool(f.usdBank), [2_000, 31_750_000], "two purchases average to 15.875");
    assert.deepEqual(await pool(f.idrBank), [68_250_000, 68_250_000]);
    const doc = await prisma.finCashExchange.findUniqueOrThrow({ where: { id: b.id }, include: { journal: { include: { lines: true } } } });
    assert.deepEqual([doc.from_base?.toNumber(), doc.to_base?.toNumber(), doc.fx_difference.toNumber()], [15_500_000, 15_500_000, 0]);
    assert.equal(doc.journal?.lines.length, 2, "no selisih kurs line");
  });

  test("the confirmation runs Posting without writing anything (P103)", async () => {
    const made = await createCashExchange({ exchange_date: today, from_cash_bank_id: f.usdBank, to_cash_bank_id: f.idrBank, from_amount: 500, to_amount: 8_200_000 }, f.actor);
    assert.ok(made.ok);
    docs.push(made.id);
    const preview = await cashExchangePreview(made.id, f.actor);
    assert.ok(preview.ok, JSON.stringify(preview));
    assert.deepEqual(await pool(f.usdBank), [2_000, 31_750_000]);
    assert.equal((await prisma.finCashExchange.findUniqueOrThrow({ where: { id: made.id } })).status, "Draft");
    // Posting it now: 500 leaves at the pool's average, 7.937.500; the bank
    // credited 8.200.000; the difference is a selisih kurs gain.
    const r = await transitionCashExchange(made.id, "post", f.actor);
    assert.ok(r.ok, JSON.stringify(r));
    assert.deepEqual(await pool(f.usdBank), [1_500, 23_812_500], "the pool keeps its average");
    const doc = await prisma.finCashExchange.findUniqueOrThrow({ where: { id: made.id }, include: { journal: { include: { lines: true } } } });
    assert.deepEqual([doc.from_base?.toNumber(), doc.to_base?.toNumber(), doc.fx_difference.toNumber()], [7_937_500, 8_200_000, 262_500]);
    const fxLine = doc.journal!.lines.find((l) => l.account_id === f.fx)!;
    assert.deepEqual([fxLine.debit_amount.toNumber(), fxLine.kredit_amount.toNumber()], [0, 262_500], "a gain is credited");
  });

  test("selling below the average is a loss, and emptying the pool releases what is left exactly", async () => {
    const a = await post({ from_cash_bank_id: f.usdBank, to_cash_bank_id: f.idrBank, from_amount: 1_500, to_amount: 22_500_000 });
    assert.ok(a.result.ok, JSON.stringify(a.result));
    assert.deepEqual(await pool(f.usdBank), [0, 0]);
    const doc = await prisma.finCashExchange.findUniqueOrThrow({ where: { id: a.id } });
    assert.equal(doc.fx_difference.toNumber(), 22_500_000 - 23_812_500);
  });

  test("selling more than the pool holds is refused and writes nothing", async () => {
    const a = await post({ from_cash_bank_id: f.usdBank, to_cash_bank_id: f.idrBank, from_amount: 1, to_amount: 16_000 });
    assert.equal(a.result.ok, false);
    assert.equal((await prisma.finCashExchange.findUniqueOrThrow({ where: { id: a.id } })).status, "Draft");
  });
});
