import "server-only";

import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import { nextDocumentNumber } from "./document-number";
import type { PeriodRange } from "./period";

/**
 * Production cost (P150, `production_project.md` E4, §21d) — a book.
 *
 * Labour and overhead are booked under **Elemen Biaya Produksi** — a kind of
 * production cost the user names, with the account it posts to (M53), as a
 * Jenis PPh or a Cash & Bank names its account. Every line on that account is
 * production cost (M40), and several elements may share one account (M61).
 *
 * **The cost ledger is the source of truth**, as the Cash Bank Book and the
 * stock books are for theirs (M60): the period close reads it, never the GL.
 * It is append-only and dated, with no period column (M23) — a period is a
 * range of dates. It is written only here, inside the posting of the document
 * that books the cost (the Tagihan Biaya Produksi today), and every posting
 * takes one ledger number `BBP/…` shared by its rows (P110). Nothing checks
 * the Control Account mark (M55): keeping other postings off an element's
 * account is the user's guard. The reports read this book alone (P152); a
 * difference with the GL is a warning in `db:reconcile` only, as for the other
 * books (M67).
 *
 * A book: it imports only the shared kernel and is called by documents.
 * Named only by this module (`prd_cost_ledger`, `acc_production_cost_element`
 * apart from the registry).
 */

type Db = Prisma.TransactionClient | typeof prisma;
type Tx = Prisma.TransactionClient;
const D = Prisma.Decimal;

/** A cost the book refuses — an unknown or inactive element, a fraction of a rupiah. */
export class CostLedgerRefusal extends Error {}

export type CostSource = { docTypeId: number; docId: number; no: string };

export type ElementInfo = { id: number; label: string; name: string; accountId: number; accountLabel: string; accountName: string; active: boolean };

/** The elements by id, with the account each posts to. */
export async function elementsByIds(ids: number[], db: Db = prisma): Promise<Map<number, ElementInfo>> {
  const unique = [...new Set(ids.filter((id) => Number.isInteger(id) && id > 0))];
  if (!unique.length) return new Map();
  const rows = await db.accProductionCostElement.findMany({
    where: { id: { in: unique } },
    include: { account: { select: { account_label: true, account_name: true } } },
  });
  return new Map(
    rows.map((e) => [
      e.id,
      {
        id: e.id,
        label: e.element_label,
        name: e.element_name,
        accountId: e.account_id,
        accountLabel: e.account.account_label,
        accountName: e.account.account_name,
        active: e.status === "Active",
      },
    ])
  );
}

/** Every element, active first, for pickers and report filters. */
export async function elementOptions(db: Db = prisma): Promise<ElementInfo[]> {
  const rows = await db.accProductionCostElement.findMany({
    include: { account: { select: { account_label: true, account_name: true } } },
    orderBy: { element_label: "asc" },
  });
  return rows.map((e) => ({
    id: e.id,
    label: e.element_label,
    name: e.element_name,
    accountId: e.account_id,
    accountLabel: e.account.account_label,
    accountName: e.account.account_name,
    active: e.status === "Active",
  }));
}

/** The elements naming this account — read before the account is deactivated. */
export async function elementsUsingAccount(accountId: number, db: Db = prisma): Promise<string[]> {
  const rows = await db.accProductionCostElement.findMany({ where: { account_id: accountId }, select: { element_label: true } });
  return rows.map((r) => r.element_label);
}

// ----------------------------------------------------------------- writes

/** The posting's ledger number (P110): one per document, a line per row. */
async function ledgerPosition(db: Db, date: Date, source: CostSource): Promise<{ ledger_no: string; line_no: number }> {
  const last = await db.prdCostLedger.findFirst({
    where: { source_doc_type_id: source.docTypeId, source_doc_id: source.docId },
    orderBy: { line_no: "desc" },
    select: { ledger_no: true, line_no: true },
  });
  if (last) return { ledger_no: last.ledger_no, line_no: last.line_no + 1 };
  const ledger_no = await nextDocumentNumber("BBP", date, async (series) => {
    const row = await db.prdCostLedger.findFirst({ where: { ledger_no: { startsWith: series }, line_no: 1 }, orderBy: { id: "desc" }, select: { ledger_no: true } });
    return row?.ledger_no ?? null;
  });
  return { ledger_no, line_no: 1 };
}

export type CostIn = { elementId: number; amount: number | string; note?: string | null };

/**
 * Books production cost: one `In` row per entry, dated, naming its element and
 * the element's account. Called inside the booking document's posting, so a
 * refusal rolls the posting back. An amount is whole rupiah and above 0.
 */
