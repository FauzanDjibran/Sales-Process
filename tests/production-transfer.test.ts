import test, { after, before, describe } from "node:test";
import assert from "node:assert/strict";

import { advanceToStandBy, availableBuckets, enterProduction, issueJob } from "../src/lib/erp/production-ledger";
import { getTransfer, incomingTransfers, receiveTransfer, sendTransfer, transferOptions, type TransferInput } from "../src/lib/erp/production-transfer";
import { cleanupFiscalYear, cleanupFixtures, disconnect, openFiscalYear, prisma } from "./helpers";
import { cleanupProduction, makeProductionFixture, sourceOf, type ProductionFixture } from "./production-helpers";

/**
 * Dokumen Push and BSTB (P277): A and B share a Workstation (Push), C is in
 * another (BSTB), all on one line routing A › B › C with the partai following it.
 */

const today = new Date().toISOString().slice(0, 10);
const date = new Date(`${today}T00:00:00Z`);
let f: ProductionFixture;
let s: Awaited<ReturnType<typeof sourceOf>>;
const ids = {} as Record<string, number>;
const tx = <T,>(fn: (t: Parameters<Parameters<typeof prisma.$transaction>[0]>[0]) => Promise<T>) => prisma.$transaction(fn as never) as Promise<T>;
const transfers: number[] = [];

const standBy = (unit: number) => availableBuckets({ unitIds: [unit], stage: "StandBy" });
const persiapan = (unit: number) => availableBuckets({ unitIds: [unit], stage: "Preparation" });
const inTransit = (unit: number) => availableBuckets({ unitIds: [unit], stage: "InTransit" });

async function send(over: Partial<TransferInput>) {
  const r = await sendTransfer({ from_unit_id: ids.a, to_unit_id: ids.b, transfer_date: today, line_id: null, note: "", lines: [], ...over }, f.actor);
  if (r.ok) transfers.push(r.id);
  return r;
}

/** Puts `qty` of the material at a Unit in Stand By, in the partai (or none). */
async function stand(unit: number, qty: number, partaiId: number | null) {
  const lot = await prisma.logStockTracking.create({
    data: { tracking_no: f.key(`L${Math.random().toString(36).slice(2, 6)}`), tracking_date: date, item_id: f.material, source_doc_type_id: s.docTypeId, source_doc_id: s.docId, source_no: s.no, created_by: f.actor },
  });
  await tx(async (t) => {
    const e = await enterProduction(t, { lotId: lot.id, itemId: f.material, unitId: unit, baseQty: qty, value: qty * 1000, date, source: s, actorId: f.actor });
    await t.prdBalance.update({ where: { id: e.bucketId }, data: { partai_id: partaiId } });
    return advanceToStandBy(t, { bucketId: e.bucketId, baseQty: qty, date, source: s, actorId: f.actor });
  });
  return (await standBy(unit)).find((b) => b.lotId === lot.id)!;
}

