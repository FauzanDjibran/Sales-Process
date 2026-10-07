/**
 * How a warehouse location reads wherever it stands alone — a picker, a
 * document: `<warehouse label>-<location label>`, e.g. `GD-CKR-A-01-03`. The
 * location stores only its own label, so relabelling a warehouse relabels its
 * locations. Reports show Gudang and Lokasi as two columns instead.
 *
 * Client-safe: no database, so a form composes it exactly as the server does.
 */
export function locationDisplayLabel(warehouseLabel: string, locationLabel: string): string {
  return `${warehouseLabel}-${locationLabel}`;
}

/** The key of a lot in a location — a stock bucket within a warehouse — as `LotOption.key`. */
export const lotKey = (lotId: number, locationId: number | null | undefined) => `${lotId}:${locationId ?? 0}`;
