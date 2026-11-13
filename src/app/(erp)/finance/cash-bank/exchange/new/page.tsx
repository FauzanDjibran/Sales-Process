import { CashExchangeForm } from "@/components/finance/cash-exchange-form";
import { requirePermission } from "@/lib/erp/auth";
import { cashExchangeOptions } from "@/lib/erp/cash-exchange";
import { CASH_EXCHANGE_PATH, cashExchangeAbilities } from "@/lib/erp/cash-exchange-workflow";

export const dynamic = "force-dynamic";

export default async function Page() {
  const actor = await requirePermission("CASH_EXCHANGE_CREATE", `${CASH_EXCHANGE_PATH}/new`);
  return <CashExchangeForm mode="new" doc={null} options={await cashExchangeOptions()} can={cashExchangeAbilities(actor.permissions)} />;
}
