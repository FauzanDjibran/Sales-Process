"use server";

import { revalidatePath } from "next/cache";
import { type Actor } from "@/lib/erp/access";
import { authorizeAction } from "@/lib/erp/auth";
import { isAccessDenied } from "@/lib/erp/auth-errors";
import {
  createPurchaseOrder,
  transitionPurchaseOrder,
  updatePurchaseOrder,
  type PurchaseOrderHeaderInput,
  type PurchaseOrderLineInput,
  type PurchaseOrderResult,
} from "@/lib/erp/purchase-order";
import { PURCHASE_ORDER_TRANSITIONS, type PurchaseOrderAction } from "@/lib/erp/purchase-order-workflow";
import { liveReceiptNoteRefusal } from "@/lib/erp/receipt-note";

/**
 * The Purchase Order's write path. Tutup is handed the Receipt Note module's
 * check, so a Purchase Order with a Draft receipt stays open. The permission is checked here; every
 * rule is in `lib/erp/purchase-order.ts`, where the tests can reach it.
 */

type Guard =
  | { ok: true; actor: Actor }
  | { ok: false; denial: { ok: false; errors: Record<string, string> } };

async function authorize(code: string): Promise<Guard> {
  try {
    return { ok: true, actor: await authorizeAction(code) };
  } catch (error) {
    if (isAccessDenied(error)) return { ok: false, denial: { ok: false, errors: { _form: error.message } } };
    throw error;
  }
}

function revalidate() {
  revalidatePath("/purchasing/order", "layout");
}

export async function createPurchaseOrderAction(
  header: PurchaseOrderHeaderInput,
  lines: PurchaseOrderLineInput[]
): Promise<PurchaseOrderResult> {
  const g = await authorize("PURCHASE_ORDER_CREATE");
  if (!g.ok) return g.denial;
  const result = await createPurchaseOrder(header, lines, g.actor.user.id);
  if (result.ok) revalidate();
  return result;
}

export async function updatePurchaseOrderAction(
  id: number,
  header: PurchaseOrderHeaderInput,
  lines: PurchaseOrderLineInput[]
): Promise<PurchaseOrderResult> {
  const g = await authorize("PURCHASE_ORDER_EDIT");
  if (!g.ok) return g.denial;
  const result = await updatePurchaseOrder(id, header, lines, g.actor.user.id);
  if (result.ok) revalidate();
  return result;
}

export type PurchaseOrderTransitionActionResult = { ok: true; message: string } | { ok: false; errors: Record<string, string> };

export async function transitionPurchaseOrderAction(
  id: number,
  action: PurchaseOrderAction,
  reason?: string
): Promise<PurchaseOrderTransitionActionResult> {
  const transition = PURCHASE_ORDER_TRANSITIONS[action];
  if (!transition) return { ok: false, errors: { _form: "Aksi tidak dikenal." } };
  const g = await authorize(transition.permission);
  if (!g.ok) return g.denial;
  try {
    const result = await transitionPurchaseOrder(id, action, g.actor.user.id, reason, action === "close" ? liveReceiptNoteRefusal : undefined);
    if (!result.ok) return result;
  } catch (error) {
    return { ok: false, errors: { _form: error instanceof Error ? error.message : "Gagal diproses." } };
  }
  revalidate();
  return { ok: true, message: transition.done };
}
