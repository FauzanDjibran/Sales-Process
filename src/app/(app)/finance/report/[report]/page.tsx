import { notFound } from "next/navigation";
import { CashBankBalanceReport } from "@/components/report/cash-bank-balance-report";
import { CashBankLedgerReport } from "@/components/report/cash-bank-ledger-report";
import { ReportParams } from "@/components/report/report-params";
import { ReportNeedsSubject, ReportView } from "@/components/report/report-view";
import { requirePermission } from "@/lib/erp/auth";
import {
  cashBankBalanceReport,
  cashBankLedgerReport,
} from "@/lib/erp/cash-bank";
import type { PeriodRange } from "@/lib/erp/period";
import { reportBySlug, reportHref } from "@/lib/erp/reports";
import { prisma } from "@/lib/prisma";
import { formatDate } from "@/lib/format";
import { ArReportParams } from "@/components/report/ar-report-params";
import { ArAgingReport } from "@/components/report/ar-aging-report";
import { ArLedgerReportBody } from "@/components/report/ar-ledger-report";
import { CustomerAdvanceReport, type AdvanceReconciliation } from "@/components/report/customer-advance-report";
import { arItemsReconcile, arLedgerReport, arPartnerOptions, openArItemsAsOf } from "@/lib/erp/ar-item";
import { closingBalances } from "@/lib/erp/ledger";
import { postingAccounts } from "@/lib/erp/system-settings";

export const dynamic = "force-dynamic";

/**
 * Every Report View in the Finance module, driven by the catalogue.
 *
 * One route rather than one file per report, for the reason §12 gives for the
 * registry pages: the chrome, the permission check and the parameter parsing
 * are the same every time, and only the body differs. Adding a report is a
 * `reports.ts` entry plus a body component.
 *
 * **Parameters come from the query string**, so a report run is a URL: linkable,
 * bookmarkable, and back-button-able. The page reads them, resolves defaults,
 * and queries — no client-side fetching (CLAUDE.md §3).
 */
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ report: string }>;
  searchParams: Promise<{
    cashBank?: string;
    customer?: string;
    asOf?: string;
    from?: string;
    to?: string;
  }>;
}) {
  const { report: slug } = await params;
  const report = reportBySlug(slug);
  if (!report) notFound();

  await requirePermission(report.permission, reportHref(slug));

  const query = await searchParams;
  const range = resolveRange(query.from, query.to);
  const cashBankId = positiveInt(query.cashBank);
  const runAt = new Date().toISOString();

  if (report.params === "ar-asof" || report.params === "ar-period") {
    return arReport(report, query, range, runAt);
  }

  const resources = await cashBankOptions();

  const filterBar = (
    <>
      <ReportParams
        slug={slug}
        resources={resources}
        cashBankId={cashBankId}
        from={range.from}
        to={range.to}
        subjectRequired={report.subjectRequired}
        subjectLabel="Cash & Bank"
        allLabel={report.subjectRequired ? undefined : "Semua resource"}
      />
    </>
  );

  // --------------------------------------------------------------- ledger

  if (report.key === "cash_bank_ledger") {
    const data = cashBankId
      ? await cashBankLedgerReport(cashBankId, range)
      : null;

    return (
      <ReportView
        report={report}
        filter={filterBar}
        runAt={runAt}
        footnote={
          <>
            Saldo awal adalah seluruh mutasi sebelum {formatDate(range.from)} dan
            bukan entri tersendiri, sehingga tidak muncul sebagai baris.
          </>
        }
      >
        {data ? (
          <CashBankLedgerReport report={data} />
        ) : (
          <ReportNeedsSubject
            icon="book"
            title="Pilih Cash & Bank terlebih dahulu"
            body="Buku kas/bank selalu milik satu resource. Pilih resource dan rentang tanggal di atas, lalu tekan Tampilkan."
          />
        )}
      </ReportView>
    );
  }

  // -------------------------------------------------------------- balance

  const data = await cashBankBalanceReport(range, cashBankId);

  return (
    <ReportView
      report={report}
      filter={filterBar}
      runAt={runAt}
      footnote={
        <>
          Setiap currency direkap terpisah dan tidak pernah dijumlahkan menjadi
          satu angka.
        </>
      }
    >
      <CashBankBalanceReport report={data} />
    </ReportView>
  );
}

/**
 * The period a report runs for.
 *
 * Defaults to the current month to date: predictable, needs no Fiscal Year to
 * exist, and consistent with the rule that a date field starts on today (§10).
 * A range whose end precedes its start is swapped rather than refused — the
 * parameter bar already blocks it, and a direct URL should still answer.
 */
function resolveRange(from?: string, to?: string): PeriodRange {
  const today = new Date();
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const monthStart = new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1)
  );

  const start = isDate(from) ? from : iso(monthStart);
  const end = isDate(to) ? to : iso(today);
  return start <= end ? { from: start, to: end } : { from: end, to: start };
}

