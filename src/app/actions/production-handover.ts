"use server";

import { revalidatePath } from "next/cache";
import { type Actor } from "@/lib/erp/access";
import { authorizeAction } from "@/lib/erp/auth";
import { isAccessDenied } from "@/lib/erp/auth-errors";
import {
  createHandover,
  transitionHandover,
  updateHandover,
  type HandoverHeaderInput,
  type HandoverLineInput,
  type HandoverResult,
} from "@/lib/erp/production-handover";
import { HANDOVER_TRANSITIONS, type HandoverAction } from "@/lib/erp/production-handover-workflow";

/**
 * The hand-over's write path (P167). The permission is checked here; every rule
 * is in `lib/erp/production-handover.ts`, where the tests can reach it.
 */

type Guard =
  | { ok: true; actor: Actor }
  | { ok: false; denial: { ok: false; errors: Record<string, string> } };

async function authorize(code: string): Promise<Guard> {
  try {
    return { ok: true, actor: await authorizeAction(code) };
  } catch (error) {
    if (isAccessDenied(error)) {
      return { ok: false, denial: { ok: false, errors: { _form: error.message } } };
    }
    throw error;
  }
}

function revalidate(id?: number) {
  revalidatePath("/production/handover");
  if (id) revalidatePath(`/production/handover/${id}`);
  // A Perintah's page lists the hand-over that started its Partai.
  revalidatePath("/production/order", "layout");
}

export async function createHandoverAction(header: HandoverHeaderInput, lines: HandoverLineInput[]): Promise<HandoverResult> {
  const g = await authorize("PRODUCTION_HANDOVER_CREATE");
  if (!g.ok) return g.denial;
  const result = await createHandover(header, lines, g.actor.user.id);
  if (result.ok) revalidate(result.id);
  return result;
}

export async function updateHandoverAction(id: number, header: HandoverHeaderInput, lines: HandoverLineInput[]): Promise<HandoverResult> {
  const g = await authorize("PRODUCTION_HANDOVER_EDIT");
  if (!g.ok) return g.denial;
  const result = await updateHandover(id, header, lines, g.actor.user.id);
  if (result.ok) revalidate(id);
  return result;
}

export type HandoverTransitionActionResult = { ok: true; message: string } | { ok: false; errors: Record<string, string> };

export async function transitionHandoverAction(id: number, action: HandoverAction, reason?: string, date?: string): Promise<HandoverTransitionActionResult> {
  const transition = HANDOVER_TRANSITIONS[action];
  if (!transition) return { ok: false, errors: { _form: "Aksi tidak dikenal." } };
  const g = await authorize(transition.permission);
  if (!g.ok) return g.denial;
  try {
    const result = await transitionHandover(id, action, g.actor.user.id, reason, { date });
    if (!result.ok) return result;
  } catch (error) {
    return { ok: false, errors: { _form: error instanceof Error ? error.message : "Gagal diproses." } };
  }
  revalidate(id);
  return { ok: true, message: transition.done };
}
