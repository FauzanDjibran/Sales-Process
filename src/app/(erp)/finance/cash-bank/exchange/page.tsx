import { CashExchangeList } from "@/components/finance/cash-exchange-list";
import { requirePermission } from "@/lib/erp/auth";
import { listCashExchanges } from "@/lib/erp/cash-exchange";
import { CASH_EXCHANGE_PATH, cashExchangeAbilities } from "@/lib/erp/cash-exchange-workflow";

export const dynamic = "force-dynamic";

/** The Penukaran Valas register (MC11a). */
export default async function Page() {
  const actor = await requirePermission("CASH_EXCHANGE_VIEW", CASH_EXCHANGE_PATH);
  return <CashExchangeList rows={await listCashExchanges()} can={cashExchangeAbilities(actor.permissions)} />;
}
