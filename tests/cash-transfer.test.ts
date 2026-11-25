import test, { after, before, describe } from "node:test";
import assert from "node:assert/strict";

import { openCashBankBook } from "../src/lib/erp/cash-bank";
import { cashTransferPreview, checkCashTransfer, createCashTransfer, transitionCashTransfer, type CashTransferInput } from "../src/lib/erp/cash-transfer";
import { transferLineAmounts } from "../src/lib/erp/cash-transfer-workflow";
import { CASH_BANK_SUBCATEGORY } from "../src/lib/erp/records";
import { FIXTURE_PREFIX, cleanupFiscalYear, cleanupFixtures, disconnect, makeAccount, openFiscalYear, prisma, systemUserId } from "./helpers";

/**
 * Transfer Kas & Bank (P299): SIBA's three purposes on ERP's moving average.
 * A Transfer and a Pembelian Valas carry exactly the base that left; a
 * Pencairan books its difference as selisih kurs.
 */

const today = new Date().toISOString().slice(0, 10);
const f = {} as Record<string, number>;
const banks: number[] = [];
const docs: number[] = [];
let savedFx: string | null = null;

async function makeBank(currencyId: number, opening: number, rate: number) {
  const key = `${FIXTURE_PREFIX}TR${banks.length}${Date.now() % 100000}`;
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

const doc = (id: number) =>
  prisma.finCashBankTransfer.findUniqueOrThrow({ where: { id }, include: { lines: { orderBy: { line_no: "asc" } }, journal: { include: { lines: true } } } });

async function post(input: Omit<CashTransferInput, "transfer_date">) {
  const made = await createCashTransfer({ transfer_date: today, ...input }, f.actor);
  assert.ok(made.ok, JSON.stringify(made));
  docs.push(made.id);
  return { id: made.id, result: await transitionCashTransfer(made.id, "post", f.actor) };
}

before(async () => {
  await openFiscalYear();
  f.actor = await systemUserId();
  f.idr = (await prisma.refCurrency.findFirstOrThrow({ where: { currency_label: "IDR" } })).id;
  f.usd = (await prisma.refCurrency.findFirstOrThrow({ where: { currency_label: "USD" } })).id;
  f.idrBank = await makeBank(f.idr, 100_000_000, 1);
  f.idrBank2 = await makeBank(f.idr, 0, 1);
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
  await prisma.auditLog.deleteMany({ where: { entity_key: "fin_cash_bank_transfer", row_id: { in: docs } } });
  await prisma.cashBankLedger.deleteMany({ where: { cash_bank_id: { in: banks } } });
  await prisma.finCashBankTransfer.deleteMany({ where: { id: { in: docs } } });
  await prisma.cashBankPeriod.deleteMany({ where: { cash_bank_id: { in: banks } } });
  await prisma.cashBankBalance.deleteMany({ where: { cash_bank_id: { in: banks } } });
  await prisma.mCashBank.deleteMany({ where: { id: { in: banks } } });
  await cleanupFixtures();
  await cleanupFiscalYear();
  await disconnect();
});

describe("Transfer Kas & Bank (P299)", () => {
  test("the rupiah side is one multiplication of the foreign amount", () => {
    assert.deepEqual(transferLineAmounts("Transfer", 500, 1), { outAmount: 500, inAmount: 500 });
    assert.deepEqual(transferLineAmounts("PembelianValas", 1_000.5, 16_250.25), { outAmount: 16_258_375.13, inAmount: 1_000.5 });
    assert.deepEqual(transferLineAmounts("Pencairan", 500, 16_400), { outAmount: 500, inAmount: 8_200_000 });
  });

  test("a pair the purpose does not describe is refused, naming the currencies", async () => {
    const check = (purpose: string, from: number, to: number) =>
      checkCashTransfer(prisma, { transfer_date: today, purpose, from_cash_bank_id: from, lines: [{ to_cash_bank_id: to, amount: 10, exchange_rate: 16_000 }] });
    const sell = await check("Pencairan", f.idrBank, f.idrBank2);
    assert.match(!sell.ok ? sell.errors.from_cash_bank_id : "", /tidak boleh IDR/);
    const move = await check("Transfer", f.idrBank, f.usdBank);
    assert.match(!move.ok ? move.errors["lines.0.to_cash_bank_id"] : "", /harus IDR, bukan USD/);
    const buy = await check("PembelianValas", f.idrBank, f.idrBank2);
    assert.equal(buy.ok, false);
    const self = await check("Transfer", f.idrBank, f.idrBank);
    assert.match(!self.ok ? self.errors["lines.0.to_cash_bank_id"] : "", /berbeda/);
  });

  test("a rupiah Transfer moves the amount, with no kurs and no difference", async () => {
    const a = await post({ purpose: "Transfer", from_cash_bank_id: f.idrBank, lines: [{ to_cash_bank_id: f.idrBank2, amount: 5_000_000 }] });
    assert.ok(a.result.ok, JSON.stringify(a.result));
    assert.deepEqual(await pool(f.idrBank2), [5_000_000, 5_000_000]);
    assert.deepEqual(await pool(f.idrBank), [95_000_000, 95_000_000]);
    assert.equal((await doc(a.id)).journal?.lines.length, 2);
  });

  test("buying brings amount × kurs rupiah into the foreign pool exactly, to two banks", async () => {
    const a = await post({
      purpose: "PembelianValas",
      from_cash_bank_id: f.idrBank,
      lines: [
        { to_cash_bank_id: f.usdBank, amount: 1_000, exchange_rate: 16_250 },
        { to_cash_bank_id: f.usdBank2, amount: 1_000, exchange_rate: 15_500 },
      ],
    });
    assert.ok(a.result.ok, JSON.stringify(a.result));
    assert.deepEqual(await pool(f.usdBank), [1_000, 16_250_000]);
    assert.deepEqual(await pool(f.usdBank2), [1_000, 15_500_000]);
    assert.deepEqual(await pool(f.idrBank), [63_250_000, 63_250_000]);
    const d = await doc(a.id);
    assert.deepEqual([d.from_amount.toNumber(), d.base_from_amount?.toNumber(), d.fx_difference.toNumber(), d.currency_id], [31_750_000, 31_750_000, 0, f.usd]);
    assert.equal(d.journal?.lines.length, 3, "two destinations, one source, no selisih kurs line");
  });

  test("a foreign Transfer carries the base that left, so the destination takes the source's average", async () => {
    const a = await post({ purpose: "Transfer", from_cash_bank_id: f.usdBank2, lines: [{ to_cash_bank_id: f.usdBank, amount: 1_000 }] });
    assert.ok(a.result.ok, JSON.stringify(a.result));
    assert.deepEqual(await pool(f.usdBank2), [0, 0]);
    assert.deepEqual(await pool(f.usdBank), [2_000, 31_750_000], "16.250 and 15.500 average to 15.875");
    assert.equal((await doc(a.id)).fx_difference.toNumber(), 0);
  });

  test("the confirmation runs Posting without writing anything (P103)", async () => {
    const made = await createCashTransfer(
      { transfer_date: today, purpose: "Pencairan", from_cash_bank_id: f.usdBank, lines: [{ to_cash_bank_id: f.idrBank, amount: 500, exchange_rate: 16_400 }] },
      f.actor
    );
    assert.ok(made.ok);
    docs.push(made.id);
    const preview = await cashTransferPreview(made.id, f.actor);
    assert.ok(preview.ok, JSON.stringify(preview));
    assert.deepEqual(await pool(f.usdBank), [2_000, 31_750_000]);
    assert.equal((await doc(made.id)).status, "Draft");
    // 500 leaves at the average, 7.937.500; the kurs gives 8.200.000; a gain.
    const r = await transitionCashTransfer(made.id, "post", f.actor);
    assert.ok(r.ok, JSON.stringify(r));
    assert.deepEqual(await pool(f.usdBank), [1_500, 23_812_500], "the pool keeps its average");
    const d = await doc(made.id);
    assert.deepEqual([d.base_from_amount?.toNumber(), d.lines[0].base_in_amount?.toNumber(), d.fx_difference.toNumber()], [7_937_500, 8_200_000, 262_500]);
    const fxLine = d.journal!.lines.find((l) => l.account_id === f.fx)!;
    assert.deepEqual([fxLine.debit_amount.toNumber(), fxLine.kredit_amount.toNumber()], [0, 262_500], "a gain is credited");
  });

  test("selling to two rupiah banks draws per line, and emptying the pool releases what is left exactly", async () => {
    const a = await post({
      purpose: "Pencairan",
      from_cash_bank_id: f.usdBank,
      lines: [
        { to_cash_bank_id: f.idrBank, amount: 1_000, exchange_rate: 15_000 },
        { to_cash_bank_id: f.idrBank2, amount: 500, exchange_rate: 15_000 },
      ],
    });
    assert.ok(a.result.ok, JSON.stringify(a.result));
    assert.deepEqual(await pool(f.usdBank), [0, 0]);
    const d = await doc(a.id);
    assert.deepEqual(
      d.lines.map((l) => [l.base_out_amount?.toNumber(), l.base_in_amount?.toNumber(), l.fx_difference.toNumber()]),
      [
        [15_875_000, 15_000_000, -875_000],
        [7_937_500, 7_500_000, -437_500],
      ]
    );
    assert.equal(d.fx_difference.toNumber(), 22_500_000 - 23_812_500);
  });

  test("moving more than the source holds is refused and writes nothing", async () => {
    const a = await post({ purpose: "Pencairan", from_cash_bank_id: f.usdBank, lines: [{ to_cash_bank_id: f.idrBank, amount: 1, exchange_rate: 16_000 }] });
    assert.equal(a.result.ok, false);
    assert.equal((await doc(a.id)).status, "Draft");
  });
});
