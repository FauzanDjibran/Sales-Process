"use server";

import { revalidatePath } from "next/cache";
import { authorizeAction } from "@/lib/erp/auth";
import { isAccessDenied } from "@/lib/erp/auth-errors";
import { createRelease, releasePreview, transitionRelease, updateRelease, type ReleaseInput, type ReleaseResult } from "@/lib/erp/production-release";
import { RELEASE_WORKFLOW, type ProdDocAction } from "@/lib/erp/production-doc-workflow";
import type { JournalPreviewResult } from "@/lib/erp/journal";

/**
 * The Production Release's write path (R8). The permission is checked here;
 * every rule is in `lib/erp/production-release.ts`, where the tests can reach it.
 */

const W = RELEASE_WORKFLOW;

async function authorize<T>(code: string, run: (actorId: number) => Promise<T>): Promise<T | { ok: false; errors: Record<string, string> }> {
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

export async function createReleaseAction(input: ReleaseInput): Promise<ReleaseResult> {
  const r = await authorize("PRODUCTION_RELEASE_CREATE", (actor) => createRelease(input, actor));
  if (r.ok) revalidate(r.id);
  return r;
}

export async function updateReleaseAction(id: number, input: ReleaseInput): Promise<ReleaseResult> {
  const r = await authorize("PRODUCTION_RELEASE_EDIT", (actor) => updateRelease(id, input, actor));
  if (r.ok) revalidate(id);
  return r;
}

/** The journal Posting would write, for the confirmation dialog: a dry run, rolled back (P103). */
export async function previewReleaseAction(id: number): Promise<JournalPreviewResult> {
  return authorize(W.transitions.post.permission, (actor) => releasePreview(id, actor));
}

export async function transitionReleaseAction(id: number, action: ProdDocAction, reason?: string): Promise<{ ok: true; message: string } | { ok: false; errors: Record<string, string> }> {
  const t = W.transitions[action];
  if (!t) return { ok: false, errors: { _form: "Aksi tidak dikenal." } };
  const r = await authorize(t.permission, async (actor) => {
    try {
      return await transitionRelease(id, action, actor, reason);
    } catch (error) {
      return { ok: false as const, errors: { _form: error instanceof Error ? error.message : "Gagal diproses." } };
    }
  });
  if (!r.ok) return r;
  revalidate(id);
  return { ok: true, message: t.done };
}
