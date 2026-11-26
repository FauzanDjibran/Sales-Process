/**
 * Fills the stock and production ledgers of the walet demo company with a month
 * of documents, so the reports have something to show (P323): Kartu Stok, Saldo
 * Stok, Kartu Nilai and Nilai Persediaan on one side, Saldo Produksi, Kartu
 * Produksi and Telusur on the other. Run after `db:seed-walet`.
 *
 * Every row is written by the same functions the screens call, so journals, books
 * and `db:reconcile` agree as they would for a user. Nothing is inserted by hand.
 *
 * The story, thirty days up to today:
 *   gudang    five receipts (kilograms, packs and rolls; one under its weighing
 *             tolerance, one above it with its Bonus Pembelian, one order in two
 *             deliveries), a transfer still partly in the Gudang Transit, a stock
 *             adjustment, two kotak delivered to a customer
 *   produksi  six batches, each stopped somewhere else:
 *     A  all the way: kotak in Gudang Finish Goods, keping left at Packing 95
 *     B  at Cleaning: one Job Sedang Dikerjakan, one waiting for QC; a QC Balik
 *        was worked again at Grading Halus on the way
 *     C  in Stand By at Pre Wash
 *     D  on its way: a BSTB Penyebaran nobody has taken in yet
 *     E  a BSTB Issue sent, not yet taken in
 *     F  in Persiapan at Grading Halus
 *   and the BJL of every grading, returned to Gudang Hasil Samping
 *
 * **Development only, once**: the first lot already there means it ran, and it
 * does nothing. It is one story, so a run that failed half-way is not resumed:
 * start from a fresh database (`db:fresh-walet`).
 */
import { prisma } from "../src/lib/prisma";
import { createCustomerOrder, transitionCustomerOrder } from "../src/lib/erp/customer-order";
import { createDeliveryNote, transitionDeliveryNote } from "../src/lib/erp/delivery-note";
import { createDeliveryOrder, transitionDeliveryOrder } from "../src/lib/erp/delivery-order";
import { closeBox } from "../src/lib/erp/production-box";
import { createGrading, transitionGrading, type GradingItemInput } from "../src/lib/erp/production-grading";
import { sendProductionIssue } from "../src/lib/erp/production-issue";
import { postJobOrder } from "../src/lib/erp/production-job-order";
import { closeKerja, startKerja } from "../src/lib/erp/production-kerja";
import { availableBuckets, unitStepsOf, type BucketView } from "../src/lib/erp/production-ledger";
import { createQcCheck, transitionQcCheck } from "../src/lib/erp/production-qc";
import { receiveProductionReceipt } from "../src/lib/erp/production-receipt";
import { receiveTransfer, sendTransfer } from "../src/lib/erp/production-transfer";
import { createWork, transitionWork } from "../src/lib/erp/production-work";
import { createPurchaseOrder, transitionPurchaseOrder } from "../src/lib/erp/purchase-order";
import { createPurchaseRequest, transitionPurchaseRequest } from "../src/lib/erp/purchase-request";
import { createReceiptNote, transitionReceiptNote } from "../src/lib/erp/receipt-note";
import { createSalesOrder, transitionSalesOrder } from "../src/lib/erp/sales-order";
import { createStockAdjustment, transitionStockAdjustment } from "../src/lib/erp/stock-adjustment";
import { createStockIssue, transitionStockIssue } from "../src/lib/erp/stock-issue";
import { receiveStockReceipt } from "../src/lib/erp/stock-receipt";
import { createStockTransfer, transitionStockTransfer } from "../src/lib/erp/stock-transfer";
import { createTransferReceipt, transitionTransferReceipt } from "../src/lib/erp/stock-transfer-receipt";
import { seedActor } from "./lib/seed-common";

const SPAN = 30;
let actor = 0;

// ------------------------------------------------------------------- clock

/**
 * Terima is dated the day it happens, so the story moves the clock: `Date` reads
 * the story's day, while a date built from a value is what it always was.
 */
