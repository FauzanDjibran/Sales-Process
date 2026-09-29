import test, { before, describe, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { prisma, disconnect, systemUserId } from "./helpers";
import {
  knownAuditSubjects,
  recentActivity,
  recordHistory,
} from "../src/lib/erp/audit";
import { FISCAL_YEAR_TRANSITIONS } from "../src/lib/erp/fiscal-workflow";
import { JOURNAL_TRANSITIONS } from "../src/lib/erp/journal-workflow";
import { auditEventLabel, knownAuditEvents } from "../src/lib/erp/audit-events";

/**
 * The audit log says what changed, in words.
 *
 * `audit_log` stores `(entity_key, row_id)`, so the panel used to render
 * `m_partner` — which names neither the kind of record nor the record. The
 * catalogue in `audit.ts` resolves both, and its one real failure mode is
 * going stale: a module that starts writing a new `entity_key` without adding
 * a subject would silently print the raw table name again. The first test is a
 * source scan that catches exactly that, and needs no database.
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


// ------------------------------------- fixtures for the per-record history

const ENTITY = "zztest_audit";

let actor = 0;
const rows: number[] = [];

before(async () => {
  actor = await systemUserId();
});

/**
 * One teardown for the whole file.
 *
 * `disconnect()` is deliberately here and nowhere else: a suite that closed the
 * client inside its own `after` would take the client away from every case
 * declared below it in the file.
 */
after(async () => {
  if (rows.length) {
    await prisma.auditLog.deleteMany({ where: { id: { in: rows } } });
  }
  await disconnect();
});

describe("every audited subject can be named", () => {
  test("no entity_key is written that the catalogue cannot describe", () => {
    const written = new Set<string>();
    for (const path of sourceFiles(SRC)) {
      const text = readFileSync(path, "utf8");
      for (const m of text.matchAll(/entity_key:\s*"([a-z_]+)"/g)) {
        written.add(m[1]);
      }
    }

    assert.ok(written.size > 0, "found no entity_key literals — the scan is broken");

    const known = new Set(knownAuditSubjects());
    const undescribed = [...written].filter((k) => !known.has(k)).sort();

    assert.deepEqual(
      undescribed,
      [],
      "Add a subject to EXTRA_SUBJECTS in lib/erp/audit.ts, or register the entity. " +
        "An unknown key falls back to the raw table name, which is the state this " +
        "catalogue exists to fix."
    );
  });

  test("a registry entity is described by its own singular name", () => {
    const known = knownAuditSubjects();
    assert.ok(known.includes("m_partner"), "the registry should supply m_partner");
    assert.ok(known.includes("sys_user"), "User is outside the registry and needs a line");
    assert.ok(known.includes("acc_journal"), "Journal is outside the registry and needs a line");
  });
});

describe("an entry reads as a record, not a table", () => {
  let auditId: number | null = null;

  after(async () => {
    if (auditId !== null) {
      await prisma.auditLog.delete({ where: { id: auditId } }).catch(() => {});
    }
    await disconnect();
  });

  test("a Partner Category change names the Partner Category", async () => {
    // Partner Categories are seeded system data and always present, so this
    // needs no business fixture of its own.
    const category = await prisma.sysPartnerCategory.findFirstOrThrow();
    const row = await prisma.auditLog.create({
      data: {
        entity_key: "sys_partner_category",
        row_id: category.id,
        action: "UPDATE",
        by: 0,
      },
    });
    auditId = row.id;

    const entries = await recentActivity(1);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].id, row.id);
    assert.notEqual(
      entries[0].subject,
      "sys_partner_category",
      "the subject should be the entity's name, not its table"
    );
    assert.ok(
      entries[0].title?.includes(category.category_name),
      `expected the Partner Category's name in the title, got ${entries[0].title}`
    );
  });

  test("an unknown key still reports, rather than throwing", async () => {
    const row = await prisma.auditLog.create({
      data: { entity_key: "nope_not_a_table", row_id: 1, action: "UPDATE", by: 0 },
    });
    try {
      const entries = await recentActivity(1);
      assert.equal(entries[0].subject, "nope_not_a_table");
      assert.equal(entries[0].title, null);
    } finally {
      await prisma.auditLog.delete({ where: { id: row.id } }).catch(() => {});
    }
  });
});

/** One audit row, remembered so teardown can remove it. */
async function writeEntry(
  rowId: number,
  event: string | null,
  at: Date,
  action: "TAMBAH" | "UPDATE" = "UPDATE"
): Promise<number> {
  const created = await prisma.auditLog.create({
    data: { entity_key: ENTITY, row_id: rowId, action, event, at, by: actor },
    select: { id: true },
  });
  rows.push(created.id);
  return created.id;
}

// ----------------------------------------------------- the catalogue is whole

