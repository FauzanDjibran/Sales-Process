import test, { after, before, describe } from "node:test";
import assert from "node:assert/strict";

import {
  checkSalesOrder,
  createSalesOrder,
  getSalesOrder,
  salesOrderOptions,
  transitionSalesOrder,
  updateSalesOrder,
  type SalesOrderHeaderInput,
  type SalesOrderLineInput,
} from "../src/lib/erp/sales-order";
import { checkPartnerCollections, partnerCollections } from "../src/lib/erp/partner";
import { ADDRESSES_KEY, CONTACTS_KEY } from "../src/lib/erp/partner-shape";
import {
  availableSalesOrderActions,
  salesOrderAbilities,
} from "../src/lib/erp/sales-order-workflow";
import { FIXTURE_PREFIX, cleanupFixtures, disconnect, makePartner, prisma, systemUserId } from "./helpers";

/**
 * The Sales Order (P49–P53, P63): what may be saved, how it is numbered, how
 * it moves Draft → Diajukan → Open → Ditutup (or Dibatalkan / Ditolak), and
 * that it protects the address it names. It posts nothing, which the journal
 * count proves.
 */

let actor = 0;
const f = {} as Record<string, number>;
const orders: number[] = [];
const cleanups: (() => Promise<unknown>)[] = [];
const stamp = String(Date.now() % 100000);
const key = (s: string) => `${FIXTURE_PREFIX}${s}${stamp}`;

async function fixtureCustomer(complete: boolean) {
  const id = await makePartner({ categoryLabel: "Customer" });
  const village = await prisma.sysRegionVillage.findFirstOrThrow({ orderBy: { code: "asc" } });
  if (complete) {
    await prisma.mPartner.update({
      where: { id },
      data: {
        taxpayer_type: "Badan",
        tax_id_type: "NPWP",
        tax_id: "0987654321098765",
        tax_name: "PT FIXTURE",
        is_pkp: true,
        collects_pph22: true,
      },
    });
    await prisma.mPartnerAddress.createMany({
      data: [
        { partner_id: id, village_id: village.id, street: "Kantor", created_by: actor },
        { partner_id: id, village_id: village.id, street: "Gudang", created_by: actor, sort_order: 1 },
      ],
    });
  }
  return id;
}

const header = (over: Partial<SalesOrderHeaderInput> = {}): SalesOrderHeaderInput => ({
  order_date: "2026-09-10",
  customer_id: f.customer,
  address_id: f.address,
  term_id: f.term,
  price_mode: "Exclude",
  is_taxable: true,
  po_no: "",
  po_date: "",
  salesperson: "",
  note: "",
  ...over,
});

const soLine = (over: Partial<SalesOrderLineInput> = {}): SalesOrderLineInput => ({
  item_id: f.goods,
  uom_id: f.box,
  qty: 2,
  price: 1_000_000,
  discount_type: null,
  discount_value: null,
  withholding_tax_id: null,
  note: "",
  ...over,
});

before(async () => {
  actor = await systemUserId();
  const uom = async (l: string) =>
    (await prisma.refUom.create({ data: { uom_code: `test.${key(l)}`, uom_label: key(l), uom_name: l, created_by: actor } })).id;
  f.pcs = await uom("PCS");
  f.box = await uom("BOX");
  f.ctn = await uom("CTN");
  const barangCat = (await prisma.sysItemCategory.findUniqueOrThrow({ where: { category_label: "BRG-JADI" } })).id;
  const jasaCat = (await prisma.sysItemCategory.findUniqueOrThrow({ where: { category_label: "JASA-LAIN" } })).id;
  const item = async (l: string, type: "Barang" | "Jasa", canSell = true) =>
    (
      await prisma.mItem.create({
        data: {
          item_code: `test.${key(l)}`,
          item_label: key(l),
          item_name: l,
          item_type: type,
          category_id: type === "Barang" ? barangCat : jasaCat,
          base_uom_id: f.pcs,
          can_sell: canSell,
          created_by: actor,
        },
      })
    ).id;
  f.goods = await item("GOODS", "Barang");
  f.service = await item("SERVICE", "Jasa");
  f.unsellable = await item("NOSELL", "Barang", false);
  await prisma.mItemUom.create({ data: { item_id: f.goods, uom_id: f.box, factor: 12, created_by: actor } });

  f.term = (await prisma.refPaymentTerm.create({ data: { term_code: `test.${key("T")}`, term_label: key("T"), term_name: "Net 30", due_days: 30, created_by: actor } })).id;
  f.wht = (await prisma.refWithholdingTax.create({ data: { wht_code: `test.${key("WHT")}`, wht_label: key("WHT"), wht_name: "PPh Uji", rate: 1.5, created_by: actor } })).id;

  f.customer = await fixtureCustomer(true);
  f.incomplete = await fixtureCustomer(false);
  f.other = await fixtureCustomer(true);
  const addrs = await prisma.mPartnerAddress.findMany({ where: { partner_id: f.customer }, orderBy: { id: "asc" } });
  f.address = addrs[0].id;
  f.address2 = addrs[1].id;
  f.otherAddress = (await prisma.mPartnerAddress.findFirstOrThrow({ where: { partner_id: f.other } })).id;

  cleanups.push(
    () => prisma.mItemUom.deleteMany({ where: { item_id: { in: [f.goods, f.service, f.unsellable] } } }),
    () => prisma.mItem.deleteMany({ where: { id: { in: [f.goods, f.service, f.unsellable] } } }),
    () => prisma.refUom.deleteMany({ where: { id: { in: [f.pcs, f.box, f.ctn] } } }),
    () => prisma.refPaymentTerm.deleteMany({ where: { id: f.term } }),
    () => prisma.refWithholdingTax.deleteMany({ where: { id: f.wht } })
  );
});

