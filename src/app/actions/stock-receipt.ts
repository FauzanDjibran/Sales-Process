"use server";

import { revalidatePath } from "next/cache";
import { type Actor } from "@/lib/erp/access";
import { authorizeAction } from "@/lib/erp/auth";
import { isAccessDenied } from "@/lib/erp/auth-errors";
import { assertWarehouse } from "@/lib/erp/warehouse-access";
import type { JournalPreviewResult } from "@/lib/erp/journal";
import { receiveStockReceipt, stockReceiptPreview, stockReceiptWarehouse, type ReceiveInput } from "@/lib/erp/stock-receipt";
import { STOCK_RECEIPT_PATH } from "@/lib/erp/stock-receipt-purposes";

/** Terima of a Stock Receipt (P317), on the receiving warehouse (OD-9). Every rule is in the module. */

type Denial = { ok: false; errors: Record<string, string> };

async function authorize(id: number): Promise<{ ok: true; actor: Actor } | Denial> {
  try {
    const actor = await authorizeAction("STOCK_RECEIPT_RECEIVE");
    await assertWarehouse(actor, await stockReceiptWarehouse(id));
    return { ok: true, actor };
  } catch (error) {
    if (isAccessDenied(error)) return { ok: false, errors: { _form: error.message } };
    throw error;
  }
}

export async function receiveStockReceiptAction(id: number, input: ReceiveInput): Promise<{ ok: true; message: string } | Denial> {
  const g = await authorize(id);
  if (!g.ok) return g;
  const result = await receiveStockReceipt(id, g.actor.user.id, input);
  if (!result.ok) return result;
  revalidatePath(STOCK_RECEIPT_PATH, "layout");
  revalidatePath("/production/workspace", "layout");
  return { ok: true, message: "Barang diterima di gudang" };
}

export async function previewStockReceiptAction(id: number, input: ReceiveInput): Promise<JournalPreviewResult> {
  const g = await authorize(id);
  if (!g.ok) return g;
  return stockReceiptPreview(id, g.actor.user.id, input);
}
