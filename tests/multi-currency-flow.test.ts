import test, { after, before, describe } from "node:test";
import assert from "node:assert/strict";

import { createCustomerOrder, transitionCustomerOrder } from "../src/lib/erp/customer-order";
import { createSalesOrder, transitionSalesOrder } from "../src/lib/erp/sales-order";
import { createDeliveryOrder, transitionDeliveryOrder } from "../src/lib/erp/delivery-order";
import { createDeliveryNote, transitionDeliveryNote } from "../src/lib/erp/delivery-note";
import { createSalesAdvance, transitionSalesAdvance } from "../src/lib/erp/ar-advance";
import { createCashReceipt, transitionCashReceipt } from "../src/lib/erp/cash-bank-tx";
import { createInvoice, transitionInvoice } from "../src/lib/erp/ar-invoice";
import { createPurchaseAdvance, transitionPurchaseAdvance } from "../src/lib/erp/ap-advance";
import { createReceiptNote, transitionReceiptNote } from "../src/lib/erp/receipt-note";
import { createPurchaseInvoice, transitionPurchaseInvoice } from "../src/lib/erp/ap-invoice";
import { createCashPayment, transitionCashPayment } from "../src/lib/erp/cash-payment";
import { openCashBankBook } from "../src/lib/erp/cash-bank";
import { computeSalesTotals, settleBillFromCash } from "../src/lib/erp/sales-tax";
import { CASH_BANK_SUBCATEGORY } from "../src/lib/erp/records";
import {
  FIXTURE_PREFIX,
  cleanupFiscalYear,
  cleanupFixtures,
  cleanupStock,
  disconnect,
  makeAccount,
  makePartner,
  openFiscalYear,
  prisma,
  stockIn,
  systemUserId,
} from "./helpers";
import { purchasingWorld, type PurchasingWorld } from "./purchasing-helpers";

/**
 * Multi-Currency-Plan stages 3–6 (§6.1), one USD flow each way.
 *
 * **Sales**, order at 16.000: 10 × USD 100, Exclude, PPN 12 % × 11/12 and
 * PPh 1,5 % on the line. An advance of DPP USD 300 (PPN 33) is received at
 * 15.500, so its Uang Muka item carries 4.650.000. The Invoice bills the 10
 * and uses the 300: Piutang born at USD 1.110 = 17.760.000; the advance and
 * its PPN applied relieve the Invoice at 16.000 (5.328.000) against the
 * advance at 15.500 (4.650.000 + PPN 511.500) — a selisih kurs loss of
 * 166.500. The rest, USD 777, is received at 16.200 less PPh 10,50: the
 * money and the PPh bring 12.587.400 against 12.432.000 carried — a gain of
 * 155.400 — and Piutang ends at nothing in both measures.
 *
 * **Purchasing**, order at 15.000: 10 × USD 50, PPh 23 2 %. The USD bank
 * holds 2.000 at 15.800. A 30 % advance (DPP 150, PPN 16,50, PPh 3) is paid
 * from it at 15.800: Uang Muka 2.370.000. The receipt brings the stock in at
 * the PO's base, 7.500.000. The Invoice: Hutang USD 548 = 8.220.000, the
 * advance applied relieves Hutang 2.497.500 against 2.370.000 + PPN 260.700
 * — a loss of 133.200. The rest, USD 381,50, is paid at the bank's 15.800,
 * 6.027.700, against 5.722.500 carried — a loss of 305.200.
 */

const today = new Date().toISOString().slice(0, 10);
const stamp = String(Date.now() % 100000);
const key = (s: string) => `${FIXTURE_PREFIX}MC${s}${stamp}`;
let actor = 0;
let w: PurchasingWorld;
const f = {} as Record<string, number>;
const ids = { co: [] as number[], so: [] as number[], do: [] as number[], dn: [] as number[], adv: [] as number[], tx: [] as number[], inv: [] as number[] };
const pids = { bill: [] as number[], rn: [] as number[], inv: [] as number[] };
const banks: number[] = [];
const saved = new Map<string, string | null>();

