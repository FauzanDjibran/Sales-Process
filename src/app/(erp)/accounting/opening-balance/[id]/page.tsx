import { notFound } from "next/navigation";
import { OpeningBalanceDetail } from "@/components/accounting/opening-balance-detail";
import { RecordHistoryCard } from "@/components/ui/record-history-card";
import { requirePermission } from "@/lib/erp/auth";
import { getOpeningBalance } from "@/lib/erp/opening-balance";

export const dynamic = "force-dynamic";

export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  await requirePermission("OPENING_BALANCE_VIEW", "/accounting/opening-balance");

  const opening = await getOpeningBalance(Number(id));
  if (!opening) notFound();

  return (
    <>
      <OpeningBalanceDetail opening={opening} />
      <RecordHistoryCard entityKey="acc_opening_balance" rowId={opening.id} />
    </>
  );
}
