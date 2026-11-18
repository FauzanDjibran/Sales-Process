import { KerjaList } from "@/components/production/kerja-list";
import { requirePermission } from "@/lib/erp/auth";
import { unitIdsOf } from "@/lib/erp/production-access";
import { listKerjas } from "@/lib/erp/production-kerja";

export const dynamic = "force-dynamic";

export default async function Page() {
  const actor = await requirePermission("PRODUCTION_KERJA_VIEW", "/production/kerja");
  return <KerjaList rows={await listKerjas(await unitIdsOf(actor))} />;
}
