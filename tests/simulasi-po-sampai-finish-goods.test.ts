import test, { after, before, describe } from "node:test";
import assert from "node:assert/strict";

import { createReceiptNote, transitionReceiptNote } from "../src/lib/erp/receipt-note";
import { createStockIssue, transitionStockIssue } from "../src/lib/erp/stock-issue";
import { createGrading, transitionGrading } from "../src/lib/erp/production-grading";
import { createQcCheck, transitionQcCheck } from "../src/lib/erp/production-qc";
import { createWork, transitionWork } from "../src/lib/erp/production-work";
import { closeKerja, startKerja } from "../src/lib/erp/production-kerja";
import { postJobOrder } from "../src/lib/erp/production-job-order";
import { closeBox } from "../src/lib/erp/production-box";
import { receiveTransfer, sendTransfer } from "../src/lib/erp/production-transfer";
import { getProductionReceipt, receiveFinishGoods, sendFinishGoods } from "../src/lib/erp/production-receipt";
import { availableBuckets, unitStepsOf, type BucketView } from "../src/lib/erp/production-ledger";
import { cleanupFiscalYear, cleanupFixtures, cleanupStock, disconnect, makeAccount, openFiscalYear, prisma } from "./helpers";
import { cleanupProduction } from "./production-helpers";
import { purchasingWorld, type PurchasingWorld } from "./purchasing-helpers";

/**
 * SIMULASI 7.8 (P306): dari Purchase Order sampai Gudang Finish Goods, melewati
 * seluruh routing Reguler dengan Unit asli seed:
 *
 *   PO → Receipt Note → BSTB Issue ke UGH → UGH › UPC › UPY (sebelum partai)
 *   → BSTB Penyebaran (partai lahir) → UPW › UCL (Kerja) › UC1 › USR › UDA
 *   (checkpoint) › UML (Grading, Job Order, Assign) › UDB › UWP › UBC
 *   (checkpoint; 11 keping) › UP5 (Kotak 10 keping) → BSTB ke Finish Goods,
 *   dan keping sisa → BSTB Pengeluaran Tanpa nilai.
 *
 * Tiap Unit dikerjakan menurut prosesnya sendiri (`ref_unit_step`), lalu dikirim
 * ke Unit berikutnya pada routing. Di akhir: stok + WIP + beban = pembelian +
 * biaya Unit, rupiah demi rupiah.
 */

const today = new Date().toISOString().slice(0, 10);
const say = (step: string, detail: string) => console.log(`  [${step}] ${detail}`);
const ROUTE = ["UPW", "UCL", "UC1", "USR", "UDA", "UML", "UDB", "UWP", "UBC", "UP5"];
const PRE = ["UGH", "UPC", "UPY"];

let w: PurchasingWorld;
const ids = {} as Record<string, number>;
const docs = { rn: [] as number[], si: [] as number[], ng: [] as number[], qc: [] as number[], kj: [] as number[], tr: [] as number[], kerja: [] as number[], jo: [] as number[], box: [] as number[], bpr: [] as number[] };
const items: number[] = [];
const partais = new Set<number>();
let activeBefore: number[] = [];
let savedWip: number | null | undefined;

const unit = (label: string) => prisma.refUnit.findFirstOrThrow({ where: { unit_label: label } });
const at = async (unitId: number, stage: BucketView["stage"]) => {
  const rows = (await availableBuckets({ unitIds: [unitId], stage })).filter((b) => items.includes(b.itemId) && !b.auxiliary && b.qty > 0);
  for (const b of rows) if (b.partaiId) partais.add(b.partaiId);
  return rows;
};
const gramsOf = (rows: BucketView[]) => rows.reduce((a, b) => a + (b.grams ?? 0), 0);

