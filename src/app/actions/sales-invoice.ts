"use server";

import { revalidatePath } from "next/cache";
import { type Actor } from "@/lib/erp/access";
import { authorizeAction } from "@/lib/erp/auth";
import { isAccessDenied } from "@/lib/erp/auth-errors";
import {
  createInvoice,
  transitionInvoice,
  updateInvoice,
  type InvoiceDeductionInput,
  type InvoiceHeaderInput,
  type InvoiceLineInput,
  type InvoiceResult,
} from "@/lib/erp/sales-invoice";
import { INVOICE_TRANSITIONS, type InvoiceAction } from "@/lib/erp/sales-invoice-workflow";

/**
 * The Faktur Penjualan's write path. The permission is checked here; every
 * rule is in `lib/erp/sales-invoice.ts`, where the tests can reach it.
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
  revalidatePath("/sales/invoice");
  if (id) revalidatePath(`/sales/invoice/${id}`);
  // The Delivery Note shows what is billed, the Customer Order its Fakturs,
  // and posting moves the AR reports.
  revalidatePath("/sales/delivery-note", "layout");
  revalidatePath("/sales/customer-order", "layout");
  revalidatePath("/finance/report", "layout");
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
    const result = await transitionInvoice(id, action, g.actor.user.id, reason);
    if (!result.ok) return result;
  } catch (error) {
    return { ok: false, errors: { _form: error instanceof Error ? error.message : "Gagal diproses." } };
  }
  revalidate(id);
  return { ok: true, message: transition.done };
}
