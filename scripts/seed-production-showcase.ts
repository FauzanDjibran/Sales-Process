/**
 * Development showcase for production cost (P150 Phase 2, P151): three months
 * of Tagihan Biaya Produksi and the Pengeluaran that pay them, so Buku and
 * Saldo Biaya Produksi, the bills' Lunas / Sebagian / Belum Dibayar and the
 * payment flow can be looked at straight away.
 *
 * **Development only**, like `seed-showcase.ts`, which must have run first
 * (the starter chart with Hutang Biaya Produksi mapped, the six Elemen Biaya
 * Produksi, the fiscal year and the production suppliers S-004..S-008). The
 * payments come out of the rupiah bank holding the most money, so run
 * `db:seed-cash-bank-showcase` first too. Locally `npm run
 * db:seed-production-showcase`; against Neon `npm run
 * db:neon-seed-production-showcase`.
 *
 * Every document goes through the application's own functions
 * (`createCostBill` / `transitionCostBill`, `createCashPayment` /
 * `transitionCashPayment`), so each posting writes its journal, cost-ledger
 * rows, Cash Bank Book entries and paid amounts exactly as the screens do, and
 * `db:reconcile` holds.
 *
 * What it creates (August and September complete, October to date):
 *   utilities from PLN and PT Air Industri Cikarang, outsourced labour from
 *   CV Karya Mandiri (direct and indirect on one bill), machine maintenance
 *   from Bengkel Teknik Budi and waste handling from PT Envirotama
 *   payments: August paid in full in September (two Bengkel bills in one
 *   payment, a bank charge on PLN's), September partly paid in October (CV
 *   Karya Mandiri in part, PLN in full, the water bill on a Draft payment),
 *   the rest left open; October's labour bill left a Draft
 *
 * Depreciation and payroll accruals are not here: they are not owed to a
 * supplier, so they wait for Pencatatan Biaya Produksi (§9.6).
 *
 * **Additive**: a bill is matched on its No. Tagihan Supplier and a payment on
 * its bank reference, so a second run creates only what is missing.
 */
import { prisma } from "../src/lib/prisma";
import { createCostBill, transitionCostBill } from "../src/lib/erp/production-cost-bill";
import { createCashPayment, transitionCashPayment } from "../src/lib/erp/cash-payment";

type BillSpec = {
  key: string;
  supplier: string;
  date: string;
  due?: string;
  ref: string;
  description: string;
  lines: [element: string, amount: number, note?: string][];
  draft?: boolean;
};

