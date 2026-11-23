/**
 * Builds `src/lib/erp/db-map.json` for the Database application (P313): each
 * table's group and application, read from the DBML, and the tables each menu
 * writes and reads, traced function by function through the code with the
 * TypeScript compiler. Run `npm run db:map` after a migration or a new menu.
 *
 * shortcut: a table reached through a function two menus share shows under
 * both; NOT_OWN removes the known cases, add one when another is noticed.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { ENTITIES } from "../src/lib/erp/entities";
import { MODULES, appOfModule, modulePath } from "../src/lib/erp/nav";

const ROOT = process.cwd().replaceAll("\\", "/");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

// ------------------------------------------------------------ groups (DBML)

const GROUP_NAME: Record<string, string> = {
  System: "Sistem",
  Sales: "Penjualan",
  Logistik: "Penerimaan & Pengiriman",
  Persediaan: "Buku Persediaan",
  "BSTB ke Finish Goods": "BSTB dari Produksi",
};
const PART_APP = { A: "shared", B: "erp", C: "production" } as const;

type Group = { key: string; name: string; app: "erp" | "production" | "shared" };
const groups: Group[] = [];
const tables: Record<string, string> = {};
{
  const lines = read("DBML/erp.dbml.md").split(/\r?\n/);
  let app: Group["app"] = "erp";
  let title = "";
  lines.forEach((line, i) => {
    const part = line.match(/^\/\/\s+BAGIAN ([ABC])/);
    if (part) {
      app = PART_APP[part[1] as "A" | "B" | "C"];
      title = app === "shared" ? "Login & Akses" : "";
    }
    // A section opens with 34 slashes, then a blank comment, then its title.
    if (/^\/{34}$/.test(line)) title = (lines.slice(i + 1, i + 3).find((l) => /^\/\/\s+\S/.test(l)) ?? "").replace(/^\/\/\s+/, "").split(/ — | \(/)[0].trim() || title;
    const t = line.match(/^table (\w+)/);
    if (!t) return;
    const name = GROUP_NAME[title] ?? title;
    const key = `${app}-${name.toLowerCase().replace(/[^a-z]+/g, "-")}`;
    if (!groups.some((g) => g.key === key)) groups.push({ key, name, app });
    tables[t[1]] = key;
  });
}

// ------------------------------------------------------------ Prisma models

const bodies = new Map<string, string>();
const tableOf = new Map<string, string>();
for (const m of read("prisma/schema.prisma").matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)) {
  bodies.set(m[1], m[2]);
  tableOf.set(m[1], m[2].match(/@@map\("(\w+)"/)![1]);
}
const modelOf = new Map([...tableOf].map(([m, t]) => [t, m]));
const relations = new Map<string, Map<string, string>>();
const delegates = new Map<string, string>();
/** A relation name that means one table wherever it is written. */
const byRelation = new Map<string, Set<string>>();
for (const [m, body] of bodies) {
  const own = new Map<string, string>();
  for (const line of body.split("\n")) {
    const c = line.trim().match(/^(\w+)\s+(\w+)/);
    if (!c || !bodies.has(c[2])) continue;
    own.set(c[1], c[2]);
    byRelation.set(c[1], (byRelation.get(c[1]) ?? new Set()).add(tableOf.get(c[2])!));
  }
  relations.set(m, own);
  delegates.set(m[0].toLowerCase() + m.slice(1), m);
}

// ------------------------------------------------------------ the code graph

const config = ts.parseJsonConfigFileContent(ts.readConfigFile(`${ROOT}/tsconfig.json`, ts.sys.readFile).config, ts.sys, ROOT);
const program = ts.createProgram(config.fileNames.filter((f) => f.includes("/src/")), config.options);
const checker = program.getTypeChecker();
const files = program.getSourceFiles().filter((f) => f.fileName.includes(`${ROOT}/src/`) && !f.fileName.includes("/generated/"));
const inSrc = new Set(files.map((f) => f.fileName));

const topOf = (d: ts.Node): ts.Node | null => {
  let n: ts.Node | undefined = d;
  while (n && !(n.parent && ts.isSourceFile(n.parent))) n = n.parent;
  return n ?? null;
};
const WRITES = new Set(["create", "createMany", "deleteMany", "update", "updateMany", "upsert", "connectOrCreate", "delete"]);
type Reach = { r: Set<string>; w: Set<string>; next: Set<ts.Node> };
const cache = new Map<ts.Node, Reach>();

