/**
 * An Item's unit conversions on their way between the form and the Server
 * Action, and the rules both sides apply to them.
 *
 * Client-safe on purpose — no `server-only`, no database — so the dialog
 * refuses exactly what the Server Action refuses (Claude-ERP.md P46).
 */

/** One alternate unit as the form holds it. */
export type UomDraft = {
  /** The saved row, or absent for a conversion added in this edit. */
  id?: number;
  /** Stable within the form, so a row survives removal of another. */
  key: string;
  uomId: number | null;
  /** Base units in one of this unit, `.` decimal, e.g. `"12"` or `"0.5"`. */
  factor: string;
  /** For display only — the server re-reads it. */
  uomLabel: string;
  uomName: string;
};

/** The form value the collection travels under. */
export const UOMS_KEY = "_uoms";

/** `Decimal(18,4)`: fourteen digits before the point, four after. */
const FACTOR_MAX = 99_999_999_999_999;

/**
 * Field errors for one conversion, keyed by the dialog's field names.
 *
 * `baseUomId` is the item's base unit, which cannot be converted into itself;
 * `takenUomIds` are the units the item's other conversions already use.
 */
export function uomErrors(
  u: Partial<UomDraft>,
  baseUomId: number | null,
  takenUomIds: number[]
): Record<string, string> {
  const e: Record<string, string> = {};
  const uomId = Number(u.uomId) || null;
  if (!uomId) e.uom = "Satuan wajib dipilih.";
  else if (baseUomId && uomId === baseUomId) {
    e.uom = "Satuan dasar tidak perlu dikonversi ke dirinya sendiri.";
  } else if (takenUomIds.includes(uomId)) {
    e.uom = "Satuan ini sudah punya konversi.";
  }

  const raw = String(u.factor ?? "").trim();
  const factor = Number(raw);
  if (!raw) e.factor = "Faktor wajib diisi.";
  else if (!Number.isFinite(factor) || factor <= 0) e.factor = "Faktor harus lebih besar dari nol.";
  else if (factor > FACTOR_MAX) e.factor = "Faktor terlalu besar.";
  else if (!/^\d+(\.\d{1,4})?$/.test(raw)) e.factor = "Faktor paling banyak empat angka di belakang koma.";
  return e;
}
