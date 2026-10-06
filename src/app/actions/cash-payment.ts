"use server";

import { revalidatePath } from "next/cache";
import { type Actor } from "@/lib/erp/access";
import { authorizeAction } from "@/lib/erp/auth";
import { isAccessDenied } from "@/lib/erp/auth-errors";
import {
  createCashPayment,
  previewCashPaymentPosting,
  transitionCashPayment,
  updateCashPayment,
  type CashPaymentInput,
  type CashPaymentResult,
} from "@/lib/erp/cash-payment";
import type { JournalPreviewResult } from "@/lib/erp/journal";
import { CASH_PAYMENT_TRANSITIONS, type CashBankTxAction } from "@/lib/erp/cash-bank-tx-workflow";

/**
 * Pengeluaran Kas & Bank's write path (P127). The permission is checked here;
 * every rule is in `lib/erp/cash-payment.ts`, where the tests can reach it.
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
  revalidatePath("/finance/cash-bank/payment");
  if (id) revalidatePath(`/finance/cash-bank/payment/${id}`);
  revalidatePath("/finance/advance/purchase", "layout");
  revalidatePath("/finance/invoice/purchase", "layout");
  revalidatePath("/finance/report", "layout");
}

export async function createCashPaymentAction(input: CashPaymentInput): Promise<CashPaymentResult> {
  const g = await authorize("CASH_PAYMENT_CREATE");
  if (!g.ok) return g.denial;
  const result = await createCashPayment(input, g.actor.user.id);
  if (result.ok) revalidate(result.id);
  return result;
}

export async function updateCashPaymentAction(id: number, input: CashPaymentInput): Promise<CashPaymentResult> {
  const g = await authorize("CASH_PAYMENT_EDIT");
  if (!g.ok) return g.denial;
  const result = await updateCashPayment(id, input, g.actor.user.id);
  if (result.ok) revalidate(id);
  return result;
}

/** The journal Posting would write: Posting run as a dry run and rolled back (P103). */
export async function previewCashPaymentPostingAction(id: number): Promise<JournalPreviewResult> {
  const g = await authorize("CASH_PAYMENT_POST");
  if (!g.ok) return g.denial;
  return previewCashPaymentPosting(id, g.actor.user.id);
}

export type CashPaymentTransitionActionResult = { ok: true; message: string } | { ok: false; errors: Record<string, string> };

export async function transitionCashPaymentAction(id: number, action: CashBankTxAction, reason?: string): Promise<CashPaymentTransitionActionResult> {
  const transition = CASH_PAYMENT_TRANSITIONS[action];
  if (!transition) return { ok: false, errors: { _form: "Aksi tidak dikenal." } };
  const g = await authorize(transition.permission);
  if (!g.ok) return g.denial;
  try {
    const result = await transitionCashPayment(id, action, g.actor.user.id, reason);
    if (!result.ok) return result;
  } catch (error) {
    return { ok: false, errors: { _form: error instanceof Error ? error.message : "Gagal diproses." } };
  }
  revalidate(id);
  return { ok: true, message: transition.done };
}
