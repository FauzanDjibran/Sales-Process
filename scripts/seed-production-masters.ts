/**
 * The Reguler line's Workstations, Units and Routings up to Packing 95, as
 * `Produksi Walet (Real).md` §5 and W81 draw them (P229) — `npm run
 * db:seed-production`, `npm run db:neon-seed-production`. Standard Cost is not
 * here: its rates are the user's to fill.
 *
 * A Workstation or a Unit is matched on its name and takes the plan's code, so
 * rows the user typed by hand are kept; the one Moulding becomes UMG (W68). A
 * routing no partai follows is brought to the plan; a used one stays locked.
 * Run it after `db:seed`, and again after nothing: it changes only what differs.
 */
import { prisma } from "../src/lib/prisma";
import type { PrdJobPolicy, PrdProcessKind } from "../src/generated/prisma/client";
import { routingInUse } from "../src/lib/erp/production-ledger";
import { exitRoutes, stepRuleErrors, type RouteUnit } from "../src/lib/erp/production-master-shape";

const WORKSTATIONS = [
  ["BB + PPIC", "Bahan Baku & PPIC"],
  ["CL", "Cleaning"],
  ["ML", "Moulding"],
  ["WP", "WIP Packing"],
] as const;

// The table of §5, column for column, Packing 98 waiting for its plan (W81).
const UNITS: [label: string, name: string, workstation: string, process: PrdProcessKind, qc: boolean, job: PrdJobPolicy][] = [
  ["UGH", "Grading Halus", "BB + PPIC", "Grading", true, "Issued"],
  ["UPC", "Pre Cleaning", "BB + PPIC", "PassThrough", true, "Carried"],
  ["UPY", "Penyebaran", "BB + PPIC", "Grading", false, "Released"],
  ["UPW", "Pre Wash", "CL", "PassThrough", true, "Carried"],
  ["UCL", "Cleaning", "CL", "PassThrough", true, "Carried"],
  ["UC1", "CCP-1", "CL", "PassThrough", false, "Carried"],
  ["USR", "Sortir", "CL", "PassThrough", false, "Carried"],
  ["UDA", "Dry A", "ML", "Grading", true, "Carried"],
  ["UMG", "Moulding (grading)", "ML", "Grading", true, "ReleasedWithOrder"],
  ["UMP", "Moulding (process)", "ML", "PassThrough", false, "Carried"],
  ["UDB", "Dry B", "ML", "Grading", true, "Released"],
  ["UWP", "Wrapping", "WP", "PassThrough", true, "Carried"],
  ["UBC", "Barcoding", "WP", "Grading", true, "Carried"],
  ["UP5", "Packing 95", "WP", "Assembly", false, "None"],
];

type Step = [unit: string, flags?: { checkpoint?: boolean; skippable?: boolean }];

const ROUTINGS: { label: string; name: string; line: string | null; steps: Step[] }[] = [
  {
    label: "PRA-PARTAI",
    name: "Sebelum partai, sama untuk semua line",
    line: null,
    steps: [["UGH"], ["UPC"], ["UPY"]],
  },
  {
    label: "REG-1",
    name: "Reguler, Pre Wash sampai Packing 95",
    line: "REG",
    steps: [["UPW"], ["UCL"], ["UC1"], ["USR"], ["UDA"], ["UMG"], ["UMP"], ["UDB"], ["UWP"], ["UBC", { checkpoint: true }], ["UP5"]],
  },
];

async function nextCode(prefix: string, codes: string[]) {
  const max = codes.reduce((m, c) => Math.max(m, Number(c.split(".")[1]) || 0), 0);
  return `${prefix}.${String(max + 1).padStart(4, "0")}`;
}

