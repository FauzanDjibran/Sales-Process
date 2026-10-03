"use server";

import { revalidatePath } from "next/cache";
import { type Actor } from "@/lib/erp/access";
import { authorizeAction } from "@/lib/erp/auth";
import { isAccessDenied } from "@/lib/erp/auth-errors";
import {
  createDeliveryOrder,
  transitionDeliveryOrder,
  updateDeliveryOrder,
  type DeliveryOrderHeaderInput,
  type DeliveryOrderLineInput,
  type DeliveryOrderResult,
} from "@/lib/erp/delivery-order";
import { DELIVERY_ORDER_TRANSITIONS, type DeliveryOrderAction } from "@/lib/erp/delivery-order-workflow";
import { liveDeliveryNoteRefusal } from "@/lib/erp/delivery-note";

/**
 * The Delivery Order's write path. The permission is checked here; every rule
 * is in `lib/erp/delivery-order.ts`, where the tests can reach it.
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
  revalidatePath("/sales/delivery-order");
  if (id) revalidatePath(`/sales/delivery-order/${id}`);
  // The Sales Order's page lists the Delivery Orders drawing on it.
  revalidatePath("/sales/order", "layout");
  // A Delivery Note draws on issued Delivery Orders.
  revalidatePath("/sales/delivery-note", "layout");
}

export async function createDeliveryOrderAction(
  header: DeliveryOrderHeaderInput,
  lines: DeliveryOrderLineInput[]
): Promise<DeliveryOrderResult> {
  const g = await authorize("DELIVERY_ORDER_CREATE");
  if (!g.ok) return g.denial;
  const result = await createDeliveryOrder(header, lines, g.actor.user.id);
  if (result.ok) revalidate(result.id);
  return result;
}

export async function updateDeliveryOrderAction(
  id: number,
  header: DeliveryOrderHeaderInput,
  lines: DeliveryOrderLineInput[]
): Promise<DeliveryOrderResult> {
  const g = await authorize("DELIVERY_ORDER_EDIT");
  if (!g.ok) return g.denial;
  const result = await updateDeliveryOrder(id, header, lines, g.actor.user.id);
  if (result.ok) revalidate(id);
  return result;
}

export type DeliveryOrderTransitionActionResult =
  | { ok: true; message: string }
  | { ok: false; errors: Record<string, string> };

export async function transitionDeliveryOrderAction(
  id: number,
  action: DeliveryOrderAction,
  reason?: string
): Promise<DeliveryOrderTransitionActionResult> {
  const transition = DELIVERY_ORDER_TRANSITIONS[action];
  if (!transition) return { ok: false, errors: { _form: "Aksi tidak dikenal." } };
  const g = await authorize(transition.permission);
  if (!g.ok) return g.denial;
  try {
    // Tutup is refused while a Delivery Note on the order is still Draft; the
    // two modules meet here, not in each other.
    const guard = action === "close" ? liveDeliveryNoteRefusal : undefined;
    const result = await transitionDeliveryOrder(id, action, g.actor.user.id, reason, guard);
    if (!result.ok) return result;
  } catch (error) {
    return { ok: false, errors: { _form: error instanceof Error ? error.message : "Gagal diproses." } };
  }
  revalidate(id);
  return { ok: true, message: transition.done };
}
