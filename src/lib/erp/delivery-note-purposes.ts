/**
 * The purposes of a Delivery Note — a catalogue in code (Claude-ERP.md P106),
 * like the cash & bank purposes (P66).
 *
 * A Delivery Note is standalone: it belongs to no business module, because the
 * same paper carries goods out for a sale, for a purchase return and, later,
 * other flows. Its purpose says what its source is, which partner it goes to,
 * how Post books it and what it writes back to the source. A purpose is
 * behaviour, not data, so the list lives here; one a user could add at runtime
 * would be a row no code knows how to post.
 *
 * Client-safe on purpose — no `server-only`, no database import.
 */

export type DeliveryNotePurposeKey = "sales_delivery";

export type DeliveryNotePurpose = {
  key: DeliveryNotePurposeKey;
  /** As the form and the register read it. */
  name: string;
  desc: string;
  /** The `sys_doc_type.doc_table` of its source document. */
  sourceTable: string;
  /** What the source is called on the form. */
  sourceNoun: string;
  /** The partner category the goods go to (P30). */
  partnerCategory: "Customer" | "Supplier";
};

export const DELIVERY_NOTE_PURPOSES: readonly DeliveryNotePurpose[] = [
  {
    key: "sales_delivery",
    name: "Pengiriman Penjualan",
    desc:
      "Barang keluar ke customer berdasarkan Delivery Order yang diterbitkan. Posting mengakui " +
      "HPP; piutang dan pajaknya diakui di Invoice Penjualan.",
    sourceTable: "sal_delivery_order",
    sourceNoun: "Delivery Order",
    partnerCategory: "Customer",
  },
];

/** The purpose a new note starts on — the only one so far. */
export const DEFAULT_DELIVERY_NOTE_PURPOSE: DeliveryNotePurposeKey = "sales_delivery";

export function deliveryNotePurpose(key: string): DeliveryNotePurpose | undefined {
  return DELIVERY_NOTE_PURPOSES.find((p) => p.key === key);
}
