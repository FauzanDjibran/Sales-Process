import test, { after, before, describe } from "node:test";
import assert from "node:assert/strict";

import { createReceiptNote, transitionReceiptNote } from "../src/lib/erp/receipt-note";
import { createStockIssue, transitionStockIssue } from "../src/lib/erp/stock-issue";
import { createGrading, getGrading, transitionGrading } from "../src/lib/erp/production-grading";
import { createQcCheck, transitionQcCheck } from "../src/lib/erp/production-qc";
import { createWork, transitionWork } from "../src/lib/erp/production-work";
import { receiveTransfer, sendTransfer } from "../src/lib/erp/production-transfer";
import { availableBuckets, wipByItem } from "../src/lib/erp/production-ledger";
import { getPurchaseOrder } from "../src/lib/erp/purchase-order";
import { cleanupFiscalYear, cleanupFixtures, cleanupStock, disconnect, makeAccount, openFiscalYear, prisma } from "./helpers";
import { cleanupProduction } from "./production-helpers";
import { purchasingWorld, type PurchasingWorld } from "./purchasing-helpers";

/**
 * SIMULASI: dari Purchase Request sampai barang dikerjakan di produksi, memakai
 * Unit asli seed (UGH Grading Halus, UPC Pre Cleaning):
 *
 *   PR → PO (Open) → Receipt Note (stok masuk per No. Stok) → BSTB Issue ke UGH
 *   (Ajukan, Terima: No. Job lahir) → No. Grading → QC Check → Push ke UPC →
 *   Pengerjaan Unit → QC Check → Stand By UPC
 *
 * Tiap langkah memeriksa angkanya; di akhir nilai stok + WIP harus sama dengan
 * nilai penerimaan, dan tiap rupiah biaya unit punya jurnalnya.
 */

const today = new Date().toISOString().slice(0, 10);
const say = (step: string, detail: string) => console.log(`  [${step}] ${detail}`);

let w: PurchasingWorld;
const ids = {} as Record<string, number>;
const docs = { rn: [] as number[], si: [] as number[], ng: [] as number[], qc: [] as number[], kj: [] as number[], tr: [] as number[] };
let activeBefore: number[] = [];
let savedWip: number | null | undefined;
let employee = 0;
const items: number[] = [];

const unit = (label: string) => prisma.refUnit.findFirstOrThrow({ where: { unit_label: label } });
const at = (unitId: number, stage: "Preparation" | "StandBy") => availableBuckets({ unitIds: [unitId], stage }).then((r) => r.filter((b) => items.includes(b.itemId) && !b.auxiliary));

before(async () => {
  await openFiscalYear();
  w = await purchasingWorld("SIM");
  const gram = (await prisma.refUom.findFirstOrThrow({ where: { uom_label: "GR" } })).id;
  ids.gram = gram;
  const mk = async (label: string, bjl = false) =>
    (
      await prisma.mItem.create({
        data: { item_code: `test.${w.key(label)}`, item_label: w.key(label), item_name: `Sarang ${label}`, item_type: "Barang", category_id: w.f.catStock, base_uom_id: gram, can_buy: true, track_stock: true, is_bjl: bjl, created_by: w.actor },
      })
    ).id;
  ids.raw = await mk("MENTAH");
  ids.gradeA = await mk("HALUS-A");
  ids.gradeB = await mk("HALUS-B");
  ids.bjl = await mk("BJL", true);
  items.push(ids.raw, ids.gradeA, ids.gradeB, ids.bjl);

  // The category needs a WIP account, and Account Mapping the two production accounts.
  const wip = await makeAccount({ subcategoryLabel: "1.1.5" });
  const cat = await prisma.accItemCategoryAccount.findUniqueOrThrow({ where: { category_id: w.f.catStock } });
  savedWip = cat.wip_account_id;
  await prisma.accItemCategoryAccount.update({ where: { category_id: w.f.catStock }, data: { wip_account_id: wip } });
  await w.setMapping("production_absorbed_account", String(await makeAccount({ subcategoryLabel: "5.1.1" })));
  await w.setMapping("production_scrap_account", String(await makeAccount({ subcategoryLabel: "5.1.9" })));
  ids.wip = wip;

  // A Standard Cost of this suite alone: Rp 10 per gram at Grading Halus, Rp 5 at Pre Cleaning.
  const ugh = await unit("UGH");
  const upc = await unit("UPC");
  const step = async (u: number, process: "Grading" | "Assign") => (await prisma.refUnitStep.findFirstOrThrow({ where: { unit_id: u, process } })).id;
  activeBefore = (await prisma.prdRateVersion.findMany({ where: { status: "Active" }, select: { id: true } })).map((v) => v.id);
  await prisma.prdRateVersion.updateMany({ where: { status: "Active" }, data: { status: "Inactive" } });
  ids.version = (
    await prisma.prdRateVersion.create({
      data: {
        rate_code: `test.${w.key("V")}`,
        rate_label: w.key("V"),
        rate_name: "Simulasi",
        status: "Active",
        created_by: w.actor,
        lines: { create: [{ unit_step_id: await step(ugh.id, "Grading"), rate: 10 }, { unit_step_id: await step(upc.id, "Assign"), rate: 5 }] },
      },
    })
  ).id;
  employee = (await prisma.mEmployee.create({ data: { employee_code: `test.${w.key("EMP")}`, employee_label: w.key("EMP"), employee_name: "Ani", created_by: w.actor } })).id;
});

