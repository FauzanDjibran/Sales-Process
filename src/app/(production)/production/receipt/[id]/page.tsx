import { notFound } from "next/navigation";
import { HandoverView } from "@/components/production/handover-view";
import { ProductionReceiveButton } from "@/components/production/production-receive-button";
import { RecordHistoryCard } from "@/components/ui/record-history-card";
import { requirePermission } from "@/lib/erp/auth";
import { requireUnit } from "@/lib/erp/production-access";
import { getProductionReceipt } from "@/lib/erp/production-receipt";
import { PRODUCTION_RECEIPT_PATH, PRODUCTION_RECEIPT_PURPOSES, PRODUCTION_RECEIPT_STATUS_TEXT } from "@/lib/erp/production-handover-shape";

export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requirePermission("PRODUCTION_RECEIPT_VIEW", PRODUCTION_RECEIPT_PATH);
  const doc = await getProductionReceipt(Number(id));
  if (!doc) notFound();
  await requireUnit(actor, doc.unitId);
  return (
    <>
      <HandoverView
        doc={doc}
        title="Production Receipt"
        icon="down"
        base={PRODUCTION_RECEIPT_PATH}
        purpose={PRODUCTION_RECEIPT_PURPOSES[doc.purpose]}
        statusText={PRODUCTION_RECEIPT_STATUS_TEXT}
        warehouseLabel="Dari Gudang"
        action={doc.status === "InTransit" && actor.permissions.has("PRODUCTION_RECEIPT_RECEIVE") ? <ProductionReceiveButton id={doc.id} subject={doc.no} from={doc.warehouseName} /> : null}
      />
      <RecordHistoryCard entityKey="prd_receipt" rowId={doc.id} />
    </>
  );
}
