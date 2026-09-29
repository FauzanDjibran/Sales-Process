"use server";

import { actorOrDeny } from "@/lib/erp/auth";
import { actorCan } from "@/lib/erp/access";
import { isAccessDenied } from "@/lib/erp/auth-errors";
import { entityPermissions } from "@/lib/erp/entity-access";
import { regionOptions, type RegionLevel, type RegionOption } from "@/lib/erp/partner";

const LEVELS: RegionLevel[] = ["province", "city", "district", "village"];

/**
 * The regions under one parent, for the address dialog's cascading pickers.
 *
 * Fetched a level at a time because the whole of Indonesia is ~91.000 rows —
 * far too many to send with the page. Reference data only, but still behind
 * the permission to write a Partner, which is the only screen that asks.
 */
export async function loadRegions(
  level: RegionLevel,
  parentId: number | null
): Promise<RegionOption[]> {
  if (!LEVELS.includes(level)) return [];
  try {
    const actor = await actorOrDeny();
    const perms = entityPermissions("m_partner");
    const allowed = [perms.create, perms.edit].some(
      (code) => code && actorCan(actor, code)
    );
    if (!allowed) return [];
  } catch (error) {
    if (isAccessDenied(error)) return [];
    throw error;
  }
  return regionOptions(level, parentId == null ? null : Number(parentId));
}
