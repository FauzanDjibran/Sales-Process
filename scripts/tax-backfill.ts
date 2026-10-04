/**
 * Makes the tax documents of everything posted before the tax module existed
 * (P100): a faktur uang muka and bukti potong per posted receipt, a faktur
 * pelunasan / normal per posted Invoice Penjualan. Idempotent — a document that
 * already has its tax documents is skipped — so it is safe to run twice.
 *
 * The documents are recorded as made by the first user — the system account —
 * since no person made them.
 *
 * Run with:  npm run db:tax-backfill       (local)
 *            npm run db:neon-tax-backfill  (the deployed database)
 */
import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { backfillTaxDocuments } from "@/lib/erp/tax-document";

async function main() {
  const admin = await prisma.sysUser.findFirst({ orderBy: { id: "asc" }, select: { id: true, email: true } });
  if (!admin) throw new Error("Belum ada user. Jalankan seed dulu.");
  const before = { fakturs: await prisma.taxFaktur.count(), slips: await prisma.taxWithholdingSlip.count() };
  const seen = await backfillTaxDocuments(admin.id);
  const after = { fakturs: await prisma.taxFaktur.count(), slips: await prisma.taxWithholdingSlip.count() };
  console.log(
    `\nDiperiksa ${seen.receipts} penerimaan dan ${seen.invoices} invoice yang sudah diposting.` +
      `\nFaktur pajak baru: ${after.fakturs - before.fakturs}. Bukti potong baru: ${after.slips - before.slips}.` +
      `\nDicatat atas nama ${admin.email}.\n`
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