const RealDate = Date;
let clock = RealDate.now();
class StoryDate extends RealDate {
  constructor(...args: unknown[]) {
    super(...((args.length ? args : [clock]) as [number]));
  }
  static now() {
    return clock;
  }
  static [Symbol.hasInstance](v: unknown) {
    return Object.prototype.toString.call(v) === "[object Date]";
  }
}
/** The year's first day at the earliest: a month is posted only in an open period. */
const last = RealDate.UTC(new RealDate().getUTCFullYear(), new RealDate().getUTCMonth(), new RealDate().getUTCDate());
const first = Math.max(last - SPAN * 86_400_000, RealDate.UTC(new RealDate().getUTCFullYear(), 0, 1));
const setDay = (d: number) => {
  // 04:00 UTC, 11:00 in Jakarta: the same date on both sides.
  clock = first + Math.floor((d * (last - first)) / SPAN / 86_400_000) * 86_400_000 + 4 * 3_600_000;
};
const day = () => new RealDate(clock).toISOString().slice(0, 10);

// ----------------------------------------------------------------- masters

function ok<T extends { ok: boolean }>(r: T, what: string): Extract<T, { ok: true }> {
  if (!r.ok) throw new Error(`${day()} ${what}: ${JSON.stringify((r as unknown as { errors?: unknown }).errors ?? r)}`);
  return r as Extract<T, { ok: true }>;
}
const item = (label: string) => prisma.mItem.findFirstOrThrow({ where: { item_label: label }, include: { uoms: { include: { uom: true } }, weighting: true } });
const unit = (label: string) => prisma.refUnit.findFirstOrThrow({ where: { unit_label: label } });
const warehouse = async (label: string) => (await prisma.refWarehouse.findFirstOrThrow({ where: { warehouse_label: label } })).id;
const partner = (label: string) => prisma.mPartner.findFirstOrThrow({ where: { partner_label: label }, include: { addresses: true } });
const lot = (no: string) => prisma.logStockTracking.findUniqueOrThrow({ where: { tracking_no: no } });
const round = (n: number, d = 4) => Math.round(n * 10 ** d) / 10 ** d;

// --------------------------------------------------------------- purchasing

type Buy = { item: string; uom: string; qty: number; price: number };

async function order(supplierLabel: string, warehouseLabel: string, lines: Buy[]): Promise<{ id: number; lineIds: number[] }> {
  const supplier = await partner(supplierLabel);
  const wh = await warehouse(warehouseLabel);
  const items = await Promise.all(lines.map((l) => item(l.item)));
  const factor = (i: number) => items[i].uoms.find((u) => u.uom.uom_label === lines[i].uom)?.factor.toNumber() ?? 1;
  const pr = ok(
    await createPurchaseRequest(
      { item_type: "Barang", request_date: day(), needed_date: day(), requester: "Gudang", warehouse_id: wh, note: "" },
      lines.map((l, i) => ({ item_id: items[i].id, qty: round(l.qty * factor(i)), needed_date: day(), note: "" })),
      actor
    ),
    "PR"
  );
  ok(await transitionPurchaseRequest(pr.id, "submit", actor), "Ajukan PR");
  const prLines = await prisma.purRequestLine.findMany({ where: { request_id: pr.id }, orderBy: { line_no: "asc" } });
  const term = supplier.purchase_term_id ?? (await prisma.refPaymentTerm.findFirstOrThrow({ where: { term_label: "NET30" } })).id;
  const po = ok(
    await createPurchaseOrder(
      { item_type: "Barang", order_date: day(), currency_id: null, exchange_rate: 1, supplier_id: supplier.id, term_id: term, delivery_date: day(), warehouse_id: wh, quotation_no: "", price_mode: "Exclude", is_taxable: false, note: "Seed walet-ledger" },
      lines.map((l, i) => ({
        item_id: items[i].id,
        uom_id: items[i].uoms.find((u) => u.uom.uom_label === l.uom)?.uom_id ?? items[i].base_uom_id,
        qty: l.qty,
        price: l.price,
        discount_type: null,
        discount_value: null,
        withholding_tax_id: null,
        note: "",
        request_line_ids: [prLines[i].id],
      })),
      actor
    ),
    "PO"
  );
  ok(await transitionPurchaseOrder(po.id, "submit", actor), "Ajukan PO");
  ok(await transitionPurchaseOrder(po.id, "approve", actor), "Setujui PO");
  return { id: po.id, lineIds: (await prisma.purOrderLine.findMany({ where: { order_id: po.id }, orderBy: { line_no: "asc" } })).map((l) => l.id) };
}

