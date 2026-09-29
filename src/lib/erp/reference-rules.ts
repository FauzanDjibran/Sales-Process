/**
 * The value rules of the small reference masters, beyond "required".
 *
 * Client-safe and pure, so a test can prove them without a session and the
 * Server Action (`app/actions/master.ts`) applies exactly these. Each returns
 * the error message, or null when the value is acceptable.
 */

/** Longest term the application accepts: ten years of days. */
export const MAX_TERM_DAYS = 3650;

/** A Termin Pembayaran's days: a whole number, 0 (Tunai) up to ten years. */
export function paymentTermDaysError(days: number | null): string | null {
  if (days == null || !Number.isInteger(days) || days < 0 || days > MAX_TERM_DAYS) {
    return `Jumlah Hari harus bilangan bulat 0 sampai ${MAX_TERM_DAYS}.`;
  }
  return null;
}

/** A Jenis PPh's rate, in percent: above 0 and at most 100. */
export function withholdingRateError(rate: number | null): string | null {
  if (rate == null || !Number.isFinite(rate) || rate <= 0 || rate > 100) {
    return "Tarif harus lebih dari 0% dan paling besar 100%.";
  }
  return null;
}
