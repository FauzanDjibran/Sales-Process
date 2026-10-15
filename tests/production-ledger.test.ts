import test, { after, before, describe } from "node:test";
import assert from "node:assert/strict";

import {
  ProductionRefusal,
  availableBuckets,
  enterProduction,
  freeLotNo,
  produce,
  revalueBucket,
  startJob,
  startPartai,
  takeFromBucket,
  wipByItem,
  type Production,
} from "../src/lib/erp/production-ledger";
import { carriedSupplier, inputsPartai, shareByWeight, shareQty } from "../src/lib/erp/production-execution";
import { dailySequence, ddmmyy, formatDailyNumber, freeNumber, lotNumberBase, mixLotNumber } from "../src/lib/erp/production-number";
import { FIXTURE_PREFIX, cleanupFixtures, disconnect, makePartner, prisma, productionCostCenterId, systemUserId } from "./helpers";

/**
 * The production ledger (P150 E2, E3; P155 M92; Walet M112, M124, M127, M128):
 * one lot register for stock and production; buckets of one lot · Job ·
 * workstation (or in transit) holding Q and V, never pooled, each naming its
 * Partai; a take releases round(V × q ÷ Q) and the emptying one V whole; an
 * execution is balanced — Σ input value plus its standard conversion shared
 * over the outputs by Bobot Biaya — registers its output lots with the one
 * supplier behind them, works one Partai at most, and writes the genealogy; a
 * revaluation moves value only.
 */

let actor = 0;
const f = {} as Record<string, number>;
const stamp = String(Date.now() % 100000);
const key = (s: string) => `${FIXTURE_PREFIX}${s}${stamp}`.toUpperCase();
const day = (iso: string) => new Date(`${iso}T00:00:00Z`);
let docTypeId = 0;
let docSeq = 800_000 + Number(stamp) * 10;
const src = () => ({ docTypeId, docId: ++docSeq, no: key(`SRC${docSeq}`) });
const items: number[] = [];
const partai = new Set<number>();

before(async () => {
  actor = await systemUserId();
  f.kg = (await prisma.refUom.create({ data: { uom_code: `test.${key("KG")}`, uom_label: key("KG"), uom_name: "Kg", created_by: actor } })).id;
  const cat = (await prisma.sysItemCategory.findUniqueOrThrow({ where: { category_label: "BRG-JADI" } })).id;
  const item = async (l: string, track = true, expiry = false) => {
    const id = (
      await prisma.mItem.create({
        data: { item_code: `test.${key(l)}`, item_label: key(l), item_name: l, item_type: "Barang", category_id: cat, base_uom_id: f.kg, track_stock: track, has_expiry: expiry, created_by: actor },
      })
    ).id;
    items.push(id);
    return id;
  };
  f.rm = await item("RM");
  f.pk = await item("PK");
  f.bulk = await item("BULK");
  f.fg = await item("FG");
  f.reject = await item("REJ");
  f.plain = await item("PLAIN", false);
  const ws = async (l: string, active = true, jobCode: string | null = null) =>
    (
      await prisma.refWorkstation.create({
        data: {
          workstation_code: `test.${key(l)}`,
          workstation_label: key(l),
          workstation_name: l,
          job_code: jobCode,
          cost_center_id: await productionCostCenterId(),
          status: active ? "Active" : "Inactive",
          created_by: actor,
        },
      })
    ).id;
  f.ws1 = await ws("WS1", true, `J${stamp}`);
  f.ws2 = await ws("WS2");
  f.wsOff = await ws("WSOFF", false);
  docTypeId = (await prisma.sysDocType.findFirstOrThrow({ where: { doc_table: "log_stock_injection" } })).id;
  f.s1 = await makePartner({ categoryLabel: "Supplier" });
  f.s2 = await makePartner({ categoryLabel: "Supplier" });
  // Stock lots, as a receipt registers them (M128).
  const lot = async (itemId: number, no: string, partnerId: number | null) =>
    (
      await prisma.logStockTracking.create({
        data: { tracking_no: key(no), tracking_date: day("2026-10-01"), item_id: itemId, source_doc_type_id: docTypeId, source_doc_id: 1, source_no: "INJ", source_partner_id: partnerId, created_by: actor },
      })
    ).id;
  f.rmLot = await lot(f.rm, "RM-1", f.s1);
  f.pkLot = await lot(f.pk, "PK-1", f.s2);
});

