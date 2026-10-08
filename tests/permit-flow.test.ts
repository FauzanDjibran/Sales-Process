import test, { after, before, describe } from "node:test";
import assert from "node:assert/strict";

import { createCashReceipt, transitionCashReceipt, type CashReceiptInput } from "../src/lib/erp/cash-bank-tx";
import { createCashPayment, permitCostPayments, transitionCashPayment } from "../src/lib/erp/cash-payment";
import {
  createPermitRequest,
  saveRealization,
  transitionPermitRequest,
} from "../src/lib/erp/permit-request";
import { createPermitAdvance, liveAdvanceRefusal, transitionPermitAdvance } from "../src/lib/erp/permit-advance";
import { createTaxDocsForPermitInvoice, createTaxDocsForReceipt } from "../src/lib/erp/tax-document";
import { createPermitInvoice, transitionPermitInvoice } from "../src/lib/erp/permit-invoice";
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
 * The Perizinan flow through the books (P137, Perizinan-Concept.md §7–§10):
 * Uang Muka Perizinan drawn from an approved Pengajuan's estimate, paid by the
 * same Penerimaan dari Customer as a goods bill — Cr Uang Muka Perizinan, an
 * Uang Muka item scoped to the Pengajuan, a one-line Faktur Uang Muka.
 */

let actor = 0;
const f = {} as Record<string, number>;
const requests: number[] = [];
const advances: number[] = [];
const receipts: number[] = [];
const invoices: number[] = [];
const savedSettings = new Map<string, string | null>();
const stamp = String(Date.now() % 100000);
const key = (s: string) => `${FIXTURE_PREFIX}${s}${stamp}`;
const today = new Date().toISOString().slice(0, 10);

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

/** An approved Pengajuan: 500.000 + 100.000 + 200.000 Exclude, PPh 23 2 %. */
async function approvedRequest() {
  const r = await createPermitRequest(
    {
      request_date: today,
      customer_id: f.customer,
      address_id: f.address,
      term_id: f.term,
      price_mode: "Exclude",
      is_taxable: true,
      withholding_tax_id: f.wht,
      po_no: "PO-PRZ",
      po_date: "",
      salesperson: "",
      product_name: "Serum Uji",
      note: "",
    },
    [
      { permit_type_id: f.pre, description: "", estimate_price: 500_000 },
      { permit_type_id: f.bpom, description: "", estimate_price: 100_000 },
      { permit_type_id: f.stab, description: "", estimate_price: 200_000 },
    ],
    actor
  );
  assert.ok(r.ok, JSON.stringify(r));
  requests.push(r.id);
  assert.ok((await transitionPermitRequest(r.id, "submit", actor)).ok);
  assert.ok((await transitionPermitRequest(r.id, "approve", actor)).ok);
  return r.id;
}

