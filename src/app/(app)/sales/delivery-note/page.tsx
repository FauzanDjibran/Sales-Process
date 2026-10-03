import { DeliveryNoteList } from "@/components/sales/delivery-note-list";
import { requirePermission } from "@/lib/erp/auth";
import { listDeliveryNotes } from "@/lib/erp/delivery-note";
import { deliveryNoteAbilities } from "@/lib/erp/delivery-note-workflow";

export const dynamic = "force-dynamic";

/** The Delivery Note register (C28). */
export default async function Page() {
  const actor = await requirePermission("DELIVERY_NOTE_VIEW", "/sales/delivery-note");
  return <DeliveryNoteList orders={await listDeliveryNotes()} can={deliveryNoteAbilities(actor.permissions)} />;
}
