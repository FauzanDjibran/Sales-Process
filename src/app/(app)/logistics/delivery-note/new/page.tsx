import { DeliveryNoteForm } from "@/components/logistics/delivery-note-form";
import { requirePermission } from "@/lib/erp/auth";
import { deliveryNoteOptions } from "@/lib/erp/delivery-note";
import { deliveryNoteAbilities } from "@/lib/erp/delivery-note-workflow";

export const dynamic = "force-dynamic";

/** A new Delivery Note — with `?do=<id>`, started from that Delivery Order's page. */
export default async function Page({ searchParams }: { searchParams: Promise<{ do?: string }> }) {
  const actor = await requirePermission("DELIVERY_NOTE_CREATE", "/logistics/delivery-note/new");
  const { do: doId } = await searchParams;
  return (
    <DeliveryNoteForm
      mode="new"
      note={null}
      options={await deliveryNoteOptions()}
      can={deliveryNoteAbilities(actor.permissions)}
      presetDeliveryOrderId={Number(doId) || null}
    />
  );
}