before(async () => {
  actor = await systemUserId();
  await openFiscalYear();
  const sub = async (label: string) =>
    (await prisma.accAccountSubcategory.findFirstOrThrow({ where: { subcategory_label: { startsWith: label } }, orderBy: { id: "asc" } })).subcategory_label;
  f.pphAcc = await makeAccount({ subcategoryLabel: await sub("1") });
  f.permitAdvAcc = await makeAccount({ subcategoryLabel: await sub("2"), normalBalance: "Kredit", partnerCategoryLabel: "Customer" });
  f.vatAcc = await makeAccount({ subcategoryLabel: await sub("2"), normalBalance: "Kredit" });
  await setMapping("permit_advance_account", String(f.permitAdvAcc));
  await setMapping("output_vat_account", String(f.vatAcc));
  f.costAcc = await makeAccount({ subcategoryLabel: await sub("5") });
  await setMapping("permit_cost_account", String(f.costAcc));
  f.arAcc = await makeAccount({ subcategoryLabel: await sub("1"), partnerCategoryLabel: "Customer" });
  f.revAcc = await makeAccount({ subcategoryLabel: await sub("4"), normalBalance: "Kredit" });
  await setMapping("receivable_account", String(f.arAcc));
  await setMapping("permit_revenue_account", String(f.revAcc));

  const currency = (await prisma.refCurrency.findFirstOrThrow({ where: { currency_label: "IDR" } })).id;
  f.bankAcc = await makeAccount({ subcategoryLabel: CASH_BANK_SUBCATEGORY });
  f.bank = (
    await prisma.mCashBank.create({
      data: { cash_bank_code: `test.${key("B")}`, cash_bank_label: key("B"), cash_bank_name: "Bank", cash_bank_type: "Bank", currency_id: currency, account_id: f.bankAcc, created_by: actor },
    })
  ).id;

  f.customer = await makePartner({ categoryLabel: "Customer" });
  await prisma.mPartner.update({
    where: { id: f.customer },
    data: { taxpayer_type: "Badan", tax_id_type: "NPWP", tax_id: "0987654321098765", tax_name: "PT FIXTURE", is_pkp: true },
  });
  const village = await prisma.sysRegionVillage.findFirstOrThrow({ orderBy: { code: "asc" } });
  f.address = (await prisma.mPartnerAddress.create({ data: { partner_id: f.customer, village_id: village.id, street: "Kantor", created_by: actor } })).id;
  f.term = (await prisma.refPaymentTerm.create({ data: { term_code: `test.${key("T")}`, term_label: key("T"), term_name: "Net 7", due_days: 7, created_by: actor } })).id;
  f.wht = (await prisma.refWithholdingTax.create({ data: { wht_code: `test.${key("W")}`, wht_label: key("W"), wht_name: "PPh 23 Uji", rate: 2, account_id: f.pphAcc, created_by: actor } })).id;
  const type = async (l: string) =>
    (await prisma.refPermitType.create({ data: { permit_code: `test.${key(l)}`, permit_label: key(l), permit_name: l, category: "Regulatory", created_by: actor } })).id;
  f.pre = await type("PRE");
  f.bpom = await type("BPOM");
  f.stab = await type("STAB");
  f.micro = await type("MICRO");
});

