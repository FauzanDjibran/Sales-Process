"use server";

import { revalidatePath } from "next/cache";
import { type Actor } from "@/lib/erp/access";
import { authorizeAction } from "@/lib/erp/auth";
import { isAccessDenied } from "@/lib/erp/auth-errors";
import { assertUnit } from "@/lib/erp/production-access";
import { sendProductionIssue, type ProductionIssueInput, type ProductionIssueResult } from "@/lib/erp/production-issue";
import { productionReceiptUnit, receiveProductionReceipt } from "@/lib/erp/production-receipt";
import { PRODUCTION_ISSUE_PATH, PRODUCTION_RECEIPT_PATH } from "@/lib/erp/production-handover-shape";
import { STOCK_RECEIPT_PATH } from "@/lib/erp/stock-receipt-purposes";

/**
 * Goods entering and leaving production (P317), each on its own Unit (P260).
 * Every rule is in the modules.
 */

type Denial = { ok: false; errors: Record<string, string> };

async function authorize(code: string, check: (actor: Actor) => Promise<void>): Promise<{ ok: true; actor: Actor } | Denial> {
  try {
    const actor = await authorizeAction(code);
    await check(actor);
    return { ok: true, actor };
  } catch (error) {
    if (isAccessDenied(error)) return { ok: false, errors: { _form: error.message } };
    throw error;
  }
}

export async function sendProductionIssueAction(input: ProductionIssueInput): Promise<ProductionIssueResult> {
  const g = await authorize("PRODUCTION_ISSUE_SEND", (actor) => assertUnit(actor, Number(input.from_unit_id) || 0));
  if (!g.ok) return g;
  const result = await sendProductionIssue(input, g.actor.user.id);
  if (result.ok) {
    revalidatePath(PRODUCTION_ISSUE_PATH);
    revalidatePath(STOCK_RECEIPT_PATH);
    revalidatePath("/production/workspace", "layout");
  }
  return result;
}

export async function receiveProductionReceiptAction(id: number): Promise<{ ok: true; message: string } | Denial> {
  const g = await authorize("PRODUCTION_RECEIPT_RECEIVE", async (actor) => assertUnit(actor, (await productionReceiptUnit(id)) ?? 0));
  if (!g.ok) return g;
  const result = await receiveProductionReceipt(id, g.actor.user.id);
  if (!result.ok) return result;
  revalidatePath(PRODUCTION_RECEIPT_PATH, "layout");
  revalidatePath("/inventory/stock-issue", "layout");
  revalidatePath("/production/workspace", "layout");
  return { ok: true, message: "Barang diterima di Unit" };
}