/** A receipt: SJ in the PO's unit, the scale in Kg (by the book when not given). Lots are listed in base units here and typed in the PO's (P338). */
async function receive(poId: number, warehouseLabel: string, dn: string, lines: { lineId: number; sj: number; kg?: number; lots: [no: string, qty: number][] }[]) {
  const rows = await Promise.all(
    lines.map(async (l) => {
      const po = await prisma.purOrderLine.findUniqueOrThrow({ where: { id: l.lineId }, include: { item: { include: { weighting: true } } } });
      const w = po.item.weighting;
      const kg = w ? (l.kg ?? round(l.sj * po.uom_factor.toNumber() * w.item_weight.toNumber(), 3)) : "";
      return { source_doc_line_id: l.lineId, qty: l.sj, qty_weighting: kg, note: "", lots: l.lots.map(([no, base]) => ({ tracking_no: no, expiry_date: "", location_id: null, qty: round(base / po.uom_factor.toNumber(), 6) })) };
    })
  );
  const rn = ok(await createReceiptNote({ source_doc_id: poId, rn_date: day(), warehouse_id: await warehouse(warehouseLabel), supplier_dn_no: dn, note: "" }, rows, actor), `Receipt Note ${dn}`);
  ok(await transitionReceiptNote(rn.id, "post", actor), `Posting ${rn.rnNo}`);
}

// --------------------------------------------------------------- production

const goods = (b: BucketView[]) => b.filter((x) => !x.auxiliary && x.qty > 0);
/** A batch is known by its lot: every No. Stok made from it carries the number in front. */
const of = (batch: string) => (b: BucketView) => b.lotNo === batch || b.lotNo.startsWith(`${batch}-`);

async function at(label: string, stage: BucketView["stage"], batch: string): Promise<BucketView[]> {
  const u = await unit(label);
  return goods(await availableBuckets({ unitIds: [u.id], stage })).filter(of(batch));
}

async function issue(purpose: "production_issue" | "auxiliary_issue", from: string, to: string, picks: { item: string; lotNo: string; qty: number }[], take = true) {
  const u = await unit(to);
  const lines = await Promise.all(
    picks.map(async (p) => ({ item_id: (await item(p.item)).id, qty: p.qty, note: "", picks: [{ tracking_id: (await lot(p.lotNo)).id, location_id: null, qty: p.qty }] }))
  );
  const si = ok(await createStockIssue({ purpose, warehouse_id: await warehouse(from), unit_id: u.id, issue_date: day(), note: "" }, lines, actor), "Stock Issue");
  ok(await transitionStockIssue(si.id, "submit", actor), `Kirim ${si.issueNo}`);
  if (take) ok(await receiveProductionReceipt((await prisma.prdReceipt.findUniqueOrThrow({ where: { receipt_no: si.issueNo } })).id, actor), `Terima ${si.issueNo}`);
}

type Share = [item: string, part: number];
/** What a grading makes of an item, by Unit; a part left over is shrinkage. */
function outputsOf(label: string, b: BucketView): Share[] {
  if (label === "UGH") {
    if (b.itemLabel === "SM-A") return [["HLS-A", 0.82], ["HLS-B", 0.12], ["BJL-S", 0.04]];
    if (b.itemLabel === "SM-B") return [["HLS-B", 0.7], ["HLS-C", 0.22], ["BJL-B", 0.05]];
    if (b.itemLabel === "SM-C") return [["HLS-C", 0.68], ["HLS-SD", 0.22], ["BJL-K", 0.06]];
    return [[b.itemLabel, 0.98]]; // a Balik row, graded again
  }
  if (label === "UDA") return [[b.itemLabel, 0.95], ["BJL-D", 0.01]];
  return [[b.itemLabel, 1]];
}

