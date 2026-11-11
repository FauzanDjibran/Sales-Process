import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Module boundaries hold, checked mechanically.
 *
 * The application is one deployable unit, but each module is meant to behave
 * as a building block that could be replaced or lifted out — which is only true
 * while modules talk to each other through named functions rather than
 * reaching into each other's tables. Nothing here breaks a build or a type
 * check when it erodes, which is exactly why it erodes: in SIBA, one module
 * wrote another's table directly for as long as both existed, and the import
 * graph looked clean the whole time because it went to the Prisma delegate.
 *
 * This is a source-text scan, like `design-system.test.ts`. It needs no
 * database and costs nothing to run.
 */

const SRC = join(process.cwd(), "src");

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (name === "generated") continue;
    if (statSync(p).isDirectory()) sourceFiles(p, out);
    else if (/\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

const relPath = (path: string) =>
  path.slice(process.cwd().length + 1).replaceAll("\\", "/");

const files = sourceFiles(SRC).map((path) => ({
  path,
  rel: relPath(path),
  text: readFileSync(path, "utf8"),
}));

/** Code, with block comments and `//` lines removed — the docs name these. */
const code = (text: string) =>
  text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const sibaModule = (name: string) =>
  files.find((f) => f.rel === `src/lib/erp/${name}.ts`)!;

/** The `./x` and `@/lib/erp/x` modules a file imports. */
function sibaImports(text: string): string[] {
  const out = new Set<string>();
  for (const m of code(text).matchAll(/from\s+"\.\/([a-z-]+)"/g)) out.add(m[1]);
  for (const m of code(text).matchAll(/from\s+"@\/lib\/erp\/([a-z-]+)"/g)) {
    out.add(m[1]);
  }
  return [...out];
}

// ------------------------------------------------------------ table owners

/**
 * Who may name a Prisma delegate.
 *
 * Only tables with a real owner are listed. `records.ts` is the registry's
 * generic reader and deliberately reaches many tables, so master tables are
 * left unconstrained — the rule is about a module's *own* records, not about
 * every query in the application.
 */
const TABLE_OWNERS: Record<string, string[]> = {
  // A module is its data module *and* its Server Action — two layers of one
  // building block, not two modules.
  sysNumberCounter: ["src/lib/erp/number-counter.ts"],
  cashBankLedger: ["src/lib/erp/cash-bank.ts"],
  cashBankBalance: ["src/lib/erp/cash-bank.ts"],
  cashBankPeriod: ["src/lib/erp/cash-bank.ts"],
  // The General Ledger is the one thing that may derive from journal lines
  // (CLAUDE.md §10 rule 22) — it reads them and never writes one.
  accJournal: ["src/lib/erp/journal.ts", "src/lib/erp/ledger.ts"],
  accJournalLine: ["src/lib/erp/journal.ts", "src/lib/erp/ledger.ts"],
  // The Opening Balance snapshot. Written by a close and read by the register;
  // the figures it is written *from* come from `ledger.ts`, which is the
  // sanctioned reader of journal lines, so this module never names another
  // module's table either.
  accOpeningBalance: ["src/lib/erp/opening-balance.ts"],
  accOpeningBalanceLine: ["src/lib/erp/opening-balance.ts"],
  // A year's closing state. The calendar owns it, and the
  // closing process records itself through a function there rather than by
  // writing the row: closing.ts decides whether a year may be shut, and
  // fiscal.ts records that it has been. acc_fiscal_year itself is left
  // unconstrained because it is a registry entity, which the registry reaches
  // generically by design.
  accFiscalClosing: ["src/lib/erp/fiscal.ts"],
  salCustomerOrder: ["src/lib/erp/customer-order.ts"],
  salCustomerOrderLine: ["src/lib/erp/customer-order.ts"],
  salPermitRequest: ["src/lib/erp/permit-request.ts"],
  salPermitRequestLine: ["src/lib/erp/permit-request.ts"],
  salOrder: ["src/lib/erp/sales-order.ts"],
  salOrderLine: ["src/lib/erp/sales-order.ts"],
  salDeliveryOrder: ["src/lib/erp/delivery-order.ts"],
  salDeliveryOrderLine: ["src/lib/erp/delivery-order.ts"],
  // The standalone Delivery Note (P106): a logistics document, not a sales one.
  logDeliveryNote: ["src/lib/erp/delivery-note.ts"],
  logDeliveryNoteLine: ["src/lib/erp/delivery-note.ts"],
  logDeliveryNoteTracking: ["src/lib/erp/delivery-note.ts"],
  logReceiptNote: ["src/lib/erp/receipt-note.ts"],
  logReceiptNoteLine: ["src/lib/erp/receipt-note.ts"],
  logReceiptNoteTracking: ["src/lib/erp/receipt-note.ts"],
  // The stock books (P120): written only by the inventory book, read by its reports.
  // One lot register for stock and production (R3): the production ledger registers the lots executions make.
  logStockTracking: ["src/lib/erp/inventory.ts", "src/lib/erp/stock-report.ts", "src/lib/erp/production-ledger.ts", "src/lib/erp/production-report.ts"],
  logStockLedger: ["src/lib/erp/inventory.ts", "src/lib/erp/stock-report.ts"],
  logStockBalance: ["src/lib/erp/inventory.ts", "src/lib/erp/stock-report.ts"],
  logStockValuationLedger: ["src/lib/erp/inventory.ts", "src/lib/erp/stock-report.ts"],
  logStockValuationBalance: ["src/lib/erp/inventory.ts", "src/lib/erp/stock-report.ts"],
  // Purchasing documents (P123): each named only by its module.
  purRequest: ["src/lib/erp/purchase-request.ts"],
  purRequestLine: ["src/lib/erp/purchase-request.ts"],
  purOrder: ["src/lib/erp/purchase-order.ts"],
  purOrderLine: ["src/lib/erp/purchase-order.ts"],
  purOrderLineRequest: ["src/lib/erp/purchase-order.ts"],
  // Accounts per Kategori Item (P122): read and written only through its module.
  accItemCategoryAccount: ["src/lib/erp/item-account.ts"],
  // Production (P200): Jenis Biaya is a master the registry writes; the Tagihan
  // Biaya owns its own tables.
  accCostType: ["src/lib/erp/production-cost.ts", "src/lib/erp/records.ts"],
  prdCostBill: ["src/lib/erp/production-cost-bill.ts"],
  prdCostBillLine: ["src/lib/erp/production-cost-bill.ts"],
  // The Stock Issue (R4): standalone, by purpose.
  logStockIssue: ["src/lib/erp/stock-issue.ts"],
  logStockIssueLine: ["src/lib/erp/stock-issue.ts"],
  logStockIssueTracking: ["src/lib/erp/stock-issue.ts"],
  // The production documents (R5, R7, R8): each named only by its module.
  prdGrading: ["src/lib/erp/production-grading.ts"],
  prdGradingOutput: ["src/lib/erp/production-grading.ts"],
  prdWork: ["src/lib/erp/production-work.ts"],
  prdWorkLine: ["src/lib/erp/production-work.ts"],
  prdAuxUse: ["src/lib/erp/production-grading.ts", "src/lib/erp/production-work.ts"],
  prdQcCheck: ["src/lib/erp/production-qc.ts"],
  prdQcCheckLine: ["src/lib/erp/production-qc.ts"],
  // The production ledger (R3): a book, written only by its module and read by its reports (R18).
  prdBalance: ["src/lib/erp/production-ledger.ts", "src/lib/erp/production-report.ts"],
  prdLedger: ["src/lib/erp/production-ledger.ts", "src/lib/erp/production-report.ts"],
  prdTrackingLink: ["src/lib/erp/production-ledger.ts", "src/lib/erp/production-report.ts"],
  prdPartai: ["src/lib/erp/production-ledger.ts"],
  prdJob: ["src/lib/erp/production-ledger.ts"],
  prdTrackingInfo: ["src/lib/erp/production-ledger.ts"],
  prdCostEntry: ["src/lib/erp/production-ledger.ts"],
  // The month-end close (R10–R15, R25): its record, named only by its module; the lock only by the kernel.
  accFiscalPeriodLock: ["src/lib/erp/period-lock.ts"],
  // Billing documents: Finance owns them since P107; Sales holds only orders.
  finArAdvance: ["src/lib/erp/ar-advance.ts"],
  finArPermitAdvance: ["src/lib/erp/permit-advance.ts"],
  finArPermitInvoice: ["src/lib/erp/permit-invoice.ts"],
  finArPermitInvoiceAdvanceDeduction: ["src/lib/erp/permit-invoice.ts"],
  finApAdvance: ["src/lib/erp/ap-advance.ts"],
  finArInvoice: ["src/lib/erp/ar-invoice.ts"],
  finArInvoiceLine: ["src/lib/erp/ar-invoice.ts"],
  finArInvoiceAdvanceDeduction: ["src/lib/erp/ar-invoice.ts"],
  finApInvoice: ["src/lib/erp/ap-invoice.ts"],
  finApInvoiceLine: ["src/lib/erp/ap-invoice.ts"],
  finApInvoiceAdvanceDeduction: ["src/lib/erp/ap-invoice.ts"],
  finCashBankTx: ["src/lib/erp/cash-bank-tx.ts", "src/lib/erp/cash-payment.ts"],
  finCashBankTxLine: ["src/lib/erp/cash-bank-tx.ts", "src/lib/erp/cash-payment.ts"],
  finCashBankTxLineWht: ["src/lib/erp/cash-bank-tx.ts", "src/lib/erp/cash-payment.ts"],
  // AR items and Buku Piutang: written only by their book, which the posting
  // documents call (P71–P72).
  finArItem: ["src/lib/erp/ar-item.ts"],
  finArLedger: ["src/lib/erp/ar-item.ts"],
  finApItem: ["src/lib/erp/ap-item.ts"],
  finApLedger: ["src/lib/erp/ap-item.ts"],
  // Tax documents: made by the postings through hooks, recorded through the
  // tax module (P100).
  taxFaktur: ["src/lib/erp/tax-document.ts"],
  taxFakturLine: ["src/lib/erp/tax-document.ts"],
  taxFakturRef: ["src/lib/erp/tax-document.ts"],
  taxWithholdingSlip: ["src/lib/erp/tax-document.ts"],
};

/**
 * Boundaries still crossed today — baselined, not blessed.
 *
 * SIBA carried two, both into modules that were not brought over (Budget and
 * Cash Bank Transaction), so none remains. Nothing may be added to this list
 * without deliberation: a new crossing fails the suite, which is the point.
 */
const KNOWN_CROSSINGS: Record<string, string[]> = {};

describe("a module's tables are named only by the module that owns them", () => {
  for (const [delegate, owners] of Object.entries(TABLE_OWNERS)) {
    test(`${delegate} is reached only through ${owners.join(" / ")}`, () => {
      // String.raw, so the backslashes reach the RegExp rather than being read
      // as string escapes — `\b` in a plain template literal is a backspace.
      const pattern = new RegExp(
        String.raw`\b(?:prisma|tx|db)\.${delegate}\b`
      );
      const allowed = [...owners, ...(KNOWN_CROSSINGS[delegate] ?? [])];
      const trespassers = files
        .filter((f) => !allowed.includes(f.rel))
        .filter((f) => pattern.test(code(f.text)))
        .map((f) => f.rel);

      assert.deepEqual(
        trespassers,
        [],
        `${delegate} belongs to ${owners.join(", ")}. Add a function there and call it, ` +
          "rather than querying another module's table — a boundary crossed in one " +
          "direction becomes a boundary crossed in both."
      );
    });
  }
});

// -------------------------------------------------------- import direction

describe("the dependency graph points one way", () => {

  test("the books depend on no domain module", () => {
    // `cash_bank_ledger` and `acc_journal` are independent historical stores
    // (concept doc §2.5). A book that imported its writer could not be lifted
    // out, and would invite being derived from it.
    const KERNEL = [
      "document-number",
      "period",
      "account-code",
      "permissions",
      // The foreign-exchange kernel and the base currency. Pure functions over
      // numbers with no database and no dependency of their own, needed by
      // every book that carries a base measure. A book that had to import a *module* to round a base amount
      // would not be liftable; a book that imports arithmetic still is.
      "fx",
      "currency",
      // How a warehouse location reads and the key of a lot in one: pure string
      // functions, shared by the inventory book and the forms that pick from it.
      "warehouse-location",
      // The production close's period lock (R15): the books ask it at their one
      // write point; it reads only the fiscal period and its own lock rows.
      "period-lock",
      // How a book's entries are paged: a page size and a cursor, no database.
      "register-query",
      "partner-book",
    ];
    const BOOKS = ["cash-bank", "journal", "ar-item", "ap-item", "inventory"];

    for (const book of BOOKS) {
      const allowed = KERNEL;
      const leaked = sibaImports(sibaModule(book).text).filter(
        (d) => !allowed.includes(d)
      );
      assert.deepEqual(
        leaked,
        [],
        `${book}.ts may import only shared-kernel modules (${KERNEL.join(", ")}). ` +
          "A book is written by callers; it never reaches back to them."
      );
    }
  });

  test("PeriodRange is not taken from the Cash Bank Book", () => {
    const bad = files
      .filter((f) =>
        /PeriodRange[\s\S]{0,80}from\s+"[^"]*cash-bank"|from\s+"[^"]*cash-bank"[^;]*PeriodRange/.test(
          code(f.text)
        )
      )
      .map((f) => f.rel);
    assert.deepEqual(
      bad,
      [],
      "Import PeriodRange from `lib/erp/period` — the General Ledger and the " +
        "Accounting report route should not depend on the Cash Bank Book for a type."
    );
  });
});

// ------------------------------------------------------------- applications

/**
 * Which application owns each table (P254, `production_app_plan.md` §5): one
 * database holds all three today, so nothing else would notice a production
 * table landing in the ERP's part or a new table owned by nobody. Every table
 * not named here is the ERP's.
 */
const SHARED_TABLES = [
  "sys_user", "sys_role", "sys_permission", "sys_user_role", "sys_role_permission",
  "sys_session", "sys_setting", "sys_doc_type", "sys_number_counter", "audit_log",
];
const PRODUCTION_TABLES = [
  "m_employee", "prd_user_unit",
  "prd_partai", "prd_job", "prd_tracking_info",
  "prd_balance", "prd_ledger", "prd_tracking_link",
  "prd_grading", "prd_grading_input", "prd_grading_output", "prd_work", "prd_work_line", "prd_aux_use",
  "prd_qc_check", "prd_qc_check_line",
];

describe("every table belongs to one application", () => {
  const schemaTables = [
    ...readFileSync(join(process.cwd(), "prisma/schema.prisma"), "utf8").matchAll(/@@map\("([a-z_0-9]+)"\)/g),
  ].map((m) => m[1]);
  const ownerOf = (t: string) =>
    SHARED_TABLES.includes(t) ? "A" : PRODUCTION_TABLES.includes(t) ? "C" : "B";

  test("the ownership lists name only tables that exist", () => {
    const stale = [...SHARED_TABLES, ...PRODUCTION_TABLES].filter((t) => !schemaTables.includes(t));
    assert.deepEqual(stale, [], "Remove a dropped table from SHARED_TABLES / PRODUCTION_TABLES.");
  });

  test("the DBML holds each table once, in its owner's part", () => {
    const dbml = readFileSync(join(process.cwd(), "DBML/erp.dbml.md"), "utf8");
    const where = new Map<string, string[]>();
    let part = "";
    for (const line of dbml.split(/\r?\n/)) {
      const banner = line.match(/^\/\/ {2}BAGIAN ([ABC]) /);
      if (banner) part = banner[1];
      const table = line.match(/^table ([a-z_0-9]+) /);
      if (table) where.set(table[1], [...(where.get(table[1]) ?? []), part]);
    }
    const wrong = schemaTables
      .filter((t) => (where.get(t) ?? []).join() !== ownerOf(t))
      .map((t) => `${t}: in ${where.get(t)?.join() || "none"}, owner ${ownerOf(t)}`);
    assert.deepEqual(
      wrong,
      [],
      "Put each table once under its owner's banner in DBML/erp.dbml.md " +
        "(A Bersama, B ERP, C Produksi); a new production table goes in PRODUCTION_TABLES too."
    );
  });
});

// ------------------------------------------------------------- numbering

describe("document numbers come from one place", () => {
  test("nothing builds its own document number", () => {
    // Only the document form, `PREFIX/YYYY/MM/0001`. The `<prefix>.<4 digits>` system
    // code that `nextCode()` produces for master records is a separate
    // convention on purpose (CLAUDE.md §9) and is left alone here.
    const handRolled = /\/\$\{String\([^}]*\)\.padStart\(\s*4\s*,\s*"0"\s*\)\}/;
    const bad = files
      .filter((f) => f.rel !== "src/lib/erp/document-number.ts")
      .filter((f) => handRolled.test(code(f.text)))
      .map((f) => f.rel);
    assert.deepEqual(
      bad,
      [],
      "Use `nextDocumentNumber` from `lib/erp/document-number` — in SIBA four " +
        "modules once carried their own copy of this, two of which loaded every " +
        "row in the table to find a maximum."
    );
  });
});
