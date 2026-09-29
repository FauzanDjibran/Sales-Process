"use server";

import { revalidatePath } from "next/cache";
import { type Actor } from "@/lib/erp/access";
import { authorizeAction } from "@/lib/erp/auth";
import { isAccessDenied } from "@/lib/erp/auth-errors";
import {
  JOURNAL_TRANSITIONS,
  type JournalAction,
} from "@/lib/erp/journal-workflow";
import {
  cancelManualJournal,
  createManualJournal,
  postManualJournal,
  updateManualJournal,
  type ManualJournalLineValues,
} from "@/lib/erp/manual-journal";

/**
 * The manual journal's write path — the only way a person puts a line in the
 * books by hand.
 *
 * Two things are enforced here and nowhere that matters less:
 *
 *  1. **The permission**, which is its own capability: seeing journals and
 *     writing one are different rights, and posting one is different again.
 *  2. **The rules**, in `lib/erp/manual-journal.ts` — which account may be
 *     written to, which line needs a Partner, which line needs a kurs. They
 *     live there rather than here so the test suite can exercise them: an
 *     action resolves its caller from a session cookie and a test has none.
 *
 * The balance and the posting date are not enforced here at all. They belong to
 * the posting engine, which every journal in this application goes through.
 */

export type JournalHeaderValues = {
  /** `YYYY-MM-DD` — the day the journal belongs to in the books. */
  journal_date: string;
  description: string;
};

export type JournalLineValues = {
  account_id: string;
  partner_id: string;
  currency_id: string;
  exchange_rate: string;
  debit: string;
  credit: string;
  description: string;
};

export type JournalResult =
  | { ok: true; id: number; journalNo: string }
  | { ok: false; errors: Record<string, string> };

type Guard =
  | { ok: true; actor: Actor }
  | { ok: false; denial: { ok: false; errors: Record<string, string> } };

/** Refusals come back as a `_form` error, and never name the permission code. */
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

const num = (raw: string | null | undefined): number | null => {
  const v = String(raw ?? "").trim();
  if (v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** A kurs and an amount both carry decimals, unlike a row id. */
const decimal = (raw: string | null | undefined): number => {
  const v = String(raw ?? "").trim();
  if (v === "") return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const asLines = (lines: JournalLineValues[]): ManualJournalLineValues[] =>
  lines
    // A row the user added and never filled in is not a line. Dropping it here
    // is what lets the editor keep an empty row at the bottom without every
    // save complaining about it.
    .filter(
      (l) =>
        num(l.account_id) !== null ||
        decimal(l.debit) > 0 ||
        decimal(l.credit) > 0
    )
    .map((l) => ({
      account_id: num(l.account_id),
      partner_id: num(l.partner_id),
      currency_id: num(l.currency_id),
      exchange_rate: num(l.exchange_rate),
      debit: decimal(l.debit),
      credit: decimal(l.credit),
      description: l.description ?? "",
    }));

export async function createJournal(
  header: JournalHeaderValues,
  lines: JournalLineValues[]
): Promise<JournalResult> {
  const g = await authorize("JOURNAL_CREATE");
  if (!g.ok) return g.denial;

  const result = await createManualJournal(
    {
      journal_date: header.journal_date,
      description: header.description,
    },
    asLines(lines),
    g.actor.user.id
  );
  if (result.ok) revalidateJournal(result.id);
  return result;
}

export async function updateJournal(
  id: number,
  header: JournalHeaderValues,
  lines: JournalLineValues[]
): Promise<JournalResult> {
  const g = await authorize("JOURNAL_EDIT");
  if (!g.ok) return g.denial;

  const result = await updateManualJournal(
    id,
    {
      journal_date: header.journal_date,
      description: header.description,
    },
    asLines(lines),
    g.actor.user.id
  );
  if (result.ok) revalidateJournal(id);
  return result;
}

export type JournalTransitionResult =
  | { ok: true; message: string }
  | { ok: false; errors: Record<string, string> };

/**
 * Runs one lifecycle transition.
 *
 * `post` is the boundary: before it the journal is a draft nothing can see,
 * after it the General Ledger reads it and it can never be taken back.
 */
export async function transitionJournal(
  id: number,
  action: JournalAction
): Promise<JournalTransitionResult> {
  const transition = JOURNAL_TRANSITIONS[action];
  if (!transition) return { ok: false, errors: { _form: "Aksi tidak dikenal." } };

  const g = await authorize(transition.permission);
  if (!g.ok) return g.denial;

  const result =
    action === "post"
      ? await postManualJournal(id, g.actor.user.id)
      : await cancelManualJournal(id, g.actor.user.id);

  if (!result.ok) return { ok: false, errors: result.errors };

  revalidateJournal(id);
  return { ok: true, message: transition.done };
}

function revalidateJournal(id: number) {
  revalidatePath("/accounting/journal");
  revalidatePath(`/accounting/journal/${id}`);
  // A posted journal is immediately part of both ledger reports, and the
  // dashboard reads the same lines for its standing positions.
  revalidatePath("/accounting/report/general-ledger");
  revalidatePath("/accounting/report/trial-balance");
  revalidatePath("/dashboard");
}
