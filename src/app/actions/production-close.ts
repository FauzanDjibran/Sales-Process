"use server";

import { revalidatePath } from "next/cache";
import { authorizeAction } from "@/lib/erp/auth";
import { isAccessDenied } from "@/lib/erp/auth-errors";
import { describeJournalLines, type JournalPreviewResult } from "@/lib/erp/journal";
import { runClose } from "@/lib/erp/production-close";

/** The write path of the month-end production costing (P172); every rule is in `lib/erp/production-close.ts`. */

type Denied = { ok: false; errors: Record<string, string> };

async function allowed(): Promise<{ ok: true; userId: number } | Denied> {
  try {
    return { ok: true, userId: (await authorizeAction("PRODUCTION_COST_CLOSE_RUN")).user.id };
  } catch (error) {
    if (isAccessDenied(error)) return { ok: false, errors: { _form: error.message } };
    throw error;
  }
}

/** The journal the close would write, for its dialog: a dry run, rolled back (P103). */
export async function previewCostCloseAction(periodId: number): Promise<JournalPreviewResult> {
  const g = await allowed();
  if (!g.ok) return g;
  const r = await runClose(periodId, g.userId, { dryRun: true });
  if (!r.ok) return r;
  return { ok: true, lines: await describeJournalLines(r.journal) };
}

export async function runCostCloseAction(periodId: number): Promise<{ ok: true; message: string } | Denied> {
  const g = await allowed();
  if (!g.ok) return g;
  const r = await runClose(periodId, g.userId);
  if (!r.ok) return r;
  revalidatePath("/production/cost-close", "layout");
  // The period is locked: every stock, production and cost page reads it again.
  revalidatePath("/production", "layout");
  revalidatePath("/inventory", "layout");
  return { ok: true, message: "Biaya periode ditutup" };
}
