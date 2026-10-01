import test, { after, before, describe } from "node:test";
import assert from "node:assert/strict";

import {
  cashReceiptOptions,
  checkCashReceipt,
  createCashReceipt,
  getCashReceipt,
  previewCashReceiptPosting,
  settledByDocuments,
  settledDocumentRefusal,
  transitionCashReceipt,
  updateCashReceipt,
  type CashReceiptInput,
} from "../src/lib/erp/cash-bank-tx";
import { createSalesAdvance, transitionSalesAdvance } from "../src/lib/erp/sales-advance";
import { createCustomerOrder, transitionCustomerOrder, type CustomerOrderLineInput } from "../src/lib/erp/customer-order";
import { availableCashReceiptActions, cashReceiptAbilities } from "../src/lib/erp/cash-bank-tx-workflow";
import { CASH_BANK_SUBCATEGORY } from "../src/lib/erp/records";
import {
  FIXTURE_PREFIX,
  cleanupFiscalYear,
  cleanupFixtures,
  disconnect,
  makeAccount,
  makePartner,
  openFiscalYear,
  prisma,
  systemUserId,
} from "./helpers";

/**
 * Penerimaan Kas & Bank (P66–P70): what one receipt may settle — the purpose's
 * documents, owed by one partner — how its money settles them, and what posting writes:
 * one balanced journal naming the customer, one Cash Bank Book entry, and the
 * settled figures per bill, with the bills locked so two receipts cannot both
 * clear the last of one. A posted receipt makes its bill refuse Batalkan.
 *
 * Figures: an Exclude order of 3 × 1.000.000, two units under a 1,5 % Jenis
 * PPh. A 30 % advance bill: DPP 900.000, PPN 99.000 (12 % × 825.000), total
 * 999.000; PPh on 2/3 of the DPP = 1,5 % × 600.000 = 9.000.
 */

let actor = 0;
const f = {} as Record<string, number>;
const orders: number[] = [];
const advances: number[] = [];
const receipts: number[] = [];
const cleanups: (() => Promise<unknown>)[] = [];
const savedSettings = new Map<string, string | null>();
const stamp = String(Date.now() % 100000);
const key = (s: string) => `${FIXTURE_PREFIX}${s}${stamp}`;
const today = new Date().toISOString().slice(0, 10);

async function cashBank(label: string) {
  const currency = (await prisma.refCurrency.findFirstOrThrow({ where: { currency_label: "IDR" } })).id;
  const account = await makeAccount({ subcategoryLabel: CASH_BANK_SUBCATEGORY });
  const id = (
    await prisma.mCashBank.create({
      data: {
        cash_bank_code: `test.${key(label)}`,
        cash_bank_label: key(label),
        cash_bank_name: label,
        cash_bank_type: "Bank",
        currency_id: currency,
        account_id: account,
        created_by: actor,
      },
    })
  ).id;
  return { id, account };
}

async function customer() {
  const id = await makePartner({ categoryLabel: "Customer" });
  await prisma.mPartner.update({
    where: { id },
    data: { taxpayer_type: "Badan", tax_id_type: "NPWP", tax_id: "0987654321098765", tax_name: "PT FIXTURE", is_pkp: true },
  });
  const village = await prisma.sysRegionVillage.findFirstOrThrow({ orderBy: { code: "asc" } });
  const address = (await prisma.mPartnerAddress.create({ data: { partner_id: id, village_id: village.id, street: "Kantor", created_by: actor } })).id;
  return { id, address };
}