async function setMapping(k: string, v: string | null) {
  if (!saved.has(k)) saved.set(k, (await prisma.sysSetting.findUnique({ where: { setting_key: k } }))?.setting_value ?? null);
  await prisma.sysSetting.upsert({ where: { setting_key: k }, update: { setting_value: v }, create: { setting_key: k, setting_value: v, updated_by: actor } });
}

async function usdBank(label: string, opening: number, rate: number) {
  const row = await prisma.mCashBank.create({
    data: {
      cash_bank_code: `test.${key(label)}`,
      cash_bank_label: key(label),
      cash_bank_name: `Bank USD ${label}`,
      cash_bank_type: "Bank",
      currency_id: f.usd,
      account_id: await makeAccount({ subcategoryLabel: CASH_BANK_SUBCATEGORY }),
      created_by: actor,
    },
  });
  await openCashBankBook(prisma, { cashBankId: row.id, openingBalance: opening, rate, date: today, actorId: actor });
  banks.push(row.id);
  return row.id;
}

async function journalLines(journalId: number | null) {
  return prisma.accJournalLine.findMany({ where: { journal_id: journalId! }, orderBy: { id: "asc" } });
}
const fxOf = async (journalId: number | null) =>
  (await journalLines(journalId)).filter((l) => l.account_id === f.fx).reduce((a, l) => a + l.debit_amount.toNumber() - l.kredit_amount.toNumber(), 0);
const balanced = async (journalId: number | null) => {
  const ls = await journalLines(journalId);
  return Math.round(ls.reduce((a, l) => a + l.debit_amount.toNumber() * 100 - l.kredit_amount.toNumber() * 100, 0));
};
const arItem = async (sourceTable: string, sourceId: number) => {
  const i = await prisma.finArItem.findFirstOrThrow({ where: { source_doc_id: sourceId, source_doc_type: { doc_table: sourceTable } } });
  return [i.current_balance.toNumber(), i.base_current_balance.toNumber()];
};
const apItem = async (sourceTable: string, sourceId: number) => {
  const i = await prisma.finApItem.findFirstOrThrow({ where: { source_doc_id: sourceId, source_doc_type: { doc_table: sourceTable } } });
  return [i.current_balance.toNumber(), i.base_current_balance.toNumber()];
};

