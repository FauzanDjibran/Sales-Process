"use server";

import { revalidatePath } from "next/cache";
import { type Actor } from "@/lib/erp/access";
import { authorizeAction } from "@/lib/erp/auth";
import { isAccessDenied } from "@/lib/erp/auth-errors";
import {
  createStockIssue,
  stockIssuePreview,
  transitionStockIssue,
  updateStockIssue,
  type StockIssueHeaderInput,
  type StockIssueLineInput,
  type StockIssueResult,
} from "@/lib/erp/stock-issue";
import { STOCK_ISSUE_TRANSITIONS, type StockIssueAction } from "@/lib/erp/stock-issue-workflow";
import type { JournalPreviewResult } from "@/lib/erp/journal";

/**
 * The Stock Issue's write path (P158). The permission is checked here; every
 * rule is in `lib/erp/stock-issue.ts`, where the tests can reach it.
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
  revalidatePath("/inventory/stock-issue");
  if (id) revalidatePath(`/inventory/stock-issue/${id}`);
}

export async function createStockIssueAction(header: StockIssueHeaderInput, lines: StockIssueLineInput[]): Promise<StockIssueResult> {
  const g = await authorize("STOCK_ISSUE_CREATE");
  if (!g.ok) return g.denial;
  const result = await createStockIssue(header, lines, g.actor.user.id);
  if (result.ok) revalidate(result.id);
  return result;
}

export async function updateStockIssueAction(id: number, header: StockIssueHeaderInput, lines: StockIssueLineInput[]): Promise<StockIssueResult> {
  const g = await authorize("STOCK_ISSUE_EDIT");
  if (!g.ok) return g.denial;
  const result = await updateStockIssue(id, header, lines, g.actor.user.id);
  if (result.ok) revalidate(id);
  return result;
}

/** The journal Posting would write, for the confirmation dialog: a dry run, rolled back (P103). */
export async function previewStockIssuePostingAction(id: number): Promise<JournalPreviewResult> {
  const g = await authorize(STOCK_ISSUE_TRANSITIONS.post.permission);
  if (!g.ok) return g.denial;
  return stockIssuePreview(id, g.actor.user.id);
}

export type StockIssueTransitionActionResult = { ok: true; message: string } | { ok: false; errors: Record<string, string> };

export async function transitionStockIssueAction(id: number, action: StockIssueAction, reason?: string): Promise<StockIssueTransitionActionResult> {
  const transition = STOCK_ISSUE_TRANSITIONS[action];
  if (!transition) return { ok: false, errors: { _form: "Aksi tidak dikenal." } };
  const g = await authorize(transition.permission);
  if (!g.ok) return g.denial;
  try {
    const result = await transitionStockIssue(id, action, g.actor.user.id, reason);
    if (!result.ok) return result;
  } catch (error) {
    return { ok: false, errors: { _form: error instanceof Error ? error.message : "Gagal diproses." } };
  }
  revalidate(id);
  return { ok: true, message: transition.done };
}
