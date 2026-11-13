import { notFound, redirect } from "next/navigation";
import { CashExchangeForm } from "@/components/finance/cash-exchange-form";
import { RecordHistoryCard } from "@/components/ui/record-history-card";
import { requirePermission } from "@/lib/erp/auth";
import { cashExchangeOptions, getCashExchange } from "@/lib/erp/cash-exchange";
import { CASH_EXCHANGE_PATH, cashExchangeAbilities, cashExchangeIsEditable } from "@/lib/erp/cash-exchange-workflow";

export const dynamic = "force-dynamic";

/** Only a Draft is edited; anything else goes back to its detail. */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requirePermission("CASH_EXCHANGE_EDIT", `${CASH_EXCHANGE_PATH}/${id}/edit`);
  const doc = await getCashExchange(Number(id));
  if (!doc) notFound();
  if (!cashExchangeIsEditable(doc.status)) redirect(`${CASH_EXCHANGE_PATH}/${doc.id}`);
  return (
    <>
      <CashExchangeForm mode="edit" doc={doc} options={await cashExchangeOptions()} can={cashExchangeAbilities(actor.permissions)} />
      <RecordHistoryCard entityKey="fin_cash_exchange" rowId={doc.id} />
    </>
  );
}
