import test, { after, before, describe } from "node:test";
import assert from "node:assert/strict";

import { recordCashBankEntry } from "../src/lib/erp/cash-bank";
import { cashPaymentOptions, costBillPayments, createCashPayment, transitionCashPayment, type CashPaymentInput } from "../src/lib/erp/cash-payment";
import { costBalances, costLedgerRows } from "../src/lib/erp/production-cost";
import {
  costBillPreview,
  createCostBill,
  getCostBill,
  payableCostBills,
  transitionCostBill,
  updateCostBill,
  type CostBillInput,
} from "../src/lib/erp/production-cost-bill";
import { CASH_BANK_SUBCATEGORY } from "../src/lib/erp/records";
import { cleanupFiscalYear, cleanupFixtures, disconnect, makeAccount, makePartner, openFiscalYear, prisma, systemUserId } from "./helpers";

/**
 * Production cost, Phase 2 (P150 M68, production_project.md §21d): the
 * Tagihan Biaya Produksi books cost into the cost ledger and the journal in
 * the month it belongs to; a bill on Hutang Biaya Produksi is paid by the
 * Pengeluaran purpose Pembayaran Biaya Produksi, which writes no cost row.
 */

const today = new Date().toISOString().slice(0, 10);
const month = { from: `${today.slice(0, 8)}01`, to: today };
let actor = 0;
const f = {} as Record<string, number>;
const bills: number[] = [];
const payments: number[] = [];
let savedMapping: string | null = null;

const header = (over: Partial<CostBillInput> = {}): CostBillInput => ({
  bill_date: today,
  partner_id: f.supplier,
  supplier_ref: "PLN-10",
  due_date: today,
  description: "Listrik pabrik",
  note: "",
  ...over,
});

async function create(h: CostBillInput, lines: { element_id: number; amount: number; note?: string }[]) {
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
  f.labour = await makeAccount({ subcategoryLabel: "5.1.1" });
  f.power = await makeAccount({ subcategoryLabel: "5.1.1" });
  f.payable = await makeAccount({ subcategoryLabel: "2.1.3", normalBalance: "Kredit" });
  f.payable2 = await makeAccount({ subcategoryLabel: "2.1.3", normalBalance: "Kredit" });
  f.bankAcc = await makeAccount({ subcategoryLabel: CASH_BANK_SUBCATEGORY });
  const stamp = String(Date.now() % 100000);
  const element = async (label: string, accountId: number) =>
    (await prisma.accProductionCostElement.create({ data: { element_code: `test.${label}${stamp}`, element_label: `T-${label}-${stamp}`, element_name: label, account_id: accountId, created_by: actor } })).id;
  f.eLabour = await element("UPAH", f.labour);
  f.ePower = await element("LISTRIK", f.power);
  f.eInactive = await element("MATI", f.power);
  await prisma.accProductionCostElement.update({ where: { id: f.eInactive }, data: { status: "Inactive" } });

  savedMapping = (await prisma.sysSetting.findUnique({ where: { setting_key: "production_cost_payable_account" } }))?.setting_value ?? null;
  await prisma.sysSetting.upsert({
    where: { setting_key: "production_cost_payable_account" },
    update: { setting_value: String(f.payable) },
    create: { setting_key: "production_cost_payable_account", setting_value: String(f.payable), updated_by: actor },
  });

  const currency = (await prisma.refCurrency.findFirstOrThrow({ where: { currency_label: "IDR" } })).id;
  f.bank = (
    await prisma.mCashBank.create({
      data: { cash_bank_code: `test.PRDBANK${stamp}`, cash_bank_label: `PRDBANK${stamp}`, cash_bank_name: "Bank Uji Produksi", cash_bank_type: "Bank", currency_id: currency, account_id: f.bankAcc, created_by: actor },
    })
  ).id;
  await prisma.$transaction((tx) => recordCashBankEntry(tx, { cashBankId: f.bank, date: today, type: "Adjustment", direction: "In", rate: 1, amount: 10_000_000, actorId: actor }));
});