before(async () => {
  actor = await systemUserId();
  await openFiscalYear();
  f.usd = (await prisma.refCurrency.findFirstOrThrow({ where: { currency_label: "USD" } })).id;
  const sub = async (label: string) => (await prisma.accAccountSubcategory.findFirstOrThrow({ where: { subcategory_label: { startsWith: label } }, orderBy: { id: "asc" } })).subcategory_label;
  f.fx = await makeAccount({ subcategoryLabel: await sub("4"), normalBalance: "Kredit" });
  await setMapping("fx_account", String(f.fx));

  // ---- sales world
  f.pcs = (await prisma.refUom.create({ data: { uom_code: `test.${key("PCS")}`, uom_label: key("PCS"), uom_name: "Pcs", created_by: actor } })).id;
  const cat = (await prisma.sysItemCategory.findUniqueOrThrow({ where: { category_label: "BRG-JADI" } })).id;
  f.item = (await prisma.mItem.create({ data: { item_code: `test.${key("A")}`, item_label: key("A"), item_name: "A", item_type: "Barang", category_id: cat, base_uom_id: f.pcs, can_sell: true, track_stock: true, created_by: actor } })).id;
  f.term = (await prisma.refPaymentTerm.create({ data: { term_code: `test.${key("T")}`, term_label: key("T"), term_name: "Net 30", due_days: 30, created_by: actor } })).id;
  f.warehouse = (await prisma.refWarehouse.create({ data: { warehouse_code: `test.${key("WH")}`, warehouse_label: key("WH"), warehouse_name: "Gudang Uji", created_by: actor } })).id;
  f.pphAcc = await makeAccount({ subcategoryLabel: await sub("1") });
  f.arAcc = await makeAccount({ subcategoryLabel: await sub("1"), partnerCategoryLabel: "Customer" });
  f.advAcc = await makeAccount({ subcategoryLabel: await sub("2"), normalBalance: "Kredit", partnerCategoryLabel: "Customer" });
  f.vatAcc = await makeAccount({ subcategoryLabel: await sub("2"), normalBalance: "Kredit" });
  f.revAcc = await makeAccount({ subcategoryLabel: await sub("4"), normalBalance: "Kredit" });
  f.cogsAcc = await makeAccount({ subcategoryLabel: await sub("5") });
  f.invAcc = await makeAccount({ subcategoryLabel: await sub("1") });
  f.wht = (await prisma.refWithholdingTax.create({ data: { wht_code: `test.${key("WHT")}`, wht_label: key("WHT"), wht_name: "PPh Uji", rate: 1.5, account_id: f.pphAcc, created_by: actor } })).id;
  for (const [k, v] of [
    ["receivable_account", f.arAcc],
    ["sales_revenue_account", f.revAcc],
    ["sales_advance_account", f.advAcc],
    ["output_vat_account", f.vatAcc],
    ["cogs_account", f.cogsAcc],
    ["inventory_account", f.invAcc],
  ] as const) {
    await setMapping(k, String(v));
  }
  f.arBank = await usdBank("AR", 0, 1);
  f.customer = await makePartner({ categoryLabel: "Customer" });
  await prisma.mPartner.update({ where: { id: f.customer }, data: { taxpayer_type: "Badan", tax_id_type: "NPWP", tax_id: "0987654321098765", tax_name: "PT FIXTURE", is_pkp: true } });
  const village = await prisma.sysRegionVillage.findFirstOrThrow({ orderBy: { code: "asc" } });
  f.address = (await prisma.mPartnerAddress.create({ data: { partner_id: f.customer, village_id: village.id, street: "Kantor", created_by: actor } })).id;
  f.lot = await stockIn(f.item, f.warehouse, key("LA"), 100, 4_000_000);

  // ---- purchasing world
  w = await purchasingWorld("MC");
  f.pAdvAcc = await makeAccount({ subcategoryLabel: await sub("1") });
  f.pVatAcc = await makeAccount({ subcategoryLabel: await sub("1") });
  f.payAcc = await makeAccount({ subcategoryLabel: await sub("2") });
  f.hutPph = await makeAccount({ subcategoryLabel: await sub("2") });
  await w.setMapping("purchase_advance_account", String(f.pAdvAcc));
  await w.setMapping("input_vat_account", String(f.pVatAcc));
  await w.setMapping("payable_account", String(f.payAcc));
  await w.setMapping("supplier_invoice_tolerance", "100");
  await prisma.refWithholdingTax.update({ where: { id: w.f.wht }, data: { account_id: f.hutPph } });
  f.apBank = await usdBank("AP", 2_000, 15_800);
});