after(async () => {
  await prisma.salOrderLine.deleteMany({ where: { order_id: { in: orders } } });
  await prisma.salOrder.updateMany({ where: { id: { in: orders } }, data: { copied_from_id: null } });
  await prisma.salOrder.deleteMany({ where: { id: { in: orders } } });
  await prisma.auditLog.deleteMany({ where: { entity_key: "sal_order", row_id: { in: orders } } });
  await cleanupFixtures();
  for (const c of cleanups) await c();
  await disconnect();
});

async function create(h = header(), lines = [soLine()]) {
  const r = await createSalesOrder(h, lines, actor);
  if (r.ok) orders.push(r.id);
  return r;
}

// ----------------------------------------------------------------- options

describe("what the form offers", () => {
  test("customers carry their problems; only Barang that can be sold are offered", async () => {
    const o = await salesOrderOptions();
    assert.deepEqual(o.customers.find((c) => c.id === f.customer)?.problems, []);
    assert.ok(o.customers.find((c) => c.id === f.incomplete)!.problems.length >= 2);
    const ids = o.items.map((i) => i.id);
    assert.ok(ids.includes(f.goods));
    assert.ok(!ids.includes(f.service), "no Jasa on an SO Barang (P49)");
    assert.ok(!ids.includes(f.unsellable), "only Dapat Dijual");
    const goods = o.items.find((i) => i.id === f.goods)!;
    assert.deepEqual(goods.uoms.map((u) => [u.id, u.factor]), [[f.pcs, 1], [f.box, 12]]);
  });
});

// -------------------------------------------------------------- validation

describe("what may be saved", () => {
  test("a complete order passes, with the tax module's totals", async () => {
    const c = await checkSalesOrder(header(), [soLine()]);
    assert.ok(c.ok);
    assert.equal(c.totals.dpp, 2_000_000);
    assert.equal(c.totals.ppn, 220_000);
    assert.equal(c.lines[0].uom_factor, 12, "the factor is copied onto the line");
  });

  test("the header's required choices and dates", async () => {
    const c = await checkSalesOrder(header({ customer_id: null, term_id: null, po_date: "2026-09-20" }), []);
    assert.ok(!c.ok);
    for (const k of ["customer_id", "term_id", "po_date", "_lines"]) {
      assert.ok(c.errors[k], `${k} is refused`);
    }
  });

  test("an order without PPN has no mode harga: it is stored as Exclude (P63)", async () => {
    const c = await checkSalesOrder(header({ is_taxable: false, price_mode: "Include" }), [soLine()]);
    assert.ok(c.ok);
    assert.equal(c.header.price_mode, "Exclude");
    assert.equal(c.totals.ppn, 0);
    assert.equal(c.totals.total, 2_000_000);
  });

  test("a line without an item asks for one", async () => {
    const c = await checkSalesOrder(header(), [soLine({ item_id: null, uom_id: null })]);
    assert.ok(!c.ok);
    assert.equal(c.errors["lines.0.item_id"], "Pilih barang.");
  });

  test("an incomplete customer and another customer's address are refused", async () => {
    const a = await checkSalesOrder(header({ customer_id: f.incomplete, address_id: null }), [soLine()]);
    assert.ok(!a.ok && /Pajak/.test(a.errors.customer_id));
    const b = await checkSalesOrder(header({ address_id: f.otherAddress }), [soLine()]);
    assert.ok(!b.ok && b.errors.address_id);
  });

  test("a line must be a sellable Barang in one of its own units", async () => {
    const c = await checkSalesOrder(header(), [
      soLine({ item_id: f.service }),
      soLine({ item_id: f.unsellable }),
      soLine({ uom_id: f.ctn }),
      soLine({ qty: 0 }),
    ]);
    assert.ok(!c.ok);
    assert.ok(c.errors["lines.0.item_id"] && c.errors["lines.1.item_id"]);
    assert.ok(c.errors["lines.2.uom_id"]);
    assert.ok(c.errors["lines.3.amount"]);
    assert.ok(c.errors._lines);
  });

  test("a line's Jenis PPh rate is taken from the master at save", async () => {
    const c = await checkSalesOrder(header(), [soLine({ withholding_tax_id: f.wht })]);
    assert.ok(c.ok);
    assert.equal(c.lines[0].withholding_rate, 1.5);
    assert.equal(c.totals.withholdings[0].amount, 30_000);
  });
});

