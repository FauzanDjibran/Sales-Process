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
import { routingInUse } from "../src/lib/erp/production-ledger";
import { checkUnitCollections, writeUnitCollections } from "../src/lib/erp/production-master";
import { UNIT_STEPS_KEY, exitRoutes, stepRuleErrors, type RouteUnit } from "../src/lib/erp/production-master-shape";

const WORKSTATIONS = [
  ["BB + PPIC", "Bahan Baku & PPIC"],
  ["CL", "Cleaning"],
  ["ML", "Moulding"],
  ["WP", "WIP Packing"],
] as const;

// The units of the Workspace simulation (P274): each an ordered list of steps, a
// grading always releasing the No. Job; a trailing `+QC` is the Unit's QC feature (P281).
// Packing 98 waits for its plan (W81).
const UNITS: [label: string, name: string, workstation: string, steps: string][] = [
  ["UGH", "Grading Halus", "BB + PPIC", "Grading+QC"],
  ["UPC", "Pre Cleaning", "BB + PPIC", "Assign+QC"],
  ["UPY", "Penyebaran", "BB + PPIC", "Grading"],
  ["UPW", "Pre Wash", "CL", "Assign+QC"],
  ["UCL", "Cleaning", "CL", "Kerja+QC"],
  ["UC1", "CCP-1", "CL", "Assign"],
  ["USR", "Sortir", "CL", "Assign"],
  ["UDA", "Dry A", "ML", "Grading+QC"],
  ["UML", "Moulding", "ML", "Grading>JobOrder>Assign+QC"],
  ["UDB", "Dry B", "ML", "Grading+QC"],
  ["UWP", "Wrapping", "WP", "Assign+QC"],
  ["UBC", "Barcoding", "WP", "Grading+QC"],
  ["UP5", "Packing 95", "WP", "Assembly"],
];
// Moulding was two units, UMG and UMP, until the simulation merged them into UML (T1).
const RETIRED = ["UMP"];

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
    steps: [["UPW"], ["UCL"], ["UC1"], ["USR"], ["UDA", { checkpoint: true }], ["UML"], ["UDB"], ["UWP"], ["UBC", { checkpoint: true }], ["UP5"]],
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
  for (const [label, name, workstation, spec] of UNITS) {
    const [stepList, qc] = spec.split("+");
    const legacy = label === "UML" ? [{ unit_label: "UMG" }, { unit_name: "Moulding (grading)" }] : [];
    const known = await prisma.refUnit.findFirst({ where: { OR: [{ unit_label: label }, { unit_name: name }, ...legacy] } });
    const data = { unit_label: label, unit_name: name, workstation_id: wsId.get(workstation)!, allow_reproses: Boolean(qc), has_qc: Boolean(qc) };
    const row = known
      ? await prisma.refUnit.update({ where: { id: known.id }, data: { ...data, updated_by: actor } })
      : await prisma.refUnit.create({
          data: { ...data, unit_code: await nextCode("unit", (await prisma.refUnit.findMany({ select: { unit_code: true } })).map((u) => u.unit_code)), created_by: actor },
        });
    unitId.set(label, row.id);
    // The same check and writer as the form: a process goods have passed is never taken away.
    const wanted = stepList.split(">");
    const stored = (await prisma.refUnitStep.findMany({ where: { unit_id: row.id }, orderBy: { seq: "asc" } })).map((s) => s.process as string);
    if (stored.join(">") !== wanted.join(">")) {
      const checked = await checkUnitCollections({ [UNIT_STEPS_KEY]: JSON.stringify(wanted.map((process, i) => ({ key: `s${i}`, process }))) }, row.id);
      if (Object.keys(checked.errors).length) console.log(`  ${label}: proses dibiarkan (${Object.values(checked.errors)[0]})`);
      else await prisma.$transaction((tx) => writeUnitCollections(tx, row.id, checked.clean));
    }
    const now = await prisma.refUnitStep.findMany({ where: { unit_id: row.id }, select: { process: true } });
    units.set(row.id, { id: row.id, workstation_id: row.workstation_id, processes: now.map((s) => s.process) });
  }
  for (const label of RETIRED) await prisma.refUnit.updateMany({ where: { unit_label: label, status: "Active" }, data: { status: "Inactive", updated_by: actor } });

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
