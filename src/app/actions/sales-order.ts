"use server";

import { revalidatePath } from "next/cache";
import { type Actor } from "@/lib/erp/access";
import { authorizeAction } from "@/lib/erp/auth";
import { isAccessDenied } from "@/lib/erp/auth-errors";
import {
  createSalesOrder,
  transitionSalesOrder,
  updateSalesOrder,
  type SalesOrderHeaderInput,
  type SalesOrderLineInput,
  type SalesOrderResult,
} from "@/lib/erp/sales-order";
import { SALES_ORDER_TRANSITIONS, type SalesOrderAction } from "@/lib/erp/sales-order-workflow";

/**
 * The Sales Order's write path. The permission is checked here; every rule is
 * in `lib/erp/sales-order.ts`, where the tests can reach it.
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
  revalidatePath("/sales/order");
  if (id) revalidatePath(`/sales/order/${id}`);
}

export async function createSalesOrderAction(
  header: SalesOrderHeaderInput,
  lines: SalesOrderLineInput[],
  copiedFromId: number | null = null
): Promise<SalesOrderResult> {
  const g = await authorize("SALES_ORDER_CREATE");
  if (!g.ok) return g.denial;
  const result = await createSalesOrder(header, lines, g.actor.user.id, copiedFromId);
  if (result.ok) revalidate(result.id);
  return result;
}

export async function updateSalesOrderAction(
  id: number,
  header: SalesOrderHeaderInput,
  lines: SalesOrderLineInput[]
): Promise<SalesOrderResult> {
  const g = await authorize("SALES_ORDER_EDIT");
  if (!g.ok) return g.denial;
  const result = await updateSalesOrder(id, header, lines, g.actor.user.id);
  if (result.ok) revalidate(id);
  return result;
}

export type SalesOrderTransitionActionResult =
  | { ok: true; message: string }
  | { ok: false; errors: Record<string, string> };

export async function transitionSalesOrderAction(
  id: number,
  action: SalesOrderAction,
  reason?: string
): Promise<SalesOrderTransitionActionResult> {
  const transition = SALES_ORDER_TRANSITIONS[action];
  if (!transition) return { ok: false, errors: { _form: "Aksi tidak dikenal." } };
  const g = await authorize(transition.permission);
  if (!g.ok) return g.denial;
  try {
    const result = await transitionSalesOrder(id, action, g.actor.user.id, reason);
    if (!result.ok) return result;
  } catch (error) {
    return { ok: false, errors: { _form: error instanceof Error ? error.message : "Gagal diproses." } };
  }
  revalidate(id);
  return { ok: true, message: transition.done };
}
