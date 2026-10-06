import test, { after, before, describe } from "node:test";
import assert from "node:assert/strict";

import { createReceiptNote, transitionReceiptNote } from "../src/lib/erp/receipt-note";
import { createPurchaseAdvance, transitionPurchaseAdvance } from "../src/lib/erp/ap-advance";
import { createCashPayment, transitionCashPayment } from "../src/lib/erp/cash-payment";
import {
  createPurchaseInvoice,
  getPurchaseInvoice,
  purchaseInvoiceOptions,
  purchaseInvoicePayStates,
  purchaseInvoicePreview,
  transitionPurchaseInvoice,
  updatePurchaseInvoice,
  type PurchaseInvoiceHeaderInput,
} from "../src/lib/erp/ap-invoice";
import { computePurchaseInvoice } from "../src/lib/erp/ap-invoice-workflow";
import { recordCashBankEntry } from "../src/lib/erp/cash-bank";
import { CASH_BANK_SUBCATEGORY } from "../src/lib/erp/records";
import { cleanupFiscalYear, cleanupFixtures, disconnect, makeAccount, openFiscalYear, prisma } from "./helpers";
import { purchasingWorld, type PurchasingWorld } from "./purchasing-helpers";

/**
 * Invoice Pembelian (P128, B28–B31): whole posted receipt lines at the PO
 * price, the supplier's number guarded, the supplier's total compared within
 * the tolerance, the PO's Uang Muka deducted (P113, P117, P118), the
 * company's PPh booked here; then paid by the Pengeluaran (B27).
 *
 * PO 10 × 100.000 with PPh 23 2 %, PPN by the chain. An advance of 30 %
 * (DPP 300.000) is paid. The invoice: DPP 1.000.000, full PPN 110.000, the
 * advance's PPN 33.000 → PPN 77.000, net DPP 700.000, total 777.000, PPh on
 * 700.000 = 14.000, Hutang born at 1.096.000 and left at 763.000.
 */

const today = new Date().toISOString().slice(0, 10);
let w: PurchasingWorld;
const f = {} as Record<string, number>;
const ids = { rn: [] as number[], bill: [] as number[], pay: [] as number[], inv: [] as number[] };

const header = (over: Partial<PurchaseInvoiceHeaderInput> = {}): PurchaseInvoiceHeaderInput => ({
  purchase_order_id: f.po,
  invoice_date: today,
  supplier_invoice_no: `INV-SUP-${w.key("1")}`,
  supplier_invoice_date: today,
  supplier_tax_invoice_no: "010.000-26.00000001",
  supplier_total: null,
  note: "",
  ...over,
});

async function journalOf(table: "finApInvoice" | "finCashBankTx", id: number) {
  const row = table === "finApInvoice" ? await prisma.finApInvoice.findUniqueOrThrow({ where: { id } }) : await prisma.finCashBankTx.findUniqueOrThrow({ where: { id } });
  return (await prisma.accJournalLine.findMany({ where: { journal_id: row.journal_id! }, orderBy: { id: "asc" } })).map((l) => [l.account_id, l.debit_amount.toNumber(), l.kredit_amount.toNumber()]);
}

