"use server";

import { revalidatePath } from "next/cache";
import { type Actor } from "@/lib/erp/access";
import { authorizeAction } from "@/lib/erp/auth";
import { isAccessDenied } from "@/lib/erp/auth-errors";
import {
  createCreditApplication,
  creditApplicationPreview,
  transitionCreditApplication,
  updateCreditApplication,
  type CreditApplicationHeaderInput,
  type CreditApplicationLineInput,
  type CreditApplicationResult,
} from "@/lib/erp/ar-credit-application";
import { CREDIT_APPLICATION_TRANSITIONS, type CreditApplicationAction } from "@/lib/erp/ar-credit-application-workflow";
import { draftRefundsByCreditNotes } from "@/lib/erp/cash-payment";
import type { JournalPreviewResult } from "@/lib/erp/journal";

/**
 * The Penerapan Kredit's write path (P332). The permission is checked
 * here; every rule is in `lib/erp/ar-credit-application.ts`, where the tests reach it.
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

function revalidate(id?: number) {
  revalidatePath("/finance/invoice/credit-application");
  if (id) revalidatePath(`/finance/invoice/credit-application/${id}`);
  // Posting lowers the Invoice's item and the credit left, which their pages read.
  revalidatePath("/finance/invoice/sales", "layout");
  revalidatePath("/finance/invoice/credit-note", "layout");
}

export async function createCreditApplicationAction(header: CreditApplicationHeaderInput, lines: CreditApplicationLineInput[]): Promise<CreditApplicationResult> {
  const g = await authorize("SALES_CREDIT_APPLICATION_CREATE");
  if (!g.ok) return g.denial;
  const result = await createCreditApplication(header, lines, g.actor.user.id, draftRefundsByCreditNotes);
  if (result.ok) revalidate(result.id);
  return result;
}

export async function updateCreditApplicationAction(id: number, header: CreditApplicationHeaderInput, lines: CreditApplicationLineInput[]): Promise<CreditApplicationResult> {
  const g = await authorize("SALES_CREDIT_APPLICATION_EDIT");
  if (!g.ok) return g.denial;
  const result = await updateCreditApplication(id, header, lines, g.actor.user.id, draftRefundsByCreditNotes);
  if (result.ok) revalidate(id);
  return result;
}

export async function previewCreditApplicationPostingAction(id: number): Promise<JournalPreviewResult> {
  const g = await authorize("SALES_CREDIT_APPLICATION_POST");
  if (!g.ok) return g.denial;
  return creditApplicationPreview(id, g.actor.user.id, draftRefundsByCreditNotes);
}

export async function transitionCreditApplicationAction(
  id: number,
  action: CreditApplicationAction,
  reason?: string
): Promise<{ ok: true; message: string } | { ok: false; errors: Record<string, string> }> {
  const transition = CREDIT_APPLICATION_TRANSITIONS[action];
  if (!transition) return { ok: false, errors: { _form: "Aksi tidak dikenal." } };
  const g = await authorize(transition.permission);
  if (!g.ok) return g.denial;
  try {
    const result = await transitionCreditApplication(id, action, g.actor.user.id, reason, { refundHolds: draftRefundsByCreditNotes });
    if (!result.ok) return result;
  } catch (error) {
    return { ok: false, errors: { _form: error instanceof Error ? error.message : "Gagal diproses." } };
  }
  revalidate(id);
  return { ok: true, message: transition.done };
}
