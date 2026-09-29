import { JournalForm } from "@/components/accounting/journal-form";
import { requirePermission } from "@/lib/erp/auth";
import { manualJournalOptions } from "@/lib/erp/manual-journal";
import { defaultCurrencyId } from "@/lib/erp/system-settings";

export const dynamic = "force-dynamic";

/**
 * A new manual journal.
 *
 * The options are loaded with the page, so the first line is fillable without
 * a round trip.
 */
export default async function Page() {
  await requirePermission("JOURNAL_CREATE", "/accounting/journal/new");

  const [options, currencyId] = await Promise.all([
    manualJournalOptions(),
    defaultCurrencyId(),
  ]);

  return (
    <JournalForm
      mode="new"
      journal={null}
      options={options}
      defaultCurrencyId={currencyId}
    />
  );
}