after(async () => {
  if (invoices.length) {
    const invType = (await prisma.sysDocType.findFirstOrThrow({ where: { doc_table: "fin_ar_permit_invoice" } })).id;
    const fk = await prisma.taxFaktur.findMany({ where: { source_doc_type_id: invType, source_doc_id: { in: invoices } }, select: { id: true } });
    await prisma.taxFakturRef.deleteMany({ where: { faktur_id: { in: fk.map((x) => x.id) } } });
    await prisma.taxFakturLine.deleteMany({ where: { faktur_id: { in: fk.map((x) => x.id) } } });
    await prisma.taxFaktur.deleteMany({ where: { id: { in: fk.map((x) => x.id) } } });
    const items = await prisma.finArItem.findMany({ where: { source_doc_type_id: invType, source_doc_id: { in: invoices } }, select: { id: true } });
    const ids = items.map((i) => i.id);
    await prisma.finArLedger.deleteMany({ where: { OR: [{ item_id: { in: ids } }, { counter_item_id: { in: ids } }, { doc_type_id: invType, doc_id: { in: invoices } }] } });
    await prisma.finArItem.deleteMany({ where: { id: { in: ids } } });
    await prisma.finArPermitInvoice.deleteMany({ where: { id: { in: invoices } } });
    await prisma.auditLog.deleteMany({ where: { entity_key: "fin_ar_permit_invoice", row_id: { in: invoices } } });
  }
  if (receipts.length) {
    const receiptType = (await prisma.sysDocType.findFirstOrThrow({ where: { doc_table: "fin_cash_bank_tx" } })).id;
    const fk = await prisma.taxFaktur.findMany({ where: { source_doc_type_id: receiptType, source_doc_id: { in: receipts } }, select: { id: true } });
    await prisma.taxFakturLine.deleteMany({ where: { faktur_id: { in: fk.map((x) => x.id) } } });
    await prisma.taxFaktur.deleteMany({ where: { id: { in: fk.map((x) => x.id) } } });
    await prisma.taxWithholdingSlip.deleteMany({ where: { receipt_id: { in: receipts } } });
    await prisma.auditLog.deleteMany({ where: { entity_key: { in: ["tax_faktur", "tax_withholding_slip"] }, row_id: { in: fk.map((x) => x.id) } } });
    const items = await prisma.finArItem.findMany({
      where: { entries: { some: { event: "Create", doc_id: { in: receipts }, doc_type: { doc_table: "fin_cash_bank_tx" } } } },
      select: { id: true },
    });
    await prisma.finArLedger.deleteMany({ where: { item_id: { in: items.map((i) => i.id) } } });
    await prisma.finArItem.deleteMany({ where: { id: { in: items.map((i) => i.id) } } });
    await prisma.finCashBankTx.deleteMany({ where: { id: { in: receipts } } });
  }
  await prisma.auditLog.deleteMany({ where: { entity_key: "fin_cash_bank_tx", row_id: { in: receipts } } });
  await prisma.finArPermitAdvance.deleteMany({ where: { id: { in: advances } } });
  await prisma.auditLog.deleteMany({ where: { entity_key: "fin_ar_permit_advance", row_id: { in: advances } } });
  await prisma.salPermitRequestLine.deleteMany({ where: { request_id: { in: requests } } });
  await prisma.salPermitRequest.deleteMany({ where: { id: { in: requests } } });
  await prisma.auditLog.deleteMany({ where: { entity_key: "sal_permit_request", row_id: { in: requests } } });
  for (const [k, v] of savedSettings) await prisma.sysSetting.update({ where: { setting_key: k }, data: { setting_value: v } });
  await prisma.refPermitType.deleteMany({ where: { id: { in: [f.pre, f.bpom, f.stab, f.micro] } } });
  if (f.wht) await prisma.refWithholdingTax.delete({ where: { id: f.wht } });
  await prisma.refPaymentTerm.deleteMany({ where: { id: f.term } });
  await cleanupFixtures();
  await cleanupFiscalYear();
  await disconnect();
});

