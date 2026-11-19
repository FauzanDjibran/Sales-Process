import { ReceiptNoteForm } from "@/components/inventory/receipt-note-form";
import { ReturnReceiptForm } from "@/components/inventory/return-receipt-form";
import { requirePermission } from "@/lib/erp/auth";
import { receiptNoteOptions, returnReceiptOptions } from "@/lib/erp/receipt-note";
import { SALES_RETURN, receiptNoteAbilities } from "@/lib/erp/receipt-note-workflow";

export const dynamic = "force-dynamic";

/** A new Receipt Note — `?purpose=sales_return` (and `&sr=<id>`) for goods coming back (P288). */
export default async function Page({ searchParams }: { searchParams: Promise<{ purpose?: string; sr?: string }> }) {
  const actor = await requirePermission("RECEIPT_NOTE_CREATE", "/inventory/receipt-note/new");
  const { purpose, sr } = await searchParams;
  const can = receiptNoteAbilities(actor.permissions);
  if (purpose === SALES_RETURN) {
    return <ReturnReceiptForm mode="new" note={null} options={await returnReceiptOptions()} can={can} presetReturnId={Number(sr) || null} />;
  }
  return <ReceiptNoteForm mode="new" note={null} options={await receiptNoteOptions()} can={can} />;
}
