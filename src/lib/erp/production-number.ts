/**
 * Walet's production numbering (`production_project.md` M124) — the user's
 * deviation-check answer **D**, a Walet-only exception to P15's
 * `PREFIX/YYYY/MM/NNNN`. Every other document keeps P15.
 *
 * - **Daily series** `<part>_…_<DDMMYY>_<NNNNN>`, one series per its parts and
 *   day: Partai `P_150526_00001`, Perintah `PP_…`, Job `UGH_150526_00001`
 *   (the Kode Job of the workstation that made it, M126), BSTB
 *   `BSTB_UPW_150526_00001` and Eksekusi `NG_UCL_150526_00001` (the unit).
 * - **Lots**: `<unit>_<supplier>_<kode barang>_<DDMMYY>` (the supplier left out
 *   when none is behind it), or `<partai>_<kode barang>` after a mix; a number
 *   already in the register takes `-2`, `-3`, … (`freeNumber`).
 *
 * As `document-number.ts`: the format lives here, the query stays with the
 * module that owns the table, so the series is read through a callback. Pure,
 * client-safe, no database import.
 */

/** A `Date` or `YYYY-MM-DD` day as `DDMMYY`, in UTC. */
export function ddmmyy(date: Date | string): string {
  const iso = date instanceof Date ? date.toISOString() : String(date);
  return `${iso.slice(8, 10)}${iso.slice(5, 7)}${iso.slice(2, 4)}`;
}

const part = (p: string) => String(p).trim().toUpperCase();

/** `["BSTB", "UPW"]` + 2026-05-15 -> `BSTB_UPW_150526_`, what one day's series shares. */
export function dailySeries(parts: string[], date: Date | string): string {
  if (!parts.length || parts.some((p) => !part(p))) throw new Error("Seri penomoran produksi tidak lengkap.");
  return `${parts.map(part).join("_")}_${ddmmyy(date)}_`;
}

/** `["P"]`, 2026-05-15, 1 -> `P_150526_00001`. Padded to five, longer beyond. */
export function formatDailyNumber(parts: string[], date: Date | string, sequence: number): string {
  return `${dailySeries(parts, date)}${String(sequence).padStart(5, "0")}`;
}

/** The numeric tail after the last `_`, or 0 for anything unreadable. */
export function dailySequence(no: string | null | undefined): number {
  if (!no) return 0;
  const n = Number(no.slice(no.lastIndexOf("_") + 1));
  return Number.isInteger(n) && n > 0 ? n : 0;
}

/**
 * The next number in a day's series. `highest` gets the series and returns its
 * highest number (a `findFirst` on that prefix ordered by id descending); the
 * column's unique constraint catches two posters reading the same one.
 */
export async function nextDailyNumber(
  parts: string[],
  date: Date | string,
  highest: (series: string) => Promise<string | null>
): Promise<string> {
  return formatDailyNumber(parts, date, dailySequence(await highest(dailySeries(parts, date))) + 1);
}

/** A lot made from stock lots: `<unit>_<supplier>_<kode barang>_<DDMMYY>`, the supplier only when one is behind it. */
export function lotNumberBase(l: { unit: string; supplier?: string | null; itemCode: string; date: Date | string }): string {
  const parts = [l.unit, ...(l.supplier ? [l.supplier] : []), l.itemCode].map(part);
  if (parts.some((p) => !p)) throw new Error("Nomor lot tidak lengkap.");
  return `${parts.join("_")}_${ddmmyy(l.date)}`;
}

/** A lot made by a mix (the No. Moulding, M125): `<partai>_<kode barang>`. */
export function mixLotNumber(partaiNo: string, itemCode: string): string {
  if (!part(partaiNo) || !part(itemCode)) throw new Error("Nomor lot tidak lengkap.");
  return `${part(partaiNo)}_${part(itemCode)}`;
}

/** `base` if free, else `base-2`, `base-3`, … — the first one `taken` says is free. */
export async function freeNumber(base: string, taken: (no: string) => Promise<boolean>): Promise<string> {
  const b = part(base);
  if (!(await taken(b))) return b;
  for (let n = 2; ; n++) if (!(await taken(`${b}-${n}`))) return `${b}-${n}`;
}
