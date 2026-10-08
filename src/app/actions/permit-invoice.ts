"use server";

import { revalidatePath } from "next/cache";
import { type Actor } from "@/lib/erp/access";
import { authorizeAction } from "@/lib/erp/auth";
import { isAccessDenied } from "@/lib/erp/auth-errors";
import {
  createPermitInvoice,
  permitInvoicePreview,
  transitionPermitInvoice,
  updatePermitInvoice,
  type PermitInvoiceDeductionInput,
  type PermitInvoiceInput,
  type PermitInvoiceResult,
} from "@/lib/erp/permit-invoice";
import { createTaxDocsForPermitInvoice } from "@/lib/erp/tax-document";
import { PERMIT_INVOICE_TRANSITIONS, type InvoiceAction } from "@/lib/erp/ar-invoice-workflow";
import type { JournalPreviewResult } from "@/lib/erp/journal";

/**
 * The Invoice Perizinan's write path. The permission is checked here; every
 * rule is in `lib/erp/permit-invoice.ts`, where the tests can reach it.
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
  revalidatePath("/finance/invoice/permit");
  if (id) revalidatePath(`/finance/invoice/permit/${id}`);
  // Posting marks the Pengajuan Selesai and moves the AR reports.
  revalidatePath("/sales/permit", "layout");
  revalidatePath("/finance/report", "layout");
  revalidatePath("/tax", "layout");
}

export async function createPermitInvoiceAction(
  input: PermitInvoiceInput,
  deductions: PermitInvoiceDeductionInput[]
): Promise<PermitInvoiceResult> {
  const g = await authorize("PERMIT_INVOICE_CREATE");
  if (!g.ok) return g.denial;
  const result = await createPermitInvoice(input, deductions, g.actor.user.id);
  if (result.ok) revalidate(result.id);
  return result;
}

export async function updatePermitInvoiceAction(
  id: number,
  input: PermitInvoiceInput,
  deductions: PermitInvoiceDeductionInput[]
): Promise<PermitInvoiceResult> {
  const g = await authorize("PERMIT_INVOICE_EDIT");
  if (!g.ok) return g.denial;
  const result = await updatePermitInvoice(id, input, deductions, g.actor.user.id);
  if (result.ok) revalidate(id);
  return result;
}

/**
 * The journal Posting would write, for the confirmation dialog: Posting run as
 * a dry run and rolled back, with the same faktur pajak hook the real Posting
 * gets (P103). Asked for only when the dialog opens.
 */
export async function previewPermitInvoicePostingAction(id: number): Promise<JournalPreviewResult> {
  const g = await authorize(PERMIT_INVOICE_TRANSITIONS.post.permission);
  if (!g.ok) return g.denial;
  const actorId = g.actor.user.id;
  return permitInvoicePreview(id, actorId, (tx) => createTaxDocsForPermitInvoice(tx, id, actorId));
}

export async function transitionPermitInvoiceAction(
  id: number,
  action: InvoiceAction,
  reason?: string
): Promise<{ ok: true; message: string } | { ok: false; errors: Record<string, string> }> {
  const transition = PERMIT_INVOICE_TRANSITIONS[action];
  if (!transition) return { ok: false, errors: { _form: "Aksi tidak dikenal." } };
  const g = await authorize(transition.permission);
  if (!g.ok) return g.denial;
  try {
    // Posting raises the Faktur Pajak Pelunasan / Normal in the same transaction (P100).
    const actorId = g.actor.user.id;
    const result = await transitionPermitInvoice(id, action, actorId, reason, (tx) => createTaxDocsForPermitInvoice(tx, id, actorId));
    if (!result.ok) return result;
  } catch (error) {
    return { ok: false, errors: { _form: error instanceof Error ? error.message : "Gagal diproses." } };
  }
  revalidate(id);
  return { ok: true, message: transition.done };
}
