"use server";

import { revalidatePath } from "next/cache";
import { type Actor } from "@/lib/erp/access";
import { authorizeAction } from "@/lib/erp/auth";
import { isAccessDenied } from "@/lib/erp/auth-errors";
import type { JournalPreviewResult } from "@/lib/erp/journal";
import {
  createRelease,
  releasePreview,
  releasePurposeOf,
  transitionRelease,
  updateRelease,
  type ReleaseHeaderInput,
  type ReleaseLineInput,
  type ReleaseResult,
} from "@/lib/erp/production-release";
import { RELEASE_PURPOSES, RELEASE_TRANSITIONS, releasePermission, releasePurpose, type ReleaseAction } from "@/lib/erp/production-release-workflow";

/**
 * The write path of what takes goods out of production (P170). The permission is
 * the purpose's own — *Penerimaan Hasil Produksi* and *Pemusnahan Produksi* are
 * granted apart — and every rule is in `lib/erp/production-release.ts`.
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

const NOT_FOUND = { ok: false as const, errors: { _form: "Dokumen tidak ditemukan." } };

function revalidate(path: string, id?: number) {
  revalidatePath(path);
  if (id) revalidatePath(`${path}/${id}`);
  // The goods leave the station's pickers and the Perintah may have closed.
  revalidatePath("/production/handover", "layout");
  revalidatePath("/production/execution", "layout");
  revalidatePath("/production/order", "layout");
}

export async function createReleaseAction(header: ReleaseHeaderInput, lines: ReleaseLineInput[]): Promise<ReleaseResult> {
  const purpose = releasePurpose(header.purpose);
  if (!purpose) return NOT_FOUND;
  const g = await authorize(releasePermission(purpose.key, "create"));
  if (!g.ok) return g.denial;
  const result = await createRelease(header, lines, g.actor.user.id);
  if (result.ok) revalidate(purpose.path, result.id);
  return result;
}

export async function updateReleaseAction(id: number, header: ReleaseHeaderInput, lines: ReleaseLineInput[]): Promise<ReleaseResult> {
  const purpose = await releasePurposeOf(id);
  if (!purpose) return NOT_FOUND;
  const g = await authorize(releasePermission(purpose, "edit"));
  if (!g.ok) return g.denial;
  const result = await updateRelease(id, header, lines, g.actor.user.id);
  if (result.ok) revalidate(RELEASE_PURPOSES[purpose].path, id);
  return result;
}

/** The journal Posting would write, for its dialog: a dry run, rolled back (P103). */
export async function previewReleasePostingAction(id: number): Promise<JournalPreviewResult> {
  const purpose = await releasePurposeOf(id);
  if (!purpose) return NOT_FOUND;
  const g = await authorize(releasePermission(purpose, "post"));
  if (!g.ok) return g.denial;
  return releasePreview(id, g.actor.user.id);
}

export type ReleaseTransitionActionResult = { ok: true; message: string } | { ok: false; errors: Record<string, string> };

export async function transitionReleaseAction(id: number, action: ReleaseAction, reason?: string): Promise<ReleaseTransitionActionResult> {
  const transition = RELEASE_TRANSITIONS[action];
  const purpose = await releasePurposeOf(id);
  if (!transition || !purpose) return { ok: false, errors: { _form: "Dokumen atau aksi tidak dikenal." } };
  const def = RELEASE_PURPOSES[purpose];
  const g = await authorize(releasePermission(purpose, action));
  if (!g.ok) return g.denial;
  try {
    const result = await transitionRelease(id, action, g.actor.user.id, reason);
    if (!result.ok) return result;
  } catch (error) {
    return { ok: false, errors: { _form: error instanceof Error ? error.message : "Gagal diproses." } };
  }
  revalidate(def.path, id);
  return { ok: true, message: transition.done(def) };
}
