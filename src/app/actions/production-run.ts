"use server";

import { revalidatePath } from "next/cache";
import { type Actor } from "@/lib/erp/access";
import { authorizeAction } from "@/lib/erp/auth";
import { isAccessDenied } from "@/lib/erp/auth-errors";
import type { JournalPreviewResult } from "@/lib/erp/journal";
import {
  createRun,
  runPreview,
  transitionRun,
  updateRun,
  type RunHeaderInput,
  type RunResult,
  type RunSectionInput,
} from "@/lib/erp/production-run";
import { EXECUTION_TRANSITIONS, type ExecutionAction } from "@/lib/erp/production-run-workflow";

/**
 * The Eksekusi Produksi's write path (P169). The permission is checked here;
 * every rule is in `lib/erp/production-run.ts`, where the tests can reach it.
 */

type Guard = { ok: true; actor: Actor } | { ok: false; denial: { ok: false; errors: Record<string, string> } };

async function authorize(code: string): Promise<Guard> {
  try {
    return { ok: true, actor: await authorizeAction(code) };
  } catch (error) {
    if (isAccessDenied(error)) return { ok: false, denial: { ok: false, errors: { _form: error.message } } };
    throw error;
  }
}

function revalidate(id?: number) {
  revalidatePath("/production/execution");
  if (id) revalidatePath(`/production/execution/${id}`);
  // The goods a run moves show on the hand-over and the stock pickers.
  revalidatePath("/production/handover", "layout");
}

export async function createRunAction(header: RunHeaderInput, sections: RunSectionInput[]): Promise<RunResult> {
  const g = await authorize("PRODUCTION_EXECUTION_CREATE");
  if (!g.ok) return g.denial;
  const result = await createRun(header, sections, g.actor.user.id);
  if (result.ok) revalidate(result.id);
  return result;
}

export async function updateRunAction(id: number, header: RunHeaderInput, sections: RunSectionInput[]): Promise<RunResult> {
  const g = await authorize("PRODUCTION_EXECUTION_EDIT");
  if (!g.ok) return g.denial;
  const result = await updateRun(id, header, sections, g.actor.user.id);
  if (result.ok) revalidate(id);
  return result;
}

/** The journal Posting would write, for its dialog: a dry run, rolled back (P103). */
export async function previewRunPostingAction(id: number): Promise<JournalPreviewResult> {
  const g = await authorize(EXECUTION_TRANSITIONS.post.permission);
  if (!g.ok) return g.denial;
  return runPreview(id, g.actor.user.id);
}

export type RunTransitionActionResult = { ok: true; message: string } | { ok: false; errors: Record<string, string> };

export async function transitionRunAction(id: number, action: ExecutionAction, reason?: string): Promise<RunTransitionActionResult> {
  const transition = EXECUTION_TRANSITIONS[action];
  if (!transition) return { ok: false, errors: { _form: "Aksi tidak dikenal." } };
  const g = await authorize(transition.permission);
  if (!g.ok) return g.denial;
  try {
    const result = await transitionRun(id, action, g.actor.user.id, reason);
    if (!result.ok) return result;
  } catch (error) {
    return { ok: false, errors: { _form: error instanceof Error ? error.message : "Gagal diproses." } };
  }
  revalidate(id);
  return { ok: true, message: transition.done };
}