async function main() {
  const sistem = await prisma.sysUser.findUnique({ where: { email: "sistem@erp.app" }, select: { id: true } });
  if (!sistem) throw new Error("System data is missing. Run `npm run db:seed` first.");
  const actor = sistem.id;

  const wsId = new Map<string, number>();
  for (const [label, name] of WORKSTATIONS) {
    const known = await prisma.refWorkstation.findFirst({ where: { OR: [{ workstation_label: label }, { workstation_name: name }] } });
    const row =
      known ??
      (await prisma.refWorkstation.create({
        data: {
          workstation_code: await nextCode("ws", (await prisma.refWorkstation.findMany({ select: { workstation_code: true } })).map((w) => w.workstation_code)),
          workstation_label: label,
          workstation_name: name,
          created_by: actor,
        },
      }));
    wsId.set(label, row.id);
  }

  const unitId = new Map<string, number>();
  const units = new Map<number, RouteUnit>();
  for (const [label, name, workstation, process, has_qc, job_policy] of UNITS) {
    const legacy = label === "UMG" ? [{ unit_label: "UML" }] : [];
    const known = await prisma.refUnit.findFirst({ where: { OR: [{ unit_label: label }, { unit_name: name }, ...legacy] } });
    const data = { unit_label: label, unit_name: name, workstation_id: wsId.get(workstation)!, process, has_qc, job_policy };
    const row = known
      ? await prisma.refUnit.update({ where: { id: known.id }, data: { ...data, updated_by: actor } })
      : await prisma.refUnit.create({
          data: { ...data, unit_code: await nextCode("unit", (await prisma.refUnit.findMany({ select: { unit_code: true } })).map((u) => u.unit_code)), created_by: actor },
        });
    unitId.set(label, row.id);
    units.set(row.id, row);
  }

  // The account is the starter chart's, when it has been seeded; the Line form sets it otherwise.
  const variance = await prisma.accAccount.findFirst({ where: { account_name: "Varians Produksi" }, select: { id: true } });
  const known = await prisma.prdLine.findFirst({ where: { OR: [{ line_label: "REG" }, { line_name: "Reguler" }] } });
  const reguler =
    known ??
    (await prisma.prdLine.create({
      data: {
        line_code: await nextCode("line", (await prisma.prdLine.findMany({ select: { line_code: true } })).map((l) => l.line_code)),
        line_label: "REG",
        line_name: "Reguler",
        variance_account_id: variance?.id ?? null,
        created_by: actor,
      },
    }));
  if (!reguler.variance_account_id && variance) await prisma.prdLine.update({ where: { id: reguler.id }, data: { variance_account_id: variance.id, updated_by: actor } });

  let end: RouteUnit | null = null;
  for (const r of ROUTINGS) {
    const lineId = r.line ? reguler.id : null;
    const steps = r.steps.map(([unit, flags], i) => ({
      seq: i + 1,
      unit_id: unitId.get(unit)!,
      is_checkpoint: Boolean(flags?.checkpoint),
      is_skippable: Boolean(flags?.skippable),
    }));
    // The same rules the form applies.
    const problems = stepRuleErrors(steps, Boolean(lineId), (id) => units.get(id), end);
    if (problems.length) throw new Error(`${r.label}: ${problems.join(" ")}`);
    if (!lineId) end = units.get(steps[steps.length - 1].unit_id)!;

    const existing = await prisma.prdRouting.findFirst({ where: r.line ? { routing_label: r.label } : { line_id: null } });
    if (existing) {
      if (await routingInUse(existing.id)) {
        console.log(`  ${r.label}: sudah dipakai, dibiarkan`);
        continue;
      }
      await prisma.prdRoutingStep.deleteMany({ where: { routing_id: existing.id } });
      await prisma.prdRoutingStep.createMany({ data: steps.map((s) => ({ ...s, routing_id: existing.id })) });
      await prisma.prdRouting.update({ where: { id: existing.id }, data: { routing_name: r.name, updated_by: actor } });
    } else {
      await prisma.prdRouting.create({
        data: {
          routing_code: await nextCode("rout", (await prisma.prdRouting.findMany({ select: { routing_code: true } })).map((x) => x.routing_code)),
          routing_label: r.label,
          routing_name: r.name,
          line_id: lineId,
          created_by: actor,
          steps: { create: steps },
        },
      });
    }
    const routes = exitRoutes(steps.map((s) => units.get(s.unit_id)?.workstation_id ?? null), Boolean(lineId));
    console.log(`  ${r.label}: ${r.steps.map((s, i) => `${s[0]}${routes[i] === "BSTB" ? " ⇒" : routes[i] ? " →" : ""}`).join(" ")}`);
  }
  console.log(`Workstation ${wsId.size}, Unit ${unitId.size} sesuai rencana.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
