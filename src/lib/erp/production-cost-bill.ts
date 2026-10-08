import "server-only";

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { BASE_CURRENCY_LABEL } from "./currency";
import { nextDocumentNumber } from "./document-number";
import { checkTransactionDate } from "./fiscal";
import { PostingDryRun, describeJournalLines, postJournal, type JournalLineInput, type JournalPreviewResult } from "./journal";
import { CostLedgerRefusal, elementOptions, elementsByIds, recordCost } from "./production-cost";
import { checkAccountIsLeaf } from "./records";
import { fallbackAccounts } from "./system-settings";
import {
  COST_BILL_TRANSITIONS,
  costBillIsEditable,
  costBillTransitionAllowed,
  type CostBillAction,
  type CostBillStatus,
} from "./production-cost-bill-workflow";

/**
 * Tagihan Biaya Produksi (P150 M68, `production_project.md` §21d,
 * `prd_cost_bill(_line)`, `TBP/YYYY/MM/NNNN`).
 *
 * A production cost owed to a Supplier, recognised in the month it belongs to —
 * the mainstream two-step (a bill, then its payment): **Posting** writes Dr
 * each line's element account / Cr *Hutang Biaya Produksi*, dated the bill's
 * date, and one row per line in the cost ledger (`production-cost.ts`).
 *
 * **The credit side is never chosen on the bill** (P151): as SAP's vendor
 * reconciliation account, Business Central's vendor posting group and Odoo's
 * partner payable account, it comes from configuration — Account Mapping's
 * *Hutang Biaya Produksi* — so a bill cannot be posted somewhere it would never
 * be paid from. It is copied onto the bill at posting (`payable_account_id`).
 * Every posted bill keeps what it was paid (P132) and is paid by the
 * Pengeluaran purpose *Pembayaran Biaya Produksi*, which debits that same
 * account and writes no cost row — the cost was already recorded. Costs that
 * are never paid to a supplier (depreciation, accrued wages) wait for
 * Pencatatan Biaya Produksi (`production_project.md` §9.6).
 *
 * Named only by this module (`prd_cost_bill`, `prd_cost_bill_line`).
 */

type Db = Prisma.TransactionClient | typeof prisma;

export type CostBillLineInput = { element_id: number | string | null; amount: number | string | null; note?: string | null };

export type CostBillInput = {
  bill_date: string;
  partner_id: number | string | null;
  supplier_ref?: string | null;
  due_date?: string | null;
  description: string;
  note?: string | null;
};

export type CostBillResult = { ok: true; id: number; billNo: string } | { ok: false; errors: Record<string, string> };

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const asDate = (d: string) => new Date(`${d}T00:00:00Z`);
const isoDay = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "");
const lineKey = (i: number, f: string) => `lines.${i}.${f}`;

async function docTypeId(db: Db, table: string): Promise<number> {
  const row = await db.sysDocType.findFirst({ where: { doc_table: table }, select: { id: true } });
  if (!row) throw new Error(`Jenis dokumen ${table} belum terdaftar. Jalankan db:seed.`);
  return row.id;
}

/** The Account Mapping account that makes a bill payable, or null when unset. */
async function payableAccountId(): Promise<number | null> {
  return (await fallbackAccounts(["production_cost_payable_account"] as const)).production_cost_payable_account;
}

// ---------------------------------------------------------------- options

export type CostBillOptions = {
  suppliers: { id: number; label: string; name: string; active: boolean }[];
  elements: { id: number; label: string; name: string; accountLabel: string; accountName: string; active: boolean }[];
  /** Account Mapping's Hutang Biaya Produksi, shown read-only; null when unset. */
  payableAccount: { id: number; label: string; name: string } | null;
};

