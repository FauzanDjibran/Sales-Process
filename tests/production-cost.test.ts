import test, { after, before, describe } from "node:test";
import assert from "node:assert/strict";

import { recordCashBankEntry } from "../src/lib/erp/cash-bank";
import { costBillPayments, createCashPayment, transitionCashPayment, type CashPaymentInput } from "../src/lib/erp/cash-payment";
import {
  costBillPreview,
  createCostBill,
  getCostBill,
  transitionCostBill,
  updateCostBill,
  type CostBillInput,
  type CostBillLineInput,
} from "../src/lib/erp/production-cost-bill";
import { CASH_BANK_SUBCATEGORY } from "../src/lib/erp/records";
import { cleanupFiscalYear, cleanupFixtures, disconnect, makeAccount, makePartner, openFiscalYear, prisma, systemUserId } from "./helpers";

/**
 * Tagihan Biaya (R9): a line picks a Jenis Biaya; posting debits its expense
 * account and credits Account Mapping's Hutang Biaya Produksi, copied onto the
 * bill; *Pembayaran Biaya Produksi* pays it on that account.
 */

const today = new Date().toISOString().slice(0, 10);
let actor = 0;
const f = {} as Record<string, number>;
const bills: number[] = [];
const payments: number[] = [];
const PAYABLE_KEY = "production_cost_payable_account";
let savedPayable: string | null | undefined;

async function setPayable(value: string | null) {
  await prisma.sysSetting.upsert({
    where: { setting_key: PAYABLE_KEY },
    update: { setting_value: value },
    create: { setting_key: PAYABLE_KEY, setting_value: value, updated_by: actor },
  });
}

const header = (over: Partial<CostBillInput> = {}): CostBillInput => ({
  bill_date: today,
  partner_id: f.supplier,
  supplier_ref: "PLN-10",
  due_date: today,
  description: "Listrik pabrik",
  note: "",
  ...over,
});

const line = (costType: number, amount: number, over: Partial<CostBillLineInput> = {}): CostBillLineInput => ({ cost_type_id: costType, amount, ...over });

async function create(h: CostBillInput, lines: CostBillLineInput[]) {
  const r = await createCostBill(h, lines, actor);
  if (r.ok) bills.push(r.id);
  return r;
}

const payment = (cash: number): CashPaymentInput => ({
  purpose: "production_cost_payment",
  tx_date: today,
  partner_id: f.supplier,
  cash_bank_id: f.bank,
  bank_ref: "TRF-PLN",
  note: "",
  bank_charge: 0,
  lines: [{ doc_type: "prd_cost_bill", doc_id: f.bill, cash, withhold: false }],
});

before(async () => {
  actor = await systemUserId();
  await openFiscalYear();
  f.supplier = await makePartner({ categoryLabel: "Supplier" });
  f.labour = await makeAccount({ subcategoryLabel: "5.1.1" });
  f.power = await makeAccount({ subcategoryLabel: "5.1.1" });
  f.payable = await makeAccount({ subcategoryLabel: "2.1.3", normalBalance: "Kredit" });
  savedPayable = (await prisma.sysSetting.findUnique({ where: { setting_key: PAYABLE_KEY } }))?.setting_value;
  await setPayable(String(f.payable));
  f.bankAcc = await makeAccount({ subcategoryLabel: CASH_BANK_SUBCATEGORY });
  const stamp = String(Date.now() % 100000);
  const type = async (label: string, expense: number, active = true) =>
    (
      await prisma.accCostType.create({
        data: { cost_type_code: `test.${label}${stamp}`, cost_type_label: `T-${label}-${stamp}`, cost_type_name: label, expense_account_id: expense, status: active ? "Active" : "Inactive", created_by: actor },
      })
    ).id;
  f.tLabour = await type("UPAH", f.labour);
  f.tPower = await type("LISTRIK", f.power);
  f.tOff = await type("MATI", f.power, false);
  const currency = (await prisma.refCurrency.findFirstOrThrow({ where: { currency_label: "IDR" } })).id;
  f.bank = (
    await prisma.mCashBank.create({
      data: { cash_bank_code: `test.PRDBANK${stamp}`, cash_bank_label: `PRDBANK${stamp}`, cash_bank_name: "Bank Uji Produksi", cash_bank_type: "Bank", currency_id: currency, account_id: f.bankAcc, created_by: actor },
    })
  ).id;
  await prisma.$transaction((tx) => recordCashBankEntry(tx, { cashBankId: f.bank, date: today, type: "Adjustment", direction: "In", rate: 1, amount: 10_000_000, actorId: actor }));
});

after(async () => {
  await prisma.finCashBankTx.deleteMany({ where: { id: { in: payments } } });
  await prisma.auditLog.deleteMany({ where: { entity_key: "fin_cash_bank_tx", row_id: { in: payments } } });
  await prisma.prdCostBill.deleteMany({ where: { id: { in: bills } } });
  await prisma.auditLog.deleteMany({ where: { entity_key: "prd_cost_bill", row_id: { in: bills } } });
  if (savedPayable === undefined) await prisma.sysSetting.deleteMany({ where: { setting_key: PAYABLE_KEY } });
  else await setPayable(savedPayable);
  await cleanupFixtures();
  await prisma.mPartner.deleteMany({ where: { id: f.supplier } });
  await cleanupFiscalYear();
  await disconnect();
});

