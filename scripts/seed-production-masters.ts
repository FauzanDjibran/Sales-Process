/**
 * The Reguler line's Workstations, Units and Routings as `Produksi Walet
 * (Real).md` §5 and §8 draw them (P229) — `npm run db:seed-production`,
 * `npm run db:neon-seed-production`. Standard Cost is not here: its rates are
 * the user's to fill.
 *
 * A Workstation or a Unit is matched on its name and takes the plan's code, so
 * rows the user typed by hand are kept. A routing already there is left alone.
 * Run it after `db:seed`, and again after nothing: it changes only what differs.
 */
import { prisma } from "../src/lib/prisma";
import type { PrdExitMode, PrdJobPolicy, PrdProcessKind } from "../src/generated/prisma/client";
import { stepRuleErrors } from "../src/lib/erp/production-master-shape";

const WORKSTATIONS = [
  ["BB + PPIC", "Bahan Baku & PPIC"],
  ["CL", "Cleaning"],
  ["ML", "Moulding"],
  ["WP", "WIP Packing"],
] as const;

// The table of §5, column for column.
const UNITS: [label: string, name: string, workstation: string, processes: PrdProcessKind[], exit: PrdExitMode, job: PrdJobPolicy][] = [
  ["UGH", "Grading Halus", "BB + PPIC", ["Grading"], "Direct", "Issued"],
  ["UPC", "Pre Cleaning", "BB + PPIC", ["PassThrough"], "Direct", "Carried"],
  ["UPY", "Penyebaran", "BB + PPIC", ["Grading", "PartaiFormer"], "WithQc", "Issued"],
  ["UPW", "Pre Wash", "CL", ["PassThrough"], "WithQc", "Carried"],
  ["UCL", "Cleaning", "CL", ["PassThrough"], "WithQc", "Carried"],
  ["UDA", "Dry A", "ML", ["Grading"], "WithQc", "Carried"],
  ["UML", "Moulding", "ML", ["GradingMix", "JobOrder"], "WithQc", "None"],
  ["UDB", "Dry B", "ML", ["Grading"], "WithQc", "Issued"],
  ["UWP", "Wrapping", "WP", ["PassThrough"], "WithQc", "Carried"],
  ["UBC", "Barcoding", "WP", ["Grading"], "WithQc", "Carried"],
  ["UP5", "Packing 95", "WP", ["Assembly"], "PerCarton", "Released"],
  ["UP8", "Packing 98", "WP", ["Assembly"], "NoQc", "None"],
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
    name: "Reguler, Pre Wash sampai Packing",
    line: "REG",
    steps: [["UPW"], ["UCL"], ["UDA", { checkpoint: true }], ["UML"], ["UDB"], ["UWP"], ["UBC"], ["UP5"], ["UP8", { skippable: true }]],
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
  const processes = new Map<number, string[]>();
  for (const [label, name, workstation, kinds, exit_mode, job_policy] of UNITS) {
    const known = await prisma.refUnit.findFirst({ where: { OR: [{ unit_label: label }, { unit_name: name }] } });
    const data = { unit_label: label, unit_name: name, workstation_id: wsId.get(workstation)!, processes: kinds, exit_mode, job_policy };
    const row = known
      ? await prisma.refUnit.update({ where: { id: known.id }, data: { ...data, updated_by: actor } })
      : await prisma.refUnit.create({
          data: { ...data, unit_code: await nextCode("unit", (await prisma.refUnit.findMany({ select: { unit_code: true } })).map((u) => u.unit_code)), created_by: actor },
        });
    unitId.set(label, row.id);
    processes.set(row.id, kinds);
  }

  for (const r of ROUTINGS) {
    const line = r.line ? await prisma.prdLine.findFirst({ where: { line_label: r.line } }) : null;
    if (r.line && !line) throw new Error(`Line ${r.line} belum ada.`);
    const lineId = line?.id ?? null;
    if (await prisma.prdRouting.findFirst({ where: r.line ? { routing_label: r.label } : { line_id: null } })) {
      console.log(`  ${r.label}: sudah ada, dibiarkan`);
      continue;
    }
    const steps = r.steps.map(([unit, flags], i) => ({
      seq: i + 1,
      unit_id: unitId.get(unit)!,
      is_checkpoint: Boolean(flags?.checkpoint),
      is_skippable: Boolean(flags?.skippable),
    }));
    // The same rules the form applies.
    const problems = stepRuleErrors(steps, Boolean(lineId), (id) => processes.get(id) ?? []);
    if (problems.length) throw new Error(`${r.label}: ${problems.join(" ")}`);
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
    console.log(`  ${r.label}: ${r.steps.map((s) => s[0]).join(" → ")}`);
  }
  console.log(`Workstation ${wsId.size}, Unit ${unitId.size} sesuai rencana.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