before(async () => {
  await openFiscalYear();
  f = await makeProductionFixture("TRF");
  s = await sourceOf("log_stock_issue", "SI/TEST/TRF");
  const a = f.actor;
  const ws1 = (await prisma.refWorkstation.create({ data: { workstation_code: `test.${f.key("W1")}`, workstation_label: f.key("W1"), workstation_name: "Satu", created_by: a } })).id;
  const ws2 = (await prisma.refWorkstation.create({ data: { workstation_code: `test.${f.key("W2")}`, workstation_label: f.key("W2"), workstation_name: "Dua", created_by: a } })).id;
  ids.ws1 = ws1;
  ids.ws2 = ws2;
  ids.a = f.wsA;
  ids.b = f.wsB;
  ids.c = (await prisma.refUnit.create({ data: { unit_code: `test.${f.key("C")}`, unit_label: f.key("C"), unit_name: "C", created_by: a, steps: { create: [{ seq: 1, process: "Assign" }] } } })).id;
  await prisma.refUnit.updateMany({ where: { id: { in: [ids.a, ids.b] } }, data: { workstation_id: ws1 } });
  await prisma.refUnit.update({ where: { id: ids.c }, data: { workstation_id: ws2 } });
  ids.line = (await prisma.prdLine.create({ data: { line_code: `test.${f.key("LN")}`, line_label: f.key("LN"), line_name: "Uji", created_by: a } })).id;
  ids.routing = (
    await prisma.prdRouting.create({
      data: {
        routing_code: `test.${f.key("RT")}`,
        routing_label: f.key("RT"),
        routing_name: "A B C",
        line_id: ids.line,
        created_by: a,
        steps: { create: [{ seq: 1, unit_id: ids.a }, { seq: 2, unit_id: ids.b }, { seq: 3, unit_id: ids.c }] },
      },
    })
  ).id;
  ids.version = (await prisma.prdRateVersion.create({ data: { rate_code: `test.${f.key("V")}`, rate_label: f.key("V"), rate_name: "Uji", status: "Inactive", created_by: a } })).id;
  ids.partai = (
    await prisma.prdPartai.create({ data: { partai_no: f.key("P1"), partai_date: date, line_id: ids.line, routing_id: ids.routing, rate_version_id: ids.version, source_doc_type_id: s.docTypeId, source_doc_id: s.docId, source_no: s.no, created_by: a } })
  ).id;
  ids.other = (
    await prisma.prdPartai.create({ data: { partai_no: f.key("P2"), partai_date: date, line_id: ids.line, routing_id: ids.routing, rate_version_id: ids.version, source_doc_type_id: s.docTypeId, source_doc_id: s.docId, source_no: s.no, created_by: a } })
  ).id;
});

after(async () => {
  await prisma.auditLog.deleteMany({ where: { entity_key: "prd_transfer", row_id: { in: transfers } } });
  await prisma.prdTransfer.deleteMany({ where: { id: { in: transfers } } });
  await cleanupProduction([f.material, f.product, f.byproduct]);
  await prisma.prdPartai.deleteMany({ where: { id: { in: [ids.partai, ids.other, ids.cp].filter(Boolean) } } });
  await prisma.prdRateVersion.deleteMany({ where: { id: ids.version } });
  await prisma.prdRouting.deleteMany({ where: { id: ids.routing } });
  await prisma.prdLine.deleteMany({ where: { id: ids.line } });
  await prisma.refUnit.deleteMany({ where: { id: ids.c } });
  await f.teardown();
  await prisma.refWorkstation.deleteMany({ where: { id: { in: [ids.ws1, ids.ws2] } } });
  await cleanupFixtures();
  await cleanupFiscalYear();
  await disconnect();
});

