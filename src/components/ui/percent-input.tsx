"use client";

import { MoneyInput } from "./money-input";

/**
 * The percent field — a discount, a Jenis PPh's tarif, an advance's share of
 * its order, the PPN rate.
 *
 * **It is `MoneyInput`** with two differences. A `%` sits inside the box on the
 * right, where it is read — after the figure — so a percent can never be taken
 * for an amount beside it. And the field **refuses a keystroke that would take
 * the figure past `max`** (100 by default): the figure simply does not change,
 * the same way a letter typed into an amount does not appear. Anything that is
 * not a digit or the decimal comma is already dropped by `MoneyInput`, so the
 * field only ever holds 0 to `max`.
 *
 * Whether 0 or exactly 100 is acceptable for a given figure (a discount must
 * stay below 100 %) remains the Server Action's rule; the field only stops a
 * number no percent can be.
 */
export function PercentInput({
  value,
  onChange,
  decimals = 2,
  max = 100,
  size = "field",
  invalid,
  disabled,
  placeholder = "0",
  ariaLabel,
}: {
  /** Unformatted with a `.` decimal point, e.g. `"1.5"` or `""`. */
  value: string;
  onChange: (value: string) => void;
  decimals?: number;
  max?: number;
  size?: "field" | "sm";
  invalid?: boolean;
  disabled?: boolean;
  placeholder?: string;
  ariaLabel?: string;
}) {
  return (
    <span className={`pwrap${size === "sm" ? " sm" : ""}`}>
      <MoneyInput
        value={value}
        onChange={(next) => {
          // `next` is already a plain figure with a `.` decimal point.
          if (Number(next.replace(/\.$/, "")) > max) return;
          onChange(next);
        }}
        size={size}
        decimals={decimals}
        invalid={invalid}
        disabled={disabled}
        placeholder={placeholder}
        ariaLabel={ariaLabel}
      />
      <span className="pct">%</span>
    </span>
  );
}
