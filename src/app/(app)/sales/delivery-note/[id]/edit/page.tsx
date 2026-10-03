import { notFound, redirect } from "next/navigation";
import { DeliveryNoteForm } from "@/components/sales/delivery-note-form";
import { RecordHistoryCard } from "@/components/ui/record-history-card";
import { requirePermission } from "@/lib/erp/auth";
import { deliveryNoteOptions, getDeliveryNote } from "@/lib/erp/delivery-note";
import { deliveryNoteAbilities, deliveryNoteIsEditable } from "@/lib/erp/delivery-note-workflow";

export const dynamic = "force-dynamic";

/** Only a Draft is edited; anything else goes back to its detail. */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requirePermission("DELIVERY_NOTE_EDIT", `/sales/delivery-note/${id}/edit`);
  const note = await getDeliveryNote(Number(id));
  if (!note) notFound();
  if (!deliveryNoteIsEditable(note.status)) redirect(`/sales/delivery-note/${note.id}`);
  const options = await deliveryNoteOptions({ id: note.id, deliveryOrderId: Number(note.header.delivery_order_id) });
  return (
    <>
      <DeliveryNoteForm mode="edit" note={note} options={options} can={deliveryNoteAbilities(actor.permissions)} />
      <RecordHistoryCard entityKey="sal_delivery_note" rowId={note.id} />
    </>
  );
}
