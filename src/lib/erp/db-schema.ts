import "server-only";
import { prisma } from "@/lib/prisma";
import type { DbSchema } from "./db-diagram";

/**
 * The database's own structure, for the Database application (P313): read live
 * from PostgreSQL's catalogue, so it is always the database in use. Metadata
 * only: no row of any table is ever read here.
 */
export async function databaseSchema(): Promise<DbSchema> {
  const [cols, keys, fks, uniques] = await Promise.all([
    prisma.$queryRaw<{ t: string; c: string; ty: string; req: boolean; vals: string[] | null }[]>`
      SELECT c.relname::text AS t, a.attname::text AS c, format_type(a.atttypid, a.atttypmod) AS ty, a.attnotnull AS req,
             (SELECT array_agg(e.enumlabel::text ORDER BY e.enumsortorder) FROM pg_enum e WHERE e.enumtypid = a.atttypid) AS vals
      FROM pg_class c
      JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
      WHERE c.relkind = 'r' AND c.relnamespace = 'public'::regnamespace AND c.relname <> '_prisma_migrations'
      ORDER BY c.relname, a.attnum`,
    prisma.$queryRaw<{ t: string; kind: string; def: string; cols: string[] | null }[]>`
      SELECT r.relname::text AS t, c.contype::text AS kind, pg_get_constraintdef(c.oid) AS def,
             (SELECT array_agg(a.attname::text) FROM pg_attribute a WHERE a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)) AS cols
      FROM pg_constraint c JOIN pg_class r ON r.oid = c.conrelid
      WHERE c.connamespace = 'public'::regnamespace AND c.contype IN ('p', 'c')
      ORDER BY c.conname`,
    prisma.$queryRaw<{ t: string; c: string; ref: string }[]>`
      SELECT r.relname::text AS t, a.attname::text AS c, f.relname::text AS ref
      FROM pg_constraint c
      JOIN pg_class r ON r.oid = c.conrelid
      JOIN pg_class f ON f.oid = c.confrelid
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
      WHERE c.connamespace = 'public'::regnamespace AND c.contype = 'f'
      ORDER BY r.relname, a.attnum`,
    prisma.$queryRaw<{ t: string; def: string }[]>`
      SELECT r.relname::text AS t, pg_get_indexdef(i.indexrelid) AS def
      FROM pg_index i JOIN pg_class r ON r.oid = i.indrelid
      WHERE i.indisunique AND NOT i.indisprimary AND r.relnamespace = 'public'::regnamespace
      ORDER BY i.indexrelid`,
  ]);

  const tables = new Map<string, DbSchema["tables"][number]>();
  for (const { t, c, ty, req, vals } of cols) {
    if (!tables.has(t)) tables.set(t, { name: t, cols: [], pk: [], rules: [] });
    tables.get(t)!.cols.push({ name: c, type: shortType(ty), required: req, ...(vals ? { values: vals } : {}) });
  }
  for (const { t, def } of uniques) tables.get(t)?.rules.push({ kind: "Unik", text: def.replace(/^.* USING btree /, "") });
  for (const { t, kind, def, cols: on } of keys) {
    const table = tables.get(t);
    if (!table) continue;
    if (kind === "p") table.pk = on ?? [];
    else table.rules.push({ kind: "Cek", text: def.replace(/^CHECK \(\((.*)\)\)$/, "$1").replace(/::[a-z ]+(\(\d+\))?/g, "") });
  }
  return { tables: [...tables.values()], fks: fks.map(({ t, c, ref }) => ({ table: t, col: c, ref })) };
}

const shortType = (t: string) =>
  t
    .replace(/^timestamp\(\d\) with time zone$/, "timestamptz")
    .replace(/^character varying/, "varchar")
    .replace(/^numeric/, "decimal")
    .replace(/^integer$/, "int")
    .replace(/"/g, "");
