import { InvoiceList } from "@/components/sales/invoice-list";
import { requirePermission } from "@/lib/erp/auth";
import { listInvoices } from "@/lib/erp/sales-invoice";
import { invoiceAbilities } from "@/lib/erp/sales-invoice-workflow";

export const dynamic = "force-dynamic";

/** The Faktur Penjualan register (§9). */
export default async function Page() {
  const actor = await requirePermission("SALES_INVOICE_VIEW", "/sales/invoice");
  return <InvoiceList rows={await listInvoices()} can={invoiceAbilities(actor.permissions)} />;
}
