"use server";

import { revalidatePath } from "next/cache";
import { type Actor } from "@/lib/erp/access";
import { authorizeAction } from "@/lib/erp/auth";
import { isAccessDenied } from "@/lib/erp/auth-errors";
import {
  createReceiptNote,
  receiptNotePreview,
  transitionReceiptNote,
  updateReceiptNote,
  type ReceiptNoteHeaderInput,
  type ReceiptNoteLineInput,
  type ReceiptNoteResult,
} from "@/lib/erp/receipt-note";
import { RECEIPT_NOTE_TRANSITIONS, type ReceiptNoteAction } from "@/lib/erp/receipt-note-workflow";
import type { JournalPreviewResult } from "@/lib/erp/journal";

/**
 * The Receipt Note's write path. The permission is checked here; every rule
 * is in `lib/erp/receipt-note.ts`, where the tests can reach it.
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
  revalidatePath("/logistics/receipt-note");
  if (id) revalidatePath(`/logistics/receipt-note/${id}`);
  // Posting records what came in on the Purchase Order, and may close it.
  revalidatePath("/purchasing/order", "layout");
}

export async function createReceiptNoteAction(
  header: ReceiptNoteHeaderInput,
  lines: ReceiptNoteLineInput[]
): Promise<ReceiptNoteResult> {
  const g = await authorize("RECEIPT_NOTE_CREATE");
  if (!g.ok) return g.denial;
  const result = await createReceiptNote(header, lines, g.actor.user.id);
  if (result.ok) revalidate(result.id);
  return result;
}

export async function updateReceiptNoteAction(
  id: number,
  header: ReceiptNoteHeaderInput,
  lines: ReceiptNoteLineInput[]
): Promise<ReceiptNoteResult> {
  const g = await authorize("RECEIPT_NOTE_EDIT");
  if (!g.ok) return g.denial;
  const result = await updateReceiptNote(id, header, lines, g.actor.user.id);
  if (result.ok) revalidate(id);
  return result;
}

/**
 * The journal Posting would write, for the confirmation dialog: Posting run as
 * a dry run and rolled back (P103). Asked for only when the dialog opens, so a
 * Draft's page pays nothing for it.
 */
export async function previewReceiptNotePostingAction(id: number): Promise<JournalPreviewResult> {
  const g = await authorize(RECEIPT_NOTE_TRANSITIONS.post.permission);
  if (!g.ok) return g.denial;
  return receiptNotePreview(id, g.actor.user.id);
}

export type ReceiptNoteTransitionActionResult =
  | { ok: true; message: string; closed: string[] }
  | { ok: false; errors: Record<string, string> };

export async function transitionReceiptNoteAction(
  id: number,
  action: ReceiptNoteAction,
  reason?: string
): Promise<ReceiptNoteTransitionActionResult> {
  const transition = RECEIPT_NOTE_TRANSITIONS[action];
  if (!transition) return { ok: false, errors: { _form: "Aksi tidak dikenal." } };
  const g = await authorize(transition.permission);
  if (!g.ok) return g.denial;
  let closed: string[] = [];
  try {
    const result = await transitionReceiptNote(id, action, g.actor.user.id, reason);
    if (!result.ok) return result;
    closed = result.closed ?? [];
  } catch (error) {
    return { ok: false, errors: { _form: error instanceof Error ? error.message : "Gagal diproses." } };
  }
  revalidate(id);
  // A posting that completed a Purchase Order says so.
  return { ok: true, message: transition.done, closed };
}
