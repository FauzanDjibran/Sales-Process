"use server";

import { revalidatePath } from "next/cache";
import { type Actor } from "@/lib/erp/access";
import { authorizeAction } from "@/lib/erp/auth";
import { isAccessDenied } from "@/lib/erp/auth-errors";
import {
  createProductionOrder,
  transitionProductionOrder,
  updateProductionOrder,
  type ProductionOrderHeaderInput,
  type ProductionOrderResult,
  type ProductionOrderStepInput,
} from "@/lib/erp/production-order";
import { PRODUCTION_ORDER_TRANSITIONS, type ProductionOrderAction } from "@/lib/erp/production-order-workflow";
import { openIssuesRefusal } from "@/lib/erp/stock-issue";
import { openHandoversRefusal } from "@/lib/erp/production-handover";

/**
 * The Perintah Produksi's write path (Walet step 3, M121). The permission is
 * checked here; every rule is in `lib/erp/production-order.ts`. Tutup is
 * composed here with the BSTB module, which knows what was raised from it.
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
  revalidatePath("/production/order");
  if (id) revalidatePath(`/production/order/${id}`);
}

export async function createProductionOrderAction(
  header: ProductionOrderHeaderInput,
  steps: ProductionOrderStepInput[]
): Promise<ProductionOrderResult> {
  const g = await authorize("PRODUCTION_ORDER_CREATE");
  if (!g.ok) return g.denial;
  const result = await createProductionOrder(header, steps, g.actor.user.id);
  if (result.ok) revalidate(result.id);
  return result;
}

export async function updateProductionOrderAction(
  id: number,
  header: ProductionOrderHeaderInput,
  steps: ProductionOrderStepInput[]
): Promise<ProductionOrderResult> {
  const g = await authorize("PRODUCTION_ORDER_EDIT");
  if (!g.ok) return g.denial;
  const result = await updateProductionOrder(id, header, steps, g.actor.user.id);
  if (result.ok) revalidate(id);
  return result;
}

export type ProductionOrderTransitionActionResult = { ok: true; message: string } | { ok: false; errors: Record<string, string> };

export async function transitionProductionOrderAction(id: number, action: ProductionOrderAction, reason?: string): Promise<ProductionOrderTransitionActionResult> {
  const transition = PRODUCTION_ORDER_TRANSITIONS[action];
  if (!transition) return { ok: false, errors: { _form: "Aksi tidak dikenal." } };
  const g = await authorize(transition.permission);
  if (!g.ok) return g.denial;
  try {
    const result = await transitionProductionOrder(id, action, g.actor.user.id, reason, async () => (await openIssuesRefusal(id)) ?? (await openHandoversRefusal(id)));
    if (!result.ok) return result;
  } catch (error) {
    return { ok: false, errors: { _form: error instanceof Error ? error.message : "Gagal diproses." } };
  }
  revalidate(id);
  return { ok: true, message: transition.done };
}
