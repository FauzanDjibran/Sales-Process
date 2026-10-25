import test, { after, before, describe } from "node:test";
import assert from "node:assert/strict";

import {
  checkHandover,
  createHandover,
  getHandover,
  handoversOfOrder,
  openHandoversRefusal,
  transitionHandover,
  updateHandover,
  type HandoverHeaderInput,
  type HandoverLineInput,
} from "../src/lib/erp/production-handover";
import { availableHandoverActions, handoverAbilities } from "../src/lib/erp/production-handover-workflow";
import { enterProduction } from "../src/lib/erp/production-ledger";
import {
  FIXTURE_PREFIX,
  cleanupFiscalYear,
  cleanupFixtures,
  cleanupStock,
  disconnect,
  openFiscalYear,
  prisma,
  productionCostCenterId,
  stockIn,
  systemUserId,
} from "./helpers";

/**
 * The hand-over between workstations (Walet step 4, P167, M113, AD1): goods in
 * production go from one station to the next, in transit until the receiving
 * station takes the whole sending or sends it whole back. The first hand-over of
 * goods with no Partai starts one for a Perintah and boxes them into Jobs (a lot
 * may be split over boxes); a Partai afterwards goes whole, Jobs kept; goods in
 * transit cannot be handed on again; nothing changes value and no journal is
 * written.
 */

const today = new Date().toISOString().slice(0, 10);
const day = new Date(`${today}T00:00:00Z`);
let actor = 0;
const f = {} as Record<string, number>;
const ids: number[] = [];
const items: number[] = [];
const stamp = String(Date.now() % 100000);
const key = (s: string) => `${FIXTURE_PREFIX}${s}${stamp}`;

const header = (over: Partial<HandoverHeaderInput> = {}): HandoverHeaderInput => ({
  from_workstation_id: f.wsA,
  to_workstation_id: f.wsB,
  handover_date: today,
  order_id: f.order,
  note: "",
  ...over,
});
const line = (bucket: number, qty: number | string, box: number | null = null): HandoverLineInput => ({ bucket_id: bucket, qty, box_no: box });

async function create(h: HandoverHeaderInput, lines: HandoverLineInput[]) {
  const r = await createHandover(h, lines, actor);
  if (r.ok) ids.push(r.id);
  return r;
}

/** Goods already at a station, received, no Partai (as a received Logistik BSTB leaves them). */
let fakeDoc = 900_000 + (Date.now() % 90_000);
async function atStation(itemId: number, lotId: number, ws: number, qty: number, value: number): Promise<number> {
  const docTypeId = (await prisma.sysDocType.findFirstOrThrow({ where: { doc_table: "prd_handover" } })).id;
  return prisma.$transaction(async (tx) => {
    const r = await enterProduction(tx, { lotId, itemId, workstationId: ws, baseQty: qty, value, date: day, source: { docTypeId, docId: fakeDoc++, no: "TEST" }, actorId: actor });
    return r.bucketId;
  });
}

const buckets = (where: Record<string, unknown>) => prisma.prdBalance.findMany({ where: { item_id: f.itemA, ...where }, orderBy: { id: "asc" } });

