import { notFound } from "next/navigation";
import { ReceiptNoteForm } from "@/components/inventory/receipt-note-form";
import { ReturnReceiptForm } from "@/components/inventory/return-receipt-form";
import { RecordHistoryCard } from "@/components/ui/record-history-card";
import { requirePermission } from "@/lib/erp/auth";
import { getReceiptNote, receiptNoteOptions, returnReceiptOptions } from "@/lib/erp/receipt-note";
import { SALES_RETURN, receiptNoteAbilities } from "@/lib/erp/receipt-note-workflow";

export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requirePermission("RECEIPT_NOTE_VIEW", "/inventory/receipt-note");
  const note = await getReceiptNote(Number(id));
  if (!note) notFound();
  const current = { id: note.id, sourceId: Number(note.header.source_doc_id) };
  const can = receiptNoteAbilities(actor.permissions);
  return (
    <>
      {note.header.purpose === SALES_RETURN ? (
        <ReturnReceiptForm mode="view" note={note} options={await returnReceiptOptions(current)} can={can} />
      ) : (
        <ReceiptNoteForm mode="view" note={note} options={await receiptNoteOptions(current)} can={can} />
      )}
      <RecordHistoryCard entityKey="log_receipt_note" rowId={note.id} />
    </>
  );
}
