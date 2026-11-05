import type { PeriodRange } from "./period";

/**
 * Buku and Saldo Piutang / Hutang (P233), SIBA's Buku Subjek and Saldo Buku
 * Subjek on the AR and AP items. Piutang Usaha and Uang Muka are **two books**,
 * as two Budget Categories are in SIBA: each runs in its own direction, so an
 * entry is the item's own signed movement — + raises that book, − lowers it —
 * and nothing is signed on a third, netted position. An Invoice is raised by
 * being born and lowered by payment; an Uang Muka raised by money received and
 * lowered by being used.
 *
 * Client-safe: the reports' shape, words and the fold both sides share. The
 * reads are the books' own (`arBook`, `apBook`).
 */

export type BookSide = "ar" | "ap";
export type BookKind = "Invoice" | "Advance";

export const parseBook = (value?: string): BookKind => (value === "advance" ? "Advance" : "Invoice");
export const bookParam = (book: BookKind): string | null => (book === "Advance" ? "advance" : null);

export const BOOK_WORDS = {
  ar: {
    partner: "Customer",
    item: "AR Item",
    Invoice: "Piutang Usaha",
    Advance: "Uang Muka Customer",
    advanceIn: "Uang Muka Diterima",
    notes: {
      Invoice: "Bertambah saat invoice terbit; berkurang oleh pembayaran dan uang muka yang diterapkan ke invoice.",
      Advance: "Bertambah saat uang muka diterima; berkurang saat dipakai invoice. Nilainya bagian DPP, yang tercatat di account Uang Muka.",
    },
  },
  ap: {
    partner: "Supplier",
    item: "AP Item",
    Invoice: "Hutang Usaha",
    Advance: "Uang Muka Supplier",
    advanceIn: "Uang Muka Dibayar",
    notes: {
      Invoice: "Bertambah saat invoice terbit; berkurang oleh pembayaran dan uang muka yang diterapkan ke invoice.",
      Advance: "Bertambah saat uang muka dibayar; berkurang saat dipakai invoice. Nilainya bagian DPP, yang tercatat di account Uang Muka.",
    },
  },
} as const;

/** What an entry was, in its book's own words: an Uang Muka's first money is money, not a "birth". */
export function bookEventText(side: BookSide, type: BookKind, event: string): string {
  if (event === "Create") return type === "Invoice" ? "Invoice Terbit" : BOOK_WORDS[side].advanceIn;
  if (event === "AdvanceReceived") return BOOK_WORDS[side].advanceIn;
  if (event === "AdvanceUsed") return "Dipakai Invoice";
  if (event === "AdvanceApplied") return "Uang Muka Diterapkan";
  return "Pembayaran";
}

export type BookItemRaw = {
  id: number;
  partnerId: number;
  partnerLabel: string;
  partnerName: string;
  date: string;
  sourceNo: string;
  sourceTable: string;
  sourceId: number;
  scopeTable: string | null;
  scopeId: number | null;
  /** Every entry up to the end of the period. */
  entries: { event: string; date: string; movement: number }[];
};

export type BookItem = Omit<BookItemRaw, "entries" | "partnerId" | "partnerLabel" | "partnerName"> & {
  opening: number;
  raised: number;
  lowered: number;
  closing: number;
  agreementNo?: string | null;
};

export type BookSubject = {
  partnerId: number;
  label: string;
  name: string;
  opening: number;
  raised: number;
  lowered: number;
  closing: number;
  /** Entries in the period, loaded when the block is opened. */
  entryCount: number;
  items: BookItem[];
};

export type PartnerBook = {
  side: BookSide;
  book: BookKind;
  range: PeriodRange;
  subjects: BookSubject[];
};

export type BookEntry = {
  id: number;
  date: string;
  ledgerNo: string;
  docNo: string;
  docTable: string;
  docId: number;
  /** The document whose balance moved: the item's source (P234). */
  sourceNo: string;
  sourceTable: string;
  sourceId: number;
  scopeTable: string | null;
  scopeId: number | null;
  agreementNo?: string | null;
  eventText: string;
  note: string | null;
  movement: number;
};

const cents = (n: number) => Math.round(n * 100);

/**
 * Folds the items into one block per partner. An item is listed when it stood
 * or moved in the period, so one settled inside it shows at a closing of nil
 * and the items add up to the block in every column. Added in whole cents.
 */
export function foldPartnerBook(raw: BookItemRaw[], side: BookSide, book: BookKind, range: PeriodRange): PartnerBook {
  const subjects = new Map<number, BookSubject>();
  for (const r of raw) {
    let opening = 0;
    let raised = 0;
    let lowered = 0;
    let inPeriod = 0;
    for (const e of r.entries) {
      const c = cents(e.movement);
      if (e.date < range.from) opening += c;
      else {
        inPeriod += 1;
        if (c > 0) raised += c;
        else lowered -= c;
      }
    }
    const end = opening + raised - lowered;
    if (!opening && !inPeriod) continue;
    const subject =
      subjects.get(r.partnerId) ??
      subjects
        .set(r.partnerId, {
          partnerId: r.partnerId,
          label: r.partnerLabel,
          name: r.partnerName,
          opening: 0,
          raised: 0,
          lowered: 0,
          closing: 0,
          entryCount: 0,
          items: [],
        })
        .get(r.partnerId)!;
    subject.opening += opening;
    subject.raised += raised;
    subject.lowered += lowered;
    subject.closing += end;
    subject.entryCount += inPeriod;
    subject.items.push({
      id: r.id,
      date: r.date,
      sourceNo: r.sourceNo,
      sourceTable: r.sourceTable,
      sourceId: r.sourceId,
      scopeTable: r.scopeTable,
      scopeId: r.scopeId,
      opening: opening / 100,
      raised: raised / 100,
      lowered: lowered / 100,
      closing: end / 100,
    });
  }
  const list = [...subjects.values()].sort((a, b) => a.label.localeCompare(b.label));
  for (const s of list) for (const k of ["opening", "raised", "lowered", "closing"] as const) s[k] /= 100;
  return { side, book, range, subjects: list };
}
