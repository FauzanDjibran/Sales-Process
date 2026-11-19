import { notFound } from "next/navigation";
import { CreditNoteForm } from "@/components/finance/credit-note-form";
import { RecordHistoryCard } from "@/components/ui/record-history-card";
import { requirePermission } from "@/lib/erp/auth";
import { creditNoteOptions, getCreditNote } from "@/lib/erp/ar-credit-note";
import { creditNoteAbilities } from "@/lib/erp/ar-credit-note-workflow";

export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requirePermission("SALES_CREDIT_NOTE_VIEW", "/finance/invoice/credit-note");
  const note = await getCreditNote(Number(id));
  if (!note) notFound();
  const { invoices } = await creditNoteOptions({ id: note.id, invoiceId: Number(note.header.invoice_id) });
  return (
    <>
      <CreditNoteForm mode="view" note={note} invoices={invoices} can={creditNoteAbilities(actor.permissions)} />
      <RecordHistoryCard entityKey="fin_ar_credit_note" rowId={note.id} />
    </>
  );
}
