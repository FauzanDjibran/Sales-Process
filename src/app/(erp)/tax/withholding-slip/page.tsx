import { SlipList } from "@/components/tax/slip-list";
import { requirePermission } from "@/lib/erp/auth";
import { listSlips } from "@/lib/erp/tax-document";
import { todayIso } from "@/lib/format";

export const dynamic = "force-dynamic";

/** The Bukti Potong PPh register (P100). */
export default async function Page() {
  await requirePermission("TAX_SLIP_VIEW", "/tax/withholding-slip");
  return <SlipList rows={await listSlips()} today={todayIso()} />;
}
