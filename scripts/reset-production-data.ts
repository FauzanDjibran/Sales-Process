/**
 * Empties the production documents and books, leaving every master and every
 * other document standing (P262, `production_app_plan.md` stage 5.1: the
 * production data of development is reset rather than converted to the new
 * shapes). A hand-run script, like `truncate-transactions`.
 *
 *   npm run db:reset-production              counts only
 *   npm run db:reset-production -- --apply   deletes, in one transaction
 *
 * WHAT IT DELETES
 *   prd_qc_check(_line), prd_work(_line), prd_grading(_input, _output), prd_aux_use
 *   prd_tracking_link, prd_cost_entry, prd_ledger, prd_balance,
 *   prd_tracking_info, prd_job, prd_partai          the production books
 *   log_stock_issue(_line, _tracking)                BSTB Issue
 *   the stock and valuation ledger rows, journals and audit rows those wrote,
 *   and the No. Stok production registered (outputs of a grading)
 *
 * WHAT IT REBUILDS
 *   log_stock_balance and log_stock_valuation_balance of the buckets and items
 *   it touched, from the rows that stay, and the running balances stored on
 *   those rows; every reservation (only a BSTB Issue reserves, P228)
 *
 * WHAT IT KEEPS
 *   Unit, Workstation, Line, Routing, Standard Cost, Karyawan, prd_user_unit,
 *   Tagihan Biaya and its payments, and everything outside production.
 */
import { prisma } from "../src/lib/prisma";

const apply = process.argv.includes("--apply");
const DOCS = ["log_stock_issue", "prd_grading", "prd_work", "prd_qc_check"];

async function main() {
  const types = await prisma.sysDocType.findMany({ where: { doc_table: { in: DOCS } }, select: { id: true } });
  const typeIds = types.map((t) => t.id);
  const bySource = { source_doc_type_id: { in: typeIds } };

  const counts = {
    "BSTB Issue": await prisma.logStockIssue.count(),
    "No. Grading": await prisma.prdGrading.count(),
    "Pengerjaan Unit": await prisma.prdWork.count(),
    "QC Check": await prisma.prdQcCheck.count(),
    "prd_ledger": await prisma.prdLedger.count(),
    "prd_balance": await prisma.prdBalance.count(),
    "Partai": await prisma.prdPartai.count(),
    "Job": await prisma.prdJob.count(),
    "stock ledger rows": await prisma.logStockLedger.count({ where: bySource }),
    "valuation ledger rows": await prisma.logStockValuationLedger.count({ where: bySource }),
    "journals": await prisma.accJournal.count({ where: bySource }),
    "No. Stok made in production": await prisma.logStockTracking.count({ where: bySource }),
  };
  console.table(counts);
  if (!apply) {
    console.log("Counts only. Run with --apply to delete.");
    return;
  }

  await prisma.$transaction(
    async (tx) => {
      const buckets = await tx.logStockLedger.findMany({ where: bySource, select: { warehouse_id: true, location_id: true, tracking_id: true, stock_status_id: true }, distinct: ["warehouse_id", "location_id", "tracking_id", "stock_status_id"] });
      const items = (await tx.logStockValuationLedger.findMany({ where: bySource, select: { item_id: true }, distinct: ["item_id"] })).map((r) => r.item_id);
      const journals = (await tx.accJournal.findMany({ where: bySource, select: { id: true } })).map((j) => j.id);
      const docIds = {
        issue: (await tx.logStockIssue.findMany({ select: { id: true } })).map((r) => r.id),
        grading: (await tx.prdGrading.findMany({ select: { id: true } })).map((r) => r.id),
        work: (await tx.prdWork.findMany({ select: { id: true } })).map((r) => r.id),
        qc: (await tx.prdQcCheck.findMany({ select: { id: true } })).map((r) => r.id),
      };

      // Documents first, then the books they wrote, then what names a No. Stok.
      await tx.prdQcCheckLine.deleteMany({});
      await tx.prdQcCheck.deleteMany({});
      await tx.prdAuxUse.deleteMany({});
      await tx.prdWorkLine.deleteMany({});
      await tx.prdWork.deleteMany({});
      await tx.prdGradingOutput.deleteMany({});
      await tx.prdGrading.deleteMany({});
      await tx.prdTrackingLink.deleteMany({});
      await tx.prdCostEntry.deleteMany({});
      await tx.prdLedger.deleteMany({});
      await tx.prdBalance.deleteMany({});
      await tx.prdTrackingInfo.deleteMany({});
      await tx.prdJob.deleteMany({});
      await tx.prdPartai.deleteMany({});
      await tx.logStockIssueTracking.deleteMany({});
      await tx.logStockIssueLine.deleteMany({});
      await tx.logStockIssue.deleteMany({});
      await tx.logStockLedger.deleteMany({ where: bySource });
      await tx.logStockValuationLedger.deleteMany({ where: bySource });
      await tx.accJournalLine.deleteMany({ where: { journal_id: { in: journals } } });
      await tx.accJournal.deleteMany({ where: { id: { in: journals } } });
      await tx.logStockTracking.deleteMany({ where: bySource });
      await tx.auditLog.deleteMany({
        where: {
          OR: [
            { entity_key: "log_stock_issue", row_id: { in: docIds.issue } },
            { entity_key: "prd_grading", row_id: { in: docIds.grading } },
            { entity_key: "prd_work", row_id: { in: docIds.work } },
            { entity_key: "prd_qc_check", row_id: { in: docIds.qc } },
          ],
        },
      });

      // Every bucket a BSTB Issue moved: its balance is what its remaining rows add up to.
      for (const b of buckets) {
        const rows = await tx.logStockLedger.findMany({ where: b, orderBy: { id: "asc" }, select: { id: true, qty_change: true } });
        let q = 0;
        for (const r of rows) {
          q += Number(r.qty_change);
          await tx.logStockLedger.update({ where: { id: r.id }, data: { qty_balance: q } });
        }
        await tx.logStockBalance.updateMany({ where: b, data: { qty_balance: q } });
      }
      // Every pool it moved, the same way, with its value.
      for (const item_id of items) {
        const rows = await tx.logStockValuationLedger.findMany({ where: { item_id }, orderBy: { id: "asc" }, select: { id: true, qty_change: true, value_change: true } });
        let q = 0;
        let v = 0;
        for (const r of rows) {
          q += Number(r.qty_change);
          v += Number(r.value_change);
          await tx.logStockValuationLedger.update({ where: { id: r.id }, data: { qty_balance: q, value_balance: v } });
        }
        await tx.logStockValuationBalance.updateMany({ where: { item_id }, data: { qty_balance: q, value_balance: v } });
      }
      await tx.logStockBalance.updateMany({ where: { reserved_qty: { not: 0 } }, data: { reserved_qty: 0 } });
    },
    { timeout: Number(process.env.PRISMA_TX_TIMEOUT_MS ?? 120_000) }
  );
  console.log("Production data reset. Run db:reconcile next.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
