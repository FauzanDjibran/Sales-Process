"use server";

import { revalidatePath } from "next/cache";
import { type Actor } from "@/lib/erp/access";
import { authorizeAction } from "@/lib/erp/auth";
import { isAccessDenied } from "@/lib/erp/auth-errors";
import { openOrdersOfPlanRefusal } from "@/lib/erp/production-order";
import {
  createProductionPlan,
  planLineIdsOfPlan,
  transitionProductionPlan,
  updateProductionPlan,
  type PlanHeaderInput,
  type PlanLineInput,
  type PlanResult,
} from "@/lib/erp/production-plan";
import { PRODUCTION_PLAN_TRANSITIONS, type ProductionPlanAction } from "@/lib/erp/production-plan-workflow";

/**
 * The Rencana Produksi's write path (P168). The permission is checked here;
 * every rule is in `lib/erp/production-plan.ts`. Tutup is composed here with the
 * Perintah module, which knows what was made from the plan.
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
  revalidatePath("/production/plan");
  if (id) revalidatePath(`/production/plan/${id}`);
}

export async function createProductionPlanAction(header: PlanHeaderInput, lines: PlanLineInput[]): Promise<PlanResult> {
  const g = await authorize("PRODUCTION_PLAN_CREATE");
  if (!g.ok) return g.denial;
  const result = await createProductionPlan(header, lines, g.actor.user.id);
  if (result.ok) revalidate(result.id);
  return result;
}

export async function updateProductionPlanAction(id: number, header: PlanHeaderInput, lines: PlanLineInput[]): Promise<PlanResult> {
  const g = await authorize("PRODUCTION_PLAN_EDIT");
  if (!g.ok) return g.denial;
  const result = await updateProductionPlan(id, header, lines, g.actor.user.id);
  if (result.ok) revalidate(id);
  return result;
}

export type ProductionPlanTransitionActionResult = { ok: true; message: string } | { ok: false; errors: Record<string, string> };

export async function transitionProductionPlanAction(id: number, action: ProductionPlanAction, reason?: string): Promise<ProductionPlanTransitionActionResult> {
  const transition = PRODUCTION_PLAN_TRANSITIONS[action];
  if (!transition) return { ok: false, errors: { _form: "Aksi tidak dikenal." } };
  const g = await authorize(transition.permission);
  if (!g.ok) return g.denial;
  try {
    const result = await transitionProductionPlan(id, action, g.actor.user.id, reason, async () => openOrdersOfPlanRefusal(await planLineIdsOfPlan(id)));
    if (!result.ok) return result;
  } catch (error) {
    return { ok: false, errors: { _form: error instanceof Error ? error.message : "Gagal diproses." } };
  }
  revalidate(id);
  return { ok: true, message: transition.done };
}
