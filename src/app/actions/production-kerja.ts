"use server";

import { revalidatePath } from "next/cache";
import { authorizeAction } from "@/lib/erp/auth";
import { isAccessDenied } from "@/lib/erp/auth-errors";
import { assertUnit, unitIdsOf } from "@/lib/erp/production-access";
import { closeKerja, startKerja, type KerjaInput, type KerjaResult } from "@/lib/erp/production-kerja";

/**
 * Mulai, Selesai and Batal Mulai of Kerja (P282). The permission and the Unit
 * are checked here; every rule is in the module, where the tests reach it.
 */

const denied = (error: unknown) => {
  if (isAccessDenied(error)) return { ok: false as const, errors: { _form: error.message } };
  throw error;
};

export async function startKerjaAction(input: KerjaInput): Promise<KerjaResult> {
  try {
    const actor = await authorizeAction("PRODUCTION_KERJA_START");
    if (input.unit_id) await assertUnit(actor, Number(input.unit_id));
    const result = await startKerja(input, actor.user.id);
    if (result.ok) {
      revalidatePath("/production/kerja");
      revalidatePath("/production/workspace", "layout");
    }
    return result;
  } catch (error) {
    return denied(error);
  }
}

export async function closeKerjaAction(bucketIds: number[], how: "finish" | "cancel", date: string): Promise<{ ok: true; message: string } | { ok: false; errors: Record<string, string> }> {
  try {
    const actor = await authorizeAction("PRODUCTION_KERJA_FINISH");
    const result = await closeKerja(bucketIds, how, date, actor.user.id, await unitIdsOf(actor));
    if (!result.ok) return result;
    revalidatePath("/production/kerja");
    revalidatePath("/production/workspace", "layout");
    return { ok: true, message: how === "finish" ? `${result.lines} No. Stok selesai dikerjakan` : `${result.lines} No. Stok kembali ke Persiapan` };
  } catch (error) {
    return denied(error);
  }
}