before(async () => {
  await openFiscalYear();
  w = await purchasingWorld("PI");
  const sub = async (label: string) => (await prisma.accAccountSubcategory.findFirstOrThrow({ where: { subcategory_label: { startsWith: label } }, orderBy: { id: "asc" } })).subcategory_label;
  f.advAcc = await makeAccount({ subcategoryLabel: await sub("1") });
  f.vatAcc = await makeAccount({ subcategoryLabel: await sub("1") });
  f.payAcc = await makeAccount({ subcategoryLabel: await sub("2") });
  f.pphAcc = await makeAccount({ subcategoryLabel: await sub("2") });
  f.diffAcc = await makeAccount({ subcategoryLabel: await sub("5") });
  f.bankAcc = await makeAccount({ subcategoryLabel: CASH_BANK_SUBCATEGORY });
  await w.setMapping("purchase_advance_account", String(f.advAcc));
  await w.setMapping("input_vat_account", String(f.vatAcc));
  await w.setMapping("payable_account", String(f.payAcc));
  await w.setMapping("supplier_invoice_diff_account", String(f.diffAcc));
  await w.setMapping("supplier_invoice_tolerance", "100");
  await prisma.refWithholdingTax.update({ where: { id: w.f.wht }, data: { account_id: f.pphAcc } });
  const currency = (await prisma.refCurrency.findFirstOrThrow({ where: { currency_label: "IDR" } })).id;
  f.bank = (
    await prisma.mCashBank.create({
      data: { cash_bank_code: `test.${w.key("BANK")}`, cash_bank_label: w.key("BANK"), cash_bank_name: "Bank Uji", cash_bank_type: "Bank", currency_id: currency, account_id: f.bankAcc, created_by: w.actor },
    })
  ).id;
  await prisma.$transaction((tx) => recordCashBankEntry(tx, { cashBankId: f.bank, date: today, type: "Adjustment", direction: "In", rate: 1, amount: 5_000_000, actorId: w.actor }));

  const po = await w.openPO([{ item: w.f.stock, qty: 10, price: 100_000, wht: w.f.wht }]);
  f.po = po.id;
  // A 30 % advance, paid: DPP 300.000 + PPN 33.000, PPh 6.000 withheld.
  const bill = await createPurchaseAdvance(
    { order_id: po.id, advance_date: today, due_date: today, supplier_ref_no: "", description: "UM", note: "", amount_type: "Percent", amount_value: 30 },
    w.actor
  );
  assert.ok(bill.ok);
  ids.bill.push(bill.id);
  await transitionPurchaseAdvance(bill.id, "issue", w.actor);
  const pay = await createCashPayment(
    { purpose: "supplier_payment", tx_date: today, partner_id: w.f.supplier, cash_bank_id: f.bank, bank_ref: "", note: "", bank_charge: 0, lines: [{ doc_type: "fin_ap_advance", doc_id: bill.id, cash: 327_000, withhold: true }] },
    w.actor
  );
  assert.ok(pay.ok, JSON.stringify(pay));
  ids.pay.push(pay.id);
  assert.deepEqual(await transitionCashPayment(pay.id, "post", w.actor), { ok: true });
  f.advItem = (await prisma.finApItem.findFirstOrThrow({ where: { partner_id: w.f.supplier, item_type: "Advance" } })).id;
  // Received in full.
  const rn = await createReceiptNote(
    { source_doc_id: po.id, rn_date: today, warehouse_id: w.f.warehouse, supplier_dn_no: "", note: "" },
    [{ source_doc_line_id: po.lineIds[0], qty: 10, note: "", lots: [{ lot_no: w.key("L"), expiry_date: "", qty: 10 }] }],
    w.actor
  );
  assert.ok(rn.ok, JSON.stringify(rn));
  ids.rn.push(rn.id);
  const posted = await transitionReceiptNote(rn.id, "post", w.actor);
  assert.ok(posted.ok, JSON.stringify(posted));
  f.rnLine = (await prisma.logReceiptNoteLine.findFirstOrThrow({ where: { receipt_note_id: rn.id } })).id;
});

after(async () => {
  const items = await prisma.finApItem.findMany({ where: { partner_id: w.f.supplier }, select: { id: true } });
  await prisma.finApLedger.deleteMany({ where: { item_id: { in: items.map((i) => i.id) } } });
  await prisma.finApItem.deleteMany({ where: { id: { in: items.map((i) => i.id) } } });
  await prisma.finApInvoice.deleteMany({ where: { id: { in: ids.inv } } });
  await prisma.finCashBankTx.deleteMany({ where: { id: { in: ids.pay } } });
  await prisma.finApAdvance.deleteMany({ where: { id: { in: ids.bill } } });
  await prisma.logReceiptNoteLot.deleteMany({ where: { line: { receipt_note_id: { in: ids.rn } } } });
  await prisma.logReceiptNoteLine.deleteMany({ where: { receipt_note_id: { in: ids.rn } } });
  await prisma.logReceiptNote.deleteMany({ where: { id: { in: ids.rn } } });
  for (const [k, list] of Object.entries({ fin_ap_invoice: ids.inv, fin_cash_bank_tx: ids.pay, fin_ap_advance: ids.bill, log_receipt_note: ids.rn })) {
    await prisma.auditLog.deleteMany({ where: { entity_key: k, row_id: { in: list } } });
  }
  await prisma.refWithholdingTax.update({ where: { id: w.f.wht }, data: { account_id: null } });
  await w.teardown();
  await cleanupFixtures();
  await cleanupFiscalYear();
  await disconnect();
});

describe("the arithmetic (B29b–B31)", () => {
  test("PPN on the full DPP less the advance's; PPh on the net DPP; the supplier's total within the tolerance", () => {
    const rates = { rate: 12, otherNum: 11, otherDen: 12 };
    const base = { lines: [{ dpp: 1_000_000, withholdingRate: 2, withholdingKey: "1" }], taxable: true, rates, advanceUsed: 300_000, advancePpn: 33_000, tolerance: 100 };
    const same = computePurchaseInvoice({ ...base, supplierTotal: null });
    assert.deepEqual([same.dpp, same.fullPpn, same.ppn, same.netDpp, same.total, same.pph, same.payable], [1_000_000, 110_000, 77_000, 700_000, 777_000, 14_000, 1_096_000]);
    const near = computePurchaseInvoice({ ...base, supplierTotal: 777_050 });
    assert.deepEqual([near.difference, near.withinTolerance, near.payable], [50, true, 1_096_050]);
    assert.equal(computePurchaseInvoice({ ...base, supplierTotal: 778_000 }).withinTolerance, false);
  });
});

