"use server";

import { revalidatePath } from "next/cache";
import { type Actor } from "@/lib/erp/access";
import { authorizeAction } from "@/lib/erp/auth";
import { isAccessDenied } from "@/lib/erp/auth-errors";
import {
  costBillPreview,
  createCostBill,
  transitionCostBill,
  updateCostBill,
  type CostBillInput,
  type CostBillLineInput,
  type CostBillResult,
} from "@/lib/erp/production-cost-bill";
import { COST_BILL_PATH, COST_BILL_TRANSITIONS, type CostBillAction } from "@/lib/erp/production-cost-bill-workflow";
import type { JournalPreviewResult } from "@/lib/erp/journal";

/**
 * The Tagihan Biaya Produksi's write path (P150 M68). The permission is
 * checked here; every rule is in `lib/erp/production-cost-bill.ts`, where the
 * tests can reach it.
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
  revalidatePath(COST_BILL_PATH);
  if (id) revalidatePath(`${COST_BILL_PATH}/${id}`);
  // Posting moves the cost reports and the journal.
  revalidatePath("/production/report", "layout");
  revalidatePath("/accounting", "layout");
}

export async function createCostBillAction(input: CostBillInput, lines: CostBillLineInput[]): Promise<CostBillResult> {
  const g = await authorize("PRODUCTION_COST_BILL_CREATE");
  if (!g.ok) return g.denial;
  const result = await createCostBill(input, lines, g.actor.user.id);
  if (result.ok) revalidate(result.id);
  return result;
}

export async function updateCostBillAction(id: number, input: CostBillInput, lines: CostBillLineInput[]): Promise<CostBillResult> {
  const g = await authorize("PRODUCTION_COST_BILL_EDIT");
  if (!g.ok) return g.denial;
  const result = await updateCostBill(id, input, lines, g.actor.user.id);
  if (result.ok) revalidate(id);
  return result;
}

/** The journal Posting would write, from a dry run of Posting itself (P103). */
export async function previewCostBillPostingAction(id: number): Promise<JournalPreviewResult> {
  const g = await authorize(COST_BILL_TRANSITIONS.post.permission);
  if (!g.ok) return g.denial;
  return costBillPreview(id, g.actor.user.id);
}

export async function transitionCostBillAction(
  id: number,
  action: CostBillAction,
  reason?: string
): Promise<{ ok: true; message: string } | { ok: false; errors: Record<string, string> }> {
  const transition = COST_BILL_TRANSITIONS[action];
  if (!transition) return { ok: false, errors: { _form: "Aksi tidak dikenal." } };
  const g = await authorize(transition.permission);
  if (!g.ok) return g.denial;
  try {
    const result = await transitionCostBill(id, action, g.actor.user.id, reason);
    if (!result.ok) return result;
  } catch (error) {
    return { ok: false, errors: { _form: error instanceof Error ? error.message : "Gagal diproses." } };
  }
  revalidate(id);
  return { ok: true, message: transition.done };
}
