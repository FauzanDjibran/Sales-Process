import { SystemDefaultForm } from "@/components/settings/system-default-form";
import { actorCan } from "@/lib/erp/access";
import { requirePermission } from "@/lib/erp/auth";
import { baseCurrency, settingOptions, systemDefaults } from "@/lib/erp/system-settings";
import { costCentersByIds, overheadCostCenterOptions } from "@/lib/erp/cost-center";
import { refValueOf } from "@/lib/erp/system-defaults";

export const dynamic = "force-dynamic";

/**
 * System Default — application-wide configuration: the base currency the books
 * are measured in (shown, never set) and the PPN rate and factor every taxable
 * document snapshots (P60, P61). Where postings land is Account Mapping's.
 *
 * Reaching the menu and reading the values are separate permissions, the same
 * split every other module uses, and editing is a third.
 */
export default async function SystemDefaultPage() {
  await requirePermission("MENU_SYSTEM_DEFAULT_ACCESS", "/settings/system-default");
  const actor = await requirePermission("SYSTEM_DEFAULT_VIEW", "/settings/system-default");
  const values = await systemDefaults();
  const [options, base, overheadOptions] = await Promise.all([settingOptions(values), baseCurrency(), overheadCostCenterOptions()]);
  // The overhead Cost Center (P160) is offered from its own module; the one
  // chosen stays listed even if it no longer qualifies, so the page reads it.
  const chosen = refValueOf(values, "production_overhead_cost_center");
  const current = chosen && !overheadOptions.some((o) => o.id === chosen) ? [...(await costCentersByIds([chosen])).values()] : [];
  options.production_overhead_cost_center = [...overheadOptions, ...current];
  return (
    <SystemDefaultForm
      page="default"
      values={values}
      options={options}
      baseCurrency={base}
      canEdit={actorCan(actor, "SYSTEM_DEFAULT_EDIT")}
    />
  );
}
