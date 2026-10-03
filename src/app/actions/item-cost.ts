"use server";

import { revalidatePath } from "next/cache";
import { authorizeAction } from "@/lib/erp/auth";
import { isAccessDenied } from "@/lib/erp/auth-errors";
import { setItemCost, type ItemCostResult } from "@/lib/erp/inventory";

/** Harga Pokok (Sementara): the permission is checked here, the rules live in `lib/erp/inventory.ts`. */
export async function setItemCostAction(itemId: number, unitCost: string): Promise<ItemCostResult> {
  try {
    const actor = await authorizeAction("ITEM_COST_EDIT");
    const result = await setItemCost(itemId, unitCost, actor.user.id);
    if (result.ok) revalidatePath("/master/item-cost");
    return result;
  } catch (error) {
    if (isAccessDenied(error)) return { ok: false, errors: { _form: error.message } };
    throw error;
  }
}
