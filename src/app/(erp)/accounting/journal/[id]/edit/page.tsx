import { notFound } from "next/navigation";
import { JournalForm } from "@/components/accounting/journal-form";
import { RecordHistoryCard } from "@/components/ui/record-history-card";
import { requirePermission } from "@/lib/erp/auth";
import { getJournal } from "@/lib/erp/journal";
import { journalIsEditable, type JournalStatus } from "@/lib/erp/journal-workflow";
import { manualJournalOptions } from "@/lib/erp/manual-journal";

export const dynamic = "force-dynamic";

/**
 * Editing a manual journal.
 *
 * Only a Draft is reachable: a posted journal is final, and one produced by a
 * document's posting was never editable at all. The route refuses both rather
 * than rendering a form whose every save the Server Action would reject.
 */
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  await requirePermission("JOURNAL_EDIT", `/accounting/journal/${id}/edit`);

  const journal = await getJournal(Number(id));
  if (!journal) notFound();
  if (!journal.isManual || !journalIsEditable(journal.status as JournalStatus)) {
    notFound();
  }

  const options = await manualJournalOptions();

  return (
    <>
      <JournalForm
        mode="edit"
        journal={journal}
        options={options}
        defaultCurrencyId={null}
      />
      <RecordHistoryCard entityKey="acc_journal" rowId={journal.id} />
    </>
  );
}