after(async () => {
  const arItems = (await prisma.finArItem.findMany({ where: { partner_id: f.customer }, select: { id: true } })).map((i) => i.id);
  await prisma.finArLedger.deleteMany({ where: { item_id: { in: arItems } } });
  await prisma.finArItem.deleteMany({ where: { id: { in: arItems } } });
  const apItems = (await prisma.finApItem.findMany({ where: { partner_id: w.f.supplier }, select: { id: true } })).map((i) => i.id);
  await prisma.finApLedger.deleteMany({ where: { item_id: { in: apItems } } });
  await prisma.finApItem.deleteMany({ where: { id: { in: apItems } } });
  await prisma.finArInvoiceLine.deleteMany({ where: { invoice_id: { in: ids.inv } } });
  await prisma.finArInvoiceAdvanceDeduction.deleteMany({ where: { invoice_id: { in: ids.inv } } });
  await prisma.finArInvoice.deleteMany({ where: { id: { in: ids.inv } } });
  await prisma.finApInvoice.deleteMany({ where: { id: { in: pids.inv } } });
  await prisma.cashBankLedger.deleteMany({ where: { cash_bank_id: { in: banks } } });
  await prisma.finCashBankTx.deleteMany({ where: { id: { in: ids.tx } } });
  await prisma.finArAdvance.deleteMany({ where: { id: { in: ids.adv } } });
  await prisma.finApAdvance.deleteMany({ where: { id: { in: pids.bill } } });
  await prisma.logReceiptNoteTracking.deleteMany({ where: { line: { receipt_note_id: { in: pids.rn } } } });
  await prisma.logReceiptNoteLine.deleteMany({ where: { receipt_note_id: { in: pids.rn } } });
  await prisma.logReceiptNote.deleteMany({ where: { id: { in: pids.rn } } });
  await prisma.logDeliveryNoteTracking.deleteMany({ where: { line: { delivery_note_id: { in: ids.dn } } } });
  await prisma.logDeliveryNoteLine.deleteMany({ where: { delivery_note_id: { in: ids.dn } } });
  await prisma.logDeliveryNote.deleteMany({ where: { id: { in: ids.dn } } });
  await prisma.salDeliveryOrderLine.deleteMany({ where: { delivery_order_id: { in: ids.do } } });
  await prisma.salDeliveryOrder.deleteMany({ where: { id: { in: ids.do } } });
  await prisma.salOrderLine.deleteMany({ where: { order_id: { in: ids.so } } });
  await prisma.salOrder.deleteMany({ where: { id: { in: ids.so } } });
  await prisma.salCustomerOrderLine.deleteMany({ where: { order_id: { in: ids.co } } });
  await prisma.salCustomerOrder.deleteMany({ where: { id: { in: ids.co } } });
  await prisma.cashBankPeriod.deleteMany({ where: { cash_bank_id: { in: banks } } });
  await prisma.cashBankBalance.deleteMany({ where: { cash_bank_id: { in: banks } } });
  await prisma.mCashBank.deleteMany({ where: { id: { in: banks } } });
  for (const [k, list] of Object.entries({
    fin_ar_invoice: ids.inv,
    fin_ap_invoice: pids.inv,
    fin_cash_bank_tx: ids.tx,
    fin_ar_advance: ids.adv,
    fin_ap_advance: pids.bill,
    log_receipt_note: pids.rn,
    log_delivery_note: ids.dn,
    sal_delivery_order: ids.do,
    sal_order: ids.so,
    sal_customer_order: ids.co,
  })) {
    await prisma.auditLog.deleteMany({ where: { entity_key: k, row_id: { in: list } } });
  }
  for (const [k, v] of saved) await prisma.sysSetting.update({ where: { setting_key: k }, data: { setting_value: v } });
  await prisma.refWithholdingTax.update({ where: { id: f.wht }, data: { account_id: null } });
  await prisma.refWithholdingTax.update({ where: { id: w.f.wht }, data: { account_id: null } });
  await w.teardown();
  await cleanupStock([f.item]);
  await prisma.mItem.deleteMany({ where: { id: f.item } });
  await prisma.refWithholdingTax.deleteMany({ where: { id: f.wht } });
  await prisma.refPaymentTerm.deleteMany({ where: { id: f.term } });
  await prisma.refWarehouse.deleteMany({ where: { id: f.warehouse } });
  await prisma.refUom.deleteMany({ where: { id: f.pcs } });
  await cleanupFixtures();
  await cleanupFiscalYear();
  await disconnect();
});

