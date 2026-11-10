import { ToastProvider } from "@/components/ui/toast";

/**
 * The only route group outside the application shells. The login page is
 * reachable without a session, so this layout must not render a shell — which
 * fetches the signed-in user. `/apps`, the picker between the two applications
 * (P254), sits here for the same centred card and asks for a session itself.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <ToastProvider>
      <div className="auth">{children}</div>
    </ToastProvider>
  );
}
