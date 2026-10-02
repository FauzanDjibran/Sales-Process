/**
 * Rebuilds the AR book from the documents, after the migration that reshaped
 * it (20261003090000_ar_open_item_hybrid, Claude-ERP.md P87–P92).
 *
 * That migration cleared the old AR rows, because a Tagihan item's expected
 * PPh comes from the tax module and cannot be worked out in SQL. This script
 * writes them again through the same functions the application posts with:
 *
 *   1. every Issued advance bill gets its Tagihan Uang Muka item, dated and
 *      due as the bill is (`handAdvanceToAr`);
 *   2. every posted Penerimaan is replayed oldest first — its Tagihan items go
 *      down, and each bill's one Uang Muka item is created or raised
 *      (`writeReceiptToAr`).
 *
 * **Idempotent.** A bill that already has its Tagihan item, and a receipt that
 * already has entries in Buku Piutang, are skipped, so running it twice writes
 * nothing the second time. Each bill and each receipt is its own transaction.
 *
 *   npm run db:rebuild-ar
 */
import { prisma } from "../src/lib/prisma";
import { findArItem } from "../src/lib/erp/ar-item";
import { handAdvanceToAr, storedAdvanceFigures } from "../src/lib/erp/sales-advance";
import { cashBankTxDocTypeId, postedReceiptsForAr, writeReceiptToAr } from "../src/lib/erp/cash-bank-tx";

async function main() {
  const actor = (await prisma.sysUser.findFirstOrThrow({ where: { email: "sistem@erp.app" }, select: { id: true } })).id;
  const billType = (await prisma.sysDocType.findFirstOrThrow({ where: { doc_table: "sal_advance" }, select: { id: true } })).id;

  // 1. Tagihan items for issued bills.
  const bills = await prisma.salAdvance.findMany({
    where: { status: "Issued" },
    orderBy: [{ advance_date: "asc" }, { id: "asc" }],
    select: { id: true, advance_no: true },
  });
  let made = 0;
  for (const b of bills) {
    if (await findArItem(prisma, "AdvanceRequest", billType, b.id)) continue;
    const stored = await storedAdvanceFigures(prisma, b.id);
    if (!stored) throw new Error(`${b.advance_no}: Customer Order tidak ditemukan.`);
    await prisma.$transaction((tx) => handAdvanceToAr(tx, stored.bill, stored.order, stored.figures, actor));
    made++;
    console.log(`  Tagihan ${b.advance_no}: ${stored.figures.total.toLocaleString("id-ID")}`);
  }

  // 2. Posted receipts, replayed oldest first.
  const txType = await cashBankTxDocTypeId();
  let replayed = 0;
  for (const t of await postedReceiptsForAr()) {
    const done = await prisma.finArLedger.count({ where: { doc_type_id: txType, doc_id: t.id } });
    if (done) continue;
    await prisma.$transaction((tx) => writeReceiptToAr(tx, { ...t, docTypeId: txType }, t.lines, actor));
    replayed++;
    console.log(`  ${t.tx_no}: ${t.lines.length} tagihan`);
  }

  console.log(`Selesai: ${made} Tagihan dibuat, ${replayed} penerimaan diputar ulang.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