/** Every process of a Unit in its order, then its QC Check: what the floor does there. */
async function workAt(label: string) {
  const u = await unit(label);
  for (const step of await unitStepsOf(prisma, u.id)) {
    const rows = (await at(u.id, "Preparation")).filter((b) => b.stepId === step.id);
    if (!rows.length) continue;
    if (step.process === "Grading") {
      // One row per Job taken whole, a No. Stok without a Job taken all of it; one output each.
      const byJob = new Map<string, BucketView[]>();
      for (const b of rows) byJob.set(b.jobId ? `j${b.jobId}` : `b${b.id}`, [...(byJob.get(b.jobId ? `j${b.jobId}` : `b${b.id}`) ?? []), b]);
      const pieces = label === "UBC";
      const r = await createGrading(
        {
          unit_id: u.id,
          grading_date: today,
          note: "",
          aux: [],
          items: [...byJob.values()].map((g) => ({
            job_id: g[0].jobId,
            bucket_id: g[0].jobId ? null : g[0].id,
            qty: g[0].jobId ? "" : g[0].qty,
            // Barcoding cuts keping of 5 g; elsewhere the goods keep their gram as a new No. Stok.
            outputs: pieces ? Array.from({ length: 11 }, () => ({ item_id: ids.piece, grams: "5" })) : [{ item_id: ids.graded, grams: String(gramsOf(g)) }],
          })),
        },
        w.actor
      );
      assert.ok(r.ok, `${label} grading: ${JSON.stringify(r)}`);
      docs.ng.push(r.id);
      const p = await transitionGrading(r.id, "post", w.actor);
      assert.ok(p.ok, `${label} grading post: ${JSON.stringify(p)}`);
    } else if (step.process === "Assign") {
      const r = await createWork({ unit_id: u.id, work_date: today, result_note: "", note: "", aux: [], lines: rows.map((b) => ({ bucket_id: b.id, qty: b.qty, employee_id: ids.employee })) }, w.actor);
      assert.ok(r.ok, `${label} pengerjaan: ${JSON.stringify(r)}`);
      docs.kj.push(r.id);
      const p = await transitionWork(r.id, "post", w.actor);
      assert.ok(p.ok, `${label} pengerjaan post: ${JSON.stringify(p)}`);
    } else if (step.process === "Kerja") {
      const r = await startKerja({ unit_id: u.id, kerja_date: today, note: "", lines: rows.map((b) => ({ bucket_id: b.id, employee_id: ids.employee })) }, w.actor);
      assert.ok(r.ok, `${label} mulai kerja: ${JSON.stringify(r)}`);
      docs.kerja.push(r.id);
      const working = await at(u.id, "Working");
      const done = await closeKerja(working.map((b) => b.id), "finish", today, w.actor);
      assert.ok(done.ok, `${label} selesai kerja: ${JSON.stringify(done)}`);
    } else if (step.process === "JobOrder") {
      const r = await postJobOrder({ unit_id: u.id, doc_date: today, note: "", lines: [{ target_item_id: ids.moulded, parts: rows.map((b) => ({ bucket_id: b.id, qty: b.qty })) }] }, w.actor);
      assert.ok(r.ok, `${label} job order: ${JSON.stringify(r)}`);
      docs.jo.push(r.id);
    } else {
      assert.fail(`${label}: proses ${step.process} tidak dijalankan oleh simulasi ini`);
    }
  }
  const waiting = await at(u.id, "QcCheck");
  if (waiting.length) {
    const qc = await createQcCheck({ unit_id: u.id, qc_date: today, inspector: "QC", note: "", lines: waiting.map((b) => ({ bucket_id: b.id, decision: "Pass", reason: "" })) }, w.actor);
    assert.ok(qc.ok, `${label} qc: ${JSON.stringify(qc)}`);
    docs.qc.push(qc.id);
    const p = await transitionQcCheck(qc.id, "post", w.actor);
    assert.ok(p.ok, `${label} qc post: ${JSON.stringify(p)}`);
  }
}

/** Kirim everything in Stand By to the next Unit: a Push lands at once, a BSTB is received. */
async function moveOn(from: string, to: string, lineId: number | null = null) {
  const a = await unit(from);
  const b = await unit(to);
  const rows = await at(a.id, "StandBy");
  assert.ok(rows.length, `${from}: Stand By kosong`);
  const r = await sendTransfer({ from_unit_id: a.id, to_unit_id: b.id, transfer_date: today, line_id: lineId, note: "", lines: rows.map((x) => ({ bucket_id: x.id, qty: x.qty })) }, w.actor);
  assert.ok(r.ok, `${from} → ${to}: ${JSON.stringify(r)}`);
  docs.tr.push(r.id);
  if (r.kind !== "Push") {
    const got = await receiveTransfer(r.id, w.actor);
    assert.ok(got.ok, `${from} → ${to} terima: ${JSON.stringify(got)}`);
  }
  return r;
}

