import { notFound } from "next/navigation";
import { DeliveryNoteForm } from "@/components/sales/delivery-note-form";
import { RecordHistoryCard } from "@/components/ui/record-history-card";
import { requirePermission } from "@/lib/erp/auth";
import { deliveryNoteOptions, deliveryNotePreview, getDeliveryNote } from "@/lib/erp/delivery-note";
import { deliveryNoteAbilities } from "@/lib/erp/delivery-note-workflow";

export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requirePermission("DELIVERY_NOTE_VIEW", "/sales/delivery-note");
  const note = await getDeliveryNote(Number(id));
  if (!note) notFound();
  const can = deliveryNoteAbilities(actor.permissions);
  const [options, preview] = await Promise.all([
    deliveryNoteOptions({ id: note.id, deliveryOrderId: Number(note.header.delivery_order_id) }),
    // The journal Posting would write, for its confirmation — only for a Draft
    // this user may post.
    note.status === "Draft" && can.post ? deliveryNotePreview(note.id) : Promise.resolve(null),
  ]);
  return (
    <>
      <DeliveryNoteForm mode="view" note={note} options={options} can={can} preview={preview} />
      <RecordHistoryCard entityKey="sal_delivery_note" rowId={note.id} />
    </>
  );
}
