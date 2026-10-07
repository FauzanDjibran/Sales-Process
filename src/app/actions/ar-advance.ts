"use server";

import { revalidatePath } from "next/cache";
import { type Actor } from "@/lib/erp/access";
import { authorizeAction } from "@/lib/erp/auth";
import { isAccessDenied } from "@/lib/erp/auth-errors";
import {
  createSalesAdvance,
  transitionSalesAdvance,
  updateSalesAdvance,
  type SalesAdvanceInput,
  type SalesAdvanceResult,
} from "@/lib/erp/ar-advance";
import { SALES_ADVANCE_TRANSITIONS, type AdvanceAction } from "@/lib/erp/ar-advance-workflow";

/**
 * The AR advance bill's write path. The permission is checked here; every rule
 * is in `lib/erp/ar-advance.ts`, where the tests can reach it.
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
  revalidatePath("/finance/advance/sales");
  if (id) revalidatePath(`/finance/advance/sales/${id}`);
}

export async function createSalesAdvanceAction(input: SalesAdvanceInput): Promise<SalesAdvanceResult> {
  const g = await authorize("SALES_ADVANCE_CREATE");
  if (!g.ok) return g.denial;
  const result = await createSalesAdvance(input, g.actor.user.id);
  if (result.ok) revalidate(result.id);
  return result;
}

export async function updateSalesAdvanceAction(id: number, input: SalesAdvanceInput): Promise<SalesAdvanceResult> {
  const g = await authorize("SALES_ADVANCE_EDIT");
  if (!g.ok) return g.denial;
  const result = await updateSalesAdvance(id, input, g.actor.user.id);
  if (result.ok) revalidate(id);
  return result;
}

export type SalesAdvanceTransitionActionResult =
  | { ok: true; message: string }
  | { ok: false; errors: Record<string, string> };

export async function transitionSalesAdvanceAction(
  id: number,
  action: AdvanceAction,
  reason?: string
): Promise<SalesAdvanceTransitionActionResult> {
  const transition = SALES_ADVANCE_TRANSITIONS[action];
  if (!transition) return { ok: false, errors: { _form: "Aksi tidak dikenal." } };
  const g = await authorize(transition.permission);
  if (!g.ok) return g.denial;
  try {
    // A paid bill refuses Batalkan by its own record of what was paid (P132).
    const result = await transitionSalesAdvance(id, action, g.actor.user.id, reason);
    if (!result.ok) return result;
  } catch (error) {
    return { ok: false, errors: { _form: error instanceof Error ? error.message : "Gagal diproses." } };
  }
  revalidate(id);
  return { ok: true, message: transition.done };
}
