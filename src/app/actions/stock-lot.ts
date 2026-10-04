"use server";

import { revalidatePath } from "next/cache";
import { authorizeAction } from "@/lib/erp/auth";
import { isAccessDenied } from "@/lib/erp/auth-errors";
import { createStockLot, setStockLotActive, type ItemCostResult, type StockLotInput } from "@/lib/erp/inventory";

/** Lot (Sementara): the permission is checked here, the rules live in `lib/erp/inventory.ts`. */
export async function createStockLotAction(input: StockLotInput): Promise<ItemCostResult> {
  try {
    const actor = await authorizeAction("STOCK_LOT_EDIT");
    const result = await createStockLot(input, actor.user.id);
    if (result.ok) revalidatePath("/master/stock-lot");
    return result;
  } catch (error) {
    if (isAccessDenied(error)) return { ok: false, errors: { _form: error.message } };
    throw error;
  }
}

export async function setStockLotActiveAction(id: number, active: boolean): Promise<ItemCostResult> {
  try {
    const actor = await authorizeAction("STOCK_LOT_EDIT");
    const result = await setStockLotActive(id, active, actor.user.id);
    if (result.ok) revalidatePath("/master/stock-lot");
    return result;
  } catch (error) {
    if (isAccessDenied(error)) return { ok: false, errors: { _form: error.message } };
    throw error;
  }
}