/** Runs the Unit's processes in their order over the batch, then its QC. */
async function work(label: string, batch: string, opts: { qcReturn?: boolean; qc?: boolean } = {}) {
  const u = await unit(label);
  const ani = (await prisma.mEmployee.findFirstOrThrow({ where: { employee_label: "ANI" } })).id;
  const budi = (await prisma.mEmployee.findFirstOrThrow({ where: { employee_label: "BUDI" } })).id;
  for (const step of await unitStepsOf(prisma, u.id)) {
    const rows = (await at(label, "Preparation", batch)).filter((b) => b.stepId === step.id);
    if (!rows.length) continue;
    if (step.process === "Grading") {
      const groups = new Map<string, BucketView[]>();
      for (const b of rows) groups.set(b.jobId ? `j${b.jobId}` : `b${b.id}`, [...(groups.get(b.jobId ? `j${b.jobId}` : `b${b.id}`) ?? []), b]);
      const items: GradingItemInput[] = [];
      for (const g of groups.values()) {
        const grams = g.reduce((a, b) => a + (b.grams ?? 0), 0);
        const outputs =
          label === "UBC"
            ? await pieces(grams)
            : await Promise.all(outputsOf(label, g[0]).map(async ([l, part]) => ({ item_id: (await item(l)).id, grams: String(round(grams * part, 2)) })));
        items.push(g[0].jobId ? { job_id: g[0].jobId, bucket_id: null, qty: "", outputs } : { job_id: null, bucket_id: g[0].id, qty: String(g[0].qty), outputs });
      }
      const d = ok(await createGrading({ unit_id: u.id, grading_date: day(), note: "", items, aux: [], employee_ids: [ani] } as Parameters<typeof createGrading>[0], actor), `Grading ${label}`);
      ok(await transitionGrading(d.id, "post", actor), `Posting Grading ${label}`);
    } else if (step.process === "Assign") {
      const d = ok(
        await createWork({ unit_id: u.id, work_date: day(), result_note: "", note: "", aux: [], lines: rows.map((b, i) => ({ bucket_id: b.id, qty: b.qty, employee_id: i % 2 ? budi : ani })) }, actor),
        `Pengerjaan ${label}`
      );
      ok(await transitionWork(d.id, "post", actor), `Posting Pengerjaan ${label}`);
    } else if (step.process === "JobOrder") {
      const target = (await item("MLD-A")).id;
      ok(await postJobOrder({ unit_id: u.id, doc_date: day(), note: "", lines: [{ target_item_id: target, parts: rows.map((b) => ({ bucket_id: b.id, qty: b.qty })) }] }, actor), `Job Order ${label}`);
    } else throw new Error(`${label}: proses ${step.process} dijalankan tersendiri`);
  }
  if (opts.qc !== false) await qc(label, batch, opts.qcReturn);
}

/** Keping of about 5 g, in pairs of 4,9 and 5,1 so ten of them make 50 g; the rest is BJL. */
async function pieces(grams: number) {
  const [piece, bjl] = [(await item("PCS-A")).id, (await item("BJL-S")).id];
  const n = Math.floor(grams / 10) * 2;
  const left = round(grams - n * 5, 2);
  return [...Array.from({ length: n }, (_, i) => ({ item_id: piece, grams: i % 2 ? "5.1" : "4.9" })), ...(left > 0 ? [{ item_id: bjl, grams: String(left) }] : [])];
}

async function qc(label: string, batch: string, returnOne = false) {
  const u = await unit(label);
  const rows = await at(label, "QcCheck", batch);
  if (!rows.length) return;
  const back = returnOne ? rows.find((b) => !b.isBjl && !b.jobId) : undefined;
  const d = ok(
    await createQcCheck({ unit_id: u.id, qc_date: day(), inspector: "Eka", note: "", lines: rows.map((b) => ({ bucket_id: b.id, decision: b === back ? "Return" : "Pass", reason: b === back ? "Bulu halus masih tersisa" : "" })) }, actor),
    `QC ${label}`
  );
  ok(await transitionQcCheck(d.id, "post", actor), `Posting QC ${label}`);
}

/** Stand By of the batch to the next Unit, its BJL left behind; returns the BSTB still to be taken in. */
async function send(from: string, to: string, batch: string): Promise<number | null> {
  const [a, b] = [await unit(from), await unit(to)];
  const rows = (await at(from, "StandBy", batch)).filter((x) => !x.isBjl);
  const lineId = from === "UPY" ? (await prisma.prdLine.findFirstOrThrow({ where: { line_label: "REG" } })).id : null;
  const r = ok(await sendTransfer({ from_unit_id: a.id, to_unit_id: b.id, transfer_date: day(), line_id: lineId, note: "", lines: rows.map((x) => ({ bucket_id: x.id, qty: x.qty })) }, actor), `Kirim ${from} → ${to}`);
  return r.status === "Submitted" ? r.id : null;
}
const take = async (id: number | null) => {
  if (id) ok(await receiveTransfer(id, actor), "Terima BSTB");
};

