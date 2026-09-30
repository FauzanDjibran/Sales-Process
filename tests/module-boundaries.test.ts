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
  cashBankLedger: ["src/lib/erp/cash-bank.ts"],
  cashBankBalance: ["src/lib/erp/cash-bank.ts"],
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
  salOrder: ["src/lib/erp/sales-order.ts"],
  salOrderLine: ["src/lib/erp/sales-order.ts"],
  salAdvance: ["src/lib/erp/sales-advance.ts"],
  finCashBankTx: ["src/lib/erp/cash-bank-tx.ts"],
  finCashBankTxLine: ["src/lib/erp/cash-bank-tx.ts"],
  finCashBankTxLineWht: ["src/lib/erp/cash-bank-tx.ts"],
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
    ];
    const BOOKS = ["cash-bank", "journal"];

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
