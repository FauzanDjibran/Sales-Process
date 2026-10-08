/**
 * The purposes (tujuan) of a cash and bank transaction — a catalogue in code
 * (Claude-ERP.md P66, closing C3's first half).
 *
 * A purpose is behaviour, not data: it decides the direction money moves, the
 * partner it moves with, which documents it may settle and how it posts. One
 * a user could create at runtime would be a row no code knows how to post, so
 * the list lives here, the way the settings catalogue does. The accounts a
 * purpose posts to come from Account Mapping (P61), and the PPh accounts from
 * each Jenis PPh (P44).
 *
 * **Purpose, then partner, decide what one transaction may settle** (P67):
 * only documents of the purpose's kind, owed by that one partner. A receipt
 * that settles several of them is one transfer on the bank statement.
 *
 * Client-safe on purpose — no `server-only`, no database import.
 */

export type CashBankDirection = "In" | "Out";

export type CashBankPurposeKey = "customer_receipt" | "supplier_payment" | "permit_cost";

/** The kinds of document a purpose settles, by `sys_doc_type.doc_table`. */
export type SettledDocKind = "fin_ar_advance" | "fin_ar_invoice" | "fin_ar_permit_advance" | "fin_ar_permit_invoice";

export const SETTLED_DOC_TEXT: Record<SettledDocKind, string> = {
  fin_ar_advance: "Uang Muka",
  fin_ar_invoice: "Invoice",
  fin_ar_permit_advance: "UM Perizinan",
  fin_ar_permit_invoice: "Inv. Perizinan",
};

/** An invoice of either flow — paid against its Invoice AR item (P98, P137). */
export const isInvoiceKind = (k: SettledDocKind): k is "fin_ar_invoice" | "fin_ar_permit_invoice" =>
  k === "fin_ar_invoice" || k === "fin_ar_permit_invoice";

/** An advance bill of either flow — paid into an Uang Muka item (P133, P137). */
export const isAdvanceKind = (k: SettledDocKind): k is "fin_ar_advance" | "fin_ar_permit_advance" =>
  k === "fin_ar_advance" || k === "fin_ar_permit_advance";

/** The agreement a settled document is scoped to, for its AR item (P137, Z20). */
export const SCOPE_OF_KIND: Record<SettledDocKind, "sal_customer_order" | "sal_permit_request"> = {
  fin_ar_advance: "sal_customer_order",
  fin_ar_invoice: "sal_customer_order",
  fin_ar_permit_advance: "sal_permit_request",
  fin_ar_permit_invoice: "sal_permit_request",
};

/** Where a settled document is read. */
export const SETTLED_DOC_ROUTE: Record<SettledDocKind, string> = {
  fin_ar_advance: "/finance/advance/sales",
  fin_ar_invoice: "/finance/invoice/sales",
  fin_ar_permit_advance: "/finance/advance/permit",
  fin_ar_permit_invoice: "/finance/invoice/permit",
};

/** The kinds of document a payment to a supplier settles (P127). */
export type PaidDocKind = "fin_ap_advance" | "fin_ap_invoice" | "sal_permit_request";

export const PAID_DOC_TEXT: Record<PaidDocKind, string> = {
  fin_ap_advance: "Uang Muka",
  fin_ap_invoice: "Invoice",
  sal_permit_request: "Biaya Perizinan",
};

/** Where a paid document is read. */
export const PAID_DOC_ROUTE: Record<PaidDocKind, string> = {
  fin_ap_advance: "/finance/advance/purchase",
  fin_ap_invoice: "/finance/invoice/purchase",
  sal_permit_request: "/sales/permit",
};

/** One paid document's key, unique across both kinds. */
export const paidKey = (kind: PaidDocKind, id: number) => `${kind}:${id}`;

/** One settled document's key, unique across both kinds. */
export const billKey = (kind: SettledDocKind, id: number) => `${kind}:${id}`;

export type CashBankPurpose = {
  key: CashBankPurposeKey;
  direction: CashBankDirection;
  /** The purpose, as the picker and the register read it. */
  name: string;
  /** Shorter, for a tag. */
  short: string;
  desc: string;
  /** The partner category the partner is drawn from (P30). */
  partnerCategory: "Customer" | "Supplier";
  /** The `sys_doc_type.doc_table`s of what it settles. */
  settles: readonly (SettledDocKind | PaidDocKind)[];
  /** What one settled document is called on the form. */
  docNoun: string;
  /** Whether the settled documents carry PPh a partner may withhold. */
  withholding: boolean;
};

export const CASH_BANK_PURPOSES = [
  // One customer purpose settles every kind of open customer document (P83):
  // advance bills and Invoices together, each line posting by its kind.
  {
    key: "customer_receipt",
    direction: "In",
    name: "Penerimaan dari Customer",
    short: "Dari Customer",
    desc:
      "Dana dari customer atas tagihan uang muka yang diterbitkan dan invoice penjualan yang " +
      "diposting. Uang muka mencatat kewajiban dan PPN Keluaran; invoice melunasi piutang.",
    partnerCategory: "Customer",
    settles: ["fin_ar_advance", "fin_ar_invoice", "fin_ar_permit_advance", "fin_ar_permit_invoice"],
    docNoun: "Tagihan",
    withholding: true,
  },
  // The supplier side mirrored (P127, B24): one purpose pays advance bills and
  // Invoices Pembelian together; the PPh is what the company withholds.
  {
    key: "supplier_payment",
    direction: "Out",
    name: "Pembayaran ke Supplier",
    short: "Ke Supplier",
    desc:
      "Pembayaran ke supplier atas tagihan uang muka yang dicatat dan invoice pembelian yang " +
      "diposting. Uang muka mencatat Uang Muka Pembelian dan PPN Masukan; invoice melunasi hutang.",
    partnerCategory: "Supplier",
    settles: ["fin_ap_advance", "fin_ap_invoice"],
    docNoun: "Tagihan",
    withholding: true,
  },
  // The permit costs of a realised Pengajuan Perizinan (P137, Z12–Z14), paid
  // as one lump — possibly in parts — and expensed without tax. The partner is
  // the customer whose permits they are; the real payee goes in the reference.
  {
    key: "permit_cost",
    direction: "Out",
    name: "Biaya Perizinan",
    short: "Biaya Perizinan",
    desc:
      "Biaya pengurusan perizinan sebesar realisasinya, dibayar sebagai satu kesatuan — boleh " +
      "bertahap. Dibebankan langsung ke Biaya Perizinan, tanpa pajak.",
    partnerCategory: "Customer",
    settles: ["sal_permit_request"],
    docNoun: "Realisasi",
    withholding: false,
  },
] as const satisfies readonly CashBankPurpose[];

export function isCashBankPurposeKey(key: string): key is CashBankPurposeKey {
  return CASH_BANK_PURPOSES.some((p) => p.key === key);
}

export function cashBankPurpose(key: string): CashBankPurpose | null {
  return CASH_BANK_PURPOSES.find((p) => p.key === key) ?? null;
}

export function purposesFor(direction: CashBankDirection): readonly CashBankPurpose[] {
  return CASH_BANK_PURPOSES.filter((p) => p.direction === direction);
}

/** The number series each direction is counted in (P70). */
export const CASH_BANK_PREFIX: Record<CashBankDirection, string> = { In: "BKM", Out: "BKK" };