before(async () => {
  actor = await systemUserId();
  await openFiscalYear();
  const cc = await productionCostCenterId();
  f.kg = (await prisma.refUom.create({ data: { uom_code: `test.${key("G")}`, uom_label: key("G"), uom_name: "Gram", created_by: actor } })).id;
  f.cat = (await prisma.sysItemCategory.findUniqueOrThrow({ where: { category_label: "BHN-BAKU" } })).id;
  const item = async (l: string) => {
    const id = (
      await prisma.mItem.create({
        data: { item_code: `test.${key(l)}`, item_label: key(l), item_name: l, item_type: "Barang", category_id: f.cat, base_uom_id: f.kg, track_stock: true, created_by: actor },
      })
    ).id;
    items.push(id);
    return id;
  };
  f.itemA = await item("A");
  f.warehouse = (await prisma.refWarehouse.create({ data: { warehouse_code: `test.${key("WH")}`, warehouse_label: key("WH"), warehouse_name: "Gudang", created_by: actor } })).id;
  const ws = async (l: string, jobCode: string | null) =>
    (await prisma.refWorkstation.create({ data: { workstation_code: `test.${key(l)}`, workstation_label: key(l), workstation_name: l, cost_center_id: cc, job_code: jobCode, created_by: actor } })).id;
  f.wsA = await ws("WSA", `T${stamp}`); // makes Jobs
  f.wsB = await ws("WSB", null);
  f.wsC = await ws("WSC", null);
  f.itemB = await item("B");
  f.order = (
    await prisma.prdOrder.create({
      data: {
        order_no: `PP_TEST_${stamp}`,
        order_date: day,
        status: "Open",
        target_item_id: f.itemB,
        target_qty: 10,
        created_by: actor,
        steps: { create: [f.wsA, f.wsB, f.wsC].map((w, i) => ({ step_no: i + 1, workstation_id: w })) },
      },
    })
  ).id;
  f.order2 = (
    await prisma.prdOrder.create({
      data: { order_no: `PP_TEST2_${stamp}`, order_date: day, status: "Open", target_item_id: f.itemB, target_qty: 5, created_by: actor, steps: { create: [{ step_no: 1, workstation_id: f.wsB }] } },
    })
  ).id;
  f.order3 = (
    await prisma.prdOrder.create({
      data: {
        order_no: `PP_TEST3_${stamp}`,
        order_date: day,
        status: "Open",
        target_item_id: f.itemB,
        target_qty: 5,
        created_by: actor,
        steps: { create: [f.wsA, f.wsB].map((w, i) => ({ step_no: i + 1, workstation_id: w })) },
      },
    })
  ).id;
  f.lot1 = await stockIn(f.itemA, f.warehouse, key("L1"), 100, 1000);
  f.lot2 = await stockIn(f.itemA, f.warehouse, key("L2"), 50, 600);
  f.b1 = await atStation(f.itemA, f.lot1, f.wsA, 100, 1000);
  f.b2 = await atStation(f.itemA, f.lot2, f.wsA, 50, 600);
});

after(async () => {
  await prisma.prdHandoverLine.deleteMany({ where: { handover_id: { in: ids } } });
  await prisma.prdHandover.deleteMany({ where: { id: { in: ids } } });
  await prisma.auditLog.deleteMany({ where: { entity_key: "prd_handover", row_id: { in: ids } } });
  await prisma.prdLedger.deleteMany({ where: { item_id: { in: items } } });
  await prisma.prdBalance.deleteMany({ where: { item_id: { in: items } } });
  const partai = await prisma.prdPartai.findMany({ where: { order_id: { in: [f.order, f.order2, f.order3] } }, select: { id: true } });
  const partaiIds = partai.map((p) => p.id);
  await prisma.prdJobParent.deleteMany({ where: { job: { partai_id: { in: partaiIds } } } });
  await prisma.prdJob.deleteMany({ where: { partai_id: { in: partaiIds } } });
  await prisma.prdPartai.deleteMany({ where: { id: { in: partaiIds } } });
  await prisma.prdOrderStep.deleteMany({ where: { order_id: { in: [f.order, f.order2, f.order3] } } });
  await prisma.prdOrder.deleteMany({ where: { id: { in: [f.order, f.order2, f.order3] } } });
  await cleanupFixtures();
  await cleanupStock(items);
  await prisma.mItem.deleteMany({ where: { id: { in: items } } });
  await prisma.refWorkstation.deleteMany({ where: { id: { in: [f.wsA, f.wsB, f.wsC] } } });
  await prisma.refWarehouse.deleteMany({ where: { id: f.warehouse } });
  await prisma.refUom.deleteMany({ where: { id: f.kg } });
  await cleanupFiscalYear();
  await disconnect();
});

