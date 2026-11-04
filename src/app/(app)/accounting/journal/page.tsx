import { JournalList } from "@/components/accounting/journal-list";
import { requirePermission } from "@/lib/erp/auth";
import { listJournals } from "@/lib/erp/journal";
import { journalAbilities } from "@/lib/erp/journal-workflow";
import { oneParam, parseRegisterQuery } from "@/lib/erp/register-query";

export const dynamic = "force-dynamic";

/**
 * The Journal register.
 *
 * Both kinds live here: journals a posting produced, which are final from the
 * moment they exist, and manual journals, which are drafted below this page at
 * `/new` and `/[id]/edit` and become the same thing once posted.
 */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await requirePermission("JOURNAL_VIEW", "/accounting/journal");
  const params = await searchParams;
  const origin = oneParam(params.origin);
  const journals = await listJournals(
    parseRegisterQuery(params, ["Draft", "Posted", "Cancelled"]),
    origin === "manual" || origin === "auto" ? origin : ""
  );
  return (
    <JournalList journals={journals} can={journalAbilities(actor.permissions)} />
  );
}
