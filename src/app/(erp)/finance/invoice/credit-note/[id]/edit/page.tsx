import { notFound, redirect } from "next/navigation";
import { CreditNoteForm } from "@/components/finance/credit-note-form";
import { RecordHistoryCard } from "@/components/ui/record-history-card";
import { requirePermission } from "@/lib/erp/auth";
import { creditNoteOptions, getCreditNote } from "@/lib/erp/ar-credit-note";
import { creditNoteAbilities, creditNoteIsEditable } from "@/lib/erp/ar-credit-note-workflow";

export const dynamic = "force-dynamic";

/** Only a Draft is edited; anything else goes back to its detail. */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requirePermission("SALES_CREDIT_NOTE_EDIT", `/finance/invoice/credit-note/${id}/edit`);
  const note = await getCreditNote(Number(id));
  if (!note) notFound();
  if (!creditNoteIsEditable(note.status)) redirect(`/finance/invoice/credit-note/${note.id}`);
  const { invoices } = await creditNoteOptions({ id: note.id, invoiceId: Number(note.header.invoice_id) });
  return (
    <>
      <CreditNoteForm mode="edit" note={note} invoices={invoices} can={creditNoteAbilities(actor.permissions)} />
      <RecordHistoryCard entityKey="fin_ar_credit_note" rowId={note.id} />
    </>
  );
}
