import { notFound } from "next/navigation";
import { SlipView } from "@/components/tax/slip-view";
import { RecordHistoryCard } from "@/components/ui/record-history-card";
import { requirePermission } from "@/lib/erp/auth";
import { getSlip } from "@/lib/erp/tax-document";
import { taxAbilities } from "@/lib/erp/tax-document-workflow";
import { todayIso } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requirePermission("TAX_SLIP_VIEW", "/tax/withholding-slip");
  const slip = await getSlip(Number(id));
  if (!slip) notFound();
  return (
    <>
      <SlipView slip={slip} can={taxAbilities(actor.permissions)} today={todayIso()} />
      <RecordHistoryCard entityKey="tax_withholding_slip" rowId={slip.id} />
    </>
  );
}
