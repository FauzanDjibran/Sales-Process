import { FakturList } from "@/components/tax/faktur-list";
import { requirePermission } from "@/lib/erp/auth";
import { listFakturs } from "@/lib/erp/tax-document";
import { todayIso } from "@/lib/format";

export const dynamic = "force-dynamic";

/** The Faktur Pajak Keluaran register (P100). */
export default async function Page() {
  await requirePermission("TAX_FAKTUR_VIEW", "/tax/faktur");
  return <FakturList rows={await listFakturs()} today={todayIso()} />;
}
