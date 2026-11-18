import test, { after, before, describe } from "node:test";
import assert from "node:assert/strict";

import { availableBuckets, enterProduction, issueJob } from "../src/lib/erp/production-ledger";
import { closeKerja, getKerja, startKerja, type KerjaInput } from "../src/lib/erp/production-kerja";
import { cleanupFiscalYear, cleanupFixtures, disconnect, makeAccount, openFiscalYear, prisma } from "./helpers";
import { cleanupProduction, makeProductionFixture, sourceOf, type ProductionFixture } from "./production-helpers";

/**
 * Kerja (P282, T13). Unit K does Kerja only, with QC: Selesai is its last step, so it
 * charges the Unit rate and goes to QC Check. Unit KA does Kerja › Assign: Selesai is
 * not the last step, so it charges nothing and goes to Persiapan Assign (P281).
 */

const today = new Date().toISOString().slice(0, 10);
const date = new Date(`${today}T00:00:00Z`);
const ABSORBED = "production_absorbed_account";
let f: ProductionFixture;
let s: Awaited<ReturnType<typeof sourceOf>>;
const ids = {} as Record<string, number>;
const kerjas: number[] = [];
let activeBefore: number[] = [];
let savedAbsorbed: string | undefined;

const at = (unit: number, stage: "Preparation" | "Working" | "QcCheck" | "StandBy") => availableBuckets({ unitIds: [unit], stage });

/** A Job of `qty` grams at the unit's first step, worth Rp 10 a gram. */
async function job(unit: number, qty: number) {
  const lot = await prisma.logStockTracking.create({
    data: { tracking_no: f.key(`K${Math.random().toString(36).slice(2, 6)}`), tracking_date: date, item_id: f.material, source_doc_type_id: s.docTypeId, source_doc_id: s.docId, source_no: s.no, created_by: f.actor },
  });
  await prisma.$transaction(async (t) => {
    const j = await issueJob(t, { unitId: unit, lotId: lot.id, date, source: s, actorId: f.actor });
    await enterProduction(t, { lotId: lot.id, itemId: f.material, unitId: unit, baseQty: qty, value: qty * 10, jobId: j.id, date, source: s, actorId: f.actor });
  });
  return (await at(unit, "Preparation")).find((b) => b.lotId === lot.id)!;
}

async function start(over: Partial<KerjaInput>) {
  const r = await startKerja({ unit_id: ids.k, kerja_date: today, note: "", lines: [], ...over }, f.actor);
  if (r.ok) kerjas.push(r.id);
  return r;
}

before(async () => {
  await openFiscalYear();
  f = await makeProductionFixture("KJ");
  s = await sourceOf("log_stock_issue", "SI/TEST/KJ");
  const a = f.actor;
  ids.k = (await prisma.refUnit.create({ data: { unit_code: `test.${f.key("K")}`, unit_label: f.key("K"), unit_name: "Kerja", has_qc: true, created_by: a, steps: { create: [{ seq: 1, process: "Kerja" }] } } })).id;
  ids.ka = (await prisma.refUnit.create({ data: { unit_code: `test.${f.key("KA")}`, unit_label: f.key("KA"), unit_name: "Kerja Assign", created_by: a, steps: { create: [{ seq: 1, process: "Kerja" }, { seq: 2, process: "Assign" }] } } })).id;
  ids.emp = (await prisma.mEmployee.create({ data: { employee_code: `test.${f.key("E")}`, employee_label: f.key("E"), employee_name: "Uji", created_by: a } })).id;
  ids.absorbed = await makeAccount({ subcategoryLabel: "5.1.1" });
  savedAbsorbed = (await prisma.sysSetting.findUnique({ where: { setting_key: ABSORBED } }))?.setting_value ?? undefined;
  await prisma.sysSetting.upsert({ where: { setting_key: ABSORBED }, update: { setting_value: String(ids.absorbed) }, create: { setting_key: ABSORBED, setting_value: String(ids.absorbed), updated_by: a } });
  activeBefore = (await prisma.prdRateVersion.findMany({ where: { status: "Active" }, select: { id: true } })).map((v) => v.id);
  await prisma.prdRateVersion.updateMany({ where: { status: "Active" }, data: { status: "Inactive" } });
  ids.version = (
    await prisma.prdRateVersion.create({
      data: { rate_code: `test.${f.key("V")}`, rate_label: f.key("V"), rate_name: "Uji", status: "Active", created_by: a, lines: { create: [{ unit_id: ids.k, rate: 20 }, { unit_id: ids.ka, rate: 7 }] } },
    })
  ).id;
});