/** BJL in Stand By, back to Gudang Hasil Samping; worth nothing either way. */
async function returnBjl(label: string, batch: string) {
  const rows = (await at(label, "StandBy", batch)).filter((b) => b.isBjl);
  if (rows.length) await (await bstbOut(label, "return", "GHS", rows))();
}
async function bstbOut(label: string, purpose: "return" | "finish_goods", to: string, rows: BucketView[], valueMode: "carried" | "none" = "carried") {
  const r = ok(await sendProductionIssue({ purpose, from_unit_id: (await unit(label)).id, warehouse_id: await warehouse(to), issue_date: day(), note: "", lines: rows.map((b) => ({ bucket_id: b.id, qty: b.qty })) }, actor), `BSTB ${purpose}`);
  const receipt = await prisma.logStockReceipt.findUniqueOrThrow({ where: { receipt_no: r.no } });
  return async () => ok(await receiveStockReceipt(receipt.id, actor, purpose === "return" ? { valueMode } : {}), `Terima ${r.no}`);
}

// ------------------------------------------------------------------- story

/** A chronological list: what happens on which day. Steps of one day run as written. */
const story: [number, string, () => Promise<unknown>][] = [];
const on = (d: number, what: string, run: () => Promise<unknown>) => story.push([d, what, run]);

/** Batch from its issue to Stand By at `stop`, one Unit a day; a BSTB is taken in the next day. */
function walk(batch: string, start: number, route: string[]) {
  let d = start;
  for (const [i, label] of route.entries()) {
    on(d, `${batch} di ${label}`, async () => {
      await work(label, batch);
      await returnBjl(label, batch);
    });
    const next = route[i + 1];
    if (next) {
      let waiting: number | null = null;
      on(d, `${batch} ${label} → ${next}`, async () => (waiting = await send(label, next, batch)));
      on(d + 1, `${batch} terima ${next}`, () => take(waiting));
    }
    d++;
  }
  return d;
}

