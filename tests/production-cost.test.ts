import test, { after, before, describe } from "node:test";
import assert from "node:assert/strict";

import { recordCashBankEntry } from "../src/lib/erp/cash-bank";
import { cashPaymentOptions, costBillPayments, createCashPayment, transitionCashPayment, type CashPaymentInput } from "../src/lib/erp/cash-payment";
import { costCenterReport } from "../src/lib/erp/cost-center";
import { CostCenterRefusal, postJournal } from "../src/lib/erp/journal";
import {
  costBillPreview,
  createCostBill,
  getCostBill,
  payableCostBills,
  transitionCostBill,
  updateCostBill,
  type CostBillInput,
  type CostBillLineInput,
} from "../src/lib/erp/production-cost-bill";
import { CASH_BANK_SUBCATEGORY } from "../src/lib/erp/records";
import { cleanupFiscalYear, cleanupFixtures, disconnect, makeAccount, makePartner, openFiscalYear, prisma, systemUserId } from "./helpers";

/**
 * Production cost after the cost-center review (P154, production_project.md
 * §21e): a Tagihan Biaya line picks a Jenis Biaya and a Cost Center; posting
 * debits the Jenis Biaya's expense account with the Cost Center and credits
 * Account Mapping's Hutang Biaya Produksi (P156); the bill is paid through
 * Pengeluaran on the account it was credited to. The Cost Center rule lives
 * in `postJournal`, for every source.
 */

const today = new Date().toISOString().slice(0, 10);
const yearStart = `${today.slice(0, 4)}-01-01`;
const month = { from: `${today.slice(0, 8)}01`, to: today };
let actor = 0;
const f = {} as Record<string, number>;
const bills: number[] = [];
const payments: number[] = [];
const centers: number[] = [];
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

const line = (costType: number, amount: number, over: Partial<CostBillLineInput> = {}): CostBillLineInput => ({
  cost_type_id: costType,
  cost_center_id: f.center,
  amount,
  ...over,
});

async function create(h: CostBillInput, lines: CostBillLineInput[]) {
  const r = await createCostBill(h, lines, actor);
  if (r.ok) bills.push(r.id);
  return r;
}

const payment = (cash: number, over: Partial<CashPaymentInput> = {}): CashPaymentInput => ({
  purpose: "production_cost_payment",
  tx_date: today,
  partner_id: f.supplier,
  cash_bank_id: f.bank,
  bank_ref: "TRF-PLN",
  note: "",
  bank_charge: 0,
  lines: [{ doc_type: "prd_cost_bill", doc_id: f.bill, cash, withhold: false }],
  ...over,
});

before(async () => {
  actor = await systemUserId();
  await openFiscalYear();
  f.supplier = await makePartner({ categoryLabel: "Supplier" });
  f.labour = await makeAccount({ subcategoryLabel: "5.1.1", requireCostCenter: true });
  f.power = await makeAccount({ subcategoryLabel: "5.1.1", requireCostCenter: true });
  f.plain = await makeAccount({ subcategoryLabel: "5.1.1" });
  f.payable = await makeAccount({ subcategoryLabel: "2.1.3", normalBalance: "Kredit" });
  savedPayable = (await prisma.sysSetting.findUnique({ where: { setting_key: PAYABLE_KEY } }))?.setting_value;
  await setPayable(String(f.payable));
  f.bankAcc = await makeAccount({ subcategoryLabel: CASH_BANK_SUBCATEGORY });
  const stamp = String(Date.now() % 100000);
  const center = async (label: string, active = true) => {
    const id = (
      await prisma.accCostCenter.create({
        data: { cost_center_code: `test.${label}${stamp}`, cost_center_label: `T-${label}-${stamp}`, cost_center_name: label, status: active ? "Active" : "Inactive", created_by: actor },
      })
    ).id;
    centers.push(id);
    return id;
  };
  f.center = await center("PRD");
  f.centerOff = await center("MATI", false);
  const type = async (label: string, expense: number, active = true) =>
    (
      await prisma.accCostType.create({
        data: {
          cost_type_code: `test.${label}${stamp}`,
          cost_type_label: `T-${label}-${stamp}`,
          cost_type_name: label,
          expense_account_id: expense,
          status: active ? "Active" : "Inactive",
          created_by: actor,
        },
      })
    ).id;
  f.tLabour = await type("UPAH", f.labour);
  f.tPower = await type("LISTRIK", f.power);
  f.tOff = await type("MATI", f.power, false);

  const currency = (await prisma.refCurrency.findFirstOrThrow({ where: { currency_label: "IDR" } })).id;
  f.currency = currency;
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
  await prisma.accCostCenter.deleteMany({ where: { id: { in: centers } } });
  await prisma.mPartner.deleteMany({ where: { id: f.supplier } });
  await cleanupFiscalYear();
  await disconnect();
});

