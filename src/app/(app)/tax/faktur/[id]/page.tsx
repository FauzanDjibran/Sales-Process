import { notFound } from "next/navigation";
import { FakturView } from "@/components/tax/faktur-view";
import { RecordHistoryCard } from "@/components/ui/record-history-card";
import { requirePermission } from "@/lib/erp/auth";
import { customerOrderNumbersByIds } from "@/lib/erp/customer-order";
import { permitRequestNumbersByIds } from "@/lib/erp/permit-request";
import { getFaktur } from "@/lib/erp/tax-document";
import { taxAbilities } from "@/lib/erp/tax-document-workflow";
import { todayIso } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requirePermission("TAX_FAKTUR_VIEW", "/tax/faktur");
  const faktur = await getFaktur(Number(id));
  if (!faktur) notFound();
  // The agreement's number, composed here: the tax module stores only its id.
  const lookup = faktur.scope.table === "sal_permit_request" ? permitRequestNumbersByIds : customerOrderNumbersByIds;
  const orderNo = (await lookup([faktur.scope.id])).get(faktur.scope.id) ?? null;
  return (
    <>
      <FakturView faktur={faktur} orderNo={orderNo} can={taxAbilities(actor.permissions)} today={todayIso()} />
      <RecordHistoryCard entityKey="tax_faktur" rowId={faktur.id} />
    </>
  );
}
