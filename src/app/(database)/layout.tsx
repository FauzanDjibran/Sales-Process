import { DatabaseShell } from "@/components/database/database-shell";
import { ToastProvider } from "@/components/ui/toast";
import { requireApp } from "@/lib/erp/auth";
import { appsOf } from "@/lib/erp/nav";

/**
 * The Database application (P313): a read-only viewer of the schema. One page,
 * so it has the topbar but no rail and no submenu of menus.
 */
export default async function DatabaseLayout({ children }: { children: React.ReactNode }) {
  const actor = await requireApp("database");

  return (
    <ToastProvider>
      <DatabaseShell
        canSwitch={appsOf(actor.permissions).length > 1}
        user={{
          name: actor.user.name,
          initials: actor.user.initials,
          email: actor.user.email,
          roles: actor.roles.map((r) => r.name),
        }}
      >
        {children}
      </DatabaseShell>
    </ToastProvider>
  );
}
