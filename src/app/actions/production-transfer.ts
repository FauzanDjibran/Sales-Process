"use server";

import { revalidatePath } from "next/cache";
import { authorizeAction } from "@/lib/erp/auth";
import { isAccessDenied } from "@/lib/erp/auth-errors";
import { createTransfer, transitionTransfer, updateTransfer, type TransferInput, type TransferResult } from "@/lib/erp/production-transfer";
import { TRANSFER_WORKFLOW, type ProdDocAction } from "@/lib/erp/production-doc-workflow";

/**
 * The Production Transfer's write path (R7). The permission is checked here;
 * every rule is in `lib/erp/production-transfer.ts`, where the tests can reach it.
 */

const W = TRANSFER_WORKFLOW;

async function authorize<T>(code: string, run: (actorId: number) => Promise<T>): Promise<T | { ok: false; errors: Record<string, string> }> {
  try {
    const actor = await authorizeAction(code);
    return await run(actor.user.id);
  } catch (error) {
    if (isAccessDenied(error)) return { ok: false, errors: { _form: error.message } };
    throw error;
  }
}

function revalidate(id?: number) {
  revalidatePath(W.path);
  if (id) revalidatePath(`${W.path}/${id}`);
}

export async function createTransferAction(input: TransferInput): Promise<TransferResult> {
  const r = await authorize("PRODUCTION_TRANSFER_CREATE", (actor) => createTransfer(input, actor));
  if (r.ok) revalidate(r.id);
  return r;
}

export async function updateTransferAction(id: number, input: TransferInput): Promise<TransferResult> {
  const r = await authorize("PRODUCTION_TRANSFER_EDIT", (actor) => updateTransfer(id, input, actor));
  if (r.ok) revalidate(id);
  return r;
}


export async function transitionTransferAction(id: number, action: ProdDocAction, reason?: string): Promise<{ ok: true; message: string } | { ok: false; errors: Record<string, string> }> {
  const t = W.transitions[action];
  if (!t) return { ok: false, errors: { _form: "Aksi tidak dikenal." } };
  const r = await authorize(t.permission, async (actor) => {
    try {
      return await transitionTransfer(id, action, actor, reason);
    } catch (error) {
      return { ok: false as const, errors: { _form: error instanceof Error ? error.message : "Gagal diproses." } };
    }
  });
  if (!r.ok) return r;
  revalidate(id);
  return { ok: true, message: t.done };
}
