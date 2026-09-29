import { notFound } from "next/navigation";
import { JournalDetail } from "@/components/accounting/journal-detail";
import { RecordHistoryCard } from "@/components/ui/record-history-card";
import { requirePermission } from "@/lib/erp/auth";
import { accessibleCompanyIds } from "@/lib/erp/company-access";
import { getJournal } from "@/lib/erp/journal";
import { journalAbilities } from "@/lib/erp/journal-workflow";

export const dynamic = "force-dynamic";

export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const actor = await requirePermission("JOURNAL_VIEW", "/accounting/journal");

  // A journal of a Company this reader may not see is not found rather than
  // refused: the refusal itself would confirm the record exists.
  const journal = await getJournal(
    Number(id),
    await accessibleCompanyIds(actor.permissions)
  );
  if (!journal) notFound();

  return (
    <>
      <JournalDetail journal={journal} can={journalAbilities(actor.permissions)} />
      <RecordHistoryCard entityKey="acc_journal" rowId={journal.id} />
    </>
  );
}
