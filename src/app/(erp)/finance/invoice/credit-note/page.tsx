import { CreditNoteList } from "@/components/finance/credit-note-list";
import { requirePermission } from "@/lib/erp/auth";
import { listCreditNotes } from "@/lib/erp/ar-credit-note";
import { creditNoteAbilities } from "@/lib/erp/ar-credit-note-workflow";

export const dynamic = "force-dynamic";

/** The Credit Note Penjualan register (P292). */
export default async function Page() {
  const actor = await requirePermission("SALES_CREDIT_NOTE_VIEW", "/finance/invoice/credit-note");
  return <CreditNoteList rows={await listCreditNotes()} can={creditNoteAbilities(actor.permissions)} />;
}
