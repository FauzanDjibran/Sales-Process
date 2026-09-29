import { SystemDefaultForm } from "@/components/settings/system-default-form";
import { actorCan } from "@/lib/erp/access";
import { requirePermission } from "@/lib/erp/auth";
import { settingOptions, systemDefaults } from "@/lib/erp/system-settings";

export const dynamic = "force-dynamic";

/**
 * Account Mapping — where each kind of posting lands (P61): the FX difference
 * account and the two Laba/Rugi equity accounts today, more as the documents
 * that post them are built. PPh accounts sit on each Jenis PPh, item accounts
 * on the Kategori Item mapping.
 */
export default async function AccountMappingPage() {
  await requirePermission("MENU_ACCOUNT_MAPPING_ACCESS", "/accounting/account-mapping");
  const actor = await requirePermission("ACCOUNT_MAPPING_VIEW", "/accounting/account-mapping");
  const values = await systemDefaults();
  return (
    <SystemDefaultForm
      page="account"
      values={values}
      options={await settingOptions(values)}
      canEdit={actorCan(actor, "ACCOUNT_MAPPING_EDIT")}
    />
  );
}
