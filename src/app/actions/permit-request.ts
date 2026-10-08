"use server";

import { revalidatePath } from "next/cache";
import { type Actor } from "@/lib/erp/access";
import { authorizeAction } from "@/lib/erp/auth";
import { isAccessDenied } from "@/lib/erp/auth-errors";
import {
  createPermitRequest,
  saveRealization,
  transitionPermitRequest,
  updatePermitRequest,
  type PermitRealizationInput,
  type PermitRequestHeaderInput,
  type PermitRequestLineInput,
  type PermitRequestResult,
} from "@/lib/erp/permit-request";
import { PERMIT_REQUEST_TRANSITIONS, type PermitRequestAction } from "@/lib/erp/permit-request-workflow";
import { liveAdvanceRefusal } from "@/lib/erp/permit-advance";
import { permitCostPayments } from "@/lib/erp/cash-payment";
import { permitInvoiceOfRequest } from "@/lib/erp/permit-invoice";
import type { Prisma } from "@/generated/prisma/client";

/** Why the realisation may no longer change (Z8), or null. */
async function realizationLockRefusal(tx: Prisma.TransactionClient, id: number): Promise<string | null> {
  const paid = await permitCostPayments(id, tx);
  if (paid.length) return `Biaya perizinan sudah dibayar (${paid.map((p) => p.txNo).join(", ")}); realisasi tidak dapat diubah.`;
  const invoice = await permitInvoiceOfRequest(id, tx);
  return invoice ? `Realisasi sudah ditagih dengan ${invoice.invoiceNo}; realisasi tidak dapat diubah.` : null;
}

/**
 * The Pengajuan Perizinan's write path. The permission is checked here; every
 * rule is in `lib/erp/permit-request.ts`, where the tests can reach it. Where
 * a step depends on another module's documents (an advance on it, an invoice
 * or a cost payment naming its realisation), the guard is composed here.
 */

type Guard =
  | { ok: true; actor: Actor }
  | { ok: false; denial: { ok: false; errors: Record<string, string> } };

async function authorize(code: string): Promise<Guard> {
  try {
    return { ok: true, actor: await authorizeAction(code) };
  } catch (error) {
    if (isAccessDenied(error)) return { ok: false, denial: { ok: false, errors: { _form: error.message } } };
    throw error;
  }
}

function revalidate(id?: number) {
  revalidatePath("/sales/permit");
  if (id) revalidatePath(`/sales/permit/${id}`);
}

export async function createPermitRequestAction(
  header: PermitRequestHeaderInput,
  lines: PermitRequestLineInput[]
): Promise<PermitRequestResult> {
  const g = await authorize("PERMIT_REQUEST_CREATE");
  if (!g.ok) return g.denial;
  const result = await createPermitRequest(header, lines, g.actor.user.id);
  if (result.ok) revalidate(result.id);
  return result;
}

export async function updatePermitRequestAction(
  id: number,
  header: PermitRequestHeaderInput,
  lines: PermitRequestLineInput[]
): Promise<PermitRequestResult> {
  const g = await authorize("PERMIT_REQUEST_EDIT");
  if (!g.ok) return g.denial;
  const result = await updatePermitRequest(id, header, lines, g.actor.user.id);
  if (result.ok) revalidate(id);
  return result;
}

export async function saveRealizationAction(id: number, input: PermitRealizationInput): Promise<PermitRequestResult> {
  const g = await authorize("PERMIT_REQUEST_REALIZE");
  if (!g.ok) return g.denial;
  const result = await saveRealization(id, input, g.actor.user.id, realizationLockRefusal);
  if (result.ok) revalidate(id);
  return result;
}

export type PermitRequestTransitionActionResult =
  | { ok: true; message: string }
  | { ok: false; errors: Record<string, string> };

export async function transitionPermitRequestAction(
  id: number,
  action: PermitRequestAction,
  reason?: string
): Promise<PermitRequestTransitionActionResult> {
  const transition = PERMIT_REQUEST_TRANSITIONS[action];
  if (!transition) return { ok: false, errors: { _form: "Aksi tidak dikenal." } };
  const g = await authorize(transition.permission);
  if (!g.ok) return g.denial;
  try {
    // Batalkan is refused while an Uang Muka Perizinan drawn from it is live (Z6);
    // the two modules meet here, not in each other.
    const guard = action === "cancel" ? liveAdvanceRefusal : undefined;
    const result = await transitionPermitRequest(id, action, g.actor.user.id, reason, guard);
    if (!result.ok) return result;
  } catch (error) {
    return { ok: false, errors: { _form: error instanceof Error ? error.message : "Gagal diproses." } };
  }
  revalidate(id);
  return { ok: true, message: transition.done };
}
