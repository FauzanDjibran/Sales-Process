import "server-only";

import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import { formatQty } from "@/lib/format";
import { parseList } from "./partner-shape";
import {
  BOM_LINES_KEY,
  ROUTING_MODE_TEXT,
  ROUTING_STEPS_KEY,
  bomLineErrors,
  routingStepErrors,
  type BomLineDraft,
  type RoutingStepDraft,
} from "./production-master-shape";

/**
 * The production masters of Walet build step 1 — **Bill of Materials** and
 * **Routing** (`walet/build-plan.md`; `production_project.md` M121).
 *
 * Mainstream ERPs keep them apart (SAP's BoM and routing, D365's BOM and route
 * versions, NetSuite's BOM and manufacturing routing): the BoM says *what goes
 * in* per base quantity of an output item **at one workstation** (P166), the
 * Routing *where* a Partai goes on its way to its Item Target. How each
 * station works is the Workstation's own *Cara Kerja*. Both are suggestions an
 * execution or a Perintah starts from — a BoM never limits what is actually put
 * in. Several BoMs per item and workstation are allowed, one being the default;
 * one default Routing per item. Never deleted; deactivated instead.
 *
 * Named only by this module (`prd_bom(_line)`, `prd_routing(_step)`), apart
 * from the registry, which writes the headers.
 */

type Tx = Prisma.TransactionClient;

/** A Barang kept in stock — the only kind that enters production (M8). */
async function productionItems(ids: number[]) {
  const unique = [...new Set(ids.filter((n) => Number.isInteger(n) && n > 0))];
  const rows = unique.length
    ? await prisma.mItem.findMany({ where: { id: { in: unique } }, select: { id: true, item_label: true, item_type: true, track_stock: true, status: true } })
    : [];
  return new Map(rows.map((r) => [r.id, r]));
}

/** Why an item cannot be produced or put into production, or null. */
export async function productionItemProblem(itemId: number | null): Promise<string | null> {
  if (!itemId) return null;
  const item = (await productionItems([itemId])).get(itemId);
  if (!item) return "Item tidak ditemukan.";
  if (item.item_type !== "Barang" || !item.track_stock) return `${item.item_label} bukan Barang dengan Kelola Stok, jadi tidak masuk produksi.`;
  if (item.status !== "Active") return `${item.item_label} sudah nonaktif.`;
  return null;
}

// ---------------------------------------------------------------- BoM

export async function bomCollections(bomId: number): Promise<{ lines: BomLineDraft[] }> {
  const rows = await prisma.prdBomLine.findMany({ where: { bom_id: bomId }, orderBy: { id: "asc" } });
  return { lines: rows.map((r) => ({ id: r.id, key: `l${r.id}`, itemId: r.item_id, qty: r.qty.toString() })) };
}

export type BomCollections = {
  itemId: number | null;
  workstationId: number | null;
  isDefault: boolean;
  lines: { itemId: number; qty: string }[];
};

/**
 * Checks a BoM: its output item enters production; its workstation is active;
 * its base quantity is above 0; its lines name production items other than the
 * output, each once, at a quantity above 0 — at least one line.
 */
export async function checkBom(values: Record<string, unknown>, bomId: number | null): Promise<{ errors: Record<string, string>; clean: BomCollections }> {
  const errors: Record<string, string> = {};
  const before = bomId ? await prisma.prdBom.findUnique({ where: { id: bomId }, select: { item_id: true, workstation_id: true } }) : null;
  const itemId = before?.item_id ?? (Number(values.item_id) || null);
  const workstationId = Number(values.workstation_id) || null;
  const clean: BomCollections = { itemId, workstationId, isDefault: values.is_default === true || values.is_default === "true", lines: [] };
  if (!before) {
    const problem = await productionItemProblem(itemId);
    if (problem) errors.item_id = problem;
  }
  if (!workstationId) errors.workstation_id = "Pilih workstation tempat BoM ini dipakai.";
  else if (workstationId !== before?.workstation_id) {
    const ws = await prisma.refWorkstation.findUnique({ where: { id: workstationId }, select: { status: true } });
    if (!ws || ws.status !== "Active") errors.workstation_id = "Workstation tidak ditemukan atau nonaktif.";
  }
  const base = Number(String(values.base_qty ?? "").trim());
  if (String(values.base_qty ?? "").trim() !== "" && !(Number.isFinite(base) && base > 0)) errors.base_qty = "Jumlah dasar harus lebih dari 0.";

  const list = parseList<Partial<BomLineDraft>>(values[BOM_LINES_KEY]);
  if (list === null) {
    errors[BOM_LINES_KEY] = "Data komponen tidak terbaca.";
    return { errors, clean };
  }
  const items = await productionItems(list.map((l) => Number(l.itemId)));
  const kept = new Set(bomId ? (await prisma.prdBomLine.findMany({ where: { bom_id: bomId }, select: { item_id: true } })).map((l) => l.item_id) : []);
  const problems: string[] = [];
  const taken: number[] = [];
  for (const [i, l] of list.entries()) {
    const line = { itemId: Number(l.itemId) || null, qty: String(l.qty ?? "") };
    const lineErrors = bomLineErrors(line, taken, itemId);
    if (Object.keys(lineErrors).length) {
      problems.push(`Komponen ${i + 1}: ${Object.values(lineErrors)[0]}`);
      continue;
    }
    const item = items.get(line.itemId!);
    if (!item || item.item_type !== "Barang" || !item.track_stock) {
      problems.push(`Komponen ${i + 1}: pilih Barang dengan Kelola Stok.`);
      continue;
    }
    if (item.status !== "Active" && !kept.has(item.id)) {
      problems.push(`Komponen ${i + 1}: ${item.item_label} sudah nonaktif.`);
      continue;
    }
    taken.push(item.id);
    clean.lines.push({ itemId: item.id, qty: String(Number(line.qty)) });
  }
  if (!problems.length && !clean.lines.length) problems.push("Tambahkan minimal satu komponen.");
  if (problems.length) errors[BOM_LINES_KEY] = problems.join(" ");
  return { errors, clean };
}

