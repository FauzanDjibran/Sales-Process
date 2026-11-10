import { OpeningBalanceList } from "@/components/accounting/opening-balance-list";
import { requirePermission } from "@/lib/erp/auth";
import { listOpeningBalances } from "@/lib/erp/opening-balance";

export const dynamic = "force-dynamic";

/**
 * The Opening Balance register.
 *
 * Read-only: there is no `/new` and no `/[id]/edit` below this route, because
 * a snapshot is written by a fiscal year's close or injected by a developer
 * before the application has any history, and is immutable once it exists.
 */
export default async function Page() {
  await requirePermission("OPENING_BALANCE_VIEW", "/accounting/opening-balance");
  const openings = await listOpeningBalances();
  return <OpeningBalanceList openings={openings} />;
}