function plan() {
  const A = "WL-A-01", B = "WL-B-01", C = "WL-A-02", D = "WL-C-01", E = "WL-B-02", F = "WL-C-02";
  let poB = { id: 0, lineIds: [] as number[] };

  // ---- gudang: masuk
  on(0, "Sarang A, 3 KG", async () => {
    const po = await order("S-W01", "GBB", [{ item: "SM-A", uom: "KG", qty: 3, price: 4_000_000 }]);
    await receive(po.id, "GBB", "SJ-RW-101", [{ lineId: po.lineIds[0], sj: 3, kg: 3.01, lots: [[A, 1_000], [C, 2_000]] }]);
  });
  on(1, "Bahan penolong per pak dan rol", async () => {
    const po = await order("S-W03", "GBP", [
      { item: "GRMS", uom: "PAK", qty: 3, price: 180_000 },
      { item: "STK-DAUN", uom: "ROL", qty: 1, price: 2_400_000 },
      { item: "KTG", uom: "PAK", qty: 5, price: 140_000 },
      { item: "BOX", uom: "KRT", qty: 2, price: 7_200_000 },
    ]);
    await receive(po.id, "GBP", "SJ-KP-220", [
      { lineId: po.lineIds[0], sj: 3, lots: [["WL-GRMS", 300]] },
      { lineId: po.lineIds[1], sj: 1, lots: [["WL-DAUN", 500]] },
      { lineId: po.lineIds[2], sj: 5, lots: [["WL-KTG", 500]] },
      { lineId: po.lineIds[3], sj: 2, lots: [["WL-BOX", 100]] },
    ]);
  });
  // Delivered in two: the first weighs under its tolerance, so less is taken than the SJ says.
  on(2, "Sarang B, SJ pertama di bawah toleransi", async () => {
    poB = await order("S-W02", "GBB", [{ item: "SM-B", uom: "KG", qty: 5, price: 3_600_000 }]);
    await receive(poB.id, "GBB", "SJ-HS-007", [{ lineId: poB.lineIds[0], sj: 3, kg: 2.9, lots: [[B, 2_900]] }]);
  });
  on(6, "Sarang B, SJ kedua", () => receive(poB.id, "GBB", "SJ-HS-011", [{ lineId: poB.lineIds[0], sj: 2, lots: [[E, 2_000]] }]));
  on(7, "Sarang C, di atas toleransi dengan bonus", async () => {
    const po = await order("SWN", "GBB", [{ item: "SM-C", uom: "KG", qty: 2, price: 2_900_000 }]);
    await receive(po.id, "GBB", "SJ-SWN-55", [{ lineId: po.lineIds[0], sj: 2, kg: 2.1, lots: [[D, 1_200], [F, 800]] }]);
  });

  // ---- gudang: pindah, hitung
  on(9, "Transfer kantong ke Gudang Finish Goods, sebagian masih di transit", async () => {
    const it = await item("KTG");
    const t = ok(
      await createStockTransfer(
        { transfer_date: day(), from_warehouse_id: await warehouse("GBP"), to_warehouse_id: await warehouse("GFG"), vehicle_no: "", driver_name: "", note: "" },
        [{ item_id: it.id, qty: 120, note: "", picks: [{ tracking_id: (await lot("WL-KTG")).id, location_id: null, stock_status_id: null, qty: 120 }] }],
        actor
      ),
      "Transfer Kirim"
    );
    ok(await transitionStockTransfer(t.id, "send", actor), "Kirim transfer");
    const line = await prisma.logStockTransferLine.findFirstOrThrow({ where: { stock_transfer_id: t.id }, include: { trackings: true } });
    transferId = t.id;
    transferLine = { id: line.id, tracking: line.trackings[0].id };
  });
  on(10, "Transfer Terima sebagian", async () => {
    const r = ok(
      await createTransferReceipt({ stock_transfer_id: transferId, receipt_date: day(), note: "" }, [{ transfer_line_id: transferLine.id, qty: 80, note: "", picks: [{ transfer_tracking_id: transferLine.tracking, location_id: null, qty: 80 }] }], actor),
      "Transfer Terima"
    );
    ok(await transitionTransferReceipt(r.id, "post", actor), "Posting Transfer Terima");
  });
  on(24, "Hitung fisik Gudang Bahan Penolong", async () => {
    const gbp = await warehouse("GBP");
    const rows = await Promise.all(
      ([["BOX", "WL-BOX", -3], ["KTG", "WL-KTG", 6]] as const).map(async ([label, no, diff]) => {
        const b = await prisma.logStockBalance.findFirstOrThrow({ where: { warehouse_id: gbp, tracking: { tracking_no: no } } });
        const held = b.qty_balance.toNumber();
        return { item_id: (await item(label)).id, tracking_no: no, location_id: null, stock_status_id: b.stock_status_id, book_qty: held, counted_qty: held + diff, value: "", note: "Hitung fisik" };
      })
    );
    const a = ok(await createStockAdjustment({ adjustment_date: day(), warehouse_id: gbp, note: "Opname bulanan" }, rows, actor), "Stock Adjustment");
    ok(await transitionStockAdjustment(a.id, "submit", actor), "Ajukan adjustment");
    ok(await transitionStockAdjustment(a.id, "approve", actor), "Setujui adjustment");
  });

  // ---- produksi A: sampai kotak
  on(3, "A masuk produksi", () => issue("production_issue", "GBB", "UGH", [{ item: "SM-A", lotNo: A, qty: 400 }]));
  on(5, "Bahan penolong ke Packing 95", () => issue("auxiliary_issue", "GBP", "UP5", [{ item: "GRMS", lotNo: "WL-GRMS", qty: 20 }, { item: "STK-DAUN", lotNo: "WL-DAUN", qty: 20 }]));
  let d = walk(A, 4, ["UGH", "UPC", "UPY", "UPW"]);
  kerja(A, d, true);
  d = walkFrom(A, d + 1, "UCL", ["UC1", "USR", "UDA", "UML", "UDB", "UWP", "UBC", "UP5"]);
  on(d, "Kotak di Packing 95", async () => {
    const up5 = await unit("UP5");
    const bom = await prisma.prdBom.findFirstOrThrow({ where: { bom_label: "BMK50-V1" } });
    for (let k = 0; k < 4; k++) {
      const ten = (await at("UP5", "Preparation", A)).filter((b) => b.itemLabel === "PCS-A");
      // Five of each weight, so the box weighs 50 g.
      const pick = [...ten.filter((b) => b.grams === 4.9).slice(0, 5), ...ten.filter((b) => b.grams === 5.1).slice(0, 5)];
      ok(await closeBox({ unit_id: up5.id, box_date: day(), bom_id: bom.id, pieces: pick.map((p, i) => ({ bucket_id: p.id, caiq: `CQ-WL-${k + 1}-${i + 1}`, manual: false })) }, actor), "Kotak");
    }
  });
  on(d + 1, "BSTB ke Finish Goods", async () => {
    const kotak = goods(await availableBuckets({ unitIds: [(await unit("UP5")).id], stage: "StandBy" })).slice(0, 3);
    await (await bstbOut("UP5", "finish_goods", "GFG", kotak))();
  });
  on(d + 2, "Keping rusak keluar tanpa nilai", async () => {
    const left = (await at("UP5", "Preparation", A)).slice(0, 1);
    await (await bstbOut("UP5", "return", "GHS", left, "none"))();
  });
  on(d + 3, "Kirim 2 kotak ke customer", deliver);

  // ---- produksi B: sampai Cleaning
  on(8, "B masuk produksi", () => issue("production_issue", "GBB", "UGH", [{ item: "SM-B", lotNo: B, qty: 900 }]));
  on(9, "B grading, satu No. Stok Balik", () => work("UGH", B, { qcReturn: true }));
  on(10, "B dikerjakan ulang", async () => {
    await work("UGH", B);
    await returnBjl("UGH", B);
  });
  let w: number | null = null;
  on(10, "B UGH → UPC", async () => (w = await send("UGH", "UPC", B)));
  on(11, "B terima UPC", () => take(w));
  const dB = walk(B, 11, ["UPC", "UPY", "UPW"]);
  kerja(B, dB, false);

  // ---- produksi C: Stand By di Pre Wash
  on(15, "C masuk produksi", () => issue("production_issue", "GBB", "UGH", [{ item: "SM-A", lotNo: C, qty: 600 }]));
  walk(C, 16, ["UGH", "UPC", "UPY", "UPW"]);

  // ---- produksi D: BSTB Penyebaran belum diterima
  on(20, "D masuk produksi", () => issue("production_issue", "GBB", "UGH", [{ item: "SM-C", lotNo: D, qty: 700 }]));
  walk(D, 21, ["UGH", "UPC", "UPY"]);
  on(24, "D dalam perjalanan", () => send("UPY", "UPW", D));

  // ---- produksi F dan E: baru masuk
  on(27, "F di Persiapan", () => issue("production_issue", "GBB", "UGH", [{ item: "SM-C", lotNo: F, qty: 300 }]));
  on(29, "E dalam perjalanan ke produksi", () => issue("production_issue", "GBB", "UGH", [{ item: "SM-B", lotNo: E, qty: 500 }], false));
}
let transferId = 0;
let transferLine = { id: 0, tracking: 0 };

