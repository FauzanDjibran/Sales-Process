import { PurchaseInvoiceList } from "@/components/finance/purchase-invoice-list";
import { requirePermission } from "@/lib/erp/auth";
import { listPurchaseInvoices } from "@/lib/erp/ap-invoice";
import { purchaseInvoiceAbilities } from "@/lib/erp/ap-invoice-workflow";

export const dynamic = "force-dynamic";

/** The Invoice Pembelian register (P128). */
export default async function Page() {
  const actor = await requirePermission("PURCHASE_INVOICE_VIEW", "/finance/invoice/purchase");
  return <PurchaseInvoiceList rows={await listPurchaseInvoices()} can={purchaseInvoiceAbilities(actor.permissions)} />;
}
