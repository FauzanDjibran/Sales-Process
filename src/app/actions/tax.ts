"use server";

import { revalidatePath } from "next/cache";
import { type Actor } from "@/lib/erp/access";
import { authorizeAction } from "@/lib/erp/auth";
import { isAccessDenied } from "@/lib/erp/auth-errors";
import { recordSlipReceived, setFakturNsfp, type TaxResult } from "@/lib/erp/tax-document";

/**
 * The tax module's write path (P100, P101): the two references a user keeps on
 * the tax records. Making one is the postings' job, never an action of its own. The
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

/** *Isi NSFP* / *Ubah NSFP*: the Coretax reference of a faktur, and optionally its upload date. */
export async function setFakturNsfpAction(id: number, input: { nsfp: string; date: string }): Promise<TaxResult> {
  const g = await authorize("TAX_FAKTUR_EDIT");
  if (!g.ok) return g.denial;
  const result = await setFakturNsfp(id, input, g.actor.user.id);
  if (result.ok) revalidate();
  return result;
}

/** *Catat Bukti Potong* / *Ubah*: the BPPU's number and date, as the customer issued it. */
export async function recordSlipReceivedAction(id: number, input: { number: string; date: string }): Promise<TaxResult> {
  const g = await authorize("TAX_SLIP_RECEIVE");
  if (!g.ok) return g.denial;
  const result = await recordSlipReceived(id, input, g.actor.user.id);
  if (result.ok) revalidate();
  return result;
}