/** Sends the batch on from `from` and walks it through `route`, the last Unit only received. */
function walkFrom(batch: string, start: number, from: string, route: string[]) {
  let d = start;
  let prev = from;
  for (const [i, label] of route.entries()) {
    const was = prev;
    let waiting: number | null = null;
    on(d, `${batch} ${was} → ${label}`, async () => (waiting = await send(was, label, batch)));
    on(d, `${batch} terima ${label}`, () => take(waiting));
    if (i < route.length - 1) {
      on(d, `${batch} di ${label}`, async () => {
        await work(label, batch);
        await returnBjl(label, batch);
      });
    }
    prev = label;
    d++;
  }
  return d;
}

/** Cleaning: the batch is taken by Budi; all of it finished and passed, or one Job of it only, left for QC. */
function kerja(batch: string, d: number, through: boolean) {
  on(d, `${batch} UPW → UCL`, async () => take(await send("UPW", "UCL", batch)));
  on(d, `${batch} mulai kerja`, async () => {
    const rows = await at("UCL", "Preparation", batch);
    const budi = (await prisma.mEmployee.findFirstOrThrow({ where: { employee_label: "BUDI" } })).id;
    ok(await startKerja({ unit_id: (await unit("UCL")).id, kerja_date: day(), note: "", lines: rows.map((b) => ({ bucket_id: b.id, employee_id: budi })) }, actor), "Mulai Kerja");
  });
  on(d + 1, `${batch} selesai kerja`, async () => {
    const rows = await at("UCL", "Working", batch);
    const done = through ? rows : rows.filter((b) => b.jobId === rows[0].jobId);
    ok(await closeKerja(done.map((b) => b.id), "finish", day(), actor), "Selesai Kerja");
    if (through) await qc("UCL", batch);
  });
}

