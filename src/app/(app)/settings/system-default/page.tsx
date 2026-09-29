import { SystemDefaultForm } from "@/components/settings/system-default-form";
import { actorCan } from "@/lib/erp/access";
import { requirePermission } from "@/lib/erp/auth";
import { baseCurrency, settingOptions, systemDefaults } from "@/lib/erp/system-settings";

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
  const [options, base] = await Promise.all([settingOptions(values), baseCurrency()]);
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
