"use server";

import { revalidatePath } from "next/cache";
import { type Actor } from "@/lib/erp/access";
import { authorizeAction } from "@/lib/erp/auth";
import { isAccessDenied } from "@/lib/erp/auth-errors";
import {
  createCustomerOrder,
  transitionCustomerOrder,
  updateCustomerOrder,
  type CustomerOrderHeaderInput,
  type CustomerOrderLineInput,
  type CustomerOrderResult,
} from "@/lib/erp/customer-order";
import { CUSTOMER_ORDER_TRANSITIONS, type CustomerOrderAction } from "@/lib/erp/customer-order-workflow";
import { liveSalesOrderRefusal } from "@/lib/erp/sales-order";

/**
 * The Customer Order's write path. The permission is checked here; every rule is
 * in `lib/erp/customer-order.ts`, where the tests can reach it.
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
  revalidatePath("/sales/customer-order");
  if (id) revalidatePath(`/sales/customer-order/${id}`);
}

export async function createCustomerOrderAction(
  header: CustomerOrderHeaderInput,
  lines: CustomerOrderLineInput[],
  copiedFromId: number | null = null
): Promise<CustomerOrderResult> {
  const g = await authorize("CUSTOMER_ORDER_CREATE");
  if (!g.ok) return g.denial;
  const result = await createCustomerOrder(header, lines, g.actor.user.id, copiedFromId);
  if (result.ok) revalidate(result.id);
  return result;
}

export async function updateCustomerOrderAction(
  id: number,
  header: CustomerOrderHeaderInput,
  lines: CustomerOrderLineInput[]
): Promise<CustomerOrderResult> {
  const g = await authorize("CUSTOMER_ORDER_EDIT");
  if (!g.ok) return g.denial;
  const result = await updateCustomerOrder(id, header, lines, g.actor.user.id);
  if (result.ok) revalidate(id);
  return result;
}

export type CustomerOrderTransitionActionResult =
  | { ok: true; message: string }
  | { ok: false; errors: Record<string, string> };

export async function transitionCustomerOrderAction(
  id: number,
  action: CustomerOrderAction,
  reason?: string
): Promise<CustomerOrderTransitionActionResult> {
  const transition = CUSTOMER_ORDER_TRANSITIONS[action];
  if (!transition) return { ok: false, errors: { _form: "Aksi tidak dikenal." } };
  const g = await authorize(transition.permission);
  if (!g.ok) return g.denial;
  try {
    // Tutup Pesanan is refused while a Sales Order drawn from the order is
    // still running (P79); the two modules meet here, not in each other.
    const guard = action === "close" ? liveSalesOrderRefusal : undefined;
    const result = await transitionCustomerOrder(id, action, g.actor.user.id, reason, guard);
    if (!result.ok) return result;
  } catch (error) {
    return { ok: false, errors: { _form: error instanceof Error ? error.message : "Gagal diproses." } };
  }
  revalidate(id);
  return { ok: true, message: transition.done };
}