/**
 * Makes the BoM's lines exactly what was submitted; a default BoM is the only
 * default of its item **at its workstation** (P166).
 */
export async function writeBom(tx: Tx, bomId: number, clean: BomCollections, actorId: number): Promise<void> {
  await tx.prdBomLine.deleteMany({ where: { bom_id: bomId, item_id: { notIn: clean.lines.map((l) => l.itemId) } } });
  for (const l of clean.lines) {
    await tx.prdBomLine.upsert({
      where: { bom_id_item_id: { bom_id: bomId, item_id: l.itemId } },
      update: { qty: l.qty, updated_by: actorId },
      create: { bom_id: bomId, item_id: l.itemId, qty: l.qty, created_by: actorId },
    });
  }
  if (clean.isDefault && clean.itemId && clean.workstationId) {
    await tx.prdBom.updateMany({
      where: { item_id: clean.itemId, workstation_id: clean.workstationId, id: { not: bomId }, is_default: true },
      data: { is_default: false, updated_by: actorId },
    });
  }
}

// ------------------------------------------------------------- Routing

export async function routingCollections(routingId: number): Promise<{ steps: RoutingStepDraft[] }> {
  const rows = await prisma.prdRoutingStep.findMany({ where: { routing_id: routingId }, orderBy: { step_no: "asc" } });
  return { steps: rows.map((r) => ({ id: r.id, key: `s${r.id}`, workstationId: r.workstation_id })) };
}

export type RoutingCollections = { itemId: number | null; isDefault: boolean; steps: { workstationId: number }[] };

/**
 * Checks a Routing: its target item enters production; its steps name active
 * workstations — at least one. A workstation may appear more than once (a
 * Partai can come back). How each works is the workstation's (P166).
 */
export async function checkRouting(values: Record<string, unknown>, routingId: number | null): Promise<{ errors: Record<string, string>; clean: RoutingCollections }> {
  const errors: Record<string, string> = {};
  const before = routingId ? await prisma.prdRouting.findUnique({ where: { id: routingId }, select: { item_id: true } }) : null;
  const itemId = before?.item_id ?? (Number(values.item_id) || null);
  const clean: RoutingCollections = { itemId, isDefault: values.is_default === true || values.is_default === "true", steps: [] };
  if (!before) {
    const problem = await productionItemProblem(itemId);
    if (problem) errors.item_id = problem;
  }
  const list = parseList<Partial<RoutingStepDraft>>(values[ROUTING_STEPS_KEY]);
  if (list === null) {
    errors[ROUTING_STEPS_KEY] = "Data langkah tidak terbaca.";
    return { errors, clean };
  }
  const wsIds = list.map((s) => Number(s.workstationId)).filter((n) => n > 0);
  const workstations = await prisma.refWorkstation.findMany({ where: { id: { in: wsIds } }, select: { id: true, status: true } });
  const wsById = new Map(workstations.map((w) => [w.id, w]));
  const problems: string[] = [];
  for (const [i, s] of list.entries()) {
    const step = { workstationId: Number(s.workstationId) || null };
    const stepErrors = routingStepErrors(step);
    if (Object.keys(stepErrors).length) {
      problems.push(`Langkah ${i + 1}: ${Object.values(stepErrors)[0]}`);
      continue;
    }
    const ws = wsById.get(step.workstationId!);
    if (!ws || ws.status !== "Active") {
      problems.push(`Langkah ${i + 1}: pilih workstation aktif.`);
      continue;
    }
    clean.steps.push({ workstationId: ws.id });
  }
  if (!problems.length && !clean.steps.length) problems.push("Tambahkan minimal satu langkah.");
  if (problems.length) errors[ROUTING_STEPS_KEY] = problems.join(" ");
  return { errors, clean };
}