describe("the tax arithmetic in a currency's minor unit (MC5)", () => {
  test("a USD order rounds every tax figure to the cent; IDR keeps whole rupiah", () => {
    const rates = { rate: 12, otherNum: 11, otherDen: 12 };
    const line = { qty: 10, price: 12.345, discountType: null, discountValue: null, withholdingRate: 1.5, withholdingKey: "1" };
    const usd = computeSalesTotals({ lines: [line], mode: "Exclude", taxable: true, vatCollector: false, rates, scale: 100 });
    assert.deepEqual([usd.dpp, usd.dppOther, usd.ppn, usd.total, usd.withholdingTotal], [123.45, 113.16, 13.58, 137.03, 1.85]);
    const idr = computeSalesTotals({ lines: [{ ...line, price: 12_345 }], mode: "Exclude", taxable: true, vatCollector: false, rates });
    assert.deepEqual([idr.dpp, idr.dppOther, idr.ppn], [123_450, 113_163, 13_580]);
  });

  test("a USD bill settled from cash: the PPh share in cents, the cash exact", () => {
    const bill = { total: 777, ppn: 77, withholdings: [{ key: "1", rate: 1.5, base: 700, amount: 10.5 }] };
    const s = settleBillFromCash({ bill, before: 0, cash: 766.5, withhold: true, scale: 100 });
    assert.deepEqual([s.settled, s.pph, s.cash], [777, 10.5, 766.5]);
  });
});

