"use server";

import { revalidatePath } from "next/cache";
import { type Actor } from "@/lib/erp/access";
import { authorizeAction } from "@/lib/erp/auth";
import { isAccessDenied } from "@/lib/erp/auth-errors";
import { recordFakturUpload, recordSlipReceived, type TaxResult } from "@/lib/erp/tax-document";

/**
 * The tax module's write path (P100): the two things a user records on a tax
 * document. Making one is the postings' job, never an action of its own. The
 * permission is checked here; every rule is in `lib/erp/tax-document.ts`.
 */

type Guard =
  | { ok: true; actor: Actor }
  | { ok: false; denial: { ok: false; errors: Record<string, string> } };

async function authorize(code: string): Promise<Guard> {
  try {
    return { ok: true, actor: await authorizeAction(code) };
  } catch (error) {
    if (isAccessDenied(error)) {
      return { ok: false, denial: { ok: false, errors: { _form: error.message } } };
    }
    throw error;
  }
}

function revalidate() {
  revalidatePath("/tax", "layout");
  // The NSFP is shown on the Invoice and in the Uang Muka picker.
  revalidatePath("/sales/invoice", "layout");
}

/** *Catat Upload*: the NSFP Coretax gave and the day it was uploaded. */
export async function recordFakturUploadAction(id: number, input: { nsfp: string; date: string }): Promise<TaxResult> {
  const g = await authorize("TAX_FAKTUR_UPLOAD");
  if (!g.ok) return g.denial;
  const result = await recordFakturUpload(id, input, g.actor.user.id);
  if (result.ok) revalidate();
  return result;
}

/** *Catat Bukti Potong*: the BPPU's number and date, as the customer issued it. */
export async function recordSlipReceivedAction(id: number, input: { number: string; date: string }): Promise<TaxResult> {
  const g = await authorize("TAX_SLIP_RECEIVE");
  if (!g.ok) return g.denial;
  const result = await recordSlipReceived(id, input, g.actor.user.id);
  if (result.ok) revalidate();
  return result;
}
