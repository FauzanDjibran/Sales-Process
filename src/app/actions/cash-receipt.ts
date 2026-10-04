"use server";

import { revalidatePath } from "next/cache";
import { type Actor } from "@/lib/erp/access";
import { authorizeAction } from "@/lib/erp/auth";
import { isAccessDenied } from "@/lib/erp/auth-errors";
import {
  createCashReceipt,
  previewCashReceiptPosting,
  transitionCashReceipt,
  updateCashReceipt,
  type CashReceiptInput,
  type CashReceiptResult,
  type PostingLine,
} from "@/lib/erp/cash-bank-tx";
import { CASH_RECEIPT_TRANSITIONS, type CashBankTxAction } from "@/lib/erp/cash-bank-tx-workflow";

/**
 * Penerimaan Kas & Bank's write path. The permission is checked here; every
 * rule is in `lib/erp/cash-bank-tx.ts`, where the tests can reach it.
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
  revalidatePath("/finance/cash-bank/receipt");
  if (id) revalidatePath(`/finance/cash-bank/receipt/${id}`);
  // A posted receipt changes the bills' paid state.
  revalidatePath("/finance/advance/sales");
  // A Faktur paid shows its new standing; the AR reports move (U26).
  revalidatePath("/sales/invoice", "layout");
  revalidatePath("/finance/report", "layout");
}

export async function createCashReceiptAction(input: CashReceiptInput): Promise<CashReceiptResult> {
  const g = await authorize("CASH_RECEIPT_CREATE");
  if (!g.ok) return g.denial;
  const result = await createCashReceipt(input, g.actor.user.id);
  if (result.ok) revalidate(result.id);
  return result;
}

export async function updateCashReceiptAction(id: number, input: CashReceiptInput): Promise<CashReceiptResult> {
  const g = await authorize("CASH_RECEIPT_EDIT");
  if (!g.ok) return g.denial;
  const result = await updateCashReceipt(id, input, g.actor.user.id);
  if (result.ok) revalidate(id);
  return result;
}

/** The journal Posting would write, for the confirmation dialog. */
export async function previewCashReceiptPostingAction(
  id: number
): Promise<{ ok: true; description: string; lines: PostingLine[] } | { ok: false; errors: Record<string, string> }> {
  const g = await authorize("CASH_RECEIPT_POST");
  if (!g.ok) return g.denial;
  const p = await previewCashReceiptPosting(id);
  return p.ok ? p : { ok: false, errors: { _form: p.message } };
}

export type CashReceiptTransitionActionResult =
  | { ok: true; message: string }
  | { ok: false; errors: Record<string, string> };

export async function transitionCashReceiptAction(
  id: number,
  action: CashBankTxAction,
  reason?: string
): Promise<CashReceiptTransitionActionResult> {
  const transition = CASH_RECEIPT_TRANSITIONS[action];
  if (!transition) return { ok: false, errors: { _form: "Aksi tidak dikenal." } };
  const g = await authorize(transition.permission);
  if (!g.ok) return g.denial;
  try {
    const result = await transitionCashReceipt(id, action, g.actor.user.id, reason);
    if (!result.ok) return result;
  } catch (error) {
    return { ok: false, errors: { _form: error instanceof Error ? error.message : "Gagal diproses." } };
  }
  revalidate(id);
  return { ok: true, message: transition.done };
}
