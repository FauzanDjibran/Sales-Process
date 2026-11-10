import { actorCan } from "@/lib/erp/access";
import { currentActor } from "@/lib/erp/auth";
import { cashBankBalanceReport, cashBankLedgerReport } from "@/lib/erp/cash-bank";
import { cashBankBalanceWorkbook } from "@/lib/erp/cash-bank-balance-export";
import { cashBankLedgerWorkbook } from "@/lib/erp/cash-bank-export";
import { attachDocumentNumbers } from "@/lib/erp/document-numbers";
import { parseIds, resolveRange } from "@/lib/erp/report-params";
import { reportBySlug } from "@/lib/erp/reports";
import { xlsxResponse } from "@/lib/erp/statement-export";
import { companyName } from "@/lib/erp/system-settings";
import { formatDate, formatTimestamp } from "@/lib/format";

export const dynamic = "force-dynamic";

/**
 * Unduh XLSX for Buku Kas & Bank and Saldo Kas & Bank — the Finance twin of the
 * Accounting export route. It reads the page's own parameters through the
 * page's own reader under the page's own permission, so the file is the run on
 * screen. A refusal says nothing about why, like every denial.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ report: string }> }
) {
  const { report: slug } = await params;
  const report = reportBySlug(slug);
  if (!report || report.module !== "finance" || !["cash_bank_ledger", "cash_bank_balance"].includes(report.key)) {
    return new Response("Tidak ditemukan", { status: 404 });
  }

  const actor = await currentActor();
  if (!actor) return new Response("Silakan masuk kembali", { status: 401 });
  if (!actorCan(actor, report.permission)) return new Response("Akses ditolak", { status: 403 });

  const query = Object.fromEntries(new URL(request.url).searchParams);
  const range = resolveRange(query.from, query.to);
  const ids = parseIds(query.cashBank);
  const common = {
    companyName: await companyName(),
    printedBy: actor.user.name,
    printedAt: formatTimestamp(new Date()),
  };
  const name = `${report.name} ${range.from} - ${range.to}.xlsx`;

  if (report.key === "cash_bank_ledger") {
    const books = (await Promise.all(ids.map((id) => cashBankLedgerReport(id, range)))).filter((b) => b !== null);
    if (!books.length) return new Response("Pilih Cash & Bank terlebih dahulu", { status: 400 });
    await attachDocumentNumbers(books.flatMap((b) => b.entries));
    const file = await cashBankLedgerWorkbook({
      ...common,
      range,
      books,
      footnotes: [`Saldo awal adalah seluruh mutasi sebelum ${formatDate(range.from)}.`],
    });
    return xlsxResponse(file, name);
  }

  const data = await cashBankBalanceReport(range, ids);
  const file = await cashBankBalanceWorkbook({
    ...common,
    report: data,
    footnotes: ["Setiap currency direkap terpisah dan tidak pernah dijumlahkan menjadi satu angka."],
  });
  return xlsxResponse(file, name);
}
