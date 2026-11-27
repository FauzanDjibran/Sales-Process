"use server";

import { revalidatePath } from "next/cache";
import { type Actor } from "@/lib/erp/access";
import { authorizeAction } from "@/lib/erp/auth";
import { isAccessDenied } from "@/lib/erp/auth-errors";
import type { PermissionCode } from "@/lib/erp/permissions";
import { assertWarehouse } from "@/lib/erp/warehouse-access";
import type { JournalPreviewResult } from "@/lib/erp/journal";
import {
  cancelStockReceipt,
  createStockReceipt,
  receiveStockReceipt,
  sourceOf,
  stockReceiptPreview,
  stockReceiptWarehouse,
  updateStockReceipt,
  type StockReceiptInput,
  type StockReceiptResult,
} from "@/lib/erp/stock-receipt";
import { STOCK_RECEIPT_PATH, isStockReceiptPurpose } from "@/lib/erp/stock-receipt-purposes";
import { STOCK_RECEIPT_TRANSITIONS, type StockReceiptAction } from "@/lib/erp/stock-receipt-workflow";

/** The Stock Receipt's actions (P317, P339), on the receiving warehouse (OD-9). Every rule is in the module. */

type Denial = { ok: false; errors: Record<string, string> };

async function authorize(permission: PermissionCode, warehouseId: number | null): Promise<{ ok: true; actor: Actor } | Denial> {
  try {
    const actor = await authorizeAction(permission);
    await assertWarehouse(actor, warehouseId);
    return { ok: true, actor };
  } catch (error) {
    if (isAccessDenied(error)) return { ok: false, errors: { _form: error.message } };
    throw error;
  }
}

/** A sourced receipt goes to its source's warehouse, whatever the form says. */
async function warehouseOf(input: StockReceiptInput): Promise<number | null> {
  if (isStockReceiptPurpose(input.purpose) && Number(input.source_id)) {
    const s = await sourceOf(input.purpose, Number(input.source_id));
    if (s) return s.warehouseId;
  }
  return Number(input.warehouse_id) || null;
}

const refresh = () => {
  revalidatePath(STOCK_RECEIPT_PATH, "layout");
  revalidatePath("/production/workspace", "layout");
};

export async function createStockReceiptAction(input: StockReceiptInput): Promise<StockReceiptResult> {
  const g = await authorize("STOCK_RECEIPT_CREATE", await warehouseOf(input));
  if (!g.ok) return g;
  const result = await createStockReceipt(input, g.actor.user.id);
  if (result.ok) refresh();
  return result;
}

export async function updateStockReceiptAction(id: number, input: StockReceiptInput): Promise<StockReceiptResult> {
  const g = await authorize("STOCK_RECEIPT_EDIT", await stockReceiptWarehouse(id));
  if (!g.ok) return g;
  // The warehouse it may move to is the user's too.
  const to = await warehouseOf(input);
  if (to) {
    const h = await authorize("STOCK_RECEIPT_EDIT", to);
    if (!h.ok) return h;
  }
  const result = await updateStockReceipt(id, input, g.actor.user.id);
  if (result.ok) refresh();
  return result;
}

export async function transitionStockReceiptAction(id: number, action: StockReceiptAction, reason?: string): Promise<{ ok: true; message: string } | Denial> {
  const t = STOCK_RECEIPT_TRANSITIONS[action];
  if (!t) return { ok: false, errors: { _form: "Langkah tidak dikenal." } };
  const g = await authorize(t.permission, await stockReceiptWarehouse(id));
  if (!g.ok) return g;
  const result = action === "receive" ? await receiveStockReceipt(id, g.actor.user.id) : await cancelStockReceipt(id, reason ?? "", g.actor.user.id);
  if (!result.ok) return result;
  refresh();
  return { ok: true, message: t.done };
}

export async function previewStockReceiptAction(id: number): Promise<JournalPreviewResult> {
  const g = await authorize("STOCK_RECEIPT_RECEIVE", await stockReceiptWarehouse(id));
  if (!g.ok) return g;
  return stockReceiptPreview(id, g.actor.user.id);
}
