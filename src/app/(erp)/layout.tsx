import { AppShell } from "@/components/shell/app-shell";
import { ToastProvider } from "@/components/ui/toast";
import { requireApp } from "@/lib/erp/auth";
import { appsOf, visibleModules } from "@/lib/erp/nav";

/**
 * The ERP application (P254). Nothing renders until a session is proven and the
 * user holds the ERP; the pages below add their own permission checks.
 */
export default async function ErpLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const actor = await requireApp("erp");

  return (
    <ToastProvider>
      <AppShell
        app="erp"
        canSwitch={appsOf(actor.permissions).length > 1}
        user={{
          name: actor.user.name,
          initials: actor.user.initials,
          email: actor.user.email,
          roles: actor.roles.map((r) => r.name),
        }}
        modules={visibleModules(actor.permissions, "erp")}
      >
        {children}
      </AppShell>
    </ToastProvider>
  );
}
