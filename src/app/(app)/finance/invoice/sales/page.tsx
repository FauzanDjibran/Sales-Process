import { InvoiceList } from "@/components/finance/invoice-list";
import { requirePermission } from "@/lib/erp/auth";
import { listInvoices } from "@/lib/erp/ar-invoice";
import { invoiceAbilities } from "@/lib/erp/ar-invoice-workflow";

export const dynamic = "force-dynamic";

/** The Invoice Penjualan register (§9). */
export default async function Page() {
  const actor = await requirePermission("SALES_INVOICE_VIEW", "/finance/invoice/sales");
  return <InvoiceList rows={await listInvoices()} can={invoiceAbilities(actor.permissions)} />;
}
