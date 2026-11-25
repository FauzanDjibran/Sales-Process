import test, { after, before, describe } from "node:test";
import assert from "node:assert/strict";

import { availableBuckets, enterProduction } from "../src/lib/erp/production-ledger";
import { closeBox, getBox, type BoxInput } from "../src/lib/erp/production-box";
import { nearestBox, recommend } from "../src/lib/erp/production-box-shape";
import { cleanupFiscalYear, cleanupFixtures, disconnect, makeAccount, openFiscalYear, prisma } from "./helpers";
import { cleanupProduction, makeProductionFixture, sourceOf, type ProductionFixture } from "./production-helpers";

/**
 * Kotak at Packing 95 (P284). Unit P assembles; its rate is Rp 10 a gram of pieces.
 * BoM: 50 g ± 1 g, 3–5 pieces, 2 of a bahan penolong per kotak.
 */

const today = new Date().toISOString().slice(0, 10);
const date = new Date(`${today}T00:00:00Z`);
const ABSORBED = "production_absorbed_account";
let f: ProductionFixture;
let s: Awaited<ReturnType<typeof sourceOf>>;
const ids = {} as Record<string, number>;
const boxes: number[] = [];
let activeBefore: number[] = [];
let savedAbsorbed: string | undefined;

async function piece(grams: number, value: number) {
  const lot = await prisma.logStockTracking.create({
    data: { tracking_no: f.key(`P${Math.random().toString(36).slice(2, 7)}`), tracking_date: date, item_id: f.material, source_doc_type_id: s.docTypeId, source_doc_id: s.docId, source_no: s.no, created_by: f.actor },
  });
  await prisma.$transaction((t) => enterProduction(t, { lotId: lot.id, itemId: f.material, unitId: ids.p, baseQty: grams, value, date, source: s, actorId: f.actor }));
  return (await availableBuckets({ unitIds: [ids.p], stage: "Preparation" })).find((b) => b.lotId === lot.id)!;
}

async function close(over: Partial<BoxInput>) {
  const r = await closeBox({ unit_id: ids.p, box_date: today, bom_id: ids.bom, pieces: [], ...over }, f.actor);
  if (r.ok) boxes.push(r.id);
  return r;
}

before(async () => {
  await openFiscalYear();
  f = await makeProductionFixture("BX");
  s = await sourceOf("log_stock_issue", "SI/TEST/BX");
  const a = f.actor;
  ids.p = (await prisma.refUnit.create({ data: { unit_code: `test.${f.key("P")}`, unit_label: f.key("P"), unit_name: "Packing", created_by: a, steps: { create: [{ seq: 1, process: "Assembly" }] } } })).id;
  const pcs = (await prisma.refUom.findFirstOrThrow({ where: { uom_label: "PCS" } })).id;
  ids.kotak = (await prisma.mItem.create({ data: { item_code: `test.${f.key("KTK")}`, item_label: f.key("KTK"), item_name: "Kotak Uji", item_type: "Barang", category_id: f.category, base_uom_id: pcs, track_stock: true, created_by: a } })).id;
  ids.aux = (await prisma.mItem.create({ data: { item_code: `test.${f.key("AUX")}`, item_label: f.key("AUX"), item_name: "Stiker Uji", item_type: "Barang", category_id: f.category, base_uom_id: pcs, track_stock: true, created_by: a } })).id;
  ids.bom = (
    await prisma.prdBom.create({
      data: { bom_code: `test.${f.key("BOM")}`, bom_label: f.key("BOM"), bom_name: "Uji", item_id: ids.kotak, target_grams: 50, tolerance_grams: 1, min_pieces: 3, max_pieces: 5, created_by: a, components: { create: [{ item_id: ids.aux, qty: 2 }] } },
    })
  ).id;
  // Bahan penolong held by the Unit: 3 stickers worth Rp 300.
  const auxLot = await prisma.logStockTracking.create({ data: { tracking_no: f.key("AUXL"), tracking_date: date, item_id: ids.aux, source_doc_type_id: s.docTypeId, source_doc_id: s.docId, source_no: s.no, created_by: a } });
  await prisma.$transaction((t) => enterProduction(t, { lotId: auxLot.id, itemId: ids.aux, unitId: ids.p, baseQty: 3, value: 300, auxiliary: true, date, source: s, actorId: a }));
  ids.absorbed = await makeAccount({ subcategoryLabel: "5.1.1" });
  savedAbsorbed = (await prisma.sysSetting.findUnique({ where: { setting_key: ABSORBED } }))?.setting_value ?? undefined;
  await prisma.sysSetting.upsert({ where: { setting_key: ABSORBED }, update: { setting_value: String(ids.absorbed) }, create: { setting_key: ABSORBED, setting_value: String(ids.absorbed), updated_by: a } });
  activeBefore = (await prisma.prdRateVersion.findMany({ where: { status: "Active" }, select: { id: true } })).map((v) => v.id);
  await prisma.prdRateVersion.updateMany({ where: { status: "Active" }, data: { status: "Inactive" } });
  ids.version = (await prisma.prdRateVersion.create({ data: { rate_code: `test.${f.key("V")}`, rate_label: f.key("V"), rate_name: "Uji", status: "Active", created_by: a, lines: { create: [{ unit_id: ids.p, rate: 10 }] } } })).id;
});

