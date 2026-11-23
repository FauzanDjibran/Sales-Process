"use server";

import { revalidatePath } from "next/cache";
import { type Actor } from "@/lib/erp/access";
import { authorizeAction } from "@/lib/erp/auth";
import { isAccessDenied } from "@/lib/erp/auth-errors";
import { assertUnit } from "@/lib/erp/production-access";
import { assertWarehouse } from "@/lib/erp/warehouse-access";
import type { JournalPreviewResult } from "@/lib/erp/journal";
import { productionReceiptPreview, productionReceiptWarehouse, receiveFinishGoods, sendFinishGoods, type FinishGoodsInput, type FinishGoodsResult } from "@/lib/erp/production-receipt";
import { PRODUCTION_RECEIPT_PURPOSES, type ProductionValueMode } from "@/lib/erp/production-receipt-shape";

/**
 * BSTB ke Finish Goods (P303): Kirim on the sending Unit (P260), Terima on the
 * receiving warehouse (OD-9). Every rule is in the module.
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

export async function sendFinishGoodsAction(input: FinishGoodsInput): Promise<FinishGoodsResult> {
  const g = await authorize("PRODUCTION_RECEIPT_SEND", (actor) => assertUnit(actor, Number(input.from_unit_id) || 0));
  if (!g.ok) return g;
  const result = await sendFinishGoods(input, g.actor.user.id);
  if (result.ok) {
    revalidatePath(PRODUCTION_RECEIPT_PURPOSES[input.purpose === "return" ? "return" : "finish_goods"].path);
    revalidatePath("/production/workspace", "layout");
  }
  return result;
}

export async function receiveFinishGoodsAction(id: number, valueMode?: ProductionValueMode | null): Promise<{ ok: true; message: string } | Denial> {
  const g = await authorize("PRODUCTION_RECEIPT_RECEIVE", async (actor) => assertWarehouse(actor, await productionReceiptWarehouse(id)));
  if (!g.ok) return g;
  const result = await receiveFinishGoods(id, g.actor.user.id, { valueMode });
  if (!result.ok) return result;
  for (const p of Object.values(PRODUCTION_RECEIPT_PURPOSES)) revalidatePath(p.path, "layout");
  revalidatePath("/production/workspace", "layout");
  return { ok: true, message: "Barang diterima di gudang" };
}

export async function previewFinishGoodsAction(id: number, valueMode?: ProductionValueMode | null): Promise<JournalPreviewResult> {
  const g = await authorize("PRODUCTION_RECEIPT_RECEIVE", async (actor) => assertWarehouse(actor, await productionReceiptWarehouse(id)));
  if (!g.ok) return g;
  return productionReceiptPreview(id, g.actor.user.id, valueMode);
}