describe("sales in USD (stages 3–4)", () => {
  test("the Customer Order keeps its rate and a base per line, summed into its header", async () => {
    const co = await createCustomerOrder(
      { order_date: today, currency_id: f.usd, exchange_rate: 16_000, customer_id: f.customer, address_id: f.address, term_id: f.term, price_mode: "Exclude", is_taxable: true, po_no: "", po_date: "", salesperson: "", note: "" },
      [{ item_id: f.item, uom_id: f.pcs, qty: 10, price: 100, discount_type: null, discount_value: null, withholding_tax_id: f.wht, note: "" }],
      actor
    );
    assert.ok(co.ok, JSON.stringify(co));
    ids.co.push(co.id);
    f.co = co.id;
    const row = await prisma.salCustomerOrder.findUniqueOrThrow({ where: { id: co.id } });
    assert.deepEqual(
      [row.dpp_amount.toNumber(), row.ppn_amount.toNumber(), row.total_amount.toNumber(), row.exchange_rate.toNumber(), row.base_dpp_amount.toNumber(), row.base_ppn_amount.toNumber(), row.base_total_amount.toNumber()],
      [1_000, 110, 1_110, 16_000, 16_000_000, 1_760_000, 17_760_000]
    );
    assert.equal((await createCustomerOrder({ order_date: today, currency_id: f.usd, exchange_rate: "", customer_id: f.customer, address_id: f.address, term_id: f.term, price_mode: "Exclude", is_taxable: true, po_no: "", po_date: "", salesperson: "", note: "" }, [], actor)).ok, false, "a foreign order needs its rate");
    await transitionCustomerOrder(co.id, "submit", actor);
    await transitionCustomerOrder(co.id, "approve", actor);
  });

  test("an advance received into the USD bank at 15.500 is held at what the money brought, without selisih kurs", async () => {
    const adv = await createSalesAdvance(
      { order_id: f.co, advance_date: today, due_date: today, cash_bank_id: f.arBank, description: "UM", note: "", amount_type: "Amount", amount_value: 300 },
      actor
    );
    assert.ok(adv.ok, JSON.stringify(adv));
    ids.adv.push(adv.id);
    f.adv = adv.id;
    await transitionSalesAdvance(adv.id, "issue", actor);
    const rc = await createCashReceipt(
      { purpose: "customer_receipt", tx_date: today, partner_id: f.customer, cash_bank_id: f.arBank, bank_ref: "", note: "", bank_charge: 0, exchange_rate: 15_500, lines: [{ doc_id: adv.id, cash: 333, withhold: false }] },
      actor
    );
    assert.ok(rc.ok, JSON.stringify(rc));
    ids.tx.push(rc.id);
    assert.deepEqual(await transitionCashReceipt(rc.id, "post", actor), { ok: true });
    assert.deepEqual(await arItem("fin_ar_advance", adv.id), [300, 4_650_000]);
    const tx = await prisma.finCashBankTx.findUniqueOrThrow({ where: { id: rc.id } });
    assert.equal(await balanced(tx.journal_id), 0);
    assert.equal(await fxOf(tx.journal_id), 0);
    const bank = await prisma.cashBankBalance.findUniqueOrThrow({ where: { cash_bank_id: f.arBank } });
    assert.deepEqual([bank.balance.toNumber(), bank.base_balance.toNumber()], [333, 5_161_500]);
  });

  test("an IDR bank cannot receive a USD bill (MC14)", async () => {
    const idrBank = await prisma.mCashBank.findFirst({ where: { currency: { currency_label: "IDR" }, status: "Active" } });
    if (!idrBank) return;
    const rc = await createCashReceipt(
      { purpose: "customer_receipt", tx_date: today, partner_id: f.customer, cash_bank_id: idrBank.id, bank_ref: "", note: "", bank_charge: 0, lines: [{ doc_id: f.adv, cash: 1, withhold: false }] },
      actor
    );
    assert.equal(rc.ok, false);
  });

  test("the Invoice books Piutang at the order's rate and the advance applied gives a selisih kurs loss", async () => {
    const coLine = (await prisma.salCustomerOrderLine.findFirstOrThrow({ where: { order_id: f.co } })).id;
    const so = await createSalesOrder({ customer_order_id: f.co, order_date: today, delivery_date: today, address_id: f.address, note: "" }, [{ customer_order_line_id: coLine, qty: 10, note: "" }], actor);
    assert.ok(so.ok, JSON.stringify(so));
    ids.so.push(so.id);
    for (const a of ["submit", "approve", "confirm"] as const) await transitionSalesOrder(so.id, a, actor);
    const soLine = await prisma.salOrderLine.findFirstOrThrow({ where: { order_id: so.id } });
    const dOrder = await createDeliveryOrder(
      { customer_order_id: f.co, do_date: today, delivery_date: today, warehouse_id: f.warehouse, address_id: f.address, note: "" },
      [{ sales_order_line_id: soLine.id, qty: 10, note: "" }],
      actor
    );
    assert.ok(dOrder.ok, JSON.stringify(dOrder));
    ids.do.push(dOrder.id);
    await transitionDeliveryOrder(dOrder.id, "issue", actor);
    const doLine = await prisma.salDeliveryOrderLine.findFirstOrThrow({ where: { delivery_order_id: dOrder.id } });
    const dn = await createDeliveryNote(
      { source_doc_id: dOrder.id, dn_date: today, vehicle_no: "", driver_name: "", note: "" },
      [{ source_doc_line_id: doLine.id, qty: 10, note: "", picks: [{ tracking_id: f.lot, base_qty: 10 }] }],
      actor
    );
    assert.ok(dn.ok, JSON.stringify(dn));
    ids.dn.push(dn.id);
    assert.ok((await transitionDeliveryNote(dn.id, "post", actor)).ok);
    const dnLine = await prisma.logDeliveryNoteLine.findFirstOrThrow({ where: { delivery_note_id: dn.id } });
    const umItem = (await prisma.finArItem.findFirstOrThrow({ where: { source_doc_id: f.adv, source_doc_type: { doc_table: "fin_ar_advance" } } })).id;

    const inv = await createInvoice(
      { customer_order_id: f.co, invoice_date: today, address_id: f.address, cash_bank_id: f.arBank, note: "" },
      [{ delivery_note_line_id: dnLine.id }],
      [{ ar_item_id: umItem, dpp_used: 300 }],
      actor
    );
    assert.ok(inv.ok, JSON.stringify(inv));
    ids.inv.push(inv.id);
    f.inv = inv.id;
    assert.deepEqual(await transitionInvoice(inv.id, "post", actor), { ok: true });
    const row = await prisma.finArInvoice.findUniqueOrThrow({ where: { id: inv.id }, include: { deductions: true } });
    assert.deepEqual([row.dpp_amount.toNumber(), row.ppn_amount.toNumber(), row.total_amount.toNumber()], [1_000, 77, 777]);
    assert.deepEqual([row.base_dpp_amount.toNumber(), row.base_advance_dpp_amount.toNumber(), row.base_advance_ppn_amount.toNumber()], [16_000_000, 4_650_000, 511_500]);
    assert.equal(row.deductions[0].fx_difference.toNumber(), 166_500);
    assert.equal(await balanced(row.journal_id), 0);
    assert.equal(await fxOf(row.journal_id), 166_500, "a loss is debited");
    assert.deepEqual(await arItem("fin_ar_invoice", inv.id), [777, 12_432_000]);
    assert.deepEqual(await arItem("fin_ar_advance", f.adv), [0, 0]);
  });

  test("the rest received at 16.200 less PPh empties Piutang in both measures, with a selisih kurs gain", async () => {
    const rc = await createCashReceipt(
      { purpose: "customer_receipt", tx_date: today, partner_id: f.customer, cash_bank_id: f.arBank, bank_ref: "", note: "", bank_charge: 0, exchange_rate: 16_200, lines: [{ doc_type: "fin_ar_invoice", doc_id: f.inv, cash: 766.5, withhold: true }] },
      actor
    );
    assert.ok(rc.ok, JSON.stringify(rc));
    ids.tx.push(rc.id);
    assert.deepEqual(await transitionCashReceipt(rc.id, "post", actor), { ok: true });
    assert.deepEqual(await arItem("fin_ar_invoice", f.inv), [0, 0]);
    const tx = await prisma.finCashBankTx.findUniqueOrThrow({ where: { id: rc.id }, include: { lines: true } });
    const l = tx.lines[0];
    assert.deepEqual([l.transaction_base_amount.toNumber(), l.base_settled_amount.toNumber(), l.fx_difference.toNumber()], [12_587_400, 12_432_000, -155_400]);
    assert.equal(await balanced(tx.journal_id), 0);
    assert.equal(await fxOf(tx.journal_id), -155_400, "a gain is credited");
  });
});

