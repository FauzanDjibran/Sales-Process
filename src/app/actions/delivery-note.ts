"use server";

import { revalidatePath } from "next/cache";
import { type Actor } from "@/lib/erp/access";
import { authorizeAction } from "@/lib/erp/auth";
import { isAccessDenied } from "@/lib/erp/auth-errors";
import {
  createDeliveryNote,
  deliveryNotePreview,
  transitionDeliveryNote,
  updateDeliveryNote,
  type DeliveryNoteHeaderInput,
  type DeliveryNoteLineInput,
  type DeliveryNoteResult,
} from "@/lib/erp/delivery-note";
import { DELIVERY_NOTE_TRANSITIONS, type DeliveryNoteAction } from "@/lib/erp/delivery-note-workflow";
import type { JournalPreviewResult } from "@/lib/erp/journal";

/**
 * The Delivery Note's write path. The permission is checked here; every rule
 * is in `lib/erp/delivery-note.ts`, where the tests can reach it.
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
  revalidatePath("/inventory/delivery-note");
  if (id) revalidatePath(`/inventory/delivery-note/${id}`);
  // Posting records what left on the Delivery Order and its Sales Orders, and
  // may close them; both pages show it.
  revalidatePath("/sales/delivery-order", "layout");
  revalidatePath("/sales/order", "layout");
}

export async function createDeliveryNoteAction(
  header: DeliveryNoteHeaderInput,
  lines: DeliveryNoteLineInput[]
): Promise<DeliveryNoteResult> {
  const g = await authorize("DELIVERY_NOTE_CREATE");
  if (!g.ok) return g.denial;
  const result = await createDeliveryNote(header, lines, g.actor.user.id);
  if (result.ok) revalidate(result.id);
  return result;
}

export async function updateDeliveryNoteAction(
  id: number,
  header: DeliveryNoteHeaderInput,
  lines: DeliveryNoteLineInput[]
): Promise<DeliveryNoteResult> {
  const g = await authorize("DELIVERY_NOTE_EDIT");
  if (!g.ok) return g.denial;
  const result = await updateDeliveryNote(id, header, lines, g.actor.user.id);
  if (result.ok) revalidate(id);
  return result;
}

/**
 * The journal Posting would write, for the confirmation dialog: Posting run as
 * a dry run and rolled back (P103). Asked for only when the dialog opens, so a
 * Draft's page pays nothing for it.
 */
export async function previewDeliveryNotePostingAction(id: number): Promise<JournalPreviewResult> {
  const g = await authorize(DELIVERY_NOTE_TRANSITIONS.post.permission);
  if (!g.ok) return g.denial;
  return deliveryNotePreview(id, g.actor.user.id);
}

export type DeliveryNoteTransitionActionResult =
  | { ok: true; message: string; closed: string[] }
  | { ok: false; errors: Record<string, string> };

export async function transitionDeliveryNoteAction(
  id: number,
  action: DeliveryNoteAction,
  reason?: string
): Promise<DeliveryNoteTransitionActionResult> {
  const transition = DELIVERY_NOTE_TRANSITIONS[action];
  if (!transition) return { ok: false, errors: { _form: "Aksi tidak dikenal." } };
  const g = await authorize(transition.permission);
  if (!g.ok) return g.denial;
  let closed: string[] = [];
  try {
    const result = await transitionDeliveryNote(id, action, g.actor.user.id, reason);
    if (!result.ok) return result;
    closed = result.closed ?? [];
  } catch (error) {
    return { ok: false, errors: { _form: error instanceof Error ? error.message : "Gagal diproses." } };
  }
  revalidate(id);
  // A posting that completed a Delivery Order or Sales Order says so.
  return { ok: true, message: transition.done, closed };
}