// ---------------------------------------------------------------- lifecycle

describe("an order's life", () => {
  test("numbered in its own month's series", async () => {
    const a = await create();
    const b = await create(header({ order_date: "2026-09-11" }));
    assert.ok(a.ok && b.ok);
    assert.match(a.orderNo, /^SO\/2026\/09\/\d{4}$/);
    assert.equal(Number(b.orderNo.slice(-4)), Number(a.orderNo.slice(-4)) + 1);
  });

  test("a Draft is edited; Ajukan locks it; Setujui opens it; posting nothing", async () => {
    const journals = await prisma.accJournal.count();
    const r = await create();
    assert.ok(r.ok);
    const up = await updateSalesOrder(r.id, header({ price_mode: "Include" }), [soLine({ price: 1_110_000 })], actor);
    assert.ok(up.ok);
    let so = (await getSalesOrder(r.id))!;
    assert.equal(so.totals.total, 2_220_000);
    assert.equal(so.totals.ppn, 220_000);

    assert.deepEqual(await transitionSalesOrder(r.id, "submit", actor), { ok: true });
    so = (await getSalesOrder(r.id))!;
    assert.equal(so.status, "Submitted");
    const again = await updateSalesOrder(r.id, header(), [soLine()], actor);
    assert.ok(!again.ok && again.errors._form, "a submitted order is not edited");
    const cancel = await transitionSalesOrder(r.id, "cancel", actor, "tarik");
    assert.ok(!cancel.ok, "a submitted order is not taken back or cancelled");

    assert.deepEqual(await transitionSalesOrder(r.id, "approve", actor), { ok: true });
    so = (await getSalesOrder(r.id))!;
    assert.equal(so.status, "Open");
    assert.equal(so.totals.total, 2_220_000, "Setujui changes nothing but the status");
    assert.equal(await prisma.accJournal.count(), journals, "a Sales Order posts nothing");

    const events = (await prisma.auditLog.findMany({ where: { entity_key: "sal_order", row_id: r.id }, orderBy: { id: "asc" } })).map((a) => a.event);
    assert.deepEqual(events, ["create", "update", "submit", "approve"]);
  });

  test("an order snapshots the PPN rate and stores each line's figures (P60)", async () => {
    const r = await create(header(), [soLine({ qty: 1, price: 1_000_003 }), soLine({ qty: 1, price: 1_000_003 })]);
    assert.ok(r.ok);
    let so = (await getSalesOrder(r.id))!;
    assert.deepEqual(so.rates, { rate: 12, otherNum: 11, otherDen: 12 });
    assert.equal(so.totals.ppn, 220_000, "per line: 110.000 + 110.000");
    const lines = await prisma.salOrderLine.findMany({ where: { order_id: r.id }, orderBy: { line_no: "asc" } });
    assert.deepEqual(lines.map((l) => [l.dpp_other_amount.toNumber(), l.ppn_amount.toNumber()]), [[916_669, 110_000], [916_669, 110_000]]);

    await prisma.sysSetting.update({ where: { setting_key: "ppn_rate" }, data: { setting_value: "11" } });
    try {
      assert.deepEqual(await transitionSalesOrder(r.id, "submit", actor), { ok: true });
    } finally {
      await prisma.sysSetting.update({ where: { setting_key: "ppn_rate" }, data: { setting_value: "12" } });
    }
    so = (await getSalesOrder(r.id))!;
    assert.equal(so.rates?.rate, 11, "Ajukan froze the rate in force then");
    assert.equal(so.totals.ppn, 2 * 100_834, "11 % × 916.669, per line");
    const confirmed = await prisma.salOrderLine.findMany({ where: { order_id: r.id } });
    assert.ok(confirmed.every((l) => l.ppn_amount.toNumber() === 100_834), "the lines are restated with it");
  });

  test("Batalkan: from Draft only, with a reason, final", async () => {
    const r = await create();
    assert.ok(r.ok);
    const bare = await transitionSalesOrder(r.id, "cancel", actor, "  ");
    assert.ok(!bare.ok && bare.errors.reason);
    assert.deepEqual(await transitionSalesOrder(r.id, "cancel", actor, "Duplikat"), { ok: true });
    const so = (await getSalesOrder(r.id))!;
    assert.equal(so.status, "Cancelled");
    assert.equal(so.statusReason, "Duplikat");
    assert.ok(!(await transitionSalesOrder(r.id, "submit", actor)).ok, "a cancelled order stays cancelled");
  });

  test("Tolak: from Diajukan, with a reason, final", async () => {
    const r = await create();
    assert.ok(r.ok);
    assert.ok(!(await transitionSalesOrder(r.id, "reject", actor, "x")).ok, "a Draft is not rejected");
    assert.deepEqual(await transitionSalesOrder(r.id, "submit", actor), { ok: true });
    const bare = await transitionSalesOrder(r.id, "reject", actor, "");
    assert.ok(!bare.ok && bare.errors.reason);
    assert.deepEqual(await transitionSalesOrder(r.id, "reject", actor, "Harga salah"), { ok: true });
    const so = (await getSalesOrder(r.id))!;
    assert.equal(so.status, "Rejected");
    assert.equal(so.statusReason, "Harga salah");
    assert.ok(!(await transitionSalesOrder(r.id, "approve", actor)).ok, "a rejected order stays rejected");
  });

  test("Tutup Pesanan: from Open, with a reason, final", async () => {
    const r = await create();
    assert.ok(r.ok);
    assert.ok(!(await transitionSalesOrder(r.id, "close", actor, "x")).ok, "a Draft is not closed");
    await transitionSalesOrder(r.id, "submit", actor);
    await transitionSalesOrder(r.id, "approve", actor);
    assert.ok(!(await transitionSalesOrder(r.id, "close", actor, " ")).ok, "a reason is required");
    assert.deepEqual(await transitionSalesOrder(r.id, "close", actor, "Sisa tidak jadi dikirim"), { ok: true });
    const so = (await getSalesOrder(r.id))!;
    assert.equal(so.status, "Closed");
    assert.equal(so.statusReason, "Sisa tidak jadi dikirim");
    const events = (await prisma.auditLog.findMany({ where: { entity_key: "sal_order", row_id: r.id }, orderBy: { id: "asc" } })).map((a) => a.event);
    assert.deepEqual(events, ["create", "submit", "approve", "close"]);
  });

  test("Ajukan re-checks the masters", async () => {
    const r = await create();
    assert.ok(r.ok);
    await prisma.mItem.update({ where: { id: f.goods }, data: { status: "Inactive" } });
    try {
      const c = await transitionSalesOrder(r.id, "submit", actor);
      assert.ok(!c.ok && /nonaktif/.test(c.errors._form));
    } finally {
      await prisma.mItem.update({ where: { id: f.goods }, data: { status: "Active" } });
    }
  });

  test("the buttons offered follow the table and the permissions", () => {
    const all = salesOrderAbilities([
      "SALES_ORDER_SUBMIT",
      "SALES_ORDER_APPROVE",
      "SALES_ORDER_CANCEL",
      "SALES_ORDER_CLOSE",
    ]);
    assert.deepEqual(availableSalesOrderActions("Draft", all), ["cancel", "submit"]);
    assert.deepEqual(availableSalesOrderActions("Submitted", all), ["reject", "approve"]);
    assert.deepEqual(availableSalesOrderActions("Open", all), ["close"]);
    for (const final of ["Closed", "Cancelled", "Rejected"] as const) {
      assert.deepEqual(availableSalesOrderActions(final, all), []);
    }
    assert.deepEqual(
      availableSalesOrderActions("Submitted", salesOrderAbilities(["SALES_ORDER_SUBMIT"])),
      [],
      "only the approve permission sees Setujui / Tolak"
    );
    assert.deepEqual(availableSalesOrderActions("Draft", salesOrderAbilities([])), []);
  });
});
// ------------------------------------------------------------- protection

describe("an address a Sales Order names is protected (P53)", () => {
  test("it cannot be removed from the Partner; another one can", async () => {
    const r = await create(header({ address_id: f.address }));
    assert.ok(r.ok);
    const { addresses } = await partnerCollections(f.customer);
    const keepOnly = (id: number) => ({
      [ADDRESSES_KEY]: JSON.stringify(addresses.filter((a) => a.id === id)),
      [CONTACTS_KEY]: "[]",
    });
    const dropUsed = await checkPartnerCollections(keepOnly(f.address2), f.customer);
    assert.match(dropUsed.errors[ADDRESSES_KEY] ?? "", /dipakai Sales Order/);
    const dropUnused = await checkPartnerCollections(keepOnly(f.address), f.customer);
    assert.deepEqual(dropUnused.errors, {});
  });
});
