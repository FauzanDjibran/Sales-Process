import test, { after, before, describe } from "node:test";
import assert from "node:assert/strict";

import { createCashPayment, cashPaymentOptions, getCashPayment, previewCashPaymentPosting, transitionCashPayment, type CashPaymentInput } from "../src/lib/erp/cash-payment";
import { createPurchaseAdvance, transitionPurchaseAdvance } from "../src/lib/erp/ap-advance";
import { recordCashBankEntry } from "../src/lib/erp/cash-bank";
import { CASH_BANK_SUBCATEGORY } from "../src/lib/erp/records";
import { cleanupFiscalYear, cleanupFixtures, disconnect, makeAccount, openFiscalYear, prisma } from "./helpers";
import { purchasingWorld, type PurchasingWorld } from "./purchasing-helpers";

/**
 * Pengeluaran Kas & Bank — Pembayaran ke Supplier (P127, B24–B26): the receipt
 * mirrored. A line takes the cash paid; the PPh the company withholds explains
 * the gap; an advance-bill line posts Dr Uang Muka Pembelian · Dr PPN Masukan /
 * Cr Kas & Bank · Cr Hutang PPh and creates an AP item Uang Muka at its DPP;
 * an overdraw is refused.
 *
 * The bill: 30 % of a PO of 10 × 100.000 with PPh 23 2 % — DPP 300.000, PPN
 * 33.000, total 333.000, PPh 6.000, so paying 327.000 clears it.
 */

const today = new Date().toISOString().slice(0, 10);
let w: PurchasingWorld;
const f = {} as Record<string, number>;
const bills: number[] = [];
const payments: number[] = [];

const input = (over: Partial<CashPaymentInput> = {}): CashPaymentInput => ({
  purpose: "supplier_payment",
  tx_date: today,
  partner_id: w.f.supplier,
  cash_bank_id: f.bank,
  bank_ref: "TRF-OUT-1",
  note: "",
  bank_charge: 0,
  lines: [{ doc_type: "fin_ap_advance", doc_id: f.bill, cash: 327_000, withhold: true }],
  ...over,
});

async function create(i: CashPaymentInput) {
  const r = await createCashPayment(i, w.actor);
  if (r.ok) payments.push(r.id);
  return r;
}

async function fund(amount: number) {
  await prisma.$transaction((tx) => recordCashBankEntry(tx, { cashBankId: f.bank, date: today, type: "Adjustment", direction: "In", rate: 1, amount, actorId: w.actor }));
}

before(async () => {
  await openFiscalYear();
  w = await purchasingWorld("PAY");
  const currency = (await prisma.refCurrency.findFirstOrThrow({ where: { currency_label: "IDR" } })).id;
  f.bankAcc = await makeAccount({ subcategoryLabel: CASH_BANK_SUBCATEGORY });
  f.bank = (
    await prisma.mCashBank.create({
      data: { cash_bank_code: `test.${w.key("BANK")}`, cash_bank_label: w.key("BANK"), cash_bank_name: "Bank Uji", cash_bank_type: "Bank", currency_id: currency, account_id: f.bankAcc, created_by: w.actor },
    })
  ).id;
  const sub = async (label: string) => (await prisma.accAccountSubcategory.findFirstOrThrow({ where: { subcategory_label: { startsWith: label } }, orderBy: { id: "asc" } })).subcategory_label;
  f.advAcc = await makeAccount({ subcategoryLabel: await sub("1") });
  f.vatAcc = await makeAccount({ subcategoryLabel: await sub("1") });
  f.chargeAcc = await makeAccount({ subcategoryLabel: await sub("5") });
  f.pphAcc = await makeAccount({ subcategoryLabel: await sub("2") });
  await w.setMapping("purchase_advance_account", String(f.advAcc));
  await w.setMapping("input_vat_account", String(f.vatAcc));
  await w.setMapping("bank_charge_account", String(f.chargeAcc));
  await prisma.refWithholdingTax.update({ where: { id: w.f.wht }, data: { account_id: f.pphAcc } });

  const po = await w.openPO([{ item: w.f.stock, qty: 10, price: 100_000, wht: w.f.wht }]);
  const b = await createPurchaseAdvance(
    { order_id: po.id, advance_date: today, due_date: today, supplier_ref_no: "", description: "UM 30%", note: "", amount_type: "Percent", amount_value: 30 },
    w.actor
  );
  assert.ok(b.ok, JSON.stringify(b));
  bills.push(b.id);
  f.bill = b.id;
  f.po = po.id;
  await transitionPurchaseAdvance(b.id, "issue", w.actor);
});

