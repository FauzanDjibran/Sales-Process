import { HandoverList } from "@/components/production/handover-list";
import { requirePermission } from "@/lib/erp/auth";
import { unitIdsOf } from "@/lib/erp/production-access";
import { listProductionReceipts } from "@/lib/erp/production-receipt";
import { PRODUCTION_RECEIPT_PATH, PRODUCTION_RECEIPT_PURPOSES, PRODUCTION_RECEIPT_STATUS_TEXT } from "@/lib/erp/production-handover-shape";

export const dynamic = "force-dynamic";

/** The Production Receipt register (P317), narrowed to the user's Units (P260). */
export default async function Page() {
  const actor = await requirePermission("PRODUCTION_RECEIPT_VIEW", PRODUCTION_RECEIPT_PATH);
  const rows = await listProductionReceipts(await unitIdsOf(actor));
  return (
    <HandoverList
      title="Production Receipt"
      sub="Barang yang dikirim gudang ke Unit. Dokumen lahir saat gudang mengirim Stock Issue."
      icon="down"
      base={PRODUCTION_RECEIPT_PATH}
      statusText={PRODUCTION_RECEIPT_STATUS_TEXT}
      warehouseHead="Dari Gudang"
      rows={rows.map((r) => ({ ...r, purpose: PRODUCTION_RECEIPT_PURPOSES[r.purpose] }))}
    />
  );
}