const BILLS: BillSpec[] = [
  // ---- August 2026
  { key: "A-PLN", supplier: "S-005", date: "2026-08-31", due: "2026-09-14", ref: "PLN/2608/0071", description: "Listrik pabrik Agustus 2026",
    lines: [["LISTRIK-PABRIK", 41_850_000, "Pemakaian 27.900 kWh + biaya beban"]] },
  { key: "A-AIR", supplier: "S-006", date: "2026-08-31", due: "2026-09-14", ref: "AIC/08/1123", description: "Air proses pabrik Agustus 2026",
    lines: [["LISTRIK-PABRIK", 4_720_000, "Air proses 1.180 m³"]] },
  { key: "A-KMO", supplier: "S-007", date: "2026-08-31", due: "2026-09-07", ref: "KMO/INV/0826", description: "Tenaga borongan produksi Agustus 2026",
    lines: [
      ["UPAH-LANGSUNG", 86_400_000, "Operator mixing, filling, packing — 24 orang"],
      ["UPAH-TIDAK-LANGSUNG", 21_600_000, "Supervisor lini & QC — 4 orang"],
    ] },
  { key: "A-BTB1", supplier: "S-004", date: "2026-08-12", ref: "BTB-0812", description: "Servis mixer 500 L",
    lines: [["PEMELIHARAAN-MESIN", 3_250_000, "Ganti seal dan bearing"]] },
  { key: "A-BTB2", supplier: "S-004", date: "2026-08-26", ref: "BTB-0826", description: "Perbaikan conveyor packing",
    lines: [["PEMELIHARAAN-MESIN", 2_100_000, "Ganti roller dan belt"]] },
  { key: "A-ENV", supplier: "S-008", date: "2026-08-31", due: "2026-09-30", ref: "ENV/2608/045", description: "Pengangkutan & pengolahan limbah B3 Agustus 2026",
    lines: [["OVERHEAD-LAIN", 6_350_000, "Limbah cair dan kemasan terkontaminasi"]] },

  // ---- September 2026
  { key: "S-PLN", supplier: "S-005", date: "2026-09-30", due: "2026-10-14", ref: "PLN/2609/0071", description: "Listrik pabrik September 2026",
    lines: [["LISTRIK-PABRIK", 44_175_000, "Pemakaian 29.450 kWh + biaya beban"]] },
  { key: "S-AIR", supplier: "S-006", date: "2026-09-30", due: "2026-10-14", ref: "AIC/09/1187", description: "Air proses pabrik September 2026",
    lines: [["LISTRIK-PABRIK", 5_080_000, "Air proses 1.270 m³"]] },
  { key: "S-KMO", supplier: "S-007", date: "2026-09-30", due: "2026-10-07", ref: "KMO/INV/0926", description: "Tenaga borongan produksi September 2026",
    lines: [
      ["UPAH-LANGSUNG", 93_600_000, "Operator mixing, filling, packing — 26 orang"],
      ["UPAH-TIDAK-LANGSUNG", 21_600_000, "Supervisor lini & QC — 4 orang"],
    ] },
  { key: "S-BTB", supplier: "S-004", date: "2026-09-18", ref: "BTB-0918", description: "Kalibrasi mesin filling",
    lines: [["PEMELIHARAAN-MESIN", 4_600_000, "Kalibrasi 4 nozzle dan sensor level"]] },
  { key: "S-ENV", supplier: "S-008", date: "2026-09-30", due: "2026-10-30", ref: "ENV/2609/051", description: "Pengangkutan & pengolahan limbah B3 September 2026",
    lines: [["OVERHEAD-LAIN", 6_900_000, "Limbah cair dan kemasan terkontaminasi"]] },

  // ---- October 2026, to date
  { key: "O-BTB", supplier: "S-004", date: "2026-10-03", ref: "BTB-1003", description: "Ganti v-belt mesin labeling",
    lines: [["PEMELIHARAAN-MESIN", 1_850_000]] },
  { key: "O-KMO", supplier: "S-007", date: "2026-10-07", due: "2026-10-14", ref: "KMO/INV/1001", description: "Tenaga borongan produksi 1–7 Oktober 2026",
    lines: [["UPAH-LANGSUNG", 20_160_000, "Operator — 24 orang, 1 minggu"]], draft: true },
];

type PaymentSpec = { date: string; supplier: string; ref: string; bills: [key: string, cash?: number][]; charge?: number; draft?: boolean; note?: string };

const PAYMENTS: PaymentSpec[] = [
  { date: "2026-09-02", supplier: "S-004", ref: "TRF-0902-BTB", bills: [["A-BTB1"], ["A-BTB2"]], note: "Dua tagihan bengkel Agustus dalam satu transfer" },
  { date: "2026-09-05", supplier: "S-007", ref: "TRF-0905-KMO", bills: [["A-KMO"]] },
  { date: "2026-09-10", supplier: "S-005", ref: "TRF-0910-PLN", bills: [["A-PLN"]], charge: 6_500 },
  { date: "2026-09-12", supplier: "S-006", ref: "TRF-0912-AIC", bills: [["A-AIR"]] },
  { date: "2026-09-29", supplier: "S-008", ref: "TRF-0929-ENV", bills: [["A-ENV"]] },
  { date: "2026-10-05", supplier: "S-007", ref: "TRF-1005-KMO", bills: [["S-KMO", 65_000_000]], note: "Termin pertama; sisa dibayar setelah rekap absensi" },
  { date: "2026-10-06", supplier: "S-005", ref: "TRF-1006-PLN", bills: [["S-PLN"]], charge: 6_500 },
  { date: "2026-10-07", supplier: "S-006", ref: "TRF-1007-AIC", bills: [["S-AIR"]], draft: true, note: "Menunggu persetujuan transfer" },
];

const failure = (what: string, errors: Record<string, string>) => new Error(`${what}: ${Object.entries(errors).map(([k, v]) => `${k} ${v}`).join("; ")}`);

