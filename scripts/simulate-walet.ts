/**
 * Walks ONE Job of sarang walet from a Purchase Order to a kotak at Packing 95,
 * through the same functions the screens call, on the data of
 * `db:seed-production` + `db:seed-production-showcase` (P280). Development only:
 * it posts real documents, so run it on a database you may fill.
 *
 *   PR → PO → Receipt Note (Gudang Bahan Baku) → BSTB Issue ke UGH (+ bahan
 *   penolong ke UP5) → UGH → UPC → UPY → BSTB Partai → UPW → UCL (Kerja) → UC1
 *   → USR → BSTB → UDA → UML (Grading, Job Order, Assign) → UDB → BSTB → UWP →
 *   UBC (keping) → UP5 → Kotak BMK50
 *
 * Prints the gram and value the goods carry after every Unit, and at the end
 * the kotak's value split into pieces, the UP5 rate and bahan penolong.
 * `npm run db:simulate-walet`.
 */
import { prisma } from "../src/lib/prisma";
import { createPurchaseRequest, transitionPurchaseRequest } from "../src/lib/erp/purchase-request";
import { createPurchaseOrder, transitionPurchaseOrder } from "../src/lib/erp/purchase-order";
import { createReceiptNote, transitionReceiptNote } from "../src/lib/erp/receipt-note";
import { receiveProductionReceipt } from "../src/lib/erp/production-receipt";
import { createStockIssue, transitionStockIssue } from "../src/lib/erp/stock-issue";
import { createGrading, transitionGrading, type GradingItemInput } from "../src/lib/erp/production-grading";
import { createQcCheck, transitionQcCheck } from "../src/lib/erp/production-qc";
import { createWork, transitionWork } from "../src/lib/erp/production-work";
import { receiveTransfer, sendTransfer } from "../src/lib/erp/production-transfer";
import { closeKerja, startKerja } from "../src/lib/erp/production-kerja";
import { postJobOrder } from "../src/lib/erp/production-job-order";
import { closeBox } from "../src/lib/erp/production-box";
import { availableBuckets, unitStepsOf, type BucketView } from "../src/lib/erp/production-ledger";

const today = new Date().toISOString().slice(0, 10);
const tag = Date.now().toString(36).slice(-5).toUpperCase();
let actor = 0;
const rupiah = (n: number) => `Rp ${Math.round(n).toLocaleString("id-ID")}`;

function ok<T extends { ok: boolean }>(r: T, what: string): Extract<T, { ok: true }> {
  if (!r.ok) throw new Error(`${what}: ${JSON.stringify((r as unknown as { errors?: unknown }).errors ?? r)}`);
  return r as Extract<T, { ok: true }>;
}
const unit = (label: string) => prisma.refUnit.findFirstOrThrow({ where: { unit_label: label } });
const item = (label: string) => prisma.mItem.findFirstOrThrow({ where: { item_label: label }, include: { weighting: true } });
const goods = (b: BucketView[]) => b.filter((x) => !x.auxiliary && x.qty > 0);

async function stepId(unitId: number, process: string) {
  return (await unitStepsOf(prisma, unitId)).find((s) => s.process === process)!.id;
}
async function persiapan(unitId: number, process: string) {
  const id = await stepId(unitId, process);
  return goods(await availableBuckets({ unitIds: [unitId], stage: "Preparation" })).filter((b) => b.stepId === id);
}
async function report(label: string) {
  const u = await unit(label);
  const all = goods(await availableBuckets({ unitIds: [u.id] }));
  const g = all.reduce((a, b) => a + (b.grams ?? 0), 0);
  const v = all.reduce((a, b) => a + b.value, 0);
  console.log(`  ${label.padEnd(4)} ${String(Math.round(g * 100) / 100).padStart(8)} g   nilai ${rupiah(v).padStart(14)}   (${all.map((b) => b.stage).filter((s, i, a) => a.indexOf(s) === i).join(", ")})`);
}