after(async () => {
  const journals = (await prisma.prdBox.findMany({ where: { id: { in: boxes } }, select: { journal_id: true } })).flatMap((b) => (b.journal_id ? [b.journal_id] : []));
  await prisma.auditLog.deleteMany({ where: { entity_key: "prd_box", row_id: { in: boxes } } });
  await prisma.prdBox.deleteMany({ where: { id: { in: boxes } } });
  await prisma.accJournalLine.deleteMany({ where: { journal_id: { in: journals } } });
  await prisma.accJournal.deleteMany({ where: { id: { in: journals } } });
  await cleanupProduction([f.material, f.product, f.byproduct, ids.kotak, ids.aux]);
  await prisma.prdBom.deleteMany({ where: { id: ids.bom } });
  await prisma.logStockTracking.deleteMany({ where: { item_id: { in: [ids.kotak, ids.aux] } } });
  await prisma.mItem.deleteMany({ where: { id: { in: [ids.kotak, ids.aux] } } });
  await prisma.prdRateVersion.deleteMany({ where: { id: ids.version } });
  await prisma.prdRateVersion.updateMany({ where: { id: { in: activeBefore } }, data: { status: "Active" } });
  if (savedAbsorbed === undefined) await prisma.sysSetting.deleteMany({ where: { setting_key: ABSORBED } });
  else await prisma.sysSetting.update({ where: { setting_key: ABSORBED }, data: { setting_value: savedAbsorbed } });
  await prisma.refUnit.deleteMany({ where: { id: ids.p } });
  await f.teardown();
  await cleanupFixtures();
  await cleanupFiscalYear();
  await disconnect();
});

describe("the recommendation", () => {
  test("picks the pieces nearest the target within the count and the tolerance", () => {
    const pool = [20, 18, 15, 12.5, 12, 9.8, 5].map((g, i) => ({ id: i + 1, grams: g }));
    const r = nearestBox(pool, 50, 51, 3, 5)!;
    const sum = r.reduce((a, p) => a + p.grams, 0);
    assert.ok(Math.abs(sum - 50) <= 0.2, `got ${sum}`);
    assert.ok(r.length >= 3 && r.length <= 5);
    const rest = recommend({ target: 50, tolerance: 1, minPieces: 3, maxPieces: 5 }, [{ id: 1, grams: 20 }], pool.slice(1));
    assert.ok(Math.abs(rest.reduce((a, p) => a + p.grams, 20) - 50) <= 1);
  });
});

describe("Tutup Kotak", () => {
  test("refuses a kotak off its BoM, or without CAIQ", async () => {
    const a = await piece(20, 2_000);
    const b = await piece(20, 2_000);
    const light = await close({ pieces: [a, b].map((x, i) => ({ bucket_id: x.id, caiq: `T${i}`, manual: false })) });
    assert.ok(!light.ok && /di luar 50/.test(light.errors._pieces), JSON.stringify(light));
    const c = await piece(10, 1_000);
    const noCaiq = await close({ pieces: [a, b, c].map((x) => ({ bucket_id: x.id, caiq: "", manual: false })) });
    assert.ok(!noCaiq.ok && /CAIQ/.test(noCaiq.errors._pieces));
  });

  test("makes one No. Stok kotak in Stand By: pieces + Unit rate per gram + bahan penolong", async () => {
    const pieces = (await availableBuckets({ unitIds: [ids.p], stage: "Preparation" })).filter((b) => !b.auxiliary);
    const caiq = (i: number) => `${f.key("CQ")}${i}`;
    const r = await close({ pieces: pieces.map((x, i) => ({ bucket_id: x.id, caiq: caiq(i), manual: i === 0 })) });
    assert.ok(r.ok, JSON.stringify(r));
    assert.match(r.trackingNo, /^KTK-\d{6}-\d{3}$/);
    const doc = (await getBox(r.id))!;
    assert.equal(doc.pieces, 3);
    assert.equal(doc.grams, 50);
    assert.equal(doc.pieceList[0].manual, true);
    const box = await prisma.prdBox.findUniqueOrThrow({ where: { id: r.id } });
    assert.equal(box.base_piece_amount.toNumber(), 5_000);
    assert.equal(box.base_process_amount.toNumber(), 500, "50 g × Rp 10");
    assert.equal(box.base_aux_amount.toNumber(), 200, "2 of 3 stickers worth Rp 300");
    const [kotak] = (await availableBuckets({ unitIds: [ids.p], stage: "StandBy" })).filter((b) => b.itemId === ids.kotak);
    assert.equal(kotak.qty, 1);
    assert.equal(kotak.value, 5_700);
    assert.equal(kotak.jobId, null, "born without a Job");
    const jl = await prisma.accJournalLine.findMany({ where: { journal_id: box.journal_id! } });
    assert.equal(jl.find((l) => l.account_id === ids.absorbed)?.kredit_amount.toNumber(), 500);
    const again = await close({ pieces: [] });
    assert.ok(!again.ok);
  });

  test("a CAIQ already used and a short bahan penolong are refused", async () => {
    const a = await piece(25, 100);
    const b = await piece(15, 100);
    const c = await piece(10, 100);
    const used = await close({ pieces: [a, b, c].map((x, i) => ({ bucket_id: x.id, caiq: i === 0 ? `${f.key("CQ")}0` : `${f.key("CR")}${i}`, manual: false })) });
    assert.ok(!used.ok && /sudah dipakai/.test(used.errors._pieces), JSON.stringify(used));
    const short = await close({ pieces: [a, b, c].map((x, i) => ({ bucket_id: x.id, caiq: `${f.key("CS")}${i}`, manual: false })) });
    assert.ok(!short.ok && /tidak cukup/.test(short.errors._pieces), JSON.stringify(short));
  });
});