describe("the Invoice Pembelian", () => {
  test("offers the PO's posted receipt lines and its paid Uang Muka", async () => {
    const o = (await purchaseInvoiceOptions()).orders.find((x) => x.id === f.po)!;
    assert.deepEqual(o.receiptLines.map((l) => [l.id, l.value]), [[f.rnLine, 1_000_000]]);
    assert.deepEqual(o.advances.map((a) => [a.id, a.balance]), [[f.advItem, 300_000]]);
  });

  test("beyond the tolerance it saves but refuses to post; within it, it posts the journal and the AP item", async () => {
    const r = await createPurchaseInvoice(header({ supplier_total: 778_000 }), [{ receipt_note_line_id: f.rnLine }], [{ ap_item_id: f.advItem, dpp_used: 300_000 }], w.actor);
    assert.ok(r.ok, JSON.stringify(r));
    ids.inv.push(r.id);
    assert.match(r.invoiceNo, /^PI\//);
    const dup = await createPurchaseInvoice(header(), [{ receipt_note_line_id: f.rnLine }], [], w.actor);
    assert.ok(!dup.ok && (dup.errors.supplier_invoice_no || dup.errors["lines.0.receipt_note_line_id"]), "the number and the line are taken");
    const refused = await transitionPurchaseInvoice(r.id, "post", w.actor);
    assert.ok(!refused.ok && /melebihi toleransi/.test(refused.errors._form));

    assert.ok((await updatePurchaseInvoice(r.id, header({ supplier_total: 777_050 }), [{ receipt_note_line_id: f.rnLine }], [{ ap_item_id: f.advItem, dpp_used: 300_000 }], w.actor)).ok);
    assert.ok((await purchaseInvoicePreview(r.id, w.actor)).ok);
    assert.deepEqual(await transitionPurchaseInvoice(r.id, "post", w.actor), { ok: true });
    const v = (await getPurchaseInvoice(r.id))!;
    assert.deepEqual([v.stored.total, v.stored.pph, v.stored.difference, v.stored.payable], [777_000, 14_000, 50, 1_096_050]);
    assert.deepEqual(await journalOf("finApInvoice", r.id), [
      [w.f.grirAcc, 1_000_000, 0],
      [f.vatAcc, 110_000, 0],
      [f.diffAcc, 50, 0],
      [f.payAcc, 0, 1_096_050],
      [f.pphAcc, 0, 14_000],
      [f.payAcc, 333_000, 0],
      [f.advAcc, 0, 300_000],
      [f.vatAcc, 0, 33_000],
    ]);
    const item = await prisma.finApItem.findUniqueOrThrow({ where: { id: v.apItemId! } });
    assert.deepEqual([item.original_amount.toNumber(), item.current_balance.toNumber()], [1_096_050, 763_050]);
    assert.equal((await prisma.finApItem.findUniqueOrThrow({ where: { id: f.advItem } })).current_balance.toNumber(), 0);
    // GR/IR clears exactly: what the receipt credited, the invoice debited.
    const grir = await prisma.accJournalLine.aggregate({ where: { account_id: w.f.grirAcc }, _sum: { debit_amount: true, kredit_amount: true } });
    assert.equal(grir._sum.debit_amount!.toNumber(), grir._sum.kredit_amount!.toNumber());
    f.inv = r.id;
  });

  test("the Pengeluaran pays it by its AP item's balance, with no PPh", async () => {
    const pay = await createCashPayment(
      { purpose: "supplier_payment", tx_date: today, partner_id: w.f.supplier, cash_bank_id: f.bank, bank_ref: "", note: "", bank_charge: 0, lines: [{ doc_type: "fin_ap_invoice", doc_id: f.inv, cash: 763_050, withhold: true }] },
      w.actor
    );
    assert.ok(pay.ok, JSON.stringify(pay));
    ids.pay.push(pay.id);
    assert.deepEqual(await transitionCashPayment(pay.id, "post", w.actor), { ok: true });
    assert.deepEqual(await journalOf("finCashBankTx", pay.id), [
      [f.payAcc, 763_050, 0],
      [f.bankAcc, 0, 763_050],
    ]);
    assert.equal((await purchaseInvoicePayStates([f.inv]))[f.inv].state, "Paid");
  });
});
