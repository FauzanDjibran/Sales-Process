import { RoleForm } from "@/components/settings/role-form";
import { actorCan } from "@/lib/erp/access";
import { requirePermission } from "@/lib/erp/auth";
import { permissionsByModule } from "@/lib/erp/permissions";

export const dynamic = "force-dynamic";

export default async function NewRolePage() {
  const actor = await requirePermission("ROLE_CREATE", "/settings/role/new");

  return (
    <RoleForm
      mode="new"
      role={null}
      catalogue={permissionsByModule()}
      frozen={false}
      can={{
        edit: true,
        managePermissions: actorCan(actor, "ROLE_PERMISSION_MANAGE"),
        activate: false,
        deactivate: false,
      }}
    />
  );
}