export async function costBillOptions(): Promise<CostBillOptions> {
  const [suppliers, elements, payable] = await Promise.all([
    prisma.mPartner.findMany({
      where: { category: { category_label: "Supplier" } },
      select: { id: true, partner_label: true, partner_name: true, status: true },
      orderBy: { partner_label: "asc" },
    }),
    elementOptions(),
    payableAccountId(),
  ]);
  const account = payable ? await prisma.accAccount.findUnique({ where: { id: payable }, select: { id: true, account_label: true, account_name: true } }) : null;
  return {
    suppliers: suppliers.map((p) => ({ id: p.id, label: p.partner_label, name: p.partner_name, active: p.status === "Active" })),
    elements: elements.map((e) => ({ id: e.id, label: e.label, name: e.name, accountLabel: e.accountLabel, accountName: e.accountName, active: e.active })),
    payableAccount: account ? { id: account.id, label: account.account_label, name: account.account_name } : null,
  };
}

// ------------------------------------------------------------- validation

export type CheckedCostBill = {
  data: {
    bill_date: Date;
    partner_id: number;
    supplier_ref: string | null;
    due_date: Date | null;
    description: string;
    note: string | null;
    total_amount: number;
  };
  lines: { line_no: number; element_id: number; amount: number; note: string | null }[];
};

/** Every rule a bill must satisfy to be saved — and, run again, to be posted. */
export async function checkCostBill(
  db: Db,
  input: CostBillInput,
  lines: CostBillLineInput[]
): Promise<{ ok: true; c: CheckedCostBill } | { ok: false; errors: Record<string, string> }> {
  const errors: Record<string, string> = {};
  const date = String(input.bill_date ?? "").trim();
  if (!DAY.test(date)) errors.bill_date = "Tanggal wajib diisi.";
  const description = String(input.description ?? "").trim();
  if (!description) errors.description = "Uraian wajib diisi.";

  const partnerId = Number(input.partner_id) || null;
  if (partnerId) {
    const p = await db.mPartner.findUnique({ where: { id: partnerId }, include: { category: true } });
    if (!p) errors.partner_id = "Partner tidak ditemukan.";
    else if (p.category.category_label !== "Supplier") errors.partner_id = "Pilih Supplier.";
    else if (p.status !== "Active") errors.partner_id = "Supplier tersebut sudah nonaktif.";
  } else errors.partner_id = "Pilih Supplier yang ditagihkan.";

  const due = String(input.due_date ?? "").trim();
  if (due && !DAY.test(due)) errors.due_date = "Tanggal tidak dikenali.";
  else if (due && DAY.test(date) && due < date) errors.due_date = "Jatuh tempo tidak boleh sebelum tanggal tagihan.";

  const raw = Array.isArray(lines) ? lines : [];
  if (!raw.length) errors._lines = "Tambahkan minimal satu baris biaya.";
  const elements = await elementsByIds(raw.map((l) => Number(l.element_id)), db);
  const out: CheckedCostBill["lines"] = [];
  for (const [i, l] of raw.entries()) {
    const e = elements.get(Number(l.element_id));
    if (!e) {
      errors[lineKey(i, "element_id")] = "Pilih Elemen Biaya Produksi.";
      continue;
    }
    if (!e.active) {
      errors[lineKey(i, "element_id")] = `${e.label} sudah nonaktif.`;
      continue;
    }
    const amount = Number(l.amount);
    if (!Number.isFinite(amount) || amount <= 0 || amount !== Math.round(amount)) {
      errors[lineKey(i, "amount")] = "Jumlah harus rupiah penuh, lebih dari 0.";
      continue;
    }
    out.push({ line_no: out.length + 1, element_id: e.id, amount, note: String(l.note ?? "").trim() || null });
  }
  if (!errors._lines && Object.keys(errors).some((k) => k.startsWith("lines."))) errors._lines = "Ada baris yang perlu diperbaiki.";
  if (Object.keys(errors).length) return { ok: false, errors };

  return {
    ok: true,
    c: {
      data: {
        bill_date: asDate(date),
        partner_id: partnerId!,
        supplier_ref: String(input.supplier_ref ?? "").trim() || null,
        due_date: due ? asDate(due) : null,
        description,
        note: String(input.note ?? "").trim() || null,
        total_amount: out.reduce((a, l) => a + l.amount, 0),
      },
      lines: out,
    },
  };
}

