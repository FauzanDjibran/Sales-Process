import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildGraph, buildModel, levelsOf, type DbSchema, type Target } from "../src/lib/erp/db-diagram";
import { databaseMap } from "../src/lib/erp/db-map";
import { MODULES, appsOf, landingHref } from "../src/lib/erp/nav";

/**
 * The Database application (P313): the traced map covers the schema and the
 * menu, and no two boxes of any diagram overlap. Read from the Prisma schema,
 * so it needs no database.
 */
const map = databaseMap();
const text = readFileSync(join(process.cwd(), "prisma/schema.prisma"), "utf8");
const bodies = new Map([...text.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)].map((m) => [m[1], m[2]]));
const tableOf = new Map([...bodies].map(([m, b]) => [m, b.match(/@@map\("(\w+)"/)![1]]));

const schema: DbSchema = { tables: [], fks: [] };
for (const [model, body] of bodies) {
  const name = tableOf.get(model)!;
  const cols = [];
  for (const line of body.split("\n")) {
    const c = line.trim().match(/^(\w+)\s+(\w+)(\?|\[\])?/);
    if (!c || line.trim().startsWith("@@")) continue;
    if (!bodies.has(c[2])) cols.push({ name: c[1], type: c[2], required: c[3] !== "?" });
    const fk = line.match(/@relation\(.*fields: \[(\w+)\]/);
    if (fk) schema.fks.push({ table: name, col: fk[1], ref: tableOf.get(c[2])! });
  }
  schema.tables.push({ name, cols, pk: ["id"], rules: [] });
}
const model = buildModel(schema, map);
const options = { depth: 1, read: false, hub: false, hidden: new Set<number>() };

describe("the traced map is current (npm run db:map)", () => {
  test("every table has a group", () => {
    assert.deepEqual(schema.tables.map((t) => t.name).filter((t) => !map.tables[t]), []);
  });

  test("every menu is mapped and uses at least one table", () => {
    const leaves = MODULES.flatMap((m) => (m.groups ?? []).flatMap((g) => g.entities.map((e) => e.key)));
    assert.deepEqual(leaves.filter((k) => !map.menus.some((m) => m.key === k)), []);
    assert.deepEqual(map.menus.filter((m) => !m.w.length && !m.r.length).map((m) => m.key), []);
  });

  test("a table's application is the one the ownership test names (P255)", () => {
    const of = (t: string) => model.tables[model.index.get(t)!].app;
    assert.equal(of("prd_grading"), "production");
    assert.equal(of("prd_cost_bill"), "erp");
    assert.equal(of("sys_user"), "shared");
  });

  test("a posting menu names the books it writes", () => {
    const writes = (k: string) => map.menus.find((m) => m.key === k)!.w;
    for (const t of ["log_delivery_note", "log_stock_ledger", "acc_journal", "sal_delivery_order_line"]) assert.ok(writes("log_delivery_note").includes(t), t);
    assert.ok(writes("fin_cash_receipt").includes("fin_cash_bank_tx_line_wht"), "a nested create counts");
    assert.ok(!writes("sal_customer_order").includes("acc_journal"));
  });
});

describe("a diagram", () => {
  test("never overlaps two boxes", () => {
    const targets: Target[] = [{ v: "all" }, ...model.tables.map((_, i) => ({ v: "table" as const, i })), ...model.groups.map((_, i) => ({ v: "group" as const, i })), ...model.menus.map((_, i) => ({ v: "menu" as const, i }))];
    for (const t of targets) {
      const g = buildGraph(model, t, "key", { ...options, depth: 2 }, () => true, new Set());
      const boxes = [...g.boxes.values()];
      boxes.forEach((a, i) => {
        assert.ok(Number.isFinite(a.x + a.y));
        for (const b of boxes.slice(i + 1)) assert.ok(a.x >= b.x + b.w || b.x >= a.x + a.w || a.y >= b.y + b.h || b.y >= a.y + a.h, `${model.tables[a.id].name} × ${model.tables[b.id].name}`);
      });
    }
  });

  test("a table's hierarchy has its parents above and its children below", () => {
    const level = levelsOf(model, model.index.get("sal_order")!, 1);
    const at = (d: number) => [...level].flatMap(([i, v]) => (v === d ? [model.tables[i].name] : []));
    assert.ok(at(-1).includes("sal_customer_order"));
    assert.ok(at(1).includes("sal_order_line"));
  });

  test("a hidden table and the application filter leave tables out", () => {
    const i = model.index.get("sal_order")!;
    const all = buildGraph(model, { v: "table", i }, "key", options, () => true, new Set());
    const less = buildGraph(model, { v: "table", i }, "key", { ...options, hidden: new Set([i, model.index.get("sal_order_line")!]) }, () => true, new Set());
    assert.equal(less.boxes.size, all.boxes.size - 1, "only the child hidden goes; the focus stays");
    assert.ok(!less.links.some((l) => l.from === model.index.get("sal_order_line")));
    const production = buildGraph(model, { v: "all" }, "name", options, (a) => a === "production", new Set());
    assert.ok([...production.boxes.keys()].every((k) => model.tables[k].app === "production"));
  });
});

test("the application is its own door, by its one permission", () => {
  assert.deepEqual(appsOf(["MENU_DATABASE_ACCESS"]), ["database"]);
  assert.equal(landingHref(["MENU_DATABASE_ACCESS"]), "/database");
  assert.equal(landingHref(["MENU_DATABASE_ACCESS", "MENU_DASHBOARD_ACCESS"], "database"), "/database");
});