/** The relations a query's argument names, and those it writes through a nested create. */
function nested(node: ts.Node, model: string, out: Reach) {
  const own = relations.get(model)!;
  if ((ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node)) && own.has(node.name.getText())) {
    const target = own.get(node.name.getText())!;
    out.r.add(tableOf.get(target)!);
    if (!ts.isPropertyAssignment(node)) return;
    const v = node.initializer;
    if (ts.isObjectLiteralExpression(v) && v.properties.some((p) => p.name && WRITES.has(p.name.getText()))) out.w.add(tableOf.get(target)!);
    nested(v, target, out);
    return;
  }
  ts.forEachChild(node, (c) => nested(c, model, out));
}

function scan(top: ts.Node): Reach {
  const hit = cache.get(top);
  if (hit) return hit;
  const out: Reach = { r: new Set(), w: new Set(), next: new Set() };
  cache.set(top, out);
  const visit = (n: ts.Node) => {
    if (ts.isTypeNode(n)) return;
    // A nested create built outside the query that uses it.
    if (ts.isPropertyAssignment(n) && ts.isObjectLiteralExpression(n.initializer) && n.initializer.properties.some((p) => p.name && ["create", "createMany"].includes(p.name.getText()))) {
      const one = byRelation.get(n.name.getText());
      if (one?.size === 1) out.w.add([...one][0]);
    }
    if (ts.isPropertyAccessExpression(n) && ts.isPropertyAccessExpression(n.parent)) {
      const model = delegates.get(n.name.text);
      if (model) {
        const op = n.parent.name.text;
        if (/^(create|update|upsert|delete)/.test(op)) out.w.add(tableOf.get(model)!);
        else if (/^(find|count|aggregate|groupBy)/.test(op)) out.r.add(tableOf.get(model)!);
        const call = n.parent.parent;
        if (ts.isCallExpression(call) && call.arguments[0]) nested(call.arguments[0], model, out);
      }
    }
    if (ts.isStringLiteralLike(n) || ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n)) {
      for (const m of n.text.matchAll(/\b(FROM|JOIN|UPDATE|INTO)\s+"?(\w+)"?/g)) if (modelOf.has(m[2])) (/UPDATE|INTO/.test(m[1]) ? out.w : out.r).add(m[2]);
    }
    if (ts.isIdentifier(n)) {
      let sym = checker.getSymbolAtLocation(n);
      if (sym && sym.flags & ts.SymbolFlags.Alias) sym = checker.getAliasedSymbol(sym);
      for (const d of sym?.declarations ?? []) {
        if (!inSrc.has(d.getSourceFile().fileName)) continue;
        const t = topOf(d);
        if (t && t !== top && !ts.isInterfaceDeclaration(t) && !ts.isTypeAliasDeclaration(t)) out.next.add(t);
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(top);
  return out;
}

/** Shared by every page: following them would give every menu the same tables. */
const SHARED = /lib\/erp\/(auth|session|access|audit|nav|entities|permissions|records|reports|entity-access)\.ts$|components\/(shell|master)\//;
function reach(roots: ts.Node[]) {
  const seen = new Set(roots), queue = [...roots], r = new Set<string>(), w = new Set<string>();
  for (let t = queue.pop(); t; t = queue.pop()) {
    const s = scan(t);
    s.r.forEach((x) => r.add(x));
    s.w.forEach((x) => w.add(x));
    for (const d of s.next) if (!seen.has(d) && !SHARED.test(d.getSourceFile().fileName)) { seen.add(d); queue.push(d); }
  }
  return { r, w };
}
const body = (f: ts.SourceFile) => f.statements.filter((s) => !ts.isImportDeclaration(s));
const functions = (names: string[]) =>
  files.filter((f) => f.fileName.includes("/src/lib/erp/")).flatMap((f) => f.statements.filter((s) => ts.isFunctionDeclaration(s) && s.name && names.includes(s.name.text)));

// ------------------------------------------------------------ menus

/** Every report of a module shares one page, so a report names its reader here. */
const REPORTS: Record<string, string[]> = {
  cash_bank_ledger: ["cashBankLedgerReport"],
  cash_bank_balance: ["cashBankBalanceReport"],
  ar_ledger: ["arBook"],
  ar_balance: ["arBook"],
  ar_aging: ["openArItemsAsOf"],
  customer_advance: ["openArItemsAsOf", "arItemsReconcile", "closingBalances"],
  ap_ledger: ["apBook"],
  ap_balance: ["apBook"],
  ap_aging: ["openApItemsAsOf"],
  supplier_advance: ["openApItemsAsOf", "apItemsReconcile", "closingBalances"],
  general_ledger: ["generalLedgerReport"],
  trial_balance: ["trialBalanceReport"],
  profit_loss: ["profitLossReport"],
  balance_sheet: ["balanceSheetReport"],
  stock_ledger: ["stockLedgerReport", "stockBooksReconcile"],
  stock_balance: ["stockBalanceReport", "stockBooksReconcile"],
  stock_valuation_ledger: ["valuationLedgerReport"],
  stock_valuation: ["valuationReport", "closingBalances"],
  wip_balance: ["wipBalanceReport", "productionBooksReconcile"],
  lot_card: ["lotCardReport"],
  trace: ["traceReport"],
};
/** What a registry save writes beyond its own rows: a Cash & Bank's Saldo Awal (P31). */
const REGISTRY_EXTRA: Record<string, string[]> = { m_cash_bank: ["cash_bank_ledger", "cash_bank_balance", "cash_bank_period"] };
/** A menu whose key is not its main table. */
const MAIN: Record<string, string> = {
  pur_request_goods: "pur_request",
  pur_request_service: "pur_request",
  pur_order_goods: "pur_order",
  pur_order_service: "pur_order",
  log_production_receipt_return: "log_production_receipt",
  fin_cash_receipt: "fin_cash_bank_tx",
  fin_cash_payment: "fin_cash_bank_tx",
  account_mapping: "sys_setting",
  item_category_account: "acc_item_category_account",
  profile: "sys_user",
  prd_unit: "prd_balance",
};
/** Screens shared by variant: the other variant's own tables are not this menu's. */
const NOT_OWN: Record<string, RegExp> = {
  fin_ar_invoice: /^(fin_ar_permit_invoice|sal_permit_request)/,
  fin_ar_permit_invoice: /^(fin_ar_invoice|fin_ar_credit_note|log_delivery_note|sal_customer_order|sal_order)/,
  fin_ar_advance: /^(fin_ar_permit_advance|sal_permit_request)/,
  fin_ar_permit_advance: /^(fin_ar_advance|sal_customer_order)/,
};

const registry = new Set(ENTITIES.map((e) => e.key));
const menus: Record<string, { main: string | null; w: string[]; r: string[] }> = {};
for (const mod of MODULES) {
  for (const leaf of (mod.groups ?? []).flatMap((g) => g.entities)) {
    const main = modelOf.has(leaf.key) ? leaf.key : (MAIN[leaf.key] ?? null);
    let r = new Set<string>();
    const w = new Set<string>();
    if (leaf.key.startsWith("report_")) {
      const x = reach(functions(REPORTS[leaf.key.slice(7)] ?? []));
      r = new Set([...x.r, ...x.w]);
    } else {
      if (registry.has(leaf.key)) {
        const model = modelOf.get(leaf.key)!;
        w.add(leaf.key).add("audit_log");
        // Its own rows: a list relation named after it that is not a menu of its own.
        for (const child of bodies.get(model)!.matchAll(/^\s+\w+\s+(\w+)\[\]/gm)) {
          const t = tableOf.get(child[1]) ?? "";
          if (t.startsWith(`${leaf.key}_`) && !registry.has(t)) w.add(t);
        }
        for (const t of REGISTRY_EXTRA[leaf.key] ?? []) w.add(t);
        for (const line of bodies.get(model)!.split("\n")) {
          const ref = line.trim().match(/^\w+\s+(\w+)\??\s+@relation\(.*fields/);
          if (ref) r.add(tableOf.get(ref[1])!);
        }
      }
      // Barang and Jasa share one [kind] route.
      const slug = /^pur_/.test(leaf.key) ? leaf.slug.split("/")[0] : leaf.slug;
      const dir = `/src/app/(${appOfModule(mod.key)})/${modulePath(mod)}/${slug}/`;
      const x = reach(files.filter((f) => f.fileName.includes(dir) && f.fileName.endsWith("page.tsx")).flatMap(body));
      x.r.forEach((t) => r.add(t));
      x.w.forEach((t) => w.add(t));
    }
    const own = (t: string) => !NOT_OWN[leaf.key]?.test(t);
    menus[leaf.key] = { main, w: [...w].filter(own).sort(), r: [...r].filter((t) => !w.has(t) && own(t)).sort() };
  }
}

writeFileSync(join(ROOT, "src/lib/erp/db-map.json"), JSON.stringify({ groups, tables, menus }, null, 1) + "\n");
console.log(`${Object.keys(tables).length} tabel, ${groups.length} kelompok, ${Object.keys(menus).length} menu`);