after(async () => {
  const lots = (await prisma.logStockTracking.findMany({ where: { item_id: { in: items } }, select: { id: true } })).map((l) => l.id);
  await prisma.prdLotLink.deleteMany({ where: { OR: [{ from_lot_id: { in: lots } }, { to_lot_id: { in: lots } }] } });
  await prisma.prdLedger.deleteMany({ where: { item_id: { in: items } } });
  await prisma.prdBalance.deleteMany({ where: { item_id: { in: items } } });
  const jobs = (await prisma.prdJob.findMany({ where: { partai_id: { in: [...partai] } }, select: { id: true } })).map((j) => j.id);
  await prisma.prdJobParent.deleteMany({ where: { job_id: { in: jobs } } });
  await prisma.prdJob.deleteMany({ where: { id: { in: jobs } } });
  await prisma.prdPartai.deleteMany({ where: { id: { in: [...partai] } } });
  await prisma.logStockTracking.deleteMany({ where: { item_id: { in: items } } });
  await prisma.mItem.deleteMany({ where: { id: { in: items } } });
  await prisma.refWorkstation.deleteMany({ where: { id: { in: [f.ws1, f.ws2, f.wsOff] } } });
  await prisma.refUom.deleteMany({ where: { id: f.kg } });
  await cleanupFixtures();
  await disconnect();
});

const enter = (lotId: number, itemId: number, qty: number, value: number, ws = f.ws1, extra: { partaiId?: number; jobId?: number; inTransit?: boolean } = {}) =>
  prisma.$transaction((tx) =>
    enterProduction(tx, { lotId, itemId, ...extra, workstationId: ws, baseQty: qty, value, date: day("2026-10-05"), source: src(), actorId: actor })
  );

const run = (p: Omit<Production, "date" | "source" | "actorId">) =>
  prisma.$transaction((tx) => produce(tx, { ...p, date: day("2026-10-06"), source: src(), actorId: actor }));

const newPartai = async () => {
  const p = await prisma.$transaction((tx) => startPartai(tx, { date: day("2026-10-06"), targetItemId: f.fg, source: src(), actorId: actor }));
  partai.add(p.id);
  return p;
};

const bucket = async (id: number) => {
  const b = await prisma.prdBalance.findUniqueOrThrow({ where: { id } });
  return [b.qty_balance.toNumber(), b.value_balance.toNumber()];
};

describe("the arithmetic and the numbering are pure (E6, M124)", () => {
  test("a value is shared by weight in whole rupiah, largest remainder, adding up exactly", () => {
    assert.deepEqual(shareByWeight(100, [1, 1, 1]), [34, 33, 33]);
    assert.deepEqual(shareByWeight(10_000_000, [850, 50, 0]), [9_444_444, 555_556, 0], "the larger remainder (0,56) takes the rupiah");
    assert.deepEqual(shareByWeight(-100, [1, 1, 1]), [-34, -33, -33]);
    assert.deepEqual(shareByWeight(7, [0.5, 0.25, 0.25]), [3, 2, 2]);
    assert.deepEqual(shareByWeight(0, [0, 0]), [0, 0]);
    assert.throws(() => shareByWeight(5, [0, 0]));
  });

  test("a quantity is shared at six decimals, the last weighted part taking the rounding", () => {
    const parts = shareQty(10, [1, 1, 1]);
    assert.equal(parts.reduce((a, p) => a + p, 0), 10);
    assert.deepEqual(shareQty(5, [2, 0]), [5, 0]);
  });

  test("one Partai at most among the inputs (M112); the one supplier behind them is carried (M127)", () => {
    assert.deepEqual(inputsPartai([null, null]), { kind: "none" });
    assert.deepEqual(inputsPartai([3, null, 3]), { kind: "one", id: 3 });
    assert.deepEqual(inputsPartai([4, 3]), { kind: "many", ids: [3, 4] });
    assert.equal(carriedSupplier([7, null, 7]), 7);
    assert.equal(carriedSupplier([7, 8]), null);
    assert.equal(carriedSupplier([null]), null);
  });

  test("daily series, lot numbers and the -2 suffix follow the workbook (M124)", async () => {
    assert.equal(ddmmyy(day("2026-05-15")), "150526");
    assert.equal(formatDailyNumber(["BSTB", "upw"], "2026-05-15", 7), "BSTB_UPW_150526_00007");
    assert.equal(formatDailyNumber(["P"], day("2026-05-19"), 135607), "P_190526_135607");
    assert.equal(dailySequence("UGH_150526_00012"), 12);
    assert.equal(lotNumberBase({ unit: "UGH", supplier: "D0001", itemCode: "MK-1-0-PTH", date: "2026-05-15" }), "UGH_D0001_MK-1-0-PTH_150526");
    assert.equal(lotNumberBase({ unit: "UGH", itemCode: "BS", date: "2026-05-15" }), "UGH_BS_150526");
    assert.equal(mixLotNumber("P_150526_00001", "N-NL-KR"), "P_150526_00001_N-NL-KR");
    const taken = new Set(["A", "A-2"]);
    assert.equal(await freeNumber("a", async (n) => taken.has(n)), "A-3");
    assert.equal(await freeNumber("B", async (n) => taken.has(n)), "B");
  });
});