describe("what a hand-over that starts a Partai may be saved with", () => {
  test("two different stations, a line, a Perintah and a box on every goods without a Job", async () => {
    const empty = await create(header({ from_workstation_id: null, to_workstation_id: null }), []);
    assert.ok(!empty.ok && empty.errors.from_workstation_id && empty.errors.to_workstation_id && empty.errors._lines);
    const same = await create(header({ to_workstation_id: f.wsA }), [line(f.b1, 10, 1)]);
    assert.ok(!same.ok && same.errors.to_workstation_id);
    const noOrder = await create(header({ order_id: null }), [line(f.b1, 10, 1)]);
    assert.ok(!noOrder.ok && /Perintah/.test(noOrder.errors.order_id));
    const noBox = await create(header(), [line(f.b1, 10)]);
    assert.ok(!noBox.ok && noBox.errors["lines.0.box_no"]);
    const notRoute = await create(header({ order_id: f.order2 }), [line(f.b1, 10, 1)]);
    assert.ok(!notRoute.ok && /rute/.test(notRoute.errors.order_id));
  });

  test("never more than the bucket holds, across the lines that take it", async () => {
    const over = await create(header(), [line(f.b1, 70, 1), line(f.b1, 40, 2)]);
    assert.ok(!over.ok && /Melebihi/.test(over.errors["lines.1.qty"]));
    const dupe = await create(header(), [line(f.b1, 10, 1), line(f.b1, 10, 1)]);
    assert.ok(!dupe.ok && /sudah ada di box/.test(dupe.errors["lines.1.bucket_id"]));
  });

  test("a Reject bucket stays in production: no hand-over carries it (O6)", async () => {
    const lot = await stockIn(f.itemA, f.warehouse, key("L5"), 3, 30);
    const b = await atStation(f.itemA, lot, f.wsA, 3, 30);
    await prisma.prdBalance.update({ where: { id: b }, data: { is_reject: true } });
    const r = await create(header(), [line(b, 3, 1)]);
    assert.ok(!r.ok && /Reject/.test(r.errors["lines.0.bucket_id"]), JSON.stringify(r));
    await prisma.prdLedger.deleteMany({ where: { bucket_id: b } });
    await prisma.prdBalance.delete({ where: { id: b } });
  });

  test("a station without a Kode Job cannot start a Partai", async () => {
    const lot = await stockIn(f.itemA, f.warehouse, key("L9"), 5, 50);
    const b = await atStation(f.itemA, lot, f.wsB, 5, 50);
    const r = await checkHandover(prisma, header({ from_workstation_id: f.wsB, to_workstation_id: f.wsC, order_id: f.order2 }), [line(b, 5, 1)], null);
    assert.ok(!r.ok && /Kode Job/.test(r.errors._lines), JSON.stringify(r));
    await prisma.prdLedger.deleteMany({ where: { bucket_id: b } });
    await prisma.prdBalance.delete({ where: { id: b } });
  });
});

describe("posting starts the Partai, makes a Job per box and sends the goods in transit", () => {
  test("a lot is split over two boxes; the Partai takes the Perintah's Item Target", async () => {
    const r = await create(header(), [line(f.b1, 60, 1), line(f.b1, 40, 2), line(f.b2, 50, 1)]);
    assert.ok(r.ok, JSON.stringify(r));
    assert.match(r.handoverNo, /^BSTB_.+_\d{6}_\d{5}$/, "the sending unit's number (M124)");
    f.h1 = r.id;
    const posted = await transitionHandover(f.h1, "post", actor);
    assert.ok(posted.ok, JSON.stringify(posted));

    const v = (await getHandover(f.h1))!;
    assert.equal(v.status, "Posted");
    assert.ok(v.partaiId && v.partaiNo);
    const partai = await prisma.prdPartai.findUniqueOrThrow({ where: { id: v.partaiId! } });
    assert.equal(partai.order_id, f.order);
    assert.equal(partai.target_item_id, f.itemB);
    const jobs = await prisma.prdJob.findMany({ where: { partai_id: partai.id }, orderBy: { id: "asc" } });
    assert.equal(jobs.length, 2, "one Job per box");
    assert.ok(jobs.every((j) => j.job_no.startsWith(`T${stamp}_`) && j.workstation_id === f.wsA));
    assert.equal(v.lines[0].jobNo, jobs[0].job_no);
    assert.equal(v.lines[1].jobNo, jobs[1].job_no);
    assert.equal(v.lines[2].jobNo, jobs[0].job_no, "box 1 again: the same Job");
    // 100 g at Rp 1.000: 60 → 600, the box that empties it takes the rest.
    assert.deepEqual(v.lines.map((l) => l.cost), [600, 400, 600]);
    assert.equal(v.cost, 1600);
  });

  test("the sender's buckets are empty, the receiver holds the goods in transit, value intact", async () => {
    const at = await buckets({ workstation_id: f.wsA, in_transit: false });
    assert.ok(at.every((b) => b.qty_balance.toNumber() === 0 && b.value_balance.toNumber() === 0));
    const transit = await buckets({ workstation_id: f.wsB, in_transit: true });
    assert.equal(transit.length, 3);
    assert.equal(transit.reduce((s, b) => s + b.value_balance.toNumber(), 0), 1600);
    assert.ok(transit.every((b) => b.partai_id != null && b.job_id != null));
    const sent = await prisma.prdLedger.count({ where: { item_id: f.itemA, movement: "Sent" } });
    assert.equal(sent, 6, "out of the sender, into transit — three lines each");
  });

  test("goods in transit cannot be handed on, and a Perintah starts one Partai only", async () => {
    const transit = (await buckets({ workstation_id: f.wsB, in_transit: true }))[0];
    const again = await create(header({ from_workstation_id: f.wsB, to_workstation_id: f.wsC }), [line(transit.id, 1)]);
    assert.ok(!again.ok, "not received yet: not offered");
    const second = await create(header(), [line(f.b2, 1, 1)]);
    assert.ok(!second.ok);
  });

  test("it writes no journal, and the Perintah cannot be closed while the hand-over is in transit", async () => {
    const v = (await getHandover(f.h1))!;
    assert.equal(await prisma.accJournal.count({ where: { description: { contains: v.handoverNo } } }), 0);
    assert.match((await openHandoversRefusal(f.order)) ?? "", /belum diterima/);
  });
});