/** Grading of everything waiting at the Unit's Grading step: each Job or loose No. Stok becomes the outputs `make` gives it. */
async function grade(label: string, make: (b: BucketView[], grams: number) => { item_id: number; grams: string }[]) {
  const u = await unit(label);
  const rows = await persiapan(u.id, "Grading");
  const groups = new Map<string, BucketView[]>();
  for (const b of rows) groups.set(b.jobId ? `j${b.jobId}` : `b${b.id}`, [...(groups.get(b.jobId ? `j${b.jobId}` : `b${b.id}`) ?? []), b]);
  const items: GradingItemInput[] = [...groups.values()].map((g) => {
    const grams = g.reduce((a, b) => a + (b.grams ?? 0), 0);
    return g[0].jobId ? { job_id: g[0].jobId, bucket_id: null, qty: "", outputs: make(g, grams) } : { job_id: null, bucket_id: g[0].id, qty: String(g[0].qty), outputs: make(g, grams) };
  });
  const d = ok(await createGrading({ unit_id: u.id, grading_date: today, note: "", items, aux: [] }, actor), `Grading ${label}`);
  ok(await transitionGrading(d.id, "post", actor), `Posting Grading ${label}`);
}
async function assign(label: string, employee: number) {
  const u = await unit(label);
  const rows = await persiapan(u.id, "Assign");
  const d = ok(await createWork({ unit_id: u.id, work_date: today, result_note: "", note: "", lines: rows.map((b) => ({ bucket_id: b.id, qty: b.qty, employee_id: employee })), aux: [] }, actor), `Pengerjaan ${label}`);
  ok(await transitionWork(d.id, "post", actor), `Posting Pengerjaan ${label}`);
}
async function qc(label: string) {
  const u = await unit(label);
  const rows = goods(await availableBuckets({ unitIds: [u.id], stage: "QcCheck" }));
  if (!rows.length) return;
  const d = ok(await createQcCheck({ unit_id: u.id, qc_date: today, inspector: "QC", note: "", lines: rows.map((b) => ({ bucket_id: b.id, decision: "Pass", reason: "" })) }, actor), `QC ${label}`);
  ok(await transitionQcCheck(d.id, "post", actor), `Posting QC ${label}`);
}
/** Everything in Stand By to the next Unit; a BSTB is received at once. */
async function send(from: string, to: string, lineId: number | null = null) {
  const [a, b] = [await unit(from), await unit(to)];
  const rows = goods(await availableBuckets({ unitIds: [a.id], stage: "StandBy" }));
  const r = ok(await sendTransfer({ from_unit_id: a.id, to_unit_id: b.id, transfer_date: today, line_id: lineId, note: "", lines: rows.map((x) => ({ bucket_id: x.id, qty: x.qty })) }, actor), `Kirim ${from} → ${to}`);
  if (r.status === "Submitted") ok(await receiveTransfer(r.id, actor), `Terima ${to}`);
}

