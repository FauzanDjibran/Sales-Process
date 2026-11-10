import { AppShell } from "@/components/shell/app-shell";
import { ToastProvider } from "@/components/ui/toast";
import { requireApp } from "@/lib/erp/auth";
import { appsOf, visibleModules } from "@/lib/erp/nav";

/**
 * The Produksi application (P254): every route under `/production`. Same
 * shell as the ERP, with the module's groups on the rail.
 */
export default async function ProductionLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const actor = await requireApp("production");

  return (
    <ToastProvider>
      <AppShell
        app="production"
        canSwitch={appsOf(actor.permissions).length > 1}
        user={{
          name: actor.user.name,
          initials: actor.user.initials,
          email: actor.user.email,
          roles: actor.roles.map((r) => r.name),
        }}
        modules={visibleModules(actor.permissions, "production")}
      >
        {children}
      </AppShell>
    </ToastProvider>
  );
}
