import { notFound } from "next/navigation";
import { CreditNoteForm } from "@/components/finance/credit-note-form";
import { RecordHistoryCard } from "@/components/ui/record-history-card";
import { requirePermission } from "@/lib/erp/auth";
import { creditNoteOptions, getCreditNote } from "@/lib/erp/ar-credit-note";
import { creditNoteAbilities } from "@/lib/erp/ar-credit-note-workflow";
import { applicationsOfCreditNote } from "@/lib/erp/ar-credit-application";
import { invoiceNumbersByIds } from "@/lib/erp/ar-invoice";
import { settlementsOfDocument } from "@/lib/erp/cash-bank-tx";
import type { CreditUsage } from "@/components/finance/credit-note-form";

export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requirePermission("SALES_CREDIT_NOTE_VIEW", "/finance/invoice/credit-note");
  const note = await getCreditNote(Number(id));
  if (!note) notFound();
  // What used the credit, composed here from the modules that own it (§3.1, P335).
  const [{ invoices }, applied, refunds] = await Promise.all([
    creditNoteOptions({ id: note.id, invoiceId: Number(note.header.invoice_id) }),
    note.status === "Posted" ? applicationsOfCreditNote(note.id) : Promise.resolve([]),
    note.status === "Posted" ? settlementsOfDocument("fin_ar_credit_note", note.id) : Promise.resolve([]),
  ]);
  const invoiceNos = await invoiceNumbersByIds(applied.map((a) => a.invoiceId));
  const usage: CreditUsage[] = [
    ...applied.map((a) => ({
      key: `a${a.id}-${a.invoiceId}`,
      date: a.date,
      no: a.applicationNo,
      href: `/finance/invoice/credit-application/${a.id}`,
      kind: "Penerapan Kredit" as const,
      target: { no: invoiceNos.get(a.invoiceId) ?? "", href: `/finance/invoice/sales/${a.invoiceId}` },
      status: a.status,
      amount: a.amount,
    })),
    ...refunds.map((r) => ({
      key: `r${r.id}`,
      date: r.date,
      no: r.txNo,
      href: `/finance/cash-bank/payment/${r.id}`,
      kind: "Pengembalian Dana" as const,
      target: null,
      status: r.status,
      amount: r.settled,
    })),
  ].sort((x, y) => (x.date === y.date ? x.no.localeCompare(y.no) : y.date.localeCompare(x.date)));
  return (
    <>
      <CreditNoteForm mode="view" note={note} invoices={invoices} can={creditNoteAbilities(actor.permissions)} usage={usage} />
      <RecordHistoryCard entityKey="fin_ar_credit_note" rowId={note.id} />
    </>
  );
}
