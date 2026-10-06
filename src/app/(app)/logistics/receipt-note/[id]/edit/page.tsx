import { notFound, redirect } from "next/navigation";
import { ReceiptNoteForm } from "@/components/logistics/receipt-note-form";
import { RecordHistoryCard } from "@/components/ui/record-history-card";
import { requirePermission } from "@/lib/erp/auth";
import { getReceiptNote, receiptNoteOptions } from "@/lib/erp/receipt-note";
import { receiptNoteAbilities, receiptNoteIsEditable } from "@/lib/erp/receipt-note-workflow";

export const dynamic = "force-dynamic";

/** Only a Draft is edited; anything else goes back to its detail. */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requirePermission("RECEIPT_NOTE_EDIT", `/logistics/receipt-note/${id}/edit`);
  const note = await getReceiptNote(Number(id));
  if (!note) notFound();
  if (!receiptNoteIsEditable(note.status)) redirect(`/logistics/receipt-note/${note.id}`);
  const options = await receiptNoteOptions({ id: note.id, sourceId: Number(note.header.source_doc_id) });
  return (
    <>
      <ReceiptNoteForm mode="edit" note={note} options={options} can={receiptNoteAbilities(actor.permissions)} />
      <RecordHistoryCard entityKey="log_receipt_note" rowId={note.id} />
    </>
  );
}