describe("Dokumen Push inside a Workstation", () => {
  test("it moves goods at once into the next Persiapan and gives a loose pickup its own No. Job (W92, T8)", async () => {
    const b = await stand(ids.a, 100, ids.partai);
    const r = await send({ lines: [{ bucket_id: b.id, qty: 40 }] });
    assert.ok(r.ok, JSON.stringify(r));
    assert.equal(r.kind, "Push");
    assert.equal(r.status, "Posted");
    assert.match(r.no, new RegExp(`^PSH_${f.key("WSA")}_\\d{6}_00001$`));
    const [out] = (await persiapan(ids.b)).filter((x) => x.lotId === b.lotId);
    assert.equal(out.qty, 40);
    assert.ok(out.jobId, "the pickup made a No. Job");
    assert.equal(out.partaiId, ids.partai);
    assert.equal((await standBy(ids.a)).find((x) => x.lotId === b.lotId)?.qty, 60, "the rest stays in Stand By");
    const doc = (await getTransfer(r.id))!;
    assert.equal(doc.items[0].newJob, true);
    assert.equal(doc.items[0].qty, 40);
    assert.equal(await prisma.accJournal.count({ where: { description: { startsWith: r.no } } }), 0, "no journal: the value stays in WIP");
    assert.equal(await prisma.prdLedger.count({ where: { source_no: r.no } }), 2, "out of Stand By, into Persiapan");
  });

  test("the destination is the next Unit of the routing, nothing else", async () => {
    const b = (await standBy(ids.a))[0];
    const r = await send({ to_unit_id: ids.c, lines: [{ bucket_id: b.id, qty: 10 }] });
    assert.ok(!r.ok && /Unit berikutnya/.test(r.errors.to_unit_id), JSON.stringify(r));
    const same = await send({ to_unit_id: ids.a, lines: [{ bucket_id: b.id, qty: 10 }] });
    assert.ok(!same.ok && same.errors.to_unit_id);
  });

  test("it takes no more than Stand By holds, and nothing that is only in Persiapan", async () => {
    const b = (await standBy(ids.a))[0];
    const over = await send({ lines: [{ bucket_id: b.id, qty: b.qty + 1 }] });
    assert.ok(!over.ok && /Melebihi/.test(over.errors["lines.0.qty"]));
    const prep = (await persiapan(ids.b))[0];
    const wrong = await send({ lines: [{ bucket_id: prep.id, qty: 1 }] });
    assert.ok(!wrong.ok && /Stand By/.test(wrong.errors["lines.0.bucket_id"]));
    assert.ok(!(await send({ lines: [] })).ok);
  });

  test("a Job leaves whole, with every No. Stok of it (W96)", async () => {
    const job = await tx((t) => issueJob(t, { unitId: ids.a, lotId: f.lot, partaiId: ids.partai, date, source: s, actorId: f.actor }));
    const x = await stand(ids.a, 30, ids.partai);
    const y = await stand(ids.a, 20, ids.partai);
    await prisma.prdBalance.updateMany({ where: { id: { in: [x.id, y.id] } }, data: { job_id: job.id } });
    const half = await send({ lines: [{ bucket_id: x.id, qty: 30 }] });
    assert.ok(!half.ok && /utuh/.test(half.errors._lines), JSON.stringify(half));
    const whole = await send({ lines: [{ bucket_id: x.id, qty: 1 }, { bucket_id: y.id, qty: 1 }] });
    assert.ok(whole.ok, "the quantity typed on a Job row is ignored: the Job goes whole");
    const moved = (await persiapan(ids.b)).filter((p) => p.jobId === job.id);
    assert.deepEqual(moved.map((p) => p.qty).sort((a, b) => a - b), [20, 30]);
  });

  test("one document holds one partai (W76)", async () => {
    const a = await stand(ids.a, 10, ids.partai);
    const b = await stand(ids.a, 10, ids.other);
    const r = await send({ lines: [{ bucket_id: a.id, qty: 10 }, { bucket_id: b.id, qty: 10 }] });
    assert.ok(!r.ok && /satu partai/.test(r.errors._lines));
  });
});