before(async () => {
  await openFiscalYear();
  w = await purchasingWorld("S78");
  const gram = (await prisma.refUom.findFirstOrThrow({ where: { uom_label: "GR" } })).id;
  const pcs = (await prisma.refUom.findFirstOrThrow({ where: { uom_label: "PCS" } })).id;
  ids.gram = gram;
  const mk = async (label: string, uom = gram) =>
    (
      await prisma.mItem.create({
        data: { item_code: `test.${w.key(label)}`, item_label: w.key(label), item_name: `Simulasi ${label}`, item_type: "Barang", category_id: w.f.catStock, base_uom_id: uom, can_buy: true, can_sell: true, track_stock: true, created_by: w.actor },
      })
    ).id;
  ids.raw = await mk("MENTAH");
  ids.graded = await mk("HALUS");
  ids.moulded = await mk("MOULD");
  ids.piece = await mk("KEPING");
  ids.box = await mk("KOTAK", pcs);
  items.push(ids.raw, ids.graded, ids.moulded, ids.piece, ids.box);

  const cat = await prisma.accItemCategoryAccount.findUniqueOrThrow({ where: { category_id: w.f.catStock } });
  savedWip = cat.wip_account_id;
  ids.wip = await makeAccount({ subcategoryLabel: "1.1.5" });
  await prisma.accItemCategoryAccount.update({ where: { category_id: w.f.catStock }, data: { wip_account_id: ids.wip } });
  ids.absorbed = await makeAccount({ subcategoryLabel: "5.1.1" });
  ids.scrap = await makeAccount({ subcategoryLabel: "5.1.9" });
  await w.setMapping("production_absorbed_account", String(ids.absorbed));
  await w.setMapping("production_scrap_account", String(ids.scrap));

  // Rp 1 per gram at every Unit of the routing, this suite's own Standard Cost.
  const units = await prisma.refUnit.findMany({ where: { unit_label: { in: [...PRE, ...ROUTE] } }, select: { id: true } });
  activeBefore = (await prisma.prdRateVersion.findMany({ where: { status: "Active" }, select: { id: true } })).map((v) => v.id);
  await prisma.prdRateVersion.updateMany({ where: { status: "Active" }, data: { status: "Inactive" } });
  ids.version = (
    await prisma.prdRateVersion.create({
      data: { rate_code: `test.${w.key("V")}`, rate_label: w.key("V"), rate_name: "Simulasi 7.8", status: "Active", created_by: w.actor, lines: { create: units.map((u) => ({ unit_id: u.id, rate: 1 })) } },
    })
  ).id;
  ids.employee = (await prisma.mEmployee.create({ data: { employee_code: `test.${w.key("EMP")}`, employee_label: w.key("EMP"), employee_name: "Simulasi", created_by: w.actor } })).id;
  ids.bom = (
    await prisma.prdBom.create({
      data: { bom_code: `test.${w.key("BOM")}`, bom_label: w.key("BOM"), bom_name: "Simulasi 50 g", item_id: ids.box, target_grams: 50, tolerance_grams: 1, min_pieces: 8, max_pieces: 13, created_by: w.actor },
    })
  ).id;
  ids.line = (await prisma.prdRouting.findFirstOrThrow({ where: { routing_label: "REG-1" }, select: { line_id: true } })).line_id!;
});

after(async () => {
  await prisma.auditLog.deleteMany({ where: { entity_key: "log_production_receipt", row_id: { in: docs.bpr } } });
  await prisma.logProductionReceiptLine.deleteMany({ where: { receipt_id: { in: docs.bpr } } });
  await prisma.logProductionReceipt.deleteMany({ where: { id: { in: docs.bpr } } });
  await prisma.prdBox.deleteMany({ where: { id: { in: docs.box } } });
  await prisma.prdJobOrder.deleteMany({ where: { id: { in: docs.jo } } });
  await prisma.prdKerja.deleteMany({ where: { id: { in: docs.kerja } } });
  await prisma.prdAuxUse.deleteMany({ where: { OR: [{ grading_id: { in: docs.ng } }, { work_id: { in: docs.kj } }] } });
  await prisma.prdTransfer.deleteMany({ where: { id: { in: docs.tr } } });
  await prisma.prdGrading.deleteMany({ where: { id: { in: docs.ng } } });
  await prisma.prdWork.deleteMany({ where: { id: { in: docs.kj } } });
  await prisma.prdQcCheck.deleteMany({ where: { id: { in: docs.qc } } });
  await prisma.auditLog.deleteMany({
    where: { entity_key: { in: ["prd_grading", "prd_work", "prd_qc_check", "prd_transfer", "prd_kerja", "prd_job_order", "prd_box", "log_stock_issue", "log_receipt_note"] }, row_id: { in: [...docs.ng, ...docs.kj, ...docs.qc, ...docs.tr, ...docs.kerja, ...docs.jo, ...docs.box, ...docs.si, ...docs.rn] } },
  });
  await cleanupProduction(items);
  await prisma.prdPartai.deleteMany({ where: { id: { in: [...partais] } } });
  await prisma.prdCostEntry.deleteMany({ where: { rate_version_id: ids.version } });
  await prisma.prdRateVersionLine.deleteMany({ where: { version_id: ids.version } });
  await prisma.prdRateVersion.deleteMany({ where: { id: ids.version } });
  await prisma.prdRateVersion.updateMany({ where: { id: { in: activeBefore } }, data: { status: "Active" } });
  await prisma.prdBom.deleteMany({ where: { id: ids.bom } });
  await prisma.logStockIssueTracking.deleteMany({ where: { line: { stock_issue_id: { in: docs.si } } } });
  await prisma.logStockIssueLine.deleteMany({ where: { stock_issue_id: { in: docs.si } } });
  await prisma.logStockIssue.deleteMany({ where: { id: { in: docs.si } } });
  await prisma.logReceiptNoteTracking.deleteMany({ where: { line: { receipt_note_id: { in: docs.rn } } } });
  await prisma.logReceiptNoteLine.deleteMany({ where: { receipt_note_id: { in: docs.rn } } });
  await prisma.logReceiptNote.deleteMany({ where: { id: { in: docs.rn } } });
  await prisma.mEmployee.deleteMany({ where: { id: ids.employee } });
  await prisma.accItemCategoryAccount.update({ where: { category_id: w.f.catStock }, data: { wip_account_id: savedWip ?? null } });
  await cleanupStock(items);
  await w.teardown();
  await prisma.mItem.deleteMany({ where: { id: { in: items } } });
  await cleanupFixtures();
  await cleanupFiscalYear();
  await disconnect();
});