after(async () => {
  const typeId = (await prisma.sysDocType.findFirstOrThrow({ where: { doc_table: "prd_cost_bill" } })).id;
  await prisma.prdCostLedger.deleteMany({ where: { source_doc_type_id: typeId, source_doc_id: { in: bills } } });
  await prisma.finCashBankTx.deleteMany({ where: { id: { in: payments } } });
  await prisma.auditLog.deleteMany({ where: { entity_key: "fin_cash_bank_tx", row_id: { in: payments } } });
  await prisma.prdCostBill.deleteMany({ where: { id: { in: bills } } });
  await prisma.auditLog.deleteMany({ where: { entity_key: "prd_cost_bill", row_id: { in: bills } } });
  await prisma.sysSetting.update({ where: { setting_key: "production_cost_payable_account" }, data: { setting_value: savedMapping } });
  await cleanupFixtures();
  await prisma.mPartner.deleteMany({ where: { id: f.supplier } });
  await cleanupFiscalYear();
  await disconnect();
});

describe("a Tagihan Biaya Produksi is checked before it is saved", () => {
  test("every bill names the Supplier it is owed to", async () => {
    const r = await create(header({ partner_id: null }), [{ element_id: f.eLabour, amount: 100_000 }]);
    assert.ok(!r.ok && /Supplier/.test(r.errors.partner_id));
  });

  test("an amount is whole rupiah above 0, and an inactive element is refused", async () => {
    const r = await create(header(), [
      { element_id: f.eLabour, amount: 0 },
      { element_id: f.eInactive, amount: 100 },
    ]);
    assert.ok(!r.ok);
    if (!r.ok) {
      assert.match(r.errors["lines.0.amount"], /rupiah penuh/);
      assert.match(r.errors["lines.1.element_id"], /nonaktif/);
    }
  });
});

describe("posting books the cost in its month: journal and cost ledger together (M68)", () => {
  test("the preview is exactly the journal Posting writes, and writes nothing", async () => {
    const r = await create(header(), [
      { element_id: f.eLabour, amount: 600_000, note: "Upah borongan" },
      { element_id: f.ePower, amount: 400_000 },
    ]);
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
    assert.equal((await costLedgerRows(month, [f.eLabour])).length, 0, "and writes no cost row");
  });

  test("posting writes Dr each element account / Cr Account Mapping's Hutang Biaya Produksi and one cost row per line, under one BBP number", async () => {
    const r = await transitionCostBill(f.bill, "post", actor);
    assert.ok(r.ok, JSON.stringify(r));
  });

  test("the posted bill, its journal and its cost rows agree", async () => {
    const bill = (await getCostBill(f.bill))!;
    assert.equal(bill.status, "Posted");
    assert.equal(bill.isPayable, true);
    assert.equal(bill.total, 1_000_000);
    const lines = await prisma.accJournalLine.findMany({ where: { journal_id: bill.journalId! }, orderBy: { sequence_no: "asc" } });
    assert.deepEqual(
      lines.map((l) => [l.account_id, l.debit_amount.toNumber(), l.kredit_amount.toNumber()]),
      [
        [f.labour, 600_000, 0],
        [f.power, 400_000, 0],
        [f.payable, 0, 1_000_000],
      ]
    );
    const rows = (await costLedgerRows(month)).filter((r) => r.source.docId === f.bill);
    assert.deepEqual(
      rows.map((r) => [r.elementId, r.amount, r.kind, r.lineNo]),
      [
        [f.eLabour, 600_000, "In", 1],
        [f.ePower, 400_000, "In", 2],
      ]
    );
    assert.ok(/^BBP\/\d{4}\/\d{2}\/\d{4}$/.test(rows[0].ledgerNo) && rows[0].ledgerNo === rows[1].ledgerNo, "one ledger number per posting");
  });

  test("a posted bill is final", async () => {
    const r = await updateCostBill(f.bill, header(), [{ element_id: f.eLabour, amount: 1 }], actor);
    assert.ok(!r.ok && /Draft/.test(r.errors._form));
    const again = await transitionCostBill(f.bill, "post", actor);
    assert.ok(!again.ok);
  });

  test("without Hutang Biaya Produksi in Account Mapping a bill saves but does not post (P151)", async () => {
    const r = await create(header({ description: "Jasa servis mesin" }), [{ element_id: f.ePower, amount: 250_000 }]);
    assert.ok(r.ok, JSON.stringify(r));
    f.bill2 = r.id;
    await prisma.sysSetting.update({ where: { setting_key: "production_cost_payable_account" }, data: { setting_value: null } });
    const refused = await transitionCostBill(r.id, "post", actor);
    assert.ok(!refused.ok && /Account Mapping/.test(refused.errors._form));
    assert.equal((await getCostBill(r.id))!.status, "Draft");
  });

  test("the bill keeps the payable it was posted on, whatever the mapping says later (P151)", async () => {
    await prisma.sysSetting.update({ where: { setting_key: "production_cost_payable_account" }, data: { setting_value: String(f.payable2) } });
    assert.ok((await transitionCostBill(f.bill2, "post", actor)).ok);
    await prisma.sysSetting.update({ where: { setting_key: "production_cost_payable_account" }, data: { setting_value: String(f.payable) } });
    const bill = (await getCostBill(f.bill2))!;
    assert.equal(bill.isPayable, true);
    const credit = await prisma.accJournalLine.findFirstOrThrow({ where: { journal_id: bill.journalId!, kredit_amount: { gt: 0 } } });
    assert.equal(credit.account_id, f.payable2);
    assert.equal((await payableCostBills({ ids: [f.bill2] }))[0].payableAccountId, f.payable2);
  });

  test("Batalkan a Draft asks for a reason", async () => {
    const r = await create(header(), [{ element_id: f.eLabour, amount: 5_000 }]);
    assert.ok(r.ok);
    const bare = await transitionCostBill(r.id, "cancel", actor);
    assert.ok(!bare.ok && bare.errors.reason);
    assert.ok((await transitionCostBill(r.id, "cancel", actor, "salah input")).ok);
    assert.equal((await getCostBill(r.id))!.status, "Cancelled");
  });
});