export async function recordCost(tx: Tx, input: { date: Date; source: CostSource; rows: CostIn[]; actorId: number }): Promise<void> {
  const elements = await elementsByIds(input.rows.map((r) => r.elementId), tx);
  for (const r of input.rows) {
    const e = elements.get(r.elementId);
    if (!e) throw new CostLedgerRefusal("Elemen Biaya Produksi tidak ditemukan.");
    if (!e.active) throw new CostLedgerRefusal(`Elemen Biaya Produksi ${e.label} sudah nonaktif.`);
    const amount = new D(r.amount);
    if (!amount.gt(0) || !amount.isInteger()) throw new CostLedgerRefusal(`Biaya ${e.label} harus rupiah penuh, lebih dari 0.`);
    await tx.prdCostLedger.create({
      data: {
        ...(await ledgerPosition(tx, input.date, input.source)),
        posting_date: input.date,
        source_doc_type_id: input.source.docTypeId,
        source_doc_id: input.source.docId,
        source_no: input.source.no,
        element_id: e.id,
        account_id: e.accountId,
        kind: "In",
        amount,
        note: r.note ?? null,
        created_by: input.actorId,
      },
    });
  }
}

// ------------------------------------------------------------------ reads

export type CostRowKind = "In" | "Absorbed" | "CarriedOut" | "CarriedIn" | "ExpensedToPL";

export const COST_ROW_KIND_TEXT: Record<CostRowKind, string> = {
  In: "Biaya dicatat",
  Absorbed: "Dibebankan ke produk",
  CarriedOut: "Dibawa ke bulan berikut",
  CarriedIn: "Dibawa dari bulan lalu",
  ExpensedToPL: "Dibebankan ke Laba Rugi",
};

export type CostLedgerRow = {
  id: number;
  ledgerNo: string;
  lineNo: number;
  date: string;
  elementId: number;
  kind: CostRowKind;
  amount: number;
  note: string | null;
  source: { docTypeId: number; docId: number; no: string };
};

const iso = (d: Date) => d.toISOString().slice(0, 10);
const inRange = (range: PeriodRange) => ({ gte: new Date(`${range.from}T00:00:00Z`), lte: new Date(`${range.to}T00:00:00Z`) });

/** The cost ledger's rows dated in a range, oldest first — Buku Biaya Produksi. */
export async function costLedgerRows(range: PeriodRange, elementIds: number[] = []): Promise<CostLedgerRow[]> {
  const rows = await prisma.prdCostLedger.findMany({
    where: { posting_date: inRange(range), ...(elementIds.length ? { element_id: { in: elementIds } } : {}) },
    orderBy: [{ posting_date: "asc" }, { id: "asc" }],
  });
  return rows.map((r) => ({
    id: r.id,
    ledgerNo: r.ledger_no,
    lineNo: r.line_no,
    date: iso(r.posting_date),
    elementId: r.element_id,
    kind: r.kind,
    amount: r.amount.toNumber(),
    note: r.note,
    source: { docTypeId: r.source_doc_type_id, docId: r.source_doc_id, no: r.source_no },
  }));
}

export type CostBalanceRow = {
  elementId: number;
  /** Per kind, signed as stored. */
  byKind: Record<CostRowKind, number>;
  /** What the range leaves on the element: Σ every row. */
  total: number;
};

/** Each element's rows in a range summed by kind — Saldo Biaya Produksi. */
export async function costBalances(range: PeriodRange, elementIds: number[] = []): Promise<CostBalanceRow[]> {
  const rows = await prisma.prdCostLedger.groupBy({
    by: ["element_id", "kind"],
    where: { posting_date: inRange(range), ...(elementIds.length ? { element_id: { in: elementIds } } : {}) },
    _sum: { amount: true },
  });
  const out = new Map<number, CostBalanceRow>();
  for (const r of rows) {
    const row =
      out.get(r.element_id) ??
      ({ elementId: r.element_id, byKind: { In: 0, Absorbed: 0, CarriedOut: 0, CarriedIn: 0, ExpensedToPL: 0 }, total: 0 } as CostBalanceRow);
    const v = r._sum.amount?.toNumber() ?? 0;
    row.byKind[r.kind] += v;
    row.total += v;
    out.set(r.element_id, row);
  }
  return [...out.values()];
}

/** A document's own cost rows — for its page and the reconcile. */
export async function costRowsOfDocument(source: { docTypeId: number; docId: number }, db: Db = prisma): Promise<CostLedgerRow[]> {
  const rows = await db.prdCostLedger.findMany({ where: { source_doc_type_id: source.docTypeId, source_doc_id: source.docId }, orderBy: { line_no: "asc" } });
  return rows.map((r) => ({
    id: r.id,
    ledgerNo: r.ledger_no,
    lineNo: r.line_no,
    date: iso(r.posting_date),
    elementId: r.element_id,
    kind: r.kind,
    amount: r.amount.toNumber(),
    note: r.note,
    source: { docTypeId: r.source_doc_type_id, docId: r.source_doc_id, no: r.source_no },
  }));
}
