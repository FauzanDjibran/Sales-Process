"use server";

import { revalidatePath } from "next/cache";
import { type Actor } from "@/lib/erp/access";
import { authorizeAction } from "@/lib/erp/auth";
import { isAccessDenied } from "@/lib/erp/auth-errors";
import {
  cashTransferPreview,
  createCashTransfer,
  transitionCashTransfer,
  updateCashTransfer,
  type CashTransferInput,
  type CashTransferResult,
} from "@/lib/erp/cash-transfer";
import { CASH_TRANSFER_PATH, CASH_TRANSFER_TRANSITIONS, type CashTransferAction } from "@/lib/erp/cash-transfer-workflow";
import type { JournalPreviewResult } from "@/lib/erp/journal";

/**
 * Transfer Kas & Bank's write path (P299). The permission is checked here; every
 * rule is in `lib/erp/cash-transfer.ts`, where the tests can reach it.
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
  revalidatePath(CASH_TRANSFER_PATH);
  if (id) revalidatePath(`${CASH_TRANSFER_PATH}/${id}`);
  // Posting moves both books, their reports and the journal.
  revalidatePath("/finance/report", "layout");
  revalidatePath("/accounting", "layout");
}

export async function createCashTransferAction(input: CashTransferInput): Promise<CashTransferResult> {
  const g = await authorize("CASH_TRANSFER_CREATE");
  if (!g.ok) return g.denial;
  const result = await createCashTransfer(input, g.actor.user.id);
  if (result.ok) revalidate(result.id);
  return result;
}

export async function updateCashTransferAction(id: number, input: CashTransferInput): Promise<CashTransferResult> {
  const g = await authorize("CASH_TRANSFER_EDIT");
  if (!g.ok) return g.denial;
  const result = await updateCashTransfer(id, input, g.actor.user.id);
  if (result.ok) revalidate(id);
  return result;
}

/** The journal Posting would write, from a dry run of Posting itself (P103). */
export async function previewCashTransferPostingAction(id: number): Promise<JournalPreviewResult> {
  const g = await authorize(CASH_TRANSFER_TRANSITIONS.post.permission);
  if (!g.ok) return g.denial;
  return cashTransferPreview(id, g.actor.user.id);
}

export async function transitionCashTransferAction(
  id: number,
  action: CashTransferAction,
  reason?: string
): Promise<{ ok: true; message: string } | { ok: false; errors: Record<string, string> }> {
  const transition = CASH_TRANSFER_TRANSITIONS[action];
  if (!transition) return { ok: false, errors: { _form: "Aksi tidak dikenal." } };
  const g = await authorize(transition.permission);
  if (!g.ok) return g.denial;
  try {
    const result = await transitionCashTransfer(id, action, g.actor.user.id, reason);
    if (!result.ok) return result;
  } catch (error) {
    return { ok: false, errors: { _form: error instanceof Error ? error.message : "Gagal diproses." } };
  }
  revalidate(id);
  return { ok: true, message: transition.done };
}
