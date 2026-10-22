/**
 * A Perintah Produksi's material requirements (P165): what its BoMs ask for
 * to make its Qty Target of its Item Target, per item and per route step.
 *
 * - **Which BoMs:** every BoM a step of the Perintah's route names, each once;
 *   when no step names one, the Item Target's default BoM. None → no
 *   requirement, and what goes in is free.
 * - **How much:** a BoM line's quantity × Qty Target ÷ the BoM's base
 *   quantity, in the component's base unit, rounded half up to 4 decimals
 *   (`Decimal(18, 4)`). Lines of one item at one step add up.
 * - **Where:** the step the BoM line names (its `step_no`, a place in the
 *   route); else the first step that names the BoM; else, for the default BoM,
 *   the route's last step. A BSTB to that step's workstation pre-fills it.
 *
 * Client-safe on purpose — no `server-only`, no database — so the form shows
 * exactly the requirements Simpan stores.
 */

export type RequirementBom = {
  id: number;
  itemId: number;
  /** The output quantity its lines are for. */
  baseQty: number;
  isDefault: boolean;
  active: boolean;
  lines: { itemId: number; qty: number; stepNo: number | null }[];
};

export type RequirementStep = { workstationId: number | null; bomId: number | null };

export type Requirement = { itemId: number; qty: number; stepNo: number | null; workstationId: number | null; bomId: number };

const SCALE = 10_000;

export function orderRequirements(targetItemId: number | null, targetQty: number, steps: RequirementStep[], boms: RequirementBom[]): Requirement[] {
  if (!targetItemId || !(targetQty > 0)) return [];
  const byId = new Map(boms.map((b) => [b.id, b]));
  const named = [...new Set(steps.map((s) => s.bomId).filter((id): id is number => id != null && byId.has(id)))].map((id) => byId.get(id)!);
  const fallback = named.length ? null : boms.find((b) => b.itemId === targetItemId && b.isDefault && b.active);
  const used = fallback ? [fallback] : named;

  const out = new Map<string, Requirement>();
  for (const bom of used) {
    if (!(bom.baseQty > 0)) continue;
    const firstNaming = steps.findIndex((s) => s.bomId === bom.id);
    for (const line of bom.lines) {
      let at = line.stepNo != null && line.stepNo >= 1 && line.stepNo <= steps.length ? line.stepNo - 1 : -1;
      if (at < 0) at = firstNaming >= 0 ? firstNaming : bom === fallback && steps.length ? steps.length - 1 : -1;
      const stepNo = at >= 0 ? at + 1 : null;
      const qty = Math.round(((line.qty * targetQty) / bom.baseQty) * SCALE) / SCALE;
      const key = `${line.itemId}|${stepNo ?? 0}`;
      const had = out.get(key);
      if (had) had.qty = Math.round((had.qty + qty) * SCALE) / SCALE;
      else out.set(key, { itemId: line.itemId, qty, stepNo, workstationId: at >= 0 ? (steps[at].workstationId ?? null) : null, bomId: bom.id });
    }
  }
  return [...out.values()].sort((a, b) => (a.stepNo ?? 9999) - (b.stepNo ?? 9999));
}

/** The key a requirement and what was sent for it meet on: item and workstation. */
export const requirementKey = (itemId: number, workstationId: number | null) => `${itemId}|${workstationId ?? 0}`;