describe("goods enter production under their stock lot (§9.3, M128)", () => {
  test("the same lot again adds to its bucket; another workstation is another bucket of the same lot", async () => {
    const one = await enter(f.rmLot, f.rm, 1_100, 11_000_000);
    const again = await enter(f.rmLot, f.rm, 100, 1_200_000);
    assert.equal(again.bucketId, one.bucketId, "the same lot at the same workstation, outside any Job");
    assert.deepEqual(await bucket(one.bucketId), [1_200, 12_200_000]);
    const elsewhere = await enter(f.rmLot, f.rm, 50, 500_000, f.ws2);
    assert.notEqual(elsewhere.bucketId, one.bucketId);
    const b = await prisma.prdBalance.findUniqueOrThrow({ where: { id: one.bucketId } });
    assert.deepEqual([b.lot_id, b.partai_id, b.job_id, b.in_transit], [f.rmLot, null, null, false], "the stock lot itself; no Partai yet");
    f.rmBucket = one.bucketId;
    f.rmBucket2 = elsewhere.bucketId;
  });

  test("an item without Kelola Stok, an inactive workstation, a lot of another item, a fraction of a rupiah are refused", async () => {
    await assert.rejects(enter(f.rmLot, f.plain, 1, 1), ProductionRefusal);
    await assert.rejects(enter(f.rmLot, f.rm, 1, 1, f.wsOff), /nonaktif/);
    await assert.rejects(enter(f.pkLot, f.rm, 1, 1), /tidak ditemukan/);
    await assert.rejects(enter(f.rmLot, f.rm, 1, 1.5), /rupiah utuh/);
  });

  test("goods in transit wait in their own bucket and are not offered until received (M113)", async () => {
    const t = await enter(f.pkLot, f.pk, 10, 15_000, f.ws1, { inTransit: true });
    assert.ok(!(await availableBuckets({ itemIds: [f.pk] })).some((b) => b.id === t.bucketId));
    assert.ok((await availableBuckets({ itemIds: [f.pk], inTransit: true })).some((b) => b.id === t.bucketId && b.inTransit));
    f.transit = t.bucketId;
  });

  test("the ledger keeps one number per posting, a line per movement, with the balances after it", async () => {
    const rows = await prisma.prdLedger.findMany({ where: { bucket_id: f.rmBucket }, orderBy: { id: "asc" } });
    assert.equal(rows.length, 2);
    assert.ok(rows.every((r) => /^MP\/\d{4}\/\d{2}\/\d{4}$/.test(r.ledger_no) && r.line_no === 1 && r.movement === "Issued" && r.lot_id === f.rmLot));
    assert.notEqual(rows[0].ledger_no, rows[1].ledger_no);
    assert.deepEqual([rows[1].qty_balance.toNumber(), rows[1].value_balance.toNumber()], [1_200, 12_200_000]);
  });
});

