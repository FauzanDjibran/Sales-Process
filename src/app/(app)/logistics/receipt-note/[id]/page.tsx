import { notFound } from "next/navigation";
import { ReceiptNoteForm } from "@/components/logistics/receipt-note-form";
import { RecordHistoryCard } from "@/components/ui/record-history-card";
import { requirePermission } from "@/lib/erp/auth";
import { getReceiptNote, receiptNoteOptions } from "@/lib/erp/receipt-note";
import { receiptNoteAbilities } from "@/lib/erp/receipt-note-workflow";

export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requirePermission("RECEIPT_NOTE_VIEW", "/logistics/receipt-note");
  const note = await getReceiptNote(Number(id));
  if (!note) notFound();
  const options = await receiptNoteOptions({ id: note.id, sourceId: Number(note.header.source_doc_id) });
  return (
    <>
      <ReceiptNoteForm mode="view" note={note} options={options} can={receiptNoteAbilities(actor.permissions)} />
      <RecordHistoryCard entityKey="log_receipt_note" rowId={note.id} />
    </>
  );
}