async function main() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("seed-production-showcase is development data and never runs in production.");
  }
  const sistem = await prisma.sysUser.findUnique({ where: { email: "sistem@erp.app" }, select: { id: true } });
  if (!sistem) throw new Error("System data is missing. Run `npm run db:seed` first.");
  const actor = sistem.id;

  const supplier = new Map<string, number>();
  for (const label of new Set([...BILLS.map((b) => b.supplier)])) {
    const p = await prisma.mPartner.findFirst({ where: { partner_label: label, category: { category_label: "Supplier" } }, select: { id: true } });
    if (!p) throw new Error(`Supplier ${label} is missing. Run \`npm run db:seed-showcase\` first.`);
    supplier.set(label, p.id);
  }
  const element = new Map((await prisma.accProductionCostElement.findMany({ select: { id: true, element_label: true } })).map((e) => [e.element_label, e.id]));
  for (const label of new Set(BILLS.flatMap((b) => b.lines.map((l) => l[0])))) {
    if (!element.has(label)) throw new Error(`Elemen Biaya Produksi ${label} is missing. Run \`npm run db:seed-showcase\` first.`);
  }

  // ---- the bills
  const billId = new Map<string, number>();
  let posted = 0;
  let drafts = 0;
  for (const b of BILLS) {
    const existing = await prisma.prdCostBill.findFirst({ where: { supplier_ref: b.ref, status: { not: "Cancelled" } }, select: { id: true } });
    if (existing) {
      billId.set(b.key, existing.id);
      continue;
    }
    const r = await createCostBill(
      { bill_date: b.date, partner_id: supplier.get(b.supplier)!, supplier_ref: b.ref, due_date: b.due ?? null, description: b.description, note: null },
      b.lines.map(([e, amount, note]) => ({ element_id: element.get(e)!, amount, note: note ?? null })),
      actor
    );
    if (!r.ok) throw failure(`Tagihan ${b.key}`, r.errors);
    billId.set(b.key, r.id);
    if (b.draft) {
      drafts++;
      continue;
    }
    const t = await transitionCostBill(r.id, "post", actor);
    if (!t.ok) throw failure(`Posting ${b.key}`, t.errors);
    posted++;
  }

  // ---- the payments, from the rupiah bank holding the most
  const banks = await prisma.mCashBank.findMany({
    where: { cash_bank_type: "Bank", status: "Active", currency: { currency_label: "IDR" } },
    select: { id: true, cash_bank_label: true, book_balance: { select: { balance: true } } },
  });
  const bank = banks.sort((a, b) => (b.book_balance?.balance.toNumber() ?? 0) - (a.book_balance?.balance.toNumber() ?? 0))[0];
  const billTotal = new Map(BILLS.map((b) => [b.key, b.lines.reduce((a, l) => a + l[1], 0)]));
  const todo: PaymentSpec[] = [];
  for (const p of PAYMENTS) if (!(await prisma.finCashBankTx.findFirst({ where: { bank_ref: p.ref, status: { not: "Cancelled" } }, select: { id: true } }))) todo.push(p);
  const needed = todo.filter((p) => !p.draft).reduce((a, p) => a + (p.charge ?? 0) + p.bills.reduce((x, [k, cash]) => x + (cash ?? billTotal.get(k)!), 0), 0);
  if (!bank || (bank.book_balance?.balance.toNumber() ?? 0) < needed) {
    console.log(`Bills: ${posted} posted, ${drafts} draft. Payments skipped: no rupiah bank holds enough — run \`db:seed-cash-bank-showcase\` first.`);
    return;
  }
  let paid = 0;
  let paidDrafts = 0;
  for (const p of todo) {
    const r = await createCashPayment(
      {
        purpose: "production_cost_payment",
        tx_date: p.date,
        partner_id: supplier.get(p.supplier)!,
        cash_bank_id: bank.id,
        bank_ref: p.ref,
        note: p.note ?? "",
        bank_charge: p.charge ?? 0,
        lines: p.bills.map(([key, cash]) => ({ doc_type: "prd_cost_bill", doc_id: billId.get(key)!, cash: cash ?? billTotal.get(key)!, withhold: false })),
      },
      actor
    );
    if (!r.ok) throw failure(`Pengeluaran ${p.ref}`, r.errors);
    if (p.draft) {
      paidDrafts++;
      continue;
    }
    const t = await transitionCashPayment(r.id, "post", actor);
    if (!t.ok) throw failure(`Posting ${p.ref}`, t.errors);
    paid++;
  }

  console.log("Production cost showcase created:");
  console.log(`  ${String(posted).padStart(4)}  Tagihan Biaya Produksi posted`);
  console.log(`  ${String(drafts).padStart(4)}  Tagihan Biaya Produksi draft`);
  console.log(`  ${String(paid).padStart(4)}  Pembayaran Biaya Produksi posted (from ${bank.cash_bank_label})`);
  console.log(`  ${String(paidDrafts).padStart(4)}  Pembayaran Biaya Produksi draft`);
  console.log("\nDevelopment data only.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
