import { ClosingWorkspace } from "@/components/accounting/closing-workspace";
import { requirePermission } from "@/lib/erp/auth";
import { closableYears, closingPlan } from "@/lib/erp/closing";

export const dynamic = "force-dynamic";

/**
 * The Fiscal Year Closing workspace.
 *
 * Bespoke rather than registry: this is not a record with fields. It is a
 * checklist, a preview of an entry, and one irreversible act against a year.
 *
 * The year lives in the URL, so a run is linkable and the page stays a Server
 * Component querying directly. A year the reader has not chosen yet means no
 * plan at all, which is a different screen from a plan that is blocked.
 */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ year?: string }>;
}) {
  const actor = await requirePermission("FISCAL_YEAR_CLOSE", "/accounting/closing");
  const { year } = await searchParams;

  const years = await closableYears();

  // A `?year=` naming something that cannot be asked to close is ignored
  // rather than refused: the parameter is a navigation, and the screen falls
  // back to asking which year rather than to an error.
  const requested = Number(year);
  const yearId = years.some((y) => y.id === requested) ? requested : null;

  const plan = yearId ? await closingPlan(yearId) : null;

  return (
    <ClosingWorkspace
      plan={plan}
      years={years}
      yearId={yearId}
      canClose={actor.permissions.has("FISCAL_YEAR_CLOSE")}
    />
  );
}
