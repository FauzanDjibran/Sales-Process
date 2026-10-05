"use server";

import { revalidatePath } from "next/cache";
import { type Actor } from "@/lib/erp/access";
import { authorizeAction } from "@/lib/erp/auth";
import { isAccessDenied } from "@/lib/erp/auth-errors";
import {
  createInvoice,
  invoicePreview,
  transitionInvoice,
  updateInvoice,
  type InvoiceDeductionInput,
  type InvoiceHeaderInput,
  type InvoiceLineInput,
  type InvoiceResult,
} from "@/lib/erp/ar-invoice";
import { createTaxDocsForInvoice } from "@/lib/erp/tax-document";
import { INVOICE_TRANSITIONS, type InvoiceAction } from "@/lib/erp/ar-invoice-workflow";
import type { JournalPreviewResult } from "@/lib/erp/journal";

/**
 * The Invoice Penjualan's write path. The permission is checked here; every
 * rule is in `lib/erp/ar-invoice.ts`, where the tests can reach it.
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
  revalidatePath("/finance/invoice/sales");
  if (id) revalidatePath(`/finance/invoice/sales/${id}`);
  // The Delivery Note shows what is billed, the Customer Order its Invoices,
  // and posting moves the AR reports.
  revalidatePath("/logistics/delivery-note", "layout");
  revalidatePath("/sales/customer-order", "layout");
  revalidatePath("/finance/report", "layout");
  revalidatePath("/tax", "layout");
}

export async function createInvoiceAction(
  header: InvoiceHeaderInput,
  lines: InvoiceLineInput[],
  deductions: InvoiceDeductionInput[]
): Promise<InvoiceResult> {
  const g = await authorize("SALES_INVOICE_CREATE");
  if (!g.ok) return g.denial;
  const result = await createInvoice(header, lines, deductions, g.actor.user.id);
  if (result.ok) revalidate(result.id);
  return result;
}

export async function updateInvoiceAction(
  id: number,
  header: InvoiceHeaderInput,
  lines: InvoiceLineInput[],
  deductions: InvoiceDeductionInput[]
): Promise<InvoiceResult> {
  const g = await authorize("SALES_INVOICE_EDIT");
  if (!g.ok) return g.denial;
  const result = await updateInvoice(id, header, lines, deductions, g.actor.user.id);
  if (result.ok) revalidate(id);
  return result;
}

/**
 * The journal Posting would write, for the confirmation dialog: Posting run as
 * a dry run and rolled back, with the same faktur pajak hook the real Posting
 * gets (P103). Asked for only when the dialog opens.
 */
export async function previewInvoicePostingAction(id: number): Promise<JournalPreviewResult> {
  const g = await authorize(INVOICE_TRANSITIONS.post.permission);
  if (!g.ok) return g.denial;
  const actorId = g.actor.user.id;
  return invoicePreview(id, actorId, (tx) => createTaxDocsForInvoice(tx, id, actorId));
}

export async function transitionInvoiceAction(
  id: number,
  action: InvoiceAction,
  reason?: string
): Promise<{ ok: true; message: string } | { ok: false; errors: Record<string, string> }> {
  const transition = INVOICE_TRANSITIONS[action];
  if (!transition) return { ok: false, errors: { _form: "Aksi tidak dikenal." } };
  const g = await authorize(transition.permission);
  if (!g.ok) return g.denial;
  try {
    // Posting raises the Faktur Pajak Pelunasan / Normal in the same transaction (P100).
    const actorId = g.actor.user.id;
    const result = await transitionInvoice(id, action, actorId, reason, (tx) => createTaxDocsForInvoice(tx, id, actorId));
    if (!result.ok) return result;
  } catch (error) {
    return { ok: false, errors: { _form: error instanceof Error ? error.message : "Gagal diproses." } };
  }
  revalidate(id);
  return { ok: true, message: transition.done };
}