describe("a Tagihan Biaya is checked before it is saved (R9)", () => {
  test("every bill names its Supplier", async () => {
    const r = await create(header({ partner_id: null }), [line(f.tLabour, 100_000)]);
    assert.ok(!r.ok && /Supplier/.test(r.errors.partner_id));
  });

  test("each line picks an active Jenis Biaya and a whole rupiah amount", async () => {
    const r = await create(header(), [line(f.tLabour, 0), line(f.tOff, 100)]);
    assert.ok(!r.ok);
    if (!r.ok) {
      assert.match(r.errors["lines.0.amount"], /rupiah penuh/);
      assert.match(r.errors["lines.1.cost_type_id"], /nonaktif/);
    }
  });
});

describe("posting books the cost; Pembayaran Biaya Produksi pays it", () => {
  test("the preview is exactly the journal Posting writes, and writes nothing", async () => {
    const r = await create(header(), [line(f.tLabour, 600_000, { note: "Upah borongan" }), line(f.tPower, 400_000)]);
    assert.ok(r.ok, JSON.stringify(r));
    f.bill = r.id;
    const preview = await costBillPreview(r.id, actor);
    assert.ok(preview.ok);
    if (preview.ok) assert.deepEqual(preview.lines.map((l) => [l.debit, l.credit]), [[600_000, 0], [400_000, 0], [0, 1_000_000]]);
    assert.equal((await getCostBill(r.id))!.status, "Draft", "a dry run leaves the bill a Draft");
  });

  test("Dr each expense account / Cr Hutang Biaya Produksi for the total, copied to the bill", async () => {
    assert.ok((await transitionCostBill(f.bill, "post", actor)).ok);
    const bill = (await getCostBill(f.bill))!;
    assert.equal(bill.status, "Posted");
    const lines = await prisma.accJournalLine.findMany({ where: { journal_id: bill.journalId! }, orderBy: { sequence_no: "asc" } });
    assert.deepEqual(
      lines.map((l) => [l.account_id, l.debit_amount.toNumber(), l.kredit_amount.toNumber()]),
      [[f.labour, 600_000, 0], [f.power, 400_000, 0], [f.payable, 0, 1_000_000]]
    );
    assert.equal((await prisma.prdCostBill.findUniqueOrThrow({ where: { id: f.bill } })).payable_account_id, f.payable);
  });

  test("a posted bill is final", async () => {
    const r = await updateCostBill(f.bill, header(), [line(f.tLabour, 1)], actor);
    assert.ok(!r.ok && /Draft/.test(r.errors._form));
    assert.ok(!(await transitionCostBill(f.bill, "post", actor)).ok);
  });

  test("paid in part, then in full: Dr Hutang Biaya Produksi / Cr Kas & Bank, never beyond the bill", async () => {
    for (const cash of [300_000, 700_000]) {
      const p = await createCashPayment(payment(cash), actor);
      assert.ok(p.ok, JSON.stringify(p));
      payments.push(p.id);
      assert.ok((await transitionCashPayment(p.id, "post", actor)).ok);
    }
    assert.equal((await getCostBill(f.bill))!.paid, 1_000_000);
    assert.equal((await costBillPayments(f.bill)).length, 2);
    const payableLines = await prisma.accJournalLine.findMany({ where: { account_id: f.payable } });
    assert.equal(payableLines.reduce((a, l) => a + l.debit_amount.toNumber() - l.kredit_amount.toNumber(), 0), 0, "the payable is cleared");
    const over = await createCashPayment(payment(1), actor);
    if (over.ok) payments.push(over.id);
    assert.ok(!over.ok, "a paid bill takes no more");
  });

  test("without Hutang Biaya Produksi in Account Mapping a bill saves but does not post", async () => {
    const r = await create(header(), [line(f.tPower, 250_000)]);
    assert.ok(r.ok, JSON.stringify(r));
    await setPayable(null);
    try {
      const p = await transitionCostBill(r.id, "post", actor);
      assert.ok(!p.ok && /Hutang Biaya Produksi belum diatur/.test(p.errors._form));
    } finally {
      await setPayable(String(f.payable));
    }
    assert.ok((await transitionCostBill(r.id, "cancel", actor, "uji")).ok);
  });

  test("Batalkan a Draft asks for a reason", async () => {
    const r = await create(header(), [line(f.tLabour, 5_000)]);
    assert.ok(r.ok);
    const bare = await transitionCostBill(r.id, "cancel", actor);
    assert.ok(!bare.ok && bare.errors.reason);
    assert.ok((await transitionCostBill(r.id, "cancel", actor, "salah input")).ok);
    assert.equal((await getCostBill(r.id))!.status, "Cancelled");
  });
});