// ------------------------------------------------------------------ writes

async function nextBillNo(db: Db, date: Date): Promise<string> {
  return nextDocumentNumber("TBP", date, async (series) => {
    const row = await db.prdCostBill.findFirst({ where: { bill_no: { startsWith: series } }, orderBy: { id: "desc" }, select: { bill_no: true } });
    return row?.bill_no ?? null;
  });
}

async function audit(db: Db, id: number, action: "TAMBAH" | "UPDATE", event: string, by: number) {
  await db.auditLog.create({ data: { entity_key: "prd_cost_bill", row_id: id, action, event, by } });
}

async function writeLines(tx: Prisma.TransactionClient, id: number, c: CheckedCostBill) {
  await tx.prdCostBillLine.deleteMany({ where: { bill_id: id } });
  for (const l of c.lines) await tx.prdCostBillLine.create({ data: { ...l, bill_id: id } });
}

export async function createCostBill(input: CostBillInput, lines: CostBillLineInput[], actorId: number): Promise<CostBillResult> {
  const r = await checkCostBill(prisma, input, lines);
  if (!r.ok) return r;
  return prisma.$transaction(async (tx) => {
    const billNo = await nextBillNo(tx, r.c.data.bill_date);
    const row = await tx.prdCostBill.create({ data: { ...r.c.data, bill_no: billNo, created_by: actorId } });
    await writeLines(tx, row.id, r.c);
    await audit(tx, row.id, "TAMBAH", "create", actorId);
    return { ok: true as const, id: row.id, billNo };
  });
}

export async function updateCostBill(id: number, input: CostBillInput, lines: CostBillLineInput[], actorId: number): Promise<CostBillResult> {
  const current = await prisma.prdCostBill.findUnique({ where: { id }, select: { status: true, bill_no: true } });
  if (!current) return { ok: false, errors: { _form: "Tagihan tidak ditemukan." } };
  if (!costBillIsEditable(current.status as CostBillStatus)) return { ok: false, errors: { _form: "Hanya Draft yang dapat diubah." } };
  const r = await checkCostBill(prisma, input, lines);
  if (!r.ok) return r;
  return prisma.$transaction(async (tx) => {
    const done = await tx.prdCostBill.updateMany({ where: { id, status: "Draft" }, data: { ...r.c.data, updated_by: actorId } });
    if (done.count !== 1) return { ok: false as const, errors: { _form: "Tagihan berubah saat disimpan. Muat ulang halaman." } };
    await writeLines(tx, id, r.c);
    await audit(tx, id, "UPDATE", "update", actorId);
    return { ok: true as const, id, billNo: current.bill_no };
  });
}

class Refused extends Error {
  constructor(readonly errors: Record<string, string>) {
    super("refused");
  }
}

export type CostBillTransitionResult = { ok: true; journal?: JournalLineInput[] } | { ok: false; errors: Record<string, string> };

/**
 * Runs one lifecycle step. **Posting**, in one transaction: rechecks the bill,
 * writes the journal dated the bill's date — Dr each element's account per
 * line, Cr the Account Lawan for the total — and one cost-ledger row per line.
 * With `dryRun` it throws `PostingDryRun` after all of it, so the confirmation
 * shows exactly the journal Posting writes (P103). **Batalkan** (Draft) asks
 * for a reason.
 */