describe("Saldo Biaya Produksi reads the cost ledger alone for the month (M66, P152)", () => {
  test("the month's balance per element sums its rows", async () => {
    const balances = await costBalances(month, [f.eLabour, f.ePower]);
    const by = new Map(balances.map((b) => [b.elementId, b.total]));
    assert.equal(by.get(f.eLabour), 600_000);
    assert.equal(by.get(f.ePower), 650_000);
    const rows = await costLedgerRows(month, [f.eLabour, f.ePower]);
    for (const id of [f.eLabour, f.ePower]) {
      assert.equal(rows.filter((r) => r.elementId === id).reduce((a, r) => a + r.amount, 0), by.get(id), `element ${id}: balance = its rows`);
    }
  });
});

describe("Pembayaran Biaya Produksi pays the bill and writes no cost row (M68)", () => {
  test("the purpose offers the supplier's open payable bills", async () => {
    const o = await cashPaymentOptions();
    assert.ok(o.purposes.some((p) => p.key === "production_cost_payment"));
    const b = o.bills.find((x) => x.kind === "prd_cost_bill" && x.id === f.bill)!;
    assert.deepEqual([b.total, b.open, b.supplierId], [1_000_000, 1_000_000, f.supplier]);
  });

  test("a partial payment posts Dr Hutang Biaya Produksi / Cr Kas & Bank and raises the bill's paid amount", async () => {
    const rowsBefore = (await costLedgerRows(month)).length;
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
    assert.equal((await costLedgerRows(month)).length, rowsBefore, "paying writes no cost row");
  });

  test("more than the rest is refused; the rest clears it", async () => {
    const over = await createCashPayment(payment(600_001), actor);
    assert.ok(!over.ok);
    const r = await createCashPayment(payment(600_000), actor);
    assert.ok(r.ok, JSON.stringify(r));
    payments.push(r.id);
    assert.ok((await transitionCashPayment(r.id, "post", actor)).ok);
    assert.equal((await getCostBill(f.bill))!.paid, 1_000_000);
    assert.ok(!(await payableCostBills({ openOnly: true })).some((b) => b.id === f.bill), "a paid bill is no longer offered");
  });

  test("a bill is paid on the payable it was posted on, not today's mapping (P151)", async () => {
    const r = await createCashPayment(payment(250_000, { lines: [{ doc_type: "prd_cost_bill", doc_id: f.bill2, cash: 250_000, withhold: false }] }), actor);
    assert.ok(r.ok, JSON.stringify(r));
    payments.push(r.id);
    assert.ok((await transitionCashPayment(r.id, "post", actor)).ok);
    const tx = await prisma.finCashBankTx.findUniqueOrThrow({ where: { id: r.id } });
    const debit = await prisma.accJournalLine.findFirstOrThrow({ where: { journal_id: tx.journal_id!, debit_amount: { gt: 0 } } });
    assert.equal(debit.account_id, f.payable2);
    const paid = await costBillPayments(f.bill2);
    assert.deepEqual(paid.map((p) => [p.id, p.settled]), [[r.id, 250_000]]);
  });
});
