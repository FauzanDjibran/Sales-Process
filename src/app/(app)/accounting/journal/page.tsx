import { JournalList } from "@/components/accounting/journal-list";
import { requirePermission } from "@/lib/erp/auth";
import { listJournals } from "@/lib/erp/journal";
import { journalAbilities } from "@/lib/erp/journal-workflow";

export const dynamic = "force-dynamic";

/**
 * The Journal register.
 *
 * Both kinds live here: journals a posting produced, which are final from the
 * moment they exist, and manual journals, which are drafted below this page at
 * `/new` and `/[id]/edit` and become the same thing once posted.
 */
export default async function Page() {
  const actor = await requirePermission("JOURNAL_VIEW", "/accounting/journal");
  const journals = await listJournals();
  return (
    <JournalList journals={journals} can={journalAbilities(actor.permissions)} />
  );
}
