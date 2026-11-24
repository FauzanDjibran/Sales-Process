/**
 * Weighing at the Receipt Note (P321, `Purchase-UOM-Plan.md` §3): the supplier
 * says how many came (Qty SJ), the scale says what they weigh, and the item's
 * Berat Satuan and Toleransi decide what is received.
 *
 * Within tolerance, its edges included, the SJ is taken as it is. Above it, the
 * SJ is taken and what weighs beyond the upper edge is a bonus. Below it, only
 * what the scale says is taken. Quantities made from a weight are rounded down
 * at the fourth decimal of the base unit: what is not whole is not received.
 *
 * Client-safe on purpose — no `server-only`, no database import — so the dialog
 * shows exactly what the save stores and Posting checks.
 */

/** The item's setting, or the copy of it a weighing keeps. */
export type WeighingRule = { itemWeight: number; tolerance: number };

export type WeighingResult = "Within" | "Above" | "Below";

export const WEIGHING_RESULT_TEXT: Record<WeighingResult, string> = {
  Within: "Dalam Toleransi",
  Above: "Di atas Toleransi",
  Below: "Di bawah Toleransi",
};

export type Weighing = {
  /** Qty Pembanding, what the SJ should weigh, in Kg. */
  calculated: number;
  lower: number;
  upper: number;
  result: WeighingResult;
  /** Qty Terima in the PO line's unit (six decimals) and in base units (four). */
  received: number;
  receivedBase: number;
  /** Beyond the upper edge, in base units. */
  bonus: number;
};

const micro = (n: number) => Math.round(n * 1_000_000);
const round6 = (n: number) => micro(n) / 1_000_000;
/** Down to four decimals; a float a hair under a whole step counts as that step. */
const down4 = (n: number) => Math.floor(n * 10_000 + 1e-6) / 10_000;

/** `sj` is in the PO line's unit, `sjBase` the same in base units, `scale` in Kg. */
export function weigh(input: { sj: number; sjBase: number; factor: number; scale: number; rule: WeighingRule }): Weighing {
  const { itemWeight, tolerance } = input.rule;
  const calculated = round6(input.sjBase * itemWeight);
  const lower = round6(calculated * (1 - tolerance / 100));
  const upper = round6(calculated * (1 + tolerance / 100));
  const result: WeighingResult = micro(input.scale) < micro(lower) ? "Below" : micro(input.scale) > micro(upper) ? "Above" : "Within";
  // Never more than the SJ: a scale just under the edge may divide back to it.
  const receivedBase = result === "Below" ? Math.min(down4(input.scale / itemWeight), input.sjBase) : input.sjBase;
  return {
    calculated,
    lower,
    upper,
    result,
    receivedBase,
    received: receivedBase === input.sjBase ? input.sj : round6(receivedBase / input.factor),
    bonus: result === "Above" ? down4((input.scale - upper) / itemWeight) : 0,
  };
}