after(async () => {
  const journals = (await prisma.prdKerjaLine.findMany({ where: { kerja_id: { in: kerjas } }, select: { journal_id: true } })).flatMap((l) => (l.journal_id ? [l.journal_id] : []));
  await prisma.auditLog.deleteMany({ where: { entity_key: "prd_kerja", row_id: { in: kerjas } } });
  await prisma.prdKerja.deleteMany({ where: { id: { in: kerjas } } });
  await prisma.accJournalLine.deleteMany({ where: { journal_id: { in: journals } } });
  await prisma.accJournal.deleteMany({ where: { id: { in: journals } } });
  await cleanupProduction([f.material, f.product, f.byproduct]);
  await prisma.prdRateVersion.deleteMany({ where: { id: ids.version } });
  await prisma.prdRateVersion.updateMany({ where: { id: { in: activeBefore } }, data: { status: "Active" } });
  if (savedAbsorbed === undefined) await prisma.sysSetting.deleteMany({ where: { setting_key: ABSORBED } });
  else await prisma.sysSetting.update({ where: { setting_key: ABSORBED }, data: { setting_value: savedAbsorbed } });
  await prisma.mEmployee.deleteMany({ where: { id: ids.emp } });
  await prisma.refUnit.deleteMany({ where: { id: { in: [ids.k, ids.ka] } } });
  await f.teardown();
  await cleanupFixtures();
  await cleanupFiscalYear();
  await disconnect();
});

describe("Kerja: Mulai, Selesai, Batal Mulai", () => {
  test("Mulai moves a Job whole into Sedang Dikerjakan, with no cost and no journal", async () => {
    const b = await job(ids.k, 100);
    const r = await start({ lines: [{ bucket_id: b.id, employee_id: ids.emp }] });
    assert.ok(r.ok, JSON.stringify(r));
    assert.match(r.no, new RegExp(`^KJ_${f.key("K")}_\\d{6}_00001$`));
    const working = (await at(ids.k, "Working")).find((x) => x.lotId === b.lotId)!;
    assert.equal(working.qty, 100);
    assert.equal(working.value, 1_000, "value carried in, nothing added");
    assert.equal(working.jobId, b.jobId);
    assert.equal((await at(ids.k, "Preparation")).filter((x) => x.lotId === b.lotId).length, 0);
    assert.equal(await prisma.prdCostEntry.count({ where: { source_no: r.no } }), 0);
  });

  test("a line needs a karyawan, and goods only from Persiapan Kerja", async () => {
    const b = await job(ids.k, 10);
    const none = await start({ lines: [{ bucket_id: b.id, employee_id: null }] });
    assert.ok(!none.ok && none.errors["lines.0.employee_id"]);
    const working = (await at(ids.k, "Working"))[0];
    const wrong = await start({ lines: [{ bucket_id: working.id, employee_id: ids.emp }] });
    assert.ok(!wrong.ok && /Persiapan Kerja/.test(wrong.errors["lines.0.bucket_id"]));
  });

  test("Selesai at the last step charges grams × the Unit rate with its journal, then QC Check (P281)", async () => {
    const working = (await at(ids.k, "Working")).find((x) => x.qty === 100)!;
    const r = await closeKerja([working.id], "finish", today, f.actor);
    assert.ok(r.ok, JSON.stringify(r));
    assert.equal(r.cost, 2_000, "100 g × Rp 20");
    const qc = (await at(ids.k, "QcCheck")).find((x) => x.lotId === working.lotId)!;
    assert.equal(qc.value, 3_000, "carried Rp 1.000 plus the cost");
    const line = await prisma.prdKerjaLine.findFirstOrThrow({ where: { work_bucket_id: working.id } });
    assert.ok(line.finished_at);
    const jl = await prisma.accJournalLine.findMany({ where: { journal_id: line.journal_id! } });
    assert.equal(jl.find((l) => l.account_id === ids.absorbed)?.kredit_amount.toNumber(), 2_000);
    assert.equal(jl.find((l) => l.account_id === f.wipAcc)?.debit_amount.toNumber(), 2_000);
    const doc = (await getKerja(line.kerja_id))!;
    assert.equal(doc.status, "Finished");
  });

  test("Selesai before the last step is a transformation: no cost, on to the next Persiapan", async () => {
    const b = await job(ids.ka, 50);
    const r = await start({ unit_id: ids.ka, lines: [{ bucket_id: b.id, employee_id: ids.emp }] });
    assert.ok(r.ok, JSON.stringify(r));
    const working = (await at(ids.ka, "Working")).find((x) => x.lotId === b.lotId)!;
    const done = await closeKerja([working.id], "finish", today, f.actor);
    assert.ok(done.ok && done.cost === 0, JSON.stringify(done));
    const next = (await at(ids.ka, "Preparation")).find((x) => x.lotId === b.lotId)!;
    const assign = (await prisma.refUnitStep.findFirstOrThrow({ where: { unit_id: ids.ka, process: "Assign" } })).id;
    assert.equal(next.stepId, assign);
    assert.equal(next.value, 500);
  });

  test("Batal Mulai returns the Job to Persiapan Kerja at no cost; the document closes as Dibatalkan", async () => {
    const b = await job(ids.k, 30);
    const r = await start({ lines: [{ bucket_id: b.id, employee_id: ids.emp }] });
    assert.ok(r.ok);
    const working = (await at(ids.k, "Working")).find((x) => x.lotId === b.lotId)!;
    const back = await closeKerja([working.id], "cancel", today, f.actor);
    assert.ok(back.ok && back.cost === 0);
    const prep = (await at(ids.k, "Preparation")).find((x) => x.lotId === b.lotId)!;
    assert.equal(prep.value, 300);
    assert.equal((await getKerja(r.id))!.status, "Cancelled");
    const again = await closeKerja([working.id], "finish", today, f.actor);
    assert.ok(!again.ok, "a closed line cannot be finished");
  });
});