async function main() {
  if (process.env.NODE_ENV === "production") throw new Error("simulate-walet posts demo documents and never runs in production.");
  actor = (await prisma.sysUser.findFirstOrThrow({ where: { email: "sistem@erp.app" } })).id;
  const [raw, halusA, halusB, bjl, mould, pcs, grms, stiker] = await Promise.all(["SM-A", "HLS-A", "HLS-B", "BJL-S", "MLD-A", "PCS-A", "GRMS", "STK-DAUN"].map(item));
  const gbb = await prisma.refWarehouse.findFirstOrThrow({ where: { warehouse_label: "GBB" } });
  const supplier = await prisma.mPartner.findFirstOrThrow({ where: { partner_label: "SWN" } });
  const [ani, budi] = await Promise.all(["ANI", "BUDI"].map((l) => prisma.mEmployee.findFirstOrThrow({ where: { employee_label: l } })));
  const line = await prisma.prdLine.findFirstOrThrow({ where: { line_label: "REG" } });
  const bom = await prisma.prdBom.findFirstOrThrow({ where: { bom_label: "BMK50-V1", status: "Active" } });
  console.log(`Simulasi Walet ${tag} — ${today}\n`);

  // 1. Pembelian: PR → PO (tanpa PPN) → Receipt Note ke Gudang Bahan Baku.
  const lines = [
    { item: raw, qty: 1_000, price: 40 },
    { item: grms, qty: 10, price: 500 },
    { item: stiker, qty: 10, price: 300 },
  ];
  const pr = ok(await createPurchaseRequest({ item_type: "Barang", request_date: today, needed_date: today, requester: "Simulasi", warehouse_id: gbb.id, note: "" }, lines.map((l) => ({ item_id: l.item.id, qty: l.qty, needed_date: today, note: "" })), actor), "PR");
  ok(await transitionPurchaseRequest(pr.id, "submit", actor), "Ajukan PR");
  const prLines = await prisma.purRequestLine.findMany({ where: { request_id: pr.id }, orderBy: { line_no: "asc" } });
  const po = ok(
    await createPurchaseOrder(
      { item_type: "Barang", order_date: today, currency_id: null, exchange_rate: 1, supplier_id: supplier.id, term_id: supplier.purchase_term_id, delivery_date: today, warehouse_id: gbb.id, quotation_no: "", price_mode: "Exclude", is_taxable: false, note: "Simulasi Walet" },
      lines.map((l, i) => ({ item_id: l.item.id, uom_id: l.item.base_uom_id, qty: l.qty, price: l.price, discount_type: null, discount_value: null, withholding_tax_id: null, note: "", request_line_ids: [prLines[i].id] })),
      actor
    ),
    "PO"
  );
  ok(await transitionPurchaseOrder(po.id, "submit", actor), "Ajukan PO");
  ok(await transitionPurchaseOrder(po.id, "approve", actor), "Setujui PO");
  const poLines = await prisma.purOrderLine.findMany({ where: { order_id: po.id }, orderBy: { line_no: "asc" } });
  const lotNo = (l: string) => `${l}-${tag}`;
  const rn = ok(
    await createReceiptNote(
      { source_doc_id: po.id, rn_date: today, warehouse_id: gbb.id, supplier_dn_no: `SJ-${tag}`, note: "" },
      lines.map((l, i) => ({ source_doc_line_id: poLines[i].id, qty: l.qty, qty_weighting: l.item.weighting ? l.qty * l.item.weighting.item_weight.toNumber() : "", note: "", lots: [{ tracking_no: lotNo(l.item.item_label), expiry_date: "", qty: l.qty, location_id: null }] })),
      actor
    ),
    "Receipt Note"
  );
  ok(await transitionReceiptNote(rn.id, "post", actor), "Posting Receipt Note");
  console.log(`1. ${po.orderNo} → ${rn.rnNo}: SM-A 1.000 g ${rupiah(40_000)}, Gramasi 10, Stiker Daun 10 masuk Gudang Bahan Baku`);

  // 2. BSTB Issue: sarang ke UGH, bahan penolong ke UP5.
  const ugh = await unit("UGH");
  const up5 = await unit("UP5");
  const lot = async (l: string) => (await prisma.logStockTracking.findFirstOrThrow({ where: { tracking_no: lotNo(l) } })).id;
  const issue = async (purpose: string, unitId: number, rows: { item: { id: number; item_label: string }; qty: number }[]) => {
    const si = ok(await createStockIssue({ purpose, warehouse_id: gbb.id, unit_id: unitId, issue_date: today, note: "" }, await Promise.all(rows.map(async (r) => ({ item_id: r.item.id, qty: r.qty, note: "", picks: [{ tracking_id: await lot(r.item.item_label), location_id: null, qty: r.qty }] }))), actor), "BSTB Issue");
    ok(await transitionStockIssue(si.id, "submit", actor), "Kirim BSTB Issue");
    const pr = await prisma.prdReceipt.findUniqueOrThrow({ where: { receipt_no: si.issueNo } });
    ok(await receiveProductionReceipt(pr.id, actor), "Terima Production Receipt");
    return si.issueNo;
  };
  const si1 = await issue("production_issue", ugh.id, [{ item: raw, qty: 1_000 }]);
  const si2 = await issue("auxiliary_issue", up5.id, [{ item: grms, qty: 2 }, { item: stiker, qty: 2 }]);
  console.log(`2. ${si1}: 1.000 g ke Persiapan UGH (No. Job lahir); ${si2}: bahan penolong ke UP5\n`);
  console.log("Setelah tiap Unit (gram dan nilai yang dibawa barang di Unit itu):");
  await report("UGH");

  // 3. Segmen sebelum partai.
  await grade("UGH", (_b, g) => [{ item_id: halusA.id, grams: String(g - 30) }, { item_id: bjl.id, grams: "30" }]);
  await qc("UGH");
  await report("UGH");
  await send("UGH", "UPC");
  await assign("UPC", ani.id);
  await qc("UPC");
  await report("UPC");
  await send("UPC", "UPY");
  await grade("UPY", (b, g) => [{ item_id: b[0].itemId, grams: String(g) }]);
  await report("UPY");
  await send("UPY", "UPW", line.id); // BSTB Partai: partai lahir saat Terima

  // 4. Line Reguler.
  await assign("UPW", ani.id);
  await qc("UPW");
  await report("UPW");
  await send("UPW", "UCL");
  const ucl = await unit("UCL");
  const kerja = await persiapan(ucl.id, "Kerja");
  ok(await startKerja({ unit_id: ucl.id, kerja_date: today, note: "", lines: kerja.map((b) => ({ bucket_id: b.id, employee_id: budi.id })) }, actor), "Mulai Kerja");
  const working = goods(await availableBuckets({ unitIds: [ucl.id], stage: "Working" }));
  ok(await closeKerja(working.map((b) => b.id), "finish", today, actor), "Selesai Kerja");
  await qc("UCL");
  await report("UCL");
  await send("UCL", "UC1");
  await assign("UC1", ani.id);
  await report("UC1");
  await send("UC1", "USR");
  await assign("USR", ani.id);
  await report("USR");
  await send("USR", "UDA");
  await grade("UDA", (b, g) => [{ item_id: b[0].itemId, grams: String(g - 10) }, { item_id: bjl.id, grams: "10" }]);
  await qc("UDA");
  await report("UDA");
  await send("UDA", "UML");
  // Moulding: Grading → Job Order → Assign + QC; the Unit rate falls at Assign (P281).
  const uml = await unit("UML");
  await grade("UML", (b, g) => [{ item_id: b[0].isBjl ? bjl.id : halusB.id, grams: String(g) }]);
  const jo = await persiapan(uml.id, "JobOrder");
  ok(await postJobOrder({ unit_id: uml.id, doc_date: today, note: "", lines: [{ target_item_id: mould.id, parts: jo.filter((b) => !b.isBjl).map((b) => ({ bucket_id: b.id, qty: b.qty })) }, ...jo.filter((b) => b.isBjl).map((b) => ({ target_item_id: bjl.id, parts: [{ bucket_id: b.id, qty: b.qty }] }))] }, actor), "Job Order UML");
  await assign("UML", ani.id);
  await qc("UML");
  await report("UML");
  await send("UML", "UDB");
  await grade("UDB", (b, g) => [{ item_id: b[0].itemId, grams: String(g) }]);
  await qc("UDB");
  await report("UDB");
  await send("UDB", "UWP");
  await assign("UWP", ani.id);
  await qc("UWP");
  await report("UWP");
  await send("UWP", "UBC");
  // Barcoding: the moulded goods become pieces of 5 g; whatever is left over is BJL.
  await grade("UBC", (b, g) => {
    if (b[0].isBjl) return [{ item_id: bjl.id, grams: String(g) }];
    const n = Math.floor(g / 5);
    return [...Array.from({ length: n }, () => ({ item_id: pcs.id, grams: "5" })), ...(g - n * 5 > 0 ? [{ item_id: bjl.id, grams: String(Math.round((g - n * 5) * 1000) / 1000) }] : [])];
  });
  await qc("UBC");
  await report("UBC");
  await send("UBC", "UP5");
  await report("UP5");

  // 5. Kotak BMK50: ten pieces of 5 g.
  const pieces = (await persiapan(up5.id, "Assembly")).filter((b) => b.itemId === pcs.id).slice(0, 10);
  const box = ok(await closeBox({ unit_id: up5.id, box_date: today, bom_id: bom.id, pieces: pieces.map((p, i) => ({ bucket_id: p.id, caiq: `CQ-${tag}-${i + 1}`, manual: false })) }, actor), "Tutup Kotak");
  const row = await prisma.prdBox.findUniqueOrThrow({ where: { id: box.id } });
  console.log(`\n5. ${box.no}: kotak ${box.trackingNo}, ${row.pieces} keping, ${row.grams.toNumber()} g`);
  console.log(`   nilai keping       ${rupiah(row.piece_value.toNumber())}`);
  console.log(`   biaya UP5          ${rupiah(row.cost_amount.toNumber())}`);
  console.log(`   bahan penolong     ${rupiah(row.aux_value.toNumber())}`);
  console.log(`   NILAI KOTAK        ${rupiah(row.value.toNumber())}`);
  console.log(`\nCek di layar: Telusur Produksi atau Kartu Produksi untuk ${box.trackingNo}; Saldo Produksi; Kartu Stok SM-A.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
