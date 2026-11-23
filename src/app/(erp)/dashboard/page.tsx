import { Icon } from "@/components/icon";
import { requirePermission } from "@/lib/erp/auth";

export const dynamic = "force-dynamic";

/**
 * The dashboard — empty on purpose until one is designed (P32, P309).
 *
 * SIBA's dashboard composition was built around Budget, Finance documents and
 * two Companies, none of which were carried, so it stays behind rather than
 * being trimmed into a screen nobody designed. The page exists because the
 * menu entry does, and a menu entry must always land somewhere.
 */
export default async function DashboardPage() {
  await requirePermission("MENU_DASHBOARD_ACCESS", "/dashboard");

  return (
    <>
      <div className="ph">
        <div className="crumb">
          <span className="cur">Dashboard</span>
        </div>
        <div className="ph-row">
          <h1>
            <span className="ph-ico">
              <Icon name="grid" size={16} />
            </span>
            Dashboard
          </h1>
          <div className="ph-act" />
        </div>
        <p className="ph-sub">Ringkasan aplikasi.</p>
      </div>
    </>
  );
}