export async function transitionCostBill(
  id: number,
  action: CostBillAction,
  actorId: number,
  reason?: string,
  options: { dryRun?: boolean } = {}
): Promise<CostBillTransitionResult> {
  const b = await prisma.prdCostBill.findUnique({ where: { id }, include: { lines: { orderBy: { line_no: "asc" } } } });
  if (!b) return { ok: false, errors: { _form: "Tagihan tidak ditemukan." } };
  const t = COST_BILL_TRANSITIONS[action];
  if (!costBillTransitionAllowed(action, b.status as CostBillStatus)) {
    return { ok: false, errors: { _form: `Tagihan berstatus ini tidak dapat di-${t.label.toLowerCase()}.` } };
  }
  const moved = "Tagihan berubah saat diproses. Muat ulang halaman.";
  if (action === "cancel") {
    const why = String(reason ?? "").trim();
    if (!why) return { ok: false, errors: { reason: "Alasan wajib diisi." } };
    await prisma.$transaction(async (tx) => {
      const done = await tx.prdCostBill.updateMany({ where: { id, status: "Draft" }, data: { status: "Cancelled", cancel_reason: why, updated_by: actorId } });
      if (done.count !== 1) throw new Error(moved);
      await audit(tx, id, "UPDATE", "cancel", actorId);
    });
    return { ok: true };
  }

  const period = await checkTransactionDate(isoDay(b.bill_date));
  if (!period.ok) return { ok: false, errors: { _form: period.message } };
  const currency = await prisma.refCurrency.findFirst({ where: { currency_label: BASE_CURRENCY_LABEL }, select: { id: true } });
  if (!currency) return { ok: false, errors: { _form: "Mata uang dasar tidak ditemukan." } };

  try {
    let journalLines: JournalLineInput[] = [];
    await prisma.$transaction(async (tx) => {
      const input: CostBillInput = {
        bill_date: isoDay(b.bill_date),
        partner_id: b.partner_id,
        supplier_ref: b.supplier_ref,
        due_date: isoDay(b.due_date) || null,
        description: b.description,
        note: b.note,
      };
      const r = await checkCostBill(tx, input, b.lines.map((l) => ({ element_id: l.element_id, amount: l.amount.toString(), note: l.note })));
      if (!r.ok) {
        const first = Object.entries(r.errors).find(([k]) => !k.startsWith("_"))?.[1] ?? Object.values(r.errors)[0];
        throw new Refused({ _form: `Belum bisa diposting: ${first}` });
      }
      const elements = await elementsByIds(r.c.lines.map((l) => l.element_id), tx);
      // The credit side comes from Account Mapping, never the bill (P151).
      const payable = await payableAccountId();
      if (!payable) throw new Refused({ _form: "Belum bisa diposting: Account Hutang Biaya Produksi belum diatur di Account Mapping › Produksi." });
      const contra = await tx.accAccount.findUnique({ where: { id: payable }, select: { is_postable: true, is_active: true, require_partner: true } });
      if (!contra?.is_postable || !contra.is_active || (await checkAccountIsLeaf(payable))) {
        throw new Refused({ _form: "Belum bisa diposting: Account Hutang Biaya Produksi di Account Mapping harus aktif dan dapat diposting." });
      }
      if (r.c.lines.some((l) => elements.get(l.element_id)?.accountId === payable)) {
        throw new Refused({ _form: "Belum bisa diposting: account sebuah elemen sama dengan Account Hutang Biaya Produksi." });
      }
      const done = await tx.prdCostBill.updateMany({
        where: { id, status: "Draft" },
        data: { ...r.c.data, payable_account_id: payable, status: "Posted", updated_by: actorId },
      });
      if (done.count !== 1) throw new Refused({ _form: moved });

      const partnerOn = async (accountId: number) =>
        (await tx.accAccount.findUnique({ where: { id: accountId }, select: { require_partner: true } }))?.require_partner ? r.c.data.partner_id : null;
      const debits: JournalLineInput[] = [];
      for (const l of r.c.lines) {
        const e = elements.get(l.element_id)!;
        debits.push({
          accountId: e.accountId,
          partnerId: await partnerOn(e.accountId),
          currencyId: currency.id,
          rate: 1,
          debit: l.amount,
          credit: 0,
          description: `${e.label} — ${l.note ?? r.c.data.description}`,
        });
      }
      journalLines = [
        ...debits,
        {
          accountId: payable,
          partnerId: contra.require_partner ? r.c.data.partner_id : null,
          currencyId: currency.id,
          rate: 1,
          debit: 0,
          credit: r.c.data.total_amount,
          description: `${b.bill_no} · ${r.c.data.description}`,
        },
      ];
      const typeId = await docTypeId(tx, "prd_cost_bill");
      const journal = await postJournal(tx, {
        description: `${b.bill_no} · Tagihan Biaya Produksi — ${r.c.data.description}`,
        sourceDocTypeId: typeId,
        sourceDocId: id,
        postingDate: r.c.data.bill_date,
        actorId,
        lines: journalLines,
      });
      await recordCost(tx, {
        date: r.c.data.bill_date,
        source: { docTypeId: typeId, docId: id, no: b.bill_no },
        rows: r.c.lines.map((l) => ({ elementId: l.element_id, amount: l.amount, note: l.note ?? r.c.data.description })),
        actorId,
      });
      await tx.prdCostBill.update({ where: { id }, data: { journal_id: journal.id } });
      await audit(tx, id, "UPDATE", "post", actorId);
      if (options.dryRun) throw new PostingDryRun(journalLines);
    });
    return { ok: true, journal: journalLines };
  } catch (e) {
    if (e instanceof Refused) return { ok: false, errors: e.errors };
    if (e instanceof CostLedgerRefusal) return { ok: false, errors: { _form: `Belum bisa diposting: ${e.message}` } };
    if (e instanceof PostingDryRun) return { ok: true, journal: e.lines };
    throw e;
  }
}