async function openOrder(cust: { id: number; address: number }) {
  const line = (over: Partial<CustomerOrderLineInput> = {}): CustomerOrderLineInput => ({
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
  const r = await createCustomerOrder(
    { order_date: "2026-09-10", customer_id: cust.id, address_id: cust.address, term_id: f.term, price_mode: "Exclude", is_taxable: true, po_no: "", po_date: "", salesperson: "", note: "" },
    [line({ qty: 2, withholding_tax_id: f.wht }), line()],
    actor
  );
  assert.ok(r.ok, JSON.stringify(r));
  orders.push(r.id);
  await transitionCustomerOrder(r.id, "submit", actor);
  await transitionCustomerOrder(r.id, "approve", actor);
  return r.id;
}

/** An issued 30 % bill: total 999.000, PPh 9.000. */
async function issuedBill(orderId: number) {
  const r = await createSalesAdvance(
    { order_id: orderId, advance_date: "2026-09-11", due_date: "2026-09-18", cash_bank_id: f.bank, description: "UM 30%", note: "", amount_type: "Percent", amount_value: 30 },
    actor
  );
  assert.ok(r.ok, JSON.stringify(r));
  advances.push(r.id);
  assert.deepEqual(await transitionSalesAdvance(r.id, "issue", actor), { ok: true });
  return r.id;
}

const input = (over: Partial<CashReceiptInput> = {}): CashReceiptInput => ({
  purpose: "sales_advance",
  tx_date: today,
  partner_id: f.customer,
  cash_bank_id: f.bank,
  bank_ref: "TRF-1",
  note: "",
  bank_charge: 0,
  lines: [{ doc_id: f.bill1, cash: 990_000, withhold: true }],
  ...over,
});

async function create(i: CashReceiptInput) {
  const r = await createCashReceipt(i, actor);
  if (r.ok) receipts.push(r.id);
  return r;
}

async function setMapping(k: string, v: string | null) {
  if (!savedSettings.has(k)) {
    savedSettings.set(k, (await prisma.sysSetting.findUnique({ where: { setting_key: k } }))?.setting_value ?? null);
  }
  await prisma.sysSetting.upsert({
    where: { setting_key: k },
    update: { setting_value: v },
    create: { setting_key: k, setting_value: v, updated_by: actor },
  });
}

before(async () => {
  actor = await systemUserId();
  await openFiscalYear();
  f.pcs = (await prisma.refUom.create({ data: { uom_code: `test.${key("PCS")}`, uom_label: key("PCS"), uom_name: "Pcs", created_by: actor } })).id;
  const cat = (await prisma.sysItemCategory.findUniqueOrThrow({ where: { category_label: "BRG-JADI" } })).id;
  f.goods = (
    await prisma.mItem.create({
      data: { item_code: `test.${key("G")}`, item_label: key("G"), item_name: "Barang", item_type: "Barang", category_id: cat, base_uom_id: f.pcs, can_sell: true, created_by: actor },
    })
  ).id;
  f.term = (await prisma.refPaymentTerm.create({ data: { term_code: `test.${key("T")}`, term_label: key("T"), term_name: "Net 30", due_days: 30, created_by: actor } })).id;

  // Posting targets, all fixture accounts: the PPh on the Jenis PPh, the rest
  // in Account Mapping (restored afterwards).
  const sub = async (label: string) => (await prisma.accAccountSubcategory.findFirstOrThrow({ where: { subcategory_label: { startsWith: label } }, orderBy: { id: "asc" } })).subcategory_label;
  f.pphAcc = await makeAccount({ subcategoryLabel: await sub("1") });
  f.advAcc = await makeAccount({ subcategoryLabel: await sub("2"), normalBalance: "Kredit", partnerCategoryLabel: "Customer" });
  f.vatAcc = await makeAccount({ subcategoryLabel: await sub("2"), normalBalance: "Kredit" });
  f.feeAcc = await makeAccount({ subcategoryLabel: await sub("5") });
  f.wht = (await prisma.refWithholdingTax.create({ data: { wht_code: `test.${key("WHT")}`, wht_label: key("WHT"), wht_name: "PPh Uji", rate: 1.5, prepaid_account_id: f.pphAcc, created_by: actor } })).id;
  await setMapping("sales_advance_account", String(f.advAcc));
  await setMapping("output_vat_account", String(f.vatAcc));
  await setMapping("bank_charge_account", String(f.feeAcc));

  const bank = await cashBank("BANK");
  f.bank = bank.id;
  f.bankAcc = bank.account;
  const c = await customer();
  f.customer = c.id;
  const o = await customer();
  f.other = o.id;
  const order = await openOrder(c);
  f.bill1 = await issuedBill(order);
  f.bill2 = await issuedBill(order);
  f.bill3 = await issuedBill(order);
  f.otherBill = await issuedBill(await openOrder(o));

  cleanups.push(
    () => prisma.mItem.deleteMany({ where: { id: f.goods } }),
    () => prisma.refUom.deleteMany({ where: { id: f.pcs } }),
    () => prisma.refPaymentTerm.deleteMany({ where: { id: f.term } }),
    () => prisma.refWithholdingTax.deleteMany({ where: { id: f.wht } })
  );
});

after(async () => {
  // AR items a posted receipt created: their Buku Piutang entries first.
  if (receipts.length) {
    const items = await prisma.finArItem.findMany({ where: { source_doc_id: { in: receipts }, source_doc_type: { doc_table: "fin_cash_bank_tx" } }, select: { id: true } });
    await prisma.finArLedger.deleteMany({ where: { item_id: { in: items.map((i) => i.id) } } });
    await prisma.finArItem.deleteMany({ where: { id: { in: items.map((i) => i.id) } } });
    await prisma.finCashBankTx.deleteMany({ where: { id: { in: receipts } } });
  }
  await prisma.auditLog.deleteMany({ where: { entity_key: "fin_cash_bank_tx", row_id: { in: receipts } } });
  await prisma.salAdvance.deleteMany({ where: { id: { in: advances } } });
  await prisma.auditLog.deleteMany({ where: { entity_key: "sal_advance", row_id: { in: advances } } });
  await prisma.salCustomerOrderLine.deleteMany({ where: { order_id: { in: orders } } });
  await prisma.salCustomerOrder.deleteMany({ where: { id: { in: orders } } });
  await prisma.auditLog.deleteMany({ where: { entity_key: "sal_customer_order", row_id: { in: orders } } });
  for (const [k, v] of savedSettings) {
    await prisma.sysSetting.update({ where: { setting_key: k }, data: { setting_value: v } });
  }
  // Guarded: with the id undefined, `where` would match every Jenis PPh.
  if (f.wht) await prisma.refWithholdingTax.update({ where: { id: f.wht }, data: { prepaid_account_id: null } });
  await cleanupFixtures();
  for (const c of cleanups) await c();
  await cleanupFiscalYear();
  await disconnect();
});

// ----------------------------------------------------------------- options

describe("what one receipt may settle (P67)", () => {
  test("the form offers each partner's issued, open bills", async () => {
    const o = await cashReceiptOptions();
    const mine = o.bills.filter((b) => b.customerId === f.customer).map((b) => b.id);
    assert.ok([f.bill1, f.bill2, f.bill3].every((id) => mine.includes(id)));
    const b = o.bills.find((x) => x.id === f.bill1)!;
    assert.equal(b.total, 999_000);
    assert.equal(b.open, 999_000);
    assert.deepEqual(b.withholdings.map((w) => [w.base, w.amount]), [[600_000, 9_000]]);
    assert.ok(o.purposes.every((p) => p.direction === "In"));
  });

  test("another partner's bill, a repeated bill, or no bill is refused", async () => {
    const other = await checkCashReceipt(prisma, input({ lines: [{ doc_id: f.otherBill, cash: 990_000, withhold: true }] }), null);
    assert.ok(!other.ok && /bukan tagihan partner ini/.test(other.errors["lines.0.doc_id"]));
    const twice = await checkCashReceipt(
      prisma,
      input({ lines: [{ doc_id: f.bill1, cash: 500_000, withhold: true }, { doc_id: f.bill1, cash: 490_000, withhold: true }] }),
      null
    );
    assert.ok(!twice.ok && /lebih dari sekali/.test(twice.errors["lines.1.doc_id"]));
    const none = await checkCashReceipt(prisma, input({ lines: [] }), null);
    assert.ok(!none.ok && none.errors._lines);
  });

  test("a line may not receive more than clears the bill", async () => {
    const r = await checkCashReceipt(prisma, input({ lines: [{ doc_id: f.bill1, cash: 990_001, withhold: true }] }), null);
    assert.ok(!r.ok && /Melebihi yang melunasi/.test(r.errors["lines.0.cash"]));
  });
});

// -------------------------------------------------------------- the money

describe("the receipt's money follows its lines (P76)", () => {
  test("money short by exactly the PPh clears the bill", async () => {
    const r = await checkCashReceipt(prisma, input(), null);
    assert.ok(r.ok, JSON.stringify(!r.ok && r.errors));
    assert.equal(r.c.data.cash_amount, 990_000);
    assert.equal(r.c.data.settled_amount, 999_000);
    assert.equal(r.c.data.pph_amount, 9_000);
    assert.equal(r.c.lines[0].ppnPart, 99_000);
    assert.equal(r.c.lines[0].dppPart, 900_000);
  });

  test("less money is a partial payment carrying its share of the PPh", async () => {
    const r = await checkCashReceipt(prisma, input({ lines: [{ doc_id: f.bill1, cash: 495_000, withhold: true }] }), null);
    assert.ok(r.ok, JSON.stringify(!r.ok && r.errors));
    assert.equal(r.c.data.settled_amount, 499_500);
    assert.equal(r.c.data.pph_amount, 4_500);
  });

  test("the bank charge comes off what reached the bank, not off the bill", async () => {
    const r = await checkCashReceipt(prisma, input({ bank_charge: 6_500 }), null);
    assert.ok(r.ok);
    assert.equal(r.c.data.cash_amount, 983_500);
    assert.equal(r.c.data.settled_amount, 999_000);
    const all = await checkCashReceipt(prisma, input({ bank_charge: 990_000 }), null);
    assert.ok(!all.ok && /lebih kecil/.test(all.errors.bank_charge));
  });

  test("Potong PPh off: the money is what it settles", async () => {
    const r = await checkCashReceipt(prisma, input({ lines: [{ doc_id: f.bill1, cash: 999_000, withhold: false }] }), null);
    assert.ok(r.ok);
    assert.equal(r.c.data.pph_amount, 0);
    assert.equal(r.c.data.settled_amount, 999_000);
  });
});

// ----------------------------------------------------------------- posting

describe("posting a receipt of two bills (P66)", () => {
  test("one journal, one Cash Bank Book entry, the bills paid", async () => {
    // bill2 in full with a 6.500 fee; bill3 half, without withholding.
    const i = input({
      bank_charge: 6_500,
      lines: [
        { doc_id: f.bill2, cash: 990_000, withhold: true },
        { doc_id: f.bill3, cash: 499_500, withhold: false },
      ],
    });
    const r = await create(i);
    assert.ok(r.ok, JSON.stringify(r));
    assert.match(r.txNo, /^BKM\/\d{4}\/\d{2}\/\d{4}$/);
    assert.equal((await settledByDocuments("sal_advance", [f.bill2])).get(f.bill2) ?? 0, 0, "a Draft settles nothing");

    const preview = await previewCashReceiptPosting(r.id);
    assert.ok(preview.ok, !preview.ok ? preview.message : "");

    const journals = await prisma.accJournal.count();
    assert.deepEqual(await transitionCashReceipt(r.id, "post", actor), { ok: true });
    assert.equal(await prisma.accJournal.count(), journals + 1);

    const rec = (await getCashReceipt(r.id))!;
    assert.equal(rec.status, "Posted");
    assert.ok(rec.journal);
    const lines = await prisma.accJournalLine.findMany({ where: { journal_id: rec.journal!.id }, orderBy: { sequence_no: "asc" } });
    const debit = lines.reduce((a, l) => a + l.debit_amount.toNumber(), 0);
    const credit = lines.reduce((a, l) => a + l.kredit_amount.toNumber(), 0);
    assert.equal(debit, credit);
    const on = (acc: number, side: "debit_amount" | "kredit_amount") =>
      lines.filter((l) => l.account_id === acc).reduce((a, l) => a + l[side].toNumber(), 0);
    assert.equal(on(f.bankAcc, "debit_amount"), 1_483_000);
    assert.equal(on(f.feeAcc, "debit_amount"), 6_500);
    assert.equal(on(f.pphAcc, "debit_amount"), 9_000);
    // PPN: bill2 99.000 + bill3 half of 99.000 = 49.500
    assert.equal(on(f.vatAcc, "kredit_amount"), 148_500);
    assert.equal(on(f.advAcc, "kredit_amount"), 900_000 + 450_000);
    assert.ok(lines.filter((l) => l.account_id === f.advAcc).every((l) => l.partner_id === f.customer), "the advance names the customer");

    const book = await prisma.cashBankLedger.findMany({ where: { cash_bank_id: f.bank } });
    assert.equal(book.length, 1);
    assert.equal(book[0].amount.toNumber(), 1_483_000);
    assert.equal(book[0].direction, "In");

    const paid = await settledByDocuments("sal_advance", [f.bill2, f.bill3]);
    assert.equal(paid.get(f.bill2), 999_000);
    assert.equal(paid.get(f.bill3), 499_500);

    const whts = await prisma.finCashBankTxLineWht.findMany({ where: { line: { tx_id: r.id } } });
    assert.deepEqual(whts.map((w) => [w.base_amount.toNumber(), w.amount.toNumber()]), [[600_000, 9_000]], "one Bukti Potong unit per bill per type (P69)");

    const events = (await prisma.auditLog.findMany({ where: { entity_key: "fin_cash_bank_tx", row_id: r.id }, orderBy: { id: "asc" } })).map((a) => a.event);
    assert.deepEqual(events, ["create", "post"]);

    // One Uang Muka AR item per bill, at its DPP part (P73), each with its
    // Create entry in Buku Piutang naming the receipt.
    const items = await prisma.finArItem.findMany({
      where: { source_doc_id: r.id, source_doc_type: { doc_table: "fin_cash_bank_tx" } },
      include: { entries: true },
      orderBy: { id: "asc" },
    });
    assert.deepEqual(
      items.map((i) => [i.item_type, i.direction, i.ref_doc_id, i.current_balance.toNumber()]),
      [["Advance", "Decrease", f.bill2, 900_000], ["Advance", "Decrease", f.bill3, 450_000]]
    );
    assert.ok(items.every((i) => i.partner_id === f.customer && i.customer_order_id === orders[0] && i.source_no === r.txNo));
    assert.ok(items.every((i) => i.entries.length === 1 && i.entries[0].event === "Create" && i.entries[0].doc_no === r.txNo));
    assert.equal(
      items.reduce((a, i) => a + i.current_balance.toNumber(), 0),
      on(f.advAcc, "kredit_amount"),
      "the Uang Muka items reconcile with the Uang Muka Penjualan account"
    );
  });

  test("a posted receipt is permanent; its bill refuses Batalkan", async () => {
    const [id] = receipts.slice(-1);
    assert.ok(!(await transitionCashReceipt(id, "cancel", actor, "x")).ok);
    assert.ok(!(await updateCashReceipt(id, input(), actor)).ok);
    const cancel = await transitionSalesAdvance(f.bill3, "cancel", actor, "batal", (tx, billId) =>
      settledDocumentRefusal("sal_advance", tx, billId)
    );
    assert.ok(!cancel.ok && /sudah dibayar/.test(cancel.errors._form));
  });

  test("the second half of a bill takes what is left, and the bill cannot be over-settled", async () => {
    const over = await checkCashReceipt(prisma, input({ lines: [{ doc_id: f.bill3, cash: 999_000, withhold: false }] }), null);
    assert.ok(!over.ok, "only 499.500 is open");
    const r = await create(input({ lines: [{ doc_id: f.bill3, cash: 499_500, withhold: false }] }));
    assert.ok(r.ok, JSON.stringify(r));
    assert.deepEqual(await transitionCashReceipt(r.id, "post", actor), { ok: true });
    const parts = await prisma.finCashBankTxLine.findMany({ where: { doc_id: f.bill3, tx: { status: "Posted" } } });
    assert.equal(parts.reduce((a, l) => a + l.ppn_part.toNumber(), 0), 99_000, "the PPN parts add up to the bill's");
    assert.equal(parts.reduce((a, l) => a + l.dpp_part.toNumber(), 0), 900_000);
  });

  test("two drafts on one bill: the second cannot post once the first has", async () => {
    const a = await create(input());
    const b = await create(input());
    assert.ok(a.ok && b.ok);
    assert.deepEqual(await transitionCashReceipt(a.id, "post", actor), { ok: true });
    const late = await transitionCashReceipt(b.id, "post", actor);
    assert.ok(!late.ok && /Melebihi|Belum bisa diposting/.test(late.errors._form));
    assert.deepEqual(await transitionCashReceipt(b.id, "cancel", actor, "duplikat"), { ok: true });
    assert.equal((await getCashReceipt(b.id))!.status, "Cancelled");
  });
});

describe("posting refuses what it cannot book", () => {
  test("a missing mapping is named", async () => {
    const r = await create(input({ partner_id: f.other, lines: [{ doc_id: f.otherBill, cash: 990_000, withhold: true }] }));
    assert.ok(r.ok);
    await setMapping("output_vat_account", null);
    try {
      const p = await transitionCashReceipt(r.id, "post", actor);
      assert.ok(!p.ok && /PPN Keluaran/.test(p.errors._form));
    } finally {
      await setMapping("output_vat_account", String(f.vatAcc));
    }
  });

  test("the buttons follow the table and the permissions", () => {
    const all = cashReceiptAbilities(["CASH_RECEIPT_POST", "CASH_RECEIPT_CANCEL"]);
    assert.deepEqual(availableCashReceiptActions("Draft", all), ["cancel", "post"]);
    assert.deepEqual(availableCashReceiptActions("Posted", all), []);
    assert.deepEqual(availableCashReceiptActions("Draft", cashReceiptAbilities([])), []);
  });
});
