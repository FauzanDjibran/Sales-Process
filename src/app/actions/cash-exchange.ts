"use server";

import { revalidatePath } from "next/cache";
import { type Actor } from "@/lib/erp/access";
import { authorizeAction } from "@/lib/erp/auth";
import { isAccessDenied } from "@/lib/erp/auth-errors";
import {
  cashExchangePreview,
  createCashExchange,
  transitionCashExchange,
  updateCashExchange,
  type CashExchangeInput,
  type CashExchangeResult,
} from "@/lib/erp/cash-exchange";
import { CASH_EXCHANGE_PATH, CASH_EXCHANGE_TRANSITIONS, type CashExchangeAction } from "@/lib/erp/cash-exchange-workflow";
import type { JournalPreviewResult } from "@/lib/erp/journal";

/**
 * Penukaran Valas's write path (MC11a). The permission is checked here; every
 * rule is in `lib/erp/cash-exchange.ts`, where the tests can reach it.
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
  revalidatePath(CASH_EXCHANGE_PATH);
  if (id) revalidatePath(`${CASH_EXCHANGE_PATH}/${id}`);
  // Posting moves both books, their reports and the journal.
  revalidatePath("/finance/report", "layout");
  revalidatePath("/accounting", "layout");
}

export async function createCashExchangeAction(input: CashExchangeInput): Promise<CashExchangeResult> {
  const g = await authorize("CASH_EXCHANGE_CREATE");
  if (!g.ok) return g.denial;
  const result = await createCashExchange(input, g.actor.user.id);
  if (result.ok) revalidate(result.id);
  return result;
}

export async function updateCashExchangeAction(id: number, input: CashExchangeInput): Promise<CashExchangeResult> {
  const g = await authorize("CASH_EXCHANGE_EDIT");
  if (!g.ok) return g.denial;
  const result = await updateCashExchange(id, input, g.actor.user.id);
  if (result.ok) revalidate(id);
  return result;
}

/** The journal Posting would write, from a dry run of Posting itself (P103). */
export async function previewCashExchangePostingAction(id: number): Promise<JournalPreviewResult> {
  const g = await authorize(CASH_EXCHANGE_TRANSITIONS.post.permission);
  if (!g.ok) return g.denial;
  return cashExchangePreview(id, g.actor.user.id);
}

export async function transitionCashExchangeAction(
  id: number,
  action: CashExchangeAction,
  reason?: string
): Promise<{ ok: true; message: string } | { ok: false; errors: Record<string, string> }> {
  const transition = CASH_EXCHANGE_TRANSITIONS[action];
  if (!transition) return { ok: false, errors: { _form: "Aksi tidak dikenal." } };
  const g = await authorize(transition.permission);
  if (!g.ok) return g.denial;
  try {
    const result = await transitionCashExchange(id, action, g.actor.user.id, reason);
    if (!result.ok) return result;
  } catch (error) {
    return { ok: false, errors: { _form: error instanceof Error ? error.message : "Gagal diproses." } };
  }
  revalidate(id);
  return { ok: true, message: transition.done };
}
