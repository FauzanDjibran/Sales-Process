/**
 * A Perintah Produksi's material requirements (P165, P166): what its BoMs ask
 * for to make its Qty Target of its Item Target, per item and per station.
 *
 * - **Which BoMs:** a BoM knows the workstation it is used at, so for each step
 *   of the Perintah's route the **default active BoM of the Item Target at
 *   that step's workstation** — once per workstation, at the first step that
 *   reaches it. A station without one adds nothing; a route without any gives
 *   no requirement, and what goes in is free.
 * - **How much:** a BoM line's quantity × Qty Target ÷ the BoM's base
 *   quantity, in the component's base unit, rounded half up to 4 decimals
 *   (`Decimal(18, 4)`). Lines of one item at one step add up.
 * - **Where:** that step and its workstation; a BSTB to the workstation
 *   pre-fills it.
 *
 * Client-safe on purpose — no `server-only`, no database — so the form shows
 * exactly the requirements Simpan stores.
 */

export type RequirementBom = {
  id: number;
  itemId: number;
  workstationId: number;
  /** The output quantity its lines are for. */
  baseQty: number;
  isDefault: boolean;
  active: boolean;
  lines: { itemId: number; qty: number }[];
};

export type RequirementStep = { workstationId: number | null };

export type Requirement = { itemId: number; qty: number; stepNo: number | null; workstationId: number | null; bomId: number };

const SCALE = 10_000;

/** The default active BoM of an item at a workstation, if it has one. */
export function stationBom<B extends RequirementBom>(itemId: number | null, workstationId: number | null, boms: B[]): B | undefined {
  if (!itemId || !workstationId) return undefined;
  return boms.find((b) => b.itemId === itemId && b.workstationId === workstationId && b.isDefault && b.active);
}

export function orderRequirements(targetItemId: number | null, targetQty: number, steps: RequirementStep[], boms: RequirementBom[]): Requirement[] {
  if (!targetItemId || !(targetQty > 0)) return [];
  const out = new Map<string, Requirement>();
  const seen = new Set<number>();
  for (const [at, step] of steps.entries()) {
    if (!step.workstationId || seen.has(step.workstationId)) continue;
    seen.add(step.workstationId);
    const bom = stationBom(targetItemId, step.workstationId, boms);
    if (!bom || !(bom.baseQty > 0)) continue;
    for (const line of bom.lines) {
      const qty = Math.round(((line.qty * targetQty) / bom.baseQty) * SCALE) / SCALE;
      const key = `${line.itemId}|${at}`;
      const had = out.get(key);
      if (had) had.qty = Math.round((had.qty + qty) * SCALE) / SCALE;
      else out.set(key, { itemId: line.itemId, qty, stepNo: at + 1, workstationId: step.workstationId, bomId: bom.id });
    }
  }
  return [...out.values()];
}

/** The key a requirement and what was sent for it meet on: item and workstation. */
export const requirementKey = (itemId: number, workstationId: number | null) => `${itemId}|${workstationId ?? 0}`;