describe("the Partai and its Jobs (M112, M124, M126)", () => {
  test("a Partai is numbered P_<DDMMYY>_<NNNNN> and carries its Job Order", async () => {
    const p = await newPartai();
    assert.match(p.no, /^P_061026_\d{5}$/);
    assert.equal((await prisma.prdPartai.findUniqueOrThrow({ where: { id: p.id } })).target_item_id, f.fg);
    f.p1 = p.id;
  });

  test("a Job takes its workstation's Kode Job; a workstation without one makes none; parents stay in the Partai", async () => {
    const job = await prisma.$transaction((tx) => startJob(tx, { partaiId: f.p1, workstationId: f.ws1, date: day("2026-10-06"), source: src(), actorId: actor }));
    assert.match(job.no, new RegExp(`^J${stamp}_061026_00001$`));
    f.job1 = job.id;
    await assert.rejects(
      prisma.$transaction((tx) => startJob(tx, { partaiId: f.p1, workstationId: f.ws2, date: day("2026-10-06"), source: src(), actorId: actor })),
      /Kode Job kosong/
    );
    const child = await prisma.$transaction((tx) => startJob(tx, { partaiId: f.p1, workstationId: f.ws1, parentJobIds: [f.job1], date: day("2026-10-06"), source: src(), actorId: actor }));
    assert.match(child.no, /_00002$/);
    assert.deepEqual((await prisma.prdJobParent.findMany({ where: { job_id: child.id } })).map((x) => x.parent_job_id), [f.job1]);
    const other = await newPartai();
    f.p2 = other.id;
    await assert.rejects(
      prisma.$transaction((tx) => startJob(tx, { partaiId: f.p2, workstationId: f.ws1, parentJobIds: [f.job1], date: day("2026-10-06"), source: src(), actorId: actor })),
      /bukan bagian dari Partai/
    );
  });
});

