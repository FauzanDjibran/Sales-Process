import { notFound } from "next/navigation";
import { JournalForm } from "@/components/accounting/journal-form";
import { RecordHistoryCard } from "@/components/ui/record-history-card";
import { requirePermission } from "@/lib/erp/auth";
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

  const journal = await getJournal(Number(id));
  if (!journal) notFound();

  return (
    <>
      <JournalForm
        mode="view"
        journal={journal}
        can={journalAbilities(actor.permissions)}
      />
      <RecordHistoryCard entityKey="acc_journal" rowId={journal.id} />
    </>
  );
}
