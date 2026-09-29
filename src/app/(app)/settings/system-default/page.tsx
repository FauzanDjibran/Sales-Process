import { SystemDefaultForm } from "@/components/settings/system-default-form";
import { prisma } from "@/lib/prisma";
import { actorCan } from "@/lib/erp/access";
import { requirePermission } from "@/lib/erp/auth";
import type { RefOption } from "@/lib/erp/records";
import {
  SYSTEM_DEFAULTS,
  type SystemDefaultDef,
  type SystemDefaultKey,
  type SystemDefaultValues,
} from "@/lib/erp/system-defaults";
import { systemDefaults } from "@/lib/erp/system-settings";

export const dynamic = "force-dynamic";

/**
 * System Default — the values the application prefills with, plus the
 * accounts the FX difference and the year-end result are posted to.
 *
 * Reaching the menu and reading the values are separate permissions, the same
 * split every other module uses, and editing is a third.
 */
export default async function SystemDefaultPage() {
  await requirePermission("MENU_SYSTEM_DEFAULT_ACCESS", "/settings/system-default");
  const actor = await requirePermission(
    "SYSTEM_DEFAULT_VIEW",
    "/settings/system-default"
  );

  const values = await systemDefaults();

  const options = {} as Record<SystemDefaultKey, RefOption[]>;
  for (const def of SYSTEM_DEFAULTS) {
    options[def.key] = await optionsFor(def, values);
  }

  return (
    <SystemDefaultForm
      values={values}
      options={options}
      canEdit={actorCan(actor, "SYSTEM_DEFAULT_EDIT")}
    />
  );

  /**
   * Exactly what the setting's own rules admit — active records, plus whatever is already stored even if it has since been
   * deactivated, so a page that opens on a stale value still shows what it is
   * rather than an empty box.
   */
  async function optionsFor(
    def: SystemDefaultDef,
    current: SystemDefaultValues
  ): Promise<RefOption[]> {
    const chosen = Number(current[def.key] ?? "");
    const keep = (id: number, active: boolean) => active || id === chosen;

    if (def.ref === "ref_withholding_tax") {
      const rows = await prisma.refWithholdingTax.findMany({
        orderBy: { wht_label: "asc" },
      });
      return rows
        .filter((t) => keep(t.id, t.status === "Active"))
        .map((t) => ({
          id: t.id,
          label: t.wht_label,
          name: t.wht_name,
          active: t.status === "Active",
        }));
    }

    if (def.ref === "ref_currency") {
      const rows = await prisma.refCurrency.findMany({
        orderBy: { currency_label: "asc" },
      });
      return rows
        .filter((c) => keep(c.id, c.status === "Active"))
        .map((c) => ({
          id: c.id,
          label: c.currency_label,
          name: c.currency_name,
          active: c.status === "Active",
        }));
    }

    const rows = await prisma.accAccount.findMany({
      where: { is_postable: true },
      orderBy: { account_label: "asc" },
    });
    return rows
      .filter((a) => keep(a.id, a.is_active))
      .map((a) => ({
        id: a.id,
        label: a.account_label,
        name: a.account_name,
        active: a.is_active,
      }));
  }
}