describe("every lifecycle transition can be named in a history", () => {
  const TABLES: [string, string, Record<string, unknown>][] = [
    ["acc_journal", "Journal", JOURNAL_TRANSITIONS],
    ["acc_fiscal_year", "Fiscal Year", FISCAL_YEAR_TRANSITIONS],
  ];

  for (const [entityKey, name, table] of TABLES) {
    test(`${name} labels every transition it declares`, () => {
      const known = knownAuditEvents()[entityKey] ?? [];
      const missing = Object.keys(table).filter((a) => !known.includes(a));

      assert.deepEqual(
        missing,
        [],
        `Every transition must be nameable in a record's history, or the panel ` +
          `reports it as a bare "Diubah". Add ${missing.join(", ")} to ` +
          `lib/erp/audit-events.ts beside the other ${name} events.`
      );
    });
  }

  test("a labelled event reads as something that already happened", () => {
    // The transition table's own label is an imperative, because it is written
    // on a button. A history entry reports the past, so the two must differ.
    assert.equal(auditEventLabel("acc_journal", "UPDATE", "post").label, "Diposting");
    assert.equal(auditEventLabel("acc_journal", "UPDATE", "cancel").label, "Dibatalkan");
    assert.equal(auditEventLabel("acc_fiscal_year", "UPDATE", "open").label, "Diaktifkan");
  });

  test("a transition's tone carries into its history entry", () => {
    // One table decides both the button and the trace.
    assert.equal(
      auditEventLabel("acc_journal", "UPDATE", "cancel").tone,
      JOURNAL_TRANSITIONS.cancel.tone
    );
    assert.equal(
      auditEventLabel("acc_journal", "UPDATE", "post").tone,
      JOURNAL_TRANSITIONS.post.tone
    );
  });

  test("a consequence is marked as one, not attributed to a decision", () => {
    // A Fiscal Year reads Closed because its closing ran; the decision is the
    // closing row's own entry.
    assert.equal(auditEventLabel("acc_fiscal_year", "UPDATE", "close").systemDriven, true);
    assert.notEqual(
      auditEventLabel("acc_fiscal_closing", "UPDATE", "close").systemDriven,
      true
    );
  });
});

describe("an unnameable row still says something true", () => {
  test("a row written before `event` existed reports the coarse verb", () => {
    assert.equal(auditEventLabel("acc_journal", "UPDATE", null).label, "Diubah");
    assert.equal(auditEventLabel("acc_journal", "TAMBAH", null).label, "Dibuat");
  });

  test("an event this build does not know falls back rather than inventing", () => {
    // A row written by a newer build, read by an older one. It must not claim
    // to know which transition it was.
    assert.equal(
      auditEventLabel("acc_journal", "UPDATE", "teleport").label,
      "Diubah"
    );
  });

  test("a table with no lifecycle still names create, edit and the toggle", () => {
    // Every master record: created, edited, deactivated. `m_partner` has no
    // entry of its own and falls through to the shared vocabulary.
    assert.equal(auditEventLabel("m_partner", "TAMBAH", "create").label, "Dibuat");
    assert.equal(
      auditEventLabel("m_partner", "UPDATE", "deactivate").label,
      "Dinonaktifkan"
    );
    assert.equal(auditEventLabel("m_partner", "UPDATE", "activate").label, "Diaktifkan");
  });
});

// -------------------------------------------------------- reading one history

describe("a record's history", () => {
  test("reads newest first", async () => {
    const rowId = 900_001;
    await writeEntry(rowId, "create", new Date("2026-01-01T08:00:00Z"), "TAMBAH");
    await writeEntry(rowId, "submit", new Date("2026-01-02T08:00:00Z"));
    await writeEntry(rowId, "approve", new Date("2026-01-03T08:00:00Z"));

    const history = await recordHistory(ENTITY, rowId);

    assert.deepEqual(
      history.entries.map((e) => e.event),
      ["approve", "submit", "create"],
      "The entry a reader opened the panel for is the most recent one; oldest " +
        "first would push it below the fold on a long-lived record."
    );
  });

  test("breaks a tie by id, so one transaction's writes keep their order", async () => {
    // A confirmation writes several rows inside one transaction, and they can
    // share a timestamp to the millisecond. Without the id tiebreak the order
    // they render in is whatever the database happens to return.
    const rowId = 900_002;
    const at = new Date("2026-02-01T08:00:00Z");
    await writeEntry(rowId, "create", at, "TAMBAH");
    await writeEntry(rowId, "submit", at);
    await writeEntry(rowId, "confirm", at);

    const history = await recordHistory(ENTITY, rowId);

    assert.deepEqual(
      history.entries.map((e) => e.event),
      ["confirm", "submit", "create"]
    );
  });

  test("caps what it returns and still counts what it did not", async () => {
    const rowId = 900_003;
    for (let i = 0; i < 14; i += 1) {
      await writeEntry(rowId, "update", new Date(Date.UTC(2026, 2, i + 1)));
    }

    const history = await recordHistory(ENTITY, rowId, 10);

    assert.equal(history.entries.length, 10);
    assert.equal(
      history.total,
      14,
      "The cap has to be visible, or a slice is presented as the whole story."
    );
  });

  test("names the actor", async () => {
    const rowId = 900_004;
    await writeEntry(rowId, "create", new Date("2026-04-01T08:00:00Z"), "TAMBAH");

    const history = await recordHistory(ENTITY, rowId);

    assert.ok(
      history.entries[0].by,
      "An entry without a name answers 'when' but not 'who', which is half the question."
    );
  });

  test("a record nothing has happened to reports no entries and no total", async () => {
    const history = await recordHistory(ENTITY, 900_999);
    assert.deepEqual(history.entries, []);
    assert.equal(history.total, 0);
  });

  test("one record's history is not another's", async () => {
    const mine = 900_005;
    const theirs = 900_006;
    await writeEntry(mine, "create", new Date("2026-05-01T08:00:00Z"), "TAMBAH");
    await writeEntry(theirs, "create", new Date("2026-05-01T08:00:00Z"), "TAMBAH");
    await writeEntry(theirs, "cancel", new Date("2026-05-02T08:00:00Z"));

    assert.equal((await recordHistory(ENTITY, mine)).total, 1);
    assert.equal((await recordHistory(ENTITY, theirs)).total, 2);
  });
});
