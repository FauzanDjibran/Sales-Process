/**
 * A Standard Cost's lines on their way between the form and the Server
 * Action, and the rules both sides apply to them (P160, M109).
 *
 * A Standard Cost is a workstation's rates from a period on: one line per
 * Standard Cost Item, Rp per Driver. The Eksekusi Produksi books Driver ×
 * each rate to the item's account with the workstation's Cost Center.
 *
 * Client-safe on purpose — no `server-only`, no database — so the dialog
 * refuses exactly what the Server Action refuses.
 */

/** One line as the form holds it. */
export type StandardCostLineDraft = {
  /** The saved row, or absent for a line added in this edit. */
  id?: number;
  /** Stable within the form, so a row survives removal of another. */
  key: string;
  itemId: number | null;
  /** Unformatted with a `.` decimal point, as `RateInput` holds it. */
  rate: string;
};

/** The form value the collection travels under. */
export const LINES_KEY = "_lines";

/** The option set the Item tab picks from: the Standard Cost Items. */
export const ITEM_OPTIONS_REF = "_standard_cost_items";

/** Field errors for one line, keyed by the dialog's field names. `taken` are the items the other lines name. */
export function standardCostLineErrors(line: Partial<StandardCostLineDraft>, taken: number[]): Record<string, string> {
  const e: Record<string, string> = {};
  if (!line.itemId) e.itemId = "Pilih Standard Cost Item.";
  else if (taken.includes(line.itemId)) e.itemId = "Item ini sudah ada di Standard Cost ini.";
  const raw = String(line.rate ?? "").trim();
  const rate = Number(raw);
  if (raw === "" || !Number.isFinite(rate)) e.rate = "Isi tarif per Driver; 0 berarti tanpa standar.";
  else if (rate < 0) e.rate = "Tarif tidak boleh negatif.";
  return e;
}
