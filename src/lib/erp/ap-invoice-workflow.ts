/**
 * The Invoice Pembelian's lifecycle and arithmetic (P128, B28–B31) — the
 * Invoice Penjualan's shape (`ar-invoice-workflow.ts`) on the other side.
 *
 *   Draft ──post──> Posted        Draft ──cancel──> Cancelled
 *
 * Client-safe on purpose — no `server-only`, no database import — so the form
 * shows exactly what Posting books.
 */
import { computeInvoice, type InvoiceFigures, type PpnRates } from "./sales-tax";
import type { InvoiceAction, InvoiceStatus, InvoiceTransition } from "./ar-invoice-workflow";

export {
  INVOICE_HOLDS,
  INVOICE_PAY_BADGE,
  INVOICE_PAY_TEXT,
  INVOICE_STATUS_BADGE,
  INVOICE_STATUS_TEXT,
  invoiceIsEditable,
} from "./ar-invoice-workflow";
export type { InvoiceAbilities, InvoiceAction, InvoicePayState, InvoiceStatus } from "./ar-invoice-workflow";

export const PURCHASE_INVOICE_TRANSITIONS: Record<InvoiceAction, InvoiceTransition> = {
  post: {
    label: "Posting",
    permission: "PURCHASE_INVOICE_POST",
    from: ["Draft"],
    to: "Posted",
    icon: "check",
    tone: "primary",
    title: "Posting Invoice Pembelian",
    body:
      "Hutang usaha, PPN Masukan dan PPh yang kita potong diakui dengan journal di bawah ini pada " +
      "Tanggal Invoice; Barang Diterima Belum Ditagih dihapus sebesar nilai penerimaannya, uang muka " +
      "yang dipilih dipakai. Invoice yang sudah diposting tidak dapat diubah atau dibatalkan.",
    confirmLabel: "Ya, Posting",
    done: "Invoice Pembelian diposting",
  },
  cancel: {
    label: "Batalkan",
    permission: "PURCHASE_INVOICE_CANCEL",
    from: ["Draft"],
    to: "Cancelled",
    icon: "block",
    tone: "danger",
    title: "Batalkan Invoice Pembelian",
    body:
      "Draft ditandai Dibatalkan; baris Receipt Note-nya dapat ditagihkan lagi dan uang mukanya tidak " +
      "lagi dicadangkan. Tidak ada journal yang dibuat. Status ini final.",
    confirmLabel: "Ya, Batalkan",
    reason: "Mengapa Invoice ini dibatalkan…",
    done: "Invoice Pembelian dibatalkan",
  },
};

export function purchaseInvoiceTransitionAllowed(action: InvoiceAction, status: InvoiceStatus): boolean {
  return PURCHASE_INVOICE_TRANSITIONS[action].from.includes(status);
}

export function purchaseInvoiceAbilities(permissions: Iterable<string>) {
  const held = permissions instanceof Set ? permissions : new Set(permissions);
  return {
    create: held.has("PURCHASE_INVOICE_CREATE"),
    edit: held.has("PURCHASE_INVOICE_EDIT"),
    post: held.has("PURCHASE_INVOICE_POST"),
    cancel: held.has("PURCHASE_INVOICE_CANCEL"),
  };
}

export function availablePurchaseInvoiceActions(status: InvoiceStatus, can: ReturnType<typeof purchaseInvoiceAbilities>): InvoiceAction[] {
  return (["cancel", "post"] as InvoiceAction[]).filter((a) => purchaseInvoiceTransitionAllowed(a, status) && can[a]);
}

export type PurchaseInvoiceFigures = InvoiceFigures & {
  /** The PPh the company withholds, on the DPP after the advance (B31). */
  pph: number;
  /** Supplier total − ours (B29b); 0 when not compared. */
  difference: number;
  /** Whether the difference is within the tolerance. */
  withinTolerance: boolean;
  /** What Hutang Usaha is born at: full DPP + full PPN + difference − PPh. */
  payable: number;
};

/**
 * An Invoice Pembelian's figures (B29a–B31). Each line is billed at its
 * receipt's value — the PO's DPP for the quantity, already cumulative — so the
 * DPP is taken as it is (the price mode was resolved at the receipt); PPN per
 * line on the full DPP, the advances' DPP and PPN deducted once (P113, P118),
 * the PPh per Jenis PPh on the DPP after the advance; then the supplier's total
 * compared with ours.
 */
export function computePurchaseInvoice(input: {
  lines: { dpp: number; withholdingRate: number | null; withholdingKey: string | null }[];
  taxable: boolean;
  rates: PpnRates | null;
  advanceUsed: number;
  advancePpn: number;
  supplierTotal: number | null;
  tolerance: number;
}): PurchaseInvoiceFigures {
  const f = computeInvoice({
    lines: input.lines.map((l) => ({
      qty: 1,
      orderQty: 1,
      orderGross: l.dpp,
      orderDiscount: 0,
      price: l.dpp,
      discountType: null,
      discountValue: null,
      billedQtyBefore: 0,
      withholdingRate: l.withholdingRate,
      withholdingKey: l.withholdingKey,
    })),
    mode: "Exclude",
    taxable: input.taxable,
    rates: input.rates,
    advanceUsed: input.advanceUsed,
    advancePpn: input.advancePpn,
  });
  const difference = input.supplierTotal == null ? 0 : Math.round(input.supplierTotal) - f.total;
  return {
    ...f,
    pph: f.withholdingTotal,
    difference,
    withinTolerance: Math.abs(difference) <= Math.max(0, input.tolerance),
    payable: f.dpp + f.fullPpn + difference - f.withholdingTotal,
  };
}
