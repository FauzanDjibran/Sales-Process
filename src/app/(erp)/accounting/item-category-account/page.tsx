import { ItemCategoryAccountForm } from "@/components/settings/item-category-account-form";
import { actorCan } from "@/lib/erp/access";
import { requirePermission } from "@/lib/erp/auth";
import { itemCategoryAccounts } from "@/lib/erp/item-account";
import { settingOptions, systemDefaults } from "@/lib/erp/system-settings";

export const dynamic = "force-dynamic";

/**
 * Accounts per Kategori Item (P122, closes C25): Persediaan, HPP and Beban for
 * each category, falling back to Account Mapping where a category names none.
 * Under Accounting › Pengaturan beside Account Mapping, on its permissions.
 */
export default async function ItemCategoryAccountPage() {
  await requirePermission("MENU_ACCOUNT_MAPPING_ACCESS", "/accounting/item-category-account");
  const actor = await requirePermission("ACCOUNT_MAPPING_VIEW", "/accounting/item-category-account");
  const values = await systemDefaults();
  const options = await settingOptions(values);
  return (
    <ItemCategoryAccountForm
      rows={await itemCategoryAccounts()}
      // Every postable account, active ones offered; the Account Mapping list is the same set.
      accounts={options.inventory_account}
      fallback={{ inventory: Number(values.inventory_account) || null, cogs: Number(values.cogs_account) || null }}
      canEdit={actorCan(actor, "ACCOUNT_MAPPING_EDIT")}
    />
  );
}
