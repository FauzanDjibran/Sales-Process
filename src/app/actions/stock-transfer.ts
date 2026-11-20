"use server";

import { revalidatePath } from "next/cache";
import { type Actor } from "@/lib/erp/access";
import { authorizeAction } from "@/lib/erp/auth";
import { isAccessDenied } from "@/lib/erp/auth-errors";
import { assertWarehouse } from "@/lib/erp/warehouse-access";
import {
  createStockTransfer,
  stockTransferWarehouses,
  transitionStockTransfer,
  updateStockTransfer,
  type StockTransferHeaderInput,
  type StockTransferLineInput,
  type StockTransferResult,
} from "@/lib/erp/stock-transfer";
import {
  createTransferReceipt,
  transferDestinationOf,
  transferReceiptWarehouse,
  transitionTransferReceipt,
  updateTransferReceipt,
  type TransferReceiptHeaderInput,
  type TransferReceiptLineInput,
  type TransferReceiptResult,
} from "@/lib/erp/stock-transfer-receipt";
import {
  STOCK_TRANSFER_RECEIPT_TRANSITIONS,
  STOCK_TRANSFER_TRANSITIONS,
  type StockTransferAction,
  type StockTransferReceiptAction,
} from "@/lib/erp/stock-transfer-workflow";

/**
 * The write path of Transfer Kirim and Transfer Terima (P300). The permission
 * and the warehouse (OD-9) are checked here — Kirim on the origin, Terima on
 * the destination; every rule is in the two lib modules, where the tests reach it.
 */

type Denial = { ok: false; errors: Record<string, string> };

async function authorize(code: string, warehouseId?: number | null): Promise<{ ok: true; actor: Actor } | Denial> {
  try {
    const actor = await authorizeAction(code);
    if (warehouseId !== undefined) await assertWarehouse(actor, warehouseId);
    return { ok: true, actor };
  } catch (error) {
    if (isAccessDenied(error)) return { ok: false, errors: { _form: error.message } };
    throw error;
  }
}

function revalidate() {
  revalidatePath("/inventory/stock-transfer");
  revalidatePath("/inventory/stock-transfer-receipt");
}

// ------------------------------------------------------------- Transfer Kirim

export async function createStockTransferAction(header: StockTransferHeaderInput, lines: StockTransferLineInput[]): Promise<StockTransferResult> {
  const g = await authorize("STOCK_TRANSFER_CREATE", Number(header.from_warehouse_id) || null);
  if (!g.ok) return g;
  const result = await createStockTransfer(header, lines, g.actor.user.id);
  if (result.ok) revalidate();
  return result;
}

export async function updateStockTransferAction(id: number, header: StockTransferHeaderInput, lines: StockTransferLineInput[]): Promise<StockTransferResult> {
  const stored = await stockTransferWarehouses(id);
  // Both the stored origin and a new one must be the user's.
  const g = await authorize("STOCK_TRANSFER_EDIT", stored?.fromId ?? null);
  if (!g.ok) return g;
  const again = await authorize("STOCK_TRANSFER_EDIT", Number(header.from_warehouse_id) || null);
  if (!again.ok) return again;
  const result = await updateStockTransfer(id, header, lines, g.actor.user.id);
  if (result.ok) revalidate();
  return result;
}

export type TransferTransitionActionResult = { ok: true; message: string } | Denial;

export async function transitionStockTransferAction(id: number, action: StockTransferAction, reason?: string): Promise<TransferTransitionActionResult> {
  const t = STOCK_TRANSFER_TRANSITIONS[action];
  if (!t) return { ok: false, errors: { _form: "Aksi tidak dikenal." } };
  const stored = await stockTransferWarehouses(id);
  const g = await authorize(t.permission, stored?.fromId ?? null);
  if (!g.ok) return g;
  try {
    const result = await transitionStockTransfer(id, action, g.actor.user.id, reason);
    if (!result.ok) return result;
  } catch (error) {
    return { ok: false, errors: { _form: error instanceof Error ? error.message : "Gagal diproses." } };
  }
  revalidate();
  return { ok: true, message: t.done };
}

// ------------------------------------------------------------ Transfer Terima

export async function createTransferReceiptAction(header: TransferReceiptHeaderInput, lines: TransferReceiptLineInput[]): Promise<TransferReceiptResult> {
  const g = await authorize("STOCK_TRANSFER_RECEIPT_CREATE", await transferDestinationOf(Number(header.stock_transfer_id) || null));
  if (!g.ok) return g;
  const result = await createTransferReceipt(header, lines, g.actor.user.id);
  if (result.ok) revalidate();
  return result;
}

export async function updateTransferReceiptAction(id: number, header: TransferReceiptHeaderInput, lines: TransferReceiptLineInput[]): Promise<TransferReceiptResult> {
  const g = await authorize("STOCK_TRANSFER_RECEIPT_EDIT", await transferReceiptWarehouse(id));
  if (!g.ok) return g;
  const result = await updateTransferReceipt(id, header, lines, g.actor.user.id);
  if (result.ok) revalidate();
  return result;
}

export async function transitionTransferReceiptAction(id: number, action: StockTransferReceiptAction, reason?: string): Promise<TransferTransitionActionResult> {
  const t = STOCK_TRANSFER_RECEIPT_TRANSITIONS[action];
  if (!t) return { ok: false, errors: { _form: "Aksi tidak dikenal." } };
  const g = await authorize(t.permission, await transferReceiptWarehouse(id));
  if (!g.ok) return g;
  try {
    const result = await transitionTransferReceipt(id, action, g.actor.user.id, reason);
    if (!result.ok) return result;
  } catch (error) {
    return { ok: false, errors: { _form: error instanceof Error ? error.message : "Gagal diproses." } };
  }
  revalidate();
  return { ok: true, message: t.done };
}
