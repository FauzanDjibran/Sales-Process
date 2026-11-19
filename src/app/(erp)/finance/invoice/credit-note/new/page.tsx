import { CreditNoteForm } from "@/components/finance/credit-note-form";
import { requirePermission } from "@/lib/erp/auth";
import { creditNoteOptions } from "@/lib/erp/ar-credit-note";
import { creditNoteAbilities } from "@/lib/erp/ar-credit-note-workflow";

export const dynamic = "force-dynamic";

/** A new Credit Note: the posted Invoices with returned goods still to credit. */
export default async function Page() {
  const actor = await requirePermission("SALES_CREDIT_NOTE_CREATE", "/finance/invoice/credit-note/new");
  const { invoices } = await creditNoteOptions();
  return <CreditNoteForm mode="new" note={null} invoices={invoices} can={creditNoteAbilities(actor.permissions)} />;
}
