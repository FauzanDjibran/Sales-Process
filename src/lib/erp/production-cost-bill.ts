import "server-only";

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { BASE_CURRENCY_LABEL } from "./currency";
import { nextDocumentNumber } from "./document-number";
import { checkTransactionDate } from "./fiscal";
import { CostCenterRefusal, PostingDryRun, describeJournalLines, postJournal, type JournalLineInput, type JournalPreviewResult } from "./journal";
import { costTypeOptions, costTypesByIds } from "./production-cost";
import { costCenterOptions, costCentersByIds } from "./cost-center";
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
 * Tagihan Biaya (P150 M68, renamed P154 — `production_project.md` §21e;
 * `prd_cost_bill(_line)`, `TBP/YYYY/MM/NNNN`).
 *
 * A cost recognised in the month it belongs to — the mainstream two-step (a
 * bill, then its payment). Each line picks a **Jenis Biaya**, never an account
 * (M75), and a **Cost Center** the user chooses (M83). **Posting** writes Dr
 * each line's expense account **with its Cost Center** / Cr Account Mapping's
 * *Hutang Biaya Produksi* for the total (P156, back to P151), dated the bill's
 * date; production cost has no book of its own — it is the General Ledger's
 * (M73).
 *
 * Every Tagihan names its Supplier and every posted one is payable: the
 * payable account is copied onto the bill at posting (`payable_account_id`),
 * the bill keeps what it was paid (P132), and *Pembayaran Biaya Produksi*
 * debits that account. It is never an AP open item.
 *
 * Named only by this module (`prd_cost_bill`, `prd_cost_bill_line`).
 */

type Db = Prisma.TransactionClient | typeof prisma;

export type CostBillLineInput = {
  cost_type_id: number | string | null;
  cost_center_id: number | string | null;
  amount: number | string | null;
  note?: string | null;
};

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

// ---------------------------------------------------------------- options

export type CostBillOptions = {
  suppliers: { id: number; label: string; name: string; active: boolean }[];
  costTypes: {
    id: number;
    label: string;
    name: string;
    expenseAccountLabel: string;
    expenseAccountName: string;
    active: boolean;
  }[];
  costCenters: { id: number; label: string; name: string; active: boolean }[];
  /** Account Mapping's Hutang Biaya Produksi today — the credit of a bill posted now; null when unset. */
  payableAccount: { label: string; name: string } | null;
};

/** Account Mapping's Hutang Biaya Produksi (P156), or null when unset. */
async function mappedPayable(db: Db) {
  const id = (await fallbackAccounts(["production_cost_payable_account"] as const)).production_cost_payable_account;
  if (!id) return null;
  return db.accAccount.findUnique({
    where: { id },
    select: { id: true, account_label: true, account_name: true, is_postable: true, is_active: true, require_partner: true, require_cost_center: true },
  });
}

