"use server";

import { revalidatePath } from "next/cache";
import { type Actor } from "@/lib/erp/access";
import { authorizeAction } from "@/lib/erp/auth";
import { isAccessDenied } from "@/lib/erp/auth-errors";
import {
  createPurchaseRequest,
  transitionPurchaseRequest,
  updatePurchaseRequest,
  type PurchaseRequestHeaderInput,
  type PurchaseRequestLineInput,
  type PurchaseRequestResult,
} from "@/lib/erp/purchase-request";
import { PURCHASE_REQUEST_TRANSITIONS, type PurchaseRequestAction } from "@/lib/erp/purchase-request-workflow";

/**
 * The Purchase Request's write path. The permission is checked here; every
 * rule is in `lib/erp/purchase-request.ts`, where the tests can reach it.
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
  revalidatePath("/purchasing/request", "layout");
}

export async function createPurchaseRequestAction(
  header: PurchaseRequestHeaderInput,
  lines: PurchaseRequestLineInput[]
): Promise<PurchaseRequestResult> {
  const g = await authorize("PURCHASE_REQUEST_CREATE");
  if (!g.ok) return g.denial;
  const result = await createPurchaseRequest(header, lines, g.actor.user.id);
  if (result.ok) revalidate();
  return result;
}

export async function updatePurchaseRequestAction(
  id: number,
  header: PurchaseRequestHeaderInput,
  lines: PurchaseRequestLineInput[]
): Promise<PurchaseRequestResult> {
  const g = await authorize("PURCHASE_REQUEST_EDIT");
  if (!g.ok) return g.denial;
  const result = await updatePurchaseRequest(id, header, lines, g.actor.user.id);
  if (result.ok) revalidate();
  return result;
}

export type PurchaseRequestTransitionActionResult = { ok: true; message: string } | { ok: false; errors: Record<string, string> };

export async function transitionPurchaseRequestAction(
  id: number,
  action: PurchaseRequestAction,
  reason?: string
): Promise<PurchaseRequestTransitionActionResult> {
  const transition = PURCHASE_REQUEST_TRANSITIONS[action];
  if (!transition) return { ok: false, errors: { _form: "Aksi tidak dikenal." } };
  const g = await authorize(transition.permission);
  if (!g.ok) return g.denial;
  try {
    const result = await transitionPurchaseRequest(id, action, g.actor.user.id, reason);
    if (!result.ok) return result;
  } catch (error) {
    return { ok: false, errors: { _form: error instanceof Error ? error.message : "Gagal diproses." } };
  }
  revalidate();
  return { ok: true, message: transition.done };
}