describe("purchasing in USD (stages 5–6)", () => {
  test("an advance paid from the USD bank at its average is held at what the money took", async () => {
    const po = await w.openPO([{ item: w.f.stock, qty: 10, price: 50, wht: w.f.wht }], { currencyId: f.usd, rate: 15_000 });
    f.po = po.id;
    f.poLine = po.lineIds[0];
    const row = await prisma.purOrder.findUniqueOrThrow({ where: { id: po.id } });
    assert.deepEqual([row.dpp_amount.toNumber(), row.ppn_amount.toNumber(), row.base_dpp_amount.toNumber()], [500, 55, 7_500_000]);
    const bill = await createPurchaseAdvance(
      { order_id: po.id, advance_date: today, due_date: today, supplier_ref_no: "", description: "UM", note: "", amount_type: "Percent", amount_value: 30 },
      actor
    );
    assert.ok(bill.ok, JSON.stringify(bill));
    pids.bill.push(bill.id);
    f.pBill = bill.id;
    await transitionPurchaseAdvance(bill.id, "issue", actor);
    const pay = await createCashPayment(
      { purpose: "supplier_payment", tx_date: today, partner_id: w.f.supplier, cash_bank_id: f.apBank, bank_ref: "", note: "", bank_charge: 0, lines: [{ doc_type: "fin_ap_advance", doc_id: bill.id, cash: 163.5, withhold: true }] },
      actor
    );
    assert.ok(pay.ok, JSON.stringify(pay));
    ids.tx.push(pay.id);
    assert.deepEqual(await transitionCashPayment(pay.id, "post", actor), { ok: true });
    assert.deepEqual(await apItem("fin_ap_advance", bill.id), [150, 2_370_000]);
    const tx = await prisma.finCashBankTx.findUniqueOrThrow({ where: { id: pay.id } });
    assert.equal(await balanced(tx.journal_id), 0);
    assert.equal(tx.exchange_rate.toNumber(), 15_800);
  });

  test("the receipt brings the stock in at the PO's base and keeps its USD DPP", async () => {
    const rn = await createReceiptNote(
      { source_doc_id: f.po, rn_date: today, warehouse_id: w.f.warehouse, supplier_dn_no: "", note: "" },
      [{ source_doc_line_id: f.poLine, qty: 10, note: "", lots: [{ tracking_no: key("PL"), expiry_date: "", qty: 10 }] }],
      actor
    );
    assert.ok(rn.ok, JSON.stringify(rn));
    pids.rn.push(rn.id);
    assert.ok((await transitionReceiptNote(rn.id, "post", actor)).ok);
    const line = await prisma.logReceiptNoteLine.findFirstOrThrow({ where: { receipt_note_id: rn.id } });
    assert.deepEqual([line.value_amount.toNumber(), line.order_dpp_amount.toNumber()], [7_500_000, 500]);
    f.rnLine = line.id;
  });

  test("the Invoice clears Barang Diterima Belum Ditagih exactly and the advance applied gives a loss", async () => {
    const umItem = (await prisma.finApItem.findFirstOrThrow({ where: { source_doc_id: f.pBill, source_doc_type: { doc_table: "fin_ap_advance" } } })).id;
    const inv = await createPurchaseInvoice(
      { purchase_order_id: f.po, invoice_date: today, supplier_invoice_no: `INV-${key("1")}`, supplier_invoice_date: today, supplier_tax_invoice_no: "", supplier_total: null, note: "" },
      [{ receipt_note_line_id: f.rnLine }],
      [{ ap_item_id: umItem, dpp_used: 150 }],
      actor
    );
    assert.ok(inv.ok, JSON.stringify(inv));
    pids.inv.push(inv.id);
    f.pInv = inv.id;
    assert.deepEqual(await transitionPurchaseInvoice(inv.id, "post", actor), { ok: true });
    const row = await prisma.finApInvoice.findUniqueOrThrow({ where: { id: inv.id }, include: { deductions: true } });
    assert.deepEqual([row.payable_amount.toNumber(), row.base_payable_amount.toNumber(), row.base_dpp_amount.toNumber()], [548, 8_220_000, 7_500_000]);
    assert.equal(row.deductions[0].fx_difference.toNumber(), -133_200);
    assert.equal(await balanced(row.journal_id), 0);
    assert.equal(await fxOf(row.journal_id), 133_200, "a loss is debited");
    const grir = await prisma.accJournalLine.aggregate({ where: { account_id: w.f.grirAcc, partner_id: w.f.supplier }, _sum: { debit_amount: true, kredit_amount: true } });
    assert.equal(grir._sum.debit_amount!.toNumber() - grir._sum.kredit_amount!.toNumber(), 0, "GR/IR clears at the PO's rate");
    assert.deepEqual(await apItem("fin_ap_invoice", inv.id), [381.5, 5_722_500]);
  });

  test("the rest paid from the USD bank at its average empties Hutang, with a selisih kurs loss", async () => {
    const pay = await createCashPayment(
      { purpose: "supplier_payment", tx_date: today, partner_id: w.f.supplier, cash_bank_id: f.apBank, bank_ref: "", note: "", bank_charge: 0, lines: [{ doc_type: "fin_ap_invoice", doc_id: f.pInv, cash: 381.5, withhold: false }] },
      actor
    );
    assert.ok(pay.ok, JSON.stringify(pay));
    ids.tx.push(pay.id);
    assert.deepEqual(await transitionCashPayment(pay.id, "post", actor), { ok: true });
    assert.deepEqual(await apItem("fin_ap_invoice", f.pInv), [0, 0]);
    const tx = await prisma.finCashBankTx.findUniqueOrThrow({ where: { id: pay.id }, include: { lines: true } });
    assert.equal(tx.lines[0].fx_difference.toNumber(), -305_200);
    assert.equal(await balanced(tx.journal_id), 0);
    assert.equal(await fxOf(tx.journal_id), 305_200, "a loss is debited");
    const bank = await prisma.cashBankBalance.findUniqueOrThrow({ where: { cash_bank_id: f.apBank } });
    assert.deepEqual([bank.balance.toNumber(), bank.base_balance.toNumber()], [1_455, 22_989_000]);
  });
});