describe("an execution is balanced: cost in = cost out (G3, M12, M13)", () => {
  test("the first transformation: inputs at round(V × q ÷ Q), new lots registered with the supplier, under the Partai and its Job", async () => {
    const r = await run({
      workstationId: f.ws1,
      partaiId: f.p1,
      inputs: [{ bucketId: f.rmBucket, baseQty: 1_000 }],
      outputs: [
        { itemId: f.bulk, lotNo: key("blk-1"), expiry: null, baseQty: 850, weight: 850, jobId: f.job1 },
        { itemId: f.reject, lotNo: key("rej-1"), expiry: null, baseQty: 50, weight: 0 },
      ],
    });
    // 12.200.000 × 1.000 ÷ 1.200 = 10.166.666,67 → 10.166.667
    assert.deepEqual(r.inputs.map((i) => i.value), [10_166_667]);
    assert.deepEqual(r.outputs.map((o) => o.value), [10_166_667, 0]);
    assert.equal(r.partaiId, f.p1);
    assert.deepEqual(await bucket(f.rmBucket), [200, 2_033_333]);
    const out = await prisma.prdBalance.findUniqueOrThrow({ where: { id: r.outputs[0].bucketId }, include: { lot: true } });
    assert.deepEqual([out.partai_id, out.job_id], [f.p1, f.job1]);
    assert.deepEqual([out.lot.tracking_no, out.lot.source_partner_id, out.lot.source_doc_type_id], [key("BLK-1"), f.s1, docTypeId], "registered, the execution its source, the supplier carried");
    f.bulkBucket = r.outputs[0].bucketId;
    f.rejectBucket = r.outputs[1].bucketId;
    const links = await prisma.prdLotLink.findMany({ where: { to_lot_id: r.outputs[0].lotId } });
    assert.deepEqual(links.map((l) => [l.from_lot_id, l.qty.toNumber(), l.value.toNumber()]), [[f.rmLot, 1_000, 10_166_667]], "the reject takes no edge");
  });

  test("the standard conversion is added (P155 M92); the Partai carries; two suppliers behind the lot leave it without one", async () => {
    const pk = await enter(f.pkLot, f.pk, 1_000, 1_500_000);
    const r = await run({
      workstationId: f.ws1,
      inputs: [
        { bucketId: f.bulkBucket, baseQty: 425 },
        { bucketId: pk.bucketId, baseQty: 500 },
      ],
      outputs: [{ itemId: f.fg, lotNo: key("fg-1"), expiry: null, baseQty: 500, weight: 1, jobId: f.job1 }],
      addedValue: 1_200_000,
    });
    // half the bulk (5.083.334 by round(10.166.667 × 425 ÷ 850)) + half the packaging + 1.200.000
    assert.deepEqual(r.inputs.map((i) => i.value), [5_083_334, 750_000]);
    assert.equal(r.total, 5_083_334 + 750_000 + 1_200_000);
    assert.deepEqual(r.outputs.map((o) => o.value), [r.total]);
    assert.equal(r.partaiId, f.p1, "the bulk's Partai is carried");
    const lot = await prisma.logStockTracking.findUniqueOrThrow({ where: { id: r.outputs[0].lotId } });
    assert.equal(lot.source_partner_id, null);
    f.fgBucket = r.outputs[0].bucketId;
    const edges = await prisma.prdLotLink.findMany({ where: { to_lot_id: r.outputs[0].lotId } });
    assert.equal(edges.reduce((a, e) => a + e.value.toNumber(), 0), 5_083_334 + 750_000, "edges carry the inputs' value; the conversion has no input");
  });

  test("two Partai are never merged; a Job of another Partai is refused; a refused execution writes nothing", async () => {
    const other = await run({
      workstationId: f.ws1,
      partaiId: f.p2,
      inputs: [{ bucketId: f.rmBucket, baseQty: 50 }],
      outputs: [{ itemId: f.bulk, lotNo: key("blk-2"), expiry: null, baseQty: 48, weight: 1 }],
    });
    const mixed = {
      workstationId: f.ws1,
      inputs: [
        { bucketId: f.bulkBucket, baseQty: 425 },
        { bucketId: other.outputs[0].bucketId, baseQty: 48 },
      ],
      outputs: [{ itemId: f.fg, lotNo: key("fg-2"), expiry: null, baseQty: 470, weight: 1 }],
    };
    await assert.rejects(run(mixed), /lebih dari satu Partai/);
    await assert.rejects(
      run({ workstationId: f.ws1, inputs: [{ bucketId: other.outputs[0].bucketId, baseQty: 1 }], outputs: [{ itemId: f.fg, lotNo: key("fg-3"), expiry: null, baseQty: 1, weight: 1, jobId: f.job1 }] }),
      /bukan bagian dari Partai/
    );
    assert.deepEqual(await bucket(f.bulkBucket), [425, 5_083_333]);
    const last = await run({ ...mixed, inputs: [mixed.inputs[0]] });
    assert.equal(last.inputs[0].value, 5_083_333, "the take that empties the bucket releases V whole");
    assert.deepEqual(await bucket(f.bulkBucket), [0, 0]);
  });

  test("an output lot is new in the one register — another item's number too; goods elsewhere or in transit are not inputs", async () => {
    const base = { workstationId: f.ws1, inputs: [{ bucketId: f.rmBucket, baseQty: 10 }] };
    await assert.rejects(run({ ...base, outputs: [{ itemId: f.fg, lotNo: key("PK-1"), expiry: null, baseQty: 1, weight: 1 }] }), /sudah tercatat/);
    assert.equal(await prisma.$transaction((tx) => freeLotNo(tx, key("PK-1"))), `${key("PK-1")}-2`);
    await assert.rejects(run({ ...base, outputs: [] }), /minimal satu output/);
    await assert.rejects(run({ ...base, outputs: [{ itemId: f.fg, lotNo: key("fg-9"), expiry: null, baseQty: 1, weight: 0 }] }), /Bobot Biaya/);
    await assert.rejects(
      run({ workstationId: f.ws1, inputs: [{ bucketId: f.rmBucket, baseQty: 151 }], outputs: [{ itemId: f.fg, lotNo: key("fg-9"), expiry: null, baseQty: 1, weight: 1 }] }),
      /tidak cukup: tersedia 150, diminta 151/
    );
    await assert.rejects(
      run({ workstationId: f.ws1, inputs: [{ bucketId: f.rmBucket2, baseQty: 1 }], outputs: [{ itemId: f.fg, lotNo: key("fg-9"), expiry: null, baseQty: 1, weight: 1 }] }),
      /workstation eksekusi/
    );
    await assert.rejects(
      run({ workstationId: f.ws1, inputs: [{ bucketId: f.transit, baseQty: 1 }], outputs: [{ itemId: f.fg, lotNo: key("fg-9"), expiry: null, baseQty: 1, weight: 1 }] }),
      /terima dulu/
    );
    assert.deepEqual(await bucket(f.rmBucket), [150, 1_525_000]);
  });
});

