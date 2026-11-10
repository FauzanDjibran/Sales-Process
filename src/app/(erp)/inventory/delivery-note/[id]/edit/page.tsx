import { notFound, redirect } from "next/navigation";
import { DeliveryNoteForm } from "@/components/inventory/delivery-note-form";
import { RecordHistoryCard } from "@/components/ui/record-history-card";
import { requirePermission } from "@/lib/erp/auth";
import { deliveryNoteOptions, getDeliveryNote } from "@/lib/erp/delivery-note";
import { deliveryNoteAbilities, deliveryNoteIsEditable } from "@/lib/erp/delivery-note-workflow";

export const dynamic = "force-dynamic";

/** Only a Draft is edited; anything else goes back to its detail. */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requirePermission("DELIVERY_NOTE_EDIT", `/inventory/delivery-note/${id}/edit`);
  const note = await getDeliveryNote(Number(id));
  if (!note) notFound();
  if (!deliveryNoteIsEditable(note.status)) redirect(`/inventory/delivery-note/${note.id}`);
  const options = await deliveryNoteOptions({ id: note.id, sourceId: Number(note.header.source_doc_id) });
  return (
    <>
      <DeliveryNoteForm mode="edit" note={note} options={options} can={deliveryNoteAbilities(actor.permissions)} />
      <RecordHistoryCard entityKey="log_delivery_note" rowId={note.id} />
    </>
  );
}