after(async () => {
  const items = await prisma.finApItem.findMany({ where: { partner_id: w.f.supplier }, select: { id: true } });
  await prisma.finApLedger.deleteMany({ where: { item_id: { in: items.map((i) => i.id) } } });
  await prisma.finApItem.deleteMany({ where: { id: { in: items.map((i) => i.id) } } });
  await prisma.finCashBankTx.deleteMany({ where: { id: { in: payments } } });
  await prisma.auditLog.deleteMany({ where: { entity_key: "fin_cash_bank_tx", row_id: { in: payments } } });
  await prisma.finApAdvance.deleteMany({ where: { id: { in: bills } } });
  await prisma.auditLog.deleteMany({ where: { entity_key: "fin_ap_advance", row_id: { in: bills } } });
  await prisma.refWithholdingTax.update({ where: { id: w.f.wht }, data: { account_id: null } });
  await w.teardown();
  await cleanupFixtures();
  await cleanupFiscalYear();
  await disconnect();
});

describe("Pembayaran ke Supplier", () => {
  test("the form offers the supplier's recorded, unpaid advance bills", async () => {
    const o = await cashPaymentOptions();
    assert.ok(o.purposes.some((p) => p.key === "supplier_payment"));
    const bill = o.bills.find((b) => b.id === f.bill)!;
    assert.deepEqual([bill.total, bill.open, bill.supplierId], [333_000, 333_000, w.f.supplier]);
  });

  test("paying more than clears the bill is refused; the PPh explains the gap", async () => {
    const over = await create(input({ lines: [{ doc_type: "fin_ap_advance", doc_id: f.bill, cash: 330_000, withhold: true }] }));
    assert.ok(!over.ok && /Melebihi/.test(over.errors["lines.0.cash"]));
  });

  test("an overdraw is refused; with the money there it posts the journal and the AP item", async () => {
    const r = await create(input({ bank_charge: 6_500 }));
    assert.ok(r.ok, JSON.stringify(r));
    assert.match(r.txNo, /^BKK\//);
    const short = await transitionCashPayment(r.id, "post", w.actor);
    assert.ok(!short.ok && /Saldo Cash & Bank tidak mencukupi/.test(short.errors._form));

    await fund(1_000_000);
    const preview = await previewCashPaymentPosting(r.id, w.actor);
    assert.ok(preview.ok);
    assert.deepEqual(await transitionCashPayment(r.id, "post", w.actor), { ok: true });
    const p = (await getCashPayment(r.id))!;
    assert.equal(p.status, "Posted");
    assert.deepEqual([p.lines[0].settled, p.lines[0].dppPart, p.lines[0].ppnPart, p.lines[0].pph], [333_000, 300_000, 33_000, 6_000]);

    const tx = await prisma.finCashBankTx.findUniqueOrThrow({ where: { id: r.id } });
    const lines = await prisma.accJournalLine.findMany({ where: { journal_id: tx.journal_id! }, orderBy: { id: "asc" } });
    assert.deepEqual(
      lines.map((l) => [l.account_id, l.debit_amount.toNumber(), l.kredit_amount.toNumber()]),
      [
        [f.advAcc, 300_000, 0],
        [f.vatAcc, 33_000, 0],
        [f.chargeAcc, 6_500, 0],
        [f.bankAcc, 0, 333_500],
        [f.pphAcc, 0, 6_000],
      ],
      "Dr Uang Muka · PPN Masukan · Beban Bank / Cr Kas (paid + charge) · Hutang PPh"
    );
    const bal = await prisma.cashBankBalance.findUniqueOrThrow({ where: { cash_bank_id: f.bank } });
    assert.equal(bal.balance.toNumber(), 1_000_000 - 333_500);

    const item = await prisma.finApItem.findFirstOrThrow({ where: { partner_id: w.f.supplier, item_type: "Advance" } });
    assert.deepEqual([item.current_balance.toNumber(), item.purchase_order_id, item.source_doc_id], [300_000, f.po, f.bill]);
    assert.match(item.ap_item_no, /^API\//);
    // The bill records what the payment settled (P132), and refuses Batalkan by it.
    assert.equal((await prisma.finApAdvance.findUniqueOrThrow({ where: { id: f.bill } })).paid_amount.toNumber(), 333_000);
    const cancel = await transitionPurchaseAdvance(f.bill, "cancel", w.actor, "batal");
    assert.ok(!cancel.ok && /sudah dibayar/.test(cancel.errors._form), "a paid bill refuses Batalkan");
    assert.ok(!(await cashPaymentOptions()).bills.some((b) => b.id === f.bill), "a paid bill is no longer offered");
  });
});