async function deliver() {
  const customer = await partner("C-W02");
  const bmk = await item("BMK50");
  const address = customer.addresses.find((a) => a.is_shipping)?.id ?? customer.addresses[0].id;
  const term = customer.default_term_id ?? (await prisma.refPaymentTerm.findFirstOrThrow({ where: { term_label: "NET30" } })).id;
  const co = ok(
    await createCustomerOrder(
      { order_date: day(), customer_id: customer.id, address_id: address, term_id: term, price_mode: "Exclude", is_taxable: false, po_no: "PO-SEN-88", po_date: day(), salesperson: "", note: "Seed walet-ledger" },
      [{ item_id: bmk.id, uom_id: bmk.base_uom_id, qty: 2, price: 1_750_000, discount_type: null, discount_value: null, withholding_tax_id: null, note: "" }],
      actor
    ),
    "Customer Order"
  );
  for (const a of ["submit", "approve"] as const) ok(await transitionCustomerOrder(co.id, a, actor), "Customer Order");
  const coLine = await prisma.salCustomerOrderLine.findFirstOrThrow({ where: { order_id: co.id } });
  const so = ok(await createSalesOrder({ customer_order_id: co.id, order_date: day(), delivery_date: day(), address_id: address, note: "" }, [{ customer_order_line_id: coLine.id, qty: 2, note: "" }], actor), "Sales Order");
  for (const a of ["submit", "approve", "confirm"] as const) ok(await transitionSalesOrder(so.id, a, actor), "Sales Order");
  const soLine = await prisma.salOrderLine.findFirstOrThrow({ where: { order: { id: so.id } } });
  const gfg = await warehouse("GFG");
  const dOrder = ok(await createDeliveryOrder({ customer_order_id: co.id, do_date: day(), delivery_date: day(), warehouse_id: gfg, address_id: address, note: "" }, [{ sales_order_line_id: soLine.id, qty: 2, note: "" }], actor), "Delivery Order");
  ok(await transitionDeliveryOrder(dOrder.id, "issue", actor), "Terbitkan Delivery Order");
  const doLine = await prisma.salDeliveryOrderLine.findFirstOrThrow({ where: { delivery_order_id: dOrder.id } });
  const held = await prisma.logStockBalance.findMany({ where: { warehouse_id: gfg, item_id: bmk.id, qty_balance: { gt: 0 } }, orderBy: { id: "asc" }, take: 2 });
  const dn = ok(
    await createDeliveryNote(
      { source_doc_id: dOrder.id, dn_date: day(), vehicle_no: "B 9012 WLT", driver_name: "Slamet", note: "" },
      [{ source_doc_line_id: doLine.id, qty: 2, note: "", picks: held.map((b) => ({ tracking_id: b.tracking_id, location_id: null, stock_status_id: b.stock_status_id, base_qty: 1 })) }],
      actor
    ),
    "Delivery Note"
  );
  ok(await transitionDeliveryNote(dn.id, "post", actor), "Posting Delivery Note");
}

async function main() {
  actor = await seedActor("seed-walet-ledger");
  if (await prisma.logStockTracking.findUnique({ where: { tracking_no: "WL-A-01" } })) {
    console.log("Data ledger walet sudah ada.");
    return;
  }
  if (!(await prisma.refWarehouse.findFirst({ where: { warehouse_label: "GHS" } }))) throw new Error("Data walet belum ada. Jalankan npm run db:seed-walet.");
  plan();
  globalThis.Date = StoryDate as DateConstructor;
  try {
    for (const [d, what, run] of story.map((s, i) => [...s, i] as const).sort((a, b) => a[0] - b[0] || a[3] - b[3])) {
      setDay(Math.min(d, SPAN));
      try {
        await run();
      } catch (e) {
        throw new Error(`${day()} ${what}: ${e instanceof Error ? e.message : String(e)}`);
      }
      console.log(`${day()}  ${what}`);
    }
  } finally {
    globalThis.Date = RealDate;
  }
  const [stock, production] = await Promise.all([prisma.logStockLedger.count(), prisma.prdLedger.count()]);
  console.log(`\nSelesai: ${stock} baris buku stok, ${production} baris buku produksi.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
