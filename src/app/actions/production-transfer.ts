"use server";

import { revalidatePath } from "next/cache";
import { type Actor } from "@/lib/erp/access";
import { authorizeAction } from "@/lib/erp/auth";
import { isAccessDenied } from "@/lib/erp/auth-errors";
import { assertUnit } from "@/lib/erp/production-access";
import { receiveTransfer, sendTransfer, transferUnits, type TransferInput, type TransferResult } from "@/lib/erp/production-transfer";
import { TRANSFER_PATH } from "@/lib/erp/production-transfer-shape";

/**
 * Send and receive Push and BSTB (P277). The permission and the Unit are
 * checked here; every rule is in the module, where the tests can reach it.
 */

type Guard = { ok: true; actor: Actor } | { ok: false; denial: { ok: false; errors: Record<string, string> } };

async function authorize(code: string, units: () => Promise<(number | null | undefined)[]>): Promise<Guard> {
  try {
    const actor = await authorizeAction(code);
    for (const unitId of await units()) if (unitId != null) await assertUnit(actor, unitId);
    return { ok: true, actor };
  } catch (error) {
    if (isAccessDenied(error)) return { ok: false, denial: { ok: false, errors: { _form: error.message } } };
    throw error;
  }
}

/** Kirim: a Push is posted at once, a BSTB is submitted. The sending Unit is the actor's. */
export async function sendTransferAction(input: TransferInput): Promise<TransferResult> {
  const g = await authorize("PRODUCTION_TRANSFER_CREATE", async () => [Number(input.from_unit_id) || null]);
  if (!g.ok) return g.denial;
  const result = await sendTransfer(input, g.actor.user.id);
  if (result.ok) {
    revalidatePath(TRANSFER_PATH);
    revalidatePath("/production/workspace", "layout");
  }
  return result;
}

/** Terima: the receiving Unit's, so its Unit is the one checked. */
export async function receiveTransferAction(id: number): Promise<{ ok: true; message: string } | { ok: false; errors: Record<string, string> }> {
  const g = await authorize("PRODUCTION_TRANSFER_RECEIVE", async () => [(await transferUnits(id))?.to]);
  if (!g.ok) return g.denial;
  const result = await receiveTransfer(id, g.actor.user.id);
  if (!result.ok) return result;
  revalidatePath(TRANSFER_PATH);
  revalidatePath(`${TRANSFER_PATH}/${id}`);
  revalidatePath("/production/workspace", "layout");
  return { ok: true, message: "BSTB diterima" };
}