describe("goods leave production at their bucket's value; the close revalues by value only", () => {
  test("a take says what the goods were — the lot they keep, its Partai and Job — and releases its share", async () => {
    const t = await prisma.$transaction((tx) => takeFromBucket(tx, { bucketId: f.fgBucket, baseQty: 100, date: day("2026-10-07"), source: src(), actorId: actor }));
    const [qty, value] = await bucket(f.fgBucket);
    assert.equal(qty, 400);
    assert.equal(t.value + value, 7_033_334);
    assert.equal(t.value, Math.round((7_033_334 * 100) / 500));
    assert.deepEqual([t.lotNo, t.partaiId, t.jobId], [key("FG-1"), f.p1, f.job1]);
  });

  test("a revaluation changes value with quantity 0; an empty bucket or a negative result is refused", async () => {
    const before = await bucket(f.fgBucket);
    await prisma.$transaction((tx) => revalueBucket(tx, { bucketId: f.fgBucket, value: 12_345, date: day("2026-10-31"), source: src(), actorId: actor }));
    assert.deepEqual(await bucket(f.fgBucket), [before[0], before[1] + 12_345]);
    const row = await prisma.prdLedger.findFirstOrThrow({ where: { bucket_id: f.fgBucket, movement: "Revalued" } });
    assert.deepEqual([row.qty_change.toNumber(), row.partai_id, row.job_id], [0, f.p1, f.job1]);
    await assert.rejects(prisma.$transaction((tx) => revalueBucket(tx, { bucketId: f.bulkBucket, value: 1, date: day("2026-10-31"), source: src(), actorId: actor })), /kosong/);
    await assert.rejects(prisma.$transaction((tx) => revalueBucket(tx, { bucketId: f.fgBucket, value: -1e10, date: day("2026-10-31"), source: src(), actorId: actor })), /negatif/);
  });

  test("each bucket equals its ledger; the pickers list what holds quantity, by Partai too; WIP per item is Σ bucket value", async () => {
    const buckets = await prisma.prdBalance.findMany({ where: { item_id: { in: items } } });
    for (const b of buckets) {
      const sum = await prisma.prdLedger.aggregate({ where: { bucket_id: b.id }, _sum: { qty_change: true, value_change: true } });
      assert.equal(sum._sum.qty_change?.toNumber() ?? 0, b.qty_balance.toNumber());
      assert.equal(sum._sum.value_change?.toNumber() ?? 0, b.value_balance.toNumber());
    }
    const open = await availableBuckets({ itemIds: items });
    assert.ok(open.every((b) => b.qty > 0 && !b.inTransit));
    assert.ok(open.some((b) => b.id === f.rejectBucket && b.value === 0 && b.partaiId === f.p1), "a reject waits in production at 0 (M59)");
    assert.ok(!open.some((b) => b.id === f.bulkBucket), "an emptied bucket is not offered");
    assert.ok((await availableBuckets({ withIds: [f.bulkBucket] })).some((b) => b.id === f.bulkBucket), "unless a stored document names it");
    const ofP1 = await availableBuckets({ partaiIds: [f.p1] });
    assert.ok(ofP1.length && ofP1.every((b) => b.partaiId === f.p1 && b.partaiNo));
    const wip = await wipByItem();
    const fgValue = buckets.filter((b) => b.item_id === f.fg).reduce((a, b) => a + b.value_balance.toNumber(), 0);
    assert.equal(wip.get(f.fg), fgValue);
  });
});