after(async () => {
  await prisma.prdAuxUse.deleteMany({ where: { OR: [{ grading_id: { in: docs.ng } }, { work_id: { in: docs.kj } }] } });
  await prisma.prdTransfer.deleteMany({ where: { id: { in: docs.tr } } });
  await prisma.prdGrading.deleteMany({ where: { id: { in: docs.ng } } });
  await prisma.prdWork.deleteMany({ where: { id: { in: docs.kj } } });
  await prisma.prdQcCheck.deleteMany({ where: { id: { in: docs.qc } } });
  await prisma.auditLog.deleteMany({ where: { entity_key: { in: ["prd_grading", "prd_work", "prd_qc_check", "prd_transfer", "log_stock_issue", "log_receipt_note"] }, row_id: { in: [...docs.ng, ...docs.kj, ...docs.qc, ...docs.tr, ...docs.si, ...docs.rn] } } });
  await cleanupProduction(items);
  await prisma.prdCostEntry.deleteMany({ where: { rate_version_id: ids.version } });
  await prisma.prdRateVersionLine.deleteMany({ where: { version_id: ids.version } });
  await prisma.prdRateVersion.deleteMany({ where: { id: ids.version } });
  await prisma.prdRateVersion.updateMany({ where: { id: { in: activeBefore } }, data: { status: "Active" } });
  await prisma.logStockIssueTracking.deleteMany({ where: { line: { stock_issue_id: { in: docs.si } } } });
  await prisma.logStockIssueLine.deleteMany({ where: { stock_issue_id: { in: docs.si } } });
  await prisma.logStockIssue.deleteMany({ where: { id: { in: docs.si } } });
  await prisma.logReceiptNoteTracking.deleteMany({ where: { line: { receipt_note_id: { in: docs.rn } } } });
  await prisma.logReceiptNoteLine.deleteMany({ where: { receipt_note_id: { in: docs.rn } } });
  await prisma.logReceiptNote.deleteMany({ where: { id: { in: docs.rn } } });
  await prisma.mEmployee.deleteMany({ where: { id: employee } });
  await prisma.accItemCategoryAccount.update({ where: { category_id: w.f.catStock }, data: { wip_account_id: savedWip ?? null } });
  await cleanupStock(items);
  await w.teardown();
  // The items last: the PR and PO lines of the world name them.
  await prisma.mItem.deleteMany({ where: { id: { in: items } } });
  await cleanupFixtures();
  await cleanupFiscalYear();
  await disconnect();
});

