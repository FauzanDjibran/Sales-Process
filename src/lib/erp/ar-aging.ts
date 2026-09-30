/**
 * Umur Piutang's buckets (P75) — how late an open invoice is at a date.
 *
 * Counted from the invoice's due date, not its date: an invoice on 60-day
 * terms is not overdue at day 45, and a report that aged it from the invoice
 * date would call a customer who pays on time late. An item without a due date
 * is treated as due on its own date.
 *
 * Client-safe and pure, so the report and its test read the same rule.
 */

export type AgingBucket = "current" | "d30" | "d60" | "d90" | "over90";

export const AGING_BUCKETS: { key: AgingBucket; label: string }[] = [
  { key: "current", label: "Belum Jatuh Tempo" },
  { key: "d30", label: "1–30 hari" },
  { key: "d60", label: "31–60 hari" },
  { key: "d90", label: "61–90 hari" },
  { key: "over90", label: "> 90 hari" },
];

/** Whole days from `due` to `asOf`; negative when not yet due. */
export function daysOverdue(due: string, asOf: string): number {
  const ms = Date.parse(`${asOf}T00:00:00Z`) - Date.parse(`${due}T00:00:00Z`);
  return Math.round(ms / 86_400_000);
}

export function agingBucket(due: string, asOf: string): AgingBucket {
  const d = daysOverdue(due, asOf);
  if (d <= 0) return "current";
  if (d <= 30) return "d30";
  if (d <= 60) return "d60";
  if (d <= 90) return "d90";
  return "over90";
}