describe("Terima and the whole Partai", () => {
  test("Terima moves each line's own figures into the receiving station", async () => {
    assert.match((await openHandoversRefusal(f.order)) ?? "", /belum diterima/, "in transit blocks Tutup");
    const bad = await transitionHandover(f.h1, "receive", actor, undefined, { date: "2000-01-01" });
    assert.ok(!bad.ok);
    const ok = await transitionHandover(f.h1, "receive", actor, undefined, { date: today });
    assert.ok(ok.ok, JSON.stringify(ok));
    const held = await buckets({ workstation_id: f.wsB, in_transit: false, qty_balance: { gt: 0 } });
    assert.equal(held.length, 3);
    assert.equal(held.reduce((s, b) => s + b.value_balance.toNumber(), 0), 1600);
    assert.ok((await buckets({ workstation_id: f.wsB, in_transit: true })).every((b) => b.qty_balance.toNumber() === 0));
    assert.equal(await openHandoversRefusal(f.order), null);
    assert.equal((await handoversOfOrder(f.order)).length, 1);
  });

  test("a Partai goes whole: a part is refused, naming what is left (AD1)", async () => {
    const held = await buckets({ workstation_id: f.wsB, in_transit: false, qty_balance: { gt: 0 } });
    const part = await create(header({ from_workstation_id: f.wsB, to_workstation_id: f.wsC, order_id: null }), held.slice(0, 2).map((b) => line(b.id, b.qty_balance.toString())));
    assert.ok(!part.ok && /utuh/.test(part.errors._lines), JSON.stringify(part));
    const less = await create(header({ from_workstation_id: f.wsB, to_workstation_id: f.wsC, order_id: null }), held.map((b, i) => line(b.id, i === 0 ? "1" : b.qty_balance.toString())));
    assert.ok(!less.ok && /utuh/.test(less.errors._lines), "every gram of every bucket");
  });

  test("Tolak sends the goods back to the sender with their Job and value; Terima then completes a second try", async () => {
    const held = await buckets({ workstation_id: f.wsB, in_transit: false, qty_balance: { gt: 0 } });
    const all = held.map((b) => line(b.id, b.qty_balance.toString()));
    const r = await create(header({ from_workstation_id: f.wsB, to_workstation_id: f.wsC, order_id: null }), all);
    assert.ok(r.ok, JSON.stringify(r));
    f.h2 = r.id;
    assert.ok((await transitionHandover(f.h2, "post", actor)).ok);
    const jobsBefore = await prisma.prdJob.count({ where: { partai_id: (await getHandover(f.h1))!.partaiId! } });
    assert.equal(jobsBefore, 2, "a station without a Kode Job makes no Job: they keep theirs");
    assert.equal((await getHandover(f.h2))!.partaiId, (await getHandover(f.h1))!.partaiId);

    const noReason = await transitionHandover(f.h2, "reject", actor, "", { date: today });
    assert.ok(!noReason.ok && noReason.errors.reason);
    const rejected = await transitionHandover(f.h2, "reject", actor, "barang tidak cocok", { date: today });
    assert.ok(rejected.ok, JSON.stringify(rejected));
    const back = await buckets({ workstation_id: f.wsB, in_transit: false, qty_balance: { gt: 0 } });
    assert.equal(back.length, 3);
    assert.equal(back.reduce((s, b) => s + b.value_balance.toNumber(), 0), 1600, "the value left at is the value it came back at");
    assert.ok(back.every((b) => b.job_id != null), "Jobs kept");
    assert.equal((await getHandover(f.h2))!.status, "Rejected");

    const again = await create(header({ from_workstation_id: f.wsB, to_workstation_id: f.wsC, order_id: null }), back.map((b) => line(b.id, b.qty_balance.toString())));
    assert.ok(again.ok);
    assert.ok((await transitionHandover(again.id, "post", actor)).ok);
    assert.ok((await transitionHandover(again.id, "receive", actor, undefined, { date: today })).ok);
    const atC = await buckets({ workstation_id: f.wsC, in_transit: false, qty_balance: { gt: 0 } });
    assert.equal(atC.reduce((s, b) => s + b.value_balance.toNumber(), 0), 1600);
  });
});

