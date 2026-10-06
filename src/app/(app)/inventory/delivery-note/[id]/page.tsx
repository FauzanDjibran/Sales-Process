import { notFound } from "next/navigation";
import { DeliveryNoteForm } from "@/components/inventory/delivery-note-form";
import { RecordHistoryCard } from "@/components/ui/record-history-card";
import { requirePermission } from "@/lib/erp/auth";
import { deliveryNoteOptions, getDeliveryNote } from "@/lib/erp/delivery-note";
import { deliveryNoteAbilities } from "@/lib/erp/delivery-note-workflow";
import { deliveryNoteBilling } from "@/lib/erp/ar-invoice";

export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requirePermission("DELIVERY_NOTE_VIEW", "/inventory/delivery-note");
  const note = await getDeliveryNote(Number(id));
  if (!note) notFound();
  const can = deliveryNoteAbilities(actor.permissions);
  // The journal Posting would write is not read here: the Posting dialog asks
  // for it as a dry run when it opens (P103).
  const [options, billing] = await Promise.all([
    deliveryNoteOptions({ id: note.id, sourceId: Number(note.header.source_doc_id) }),
    // Which Invoice bills each line — the invoice module's to say; composed here (U17).
    note.status === "Posted" && actor.permissions.has("SALES_INVOICE_VIEW") ? deliveryNoteBilling(note.lines.map((l) => l.id)) : Promise.resolve(null),
  ]);
  return (
    <>
      <DeliveryNoteForm mode="view" note={note} options={options} can={can} billing={billing} />
      <RecordHistoryCard entityKey="log_delivery_note" rowId={note.id} />
    </>
  );
}