export async function costBillOptions(): Promise<CostBillOptions> {
  const [suppliers, costTypes, costCenters, payable] = await Promise.all([
    prisma.mPartner.findMany({
      where: { category: { category_label: "Supplier" } },
      select: { id: true, partner_label: true, partner_name: true, status: true },
      orderBy: { partner_label: "asc" },
    }),
    costTypeOptions(),
    costCenterOptions(),
    mappedPayable(prisma),
  ]);
  return {
    suppliers: suppliers.map((p) => ({ id: p.id, label: p.partner_label, name: p.partner_name, active: p.status === "Active" })),
    costTypes: costTypes.map((t) => ({
      id: t.id,
      label: t.label,
      name: t.name,
      expenseAccountLabel: t.expenseAccountLabel,
      expenseAccountName: t.expenseAccountName,
      active: t.active,
    })),
    costCenters,
    payableAccount: payable ? { label: payable.account_label, name: payable.account_name } : null,
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
  lines: {
    line_no: number;
    cost_type_id: number;
    cost_center_id: number;
    amount: number;
    note: string | null;
    expenseAccountId: number;
    label: string;
  }[];
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

  const due = String(input.due_date ?? "").trim();
  if (due && !DAY.test(due)) errors.due_date = "Tanggal tidak dikenali.";
  else if (due && DAY.test(date) && due < date) errors.due_date = "Jatuh tempo tidak boleh sebelum tanggal tagihan.";

  const raw = Array.isArray(lines) ? lines : [];
  if (!raw.length) errors._lines = "Tambahkan minimal satu baris biaya.";
  const types = await costTypesByIds(raw.map((l) => Number(l.cost_type_id)), db);
  const centers = await costCentersByIds(raw.map((l) => Number(l.cost_center_id)), db);
  const out: CheckedCostBill["lines"] = [];
  for (const [i, l] of raw.entries()) {
    const t = types.get(Number(l.cost_type_id));
    if (!t) {
      errors[lineKey(i, "cost_type_id")] = "Pilih Jenis Biaya.";
      continue;
    }
    if (!t.active) {
      errors[lineKey(i, "cost_type_id")] = `${t.label} sudah nonaktif.`;
      continue;
    }
    const c = centers.get(Number(l.cost_center_id));
    if (!c) {
      errors[lineKey(i, "cost_center_id")] = "Pilih Cost Center.";
      continue;
    }
    if (!c.active) {
      errors[lineKey(i, "cost_center_id")] = `Cost Center ${c.label} sudah nonaktif.`;
      continue;
    }
    const amount = Number(l.amount);
    if (!Number.isFinite(amount) || amount <= 0 || amount !== Math.round(amount)) {
      errors[lineKey(i, "amount")] = "Jumlah harus rupiah penuh, lebih dari 0.";
      continue;
    }
    out.push({
      line_no: out.length + 1,
      cost_type_id: t.id,
      cost_center_id: c.id,
      amount,
      note: String(l.note ?? "").trim() || null,
      expenseAccountId: t.expenseAccountId,
      label: t.label,
    });
  }

  // Every Tagihan is owed to a Supplier and paid through Pengeluaran (P156).
  const partnerId = Number(input.partner_id) || null;
  if (partnerId) {
    const p = await db.mPartner.findUnique({ where: { id: partnerId }, include: { category: true } });
    if (!p) errors.partner_id = "Partner tidak ditemukan.";
    else if (p.category.category_label !== "Supplier") errors.partner_id = "Pilih Supplier.";
    else if (p.status !== "Active") errors.partner_id = "Supplier tersebut sudah nonaktif.";
  } else errors.partner_id = "Pilih Supplier yang menagih.";

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
  for (const l of c.lines) {
    await tx.prdCostBillLine.create({
      data: { bill_id: id, line_no: l.line_no, cost_type_id: l.cost_type_id, cost_center_id: l.cost_center_id, amount: l.amount, note: l.note },
    });
  }
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
 * Runs one lifecycle step. **Posting**, in one transaction: rechecks the bill
 * and writes the journal dated the bill's date — Dr each line's expense
 * account with its Cost Center / Cr Account Mapping's Hutang Biaya Produksi
 * for the total — and copies that account onto the bill (P156). With
 * `dryRun` it throws `PostingDryRun` after all of it, so the confirmation
 * shows exactly the journal Posting writes (P103).
 * **Batalkan** (Draft) asks for a reason.
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
      const r = await checkCostBill(
        tx,
        input,
        b.lines.map((l) => ({ cost_type_id: l.cost_type_id, cost_center_id: l.cost_center_id, amount: l.amount.toString(), note: l.note }))
      );
      if (!r.ok) {
        const first = Object.entries(r.errors).find(([k]) => !k.startsWith("_"))?.[1] ?? Object.values(r.errors)[0];
        throw new Refused({ _form: `Belum bisa diposting: ${first}` });
      }
      const payable = await mappedPayable(tx);
      if (!payable) throw new Refused({ _form: "Belum bisa diposting: Account Hutang Biaya Produksi belum diatur di Account Mapping." });
      if (!payable.is_postable || !payable.is_active || payable.require_cost_center || (await checkAccountIsLeaf(payable.id))) {
        throw new Refused({ _form: `Belum bisa diposting: Account Hutang Biaya Produksi (${payable.account_label}) harus aktif, dapat diposting dan tidak wajib Cost Center.` });
      }
      const expenseIds = [...new Set(r.c.lines.map((l) => l.expenseAccountId))];
      const accounts = new Map(
        (await tx.accAccount.findMany({ where: { id: { in: expenseIds } }, select: { id: true, account_label: true, is_postable: true, is_active: true, require_partner: true } })).map((a) => [a.id, a])
      );
      for (const id of expenseIds) {
        const a = accounts.get(id);
        if (!a || !a.is_postable || !a.is_active || (await checkAccountIsLeaf(id))) {
          throw new Refused({ _form: `Belum bisa diposting: account ${a?.account_label ?? id} pada Jenis Biaya harus aktif dan dapat diposting.` });
        }
      }
      const done = await tx.prdCostBill.updateMany({
        where: { id, status: "Draft" },
        data: { ...r.c.data, payable_account_id: payable.id, status: "Posted", updated_by: actorId },
      });
      if (done.count !== 1) throw new Refused({ _form: moved });

      const base = { currencyId: currency.id, rate: 1 };
      journalLines = [
        ...r.c.lines.map((l) => ({
          ...base,
          accountId: l.expenseAccountId,
          partnerId: accounts.get(l.expenseAccountId)?.require_partner ? r.c.data.partner_id : null,
          costCenterId: l.cost_center_id,
          debit: l.amount,
          credit: 0,
          description: `${l.label} — ${l.note ?? r.c.data.description}`,
        })),
        {
          ...base,
          accountId: payable.id,
          partnerId: payable.require_partner ? r.c.data.partner_id : null,
          debit: 0,
          credit: r.c.data.total_amount,
          description: `${b.bill_no} · ${r.c.data.description}`,
        },
      ];
      const journal = await postJournal(tx, {
        description: `${b.bill_no} · Tagihan Biaya — ${r.c.data.description}`,
        sourceDocTypeId: await docTypeId(tx, "prd_cost_bill"),
        sourceDocId: id,
        postingDate: r.c.data.bill_date,
        actorId,
        lines: journalLines,
      });
      await tx.prdCostBill.update({ where: { id }, data: { journal_id: journal.id } });
      await audit(tx, id, "UPDATE", "post", actorId);
      if (options.dryRun) throw new PostingDryRun(journalLines);
    });
    return { ok: true, journal: journalLines };
  } catch (e) {
    if (e instanceof Refused) return { ok: false, errors: e.errors };
    if (e instanceof CostCenterRefusal) return { ok: false, errors: { _form: `Belum bisa diposting: ${e.message}` } };
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

export type CostBillLineView = {
  costTypeId: number;
  costTypeLabel: string;
  costTypeName: string;
  costCenterId: number;
  costCenterLabel: string;
  costCenterName: string;
  expenseAccountLabel: string;
  expenseAccountName: string;
  amount: number;
  note: string | null;
};

export type CostBillView = {
  id: number;
  billNo: string;
  billDate: string;
  partnerId: number | null;
  partner: { label: string; name: string } | null;
  supplierRef: string | null;
  dueDate: string | null;
  description: string;
  note: string | null;
  status: CostBillStatus;
  cancelReason: string | null;
  total: number;
  /** A Draft always; a posted bill when it was credited to a payable (all but P154's not-paid kind). */
  isPayable: boolean;
  /** The account a posted bill was credited to; null on a Draft, which shows Account Mapping's today. */
  payableAccount: { label: string; name: string } | null;
  paid: number;
  journalId: number | null;
  lines: CostBillLineView[];
};

export async function getCostBill(id: number): Promise<CostBillView | null> {
  const acc = { select: { account_label: true, account_name: true } } as const;
  const b = await prisma.prdCostBill.findUnique({
    where: { id },
    include: {
      partner: { select: { partner_label: true, partner_name: true } },
      payable_account: acc,
      lines: {
        orderBy: { line_no: "asc" },
        include: {
          cost_type: { include: { expense_account: acc } },
          cost_center: { select: { cost_center_label: true, cost_center_name: true } },
        },
      },
    },
  });
  if (!b) return null;
  return {
    id: b.id,
    billNo: b.bill_no,
    billDate: isoDay(b.bill_date),
    partnerId: b.partner_id,
    partner: b.partner ? { label: b.partner.partner_label, name: b.partner.partner_name } : null,
    supplierRef: b.supplier_ref,
    dueDate: isoDay(b.due_date) || null,
    description: b.description,
    note: b.note,
    status: b.status as CostBillStatus,
    cancelReason: b.cancel_reason,
    total: b.total_amount.toNumber(),
    isPayable: b.status !== "Posted" || b.payable_account_id !== null,
    payableAccount: b.payable_account ? { label: b.payable_account.account_label, name: b.payable_account.account_name } : null,
    paid: b.paid_amount.toNumber(),
    journalId: b.journal_id,
    lines: b.lines.map((l) => ({
      costTypeId: l.cost_type_id,
      costTypeLabel: l.cost_type.cost_type_label,
      costTypeName: l.cost_type.cost_type_name,
      costCenterId: l.cost_center_id,
      costCenterLabel: l.cost_center.cost_center_label,
      costCenterName: l.cost_center.cost_center_name,
      expenseAccountLabel: l.cost_type.expense_account.account_label,
      expenseAccountName: l.cost_type.expense_account.account_name,
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
  if (!v || v.status !== "Posted" || v.payable_account_id === null) throw new Error("Tagihan Biaya tidak dapat dibayar.");
  const cents = (x: number) => Math.round(x * 100);
  const paid = (cents(v.paid_amount.toNumber()) + cents(settled)) / 100;
  if (!(settled > 0) || cents(paid) > cents(v.total_amount.toNumber())) throw new Error(`Pembayaran melebihi sisa ${v.bill_no}.`);
  await tx.prdCostBill.update({ where: { id }, data: { paid_amount: paid } });
}

/** Documents of this kind that would still post into a period closing on `to` — a blocker of Penutupan Biaya Produksi (P172, Q74). */
export async function draftCostBillsUpTo(to: Date, db: Db = prisma): Promise<number> {
  return db.prdCostBill.count({ where: { status: "Draft", bill_date: { lte: to } } });
}
