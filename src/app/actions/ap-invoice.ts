"use server";

import { revalidatePath } from "next/cache";
import { type Actor } from "@/lib/erp/access";
import { authorizeAction } from "@/lib/erp/auth";
import { isAccessDenied } from "@/lib/erp/auth-errors";
import {
  createPurchaseInvoice,
  purchaseInvoicePreview,
  transitionPurchaseInvoice,
  updatePurchaseInvoice,
  type PurchaseInvoiceDeductionInput,
  type PurchaseInvoiceHeaderInput,
  type PurchaseInvoiceLineInput,
  type PurchaseInvoiceResult,
} from "@/lib/erp/ap-invoice";
import type { JournalPreviewResult } from "@/lib/erp/journal";
import { PURCHASE_INVOICE_TRANSITIONS, type InvoiceAction } from "@/lib/erp/ap-invoice-workflow";

/** The Invoice Pembelian's write path (P128); every rule is in `lib/erp/ap-invoice.ts`. */

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
  revalidatePath("/finance/invoice/purchase");
  if (id) revalidatePath(`/finance/invoice/purchase/${id}`);
  revalidatePath("/purchasing/order", "layout");
  revalidatePath("/finance/report", "layout");
}

export async function createPurchaseInvoiceAction(
  header: PurchaseInvoiceHeaderInput,
  lines: PurchaseInvoiceLineInput[],
  deductions: PurchaseInvoiceDeductionInput[]
): Promise<PurchaseInvoiceResult> {
  const g = await authorize("PURCHASE_INVOICE_CREATE");
  if (!g.ok) return g.denial;
  const result = await createPurchaseInvoice(header, lines, deductions, g.actor.user.id);
  if (result.ok) revalidate(result.id);
  return result;
}

export async function updatePurchaseInvoiceAction(
  id: number,
  header: PurchaseInvoiceHeaderInput,
  lines: PurchaseInvoiceLineInput[],
  deductions: PurchaseInvoiceDeductionInput[]
): Promise<PurchaseInvoiceResult> {
  const g = await authorize("PURCHASE_INVOICE_EDIT");
  if (!g.ok) return g.denial;
  const result = await updatePurchaseInvoice(id, header, lines, deductions, g.actor.user.id);
  if (result.ok) revalidate(id);
  return result;
}

export async function previewPurchaseInvoicePostingAction(id: number): Promise<JournalPreviewResult> {
  const g = await authorize("PURCHASE_INVOICE_POST");
  if (!g.ok) return g.denial;
  return purchaseInvoicePreview(id, g.actor.user.id);
}

export async function transitionPurchaseInvoiceAction(id: number, action: InvoiceAction, reason?: string): Promise<{ ok: true; message: string } | { ok: false; errors: Record<string, string> }> {
  const transition = PURCHASE_INVOICE_TRANSITIONS[action];
  if (!transition) return { ok: false, errors: { _form: "Aksi tidak dikenal." } };
  const g = await authorize(transition.permission);
  if (!g.ok) return g.denial;
  try {
    const result = await transitionPurchaseInvoice(id, action, g.actor.user.id, reason);
    if (!result.ok) return result;
  } catch (error) {
    return { ok: false, errors: { _form: error instanceof Error ? error.message : "Gagal diproses." } };
  }
  revalidate(id);
  return { ok: true, message: transition.done };
}
