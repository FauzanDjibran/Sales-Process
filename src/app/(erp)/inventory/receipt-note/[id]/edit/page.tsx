import { notFound, redirect } from "next/navigation";
import { ReceiptNoteForm } from "@/components/inventory/receipt-note-form";
import { ReturnReceiptForm } from "@/components/inventory/return-receipt-form";
import { RecordHistoryCard } from "@/components/ui/record-history-card";
import { requirePermission } from "@/lib/erp/auth";
import { getReceiptNote, receiptNoteOptions, returnReceiptOptions } from "@/lib/erp/receipt-note";
import { SALES_RETURN, receiptNoteAbilities, receiptNoteIsEditable } from "@/lib/erp/receipt-note-workflow";

export const dynamic = "force-dynamic";

/** Only a Draft is edited; anything else goes back to its detail. */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requirePermission("RECEIPT_NOTE_EDIT", `/inventory/receipt-note/${id}/edit`);
  const note = await getReceiptNote(Number(id));
  if (!note) notFound();
  if (!receiptNoteIsEditable(note.status)) redirect(`/inventory/receipt-note/${note.id}`);
  const current = { id: note.id, sourceId: Number(note.header.source_doc_id) };
  const can = receiptNoteAbilities(actor.permissions);
  return (
    <>
      {note.header.purpose === SALES_RETURN ? (
        <ReturnReceiptForm mode="edit" note={note} options={await returnReceiptOptions(current)} can={can} />
      ) : (
        <ReceiptNoteForm mode="edit" note={note} options={await receiptNoteOptions(current)} can={can} />
      )}
      <RecordHistoryCard entityKey="log_receipt_note" rowId={note.id} />
    </>
  );
}