function isDate(value: string | undefined): value is string {
  return Boolean(
    value &&
      /^\d{4}-\d{2}-\d{2}$/.test(value) &&
      !Number.isNaN(Date.parse(`${value}T00:00:00Z`))
  );
}

function positiveInt(value: string | undefined): number | null {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * The resources a report may be run for.
 *
 * Inactive ones stay selectable: a report about last quarter is exactly when a
 * resource that has since been deactivated still matters. The list marks them,
 * which is what `Combobox` does with `active: false` when the value is chosen.
 */
async function cashBankOptions() {
  const rows = await prisma.mCashBank.findMany({
    orderBy: [{ cash_bank_label: "asc" }],
    select: {
      id: true,
      cash_bank_label: true,
      cash_bank_name: true,
      status: true,
      currency: { select: { currency_label: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    label: r.cash_bank_label,
    name:
      `${r.cash_bank_name} · ${r.currency.currency_label}` +
      (r.status === "Active" ? "" : " · non-aktif"),
    // Deliberately always true: a report must be runnable for a resource that
    // is no longer active, unlike a new-transaction picker, which hides them.
    // The name says so instead of the option disappearing.
    active: true,
  }));
}

// ------------------------------------------------------------ AR reports

/**
 * Buku Piutang, Umur Piutang and Uang Muka Customer (P75). Their figures come
 * from the AR items; the Uang Muka report is also checked against the General
 * Ledger, which is composed here — the AR book never reads the journal.
 */
async function arReport(
  report: NonNullable<ReturnType<typeof reportBySlug>>,
  query: { customer?: string; asOf?: string },
  range: PeriodRange,
  runAt: string
) {
  const customerId = positiveInt(query.customer);
  const asOf = isDate(query.asOf) ? query.asOf : new Date().toISOString().slice(0, 10);
  const customers = await arPartnerOptions();
  const filter = (
    <ArReportParams
      slug={report.slug}
      customers={customers}
      customerId={customerId}
      mode={report.params === "ar-asof" ? "asof" : "period"}
      asOf={asOf}
      from={range.from}
      to={range.to}
      subjectRequired={report.subjectRequired}
    />
  );
  const reconciles = await arItemsReconcile(customerId);
  const mismatch = reconciles ? null : (
    <>Ada AR item yang saldonya tidak sama dengan jumlah entri Buku Piutang-nya; angka di atas dibaca dari entri.</>
  );

  if (report.key === "ar_ledger") {
    const data = customerId ? await arLedgerReport(customerId, range) : null;
    return (
      <ReportView
        report={report}
        filter={filter}
        runAt={runAt}
        footnote={mismatch ?? <>Menambah menaikkan Piutang Usaha customer (invoice, uang muka yang dipakai); Mengurangi menurunkannya (uang muka diterima, pembayaran).</>}
      >
        {data ? (
          <ArLedgerReportBody report={data} />
        ) : (
          <ReportNeedsSubject
            icon="book"
            title="Pilih Customer terlebih dahulu"
            body="Buku Piutang selalu milik satu customer. Pilih customer dan rentang tanggal di atas, lalu tekan Tampilkan."
          />
        )}
      </ReportView>
    );
  }

  const advances = await openArItemsAsOf("Advance", asOf, customerId);

  if (report.key === "ar_aging") {
    const invoices = await openArItemsAsOf("Invoice", asOf, customerId);
    return (
      <ReportView
        report={report}
        filter={filter}
        runAt={runAt}
        footnote={mismatch ?? <>Umur dihitung dari tanggal jatuh tempo invoice per {formatDate(asOf)}; uang muka mengurangi posisi bersih tetapi tidak dialokasikan ke kelompok umur.</>}
      >
        <ArAgingReport invoices={invoices} advances={advances} asOf={asOf} />
      </ReportView>
    );
  }

  // Uang Muka Customer, checked against the Uang Muka Penjualan account.
  let gl: AdvanceReconciliation;
  const mapped = await postingAccounts(["sales_advance_account"] as const);
  if (!mapped.ok) {
    gl = { ok: false, missing: `${mapped.missing.join(", ")} belum diatur di Account Mapping.` };
  } else {
    const accountId = mapped.ids.sales_advance_account;
    const balances = (await closingBalances(asOf)).filter((b) => b.accountId === accountId);
    const account = await prisma.accAccount.findUnique({ where: { id: accountId }, select: { account_label: true, account_name: true } });
    const byPartner: Record<number, number> = {};
    for (const b of balances) if (b.partnerId) byPartner[b.partnerId] = (byPartner[b.partnerId] ?? 0) + b.balance;
    gl = { ok: true, accountLabel: account?.account_label ?? "", accountName: account?.account_name ?? "", byPartner };
  }
  return (
    <ReportView
      report={report}
      filter={filter}
      runAt={runAt}
      footnote={mismatch ?? <>Nilai uang muka adalah bagian DPP-nya — yang tercatat di account Uang Muka Penjualan; PPN-nya sudah tercatat di PPN Keluaran saat diterima.</>}
    >
      <CustomerAdvanceReport rows={advances} gl={gl} />
    </ReportView>
  );
}

