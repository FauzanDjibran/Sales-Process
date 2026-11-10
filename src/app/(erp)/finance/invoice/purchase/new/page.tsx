import { PurchaseInvoiceForm } from "@/components/finance/purchase-invoice-form";
import { requirePermission } from "@/lib/erp/auth";
import { purchaseInvoiceOptions } from "@/lib/erp/ap-invoice";
import { purchaseInvoiceAbilities } from "@/lib/erp/ap-invoice-workflow";

export const dynamic = "force-dynamic";

export default async function Page() {
  const actor = await requirePermission("PURCHASE_INVOICE_CREATE", "/finance/invoice/purchase/new");
  return <PurchaseInvoiceForm mode="new" invoice={null} options={await purchaseInvoiceOptions()} can={purchaseInvoiceAbilities(actor.permissions)} />;
}
