import { notFound } from "next/navigation";
import { CashBankBalanceReport } from "@/components/report/cash-bank-balance-report";
import { CashBankLedgerReport } from "@/components/report/cash-bank-ledger-report";
import { SubjectParams } from "@/components/report/subject-params";
import { parseIds, resolveRange } from "@/lib/erp/report-params";
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
import { customerOrderNumbersByIds } from "@/lib/erp/customer-order";
import { permitRequestNumbersByIds } from "@/lib/erp/permit-request";
import { ApReportParams } from "@/components/report/ap-report-params";
import { ApAgingReport } from "@/components/report/ap-aging-report";
import { ApLedgerReportBody } from "@/components/report/ap-ledger-report";
import { SupplierAdvanceReport, type SupplierAdvanceReconciliation } from "@/components/report/supplier-advance-report";
import { apItemsReconcileFor, apLedgerReport, apPartnerOptions, openApItemsAsOf } from "@/lib/erp/ap-item";
import { purchaseOrderNumbersByIds } from "@/lib/erp/purchase-order";

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
    supplier?: string;
    asOf?: string;
    from?: string;
    to?: string;
    advance?: string;
  }>;
}) {
  const { report: slug } = await params;
  const report = reportBySlug(slug);
  if (!report) notFound();

  await requirePermission(report.permission, reportHref(slug));

  const query = await searchParams;
  const range = resolveRange(query.from, query.to);
  const runAt = new Date().toISOString();

  if (report.params === "ar-asof" || report.params === "ar-period") {
    return arReport(report, query, range, runAt);
  }
  if (report.params === "ap-asof" || report.params === "ap-period") {
    return apReport(report, query, range, runAt);
  }

  const resources = await cashBankOptions();

  // Both Cash & Bank reports read several resources at once, like the General Ledger.
  const cashBankIds = parseIds(query.cashBank);
  const exportHref = reportHref(`${slug}/export`, {
    cashBank: cashBankIds.join(","),
    from: range.from,
    to: range.to,
  });
  const filterBar = (
    <SubjectParams
      slug={slug}
      subjects={resources}
      selectedIds={cashBankIds}
      from={range.from}
      to={range.to}
      subjectRequired={report.subjectRequired}
      label="Cash & Bank"
      param="cashBank"
      addPlaceholder="Tambah Cash & Bank…"
      allPlaceholder={report.subjectRequired ? "Pilih Cash & Bank…" : "Semua Cash & Bank"}
      missingHint="Pilih minimal satu Cash & Bank terlebih dahulu."
    />
  );

  // --------------------------------------------------------------- ledger

  if (report.key === "cash_bank_ledger") {
    const books = await Promise.all(
      cashBankIds.map((id) => cashBankLedgerReport(id, range, { entries: false }))
    );
    const data = cashBankIds.length ? books.filter((b) => b !== null) : null;

    return (
      <ReportView
        report={report}
        filter={filterBar}
        runAt={runAt}
        exportHref={data?.length ? exportHref : undefined}
        footnote={
          <>
            Saldo awal adalah seluruh mutasi sebelum {formatDate(range.from)} dan
            bukan entri tersendiri, sehingga tidak muncul sebagai baris.
          </>
        }
      >
        {data ? (
          <CashBankLedgerReport
            key={`${range.from}|${range.to}|${cashBankIds.join(",")}`}
            books={data}
            range={range}
          />
        ) : (
          <ReportNeedsSubject
            icon="book"
            title="Pilih Cash & Bank terlebih dahulu"
            body="Buku kas/bank selalu milik sebuah resource. Pilih satu resource atau lebih beserta rentang tanggal di atas, lalu tekan Tampilkan."
          />
        )}
      </ReportView>
    );
  }

  // -------------------------------------------------------------- balance

  const data = await cashBankBalanceReport(range, cashBankIds);

  return (
    <ReportView
      report={report}
      filter={filterBar}
      runAt={runAt}
      exportHref={data.groups.length ? exportHref : undefined}
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
  query: { customer?: string; asOf?: string; advance?: string },
  range: PeriodRange,
  runAt: string
) {
  const customerId = positiveInt(query.customer);
  const asOf = isDate(query.asOf) ? query.asOf : new Date().toISOString().slice(0, 10);
  const customers = await arPartnerOptions();
  // Buku Piutang holds Invoice items only unless Uang Muka is asked for (P77).
  const includeAdvance = query.advance === "1";
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
      advance={report.key === "ar_ledger" ? includeAdvance : null}
    />
  );
  const reconciles = await arItemsReconcile(customerId);
  const mismatch = reconciles ? null : (
    <>Ada AR item yang saldonya tidak sama dengan jumlah entri Buku Piutang-nya; angka di atas dibaca dari entri.</>
  );

  if (report.key === "ar_ledger") {
    const data = customerId ? await arLedgerReport(customerId, range, { includeAdvance }) : null;
    return (
      <ReportView
        report={report}
        filter={filter}
        runAt={runAt}
        footnote={
          mismatch ??
          (includeAdvance ? (
            <>Menambah menaikkan Piutang Usaha customer (invoice, uang muka yang dipakai); Mengurangi menurunkannya (uang muka diterima, pembayaran).</>
          ) : (
            <>Buku ini memuat Invoice saja; uang muka yang masih dipegang customer disebut di bawahnya. Centang Sertakan Uang Muka untuk memasukkannya ke buku.</>
          ))
        }
      >
        {data ? (
          <ArLedgerReportBody report={data} orderNos={await scopeNumbers(data.entries)} />
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

  // Uang Muka Customer, checked against the Uang Muka accounts — Penjualan and,
  // once a Perizinan advance exists, Perizinan (P137): the items hold both.
  let gl: AdvanceReconciliation;
  const permitHeld = advances.some((a) => a.scopeTable === "sal_permit_request");
  const mapped = await postingAccounts(permitHeld ? (["sales_advance_account", "permit_advance_account"] as const) : (["sales_advance_account"] as const));
  if (!mapped.ok) {
    gl = { ok: false, missing: `${mapped.missing.join(", ")} belum diatur di Account Mapping.` };
  } else {
    const accountIds = Object.values(mapped.ids as Record<string, number>);
    const accountId = (mapped.ids as Record<string, number>).sales_advance_account;
    const balances = (await closingBalances(asOf)).filter((b) => accountIds.includes(b.accountId));
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
      <CustomerAdvanceReport rows={advances} gl={gl} orderNos={await scopeNumbers(advances)} />
    </ReportView>
  );
}


/**
 * Customer Order numbers by id for the AR reports: the AR book names an order
 * by id only, and the page composes the order module's numbers (§3.1).
 */
/** Each AR item's agreement number by `table:id`: a Customer Order or a Pengajuan Perizinan (P137). */
async function scopeNumbers(rows: { scopeTable: string | null; scopeId: number | null }[]): Promise<Record<string, string>> {
  const ids = (table: string) => [...new Set(rows.filter((r) => r.scopeTable === table && r.scopeId).map((r) => r.scopeId!))];
  const [orders, permits] = await Promise.all([customerOrderNumbersByIds(ids("sal_customer_order")), permitRequestNumbersByIds(ids("sal_permit_request"))]);
  return Object.fromEntries([
    ...[...orders].map(([id, no]) => [`sal_customer_order:${id}`, no] as const),
    ...[...permits].map(([id, no]) => [`sal_permit_request:${id}`, no] as const),
  ]);
}

// ------------------------------------------------------------ AP reports

/**
 * Buku Hutang, Umur Hutang and Uang Muka Supplier (B33): the AR reports
 * mirrored on the AP items. The Uang Muka report is checked against the
 * Uang Muka Pembelian account in the General Ledger, composed here.
 */
async function apReport(
  report: NonNullable<ReturnType<typeof reportBySlug>>,
  query: { supplier?: string; asOf?: string; advance?: string },
  range: PeriodRange,
  runAt: string
) {
  const supplierId = positiveInt(query.supplier);
  const asOf = isDate(query.asOf) ? query.asOf : new Date().toISOString().slice(0, 10);
  const includeAdvance = query.advance === "1";
  const filter = (
    <ApReportParams
      slug={report.slug}
      suppliers={await apPartnerOptions()}
      supplierId={supplierId}
      mode={report.params === "ap-asof" ? "asof" : "period"}
      asOf={asOf}
      from={range.from}
      to={range.to}
      subjectRequired={report.subjectRequired}
      advance={report.key === "ap_ledger" ? includeAdvance : null}
    />
  );
  const mismatch = (await apItemsReconcileFor(supplierId)) ? null : (
    <>Ada AP item yang saldonya tidak sama dengan jumlah entri Buku Hutang-nya; angka di atas dibaca dari entri.</>
  );
  const poNumbers = async (ids: (number | null)[]) => {
    const wanted = [...new Set(ids.filter((id): id is number => id !== null))];
    return wanted.length ? Object.fromEntries(await purchaseOrderNumbersByIds(wanted)) : {};
  };

  if (report.key === "ap_ledger") {
    const data = supplierId ? await apLedgerReport(supplierId, range, { includeAdvance }) : null;
    return (
      <ReportView
        report={report}
        filter={filter}
        runAt={runAt}
        footnote={mismatch ?? <>Menambah menaikkan Hutang Usaha ke supplier (invoice); Mengurangi menurunkannya (uang muka dibayar, pembayaran, uang muka diterapkan).</>}
      >
        {data ? (
          <ApLedgerReportBody report={data} orderNos={await poNumbers(data.entries.map((e) => e.orderId))} />
        ) : (
          <ReportNeedsSubject icon="book" title="Pilih Supplier terlebih dahulu" body="Buku Hutang selalu milik satu supplier. Pilih supplier dan rentang tanggal di atas, lalu tekan Tampilkan." />
        )}
      </ReportView>
    );
  }

  const advances = await openApItemsAsOf("Advance", asOf, supplierId);
  if (report.key === "ap_aging") {
    const invoices = await openApItemsAsOf("Invoice", asOf, supplierId);
    return (
      <ReportView report={report} filter={filter} runAt={runAt} footnote={mismatch ?? <>Umur dihitung dari tanggal jatuh tempo invoice per {formatDate(asOf)}.</>}>
        <ApAgingReport invoices={invoices} advances={advances} asOf={asOf} />
      </ReportView>
    );
  }

  let gl: SupplierAdvanceReconciliation;
  const mapped = await postingAccounts(["purchase_advance_account"] as const);
  if (!mapped.ok) gl = { ok: false, missing: `${mapped.missing.join(", ")} belum diatur di Account Mapping.` };
  else {
    const accountId = mapped.ids.purchase_advance_account;
    const balances = (await closingBalances(asOf)).filter((b) => b.accountId === accountId);
    const account = await prisma.accAccount.findUnique({ where: { id: accountId }, select: { account_label: true, account_name: true } });
    const byPartner: Record<number, number> = {};
    // An asset: a debit balance is what the supplier holds of ours.
    for (const b of balances) if (b.partnerId) byPartner[b.partnerId] = (byPartner[b.partnerId] ?? 0) + b.balance;
    gl = { ok: true, accountLabel: account?.account_label ?? "", accountName: account?.account_name ?? "", byPartner };
  }
  return (
    <ReportView report={report} filter={filter} runAt={runAt} footnote={mismatch ?? <>Nilai uang muka adalah bagian DPP-nya — yang tercatat di account Uang Muka Pembelian; PPN-nya sudah dikreditkan sebagai PPN Masukan saat dibayar.</>}>
      <SupplierAdvanceReport rows={advances} gl={gl} orderNos={await poNumbers(advances.map((a) => a.orderId))} />
    </ReportView>
  );
}
