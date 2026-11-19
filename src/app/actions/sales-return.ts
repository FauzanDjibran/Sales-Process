"use server";

import { revalidatePath } from "next/cache";
import { type Actor } from "@/lib/erp/access";
import { authorizeAction } from "@/lib/erp/auth";
import { isAccessDenied } from "@/lib/erp/auth-errors";
import {
  createSalesReturn,
  transitionSalesReturn,
  updateSalesReturn,
  type SalesReturnHeaderInput,
  type SalesReturnLineInput,
  type SalesReturnResult,
} from "@/lib/erp/sales-return";
import { SALES_RETURN_TRANSITIONS, type SalesReturnAction } from "@/lib/erp/sales-return-workflow";
import { liveReturnReceiptRefusal } from "@/lib/erp/receipt-note";

/**
 * The Sales Return's write path (P287). The permission is checked here; every
 * rule is in `lib/erp/sales-return.ts`, where the tests can reach it.
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
  revalidatePath("/sales/return");
  if (id) revalidatePath(`/sales/return/${id}`);
  // A returning Receipt Note draws on Open Sales Returns.
  revalidatePath("/inventory/receipt-note", "layout");
}

export async function createSalesReturnAction(
  header: SalesReturnHeaderInput,
  lines: SalesReturnLineInput[]
): Promise<SalesReturnResult> {
  const g = await authorize("SALES_RETURN_CREATE");
  if (!g.ok) return g.denial;
  const result = await createSalesReturn(header, lines, g.actor.user.id);
  if (result.ok) revalidate(result.id);
  return result;
}

export async function updateSalesReturnAction(
  id: number,
  header: SalesReturnHeaderInput,
  lines: SalesReturnLineInput[]
): Promise<SalesReturnResult> {
  const g = await authorize("SALES_RETURN_EDIT");
  if (!g.ok) return g.denial;
  const result = await updateSalesReturn(id, header, lines, g.actor.user.id);
  if (result.ok) revalidate(id);
  return result;
}

export type SalesReturnTransitionActionResult =
  | { ok: true; message: string }
  | { ok: false; errors: Record<string, string> };

export async function transitionSalesReturnAction(
  id: number,
  action: SalesReturnAction,
  reason?: string
): Promise<SalesReturnTransitionActionResult> {
  const transition = SALES_RETURN_TRANSITIONS[action];
  if (!transition) return { ok: false, errors: { _form: "Aksi tidak dikenal." } };
  const g = await authorize(transition.permission);
  if (!g.ok) return g.denial;
  try {
    // Tutup is refused while a Receipt Note on the return is still Draft; the
    // two modules meet here, not in each other.
    const guard = action === "close" ? liveReturnReceiptRefusal : undefined;
    const result = await transitionSalesReturn(id, action, g.actor.user.id, reason, guard);
    if (!result.ok) return result;
  } catch (error) {
    return { ok: false, errors: { _form: error instanceof Error ? error.message : "Gagal diproses." } };
  }
  revalidate(id);
  return { ok: true, message: transition.done };
}
