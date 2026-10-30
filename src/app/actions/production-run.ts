"use server";

import { revalidatePath } from "next/cache";
import { authorizeAction } from "@/lib/erp/auth";
import { isAccessDenied } from "@/lib/erp/auth-errors";
import { createExecution, executionPreview, transitionExecution, updateExecution, type ExecutionInput, type ExecutionResult } from "@/lib/erp/production-run";
import { EXECUTION_WORKFLOW, type ProdDocAction } from "@/lib/erp/production-doc-workflow";
import type { JournalPreviewResult } from "@/lib/erp/journal";

/**
 * The Eksekusi Produksi's write path (R5). The permission is checked here;
 * every rule is in `lib/erp/production-run.ts`, where the tests can reach it.
 */

const W = EXECUTION_WORKFLOW;

async function guarded<T>(code: string, run: (actorId: number) => Promise<T>): Promise<T | { ok: false; errors: Record<string, string> }> {
  try {
    const actor = await authorizeAction(code);
    return await run(actor.user.id);
  } catch (error) {
    if (isAccessDenied(error)) return { ok: false, errors: { _form: error.message } };
    throw error;
  }
}

function revalidate(id?: number) {
  revalidatePath(W.path);
  if (id) revalidatePath(`${W.path}/${id}`);
}

export async function createExecutionAction(input: ExecutionInput): Promise<ExecutionResult> {
  const r = await guarded("PRODUCTION_EXECUTION_CREATE", (actor) => createExecution(input, actor));
  if (r.ok) revalidate(r.id);
  return r;
}

export async function updateExecutionAction(id: number, input: ExecutionInput): Promise<ExecutionResult> {
  const r = await guarded("PRODUCTION_EXECUTION_EDIT", (actor) => updateExecution(id, input, actor));
  if (r.ok) revalidate(id);
  return r;
}

/** The journal Posting would write, for the confirmation dialog: a dry run, rolled back (P103). */
export async function previewExecutionAction(id: number): Promise<JournalPreviewResult> {
  return guarded(W.transitions.post.permission, (actor) => executionPreview(id, actor));
}

export async function transitionExecutionAction(id: number, action: ProdDocAction, reason?: string): Promise<{ ok: true; message: string } | { ok: false; errors: Record<string, string> }> {
  const t = W.transitions[action];
  if (!t) return { ok: false, errors: { _form: "Aksi tidak dikenal." } };
  const r = await guarded(t.permission, async (actor) => {
    try {
      return await transitionExecution(id, action, actor, reason);
    } catch (error) {
      return { ok: false as const, errors: { _form: error instanceof Error ? error.message : "Gagal diproses." } };
    }
  });
  if (!r.ok) return r;
  revalidate(id);
  return { ok: true, message: t.done };
}
