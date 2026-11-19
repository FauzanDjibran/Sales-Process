"use server";

import { revalidatePath } from "next/cache";
import { type Actor } from "@/lib/erp/access";
import { authorizeAction } from "@/lib/erp/auth";
import { isAccessDenied } from "@/lib/erp/auth-errors";
import {
  createCreditNote,
  creditNotePreview,
  transitionCreditNote,
  updateCreditNote,
  type CreditNoteHeaderInput,
  type CreditNoteLineInput,
  type CreditNoteResult,
} from "@/lib/erp/ar-credit-note";
import { CREDIT_NOTE_TRANSITIONS, type CreditNoteAction } from "@/lib/erp/ar-credit-note-workflow";
import type { JournalPreviewResult } from "@/lib/erp/journal";

/**
 * The Credit Note Penjualan's write path (P292). The permission is checked
 * here; every rule is in `lib/erp/ar-credit-note.ts`, where the tests reach it.
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
  revalidatePath("/finance/invoice/credit-note");
  if (id) revalidatePath(`/finance/invoice/credit-note/${id}`);
  // Posting lowers the Invoice's item, which its page and register read.
  revalidatePath("/finance/invoice/sales", "layout");
}

export async function createCreditNoteAction(header: CreditNoteHeaderInput, lines: CreditNoteLineInput[]): Promise<CreditNoteResult> {
  const g = await authorize("SALES_CREDIT_NOTE_CREATE");
  if (!g.ok) return g.denial;
  const result = await createCreditNote(header, lines, g.actor.user.id);
  if (result.ok) revalidate(result.id);
  return result;
}

export async function updateCreditNoteAction(id: number, header: CreditNoteHeaderInput, lines: CreditNoteLineInput[]): Promise<CreditNoteResult> {
  const g = await authorize("SALES_CREDIT_NOTE_EDIT");
  if (!g.ok) return g.denial;
  const result = await updateCreditNote(id, header, lines, g.actor.user.id);
  if (result.ok) revalidate(id);
  return result;
}

export async function previewCreditNotePostingAction(id: number): Promise<JournalPreviewResult> {
  const g = await authorize("SALES_CREDIT_NOTE_POST");
  if (!g.ok) return g.denial;
  return creditNotePreview(id, g.actor.user.id);
}

export async function transitionCreditNoteAction(
  id: number,
  action: CreditNoteAction,
  reason?: string
): Promise<{ ok: true; message: string } | { ok: false; errors: Record<string, string> }> {
  const transition = CREDIT_NOTE_TRANSITIONS[action];
  if (!transition) return { ok: false, errors: { _form: "Aksi tidak dikenal." } };
  const g = await authorize(transition.permission);
  if (!g.ok) return g.denial;
  try {
    const result = await transitionCreditNote(id, action, g.actor.user.id, reason);
    if (!result.ok) return result;
  } catch (error) {
    return { ok: false, errors: { _form: error instanceof Error ? error.message : "Gagal diproses." } };
  }
  revalidate(id);
  return { ok: true, message: transition.done };
}