describe("dari beli sampai dikerjakan di produksi", () => {
  test("1. PR → PO: 5.000 g sarang mentah dipesan Rp 40 per gram, PO Open", async () => {
    const po = await w.openPO([{ item: ids.raw, qty: 5_000, price: 40, uom: ids.gram }], { taxable: false });
    ids.po = po.id;
    ids.poLine = po.lineIds[0];
    const view = (await getPurchaseOrder(po.id))!;
    assert.equal(view.status, "Open");
    const pr = await prisma.purRequest.findFirstOrThrow({ where: { id: { in: w.ids.pr } } });
    assert.equal(pr.status, "Closed", "PR menutup sendiri karena seluruhnya sudah dipesan");
    say("PR → PO", `${pr.request_no} → ${po.orderNo} (Open)`);
  });

  test("2. Receipt Note: barang diterima, masuk stok per No. Stok bernilai Rp 200.000", async () => {
    const lotNo = w.key("LOT1");
    const rn = await createReceiptNote(
      { source_doc_id: ids.po, rn_date: today, warehouse_id: w.f.warehouse, supplier_dn_no: "SJ-SIM-1", note: "" },
      [{ source_doc_line_id: ids.poLine, qty: 5_000, note: "", lots: [{ tracking_no: lotNo, expiry_date: "", qty: 5_000 }] }],
      w.actor
    );
    assert.ok(rn.ok, JSON.stringify(rn));
    docs.rn.push(rn.id);
    const p = await transitionReceiptNote(rn.id, "post", w.actor);
    assert.ok(p.ok, JSON.stringify(p));
    const lot = await prisma.logStockTracking.findFirstOrThrow({ where: { tracking_no: lotNo } });
    ids.lot = lot.id;
    const pool = await prisma.logStockValuationBalance.findFirstOrThrow({ where: { item_id: ids.raw } });
    assert.deepEqual([pool.qty_balance.toNumber(), pool.value_balance.toNumber()], [5_000, 200_000]);
    assert.equal((await getPurchaseOrder(ids.po))!.status, "Closed", "PO menutup sendiri setelah diterima penuh");
    say("Receipt Note", `${rn.rnNo}: No. Stok ${lotNo}, 5.000 g, Rp 200.000`);
  });

  test("3. BSTB Issue ke UGH: Ajukan mengunci stok, Terima memasukkan ke Persiapan Grading dengan No. Job baru", async () => {
    const ugh = await unit("UGH");
    const si = await createStockIssue(
      { purpose: "production_issue", warehouse_id: w.f.warehouse, unit_id: ugh.id, issue_date: today, note: "" },
      [{ item_id: ids.raw, qty: 3_000, note: "", picks: [{ tracking_id: ids.lot, location_id: null, qty: 3_000 }] }],
      w.actor
    );
    assert.ok(si.ok, JSON.stringify(si));
    docs.si.push(si.id);
    const submit = await transitionStockIssue(si.id, "submit", w.actor);
    assert.ok(submit.ok, JSON.stringify(submit));
    const bal = await prisma.logStockBalance.findFirstOrThrow({ where: { tracking_id: ids.lot } });
    assert.deepEqual([bal.qty_balance.toNumber(), bal.reserved_qty.toNumber()], [5_000, 3_000], "Diajukan: stok terkunci, belum pindah");
    assert.equal((await at(ugh.id, "Preparation")).length, 0, "belum ada di produksi sebelum Terima");
    const got = await transitionStockIssue(si.id, "post", w.actor);
    assert.ok(got.ok, JSON.stringify(got));

    const [held] = await at(ugh.id, "Preparation");
    assert.equal(held.qty, 3_000);
    assert.equal(held.value, 120_000, "3.000 g × Rp 40");
    assert.ok(held.jobId, "No. Job pertama lahir saat Terima");
    assert.equal(held.stepProcess, "Grading", "masuk Persiapan proses pertama UGH");
    ids.job = held.jobId!;
    const stock = await prisma.logStockValuationBalance.findFirstOrThrow({ where: { item_id: ids.raw } });
    assert.deepEqual([stock.qty_balance.toNumber(), stock.value_balance.toNumber()], [2_000, 80_000], "sisa di gudang");
    say("BSTB Issue", `${si.issueNo}: 3.000 g → Persiapan UGH, ${held.jobNo}, nilai Rp 120.000`);
  });

  test("4. No. Grading di UGH: satu Job menjadi tiga No. Stok baru, biaya unit Rp 10/g masuk", async () => {
    const ugh = await unit("UGH");
    const ng = await createGrading(
      {
        unit_id: ugh.id,
        grading_date: today,
        note: "",
        items: [{ job_id: ids.job, bucket_id: null, qty: "", outputs: [{ item_id: ids.gradeA, grams: "1500" }, { item_id: ids.gradeB, grams: "1200" }, { item_id: ids.bjl, grams: "300" }] }],
        aux: [],
      },
      w.actor
    );
    assert.ok(ng.ok, JSON.stringify(ng));
    docs.ng.push(ng.id);
    const p = await transitionGrading(ng.id, "post", w.actor);
    assert.ok(p.ok, JSON.stringify(p));
    const g = (await getGrading(ng.id))!;
    assert.equal(g.inputValue, 120_000);
    assert.equal(g.cost, 30_000, "3.000 g × Rp 10");
    // Whole value over non-BJL by gram: 150.000 × 1500/2700 and 1200/2700; BJL is 0.
    assert.deepEqual(g.outputs.map((o) => o.value), [83_333, 66_667, 0]);
    assert.equal(g.outputs.reduce((a, o) => a + o.value, 0), 150_000);
    assert.ok(g.outputs.every((o) => o.trackingNo?.endsWith(`-${g.outputs.indexOf(o) + 1}`)));
    const waiting = await at(ugh.id, "Preparation");
    assert.equal(waiting.length, 3, "tiga hasil menunggu di Persiapan QC");
    assert.ok(waiting.every((b) => b.stepProcess === "QC" && b.jobId === null), "grading melepas No. Job");
    say("No. Grading", `${g.no}: 3.000 g → ${g.outputs.map((o) => `${o.trackingNo} (${o.grams} g)`).join(", ")}`);
  });

  test("5. QC Check di UGH: semua Lulus, barang menunggu di Stand By", async () => {
    const ugh = await unit("UGH");
    const rows = await at(ugh.id, "Preparation");
    const qc = await createQcCheck({ unit_id: ugh.id, qc_date: today, inspector: "QC", note: "", lines: rows.map((b) => ({ bucket_id: b.id, decision: "Pass", reason: "" })) }, w.actor);
    assert.ok(qc.ok, JSON.stringify(qc));
    docs.qc.push(qc.id);
    assert.ok((await transitionQcCheck(qc.id, "post", w.actor)).ok);
    assert.equal((await at(ugh.id, "StandBy")).length, 3);
    assert.equal((await at(ugh.id, "Preparation")).length, 0);
    say("QC Check", `${qc.no}: 3 baris Lulus → Stand By UGH`);
  });

  test("6. Dokumen Push UGH → UPC (satu Workstation): masuk Persiapan Assign, tiap ambilan bernomor Job baru", async () => {
    const ugh = await unit("UGH");
    const upc = await unit("UPC");
    const rows = await at(ugh.id, "StandBy");
    const r = await sendTransfer({ from_unit_id: ugh.id, to_unit_id: upc.id, transfer_date: today, line_id: null, note: "", lines: rows.map((b) => ({ bucket_id: b.id, qty: b.qty })) }, w.actor);
    assert.ok(r.ok, JSON.stringify(r));
    docs.tr.push(r.id);
    assert.equal(r.kind, "Push");
    assert.equal(r.status, "Posted");
    const arrived = await at(upc.id, "Preparation");
    assert.equal(arrived.length, 3);
    assert.ok(arrived.every((b) => b.stepProcess === "Assign" && b.jobId), "tiap ambilan mendapat No. Job");
    assert.equal(new Set(arrived.map((b) => b.jobId)).size, 3);
    assert.equal((await at(ugh.id, "StandBy")).length, 0);
    say("Push", `${r.no}: 3 baris UGH → Persiapan UPC, ${arrived.map((b) => b.jobNo).join(", ")}`);
  });

  test("7. Pengerjaan Unit di UPC: gram tetap, biaya Rp 5/g menambah nilai, hasil menunggu QC", async () => {
    const upc = await unit("UPC");
    const rows = await at(upc.id, "Preparation");
    const valueBefore = rows.reduce((a, b) => a + b.value, 0);
    const kj = await createWork({ unit_id: upc.id, work_date: today, result_note: "Bersih, bulu halus", note: "", lines: rows.map((b) => ({ bucket_id: b.id, qty: b.qty, employee_id: employee })), aux: [] }, w.actor);
    assert.ok(kj.ok, JSON.stringify(kj));
    docs.kj.push(kj.id);
    const p = await transitionWork(kj.id, "post", w.actor);
    assert.ok(p.ok, JSON.stringify(p));
    const after = await at(upc.id, "Preparation");
    assert.equal(after.length, 3);
    assert.ok(after.every((b) => b.stepProcess === "QC"), "hasil menunggu di Persiapan QC UPC");
    assert.equal(after.reduce((a, b) => a + (b.grams ?? 0), 0), 3_000, "gram tidak berubah");
    // 3.000 g × Rp 5 = Rp 15.000, shared back over the non-BJL goods (BJL carries its cost to them).
    assert.equal(after.reduce((a, b) => a + b.value, 0), valueBefore + 15_000);
    say("Pengerjaan Unit", `${rows.length} Job dikerjakan, biaya Rp 15.000, nilai ${valueBefore} → ${valueBefore + 15_000}`);
  });

  test("8. QC Check di UPC → Stand By UPC; stok + WIP = nilai penerimaan, dan biaya unit punya jurnalnya", async () => {
    const upc = await unit("UPC");
    const rows = await at(upc.id, "Preparation");
    const qc = await createQcCheck({ unit_id: upc.id, qc_date: today, inspector: "QC", note: "", lines: rows.map((b) => ({ bucket_id: b.id, decision: "Pass", reason: "" })) }, w.actor);
    assert.ok(qc.ok, JSON.stringify(qc));
    docs.qc.push(qc.id);
    assert.ok((await transitionQcCheck(qc.id, "post", w.actor)).ok);
    const done = await at(upc.id, "StandBy");
    assert.equal(done.length, 3);
    assert.deepEqual(done.map((b) => b.grams).sort((a, b) => (a ?? 0) - (b ?? 0)), [300, 1200, 1500]);

    // The books agree: WIP in production = Σ buckets; stock left + production = what was bought + the unit cost absorbed.
    const wip = (await wipByItem()).get(ids.gradeA) ?? 0;
    const buckets = done.filter((b) => b.itemId === ids.gradeA).reduce((a, b) => a + b.value, 0);
    assert.equal(wip, buckets);
    const production = done.reduce((a, b) => a + b.value, 0);
    const stock = (await prisma.logStockValuationBalance.findFirstOrThrow({ where: { item_id: ids.raw } })).value_balance.toNumber();
    assert.equal(production, 120_000 + 30_000 + 15_000, "bahan Rp 120.000 + biaya UGH Rp 30.000 + biaya UPC Rp 15.000");
    assert.equal(stock + production, 200_000 + 45_000, "nilai pembelian + biaya unit yang dibebankan");
    const absorbed = await prisma.accJournalLine.aggregate({ _sum: { kredit_amount: true }, where: { account_id: Number(await settingId("production_absorbed_account")) } });
    assert.equal(absorbed._sum.kredit_amount?.toNumber(), 45_000, "biaya unit dikreditkan ke Biaya Produksi Dibebankan");
    say("Selesai", `3 No. Stok di Stand By UPC, nilai produksi Rp ${production}, stok gudang Rp ${stock}`);
  });
});

async function settingId(key: string) {
  return (await prisma.sysSetting.findUniqueOrThrow({ where: { setting_key: key } })).setting_value;
}
