"use server";

import { revalidatePath } from "next/cache";
import { type Actor } from "@/lib/erp/access";
import { authorizeAction } from "@/lib/erp/auth";
import { isAccessDenied } from "@/lib/erp/auth-errors";
import { assertWarehouse } from "@/lib/erp/warehouse-access";
import type { JournalPreviewResult } from "@/lib/erp/journal";
import {
  countSheet,
  createStockAdjustment,
  stockAdjustmentPreview,
  stockAdjustmentWarehouse,
  transitionStockAdjustment,
  updateStockAdjustment,
  type CountSheet,
  type StockAdjustmentHeaderInput,
  type StockAdjustmentLineInput,
  type StockAdjustmentResult,
} from "@/lib/erp/stock-adjustment";
import { STOCK_ADJUSTMENT_TRANSITIONS, type StockAdjustmentAction } from "@/lib/erp/stock-adjustment-workflow";

/** The Stock Adjustment's write path (P318): the permission and the warehouse (OD-9) here, every rule in the module. */

type Denial = { ok: false; errors: Record<string, string> };

async function authorize(code: string, warehouses: (number | null)[]): Promise<{ ok: true; actor: Actor } | Denial> {
  try {
    const actor = await authorizeAction(code);
    for (const w of warehouses) if (w != null) await assertWarehouse(actor, w);
    return { ok: true, actor };
  } catch (error) {
    if (isAccessDenied(error)) return { ok: false, errors: { _form: error.message } };
    throw error;
  }
}

/** What the books hold in a warehouse now; whoever may write a count may read it. */
export async function loadCountSheetAction(warehouseId: number, editing: boolean): Promise<{ ok: true; sheet: CountSheet } | Denial> {
  const g = await authorize(editing ? "STOCK_ADJUSTMENT_EDIT" : "STOCK_ADJUSTMENT_CREATE", [warehouseId]);
  if (!g.ok) return g;
  return { ok: true, sheet: await countSheet(warehouseId) };
}

export async function createStockAdjustmentAction(header: StockAdjustmentHeaderInput, lines: StockAdjustmentLineInput[]): Promise<StockAdjustmentResult> {
  const g = await authorize("STOCK_ADJUSTMENT_CREATE", [Number(header.warehouse_id) || null]);
  if (!g.ok) return g;
  const result = await createStockAdjustment(header, lines, g.actor.user.id);
  if (result.ok) revalidatePath("/inventory/stock-adjustment");
  return result;
}

export async function updateStockAdjustmentAction(id: number, header: StockAdjustmentHeaderInput, lines: StockAdjustmentLineInput[]): Promise<StockAdjustmentResult> {
  const g = await authorize("STOCK_ADJUSTMENT_EDIT", [await stockAdjustmentWarehouse(id), Number(header.warehouse_id) || null]);
  if (!g.ok) return g;
  const result = await updateStockAdjustment(id, header, lines, g.actor.user.id);
  if (result.ok) revalidatePath("/inventory/stock-adjustment", "layout");
  return result;
}

export async function previewStockAdjustmentAction(id: number): Promise<JournalPreviewResult> {
  const g = await authorize("STOCK_ADJUSTMENT_APPROVE", [await stockAdjustmentWarehouse(id)]);
  if (!g.ok) return g;
  return stockAdjustmentPreview(id, g.actor.user.id);
}

export async function transitionStockAdjustmentAction(id: number, action: StockAdjustmentAction, reason?: string): Promise<{ ok: true; message: string } | Denial> {
  const t = STOCK_ADJUSTMENT_TRANSITIONS[action];
  if (!t) return { ok: false, errors: { _form: "Aksi tidak dikenal." } };
  const g = await authorize(t.permission, [await stockAdjustmentWarehouse(id)]);
  if (!g.ok) return g;
  const result = await transitionStockAdjustment(id, action, g.actor.user.id, reason);
  if (!result.ok) return result;
  revalidatePath("/inventory/stock-adjustment", "layout");
  return { ok: true, message: t.done };
}
