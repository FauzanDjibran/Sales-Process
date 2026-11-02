"use server";

import { revalidatePath } from "next/cache";
import { authorizeAction } from "@/lib/erp/auth";
import { isAccessDenied } from "@/lib/erp/auth-errors";
import { describeJournalLines, type JournalPreviewResult } from "@/lib/erp/journal";
import { runClose } from "@/lib/erp/production-close";

/** The write path of the month-end production close (P210); every rule is in `lib/erp/production-close.ts`. */

type Denied = { ok: false; errors: Record<string, string> };

function denied(error: unknown): Denied {
  if (isAccessDenied(error)) return { ok: false, errors: { _form: error.message } };
  throw error;
}

/** The journal the close would write, for its dialog: a dry run, rolled back (P103). */
export async function previewCostCloseAction(periodId: number): Promise<JournalPreviewResult> {
  let userId: number;
  try {
    userId = (await authorizeAction("PRODUCTION_COST_CLOSE_RUN")).user.id;
  } catch (error) {
    return denied(error);
  }
  const r = await runClose(periodId, userId, { dryRun: true });
  if (!r.ok) return r;
  return { ok: true, lines: await describeJournalLines(r.journal) };
}

export async function runCostCloseAction(periodId: number): Promise<{ ok: true; message: string } | Denied> {
  let userId: number;
  try {
    userId = (await authorizeAction("PRODUCTION_COST_CLOSE_RUN")).user.id;
  } catch (error) {
    return denied(error);
  }
  const r = await runClose(periodId, userId);
  if (!r.ok) return r;
  // The period is locked: every production and stock page reads it again.
  revalidatePath("/production", "layout");
  revalidatePath("/inventory", "layout");
  return { ok: true, message: "Biaya periode ditutup" };
}