describe("BSTB between Workstations", () => {
  test("it keeps the goods at the sender as Dalam Perjalanan until the receiver presses Terima (T4)", async () => {
    const b = await stand(ids.b, 50, ids.partai);
    const r = await send({ from_unit_id: ids.b, to_unit_id: ids.c, lines: [{ bucket_id: b.id, qty: 50 }] });
    assert.ok(r.ok, JSON.stringify(r));
    assert.equal(r.kind, "Bstb");
    assert.equal(r.status, "Submitted");
    assert.match(r.no, new RegExp(`^BST_${f.key("C")}_\\d{6}_\\d{5}$`), "numbered by the receiving Unit");

    const moving = (await inTransit(ids.b)).filter((x) => x.lotId === b.lotId);
    assert.equal(moving.length, 1);
    assert.equal(moving[0].qty, 50);
    assert.equal((await standBy(ids.b)).filter((x) => x.lotId === b.lotId).length, 0);
    assert.equal((await persiapan(ids.c)).length, 0, "nothing arrives before Terima");
    assert.ok((await incomingTransfers()).some((i) => i.id === r.id && i.toUnitId === ids.c));

    const got = await receiveTransfer(r.id, f.actor);
    assert.ok(got.ok, JSON.stringify(got));
    const [arrived] = (await persiapan(ids.c)).filter((x) => x.lotId === b.lotId);
    assert.equal(arrived.qty, 50);
    assert.equal(arrived.partaiId, ids.partai);
    assert.equal((await inTransit(ids.b)).filter((x) => x.lotId === b.lotId).length, 0);
    assert.equal((await getTransfer(r.id))!.status, "Posted");
    const again = await receiveTransfer(r.id, f.actor);
    assert.ok(!again.ok && /sudah berubah/.test(again.errors._form), "Terima once");
  });

  test("the value follows the goods and the books add up (V, P114)", async () => {
    const b = await stand(ids.b, 8, ids.partai);
    const r = await send({ from_unit_id: ids.b, to_unit_id: ids.c, lines: [{ bucket_id: b.id, qty: 8 }] });
    assert.ok(r.ok);
    assert.ok((await receiveTransfer(r.id, f.actor)).ok);
    const [arrived] = (await persiapan(ids.c)).filter((x) => x.lotId === b.lotId);
    assert.equal(arrived.value, 8_000);
    const rows = await prisma.prdLedger.findMany({ where: { source_no: r.no } });
    assert.equal(rows.reduce((a, l) => a + l.value_change.toNumber(), 0), 0, "out and in cancel");
  });

  test("the options of a Unit name where each routing sends its Stand By", async () => {
    await stand(ids.a, 5, ids.partai);
    const o = (await transferOptions(ids.a))!;
    assert.ok(o.buckets.length >= 1);
    assert.deepEqual(o.routes.map((r) => [r.toUnitId, r.kind]), [[ids.b, "Push"]]);
  });
});

describe("a checkpoint sends the whole partai at once (T5)", () => {
  test("goods of the partai elsewhere keep the checkpoint closed", async () => {
    await prisma.prdRoutingStep.updateMany({ where: { routing_id: ids.routing, unit_id: ids.b }, data: { is_checkpoint: true } });
    try {
      const partai = await prisma.prdPartai.create({ data: { partai_no: f.key("P3"), partai_date: date, line_id: ids.line, routing_id: ids.routing, rate_version_id: ids.version, source_doc_type_id: s.docTypeId, source_doc_id: s.docId, source_no: s.no, created_by: f.actor } });
      ids.cp = partai.id;
      const here = await stand(ids.b, 20, partai.id);
      const behind = await tx(async (t) => {
        const lot = await prisma.logStockTracking.create({ data: { tracking_no: f.key("LCP"), tracking_date: date, item_id: f.material, source_doc_type_id: s.docTypeId, source_doc_id: s.docId, source_no: s.no, created_by: f.actor } });
        const e = await enterProduction(t, { lotId: lot.id, itemId: f.material, unitId: ids.a, baseQty: 5, value: 5_000, date, source: s, actorId: f.actor });
        await t.prdBalance.update({ where: { id: e.bucketId }, data: { partai_id: partai.id } });
        return e.bucketId;
      });
      const early = await send({ from_unit_id: ids.b, to_unit_id: ids.c, lines: [{ bucket_id: here.id, qty: 20 }] });
      assert.ok(!early.ok && /checkpoint/.test(early.errors._lines), JSON.stringify(early));
      await prisma.prdLedger.deleteMany({ where: { bucket_id: behind } });
      await prisma.prdBalance.delete({ where: { id: behind } });
      const ok = await send({ from_unit_id: ids.b, to_unit_id: ids.c, lines: [{ bucket_id: here.id, qty: 20 }] });
      assert.ok(ok.ok, JSON.stringify(ok));
    } finally {
      await prisma.prdRoutingStep.updateMany({ where: { routing_id: ids.routing }, data: { is_checkpoint: false } });
    }
  });
});
