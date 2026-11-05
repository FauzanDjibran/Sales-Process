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

export type AgingRow = {
  id: number;
  partnerId: number;
  partnerLabel: string;
  partnerName: string;
  date: string;
  dueDate: string | null;
  open: number;
  sourceNo: string;
  sourceTable: string;
  sourceId: number;
};

export type AgingDoc = AgingRow & { due: string; days: number; bucket: AgingBucket };

export type AgingFigures = { buckets: Record<AgingBucket, number>; invoice: number; advance: number; net: number };

export type AgingPartner = AgingFigures & {
  partnerId: number;
  label: string;
  name: string;
  /** Oldest due first: the first to chase. */
  invoices: AgingDoc[];
  advances: AgingRow[];
};

export type AgingReport = { partners: AgingPartner[]; totals: AgingFigures };

const nil = (): AgingFigures => ({ buckets: { current: 0, d30: 0, d60: 0, d90: 0, over90: 0 }, invoice: 0, advance: 0, net: 0 });

function toRupiah(f: AgingFigures): void {
  for (const b of AGING_BUCKETS) f.buckets[b.key] /= 100;
  f.net = (f.invoice - f.advance) / 100;
  f.invoice /= 100;
  f.advance /= 100;
}

/**
 * The tree of the Umur reports (P235): one row per partner, one per document
 * under it. An Uang Muka has no due date, so it is not aged: it stands in its
 * own column and only the net takes it. Added in whole cents.
 */
export function foldAging(invoices: AgingRow[], advances: AgingRow[], asOf: string): AgingReport {
  const partners = new Map<number, AgingPartner>();
  const totals = nil();
  const partnerOf = (r: AgingRow) =>
    partners.get(r.partnerId) ??
    partners
      .set(r.partnerId, { ...nil(), partnerId: r.partnerId, label: r.partnerLabel, name: r.partnerName, invoices: [], advances: [] })
      .get(r.partnerId)!;
  for (const r of invoices) {
    const due = r.dueDate ?? r.date;
    const bucket = agingBucket(due, asOf);
    const c = Math.round(r.open * 100);
    const p = partnerOf(r);
    p.invoices.push({ ...r, due, days: daysOverdue(due, asOf), bucket });
    for (const f of [p, totals]) {
      f.buckets[bucket] += c;
      f.invoice += c;
    }
  }
  for (const r of advances) {
    const c = Math.round(r.open * 100);
    const p = partnerOf(r);
    p.advances.push(r);
    p.advance += c;
    totals.advance += c;
  }
  const list = [...partners.values()].sort((a, b) => a.label.localeCompare(b.label));
  for (const p of list) {
    p.invoices.sort((a, b) => a.due.localeCompare(b.due) || a.id - b.id);
    toRupiah(p);
  }
  toRupiah(totals);
  return { partners: list, totals };
}
