import { AccessDenied } from "@/components/auth/access-denied";

/**
 * Rendered with a 403 when `forbidden()` is called from anywhere under the
 * application shell.
 *
 * It renders only the refusal: `(database)/layout.tsx` sits above this boundary, so
 * the topbar is already there. The user stays signed in and
 * the rest of the application stays navigable.
 */
export default function AppForbidden() {
  return <AccessDenied />;
}
