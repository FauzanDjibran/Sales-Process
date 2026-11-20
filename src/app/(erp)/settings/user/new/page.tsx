import { UserForm } from "@/components/settings/user-form";
import { actorCan } from "@/lib/erp/access";
import { requirePermission } from "@/lib/erp/auth";
import { assignableUnits } from "@/lib/erp/production-access";
import { assignableWarehouses } from "@/lib/erp/warehouse-access";
import { assignableRoles } from "@/lib/erp/user-admin";

export const dynamic = "force-dynamic";

export default async function NewUserPage() {
  const actor = await requirePermission("USER_CREATE", "/settings/user/new");

  // Only fetched when the caller may actually grant access; otherwise the form
  // never offers roles and `createUser` would refuse them anyway.
  const canAssign = actorCan(actor, "USER_ROLE_ASSIGN");
  const roles = canAssign ? await assignableRoles(actor) : [];
  const units = canAssign ? await assignableUnits() : [];
  const warehouses = canAssign ? await assignableWarehouses() : [];

  return (
    <UserForm
      mode="new"
      user={null}
      roles={roles}
      assignedRoleIds={[]}
      units={units}
      assignedUnitIds={[]}
      warehouses={warehouses}
      assignedWarehouseIds={[]}
      isSelf={false}
      can={{
        edit: true,
        assignRoles: canAssign,
        resetPassword: false,
        activate: false,
        deactivate: false,
      }}
    />
  );
}
