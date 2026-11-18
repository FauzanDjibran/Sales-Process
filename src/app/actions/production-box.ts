"use server";

import { revalidatePath } from "next/cache";
import { authorizeAction } from "@/lib/erp/auth";
import { isAccessDenied } from "@/lib/erp/auth-errors";
import { assertUnit } from "@/lib/erp/production-access";
import { closeBox, type BoxInput, type BoxResult } from "@/lib/erp/production-box";

/** Tutup Kotak (P284): the permission and the Unit here, the rules in the module. */
export async function closeBoxAction(input: BoxInput): Promise<BoxResult> {
  try {
    const actor = await authorizeAction("PRODUCTION_BOX_POST");
    if (input.unit_id) await assertUnit(actor, Number(input.unit_id));
    const result = await closeBox(input, actor.user.id);
    if (result.ok) {
      revalidatePath("/production/box");
      revalidatePath("/production/workspace", "layout");
    }
    return result;
  } catch (error) {
    if (isAccessDenied(error)) return { ok: false, errors: { _form: error.message } };
    throw error;
  }
}
