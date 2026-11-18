"use server";

import { revalidatePath } from "next/cache";
import { authorizeAction } from "@/lib/erp/auth";
import { isAccessDenied } from "@/lib/erp/auth-errors";
import { assertUnit } from "@/lib/erp/production-access";
import { postJobOrder, type JobOrderInput, type JobOrderResult } from "@/lib/erp/production-job-order";

/** Posting a Job Order (P283): the permission and the Unit here, the rules in the module. */
export async function postJobOrderAction(input: JobOrderInput): Promise<JobOrderResult> {
  try {
    const actor = await authorizeAction("PRODUCTION_JOB_ORDER_POST");
    if (input.unit_id) await assertUnit(actor, Number(input.unit_id));
    const result = await postJobOrder(input, actor.user.id);
    if (result.ok) {
      revalidatePath("/production/job-order");
      revalidatePath("/production/workspace", "layout");
    }
    return result;
  } catch (error) {
    if (isAccessDenied(error)) return { ok: false, errors: { _form: error.message } };
    throw error;
  }
}