describe("a Tagihan Biaya is checked before it is saved (M83, P156)", () => {
  test("every bill names its Supplier", async () => {
    const r = await create(header({ partner_id: null }), [line(f.tLabour, 100_000)]);
    assert.ok(!r.ok && /Supplier/.test(r.errors.partner_id));
  });

  test("each line picks a Jenis Biaya and an active Cost Center — nothing is pre-filled", async () => {
    const r = await create(header(), [
      line(f.tLabour, 0),
      line(f.tOff, 100),
      line(f.tPower, 100, { cost_center_id: null }),
      line(f.tPower, 100, { cost_center_id: f.centerOff }),
    ]);
    assert.ok(!r.ok);
    if (!r.ok) {
      assert.match(r.errors["lines.0.amount"], /rupiah penuh/);
      assert.match(r.errors["lines.1.cost_type_id"], /nonaktif/);
      assert.match(r.errors["lines.2.cost_center_id"], /Cost Center/);
      assert.match(r.errors["lines.3.cost_center_id"], /nonaktif/);
    }
  });
});

describe("posting books the cost to the GL with its Cost Center (M73, P156)", () => {
  test("the preview is exactly the journal Posting writes, and writes nothing", async () => {
    const r = await create(header(), [line(f.tLabour, 600_000, { note: "Upah borongan" }), line(f.tPower, 400_000)]);
    assert.ok(r.ok, JSON.stringify(r));
    f.bill = r.id;
    const preview = await costBillPreview(r.id, actor);
    assert.ok(preview.ok);
    if (preview.ok) {
      assert.deepEqual(
        preview.lines.map((l) => [l.debit, l.credit]),
        [
          [600_000, 0],
          [400_000, 0],
          [0, 1_000_000],
        ]
      );
    }
    assert.equal((await getCostBill(r.id))!.status, "Draft", "a dry run leaves the bill a Draft");
  });

  test("Dr each expense account with its Cost Center / Cr Hutang Biaya Produksi for the total, copied to the bill", async () => {
    assert.ok((await transitionCostBill(f.bill, "post", actor)).ok);
    const bill = (await getCostBill(f.bill))!;
    assert.equal(bill.status, "Posted");
    assert.equal(bill.isPayable, true);
    const lines = await prisma.accJournalLine.findMany({ where: { journal_id: bill.journalId! }, orderBy: { sequence_no: "asc" } });
    assert.deepEqual(
      lines.map((l) => [l.account_id, l.cost_center_id, l.debit_amount.toNumber(), l.kredit_amount.toNumber()]),
      [
        [f.labour, f.center, 600_000, 0],
        [f.power, f.center, 400_000, 0],
        [f.payable, null, 0, 1_000_000],
      ]
    );
    assert.equal((await prisma.prdCostBill.findUniqueOrThrow({ where: { id: f.bill } })).payable_account_id, f.payable);
  });

  test("a posted bill is final", async () => {
    const r = await updateCostBill(f.bill, header(), [line(f.tLabour, 1)], actor);
    assert.ok(!r.ok && /Draft/.test(r.errors._form));
    assert.ok(!(await transitionCostBill(f.bill, "post", actor)).ok);
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

describe("the Cost Center rule holds for every journal (M88)", () => {
  const post = (lines: { accountId: number; costCenterId?: number | null; debit: number; credit: number }[]) =>
    prisma.$transaction((tx) =>
      postJournal(tx, {
        description: "uji cost center",
        actorId: actor,
        lines: lines.map((l) => ({ ...l, currencyId: f.currency, rate: 1, description: "uji" })),
      })
    );

  test("a line on a Require Cost Center account without one is refused", async () => {
    await assert.rejects(
      post([
        { accountId: f.power, debit: 1_000, credit: 0 },
        { accountId: f.payable, debit: 0, credit: 1_000 },
      ]),
      CostCenterRefusal
    );
  });

  test("a Cost Center on any other account is refused", async () => {
    await assert.rejects(
      post([
        { accountId: f.plain, costCenterId: f.center, debit: 1_000, credit: 0 },
        { accountId: f.payable, debit: 0, credit: 1_000 },
      ]),
      CostCenterRefusal
    );
  });

  test("an inactive Cost Center is refused", async () => {
    await assert.rejects(
      post([
        { accountId: f.power, costCenterId: f.centerOff, debit: 1_000, credit: 0 },
        { accountId: f.payable, debit: 0, credit: 1_000 },
      ]),
      CostCenterRefusal
    );
  });
});

describe("Laporan Cost Center reads journal lines per Cost Center and account (M90)", () => {
  test("the month's figures per account and their lines", async () => {
    const [block] = await costCenterReport({ yearStart, ...month, costCenterIds: [f.center] });
    const by = new Map(block.accounts.map((a) => [a.accountId, a]));
    assert.equal(by.get(f.labour)?.debit, 600_000);
    assert.equal(by.get(f.power)?.debit, 400_000);
    assert.equal(by.get(f.power)?.lines.length, 1);
    assert.equal(block.debit, 1_000_000);
    assert.equal(block.closing, block.opening + block.debit - block.credit);
    assert.ok(!by.has(f.payable), "the credit side carries no Cost Center");
  });
});

describe("Pembayaran Biaya Produksi pays a bill on the account it was credited to (P151, P156)", () => {
  test("the purpose offers the supplier's open bills", async () => {
    const o = await cashPaymentOptions();
    assert.ok(o.purposes.some((p) => p.key === "production_cost_payment"));
    const b = o.bills.find((x) => x.kind === "prd_cost_bill" && x.id === f.bill)!;
    assert.deepEqual([b.total, b.open, b.supplierId], [1_000_000, 1_000_000, f.supplier]);
  });

  test("a partial payment posts Dr the bill's credit account / Cr Kas & Bank and raises its paid amount", async () => {
    const r = await createCashPayment(payment(400_000), actor);
    assert.ok(r.ok, JSON.stringify(r));
    payments.push(r.id);
    assert.ok((await transitionCashPayment(r.id, "post", actor)).ok);
    const tx = await prisma.finCashBankTx.findUniqueOrThrow({ where: { id: r.id } });
    const lines = await prisma.accJournalLine.findMany({ where: { journal_id: tx.journal_id! }, orderBy: { sequence_no: "asc" } });
    assert.deepEqual(
      lines.map((l) => [l.account_id, l.debit_amount.toNumber(), l.kredit_amount.toNumber()]),
      [
        [f.payable, 400_000, 0],
        [f.bankAcc, 0, 400_000],
      ]
    );
    assert.equal((await getCostBill(f.bill))!.paid, 400_000);
  });

  test("more than the rest is refused; the rest clears it; the bill lists its payments", async () => {
    assert.ok(!(await createCashPayment(payment(600_001), actor)).ok);
    const r = await createCashPayment(payment(600_000), actor);
    assert.ok(r.ok, JSON.stringify(r));
    payments.push(r.id);
    assert.ok((await transitionCashPayment(r.id, "post", actor)).ok);
    assert.equal((await getCostBill(f.bill))!.paid, 1_000_000);
    assert.ok(!(await payableCostBills({ openOnly: true })).some((b) => b.id === f.bill), "a paid bill is no longer offered");
    assert.deepEqual((await costBillPayments(f.bill)).map((p) => p.settled), [400_000, 600_000]);
  });
});
