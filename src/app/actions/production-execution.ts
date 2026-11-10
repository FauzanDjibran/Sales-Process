"use server";

import { revalidatePath } from "next/cache";
import { type Actor } from "@/lib/erp/access";
import { authorizeAction } from "@/lib/erp/auth";
import { assertUnit } from "@/lib/erp/production-access";
import { isAccessDenied } from "@/lib/erp/auth-errors";
import type { JournalPreviewResult } from "@/lib/erp/journal";
import type { ProdDocAction, ProdDocWorkflow } from "@/lib/erp/production-doc-workflow";
import { GRADING_PATH, GRADING_WORKFLOW, QC_CHECK_PATH, QC_CHECK_WORKFLOW, WORK_PATH, WORK_WORKFLOW } from "@/lib/erp/production-execution-workflow";
import { createGrading, gradingPreview, gradingUnitId, transitionGrading, updateGrading, type GradingInput, type GradingResult } from "@/lib/erp/production-grading";
import { createQcCheck, qcCheckUnitId, transitionQcCheck, updateQcCheck, type QcInput, type QcResult } from "@/lib/erp/production-qc";
import { createWork, transitionWork, workUnitId, updateWork, workPreview, type WorkInput, type WorkResult } from "@/lib/erp/production-work";

/**
 * The write paths of the documents of work at a Unit. The permission is checked
 * here; every rule is in their modules, where the tests can reach them.
 */

type Guard = { ok: true; actor: Actor } | { ok: false; denial: { ok: false; errors: Record<string, string> } };

/**
 * The permission, then the Units the call touches (P260): the one a document is
 * at and the one a form sends, so a changed id or Unit does not reach another
 * Unit's goods.
 */
async function authorize(code: string, units: () => Promise<(number | null | undefined)[]> = async () => []): Promise<Guard> {
  try {
    const actor = await authorizeAction(code);
    // A Unit not chosen yet, or a document not found, is the module's to refuse.
    for (const unitId of await units()) if (unitId != null) await assertUnit(actor, unitId);
    return { ok: true, actor };
  } catch (error) {
    if (isAccessDenied(error)) return { ok: false, denial: { ok: false, errors: { _form: error.message } } };
    throw error;
  }
}

function revalidate(path: string, id?: number) {
  revalidatePath(path);
  if (id) revalidatePath(`${path}/${id}`);
}

export type ExecutionRunResult = { ok: true; message: string } | { ok: false; errors: Record<string, string> };

async function finish(
  workflow: ProdDocWorkflow,
  id: number,
  action: ProdDocAction,
  run: () => Promise<{ ok: true } | { ok: false; errors: Record<string, string> } | { ok: true; journal?: unknown }>
): Promise<ExecutionRunResult> {
  try {
    const result = await run();
    if (!result.ok) return result;
  } catch (error) {
    return { ok: false, errors: { _form: error instanceof Error ? error.message : "Gagal diproses." } };
  }
  revalidate(workflow.path, id);
  return { ok: true, message: workflow.transitions[action].done };
}

// ---------------------------------------------------------------- grading

export async function saveGradingAction(id: number | null, input: GradingInput): Promise<GradingResult> {
  const g = await authorize(id ? "PRODUCTION_GRADING_EDIT" : "PRODUCTION_GRADING_CREATE", async () => [...(id ? [await gradingUnitId(id)] : []), Number(input.unit_id) || null]);
  if (!g.ok) return g.denial;
  const result = id ? await updateGrading(id, input, g.actor.user.id) : await createGrading(input, g.actor.user.id);
  if (result.ok) revalidate(GRADING_PATH, result.id);
  return result;
}

export async function transitionGradingAction(id: number, action: ProdDocAction, reason: string): Promise<ExecutionRunResult> {
  const g = await authorize(GRADING_WORKFLOW.transitions[action].permission, async () => [await gradingUnitId(id)]);
  if (!g.ok) return g.denial;
  return finish(GRADING_WORKFLOW, id, action, () => transitionGrading(id, action, g.actor.user.id, reason));
}

export async function previewGradingAction(id: number): Promise<JournalPreviewResult> {
  const g = await authorize(GRADING_WORKFLOW.transitions.post.permission, async () => [await gradingUnitId(id)]);
  if (!g.ok) return g.denial;
  return gradingPreview(id, g.actor.user.id);
}

// ------------------------------------------------------------------- work

export async function saveWorkAction(id: number | null, input: WorkInput): Promise<WorkResult> {
  const g = await authorize(id ? "PRODUCTION_WORK_EDIT" : "PRODUCTION_WORK_CREATE", async () => [...(id ? [await workUnitId(id)] : []), Number(input.unit_id) || null]);
  if (!g.ok) return g.denial;
  const result = id ? await updateWork(id, input, g.actor.user.id) : await createWork(input, g.actor.user.id);
  if (result.ok) revalidate(WORK_PATH, result.id);
  return result;
}

export async function transitionWorkAction(id: number, action: ProdDocAction, reason: string): Promise<ExecutionRunResult> {
  const g = await authorize(WORK_WORKFLOW.transitions[action].permission, async () => [await workUnitId(id)]);
  if (!g.ok) return g.denial;
  return finish(WORK_WORKFLOW, id, action, () => transitionWork(id, action, g.actor.user.id, reason));
}

export async function previewWorkAction(id: number): Promise<JournalPreviewResult> {
  const g = await authorize(WORK_WORKFLOW.transitions.post.permission, async () => [await workUnitId(id)]);
  if (!g.ok) return g.denial;
  return workPreview(id, g.actor.user.id);
}

// --------------------------------------------------------------------- qc

export async function saveQcCheckAction(id: number | null, input: QcInput): Promise<QcResult> {
  const g = await authorize(id ? "PRODUCTION_QC_EDIT" : "PRODUCTION_QC_CREATE", async () => [...(id ? [await qcCheckUnitId(id)] : []), Number(input.unit_id) || null]);
  if (!g.ok) return g.denial;
  const result = id ? await updateQcCheck(id, input, g.actor.user.id) : await createQcCheck(input, g.actor.user.id);
  if (result.ok) revalidate(QC_CHECK_PATH, result.id);
  return result;
}

export async function transitionQcCheckAction(id: number, action: ProdDocAction, reason: string): Promise<ExecutionRunResult> {
  const g = await authorize(QC_CHECK_WORKFLOW.transitions[action].permission, async () => [await qcCheckUnitId(id)]);
  if (!g.ok) return g.denial;
  return finish(QC_CHECK_WORKFLOW, id, action, () => transitionQcCheck(id, action, g.actor.user.id, reason));
}
