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
} from "@/lib/erp/cash-bank-tx";
import type { JournalPreviewResult } from "@/lib/erp/journal";
import { createTaxDocsForReceipt } from "@/lib/erp/tax-document";
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
  // An Invoice paid shows its new standing; the AR reports move (U26).
  revalidatePath("/finance/invoice/sales", "layout");
  revalidatePath("/finance/report", "layout");
  revalidatePath("/tax", "layout");
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

/**
 * The journal Posting would write, for the confirmation dialog: Posting run as
 * a dry run and rolled back, with the same tax hook the real Posting gets
 * (P103).
 */
export async function previewCashReceiptPostingAction(id: number): Promise<JournalPreviewResult> {
  const g = await authorize("CASH_RECEIPT_POST");
  if (!g.ok) return g.denial;
  const actorId = g.actor.user.id;
  return previewCashReceiptPosting(id, actorId, (tx) => createTaxDocsForReceipt(tx, id, actorId));
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
    // Posting raises the Faktur Pajak Uang Muka and the Bukti Potong in the
    // same transaction (P100); the receipt module never names the tax tables.
    const actorId = g.actor.user.id;
    const result = await transitionCashReceipt(id, action, actorId, reason, (tx) => createTaxDocsForReceipt(tx, id, actorId));
    if (!result.ok) return result;
  } catch (error) {
    return { ok: false, errors: { _form: error instanceof Error ? error.message : "Gagal diproses." } };
  }
  revalidate(id);
  return { ok: true, message: transition.done };
}