describe("Uang Muka Perizinan", () => {
  test("drawn from the estimate, paid through Penerimaan dari Customer, into Uang Muka Perizinan", async () => {
    const requestId = await approvedRequest();
    // In full by default (Z11): 100 % of the 800.000 estimate, PPN 88.000, PPh 23 16.000.
    const a = await createPermitAdvance(
      { order_id: requestId, advance_date: today, due_date: today, cash_bank_id: f.bank, description: "UM perizinan", note: "", amount_type: "Percent", amount_value: 100 },
      actor
    );
    assert.ok(a.ok, JSON.stringify(a));
    advances.push(a.id);
    assert.match(a.advanceNo, /^UMP\/\d{4}\/\d{2}\/\d{4}$/);
    const over = await createPermitAdvance(
      { order_id: requestId, advance_date: today, due_date: today, cash_bank_id: f.bank, description: "x", note: "", amount_type: "Amount", amount_value: 1 },
      actor
    );
    assert.ok(!over.ok && over.errors.amount_value, "the live bills never exceed the estimate");
    assert.deepEqual(await transitionPermitAdvance(a.id, "issue", actor), { ok: true });

    // The Pengajuan cannot be cancelled while the bill is live (Z6).
    assert.match((await prisma.$transaction((tx) => liveAdvanceRefusal(tx, requestId))) ?? "", /Uang Muka Perizinan/);

    // 888.000 − 16.000 PPh received.
    const input: CashReceiptInput = {
      purpose: "customer_receipt",
      tx_date: today,
      partner_id: f.customer,
      cash_bank_id: f.bank,
      bank_ref: "",
      note: "",
      bank_charge: 0,
      lines: [{ doc_type: "fin_ar_permit_advance", doc_id: a.id, cash: 872_000, withhold: true }],
    };
    const rc = await createCashReceipt(input, actor);
    assert.ok(rc.ok, JSON.stringify(rc));
    receipts.push(rc.id);
    const posted = await transitionCashReceipt(rc.id, "post", actor, undefined, (tx) => createTaxDocsForReceipt(tx, rc.id, actor));
    assert.deepEqual(posted, { ok: true });

    const tx = await prisma.finCashBankTx.findUniqueOrThrow({ where: { id: rc.id }, include: { journal: { include: { lines: true } } } });
    const by = (acc: number) => tx.journal!.lines.filter((l) => l.account_id === acc);
    assert.equal(by(f.permitAdvAcc)[0].kredit_amount.toNumber(), 800_000, "Cr Uang Muka Perizinan, the DPP part");
    assert.equal(by(f.vatAcc)[0].kredit_amount.toNumber(), 88_000);
    assert.equal(by(f.pphAcc)[0].debit_amount.toNumber(), 16_000);
    assert.equal(by(f.bankAcc)[0].debit_amount.toNumber(), 872_000);

    const bill = await prisma.finArPermitAdvance.findUniqueOrThrow({ where: { id: a.id } });
    assert.equal(bill.paid_amount.toNumber(), 888_000);
    const item = await prisma.finArItem.findFirstOrThrow({
      where: { source_doc_type: { doc_table: "fin_ar_permit_advance" }, source_doc_id: a.id },
      include: { scope_doc_type: true },
    });
    assert.deepEqual([item.item_type, item.current_balance.toNumber(), item.scope_doc_type?.doc_table, item.scope_doc_id], ["Advance", 800_000, "sal_permit_request", requestId]);
    const faktur = await prisma.taxFaktur.findFirstOrThrow({ where: { ar_item_id: item.id }, include: { lines: true } });
    assert.deepEqual([faktur.kind, faktur.dpp.toNumber(), faktur.ppn.toNumber(), faktur.lines.length, faktur.scope_doc_id], ["Advance", 800_000, 88_000, 1, requestId]);
    assert.equal(faktur.lines[0].item_label, null, "one description line, no item (Z1)");
  });

  test("Biaya Perizinan: the realised DPP paid as a lump, no tax, and the realisation then fixed (Z12–Z14, Z8)", async () => {
    const id = await approvedRequest();
    const lines = [
      { permit_type_id: f.pre, description: "", realized_price: 400_000, is_added: false },
      { permit_type_id: f.bpom, description: "", realized_price: 100_000, is_added: false },
      { permit_type_id: f.stab, description: "", realized_price: 200_000, is_added: false },
    ];
    assert.ok((await saveRealization(id, { realization_date: today, realization_note: "", lines }, actor)).ok);
    const pay = (cash: number) =>
      createCashPayment(
        {
          purpose: "permit_cost",
          tx_date: today,
          partner_id: f.customer,
          cash_bank_id: f.bank,
          bank_ref: "BPOM",
          note: "",
          bank_charge: 0,
          lines: [{ doc_type: "sal_permit_request", doc_id: id, cash, withhold: false }],
        },
        actor
      );
    const early = await pay(100_000);
    assert.ok(!early.ok, "only a realised Pengajuan's cost is paid");

    assert.ok((await transitionPermitRequest(id, "realize", actor)).ok);
    assert.ok(!(await pay(700_001)).ok, "never beyond the realised DPP");
    const p = await pay(300_000);
    assert.ok(p.ok, JSON.stringify(p));
    receipts.push(p.id);
    assert.deepEqual(await transitionCashPayment(p.id, "post", actor), { ok: true });

    const tx = await prisma.finCashBankTx.findUniqueOrThrow({ where: { id: p.id }, include: { journal: { include: { lines: true } } } });
    const lineOf = (acc: number) => tx.journal!.lines.find((l) => l.account_id === acc)!;
    assert.equal(lineOf(f.costAcc).debit_amount.toNumber(), 300_000, "Dr Biaya Perizinan");
    assert.equal(lineOf(f.bankAcc).kredit_amount.toNumber(), 300_000);
    assert.equal(tx.journal!.lines.length, 2, "no tax");
    const req = await prisma.salPermitRequest.findUniqueOrThrow({ where: { id } });
    assert.equal(req.cost_paid_amount.toNumber(), 300_000);

    // Paid in part: the realisation is now fixed (Z8).
    const guard = async (t: Parameters<Parameters<typeof prisma.$transaction>[0]>[0], rid: number) =>
      (await permitCostPayments(rid, t)).length ? "dibayar" : null;
    const changed = await saveRealization(id, { realization_date: today, realization_note: "", lines }, actor, guard);
    assert.ok(!changed.ok && changed.errors._form === "dibayar");
  });

  test("Invoice Perizinan: the simulation's scenario 2 — realised above the estimate, net of the advance, paid (Z15–Z18)", async () => {
    const id = await approvedRequest();
    const a = await createPermitAdvance(
      { order_id: id, advance_date: today, due_date: today, cash_bank_id: f.bank, description: "UM", note: "", amount_type: "Percent", amount_value: 100 },
      actor
    );
    assert.ok(a.ok);
    advances.push(a.id);
    await transitionPermitAdvance(a.id, "issue", actor);
    const rc = await createCashReceipt(
      { purpose: "customer_receipt", tx_date: today, partner_id: f.customer, cash_bank_id: f.bank, bank_ref: "", note: "", bank_charge: 0, lines: [{ doc_type: "fin_ar_permit_advance", doc_id: a.id, cash: 872_000, withhold: true }] },
      actor
    );
    assert.ok(rc.ok);
    receipts.push(rc.id);
    assert.deepEqual(await transitionCashReceipt(rc.id, "post", actor, undefined, (tx) => createTaxDocsForReceipt(tx, rc.id, actor)), { ok: true });

    // 550.000 + 100.000 + 180.000, and a microbiology test added at 150.000 = 980.000.
    const lines = [
      { permit_type_id: f.pre, description: "", realized_price: 550_000, is_added: false },
      { permit_type_id: f.bpom, description: "", realized_price: 100_000, is_added: false },
      { permit_type_id: f.stab, description: "", realized_price: 180_000, is_added: false },
      { permit_type_id: f.micro, description: "Uji mikro", realized_price: 150_000, is_added: true },
    ];
    assert.ok((await saveRealization(id, { realization_date: today, realization_note: "", lines }, actor)).ok);
    assert.ok((await transitionPermitRequest(id, "realize", actor)).ok);

    const item = await prisma.finArItem.findFirstOrThrow({ where: { source_doc_type: { doc_table: "fin_ar_permit_advance" }, source_doc_id: a.id } });
    const inv = await createPermitInvoice(
      { permit_request_id: id, invoice_date: today, address_id: f.address, cash_bank_id: f.bank, description: "Jasa pengurusan perizinan — Serum Uji", note: "" },
      [{ ar_item_id: item.id, dpp_used: 800_000 }],
      actor
    );
    assert.ok(inv.ok, JSON.stringify(inv));
    invoices.push(inv.id);
    assert.match(inv.invoiceNo, /^INP\/\d{4}\/\d{2}\/\d{4}$/);
    const second = await createPermitInvoice(
      { permit_request_id: id, invoice_date: today, address_id: f.address, cash_bank_id: f.bank, description: "x", note: "" },
      [],
      actor
    );
    assert.ok(!second.ok && second.errors.permit_request_id, "one live invoice per Pengajuan");

    assert.deepEqual(await transitionPermitInvoice(inv.id, "post", actor, undefined, (tx) => createTaxDocsForPermitInvoice(tx, inv.id, actor)), { ok: true });
    const v = await prisma.finArPermitInvoice.findUniqueOrThrow({ where: { id: inv.id } });
    // DPP 980.000: full PPN 107.800; the advance's 88.000 deducted; net DPP 180.000.
    assert.deepEqual(
      [v.dpp_amount, v.advance_dpp_amount, v.full_ppn_amount, v.advance_ppn_amount, v.ppn_amount, v.total_amount].map((x) => x.toNumber()),
      [980_000, 800_000, 107_800, 88_000, 19_800, 199_800]
    );
    const j = await prisma.accJournal.findUniqueOrThrow({ where: { id: v.journal_id! }, include: { lines: true } });
    const sum = (acc: number, side: "debit_amount" | "kredit_amount") => j.lines.filter((l) => l.account_id === acc).reduce((x, l) => x + l[side].toNumber(), 0);
    assert.equal(sum(f.revAcc, "kredit_amount"), 980_000, "Cr Pendapatan Perizinan, the full DPP");
    assert.equal(sum(f.permitAdvAcc, "debit_amount"), 800_000, "Dr Uang Muka Perizinan");
    assert.equal(sum(f.arAcc, "debit_amount") - sum(f.arAcc, "kredit_amount"), 199_800, "Piutang nets to the invoice total");
    assert.equal(sum(f.vatAcc, "kredit_amount") - sum(f.vatAcc, "debit_amount"), 19_800);

    const invItem = await prisma.finArItem.findUniqueOrThrow({ where: { id: v.ar_item_id! }, include: { scope_doc_type: true } });
    assert.deepEqual([invItem.original_amount.toNumber(), invItem.current_balance.toNumber(), invItem.scope_doc_type?.doc_table], [1_087_800, 199_800, "sal_permit_request"]);
    assert.equal((await prisma.finArItem.findUniqueOrThrow({ where: { id: item.id } })).current_balance.toNumber(), 0, "the Uang Muka used up");
    assert.equal((await prisma.salPermitRequest.findUniqueOrThrow({ where: { id } })).status, "Done", "the Pengajuan is Selesai");
    const faktur = await prisma.taxFaktur.findFirstOrThrow({ where: { source_doc_id: inv.id, kind: { in: ["Settlement", "Normal"] }, scope_doc_id: id }, include: { lines: true, refs: true } });
    assert.deepEqual([faktur.kind, faktur.lines.length, faktur.lines[0].item_label, faktur.ppn.toNumber(), faktur.refs.length], ["Settlement", 1, null, 19_800, 1]);

    // Paid by the same Penerimaan: 199.800 less PPh 23 2 % × 180.000 = 196.200.
    const pay = await createCashReceipt(
      { purpose: "customer_receipt", tx_date: today, partner_id: f.customer, cash_bank_id: f.bank, bank_ref: "", note: "", bank_charge: 0, lines: [{ doc_type: "fin_ar_permit_invoice", doc_id: inv.id, cash: 196_200, withhold: true }] },
      actor
    );
    assert.ok(pay.ok, JSON.stringify(pay));
    receipts.push(pay.id);
    assert.deepEqual(await transitionCashReceipt(pay.id, "post", actor, undefined, (tx) => createTaxDocsForReceipt(tx, pay.id, actor)), { ok: true });
    assert.equal((await prisma.finArPermitInvoice.findUniqueOrThrow({ where: { id: inv.id } })).paid_amount.toNumber(), 199_800);
    assert.equal((await prisma.finArItem.findUniqueOrThrow({ where: { id: invItem.id } })).current_balance.toNumber(), 0);
  });

  test("a realised Pengajuan still takes an advance; a Draft one does not", async () => {
    const id = await approvedRequest();
    const lines = [
      { permit_type_id: f.pre, description: "", realized_price: 400_000, is_added: false },
      { permit_type_id: f.bpom, description: "", realized_price: 100_000, is_added: false },
      { permit_type_id: f.stab, description: "", realized_price: 200_000, is_added: false },
    ];
    assert.ok((await saveRealization(id, { realization_date: today, realization_note: "", lines }, actor)).ok);
    assert.ok((await transitionPermitRequest(id, "realize", actor)).ok);
    const a = await createPermitAdvance(
      { order_id: id, advance_date: today, due_date: today, cash_bank_id: f.bank, description: "UM", note: "", amount_type: "Percent", amount_value: 50 },
      actor
    );
    assert.ok(a.ok, JSON.stringify(a));
    advances.push(a.id);
  });
});