describe("simulasi 7.8: dari PO sampai Gudang Finish Goods", () => {
  test("1. PO → Receipt Note → BSTB Issue: 60 g sarang mentah Rp 100/g masuk Persiapan UGH", async () => {
    const po = await w.openPO([{ item: ids.raw, qty: 60, price: 100, uom: ids.gram }], { taxable: false });
    const lotNo = w.key("LOT");
    const rn = await createReceiptNote(
      { source_doc_id: po.id, rn_date: today, warehouse_id: w.f.warehouse, supplier_dn_no: "SJ-78", note: "" },
      [{ source_doc_line_id: po.lineIds[0], qty: 60, note: "", lots: [{ tracking_no: lotNo, expiry_date: "", qty: 60 }] }],
      w.actor
    );
    assert.ok(rn.ok, JSON.stringify(rn));
    docs.rn.push(rn.id);
    assert.ok((await transitionReceiptNote(rn.id, "post", w.actor)).ok);
    const lot = await prisma.logStockTracking.findFirstOrThrow({ where: { tracking_no: lotNo } });
    const ugh = await unit("UGH");
    const si = await createStockIssue(
      { purpose: "production_issue", warehouse_id: w.f.warehouse, unit_id: ugh.id, issue_date: today, note: "" },
      [{ item_id: ids.raw, qty: 60, note: "", picks: [{ tracking_id: lot.id, location_id: null, qty: 60 }] }],
      w.actor
    );
    assert.ok(si.ok, JSON.stringify(si));
    docs.si.push(si.id);
    assert.ok((await transitionStockIssue(si.id, "submit", w.actor)).ok);
    assert.ok((await transitionStockIssue(si.id, "post", w.actor)).ok);
    const [held] = await at(ugh.id, "Preparation");
    assert.deepEqual([held.qty, held.value], [60, 6_000]);
    say("Masuk produksi", `${rn.rnNo} → ${si.issueNo}: 60 g, Rp 6.000, ${held.jobNo}`);
  });

  test("2. Sebelum partai: UGH › UPC › UPY, lalu BSTB Penyebaran melahirkan partai di UPW", async () => {
    await workAt("UGH");
    await moveOn("UGH", "UPC");
    await workAt("UPC");
    await moveOn("UPC", "UPY");
    await workAt("UPY");
    const r = await moveOn("UPY", "UPW", ids.line);
    assert.equal(r.kind, "BstbPartai");
    const [arrived] = await at((await unit("UPW")).id, "Preparation");
    assert.ok(arrived.partaiId, "partai lahir saat Terima");
    say("Penyebaran", `${r.no}: partai ${arrived.partaiNo}`);
  });

  test("3. Routing Reguler UPW › … › UBC: setiap Unit dikerjakan menurut prosesnya, lalu dikirim", async () => {
    for (let i = 0; i < ROUTE.length - 1; i++) {
      await workAt(ROUTE[i]);
      const r = await moveOn(ROUTE[i], ROUTE[i + 1]);
      say(ROUTE[i], `${r.no} → ${ROUTE[i + 1]}`);
    }
    const pieces = await at((await unit("UP5")).id, "Preparation");
    assert.equal(pieces.length, 11, "UBC memotong 11 keping 5 g");
    assert.ok(pieces.every((p) => p.grams === 5));
  });

  test("4. UP5: Kotak 10 keping 50 g; BSTB ke Finish Goods; keping sisa keluar Tanpa nilai", async () => {
    const up5 = await unit("UP5");
    const pieces = await at(up5.id, "Preparation");
    const box = await closeBox({ unit_id: up5.id, box_date: today, bom_id: ids.bom, pieces: pieces.slice(0, 10).map((p, i) => ({ bucket_id: p.id, caiq: w.key(`CAIQ${i}`), manual: true })) }, w.actor);
    assert.ok(box.ok, JSON.stringify(box));
    docs.box.push(box.id);
    const [kotak] = await at(up5.id, "StandBy");
    assert.equal(kotak.itemId, ids.box);

    const fg = await sendFinishGoods({ purpose: "finish_goods", from_unit_id: up5.id, warehouse_id: w.f.warehouse, receipt_date: today, note: "", lines: [{ bucket_id: kotak.id, qty: kotak.qty }] }, w.actor);
    assert.ok(fg.ok, JSON.stringify(fg));
    docs.bpr.push(fg.id);
    assert.ok((await receiveFinishGoods(fg.id, w.actor)).ok);
    const inStock = await prisma.logStockBalance.findFirstOrThrow({ where: { warehouse_id: w.f.warehouse, tracking_id: kotak.lotId } });
    assert.equal(inStock.qty_balance.toNumber(), 1, "kotak masuk gudang dengan No. Stok yang sama");

    const [left] = await at(up5.id, "Preparation");
    const out = await sendFinishGoods({ purpose: "return", from_unit_id: up5.id, warehouse_id: w.f.warehouse, receipt_date: today, note: "keping sisa", lines: [{ bucket_id: left.id, qty: left.qty }] }, w.actor);
    assert.ok(out.ok, JSON.stringify(out));
    docs.bpr.push(out.id);
    assert.ok((await receiveFinishGoods(out.id, w.actor, { valueMode: "none" })).ok);
    say("Selesai", `${box.trackingNo} → ${fg.no} (Rp ${(await getProductionReceipt(fg.id))!.cost}); keping ${left.lotNo} → ${out.no}`);
  });

  test("5. Rupiah demi rupiah: stok + WIP + beban = pembelian + biaya Unit; produksi kosong", async () => {
    const leftInProduction = (await prisma.prdBalance.aggregate({ _sum: { value_balance: true, qty_balance: true }, where: { item_id: { in: items } } }))._sum;
    assert.equal(leftInProduction.qty_balance?.toNumber() ?? 0, 0, "semua barang sudah keluar produksi");
    const stock = (await prisma.logStockValuationBalance.aggregate({ _sum: { value_balance: true }, where: { item_id: { in: items } } }))._sum.value_balance?.toNumber() ?? 0;
    const cost = (await prisma.prdCostEntry.aggregate({ _sum: { amount: true }, where: { rate_version_id: ids.version } }))._sum.amount?.toNumber() ?? 0;
    const beban = (await prisma.accJournalLine.aggregate({ _sum: { debit_amount: true }, where: { account_id: ids.scrap } }))._sum.debit_amount?.toNumber() ?? 0;
    const absorbed = (await prisma.accJournalLine.aggregate({ _sum: { kredit_amount: true }, where: { account_id: ids.absorbed } }))._sum.kredit_amount?.toNumber() ?? 0;
    assert.ok(cost > 0, "biaya Unit dibebankan di sepanjang routing");
    assert.equal(absorbed, cost, "setiap rupiah biaya Unit punya jurnalnya");
    assert.equal(stock + (leftInProduction.value_balance?.toNumber() ?? 0) + beban, 6_000 + cost);
    const wipGl = await prisma.accJournalLine.aggregate({ _sum: { debit_amount: true, kredit_amount: true }, where: { account_id: ids.wip } });
    assert.equal((wipGl._sum.debit_amount?.toNumber() ?? 0) - (wipGl._sum.kredit_amount?.toNumber() ?? 0), 0, "akun WIP kembali nol");
    say("Neraca", `pembelian Rp 6.000 + biaya Unit Rp ${cost} = stok Rp ${stock} + beban Rp ${beban}`);
  });
});
