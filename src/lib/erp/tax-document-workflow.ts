/**
 * The tax documents' states and deadlines, written once and read by both sides
 * (P100, `tax_concept.md` §5.2, §6.2).
 *
 *   Faktur Pajak Keluaran   Menunggu Upload ──Catat Upload (NSFP, tanggal)──> Dilaporkan
 *   Bukti Potong PPh        Menunggu Bukti Potong ──Catat Diterima (nomor, tanggal)──> Diterima
 *
 * Neither ever posts a journal: the receipt and the Invoice already booked the
 * PPN and the PPh. A faktur past the 15th of the month after its tax point, or
 * a slip past the 20th, is flagged late — a flag, not a state.
 *
 * Client-safe on purpose — no `server-only`, no database import.
 */

export type TaxFakturKind = "Advance" | "Settlement" | "Normal";
export type TaxFakturStatus = "Awaiting" | "Reported";
export type TaxSlipStatus = "Awaiting" | "Received";

export const FAKTUR_KIND_TEXT: Record<TaxFakturKind, string> = {
  Advance: "Faktur Uang Muka",
  Settlement: "Faktur Pelunasan",
  Normal: "Faktur Normal",
};

export const FAKTUR_STATUS_TEXT: Record<TaxFakturStatus, string> = {
  Awaiting: "Menunggu Upload",
  Reported: "Dilaporkan",
};

export const FAKTUR_STATUS_BADGE: Record<TaxFakturStatus, string> = {
  Awaiting: "s-warn",
  Reported: "s-ok",
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

export const fakturLate = (f: { status: TaxFakturStatus; deadline: string }, today: string) =>
  f.status === "Awaiting" && today > f.deadline;

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

export type TaxAbilities = { upload: boolean; receive: boolean };

export function taxAbilities(permissions: Iterable<string>): TaxAbilities {
  const held = permissions instanceof Set ? permissions : new Set(permissions);
  return { upload: held.has("TAX_FAKTUR_UPLOAD"), receive: held.has("TAX_SLIP_RECEIVE") };
}
