import { notFound } from "next/navigation";
import { CashExchangeForm } from "@/components/finance/cash-exchange-form";
import { RecordHistoryCard } from "@/components/ui/record-history-card";
import { requirePermission } from "@/lib/erp/auth";
import { cashExchangeOptions, getCashExchange } from "@/lib/erp/cash-exchange";
import { CASH_EXCHANGE_PATH, cashExchangeAbilities } from "@/lib/erp/cash-exchange-workflow";

export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requirePermission("CASH_EXCHANGE_VIEW", CASH_EXCHANGE_PATH);
  const doc = await getCashExchange(Number(id));
  if (!doc) notFound();
  return (
    <>
      <CashExchangeForm mode="view" doc={doc} options={await cashExchangeOptions()} can={cashExchangeAbilities(actor.permissions)} />
      <RecordHistoryCard entityKey="fin_cash_exchange" rowId={doc.id} />
    </>
  );
}