/** The journal Posting would write, for the confirmation dialog (P103). */
export async function costBillPreview(id: number, actorId: number): Promise<JournalPreviewResult> {
  try {
    const r = await transitionCostBill(id, "post", actorId, undefined, { dryRun: true });
    if (!r.ok) return r;
    return { ok: true, lines: await describeJournalLines(r.journal ?? []) };
  } catch (e) {
    if (e instanceof Error) return { ok: false, errors: { _form: e.message } };
    throw e;
  }
}

// ------------------------------------------------------------------- reads

export type CostBillListRow = {
  id: number;
  billNo: string;
  billDate: string;
  description: string;
  partnerLabel: string | null;
  partnerName: string | null;
  total: number;
  isPayable: boolean;
  paid: number;
  status: CostBillStatus;
};

export async function listCostBills(): Promise<CostBillListRow[]> {
  const rows = await prisma.prdCostBill.findMany({
    include: { partner: { select: { partner_label: true, partner_name: true } } },
    orderBy: [{ bill_date: "desc" }, { id: "desc" }],
  });
  return rows.map((r) => ({
    id: r.id,
    billNo: r.bill_no,
    billDate: isoDay(r.bill_date),
    description: r.description,
    partnerLabel: r.partner?.partner_label ?? null,
    partnerName: r.partner?.partner_name ?? null,
    total: r.total_amount.toNumber(),
    isPayable: r.payable_account_id !== null,
    paid: r.paid_amount.toNumber(),
    status: r.status as CostBillStatus,
  }));
}

export type CostBillView = {
  id: number;
  billNo: string;
  billDate: string;
  /** The payable it was posted on (P151); null on a Draft or a bill posted before P151 to another lawan. */
  payableAccount: { label: string; name: string } | null;
  partnerId: number | null;
  partner: { label: string; name: string } | null;
  supplierRef: string | null;
  dueDate: string | null;
  description: string;
  note: string | null;
  status: CostBillStatus;
  cancelReason: string | null;
  total: number;
  isPayable: boolean;
  paid: number;
  journalId: number | null;
  lines: { elementId: number; elementLabel: string; elementName: string; accountLabel: string; accountName: string; amount: number; note: string | null }[];
};