/** Makes the Routing's steps exactly what was submitted, numbered 1..n in order. */
export async function writeRouting(tx: Tx, routingId: number, clean: RoutingCollections, actorId: number): Promise<void> {
  await tx.prdRoutingStep.deleteMany({ where: { routing_id: routingId } });
  for (const [i, s] of clean.steps.entries()) {
    await tx.prdRoutingStep.create({ data: { routing_id: routingId, step_no: i + 1, workstation_id: s.workstationId, created_by: actorId } });
  }
  if (clean.isDefault && clean.itemId) {
    await tx.prdRouting.updateMany({ where: { item_id: clean.itemId, id: { not: routingId }, is_default: true }, data: { is_default: false, updated_by: actorId } });
  }
}

// ------------------------------------------------------------ list reads

/** Each BoM's components in one line for its list — `MK-1 50 · BOX-NMK 1`. */
export async function bomSummaries(ids: number[]): Promise<Map<number, string>> {
  if (!ids.length) return new Map();
  const lines = await prisma.prdBomLine.findMany({
    where: { bom_id: { in: ids } },
    include: { item: { select: { item_label: true } } },
    orderBy: { id: "asc" },
  });
  const out = new Map<number, string[]>();
  for (const l of lines) out.set(l.bom_id, [...(out.get(l.bom_id) ?? []), `${l.item.item_label} ${formatQty(l.qty.toNumber())}`]);
  return new Map([...out].map(([id, list]) => [id, list.join(" · ")]));
}

/** Each Routing's stations in order — `UGH → UPC → UPY`. */
export async function routingSummaries(ids: number[]): Promise<Map<number, string>> {
  if (!ids.length) return new Map();
  const steps = await prisma.prdRoutingStep.findMany({
    where: { routing_id: { in: ids } },
    include: { workstation: { select: { workstation_label: true, mode: true } } },
    orderBy: [{ routing_id: "asc" }, { step_no: "asc" }],
  });
  const out = new Map<number, string[]>();
  for (const s of steps) {
    const tag = s.workstation.mode === "PassThrough" ? " (P)" : s.workstation.mode === "MixTransform" ? " (M)" : "";
    out.set(s.routing_id, [...(out.get(s.routing_id) ?? []), `${s.workstation.workstation_label}${tag}`]);
  }
  return new Map([...out].map(([id, list]) => [id, list.join(" → ")]));
}

export { ROUTING_MODE_TEXT };

// --------------------------------------------------- for the Perintah Produksi

export type RoutingChoice = {
  id: number;
  label: string;
  name: string;
  active: boolean;
  itemId: number;
  isDefault: boolean;
  steps: { workstationId: number }[];
};

/** A BoM with what the Perintah needs to work out its requirements (P165, P166). */
export type BomChoice = {
  id: number;
  label: string;
  name: string;
  active: boolean;
  itemId: number;
  workstationId: number;
  baseQty: number;
  isDefault: boolean;
  lines: { itemId: number; qty: number }[];
};

/**
 * The Routings a Perintah Produksi may copy and the BoMs its requirements come from (Walet step 3, P166):
 * every active one, plus those `with` names whatever their status now. The
 * Perintah keeps its own copy of the route, so later changes here leave it as it was.
 */
export async function routingAndBomChoices(
  withIds: { routingIds: number[]; bomIds: number[] } = { routingIds: [], bomIds: [] },
  db: Tx | typeof prisma = prisma
): Promise<{ routings: RoutingChoice[]; boms: BomChoice[] }> {
  const [routings, boms] = await Promise.all([
    db.prdRouting.findMany({
      where: { OR: [{ status: "Active" }, ...(withIds.routingIds.length ? [{ id: { in: withIds.routingIds } }] : [])] },
      orderBy: { routing_label: "asc" },
      include: { steps: { orderBy: { step_no: "asc" } } },
    }),
    db.prdBom.findMany({
      where: { OR: [{ status: "Active" }, ...(withIds.bomIds.length ? [{ id: { in: withIds.bomIds } }] : [])] },
      orderBy: { bom_label: "asc" },
      include: { lines: { orderBy: { id: "asc" } } },
    }),
  ]);
  return {
    routings: routings.map((r) => ({
      id: r.id,
      label: r.routing_label,
      name: r.routing_name,
      active: r.status === "Active",
      itemId: r.item_id,
      isDefault: r.is_default,
      steps: r.steps.map((s) => ({ workstationId: s.workstation_id })),
    })),
    boms: boms.map((b) => ({
      id: b.id,
      label: b.bom_label,
      name: b.bom_name,
      active: b.status === "Active",
      itemId: b.item_id,
      workstationId: b.workstation_id,
      baseQty: b.base_qty.toNumber(),
      isDefault: b.is_default,
      lines: b.lines.map((l) => ({ itemId: l.item_id, qty: l.qty.toNumber() })),
    })),
  };
}
