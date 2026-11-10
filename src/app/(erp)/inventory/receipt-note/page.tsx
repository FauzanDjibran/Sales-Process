import { ReceiptNoteList } from "@/components/inventory/receipt-note-list";
import { requirePermission } from "@/lib/erp/auth";
import { listReceiptNotes } from "@/lib/erp/receipt-note";
import { receiptNoteAbilities } from "@/lib/erp/receipt-note-workflow";

export const dynamic = "force-dynamic";

/** The Receipt Note register (P125). */
export default async function Page() {
  const actor = await requirePermission("RECEIPT_NOTE_VIEW", "/inventory/receipt-note");
  return <ReceiptNoteList rows={await listReceiptNotes()} can={receiptNoteAbilities(actor.permissions)} />;
}