export async function getCostBill(id: number): Promise<CostBillView | null> {
  const b = await prisma.prdCostBill.findUnique({
    where: { id },
    include: {
      payable_account: { select: { account_label: true, account_name: true } },
      partner: { select: { partner_label: true, partner_name: true } },
      lines: { orderBy: { line_no: "asc" }, include: { element: { include: { account: { select: { account_label: true, account_name: true } } } } } },
    },
  });
  if (!b) return null;
  return {
    id: b.id,
    billNo: b.bill_no,
    billDate: isoDay(b.bill_date),
    payableAccount: b.payable_account ? { label: b.payable_account.account_label, name: b.payable_account.account_name } : null,
    partnerId: b.partner_id,
    partner: b.partner ? { label: b.partner.partner_label, name: b.partner.partner_name } : null,
    supplierRef: b.supplier_ref,
    dueDate: isoDay(b.due_date) || null,
    description: b.description,
    note: b.note,
    status: b.status as CostBillStatus,
    cancelReason: b.cancel_reason,
    total: b.total_amount.toNumber(),
    isPayable: b.payable_account_id !== null,
    paid: b.paid_amount.toNumber(),
    journalId: b.journal_id,
    lines: b.lines.map((l) => ({
      elementId: l.element_id,
      elementLabel: l.element.element_label,
      elementName: l.element.element_name,
      accountLabel: l.element.account.account_label,
      accountName: l.element.account.account_name,
      amount: l.amount.toNumber(),
      note: l.note,
    })),
  };
}

export async function costBillNumbersByIds(ids: number[]): Promise<Map<number, string>> {
  if (!ids.length) return new Map();
  const rows = await prisma.prdCostBill.findMany({ where: { id: { in: ids } }, select: { id: true, bill_no: true } });
  return new Map(rows.map((r) => [r.id, r.bill_no]));
}

// ----------------------------------------------------- for the payment module

/** A payable bill as Pembayaran Biaya Produksi reads it. */
export type PayableCostBill = {
  id: number;
  billNo: string;
  billDate: string;
  dueDate: string;
  supplierId: number;
  /** The payable the bill was posted on — the account its payment debits (P151). */
  payableAccountId: number;
  description: string;
  status: CostBillStatus;
  total: number;
  paid: number;
};

/** Posted bills — by id, or every one not paid in full. Only a posted bill names its payable. */
export async function payableCostBills(filter: { ids?: number[]; openOnly?: boolean }, db: Db = prisma): Promise<PayableCostBill[]> {
  if (!filter.openOnly && !filter.ids?.length) return [];
  const rows = await db.prdCostBill.findMany({
    where: { payable_account_id: { not: null }, partner_id: { not: null }, ...(filter.ids?.length ? { id: { in: filter.ids } } : { status: "Posted" }) },
  });
  return rows
    .filter((r) => !filter.openOnly || r.paid_amount.lt(r.total_amount))
    .map((r) => ({
      id: r.id,
      billNo: r.bill_no,
      billDate: isoDay(r.bill_date),
      dueDate: isoDay(r.due_date ?? r.bill_date),
      supplierId: r.partner_id!,
      payableAccountId: r.payable_account_id!,
      description: r.description,
      status: r.status as CostBillStatus,
      total: r.total_amount.toNumber(),
      paid: r.paid_amount.toNumber(),
    }));
}

export async function lockCostBills(tx: Prisma.TransactionClient, ids: number[]): Promise<void> {
  for (const id of [...new Set(ids)].sort((a, b) => a - b)) await tx.$queryRaw`SELECT id FROM prd_cost_bill WHERE id = ${id} FOR UPDATE`;
}

/** Adds a posted payment line to what the bill was paid (P132), under the caller's lock. */
export async function recordCostBillPaid(tx: Prisma.TransactionClient, id: number, settled: number): Promise<void> {
  const v = await tx.prdCostBill.findUnique({ where: { id }, select: { bill_no: true, status: true, payable_account_id: true, total_amount: true, paid_amount: true } });
  if (!v || v.status !== "Posted" || v.payable_account_id === null) throw new Error("Tagihan Biaya Produksi tidak dapat dibayar.");
  const cents = (x: number) => Math.round(x * 100);
  const paid = (cents(v.paid_amount.toNumber()) + cents(settled)) / 100;
  if (!(settled > 0) || cents(paid) > cents(v.total_amount.toNumber())) throw new Error(`Pembayaran melebihi sisa ${v.bill_no}.`);
  await tx.prdCostBill.update({ where: { id }, data: { paid_amount: paid } });
}
