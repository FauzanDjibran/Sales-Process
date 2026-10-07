/**
 * A Gudang's locations on their way between the form and the Server Action,
 * and the rules both sides apply to them.
 *
 * Client-safe on purpose — no `server-only`, no database — so the dialog
 * refuses exactly what the Server Action refuses.
 */

/** One location as the form holds it. */
export type LocationDraft = {
  /** The saved row, or absent for a location added in this edit. */
  id?: number;
  /** Stable within the form, so a row survives removal of another. */
  key: string;
  /** The system code, `loc.NNNN`; empty until saved. */
  code: string;
  /** Its own label, unique within the warehouse — shown as `<gudang>-<label>`. */
  label: string;
  name: string;
  status: "Active" | "Inactive";
  /** Stock has moved through it, or a document names it: it can be deactivated, never removed. */
  used?: boolean;
};

/** The form value the collection travels under. */
export const LOCATIONS_KEY = "_locations";

const LABEL_MAX = 40;
const NAME_MAX = 120;

/**
 * Field errors for one location, keyed by the dialog's field names.
 * `takenLabels` are the warehouse's other locations' labels.
 */
export function locationErrors(l: Partial<LocationDraft>, takenLabels: string[]): Record<string, string> {
  const e: Record<string, string> = {};
  const label = String(l.label ?? "").trim();
  if (!label) e.label = "Label wajib diisi.";
  else if (label.length > LABEL_MAX) e.label = `Label paling panjang ${LABEL_MAX} karakter.`;
  else if (/\s/.test(label)) e.label = "Label tanpa spasi, mis. A-01-03.";
  else if (takenLabels.some((t) => t.trim().toUpperCase() === label.toUpperCase())) e.label = "Label ini sudah dipakai lokasi lain di gudang ini.";
  const name = String(l.name ?? "").trim();
  if (!name) e.name = "Nama lokasi wajib diisi.";
  else if (name.length > NAME_MAX) e.name = `Nama paling panjang ${NAME_MAX} karakter.`;
  return e;
}