describe("a station that makes Jobs boxes a Partai's jobless goods too (the Moulding case)", () => {
  test("the new Job's parents are every Job of the Partai", async () => {
    const partaiId = (await getHandover(f.h1))!.partaiId!;
    const lot = await stockIn(f.itemA, f.warehouse, key("L6"), 20, 200);
    const docTypeId = (await prisma.sysDocType.findFirstOrThrow({ where: { doc_table: "prd_handover" } })).id;
    const b = await prisma.$transaction(async (tx) =>
      (await enterProduction(tx, { lotId: lot, itemId: f.itemA, partaiId, workstationId: f.wsA, baseQty: 20, value: 200, date: day, source: { docTypeId, docId: fakeDoc++, no: "TEST" }, actorId: actor })).bucketId
    );
    const noBox = await create(header({ order_id: null }), [line(b, 20)]);
    assert.ok(!noBox.ok && noBox.errors["lines.0.box_no"]);
    const r = await create(header({ order_id: null }), [line(b, 20, 1)]);
    assert.ok(r.ok, JSON.stringify(r));
    assert.ok((await transitionHandover(r.id, "post", actor)).ok);
    const made = (await getHandover(r.id))!.lines[0].jobNo!;
    const job = await prisma.prdJob.findUniqueOrThrow({ where: { job_no: made }, include: { parents: true } });
    const all = await prisma.prdJob.findMany({ where: { partai_id: partaiId, id: { not: job.id } }, select: { id: true } });
    assert.equal(job.partai_id, partaiId);
    assert.deepEqual(job.parents.map((x) => x.parent_job_id).sort(), all.map((x) => x.id).sort());
    assert.equal(all.length, 2);
  });
});

describe("a Draft", () => {
  test("is edited whole and takes a new number when its day changes; Batalkan needs a reason; a posted one is final", async () => {
    const lot = await stockIn(f.itemA, f.warehouse, key("L8"), 10, 100);
    const b = await atStation(f.itemA, lot, f.wsA, 10, 100);
    const r = await create(header({ order_id: f.order3 }), [line(b, 10, 1)]);
    assert.ok(r.ok, JSON.stringify(r));
    const yesterday = new Date(day.getTime() - 86_400_000).toISOString().slice(0, 10);
    const upd = await updateHandover(r.id, header({ order_id: f.order3, handover_date: yesterday }), [line(b, 6, 1), line(b, 4, 2)], actor);
    assert.ok(upd.ok, JSON.stringify(upd));
    assert.notEqual(upd.handoverNo, r.handoverNo, "the number carries the day");
    assert.equal((await getHandover(r.id))!.lines.length, 2);
    const noReason = await transitionHandover(r.id, "cancel", actor, "");
    assert.ok(!noReason.ok && noReason.errors.reason);
    assert.ok((await transitionHandover(r.id, "cancel", actor, "salah pilih")).ok);
    const final = await updateHandover(r.id, header({ order_id: f.order3 }), [line(b, 1, 1)], actor);
    assert.ok(!final.ok && /tidak dapat diubah/.test(final.errors._form));
    const posted = await updateHandover(f.h1, header(), [line(f.b1, 1, 1)], actor);
    assert.ok(!posted.ok && /tidak dapat diubah/.test(posted.errors._form));
    assert.ok(!(await transitionHandover(f.h1, "cancel", actor, "x")).ok, "a posted hand-over is never cancelled");
  });
});

describe("what the user may do", () => {
  test("Draft offers Posting and Batalkan, a sent one Terima and Tolak", () => {
    const can = handoverAbilities(["PRODUCTION_HANDOVER_POST", "PRODUCTION_HANDOVER_CANCEL", "PRODUCTION_HANDOVER_RECEIVE"]);
    assert.deepEqual(availableHandoverActions("Draft", can).sort(), ["cancel", "post"]);
    assert.deepEqual(availableHandoverActions("Posted", can).sort(), ["receive", "reject"]);
    assert.deepEqual(availableHandoverActions("Received", can), []);
  });
});
