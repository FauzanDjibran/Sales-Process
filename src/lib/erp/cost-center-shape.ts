/**
 * An Overhead Cost Center's spread on its way between the form and the Server
 * Action, and the rules both sides apply to it (P159, M93).
 *
 * An Overhead Cost Center is never a workstation's pool: the month-end close
 * spreads its balance over the Production Cost Centers — *Rata* (evenly over
 * those active at the close) or *Persentase* (the rows below, 100 in all).
 *
 * Client-safe on purpose — no `server-only`, no database — so the dialog
 * refuses exactly what the Server Action refuses.
 */

import { formatPct } from "@/lib/format";

export type CostCenterTypeValue = "Production" | "Overhead" | "Administrative";

/** One share as the form holds it. */
export type SpreadDraft = {
  /** The saved row, or absent for a share added in this edit. */
  id?: number;
  /** Stable within the form, so a row survives removal of another. */
  key: string;
  /** The Production Cost Center it goes to. */
  costCenterId: number | null;
  /** Unformatted with a `.` decimal point, as `PercentInput` holds it. */
  percent: string;
};

/** The form value the collection travels under. */
export const SPREADS_KEY = "_spreads";

/** The option set the Alokasi tab picks from: active Production Cost Centers. */
export const SPREAD_TARGETS_REF = "_spread_targets";

/** Percent in ten-thousandths, the four decimals `Decimal(9,4)` holds, so 100 is compared exactly. */
export const percentUnits = (raw: string | number | null | undefined): number | null => {
  const n = Number(String(raw ?? "").trim());
  if (String(raw ?? "").trim() === "" || !Number.isFinite(n)) return null;
  return Math.round(n * 10000);
};

/**
 * Field errors for one share, keyed by the dialog's field names. `taken` are
 * the Production Cost Centers the other rows already name.
 */
export function spreadRowErrors(row: Partial<SpreadDraft>, taken: number[]): Record<string, string> {
  const e: Record<string, string> = {};
  if (!row.costCenterId) e.costCenterId = "Pilih Cost Center Produksi.";
  else if (taken.includes(row.costCenterId)) e.costCenterId = "Cost Center ini sudah ada di alokasi.";
  const units = percentUnits(row.percent);
  if (units == null || units <= 0) e.percent = "Isi persentase lebih dari 0.";
  else if (units > 1_000_000) e.percent = "Persentase paling besar 100.";
  return e;
}

/** The spread's total, or the refusal when it is not exactly 100. */
export function spreadTotalProblem(rows: Pick<SpreadDraft, "percent">[]): string | null {
  if (!rows.length) return "Alokasi Persentase butuh minimal satu Cost Center Produksi.";
  const total = rows.reduce((s, r) => s + (percentUnits(r.percent) ?? 0), 0);
  if (total !== 1_000_000) {
    return `Jumlah alokasi harus tepat 100% — sekarang ${formatPct(total / 10000)}.`;
  }
  return null;
}
