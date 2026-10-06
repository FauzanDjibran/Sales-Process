import test, { after, before, describe } from "node:test";
import assert from "node:assert/strict";

import {
  createPurchaseAdvance,
  getPurchaseAdvance,
  purchaseAdvanceOptions,
  settlementAdvances,
  transitionPurchaseAdvance,
  updatePurchaseAdvance,
  type PurchaseAdvanceInput,
} from "../src/lib/erp/ap-advance";
import { availablePurchaseAdvanceActions, purchaseAdvanceAbilities } from "../src/lib/erp/ap-advance-workflow";
import { disconnect, prisma } from "./helpers";
import { purchasingWorld, type PurchasingWorld } from "./purchasing-helpers";

/**
 * Uang Muka Pembelian (P126, B23): the AR bill mirrored — from one Open PO,
 * % or Nominal in the PO's price mode, capped by the PO's value, Draft →
 * Catat → Diterbitkan, Batalkan with a reason, posting nothing.
 */

const today = new Date().toISOString().slice(0, 10);
let w: PurchasingWorld;
const bills: number[] = [];

const input = (order: number, over: Partial<PurchaseAdvanceInput> = {}): PurchaseAdvanceInput => ({
  order_id: order,
  advance_date: today,
  due_date: today,
  supplier_ref_no: "PRO-001",
  description: "Uang muka",
  note: "",
  amount_type: "Percent",
  amount_value: 30,
  ...over,
});

before(async () => {
  w = await purchasingWorld("APA");
});

after(async () => {
  await prisma.finApAdvance.deleteMany({ where: { id: { in: bills } } });
  await prisma.auditLog.deleteMany({ where: { entity_key: "fin_ap_advance", row_id: { in: bills } } });
  await w.teardown();
  await disconnect();
});

describe("the AP advance bill", () => {
  test("drawn from an Open PO, in its price mode; PPN follows; the PO's value caps it", async () => {
    const po = await w.openPO([{ item: w.f.stock, qty: 10, price: 100_000, wht: w.f.wht }]);
    assert.ok((await purchaseAdvanceOptions()).orders.some((o) => o.id === po.id));
    const r = await createPurchaseAdvance(input(po.id), w.actor);
    assert.ok(r.ok, JSON.stringify(r));
    bills.push(r.id);
    assert.match(r.advanceNo, /^APA\/\d{4}\/\d{2}\/\d{4}$/);
    const v = (await getPurchaseAdvance(r.id))!;
    assert.equal(v.figures.dpp, 300_000);
    assert.equal(v.figures.ppn, 33_000, "the chain on 300.000: 11/12 then 12 %");
    assert.equal(v.input.supplier_ref_no, "PRO-001");

    const over = await createPurchaseAdvance(input(po.id, { amount_value: 80 }), w.actor);
    assert.ok(!over.ok && over.errors.amount_value, "30 % already drawn leaves 70 %");

    assert.deepEqual(await transitionPurchaseAdvance(r.id, "issue", w.actor), { ok: true });
    assert.ok(!(await updatePurchaseAdvance(r.id, input(po.id), w.actor)).ok, "a recorded bill is locked");
    const [s] = await settlementAdvances({ ids: [r.id] });
    assert.equal(s.supplierId, w.f.supplier);
    assert.deepEqual(s.withholdings.map((x) => [x.rate, x.base, x.amount]), [[2, 300_000, 6_000]], "PPh on the advance's DPP");

    assert.deepEqual(await transitionPurchaseAdvance(r.id, "cancel", w.actor), { ok: false, errors: { reason: "Alasan pembatalan wajib diisi." } });
    assert.deepEqual(await transitionPurchaseAdvance(r.id, "cancel", w.actor, "batal"), { ok: true });
  });

  test("a PO without PPN is numbered APA-NP; PPh is doubled for a supplier without an NPWP", async () => {
    const po = await w.openPO([{ item: w.f.plain, qty: 1, price: 1_000_000, wht: w.f.wht }], { taxable: false, supplier: w.f.noNpwp });
    const r = await createPurchaseAdvance(input(po.id, { amount_type: "Amount", amount_value: 500_000 }), w.actor);
    assert.ok(r.ok, JSON.stringify(r));
    bills.push(r.id);
    assert.match(r.advanceNo, /^APA-NP\//);
    await transitionPurchaseAdvance(r.id, "issue", w.actor);
    const [s] = await settlementAdvances({ ids: [r.id] });
    assert.equal(s.ppn, 0);
    assert.deepEqual(s.withholdings.map((x) => x.amount), [20_000], "4 % of 500.000");
  });

  test("Catat and Batalkan are separate permissions", () => {
    assert.deepEqual(availablePurchaseAdvanceActions("Draft", purchaseAdvanceAbilities(["PURCHASE_ADVANCE_ISSUE"])), ["issue"]);
    assert.deepEqual(availablePurchaseAdvanceActions("Issued", purchaseAdvanceAbilities(["PURCHASE_ADVANCE_CANCEL"])), ["cancel"]);
  });
});
