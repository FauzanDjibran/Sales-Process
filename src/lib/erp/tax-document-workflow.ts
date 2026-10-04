/**
 * The tax documents' states and reminders, written once and read by both sides
 * (P100, P101, `tax_concept.md` §5.2, §6.2).
 *
 * They are **internal records**, one per event: what PPN a transaction gave
 * rise to, what PPh a customer withheld. Coretax is where they are reported,
 * not what they are for.
 *
 *   Faktur Pajak Keluaran   no lifecycle — complete from the posting; the
 *                           NSFP is an optional reference, filled in or
 *                           corrected with *Isi NSFP*
 *   Bukti Potong PPh        Menunggu Bukti Potong ──Catat (nomor, tanggal)──> Diterima
 *                           (the PPh may be credited only once the slip is in
 *                           hand; its number can be corrected afterwards)
 *
 * Neither ever posts a journal: the receipt and the Invoice already booked the
 * PPN and the PPh. A faktur still without an NSFP past the 15th of the month
 * after its tax point, or a slip past the 20th, is flagged — a reminder, not a
 * state.
 *
 * Client-safe on purpose — no `server-only`, no database import.
 */

export type TaxFakturKind = "Advance" | "Settlement" | "Normal";
export type TaxSlipStatus = "Awaiting" | "Received";

export const FAKTUR_KIND_TEXT: Record<TaxFakturKind, string> = {
  Advance: "Faktur Uang Muka",
  Settlement: "Faktur Pelunasan",
  Normal: "Faktur Normal",
};

export const SLIP_STATUS_TEXT: Record<TaxSlipStatus, string> = {
  Awaiting: "Menunggu Bukti Potong",
  Received: "Diterima",
};

export const SLIP_STATUS_BADGE: Record<TaxSlipStatus, string> = {
  Awaiting: "s-warn",
  Received: "s-ok",
};

const pad2 = (n: number) => String(n).padStart(2, "0");

/** A day of the month after `iso`'s month, `YYYY-MM-DD`. */
function nextMonthDay(iso: string, day: number): string {
  const [y, m] = iso.split("-").map(Number);
  return m === 12 ? `${y + 1}-01-${pad2(day)}` : `${y}-${pad2(m + 1)}-${pad2(day)}`;
}

/** A faktur is uploaded by the 15th of the month after its tax point (PMK 81/2024). */
export const uploadDeadline = (taxDate: string) => nextMonthDay(taxDate, 15);

/** The withholder reports by the 20th of the following month; the BPPU is normally there after that. */
export const slipExpected = (withheldDate: string) => nextMonthDay(withheldDate, 20);

/** No NSFP yet and past the upload date — a reminder that Coretax may still be owed this one. */
export const fakturLate = (f: { nsfp: string | null; deadline: string }, today: string) => !f.nsfp && today > f.deadline;

export const slipLate = (s: { status: TaxSlipStatus; expected: string }, today: string) =>
  s.status === "Awaiting" && today > s.expected;

/** An NSFP as Coretax gives it: 17 digits, separators ignored. */
export function normalizeNsfp(raw: string): string {
  return String(raw ?? "").replace(/\D/g, "");
}

/** The tax documents a source document gave rise to, for its page's Referensi. */
export type TaxDocRefs = {
  fakturs: { id: number; fakturNo: string; nsfp: string | null }[];
  slips: { id: number; slipNo: string }[];
};

export type TaxAbilities = { nsfp: boolean; receive: boolean };

export function taxAbilities(permissions: Iterable<string>): TaxAbilities {
  const held = permissions instanceof Set ? permissions : new Set(permissions);
  return { nsfp: held.has("TAX_FAKTUR_EDIT"), receive: held.has("TAX_SLIP_RECEIVE") };
}
