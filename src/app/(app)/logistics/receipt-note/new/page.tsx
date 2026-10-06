import { ReceiptNoteForm } from "@/components/logistics/receipt-note-form";
import { requirePermission } from "@/lib/erp/auth";
import { receiptNoteOptions } from "@/lib/erp/receipt-note";
import { receiptNoteAbilities } from "@/lib/erp/receipt-note-workflow";

export const dynamic = "force-dynamic";

export default async function Page() {
  const actor = await requirePermission("RECEIPT_NOTE_CREATE", "/logistics/receipt-note/new");
  return <ReceiptNoteForm mode="new" note={null} options={await receiptNoteOptions()} can={receiptNoteAbilities(actor.permissions)} />;
}
