/**
 * Small pure helpers of the Rencana Produksi that a client component and the
 * server both read (P168). Client-safe: no database import.
 */

const MONTHS = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];

/** `2026-11` → *November 2026*. */
export const periodText = (ym: string) => `${MONTHS[Number(ym.slice(5, 7)) - 1] ?? ""} ${ym.slice(0, 4)}`;

/** The month after today, `YYYY-MM` — a plan is made at month's end for the next. */
export function nextMonth(todayIso: string): string {
  const y = Number(todayIso.slice(0, 4));
  const m = Number(todayIso.slice(5, 7));
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
}

/** The twelve months from last month on, for the period picker. */
export function periodChoices(todayIso: string, extra: string[] = []): { value: string; label: string }[] {
  let y = Number(todayIso.slice(0, 4));
  let m = Number(todayIso.slice(5, 7)) - 1;
  if (m < 1) {
    m = 12;
    y -= 1;
  }
  const out = new Set<string>(extra);
  for (let i = 0; i < 14; i++) {
    out.add(`${y}-${String(m).padStart(2, "0")}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return [...out].sort().map((value) => ({ value, label: periodText(value) }));
}

/** What a plan line should be, suggested: the demand it covers less what stock holds, never below 0. */
export const suggestedQty = (demand: number, stock: number) => Math.max(0, Math.round((demand - stock) * 10_000) / 10_000);
